import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";

import { SEAWEED_CANDIDATE_IMPORT_MESSAGE, validateSavedSeaweedCandidate } from "./candidate-archive.mjs";
import { validateSeaweedRuntimeBackupRestoreProof, verifyLocalSeaweedRuntimeBackupRestore } from
  "./backup-restore.mjs";
import { isPublicSeaweedRuntimePhase, isPublicSeaweedRuntimeReason,
  validateSeaweedRuntimePersistenceProof, validateSeaweedRuntimeProfileProof,
  validateSeaweedRuntimeStrictContentionProof, verifyLocalSeaweedRuntimeProfile,
  verifyLocalSeaweedRuntimeRestartPersistence, verifyLocalSeaweedRuntimeStrictContention } from "./candidate-runtime.mjs";
import {
  cleanupMaterializedSeaweedRootfs, materializeReviewedSeaweedRootfs, withMaterializedSeaweedRootfs,
} from "./materialize-rootfs.mjs";

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const MAX_OUTPUT_BYTES = 1024 ** 2;
const MAX_SAVED_BYTES = 2 * 1024 ** 3;
const COMMAND_TIMEOUT_MS = 4 * 60_000;
const INSPECT_CONFIG_FIELDS = ["Hostname", "Domainname", "AttachStdin", "AttachStdout", "AttachStderr", "Tty",
  "OpenStdin", "StdinOnce", "Image", "OnBuild", "Entrypoint", "Cmd", "Env", "WorkingDir",
  "Volumes", "ExposedPorts", "User", "Labels"];
const INSPECTION_DETAILS = new Set(["options", "id", "tags", "platform", "size", "rootfs",
  "config_keys", "config_unknown", ...INSPECT_CONFIG_FIELDS.map((field) => `config_${field}`)]);
const IMAGE_CLEANUP_REASONS = new Set(["PRE_CLEANUP_INVENTORY_FAILED", "IMAGE_INSPECTION_FAILED",
  "IMAGE_REMOVE_FAILED", "POST_REMOVAL_ABSENCE_FAILED", "POST_CLEANUP_INVENTORY_FAILED"]);
const FAILURE_CODES = new Set([
  "seaweed_candidate_arguments_invalid", "seaweed_candidate_parent_invalid", "seaweed_candidate_parent_not_empty",
  "seaweed_candidate_context_invalid", "seaweed_candidate_materialize_failed", "seaweed_candidate_engine_failed",
  "seaweed_candidate_tag_failed", "seaweed_candidate_import_failed", "seaweed_candidate_ownership_failed",
  "seaweed_candidate_save_failed", "seaweed_candidate_archive_failed", "seaweed_candidate_image_cleanup_failed",
  "seaweed_candidate_temporary_cleanup_failed", "seaweed_candidate_aborted", "seaweed_candidate_failed",
  "seaweed_candidate_store_failed", "seaweed_candidate_store_not_empty",
  "seaweed_candidate_runtime_failed", "seaweed_candidate_runtime_cleanup_failed",
  "seaweed_candidate_runtime_backup_restore_failed", "seaweed_candidate_runtime_backup_restore_cleanup_failed",
]);

function fail(code) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", authority: "PREPARATION_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED" });
}

export function isPublicCandidateFailureCode(value) { return typeof value === "string" && FAILURE_CODES.has(value); }
export function isPublicCandidateInspectionDetail(value) { return typeof value === "string" && INSPECTION_DETAILS.has(value); }
export function isPublicCandidateImageCleanupReason(value) {
  return typeof value === "string" && IMAGE_CLEANUP_REASONS.has(value);
}

