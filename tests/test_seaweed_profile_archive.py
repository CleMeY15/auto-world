import io
import hashlib
from contextlib import redirect_stderr, redirect_stdout
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SCANNER_DIRECTORY = REPOSITORY_ROOT / "scripts" / "scanner"
sys.path.insert(0, os.fspath(SCANNER_DIRECTORY))

import seaweed_profile_archive as archive_module  # noqa: E402
from seaweed_profile_archive import (  # noqa: E402
    InspectionIntegrityError,
    InspectionRefusal,
    inspect_archive,
    inspect_source_save_fixture,
)


def regular(name, payload=b"payload", *, mtime=1_700_000_000, mode=0o640, uid=123, gid=456):
    info = tarfile.TarInfo(name)
    info.size = len(payload)
    info.mode = mode
    info.uid = uid
    info.gid = gid
    info.mtime = mtime
    info.uname = ""
    info.gname = ""
    return info, payload


def directory(name, *, mtime=1_700_000_001):
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mode = 0o750
    info.uid = 123
    info.gid = 456
    info.mtime = mtime
    info.uname = ""
    info.gname = ""
    return info, None


def symlink(name, target, *, mtime=1_700_000_002):
    info = tarfile.TarInfo(name)
    info.type = tarfile.SYMTYPE
    info.linkname = target
    info.mode = 0o777
    info.uid = 123
    info.gid = 456
    info.mtime = mtime
    info.uname = ""
    info.gname = ""
    return info, None


def archive_bytes(entries, *, fmt=tarfile.PAX_FORMAT):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=fmt) as archive:
        for info, payload in entries:
            archive.addfile(info, None if payload is None else io.BytesIO(payload))
    return output.getvalue()


def inspect_bytes(value, *, label="merged-export", max_members=64):
    return inspect_archive(io.BytesIO(value), label=label, max_members=max_members)


def assert_refusal(test_case, code, callback):
    with test_case.assertRaises(InspectionRefusal) as caught:
        callback()
    test_case.assertEqual(caught.exception.code, code)


def source_save_fixture(*, layer_mutator=None, stored_layer_mutator=None, empty_layer_index=None):
    layers = []
    layer_paths = []
    diff_ids = []
    for index in range(10):
        info, payload = regular(f"layer-{index}/value.txt", f"value-{index}".encode("ascii"), mtime=1_700_000_000 + index)
        if layer_mutator is not None:
            info, payload = layer_mutator(index, info, payload)
        layer_bytes = archive_bytes([] if index == empty_layer_index else [(info, payload)])
        diff_id = hashlib.sha256(layer_bytes).hexdigest()
        stored_layer_bytes = stored_layer_mutator(index, layer_bytes) if stored_layer_mutator is not None else layer_bytes
        layer_path = f"{index + 1:064x}/layer.tar"
        layers.append((layer_path, stored_layer_bytes))
        layer_paths.append(layer_path)
        diff_ids.append(diff_id)
    config_bytes = json.dumps({"rootfs": {"type": "layers", "diff_ids": [f"sha256:{value}" for value in diff_ids]}},
                              separators=(",", ":"), sort_keys=True).encode("utf-8")
    config_sha256 = hashlib.sha256(config_bytes).hexdigest()
    manifest_bytes = json.dumps([{"Config": f"{config_sha256}.json", "RepoTags": None, "Layers": layer_paths}],
                                separators=(",", ":"), sort_keys=True).encode("utf-8")
    outer_entries = [regular("manifest.json", manifest_bytes), regular(f"{config_sha256}.json", config_bytes)]
    outer_entries.extend(regular(layer_path, layer_bytes) for layer_path, layer_bytes in layers)
    return archive_bytes(outer_entries), config_bytes, config_sha256, diff_ids


