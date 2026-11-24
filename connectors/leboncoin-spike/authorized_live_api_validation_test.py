"""Offline tests: no network requests."""
import json
import unittest
from unittest.mock import patch
import authorized_live_api_validation as m

CAR={"make":"Ford","model":"Fiesta","year":"2019","price":8490.5,"mileage":48000,
     "url":"https://example.test/listing/001","fuel_type":"Petrol"}

def response(page,cars,total_pages=2,total=2):
    return 200,"application/json",json.dumps({"results":{"cars":cars,"current_page":page,
              "total_pages":total_pages,"total_vehicles":total}}).encode()

class Tests(unittest.TestCase):
    def test_live_shape_validation(self):
        v,s=m.normalise(CAR)
        self.assertTrue(all(x=="valid" for x in s.values()))
        self.assertEqual(v["year"],2019)
        self.assertEqual(v["mileage"],48000)

    def test_null_invalid_and_zero_mileage(self):
        v,s=m.normalise({**CAR,"year":None,"price":False,"mileage":0})
        self.assertEqual(s["year"],"missing")
        self.assertEqual(s["price"],"invalid")
        self.assertEqual(v["mileage"],0)

    def test_target_and_replay(self):
        r=m.execute(lambda p:response(p,[CAR]),limit=1,max_pages=1)
        self.assertTrue(r["strict_quality_gate_passed"])
        self.assertEqual(r["replay"]["exact_rows"],1)
        self.assertEqual(r["attempts"],1)

    def test_duplicate_urls(self):
        with patch.object(m.time,"sleep",return_value=None):
            r=m.execute(lambda p:response(p,[{**CAR,"price":8490+p}]),limit=2,max_pages=2)
        self.assertEqual(r["duplicate_url_rows"],1)
        self.assertEqual(r["unique_listing_urls"],1)
        self.assertFalse(r["strict_quality_gate_passed"])

    def test_stops_on_refusal_redirect_or_challenge(self):
        for status in (401,403,429,503,302):
            calls=[]
            def fetch(page):
                calls.append(page)
                return status,"text/html",b"not available"
            r=m.execute(fetch,max_pages=2)
            self.assertEqual(calls,[1])
            self.assertEqual(r["attempts"],1)
            self.assertEqual(r["http_responses"],1)
        r=m.execute(lambda p:(200,"text/html",b"verify you are human"),max_pages=2)
        self.assertEqual(r["stop_reason"],"verification_signal")

    def test_timeout_counted(self):
        def fetch(page):raise TimeoutError()
        r=m.execute(fetch,max_pages=2)
        self.assertEqual(r["attempts"],1)
        self.assertEqual(r["http_responses"],0)
        self.assertEqual(r["stop_reason"],"network_or_timeout_error")

    def test_repeated_page_and_wrong_page(self):
        with patch.object(m.time,"sleep",return_value=None):
            r=m.execute(lambda p:response(p,[CAR],3,3),limit=3,max_pages=3)
        self.assertEqual(r["stop_reason"],"repeated_page")
        self.assertEqual(r["attempts"],2)
        self.assertEqual(r["rows_processed"],1)
        r=m.execute(lambda p:response(2,[CAR]),max_pages=2)
        self.assertEqual(r["stop_reason"],"pagination_mismatch")

    def test_no_raw_listing_export(self):
        r=m.execute(lambda p:response(p,[{**CAR,"full_description":"PRIVATE_SENTINEL"}]),limit=1,max_pages=1)
        s=json.dumps(r)
        self.assertNotIn("PRIVATE_SENTINEL",s)
        self.assertNotIn(CAR["url"],s)

if __name__=="__main__":
    unittest.main()
