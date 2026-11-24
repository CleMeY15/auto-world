"""Row evidence from local Markdown copies of Leboncoin search pages."""
import unittest
from unittest.mock import patch

from jina_list_benchmark_test import ONE, TWO, m
from jina_offline_500_validation import render, truth


class SavedRowsTests(unittest.TestCase):
    def rows(self, markdown):
        with patch("urllib.request.urlopen", side_effect=AssertionError("No network")):
            return m.parse_page(markdown, include_linked_rows=True)

    def test_aggregate_contract_stays_redacted(self):
        default = m.parse_page(ONE)
        self.assertNotIn("rows", default)
        self.assertNotIn("row_issues", default)
        self.assertNotIn("Peugeot", repr(default))

    def test_all_fields_and_canonical_url(self):
        relative = ONE.replace("https://www.leboncoin.fr", "").replace("3305814470)", "3305814470?x=1#top)")
        result = self.rows(relative)
        self.assertEqual(result["row_issues"], {})
        self.assertEqual(result["rows"], [{
            "source": "leboncoin", "source_id": "3305814470",
            "source_url": "https://www.leboncoin.fr/ad/voitures/3305814470",
            "title": "Peugeot 308 1.6 HDi", "price_eur": 12490, "year": 2018,
            "mileage_km": 120000,
        }])

    def test_missing_or_unrelated_link_never_identifies_a_row(self):
        for title in ["Peugeot 308 HDi",
                      "[Peugeot 308 HDi](https://example.org/ad/voitures/3305814470)",
                      "[Peugeot 308 HDi](https://www.leboncoin.fr.example.org/ad/voitures/3305814470)"]:
            body = title + "\n12 000 €\n·2018·30 000 km"
            with self.subTest(title=title):
                self.assertEqual(self.rows(body)["rows"], [])
                self.assertEqual(self.rows(body)["row_issues"], {"no_linked_title": 1})

    def test_ambiguous_price_link_and_mileage(self):
        for body, reason in [
            (TWO.replace("6 200 €\n", "6 200 €\nPrix : 7 400 €\n"), "missing_or_conflicting_price"),
            (TWO.replace("6 200 €\n", "/ad/voitures/3305814479\n6 200 €\n"), "conflicting_listing_links"),
            (TWO.replace("6 200 €\n", "### Autre annonce\n6 200 €\n"), "ambiguous_card_boundary"),
            (TWO.replace("180000", "18,0"), "invalid_mileage_format"),
            (TWO.replace("180000", "2 500 100"), "mileage_out_of_range"),
        ]:
            with self.subTest(reason=reason):
                result = self.rows(body)
                self.assertEqual(result["rows"], [])
                self.assertEqual(result["row_issues"], {reason: 1})

    def test_keep_divergent_observations_of_same_id_for_reconciliation(self):
        result = self.rows(TWO + TWO.replace("6 200 €", "7 550 €"))
        self.assertEqual([row["price_eur"] for row in result["rows"]], [6200, 7550])
        self.assertEqual(len({row["source_id"] for row in result["rows"]}), 1)

    def test_adjacent_unlinked_ad_with_only_one_price_is_never_borrowed(self):
        anchor = "### [Peugeot 308](https://www.leboncoin.fr/ad/voitures/3305814470)"
        for second_title in ("Renault Clio", "208", "**Audi A3**", "Renault à 250 €/mois",
                             "208 à 250 €/mois", "---", "![Autre voiture](/image.jpg)"):
            for prices in [("", "8 300 €"), ("8 300 €", ""), ("8 300 €", "8 300 €")]:
                result = self.rows("\n".join([anchor, prices[0], second_title, prices[1],
                                              "·2020·71 000 km·Diesel"]))
                self.assertEqual(result["rows"], [], (second_title, prices))
                self.assertEqual(result["row_issues"], {"ambiguous_card_boundary": 1})

    def test_existing_500_reference_rows_including_repeated_observations(self):
        expected = {truth(i)["id"]: truth(i) for i in range(500)}
        records = list(expected.values())
        observed = {}
        count = 0
        for start in range(0, len(records), 35):
            page = records[max(0, start - 5):start + 35]
            result = self.rows("\n\n".join(render(row) for row in page))
            self.assertFalse(result["row_issues"])
            for row in result["rows"]:
                reference = expected[row["source_id"]]
                self.assertEqual((row["title"], row["price_eur"], row["year"], row["mileage_km"]),
                                 (reference["title"], reference["price"], reference["year"], reference["mileage"]))
                self.assertEqual(row["source_url"].rsplit("/", 1)[-1], row["source_id"])
                count += 1
                observed[row["source_id"]] = row
        self.assertEqual(count, 570)
        self.assertEqual(set(observed), set(expected))


if __name__ == "__main__":
    unittest.main()
