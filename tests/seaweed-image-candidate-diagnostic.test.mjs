import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TEST_ONLY_publicCandidateFailure, TEST_ONLY_runCandidateDiagnostic,
} from "../scripts/seaweed-image/candidate-diagnostic.mjs";

const linux = process.platform === "linux";
const revision = "a".repeat(40);
const runId = "35999999999";

function context(runnerTemp) {
  return { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_NUMBER: "2", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-image-candidate.yml@refs/heads/main",
    GITHUB_SHA: revision, GITHUB_RUN_ID: runId, RUNNER_TEMP: runnerTemp };
}

function receipt() {
  return { kind: "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "PREPARATION_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", imageExecution: "NOT_ATTEMPTED", publication: "NOT_ATTEMPTED",
    vulnerabilityAudit: "NOT_ATTEMPTED", admission: "NOT_ATTEMPTED", runId, recipeRevision: revision,
    rawSize: 246_512_128, diffId: `sha256:${"b".repeat(64)}`, memberCount: 3032,
    imageId: `sha256:${"c".repeat(64)}`, sourceRunId: "35884717093",
    sourceCodeRevision: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
    sourceBinaryDigest: "sha256:45e99f08ca1b6f50826512368c73d9541ff9572795e0e12435bbfd46e1bbb9ef",
    baseManifestDigest: "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362",
    serverVersion: "28.0.4", archiveKind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1",
    archiveIdentityType: "CLASSIC_CONFIG_ID", archiveSha256: "d".repeat(64), archiveBytes: 260_000_000 };
}

test("candidate diagnostic refuses a changed main-only, first-attempt context before storage", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-candidate-context-"));
  const root = path.join(runnerTemp, "seaweed-image-candidate");
  try {
    for (const changed of [{ GITHUB_REF: "refs/heads/other" }, { GITHUB_RUN_NUMBER: "1" },
      { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_REPOSITORY: "foreign/repo" },
      { GITHUB_WORKFLOW_REF: "foreign/workflow" }, { GITHUB_SHA: "not-a-sha" }]) {
      await assert.rejects(TEST_ONLY_runCandidateDiagnostic(["execute"], { ...context(runnerTemp), ...changed }),
        { code: "seaweed_candidate_context_invalid" });
      await assert.rejects(access(root), { code: "ENOENT" });
    }
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("candidate diagnostic publishes only the bounded receipt after owned cleanup", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-candidate-diagnostic-"));
  const events = [];
  try {
    await TEST_ONLY_runCandidateDiagnostic(["execute"], context(runnerTemp), {
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
    assert.deepEqual(events, ["materialized", receipt()]);
    await assert.rejects(access(path.join(runnerTemp, "seaweed-image-candidate")), { code: "ENOENT" });
    await TEST_ONLY_runCandidateDiagnostic(["cleanup"], context(runnerTemp), { log: () => {} });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("candidate diagnostic rejects wrong lineage without logging success", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-candidate-lineage-"));
  try {
    for (const changed of [{ sourceRunId: "1" }, { archiveIdentityType: "OCI_CONFIG_ID" },
      { candidateAuthorization: "AUTHORIZED" }, { imageExecution: "EXECUTED" }]) {
      let logged = false;
      await assert.rejects(TEST_ONLY_runCandidateDiagnostic(["execute"], context(runnerTemp), {
        materialize: async () => ({ ...receipt(), ...changed }), log: () => { logged = true; },
      }), { code: "seaweed_candidate_failed" });
      assert.equal(logged, false);
      await assert.rejects(access(path.join(runnerTemp, "seaweed-image-candidate")), { code: "ENOENT" });
    }
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("candidate cleanup preserves an unexpected nonempty directory", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "aw-candidate-cleanup-"));
  const root = path.join(runnerTemp, "seaweed-image-candidate");
  try {
    await mkdir(root, { mode: 0o700 });
    await mkdir(path.join(root, "foreign"), { mode: 0o700 });
    await assert.rejects(TEST_ONLY_runCandidateDiagnostic(["cleanup"], context(runnerTemp), { log: () => {} }),
      { code: "seaweed_candidate_temporary_cleanup_failed" });
    assert.deepEqual(await readdir(root), ["foreign"]);
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("candidate failures expose only fixed public codes", () => {
  assert.deepEqual(JSON.parse(TEST_ONLY_publicCandidateFailure({ code: "unsafe /private/path" })),
    { state: "FAILED", code: "seaweed_candidate_failed", candidateAuthorization: "NOT_AUTHORIZED" });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicCandidateFailure({ code: "seaweed_candidate_archive_failed",
    message: "secret /private/path" })),
  { state: "FAILED", code: "seaweed_candidate_archive_failed", candidateAuthorization: "NOT_AUTHORIZED" });
  const accessor = Object.defineProperty({}, "code", { get() { throw new Error("private"); } });
  assert.equal(JSON.parse(TEST_ONLY_publicCandidateFailure(accessor)).code, "seaweed_candidate_failed");
  assert.deepEqual(JSON.parse(TEST_ONLY_publicCandidateFailure({ code: "seaweed_candidate_ownership_failed",
    detailCode: "config_Labels", message: "private" })),
  { state: "FAILED", code: "seaweed_candidate_ownership_failed", detailCode: "config_Labels",
    candidateAuthorization: "NOT_AUTHORIZED" });
  assert.equal(Object.hasOwn(JSON.parse(TEST_ONLY_publicCandidateFailure({ code: "seaweed_candidate_ownership_failed",
    detailCode: "secret path" })), "detailCode"), false);
});
