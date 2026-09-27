import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, readdirSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { evaluateLocalSeaweedCandidateAudit } from "./candidate-audit-policy.mjs";
import { validatePublishedCandidateBinding, validateRemoteAuditFilesystem,
  validateRemoteAuditRuntimeConfig, verifyRemoteAuditMain } from "./candidate-remote-audit.mjs";
import { validateRemoteSeaweedCandidatePolicy,
  validateRemoteSeaweedCandidateReceipt } from "./candidate-remote.mjs";
import { validateRemoteSeaweedAuditBinding, validateRemoteSeaweedRuntimeCandidateReceipt,
  withVerifiedRemoteSeaweedRuntimeCandidate } from "./candidate-remote-runtime.mjs";
import { isPublicSeaweedRuntimePhase, isPublicSeaweedRuntimeReason } from "./candidate-runtime.mjs";
import { isPublicSeaweedHostLoopbackPhase,
  isPublicSeaweedHostLoopbackReason } from "./host-loopback.mjs";
import { MAX_DATABASE_AGE_MS, validateDatabaseMetadata } from "../scanner/audit-policy.mjs";
import { validateDatabaseRegistryManifest } from "../scanner/audit.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/seaweed-candidate-remote-runtime.yml@refs/heads/main";
const AUDIT_WORKFLOW = ".github/workflows/seaweed-candidate-remote-audit.yml";
const AUDIT_ARTIFACT = "seaweed-candidate-remote-audit";
const RECEIPT_FILE = "runtime-receipt.json";
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const HEX = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_PUBLICATION_BYTES = 1024 * 1024;
const MAX_AUDIT_RECEIPT_BYTES = 4 * 1024 * 1024;
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const MAX_API_BYTES = 512 * 1024;
const API_TIMEOUT_MS = 60_000;
const AUDIT_FILES = Object.freeze({
  "audit-receipt.json": MAX_AUDIT_RECEIPT_BYTES,
  "candidate-vulnerabilities.json": MAX_REPORT_BYTES,
  "candidate-sbom.cdx.json": MAX_REPORT_BYTES,
  "database-evidence.json": 4 * 1024 * 1024,
  "database-vulnerability-before-manifest.json": 1024 * 1024,
  "database-vulnerability-after-manifest.json": 1024 * 1024,
  "database-java-before-manifest.json": 1024 * 1024,
  "database-java-after-manifest.json": 1024 * 1024,
});
const PUBLIC_FAILURE_CODES = new Set([
  "seaweed_remote_runtime_arguments_invalid", "seaweed_remote_runtime_context_invalid",
  "seaweed_remote_runtime_environment_invalid", "seaweed_remote_runtime_output_exists",
  "seaweed_remote_runtime_policy_invalid", "seaweed_remote_runtime_input_invalid",
  "seaweed_remote_runtime_input_uncommitted", "seaweed_remote_runtime_evidence_invalid",
  "seaweed_remote_runtime_audit_invalid", "seaweed_remote_runtime_api_invalid",
  "seaweed_remote_runtime_cleanup_uncertain", "seaweed_remote_runtime_receipt_invalid",
  "seaweed_remote_runtime_candidate_failed",
]);
const RUNTIME_FAILURE_CODES = new Set([
  "seaweed_candidate_runtime_failed", "seaweed_candidate_runtime_cleanup_failed",
  "seaweed_candidate_runtime_persistence_failed", "seaweed_candidate_runtime_persistence_cleanup_failed",
  "seaweed_candidate_runtime_backup_restore_failed", "seaweed_candidate_runtime_backup_restore_cleanup_failed",
  "seaweed_candidate_runtime_host_loopback_failed", "seaweed_candidate_runtime_host_loopback_cleanup_failed",
]);

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parseJson(bytes, code = "seaweed_remote_runtime_input_invalid") {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(code); }
}

