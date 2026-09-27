import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync,
  realpathSync, readdirSync, rmSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

import { validateSavedSeaweedCandidate } from "./candidate-archive.mjs";
import { classifyAnonymousRemoteRead } from "./package-private-read.mjs";

const MiB = 1024 ** 2;
const MAX_OUTPUT_BYTES = MiB;
const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
const COMMAND_TIMEOUT_MS = 15 * 60_000;
const CLEANUP_COMMAND_TIMEOUT_MS = 4 * 60_000;
const OPERATION_TIMEOUT_MS = 75 * 60_000;
const CLEANUP_TIMEOUT_MS = 10 * 60_000;
const EXPECTED_SERVER_VERSION = "28.0.4";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const TAG_LABEL = /^candidate-[1-9][0-9]{0,19}-attempt-1$/u;
const CONFIG_MEDIA_TYPES = new Set([
  "application/vnd.docker.container.image.v1+json",
  "application/vnd.oci.image.config.v1+json",
]);
const MANIFEST_MEDIA_TYPES = new Set([
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
]);
const LAYER_MEDIA_TYPES = new Set([
  "application/vnd.docker.image.rootfs.diff.tar.gzip",
  "application/vnd.oci.image.layer.v1.tar+gzip",
]);

function fail(code) { throw new Error(code); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function fixedReason(error) {
  const value = error instanceof Error ? error.message : "seaweed_remote_candidate_unknown_failure";
  return /^seaweed_remote_candidate_[a-z0-9_]+$/u.test(value)
    ? value : "seaweed_remote_candidate_command_failed";
}
function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, cloneFrozen(item)])));
  return value;
}

export function validateRemoteSeaweedCandidatePolicy(value) {
  if (!exactKeys(value, ["kind", "authority", "repository", "owner", "image", "platform", "publishedTag",
    "subject", "manifest", "candidate", "publisher", "source"])) fail("seaweed_remote_candidate_policy_invalid");
  if (!exactKeys(value.manifest, ["digest", "bytes", "mediaType", "config", "layer"])
    || !exactKeys(value.manifest.config, ["digest", "size", "mediaType"])
    || !exactKeys(value.manifest.layer, ["digest", "size", "mediaType", "compressedSizeVerification"])
    || !exactKeys(value.candidate, ["imageId", "diffId", "rawSize", "memberCount"])
    || !exactKeys(value.publisher, ["workflowPath", "runId", "runNumber", "runAttempt", "recipeRevision", "receiptSha256"])
    || !exactKeys(value.source, ["runId", "codeRevision", "binaryDigest", "baseManifestDigest", "archiveSha256",
      "archiveBytes", "configSha256", "configBytes", "savedLayerSha256", "savedLayerBytes"])) {
    fail("seaweed_remote_candidate_policy_invalid");
  }
  const { manifest, candidate, publisher, source } = value;
  if (value.kind !== "SEAWEED_REMOTE_CANDIDATE_POLICY_V1" || value.authority !== "REVIEWED_MAIN_POLICY"
    || value.repository !== "CleMeY15/auto-world" || value.owner !== "CleMeY15"
    || value.image !== "ghcr.io/clemey15/auto-world-seaweedfs-s3" || value.platform !== "linux/amd64"
    || !TAG_LABEL.test(value.publishedTag) || value.publishedTag !== `candidate-${publisher.runId}-attempt-1`
    || value.subject !== `${value.image}@${manifest.digest}` || !DIGEST.test(manifest.digest)
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 2 || manifest.bytes > MAX_OUTPUT_BYTES
    || !MANIFEST_MEDIA_TYPES.has(manifest.mediaType) || !CONFIG_MEDIA_TYPES.has(manifest.config.mediaType)
    || !LAYER_MEDIA_TYPES.has(manifest.layer.mediaType) || manifest.layer.compressedSizeVerification !== "RECORDED_ONLY"
    || !DIGEST.test(manifest.config.digest) || !Number.isSafeInteger(manifest.config.size)
    || manifest.config.size < 1 || manifest.config.size > MAX_OUTPUT_BYTES
    || !DIGEST.test(manifest.layer.digest) || !Number.isSafeInteger(manifest.layer.size)
    || manifest.layer.size < 1 || manifest.layer.size > MAX_ARCHIVE_BYTES
    || !DIGEST.test(candidate.imageId) || candidate.imageId !== manifest.config.digest
    || !DIGEST.test(candidate.diffId) || !Number.isSafeInteger(candidate.rawSize)
    || candidate.rawSize < 1024 || candidate.rawSize > MAX_ARCHIVE_BYTES
    || !Number.isSafeInteger(candidate.memberCount) || candidate.memberCount < 1 || candidate.memberCount > 100_000
    || publisher.workflowPath !== ".github/workflows/seaweed-candidate-publish.yml"
    || !RUN_ID.test(publisher.runId) || publisher.runNumber !== "1" || publisher.runAttempt !== "1"
    || !REVISION.test(publisher.recipeRevision) || !SHA256.test(publisher.receiptSha256)
    || !RUN_ID.test(source.runId) || !REVISION.test(source.codeRevision)
    || !DIGEST.test(source.binaryDigest) || !DIGEST.test(source.baseManifestDigest)
    || !SHA256.test(source.archiveSha256) || !Number.isSafeInteger(source.archiveBytes)
    || source.archiveBytes < 1024 || source.archiveBytes > MAX_ARCHIVE_BYTES
    || !SHA256.test(source.configSha256) || !Number.isSafeInteger(source.configBytes)
    || source.configBytes !== manifest.config.size || candidate.imageId !== `sha256:${source.configSha256}`
    || !SHA256.test(source.savedLayerSha256) || !Number.isSafeInteger(source.savedLayerBytes)
    || source.savedLayerBytes !== candidate.rawSize) fail("seaweed_remote_candidate_policy_invalid");
  return cloneFrozen(value);
}

