import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, realpathSync,
  readSync, readdirSync, rmSync, statfsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { validateSavedSeaweedCandidate } from "./candidate-archive.mjs";
import { validateRemoteAuditFilesystem, validateRemoteAuditRuntimeConfig } from
  "./candidate-remote-audit.mjs";
import { validateRemoteAuditEvidence } from "./candidate-remote-runtime-diagnostic.mjs";
import { validateRemoteSeaweedCandidatePolicy } from "./candidate-remote.mjs";
import { validateRemoteSeaweedRuntimeCandidateReceipt } from "./candidate-remote-runtime.mjs";
import {
  isPublicSeaweedRuntimePhase, isPublicSeaweedRuntimeReason,
  validateSeaweedRuntimePersistenceProof, validateSeaweedRuntimeProfileProof,
  validateSeaweedRuntimeStrictContentionProof, verifyLocalSeaweedRuntimeProfile,
  verifyLocalSeaweedRuntimeRestartPersistence, verifyLocalSeaweedRuntimeStrictContention,
} from "./candidate-runtime.mjs";
import { validateSeaweedRuntimeBackupRestoreProof, verifyLocalSeaweedRuntimeBackupRestore } from
  "./backup-restore.mjs";
import { isPublicSeaweedHostLoopbackPhase, isPublicSeaweedHostLoopbackReason,
  validateSeaweedRuntimeHostLoopbackProof, verifyLocalSeaweedRuntimeHostLoopback } from
  "./host-loopback.mjs";

const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const TAG = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const EXT4_MAGIC = 0xef53;
const MAX_OUTPUT_BYTES = 1024 ** 2;
const COMMAND_TIMEOUT_MS = 15 * 60_000;
const CLEANUP_TIMEOUT_MS = 4 * 60_000;
const PUBLIC_FAILURE_CODES = new Set([
  "seaweed_local_restore_arguments_invalid", "seaweed_local_restore_private_storage_invalid",
  "seaweed_local_restore_context_invalid", "seaweed_local_restore_evidence_invalid",
  "seaweed_local_restore_archive_invalid", "seaweed_local_restore_archive_changed",
  "seaweed_local_restore_docker_command_failed", "seaweed_local_restore_engine_invalid",
  "seaweed_local_restore_engine_not_empty", "seaweed_local_restore_inventory_invalid",
  "seaweed_local_restore_image_invalid", "seaweed_local_restore_runtime_invalid",
  "seaweed_local_restore_cleanup_failed", "seaweed_local_restore_receipt_invalid",
  "seaweed_candidate_runtime_failed", "seaweed_candidate_runtime_cleanup_failed",
  "seaweed_candidate_runtime_persistence_failed", "seaweed_candidate_runtime_persistence_cleanup_failed",
  "seaweed_candidate_runtime_backup_restore_failed", "seaweed_candidate_runtime_backup_restore_cleanup_failed",
  "seaweed_candidate_runtime_host_loopback_failed", "seaweed_candidate_runtime_host_loopback_cleanup_failed",
]);
const SUCCESS_PHASES = Object.freeze(["prior_evidence", "private_storage", "archive_validation_before_load",
  "engine_preflight", "archive_load", "archive_validation_after_load", "runtime_basic",
  "runtime_persistence", "runtime_strict", "runtime_backup", "runtime_host_loopback",
  "runtime_inventory", "owned_cleanup", "temporary_cleanup"]);