export function requireRemoteRuntimeContext(env, { platform = process.platform,
  uid = process.getuid?.(), gid = process.getgid?.() } = {}) {
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_JOB !== "runtime"
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world"
    || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF || env.GITHUB_RUN_NUMBER !== "2"
    || env.GITHUB_RUN_ATTEMPT !== "1" || !REVISION.test(env.GITHUB_SHA ?? "")
    || !RUN_ID.test(env.GITHUB_RUN_ID ?? "") || typeof env.RUNNER_TEMP !== "string"
    || !path.isAbsolute(env.RUNNER_TEMP) || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP
    || typeof env.GITHUB_WORKSPACE !== "string" || !path.isAbsolute(env.GITHUB_WORKSPACE)
    || path.normalize(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) fail("seaweed_remote_runtime_context_invalid");
  try {
    if (realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP
      || realpathSync(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) fail("seaweed_remote_runtime_context_invalid");
  } catch { fail("seaweed_remote_runtime_context_invalid"); }
  return Object.freeze({ root: path.join(env.RUNNER_TEMP, "seaweed-candidate-remote-runtime-work"),
    output: path.join(env.RUNNER_TEMP, "seaweed-candidate-remote-runtime-evidence"),
    auditInput: path.join(env.RUNNER_TEMP, "seaweed-candidate-remote-audit-input"),
    workspace: env.GITHUB_WORKSPACE, runId: env.GITHUB_RUN_ID,
    recipeRevision: env.GITHUB_SHA, uid, gid });
}

export function validateRemoteRuntimePolicy(value, candidatePolicyInput) {
  const candidatePolicy = validateRemoteSeaweedCandidatePolicy(candidatePolicyInput);
  if (!exactKeys(value, ["kind", "authority", "subject", "audit"])
    || !exactKeys(value.audit, ["workflowPath", "runId", "runNumber", "runAttempt", "recipeRevision",
      "artifact", "files"])
    || !exactKeys(value.audit.artifact, ["id", "name", "bytes", "digest"])
    || !exactKeys(value.audit.files, ["receipt", "vulnerability", "cyclonedx"])
    || Object.values(value.audit.files).some((file) => !exactKeys(file, ["sha256", "bytes"]))
    || value.kind !== "SEAWEED_REMOTE_RUNTIME_POLICY_V1" || value.authority !== "REVIEWED_MAIN_POLICY"
    || value.subject !== candidatePolicy.subject || value.audit.workflowPath !== AUDIT_WORKFLOW
    || !RUN_ID.test(value.audit.runId) || value.audit.runNumber !== "1" || value.audit.runAttempt !== "1"
    || !REVISION.test(value.audit.recipeRevision) || !Number.isSafeInteger(value.audit.artifact.id)
    || value.audit.artifact.id < 1 || value.audit.artifact.name !== AUDIT_ARTIFACT
    || !Number.isSafeInteger(value.audit.artifact.bytes) || value.audit.artifact.bytes < 1
    || value.audit.artifact.bytes > 256 * 1024 * 1024 || !DIGEST.test(value.audit.artifact.digest)
    || Object.values(value.audit.files).some((file) => !HEX.test(file.sha256)
      || !Number.isSafeInteger(file.bytes) || file.bytes < 2 || file.bytes > MAX_REPORT_BYTES)
    || value.audit.files.receipt.bytes > MAX_AUDIT_RECEIPT_BYTES) fail("seaweed_remote_runtime_policy_invalid");
  return Object.freeze({ ...value, audit: Object.freeze({ ...value.audit,
    artifact: Object.freeze({ ...value.audit.artifact }), files: Object.freeze(Object.fromEntries(
      Object.entries(value.audit.files).map(([name, file]) => [name, Object.freeze({ ...file })]))) }) });
}

function readBoundedRegularFile(file, cap, uid, code = "seaweed_remote_runtime_input_invalid") {
  let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(handle); const pathInfo = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || pathInfo.isSymbolicLink() || before.uid !== uid
      || before.dev !== pathInfo.dev || before.ino !== pathInfo.ino || before.size < 2 || before.size > cap
      || (before.mode & 0o022) !== 0) fail(code);
    const bytes = readFileSync(handle); const after = fstatSync(handle);
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail(code);
    return bytes;
  } catch (error) {
    if (error?.message === code) throw error;
    fail(code);
  } finally { if (handle !== undefined) closeSync(handle); }
}

