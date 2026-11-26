"""Isolated release-acceptance checks using invented listings and session data."""
import importlib.util
import http.server
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release", Path(__file__).resolve().parents[1] / "catalog_release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)

ID = "123"
SOURCE = "https://www.leboncoin.fr/ad/voitures/" + ID
ROW = {"source_listing_id": ID, "source_label": "Leboncoin", "source_url": SOURCE,
       "observed_at": "2026-11-01T00:00:00+00:00", "observed_at_kind": "source_capture",
       "images": ["https://img.example.invalid/1.jpg"]}
LIST = b'<ul data-catalog-dataset="autoworld/leboncoin"><li><a href="/catalogue/123?limit=20">Annonce</a></li></ul><a href="/acces/deconnexion">Quitter</a>'
DETAIL = ('<time datetime="' + ROW["observed_at"] + '"></time><a href="' + SOURCE + '">Source</a>'
          '<a href="' + ROW["images"][0] + '">Photo</a><a href="/acces/deconnexion">Quitter</a>').encode()


class Acceptance(unittest.TestCase):
    def accept(self, items=None, detail=DETAIL, anon=401, index=LIST, demo=403, redirects="/catalogue"):
        def reader(path):
            payload = {"dataset": "autoworld/leboncoin", "items": [ROW] if items is None else items}
            return 200, json.dumps(payload if path.endswith("limit=1") else ROW).encode()

        def edge(path, authenticated):
            if not authenticated:
                return anon, "", b"Connexion"
            if path in {"/", "/demo"}:
                return 307, redirects, b""
            if path == "/api/demo/v2/catalog":
                return demo, "", b""
            return 200, "", index if "?q=" in path else detail
        return release.accept(reader, edge)

    def test_verified_admitted_row(self):
        self.accept()

    def test_rejects_empty_mismatched_or_exposed_release(self):
        for case in ({"items": []}, {"anon": 200}, {"detail": b"error"}, {"index": b"empty"},
                     {"detail": DETAIL.replace(b"1.jpg", b"2.jpg")}, {"demo": 200},
                     {"redirects": "https://other.invalid/catalogue"},
                     {"items": [{**ROW, "source_url": "https://other.invalid/"}]}):
            with self.subTest(case=case.keys()), self.assertRaises(release.Rejected):
                self.accept(**case)

    def test_operator_cookie_file(self):
        cookie = "#HttpOnly_autofind.tech\tFALSE\t/\tTRUE\t0\t__Host-aw-session\t" + "a"*32 + "\n"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cookie"
            path.touch(mode=0o600)
            path.write_text(cookie)
            self.assertTrue(release.read_session(path).startswith("__Host-aw-session="))
            for invalid in (cookie * 2, cookie.replace("TRUE", "FALSE"), cookie.replace("autofind.tech", "other.invalid")):
                path.write_text(invalid)
                with self.assertRaises(release.Rejected):
                    release.read_session(path)
            path.write_text(cookie)
            path.chmod(0o644)
            with self.assertRaises(release.Rejected):
                release.read_session(path)
            link = Path(directory) / "link"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                release.read_session(link)

    def test_certificate_host_and_session_on_separate_candidate_transport(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                code = 421 if self.headers["Host"] != "autofind.tech" else 200 if self.headers.get("Cookie") == "session-test" else 401
                self.send_response(code)
                self.send_header("Cache-Control", "private, no-store")
                self.end_headers()

            def log_message(self, *_):
                pass

        with tempfile.TemporaryDirectory() as directory, http.server.HTTPServer(("127.0.0.1", 0), Handler) as server:
            cert = Path(directory) / "cert"
            key = Path(directory) / "key"
            subprocess.run(["openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
                            "-noenc", "-days", "1", "-subj", "/CN=autofind.tech", "-addext", "subjectAltName=DNS:autofind.tech",
                            "-keyout", str(key), "-out", str(cert)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            server.socket = context.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .02})
            thread.start()
            try:
                with patch.object(release, "LOOPBACK_PORT", server.server_port):
                    with self.assertRaises(ssl.SSLCertVerificationError):
                        release.edge_get("/catalogue", "session-test", True)
                    with patch.dict(os.environ, {"SSL_CERT_FILE": str(cert)}):
                        self.assertEqual(release.edge_get("/catalogue", None, True)[0], 401)
                        self.assertEqual(release.edge_get("/catalogue", "session-test", True)[0], 200)
            finally:
                server.shutdown()
                thread.join()


if __name__ == "__main__":
    unittest.main()
