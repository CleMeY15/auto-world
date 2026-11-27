"""Qualify the external Rust binary against a synthetic page and the real catalogue SQL."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import test_native_migration as fixtures
from project_export import process
from test_project_export import synthetic_policy

sys.path.insert(0, str(fixtures.HERE.parents[2] / "services/private-catalog"))
import catalog_reader as reader


def synthetic_page():
    def attribute(key, label, code, value_label):
        return {"key": key, "key_label": label, "value": code, "values": [code], "value_label": value_label}

    offer = {"list_id": 42, "ad_type": "offer", "price": [12950], "price_cents": 1295000, "attributes": [
        attribute("brand", "Marque", "DACIA", "DACIA"),
        attribute("model", "Modèle", "SANDERO", "SANDERO"),
        attribute("vehicle_type", "Type de véhicule", "citadine", "Citadine"),
        attribute("fuel", "Énergie", "1", "Essence"),
        attribute("gearbox", "Boîte de vitesse", "2", "Automatique"),
    ]}
    structured = {"props": {"pageProps": {"searchData": {"ads": [offer]}}}}
    card = '<article><a href="/ad/voitures/42">La carte évoque aussi une Renault Clio de 2020 avec 50000 km.</a></article>'
    return ('<script id="__NEXT_DATA__">' + json.dumps(structured) + '</script>' + card).encode()


@unittest.skipUnless(os.getenv("AUTOFIND_TEST_RUST_BIN"), "set AUTOFIND_TEST_RUST_BIN to the qualified producer")
class ProducerCatalogTests(fixtures.NativeMigrationTests):
    def check_contract(self, cur):
        schema = fixtures.SCHEMA
        ddl = fixtures.historical_ddl()
        cur.execute("BEGIN;" + ddl + "COMMIT;")
        cur.execute(f"INSERT INTO {schema}.metadata VALUES ('schema', %s)",
                    ("leboncoin-private-trial/v1:" + hashlib.sha256(ddl.encode()).hexdigest(),))
        for migration in sorted((fixtures.HERE / "migrations").glob("*.up.sql")):
            cur.execute(migration.read_text())
        writer = "fixture_export_writer"
        cur.execute(f"""CREATE ROLE {writer} LOGIN; CREATE ROLE af_rust_export_reader LOGIN;
                        GRANT USAGE ON SCHEMA {schema} TO {writer}, af_rust_export_reader;
                        GRANT SELECT, INSERT ON {schema}.rust_exports TO {writer};
                        GRANT SELECT ON {schema}.catalog_rust_provenance, {schema}.catalog_dom_provenance,
                             {schema}.catalog_media_history TO af_rust_export_reader""")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            crate = root / "services/scraper/scraper_rust"
            crate.mkdir(parents=True)
            policy_file = root / "packages/source-registry/data/leboncoin.json"
            policy_file.parent.mkdir(parents=True)
            now = datetime.now(timezone.utc)
            observed = now - timedelta(minutes=5)
            policy = synthetic_policy(now)
            command = [os.environ["AUTOFIND_TEST_RUST_BIN"], "--replay-page", "https://www.leboncoin.fr/c/voitures",
                       observed.isoformat()]
            page = synthetic_page()
            policy_file.write_text(json.dumps(policy))
            raw = subprocess.check_output(command, input=page, cwd=crate, timeout=15)
            export = root / "result.json"
            export.write_bytes(raw)
            service_file = root / "pg_service.conf"
            service_file.write_text("".join(f"[{role}]\nhost={cur.connection.info.host}\nuser={role}\ndbname=autoworld\n"
                                            for role in (writer, "af_rust_export_reader")))
            admitted = [hashlib.sha256(raw).hexdigest()]
            grant = dict(dom_batch_ids=[], export_ids=admitted, valid_from=observed, valid_until=now + timedelta(hours=1),
                         media_seconds=86400, normalized_seconds=86400)
            with patch.dict(os.environ, PGSERVICEFILE=str(service_file)), patch.object(reader, "publication_grant", return_value=grant):
                self.assertEqual(process(export, policy_file, service=writer)["status"], "inserted")
                self.assertEqual(process(export, policy_file, service=writer)["status"], "already_imported")
                criteria = {"brand": "Dacia", "model": "Sandero", "body": "Citadine", "fuel": "Essence", "gearbox": "Automatique"}
                status, listing = reader.read(reader.LIST + "/42", "")
                self.assertEqual(status, "200 OK")
                self.assertEqual({key: listing[key] for key in criteria}, criteria)
                self.assertEqual(listing["price_amount_minor"], 1295000)
                query = urlencode(criteria | {"priceMin": 12950, "priceMax": 12950})
                status, result = reader.read(reader.LIST, query)
                self.assertEqual(status, "200 OK")
                self.assertEqual([r["source_listing_id"] for r in result["items"]], ["42"])
                admitted.clear()
                self.assertEqual(reader.read(reader.LIST, query)[1]["items"], [])
            for key in ("rawSeconds", "normalizedSeconds"):
                expired = synthetic_policy(now)
                expired["revisions"][0]["configuration"]["policy"]["retention"][key] = 60
                policy_file.write_text(json.dumps(expired))
                with self.subTest(expired=key):
                    result = subprocess.run(command, input=page, cwd=crate, capture_output=True, timeout=15)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, b"")
            policy["revisions"][0]["configuration"]["policy"]["grants"][0]["fields"] = ["media"]
            policy_file.write_text(json.dumps(policy))
            denied = subprocess.run(command, input=page, cwd=crate, capture_output=True, timeout=15)
            self.assertNotEqual(denied.returncode, 0)
            self.assertEqual(denied.stdout, b"")