function validateIdentity(bytes, expected, code = "seaweed_remote_runtime_evidence_invalid") {
  if (!Buffer.isBuffer(bytes) || bytes.length !== expected?.bytes || sha256(bytes) !== expected.sha256) fail(code);
  return Object.freeze({ sha256: expected.sha256, bytes: expected.bytes });
}

function validateDatabaseEvidence(databases, evidenceBytes, manifestBytes, now) {
  if (!exactKeys(databases, ["files", "metadata", "registry"]) || !plain(databases.metadata)
    || !Array.isArray(databases.files) || databases.files.length !== 4
    || !Array.isArray(databases.registry) || databases.registry.length !== 2
    || !plain(manifestBytes)) {
    fail("seaweed_remote_runtime_audit_invalid");
  }
  const evidence = parseJson(evidenceBytes, "seaweed_remote_runtime_audit_invalid");
  if (!exactKeys(evidence, ["checkedAt", "maxAgeMsByDatabase", "files", "observed", "validation"])
    || !isDeepStrictEqual(evidence.files, databases.files)
    || !isDeepStrictEqual(evidence.maxAgeMsByDatabase,
      { vulnerability: MAX_DATABASE_AGE_MS, java: null })
    || !plain(evidence.observed) || !Array.isArray(evidence.validation)
    || evidence.validation.length !== 2) fail("seaweed_remote_runtime_audit_invalid");
  for (const database of ["vulnerability", "java"]) {
    const recorded = databases.metadata[database];
    const observed = evidence.observed[database];
    const fileIndex = database === "vulnerability" ? 1 : 3;
    const validation = evidence.validation.find((entry) => entry?.name === database);
    if (!exactKeys(recorded, ["updatedAt", "downloadedAt", "version", "ageMs", "maxAgeMs", "freshAt48Hours"])) {
      fail("seaweed_remote_runtime_audit_invalid");
    }
    if (!Number.isSafeInteger(recorded.ageMs) || recorded.ageMs < 0
      || typeof recorded.freshAt48Hours !== "boolean" || !exactKeys(observed, ["value", "identity"])
      || !isDeepStrictEqual(observed.identity,
        { sha256: databases.files[fileIndex]?.sha256, size: databases.files[fileIndex]?.size })
      || !exactKeys(validation, ["name", "result", "ageMs", "maxAgeMs", "freshAt48Hours"])
      || validation.result !== "passed") fail("seaweed_remote_runtime_audit_invalid");
    let current;
    try {
      current = validateDatabaseMetadata(observed.value, { now, database });
    } catch { fail("seaweed_remote_runtime_audit_invalid"); }
    if (recorded.updatedAt !== current.updatedAt || recorded.downloadedAt !== current.downloadedAt
      || recorded.version !== current.version
      || !isDeepStrictEqual(validation, { name: database, result: "passed", ageMs: recorded.ageMs,
        maxAgeMs: recorded.maxAgeMs, freshAt48Hours: recorded.freshAt48Hours })
      || recorded.maxAgeMs !== (database === "vulnerability" ? MAX_DATABASE_AGE_MS : null)
      || database === "vulnerability" && current.freshAt48Hours !== true
      || database === "java" && current.maxAgeMs !== null) fail("seaweed_remote_runtime_audit_invalid");
  }
  const checkedAt = Date.parse(evidence.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now.getTime()) fail("seaweed_remote_runtime_audit_invalid");
  for (const [index, database] of ["vulnerability", "java"].entries()) {
    const registry = databases.registry[index];
    if (!exactKeys(registry, ["name", "repository", "tag", "digest", "size", "layerBytes"])
      || registry.name !== database || registry.repository !== `ghcr.io/aquasecurity/trivy${database === "java" ? "-java" : ""}-db`
      || registry.tag !== (database === "java" ? "1" : "2")) fail("seaweed_remote_runtime_audit_invalid");
    for (const checkpoint of ["before", "after"]) {
      let identity;
      try { identity = validateDatabaseRegistryManifest(manifestBytes[`${database}-${checkpoint}`]); }
      catch { fail("seaweed_remote_runtime_audit_invalid"); }
      if (!isDeepStrictEqual(identity,
        { digest: registry.digest, size: registry.size, layerBytes: registry.layerBytes })) {
        fail("seaweed_remote_runtime_audit_invalid");
      }
    }
  }
}

