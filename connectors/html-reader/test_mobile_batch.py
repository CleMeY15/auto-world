"""Offline integration of catalog progress, non-retrying refusals and safe replay."""
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from custom_detail import DetailError
from mobile_batch import exclusive_state, run_batch
from own_fetch import Response


HOST = "https://suchen.mobile.de"
A = HOST + "/fahrzeuge/details.html?id=101&vip=1"
B = HOST + "/fahrzeuge/details.html?id=102&vip=1"
DB = "autofindex_trial_catalog_test"
ALLOW = Response(200, "text/plain", b"User-agent: *\nAllow: /\n")


def good(number):
    url = f"{HOST}/fahrzeuge/details.html?id={number}"
    return Response(200, "text/html",
                    (f'<link rel="canonical" href="{url}"><h1>Marque Exemple</h1>'
                     '<p>Kilometerstand: 10.000 km</p><p>Erstzulassung: 2020</p><p>Preis: 21.000 EUR</p>').encode())


class BatchProgressTests(unittest.TestCase):
    def setUp(self):
        storage = tempfile.TemporaryDirectory()
        self.addCleanup(storage.cleanup)
        self.manifest = Path(storage.name) / "urls.txt"
        self.state = Path(storage.name) / "state.sqlite"
        self.manifest.write_text(A + "\n" + B + "\n" + A + "\n")
        short_wait = patch("mobile_batch.time.sleep")
        self.sleep = short_wait.start()
        self.addCleanup(short_wait.stop)

    def run_batch(self, **options):
        return run_batch(self.manifest, self.state, DB, 1, **options)

    def test_verified_then_403_persists_and_needs_publisher_clearance(self):
        replies = [ALLOW, good("101"), ALLOW, Response(403,"text/html",b"")]
        with patch("own_fetch.get", side_effect=replies) as http, \
                patch("mobile_batch.import_observations", return_value={"verified": 1, "inserted": 1}) as db:
            stopped = self.run_batch()
            self.assertEqual([x.args[0] for x in http.call_args_list], [HOST+"/robots.txt", A, HOST+"/robots.txt", B])
            self.assertEqual(db.call_count, 1)
        self.assertEqual((stopped["supplied"], stopped["distinct_urls"], stopped["verified"], stopped["pending"]),
                         (3, 2, 1, 1))
        self.assertEqual((stopped["stop"]["code"],stopped["stop"]["http"]["detail_http"]),("http_refusal",403))
        with patch("own_fetch.get") as http, patch("mobile_batch.import_observations") as db:
            self.assertEqual(self.run_batch(), stopped)
            self.assertEqual(self.run_batch(resume_after_repair=True), stopped)
            http.assert_not_called()
            db.assert_not_called()
        with patch("own_fetch.get", side_effect=[ALLOW, good("102")]) as http, \
                patch("mobile_batch.import_observations", return_value={"verified": 1,"inserted": 1}):
            done = self.run_batch(resume_after_clearance=True)
            self.assertEqual(http.call_count, 2)
        self.assertEqual((done["status"],done["verified"],done["inserted"],done["pending"]),("completed",2,2,0))
        self.assertTrue(self.sleep.called)
        with patch("own_fetch.get") as http:
            self.assertEqual(self.run_batch(), done)
            http.assert_not_called()

    def test_robots_challenge_and_rate_limit_halt_all_remaining_urls(self):
        cases = [
            ([Response(200, "text/plain", b"User-agent: *\nDisallow: /\n")], "robots_disallow"),
            ([ALLOW, Response(200, "text/html", b"<title>Verify You Are Human</title>")], "verification_or_consent"),
            ([ALLOW, Response(429, "text/html", b"")], "http_refusal"),
        ]
        for index, (replies, reason) in enumerate(cases):
            state = self.state.with_name(f"state-{index}.sqlite")
            with self.subTest(reason=reason), patch("own_fetch.get", side_effect=replies) as http, \
                    patch("mobile_batch.import_observations") as db:
                report = run_batch(self.manifest, state, DB, 5)
                self.assertEqual((report["stop"]["code"], report["verified"], report["pending"]), (reason, 0, 2))
                self.assertEqual(report, run_batch(self.manifest, state, DB, 5))
                self.assertEqual(http.call_count, len(replies))
                db.assert_not_called()

    def test_verified_same_saved_document_after_interrupted_pg_commit(self):
        self.manifest.write_text(A+"\n")
        with patch("own_fetch.get", side_effect=[ALLOW,good("101")]), \
                patch("mobile_batch.import_observations", side_effect=KeyboardInterrupt) as first:
            with self.assertRaises(KeyboardInterrupt):
                self.run_batch()
        first_payload = first.call_args.args[1]
        with patch("own_fetch.get") as net, \
                patch("mobile_batch.import_observations", return_value={"verified": 1,"inserted": 0}) as replay:
            result = self.run_batch()
            net.assert_not_called()
            replay.assert_called_once_with(DB, first_payload)
        self.assertEqual((result["verified"],result["inserted"],result["pending"]), (1,0,0))

    def test_db_error_stays_staged_and_retry_follows_local_repair(self):
        self.manifest.write_text(A+"\n")
        with patch("own_fetch.get", side_effect=[ALLOW,good("101")]), \
                patch("mobile_batch.import_observations", side_effect=RuntimeError("database unavailable")):
            failed = self.run_batch()
        self.assertEqual(failed["stop"]["code"],"postgres_unverified")
        with patch("own_fetch.get") as net, \
                patch("mobile_batch.import_observations", return_value={"verified":1,"inserted":1}) as db:
            self.assertEqual(self.run_batch(),failed)
            self.assertEqual(self.run_batch(resume_after_clearance=True),failed)
            db.assert_not_called()
            self.assertEqual(self.run_batch(resume_after_repair=True)["verified"],1)
            net.assert_not_called()

    def test_unknown_outcome_of_inflight_request_never_automatically_retried(self):
        with patch("own_fetch.get",side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.run_batch()
        with patch("own_fetch.get") as net:
            res = self.run_batch()
            self.assertEqual((res["stop"]["code"],res["verified"],res["pending"]),("interrupted_fetch",0,2))
            net.assert_not_called()

    def test_manifest_and_database_bound_to_checkpoint_and_lock_exclusive(self):
        with patch("own_fetch.get",side_effect=[ALLOW,Response(429,"text/plain",b"")]):
            self.run_batch()
        with patch("own_fetch.get") as net:
            with self.assertRaisesRegex(DetailError,"different manifest or database"):
                run_batch(self.manifest,self.state,DB+"2",1)
            self.manifest.write_text(A+"\n")
            with self.assertRaisesRegex(DetailError,"different manifest or database"):
                self.run_batch()
            with exclusive_state(self.state):
                with self.assertRaisesRegex(DetailError,"Another process"):
                    self.run_batch()
            net.assert_not_called()

    def test_invalid_manifest_is_atomic_and_no_requests_made(self):
        self.manifest.write_text(A+"\nhttps://other.example/\n")
        with patch("own_fetch.get") as net:
            with self.assertRaisesRegex(DetailError, "Line 2"):
                self.run_batch()
            net.assert_not_called()
        with closing(sqlite3.connect(self.state)) as state:
            self.assertEqual(state.execute("SELECT count(*) FROM mobile_jobs").fetchone()[0], 0)

    def test_disappeared_native_ad_counted_separately_with_no_record(self):
        self.manifest.write_text(A+"\n")
        with patch("own_fetch.get",side_effect=[ALLOW,Response(410,"text/plain",b"")]), \
                patch("mobile_batch.import_observations") as db:
            r=self.run_batch()
            db.assert_not_called()
        self.assertEqual((r["status"],r["unavailable"],r["verified"],r["last_http"]["detail_http"]),
                         ("completed",1,0,410))


if __name__ == "__main__":
    unittest.main()
