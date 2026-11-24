import unittest
from datetime import date

from leparking_html import listing_link, parse_html


KEY = "ABCD1234"
DIRECT = "/voiture-occasion-detail/marque-modele/titre/ABCD1234.html"
REDIRECT = "/tools/ABCD1234/0/T/P.html"


def result_cards(*rows):
    return '<ul id="resultats">' + "".join(rows) + "</ul>"


def card(link=DIRECT, title="Marque Modèle", price="12 300 €", km="42 000 Km",
         year="2019", detail=DIRECT, extra=""):
    return f"""<li><div class="right-result-bloc"><h2>
      <a class="tag_f_titre" href="{link}">{title}</a></h2>
      <p class="old-prix">18 600 €</p><p class="prix">{price}</p>
      <a class="btn-plus" href="{detail}">Détail</a>
      <ul class="info clearfix"><li>ESSENCE</li><li>{km}</li><li>{year}</li>
      <li>MANUELLE</li><li>75001</li></ul>{extra}</div></li>"""


class SavedPageTest(unittest.TestCase):
    def test_displayed_fields_scoped_to_results_and_card(self):
        parsed = parse_html(card() + result_cards(card(title="<span>Marque</span><b>Modèle</b>",
                                                      km="0 Km", price="12&#8239;300 €")))
        self.assertEqual(parsed["observations"], 1)
        got = parsed["cards"][0]
        self.assertEqual((got["source_id"], got["title"], got["price_eur"], got["year"],
                          got["mileage_km"], got["complete"]), (KEY, "Marque Modèle", 12300, 2019, 0, True))
        self.assertTrue(got["url"].startswith("https://www.leparking.fr/"))

    def test_redirect_and_visible_observed_canonical(self):
        got = card(REDIRECT, detail="/tools/ABCD1234/0/D/P.html")
        self.assertEqual(parse_html(result_cards(got))["cards"][0]["url"],
                         "https://www.leparking.fr/tools/ABCD1234/0/D/P.html")
        canon = f'<li><a href="{DIRECT}">Voir cette fiche</a></li>'
        self.assertEqual(parse_html(result_cards(got, canon))["cards"][0]["url"],
                         "https://www.leparking.fr" + DIRECT)

    def test_repeated_cards_tallied_and_price_contradictions_excluded(self):
        exact = parse_html(result_cards(card(), card()))
        self.assertEqual((exact["observations"], exact["duplicates"], exact["complete"]), (2, 1, 1))
        for rows in [(card(), card(price="10 000 €")), (card(extra='<p class="prix">8 000 €</p>'),)]:
            result = parse_html(result_cards(*rows))
            self.assertEqual(result["conflict_ids"], [KEY])
            self.assertEqual(result["complete"], 0)

    def test_no_merge_between_partial_cards(self):
        result = parse_html(result_cards(card(km=""), card(price="")))
        self.assertEqual(result["complete"], 0)
        self.assertEqual(result["duplicates"], 1)
        self.assertNotIn(KEY, result["conflict_ids"])
        self.assertEqual(result["observed_values"][KEY],
                         {"title": ["Marque Modèle"], "price_eur": [12300],
                          "mileage_km": [42000], "year": [2019]})

    def test_non_sale_and_toolbar_links_ignored(self):
        result = parse_html(result_cards(card(price="19,90 € par mois", km="?", year="?"),
                                         '<li><a href="/tools/FALSE234/0/P/P.html">Photographie</a></li>'))
        self.assertEqual((len(result["cards"]), result["complete"]), (1, 0))
        for field in ("price_eur", "mileage_km", "year"):
            self.assertIsNone(result["cards"][0][field])

    def test_untrusted_or_unrelated_source_targets(self):
        for url in ["//example.net" + DIRECT, "https://www.leparking.fr@example.org" + DIRECT,
                    "javascript:console.log(1)", "/tools/ABCD1234/0/P/P.html",
                    "/tools/ABCD1234/0/D/P.html?target=offsite", "https://www.leparking.fr:8080" + DIRECT]:
            self.assertIsNone(listing_link(url))
        parsed = parse_html(result_cards(card(link="//example.org" + DIRECT, detail="")))
        self.assertFalse(parsed["cards"])
        self.assertEqual(parsed["unidentified_or_ambiguous"], 1)
        self.assertEqual(parsed["status"], "unrecognized")
        self.assertEqual(parsed["observed_values"], {})

    def test_mismatched_title_and_detail_quarantines_both_ids(self):
        parsed = parse_html(result_cards(card(), card(detail=DIRECT.replace(KEY, "DEFG4567"))))
        self.assertEqual(parsed["conflict_ids"], ["ABCD1234", "DEFG4567"])
        self.assertEqual(parsed["cards"], [])

    def test_conflict_still_exposes_independently_observed_values(self):
        result = parse_html(result_cards(card(), card(price="10 000 €")))
        self.assertEqual(result["observed_values"][KEY]["price_eur"], [10000, 12300])
        self.assertFalse(result["cards"])

    def test_unbounded_values_and_implausible_years_remain_missing(self):
        huge = "9" * 10000
        result = parse_html(result_cards(card(price=huge + " €", km=huge + " Km",
                                              year=str(date.today().year + 2))))
        row = result["cards"][0]
        for field in ("price_eur", "mileage_km", "year"):
            self.assertIsNone(row[field])
            self.assertEqual(result["observed_values"][KEY][field], [])

    def test_postal_code_never_becomes_a_model_year(self):
        result = parse_html(result_cards(card(year="?").replace("75001", "2000")))
        self.assertIsNone(result["cards"][0]["year"])

    def test_visible_empty_message_in_results_only(self):
        footer = '<footer><script src="/recaptcha.js"></script></footer>'
        visible = '<li><strong>Aucune annonce trouvée.</strong></li>'
        self.assertEqual(parse_html(result_cards(visible) + footer)["status"], "empty_results")
        for hidden in ('<script>0 annonces</script>', '<li hidden>0 annonces</li>',
                       '<template><li>0 annonces</li></template>',
                       '<li aria-hidden="true"><strong>0 annonces</strong></li>'):
            self.assertEqual(parse_html(result_cards(hidden))["status"], "unrecognized")
        self.assertEqual(parse_html(result_cards() + visible)["status"], "unrecognized")
        self.assertEqual(parse_html(result_cards(visible, card()))["status"], "results")

    def test_unrecognized_html(self):
        parsed = parse_html('<p>Erreur temporaire</p><div class="right-result-bloc"></div>')
        self.assertEqual(parsed["status"], "unrecognized")
        self.assertFalse(parsed["cards"])


if __name__ == "__main__":
    unittest.main()