export function validateRemoteAuditEvidence({ runtimePolicy: runtimePolicyInput,
  candidatePolicy: candidatePolicyInput, receiptBytes, vulnerabilityBytes, cyclonedxBytes,
  databaseEvidenceBytes, databaseManifestBytes, now = new Date() }, dependencies = {}) {
  const candidatePolicy = validateRemoteSeaweedCandidatePolicy(candidatePolicyInput);
  const runtimePolicy = validateRemoteRuntimePolicy(runtimePolicyInput, candidatePolicy);
  const receiptIdentity = validateIdentity(receiptBytes, runtimePolicy.audit.files.receipt);
  const vulnerabilityIdentity = validateIdentity(vulnerabilityBytes, runtimePolicy.audit.files.vulnerability);
  const cyclonedxIdentity = validateIdentity(cyclonedxBytes, runtimePolicy.audit.files.cyclonedx);
  const receipt = parseJson(receiptBytes, "seaweed_remote_runtime_audit_invalid");
  const vulnerabilityReport = parseJson(vulnerabilityBytes, "seaweed_remote_runtime_audit_invalid");
  const cyclonedxReport = parseJson(cyclonedxBytes, "seaweed_remote_runtime_audit_invalid");
  const validateCandidate = dependencies.validateCandidateReceipt ?? validateRemoteSeaweedCandidateReceipt;
  const evaluate = dependencies.evaluatePolicy ?? evaluateLocalSeaweedCandidateAudit;
  if (receipt?.kind !== "SEAWEED_EXACT_REMOTE_CANDIDATE_AUDIT_V1" || receipt.state !== "COMPLETE"
    || receipt.authority !== "DIAGNOSTIC_ONLY" || receipt.candidateAuthorization !== "NOT_AUTHORIZED"
    || receipt.publication !== "NOT_ATTEMPTED" || receipt.admission !== "NOT_ATTEMPTED"
    || receipt.imageExecution !== "NOT_ATTEMPTED" || receipt.runId !== runtimePolicy.audit.runId
    || receipt.recipeRevision !== runtimePolicy.audit.recipeRevision || receipt.phase !== "COMPLETE"
    || receipt.registrySubject !== runtimePolicy.subject || receipt.scannerInput !== "LOCAL_DOCKER_SAVE_ARCHIVE"
    || receipt.blockerCount !== 0 || !Array.isArray(receipt.blockers) || receipt.blockers.length !== 0
    || receipt.blockersTruncated !== false || !Number.isSafeInteger(receipt.findingCount) || receipt.findingCount < 0
    || !Array.isArray(receipt.containerCleanup) || receipt.containerCleanup.length !== 4
    || !isDeepStrictEqual(receipt.containerCleanup.map((entry) => entry?.kind).sort(),
      ["db-java", "db-vulnerability", "scan-cyclonedx", "scan-json"])
    || receipt.containerCleanup.some((entry) => !["OWNED_CONTAINER_ABSENT", "OWNED_CONTAINER_REMOVED"].includes(entry?.state))
    || receipt.reports?.vulnerability?.sha256 !== vulnerabilityIdentity.sha256
    || receipt.reports?.vulnerability?.size !== vulnerabilityIdentity.bytes
    || receipt.reports?.cyclonedx?.sha256 !== cyclonedxIdentity.sha256
    || receipt.reports?.cyclonedx?.size !== cyclonedxIdentity.bytes) fail("seaweed_remote_runtime_audit_invalid");
  try { validateCandidate(receipt.candidate, candidatePolicy); }
  catch { fail("seaweed_remote_runtime_audit_invalid"); }
  if (receipt.candidate?.runId !== runtimePolicy.audit.runId
    || receipt.candidate?.recipeRevision !== runtimePolicy.audit.recipeRevision
    || receipt.candidate?.subject !== runtimePolicy.subject
    || receipt.candidate?.execution !== "NOT_ATTEMPTED"
    || receipt.candidate?.phases?.at(-2)?.name !== "owned_docker_cleanup"
    || receipt.candidate?.phases?.at(-2)?.result !== "PASSED"
    || receipt.candidate?.phases?.at(-1)?.name !== "owned_temporary_cleanup"
    || receipt.candidate?.phases?.at(-1)?.result !== "PASSED") fail("seaweed_remote_runtime_audit_invalid");
  validateDatabaseEvidence(receipt.databases, databaseEvidenceBytes, databaseManifestBytes, now);
  let evaluation;
  try {
    evaluation = evaluate({ vulnerabilityReport, cyclonedxReport, subject: {
      artifactName: receipt.subject?.artifactName, imageId: receipt.subject?.imageId,
      archiveSha256: receipt.subject?.archiveSha256, tag: receipt.subject?.tag,
    }, now });
  } catch { fail("seaweed_remote_runtime_audit_invalid"); }
  if (evaluation?.state !== "COMPLETE" || !Array.isArray(evaluation.blockers) || evaluation.blockers.length !== 0
    || !Array.isArray(evaluation.findings) || evaluation.findings.length !== receipt.findingCount
    || receipt.subject?.artifactName !== "/candidate/saved.tar"
    || receipt.subject?.imageId !== candidatePolicy.candidate.imageId
    || receipt.subject?.diffId !== candidatePolicy.candidate.diffId
    || receipt.subject?.imageId !== receipt.candidate?.archive?.imageId
    || receipt.subject?.diffId !== receipt.candidate?.archive?.diffId
    || receipt.subject?.archiveSha256 !== receipt.candidate?.archive?.archiveSha256
    || receipt.subject?.archiveBytes !== receipt.candidate?.archive?.archiveBytes
    || receipt.subject?.tag !== receipt.candidate?.alias
    || receipt.subject?.configSha256 !== candidatePolicy.source.configSha256
    || receipt.subject?.configBytes !== candidatePolicy.source.configBytes
    || `sha256:${receipt.subject?.configSha256}` !== candidatePolicy.candidate.imageId
    || receipt.subject?.layerSha256 !== candidatePolicy.source.savedLayerSha256
    || receipt.subject?.layerBytes !== candidatePolicy.source.savedLayerBytes
    || receipt.subject?.layerBytes !== candidatePolicy.candidate.rawSize
    || `sha256:${receipt.subject?.layerSha256}` !== candidatePolicy.candidate.diffId) {
    fail("seaweed_remote_runtime_audit_invalid");
  }
  return Object.freeze({ runtimePolicy, candidatePolicy, receipt, receiptIdentity,
    vulnerabilityIdentity, cyclonedxIdentity });
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: null, env: options.env,
    maxBuffer: options.maxBuffer, timeout: options.timeoutMs, windowsHide: true });
}

