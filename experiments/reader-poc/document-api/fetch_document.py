"""Bounded, identifiable HTTPS reads from explicitly configured public origins."""

import http.client
import ipaddress
import queue
import re
import socket
import ssl
import threading
import time
from collections import OrderedDict
from urllib.parse import quote, urlsplit

PRODUCT = "AutoFindexReader"
USER_AGENT = PRODUCT + "/1.0"
DOCUMENT_LIMIT = 2 * 1024 * 1024
ROBOTS_LIMIT = 512 * 1024
_DNS_SLOTS = threading.BoundedSemaphore(8)
_HOSTNAME = re.compile(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
_UNRESERVED = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
_TRANSITION = tuple(map(ipaddress.ip_network, ("64:ff9b::/96", "64:ff9b:1::/48", "2002::/16", "2001::/32")))


class FetchError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def _public_address(value):
    ip = ipaddress.ip_address(value)
    if not ip.is_global or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        return not ip.ipv4_mapped and not any(ip in network for network in _TRANSITION)
    return True


def _resolve(host, timeout):
    # getaddrinfo has no timeout. Limit worker count even when the OS resolver stalls.
    if not _DNS_SLOTS.acquire(blocking=False):
        raise FetchError(503, "dns_busy", "Resolver is busy")
    result = queue.Queue(maxsize=1)

    def lookup():
        try:
            result.put(socket.getaddrinfo(host + ".", 443, type=socket.SOCK_STREAM))
        except OSError as exc:
            result.put(exc)
        finally:
            _DNS_SLOTS.release()

    threading.Thread(target=lookup, daemon=True).start()
    try:
        addresses = result.get(timeout=timeout)
    except queue.Empty:
        raise FetchError(504, "dns_timeout", "DNS resolution timed out") from None
    if isinstance(addresses, OSError) or not addresses:
        raise FetchError(502, "dns_failed", "Origin name could not be resolved")
    if any(not _public_address(item[4][0]) for item in addresses):
        raise FetchError(403, "private_address", "Origin resolves to a non-public address")
    return addresses[0]


def _https_get(host, target, limit, timeout):
    deadline = time.monotonic() + timeout
    family, kind, protocol, _, address = _resolve(host, timeout)

    def remaining():
        left = deadline - time.monotonic()
        if left <= 0:
            raise FetchError(504, "origin_timeout", "Origin request timed out")
        return left

    try:
        with socket.socket(family, kind, protocol) as raw:
            raw.settimeout(remaining())
            raw.connect(address)
            context = ssl.create_default_context()
            with context.wrap_socket(raw, server_hostname=host, do_handshake_on_connect=False) as tls:
                # Abort a slow-drip response even if individual socket reads keep succeeding.
                def abort():
                    try:
                        tls.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass

                timer = threading.Timer(remaining(), abort)
                timer.daemon = True
                timer.start()
                conn = http.client.HTTPConnection(host, 443, timeout=remaining())
                try:
                    tls.settimeout(remaining())
                    tls.do_handshake()
                    conn.auto_open = False
                    conn.sock = tls
                    conn.request("GET", target, headers={
                        "Host": host, "User-Agent": USER_AGENT,
                        "Accept": "*/*", "Accept-Encoding": "identity", "Connection": "close",
                    })
                    with conn.getresponse() as response:
                        headers = {k.lower(): v for k, v in response.getheaders()}
                        if response.status != 200:
                            return response.status, headers, b""
                        if headers.get("content-encoding", "identity").lower() != "identity":
                            raise FetchError(415, "content_encoding", "Origin returned unsupported content encoding")
                        declared = headers.get("content-length")
                        if declared is not None and (not declared.isdecimal() or len(declared) > 15):
                            raise FetchError(502, "invalid_length", "Invalid origin content length")
                        if declared is not None and int(declared) > limit:
                            raise FetchError(413, "origin_too_large", "Origin response is too large")
                        body = response.read(limit + 1)
                        remaining()
                        if len(body) > limit:
                            raise FetchError(413, "origin_too_large", "Origin response is too large")
                        if declared is not None and int(declared) != len(body):
                            raise FetchError(502, "truncated_origin", "Incomplete origin response")
                        return response.status, headers, body
                finally:
                    timer.cancel()
                    conn.close()
    except (TimeoutError, socket.timeout):
        raise FetchError(504, "origin_timeout", "Origin request timed out") from None
    except (OSError, http.client.HTTPException):
        if time.monotonic() >= deadline:
            raise FetchError(504, "origin_timeout", "Origin request timed out") from None
        raise FetchError(502, "origin_failed", "Origin connection or TLS verification failed") from None


def _uri_octets(text):
    def decode_unreserved(match):
        char = chr(int(match[0][1:], 16))
        return char if char in _UNRESERVED else match[0].upper()

    encoded = quote(text, safe="/?:@!$&'()*+,;=%-._~")
    return re.sub(r"%[0-9a-fA-F]{2}", decode_unreserved, encoded)


def _robots_allows(body, target):
    try:
        lines = body.decode("utf-8-sig").splitlines()
    except UnicodeDecodeError:
        raise FetchError(403, "invalid_robots", "Cannot interpret robots.txt encoding") from None
    # Collect matching groups, combining duplicates as specified by the REP.
    groups = []
    agents, rules = [], []
    seen_rule = False
    for line in lines:
        field, sep, value = line.split("#", 1)[0].partition(":")
        if not sep:
            continue
        field, value = field.strip().lower(), value.strip()
        if field == "user-agent":
            if seen_rule:
                groups.append((agents, rules))
                agents, rules, seen_rule = [], [], False
            agents.append(value.lower())
        elif field in ("allow", "disallow") and agents:
            seen_rule = True
            if value:
                rules.append((value, field == "allow"))
    groups.append((agents, rules))
    exact = [rules for agents, rules in groups if PRODUCT.lower() in agents]
    selected = exact or [rules for agents, rules in groups if "*" in agents]
    uri = _uri_octets(target)
    best = (-1, True)
    for rules in selected:
        for pattern, allowed in rules:
            pattern = _uri_octets(pattern)
            if not pattern.startswith("/"):
                # A malformed disallow rule is ambiguous. Do not fetch.
                if not allowed:
                    return False
                continue
            if _pattern_matches(pattern, uri):
                size = len(pattern.rstrip("$").replace("*", ""))
                # On a tie prefer Allow, per RFC 9309.
                best = max(best, (size, allowed))
    return best[1]


def _pattern_matches(pattern, target):
    """Prefix matching with REP '*' and terminal '$', without regex backtracking."""
    exact = pattern.endswith("$")
    if exact:
        pattern = pattern[:-1]
    pieces = pattern.split("*")
    if len(pieces) == 1:
        return target == pattern if exact else target.startswith(pattern)
    if not target.startswith(pieces[0]):
        return False
    start = len(pieces[0])
    end = len(target)
    if exact:
        if not target.endswith(pieces[-1]):
            return False
        end -= len(pieces[-1])
    for piece in (pieces[1:-1] if exact else pieces[1:]):
        pos = target.find(piece, start, end)
        if pos < 0:
            return False
        start = pos + len(piece)
    return start <= end


def _check_response(status, headers, body):
    # Stop at explicit access controls, including a successful HTML challenge page.
    html = headers.get("content-type", "").lower().split(";", 1)[0].strip()
    challenge = headers.get("cf-mitigated", "").lower() == "challenge"
    if html in ("text/html", "application/xhtml+xml"):
        start = body[:65536].lower()
        challenge |= bool(re.search(
            rb"<title[^>]*>\s*(?:just a moment|access denied|security check|"
            rb"verify you are human|attention required|captcha)\b", start))
    if challenge:
        raise FetchError(403, "origin_challenge", "Origin requires interactive verification")
    if 300 <= status < 400:
        raise FetchError(502, "origin_redirect", "Origin redirected the request")
    if status != 200:
        raise FetchError(status if 400 <= status < 500 else 502, "origin_status",
                         f"Origin returned HTTP {status}")


class Fetcher:
    def __init__(self, hosts, *, ttl=300, max_entries=60, max_cache_bytes=16*1024*1024,
                 timeout=10, concurrency=4, transport=None, clock=time.monotonic):
        self.hosts = frozenset(host.strip().lower() for host in hosts if host.strip())
        if any(len(host) > 253 or not _HOSTNAME.fullmatch(host) for host in self.hosts):
            raise ValueError("hosts must contain exact DNS hostnames")
        for host in self.hosts:
            try:
                ipaddress.ip_address(host)
            except ValueError:
                continue
            raise ValueError("hosts must contain DNS names, not IP literals")
        if ttl < 0 or max_entries < 0 or max_cache_bytes < 0 or timeout <= 0 or concurrency < 1:
            raise ValueError("invalid fetch limits")
        self.ttl, self.max_entries, self.max_cache_bytes = ttl, max_entries, max_cache_bytes
        self.timeout, self.transport, self.clock = timeout, transport or _https_get, clock
        self._cache, self._used = OrderedDict(), 0
        self._robots = {}
        self._slots, self._lock = threading.BoundedSemaphore(concurrency), threading.Lock()
        self._host_locks = {host: threading.Lock() for host in self.hosts}

    def _request(self, host, target, limit):
        status, headers, body = self.transport(host, target, limit, self.timeout)
        if len(body) > limit:
            raise FetchError(413, "origin_too_large", "Origin response is too large")
        return status, headers, body

    def _allowed(self, host, target):
        saved = self._robots.get(host)
        if saved is None or saved[0] <= self.clock():
            status, headers, body = self._request(host, "/robots.txt", ROBOTS_LIMIT)
            if status in (404, 410) and headers.get("cf-mitigated", "").lower() != "challenge":
                body = b""
            else:
                _check_response(status, headers, body)
                media = headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if media != "text/plain":
                    raise FetchError(403, "invalid_robots", "robots.txt must be plain text")
            self._robots[host] = (self.clock() + 300, body)
        if not _robots_allows(self._robots[host][1], target):
            raise FetchError(403, "robots_denied", "robots.txt disallows this document")

    def get(self, url, refresh=False):
        if (not isinstance(url, str) or len(url) > 4096 or not url or "\\" in url
                or any(ord(c) <= 32 or ord(c) == 127 for c in url)):
            raise FetchError(400, "invalid_url", "Invalid URL")
        try:
            parsed = urlsplit(url)
            host, port = parsed.hostname, parsed.port
        except ValueError:
            raise FetchError(400, "invalid_url", "Invalid URL") from None
        if (parsed.scheme != "https" or not host or parsed.username is not None
                or parsed.password is not None or port not in (None, 443)
                or parsed.netloc.lower() not in (host, host + ":443")):
            raise FetchError(400, "invalid_url", "Expected a public HTTPS URL on port 443")
        if host not in self.hosts:
            raise FetchError(403, "host_not_allowed", "Host is outside the configured list")
        path = parsed.path or "/"
        target = _uri_octets(path + ("?" + parsed.query if parsed.query else ""))
        if (re.search(r"%(?![a-fA-F0-9]{2})", target) or
                re.search(r"%(?:2F|5C|25)", _uri_octets(path), re.I) or
                any(p in (".", "..") for p in _uri_octets(path).split("/"))):
            raise FetchError(400, "invalid_url", "Ambiguous path or percent escape")
        # Serialize per host, bounding in-flight connections and collapsing duplicate misses.
        key = host, target
        if not self._slots.acquire(blocking=False):
            raise FetchError(503, "fetch_busy", "Fetch service is busy")
        try:
            if not self._host_locks[host].acquire(timeout=self.timeout):
                raise FetchError(503, "origin_busy", "Another request is reading this host")
            try:
                self._allowed(host, target)
                with self._lock:
                    cached = self._cache.get(key)
                    if not refresh and cached is not None and cached[0] > self.clock():
                        self._cache.move_to_end(key)
                        return cached[1], cached[2], True
                    if cached is not None:
                        self._used -= len(self._cache.pop(key)[1])
                status, headers, body = self._request(host, target, DOCUMENT_LIMIT)
                _check_response(status, headers, body)
                media = headers.get("content-type", "application/octet-stream")
                controls = {}
                for directive in headers.get("cache-control", "").split(","):
                    name, _, value = directive.partition("=")
                    controls[name.strip().lower()] = value.strip().strip('"')
                lifetime = self.ttl
                if "max-age" in controls:
                    age = headers.get("age", "0").strip()
                    maximum = controls["max-age"]
                    if re.fullmatch(r"[0-9]{1,12}", age) and re.fullmatch(r"[0-9]{1,12}", maximum):
                        lifetime = min(lifetime, max(0, int(maximum) - int(age)))
                    else:
                        lifetime = 0
                if (self.max_entries and lifetime and len(body) <= self.max_cache_bytes
                        and not controls.keys() & {"no-store", "private", "no-cache"}
                        and "set-cookie" not in headers):
                    with self._lock:
                        self._cache[key] = (self.clock() + lifetime, body, media)
                        self._used += len(body)
                        while len(self._cache) > self.max_entries or self._used > self.max_cache_bytes:
                            _, (_, evicted, _) = self._cache.popitem(last=False)
                            self._used -= len(evicted)
                return body, media, False
            finally:
                self._host_locks[host].release()
        finally:
            self._slots.release()
