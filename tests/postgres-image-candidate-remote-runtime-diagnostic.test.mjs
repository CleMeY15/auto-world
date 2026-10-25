import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { authenticatePostgresRemoteRuntimeSource, authenticatePostgresRuntimeAuditFiles, replayPostgresRuntimeAudit,
  requirePostgresRemoteRuntimeDiagnosticContext, runPostgresRemoteRuntimeDiagnostic,
  TEST_ONLY_publicPostgresRemoteRuntimeFailure, validatePostgresRemoteRuntimeDiagnosticArtifact,
  validatePostgresRemoteRuntimePolicy, verifyPostgresRuntimeAuditApi } from "../scripts/postgres-image/candidate-remote-runtime-diagnostic.mjs";
import { validatePostgresRemotePolicy } from "../scripts/postgres-image/candidate-remote.mjs";
import { postgresRuntimeFailureDiagnostic } from "../scripts/postgres-image/candidate-runtime.mjs";

const remoteBytes = readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url));
const publicationBytes = readFileSync(new URL("../infra/postgres-image/candidate-publication-receipt.json", import.meta.url));
const lockBytes = readFileSync(new URL("../infra/postgres-image/lock.json", import.meta.url));
const dockerfileBytes = readFileSync(new URL("../infra/postgres-image/Dockerfile", import.meta.url));
const actualPolicy = JSON.parse(readFileSync(new URL("../infra/postgres-image/candidate-runtime.json", import.meta.url)));
const candidatePolicy = validatePostgresRemotePolicy(JSON.parse(remoteBytes));
const revision = "a".repeat(40); const runId = "40000000222";
const at = new Date("2026-09-30T10:00:00Z");
const host = { platform: "linux", uid: process.getuid?.() ?? 1001, gid: process.getgid?.() ?? 1001 };
const overrideHost = { platform: "linux", uid: 1001, gid: 1001 };
const posix = { skip: process.platform !== "linux" };
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function writeJson(file, value, mode = 0o600) { writeFileSync(file, jsonBytes(value), { mode }); chmodSync(file, mode); }

