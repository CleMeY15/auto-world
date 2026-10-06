import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readSync,
  realpathSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { projectPostgresAdmissionCurrentAudit, requirePostgresAdmissionCurrentAuditContext,
  runPostgresAdmissionCurrentAudit, TEST_ONLY_publicPostgresAdmissionCurrentAuditFailure,
  validatePostgresAdmissionCurrentAuditArtifact,
  verifyPostgresAdmissionCurrentAuditMain } from "../scripts/postgres-image/admission-current-audit.mjs";
import { validatePostgresRemotePolicy } from "../scripts/postgres-image/candidate-remote.mjs";

const revision = "a".repeat(40); const runId = "41000000111";
const policy = validatePostgresRemotePolicy(JSON.parse(readFileSync(
  new URL("../infra/postgres-image/candidate-remote.json", import.meta.url))));
const roles = ["audit-receipt.json", "candidate-sbom.cdx.json", "candidate-vulnerabilities.json",
  "database-evidence.json", "database-java-after-manifest.json", "database-java-before-manifest.json",
  "database-vulnerability-after-manifest.json", "database-vulnerability-before-manifest.json",
  "fixture-gomod-vulnerable-baseline.json", "fixture-gomod-vulnerable-candidate.json",
  "fixture-java-jar-clean-candidate-candidate.json", "fixture-java-war-vulnerable-baseline.json",
  "fixture-java-war-vulnerable-candidate.json", "scanner-self.cdx.json", "scanner-self.json",
  "scanner-version-probe.json"];
const host = { platform: "linux", uid: process.getuid?.() ?? 1001, gid: process.getgid?.() ?? 1001 };

function fixture(t, tokenName = "GITHUB_TOKEN") {
  const runnerTemp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-pg-current-audit-")));
  const workspace = path.join(runnerTemp, "workspace"); mkdirSync(workspace, { mode: 0o700 });
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_JOB: "audit",
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/postgres-admission-current-audit.yml@refs/heads/main",
    GITHUB_RUN_NUMBER: "27", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: revision, GITHUB_RUN_ID: runId,
    RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace, PATH: "/usr/bin:/bin", [tokenName]: "private-token" };
  return { env, runnerTemp, context: requirePostgresAdmissionCurrentAuditContext(env, host) };
}
function response(sha = revision, protectedBranch = true) {
  return new globalThis.Response(JSON.stringify({ name: "main", protected: protectedBranch, commit: { sha } }),
    { status: 200 });
}
function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); chmodSync(file, 0o600);
}
function rawEvidence(context) {
  mkdirSync(context.output, { mode: 0o700 });
  const reportAt = "2026-10-06T02:00:00.123456789Z";
  const metadata = (version) => ({ Version: version, UpdatedAt: "2026-10-06T00:00:00.000Z",
    DownloadedAt: "2026-10-06T01:00:00.000Z" });
  const documents = Object.fromEntries(roles.map((role) => [role, { role }]));
  documents["audit-receipt.json"] = { kind: "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1", state: "COMPLETE",
    phase: "COMPLETE", blockerCount: 0, subject: { imageId: policy.candidate.imageId }, registrySubject: policy.subject };
  documents["candidate-vulnerabilities.json"] = { SchemaVersion: 2, CreatedAt: reportAt, Results: [] };
  documents["database-evidence.json"] = { observed: { vulnerability: { value: metadata(2) }, java: { value: metadata(1) } } };
  for (const role of roles) writeJson(path.join(context.output, role), documents[role]);
}

