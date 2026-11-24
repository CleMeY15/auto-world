import io
import json
from datetime import datetime, timedelta
from email.message import Message
import unittest
from unittest.mock import Mock

from own_fetch import MAX_REFUSAL_SAMPLE, Response, read_public_html, read_response

URL = "https://cars.example.com/item/a"
ROUTES = {"cars.example.com": ["/item/"]}
ROBOTS = Response(200, "text/plain", b"User-agent: *\nAllow: /")


def response(status, data, typ="text/html", headers=(), reader=None):
    payload = Message()
    payload["Content-Type"] = typ
    for key, value in headers:
        payload[key] = value
    reply = Mock()
    reply.headers = payload
    reply.read.side_effect = reader or io.BytesIO(data).read
    return read_response(reply, status, 102400), reply


class RefusalReceiptTests(unittest.TestCase):
    def test_page_refusal_uses_redacted_signals(self):
        sid = "0728eed3-8c13-4aab-a97f-620dc25925fa"
        data = (b"<title>Access Denied</title><p>Reference #18.206bdc17.1760980451.98ab17c2</p>"
                b"<script>captcha credential</script><p>do-not-publish-our-body</p>")
        refused, reply = response(403, data, headers=[("X-Request-ID", sid), ("Set-Cookie","session=private"),
                                                      ("Authorization","Bearer secret"), ("Location","/private")])
        fetch = Mock(side_effect=[ROBOTS, refused])
        receipt, html = read_public_html(URL, routes=ROUTES, transport=fetch)
        self.assertIsNone(html)
        self.assertEqual(refused.body, b"")
        self.assertEqual((receipt["stage"], receipt["detail_http"], receipt["requests"]), ("page",403,2))
        self.assertEqual(receipt["support"], {"media_type":"text/html", "inspected_bytes":len(data),
            "sample_truncated":False, "recognized_title":"access denied", "explicit_captcha_text":False,
            "explicit_human_check_text":False,"reference":"18.206bdc17.1760980451.98ab17c2",
            "x-request-id":sid})
        self.assertEqual(datetime.fromisoformat(receipt["started_at_utc"]).utcoffset(), timedelta(0))
        for private in ("do-not-publish", "credential", "session=", "Set-Cookie", "Bearer", "/private"):
            self.assertNotIn(private, json.dumps(receipt))
        reply.read.assert_called_once_with(MAX_REFUSAL_SAMPLE + 1)

    def test_robots_refusal_stops_before_advertisement(self):
        refused, _ = response(429, b"Verify that you are human. CAPTCHA.", "text/plain")
        fetch = Mock(return_value=refused)
        receipt, html = read_public_html(URL, routes=ROUTES, transport=fetch)
        self.assertIsNone(html)
        self.assertEqual((receipt["stage"], receipt["robots_http"], receipt["detail_http"]), ("robots",429,None))
        self.assertTrue(receipt["support"]["explicit_captcha_text"])
        self.assertTrue(receipt["support"]["explicit_human_check_text"])
        fetch.assert_called_once()

    def test_unknown_or_truncated_sample_uses_bounded_identifiers(self):
        data = b"<title>Private page title</title>" + b" " * MAX_REFUSAL_SAMPLE + b" CAPTCHA "
        hdrs = [("X-Request-ID","1111222233334444"), ("X-Request-ID","5555666677778888"),
                ("X-Correlation-ID","ordinary-private-words")]
        refused, _ = response(403, data, headers=hdrs)
        self.assertEqual(refused.support, {"media_type":"text/html", "inspected_bytes": MAX_REFUSAL_SAMPLE,
            "sample_truncated":True, "explicit_captcha_text":False, "explicit_human_check_text":False})
        self.assertEqual(refused.body, b"")

    def test_unavailable_sample_preserves_status(self):
        for mime, hdrs, effect in (("application/octet-stream", [], None),
                                   ("text/html", [("Content-Encoding", "gzip")], None),
                                   ("text/html", [], TimeoutError("do-not-disclose"))):
            with self.subTest(mime=mime, hdrs=hdrs):
                result, reply = response(403, b"secret", mime, hdrs, reader=effect)
                self.assertEqual(result.status, 403)
                self.assertEqual(result.body,b"")
                self.assertEqual(result.support["inspected_bytes"],0)
                self.assertNotIn("explicit_captcha_text", result.support)
                if not effect:
                    reply.read.assert_not_called()

    def test_success_exposes_no_support_header_but_gated_200_does(self):
        headers = [("X-Correlation-ID","123456789abcdef0")]
        for body, gated in ((b"<title>BMW</title>", False), (b"<title>Access Denied</title>", True)):
            with self.subTest(gated=gated):
                res, _ = response(200, body, headers=headers)
                receipt, html = read_public_html(URL, routes=ROUTES, transport=Mock(side_effect=[ROBOTS, res]))
                self.assertEqual("support" in receipt, gated)
                self.assertEqual(html, None if gated else body)
                if gated:
                    self.assertEqual(receipt["support"]["x-correlation-id"], "123456789abcdef0")


if __name__ == "__main__":
    unittest.main()
