import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_expectedSeaweedRuntimePersistenceProof,
  TEST_ONLY_expectedSeaweedRuntimeProfileProof,
  TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof } from
  "../scripts/seaweed-image/candidate-runtime.mjs";
import { TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof } from
  "../scripts/seaweed-image/backup-restore.mjs";
import { TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof } from
  "../scripts/seaweed-image/host-loopback.mjs";
import { TEST_ONLY_publicRuntimeFailure, TEST_ONLY_runRuntimeDiagnostic } from
  "../scripts/seaweed-image/runtime-diagnostic.mjs";

const linux = process.platform === "linux";
const revision = "a".repeat(40);
const runId = "35999999999";
const imageId = `sha256:${"c".repeat(64)}`;

function context(runnerTemp, runNumber = "7") {
  return { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_NUMBER: runNumber,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-runtime-candidate.yml@refs/heads/main",
    GITHUB_SHA: revision, GITHUB_RUN_ID: runId, RUNNER_TEMP: runnerTemp };
}

function receipt() {
  return { kind: "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V3", state: "VERIFIED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
    imageExecution: "VERIFIED_DIAGNOSTIC", publication: "NOT_ATTEMPTED",
    vulnerabilityAudit: "NOT_ATTEMPTED", admission: "NOT_ATTEMPTED", runId,
    recipeRevision: revision, rawSize: 246_512_128, diffId: `sha256:${"b".repeat(64)}`,
    memberCount: 3032, imageId, sourceRunId: "35884717093",
    sourceCodeRevision: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
    sourceBinaryDigest: "sha256:45e99f08ca1b6f50826512368c73d9541ff9572795e0e12435bbfd46e1bbb9ef",
    baseManifestDigest: "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362",
    serverVersion: "28.0.4", archiveKind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1",
    archiveIdentityType: "CLASSIC_CONFIG_ID", archiveSha256: "d".repeat(64), archiveBytes: 260_000_000,
    persistenceProof: TEST_ONLY_expectedSeaweedRuntimePersistenceProof({ imageId, runId, recipeRevision: revision }) };
}

function strictReceipt() {
  const base = receipt();
  delete base.persistenceProof;
  return { ...base, kind: "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V4",
    runtimeProof: TEST_ONLY_expectedSeaweedRuntimeProfileProof({ imageId, runId, recipeRevision: revision }),
    strictContentionProof: TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof(
      { imageId, runId, recipeRevision: revision }, "B") };
}

function backupReceipt() {
  const base = receipt();
  delete base.persistenceProof;
  return { ...base, kind: "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V5",
    backupRestoreProof: TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof(
      { imageId, runId, recipeRevision: revision }, "e".repeat(64), 10240) };
}

function hostLoopbackReceipt() {
  const base = receipt();
  delete base.persistenceProof;
  return { ...base, kind: "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V6",
    hostLoopbackProof: TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof(
      { imageId, runId, recipeRevision: revision }) };
}

