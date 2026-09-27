import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, readdirSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { validatePublishedCandidateBinding, verifyRemoteAuditMain }
  from "./candidate-remote-audit.mjs";
import { validateRemoteAuditEvidence, verifyRemoteAuditApi }
  from "./candidate-remote-runtime-diagnostic.mjs";
import { validateRemoteSeaweedAuditBinding, validateRemoteSeaweedRuntimeCandidateReceipt }
  from "./candidate-remote-runtime.mjs";
import { validateLocalSeaweedRetentionReceipt }
  from "./candidate-local-retention.mjs";
import { validateLocalSeaweedRestoreReceipt }
  from "./candidate-local-restore.mjs";

export const ATTESTATION = Object.freeze({
  subjectName: "ghcr.io/clemey15/auto-world-seaweedfs-s3",
  subjectDigest: "sha256:9739d848712cf40f158a9d44586b6166a0d51839eaeceebbadcad27980b1f504",
  predicateType: "https://github.com/CleMeY15/auto-world/attestations/private-image-evidence/v1",
  workflowPath: ".github/workflows/seaweed-candidate-attest.yml",
  repository: "CleMeY15/auto-world",
});

export const SIGNER_JOB_BUDGET_MS = 20 * 60 * 1000;

const WORKFLOW_REF = `${ATTESTATION.repository}/${ATTESTATION.workflowPath}@refs/heads/main`;
const SUBJECT = `${ATTESTATION.subjectName}@${ATTESTATION.subjectDigest}`;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_COMMITTED_BYTES = 4 * 1024 * 1024;
const AUDIT_FILES = Object.freeze({
  "audit-receipt.json": 4 * 1024 * 1024,
  "candidate-vulnerabilities.json": 64 * 1024 * 1024,
  "candidate-sbom.cdx.json": 64 * 1024 * 1024,
  "database-evidence.json": 4 * 1024 * 1024,
  "database-vulnerability-before-manifest.json": 1024 * 1024,
  "database-vulnerability-after-manifest.json": 1024 * 1024,
  "database-java-before-manifest.json": 1024 * 1024,
  "database-java-after-manifest.json": 1024 * 1024,
});
const COMMITTED_FILES = Object.freeze({
  policy: "infra/seaweed-image/candidate-remote.json",
  runtimePolicy: "infra/seaweed-image/candidate-remote-runtime.json",
  publication: "infra/seaweed-image/candidate-publication-receipt.json",
  audit: "infra/seaweed-image/candidate-remote-audit-receipt.json",
  runtime: "infra/seaweed-image/candidate-remote-runtime-receipt.json",
  retention: "infra/seaweed-image/candidate-local-retention-receipt.json",
  restore: "infra/seaweed-image/candidate-local-restore-receipt.json",
});

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function identity(bytes) { return Object.freeze({ sha256: sha256(bytes), bytes: bytes.length }); }
function parse(bytes) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { fail("seaweed_candidate_attestation_evidence_invalid"); }
}
function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, cloneFrozen(item)])));
  return value;
}
function receiptIdentity(value) {
  return exactKeys(value, ["sha256", "bytes"]) && SHA256.test(value.sha256)
    && Number.isSafeInteger(value.bytes) && value.bytes > 1 && value.bytes <= MAX_COMMITTED_BYTES;
}
function isoInstant(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function requireContext(input, env, context = {}) {
  const platform = context.platform ?? process.platform;
  const uid = context.uid ?? process.getuid?.();
  const gid = context.gid ?? process.getgid?.();
  if (!exactKeys(input, ["workspace", "auditDirectory", "now"])
    || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())
    || platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1
    || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_JOB !== "signer"
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== ATTESTATION.repository
    || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF || env.GITHUB_RUN_NUMBER !== "1"
    || env.GITHUB_RUN_ATTEMPT !== "1" || !RUN_ID.test(env.GITHUB_RUN_ID ?? "")
    || !REVISION.test(env.GITHUB_SHA ?? "") || env.GITHUB_WORKSPACE !== input.workspace
    || !path.isAbsolute(input.workspace) || path.normalize(input.workspace) !== input.workspace
    || !path.isAbsolute(input.auditDirectory) || path.normalize(input.auditDirectory) !== input.auditDirectory
    || typeof env.RUNNER_TEMP !== "string" || !path.isAbsolute(env.RUNNER_TEMP)
    || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP
    || input.auditDirectory !== path.join(env.RUNNER_TEMP, "seaweed-candidate-remote-audit-input")) {
    fail("seaweed_candidate_attestation_context_invalid");
  }
  try {
    if (realpathSync(input.workspace) !== input.workspace
      || realpathSync(input.auditDirectory) !== input.auditDirectory
      || realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP) fail("seaweed_candidate_attestation_context_invalid");
  } catch { fail("seaweed_candidate_attestation_context_invalid"); }
  return Object.freeze({ workspace: input.workspace, auditDirectory: input.auditDirectory,
    output: path.join(env.RUNNER_TEMP, "seaweed-candidate-attestation"), runId: env.GITHUB_RUN_ID,
    recipeRevision: env.GITHUB_SHA, uid, gid });
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: null, env: options.env,
    maxBuffer: options.maxBuffer, timeout: options.timeoutMs, windowsHide: true });
}

