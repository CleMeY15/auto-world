import contextlib
import io
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from collect_parking_trial import run, validate_url
from test_leparking_html import card, result_cards


def html_card(i, price="5 000 €"):
    ident = f"TST{i:05d}"
    link = f"/voiture-occasion-detail/exemple/voiture/{ident}.html"
    return card(link=link, detail=link, title=f"Voiture de test {i}", price=price)


class TrialCollectionTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        self.urls = self.root / "urls.txt"
        self.out = self.root / "run"
        self.args = Namespace(urls=self.urls, out=self.out, gap=3, max_pages=140,
                              seed_url=None, seed_html=None, offline=False)

    def execute(self, values):
        items = {f"https://www.leparking.fr/voiture-occasion/test-{i}.html": v for i, v in enumerate(values)}
        if not self.urls.exists():
            self.urls.write_text("\n".join(items))
        calls = []

        def fetch(url):
            self.assertIn(url, items)
            calls.append(url)
            value = items[url]
            if isinstance(value, str):
                return value.encode(), {"status": "received", "http": 200}
            return value

        with patch("collect_parking_trial.time.sleep"), contextlib.redirect_stdout(io.StringIO()):
            return run(self.args, fetch), calls

    def test_only_search_destinations(self):
        for url in ("https://www.leparking.fr/tools/ID", "https://example.com/voiture-occasion/a",
                    "https://u@www.leparking.fr/voiture-occasion/x", "https://www.leparking.fr/voiture-occasion/%2e%2e/admin",
                    "https://www.leparking.fr/voiture-occasion/x.html#!/page2"):
            with self.assertRaises(ValueError):
                validate_url(url)

    def test_exact_target_overread_and_offline(self):
        pages = [result_cards(*(html_card(i) for i in range(start, start+65))) for start in range(0, 2010, 64)]
        rec, calls = self.execute(pages)
        self.assertTrue(rec["goal_met"])
        self.assertEqual(len(calls), 32)
        self.assertEqual(rec["selected"], 2000)
        self.assertEqual(rec["complete_available"], 2049)
        self.assertEqual(rec["repeat_observations"], 31)
        out = json.loads((self.out / rec["private_output"]).read_text())
        self.assertEqual(len(out["rows"]), 2000)
        self.args.offline = True
        redone, calls = self.execute([])
        self.assertFalse(calls)
        self.assertEqual(redone["selected"], 2000)

    def test_refusal_preserves_partial_and_cannot_automatically_retry(self):
        pages = [result_cards(html_card(1)), (None, {"status":"rate_limited","http":429}), result_cards(html_card(2))]
        rec, calls = self.execute(pages)
        self.assertEqual((len(calls), rec["selected"], rec["stop_reason"]), (2,1,"rate_limited"))
        again, calls = self.execute([])
        self.assertFalse(calls)
        self.assertEqual(again["stop_reason"], "rate_limited")

    def test_conflict_only_page_quarantines_a_previously_valid_record(self):
        pages = [result_cards(html_card(1), html_card(2)), result_cards(html_card(1), html_card(1,"8 000 €"))]
        rec, _ = self.execute(pages)
        self.assertEqual((rec["selected"],rec["conflicting_unique"]),(1,1))

    def test_verification_with_stale_visible_cards_stops_and_discards_body(self):
        rec, calls = self.execute(["<title>Access denied</title>"+result_cards(html_card(1)),
                                   result_cards(html_card(2))])
        self.assertEqual((rec["selected"], rec["stop_reason"], len(calls)), (0,"verification_signal",1))
        self.assertFalse(list((self.out/"pages").glob("*.html")))

    def test_transient_and_removed_search_can_be_followed_by_next_listed_url(self):
        rec, calls = self.execute([(None, {"status":"not_found","http":410}),
                                   (None, {"status":"network_error","reason":"TimeoutError"}),
                                   result_cards(html_card(1))])
        self.assertEqual((len(calls),rec["selected"],rec["stop_reason"]), (3,1,"inventory_exhausted"))

    def test_systematic_layout_failures_produce_explicit_partial_receipt(self):
        rec, calls = self.execute([result_cards(html_card(1))] + ["<html>unknown layout</html>"]*4)
        self.assertEqual((rec["selected"],rec["stop_reason"],len(calls)), (1,"systematic_unrecognized",4))

class TransportTests(unittest.TestCase):
    def test_redirects_remain_same_site_and_search_pages(self):
        from urllib.request import Request
        from collect_parking_trial import SearchRedirect, UnsafeRedirect
        src = "https://www.leparking.fr/voiture-occasion/clio.html"
        dst = "https://www.leparking.fr/voiture-occasion/renault-clio.html"
        redir = SearchRedirect(3)
        with patch("collect_parking_trial.time.sleep") as pause:
            output = redir.redirect_request(Request(src), None, 301, "Moved", {}, dst)
        self.assertEqual((output.full_url, redir.hops), (dst,[dst]))
        pause.assert_called_once_with(3)
        for path in (dst,"http://www.leparking.fr/voiture-occasion/a.html",
                     "https://example.com/voiture-occasion/clio.html",
                     "https://www.leparking.fr/voiture-occasion-detail/x.html"):
            with self.assertRaises(UnsafeRedirect):
                redir.redirect_request(Request(dst), None, 302, "Moved", {}, path)

    def test_intermediary_metadata_contains_no_verbatim_server_or_challenge(self):
        from urllib.error import HTTPError
        from collect_parking_trial import refusal_metadata
        e = HTTPError("https://www.leparking.fr/", 403, "Forbidden", {
            "Server":"envoy/some-token", "X-Mitmproxy-Blocked-Reason":"ROBOTS_DENIED",
            "X-Deny-Reason":"opaque-sensitive", "Retry-After":"120", "Set-Cookie":"opaque-sensitive"
        }, io.BytesIO(b"opaque-sensitive"))
        meta = refusal_metadata(e)
        self.assertEqual((meta["robots_denied_marker"],meta["intermediary_marked"],
                          meta["denial_attribution"],meta["retry_after_seconds"]),
                         (True,True,"intermediary_indicated",120))
        self.assertEqual(meta["server_product"], "envoy")
        self.assertNotIn("opaque-sensitive", repr(meta))
        self.assertNotIn("some-token",repr(meta))
        e.close()
