import { createHash } from "node:crypto";
import path from "node:path";

const KiB = 1024;
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const SOURCE_ARCHIVE_LIMIT = 2 * GiB;
const QUALIFICATION_SCRATCH = 64 * MiB;
const PUBLIC_EVIDENCE = 64 * MiB;
const FREE_RESERVE = GiB;
const SOURCE_MANIFEST = "sha256:3a522c379599e163433a636e75022630848b63a74f08ea37bf06f8d776e9a707";
const SOURCE_CONFIG = "sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6";
const SOURCE_REFERENCE = `chrislusf/seaweedfs@${SOURCE_MANIFEST}`;
const SOURCE_INDEX = "sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8";
const SOURCE_COMMIT = "ffa87c25fdf587178b1521ad87f2a4a72a02e584";
const APPROVED_PLAN = "b1e88e79f2c07411e97553383ae5c6ac9c949fcfaf89420684dff9a742e51990";
const SOURCE_DIFF_IDS = Object.freeze([
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
]);
const AUXILIARY_PAYLOAD_SHA256S = Object.freeze([
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
]);
const AUXILIARY_PAYLOAD_BYTES = Object.freeze([401, 477, 477, 477, 477, 477, 477, 477, 477, 1696]);
const AUXILIARY_V1_IDS = Object.freeze([
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
]);
const AUXILIARY_KEY_SET_SHA256S = Object.freeze([
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
]);
const AUXILIARY_CANDIDATE_SET_SHA256 = "3952537ce5e96cc1782f21c9dfc8ac8c000f6451a7cf399e7beeb9eb80b11a5e";
const AUXILIARY_ORDERED_SET_SHA256 = "4ef427670dac48137a29c82eb56b679a0c42f662013b5834209a9fe96306f39a";
const SOURCE_REFUSALS = new Set([
  "archive_empty", "archive_extension_unsupported", "archive_hidden_region", "archive_invalid", "archive_nonzero_padding", "archive_nonzero_tail",
  "archive_seek_unsupported", "archive_size_limit", "archive_size_mismatch", "archive_truncated", "arguments_invalid", "command_invalid",
  "duplicate_member", "expected_profile_invalid", "fractional_mtime", "hardlink_unsupported", "identity_invalid", "input_identity_mismatch",
  "input_link_count_invalid", "input_not_readonly", "input_open_failed", "input_owner_invalid", "input_path_invalid", "input_size_limit",
  "input_type_invalid", "json_limit", "layer_digest_mismatch", "layer_total_size_limit", "member_limit", "member_size_limit", "mode_invalid",
  "nonfile_size", "output_limit", "owner_name_unsupported", "path_invalid", "pax_unsupported", "resource_limit", "resource_limits_unavailable",
  "save_config_mismatch", "save_config_missing", "save_config_reference_invalid", "save_layer_invalid", "save_layer_missing",
  "save_envelope_invalid", "save_layer_reference_invalid", "save_manifest_invalid", "save_manifest_missing", "save_metadata_invalid", "save_repo_tags_invalid", "save_unreferenced_member",
  "save_repositories_invalid", "source_config_diffids_mismatch", "source_config_invalid", "source_config_mismatch",
  "sparse_unsupported", "special_type_unsupported", "symlink_target_invalid", "whiteout_invalid", "whiteout_unsupported",
]);
const sourceRefusalDetails = new WeakMap();
const sourceRefusalReceipts = new WeakMap();
const MANIFEST_KEYS = Object.freeze(["Config", "LayerSources", "Layers", "Parent", "RepoTags"]);
const JSON_TAGS = new Set(["array", "object", "string", "number", "boolean", "null"]);
const ENVELOPE_KEYS = Object.freeze(["annotations", "artifactType", "config", "data", "digest", "imageLayoutVersion", "layers",
  "manifests", "mediaType", "platform", "schemaVersion", "size", "subject", "urls"]);
const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const digest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const absolute = (value) => typeof value === "string" && path.isAbsolute(value) && !/[\0\r\n]/u.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));

export const SEAWEED_GO_S3_SOURCE = Object.freeze({
  repository: "chrislusf/seaweedfs",
  reference: SOURCE_REFERENCE,
  manifestDigest: SOURCE_MANIFEST,
  configDigest: SOURCE_CONFIG,
  platform: "linux/amd64",
});

export function validateSeaweedGoS3Profile(value) {
  const helperPins = [
    ["usr/bin/weed-volume", 40128576, "48c7397e7d1802d9728ac7bdfcf30454cb6fb50bb0098b79e88f9b3eaeddc3e4"],
    ["usr/bin/weed-worker", 252992824, "2f7bd0db4811d463f4fc7278d2a6a336e1adfcb54124ecc79b67dbcab0ba149b"],
  ];
  if (!exactKeys(value, ["schemaVersion", "profile", "state", "admission", "milestone2", "source", "unsupportedHelpers", "support", "approvedPlanSha256"]) ||
      value.schemaVersion !== 1 || value.profile !== "go-s3-4.51-v1" || value.state !== "SOURCE_PREFLIGHT_ONLY" ||
      value.admission !== "NOT_AUTHORIZED" || value.milestone2 !== "NOT_ESTABLISHED" || value.approvedPlanSha256 !== APPROVED_PLAN ||
      !exactKeys(value.source, ["repository", "indexDigest", "platformDigest", "configSha256", "configBytes", "os", "architecture", "commit", "diffIds"]) ||
      value.source.repository !== "chrislusf/seaweedfs" || value.source.indexDigest !== SOURCE_INDEX || value.source.platformDigest !== SOURCE_MANIFEST ||
      value.source.configSha256 !== SOURCE_CONFIG.slice(7) || value.source.configBytes !== 13850 || value.source.os !== "linux" ||
      value.source.architecture !== "amd64" || value.source.commit !== SOURCE_COMMIT || !Array.isArray(value.source.diffIds) ||
      value.source.diffIds.length !== SOURCE_DIFF_IDS.length || value.source.diffIds.some((entry, index) => entry !== `sha256:${SOURCE_DIFF_IDS[index]}`) ||
      !Array.isArray(value.unsupportedHelpers) || value.unsupportedHelpers.length !== helperPins.length || value.unsupportedHelpers.some((entry, index) =>
        !exactKeys(entry, ["path", "bytes", "mode", "sha256"]) || entry.path !== helperPins[index][0] || entry.bytes !== helperPins[index][1] ||
        entry.mode !== "0755" || entry.sha256 !== helperPins[index][2]) ||
      !exactKeys(value.support, ["durationYears", "continuousSecurityControls", "additionalArchiveDays", "startsAt", "endsAt"]) ||
      value.support.durationYears !== 1 || value.support.continuousSecurityControls !== true || value.support.additionalArchiveDays !== 365 ||
      value.support.startsAt !== null || value.support.endsAt !== null) fail("scanner_seaweed_go_s3_profile_invalid");
  return clone(value);
}

