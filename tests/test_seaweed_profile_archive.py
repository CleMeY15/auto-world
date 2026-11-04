import io
import hashlib
from contextlib import redirect_stderr, redirect_stdout
import json
import os
from pathlib import Path
import shutil
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


def tar_extension_record(type_flag, payload):
    info = tarfile.TarInfo("././@LongLink" if type_flag in {tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK} else "PaxHeaders.X/hidden")
    info.type = type_flag
    info.mode = 0o644
    info.uid = 0
    info.gid = 0
    info.mtime = 0
    info.size = len(payload)
    header = info.tobuf(format=tarfile.GNU_FORMAT, encoding="ascii", errors="strict")
    padding = (-len(payload)) % tarfile.BLOCKSIZE
    return header + payload + (b"\0" * padding)


def pax_record(key, value):
    body = f"{key}={value}\n".encode("ascii")
    length = len(body) + 2
    while True:
        record = str(length).encode("ascii") + b" " + body
        if len(record) == length:
            return record
        length = len(record)


def tar_member_offset(entries, ordinal):
    offset = 0
    for _info, payload in entries[:ordinal]:
        payload_bytes = b"" if payload is None else payload
        offset += tarfile.BLOCKSIZE + ((len(payload_bytes) + tarfile.BLOCKSIZE - 1) // tarfile.BLOCKSIZE) * tarfile.BLOCKSIZE
    return offset


def inspect_bytes(value, *, label="merged-export", max_members=64):
    return inspect_archive(io.BytesIO(value), label=label, max_members=max_members)


def assert_refusal(test_case, code, callback):
    with test_case.assertRaises(InspectionRefusal) as caught:
        callback()
    test_case.assertEqual(caught.exception.code, code)


INERT_FIXTURE_SPEC = (
    ("etc", "directory", 0o750, 101, 202, 1_700_000_100, b"", ""),
    ("etc/fixture.conf", "file", 0o640, 101, 202, 1_700_000_101, b"auto-world-inert-fixture-v1\n", ""),
    ("opt", "directory", 0o755, 0, 0, 1_700_000_102, b"", ""),
    ("opt/auto-world", "directory", 0o750, 123, 456, 1_700_000_103, b"", ""),
    ("opt/auto-world/marker.txt", "file", 0o444, 123, 456, 1_700_000_104, b"preserve-this-marker\n", ""),
    ("var", "directory", 0o755, 0, 0, 1_700_000_105, b"", ""),
    ("var/lib", "directory", 0o755, 0, 0, 1_700_000_106, b"", ""),
    ("var/lib/seaweed", "directory", 0o750, 1001, 1002, 1_700_000_107, b"", ""),
    ("var/lib/seaweed/state.bin", "file", 0o600, 1001, 1002, 1_700_000_108,
     bytes.fromhex("006175746f2d776f726c64ff7365617765656410"), ""),
    ("usr", "directory", 0o755, 0, 0, 1_700_000_109, b"", ""),
    ("usr/bin", "directory", 0o755, 0, 0, 1_700_000_110, b"", ""),
    ("usr/bin/weed-volume", "file", 0o640, 1001, 1002, 1_700_000_111,
     b"AUTO WORLD INERT DATA ONLY: weed-volume\n", ""),
    ("usr/bin/weed-worker", "file", 0o640, 1001, 1002, 1_700_000_112,
     b"AUTO WORLD INERT DATA ONLY: weed-worker\n", ""),
    ("data", "directory", 0o700, 1001, 1002, 1_700_000_113, b"", ""),
    ("data/sentinel.txt", "file", 0o440, 1001, 1002, 1_700_000_114,
     b"volume-underlay-sentinel-v1\n", ""),
    ("marker-link", "symlink", 0o777, 123, 456, 1_700_000_115, b"", "opt/auto-world/marker.txt"),
)


def inert_fixture_entries(spec=INERT_FIXTURE_SPEC):
    entries = []
    for name, member_type, mode, uid, gid, mtime, payload, linkname in spec:
        info = tarfile.TarInfo(name)
        info.mode = mode
        info.uid = uid
        info.gid = gid
        info.mtime = mtime
        info.uname = ""
        info.gname = ""
        if member_type == "directory":
            info.type = tarfile.DIRTYPE
            info.size = 0
            entries.append((info, None))
        elif member_type == "symlink":
            info.type = tarfile.SYMTYPE
            info.linkname = linkname
            info.size = 0
            entries.append((info, None))
        else:
            info.size = len(payload)
            entries.append((info, payload))
    return entries


ZERO_CONTAINER_CONFIG = {
    "Hostname": "",
    "Domainname": "",
    "User": "",
    "AttachStdin": False,
    "AttachStdout": False,
    "AttachStderr": False,
    "Tty": False,
    "OpenStdin": False,
    "StdinOnce": False,
    "Env": None,
    "Cmd": None,
    "Image": "",
    "Volumes": None,
    "WorkingDir": "",
    "Entrypoint": None,
    "OnBuild": None,
    "Labels": None,
}


def inert_legacy_save_fixture(*, owner="123e4567-e89b-42d3-a456-426614174000"):
    created = "2026-10-28T08:00:00Z"
    server_version = "28.0.4"
    repository = "auto-world-managed/seaweedfs-go-s3-control"
    tag = f"{repository}:{owner}"
    layer_id = "c" * 64
    filtered_spec = [
        item for item in INERT_FIXTURE_SPEC
        if item[0] not in {"usr/bin/weed-volume", "usr/bin/weed-worker"}
    ]
    layer_bytes = archive_bytes(inert_fixture_entries(filtered_spec), fmt=tarfile.USTAR_FORMAT)
    diff_id = f"sha256:{hashlib.sha256(layer_bytes).hexdigest()}"
    runtime_config = {
        "Cmd": ["/auto-world-inert-never-execute"],
        "Labels": {
            "com.auto-world.task005.inert": owner,
            "com.auto-world.task005.inert-stage": "filtered",
            "org.auto-world.seaweed-go-s3-control": "inert-v1",
        },
        "User": "1001:1002",
        "Volumes": {"/data": {}},
        "WorkingDir": "/data",
    }
    comment = "auto-world-inert-qualification-v1"
    config = {
        "architecture": "amd64",
        "comment": comment,
        "config": runtime_config,
        "container_config": ZERO_CONTAINER_CONFIG,
        "created": created,
        "docker_version": server_version,
        "history": [{"created": created, "comment": comment}],
        "os": "linux",
        "rootfs": {"type": "layers", "diff_ids": [diff_id]},
    }
    config_bytes = json.dumps(config, separators=(",", ":"), sort_keys=True).encode("ascii")
    image_hex = hashlib.sha256(config_bytes).hexdigest()
    layer_metadata = {
        "architecture": "amd64",
        "comment": comment,
        "config": runtime_config,
        "container_config": ZERO_CONTAINER_CONFIG,
        "created": created,
        "docker_version": server_version,
        "id": layer_id,
        "os": "linux",
    }
    manifest = [{"Config": f"{image_hex}.json", "RepoTags": [tag], "Layers": [f"{layer_id}/layer.tar"]}]
    entries = [
        regular("manifest.json", json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode("ascii")),
        regular(f"{image_hex}.json", config_bytes),
        regular("repositories", json.dumps({repository: {owner: layer_id}}, separators=(",", ":"), sort_keys=True).encode("ascii")),
        directory(layer_id),
        regular(f"{layer_id}/VERSION", b"1.0"),
        regular(f"{layer_id}/json", json.dumps(layer_metadata, separators=(",", ":"), sort_keys=True).encode("ascii")),
        regular(f"{layer_id}/layer.tar", layer_bytes),
    ]
    return {
        "archive": archive_bytes(entries, fmt=tarfile.USTAR_FORMAT),
        "image_id": f"sha256:{image_hex}",
        "tag": tag,
        "diff_id": diff_id,
        "created": created,
        "server_version": server_version,
        "owner": owner,
        "layer_id": layer_id,
    }


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
    config_mutator=None,
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
        "os": "linux",
        "rootfs": {"type": "layers", "diff_ids": [f"sha256:{value}" for value in diff_ids]},
    }
    if config_mutator is not None:
        config_mutator(config_value)
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


