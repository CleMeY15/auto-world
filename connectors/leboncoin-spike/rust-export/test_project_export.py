"""Offline contract tests. Set AUTOFIND_TEST_POSTGRES_IMAGE to exercise the actual PostgreSQL migration."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import copy
from datetime import datetime, timezone, timedelta
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

from project_export import Rejected, load_policy, process, project, same_projection, saved_labels_version

PHOTO = "https://img.leboncoin.fr/api/v1/lbcpb1/images/ab/cd/ef/" + "a"*40 + ".jpg?rule=ad-large"
MIGRATION = Path(__file__).parent / "migrations/0003-native-rust-exports.up.sql"
SERVICE = "export_fixture"


def synthetic_policy(now):
    return {"schemaVersion": 1, "sourceId": "leboncoin-fr", "revisions": [{"state": "enabled", "configuration": {
        "legalStatus": "permitted_crawl", "territories": ["FR"], "acquisitionMethods": ["crawl"],
        "policy": {
            "authorization": {"validFrom": (now - timedelta(days=1)).isoformat(),
                              "validUntil": (now + timedelta(days=365)).isoformat()},
            "media": {"mode": "reference", "attributionRequired": True},
            "pii": {"mode": "none"},
            "grants": [{"territory": "FR", "acquisitionMethod": "crawl", "audience": "consumer",
                        "fields": ["source_listing_id", "url", "price", "mileage", "description", "media"]}],
            "retention": {"rawSeconds": 60*86400, "normalizedSeconds": 90*86400, "mediaSeconds": 30*86400},
        },
    }}]}


def synthetic_row(observed, key="11"):
    return {"index": 0, "source_listing_id": key, "url": f"https://www.leboncoin.fr/ad/voitures/{key}",
            "images": [PHOTO], "nb_photos": 1, "media": {"attribution": "Leboncoin",
                "observed_at": observed.isoformat(), "retain_until": (observed + timedelta(days=14)).isoformat()},
            "marque": "Peugeot", "modele": "208 vendeur privé", "annee": "2018", "kilometrage": "11000 km",
            "prix": "12950", "boite": "AUTO", "carburant": "DIESEL"}


def sale_evidence(key):
    return {"schema": "searchData.ads.offer.price/v1", "list_id": key,
            "currency": "EUR", "amount_minor": 1295000}


def feature_evidence(key, attributes):
    return {"schema": "searchData.ads.offer.features/v1", "list_id": key, "attributes": attributes}


def model_evidence(key, brand, model):
    return {"schema": "searchData.ads.offer.model/v1", "list_id": key, "brand": brand, "model": model}


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.observed = self.now - timedelta(minutes=3)
        self.exported = self.now - timedelta(minutes=1)
        self.policy_file = self.directory / "policy.json"
        self.policy_file.write_text(json.dumps(synthetic_policy(self.now)))
        self.policy = load_policy(self.policy_file, self.now)
        self.row = synthetic_row(self.observed)
        self.path = self.directory / "rust.json"
        self.path.write_text(json.dumps([self.row], indent=2))
        os.utime(self.path, (self.exported.timestamp(), self.exported.timestamp()))

    def test_structured_euro_price_is_bound_to_the_offer(self):
        evidence = sale_evidence("11")
        def price(row):
            rows, _ = project(json.dumps([row]).encode(), self.exported, "file_mtime", self.policy, self.now)
            return rows[0]["price_amount_minor"]
        self.assertIsNone(price(self.row))
        self.assertEqual(price(self.row | {"sale_price_evidence": evidence}), 1295000)
        for invalid in (None, evidence | {"schema": "unknown"}, evidence | {"list_id": "12"},
                        evidence | {"currency": "CHF"}, evidence | {"extra": "private"},
                        *(evidence | {"amount_minor": value} for value in
                          (True, "1295000", 12950.0, 0, -100, 1295001, 12950, 9007199254741000))):
            with self.subTest(invalid=invalid), self.assertRaises(Rejected):
                price(self.row | {"sale_price_evidence": invalid})
        with self.assertRaisesRegex(Rejected, "invalid_sale_price_amount"):
            price(self.row | {"prix": "299", "sale_price_evidence": evidence})

    def test_vehicle_evidence_is_typed_and_bound_to_its_listing(self):
        def inspect(row):
            return project(json.dumps([row]).encode(), self.exported, "file_mtime", self.policy, self.now)[0][0]
        attrs = {"fuel": "Diesel", "gearbox": "Manuelle", "body": "Break", "color": "Gris", "upholstery": "Tissu",
                 "doors": 3, "seats": 5, "firstOwner": True, "inspectionValid": False}
        proof = feature_evidence("11", attrs)
        result = inspect(self.row | {"vehicle_features_evidence": proof})
        self.assertEqual(result["vehicle_features"], attrs)
        self.assertNotIn("serviceBook", result["vehicle_features"])
        self.assertNotIn("vehicle_features", inspect(self.row))
        invalid_proofs = [None, proof | {"schema": "unknown"}, proof | {"list_id": "12"}, proof | {"extra": "x"}]
        for bad in ({}, [], None, {"vin": "supplied"}, {"fuel": "diesel"}, {"color": ["Gris"]}, {"doors": True},
                    {"seats": 1.0}, {"seats": 0}, {"seats": 10}, {"firstOwner": 0}, {"serviceBook": None}):
            invalid_proofs.append(proof | {"attributes": bad})
        for invalid in invalid_proofs:
            with self.subTest(invalid=invalid), self.assertRaises(Rejected):
                inspect(self.row | {"vehicle_features_evidence": invalid})
        scoped = synthetic_policy(self.now)
        scoped["revisions"][0]["configuration"]["policy"]["grants"][0]["fields"].remove("description")
        self.policy_file.write_text(json.dumps(scoped))
        with self.assertRaisesRegex(Rejected, "unavailable_private_scope"):
            load_policy(self.policy_file, self.now)

    def test_stored_projection_selects_one_controlled_model_vocabulary(self):
        row = self.row | {"marque": "Tesla", "modele": "Model 3 Long Range"}
        def projected(version):
            return project(json.dumps([row]).encode(), self.exported, "file_mtime", self.policy, self.now,
                           labels_version=version)[0]
        legacy = [{"source_listing_id": "11", "brand": "Tesla", "model": None, "year": 2018,
                   "price_amount_minor": None, "mileage_km": 11000, "images": [PHOTO],
                   "media_observed_at": self.observed.isoformat(),
                   "media_retain_until": (self.observed + timedelta(days=14)).isoformat(),
                   "export_time_basis": "file_mtime"}]
        self.assertEqual(projected(saved_labels_version(legacy)), legacy)
        new = projected(2)
        self.assertEqual(new, [legacy[0] | {"vehicle_labels_version": 2}])
        self.assertEqual(projected(saved_labels_version(new)), new)
        self.assertFalse(same_projection([{"firstOwner": False}], [{"firstOwner": 0}]))
        self.assertFalse(same_projection([{"seats": 1.0}], [{"seats": 1}]))
        for damaged in ([*new, *legacy], [{"vehicle_labels_version": True}], [{"vehicle_labels_version": 2.0}],
                        [{"vehicle_labels_version": "2"}], [{"vehicle_labels_version": 99}], [{"vehicle_features": {}}]):
            with self.subTest(damaged=damaged), self.assertRaisesRegex(Rejected, "invalid_stored_labels_version"):
                saved_labels_version(damaged)

    def test_new_vehicle_models_require_the_exact_structured_pair_for_this_offer(self):
        def inspect(*rows, version=2):
            return project(json.dumps(rows).encode(), self.exported, "file_mtime", self.policy, self.now,
                           labels_version=version)[0]

        for brand, model in (("Tesla", "Model 3"), ("Dacia", "Sandero")):
            row = self.row | {"marque": brand, "modele": model}
            self.assertIsNone(inspect(row)[0]["model"])
            proof = model_evidence("11", brand, model)
            proved = row | {"vehicle_model_evidence": proof}
            projected = inspect(proved)
            self.assertEqual((projected[0]["brand"], projected[0]["model"]), (brand, model))
            self.assertEqual(inspect(proved, version=saved_labels_version(projected)), projected)
            with self.assertRaisesRegex(Rejected, "invalid_stored_labels_version"):
                inspect(proved, version=1)

        # A title token after e.g. "NotTesla" can resemble a real Tesla model in an older export.
        self.assertIsNone(inspect(self.row | {"marque": "Tesla", "modele": "Model 3 avec"})[0]["model"])
        self.assertEqual(inspect(self.row)[0]["model"], "208")

        tesla = self.row | {"marque": "Tesla", "modele": "Model 3"}
        proof = model_evidence("11", "Tesla", "Model 3")
        first = synthetic_row(self.observed, "12")
        for invalid in (None, [], {}, proof | {"list_id": "12"}, proof | {"list_id": 11},
                        proof | {"schema": "unknown"}, proof | {"extra": "test"}, proof | {"brand": "Dacia"},
                        proof | {"model": "Model Y"}, proof | {"model": ["Model 3"]}):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(Rejected, "invalid_vehicle_model_evidence"):
                inspect(first, tesla | {"vehicle_model_evidence": invalid})
        for brand, model in (("Tesla", "model 3"), ("Tesla", "Model 3 Grande"), ("tesla", "Model 3"),
                             ("Peugeot", "Model 3"), ("Tesla", "Model 30"), (None, None)):
            row = tesla | {"marque": brand, "modele": model, "vehicle_model_evidence": model_evidence("11", brand, model)}
            with self.subTest(brand=brand, model=model), self.assertRaisesRegex(Rejected, "invalid_vehicle_model_evidence"):
                inspect(first, row)

    def test_bound_projection_and_file_time(self):
        unknown = synthetic_row(self.observed, "12") | {"images": None, "nb_photos": None, "media": None,
                                                        "marque": "Private Firstname", "modele": "Private Lastname"}
        empty = synthetic_row(self.observed, "13") | {"images": [], "nb_photos": 0}
        self.row["media"]["observed_at"] = self.observed.strftime("%Y-%m-%dT%H:%M:%S.000000123Z")
        rows, expiry = project(json.dumps([self.row, unknown, empty]).encode(), self.exported, "file_mtime",
                               self.policy, self.now)
        self.assertEqual(rows[0]["brand"], "Peugeot")
        self.assertEqual(rows[0]["model"], "208")
        self.assertEqual(rows[0]["year"], 2018)
        self.assertEqual(rows[0]["mileage_km"], 11000)
        self.assertIsNone(rows[0]["price_amount_minor"])
        self.assertEqual(rows[0]["images"], [PHOTO])
        self.assertEqual(rows[2]["images"], [])
        self.assertIsNone(rows[1]["images"])
        self.assertIsNone(rows[1]["brand"])
        self.assertIsNone(rows[1]["model"])
        self.assertNotIn("privé", json.dumps(rows, ensure_ascii=False))
        self.assertEqual(expiry, self.observed + timedelta(days=14))
        receipt = process(self.path, self.policy_file, now=self.now)
        self.assertEqual(receipt["export_time_basis"], "file_mtime")
        self.assertEqual(receipt["exported_at"], self.exported.isoformat())
        self.assertEqual(receipt["export_sha256"], hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_rejects_mixed_identity_untrusted_media_and_expiration(self):
        for change in ({"url": self.row["url"] + "2"}, {"seller": "unknown"},
                       {"images": [PHOTO + "&token=test"]}, {"nb_photos": True},
                       {"media": self.row["media"] | {"attribution": "other"}},
                       {"media": self.row["media"] | {"observed_at": (self.now + timedelta(minutes=1)).isoformat()}},
                       {"media": self.row["media"] | {"retain_until": (self.now - timedelta(seconds=1)).isoformat()}}):
            with self.subTest(keys=list(change)), self.assertRaises(Rejected):
                project(json.dumps([self.row | change]).encode(), self.exported, "file_mtime", self.policy, self.now)
        with self.assertRaisesRegex(Rejected, "duplicate_listing_id"):
            project(json.dumps([self.row, self.row]).encode(), self.exported, "file_mtime", self.policy, self.now)
        with self.assertRaisesRegex(Rejected, "duplicate_json_field"):
            project(b'[{"index": 1, "index": 2}]', self.exported, "file_mtime", self.policy, self.now)

    def test_local_admission_boundaries(self):
        with self.assertRaisesRegex(Rejected, "export_sha256_mismatch"):
            process(self.path, self.policy_file, expected_sha256="0"*64, now=self.now)
        with self.assertRaisesRegex(Rejected, "invalid_export_date"):
            process(self.path, self.policy_file, exported_at=(self.now + timedelta(seconds=1)).isoformat(), now=self.now)
        symlink = self.directory / "symlink"
        symlink.symlink_to(self.path)
        with self.assertRaises(OSError):
            process(symlink, self.policy_file, now=self.now)
        config = synthetic_policy(self.now)
        config["revisions"][0]["state"] = "disabled"
        self.policy_file.write_text(json.dumps(config))
        with self.assertRaisesRegex(Rejected, "unavailable_private_scope"):
            process(self.path, self.policy_file, now=self.now)

    def test_contacts_hidden_in_raw_vehicle_fields_reject_whole_artifact(self):
        for key, value in (("modele", "208 / test@example.invalid"), ("boite", "VISITE HTTPS://test.invalid"),
                           ("carburant", "www.test.invalid"), ("prix", "01 02 03 04 05"),
                           ("kilometrage", "tél. +33 (0)6.01.02.03.04"), ("marque", "00336-01-02-03-04")):
            with self.subTest(key=key), self.assertRaisesRegex(Rejected, "contact_in_native_vehicle_text"):
                process_text = json.dumps([self.row | {key: value}]).encode()
                project(process_text, self.exported, "file_mtime", self.policy, self.now)
        for policy_value in ({}, {"mode": "store"}):
            config = synthetic_policy(self.now)
            config["revisions"][0]["configuration"]["policy"]["pii"] = policy_value
            self.policy_file.write_text(json.dumps(config))
            with self.assertRaisesRegex(Rejected, "invalid_private_pii_policy"):
                load_policy(self.policy_file, self.now)

    @unittest.skipUnless(os.getenv("AUTOFIND_TEST_POSTGRES_IMAGE"), "requires disposable local PostgreSQL")
    def test_concurrent_import_exact_readback_and_replay_after_mtime_change(self):
        import psycopg2
        attributes = {"fuel": "Diesel", "inspectionValid": False}
        priced = synthetic_row(self.observed, "12") | {
            "sale_price_evidence": sale_evidence("12"), "vehicle_features_evidence": feature_evidence("12", attributes),
            "marque": "Dacia", "modele": "Sandero", "vehicle_model_evidence": model_evidence("12", "Dacia", "Sandero"),
        }
        self.path.write_text(json.dumps([self.row, priced]))
        os.utime(self.path, (self.exported.timestamp(), self.exported.timestamp()))
        sock = self.directory / "socket"
        sock.mkdir()
        sock.chmod(0o777)
        container = subprocess.check_output([
            "docker", "run", "-d", "--pull", "never", "--network", "none", "--tmpfs", "/var/lib/postgresql/data",
            "-v", f"{sock}:/socket", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=autoworld",
            os.environ["AUTOFIND_TEST_POSTGRES_IMAGE"], "postgres", "-c", "listen_addresses=",
            "-c", "unix_socket_directories=/var/run/postgresql,/socket",
        ], text=True).strip()
        self.addCleanup(subprocess.run, ["docker", "rm", "-fv", container], check=True, stdout=subprocess.DEVNULL)
        for _ in range(150):
            if (sock / ".s.PGSQL.5432").exists() and not subprocess.run([
                "docker", "exec", container, "sh", "-ec", 'test "$(cat /proc/1/comm)" = postgres && pg_isready -q -h /socket -U postgres'
            ], capture_output=True).returncode:
                break
            time.sleep(.1)
        else:
            self.fail("PostgreSQL startup timeout")
        with closing(psycopg2.connect(host=str(sock), user="postgres", dbname="autoworld")) as db, db, db.cursor() as cur:
            cur.execute("""
                CREATE SCHEMA aw_acquisition_trial;
                CREATE TABLE aw_acquisition_trial.metadata (key text PRIMARY KEY, value text NOT NULL);
                INSERT INTO aw_acquisition_trial.metadata VALUES ('schema',
                  'leboncoin-private-trial/v1:6c83f9f0e4b4f482352aa9d3015782e51029e0483bb3514319a77c90bf07a495');
            """)
            cur.execute(MIGRATION.read_text())
            cur.execute("""
                CREATE ROLE fixture_writer LOGIN;
                GRANT USAGE ON SCHEMA aw_acquisition_trial TO fixture_writer;
                GRANT INSERT,SELECT ON aw_acquisition_trial.rust_exports TO fixture_writer;
            """)
        config = self.directory / "pg_service.conf"
        config.write_text(f"[{SERVICE}]\nhost={sock}\nuser=fixture_writer\ndbname=autoworld\n")
        with patch.dict(os.environ, PGSERVICEFILE=str(config)):
            def run(_):
                return process(self.path, self.policy_file, service=SERVICE)
            with ThreadPoolExecutor(max_workers=2) as pool:
                receipts = list(pool.map(run, range(2)))
            self.assertEqual(sorted(r["status"] for r in receipts), ["already_imported", "inserted"])
            # Copying/touching an archive cannot refresh its first accepted timestamps.
            later = self.now + timedelta(days=7)
            os.utime(self.path, (later.timestamp(), later.timestamp()))
            replay = run(1)
            self.assertEqual(replay["exported_at"], self.exported.isoformat())
            self.assertEqual(replay["retain_until"], receipts[0]["retain_until"])
            with self.assertRaisesRegex(Rejected, "conflicting_export_date"):
                process(self.path, self.policy_file, service=SERVICE, exported_at=later.isoformat())
        with closing(psycopg2.connect(host=str(sock), user="postgres", dbname="autoworld")) as db, db, db.cursor() as cur:
            cur.execute("SELECT raw_bytes FROM aw_acquisition_trial.rust_exports")
            self.assertEqual([bytes(r[0]) for r in cur], [self.path.read_bytes()])
            cur.execute("SELECT source_listing_id, model, images, price_amount_minor FROM aw_acquisition_trial.rust_export_listings ORDER BY 1")
            self.assertEqual(cur.fetchall(), [("11", "208", [PHOTO], None), ("12", "Sandero", [PHOTO], 1295000)])
            cur.execute("SELECT listings FROM aw_acquisition_trial.rust_exports")
            archived = cur.fetchone()[0]
            self.assertEqual(saved_labels_version(archived), 2)
            self.assertEqual(archived[1]["vehicle_features"], attributes)
            self.assertNotIn("vehicle_features", archived[0])

            # An original archive keeps its model and its timestamps, even when the newer
            # vocabulary now recognizes that model and the local copy has been touched.
            historical = synthetic_row(self.observed, "13") | {"marque": "Tesla", "modele": "Model 3 Long Range"}
            raw = json.dumps([historical]).encode()
            rows, expiry = project(raw, self.exported, "file_mtime", self.policy, self.now, labels_version=1)
            self.assertIsNone(rows[0]["model"])
            self.assertNotIn("vehicle_labels_version", rows[0])
            legacy_hash = hashlib.sha256(raw).hexdigest()
            cur.execute("""INSERT INTO aw_acquisition_trial.rust_exports
                               (export_sha256,raw_bytes,exported_at,retain_until,row_count,listings)
                           VALUES (%s,%s,%s,%s,1,%s)""",
                        (legacy_hash, raw, self.exported, expiry, json.dumps(rows)))
        self.path.write_bytes(raw)
        os.utime(self.path, (later.timestamp(), later.timestamp()))
        with patch.dict(os.environ, PGSERVICEFILE=str(config)):
            receipt = process(self.path, self.policy_file, service=SERVICE)
        self.assertEqual(receipt["status"], "already_imported")
        self.assertEqual(receipt["exported_at"], self.exported.isoformat())
        self.assertEqual(receipt["retain_until"], expiry.isoformat())
        with closing(psycopg2.connect(host=str(sock), user="postgres", dbname="autoworld")) as db, db, db.cursor() as cur:
            cur.execute("SELECT raw_bytes,listings FROM aw_acquisition_trial.rust_exports WHERE export_sha256=%s",
                        (legacy_hash,))
            stored_bytes, stored_rows = cur.fetchone()
            self.assertEqual(bytes(stored_bytes), raw)
            self.assertEqual(stored_rows, rows)


if __name__ == "__main__":
    unittest.main()