export function validateRemoteCandidateRawManifest(raw, policyInput) {
  const policy = validateRemoteSeaweedCandidatePolicy(policyInput);
  if (typeof raw !== "string") fail("seaweed_remote_candidate_manifest_invalid");
  const bytes = Buffer.from(raw, "utf8");
  if (bytes.length !== policy.manifest.bytes || `sha256:${sha256(bytes)}` !== policy.manifest.digest) {
    fail("seaweed_remote_candidate_manifest_invalid");
  }
  let value;
  try { value = JSON.parse(raw); } catch { fail("seaweed_remote_candidate_manifest_invalid"); }
  if (!exactKeys(value, ["schemaVersion", "mediaType", "config", "layers"])
    || !exactKeys(value.config, ["mediaType", "digest", "size"])
    || !Array.isArray(value.layers) || value.layers.length !== 1
    || !exactKeys(value.layers[0], ["mediaType", "digest", "size"])
    || value.schemaVersion !== 2 || value.mediaType !== policy.manifest.mediaType
    || value.config.mediaType !== policy.manifest.config.mediaType
    || value.config.digest !== policy.manifest.config.digest || value.config.size !== policy.manifest.config.size
    || value.layers[0].mediaType !== policy.manifest.layer.mediaType
    || value.layers[0].digest !== policy.manifest.layer.digest || value.layers[0].size !== policy.manifest.layer.size) {
    fail("seaweed_remote_candidate_manifest_invalid");
  }
  return Object.freeze({ digest: policy.manifest.digest, bytes: bytes.length, state: "RAW_MANIFEST_VERIFIED",
    config: policy.manifest.config, layer: policy.manifest.layer });
}

