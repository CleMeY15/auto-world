"""Search an operator-managed SearXNG instance. Results are metadata only."""

import http.client
import ipaddress
import json
import os
import re
import time
from html.parser import HTMLParser
from urllib.parse import urlencode, urlsplit, urlunsplit


MAX_RESULTS = 5
MAX_BYTES = 1024 * 1024
TIMEOUT = 8
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class WebSearchError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status
        self.detail = detail


class _PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def _plain(value, size):
    if not isinstance(value, str):
        return ""
    parser = _PlainText()
    try:
        parser.feed(value[: 4 * size])
        parser.close()
    except (ValueError, AssertionError):
        return ""
    return " ".join("".join(parser.parts).split())[:size]


def _public_result_url(value):
    if not isinstance(value, str) or len(value) > 8192 or _CONTROL.search(value):
        return None
    if "\\" in value or any(char.isspace() for char in value):
        return None
    try:
        u = urlsplit(value)
        host = (u.hostname or "").lower().rstrip(".")
        if u.scheme not in {"http", "https"} or u.username is not None or not host:
            return None
        if u.port not in {None, 80, 443} or "%" in host:
            return None
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            host = host.encode("idna").decode("ascii")
            if "." not in host or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid")):
                return None
            if not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split(".")):
                return None
            # IPv4 addresses in legacy integer/octal/hex form can resolve to loopback.
            if not re.search(r"[a-z]", host.rsplit(".", 1)[-1]) or re.fullmatch(r"0x[0-9a-f]+", host.rsplit(".", 1)[-1]):
                return None
        else:
            if not ip.is_global or ip.is_multicast:
                return None
            host = f"[{ip}]" if ip.version == 6 else str(ip)
        port = "" if u.port in {None, (443 if u.scheme == "https" else 80)} else f":{u.port}"
        return urlunsplit((u.scheme, host + port, u.path or "/", u.query, ""))
    except (ValueError, UnicodeError):
        return None


def _get_results(query):
    # This setting is operator-controlled. Incoming requests cannot supply an endpoint.
    base = os.environ.get("READER_SEARXNG_URL", "").strip()
    if not base:
        raise WebSearchError(503, "Configure READER_SEARXNG_URL pour activer la recherche web.")
    try:
        endpoint = urlsplit(base)
        port = endpoint.port
        if (endpoint.scheme not in {"http", "https"} or not endpoint.hostname
                or endpoint.username is not None or endpoint.query or endpoint.fragment
                or _CONTROL.search(base) or "\\" in base):
            raise ValueError
    except ValueError:
        raise WebSearchError(503, "Configuration de SearXNG invalide.") from None

    path = endpoint.path.rstrip("/") + "/search?" + urlencode({"q": query, "format": "json", "language": "fr"})
    conn_cls = http.client.HTTPSConnection if endpoint.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(endpoint.hostname, port, timeout=TIMEOUT)
    deadline = time.monotonic() + TIMEOUT
    try:
        conn.request("GET", path, headers={"Accept": "application/json", "Accept-Encoding": "identity"})
        # Retain the socket because HTTP/1.0 responses can detach it from the connection.
        sock = conn.sock
        with conn.getresponse() as response:
            if response.status != 200:
                raise WebSearchError(502, f"SearXNG a renvoyé HTTP {response.status}.")
            content_type = response.headers.get_content_type()
            if content_type != "application/json" and not content_type.endswith("+json"):
                raise WebSearchError(502, "SearXNG n’a pas renvoyé du JSON.")
            raw = bytearray()
            while not response.isclosed() and len(raw) <= MAX_BYTES:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError
                if sock is not None:
                    sock.settimeout(remaining)
                chunk = response.read1(min(65536, MAX_BYTES + 1 - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
            if response.length and len(raw) <= MAX_BYTES:
                raise WebSearchError(502, "Réponse SearXNG incomplète.")
            if len(raw) > MAX_BYTES:
                raise WebSearchError(502, "Réponse SearXNG trop volumineuse.")
        payload = json.loads(raw)
    except TimeoutError:
        raise WebSearchError(504, "Délai de réponse de SearXNG dépassé.") from None
    except (OSError, http.client.HTTPException, ValueError, UnicodeError, RecursionError):
        raise WebSearchError(502, "Réponse SearXNG indisponible ou illisible.") from None
    finally:
        conn.close()
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise WebSearchError(502, "Format de résultats SearXNG invalide.")
    if not payload["results"] and payload.get("unresponsive_engines"):
        raise WebSearchError(502, "Le fournisseur de recherche n’a pas répondu.")
    return payload["results"]


def search_web(query: str, limit: int = MAX_RESULTS) -> list[dict[str, str]]:
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 256 or _CONTROL.search(query):
        raise WebSearchError(400, "La requête doit contenir de 1 à 256 caractères.")
    if type(limit) is not int or not 1 <= limit <= MAX_RESULTS:
        raise WebSearchError(400, "La limite doit être comprise entre 1 et 5.")
    items = []
    seen = set()
    for row in _get_results(query.strip()):
        if not isinstance(row, dict):
            continue
        url = _public_result_url(row.get("url"))
        if not url or url in seen:
            continue
        seen.add(url)
        items.append({"title": _plain(row.get("title"), 512) or url, "url": url,
                      "description": _plain(row.get("content"), 2000)})
        if len(items) == limit:
            break
    return items
