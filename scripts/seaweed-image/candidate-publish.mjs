import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readSync, realpathSync, readdirSync, rmSync, writeFileSync, writeSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  SEAWEED_PACKAGE_PRIVATE_READ, classifyAnonymousRemoteRead, validateRemoteManifest,
} from "./package-private-read.mjs";
import { withVerifiedLocalSeaweedCandidate } from "./materialize-candidate.mjs";

const MiB = 1024 * 1024;
const MAX_OUTPUT_BYTES = MiB;
const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
const COMMAND_TIMEOUT_MS = 15 * 60_000;
const CLEANUP_COMMAND_TIMEOUT_MS = 4 * 60_000;
const CLEANUP_TIMEOUT_MS = 10 * 60_000;
const OPERATION_TIMEOUT_MS = 150 * 60_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const EXPECTED_SERVER_VERSION = "28.0.4";
const CONFIG_MEDIA_TYPES = new Set([
  "application/vnd.docker.container.image.v1+json",
  "application/vnd.oci.image.config.v1+json",
]);
const MANIFEST_MEDIA_TYPES = new Set([
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
]);
const COMPRESSED_LAYER_MEDIA_TYPES = new Set([
  "application/vnd.docker.image.rootfs.diff.tar.gzip",
  "application/vnd.oci.image.layer.v1.tar+gzip",
]);

export const SEAWEED_CANDIDATE_PUBLISH = Object.freeze({
  workflowPath: ".github/workflows/seaweed-candidate-publish.yml",
  repository: "CleMeY15/auto-world",
  owner: "CleMeY15",
  image: SEAWEED_PACKAGE_PRIVATE_READ.image,
  outputDirectory: "seaweed-candidate-publish",
  platform: "linux/amd64",
  mainRefUrl: "https://api.github.com/repos/CleMeY15/auto-world/git/ref/heads/main",
  serverVersion: EXPECTED_SERVER_VERSION,
});

function fail(code) { throw new Error(code); }

function fixedReason(error) {
  const message = error instanceof Error ? error.message : "seaweed_candidate_publish_unknown_failure";
  return /^seaweed_candidate_publish_[a-z0-9_]+$/u.test(message)
    ? message
    : "seaweed_candidate_publish_command_failed";
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function parseCandidatePublishArguments(argv) {
  if (argv.length === 2 && argv[0] === "--output" && path.isAbsolute(argv[1])) {
    return { output: path.resolve(argv[1]) };
  }
  fail("seaweed_candidate_publish_arguments_invalid");
}

export function validateCandidatePublishContext(env, platform = process.platform) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux"
    || env.RUNNER_ENVIRONMENT !== "github-hosted") fail("seaweed_candidate_publish_requires_github_linux");
  if (env.GITHUB_REPOSITORY !== SEAWEED_CANDIDATE_PUBLISH.repository
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_WORKFLOW_REF !== `${SEAWEED_CANDIDATE_PUBLISH.repository}/${SEAWEED_CANDIDATE_PUBLISH.workflowPath}@refs/heads/main`) {
    fail("seaweed_candidate_publish_context_invalid");
  }
  if (env.GITHUB_JOB !== "publish" || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !RUN_ID.test(env.GITHUB_RUN_ID ?? "") || !REVISION.test(env.GITHUB_SHA ?? "")) {
    fail("seaweed_candidate_publish_identity_invalid");
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN.length === 0
    || !path.isAbsolute(env.RUNNER_TEMP ?? "") || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")) {
    fail("seaweed_candidate_publish_environment_invalid");
  }
  const runnerTemp = path.resolve(env.RUNNER_TEMP);
  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  for (const directory of [runnerTemp, workspace]) {
    if (!existsSync(directory)) fail("seaweed_candidate_publish_directory_invalid");
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) {
      fail("seaweed_candidate_publish_directory_invalid");
    }
  }
  return { repository: env.GITHUB_REPOSITORY, runAttempt: env.GITHUB_RUN_ATTEMPT,
    runId: env.GITHUB_RUN_ID, runNumber: env.GITHUB_RUN_NUMBER, sourceSha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN, runnerTemp, workspace };
}

function validateOutputPath(output, context) {
  if (path.basename(output) !== SEAWEED_CANDIDATE_PUBLISH.outputDirectory
    || path.dirname(output) !== context.runnerTemp || existsSync(output)) {
    fail("seaweed_candidate_publish_output_path_invalid");
  }
}