function validateInput(input) {
  if (!exactKeys(input, ["parent", "policy", "runId", "recipeRevision", "signal",
    "validateFilesystem", "validateRuntimeConfig"])) fail("seaweed_remote_candidate_arguments_invalid");
  const policy = validateRemoteSeaweedCandidatePolicy(input.policy);
  if (typeof input.parent !== "string" || !path.isAbsolute(input.parent) || path.normalize(input.parent) !== input.parent
    || !RUN_ID.test(input.runId) || !REVISION.test(input.recipeRevision)
    || input.signal !== undefined && !(input.signal instanceof globalThis.AbortSignal)
    || typeof input.validateFilesystem !== "function" || typeof input.validateRuntimeConfig !== "function") {
    fail("seaweed_remote_candidate_arguments_invalid");
  }
  return { ...input, policy };
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
  return spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", env: options.env, input: options.input,
    maxBuffer: MAX_OUTPUT_BYTES, timeout: options.timeoutMs, windowsHide: true });
}
function observe(commandRunner, command, args, options) {
  if (options.signal?.aborted) fail("seaweed_remote_candidate_aborted");
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    fail("seaweed_remote_candidate_output_exceeded");
  }
  if (options.signal?.aborted) fail("seaweed_remote_candidate_aborted");
  return { error: result?.error, status: result?.status, stdout, stderr };
}
function run(commandRunner, command, args, options) {
  const result = observe(commandRunner, command, args, options);
  if (result.error || result.status !== 0) fail("seaweed_remote_candidate_command_failed");
  return result;
}
function bounded(value) {
  const result = value.trim();
  if (result.length < 1 || result.length > 512 || /[^\x20-\x7e]/u.test(result)) {
    fail("seaweed_remote_candidate_tool_identity_invalid");
  }
  return result;
}
function operationOptions(base, started, now, signal) {
  const remaining = OPERATION_TIMEOUT_MS - (now() - started);
  if (signal.aborted || remaining <= 0) fail("seaweed_remote_candidate_operation_timeout");
  return { ...base, signal, timeoutMs: Math.min(COMMAND_TIMEOUT_MS, remaining) };
}
export function remoteCandidateCleanupOptions(base, started, now = Date.now) {
  const remaining = CLEANUP_TIMEOUT_MS - (now() - started);
  if (remaining <= 0) fail("seaweed_remote_candidate_cleanup_timeout");
  return { ...base, timeoutMs: Math.min(CLEANUP_COMMAND_TIMEOUT_MS, remaining) };
}

function assertPrivateEmptyDirectory(directory) {
  if (!existsSync(directory)) fail("seaweed_remote_candidate_parent_invalid");
  const info = lstatSync(directory); const uid = process.getuid?.() ?? 0;
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory
    || info.uid !== uid || (info.mode & 0o777) !== 0o700 || readdirSync(directory).length !== 0) {
    fail("seaweed_remote_candidate_parent_invalid");
  }
}
function imageIds(raw) {
  const values = raw.split(/\r?\n/u).filter(Boolean);
  if (values.some((value) => !DIGEST.test(value))) fail("seaweed_remote_candidate_inventory_invalid");
  return [...new Set(values)].sort();
}
function expectedInventory(prior, imageId) { return [...new Set([...prior, imageId])].sort(); }
function sameArray(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function inspectAbsent(result) {
  if (result.status === 1 && /no such (?:image|object)/iu.test(`${result.stdout}\n${result.stderr}`)) return true;
  if (result.status === 0) return false;
  fail("seaweed_remote_candidate_local_inspect_failed");
}

export function validateRemoteCandidateImage(raw, policyInput, alias) {
  const policy = validateRemoteSeaweedCandidatePolicy(policyInput);
  let value;
  try { value = JSON.parse(raw); } catch { fail("seaweed_remote_candidate_image_invalid"); }
  const tags = value?.RepoTags === null ? [] : value?.RepoTags;
  if (value?.Id !== policy.candidate.imageId || value?.Os !== "linux" || value?.Architecture !== "amd64"
    || !Number.isSafeInteger(value?.Size) || value.Size < 1 || value.Size > MAX_ARCHIVE_BYTES
    || value?.RootFS?.Type !== "layers" || !sameArray(value.RootFS?.Layers, [policy.candidate.diffId])
    || !sameArray(tags, alias === undefined ? [] : [alias])
    || !sameArray(value?.RepoDigests, [policy.subject])) fail("seaweed_remote_candidate_image_invalid");
  return Object.freeze({ imageId: value.Id, diffId: value.RootFS.Layers[0], platform: policy.platform,
    size: value.Size, repoDigest: policy.subject, alias: alias ?? null, config: value.Config });
}

function createPrivateFile(file) {
  const uid = process.getuid?.() ?? 0;
  const handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    fchmodSync(handle, 0o600); const info = fstatSync(handle);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== uid || (info.mode & 0o777) !== 0o600 || info.size !== 0) {
      fail("seaweed_remote_candidate_archive_file_invalid");
    }
    return Object.freeze({ dev: info.dev, ino: info.ino, uid: info.uid });
  } finally { closeSync(handle); }
}
function validatePrivateFile(file, identity) {
  const info = lstatSync(file); const uid = process.getuid?.() ?? 0;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== uid
    || (info.mode & 0o777) !== 0o600 || info.dev !== identity.dev || info.ino !== identity.ino
    || info.size < 1024 || info.size > MAX_ARCHIVE_BYTES) fail("seaweed_remote_candidate_archive_file_invalid");
}