function fail(code, fields) {
  const error = new Error(code);
  if (fields !== undefined) Object.assign(error, fields);
  throw error;
}
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, cloneFrozen(item)])));
  return value;
}
function sameStat(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid
    && left.gid === right.gid && left.mode === right.mode && left.nlink === right.nlink
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function signalValid(signal) {
  return signal === undefined || signal instanceof globalThis.AbortSignal;
}

function validateInput(value) {
  const keys = ["parent", "archiveFile", "archiveSha256", "archiveBytes", "archiveTag", "policy",
    "baseline", "auditEvidence", "runtimeReceipt", "runId", "recipeRevision", "signal"];
  if (!exactKeys(value, keys) || typeof value.parent !== "string" || !path.isAbsolute(value.parent)
    || path.normalize(value.parent) !== value.parent || typeof value.archiveFile !== "string"
    || !path.isAbsolute(value.archiveFile) || path.normalize(value.archiveFile) !== value.archiveFile
    || !SHA256.test(value.archiveSha256) || !Number.isSafeInteger(value.archiveBytes)
    || value.archiveBytes < 1024 || value.archiveBytes > 2 * 1024 ** 3 || !TAG.test(value.archiveTag)
    || !plain(value.baseline) || !plain(value.auditEvidence) || !plain(value.runtimeReceipt)
    || !RUN_ID.test(value.runId) || !REVISION.test(value.recipeRevision) || !signalValid(value.signal)) {
    fail("seaweed_local_restore_arguments_invalid");
  }
  return { ...value, policy: validateRemoteSeaweedCandidatePolicy(value.policy) };
}

function assertPrivateExt4(input, uid = process.getuid?.(), statfs = statfsSync) {
  if (!Number.isSafeInteger(uid) || uid < 0) fail("seaweed_local_restore_private_storage_invalid");
  try {
    const parent = lstatSync(input.parent, { bigint: true });
    const archive = lstatSync(input.archiveFile, { bigint: true });
    if (!parent.isDirectory() || parent.isSymbolicLink() || Number(parent.uid) !== uid
      || (Number(parent.mode) & 0o777) !== 0o700 || realpathSync(input.parent) !== input.parent
      || readdirSync(input.parent).length !== 0 || !archive.isFile() || archive.isSymbolicLink()
      || Number(archive.uid) !== uid || Number(archive.nlink) !== 1
      || (Number(archive.mode) & 0o077) !== 0 || Number(archive.size) !== input.archiveBytes
      || realpathSync(input.archiveFile) !== input.archiveFile
      || Number(statfs(input.parent).type) !== EXT4_MAGIC
      || Number(statfs(input.archiveFile).type) !== EXT4_MAGIC) {
      fail("seaweed_local_restore_private_storage_invalid");
    }
  } catch (error) {
    if (error?.message === "seaweed_local_restore_private_storage_invalid") throw error;
    fail("seaweed_local_restore_private_storage_invalid");
  }
}

function validateOpenedArchive(handle, input, uid) {
  const opened = fstatSync(handle, { bigint: true });
  const current = lstatSync(input.archiveFile, { bigint: true });
  if (!opened.isFile() || Number(opened.nlink) !== 1 || Number(opened.uid) !== uid
    || (Number(opened.mode) & 0o077) !== 0 || Number(opened.size) !== input.archiveBytes
    || !sameStat(opened, current)) fail("seaweed_local_restore_archive_changed");
  return opened;
}

function bounded(value) {
  if (!plain(value) || value.error !== undefined && value.error !== null || value.status !== 0
    || typeof value.stdout !== "string" || typeof value.stderr !== "string"
    || Buffer.byteLength(value.stdout) + Buffer.byteLength(value.stderr) > MAX_OUTPUT_BYTES
    || value.stderr.trim() !== "") fail("seaweed_local_restore_docker_command_failed");
  return value.stdout.trim();
}

function observed(value) {
  if (!plain(value) || typeof value.stdout !== "string" || typeof value.stderr !== "string"
    || Buffer.byteLength(value.stdout) + Buffer.byteLength(value.stderr) > MAX_OUTPUT_BYTES) {
    fail("seaweed_local_restore_docker_command_failed");
  }
  return value;
}

function hashFd(fd, bytes) {
  const hash = createHash("sha256"); const chunk = Buffer.allocUnsafe(1024 ** 2); let position = 0;
  while (position < bytes) {
    const length = Math.min(chunk.length, bytes - position);
    const count = readSync(fd, chunk, 0, length, position);
    if (count !== length) fail("seaweed_local_restore_archive_changed");
    hash.update(chunk.subarray(0, count)); position += count;
  }
  return hash.digest("hex");
}

function defaultDocker(args, options) {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { cwd: options.cwd, env: options.env, windowsHide: true,
      stdio: [options.inputFd === undefined ? "ignore" : options.inputFd, "pipe", "pipe"] });
    const chunks = { stdout: [], stderr: [] }; let size = 0; let killed = false;
    const collect = (name, bytes) => {
      size += bytes.length;
      if (size > MAX_OUTPUT_BYTES) { killed = true; child.kill("SIGKILL"); return; }
      chunks[name].push(bytes);
    };
    child.stdout.on("data", (bytes) => collect("stdout", bytes));
    child.stderr.on("data", (bytes) => collect("stderr", bytes));
    const abort = () => { killed = true; child.kill("SIGKILL"); };
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = globalThis.setTimeout(() => { killed = true; child.kill("SIGKILL"); }, options.timeoutMs);
    child.on("error", (error) => resolve({ error, status: null, stdout: "", stderr: "" }));
    child.on("close", (status) => {
      globalThis.clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      resolve({ ...(killed ? { error: new Error("bounded") } : {}), status,
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8") });
    });
  });
}

