import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { retainLocalSeaweedCandidate, validateLocalSeaweedRetentionReceipt } from "../scripts/seaweed-image/candidate-local-retention.mjs";

const linux = process.platform === "linux";
const runId = "36340000001";
const recipeRevision = "a".repeat(40);
const policy = JSON.parse(readFileSync(new URL("../infra/seaweed-image/candidate-remote.json", import.meta.url)));
const imageId = policy.candidate.imageId;
const diffId = policy.candidate.diffId;
const subject = policy.subject;
const bytes = Buffer.alloc(4096, "bounded private candidate archive fixture\n");
const hash = createHash("sha256").update(bytes).digest("hex");

test("retention composes the real remote provider argument contract before credential rejection", { skip: !linux }, async () => {
  const value = scope();
  try {
    await assert.rejects(retainLocalSeaweedCandidate(value.input, { providerDependencies: { env: {} } }),
      /seaweed_remote_candidate_environment_invalid/u);
    assert.equal(existsSync(path.join(value.destination, "retention-receipt.json")), false);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});

function proof(overrides = {}) {
  return Object.freeze({ kind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1", authority: "PREPARATION_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", imageId, identityType: "CLASSIC_CONFIG_ID",
    tag: `auto-world-seaweed-s3:remote-${runId}-attempt-1`, serverVersion: "28.0.4",
    archiveSha256: hash, archiveBytes: bytes.length, archiveMembers: 9, configSha256: policy.source.configSha256,
    configBytes: policy.source.configBytes, layerSha256: policy.source.savedLayerSha256,
    layerBytes: policy.source.savedLayerBytes, diffId,
    rawSize: policy.candidate.rawSize, memberCount: policy.candidate.memberCount, ...overrides });
}
function remoteReceipt() {
  const recorded = JSON.parse(readFileSync(new URL("../infra/seaweed-image/candidate-remote-audit-receipt.json", import.meta.url))).candidate;
  return { ...recorded, runId, recipeRevision, alias: proof().tag,
    archive: { ...recorded.archive, archiveSha256: hash, archiveBytes: bytes.length } };
}
function scope() {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-local-retention-")); chmodSync(root, 0o700);
  const parent = path.join(root, "temporary"); const destination = path.join(root, "retained");
  mkdirSync(parent, { mode: 0o700 }); mkdirSync(destination, { mode: 0o700 });
  const input = { parent, destination, policy, runId, recipeRevision,
    validateFilesystem: () => {}, validateRuntimeConfig: () => {} };
  return { root, parent, destination, input };
}
function dependencies(options = {}) {
  let providerDependencies;
  const validateArchive = async ({ file }) => {
    assert.deepEqual(readFileSync(file), bytes);
    if (options.tamperProof) {
      writeFileSync(file, "tampered retained bytes");
      return proof({ archiveSha256: "0".repeat(64), archiveBytes: 23 });
    }
    return proof();
  };
  const remoteProvider = async (input, inspect, receivedDependencies) => {
    providerDependencies = receivedDependencies;
    const file = path.join(input.parent, "candidate.tar"); writeFileSync(file, bytes, { mode: 0o600 });
    if (options.abortBeforeCallback) options.controller.abort();
    try {
      await inspect({ file, archiveProof: proof(), policy: JSON.parse(JSON.stringify(input.policy)), subject, imageId, diffId,
        runId, recipeRevision, signal: input.signal });
    } finally { rmSync(file); }
    if (options.cleanupFailure) throw new Error("seaweed_remote_candidate_image_cleanup_failed");
    return remoteReceipt();
  };
  const result = { remoteProvider, validateArchive,
    providerDependencies: { env: { GITHUB_TOKEN: "not-serialized" } } };
  Object.defineProperty(result, "observed", { value: () => providerDependencies });
  return result;
}

test("retains validated bytes privately and publishes an explicitly local receipt after provider cleanup",
  { skip: !linux }, async () => {
    const value = scope(); const injected = dependencies();
    try {
      const result = await retainLocalSeaweedCandidate(value.input, injected);
      assert.deepEqual(readFileSync(result.archiveFile), bytes);
      assert.equal(lstatSync(result.archiveFile).mode & 0o777, 0o600);
      assert.equal(lstatSync(result.archiveFile).nlink, 1);
      assert.equal(lstatSync(result.receiptFile).mode & 0o777, 0o600);
      const persisted = JSON.parse(readFileSync(result.receiptFile, "utf8"));
      assert.deepEqual(persisted, result.receipt);
      assert.equal(result.receipt.kind, "SEAWEED_LOCAL_CANDIDATE_RETENTION_RECEIPT_V1");
      assert.equal(result.receipt.origin, "LOCAL_DIAGNOSTIC");
      assert.equal(result.receipt.executionId, `local-${runId}`);
      assert.equal(result.receipt.githubRunId, null);
      assert.equal(result.receipt.candidateAuthorization, "NOT_AUTHORIZED");
      assert.equal(result.receipt.signing, "NOT_ATTEMPTED");
      assert.equal(result.receipt.registryWrite, "NOT_ATTEMPTED");
      assert.equal(result.receipt.archiveProof.archiveSha256, hash);
      assert.deepEqual(validateLocalSeaweedRetentionReceipt(result.receipt, policy), result.receipt);
      for (const change of [{ origin: "GITHUB_ACTIONS" }, { signing: "SIGNED" }, { admission: "AUTHORIZED" },
        { extra: true }, { imageId: `sha256:${"0".repeat(64)}` },
        { archiveProof: { ...result.receipt.archiveProof, configSha256: "0".repeat(64) } }]) {
        assert.throws(() => validateLocalSeaweedRetentionReceipt({ ...result.receipt, ...change }, policy));
      }
      assert.equal(injected.observed().env.GITHUB_TOKEN, "not-serialized");
      assert.equal(readFileSync(result.receiptFile, "utf8").includes("not-serialized"), false);
    } finally { rmSync(value.root, { recursive: true, force: true }); }
  });

test("rejects a nonempty destination before invoking the remote provider", { skip: !linux }, async () => {
  const value = scope(); writeFileSync(path.join(value.destination, "foreign"), "owned elsewhere"); let called = false;
  try {
    await assert.rejects(retainLocalSeaweedCandidate(value.input, {
      remoteProvider: async () => { called = true; }, validateArchive: async () => proof(),
    }), /seaweed_local_retention_destination_invalid/u);
    assert.equal(called, false); assert.equal(readFileSync(path.join(value.destination, "foreign"), "utf8"), "owned elsewhere");
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("an abort before copy leaves no archive or receipt", { skip: !linux }, async () => {
  const value = scope(); const controller = new globalThis.AbortController(); value.input.signal = controller.signal;
  try {
    await assert.rejects(retainLocalSeaweedCandidate(value.input,
      dependencies({ controller, abortBeforeCallback: true })), /seaweed_local_retention_aborted/u);
    assert.equal(existsSync(path.join(value.destination, "candidate.tar")), false);
    assert.equal(existsSync(path.join(value.destination, "retention-receipt.json")), false);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("a revalidation mismatch preserves partial bytes without publishing a receipt", { skip: !linux }, async () => {
  const value = scope();
  try {
    await assert.rejects(retainLocalSeaweedCandidate(value.input, dependencies({ tamperProof: true })),
      /seaweed_local_retention_proof_mismatch/u);
    assert.equal(readFileSync(path.join(value.destination, "candidate.tar"), "utf8"), "tampered retained bytes");
    assert.equal(existsSync(path.join(value.destination, "retention-receipt.json")), false);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("provider cleanup failure preserves partial bytes without publishing a receipt", { skip: !linux }, async () => {
  const value = scope();
  try {
    await assert.rejects(retainLocalSeaweedCandidate(value.input, dependencies({ cleanupFailure: true })),
      /seaweed_remote_candidate_image_cleanup_failed/u);
    assert.deepEqual(readFileSync(path.join(value.destination, "candidate.tar")), bytes);
    assert.equal(existsSync(path.join(value.destination, "retention-receipt.json")), false);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("a second retention cannot overwrite an existing archive or receipt", { skip: !linux }, async () => {
  const value = scope();
  try {
    await retainLocalSeaweedCandidate(value.input, dependencies());
    await assert.rejects(retainLocalSeaweedCandidate(value.input, dependencies()),
      /seaweed_local_retention_destination_invalid/u);
    assert.deepEqual(readFileSync(path.join(value.destination, "candidate.tar")), bytes);
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});