class ArchiveInspectionTests(unittest.TestCase):
    def test_accepts_integral_regular_directory_and_safe_symlink_metadata(self):
        result = inspect_bytes(archive_bytes([
            directory("data"),
            regular("data/value.bin", b"independent-fixture"),
            symlink("data/current", "value.bin"),
        ]))
        self.assertEqual(len(result["records"]), 3)
        self.assertEqual([record["path"] for record in result["records"]], ["data", "data/value.bin", "data/current"])

    def test_accepts_a_zero_sized_regular_whiteout_with_a_real_target(self):
        whiteout, payload = regular("usr/bin/.wh.removed", b"")
        result = inspect_bytes(archive_bytes([(whiteout, payload)]), label="source-layer-1")
        self.assertEqual(result["records"][0]["path"], "usr/bin/.wh.removed")

    def test_accepts_the_exact_zero_sized_opaque_directory_marker(self):
        opaque, payload = regular("usr/bin/.wh..wh..opq", b"")
        result = inspect_bytes(archive_bytes([(opaque, payload)]), label="source-layer-1")
        self.assertEqual(result["records"][0]["path"], "usr/bin/.wh..wh..opq")

    def test_rejects_whiteout_markers_without_a_valid_target_name(self):
        for leaf in (".wh.", ".wh..", ".wh...", ".wh..wh.X"):
            with self.subTest(leaf=leaf):
                assert_refusal(
                    self,
                    "whiteout_invalid",
                    lambda leaf=leaf: inspect_bytes(
                        archive_bytes([regular(f"usr/bin/{leaf}", b"")]),
                        label="source-layer-1",
                    ),
                )

    def test_rejects_entries_nested_below_any_whiteout_marker(self):
        descendants = (
            regular("usr/.wh.hidden/child", b"x"),
            directory("usr/.wh.hidden/child"),
            regular("usr/.wh./child", b"x"),
        )
        for descendant in descendants:
            with self.subTest(path=descendant[0].name, type=descendant[0].type):
                assert_refusal(
                    self,
                    "whiteout_invalid",
                    lambda descendant=descendant: inspect_bytes(
                        archive_bytes([descendant]),
                        label="source-layer-1",
                    ),
                )

    def test_rejects_both_valid_source_whiteout_forms_from_merged_archives(self):
        for leaf in (".wh.removed", ".wh..wh..opq"):
            with self.subTest(leaf=leaf):
                assert_refusal(
                    self,
                    "whiteout_unsupported",
                    lambda leaf=leaf: inspect_bytes(
                        archive_bytes([regular(f"usr/bin/{leaf}", b"")]),
                    ),
                )

    def test_rejects_nonempty_whiteouts_from_source_layers(self):
        with self.assertRaises(InspectionRefusal):
            inspect_bytes(archive_bytes([regular("usr/bin/.wh.removed", b"x")]), label="source-layer-1")

    def test_rejects_non_regular_whiteouts_from_source_layers(self):
        assert_refusal(
            self,
            "whiteout_invalid",
            lambda: inspect_bytes(
                archive_bytes([directory("usr/bin/.wh.removed")]),
                label="source-layer-1",
            ),
        )

    def test_rejects_duplicate_logical_paths(self):
        assert_refusal(self, "duplicate_member",
                       lambda: inspect_bytes(archive_bytes([regular("same", b"first"), regular("same", b"second")])))

    def test_rejects_absolute_member_paths(self):
        assert_refusal(self, "path_invalid", lambda: inspect_bytes(archive_bytes([regular("/absolute", b"x")])))

    def test_rejects_traversing_member_paths(self):
        assert_refusal(self, "path_invalid", lambda: inspect_bytes(archive_bytes([regular("safe/../../escape", b"x")])))

    def test_rejects_symlinks_that_escape_the_image_root(self):
        assert_refusal(self, "symlink_target_invalid",
                       lambda: inspect_bytes(archive_bytes([symlink("safe/link", "../../escape")])))

    def test_rejects_fractional_mtime_instead_of_rounding_it(self):
        assert_refusal(self, "fractional_mtime",
                       lambda: inspect_bytes(archive_bytes([regular("fractional", b"x", mtime=1_700_000_000.5)])))

    def test_rejects_subnanosecond_pax_mtime_without_float_rounding(self):
        info, payload = regular("precise", b"x", mtime=1_720_000_000)
        info.pax_headers = {"mtime": "1720000000.000000001"}
        assert_refusal(self, "fractional_mtime", lambda: inspect_bytes(archive_bytes([(info, payload)])))

    def test_rejects_nonempty_owner_names(self):
        info, payload = regular("named", b"x")
        info.uname = "root"
        assert_refusal(self, "owner_name_unsupported", lambda: inspect_bytes(archive_bytes([(info, payload)])))

    def test_rejects_extended_attributes_and_access_times(self):
        for key in ("SCHILY.xattr.user.fixture", "SCHILY.acl.access", "security.capability", "atime", "ctime"):
            with self.subTest(key=key):
                info, payload = regular("extended", b"x")
                info.pax_headers = {key: "1"}
                assert_refusal(self, "pax_unsupported", lambda: inspect_bytes(archive_bytes([(info, payload)])))

    def test_rejects_sparse_pax_metadata(self):
        info, payload = regular("sparse", b"x")
        info.pax_headers = {"GNU.sparse.map": "0,1", "GNU.sparse.size": "1"}
        assert_refusal(self, "sparse_unsupported", lambda: inspect_bytes(archive_bytes([(info, payload)])))

    def test_rejects_unknown_pax_metadata(self):
        info, payload = regular("unknown", b"x")
        info.pax_headers = {"AUTO.world.unknown": "value"}
        assert_refusal(self, "pax_unsupported", lambda: inspect_bytes(archive_bytes([(info, payload)])))

    def test_rejects_hardlinks(self):
        info = tarfile.TarInfo("hardlink")
        info.type = tarfile.LNKTYPE
        info.linkname = "target"
        info.mtime = 1_700_000_000
        assert_refusal(self, "hardlink_unsupported", lambda: inspect_bytes(archive_bytes([(info, None)])))

    def test_rejects_special_members(self):
        for kind in (tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE):
            with self.subTest(kind=kind):
                info = tarfile.TarInfo("special")
                info.type = kind
                info.mtime = 1_700_000_000
                assert_refusal(self, "special_type_unsupported", lambda: inspect_bytes(archive_bytes([(info, None)])))

    def test_rejects_truncated_archives(self):
        complete = archive_bytes([regular("file", b"payload")])
        assert_refusal(self, "archive_truncated", lambda: inspect_bytes(complete[:700]))

    def test_rejects_nonzero_bytes_after_the_end_markers(self):
        complete = bytearray(archive_bytes([regular("file", b"payload")]))
        complete[-1] = 1
        assert_refusal(self, "archive_nonzero_tail", lambda: inspect_bytes(bytes(complete)))

    def test_rejects_hidden_tar_content_after_an_end_marker(self):
        first = archive_bytes([regular("visible", b"one")])
        second = archive_bytes([regular("hidden", b"two")])
        assert_refusal(self, "archive_nonzero_tail", lambda: inspect_bytes(first + second))

    def test_enforces_member_limit_before_accepting_an_extra_entry(self):
        assert_refusal(self, "member_limit",
                       lambda: inspect_bytes(archive_bytes([regular("one", b"1"), regular("two", b"2")]), max_members=1))

    def test_member_limit_stops_before_consuming_entries_after_the_first_excess_member(self):
        class GuardedReader(io.BytesIO):
            def read(self, size=-1):
                if self.tell() >= 3 * tarfile.BLOCKSIZE:
                    raise AssertionError("reader_consumed_entry_after_cap_plus_one")
                return super().read(size)

        entries = [regular(f"member-{index}", b"") for index in range(9)]
        reader = GuardedReader(archive_bytes(entries, fmt=tarfile.USTAR_FORMAT))
        assert_refusal(self, "member_limit", lambda: inspect_archive(reader, label="merged-export", max_members=2))

    def test_rejects_gnu_longname_and_pax_extension_chains_even_when_tarfile_resolves_them(self):
        long_name = f"usr/share/{'segment-' * 20}value.txt"
        for fmt in (tarfile.GNU_FORMAT, tarfile.PAX_FORMAT):
            with self.subTest(format=fmt):
                assert_refusal(self, "archive_hidden_region",
                               lambda: inspect_bytes(archive_bytes([regular(long_name, b"x")], fmt=fmt)))

    def test_rejects_a_regular_file_used_as_an_ancestor_in_both_archive_orders(self):
        for entries in (
            [regular("usr", b"file"), regular("usr/bin/x", b"child")],
            [regular("usr/bin/x", b"child"), regular("usr", b"file")],
        ):
            with self.subTest(paths=[entry[0].name for entry in entries]):
                assert_refusal(self, "path_invalid", lambda: inspect_bytes(archive_bytes(entries)))

    def test_rejects_a_symlink_used_as_an_ancestor_in_both_archive_orders(self):
        for entries in (
            [symlink("usr", "safe"), regular("usr/bin/x", b"child")],
            [regular("usr/bin/x", b"child"), symlink("usr", "safe")],
        ):
            with self.subTest(paths=[entry[0].name for entry in entries]):
                assert_refusal(self, "path_invalid", lambda: inspect_bytes(archive_bytes(entries)))

    def test_directory_ancestors_remain_valid_in_both_archive_orders(self):
        for entries in (
            [directory("usr"), regular("usr/bin/x", b"child")],
            [regular("usr/bin/x", b"child"), directory("usr")],
        ):
            with self.subTest(paths=[entry[0].name for entry in entries]):
                result = inspect_bytes(archive_bytes(entries))
                self.assertEqual(len(result["records"]), 2)


