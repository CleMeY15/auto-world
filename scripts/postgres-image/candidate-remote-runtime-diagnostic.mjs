import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import * as remoteCandidate from "./candidate-remote.mjs";
import { validatePostgresRemoteAuditArtifact, verifyPostgresRemoteAuditMain } from "./candidate-remote-audit.mjs";
import { postgresRuntimeFailureDiagnostic, validatePostgresRuntimeFailureDiagnostic } from "./candidate-runtime.mjs";
import { validateDatabaseMetadata } from "../scanner/audit-policy.mjs";
import { validateDiagnosticLock } from "./diagnostic.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const POLICY_PATH = "infra/postgres-image/candidate-runtime.json";
const REMOTE_POLICY_PATH = "infra/postgres-image/candidate-remote.json";
const PUBLICATION_PATH = "infra/postgres-image/candidate-publication-receipt.json";
const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/postgres-candidate-remote-runtime-diagnostic-v2.yml@refs/heads/main";
const AUDIT_WORKFLOW = ".github/workflows/postgres-candidate-remote-audit.yml";
const MiB = 1024 ** 2;
const MAX_RECEIPT_BYTES = 256 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const FILES = Object.freeze(["audit-receipt.json", "candidate-sbom.cdx.json", "candidate-vulnerabilities.json",
  "database-evidence.json", "database-java-after-manifest.json", "database-java-before-manifest.json",
  "database-vulnerability-after-manifest.json", "database-vulnerability-before-manifest.json",
  "fixture-gomod-vulnerable-baseline.json", "fixture-gomod-vulnerable-candidate.json",
  "fixture-java-jar-clean-candidate-candidate.json", "fixture-java-war-vulnerable-baseline.json",
  "fixture-java-war-vulnerable-candidate.json", "scanner-self.cdx.json", "scanner-self.json", "scanner-version-probe.json"]);
const RECEIPT_KEYS = ["schemaVersion", "kind", "state", "authority", "subject", "runId", "recipeRevision", "audit",
  "material", "runtime", "failure", "registryWrite", "admission", "supportStartedAt", "supportEndsAt", "archiveUntil"];
