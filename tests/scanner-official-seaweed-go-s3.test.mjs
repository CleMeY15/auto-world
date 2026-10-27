import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SEAWEED_GO_S3_SOURCE,
  runSeaweedGoS3SourcePreflight,
  seaweedGoS3DockerInfoArguments,
  seaweedGoS3GnuTarVersionArguments,
  seaweedGoS3PythonVersionArguments,
  seaweedGoS3ResourceRequirements,
  seaweedGoS3SourceSaveArguments,
  seaweedGoS3SourceRefusalError,
  seaweedGoS3SourceRefusalReceipt,
  validateSeaweedGoS3AuxiliaryEnvelope,
  validateSeaweedGoS3AuxiliaryDiagnostic,
  validateSeaweedGoS3EnvelopeDiagnostic,
  validateSeaweedGoS3Profile,
  validateSeaweedGoS3ManifestDiagnostic,
  validateSeaweedGoS3SourceEnvelope,
  validateSeaweedGoS3SourceInspection,
  validateSeaweedGoS3SourcePreflightReceipt,
  validateSeaweedGoS3SourceRefusal,
} from "../scripts/scanner/seaweed-go-s3.mjs";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const clone = (value) => JSON.parse(JSON.stringify(value));
const auxiliaryOrderedSetSha256 = (records) => createHash("sha256").update(JSON.stringify(records.map((record) => ({
  bytes: record.bytes,
  id: record.id,
  keySetSha256: record.keySetSha256,
  parent: record.parent,
  payloadSha256: record.payloadSha256,
})))).digest("hex");
const sourceImageId = "sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6";
const archiveSha256 = "2".repeat(64);
const profile = JSON.parse(readFileSync(new URL("../infra/managed-images/seaweed-go-s3/profile.json", import.meta.url)));
const sourceDiffIds = [
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
];
const source = Object.freeze({
  reference: "chrislusf/seaweedfs@sha256:3a522c379599e163433a636e75022630848b63a74f08ea37bf06f8d776e9a707",
  imageId: sourceImageId,
  manifestDigest: "sha256:3a522c379599e163433a636e75022630848b63a74f08ea37bf06f8d776e9a707",
  configDigest: "sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6",
  platform: "linux/amd64",
});

function absolute(name) {
  return path.resolve("synthetic", "seaweed-go-s3", name);
}

function input() {
  return {
    source: { ...source },
    paths: {
      archive: path.join(absolute("scratch"), "source-save.tar"),
      config: absolute("config.json"),
      inspector: absolute("seaweed_profile_archive.py"),
      python: absolute("python3"),
      scratchDirectory: absolute("scratch"),
    },
  };
}

function tools() {
  return {
    docker: {
      clientVersion: "28.0.4",
      serverVersion: "28.0.4",
      apiVersion: "1.48",
      dockerRootDir: absolute("docker-root"),
      operatingSystem: "Ubuntu Linux",
      architecture: "x86_64",
    },
    python: { version: "Python 3.12.8" },
    gnuTar: { version: "tar (GNU tar) 1.35" },
  };
}

function inspection() {
  const layers = Array.from({ length: 10 }, (_, index) => ({
    ordinal: index + 1,
    path: `${String(index + 1).padStart(2, "0")}/layer.tar`,
    sha256: sourceDiffIds[index],
    bytes: 10_240,
    memberCount: 1,
    metadataSha256: `${(index + 1) % 10}`.repeat(64),
    inventorySha256: `${(index + 2) % 10}`.repeat(64),
  }));
  return {
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "PASS",
    sourceConfigSha256: source.configDigest.slice("sha256:".length),
    archive: { bytes: 210_000_000, sha256: archiveSha256 },
    layers,
    totals: { layerCount: 10, layerBytes: 102_400, memberCount: 10 },
  };
}

function sourceEnvelope() {
  return {
    schemaVersion: 1,
    kind: "MOBY_28_OCI_COMPAT_V1",
    manifestSha256: "3".repeat(64),
    layoutSha256: "4".repeat(64),
    indexSha256: "5".repeat(64),
    ociManifestSha256: "6".repeat(64),
    descriptorCount: 10,
    rawLayerDescriptorsMatched: true,
  };
}

function productionAuxiliaryEnvelope() {
  return {
    schemaVersion: 1,
    kind: "MOBY_28_V1_AUXILIARY_FIXED_SOURCE_V1",
    createIdBinding: "NOT_RECOMPUTED",
    auxiliaryToRawLayerBinding: "NOT_INDEPENDENTLY_VERIFIED",
    candidateCount: 10,
    candidateBytes: 5913,
    candidateSetSha256: "3952537ce5e96cc1782f21c9dfc8ac8c000f6451a7cf399e7beeb9eb80b11a5e",
    payloadSha256s: [
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
    ],
    payloadBytes: [401, 477, 477, 477, 477, 477, 477, 477, 477, 1696],
    v1Ids: [
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
    ],
    keySetSha256s: [
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
    ],
    orderedSetSha256: "4ef427670dac48137a29c82eb56b679a0c42f662013b5834209a9fe96306f39a",
    semanticProjectionMatched: true,
  };
}

function mobyInspection() {
  const value = inspection();
  value.layers.forEach((layer, index) => {
    layer.path = `blobs/sha256/${sourceDiffIds[index]}`;
  });
  value.sourceEnvelope = sourceEnvelope();
  value.auxiliaryEnvelope = productionAuxiliaryEnvelope();
  return value;
}

function envelopeDiagnostic() {
  return {
    schemaVersion: 1,
    format: "MOBY_28_OCI_COMPAT_V1",
    node: "layer-source",
    predicate: "digest",
    ordinal: 4,
    observedType: "object",
    memberType: "file",
    expectedDigest: "7".repeat(64),
    actualDigest: "8".repeat(64),
    expectedBytes: 10_240,
    actualBytes: 10_240,
    knownKeysPresent: ["digest", "mediaType", "size"],
    unknownKeyCount: 0,
    unknownKeyNamesSha256: "9".repeat(64),
    mediaTypeClass: "oci-tar",
    mediaTypeSha256: "a".repeat(64),
  };
}