async function readBoundedResponse(response, cap) {
  if (response.status !== 200 || !response.body) fail("seaweed_remote_runtime_api_invalid");
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { await reader.cancel(); fail("seaweed_remote_runtime_api_invalid"); }
    chunks.push(value);
  }
  return parseJson(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size),
    "seaweed_remote_runtime_api_invalid");
}

export async function verifyRemoteAuditApi(runtimePolicy, context, env, { fetchImpl = globalThis.fetch,
  now = Date.now, timeoutMs = API_TIMEOUT_MS } = {}) {
  const token = env.GITHUB_TOKEN; const at = now();
  if (typeof token !== "string" || token.length < 1 || token.length > 8192 || env.GH_TOKEN !== token
    || !Number.isFinite(at) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > API_TIMEOUT_MS) {
    fail("seaweed_remote_runtime_environment_invalid");
  }
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
    "User-Agent": "auto-world-seaweed-remote-runtime", "X-GitHub-Api-Version": "2022-11-28" };
  const request = async (suffix) => {
    try {
      const response = await fetchImpl(`https://api.github.com/repos/CleMeY15/auto-world/actions/runs/${runtimePolicy.audit.runId}${suffix}`,
        { redirect: "error", signal: controller.signal, headers });
      return await readBoundedResponse(response, MAX_API_BYTES);
    } catch (error) {
      if (error?.message === "seaweed_remote_runtime_api_invalid") throw error;
      fail("seaweed_remote_runtime_api_invalid");
    }
  };
  try {
    const run = await request(""); const artifacts = await request("/artifacts");
    if (run?.id !== Number(runtimePolicy.audit.runId) || run?.run_number !== 1 || run?.run_attempt !== 1
      || run?.event !== "workflow_dispatch" || run?.status !== "completed" || run?.conclusion !== "success"
      || run?.head_branch !== "main" || run?.head_sha !== runtimePolicy.audit.recipeRevision
      || run?.path !== runtimePolicy.audit.workflowPath || run?.repository?.full_name !== "CleMeY15/auto-world"
      || !Number.isSafeInteger(artifacts?.total_count) || !Array.isArray(artifacts?.artifacts)) {
      fail("seaweed_remote_runtime_api_invalid");
    }
    const matches = artifacts.artifacts.filter((artifact) => artifact?.id === runtimePolicy.audit.artifact.id);
    const artifact = matches[0]; const expiresAt = Date.parse(artifact?.expires_at ?? "");
    if (matches.length !== 1 || artifact.name !== runtimePolicy.audit.artifact.name
      || artifact.size_in_bytes !== runtimePolicy.audit.artifact.bytes
      || artifact.digest !== runtimePolicy.audit.artifact.digest || artifact.expired !== false
      || !Number.isFinite(expiresAt) || expiresAt <= at || artifact.workflow_run?.id !== Number(runtimePolicy.audit.runId)
      || artifact.workflow_run?.head_sha !== runtimePolicy.audit.recipeRevision) {
      fail("seaweed_remote_runtime_api_invalid");
    }
    return true;
  } finally { globalThis.clearTimeout(timer); }
}