function ownData(error, key) {
  if (error === null || typeof error !== "object" && typeof error !== "function") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

async function stage(name, operation) {
  try { return await operation(); } catch (error) {
    if (error?.code === "seaweed_candidate_aborted") throw error;
    const reported = fail(`seaweed_candidate_${name}_failed`);
    const detail = ownData(error, "detailCode");
    if ((name === "ownership" || name === "image_cleanup") && isPublicCandidateInspectionDetail(detail)) {
      reported.detailCode = detail;
    }
    throw reported;
  }
}

async function imageCleanupStage(reason, operation) {
  try { return await operation(); } catch (error) {
    const reported = fail("seaweed_candidate_image_cleanup_failed");
    reported.phase = "CANDIDATE_IMAGE_CLEANUP";
    reported.reason = reason;
    const detail = ownData(error, "detailCode");
    if (isPublicCandidateInspectionDetail(detail)) reported.detailCode = detail;
    throw reported;
  }
}

function withSecondaryImageCleanupFailure(primary, secondary) {
  const reported = fail(isPublicCandidateFailureCode(ownData(primary, "code"))
    ? ownData(primary, "code") : "seaweed_candidate_failed");
  const phase = ownData(primary, "phase"); const reason = ownData(primary, "reason");
  const durationMs = ownData(primary, "durationMs"); const imageId = ownData(primary, "imageId");
  const detailCode = ownData(primary, "detailCode");
  if (isPublicSeaweedRuntimePhase(phase)) reported.phase = phase;
  if (isPublicSeaweedRuntimeReason(reason)) reported.reason = reason;
  if (Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs <= 10_800_000) {
    reported.durationMs = durationMs;
  }
  if (IMAGE_ID.test(imageId)) reported.imageId = imageId;
  if (isPublicCandidateInspectionDetail(detailCode)) reported.detailCode = detailCode;
  const runtimeCleanupFailure = ownData(primary, "runtimeCleanupFailure");
  if (isPublicRuntimeCleanupFailure(runtimeCleanupFailure)) {
    reported.runtimeCleanupFailure = Object.freeze({
      code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
      phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN",
    });
  }
  const cleanupReason = ownData(secondary, "reason");
  if (isPublicCandidateImageCleanupReason(cleanupReason)) {
    reported.secondaryFailure = Object.freeze({ code: "seaweed_candidate_image_cleanup_failed",
      phase: "CANDIDATE_IMAGE_CLEANUP", reason: cleanupReason });
  }
  return reported;
}

function isPublicRuntimeCleanupFailure(value) {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).sort().join("|") === "code|phase|reason"
      && ownData(value, "code") === "seaweed_candidate_runtime_backup_restore_cleanup_failed"
      && ownData(value, "phase") === "BACKUP_RESTORE_CLEANUP"
      && ownData(value, "reason") === "CLEANUP_UNCERTAIN";
  } catch { return false; }
}

function ownIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode,
    nlink: stat.nlink, size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs,
    birthtimeNs: stat.birthtimeNs };
}

function sameIdentity(left, right) { return Object.keys(left).every((key) => left[key] === right[key]); }
function sameDirectory(left, right) {
  return ["dev", "ino", "uid", "gid", "mode"].every((key) => left[key] === right[key]);
}
function sameOwnedNode(left, right) {
  return sameDirectory(left, right) && left.nlink === right.nlink && left.birthtimeNs === right.birthtimeNs;
}

async function privateDirectory(directory, uid) {
  const stat = await lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.nlink < 2n || stat.uid !== BigInt(uid)
    || (stat.mode & 0o777n) !== 0o700n || await realpath(directory) !== directory) {
    throw fail("seaweed_candidate_parent_invalid");
  }
  return ownIdentity(stat);
}

async function exactSavedFile(file, expected, uid) {
  const stat = await lstat(file, { bigint: true });
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.uid === BigInt(uid)
    && (stat.mode & 0o777n) === 0o600n && sameIdentity(expected, ownIdentity(stat));
}

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

export function candidateImportChanges(config) {
  if (!exactObject(config, INSPECT_CONFIG_FIELDS) || config.User !== "" || config.OnBuild !== null
    || !Array.isArray(config.Entrypoint) || !Array.isArray(config.Cmd) || !Array.isArray(config.Env)
    || typeof config.WorkingDir !== "string" || !config.WorkingDir.startsWith("/")
    || !exactObject(config.Volumes, Object.keys(config.Volumes ?? {}))
    || !exactObject(config.ExposedPorts, Object.keys(config.ExposedPorts ?? {}))
    || !exactObject(config.Labels, Object.keys(config.Labels ?? {}))) throw fail("seaweed_candidate_arguments_invalid");
  const clean = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096
    && !/[\0\r\n]/u.test(value);
  if (![...config.Entrypoint, ...config.Cmd, ...config.Env, config.WorkingDir,
    ...Object.keys(config.Volumes), ...Object.keys(config.ExposedPorts),
    ...Object.keys(config.Labels), ...Object.values(config.Labels)].every(clean)) {
    throw fail("seaweed_candidate_arguments_invalid");
  }
  const changes = [
    `ENTRYPOINT ${JSON.stringify(config.Entrypoint)}`,
    `CMD ${JSON.stringify(config.Cmd)}`,
    ...config.Env.map((value) => `ENV ${value}`),
    `WORKDIR ${config.WorkingDir}`,
    `VOLUME ${JSON.stringify(Object.keys(config.Volumes).sort())}`,
    ...Object.keys(config.ExposedPorts).sort().map((port) => `EXPOSE ${port}`),
    ...Object.entries(config.Labels).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, value]) => `LABEL ${key}=${JSON.stringify(value)}`),
  ];
  if (changes.some((value) => value.length > 8192)) throw fail("seaweed_candidate_arguments_invalid");
  return Object.freeze(changes);
}

