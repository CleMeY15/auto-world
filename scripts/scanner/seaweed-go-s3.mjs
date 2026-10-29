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

const QUALIFICATION_FILE_LIMIT = 8 * MiB;
const QUALIFICATION_JSON_LIMIT = 4 * MiB;
const QUALIFICATION_TOTAL_LIMIT = 64 * MiB;
const QUALIFICATION_TIMEOUT_MS = 300_000;
const QUALIFICATION_WHOLE_TIMEOUT_MS = 1_800_000;
const QUALIFICATION_MESSAGE = "auto-world-inert-qualification-v1";
const QUALIFICATION_CONTROL_LABEL = "inert-v1";
const QUALIFICATION_OWNER_LABEL = "com.auto-world.task005.inert";
const QUALIFICATION_STAGE_LABEL = "com.auto-world.task005.inert-stage";
const QUALIFICATION_FIXED_LABEL = "org.auto-world.seaweed-go-s3-control";
const QUALIFICATION_COMMAND = "/auto-world-inert-never-execute";
const QUALIFICATION_USER = "1001:1002";
const QUALIFICATION_SENTINEL_SHA256 = createHash("sha256").update("volume-underlay-sentinel-v1\n", "ascii").digest("hex");
const QUALIFICATION_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const QUALIFICATION_KINDS = new Set([
  "INERT_FIXTURE_V1", "INERT_EXPORT_SEMANTICS_V1", "INERT_RAW_DELETE_V1",
  "INERT_FILTERED_EXPORT_SEMANTICS_V1", "INERT_LEGACY_SAVE_V1",
]);
const QUALIFICATION_OPERATION_KINDS = Object.freeze({
  fixture_write: "INERT_FIXTURE_V1",
  fixture_inspect: "INERT_FIXTURE_V1",
  export_compare: "INERT_EXPORT_SEMANTICS_V1",
  delete_compare: "INERT_RAW_DELETE_V1",
  filtered_export_compare: "INERT_FILTERED_EXPORT_SEMANTICS_V1",
  legacy_save_inspect: "INERT_LEGACY_SAVE_V1",
});
const QUALIFICATION_REFUSALS = new Set([
  ...SOURCE_REFUSALS,
  "qualification_fixture_mismatch", "qualification_export_mismatch", "qualification_removed_helpers_mismatch",
  "qualification_raw_survivor_mismatch", "qualification_save_format_unsupported", "qualification_save_manifest_invalid",
  "qualification_save_config_invalid", "qualification_save_layer_invalid", "qualification_save_identity_mismatch",
  "qualification_owner_invalid", "qualification_argument_invalid",
]);
const qualificationRefusalDetails = new WeakMap();
const qualificationRefusalReceipts = new WeakMap();
const qualificationMember = (pathName, type, mode, uid, gid, mtime, payload = Buffer.alloc(0), linkname = "") => Object.freeze({
  path: pathName, type, mode, uid, gid, mtime, size: payload.length, linkname,
  payloadSha256: createHash("sha256").update(payload).digest("hex"),
});
const QUALIFICATION_MEMBERS = Object.freeze([
  qualificationMember("etc", "directory", 0o750, 101, 202, 1_700_000_100),
  qualificationMember("etc/fixture.conf", "file", 0o640, 101, 202, 1_700_000_101,
    Buffer.from("auto-world-inert-fixture-v1\n", "ascii")),
  qualificationMember("opt", "directory", 0o755, 0, 0, 1_700_000_102),
  qualificationMember("opt/auto-world", "directory", 0o750, 123, 456, 1_700_000_103),
  qualificationMember("opt/auto-world/marker.txt", "file", 0o444, 123, 456, 1_700_000_104,
    Buffer.from("preserve-this-marker\n", "ascii")),
  qualificationMember("var", "directory", 0o755, 0, 0, 1_700_000_105),
  qualificationMember("var/lib", "directory", 0o755, 0, 0, 1_700_000_106),
  qualificationMember("var/lib/seaweed", "directory", 0o750, 1001, 1002, 1_700_000_107),
  qualificationMember("var/lib/seaweed/state.bin", "file", 0o600, 1001, 1002, 1_700_000_108,
    Buffer.from("006175746f2d776f726c64ff7365617765656410", "hex")),
  qualificationMember("usr", "directory", 0o755, 0, 0, 1_700_000_109),
  qualificationMember("usr/bin", "directory", 0o755, 0, 0, 1_700_000_110),
  qualificationMember("usr/bin/weed-volume", "file", 0o640, 1001, 1002, 1_700_000_111,
    Buffer.from("AUTO WORLD INERT DATA ONLY: weed-volume\n", "ascii")),
  qualificationMember("usr/bin/weed-worker", "file", 0o640, 1001, 1002, 1_700_000_112,
    Buffer.from("AUTO WORLD INERT DATA ONLY: weed-worker\n", "ascii")),
  qualificationMember("data", "directory", 0o700, 1001, 1002, 1_700_000_113),
  qualificationMember("data/sentinel.txt", "file", 0o440, 1001, 1002, 1_700_000_114,
    Buffer.from("volume-underlay-sentinel-v1\n", "ascii")),
  qualificationMember("marker-link", "symlink", 0o777, 123, 456, 1_700_000_115, Buffer.alloc(0),
    "opt/auto-world/marker.txt"),
]);
const QUALIFICATION_FILTERED_MEMBERS = Object.freeze(QUALIFICATION_MEMBERS.filter((entry) =>
  !["usr/bin/weed-volume", "usr/bin/weed-worker"].includes(entry.path)));
const QUALIFICATION_SEMANTIC_SHA256 = Object.freeze({
  full: "d6a548ff5d28a85e4c12a94362bcce6de0aba4a77cafac4f759e3a96e4fcfd72",
  filtered: "21952af336107fcf72a2524d05fe4f2630a918b38d9075e528642cc0e63bda9d",
});

const canonicalUuid = (value) => typeof value === "string" && QUALIFICATION_UUID.test(value);
const dockerId = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
const containerId = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const qualificationTag = (value) => {
  if (typeof value !== "string") return false;
  const matched = /^(?:auto-world-managed\/seaweedfs-go-s3-inert-source|auto-world-managed\/seaweedfs-go-s3-control):([a-f0-9-]+)$/u.exec(value);
  return matched !== null && canonicalUuid(matched[1]);
};
const qualificationContainerReference = (value) => {
  if (containerId(value)) return true;
  if (typeof value !== "string") return false;
  const matched = /^aw-seaweed-go-s3-inert-(?:source|filtered)-([a-f0-9-]+)$/u.exec(value);
  return matched !== null && canonicalUuid(matched[1]);
};
const canonicalRfc3339 = (value) => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value) && !Number.isNaN(Date.parse(value));
const terminalLine = (value) => typeof value === "string" && !value.includes("\r") &&
  (value.endsWith("\n") ? !value.slice(0, -1).includes("\n") : !value.includes("\n")) ? value.replace(/\n$/u, "") : null;
const strictLabels = (owner, stage) => ({
  [QUALIFICATION_OWNER_LABEL]: owner,
  [QUALIFICATION_STAGE_LABEL]: stage,
  [QUALIFICATION_FIXED_LABEL]: QUALIFICATION_CONTROL_LABEL,
});
const jsonEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function qualificationSpec(operation, command, args, stdoutLimitBytes = QUALIFICATION_JSON_LIMIT) {
  return Object.freeze({ operation, command, args: Object.freeze([...args]), timeoutMs: QUALIFICATION_TIMEOUT_MS,
    stdoutLimitBytes, stderrLimitBytes: QUALIFICATION_JSON_LIMIT });
}

function qualificationPythonSpec(operation, { python, inspector, args }) {
  if (!absolute(python) || !absolute(inspector) || !Array.isArray(args) || args.some((entry) => typeof entry !== "string")) {
    fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  }
  return qualificationSpec(operation, python, [inspector, ...args]);
}