async function inventory(dependencies, options) {
  const images = bounded(await dependencies.docker(
    ["image", "ls", "--all", "--quiet", "--no-trunc"], options)).split(/\r?\n/u).filter(Boolean).sort();
  const containers = bounded(await dependencies.docker(
    ["container", "ls", "--all", "--quiet", "--no-trunc"], options)).split(/\r?\n/u).filter(Boolean).sort();
  const volumes = bounded(await dependencies.docker(
    ["volume", "ls", "--quiet"], options)).split(/\r?\n/u).filter(Boolean).sort();
  return { images, containers, volumes };
}

function validateEmptyInventory(value) {
  if (value.images.length !== 0 || value.containers.length !== 0 || value.volumes.length !== 0) {
    fail("seaweed_local_restore_engine_not_empty");
  }
}

function validateLoadedInventory(value, imageId) {
  if (JSON.stringify(value.images) !== JSON.stringify([imageId])
    || value.containers.length !== 0 || value.volumes.length !== 0) {
    fail("seaweed_local_restore_inventory_invalid");
  }
}

function validateDockerInfo(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { fail("seaweed_local_restore_engine_invalid"); }
  const driverStatus = Array.isArray(value?.DriverStatus) ? value.DriverStatus : [];
  if (value?.OSType !== "linux" || value.Architecture !== "x86_64" || value.Driver !== "overlay2"
    || driverStatus.some((entry) => Array.isArray(entry) && entry[0] === "driver-type"
      && String(entry[1]).includes("containerd.snapshotter"))) fail("seaweed_local_restore_engine_invalid");
}

function validateImageInspect(raw, input) {
  let image;
  try { image = JSON.parse(raw); } catch { fail("seaweed_local_restore_image_invalid"); }
  if (!plain(image) || image.Id !== input.policy.candidate.imageId
    || JSON.stringify(image.RepoTags) !== JSON.stringify([input.archiveTag])
    || (![null, undefined].includes(image.RepoDigests) && JSON.stringify(image.RepoDigests) !== "[]")
    || image.Os !== "linux" || image.Architecture !== "amd64"
    || !Number.isSafeInteger(image.Size) || image.Size < 1 || image.Size > 2 * 1024 ** 3
    || !plain(image.RootFS) || image.RootFS.Type !== "layers"
    || JSON.stringify(image.RootFS.Layers) !== JSON.stringify([input.policy.candidate.diffId])
    || !plain(image.Config)) fail("seaweed_local_restore_image_invalid");
  try { validateRemoteAuditRuntimeConfig(image.Config, input.baseline); }
  catch { fail("seaweed_local_restore_image_invalid"); }
  return image;
}

function archiveOptions(input) {
  return { file: input.archiveFile, imageId: input.policy.candidate.imageId, tag: input.archiveTag,
    diffId: input.policy.candidate.diffId, rawSize: input.policy.candidate.rawSize,
    memberCount: input.policy.candidate.memberCount, serverVersion: "28.0.4",
    validateFilesystem: (entries) => validateRemoteAuditFilesystem(entries, input.policy),
    validateRuntimeConfig: (config) => validateRemoteAuditRuntimeConfig(config, input.baseline),
    signal: input.signal };
}

function validateArchiveProof(proof, input) {
  if (!plain(proof) || proof.kind !== "SEAWEED_SAVED_CANDIDATE_PROOF_V1"
    || proof.authority !== "PREPARATION_ONLY" || proof.candidateAuthorization !== "NOT_AUTHORIZED"
    || proof.imageId !== input.policy.candidate.imageId || proof.diffId !== input.policy.candidate.diffId
    || proof.tag !== input.archiveTag || proof.serverVersion !== "28.0.4"
    || proof.archiveSha256 !== input.archiveSha256 || proof.archiveBytes !== input.archiveBytes
    || proof.rawSize !== input.policy.candidate.rawSize
    || proof.memberCount !== input.policy.candidate.memberCount) fail("seaweed_local_restore_archive_invalid");
  return cloneFrozen(proof);
}

