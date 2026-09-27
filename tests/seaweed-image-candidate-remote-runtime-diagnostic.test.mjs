import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { publicRemoteRuntimeFailure, requireRemoteRuntimeContext, runRemoteRuntimeDiagnostic,
  validateRemoteAuditEvidence, validateRemoteRuntimePolicy, verifyRemoteAuditApi,
} from "../scripts/seaweed-image/candidate-remote-runtime-diagnostic.mjs";

const candidatePolicy = JSON.parse(readFileSync(
  new URL("../infra/seaweed-image/candidate-remote.json", import.meta.url), "utf8"));
const publicationBytes = readFileSync(
  new URL("../infra/seaweed-image/candidate-publication-receipt.json", import.meta.url));
const baseConfigBytes = readFileSync(new URL("../infra/seaweed-image/base-config.json", import.meta.url));
const auditRunId = "36325906357";
const auditRevision = "407d013e08630964c9c756dfe1451b0c910cef28";
const runtimeRevision = "a".repeat(40);
const now = new Date("2026-09-27T12:00:00.000Z");

function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function manifestBytes(seed) {
  return Buffer.from(JSON.stringify({ schemaVersion: 2, layers: [{
    digest: `sha256:${seed.repeat(64)}`, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", size: 1024,
  }], annotations: "x".repeat(64) }));
}

