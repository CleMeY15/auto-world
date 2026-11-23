import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

source = Path(__file__).with_name("free-benchmark.py")
spec = importlib.util.spec_from_file_location("autofindex_bench", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BenchTests(unittest.TestCase):
    def test_complete_vehicle_fields(self):
        outcome, fields = module.classify("Porsche 911 Carrera S 2021 23 000 km 146 990 €", 200)
        self.assertEqual(outcome, "complete")
        self.assertTrue(all(fields.values()))

    def test_http403_is_refused_even_with_data(self):
        outcome, _ = module.classify("Porsche 911 Carrera 2021 23 000 km 146 990 €", 403)
        self.assertEqual(outcome, "refused")

    def test_html200_challenge_is_not_valid_listing(self):
        outcome, _ = module.classify("DataDome Device Check. You have been blocked", 200)
        self.assertEqual(outcome, "verification")

    def test_url_filter_and_dedup(self):
        base = "https://www.leboncoin.fr/ad/voitures/"
        b = module.Bench("jina", [base+"3305814470", base+"3305814470", base+"3312238672"])
        self.assertEqual(b.next_url(), base+"3305814470")
        b.consider_links("https://example.org/ad/voitures/3312238672 " + base+"3301234567")
        self.assertEqual(b.next_url(), base+"3312238672")
        self.assertEqual(b.next_url(), base+"3301234567")
        self.assertIsNone(b.next_url())

    def test_explicit_refusal_stops_without_retry(self):
        b = module.Bench("jina", ["https://www.leboncoin.fr/ad/voitures/3305814470"])
        b.add("https://www.leboncoin.fr/ad/voitures/3305814470", "refused", 403)
        self.assertFalse(b.ready())
        self.assertEqual(len(b.rows), 1)

    def test_public_receipt_redacts_content_and_url(self):
        b = module.Bench("jina", ["https://www.leboncoin.fr/ad/voitures/3305814470"])
        b.add("https://www.leboncoin.fr/ad/voitures/3305814470", "complete", 200,
              {"price_hint": True}, "private seller contact")
        with tempfile.TemporaryDirectory() as td:
            b.output(td)
            content = Path(td, "jina.json").read_text()
            self.assertNotIn("private seller contact", content)
            self.assertNotIn("https://www.leboncoin.fr/ad/", content)
            self.assertEqual(json.loads(content)["attempted_detail_pages"], 1)

if __name__ == "__main__":
    unittest.main()