function fixture(t, writeInput = true) {
  const runnerTemp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-pg-runtime-cli-")));
  const workspace = path.join(runnerTemp, "workspace"); mkdirSync(workspace, { mode: 0o700 });
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_JOB: "runtime",
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/postgres-candidate-remote-runtime-diagnostic-v2.yml@refs/heads/main",
    GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: revision, GITHUB_RUN_ID: runId,
    RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace, GITHUB_TOKEN: "secret", GH_TOKEN: "secret", PATH: "/bin" };
  const context = requirePostgresRemoteRuntimeDiagnosticContext(env, overrideHost);
  const policy = globalThis.structuredClone(actualPolicy); const files = new Map();
  const receipt = { kind: "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1", state: "COMPLETE", authority: "DIAGNOSTIC_ONLY",
    admission: "NOT_AUTHORIZED", phase: "COMPLETE", runId: policy.audit.runId, recipeRevision: policy.audit.recipeRevision,
    registrySubject: policy.subject, findingCount: 0, blockerCount: 0, blockers: [], blockersTruncated: false,
    scanner: globalThis.structuredClone(policy.audit.scanner), supportStartedAt: null, supportEndsAt: null, archiveUntil: null };
  const database = { observed: { vulnerability: { value: { Version: 2, UpdatedAt: "2026-09-30T01:00:00Z", DownloadedAt: "2026-09-30T05:00:00Z" } },
    java: { value: { Version: 1, UpdatedAt: "2025-01-01T00:00:00Z", DownloadedAt: "2026-09-30T05:00:00Z" } } } };
  for (const entry of policy.audit.files) {
    const bytes = jsonBytes(entry.name === "audit-receipt.json" ? receipt : entry.name === "database-evidence.json" ? database : {});
    files.set(entry.name, bytes); entry.sha256 = hash(bytes); entry.size = bytes.length;
  }
  const receiptBytes = files.get("audit-receipt.json"); policy.audit.receipt = { sha256: hash(receiptBytes), size: receiptBytes.length };
  const sources = new Map([["infra/postgres-image/candidate-remote.json", remoteBytes],
    ["infra/postgres-image/candidate-publication-receipt.json", publicationBytes], ["infra/postgres-image/lock.json", lockBytes],
    ["infra/postgres-image/Dockerfile", dockerfileBytes],
    ["infra/postgres-image/candidate-runtime.json", jsonBytes(policy)]]);
  if (writeInput) {
    mkdirSync(context.auditInput, { mode: 0o755 });
    for (const [name, bytes] of files) writeFileSync(path.join(context.auditInput, name), bytes, { mode: 0o644 });
  }
  return { runnerTemp, env, context, policy, receipt, database, files, sources };
}
function dependencies(item, overrides = {}) {
  return { context: host, verifyMain: async () => true, verifyAuditApi: async () => true,
    readCommitted: (relative) => item.sources.get(relative), validateAuditArtifact: () => true, now: () => at,
    executeRuntime: async (snapshot, controls) => {
      await controls.beforeExecution(); await controls.beforeExecution();
      return { subject: snapshot.subject, imageId: snapshot.imageId, diffIds: snapshot.diffIds,
        runId: snapshot.runId, recipeRevision: snapshot.recipeRevision };
    },
    validateRuntimeReceipt: (value, expected) => {
      assert.deepEqual({ subject: value.subject, imageId: value.imageId, diffIds: value.diffIds,
        runId: value.runId, recipeRevision: value.recipeRevision }, expected); return value;
    },
    validateMaterialReceipt: (value) => value,
    materialProvider: async (input, callback) => {
      assert.equal(path.basename(input.parent), "material");
      const snapshot = { parent: path.join(input.parent, `remote-${input.runId}-attempt-1`),
        imageId: candidatePolicy.candidate.imageId, diffIds: candidatePolicy.candidate.diffIds,
        subject: input.policy.subject, runId: input.runId, recipeRevision: input.recipeRevision,
        archiveProof: { imageId: candidatePolicy.candidate.imageId, diffIds: candidatePolicy.candidate.diffIds } };
      const runtime = await callback(snapshot);
      return { material: { subject: snapshot.subject, runId: snapshot.runId, recipeRevision: snapshot.recipeRevision }, runtime };
    }, ...overrides };
}

test("runtime context rejects non-main, forks, reruns, wrong workflow/job, root and self-hosted runners", (t) => {
  const { env } = fixture(t, false);
  assert.equal(requirePostgresRemoteRuntimeDiagnosticContext(env, overrideHost).runId, runId);
  for (const change of [{ GITHUB_JOB: "audit" }, { GITHUB_EVENT_NAME: "push" }, { GITHUB_RUN_NUMBER: "2" },
    { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_REF: "refs/heads/other" }, { GITHUB_REPOSITORY: "attacker/fork" },
    { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF.replace("runtime-diagnostic-v2", "remote-audit") },
    { GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF.replace("-v2.yml", ".yml") }]) {
    assert.throws(() => requirePostgresRemoteRuntimeDiagnosticContext({ ...env, ...change }, overrideHost), /context_invalid/u);
  }
  assert.throws(() => requirePostgresRemoteRuntimeDiagnosticContext(env, { ...overrideHost, uid: 0 }), /context_invalid/u);
});

test("committed policy closes support/admission, source lock and exact sixteen retained audit-file identities", () => {
  assert.equal(validatePostgresRemoteRuntimePolicy(actualPolicy, candidatePolicy).audit.runId, "36673766454");
  for (const mutate of [(value) => { value.admission = "AUTHORIZED"; }, (value) => { value.supportEndsAt = "2027-09-30"; },
    (value) => { value.audit.files[0].name = "image.tar"; }, (value) => { value.audit.files[1] = value.audit.files[2]; },
    (value) => { value.audit.receipt.sha256 = "a".repeat(64); }, (value) => { value.audit.attempt = 2; },
    (value) => { value.audit.artifact.name = "another"; }, (value) => { value.sourceLock.path = "../lock.json"; },
    (value) => { value.subject += "wrong"; }]) {
    const value = globalThis.structuredClone(actualPolicy); mutate(value);
    assert.throws(() => validatePostgresRemoteRuntimePolicy(value, candidatePolicy), /policy_invalid/u);
  }
});

