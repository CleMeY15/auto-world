#!/usr/bin/env python3
"""Offline storage tests; all vehicle data below is fabricated."""

import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest


DIRECTORY = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("batch_store", DIRECTORY / "batch-store.py")
STORE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STORE)

FIXTURE_JS = """
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { extractLeboncoinDomObservation } = await import(pathToFileURL(process.argv[1]).href);
const input = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(input.map(observation => {
  const observation_json = JSON.stringify(observation);
  const id = new URL(observation.url).pathname.split('/').at(-1);
  return { observation, observation_json, capture_sha256: 'a'.repeat(64),
    normalized: extractLeboncoinDomObservation(Buffer.from(observation_json, 'utf8'),
      { expectedUrl: observation.url, expectedListingId: id }) };
})));
"""


def observations(count=1, offset=0, title="Véhicule de test — données fictives", captured_at="2026-11-22T18:00:00.000Z"):
    values = []
    for index in range(count):
        url = "https://www.leboncoin.fr/ad/voitures/" + str(9000000000 + offset + index)
        values.append({
            "schema_version": "leboncoin-dom-observation/v1", "acquisition": "own_playwright_dom",
            "captured_at": captured_at, "requested_url": url, "url": url,
            "titles": [title], "prices": ["12 345,67 €"], "location": [], "times": [], "photos": [],
            "criteria": [
                {"key": "mileage", "label": "Kilométrage", "value": "23 000 km"},
                {"key": "u_car_brand", "label": "Marque", "value": "Marque fictive"},
                {"key": "u_car_model", "label": "Modèle", "value": "Modèle fictif"},
                {"key": "regdate", "label": "Année modèle", "value": "2021"},
            ],
        })
    return values


def entries(**kwargs):
    result = subprocess.run(["node", "--input-type=module", "-e", FIXTURE_JS, str(DIRECTORY / "extract.mjs")],
                            input=json.dumps(observations(**kwargs), ensure_ascii=False).encode("utf-8"),
                            capture_output=True, check=True, timeout=30)
    return json.loads(result.stdout)


def bundle(items, batch_id="1" * 32):
    count = len(items)
    return {"schema_version": "leboncoin-batch-bundle/v1", "batch_id": batch_id,
            "source_revision": "2" * 40, "run_id": "1234567890", "plan_sha256": "3" * 64,
            "created_at": "2026-11-22T19:00:00.000Z",
            "summary": {"discovered": count, "attempted": count, "complete": count, "partial": 0,
                        "rejected": 0, "stored": 0, "status": "completed", "stop_reason": None},
            "entries": items}


class BatchStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures = entries(count=3)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="aw-batch-store-test-")
        self.root = Path(self.directory.name)
        self.output = self.root / "private"
        self.input = self.root / "bundle.json"

    def tearDown(self):
        self.directory.cleanup()

    def write_bundle(self, value):
        self.input.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return self.input

    def run_import(self, value):
        return STORE.import_bundle(self.write_bundle(value), self.output)

    def rows(self, query, parameters=()):
        with sqlite3.connect(self.output / "trial.sqlite3") as connection:
            return connection.execute(query, parameters).fetchall()

    def reject(self, value, code):
        with self.assertRaisesRegex(STORE.ImportRejected, "^" + code + "$"):
            self.run_import(value)

    def test_real_sqlite_roundtrip_exact_raw_and_idempotent_replay(self):
        value = bundle(copy.deepcopy(self.fixtures[:2]))
        first = self.run_import(value)
        self.assertEqual((first["stored"], first["new_observations"], first["total_unique_listings"]), (2, 2, 2))
        self.assertFalse(first["project_database_updated"])
        second = self.run_import(value)
        self.assertEqual(second["new_observations"], 0)
        self.assertTrue(second["replayed"])
        self.assertEqual(self.rows("SELECT count(*) FROM observations"), [(2,)])
        for item in value["entries"]:
            raw = self.rows("SELECT raw_bytes FROM raw_observations WHERE observation_sha256=?",
                            (item["normalized"]["observation_sha256"],))[0][0]
            self.assertEqual(raw, item["observation_json"].encode("utf-8"))
        exported = [json.loads(line) for line in (self.output / "normalized.jsonl").read_text().splitlines()]
        self.assertEqual(exported, [item["normalized"] for item in value["entries"]])

    def test_later_observation_appends_history_without_duplicate_listing(self):
        self.run_import(bundle(copy.deepcopy(self.fixtures[:1])))
        later = entries(captured_at="2026-11-22T18:30:00.000Z")
        result = self.run_import(bundle(later, "4" * 32))
        self.assertEqual((result["total_observations"], result["total_unique_listings"]), (2, 1))
        self.assertEqual(self.rows("SELECT captured_at FROM latest_listings"), [("2026-11-22T18:30:00.000Z",)])
        self.assertEqual(self.rows("SELECT count(*) FROM batches"), [(2,)])

    def test_same_batch_identifier_changed_content_rejected(self):
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        self.run_import(value)
        before = (self.output / "import.sql").read_bytes()
        value["plan_sha256"] = "f" * 64
        self.reject(value, "batch_identity_conflict")
        self.assertEqual(self.rows("SELECT count(*) FROM observations"), [(1,)])
        self.assertEqual(before, (self.output / "import.sql").read_bytes())

    def test_database_failure_rolls_back_whole_batch(self):
        self.run_import(bundle(copy.deepcopy(self.fixtures[:1])))
        rejected_id = self.fixtures[2]["normalized"]["source"]["listing_id"]
        with sqlite3.connect(self.output / "trial.sqlite3") as connection:
            connection.execute("CREATE TRIGGER test_reject BEFORE INSERT ON raw_observations "
                               "WHEN NEW.source_listing_id='" + rejected_id + "' "
                               "BEGIN SELECT RAISE(ABORT,'test_failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.run_import(bundle(copy.deepcopy(self.fixtures[1:]), "4" * 32))
        self.assertEqual(self.rows("SELECT count(*) FROM batches"), [(1,)])
        self.assertEqual(self.rows("SELECT count(*) FROM raw_observations"), [(1,)])
        self.assertEqual(self.rows("SELECT count(*) FROM observations"), [(1,)])
        self.assertEqual(self.rows("SELECT count(*) FROM batch_entries"), [(1,)])

    def test_duplicate_listing_in_bundle_rejected(self):
        value = bundle([copy.deepcopy(self.fixtures[0]), copy.deepcopy(self.fixtures[0])])
        self.reject(value, "duplicate_listing")
        self.assertFalse(self.output.exists())

    def test_observation_digest_must_match_exact_utf8_bytes(self):
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["entries"][0]["normalized"]["observation_sha256"] = "f" * 64
        self.reject(value, "observation_hash_mismatch")
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["entries"][0]["observation_json"] += "\n"
        self.reject(value, "observation_hash_mismatch")

    def test_observation_object_must_equal_exact_json(self):
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["entries"][0]["observation"]["prices"] = ["1 €"]
        self.reject(value, "observation_json_mismatch")

    def test_normalized_source_identity_must_match_url(self):
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["entries"][0]["normalized"]["source"]["listing_id"] = "123"
        self.reject(value, "listing_identity_mismatch")

    def test_existing_normalizer_replay_rejects_value_tampering(self):
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["entries"][0]["normalized"]["fields"]["price"]["value"]["amountMinor"] += 1
        self.reject(value, "normalizer_replay_mismatch")

    def test_incomplete_normalized_entry_is_not_stored(self):
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["entries"][0]["normalized"]["core_fields_observed"] = False
        self.reject(value, "incomplete_normalized_entry")
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["entries"][0]["normalized"]["fields"]["model_year"] = {"status": "not_observed"}
        self.reject(value, "incomplete_normalized_entry")

    def test_summary_must_be_closed_and_preimport_counts_honest(self):
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["summary"]["url"] = "private listing data"
        self.reject(value, "invalid_summary")
        value = bundle(copy.deepcopy(self.fixtures[:1]))
        value["summary"]["stored"] = 1
        self.reject(value, "summary_count_mismatch")
        value["summary"]["stored"] = 0
        value["summary"]["attempted"] = 0
        self.reject(value, "summary_count_mismatch")
        value["summary"]["attempted"] = True
        self.reject(value, "invalid_summary")

    def test_empty_failed_collection_is_explicit_zero_not_successful_acquisition(self):
        value = bundle([])
        value["summary"].update(status="stopped", stop_reason="access_refused")
        result = self.run_import(value)
        self.assertEqual((result["stored"], result["total_observations"], result["total_unique_listings"]), (0, 0, 0))
        self.assertFalse(result["project_database_updated"])
        self.assertEqual(self.rows("SELECT count(*) FROM observations"), [(0,)])

    def test_at_most_100_distinct_listings(self):
        self.reject(bundle([copy.deepcopy(self.fixtures[0])] * 101), "entry_limit")
        result = self.run_import(bundle(entries(count=100)))
        self.assertEqual(result["stored"], 100)
        self.assertEqual(self.rows("SELECT count(DISTINCT source_listing_id) FROM raw_observations"), [(100,)])

    def test_sql_export_encodes_injection_payload_as_data(self):
        payload = "Test '; DROP SCHEMA aw_connector CASCADE; --\n\\! unsafe-command\nÉlectricité"
        item = entries(title=payload)[0]
        self.run_import(bundle([item]))
        sql = (self.output / "import.sql").read_text(encoding="utf-8")
        self.assertNotIn(payload, sql)
        self.assertNotIn("DROP SCHEMA aw_connector", sql)
        self.assertNotIn("\\! unsafe-command", sql)
        self.assertIn(item["observation_json"].encode("utf-8").hex(), sql)
        self.assertIn("\\set ON_ERROR_STOP on\n", sql)
        self.assertIn("current_database()<>'autoworld'", sql)
        self.assertIn("BEGIN;", sql)
        self.assertIn("COMMIT;", sql)
        self.assertIn("batch_identity_conflict", sql)
        self.assertIn("stored_observation_conflict", sql)
        self.assertEqual(self.rows("SELECT count(*) FROM observations"), [(1,)])

    def test_private_output_permissions(self):
        self.run_import(bundle(copy.deepcopy(self.fixtures[:1])))
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        for name in ("trial.sqlite3", "normalized.jsonl", "import.sql", "import-receipt.json"):
            self.assertEqual(stat.S_IMODE((self.output / name).stat().st_mode), 0o600)

    def test_output_symlink_rejected(self):
        outside = self.root / "outside"
        outside.mkdir()
        self.output.symlink_to(outside, target_is_directory=True)
        self.reject(bundle(copy.deepcopy(self.fixtures[:1])), "unsafe_output_directory")
        self.assertEqual(list(outside.iterdir()), [])

    def test_unrelated_database_is_not_modified(self):
        self.output.mkdir()
        with sqlite3.connect(self.output / "trial.sqlite3") as connection:
            connection.execute("CREATE TABLE independent(value TEXT)")
            connection.execute("INSERT INTO independent VALUES('keep')")
        self.reject(bundle(copy.deepcopy(self.fixtures[:1])), "unrecognized_preparation_database")
        self.assertEqual(self.rows("SELECT value FROM independent"), [("keep",)])

    def test_invalid_json_duplicate_keys_rejected(self):
        self.input.write_text('{"schema_version":1,"schema_version":2}', encoding="utf-8")
        with self.assertRaisesRegex(STORE.ImportRejected, "^duplicate_json_key$"):
            STORE.import_bundle(self.input, self.output)

    def test_cli_failure_does_not_echo_private_paths_or_payloads(self):
        private = self.root / "private-unavailable-input.json"
        result = subprocess.run([sys.executable, str(DIRECTORY / "batch-store.py"), "--bundle", str(private),
                                 "--out-dir", str(self.output)], capture_output=True, text=True, check=False, timeout=15)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout)["code"], "private_import_failed")
        self.assertNotIn(str(private), result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