export function seaweedGoS3QualificationNames({ runId, scratchDirectory }) {
  if (!canonicalUuid(runId) || !absolute(scratchDirectory)) fail("scanner_seaweed_go_s3_qualification_names_invalid");
  const paths = {
    fixture: path.join(scratchDirectory, "inert-fixture.tar"),
    sourceExport: path.join(scratchDirectory, "source-export.tar"),
    filteredRootfs: path.join(scratchDirectory, "filtered-rootfs.tar"),
    finalSave: path.join(scratchDirectory, "filtered-save.tar"),
    roundtripExport: path.join(scratchDirectory, "roundtrip-export.tar"),
  };
  if (new Set(Object.values(paths)).size !== Object.keys(paths).length) fail("scanner_seaweed_go_s3_qualification_names_invalid");
  return clone({ runId, scratchDirectory, labels: { control: QUALIFICATION_CONTROL_LABEL, owner: runId }, paths,
    tags: { source: `auto-world-managed/seaweedfs-go-s3-inert-source:${runId}`,
      filtered: `auto-world-managed/seaweedfs-go-s3-control:${runId}` },
    containers: { source: `aw-seaweed-go-s3-inert-source-${runId}`, filtered: `aw-seaweed-go-s3-inert-filtered-${runId}` } });
}