const SENSITIVE = /(?:ghp_[a-z0-9]+|github_pat_[a-z0-9_]+|bearer\s|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/iu;
const FAILURE_CODES = new Set(["postgres_remote_runtime_arguments_invalid", "postgres_remote_runtime_context_invalid",
  "postgres_remote_runtime_input_invalid", "postgres_remote_runtime_input_uncommitted", "postgres_remote_runtime_policy_invalid",
  "postgres_remote_runtime_api_invalid", "postgres_remote_runtime_environment_invalid", "postgres_remote_runtime_audit_invalid",
  "postgres_remote_runtime_database_invalid", "postgres_remote_runtime_output_exists", "postgres_remote_runtime_receipt_invalid",
  "postgres_remote_runtime_cleanup_uncertain", "postgres_remote_runtime_candidate_failed", "postgres_runtime_cleanup_uncertain",
  "postgres_remote_runtime_material_failed", "postgres_remote_runtime_diagnostics_failed",
  "postgres_runtime_failed", "postgres_remote_runtime_failed"]);

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) { return plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parseJson(bytes, code = "postgres_remote_runtime_input_invalid") {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(code); }
}
function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozen(entry)])));
  return value;
}
function identityValid(value, cap = 64 * MiB) {
  return exactKeys(value, ["sha256", "size"]) && SHA256.test(value.sha256) && Number.isSafeInteger(value.size)
    && value.size >= 2 && value.size <= cap;
}
function fixedReason(error) { return FAILURE_CODES.has(error?.message) ? error.message : "postgres_remote_runtime_failed"; }
function unsafeCleanup(error) {
  return [error?.message, error?.code, error?.runtimeDiagnostic?.code].some((value) =>
    typeof value === "string" && /(?:cleanup|ownership|resource_identity|container_identity)/u.test(value));
}
function failureRecord(error) {
  const detail = error?.runtimeDiagnostic;
  const runtimeDiagnostic = detail == null ? null : validatePostgresRuntimeFailureDiagnostic(
    postgresRuntimeFailureDiagnostic({ message: detail.code, phase: detail.phase }));
  return { code: unsafeCleanup(error) ? "postgres_remote_runtime_cleanup_uncertain" : fixedReason(error), runtimeDiagnostic };
}
function pathPresent(file) {
  try { lstatSync(file); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

export function requirePostgresRemoteRuntimeDiagnosticContext(env, { platform = process.platform,
  uid = process.getuid?.(), gid = process.getgid?.() } = {}) {
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.GITHUB_JOB !== "runtime"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !REVISION.test(env.GITHUB_SHA ?? "") || !RUN_ID.test(env.GITHUB_RUN_ID ?? "")
    || [env.RUNNER_TEMP, env.GITHUB_WORKSPACE].some((entry) => typeof entry !== "string"
      || !path.isAbsolute(entry) || path.normalize(entry) !== entry)) fail("postgres_remote_runtime_context_invalid");
  try {
    if (realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP || realpathSync(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) {
      fail("postgres_remote_runtime_context_invalid");
    }
  } catch { fail("postgres_remote_runtime_context_invalid"); }
  return Object.freeze({ root: path.join(env.RUNNER_TEMP, "postgres-candidate-remote-runtime-work"),
    output: path.join(env.RUNNER_TEMP, "postgres-candidate-remote-runtime-evidence"),
    auditInput: path.join(env.RUNNER_TEMP, "postgres-runtime-audit-download"),
    workspace: env.GITHUB_WORKSPACE, runId: env.GITHUB_RUN_ID, recipeRevision: env.GITHUB_SHA, uid, gid });
}

export function validatePostgresRemoteRuntimePolicy(value, candidatePolicy) {
  if (!exactKeys(value, ["schemaVersion", "kind", "authority", "admission", "subject", "sourceLock", "audit",
    "supportStartedAt", "supportEndsAt", "archiveUntil"]) || value.schemaVersion !== 1
    || value.kind !== "POSTGRES_REMOTE_RUNTIME_POLICY_V1" || value.authority !== "DIAGNOSTIC_ONLY"
    || value.admission !== "NOT_AUTHORIZED" || value.subject !== candidatePolicy.subject
    || value.supportStartedAt !== null || value.supportEndsAt !== null || value.archiveUntil !== null
    || !exactKeys(value.sourceLock, ["path", "sha256", "size"]) || value.sourceLock.path !== "infra/postgres-image/lock.json"
    || !SHA256.test(value.sourceLock.sha256) || !Number.isSafeInteger(value.sourceLock.size)
    || value.sourceLock.size < 2 || value.sourceLock.size > MiB
    || !exactKeys(value.audit, ["repository", "workflow", "workflowId", "runId", "runNumber", "attempt", "recipeRevision",
      "artifact", "receipt", "context", "scanner", "files"])) fail("postgres_remote_runtime_policy_invalid");
  const audit = value.audit;
  if (audit.repository !== "CleMeY15/auto-world" || audit.workflow !== AUDIT_WORKFLOW
    || !Number.isSafeInteger(audit.workflowId) || audit.workflowId < 1 || !RUN_ID.test(audit.runId)
    || !Number.isSafeInteger(Number(audit.runId)) || audit.runNumber !== 1 || audit.attempt !== 1
    || !REVISION.test(audit.recipeRevision) || !exactKeys(audit.artifact, ["id", "name", "sha256", "size"])
    || !Number.isSafeInteger(audit.artifact.id) || audit.artifact.id < 1
    || audit.artifact.name !== "postgres-candidate-remote-audit" || !SHA256.test(audit.artifact.sha256)
    || !Number.isSafeInteger(audit.artifact.size) || audit.artifact.size < 2 || audit.artifact.size > 256 * MiB
    || !identityValid(audit.receipt, 8 * MiB) || !exactKeys(audit.context, ["root"])
    || audit.context.root !== "/home/runner/work/_temp/postgres-candidate-remote-audit-work"
    || !exactKeys(audit.scanner, ["version", "sourceCommit", "lockSha256", "binary"])
    || audit.scanner.version !== "0.74.0-autoworld.2" || !REVISION.test(audit.scanner.sourceCommit)
    || !SHA256.test(audit.scanner.lockSha256) || !identityValid(audit.scanner.binary, 512 * MiB)
    || !Array.isArray(audit.files) || audit.files.length !== FILES.length
    || !isDeepStrictEqual(audit.files.map((entry) => entry?.name).sort(), [...FILES])
    || audit.files.some((entry) => !exactKeys(entry, ["name", "sha256", "size"])
      || !SHA256.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 2 || entry.size > 64 * MiB)
    || audit.files.reduce((total, entry) => total + entry.size, 0) > 256 * MiB
    || !isDeepStrictEqual(Object.fromEntries(Object.entries(audit.files.find((entry) => entry.name === "audit-receipt.json"))
      .filter(([key]) => key !== "name")), audit.receipt)) fail("postgres_remote_runtime_policy_invalid");
  return frozen(value);
}

function readRegular(file, cap, uid, privateMode = false) {
  let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(handle); const info = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || info.isSymbolicLink() || before.uid !== uid
      || info.dev !== before.dev || info.ino !== before.ino || (before.mode & 0o022) !== 0
      || privateMode && (before.mode & 0o777) !== 0o600 || before.size < 2 || before.size > cap) {
      fail("postgres_remote_runtime_input_invalid");
    }
    const bytes = readFileSync(handle); const after = fstatSync(handle);
    if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail("postgres_remote_runtime_input_invalid");
    return bytes;
  } catch { fail("postgres_remote_runtime_input_invalid"); }
  finally { if (handle !== undefined) closeSync(handle); }
}
function directory(directoryPath, uid, privateMode = false) {
  const info = lstatSync(directoryPath);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o022) !== 0
    || privateMode && (info.mode & 0o777) !== 0o700 || realpathSync(directoryPath) !== directoryPath) {
    fail("postgres_remote_runtime_input_invalid");
  }
}
function assertIdentity(bytes, expected) {
  if (bytes.length !== expected.size || sha256(bytes) !== expected.sha256) fail("postgres_remote_runtime_audit_invalid");
}
function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: null,
    timeout: options.timeoutMs, maxBuffer: options.maxBuffer, windowsHide: true });
}
function committedBytes(relative, cap, context, commandRunner) {
  if (context.workspace !== ROOT) fail("postgres_remote_runtime_input_uncommitted");
  const working = readRegular(path.join(ROOT, ...relative.split("/")), cap, context.uid);
  const result = commandRunner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, timeoutMs: 60_000, maxBuffer: cap + 1 });
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length > cap
    || !working.equals(result.stdout)) fail("postgres_remote_runtime_input_uncommitted");
  return working;
}
export function authenticatePostgresRemoteRuntimeSource(context, dependencies = {}) {
  const read = dependencies.readCommitted ?? committedBytes;
  const runner = dependencies.commandRunner ?? defaultCommandRunner;
  const candidateBytes = read(REMOTE_POLICY_PATH, 128 * 1024, context, runner);
  const candidatePolicy = remoteCandidate.validatePostgresRemotePolicy(parseJson(candidateBytes));
  const runtimeBytes = read(POLICY_PATH, 128 * 1024, context, runner);
  const runtimePolicy = validatePostgresRemoteRuntimePolicy(parseJson(runtimeBytes), candidatePolicy);
  const lockBytes = read(runtimePolicy.sourceLock.path, MiB, context, runner);
  assertIdentity(lockBytes, runtimePolicy.sourceLock);
  const dockerfileBytes = read("infra/postgres-image/Dockerfile", MiB, context, runner);
  let lock;
  try { lock = validateDiagnosticLock(parseJson(lockBytes), dockerfileBytes); }
  catch { fail("postgres_remote_runtime_input_invalid"); }
  const publicationBytes = read(PUBLICATION_PATH, MiB, context, runner);
  assertIdentity(publicationBytes, { sha256: candidatePolicy.publisher.receiptSha256, size: candidatePolicy.publisher.receiptBytes });
  remoteCandidate.validatePostgresRemotePublicationReceipt(parseJson(publicationBytes), candidatePolicy);
  return { runtimePolicy, candidatePolicy, lock, identities: { policy: { sha256: sha256(runtimeBytes), size: runtimeBytes.length },
    candidate: { sha256: sha256(candidateBytes), size: candidateBytes.length }, lock: { sha256: sha256(lockBytes), size: lockBytes.length },
    dockerfile: { sha256: sha256(dockerfileBytes), size: dockerfileBytes.length },
    publication: { sha256: sha256(publicationBytes), size: publicationBytes.length } } };
}

