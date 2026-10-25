import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ATTESTATION, CURRENT_AUDIT_VALID_UNTIL, SIGNER_JOB_BUDGET_MS,
  prepareCandidateAttestation, validateCandidateAttestationPredicate }
  from "../scripts/postgres-image/candidate-attestation.mjs";
import { CORE_EVIDENCE } from "../scripts/postgres-image/core-evidence-acceptance.mjs";

const linux = process.platform === "linux" && Number.isSafeInteger(process.getuid?.()) && process.getuid() > 0;
const revision = "e".repeat(40);
const now = new Date("2026-10-01T10:20:00.000Z");
function auditEvidence() {
  return { observed: {
    vulnerability: { value: { Version: 2, UpdatedAt: "2026-09-30T01:15:45.849462612Z",
      DownloadedAt: "2026-09-30T05:45:22.61134751Z" } },
    java: { value: { Version: 1, UpdatedAt: "2026-09-30T00:59:00.480851969Z",
      DownloadedAt: "2026-09-30T05:46:00.457194665Z" } },
  } };
}

function nativeFixture(checkedAt = now) {
  const workspace = realpathSync(process.cwd());
  const temporary = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-pg-attest-signer-")));
  const auditDirectory = path.join(temporary, "postgres-candidate-attestation-audit-input");
  const accessDirectory = path.join(temporary, "postgres-candidate-attestation-access-input");
  mkdirSync(auditDirectory, { mode: 0o700 }); mkdirSync(accessDirectory, { mode: 0o700 });
  writeFileSync(path.join(accessDirectory, "access-receipt.json"), "{}\n", { mode: 0o600 });
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_JOB: "signer", GITHUB_REPOSITORY: ATTESTATION.repository, GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: `${ATTESTATION.repository}/${ATTESTATION.workflowPath}@refs/heads/main`,
    GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "50000000031", GITHUB_SHA: revision,
    GITHUB_WORKSPACE: workspace, RUNNER_TEMP: temporary, POSTGRES_ATTESTATION_ACCESS_ARTIFACT_ID: "7123" };
  const commandRunner = (_command, args) => {
    const marker = "HEAD:"; const selected = args[1]?.startsWith(marker) ? args[1].slice(marker.length) : "";
    if (!selected) return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    return { status: 0, stdout: readFileSync(path.join(workspace, selected)), stderr: Buffer.alloc(0) };
  };
  const dependencies = {
    context: { platform: "linux", uid: process.getuid(), gid: process.getgid() }, commandRunner,
    verifyMain: async () => true, verifyAuditApi: async () => true,
    replayAudit(directory) {
      assert.equal(directory, auditDirectory);
      writeFileSync(path.join(directory, "database-evidence.json"), JSON.stringify(auditEvidence()), { mode: 0o600 });
      writeFileSync(path.join(directory, "candidate-vulnerabilities.json"),
        JSON.stringify({ CreatedAt: "2026-09-30T05:47:20.54155393Z" }), { mode: 0o600 });
      return { receipt: { state: "COMPLETE" } };
    },
    validateAccess: async () => true,
    verifyAccessArtifact: async () => ({ id: 7123, name: "postgres-candidate-attestation-access",
      size: 2048, digest: `sha256:${"a".repeat(64)}` }),
  };
  return { input: { workspace, now: checkedAt }, env, dependencies, temporary };
}

async function prepared(t, checkedAt = now) {
  const scope = nativeFixture(checkedAt); t.after(() => rmSync(scope.temporary, { recursive: true, force: true }));
  return { scope, result: await prepareCandidateAttestation(scope.input, scope.env, scope.dependencies) };
}

test("prepares a closed predicate bound to distinct build, evidence and signer revisions", { skip: !linux }, async (t) => {
  const { result } = await prepared(t);
  assert.equal(result.predicate.source.buildRecipeRevision, "b93b0c76ec76abe283d66a17fa62eab7e580e679");
  assert.equal(result.predicate.source.evidenceRecipeRevision, "4a28d5e3cef525a8cf54ba5a1336d7af8573df1d");
  assert.equal(result.predicate.signer.recipeRevision, revision);
  assert.deepEqual(result.predicate.coreEvidence.acceptance, CORE_EVIDENCE.acceptance);
  assert.equal(result.predicate.currentness.signerBudgetMs, SIGNER_JOB_BUDGET_MS);
  assert.equal(result.predicate.currentness.validUntil, CURRENT_AUDIT_VALID_UNTIL);
  assert.equal(result.predicate.settingsObservation.forkIsolation, "NOT_VERIFIED");
  assert.equal(result.predicate.support.supportStartsAt, null);
  assert.equal(result.receipt.signing, "PENDING_OFFICIAL_ACTION");
  assert.equal(readFileSync(result.predicatePath).at(-1), 10);
});