function outerExtraEnvelopeDiagnostic() {
  return {
    schemaVersion: 1,
    format: "MOBY_28_OCI_COMPAT_V1",
    node: "outer",
    predicate: "extra",
    ordinal: null,
    observedType: null,
    memberType: "file",
    expectedDigest: null,
    actualDigest: "b".repeat(64),
    expectedBytes: null,
    actualBytes: 477,
    knownKeysPresent: [],
    unknownKeyCount: null,
    unknownKeyNamesSha256: null,
    mediaTypeClass: null,
    mediaTypeSha256: null,
  };
}

function compatibleAuxiliaryDiagnostic() {
  const payloadSha256s = Array.from({ length: 10 }, (_, index) => `${index.toString(16)}`.repeat(64));
  const payloadBytes = Array.from({ length: 10 }, (_, index) => 200 + index);
  const v1Ids = Array.from({ length: 10 }, (_, index) => `${(index + 1).toString(16)}`.repeat(64));
  const keySetSha256s = Array.from({ length: 10 }, (_, index) => `${(index + 2).toString(16)}`.repeat(64));
  const ordered = payloadSha256s.map((payloadSha256, index) => ({
    payloadSha256,
    bytes: payloadBytes[index],
    id: v1Ids[index],
    parent: index === 0 ? null : v1Ids[index - 1],
    keySetSha256: keySetSha256s[index],
  }));
  return {
    schemaVersion: 1,
    kind: "MOBY_28_V1_AUXILIARY_DIAGNOSTIC",
    createIdBinding: "NOT_RECOMPUTED",
    candidateCount: 10,
    candidateBytes: payloadBytes.reduce((sum, value) => sum + value, 0),
    candidateSetSha256: "c".repeat(64),
    truncated: false,
    examinedCount: 10,
    classification: "COMPATIBLE_UNVERIFIED",
    firstMismatch: null,
    payloadSha256s,
    payloadBytes,
    v1Ids,
    keySetSha256s,
    parentChainMatched: true,
    orderedSetSha256: auxiliaryOrderedSetSha256(ordered),
  };
}

function failedAuxiliaryDiagnostic({
  candidateCount = 10,
  classification = "REFUSED",
  firstMismatch = "json",
  examinedCount = 1,
  parentChainMatched = null,
} = {}) {
  const value = compatibleAuxiliaryDiagnostic();
  value.candidateCount = candidateCount;
  value.candidateBytes = 1000;
  value.truncated = candidateCount > 10;
  value.examinedCount = examinedCount;
  value.classification = classification;
  value.firstMismatch = firstMismatch;
  value.payloadSha256s = [];
  value.payloadBytes = [];
  value.v1Ids = [];
  value.keySetSha256s = [];
  value.parentChainMatched = parentChainMatched;
  value.orderedSetSha256 = null;
  return value;
}

function auxiliaryRefusal() {
  return {
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "save_envelope_invalid" },
    envelopeDiagnostic: outerExtraEnvelopeDiagnostic(),
    auxiliaryDiagnostic: compatibleAuxiliaryDiagnostic(),
  };
}

function missingManifestDiagnostic() {
  return {
    schemaVersion: 1,
    outer: {
      ociLayoutPresent: false,
      indexJsonPresent: false,
      repositoriesPresent: false,
      blobsPrefixPresent: false,
    },
    manifest: {
      present: false,
      memberType: null,
      byteCount: null,
      sha256: null,
      jsonState: "not-observed",
      rootType: null,
      recordCount: null,
      firstRecordType: null,
      knownKeysPresent: [],
      knownValueTypes: { Config: null, LayerSources: null, Layers: null, Parent: null, RepoTags: null },
      unknownKeyCount: null,
      unknownKeyNamesSha256: null,
      configPathCategory: null,
      layersCount: null,
      layerPathCounts: null,
      repoTagsType: null,
      repoTagsCount: null,
      parentType: null,
      layerSourcesType: null,
      layerSourcesCount: null,
    },
  };
}

function completeManifestDiagnostic() {
  const value = missingManifestDiagnostic();
  value.outer = { ociLayoutPresent: true, indexJsonPresent: true, repositoriesPresent: true, blobsPrefixPresent: true };
  value.manifest = {
    present: true,
    memberType: "file",
    byteCount: 4096,
    sha256: "7".repeat(64),
    jsonState: "valid",
    rootType: "array",
    recordCount: 1,
    firstRecordType: "object",
    knownKeysPresent: ["Config", "LayerSources", "Layers", "Parent", "RepoTags"],
    knownValueTypes: { Config: "string", LayerSources: "object", Layers: "array", Parent: "null", RepoTags: "array" },
    unknownKeyCount: 2,
    unknownKeyNamesSha256: "8".repeat(64),
    configPathCategory: "legacy-config",
    layersCount: 3,
    layerPathCounts: { legacyLayer: 1, ociBlob: 1, other: 1 },
    repoTagsType: "array",
    repoTagsCount: 2,
    parentType: "null",
    layerSourcesType: "object",
    layerSourcesCount: 2,
  };
  return value;
}

function harness({ sameFilesystem = false, failAt = null } = {}) {
  const events = [];
  const requirements = seaweedGoS3ResourceRequirements({ sameFilesystem });
  const scratch = { path: absolute("scratch"), filesystemId: sameFilesystem ? "shared" : "scratch-fs",
    freeBytes: sameFilesystem ? requirements.combinedRequiredFreeBytes : requirements.scratchRequiredFreeBytes };
  const docker = { path: absolute("docker-root"), filesystemId: sameFilesystem ? "shared" : "docker-fs",
    freeBytes: sameFilesystem ? requirements.combinedRequiredFreeBytes : requirements.dockerRequiredFreeBytes };
  const invoke = async (name, value) => {
    events.push(name);
    if (failAt === name) throw new Error(`injected_${name}`);
    return value;
  };
  const operations = {
    assertInputsUnchanged: () => invoke("assertInputsUnchanged", true),
    probeTools: () => invoke("probeTools", tools()),
    statFilesystems: () => invoke("statFilesystems", { scratch, docker }),
    saveSource: (request) => invoke("saveSource", request),
    lockArchive: () => invoke("lockArchive", true),
    captureArchive: () => invoke("captureArchive", { bytes: 210_000_000, sha256: archiveSha256 }),
    inspectSource: () => invoke("inspectSource", inspection()),
    removeOwnedArchive: () => invoke("removeOwnedArchive", true),
    archiveAbsent: () => invoke("archiveAbsent", true),
  };
  return { events, operations };
}

