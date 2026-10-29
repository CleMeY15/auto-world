"""Bounded, read-only inspection for the pinned SeaweedFS 4.51 Docker save.

This module deliberately does not extract archives, replay OCI layers, or
interpret whiteouts.  It proves that the exact source configuration and its
ten ordered uncompressed layers are representable by the conservative
export/import profile before any image transformation is attempted.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import posixpath
import re
import stat
import sys
import tarfile
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, BinaryIO, Iterable

try:
    import resource
except ImportError:  # pragma: no cover - the production command is Linux-only.
    resource = None


SCHEMA_VERSION = 1
PROFILE = "go-s3-4.51-v1"
EVIDENCE_CLASS = "SOURCE_LAYER_PREFLIGHT"
SOURCE_CONFIG_SHA256 = "e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6"
SOURCE_DIFF_IDS = (
    "75c137aedfb2760f88629236cb7b797630aed0c3d91d626d1d1bb694878fc2ba",
    "14d28a8561c0323bfa76edd6bca302081ac63d3b0cb7ef45955a69e729ce0f06",
    "5c2a12fbb0348e17e541422ab5639226008d4bfd0a133ea759470dc537cce42f",
    "c9aac12923afabb4e0b0cd4c30c2c96f17aec00a258928880581d8861c59bcf6",
    "18a6be0eab2649832a383d2ae3b92c11209078f4eb919717a5fbf9aabbd351fe",
    "42664d44ed25abf36ba99eb50bd36916c7112c8b028b9ce64c4265664ba233ee",
    "2bb9f79cd65bbdbc3eff10877e1752e8a6013f11e3d529455dd51025583b19a2",
    "8b6ee38e2c0092bcce475079cfd98fac523f6bdb133eeae9bbab154d75d6a4ca",
    "83f90d3184f33a3dc2d8a502016cd4a129354efaaae30ef8e48046e9371ac239",
    "5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef",
)

MAX_ARCHIVE_BYTES = 2 * 1024**3
MAX_LAYER_BYTES = 2 * 1024**3
MAX_LAYER_TOTAL_BYTES = 2 * 1024**3
MAX_OUTER_MEMBERS = 4096
MAX_LAYER_MEMBERS = 4096
MAX_TOTAL_LAYER_MEMBERS = 32768
MAX_METADATA_BYTES = 64 * 1024
MAX_PATH_BYTES = 1024
MAX_JSON_BYTES = 4 * 1024**2
MAX_OUTPUT_BYTES = 4 * 1024**2
MAX_MANIFEST_DIAGNOSTIC_BYTES = 2 * 1024
MAX_ENVELOPE_DIAGNOSTIC_BYTES = 2 * 1024
MAX_AUXILIARY_DIAGNOSTIC_BYTES = 8 * 1024
MAX_AUXILIARY_CANDIDATES = 10
MAX_AUXILIARY_MEMBER_BYTES = 64 * 1024
MAX_AUXILIARY_TOTAL_BYTES = 256 * 1024
CHUNK_BYTES = 1024**2
ZERO_BLOCK_BYTES = 1024
REMOVED_HELPERS = ("usr/bin/weed-volume", "usr/bin/weed-worker")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
CONFIG_MEMBER = re.compile(r"^[0-9a-f]{64}\.json$")
LAYER_MEMBER = re.compile(r"^([0-9a-f]{64})/layer\.tar$")
OCI_BLOB_MEMBER = re.compile(r"^blobs/sha256/[0-9a-f]{64}$")
SAFE_PAX_KEYS = frozenset(("path", "linkpath", "mtime"))
MANIFEST_KNOWN_KEYS = ("Config", "LayerSources", "Layers", "Parent", "RepoTags")
MANIFEST_DIAGNOSTIC_CODES = frozenset(("save_manifest_missing", "save_manifest_invalid"))
MOBY_ENVELOPE_KIND = "MOBY_28_OCI_COMPAT_V1"
AUXILIARY_DIAGNOSTIC_KIND = "MOBY_28_V1_AUXILIARY_DIAGNOSTIC"
OCI_LAYOUT_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json"
OCI_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json"
OCI_CONFIG_MEDIA_TYPE = "application/vnd.oci.image.config.v1+json"
OCI_LAYER_MEDIA_TYPE = "application/vnd.oci.image.layer.v1.tar"
ENVELOPE_KNOWN_KEYS = (
    "annotations",
    "artifactType",
    "config",
    "data",
    "digest",
    "imageLayoutVersion",
    "layers",
    "manifests",
    "mediaType",
    "platform",
    "schemaVersion",
    "size",
    "subject",
    "urls",
)
AUXILIARY_V1_KEYS = frozenset(
    (
        "Size",
        "architecture",
        "author",
        "comment",
        "config",
        "container",
        "container_config",
        "created",
        "docker_version",
        "id",
        "os",
        "parent",
        "variant",
    )
)
AUXILIARY_PROFILE_KEYS = frozenset(
    (
        "candidateBytes",
        "candidateSetSha256",
        "keySetSha256s",
        "orderedSetSha256",
        "payloadBytes",
        "payloadSha256s",
        "v1Ids",
    )
)
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
SOURCE_RUNTIME_CONFIG_KEYS = frozenset(
    (
        "ArgsEscaped",
        "Cmd",
        "Entrypoint",
        "Env",
        "ExposedPorts",
        "Labels",
        "Volumes",
        "WorkingDir",
    )
)
PRODUCTION_AUXILIARY_PROFILE = {
    "candidateBytes": 5913,
    "candidateSetSha256": "3952537ce5e96cc1782f21c9dfc8ac8c000f6451a7cf399e7beeb9eb80b11a5e",
    "payloadSha256s": (
        "ac6cab210f037bd9e93403f75c93cf24e4cb034fd351a830308a69573c2177a0",
        "8ae25a9799456f4fa74752176d9faab3afb2bdaa19acfdb17d1020ca2242158f",
        "5634af422f8e3ffb2d3647da36216ae38a3b8d6d070e742521870545297ba846",
        "aff48665c355f8ef1905af167c09948708bce3d99fcfca95466f1f6aff574f7d",
        "1fb6f212aa6ec2fccdb734a56f9b7c46843618d3307d98679e15f1af959d6311",
        "95add897eca07c411a90add6274ae6e38250297841677c51cae325c66f9c4677",
        "2f1f8cc4f16be9f98bf3ed5088b67b05dff911d3bd152e04ecf2930a131cc671",
        "d1b9f2570b76fa6e4ed6cb92ca50ea807c09996912321352f6418bf6ced6e885",
        "abf7a69412d0d8831e163e12ed345e06ed417b656776e531a422d314722ce3f1",
        "28b6c23df6a546110002ee920ebfe11a3b019b0bb9080aa6e6960656a8b369e1",
    ),
    "payloadBytes": (401, 477, 477, 477, 477, 477, 477, 477, 477, 1696),
    "v1Ids": (
        "84501546d4244ff953d0f1348c4cbff505c52410feca158483ba94e6c4085a0e",
        "828b24ed5596a16ee150bc48f48af87bdb1182768ef5f780fbff5f4c7109778e",
        "710b856cbf9e0085462f9a75dc6b71d87b21ad3c154291d3e9d6c3a31e09d307",
        "af5d9ae122ce509cdcee676d0ac0554cade5de9fc05a8b20904f85fffebdf2e6",
        "18286e36f79d2b840ca20654de566a3cd88cdafe9be1b9d6095e4643323e6117",
        "54602df0e83d51cec83ead4fb080ada8d1cf3605ddd2bb7eb932229931c10b98",
        "5e24ed7cb3eea1a6aa6ce501612dd5ab4f5fa82637f92e7d2a399308b911747d",
        "ee375b6fe435c8bced094e1b2e180eb3c38cf1f64673cff3ef53ca01311a7264",
        "697832d15c49c9996b04c1d18db6864bcc6b99f3a6528e9abb0c11788e43c1e7",
        "051a6f184bde9edb5080b418fcc708c1b91006a45bd19c1931f9018528cdacd0",
    ),
    "keySetSha256s": (
        "0dfed3ba79fca2b9270e3c8a089c6995dd5e28eff2e16ff24e3796cf0485c891",
        "fc28534d3d367c3b801ded20d351852b7b2a5ad4ed0c97ca2a0a745c81e5c04a",
        "fc28534d3d367c3b801ded20d351852b7b2a5ad4ed0c97ca2a0a745c81e5c04a",
        "fc28534d3d367c3b801ded20d351852b7b2a5ad4ed0c97ca2a0a745c81e5c04a",
        "fc28534d3d367c3b801ded20d351852b7b2a5ad4ed0c97ca2a0a745c81e5c04a",
        "fc28534d3d367c3b801ded20d351852b7b2a5ad4ed0c97ca2a0a745c81e5c04a",
        "fc28534d3d367c3b801ded20d351852b7b2a5ad4ed0c97ca2a0a745c81e5c04a",
        "fc28534d3d367c3b801ded20d351852b7b2a5ad4ed0c97ca2a0a745c81e5c04a",
        "fc28534d3d367c3b801ded20d351852b7b2a5ad4ed0c97ca2a0a745c81e5c04a",
        "1311ab9e6d5be812a4c48c74cbe8a4f36c69b63e57bc1adf3269199d580c097b",
    ),
    "orderedSetSha256": "4ef427670dac48137a29c82eb56b679a0c42f662013b5834209a9fe96306f39a",
}

QUALIFICATION_EVIDENCE_CLASS = "INERT_CONSTRUCTION_QUALIFICATION"
QUALIFICATION_MAX_BYTES = 8 * 1024**2
QUALIFICATION_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
QUALIFICATION_SERVER_VERSION = "28.0.4"
QUALIFICATION_CREATED = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$"
)
QUALIFICATION_SENTINEL = b"volume-underlay-sentinel-v1\n"
QUALIFICATION_FIXTURE = (
    {"path": "etc", "type": "directory", "mode": 0o750, "uid": 101, "gid": 202, "mtime": 1700000100},
    {"path": "etc/fixture.conf", "type": "file", "mode": 0o640, "uid": 101, "gid": 202, "mtime": 1700000101, "payload": b"auto-world-inert-fixture-v1\n"},
    {"path": "opt", "type": "directory", "mode": 0o755, "uid": 0, "gid": 0, "mtime": 1700000102},
    {"path": "opt/auto-world", "type": "directory", "mode": 0o750, "uid": 123, "gid": 456, "mtime": 1700000103},
    {"path": "opt/auto-world/marker.txt", "type": "file", "mode": 0o444, "uid": 123, "gid": 456, "mtime": 1700000104, "payload": b"preserve-this-marker\n"},
    {"path": "var", "type": "directory", "mode": 0o755, "uid": 0, "gid": 0, "mtime": 1700000105},
    {"path": "var/lib", "type": "directory", "mode": 0o755, "uid": 0, "gid": 0, "mtime": 1700000106},
    {"path": "var/lib/seaweed", "type": "directory", "mode": 0o750, "uid": 1001, "gid": 1002, "mtime": 1700000107},
    {"path": "var/lib/seaweed/state.bin", "type": "file", "mode": 0o600, "uid": 1001, "gid": 1002, "mtime": 1700000108, "payload": bytes.fromhex("006175746f2d776f726c64ff7365617765656410")},
    {"path": "usr", "type": "directory", "mode": 0o755, "uid": 0, "gid": 0, "mtime": 1700000109},
    {"path": "usr/bin", "type": "directory", "mode": 0o755, "uid": 0, "gid": 0, "mtime": 1700000110},
    {"path": "usr/bin/weed-volume", "type": "file", "mode": 0o640, "uid": 1001, "gid": 1002, "mtime": 1700000111, "payload": b"AUTO WORLD INERT DATA ONLY: weed-volume\n"},
    {"path": "usr/bin/weed-worker", "type": "file", "mode": 0o640, "uid": 1001, "gid": 1002, "mtime": 1700000112, "payload": b"AUTO WORLD INERT DATA ONLY: weed-worker\n"},
    {"path": "data", "type": "directory", "mode": 0o700, "uid": 1001, "gid": 1002, "mtime": 1700000113},
    {"path": "data/sentinel.txt", "type": "file", "mode": 0o440, "uid": 1001, "gid": 1002, "mtime": 1700000114, "payload": QUALIFICATION_SENTINEL},
    {"path": "marker-link", "type": "symlink", "mode": 0o777, "uid": 123, "gid": 456, "mtime": 1700000115, "linkname": "opt/auto-world/marker.txt"},
)


class InspectionRefusal(Exception):
    """A finite, expected refusal that is safe to serialize."""

    def __init__(
        self,
        code: str,
        *,
        layer_ordinal: int | None = None,
        member: str | None = None,
        member_is_safe: bool = False,
        manifest_diagnostic: dict[str, Any] | None = None,
        envelope_diagnostic: dict[str, Any] | None = None,
        auxiliary_diagnostic: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.layer_ordinal = layer_ordinal
        self.member = member
        self.member_is_safe = member_is_safe
        self.manifest_diagnostic = manifest_diagnostic
        self.envelope_diagnostic = envelope_diagnostic
        self.auxiliary_diagnostic = auxiliary_diagnostic


class InspectionIntegrityError(Exception):
    """A global input-integrity failure that can never qualify as a refusal."""

    def __init__(self, code: str = "source_changed") -> None:
        super().__init__(code)
        self.code = code


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        raise InspectionRefusal("arguments_invalid")


def _require(
    condition: bool,
    code: str,
    *,
    layer_ordinal: int | None = None,
    member: str | None = None,
    member_is_safe: bool = False,
) -> None:
    if not condition:
        raise InspectionRefusal(
            code,
            layer_ordinal=layer_ordinal,
            member=member,
            member_is_safe=member_is_safe,
        )


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    return hashlib.sha256(encoded).hexdigest()


def _json_no_duplicates(
    raw: bytes, code: str, *, reject_constants: bool = False
) -> Any:
    _require(len(raw) <= MAX_JSON_BYTES, "json_limit")

    def pairs(values: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in values:
            _require(isinstance(key, str) and key not in result, code)
            result[key] = value
        return result

    def constant(_value: str) -> None:
        raise InspectionRefusal(code)

    try:
        constant_option = {"parse_constant": constant} if reject_constants else {}
        return json.loads(
            raw.decode("utf-8", "strict"),
            object_pairs_hook=pairs,
            **constant_option,
        )
    except InspectionRefusal:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise InspectionRefusal(code) from None
    except ValueError:
        if reject_constants:
            raise InspectionRefusal(code) from None
        raise


def _json_type_tag(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, (int, float)):
        return "number"
    raise TypeError("value is not a JSON type")


def _manifest_path_category(value: Any, *, layer: bool = False) -> str:
    if isinstance(value, str):
        if layer and LAYER_MEMBER.fullmatch(value) is not None:
            return "legacy-layer"
        if not layer and CONFIG_MEMBER.fullmatch(value) is not None:
            return "legacy-config"
        if OCI_BLOB_MEMBER.fullmatch(value) is not None:
            return "oci-blob"
    return "other"


def _manifest_diagnostic(
    by_name: dict[str, tuple[dict[str, Any], tarfile.TarInfo]],
    *,
    json_state: str = "not-observed",
    manifest: Any = None,
) -> dict[str, Any]:
    manifest_entry = by_name.get("manifest.json")
    manifest_record = manifest_entry[0] if manifest_entry is not None else None
    is_file = manifest_record is not None and manifest_record["type"] == "file"
    observed_manifest = manifest if json_state == "valid" else None
    has_first_record = isinstance(observed_manifest, list) and bool(observed_manifest)
    first_record = (
        observed_manifest[0]
        if has_first_record
        else None
    )
    first_object = first_record if isinstance(first_record, dict) else None

    known_keys_present: list[str] = []
    known_value_types: dict[str, str | None] = {
        key: None for key in MANIFEST_KNOWN_KEYS
    }
    unknown_key_count: int | None = None
    unknown_key_names_sha256: str | None = None
    config_path_category: str | None = None
    layers_count: int | None = None
    layer_path_counts: dict[str, int] | None = None
    repo_tags_type: str | None = None
    repo_tags_count: int | None = None
    parent_type: str | None = None
    layer_sources_type: str | None = None
    layer_sources_count: int | None = None

    if first_object is not None:
        known_keys_present = sorted(set(first_object).intersection(MANIFEST_KNOWN_KEYS))
        for key in known_keys_present:
            known_value_types[key] = _json_type_tag(first_object[key])
        unknown_names = sorted(set(first_object).difference(MANIFEST_KNOWN_KEYS))
        unknown_key_count = len(unknown_names)
        unknown_key_names_sha256 = hashlib.sha256(
            json.dumps(
                unknown_names, ensure_ascii=True, separators=(",", ":")
            ).encode("utf-8")
        ).hexdigest()

        config_path_category = (
            _manifest_path_category(first_object["Config"])
            if "Config" in first_object
            else "absent"
        )
        layers = first_object.get("Layers")
        if isinstance(layers, list):
            layers_count = len(layers)
            layer_path_counts = {"legacyLayer": 0, "ociBlob": 0, "other": 0}
            category_keys = {
                "legacy-layer": "legacyLayer",
                "oci-blob": "ociBlob",
                "other": "other",
            }
            for value in layers:
                category = _manifest_path_category(value, layer=True)
                layer_path_counts[category_keys[category]] += 1

        if "RepoTags" in first_object:
            repo_tags = first_object["RepoTags"]
            repo_tags_type = _json_type_tag(repo_tags)
            if isinstance(repo_tags, list):
                repo_tags_count = len(repo_tags)
        if "Parent" in first_object:
            parent_type = _json_type_tag(first_object["Parent"])
        if "LayerSources" in first_object:
            layer_sources = first_object["LayerSources"]
            layer_sources_type = _json_type_tag(layer_sources)
            if isinstance(layer_sources, (list, dict)):
                layer_sources_count = len(layer_sources)

    diagnostic = {
        "schemaVersion": SCHEMA_VERSION,
        "outer": {
            "ociLayoutPresent": "oci-layout" in by_name,
            "indexJsonPresent": "index.json" in by_name,
            "repositoriesPresent": "repositories" in by_name,
            "blobsPrefixPresent": any(name.startswith("blobs/") for name in by_name),
        },
        "manifest": {
            "present": manifest_record is not None,
            "memberType": manifest_record["type"] if manifest_record is not None else None,
            "byteCount": manifest_record["size"] if is_file else None,
            "sha256": manifest_record["payloadSha256"] if is_file else None,
            "jsonState": json_state,
            "rootType": _json_type_tag(observed_manifest) if json_state == "valid" else None,
            "recordCount": len(observed_manifest) if isinstance(observed_manifest, list) else None,
            "firstRecordType": _json_type_tag(first_record) if has_first_record else None,
            "knownKeysPresent": known_keys_present,
            "knownValueTypes": known_value_types,
            "unknownKeyCount": unknown_key_count,
            "unknownKeyNamesSha256": unknown_key_names_sha256,
            "configPathCategory": config_path_category,
            "layersCount": layers_count,
            "layerPathCounts": layer_path_counts,
            "repoTagsType": repo_tags_type,
            "repoTagsCount": repo_tags_count,
            "parentType": parent_type,
            "layerSourcesType": layer_sources_type,
            "layerSourcesCount": layer_sources_count,
        },
    }
    encoded = json.dumps(
        diagnostic, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    if len(encoded) > MAX_MANIFEST_DIAGNOSTIC_BYTES:
        raise InspectionRefusal("internal_error")
    return diagnostic


def _raise_manifest_refusal(
    code: str, diagnostic: dict[str, Any]
) -> None:
    raise InspectionRefusal(code, manifest_diagnostic=diagnostic)


def _diagnostic_digest(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    if HEX64.fullmatch(value) is not None:
        return value
    if value.startswith("sha256:") and HEX64.fullmatch(value[7:]) is not None:
        return value[7:]
    return None


def _diagnostic_bytes(value: Any) -> int | None:
    if (
        isinstance(value, int)
        and not isinstance(value, bool)
        and 0 <= value <= MAX_ARCHIVE_BYTES
    ):
        return value
    return None


def _media_type_observation(value: Any) -> tuple[str | None, str | None]:
    if not isinstance(value, str):
        return None, None
    classes = {
        OCI_LAYOUT_MEDIA_TYPE: "oci-index",
        OCI_MANIFEST_MEDIA_TYPE: "oci-manifest",
        OCI_CONFIG_MEDIA_TYPE: "oci-config",
        OCI_LAYER_MEDIA_TYPE: "oci-tar",
    }
    media_class = classes.get(value, "other")
    try:
        encoded = value.encode("utf-8", "strict")
    except UnicodeEncodeError:
        return media_class, None
    return media_class, hashlib.sha256(encoded).hexdigest()


def _envelope_diagnostic(
    *,
    node: str,
    predicate: str,
    ordinal: int | None = None,
    observed: Any = None,
    observed_available: bool = False,
    member_type: str | None = None,
    expected_digest: Any = None,
    actual_digest: Any = None,
    expected_bytes: Any = None,
    actual_bytes: Any = None,
    media_type: Any = None,
) -> dict[str, Any]:
    known_keys_present: list[str] = []
    unknown_key_count: int | None = None
    unknown_key_names_sha256: str | None = None
    if observed_available and isinstance(observed, dict):
        known_keys_present = sorted(set(observed).intersection(ENVELOPE_KNOWN_KEYS))
        unknown_names = sorted(set(observed).difference(ENVELOPE_KNOWN_KEYS))
        unknown_key_count = len(unknown_names)
        unknown_key_names_sha256 = hashlib.sha256(
            json.dumps(
                unknown_names, ensure_ascii=True, separators=(",", ":")
            ).encode("utf-8")
        ).hexdigest()
    media_type_class, media_type_sha256 = _media_type_observation(media_type)
    diagnostic = {
        "schemaVersion": SCHEMA_VERSION,
        "format": MOBY_ENVELOPE_KIND,
        "node": node,
        "predicate": predicate,
        "ordinal": ordinal if isinstance(ordinal, int) and 1 <= ordinal <= 10 else None,
        "observedType": _json_type_tag(observed) if observed_available else None,
        "memberType": member_type if member_type in {"file", "directory", "symlink"} else None,
        "expectedDigest": _diagnostic_digest(expected_digest),
        "actualDigest": _diagnostic_digest(actual_digest),
        "expectedBytes": _diagnostic_bytes(expected_bytes),
        "actualBytes": _diagnostic_bytes(actual_bytes),
        "knownKeysPresent": known_keys_present,
        "unknownKeyCount": unknown_key_count,
        "unknownKeyNamesSha256": unknown_key_names_sha256,
        "mediaTypeClass": media_type_class,
        "mediaTypeSha256": media_type_sha256,
    }
    encoded = json.dumps(
        diagnostic, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    if len(encoded) > MAX_ENVELOPE_DIAGNOSTIC_BYTES:
        raise InspectionRefusal("internal_error")
    return diagnostic


def _raise_envelope_refusal(
    *,
    auxiliary_diagnostic: dict[str, Any] | None = None,
    **diagnostic_values: Any,
) -> None:
    raise InspectionRefusal(
        "save_envelope_invalid",
        envelope_diagnostic=_envelope_diagnostic(**diagnostic_values),
        auxiliary_diagnostic=auxiliary_diagnostic,
    )


def _require_envelope(
    condition: bool, *, node: str, predicate: str, **diagnostic_values: Any
) -> None:
    if not condition:
        _raise_envelope_refusal(
            node=node, predicate=predicate, **diagnostic_values
        )


def _envelope_member(
    by_name: dict[str, tuple[dict[str, Any], tarfile.TarInfo]],
    path: str,
    *,
    node: str,
    ordinal: int | None = None,
    expected_digest: str | None = None,
    expected_bytes: int | None = None,
    json_member: bool = False,
) -> tuple[dict[str, Any], tarfile.TarInfo]:
    entry = by_name.get(path)
    _require_envelope(
        entry is not None,
        node=node,
        predicate="member",
        ordinal=ordinal,
        expected_digest=expected_digest,
        expected_bytes=expected_bytes,
    )
    record, info = entry
    _require_envelope(
        record["type"] == "file",
        node=node,
        predicate="member",
        ordinal=ordinal,
        member_type=record["type"],
        expected_digest=expected_digest,
        actual_digest=record["payloadSha256"],
        expected_bytes=expected_bytes,
        actual_bytes=record["size"],
    )
    _require_envelope(
        not json_member or record["size"] <= MAX_JSON_BYTES,
        node=node,
        predicate="size",
        ordinal=ordinal,
        member_type="file",
        expected_digest=expected_digest,
        actual_digest=record["payloadSha256"],
        expected_bytes=expected_bytes,
        actual_bytes=record["size"],
    )
    if expected_digest is not None:
        _require_envelope(
            record["payloadSha256"] == expected_digest,
            node=node,
            predicate="digest",
            ordinal=ordinal,
            member_type="file",
            expected_digest=expected_digest,
            actual_digest=record["payloadSha256"],
            expected_bytes=expected_bytes,
            actual_bytes=record["size"],
        )
    if expected_bytes is not None:
        _require_envelope(
            record["size"] == expected_bytes,
            node=node,
            predicate="size",
            ordinal=ordinal,
            member_type="file",
            expected_digest=expected_digest,
            actual_digest=record["payloadSha256"],
            expected_bytes=expected_bytes,
            actual_bytes=record["size"],
        )
    return record, info


def _envelope_json(
    archive: tarfile.TarFile,
    by_name: dict[str, tuple[dict[str, Any], tarfile.TarInfo]],
    path: str,
    *,
    node: str,
    expected_digest: str | None = None,
    expected_bytes: int | None = None,
) -> tuple[Any, dict[str, Any]]:
    record, info = _envelope_member(
        by_name,
        path,
        node=node,
        expected_digest=expected_digest,
        expected_bytes=expected_bytes,
        json_member=True,
    )
    raw = _read_member(archive, info, MAX_JSON_BYTES)
    try:
        value = _json_no_duplicates(
            raw, "save_envelope_invalid", reject_constants=True
        )
    except InspectionRefusal as refusal:
        if refusal.code == "save_envelope_invalid":
            _raise_envelope_refusal(
                node=node,
                predicate="json",
                member_type="file",
                expected_digest=expected_digest,
                actual_digest=record["payloadSha256"],
                expected_bytes=expected_bytes,
                actual_bytes=record["size"],
            )
        raise
    return value, record


def _validate_descriptor(
    value: Any,
    *,
    node: str,
    expected_media_type: str,
    expected_digest: str | None = None,
    expected_bytes: int | None = None,
    ordinal: int | None = None,
) -> tuple[str, int]:
    _require_envelope(
        isinstance(value, dict),
        node=node,
        predicate="type",
        ordinal=ordinal,
        observed=value,
        observed_available=True,
    )
    _require_envelope(
        set(value) == {"mediaType", "digest", "size"},
        node=node,
        predicate="keys",
        ordinal=ordinal,
        observed=value,
        observed_available=True,
        media_type=value.get("mediaType"),
    )
    media_type = value["mediaType"]
    _require_envelope(
        media_type == expected_media_type,
        node=node,
        predicate="media-type",
        ordinal=ordinal,
        observed=value,
        observed_available=True,
        media_type=media_type,
    )
    digest = value["digest"]
    digest_hex = _diagnostic_digest(digest)
    _require_envelope(
        isinstance(digest, str)
        and digest.startswith("sha256:")
        and digest_hex is not None,
        node=node,
        predicate="digest",
        ordinal=ordinal,
        observed=value,
        observed_available=True,
        expected_digest=expected_digest,
        actual_digest=digest,
        media_type=media_type,
    )
    if expected_digest is not None:
        _require_envelope(
            digest_hex == expected_digest,
            node=node,
            predicate="digest",
            ordinal=ordinal,
            observed=value,
            observed_available=True,
            expected_digest=expected_digest,
            actual_digest=digest,
            media_type=media_type,
        )
    size = value["size"]
    _require_envelope(
        isinstance(size, int)
        and not isinstance(size, bool)
        and 0 < size <= MAX_ARCHIVE_BYTES,
        node=node,
        predicate="size",
        ordinal=ordinal,
        observed=value,
        observed_available=True,
        expected_digest=expected_digest,
        actual_digest=digest,
        expected_bytes=expected_bytes,
        actual_bytes=size,
        media_type=media_type,
    )
    if expected_bytes is not None:
        _require_envelope(
            size == expected_bytes,
            node=node,
            predicate="size",
            ordinal=ordinal,
            observed=value,
            observed_available=True,
            expected_digest=expected_digest,
            actual_digest=digest,
            expected_bytes=expected_bytes,
            actual_bytes=size,
            media_type=media_type,
        )
    return digest_hex, size


def _build_auxiliary_diagnostic(
    candidates: list[tuple[dict[str, Any], tarfile.TarInfo]],
    *,
    classification: str,
    first_mismatch: str | None,
    examined_count: int,
    parent_chain_matched: bool | None,
    ordered_nodes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    ordered_inventory = [
        {
            "path": record["path"],
            "type": record["type"],
            "size": record["size"],
            "payloadSha256": record["payloadSha256"],
        }
        for record, _info in sorted(candidates, key=lambda entry: entry[0]["path"])
    ]
    payload_sha256s: list[str] = []
    payload_bytes: list[int] = []
    v1_ids: list[str] = []
    key_set_sha256s: list[str] = []
    ordered_set_sha256: str | None = None
    if ordered_nodes is not None:
        payload_sha256s = [node["payloadSha256"] for node in ordered_nodes]
        payload_bytes = [node["bytes"] for node in ordered_nodes]
        v1_ids = [node["id"] for node in ordered_nodes]
        key_set_sha256s = [node["keySetSha256"] for node in ordered_nodes]
        ordered_set_sha256 = _canonical_sha256(
            [
                {
                    "payloadSha256": node["payloadSha256"],
                    "bytes": node["bytes"],
                    "id": node["id"],
                    "parent": node["parent"],
                    "keySetSha256": node["keySetSha256"],
                }
                for node in ordered_nodes
            ]
        )
    diagnostic = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": AUXILIARY_DIAGNOSTIC_KIND,
        "createIdBinding": "NOT_RECOMPUTED",
        "candidateCount": len(candidates),
        "candidateBytes": sum(
            record["size"] for record, _info in candidates if record["type"] == "file"
        ),
        "candidateSetSha256": _canonical_sha256(ordered_inventory),
        "truncated": len(candidates) > MAX_AUXILIARY_CANDIDATES,
        "examinedCount": examined_count,
        "classification": classification,
        "firstMismatch": first_mismatch,
        "payloadSha256s": payload_sha256s,
        "payloadBytes": payload_bytes,
        "v1Ids": v1_ids,
        "keySetSha256s": key_set_sha256s,
        "parentChainMatched": parent_chain_matched,
        "orderedSetSha256": ordered_set_sha256,
    }
    encoded = json.dumps(
        diagnostic, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("ascii")
    if len(encoded) > MAX_AUXILIARY_DIAGNOSTIC_BYTES:
        raise InspectionRefusal("internal_error")
    return diagnostic


def _normalize_auxiliary_profile(profile: Any) -> dict[str, Any]:
    _require(
        isinstance(profile, dict) and set(profile) == AUXILIARY_PROFILE_KEYS,
        "expected_profile_invalid",
    )
    candidate_bytes = profile["candidateBytes"]
    candidate_set_sha256 = profile["candidateSetSha256"]
    ordered_set_sha256 = profile["orderedSetSha256"]
    _require(
        isinstance(candidate_bytes, int)
        and not isinstance(candidate_bytes, bool)
        and 1 <= candidate_bytes <= MAX_AUXILIARY_TOTAL_BYTES,
        "expected_profile_invalid",
    )
    _require(
        isinstance(candidate_set_sha256, str)
        and HEX64.fullmatch(candidate_set_sha256) is not None
        and isinstance(ordered_set_sha256, str)
        and HEX64.fullmatch(ordered_set_sha256) is not None,
        "expected_profile_invalid",
    )

    normalized: dict[str, Any] = {
        "candidateBytes": candidate_bytes,
        "candidateSetSha256": candidate_set_sha256,
        "orderedSetSha256": ordered_set_sha256,
    }
    for key in ("payloadSha256s", "v1Ids", "keySetSha256s"):
        values = profile[key]
        _require(
            isinstance(values, (list, tuple))
            and len(values) == MAX_AUXILIARY_CANDIDATES
            and all(
                isinstance(value, str) and HEX64.fullmatch(value) is not None
                for value in values
            ),
            "expected_profile_invalid",
        )
        normalized[key] = tuple(values)
    payload_bytes = profile["payloadBytes"]
    _require(
        isinstance(payload_bytes, (list, tuple))
        and len(payload_bytes) == MAX_AUXILIARY_CANDIDATES
        and all(
            isinstance(value, int)
            and not isinstance(value, bool)
            and 1 <= value <= MAX_AUXILIARY_MEMBER_BYTES
            for value in payload_bytes
        )
        and sum(payload_bytes) == candidate_bytes,
        "expected_profile_invalid",
    )
    normalized["payloadBytes"] = tuple(payload_bytes)

    return normalized


def _classify_auxiliary_candidates(
    archive: tarfile.TarFile,
    candidates: list[tuple[dict[str, Any], tarfile.TarInfo]],
    config_raw: bytes,
) -> tuple[dict[str, Any], list[dict[str, Any]] | None]:
    count = len(candidates)
    if count > MAX_AUXILIARY_CANDIDATES:
        return (
            _build_auxiliary_diagnostic(
                candidates,
                classification="LIMIT_EXCEEDED",
                first_mismatch="candidate-limit",
                examined_count=0,
                parent_chain_matched=None,
            ),
            None,
        )
    if count != MAX_AUXILIARY_CANDIDATES:
        return (
            _build_auxiliary_diagnostic(
                candidates,
                classification="REFUSED",
                first_mismatch="cardinality",
                examined_count=0,
                parent_chain_matched=None,
            ),
            None,
        )

    ordered_candidates = sorted(candidates, key=lambda entry: entry[0]["path"])

    def refused(
        mismatch: str,
        *,
        examined_count: int = 0,
        parent_chain_matched: bool | None = None,
    ) -> tuple[dict[str, Any], None]:
        return (
            _build_auxiliary_diagnostic(
                candidates,
                classification="REFUSED",
                first_mismatch=mismatch,
                examined_count=examined_count,
                parent_chain_matched=parent_chain_matched,
            ),
            None,
        )

    for record, _info in ordered_candidates:
        if record["type"] != "file":
            return refused("member")
        if OCI_BLOB_MEMBER.fullmatch(record["path"]) is None:
            return refused("path")
        if record["path"].rsplit("/", 1)[1] != record["payloadSha256"]:
            return refused("digest")
        if not 1 <= record["size"] <= MAX_AUXILIARY_MEMBER_BYTES:
            return refused("size")
    if sum(record["size"] for record, _info in ordered_candidates) > MAX_AUXILIARY_TOTAL_BYTES:
        return refused("total-size")

    source_config = _json_no_duplicates(config_raw, "source_config_invalid")
    source_os = source_config.get("os") if isinstance(source_config, dict) else None
    examined_count = 0
    nodes: list[dict[str, Any]] = []
    required_keys = {"id", "created", "container_config", "os"}
    for record, info in ordered_candidates:
        examined_count += 1
        raw = _read_member(archive, info, MAX_AUXILIARY_MEMBER_BYTES)
        try:
            value = _json_no_duplicates(
                raw, "save_envelope_invalid", reject_constants=True
            )
        except InspectionRefusal as refusal:
            if refusal.code == "save_envelope_invalid":
                return refused("json", examined_count=examined_count)
            raise
        if not isinstance(value, dict):
            return refused("root-type", examined_count=examined_count)
        if not set(value).issubset(AUXILIARY_V1_KEYS):
            return refused("keys", examined_count=examined_count)
        required_values_match = (
            (value.get("created") is None or isinstance(value.get("created"), str))
            and isinstance(value.get("container_config"), dict)
            and isinstance(source_os, str)
            and value.get("os") == source_os
        )
        if not required_keys.issubset(value) or not required_values_match:
            return refused("required-fields", examined_count=examined_count)
        node_id = value["id"]
        if not isinstance(node_id, str) or HEX64.fullmatch(node_id) is None:
            return refused("id", examined_count=examined_count)
        if "parent" in value:
            parent = value["parent"]
            if not isinstance(parent, str) or HEX64.fullmatch(parent) is None:
                return refused("parent", examined_count=examined_count)
        else:
            parent = None
        nodes.append(
            {
                "payloadSha256": record["payloadSha256"],
                "bytes": record["size"],
                "id": node_id,
                "parent": parent,
                "keySetSha256": _canonical_sha256(sorted(value)),
                "value": value,
            }
        )

    ids = [node["id"] for node in nodes]
    id_set = set(ids)
    if len(id_set) != len(ids):
        return refused("duplicate-id", examined_count=examined_count)
    roots = [node for node in nodes if node["parent"] is None]
    if len(roots) != 1:
        return refused(
            "root-count",
            examined_count=examined_count,
            parent_chain_matched=False,
        )
    if any(
        node["parent"] is not None and node["parent"] not in id_set
        for node in nodes
    ):
        return refused(
            "orphan",
            examined_count=examined_count,
            parent_chain_matched=False,
        )
    children: dict[str, list[dict[str, Any]]] = {}
    for node in nodes:
        if node["parent"] is not None:
            children.setdefault(node["parent"], []).append(node)
    if any(len(values) > 1 for values in children.values()):
        return refused(
            "branch",
            examined_count=examined_count,
            parent_chain_matched=False,
        )
    nodes_by_id = {node["id"]: node for node in nodes}
    for node in nodes:
        seen: set[str] = set()
        current: dict[str, Any] | None = node
        while current is not None:
            current_id = current["id"]
            if current_id in seen:
                return refused(
                    "cycle",
                    examined_count=examined_count,
                    parent_chain_matched=False,
                )
            seen.add(current_id)
            parent_id = current["parent"]
            current = nodes_by_id[parent_id] if parent_id is not None else None

    ordered_nodes = [roots[0]]
    while ordered_nodes[-1]["id"] in children:
        ordered_nodes.append(children[ordered_nodes[-1]["id"]][0])
    return (
        _build_auxiliary_diagnostic(
            candidates,
            classification="COMPATIBLE_UNVERIFIED",
            first_mismatch=None,
            examined_count=examined_count,
            parent_chain_matched=True,
            ordered_nodes=ordered_nodes,
        ),
        ordered_nodes,
    )


def _validate_fixed_auxiliary(
    diagnostic: dict[str, Any],
    ordered_nodes: list[dict[str, Any]],
    profile: dict[str, Any],
    config_raw: bytes,
) -> dict[str, Any]:
    for ordinal, node in enumerate(ordered_nodes, start=1):
        index = ordinal - 1
        _require_envelope(
            node["payloadSha256"] == profile["payloadSha256s"][index],
            node="auxiliary",
            predicate="digest",
            ordinal=ordinal,
            expected_digest=profile["payloadSha256s"][index],
            actual_digest=node["payloadSha256"],
        )
        _require_envelope(
            node["bytes"] == profile["payloadBytes"][index],
            node="auxiliary",
            predicate="size",
            ordinal=ordinal,
            expected_bytes=profile["payloadBytes"][index],
            actual_bytes=node["bytes"],
        )
        _require_envelope(
            node["id"] == profile["v1Ids"][index],
            node="auxiliary",
            predicate="ordinal",
            ordinal=ordinal,
            expected_digest=profile["v1Ids"][index],
            actual_digest=node["id"],
        )
        _require_envelope(
            node["keySetSha256"] == profile["keySetSha256s"][index],
            node="auxiliary",
            predicate="keys",
            ordinal=ordinal,
            expected_digest=profile["keySetSha256s"][index],
            actual_digest=node["keySetSha256"],
        )
    _require_envelope(
        diagnostic["candidateSetSha256"] == profile["candidateSetSha256"],
        node="auxiliary",
        predicate="digest",
        expected_digest=profile["candidateSetSha256"],
        actual_digest=diagnostic["candidateSetSha256"],
        expected_bytes=profile["candidateBytes"],
        actual_bytes=diagnostic["candidateBytes"],
    )
    _require_envelope(
        diagnostic["orderedSetSha256"] == profile["orderedSetSha256"],
        node="auxiliary",
        predicate="ordinal",
        expected_digest=profile["orderedSetSha256"],
        actual_digest=diagnostic["orderedSetSha256"],
    )

    try:
        source_config = _json_no_duplicates(
            config_raw, "save_envelope_invalid", reject_constants=True
        )
    except InspectionRefusal as refusal:
        if refusal.code == "save_envelope_invalid":
            _raise_envelope_refusal(node="auxiliary", predicate="type")
        raise
    _require_envelope(
        isinstance(source_config, dict),
        node="auxiliary",
        predicate="type",
        observed=source_config,
        observed_available=True,
    )
    source_headers = {"created", "architecture", "os", "config"}
    _require_envelope(
        source_headers.issubset(source_config),
        node="auxiliary",
        predicate="keys",
        expected_digest=_canonical_sha256(sorted(source_headers)),
        actual_digest=_canonical_sha256(
            sorted(source_headers.intersection(source_config))
        ),
    )
    runtime_config = source_config["config"]
    _require_envelope(
        isinstance(source_config["created"], str)
        and source_config["architecture"] == "amd64"
        and source_config["os"] == "linux"
        and isinstance(runtime_config, dict),
        node="auxiliary",
        predicate="type",
        expected_digest=_canonical_sha256(
            {"created": "string", "architecture": "amd64", "os": "linux", "config": "object"}
        ),
        actual_digest=_canonical_sha256(
            {
                "created": _json_type_tag(source_config["created"]),
                "architecture": source_config["architecture"],
                "os": source_config["os"],
                "config": _json_type_tag(runtime_config),
            }
        ),
    )
    _require_envelope(
        set(runtime_config) == SOURCE_RUNTIME_CONFIG_KEYS,
        node="auxiliary",
        predicate="keys",
        expected_digest=_canonical_sha256(sorted(SOURCE_RUNTIME_CONFIG_KEYS)),
        actual_digest=_canonical_sha256(sorted(runtime_config)),
    )
    _require_envelope(
        runtime_config["ArgsEscaped"] is True,
        node="auxiliary",
        predicate="type",
        expected_digest=_canonical_sha256(True),
        actual_digest=_canonical_sha256(runtime_config["ArgsEscaped"]),
    )

    final_runtime_config = dict(ZERO_CONTAINER_CONFIG)
    final_runtime_config.update(runtime_config)
    expected_values: list[dict[str, Any]] = []
    for ordinal in range(1, MAX_AUXILIARY_CANDIDATES + 1):
        expected: dict[str, Any] = {
            "id": profile["v1Ids"][ordinal - 1],
            "created": "1970-01-01T00:00:00Z",
            "container_config": ZERO_CONTAINER_CONFIG,
            "os": "linux",
        }
        if ordinal > 1:
            expected["parent"] = profile["v1Ids"][ordinal - 2]
        if ordinal == MAX_AUXILIARY_CANDIDATES:
            expected["created"] = source_config["created"]
            expected["config"] = final_runtime_config
            expected["architecture"] = "amd64"
        expected_values.append(expected)

    for ordinal, (node, expected) in enumerate(
        zip(ordered_nodes, expected_values, strict=True), start=1
    ):
        actual = node["value"]
        expected_hash = _canonical_sha256(expected)
        actual_hash = _canonical_sha256(actual)
        _require_envelope(
            set(actual) == set(expected),
            node="auxiliary",
            predicate="keys",
            ordinal=ordinal,
            expected_digest=expected_hash,
            actual_digest=actual_hash,
        )
        _require_envelope(
            actual_hash == expected_hash,
            node="auxiliary",
            predicate="type",
            ordinal=ordinal,
            expected_digest=expected_hash,
            actual_digest=actual_hash,
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "MOBY_28_V1_AUXILIARY_FIXED_SOURCE_V1",
        "createIdBinding": "NOT_RECOMPUTED",
        "auxiliaryToRawLayerBinding": "NOT_INDEPENDENTLY_VERIFIED",
        "candidateCount": MAX_AUXILIARY_CANDIDATES,
        "candidateBytes": profile["candidateBytes"],
        "candidateSetSha256": profile["candidateSetSha256"],
        "payloadSha256s": list(profile["payloadSha256s"]),
        "payloadBytes": list(profile["payloadBytes"]),
        "v1Ids": list(profile["v1Ids"]),
        "keySetSha256s": list(profile["keySetSha256s"]),
        "orderedSetSha256": profile["orderedSetSha256"],
        "semanticProjectionMatched": True,
    }


def _hash_stream(stream: BinaryIO, expected_size: int) -> str:
    digest = hashlib.sha256()
    remaining = expected_size
    while remaining:
        value = stream.read(min(CHUNK_BYTES, remaining))
        _require(bool(value), "archive_truncated")
        digest.update(value)
        remaining -= len(value)
    _require(not stream.read(1), "archive_size_mismatch")
    return digest.hexdigest()


def _read_stream(stream: BinaryIO, expected_size: int, limit: int) -> bytes:
    _require(0 <= expected_size <= limit, "member_size_limit")
    chunks: list[bytes] = []
    remaining = expected_size
    while remaining:
        value = stream.read(min(CHUNK_BYTES, remaining))
        _require(bool(value), "archive_truncated")
        chunks.append(value)
        remaining -= len(value)
    _require(not stream.read(1), "archive_size_mismatch")
    return b"".join(chunks)


def _read_at(stream: BinaryIO, offset: int, size: int) -> bytes:
    _require(offset >= 0 and size >= 0, "archive_invalid")
    try:
        previous = stream.tell()
        stream.seek(offset)
        value = stream.read(size)
        stream.seek(previous)
    except (AttributeError, OSError, ValueError):
        raise InspectionRefusal("archive_seek_unsupported") from None
    _require(len(value) == size, "archive_truncated")
    return value


def _hash_at(stream: BinaryIO, offset: int, size: int) -> str:
    digest = hashlib.sha256()
    remaining = size
    cursor = offset
    while remaining:
        value = _read_at(stream, cursor, min(CHUNK_BYTES, remaining))
        digest.update(value)
        cursor += len(value)
        remaining -= len(value)
    return digest.hexdigest()


def _all_zero(stream: BinaryIO, offset: int, size: int) -> bool:
    remaining = size
    cursor = offset
    while remaining:
        value = _read_at(stream, cursor, min(CHUNK_BYTES, remaining))
        if any(value):
            return False
        cursor += len(value)
        remaining -= len(value)
    return True


def _safe_path(value: Any, *, directory: bool, layer_ordinal: int | None) -> str:
    if not isinstance(value, str):
        raise InspectionRefusal("path_invalid", layer_ordinal=layer_ordinal)
    try:
        encoded = value.encode("utf-8", "strict")
    except UnicodeEncodeError:
        raise InspectionRefusal("path_invalid", layer_ordinal=layer_ordinal) from None
    _require(
        bool(value)
        and len(encoded) <= MAX_PATH_BYTES
        and "\\" not in value
        and "//" not in value
        and not value.startswith("/")
        and not value.startswith("./")
        and not re.match(r"^[A-Za-z]:", value)
        and not any(ord(character) < 32 or ord(character) == 127 for character in value),
        "path_invalid",
        layer_ordinal=layer_ordinal,
        member=value,
    )
    logical = value[:-1] if directory and value.endswith("/") else value
    _require(
        bool(logical)
        and all(component not in ("", ".", "..") for component in logical.split("/")),
        "path_invalid",
        layer_ordinal=layer_ordinal,
        member=value,
    )
    return logical


def _safe_link(value: Any, member_name: str, layer_ordinal: int | None) -> str:
    if not isinstance(value, str):
        raise InspectionRefusal("symlink_target_invalid", layer_ordinal=layer_ordinal)
    try:
        encoded = value.encode("utf-8", "strict")
    except UnicodeEncodeError:
        raise InspectionRefusal("symlink_target_invalid", layer_ordinal=layer_ordinal) from None
    _require(
        bool(value)
        and len(encoded) <= MAX_PATH_BYTES
        and "\\" not in value
        and not any(ord(character) < 32 or ord(character) == 127 for character in value),
        "symlink_target_invalid",
        layer_ordinal=layer_ordinal,
        member=member_name,
        member_is_safe=True,
    )
    base = "" if value.startswith("/") else posixpath.dirname(member_name)
    resolved = posixpath.normpath(posixpath.join(base, value.lstrip("/")))
    _require(
        resolved not in ("", ".", "..")
        and not resolved.startswith("../")
        and resolved not in REMOVED_HELPERS,
        "symlink_target_invalid",
        layer_ordinal=layer_ordinal,
        member=member_name,
        member_is_safe=True,
    )
    return value


def _integral_mtime(value: Any, pax_headers: dict[str, str], layer_ordinal: int | None) -> int:
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise InspectionRefusal("fractional_mtime", layer_ordinal=layer_ordinal) from None
    _require(decimal.is_finite() and decimal == decimal.to_integral_value(), "fractional_mtime", layer_ordinal=layer_ordinal)
    if "mtime" in pax_headers:
        try:
            pax_mtime = Decimal(pax_headers["mtime"])
        except (InvalidOperation, ValueError):
            raise InspectionRefusal("fractional_mtime", layer_ordinal=layer_ordinal) from None
        _require(
            pax_mtime.is_finite() and pax_mtime == pax_mtime.to_integral_value(),
            "fractional_mtime",
            layer_ordinal=layer_ordinal,
        )
    return int(decimal)


def _member_record(
    info: tarfile.TarInfo,
    layer_ordinal: int | None,
    *,
    allow_whiteouts: bool,
) -> dict[str, Any]:
    directory = info.isdir()
    name = _safe_path(info.name, directory=directory, layer_ordinal=layer_ordinal)
    _require(not info.uname and not info.gname, "owner_name_unsupported", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
    _require(
        not getattr(info, "sparse", None)
        and not any(key.startswith("GNU.sparse") for key in info.pax_headers),
        "sparse_unsupported",
        layer_ordinal=layer_ordinal,
        member=name,
        member_is_safe=True,
    )
    _require(set(info.pax_headers).issubset(SAFE_PAX_KEYS), "pax_unsupported", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
    _require(not info.islnk(), "hardlink_unsupported", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
    _require(isinstance(info.uid, int) and 0 <= info.uid <= 2**31 - 1, "identity_invalid", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
    _require(isinstance(info.gid, int) and 0 <= info.gid <= 2**31 - 1, "identity_invalid", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
    _require(isinstance(info.mode, int) and 0 <= info.mode <= 0o7777, "mode_invalid", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
    mtime = _integral_mtime(info.mtime, info.pax_headers, layer_ordinal)
    components = name.split("/")
    leaf = components[-1]
    _require(
        not any(component.startswith(".wh.") for component in components[:-1]),
        "whiteout_invalid",
        layer_ordinal=layer_ordinal,
        member=name,
        member_is_safe=True,
    )
    is_whiteout = leaf.startswith(".wh.")
    if is_whiteout:
        _require(allow_whiteouts, "whiteout_unsupported", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
        _require(info.isreg() and info.size == 0, "whiteout_invalid", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
        if leaf != ".wh..wh..opq":
            removed = leaf[len(".wh."):]
            _require(
                bool(removed)
                and removed not in (".", "..")
                and not removed.startswith(".wh."),
                "whiteout_invalid",
                layer_ordinal=layer_ordinal,
                member=name,
                member_is_safe=True,
            )

    if info.isreg():
        kind = "whiteout" if is_whiteout else "file"
        linkname = ""
    elif directory:
        kind = "directory"
        linkname = ""
        _require(info.size == 0, "nonfile_size", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
    elif info.issym():
        kind = "symlink"
        linkname = _safe_link(info.linkname, name, layer_ordinal)
        _require(info.size == 0, "nonfile_size", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
    else:
        raise InspectionRefusal(
            "special_type_unsupported",
            layer_ordinal=layer_ordinal,
            member=name,
            member_is_safe=True,
        )

    return {
        "path": name,
        "type": kind,
        "mode": info.mode,
        "uid": info.uid,
        "gid": info.gid,
        "mtime": mtime,
        "size": info.size,
        "linkname": linkname,
        "paxKeys": sorted(info.pax_headers),
    }


def inspect_archive(
    file_obj: BinaryIO,
    *,
    label: str = "archive",
    max_members: int = MAX_LAYER_MEMBERS,
    max_total_members: int | None = None,
    cumulative: dict[str, int] | None = None,
    layer_ordinal: int | None = None,
) -> dict[str, Any]:
    """Inspect one uncompressed TAR through public ``tarfile`` metadata only."""

    source_layer = layer_ordinal is not None or label.startswith("source-layer")
    allow_whiteouts = source_layer
    try:
        original_position = file_obj.tell()
        file_obj.seek(0, io.SEEK_END)
        archive_size = file_obj.tell()
        file_obj.seek(0)
    except (AttributeError, OSError, ValueError):
        raise InspectionRefusal("archive_seek_unsupported", layer_ordinal=layer_ordinal) from None
    _require(0 < archive_size <= MAX_LAYER_BYTES, "archive_size_limit", layer_ordinal=layer_ordinal)
    _require(archive_size % tarfile.BLOCKSIZE == 0, "archive_truncated", layer_ordinal=layer_ordinal)

    archive: tarfile.TarFile | None = None
    try:
        archive = tarfile.open(fileobj=file_obj, mode="r:", ignore_zeros=False, errorlevel=2)
        already_counted = cumulative.get("members", 0) if cumulative is not None else 0
        remaining_total = (
            max_total_members - already_counted
            if max_total_members is not None
            else max_members
        )
        allowed_members = min(max_members, remaining_total)
        _require(allowed_members >= 0, "member_limit", layer_ordinal=layer_ordinal)
        infos: list[tarfile.TarInfo] = []
        for info in archive:
            _require(len(infos) < allowed_members, "member_limit", layer_ordinal=layer_ordinal)
            infos.append(info)
    except InspectionRefusal:
        if archive is not None:
            archive.close()
        raise
    except (tarfile.TarError, EOFError, OSError, ValueError):
        if archive is not None:
            archive.close()
        raise InspectionRefusal("archive_invalid", layer_ordinal=layer_ordinal) from None

    try:
        _require(bool(infos) or source_layer, "archive_empty", layer_ordinal=layer_ordinal)
        if cumulative is not None:
            total = already_counted + len(infos)
            cumulative["members"] = total

        names: set[str] = set()
        declared_types: dict[str, str] = {}
        records: list[dict[str, Any]] = []
        cursor = 0
        for info in infos:
            record = _member_record(info, layer_ordinal, allow_whiteouts=allow_whiteouts)
            name = record["path"]
            _require(name not in names, "duplicate_member", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
            components = name.split("/")
            ancestors = ("/".join(components[:index]) for index in range(1, len(components)))
            _require(
                all(declared_types.get(ancestor, "directory") == "directory" for ancestor in ancestors),
                "path_invalid",
                layer_ordinal=layer_ordinal,
                member=name,
                member_is_safe=True,
            )
            if record["type"] != "directory":
                prefix = f"{name}/"
                _require(
                    not any(existing.startswith(prefix) for existing in declared_types),
                    "path_invalid",
                    layer_ordinal=layer_ordinal,
                    member=name,
                    member_is_safe=True,
                )
            names.add(name)
            declared_types[name] = record["type"]
            metadata_bytes = info.offset_data - info.offset
            _require(
                isinstance(info.offset, int)
                and isinstance(info.offset_data, int)
                and isinstance(info.size, int)
                and info.offset == cursor
                and info.offset % tarfile.BLOCKSIZE == 0
                and info.offset_data % tarfile.BLOCKSIZE == 0
                and metadata_bytes == tarfile.BLOCKSIZE,
                "archive_hidden_region",
                layer_ordinal=layer_ordinal,
                member=name,
                member_is_safe=True,
            )
            payload_end = info.offset_data + info.size
            raw_end = (payload_end + tarfile.BLOCKSIZE - 1) // tarfile.BLOCKSIZE * tarfile.BLOCKSIZE
            _require(raw_end <= archive_size, "archive_truncated", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
            _require(
                _all_zero(file_obj, payload_end, raw_end - payload_end),
                "archive_nonzero_padding",
                layer_ordinal=layer_ordinal,
                member=name,
                member_is_safe=True,
            )
            record["rawSha256"] = _hash_at(file_obj, info.offset, raw_end - info.offset)
            if info.isreg():
                extracted = archive.extractfile(info)
                _require(extracted is not None, "archive_invalid", layer_ordinal=layer_ordinal, member=name, member_is_safe=True)
                with extracted:
                    record["payloadSha256"] = _hash_stream(extracted, info.size)
            else:
                record["payloadSha256"] = hashlib.sha256(b"").hexdigest()
            records.append(record)
            cursor = raw_end

        tail_bytes = archive_size - cursor
        _require(tail_bytes >= ZERO_BLOCK_BYTES, "archive_truncated", layer_ordinal=layer_ordinal)
        _require(_all_zero(file_obj, cursor, tail_bytes), "archive_nonzero_tail", layer_ordinal=layer_ordinal)
        metadata_records = [
            {key: value for key, value in record.items() if key != "payloadSha256"}
            for record in records
        ]
        return {
            "bytes": archive_size,
            "memberCount": len(records),
            "metadataSha256": _canonical_sha256(metadata_records),
            "inventorySha256": _canonical_sha256(records),
            "records": records,
            "infos": infos,
            "archive": archive,
        }
    except Exception:
        archive.close()
        raise
    finally:
        try:
            file_obj.seek(original_position)
        except (OSError, ValueError):
            pass


class _SecureInput:
    """An absolute, immutable, owned regular file with stable identity."""

    def __init__(
        self,
        value: str | os.PathLike[str],
        *,
        max_bytes: int,
        exit_hook: Any | None = None,
    ) -> None:
        self.path = Path(value)
        self.exit_hook = exit_hook
        self.file: BinaryIO | None = None
        _require(self.path.is_absolute(), "input_path_invalid")
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        try:
            self.fd = os.open(self.path, flags)
        except OSError:
            raise InspectionRefusal("input_open_failed") from None
        try:
            self.before = os.fstat(self.fd)
            path_stat = os.lstat(self.path)
            current_uid = os.geteuid() if hasattr(os, "geteuid") else self.before.st_uid
            _require(stat.S_ISREG(self.before.st_mode), "input_type_invalid")
            _require(self.before.st_uid == current_uid, "input_owner_invalid")
            _require(self.before.st_nlink == 1, "input_link_count_invalid")
            _require(stat.S_IMODE(self.before.st_mode) & 0o222 == 0, "input_not_readonly")
            _require(0 < self.before.st_size <= max_bytes, "input_size_limit")
            _require(
                (path_stat.st_dev, path_stat.st_ino, path_stat.st_size)
                == (self.before.st_dev, self.before.st_ino, self.before.st_size),
                "input_identity_mismatch",
            )
            self.file = os.fdopen(os.dup(self.fd), "rb", buffering=0)
            try:
                self.sha256 = _hash_stream(self.file, self.before.st_size)
                self.file.seek(0)
            except InspectionRefusal:
                raise InspectionIntegrityError() from None
        except Exception:
            if self.file is not None:
                self.file.close()
            os.close(self.fd)
            raise

    @property
    def size(self) -> int:
        return self.before.st_size

    def verify_unchanged(self) -> None:
        try:
            after = os.fstat(self.fd)
            path_stat = os.lstat(self.path)
            fields = ("st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
            if not all(getattr(after, field) == getattr(self.before, field) for field in fields):
                raise InspectionIntegrityError()
            if (path_stat.st_dev, path_stat.st_ino, path_stat.st_size) != (after.st_dev, after.st_ino, after.st_size):
                raise InspectionIntegrityError()
            if self.file is None:
                raise InspectionIntegrityError()
            self.file.seek(0)
            if _hash_stream(self.file, self.size) != self.sha256:
                raise InspectionIntegrityError()
            self.file.seek(0)
        except InspectionIntegrityError:
            raise
        except (InspectionRefusal, OSError, ValueError):
            raise InspectionIntegrityError() from None

    def close(self) -> None:
        try:
            if self.file is not None:
                self.file.close()
        finally:
            os.close(self.fd)

    def __enter__(self) -> "_SecureInput":
        return self

    def __exit__(self, *_args: object) -> None:
        try:
            if self.exit_hook is not None:
                hook, self.exit_hook = self.exit_hook, None
                hook()
            self.verify_unchanged()
        finally:
            self.close()


def _read_member(archive: tarfile.TarFile, info: tarfile.TarInfo, limit: int) -> bytes:
    extracted = archive.extractfile(info)
    _require(extracted is not None, "archive_invalid")
    with extracted:
        return _read_stream(extracted, info.size, limit)


def _validate_source_config(raw: bytes, expected_sha256: str, expected_diff_ids: tuple[str, ...]) -> None:
    _require(hashlib.sha256(raw).hexdigest() == expected_sha256, "source_config_mismatch")
    config = _json_no_duplicates(raw, "source_config_invalid")
    _require(isinstance(config, dict), "source_config_invalid")
    rootfs = config.get("rootfs")
    _require(isinstance(rootfs, dict) and set(rootfs) == {"type", "diff_ids"}, "source_config_invalid")
    _require(rootfs.get("type") == "layers", "source_config_invalid")
    diff_ids = rootfs.get("diff_ids")
    expected = [f"sha256:{value}" for value in expected_diff_ids]
    _require(diff_ids == expected, "source_config_diffids_mismatch")


def _inspect_moby28_envelope(
    outer_archive: tarfile.TarFile,
    by_name: dict[str, tuple[dict[str, Any], tarfile.TarInfo]],
    manifest_record: dict[str, Any],
    target: dict[str, Any],
    config_raw: bytes,
    expected_config_sha256: str,
    expected_diff_ids: tuple[str, ...],
    auxiliary_profile: dict[str, Any] | None,
) -> tuple[str, list[str], dict[str, Any], dict[str, Any] | None]:
    _require_envelope(
        len(expected_diff_ids) == 10 and len(set(expected_diff_ids)) == 10,
        node="outer",
        predicate="cardinality",
    )
    expected_config_path = f"blobs/sha256/{expected_config_sha256}"
    expected_layer_paths = [
        f"blobs/sha256/{diff_id}" for diff_id in expected_diff_ids
    ]
    _require_envelope(
        target.get("Config") == expected_config_path,
        node="outer",
        predicate="digest",
        expected_digest=expected_config_sha256,
    )
    _require_envelope(
        target.get("RepoTags") is None,
        node="outer",
        predicate="type",
        observed=target.get("RepoTags"),
        observed_available="RepoTags" in target,
    )
    layers_value = target.get("Layers")
    _require_envelope(
        isinstance(layers_value, list),
        node="outer",
        predicate="type",
        observed=layers_value,
        observed_available="Layers" in target,
    )
    _require_envelope(
        len(layers_value) == 10,
        node="outer",
        predicate="cardinality",
        observed=layers_value,
        observed_available=True,
    )
    for ordinal, (actual_path, expected_path, expected_diff_id) in enumerate(
        zip(layers_value, expected_layer_paths, expected_diff_ids, strict=True),
        start=1,
    ):
        actual_digest = (
            actual_path.removeprefix("blobs/sha256/")
            if isinstance(actual_path, str)
            and actual_path.startswith("blobs/sha256/")
            else None
        )
        _require_envelope(
            actual_path == expected_path,
            node="raw-layer",
            predicate="ordinal",
            ordinal=ordinal,
            expected_digest=expected_diff_id,
            actual_digest=actual_digest,
        )

    layer_sources = target.get("LayerSources")
    _require_envelope(
        isinstance(layer_sources, dict),
        node="layer-source",
        predicate="type",
        observed=layer_sources,
        observed_available="LayerSources" in target,
    )
    expected_source_keys = {
        f"sha256:{diff_id}" for diff_id in expected_diff_ids
    }
    _require_envelope(
        set(layer_sources) == expected_source_keys,
        node="layer-source",
        predicate="keys",
        observed=layer_sources,
        observed_available=True,
    )

    layout, layout_record = _envelope_json(
        outer_archive, by_name, "oci-layout", node="layout"
    )
    _require_envelope(
        isinstance(layout, dict),
        node="layout",
        predicate="type",
        observed=layout,
        observed_available=True,
    )
    _require_envelope(
        set(layout) == {"imageLayoutVersion"},
        node="layout",
        predicate="keys",
        observed=layout,
        observed_available=True,
    )
    _require_envelope(
        layout["imageLayoutVersion"] == "1.0.0",
        node="layout",
        predicate="type",
        observed=layout["imageLayoutVersion"],
        observed_available=True,
    )

    index, index_record = _envelope_json(
        outer_archive, by_name, "index.json", node="index"
    )
    _require_envelope(
        isinstance(index, dict),
        node="index",
        predicate="type",
        observed=index,
        observed_available=True,
    )
    _require_envelope(
        set(index) == {"schemaVersion", "mediaType", "manifests"},
        node="index",
        predicate="keys",
        observed=index,
        observed_available=True,
        media_type=index.get("mediaType"),
    )
    _require_envelope(
        isinstance(index["schemaVersion"], int)
        and not isinstance(index["schemaVersion"], bool)
        and index["schemaVersion"] == 2,
        node="index",
        predicate="type",
        observed=index["schemaVersion"],
        observed_available=True,
        media_type=index["mediaType"],
    )
    _require_envelope(
        index["mediaType"] == OCI_LAYOUT_MEDIA_TYPE,
        node="index",
        predicate="media-type",
        observed=index,
        observed_available=True,
        media_type=index["mediaType"],
    )
    manifests = index["manifests"]
    _require_envelope(
        isinstance(manifests, list),
        node="index",
        predicate="type",
        observed=manifests,
        observed_available=True,
        media_type=index["mediaType"],
    )
    _require_envelope(
        len(manifests) == 1,
        node="index",
        predicate="cardinality",
        observed=manifests,
        observed_available=True,
        media_type=index["mediaType"],
    )
    oci_manifest_digest, oci_manifest_bytes = _validate_descriptor(
        manifests[0],
        node="oci-manifest",
        expected_media_type=OCI_MANIFEST_MEDIA_TYPE,
    )
    oci_manifest_path = f"blobs/sha256/{oci_manifest_digest}"
    oci_manifest, oci_manifest_record = _envelope_json(
        outer_archive,
        by_name,
        oci_manifest_path,
        node="oci-manifest",
        expected_digest=oci_manifest_digest,
        expected_bytes=oci_manifest_bytes,
    )
    _require_envelope(
        isinstance(oci_manifest, dict),
        node="oci-manifest",
        predicate="type",
        observed=oci_manifest,
        observed_available=True,
    )
    _require_envelope(
        set(oci_manifest) == {"schemaVersion", "mediaType", "config", "layers"},
        node="oci-manifest",
        predicate="keys",
        observed=oci_manifest,
        observed_available=True,
        media_type=oci_manifest.get("mediaType"),
    )
    _require_envelope(
        isinstance(oci_manifest["schemaVersion"], int)
        and not isinstance(oci_manifest["schemaVersion"], bool)
        and oci_manifest["schemaVersion"] == 2,
        node="oci-manifest",
        predicate="type",
        observed=oci_manifest["schemaVersion"],
        observed_available=True,
        media_type=oci_manifest["mediaType"],
    )
    _require_envelope(
        oci_manifest["mediaType"] == OCI_MANIFEST_MEDIA_TYPE,
        node="oci-manifest",
        predicate="media-type",
        observed=oci_manifest,
        observed_available=True,
        media_type=oci_manifest["mediaType"],
    )
    _validate_descriptor(
        oci_manifest["config"],
        node="config",
        expected_media_type=OCI_CONFIG_MEDIA_TYPE,
        expected_digest=expected_config_sha256,
        expected_bytes=len(config_raw),
    )
    config_record, config_info = _envelope_member(
        by_name,
        expected_config_path,
        node="config",
        expected_digest=expected_config_sha256,
        expected_bytes=len(config_raw),
        json_member=True,
    )
    saved_config = _read_member(outer_archive, config_info, MAX_JSON_BYTES)
    _require_envelope(
        saved_config == config_raw,
        node="config",
        predicate="digest",
        member_type=config_record["type"],
        expected_digest=expected_config_sha256,
        actual_digest=config_record["payloadSha256"],
        expected_bytes=len(config_raw),
        actual_bytes=config_record["size"],
    )

    oci_layers = oci_manifest["layers"]
    _require_envelope(
        isinstance(oci_layers, list),
        node="oci-manifest",
        predicate="type",
        observed=oci_layers,
        observed_available=True,
        media_type=oci_manifest["mediaType"],
    )
    _require_envelope(
        len(oci_layers) == 10,
        node="oci-manifest",
        predicate="cardinality",
        observed=oci_layers,
        observed_available=True,
        media_type=oci_manifest["mediaType"],
    )
    for ordinal, (expected_path, expected_diff_id, layer_descriptor) in enumerate(
        zip(expected_layer_paths, expected_diff_ids, oci_layers, strict=True),
        start=1,
    ):
        layer_record, _layer_info = _envelope_member(
            by_name,
            expected_path,
            node="raw-layer",
            ordinal=ordinal,
            expected_digest=expected_diff_id,
        )
        _validate_descriptor(
            layer_descriptor,
            node="raw-layer",
            expected_media_type=OCI_LAYER_MEDIA_TYPE,
            expected_digest=expected_diff_id,
            expected_bytes=layer_record["size"],
            ordinal=ordinal,
        )
        source_descriptor = layer_sources[f"sha256:{expected_diff_id}"]
        _validate_descriptor(
            source_descriptor,
            node="layer-source",
            expected_media_type=OCI_LAYER_MEDIA_TYPE,
            expected_digest=expected_diff_id,
            expected_bytes=layer_record["size"],
            ordinal=ordinal,
        )
        _require_envelope(
            source_descriptor == layer_descriptor,
            node="layer-source",
            predicate="extra",
            ordinal=ordinal,
            observed=source_descriptor,
            observed_available=True,
            expected_digest=expected_diff_id,
            actual_digest=source_descriptor.get("digest")
            if isinstance(source_descriptor, dict)
            else None,
            expected_bytes=layer_record["size"],
            actual_bytes=source_descriptor.get("size")
            if isinstance(source_descriptor, dict)
            else None,
            media_type=source_descriptor.get("mediaType")
            if isinstance(source_descriptor, dict)
            else None,
        )

    role_paths = [
        expected_config_path,
        oci_manifest_path,
        *expected_layer_paths,
    ]
    _require_envelope(
        len(set(role_paths)) == len(role_paths),
        node="outer",
        predicate="extra",
    )
    allowed_files = {
        "manifest.json",
        "oci-layout",
        "index.json",
        *role_paths,
    }
    allowed_directories = {"blobs", "blobs/sha256"}
    candidates: list[tuple[dict[str, Any], tarfile.TarInfo]] = []
    first_extra: dict[str, Any] | None = None
    for entry in by_name.values():
        member = entry[0]
        allowed = (
            member["type"] == "directory"
            and member["path"] in allowed_directories
        ) or (
            member["type"] == "file" and member["path"] in allowed_files
        )
        if allowed:
            continue
        candidates.append(entry)
        if first_extra is None:
            first_extra = {
                "node": "outer",
                "predicate": "extra",
                "member_type": member["type"],
                "actual_digest": member["payloadSha256"]
                if member["type"] == "file"
                else None,
                "actual_bytes": member["size"]
                if member["type"] == "file"
                else None,
            }
    auxiliary_envelope: dict[str, Any] | None = None
    if first_extra is not None:
        auxiliary_diagnostic, ordered_auxiliary_nodes = (
            _classify_auxiliary_candidates(
                outer_archive,
                candidates,
                config_raw,
            )
        )
        if auxiliary_profile is None or ordered_auxiliary_nodes is None:
            _raise_envelope_refusal(
                auxiliary_diagnostic=auxiliary_diagnostic,
                **first_extra,
            )
        auxiliary_envelope = _validate_fixed_auxiliary(
            auxiliary_diagnostic,
            ordered_auxiliary_nodes,
            auxiliary_profile,
            config_raw,
        )
    elif auxiliary_profile is not None:
        _raise_envelope_refusal(
            node="auxiliary",
            predicate="cardinality",
        )

    return (
        expected_config_path,
        expected_layer_paths,
        {
            "schemaVersion": SCHEMA_VERSION,
            "kind": MOBY_ENVELOPE_KIND,
            "manifestSha256": manifest_record["payloadSha256"],
            "layoutSha256": layout_record["payloadSha256"],
            "indexSha256": index_record["payloadSha256"],
            "ociManifestSha256": oci_manifest_record["payloadSha256"],
            "descriptorCount": 10,
            "rawLayerDescriptorsMatched": True,
        },
        auxiliary_envelope,
    )


def _inspect_source_save(
    archive_path: str | os.PathLike[str],
    config_path: str | os.PathLike[str],
    *,
    expected_config_sha256: str,
    expected_diff_ids: tuple[str, ...],
    finalize_hook: Any | None = None,
    auxiliary_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _require(HEX64.fullmatch(expected_config_sha256) is not None, "expected_profile_invalid")
    _require(bool(expected_diff_ids) and all(HEX64.fullmatch(value) for value in expected_diff_ids), "expected_profile_invalid")
    normalized_auxiliary_profile = (
        _normalize_auxiliary_profile(auxiliary_profile)
        if auxiliary_profile is not None
        else None
    )

    with _SecureInput(config_path, max_bytes=MAX_JSON_BYTES) as config_input:
        with _SecureInput(
            archive_path,
            max_bytes=MAX_ARCHIVE_BYTES,
            exit_hook=finalize_hook,
        ) as archive_input:
            if config_input.file is None or archive_input.file is None:
                raise InspectionIntegrityError()
            config_input.file.seek(0)
            config_raw = _read_stream(config_input.file, config_input.size, MAX_JSON_BYTES)
            _validate_source_config(config_raw, expected_config_sha256, expected_diff_ids)
            outer = inspect_archive(
                archive_input.file,
                label="source-save",
                max_members=MAX_OUTER_MEMBERS,
            )
            outer_archive: tarfile.TarFile = outer["archive"]
            try:
                by_name = {record["path"]: (record, info) for record, info in zip(outer["records"], outer["infos"], strict=True)}
                if "manifest.json" not in by_name:
                    _raise_manifest_refusal(
                        "save_manifest_missing", _manifest_diagnostic(by_name)
                    )
                manifest_record, manifest_info = by_name["manifest.json"]
                if manifest_record["type"] != "file":
                    _raise_manifest_refusal(
                        "save_manifest_invalid", _manifest_diagnostic(by_name)
                    )
                manifest_raw = _read_member(
                    outer_archive, manifest_info, MAX_JSON_BYTES
                )
                try:
                    manifest = _json_no_duplicates(
                        manifest_raw, "save_manifest_invalid"
                    )
                except InspectionRefusal as refusal:
                    if refusal.code == "save_manifest_invalid":
                        _raise_manifest_refusal(
                            "save_manifest_invalid",
                            _manifest_diagnostic(by_name, json_state="invalid"),
                        )
                    raise
                manifest_diagnostic = _manifest_diagnostic(
                    by_name, json_state="valid", manifest=manifest
                )
                if not (
                    isinstance(manifest, list)
                    and len(manifest) == 1
                    and isinstance(manifest[0], dict)
                ):
                    _raise_manifest_refusal(
                        "save_manifest_invalid", manifest_diagnostic
                    )
                target = manifest[0]
                legacy_keys = {"Config", "RepoTags", "Layers"}
                moby28_keys = {"Config", "LayerSources", "Layers", "RepoTags"}
                if set(target) not in (legacy_keys, moby28_keys):
                    _raise_manifest_refusal(
                        "save_manifest_invalid", manifest_diagnostic
                    )
                source_envelope: dict[str, Any] | None = None
                auxiliary_envelope: dict[str, Any] | None = None
                if set(target) == moby28_keys:
                    (
                        config_member,
                        layer_paths,
                        source_envelope,
                        auxiliary_envelope,
                    ) = (
                        _inspect_moby28_envelope(
                            outer_archive,
                            by_name,
                            manifest_record,
                            target,
                            config_raw,
                            expected_config_sha256,
                            expected_diff_ids,
                            normalized_auxiliary_profile,
                        )
                    )
                else:
                    config_member = target.get("Config")
                    layer_paths = target.get("Layers")
                    repo_tags = target.get("RepoTags")
                    _require(isinstance(config_member, str) and CONFIG_MEMBER.fullmatch(config_member) is not None, "save_config_reference_invalid")
                    _require(
                        isinstance(layer_paths, list)
                        and len(layer_paths) == len(expected_diff_ids)
                        and len(set(layer_paths)) == len(layer_paths)
                        and all(isinstance(value, str) and LAYER_MEMBER.fullmatch(value) is not None for value in layer_paths),
                        "save_layer_reference_invalid",
                    )
                    _require(
                        repo_tags is None
                        or (
                            isinstance(repo_tags, list)
                            and 1 <= len(repo_tags) <= 8
                            and all(isinstance(value, str) and 0 < len(value.encode("utf-8")) <= MAX_PATH_BYTES for value in repo_tags)
                        ),
                        "save_repo_tags_invalid",
                    )
                    _require(config_member in by_name, "save_config_missing")
                    config_record, config_info = by_name[config_member]
                    _require(config_record["type"] == "file" and config_info.size == len(config_raw), "save_config_mismatch")
                    saved_config = _read_member(outer_archive, config_info, MAX_JSON_BYTES)
                    _require(saved_config == config_raw, "save_config_mismatch")

                    layer_directories = {path.rsplit("/", 1)[0] for path in layer_paths}
                    allowed_regular = {"manifest.json", config_member, "repositories", *layer_paths}
                    for directory in layer_directories:
                        allowed_regular.add(f"{directory}/VERSION")
                        allowed_regular.add(f"{directory}/json")
                    for record in outer["records"]:
                        if record["type"] == "directory":
                            _require(record["path"] in layer_directories, "save_unreferenced_member", member=record["path"], member_is_safe=True)
                        else:
                            _require(record["type"] == "file" and record["path"] in allowed_regular, "save_unreferenced_member", member=record["path"], member_is_safe=True)
                    for layer_path in layer_paths:
                        _require(layer_path in by_name, "save_layer_missing")
                    if "repositories" in by_name:
                        repository_record, repository_info = by_name["repositories"]
                        _require(repository_record["type"] == "file", "save_repositories_invalid")
                        repositories = _json_no_duplicates(_read_member(outer_archive, repository_info, MAX_JSON_BYTES), "save_repositories_invalid")
                        _require(isinstance(repositories, dict), "save_repositories_invalid")
                    for directory in layer_directories:
                        version_name = f"{directory}/VERSION"
                        if version_name in by_name:
                            version_record, version_info = by_name[version_name]
                            _require(version_record["type"] == "file", "save_metadata_invalid")
                            _require(_read_member(outer_archive, version_info, 64) == b"1.0", "save_metadata_invalid")
                        json_name = f"{directory}/json"
                        if json_name in by_name:
                            json_record, json_info = by_name[json_name]
                            _require(json_record["type"] == "file", "save_metadata_invalid")
                            layer_metadata = _json_no_duplicates(_read_member(outer_archive, json_info, MAX_JSON_BYTES), "save_metadata_invalid")
                            _require(isinstance(layer_metadata, dict), "save_metadata_invalid")

                cumulative = {"members": 0}
                total_layer_bytes = 0
                layers: list[dict[str, Any]] = []
                for ordinal, (layer_path, expected_diff_id) in enumerate(zip(layer_paths, expected_diff_ids, strict=True), start=1):
                    layer_record, layer_info = by_name[layer_path]
                    _require(layer_record["type"] == "file", "save_layer_invalid", layer_ordinal=ordinal)
                    total_layer_bytes += layer_info.size
                    _require(total_layer_bytes <= MAX_LAYER_TOTAL_BYTES, "layer_total_size_limit", layer_ordinal=ordinal)
                    layer_stream = outer_archive.extractfile(layer_info)
                    _require(layer_stream is not None, "save_layer_invalid", layer_ordinal=ordinal)
                    with layer_stream:
                        layer_sha256 = _hash_stream(layer_stream, layer_info.size)
                        _require(layer_sha256 == expected_diff_id, "layer_digest_mismatch", layer_ordinal=ordinal)
                        try:
                            layer_stream.seek(0)
                        except (AttributeError, OSError, ValueError):
                            raise InspectionRefusal("archive_seek_unsupported", layer_ordinal=ordinal) from None
                        layer = inspect_archive(
                            layer_stream,
                            label="source-layer",
                            max_members=MAX_LAYER_MEMBERS,
                            max_total_members=MAX_TOTAL_LAYER_MEMBERS,
                            cumulative=cumulative,
                            layer_ordinal=ordinal,
                        )
                        layer["archive"].close()
                    layers.append(
                        {
                            "ordinal": ordinal,
                            "path": layer_path,
                            "sha256": layer_sha256,
                            "bytes": layer_info.size,
                            "memberCount": layer["memberCount"],
                            "metadataSha256": layer["metadataSha256"],
                            "inventorySha256": layer["inventorySha256"],
                        }
                    )

                result = {
                    "schemaVersion": SCHEMA_VERSION,
                    "profile": PROFILE,
                    "evidenceClass": EVIDENCE_CLASS,
                    "status": "PASS",
                    "sourceConfigSha256": expected_config_sha256,
                    "archive": {"sha256": archive_input.sha256, "bytes": archive_input.size},
                    "layers": layers,
                    "totals": {
                        "layerCount": len(layers),
                        "layerBytes": total_layer_bytes,
                        "memberCount": cumulative["members"],
                    },
                }
                if source_envelope is not None:
                    result["sourceEnvelope"] = source_envelope
                if auxiliary_envelope is not None:
                    result["auxiliaryEnvelope"] = auxiliary_envelope
                return result
            finally:
                outer_archive.close()


def inspect_source_save(
    archive_path: str | os.PathLike[str], config_path: str | os.PathLike[str]
) -> dict[str, Any]:
    """Inspect the production profile.  Its expected identity is not overrideable."""

    return _inspect_source_save(
        archive_path,
        config_path,
        expected_config_sha256=SOURCE_CONFIG_SHA256,
        expected_diff_ids=SOURCE_DIFF_IDS,
        auxiliary_profile=PRODUCTION_AUXILIARY_PROFILE,
    )


def inspect_source_save_fixture(
    archive_path: str | os.PathLike[str],
    config_path: str | os.PathLike[str],
    expected_config_sha256: str,
    expected_diff_ids: Iterable[str],
    *,
    finalize_hook: Any | None = None,
    auxiliary_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Test-only profile injection for small, independent inert fixtures."""

    normalized_diff_ids = tuple(
        value.removeprefix("sha256:") for value in expected_diff_ids
    )
    return _inspect_source_save(
        archive_path,
        config_path,
        expected_config_sha256=expected_config_sha256,
        expected_diff_ids=normalized_diff_ids,
        finalize_hook=finalize_hook,
        auxiliary_profile=auxiliary_profile,
    )