def inspect_fixture_values(
    archive_value,
    config_value,
    config_sha256,
    diff_ids,
    *,
    auxiliary_profile=None,
    finalize_hook=None,
):
    with tempfile.TemporaryDirectory() as directory_name:
        directory = Path(directory_name)
        archive = directory / "source-save.tar"
        config = directory / "config.json"
        archive.write_bytes(archive_value)
        config.write_bytes(config_value)
        archive.chmod(0o444)
        config.chmod(0o444)
        return inspect_source_save_fixture(
            archive,
            config,
            config_sha256,
            diff_ids,
            finalize_hook=finalize_hook,
            auxiliary_profile=auxiliary_profile,
        )


def replace_outer_entry(entries, name, replacement):
    index = next(index for index, entry in enumerate(entries) if entry[0].name == name)
    entries[index] = replacement


def canonical_test_sha256(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii")
    ).hexdigest()


def auxiliary_chain_entries(*, count=10, values_mutator=None, tar_order=None, comment_size=0):
    ids = [hashlib.sha256(f"declared-v1-id-{index}".encode("ascii")).hexdigest() for index in range(count)]
    values = []
    for index, identifier in enumerate(ids):
        value = {
            "id": identifier,
            "created": f"2026-01-{index + 1:02d}T00:00:00Z",
            "container_config": {},
            "os": "linux",
        }
        if index:
            value["parent"] = ids[index - 1]
        if comment_size:
            value["comment"] = "x" * comment_size
        values.append(value)
    if values_mutator is not None:
        values_mutator(values)
    payloads = [json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii") for value in values]
    paths = [f"blobs/sha256/{hashlib.sha256(payload).hexdigest()}" for payload in payloads]
    entries = [regular(path, payload) for path, payload in zip(paths, payloads, strict=True)]
    if tar_order is not None:
        entries = [entries[index] for index in tar_order]
    payload_sha256s = [hashlib.sha256(payload).hexdigest() for payload in payloads]
    key_set_sha256s = [canonical_test_sha256(sorted(value)) for value in values]
    ordered_records = [
        {
            "payloadSha256": payload_sha256s[index],
            "bytes": len(payloads[index]),
            "id": values[index].get("id"),
            "parent": values[index].get("parent"),
            "keySetSha256": key_set_sha256s[index],
        }
        for index in range(count)
    ]
    candidate_inventory = sorted(
        (
            {"path": path, "type": "file", "size": len(payload), "payloadSha256": digest}
            for path, payload, digest in zip(paths, payloads, payload_sha256s, strict=True)
        ),
        key=lambda value: value["path"],
    )
    expected = {
        "payloadSha256s": payload_sha256s,
        "payloadBytes": [len(payload) for payload in payloads],
        "v1Ids": [value.get("id") for value in values],
        "keySetSha256s": key_set_sha256s,
        "orderedSetSha256": canonical_test_sha256(ordered_records),
        "candidateSetSha256": canonical_test_sha256(candidate_inventory),
        "candidateBytes": sum(len(payload) for payload in payloads),
    }
    return entries, expected


def zero_container_config():
    return {
        "Hostname": "",
        "Domainname": "",
        "User": "",
        "AttachStdin": False,
        "AttachStdout": False,
        "AttachStderr": False,
        "Tty": False,
        "OpenStdin": False,
        "StdinOnce": False,
        "Env": None,
        "Cmd": None,
        "Image": "",
        "Volumes": None,
        "WorkingDir": "",
        "Entrypoint": None,
        "OnBuild": None,
        "Labels": None,
    }


def fixed_source_runtime_config():
    return {
        "ArgsEscaped": True,
        "Cmd": ["serve", "-s3"],
        "Entrypoint": ["/bin/weed"],
        "Env": ["FIXTURE=1"],
        "ExposedPorts": {"8333/tcp": {}},
        "Labels": {"false": False, "zero": 0, "true": True, "one": 1, "null": None},
        "Volumes": {"/data": {}},
        "WorkingDir": "/fixture",
    }


def fixed_auxiliary_chain(source_config, *, values_mutator=None, tar_order=None):
    ids = [hashlib.sha256(f"fixed-auxiliary-id-{index}".encode("ascii")).hexdigest() for index in range(10)]
    zero = zero_container_config()
    values = []
    for index, identifier in enumerate(ids):
        value = {
            "id": identifier,
            "created": "1970-01-01T00:00:00Z",
            "container_config": json.loads(json.dumps(zero)),
            "os": "linux",
        }
        if index:
            value["parent"] = ids[index - 1]
        values.append(value)
    values[-1] = {
        "id": ids[-1],
        "parent": ids[-2],
        "created": source_config["created"],
        "container_config": json.loads(json.dumps(zero)),
        "config": {**json.loads(json.dumps(zero)), **json.loads(json.dumps(source_config["config"]))},
        "architecture": "amd64",
        "os": "linux",
    }
    if values_mutator is not None:
        values_mutator(values)
    payloads = [json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii") for value in values]
    payload_sha256s = [hashlib.sha256(payload).hexdigest() for payload in payloads]
    paths = [f"blobs/sha256/{digest}" for digest in payload_sha256s]
    entries = [regular(path, payload) for path, payload in zip(paths, payloads, strict=True)]
    if tar_order is not None:
        entries = [entries[index] for index in tar_order]
    payload_bytes = [len(payload) for payload in payloads]
    key_set_sha256s = [canonical_test_sha256(sorted(value)) for value in values]
    candidate_inventory = sorted(
        (
            {"path": path, "type": "file", "size": size, "payloadSha256": digest}
            for path, size, digest in zip(paths, payload_bytes, payload_sha256s, strict=True)
        ),
        key=lambda value: value["path"],
    )
    ordered_records = [
        {
            "payloadSha256": payload_sha256s[index],
            "bytes": payload_bytes[index],
            "id": ids[index],
            "parent": None if index == 0 else ids[index - 1],
            "keySetSha256": key_set_sha256s[index],
        }
        for index in range(10)
    ]
    profile = {
        "candidateBytes": sum(payload_bytes),
        "candidateSetSha256": canonical_test_sha256(candidate_inventory),
        "payloadSha256s": payload_sha256s,
        "payloadBytes": payload_bytes,
        "v1Ids": ids,
        "keySetSha256s": key_set_sha256s,
        "orderedSetSha256": canonical_test_sha256(ordered_records),
    }
    envelope = {
        "schemaVersion": 1,
        "kind": "MOBY_28_V1_AUXILIARY_FIXED_SOURCE_V1",
        "createIdBinding": "NOT_RECOMPUTED",
        "auxiliaryToRawLayerBinding": "NOT_INDEPENDENTLY_VERIFIED",
        "candidateCount": 10,
        **profile,
        "semanticProjectionMatched": True,
    }
    return entries, profile, envelope


def fixed_auxiliary_moby_fixture(
    *,
    values_mutator=None,
    source_config_mutator=None,
    auxiliary_entries_mutator=None,
    layer_entries_mutator=None,
    tar_order=None,
):
    captured = {}

    def prepare_config(config):
        config.update({
            "created": "2026-10-27T12:34:56.123456789Z",
            "architecture": "amd64",
            "os": "linux",
            "config": fixed_source_runtime_config(),
            "history": [{"created_by": "inert fixture"}],
        })
        if source_config_mutator is not None:
            source_config_mutator(config)
        additions, profile, envelope = fixed_auxiliary_chain(
            config,
            values_mutator=values_mutator,
            tar_order=tar_order,
        )
        captured.update(additions=additions, profile=profile, envelope=envelope)

    def append_auxiliary(entries, context):
        additions = list(captured["additions"])
        if auxiliary_entries_mutator is not None:
            auxiliary_entries_mutator(additions, context)
        entries.extend(additions)

    archive, config, config_sha256, diff_ids = moby_source_save_fixture(
        config_mutator=prepare_config,
        outer_mutator=append_auxiliary,
        layer_entries_mutator=layer_entries_mutator,
    )
    return archive, config, config_sha256, diff_ids, captured["profile"], captured["envelope"]


def append_outer_entries(additions):
    def append(entries, _context):
        entries.extend(additions)

    return append


def replace_auxiliary_payload(entries, index, payload):
    digest = hashlib.sha256(payload).hexdigest()
    entries[index] = regular(f"blobs/sha256/{digest}", payload)


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
        self.assertNotIn("auxiliaryDiagnostic", result)
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

    def test_fixed_auxiliary_metadata_passes_only_with_both_independent_envelopes(self):
        archive, config, config_sha256, diff_ids, profile, expected_envelope = fixed_auxiliary_moby_fixture(
            tar_order=[8, 1, 6, 3, 0, 9, 5, 2, 7, 4],
        )
        result = inspect_fixture_values(
            archive,
            config,
            config_sha256,
            diff_ids,
            auxiliary_profile=profile,
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["auxiliaryEnvelope"], expected_envelope)
        self.assertEqual(result["sourceEnvelope"]["kind"], "MOBY_28_OCI_COMPAT_V1")
        self.assertEqual([layer["sha256"] for layer in result["layers"]], diff_ids)
        self.assertNotIn("auxiliaryDiagnostic", result)

    def test_fixed_profile_requires_all_auxiliary_roles_while_bare_fixture_mode_remains_explicit(self):
        fixed = fixed_auxiliary_moby_fixture()
        bare = moby_source_save_fixture()
        with self.assertRaises(InspectionRefusal) as caught:
            inspect_fixture_values(*bare, auxiliary_profile=fixed[4])
        self.assertEqual(caught.exception.code, "save_envelope_invalid")
        self.assertEqual(caught.exception.envelope_diagnostic["node"], "auxiliary")
        self.assertEqual(caught.exception.envelope_diagnostic["predicate"], "cardinality")

        bare_result = inspect_fixture_values(*bare)
        self.assertEqual(bare_result["status"], "PASS")
        self.assertNotIn("auxiliaryEnvelope", bare_result)

    def test_legacy_fixture_does_not_gain_auxiliary_authority_from_a_supplied_profile(self):
        fixed = fixed_auxiliary_moby_fixture()
        legacy = source_save_fixture()
        result = inspect_fixture_values(*legacy, auxiliary_profile=fixed[4])
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("sourceEnvelope", result)
        self.assertNotIn("auxiliaryEnvelope", result)

    def test_fixed_auxiliary_identity_pins_are_compared_after_recomputation(self):
        archive, config, config_sha256, diff_ids, profile, _envelope = fixed_auxiliary_moby_fixture()

        def different(value):
            return ("f" if value[0] != "f" else "e") + value[1:]

        mutations = (
            ("payload-hash", lambda value: value["payloadSha256s"].__setitem__(3, different(value["payloadSha256s"][3]))),
            ("payload-size", lambda value: (value["payloadBytes"].__setitem__(3, value["payloadBytes"][3] + 1), value.__setitem__("candidateBytes", value["candidateBytes"] + 1))),
            ("v1-id", lambda value: value["v1Ids"].__setitem__(3, different(value["v1Ids"][3]))),
            ("key-set", lambda value: value["keySetSha256s"].__setitem__(3, different(value["keySetSha256s"][3]))),
            ("candidate-set", lambda value: value.__setitem__("candidateSetSha256", different(value["candidateSetSha256"]))),
            ("ordered-set", lambda value: value.__setitem__("orderedSetSha256", different(value["orderedSetSha256"]))),
        )
        for label, mutate in mutations:
            changed = json.loads(json.dumps(profile))
            mutate(changed)
            with self.subTest(pin=label), self.assertRaises(InspectionRefusal) as caught:
                inspect_fixture_values(archive, config, config_sha256, diff_ids, auxiliary_profile=changed)
            self.assertEqual(caught.exception.code, "save_envelope_invalid")
            self.assertEqual(caught.exception.envelope_diagnostic["node"], "auxiliary")
            self.assertNotIn("auxiliaryDiagnostic", archive_module._refusal_json(caught.exception))

    def test_a_structurally_valid_alternate_profile_cannot_authorize_other_auxiliary_bytes(self):
        original = fixed_auxiliary_moby_fixture()

        def alternate_created(values):
            values[0]["created"] = "1970-01-01T00:00:01Z"

        alternate = fixed_auxiliary_moby_fixture(values_mutator=alternate_created)
        with self.assertRaises(InspectionRefusal) as caught:
            inspect_fixture_values(*original[:4], auxiliary_profile=alternate[4])
        self.assertEqual(caught.exception.code, "save_envelope_invalid")
        self.assertEqual(caught.exception.envelope_diagnostic["node"], "auxiliary")
        self.assertEqual(caught.exception.envelope_diagnostic["predicate"], "digest")
        self.assertEqual(caught.exception.envelope_diagnostic["ordinal"], 1)

    def test_semantic_projection_rejects_typed_drift_even_when_all_fixture_pins_match(self):
        def root_created(values):
            values[0]["created"] = "1970-01-01T00:00:01Z"

        def node_os(values):
            values[4]["os"] = "windows"

        def final_architecture(values):
            values[-1]["architecture"] = "arm64"

        def missing_zero(values):
            values[2]["container_config"].pop("Hostname")

        def optional_empty(values):
            values[2]["comment"] = ""

        def false_as_zero(values):
            values[2]["container_config"]["AttachStdin"] = 0

        def null_as_absent(values):
            values[2]["container_config"].pop("Env")

        def nested_runtime_drift(values):
            values[-1]["config"]["Labels"]["false"] = 0

        def true_as_one(values):
            values[-1]["config"]["Labels"]["true"] = 1

        def missing_port(values):
            values[-1]["config"]["ExposedPorts"] = {}

        def final_created(values):
            values[-1]["created"] = "2026-10-27T12:34:56Z"

        cases = (
            ("root-created", root_created, "auxiliary"),
            ("node-os", node_os, "outer"),
            ("final-architecture", final_architecture, "auxiliary"),
            ("missing-zero", missing_zero, "auxiliary"),
            ("optional-empty", optional_empty, "auxiliary"),
            ("false-as-zero", false_as_zero, "auxiliary"),
            ("null-as-absent", null_as_absent, "auxiliary"),
            ("nested-runtime", nested_runtime_drift, "auxiliary"),
            ("true-as-one", true_as_one, "auxiliary"),
            ("missing-port", missing_port, "auxiliary"),
            ("final-created", final_created, "auxiliary"),
        )
        for label, mutate, expected_node in cases:
            fixture = fixed_auxiliary_moby_fixture(values_mutator=mutate)
            with self.subTest(case=label), self.assertRaises(InspectionRefusal) as caught:
                inspect_fixture_values(*fixture[:4], auxiliary_profile=fixture[4])
            self.assertEqual(caught.exception.code, "save_envelope_invalid")
            self.assertEqual(caught.exception.envelope_diagnostic["node"], expected_node)
            encoded = json.dumps(archive_module._refusal_json(caught.exception), separators=(",", ":"))
            self.assertNotIn("FIXTURE", encoded)
            self.assertNotIn("/fixture", encoded)

    def test_source_projection_rejects_invalid_headers_and_runtime_shape_under_matching_pins(self):
        def mutate_runtime(callback):
            def mutate(config):
                callback(config["config"])

            return mutate

        cases = (
            ("created-type", lambda config: config.__setitem__("created", None), "auxiliary", "type"),
            ("architecture", lambda config: config.__setitem__("architecture", "arm64"), "auxiliary", "type"),
            ("os", lambda config: config.__setitem__("os", "windows"), "outer", "extra"),
            ("argsescaped-number", mutate_runtime(lambda runtime: runtime.__setitem__("ArgsEscaped", 1)), "auxiliary", "type"),
            ("missing-runtime", mutate_runtime(lambda runtime: runtime.pop("WorkingDir")), "auxiliary", "keys"),
            ("extra-runtime", mutate_runtime(lambda runtime: runtime.__setitem__("Hostname", "")), "auxiliary", "keys"),
        )
        for label, mutate, node, predicate in cases:
            fixture = fixed_auxiliary_moby_fixture(source_config_mutator=mutate)
            with self.subTest(case=label), self.assertRaises(InspectionRefusal) as caught:
                inspect_fixture_values(*fixture[:4], auxiliary_profile=fixture[4])
            self.assertEqual(caught.exception.code, "save_envelope_invalid")
            self.assertEqual(caught.exception.envelope_diagnostic["node"], node)
            self.assertEqual(caught.exception.envelope_diagnostic["predicate"], predicate)

    def test_fixed_profile_rejects_missing_extra_nonregular_encoded_and_aliased_auxiliary_roles(self):
        def missing(entries, _context):
            entries.pop()

        def extra(entries, _context):
            entries.append(regular(f"blobs/sha256/{hashlib.sha256(b'extra').hexdigest()}", b"extra"))

        def nonregular(entries, _context):
            entries[0] = directory(entries[0][0].name)

        def encoded(entries, _context):
            entries[0] = regular("blobs/sha256/%61", entries[0][1])

        def aliased(entries, context):
            entries[0] = regular(context["configPath"], entries[0][1])

        for label, mutate, code in (
            ("missing", missing, "save_envelope_invalid"),
            ("extra", extra, "save_envelope_invalid"),
            ("nonregular", nonregular, "save_envelope_invalid"),
            ("encoded", encoded, "save_envelope_invalid"),
            ("aliased", aliased, "duplicate_member"),
        ):
            fixture = fixed_auxiliary_moby_fixture(auxiliary_entries_mutator=mutate)
            with self.subTest(case=label), self.assertRaises(InspectionRefusal) as caught:
                inspect_fixture_values(*fixture[:4], auxiliary_profile=fixture[4])
            self.assertEqual(caught.exception.code, code)
            self.assertNotIn("auxiliaryEnvelope", archive_module._refusal_json(caught.exception))

    def test_production_wrapper_always_supplies_the_fixed_profile_without_an_override_surface(self):
        sentinel = {"status": "PASS"}
        with mock.patch.object(archive_module, "_inspect_source_save", return_value=sentinel) as inspect_internal:
            self.assertIs(archive_module.inspect_source_save("archive", "config"), sentinel)
        inspect_internal.assert_called_once_with(
            "archive",
            "config",
            expected_config_sha256=archive_module.SOURCE_CONFIG_SHA256,
            expected_diff_ids=archive_module.SOURCE_DIFF_IDS,
            auxiliary_profile=archive_module.PRODUCTION_AUXILIARY_PROFILE,
        )
        with self.assertRaises(TypeError):
            archive_module.inspect_source_save("archive", "config", auxiliary_profile={})

    def test_recognized_auxiliary_metadata_cannot_hide_a_hostile_raw_layer(self):
        def escaping_symlink(index, entries):
            return [symlink("escape", "../outside")] if index == 7 else entries

        fixture = fixed_auxiliary_moby_fixture(layer_entries_mutator=escaping_symlink)
        with self.assertRaises(InspectionRefusal) as caught:
            inspect_fixture_values(*fixture[:4], auxiliary_profile=fixture[4])
        self.assertEqual(caught.exception.code, "symlink_target_invalid")
        self.assertIsNone(caught.exception.auxiliary_diagnostic)

    def test_input_drift_overrides_a_complete_fixed_auxiliary_pass(self):
        archive_value, config_value, config_sha256, diff_ids, profile, _envelope = fixed_auxiliary_moby_fixture()
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
                    auxiliary_profile=profile,
                    finalize_hook=mutate_archive,
                )
        self.assertEqual(caught.exception.code, "source_changed")

    def test_complete_auxiliary_chain_is_committed_in_parent_order_but_remains_refused(self):
        additions, expected = auxiliary_chain_entries(tar_order=list(reversed(range(10))))
        refusal = inspect_source_fixture_refusal(
            self,
            fixture_builder=moby_source_save_fixture,
            outer_mutator=append_outer_entries(additions),
        )
        self.assertEqual(refusal.code, "save_envelope_invalid")
        self.assertEqual(refusal.envelope_diagnostic["node"], "outer")
        self.assertEqual(refusal.envelope_diagnostic["predicate"], "extra")
        diagnostic = refusal.auxiliary_diagnostic
        self.assertEqual(diagnostic["classification"], "COMPATIBLE_UNVERIFIED")
        self.assertEqual(diagnostic["createIdBinding"], "NOT_RECOMPUTED")
        self.assertEqual(diagnostic["candidateCount"], 10)
        self.assertEqual(diagnostic["examinedCount"], 10)
        self.assertEqual(diagnostic["parentChainMatched"], True)
        self.assertEqual(diagnostic["payloadSha256s"], expected["payloadSha256s"])
        self.assertEqual(diagnostic["payloadBytes"], expected["payloadBytes"])
        self.assertEqual(diagnostic["v1Ids"], expected["v1Ids"])
        self.assertEqual(diagnostic["keySetSha256s"], expected["keySetSha256s"])
        self.assertEqual(diagnostic["orderedSetSha256"], expected["orderedSetSha256"])
        self.assertEqual(diagnostic["candidateSetSha256"], expected["candidateSetSha256"])
        self.assertEqual(diagnostic["candidateBytes"], expected["candidateBytes"])
        self.assertLessEqual(len(json.dumps(
            diagnostic,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii")), 8192)

    def test_auxiliary_chain_commitments_do_not_depend_on_tar_member_order(self):
        first_entries, first_expected = auxiliary_chain_entries(tar_order=list(range(10)))
        second_entries, second_expected = auxiliary_chain_entries(tar_order=[3, 7, 1, 9, 0, 8, 2, 6, 4, 5])
        diagnostics = []
        for additions in (first_entries, second_entries):
            refusal = inspect_source_fixture_refusal(
                self,
                fixture_builder=moby_source_save_fixture,
                outer_mutator=append_outer_entries(additions),
            )
            diagnostics.append(refusal.auxiliary_diagnostic)
        self.assertEqual(first_expected, second_expected)
        self.assertEqual(diagnostics[0], diagnostics[1])

    def test_auxiliary_candidate_count_states_stop_before_json_reads(self):
        for count, classification, mismatch, truncated in (
            (1, "REFUSED", "cardinality", False),
            (9, "REFUSED", "cardinality", False),
            (11, "LIMIT_EXCEEDED", "candidate-limit", True),
        ):
            additions, _expected = auxiliary_chain_entries(count=count)
            with self.subTest(count=count):
                refusal = inspect_source_fixture_refusal(
                    self,
                    fixture_builder=moby_source_save_fixture,
                    outer_mutator=append_outer_entries(additions),
                )
                diagnostic = refusal.auxiliary_diagnostic
                self.assertEqual(diagnostic["candidateCount"], count)
                self.assertEqual(diagnostic["classification"], classification)
                self.assertEqual(diagnostic["firstMismatch"], mismatch)
                self.assertEqual(diagnostic["truncated"], truncated)
                self.assertEqual(diagnostic["examinedCount"], 0)
                self.assertEqual(diagnostic["payloadSha256s"], [])
                self.assertIsNone(diagnostic["orderedSetSha256"])

    def test_auxiliary_preparse_predicates_follow_member_path_digest_size_and_total_order(self):
        cases = []

        entries, _expected = auxiliary_chain_entries()
        entries[0] = directory(entries[0][0].name)
        cases.append(("member", entries))

        entries, _expected = auxiliary_chain_entries()
        entries[0] = regular("foreign/auxiliary.json", entries[0][1])
        cases.append(("path", entries))

        entries, _expected = auxiliary_chain_entries()
        wrong_digest = "f" * 64
        if entries[0][0].name.endswith(wrong_digest):
            wrong_digest = "e" * 64
        entries[0] = regular(f"blobs/sha256/{wrong_digest}", entries[0][1])
        cases.append(("digest", entries))

        entries, _expected = auxiliary_chain_entries()
        empty = b""
        entries[0] = regular(f"blobs/sha256/{hashlib.sha256(empty).hexdigest()}", empty)
        cases.append(("size", entries))

        entries, _expected = auxiliary_chain_entries()
        oversized = b"x" * 65_537
        entries[0] = regular(f"blobs/sha256/{hashlib.sha256(oversized).hexdigest()}", oversized)
        cases.append(("size", entries))

        entries, _expected = auxiliary_chain_entries(comment_size=30_000)
        cases.append(("total-size", entries))

        for mismatch, additions in cases:
            with self.subTest(mismatch=mismatch, bytes=sum(entry[0].size for entry in additions)):
                refusal = inspect_source_fixture_refusal(
                    self,
                    fixture_builder=moby_source_save_fixture,
                    outer_mutator=append_outer_entries(additions),
                )
                diagnostic = refusal.auxiliary_diagnostic
                self.assertEqual(diagnostic["classification"], "REFUSED")
                self.assertEqual(diagnostic["firstMismatch"], mismatch)
                self.assertEqual(diagnostic["examinedCount"], 0)
                self.assertIsNone(diagnostic["parentChainMatched"])
                self.assertEqual(diagnostic["payloadSha256s"], [])

    def test_auxiliary_json_predicates_stop_at_the_first_defined_failure(self):
        base_entries, _expected = auxiliary_chain_entries()
        valid_id = hashlib.sha256(b"valid-id").hexdigest()
        valid_object = {
            "id": valid_id,
            "created": None,
            "container_config": {},
            "os": "linux",
        }
        payload_cases = (
            ("json", b"\xff"),
            ("json", b"{"),
            ("json", b"NaN"),
            ("json", f'{{"id":"{valid_id}","id":"{valid_id}"}}'.encode("ascii")),
            ("root-type", b"[]"),
            ("keys", b'{"hostSecret":"C:\\\\private\\\\source-save.tar"}'),
            ("required-fields", json.dumps({"id": "bad"}, separators=(",", ":")).encode("ascii")),
            (
                "required-fields",
                json.dumps({**valid_object, "created": 1}, separators=(",", ":")).encode("ascii"),
            ),
            (
                "required-fields",
                json.dumps({**valid_object, "container_config": []}, separators=(",", ":")).encode("ascii"),
            ),
            (
                "required-fields",
                json.dumps({**valid_object, "os": "windows"}, separators=(",", ":")).encode("ascii"),
            ),
            ("id", json.dumps({**valid_object, "id": "bad", "parent": "bad"}, separators=(",", ":")).encode("ascii")),
            ("parent", json.dumps({**valid_object, "parent": None}, separators=(",", ":")).encode("ascii")),
        )
        for mismatch, payload in payload_cases:
            additions = [(info, data) for info, data in base_entries]
            replace_auxiliary_payload(additions, 4, payload)
            failing_path = additions[4][0].name
            expected_examined = sorted(entry[0].name for entry in additions).index(failing_path) + 1
            with self.subTest(mismatch=mismatch, expected_examined=expected_examined):
                refusal = inspect_source_fixture_refusal(
                    self,
                    fixture_builder=moby_source_save_fixture,
                    outer_mutator=append_outer_entries(additions),
                )
                diagnostic = refusal.auxiliary_diagnostic
                self.assertEqual(diagnostic["firstMismatch"], mismatch)
                self.assertEqual(diagnostic["examinedCount"], expected_examined)
                self.assertIsNone(diagnostic["parentChainMatched"])
                self.assertEqual(diagnostic["payloadSha256s"], [])

        additions = [(info, data) for info, data in base_entries]
        additions[4] = regular("foreign/not-content-addressed", b"{")
        refusal = inspect_source_fixture_refusal(
            self,
            fixture_builder=moby_source_save_fixture,
            outer_mutator=append_outer_entries(additions),
        )
        self.assertEqual(refusal.auxiliary_diagnostic["firstMismatch"], "path")
        self.assertEqual(refusal.auxiliary_diagnostic["examinedCount"], 0)

    def test_auxiliary_failure_diagnostics_do_not_publish_unknown_names_values_or_paths(self):
        secret_names = [f"C:\\private\\field-{index}\nsecret" for index in range(128)]

        def add_secrets(values):
            values[3].update({name: f"raw-value-{index}" for index, name in enumerate(secret_names)})

        additions, _expected = auxiliary_chain_entries(values_mutator=add_secrets)
        refusal = inspect_source_fixture_refusal(
            self,
            fixture_builder=moby_source_save_fixture,
            outer_mutator=append_outer_entries(additions),
        )
        diagnostic = refusal.auxiliary_diagnostic
        encoded = json.dumps(diagnostic, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii")
        self.assertEqual(diagnostic["firstMismatch"], "keys")
        self.assertLessEqual(len(encoded), 8192)
        self.assertNotIn(b"private", encoded)
        self.assertNotIn(b"secret", encoded)
        self.assertNotIn(b"raw-value", encoded)
        self.assertNotIn(os.fspath(REPOSITORY_ROOT).encode("ascii"), encoded)

    def test_auxiliary_chain_failures_follow_duplicate_root_orphan_branch_cycle_order(self):
        def duplicate_id(values):
            values[5]["id"] = values[4]["id"]

        def two_roots_and_orphan(values):
            values[5].pop("parent")
            values[6]["parent"] = "f" * 64

        def orphan(values):
            values[5]["parent"] = "f" * 64

        def branch(values):
            values[2]["parent"] = values[0]["id"]

        def disconnected_cycle(values):
            values[8]["parent"] = values[9]["id"]
            values[9]["parent"] = values[8]["id"]

        cases = (
            (duplicate_id, "duplicate-id", None),
            (two_roots_and_orphan, "root-count", False),
            (orphan, "orphan", False),
            (branch, "branch", False),
            (disconnected_cycle, "cycle", False),
        )
        for mutate, mismatch, chain_state in cases:
            additions, _expected = auxiliary_chain_entries(values_mutator=mutate)
            with self.subTest(mismatch=mismatch):
                refusal = inspect_source_fixture_refusal(
                    self,
                    fixture_builder=moby_source_save_fixture,
                    outer_mutator=append_outer_entries(additions),
                )
                diagnostic = refusal.auxiliary_diagnostic
                self.assertEqual(diagnostic["classification"], "REFUSED")
                self.assertEqual(diagnostic["firstMismatch"], mismatch)
                self.assertEqual(diagnostic["examinedCount"], 10)
                self.assertEqual(diagnostic["parentChainMatched"], chain_state)
                self.assertEqual(diagnostic["payloadSha256s"], [])
                self.assertIsNone(diagnostic["orderedSetSha256"])

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

    def test_archive_drift_suppresses_an_otherwise_complete_auxiliary_diagnostic(self):
        additions, _expected = auxiliary_chain_entries()
        archive_value, config_value, config_sha256, diff_ids = moby_source_save_fixture(
            outer_mutator=append_outer_entries(additions)
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

    def test_cli_joins_auxiliary_diagnostics_only_to_outer_extra_envelope_refusals(self):
        additions, _expected = auxiliary_chain_entries()
        actual = inspect_source_fixture_refusal(
            self,
            fixture_builder=moby_source_save_fixture,
            outer_mutator=append_outer_entries(additions),
        )
        wrong_node = dict(actual.envelope_diagnostic)
        wrong_node["node"] = "raw-layer"
        cases = (
            (actual, True),
            (InspectionRefusal(
                "archive_truncated",
                envelope_diagnostic=actual.envelope_diagnostic,
                auxiliary_diagnostic=actual.auxiliary_diagnostic,
            ), False),
            (InspectionRefusal(
                "save_envelope_invalid",
                envelope_diagnostic=wrong_node,
                auxiliary_diagnostic=actual.auxiliary_diagnostic,
            ), False),
            (InspectionRefusal(
                "save_envelope_invalid",
                manifest_diagnostic={"private": "manifest"},
                envelope_diagnostic=actual.envelope_diagnostic,
                auxiliary_diagnostic=actual.auxiliary_diagnostic,
            ), False),
        )
        archive = os.fspath((REPOSITORY_ROOT / "private-source-save.tar").resolve())
        config = os.fspath((REPOSITORY_ROOT / "private-source-config.json").resolve())
        for refusal, expect_auxiliary in cases:
            with self.subTest(code=refusal.code, expect_auxiliary=expect_auxiliary):
                stdout = io.StringIO()
                stderr = io.StringIO()
                with mock.patch.object(archive_module, "_activate_cli_limits", return_value=None), \
                        mock.patch.object(archive_module, "inspect_source_save", side_effect=refusal):
                    with redirect_stdout(stdout), redirect_stderr(stderr):
                        status = archive_module.main(["source-save", "--archive", archive, "--config", config])
                self.assertEqual(status, 2)
                self.assertEqual(stderr.getvalue(), "")
                output = json.loads(stdout.getvalue())
                self.assertEqual("auxiliaryDiagnostic" in output, expect_auxiliary)
                self.assertEqual("sourceEnvelope" in output, False)
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


class InertQualificationCliTests(unittest.TestCase):
    def run_cli(self, arguments):
        stdout = io.StringIO()
        stderr = io.StringIO()
        with mock.patch.object(archive_module, "_activate_cli_limits", return_value=None):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                status = archive_module.main(arguments)
        self.assertEqual(stderr.getvalue(), "")
        self.assertNotIn("Traceback", stdout.getvalue())
        return status, json.loads(stdout.getvalue())

    def assert_fixed_fixture_report(self, report, operation):
        self.assertEqual(
            set(report),
            {"schemaVersion", "profile", "evidenceClass", "kind", "status", "operation", "archive", "members", "sentinel"},
        )
        self.assertEqual(report["schemaVersion"], 1)
        self.assertEqual(report["profile"], "go-s3-4.51-v1")
        self.assertEqual(report["evidenceClass"], "INERT_CONSTRUCTION_QUALIFICATION")
        self.assertEqual(report["kind"], "INERT_FIXTURE_V1")
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["operation"], operation)
        self.assertEqual(
            set(report["archive"]),
            {"sha256", "bytes", "memberCount", "semanticSha256", "orderedRawSha256"},
        )
        self.assertEqual(report["archive"]["memberCount"], 16)
        self.assertEqual(len(report["members"]), 16)
        for actual, expected in zip(report["members"], INERT_FIXTURE_SPEC, strict=True):
            name, member_type, mode, uid, gid, mtime, payload, linkname = expected
            self.assertEqual(
                set(actual),
                {"path", "type", "mode", "uid", "gid", "mtime", "size", "linkname", "payloadSha256", "rawSha256"},
            )
            self.assertEqual(
                {key: actual[key] for key in ("path", "type", "mode", "uid", "gid", "mtime", "size", "linkname", "payloadSha256")},
                {
                    "path": name,
                    "type": member_type,
                    "mode": mode,
                    "uid": uid,
                    "gid": gid,
                    "mtime": mtime,
                    "size": len(payload) if member_type == "file" else 0,
                    "linkname": linkname,
                    "payloadSha256": hashlib.sha256(payload if member_type == "file" else b"").hexdigest(),
                },
            )
            self.assertRegex(actual["rawSha256"], r"^[0-9a-f]{64}$")
        sentinel_payload = b"volume-underlay-sentinel-v1\n"
        self.assertEqual(
            report["sentinel"],
            {
                "path": "data/sentinel.txt",
                "sha256": hashlib.sha256(sentinel_payload).hexdigest(),
                "bytes": 28,
            },
        )

    def write_fixture(self, directory):
        archive = directory / "fixture.tar"
        status, report = self.run_cli(["fixture-write", "--archive", os.fspath(archive.resolve())])
        self.assertEqual(status, 0)
        self.assert_fixed_fixture_report(report, "WRITE")
        self.assertEqual(report["archive"]["bytes"], archive.stat().st_size)
        self.assertEqual(report["archive"]["sha256"], hashlib.sha256(archive.read_bytes()).hexdigest())
        self.assertEqual(archive.stat().st_mode & 0o777, 0o444)
        return archive, report

    def test_fixture_writer_and_inspector_pin_the_independent_sixteen_member_contract(self):
        with tempfile.TemporaryDirectory() as directory_name:
            archive, written = self.write_fixture(Path(directory_name))
            status, inspected = self.run_cli(["fixture-inspect", "--archive", os.fspath(archive.resolve())])
            self.assertEqual(status, 0)
            self.assert_fixed_fixture_report(inspected, "INSPECT")
            self.assertEqual(inspected["archive"], written["archive"])
            self.assertEqual(inspected["members"], written["members"])

    def test_fixture_writer_refuses_to_overwrite_an_existing_file(self):
        with tempfile.TemporaryDirectory() as directory_name:
            archive = Path(directory_name) / "fixture.tar"
            archive.write_bytes(b"keep-existing")
            status, report = self.run_cli(["fixture-write", "--archive", os.fspath(archive.resolve())])
            self.assertEqual(status, 3)
            self.assertEqual(report["status"], "ERROR")
            self.assertEqual(archive.read_bytes(), b"keep-existing")

    def test_fixture_inspector_refuses_gnu_longname_metadata_even_when_the_resolved_path_is_unchanged(self):
        entries = inert_fixture_entries()
        original = archive_bytes(entries, fmt=tarfile.USTAR_FORMAT)
        extension = tar_extension_record(tarfile.GNUTYPE_LONGNAME, b"etc\0")
        with tempfile.TemporaryDirectory() as directory_name:
            archive = Path(directory_name) / "gnu-longname.tar"
            archive.write_bytes(extension + original)
            archive.chmod(0o444)
            status, report = self.run_cli(["fixture-inspect", "--archive", os.fspath(archive.resolve())])
            self.assertEqual(status, 2)
            self.assertEqual(report["refusal"], {"code": "archive_hidden_region", "member": "etc"})

    def test_fixture_inspector_refuses_gnu_longlink_metadata_even_when_the_resolved_target_is_unchanged(self):
        entries = inert_fixture_entries()
        original = archive_bytes(entries, fmt=tarfile.USTAR_FORMAT)
        offset = tar_member_offset(entries, 15)
        extension = tar_extension_record(tarfile.GNUTYPE_LONGLINK, b"opt/auto-world/marker.txt\0")
        with tempfile.TemporaryDirectory() as directory_name:
            archive = Path(directory_name) / "gnu-longlink.tar"
            archive.write_bytes(original[:offset] + extension + original[offset:])
            archive.chmod(0o444)
            status, report = self.run_cli(["fixture-inspect", "--archive", os.fspath(archive.resolve())])
            self.assertEqual(status, 2)
            self.assertEqual(report["refusal"], {"code": "archive_hidden_region", "member": "marker-link"})

    def test_fixture_inspector_refuses_a_mixed_pax_and_gnu_extension_chain(self):
        entries = inert_fixture_entries()
        original = archive_bytes(entries, fmt=tarfile.USTAR_FORMAT)
        pax = tar_extension_record(tarfile.XHDTYPE, pax_record("path", "etc"))
        gnu = tar_extension_record(tarfile.GNUTYPE_LONGNAME, b"etc\0")
        with tempfile.TemporaryDirectory() as directory_name:
            archive = Path(directory_name) / "mixed-extension.tar"
            archive.write_bytes(pax + gnu + original)
            archive.chmod(0o444)
            status, report = self.run_cli(["fixture-inspect", "--archive", os.fspath(archive.resolve())])
            self.assertEqual(status, 2)
            self.assertEqual(report["refusal"], {"code": "archive_hidden_region", "member": "etc"})

    def test_fixture_inspector_refuses_duplicate_pax_keys_before_tarfile_can_collapse_them(self):
        entries = inert_fixture_entries()
        original = archive_bytes(entries, fmt=tarfile.USTAR_FORMAT)
        duplicate = pax_record("path", "etc") + pax_record("path", "etc")
        extension = tar_extension_record(tarfile.XHDTYPE, duplicate)
        with tempfile.TemporaryDirectory() as directory_name:
            archive = Path(directory_name) / "duplicate-pax.tar"
            archive.write_bytes(extension + original)
            archive.chmod(0o444)
            status, report = self.run_cli(["fixture-inspect", "--archive", os.fspath(archive.resolve())])
            self.assertEqual(status, 2)
            self.assertEqual(report["refusal"], {"code": "archive_hidden_region", "member": "etc"})

    def test_export_comparison_accepts_semantic_fidelity_with_different_order_and_raw_encoding(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            original, _report = self.write_fixture(directory)
            exported = directory / "exported.tar"
            exported.write_bytes(archive_bytes(list(reversed(inert_fixture_entries())), fmt=tarfile.PAX_FORMAT))
            exported.chmod(0o444)
            status, report = self.run_cli([
                "export-compare", "--original", os.fspath(original.resolve()), "--export", os.fspath(exported.resolve()),
            ])
            self.assertEqual(status, 0)
            self.assertEqual(report["kind"], "INERT_EXPORT_SEMANTICS_V1")
            self.assertEqual(report["matched"], True)
            self.assertEqual(report["original"]["memberCount"], 16)
            self.assertEqual(report["exported"]["memberCount"], 16)
            self.assertNotEqual(report["original"]["orderedRawSha256"], report["exported"]["orderedRawSha256"])

    def test_export_comparison_refuses_a_changed_sentinel(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            original, _report = self.write_fixture(directory)
            changed_spec = list(INERT_FIXTURE_SPEC)
            sentinel = list(changed_spec[14])
            sentinel[6] = b"changed-underlay-sentinel-v1\n"
            changed_spec[14] = tuple(sentinel)
            exported = directory / "exported.tar"
            exported.write_bytes(archive_bytes(inert_fixture_entries(changed_spec), fmt=tarfile.USTAR_FORMAT))
            exported.chmod(0o444)
            status, report = self.run_cli([
                "export-compare", "--original", os.fspath(original.resolve()), "--export", os.fspath(exported.resolve()),
            ])
            self.assertEqual(status, 2)
            self.assertEqual(report["status"], "REFUSED")
            self.assertEqual(report["refusal"]["code"], "qualification_export_mismatch")

    @unittest.skipUnless(sys.platform.startswith("linux") and Path("/usr/bin/tar").is_file(), "GNU tar integration requires Linux")
    def test_gnu_tar_delete_removes_exactly_two_helpers_and_preserves_raw_survivors(self):
        version = subprocess.run(["/usr/bin/tar", "--version"], check=False, capture_output=True, text=True, timeout=10)
        self.assertEqual(version.returncode, 0)
        self.assertIn("GNU tar", version.stdout)
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            original, _report = self.write_fixture(directory)
            filtered = directory / "filtered.tar"
            shutil.copyfile(original, filtered)
            filtered.chmod(0o600)
            deleted = subprocess.run(
                ["/usr/bin/tar", "--delete", "--file", os.fspath(filtered), "usr/bin/weed-volume", "usr/bin/weed-worker"],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual((deleted.returncode, deleted.stdout, deleted.stderr), (0, "", ""))
            filtered.chmod(0o444)
            status, report = self.run_cli([
                "delete-compare", "--original", os.fspath(original.resolve()), "--filtered", os.fspath(filtered.resolve()),
            ])
            self.assertEqual(status, 0)
            self.assertEqual(report["kind"], "INERT_RAW_DELETE_V1")
            self.assertEqual(report["removedCount"], 2)
            self.assertEqual(report["removed"], ["usr/bin/weed-volume", "usr/bin/weed-worker"])
            self.assertEqual(report["survivorCount"], 14)
            expected_paths = [item[0] for item in INERT_FIXTURE_SPEC if item[0] not in set(report["removed"])]
            self.assertEqual([item["path"] for item in report["survivors"]], expected_paths)

    def test_filtered_export_comparison_refuses_reintroduced_helper_content(self):
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            filtered_spec = [item for item in INERT_FIXTURE_SPEC if item[0] not in {"usr/bin/weed-volume", "usr/bin/weed-worker"}]
            filtered = directory / "filtered.tar"
            filtered.write_bytes(archive_bytes(inert_fixture_entries(filtered_spec), fmt=tarfile.USTAR_FORMAT))
            filtered.chmod(0o444)
            exported = directory / "exported.tar"
            exported.write_bytes(archive_bytes(inert_fixture_entries(), fmt=tarfile.USTAR_FORMAT))
            exported.chmod(0o444)
            status, report = self.run_cli([
                "filtered-export-compare", "--filtered", os.fspath(filtered.resolve()), "--export", os.fspath(exported.resolve()),
            ])
            self.assertEqual(status, 2)
            self.assertEqual(report["refusal"]["code"], "qualification_export_mismatch")

    def legacy_arguments(self, archive, fixture):
        return [
            "legacy-save-inspect",
            "--archive", os.fspath(archive.resolve()),
            "--image-id", fixture["image_id"],
            "--tag", fixture["tag"],
            "--diff-id", fixture["diff_id"],
            "--server-version", fixture["server_version"],
            "--created", fixture["created"],
            "--owner", fixture["owner"],
        ]

    def test_legacy_save_inspection_binds_one_classic_layer_to_filtered_semantics(self):
        fixture = inert_legacy_save_fixture()
        with tempfile.TemporaryDirectory() as directory_name:
            archive = Path(directory_name) / "save.tar"
            archive.write_bytes(fixture["archive"])
            archive.chmod(0o444)
            status, report = self.run_cli(self.legacy_arguments(archive, fixture))
            self.assertEqual(status, 0)
            self.assertEqual(
                set(report),
                {"schemaVersion", "profile", "evidenceClass", "kind", "status", "archive", "family", "image", "layer", "graph", "sentinel"},
            )
            self.assertEqual(report["kind"], "INERT_LEGACY_SAVE_V1")
            self.assertEqual(report["family"], "MOBY_LEGACY_SINGLE_LAYER_V1")
            self.assertEqual(report["image"], {
                "imageId": fixture["image_id"],
                "tag": fixture["tag"],
                "owner": fixture["owner"],
                "created": fixture["created"],
                "serverVersion": fixture["server_version"],
                "configSha256": fixture["image_id"].removeprefix("sha256:"),
            })
            self.assertEqual(report["layer"]["diffId"], fixture["diff_id"])
            self.assertEqual(report["layer"]["memberCount"], 14)
            self.assertEqual(report["graph"]["layerId"], fixture["layer_id"])
            self.assertEqual(report["graph"]["descriptorCount"], 1)

    def test_legacy_save_inspection_refuses_any_server_version_other_than_28_0_4(self):
        fixture = inert_legacy_save_fixture()
        with tempfile.TemporaryDirectory() as directory_name:
            archive = Path(directory_name) / "save.tar"
            archive.write_bytes(fixture["archive"])
            archive.chmod(0o444)
            arguments = self.legacy_arguments(archive, fixture)
            arguments[arguments.index("--server-version") + 1] = "28.0.5"
            status, report = self.run_cli(arguments)
            self.assertEqual(status, 2)
            self.assertEqual(report["refusal"], {"code": "qualification_argument_invalid"})

    def test_legacy_save_inspection_stops_on_an_oci_family_without_reusing_source_authority(self):
        fixture = inert_legacy_save_fixture()
        with tempfile.TemporaryDirectory() as directory_name:
            archive = Path(directory_name) / "save.tar"
            archive.write_bytes(archive_bytes([regular("oci-layout", b'{"imageLayoutVersion":"1.0.0"}')], fmt=tarfile.USTAR_FORMAT))
            archive.chmod(0o444)
            status, report = self.run_cli(self.legacy_arguments(archive, fixture))
            self.assertEqual(status, 2)
            self.assertEqual(report["kind"], "INERT_LEGACY_SAVE_V1")
            self.assertEqual(report["refusal"], {"code": "qualification_save_format_unsupported"})


if __name__ == "__main__":
    unittest.main()