function evidenceFixture(changeReceipt) {
  const vulnerabilityBytes = Buffer.from("{}\n"); const cyclonedxBytes = Buffer.from("[]\n");
  const reportIdentity = (bytes) => ({ sha256: hash(bytes), size: bytes.length });
  const manifests = { "vulnerability-before": manifestBytes("1"), "vulnerability-after": manifestBytes("1"),
    "java-before": manifestBytes("2"), "java-after": manifestBytes("2") };
  const databaseFiles = ["db/trivy.db", "db/metadata.json", "java-db/trivy-java.db", "java-db/metadata.json"]
    .map((file, index) => ({ path: `/cache/${file}`, sha256: `${index + 3}`.repeat(64), size: 100 + index,
      cap: index % 2 === 0 ? 2 * 1024 ** 3 : 8 * 1024 ** 2 }));
  const metadataValues = {
    vulnerability: { UpdatedAt: "2026-09-27T11:00:00Z", DownloadedAt: "2026-09-27T11:30:00Z", Version: 2 },
    java: { UpdatedAt: "2026-08-01T00:00:00Z", DownloadedAt: "2026-08-01T00:30:00Z", Version: 1 },
  };
  const receipt = {
    kind: "SEAWEED_EXACT_REMOTE_CANDIDATE_AUDIT_V1", state: "COMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", publication: "NOT_ATTEMPTED", admission: "NOT_ATTEMPTED",
    imageExecution: "NOT_ATTEMPTED", runId: auditRunId, recipeRevision: auditRevision, phase: "COMPLETE",
    registrySubject: candidatePolicy.subject, scannerInput: "LOCAL_DOCKER_SAVE_ARCHIVE",
    blockerCount: 0, blockers: [], blockersTruncated: false, findingCount: 0,
    containerCleanup: ["db-java", "db-vulnerability", "scan-cyclonedx", "scan-json"]
      .map((kind) => ({ kind, state: "OWNED_CONTAINER_ABSENT" })),
    reports: { vulnerability: reportIdentity(vulnerabilityBytes), cyclonedx: reportIdentity(cyclonedxBytes) },
    subject: { artifactName: "/candidate/saved.tar", imageId: candidatePolicy.candidate.imageId,
      diffId: candidatePolicy.candidate.diffId, archiveSha256: "b".repeat(64), archiveBytes: 8192,
      configSha256: candidatePolicy.source.configSha256, configBytes: candidatePolicy.source.configBytes,
      layerSha256: candidatePolicy.source.savedLayerSha256, layerBytes: candidatePolicy.source.savedLayerBytes,
      tag: `auto-world-seaweed-s3:remote-${auditRunId}-attempt-1` },
    candidate: { runId: auditRunId, recipeRevision: auditRevision, subject: candidatePolicy.subject,
      execution: "NOT_ATTEMPTED", phases: [
        { name: "owned_docker_cleanup", result: "PASSED", durationMs: 1 },
        { name: "owned_temporary_cleanup", result: "PASSED", durationMs: 1 },
      ] },
    databases: { files: databaseFiles, metadata: {
      vulnerability: { updatedAt: "2026-09-27T11:00:00Z", downloadedAt: "2026-09-27T11:30:00Z",
        version: 2, ageMs: 3_600_000, maxAgeMs: 172_800_000, freshAt48Hours: true },
      java: { updatedAt: "2026-08-01T00:00:00Z", downloadedAt: "2026-08-01T00:30:00Z",
        version: 1, ageMs: 4_968_000_000, maxAgeMs: null, freshAt48Hours: false },
    }, registry: [
      { name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db", tag: "2",
        digest: `sha256:${hash(manifests["vulnerability-before"])}`, size: manifests["vulnerability-before"].length,
        layerBytes: 1024 },
      { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db", tag: "1",
        digest: `sha256:${hash(manifests["java-before"])}`, size: manifests["java-before"].length,
        layerBytes: 1024 },
    ] },
  };
  changeReceipt?.(receipt);
  const databaseEvidenceBytes = Buffer.from(`${JSON.stringify({ checkedAt: now.toISOString(),
    maxAgeMsByDatabase: { vulnerability: 172_800_000, java: null }, files: databaseFiles,
    observed: { vulnerability: { value: metadataValues.vulnerability,
      identity: { sha256: databaseFiles[1].sha256, size: databaseFiles[1].size } },
    java: { value: metadataValues.java,
      identity: { sha256: databaseFiles[3].sha256, size: databaseFiles[3].size } } },
    validation: [
      { name: "vulnerability", result: "passed", ageMs: 3_600_000,
        maxAgeMs: 172_800_000, freshAt48Hours: true },
      { name: "java", result: "passed", ageMs: 4_968_000_000,
        maxAgeMs: null, freshAt48Hours: false },
    ] })}\n`);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt)}\n`);
  const runtimePolicy = {
    kind: "SEAWEED_REMOTE_RUNTIME_POLICY_V1", authority: "REVIEWED_MAIN_POLICY",
    subject: candidatePolicy.subject,
    audit: { workflowPath: ".github/workflows/seaweed-candidate-remote-audit.yml", runId: auditRunId,
      runNumber: "1", runAttempt: "1", recipeRevision: auditRevision,
      artifact: { id: 10_933_995_168, name: "seaweed-candidate-remote-audit", bytes: 123_456,
        digest: `sha256:${"c".repeat(64)}` },
      files: { receipt: { sha256: hash(receiptBytes), bytes: receiptBytes.length },
        vulnerability: { sha256: hash(vulnerabilityBytes), bytes: vulnerabilityBytes.length },
        cyclonedx: { sha256: hash(cyclonedxBytes), bytes: cyclonedxBytes.length } } },
  };
  return { receipt, receiptBytes, vulnerabilityBytes, cyclonedxBytes,
    databaseEvidenceBytes, databaseManifestBytes: manifests, runtimePolicy };
}

function environment(root) {
  return { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_JOB: "runtime", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-candidate-remote-runtime.yml@refs/heads/main",
    GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: runtimeRevision,
    GITHUB_RUN_ID: "40000000000", RUNNER_TEMP: root, GITHUB_WORKSPACE: root,
    GITHUB_TOKEN: "token", GH_TOKEN: "token", PATH: "/bin" };
}

const auditValidation = {
  validateCandidateReceipt: (receipt) => {
    if (receipt?.subject !== candidatePolicy.subject) throw new Error("candidate_invalid");
    return receipt;
  },
  evaluatePolicy: () => ({ state: "COMPLETE", findings: [], blockers: [] }),
};

test("runtime context is fixed to the first hosted main runtime job", () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-remote-runtime-context-")));
  try {
    const env = environment(root); const host = { platform: "linux", uid: 1001, gid: 1001 };
    const context = requireRemoteRuntimeContext(env, host);
    assert.equal(context.auditInput, path.join(root, "seaweed-candidate-remote-audit-input"));
    for (const changed of [{ GITHUB_JOB: "audit" }, { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_REPOSITORY: "attacker/fork" }, { GITHUB_RUN_NUMBER: "2" },
      { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_WORKFLOW_REF: "attacker/workflow" }]) {
      assert.throws(() => requireRemoteRuntimeContext({ ...env, ...changed }, host), /context_invalid/u);
    }
    assert.throws(() => requireRemoteRuntimeContext(env, { ...host, uid: 0 }), /context_invalid/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("runtime policy binds the reviewed audit, artifact and all three evidence files", () => {
  const { runtimePolicy } = evidenceFixture();
  assert.equal(validateRemoteRuntimePolicy(runtimePolicy, candidatePolicy).subject, candidatePolicy.subject);
  for (const change of [
    (policy) => { policy.subject = `${candidatePolicy.image}@sha256:${"0".repeat(64)}`; },
    (policy) => { policy.audit.recipeRevision = "invalid"; },
    (policy) => { policy.audit.artifact.name = "other"; },
    (policy) => { policy.audit.files.receipt.bytes = 0; },
  ]) {
    const changed = JSON.parse(JSON.stringify(runtimePolicy)); change(changed);
    assert.throws(() => validateRemoteRuntimePolicy(changed, candidatePolicy), /policy_invalid/u);
  }
});

test("audit evidence requires exact bytes, complete zero-blocker receipt and fresh vulnerability data", () => {
  const fixture = evidenceFixture();
  const validate = (value = fixture) => validateRemoteAuditEvidence({ ...value,
    candidatePolicy, now }, auditValidation);
  assert.equal(validate().receipt.registrySubject, candidatePolicy.subject);
  assert.throws(() => validate({ ...fixture,
    vulnerabilityBytes: Buffer.concat([fixture.vulnerabilityBytes, Buffer.from(" ")]) }), /evidence_invalid/u);
  for (const mutate of [
    (receipt) => { receipt.registrySubject = `${candidatePolicy.image}@sha256:${"0".repeat(64)}`; },
    (receipt) => { receipt.blockerCount = 1; receipt.blockers = [{ code: "blocked" }]; },
    (receipt) => { receipt.state = "INCOMPLETE"; },
    (receipt) => { receipt.candidate.phases.at(-2).result = "FAILED"; },
    (receipt) => { receipt.databases.metadata.vulnerability.updatedAt = "2026-09-20T00:00:00Z"; },
  ]) {
    const changed = evidenceFixture(mutate);
    assert.throws(() => validate(changed), /audit_invalid/u);
  }
  assert.throws(() => validate({ ...fixture,
    databaseManifestBytes: { ...fixture.databaseManifestBytes,
      "java-after": manifestBytes("9") } }), /audit_invalid/u);
});

test("prior audit API must be successful exact-head metadata with the unexpired fixed artifact", async () => {
  const { runtimePolicy } = evidenceFixture();
  const run = { id: Number(auditRunId), run_number: 1, run_attempt: 1, event: "workflow_dispatch",
    status: "completed", conclusion: "success", head_branch: "main", head_sha: auditRevision,
    path: ".github/workflows/seaweed-candidate-remote-audit.yml", repository: { full_name: "CleMeY15/auto-world" } };
  const artifact = { id: runtimePolicy.audit.artifact.id, name: runtimePolicy.audit.artifact.name,
    size_in_bytes: runtimePolicy.audit.artifact.bytes, digest: runtimePolicy.audit.artifact.digest,
    expired: false, expires_at: "2026-10-10T00:00:00Z",
    workflow_run: { id: Number(auditRunId), head_sha: auditRevision } };
  const responses = (runValue = run, artifactValue = artifact) => async (url) => new globalThis.Response(
    JSON.stringify(url.endsWith("/artifacts") ? { total_count: 3, artifacts: [artifactValue] } : runValue),
    { status: 200 });
  const env = { GITHUB_TOKEN: "token", GH_TOKEN: "token" };
  assert.equal(await verifyRemoteAuditApi(runtimePolicy, {}, env,
    { fetchImpl: responses(), now: () => now.getTime() }), true);
  for (const [runValue, artifactValue] of [
    [{ ...run, conclusion: "failure" }, artifact],
    [{ ...run, head_sha: "f".repeat(40) }, artifact],
    [run, { ...artifact, digest: `sha256:${"0".repeat(64)}` }],
    [run, { ...artifact, expired: true }],
  ]) await assert.rejects(verifyRemoteAuditApi(runtimePolicy, {}, env,
    { fetchImpl: responses(runValue, artifactValue), now: () => now.getTime() }), /api_invalid/u);
});

async function runHarness({ tamperReceipt = false, mutateReceipt, mutatePolicy, apiFailure = false } = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-remote-runtime-run-")));
  const env = environment(root); const fixture = evidenceFixture(mutateReceipt); let suiteCalls = 0;
  mutatePolicy?.(fixture.runtimePolicy);
  const committed = new Map([
    ["infra/seaweed-image/candidate-remote.json", Buffer.from(JSON.stringify(candidatePolicy))],
    ["infra/seaweed-image/candidate-publication-receipt.json", publicationBytes],
    ["infra/seaweed-image/base-config.json", baseConfigBytes],
    ["infra/seaweed-image/candidate-remote-runtime.json", Buffer.from(JSON.stringify(fixture.runtimePolicy))],
  ]);
  const auditFiles = new Map([["audit-receipt.json", tamperReceipt
    ? Buffer.concat([fixture.receiptBytes, Buffer.from(" ")]) : fixture.receiptBytes],
  ["candidate-vulnerabilities.json", fixture.vulnerabilityBytes],
  ["candidate-sbom.cdx.json", fixture.cyclonedxBytes],
  ["database-evidence.json", fixture.databaseEvidenceBytes],
  ...Object.entries(fixture.databaseManifestBytes).map(([name, bytes]) =>
    [`database-${name.replace("-", "-")}-manifest.json`, bytes])]);
  try {
    const result = await runRemoteRuntimeDiagnostic(["execute"], env, {
      context: { platform: "linux", uid: 1001, gid: 1001 }, verifyMain: async () => true,
      verifyAuditApi: async () => {
        if (apiFailure) throw new Error("seaweed_remote_runtime_api_invalid");
        return true;
      }, readCommitted: (name) => committed.get(name),
      validateAuditInput: () => true, readAudit: (file) => auditFiles.get(path.basename(file)),
      auditValidation, now: () => now.getTime(), validateAuditBinding: (binding) => Object.freeze(binding),
      runtimeSuite: async (input) => {
        suiteCalls += 1;
        return { kind: "SEAWEED_REMOTE_RUNTIME_CANDIDATE_RECEIPT_V1", state: "VERIFIED",
          subject: input.policy.subject, runId: input.runId, recipeRevision: input.recipeRevision };
      },
      validateRuntimeReceipt: (receipt) => receipt,
    });
    return { root, result, suiteCalls };
  } catch (error) { return { root, error, suiteCalls }; }
}

test("all retained audit validation completes before the runtime suite can execute", async () => {
  const success = await runHarness();
  try {
    assert.equal(success.error, undefined); assert.equal(success.suiteCalls, 1);
    assert.equal(success.result.subject, candidatePolicy.subject);
    assert.equal(JSON.parse(readFileSync(path.join(success.root,
      "seaweed-candidate-remote-runtime-evidence/runtime-receipt.json"))).state, "VERIFIED");
  } finally { rmSync(success.root, { recursive: true, force: true }); }
  const failed = await runHarness({ tamperReceipt: true });
  try {
    assert.match(failed.error.message, /evidence_invalid/u); assert.equal(failed.suiteCalls, 0);
    assert.deepEqual(JSON.parse(readFileSync(path.join(failed.root,
      "seaweed-candidate-remote-runtime-evidence/runtime-receipt.json"))),
    publicRemoteRuntimeFailure(failed.error));
  } finally { rmSync(failed.root, { recursive: true, force: true }); }
  for (const options of [
    { mutateReceipt: (receipt) => { receipt.blockerCount = 1; receipt.blockers = [{ code: "blocked" }]; } },
    { mutatePolicy: (policy) => { policy.subject = `${candidatePolicy.image}@sha256:${"0".repeat(64)}`; } },
    { apiFailure: true },
  ]) {
    const rejected = await runHarness(options);
    try { assert.ok(rejected.error); assert.equal(rejected.suiteCalls, 0); }
    finally { rmSync(rejected.root, { recursive: true, force: true }); }
  }
});

test("public failures contain only fixed non-secret diagnostic fields", () => {
  const expected = {
    kind: "SEAWEED_REMOTE_RUNTIME_DIAGNOSTIC_FAILURE_V1", state: "FAILED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
    admission: "NOT_AUTHORIZED", publication: "PUBLISHED_UNADMITTED",
    imageExecution: "NOT_VERIFIED", code: "seaweed_remote_runtime_diagnostic_failed",
    diagnosticFailure: null, materialPrimaryFailure: null,
    imageCleanupFailure: null, temporaryCleanupFailure: null,
  };
  assert.deepEqual(publicRemoteRuntimeFailure(new Error("token ghp_private")), expected);
  assert.deepEqual(publicRemoteRuntimeFailure(new Error("seaweed_remote_runtime_token_ghp_private")), expected);
  const aggregate = Object.assign(new Error("seaweed_remote_runtime_candidate_failed"), {
    code: "seaweed_remote_runtime_candidate_failed", state: "INCOMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", diagnosticFailure: {
      code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_PROBE", reason: "READBACK_MISMATCH",
      runtimeCleanupFailure: { code: "seaweed_candidate_runtime_cleanup_failed",
        phase: "RUNTIME_CLEANUP", reason: "OWNERSHIP_UNCERTAIN" }, secret: undefined,
    }, materialPrimaryFailure: "seaweed_remote_runtime_diagnostics_failed",
    imageCleanupFailure: "seaweed_remote_candidate_image_cleanup_failed",
    temporaryCleanupFailure: "seaweed_remote_candidate_temporary_cleanup_failed",
  });
  delete aggregate.diagnosticFailure.secret;
  const sanitized = publicRemoteRuntimeFailure(aggregate);
  assert.deepEqual(sanitized.diagnosticFailure, aggregate.diagnosticFailure);
  assert.equal(sanitized.materialPrimaryFailure, "seaweed_remote_runtime_diagnostics_failed");
  assert.equal(sanitized.imageCleanupFailure, "seaweed_remote_candidate_image_cleanup_failed");
  assert.equal(sanitized.temporaryCleanupFailure, "seaweed_remote_candidate_temporary_cleanup_failed");
  aggregate.diagnosticFailure.reason = "secret /home/runner/private";
  aggregate.imageCleanupFailure = "ghp_private";
  const redacted = publicRemoteRuntimeFailure(aggregate);
  assert.equal(redacted.diagnosticFailure, null);
  assert.equal(redacted.imageCleanupFailure, null);
  assert.equal(JSON.stringify(redacted).includes("/home/runner"), false);
});