def _qualification_common(kind: str, status: str) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "profile": PROFILE,
        "evidenceClass": QUALIFICATION_EVIDENCE_CLASS,
        "kind": kind,
        "status": status,
    }


def _qualification_expected_members(*, filtered: bool) -> list[dict[str, Any]]:
    expected: list[dict[str, Any]] = []
    for item in QUALIFICATION_FIXTURE:
        if filtered and item["path"] in REMOVED_HELPERS:
            continue
        payload = item.get("payload", b"")
        expected.append(
            {
                "path": item["path"],
                "type": item["type"],
                "mode": item["mode"],
                "uid": item["uid"],
                "gid": item["gid"],
                "mtime": item["mtime"],
                "size": len(payload),
                "linkname": item.get("linkname", ""),
                "payloadSha256": hashlib.sha256(payload).hexdigest(),
            }
        )
    return expected


def _qualification_semantic_member(record: dict[str, Any]) -> dict[str, Any]:
    return {
        key: record[key]
        for key in (
            "path",
            "type",
            "mode",
            "uid",
            "gid",
            "mtime",
            "size",
            "linkname",
            "payloadSha256",
        )
    }


def _qualification_report_member(record: dict[str, Any]) -> dict[str, Any]:
    value = _qualification_semantic_member(record)
    value["rawSha256"] = record["rawSha256"]
    return value