test("context is fixed to protected-main manual GitHub-hosted attempt one and permits later run numbers", (t) => {
  const { env, context } = fixture(t);
  assert.equal(context.runId, runId);
  assert.equal(path.basename(context.root), "postgres-admission-current-audit-work");
  assert.equal(path.basename(context.output), "postgres-admission-current-audit-evidence");
  assert.equal(path.basename(context.projection), "postgres-admission-current-audit-projection");
  for (const change of [{ GITHUB_RUN_NUMBER: "0" }, { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_REF: "refs/heads/topic" }, { GITHUB_EVENT_NAME: "schedule" }, { GITHUB_JOB: "build" },
    { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_REPOSITORY: "attacker/fork" },
    { GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF.replace("current-audit", "other") }, { DOCKER_HOST: "tcp://host" }]) {
    assert.throws(() => requirePostgresAdmissionCurrentAuditContext({ ...env, ...change }, host), /context_invalid/u);
  }
  assert.throws(() => requirePostgresAdmissionCurrentAuditContext(env, { ...host, uid: 0 }), /context_invalid/u);
});

test("main verification uses a clean token-free git environment and the fixed bounded 2026 API", async (t) => {
  const { context } = fixture(t); const calls = [];
  const commandRunner = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: Buffer.from(args[0] === "status" ? "" : revision) };
  };
  let request;
  assert.equal(await verifyPostgresAdmissionCurrentAuditMain(context, "private-token", { commandRunner,
    fetchImpl: async (url, options) => { request = { url, options }; return response(); }, pathValue: "/bin" }), true);
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers["X-GitHub-Api-Version"], "2026-03-10");
  assert.equal(request.options.headers.Authorization, "Bearer private-token");
  assert.ok(calls.every((call) => !Object.keys(call.options.env).some((name) => /token/iu.test(name))));
  await assert.rejects(verifyPostgresAdmissionCurrentAuditMain(context, "private-token", { commandRunner,
    fetchImpl: async () => response("b".repeat(40)) }), /main_invalid/u);
  await assert.rejects(verifyPostgresAdmissionCurrentAuditMain(context, "private-token", { commandRunner,
    fetchImpl: async () => response(revision, false) }), /main_invalid/u);
  await assert.rejects(verifyPostgresAdmissionCurrentAuditMain(context, "bad\ntoken", { commandRunner }), /environment_invalid/u);
  await assert.rejects(verifyPostgresAdmissionCurrentAuditMain(context, "private-token", {
    commandRunner: () => ({ status: 0, stdout: Buffer.from("dirty") }) }), /checkout_invalid/u);
  await assert.rejects(verifyPostgresAdmissionCurrentAuditMain(context, "private-token", { commandRunner, timeoutMs: 1,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort",
      () => reject(new Error("timeout")))) }), /main_invalid/u);
});

test("execute scrubs both ambient credential names and passes one private provider token only", async (t) => {
  const { env } = fixture(t, "GH_TOKEN"); let checks = 0; let providerCalled = false;
  process.env.GH_TOKEN = "ambient-one"; process.env.GITHUB_TOKEN = "ambient-two";
  const result = await runPostgresAdmissionCurrentAudit(["execute"], env, { context: host,
    verifyMain: async (_context, token) => { assert.equal(token, "private-token"); checks++; },
    readCommitted: (relative) => readFileSync(new URL(relative.endsWith("candidate-remote.json")
      ? "../infra/postgres-image/candidate-remote.json" : "../infra/postgres-image/candidate-publication-receipt.json", import.meta.url)),
    remoteProvider: async (_input, _inspect, dependencies) => {
      providerCalled = true;
      assert.deepEqual(dependencies.env, { GITHUB_TOKEN: "private-token", PATH: "/usr/bin:/bin" });
      return {};
    },
    executeAudit: async (_context, selected) => {
      await selected.materialize({ parent: "/private", runId, recipeRevision: revision,
        signal: new globalThis.AbortController().signal }, async () => {});
      return { state: "COMPLETE" };
    },
    cleanupRoot: () => {}, validateRawArtifact: () => true,
    projectCurrentAudit: () => ({ projected: true }), writeProjection: () => {}, validateProjection: () => true,
  });
  assert.equal(result.state, "COMPLETE"); assert.equal(checks, 2); assert.equal(providerCalled, true);
  assert.equal(env.GH_TOKEN, undefined); assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(process.env.GH_TOKEN, undefined); assert.equal(process.env.GITHUB_TOKEN, undefined);
});

