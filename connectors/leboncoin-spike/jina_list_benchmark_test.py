#!/usr/bin/env python3
"""Offline checks; no network or Jina credentials required."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jina_verification_diagnostic import diagnostics

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
        self.assertEqual(result["stop_reason"], "verification_signal")

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

    def test_generic_keyword_is_not_proof_of_captcha(self):
        user_content = "Le vendeur parle du mot captcha, mais la voiture est bien affichée"
        sample = ONE + "\n" + user_content
        evidence = diagnostics(sample, m.parse_page, 200)
        self.assertEqual(evidence["classification"], "keyword_only")
        self.assertEqual(evidence["rule_names"], ["generic_captcha_word"])
        self.assertEqual(evidence["vehicle_patterns_in_same_response"], 1)
        self.assertEqual(evidence["vehicle_links_in_same_response"], 1)
        self.assertFalse(evidence["verification_form_possible"])
        self.assertNotIn(user_content, json.dumps(evidence, ensure_ascii=False))

    def test_explicit_human_challenge_diagnosed(self):
        sample = "<html>DataDome Device Check. Verify that you are human.</html>"
        evidence = diagnostics(sample, m.parse_page, 200)
        self.assertEqual(evidence["classification"], "explicit_challenge")
        self.assertIn("human_verification", evidence["rule_names"])
        self.assertIn("challenge_widget", evidence["rule_names"])
        self.assertEqual(evidence["vehicle_patterns_in_same_response"], 0)

    def test_iframe_form_captcha_is_possible_challenge(self):
        sample = '<form action="/verify"><iframe src="/captcha"></iframe></form>'
        evidence = diagnostics(sample, m.parse_page, 200)
        self.assertEqual(evidence["classification"], "possible_challenge")
        self.assertTrue(evidence["verification_form_possible"])
        self.assertTrue(evidence["verification_iframe_possible"])

    def test_no_signal_and_http_failure(self):
        self.assertEqual(diagnostics(ONE, m.parse_page, 200)["classification"], "no_signal")
        self.assertEqual(diagnostics("Forbidden", m.parse_page, 403)["classification"], "http_failure")

    def test_card_detected_even_when_generic_keyword_stops(self):
        report = m.execute(lambda page: (200, ONE + "\nle mot captcha apparaît"), max_pages=2)
        self.assertEqual(report["stop_reason"], "verification_signal")
        self.assertEqual(report["total_requests"], 1)
        diag = report["per_page"][0]["diagnosis"]
        self.assertEqual(diag["vehicle_patterns_in_same_response"], 1)
        self.assertEqual(diag["classification"], "keyword_only")

    def test_report_does_not_leak_seller_info(self):
        seller = "0611223344 vendeur@example.test"
        diag = diagnostics(ONE + "\n" + seller + " captcha", m.parse_page, 200)
        payload = json.dumps(diag)
        self.assertNotIn(seller, payload)
        self.assertNotIn("vendeur@example.test", payload)
        self.assertNotIn("0611223344", payload)
        self.assertNotIn("3305814470", payload)
        self.assertTrue(diag["body_text_persisted"] is False)


    def test_labelled_price_formats(self):
        for line in ("Prix: 12 490 €", "Prix : 12 490 €", "Prix : 12\u202f490 €"):
            with self.subTest(line=line):
                self.assertEqual(m.price_eur(line), 12490)
                card = TWO.replace("6 200 €", line)
                result = m.parse_page(card)
                self.assertTrue(result["cards"][0]["complete"])
                self.assertEqual(result["cards"][0]["key"], "id:3305814471")

    def test_only_total_price_not_monthly_or_incidental_amount(self):
        for line in ("Prix : 250 €/mois", "Prix: 250 € par mois", "Dès 250 €",
                     "Mensualité : 250 €", "Frais de dossier : 250 €"):
            self.assertIsNone(m.price_eur(line), line)
        sample = TWO.replace("6 200 €", "Prix : 6 200 €\nDès 250 €/mois")
        self.assertTrue(m.parse_page(sample)["cards"][0]["complete"])

    def test_short_title_only_with_explicit_card_link(self):
        for title in ("Twingo", "Golf", "C3", "A3", "208"):
            with self.subTest(title=title):
                card = TWO.replace("Renault Megane DCI", title)
                r = m.parse_page(card)
                self.assertTrue(r["cards"][0]["complete"])
                self.assertEqual(r["cards"][0]["key"], "id:3305814471")
        plain = "Twingo\n6 200 €\n·2015·180000 km·Diesel"
        self.assertFalse(m.parse_page(plain)["cards"][0]["complete"])

    def test_linked_title_is_preferred_over_metadata(self):
        body = TWO.replace("6 200 €", "Véhicule garanti\nPrix : 6 200 €")
        captured = []
        original = m.digest
        def spy(value):
            captured.append(value)
            return original(value)
        with patch.object(m, "digest", side_effect=spy):
            r = m.parse_page(body)
        self.assertTrue(r["cards"][0]["complete"])
        self.assertEqual(captured, [m.normalize("Renault Megane DCI") + "|6200|2015|180000"])

    def test_duplicate_equal_prices_accepted_conflicting_prices_rejected(self):
        repeated = TWO.replace("6 200 €", "6 200 €\nPrix : 6 200 €")
        conflict = TWO.replace("6 200 €", "6 200 €\nPrix : 8 300 €")
        self.assertTrue(m.parse_page(repeated)["cards"][0]["complete"])
        self.assertFalse(m.parse_page(conflict)["cards"][0]["complete"])

    def test_missing_price_does_not_borrow_previous_card_amount(self):
        body = ONE + "\nPrix : 12 490 €\n" + TWO.replace("6 200 €", "Prix indisponible")
        cards = m.parse_page(body)["cards"]
        self.assertEqual(len(cards), 2)
        self.assertTrue(cards[0]["complete"])
        self.assertFalse(cards[1]["complete"])

    def test_empty_or_generic_link_is_not_title(self):
        for label in ("", "Diesel", "Détails", "En savoir plus", "Photo"):
            body = TWO.replace("Renault Megane DCI", label).replace("6 200 €", "Garantie incluse\n6 200 €")
            self.assertFalse(m.parse_page(body)["cards"][0]["complete"], label)

    def test_conflicting_linked_titles_are_rejected(self):
        body = "### [Autre voiture](https://www.leboncoin.fr/ad/voitures/3305814479)\n" + TWO
        self.assertFalse(m.parse_page(body)["cards"][0]["complete"])


if __name__ == "__main__":
    unittest.main()