function validateArchiveProof(proof, policy, alias) {
  if (!exactKeys(proof, ["kind", "authority", "candidateAuthorization", "imageId", "identityType", "tag",
    "serverVersion", "archiveSha256", "archiveBytes", "archiveMembers", "configSha256", "configBytes",
    "layerSha256", "layerBytes", "diffId", "rawSize", "memberCount"])
    || proof.kind !== "SEAWEED_SAVED_CANDIDATE_PROOF_V1" || proof.authority !== "PREPARATION_ONLY"
    || proof.candidateAuthorization !== "NOT_AUTHORIZED" || proof.identityType !== "CLASSIC_CONFIG_ID"
    || proof.imageId !== policy.candidate.imageId || proof.tag !== alias || proof.diffId !== policy.candidate.diffId
    || proof.rawSize !== policy.candidate.rawSize || proof.memberCount !== policy.candidate.memberCount
    || proof.serverVersion !== EXPECTED_SERVER_VERSION || proof.configSha256 !== policy.source.configSha256
    || proof.configBytes !== policy.source.configBytes || proof.layerSha256 !== policy.source.savedLayerSha256
    || proof.layerBytes !== policy.source.savedLayerBytes || !SHA256.test(proof.archiveSha256)
    || !Number.isSafeInteger(proof.archiveBytes) || proof.archiveBytes < 1024 || proof.archiveBytes > MAX_ARCHIVE_BYTES) {
    fail("seaweed_remote_candidate_archive_invalid");
  }
  return cloneFrozen(proof);
}

