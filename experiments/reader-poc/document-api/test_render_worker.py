import contextlib
import http.client
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from render_worker import CSP, MAX_INPUT, MAX_REQUEST, RenderIssue, decode_job


class RenderProtocolTests(unittest.TestCase):
    def test_supported_formats(self):
        for fmt in ("html", "screenshot"):
            data = {"html": "<p id='ready'>OK</p>", "format": fmt, "selector": "#ready"}
            self.assertEqual(decode_job(json.dumps(data).encode()), data)

    def test_invalid_requests(self):
        for obj in (None, {}, {"html": "x", "format": "png"},
                    {"url": "https://example.com", "format": "html"},
                    {"html": "x", "format": "html", "selector": "div a"},
                    {"html": "\ud800", "format": "html"}):
            with self.subTest(obj=obj), self.assertRaises(RenderIssue) as cm:
                decode_job(json.dumps(obj).encode())
            self.assertEqual(cm.exception.status, 400)
        with self.assertRaises(RenderIssue) as cm:
            decode_job(b" " * (MAX_REQUEST + 1))
        self.assertEqual(cm.exception.status, 413)

    def test_html_limit_is_independent_of_json_escaping(self):
        markup = '"' * MAX_INPUT
        raw = json.dumps({"format": "html", "html": markup}).encode()
        self.assertGreater(len(raw), MAX_INPUT)
        self.assertEqual(decode_job(raw)["html"], markup)
        with self.assertRaises(RenderIssue) as error:
            decode_job(json.dumps({"format": "html", "html": markup + "é"}).encode())
        self.assertEqual(error.exception.status, 413)

    def test_response_policy(self):
        for directive in ("connect-src 'none'", "frame-src 'none'", "sandbox allow-scripts",
                          "worker-src 'none'", "form-action 'none'", "base-uri 'none'"):
            self.assertIn(directive, CSP)


class ChromiumIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not importlib.util.find_spec("playwright") or not shutil.which(os.getenv("CHROMIUM_PATH", "chromium")):
            raise unittest.SkipTest("Install Playwright and system Chromium to run live rendering tests")
        try:
            probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            probe.close()
        except OSError as exc:
            raise unittest.SkipTest(f"Host does not permit Unix sockets ({exc})") from exc
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.socket_path = str(Path(cls.temp.name, "renderer.sock"))
        cls.proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name("render_worker.py"))],
                                    env={**os.environ, "READER_RENDER_SOCKET": cls.socket_path})
        def stop():
            cls.proc.terminate()
            cls.proc.wait(timeout=4)
        cls.addClassCleanup(stop)
        deadline = time.monotonic() + 5
        while not Path(cls.socket_path).is_socket():
            if cls.proc.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError("Renderer socket was not created")
            time.sleep(.02)

    def submit(self, payload):
        with contextlib.closing(socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)) as conn:
            conn.settimeout(20)
            conn.connect(self.socket_path)
            body = json.dumps(payload).encode()
            header = (f"POST /render HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n"
                      f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n")
            conn.sendall(header.encode() + body)
            resp = http.client.HTTPResponse(conn)
            resp.begin()
            return resp.status, resp.getheader("Content-Type"), resp.read()

    def test_inline_script_and_png(self):
        markup = '<body><script>setTimeout(()=>{let p=document.createElement("p");p.id="ready";p.textContent="Pièce en stock";document.body.append(p)},10)</script></body>'
        obj = {"html": markup, "format": "html", "selector": "#ready"}
        status, mime, rendered = self.submit(obj)
        self.assertEqual(status, 200, rendered)
        self.assertIn("text/html", mime)
        self.assertIn('<p id="ready">Pièce en stock</p>', rendered.decode())
        status, mime, image = self.submit({**obj, "format": "screenshot"})
        self.assertEqual(status, 200, image[:100])
        self.assertEqual((mime, image[:8]), ("image/png", b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(struct.unpack(">II", image[16:24]), (1024, 768))

    def test_external_requests_do_not_reach_controlled_origin(self):
        hits = []
        class Observer(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                hits.append(self.path)
                self.send_response(200)
                self.end_headers()
            def log_message(self, *args):
                pass
        with http.server.HTTPServer(("127.0.0.1", 0), Observer) as observer:
            thread = threading.Thread(target=observer.serve_forever, daemon=True)
            thread.start()
            origin = f"http://127.0.0.1:{observer.server_port}"
            try:
                markup = (f'<body><img src="{origin}/image"><script src="{origin}/script"></script>'
                          f'<script>fetch("{origin}/fetch").then(()=>document.body.id="leak",'
                          '()=>document.body.id="blocked")</script></body>')
                status, _, rendered = self.submit({"html":markup, "format":"html", "selector":"#blocked"})
                self.assertEqual(status, 200, rendered)
                self.assertIn(b'<body id="blocked">', rendered)
                self.assertEqual(hits, [])
            finally:
                observer.shutdown()
                thread.join()


if __name__ == "__main__":
    unittest.main()
