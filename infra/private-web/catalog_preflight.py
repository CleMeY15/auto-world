"""Check normal availability of the private session, reader and rendered catalogue."""
import http.client
import json
import re
import socket
import sys
import time
from html.parser import HTMLParser


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path, host):
        super().__init__(host, timeout=8)
        self.socket_path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def get(socket_path, host, path, headers=None):
    connection = UnixConnection(socket_path, host)
    try:
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        body = response.read(1_048_577)
        if len(body) > 1_048_576:
            raise ValueError("response too large")
        return response.status, body
    finally:
        connection.close()


class CataloguePage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.has_records_or_empty_state = False
        self.has_logout = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("data-catalog-dataset") == "autoworld/leboncoin":
            self.has_records_or_empty_state = True
        if tag == "a" and attrs.get("href") == "/acces/deconnexion":
            self.has_logout = True


def ready(auth_socket, reader_socket, product_socket):
    status, _ = get(auth_socket, "autofind.tech", "/session-check", {"X-Original-URI": "/catalogue"})
    if status != 401:
        return False
    status, body = get(reader_socket, "localhost", "/internal/catalog?limit=1")
    if status != 200:
        return False
    payload = json.loads(body)
    if not isinstance(payload, dict) or payload.get("dataset") != "autoworld/leboncoin":
        return False
    items = payload.get("items")
    if not isinstance(items, list) or len(items) > 1:
        return False
    for item in items:
        if not isinstance(item, dict) or item.get("source_label") != "Leboncoin":
            return False
        identifier = item.get("source_listing_id")
        if not isinstance(identifier, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", identifier):
            return False
    status, page = get(product_socket, "127.0.0.1:3130", "/catalogue?limit=1")
    if status != 200:
        return False
    parsed = CataloguePage()
    parsed.feed(page.decode("utf-8"))
    parsed.close()
    return parsed.has_records_or_empty_state and parsed.has_logout


if __name__ == "__main__":
    for attempt in range(10):
        try:
            if ready("/run/aw-private-auth/auth.sock", "/run/aw-private-catalog/reader.sock",
                     "/run/aw-private-product/web.sock"):
                sys.exit(0)
        except (OSError, ValueError, http.client.HTTPException):
            pass
        if attempt < 9:
            time.sleep(1)
    sys.exit("Le contrôle de session, le lecteur PostgreSQL ou la page du catalogue est indisponible.")