function requireCleanCheckout(context, commandRunner) {
  for (const [args, expected] of [[ ["rev-parse", "HEAD"], context.recipeRevision ],
    [["status", "--porcelain=v1", "--untracked-files=all"], ""]]) {
    const result = commandRunner("git", args, { cwd: context.workspace,
      env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      maxBuffer: 1024 * 1024, timeoutMs: 60_000 });
    if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout)
      || result.stdout.toString("utf8").trim() !== expected) {
      fail("seaweed_candidate_attestation_checkout_invalid");
    }
  }
}

function readRegular(file, cap, uid, code) {
  let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(handle); const pathname = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || pathname.isSymbolicLink()
      || before.uid !== uid || (before.mode & 0o022) !== 0 || before.size < 2 || before.size > cap
      || before.dev !== pathname.dev || before.ino !== pathname.ino) fail(code);
    const bytes = readFileSync(handle); const after = fstatSync(handle);
    if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail(code);
    return bytes;
  } catch (error) {
    if (error?.message === code) throw error;
    fail(code);
  } finally { if (handle !== undefined) closeSync(handle); }
}

function committedBytes(relative, context, commandRunner) {
  const file = path.join(context.workspace, ...relative.split("/"));
  const working = readRegular(file, MAX_COMMITTED_BYTES, context.uid,
    "seaweed_candidate_attestation_evidence_invalid");
  const result = commandRunner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: MAX_COMMITTED_BYTES + 1, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout)
    || !result.stdout.equals(working)) fail("seaweed_candidate_attestation_evidence_invalid");
  return working;
}

function auditBytes(context) {
  let names;
  try {
    const info = lstatSync(context.auditDirectory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== context.uid
      || (info.mode & 0o022) !== 0) fail("seaweed_candidate_attestation_evidence_invalid");
    names = readdirSync(context.auditDirectory).sort();
  } catch { fail("seaweed_candidate_attestation_evidence_invalid"); }
  if (!isDeepStrictEqual(names, Object.keys(AUDIT_FILES).sort())) {
    fail("seaweed_candidate_attestation_evidence_invalid");
  }
  return Object.freeze(Object.fromEntries(names.map((name) => [name, readRegular(
    path.join(context.auditDirectory, name), AUDIT_FILES[name], context.uid,
    "seaweed_candidate_attestation_evidence_invalid")])));
}