async function apiJson(response) {
  if (response?.status !== 200 || !response.body) fail("postgres_remote_runtime_api_invalid");
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 512 * 1024) { await reader.cancel(); fail("postgres_remote_runtime_api_invalid"); }
    chunks.push(Buffer.from(value));
  }
  return parseJson(Buffer.concat(chunks, size), "postgres_remote_runtime_api_invalid");
}
export async function verifyPostgresRuntimeAuditApi(policy, env, { fetchImpl = globalThis.fetch,
  now = () => new Date(), timeoutMs = 60_000 } = {}) {
  const token = env.GITHUB_TOKEN; const at = now();
  if (typeof token !== "string" || token.length < 1 || token.length > 8192 || env.GH_TOKEN !== token
    || !(at instanceof Date) || !Number.isFinite(at.getTime()) || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 60_000) fail("postgres_remote_runtime_environment_invalid");
  const controller = new globalThis.AbortController(); const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const request = async (suffix) => apiJson(await fetchImpl(
    `https://api.github.com/repos/CleMeY15/auto-world/actions/runs/${policy.audit.runId}${suffix}`, {
      redirect: "error", signal: controller.signal, headers: { Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`, "User-Agent": "auto-world-postgres-remote-runtime", "X-GitHub-Api-Version": "2022-11-28" } }));
  try {
    const run = await request(""); const inventory = await request("/artifacts");
    if (run?.id !== Number(policy.audit.runId) || run.workflow_id !== policy.audit.workflowId || run.run_number !== 1
      || run.run_attempt !== 1 || run.path !== policy.audit.workflow || run.event !== "workflow_dispatch"
      || run.status !== "completed" || run.conclusion !== "success" || run.head_branch !== "main"
      || run.head_sha !== policy.audit.recipeRevision || run.repository?.full_name !== policy.audit.repository
      || !Number.isSafeInteger(inventory?.total_count) || !Array.isArray(inventory.artifacts)
      || inventory.total_count !== inventory.artifacts.length || inventory.artifacts.length > 100) fail("postgres_remote_runtime_api_invalid");
    const matches = inventory.artifacts.filter((entry) => entry?.id === policy.audit.artifact.id);
    const artifact = matches[0]; const expiresAt = Date.parse(artifact?.expires_at ?? "");
    if (matches.length !== 1 || artifact.name !== policy.audit.artifact.name || artifact.expired !== false
      || artifact.size_in_bytes !== policy.audit.artifact.size || artifact.digest !== `sha256:${policy.audit.artifact.sha256}`
      || !Number.isFinite(expiresAt) || expiresAt <= at.getTime() || artifact.workflow_run?.id !== Number(policy.audit.runId)
      || artifact.workflow_run?.head_sha !== policy.audit.recipeRevision) fail("postgres_remote_runtime_api_invalid");
    return true;
  } catch { fail("postgres_remote_runtime_api_invalid"); }
  finally { globalThis.clearTimeout(timer); }
}

export function authenticatePostgresRuntimeAuditFiles(input, policy, context, { privateMode = false } = {}) {
  directory(input, context.uid, privateMode);
  if (!isDeepStrictEqual(readdirSync(input).sort(), [...FILES])) fail("postgres_remote_runtime_audit_invalid");
  const bytes = {};
  for (const expected of policy.audit.files) {
    const value = readRegular(path.join(input, expected.name), expected.size, context.uid, privateMode);
    assertIdentity(value, expected); bytes[expected.name] = value;
  }
  return bytes;
}
export function replayPostgresRuntimeAudit(input, policy, context, dependencies = {}) {
  const bytes = authenticatePostgresRuntimeAuditFiles(input, policy, context, { privateMode: true });
  const now = (dependencies.now ?? (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("postgres_remote_runtime_database_invalid");
  const evidence = parseJson(bytes["database-evidence.json"], "postgres_remote_runtime_audit_invalid");
  try {
    for (const name of ["vulnerability", "java"]) validateDatabaseMetadata(evidence?.observed?.[name]?.value, { now, database: name });
  } catch { fail("postgres_remote_runtime_database_invalid"); }
  const receipt = parseJson(bytes["audit-receipt.json"], "postgres_remote_runtime_audit_invalid");
  if (receipt.kind !== "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1" || receipt.state !== "COMPLETE"
    || receipt.authority !== "DIAGNOSTIC_ONLY" || receipt.admission !== "NOT_AUTHORIZED"
    || receipt.phase !== "COMPLETE" || receipt.runId !== policy.audit.runId || receipt.recipeRevision !== policy.audit.recipeRevision
    || receipt.registrySubject !== policy.subject || receipt.findingCount !== 0 || receipt.blockerCount !== 0
    || !isDeepStrictEqual(receipt.blockers, []) || receipt.blockersTruncated !== false
    || receipt.supportStartedAt !== null || receipt.supportEndsAt !== null || receipt.archiveUntil !== null
    || !isDeepStrictEqual({ version: receipt.scanner?.version, sourceCommit: receipt.scanner?.sourceCommit,
      lockSha256: receipt.scanner?.lockSha256, binary: receipt.scanner?.binary }, policy.audit.scanner)) {
    fail("postgres_remote_runtime_audit_invalid");
  }
  try {
    const accepted = (dependencies.validateAuditArtifact ?? validatePostgresRemoteAuditArtifact)({ root: policy.audit.context.root, output: input,
      workspace: context.workspace, runId: policy.audit.runId, recipeRevision: policy.audit.recipeRevision, uid: context.uid }, {
      readCommitted: dependencies.readCommitted ?? committedBytes, commandRunner: dependencies.commandRunner,
      now: () => now });
    if (accepted !== true) fail("postgres_remote_runtime_audit_invalid");
  } catch { fail("postgres_remote_runtime_audit_invalid"); }
  return { receipt, receiptIdentity: policy.audit.receipt };
}
function makeDirectory(file, context) {
  if (existsSync(file)) fail("postgres_remote_runtime_output_exists");
  mkdirSync(file, { mode: 0o700 }); directory(file, context.uid, true);
}
function stageAudit(context, policy) {
  const files = authenticatePostgresRuntimeAuditFiles(context.auditInput, policy, context);
  makeDirectory(context.root, context);
  const staged = path.join(context.root, "audit-evidence"); makeDirectory(staged, context);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(staged, name), bytes, { flag: "wx", mode: 0o600 });
  return staged;
}
function clearStagedAudit(context, policy, staged) {
  if (!pathPresent(context.root)) return;
  try {
    directory(context.root, context.uid, true);
    const material = path.join(context.root, "material");
    if (pathPresent(material)) {
      directory(material, context.uid, true);
      if (readdirSync(material).length !== 0) fail("postgres_remote_runtime_cleanup_uncertain");
      rmdirSync(material);
    }
    if (!staged || !isDeepStrictEqual(readdirSync(context.root), ["audit-evidence"])) fail("postgres_remote_runtime_cleanup_uncertain");
    authenticatePostgresRuntimeAuditFiles(staged, policy, context, { privateMode: true });
    for (const name of FILES) unlinkSync(path.join(staged, name));
    rmdirSync(staged); rmdirSync(context.root);
  } catch { fail("postgres_remote_runtime_cleanup_uncertain"); }
}
function cleanupRoot(context) {
  if (!pathPresent(context.root)) return;
  try {
    directory(context.root, context.uid, true);
    if (readdirSync(context.root).length !== 0) fail("postgres_remote_runtime_cleanup_uncertain");
    rmdirSync(context.root);
  } catch { fail("postgres_remote_runtime_cleanup_uncertain"); }
}
function auditSummary(policy) {
  return { runId: policy.audit.runId, recipeRevision: policy.audit.recipeRevision,
    artifact: policy.audit.artifact, receipt: policy.audit.receipt };
}
function runtimeIdentity(context, candidatePolicy) {
  return { subject: candidatePolicy.subject, imageId: candidatePolicy.candidate.imageId,
    diffIds: candidatePolicy.candidate.diffIds, runId: context.runId, recipeRevision: context.recipeRevision };
}
function newReceipt(context, subject, audit = null) {
  return { schemaVersion: 1, kind: "POSTGRES_REMOTE_RUNTIME_DIAGNOSTIC_RECEIPT_V1", state: "INCOMPLETE",
    authority: "DIAGNOSTIC_ONLY", subject, runId: context.runId, recipeRevision: context.recipeRevision, audit,
    material: null, runtime: null, failure: null, registryWrite: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null };
}
function writeReceipt(context, receipt) {
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  if (bytes.length > MAX_RECEIPT_BYTES || SENSITIVE.test(bytes.toString("utf8"))) fail("postgres_remote_runtime_receipt_invalid");
  makeDirectory(context.output, context);
  writeFileSync(path.join(context.output, "receipt.json"), bytes, { flag: "wx", mode: 0o600 });
}
async function runtimeModule(dependencies) {
  return dependencies.executeRuntime && dependencies.validateRuntimeReceipt ? dependencies : import("./candidate-runtime.mjs");
}
export async function validatePostgresRemoteRuntimeDiagnosticArtifact(context, dependencies = {}) {
  try {
    directory(context.output, context.uid, true);
    if (!isDeepStrictEqual(readdirSync(context.output), ["receipt.json"])) fail("postgres_remote_runtime_receipt_invalid");
    const bytes = readRegular(path.join(context.output, "receipt.json"), MAX_RECEIPT_BYTES, context.uid, true);
    const receipt = parseJson(bytes, "postgres_remote_runtime_receipt_invalid");
    if (!exactKeys(receipt, RECEIPT_KEYS) || receipt.schemaVersion !== 1 || receipt.kind !== "POSTGRES_REMOTE_RUNTIME_DIAGNOSTIC_RECEIPT_V1"
      || !["VERIFIED", "INCOMPLETE"].includes(receipt.state) || receipt.authority !== "DIAGNOSTIC_ONLY"
      || receipt.runId !== context.runId || receipt.recipeRevision !== context.recipeRevision || receipt.registryWrite !== "NOT_ATTEMPTED"
      || receipt.admission !== "NOT_AUTHORIZED" || receipt.supportStartedAt !== null || receipt.supportEndsAt !== null || receipt.archiveUntil !== null
      || !bytes.equals(Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`)) || SENSITIVE.test(bytes.toString("utf8"))) {
      fail("postgres_remote_runtime_receipt_invalid");
    }
    if (receipt.failure !== null) {
      if (unsafeCleanup({ message: receipt.failure.code, runtimeDiagnostic: receipt.failure.runtimeDiagnostic })) {
        fail("postgres_remote_runtime_cleanup_uncertain");
      }
      if ((!exactKeys(receipt.failure, ["code"]) && !exactKeys(receipt.failure, ["code", "runtimeDiagnostic"]))
        || fixedReason({ message: receipt.failure.code }) !== receipt.failure.code) fail("postgres_remote_runtime_receipt_invalid");
      if (Object.hasOwn(receipt.failure, "runtimeDiagnostic") && receipt.failure.runtimeDiagnostic !== null) {
        validatePostgresRuntimeFailureDiagnostic(receipt.failure.runtimeDiagnostic);
      }
    }
    const source = authenticatePostgresRemoteRuntimeSource(context, dependencies);
    if (receipt.subject !== source.runtimePolicy.subject || receipt.audit !== null
      && !isDeepStrictEqual(receipt.audit, auditSummary(source.runtimePolicy))) fail("postgres_remote_runtime_receipt_invalid");
    if (receipt.state === "VERIFIED") {
      if (receipt.failure !== null || receipt.audit === null || !receipt.material || !receipt.runtime) fail("postgres_remote_runtime_receipt_invalid");
      (dependencies.validateMaterialReceipt ?? remoteCandidate.validatePostgresRemoteRuntimeMaterialReceipt)(receipt.material, source.candidatePolicy);
      const module = await runtimeModule(dependencies);
      (dependencies.validateRuntimeReceipt ?? module.validatePostgresCandidateRuntimeReceipt)(receipt.runtime,
        runtimeIdentity(context, source.candidatePolicy));
      if (receipt.material.runId !== context.runId || receipt.material.recipeRevision !== context.recipeRevision
        || receipt.material.subject !== source.runtimePolicy.subject || receipt.runtime.runId !== context.runId
        || receipt.runtime.recipeRevision !== context.recipeRevision || receipt.runtime.subject !== source.runtimePolicy.subject) {
        fail("postgres_remote_runtime_receipt_invalid");
      }
    } else if (receipt.material !== null || receipt.runtime !== null || receipt.failure === null) fail("postgres_remote_runtime_receipt_invalid");
    return true;
  } catch (error) {
    if (error?.message === "postgres_remote_runtime_cleanup_uncertain") throw error;
    fail("postgres_remote_runtime_receipt_invalid");
  }
}