export function seaweedGoS3ResourceRequirements({ sameFilesystem = false } = {}) {
  if (typeof sameFilesystem !== "boolean") fail("scanner_seaweed_go_s3_resources_invalid");
  const scratchTaskBytes = 4 * SOURCE_ARCHIVE_LIMIT + QUALIFICATION_SCRATCH + PUBLIC_EVIDENCE;
  const dockerTaskBytes = 2 * SOURCE_ARCHIVE_LIMIT + QUALIFICATION_SCRATCH;
  const reserve = (bytes) => Math.ceil(bytes * 1.25) + FREE_RESERVE;
  return Object.freeze({
    archiveLimitBytes: SOURCE_ARCHIVE_LIMIT,
    qualificationScratchBytes: QUALIFICATION_SCRATCH,
    publicEvidenceBytes: PUBLIC_EVIDENCE,
    freeReserveBytes: FREE_RESERVE,
    scratchTaskBytes,
    dockerTaskBytes,
    scratchRequiredFreeBytes: sameFilesystem ? null : reserve(scratchTaskBytes),
    dockerRequiredFreeBytes: sameFilesystem ? null : reserve(dockerTaskBytes),
    combinedRequiredFreeBytes: sameFilesystem ? reserve(scratchTaskBytes + dockerTaskBytes) : null,
  });
}

export function seaweedGoS3DockerInfoArguments() {
  return ["info", "--format", "{{json .}}"];
}

export function seaweedGoS3DockerVersionArguments() {
  return ["version", "--format", "{{json .}}"];
}

export function seaweedGoS3PythonVersionArguments() {
  return ["--version"];
}

export function seaweedGoS3GnuTarVersionArguments() {
  return ["--version"];
}

export function seaweedGoS3SourceSaveArguments({ archive, imageId }) {
  if (!absolute(archive) || !digest(imageId)) fail("scanner_seaweed_go_s3_source_save_invalid");
  const script = [
    "set -euo pipefail",
    `ulimit -Sf ${SOURCE_ARCHIVE_LIMIT / KiB}`,
    "exec /usr/bin/docker image save --output \"$1\" \"$2\"",
  ].join("\n");
  return Object.freeze({
    command: "/usr/bin/bash",
    args: ["--noprofile", "--norc", "-c", script, "aw-seaweed-go-s3-source-save", archive, imageId],
    timeoutMs: 300_000,
    archiveLimitBytes: SOURCE_ARCHIVE_LIMIT,
  });
}

export function seaweedGoS3SourceInspectorArguments({ python, inspector, archive, config }) {
  if (!absolute(python) || !absolute(inspector) || !absolute(archive) || !absolute(config)) {
    fail("scanner_seaweed_go_s3_source_inspector_invalid");
  }
  return Object.freeze({ command: python,
    args: [inspector, "source-save", "--archive", archive, "--config", config], timeoutMs: 300_000 });
}

export function validateSeaweedGoS3ToolEvidence(value) {
  if (!exactKeys(value, ["docker", "python", "gnuTar"]) ||
      !exactKeys(value.docker, ["clientVersion", "serverVersion", "apiVersion", "dockerRootDir", "operatingSystem", "architecture"]) ||
      value.docker.clientVersion !== "28.0.4" || value.docker.serverVersion !== "28.0.4" || value.docker.apiVersion !== "1.48" ||
      !absolute(value.docker.dockerRootDir) || typeof value.docker.operatingSystem !== "string" || !/linux/iu.test(value.docker.operatingSystem) ||
      !["x86_64", "amd64"].includes(value.docker.architecture) ||
      !exactKeys(value.python, ["version"]) || typeof value.python.version !== "string" ||
      !/^Python (?:3\.(?:1[2-9]|[2-9][0-9])|[4-9][0-9])\.[0-9]+$/u.test(value.python.version.trim()) ||
      !exactKeys(value.gnuTar, ["version"]) || typeof value.gnuTar.version !== "string" ||
      !/^tar \(GNU tar\) [1-9][0-9]*\.[0-9]+/u.test(value.gnuTar.version.trim())) {
    fail("scanner_seaweed_go_s3_tool_evidence_invalid");
  }
  return clone(value);
}

export function validateSeaweedGoS3FilesystemEvidence(value) {
  if (!exactKeys(value, ["scratch", "docker"]) ||
      [value.scratch, value.docker].some((entry) => !exactKeys(entry, ["path", "filesystemId", "freeBytes"]) ||
        !absolute(entry.path) || typeof entry.filesystemId !== "string" || entry.filesystemId.length < 1 || entry.filesystemId.length > 256 ||
        !positiveInteger(entry.freeBytes))) fail("scanner_seaweed_go_s3_filesystem_invalid");
  const sameFilesystem = value.scratch.filesystemId === value.docker.filesystemId;
  const requirements = seaweedGoS3ResourceRequirements({ sameFilesystem });
  if (sameFilesystem ? Math.min(value.scratch.freeBytes, value.docker.freeBytes) < requirements.combinedRequiredFreeBytes
    : value.scratch.freeBytes < requirements.scratchRequiredFreeBytes || value.docker.freeBytes < requirements.dockerRequiredFreeBytes) {
    fail("scanner_seaweed_go_s3_disk_insufficient");
  }
  return { sameFilesystem, requirements, scratch: { ...value.scratch }, docker: { ...value.docker } };
}

