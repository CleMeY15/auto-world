import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { requirePostgresRemoteReadContext, runPostgresRemoteRead,
  validatePostgresRemoteReadArtifact, validatePostgresRemoteReadReceipt,
  verifyPostgresRemoteReadMain } from "../scripts/postgres-image/candidate-remote-read.mjs";

const revision = "a".repeat(40);
const subject = `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:${"b".repeat(64)}`;
const imageId = `sha256:${"c".repeat(64)}`;
const diffIds = Object.freeze(Array.from({ length: 12 }, (_value, index) =>
  `sha256:${index.toString(16).padStart(64, "0")}`));
const policy = Object.freeze({ subject, manifest: { config: { digest: imageId } },
  candidate: { diffIds } });

function fixture(runId = "40000000001") {
  const runnerTemp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-postgres-remote-read-")));
  const workspace = path.join(runnerTemp, "workspace"); mkdirSync(workspace, { mode: 0o700 });
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_JOB: "read",
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/postgres-candidate-remote-read-v2.yml@refs/heads/main",
    GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: revision, GITHUB_RUN_ID: runId,
    RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace, GITHUB_TOKEN: "secret", GH_TOKEN: "secret", PATH: "/bin" };
  return { runnerTemp, env };
}

function receipt(overrides = {}) {
  return { kind: "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "REMOTE_READ_ONLY",
    runId: "40000000001", recipeRevision: revision, subject, publication: "PUBLISHED_UNADMITTED",
    registryWrite: "NOT_ATTEMPTED", vulnerabilityAudit: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED",
    admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    remoteManifest: {}, engine: {}, image: {}, archive: {}, publisher: {}, phases: [], ...overrides };
}

function dependencies(options = {}) {
  const receiptKeys = Object.keys(receipt()).sort();
  return { context: { platform: "linux", uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 },
    verifyMain: async () => true,
    readCommitted: (relative) => Buffer.from(JSON.stringify(relative.includes("remote.json") ? policy : { subject })),
    policyValidator: (value) => value,
    publicationReceiptValidator: (value, selectedPolicy) => {
      if (options.rejectPublication || value.subject !== selectedPolicy.subject) throw new Error("wrong_publication");
      return value;
    },
    remoteReceiptValidator: (value) => {
      if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(receiptKeys)) throw new Error("wrong_receipt");
      return value;
    },
    remoteProvider: options.remoteProvider ?? (async (input, inspect) => {
      const file = path.join(input.parent, "candidate.tar"); writeFileSync(file, "archive"); chmodSync(file, 0o600);
      try {
        const selectedDiffIds = options.wrongDiffIds ? diffIds.slice(1) : diffIds;
        const selectedPolicy = JSON.parse(JSON.stringify(input.policy));
        if (options.wrongPolicy) selectedPolicy.candidate.diffIds[0] = `sha256:${"f".repeat(64)}`;
        await inspect({ file, archiveProof: { imageId, diffIds: selectedDiffIds,
          archiveSha256: "d".repeat(64), archiveBytes: 7 },
        policy: selectedPolicy, subject: input.policy.subject, imageId, diffIds: selectedDiffIds, runId: input.runId,
        recipeRevision: input.recipeRevision, signal: new globalThis.AbortController().signal });
      } finally { rmSync(file); }
      return receipt({ runId: input.runId, recipeRevision: input.recipeRevision });
    }) };
}