export async function runPostgresRemoteRuntimeDiagnostic(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) fail("postgres_remote_runtime_arguments_invalid");
  const context = requirePostgresRemoteRuntimeDiagnosticContext(env, dependencies.context);
  if (argv[0] === "cleanup") {
    cleanupRoot(context);
    await validatePostgresRemoteRuntimeDiagnosticArtifact(context, dependencies);
    return { state: "CLEANED", authority: "DIAGNOSTIC_ONLY", admission: "NOT_AUTHORIZED" };
  }
  if (pathPresent(context.output) || pathPresent(context.root)) fail("postgres_remote_runtime_output_exists");
  let source; let staged; let result; let error;
  try {
    await (dependencies.verifyMain ?? verifyPostgresRemoteAuditMain)(context, env, { commandRunner: dependencies.commandRunner,
      fetchImpl: dependencies.fetchImpl });
    source = authenticatePostgresRemoteRuntimeSource(context, dependencies);
    await (dependencies.verifyAuditApi ?? verifyPostgresRuntimeAuditApi)(source.runtimePolicy, env, {
      fetchImpl: dependencies.fetchImpl, now: dependencies.now });
    staged = stageAudit(context, source.runtimePolicy);
    replayPostgresRuntimeAudit(staged, source.runtimePolicy, context, dependencies);
    const beforeExecution = async () => {
      const current = authenticatePostgresRemoteRuntimeSource(context, dependencies);
      if (!isDeepStrictEqual(current.identities, source.identities)) fail("postgres_remote_runtime_input_uncommitted");
      replayPostgresRuntimeAudit(staged, source.runtimePolicy, context, dependencies);
      return true;
    };
    const module = await runtimeModule(dependencies);
    const provider = dependencies.materialProvider ?? remoteCandidate.withVerifiedRemotePostgresRuntimeMaterial;
    const execute = dependencies.executeRuntime ?? module.executePostgresCandidateRuntime;
    const materialParent = path.join(context.root, "material"); makeDirectory(materialParent, context);
    const verified = await provider({ parent: materialParent, policy: source.candidatePolicy, runId: context.runId,
      recipeRevision: context.recipeRevision, signal: dependencies.signal }, (snapshot) => {
      if (snapshot?.runId !== context.runId || snapshot.recipeRevision !== context.recipeRevision
        || snapshot.subject !== source.runtimePolicy.subject || snapshot.imageId !== source.candidatePolicy.candidate.imageId
        || typeof snapshot.parent !== "string" || !snapshot.parent.startsWith(`${materialParent}${path.sep}`)
        || !isDeepStrictEqual(snapshot.diffIds, source.candidatePolicy.candidate.diffIds)
        || snapshot.archiveProof?.imageId !== snapshot.imageId || !isDeepStrictEqual(snapshot.archiveProof?.diffIds, snapshot.diffIds)) {
        fail("postgres_remote_runtime_candidate_failed");
      }
      return execute(snapshot, { beforeExecution }, dependencies.runtimeDependencies);
    },
    dependencies.materialDependencies);
    (dependencies.validateMaterialReceipt ?? remoteCandidate.validatePostgresRemoteRuntimeMaterialReceipt)(verified?.material, source.candidatePolicy);
    (dependencies.validateRuntimeReceipt ?? module.validatePostgresCandidateRuntimeReceipt)(verified?.runtime,
      runtimeIdentity(context, source.candidatePolicy));
    if (verified.material.runId !== context.runId || verified.material.recipeRevision !== context.recipeRevision
      || verified.material.subject !== source.runtimePolicy.subject || verified.runtime.runId !== context.runId
      || verified.runtime.recipeRevision !== context.recipeRevision || verified.runtime.subject !== source.runtimePolicy.subject) {
      fail("postgres_remote_runtime_receipt_invalid");
    }
    result = { ...newReceipt(context, source.runtimePolicy.subject, auditSummary(source.runtimePolicy)),
      state: "VERIFIED", material: verified.material, runtime: verified.runtime };
  } catch (caught) { error = caught; }
  if (!unsafeCleanup(error)) {
    try { clearStagedAudit(context, source?.runtimePolicy, staged); }
    catch (cleanupError) { error = cleanupError; }
  }
  const receipt = error ? { ...newReceipt(context, source?.runtimePolicy.subject ?? remoteCandidate.validatePostgresRemotePolicy(
    parseJson((dependencies.readCommitted ?? committedBytes)(REMOTE_POLICY_PATH, 128 * 1024, context, dependencies.commandRunner ?? defaultCommandRunner))).subject,
  source ? auditSummary(source.runtimePolicy) : null), failure: failureRecord(error) } : result;
  writeReceipt(context, receipt);
  if (error) throw error;
  return receipt;
}
function publicFailure(error) {
  return JSON.stringify({ state: "INCOMPLETE", ...failureRecord(error),
    authority: "DIAGNOSTIC_ONLY", admission: "NOT_AUTHORIZED" });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresRemoteRuntimeDiagnostic().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(publicFailure(error)); process.exitCode = 1; });
}
export { publicFailure as TEST_ONLY_publicPostgresRemoteRuntimeFailure };