export function validateSeaweedGoS3SourceInspection(value, expected = {}) {
  const hasSourceEnvelope = Object.hasOwn(value ?? {}, "sourceEnvelope");
  const hasAuxiliaryEnvelope = Object.hasOwn(value ?? {}, "auxiliaryEnvelope");
  const safeLayerPath = (candidate) => typeof candidate === "string" && candidate.length >= 11 && candidate.length <= 1024 &&
    !candidate.startsWith("/") && !candidate.includes("\\") && !candidate.split("/").some((part) => !part || part === "." || part === "..") &&
    candidate.endsWith("/layer.tar");
  if (!exactKeys(value, ["schemaVersion", "profile", "evidenceClass", "status", "sourceConfigSha256", "archive", "layers", "totals",
    ...(hasSourceEnvelope ? ["sourceEnvelope"] : []), ...(hasAuxiliaryEnvelope ? ["auxiliaryEnvelope"] : [])]) ||
      Buffer.byteLength(JSON.stringify(value)) > 4 * MiB || value.schemaVersion !== 1 || value.profile !== "go-s3-4.51-v1" ||
      value.evidenceClass !== "SOURCE_LAYER_PREFLIGHT" || value.status !== "PASS" || value.sourceConfigSha256 !== SOURCE_CONFIG.slice(7) ||
      hasSourceEnvelope !== hasAuxiliaryEnvelope ||
      !exactKeys(value.archive, ["sha256", "bytes"]) || !sha256(value.archive.sha256) || !positiveInteger(value.archive.bytes) ||
      value.archive.bytes > SOURCE_ARCHIVE_LIMIT || !Array.isArray(value.layers) || value.layers.length !== 10 ||
      value.layers.some((layer, index) => !exactKeys(layer, ["ordinal", "path", "sha256", "bytes", "memberCount", "metadataSha256", "inventorySha256"]) ||
        layer.ordinal !== index + 1 || (hasSourceEnvelope ? layer.path !== `blobs/sha256/${SOURCE_DIFF_IDS[index]}` : !safeLayerPath(layer.path)) ||
        layer.sha256 !== SOURCE_DIFF_IDS[index] || !positiveInteger(layer.bytes) ||
        !Number.isSafeInteger(layer.memberCount) || layer.memberCount < 0 || layer.memberCount > 4096 || !sha256(layer.metadataSha256) || !sha256(layer.inventorySha256)) ||
      !exactKeys(value.totals, ["layerCount", "layerBytes", "memberCount"]) || value.totals.layerCount !== 10 ||
      !positiveInteger(value.totals.layerBytes) || value.totals.layerBytes > SOURCE_ARCHIVE_LIMIT || !positiveInteger(value.totals.memberCount) ||
      value.totals.memberCount > 32768 || value.totals.layerBytes !== value.layers.reduce((sum, layer) => sum + layer.bytes, 0) ||
      value.totals.memberCount !== value.layers.reduce((sum, layer) => sum + layer.memberCount, 0) ||
      expected.archiveSha256 !== undefined && value.archive.sha256 !== expected.archiveSha256 ||
      expected.archiveBytes !== undefined && value.archive.bytes !== expected.archiveBytes) {
    fail("scanner_seaweed_go_s3_source_preflight_refused");
  }
  if (hasSourceEnvelope) validateSeaweedGoS3SourceEnvelope(value.sourceEnvelope);
  if (hasAuxiliaryEnvelope) validateSeaweedGoS3AuxiliaryEnvelope(value.auxiliaryEnvelope);
  return clone(value);
}

export function validateSeaweedGoS3SourceEnvelope(value) {
  if (!exactKeys(value, ["schemaVersion", "kind", "manifestSha256", "layoutSha256", "indexSha256", "ociManifestSha256",
    "descriptorCount", "rawLayerDescriptorsMatched"]) || value.schemaVersion !== 1 || value.kind !== "MOBY_28_OCI_COMPAT_V1" ||
      !sha256(value.manifestSha256) || !sha256(value.layoutSha256) || !sha256(value.indexSha256) || !sha256(value.ociManifestSha256) ||
      value.descriptorCount !== 10 || value.rawLayerDescriptorsMatched !== true) {
    fail("scanner_seaweed_go_s3_source_envelope_invalid");
  }
  return clone(value);
}