function committedBytes(relative, cap, context, commandRunner) {
  const file = path.join(ROOT, ...relative.split("/"));
  const working = readBoundedRegularFile(file, cap, context.uid);
  const result = commandRunner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: cap + 1, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout)
    || result.stdout.length > cap || !result.stdout.equals(working)) fail("seaweed_remote_runtime_input_uncommitted");
  return working;
}

function requireAuditInput(directory, uid) {
  try {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o022) !== 0
      || realpathSync(directory) !== directory) fail("seaweed_remote_runtime_input_invalid");
    const names = readdirSync(directory).sort();
    if (!isDeepStrictEqual(names, Object.keys(AUDIT_FILES).sort())) fail("seaweed_remote_runtime_input_invalid");
    for (const name of names) readBoundedRegularFile(path.join(directory, name), AUDIT_FILES[name], uid);
  } catch { fail("seaweed_remote_runtime_input_invalid"); }
}

function cleanupEmptyRoot(context) {
  if (!existsSync(context.root)) return;
  const info = lstatSync(context.root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== context.uid || (info.mode & 0o777) !== 0o700
    || realpathSync(context.root) !== context.root || readdirSync(context.root).length !== 0) {
    fail("seaweed_remote_runtime_cleanup_uncertain");
  }
  rmdirSync(context.root);
}

function writeEvidence(context, receipt) {
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > 1024 * 1024) fail("seaweed_remote_runtime_receipt_invalid");
  writeFileSync(path.join(context.output, RECEIPT_FILE), bytes, { flag: "wx", mode: 0o600 });
}

export function publicRemoteRuntimeFailure(error) {
  const code = PUBLIC_FAILURE_CODES.has(error?.message)
    ? error.message : "seaweed_remote_runtime_diagnostic_failed";
  const aggregate = sanitizeAggregateFailure(error);
  return Object.freeze({ kind: "SEAWEED_REMOTE_RUNTIME_DIAGNOSTIC_FAILURE_V1", state: "FAILED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
    admission: "NOT_AUTHORIZED", publication: "PUBLISHED_UNADMITTED",
    imageExecution: "NOT_VERIFIED", code, ...aggregate });
}

