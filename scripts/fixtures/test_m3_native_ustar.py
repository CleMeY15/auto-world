import io
import json
import runpy
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from tempfile import TemporaryFile
from unittest.mock import patch

import m3_native_ustar as fixture


class DeadlineTests(unittest.TestCase):
    def test_expired_watchdog_setup_kills_and_reaps_the_extractor(self):
        with TemporaryFile() as archive:
            # This child exits successfully on its own. Cleanup must terminate it first.
            child = subprocess.Popen(
                [sys.executable, "-I", "-c", "import time; time.sleep(3)"],
                stdin=archive, stdout=subprocess.PIPE,
            )
            try:
                listing = (fixture.MANIFEST + "\nobjects/test\n").encode("ascii")
                with patch.object(subprocess, "check_output", return_value=listing), \
                     patch.object(subprocess, "Popen", return_value=child), \
                     patch.object(fixture, "remaining", side_effect=[10, TimeoutError("expired")]):
                    with self.assertRaisesRegex(TimeoutError, "expired"):
                        fixture.native_read("tar", archive, b"manifest", "objects/test", 0, "")
                self.assertIsNotNone(child.returncode)
                self.assertNotEqual(child.returncode, 0)
                self.assertTrue(child.stdout.closed)
            finally:
                child.kill()
                child.wait()
                child.stdout.close()

    def test_git_timeout_is_in_the_failure_report(self):
        output = io.StringIO()
        timeout = subprocess.TimeoutExpired(["git", "rev-parse", "HEAD"], 30)
        with patch.object(subprocess, "check_output", side_effect=timeout) as git, \
             redirect_stdout(output), self.assertRaises(subprocess.TimeoutExpired):
            runpy.run_path(fixture.__file__, run_name="__main__")
        git.assert_called_once_with(["git", "rev-parse", "HEAD"], text=True, timeout=30)
        report = json.loads(output.getvalue())
        self.assertEqual(report["status"], "FAILED")
        self.assertIn("TimeoutExpired", report["error"])
        self.assertIn("finishedUtc", report)