def _qualification_semantic_sha256(records: Iterable[dict[str, Any]]) -> str:
    values = sorted(
        (_qualification_semantic_member(record) for record in records),
        key=lambda record: record["path"],
    )
    return _canonical_sha256(values)


def _qualification_ordered_raw_sha256(records: Iterable[dict[str, Any]]) -> str:
    return _canonical_sha256(
        [
            {"path": record["path"], "rawSha256": record["rawSha256"]}
            for record in records
        ]
    )


def _qualification_validate_member(
    info: tarfile.TarInfo, record: dict[str, Any]
) -> None:
    _require(
        info.devmajor in (None, 0) and info.devminor in (None, 0),
        "qualification_fixture_mismatch",
        member=record["path"],
        member_is_safe=True,
    )
    _require(
        not info.pax_headers,
        "archive_hidden_region",
        member=record["path"],
        member_is_safe=True,
    )


def _qualification_input(
    value: str | os.PathLike[str], *, max_bytes: int
) -> _SecureInput:
    try:
        return _SecureInput(value, max_bytes=max_bytes)
    except InspectionRefusal as refusal:
        if refusal.code in {
            "input_path_invalid",
            "input_open_failed",
            "input_type_invalid",
            "input_owner_invalid",
            "input_link_count_invalid",
            "input_not_readonly",
            "input_identity_mismatch",
            "input_size_limit",
        }:
            raise InspectionIntegrityError("qualification_input_unsafe") from None
        raise