function sanitizedDiagnosticFailure(value) {
  if (value === null) return null;
  if (!exactKeys(value, ["code", "phase", "reason", "runtimeCleanupFailure"])
    || !RUNTIME_FAILURE_CODES.has(value.code)) return null;
  const host = value.code.includes("host_loopback");
  const validPhase = host ? isPublicSeaweedHostLoopbackPhase : isPublicSeaweedRuntimePhase;
  const validReason = host ? isPublicSeaweedHostLoopbackReason : isPublicSeaweedRuntimeReason;
  if (!validPhase(value.phase) || !validReason(value.reason)) return null;
  let runtimeCleanupFailure = null;
  if (value.runtimeCleanupFailure !== null) {
    const cleanup = value.runtimeCleanupFailure;
    if (!exactKeys(cleanup, ["code", "phase", "reason"]) || !RUNTIME_FAILURE_CODES.has(cleanup.code)) return null;
    const cleanupHost = cleanup.code.includes("host_loopback");
    const cleanupPhase = cleanupHost ? isPublicSeaweedHostLoopbackPhase : isPublicSeaweedRuntimePhase;
    const cleanupReason = cleanupHost ? isPublicSeaweedHostLoopbackReason : isPublicSeaweedRuntimeReason;
    if (!cleanupPhase(cleanup.phase) || !cleanupReason(cleanup.reason)) return null;
    runtimeCleanupFailure = Object.freeze({ code: cleanup.code, phase: cleanup.phase, reason: cleanup.reason });
  }
  return Object.freeze({ code: value.code, phase: value.phase, reason: value.reason, runtimeCleanupFailure });
}

function sanitizeAggregateFailure(error) {
  const empty = { diagnosticFailure: null, materialPrimaryFailure: null,
    imageCleanupFailure: null, temporaryCleanupFailure: null };
  if (error?.message !== "seaweed_remote_runtime_candidate_failed"
    || error.code !== "seaweed_remote_runtime_candidate_failed"
    || error.state !== "INCOMPLETE" || error.authority !== "DIAGNOSTIC_ONLY"
    || error.candidateAuthorization !== "NOT_AUTHORIZED"
    || !isDeepStrictEqual(Object.keys(error).sort(), ["authority", "candidateAuthorization", "code",
      "diagnosticFailure", "imageCleanupFailure", "materialPrimaryFailure", "state",
      "temporaryCleanupFailure"].sort())) return empty;
  const provider = (value) => value === null || value === "seaweed_remote_runtime_diagnostics_failed"
    || typeof value === "string" && value.length <= 128
      && /^seaweed_remote_candidate_[a-z0-9_]+$/u.test(value) ? value : null;
  return { diagnosticFailure: sanitizedDiagnosticFailure(error.diagnosticFailure),
    materialPrimaryFailure: provider(error.materialPrimaryFailure),
    imageCleanupFailure: provider(error.imageCleanupFailure),
    temporaryCleanupFailure: provider(error.temporaryCleanupFailure) };
}

