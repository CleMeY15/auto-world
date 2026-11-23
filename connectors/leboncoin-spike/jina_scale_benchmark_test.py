#!/usr/bin/env python3
"""Offline regression tests for the one-shot Jina volume benchmark."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SRC = Path(__file__).with_name("jina-scale-benchmark.py")
spec = importlib.util.spec_from_file_location("autofindex_jina_scale", SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
CAR_URL = "https://www.leboncoin.fr/ad/voitures/3305814470"
GOOD = "Porsche 911 Carrera 2021 23 000 km 146 990 €"


class JinaScaleTests(unittest.TestCase):
    def test_limit_and_minimum_gap(self):
        self.assertEqual(mod.base.CAP, 500)
        self.assertEqual(mod.base.GAP, 10)
        self.assertEqual(mod.base.BUDGET_SECONDS, 180 * 60)

    def test_complete_means_hints_only(self):
        outcome, hints = mod.classify_checked(GOOD, 200)
        self.assertEqual(outcome, "complete")
        self.assertTrue(all(hints.values()))

    def test_http_503_not_missing_data(self):
        outcome, _ = mod.classify_checked("Service unavailable", 503)
        self.assertEqual(outcome, "server_error")

    def test_http_403_and_429_refused(self):
        for code in (403, 429):
            outcome, _ = mod.classify_checked(GOOD, code)
            self.assertEqual(outcome, "refused")

    def test_http_200_challenge(self):
        outcome, _ = mod.classify_checked("DataDome Device Check: You have been blocked", 200)
        self.assertEqual(outcome, "verification")

    def test_missing_http_200_hints(self):
        outcome, _ = mod.classify_checked("No vehicle data here", 200)
        self.assertEqual(outcome, "no_vehicle_data")

    def test_stop_after_three_consecutive_server_errors(self):
        b = mod.ScaleBench([CAR_URL])
        for index in range(3):
            b.add(CAR_URL, "server_error", 503, {}, "server error " + str(index))
        self.assertEqual(b.reason, "server_errors_limit")
        self.assertFalse(b.ready())

    def test_stop_after_cluster_of_invalid_http_200(self):
        b = mod.ScaleBench([CAR_URL])
        for index in range(20):
            b.add(CAR_URL, "no_vehicle_data", 200, {}, "empty result " + str(index))
        self.assertEqual(b.reason, "non_vehicle_response_spike")
        self.assertFalse(b.ready())

    def test_repeat_content_detected(self):
        b = mod.ScaleBench([CAR_URL])
        b.add(CAR_URL, "complete", 200, {}, GOOD)
        b.add(CAR_URL, "complete", 200, {}, GOOD)
        self.assertEqual(b.duplicate_body_count, 1)
        self.assertEqual(len(b.unique_body_hashes), 1)

    def test_never_persist_private_seller_data(self):
        b = mod.ScaleBench([CAR_URL])
        private_text = "seller@example.test 0611223344"
        b.add(CAR_URL, "no_vehicle_data", 200, {}, private_text)
        with tempfile.TemporaryDirectory() as out:
            r = b.output(out)
            data = Path(out, "jina-500.json").read_text(encoding="utf-8")
            self.assertNotIn(private_text, data)
            self.assertNotIn(CAR_URL, data)
            self.assertFalse(r["source_access_approved"])
            self.assertFalse(r["database_updated"])
            self.assertTrue(r["success_counts_are_heuristic_hints"])


if __name__ == "__main__":
    unittest.main()