function validateEvidence(input, dependencies) {
  const evidence = dependencies.validateAuditEvidence({ runtimePolicy: input.auditEvidence.runtimePolicy,
    receiptBytes: input.auditEvidence.receiptBytes,
    vulnerabilityBytes: input.auditEvidence.vulnerabilityBytes,
    cyclonedxBytes: input.auditEvidence.cyclonedxBytes,
    databaseEvidenceBytes: input.auditEvidence.databaseEvidenceBytes,
    databaseManifestBytes: input.auditEvidence.databaseManifestBytes, candidatePolicy: input.policy });
  const audit = evidence?.runtimePolicy?.audit;
  if (!plain(audit)) fail("seaweed_local_restore_evidence_invalid");
  const binding = { kind: "SEAWEED_REMOTE_AUDIT_BINDING_V1", state: "COMPLETE",
    subject: input.policy.subject, runId: audit.runId, runNumber: "1",
    runAttempt: "1", recipeRevision: audit.recipeRevision,
    artifact: audit.artifact, files: audit.files };
  try { dependencies.validateRuntimeReceipt(input.runtimeReceipt, input.policy, binding); }
  catch { fail("seaweed_local_restore_evidence_invalid"); }
  return cloneFrozen({ auditBinding: binding, priorRuntimeRunId: input.runtimeReceipt.runId,
    priorRuntimeRecipeRevision: input.runtimeReceipt.recipeRevision });
}

function publicFailure(error) {
  const value = typeof error?.code === "string" ? error.code : error?.message;
  return PUBLIC_FAILURE_CODES.has(value) ? value : "seaweed_local_restore_runtime_invalid";
}

function publicRuntimeDiagnostic(error) {
  const code = publicFailure(error);
  if (code === "seaweed_local_restore_runtime_invalid") return null;
  const host = code.includes("host_loopback");
  const phase = host ? isPublicSeaweedHostLoopbackPhase(error?.phase)
    : isPublicSeaweedRuntimePhase(error?.phase);
  const reason = host ? isPublicSeaweedHostLoopbackReason(error?.reason)
    : isPublicSeaweedRuntimeReason(error?.reason);
  if (!phase && !reason) return null;
  return cloneFrozen({ code, phase: phase ? error.phase : null, reason: reason ? error.reason : null });
}

const LOCAL_PHASES = new Set(["ARCHIVE_BEFORE_LOAD", "ENGINE_PREFLIGHT", "ARCHIVE_LOAD",
  "ARCHIVE_AFTER_LOAD", "RUNTIME_BASIC", "RUNTIME_PERSISTENCE", "RUNTIME_STRICT",
  "RUNTIME_BACKUP", "RUNTIME_HOST_LOOPBACK", "RUNTIME_INVENTORY", "OWNED_CLEANUP",
  "TEMPORARY_CLEANUP"]);

export function publicLocalRestoreFailure(error) {
  const wrapped = error?.code === "seaweed_local_restore_failed";
  const code = wrapped ? "seaweed_local_restore_failed" : publicFailure(error);
  return cloneFrozen({ kind: "SEAWEED_LOCAL_RESTORE_FAILURE_V1", state: "FAILED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
    origin: "LOCAL_DIAGNOSTIC", code, phase: LOCAL_PHASES.has(error?.phase) ? error.phase : null,
    primaryFailure: wrapped && typeof error.primaryFailure === "string"
      ? publicFailure({ message: error.primaryFailure }) : code,
    cleanupFailure: wrapped && error.cleanupFailure === "seaweed_local_restore_cleanup_failed"
      ? error.cleanupFailure : null,
    diagnosticFailure: wrapped && plain(error.diagnosticFailure) ? publicRuntimeDiagnostic(error.diagnosticFailure)
      : publicRuntimeDiagnostic(error) });
}

