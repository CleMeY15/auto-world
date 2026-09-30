import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluatePostgresRemoteAuditPolicy, projectPostgresRemoteAuditSnapshot,
  requirePostgresRemoteAuditContext, runPostgresRemoteAudit, runPostgresRemoteScannerControls,
  TEST_ONLY_publicPostgresRemoteAuditFailure, validatePostgresRemoteAuditArtifact,
  validatePostgresRemoteAuditCandidateReceipt, verifyPostgresRemoteAuditMain } from "../scripts/postgres-image/candidate-remote-audit.mjs";
import { validatePostgresRemotePolicy } from "../scripts/postgres-image/candidate-remote.mjs";
import { validateDatabaseMetadata } from "../scripts/scanner/audit-policy.mjs";

const revision = "a".repeat(40); const runId = "40000000111";
const policyBytes = readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url));
const publicationBytes = readFileSync(new URL("../infra/postgres-image/candidate-publication-receipt.json", import.meta.url));
const policy = validatePostgresRemotePolicy(JSON.parse(policyBytes));
const archiveSha256 = "d".repeat(64);
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
const alias = `aw-postgres-gosu:${hash(Buffer.from(`${runId}:${revision}`)).slice(0, 24)}`;
const host = { platform: "linux", uid: process.getuid?.() ?? 1001, gid: process.getgid?.() ?? 1001 };
const overrideHost = { platform: "linux", uid: 1001, gid: 1001 };

function fixture(t) {
  const runnerTemp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-pg-remote-audit-")));
  const workspace = path.join(runnerTemp, "workspace"); mkdirSync(workspace, { mode: 0o700 });
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_JOB: "audit",
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/postgres-candidate-remote-audit.yml@refs/heads/main",
    GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: revision, GITHUB_RUN_ID: runId,
    RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace, GITHUB_TOKEN: "secret", GH_TOKEN: "secret", PATH: "/bin" };
  return { env, runnerTemp, context: requirePostgresRemoteAuditContext(env, overrideHost) };
}
function remoteReceipt() {
  return { kind: "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "REMOTE_READ_ONLY",
    publication: "PUBLISHED_UNADMITTED", registryWrite: "NOT_ATTEMPTED", vulnerabilityAudit: "NOT_ATTEMPTED",
    imageExecution: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    runId, recipeRevision: revision, subject: policy.subject, alias,
    remoteManifest: { digest: policy.manifest.digest, bytes: policy.manifest.bytes, state: "RAW_MANIFEST_VERIFIED",
      mediaType: policy.manifest.mediaType, config: policy.manifest.config, layers: policy.manifest.layers,
      baseLayerCount: 10, newLayerCount: 2 },
    engine: { state: "ENGINE_VERIFIED", docker: "28.0.4|28.0.4", buildx: "buildx 0.37.1", serverVersion: "28.0.4",
      pullResponse: "SUCCESS", compressedDigestVerification: "MANAGED_MOBY_PULL", compressedSizeVerification: "RECORDED_ONLY" },
    image: { imageId: policy.candidate.imageId, diffIds: policy.candidate.diffIds, platform: "linux/amd64" },
    archive: { state: "ARCHIVE_VERIFIED", imageId: policy.candidate.imageId, diffIds: policy.candidate.diffIds,
      archiveSha256, archiveBytes: 2048, saveResponse: "SUCCESS" },
    publisher: { result: "PASSED", runId: policy.publisher.runId, recipeRevision: policy.publisher.recipeRevision,
      receiptSha256: policy.publisher.receiptSha256, receiptBytes: policy.publisher.receiptBytes },
    phases: ["managed_engine", "registry_login", "raw_tag_manifest", "anonymous_digest_denied", "raw_digest_manifest",
      "local_inventory_before", "local_collision_check", "exact_digest_pull", "simple_local_alias", "private_docker_save",
      "full_archive_validation", "private_archive_callback", "owned_docker_cleanup", "owned_temporary_cleanup"]
      .map((name) => ({ name, result: "PASSED", durationMs: 0 })) };
}
function snapshot(context) {
  return { file: path.join(context.root, "candidate", "remote", "candidate.tar"), policy: JSON.parse(JSON.stringify(policy)),
    subject: policy.subject, imageId: policy.candidate.imageId, diffIds: policy.candidate.diffIds,
    runId, recipeRevision: revision, signal: new globalThis.AbortController().signal,
    archiveProof: { imageId: policy.candidate.imageId, configDigest: policy.candidate.imageId,
      diffIds: policy.candidate.diffIds, archiveSha256, archiveBytes: 2048, tag: alias } };
}
function dependencies(executeAudit) {
  return { context: host, verifyMain: async () => true,
    readCommitted: (relative) => relative.endsWith("candidate-remote.json") ? policyBytes : publicationBytes,
    executeAudit };
}
function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); chmodSync(file, 0o600);
}
function failedReceipt(context) {
  return { kind: "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1", state: "INCOMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", publication: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED",
    admission: "NOT_AUTHORIZED", imageExecution: "NOT_ATTEMPTED", runId: context.runId,
    recipeRevision: context.recipeRevision, phase: "PREPARE", containerCleanup: [],
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null, failure: { code: "postgres_remote_audit_failed" } };
}