function commandEnvironment(env, dockerConfig, temporaryDirectory) {
  const clean = { BUILDX_CONFIG: path.join(dockerConfig, "buildx"), DOCKER_CONFIG: dockerConfig,
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TMPDIR: temporaryDirectory, TZ: "UTC" };
  for (const name of ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "XDG_CONFIG_HOME"]) {
    if (typeof env[name] === "string") clean[name] = env[name];
  }
  return clean;
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", env: options.env,
    input: options.input, maxBuffer: MAX_OUTPUT_BYTES, timeout: options.timeoutMs, windowsHide: true });
}

function observe(commandRunner, command, args, options) {
  if (options.signal?.aborted) fail("seaweed_candidate_publish_operation_timeout");
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    fail("seaweed_candidate_publish_output_exceeded");
  }
  if (options.signal?.aborted) fail("seaweed_candidate_publish_operation_timeout");
  return { error: result?.error, status: result?.status, stdout, stderr };
}

function run(commandRunner, command, args, options) {
  const result = observe(commandRunner, command, args, options);
  if (result.error || result.status !== 0) fail("seaweed_candidate_publish_command_failed");
  return result;
}

function boundedIdentity(value) {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512 || /[^\x20-\x7e]/u.test(normalized)) {
    fail("seaweed_candidate_publish_tool_identity_invalid");
  }
  return normalized;
}

function operationOptions(base, started, now, signal) {
  const remaining = OPERATION_TIMEOUT_MS - (now() - started);
  if (signal.aborted || remaining <= 0) fail("seaweed_candidate_publish_operation_timeout");
  return { ...base, signal, timeoutMs: Math.min(COMMAND_TIMEOUT_MS, remaining) };
}

export function candidateCleanupCommandOptions(base, started, now = Date.now) {
  const remaining = CLEANUP_TIMEOUT_MS - (now() - started);
  if (remaining <= 0) fail("seaweed_candidate_publish_cleanup_timeout");
  return { ...base, timeoutMs: Math.min(CLEANUP_COMMAND_TIMEOUT_MS, remaining) };
}