test("rejects source, subject configuration and audit substitutions", { skip: !linux }, async (t) => {
  const { result } = await prepared(t);
  for (const candidate of [
    { ...result.predicate, source: { ...result.predicate.source, buildRecipeRevision: revision } },
    { ...result.predicate, subject: { ...result.predicate.subject, imageId: `sha256:${"b".repeat(64)}` } },
    { ...result.predicate, audit: { ...result.predicate.audit,
      receipt: { ...result.predicate.audit.receipt, sha256: "c".repeat(64) } } },
  ]) assert.throws(() => validateCandidateAttestationPredicate(candidate, candidate),
    /postgres_candidate_attestation_predicate_invalid/u);
});

test("rejects core, controls, promoted claims and activation date substitutions", { skip: !linux }, async (t) => {
  const { result } = await prepared(t);
  for (const candidate of [
    { ...result.predicate, coreEvidence: { ...result.predicate.coreEvidence,
      acceptance: { ...result.predicate.coreEvidence.acceptance, bytes: 1 } } },
    { ...result.predicate, settingsObservation: { ...result.predicate.settingsObservation, visibility: "Public" } },
    { ...result.predicate, coreEvidence: { ...result.predicate.coreEvidence, legalCompliance: "ESTABLISHED" } },
    { ...result.predicate, support: { ...result.predicate.support, supportStartsAt: "2026-10-01T00:00:00.000Z" } },
  ]) assert.throws(() => validateCandidateAttestationPredicate(candidate, candidate),
    /postgres_candidate_attestation_predicate_invalid/u);
});

test("rejects getters, symbols, sparse arrays and inherited serialization hooks without invoking them", () => {
  let getterCalls = 0; let hookCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "kind", { enumerable: true, get() { getterCalls += 1; return "x"; } });
  const symbol = { kind: "x" }; symbol[Symbol("private")] = true;
  const sparse = { retainedEvidence: new Array(1) };
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  try {
    Object.defineProperty(Object.prototype, "toJSON", { configurable: true,
      value() { hookCalls += 1; throw new Error("must_not_run"); } });
    for (const value of [accessor, symbol, sparse]) assert.throws(
      () => validateCandidateAttestationPredicate(value, value),
      /postgres_candidate_attestation_predicate_invalid/u);
  } finally {
    if (original) Object.defineProperty(Object.prototype, "toJSON", original); else delete Object.prototype.toJSON;
  }
  assert.equal(getterCalls, 0); assert.equal(hookCalls, 0);
});

test("expired or zero-reserve audit windows write no signer output", { skip: !linux }, async (t) => {
  for (const offset of [0, 1]) {
    const checkedAt = new Date(Date.parse(CURRENT_AUDIT_VALID_UNTIL) - SIGNER_JOB_BUDGET_MS + offset);
    const scope = nativeFixture(checkedAt); t.after(() => rmSync(scope.temporary, { recursive: true, force: true }));
    await assert.rejects(prepareCandidateAttestation(scope.input, scope.env, scope.dependencies),
      /postgres_candidate_attestation_signing_window_expired/u);
    assert.throws(() => readFileSync(path.join(scope.temporary, "postgres-candidate-attestation", "predicate.json")));
  }
});

test("wrong signer job and missing committed P1 evidence write no signer output", { skip: !linux }, async (t) => {
  const wrongJob = nativeFixture(); wrongJob.env.GITHUB_JOB = "access";
  const missingP1 = nativeFixture();
  const normalRunner = missingP1.dependencies.commandRunner;
  missingP1.dependencies.commandRunner = (command, args, options) =>
    args[1] === "HEAD:infra/postgres-image/core-evidence-acceptance.json"
      ? { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      : normalRunner(command, args, options);
  for (const scope of [wrongJob, missingP1]) {
    t.after(() => rmSync(scope.temporary, { recursive: true, force: true }));
    await assert.rejects(prepareCandidateAttestation(scope.input, scope.env, scope.dependencies),
      /postgres_candidate_attestation_(?:context_invalid|evidence_invalid)/u);
    assert.throws(() => readFileSync(path.join(scope.temporary, "postgres-candidate-attestation", "predicate.json")));
  }
});
