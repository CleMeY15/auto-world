import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from marketplace_pages import audit_files, parse_input
from test_leparking_html import card as html_card, result_cards


def card(identifier, price):
    return f"### [Renault Clio](https://www.leboncoin.fr/ad/voitures/{identifier})\n{price} €\n·2019·80 000 km"


class MarketplaceAuditTests(unittest.TestCase):
    def test_500_synthetic_parking_ids_via_cli_overlapping_pages(self):
        # One extra slot per page, within the first page then across boundaries.
        # In the degraded variant one repeat contradicts its earlier price.
        cli = Path(__file__).with_name("marketplace_pages.py")
        for degraded in (False, True):
            with self.subTest(degraded=degraded), tempfile.TemporaryDirectory() as tmp:
                paths = []
                expected = {}
                for page in range(20):
                    start = page * 25
                    numbers = [*range(start, start + 25), max(0, start - 1)]
                    cards = []
                    for number in numbers:
                        source_id = f"F{number:07d}"
                        link = f"/voiture-occasion-detail/test/vehicle/{source_id}.html"
                        title, price = f"Voiture test {number}", 5000 + 17 * number
                        km, year = 500 * number, 2010 + number % 14
                        price_text = f"{price} €"
                        if degraded and page == 1 and number == 24:
                            price_text = f"{price + 150} €"
                        if degraded and number in (30, 31):
                            price_text = "" if number == 30 else "89 € par mois"
                        cards.append(html_card(link=link, title=title, detail=link,
                                               price=price_text, km=f"{km} Km", year=str(year)))
                        if not degraded or number not in (24, 30, 31):
                            expected[source_id] = (title, price, km, year,
                                                   "https://www.leparking.fr" + link)
                    path = Path(tmp) / f"page-{page + 1:02}.html"
                    path.write_text(result_cards(*cards), encoding="utf-8")
                    paths.append(str(path))
                result = subprocess.run([sys.executable, str(cli), "leparking-html", "--target", "500",
                                         "--rows", *paths], text=True, capture_output=True, timeout=30)
                self.assertEqual(result.returncode, int(degraded), result.stderr)
                report = json.loads(result.stdout)
                self.assertEqual(sum(p["observations"] for p in report["pages"]), 520)
                self.assertEqual([p["new_source_ids"] for p in report["pages"]], [25] * 20)
                self.assertEqual([p["previously_seen_source_ids"] for p in report["pages"]],
                                 [0] + [1] * 19)
                self.assertEqual((report["distinct_identified"], report["repeat_observations"]), (500, 20))
                self.assertEqual((report["complete_unique"], report["partial_unique"], report["conflicting_unique"]),
                                 (497, 2, 1) if degraded else (500, 0, 0))
                self.assertEqual(report["missing_fields_on_partial_rows"], {"price_eur": 2} if degraded else {})
                actual = {r["source_id"]: (r["title"], r["price_eur"], r["mileage_km"], r["year"],
                                           r["source_url"]) for r in report["rows"]}
                self.assertEqual(actual, expected)

    def test_replayed_parking_page_does_not_advance_when_input_is_repeated(self):
        with tempfile.TemporaryDirectory() as tmp:
            page = Path(tmp) / "one.html"
            page.write_text(result_cards(html_card()), encoding="utf-8")
            report = audit_files("leparking-html", [page, page])
        self.assertEqual(report["complete_unique"], 1)
        self.assertEqual([p["new_source_ids"] for p in report["pages"]], [1, 0])
        self.assertEqual(report["repeat_observations"], 1)

    def test_html_empty_results_require_a_visible_message_in_the_results_container(self):
        marker = "<p>Au<strong>cune</strong> annonce trouvée.</p>"
        for body, expected in [
            (result_cards(marker), "empty_results"),
            ('<section hidden>' + result_cards(marker) + '</section>', "unrecognized"),
            ('<ul id="resultats" aria-hidden="TRUE"><li>0 annonces</li></ul>', "unrecognized"),
            (result_cards('<script>\n0 annonces\n</script>'), "unrecognized"),
            (result_cards() + '<footer>\n0 annonces\n</footer>', "unrecognized"),
            ('<li hidden>\n0 annonces\n</li>', "unrecognized"),
            (result_cards("<p>Afficher <b>0 annonces</b> par défaut.</p>"), "unrecognized"),
            (result_cards('<p>0 annonces</p>') + '<script src="recaptcha.js"></script>', "empty_results"),
            (result_cards('<p>0 annonces</p>', html_card()), "results"),
        ]:
            with self.subTest(body=body):
                self.assertEqual(parse_input("leparking-html", body)[3]["status"], expected)

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
