"""Controlled regression fixtures for the Le Parking HTML list reader."""
import unittest

from parking_results import merge_results, parse_results


A, B = "AB12CD34", "EF56GH78"


def card(token, name="Car", price="12 500", km="42 000", domains=("mobile.de",), mark_id=None,
         nested="", use_detail=True, inline=""):
    detail_url = f"/voiture-occasion-detail/brand/name/{mark_id or token}.html"
    label_url = detail_url if use_detail else f"/tools/{mark_id or token}/0/L/P.html"
    marks = "".join(f'<a href="{label_url}">{d}</a>' for d in domains)
    return f"""<li class="li-result"><div class="right-result-bloc">
      <a class="tag_f_titre" href="/tools/{token}/0/T/P.html">{name}</a><p class="prix">{price} €</p>
      <ul class="info"><li>Essence</li><li>{km} km</li><li>2020</li></ul></div>
      <div class="site-bottom">{marks}{inline}</div>{nested}</li>"""


def page(*cards):
    return '<meta charset="utf-8"><div id="resultats"><ul>' + "".join(cards) + "</ul></div>"


class ParkingTests(unittest.TestCase):
    def test_complete_identity_and_multiple_platforms(self):
        result = parse_results(page(card(A, domains=("mobile.de", "autoscout24.fr", "autoscout24.be", "other.example"))))
        row, = result["rows"]
        self.assertEqual(row["source"], "leparking.fr")
        self.assertEqual(row["source_id"], A)
        self.assertEqual(row["source_url"], f"https://www.leparking.fr/voiture-occasion-detail/brand/name/{A}.html")
        self.assertEqual((row["price"], row["currency"], row["year"], row["mileage_km"]), ("12500.00", "EUR", 2020, 42000))
        self.assertEqual(row["origin_platforms"], ["AutoScout24", "mobile.de", "other.example"])

    def test_nested_owner_and_hidden_source_stay_separate(self):
        hidden = f'<span hidden><a href="/voiture-occasion-detail/sample/car/{A}.html">fake.org</a></span>'
        raw = page(card(A, name="Outer", domains=("mobile.de",), inline=hidden,
                        nested=card(B, name="Inner", domains=("autoscout24.fr",))))
        r = {x["source_id"]: x["origin_domains"] for x in parse_results(raw)["rows"]}
        self.assertEqual(r, {A: ["mobile.de"], B: ["autoscout24.fr"]})

    def test_label_for_wrong_id_never_associated(self):
        valid = f'<a href="/voiture-occasion-detail/brand/name/{A}.html">valid.fr</a>'
        r = parse_results(page(card(A, mark_id=B, inline=valid)))
        self.assertEqual(r["rows"][0]["origin_domains"], ["valid.fr"])
        self.assertEqual(r["invalid_label_observations"], 1)

    def test_unrelated_offsite_href_not_promoted(self):
        bad = '<a href="https://www.mobile.de/fahrzeuge/details.html?id=1">mobile.de</a>'
        r = parse_results(page(card(A, domains=("www.other.example",), inline=bad)))
        self.assertEqual(r["rows"][0]["origin_platforms"], ["other.example"])
        self.assertEqual(r["invalid_label_observations"], 1)

    def test_tracking_only_separate_and_incomplete_rejected(self):
        r = parse_results(page(card(A, use_detail=False), card(B, km="?")))
        self.assertFalse(r["rows"])
        self.assertEqual(r["tracking_only"], 1)
        self.assertEqual(r["incomplete"], 1)

    def test_empty_and_unrecognized(self):
        self.assertEqual(parse_results('<div id="resultats"><p>Aucune annonce</p></div>')["status"], "empty_results")
        self.assertEqual(parse_results("<h1>Verification</h1>")["status"], "unrecognized")
        with self.assertRaises(ValueError):
            parse_results(b"\xff")

    def test_merge_deduplicates_multiple_labels_and_counts_union(self):
        first = parse_results(page(card(A), card(B, domains=("sale.fr",))))
        second = parse_results(page(card(A, domains=("autoscout24.de",))))
        result = merge_results([first, second])
        self.assertEqual(result["rows"][0]["origin_platforms"], ["AutoScout24", "mobile.de"])
        for field, expect in {"mobile_de": 1, "autoscout24": 1, "both_platforms": 1, "either_platform": 1,
                              "only_other_origin": 1, "complete_distinct_with_detail_url": 2}.items():
            self.assertEqual(result["summary"][field], expect)
        self.assertEqual(first["rows"][0]["origin_domains"], ["mobile.de"])

    def test_conflicting_complete_or_partial_observation_rejects_id(self):
        complete = parse_results(page(card(A)))
        for other in (card(A, price="14 000"), card(A, name="Different", km="?")):
            result = merge_results([complete, parse_results(page(other))])
            self.assertEqual(result["conflict_ids"], [A])
            self.assertFalse(result["rows"])

    def test_conflict_in_same_page_and_no_borrowing(self):
        self.assertEqual(parse_results(page(card(A), card(A, km="12 100")))["conflict_ids"], [A])
        r = parse_results(page(card(A, domains=("mobile.de",)),card(A, km="?", domains=("autoscout24.fr",))))
        self.assertEqual(r["rows"][0]["origin_domains"], ["mobile.de"])


if __name__ == "__main__":
    unittest.main()