test("source authentication binds source lock bytes and validated publication before package access", (t) => {
  const item = fixture(t, false); const deps = dependencies(item);
  assert.equal(authenticatePostgresRemoteRuntimeSource(item.context, deps).runtimePolicy.subject, candidatePolicy.subject);
  for (const relative of ["infra/postgres-image/lock.json", "infra/postgres-image/Dockerfile", "infra/postgres-image/candidate-publication-receipt.json"]) {
    const original = item.sources.get(relative); item.sources.set(relative, Buffer.concat([original, Buffer.from(" ")]));
    assert.throws(() => authenticatePostgresRemoteRuntimeSource(item.context, deps)); item.sources.set(relative, original);
  }
});

test("audit API requires successful native run identity and exact unexpired artifact provenance", async (t) => {
  const { policy, env } = fixture(t, false);
  function documents() {
    return [{ id: Number(policy.audit.runId), workflow_id: policy.audit.workflowId, run_number: 1, run_attempt: 1,
      path: policy.audit.workflow, event: "workflow_dispatch", status: "completed", conclusion: "success", head_branch: "main",
      head_sha: policy.audit.recipeRevision, repository: { full_name: policy.audit.repository } },
    { total_count: 1, artifacts: [{ id: policy.audit.artifact.id, name: policy.audit.artifact.name, expired: false,
      expires_at: "2026-10-07T00:00:00Z", size_in_bytes: policy.audit.artifact.size, digest: `sha256:${policy.audit.artifact.sha256}`,
      workflow_run: { id: Number(policy.audit.runId), head_sha: policy.audit.recipeRevision } }] }];
  }
  const fetcher = (values) => async (url) => new globalThis.Response(JSON.stringify(values[url.endsWith("/artifacts") ? 1 : 0]), { status: 200 });
  assert.equal(await verifyPostgresRuntimeAuditApi(policy, env, { fetchImpl: fetcher(documents()), now: () => at }), true);
  for (const mutate of [(values) => { values[0].conclusion = "failure"; }, (values) => { values[0].workflow_id++; },
    (values) => { values[0].head_sha = revision; }, (values) => { values[0].run_attempt = 2; },
    (values) => { values[1].artifacts[0].expired = true; }, (values) => { values[1].artifacts[0].digest = `sha256:${"f".repeat(64)}`; },
    (values) => { values[1].artifacts[0].workflow_run.id++; }, (values) => { values[1].artifacts[0].size_in_bytes++; }]) {
    const values = documents(); mutate(values);
    await assert.rejects(verifyPostgresRuntimeAuditApi(policy, env, { fetchImpl: fetcher(values), now: () => at }), /api_invalid/u);
  }
});

test("raw audit download accepts 0644 regular files but refuses extra files, changed bytes and unsafe links/modes", posix, (t) => {
  const item = fixture(t); const context = requirePostgresRemoteRuntimeDiagnosticContext(item.env, host);
  assert.equal(Object.keys(authenticatePostgresRuntimeAuditFiles(context.auditInput, item.policy, context)).length, 16);
  const file = path.join(context.auditInput, "candidate-vulnerabilities.json"); const original = readFileSync(file);
  writeFileSync(file, "{}"); assert.throws(() => authenticatePostgresRuntimeAuditFiles(context.auditInput, item.policy, context), /audit_invalid/u);
  writeFileSync(file, original); chmodSync(file, 0o666);
  assert.throws(() => authenticatePostgresRuntimeAuditFiles(context.auditInput, item.policy, context), /input_invalid/u); chmodSync(file, 0o644);
  const extra = path.join(context.auditInput, "image.tar"); writeFileSync(extra, "image");
  assert.throws(() => authenticatePostgresRuntimeAuditFiles(context.auditInput, item.policy, context), /audit_invalid/u); rmSync(extra);
  const foreign = path.join(item.runnerTemp, "foreign.json"); writeFileSync(foreign, original, { mode: 0o644 });
  rmSync(file); symlinkSync(foreign, file); assert.throws(() => authenticatePostgresRuntimeAuditFiles(context.auditInput, item.policy, context), /input_invalid/u);
  rmSync(file); linkSync(foreign, file); assert.throws(() => authenticatePostgresRuntimeAuditFiles(context.auditInput, item.policy, context), /input_invalid/u);
});