test("resource requirements independently reserve the maximum simultaneous scratch and Docker storage", () => {
  const actual = seaweedGoS3ResourceRequirements();
  const scratchTask = 4 * 2 * GiB + 64 * MiB + 64 * MiB;
  const dockerTask = 2 * 2 * GiB + 64 * MiB;
  assert.equal(actual.scratchTaskBytes, scratchTask);
  assert.equal(actual.dockerTaskBytes, dockerTask);
  assert.equal(actual.scratchRequiredFreeBytes, Math.ceil(1.25 * scratchTask) + GiB);
  assert.equal(actual.dockerRequiredFreeBytes, Math.ceil(1.25 * dockerTask) + GiB);
  assert.equal(actual.combinedRequiredFreeBytes, null);
});

test("shared storage uses one reserve after summing both task peaks", () => {
  const actual = seaweedGoS3ResourceRequirements({ sameFilesystem: true });
  assert.equal(actual.scratchRequiredFreeBytes, null);
  assert.equal(actual.dockerRequiredFreeBytes, null);
  assert.equal(actual.combinedRequiredFreeBytes, Math.ceil(1.25 * (actual.scratchTaskBytes + actual.dockerTaskBytes)) + GiB);
});

test("source save arguments are fixed, bounded and contain no caller command", () => {
  const archive = absolute("source.tar");
  const actual = seaweedGoS3SourceSaveArguments({ archive, imageId: sourceImageId });
  assert.equal(actual.command, "/usr/bin/bash");
  assert.equal(actual.timeoutMs, 300_000);
  assert.equal(actual.archiveLimitBytes, 2 * GiB);
  assert.deepEqual(actual.args.slice(0, 3), ["--noprofile", "--norc", "-c"]);
  assert.deepEqual(actual.args.slice(-2), [archive, sourceImageId]);
  assert.match(actual.args[3], /docker image save --output "\$1" "\$2"/u);
  assert.doesNotMatch(actual.args.join(" "), /https?:|credential|token|volume-rust|worker-rust/u);
});

test("tool probes use fixed read-only version and daemon-info arguments", () => {
  assert.deepEqual(seaweedGoS3DockerInfoArguments(), ["info", "--format", "{{json .}}"]);
  assert.deepEqual(seaweedGoS3PythonVersionArguments(), ["--version"]);
  assert.deepEqual(seaweedGoS3GnuTarVersionArguments(), ["--version"]);
});

test("successful preflight performs the fixed order, deletes the source save and stops before construction", async () => {
  const item = harness();
  const result = await runSeaweedGoS3SourcePreflight(input(), item.operations);
  assert.deepEqual(item.events, [
    "assertInputsUnchanged", "probeTools", "statFilesystems", "assertInputsUnchanged", "statFilesystems",
    "saveSource", "lockArchive", "captureArchive", "inspectSource", "assertInputsUnchanged",
    "removeOwnedArchive", "archiveAbsent",
  ]);
  assert.equal(result.state, "SOURCE_PREFLIGHT_PASSED");
  assert.equal(result.construction, "PENDING_NOT_IMPLEMENTED");
  assert.equal(result.archiveRemoved, true);
  assert.equal(result.authority, "DIAGNOSTIC_ONLY_NOT_ADMITTED");
});

test("a source inspection refusal never reaches construction and cleans the owned archive", async () => {
  const item = harness({ failAt: "inspectSource" });
  await assert.rejects(runSeaweedGoS3SourcePreflight(input(), item.operations), /injected_inspectSource/u);
  assert.deepEqual(item.events.slice(-3), ["inspectSource", "removeOwnedArchive", "archiveAbsent"]);
  assert.equal(item.events.includes("construction"), false);
});

test("finite source refusal evidence is bound to captured bytes and released only after verified cleanup", async () => {
  const item = harness();
  const refusal = {
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "archive_truncated", layerOrdinal: 3, member: "usr/lib/example" },
  };
  const finiteError = seaweedGoS3SourceRefusalError(refusal);
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw finiteError;
  };
  item.operations.removeOwnedArchive = async () => {
    item.events.push("removeOwnedArchive");
    assert.equal(seaweedGoS3SourceRefusalReceipt(finiteError), null);
  };
  item.operations.archiveAbsent = async () => {
    item.events.push("archiveAbsent");
    assert.equal(seaweedGoS3SourceRefusalReceipt(finiteError), null);
    return true;
  };
  const error = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("finite refusal unexpectedly passed"),
    (caught) => caught,
  );
  assert.equal(error.message, "scanner_seaweed_go_s3_source_preflight_refused");
  assert.deepEqual(item.events.slice(-4), ["inspectSource", "assertInputsUnchanged", "removeOwnedArchive", "archiveAbsent"]);
  const receipt = seaweedGoS3SourceRefusalReceipt(error);
  const requirements = seaweedGoS3ResourceRequirements();
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    kind: "SEAWEED_GO_S3_SOURCE_PREFLIGHT_V1",
    state: "SOURCE_PREFLIGHT_REFUSED",
    authority: "DIAGNOSTIC_ONLY_NOT_ADMITTED",
    construction: "NOT_ATTEMPTED",
    source: { ...source },
    tools: tools(),
    resources: {
      sameFilesystem: false,
      requirements,
      scratch: { path: absolute("scratch"), filesystemId: "scratch-fs", freeBytes: requirements.scratchRequiredFreeBytes },
      docker: { path: absolute("docker-root"), filesystemId: "docker-fs", freeBytes: requirements.dockerRequiredFreeBytes },
    },
    archive: { bytes: 210_000_000, sha256: archiveSha256 },
    refusal,
    sourceUnchanged: true,
    archiveRemoved: true,
  });
  assert.equal(receipt.resources.sameFilesystem, false);
  assert.deepEqual(receipt.resources.requirements, requirements);
  assert.equal(item.events.includes("construction"), false);
  assert.equal(item.events.includes("runtime"), false);
});

test("cleanup uncertainty suppresses an otherwise finite refusal receipt", async () => {
  const item = harness();
  const refusal = {
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "layer_digest_mismatch", layerOrdinal: 7 },
  };
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw seaweedGoS3SourceRefusalError(refusal);
  };
  item.operations.archiveAbsent = async () => {
    item.events.push("archiveAbsent");
    return false;
  };
  const error = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("uncertain cleanup unexpectedly passed"),
    (caught) => caught,
  );
  assert.match(error.message, /scanner_seaweed_go_s3_cleanup_uncertain/u);
  assert.equal(seaweedGoS3SourceRefusalReceipt(error), null);
});

