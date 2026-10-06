import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync,
  realpathSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { executeCandidateAudit } from "../seaweed-image/candidate-audit.mjs";
import { postgresRuntimeAuditValidUntil } from "./runtime-restore-audit.mjs";
import { postgresCandidateInputDockerArguments } from "./scan.mjs";
import { validatePostgresRemoteCandidateReceipt, validatePostgresRemotePolicy,
  validatePostgresRemotePublicationReceipt, withVerifiedRemotePostgresCandidate } from "./candidate-remote.mjs";
import { evaluatePostgresRemoteAuditPolicy, projectPostgresRemoteAuditSnapshot,
  runPostgresRemoteScannerControls, validatePostgresRemoteAuditArtifact,
  validatePostgresRemoteAuditCandidateReceipt } from "./candidate-remote-audit.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKFLOW_PATH = ".github/workflows/postgres-admission-current-audit.yml";
const WORKFLOW_REF = `CleMeY15/auto-world/${WORKFLOW_PATH}@refs/heads/main`;
const MAIN_BRANCH_URL = "https://api.github.com/repos/CleMeY15/auto-world/branches/main";
const POLICY_PATH = "infra/postgres-image/candidate-remote.json";
const PUBLICATION_RECEIPT_PATH = "infra/postgres-image/candidate-publication-receipt.json";
const RAW_KIND = "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1";
const CURRENT_KIND = "POSTGRES_ADMISSION_CURRENT_AUDIT_V1";
const MiB = 1024 ** 2;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REPORT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const TOKEN_CONTROL = /[\0\r\n]/u;
const ROUTING_NAMES = Object.freeze(["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "BUILDX_CONFIG",
  "BUILDKIT_HOST", "CONTAINER_HOST"]);
const ARTIFACTS = Object.freeze({ "audit-receipt.json": 8 * MiB,
  "candidate-vulnerabilities.json": 64 * MiB, "candidate-sbom.cdx.json": 64 * MiB,
  "database-evidence.json": 8 * MiB,
  "database-vulnerability-before-manifest.json": MiB, "database-vulnerability-after-manifest.json": MiB,
  "database-java-before-manifest.json": MiB, "database-java-after-manifest.json": MiB,
  "scanner-self.json": 64 * MiB, "scanner-self.cdx.json": 64 * MiB, "scanner-version-probe.json": 64 * MiB,
  "fixture-gomod-vulnerable-candidate.json": 64 * MiB, "fixture-gomod-vulnerable-baseline.json": 64 * MiB,
  "fixture-java-war-vulnerable-candidate.json": 64 * MiB, "fixture-java-war-vulnerable-baseline.json": 64 * MiB,
  "fixture-java-jar-clean-candidate-candidate.json": 64 * MiB });
const ROLES = Object.freeze(Object.keys(ARTIFACTS).sort());

function fail(code) { throw new Error(code); }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value, keys) { return plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parseJson(bytes, code = "postgres_admission_current_audit_artifact_invalid") {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(code); }
}
function instant(value) {
  const date = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    fail("postgres_admission_current_audit_artifact_invalid");
  }
  return value;
}
function reportInstant(value) {
  const date = new Date(value);
  if (typeof value !== "string" || !REPORT_INSTANT.test(value) || !Number.isFinite(date.getTime())) {
    fail("postgres_admission_current_audit_artifact_invalid");
  }
  return value;
}
function fixedReason(error) {
  return /^(?:postgres_admission_current_audit|postgres_remote_audit|postgres_remote_candidate|postgres_remote_publication|postgres_gosu_audit|postgres_scan|seaweed_audit|scanner)_[a-z0-9_]{1,64}$/u
    .test(error?.message ?? "") ? error.message : "postgres_remote_audit_failed";
}

function scrubTokens(env) {
  const values = { GH_TOKEN: env?.GH_TOKEN, GITHUB_TOKEN: env?.GITHUB_TOKEN };
  if (env && typeof env === "object") { delete env.GH_TOKEN; delete env.GITHUB_TOKEN; }
  delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN;
  return values;
}
function captureToken(values) {
  const present = Object.entries(values).filter(([, value]) => value !== undefined);
  if (present.length !== 1 || typeof present[0][1] !== "string" || present[0][1].length < 1
    || present[0][1].length > 8192 || TOKEN_CONTROL.test(present[0][1])) {
    fail("postgres_admission_current_audit_environment_invalid");
  }
  return present[0][1];
}

