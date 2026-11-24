import unittest

from parking_origin_labels import page_matches

URL = "https://www.leparking.fr/voiture-occasion/renault.html"
A, B = "AB12CD34", "EF56GH78"


def vehicle(token, domain, title, price, nested="", mark_id=None):
    return f"""<li class="li-result"><div class="right-result-bloc">
    <a class="tag_f_titre" href="/tools/{token}/123/T/P.html">{title}</a>
    <p class="prix">{price} €</p><ul class="info"><li>Diesel</li><li>12 345 Km</li><li>2020</li></ul></div>
    <div class="site-bottom"><a href="/voiture-occasion-detail/sample/car/{mark_id or token}.html">{domain}</a></div>
    <div>{nested}</div></li>"""


def sample(inner):
    return ('<html><div id="resultats"><ul>' + inner + '</ul></div></html>').encode()


def row(title, price):
    return dict(title=title, year=2020, mileage_km=12345, price_eur=price)


class LabelTests(unittest.TestCase):
    def test_inner_sources_bound_to_nearest_listing(self):
        selected = {A: row("First", 17000), B: row("Second", 24000)}
        doc = sample(vehicle(A, "mobile.de", "First", "17 000",
                             nested=vehicle(B, "autoscout24.fr", "Second", "24 000")))
        self.assertEqual(list(page_matches(doc, URL, selected)), [(A, "mobile.de"), (B, "autoscout24.fr")])

    def test_visible_native_href_never_inherited_from_child_result(self):
        selected = {A: row("First", 17000), B: row("Second", 24000)}
        child = vehicle(B, "autoscout24.fr", "Second", "24 000",
                        nested='<a href="https://www.autoscout24.fr/offres/test">Source</a>')
        doc = sample(vehicle(A, "mobile.de", "First", "17 000", nested=child))
        native = set()
        self.assertEqual(len(list(page_matches(doc, URL, selected, native))), 2)
        self.assertEqual(native, {B})

    def test_origin_link_id_must_match_title_link(self):
        doc = sample(vehicle(A, "mobile.de", "First", "17 000", mark_id=B))
        self.assertEqual(list(page_matches(doc, URL, {A: row("First",17000), B: row("First",17000)})), [])

    def test_missing_or_changed_field_ignored(self):
        doc = sample(vehicle(A, "autoscout24.be", "First", "17 000"))
        self.assertEqual(list(page_matches(doc, URL, {A: row("First",17001)})), [])
        self.assertEqual(list(page_matches(doc, URL, {})), [])

    def test_domain_not_substring(self):
        doc = sample(vehicle(A, "not-mobile.de", "First", "17 000"))
        self.assertEqual(list(page_matches(doc, URL, {A: row("First",17000)})), [])


if __name__ == "__main__":
    unittest.main()