test("a failed first removal keeps cleanup ownership fatal without retry or accepted refusal evidence", async () => {
  const item = harness({ failAt: "removeOwnedArchive" });
  const finiteError = seaweedGoS3SourceRefusalError({
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "save_unreferenced_member", member: "foreign" },
  });
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw finiteError;
  };
  const error = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("failed cleanup unexpectedly passed"),
    (caught) => caught,
  );
  assert.equal(error.message, "injected_removeOwnedArchive");
  assert.equal(item.events.filter((event) => event === "removeOwnedArchive").length, 1);
  assert.equal(item.events.includes("archiveAbsent"), false);
  assert.equal(seaweedGoS3SourceRefusalReceipt(error), null);
  assert.equal(seaweedGoS3SourceRefusalReceipt(finiteError), null);
});

test("an input-integrity failure suppresses finite refusal evidence while still cleaning the archive", async () => {
  const item = harness();
  const finiteError = seaweedGoS3SourceRefusalError(auxiliaryRefusal());
  let integrityChecks = 0;
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw finiteError;
  };
  item.operations.assertInputsUnchanged = async () => {
    item.events.push("assertInputsUnchanged");
    integrityChecks += 1;
    if (integrityChecks === 3) throw new Error("injected_source_changed");
  };
  const error = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("changed input unexpectedly passed"),
    (caught) => caught,
  );
  assert.equal(error.message, "injected_source_changed");
  assert.equal(seaweedGoS3SourceRefusalReceipt(error), null);
  assert.deepEqual(item.events.slice(-3), ["assertInputsUnchanged", "removeOwnedArchive", "archiveAbsent"]);
});

test("a partially written source save is owned before command completion and is always removed", async () => {
  const item = harness({ failAt: "saveSource" });
  await assert.rejects(runSeaweedGoS3SourcePreflight(input(), item.operations), /injected_saveSource/u);
  assert.deepEqual(item.events.slice(-3), ["saveSource", "removeOwnedArchive", "archiveAbsent"]);
});

test("a disk refusal happens before source save", async () => {
  const item = harness();
  item.operations.statFilesystems = async () => {
    item.events.push("statFilesystems");
    return {
      scratch: { path: absolute("scratch"), filesystemId: "scratch-fs", freeBytes: 1 },
      docker: { path: absolute("docker-root"), filesystemId: "docker-fs", freeBytes: 1 },
    };
  };
  await assert.rejects(runSeaweedGoS3SourcePreflight(input(), item.operations), /scanner_seaweed_go_s3_disk_insufficient/u);
  assert.equal(item.events.includes("saveSource"), false);
  assert.equal(item.events.includes("removeOwnedArchive"), false);
});

test("the second free-space check can refuse changed capacity before the first large write", async () => {
  const item = harness();
  let calls = 0;
  const valid = item.operations.statFilesystems;
  item.operations.statFilesystems = async (...args) => {
    calls += 1;
    if (calls === 1) return valid(...args);
    item.events.push("statFilesystems");
    return {
      scratch: { path: absolute("scratch"), filesystemId: "scratch-fs", freeBytes: 1 },
      docker: { path: absolute("docker-root"), filesystemId: "docker-fs", freeBytes: 1 },
    };
  };
  await assert.rejects(runSeaweedGoS3SourcePreflight(input(), item.operations), /scanner_seaweed_go_s3_disk_insufficient/u);
  assert.equal(item.events.includes("saveSource"), false);
});

test("shared-filesystem evidence accepts independent sufficient readings from the same live filesystem", async () => {
  const item = harness({ sameFilesystem: true });
  item.operations.statFilesystems = async () => {
    item.events.push("statFilesystems");
    const requirement = seaweedGoS3ResourceRequirements({ sameFilesystem: true }).combinedRequiredFreeBytes;
    return {
      scratch: { path: absolute("scratch"), filesystemId: "shared", freeBytes: requirement },
      docker: { path: absolute("docker-root"), filesystemId: "shared", freeBytes: requirement + 1 },
    };
  };
  const result = await runSeaweedGoS3SourcePreflight(input(), item.operations);
  assert.equal(result.resources.sameFilesystem, true);
});

test("shared-filesystem evidence refuses when either live reading is below the combined bound", async () => {
  const item = harness({ sameFilesystem: true });
  item.operations.statFilesystems = async () => {
    item.events.push("statFilesystems");
    const requirement = seaweedGoS3ResourceRequirements({ sameFilesystem: true }).combinedRequiredFreeBytes;
    return {
      scratch: { path: absolute("scratch"), filesystemId: "shared", freeBytes: requirement },
      docker: { path: absolute("docker-root"), filesystemId: "shared", freeBytes: requirement - 1 },
    };
  };
  await assert.rejects(runSeaweedGoS3SourcePreflight(input(), item.operations), /scanner_seaweed_go_s3_disk_insufficient/u);
  assert.equal(item.events.includes("saveSource"), false);
});

test("cleanup uncertainty is fatal even after an otherwise valid inspection", async () => {
  const item = harness();
  item.operations.archiveAbsent = async () => {
    item.events.push("archiveAbsent");
    return false;
  };
  await assert.rejects(runSeaweedGoS3SourcePreflight(input(), item.operations), /scanner_seaweed_go_s3_cleanup_uncertain/u);
});

test("preflight receipts reject admission, construction or source-profile substitution", () => {
  const item = harness();
  const requirements = seaweedGoS3ResourceRequirements();
  const base = {
    schemaVersion: 1,
    kind: "SEAWEED_GO_S3_SOURCE_PREFLIGHT_V1",
    state: "SOURCE_PREFLIGHT_PASSED",
    authority: "DIAGNOSTIC_ONLY_NOT_ADMITTED",
    construction: "PENDING_NOT_IMPLEMENTED",
    source: { ...source },
    tools: tools(),
    resources: { sameFilesystem: false, requirements,
      scratch: { path: absolute("scratch"), filesystemId: "scratch", freeBytes: requirements.scratchRequiredFreeBytes },
      docker: { path: absolute("docker-root"), filesystemId: "docker", freeBytes: requirements.dockerRequiredFreeBytes } },
    archive: { bytes: 210_000_000, sha256: archiveSha256 },
    inspection: inspection(),
    sourceUnchanged: true,
    archiveRemoved: true,
  };
  assert.equal(validateSeaweedGoS3SourcePreflightReceipt(base).construction, "PENDING_NOT_IMPLEMENTED");
  for (const mutate of [
    (value) => { value.authority = "ADMITTED"; },
    (value) => { value.construction = "COMPLETE"; },
    (value) => { value.source.reference = "chrislusf/seaweedfs:latest"; },
    (value) => { value.source.manifestDigest = `sha256:${"f".repeat(64)}`; },
    (value) => { value.inspection.totals.layerCount = 9; },
    (value) => { value.inspection.archiveSha256 = "f".repeat(64); },
  ]) {
    const changed = clone(base);
    mutate(changed);
    assert.throws(() => validateSeaweedGoS3SourcePreflightReceipt(changed), /scanner_seaweed_go_s3_/u);
  }
  assert.equal(item.events.length, 0);
  assert.equal(SEAWEED_GO_S3_SOURCE.reference, source.reference);
});