def _inspect_qualification_path(
    archive_path: str | os.PathLike[str], *, label: str
) -> dict[str, Any]:
    with _qualification_input(
        archive_path, max_bytes=QUALIFICATION_MAX_BYTES
    ) as secure:
        if secure.file is None:
            raise InspectionIntegrityError()
        inspected = inspect_archive(
            secure.file,
            label=label,
            max_members=64,
        )
        try:
            for record, info in zip(
                inspected["records"], inspected["infos"], strict=True
            ):
                _qualification_validate_member(info, record)
            records = [
                _qualification_report_member(record)
                for record in inspected["records"]
            ]
            summary = {
                "sha256": secure.sha256,
                "bytes": secure.size,
                "memberCount": len(records),
                "semanticSha256": _qualification_semantic_sha256(records),
                "orderedRawSha256": _qualification_ordered_raw_sha256(records),
            }
            return {"archive": summary, "members": records}
        finally:
            inspected["archive"].close()


def _require_qualification_members(
    records: list[dict[str, Any]],
    *,
    filtered: bool,
    code: str,
    ordered: bool = False,
) -> None:
    expected = _qualification_expected_members(filtered=filtered)
    actual = [_qualification_semantic_member(record) for record in records]
    if ordered:
        _require(actual == expected, code)
    else:
        _require(
            sorted(actual, key=lambda record: record["path"])
            == sorted(expected, key=lambda record: record["path"]),
            code,
        )


