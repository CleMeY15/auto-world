"""HTTP contract tests using a real loopback Uvicorn listener and synthetic origins."""
import http.client
import json
import socket
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.parse import urlencode

import uvicorn

from app import create_app
from fetch_document import Fetcher
from test_binary_documents import W, package, text_pdf


class HttpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(tmp.cleanup)
        cls.origin_requests = []
        cls.search_queries = []

        def transport(host, path, limit, timeout):
            cls.origin_requests.append((host, path))
            if path == "/robots.txt":
                return 200, {"content-type": "text/plain"}, b"User-agent: *\nDisallow: /draft/"
            return 200, {"content-type": "text/html; charset=utf-8"}, (
                '<html><head><title>Fiche hybride</title></head>'
                '<body><main><h1>Hybride</h1><p>Une boîte automatique.</p></main></body></html>'
            ).encode()

        def web(query, limit):
            cls.search_queries.append(query)
            return [{"url": f"https://{host}/{path}", "title": title, "description": "Extrait"}
                    for host, path, title in [("reader.example", "fiche", "Fiche"),
                                              ("other.example", "test", "Autre")]][:limit]

        api = create_app(database=Path(tmp.name) / "test.sqlite3",
                         fetcher=Fetcher({"reader.example"}, transport=transport),
                         web_provider=web)
        cfg = uvicorn.Config(api, loop="asyncio", http="h11", ws="none", lifespan="on",
                             log_level="critical", access_log=False)
        cls.server = uvicorn.Server(cfg)
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        cls.port = sock.getsockname()[1]
        cls.addClassCleanup(sock.close)
        cls.thread = threading.Thread(target=cls.server.run, kwargs={"sockets": [sock]}, daemon=True)
        cls.thread.start()
        cls.addClassCleanup(cls.stop_server)
        end = time.monotonic() + 5
        while not cls.server.started and cls.thread.is_alive() and time.monotonic() < end:
            time.sleep(0.01)
        if not cls.server.started:
            raise RuntimeError("API listener did not start")

    @classmethod
    def stop_server(cls):
        cls.server.should_exit = True
        cls.thread.join(5)
        if cls.thread.is_alive():
            raise RuntimeError("API listener did not stop")

    def call(self, method, path, body=None, headers=None, status=200):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            with conn.getresponse() as response:
                raw = response.read()
                self.assertEqual(response.status, status, raw[:1024])
                if response.getheader("Content-Type", "").startswith("application/json"):
                    return json.loads(raw)
                return raw.decode()
        finally:
            conn.close()

    def post_json(self, path, body, **options):
        return self.call("POST", path, json.dumps(body).encode(),
                         {"Content-Type": "application/json", "Accept": "application/json"}, **options)

    def test_reader_prefix_preserves_query_and_cache_refresh(self):
        target = "https://reader.example/caf%C3%A9?q=a%26b&trim=x%2By"
        data = self.call("GET", "/" + target, headers={"Accept": "application/json"})["data"]
        self.assertEqual(data["url"], target)
        self.assertEqual(data["title"], "Fiche hybride")
        self.assertIn("boîte automatique", data["content"])
        self.assertIn(("reader.example", "/caf%C3%A9?q=a%26b&trim=x%2By"), self.origin_requests)
        plain = self.call("GET", "/v1/read?" + urlencode({"url": target}))
        self.assertIn("Markdown Content:", plain)
        self.assertIn(target, plain)
        refreshed = self.call("GET", "/" + target, headers={
            "Accept": "application/json", "X-No-Cache": "true"})["data"]
        self.assertFalse(refreshed["cacheHit"])

    def test_explicit_only_index_update_and_ranked_search(self):
        url = "https://inventory.example/lot-405"
        for route, text in [("/v1/read", "transitoire"), ("/v1/index", "ancienvocable"),
                            ("/v1/index", "électrique finale"), ("/v1/index", "électrique finale")]:
            self.post_json(route, {"url": url, "text": text})
        for word in ("transitoire", "ancienvocable"):
            self.assertEqual(self.call("GET", "/v1/search?q=" + word)["data"], [])
        rows = self.call("GET", "/v1/search?q=electrique&limit=1&offset=0")["data"]
        self.assertEqual([row["url"] for row in rows], [url])
        self.assertEqual(self.call("GET", "/v1/search?q=electrique&offset=1")["data"], [])

    def test_host_robots_and_upload_origin_checks(self):
        denied = self.post_json("/v1/read", {"url": "https://private.example/page"}, status=403)
        self.assertEqual(denied["error"], "host_not_allowed")
        denied = self.post_json("/", {"url": "https://reader.example/draft/file"}, status=403)
        self.assertEqual(denied["error"], "robots_denied")
        denied = self.call("POST", "/", b"abc", {"Content-Type": "text/plain",
                           "Origin": "https://other.example"}, status=403)
        self.assertEqual(denied["error"], "cross_origin_denied")

    def test_web_result_status_for_each_url_and_plain_search(self):
        data = self.call("GET", "/v1/search/web?q=boite&limit=2")["data"]
        self.assertEqual([r["readStatus"] for r in data], ["read", "host_not_allowed"])
        self.assertIn("automatique", data[0]["content"])
        data = self.call("GET", "/s/bo%C3%AEte?limit=2&read=0",
                         headers={"Accept": "application/json"})["data"]
        self.assertEqual([r["readStatus"] for r in data], ["snippet_only", "snippet_only"])
        self.assertIn("boîte", self.search_queries)
        plain = self.call("GET", "/s/stock?read=0&limit=2")
        self.assertIn("[1]", plain)
        self.assertIn("https://other.example/test", plain)
        fallback = self.call("GET", "/s/?q=manuel&limit=1&read=0",
                             headers={"Accept": "application/json"})
        self.assertEqual(len(fallback["data"]), 1)
        self.assertEqual(self.search_queries[-1], "manuel")

    def test_html_output_modes_and_selectors(self):
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        entity = json.dumps({"url": "https://source.example/catalogue",
                             "html": "<main><h1>Kia</h1><p id='prix'>19 000 EUR</p></main>"}).encode()
        for mode in ("text", "html"):
            with self.subTest(mode=mode):
                result = self.call("POST", "/", entity, {
                    **headers, "X-Respond-With": mode, "X-Target-Selector": "#prix"})
                value = result["data"]["content"]
                self.assertIn("19 000 EUR", value)
                self.assertNotIn("Kia", value)
                if mode == "html":
                    self.assertIn("<p>", value)
        unsupported = self.call("POST", "/v1/index", entity, {
            **headers, "X-Target-Selector": "#prix"}, status=400)
        self.assertEqual(unsupported["error"], "index_requires_full_document")

    def test_multipart_pdf_and_docx_from_browser_style_upload(self):
        xml = (f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>Devis auto'
               '</w:t></w:r></w:p></w:body></w:document>')
        docx = package({"word/document.xml": xml}, "word/document.xml")
        for name, binary, expected in [("fiche.pdf", text_pdf(), "Hello AutoFindex"),
                                       ("devis.docx", docx, "Devis auto")]:
            with self.subTest(filename=name):
                entity = (b'--AutoBoundary\r\nContent-Disposition: form-data; '
                          b'name="file"; filename="' + name.encode() + b'"\r\n'
                          b'Content-Type: application/octet-stream\r\n\r\n' + binary
                          + b'\r\n--AutoBoundary--\r\n')
                data = self.call("POST", "/v1/read", entity, {
                    "Content-Type": "multipart/form-data; boundary=AutoBoundary",
                    "Accept": "application/json"})["data"]
                self.assertIn(expected, data["content"])

    def test_forms_validation_and_health(self):
        self.assertEqual(self.call("GET", "/health")["status"], "ok")
        body = urlencode({"text": "Prix ferme", "url": "https://stock.example/2"}).encode()
        value = self.call("POST", "/v1/read", body, {"Content-Type":"application/x-www-form-urlencoded",
                                                     "Accept": "application/json"})
        self.assertEqual(value["data"]["content"], "Prix ferme")
        for path, entity, mime in [("/v1/read", b"broken", "multipart/form-data; boundary=x"),
                                   ("/", b"{}", "application/json"),
                                   ("/", b"{", "application/json"),
                                   ("/", b"text=a&text=b", "application/x-www-form-urlencoded")]:
            with self.subTest(entity=entity):
                self.assertIn("error", self.call("POST", path, entity, {"Content-Type": mime}, status=400))
        self.assertIn("error", self.call("GET", "/v1/search?q=a&limit=0", status=400))
        self.assertIn("error", self.call("GET", "/v1/read", status=400))


    def test_required_html_and_optional_worker(self):
        for item in ({"url": "https://example.com/"}, {"html": "<p>A</p>", "format": []}):
            self.assertIn("error", self.call("POST", "/v1/render", json.dumps(item).encode(),
                          {"Content-Type":"application/json"}, status=400))
        with patch.dict("os.environ", {"READER_RENDER_SOCKET":"/does/not/exist/reader.sock"}):
            error = self.call("POST", "/v1/render", b'{"html":"<p>Rendu</p>"}',
                              {"Content-Type":"application/json"}, status=503)
            self.assertEqual("renderer_unavailable", error["error"])

    def test_converts_returned_dom(self):
        with patch("app.render_submitted", return_value=b"<h1>Voiture rendue</h1>") as worker:
            doc = self.call("POST", "/v1/render", b'{"html":"<p>Rendu</p>","selector":"#fin"}',
                            {"Content-Type":"application/json"})["data"]
        self.assertIn("# Voiture rendue", doc["content"])
        worker.assert_called_once_with("<p>Rendu</p>", "html", "#fin")


if __name__ == "__main__":
    unittest.main()
