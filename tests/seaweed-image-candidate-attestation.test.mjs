import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ATTESTATION, prepareCandidateAttestation, validateCandidateAttestationPredicate }
  from "../scripts/seaweed-image/candidate-attestation.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const files = Object.freeze({
  policy: "infra/seaweed-image/candidate-remote.json",
  runtimePolicy: "infra/seaweed-image/candidate-remote-runtime.json",
  publication: "infra/seaweed-image/candidate-publication-receipt.json",
  audit: "infra/seaweed-image/candidate-remote-audit-receipt.json",
  runtime: "infra/seaweed-image/candidate-remote-runtime-receipt.json",
  retention: "infra/seaweed-image/candidate-local-retention-receipt.json",
  restore: "infra/seaweed-image/candidate-local-restore-receipt.json",
});
const relativeToKey = Object.freeze(Object.fromEntries(Object.entries(files).map(([key, value]) => [value, key])));
const committed = Object.freeze(Object.fromEntries(Object.entries(files)
  .map(([key, relative]) => [key, readFileSync(path.join(ROOT, relative))])));
const parsed = Object.freeze(Object.fromEntries(Object.entries(committed)
  .map(([key, bytes]) => [key, JSON.parse(bytes.toString("utf8"))])));
const auditNames = ["audit-receipt.json", "candidate-vulnerabilities.json", "candidate-sbom.cdx.json",
  "database-evidence.json", "database-vulnerability-before-manifest.json",
  "database-vulnerability-after-manifest.json", "database-java-before-manifest.json",
  "database-java-after-manifest.json"];

function fixture() {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "aw-attestation-"));
  const workspace = path.join(temporary, "workspace");
  const auditDirectory = path.join(temporary, "seaweed-candidate-remote-audit-input");
  mkdirSync(workspace); mkdirSync(auditDirectory);
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_JOB: "signer", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: ATTESTATION.repository,
    GITHUB_WORKFLOW_REF: `${ATTESTATION.repository}/${ATTESTATION.workflowPath}@refs/heads/main`,
    GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "40000000001",
    GITHUB_SHA: "1".repeat(40), GITHUB_WORKSPACE: workspace, RUNNER_TEMP: temporary,
    GITHUB_TOKEN: "token", GH_TOKEN: "token" };
  const audit = Object.freeze(Object.fromEntries(auditNames.map((name) => [name,
    name === "audit-receipt.json" ? committed.audit : Buffer.from(`{"name":"${name}"}\n`)])));
  const dependencies = { context: { platform: "linux", uid: 1000, gid: 1000 },
    requireCleanCheckout() {}, verifyMain: async () => true, verifyAuditApi: async () => true,
    readCommitted(relative) { return committed[relativeToKey[relative]]; }, readAudit: () => audit,
    validateAuditEvidence(value) {
      assert.equal(value.now.toISOString(), "2026-09-27T15:00:00.000Z");
      return { receipt: parsed.audit, runtimePolicy: parsed.runtimePolicy };
    } };
  return { temporary, input: { workspace, auditDirectory,
    now: new Date("2026-09-27T15:00:00.000Z") }, env, dependencies };
}

test("prepares a closed evidence predicate and canonical pre-sign receipt from reviewed records", async () => {
  const scope = fixture();
  try {
    const result = await prepareCandidateAttestation(scope.input, scope.env, scope.dependencies);
    assert.deepEqual(result.subject, { name: ATTESTATION.subjectName, digest: ATTESTATION.subjectDigest });
    assert.equal(result.predicateType, ATTESTATION.predicateType);
    assert.equal(result.predicate.state, "EVIDENCE_VERIFIED");
    assert.equal(result.predicate.publisher.result, "FAILED");
    assert.equal(result.predicate.audit.findings.blockerCount, 0);
    assert.deepEqual(result.predicate.runtime.profiles,
      ["basic", "persistence", "strict", "backup", "hostLoopback"]);
    assert.deepEqual(result.predicate.support, { durationFromActivation: "P1Y",
      archiveRetentionAfterSupport: "P365D", supportStartsAt: null, supportEndsAt: null,
      archiveRetainUntil: null, dates: "PENDING_ADMISSION_ACTIVATION", automaticDeletion: "DISABLED",
      continuousSecurityControls: "REQUIRED_DURING_SUPPORT" });
    assert.equal(result.predicate.admission, "NOT_AUTHORIZED");
    assert.deepEqual(validateCandidateAttestationPredicate(result.predicate, result.predicate), result.predicate);
    const predicateBytes = readFileSync(result.predicatePath);
    const receiptBytes = readFileSync(result.receiptPath);
    assert.equal(predicateBytes.at(-1), 10); assert.equal(receiptBytes.at(-1), 10);
    const receipt = JSON.parse(receiptBytes.toString("utf8"));
    assert.deepEqual(receipt, { kind: "SEAWEED_CANDIDATE_PRE_SIGN_RECEIPT_V1",
      state: "EVIDENCE_VERIFIED", authority: "REVIEWED_MAIN_SIGNER",
      candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
      signing: "PENDING_OFFICIAL_ACTION", repository: ATTESTATION.repository,
      workflowPath: ATTESTATION.workflowPath, sourceRef: "refs/heads/main", runId: "40000000001",
      runNumber: "1", runAttempt: "1", recipeRevision: "1".repeat(40), subject: result.subject,
      predicate: { type: ATTESTATION.predicateType,
        sha256: createHash("sha256").update(predicateBytes).digest("hex"),
        bytes: predicateBytes.length, file: "predicate.json" } });
  } finally { rmSync(scope.temporary, { recursive: true, force: true }); }
});

