#!/usr/bin/env python3
"""Offline checks; no network or Jina credentials required."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

file = Path(__file__).with_name("jina-list-benchmark.py")
spec = importlib.util.spec_from_file_location("jina_list_benchmark", file)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

ONE = """# Résultats de recherche voitures
### [Peugeot 308 1.6 HDi](https://www.leboncoin.fr/ad/voitures/3305814470)
12 490 €
Prix: 12 490 €
Vendeur professionnel
·2018·120000 km·Diesel·Manuelle
Année: "2018". Kilométrage: "120000 km"
"""
TWO = """### [Renault Megane DCI](https://www.leboncoin.fr/ad/voitures/3305814471)
6 200 €
Prix: 6 200 €
·2015·180000 km·Diesel·Manuelle
"""


class Tests(unittest.TestCase):
    def test_parse_two_cards(self):
        p = m.parse_page(ONE + "\n" + TWO)
        self.assertEqual(p["raw_vehicle_patterns"], 2)
        self.assertEqual(len(p["cards"]), 2)
        self.assertTrue(all(c["complete"] for c in p["cards"]))
        self.assertEqual(p["direct_vehicle_links_in_page"], 2)

    def test_no_false_complete_when_year_not_in_card(self):
        p = m.parse_page("Peugeot 308\nPas de prix\n·2018·120000 km·Diesel")
        self.assertEqual(len(p["cards"]), 1)
        self.assertFalse(p["cards"][0]["complete"])

    def test_dedup_two_pages(self):
        with patch.object(m.time, "sleep", return_value=None):
            result = m.execute(lambda p: (200, ONE if p == 1 else ONE + TWO), max_pages=2)
        self.assertEqual(result["total_requests"], 2)
        self.assertEqual(result["unique_search_cards_estimated"], 2)
        self.assertEqual(result["stop_reason"], "maximum_pages_reached")
        self.assertFalse(result["database_updated"])

    def test_stop_on_first_page_without_cars(self):
        result = m.execute(lambda page: (200, "Résultats indisponibles"), max_pages=3)
        self.assertEqual(result["total_requests"], 1)
        self.assertEqual(result["stop_reason"], "no_cards_on_first_page")

    def test_stop_on_blocked_html200(self):
        result = m.execute(lambda page: (200, "DataDome captcha verify that you are human"))
        self.assertEqual(result["stop_reason"], "verification")

    def test_stop_on_http403_and_429(self):
        for code in (403, 429):
            result = m.execute(lambda page: (code, "not allowed"))
            self.assertEqual(result["stop_reason"], "refused")
            self.assertEqual(result["unique_search_cards_estimated"], 0)

    def test_stop_on_timeout_without_retry(self):
        count = [0]
        def fake(page):
            count[0] += 1
            raise TimeoutError("timed out")
        report = m.execute(fake)
        self.assertEqual(count[0], 1)
        self.assertEqual(report["stop_reason"], "network_or_timeout_error")
        self.assertEqual(report["per_page"][0]["exception_type"], "TimeoutError")

    def test_no_duplicate_page_growth(self):
        with patch.object(m.time, "sleep", return_value=None):
            report = m.execute(lambda page: (200, ONE), max_pages=5)
        self.assertEqual(report["stop_reason"], "no_new_cards_on_two_pages")
        self.assertEqual(report["total_requests"], 3)
        self.assertEqual(report["unique_search_cards_estimated"], 1)


if __name__ == "__main__":
    unittest.main()