test("invalid credentials and routing are rejected after ambient credential removal and before effects", async (t) => {
  for (const tokenChange of [{}, { GH_TOKEN: "one", GITHUB_TOKEN: "two" }, { GITHUB_TOKEN: "" },
    { GITHUB_TOKEN: "x".repeat(8193) }, { GITHUB_TOKEN: "line\rbreak" }]) {
    const { env } = fixture(t); delete env.GITHUB_TOKEN; Object.assign(env, tokenChange); let effects = 0;
    await assert.rejects(runPostgresAdmissionCurrentAudit(["execute"], env, { context: host,
      verifyMain: async () => { effects++; } }), /environment_invalid/u);
    assert.equal(effects, 0); assert.equal(env.GH_TOKEN, undefined); assert.equal(env.GITHUB_TOKEN, undefined);
  }
  const { env } = fixture(t); env.DOCKER_CONTEXT = "foreign"; let effects = 0;
  await assert.rejects(runPostgresAdmissionCurrentAudit(["execute"], env, { context: host,
    verifyMain: async () => { effects++; } }), /context_invalid/u);
  assert.equal(effects, 0); assert.equal(env.GITHUB_TOKEN, undefined);

  const { env: occupied, context } = fixture(t); mkdirSync(context.projection, { mode: 0o700 });
  await assert.rejects(runPostgresAdmissionCurrentAudit(["execute"], occupied, { context: host,
    verifyMain: async () => { effects++; } }), /output_exists/u);
  assert.equal(effects, 0);
});

test("projection binds the exact sixteen raw files, report time, expiry and immutable source", { skip: process.platform !== "linux" }, (t) => {
  const { context } = fixture(t); rawEvidence(context);
  const now = new Date("2026-10-06T03:00:00.000Z");
  const projection = projectPostgresAdmissionCurrentAudit(context, policy, { now });
  assert.deepEqual(Object.keys(projection), ["kind", "subject", "checkedAt", "validUntil", "source", "files"]);
  assert.equal(projection.checkedAt, "2026-10-06T02:00:00.123456789Z");
  assert.equal(projection.validUntil, "2026-10-08T00:00:00.000Z");
  assert.deepEqual(projection.files.map((entry) => entry.role), roles);
  mkdirSync(context.projection, { mode: 0o700 });
  writeJson(path.join(context.projection, "current-audit.json"), projection);
  assert.equal(validatePostgresAdmissionCurrentAuditArtifact(context, policy), true);

  const target = path.join(context.output, "scanner-self.json"); const original = readFileSync(target);
  writeJson(target, { changed: true });
  assert.throws(() => validatePostgresAdmissionCurrentAuditArtifact(context, policy), /artifact_invalid/u);
  writeFileSync(target, original); chmodSync(target, 0o600);
  writeJson(path.join(context.output, "private.json"), {});
  assert.throws(() => projectPostgresAdmissionCurrentAudit(context, policy, { now }), /artifact_invalid/u);
});