def _qualification_sentinel() -> dict[str, Any]:
    return {
        "path": "data/sentinel.txt",
        "sha256": hashlib.sha256(QUALIFICATION_SENTINEL).hexdigest(),
        "bytes": len(QUALIFICATION_SENTINEL),
    }


def _qualification_fixture_result(
    archive_path: str | os.PathLike[str], *, operation: str
) -> dict[str, Any]:
    inspected = _inspect_qualification_path(
        archive_path, label="inert-qualification-fixture"
    )
    _require_qualification_members(
        inspected["members"],
        filtered=False,
        code="qualification_fixture_mismatch",
        ordered=True,
    )
    return {
        **_qualification_common("INERT_FIXTURE_V1", "PASS"),
        "operation": operation,
        "archive": inspected["archive"],
        "members": inspected["members"],
        "sentinel": _qualification_sentinel(),
    }


def write_inert_qualification_fixture(
    archive_path: str | os.PathLike[str],
) -> dict[str, Any]:
    path = Path(archive_path)
    if not path.is_absolute():
        raise InspectionIntegrityError("qualification_output_unsafe")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_BINARY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError:
        raise InspectionIntegrityError("qualification_output_unsafe") from None
    try:
        before = os.fstat(descriptor)
        current_uid = os.geteuid() if hasattr(os, "geteuid") else before.st_uid
        if not (
            stat.S_ISREG(before.st_mode)
            and before.st_uid == current_uid
            and before.st_nlink == 1
            and before.st_size == 0
        ):
            raise InspectionIntegrityError("qualification_output_unsafe")
        with os.fdopen(os.dup(descriptor), "wb", buffering=0) as output:
            with tarfile.open(
                fileobj=output, mode="w:", format=tarfile.USTAR_FORMAT
            ) as archive:
                for item in QUALIFICATION_FIXTURE:
                    info = tarfile.TarInfo(item["path"])
                    info.mode = item["mode"]
                    info.uid = item["uid"]
                    info.gid = item["gid"]
                    info.mtime = item["mtime"]
                    info.uname = ""
                    info.gname = ""
                    info.devmajor = 0
                    info.devminor = 0
                    payload = item.get("payload", b"")
                    if item["type"] == "directory":
                        info.type = tarfile.DIRTYPE
                        info.size = 0
                        archive.addfile(info)
                    elif item["type"] == "symlink":
                        info.type = tarfile.SYMTYPE
                        info.linkname = item["linkname"]
                        info.size = 0
                        archive.addfile(info)
                    else:
                        info.type = tarfile.REGTYPE
                        info.size = len(payload)
                        archive.addfile(info, io.BytesIO(payload))
            output.flush()
            os.fsync(output.fileno())
        after_write = os.fstat(descriptor)
        if not (
            (after_write.st_dev, after_write.st_ino, after_write.st_uid, after_write.st_nlink)
            == (before.st_dev, before.st_ino, before.st_uid, before.st_nlink)
            and 0 < after_write.st_size <= QUALIFICATION_MAX_BYTES
        ):
            raise InspectionIntegrityError("qualification_output_unsafe")
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o444)
        else:  # pragma: no cover - all supported runtimes expose fchmod.
            os.chmod(path, 0o444)
        sealed = os.fstat(descriptor)
        path_stat = os.lstat(path)
        if not (
            stat.S_IMODE(sealed.st_mode) & 0o222 == 0
            and (path_stat.st_dev, path_stat.st_ino, path_stat.st_size)
            == (sealed.st_dev, sealed.st_ino, sealed.st_size)
        ):
            raise InspectionIntegrityError("qualification_output_unsafe")
    finally:
        os.close(descriptor)
    return _qualification_fixture_result(path, operation="WRITE")