function predicateShape(value) {
  const evidenceFiles = value?.audit?.files;
  const evidenceNames = Object.keys(AUDIT_FILES).sort();
  return exactKeys(value, ["kind", "state", "authority", "subject", "source", "publisher", "audit",
    "runtime", "localArchive", "support", "admission"])
    && value.kind === "SEAWEED_CANDIDATE_ATTESTATION_PREDICATE_V1"
    && value.state === "EVIDENCE_VERIFIED" && value.authority === "REVIEWED_MAIN_SIGNER"
    && value.admission === "NOT_AUTHORIZED"
    && exactKeys(value.subject, ["name", "digest", "platform", "imageId", "diffId"])
    && exactKeys(value.source, ["runId", "codeRevision", "binaryDigest", "baseManifestDigest"])
    && exactKeys(value.publisher, ["state", "result", "runId", "recipeRevision", "receipt"])
    && receiptIdentity(value.publisher.receipt)
    && exactKeys(value.audit, ["state", "runId", "recipeRevision", "artifact", "files", "scanner",
      "databases", "findings"])
    && exactKeys(value.audit.artifact, ["id", "name", "bytes", "digest"])
    && plain(evidenceFiles) && isDeepStrictEqual(Object.keys(evidenceFiles).sort(), evidenceNames)
    && Object.values(evidenceFiles).every((item) => exactKeys(item, ["sha256", "bytes"])
      && SHA256.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 1)
    && exactKeys(value.audit.scanner, ["version", "sourceCommit", "binarySha256", "lockSha256"])
    && exactKeys(value.audit.databases, ["vulnerability", "java"])
    && exactKeys(value.audit.databases.vulnerability, ["updatedAt", "maxAge", "freshAtPreparation"])
    && exactKeys(value.audit.databases.java, ["updatedAt", "maxAge"])
    && exactKeys(value.audit.findings, ["count", "blockerCount"])
    && exactKeys(value.runtime, ["state", "runId", "recipeRevision", "receipt", "profiles"])
    && receiptIdentity(value.runtime.receipt)
    && exactKeys(value.localArchive, ["state", "archive", "retention", "restore"])
    && exactKeys(value.localArchive.archive, ["sha256", "bytes", "configSha256", "diffId"])
    && exactKeys(value.localArchive.retention, ["runId", "recipeRevision", "receipt"])
    && receiptIdentity(value.localArchive.retention.receipt)
    && exactKeys(value.localArchive.restore, ["runId", "recipeRevision", "receipt", "registryAccess"])
    && receiptIdentity(value.localArchive.restore.receipt)
    && exactKeys(value.support, ["durationFromActivation", "archiveRetentionAfterSupport",
      "supportStartsAt", "supportEndsAt", "archiveRetainUntil", "dates", "automaticDeletion",
      "continuousSecurityControls"])
    && value.subject.name === ATTESTATION.subjectName && value.subject.digest === ATTESTATION.subjectDigest
    && value.subject.platform === "linux/amd64" && /^sha256:[0-9a-f]{64}$/u.test(value.subject.imageId)
    && /^sha256:[0-9a-f]{64}$/u.test(value.subject.diffId)
    && RUN_ID.test(value.source.runId) && REVISION.test(value.source.codeRevision)
    && /^sha256:[0-9a-f]{64}$/u.test(value.source.binaryDigest)
    && /^sha256:[0-9a-f]{64}$/u.test(value.source.baseManifestDigest)
    && value.publisher.state === "PUBLISHED_UNADMITTED" && value.publisher.result === "FAILED"
    && RUN_ID.test(value.publisher.runId) && REVISION.test(value.publisher.recipeRevision)
    && value.audit.state === "COMPLETE" && RUN_ID.test(value.audit.runId)
    && REVISION.test(value.audit.recipeRevision)
    && Number.isSafeInteger(value.audit.artifact.id) && value.audit.artifact.id > 0
    && value.audit.artifact.name === "seaweed-candidate-remote-audit"
    && Number.isSafeInteger(value.audit.artifact.bytes) && value.audit.artifact.bytes > 1
    && /^sha256:[0-9a-f]{64}$/u.test(value.audit.artifact.digest)
    && /^[0-9]+\.[0-9]+\.[0-9]+-autoworld\.[0-9]+$/u.test(value.audit.scanner.version)
    && REVISION.test(value.audit.scanner.sourceCommit) && SHA256.test(value.audit.scanner.binarySha256)
    && SHA256.test(value.audit.scanner.lockSha256)
    && isoInstant(value.audit.databases.vulnerability.updatedAt)
    && isoInstant(value.audit.databases.java.updatedAt)
    && Number.isSafeInteger(value.audit.findings.count) && value.audit.findings.count >= 0
    && value.audit.findings.blockerCount === 0
    && value.audit.databases.vulnerability.maxAge === "PT48H"
    && value.audit.databases.vulnerability.freshAtPreparation === true
    && value.audit.databases.java.maxAge === null
    && value.runtime.state === "VERIFIED" && RUN_ID.test(value.runtime.runId)
    && REVISION.test(value.runtime.recipeRevision)
    && isDeepStrictEqual(value.runtime.profiles, ["basic", "persistence", "strict", "backup", "hostLoopback"])
    && value.localArchive.state === "RESTORE_VERIFIED"
    && SHA256.test(value.localArchive.archive.sha256)
    && Number.isSafeInteger(value.localArchive.archive.bytes) && value.localArchive.archive.bytes > 1
    && SHA256.test(value.localArchive.archive.configSha256)
    && /^sha256:[0-9a-f]{64}$/u.test(value.localArchive.archive.diffId)
    && RUN_ID.test(value.localArchive.retention.runId)
    && REVISION.test(value.localArchive.retention.recipeRevision)
    && RUN_ID.test(value.localArchive.restore.runId)
    && REVISION.test(value.localArchive.restore.recipeRevision)
    && value.localArchive.restore.registryAccess === "NOT_ATTEMPTED"
    && value.support.durationFromActivation === "P1Y"
    && value.support.archiveRetentionAfterSupport === "P365D"
    && value.support.supportStartsAt === null && value.support.supportEndsAt === null
    && value.support.archiveRetainUntil === null && value.support.dates === "PENDING_ADMISSION_ACTIVATION"
    && value.support.automaticDeletion === "DISABLED"
    && value.support.continuousSecurityControls === "REQUIRED_DURING_SUPPORT";
}