export function seaweedGoS3FixtureWriteArguments({ python, inspector, archive }) {
  if (!absolute(archive)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationPythonSpec("fixture_write", { python, inspector, args: ["fixture-write", "--archive", archive] });
}

export function seaweedGoS3FixtureInspectArguments({ python, inspector, archive }) {
  if (!absolute(archive)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationPythonSpec("fixture_inspect", { python, inspector, args: ["fixture-inspect", "--archive", archive] });
}

export function seaweedGoS3ExportCompareArguments({ python, inspector, original, exported }) {
  if (!absolute(original) || !absolute(exported) || original === exported) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationPythonSpec("export_compare", { python, inspector,
    args: ["export-compare", "--original", original, "--export", exported] });
}

export function seaweedGoS3DeleteCompareArguments({ python, inspector, original, filtered }) {
  if (!absolute(original) || !absolute(filtered) || original === filtered) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationPythonSpec("delete_compare", { python, inspector,
    args: ["delete-compare", "--original", original, "--filtered", filtered] });
}

export function seaweedGoS3FilteredExportCompareArguments({ python, inspector, filtered, exported }) {
  if (!absolute(filtered) || !absolute(exported) || filtered === exported) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationPythonSpec("filtered_export_compare", { python, inspector,
    args: ["filtered-export-compare", "--filtered", filtered, "--export", exported] });
}

export function seaweedGoS3LegacySaveInspectArguments({ python, inspector, archive, imageId, tag, diffId, created, owner }) {
  if (!absolute(archive) || !dockerId(imageId) || !dockerId(diffId) || !canonicalRfc3339(created) || !canonicalUuid(owner) ||
      tag !== `auto-world-managed/seaweedfs-go-s3-control:${owner}`) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationPythonSpec("legacy_save_inspect", { python, inspector, args: ["legacy-save-inspect", "--archive", archive,
    "--image-id", imageId, "--tag", tag, "--diff-id", diffId, "--server-version", "28.0.4", "--created", created,
    "--owner", owner] });
}

export function seaweedGoS3ControlImportArguments({ names, archive, stage }) {
  if (!names || !absolute(archive) || !["source", "filtered"].includes(stage)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  const expected = seaweedGoS3QualificationNames({ runId: names.runId, scratchDirectory: names.scratchDirectory });
  if (!jsonEqual(names, expected) || archive !== (stage === "source" ? names.paths.fixture : names.paths.filteredRootfs)) {
    fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  }
  const labels = strictLabels(names.runId, stage);
  const changes = [
    `USER ${QUALIFICATION_USER}`,
    `CMD ["${QUALIFICATION_COMMAND}"]`,
    "WORKDIR /data",
    "VOLUME [\"/data\"]",
    `LABEL ${QUALIFICATION_FIXED_LABEL}=${labels[QUALIFICATION_FIXED_LABEL]}`,
    `LABEL ${QUALIFICATION_OWNER_LABEL}=${labels[QUALIFICATION_OWNER_LABEL]}`,
    `LABEL ${QUALIFICATION_STAGE_LABEL}=${labels[QUALIFICATION_STAGE_LABEL]}`,
  ];
  const args = ["image", "import", "--platform=linux/amd64", "--message", QUALIFICATION_MESSAGE];
  for (const change of changes) args.push("--change", change);
  args.push(archive, stage === "source" ? names.tags.source : names.tags.filtered);
  return qualificationSpec(`import_${stage}`, "/usr/bin/docker", args, 256);
}

export function seaweedGoS3ImageInspectArguments({ image }) {
  if (!dockerId(image) && !qualificationTag(image)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationSpec("image_inspect", "/usr/bin/docker", ["image", "inspect", "--format", "[{{json .}}]", image]);
}

export function seaweedGoS3ContainerCreateArguments({ names, imageId, stage }) {
  if (!names || !dockerId(imageId) || !["source", "filtered"].includes(stage)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  const expected = seaweedGoS3QualificationNames({ runId: names.runId, scratchDirectory: names.scratchDirectory });
  if (!jsonEqual(names, expected)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  const labels = strictLabels(names.runId, stage);
  const container = stage === "source" ? names.containers.source : names.containers.filtered;
  return qualificationSpec(`container_create_${stage}`, "/usr/bin/docker", ["container", "create", "--name", container,
    "--label", `${QUALIFICATION_FIXED_LABEL}=${labels[QUALIFICATION_FIXED_LABEL]}`,
    "--label", `${QUALIFICATION_OWNER_LABEL}=${labels[QUALIFICATION_OWNER_LABEL]}`,
    "--label", `${QUALIFICATION_STAGE_LABEL}=${labels[QUALIFICATION_STAGE_LABEL]}`,
    "--network", "none", "--read-only", "--user", QUALIFICATION_USER, "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--memory", "67108864", "--cpus", "0.25", "--pids-limit", "64", imageId], 256);
}

export function seaweedGoS3ContainerInspectArguments({ container }) {
  if (!qualificationContainerReference(container)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationSpec("container_inspect", "/usr/bin/docker",
    ["container", "inspect", "--format", "[{{json .}}]", container]);
}

export function seaweedGoS3ContainerDiffArguments({ container, phase }) {
  if (!["before", "after"].includes(phase) || !qualificationContainerReference(container)) {
    fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  }
  return qualificationSpec(`container_diff_${phase}`, "/usr/bin/docker", ["container", "diff", container], 64 * KiB);
}

function boundedDockerFileSpec(operation, subcommand, subject, archive) {
  if (typeof subject !== "string" || subject.length < 1 || subject.length > 256 || /[\0\r\n]/u.test(subject) || !absolute(archive)) {
    fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  }
  const script = ["set -euo pipefail", `ulimit -Sf ${QUALIFICATION_FILE_LIMIT / KiB}`,
    `exec /usr/bin/docker ${subcommand} --output "$1" "$2"`].join("\n");
  return qualificationSpec(operation, "/usr/bin/bash", ["--noprofile", "--norc", "-c", script, operation, archive, subject], 256);
}

export function seaweedGoS3ContainerExportArguments({ container, archive }) {
  if (!qualificationContainerReference(container)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return boundedDockerFileSpec("container_export", "container export", container, archive);
}

export function seaweedGoS3ImageSaveArguments({ tag, imageId, archive }) {
  if (!dockerId(imageId) || !qualificationTag(tag) || !tag.startsWith("auto-world-managed/seaweedfs-go-s3-control:")) {
    fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  }
  return boundedDockerFileSpec("image_save", "image save", tag, archive);
}

export function seaweedGoS3DeleteHelpersArguments({ archive }) {
  if (!absolute(archive)) fail("scanner_seaweed_go_s3_qualification_arguments_invalid");
  return qualificationSpec("delete_helpers", "/usr/bin/tar",
    ["--delete", "--file", archive, "usr/bin/weed-volume", "usr/bin/weed-worker"], 256);
}

function validateArchiveSummary(value, memberCount, semanticSha256 = null) {
  if (!exactKeys(value, ["sha256", "bytes", "memberCount", "semanticSha256", "orderedRawSha256"]) || !sha256(value.sha256) ||
      !positiveInteger(value.bytes) || value.bytes > QUALIFICATION_FILE_LIMIT || !Number.isSafeInteger(value.memberCount) ||
      value.memberCount < 1 || value.memberCount > 64 || memberCount !== null && value.memberCount !== memberCount ||
      !sha256(value.semanticSha256) || semanticSha256 !== null && value.semanticSha256 !== semanticSha256 ||
      !sha256(value.orderedRawSha256)) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
  return clone(value);
}

function validateQualificationMember(value) {
  if (!exactKeys(value, ["path", "type", "mode", "uid", "gid", "mtime", "size", "linkname", "payloadSha256", "rawSha256"]) ||
      typeof value.path !== "string" || value.path.length < 1 || value.path.length > 256 || value.path.startsWith("/") ||
      value.path.includes("\\") || value.path.split("/").some((entry) => !entry || entry === "." || entry === "..") ||
      !["file", "directory", "symlink"].includes(value.type) || !Number.isSafeInteger(value.mode) || value.mode < 0 || value.mode > 0o7777 ||
      !Number.isSafeInteger(value.uid) || value.uid < 0 || !Number.isSafeInteger(value.gid) || value.gid < 0 ||
      !Number.isSafeInteger(value.mtime) || value.mtime < 0 || !Number.isSafeInteger(value.size) || value.size < 0 ||
      typeof value.linkname !== "string" || value.linkname.length > 256 || !sha256(value.payloadSha256) || !sha256(value.rawSha256)) {
    fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
  }
  return clone(value);
}

function validateSentinel(value) {
  if (!exactKeys(value, ["path", "sha256", "bytes"]) || value.path !== "data/sentinel.txt" ||
      value.sha256 !== QUALIFICATION_SENTINEL_SHA256 || value.bytes !== 28) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
  return clone(value);
}

function validateQualificationMembers(values, filtered, ordered) {
  const expected = filtered ? QUALIFICATION_FILTERED_MEMBERS : QUALIFICATION_MEMBERS;
  if (!Array.isArray(values) || values.length !== expected.length) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
  const actual = values.map((value) => {
    const member = validateQualificationMember(value);
    return { path: member.path, type: member.type, mode: member.mode, uid: member.uid, gid: member.gid, mtime: member.mtime,
      size: member.size, linkname: member.linkname, payloadSha256: member.payloadSha256 };
  });
  const byPath = (left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  const compareActual = ordered ? actual : [...actual].sort(byPath);
  const compareExpected = ordered ? expected : [...expected].sort(byPath);
  if (!jsonEqual(compareActual, compareExpected)) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
}

function qualificationRawCommitment(values) {
  const identities = values.map((entry) => ({ path: entry.path, rawSha256: entry.rawSha256 }));
  return createHash("sha256").update(JSON.stringify(identities), "ascii").digest("hex");
}

export function validateSeaweedGoS3QualificationInspection(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > QUALIFICATION_JSON_LIMIT ||
      value.schemaVersion !== 1 || value.profile !== "go-s3-4.51-v1" ||
      value.evidenceClass !== "INERT_CONSTRUCTION_QUALIFICATION" || value.status !== "PASS") {
    fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
  }
  const common = ["evidenceClass", "kind", "profile", "schemaVersion", "status"];
  if (value.kind === "INERT_FIXTURE_V1") {
    if (!exactKeys(value, [...common, "operation", "archive", "members", "sentinel"]) || !["WRITE", "INSPECT"].includes(value.operation) ||
        !Array.isArray(value.members) || value.members.length !== 16) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    validateArchiveSummary(value.archive, 16, QUALIFICATION_SEMANTIC_SHA256.full);
    validateQualificationMembers(value.members, false, true); validateSentinel(value.sentinel);
    if (value.archive.orderedRawSha256 !== qualificationRawCommitment(value.members)) {
      fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    }
  } else if (value.kind === "INERT_EXPORT_SEMANTICS_V1") {
    if (!exactKeys(value, [...common, "original", "exported", "matched", "members", "sentinel"]) || value.matched !== true ||
        !Array.isArray(value.members) || value.members.length !== 16) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    validateArchiveSummary(value.original, 16, QUALIFICATION_SEMANTIC_SHA256.full);
    validateArchiveSummary(value.exported, 16, QUALIFICATION_SEMANTIC_SHA256.full);
    validateQualificationMembers(value.members, false, false); validateSentinel(value.sentinel);
    if (value.exported.orderedRawSha256 !== qualificationRawCommitment(value.members)) {
      fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    }
  } else if (value.kind === "INERT_RAW_DELETE_V1") {
    if (!exactKeys(value, [...common, "original", "filtered", "removedCount", "removed", "survivorCount", "survivorRawSha256",
      "survivors", "sentinel"]) || value.removedCount !== 2 || !jsonEqual(value.removed,
      ["usr/bin/weed-volume", "usr/bin/weed-worker"]) || value.survivorCount !== 14 || !sha256(value.survivorRawSha256) ||
      !Array.isArray(value.survivors) || value.survivors.length !== 14 || value.survivors.some((entry) =>
        !exactKeys(entry, ["path", "rawSha256"]) || typeof entry.path !== "string" || !sha256(entry.rawSha256))) {
      fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    }
    if (!jsonEqual([...value.survivors].map((entry) => entry.path).sort(),
      [...QUALIFICATION_FILTERED_MEMBERS].map((entry) => entry.path).sort())) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    validateArchiveSummary(value.original, 16, QUALIFICATION_SEMANTIC_SHA256.full);
    validateArchiveSummary(value.filtered, 14, QUALIFICATION_SEMANTIC_SHA256.filtered); validateSentinel(value.sentinel);
    if (value.survivorRawSha256 !== qualificationRawCommitment(value.survivors) ||
        value.filtered.orderedRawSha256 !== value.survivorRawSha256) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
  } else if (value.kind === "INERT_FILTERED_EXPORT_SEMANTICS_V1") {
    if (!exactKeys(value, [...common, "filtered", "exported", "matched", "members", "sentinel"]) || value.matched !== true ||
        !Array.isArray(value.members) || value.members.length !== 14) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    validateArchiveSummary(value.filtered, 14, QUALIFICATION_SEMANTIC_SHA256.filtered);
    validateArchiveSummary(value.exported, 14, QUALIFICATION_SEMANTIC_SHA256.filtered);
    validateQualificationMembers(value.members, true, false); validateSentinel(value.sentinel);
    if (value.exported.orderedRawSha256 !== qualificationRawCommitment(value.members)) {
      fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    }
  } else if (value.kind === "INERT_LEGACY_SAVE_V1") {
    if (!exactKeys(value, [...common, "archive", "family", "image", "layer", "graph", "sentinel"]) ||
        value.family !== "MOBY_LEGACY_SINGLE_LAYER_V1" ||
        !exactKeys(value.image, ["imageId", "tag", "owner", "created", "serverVersion", "configSha256"]) ||
        !dockerId(value.image.imageId) || !canonicalUuid(value.image.owner) ||
        value.image.tag !== `auto-world-managed/seaweedfs-go-s3-control:${value.image.owner}` || !canonicalRfc3339(value.image.created) ||
        value.image.serverVersion !== "28.0.4" || value.image.configSha256 !== value.image.imageId.slice(7) ||
        !exactKeys(value.layer, ["diffId", "sha256", "bytes", "memberCount", "semanticSha256"]) || !dockerId(value.layer.diffId) ||
        !sha256(value.layer.sha256) || value.layer.diffId.slice(7) !== value.layer.sha256 || !positiveInteger(value.layer.bytes) ||
        value.layer.bytes > QUALIFICATION_FILE_LIMIT || value.layer.memberCount !== 14 ||
        value.layer.semanticSha256 !== QUALIFICATION_SEMANTIC_SHA256.filtered ||
        !exactKeys(value.graph, ["configPath", "layerPath", "layerId", "descriptorCount"]) || typeof value.graph.configPath !== "string" ||
        value.graph.configPath !== `${value.image.imageId.slice(7)}.json` || !sha256(value.graph.layerId) ||
        value.graph.layerPath !== `${value.graph.layerId}/layer.tar` || value.graph.descriptorCount !== 1) {
      fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    }
    validateArchiveSummary(value.archive, null); validateSentinel(value.sentinel);
  } else fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
  return clone(value);
}

export function validateSeaweedGoS3QualificationRefusal(value) {
  if (!exactKeys(value, ["evidenceClass", "kind", "profile", "refusal", "schemaVersion", "status"]) || value.schemaVersion !== 1 ||
      value.profile !== "go-s3-4.51-v1" || value.evidenceClass !== "INERT_CONSTRUCTION_QUALIFICATION" || value.status !== "REFUSED" ||
      !QUALIFICATION_KINDS.has(value.kind) || !exactKeys(value.refusal, Object.hasOwn(value.refusal ?? {}, "member") ? ["code", "member"] :
        Object.hasOwn(value.refusal ?? {}, "memberSha256") ? ["code", "memberSha256"] : ["code"]) ||
      !QUALIFICATION_REFUSALS.has(value.refusal.code) || Object.hasOwn(value.refusal, "member") &&
        (typeof value.refusal.member !== "string" || value.refusal.member.length < 1 || value.refusal.member.length > 256 ||
          value.refusal.member.startsWith("/") || value.refusal.member.includes("\\") || /[\0\r\n]/u.test(value.refusal.member) ||
          value.refusal.member.split("/").some((entry) => !entry || entry === "." || entry === "..")) ||
      Object.hasOwn(value.refusal, "memberSha256") && !sha256(value.refusal.memberSha256)) {
    fail("scanner_seaweed_go_s3_qualification_refusal_invalid");
  }
  return clone(value);
}

export function seaweedGoS3QualificationRefusalError(value) {
  const error = new Error("scanner_seaweed_go_s3_inert_qualification_refused");
  qualificationRefusalDetails.set(error, validateSeaweedGoS3QualificationRefusal(value));
  return error;
}

export function seaweedGoS3QualificationRefusalReceipt(error) {
  const receipt = qualificationRefusalReceipts.get(error);
  return receipt ? clone(receipt) : null;
}

function expectedRuntimeConfig(owner, stage) {
  return { Cmd: [QUALIFICATION_COMMAND], Entrypoint: null, Labels: strictLabels(owner, stage), User: QUALIFICATION_USER,
    Volumes: { "/data": {} }, WorkingDir: "/data" };
}

export function validateSeaweedGoS3QualificationImage(value, { owner, stage, tag, imageId = null } = {}) {
  if (!canonicalUuid(owner) || !["source", "filtered"].includes(stage) || typeof tag !== "string" || imageId !== null && !dockerId(imageId) ||
      !Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") {
    fail("scanner_seaweed_go_s3_qualification_image_invalid");
  }
  const raw = value[0], config = raw.Config;
  const normalizedConfig = { Cmd: config?.Cmd ?? null, Entrypoint: config?.Entrypoint ?? null, Labels: config?.Labels ?? null,
    User: config?.User ?? "", Volumes: config?.Volumes ?? null, WorkingDir: config?.WorkingDir ?? "" };
  if (!dockerId(raw.Id) || imageId !== null && raw.Id !== imageId || !Array.isArray(raw.RepoTags) || !jsonEqual(raw.RepoTags, [tag]) ||
      raw.RepoDigests != null && (!Array.isArray(raw.RepoDigests) || raw.RepoDigests.length !== 0) ||
      raw.Os !== "linux" || raw.Architecture !== "amd64" || !canonicalRfc3339(raw.Created) || !jsonEqual(normalizedConfig, expectedRuntimeConfig(owner, stage)) ||
      config?.Entrypoint !== null ||
      config?.ExposedPorts != null && Object.keys(config.ExposedPorts).length !== 0 || config?.Healthcheck != null ||
      config?.StopSignal != null && config.StopSignal !== "" || config?.Shell != null || config?.OnBuild != null ||
      config?.Env != null && (!Array.isArray(config.Env) || config.Env.length !== 0) ||
      config?.Hostname != null && config.Hostname !== "" || config?.Domainname != null && config.Domainname !== "" ||
      ["AttachStdin", "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce", "NetworkDisabled", "ArgsEscaped"]
        .some((key) => config?.[key] != null && config[key] !== false) || config?.Image != null && config.Image !== "" ||
      !raw.RootFS || raw.RootFS.Type !== "layers" || !Array.isArray(raw.RootFS.Layers) || raw.RootFS.Layers.length !== 1 ||
      !dockerId(raw.RootFS.Layers[0])) fail("scanner_seaweed_go_s3_qualification_image_invalid");
  return { imageId: raw.Id, tag, platform: "linux/amd64", created: raw.Created, config: expectedRuntimeConfig(owner, stage) };
}

export function validateSeaweedGoS3QualificationContainer(value, { owner, stage, name, imageId } = {}) {
  if (!canonicalUuid(owner) || !["source", "filtered"].includes(stage) || typeof name !== "string" || !dockerId(imageId) ||
      !Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== "object") {
    fail("scanner_seaweed_go_s3_qualification_container_invalid");
  }
  const raw = value[0], state = raw.State, config = raw.Config, host = raw.HostConfig, network = raw.NetworkSettings;
  const labels = strictLabels(owner, stage), mounts = raw.Mounts;
  const networks = network?.Networks;
  const networkNames = networks && typeof networks === "object" && !Array.isArray(networks) ? Object.keys(networks) : null;
  const noneNetwork = networkNames?.length === 1 && networkNames[0] === "none" ? networks.none : null;
  const emptyEndpoint = (entry) => entry == null || entry === "";
  const emptyArray = (entry) => entry == null || Array.isArray(entry) && entry.length === 0;
  const emptyMap = (entry) => entry == null || typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length === 0;
  const noEndpoint = noneNetwork === null || noneNetwork && typeof noneNetwork === "object" &&
    ["EndpointID", "Gateway", "IPAddress", "GlobalIPv6Address", "MacAddress"].every((key) => emptyEndpoint(noneNetwork[key])) &&
    ["IPPrefixLen", "GlobalIPv6PrefixLen"].every((key) => noneNetwork[key] == null || noneNetwork[key] === 0) &&
    emptyArray(noneNetwork.Aliases) && emptyArray(noneNetwork.Links) && emptyArray(noneNetwork.DNSNames) && emptyMap(noneNetwork.DriverOpts);
  if (!containerId(raw.Id) || raw.Name !== `/${name}` || raw.Image !== imageId || !state || state.Status !== "created" || state.Running !== false ||
      state.Paused !== false || state.Restarting !== false || state.Dead !== false || state.StartedAt !== "0001-01-01T00:00:00Z" ||
      state.FinishedAt !== "0001-01-01T00:00:00Z" || !jsonEqual(config?.Cmd, [QUALIFICATION_COMMAND]) ||
      config?.Entrypoint !== null || !emptyArray(config?.Env) || !emptyMap(config?.ExposedPorts) || config?.Healthcheck != null ||
      !jsonEqual(config?.Labels, labels) || config?.User !== QUALIFICATION_USER || !jsonEqual(config?.Volumes, { "/data": {} }) ||
      config?.WorkingDir !== "/data" || config?.Image != null && config.Image !== imageId ||
      config?.StopSignal != null && config.StopSignal !== "" || config?.Shell != null && !emptyArray(config.Shell) ||
      config?.OnBuild != null && !emptyArray(config.OnBuild) ||
      ["AttachStdin", "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce", "NetworkDisabled"]
        .some((key) => config?.[key] != null && config[key] !== false) ||
      !host || host.NetworkMode !== "none" || host.ReadonlyRootfs !== true || !jsonEqual(host.CapDrop, ["ALL"]) ||
      !Array.isArray(host.SecurityOpt) || host.SecurityOpt.length !== 1 || !["no-new-privileges", "no-new-privileges:true"].includes(host.SecurityOpt[0]) ||
      host.Memory !== 67_108_864 || host.NanoCpus !== 250_000_000 || host.PidsLimit !== 64 ||
      !(host.Binds == null || Array.isArray(host.Binds) && host.Binds.length === 0) ||
      !(host.Tmpfs == null || typeof host.Tmpfs === "object" && Object.keys(host.Tmpfs).length === 0) ||
      host.Privileged != null && host.Privileged !== false || host.AutoRemove != null && host.AutoRemove !== false ||
      host.PortBindings != null && Object.keys(host.PortBindings).length !== 0 ||
      host.CapAdd != null && (!Array.isArray(host.CapAdd) || host.CapAdd.length !== 0) ||
      host.Devices != null && (!Array.isArray(host.Devices) || host.Devices.length !== 0) ||
      host.DeviceRequests != null && (!Array.isArray(host.DeviceRequests) || host.DeviceRequests.length !== 0) ||
      host.DeviceCgroupRules != null && (!Array.isArray(host.DeviceCgroupRules) || host.DeviceCgroupRules.length !== 0) ||
      host.VolumesFrom != null && (!Array.isArray(host.VolumesFrom) || host.VolumesFrom.length !== 0) ||
      host.Links != null && (!Array.isArray(host.Links) || host.Links.length !== 0) ||
      host.ExtraHosts != null && (!Array.isArray(host.ExtraHosts) || host.ExtraHosts.length !== 0) ||
      host.PublishAllPorts != null && host.PublishAllPorts !== false || host.OomKillDisable != null && host.OomKillDisable !== false ||
      !Array.isArray(mounts) || mounts.length !== 1 || mounts[0]?.Type !== "volume" || mounts[0]?.Destination !== "/data" ||
      mounts[0]?.RW !== true || typeof mounts[0]?.Name !== "string" || mounts[0].Name.length < 1 || mounts[0].Name.length > 256 ||
      !networkNames || ![0, 1].includes(networkNames.length) || networkNames.length === 1 && networkNames[0] !== "none" || !noEndpoint ||
      !emptyMap(network?.Ports) || !emptyEndpoint(network?.SandboxID) || !emptyEndpoint(network?.SandboxKey) ||
      !emptyEndpoint(network?.EndpointID) || !emptyEndpoint(network?.Gateway) || !emptyEndpoint(network?.IPAddress) ||
      !emptyEndpoint(network?.GlobalIPv6Address) || !emptyEndpoint(network?.MacAddress)) {
    fail("scanner_seaweed_go_s3_qualification_container_invalid");
  }
  return { containerId: raw.Id, name, imageId, state: { status: "created", running: false, startedAt: state.StartedAt,
    finishedAt: state.FinishedAt }, config: { Cmd: [QUALIFICATION_COMMAND], Labels: labels, User: QUALIFICATION_USER, WorkingDir: "/data" },
  hostConfig: { networkMode: "none", readonlyRootfs: true, capDrop: ["ALL"], securityOpt: ["no-new-privileges"],
    memory: 67_108_864, nanoCpus: 250_000_000, pidsLimit: 64, binds: [] },
  mounts: [{ type: "volume", name: mounts[0].Name, destination: "/data", rw: true }] };
}

function validateNormalizedImage(value, owner, stage, tag) {
  if (!exactKeys(value, ["imageId", "tag", "platform", "created", "config"]) || !dockerId(value.imageId) || value.tag !== tag ||
      value.platform !== "linux/amd64" || !canonicalRfc3339(value.created) || !jsonEqual(value.config, expectedRuntimeConfig(owner, stage))) {
    fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  }
  return clone(value);
}

function validateNormalizedContainer(value, owner, stage, name, imageId) {
  const labels = strictLabels(owner, stage);
  if (!exactKeys(value, ["containerId", "name", "imageId", "state", "config", "hostConfig", "mounts"]) ||
      !containerId(value.containerId) || value.name !== name || value.imageId !== imageId ||
      !exactKeys(value.state, ["status", "running", "startedAt", "finishedAt"]) || value.state.status !== "created" ||
      value.state.running !== false || value.state.startedAt !== "0001-01-01T00:00:00Z" || value.state.finishedAt !== "0001-01-01T00:00:00Z" ||
      !exactKeys(value.config, ["Cmd", "Labels", "User", "WorkingDir"]) || !jsonEqual(value.config.Cmd, [QUALIFICATION_COMMAND]) ||
      !jsonEqual(value.config.Labels, labels) || value.config.User !== QUALIFICATION_USER || value.config.WorkingDir !== "/data" ||
      !exactKeys(value.hostConfig, ["networkMode", "readonlyRootfs", "capDrop", "securityOpt", "memory", "nanoCpus", "pidsLimit", "binds"]) ||
      value.hostConfig.networkMode !== "none" || value.hostConfig.readonlyRootfs !== true || !jsonEqual(value.hostConfig.capDrop, ["ALL"]) ||
      !jsonEqual(value.hostConfig.securityOpt, ["no-new-privileges"]) || value.hostConfig.memory !== 67_108_864 ||
      value.hostConfig.nanoCpus !== 250_000_000 || value.hostConfig.pidsLimit !== 64 || !jsonEqual(value.hostConfig.binds, []) ||
      !Array.isArray(value.mounts) || value.mounts.length !== 1 || !exactKeys(value.mounts[0], ["type", "name", "destination", "rw"]) ||
      value.mounts[0].type !== "volume" || typeof value.mounts[0].name !== "string" || value.mounts[0].name.length < 1 ||
      value.mounts[0].name.length > 256 || value.mounts[0].destination !== "/data" || value.mounts[0].rw !== true) {
    fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  }
  return clone(value);
}

function validateStrictOutput(value) {
  if (!exactKeys(value, ["exitCode", "stdout", "stderr"]) || value.exitCode !== 0 || value.stdout !== "" || value.stderr !== "") {
    fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  }
  return clone(value);
}

function validateCleanup(value) {
  if (!exactKeys(value, ["containersAbsent", "imagesAbsent", "volumesAbsent", "filesAbsent"]) ||
      Object.values(value).some((entry) => entry !== true)) fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  return clone(value);
}

function validateQualificationResources(value) {
  if (!exactKeys(value, ["initial", "final"])) fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  for (const entry of [value.initial, value.final]) {
    if (!exactKeys(entry, ["sameFilesystem", "requirements", "scratch", "docker"])) {
      fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    }
  }
  const initial = validateSeaweedGoS3FilesystemEvidence({ scratch: value.initial.scratch, docker: value.initial.docker });
  const final = validateSeaweedGoS3FilesystemEvidence({ scratch: value.final.scratch, docker: value.final.docker });
  if (value.initial.sameFilesystem !== initial.sameFilesystem || !jsonEqual(value.initial.requirements, initial.requirements) ||
      value.final.sameFilesystem !== final.sameFilesystem || !jsonEqual(value.final.requirements, final.requirements)) {
    fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  }
  if (initial.sameFilesystem !== final.sameFilesystem || initial.scratch.path !== final.scratch.path ||
      initial.scratch.filesystemId !== final.scratch.filesystemId || initial.docker.path !== final.docker.path ||
      initial.docker.filesystemId !== final.docker.filesystemId) fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  return { initial: clone(value.initial), final: clone(value.final) };
}

export function validateSeaweedGoS3QualificationReceipt(value) {
  const passKeys = ["schemaVersion", "kind", "state", "authority", "construction", "source", "sourcePreflight", "tools", "resources",
    "fixture", "sourceImage", "sourceContainer", "sourceDiff", "sourceExport", "deletion", "filteredImage", "finalSave",
    "roundtripContainer", "roundtripDiff", "roundtrip", "inputsUnchanged", "cleanup"];
  const refusalKeys = ["schemaVersion", "kind", "state", "authority", "construction", "stage", "source", "sourcePreflight", "tools",
    "resources", "evidence", "refusal", "inputsUnchanged", "cleanup"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > QUALIFICATION_JSON_LIMIT ||
      value.schemaVersion !== 1 || value.kind !== "SEAWEED_GO_S3_INERT_QUALIFICATION_V1" ||
      value.authority !== "DIAGNOSTIC_ONLY_NOT_ADMITTED" || value.inputsUnchanged !== true) {
    fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  }
  const sourcePreflight = validateSeaweedGoS3SourcePreflightReceipt(value.sourcePreflight);
  if (!jsonEqual(value.source, sourcePreflight.source) || !jsonEqual(value.tools, sourcePreflight.tools)) {
    fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  }
  validateQualificationResources(value.resources); validateCleanup(value.cleanup);
  const owner = value.filteredImage?.config?.Labels?.[QUALIFICATION_OWNER_LABEL] ??
    value.sourceImage?.config?.Labels?.[QUALIFICATION_OWNER_LABEL] ?? null;
  if (value.state === "INERT_QUALIFICATION_PASSED") {
    if (!exactKeys(value, passKeys) || value.construction !== "PENDING_NOT_IMPLEMENTED" || !canonicalUuid(owner)) {
      fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    }
    const names = seaweedGoS3QualificationNames({ runId: owner, scratchDirectory: value.resources.initial.scratch.path });
    validateSeaweedGoS3QualificationInspection(value.fixture);
    if (value.fixture.kind !== "INERT_FIXTURE_V1") fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    validateNormalizedImage(value.sourceImage, owner, "source", names.tags.source);
    validateNormalizedContainer(value.sourceContainer, owner, "source", names.containers.source, value.sourceImage.imageId);
    if (!exactKeys(value.sourceDiff, ["before", "after"])) fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    validateStrictOutput(value.sourceDiff.before); validateStrictOutput(value.sourceDiff.after);
    for (const [report, kind] of [[value.sourceExport, "INERT_EXPORT_SEMANTICS_V1"], [value.deletion, "INERT_RAW_DELETE_V1"],
      [value.finalSave, "INERT_LEGACY_SAVE_V1"], [value.roundtrip, "INERT_FILTERED_EXPORT_SEMANTICS_V1"]]) {
      validateSeaweedGoS3QualificationInspection(report);
      if (report.kind !== kind) fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    }
    validateNormalizedImage(value.filteredImage, owner, "filtered", names.tags.filtered);
    if (value.finalSave.image.imageId !== value.filteredImage.imageId || value.finalSave.image.tag !== names.tags.filtered ||
        value.finalSave.image.owner !== owner || value.finalSave.image.created !== value.filteredImage.created) {
      fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    }
    validateNormalizedContainer(value.roundtripContainer, owner, "filtered", names.containers.filtered, value.filteredImage.imageId);
    if (!exactKeys(value.roundtripDiff, ["before", "after"])) fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    validateStrictOutput(value.roundtripDiff.before); validateStrictOutput(value.roundtripDiff.after);
    const expectedSurvivors = value.sourceExport.members.filter((entry) =>
      !["usr/bin/weed-volume", "usr/bin/weed-worker"].includes(entry.path)).map((entry) =>
      ({ path: entry.path, rawSha256: entry.rawSha256 }));
    if (!jsonEqual(value.fixture.archive, value.sourceExport.original) ||
        value.fixture.archive.orderedRawSha256 !== qualificationRawCommitment(value.fixture.members) ||
        value.sourceExport.exported.orderedRawSha256 !== qualificationRawCommitment(value.sourceExport.members) ||
        !jsonEqual(value.sourceExport.exported, value.deletion.original) ||
        !jsonEqual(value.deletion.filtered, value.roundtrip.filtered) ||
        !jsonEqual(value.deletion.survivors, expectedSurvivors) ||
        value.deletion.survivorRawSha256 !== qualificationRawCommitment(value.deletion.survivors) ||
        value.deletion.filtered.orderedRawSha256 !== value.deletion.survivorRawSha256 ||
        value.roundtrip.exported.orderedRawSha256 !== qualificationRawCommitment(value.roundtrip.members) ||
        value.finalSave.layer.diffId !== `sha256:${value.deletion.filtered.sha256}` ||
        value.finalSave.layer.sha256 !== value.deletion.filtered.sha256 ||
        value.finalSave.layer.bytes !== value.deletion.filtered.bytes ||
        value.finalSave.layer.memberCount !== value.deletion.filtered.memberCount ||
        value.finalSave.layer.semanticSha256 !== value.deletion.filtered.semanticSha256) {
      fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    }
  } else if (value.state === "INERT_QUALIFICATION_REFUSED") {
    if (!exactKeys(value, refusalKeys) || value.construction !== "NOT_ATTEMPTED" || !QUALIFICATION_KINDS.has(value.stage) ||
        !Array.isArray(value.evidence) || value.evidence.length > 6) {
      fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
    }
    value.evidence.forEach(validateSeaweedGoS3QualificationInspection);
    validateSeaweedGoS3QualificationRefusal(value.refusal);
    if (value.stage !== value.refusal.kind) fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  } else fail("scanner_seaweed_go_s3_qualification_receipt_invalid");
  return clone(value);
}

function validateCapture(value) {
  const identityKeys = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
  if (!exactKeys(value, ["bytes", "sha256", "identity"]) || !positiveInteger(value.bytes) || value.bytes > QUALIFICATION_FILE_LIMIT ||
      !sha256(value.sha256) || !exactKeys(value.identity, identityKeys) || Object.values(value.identity).some((entry) =>
        typeof entry !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(entry)) || value.identity.nlink !== "1" ||
      value.identity.size !== String(value.bytes) || (Number(value.identity.mode) & 0o222) !== 0) {
    fail("scanner_seaweed_go_s3_qualification_file_invalid");
  }
  return clone(value);
}

function validateExecution(value, spec) {
  if (!exactKeys(value, ["exitCode", "stdout", "stderr"]) || !Number.isSafeInteger(value.exitCode) || value.exitCode < 0 || value.exitCode > 255 ||
      typeof value.stdout !== "string" || typeof value.stderr !== "string" || Buffer.byteLength(value.stdout) > spec.stdoutLimitBytes ||
      Buffer.byteLength(value.stderr) > spec.stderrLimitBytes) fail("scanner_seaweed_go_s3_qualification_process_invalid");
  return value;
}

function parseJsonLine(value) {
  const line = terminalLine(value);
  if (line === null || Buffer.byteLength(line) > QUALIFICATION_JSON_LIMIT) fail("scanner_seaweed_go_s3_qualification_json_invalid");
  try { return JSON.parse(line); }
  catch { fail("scanner_seaweed_go_s3_qualification_json_invalid"); }
}

function journalClone(journal) { return clone(journal); }

export async function runSeaweedGoS3InertQualification(input, operations) {
  const operationNames = ["assertInputsUnchanged", "statFilesystems", "assertNamesAbsent", "execute", "captureFile", "lockFile",
    "copyOwnedFile", "elapsedMs", "cleanupOwned", "cleanupAbsent"];
  if (!exactKeys(input, ["sourcePreflight", "runId", "paths"]) || !canonicalUuid(input.runId) ||
      !exactKeys(input.paths, ["scratchDirectory", "python", "inspector"]) || !absolute(input.paths.scratchDirectory) ||
      input.paths.python !== "/usr/bin/python3" || !absolute(input.paths.inspector) || !operations ||
      Object.keys(operations).length !== operationNames.length || operationNames.some((name) => typeof operations[name] !== "function")) {
    fail("scanner_seaweed_go_s3_inert_qualification_invalid");
  }
  const sourcePreflight = validateSeaweedGoS3SourcePreflightReceipt(input.sourcePreflight);
  const names = seaweedGoS3QualificationNames({ runId: input.runId, scratchDirectory: input.paths.scratchDirectory });
  const journal = { schemaVersion: 1, owner: input.runId, labels: { control: QUALIFICATION_CONTROL_LABEL, owner: input.runId },
    paths: [], images: [], containers: [] };
  const evidence = [];
  let initialResources, finalResources, fixture, sourceImage, sourceContainer, sourceDiff, sourceExport, deletion, filteredImage, finalSave;
  let roundtripContainer, roundtripDiff, roundtrip, primaryError = null, finiteRefusal = null, refusalStage = null, cleanup = null;
  let startElapsed = null, latestElapsed = null, privateOutputBytes = 0;
  const checkElapsed = async () => {
    const current = await operations.elapsedMs();
    if (!Number.isSafeInteger(current) || current < 0 || latestElapsed !== null && current < latestElapsed ||
        startElapsed !== null && current - startElapsed > QUALIFICATION_WHOLE_TIMEOUT_MS) fail("scanner_seaweed_go_s3_qualification_timeout");
    if (startElapsed === null) startElapsed = current;
    latestElapsed = current;
  };
  const execute = async (spec) => {
    await checkElapsed();
    const remainingMs = QUALIFICATION_WHOLE_TIMEOUT_MS - (latestElapsed - startElapsed);
    if (remainingMs <= 0) fail("scanner_seaweed_go_s3_qualification_timeout");
    const boundedSpec = Object.freeze({ ...spec, timeoutMs: Math.min(spec.timeoutMs, remainingMs) });
    const result = validateExecution(await operations.execute(boundedSpec), boundedSpec);
    privateOutputBytes += Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
    if (privateOutputBytes > QUALIFICATION_JSON_LIMIT) fail("scanner_seaweed_go_s3_qualification_resource_limit");
    await checkElapsed();
    return result;
  };
  const python = async (spec) => {
    const expectedKind = QUALIFICATION_OPERATION_KINDS[spec.operation];
    if (!expectedKind) fail("scanner_seaweed_go_s3_qualification_process_invalid");
    refusalStage = expectedKind;
    const result = await execute(spec);
    if (result.stderr !== "") fail("scanner_seaweed_go_s3_qualification_process_invalid");
    const parsed = parseJsonLine(result.stdout);
    if (parsed?.kind !== expectedKind) fail("scanner_seaweed_go_s3_qualification_process_invalid");
    if (result.exitCode === 0) {
      const report = validateSeaweedGoS3QualificationInspection(parsed); evidence.push(report); return report;
    }
    if (result.exitCode === 2) throw seaweedGoS3QualificationRefusalError(parsed);
    fail("scanner_seaweed_go_s3_qualification_process_invalid");
  };
  const quiet = async (spec) => {
    const result = await execute(spec);
    if (result.exitCode !== 0 || result.stdout !== "" || result.stderr !== "") fail("scanner_seaweed_go_s3_qualification_process_invalid");
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const capture = async (file) => validateCapture(await operations.captureFile({ file, cap: QUALIFICATION_FILE_LIMIT }));
  const recheckResources = async () => {
    const current = validateSeaweedGoS3FilesystemEvidence(await operations.statFilesystems({
      scratchDirectory: names.scratchDirectory, dockerRootDirectory: sourcePreflight.tools.docker.dockerRootDir,
    }));
    if (initialResources && (initialResources.sameFilesystem !== current.sameFilesystem ||
        initialResources.scratch.path !== current.scratch.path || initialResources.scratch.filesystemId !== current.scratch.filesystemId ||
        initialResources.docker.path !== current.docker.path || initialResources.docker.filesystemId !== current.docker.filesystemId)) {
      fail("scanner_seaweed_go_s3_filesystem_invalid");
    }
    return current;
  };
  const addPath = (stage, file) => {
    const entry = { stage, path: file, attempted: true, snapshot: null }; journal.paths.push(entry); return entry;
  };
  const checkControlBudget = (anticipatedFileBytes = 0) => {
    if (!Number.isSafeInteger(anticipatedFileBytes) || anticipatedFileBytes < 0 || anticipatedFileBytes > QUALIFICATION_FILE_LIMIT) {
      fail("scanner_seaweed_go_s3_qualification_resource_limit");
    }
    const fileBytes = journal.paths.reduce((sum, entry) => sum + (entry.snapshot?.bytes ?? 0), 0);
    const fixtureBytes = journal.paths.find((entry) => entry.stage === "fixture")?.snapshot?.bytes ?? 0;
    const filteredBytes = journal.paths.find((entry) => entry.stage === "filtered-rootfs")?.snapshot?.bytes ?? 0;
    const dockerBytes = fixtureBytes + filteredBytes + Math.max(fixtureBytes, filteredBytes);
    if (fileBytes + anticipatedFileBytes + dockerBytes + privateOutputBytes > QUALIFICATION_TOTAL_LIMIT) {
      fail("scanner_seaweed_go_s3_qualification_resource_limit");
    }
  };
  const addImage = (stage, tag) => {
    const entry = { stage, tag, attempted: true, imageId: null }; journal.images.push(entry); return entry;
  };
  const addContainer = (stage, name) => {
    const entry = { stage, name, attempted: true, containerId: null, volumeNames: [] }; journal.containers.push(entry); return entry;
  };
  const inspectImage = async (image, expected) => {
    const result = await execute(seaweedGoS3ImageInspectArguments({ image }));
    if (result.exitCode !== 0 || result.stderr !== "") fail("scanner_seaweed_go_s3_qualification_process_invalid");
    return validateSeaweedGoS3QualificationImage(parseJsonLine(result.stdout), expected);
  };
  const inspectContainer = async (container, expected) => {
    const result = await execute(seaweedGoS3ContainerInspectArguments({ container }));
    if (result.exitCode !== 0 || result.stderr !== "") fail("scanner_seaweed_go_s3_qualification_process_invalid");
    return validateSeaweedGoS3QualificationContainer(parseJsonLine(result.stdout), expected);
  };
  try {
    await checkElapsed(); await operations.assertInputsUnchanged();
    initialResources = await recheckResources();
    const absent = await operations.assertNamesAbsent(names);
    if (!exactKeys(absent, ["containersAbsent", "imagesAbsent", "filesAbsent"]) || Object.values(absent).some((entry) => entry !== true)) {
      fail("scanner_seaweed_go_s3_qualification_ownership_ambiguous");
    }

    const fixturePath = addPath("fixture", names.paths.fixture);
    await recheckResources();
    checkControlBudget(QUALIFICATION_FILE_LIMIT);
    const fixtureWrite = await python(seaweedGoS3FixtureWriteArguments({ python: input.paths.python, inspector: input.paths.inspector,
      archive: names.paths.fixture }));
    if (fixtureWrite.kind !== "INERT_FIXTURE_V1" || fixtureWrite.operation !== "WRITE") fail("scanner_seaweed_go_s3_qualification_inspection_invalid");
    await operations.lockFile(names.paths.fixture); fixturePath.snapshot = await capture(names.paths.fixture);
    checkControlBudget();
    fixture = await python(seaweedGoS3FixtureInspectArguments({ python: input.paths.python, inspector: input.paths.inspector,
      archive: names.paths.fixture }));
    if (fixture.kind !== "INERT_FIXTURE_V1" || fixture.operation !== "INSPECT" ||
        !jsonEqual(fixtureWrite.archive, fixture.archive) || fixture.archive.sha256 !== fixturePath.snapshot.sha256 ||
        fixture.archive.bytes !== fixturePath.snapshot.bytes) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");

    const sourceImageEntry = addImage("source", names.tags.source);
    await recheckResources();
    checkControlBudget();
    const sourceImport = await execute(seaweedGoS3ControlImportArguments({ names, archive: names.paths.fixture, stage: "source" }));
    const sourceImportedId = terminalLine(sourceImport.stdout);
    if (sourceImport.exitCode !== 0 || sourceImport.stderr !== "" || !dockerId(sourceImportedId)) {
      fail("scanner_seaweed_go_s3_qualification_ownership_ambiguous");
    }
    sourceImageEntry.imageId = sourceImportedId;
    sourceImage = await inspectImage(sourceImportedId, { owner: input.runId, stage: "source", tag: names.tags.source,
      imageId: sourceImportedId });

    const sourceContainerEntry = addContainer("source", names.containers.source);
    const sourceCreate = await execute(seaweedGoS3ContainerCreateArguments({ names, imageId: sourceImage.imageId, stage: "source" }));
    const sourceContainerId = terminalLine(sourceCreate.stdout);
    if (sourceCreate.exitCode !== 0 || sourceCreate.stderr !== "" || !containerId(sourceContainerId)) {
      fail("scanner_seaweed_go_s3_qualification_ownership_ambiguous");
    }
    sourceContainerEntry.containerId = sourceContainerId;
    sourceContainer = await inspectContainer(sourceContainerId, { owner: input.runId, stage: "source", name: names.containers.source,
      imageId: sourceImage.imageId });
    sourceContainerEntry.volumeNames = [sourceContainer.mounts[0].name];
    const sourceBefore = await quiet(seaweedGoS3ContainerDiffArguments({ container: sourceContainerId, phase: "before" }));
    const sourceExportPath = addPath("source-export", names.paths.sourceExport);
    await recheckResources();
    checkControlBudget(QUALIFICATION_FILE_LIMIT);
    await quiet(seaweedGoS3ContainerExportArguments({ container: sourceContainerId, archive: names.paths.sourceExport }));
    const sourceAfter = await quiet(seaweedGoS3ContainerDiffArguments({ container: sourceContainerId, phase: "after" }));
    sourceDiff = { before: sourceBefore, after: sourceAfter };
    await operations.lockFile(names.paths.sourceExport); sourceExportPath.snapshot = await capture(names.paths.sourceExport);
    checkControlBudget();
    sourceExport = await python(seaweedGoS3ExportCompareArguments({ python: input.paths.python, inspector: input.paths.inspector,
      original: names.paths.fixture, exported: names.paths.sourceExport }));
    if (sourceExport.kind !== "INERT_EXPORT_SEMANTICS_V1" || sourceExport.exported.sha256 !== sourceExportPath.snapshot.sha256 ||
        sourceExport.exported.bytes !== sourceExportPath.snapshot.bytes) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");

    const filteredPath = addPath("filtered-rootfs", names.paths.filteredRootfs);
    await recheckResources();
    checkControlBudget(QUALIFICATION_FILE_LIMIT);
    const sourceSnapshotBeforeCopy = await capture(names.paths.sourceExport);
    if (!jsonEqual(sourceSnapshotBeforeCopy, sourceExportPath.snapshot)) fail("scanner_seaweed_go_s3_qualification_file_changed");
    await operations.copyOwnedFile({ source: names.paths.sourceExport, destination: names.paths.filteredRootfs });
    await quiet(seaweedGoS3DeleteHelpersArguments({ archive: names.paths.filteredRootfs }));
    await operations.lockFile(names.paths.filteredRootfs); filteredPath.snapshot = await capture(names.paths.filteredRootfs);
    checkControlBudget();
    const sourceSnapshotAfterDelete = await capture(names.paths.sourceExport);
    if (!jsonEqual(sourceSnapshotAfterDelete, sourceExportPath.snapshot)) fail("scanner_seaweed_go_s3_qualification_file_changed");
    deletion = await python(seaweedGoS3DeleteCompareArguments({ python: input.paths.python, inspector: input.paths.inspector,
      original: names.paths.sourceExport, filtered: names.paths.filteredRootfs }));
    if (deletion.kind !== "INERT_RAW_DELETE_V1" || deletion.filtered.sha256 !== filteredPath.snapshot.sha256 ||
        deletion.filtered.bytes !== filteredPath.snapshot.bytes) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");

    const filteredImageEntry = addImage("filtered", names.tags.filtered);
    await recheckResources();
    checkControlBudget();
    const filteredImport = await execute(seaweedGoS3ControlImportArguments({ names, archive: names.paths.filteredRootfs, stage: "filtered" }));
    const filteredImportedId = terminalLine(filteredImport.stdout);
    if (filteredImport.exitCode !== 0 || filteredImport.stderr !== "" || !dockerId(filteredImportedId)) {
      fail("scanner_seaweed_go_s3_qualification_ownership_ambiguous");
    }
    filteredImageEntry.imageId = filteredImportedId;
    filteredImage = await inspectImage(filteredImportedId, { owner: input.runId, stage: "filtered", tag: names.tags.filtered,
      imageId: filteredImportedId });

    const finalSavePath = addPath("final-save", names.paths.finalSave);
    await recheckResources();
    checkControlBudget(QUALIFICATION_FILE_LIMIT);
    const reboundImage = await inspectImage(names.tags.filtered, { owner: input.runId, stage: "filtered", tag: names.tags.filtered,
      imageId: filteredImage.imageId });
    if (!jsonEqual(reboundImage, filteredImage)) fail("scanner_seaweed_go_s3_qualification_image_changed");
    await quiet(seaweedGoS3ImageSaveArguments({ tag: names.tags.filtered, imageId: filteredImage.imageId,
      archive: names.paths.finalSave }));
    await operations.lockFile(names.paths.finalSave); finalSavePath.snapshot = await capture(names.paths.finalSave);
    checkControlBudget();
    finalSave = await python(seaweedGoS3LegacySaveInspectArguments({ python: input.paths.python, inspector: input.paths.inspector,
      archive: names.paths.finalSave, imageId: filteredImage.imageId, tag: names.tags.filtered,
      diffId: `sha256:${filteredPath.snapshot.sha256}`, created: filteredImage.created, owner: input.runId }));
    if (finalSave.kind !== "INERT_LEGACY_SAVE_V1" || finalSave.archive.sha256 !== finalSavePath.snapshot.sha256 ||
        finalSave.archive.bytes !== finalSavePath.snapshot.bytes) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");

    const roundtripContainerEntry = addContainer("filtered", names.containers.filtered);
    const roundtripCreate = await execute(seaweedGoS3ContainerCreateArguments({ names, imageId: filteredImage.imageId, stage: "filtered" }));
    const roundtripContainerId = terminalLine(roundtripCreate.stdout);
    if (roundtripCreate.exitCode !== 0 || roundtripCreate.stderr !== "" || !containerId(roundtripContainerId)) {
      fail("scanner_seaweed_go_s3_qualification_ownership_ambiguous");
    }
    roundtripContainerEntry.containerId = roundtripContainerId;
    roundtripContainer = await inspectContainer(roundtripContainerId, { owner: input.runId, stage: "filtered",
      name: names.containers.filtered, imageId: filteredImage.imageId });
    roundtripContainerEntry.volumeNames = [roundtripContainer.mounts[0].name];
    const roundtripBefore = await quiet(seaweedGoS3ContainerDiffArguments({ container: roundtripContainerId, phase: "before" }));
    const roundtripPath = addPath("roundtrip-export", names.paths.roundtripExport);
    await recheckResources();
    checkControlBudget(QUALIFICATION_FILE_LIMIT);
    await quiet(seaweedGoS3ContainerExportArguments({ container: roundtripContainerId, archive: names.paths.roundtripExport }));
    const roundtripAfter = await quiet(seaweedGoS3ContainerDiffArguments({ container: roundtripContainerId, phase: "after" }));
    roundtripDiff = { before: roundtripBefore, after: roundtripAfter };
    await operations.lockFile(names.paths.roundtripExport); roundtripPath.snapshot = await capture(names.paths.roundtripExport);
    checkControlBudget();
    roundtrip = await python(seaweedGoS3FilteredExportCompareArguments({ python: input.paths.python, inspector: input.paths.inspector,
      filtered: names.paths.filteredRootfs, exported: names.paths.roundtripExport }));
    if (roundtrip.kind !== "INERT_FILTERED_EXPORT_SEMANTICS_V1" || roundtrip.exported.sha256 !== roundtripPath.snapshot.sha256 ||
        roundtrip.exported.bytes !== roundtripPath.snapshot.bytes) fail("scanner_seaweed_go_s3_qualification_inspection_invalid");

    const recaptured = await Promise.all(journal.paths.map(async (entry) => ({ entry, snapshot: await capture(entry.path) })));
    if (recaptured.some(({ entry, snapshot }) => !jsonEqual(snapshot, entry.snapshot))) fail("scanner_seaweed_go_s3_qualification_file_changed");
    checkControlBudget();
    await operations.assertInputsUnchanged();
    finalResources = await recheckResources();
    await checkElapsed();
  } catch (error) {
    primaryError = error;
    finiteRefusal = qualificationRefusalDetails.get(error) ?? null;
    if (finiteRefusal) {
      try { await operations.assertInputsUnchanged(); }
      catch (integrityError) { primaryError = integrityError; finiteRefusal = null; }
    }
  } finally {
    let cleanupError = null;
    try { await operations.cleanupOwned(journalClone(journal)); }
    catch (error) { cleanupError = error; }
    try {
      const absent = await operations.cleanupAbsent(journalClone(journal));
      if (!exactKeys(absent, ["containersAbsent", "imagesAbsent", "volumesAbsent", "filesAbsent"]) ||
          Object.values(absent).some((entry) => entry !== true)) cleanupError = new Error("scanner_seaweed_go_s3_cleanup_uncertain");
      else cleanup = clone(absent);
    } catch (error) { cleanupError = error; }
    if (cleanupError) {
      primaryError = new Error("scanner_seaweed_go_s3_cleanup_uncertain");
      finiteRefusal = null;
    }
  }
  if (!primaryError) {
    try { await operations.assertInputsUnchanged(); await checkElapsed(); }
    catch (error) { primaryError = error; finiteRefusal = null; }
  } else if (finiteRefusal && cleanup) {
    try { await operations.assertInputsUnchanged(); await checkElapsed(); }
    catch (error) { primaryError = error; finiteRefusal = null; }
  }
  const sourceResources = clone(sourcePreflight.resources);
  const resources = { initial: initialResources ?? sourceResources, final: finalResources ?? initialResources ?? sourceResources };
  if (primaryError) {
    if (finiteRefusal && cleanup) {
      const receipt = validateSeaweedGoS3QualificationReceipt({ schemaVersion: 1, kind: "SEAWEED_GO_S3_INERT_QUALIFICATION_V1",
        state: "INERT_QUALIFICATION_REFUSED", authority: "DIAGNOSTIC_ONLY_NOT_ADMITTED", construction: "NOT_ATTEMPTED",
        stage: refusalStage, source: sourcePreflight.source, sourcePreflight, tools: sourcePreflight.tools, resources,
        evidence, refusal: finiteRefusal, inputsUnchanged: true, cleanup });
      qualificationRefusalReceipts.set(primaryError, receipt);
    }
    throw primaryError;
  }
  return validateSeaweedGoS3QualificationReceipt({ schemaVersion: 1, kind: "SEAWEED_GO_S3_INERT_QUALIFICATION_V1",
    state: "INERT_QUALIFICATION_PASSED", authority: "DIAGNOSTIC_ONLY_NOT_ADMITTED", construction: "PENDING_NOT_IMPLEMENTED",
    source: sourcePreflight.source, sourcePreflight, tools: sourcePreflight.tools, resources, fixture, sourceImage, sourceContainer,
    sourceDiff, sourceExport, deletion, filteredImage, finalSave, roundtripContainer, roundtripDiff, roundtrip,
    inputsUnchanged: true, cleanup });
}