def inspect_inert_qualification_fixture(
    archive_path: str | os.PathLike[str],
) -> dict[str, Any]:
    return _qualification_fixture_result(archive_path, operation="INSPECT")


def compare_inert_qualification_export(
    original_path: str | os.PathLike[str],
    export_path: str | os.PathLike[str],
) -> dict[str, Any]:
    original = _inspect_qualification_path(original_path, label="inert-fixture")
    exported = _inspect_qualification_path(export_path, label="inert-export")
    _require_qualification_members(
        original["members"],
        filtered=False,
        code="qualification_fixture_mismatch",
        ordered=True,
    )
    _require_qualification_members(
        exported["members"],
        filtered=False,
        code="qualification_export_mismatch",
    )
    _require(
        original["archive"]["semanticSha256"]
        == exported["archive"]["semanticSha256"],
        "qualification_export_mismatch",
    )
    return {
        **_qualification_common("INERT_EXPORT_SEMANTICS_V1", "PASS"),
        "original": original["archive"],
        "exported": exported["archive"],
        "matched": True,
        "members": exported["members"],
        "sentinel": _qualification_sentinel(),
    }


def compare_inert_qualification_delete(
    original_path: str | os.PathLike[str],
    filtered_path: str | os.PathLike[str],
) -> dict[str, Any]:
    original = _inspect_qualification_path(original_path, label="inert-control-export")
    filtered = _inspect_qualification_path(filtered_path, label="inert-filtered")
    _require_qualification_members(
        original["members"],
        filtered=False,
        code="qualification_fixture_mismatch",
    )
    _require_qualification_members(
        filtered["members"],
        filtered=True,
        code="qualification_removed_helpers_mismatch",
    )
    survivors = [
        {"path": record["path"], "rawSha256": record["rawSha256"]}
        for record in original["members"]
        if record["path"] not in REMOVED_HELPERS
    ]
    filtered_survivors = [
        {"path": record["path"], "rawSha256": record["rawSha256"]}
        for record in filtered["members"]
    ]
    _require(
        survivors == filtered_survivors,
        "qualification_raw_survivor_mismatch",
    )
    return {
        **_qualification_common("INERT_RAW_DELETE_V1", "PASS"),
        "original": original["archive"],
        "filtered": filtered["archive"],
        "removedCount": 2,
        "removed": list(REMOVED_HELPERS),
        "survivorCount": len(survivors),
        "survivorRawSha256": _canonical_sha256(survivors),
        "survivors": survivors,
        "sentinel": _qualification_sentinel(),
    }


