import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  TEST_ONLY_expectedSeaweedRuntimePersistenceProof, TEST_ONLY_expectedSeaweedRuntimeProfileProof,
  TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof,
} from "../scripts/seaweed-image/candidate-runtime.mjs";
import { TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof } from
  "../scripts/seaweed-image/backup-restore.mjs";
import { TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof } from
  "../scripts/seaweed-image/host-loopback.mjs";
import {
  validateRemoteSeaweedAuditBinding, validateRemoteSeaweedRuntimeCandidateReceipt,
  withVerifiedRemoteSeaweedRuntimeCandidate,
} from "../scripts/seaweed-image/candidate-remote-runtime.mjs";
import { validateRemoteSeaweedRuntimeMaterialReceipt } from
  "../scripts/seaweed-image/candidate-remote.mjs";

const imageId = `sha256:${"a".repeat(64)}`;
const diffId = `sha256:${"b".repeat(64)}`;
const layerDigest = `sha256:${"c".repeat(64)}`;
const publisherRunId = "40000000001";
const auditRunId = "40000000002";
const runtimeRunId = "40000000003";
const publisherRevision = "1".repeat(40);
const auditRevision = "2".repeat(40);
const runtimeRevision = "3".repeat(40);
const phaseNames = [
  "managed_engine", "registry_login", "raw_tag_manifest", "anonymous_digest_denied", "raw_digest_manifest",
  "local_inventory_before", "local_collision_check", "exact_digest_pull", "simple_local_alias",
  "private_docker_save", "full_archive_validation", "runtime_diagnostics", "owned_docker_cleanup",
  "owned_temporary_cleanup",
];

function policy() {
  const raw = JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: imageId, size: 321 },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: layerDigest, size: 777 }] });
  const manifestDigest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  return { kind: "SEAWEED_REMOTE_CANDIDATE_POLICY_V1", authority: "REVIEWED_MAIN_POLICY",
    repository: "CleMeY15/auto-world", owner: "CleMeY15", image: "ghcr.io/clemey15/auto-world-seaweedfs-s3",
    platform: "linux/amd64", publishedTag: `candidate-${publisherRunId}-attempt-1`,
    subject: `ghcr.io/clemey15/auto-world-seaweedfs-s3@${manifestDigest}`,
    manifest: { digest: manifestDigest, bytes: Buffer.byteLength(raw),
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: { digest: imageId, size: 321, mediaType: "application/vnd.oci.image.config.v1+json" },
      layer: { digest: layerDigest, size: 777, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
        compressedSizeVerification: "RECORDED_ONLY" } },
    candidate: { imageId, diffId, rawSize: 1024, memberCount: 1 },
    publisher: { workflowPath: ".github/workflows/seaweed-candidate-publish.yml", runId: publisherRunId,
      runNumber: "1", runAttempt: "1", recipeRevision: publisherRevision, receiptSha256: "d".repeat(64),
      result: "PASSED" },
    source: { runId: "35875100636", codeRevision: "4".repeat(40),
      binaryDigest: `sha256:${"5".repeat(64)}`, baseManifestDigest: `sha256:${"6".repeat(64)}`,
      archiveSha256: "7".repeat(64), archiveBytes: 4096, configSha256: "a".repeat(64), configBytes: 321,
      savedLayerSha256: "8".repeat(64), savedLayerBytes: 1024 } };
}

function auditBinding(policyValue = policy()) {
  return { kind: "SEAWEED_REMOTE_AUDIT_BINDING_V1", state: "COMPLETE", subject: policyValue.subject,
    runId: auditRunId, runNumber: "1", runAttempt: "1", recipeRevision: auditRevision,
    artifact: { id: 123456, name: "seaweed-candidate-remote-audit-evidence", bytes: 4567,
      digest: `sha256:${"9".repeat(64)}` },
    files: { receipt: { sha256: "a".repeat(64), bytes: 4096 },
      vulnerability: { sha256: "b".repeat(64), bytes: 8192 },
      cyclonedx: { sha256: "c".repeat(64), bytes: 16384 } } };
}

function expected() { return { imageId, runId: runtimeRunId, recipeRevision: runtimeRevision }; }
function suite() {
  return { basic: TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected()),
    persistence: TEST_ONLY_expectedSeaweedRuntimePersistenceProof(expected()),
    strict: { runtimeProof: TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected()),
      strictProof: TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof(expected()) },
    backup: TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof(expected(), "d".repeat(64), 2048),
    hostLoopback: TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof(expected()) };
}