test("production route stages exact evidence, replays original audit context and rechecks before every execution", posix, async (t) => {
  const item = fixture(t); let replays = 0;
  const deps = dependencies(item, { validateAuditArtifact: (context) => {
    replays++; assert.equal(context.runId, item.policy.audit.runId);
    assert.equal(context.recipeRevision, item.policy.audit.recipeRevision); assert.equal(context.root, item.policy.audit.context.root);
    assert.equal(context.workspace, item.context.workspace); return true;
  } });
  const result = await runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps);
  assert.equal(result.state, "VERIFIED"); assert.equal(replays, 3); assert.equal(existsSync(item.context.root), false);
  assert.equal(existsSync(item.context.auditInput), true);
  assert.equal(await validatePostgresRemoteRuntimeDiagnosticArtifact(requirePostgresRemoteRuntimeDiagnosticContext(item.env, host), deps), true);
  assert.equal((await runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps)).state, "CLEANED");
});

test("missing, changed, blocked and stale audits never reach provider or candidate execution", posix, async (t) => {
  for (const mode of ["missing", "changed", "stale", "blocked", "scanner", "dirty", "unprotected", "api"]) {
    const item = fixture(t); let accessed = false; const deps = dependencies(item, { materialProvider: async () => { accessed = true; } });
    if (mode === "missing") rmSync(path.join(item.context.auditInput, "scanner-self.json"));
    if (mode === "changed") writeFileSync(path.join(item.context.auditInput, "candidate-vulnerabilities.json"), "{}");
    if (mode === "stale") deps.now = () => new Date("2026-10-03T00:00:00Z");
    if (mode === "blocked" || mode === "scanner") {
      if (mode === "blocked") item.receipt.blockerCount = 1; else item.receipt.scanner.binary.sha256 = "f".repeat(64);
      const bytes = jsonBytes(item.receipt); const pin = item.policy.audit.files.find((entry) => entry.name === "audit-receipt.json");
      pin.sha256 = hash(bytes); pin.size = bytes.length; item.policy.audit.receipt = { sha256: pin.sha256, size: pin.size };
      // Scanner expectations must remain independently pinned when the observed report is changed.
      if (mode === "scanner") item.policy.audit.scanner.binary.sha256 = actualPolicy.audit.scanner.binary.sha256;
      item.sources.set("infra/postgres-image/candidate-runtime.json", jsonBytes(item.policy));
      writeFileSync(path.join(item.context.auditInput, "audit-receipt.json"), bytes);
    }
    if (mode === "dirty" || mode === "unprotected") deps.verifyMain = async () => { throw new Error(`postgres_remote_audit_${mode === "dirty" ? "checkout" : "main"}_invalid`); };
    if (mode === "api") deps.verifyAuditApi = async () => { throw new Error("postgres_remote_runtime_api_invalid"); };
    await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps)); assert.equal(accessed, false, mode);
  }
});

test("beforeExecution rejects newly changed source, copied evidence and expired vulnerability metadata", posix, async (t) => {
  for (const mode of ["source", "dockerfile", "bytes", "freshness"]) {
    const item = fixture(t); let executed = false; let calls = 0;
    const deps = dependencies(item, { now: () => calls++ > 0 && mode === "freshness" ? new Date("2026-10-03T00:00:00Z") : at,
      executeRuntime: async (_snapshot, controls) => {
        if (mode === "source") item.sources.set("infra/postgres-image/lock.json", Buffer.from("{}"));
        if (mode === "dockerfile") item.sources.set("infra/postgres-image/Dockerfile", Buffer.from("uncommitted recipe"));
        if (mode === "bytes") writeFileSync(path.join(item.context.root, "audit-evidence", "candidate-vulnerabilities.json"), "{}");
        await controls.beforeExecution(); executed = true;
      } });
    await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps)); assert.equal(executed, false);
  }
});