function validateDependencies(value) {
  const allowed = ["platform", "uid", "statfs", "privateStorageValidator", "openedArchiveValidator",
    "docker", "validateArchive", "validateAuditEvidence",
    "validateRuntimeReceipt", "verifyRuntime", "verifyPersistence", "verifyStrict", "verifyBackup",
    "verifyHostLoopback"];
  if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    fail("seaweed_local_restore_arguments_invalid");
  }
  return { platform: value.platform ?? process.platform, uid: value.uid ?? process.getuid?.(),
    statfs: value.statfs ?? statfsSync,
    privateStorageValidator: value.privateStorageValidator ?? assertPrivateExt4,
    openedArchiveValidator: value.openedArchiveValidator ?? validateOpenedArchive,
    docker: value.docker ?? defaultDocker,
    validateArchive: value.validateArchive ?? validateSavedSeaweedCandidate,
    validateAuditEvidence: value.validateAuditEvidence ?? validateRemoteAuditEvidence,
    validateRuntimeReceipt: value.validateRuntimeReceipt ?? validateRemoteSeaweedRuntimeCandidateReceipt,
    verifyRuntime: value.verifyRuntime ?? verifyLocalSeaweedRuntimeProfile,
    verifyPersistence: value.verifyPersistence ?? verifyLocalSeaweedRuntimeRestartPersistence,
    verifyStrict: value.verifyStrict ?? verifyLocalSeaweedRuntimeStrictContention,
    verifyBackup: value.verifyBackup ?? verifyLocalSeaweedRuntimeBackupRestore,
    verifyHostLoopback: value.verifyHostLoopback ?? verifyLocalSeaweedRuntimeHostLoopback };
}

function validateSuite(suite, expected) {
  if (!exactKeys(suite, ["basic", "persistence", "strict", "backup", "hostLoopback"])
    || !exactKeys(suite.strict, ["runtimeProof", "strictProof"])) fail("seaweed_local_restore_runtime_invalid");
  try {
    const basic = validateSeaweedRuntimeProfileProof(suite.basic, expected);
    const persistence = validateSeaweedRuntimePersistenceProof(suite.persistence, expected);
    const strictRuntime = validateSeaweedRuntimeProfileProof(suite.strict.runtimeProof, expected);
    const strictProof = validateSeaweedRuntimeStrictContentionProof(suite.strict.strictProof, expected);
    const backup = validateSeaweedRuntimeBackupRestoreProof(suite.backup, expected);
    const hostLoopback = validateSeaweedRuntimeHostLoopbackProof(suite.hostLoopback, expected);
    return cloneFrozen({ basic, persistence, strict: { runtimeProof: strictRuntime, strictProof },
      backup, hostLoopback });
  } catch { fail("seaweed_local_restore_runtime_invalid"); }
}

