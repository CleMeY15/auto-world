"""Run a synthetic parser-to-PostgreSQL check against a disposable local trial DB."""
import hashlib
import sys
from uuid import uuid4

from custom_detail import parse_detail
from reader_pg import import_observations


def check(database):
    # A new document hash keeps this local check repeatable on the same trial DB.
    html = (f'<!-- synthetic {uuid4()} --><h1>Véhicule exemple</h1><p>Prix : 12 300 EUR</p>'
            '<p>Année : 03/2020</p><p>Kilométrage : 43 200 km</p>').encode()
    row = parse_detail(html, "https://suchen.mobile.de/fahrzeuge/details.html?id=100")
    obs = dict(document_sha256=hashlib.sha256(html).hexdigest(), provenance="synthetic", row=row)
    first = import_observations(database, [obs])
    second = import_observations(database, [obs])
    if (first["inserted"], first["verified"], second["inserted"], second["verified"]) != (1, 1, 0, 1):
        raise ValueError("Unexpected insert or replay count.")
    if first["readback_sha256"] != second["readback_sha256"]:
        raise ValueError("The observation changed on replay.")
    print("One synthetic observation written, read back and replayed with zero new rows.")


if __name__ == "__main__":
    check(sys.argv[1])