export function requirePostgresAdmissionCurrentAuditContext(env, { platform = process.platform,
  uid = process.getuid?.(), gid = process.getgid?.() } = {}) {
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.GITHUB_JOB !== "audit"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || !RUN_ID.test(env.GITHUB_RUN_NUMBER ?? "") || env.GITHUB_RUN_ATTEMPT !== "1"
    || !REVISION.test(env.GITHUB_SHA ?? "") || !RUN_ID.test(env.GITHUB_RUN_ID ?? "")
    || ROUTING_NAMES.some((name) => env[name] !== undefined || process.env[name] !== undefined)
    || [env.RUNNER_TEMP, env.GITHUB_WORKSPACE].some((value) => typeof value !== "string"
      || !path.isAbsolute(value) || path.normalize(value) !== value)) {
    fail("postgres_admission_current_audit_context_invalid");
  }
  try {
    if (realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP || realpathSync(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) {
      fail("postgres_admission_current_audit_context_invalid");
    }
  } catch { fail("postgres_admission_current_audit_context_invalid"); }
  return Object.freeze({ root: path.join(env.RUNNER_TEMP, "postgres-admission-current-audit-work"),
    output: path.join(env.RUNNER_TEMP, "postgres-admission-current-audit-evidence"),
    projection: path.join(env.RUNNER_TEMP, "postgres-admission-current-audit-projection"),
    builds: path.join(env.RUNNER_TEMP, "scanner-builds"), workspace: env.GITHUB_WORKSPACE,
    runId: env.GITHUB_RUN_ID, recipeRevision: env.GITHUB_SHA, uid, gid });
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: null, env: options.env,
    maxBuffer: options.maxBuffer, timeout: options.timeoutMs, windowsHide: true });
}
function sameFile(left, right) {
  return ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]
    .every((key) => left[key] === right[key]);
}
function readBoundedRegularFile(file, cap, uid, gid, mode = 0o600, operations = {}) {
  const open = operations.open ?? openSync; const fstat = operations.fstat ?? fstatSync;
  const lstat = operations.lstat ?? lstatSync; const read = operations.read ?? readSync;
  const close = operations.close ?? closeSync;
  let handle; let uncertain = false;
  try {
    handle = open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstat(handle); const info = lstat(file);
    if (!before.isFile() || before.nlink !== 1 || info.isSymbolicLink() || before.dev !== info.dev
      || before.ino !== info.ino || !sameFile(before, info) || before.size < 2 || before.size > cap
      || uid !== undefined && (before.uid !== uid || before.gid !== gid
        || (before.mode & 0o777) !== mode)) {
      fail("postgres_admission_current_audit_artifact_invalid");
    }
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) {
      const count = read(handle, bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(count) || count < 1) fail("postgres_admission_current_audit_artifact_invalid");
      offset += count;
    }
    const probe = Buffer.alloc(1);
    if (read(handle, probe, 0, 1, before.size) !== 0) fail("postgres_admission_current_audit_artifact_invalid");
    const after = fstat(handle); const namedAfter = lstat(file);
    if (!sameFile(before, after) || !sameFile(before, namedAfter) || namedAfter.isSymbolicLink()) {
      fail("postgres_admission_current_audit_artifact_invalid");
    }
    return bytes;
  } catch (error) {
    if (error?.message === "postgres_admission_current_audit_artifact_invalid") throw error;
    fail("postgres_admission_current_audit_artifact_invalid");
  } finally {
    if (handle !== undefined) {
      try { close(handle); } catch { uncertain = true; }
    }
    if (uncertain) fail("postgres_admission_current_audit_artifact_invalid");
  }
}
function committedBytes(relative, cap, context, commandRunner) {
  if (context.workspace !== ROOT) fail("postgres_admission_current_audit_checkout_invalid");
  const bytes = readBoundedRegularFile(path.join(ROOT, ...relative.split("/")), cap);
  const result = commandRunner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: cap + 1, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout)
    || result.stdout.length > cap || !result.stdout.equals(bytes)) {
    fail("postgres_admission_current_audit_input_uncommitted");
  }
  return bytes;
}
async function readBoundedResponse(response) {
  if (response?.status !== 200 || !response.body) fail("postgres_admission_current_audit_main_invalid");
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); fail("postgres_admission_current_audit_main_invalid"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export async function verifyPostgresAdmissionCurrentAuditMain(context, token, {
  commandRunner = defaultCommandRunner, fetchImpl = globalThis.fetch, timeoutMs = 60_000,
  pathValue = process.env.PATH ?? "",
} = {}) {
  if (typeof token !== "string" || token.length < 1 || token.length > 8192 || TOKEN_CONTROL.test(token)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    fail("postgres_admission_current_audit_environment_invalid");
  }
  const options = { cwd: context.workspace, env: { PATH: pathValue, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: 256 * 1024, timeoutMs: 60_000 };
  const status = commandRunner("git", ["status", "--porcelain", "--untracked-files=normal"], options);
  const head = commandRunner("git", ["rev-parse", "HEAD"], options);
  if (status?.error || status?.status !== 0 || !Buffer.isBuffer(status.stdout) || status.stdout.length !== 0
    || head?.error || head?.status !== 0 || !Buffer.isBuffer(head.stdout)
    || head.stdout.toString("utf8").trim() !== context.recipeRevision) {
    fail("postgres_admission_current_audit_checkout_invalid");
  }
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(MAIN_BRANCH_URL, { redirect: "error", signal: controller.signal, headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "User-Agent": "auto-world-postgres-admission-current-audit", "X-GitHub-Api-Version": "2026-03-10" } });
    const branch = parseJson(await readBoundedResponse(response), "postgres_admission_current_audit_main_invalid");
    if (branch?.name !== "main" || branch?.protected !== true || branch?.commit?.sha !== context.recipeRevision) {
      fail("postgres_admission_current_audit_main_invalid");
    }
    return true;
  } catch { fail("postgres_admission_current_audit_main_invalid"); }
  finally { globalThis.clearTimeout(timer); }
}

