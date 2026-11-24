import contextlib
import socket
import unittest
from unittest.mock import patch

from fetch_document import (DOCUMENT_LIMIT, FetchError, Fetcher, _https_get,
                            _public_address, _robots_allows)


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.replies = {"/robots.txt": (404, {}, b"")}

    def __call__(self, host, path, limit, timeout):
        self.calls.append((host, path))
        return self.replies.get(path, (200, {"content-type": "text/html; charset=utf-8"},
                                      b"<p>Document</p>"))


class FetcherTests(unittest.TestCase):
    def setUp(self):
        self.http = FakeTransport()
        self.now = 0
        self.fetch = Fetcher(["docs.example.org"], clock=lambda: self.now, transport=self.http,
                             max_entries=2, ttl=15)

    def error(self, url, code):
        with self.assertRaises(FetchError) as got:
            self.fetch.get(url)
        self.assertEqual(got.exception.code, code)

    def test_cache_refresh_expiry_byte_and_entry_cap(self):
        prefix = "https://docs.example.org/"
        first = self.fetch.get(prefix + "a")
        self.assertEqual(first, (b"<p>Document</p>", "text/html; charset=utf-8", False))
        self.assertTrue(self.fetch.get(prefix + "a#frag")[2])
        self.assertFalse(self.fetch.get(prefix + "a", refresh=True)[2])
        self.now += 16
        self.assertFalse(self.fetch.get(prefix + "a")[2])
        self.fetch.get(prefix + "b")
        self.fetch.get(prefix + "c")
        self.assertFalse(self.fetch.get(prefix + "a")[2])
        self.assertEqual(sum(p == "/robots.txt" for h, p in self.http.calls), 1)
        tiny = Fetcher(["docs.example.org"], transport=self.http, max_cache_bytes=2)
        self.assertFalse(tiny.get(prefix)[2])
        self.assertFalse(tiny.get(prefix)[2])

    def test_literal_hosts_and_normalized_urls(self):
        origin = "https://docs.example.org"
        for url in ("http://docs.example.org/", origin + ":8080/",
                    "https://name:pw@docs.example.org/", origin + "/x/%2e%2e/y",
                    origin + "/x%2Fy", origin + "/a%xx", origin + "/a\n"):
            with self.subTest(url=url):
                self.error(url, "invalid_url")
        for url in ("https://sub.docs.example.org/", "https://docs.example.org.invalid/"):
            self.error(url, "host_not_allowed")
        self.assertFalse(self.http.calls)
        self.fetch.get(origin + ":443/caf%C3%A9?fr=oui#fragment")
        self.assertEqual(self.http.calls[-1], ("docs.example.org", "/caf%C3%A9?fr=oui"))

    def test_disallowed_and_unavailable_robots_stop_before_document(self):
        self.http.replies["/robots.txt"] = (200, {"content-type": "text/plain"},
                                           b"User-agent: *\nDisallow: /secret*")
        self.error("https://docs.example.org/secrets", "robots_denied")
        self.now += 300
        self.http.replies["/robots.txt"] = (503, {}, b"")
        self.error("https://docs.example.org/other", "origin_status")
        self.now += 300
        self.http.replies["/robots.txt"] = (200, {"content-type": "text/html"}, b"<p>Error</p>")
        self.error("https://docs.example.org/other", "invalid_robots")
        self.assertTrue(all(path == "/robots.txt" for _, path in self.http.calls))

    def test_rep_wildcards_exact_merge_ties_and_utf8(self):
        robots = ("User-agent: *\nDisallow: /\n"
                  "User-agent: AutoFindexReader\nDisallow: /*.pdf$\n"
                  "Disallow: /caf%C3%A9\nDisallow: /context\n"
                  "User-agent: autofindexreader\nAllow: /context\nAllow: /open.pdf$").encode()
        for path in ("/ok", "/open.pdf", "/file.pdf?render", "/%63ontext"):
            self.assertTrue(_robots_allows(robots, path), path)
        for path in ("/x.pdf", "/caf%C3%A9", "/café/suite"):
            self.assertFalse(_robots_allows(robots, path), path)

    def test_redirect_challenge_size_and_rate_limit_have_no_retries(self):
        prefix = "https://docs.example.org"
        for reply, code in [((302, {"location": "https://elsewhere.org/"}, b""), "origin_redirect"),
                            ((401, {}, b""), "origin_status"), ((403, {}, b""), "origin_status"),
                            ((429, {}, b""), "origin_status"),
                            ((200, {"cf-mitigated": "challenge"}, b""), "origin_challenge"),
                            ((200, {"content-type": "text/html"}, b"<title>Just a Moment...</title>"),
                             "origin_challenge"),
                            ((200, {}, b"a" * (DOCUMENT_LIMIT + 1)), "origin_too_large")]:
            self.http.replies["/test"] = reply
            before = len(self.http.calls)
            self.error(prefix + "/test", code)
            self.assertEqual([(h, p) for h, p in self.http.calls[before:] if p != "/robots.txt"],
                             [("docs.example.org", "/test")])

    def test_global_dns_guard(self):
        for ip in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "ff02::1",
                   "224.0.0.1", "64:ff9b::1", "::ffff:127.0.0.1", "192.168.1.1", "100.64.0.1"):
            self.assertFalse(_public_address(ip), ip)
        self.assertTrue(_public_address("1.1.1.1"))
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))
                     for ip in ("1.1.1.1", "127.0.0.1")]
        with patch("socket.getaddrinfo", return_value=addresses) as resolver, patch("socket.socket") as sock:
            with self.assertRaises(FetchError) as caught:
                _https_get("docs.example.org", "/", DOCUMENT_LIMIT, 1)
            resolver.assert_called_once_with("docs.example.org.", 443, type=socket.SOCK_STREAM)
            sock.assert_not_called()
            self.assertEqual(caught.exception.code, "private_address")

    def test_tls_uses_origin_identity_and_connects_to_vetted_address(self):
        addr = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("1.1.1.1", 443))
        with contextlib.ExitStack() as stack:
            resolver = stack.enter_context(patch("fetch_document._resolve", return_value=addr))
            sock = stack.enter_context(patch("socket.socket")).return_value.__enter__.return_value
            ctx = stack.enter_context(patch("ssl.create_default_context")).return_value
            conn = stack.enter_context(patch("http.client.HTTPConnection")).return_value
            resp = conn.getresponse.return_value.__enter__.return_value
            resp.status, resp.read.return_value = 200, b"abcd"
            resp.getheaders.return_value = [("Content-Length", "4")]
            self.assertEqual(_https_get("docs.example.org", "/x", DOCUMENT_LIMIT, 1)[2], b"abcd")
            resolver.assert_called_once()
            sock.connect.assert_called_once_with(("1.1.1.1", 443))
            ctx.wrap_socket.assert_called_once_with(sock, server_hostname="docs.example.org",
                                                    do_handshake_on_connect=False)

    def test_no_store_and_limits(self):
        self.http.replies["/a"] = (200, {"cache-control": "public, no-store"}, b"ok")
        for _ in range(2):
            self.assertFalse(self.fetch.get("https://docs.example.org/a")[2])
        self.http.replies["/b"] = (200, {"cache-control": "max-age=5", "age": "3"}, b"ok")
        self.assertFalse(self.fetch.get("https://docs.example.org/b")[2])
        self.now = 1
        self.assertTrue(self.fetch.get("https://docs.example.org/b")[2])
        self.now = 2
        self.assertFalse(self.fetch.get("https://docs.example.org/b")[2])
        with self.assertRaises(ValueError):
            Fetcher(["*.example.org"])
        with self.assertRaises(ValueError):
            Fetcher(["1.1.1.1"])


if __name__ == "__main__":
    unittest.main()