test("cleanup uncertainty is preserved and blocks receipt upload even when root already vanished", posix, async (t) => {
  const item = fixture(t); const deps = dependencies(item, { materialProvider: async () => {
    throw new Error("postgres_runtime_cleanup_uncertain");
  } });
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps), /cleanup_uncertain/u);
  assert.equal(existsSync(item.context.root), true); rmSync(item.context.root, { recursive: true });
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps), /cleanup_uncertain/u);
});

test("CLI retains the provider's closed runtime failure diagnostic and masks unknown runtime prefixes", posix, async (t) => {
  for (const [message, phase, expected] of [
    ["postgres_runtime_readiness_timeout", "SERVICE_ONE", { code: "postgres_runtime_readiness_timeout", phase: "SERVICE_ONE" }],
    ["postgres_runtime_readback_invalid", "SERVICE_TWO", { code: "postgres_runtime_readback_invalid", phase: "SERVICE_TWO" }],
    ["postgres_runtime_forged_private_test_token", "SERVICE_TWO", { code: "postgres_runtime_failed", phase: "SERVICE_TWO" }],
  ]) {
    const item = fixture(t); const providerError = Object.assign(new Error("postgres_remote_runtime_material_failed"), {
      code: "postgres_remote_runtime_material_failed", inspectionFailed: true,
      primaryFailure: "postgres_remote_runtime_diagnostics_failed", runtimeCleanupFailure: null,
      runtimeDiagnostic: postgresRuntimeFailureDiagnostic(Object.assign(new Error(message), { phase })),
      imageCleanupFailure: null, temporaryCleanupFailure: null,
    });
    const deps = dependencies(item, { materialProvider: async () => { throw providerError; } });
    await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps), (error) => error === providerError);
    const bytes = readFileSync(path.join(item.context.output, "receipt.json"));
    assert.deepEqual(JSON.parse(bytes).failure, { code: "postgres_remote_runtime_material_failed", runtimeDiagnostic: expected });
    assert.equal(bytes.includes(Buffer.from("private_test_token")), false);
    assert.deepEqual(JSON.parse(TEST_ONLY_publicPostgresRemoteRuntimeFailure(providerError)).runtimeDiagnostic, expected);
    assert.equal((await runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps)).state, "CLEANED");
  }
});

test("cleanup rejects nested cleanup or ownership uncertainty even with a safe outer code and absent root", posix, async (t) => {
  for (const code of ["postgres_runtime_cleanup_uncertain", "postgres_runtime_ownership_uncertain"]) {
    const item = fixture(t); const detail = { code, phase: "CLEANUP" };
    const providerError = Object.assign(new Error("postgres_remote_runtime_material_failed"), { runtimeDiagnostic: detail });
    const deps = dependencies(item, { materialProvider: async () => { throw providerError; } });
    await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps));
    assert.equal(existsSync(item.context.root), true);
    const file = path.join(item.context.output, "receipt.json"); const receipt = JSON.parse(readFileSync(file));
    assert.deepEqual(receipt.failure, { code: "postgres_remote_runtime_cleanup_uncertain", runtimeDiagnostic: detail });
    assert.equal(JSON.parse(TEST_ONLY_publicPostgresRemoteRuntimeFailure(providerError)).code, "postgres_remote_runtime_cleanup_uncertain");
    rmSync(item.context.root, { recursive: true });
    receipt.failure.code = "postgres_remote_runtime_material_failed"; writeJson(file, receipt);
    await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps), /cleanup_uncertain/u);
  }
});