test("preflight rejects archive aliases and non-owned archive destinations before invoking operations", async () => {
  for (const mutate of [
    (value) => { value.paths.archive = absolute("outside.tar"); },
    (value) => { value.paths.config = value.paths.archive; },
    (value) => { value.paths.inspector = value.paths.archive; },
    (value) => { value.paths.python = value.paths.config; },
  ]) {
    const changed = input();
    mutate(changed);
    const item = harness();
    await assert.rejects(runSeaweedGoS3SourcePreflight(changed, item.operations), /scanner_seaweed_go_s3_source_preflight_invalid/u);
    assert.deepEqual(item.events, []);
  }
});

test("profile metadata keeps exact source pins and leaves support dates unset before activation", () => {
  assert.equal(validateSeaweedGoS3Profile(profile).state, "SOURCE_PREFLIGHT_ONLY");
  for (const mutate of [
    (value) => { value.state = "ACTIVE"; },
    (value) => { value.admission = "AUTHORIZED"; },
    (value) => { value.milestone2 = "ESTABLISHED"; },
    (value) => { value.source.platformDigest = `sha256:${"f".repeat(64)}`; },
    (value) => { value.source.diffIds.reverse(); },
    (value) => { value.unsupportedHelpers[0].bytes += 1; },
    (value) => { value.support.durationYears = 2; },
    (value) => { value.support.continuousSecurityControls = false; },
    (value) => { value.support.additionalArchiveDays = 364; },
    (value) => { value.support.startsAt = "2026-10-27T00:00:00Z"; },
    (value) => { value.support.endsAt = "2027-10-27T00:00:00Z"; },
  ]) {
    const changed = clone(profile);
    mutate(changed);
    assert.throws(() => validateSeaweedGoS3Profile(changed), /scanner_seaweed_go_s3_profile_invalid/u);
  }
});

test("only the reviewed finite source refusals can be recorded as profile evidence", () => {
  const base = {
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "archive_truncated", layerOrdinal: 4, member: "usr/lib/example" },
  };
  assert.equal(validateSeaweedGoS3SourceRefusal(base).refusal.code, "archive_truncated");
  for (const mutate of [
    (value) => { value.refusal.code = "transport_response_lost"; },
    (value) => { value.refusal.code = "internal_error"; },
    (value) => { value.refusal.member = "C:\\private\\source-save.tar"; },
    (value) => { value.refusal.layerOrdinal = 11; },
    (value) => { value.refusal.rawError = "unexpected exception"; },
  ]) {
    const changed = clone(base);
    mutate(changed);
    assert.throws(() => validateSeaweedGoS3SourceRefusal(changed), /scanner_seaweed_go_s3_source_refusal_invalid/u);
  }
});

test("manifest diagnostics accept only the bounded missing and fully observed shapes", () => {
  assert.deepEqual(validateSeaweedGoS3ManifestDiagnostic(missingManifestDiagnostic()), missingManifestDiagnostic());
  assert.deepEqual(validateSeaweedGoS3ManifestDiagnostic(completeManifestDiagnostic()), completeManifestDiagnostic());
});

test("manifest diagnostics reject inconsistent commitments, observations and category totals", () => {
  for (const mutate of [
    (value) => { value.manifest.unknownKeyCount = null; },
    (value) => { value.manifest.unknownKeyNamesSha256 = null; },
    (value) => { value.manifest.knownKeysPresent.pop(); },
    (value) => { value.manifest.firstRecordType = null; },
    (value) => { value.manifest.recordCount = 0; },
    (value) => { value.manifest.layersCount = null; },
    (value) => { value.manifest.layerPathCounts = null; },
    (value) => { value.manifest.layerPathCounts.other += 1; },
    (value) => { value.manifest.knownValueTypes.Config = "boolean"; },
    (value) => { value.manifest.repoTagsCount = null; },
    (value) => { value.manifest.layerSourcesCount = null; },
    (value) => { value.manifest.parentType = null; },
    (value) => { value.manifest.jsonState = "invalid"; },
    (value) => { value.manifest.unknownKeyNamesSha256 = "not-a-sha256"; },
    (value) => { value.manifest.configPathCategory = "host-path"; },
    (value) => { value.manifest.byteCount = 4 * MiB + 1; },
    (value) => { value.manifest.unbounded = "raw manifest payload"; },
  ]) {
    const changed = completeManifestDiagnostic();
    mutate(changed);
    assert.throws(
      () => validateSeaweedGoS3ManifestDiagnostic(changed),
      /scanner_seaweed_go_s3_manifest_diagnostic_invalid/u,
    );
  }
});

test("manifest diagnostics are accepted only on named manifest refusals", () => {
  for (const code of ["save_manifest_missing", "save_manifest_invalid"]) {
    const refusal = {
      schemaVersion: 1,
      profile: "go-s3-4.51-v1",
      evidenceClass: "SOURCE_LAYER_PREFLIGHT",
      status: "REFUSED",
      refusal: { code },
      manifestDiagnostic: missingManifestDiagnostic(),
    };
    assert.deepEqual(validateSeaweedGoS3SourceRefusal(refusal), refusal);
  }
  const unrelated = {
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "archive_truncated" },
    manifestDiagnostic: missingManifestDiagnostic(),
  };
  assert.throws(
    () => validateSeaweedGoS3SourceRefusal(unrelated),
    /scanner_seaweed_go_s3_source_refusal_invalid/u,
  );
});