function rawFiles(context, fileOperations) {
  const names = readdirSync(context.output).sort();
  if (!isDeepStrictEqual(names, ROLES)) fail("postgres_admission_current_audit_artifact_invalid");
  const documents = {};
  const files = names.map((role) => {
    const bytes = readBoundedRegularFile(path.join(context.output, role), ARTIFACTS[role], context.uid, context.gid,
      0o600, fileOperations);
    documents[role] = { bytes, value: parseJson(bytes) };
    return { role, size: bytes.length, sha256: sha256(bytes) };
  });
  return { documents, files };
}

export function projectPostgresAdmissionCurrentAudit(context, policy, { now = new Date(), fileOperations } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("postgres_admission_current_audit_artifact_invalid");
  const { documents, files } = rawFiles(context, fileOperations);
  const receipt = documents["audit-receipt.json"].value;
  const report = documents["candidate-vulnerabilities.json"].value;
  const evidence = documents["database-evidence.json"].value;
  if (receipt?.kind !== RAW_KIND || receipt.state !== "COMPLETE" || receipt.phase !== "COMPLETE"
    || receipt.blockerCount !== 0 || receipt.failure !== undefined || receipt.subject?.imageId !== policy.candidate.imageId
    || receipt.registrySubject !== policy.subject || !plain(report) || !plain(evidence)) {
    fail("postgres_admission_current_audit_not_eligible");
  }
  // Preserve Trivy's actual RFC3339 timestamp; admission binds this field to the retained report byte-for-byte.
  const checkedAt = reportInstant(report.CreatedAt);
  const validUntil = postgresRuntimeAuditValidUntil(evidence, report, now);
  return { kind: CURRENT_KIND, subject: policy.subject, checkedAt, validUntil,
    source: { recipeRevision: context.recipeRevision, workflowPath: WORKFLOW_PATH,
      runId: context.runId, attempt: "1" }, files };
}

