"""Controlled examples of supported public document formats; no marketplace traffic."""
import json
import unittest
from custom_detail import DetailError, MAX_BYTES, listing_identity, parse_detail

M = "https://suchen.mobile.de/fahrzeuge/details.html?id=12345"
A = "https://www.autoscout24.fr/offres/modele-test-90dc97c4-cfd5-4683-a123-45b45b352afe"


def vehicle(url=M):
    return {"@type": "Car", "name": "Modèle de test", "url": url,
            "offers": {"@type": "Offer", "price": "15430.50", "priceCurrency": "EUR"},
            "mileageFromOdometer": {"value": "42310", "unitCode": "KMT"},
            "dateVehicleFirstRegistered": "2019-02-01"}


def page(node, url=M, more=""):
    return (f'<head><link rel="canonical" href="{url}"><script type="application/ld+json">'
            f'{json.dumps(node)}</script></head><body>{more}</body>')


def visible():
    return ("<h1>Marque Modèle</h1><dl><dt>Prix TTC</dt><dd>15 430,50 €</dd>"
            "<dt>Kilométrage</dt><dd>42.310 km</dd>"
            "<dt>Première immatriculation</dt><dd>02/2019</dd></dl>")


class ParserTests(unittest.TestCase):
    def reject(self, text, code=None, url=M, fmt="html"):
        with self.assertRaises(DetailError) as caught:
            parse_detail(text, url, format=fmt)
        if code:
            self.assertEqual(caught.exception.code, code)

    def test_semantic_normalization_each_site(self):
        for site, url in (("mobile.de", M), ("AutoScout24", A)):
            with self.subTest(site=site):
                result = parse_detail(page(vehicle(url), url))
                self.assertEqual(result["source"], site)
                self.assertEqual(result["price"], "15430.50")
                self.assertEqual(result["currency"], "EUR")
                self.assertEqual(result["mileage_km"], 42310)
                self.assertEqual(result["year"], 2019)
                self.assertEqual(result["source_url"], url)
                self.assertEqual(result["source_id"], listing_identity(url)[1])
                self.assertEqual(len(result), 8)

    def test_native_urls(self):
        self.assertEqual(listing_identity(M + "&utm=1#details")[2], M)
        self.assertEqual(listing_identity("https://suchen.mobile.de/auto-inserat/auto-test/13.html")[1], "13")
        self.assertEqual(listing_identity(A.upper().replace("HTTPS", "https"))[1], A[-36:])
        for value in ("https://www.mobile.de/auto", M + "&id=12", M.replace("https", "http"),
                      A.replace("www.autoscout24.fr", "www.autoscout24.fr.exemple.org"),
                      M.replace("suchen.", "user@suchen."), M.replace(".de/", ".de:8443/"),
                      A.replace("offres", "lst"), A[:-3], M.replace(".de/", ".de\\evil.org/")):
            with self.subTest(value=value), self.assertRaises(DetailError):
                listing_identity(value)

    def test_graph_offer_references(self):
        row = vehicle()
        offer = row.pop("offers")
        row["offers"] = {"@id": "#offer"}
        result = parse_detail(page({"@graph": [row, {"@id": "#offer", **offer}]}))
        self.assertEqual(result["price"], "15430.50")

    def test_visible_labels(self):
        row = parse_detail(visible(), A)
        self.assertEqual((row["title"], row["year"], row["price"], row["mileage_km"]),
                         ("Marque Modèle", 2019, "15430.50", 42310))

    def test_markdown_french(self):
        data = f"URL Source: {A}\nSauver Partager Imprimer\n#\nMarque Modèle\nFinition 1.0\n【123†Lille】\n€ 15 430^{{1}}\nKilométrage\n42 310 km\nAnnée\n02/2019"
        for footnote in ("^{1}", "^{}"):
            row = parse_detail(data.replace("^{1}", footnote), format="text")
            self.assertEqual((row["title"], row["mileage_km"]), ("Marque Modèle Finition 1.0", 42310))

    def test_german_text_layout(self):
        data = "【9†Image: alt†example.org】\n14.320 €\nAnrufen\nMarque Alpha*LED*\n14.320 €\nKilometerstand\n#### 8.394 km\nErstzulassung\n#### 03/2024"
        row = parse_detail(data, M, format="text")
        self.assertEqual(row["title"], "Marque Alpha*LED*")
        self.assertEqual((row["price"], row["year"], row["mileage_km"]), ("14320.00", 2024, 8394))

    def test_paste_with_labelled_title(self):
        raw = "Titre: Marque Modèle\nPrix TTC : 12.860,- €\nKilométrage : 0 km\nPremière immatriculation : 11/2024"
        row = parse_detail(raw, M, format="text")
        self.assertEqual((row["price"], row["mileage_km"]), ("12860.00", 0))

    def test_refuse_challenges_and_list(self):
        for txt in ("<title>Just a moment...</title>", "<h1>403 Forbidden</h1>", "<h1>CAPTCHA</h1>",
                    "<h1>Cette annonce n’est plus disponible</h1>"):
            self.reject(page(vehicle(), more=txt), "blocked_or_unavailable")
        for doc in (page({"@type": "ItemList", "itemListElement": [vehicle()]}),
                    "<h1>Résultats de recherche</h1>" + visible()):
            self.reject(doc, "list_page")

    def test_reject_foreign_or_conflicting_identity(self):
        for doc in (page(vehicle(A)), page(vehicle(), A), page({"@type": "Car", "@id": A, **vehicle()})):
            self.reject(doc, "ambiguous_identity")
        self.reject(page([vehicle(), vehicle(A)]), "ambiguous_listing")
        self.reject(page(vehicle()).replace(M, "https://wrong.example/1"), "unsupported_url", None)

    def test_reject_conflicting_prices_or_kilometers(self):
        self.reject(page(vehicle(), more=visible().replace("15 430,50", "14 000,00")), "ambiguous_price")
        self.reject(page(vehicle(), more=visible().replace("42.310 km", "43.000 km")), "ambiguous_mileage_km")

    def test_refuse_missing_cash_price_and_wrong_distance_unit(self):
        for mod in ("net", "lease", "miles", "missing", "aggregate"):
            row = vehicle()
            if mod == "net":
                row["offers"]["priceSpecification"] = {"valueAddedTaxIncluded": False}
            elif mod == "lease":
                row["offers"]["businessFunction"] = "LeaseOut"
            elif mod == "aggregate":
                row["offers"]["@type"] = "AggregateOffer"
            elif mod == "miles":
                row["mileageFromOdometer"]["unitCode"] = "SMI"
            else:
                del row["offers"]["priceCurrency"]
            with self.subTest(mod=mod):
                self.reject(page(row), "incomplete")

    def test_do_not_promote_a_link_or_picture_to_title(self):
        self.reject("【35†Image: alt†example.org】\nPrix : 2500 €\nKilométrage : 8500 km\nAnnée : 2019",
                    "incomplete", M, "text")

    def test_monthly_payment_and_net_label_stay_out(self):
        for money_line in ("Mensualité\n129 €", "Prix HT\n15 430 €", "150 € par mois", "Netto\n1.234,56 EUR"):
            txt = "Titre: Modèle Test\n" + money_line + "\nAnnée: 2019\nKilométrage: 40 000 km"
            with self.subTest(txt=txt):
                self.reject(txt, "incomplete", M, "text")

    def test_hidden_or_javascript_fields_not_treated_as_visible(self):
        self.reject("<script>document.write('Marque Test')</script><div hidden>" + visible() + "</div>",
                    "incomplete")
        self.reject("<h1>Marque 123</h1>", "incomplete")
        self.reject("", "invalid_input")
        self.reject(b"\xff", "invalid_input")
        self.reject("x" * (MAX_BYTES + 1), "invalid_input")
        self.reject(visible(), "missing_url", None)


if __name__ == "__main__":
    unittest.main()