test("a manifest diagnostic becomes available only after verified archive removal", async () => {
  const item = harness();
  const finiteError = seaweedGoS3SourceRefusalError({
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "save_manifest_invalid" },
    manifestDiagnostic: completeManifestDiagnostic(),
  });
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw finiteError;
  };
  item.operations.removeOwnedArchive = async () => {
    item.events.push("removeOwnedArchive");
    assert.equal(seaweedGoS3SourceRefusalReceipt(finiteError), null);
  };
  const caught = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("manifest refusal unexpectedly passed"),
    (error) => error,
  );
  const receipt = seaweedGoS3SourceRefusalReceipt(caught);
  assert.deepEqual(receipt.refusal.manifestDiagnostic, completeManifestDiagnostic());
  assert.equal(receipt.archiveRemoved, true);
  assert.equal(receipt.sourceUnchanged, true);
});

test("cleanup uncertainty suppresses a bounded manifest diagnostic receipt", async () => {
  const item = harness();
  const finiteError = seaweedGoS3SourceRefusalError({
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "save_manifest_missing" },
    manifestDiagnostic: missingManifestDiagnostic(),
  });
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw finiteError;
  };
  item.operations.archiveAbsent = async () => {
    item.events.push("archiveAbsent");
    return false;
  };
  const caught = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("uncertain cleanup unexpectedly passed"),
    (error) => error,
  );
  assert.match(caught.message, /scanner_seaweed_go_s3_cleanup_uncertain/u);
  assert.equal(seaweedGoS3SourceRefusalReceipt(caught), null);
  assert.equal(seaweedGoS3SourceRefusalReceipt(finiteError), null);
});

test("a Moby source envelope requires the fixed OCI layer paths and exact proof", () => {
  assert.deepEqual(validateSeaweedGoS3SourceEnvelope(sourceEnvelope()), sourceEnvelope());
  assert.deepEqual(validateSeaweedGoS3SourceInspection(mobyInspection()), mobyInspection());
  for (const mutate of [
    (value) => { delete value.sourceEnvelope; },
    (value) => { delete value.auxiliaryEnvelope; },
    (value) => { value.layers[0].path = "01/layer.tar"; },
    (value) => { value.sourceEnvelope.kind = "OCI_GENERIC_V1"; },
    (value) => { value.sourceEnvelope.manifestSha256 = "f".repeat(63); },
    (value) => { value.sourceEnvelope.descriptorCount = 9; },
    (value) => { value.sourceEnvelope.rawLayerDescriptorsMatched = false; },
    (value) => { value.sourceEnvelope.claim = "compressed-equivalence"; },
  ]) {
    const changed = mobyInspection();
    mutate(changed);
    assert.throws(() => validateSeaweedGoS3SourceInspection(changed), /scanner_seaweed_go_s3_/u);
  }
});

test("the fixed auxiliary envelope verifies literal pins, dense arrays and both commitments", () => {
  assert.deepEqual(
    validateSeaweedGoS3AuxiliaryEnvelope(productionAuxiliaryEnvelope()),
    productionAuxiliaryEnvelope(),
  );
  for (const mutate of [
    (value) => { value.kind = "MOBY_28_V1_AUXILIARY_GENERIC_V1"; },
    (value) => { value.createIdBinding = "RECOMPUTED"; },
    (value) => { value.auxiliaryToRawLayerBinding = "VERIFIED"; },
    (value) => { value.candidateBytes += 1; },
    (value) => { value.candidateSetSha256 = "f".repeat(64); },
    (value) => { value.payloadSha256s[3] = "f".repeat(64); },
    (value) => { value.payloadBytes[3] += 1; },
    (value) => { value.v1Ids[3] = "f".repeat(64); },
    (value) => { value.keySetSha256s[3] = "f".repeat(64); },
    (value) => { value.orderedSetSha256 = "f".repeat(64); },
    (value) => { value.semanticProjectionMatched = false; },
    (value) => { delete value.payloadSha256s[3]; },
    (value) => { delete value.payloadBytes[3]; },
    (value) => { delete value.v1Ids[3]; },
    (value) => { delete value.keySetSha256s[3]; },
    (value) => { value.privatePath = "C:\\private\\source-save.tar"; },
  ]) {
    const changed = productionAuxiliaryEnvelope();
    mutate(changed);
    assert.throws(
      () => validateSeaweedGoS3AuxiliaryEnvelope(changed),
      /scanner_seaweed_go_s3_auxiliary_envelope_invalid/u,
    );
  }
});

test("full inspection associates the auxiliary proof only with the Moby graph proof", () => {
  const missing = mobyInspection();
  delete missing.auxiliaryEnvelope;
  assert.throws(
    () => validateSeaweedGoS3SourceInspection(missing),
    /scanner_seaweed_go_s3_source_preflight_refused/u,
  );

  const auxiliaryOnly = inspection();
  auxiliaryOnly.auxiliaryEnvelope = productionAuxiliaryEnvelope();
  assert.throws(
    () => validateSeaweedGoS3SourceInspection(auxiliaryOnly),
    /scanner_seaweed_go_s3_source_preflight_refused/u,
  );

  const legacy = inspection();
  assert.deepEqual(validateSeaweedGoS3SourceInspection(legacy), legacy);
  assert.deepEqual(validateSeaweedGoS3SourceEnvelope(sourceEnvelope()), sourceEnvelope());
});

test("PASS and refusal schemas reject auxiliary proof and diagnostic mixtures", () => {
  const passWithDiagnostic = mobyInspection();
  passWithDiagnostic.auxiliaryDiagnostic = compatibleAuxiliaryDiagnostic();
  assert.throws(
    () => validateSeaweedGoS3SourceInspection(passWithDiagnostic),
    /scanner_seaweed_go_s3_source_preflight_refused/u,
  );

  const refusalWithProof = auxiliaryRefusal();
  refusalWithProof.auxiliaryEnvelope = productionAuxiliaryEnvelope();
  assert.throws(
    () => validateSeaweedGoS3SourceRefusal(refusalWithProof),
    /scanner_seaweed_go_s3_source_refusal_invalid/u,
  );
});