export function validateCandidateAttestationPredicate(value, expected) {
  if (!predicateShape(value) || !predicateShape(expected) || !isDeepStrictEqual(value, expected)) {
    fail("seaweed_candidate_attestation_predicate_invalid");
  }
  return cloneFrozen(value);
}

function makePredicate(policy, publication, evidence, runtime, retention, restore, committed, audit) {
  const auditReceipt = evidence.receipt;
  const files = Object.freeze(Object.fromEntries(Object.entries(audit)
    .map(([name, bytes]) => [name, identity(bytes)])));
  return cloneFrozen({
    kind: "SEAWEED_CANDIDATE_ATTESTATION_PREDICATE_V1", state: "EVIDENCE_VERIFIED",
    authority: "REVIEWED_MAIN_SIGNER",
    subject: { name: ATTESTATION.subjectName, digest: ATTESTATION.subjectDigest,
      platform: policy.platform, imageId: policy.candidate.imageId, diffId: policy.candidate.diffId },
    source: { runId: policy.source.runId, codeRevision: policy.source.codeRevision,
      binaryDigest: policy.source.binaryDigest, baseManifestDigest: policy.source.baseManifestDigest },
    publisher: { state: publication.state, result: publication.result, runId: publication.runId,
      recipeRevision: publication.sourceSha, receipt: identity(committed.publication) },
    audit: { state: auditReceipt.state, runId: auditReceipt.runId,
      recipeRevision: auditReceipt.recipeRevision, artifact: evidence.runtimePolicy.audit.artifact,
      files, scanner: { version: auditReceipt.scanner.version,
        sourceCommit: auditReceipt.scanner.sourceCommit,
        binarySha256: auditReceipt.scanner.binary.sha256, lockSha256: auditReceipt.scanner.lockSha256 },
      databases: { vulnerability: { updatedAt: auditReceipt.databases.metadata.vulnerability.updatedAt,
        maxAge: "PT48H", freshAtPreparation: true },
      java: { updatedAt: auditReceipt.databases.metadata.java.updatedAt, maxAge: null } },
      findings: { count: auditReceipt.findingCount, blockerCount: auditReceipt.blockerCount } },
    runtime: { state: runtime.state, runId: runtime.runId, recipeRevision: runtime.recipeRevision,
      receipt: identity(committed.runtime), profiles: ["basic", "persistence", "strict", "backup", "hostLoopback"] },
    localArchive: { state: "RESTORE_VERIFIED",
      archive: { sha256: retention.archiveProof.archiveSha256, bytes: retention.archiveProof.archiveBytes,
        configSha256: retention.archiveProof.configSha256, diffId: retention.archiveProof.diffId },
      retention: { runId: retention.runId, recipeRevision: retention.recipeRevision,
        receipt: identity(committed.retention) },
      restore: { runId: restore.runId, recipeRevision: restore.recipeRevision,
        receipt: identity(committed.restore), registryAccess: restore.registryAccess } },
    support: { durationFromActivation: "P1Y", archiveRetentionAfterSupport: "P365D",
      supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null,
      dates: "PENDING_ADMISSION_ACTIVATION", automaticDeletion: "DISABLED",
      continuousSecurityControls: "REQUIRED_DURING_SUPPORT" },
    admission: "NOT_AUTHORIZED",
  });
}