function ownershipFailure(detailCode) {
  const error = fail("seaweed_candidate_ownership_failed"); error.detailCode = detailCode; return error;
}

function configInspectionDetail(actual, expected) {
  if (expected === undefined) return "config_unknown";
  if (!exactObject(actual, INSPECT_CONFIG_FIELDS)) return "config_keys";
  for (const field of INSPECT_CONFIG_FIELDS) {
    if (!isDeepStrictEqual(actual[field], expected[field])) return `config_${field}`;
  }
  return "config_unknown";
}

export function validateCandidateImage(metadata, { imageId, tag, repoTags, diffId, rawSize, validateRuntimeConfig,
  expectedConfig } = {}) {
  const expectedRepoTags = repoTags ?? (typeof tag === "string" ? [tag] : undefined);
  if (!IMAGE_ID.test(imageId) || !IMAGE_ID.test(diffId)
    || !Array.isArray(expectedRepoTags) || expectedRepoTags.some((value) => typeof value !== "string")
    || !Number.isSafeInteger(rawSize) || rawSize < 1024 || rawSize > MAX_SAVED_BYTES
    || typeof validateRuntimeConfig !== "function") throw ownershipFailure("options");
  if (metadata?.Id !== imageId) throw ownershipFailure("id");
  const actualRepoTags = metadata?.RepoTags === null && expectedRepoTags.length === 0 ? [] : metadata?.RepoTags;
  if (!Array.isArray(actualRepoTags) || !isDeepStrictEqual(actualRepoTags, expectedRepoTags)) {
    throw ownershipFailure("tags");
  }
  if (metadata.Os !== "linux" || metadata.Architecture !== "amd64") throw ownershipFailure("platform");
  if (!Number.isSafeInteger(metadata.Size) || metadata.Size < 1 || metadata.Size > MAX_SAVED_BYTES) {
    throw ownershipFailure("size");
  }
  if (metadata?.RootFS?.Type !== "layers" || !Array.isArray(metadata.RootFS.Layers)
    || metadata.RootFS.Layers.length !== 1 || metadata.RootFS.Layers[0] !== diffId) {
    throw ownershipFailure("rootfs");
  }
  try { validateRuntimeConfig(metadata.Config); } catch { throw ownershipFailure(configInspectionDetail(metadata.Config, expectedConfig)); }
  return Object.freeze({ imageId, diffId });
}

async function capture(stream, kill) {
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) throw fail("seaweed_candidate_failed");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) { kill(); throw error; }
}

async function defaultDocker(args, { cwd, env, signal, stdinWriter, stdoutSink, timeoutMs = COMMAND_TIMEOUT_MS }) {
  const child = spawn("docker", args, { cwd, env, windowsHide: true,
    stdio: [stdinWriter === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  let timedOut = false;
  const kill = () => { if (!child.killed) child.kill("SIGKILL"); };
  const timer = globalThis.setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  const abort = () => kill();
  signal?.addEventListener("abort", abort, { once: true });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, exitSignal) => resolve({ status, exitSignal }));
  });
  const writing = stdinWriter === undefined ? Promise.resolve() : Promise.resolve().then(() => stdinWriter(child.stdin));
  writing.catch(kill);
  const stdout = stdoutSink === undefined ? capture(child.stdout, kill) : pipeline(child.stdout, stdoutSink).then(() => "");
  stdout.catch(kill);
  const stderr = capture(child.stderr, kill);
  const results = await Promise.allSettled([exit, writing, stdout, stderr]);
  globalThis.clearTimeout(timer);
  signal?.removeEventListener("abort", abort);
  if (timedOut || signal?.aborted || results.some((result) => result.status === "rejected")) {
    throw fail("seaweed_candidate_failed");
  }
  return { ...results[0].value, stdout: results[2].value, stderr: results[3].value };
}

