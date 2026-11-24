import ipaddress
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

import own_fetch as reader

DETAIL = "https://www.leparking.fr/voiture-occasion-detail/bmw/vehicle/ID.html"
ROBOT = reader.Response(200, "text/plain", b"User-agent: *\nDisallow: /tools/")
PAGE = reader.Response(200, "text/html", b"<html><title>BMW 320</title><h1>BMW 320</h1></html>")


class ReaderTests(unittest.TestCase):
    def test_accepted_html_and_receipt(self):
        fetch = Mock(side_effect=[ROBOT, PAGE])
        receipt, doc = reader.read_public_html(DETAIL, transport=fetch)
        self.assertEqual(doc, PAGE.body)
        self.assertEqual(receipt["html_bytes"], len(PAGE.body))
        self.assertEqual(receipt["requests"], 2)
        self.assertEqual([c.args[0] for c in fetch.call_args_list], ["https://www.leparking.fr/robots.txt", DETAIL])
        self.assertNotIn("ID.html", json.dumps(receipt))

    def test_admission_precedes_requests(self):
        invalid = ["http://www.leparking.fr/voiture-occasion-detail/model",
                   DETAIL.replace("www.leparking.fr", "www.leparking.fr@localhost"),
                   DETAIL.replace("www.leparking.fr", "www.leparking.fr.example.com"),
                   DETAIL.replace("www.leparking.fr", "www.leparking.fr:443"),
                   DETAIL.replace("www.leparking.fr", "127.0.0.1"),
                   DETAIL.replace("www.leparking.fr", "www.autoscout24.de"),
                   DETAIL.replace("/voiture-occasion-detail/", "/tools/"),
                   DETAIL.replace("/bmw/", "/%2e%2e/"), DETAIL.replace("/bmw/", "/%252e%252e/"),
                   DETAIL.replace("/bmw/", "/%2f/"), DETAIL + "#fragment"]
        fetch = Mock()
        for url in invalid:
            with self.subTest(url=url):
                self.assertEqual(reader.read_public_html(url, transport=fetch)[0]["result"], "url_rejected")
        fetch.assert_not_called()

    def test_operator_approved_origin(self):
        url = "https://cars.example.com/item/3"
        receipt, _ = reader.read_public_html(url, routes={"cars.example.com": ["/item/"]}, transport=Mock(side_effect=[ROBOT, PAGE]))
        self.assertEqual(receipt["result"], "html_received")

    def test_default_routes_include_supplied_results_url(self):
        url = "https://www.leparking.fr/voiture-occasion/model.html"
        receipt, doc = reader.read_public_html(url, transport=Mock(side_effect=[ROBOT, PAGE]))
        self.assertEqual(receipt["result"], "html_received")
        self.assertEqual(receipt["requests"], 2)
        self.assertIsNotNone(doc)

    def test_managed_egress_needs_operator_verified_host(self):
        routes = {"cars.example.com": ["/item/"]}
        url = "https://cars.example.com/item/3"
        with patch.object(reader, "getproxies", return_value={"https": "runtime-egress"}), patch.object(
            reader, "proxy_bypass", return_value=False
        ), patch.object(reader, "build_opener") as opener:
            receipt, _ = reader.read_public_html(url, routes=routes)
            self.assertEqual(receipt["result"], "egress_host_unverified")
            self.assertEqual(receipt["requests"], 0)
            opener.assert_not_called()
            reply = MagicMock()
            reply.getcode.return_value = 200
            reply.headers.get_content_type.side_effect = ["text/plain", "text/html"]
            reply.read.side_effect = [ROBOT.body, PAGE.body]
            opener.return_value.open.return_value = reply
            receipt, doc = reader.read_public_html(url, routes=routes, trusted_egress_hosts={"cars.example.com"})
            self.assertEqual(receipt["result"], "html_received")
            self.assertEqual(doc, PAGE.body)
            receipt, _ = reader.read_public_html(url, trusted_egress_hosts={"cars.example.com"})
            self.assertEqual(receipt["result"], "url_rejected")

    def test_private_dns_rejected_in_direct_transport(self):
        for ip in ("10.2.1.2", "127.0.0.1", "169.254.169.254", "224.0.0.1", "::1", "fd00::1"):
            family = socket.AF_INET6 if ipaddress.ip_address(ip).version == 6 else socket.AF_INET
            with self.subTest(ip=ip), patch.object(reader, "getproxies", return_value={}), patch.object(
                reader.socket, "getaddrinfo", return_value=[(family, socket.SOCK_STREAM, 6, "", (ip, 443))]
            ), patch.object(reader.socket, "socket") as connection:
                with self.assertRaises(OSError):
                    reader.get(DETAIL, 100)
                connection.assert_not_called()

    def test_robots_refusal_and_unreadable_content(self):
        for robots, result in [
            (reader.Response(200, "text/plain", b"User-agent: *\nDisallow: /"), "robots_disallow"),
            (reader.Response(403, "text/plain", b""), "robots_unavailable"),
            (reader.Response(301, "text/plain", b""), "robots_unavailable"),
            (reader.Response(500, "text/plain", b""), "robots_unavailable"),
            (reader.Response(200, "text/html", b"<html/>"), "robots_unusable"),
            (reader.Response(200, "text/plain", b"User-agent: *", True), "robots_unusable"),
        ]:
            with self.subTest(result=result, status=robots.status):
                fetch = Mock(return_value=robots)
                receipt, doc = reader.read_public_html(DETAIL, transport=fetch)
                self.assertEqual(receipt["result"], result)
                self.assertIsNone(receipt["detail_http"])
                self.assertIsNone(doc)
                fetch.assert_called_once()

    def test_robots_group_precedence_and_allow_ties(self):
        rules = ("User-agent: *\nDisallow: /\nUser-agent: AutoFindex\nDisallow: /*.html$\n"
                 "User-agent: AUTOFINDEX\nAllow: /voiture-occasion-detail/\n"
                 "Disallow: /voiture-occasion-detail/\nCrawl-delay: 1.5")
        self.assertEqual(reader.robots_access(rules, DETAIL), (True, 1.5))
        self.assertEqual(reader.robots_access(rules, "https://www.leparking.fr/other.html"), (False, 1.5))

    def test_robots_wildcards_anchors_and_encoded_paths(self):
        rules = "User-agent: *\nDisallow: /p*t/file.html$\nDisallow: /z/b"
        for path, allowed in [("/pot/file.html", False), ("/pot/file.html?x", True),
                              ("/t/file.html", True), ("/z/%62", False)]:
            self.assertEqual(reader.robots_access(rules, "https://host.example" + path), (allowed, 0))
        self.assertFalse(reader.path_rule_matches("/abc*bc$", "/abc"))
        self.assertTrue(reader.path_rule_matches("/a*b*c$", "/abbc"))

    def test_delay_observed_or_request_stopped(self):
        for delay, count in ((1, 2), (100000, 1)):
            rules = reader.Response(200, "text/plain", f"User-agent: *\nCrawl-delay: {delay}".encode())
            pause = Mock()
            receipt, _ = reader.read_public_html(DETAIL, transport=Mock(side_effect=[rules, PAGE]), sleeper=pause)
            self.assertEqual(receipt["requests"], count)
            if delay == 1:
                pause.assert_called_once_with(delay)
            else:
                pause.assert_not_called()

    def test_unavailable_robots_resource(self):
        for status in (404, 410):
            receipt, _ = reader.read_public_html(DETAIL, transport=Mock(side_effect=[reader.Response(status, "text/html", b""), PAGE]))
            self.assertEqual(receipt["result"], "html_received")

    def test_detail_statuses_and_content(self):
        reasons = [
            (reader.Response(301, "text/html", b""), "redirect_stopped"),
            (reader.Response(403, "text/html", b""), "http_refusal"),
            (reader.Response(429, "text/html", b""), "http_refusal"),
            (reader.Response(404, "text/html", b""), "http_error"),
            (reader.Response(200, "application/json", b"{}"), "unexpected_content_type"),
            (reader.Response(200, "text/html", b"  "), "empty_body"),
            (reader.Response(200, "text/html", b"<title>OK</title>", True), "response_too_large"),
            (reader.Response(200, "text/html", b"<title>Just a moment...</title>"), "verification_or_consent"),
            (reader.Response(200, "text/html", b"<h1>Consent required</h1>"), "verification_or_consent"),
            (reader.Response(200, "text/html", b'<iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>'), "verification_or_consent"),
        ]
        for detail, reason in reasons:
            with self.subTest(reason=reason, status=detail.status):
                fetch = Mock(side_effect=[ROBOT, detail])
                receipt, doc = reader.read_public_html(DETAIL, transport=fetch)
                self.assertEqual(receipt["result"], reason)
                self.assertEqual(fetch.call_count, 2)
                self.assertIsNone(doc)

    def test_transport_exception_only_one_attempt(self):
        fetch = Mock(side_effect=socket.timeout())
        receipt, doc = reader.read_public_html(DETAIL, transport=fetch)
        fetch.assert_called_once()
        self.assertEqual(receipt["result"], "transport_error")
        self.assertIsNone(doc)

    def test_incidental_consent_and_bot_words(self):
        page = b"<html><title>BMW 320</title><h1>BMW 320</h1><p>" + b"Car facts. " * 200 + b"</p><footer>Accept cookies</footer><script>captcha</script></html>"
        self.assertFalse(reader.looks_gated(page))

    def test_private_atomic_file_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp, "detail.html")
            reader.save_new_private(path, b"1")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                reader.save_new_private(path, b"2")
            self.assertEqual(path.read_bytes(), b"1")
            self.assertEqual(list(Path(temp).iterdir()), [path])

    def test_cli_rejects_nonpilot_before_network(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp, "out.html")
            proc = subprocess.run([sys.executable, reader.__file__, "https://localhost/item/1", "--output", str(out)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 1)
            self.assertEqual(json.loads(proc.stdout)["requests"], 0)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