function material(policyValue = policy()) {
  return { kind: "SEAWEED_REMOTE_RUNTIME_MATERIAL_RECEIPT_V1", state: "VERIFIED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
    publication: "PUBLISHED_UNADMITTED", execution: "VERIFIED_DIAGNOSTIC", registryWrite: "NOT_ATTEMPTED",
    runId: runtimeRunId, recipeRevision: runtimeRevision, subject: policyValue.subject,
    alias: `auto-world-seaweed-s3:remote-${runtimeRunId}-attempt-1`,
    remoteManifest: { state: "RAW_MANIFEST_VERIFIED", digest: policyValue.manifest.digest,
      bytes: policyValue.manifest.bytes, config: policyValue.manifest.config, layer: policyValue.manifest.layer },
    engine: { state: "ENGINE_VERIFIED", docker: "28.0.4|28.0.4", buildx: "buildx 0.37.1",
      serverVersion: "28.0.4", pullResponse: "SUCCESS", compressedDigestVerification: "MANAGED_MOBY_PULL",
      compressedSizeVerification: "RECORDED_ONLY" },
    image: { imageId, diffId, platform: "linux/amd64" },
    archive: { state: "ARCHIVE_VERIFIED", imageId, diffId, archiveSha256: "e".repeat(64),
      archiveBytes: 4096, saveResponse: "SUCCESS" },
    publisher: { result: policyValue.publisher.result, runId: publisherRunId,
      recipeRevision: publisherRevision, receiptSha256: policyValue.publisher.receiptSha256 },
    provenance: { publisherRunId, publisherRecipeRevision: publisherRevision,
      publisherReceiptSha256: policyValue.publisher.receiptSha256, sourceRunId: policyValue.source.runId,
      sourceCodeRevision: policyValue.source.codeRevision },
    phases: phaseNames.map((name) => ({ name, result: "PASSED", durationMs: 1 })) };
}

function input(policyValue = policy()) {
  return { parent: "/tmp/remote-runtime", policy: policyValue, runId: runtimeRunId,
    recipeRevision: runtimeRevision, signal: undefined, validateFilesystem: () => true,
    validateRuntimeConfig: () => true, auditBinding: auditBinding(policyValue) };
}

function context(policyValue = policy()) {
  const operationSignal = new globalThis.AbortController().signal;
  return { parent: "/tmp/remote-runtime/owned", dockerConfig: "/tmp/remote-runtime/owned/docker-auth",
    imageId, diffId, runId: runtimeRunId, recipeRevision: runtimeRevision, signal: operationSignal,
    subject: policyValue.subject, archiveProof: Object.freeze({ state: "ARCHIVE_VERIFIED" }) };
}

function successfulDependencies(order = [], policyValue = policy(), cleanup = { complete: false }) {
  const proof = suite();
  return {
    materialize: async (_value, inspect) => {
      order.push("materialize"); const runtime = await inspect(context(policyValue));
      order.push("provider-cleanup"); cleanup.complete = true;
      return { material: material(policyValue), runtime };
    },
    validateMaterialReceipt: (receipt, currentPolicy) =>
      validateRemoteSeaweedRuntimeMaterialReceipt(receipt, currentPolicy),
    verifyRuntime: async () => { order.push("basic"); return proof.basic; },
    verifyPersistence: async () => { order.push("persistence"); return proof.persistence; },
    verifyStrict: async () => { order.push("strict"); return { runtimeProof: proof.strict.runtimeProof,
      strictContentionProof: proof.strict.strictProof }; },
    verifyBackup: async () => { order.push("backup"); return proof.backup; },
    verifyHostLoopback: async () => { order.push("hostLoopback"); return proof.hostLoopback; },
  };
}

test("remote runtime executes the five existing verifiers sequentially and returns only after provider cleanup", async () => {
  const order = []; const cleanup = { complete: false };
  const inputValue = input(); const dependencies = successfulDependencies(order, policy(), cleanup);
  const verifyRuntime = dependencies.verifyRuntime;
  dependencies.verifyRuntime = async (runtimeInput) => {
    assert.equal(runtimeInput.signal instanceof globalThis.AbortSignal, true);
    assert.notEqual(runtimeInput.signal, inputValue.signal);
    return verifyRuntime(runtimeInput);
  };
  const receipt = await withVerifiedRemoteSeaweedRuntimeCandidate(inputValue, dependencies);
  assert.deepEqual(order, ["materialize", "basic", "persistence", "strict", "backup", "hostLoopback",
    "provider-cleanup"]);
  assert.equal(cleanup.complete, true);
  assert.equal(receipt.kind, "SEAWEED_REMOTE_RUNTIME_CANDIDATE_RECEIPT_V1");
  assert.equal(receipt.imageExecution, "VERIFIED_DIAGNOSTIC");
  assert.equal(receipt.vulnerabilityAudit, "EXACT_REMOTE_AUDIT_COMPLETE");
  assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.equal(Object.isFrozen(receipt.suite.strict), true);
});

test("audit binding is closed, cross-subject bound and deeply frozen", () => {
  const policyValue = policy(); const value = validateRemoteSeaweedAuditBinding(auditBinding(policyValue),
    policyValue);
  assert.equal(Object.isFrozen(value.files.receipt), true);
  for (const changed of [
    { ...auditBinding(policyValue), extra: true },
    { ...auditBinding(policyValue), subject: `${policyValue.image}@sha256:${"f".repeat(64)}` },
    { ...auditBinding(policyValue), artifact: { ...auditBinding(policyValue).artifact, digest: "9".repeat(64) } },
    { ...auditBinding(policyValue), files: { ...auditBinding(policyValue).files,
      receipt: { sha256: "z".repeat(64), bytes: 4096 } } },
  ]) assert.throws(() => validateRemoteSeaweedAuditBinding(changed, policyValue), /binding_invalid/u);
});