test("a complete Moby inspection remains bound into the cleaned preflight receipt", async () => {
  const item = harness();
  item.operations.inspectSource = () => {
    item.events.push("inspectSource");
    return mobyInspection();
  };
  const receipt = await runSeaweedGoS3SourcePreflight(input(), item.operations);
  assert.deepEqual(receipt.inspection.sourceEnvelope, sourceEnvelope());
  assert.deepEqual(receipt.inspection.auxiliaryEnvelope, productionAuxiliaryEnvelope());
  assert.deepEqual(
    receipt.inspection.layers.map((layer) => layer.path),
    sourceDiffIds.map((digest) => `blobs/sha256/${digest}`),
  );
  assert.equal(receipt.archiveRemoved, true);
  assert.equal(receipt.construction, "PENDING_NOT_IMPLEMENTED");
});

test("cleanup uncertainty suppresses a complete Moby auxiliary proof", async () => {
  const item = harness();
  item.operations.inspectSource = () => {
    item.events.push("inspectSource");
    return mobyInspection();
  };
  item.operations.archiveAbsent = async () => {
    item.events.push("archiveAbsent");
    return false;
  };
  await assert.rejects(
    runSeaweedGoS3SourcePreflight(input(), item.operations),
    /scanner_seaweed_go_s3_cleanup_uncertain/u,
  );
});

test("input drift suppresses a complete Moby auxiliary proof before cleanup", async () => {
  const item = harness();
  let integrityChecks = 0;
  item.operations.inspectSource = () => {
    item.events.push("inspectSource");
    return mobyInspection();
  };
  item.operations.assertInputsUnchanged = async () => {
    item.events.push("assertInputsUnchanged");
    integrityChecks += 1;
    if (integrityChecks === 3) throw new Error("injected_source_changed");
  };
  await assert.rejects(
    runSeaweedGoS3SourcePreflight(input(), item.operations),
    /injected_source_changed/u,
  );
  assert.deepEqual(item.events.slice(-3), ["assertInputsUnchanged", "removeOwnedArchive", "archiveAbsent"]);
});

test("synthetic fixture pins cannot substitute the fixed production source authority", () => {
  const changed = mobyInspection();
  changed.sourceConfigSha256 = "b".repeat(64);
  changed.layers.forEach((layer, index) => {
    layer.sha256 = `${index}`.repeat(64).slice(0, 64);
    layer.path = `blobs/sha256/${layer.sha256}`;
  });
  assert.throws(
    () => validateSeaweedGoS3SourceInspection(changed),
    /scanner_seaweed_go_s3_source_preflight_refused/u,
  );
});

test("envelope diagnostics reject unbounded or internally inconsistent observations", () => {
  assert.deepEqual(validateSeaweedGoS3EnvelopeDiagnostic(envelopeDiagnostic()), envelopeDiagnostic());
  const auxiliary = envelopeDiagnostic();
  auxiliary.node = "auxiliary";
  auxiliary.predicate = "keys";
  auxiliary.ordinal = 6;
  assert.deepEqual(validateSeaweedGoS3EnvelopeDiagnostic(auxiliary), auxiliary);
  const nonUtf8MediaType = envelopeDiagnostic();
  nonUtf8MediaType.mediaTypeClass = "other";
  nonUtf8MediaType.mediaTypeSha256 = null;
  assert.deepEqual(validateSeaweedGoS3EnvelopeDiagnostic(nonUtf8MediaType), nonUtf8MediaType);
  for (const mutate of [
    (value) => { value.node = "remote-registry"; },
    (value) => { value.predicate = "equivalence"; },
    (value) => { value.ordinal = 11; },
    (value) => { value.observedType = "undefined"; },
    (value) => { value.memberType = "device"; },
    (value) => { value.expectedDigest = "sha256:bad"; },
    (value) => { value.actualBytes = 2 * GiB + 1; },
    (value) => { value.knownKeysPresent.reverse(); },
    (value) => { value.unknownKeyCount = null; },
    (value) => { value.unknownKeyNamesSha256 = null; },
    (value) => { value.mediaTypeClass = null; },
    (value) => { value.mediaTypeSha256 = null; },
    (value) => { value.rawValue = "C:\\private\\source-save.tar"; },
  ]) {
    const changed = envelopeDiagnostic();
    mutate(changed);
    assert.throws(
      () => validateSeaweedGoS3EnvelopeDiagnostic(changed),
      /scanner_seaweed_go_s3_envelope_diagnostic_invalid/u,
    );
  }
});

test("envelope diagnostics are confined to the named envelope refusal", () => {
  const refusal = {
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "save_envelope_invalid" },
    envelopeDiagnostic: envelopeDiagnostic(),
  };
  assert.deepEqual(validateSeaweedGoS3SourceRefusal(refusal), refusal);
  for (const mutate of [
    (value) => { value.refusal.code = "save_manifest_invalid"; },
    (value) => { value.manifestDiagnostic = missingManifestDiagnostic(); },
  ]) {
    const changed = clone(refusal);
    mutate(changed);
    assert.throws(
      () => validateSeaweedGoS3SourceRefusal(changed),
      /scanner_seaweed_go_s3_source_refusal_invalid/u,
    );
  }
  const passWithDiagnostic = mobyInspection();
  passWithDiagnostic.envelopeDiagnostic = envelopeDiagnostic();
  assert.throws(
    () => validateSeaweedGoS3SourceInspection(passWithDiagnostic),
    /scanner_seaweed_go_s3_source_preflight_refused/u,
  );
});

test("a verified cleanup preserves the exact bounded envelope refusal", async () => {
  const item = harness();
  const refusal = {
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "save_envelope_invalid" },
    envelopeDiagnostic: envelopeDiagnostic(),
  };
  const finiteError = seaweedGoS3SourceRefusalError(refusal);
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw finiteError;
  };
  item.operations.removeOwnedArchive = async () => {
    item.events.push("removeOwnedArchive");
    assert.equal(seaweedGoS3SourceRefusalReceipt(finiteError), null);
  };
  const caught = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("envelope refusal unexpectedly passed"),
    (error) => error,
  );
  assert.deepEqual(seaweedGoS3SourceRefusalReceipt(caught).refusal, refusal);
});