def compare_inert_qualification_filtered_export(
    filtered_path: str | os.PathLike[str],
    export_path: str | os.PathLike[str],
) -> dict[str, Any]:
    filtered = _inspect_qualification_path(filtered_path, label="inert-filtered")
    exported = _inspect_qualification_path(export_path, label="inert-filtered-export")
    for value in (filtered, exported):
        _require_qualification_members(
            value["members"],
            filtered=True,
            code="qualification_export_mismatch",
        )
    _require(
        filtered["archive"]["semanticSha256"]
        == exported["archive"]["semanticSha256"],
        "qualification_export_mismatch",
    )
    return {
        **_qualification_common(
            "INERT_FILTERED_EXPORT_SEMANTICS_V1", "PASS"
        ),
        "filtered": filtered["archive"],
        "exported": exported["archive"],
        "matched": True,
        "members": exported["members"],
        "sentinel": _qualification_sentinel(),
    }


def _qualification_arguments(
    *,
    image_id: str,
    tag: str,
    diff_id: str,
    server_version: str,
    created: str,
    owner: str,
) -> tuple[str, str]:
    _require(
        isinstance(owner, str) and QUALIFICATION_UUID.fullmatch(owner) is not None,
        "qualification_owner_invalid",
    )
    expected_tag = f"auto-world-managed/seaweedfs-go-s3-control:{owner}"
    _require(tag == expected_tag, "qualification_argument_invalid")
    _require(
        isinstance(image_id, str)
        and image_id.startswith("sha256:")
        and HEX64.fullmatch(image_id[7:]) is not None,
        "qualification_argument_invalid",
    )
    _require(
        isinstance(diff_id, str)
        and diff_id.startswith("sha256:")
        and HEX64.fullmatch(diff_id[7:]) is not None,
        "qualification_argument_invalid",
    )
    _require(
        isinstance(server_version, str)
        and len(server_version) <= 64
        and server_version == QUALIFICATION_SERVER_VERSION,
        "qualification_argument_invalid",
    )
    _require(
        isinstance(created, str)
        and len(created) <= 40
        and QUALIFICATION_CREATED.fullmatch(created) is not None,
        "qualification_argument_invalid",
    )
    try:
        parsed_created = datetime.fromisoformat(created[:-1] + "+00:00")
    except ValueError:
        raise InspectionRefusal("qualification_argument_invalid") from None
    _require(parsed_created.utcoffset() is not None, "qualification_argument_invalid")
    return image_id[7:], diff_id[7:]


def _qualification_runtime_config(value: Any, owner: str) -> None:
    _require(isinstance(value, dict), "qualification_save_config_invalid")
    required = {
        "User": "1001:1002",
        "Cmd": ["/auto-world-inert-never-execute"],
        "WorkingDir": "/data",
        "Volumes": {"/data": {}},
        "Labels": {
            "com.auto-world.task005.inert": owner,
            "com.auto-world.task005.inert-stage": "filtered",
            "org.auto-world.seaweed-go-s3-control": "inert-v1",
        },
    }
    allowed = dict(ZERO_CONTAINER_CONFIG)
    allowed.update(required)
    _require(
        set(required).issubset(value)
        and set(value).issubset(allowed)
        and all(value[key] == expected for key, expected in required.items())
        and all(value[key] == allowed[key] for key in set(value) - set(required)),
        "qualification_save_config_invalid",
    )


def _qualification_legacy_config(
    value: Any,
    *,
    owner: str,
    created: str,
    server_version: str,
    diff_id: str,
) -> None:
    expected_keys = {
        "architecture",
        "comment",
        "config",
        "container_config",
        "created",
        "docker_version",
        "history",
        "os",
        "rootfs",
    }
    _require(
        isinstance(value, dict)
        and set(value) == expected_keys
        and value["architecture"] == "amd64"
        and value["os"] == "linux"
        and value["created"] == created
        and value["docker_version"] == server_version
        and value["comment"] == "auto-world-inert-qualification-v1"
        and value["container_config"] == ZERO_CONTAINER_CONFIG
        and value["history"]
        == [
            {
                "created": created,
                "comment": "auto-world-inert-qualification-v1",
            }
        ]
        and value["rootfs"] == {"type": "layers", "diff_ids": [diff_id]},
        "qualification_save_config_invalid",
    )
    _qualification_runtime_config(value["config"], owner)


def _qualification_layer_metadata(
    value: Any,
    *,
    layer_id: str,
    owner: str,
    created: str,
    server_version: str,
) -> None:
    _require(
        isinstance(value, dict)
        and set(value)
        == {
            "architecture",
            "comment",
            "config",
            "container_config",
            "created",
            "docker_version",
            "id",
            "os",
        }
        and value["id"] == layer_id
        and value["architecture"] == "amd64"
        and value["os"] == "linux"
        and value["created"] == created
        and value["docker_version"] == server_version
        and value["comment"] == "auto-world-inert-qualification-v1"
        and value["container_config"] == ZERO_CONTAINER_CONFIG,
        "qualification_save_config_invalid",
    )
    _qualification_runtime_config(value["config"], owner)