export function validateLocalSeaweedRestoreReceipt(receipt, expected) {
  if (!exactKeys(expected, ["imageId", "archiveSha256", "archiveBytes", "runId", "recipeRevision",
    "subject", "auditBinding", "priorRuntimeRunId", "priorRuntimeRecipeRevision"])
    || !IMAGE_ID.test(expected.imageId) || !SHA256.test(expected.archiveSha256)
    || !Number.isSafeInteger(expected.archiveBytes) || !RUN_ID.test(expected.runId)
    || !REVISION.test(expected.recipeRevision) || typeof expected.subject !== "string"
    || !plain(expected.auditBinding) || !RUN_ID.test(expected.priorRuntimeRunId)
    || !REVISION.test(expected.priorRuntimeRecipeRevision)
    || !exactKeys(receipt, ["kind", "state", "authority", "candidateAuthorization", "admission",
      "origin", "executionId", "githubRunId", "runId", "recipeRevision", "registryAccess",
      "registryFallback", "subject", "engine", "archive", "image", "priorEvidence", "suite",
      "phases", "cleanup"])) {
    fail("seaweed_local_restore_receipt_invalid");
  }
  if (receipt.kind !== "SEAWEED_LOCAL_RESTORE_RECEIPT_V1" || receipt.state !== "VERIFIED"
    || receipt.authority !== "DIAGNOSTIC_ONLY" || receipt.candidateAuthorization !== "NOT_AUTHORIZED"
    || receipt.admission !== "NOT_AUTHORIZED" || receipt.origin !== "LOCAL_DIAGNOSTIC"
    || receipt.executionId !== `local-${expected.runId}` || receipt.githubRunId !== null
    || receipt.runId !== expected.runId || receipt.recipeRevision !== expected.recipeRevision
    || receipt.registryAccess !== "NOT_ATTEMPTED" || receipt.registryFallback !== "DISABLED"
    || receipt.subject !== expected.subject
    || receipt.engine !== "DOCKER_28.0.4_CLASSIC_LOCAL"
    || !exactKeys(receipt.archive, ["state", "sha256", "bytes", "loadResponse"])
    || !exactKeys(receipt.image, ["imageId", "identityType", "repoDigestExpectation"])
    || receipt.archive?.state !== "VALIDATED_BEFORE_AND_AFTER_LOAD"
    || receipt.archive.sha256 !== expected.archiveSha256 || receipt.archive.bytes !== expected.archiveBytes
    || receipt.archive.loadResponse !== "SUCCESS"
    || receipt.image?.imageId !== expected.imageId || receipt.image?.identityType !== "CLASSIC_CONFIG_ID"
    || receipt.image?.repoDigestExpectation !== "NOT_APPLICABLE_TO_SAVED_ARCHIVE_RESTORE"
    || !exactKeys(receipt.priorEvidence, ["auditBinding", "priorRuntimeRunId",
      "priorRuntimeRecipeRevision"])
    || JSON.stringify(receipt.priorEvidence.auditBinding) !== JSON.stringify(expected.auditBinding)
    || receipt.priorEvidence.priorRuntimeRunId !== expected.priorRuntimeRunId
    || receipt.priorEvidence.priorRuntimeRecipeRevision !== expected.priorRuntimeRecipeRevision
    || !Array.isArray(receipt.phases) || JSON.stringify(receipt.phases.map((item) => item?.name))
      !== JSON.stringify(SUCCESS_PHASES)
    || receipt.phases.some((item) => !exactKeys(item, ["name", "result", "durationMs"])
      || item.result !== "PASSED" || !Number.isSafeInteger(item.durationMs)
      || item.durationMs < 0 || item.durationMs > 10_800_000)
    || receipt.cleanup !== "OWNED_IMAGE_AND_TEMPORARY_STATE_REMOVED") {
    fail("seaweed_local_restore_receipt_invalid");
  }
  validateSuite(receipt.suite, { imageId: expected.imageId, runId: expected.runId,
    recipeRevision: expected.recipeRevision });
  return cloneFrozen(receipt);
}