export function validateRemoteSeaweedCandidateReceipt(receipt, policyInput) {
  const policy = validateRemoteSeaweedCandidatePolicy(policyInput);
  if (!exactKeys(receipt, ["kind", "state", "authority", "candidateAuthorization", "publication", "execution",
    "registryWrite", "runId", "recipeRevision", "subject", "alias", "remoteManifest", "engine", "image",
    "archive", "provenance", "phases"])
    || !exactKeys(receipt.remoteManifest, ["digest", "bytes", "state", "config", "layer"])
    || !exactKeys(receipt.engine, ["state", "docker", "buildx", "serverVersion", "pullResponse",
      "compressedDigestVerification", "compressedSizeVerification"])
    || !exactKeys(receipt.image, ["imageId", "diffId", "platform"])
    || !exactKeys(receipt.archive, ["state", "imageId", "diffId", "archiveSha256", "archiveBytes", "saveResponse"])
    || !exactKeys(receipt.provenance, ["publisherRunId", "publisherRecipeRevision", "publisherReceiptSha256",
      "sourceRunId", "sourceCodeRevision"])
    || receipt.kind !== "SEAWEED_REMOTE_CANDIDATE_RECEIPT_V1"
    || receipt.state !== "VERIFIED" || receipt.authority !== "REMOTE_READ_ONLY"
    || receipt.candidateAuthorization !== "NOT_AUTHORIZED" || receipt.publication !== "PUBLISHED_UNADMITTED"
    || receipt.execution !== "NOT_ATTEMPTED" || receipt.registryWrite !== "NOT_ATTEMPTED"
    || !RUN_ID.test(receipt.runId) || !REVISION.test(receipt.recipeRevision)
    || receipt.subject !== policy.subject || receipt.alias !== `auto-world-seaweed-s3:remote-${receipt.runId}-attempt-1`
    || receipt.remoteManifest?.state !== "RAW_MANIFEST_VERIFIED"
    || receipt.remoteManifest?.digest !== policy.manifest.digest || receipt.remoteManifest?.bytes !== policy.manifest.bytes
    || JSON.stringify(receipt.remoteManifest.config) !== JSON.stringify(policy.manifest.config)
    || JSON.stringify(receipt.remoteManifest.layer) !== JSON.stringify(policy.manifest.layer)
    || receipt.engine?.state !== "ENGINE_VERIFIED" || receipt.engine?.serverVersion !== EXPECTED_SERVER_VERSION
    || typeof receipt.engine.docker !== "string" || receipt.engine.docker.length < 1 || receipt.engine.docker.length > 512
    || typeof receipt.engine.buildx !== "string" || receipt.engine.buildx.length < 1 || receipt.engine.buildx.length > 512
    || !["SUCCESS", "FAILED_BUT_EXACT_STATE_CONFIRMED"].includes(receipt.engine.pullResponse)
    || receipt.engine.compressedDigestVerification !== "MANAGED_MOBY_PULL"
    || receipt.engine.compressedSizeVerification !== "RECORDED_ONLY"
    || receipt.image?.imageId !== policy.candidate.imageId || receipt.image?.diffId !== policy.candidate.diffId
    || receipt.image?.platform !== policy.platform
    || receipt.archive?.state !== "ARCHIVE_VERIFIED" || receipt.archive?.imageId !== policy.candidate.imageId
    || receipt.archive?.diffId !== policy.candidate.diffId || !SHA256.test(receipt.archive?.archiveSha256 ?? "")
    || !Number.isSafeInteger(receipt.archive?.archiveBytes) || receipt.archive.archiveBytes < 1024
    || !["SUCCESS", "FAILED_BUT_EXACT_ARCHIVE_CONFIRMED"].includes(receipt.archive.saveResponse)
    || receipt.provenance?.publisherRunId !== policy.publisher.runId
    || receipt.provenance?.publisherRecipeRevision !== policy.publisher.recipeRevision
    || receipt.provenance?.publisherReceiptSha256 !== policy.publisher.receiptSha256
    || receipt.provenance?.sourceRunId !== policy.source.runId
    || receipt.provenance?.sourceCodeRevision !== policy.source.codeRevision
    || !Array.isArray(receipt.phases) || receipt.phases.length < 1
    || receipt.phases.some((phase) => !exactKeys(phase, ["name", "result", "durationMs"])
      || typeof phase.name !== "string" || phase.name.length < 1 || phase.name.length > 128
      || phase.result !== "PASSED" || !Number.isSafeInteger(phase.durationMs) || phase.durationMs < 0)) {
    fail("seaweed_remote_candidate_receipt_invalid");
  }
  return cloneFrozen(receipt);
}

