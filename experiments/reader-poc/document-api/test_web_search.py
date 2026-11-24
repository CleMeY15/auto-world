import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from web_search import MAX_BYTES, WebSearchError, search_web


class WebSearchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.response = (200, b"{}", "application/json")
        cls.paths = []

        class Stub(BaseHTTPRequestHandler):
            def do_GET(self):
                cls.paths.append(self.path)
                status, raw, mime = cls.response
                self.send_response(status)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(raw)))
                if status == 302:
                    self.send_header("Location", "/redirect-destination")
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *args):
                pass

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()
        cls.server.server_close()

    def setUp(self):
        self.paths.clear()
        port = self.server.server_address[1]
        self.env = patch.dict(os.environ, {"READER_SEARXNG_URL": f"http://127.0.0.1:{port}/sx/"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def respond(self, body, status=200, mime="application/json"):
        type(self).response = (status, body if isinstance(body, bytes) else json.dumps(body).encode(), mime)

    def test_real_http_request_and_result_sanitization(self):
        rows = [
            {"url": "https://bad.example@leak.example/", "title": "secrets"},
            {"url": "http://[::1]/"},
            {"url": "http://0x7f.0x0.0x0.0x1/"},
            {"url": "https://lOcaLHost./"},
            {"url": "https://fr.wikipedia.org/wiki/A#X", "content": "<b>Prix</b> &amp; texte", "title": "A"},
            {"url": "https://fr.wikipedia.org/wiki/A#Y"},
            {"url": "https://fr.wikipedia.org/wiki/B", "title": "B"},
        ]
        self.respond({"results": rows})
        results = search_web("Kia & Nissan", 2)
        self.assertEqual([r["title"] for r in results], ["A", "B"])
        self.assertEqual(results[0]["url"], "https://fr.wikipedia.org/wiki/A")
        self.assertEqual(results[0]["description"], "Prix & texte")
        self.assertEqual(urlsplit(self.paths[0]).path, "/sx/search")
        self.assertEqual(parse_qs(urlsplit(self.paths[0]).query),
                         {"format": ["json"], "q": ["Kia & Nissan"], "language": ["fr"]})

    def test_maximum_limit_and_zero_deadline(self):
        rows = [{"url": f"https://fr.wikipedia.org/wiki/{i}"} for i in range(9)]
        self.respond({"results": rows})
        self.assertEqual(len(search_web("neuf")), 5)
        with patch("web_search.time.monotonic", side_effect=[0.0, 9.0]):
            with self.assertRaises(WebSearchError) as error:
                search_web("temps dépassé")
            self.assertEqual(error.exception.status, 504)

    def test_empty_result_and_engine_failure(self):
        self.respond({"results": []})
        self.assertEqual(search_web("absent"), [])
        self.respond({"results": [], "unresponsive_engines": [["wikipedia", "Timeout"]]})
        with self.assertRaises(WebSearchError) as error:
            search_web("test")
        self.assertEqual(error.exception.status, 502)

    def test_refuses_redirect_and_invalid_responses(self):
        for status, body, mime in [
            (302, b"", "text/plain"), (429, b"", "text/plain"),
            (200, b"{}", "text/html"), (200, b"!malformed!", "application/json"),
            (200, b"[]", "application/json"), (200, b" " * (MAX_BYTES + 1), "application/json"),
        ]:
            with self.subTest(status=status, size=len(body), mime=mime):
                self.respond(body, status, mime)
                with self.assertRaises(WebSearchError) as error:
                    search_web("test")
                self.assertEqual(error.exception.status, 502)
        self.assertTrue(all("/sx/search?" in path for path in self.paths))

    def test_input_and_missing_configuration(self):
        for query, limit in [("", 1), ("X" * 257, 1), ("A\nB", 1), ("test", 6), ("test", True)]:
            with self.assertRaises(WebSearchError) as error:
                search_web(query, limit)
            self.assertEqual(error.exception.status, 400)
        with patch.dict(os.environ, {"READER_SEARXNG_URL": ""}):
            with self.assertRaises(WebSearchError) as error:
                search_web("test")
            self.assertEqual(error.exception.status, 503)
        self.assertEqual(self.paths, [])


if __name__ == "__main__":
    unittest.main()
