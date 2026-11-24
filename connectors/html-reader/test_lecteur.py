import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from lecteur import main
from parking_detail import parse_parking
from custom_detail import DetailError


URL = "https://www.leparking.fr/voiture-occasion-detail/exemple/voiture/TEST0001.html"
CAR = {"@type": "Vehicle", "name": "Véhicule exemple",
       "productionDate": "2020", "mileageFromOdometer": {"unitCode": "KM", "value": "0"},
       "offers": {"@type": "offer", "price": "9876", "priceCurrency": "EUR", "url": URL}}


def page(car, canonical=URL):
    return (f'<link rel="canonical" href="{canonical}"><script type="application/ld+json">'
            + json.dumps(car) + '</script>').encode()


def invoke(*args):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        status = main(list(args))
    return status, json.loads(buf.getvalue())


class EntryPointTests(unittest.TestCase):
    def test_detail_and_identity(self):
        row = parse_parking(page(CAR), URL)
        self.assertEqual(("leparking.fr", "TEST0001", "9876.00", 0),
                         (row["source"], row["source_id"], row["price"], row["mileage_km"]))
        with self.assertRaises(DetailError):
            parse_parking(page(CAR, URL.replace("TEST0001", "TEST0002")), URL)
        with self.assertRaises(DetailError):
            parse_parking(page([CAR, CAR]), URL)

    def test_saved_parking_detected_from_canonical_without_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "parking.html"
            path.write_bytes(page(CAR))
            status, out = invoke("file", str(path))
        self.assertEqual((0, "TEST0001"), (status, out["observations"][0]["row"]["source_id"]))

    def test_gated_stale_offer_and_conflicting_vehicle_url(self):
        unavailable = CAR | {"offers": CAR["offers"] | {"availability": "https://schema.org/SoldOut"}}
        for body, code in [
            (b"<title>Consent required</title>" + page(CAR), "blocked_or_unavailable"),
            (page(unavailable), "blocked_or_unavailable"),
            (page(CAR | {"url": URL.replace("TEST0001", "TEST0002")}), "ambiguous_identity"),
        ]:
            with self.subTest(code=code), self.assertRaises(DetailError) as exc:
                parse_parking(body, URL)
            self.assertEqual(exc.exception.code, code)

    def test_direct_fetch_requires_body(self):
        with patch("lecteur.read_public_html", return_value=({"result": "http_refusal"}, None)):
            status, out = invoke("fetch", URL)
        self.assertEqual((2, [], "http_refusal"), (status, out["observations"], out["errors"][0]["code"]))

    def test_normal_entrypoint_records_hash_and_retains_bytes(self):
        data = page(CAR)
        with tempfile.TemporaryDirectory() as tmp, patch("lecteur.read_public_html",
                     return_value=({"result": "html_received"}, data)):
            path = Path(tmp) / "received.html"
            status, out = invoke("fetch", URL, "--save-html", str(path))
            self.assertEqual(data, path.read_bytes())
        self.assertEqual((0, "direct-origin", hashlib.sha256(data).hexdigest()),
                         (status, out["observations"][0]["provenance"], out["documents"][0]["sha256"]))

    def test_local_batch_reports_each_bad_entry_without_losing_good_document(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            manifest = folder / "manifest.json"
            (folder / "one.html").write_bytes(page(CAR))
            manifest.write_text(json.dumps([{"file": "one.html", "source_url": URL},
                {"file": "../escape.html"}, {"file": "one.html", "source_url": URL, "provenance": "direct-origin"}]))
            status, out = invoke("batch", str(manifest))
        self.assertEqual(2, status)
        self.assertEqual(1, len(out["observations"]))
        self.assertEqual("archived", out["observations"][0]["provenance"])
        self.assertEqual(["invalid_path", "invalid_provenance"], [x["code"] for x in out["errors"]])


if __name__ == "__main__":
    unittest.main()