def inspect_inert_qualification_legacy_save(
    archive_path: str | os.PathLike[str],
    *,
    image_id: str,
    tag: str,
    diff_id: str,
    server_version: str,
    created: str,
    owner: str,
) -> dict[str, Any]:
    image_hex, diff_hex = _qualification_arguments(
        image_id=image_id,
        tag=tag,
        diff_id=diff_id,
        server_version=server_version,
        created=created,
        owner=owner,
    )
    with _qualification_input(
        archive_path, max_bytes=QUALIFICATION_MAX_BYTES
    ) as secure:
        if secure.file is None:
            raise InspectionIntegrityError()
        outer = inspect_archive(
            secure.file,
            label="inert-legacy-save",
            max_members=16,
        )
        outer_archive: tarfile.TarFile = outer["archive"]
        try:
            for record, info in zip(
                outer["records"], outer["infos"], strict=True
            ):
                _qualification_validate_member(info, record)
            by_name = {
                record["path"]: (record, info)
                for record, info in zip(
                    outer["records"], outer["infos"], strict=True
                )
            }
            names = set(by_name)
            if (
                "oci-layout" in names
                or "index.json" in names
                or any(name == "blobs" or name.startswith("blobs/") for name in names)
            ):
                raise InspectionRefusal("qualification_save_format_unsupported")
            _require(
                "manifest.json" in by_name,
                "qualification_save_manifest_invalid",
            )
            manifest_record, manifest_info = by_name["manifest.json"]
            _require(
                manifest_record["type"] == "file",
                "qualification_save_manifest_invalid",
            )
            manifest = _json_no_duplicates(
                _read_member(outer_archive, manifest_info, MAX_JSON_BYTES),
                "qualification_save_manifest_invalid",
            )
            _require(
                isinstance(manifest, list)
                and len(manifest) == 1
                and isinstance(manifest[0], dict),
                "qualification_save_manifest_invalid",
            )
            target = manifest[0]
            if "LayerSources" in target:
                raise InspectionRefusal("qualification_save_format_unsupported")
            _require(
                set(target) == {"Config", "RepoTags", "Layers"}
                and target["Config"] == f"{image_hex}.json"
                and target["RepoTags"] == [tag]
                and isinstance(target["Layers"], list)
                and len(target["Layers"]) == 1,
                "qualification_save_manifest_invalid",
            )
            layer_path = target["Layers"][0]
            match = LAYER_MEMBER.fullmatch(layer_path) if isinstance(layer_path, str) else None
            if match is None:
                raise InspectionRefusal("qualification_save_format_unsupported")
            layer_id = match.group(1)
            config_path = f"{image_hex}.json"
            expected_names = {
                "manifest.json",
                config_path,
                "repositories",
                layer_id,
                f"{layer_id}/VERSION",
                f"{layer_id}/json",
                layer_path,
            }
            _require(
                names == expected_names,
                "qualification_save_manifest_invalid",
            )
            type_expectations = {
                "manifest.json": "file",
                config_path: "file",
                "repositories": "file",
                layer_id: "directory",
                f"{layer_id}/VERSION": "file",
                f"{layer_id}/json": "file",
                layer_path: "file",
            }
            _require(
                all(by_name[name][0]["type"] == kind for name, kind in type_expectations.items()),
                "qualification_save_manifest_invalid",
            )
            config_record, config_info = by_name[config_path]
            _require(
                config_record["payloadSha256"] == image_hex,
                "qualification_save_identity_mismatch",
            )
            config = _json_no_duplicates(
                _read_member(outer_archive, config_info, MAX_JSON_BYTES),
                "qualification_save_config_invalid",
            )
            _qualification_legacy_config(
                config,
                owner=owner,
                created=created,
                server_version=server_version,
                diff_id=diff_id,
            )
            version_record, version_info = by_name[f"{layer_id}/VERSION"]
            _require(
                version_record["size"] == 3
                and _read_member(outer_archive, version_info, 64) == b"1.0",
                "qualification_save_manifest_invalid",
            )
            metadata_record, metadata_info = by_name[f"{layer_id}/json"]
            _require(
                metadata_record["size"] <= MAX_JSON_BYTES,
                "qualification_save_config_invalid",
            )
            metadata = _json_no_duplicates(
                _read_member(outer_archive, metadata_info, MAX_JSON_BYTES),
                "qualification_save_config_invalid",
            )
            _qualification_layer_metadata(
                metadata,
                layer_id=layer_id,
                owner=owner,
                created=created,
                server_version=server_version,
            )
            repositories_record, repositories_info = by_name["repositories"]
            _require(
                repositories_record["size"] <= MAX_JSON_BYTES,
                "qualification_save_manifest_invalid",
            )
            repositories = _json_no_duplicates(
                _read_member(outer_archive, repositories_info, MAX_JSON_BYTES),
                "qualification_save_manifest_invalid",
            )
            _require(
                repositories
                == {"auto-world-managed/seaweedfs-go-s3-control": {owner: layer_id}},
                "qualification_save_manifest_invalid",
            )
            layer_record, layer_info = by_name[layer_path]
            _require(
                layer_record["payloadSha256"] == diff_hex,
                "qualification_save_layer_invalid",
            )
            layer_stream = outer_archive.extractfile(layer_info)
            _require(layer_stream is not None, "qualification_save_layer_invalid")
            with layer_stream:
                layer = inspect_archive(
                    layer_stream,
                    label="inert-legacy-layer",
                    max_members=64,
                )
                try:
                    for record, info in zip(
                        layer["records"], layer["infos"], strict=True
                    ):
                        _qualification_validate_member(info, record)
                    layer_members = [
                        _qualification_report_member(record)
                        for record in layer["records"]
                    ]
                    _require_qualification_members(
                        layer_members,
                        filtered=True,
                        code="qualification_save_layer_invalid",
                    )
                finally:
                    layer["archive"].close()
            outer_members = [
                _qualification_report_member(record) for record in outer["records"]
            ]
            archive_summary = {
                "sha256": secure.sha256,
                "bytes": secure.size,
                "memberCount": len(outer_members),
                "semanticSha256": _qualification_semantic_sha256(outer_members),
                "orderedRawSha256": _qualification_ordered_raw_sha256(outer_members),
            }
            return {
                **_qualification_common("INERT_LEGACY_SAVE_V1", "PASS"),
                "archive": archive_summary,
                "family": "MOBY_LEGACY_SINGLE_LAYER_V1",
                "image": {
                    "imageId": image_id,
                    "tag": tag,
                    "owner": owner,
                    "created": created,
                    "serverVersion": server_version,
                    "configSha256": image_hex,
                },
                "layer": {
                    "diffId": diff_id,
                    "sha256": diff_hex,
                    "bytes": layer_info.size,
                    "memberCount": len(layer_members),
                    "semanticSha256": _qualification_semantic_sha256(layer_members),
                },
                "graph": {
                    "configPath": config_path,
                    "layerPath": layer_path,
                    "layerId": layer_id,
                    "descriptorCount": 1,
                },
                "sentinel": _qualification_sentinel(),
            }
        finally:
            outer_archive.close()


def _activate_cli_limits() -> None:
    _require(resource is not None, "resource_limits_unavailable")
    try:
        _cpu_soft, cpu_hard = resource.getrlimit(resource.RLIMIT_CPU)
        cpu_target = 300 if cpu_hard == resource.RLIM_INFINITY else min(300, cpu_hard)
        _require(cpu_target > 0, "resource_limits_unavailable")
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_target, cpu_hard))
        _address_soft, address_hard = resource.getrlimit(resource.RLIMIT_AS)
        address_target = 512 * 1024**2
        _require(address_hard == resource.RLIM_INFINITY or address_hard >= address_target, "resource_limits_unavailable")
        resource.setrlimit(resource.RLIMIT_AS, (address_target, address_hard))
        _file_soft, file_hard = resource.getrlimit(resource.RLIMIT_FSIZE)
        file_target = MAX_OUTPUT_BYTES if file_hard == resource.RLIM_INFINITY else min(MAX_OUTPUT_BYTES, file_hard)
        _require(file_target > 0, "resource_limits_unavailable")
        resource.setrlimit(resource.RLIMIT_FSIZE, (file_target, file_hard))
    except (OSError, ValueError):
        raise InspectionRefusal("resource_limits_unavailable") from None


def _refusal_json(refusal: InspectionRefusal) -> dict[str, Any]:
    detail: dict[str, Any] = {"code": refusal.code}
    if refusal.layer_ordinal is not None:
        detail["layerOrdinal"] = refusal.layer_ordinal
    if refusal.member is not None:
        if refusal.member_is_safe:
            detail["member"] = refusal.member
        else:
            detail["memberSha256"] = hashlib.sha256(
                refusal.member.encode("utf-8", "backslashreplace")
            ).hexdigest()
    result = {
        "schemaVersion": SCHEMA_VERSION,
        "profile": PROFILE,
        "evidenceClass": EVIDENCE_CLASS,
        "status": "REFUSED",
        "refusal": detail,
    }
    if (
        refusal.code in MANIFEST_DIAGNOSTIC_CODES
        and refusal.manifest_diagnostic is not None
    ):
        result["manifestDiagnostic"] = refusal.manifest_diagnostic
    if (
        refusal.code == "save_envelope_invalid"
        and refusal.envelope_diagnostic is not None
        and refusal.manifest_diagnostic is None
    ):
        result["envelopeDiagnostic"] = refusal.envelope_diagnostic
        if (
            refusal.auxiliary_diagnostic is not None
            and refusal.envelope_diagnostic.get("node") == "outer"
            and refusal.envelope_diagnostic.get("predicate") == "extra"
        ):
            result["auxiliaryDiagnostic"] = refusal.auxiliary_diagnostic
    return result


def _integrity_json(error: InspectionIntegrityError) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "profile": PROFILE,
        "evidenceClass": EVIDENCE_CLASS,
        "status": "ERROR",
        "error": {"code": error.code},
    }


def _qualification_kind(command: str | None) -> str | None:
    return {
        "fixture-write": "INERT_FIXTURE_V1",
        "fixture-inspect": "INERT_FIXTURE_V1",
        "export-compare": "INERT_EXPORT_SEMANTICS_V1",
        "delete-compare": "INERT_RAW_DELETE_V1",
        "filtered-export-compare": "INERT_FILTERED_EXPORT_SEMANTICS_V1",
        "legacy-save-inspect": "INERT_LEGACY_SAVE_V1",
    }.get(command)


def _qualification_refusal_json(
    kind: str, refusal: InspectionRefusal
) -> dict[str, Any]:
    detail: dict[str, Any] = {"code": refusal.code}
    if refusal.member is not None:
        if refusal.member_is_safe:
            detail["member"] = refusal.member
        else:
            detail["memberSha256"] = hashlib.sha256(
                refusal.member.encode("utf-8", "backslashreplace")
            ).hexdigest()
    return {
        **_qualification_common(kind, "REFUSED"),
        "refusal": detail,
    }


def _qualification_integrity_json(
    kind: str, error: InspectionIntegrityError
) -> dict[str, Any]:
    return {
        **_qualification_common(kind, "ERROR"),
        "error": {"code": error.code},
    }


def _emit(value: dict[str, Any]) -> None:
    encoded = json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("ascii") + b"\n"
    if len(encoded) > MAX_OUTPUT_BYTES:
        encoded = json.dumps(
            _refusal_json(InspectionRefusal("output_limit")),
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii") + b"\n"
    binary_stdout = getattr(sys.stdout, "buffer", None)
    if binary_stdout is not None:
        binary_stdout.write(encoded)
        binary_stdout.flush()
    else:  # Supports a bounded in-memory capture without changing production bytes.
        sys.stdout.write(encoded.decode("ascii"))
        sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    parser = _ArgumentParser(add_help=True)
    subcommands = parser.add_subparsers(dest="command", required=True)
    source_save = subcommands.add_parser("source-save")
    source_save.add_argument("--archive", required=True)
    source_save.add_argument("--config", required=True)
    fixture_write = subcommands.add_parser("fixture-write")
    fixture_write.add_argument("--archive", required=True)
    fixture_inspect = subcommands.add_parser("fixture-inspect")
    fixture_inspect.add_argument("--archive", required=True)
    export_compare = subcommands.add_parser("export-compare")
    export_compare.add_argument("--original", required=True)
    export_compare.add_argument("--export", required=True)
    delete_compare = subcommands.add_parser("delete-compare")
    delete_compare.add_argument("--original", required=True)
    delete_compare.add_argument("--filtered", required=True)
    filtered_export_compare = subcommands.add_parser("filtered-export-compare")
    filtered_export_compare.add_argument("--filtered", required=True)
    filtered_export_compare.add_argument("--export", required=True)
    legacy_save = subcommands.add_parser("legacy-save-inspect")
    legacy_save.add_argument("--archive", required=True)
    legacy_save.add_argument("--image-id", required=True)
    legacy_save.add_argument("--tag", required=True)
    legacy_save.add_argument("--diff-id", required=True)
    legacy_save.add_argument("--server-version", required=True)
    legacy_save.add_argument("--created", required=True)
    legacy_save.add_argument("--owner", required=True)
    arguments: argparse.Namespace | None = None
    try:
        arguments = parser.parse_args(argv)
        _activate_cli_limits()
        if arguments.command == "source-save":
            _emit(inspect_source_save(arguments.archive, arguments.config))
            return 0
        if arguments.command == "fixture-write":
            _emit(write_inert_qualification_fixture(arguments.archive))
            return 0
        if arguments.command == "fixture-inspect":
            _emit(inspect_inert_qualification_fixture(arguments.archive))
            return 0
        if arguments.command == "export-compare":
            _emit(
                compare_inert_qualification_export(
                    arguments.original, arguments.export
                )
            )
            return 0
        if arguments.command == "delete-compare":
            _emit(
                compare_inert_qualification_delete(
                    arguments.original, arguments.filtered
                )
            )
            return 0
        if arguments.command == "filtered-export-compare":
            _emit(
                compare_inert_qualification_filtered_export(
                    arguments.filtered, arguments.export
                )
            )
            return 0
        if arguments.command == "legacy-save-inspect":
            _emit(
                inspect_inert_qualification_legacy_save(
                    arguments.archive,
                    image_id=arguments.image_id,
                    tag=arguments.tag,
                    diff_id=arguments.diff_id,
                    server_version=arguments.server_version,
                    created=arguments.created,
                    owner=arguments.owner,
                )
            )
            return 0
        raise InspectionRefusal("command_invalid")
    except InspectionIntegrityError as error:
        command = arguments.command if arguments is not None else None
        kind = _qualification_kind(command)
        _emit(
            _qualification_integrity_json(kind, error)
            if kind is not None
            else _integrity_json(error)
        )
        return 3
    except InspectionRefusal as refusal:
        command = arguments.command if arguments is not None else None
        kind = _qualification_kind(command)
        _emit(
            _qualification_refusal_json(kind, refusal)
            if kind is not None
            else _refusal_json(refusal)
        )
        return 2
    except (MemoryError, RecursionError):
        command = arguments.command if arguments is not None else None
        kind = _qualification_kind(command)
        if kind is not None:
            _emit(
                _qualification_integrity_json(
                    kind, InspectionIntegrityError("resource_limit")
                )
            )
            return 3
        _emit(_refusal_json(InspectionRefusal("resource_limit")))
        return 2
    except BaseException:
        command = arguments.command if arguments is not None else None
        kind = _qualification_kind(command)
        if kind is not None:
            _emit(
                _qualification_integrity_json(
                    kind, InspectionIntegrityError("internal_error")
                )
            )
            return 3
        _emit(_refusal_json(InspectionRefusal("internal_error")))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