async function command(docker, args, options, expectedStatuses = [0]) {
  if (options.signal?.aborted) throw fail("seaweed_candidate_aborted");
  const result = await docker(args, options);
  if (!expectedStatuses.includes(result?.status) || typeof result.stdout !== "string"
    || typeof result.stderr !== "string" || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MAX_OUTPUT_BYTES) {
    throw fail("seaweed_candidate_failed");
  }
  return result;
}

async function imageAbsent(docker, reference, options) {
  const result = await command(docker, ["image", "inspect", reference], options, [0, 1]);
  if (result.status !== 1 || result.stdout.trim() !== "[]"
    || result.stderr.trim() !== `Error response from daemon: No such image: ${reference}`) {
    throw fail("seaweed_candidate_failed");
  }
}

async function existingImageIds(docker, options) {
  const result = await command(docker, ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], options);
  if (result.stderr.trim() !== "") throw fail("seaweed_candidate_failed");
  const lines = result.stdout.trim() === "" ? [] : result.stdout.trim().split(/\r?\n/u);
  if (lines.some((line) => !IMAGE_ID.test(line))) throw fail("seaweed_candidate_failed");
  return new Set(lines);
}

function exactImageIds(actual, baseline, candidateId) {
  if (!(actual instanceof Set) || !(baseline instanceof Set)
    || actual.size !== baseline.size + (candidateId === undefined ? 0 : 1)) return false;
  for (const imageId of baseline) if (!actual.has(imageId)) return false;
  return candidateId === undefined || !baseline.has(candidateId) && actual.has(candidateId);
}

async function inspectImage(docker, tag, options) {
  const result = await command(docker, ["image", "inspect", "--format", "{{json .}}", tag], options);
  try { return JSON.parse(result.stdout); } catch { throw fail("seaweed_candidate_failed"); }
}

function saveSink(handle) {
  let written = 0;
  return new Writable({ write(chunk, _encoding, callback) {
    const writeAll = async () => {
      written += chunk.length;
      if (written > MAX_SAVED_BYTES) throw fail("seaweed_candidate_failed");
      let offset = 0;
      while (offset < chunk.length) {
        const result = await handle.write(chunk, offset, chunk.length - offset, null);
        if (result.bytesWritten < 1) throw fail("seaweed_candidate_failed");
        offset += result.bytesWritten;
      }
    };
    writeAll().then(() => callback(), callback);
  } });
}

async function cleanupOwned({ rootfsReceipt, cleanupRootfs, rootfsParent, rootfsIdentity, work, workIdentity,
  dockerConfig, configIdentity, saved, savedIdentity, savedSynced, uid }) {
  let clean = true;
  if (rootfsReceipt !== undefined) {
    try {
      const outcome = await cleanupRootfs(rootfsReceipt);
      if (outcome?.state !== "CLEANED") clean = false;
    } catch { clean = false; }
  }
  if (savedIdentity !== undefined) {
    try {
      const current = await lstat(saved, { bigint: true });
      const observed = ownIdentity(current);
      const owned = savedSynced ? sameIdentity(savedIdentity, observed)
        : sameOwnedNode(savedIdentity, observed);
      if (current.isFile() && !current.isSymbolicLink() && current.nlink === 1n && current.uid === BigInt(uid)
        && (current.mode & 0o777n) === 0o600n && owned) await unlink(saved);
      else clean = false;
    } catch { clean = false; }
  }
  for (const [directory, expected] of [[dockerConfig, configIdentity], [rootfsParent, rootfsIdentity], [work, workIdentity]]) {
    if (expected === undefined) continue;
    try {
      if ((await readdir(directory)).length === 0 && sameDirectory(expected, await privateDirectory(directory, uid))) {
        await rmdir(directory);
      } else clean = false;
    } catch { clean = false; }
  }
  return clean;
}