export function validateSeaweedGoS3AuxiliaryEnvelope(value) {
  const keys = ["schemaVersion", "kind", "createIdBinding", "auxiliaryToRawLayerBinding", "candidateCount", "candidateBytes",
    "candidateSetSha256", "payloadSha256s", "payloadBytes", "v1Ids", "keySetSha256s", "orderedSetSha256",
    "semanticProjectionMatched"];
  const arrays = [value?.payloadSha256s, value?.payloadBytes, value?.v1Ids, value?.keySetSha256s];
  if (!exactKeys(value, keys) || value.schemaVersion !== 1 || value.kind !== "MOBY_28_V1_AUXILIARY_FIXED_SOURCE_V1" ||
      value.createIdBinding !== "NOT_RECOMPUTED" || value.auxiliaryToRawLayerBinding !== "NOT_INDEPENDENTLY_VERIFIED" ||
      value.candidateCount !== 10 || value.candidateBytes !== 5913 || value.candidateSetSha256 !== AUXILIARY_CANDIDATE_SET_SHA256 ||
      value.orderedSetSha256 !== AUXILIARY_ORDERED_SET_SHA256 || value.semanticProjectionMatched !== true ||
      arrays.some((entries) => !Array.isArray(entries) || entries.length !== 10 || Object.keys(entries).length !== 10) ||
      value.payloadSha256s.some((entry, index) => entry !== AUXILIARY_PAYLOAD_SHA256S[index]) ||
      value.payloadBytes.some((entry, index) => entry !== AUXILIARY_PAYLOAD_BYTES[index]) ||
      value.v1Ids.some((entry, index) => entry !== AUXILIARY_V1_IDS[index]) ||
      value.keySetSha256s.some((entry, index) => entry !== AUXILIARY_KEY_SET_SHA256S[index]) ||
      value.payloadBytes.reduce((sum, entry) => sum + entry, 0) !== value.candidateBytes) {
    fail("scanner_seaweed_go_s3_auxiliary_envelope_invalid");
  }
  const candidates = value.payloadSha256s.map((payloadSha256, index) => ({ path: `blobs/sha256/${payloadSha256}`,
    payloadSha256, size: value.payloadBytes[index], type: "file" })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const candidateSetSha256 = createHash("sha256").update(JSON.stringify(candidates), "ascii").digest("hex");
  const ordered = value.payloadSha256s.map((payloadSha256, index) => ({ bytes: value.payloadBytes[index], id: value.v1Ids[index],
    keySetSha256: value.keySetSha256s[index], parent: index === 0 ? null : value.v1Ids[index - 1], payloadSha256 }));
  const orderedSetSha256 = createHash("sha256").update(JSON.stringify(ordered), "ascii").digest("hex");
  if (candidateSetSha256 !== value.candidateSetSha256 || orderedSetSha256 !== value.orderedSetSha256) {
    fail("scanner_seaweed_go_s3_auxiliary_envelope_invalid");
  }
  return clone(value);
}

export function validateSeaweedGoS3EnvelopeDiagnostic(value) {
  const nullableCount = (candidate, maximum) => candidate === null || Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= maximum;
  const diagnosticKeys = ["schemaVersion", "format", "node", "predicate", "ordinal", "observedType", "memberType", "expectedDigest",
    "actualDigest", "expectedBytes", "actualBytes", "knownKeysPresent", "unknownKeyCount", "unknownKeyNamesSha256", "mediaTypeClass",
    "mediaTypeSha256"];
  if (!exactKeys(value, diagnosticKeys) || Buffer.byteLength(JSON.stringify(value)) > 2 * KiB || value.schemaVersion !== 1 ||
      value.format !== "MOBY_28_OCI_COMPAT_V1" ||
      !["layout", "index", "oci-manifest", "config", "layer-source", "raw-layer", "auxiliary", "outer"].includes(value.node) ||
      !["json", "type", "keys", "media-type", "digest", "size", "member", "cardinality", "ordinal", "extra"].includes(value.predicate) ||
      value.ordinal !== null && (!Number.isSafeInteger(value.ordinal) || value.ordinal < 1 || value.ordinal > 10) ||
      value.observedType !== null && !JSON_TAGS.has(value.observedType) ||
      ![null, "file", "directory", "symlink"].includes(value.memberType) ||
      value.expectedDigest !== null && !sha256(value.expectedDigest) || value.actualDigest !== null && !sha256(value.actualDigest) ||
      !nullableCount(value.expectedBytes, SOURCE_ARCHIVE_LIMIT) || !nullableCount(value.actualBytes, SOURCE_ARCHIVE_LIMIT) ||
      !Array.isArray(value.knownKeysPresent) || value.knownKeysPresent.some((entry) => !ENVELOPE_KEYS.includes(entry)) ||
      value.knownKeysPresent.some((entry, index) => index > 0 && value.knownKeysPresent[index - 1] >= entry) ||
      !nullableCount(value.unknownKeyCount, 4 * MiB) ||
      value.unknownKeyNamesSha256 !== null && !sha256(value.unknownKeyNamesSha256) ||
      (value.unknownKeyCount === null) !== (value.unknownKeyNamesSha256 === null) ||
      ![null, "oci-index", "oci-manifest", "oci-config", "oci-tar", "other"].includes(value.mediaTypeClass) ||
      value.mediaTypeSha256 !== null && !sha256(value.mediaTypeSha256) ||
      value.mediaTypeClass === null && value.mediaTypeSha256 !== null ||
      ![null, "other"].includes(value.mediaTypeClass) && value.mediaTypeSha256 === null) {
    fail("scanner_seaweed_go_s3_envelope_diagnostic_invalid");
  }
  return clone(value);
}

export function validateSeaweedGoS3AuxiliaryDiagnostic(value) {
  const keys = ["schemaVersion", "kind", "createIdBinding", "candidateCount", "candidateBytes", "candidateSetSha256", "truncated",
    "examinedCount", "classification", "firstMismatch", "payloadSha256s", "payloadBytes", "v1Ids", "keySetSha256s",
    "parentChainMatched", "orderedSetSha256"];
  const mismatches = ["cardinality", "candidate-limit", "member", "path", "digest", "size", "total-size", "json", "root-type",
    "keys", "required-fields", "id", "parent", "duplicate-id", "root-count", "orphan", "branch", "cycle"];
  if (!exactKeys(value, keys) || Buffer.byteLength(JSON.stringify(value)) > 8 * KiB || value.schemaVersion !== 1 ||
      value.kind !== "MOBY_28_V1_AUXILIARY_DIAGNOSTIC" || value.createIdBinding !== "NOT_RECOMPUTED" ||
      !Number.isSafeInteger(value.candidateCount) || value.candidateCount < 1 || value.candidateCount > 4096 ||
      !Number.isSafeInteger(value.candidateBytes) || value.candidateBytes < 0 || value.candidateBytes > SOURCE_ARCHIVE_LIMIT ||
      !sha256(value.candidateSetSha256) || typeof value.truncated !== "boolean" || value.truncated !== (value.candidateCount > 10) ||
      !Number.isSafeInteger(value.examinedCount) || value.examinedCount < 0 || value.examinedCount > 10 ||
      value.examinedCount > value.candidateCount ||
      !["COMPATIBLE_UNVERIFIED", "REFUSED", "LIMIT_EXCEEDED"].includes(value.classification) ||
      value.firstMismatch !== null && !mismatches.includes(value.firstMismatch) ||
      !Array.isArray(value.payloadSha256s) || !Array.isArray(value.payloadBytes) || !Array.isArray(value.v1Ids) ||
      !Array.isArray(value.keySetSha256s) || ![null, false, true].includes(value.parentChainMatched) ||
      value.orderedSetSha256 !== null && !sha256(value.orderedSetSha256)) {
    fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
  }
  const arrays = [value.payloadSha256s, value.payloadBytes, value.v1Ids, value.keySetSha256s];
  if (arrays.some((entries) => Object.keys(entries).length !== entries.length)) {
    fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
  }
  if (value.classification === "COMPATIBLE_UNVERIFIED") {
    if (value.candidateCount !== 10 || value.candidateBytes > 262_144 || value.truncated || value.examinedCount !== 10 ||
        value.firstMismatch !== null || value.parentChainMatched !== true || !sha256(value.orderedSetSha256) ||
        arrays.some((entries) => entries.length !== 10) ||
        [value.payloadSha256s, value.v1Ids, value.keySetSha256s].some((entries) => entries.some((entry) => !sha256(entry))) ||
        value.payloadBytes.some((entry) => !Number.isSafeInteger(entry) || entry < 1 || entry > 65_536) ||
        new Set(value.payloadSha256s).size !== 10 || new Set(value.v1Ids).size !== 10 ||
        value.payloadBytes.reduce((sum, entry) => sum + entry, 0) !== value.candidateBytes) {
      fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
    }
    const ordered = value.payloadSha256s.map((payloadSha256, index) => ({ bytes: value.payloadBytes[index], id: value.v1Ids[index],
      keySetSha256: value.keySetSha256s[index], parent: index === 0 ? null : value.v1Ids[index - 1], payloadSha256 }));
    const orderedSetSha256 = createHash("sha256").update(JSON.stringify(ordered), "ascii").digest("hex");
    if (orderedSetSha256 !== value.orderedSetSha256) fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
    return clone(value);
  }
  if (arrays.some((entries) => entries.length !== 0) || value.orderedSetSha256 !== null || value.firstMismatch === null) {
    fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
  }
  if (value.classification === "LIMIT_EXCEEDED") {
    if (value.candidateCount <= 10 || value.firstMismatch !== "candidate-limit" || value.examinedCount !== 0 ||
        value.parentChainMatched !== null) fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
    return clone(value);
  }
  if (value.candidateCount < 10) {
    if (value.firstMismatch !== "cardinality" || value.examinedCount !== 0 || value.parentChainMatched !== null) {
      fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
    }
    return clone(value);
  }
  if (value.candidateCount !== 10 || ["cardinality", "candidate-limit"].includes(value.firstMismatch)) {
    fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
  }
  const beforeParse = ["member", "path", "digest", "size", "total-size"];
  const duringParse = ["json", "root-type", "keys", "required-fields", "id", "parent"];
  const chain = ["root-count", "orphan", "branch", "cycle"];
  if (beforeParse.includes(value.firstMismatch)) {
    if (value.examinedCount !== 0 || value.parentChainMatched !== null ||
        value.firstMismatch === "total-size" && (value.candidateBytes <= 262_144 || value.candidateBytes > 10 * 65_536)) {
      fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
    }
  } else if (duringParse.includes(value.firstMismatch)) {
    if (value.examinedCount < 1 || value.parentChainMatched !== null || value.candidateBytes < 10 || value.candidateBytes > 262_144) {
      fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
    }
  } else if (value.firstMismatch === "duplicate-id") {
    if (value.examinedCount !== 10 || value.parentChainMatched !== null || value.candidateBytes < 10 || value.candidateBytes > 262_144) {
      fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
    }
  } else if (chain.includes(value.firstMismatch)) {
    if (value.examinedCount !== 10 || value.parentChainMatched !== false || value.candidateBytes < 10 || value.candidateBytes > 262_144) {
      fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
    }
  } else {
    fail("scanner_seaweed_go_s3_auxiliary_diagnostic_invalid");
  }
  return clone(value);
}

export function validateSeaweedGoS3ManifestDiagnostic(value) {
  const nullableTag = (candidate) => candidate === null || JSON_TAGS.has(candidate);
  const nullableCount = (candidate) => candidate === null || Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= 4 * MiB;
  const manifestKeys = ["present", "memberType", "byteCount", "sha256", "jsonState", "rootType", "recordCount", "firstRecordType",
    "knownKeysPresent", "knownValueTypes", "unknownKeyCount", "unknownKeyNamesSha256", "configPathCategory", "layersCount",
    "layerPathCounts", "repoTagsType", "repoTagsCount", "parentType", "layerSourcesType", "layerSourcesCount"];
  if (!exactKeys(value, ["schemaVersion", "outer", "manifest"]) || Buffer.byteLength(JSON.stringify(value)) > 2 * KiB ||
      value.schemaVersion !== 1 || !exactKeys(value.outer, ["ociLayoutPresent", "indexJsonPresent", "repositoriesPresent", "blobsPrefixPresent"]) ||
      Object.values(value.outer).some((entry) => typeof entry !== "boolean") || !exactKeys(value.manifest, manifestKeys)) {
    fail("scanner_seaweed_go_s3_manifest_diagnostic_invalid");
  }
  const manifest = value.manifest;
  if (typeof manifest.present !== "boolean" || ![null, "file", "directory", "symlink"].includes(manifest.memberType) ||
      !nullableCount(manifest.byteCount) || manifest.byteCount !== null && manifest.byteCount > 4 * MiB ||
      manifest.sha256 !== null && !sha256(manifest.sha256) || !["not-observed", "invalid", "valid"].includes(manifest.jsonState) ||
      !nullableTag(manifest.rootType) || !nullableCount(manifest.recordCount) || !nullableTag(manifest.firstRecordType) ||
      !Array.isArray(manifest.knownKeysPresent) || manifest.knownKeysPresent.some((entry) => !MANIFEST_KEYS.includes(entry)) ||
      manifest.knownKeysPresent.some((entry, index) => index > 0 && manifest.knownKeysPresent[index - 1] >= entry) ||
      !exactKeys(manifest.knownValueTypes, MANIFEST_KEYS) || Object.values(manifest.knownValueTypes).some((entry) => !nullableTag(entry)) ||
      !nullableCount(manifest.unknownKeyCount) || manifest.unknownKeyNamesSha256 !== null && !sha256(manifest.unknownKeyNamesSha256) ||
      ![null, "absent", "legacy-config", "oci-blob", "other"].includes(manifest.configPathCategory) ||
      !nullableCount(manifest.layersCount) || manifest.layerPathCounts !== null &&
        (!exactKeys(manifest.layerPathCounts, ["legacyLayer", "ociBlob", "other"]) ||
          Object.values(manifest.layerPathCounts).some((entry) => !nullableCount(entry) || entry === null)) ||
      !nullableTag(manifest.repoTagsType) || !nullableCount(manifest.repoTagsCount) || !nullableTag(manifest.parentType) ||
      !nullableTag(manifest.layerSourcesType) || !nullableCount(manifest.layerSourcesCount)) {
    fail("scanner_seaweed_go_s3_manifest_diagnostic_invalid");
  }
  const noRecordObservation = manifest.knownKeysPresent.length === 0 && Object.values(manifest.knownValueTypes).every((entry) => entry === null) &&
    manifest.unknownKeyCount === null && manifest.unknownKeyNamesSha256 === null && manifest.configPathCategory === null &&
    manifest.layersCount === null && manifest.layerPathCounts === null && manifest.repoTagsType === null && manifest.repoTagsCount === null &&
    manifest.parentType === null && manifest.layerSourcesType === null && manifest.layerSourcesCount === null;
  const noJsonObservation = manifest.rootType === null && manifest.recordCount === null && manifest.firstRecordType === null && noRecordObservation;
  const readableFile = manifest.memberType === "file" && manifest.byteCount !== null && manifest.sha256 !== null;
  if (!manifest.present && (manifest.memberType !== null || manifest.byteCount !== null || manifest.sha256 !== null ||
        manifest.jsonState !== "not-observed" || !noJsonObservation) ||
      manifest.present && ["directory", "symlink"].includes(manifest.memberType) &&
        (manifest.byteCount !== null || manifest.sha256 !== null || manifest.jsonState !== "not-observed" || !noJsonObservation) ||
      manifest.present && manifest.memberType === null ||
      manifest.memberType === "file" && !readableFile &&
        (manifest.byteCount !== null || manifest.sha256 !== null || manifest.jsonState !== "not-observed" || !noJsonObservation) ||
      readableFile && manifest.jsonState === "not-observed" ||
      manifest.jsonState === "invalid" && (!readableFile || !noJsonObservation) ||
      manifest.jsonState === "valid" && (!readableFile || manifest.rootType === null) ||
      manifest.jsonState !== "valid" && !noJsonObservation) {
    fail("scanner_seaweed_go_s3_manifest_diagnostic_invalid");
  }
  if (manifest.jsonState === "valid") {
    const arrayRoot = manifest.rootType === "array";
    if (arrayRoot !== (manifest.recordCount !== null) ||
        (manifest.recordCount === null || manifest.recordCount === 0) !== (manifest.firstRecordType === null)) {
      fail("scanner_seaweed_go_s3_manifest_diagnostic_invalid");
    }
    const recordObject = arrayRoot && manifest.recordCount > 0 && manifest.firstRecordType === "object";
    if (!recordObject && !noRecordObservation) fail("scanner_seaweed_go_s3_manifest_diagnostic_invalid");
    if (recordObject) {
      const present = new Set(manifest.knownKeysPresent);
      const layersArray = manifest.knownValueTypes.Layers === "array";
      if (MANIFEST_KEYS.some((key) => present.has(key) !== (manifest.knownValueTypes[key] !== null)) ||
          manifest.unknownKeyCount === null || manifest.unknownKeyNamesSha256 === null || manifest.configPathCategory === null ||
          (present.has("Config") ? manifest.configPathCategory === "absent" : manifest.configPathCategory !== "absent") ||
          present.has("Config") && manifest.knownValueTypes.Config !== "string" && manifest.configPathCategory !== "other" ||
          manifest.repoTagsType !== manifest.knownValueTypes.RepoTags ||
          (manifest.repoTagsType === "array") !== (manifest.repoTagsCount !== null) ||
          manifest.parentType !== manifest.knownValueTypes.Parent ||
          manifest.layerSourcesType !== manifest.knownValueTypes.LayerSources ||
          (["array", "object"].includes(manifest.layerSourcesType)) !== (manifest.layerSourcesCount !== null) ||
          layersArray !== (manifest.layersCount !== null) || layersArray !== (manifest.layerPathCounts !== null) ||
          layersArray && manifest.layersCount !== Object.values(manifest.layerPathCounts).reduce((sum, count) => sum + count, 0)) {
        fail("scanner_seaweed_go_s3_manifest_diagnostic_invalid");
      }
    }
  }
  return clone(value);
}

export function validateSeaweedGoS3SourceRefusal(value) {
  const hasManifestDiagnostic = Object.hasOwn(value ?? {}, "manifestDiagnostic");
  const hasEnvelopeDiagnostic = Object.hasOwn(value ?? {}, "envelopeDiagnostic");
  const hasAuxiliaryDiagnostic = Object.hasOwn(value ?? {}, "auxiliaryDiagnostic");
  const keys = ["schemaVersion", "profile", "evidenceClass", "status", "refusal", ...(hasManifestDiagnostic ? ["manifestDiagnostic"] : []),
    ...(hasEnvelopeDiagnostic ? ["envelopeDiagnostic"] : []), ...(hasAuxiliaryDiagnostic ? ["auxiliaryDiagnostic"] : [])];
  const safeMember = (candidate) => typeof candidate === "string" && candidate.length >= 1 && candidate.length <= 1024 &&
    !candidate.startsWith("/") && !candidate.includes("\\") && !candidate.split("/").some((part) => !part || part === "." || part === "..");
  if (!exactKeys(value, keys) || Buffer.byteLength(JSON.stringify(value)) > 4 * MiB || value.schemaVersion !== 1 ||
      value.profile !== "go-s3-4.51-v1" || value.evidenceClass !== "SOURCE_LAYER_PREFLIGHT" || value.status !== "REFUSED" ||
      !value.refusal || typeof value.refusal !== "object" || Array.isArray(value.refusal) ||
      !SOURCE_REFUSALS.has(value.refusal.code) ||
      Object.keys(value.refusal).some((key) => !["code", "layerOrdinal", "member", "memberSha256"].includes(key)) ||
      Object.hasOwn(value.refusal, "layerOrdinal") && (!Number.isSafeInteger(value.refusal.layerOrdinal) || value.refusal.layerOrdinal < 1 || value.refusal.layerOrdinal > 10) ||
      Object.hasOwn(value.refusal, "member") && !safeMember(value.refusal.member) ||
      Object.hasOwn(value.refusal, "memberSha256") && !sha256(value.refusal.memberSha256) ||
      Object.hasOwn(value.refusal, "member") && Object.hasOwn(value.refusal, "memberSha256") ||
      hasManifestDiagnostic && !["save_manifest_missing", "save_manifest_invalid"].includes(value.refusal.code) ||
      hasEnvelopeDiagnostic && value.refusal.code !== "save_envelope_invalid" || hasManifestDiagnostic && hasEnvelopeDiagnostic ||
      hasAuxiliaryDiagnostic && (value.refusal.code !== "save_envelope_invalid" || !hasEnvelopeDiagnostic || hasManifestDiagnostic)) {
    fail("scanner_seaweed_go_s3_source_refusal_invalid");
  }
  if (hasManifestDiagnostic) validateSeaweedGoS3ManifestDiagnostic(value.manifestDiagnostic);
  if (hasEnvelopeDiagnostic) validateSeaweedGoS3EnvelopeDiagnostic(value.envelopeDiagnostic);
  if (hasAuxiliaryDiagnostic) {
    if (value.envelopeDiagnostic.node !== "outer" || value.envelopeDiagnostic.predicate !== "extra") {
      fail("scanner_seaweed_go_s3_source_refusal_invalid");
    }
    validateSeaweedGoS3AuxiliaryDiagnostic(value.auxiliaryDiagnostic);
  }
  return clone(value);
}

export function seaweedGoS3SourceRefusalError(value) {
  const error = new Error("scanner_seaweed_go_s3_source_preflight_refused");
  sourceRefusalDetails.set(error, validateSeaweedGoS3SourceRefusal(value));
  return error;
}

export function seaweedGoS3SourceRefusalReceipt(error) {
  const receipt = sourceRefusalReceipts.get(error);
  return receipt ? clone(receipt) : null;
}

export function validateSeaweedGoS3SourceRefusalReceipt(value) {
  if (!exactKeys(value, ["schemaVersion", "kind", "state", "authority", "construction", "source", "tools", "resources", "archive", "refusal", "sourceUnchanged", "archiveRemoved"]) ||
      value.schemaVersion !== 1 || value.kind !== "SEAWEED_GO_S3_SOURCE_PREFLIGHT_V1" || value.state !== "SOURCE_PREFLIGHT_REFUSED" ||
      value.authority !== "DIAGNOSTIC_ONLY_NOT_ADMITTED" || value.construction !== "NOT_ATTEMPTED" ||
      !exactKeys(value.source, ["reference", "imageId", "manifestDigest", "configDigest", "platform"]) ||
      value.source.reference !== SOURCE_REFERENCE || value.source.imageId !== SOURCE_CONFIG || value.source.manifestDigest !== SOURCE_MANIFEST ||
      value.source.configDigest !== SOURCE_CONFIG || value.source.platform !== "linux/amd64" ||
      !exactKeys(value.archive, ["bytes", "sha256"]) || !positiveInteger(value.archive.bytes) || value.archive.bytes > SOURCE_ARCHIVE_LIMIT ||
      !sha256(value.archive.sha256) || value.sourceUnchanged !== true || value.archiveRemoved !== true) {
    fail("scanner_seaweed_go_s3_source_refusal_receipt_invalid");
  }
  validateSeaweedGoS3ToolEvidence(value.tools);
  if (!exactKeys(value.resources, ["sameFilesystem", "requirements", "scratch", "docker"])) {
    fail("scanner_seaweed_go_s3_source_refusal_receipt_invalid");
  }
  const resourceEvidence = validateSeaweedGoS3FilesystemEvidence({ scratch: value.resources.scratch, docker: value.resources.docker });
  if (value.resources.sameFilesystem !== resourceEvidence.sameFilesystem ||
      JSON.stringify(value.resources.requirements) !== JSON.stringify(resourceEvidence.requirements)) {
    fail("scanner_seaweed_go_s3_source_refusal_receipt_invalid");
  }
  validateSeaweedGoS3SourceRefusal(value.refusal);
  return clone(value);
}

export function validateSeaweedGoS3SourcePreflightReceipt(value) {
  if (!exactKeys(value, ["schemaVersion", "kind", "state", "authority", "construction", "source", "tools", "resources", "archive", "inspection", "sourceUnchanged", "archiveRemoved"]) ||
      value.schemaVersion !== 1 || value.kind !== "SEAWEED_GO_S3_SOURCE_PREFLIGHT_V1" || value.state !== "SOURCE_PREFLIGHT_PASSED" ||
      value.authority !== "DIAGNOSTIC_ONLY_NOT_ADMITTED" || value.construction !== "PENDING_NOT_IMPLEMENTED" ||
      !exactKeys(value.source, ["reference", "imageId", "manifestDigest", "configDigest", "platform"]) ||
      value.source.reference !== SOURCE_REFERENCE || value.source.imageId !== SOURCE_CONFIG || value.source.manifestDigest !== SOURCE_MANIFEST ||
      value.source.configDigest !== SOURCE_CONFIG || value.source.platform !== "linux/amd64" ||
      !exactKeys(value.archive, ["bytes", "sha256"]) || !positiveInteger(value.archive.bytes) || value.archive.bytes > SOURCE_ARCHIVE_LIMIT || !sha256(value.archive.sha256) ||
      value.sourceUnchanged !== true || value.archiveRemoved !== true) fail("scanner_seaweed_go_s3_source_preflight_receipt_invalid");
  validateSeaweedGoS3ToolEvidence(value.tools);
  if (!exactKeys(value.resources, ["sameFilesystem", "requirements", "scratch", "docker"])) {
    fail("scanner_seaweed_go_s3_source_preflight_receipt_invalid");
  }
  const resourceEvidence = validateSeaweedGoS3FilesystemEvidence({ scratch: value.resources.scratch, docker: value.resources.docker });
  if (value.resources.sameFilesystem !== resourceEvidence.sameFilesystem ||
      JSON.stringify(value.resources.requirements) !== JSON.stringify(resourceEvidence.requirements)) {
    fail("scanner_seaweed_go_s3_source_preflight_receipt_invalid");
  }
  validateSeaweedGoS3SourceInspection(value.inspection, { archiveSha256: value.archive.sha256, archiveBytes: value.archive.bytes });
  return clone(value);
}

export async function runSeaweedGoS3SourcePreflight(input, operations) {
  const operationNames = ["assertInputsUnchanged", "probeTools", "statFilesystems", "saveSource", "lockArchive", "captureArchive",
    "inspectSource", "removeOwnedArchive", "archiveAbsent"];
  if (!exactKeys(input, ["source", "paths"]) || !exactKeys(input.source, ["reference", "imageId", "manifestDigest", "configDigest", "platform"]) ||
      input.source.reference !== SOURCE_REFERENCE || input.source.manifestDigest !== SOURCE_MANIFEST || input.source.configDigest !== SOURCE_CONFIG ||
      input.source.platform !== "linux/amd64" || input.source.imageId !== SOURCE_CONFIG ||
      !exactKeys(input.paths, ["archive", "config", "inspector", "python", "scratchDirectory"]) ||
      ["archive", "config", "inspector", "python", "scratchDirectory"].some((key) => !absolute(input.paths[key])) ||
      input.paths.archive !== path.join(input.paths.scratchDirectory, "source-save.tar") ||
      new Set(Object.values(input.paths)).size !== Object.keys(input.paths).length ||
      !operations || Object.keys(operations).length !== operationNames.length || operationNames.some((name) => typeof operations[name] !== "function")) {
    fail("scanner_seaweed_go_s3_source_preflight_invalid");
  }
  let archiveOwned = false, archiveRemoved = false, tools, resources, archive, inspection, refusal, refusalError;
  try {
    await operations.assertInputsUnchanged();
    tools = validateSeaweedGoS3ToolEvidence(await operations.probeTools());
    if (tools.docker.dockerRootDir === input.paths.scratchDirectory && input.paths.archive.startsWith(`${tools.docker.dockerRootDir}${path.sep}`)) {
      fail("scanner_seaweed_go_s3_source_preflight_invalid");
    }
    resources = validateSeaweedGoS3FilesystemEvidence(await operations.statFilesystems({
      scratchDirectory: input.paths.scratchDirectory, dockerRootDirectory: tools.docker.dockerRootDir,
    }));
    await operations.assertInputsUnchanged();
    const recheckedResources = validateSeaweedGoS3FilesystemEvidence(await operations.statFilesystems({
      scratchDirectory: input.paths.scratchDirectory, dockerRootDirectory: tools.docker.dockerRootDir,
    }));
    if (resources.sameFilesystem !== recheckedResources.sameFilesystem ||
        resources.scratch.path !== recheckedResources.scratch.path || resources.scratch.filesystemId !== recheckedResources.scratch.filesystemId ||
        resources.docker.path !== recheckedResources.docker.path || resources.docker.filesystemId !== recheckedResources.docker.filesystemId) {
      fail("scanner_seaweed_go_s3_filesystem_invalid");
    }
    resources = validateSeaweedGoS3FilesystemEvidence({
      scratch: { ...resources.scratch, freeBytes: Math.min(resources.scratch.freeBytes, recheckedResources.scratch.freeBytes) },
      docker: { ...resources.docker, freeBytes: Math.min(resources.docker.freeBytes, recheckedResources.docker.freeBytes) },
    });
    const save = seaweedGoS3SourceSaveArguments({ archive: input.paths.archive, imageId: input.source.imageId });
    archiveOwned = true;
    await operations.saveSource(save);
    await operations.lockArchive(input.paths.archive);
    archive = await operations.captureArchive({ file: input.paths.archive, cap: SOURCE_ARCHIVE_LIMIT });
    if (!exactKeys(archive, ["bytes", "sha256"]) || !positiveInteger(archive.bytes) || archive.bytes > SOURCE_ARCHIVE_LIMIT || !sha256(archive.sha256)) {
      fail("scanner_seaweed_go_s3_source_archive_invalid");
    }
    try {
      inspection = validateSeaweedGoS3SourceInspection(await operations.inspectSource(
        seaweedGoS3SourceInspectorArguments({ python: input.paths.python, inspector: input.paths.inspector,
          archive: input.paths.archive, config: input.paths.config })), { archiveBytes: archive.bytes, archiveSha256: archive.sha256 });
    } catch (error) {
      const detail = sourceRefusalDetails.get(error);
      if (!detail) throw error;
      refusal = detail;
      refusalError = error;
    }
    await operations.assertInputsUnchanged();
  } finally {
    if (archiveOwned) {
      await operations.removeOwnedArchive(input.paths.archive);
      archiveRemoved = await operations.archiveAbsent(input.paths.archive);
      if (archiveRemoved !== true) fail("scanner_seaweed_go_s3_cleanup_uncertain");
      archiveOwned = false;
    }
  }
  if (archiveOwned) fail("scanner_seaweed_go_s3_cleanup_uncertain");
  if (refusalError) {
    const receipt = validateSeaweedGoS3SourceRefusalReceipt({ schemaVersion: 1, kind: "SEAWEED_GO_S3_SOURCE_PREFLIGHT_V1",
      state: "SOURCE_PREFLIGHT_REFUSED", authority: "DIAGNOSTIC_ONLY_NOT_ADMITTED", construction: "NOT_ATTEMPTED",
      source: { ...input.source }, tools, resources, archive, refusal, sourceUnchanged: true, archiveRemoved });
    sourceRefusalReceipts.set(refusalError, receipt);
    throw refusalError;
  }
  return validateSeaweedGoS3SourcePreflightReceipt({ schemaVersion: 1, kind: "SEAWEED_GO_S3_SOURCE_PREFLIGHT_V1",
    state: "SOURCE_PREFLIGHT_PASSED", authority: "DIAGNOSTIC_ONLY_NOT_ADMITTED", construction: "PENDING_NOT_IMPLEMENTED",
    source: { ...input.source }, tools, resources, archive, inspection, sourceUnchanged: true, archiveRemoved });
}