test("failure artifact supports historical codes and only the exact optional runtime diagnostic extension", posix, async (t) => {
  const item = fixture(t); const deps = dependencies(item, { materialProvider: async () => {
    throw new Error("postgres_remote_runtime_material_failed");
  } });
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps));
  const file = path.join(item.context.output, "receipt.json"); const receipt = JSON.parse(readFileSync(file));
  assert.deepEqual(receipt.failure, { code: "postgres_remote_runtime_material_failed", runtimeDiagnostic: null });
  delete receipt.failure.runtimeDiagnostic; writeJson(file, receipt);
  assert.equal((await runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps)).state, "CLEANED");
  for (const detail of [
    { code: "postgres_runtime_readiness_timeout", phase: "SERVICE_ONE", stdout: "private subprocess output" },
    { code: "postgres_runtime_forged_private_test_token", phase: "SERVICE_ONE" },
    { code: "postgres_runtime_readiness_timeout", phase: "/private/runtime/path" },
    { code: "postgres_runtime_readiness_timeout" }, "private subprocess output",
  ]) {
    receipt.failure = { code: "postgres_remote_runtime_material_failed", runtimeDiagnostic: detail }; writeJson(file, receipt);
    await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps), /receipt_invalid/u);
  }
  receipt.failure = { code: "postgres_remote_runtime_material_failed", runtimeDiagnostic: null, stderr: "private output" };
  writeJson(file, receipt);
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps), /receipt_invalid/u);
});

test("unsafe root ownership mode is recorded as cleanup uncertainty rather than a safe input failure", posix, async (t) => {
  const item = fixture(t); const deps = dependencies(item, { materialProvider: async () => {
    chmodSync(item.context.root, 0o777); throw new Error("postgres_remote_runtime_material_failed");
  } });
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps), /cleanup_uncertain/u);
  const receipt = JSON.parse(readFileSync(path.join(item.context.output, "receipt.json")));
  assert.equal(receipt.failure.code, "postgres_remote_runtime_cleanup_uncertain");
  rmSync(item.context.root, { recursive: true });
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps), /cleanup_uncertain/u);
});

test("cleanup rejects an occupied root even when its symlink target does not exist", posix, async (t) => {
  const item = fixture(t); const deps = dependencies(item, { materialProvider: async () => { throw new Error("postgres_remote_runtime_material_failed"); } });
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps));
  symlinkSync(path.join(item.runnerTemp, "missing-target"), item.context.root);
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps), /cleanup_uncertain/u);
});

test("safe failure receipt is canonical, contains no raw secret and rejects extra public files", posix, async (t) => {
  const item = fixture(t); const deps = dependencies(item, { materialProvider: async () => { throw new Error("raw github_pat_sensitive_value"); } });
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["execute"], item.env, deps));
  assert.equal((await runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps)).state, "CLEANED");
  const file = path.join(item.context.output, "receipt.json"); const original = readFileSync(file);
  assert.ok(!original.includes(Buffer.from("github_pat"))); const value = JSON.parse(original); value.password = "secret"; writeJson(file, value);
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps), /receipt_invalid/u); writeFileSync(file, original);
  writeFileSync(path.join(item.context.output, "private-image.tar"), "private");
  await assert.rejects(runPostgresRemoteRuntimeDiagnostic(["cleanup"], item.env, deps), /receipt_invalid/u);
  assert.ok(!TEST_ONLY_publicPostgresRemoteRuntimeFailure(new Error("raw github_pat_sensitive_value")).includes("github_pat"));
});

test("replay retains old Java DB without a maximum-age rejection", posix, (t) => {
  const item = fixture(t); const context = requirePostgresRemoteRuntimeDiagnosticContext(item.env, host);
  const staged = path.join(item.runnerTemp, "staged"); mkdirSync(staged, { mode: 0o700 });
  for (const [name, bytes] of item.files) writeFileSync(path.join(staged, name), bytes, { mode: 0o600 });
  assert.equal(replayPostgresRuntimeAudit(staged, item.policy, context, dependencies(item)).receipt.state, "COMPLETE");
});
