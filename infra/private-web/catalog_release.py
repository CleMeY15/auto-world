"""Verify an admitted database row through the authenticated HTTPS edge."""
import argparse
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import sys
import time
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from catalog_preflight import CataloguePage, get

HOST = "autofind.tech"
READER = "/run/aw-private-catalog/reader.sock"
LOOPBACK_PORT = 18443


class Rejected(Exception):
    """Only fixed operator-facing messages may be included."""


def require(condition, message):
    if not condition:
        raise Rejected(message)


def read_session(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, encoding="utf-8") as file:
        info = os.fstat(file.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                and info.st_mode & 0o077 == 0 and info.st_size <= 64 * 1024, "Permissions du fichier de session.")
        values = []
        for line in file.read(65537).splitlines():
            fields = line.removeprefix("#HttpOnly_").split("\t")
            if (len(fields) == 7 and fields[:4] == [HOST, "FALSE", "/", "TRUE"]
                    and fields[5] == "__Host-aw-session" and re.fullmatch(r"[a-z0-9]{32}", fields[6])
                    and fields[4].isascii() and fields[4].isdecimal() and len(fields[4]) <= 12
                    and (fields[4] == "0" or int(fields[4]) > time.time())):
                values.append(fields[6])
    require(len(values) == 1, "Cookie de session absent, expiré ou ambigu.")
    return "__Host-aw-session=" + values[0]


class LoopbackHTTPS(http.client.HTTPSConnection):
    def connect(self):
        with socket.create_connection(("127.0.0.1", LOOPBACK_PORT), self.timeout) as connection:
            self.sock = self._context.wrap_socket(connection, server_hostname=HOST)


def edge_get(path, session, loopback):
    cls = LoopbackHTTPS if loopback else http.client.HTTPSConnection
    connection = cls(HOST, timeout=10, context=ssl.create_default_context())
    try:
        connection.request("GET", path, headers={"Cookie": session} if session else {})
        response = connection.getresponse()
        body = response.read(2_097_153)
        require(len(body) <= 2_097_152, "Taille de réponse HTTPS inattendue.")
        cache = {part.strip().lower() for part in response.getheader("Cache-Control", "").split(",")}
        require({"private", "no-store"} <= cache, "Protection du cache HTTPS absente.")
        return response.status, response.getheader("Location", ""), body
    finally:
        connection.close()


class Page(CataloguePage):
    def __init__(self, body):
        super().__init__()
        self.links = set()
        self.dates = set()
        self.feed(body.decode("utf-8"))
        self.close()

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        attrs = dict(attrs)
        if tag == "a" and isinstance(attrs.get("href"), str):
            self.links.add(attrs["href"])
        if tag == "time":
            self.dates.add(attrs.get("datetime"))


def accept(reader_get, site_get):
    def reader(path):
        status, body = reader_get(path)
        require(status == 200, "Lecture PostgreSQL indisponible.")
        payload = json.loads(body)
        require(isinstance(payload, dict), "Réponse du lecteur invalide.")
        return payload

    page = reader("/internal/catalog?limit=1")
    require(page.get("dataset") == "autoworld/leboncoin", "Origine du catalogue invalide.")
    rows = page.get("items")
    require(isinstance(rows, list) and len(rows) == 1 and isinstance(rows[0], dict),
            "Une annonce admise est nécessaire pour la première mise en service.")
    row = rows[0]
    identifier = row.get("source_listing_id")
    require(isinstance(identifier, str) and re.fullmatch(r"[1-9][0-9]{0,19}", identifier),
            "Identifiant source invalide.")
    listing = reader("/internal/catalog/" + identifier)
    source = "https://www.leboncoin.fr/ad/voitures/" + identifier
    require(listing == row and listing.get("source_label") == "Leboncoin" and listing.get("source_url") == source
            and listing.get("observed_at_kind") in {"file_export", "source_capture"}
            and isinstance(listing.get("observed_at"), str) and isinstance(listing.get("images"), list),
            "La fiche et la provenance PostgreSQL ne correspondent pas.")
    detail_path = "/catalogue/" + identifier
    for path in ("/catalogue", detail_path, "/api/demo/v2/catalog"):
        status, _, body = site_get(path, False)
        anonymous = Page(body)
        require(status == 401 and not anonymous.has_records_or_empty_state and source not in anonymous.links,
                "Une route privée est accessible sans connexion.")
    for path in ("/", "/demo"):
        status, location, _ = site_get(path, True)
        require(status in {301, 302, 303, 307, 308} and location in {"/catalogue", "https://autofind.tech/catalogue"},
                "La navigation après connexion ne mène pas au catalogue.")
    require(site_get("/api/demo/v2/catalog", True)[0] == 403, "L’API de démonstration est encore accessible.")
    # An exact search selects the sampled row even if another export arrives during this check.
    status, _, body = site_get("/catalogue?q=" + identifier, True)
    results = Page(body)
    require(status == 200 and results.has_records_or_empty_state and results.has_logout
            and any(urlsplit(href).path == detail_path and href.startswith("/catalogue/") for href in results.links),
            "Le résultat PostgreSQL ne figure pas dans la recherche privée.")
    status, _, body = site_get(detail_path, True)
    detail = Page(body)
    require(status == 200 and detail.has_logout and source in detail.links
            and listing["observed_at"] in detail.dates and all(url in detail.links for url in listing["images"]),
            "La fiche HTTPS, sa provenance ou ses références photo diffèrent du lecteur.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cookie-file", required=True, type=Path, help="Fichier Netscape privé de l’opérateur.")
    parser.add_argument("--loopback", action="store_true", help="TLS sur 127.0.0.1:18443 avec le certificat autofind.tech.")
    parser.add_argument("--staging-reader-socket", help="Socket du lecteur candidat pendant la répétition loopback.")
    args = parser.parse_args()
    if args.staging_reader_socket and not args.loopback:
        parser.error("Le socket candidat est réservé au staging loopback.")
    try:
        session = read_session(args.cookie_file)
        accept(lambda path: get(args.staging_reader_socket or READER, "localhost", path),
               lambda path, signed_in: edge_get(path, session if signed_in else None, args.loopback))
    except Rejected as exc:
        sys.exit(str(exc))
    except (OSError, ValueError, TypeError, KeyError, http.client.HTTPException):
        sys.exit("Échec de transport, de session ou de décodage pendant la recette.")
    print('{"privateCatalog":"ACCEPTED","dataset":"autoworld/leboncoin","anonymousDenied":true}')