test("remote audit context accepts only the first protected-main workflow dispatch and non-root Linux", (t) => {
  const { env } = fixture(t);
  assert.equal(requirePostgresRemoteAuditContext(env, overrideHost).runId, runId);
  for (const change of [{ GITHUB_RUN_NUMBER: "2" }, { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_REF: "refs/heads/branch" },
    { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_JOB: "read" }, { RUNNER_ENVIRONMENT: "self-hosted" },
    { GITHUB_REPOSITORY: "attacker/fork" }, { GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF.replace("remote-audit", "remote-read-v2") }]) {
    assert.throws(() => requirePostgresRemoteAuditContext({ ...env, ...change }, overrideHost), /context_invalid/u);
  }
  assert.throws(() => requirePostgresRemoteAuditContext(env, { ...overrideHost, uid: 0 }), /context_invalid/u);
  assert.throws(() => requirePostgresRemoteAuditContext(env, { ...overrideHost, platform: "win32" }), /context_invalid/u);
});

test("main verification rejects dirty checkout, changed or unprotected main and ambiguous credentials", async (t) => {
  const { env, context } = fixture(t);
  const commandRunner = (_command, args) => ({ status: 0, stdout: Buffer.from(args[0] === "status" ? "" : revision) });
  const response = (sha = revision, protectedBranch = true) => new globalThis.Response(JSON.stringify({
    name: "main", protected: protectedBranch, commit: { sha } }), { status: 200 });
  assert.equal(await verifyPostgresRemoteAuditMain(context, env, { commandRunner, fetchImpl: async () => response() }), true);
  await assert.rejects(verifyPostgresRemoteAuditMain(context, env, { commandRunner, fetchImpl: async () => response("b".repeat(40)) }), /main_invalid/u);
  await assert.rejects(verifyPostgresRemoteAuditMain(context, env, { commandRunner, fetchImpl: async () => response(revision, false) }), /main_invalid/u);
  await assert.rejects(verifyPostgresRemoteAuditMain(context, { ...env, GH_TOKEN: "other" }, { commandRunner }), /environment_invalid/u);
  await assert.rejects(verifyPostgresRemoteAuditMain(context, env, { commandRunner: () => ({ status: 0, stdout: Buffer.from("dirty") }) }), /checkout_invalid/u);
  await assert.rejects(verifyPostgresRemoteAuditMain(context, env, { commandRunner, timeoutMs: 1,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout")))) }), /main_invalid/u);
});

test("snapshot projection accepts cloned policy and binds all twelve ordered layers, archive and run", (t) => {
  const { context } = fixture(t); const selected = snapshot(context);
  const projectionContext = { artifactName: "/candidate/saved.tar", archiveIdentity: { sha256: archiveSha256, size: 2048 }, databaseEvidence: {} };
  const projection = projectPostgresRemoteAuditSnapshot(selected, context, policy, projectionContext);
  assert.equal(projection.subject.configDigest, policy.candidate.imageId);
  assert.deepEqual(projection.subject.diffIds, policy.candidate.diffIds);
  for (const mutate of [
    (value) => { value.policy.candidate.diffIds[0] = `sha256:${"f".repeat(64)}`; },
    (value) => { value.diffIds = value.diffIds.slice(1); },
    (value) => { value.archiveProof.configDigest = `sha256:${"f".repeat(64)}`; },
    (value) => { value.archiveProof.archiveBytes++; }, (value) => { value.subject += "wrong"; },
    (value) => { value.runId = "999"; }, (value) => { value.file = path.join(context.output, "candidate.tar"); },
    (value) => { value.signal = globalThis.AbortSignal.abort(); },
  ]) {
    const changed = snapshot(context); mutate(changed);
    assert.throws(() => projectPostgresRemoteAuditSnapshot(changed, context, policy, projectionContext), /snapshot_invalid/u);
  }
});

test("provider receipt validates the exact registry subject and the archive inspected by the scanner", (t) => {
  const { context } = fixture(t); const proof = snapshot(context).archiveProof;
  assert.equal(validatePostgresRemoteAuditCandidateReceipt(remoteReceipt(), proof, context, policy), true);
  for (const mutate of [(value) => { value.archive.archiveSha256 = "e".repeat(64); },
    (value) => { value.archive.diffIds.reverse(); }, (value) => { value.runId = "2"; },
    (value) => { value.admission = "AUTHORIZED"; }, (value) => { value.supportStartedAt = "2026-09-30T00:00:00Z"; }]) {
    const value = globalThis.structuredClone(remoteReceipt()); mutate(value);
    assert.throws(() => validatePostgresRemoteAuditCandidateReceipt(value, proof, context, policy));
  }
});

test("execute wires the remote provider, comprehensive offline archive scan and required scanner controls", async (t) => {
  const { env } = fixture(t); let called = false;
  const deps = dependencies(async (context, selected) => {
    called = true; assert.equal(selected.auditKind, "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1");
    assert.equal(typeof selected.scannerControls, "function");
    const args = selected.inputArguments({ carrier: `aquasec/trivy@sha256:${"a".repeat(64)}`,
      scanner: "/tmp/scanner", cache: "/tmp/cache", archive: "/tmp/private/candidate.tar", uid: 1001, gid: 1001, format: "json" });
    assert.ok(args.includes("--network=none")); assert.ok(args.includes("--detection-priority")); assert.equal(args.at(-1), "comprehensive");
    const receipt = await selected.materialize({ parent: context.root, runId, recipeRevision: revision,
      signal: new globalThis.AbortController().signal, createdAt: "must not reach provider" }, async (value) => {
      assert.equal(selected.projectSnapshot(value, { artifactName: "/candidate/saved.tar", archiveIdentity: {
        sha256: archiveSha256, size: 2048 }, databaseEvidence: {} }).subject.imageId, policy.candidate.imageId);
    });
    assert.equal(selected.validateCandidateReceipt(receipt, snapshot(context).archiveProof, context), true);
    return { state: "COMPLETE" };
  });
  deps.remoteProvider = async (input, inspect) => {
    assert.deepEqual(Object.keys(input).sort(), ["parent", "policy", "recipeRevision", "runId", "signal"]);
    await inspect(snapshot({ root: input.parent })); return remoteReceipt();
  };
  assert.equal((await runPostgresRemoteAudit(["execute"], env, deps)).state, "COMPLETE"); assert.equal(called, true);
});

test("preflight rejects changed publication and keeps only a redacted failure receipt", { skip: process.platform !== "linux" }, async (t) => {
  const { env } = fixture(t); let auditCalled = false;
  const deps = dependencies(async () => { auditCalled = true; });
  deps.readCommitted = (relative) => relative.endsWith("candidate-remote.json") ? policyBytes : Buffer.from("{}");
  await assert.rejects(runPostgresRemoteAudit(["execute"], env, deps)); assert.equal(auditCalled, false);
  const context = requirePostgresRemoteAuditContext(env, host);
  assert.equal(validatePostgresRemoteAuditArtifact(context, deps), true);
  assert.equal((await runPostgresRemoteAudit(["cleanup"], env, deps)).state, "CLEANED");
  assert.ok(!TEST_ONLY_publicPostgresRemoteAuditFailure(new Error("github_pat_secret_value")).includes("github_pat"));
});

test("public evidence rejects private files, directories, links, hardlinks, invalid JSON and secret values", { skip: process.platform !== "linux" }, (t) => {
  const { env } = fixture(t); const context = requirePostgresRemoteAuditContext(env, host);
  mkdirSync(context.output, { mode: 0o700 });
  const file = path.join(context.output, "audit-receipt.json"); const receipt = failedReceipt(context);
  writeJson(file, receipt); assert.equal(validatePostgresRemoteAuditArtifact(context), true);
  for (const name of ["candidate.tar", "config.json", "docker-auth.json", "raw-layer.json", "trivy.db"]) {
    writeJson(path.join(context.output, name), {});
    assert.throws(() => validatePostgresRemoteAuditArtifact(context), /artifact_invalid/u); rmSync(path.join(context.output, name));
  }
  const directory = path.join(context.output, "candidate-vulnerabilities.json"); mkdirSync(directory);
  assert.throws(() => validatePostgresRemoteAuditArtifact(context), /artifact_invalid/u); rmSync(directory, { recursive: true });
  const outside = path.join(context.output, "..", "foreign.json"); writeJson(outside, {});
  symlinkSync(outside, directory); assert.throws(() => validatePostgresRemoteAuditArtifact(context), /artifact_invalid/u); rmSync(directory);
  linkSync(file, outside.replace("foreign", "linked")); assert.throws(() => validatePostgresRemoteAuditArtifact(context), /artifact_invalid/u);
  rmSync(outside.replace("foreign", "linked"));
  for (const value of [{ ...receipt, rawArchive: "base64" }, { ...receipt, failure: { code: "github_pat_secret" } },
    { ...receipt, scanner: { accessToken: "secret" } }, { ...receipt, admission: "AUTHORIZED" }]) {
    writeJson(file, value); assert.throws(() => validatePostgresRemoteAuditArtifact(context), /artifact_invalid/u);
  }
  writeFileSync(file, "not json"); assert.throws(() => validatePostgresRemoteAuditArtifact(context), /artifact_invalid/u);
  writeJson(file, receipt); chmodSync(file, 0o644); assert.throws(() => validatePostgresRemoteAuditArtifact(context), /artifact_invalid/u);
});

test("cleanup refuses a remaining owned private archive and never deletes it", async (t) => {
  const { env } = fixture(t); const context = requirePostgresRemoteAuditContext(env, host);
  mkdirSync(context.root, { mode: 0o700 }); writeFileSync(path.join(context.root, "candidate.tar"), "private", { mode: 0o600 });
  await assert.rejects(runPostgresRemoteAudit(["cleanup"], env, { context: host }), /cleanup_uncertain/u);
  assert.equal(readFileSync(path.join(context.root, "candidate.tar"), "utf8"), "private");
});

test("raw database evidence binds metadata byte identities, rejects stale vulnerability DB and records old Java DB", (t) => {
  const { env } = fixture(t); const context = requirePostgresRemoteAuditContext(env, host);
  mkdirSync(context.output, { mode: 0o700 });
  const now = new Date("2026-09-30T12:00:00Z");
  const values = { vulnerability: { Version: 2, UpdatedAt: "2026-09-30T01:00:00Z", DownloadedAt: "2026-09-30T11:00:00Z" },
    java: { Version: 1, UpdatedAt: "2025-01-01T00:00:00Z", DownloadedAt: "2026-09-30T11:00:00Z" } };
  const evidence = { observed: {}, files: [] }; const metadata = {};
  for (const [name, suffix] of [["vulnerability", "db/metadata.json"], ["java", "java-db/metadata.json"]]) {
    evidence.observed[name] = { value: values[name], identity: { sha256: name === "java" ? "b".repeat(64) : "a".repeat(64), size: 128 } };
    evidence.files.push({ path: path.join(context.root, "scanner-work/cache", suffix), ...evidence.observed[name].identity, cap: 1024 });
    metadata[name] = validateDatabaseMetadata(values[name], { now, database: name });
  }
  const file = path.join(context.output, "database-evidence.json"); writeJson(file, evidence);
  const input = { databaseEvidence: metadata, now, vulnerabilityReport: {}, cyclonedxReport: {}, subject: {}, archiveEvidence: {} };
  const evaluated = evaluatePostgresRemoteAuditPolicy(input, context, (value) => value);
  assert.deepEqual(evaluated.databaseEvidence.java, values.java); assert.equal(metadata.java.maxAgeMs, null);
  evidence.observed.vulnerability.identity.sha256 = "f".repeat(64); writeJson(file, evidence);
  assert.throws(() => evaluatePostgresRemoteAuditPolicy(input, context, (value) => value), /database_binding_invalid/u);
  evidence.observed.vulnerability.identity.sha256 = "a".repeat(64);
  evidence.observed.vulnerability.value.UpdatedAt = "2026-09-27T00:00:00Z"; writeJson(file, evidence);
  assert.throws(() => evaluatePostgresRemoteAuditPolicy(input, context, (value) => value), /metadata_invalid/u);
});

test("scanner controls require a fresh database check before exposing any control inputs", async () => {
  await assert.rejects(runPostgresRemoteScannerControls({}, { prepare: () => { throw new Error("should not prepare"); } }), /database_binding_invalid/u);
});

test("CLI cleanup blocks uncertain helper and exact-image disposal even when owned files are gone", { skip: process.platform !== "linux" }, async (t) => {
  const { env } = fixture(t); const context = requirePostgresRemoteAuditContext(env, host);
  mkdirSync(context.output, { mode: 0o700 });
  const file = path.join(context.output, "audit-receipt.json");
  for (const code of ["postgres_remote_candidate_image_cleanup_failed", "seaweed_audit_container_cleanup_uncertain",
    "postgres_scan_container_cleanup_uncertain", "postgres_remote_candidate_cleanup_ownership_unverified", "postgres_scan_container_identity_uncertain"]) {
    const receipt = failedReceipt(context); receipt.phase = "CANDIDATE_CLEANUP"; receipt.failure.code = code;
    writeJson(file, receipt);
    await assert.rejects(runPostgresRemoteAudit(["cleanup"], env, { context: host }), /artifact_invalid/u);
  }
  const receipt = failedReceipt(context); receipt.containerCleanup = [{ kind: "self-json", state: "CLEANUP_UNCERTAIN" }];
  writeJson(file, receipt); await assert.rejects(runPostgresRemoteAudit(["cleanup"], env, { context: host }), /artifact_invalid/u);
  receipt.containerCleanup = [{ kind: "self-json", state: "OWNED_CONTAINER_ABSENT" }];
  receipt.failure.code = "postgres_scan_command_failed"; writeJson(file, receipt);
  assert.equal((await runPostgresRemoteAudit(["cleanup"], env, { context: host })).state, "CLEANED");
});

test("a registry database update preserves bounded failure evidence without passing the audit", { skip: process.platform !== "linux" }, async (t) => {
  const { env } = fixture(t); const context = requirePostgresRemoteAuditContext(env, host);
  mkdirSync(context.output, { mode: 0o700 });
  const receipt = failedReceipt(context); receipt.phase = "DATABASE_DOWNLOAD";
  receipt.failure.code = "seaweed_audit_database_registry_changed";
  for (const name of ["vulnerability", "java"]) {
    for (const checkpoint of ["before", "after"]) {
      writeJson(path.join(context.output, `database-${name}-${checkpoint}-manifest.json`),
        { schemaVersion: 2, layers: [{ digest: `sha256:${(checkpoint === "before" ? "a" : "b").repeat(64)}`,
          size: 4096, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip" }] });
    }
  }
  const file = path.join(context.output, "audit-receipt.json"); writeJson(file, receipt);
  assert.equal((await runPostgresRemoteAudit(["cleanup"], env, { context: host })).state, "CLEANED");
  assert.equal(JSON.parse(readFileSync(file)).state, "INCOMPLETE");
  receipt.failure.code = "postgres_scan_command_failed"; writeJson(file, receipt);
  await assert.rejects(runPostgresRemoteAudit(["cleanup"], env, { context: host }), /artifact_invalid/u);
});

test("complete public artifact binds candidate, database manifests, metadata and every control report", { skip: process.platform !== "linux" }, (t) => {
  const { env } = fixture(t); const context = requirePostgresRemoteAuditContext(env, host);
  mkdirSync(context.output, { mode: 0o700 });
  const now = new Date("2026-09-30T12:00:00Z"); const expectedEvaluation = {
    state: "COMPLETE", findings: [], blockers: [], inventory: { resultCount: 2, packageCount: 20, sbomComponentCount: 20 } };
  const receipt = { ...failedReceipt(context), state: "COMPLETE", phase: "COMPLETE", candidate: remoteReceipt(),
    registrySubject: policy.subject, scannerInput: "LOCAL_DOCKER_SAVE_ARCHIVE", findingCount: 0, blockerCount: 0,
    blockers: [], blockersTruncated: false, inventory: expectedEvaluation.inventory,
    subject: { artifactName: "/candidate/saved.tar", imageId: policy.candidate.imageId, configDigest: policy.candidate.imageId,
      archiveSha256, archiveBytes: 2048, tag: alias, diffIds: policy.candidate.diffIds }, reports: {},
    scannerControls: { state: "COMPLETE", reports: {} }, databases: { files: [], metadata: {}, registry: [] } };
  delete receipt.failure;
  const databaseEvidence = { checkedAt: now.toISOString(), maxAgeMsByDatabase: { vulnerability: 48 * 60 * 60 * 1000, java: null },
    files: receipt.databases.files, observed: {}, validation: [] };
  for (const [index, suffix] of ["db/trivy.db", "db/metadata.json", "java-db/trivy-java.db", "java-db/metadata.json"].entries()) {
    receipt.databases.files.push({ path: path.join(context.root, "scanner-work/cache", suffix), sha256: String(index).repeat(64), size: 128, cap: 1024 });
  }
  for (const [name, index] of [["vulnerability", 1], ["java", 3]]) {
    const value = { Version: name === "java" ? 1 : 2, UpdatedAt: "2026-09-30T01:00:00Z", DownloadedAt: "2026-09-30T11:00:00Z" };
    databaseEvidence.observed[name] = { value, identity: { sha256: receipt.databases.files[index].sha256, size: 128 } };
    receipt.databases.metadata[name] = validateDatabaseMetadata(value, { now, database: name });
    const manifest = { schemaVersion: 2, layers: [{ digest: `sha256:${String(index).repeat(64)}`, size: 4096, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip" }] };
    for (const checkpoint of ["before", "after"]) writeJson(path.join(context.output, `database-${name}-${checkpoint}-manifest.json`), manifest);
    const bytes = readFileSync(path.join(context.output, `database-${name}-before-manifest.json`));
    receipt.databases.registry.push({ name, repository: `ghcr.io/aquasecurity/trivy-${name === "java" ? "java-db" : "db"}`,
      tag: name === "java" ? "1" : "2", digest: `sha256:${hash(bytes)}`, size: bytes.length, layerBytes: 4096 });
  }
  writeJson(path.join(context.output, "database-evidence.json"), databaseEvidence);
  const reportFiles = ["candidate-vulnerabilities.json", "candidate-sbom.cdx.json", "scanner-self.json", "scanner-self.cdx.json",
    "scanner-version-probe.json", "fixture-gomod-vulnerable-candidate.json", "fixture-gomod-vulnerable-baseline.json",
    "fixture-java-war-vulnerable-candidate.json", "fixture-java-war-vulnerable-baseline.json", "fixture-java-jar-clean-candidate-candidate.json"];
  for (const file of reportFiles) {
    writeJson(path.join(context.output, file), file.endsWith(".cdx.json") ? { bomFormat: "CycloneDX", components: [] } : { SchemaVersion: 2, Results: [] });
    const bytes = readFileSync(path.join(context.output, file)); const identity = { sha256: hash(bytes), size: bytes.length };
    if (file === "candidate-vulnerabilities.json") receipt.reports.vulnerability = identity;
    else if (file === "candidate-sbom.cdx.json") receipt.reports.cyclonedx = identity;
    else receipt.scannerControls.reports[file] = identity;
  }
  const receiptFile = path.join(context.output, "audit-receipt.json"); writeJson(receiptFile, receipt);
  const deps = { ...dependencies(), now: () => now, evaluatePolicy: () => expectedEvaluation };
  assert.equal(validatePostgresRemoteAuditArtifact(context, deps), true);
  for (const file of ["candidate-vulnerabilities.json", "scanner-self.json", "fixture-gomod-vulnerable-baseline.json",
    "database-java-after-manifest.json", "database-evidence.json"]) {
    const target = path.join(context.output, file); const original = readFileSync(target);
    const value = JSON.parse(original); value.changed = true; writeJson(target, value);
    assert.throws(() => validatePostgresRemoteAuditArtifact(context, deps), /artifact_invalid/u);
    writeFileSync(target, original);
  }
  receipt.databases.files[1].sha256 = "f".repeat(64); writeJson(receiptFile, receipt);
  assert.throws(() => validatePostgresRemoteAuditArtifact(context, deps), /artifact_invalid/u);
});