async function execute(input, testOnly, executionProfile = "NONE") {
  if (!exactObject(input, ["parent", "recipeRevision", "createdAt", "runId", "signal"])
    && !exactObject(input, ["parent", "recipeRevision", "createdAt", "runId"])) throw fail("seaweed_candidate_arguments_invalid");
  const { parent, recipeRevision, createdAt, runId, signal } = input;
  if (process.platform !== "linux" && !testOnly) throw fail("seaweed_candidate_context_invalid");
  if (typeof parent !== "string" || !path.isAbsolute(parent) || path.normalize(parent) !== parent
    || !REVISION.test(recipeRevision) || !RUN_ID.test(runId)
    || typeof createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(createdAt)
    || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt
    || signal !== undefined && !(signal instanceof globalThis.AbortSignal)) throw fail("seaweed_candidate_arguments_invalid");
  if (signal?.aborted) throw fail("seaweed_candidate_aborted");
  const uid = process.getuid?.() ?? 0;
  const parentIdentity = await privateDirectory(parent, uid);
  if ((await readdir(parent)).length !== 0) throw fail("seaweed_candidate_parent_not_empty");
  const materializeRootfs = testOnly?.materializeRootfs ?? materializeReviewedSeaweedRootfs;
  const withRootfs = testOnly?.withRootfs ?? withMaterializedSeaweedRootfs;
  const cleanupRootfs = testOnly?.cleanupRootfs ?? cleanupMaterializedSeaweedRootfs;
  const validateArchive = testOnly?.validateArchive ?? validateSavedSeaweedCandidate;
  const verifyRuntime = executionProfile === "RUNTIME_PROFILE"
    ? testOnly?.verifyRuntime ?? verifyLocalSeaweedRuntimeProfile : undefined;
  const verifyPersistence = executionProfile === "PERSISTENCE_PROFILE"
    ? testOnly?.verifyPersistence ?? verifyLocalSeaweedRuntimeRestartPersistence : undefined;
  const verifyStrict = executionProfile === "STRICT_CONTENTION_PROFILE"
    ? testOnly?.verifyStrict ?? verifyLocalSeaweedRuntimeStrictContention : undefined;
  const verifyBackupRestore = executionProfile === "BACKUP_RESTORE_PROFILE"
    ? testOnly?.verifyBackupRestore ?? verifyLocalSeaweedRuntimeBackupRestore : undefined;
  const docker = testOnly?.docker ?? defaultDocker;
  const rootfsParent = path.join(parent, "rootfs"); const work = path.join(parent, "work");
  const dockerConfig = path.join(work, "docker-config"); const saved = path.join(work, "saved.tar");
  const tag = `auto-world-seaweed-s3:run-${runId}-attempt-1`;
  let rootfsIdentity; let workIdentity; let configIdentity; let savedIdentity; let savedSynced = false;
  let rootfsReceipt; let result; let failure;
  try {
    await mkdir(rootfsParent, { mode: 0o700 }); rootfsIdentity = await privateDirectory(rootfsParent, uid);
    await mkdir(work, { mode: 0o700 }); workIdentity = await privateDirectory(work, uid);
    await mkdir(dockerConfig, { mode: 0o700 }); configIdentity = await privateDirectory(dockerConfig, uid);
    const env = { PATH: process.env.PATH ?? "", DOCKER_CONFIG: dockerConfig,
      DOCKER_HOST: "unix:///var/run/docker.sock", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TMPDIR: work };
    const dockerOptions = { cwd: work, env, signal, timeoutMs: COMMAND_TIMEOUT_MS };
    // Once ownership is proven, cleanup must proceed even if the caller aborts the operation.
    const cleanupDockerOptions = { cwd: work, env, timeoutMs: COMMAND_TIMEOUT_MS };
    rootfsReceipt = await stage("materialize", () => materializeRootfs({ parent: rootfsParent, recipeRevision, createdAt, signal }));
    if (rootfsReceipt?.kind !== "SEAWEED_ROOTFS_MATERIALIZATION_RECEIPT_V1"
      || rootfsReceipt.state !== "MATERIALIZED" || rootfsReceipt.authority !== "PREPARATION_ONLY"
      || rootfsReceipt.candidateAuthorization !== "NOT_AUTHORIZED"
      || rootfsReceipt.recipeRevision !== recipeRevision || rootfsReceipt.createdAt !== createdAt
      || !RUN_ID.test(rootfsReceipt.sourceRunId) || !REVISION.test(rootfsReceipt.sourceCodeRevision)
      || !IMAGE_ID.test(rootfsReceipt.sourceBinaryDigest) || !IMAGE_ID.test(rootfsReceipt.baseManifestDigest)) {
      throw fail("seaweed_candidate_materialize_failed");
    }
    result = await withRootfs(rootfsReceipt, async (rootfs) => {
      const { rawSize, diffId, memberCount, importConfig, pipeArchiveTo,
        validateFilesystem, validateRuntimeConfig } = rootfs;
      if (rawSize !== rootfsReceipt.rawSize || diffId !== rootfsReceipt.diffId
        || memberCount !== rootfsReceipt.memberCount) throw fail("seaweed_candidate_materialize_failed");
      validateRuntimeConfig(importConfig);
      const version = await stage("engine", () => command(docker,
        ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], dockerOptions));
      const versionText = version.stdout.trim();
      if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?\|28\.0\.4$/u.test(versionText)
        || versionText.length > 128) throw fail("seaweed_candidate_engine_failed");
      const serverVersion = "28.0.4";
      await stage("tag", () => imageAbsent(docker, tag, dockerOptions));
      const priorImageIds = await stage("store", () => existingImageIds(docker, dockerOptions));
      let imageId; let owned = false; let tagged = false; let archiveProof; let runtimeProof;
      let persistenceProof; let strictContentionProof; let backupRestoreProof;
      let imageCleanupFailure; let candidateFailure;
      try {
        const changes = candidateImportChanges(importConfig).flatMap((change) => ["--change", change]);
        const imported = await stage("import", () => command(docker,
          ["image", "import", "--platform", "linux/amd64", "--message", SEAWEED_CANDIDATE_IMPORT_MESSAGE,
            ...changes, "-"], { ...dockerOptions, stdinWriter: (writable) => pipeArchiveTo(writable, { signal }) }));
        imageId = imported.stdout.trim();
        if (!IMAGE_ID.test(imageId)) throw fail("seaweed_candidate_import_failed");
        if (priorImageIds.has(imageId)) throw ownershipFailure("id");
        await stage("ownership", async () => {
          const currentImageIds = await existingImageIds(docker, dockerOptions);
          if (!exactImageIds(currentImageIds, priorImageIds, imageId)) throw ownershipFailure("id");
          const metadata = await inspectImage(docker, imageId, dockerOptions);
          validateCandidateImage(metadata,
            { imageId, repoTags: [], diffId, rawSize, validateRuntimeConfig() {} });
          owned = true;
          validateCandidateImage(metadata,
            { imageId, repoTags: [], diffId, rawSize, validateRuntimeConfig, expectedConfig: importConfig });
          await imageAbsent(docker, tag, dockerOptions);
          await command(docker, ["image", "tag", imageId, tag], dockerOptions);
          tagged = true;
          validateCandidateImage(await inspectImage(docker, tag, dockerOptions),
            { imageId, tag, diffId, rawSize, validateRuntimeConfig, expectedConfig: importConfig });
        });
        await stage("save", async () => {
          const handle = await open(saved, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try {
            await handle.chmod(0o600);
            const before = ownIdentity(await handle.stat({ bigint: true }));
            if (!await exactSavedFile(saved, before, uid)) throw fail("seaweed_candidate_save_failed");
            savedIdentity = before;
            await command(docker, ["image", "save", tag], { ...dockerOptions, stdoutSink: saveSink(handle) });
            await handle.sync();
            const after = ownIdentity(await handle.stat({ bigint: true }));
            if (!await exactSavedFile(saved, after, uid) || after.size < 1024n) throw fail("seaweed_candidate_save_failed");
            savedIdentity = after; savedSynced = true;
          } finally { await handle.close(); }
        });
        archiveProof = await stage("archive", () => validateArchive({ file: saved, imageId, tag, diffId, rawSize,
          memberCount, serverVersion, validateFilesystem, validateRuntimeConfig, signal }));
        if (archiveProof?.kind !== "SEAWEED_SAVED_CANDIDATE_PROOF_V1"
          || archiveProof.identityType !== "CLASSIC_CONFIG_ID" || archiveProof.imageId !== imageId
          || archiveProof.tag !== tag || archiveProof.diffId !== diffId || archiveProof.rawSize !== rawSize
          || archiveProof.memberCount !== memberCount || archiveProof.serverVersion !== serverVersion) {
          throw fail("seaweed_candidate_archive_failed");
        }
        if (verifyRuntime !== undefined || verifyPersistence !== undefined || verifyStrict !== undefined
          || verifyBackupRestore !== undefined) {
          try {
            const proof = await (verifyPersistence ?? verifyStrict ?? verifyBackupRestore ?? verifyRuntime)(Object.freeze({ parent: work, dockerConfig, imageId,
              runId, recipeRevision, signal }));
            if (verifyPersistence !== undefined) {
              validateSeaweedRuntimePersistenceProof(proof, { imageId, runId, recipeRevision });
              persistenceProof = proof;
            } else if (verifyStrict !== undefined) {
              if (!exactObject(proof, ["runtimeProof", "strictContentionProof"])) {
                throw fail("seaweed_candidate_runtime_failed");
              }
              validateSeaweedRuntimeProfileProof(proof.runtimeProof, { imageId, runId, recipeRevision });
              validateSeaweedRuntimeStrictContentionProof(proof.strictContentionProof,
                { imageId, runId, recipeRevision });
              runtimeProof = proof.runtimeProof;
              strictContentionProof = proof.strictContentionProof;
            } else if (verifyBackupRestore !== undefined) {
              validateSeaweedRuntimeBackupRestoreProof(proof, { imageId, runId, recipeRevision });
              backupRestoreProof = proof;
            } else {
              validateSeaweedRuntimeProfileProof(proof, { imageId, runId, recipeRevision });
              runtimeProof = proof;
            }
          } catch (error) {
            const runtimeCode = ownData(error, "code");
            const reported = fail(runtimeCode === "seaweed_candidate_runtime_cleanup_failed"
              || runtimeCode === "seaweed_candidate_runtime_persistence_cleanup_failed"
              || runtimeCode === "seaweed_candidate_runtime_backup_restore_cleanup_failed"
              ? "seaweed_candidate_runtime_cleanup_failed" : "seaweed_candidate_runtime_failed");
            const phase = ownData(error, "phase"); const reason = ownData(error, "reason");
            const durationMs = ownData(error, "durationMs");
            if (isPublicSeaweedRuntimePhase(phase) && isPublicSeaweedRuntimeReason(reason)
              && Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs <= 10_800_000) {
              reported.phase = phase; reported.reason = reason; reported.durationMs = durationMs;
            }
            const runtimeCleanupFailure = ownData(error, "runtimeCleanupFailure");
            if (isPublicRuntimeCleanupFailure(runtimeCleanupFailure)) {
              reported.runtimeCleanupFailure = Object.freeze({
                code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
                phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN",
              });
            }
            reported.imageId = imageId;
            throw reported;
          }
        }
      } catch (error) { candidateFailure = error; }
      if (owned) {
        try {
          const currentImageIds = await imageCleanupStage("PRE_CLEANUP_INVENTORY_FAILED",
            () => existingImageIds(docker, cleanupDockerOptions));
          if (!exactImageIds(currentImageIds, priorImageIds, imageId)) {
            await imageCleanupStage("PRE_CLEANUP_INVENTORY_FAILED", () => { throw ownershipFailure("id"); });
          }
          await imageCleanupStage("IMAGE_INSPECTION_FAILED", async () => validateCandidateImage(
            await inspectImage(docker, imageId, cleanupDockerOptions), tagged
              ? { imageId, tag, diffId, rawSize, validateRuntimeConfig, expectedConfig: importConfig }
              : { imageId, repoTags: [], diffId, rawSize, validateRuntimeConfig() {} }));
          await imageCleanupStage("IMAGE_REMOVE_FAILED",
            () => command(docker, ["image", "rm", tagged ? tag : imageId], cleanupDockerOptions));
          await imageCleanupStage("POST_REMOVAL_ABSENCE_FAILED", async () => {
            await imageAbsent(docker, tag, cleanupDockerOptions);
            await imageAbsent(docker, imageId, cleanupDockerOptions);
          });
          await imageCleanupStage("POST_CLEANUP_INVENTORY_FAILED", async () => {
            if (!exactImageIds(await existingImageIds(docker, cleanupDockerOptions), priorImageIds)) {
              throw ownershipFailure("id");
            }
          });
        } catch (error) {
          imageCleanupFailure = error;
          if (IMAGE_ID.test(imageId)) imageCleanupFailure.imageId = imageId;
        }
      }
      if (imageCleanupFailure !== undefined && candidateFailure !== undefined) {
        throw withSecondaryImageCleanupFailure(candidateFailure, imageCleanupFailure);
      }
      if (imageCleanupFailure !== undefined) throw imageCleanupFailure;
      if (candidateFailure !== undefined) throw candidateFailure;
      return Object.freeze({ kind: backupRestoreProof !== undefined
        ? "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V5"
        : strictContentionProof !== undefined
        ? "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V4"
        : persistenceProof !== undefined ? "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V3"
        : runtimeProof === undefined ? "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1"
          : "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V2", state: "VERIFIED",
        authority: executionProfile === "NONE" ? "PREPARATION_ONLY" : "DIAGNOSTIC_ONLY",
        candidateAuthorization: "NOT_AUTHORIZED",
        imageExecution: executionProfile === "NONE" ? "NOT_ATTEMPTED" : "VERIFIED_DIAGNOSTIC",
        publication: "NOT_ATTEMPTED", vulnerabilityAudit: "NOT_ATTEMPTED", admission: "NOT_ATTEMPTED",
        runId, recipeRevision, rawSize, diffId, memberCount, imageId,
        sourceRunId: rootfsReceipt.sourceRunId, sourceCodeRevision: rootfsReceipt.sourceCodeRevision,
        sourceBinaryDigest: rootfsReceipt.sourceBinaryDigest, baseManifestDigest: rootfsReceipt.baseManifestDigest,
        serverVersion, archiveKind: archiveProof.kind, archiveIdentityType: archiveProof.identityType,
        archiveSha256: archiveProof.archiveSha256, archiveBytes: archiveProof.archiveBytes,
        ...(runtimeProof === undefined ? {} : { runtimeProof }),
        ...(persistenceProof === undefined ? {} : { persistenceProof }),
        ...(strictContentionProof === undefined ? {} : { strictContentionProof }),
        ...(backupRestoreProof === undefined ? {} : { backupRestoreProof }) });
    });
  } catch (error) { failure = error; }
  const clean = await cleanupOwned({ rootfsReceipt, cleanupRootfs, rootfsParent, rootfsIdentity, work, workIdentity,
    dockerConfig, configIdentity, saved, savedIdentity, savedSynced, uid });
  if (!clean || !sameDirectory(parentIdentity, await privateDirectory(parent, uid).catch(() => ({})))
    || (await readdir(parent).catch(() => ["unknown"])).length !== 0) {
    throw fail("seaweed_candidate_temporary_cleanup_failed");
  }
  if (failure !== undefined) {
    if (isPublicCandidateFailureCode(failure?.code)) throw failure;
    if (signal?.aborted) throw fail("seaweed_candidate_aborted");
    throw fail("seaweed_candidate_failed");
  }
  return result;
}

