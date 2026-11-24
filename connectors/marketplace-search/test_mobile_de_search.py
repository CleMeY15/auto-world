import io
import unittest
from email.message import Message
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from xml.etree import ElementTree as ET

from mobile_de_search import ACCEPT, SearchError, fetch_search, parse_search_xml, search_url


def offer(ad_id="401", **overrides):
    values = {"mobileAdId": ad_id, "modelDescription": "Golf 1.5 spécial", "mileage": "0",
              "firstRegistration": "202002", "detailPageUrl": f"https://suchen.mobile.de/auto-inserat/golf/{ad_id}.html",
              "currency": "EUR", "consumerPriceGross": "15892.75"}
    values.update(overrides)
    node = ET.Element("ad")
    price = ET.SubElement(node, "price")
    for key, value in values.items():
        if value is not None:
            ET.SubElement(price if key in ("currency", "consumerPriceGross") else node, key).text = value
    return node


def page(*ads):
    root = ET.Element("searchResult")
    ET.SubElement(root, "total").text = str(len(ads))
    ET.SubElement(root, "currentPage").text = "1"
    ET.SubElement(root, "ads").extend(ads)
    return ET.tostring(root)


class SearchTests(unittest.TestCase):
    def test_native_values(self):
        result = parse_search_xml(page(offer()))
        self.assertEqual(result["complete"], 1)
        row = result["rows"][0]
        self.assertEqual((row["price"], row["year"], row["mileage_km"], row["title"]),
                         ("15892.75", 2020, 0, "Golf 1.5 spécial"))

    def test_no_assumed_price_year_title_or_country_url(self):
        result = parse_search_xml(page(offer(modelDescription=None, firstRegistration="202099",
                                            consumerPriceGross=None, detailPageUrl="https://external.invalid/401")))
        self.assertEqual(result["rows"], [])
        self.assertEqual(set(result["missing_fields"]), {"source_url", "title", "year", "price"})

    def test_detail_url_belongs_to_the_same_ad(self):
        valid = "https://suchen.mobile.de/fahrzeuge/details.html?id=401&source=api"
        self.assertEqual(parse_search_xml(page(offer(detailPageUrl=valid)))["complete"], 1)
        for url in ("https://suchen.mobile.de/auto-inserat/golf/405.html",
                    "https://suchen.mobile.de/fahrzeuge/details.html?id=405",
                    "https://suchen.mobile.de/fahrzeuge/details.html?id=401&id=402",
                    "https://suchen.mobile.de/fahrzeuge/search.html?id=401",
                    "https://home.mobile.de/sample-dealer"):
            self.assertEqual(parse_search_xml(page(offer(detailPageUrl=url)))["complete"], 0)

    def test_impossible_year_is_not_imported(self):
        for registration in ("180001", "299912"):
            self.assertEqual(parse_search_xml(page(offer(firstRegistration=registration)))["complete"], 0)

    def test_duplicate_and_conflicting_ids(self):
        result = parse_search_xml(page(offer(), offer(), offer("402"), offer("402", mileage="72")))
        self.assertEqual(result["complete"], 1)
        self.assertEqual(result["conflicting_ids"], 1)
        self.assertEqual(result["repeated_ids"], 2)

    def test_no_id_and_empty_page(self):
        self.assertEqual(parse_search_xml(page(offer(ad_id=None)))["no_id"], 1)
        self.assertEqual(parse_search_xml(page())["complete"], 0)

    def test_unexpected_response_rejected(self):
        for body in (b"<errors/>", b"<html/>", b"<!DOCTYPE xml><searchResult><ads/></searchResult>"):
            with self.assertRaises(SearchError):
                parse_search_xml(body)

    def test_search_url(self):
        u = urlsplit(search_url(3, "FR"))
        self.assertEqual((u.scheme, u.netloc, u.path), ("https", "services.mobile.de", "/search-api/search"))
        self.assertEqual(parse_qs(u.query), {"condition": ["USED"], "classification": ["refdata/classes/Car"],
                                             "country": ["FR"], "page.size": ["3"], "page.number": ["1"]})
        self.assertEqual(urlsplit(search_url(sandbox=True)).hostname, "services.sandbox.mobile.de")
        for n in (0, 101):
            with self.assertRaises(SearchError):
                search_url(n)

    def test_authenticated_request(self):
        class Client:
            def open(self, req, timeout):
                self.request = req
                r = io.BytesIO(page(offer()))
                r.status = 200
                r.headers = Message()
                r.headers["Content-Type"] = ACCEPT
                return r
        client = Client()
        self.assertEqual(fetch_search("test", "sample", limit=1, opener=client)["complete"], 1)
        self.assertEqual(client.request.get_header("Accept"), ACCEPT)
        self.assertTrue(client.request.get_header("Authorization").startswith("Basic "))

    def test_protected_endpoint_error_class(self):
        class Refused:
            def open(self, req, timeout):
                raise HTTPError(req.full_url, 401, "", {}, io.BytesIO(b"private error text"))
        with self.assertRaisesRegex(SearchError, "HTTP 401"):
            fetch_search("test", "sample", opener=Refused())
        with self.assertRaisesRegex(SearchError, "credentials are required"):
            fetch_search(None, None, opener=Refused())


if __name__ == "__main__":
    unittest.main()