test("blocked, expired and substituted raw evidence cannot become a current projection", { skip: process.platform !== "linux" }, (t) => {
  const { context } = fixture(t); rawEvidence(context);
  const receiptFile = path.join(context.output, "audit-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptFile)); receipt.blockerCount = 1; writeJson(receiptFile, receipt);
  assert.throws(() => projectPostgresAdmissionCurrentAudit(context, policy,
    { now: new Date("2026-10-06T03:00:00.000Z") }), /not_eligible/u);
  receipt.blockerCount = 0; receipt.registrySubject = `${policy.subject}-other`; writeJson(receiptFile, receipt);
  assert.throws(() => projectPostgresAdmissionCurrentAudit(context, policy,
    { now: new Date("2026-10-06T03:00:00.000Z") }), /not_eligible/u);
  receipt.registrySubject = policy.subject; writeJson(receiptFile, receipt);
  assert.throws(() => projectPostgresAdmissionCurrentAudit(context, policy,
    { now: new Date("2026-10-09T03:00:00.000Z") }), /expired/u);
});

test("bounded raw reads reject growth past the captured EOF, path substitution and uncertain close", { skip: process.platform !== "linux" }, (t) => {
  const create = () => { const { context } = fixture(t); rawEvidence(context); return context; };
  let context = create(); let changed = false;
  assert.throws(() => projectPostgresAdmissionCurrentAudit(context, policy, {
    now: new Date("2026-10-06T03:00:00.000Z"), fileOperations: {
      read: (fd, buffer, offset, length, position) => {
        if (length === 1 && !changed) {
          appendFileSync(path.join(context.output, "audit-receipt.json"), "x"); changed = true;
        }
        return readSync(fd, buffer, offset, length, position);
      },
    },
  }), /artifact_invalid/u);

  context = create(); let namedReads = 0;
  assert.throws(() => projectPostgresAdmissionCurrentAudit(context, policy, {
    now: new Date("2026-10-06T03:00:00.000Z"), fileOperations: {
      lstat: (file) => {
        namedReads++;
        if (namedReads === 2) {
          renameSync(file, `${file}.original`); writeJson(file, { substituted: true });
        }
        return lstatSync(file);
      },
    },
  }), /artifact_invalid/u);

  context = create();
  assert.throws(() => projectPostgresAdmissionCurrentAudit(context, policy, {
    now: new Date("2026-10-06T03:00:00.000Z"), fileOperations: { close: () => { throw new Error("close failed"); } },
  }), /artifact_invalid/u);
});

test("successful publication validates in its private sibling then atomically exposes only the final directory", { skip: process.platform !== "linux" }, async (t) => {
  const { env, context } = fixture(t);
  const result = await runPostgresAdmissionCurrentAudit(["execute"], env, { context: host,
    verifyMain: async () => true,
    readCommitted: (relative) => readFileSync(new URL(relative.endsWith("candidate-remote.json")
      ? "../infra/postgres-image/candidate-remote.json" : "../infra/postgres-image/candidate-publication-receipt.json", import.meta.url)),
    executeAudit: async () => { rawEvidence(context); return { state: "COMPLETE" }; }, cleanupRoot: () => {},
    validateRawArtifact: () => true, now: () => new Date("2026-10-06T03:00:00.000Z"),
  });
  assert.equal(result.currentAudit.kind, "POSTGRES_ADMISSION_CURRENT_AUDIT_V1");
  assert.equal(existsSync(context.projection), true);
  assert.equal(existsSync(`${context.projection}.pending-${runId}`), false);
  assert.equal(validatePostgresAdmissionCurrentAuditArtifact(context, policy), true);
});

test("projection publication is atomic across directory, write and rename faults and preserves foreign substitutions", { skip: process.platform !== "linux" }, async (t) => {
  const runFault = async (projectionWriterDependencies, foreign = false) => {
    const { env, context } = fixture(t); let checks = 0;
    await assert.rejects(runPostgresAdmissionCurrentAudit(["execute"], env, { context: host,
      verifyMain: async () => { checks++; },
      readCommitted: (relative) => readFileSync(new URL(relative.endsWith("candidate-remote.json")
        ? "../infra/postgres-image/candidate-remote.json" : "../infra/postgres-image/candidate-publication-receipt.json", import.meta.url)),
      executeAudit: async () => { rawEvidence(context); return { state: "COMPLETE" }; }, cleanupRoot: () => {},
      validateRawArtifact: () => true, now: () => new Date("2026-10-06T03:00:00.000Z"),
      projectionWriterDependencies,
    }));
    const pending = `${context.projection}.pending-${runId}`;
    assert.equal(existsSync(context.projection), false); assert.equal(checks, 2);
    assert.equal(existsSync(pending), foreign);
    return { context, pending };
  };

  await runFault({ afterDirectory: () => { throw new Error("after directory"); } });
  await runFault({ operations: { write: (fd, buffer, offset, length, position) => {
    writeSync(fd, buffer, offset, Math.min(8, length), position); throw new Error("during write");
  } } });
  await runFault({ beforeRename: () => { throw new Error("before rename"); } });
  const foreign = await runFault({ afterDirectory: (pending) => {
    const replacement = `${pending}-foreign`; mkdirSync(replacement, { mode: 0o700 });
    rmdirSync(pending); renameSync(replacement, pending);
  } }, true);
  assert.deepEqual(readdirSync(foreign.pending), ["current-audit.json"]);
});

test("default preflight failure remains a valid raw artifact and real cleanup needs no credential or projection", { skip: process.platform !== "linux" }, async (t) => {
  const { env, context } = fixture(t);
  await assert.rejects(runPostgresAdmissionCurrentAudit(["execute"], env, { context: host,
    verifyMain: async () => { throw new Error("postgres_admission_current_audit_main_invalid"); },
  }), /main_invalid/u);
  const receipt = JSON.parse(readFileSync(path.join(context.output, "audit-receipt.json")));
  assert.equal(receipt.failure.code, "postgres_remote_audit_failed");
  assert.equal(existsSync(context.projection), false);
  assert.equal((await runPostgresAdmissionCurrentAudit(["cleanup"], env, { context: host })).state, "CLEANED");
});

test("a final-main movement preserves COMPLETE raw evidence and emits no projection", async (t) => {
  const { env, context } = fixture(t); let checks = 0; let rawChecks = 0;
  await assert.rejects(runPostgresAdmissionCurrentAudit(["execute"], env, { context: host,
    verifyMain: async () => { if (++checks === 2) throw new Error("postgres_admission_current_audit_main_invalid"); },
    readCommitted: (relative) => readFileSync(new URL(relative.endsWith("candidate-remote.json")
      ? "../infra/postgres-image/candidate-remote.json" : "../infra/postgres-image/candidate-publication-receipt.json", import.meta.url)),
    executeAudit: async () => { mkdirSync(context.output, { mode: 0o700 }); writeJson(path.join(context.output, "audit-receipt.json"),
      { state: "COMPLETE" }); return { state: "COMPLETE" }; },
    cleanupRoot: () => {}, validateRawArtifact: () => { rawChecks++; return true; },
  }), /main_invalid/u);
  assert.equal(checks, 2); assert.equal(rawChecks, 2);
  assert.equal(JSON.parse(readFileSync(path.join(context.output, "audit-receipt.json"))).state, "COMPLETE");
  assert.equal(existsSync(context.projection), false);
  assert.equal(readFileSync(path.join(context.output, "audit-receipt.json")).includes(Buffer.from("private-token")), false);
});

test("cleanup validates existing raw and projection boundaries but never reconstructs a missing projection", async (t) => {
  const { env } = fixture(t); let raw = 0; let projected = 0;
  const dependencies = { context: host, cleanupRoot: () => {}, validateRawArtifact: () => { raw++; },
    validateProjection: () => { projected++; }, readCommitted: () => Buffer.from("{}"),
    policyValidator: () => policy };
  assert.equal((await runPostgresAdmissionCurrentAudit(["cleanup"], env, dependencies)).state, "CLEANED");
  assert.equal(raw, 1); assert.equal(projected, 0);
  const { env: second, context } = fixture(t); mkdirSync(context.projection, { mode: 0o700 });
  assert.equal((await runPostgresAdmissionCurrentAudit(["cleanup"], second, dependencies)).state, "CLEANED");
  assert.equal(projected, 1);
});

test("public failure is closed and never includes credentials, paths or arbitrary output", () => {
  const result = TEST_ONLY_publicPostgresAdmissionCurrentAuditFailure(
    new Error("github_pat_private C:\\private\\candidate.tar"));
  assert.deepEqual(JSON.parse(result), { state: "FAILED", reason: "postgres_remote_audit_failed",
    authority: "DIAGNOSTIC_ONLY", admission: "NOT_AUTHORIZED" });
});