test("rejects stale audit validation before writing signer inputs", async () => {
  const scope = fixture();
  try {
    scope.dependencies.validateAuditEvidence = () => { throw new Error("seaweed_remote_runtime_audit_invalid"); };
    await assert.rejects(prepareCandidateAttestation(scope.input, scope.env, scope.dependencies),
      /seaweed_remote_runtime_audit_invalid/u);
    assert.throws(() => readFileSync(path.join(scope.temporary, "seaweed-candidate-attestation",
      "predicate.json")));
  } finally { rmSync(scope.temporary, { recursive: true, force: true }); }
});

test("requires audit freshness for the complete remaining signer job budget", async () => {
  for (const remainingMs of [20 * 60 * 1000, 20 * 60 * 1000 - 1]) {
    const scope = fixture();
    try {
      scope.input.now = new Date(Date.parse(parsed.audit.databases.metadata.vulnerability.updatedAt)
        + 48 * 60 * 60 * 1000 - remainingMs);
      scope.dependencies.validateAuditEvidence = () => ({ receipt: parsed.audit,
        runtimePolicy: parsed.runtimePolicy });
      if (remainingMs === 20 * 60 * 1000) {
        const result = await prepareCandidateAttestation(scope.input, scope.env, scope.dependencies);
        assert.equal(result.predicate.audit.databases.vulnerability.freshAtPreparation, true);
      } else {
        await assert.rejects(prepareCandidateAttestation(scope.input, scope.env, scope.dependencies),
          /seaweed_candidate_attestation_signing_window_expired/u);
        assert.throws(() => readFileSync(path.join(scope.temporary, "seaweed-candidate-attestation", "predicate.json")));
      }
    } finally { rmSync(scope.temporary, { recursive: true, force: true }); }
  }
});

test("rejects changed evidence bindings and signer context substitutions", async () => {
  for (const mutate of [
    (scope) => { scope.env.GITHUB_WORKFLOW_REF = `${ATTESTATION.repository}/other.yml@refs/heads/main`; },
    (scope) => { scope.env.GITHUB_RUN_ATTEMPT = "2"; },
    (scope) => { scope.env.GITHUB_REF = "refs/heads/feature"; },
    (scope) => { scope.dependencies.readCommitted = (relative) => relative === files.publication
      ? Buffer.from(committed.publication.toString("utf8").replace("PUBLISHED_UNADMITTED", "CHANGED"))
      : committed[relativeToKey[relative]]; },
    (scope) => {
      const runtime = JSON.parse(JSON.stringify(parsed.runtime));
      const restore = JSON.parse(JSON.stringify(parsed.restore));
      runtime.auditBinding.runId = "1"; restore.priorEvidence.auditBinding.runId = "1";
      scope.dependencies.readCommitted = (relative) => relative === files.runtime
        ? Buffer.from(JSON.stringify(runtime)) : relative === files.restore
          ? Buffer.from(JSON.stringify(restore)) : committed[relativeToKey[relative]];
    },
  ]) {
    const scope = fixture();
    try {
      mutate(scope);
      await assert.rejects(prepareCandidateAttestation(scope.input, scope.env, scope.dependencies),
        /seaweed_(?:candidate_attestation|remote_audit|remote_runtime)_/u);
    } finally { rmSync(scope.temporary, { recursive: true, force: true }); }
  }
});

test("predicate validation rejects substitutions, missing fields and extra keys", () => {
  const expected = { kind: "SEAWEED_CANDIDATE_ATTESTATION_PREDICATE_V1", state: "EVIDENCE_VERIFIED",
    authority: "REVIEWED_MAIN_SIGNER", subject: {}, source: {}, publisher: {}, audit: {}, runtime: {},
    localArchive: {}, support: {}, admission: "NOT_AUTHORIZED" };
  assert.throws(() => validateCandidateAttestationPredicate(expected, expected),
    /seaweed_candidate_attestation_predicate_invalid/u);
  const scope = fixture();
  return prepareCandidateAttestation(scope.input, scope.env, scope.dependencies).then((result) => {
    for (const changed of [
      { ...result.predicate, admission: "AUTHORIZED" },
      { ...result.predicate, extra: true },
      { ...result.predicate, support: { ...result.predicate.support, supportStartsAt: "2026-09-27" } },
      { ...result.predicate, audit: { ...result.predicate.audit,
        scanner: { ...result.predicate.audit.scanner, version: "/private/scanner" } } },
      { ...result.predicate, runtime: { ...result.predicate.runtime,
        receipt: { ...result.predicate.runtime.receipt, extra: true } } },
    ]) assert.throws(() => validateCandidateAttestationPredicate(changed, result.predicate),
      /seaweed_candidate_attestation_predicate_invalid/u);
  }).finally(() => rmSync(scope.temporary, { recursive: true, force: true }));
});