async function verifyProtectedMain(fetchImpl, context, signal) {
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  try {
    let response;
    try {
      response = await fetchImpl(SEAWEED_CANDIDATE_PUBLISH.mainRefUrl, { headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${context.token}`,
        "User-Agent": "auto-world-seaweed-candidate-publish",
      }, redirect: "error", signal: controller.signal });
    } catch { fail(signal.aborted ? "seaweed_candidate_publish_operation_timeout"
      : "seaweed_candidate_publish_main_ref_request_failed"); }
    if (!response?.ok || !response.body?.getReader) fail("seaweed_candidate_publish_main_ref_request_failed");
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const item = await reader.read(); if (item.done) break;
      const chunk = Buffer.from(item.value); size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        await reader.cancel(); fail("seaweed_candidate_publish_main_ref_response_invalid");
      }
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { fail("seaweed_candidate_publish_main_ref_response_invalid"); }
    if (body?.object?.type !== "commit" || body.object.sha !== context.sourceSha) {
      fail("seaweed_candidate_publish_main_ref_mismatch");
    }
  } finally {
    globalThis.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export function classifyRemoteTagAbsence(result, expectedReference) {
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  if (result?.error || Buffer.byteLength(combined) > MAX_OUTPUT_BYTES
    || /unauthorized|denied|forbidden|timeout|timed out|tls|certificate|dial tcp|no such host|connection/u.test(combined)) {
    fail("seaweed_candidate_publish_remote_tag_check_error");
  }
  if (result?.status === 0) fail("seaweed_candidate_publish_remote_tag_exists");
  const exactReferenceNotFound = typeof expectedReference === "string" && expectedReference.length <= 512
    && combined.split(/\r?\n/u).some((line) => line.trim() === `${expectedReference.toLowerCase()}: not found`
      || line.trim() === `error: ${expectedReference.toLowerCase()}: not found`);
  if (result?.status === 1
    && (/manifest unknown|name unknown|manifest.*not found|not found.*manifest/u.test(combined)
      || exactReferenceNotFound)) {
    return "ABSENT";
  }
  fail("seaweed_candidate_publish_remote_tag_check_error");
}

function inspectAbsent(result) {
  if (result.status === 1 && /no such (?:image|object)/iu.test(`${result.stdout}\n${result.stderr}`)) return true;
  if (result.status === 0) return false;
  fail("seaweed_candidate_publish_local_inspect_failed");
}

export function parseCandidateImageIds(raw) {
  const ids = raw.split(/\r?\n/u).filter(Boolean);
  if (ids.some((id) => !DIGEST.test(id))) fail("seaweed_candidate_publish_local_inventory_invalid");
  return [...new Set(ids)].sort();
}

function exactInventory(actual, prior, imageId) {
  return JSON.stringify(actual) === JSON.stringify([...new Set([...prior, imageId])].sort());
}

export function validateCandidateLocalImage(raw, expected, expectedTags, expectedRepoDigestSets = [[]]) {
  let metadata;
  try { metadata = JSON.parse(raw); } catch { fail("seaweed_candidate_publish_local_image_invalid"); }
  const tags = Array.isArray(metadata?.RepoTags) ? [...metadata.RepoTags].sort() : undefined;
  const repoDigests = Array.isArray(metadata?.RepoDigests) ? [...metadata.RepoDigests].sort() : undefined;
  const repoDigestsAccepted = Array.isArray(repoDigests) && expectedRepoDigestSets.some((values) =>
    JSON.stringify(repoDigests) === JSON.stringify([...values].sort()));
  if (metadata?.Id !== expected.imageId || metadata?.Os !== "linux" || metadata?.Architecture !== "amd64"
    || !Number.isSafeInteger(metadata?.Size) || metadata.Size < 1 || metadata.Size > MAX_ARCHIVE_BYTES
    || metadata?.RootFS?.Type !== "layers"
    || !Array.isArray(metadata.RootFS.Layers) || metadata.RootFS.Layers.length !== 1
    || metadata.RootFS.Layers[0] !== expected.diffId || !Array.isArray(tags)
    || JSON.stringify(tags) !== JSON.stringify([...expectedTags].sort()) || !repoDigestsAccepted) {
    fail("seaweed_candidate_publish_local_image_invalid");
  }
  return { imageId: metadata.Id, diffId: metadata.RootFS.Layers[0], size: metadata.Size,
    repoTags: tags, repoDigests };
}

export function validateCandidateRemoteManifest(raw, expected) {
  const bytes = Buffer.from(raw, "utf8");
  if (bytes.length < 2 || bytes.length > MAX_OUTPUT_BYTES) fail("seaweed_candidate_publish_remote_manifest_invalid");
  let manifest;
  try { manifest = JSON.parse(raw); } catch { fail("seaweed_candidate_publish_remote_manifest_invalid"); }
  const config = manifest?.config; const layer = manifest?.layers?.[0];
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)
    || JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(["config", "layers", "mediaType", "schemaVersion"])
    || config === null || typeof config !== "object" || Array.isArray(config)
    || JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(["digest", "mediaType", "size"])
    || layer === null || typeof layer !== "object" || Array.isArray(layer)
    || JSON.stringify(Object.keys(layer).sort()) !== JSON.stringify(["digest", "mediaType", "size"])
    || manifest?.schemaVersion !== 2 || !MANIFEST_MEDIA_TYPES.has(manifest?.mediaType)
    || !CONFIG_MEDIA_TYPES.has(config?.mediaType) || config?.digest !== expected.imageId
    || config?.digest !== `sha256:${expected.configSha256}` || config?.size !== expected.configBytes
    || !Array.isArray(manifest?.layers) || manifest.layers.length !== 1
    || !COMPRESSED_LAYER_MEDIA_TYPES.has(layer?.mediaType) || !DIGEST.test(layer?.digest ?? "")
    || !Number.isSafeInteger(layer?.size) || layer.size < 1 || layer.size > MAX_ARCHIVE_BYTES) {
    fail("seaweed_candidate_publish_remote_manifest_invalid");
  }
  return { manifestDigest: `sha256:${sha256(bytes)}`, manifestBytes: bytes.length,
    manifestMediaType: manifest.mediaType, configDigest: config.digest, configBytes: config.size,
    configMediaType: config.mediaType, layerDigest: layer.digest, layerBytes: layer.size,
    layerMediaType: layer.mediaType, remoteLayerVerification: "PENDING_INDEPENDENT_READ" };
}

function fileIdentity(info) {
  return { dev: info.dev, ino: info.ino, mode: info.mode, nlink: info.nlink, size: info.size, uid: info.uid };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.nlink === right.nlink && left.size === right.size && left.uid === right.uid;
}

function validateRegularPrivate(info, expectedSize, uid) {
  return info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.uid === uid
    && (info.mode & 0o777) === 0o600 && info.size === expectedSize;
}

function hashFileDescriptor(handle, expectedBytes) {
  const hash = createHash("sha256"); const buffer = Buffer.allocUnsafe(MiB); let offset = 0;
  while (offset < expectedBytes) {
    const length = readSync(handle, buffer, 0, Math.min(buffer.length, expectedBytes - offset), offset);
    if (length < 1) fail("seaweed_candidate_publish_archive_copy_invalid");
    hash.update(buffer.subarray(0, length)); offset += length;
  }
  if (readSync(handle, buffer, 0, 1, offset) !== 0) fail("seaweed_candidate_publish_archive_copy_invalid");
  return hash.digest("hex");
}

function validateArchiveSnapshot(snapshot) {
  const proof = snapshot?.archiveProof;
  if (typeof snapshot?.file !== "string" || !path.isAbsolute(snapshot.file)
    || !DIGEST.test(snapshot?.imageId ?? "") || !DIGEST.test(snapshot?.diffId ?? "")
    || !REVISION.test(snapshot?.recipeRevision ?? "") || !RUN_ID.test(snapshot?.runId ?? "")
    || proof?.kind !== "SEAWEED_SAVED_CANDIDATE_PROOF_V1" || proof?.authority !== "PREPARATION_ONLY"
    || proof?.candidateAuthorization !== "NOT_AUTHORIZED" || proof?.identityType !== "CLASSIC_CONFIG_ID"
    || proof?.imageId !== snapshot.imageId || proof?.diffId !== snapshot.diffId
    || !SHA256.test(proof?.archiveSha256 ?? "") || !Number.isSafeInteger(proof?.archiveBytes)
    || proof.archiveBytes < 1024 || proof.archiveBytes > MAX_ARCHIVE_BYTES
    || !SHA256.test(proof?.configSha256 ?? "") || !Number.isSafeInteger(proof?.configBytes)
    || proof.imageId !== `sha256:${proof.configSha256}`
    || proof.configBytes < 1 || proof.configBytes > MAX_OUTPUT_BYTES
    || !SHA256.test(proof?.layerSha256 ?? "") || !Number.isSafeInteger(proof?.layerBytes)
    || proof.layerBytes < 1 || proof.layerBytes > MAX_ARCHIVE_BYTES
    || proof.layerBytes !== proof.rawSize || !Number.isSafeInteger(proof.rawSize) || proof.rawSize < 1
    || !Number.isSafeInteger(proof.memberCount) || proof.memberCount < 1
    || proof.serverVersion !== EXPECTED_SERVER_VERSION || typeof proof.tag !== "string"
    || proof.tag !== `auto-world-seaweed-s3:run-${snapshot.runId}-attempt-1`) {
    fail("seaweed_candidate_publish_archive_proof_invalid");
  }
  return proof;
}

export function copyValidatedCandidateArchive(snapshot, destination) {
  const proof = validateArchiveSnapshot(snapshot); const uid = process.getuid?.() ?? 0;
  let source; let target; let targetCreated = false; let targetNode; let failure;
  try {
    source = openSync(snapshot.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const sourceBeforeInfo = fstatSync(source); const sourceBefore = fileIdentity(sourceBeforeInfo);
    if (!validateRegularPrivate(sourceBeforeInfo, proof.archiveBytes, uid)
      || !sameFileIdentity(sourceBefore, fileIdentity(lstatSync(snapshot.file)))) {
      fail("seaweed_candidate_publish_archive_copy_invalid");
    }
    target = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    targetCreated = true;
    fchmodSync(target, 0o600);
    const targetBeforeInfo = fstatSync(target); const targetBefore = fileIdentity(targetBeforeInfo);
    targetNode = { dev: targetBefore.dev, ino: targetBefore.ino };
    if (!validateRegularPrivate(targetBeforeInfo, 0, uid)
      || !sameFileIdentity(targetBefore, fileIdentity(lstatSync(destination)))) {
      fail("seaweed_candidate_publish_archive_copy_invalid");
    }
    const hash = createHash("sha256"); const buffer = Buffer.allocUnsafe(MiB); let offset = 0;
    while (offset < proof.archiveBytes) {
      const length = readSync(source, buffer, 0, Math.min(buffer.length, proof.archiveBytes - offset), offset);
      if (length < 1) fail("seaweed_candidate_publish_archive_copy_invalid");
      hash.update(buffer.subarray(0, length));
      let written = 0;
      while (written < length) written += writeSync(target, buffer, written, length - written, offset + written);
      offset += length;
    }
    if (readSync(source, buffer, 0, 1, offset) !== 0 || hash.digest("hex") !== proof.archiveSha256) {
      fail("seaweed_candidate_publish_archive_copy_invalid");
    }
    fsyncSync(target);
    const sourceAfterInfo = fstatSync(source); const targetAfterInfo = fstatSync(target);
    if (!sameFileIdentity(sourceBefore, fileIdentity(sourceAfterInfo))
      || !sameFileIdentity(sourceBefore, fileIdentity(lstatSync(snapshot.file)))
      || !validateRegularPrivate(targetAfterInfo, proof.archiveBytes, uid)
      || targetAfterInfo.dev !== targetBefore.dev || targetAfterInfo.ino !== targetBefore.ino
      || !sameFileIdentity(fileIdentity(targetAfterInfo), fileIdentity(lstatSync(destination)))) {
      fail("seaweed_candidate_publish_archive_copy_invalid");
    }
  } catch (error) { failure = error; }
  finally {
    if (target !== undefined) closeSync(target);
    if (source !== undefined) closeSync(source);
  }
  if (failure !== undefined) {
    if (targetCreated && targetNode !== undefined) {
      try {
        const current = lstatSync(destination);
        if (!current.isSymbolicLink() && current.dev === targetNode.dev && current.ino === targetNode.ino) {
          rmSync(destination, { force: false });
        }
      } catch { /* Preserve an uncertain path rather than deleting an unproven object. */ }
    }
    if (fixedReason(failure) === "seaweed_candidate_publish_command_failed") {
      fail("seaweed_candidate_publish_archive_copy_invalid");
    }
    throw failure;
  }
  return Object.freeze({ imageId: snapshot.imageId, diffId: snapshot.diffId, rawSize: proof.rawSize,
      memberCount: proof.memberCount, archiveSha256: proof.archiveSha256, archiveBytes: proof.archiveBytes,
      configSha256: proof.configSha256, configBytes: proof.configBytes,
      layerSha256: proof.layerSha256, layerBytes: proof.layerBytes, originalTag: proof.tag,
      serverVersion: proof.serverVersion });
}

function revalidateCopiedArchive(file, proof) {
  const uid = process.getuid?.() ?? 0; let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(handle); const identity = fileIdentity(info);
    if (!validateRegularPrivate(info, proof.archiveBytes, uid)
      || !sameFileIdentity(identity, fileIdentity(lstatSync(file)))
      || hashFileDescriptor(handle, proof.archiveBytes) !== proof.archiveSha256
      || !sameFileIdentity(identity, fileIdentity(fstatSync(handle)))
      || !sameFileIdentity(identity, fileIdentity(lstatSync(file)))) {
      fail("seaweed_candidate_publish_archive_copy_invalid");
    }
  } finally { if (handle !== undefined) closeSync(handle); }
}

function writeReceipt(output, receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) fail("seaweed_candidate_publish_receipt_too_large");
  writeFileSync(path.join(output, "receipt.json"), serialized, { flag: "wx", mode: 0o600 });
}

export async function runSeaweedCandidatePublish({
  argv = process.argv.slice(2), commandRunner = defaultCommandRunner, env = process.env,
  fetchImpl = globalThis.fetch, materialize = withVerifiedLocalSeaweedCandidate,
  now = Date.now, platform = process.platform, validateBootstrapManifest = validateRemoteManifest,
} = {}) {
  const started = now(); const parsed = parseCandidatePublishArguments(argv);
  const context = validateCandidatePublishContext(env, platform); validateOutputPath(parsed.output, context);
  mkdirSync(parsed.output, { mode: 0o700 });
  const work = path.join(context.runnerTemp, `aw-seaweed-candidate-publish-${context.runId}-attempt-1`);
  if (existsSync(work)) fail("seaweed_candidate_publish_owned_path_exists");
  mkdirSync(work, { mode: 0o700 });
  const materializerParent = path.join(work, "materializer"); const dockerConfig = path.join(work, "docker-auth");
  const anonymousConfig = path.join(work, "docker-anonymous"); const copiedArchive = path.join(work, "candidate.tar");
  mkdirSync(materializerParent, { mode: 0o700 }); mkdirSync(dockerConfig, { mode: 0o700 });
  mkdirSync(anonymousConfig, { mode: 0o700 });
  const authBase = { cwd: work, env: commandEnvironment(env, dockerConfig, work) };
  const anonymousBase = { cwd: work, env: commandEnvironment(env, anonymousConfig, work) };
  const tag = `${SEAWEED_CANDIDATE_PUBLISH.image}:candidate-${context.runId}-attempt-1`;
  const bootstrapSubject = `${SEAWEED_PACKAGE_PRIVATE_READ.image}@${SEAWEED_PACKAGE_PRIVATE_READ.digest}`;
  const receipt = { schemaVersion: 1, state: "PREPARING", result: "FAILED", publication: "NOT_ATTEMPTED",
    admission: "NOT_AUTHORIZED", execution: "NOT_ATTEMPTED", forkAccessTest: "SKIPPED_BY_USER",
    forkIsolation: "NOT_VERIFIED", repository: context.repository, workflowPath: SEAWEED_CANDIDATE_PUBLISH.workflowPath,
    image: SEAWEED_CANDIDATE_PUBLISH.image, sourceSha: context.sourceSha, sourceRef: "refs/heads/main",
    runId: context.runId, runNumber: context.runNumber, runAttempt: context.runAttempt,
    platform: SEAWEED_CANDIDATE_PUBLISH.platform, tag,
    retention: { policy: "SUPPORTED_LIFE_PLUS_365_DAYS", stagingDeletion: "DISABLED",
      secondaryPrivateCopy: "PENDING", restorationProof: "PENDING", publicArtifact: "RECEIPT_ONLY" }, phases: [] };
  const operationController = new globalThis.AbortController();
  const operationTimer = globalThis.setTimeout(() => operationController.abort(), OPERATION_TIMEOUT_MS);
  operationTimer.unref?.();
  const options = (base) => operationOptions(base, started, now, operationController.signal);
  const phase = async (name, operation) => {
    if (operationController.signal.aborted || now() - started >= OPERATION_TIMEOUT_MS) {
      fail("seaweed_candidate_publish_operation_timeout");
    }
    const phaseStarted = now();
    try {
      const result = await operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted }); return result;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: fixedReason(error), durationMs: now() - phaseStarted }); throw error;
    }
  };
  let primaryFailure; let proof; let ownedImage = false; let loadAttempted = false; let localTagAdded = false;
  let priorImageIds = []; let pushAttempted = false;
  try {
    receipt.tools = await phase("managed_tool_identity", () => {
      const version = boundedIdentity(run(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], options(authBase)).stdout);
      const parts = version.split("|");
      if (parts.length !== 2 || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(parts[0])
        || parts[1] !== EXPECTED_SERVER_VERSION) fail("seaweed_candidate_publish_engine_invalid");
      return { docker: version,
        buildx: boundedIdentity(run(commandRunner, "docker", ["buildx", "version"], options(authBase)).stdout),
        serverVersion: EXPECTED_SERVER_VERSION, trustBoundary: "MANAGED_DOCKER_BUILDKIT" };
    });
    await phase("checkout_identity", () => {
      if (run(commandRunner, "git", ["rev-parse", "HEAD"], { ...options(authBase), cwd: context.workspace }).stdout.trim() !== context.sourceSha) {
        fail("seaweed_candidate_publish_checkout_mismatch");
      }
    });
    await phase("registry_login", () => run(commandRunner, "docker", ["login", "ghcr.io", "--username",
      SEAWEED_CANDIDATE_PUBLISH.owner, "--password-stdin"], { ...options(authBase), input: `${context.token}\n` }));
    const candidateReceipt = await phase("candidate_materialization_and_private_copy", async () => materialize({
      parent: materializerParent, recipeRevision: context.sourceSha,
      createdAt: new Date(now()).toISOString(), runId: context.runId, signal: operationController.signal,
    }, async (snapshot) => { proof = copyValidatedCandidateArchive(snapshot, copiedArchive); }));
    if (!proof || candidateReceipt?.kind !== "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1"
      || candidateReceipt?.state !== "VERIFIED" || candidateReceipt?.authority !== "PREPARATION_ONLY"
      || candidateReceipt?.candidateAuthorization !== "NOT_AUTHORIZED" || candidateReceipt?.publication !== "NOT_ATTEMPTED"
      || candidateReceipt?.imageId !== proof.imageId || candidateReceipt?.diffId !== proof.diffId
      || candidateReceipt?.archiveSha256 !== proof.archiveSha256 || candidateReceipt?.archiveBytes !== proof.archiveBytes
      || candidateReceipt?.recipeRevision !== context.sourceSha || candidateReceipt?.runId !== context.runId
      || !RUN_ID.test(candidateReceipt?.sourceRunId ?? "") || !REVISION.test(candidateReceipt?.sourceCodeRevision ?? "")
      || !DIGEST.test(candidateReceipt?.sourceBinaryDigest ?? "") || !DIGEST.test(candidateReceipt?.baseManifestDigest ?? "")
      || readdirSync(materializerParent).length !== 0) fail("seaweed_candidate_publish_materializer_receipt_invalid");
    receipt.candidate = { imageId: proof.imageId, diffId: proof.diffId, rawSize: proof.rawSize,
      memberCount: proof.memberCount, archiveSha256: proof.archiveSha256, archiveBytes: proof.archiveBytes,
      configSha256: proof.configSha256, configBytes: proof.configBytes,
      savedLayerSha256: proof.layerSha256, savedLayerBytes: proof.layerBytes,
      originalTag: proof.originalTag, serverVersion: proof.serverVersion };
    receipt.sourceProof = { sourceRunId: candidateReceipt.sourceRunId,
      sourceCodeRevision: candidateReceipt.sourceCodeRevision,
      sourceBinaryDigest: candidateReceipt.sourceBinaryDigest,
      baseManifestDigest: candidateReceipt.baseManifestDigest,
      sourceArtifacts: "AUTHENTICATED_BY_REVIEWED_MATERIALIZER_POLICY" };
    await phase("copied_archive_revalidation", () => revalidateCopiedArchive(copiedArchive, proof));
    priorImageIds = await phase("local_inventory_before", () => parseCandidateImageIds(run(commandRunner, "docker",
      ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], options(authBase)).stdout));
    await phase("local_references_absent", () => {
      for (const reference of [proof.imageId, proof.originalTag, tag]) {
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", reference], options(authBase)))) {
          fail("seaweed_candidate_publish_local_collision");
        }
      }
    });
    await phase("load_private_archive", () => {
      loadAttempted = true;
      const result = observe(commandRunner, "docker", ["image", "load", "--input", copiedArchive], options(authBase));
      const inventory = parseCandidateImageIds(run(commandRunner, "docker",
        ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], options(authBase)).stdout);
      if (exactInventory(inventory, priorImageIds, proof.imageId)) {
        const recovered = observe(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", proof.imageId], options(authBase));
        if (recovered.status === 0) {
          validateCandidateLocalImage(recovered.stdout, proof, [proof.originalTag]); ownedImage = true;
        }
      }
      if (result.error || result.status !== 0 || !ownedImage) fail("seaweed_candidate_publish_load_failed");
    });
    receipt.localImage = await phase("exact_local_image", () => validateCandidateLocalImage(run(commandRunner, "docker",
      ["image", "inspect", "--format", "{{json .}}", proof.imageId], options(authBase)).stdout, proof, [proof.originalTag]));
    const bootstrapBefore = await phase("bootstrap_authorized_read_before", () => {
      const raw = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", bootstrapSubject], options(authBase)).stdout;
      return validateBootstrapManifest(raw);
    });
    await phase("bootstrap_anonymous_read_denied", () => {
      const result = observe(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", bootstrapSubject], options(anonymousBase));
      try {
        if (classifyAnonymousRemoteRead(result) !== "AUTHORIZATION_DENIED") {
          fail("seaweed_candidate_publish_bootstrap_privacy_invalid");
        }
      } catch { fail("seaweed_candidate_publish_bootstrap_privacy_invalid"); }
    });
    const bootstrapAfter = await phase("bootstrap_authorized_read_after", () => {
      const raw = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", bootstrapSubject], options(authBase)).stdout;
      return validateBootstrapManifest(raw);
    });
    if (JSON.stringify(bootstrapBefore) !== JSON.stringify(bootstrapAfter)) fail("seaweed_candidate_publish_bootstrap_changed");
    receipt.bootstrap = { subject: bootstrapSubject, manifestDigest: bootstrapBefore.sha256,
      manifestBytes: bootstrapBefore.size, anonymousRead: "AUTHORIZATION_DENIED" };
    await phase("remote_tag_absent", () => classifyRemoteTagAbsence(observe(commandRunner, "docker",
      ["buildx", "imagetools", "inspect", "--raw", tag], options(authBase)), tag));
    await phase("protected_main_immediately_before_write", () => verifyProtectedMain(fetchImpl, context, operationController.signal));
    await phase("fixed_unique_candidate_tag", () => {
      const tagResult = observe(commandRunner, "docker", ["image", "tag", proof.imageId, tag], options(authBase));
      const metadata = validateCandidateLocalImage(run(commandRunner, "docker",
        ["image", "inspect", "--format", "{{json .}}", proof.imageId], options(authBase)).stdout,
      proof, [proof.originalTag, tag]);
      localTagAdded = true;
      if (tagResult.error || tagResult.status !== 0) receipt.localTagResponse = "FAILED_BUT_EXACT_STATE_CONFIRMED";
      else receipt.localTagResponse = "SUCCESS";
      return metadata;
    });
    const pushResult = await phase("single_registry_push", () => {
      pushAttempted = true; receipt.publication = "ATTEMPTED_OUTCOME_UNCONFIRMED";
      return observe(commandRunner, "docker", ["push", tag], options(authBase));
    });
    let rawTag;
    try { rawTag = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", tag], options(authBase)).stdout; }
    catch (error) {
      if (pushResult.error || pushResult.status !== 0) fail("seaweed_candidate_publish_push_outcome_unconfirmed");
      throw error;
    }
    const remote = await phase("remote_tag_manifest", () => validateCandidateRemoteManifest(rawTag, proof));
    const subject = `${SEAWEED_CANDIDATE_PUBLISH.image}@${remote.manifestDigest}`;
    await phase("remote_digest_manifest", () => {
      const rawDigest = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], options(authBase)).stdout;
      if (rawDigest !== rawTag) fail("seaweed_candidate_publish_remote_digest_mismatch");
      const verified = validateCandidateRemoteManifest(rawDigest, proof);
      if (JSON.stringify(verified) !== JSON.stringify(remote)) fail("seaweed_candidate_publish_remote_digest_mismatch");
    });
    receipt.remote = remote; receipt.subject = subject; receipt.state = "PUBLISHED_UNADMITTED";
    receipt.publication = "PUBLISHED_UNADMITTED";
    receipt.pushResponse = pushResult.error || pushResult.status !== 0
      ? "FAILED_BUT_REMOTE_EXACT_SUBJECT_CONFIRMED" : "SUCCESS";
    await phase("candidate_anonymous_digest_read_denied", () => {
      const result = observe(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], options(anonymousBase));
      try {
        if (classifyAnonymousRemoteRead(result) !== "AUTHORIZATION_DENIED") {
          fail("seaweed_candidate_publish_candidate_privacy_invalid");
        }
      } catch { fail("seaweed_candidate_publish_candidate_privacy_invalid"); }
      receipt.candidateAnonymousRead = "AUTHORIZATION_DENIED";
    });
  } catch (error) { primaryFailure = error; }
  finally { globalThis.clearTimeout(operationTimer); }

  const cleanupReasons = []; const cleanupStarted = now();
  const cleanupOptions = () => candidateCleanupCommandOptions(authBase, cleanupStarted, now);
  if (ownedImage && proof?.imageId) {
    try {
      const currentIds = parseCandidateImageIds(run(commandRunner, "docker",
        ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (!exactInventory(currentIds, priorImageIds, proof.imageId)) fail("seaweed_candidate_publish_image_cleanup_identity_invalid");
      const expectedTags = localTagAdded ? [proof.originalTag, tag] : [proof.originalTag];
      const expectedRepoDigestSets = receipt.subject ? [[], [receipt.subject]] : [[]];
      const current = validateCandidateLocalImage(run(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", proof.imageId], cleanupOptions()).stdout,
        proof, expectedTags, expectedRepoDigestSets);
      const removed = observe(commandRunner, "docker", ["image", "rm", ...expectedTags, ...current.repoDigests], cleanupOptions());
      if (removed.error || removed.status !== 0) fail("seaweed_candidate_publish_image_cleanup_failed");
      for (const reference of [proof.imageId, proof.originalTag, tag]) {
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", reference], cleanupOptions()))) {
          fail("seaweed_candidate_publish_image_cleanup_failed");
        }
      }
      const after = parseCandidateImageIds(run(commandRunner, "docker",
        ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (JSON.stringify(after) !== JSON.stringify(priorImageIds)) fail("seaweed_candidate_publish_image_cleanup_failed");
    } catch (error) { cleanupReasons.push(fixedReason(error)); }
  } else if (loadAttempted) {
    try {
      const currentIds = parseCandidateImageIds(run(commandRunner, "docker",
        ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (JSON.stringify(currentIds) !== JSON.stringify(priorImageIds)) {
        fail("seaweed_candidate_publish_image_cleanup_ownership_unverified");
      }
    } catch { cleanupReasons.push("seaweed_candidate_publish_image_cleanup_ownership_unverified"); }
  }
  receipt.phases.push({ name: "owned_docker_cleanup", result: cleanupReasons.length ? "FAILED" : "PASSED",
    ...(cleanupReasons.length ? { reasons: [...cleanupReasons] } : {}), durationMs: now() - cleanupStarted });

  const temporaryStarted = now(); let temporaryFailure;
  try {
    if (!existsSync(work) || lstatSync(work).isSymbolicLink() || realpathSync(work) !== work
      || path.dirname(work) !== context.runnerTemp) fail("seaweed_candidate_publish_cleanup_path_invalid");
    rmSync(work, { recursive: true, force: false });
  } catch (error) { temporaryFailure = error; }
  receipt.phases.push({ name: "owned_temporary_cleanup", result: temporaryFailure ? "FAILED" : "PASSED",
    ...(temporaryFailure ? { reason: fixedReason(temporaryFailure) } : {}), durationMs: now() - temporaryStarted });
  receipt.result = !primaryFailure && cleanupReasons.length === 0 && !temporaryFailure ? "PASSED" : "FAILED";
  if (receipt.result === "PASSED" && receipt.publication === "PUBLISHED_UNADMITTED") receipt.state = "PUBLISHED_UNADMITTED";
  else if (receipt.publication !== "PUBLISHED_UNADMITTED") receipt.state = pushAttempted ? "OUTCOME_UNCONFIRMED" : "FAILED_BEFORE_PUBLICATION";
  writeReceipt(parsed.output, receipt);
  if (primaryFailure) throw new Error(fixedReason(primaryFailure));
  if (cleanupReasons.length) throw new Error(cleanupReasons[0]);
  if (temporaryFailure) throw new Error(fixedReason(temporaryFailure));
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { await runSeaweedCandidatePublish(); }
  catch (error) { console.error(`seaweed_candidate_publish_failed:${fixedReason(error)}`); process.exitCode = 1; }
}