test("remote-read context rejects forks, alternate runs, attempts, refs and workflows", (context) => {
  const item = fixture(); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const host = { platform: "linux", uid: 1001, gid: 1001 };
  assert.equal(requirePostgresRemoteReadContext(item.env, host).runId, item.env.GITHUB_RUN_ID);
  for (const change of [{ GITHUB_REPOSITORY: "attacker/fork" }, { GITHUB_RUN_NUMBER: "2" },
    { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_REF: "refs/heads/feature" }, { GITHUB_JOB: "publish" },
    { GITHUB_WORKFLOW_REF: "attacker/fork/.github/workflows/postgres-candidate-remote-read-v2.yml@refs/heads/main" },
    { GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/postgres-candidate-remote-read.yml@refs/heads/main" }]) {
    assert.throws(() => requirePostgresRemoteReadContext({ ...item.env, ...change }, host), /context_invalid/u);
  }
  assert.throws(() => requirePostgresRemoteReadContext(item.env, { ...host, uid: 0 }), /context_invalid/u);
});

test("protected main verification rejects dirty checkout, changed main and token ambiguity", async (context) => {
  const item = fixture(); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const selected = requirePostgresRemoteReadContext(item.env,
    { platform: "linux", uid: 1001, gid: 1001 });
  const response = (sha = revision, protectedBranch = true) => new globalThis.Response(JSON.stringify({
    name: "main", protected: protectedBranch, commit: { sha } }), { status: 200 });
  const runner = (_command, args) => ({ status: 0,
    stdout: Buffer.from(args[0] === "status" ? "" : `${revision}\n`), stderr: Buffer.alloc(0) });
  assert.equal(await verifyPostgresRemoteReadMain(selected, item.env,
    { commandRunner: runner, fetchImpl: async () => response() }), true);
  await assert.rejects(verifyPostgresRemoteReadMain(selected, item.env, { commandRunner: runner,
    fetchImpl: async () => response("f".repeat(40)) }), /main_invalid/u);
  await assert.rejects(verifyPostgresRemoteReadMain(selected, { ...item.env, GH_TOKEN: "different" },
    { commandRunner: runner }), /environment_invalid/u);
  const dirty = (_command, args) => ({ status: 0,
    stdout: Buffer.from(args[0] === "status" ? "?? attacker.mjs\n" : `${revision}\n`), stderr: Buffer.alloc(0) });
  await assert.rejects(verifyPostgresRemoteReadMain(selected, item.env,
    { commandRunner: dirty, fetchImpl: async () => response() }), /checkout_invalid/u);
});

test("execute binds committed policy and publication receipt and writes only a bounded receipt", async (context) => {
  const item = fixture(); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const selectedDependencies = dependencies();
  const result = await runPostgresRemoteRead(["execute"], item.env, selectedDependencies);
  assert.equal(result.subject, subject);
  const selected = requirePostgresRemoteReadContext(item.env,
    { platform: "linux", uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 });
  assert.equal(validatePostgresRemoteReadArtifact(selected, selectedDependencies), true);
  const receiptFile = path.join(selected.output, "receipt.json");
  const original = readFileSync(receiptFile);
  const changed = JSON.parse(original.toString("utf8")); changed.accessToken = "github_pat_must_not_escape";
  writeFileSync(receiptFile, `${JSON.stringify(changed, null, 2)}\n`);
  assert.throws(() => validatePostgresRemoteReadArtifact(selected, selectedDependencies), /artifact_invalid/u);
  writeFileSync(receiptFile, original);
  assert.deepEqual(await runPostgresRemoteRead(["cleanup"], item.env, selectedDependencies),
    { state: "CLEANED", authority: "REMOTE_READ_ONLY", admission: "NOT_AUTHORIZED" });
});

test("changed policy, publication or returned subject fails closed with a redacted receipt", async (context) => {
  for (const [index, selectedDependencies] of [
    dependencies({ rejectPublication: true }),
    dependencies({ remoteProvider: async (input) => receipt({ runId: input.runId,
      recipeRevision: input.recipeRevision, subject: `${subject}-wrong` }) }),
    dependencies({ wrongDiffIds: true }),
    dependencies({ wrongPolicy: true }),
  ].entries()) {
    const item = fixture(`4000000001${index}`);
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    await assert.rejects(runPostgresRemoteRead(["execute"], item.env, selectedDependencies));
    const selected = requirePostgresRemoteReadContext(item.env, selectedDependencies.context);
    assert.equal(validatePostgresRemoteReadArtifact(selected, selectedDependencies), true);
    await runPostgresRemoteRead(["cleanup"], item.env, selectedDependencies);
  }
});

test("provider failure is retained without secrets and cleanup rejects extra artifacts", async (context) => {
  const item = fixture(); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const selectedDependencies = dependencies({ remoteProvider: async () => {
    throw new Error("provider leaked secret-token-value");
  } });
  await assert.rejects(runPostgresRemoteRead(["execute"], item.env, selectedDependencies), /provider leaked/u);
  const selected = requirePostgresRemoteReadContext(item.env, selectedDependencies.context);
  assert.equal(validatePostgresRemoteReadArtifact(selected, selectedDependencies), true);
  const receiptFile = path.join(selected.output, "receipt.json");
  const original = readFileSync(receiptFile);
  const changed = JSON.parse(original.toString("utf8")); changed.secretToken = "github_pat_must_not_escape";
  writeFileSync(receiptFile, `${JSON.stringify(changed, null, 2)}\n`);
  assert.throws(() => validatePostgresRemoteReadArtifact(selected, selectedDependencies), /artifact_invalid/u);
  writeFileSync(receiptFile, original);
  writeFileSync(path.join(selected.output, "private-archive.tar"), "must-not-upload");
  await assert.rejects(runPostgresRemoteRead(["cleanup"], item.env, selectedDependencies), /artifact_invalid/u);
  rmSync(path.join(selected.output, "private-archive.tar"));
  assert.equal(validatePostgresRemoteReadArtifact(selected, selectedDependencies), true);
});

test("receipt contract rejects wrong authority, subject, execution, audit and support dates", () => {
  const context = { runId: "40000000001", recipeRevision: revision };
  const accept = (value) => value;
  assert.ok(validatePostgresRemoteReadReceipt(receipt(), context, policy, accept));
  for (const changed of [
    { authority: "DIAGNOSTIC_ONLY" }, { subject: `${subject}-wrong` }, { imageExecution: "VERIFIED" },
    { vulnerabilityAudit: "PASSED" }, { registryWrite: "ATTEMPTED" }, { admission: "AUTHORIZED" },
    { supportStartedAt: "2026-09-28T00:00:00Z" },
  ]) assert.throws(() => validatePostgresRemoteReadReceipt(receipt(changed), context, policy, accept), /receipt_invalid/u);
});