export async function materializeLocalSeaweedCandidate(input) { return execute(input, undefined); }
export async function TEST_ONLY_materializeLocalSeaweedCandidate(input, injected) { return execute(input, injected); }
export async function materializeAndVerifyLocalSeaweedRuntimeCandidate(input) {
  return execute(input, undefined, "RUNTIME_PROFILE");
}
export async function TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeCandidate(input, injected) {
  return execute(input, injected, "RUNTIME_PROFILE");
}
export async function materializeAndVerifyLocalSeaweedRuntimePersistenceCandidate(input) {
  return execute(input, undefined, "PERSISTENCE_PROFILE");
}
export async function TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimePersistenceCandidate(input, injected) {
  return execute(input, injected, "PERSISTENCE_PROFILE");
}
export async function materializeAndVerifyLocalSeaweedRuntimeStrictContentionCandidate(input) {
  return execute(input, undefined, "STRICT_CONTENTION_PROFILE");
}
export async function TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeStrictContentionCandidate(input, injected) {
  return execute(input, injected, "STRICT_CONTENTION_PROFILE");
}
export async function materializeAndVerifyLocalSeaweedRuntimeBackupRestoreCandidate(input) {
  return execute(input, undefined, "BACKUP_RESTORE_PROFILE");
}
export async function TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeBackupRestoreCandidate(input, injected) {
  return execute(input, injected, "BACKUP_RESTORE_PROFILE");
}
