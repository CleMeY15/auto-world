import assert from "node:assert/strict";
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
  validateSeaweedGoS3Profile,
  validateSeaweedGoS3ManifestDiagnostic,
  validateSeaweedGoS3SourcePreflightReceipt,
  validateSeaweedGoS3SourceRefusal,
} from "../scripts/scanner/seaweed-go-s3.mjs";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const clone = (value) => JSON.parse(JSON.stringify(value));
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
  const finiteError = seaweedGoS3SourceRefusalError({
    schemaVersion: 1,
    profile: "go-s3-4.51-v1",
    evidenceClass: "SOURCE_LAYER_PREFLIGHT",
    status: "REFUSED",
    refusal: { code: "save_manifest_invalid" },
    manifestDiagnostic: completeManifestDiagnostic(),
  });
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
