import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import catalog_reader as catalog


def call(path=catalog.LIST, query="", **overrides):
    environ = {"HTTP_HOST": "localhost", "REQUEST_METHOD": "GET", "PATH_INFO": path, "QUERY_STRING": query, **overrides}
    reply = {}
    def start(status, headers):
        reply.update(status=status, headers=dict(headers))
    result = b"".join(catalog.application(environ, start))
    return reply["status"], json.loads(result), reply["headers"]


@patch.dict(os.environ, {"AUTOFIND_PRIVATE_CATALOG": "1"})
class CatalogTest(unittest.TestCase):
    def test_identity_before_db_and_expired_grant(self):
        with patch.object(catalog, "query_listings") as query:
            with patch.object(catalog, "publication_grant", side_effect=catalog.CatalogUnavailable("withdrawn")):
                for path in (catalog.LIST, catalog.LIST + "/123"):
                    status, body, headers = call(path)
                    self.assertEqual(status, "503 Service Unavailable")
                    self.assertEqual(body, {"error": "catalog_unavailable"})
                    self.assertEqual(headers["Cache-Control"], "private, no-store")
            query.assert_not_called()

    def test_query_boundary(self):
        with patch.object(catalog, "publication_grant") as grant:
            for query in ("limit=0", "limit=101", "after=", "after=1&after=2", "limit=1&sort=x", "q=%00", "q=" + "x" * 81, "bad",
                          "brand=Renault&brand=Kia", "brand=%00", "priceMin=-1", "priceMax=12.5",
                          "hasPrice=1&hasPrice=1", "hasPrice=0", "hasPrice=true",
                          "model=Clio", "brand=Renault&model=Clio&model=Zoe", "brand=Renault&model=%00",
                          "hasPhotos=no", "hasPhotos=1&hasPhotos=1", "kmMin=-1", "kmMin=2&kmMax=1",
                          "fuel=%00", "doors=0", "doors=10", "seatsMin=6&seatsMax=4", "inspectionValid=true",
                          "firstOwner=0", "serviceBook=non", "sort=default&after=price-desc~42~10",
                          "sort=year-desc&after=year-asc~2020~1", "sort=price-asc&after=12", "sort=km-asc&after=km-asc~NaN~3",
                          "sort=price-desc&after=price-desc~999999999999999999999~5", "sort=km-asc&after=km-asc~10~03",
                          "priceMin=2&priceMax=1", "yearMin=2020&yearMax=1999", "yearMax=1885",
                          "yearMin=10000", "kmMax=9007199254740992", "priceMin=90071992547410"):
                self.assertEqual(call(query=query)[0], "400 Bad Request")
            for path in (catalog.LIST + "/0", catalog.LIST + "/../12", "/demo"):
                self.assertEqual(call(path)[0], "404 Not Found")
            self.assertEqual(call(HTTP_X_FORWARDED_HOST="localhost")[0], "403 Forbidden")
            self.assertEqual(call(HTTP_HOST="autofind.tech")[0], "403 Forbidden")
            self.assertEqual(call(REQUEST_METHOD="POST")[0], "405 Method Not Allowed")
            with patch.dict(os.environ, {"AUTOFIND_PRIVATE_CATALOG": "0"}):
                self.assertEqual(call()[0], "503 Service Unavailable")
            grant.assert_not_called()

    def test_has_price_flag(self):
        with patch.object(catalog, "publication_grant", return_value={}), patch.object(catalog, "query_listings", return_value=[]) as query:
            for raw, wanted in (("", False), ("hasPrice=", False), ("brand=Renault&hasPrice=1", True)):
                with self.subTest(raw=raw):
                    self.assertEqual(call(query=raw)[0], "200 OK")
                    self.assertIs(query.call_args.args[-1]["hasPrice"], wanted)

    def test_pagination_detail_and_database_failure(self):
        rows = [{"source_listing_id": "11"}, {"source_listing_id": "20"}]
        with patch.object(catalog, "publication_grant", return_value={}) as grant:
            with patch.object(catalog, "query_listings", return_value=rows) as query:
                status, body, _ = call(query="limit=1&after=10&q=Clio")
                self.assertEqual(status, "200 OK")
                self.assertEqual(body, {"dataset": catalog.DATASET, "items": rows[:1], "brands": catalog.BRANDS,
                                        "modelsByBrand": catalog.VEHICLE_MODELS, "filterOptions": catalog.FILTER_OPTIONS, "next_cursor": "11"})
                query.assert_called_once_with({}, "", 2, "Clio", catalog.filter_params({"after": "10"}))
                query.return_value = [rows[0]]
                self.assertEqual(call(catalog.LIST + "/11")[1], rows[0])
                query.assert_called_with({}, "11", 1, "", catalog.filter_params({}))
                query.return_value = []
                self.assertEqual(call(catalog.LIST + "/11")[0], "404 Not Found")
                self.assertEqual(call()[1], {"dataset": catalog.DATASET, "items": [], "brands": catalog.BRANDS,
                                             "modelsByBrand": catalog.VEHICLE_MODELS, "filterOptions": catalog.FILTER_OPTIONS, "next_cursor": None})
                query.side_effect = catalog.CatalogUnavailable("postgres_unavailable")
                self.assertEqual(call()[0], "503 Service Unavailable")
            self.assertEqual(grant.call_count, 5)

    def test_list_and_detail_emit_only_controlled_make_model_pairs(self):
        base = {"source_listing_id": "123", "record_at": datetime.now(timezone.utc),
                "record_time_kind": "source_capture", "year": None, "mileage_km": None,
                "price_amount_minor": None, "photo_references": []}
        for make, model, approved in [
            ("Renault", "Clio", ("Renault", "Clio")),
            ("Renault", "Yaris", ("Renault", None)),
            ("Seller Name", "Clio", (None, None)),
            ("Renault", "VF1EXAMPLE1234567", ("Renault", None)),
            ("Renault", "Clio VIN VF1EXAMPLE1234567", ("Renault", None)),
            ("Audi", "Client Nom", ("Audi", None)),
            ("Porsche", None, ("Porsche", None)),
        ]:
            with self.subTest(make=make, model=model):
                projected = catalog.listing({**base, "brand": make, "model": model})
                with patch.object(catalog, "publication_grant", return_value={}), patch.object(catalog, "query_listings", return_value=[projected]):
                    for item in (call()[1]["items"][0], call(catalog.LIST + "/123")[1]):
                        self.assertEqual((item["brand"], item["model"]), approved)

    def test_projection_keeps_only_published_fields_and_nulls(self):
        result = catalog.listing({"source_listing_id": "123", "record_at": datetime.now(timezone.utc),
                                  "record_time_kind": "file_export", "brand": "A", "model": "06 12 34 56 78",
                                  "year": "2020", "mileage_km": -1,
                                  "price_amount_minor": None, "photo_references": [], "private": "source text"})
        self.assertNotIn("private", result)
        self.assertEqual(result["source_url"], "https://www.leboncoin.fr/ad/voitures/123")
        self.assertEqual(result["observed_at_kind"], "file_export")
        for key in ("model", "year", "mileage_km", "price_amount_minor", "price_currency"):
            self.assertIsNone(result[key])


if __name__ == "__main__":
    unittest.main()
