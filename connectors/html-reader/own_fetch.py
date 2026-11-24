"""Read one supplied public vehicle detail URL, observing robots and explicit gates."""
import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import partial
from html.parser import HTMLParser
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import ssl
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, getproxies, proxy_bypass

AGENT_TOKEN = "AutoFindex"
USER_AGENT = "AutoFindex/1.0 (automotive data feasibility test)"
# The packaged pilot only enables this operator-approved inventory.
DEMO_ROUTES = {"www.leparking.fr": ("/voiture-occasion-detail/", "/voiture-occasion/")}
DEMO_TRUSTED_EGRESS_HOSTS = frozenset(DEMO_ROUTES)
PUBLIC_HOST = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}")
INTERNAL_SUFFIXES = (".localhost", ".local", ".internal", ".home", ".lan", ".test", ".invalid", ".onion")
URI_UNRESERVED = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
MAX_ROBOTS = 512_000
MAX_DETAIL = 4_000_000
MAX_REFUSAL_SAMPLE = 8_192
REFUSAL_STATUSES = {401, 403, 407, 429, 451}
TEXT_TYPES = {"text/plain", "text/html", "application/xhtml+xml"}
SUPPORT_ID = re.compile(r"[a-fA-F0-9]{16,64}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}")
PAGE_REFERENCE = re.compile(r"\breference\s*#\s*([0-9]{1,4}\.[a-f0-9]{4,16}\.[0-9]{8,13}\.[a-f0-9]{1,16})(?=\s|$)", re.I)
BLOCKED_TEXT = re.compile(
    r"access denied|access to this page has been denied|request rejected|request blocked|"
    r"just a moment|verify (?:that )?you are (?:a )?human|checking your browser|"
    r"robot check|captcha|security check|consent required|consent needed|before you continue|"
    r"accès refusé|vérification de sécurité|vérifiez que vous êtes humain|"
    r"zugriff verweigert|sicherheitsprüfung|bestätigen sie.{0,16}mensch", re.I
)


