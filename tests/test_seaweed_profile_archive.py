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


def source_save_fixture(
    *,
    layer_mutator=None,
    stored_layer_mutator=None,
    empty_layer_index=None,
    manifest_payload=None,
    manifest_member_type="file",
    omit_manifest=False,
    extra_outer_entries=(),
):
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
    if manifest_payload is None:
        manifest_payload = json.dumps(
            [{"Config": f"{config_sha256}.json", "RepoTags": None, "Layers": layer_paths}],
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    outer_entries = [regular(f"{config_sha256}.json", config_bytes)]
    if not omit_manifest:
        manifest_entry = (
            regular("manifest.json", manifest_payload)
            if manifest_member_type == "file"
            else directory("manifest.json")
        )
        outer_entries.insert(0, manifest_entry)
    outer_entries.extend(extra_outer_entries)
    outer_entries.extend(regular(layer_path, layer_bytes) for layer_path, layer_bytes in layers)
    return archive_bytes(outer_entries), config_bytes, config_sha256, diff_ids


OCI_INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json"
OCI_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json"
OCI_CONFIG_MEDIA_TYPE = "application/vnd.oci.image.config.v1+json"
OCI_LAYER_MEDIA_TYPE = "application/vnd.oci.image.layer.v1.tar"


def moby_source_save_fixture(
    *,
    layer_entries_mutator=None,
    layout_mutator=None,
    index_mutator=None,
    oci_manifest_mutator=None,
    manifest_mutator=None,
    outer_mutator=None,
):
    def json_bytes(value):
        return json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii")

    layer_bytes = []
    diff_ids = []
    for index in range(10):
        entries = [regular(f"layer-{index}/value.txt", f"value-{index}".encode("ascii"))]
        if layer_entries_mutator is not None:
            entries = layer_entries_mutator(index, entries)
        value = archive_bytes(entries)
        layer_bytes.append(value)
        diff_ids.append(hashlib.sha256(value).hexdigest())

    config_value = {
        "rootfs": {"type": "layers", "diff_ids": [f"sha256:{value}" for value in diff_ids]},
    }
    config_bytes = json_bytes(config_value)
    config_sha256 = hashlib.sha256(config_bytes).hexdigest()
    config_path = f"blobs/sha256/{config_sha256}"
    layer_paths = [f"blobs/sha256/{value}" for value in diff_ids]
    layer_descriptors = [
        {"mediaType": OCI_LAYER_MEDIA_TYPE, "digest": f"sha256:{digest}", "size": len(payload)}
        for digest, payload in zip(diff_ids, layer_bytes, strict=True)
    ]
    oci_manifest = {
        "schemaVersion": 2,
        "mediaType": OCI_MANIFEST_MEDIA_TYPE,
        "config": {"mediaType": OCI_CONFIG_MEDIA_TYPE, "digest": f"sha256:{config_sha256}", "size": len(config_bytes)},
        "layers": [dict(value) for value in layer_descriptors],
    }
    if oci_manifest_mutator is not None:
        oci_manifest_mutator(oci_manifest)
    oci_manifest_bytes = json_bytes(oci_manifest)
    oci_manifest_sha256 = hashlib.sha256(oci_manifest_bytes).hexdigest()
    oci_manifest_path = f"blobs/sha256/{oci_manifest_sha256}"
    index = {
        "schemaVersion": 2,
        "mediaType": OCI_INDEX_MEDIA_TYPE,
        "manifests": [{
            "mediaType": OCI_MANIFEST_MEDIA_TYPE,
            "digest": f"sha256:{oci_manifest_sha256}",
            "size": len(oci_manifest_bytes),
        }],
    }
    if index_mutator is not None:
        index_mutator(index)
    index_bytes = json_bytes(index)
    layout = {"imageLayoutVersion": "1.0.0"}
    if layout_mutator is not None:
        layout_mutator(layout)
    layout_bytes = json_bytes(layout)
    layer_sources = {
        f"sha256:{diff_ids[index]}": dict(layer_descriptors[index])
        for index in reversed(range(10))
    }
    manifest = [{
        "Config": config_path,
        "LayerSources": layer_sources,
        "Layers": list(layer_paths),
        "RepoTags": None,
    }]
    if manifest_mutator is not None:
        manifest_mutator(manifest)
    manifest_bytes = json_bytes(manifest)
    outer_entries = [
        regular("manifest.json", manifest_bytes),
        regular("oci-layout", layout_bytes),
        regular("index.json", index_bytes),
        regular(config_path, config_bytes),
        regular(oci_manifest_path, oci_manifest_bytes),
        *(regular(path, payload) for path, payload in zip(layer_paths, layer_bytes, strict=True)),
    ]
    context = {
        "configPath": config_path,
        "layerPaths": layer_paths,
        "layerDescriptors": layer_descriptors,
        "ociManifestPath": oci_manifest_path,
    }
    if outer_mutator is not None:
        outer_mutator(outer_entries, context)
    return archive_bytes(outer_entries), config_bytes, config_sha256, diff_ids


def inspect_source_fixture_refusal(test_case, *, fixture_builder=source_save_fixture, **fixture_options):
    archive_value, config_value, config_sha256, diff_ids = fixture_builder(**fixture_options)
    with tempfile.TemporaryDirectory() as directory_name:
        directory = Path(directory_name)
        archive = directory / "source-save.tar"
        config = directory / "config.json"
        archive.write_bytes(archive_value)
        config.write_bytes(config_value)
        archive.chmod(0o444)
        config.chmod(0o444)
        with test_case.assertRaises(InspectionRefusal) as caught:
            inspect_source_save_fixture(archive, config, config_sha256, diff_ids)
    return caught.exception


def replace_outer_entry(entries, name, replacement):
    index = next(index for index, entry in enumerate(entries) if entry[0].name == name)
    entries[index] = replacement


class ArchiveInspectionTests(unittest.TestCase):
    def test_strict_json_converts_integer_digit_limits_without_changing_the_legacy_global_failure(self):
        oversized_integer = b"1" * 5000
        with self.assertRaises(ValueError):
            archive_module._json_no_duplicates(oversized_integer, "save_manifest_invalid")
        assert_refusal(
            self,
            "save_envelope_invalid",
            lambda: archive_module._json_no_duplicates(
                oversized_integer,
                "save_envelope_invalid",
                reject_constants=True,
            ),
        )

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
        self.assertNotIn("manifestDiagnostic", result)
        self.assertEqual(result["sourceConfigSha256"], config_sha256)
        self.assertEqual([layer["ordinal"] for layer in result["layers"]], list(range(1, 11)))
        self.assertEqual([layer["sha256"] for layer in result["layers"]], diff_ids)

    def test_fixture_moby_envelope_binds_the_closed_raw_ten_layer_graph(self):
        archive_value, config_value, config_sha256, diff_ids = moby_source_save_fixture()
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
        self.assertEqual(result["sourceEnvelope"]["kind"], "MOBY_28_OCI_COMPAT_V1")
        self.assertEqual(result["sourceEnvelope"]["descriptorCount"], 10)
        self.assertEqual(result["sourceEnvelope"]["rawLayerDescriptorsMatched"], True)
        self.assertEqual(
            [layer["path"] for layer in result["layers"]],
            [f"blobs/sha256/{value}" for value in diff_ids],
        )
        with tarfile.open(fileobj=io.BytesIO(archive_value), mode="r:") as outer:
            members = {member.name: member for member in outer.getmembers()}
            manifest_bytes = outer.extractfile(members["manifest.json"]).read()
            layout_bytes = outer.extractfile(members["oci-layout"]).read()
            index_bytes = outer.extractfile(members["index.json"]).read()
            index = json.loads(index_bytes)
            oci_path = f"blobs/sha256/{index['manifests'][0]['digest'][7:]}"
            oci_manifest_bytes = outer.extractfile(members[oci_path]).read()
        self.assertEqual(result["sourceEnvelope"]["manifestSha256"], hashlib.sha256(manifest_bytes).hexdigest())
        self.assertEqual(result["sourceEnvelope"]["layoutSha256"], hashlib.sha256(layout_bytes).hexdigest())
        self.assertEqual(result["sourceEnvelope"]["indexSha256"], hashlib.sha256(index_bytes).hexdigest())
        self.assertEqual(result["sourceEnvelope"]["ociManifestSha256"], hashlib.sha256(oci_manifest_bytes).hexdigest())

    def test_moby_layout_and_index_must_be_exact_duplicate_free_json(self):
        def duplicate_layout(entries, _context):
            replace_outer_entry(
                entries,
                "oci-layout",
                regular("oci-layout", b'{"imageLayoutVersion":"1.0.0","imageLayoutVersion":"1.0.0"}'),
            )

        def array_index(entries, _context):
            replace_outer_entry(entries, "index.json", regular("index.json", b"[]"))

        cases = (
            {"layout_mutator": lambda value: value.update(imageLayoutVersion="1.0.1")},
            {"layout_mutator": lambda value: value.update(extra=True)},
            {"outer_mutator": duplicate_layout},
            {"index_mutator": lambda value: value.update(schemaVersion=True)},
            {"index_mutator": lambda value: value.update(mediaType="application/json")},
            {"index_mutator": lambda value: value.update(manifests=[])},
            {"index_mutator": lambda value: value["manifests"][0].update(annotations={})},
            {"outer_mutator": array_index},
        )
        for options in cases:
            with self.subTest(options=tuple(options)):
                refusal = inspect_source_fixture_refusal(
                    self,
                    fixture_builder=moby_source_save_fixture,
                    **options,
                )
                self.assertEqual(refusal.code, "save_envelope_invalid")
                self.assertLessEqual(len(json.dumps(
                    refusal.envelope_diagnostic,
                    ensure_ascii=True,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("ascii")), 2048)

    def test_moby_descriptors_refuse_extra_fields_bad_digests_sizes_and_encoding(self):
        cases = (
            lambda value: value.update(annotations={}),
            lambda value: value["config"].update(urls=[]),
            lambda value: value["layers"][0].update(digest="sha256:BAD"),
            lambda value: value["layers"][0].update(size=True),
            lambda value: value["layers"][0].update(size=2 * 1024 ** 3 + 1),
            lambda value: value["layers"][0].update(mediaType="application/vnd.oci.image.layer.v1.tar+gzip"),
        )
        for mutate in cases:
            with self.subTest(mutate=mutate):
                refusal = inspect_source_fixture_refusal(
                    self,
                    fixture_builder=moby_source_save_fixture,
                    oci_manifest_mutator=mutate,
                )
                self.assertEqual(refusal.code, "save_envelope_invalid")
                self.assertIsNotNone(refusal.envelope_diagnostic)

    def test_moby_outer_graph_refuses_missing_nonregular_changed_and_extra_members(self):
        def remove_layer(entries, context):
            entries[:] = [entry for entry in entries if entry[0].name != context["layerPaths"][3]]

        def make_layer_directory(entries, context):
            replace_outer_entry(entries, context["layerPaths"][3], directory(context["layerPaths"][3]))

        def change_layer_bytes(entries, context):
            replace_outer_entry(entries, context["layerPaths"][3], regular(context["layerPaths"][3], b"changed"))

        def change_config_bytes(entries, context):
            replace_outer_entry(entries, context["configPath"], regular(context["configPath"], b"changed"))

        def add_extra_blob(entries, _context):
            entries.append(regular(f"blobs/sha256/{'f' * 64}", b"unreferenced"))

        def add_extra_directory(entries, _context):
            entries.append(directory("foreign"))

        for mutate in (remove_layer, make_layer_directory, change_layer_bytes, change_config_bytes, add_extra_blob, add_extra_directory):
            with self.subTest(mutate=mutate.__name__):
                refusal = inspect_source_fixture_refusal(
                    self,
                    fixture_builder=moby_source_save_fixture,
                    outer_mutator=mutate,
                )
                self.assertEqual(refusal.code, "save_envelope_invalid")

    def test_moby_manifest_closure_refuses_layer_order_duplicates_and_layer_source_aliases(self):
        def swap_layers(value):
            value[0]["Layers"][0], value[0]["Layers"][1] = value[0]["Layers"][1], value[0]["Layers"][0]

        def duplicate_layer(value):
            value[0]["Layers"][1] = value[0]["Layers"][0]

        def missing_layer_source(value):
            value[0]["LayerSources"].pop(next(iter(value[0]["LayerSources"])))

        def extra_layer_source(value):
            value[0]["LayerSources"][f"sha256:{'f' * 64}"] = {
                "mediaType": OCI_LAYER_MEDIA_TYPE,
                "digest": f"sha256:{'f' * 64}",
                "size": 1,
            }

        def mismatch_layer_source(value):
            value[0]["LayerSources"][next(iter(value[0]["LayerSources"]))]["size"] += 1

        def alias_config_to_layer(value):
            value[0]["Config"] = value[0]["Layers"][0]

        for mutate in (
            swap_layers,
            duplicate_layer,
            missing_layer_source,
            extra_layer_source,
            mismatch_layer_source,
            alias_config_to_layer,
        ):
            with self.subTest(mutate=mutate.__name__):
                refusal = inspect_source_fixture_refusal(
                    self,
                    fixture_builder=moby_source_save_fixture,
                    manifest_mutator=mutate,
                )
                self.assertEqual(refusal.code, "save_envelope_invalid")

    def test_moby_raw_layers_keep_the_existing_conservative_tar_metadata_gate(self):
        def add_pax(index, entries):
            if index == 6:
                entries[0][0].pax_headers = {"SCHILY.xattr.user.hidden": "1"}
            return entries

        refusal = inspect_source_fixture_refusal(
            self,
            fixture_builder=moby_source_save_fixture,
            layer_entries_mutator=add_pax,
        )
        self.assertEqual(refusal.code, "pax_unsupported")
        self.assertEqual(refusal.layer_ordinal, 7)
        self.assertIsNone(refusal.envelope_diagnostic)

    def test_envelope_diagnostics_commit_hostile_names_without_raw_name_or_path_leakage(self):
        private_names = [
            f"C:\\private\\blob-{index}\nsecret-{index}"
            for index in range(512)
        ]

        def add_unknown_descriptor_keys(value):
            descriptor = value["layers"][0]
            descriptor.update({name: index for index, name in enumerate(private_names)})

        refusal = inspect_source_fixture_refusal(
            self,
            fixture_builder=moby_source_save_fixture,
            oci_manifest_mutator=add_unknown_descriptor_keys,
        )
        self.assertEqual(refusal.code, "save_envelope_invalid")
        diagnostic = refusal.envelope_diagnostic
        unknown_names = sorted(private_names)
        expected = hashlib.sha256(
            json.dumps(unknown_names, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        self.assertEqual(diagnostic["unknownKeyCount"], len(private_names))
        self.assertEqual(diagnostic["unknownKeyNamesSha256"], expected)
        encoded = json.dumps(diagnostic, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii")
        self.assertLessEqual(len(encoded), 2048)
        self.assertNotIn(b"private", encoded)
        self.assertNotIn(b"secret", encoded)
        self.assertNotIn(os.fspath(REPOSITORY_ROOT).encode("ascii"), encoded)

    def test_non_utf8_media_type_is_categorized_without_leaking_or_hashing_the_surrogate(self):
        def use_surrogate_media_type(value):
            value["layers"][0]["mediaType"] = "\ud800"

        refusal = inspect_source_fixture_refusal(
            self,
            fixture_builder=moby_source_save_fixture,
            oci_manifest_mutator=use_surrogate_media_type,
        )
        diagnostic = refusal.envelope_diagnostic
        self.assertEqual(diagnostic["mediaTypeClass"], "other")
        self.assertIsNone(diagnostic["mediaTypeSha256"])
        self.assertNotIn("\\ud800", json.dumps(diagnostic, ensure_ascii=True, separators=(",", ":")))

    def test_archive_drift_suppresses_an_otherwise_finite_envelope_diagnostic(self):
        archive_value, config_value, config_sha256, diff_ids = moby_source_save_fixture(
            layout_mutator=lambda value: value.update(imageLayoutVersion="1.0.1")
        )
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)

            def mutate_archive():
                archive.chmod(0o644)
                with archive.open("r+b") as output:
                    output.seek(-1, os.SEEK_END)
                    output.write(b"!")

            with self.assertRaises(InspectionIntegrityError) as caught:
                inspect_source_save_fixture(
                    archive,
                    config,
                    config_sha256,
                    diff_ids,
                    finalize_hook=mutate_archive,
                )
            self.assertEqual(caught.exception.code, "source_changed")

    def test_missing_manifest_reports_outer_shape_without_changing_the_refusal(self):
        extra_entries = (
            regular("oci-layout", b"{}"),
            regular("index.json", b"{}"),
            regular("repositories", b"{}"),
            regular(f"blobs/sha256/{'a' * 64}", b"opaque"),
        )
        refusal = inspect_source_fixture_refusal(
            self,
            omit_manifest=True,
            extra_outer_entries=extra_entries,
        )
        self.assertEqual(refusal.code, "save_manifest_missing")
        diagnostic = refusal.manifest_diagnostic
        self.assertEqual(diagnostic["outer"], {
            "ociLayoutPresent": True,
            "indexJsonPresent": True,
            "repositoriesPresent": True,
            "blobsPrefixPresent": True,
        })
        self.assertEqual(diagnostic["manifest"]["present"], False)
        self.assertEqual(diagnostic["manifest"]["jsonState"], "not-observed")

    def test_nonfile_and_invalid_json_manifests_remain_distinct_finite_refusals(self):
        cases = (
            ({"manifest_member_type": "directory"}, "directory", "not-observed", None),
            ({"manifest_payload": b"{"}, "file", "invalid", 1),
        )
        for options, member_type, json_state, byte_count in cases:
            with self.subTest(member_type=member_type, json_state=json_state):
                refusal = inspect_source_fixture_refusal(self, **options)
                self.assertEqual(refusal.code, "save_manifest_invalid")
                manifest = refusal.manifest_diagnostic["manifest"]
                self.assertEqual(manifest["memberType"], member_type)
                self.assertEqual(manifest["jsonState"], json_state)
                self.assertEqual(manifest["byteCount"], byte_count)

    def test_manifest_root_and_cardinality_observations_remain_refused(self):
        cases = (
            ({}, "object", None, None),
            ([], "array", 0, None),
            ([{}, {}], "array", 2, "object"),
            ([None], "array", 1, "null"),
        )
        for value, root_type, record_count, first_type in cases:
            with self.subTest(value=value):
                payload = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii")
                refusal = inspect_source_fixture_refusal(self, manifest_payload=payload)
                self.assertEqual(refusal.code, "save_manifest_invalid")
                manifest = refusal.manifest_diagnostic["manifest"]
                self.assertEqual(manifest["rootType"], root_type)
                self.assertEqual(manifest["recordCount"], record_count)
                self.assertEqual(manifest["firstRecordType"], first_type)

    def test_extra_keys_null_types_and_path_categories_are_observed_without_acceptance(self):
        unknown_names = ["FutureField"]
        value = [{
            "Config": f"blobs/sha256/{'a' * 64}",
            "RepoTags": None,
            "Layers": [f"{'b' * 64}/layer.tar", f"blobs/sha256/{'c' * 64}", "foreign/layer"],
            "Parent": None,
            "LayerSources": None,
            unknown_names[0]: {"private": "payload"},
        }]
        payload = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii")
        refusal = inspect_source_fixture_refusal(self, manifest_payload=payload)
        self.assertEqual(refusal.code, "save_manifest_invalid")
        manifest = refusal.manifest_diagnostic["manifest"]
        self.assertEqual(manifest["knownValueTypes"], {
            "Config": "string",
            "LayerSources": "null",
            "Layers": "array",
            "Parent": "null",
            "RepoTags": "null",
        })
        self.assertEqual(manifest["configPathCategory"], "oci-blob")
        self.assertEqual(manifest["layerPathCounts"], {"legacyLayer": 1, "ociBlob": 1, "other": 1})
        self.assertEqual(manifest["unknownKeyNamesSha256"], hashlib.sha256(
            json.dumps(unknown_names, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest())

    def test_config_path_categories_distinguish_legacy_oci_and_other_references(self):
        cases = (
            (f"{'a' * 64}.json", "legacy-config"),
            (f"blobs/sha256/{'b' * 64}", "oci-blob"),
            ("private/config.json", "other"),
        )
        for config_reference, category in cases:
            with self.subTest(category=category):
                value = [{
                    "Config": config_reference,
                    "RepoTags": None,
                    "Layers": [],
                    "FutureField": True,
                }]
                payload = json.dumps(value, separators=(",", ":")).encode("ascii")
                refusal = inspect_source_fixture_refusal(self, manifest_payload=payload)
                self.assertEqual(refusal.code, "save_manifest_invalid")
                self.assertEqual(refusal.manifest_diagnostic["manifest"]["configPathCategory"], category)

    def test_unknown_key_commitments_distinguish_ambiguous_and_unicode_name_sets(self):
        name_sets = (["ab", "c", "é", "\ud800"], ["a", "bc", "é", "\ud800"])
        commitments = []
        for names in name_sets:
            with self.subTest(names=names):
                record = {name: index for index, name in enumerate(names)}
                payload = json.dumps([record], ensure_ascii=True, separators=(",", ":")).encode("ascii")
                refusal = inspect_source_fixture_refusal(self, manifest_payload=payload)
                manifest = refusal.manifest_diagnostic["manifest"]
                expected = hashlib.sha256(
                    json.dumps(sorted(names), ensure_ascii=True, separators=(",", ":")).encode("utf-8")
                ).hexdigest()
                self.assertEqual(manifest["unknownKeyNamesSha256"], expected)
                self.assertEqual(manifest["configPathCategory"], "absent")
                encoded = json.dumps(refusal.manifest_diagnostic, ensure_ascii=True, separators=(",", ":"))
                self.assertNotIn("\\u00e9", encoded)
                self.assertNotIn("\\ud800", encoded)
                commitments.append(expected)
        self.assertNotEqual(commitments[0], commitments[1])

    def test_duplicate_manifest_keys_are_invalid_without_partial_name_evidence(self):
        refusal = inspect_source_fixture_refusal(
            self,
            manifest_payload=b'[{"Future":1,"Future":2}]',
        )
        self.assertEqual(refusal.code, "save_manifest_invalid")
        manifest = refusal.manifest_diagnostic["manifest"]
        self.assertEqual(manifest["jsonState"], "invalid")
        self.assertIsNone(manifest["unknownKeyCount"])
        self.assertIsNone(manifest["unknownKeyNamesSha256"])

    def test_large_malicious_unknown_names_are_only_counted_and_committed(self):
        private_names = [
            f"C:\\private\\source-save-{index}.tar\nsecret-{index}"
            for index in range(512)
        ]
        record = {name: {"raw": f"payload-{index}"} for index, name in enumerate(private_names)}
        payload = json.dumps([record], ensure_ascii=True, separators=(",", ":")).encode("ascii")
        refusal = inspect_source_fixture_refusal(self, manifest_payload=payload)
        diagnostic = refusal.manifest_diagnostic
        encoded = json.dumps(diagnostic, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii")
        self.assertLessEqual(len(encoded), 2048)
        self.assertEqual(diagnostic["manifest"]["unknownKeyCount"], len(private_names))
        self.assertNotIn(b"source-save", encoded)
        self.assertNotIn(b"payload", encoded)
        self.assertNotIn(os.fspath(REPOSITORY_ROOT).encode("ascii"), encoded)

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

    def test_archive_drift_suppresses_an_otherwise_finite_manifest_diagnostic(self):
        archive_value, config_value, config_sha256, diff_ids = source_save_fixture(manifest_payload=b"{")
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            archive = directory / "source-save.tar"
            config = directory / "config.json"
            archive.write_bytes(archive_value)
            config.write_bytes(config_value)
            archive.chmod(0o444)
            config.chmod(0o444)

            def mutate_archive():
                archive.chmod(0o644)
                with archive.open("r+b") as output:
                    output.seek(-1, os.SEEK_END)
                    output.write(b"!")

            with self.assertRaises(InspectionIntegrityError) as caught:
                inspect_source_save_fixture(
                    archive,
                    config,
                    config_sha256,
                    diff_ids,
                    finalize_hook=mutate_archive,
                )
            self.assertEqual(caught.exception.code, "source_changed")

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

    def test_cli_emits_bounded_manifest_diagnostics_only_for_named_refusals(self):
        secret_name = "C:\\private\\source-save.tar\nsecret"
        payload = json.dumps([{secret_name: "raw-payload"}], separators=(",", ":")).encode("ascii")
        manifest_refusal = inspect_source_fixture_refusal(self, manifest_payload=payload)
        archive = os.fspath((REPOSITORY_ROOT / "private-source-save.tar").resolve())
        config = os.fspath((REPOSITORY_ROOT / "private-source-config.json").resolve())

        for refusal, expect_diagnostic in (
            (manifest_refusal, True),
            (InspectionRefusal("archive_truncated", manifest_diagnostic=manifest_refusal.manifest_diagnostic), False),
        ):
            with self.subTest(code=refusal.code):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with mock.patch.object(archive_module, "_activate_cli_limits", return_value=None), \
                        mock.patch.object(archive_module, "inspect_source_save", side_effect=refusal):
                    with redirect_stdout(stdout), redirect_stderr(stderr):
                        status = archive_module.main(["source-save", "--archive", archive, "--config", config])
                self.assertEqual(status, 2)
                self.assertEqual(stderr.getvalue(), "")
                output = json.loads(stdout.getvalue())
                self.assertEqual("manifestDiagnostic" in output, expect_diagnostic)
                self.assertLessEqual(len(json.dumps(output, separators=(",", ":")).encode("ascii")), 4096)
                self.assertNotIn(secret_name, stdout.getvalue())
                self.assertNotIn("raw-payload", stdout.getvalue())
                self.assertNotIn(archive, stdout.getvalue())
                self.assertNotIn(config, stdout.getvalue())

    def test_cli_emits_envelope_diagnostics_only_for_the_named_uncombined_refusal(self):
        envelope_refusal = inspect_source_fixture_refusal(
            self,
            fixture_builder=moby_source_save_fixture,
            layout_mutator=lambda value: value.update(imageLayoutVersion="1.0.1"),
        )
        manifest_refusal = inspect_source_fixture_refusal(self, omit_manifest=True)
        archive = os.fspath((REPOSITORY_ROOT / "private-source-save.tar").resolve())
        config = os.fspath((REPOSITORY_ROOT / "private-source-config.json").resolve())
        cases = (
            (envelope_refusal, True),
            (InspectionRefusal("archive_truncated", envelope_diagnostic=envelope_refusal.envelope_diagnostic), False),
            (InspectionRefusal(
                "save_envelope_invalid",
                manifest_diagnostic=manifest_refusal.manifest_diagnostic,
                envelope_diagnostic=envelope_refusal.envelope_diagnostic,
            ), False),
        )
        for refusal, expect_diagnostic in cases:
            with self.subTest(code=refusal.code, combined=refusal.manifest_diagnostic is not None):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with mock.patch.object(archive_module, "_activate_cli_limits", return_value=None), \
                        mock.patch.object(archive_module, "inspect_source_save", side_effect=refusal):
                    with redirect_stdout(stdout), redirect_stderr(stderr):
                        status = archive_module.main(["source-save", "--archive", archive, "--config", config])
                self.assertEqual(status, 2)
                self.assertEqual(stderr.getvalue(), "")
                output = json.loads(stdout.getvalue())
                self.assertEqual("envelopeDiagnostic" in output, expect_diagnostic)
                self.assertNotIn("manifestDiagnostic", output)
                self.assertLessEqual(len(stdout.getvalue().encode("ascii")), 4096)
                self.assertNotIn(archive, stdout.getvalue())
                self.assertNotIn(config, stdout.getvalue())

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