test("runtime diagnostic refuses changed one-time main context before storage", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-context-"));
  const root = path.join(runnerTemp, "seaweed-runtime-candidate");
  try {
    for (const changed of [{ GITHUB_REF: "refs/heads/other" }, { RUNNER_ENVIRONMENT: "self-hosted" },
      { GITHUB_RUN_NUMBER: "1" }, { GITHUB_RUN_NUMBER: "2" }, { GITHUB_RUN_NUMBER: "3" },
      { GITHUB_RUN_NUMBER: "4" }, { GITHUB_RUN_NUMBER: "5" }, { GITHUB_RUN_NUMBER: "6" },
      { GITHUB_RUN_ATTEMPT: "2" },
      { GITHUB_REPOSITORY: "foreign/repo" },
      { GITHUB_WORKFLOW_REF: "foreign/workflow" }, { GITHUB_SHA: "not-a-sha" }]) {
      await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute"], { ...context(runnerTemp), ...changed }),
        { code: "seaweed_candidate_context_invalid" });
      await assert.rejects(access(root), { code: "ENOENT" });
    }
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("runtime diagnostic publishes only the bounded verified receipt after cleanup", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-diagnostic-"));
  const events = [];
  try {
    await TEST_ONLY_runRuntimeDiagnostic(["execute"], context(runnerTemp), {
      now: () => Date.parse("2026-09-24T10:00:00.000Z"),
      materialize: async ({ parent, recipeRevision, runId: actualRunId }) => {
        assert.equal(recipeRevision, revision);
        assert.equal(actualRunId, runId);
        assert.equal((await readdir(parent)).length, 0);
        events.push("materialized");
        return receipt();
      },
      log: (line) => { events.push(JSON.parse(line)); },
    });
    assert.equal(events[0], "materialized");
    const { diagnostic, ...candidate } = events[1];
    assert.deepEqual(candidate, receipt());
    assert.equal(diagnostic.phase, "RUNTIME_COMPLETE");
    assert.equal(diagnostic.result, "VERIFIED");
    assert.equal(diagnostic.reason, "CHECKS_PASSED");
    assert.ok(Number.isSafeInteger(diagnostic.durationMs) && diagnostic.durationMs >= 0);
    await assert.rejects(access(path.join(runnerTemp, "seaweed-runtime-candidate")), { code: "ENOENT" });
    await TEST_ONLY_runRuntimeDiagnostic(["cleanup"], context(runnerTemp), { log: () => {} });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("runtime diagnostic rejects changed authority, lineage and persistence proof", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-lineage-"));
  try {
    for (const changed of [{ sourceRunId: "1" }, { authority: "PREPARATION_ONLY" },
      { kind: "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V2" },
      { candidateAuthorization: "AUTHORIZED" }, { imageExecution: "NOT_ATTEMPTED" },
      { persistenceProof: { ...receipt().persistenceProof, shutdown: "UNBOUNDED" } }]) {
      let logged = false;
      await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute"], context(runnerTemp), {
        materialize: async () => ({ ...receipt(), ...changed }), log: () => { logged = true; },
      }), { code: "seaweed_candidate_failed" });
      assert.equal(logged, false);
      await assert.rejects(access(path.join(runnerTemp, "seaweed-runtime-candidate")), { code: "ENOENT" });
    }
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("eighth dispatch emits only strict V4 after owned cleanup", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-strict-"));
  const root = path.join(runnerTemp, "seaweed-runtime-strict-contention");
  const events = [];
  try {
    await TEST_ONLY_runRuntimeDiagnostic(["execute-strict"], context(runnerTemp, "8"), {
      now: () => Date.parse("2026-09-24T10:00:00.000Z"),
      materialize: async ({ parent }) => {
        assert.equal(parent, root);
        assert.deepEqual(await readdir(parent), []);
        return strictReceipt();
      },
      log: (line) => events.push(JSON.parse(line)),
    });
    assert.deepEqual(events[0], { ...strictReceipt(), diagnostic: {
      phase: "RUNTIME_COMPLETE", result: "VERIFIED", reason: "CHECKS_PASSED",
      durationMs: events[0].diagnostic.durationMs } });
    await assert.rejects(access(root), { code: "ENOENT" });
    await TEST_ONLY_runRuntimeDiagnostic(["cleanup-strict"], context(runnerTemp, "8"), {
      log: (line) => events.push(JSON.parse(line)),
    });
    assert.deepEqual(events[1], { state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("strict dispatch rejects run seven and tampered contention proof", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-strict-guard-"));
  try {
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-strict"], context(runnerTemp)),
      { code: "seaweed_candidate_context_invalid" });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute"], context(runnerTemp, "8")),
      { code: "seaweed_candidate_context_invalid" });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-strict"], context(runnerTemp, "8"), {
      materialize: async () => ({ ...strictReceipt(), strictContentionProof: {
        ...strictReceipt().strictContentionProof, conditionalResult: "TWO_200" } }),
    }), { code: "seaweed_candidate_failed" });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("eleventh dispatch emits only backup restore V5 after owned cleanup", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-backup-"));
  const root = path.join(runnerTemp, "seaweed-runtime-backup-restore");
  const events = [];
  try {
    await TEST_ONLY_runRuntimeDiagnostic(["execute-backup"], context(runnerTemp, "11"), {
      materialize: async ({ parent }) => {
        assert.equal(parent, root); assert.deepEqual(await readdir(parent), []); return backupReceipt();
      },
      log: (line) => events.push(JSON.parse(line)),
    });
    const { diagnostic, ...candidate } = events[0];
    assert.deepEqual(candidate, backupReceipt());
    assert.deepEqual({ ...diagnostic, durationMs: 0 }, {
      phase: "RUNTIME_COMPLETE", result: "VERIFIED", reason: "CHECKS_PASSED", durationMs: 0,
    });
    await assert.rejects(access(root), { code: "ENOENT" });
    await TEST_ONLY_runRuntimeDiagnostic(["cleanup-backup"], context(runnerTemp, "11"), {
      log: (line) => events.push(JSON.parse(line)),
    });
    assert.deepEqual(events[1], { state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("backup dispatch rejects other run numbers and tampered proof", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-backup-guard-"));
  try {
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-backup"], context(runnerTemp, "8")),
      { code: "seaweed_candidate_context_invalid" });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-backup"], context(runnerTemp, "9")),
      { code: "seaweed_candidate_context_invalid" });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-backup"], context(runnerTemp, "10")),
      { code: "seaweed_candidate_context_invalid" });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-strict"], context(runnerTemp, "11")),
      { code: "seaweed_candidate_context_invalid" });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-backup"], context(runnerTemp, "11"), {
      materialize: async () => ({ ...backupReceipt(), backupRestoreProof: {
        ...backupReceipt().backupRestoreProof, sourceDisposal: "SOURCE_PRESENT" } }),
    }), { code: "seaweed_candidate_failed" });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("twelfth dispatch emits host loopback V6 only after owned cleanup", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-loopback-"));
  const root = path.join(runnerTemp, "seaweed-runtime-host-loopback");
  const events = [];
  try {
    await TEST_ONLY_runRuntimeDiagnostic(["execute-host-loopback"], context(runnerTemp, "12"), {
      materialize: async ({ parent }) => {
        assert.equal(parent, root); assert.deepEqual(await readdir(parent), []);
        return hostLoopbackReceipt();
      },
      log: (line) => events.push(JSON.parse(line)),
    });
    const { diagnostic, ...candidate } = events[0];
    assert.deepEqual(candidate, hostLoopbackReceipt());
    assert.deepEqual({ ...diagnostic, durationMs: 0 }, {
      phase: "RUNTIME_COMPLETE", result: "VERIFIED", reason: "CHECKS_PASSED", durationMs: 0,
    });
    await assert.rejects(access(root), { code: "ENOENT" });
    await TEST_ONLY_runRuntimeDiagnostic(["cleanup-host-loopback"], context(runnerTemp, "12"), {
      log: (line) => events.push(JSON.parse(line)),
    });
    assert.deepEqual(events[1], { state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("host loopback dispatch rejects other run numbers and altered binding evidence", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-loopback-guard-"));
  try {
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-host-loopback"], context(runnerTemp, "11")),
      { code: "seaweed_candidate_context_invalid" });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-backup"], context(runnerTemp, "12")),
      { code: "seaweed_candidate_context_invalid" });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["execute-host-loopback"], context(runnerTemp, "12"), {
      materialize: async () => ({ ...hostLoopbackReceipt(), hostLoopbackProof: {
        ...hostLoopbackReceipt().hostLoopbackProof, hostBinding: "0.0.0.0_TO_8333_TCP" } }),
    }), { code: "seaweed_candidate_failed" });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("runtime cleanup preserves an unexpected nonempty directory", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-runtime-cleanup-"));
  const root = path.join(runnerTemp, "seaweed-runtime-candidate");
  try {
    await mkdir(root, { mode: 0o700 });
    await mkdir(path.join(root, "foreign"), { mode: 0o700 });
    await assert.rejects(TEST_ONLY_runRuntimeDiagnostic(["cleanup"], context(runnerTemp), { log: () => {} }),
      { code: "seaweed_candidate_temporary_cleanup_failed" });
    assert.deepEqual(await readdir(root), ["foreign"]);
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("runtime failures expose only fixed public codes", () => {
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRuntimeFailure({ code: "unsafe /private/path" })),
    { state: "FAILED", code: "seaweed_candidate_failed", candidateAuthorization: "NOT_AUTHORIZED",
      diagnostic: { phase: "CANDIDATE_TRANSACTION", result: "FAILED",
        reason: "seaweed_candidate_failed", durationMs: 0 } });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRuntimeFailure({ code: "seaweed_candidate_runtime_failed",
    message: "secret /private/path" })),
  { state: "FAILED", code: "seaweed_candidate_runtime_failed", candidateAuthorization: "NOT_AUTHORIZED",
    diagnostic: { phase: "RUNTIME_PROBE", result: "FAILED",
      reason: "seaweed_candidate_runtime_failed", durationMs: 0 } });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRuntimeFailure({ code: "seaweed_candidate_runtime_cleanup_failed" })),
    { state: "FAILED", code: "seaweed_candidate_runtime_cleanup_failed", candidateAuthorization: "NOT_AUTHORIZED",
      diagnostic: { phase: "RUNTIME_CLEANUP", result: "FAILED",
        reason: "seaweed_candidate_runtime_cleanup_failed", durationMs: 0 } });
  const accessor = Object.defineProperty({}, "code", { get() { throw new Error("private"); } });
  assert.equal(JSON.parse(TEST_ONLY_publicRuntimeFailure(accessor)).code, "seaweed_candidate_failed");
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRuntimeFailure({ code: "seaweed_candidate_runtime_failed",
    phase: "RUNTIME_PROBE", reason: "READINESS_UNAVAILABLE", durationMs: 503, imageId,
    runId, recipeRevision: revision, message: "private" })),
  { state: "FAILED", code: "seaweed_candidate_runtime_failed", candidateAuthorization: "NOT_AUTHORIZED",
    diagnostic: { phase: "RUNTIME_PROBE", result: "FAILED", reason: "READINESS_UNAVAILABLE",
      durationMs: 503 }, imageId, runId, recipeRevision: revision });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRuntimeFailure({
    code: "seaweed_candidate_runtime_failed", phase: "BACKUP_RESTORED_SERVICE",
    reason: "RESTORED_OBJECT_MISSING", durationMs: 87, imageId,
    runtimeCleanupFailure: { code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
      phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN" },
    secondaryFailure: { code: "seaweed_candidate_image_cleanup_failed",
      phase: "CANDIDATE_IMAGE_CLEANUP", reason: "IMAGE_REMOVE_FAILED",
      stderr: "private /runner/path" },
  })), {
    state: "FAILED", code: "seaweed_candidate_runtime_failed",
    candidateAuthorization: "NOT_AUTHORIZED",
    diagnostic: { phase: "BACKUP_RESTORED_SERVICE", result: "FAILED",
      reason: "RESTORED_OBJECT_MISSING", durationMs: 87 },
    imageId,
    runtimeCleanupDiagnostic: { code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
      phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN", result: "FAILED" },
    secondaryDiagnostic: { code: "seaweed_candidate_image_cleanup_failed",
      phase: "CANDIDATE_IMAGE_CLEANUP", result: "FAILED", reason: "IMAGE_REMOVE_FAILED" },
  });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRuntimeFailure({
    code: "seaweed_candidate_runtime_failed", phase: "HOST_LOOPBACK_HTTP",
    reason: "ANONYMOUS_ALLOWED", durationMs: 42, imageId,
    runtimeCleanupFailure: { code: "seaweed_candidate_runtime_host_loopback_cleanup_failed",
      phase: "HOST_LOOPBACK_CLEANUP", reason: "CLEANUP_UNCERTAIN" },
    message: "secret 127.0.0.1:49153 /runner/private/path",
  })), {
    state: "FAILED", code: "seaweed_candidate_runtime_failed",
    candidateAuthorization: "NOT_AUTHORIZED",
    diagnostic: { phase: "HOST_LOOPBACK_HTTP", result: "FAILED",
      reason: "ANONYMOUS_ALLOWED", durationMs: 42 }, imageId,
    runtimeCleanupDiagnostic: { code: "seaweed_candidate_runtime_host_loopback_cleanup_failed",
      phase: "HOST_LOOPBACK_CLEANUP", reason: "CLEANUP_UNCERTAIN", result: "FAILED" },
  });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRuntimeFailure({
    code: "seaweed_candidate_image_cleanup_failed", phase: "CANDIDATE_IMAGE_CLEANUP",
    reason: "IMAGE_REMOVE_FAILED", durationMs: 41, imageId,
  })), {
    state: "FAILED", code: "seaweed_candidate_image_cleanup_failed",
    candidateAuthorization: "NOT_AUTHORIZED",
    diagnostic: { phase: "CANDIDATE_IMAGE_CLEANUP", result: "FAILED",
      reason: "IMAGE_REMOVE_FAILED", durationMs: 41 }, imageId,
  });
});
