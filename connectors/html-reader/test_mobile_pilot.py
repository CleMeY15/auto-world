"""Local transport tests for the end-to-end authorized mobile.de CLI."""
from contextlib import redirect_stdout
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from lecteur import main
from own_fetch import Response

HOST = "suchen.mobile.de"
CANONICAL = "https://" + HOST + "/fahrzeuge/details.html?id=100"
FETCH_URL = CANONICAL + "&vip=1"
ROBOTS_URL = "https://" + HOST + "/robots.txt"
ROBOTS = (b"User-agent: *\nDisallow: /fahrzeuge/details.html\n"
          b"Allow: /fahrzeuge/details.html?id=*&vip=1$\n")
HTML = (f'<link rel="canonical" href="{CANONICAL}"><h1>Marke Beispiel</h1>'
        '<dl><dt>Kaufpreis</dt><dd>17.850 EUR</dd><dt>Kilometerstand</dt><dd>42.100 km</dd>'
        '<dt>Erstzulassung</dt><dd>09/2018</dd></dl>').encode()
DB = "autofindex_trial_vehicle_test"


def run(*args):
    output = io.StringIO()
    with redirect_stdout(output):
        status = main(["mobile", *args])
    return status, json.loads(output.getvalue())


class NativeMobilePilotTests(unittest.TestCase):
    def test_fetch_parse_and_optional_database(self):
        replies = [Response(200, "text/plain", ROBOTS), Response(200, "text/html", HTML)]
        with patch("own_fetch.get", side_effect=replies) as transport, \
                patch("lecteur.import_observations", return_value={"verified": 1}) as db, \
                tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / "result.html"
            code, r = run(FETCH_URL, "--database", DB, "--save-html", str(dst))
            self.assertEqual((code, r["errors"]), (0, []))
            self.assertEqual(dst.read_bytes(), HTML)
        self.assertEqual([c.args[0] for c in transport.call_args_list], [ROBOTS_URL, FETCH_URL])
        self.assertTrue(all(c.kwargs["trusted_egress_hosts"] == {HOST} for c in transport.call_args_list))
        self.assertEqual(r["http"]["requested_url"], FETCH_URL)
        self.assertEqual(r["postgresql"]["verified"], 1)
        self.assertEqual(r["observations"][0]["document_sha256"], hashlib.sha256(HTML).hexdigest())
        self.assertEqual(r["observations"][0]["provenance"], "direct-origin")
        self.assertEqual(r["observations"][0]["row"], dict(source="mobile.de", source_id="100", source_url=CANONICAL,
                         title="Marke Beispiel", price="17850.00", currency="EUR", year=2018, mileage_km=42100))
        db.assert_called_once_with(DB, r["observations"])

    def test_other_routes_are_rejected_before_network(self):
        for url in (CANONICAL, FETCH_URL + "#frag", FETCH_URL + "&id=999", FETCH_URL.replace("100", "-1"),
                    FETCH_URL.replace(HOST, "example.org"), FETCH_URL.replace("details.html", "search.html"),
                    FETCH_URL.replace("100&vip=1", "100%26vip=1"), FETCH_URL.replace("https://", "http://")):
            with self.subTest(url=url), patch("own_fetch.get") as transport, patch("lecteur.import_observations") as db:
                code, r = run(url, "--database", DB)
                self.assertEqual((code, r["http"]["requests"], r["errors"][0]["code"]), (2, 0, "invalid_mobile_url"))
                transport.assert_not_called()
                db.assert_not_called()

    def test_refusal_or_gate_produces_no_listing_and_no_storage(self):
        robots = Response(200, "text/plain", ROBOTS)
        fixtures = [
            ([Response(200, "text/plain", b"User-agent: *\nDisallow: /\n")], "robots_disallow"),
            ([robots, Response(302, "text/html", b"")], "redirect_stopped"),
            ([robots, Response(403, "text/html", b"")], "http_refusal"),
            ([robots, Response(429, "text/html", b"")], "http_refusal"),
            ([robots, Response(200, "text/html", b"<title>Access Denied</title>")], "verification_or_consent"),
            ([robots, Response(200, "text/html", HTML.replace(b"id=100", b"id=101"))], "ambiguous_identity"),
            ([robots, Response(200, "text/html", HTML[HTML.index(b"<h1>"):])], "missing_url"),
            ([robots, Response(200, "text/html", HTML[:HTML.index(b"<h1>")])], "incomplete"),
        ]
        for replies, reason in fixtures:
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as tmp, \
                    patch("own_fetch.get", side_effect=replies) as transport, patch("lecteur.import_observations") as db:
                path = Path(tmp) / "none.html"
                code, r = run(FETCH_URL, "--database", DB, "--save-html", str(path))
                self.assertEqual((code, r["errors"][0]["code"], r["observations"], r["documents"]), (2, reason, [], []))
                self.assertEqual(transport.call_count, len(replies))
                self.assertFalse(path.exists())
                self.assertNotIn("postgresql", r)
                db.assert_not_called()

    def test_db_failure_is_reported_separately_from_extraction(self):
        replies = [Response(200, "text/plain", ROBOTS), Response(200, "text/html", HTML)]
        with patch("own_fetch.get", side_effect=replies), \
                patch("lecteur.import_observations", side_effect=RuntimeError("PostgreSQL readback failed")):
            code, r = run(FETCH_URL, "--database", DB)
        self.assertEqual((code, len(r["observations"]), r["http"]["result"]), (2, 1, "html_received"))
        self.assertEqual(r["errors"][0]["code"], "postgres_unverified")
        self.assertNotIn("postgresql", r)


if __name__ == "__main__":
    unittest.main()