test("compatible auxiliary commitments are recomputed before validation", () => {
  assert.deepEqual(
    validateSeaweedGoS3AuxiliaryDiagnostic(compatibleAuxiliaryDiagnostic()),
    compatibleAuxiliaryDiagnostic(),
  );
  for (const mutate of [
    (value) => { value.createIdBinding = "RECOMPUTED"; },
    (value) => { value.candidateBytes += 1; },
    (value) => { value.truncated = true; },
    (value) => { value.examinedCount = 9; },
    (value) => { value.classification = "REFUSED"; },
    (value) => { value.firstMismatch = "json"; },
    (value) => { value.parentChainMatched = false; },
    (value) => { value.payloadSha256s[1] = value.payloadSha256s[0]; },
    (value) => { value.v1Ids[1] = value.v1Ids[0]; },
    (value) => { value.payloadBytes[0] = 0; },
    (value) => { value.orderedSetSha256 = "f".repeat(64); },
    (value) => { value.privatePath = "C:\\private\\source-save.tar"; },
  ]) {
    const changed = compatibleAuxiliaryDiagnostic();
    mutate(changed);
    assert.throws(
      () => validateSeaweedGoS3AuxiliaryDiagnostic(changed),
      /scanner_seaweed_go_s3_auxiliary_diagnostic_invalid/u,
    );
  }
});

test("auxiliary commitments reject sparse evidence arrays", () => {
  const value = compatibleAuxiliaryDiagnostic();
  delete value.keySetSha256s[3];
  assert.throws(
    () => validateSeaweedGoS3AuxiliaryDiagnostic(value),
    /scanner_seaweed_go_s3_auxiliary_diagnostic_invalid/u,
  );
});

test("auxiliary failure states retain finite count, parse and topology boundaries", () => {
  const aggregateSizeFailure = failedAuxiliaryDiagnostic({ firstMismatch: "total-size", examinedCount: 0 });
  aggregateSizeFailure.candidateBytes = 300_000;
  const valid = [
    failedAuxiliaryDiagnostic({ candidateCount: 9, firstMismatch: "cardinality", examinedCount: 0 }),
    failedAuxiliaryDiagnostic({
      candidateCount: 11,
      classification: "LIMIT_EXCEEDED",
      firstMismatch: "candidate-limit",
      examinedCount: 0,
    }),
    failedAuxiliaryDiagnostic({ firstMismatch: "size", examinedCount: 0 }),
    aggregateSizeFailure,
    failedAuxiliaryDiagnostic({ firstMismatch: "json", examinedCount: 4 }),
    failedAuxiliaryDiagnostic({ firstMismatch: "duplicate-id", examinedCount: 10 }),
    failedAuxiliaryDiagnostic({ firstMismatch: "cycle", examinedCount: 10, parentChainMatched: false }),
  ];
  valid.forEach((value) => assert.deepEqual(validateSeaweedGoS3AuxiliaryDiagnostic(value), value));
  for (const mutate of [
    (value) => { value.truncated = !value.truncated; },
    (value) => { value.examinedCount = value.candidateCount + 1; },
    (value) => { value.payloadSha256s = ["a".repeat(64)]; },
    (value) => { value.orderedSetSha256 = "a".repeat(64); },
    (value) => { value.firstMismatch = "create-id"; },
  ]) {
    const changed = failedAuxiliaryDiagnostic({ candidateCount: 9, firstMismatch: "cardinality", examinedCount: 0 });
    mutate(changed);
    assert.throws(
      () => validateSeaweedGoS3AuxiliaryDiagnostic(changed),
      /scanner_seaweed_go_s3_auxiliary_diagnostic_invalid/u,
    );
  }
});

test("total-size failures reject bytes impossible for ten bounded candidates", () => {
  const value = failedAuxiliaryDiagnostic({ firstMismatch: "total-size", examinedCount: 0 });
  value.candidateBytes = 655_361;
  assert.throws(
    () => validateSeaweedGoS3AuxiliaryDiagnostic(value),
    /scanner_seaweed_go_s3_auxiliary_diagnostic_invalid/u,
  );
});

test("auxiliary evidence can join only an outer-extra envelope refusal", () => {
  assert.deepEqual(validateSeaweedGoS3SourceRefusal(auxiliaryRefusal()), auxiliaryRefusal());
  for (const mutate of [
    (value) => { value.refusal.code = "save_manifest_invalid"; },
    (value) => { value.envelopeDiagnostic.node = "raw-layer"; },
    (value) => { value.envelopeDiagnostic.predicate = "member"; },
    (value) => { value.manifestDiagnostic = missingManifestDiagnostic(); },
    (value) => { delete value.envelopeDiagnostic; },
  ]) {
    const changed = auxiliaryRefusal();
    mutate(changed);
    assert.throws(
      () => validateSeaweedGoS3SourceRefusal(changed),
      /scanner_seaweed_go_s3_source_refusal_invalid/u,
    );
  }
  const pass = mobyInspection();
  pass.auxiliaryDiagnostic = compatibleAuxiliaryDiagnostic();
  assert.throws(
    () => validateSeaweedGoS3SourceInspection(pass),
    /scanner_seaweed_go_s3_source_preflight_refused/u,
  );
});

test("verified cleanup preserves compatible auxiliary evidence as a refusal without construction", async () => {
  const item = harness();
  const finiteError = seaweedGoS3SourceRefusalError(auxiliaryRefusal());
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw finiteError;
  };
  const caught = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("compatible auxiliary diagnostic unexpectedly passed"),
    (error) => error,
  );
  const receipt = seaweedGoS3SourceRefusalReceipt(caught);
  assert.deepEqual(receipt.refusal, auxiliaryRefusal());
  assert.equal(receipt.state, "SOURCE_PREFLIGHT_REFUSED");
  assert.equal(receipt.construction, "NOT_ATTEMPTED");
  assert.equal(Object.hasOwn(receipt, "sourceEnvelope"), false);
  assert.equal(receipt.archiveRemoved, true);
});

test("cleanup uncertainty suppresses auxiliary and envelope diagnostics", async () => {
  const item = harness();
  const finiteError = seaweedGoS3SourceRefusalError(auxiliaryRefusal());
  item.operations.inspectSource = async () => {
    item.events.push("inspectSource");
    throw finiteError;
  };
  item.operations.archiveAbsent = async () => {
    item.events.push("archiveAbsent");
    return false;
  };
  const caught = await runSeaweedGoS3SourcePreflight(input(), item.operations).then(
    () => assert.fail("uncertain cleanup unexpectedly passed"),
    (error) => error,
  );
  assert.match(caught.message, /scanner_seaweed_go_s3_cleanup_uncertain/u);
  assert.equal(seaweedGoS3SourceRefusalReceipt(caught), null);
  assert.equal(seaweedGoS3SourceRefusalReceipt(finiteError), null);
});
