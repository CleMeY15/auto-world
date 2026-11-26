import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from project_export import Policy, Rejected
from sync_exports import synchronize


class SyncTests(unittest.TestCase):
    def test_only_completed_native_files_are_imported_and_missing_database_rows_are_retried(self):
        now = datetime.now(timezone.utc)
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            state = folder / "state"
            state.mkdir(mode=0o700)
            source = folder / "listings_rust_v2_20261126_000001.json"
            source.write_text("[]")
            old = source.with_name("listings_rust_v2_20250101_000001.json")
            old.write_text("[]")
            (folder / "unrelated.json").write_text("[]")
            fresh = source.with_name("listings_rust_v2_20261126_000002.json")
            fresh.write_text("[")
            os.utime(source, (now.timestamp() - 60,) * 2)
            os.utime(old, (now.timestamp() - 86400,) * 2)
            args = (folder, now - timedelta(hours=1), state, folder / "policy", "private")
            days = timedelta(days=3)
            scope = Policy(now - days, now + days, days, days, days)
            success = dict(status="inserted", export_sha256="a"*64, retain_until=(now+days).isoformat(), rows=2)
            with patch("sync_exports.load_policy", return_value=scope), patch(
                "sync_exports.active_exports", side_effect=[(set(),0),(set(),0),({"a"*64},0),(set(),0)]
            ), patch("sync_exports.process", side_effect=[Rejected("incomplete_export"), success, success]) as process:
                self.assertEqual(synchronize(*args)["rejected"], 1)
                self.assertEqual(synchronize(*args)["new_export_rows"], 2)
                self.assertEqual(synchronize(*args)["new_exports"], 0)
                self.assertEqual(synchronize(*args)["new_export_rows"], 2)
                self.assertEqual([call.args[0] for call in process.call_args_list], [source]*3)