export async function withVerifiedRemoteSeaweedCandidate(inputValue, inspectArchive, dependencies = {}) {
  const input = validateInput(inputValue);
  if (typeof inspectArchive !== "function" || !plain(dependencies)
    || Object.keys(dependencies).some((key) => !["commandRunner", "validateArchive", "now", "platform", "env"].includes(key))) {
    fail("seaweed_remote_candidate_arguments_invalid");
  }
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "linux") fail("seaweed_remote_candidate_requires_linux");
  if (input.signal?.aborted) fail("seaweed_remote_candidate_aborted");
  assertPrivateEmptyDirectory(input.parent);
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  const archiveValidator = dependencies.validateArchive ?? validateSavedSeaweedCandidate;
  const now = dependencies.now ?? Date.now; const env = dependencies.env ?? process.env; const started = now();
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN.length < 1 || env.GITHUB_TOKEN.length > 8192) {
    fail("seaweed_remote_candidate_environment_invalid");
  }
  const operationController = new globalThis.AbortController();
  const abort = () => operationController.abort(); input.signal?.addEventListener("abort", abort, { once: true });
  const timer = globalThis.setTimeout(() => operationController.abort(), OPERATION_TIMEOUT_MS); timer.unref?.();
  const work = path.join(input.parent, `remote-${input.runId}-attempt-1`);
  mkdirSync(work, { mode: 0o700 });
  const auth = path.join(work, "docker-auth"); const anonymous = path.join(work, "docker-anonymous");
  mkdirSync(auth, { mode: 0o700 }); mkdirSync(anonymous, { mode: 0o700 });
  mkdirSync(path.join(auth, "buildx"), { mode: 0o700 }); mkdirSync(path.join(anonymous, "buildx"), { mode: 0o700 });
  const authBase = { cwd: work, env: commandEnvironment(env, auth, work) };
  const anonymousBase = { cwd: work, env: commandEnvironment(env, anonymous, work) };
  const options = (base) => operationOptions(base, started, now, operationController.signal);
  const policy = input.policy; const published = `${policy.image}:${policy.publishedTag}`;
  const alias = `auto-world-seaweed-s3:remote-${input.runId}-attempt-1`;
  const archiveFile = path.join(work, "candidate.tar");
  const phases = []; const phase = async (name, operation) => {
    const phaseStarted = now();
    try { const result = await operation(); phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted }); return result; }
    catch (error) { phases.push({ name, result: "FAILED", reason: fixedReason(error), durationMs: now() - phaseStarted }); throw error; }
  };
  let primaryFailure; let result; let priorIds = []; let pullAttempted = false; let owned = false; let tagged = false;
  try {
    const version = bounded((await phase("managed_engine", () => run(commandRunner, "docker",
      ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], options(authBase)))).stdout);
    const parts = version.split("|");
    if (parts.length !== 2 || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(parts[0])
      || parts[1] !== EXPECTED_SERVER_VERSION) fail("seaweed_remote_candidate_engine_invalid");
    const buildx = bounded(run(commandRunner, "docker", ["buildx", "version"], options(authBase)).stdout);
    await phase("registry_login", () => run(commandRunner, "docker", ["login", "ghcr.io", "--username",
      policy.owner, "--password-stdin"], { ...options(authBase), input: `${env.GITHUB_TOKEN}\n` }));
    const rawTag = await phase("raw_tag_manifest", () => run(commandRunner, "docker",
      ["buildx", "imagetools", "inspect", "--raw", published], options(authBase)).stdout);
    const manifest = validateRemoteCandidateRawManifest(rawTag, policy);
    await phase("anonymous_digest_denied", () => {
      const remote = observe(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", policy.subject], options(anonymousBase));
      try {
        if (classifyAnonymousRemoteRead(remote) !== "AUTHORIZATION_DENIED") fail("seaweed_remote_candidate_privacy_invalid");
      } catch { fail("seaweed_remote_candidate_privacy_invalid"); }
    });
    await phase("raw_digest_manifest", () => {
      const rawDigest = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", policy.subject], options(authBase)).stdout;
      if (rawDigest !== rawTag) fail("seaweed_remote_candidate_manifest_mismatch");
      validateRemoteCandidateRawManifest(rawDigest, policy);
    });
    priorIds = await phase("local_inventory_before", () => imageIds(run(commandRunner, "docker",
      ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], options(authBase)).stdout));
    await phase("local_collision_check", () => {
      for (const reference of [policy.subject, alias]) {
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", reference], options(authBase)))) {
          fail("seaweed_remote_candidate_local_collision");
        }
      }
    });
    const pullResult = await phase("exact_digest_pull", () => {
      pullAttempted = true;
      return observe(commandRunner, "docker", ["pull", "--platform", policy.platform, policy.subject], options(authBase));
    });
    const idsAfterPull = imageIds(run(commandRunner, "docker",
      ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], options(authBase)).stdout);
    if (sameArray(idsAfterPull, expectedInventory(priorIds, policy.candidate.imageId))) {
      const inspected = observe(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", policy.subject], options(authBase));
      if (inspected.status === 0) {
        const image = validateRemoteCandidateImage(inspected.stdout, policy);
        owned = true; input.validateRuntimeConfig(image.config);
      }
    }
    if (!owned) fail("seaweed_remote_candidate_pull_ownership_unverified");
    const pullResponse = pullResult.error || pullResult.status !== 0 ? "FAILED_BUT_EXACT_STATE_CONFIRMED" : "SUCCESS";
    await phase("simple_local_alias", () => {
      const response = observe(commandRunner, "docker", ["image", "tag", policy.subject, alias], options(authBase));
      const image = validateRemoteCandidateImage(run(commandRunner, "docker",
        ["image", "inspect", "--format", "{{json .}}", policy.subject], options(authBase)).stdout, policy, alias);
      input.validateRuntimeConfig(image.config); tagged = true;
      if (response.error || response.status !== 0) return "FAILED_BUT_EXACT_STATE_CONFIRMED";
      return "SUCCESS";
    });
    const fileIdentity = createPrivateFile(archiveFile);
    const saveResult = await phase("private_docker_save", () => observe(commandRunner, "docker",
      ["image", "save", "--output", archiveFile, alias], options(authBase)));
    validatePrivateFile(archiveFile, fileIdentity);
    const archiveProof = validateArchiveProof(await phase("full_archive_validation", () => archiveValidator({
      file: archiveFile, imageId: policy.candidate.imageId, tag: alias, diffId: policy.candidate.diffId,
      rawSize: policy.candidate.rawSize, memberCount: policy.candidate.memberCount,
      serverVersion: EXPECTED_SERVER_VERSION, validateFilesystem: input.validateFilesystem,
      validateRuntimeConfig: input.validateRuntimeConfig, signal: operationController.signal,
    })), policy, alias);
    const saveResponse = saveResult.error || saveResult.status !== 0 ? "FAILED_BUT_EXACT_ARCHIVE_CONFIRMED" : "SUCCESS";
    const snapshot = Object.freeze({ file: archiveFile, archiveProof, policy, subject: policy.subject,
      imageId: policy.candidate.imageId, diffId: policy.candidate.diffId, runId: input.runId,
      recipeRevision: input.recipeRevision, signal: operationController.signal });
    await phase("private_archive_callback", () => inspectArchive(snapshot));
    result = { kind: "SEAWEED_REMOTE_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "REMOTE_READ_ONLY",
      candidateAuthorization: "NOT_AUTHORIZED", publication: "PUBLISHED_UNADMITTED", execution: "NOT_ATTEMPTED",
      registryWrite: "NOT_ATTEMPTED", runId: input.runId, recipeRevision: input.recipeRevision,
      subject: policy.subject, alias, remoteManifest: manifest,
      engine: { state: "ENGINE_VERIFIED", docker: version, buildx, serverVersion: EXPECTED_SERVER_VERSION,
        pullResponse, compressedDigestVerification: "MANAGED_MOBY_PULL", compressedSizeVerification: "RECORDED_ONLY" },
      image: { imageId: policy.candidate.imageId, diffId: policy.candidate.diffId, platform: policy.platform },
      archive: { state: "ARCHIVE_VERIFIED", imageId: archiveProof.imageId, diffId: archiveProof.diffId,
        archiveSha256: archiveProof.archiveSha256, archiveBytes: archiveProof.archiveBytes, saveResponse },
      provenance: { publisherRunId: policy.publisher.runId, publisherRecipeRevision: policy.publisher.recipeRevision,
        publisherReceiptSha256: policy.publisher.receiptSha256, sourceRunId: policy.source.runId,
        sourceCodeRevision: policy.source.codeRevision }, phases };
  } catch (error) { primaryFailure = error; }
  finally { globalThis.clearTimeout(timer); input.signal?.removeEventListener("abort", abort); }

  const cleanupStarted = now(); const cleanupFailures = [];
  const cleanupOptions = () => remoteCandidateCleanupOptions(authBase, cleanupStarted, now);
  if (owned) {
    try {
      const current = imageIds(run(commandRunner, "docker", ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (!sameArray(current, expectedInventory(priorIds, policy.candidate.imageId))) fail("seaweed_remote_candidate_cleanup_ownership_unverified");
      validateRemoteCandidateImage(run(commandRunner, "docker",
        ["image", "inspect", "--format", "{{json .}}", policy.subject], cleanupOptions()).stdout, policy, tagged ? alias : undefined);
      const references = tagged ? [alias, policy.subject] : [policy.subject];
      const removed = observe(commandRunner, "docker", ["image", "rm", ...references], cleanupOptions());
      if (removed.error || removed.status !== 0) fail("seaweed_remote_candidate_image_cleanup_failed");
      for (const reference of [alias, policy.subject, policy.candidate.imageId]) {
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", reference], cleanupOptions()))) {
          fail("seaweed_remote_candidate_image_cleanup_failed");
        }
      }
      const after = imageIds(run(commandRunner, "docker", ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (!sameArray(after, priorIds)) fail("seaweed_remote_candidate_image_cleanup_failed");
    } catch (error) { cleanupFailures.push(fixedReason(error)); }
  } else if (pullAttempted) {
    try {
      const current = imageIds(run(commandRunner, "docker", ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (!sameArray(current, priorIds)) fail("seaweed_remote_candidate_cleanup_ownership_unverified");
    } catch { cleanupFailures.push("seaweed_remote_candidate_cleanup_ownership_unverified"); }
  }
  phases.push({ name: "owned_docker_cleanup", result: cleanupFailures.length ? "FAILED" : "PASSED",
    ...(cleanupFailures.length ? { reasons: cleanupFailures } : {}), durationMs: now() - cleanupStarted });
  let temporaryFailure; const temporaryStarted = now();
  try {
    if (!existsSync(work) || lstatSync(work).isSymbolicLink() || realpathSync(work) !== work
      || path.dirname(work) !== input.parent) fail("seaweed_remote_candidate_temporary_cleanup_failed");
    rmSync(work, { recursive: true, force: false });
    assertPrivateEmptyDirectory(input.parent);
  } catch (error) { temporaryFailure = error; }
  phases.push({ name: "owned_temporary_cleanup", result: temporaryFailure ? "FAILED" : "PASSED",
    ...(temporaryFailure ? { reason: fixedReason(temporaryFailure) } : {}), durationMs: now() - temporaryStarted });
  if (primaryFailure) throw new Error(fixedReason(primaryFailure));
  if (cleanupFailures.length) throw new Error(cleanupFailures[0]);
  if (temporaryFailure) throw new Error(fixedReason(temporaryFailure));
  return validateRemoteSeaweedCandidateReceipt(result, policy);
}
