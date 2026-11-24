import io
import json
import os
from contextlib import redirect_stdout
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

import autoscout_partner
import mobile_de_search
from private_rows import write_rows
from test_mobile_de_search import offer, page
from test_autoscout_partner import FIELDS, shape


@unittest.skipUnless(os.name == "posix", "Private exports require POSIX permissions")
class PrivateExportTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)

    def run_cli(self, main, args):
        out = io.StringIO()
        with patch.object(sys, "argv", ["pilot", *args]), redirect_stdout(out):
            self.assertIn(main(), [0, None])
        return json.loads(out.getvalue())

    def test_private_file_and_existing_name_or_symlink_are_protected(self):
        path = self.folder / "batch.json"
        write_rows(path, "autoscout24", "partner-sandbox", [shape()])
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        snapshot = path.read_bytes()
        self.assertEqual(json.loads(snapshot)["count"], 1)
        link = self.folder / "link"
        link.symlink_to(path)
        for name in [path, link]:
            with self.assertRaises(FileExistsError):
                write_rows(name, "mobile.de", "live_api", [])
        self.assertEqual(path.read_bytes(), snapshot)
        self.assertTrue(link.is_symlink())
        self.assertEqual({p.name for p in self.folder.iterdir()}, {"batch.json", "link"})

    def test_serialization_failure_never_publishes_partial_file(self):
        with self.assertRaises(TypeError):
            write_rows(self.folder / "sales", "autoscout24", "partner-sandbox", [object()])
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_mobile_doc_and_saved_origins(self):
        xml = self.folder / "input.xml"
        xml.write_bytes(page(offer()))
        for test_args, expected in [
            (["--documentation-example"], "documentation_xml_example"), ([], "saved_xml")
        ]:
            path = self.folder / expected
            summary = self.run_cli(mobile_de_search.main, ["--xml", str(xml), "--output", str(path), *test_args])
            saved = json.loads(path.read_text())
            self.assertEqual((summary["mode"], saved["mode"], saved["source"], saved["count"]),
                             (expected, expected, "mobile.de", 1))
            self.assertEqual(saved["rows"][0]["source_id"], "401")
            self.assertNotIn("rows", summary)
        before = sorted(self.folder.iterdir())
        self.run_cli(mobile_de_search.main, ["--xml", str(xml)])
        self.assertEqual(sorted(self.folder.iterdir()), before)

    def test_mobile_production_and_sandbox_with_mocked_transport(self):
        for flags, mode in [([], "live_api"), (["--sandbox"], "sandbox_api")]:
            path = self.folder / mode
            result = mobile_de_search.parse_search_xml(page(offer()))
            env = {prefix + name: "test-private-marker" for prefix in
                   ("MOBILE_DE_API_", "MOBILE_DE_SANDBOX_") for name in ("USERNAME", "PASSWORD")}
            with patch.dict(os.environ, env), patch.object(mobile_de_search, "fetch_search", return_value=result):
                summary = self.run_cli(mobile_de_search.main, [*flags, "--output", str(path)])
            self.assertEqual(json.loads(path.read_text())["mode"], mode)
            self.assertEqual(summary["mode"], mode)
            self.assertNotIn("test-private-marker", json.dumps(summary) + path.read_text())

    def test_inactive_autoscout_read_example_never_becomes_live(self):
        path = self.folder / "example"
        sample_meta = {"example_rows": 1, "live_marketplace_rows": 0, "mode": "official-dealer-documentation-example"}
        sample_row = {**shape(), "source": "autoscout24"}
        with patch.object(autoscout_partner, "dealer_example", return_value=(sample_meta, sample_row)):
            summary = self.run_cli(autoscout_partner.main, ["--dealer-example", "--output", str(path)])
        self.assertEqual(summary, sample_meta)
        self.assertEqual(json.loads(path.read_text())["mode"], "official-dealer-documentation-example")

    def test_configured_autoscout_environments_and_private_header(self):
        query = self.folder / "query.graphql"
        query.write_text("query Demo($take: Int!) { items(take: $take) { title } }")
        for environment, mode in [("production", "contracted-marketplace-read"), ("sandbox", "partner-sandbox")]:
            contract = self.folder / "contract.json"
            contract.write_text(json.dumps({
                "endpoint": "https://example.as24.tech/gql", "trusted_origin": "https://example.as24.tech",
                "query_file": query.name, "environment": environment, "operation_name": "Demo",
                "limit_variable_path": ["take"], "variables": {"take": 1}, "rows_path": ["items"],
                "field_paths": {k: [k] for k in FIELDS},
            }))
            def mocked_reader(path, limit, auth):
                def transport(endpoint, headers, payload):
                    self.assertEqual(headers["Authorization"], "test-private-marker")
                    return {"data": {"items": [shape()]}}
                return original(path, limit, auth, transport)
            original = autoscout_partner.partner_search
            dest = self.folder / environment
            with patch.object(autoscout_partner, "partner_search", side_effect=mocked_reader), \
                    patch.dict(os.environ, {"AUTOSCOUT24_SEARCH_AUTHORIZATION": "test-private-marker"}):
                summary = self.run_cli(autoscout_partner.main, ["--contract", str(contract), "--output", str(dest)])
            batch = json.loads(dest.read_text())
            self.assertEqual((summary["mode"], batch["mode"], batch["count"]), (mode, mode, 1))
            self.assertNotIn("test-private-marker", json.dumps(summary) + dest.read_text())


if __name__ == "__main__":
    unittest.main()
