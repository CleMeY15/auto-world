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


def _classify_auxiliary_candidates(
    archive: tarfile.TarFile,
    candidates: list[tuple[dict[str, Any], tarfile.TarInfo]],
    config_raw: bytes,
) -> dict[str, Any]:
    count = len(candidates)
    if count > MAX_AUXILIARY_CANDIDATES:
        return _build_auxiliary_diagnostic(
            candidates,
            classification="LIMIT_EXCEEDED",
            first_mismatch="candidate-limit",
            examined_count=0,
            parent_chain_matched=None,
        )
    if count != MAX_AUXILIARY_CANDIDATES:
        return _build_auxiliary_diagnostic(
            candidates,
            classification="REFUSED",
            first_mismatch="cardinality",
            examined_count=0,
            parent_chain_matched=None,
        )

    ordered_candidates = sorted(candidates, key=lambda entry: entry[0]["path"])

    def refused(
        mismatch: str,
        *,
        examined_count: int = 0,
        parent_chain_matched: bool | None = None,
    ) -> dict[str, Any]:
        return _build_auxiliary_diagnostic(
            candidates,
            classification="REFUSED",
            first_mismatch=mismatch,
            examined_count=examined_count,
            parent_chain_matched=parent_chain_matched,
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
        if not (
            required_keys.issubset(value)
            and (value["created"] is None or isinstance(value["created"], str))
            and isinstance(value["container_config"], dict)
            and isinstance(source_os, str)
            and value["os"] == source_os
        ):
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
    return _build_auxiliary_diagnostic(
        candidates,
        classification="COMPATIBLE_UNVERIFIED",
        first_mismatch=None,
        examined_count=examined_count,
        parent_chain_matched=True,
        ordered_nodes=ordered_nodes,
    )


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
) -> tuple[str, list[str], dict[str, Any]]:
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
    if first_extra is not None:
        _raise_envelope_refusal(
            auxiliary_diagnostic=_classify_auxiliary_candidates(
                outer_archive, candidates, config_raw
            ),
            **first_extra,
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
    )


def _inspect_source_save(
    archive_path: str | os.PathLike[str],
    config_path: str | os.PathLike[str],
    *,
    expected_config_sha256: str,
    expected_diff_ids: tuple[str, ...],
    finalize_hook: Any | None = None,
) -> dict[str, Any]:
    _require(HEX64.fullmatch(expected_config_sha256) is not None, "expected_profile_invalid")
    _require(bool(expected_diff_ids) and all(HEX64.fullmatch(value) for value in expected_diff_ids), "expected_profile_invalid")

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
                if set(target) == moby28_keys:
                    config_member, layer_paths, source_envelope = (
                        _inspect_moby28_envelope(
                            outer_archive,
                            by_name,
                            manifest_record,
                            target,
                            config_raw,
                            expected_config_sha256,
                            expected_diff_ids,
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
    )


def inspect_source_save_fixture(
    archive_path: str | os.PathLike[str],
    config_path: str | os.PathLike[str],
    expected_config_sha256: str,
    expected_diff_ids: Iterable[str],
    *,
    finalize_hook: Any | None = None,
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
    )


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
    try:
        arguments = parser.parse_args(argv)
        _activate_cli_limits()
        if arguments.command == "source-save":
            _emit(inspect_source_save(arguments.archive, arguments.config))
            return 0
        raise InspectionRefusal("command_invalid")
    except InspectionIntegrityError as error:
        _emit(_integrity_json(error))
        return 3
    except InspectionRefusal as refusal:
        _emit(_refusal_json(refusal))
        return 2
    except (MemoryError, RecursionError):
        _emit(_refusal_json(InspectionRefusal("resource_limit")))
        return 2
    except BaseException:
        _emit(_refusal_json(InspectionRefusal("internal_error")))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