class UnverifiedEgressHost(OSError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@dataclass
class Response:
    status: int
    mime: str
    body: bytes
    oversized: bool = False
    support: dict | None = None


def support_ids(headers):
    """Only well-formed correlation IDs from their designated response headers."""
    result = {}
    for name in ("X-Request-Id", "X-Correlation-Id"):
        values = headers.get_all(name) or []
        if len(values) == 1 and isinstance(values[0], str) and SUPPORT_ID.fullmatch(values[0]):
            result[name.lower()] = values[0]
    return result


def refusal_summary(mime, sample, truncated=False):
    """Keep only enumerated diagnostics. Never return body or arbitrary header values."""
    report = {"media_type": mime if mime in TEXT_TYPES else "other",
              "inspected_bytes": 0, "sample_truncated": None}
    if sample is None or mime not in TEXT_TYPES:
        return report
    report.update(inspected_bytes=len(sample), sample_truncated=truncated)
    text = sample.decode("utf-8", "replace")
    title = ""
    if mime != "text/plain":
        labels = ChallengeLabels()
        try:
            labels.feed(text)
            labels.close()
        except (AssertionError, ValueError):
            return report
        title = " ".join(" ".join(labels.headings["title"]).split()).casefold()
        text = " ".join(labels.visible)
    if title in {"access denied", "forbidden", "request blocked", "zugriff verweigert", "accès refusé"}:
        report["recognized_title"] = title
    report["explicit_captcha_text"] = bool(re.search(r"\b(?:re|h)?captcha\b", text, re.I))
    report["explicit_human_check_text"] = bool(re.search(
        r"\b(?:verify (?:that )?you are (?:a )?human|vérifiez que vous êtes humain|"
        r"bestätigen sie, dass sie ein mensch sind)\b", text, re.I))
    reference = PAGE_REFERENCE.search(text)
    if reference:
        report["reference"] = reference[1]
    return report


def read_response(reply, status, limit):
    mime = reply.headers.get_content_type()
    ids = support_ids(reply.headers)
    if status in REFUSAL_STATUSES:
        raw = None
        if mime in TEXT_TYPES and (reply.headers.get("Content-Encoding") or "identity").lower() == "identity":
            try:
                raw = reply.read(MAX_REFUSAL_SAMPLE + 1)
            except (OSError, EOFError, http.client.HTTPException):
                pass  # The status and response headers were already received.
        minimal = refusal_summary(mime, None if raw is None else raw[:MAX_REFUSAL_SAMPLE],
                                  raw is not None and len(raw) > MAX_REFUSAL_SAMPLE)
        return Response(status, mime, b"", support={**ids, **minimal})
    if status != 200:
        return Response(status, mime, b"")
    raw = reply.read(limit + 1)
    return Response(status, mime, raw[:limit], len(raw) > limit, ids or None)


def get(url, limit, *, trusted_egress_hosts=DEMO_TRUSTED_EGRESS_HOSTS):
    # No redirects, cookies or retries. No application-selected proxy or route switching.
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain;q=0.9"})
    u = urlsplit(url)
    if getproxies().get("https") and not proxy_bypass(u.hostname):
        # This egress resolves names remotely. Only accept the exact destinations
        # the operator has verified are public on that network.
        if u.hostname not in trusted_egress_hosts:
            raise UnverifiedEgressHost("public destination unverified on the configured egress")
        try:
            reply = build_opener(NoRedirect()).open(req, timeout=15)
        except HTTPError as exc:
            reply = exc
        with reply:
            return read_response(reply, reply.getcode(), limit)
    # Direct deployments resolve once, require exclusively public addresses, then
    # connect to one of those addresses while checking TLS against the original name.
    addresses = socket.getaddrinfo(u.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global or
                            ipaddress.ip_address(a[4][0]).is_multicast for a in addresses):
        raise OSError("private or non-public destination")
    family, kind, proto, _, address = addresses[0]
    conn = http.client.HTTPSConnection(u.hostname, timeout=15)
    try:
        with socket.socket(family, kind, proto) as tunnel:
            tunnel.settimeout(15)
            tunnel.connect(address)
            conn.sock = ssl.create_default_context().wrap_socket(tunnel, server_hostname=u.hostname)
            conn.request("GET", req.selector, headers=dict(req.header_items()))
            with conn.getresponse() as reply:
                return read_response(reply, reply.status, limit)
    finally:
        conn.close()


def approved_url(url, routes=DEMO_ROUTES):
    try:
        if not url.isascii() or any(ord(c) <= 32 or ord(c) == 127 for c in url) or "\\" in url:
            return False
        u = urlsplit(url)
        if (u.scheme != "https" or u.netloc not in routes or not PUBLIC_HOST.fullmatch(u.netloc)
                or u.netloc.endswith(INTERNAL_SUFFIXES) or u.fragment):
            return False
        decoded = unquote(u.path)
        if (re.search(r"[%\\\\?#\x00-\x1f\x7f]", decoded) or
                any(part in (".", "..") for part in decoded.split("/")) or
                re.search(r"%2f", u.path, re.I)):
            return False
        return any(u.path.startswith(route) and len(u.path) > len(route) if route.endswith("/")
                   else u.path == route for route in routes[u.netloc])
    except (ValueError, AttributeError):
        return False


def normalized_robots_path(path):
    # REP compares octets: unreserved characters match their percent-encoded spelling.
    def normalize_escape(match):
        char = chr(int(match[0][1:], 16))
        return char if char in URI_UNRESERVED else match[0].upper()

    encoded = quote(path, safe="!$&'()*+,-./:;=?@_~%[]")
    return re.sub(r"%[a-fA-F0-9]{2}", normalize_escape, encoded)


def path_rule_matches(rule, path):
    # Only '*' and a final '$' have special meaning in robots rules. Match each
    # literal chunk in order without exponential regex backtracking.
    anchored = rule.endswith("$")
    pattern = rule[:-1] if anchored else rule
    pieces = pattern.split("*")
    if len(pieces) == 1:
        return path == pattern if anchored else path.startswith(pattern)
    if not path.startswith(pieces[0]):
        return False
    start = len(pieces[0])
    end = len(path)
    if anchored:
        if not path.endswith(pieces[-1]):
            return False
        end -= len(pieces[-1])
        if start > end:
            return False
        pieces = pieces[:-1]
    for piece in pieces[1:]:
        if piece:
            index = path.find(piece, start, end)
            if index < 0:
                return False
            start = index + len(piece)
    return True


def robots_access(text, url):
    """Choose the matching user-agent group(s) and longest explicit path rule."""
    groups = []
    agents = []
    rules = []
    seen_directive = False
    for line in text.lstrip("\ufeff").splitlines():
        key, sep, value = line.split("#", 1)[0].partition(":")
        if not sep:
            continue
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            if seen_directive:
                groups.append((agents, rules))
                agents, rules, seen_directive = [], [], False
            agents.append(value.casefold())
        elif agents:
            seen_directive = True
            if key in ("allow", "disallow", "crawl-delay") and value:
                rules.append((key, value))
    groups.append((agents, rules))
    specified = [group for agents, group in groups if AGENT_TOKEN.casefold() in agents]
    selected = specified or [group for agents, group in groups if "*" in agents]
    path = urlsplit(url).path
    if urlsplit(url).query:
        path += "?" + urlsplit(url).query
    path = normalized_robots_path(path)
    best = (-1, True)
    delay = 0.0
    for group in selected:
        for key, val in group:
            if key == "crawl-delay":
                try:
                    parsed = float(val)
                    if parsed >= 0:
                        delay = max(delay, parsed)
                except ValueError:
                    pass
                continue
            rule = normalized_robots_path(val)
            if path_rule_matches(rule, path):
                best = max(best, (len(rule.removesuffix("$").replace("*", "")), key == "allow"))
    return best[1], delay


class ChallengeLabels(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.capturing = None
        self.headings = defaultdict(list)
        self.scripts = []
        self.script_depth = 0
        self.visible = []

    def handle_starttag(self, tag, attrs):
        if tag in ("title", "h1"):
            self.capturing = tag
        if tag in ("script", "style", "noscript"):
            self.script_depth += 1
        if tag in ("script", "iframe"):
            self.scripts.append(dict(attrs).get("src") or "")

    def handle_endtag(self, tag):
        if tag == self.capturing:
            self.capturing = None
        if tag in ("script", "style", "noscript"):
            self.script_depth = max(0, self.script_depth - 1)

    def handle_data(self, data):
        if self.capturing:
            self.headings[self.capturing].append(data)
        if not self.script_depth:
            self.visible.append(data)


def looks_gated(raw):
    from optional_notices import optional_public_listing

    html = raw.decode("utf-8", "replace")
    labels = ChallengeLabels()
    labels.feed(html)
    heading = " ".join(" ".join(parts) for parts in labels.headings.values())
    if BLOCKED_TEXT.search(heading):
        return True
    visible = " ".join(" ".join(labels.visible).split())
    if len(visible) < 1800:
        if any(re.search(r"captcha-delivery\.com|/cdn-cgi/challenge-platform|geo\.captcha", src, re.I) for src in labels.scripts):
            return True
        cookie_prompt = re.search(r"(accept|accepter|zustimmen).{0,32}(cookies|continuer|continue|fortfahren)", visible, re.I)
        if BLOCKED_TEXT.search(visible) or cookie_prompt:
            return not optional_public_listing(html)
    return False


def read_public_html(url, *, routes=DEMO_ROUTES, trusted_egress_hosts=DEMO_TRUSTED_EGRESS_HOSTS,
                     transport=None, sleeper=time.sleep):
    """Return coarse receipt and optional raw bytes. Never fetches links from a page."""
    receipt = {"host": None, "result": "url_rejected", "stage": "admission",
               "started_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "robots_http": None,
               "detail_http": None, "requests": 0, "html_bytes": 0}
    if not approved_url(url, routes):
        return receipt, None
    if transport is None:
        transport = partial(get, trusted_egress_hosts=trusted_egress_hosts)
    host = urlsplit(url).hostname
    receipt["host"] = host
    try:
        receipt["stage"] = "robots"
        receipt["requests"] += 1
        robots = transport(f"https://{host}/robots.txt", MAX_ROBOTS)
        receipt["robots_http"] = robots.status
        if robots.status == 200:
            if (robots.oversized or robots.mime != "text/plain" or
                    robots.body.lstrip().startswith(b"<")):
                receipt["result"] = "robots_unusable"
                return receipt, None
            permitted, delay = robots_access(robots.body.decode("utf-8", "replace"), url)
            if not permitted or delay > 60:
                receipt["result"] = "robots_disallow" if not permitted else "crawl_delay_exceeds_pilot"
                return receipt, None
            if delay:
                sleeper(delay)
        elif robots.status not in (404, 410):
            receipt["result"] = "robots_unavailable"
            if robots.status in REFUSAL_STATUSES and robots.support:
                receipt["support"] = robots.support
            return receipt, None
        receipt["stage"] = "page"
        receipt["requests"] += 1
        detail = transport(url, MAX_DETAIL)
        receipt["detail_http"] = detail.status
        if 300 <= detail.status < 400:
            receipt["result"] = "redirect_stopped"
        elif detail.status != 200:
            receipt["result"] = "http_refusal" if detail.status in REFUSAL_STATUSES else "http_error"
            if detail.status in REFUSAL_STATUSES and detail.support:
                receipt["support"] = detail.support
        elif detail.oversized:
            receipt["result"] = "response_too_large"
        elif detail.mime not in ("text/html", "application/xhtml+xml"):
            receipt["result"] = "unexpected_content_type"
        elif not detail.body.strip():
            receipt["result"] = "empty_body"
        elif looks_gated(detail.body):
            receipt["result"] = "verification_or_consent"
            receipt["support"] = {**(detail.support or {}),
                                  **refusal_summary(detail.mime, detail.body[:MAX_REFUSAL_SAMPLE],
                                                    len(detail.body) > MAX_REFUSAL_SAMPLE)}
        else:
            receipt.update(result="html_received", html_bytes=len(detail.body))
            return receipt, detail.body
    except UnverifiedEgressHost:
        receipt["result"] = "egress_host_unverified"
        receipt["requests"] -= 1  # Rejected locally before a network request.
    except (URLError, OSError, ValueError, TimeoutError, EOFError, http.client.HTTPException):
        receipt["result"] = "transport_error"
    return receipt, None


def save_new_private(path, data):
    """Publish a fully written 0600 file without replacing an existing file."""
    path = Path(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as out:
        tmp = Path(out.name)
        try:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
            os.link(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--routes", type=Path, help="Operator-approved JSON mapping of public hosts to detail path prefixes")
    parser.add_argument("--trusted-egress-hosts", type=Path, help=(
        "Optional JSON list of exact authorized hosts whose public destination addresses "
        "the operator has verified on the system egress. Does not grant route access."))
    args = parser.parse_args()
    routes = DEMO_ROUTES if args.routes is None else json.loads(args.routes.read_text())
    if not isinstance(routes, dict) or any(
        not isinstance(host, str) or not isinstance(paths, (tuple, list)) or
        not paths or any(not isinstance(path, str) or not path.startswith("/") for path in paths)
        for host, paths in routes.items()
    ):
        parser.error("routes must map exact hostnames to lists of URL paths")
    trusted = DEMO_TRUSTED_EGRESS_HOSTS.intersection(routes)
    if args.trusted_egress_hosts is not None:
        trusted = json.loads(args.trusted_egress_hosts.read_text())
        if not isinstance(trusted, list) or any(not isinstance(host, str) or host not in routes for host in trusted):
            parser.error("trusted-egress-hosts must be a JSON list of exact hosts in the approved routes")
    receipt, html = read_public_html(args.url, routes=routes, trusted_egress_hosts=trusted)
    if html is not None:
        save_new_private(args.output, html)
    print(json.dumps(receipt, ensure_ascii=False))
    return 0 if html is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