function writeExclusive(file, bytes) {
  let handle;
  try {
    handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | constants.O_NOFOLLOW, 0o600);
    fchmodSync(handle, 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(handle, bytes, offset, bytes.length - offset);
      if (!Number.isSafeInteger(written) || written < 1) fail("seaweed_candidate_attestation_output_invalid");
      offset += written;
    }
    fsyncSync(handle);
  } catch { fail("seaweed_candidate_attestation_output_invalid"); }
  finally { if (handle !== undefined) closeSync(handle); }
}

function defaultWriteOutputs(context, predicate) {
  try { mkdirSync(context.output, { mode: 0o700 }); }
  catch { fail("seaweed_candidate_attestation_output_invalid"); }
  const predicateBytes = Buffer.from(`${JSON.stringify(predicate, null, 2)}\n`, "utf8");
  const predicatePath = path.join(context.output, "predicate.json");
  const receiptPath = path.join(context.output, "pre-sign-receipt.json");
  const receipt = cloneFrozen({ kind: "SEAWEED_CANDIDATE_PRE_SIGN_RECEIPT_V1",
    state: "EVIDENCE_VERIFIED", authority: "REVIEWED_MAIN_SIGNER",
    candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
    signing: "PENDING_OFFICIAL_ACTION", repository: ATTESTATION.repository,
    workflowPath: ATTESTATION.workflowPath, sourceRef: "refs/heads/main", runId: context.runId,
    runNumber: "1", runAttempt: "1", recipeRevision: context.recipeRevision,
    subject: { name: ATTESTATION.subjectName, digest: ATTESTATION.subjectDigest },
    predicate: { type: ATTESTATION.predicateType, sha256: sha256(predicateBytes),
      bytes: predicateBytes.length, file: "predicate.json" } });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  writeExclusive(predicatePath, predicateBytes); writeExclusive(receiptPath, receiptBytes);
  return { predicatePath, receiptPath, receipt };
}