export function validatePostgresAdmissionCurrentAuditArtifact(context, policy, dependencies = {}) {
  try {
    const info = lstatSync(context.projection);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== context.uid || (info.mode & 0o777) !== 0o700
      || realpathSync(context.projection) !== context.projection
      || !isDeepStrictEqual(readdirSync(context.projection), ["current-audit.json"])) {
      fail("postgres_admission_current_audit_artifact_invalid");
    }
    const bytes = readBoundedRegularFile(path.join(context.projection, "current-audit.json"), MiB, context.uid,
      context.gid, 0o600, dependencies.fileOperations);
    const value = parseJson(bytes);
    if (!exactKeys(value, ["kind", "subject", "checkedAt", "validUntil", "source", "files"])
      || value.kind !== CURRENT_KIND || value.subject !== policy.subject || reportInstant(value.checkedAt) !== value.checkedAt
      || instant(value.validUntil) !== value.validUntil
      || !exactKeys(value.source, ["recipeRevision", "workflowPath", "runId", "attempt"])
      || value.source.recipeRevision !== context.recipeRevision || value.source.workflowPath !== WORKFLOW_PATH
      || value.source.runId !== context.runId || value.source.attempt !== "1" || !Array.isArray(value.files)
      || value.files.length !== ROLES.length || value.files.some((item, index) => !exactKeys(item, ["role", "size", "sha256"])
        || item.role !== ROLES[index] || !Number.isSafeInteger(item.size) || item.size < 1 || !SHA256.test(item.sha256))) {
      fail("postgres_admission_current_audit_artifact_invalid");
    }
    const expected = projectPostgresAdmissionCurrentAudit(context, policy, {
      now: dependencies.now ?? new Date(value.checkedAt), fileOperations: dependencies.fileOperations,
    });
    if (!isDeepStrictEqual(value, expected) || !bytes.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`))) {
      fail("postgres_admission_current_audit_artifact_invalid");
    }
    return true;
  } catch { fail("postgres_admission_current_audit_artifact_invalid"); }
}

function cleanupRoot(context) {
  if (!existsSync(context.root)) return;
  const info = lstatSync(context.root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== context.uid || (info.mode & 0o777) !== 0o700
    || realpathSync(context.root) !== context.root || readdirSync(context.root).length !== 0) {
    fail("postgres_admission_current_audit_cleanup_uncertain");
  }
  rmdirSync(context.root);
}
function writePreflightFailure(context) {
  if (existsSync(context.output)) return;
  mkdirSync(context.output, { mode: 0o700 });
  const receipt = { kind: RAW_KIND, state: "INCOMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", publication: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    registryWrite: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED", runId: context.runId,
    recipeRevision: context.recipeRevision, phase: "PREPARE", containerCleanup: [], supportStartedAt: null,
    supportEndsAt: null, archiveUntil: null, failure: { code: "postgres_remote_audit_failed" } };
  writeFileSync(path.join(context.output, "audit-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: "wx", mode: 0o600 });
}
function coreIdentity(value) {
  return { dev: value.dev, ino: value.ino, uid: value.uid, gid: value.gid, mode: value.mode & 0o777 };
}
function sameCore(left, right) { return isDeepStrictEqual(coreIdentity(left), coreIdentity(right)); }
function closeCertain(handle, close) {
  try { close(handle); } catch { fail("postgres_admission_current_audit_publication_uncertain"); }
}
function removeOwnedPending(directory, directoryIdentity, file, fileIdentity, operations) {
  const lstat = operations.lstat ?? lstatSync; const readdir = operations.readdir ?? readdirSync;
  const unlink = operations.unlink ?? unlinkSync; const rmdir = operations.rmdir ?? rmdirSync;
  try {
    const currentDirectory = lstat(directory); const names = readdir(directory);
    if (!currentDirectory.isDirectory() || currentDirectory.isSymbolicLink()
      || !sameCore(currentDirectory, directoryIdentity) || !isDeepStrictEqual(names, fileIdentity ? ["current-audit.json"] : [])) {
      fail("postgres_admission_current_audit_publication_uncertain");
    }
    if (fileIdentity) {
      const currentFile = lstat(file);
      if (!currentFile.isFile() || currentFile.isSymbolicLink() || currentFile.nlink !== 1
        || !sameCore(currentFile, fileIdentity)) fail("postgres_admission_current_audit_publication_uncertain");
      unlink(file);
    }
    rmdir(directory);
  } catch { fail("postgres_admission_current_audit_publication_uncertain"); }
}
function writeProjection(context, projection, policy, dependencies = {}) {
  const operations = dependencies.operations ?? {};
  const mkdir = operations.mkdir ?? mkdirSync; const lstat = operations.lstat ?? lstatSync;
  const open = operations.open ?? openSync; const fstat = operations.fstat ?? fstatSync;
  const write = operations.write ?? writeSync; const fsync = operations.fsync ?? fsyncSync;
  const close = operations.close ?? closeSync; const rename = operations.rename ?? renameSync;
  const pending = `${context.projection}.pending-${context.runId}`;
  const file = path.join(pending, "current-audit.json");
  const parent = path.dirname(context.projection); const parentIdentity = lstat(parent);
  if (!parentIdentity.isDirectory() || parentIdentity.isSymbolicLink() || parentIdentity.uid !== context.uid
    || parentIdentity.gid !== context.gid || realpathSync(parent) !== parent) {
    fail("postgres_admission_current_audit_publication_uncertain");
  }
  if (existsSync(context.projection) || existsSync(pending)) fail("postgres_admission_current_audit_output_exists");
  let directoryIdentity; let fileIdentity; let handle; let published = false;
  try {
    mkdir(pending, { mode: 0o700 }); directoryIdentity = lstat(pending);
    if (!directoryIdentity.isDirectory() || directoryIdentity.isSymbolicLink()
      || directoryIdentity.uid !== context.uid || directoryIdentity.gid !== context.gid
      || (directoryIdentity.mode & 0o777) !== 0o700) fail("postgres_admission_current_audit_publication_uncertain");
    dependencies.afterDirectory?.(pending);
    handle = open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fileIdentity = fstat(handle);
    if (!fileIdentity.isFile() || fileIdentity.nlink !== 1 || fileIdentity.uid !== context.uid
      || fileIdentity.gid !== context.gid || (fileIdentity.mode & 0o777) !== 0o600) {
      fail("postgres_admission_current_audit_publication_uncertain");
    }
    const bytes = Buffer.from(`${JSON.stringify(projection, null, 2)}\n`); let offset = 0;
    while (offset < bytes.length) {
      const count = write(handle, bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(count) || count < 1) fail("postgres_admission_current_audit_publication_uncertain");
      offset += count;
    }
    fsync(handle); closeCertain(handle, close); handle = undefined;
    validatePostgresAdmissionCurrentAuditArtifact({ ...context, projection: pending }, policy,
      { now: dependencies.now, fileOperations: dependencies.fileOperations });
    const directoryHandle = open(pending, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsync(directoryHandle); } finally { closeCertain(directoryHandle, close); }
    dependencies.beforeRename?.(pending);
    validatePostgresAdmissionCurrentAuditArtifact({ ...context, projection: pending }, policy,
      { now: dependencies.now, fileOperations: dependencies.fileOperations });
    if (existsSync(context.projection) || !sameCore(lstat(pending), directoryIdentity)
      || !sameCore(lstat(parent), parentIdentity)) {
      fail("postgres_admission_current_audit_publication_uncertain");
    }
    rename(pending, context.projection); published = true;
    if (!sameCore(lstat(parent), parentIdentity)) fail("postgres_admission_current_audit_publication_uncertain");
    const parentHandle = open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsync(parentHandle); } finally { closeCertain(parentHandle, close); }
  } catch (error) {
    if (handle !== undefined) { try { closeCertain(handle, close); } catch { /* cleanup below proves whether removal is safe */ } }
    if (!published && directoryIdentity) removeOwnedPending(pending, directoryIdentity, file, fileIdentity, operations);
    throw error;
  }
}

export async function runPostgresAdmissionCurrentAudit(argv = process.argv.slice(2), env = process.env,
  dependencies = {}) {
  const credentialValues = scrubTokens(env);
  if (!Array.isArray(argv) || argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) {
    fail("postgres_admission_current_audit_arguments_invalid");
  }
  const context = requirePostgresAdmissionCurrentAuditContext(env, dependencies.context);
  if (argv[0] === "cleanup") {
    (dependencies.cleanupRoot ?? cleanupRoot)(context);
    (dependencies.validateRawArtifact ?? validatePostgresRemoteAuditArtifact)(context, dependencies.rawValidationDependencies);
    if (existsSync(context.projection)) {
      const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
      const readCommitted = dependencies.readCommitted ?? committedBytes;
      const policy = (dependencies.policyValidator ?? validatePostgresRemotePolicy)(parseJson(readCommitted(
        POLICY_PATH, 128 * 1024, context, commandRunner)));
      (dependencies.validateProjection ?? validatePostgresAdmissionCurrentAuditArtifact)(context, policy,
        dependencies.projectionValidationDependencies);
    }
    return { state: "CLEANED", authority: "DIAGNOSTIC_ONLY", admission: "NOT_AUTHORIZED" };
  }
  const token = captureToken(credentialValues);
  if (existsSync(context.root) || existsSync(context.output) || existsSync(context.projection)) {
    fail("postgres_admission_current_audit_output_exists");
  }
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  const verifyMain = dependencies.verifyMain ?? verifyPostgresAdmissionCurrentAuditMain;
  let policy;
  try {
    await verifyMain(context, token, { commandRunner, fetchImpl: dependencies.fetchImpl,
      timeoutMs: dependencies.timeoutMs, pathValue: env.PATH ?? "" });
    const readCommitted = dependencies.readCommitted ?? committedBytes;
    policy = (dependencies.policyValidator ?? validatePostgresRemotePolicy)(parseJson(readCommitted(
      POLICY_PATH, 128 * 1024, context, commandRunner)));
    (dependencies.publicationReceiptValidator ?? validatePostgresRemotePublicationReceipt)(parseJson(readCommitted(
      PUBLICATION_RECEIPT_PATH, MiB, context, commandRunner)), policy);
    const provider = dependencies.remoteProvider ?? withVerifiedRemotePostgresCandidate;
    const providerDependencies = { ...(dependencies.remoteProviderDependencies ?? {}),
      env: { GITHUB_TOKEN: token, PATH: env.PATH ?? "" } };
    const materialize = ({ parent, runId, recipeRevision, signal }, inspect) => provider({ parent, policy, runId,
      recipeRevision, signal }, inspect, providerDependencies);
    const validateCandidateReceipt = (receipt, proof, selectedContext) => validatePostgresRemoteAuditCandidateReceipt(
      receipt, proof, selectedContext, policy,
      dependencies.remoteReceiptValidator ?? validatePostgresRemoteCandidateReceipt);
    const receipt = await (dependencies.executeAudit ?? executeCandidateAudit)(context, {
      ...(dependencies.auditDependencies ?? {}), auditKind: RAW_KIND, materialize, validateCandidateReceipt,
      inputArguments: postgresCandidateInputDockerArguments,
      scannerControls: (input) => runPostgresRemoteScannerControls(input, dependencies.scannerControlDependencies),
      projectSnapshot: (snapshot, selectedContext) => projectPostgresRemoteAuditSnapshot(snapshot, context, policy, selectedContext),
      evaluatePolicy: (input) => evaluatePostgresRemoteAuditPolicy(input, context, dependencies.evaluatePolicy),
    });
    (dependencies.cleanupRoot ?? cleanupRoot)(context);
    (dependencies.validateRawArtifact ?? validatePostgresRemoteAuditArtifact)(context, dependencies.rawValidationDependencies);
    await verifyMain(context, token, { commandRunner, fetchImpl: dependencies.fetchImpl,
      timeoutMs: dependencies.timeoutMs, pathValue: env.PATH ?? "" });
    const projection = (dependencies.projectCurrentAudit ?? projectPostgresAdmissionCurrentAudit)(context, policy,
      { now: dependencies.now?.() ?? new Date() });
    (dependencies.writeProjection ?? writeProjection)(context, projection, policy,
      { ...(dependencies.projectionWriterDependencies ?? {}), now: dependencies.now?.() ?? new Date() });
    (dependencies.validateProjection ?? validatePostgresAdmissionCurrentAuditArtifact)(context, policy,
      { ...(dependencies.projectionValidationDependencies ?? {}), now: dependencies.now?.() ?? new Date() });
    return { ...receipt, currentAudit: projection };
  } catch (error) {
    if (existsSync(context.root)) (dependencies.cleanupRoot ?? cleanupRoot)(context);
    if (!existsSync(context.output)) writePreflightFailure(context);
    if (existsSync(context.output)) {
      (dependencies.validateRawArtifact ?? validatePostgresRemoteAuditArtifact)(context, dependencies.rawValidationDependencies);
    }
    throw error;
  }
}

function publicFailure(error) {
  return JSON.stringify({ state: "FAILED", reason: fixedReason(error), authority: "DIAGNOSTIC_ONLY",
    admission: "NOT_AUTHORIZED" });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresAdmissionCurrentAudit().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(publicFailure(error)); process.exitCode = 1; });
}
export { publicFailure as TEST_ONLY_publicPostgresAdmissionCurrentAuditFailure };