export async function restoreLocalSeaweedCandidate(inputValue, dependencyValue = {}) {
  const input = validateInput(inputValue); const dependencies = validateDependencies(dependencyValue);
  if (dependencies.platform !== "linux" || input.signal?.aborted) fail("seaweed_local_restore_context_invalid");
  const phases = [];
  const timed = async (name, operation) => {
    const started = performance.now();
    const result = await operation();
    phases.push(Object.freeze({ name, result: "PASSED",
      durationMs: Math.min(10_800_000, Math.max(0, Math.floor(performance.now() - started))) }));
    return result;
  };
  const priorEvidence = await timed("prior_evidence", () => validateEvidence(input, dependencies));
  await timed("private_storage", () => dependencies.privateStorageValidator(
    input, dependencies.uid, dependencies.statfs));
  const archiveHandle = openSync(input.archiveFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  const opened = dependencies.openedArchiveValidator(archiveHandle, input, dependencies.uid);
  const work = path.join(input.parent, `local-${input.runId}`);
  const dockerConfig = path.join(work, "docker-config");
  let imageOwned = false; let primaryFailure; let failurePhase; let suite; let archiveProof;
  let phase = "ARCHIVE_BEFORE_LOAD";
  const env = { PATH: process.env.PATH ?? "", DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: "unix:///var/run/docker.sock", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
    TMPDIR: work };
  const options = { cwd: work, env, signal: input.signal, timeoutMs: COMMAND_TIMEOUT_MS };
  try {
    mkdirSync(work, { mode: 0o700 }); mkdirSync(dockerConfig, { mode: 0o700 });
    if (input.signal?.aborted) fail("seaweed_local_restore_context_invalid");
    archiveProof = await timed("archive_validation_before_load", async () => validateArchiveProof(
      await dependencies.validateArchive(archiveOptions(input)), input));
    if (!sameStat(opened, fstatSync(archiveHandle, { bigint: true }))
      || !sameStat(opened, lstatSync(input.archiveFile, { bigint: true }))
      || hashFd(archiveHandle, input.archiveBytes) !== input.archiveSha256) {
      fail("seaweed_local_restore_archive_changed");
    }
    phase = "ENGINE_PREFLIGHT";
    await timed("engine_preflight", async () => {
      const version = bounded(await dependencies.docker(["version", "--format",
        "{{.Client.Version}}|{{.Server.Version}}"], options));
      if (version !== "28.0.4|28.0.4") fail("seaweed_local_restore_engine_invalid");
      validateDockerInfo(bounded(await dependencies.docker(["info", "--format", "{{json .}}"], options)));
      validateEmptyInventory(await inventory(dependencies, options));
    });
    phase = "ARCHIVE_LOAD";
    await timed("archive_load", async () => {
      const loadResult = observed(await dependencies.docker(["image", "load"],
        { ...options, inputFd: archiveHandle }));
      if (!sameStat(opened, fstatSync(archiveHandle, { bigint: true }))
        || !sameStat(opened, lstatSync(input.archiveFile, { bigint: true }))) {
        fail("seaweed_local_restore_archive_changed");
      }
      validateLoadedInventory(await inventory(dependencies, options), input.policy.candidate.imageId);
      imageOwned = true;
      const inspect = bounded(await dependencies.docker(["image", "inspect", "--format", "{{json .}}",
        input.policy.candidate.imageId], options));
      validateImageInspect(inspect, input);
      if (loadResult.error !== undefined && loadResult.error !== null || loadResult.status !== 0) {
        fail("seaweed_local_restore_docker_command_failed");
      }
    });
    phase = "ARCHIVE_AFTER_LOAD";
    const afterLoad = await timed("archive_validation_after_load", async () => validateArchiveProof(
      await dependencies.validateArchive(archiveOptions(input)), input));
    if (JSON.stringify(afterLoad) !== JSON.stringify(archiveProof)
      || !sameStat(opened, fstatSync(archiveHandle, { bigint: true }))
      || !sameStat(opened, lstatSync(input.archiveFile, { bigint: true }))) {
      fail("seaweed_local_restore_archive_changed");
    }
    const runtimeInput = { parent: work, dockerConfig, imageId: input.policy.candidate.imageId,
      runId: input.runId, recipeRevision: input.recipeRevision, signal: input.signal };
    const expected = { imageId: runtimeInput.imageId, runId: input.runId,
      recipeRevision: input.recipeRevision };
    phase = "RUNTIME_BASIC";
    const basic = await timed("runtime_basic", async () => validateSeaweedRuntimeProfileProof(
      await dependencies.verifyRuntime(runtimeInput), expected));
    phase = "RUNTIME_PERSISTENCE";
    const persistence = await timed("runtime_persistence", async () => validateSeaweedRuntimePersistenceProof(
      await dependencies.verifyPersistence(runtimeInput), expected));
    phase = "RUNTIME_STRICT";
    const strict = await timed("runtime_strict", async () => {
      const strictValue = await dependencies.verifyStrict(runtimeInput);
      return { runtimeProof: validateSeaweedRuntimeProfileProof(strictValue.runtimeProof, expected),
        strictProof: validateSeaweedRuntimeStrictContentionProof(strictValue.strictContentionProof, expected) };
    });
    phase = "RUNTIME_BACKUP";
    const backup = await timed("runtime_backup", async () => validateSeaweedRuntimeBackupRestoreProof(
      await dependencies.verifyBackup(runtimeInput), expected));
    phase = "RUNTIME_HOST_LOOPBACK";
    const hostLoopback = await timed("runtime_host_loopback", async () => validateSeaweedRuntimeHostLoopbackProof(
      await dependencies.verifyHostLoopback(runtimeInput), expected));
    suite = validateSuite({ basic, persistence, strict, backup, hostLoopback }, expected);
    phase = "RUNTIME_INVENTORY";
    await timed("runtime_inventory", async () => validateLoadedInventory(
      await inventory(dependencies, options), input.policy.candidate.imageId));
  } catch (error) { primaryFailure = error; failurePhase = phase; }
  let cleanupFailure;
  try {
    phase = "OWNED_CLEANUP";
    if (imageOwned) {
      const cleanupStarted = performance.now();
      validateLoadedInventory(await inventory(dependencies,
        { ...options, signal: undefined, timeoutMs: CLEANUP_TIMEOUT_MS }), input.policy.candidate.imageId);
      const inspect = bounded(await dependencies.docker(["image", "inspect", "--format", "{{json .}}",
        input.policy.candidate.imageId], { ...options, signal: undefined, timeoutMs: CLEANUP_TIMEOUT_MS }));
      validateImageInspect(inspect, input);
      bounded(await dependencies.docker(["image", "rm", input.archiveTag],
        { ...options, signal: undefined, timeoutMs: CLEANUP_TIMEOUT_MS }));
      validateEmptyInventory(await inventory(dependencies,
        { ...options, signal: undefined, timeoutMs: CLEANUP_TIMEOUT_MS }));
      phases.push(Object.freeze({ name: "owned_cleanup", result: "PASSED",
        durationMs: Math.min(10_800_000, Math.max(0, Math.floor(performance.now() - cleanupStarted))) }));
    }
  } catch { cleanupFailure = new Error("seaweed_local_restore_cleanup_failed"); }
  closeSync(archiveHandle);
  try {
    phase = "TEMPORARY_CLEANUP";
    const cleanupStarted = performance.now();
    if (realpathSync(work) !== work || path.dirname(work) !== input.parent) {
      fail("seaweed_local_restore_cleanup_failed");
    }
    rmSync(work, { recursive: true, force: false });
    if (readdirSync(input.parent).length !== 0) fail("seaweed_local_restore_cleanup_failed");
    phases.push(Object.freeze({ name: "temporary_cleanup", result: "PASSED",
      durationMs: Math.min(10_800_000, Math.max(0, Math.floor(performance.now() - cleanupStarted))) }));
  } catch { cleanupFailure ??= new Error("seaweed_local_restore_cleanup_failed"); }
  if (cleanupFailure !== undefined) fail("seaweed_local_restore_failed", {
    code: "seaweed_local_restore_failed", primaryFailure: primaryFailure === undefined
      ? null : publicFailure(primaryFailure),
    cleanupFailure: "seaweed_local_restore_cleanup_failed", phase: failurePhase ?? phase,
    diagnosticFailure: primaryFailure === undefined ? null : publicRuntimeDiagnostic(primaryFailure) });
  if (primaryFailure !== undefined) fail("seaweed_local_restore_failed", {
    code: "seaweed_local_restore_failed", primaryFailure: publicFailure(primaryFailure), cleanupFailure: null,
    phase: failurePhase, diagnosticFailure: publicRuntimeDiagnostic(primaryFailure) });
  return validateLocalSeaweedRestoreReceipt({ kind: "SEAWEED_LOCAL_RESTORE_RECEIPT_V1", state: "VERIFIED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
    origin: "LOCAL_DIAGNOSTIC", executionId: `local-${input.runId}`, githubRunId: null,
    runId: input.runId, recipeRevision: input.recipeRevision, registryAccess: "NOT_ATTEMPTED",
    registryFallback: "DISABLED", engine: "DOCKER_28.0.4_CLASSIC_LOCAL",
    archive: { state: "VALIDATED_BEFORE_AND_AFTER_LOAD", sha256: archiveProof.archiveSha256,
      bytes: archiveProof.archiveBytes, loadResponse: "SUCCESS" }, subject: input.policy.subject,
    image: { imageId: input.policy.candidate.imageId,
      identityType: "CLASSIC_CONFIG_ID", repoDigestExpectation: "NOT_APPLICABLE_TO_SAVED_ARCHIVE_RESTORE" },
    priorEvidence, suite, phases, cleanup: "OWNED_IMAGE_AND_TEMPORARY_STATE_REMOVED" }, {
    imageId: input.policy.candidate.imageId, archiveSha256: input.archiveSha256,
    archiveBytes: input.archiveBytes, runId: input.runId, recipeRevision: input.recipeRevision,
    subject: input.policy.subject, auditBinding: priorEvidence.auditBinding,
    priorRuntimeRunId: priorEvidence.priorRuntimeRunId,
    priorRuntimeRecipeRevision: priorEvidence.priorRuntimeRecipeRevision });
}