class SourceSaveCliTests(unittest.TestCase):
    def test_fixture_source_save_binds_ordered_layers_and_complete_nested_hashes(self):
        archive_value, config_value, config_sha256, diff_ids = source_save_fixture()
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)
            result = inspect_source_save_fixture(archive, config, config_sha256, diff_ids)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["sourceConfigSha256"], config_sha256)
        self.assertEqual([layer["ordinal"] for layer in result["layers"]], list(range(1, 11)))
        self.assertEqual([layer["sha256"] for layer in result["layers"]], diff_ids)

    def test_fixture_source_save_accepts_an_empty_final_layer_with_a_complete_tar_terminator(self):
        archive_value, config_value, config_sha256, diff_ids = source_save_fixture(empty_layer_index=9)
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)
            result = inspect_source_save_fixture(archive, config, config_sha256, diff_ids)
        self.assertEqual(result["layers"][9]["memberCount"], 0)
        self.assertEqual(result["totals"]["memberCount"], 9)

    def test_fixture_source_save_rejects_a_changed_config_commitment(self):
        archive_value, config_value, _config_sha256, diff_ids = source_save_fixture()
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)
            assert_refusal(self, "source_config_mismatch", lambda: inspect_source_save_fixture(
                archive, config, "f" * 64, diff_ids))

    def test_fixture_source_save_rejects_layer_bytes_that_do_not_match_the_expected_diffid(self):
        archive_value, config_value, config_sha256, diff_ids = source_save_fixture(
            stored_layer_mutator=lambda index, value: value if index != 4 else value[:-1] + b"\x01")
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)
            assert_refusal(self, "layer_digest_mismatch", lambda: inspect_source_save_fixture(
                archive, config, config_sha256, diff_ids))

    def test_fixture_source_save_rejects_unsupported_metadata_in_any_nested_layer(self):
        def add_hidden_metadata(index, info, payload):
            if index == 7:
                info.pax_headers = {"SCHILY.xattr.user.hidden": "1"}
            return info, payload

        archive_value, config_value, config_sha256, diff_ids = source_save_fixture(layer_mutator=add_hidden_metadata)
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)
            assert_refusal(self, "pax_unsupported", lambda: inspect_source_save_fixture(
                archive, config, config_sha256, diff_ids))

    def test_config_drift_overrides_an_otherwise_successful_fixture_and_closes_both_inputs(self):
        archive_value, config_value, config_sha256, diff_ids = source_save_fixture()
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)
            calls = 0

            def mutate_config():
                nonlocal calls
                calls += 1
                config.chmod(0o644)
                with config.open("r+b") as output:
                    output.seek(0)
                    output.write(b"!")

            with self.assertRaises(InspectionIntegrityError) as caught:
                inspect_source_save_fixture(archive, config, config_sha256, diff_ids, finalize_hook=mutate_config)
            self.assertEqual(caught.exception.code, "source_changed")
            self.assertEqual(calls, 1)
            archive.chmod(0o644)
            config.chmod(0o644)
            archive.unlink()
            config.unlink()

    def test_archive_drift_overrides_a_metadata_refusal_and_closes_both_inputs(self):
        def add_hidden_metadata(index, info, payload):
            if index == 3:
                info.pax_headers = {"SCHILY.xattr.user.hidden": "1"}
            return info, payload

        archive_value, config_value, config_sha256, diff_ids = source_save_fixture(layer_mutator=add_hidden_metadata)
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)
            calls = 0

            def mutate_archive():
                nonlocal calls
                calls += 1
                archive.chmod(0o644)
                with archive.open("r+b") as output:
                    output.seek(-1, os.SEEK_END)
                    output.write(b"!")

            with self.assertRaises(InspectionIntegrityError) as caught:
                inspect_source_save_fixture(archive, config, config_sha256, diff_ids, finalize_hook=mutate_archive)
            self.assertEqual(caught.exception.code, "source_changed")
            self.assertEqual(calls, 1)
            archive.chmod(0o644)
            config.chmod(0o644)
            archive.unlink()
            config.unlink()

    def test_cli_reports_integrity_drift_as_global_error_without_private_paths_or_traceback(self):
        archive = os.fspath((REPOSITORY_ROOT / "private-source-save.tar").resolve())
        config = os.fspath((REPOSITORY_ROOT / "private-source-config.json").resolve())
        stdout = io.StringIO()
        stderr = io.StringIO()
        with mock.patch.object(archive_module, "_activate_cli_limits", return_value=None), \
                mock.patch.object(
                    archive_module,
                    "inspect_source_save",
                    side_effect=InspectionIntegrityError("source_changed"),
                ):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                status = archive_module.main(["source-save", "--archive", archive, "--config", config])
        self.assertEqual(status, 3)
        self.assertEqual(stderr.getvalue(), "")
        output = json.loads(stdout.getvalue())
        self.assertEqual(output["status"], "ERROR")
        self.assertEqual(output["error"], {"code": "source_changed"})
        self.assertNotIn(archive, stdout.getvalue())
        self.assertNotIn(config, stdout.getvalue())
        self.assertNotIn("Traceback", stdout.getvalue())

    def test_wrong_source_config_is_a_finite_json_refusal(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_bytes([regular("manifest.json", b"[]")]))
            config.write_text(json.dumps({"rootfs": {"diff_ids": []}}), encoding="utf-8")
            archive.chmod(0o444)
            config.chmod(0o444)
            command = [
                sys.executable,
                os.fspath(SCANNER_DIRECTORY / "seaweed_profile_archive.py"),
                "source-save",
                "--archive",
                os.fspath(archive.resolve()),
                "--config",
                os.fspath(config.resolve()),
            ]
            completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=30)
            self.assertEqual(completed.returncode, 2)
            self.assertEqual(completed.stderr, "")
            output = json.loads(completed.stdout)
            self.assertEqual(output["status"], "REFUSED")
            self.assertEqual(output["evidenceClass"], "SOURCE_LAYER_PREFLIGHT")
            self.assertNotIn(directory_name, completed.stdout)

    def test_cli_rejects_relative_input_paths_without_a_traceback(self):
        command = [
            sys.executable,
            os.fspath(SCANNER_DIRECTORY / "seaweed_profile_archive.py"),
            "source-save",
            "--archive",
            "relative.tar",
            "--config",
            "relative.json",
        ]
        completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stderr, "")
        output = json.loads(completed.stdout)
        self.assertEqual(output["status"], "REFUSED")
        self.assertNotIn("Traceback", completed.stdout)


if __name__ == "__main__":
    unittest.main()