export async function runRemoteRuntimeDiagnostic(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) fail("seaweed_remote_runtime_arguments_invalid");
  const context = requireRemoteRuntimeContext(env, dependencies.context);
  if (argv[0] === "cleanup") {
    (dependencies.cleanup ?? cleanupEmptyRoot)(context);
    return { state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" };
  }
  if (existsSync(context.output)) fail("seaweed_remote_runtime_output_exists");
  mkdirSync(context.output, { mode: 0o700 });
  let result;
  try {
    const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
    await (dependencies.verifyMain ?? verifyRemoteAuditMain)(context, env, { commandRunner,
      fetchImpl: dependencies.fetchImpl ?? globalThis.fetch });
    const readCommitted = dependencies.readCommitted ?? committedBytes;
    const candidateBytes = readCommitted("infra/seaweed-image/candidate-remote.json", MAX_POLICY_BYTES, context, commandRunner);
    const publicationBytes = readCommitted("infra/seaweed-image/candidate-publication-receipt.json",
      MAX_PUBLICATION_BYTES, context, commandRunner);
    const baselineBytes = readCommitted("infra/seaweed-image/base-config.json", MAX_PUBLICATION_BYTES, context, commandRunner);
    const runtimeBytes = readCommitted("infra/seaweed-image/candidate-remote-runtime.json",
      MAX_POLICY_BYTES, context, commandRunner);
    const candidatePolicy = validateRemoteSeaweedCandidatePolicy(parseJson(candidateBytes));
    validatePublishedCandidateBinding(candidatePolicy, publicationBytes);
    const runtimePolicy = validateRemoteRuntimePolicy(parseJson(runtimeBytes), candidatePolicy);
    const baseline = parseJson(baselineBytes)?.config;
    if (!plain(baseline)) fail("seaweed_remote_runtime_input_invalid");
    await (dependencies.verifyAuditApi ?? verifyRemoteAuditApi)(runtimePolicy, context, env,
      { fetchImpl: dependencies.fetchImpl ?? globalThis.fetch, now: dependencies.now ?? Date.now });
    (dependencies.validateAuditInput ?? requireAuditInput)(context.auditInput, context.uid);
    const readAudit = dependencies.readAudit ?? readBoundedRegularFile;
    const auditBytes = Object.fromEntries(Object.entries(AUDIT_FILES).map(([name, cap]) =>
      [name, readAudit(path.join(context.auditInput, name), cap, context.uid)]));
    const receiptBytes = auditBytes["audit-receipt.json"];
    const vulnerabilityBytes = auditBytes["candidate-vulnerabilities.json"];
    const cyclonedxBytes = auditBytes["candidate-sbom.cdx.json"];
    const databaseManifestBytes = Object.fromEntries(["vulnerability", "java"].flatMap((database) =>
      ["before", "after"].map((checkpoint) => [`${database}-${checkpoint}`,
        auditBytes[`database-${database}-${checkpoint}-manifest.json`]])));
    const evidence = validateRemoteAuditEvidence({ runtimePolicy, candidatePolicy, receiptBytes,
      vulnerabilityBytes, cyclonedxBytes, databaseEvidenceBytes: auditBytes["database-evidence.json"],
      databaseManifestBytes, now: new Date((dependencies.now ?? Date.now)()) },
    dependencies.auditValidation);
    const bindingValue = { kind: "SEAWEED_REMOTE_AUDIT_BINDING_V1", state: "COMPLETE",
      subject: runtimePolicy.subject, runId: runtimePolicy.audit.runId, runNumber: "1", runAttempt: "1",
      recipeRevision: runtimePolicy.audit.recipeRevision, artifact: runtimePolicy.audit.artifact,
      files: runtimePolicy.audit.files };
    const validateBinding = dependencies.validateAuditBinding ?? validateRemoteSeaweedAuditBinding;
    const auditBinding = validateBinding(bindingValue, candidatePolicy);
    mkdirSync(context.root, { mode: 0o700 });
    const suite = dependencies.runtimeSuite ?? withVerifiedRemoteSeaweedRuntimeCandidate;
    result = await suite({ parent: context.root, policy: candidatePolicy, runId: context.runId,
      recipeRevision: context.recipeRevision, signal: dependencies.signal,
      validateFilesystem: (entries) => validateRemoteAuditFilesystem(entries, candidatePolicy),
      validateRuntimeConfig: (config) => validateRemoteAuditRuntimeConfig(config, baseline),
      auditBinding }, dependencies.runtimeSuiteDependencies);
    const validateReceipt = dependencies.validateRuntimeReceipt ?? validateRemoteSeaweedRuntimeCandidateReceipt;
    result = validateReceipt(result, candidatePolicy, auditBinding);
    if (result.runId !== context.runId || result.recipeRevision !== context.recipeRevision) {
      fail("seaweed_remote_runtime_receipt_invalid");
    }
    if (readdirSync(context.root).length !== 0) fail("seaweed_remote_runtime_cleanup_uncertain");
    if (evidence.receipt.registrySubject !== result.subject) fail("seaweed_remote_runtime_receipt_invalid");
    writeEvidence(context, result);
  } catch (error) {
    try { writeEvidence(context, publicRemoteRuntimeFailure(error)); } catch { /* Preserve the original failure. */ }
    throw error;
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRemoteRuntimeDiagnostic().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(JSON.stringify(publicRemoteRuntimeFailure(error))); process.exitCode = 1; });
}