test("proof substitution is rejected and later verifiers are short-circuited", async () => {
  const order = []; const deps = successfulDependencies(order);
  deps.verifyPersistence = async () => { order.push("persistence");
    return TEST_ONLY_expectedSeaweedRuntimePersistenceProof({ ...expected(), imageId: `sha256:${"f".repeat(64)}` }); };
  await assert.rejects(withVerifiedRemoteSeaweedRuntimeCandidate(input(), deps), (error) => {
    assert.equal(error.code, "seaweed_remote_runtime_candidate_failed");
    assert.equal(error.diagnosticFailure.code, "seaweed_candidate_runtime_persistence_failed");
    assert.equal(error.materialPrimaryFailure, "seaweed_remote_runtime_diagnostics_failed");
    return true;
  });
  assert.deepEqual(order, ["materialize", "basic", "persistence"]);
});

test("receipt validator rejects proof, audit, material and authorization substitutions", async () => {
  const policyValue = policy(); const binding = auditBinding(policyValue);
  const receipt = await withVerifiedRemoteSeaweedRuntimeCandidate(input(policyValue),
    successfulDependencies([], policyValue));
  assert.equal(validateRemoteSeaweedRuntimeCandidateReceipt(receipt, policyValue, binding).state, "VERIFIED");
  for (const changed of [
    { ...receipt, admission: "AUTHORIZED" },
    { ...receipt, auditBinding: { ...binding, runId: "40000000009" } },
    { ...receipt, material: { ...receipt.material, execution: "NOT_ATTEMPTED" } },
    { ...receipt, suite: { ...receipt.suite,
      basic: { ...receipt.suite.basic, runId: "40000000009" } } },
  ]) assert.throws(() => validateRemoteSeaweedRuntimeCandidateReceipt(changed, policyValue, binding),
  /receipt_invalid|binding_invalid|suite_invalid/u);
});

test("runtime primary and cleanup uncertainty remain separate from provider image and temporary cleanup", async () => {
  const deps = successfulDependencies([]);
  deps.verifyRuntime = async () => { throw Object.assign(new Error("runtime"), {
    code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_PROBE", reason: "READBACK_MISMATCH",
    runtimeCleanupFailure: { code: "seaweed_candidate_runtime_cleanup_failed",
      phase: "RUNTIME_CLEANUP", reason: "OWNERSHIP_UNCERTAIN" },
  }); };
  deps.materialize = async (_value, inspect) => {
    try { await inspect(context()); } catch {
      throw Object.assign(new Error("seaweed_remote_runtime_material_failed"), {
        code: "seaweed_remote_runtime_material_failed", inspectionFailed: true,
        primaryFailure: "seaweed_remote_runtime_diagnostics_failed",
        imageCleanupFailure: "seaweed_remote_candidate_image_cleanup_failed",
        temporaryCleanupFailure: "seaweed_remote_candidate_temporary_cleanup_failed",
      });
    }
  };
  await assert.rejects(withVerifiedRemoteSeaweedRuntimeCandidate(input(), deps), (error) => {
    assert.deepEqual(error.diagnosticFailure, { code: "seaweed_candidate_runtime_failed",
      phase: "RUNTIME_PROBE", reason: "READBACK_MISMATCH", runtimeCleanupFailure: {
        code: "seaweed_candidate_runtime_cleanup_failed", phase: "RUNTIME_CLEANUP",
        reason: "OWNERSHIP_UNCERTAIN" } });
    assert.equal(error.materialPrimaryFailure, "seaweed_remote_runtime_diagnostics_failed");
    assert.equal(error.imageCleanupFailure, "seaweed_remote_candidate_image_cleanup_failed");
    assert.equal(error.temporaryCleanupFailure, "seaweed_remote_candidate_temporary_cleanup_failed");
    assert.equal(JSON.stringify(error).includes("/tmp/"), false);
    return true;
  });
});

test("unknown failure values and malformed provider success never escape into public failure fields", async () => {
  const deps = successfulDependencies([]);
  deps.materialize = async () => { throw Object.assign(new Error("foreign secret /tmp/private"), {
    code: "foreign", primaryFailure: "foreign", imageCleanupFailure: "foreign",
  }); };
  await assert.rejects(withVerifiedRemoteSeaweedRuntimeCandidate(input(), deps), (error) => {
    assert.equal(error.code, "seaweed_remote_runtime_candidate_failed");
    assert.equal(error.diagnosticFailure, null);
    assert.equal(error.materialPrimaryFailure, null);
    assert.equal(JSON.stringify(error).includes("foreign"), false);
    return true;
  });
  const malformed = successfulDependencies([]); malformed.materialize = async (_value, inspect) => {
    await inspect(context()); return { material: material(), runtime: suite(), extra: true };
  };
  await assert.rejects(withVerifiedRemoteSeaweedRuntimeCandidate(input(), malformed),
    /seaweed_remote_runtime_candidate_failed/u);
});
