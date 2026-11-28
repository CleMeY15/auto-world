import contextlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

from custom_detail import DetailError
from lecteur import main
from mobile_print import extract_pdf_text, parse_print_text


ONE = """
Druckansicht: Marke Modell
                 Deutschlands größter Fahrzeugmarkt
    Marke Modell
    Inseratsnummer: 123456, https://suchen.mobile.de/fahrzeuge/details.html?        18.950 € Ohne Bewertung
    id=123456                                                                         15.924 € (Netto), 19 % MwSt.

    Kilometerstand         52.601 km
    Erstzulassung          07/2019
    Fahrzeugbeschreibung laut Anbieter
    Probefahrt             10 € pro Stunde
    https://suchen.mobile.de/fahrzeuge/printView.html?id=123456
"""


def valid_pdf():
    # Standalone, searchable one-page PDF with a synthetic printed vehicle record.
    text_lines = ["Marke Modell   12500 EUR", "Inseratsnummer: 2266, https://suchen.mobile.de/fahrzeuge/details.html?id=2266",
                  "Kilometerstand  42.000 km", "Erstzulassung  03/2018"]
    stream = "BT /F1 10 Tf 40 700 Td 16 TL " + " T* ".join("(" + t + ") Tj" for t in text_lines) + " ET"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
               f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream".encode()]
    raw = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(raw))
        raw.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(raw)
    raw.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for pos in offsets[1:]:
        raw.extend(f"{pos:010d} 00000 n \n".encode())
    raw.extend(f"trailer << /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(raw)


class MobilePrintTests(unittest.TestCase):
    def test_two_columns_keep_model_gross_and_printed_reference(self):
        row = parse_print_text(ONE)
        self.assertEqual((row["title"], row["source_id"], row["price"], row["mileage_km"], row["year"]),
                         ("Marke Modell", "123456", "18950.00", 52601, 2019))

    def test_two_different_native_ids_are_rejected(self):
        for data in (ONE.replace("Inseratsnummer: 123456","Inseratsnummer: 123457"),
                     ONE + "\f" + ONE.replace("123456", "235467")):
            with self.assertRaises(DetailError):
                parse_print_text(data)

    def test_no_guess_when_native_url_is_missing_or_incompatible(self):
        for data, url in [(ONE.replace("details.html?", "other.html?"), None),
                          (ONE, "https://suchen.mobile.de/fahrzeuge/details.html?id=999")]:
            with self.assertRaises(DetailError):
                parse_print_text(data, url)

    def test_only_net_and_financing_must_fail(self):
        for label in ("(Netto)", "mtl.", "(zzgl. MwSt.)", "    monatlich", "    (Netto)", "zuzüglich MwSt."):
            with self.assertRaises(DetailError):
                parse_print_text(ONE.replace("Ohne Bewertung", label))

    def test_gated_header_duplicate_parameter_or_second_printout_rejected(self):
        for text in ("Access Denied\n" + ONE, ONE.replace("id=123456", "id=123456&id=654321"),
                     ONE + "\f" + ONE.replace("18.950", "29.990")):
            with self.assertRaises(DetailError):
                parse_print_text(text)

    def test_missing_text_or_miles_rejected(self):
        for text in ("", ONE.replace("52.601 km", "32,684 miles")):
            with self.assertRaises(DetailError):
                parse_print_text(text)

    def test_pdf_dependency_and_bad_input_raise_clear_error(self):
        with self.assertRaises(DetailError):
            extract_pdf_text(b"<html>not PDF</html>")
        with patch("mobile_print.subprocess.Popen", side_effect=FileNotFoundError):
            with self.assertRaises(DetailError) as exc:
                extract_pdf_text(b"%PDF-synthetic")
        self.assertEqual(exc.exception.code, "missing_pdftotext")

    @unittest.skipUnless(shutil.which("pdftotext"), "Poppler required for PDF integration")
    def test_real_pdf_binary_through_cli(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "vehicle.pdf"
            path.write_bytes(valid_pdf())
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                status = main(["file", str(path)])
            out = json.loads(output.getvalue())
        self.assertEqual(status, 0, out["errors"])
        self.assertEqual(out["observations"][0]["provenance"], "archived")
        self.assertEqual(out["observations"][0]["row"]["price"], "12500.00")


if __name__ == "__main__":
    unittest.main()