export async function prepareCandidateAttestation(input, env = process.env, dependencies = {}) {
  const context = requireContext(input, env, dependencies.context);
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  (dependencies.requireCleanCheckout ?? requireCleanCheckout)(context, commandRunner);
  await (dependencies.verifyMain ?? verifyRemoteAuditMain)(context, env, { commandRunner,
    fetchImpl: dependencies.fetchImpl ?? globalThis.fetch });
  const readCommitted = dependencies.readCommitted ?? committedBytes;
  const committed = Object.freeze(Object.fromEntries(Object.entries(COMMITTED_FILES)
    .map(([key, relative]) => [key, readCommitted(relative, context, commandRunner)])));
  const values = Object.freeze(Object.fromEntries(Object.entries(committed)
    .map(([key, bytes]) => [key, parse(bytes)])));
  const { policy, receipt: publication } = (dependencies.validatePublication
    ?? validatePublishedCandidateBinding)(values.policy, committed.publication);
  if (policy.subject !== SUBJECT || policy.image !== ATTESTATION.subjectName
    || policy.manifest.digest !== ATTESTATION.subjectDigest || publication.result !== "FAILED") {
    fail("seaweed_candidate_attestation_evidence_invalid");
  }
  await (dependencies.verifyAuditApi ?? verifyRemoteAuditApi)(values.runtimePolicy, context, env,
    { fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
      now: () => input.now.getTime() });
  const audit = (dependencies.readAudit ?? auditBytes)(context);
  if (!isDeepStrictEqual(committed.audit, audit["audit-receipt.json"])) {
    fail("seaweed_candidate_attestation_evidence_invalid");
  }
  const evidence = (dependencies.validateAuditEvidence ?? validateRemoteAuditEvidence)({
    runtimePolicy: values.runtimePolicy, candidatePolicy: policy,
    receiptBytes: audit["audit-receipt.json"],
    vulnerabilityBytes: audit["candidate-vulnerabilities.json"],
    cyclonedxBytes: audit["candidate-sbom.cdx.json"],
    databaseEvidenceBytes: audit["database-evidence.json"],
    databaseManifestBytes: {
      "vulnerability-before": audit["database-vulnerability-before-manifest.json"],
      "vulnerability-after": audit["database-vulnerability-after-manifest.json"],
      "java-before": audit["database-java-before-manifest.json"],
      "java-after": audit["database-java-after-manifest.json"],
    }, now: input.now,
  });
  if (input.now.getTime() + SIGNER_JOB_BUDGET_MS
    > Date.parse(evidence.receipt.databases.metadata.vulnerability.updatedAt) + 48 * 60 * 60 * 1000) {
    fail("seaweed_candidate_attestation_signing_window_expired");
  }
  const auditPolicy = evidence.runtimePolicy.audit;
  const auditBinding = validateRemoteSeaweedAuditBinding({ kind: "SEAWEED_REMOTE_AUDIT_BINDING_V1",
    state: "COMPLETE", subject: policy.subject, runId: auditPolicy.runId,
    runNumber: auditPolicy.runNumber, runAttempt: auditPolicy.runAttempt,
    recipeRevision: auditPolicy.recipeRevision, artifact: auditPolicy.artifact,
    files: auditPolicy.files }, policy);
  const runtime = (dependencies.validateRuntime ?? validateRemoteSeaweedRuntimeCandidateReceipt)(
    values.runtime, policy, auditBinding);
  const retention = (dependencies.validateRetention ?? validateLocalSeaweedRetentionReceipt)(
    values.retention, policy);
  const restore = (dependencies.validateRestore ?? validateLocalSeaweedRestoreReceipt)(values.restore, {
    imageId: policy.candidate.imageId, archiveSha256: retention.archiveProof.archiveSha256,
    archiveBytes: retention.archiveProof.archiveBytes, runId: values.restore.runId,
    recipeRevision: values.restore.recipeRevision, subject: policy.subject, auditBinding,
    priorRuntimeRunId: runtime.runId, priorRuntimeRecipeRevision: runtime.recipeRevision,
  });
  const predicate = makePredicate(policy, publication, evidence, runtime, retention, restore,
    committed, audit);
  validateCandidateAttestationPredicate(predicate, predicate);
  const output = (dependencies.writeOutputs ?? defaultWriteOutputs)(context, predicate);
  return Object.freeze({ subject: Object.freeze({ name: ATTESTATION.subjectName,
    digest: ATTESTATION.subjectDigest }), predicateType: ATTESTATION.predicateType,
    predicatePath: output.predicatePath, receiptPath: output.receiptPath, predicate });
}

function publicFailure(error) {
  return ["seaweed_candidate_attestation_arguments_invalid", "seaweed_candidate_attestation_checkout_invalid",
    "seaweed_candidate_attestation_context_invalid", "seaweed_candidate_attestation_evidence_invalid",
    "seaweed_candidate_attestation_output_invalid", "seaweed_candidate_attestation_predicate_invalid",
    "seaweed_candidate_attestation_signing_window_expired"]
    .includes(error?.message)
    ? error.message : "seaweed_candidate_attestation_failed";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const argv = process.argv.slice(2);
  if (argv.length !== 1 || argv[0] !== "prepare") {
    console.error(JSON.stringify({ state: "FAILED", code: "seaweed_candidate_attestation_arguments_invalid",
      admission: "NOT_AUTHORIZED" })); process.exitCode = 1;
  } else {
    prepareCandidateAttestation({ workspace: env.GITHUB_WORKSPACE,
      auditDirectory: path.join(env.RUNNER_TEMP ?? "", "seaweed-candidate-remote-audit-input"),
      now: new Date() }, env).then((result) => console.log(JSON.stringify({ state: "EVIDENCE_VERIFIED",
        subject: result.subject, predicateType: result.predicateType,
        predicateFile: path.basename(result.predicatePath), receiptFile: path.basename(result.receiptPath),
        admission: "NOT_AUTHORIZED" })))
      .catch((error) => { console.error(JSON.stringify({ state: "FAILED", code: publicFailure(error),
        admission: "NOT_AUTHORIZED" })); process.exitCode = 1; });
  }
}
