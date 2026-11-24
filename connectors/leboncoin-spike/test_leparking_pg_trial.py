import json
import unittest
from unittest.mock import patch

from leparking_pg_trial import KAGGLE_DATASET, KAGGLE, canonical_rows, import_trial, pg_json


def card(source_id="ABCD1234", **changes):
    row = {"source": "leparking", "source_id": source_id,
           "source_url": f"https://www.leparking.fr/voiture-occasion-detail/marque-modele/titre/{source_id}.html",
           "title": "Voiture d'essai", "price_eur": 17300, "year": 2020, "mileage_km": 41000}
    return row | changes


def parking(*rows):
    return {"format": "leparking-html", "complete_unique": len(rows), "rows": list(rows)}


class TrialTests(unittest.TestCase):
    def test_importable_identity_and_sorting(self):
        redirect = "https://www.leparking.fr/tools/ABCD1234/0/D/P.html"
        rows = canonical_rows(parking(card("ZZZZ1111"), card(source_url=redirect)), "fixture", 2)
        self.assertEqual([r["source_id"] for r in rows], ["ABCD1234", "ZZZZ1111"])
        self.assertEqual((rows[0]["currency"], rows[0]["distance_unit"]), ("EUR", "km"))
        self.assertEqual(rows[0]["source_locator"], redirect)

    def test_invalid_rows_cannot_reach_postgres(self):
        for change in [{"source": "other"}, {"source_id": "X"}, {"source_url": "https://example.com/"},
                       {"source_url": "/voiture-occasion-detail/m/m/ABCD1234.html"},
                       {"source_url": card("EFGH5678")["source_url"]}, {"source_id": None},
                       {"price_eur": True}, {"price_eur": 0}, {"mileage_km": -1}, {"year": "2021"},
                       {"title": "  "}, {"title": "a\x00b"}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                canonical_rows(parking(card(**change)), "fixture", 1)

    def test_duplicates_inconsistent_counts_and_provenance(self):
        with self.assertRaises(ValueError):
            canonical_rows(parking(card(), card()), "authorized-export", 2)
        for payload, provenance, expected in [(parking(card()), "open-dataset", 1),
                (parking(card()), "fixture", 2), (parking(card()) | {"complete_unique": True}, "fixture", 1)]:
            with self.assertRaises(ValueError):
                canonical_rows(payload, provenance, expected)

    def test_dataset_records_keep_units_and_locator_distinct(self):
        item = {"source": KAGGLE, "source_id": "audi.csv:42", "source_url": KAGGLE_DATASET,
                "title": "Audi A3", "price_gbp": 6000, "mileage_miles": 30000, "year": 2015}
        payload = {"format": KAGGLE, "complete_unique": 1, "rows": [item]}
        row, = canonical_rows(payload, "open-dataset", 1)
        self.assertEqual([row[k] for k in ("currency", "distance_unit", "source_locator", "source_id")],
                         ["GBP", "mi", KAGGLE_DATASET, "audi.csv:42"])
        with self.assertRaises(ValueError):
            canonical_rows(payload, "fixture", 1)
        with self.assertRaises(ValueError):
            canonical_rows(payload | {"rows": [item | {"source_id": "audi.csv:1"}]}, "open-dataset", 1)

    def test_external_strings_stay_in_the_hex_payload(self):
        external = "x'); SELECT 1; --" + chr(92)
        self.assertNotIn(external, pg_json({"title": external}))

    def test_bad_database_identifier_is_rejected_without_psql(self):
        rows = canonical_rows(parking(card()), "fixture", 1)
        with patch("leparking_pg_trial.psql") as sql:
            with self.assertRaises(ValueError):
                import_trial("postgresql://host/db", "fixture", rows)
            sql.assert_not_called()

    def test_separate_readback_matches_every_field(self):
        rows = canonical_rows(parking(card()), "fixture", 1)
        with patch("leparking_pg_trial.psql", side_effect=["1", json.dumps(rows)]) as sql:
            receipt = import_trial("test_db", "fixture", rows)
        self.assertEqual(sql.call_count, 2)
        self.assertEqual((receipt["newly_inserted"], receipt["verified_rows"]), (1, 1))
        with patch("leparking_pg_trial.psql", side_effect=["0", json.dumps([rows[0] | {"price": 700}])]):
            with self.assertRaisesRegex(RuntimeError, "commit succeeded"):
                import_trial("test_db", "fixture", rows)


if __name__ == "__main__":
    unittest.main()
