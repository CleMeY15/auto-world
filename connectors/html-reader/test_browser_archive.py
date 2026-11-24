"""Synthetic browser archive format and German document regressions; no network."""
from email.message import EmailMessage
from email.policy import SMTP
import hashlib
import plistlib
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from browser_archive import read_archive
from custom_detail import DetailError, parse_detail
from lecteur import parse_file_entry


URL = "https://suchen.mobile.de/fahrzeuge/details.html?id=123456"
BODY = (f'<link rel="canonical" href="{URL}"><h1>Marque Modèle synthétique</h1>'
        '<dl><dt>Barpreis</dt><dd>24.990 € (inkl. 19 % MwSt.)</dd>'
        '<dt>Laufleistung</dt><dd>30.012 km</dd><dt>Erstzulassung (EZ)</dt><dd>03/2020</dd></dl>')


def resource(html=BODY, url=URL):
    return {"WebResourceMIMEType":"text/html", "WebResourceURL": url,
            "WebResourceData": html.encode("utf-8"), "WebResourceTextEncodingName":"UTF-8"}


def mhtml(html=BODY, url=URL, start=None, before_main=False):
    envelope = EmailMessage()
    envelope.set_type("multipart/related")
    if start:
        envelope.set_param("start", start)
    first = EmailMessage()
    first.set_content(html, subtype="html", charset="utf-8", cte="quoted-printable")
    first["Content-Location"] = url
    first["Content-ID"] = "<main@example.test>"
    foreign = EmailMessage()
    foreign.set_content("<h1>Foreign iframe</h1>", subtype="html")
    foreign["Content-Location"] = "https://example.test/frame"
    for child in ([foreign, first] if before_main else [first, foreign]):
        envelope.attach(child)
    envelope["Snapshot-Content-Location"] = URL
    return envelope.as_bytes(policy=SMTP)


class BrowserArchiveTest(unittest.TestCase):
    def test_safari_binary_and_xml_only_main_saved_resource(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "capture.webarchive"
            for fmt in (plistlib.FMT_BINARY, plistlib.FMT_XML):
                package = {"WebMainResource":resource(), "WebSubresources":[resource("unrelated", URL+"7")]}
                data = plistlib.dumps(package, fmt=fmt)
                path.write_bytes(data)
                with self.subTest(fmt=fmt), patch("lecteur.read_public_html", side_effect=AssertionError):
                    observations, report = parse_file_entry({}, path)
                    self.assertEqual(report["html_sha256"], hashlib.sha256(BODY.encode()).hexdigest())
                    self.assertEqual(observations[0]["document_sha256"], hashlib.sha256(data).hexdigest())
                    self.assertEqual(observations[0]["provenance"], "archived")
                    self.assertEqual(observations[0]["row"]["price"], "24990.00")
                    self.assertEqual(observations[0]["row"]["mileage_km"], 30012)

    def test_mhtml_uses_start_or_default_first_part(self):
        for data in (mhtml(), mhtml(start="<main@example.test>", before_main=True)):
            row, digest = read_archive(data, "mhtml")
            self.assertEqual(row["source_id"], "123456")
            self.assertEqual(row["year"], 2020)
            self.assertEqual(len(digest), 64)

    def test_mhtml_folded_location_headers(self):
        from email.parser import BytesParser
        from email import policy
        original = BytesParser(policy=policy.default).parsebytes(mhtml())
        # Build a deliberately folded header independent of the local email library.
        unfolded = original.as_bytes(policy=SMTP.clone(max_line_length=998))
        for field in (b"Snapshot-Content-Location", b"Content-Location"):
            unfolded = unfolded.replace(field + b": " + URL.encode(),
                                        field + b":\r\n   " + URL.encode())
        row, _ = read_archive(unfolded, "mhtml")
        self.assertEqual(row["source_id"], "123456")

    def test_mhtml_targets_must_match_and_archive_must_be_unambiguous(self):
        for data, explicit in ((mhtml(url=URL+"7"), None), (mhtml(), URL+"8"),
                (mhtml(start="<missing>"), None), (mhtml(before_main=True), None), (b"bad",None)):
            with self.subTest(explicit=explicit), self.assertRaises(DetailError):
                read_archive(data, "mhtml", explicit)

    def test_safari_rejects_incomplete_conflicting_or_gated_main(self):
        docs = [{"WebMainResource":resource("Access Denied"), "WebSubresources":[resource()]},
                {"WebMainResource":resource(url=URL+"1")}, {"WebSubresources":[resource()]},
                {"WebMainResource":resource() | {"WebResourceMIMEType":"application/pdf"}},
                {"WebMainResource":resource() | {"WebResourceData":"broken"}}]
        for archive in docs:
            with self.subTest(case=next(iter(archive))), self.assertRaises(DetailError):
                read_archive(plistlib.dumps(archive), "webarchive")

    def test_malformed_safari_fails_cleanly(self):
        for data in (b"<?xml version='1.0'?><plist><broken", b"bplist00not a valid archive", b"x"):
            with self.subTest(data=data), self.assertRaises(DetailError):
                read_archive(data, "webarchive")

    def test_german_tax_label_and_registration_in_saved_text(self):
        for amount in ["24.990,50 EUR inkl. 19 % MwSt.", "24.990,50 € (MwSt. ausweisbar)"]:
            doc="Titel: Modèle synthétique\nKaufpreis: "+amount+"\nLaufleistung: 30.012 km\nEZ: 03/2020"
            row=parse_detail(doc,URL,format="text")
            self.assertEqual((row["price"],row["year"],row["mileage_km"]),("24990.50",2020,30012))

    def test_net_or_monthly_only_price_does_not_become_cash_price(self):
        for suffix in ("zzgl. 19 % MwSt.", "exkl. MwSt.", "monatlich"):
            doc="Titel: Modèle synthétique\nPreis: 24.990 EUR\n"+suffix+"\nEZ: 2020\nKilometerstand: 30.000 km"
            with self.subTest(suffix=suffix), self.assertRaises(DetailError):
                parse_detail(doc,URL,format="text")


if __name__ == "__main__":
    unittest.main()
