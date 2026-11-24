import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from marketplace_pages import audit_files, parse_input


def card(identifier, price):
    return f"### [Renault Clio](https://www.leboncoin.fr/ad/voitures/{identifier})\n{price} €\n·2019·80 000 km"


class MarketplaceAuditTests(unittest.TestCase):
    def test_multiple_files_conflicts_repeats_and_errors(self):
        with tempfile.TemporaryDirectory() as tmp:
            one, two, unknown = (Path(tmp) / n for n in ("one", "two", "missing"))
            one.write_text(card("3100000000", 6400) + "\n" + card("3100000001", 7200))
            two.write_text(card("3100000000", 6400) + "\n" + card("3100000001", 6200))
            report = audit_files("leboncoin-md", [one, unknown, two], True)
        self.assertEqual(report["distinct_identified"], 2)
        self.assertEqual(report["repeat_observations"], 2)
        self.assertEqual(report["conflicting_unique"], 1)
        self.assertEqual([r["source_id"] for r in report["rows"]], ["3100000000"])
        self.assertEqual(report["pages"][1]["status"], "input_error")

    def test_protection_mention_and_empty_are_distinct(self):
        for body, status in [("Captcha", "verification_mention"),
                             ("Access denied", "verification_signal"),
                             ("0 annonce", "empty_results"), ("", "unrecognized")]:
            self.assertEqual(parse_input("leboncoin-md", body)[3]["status"], status)

    def test_partial_rows_are_never_joined_across_pages(self):
        def observation(body):
            a = body == "first"
            return {"status": "results", "observations": 1, "duplicates": 0,
                    "cards": [{"source_id": "ABC12345", "url": "from-source",
                               "title": "Clio", "price_eur": 5000 if a else None,
                               "year": None if a else 2015, "mileage_km": 70000}]}
        with tempfile.TemporaryDirectory() as tmp, patch("marketplace_pages.parse_parking_markdown", observation):
            paths = [Path(tmp) / n for n in ("first", "second")]
            for path in paths:
                path.write_text(path.name)
            report = audit_files("leparking-md", paths, True)
        self.assertEqual((report["complete_unique"], report["partial_unique"], report["rows"]), (0, 1, []))

    def test_hidden_partial_evidence_excludes_a_later_conflicting_complete_row(self):
        def observation(body):
            first = body == "first"
            card = {"source_id": "ABC12345", "url": "from-source", "title": "Clio",
                    "price_eur": 8100, "year": None if first else 2016, "mileage_km": 70000}
            return {"status": "results", "observations": 2 if first else 1,
                    "duplicates": int(first), "cards": [card],
                    "observed_values": {"ABC12345": {"year": [2010 if first else 2016]}}}
        with tempfile.TemporaryDirectory() as tmp, patch("marketplace_pages.parse_parking_markdown", observation):
            paths = [Path(tmp) / n for n in ("first", "second")]
            for path in paths:
                path.write_text(path.name)
            report = audit_files("leparking-md", paths, True)
        self.assertEqual((report["distinct_identified"], report["conflicting_unique"],
                          report["complete_unique"], report["repeat_observations"]), (1, 1, 0, 2))

    def test_historical_detail_values_in_a_reconstructed_list(self):
        fixture = Path(__file__).with_name("evidence") / "normalized-sample.json"
        records = json.loads(fixture.read_text(encoding="utf-8"))["records"]
        blocks, expected = [], []
        for record in records:
            src, fields = record["source"], record["fields"]
            title = fields["title"]["value"]
            cents = fields["price"]["value"]["amountMinor"]
            self.assertEqual(cents % 100, 0)
            price = cents // 100
            year = fields["model_year"]["value"]
            mileage = fields["mileage"]["value"]["amount"]
            url = src["original_url"]
            blocks.append(f"### [{title}]({url})\n{price} €\n·{year}·{mileage} km")
            expected.append(dict(source="leboncoin", source_id=src["listing_id"], source_url=url,
                                 title=title, price_eur=price, year=year, mileage_km=mileage))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "reconstructed.md"
            path.write_text("\n\n".join(blocks), encoding="utf-8")
            result = audit_files("leboncoin-md", [path], True)
        self.assertEqual(result["complete_unique"], 3)
        self.assertEqual(result["rows"], expected)


if __name__ == "__main__":
    unittest.main()
