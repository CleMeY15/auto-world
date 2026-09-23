import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_publicRootfsMaterializationFailure, TEST_ONLY_runRootfsMaterializationDiagnostic } from "../scripts/seaweed-image/rootfs-materialization-diagnostic.mjs";

const workflow = new URL("../.github/workflows/seaweed-rootfs-materialization.yml", import.meta.url);
const linux = process.platform === "linux";

function context(runnerTemp) {
  return {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_NUMBER: "2", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-rootfs-materialization.yml@refs/heads/main",
    GITHUB_SHA: "a".repeat(40), RUNNER_TEMP: runnerTemp,
  };
}

function receipt() {
  return {
    kind: "SEAWEED_ROOTFS_MATERIALIZATION_RECEIPT_V1", state: "MATERIALIZED",
    authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
    rawSize: 4096, diffId: `sha256:${"b".repeat(64)}`, memberCount: 2,
    sourceRunId: "35884717093",
    sourceRepository: "CleMeY15/auto-world", sourceWorkflowId: 358072544, sourceAttempt: 1,
    sourceCodeRevision: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
    sourceBinaryDigest: "sha256:45e99f08ca1b6f50826512368c73d9541ff9572795e0e12435bbfd46e1bbb9ef",
    sourceBinarySize: 220_991_307, recipeRevision: "a".repeat(40), createdAt: "2026-09-23T12:34:56.789Z",
    baseManifestDigest: "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362",
  };
}

test("rootfs workflow is one-time, read-only, bounded and tied to its checkout", async () => {
  const bytes = await readFile(workflow, "utf8");
  assert.match(bytes, /workflow_dispatch:/u);
  assert.doesNotMatch(bytes, /pull_request:|\bpush:|upload-artifact|packages:\s*write|id-token:|docker\s/u);
  assert.match(bytes, /permissions:\n {2}contents: read\n {2}actions: read\n/u);
  assert.match(bytes, /test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_NUMBER" = '2'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_ATTEMPT" = '1'/u);
  assert.match(bytes, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
  assert.match(bytes, /12582912/u);
  assert.match(bytes, /persist-credentials: false/u);
  assert.match(bytes, /rootfs-materialization-diagnostic\.mjs execute/u);
  assert.match(bytes, /rootfs-materialization-diagnostic\.mjs cleanup/u);
});

test("rootfs diagnostic rejects altered provenance before creating storage", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-rootfs-context-test-"));
  const root = path.join(runnerTemp, "seaweed-rootfs-materialization");
  try {
    for (const changed of [{ GITHUB_REF: "refs/heads/other" }, { GITHUB_RUN_NUMBER: "1" }, { GITHUB_RUN_NUMBER: "3" },
      { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_SHA: "not-a-sha" }]) {
      await assert.rejects(TEST_ONLY_runRootfsMaterializationDiagnostic(["execute"],
        { ...context(runnerTemp), ...changed }), { code: "seaweed_rootfs_materialization_context_invalid" });
      await assert.rejects(access(root), { code: "ENOENT" });
    }
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("rootfs diagnostic disposes before publishing its bounded non-authorizing receipt", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-rootfs-success-test-"));
  const events = [];
  const value = receipt();
  try {
    await TEST_ONLY_runRootfsMaterializationDiagnostic(["execute"], context(runnerTemp), {
      now: () => Date.parse("2026-09-23T12:34:56.789Z"),
      materialize: async ({ recipeRevision, createdAt }) => {
        assert.equal(recipeRevision, "a".repeat(40));
        assert.equal(createdAt, "2026-09-23T12:34:56.789Z");
        events.push("materialized"); return value;
      },
      dispose: async (actual) => { assert.equal(actual, value); events.push("disposed"); },
      log: (line) => events.push(JSON.parse(line)),
    });
    assert.deepEqual(events, ["materialized", "disposed", value]);
    await assert.rejects(access(path.join(runnerTemp, "seaweed-rootfs-materialization")), { code: "ENOENT" });
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("rootfs diagnostic rejects altered source or recipe lineage after disposal", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-rootfs-lineage-test-"));
  const env = context(runnerTemp);
  try {
    for (const changed of [{ sourceWorkflowId: 1 }, { sourceBinaryDigest: `sha256:${"0".repeat(64)}` },
      { recipeRevision: "b".repeat(40) }, { createdAt: "2026-09-23T12:34:56.790Z" }]) {
      const events = [];
      await assert.rejects(TEST_ONLY_runRootfsMaterializationDiagnostic(["execute"], env, {
        now: () => Date.parse("2026-09-23T12:34:56.789Z"),
        materialize: async () => ({ ...receipt(), ...changed }),
        dispose: async () => { events.push("disposed"); },
        log: () => { events.push("logged"); },
      }), { code: "seaweed_rootfs_materialization_receipt_invalid" });
      assert.deepEqual(events, ["disposed"]);
      await TEST_ONLY_runRootfsMaterializationDiagnostic(["cleanup"], env, { log: () => {} });
    }
  } finally { await rm(runnerTemp, { recursive: true, force: true }); }
});

test("rootfs failure logs only bounded codes", () => {
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRootfsMaterializationFailure({ code: "unsafe /private/path" })),
    { state: "FAILED", code: "seaweed_rootfs_materialization_failed", candidateAuthorization: "NOT_AUTHORIZED" });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRootfsMaterializationFailure({
    code: "seaweed_rootfs_materialization_write_failed", originalCode: "seaweed_ustar_content_hash_mismatch",
    message: "secret /private/path", stack: "secret stack",
  })), { state: "FAILED", code: "seaweed_rootfs_materialization_write_failed",
    detailCode: "seaweed_ustar_content_hash_mismatch", candidateAuthorization: "NOT_AUTHORIZED" });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRootfsMaterializationFailure({
    code: "seaweed_rootfs_materialization_write_failed", originalCode: "seaweed_ustar_/private/path",
  })), { state: "FAILED", code: "seaweed_rootfs_materialization_write_failed", candidateAuthorization: "NOT_AUTHORIZED" });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRootfsMaterializationFailure({ code: `seaweed_${"x".repeat(1024)}` })),
    { state: "FAILED", code: "seaweed_rootfs_materialization_failed", candidateAuthorization: "NOT_AUTHORIZED" });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRootfsMaterializationFailure({
    code: "seaweed_private_secret_value", originalCode: "seaweed_ustar_secret_value",
  })), { state: "FAILED", code: "seaweed_rootfs_materialization_failed", candidateAuthorization: "NOT_AUTHORIZED" });
  const accessor = Object.defineProperty({}, "code", { get() { throw new Error("secret /private/path"); } });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRootfsMaterializationFailure(accessor)),
    { state: "FAILED", code: "seaweed_rootfs_materialization_failed", candidateAuthorization: "NOT_AUTHORIZED" });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("secret /private/path"); } });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicRootfsMaterializationFailure(proxy)),
    { state: "FAILED", code: "seaweed_rootfs_materialization_failed", candidateAuthorization: "NOT_AUTHORIZED" });
});
