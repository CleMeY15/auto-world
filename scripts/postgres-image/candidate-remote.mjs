import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, readdirSync, rmSync, writeSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import path from "node:path";
import process from "node:process";

import { validatePostgresCandidateArchive, validatePostgresCandidateRemoteManifest } from "./candidate-proof.mjs";
import { classifyAnonymousRemoteRead } from "../package-bootstrap/registry-proof.mjs";

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
const SCANNER_PHASE_NAMES = Object.freeze([
  "managed_engine", "registry_login", "raw_tag_manifest", "anonymous_digest_denied", "raw_digest_manifest",
  "local_inventory_before", "local_collision_check", "exact_digest_pull", "simple_local_alias",
  "private_docker_save", "full_archive_validation", "private_archive_callback", "owned_docker_cleanup",
  "owned_temporary_cleanup",
]);
const RUNTIME_PHASE_NAMES = Object.freeze(SCANNER_PHASE_NAMES.map((name) =>
  name === "private_archive_callback" ? "runtime_diagnostics" : name));
const PUBLICATION_PHASE_NAMES = Object.freeze([
  "checkout_and_source_closure", "protected_main_before_credentials", "managed_tool_identity",
  "local_collision_and_inventory", "exact_public_base_manifest", "exact_public_base_pull",
  "fixed_offline_candidate_build", "base_stopped_container_export", "candidate_stopped_container_export",
  "filesystem_policy", "bounded_candidate_archive", "authorized_registry_login",
  "private_bootstrap_auth_anonymous_auth", "unique_remote_tag_absent", "candidate_remote_tag",
  "protected_main_immediately_pre_push", "single_candidate_push", "exact_remote_manifest",
  "exact_remote_digest_roundtrip", "anonymous_candidate_denied", "owned_docker_cleanup",
  "owned_temporary_cleanup",
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
  const value = error instanceof Error ? error.message : "postgres_remote_candidate_unknown_failure";
  return /^postgres_remote_candidate_[a-z0-9_]+$/u.test(value)
    ? value : "postgres_remote_candidate_command_failed";
}
function localAlias(runId, recipeRevision) {
  return `aw-postgres-gosu:${sha256(Buffer.from(`${runId}:${recipeRevision}`, "utf8")).slice(0, 24)}`;
}
function inspectionFailure() {
  return Object.assign(new Error("postgres_candidate_inspection_failed"), {
    code: "postgres_candidate_inspection_failed", state: "INCOMPLETE", authority: "PREPARATION_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED",
  });
}
function isInspectionFailure(error) {
  return error?.message === "postgres_candidate_inspection_failed"
    && error.code === "postgres_candidate_inspection_failed" && error.state === "INCOMPLETE"
    && error.authority === "PREPARATION_ONLY" && error.candidateAuthorization === "NOT_AUTHORIZED"
    && Object.keys(error).sort().join("|") === "authority|candidateAuthorization|code|state";
}
function runtimeMaterialFailure({ inspectionFailed, primaryFailure, runtimeCleanupFailure,
  imageCleanupFailure, temporaryCleanupFailure }) {
  const code = runtimeCleanupFailure || imageCleanupFailure || temporaryCleanupFailure
    ? "postgres_remote_runtime_cleanup_uncertain" : "postgres_remote_runtime_material_failed";
  return Object.assign(new Error(code), { code, inspectionFailed, primaryFailure,
    runtimeCleanupFailure, imageCleanupFailure, temporaryCleanupFailure });
}
function runtimeDiagnosticsFailure(cleanupFailure) {
  return new Error(cleanupFailure ?? "postgres_remote_runtime_diagnostics_failed");
}
function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, cloneFrozen(item)])));
  return value;
}

export function validatePostgresRemotePolicy(value) {
  if (!exactKeys(value, ["kind", "authority", "repository", "owner", "image", "platform", "publishedTag",
    "subject", "manifest", "candidate", "publisher"])) fail("postgres_remote_candidate_policy_invalid");
  if (!exactKeys(value.manifest, ["digest", "bytes", "mediaType", "config", "layers", "baseLayerCount", "newLayerCount"])
    || !exactKeys(value.manifest.config, ["digest", "size", "mediaType"])
    || !Array.isArray(value.manifest.layers) || value.manifest.layers.length !== 12
    || value.manifest.layers.some((layer) => !exactKeys(layer, ["digest", "size", "mediaType"]))
    || !exactKeys(value.candidate, ["imageId", "diffIds"])
    || !exactKeys(value.publisher, ["workflowPath", "runId", "runNumber", "runAttempt", "recipeRevision",
      "receiptSha256", "receiptBytes", "result"])) {
    fail("postgres_remote_candidate_policy_invalid");
  }
  const { manifest, candidate, publisher } = value;
  if (value.kind !== "POSTGRES_REMOTE_CANDIDATE_POLICY_V1" || value.authority !== "REVIEWED_MAIN_POLICY"
    || value.repository !== "CleMeY15/auto-world" || value.owner !== "CleMeY15"
    || value.image !== "ghcr.io/clemey15/auto-world-postgres-gosu" || value.platform !== "linux/amd64"
    || !TAG_LABEL.test(value.publishedTag) || value.publishedTag !== `candidate-${publisher.runId}-attempt-1`
    || value.subject !== `${value.image}@${manifest.digest}` || !DIGEST.test(manifest.digest)
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 2 || manifest.bytes > MAX_OUTPUT_BYTES
    || !MANIFEST_MEDIA_TYPES.has(manifest.mediaType) || !CONFIG_MEDIA_TYPES.has(manifest.config.mediaType)
    || !DIGEST.test(manifest.config.digest) || !Number.isSafeInteger(manifest.config.size)
    || manifest.config.size < 1 || manifest.config.size > MAX_OUTPUT_BYTES
    || manifest.layers.some((layer) => !DIGEST.test(layer.digest) || !Number.isSafeInteger(layer.size)
      || layer.size < 1 || layer.size > MAX_ARCHIVE_BYTES || !LAYER_MEDIA_TYPES.has(layer.mediaType))
    || new Set(manifest.layers.map((layer) => layer.digest)).size !== 12
    || manifest.baseLayerCount !== 10 || manifest.newLayerCount !== 2
    || !DIGEST.test(candidate.imageId) || candidate.imageId !== manifest.config.digest
    || !Array.isArray(candidate.diffIds) || candidate.diffIds.length !== 12
    || candidate.diffIds.some((value) => !DIGEST.test(value)) || new Set(candidate.diffIds).size !== 12
    || publisher.workflowPath !== ".github/workflows/postgres-candidate-publish-v4.yml"
    || !RUN_ID.test(publisher.runId) || publisher.runNumber !== "1" || publisher.runAttempt !== "1"
    || !REVISION.test(publisher.recipeRevision) || !SHA256.test(publisher.receiptSha256)
    || publisher.receiptBytes !== 22_970 || publisher.result !== "PASSED") {
    fail("postgres_remote_candidate_policy_invalid");
  }
  return cloneFrozen(value);
}

export function validatePostgresRemoteRawManifest(raw, policyInput) {
  const policy = validatePostgresRemotePolicy(policyInput);
  if (typeof raw !== "string") fail("postgres_remote_candidate_manifest_invalid");
  const bytes = Buffer.from(raw, "utf8");
  if (bytes.length !== policy.manifest.bytes || `sha256:${sha256(bytes)}` !== policy.manifest.digest) {
    fail("postgres_remote_candidate_manifest_invalid");
  }
  let proof;
  try {
    proof = validatePostgresCandidateRemoteManifest(raw, { digest: policy.manifest.digest,
      configDigest: policy.candidate.imageId, expectedLayers: 12, baseLayers: policy.manifest.layers.slice(0, 10) });
  } catch {
    fail("postgres_remote_candidate_manifest_invalid");
  }
  if (proof.size !== policy.manifest.bytes || proof.mediaType !== policy.manifest.mediaType
    || proof.configBytes !== policy.manifest.config.size
    || !sameDescriptors(proof.layers, policy.manifest.layers)
    || proof.baseLayerCount !== 10 || proof.newLayerCount !== 2) fail("postgres_remote_candidate_manifest_invalid");
  return Object.freeze({ digest: proof.sha256, bytes: proof.size, state: "RAW_MANIFEST_VERIFIED",
    mediaType: proof.mediaType, config: policy.manifest.config, layers: proof.layers,
    baseLayerCount: proof.baseLayerCount, newLayerCount: proof.newLayerCount });
}

function validateInput(input) {
  const keys = plain(input) ? Object.keys(input) : [];
  if (!plain(input) || keys.some((key) => !["parent", "policy", "runId", "recipeRevision", "signal"].includes(key))
    || !["parent", "policy", "runId", "recipeRevision"].every((key) => Object.hasOwn(input, key))) {
    fail("postgres_remote_candidate_arguments_invalid");
  }
  const policy = validatePostgresRemotePolicy(input.policy);
  if (typeof input.parent !== "string" || !path.isAbsolute(input.parent) || path.normalize(input.parent) !== input.parent
    || !RUN_ID.test(input.runId) || !REVISION.test(input.recipeRevision)
    || input.signal !== undefined && !(input.signal instanceof globalThis.AbortSignal)) {
    fail("postgres_remote_candidate_arguments_invalid");
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
async function capture(stream, kill) {
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) fail("postgres_remote_candidate_output_exceeded");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) { kill(); throw error; }
}
function saveSink(handle) {
  let written = 0;
  return new Writable({ write(chunk, _encoding, callback) {
    try {
      written += chunk.length;
      if (written > MAX_ARCHIVE_BYTES) fail("postgres_remote_candidate_archive_file_invalid");
      let offset = 0;
      while (offset < chunk.length) {
        const bytesWritten = writeSync(handle, chunk, offset, chunk.length - offset);
        if (bytesWritten < 1) fail("postgres_remote_candidate_archive_file_invalid");
        offset += bytesWritten;
      }
      callback();
    } catch (error) { callback(error); }
  } });
}
async function defaultSaveRunner(command, args, options) {
  const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"] });
  let timedOut = false;
  const kill = () => { if (!child.killed) child.kill("SIGKILL"); };
  const timer = globalThis.setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
  const abort = () => kill();
  options.signal?.addEventListener("abort", abort, { once: true });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status, exitSignal) => resolve({ status, exitSignal }));
  });
  const stdout = pipeline(child.stdout, saveSink(options.handle)); stdout.catch(kill);
  const stderr = capture(child.stderr, kill);
  const results = await Promise.allSettled([exit, stdout, stderr]);
  globalThis.clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
  if (timedOut || options.signal?.aborted || results.some((result) => result.status === "rejected")) {
    fail("postgres_remote_candidate_command_failed");
  }
  return { ...results[0].value, stdout: "", stderr: results[2].value };
}
function observe(commandRunner, command, args, options) {
  if (options.signal?.aborted) fail("postgres_remote_candidate_aborted");
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    fail("postgres_remote_candidate_output_exceeded");
  }
  if (options.signal?.aborted) fail("postgres_remote_candidate_aborted");
  return { error: result?.error, status: result?.status, stdout, stderr };
}
function run(commandRunner, command, args, options) {
  const result = observe(commandRunner, command, args, options);
  if (result.error || result.status !== 0) fail("postgres_remote_candidate_command_failed");
  return result;
}
function bounded(value) {
  const result = value.trim();
  if (result.length < 1 || result.length > 512 || /[^\x20-\x7e]/u.test(result)) {
    fail("postgres_remote_candidate_tool_identity_invalid");
  }
  return result;
}
function operationOptions(base, started, now, signal) {
  const remaining = OPERATION_TIMEOUT_MS - (now() - started);
  if (signal.aborted || remaining <= 0) fail("postgres_remote_candidate_operation_timeout");
  return { ...base, signal, timeoutMs: Math.min(COMMAND_TIMEOUT_MS, remaining) };
}
export function postgresRemoteCleanupOptions(base, started, now = Date.now) {
  const remaining = CLEANUP_TIMEOUT_MS - (now() - started);
  if (remaining <= 0) fail("postgres_remote_candidate_cleanup_timeout");
  return { ...base, timeoutMs: Math.min(CLEANUP_COMMAND_TIMEOUT_MS, remaining) };
}

function assertPrivateEmptyDirectory(directory) {
  if (!existsSync(directory)) fail("postgres_remote_candidate_parent_invalid");
  const info = lstatSync(directory); const uid = process.getuid?.() ?? 0;
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory
    || info.uid !== uid || (info.mode & 0o777) !== 0o700 || readdirSync(directory).length !== 0) {
    fail("postgres_remote_candidate_parent_invalid");
  }
}
function imageIds(raw) {
  const values = raw.split(/\r?\n/u).filter(Boolean);
  if (values.some((value) => !DIGEST.test(value))) fail("postgres_remote_candidate_inventory_invalid");
  return [...new Set(values)].sort();
}
function expectedInventory(prior, imageId) { return [...new Set([...prior, imageId])].sort(); }
function sameArray(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function sameDescriptors(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value?.digest === right[index]?.digest
      && value?.size === right[index]?.size && value?.mediaType === right[index]?.mediaType);
}
function inspectAbsent(result) {
  if (result.status === 1 && /no such (?:image|object)/iu.test(`${result.stdout}\n${result.stderr}`)) return true;
  if (result.status === 0) return false;
  fail("postgres_remote_candidate_local_inspect_failed");
}

export function validatePostgresRemoteImage(raw, policyInput, alias) {
  const policy = validatePostgresRemotePolicy(policyInput);
  let value;
  try { value = JSON.parse(raw); } catch { fail("postgres_remote_candidate_image_invalid"); }
  const tags = value?.RepoTags === null ? [] : value?.RepoTags;
  if (value?.Id !== policy.candidate.imageId || value?.Os !== "linux" || value?.Architecture !== "amd64"
    || !Number.isSafeInteger(value?.Size) || value.Size < 1 || value.Size > MAX_ARCHIVE_BYTES
    || value?.RootFS?.Type !== "layers" || !sameArray(value.RootFS?.Layers, policy.candidate.diffIds)
    || !sameArray(tags, alias === undefined ? [] : [alias])
    || !sameArray(value?.RepoDigests, [policy.subject])) fail("postgres_remote_candidate_image_invalid");
  return Object.freeze({ imageId: value.Id, diffIds: Object.freeze([...value.RootFS.Layers]), platform: policy.platform,
    size: value.Size, repoDigest: policy.subject, alias: alias ?? null, config: value.Config });
}

function createPrivateFile(file) {
  const uid = process.getuid?.() ?? 0;
  const handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    fchmodSync(handle, 0o600); const info = fstatSync(handle);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== uid || (info.mode & 0o777) !== 0o600 || info.size !== 0) {
      fail("postgres_remote_candidate_archive_file_invalid");
    }
    return Object.freeze({ handle, identity: Object.freeze({ dev: info.dev, ino: info.ino, uid: info.uid }) });
  } catch (error) { closeSync(handle); throw error; }
}
function validatePrivateFile(file, identity) {
  const info = lstatSync(file); const uid = process.getuid?.() ?? 0;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== uid
    || (info.mode & 0o777) !== 0o600 || info.dev !== identity.dev || info.ino !== identity.ino
    || info.size < 1024 || info.size > MAX_ARCHIVE_BYTES) fail("postgres_remote_candidate_archive_file_invalid");
}

function validateArchiveProof(proof, policy, alias) {
  if (!exactKeys(proof, ["archiveSha256", "archiveBytes", "archiveMembers", "imageId", "tag",
    "configDigest", "configBytes", "diffIds", "rawLayers", "manifestDigest", "manifestBytes",
    "compatibilityRecords", "remoteLayerVerification"])
    || proof.imageId !== policy.candidate.imageId || proof.tag !== alias
    || proof.configDigest !== policy.candidate.imageId || proof.configBytes !== policy.manifest.config.size
    || !sameArray(proof.diffIds, policy.candidate.diffIds) || !Array.isArray(proof.rawLayers)
    || proof.rawLayers.length !== 12 || proof.rawLayers.some((layer, index) => layer.digest !== policy.candidate.diffIds[index]
      || layer.mediaType !== "application/vnd.oci.image.layer.v1.tar" || !Number.isSafeInteger(layer.size) || layer.size < 1)
    || proof.remoteLayerVerification !== "NOT_ESTABLISHED_BY_DOCKER_SAVE"
    || !SHA256.test(proof.archiveSha256) || !DIGEST.test(proof.manifestDigest)
    || !Number.isSafeInteger(proof.archiveBytes) || proof.archiveBytes < 1024 || proof.archiveBytes > MAX_ARCHIVE_BYTES) {
    fail("postgres_remote_candidate_archive_invalid");
  }
  return cloneFrozen(proof);
}

export function validatePostgresRemotePublicationReceipt(receipt, policyInput) {
  const policy = validatePostgresRemotePolicy(policyInput);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) !== policy.publisher.receiptBytes
    || sha256(Buffer.from(serialized, "utf8")) !== policy.publisher.receiptSha256
    || receipt?.kind !== "POSTGRES_GOSU_CANDIDATE_PUBLISH_V1"
    || receipt?.state !== "PUBLISHED_UNADMITTED" || receipt?.result !== "PASSED"
    || receipt?.publication !== "PUBLISHED_UNADMITTED" || receipt?.admission !== "NOT_AUTHORIZED"
    || receipt?.supportStartedAt !== null || receipt?.supportEndsAt !== null || receipt?.archiveUntil !== null
    || receipt?.repository !== policy.repository || receipt?.sourceSha !== policy.publisher.recipeRevision
    || receipt?.runId !== policy.publisher.runId || receipt?.runNumber !== policy.publisher.runNumber
    || receipt?.runAttempt !== policy.publisher.runAttempt || receipt?.image !== policy.image
    || receipt?.packageId !== 15_408_021
    || receipt?.packageSettings !== "NOT_VERIFIED_BY_THIS_RECEIPT"
    || receipt?.candidate?.remoteTag !== policy.publishedTag
    || receipt?.candidate?.configDigest !== policy.candidate.imageId
    || !sameArray(receipt?.candidate?.diffIds, policy.candidate.diffIds)
    || receipt?.subject !== policy.subject || receipt?.remote?.sha256 !== policy.manifest.digest
    || receipt?.remote?.size !== policy.manifest.bytes || receipt?.remote?.mediaType !== policy.manifest.mediaType
    || receipt?.remote?.configDigest !== policy.manifest.config.digest
    || receipt?.remote?.configBytes !== policy.manifest.config.size
    || !sameDescriptors(receipt?.remote?.layers, policy.manifest.layers)
    || receipt?.remote?.baseLayerCount !== 10 || receipt?.remote?.newLayerCount !== 2
    || receipt?.remote?.remoteLayerVerification !== "PENDING_INDEPENDENT_READ"
    || receipt?.bootstrap?.anonymousRead !== "AUTHORIZATION_DENIED"
    || !Array.isArray(receipt?.phases) || receipt.phases.length !== 22
    || !sameArray(receipt.phases.map((phase) => phase?.name), PUBLICATION_PHASE_NAMES)
    || receipt.phases.some((phase) => phase?.result !== "PASSED")
    || receipt?.pushResponse !== "SUCCESS") fail("postgres_remote_publication_receipt_invalid");
  return cloneFrozen(receipt);
}

function validateRemoteReceipt(receipt, policyInput, contract) {
  const policy = validatePostgresRemotePolicy(policyInput);
  if (!exactKeys(receipt, ["kind", "state", "authority", "publication", "registryWrite", "vulnerabilityAudit",
    "imageExecution", "admission", "supportStartedAt", "supportEndsAt", "archiveUntil", "runId",
    "recipeRevision", "subject", "alias", "remoteManifest", "engine", "image", "archive", "publisher", "phases"])
    || !exactKeys(receipt.remoteManifest, ["digest", "bytes", "state", "mediaType", "config", "layers",
      "baseLayerCount", "newLayerCount"])
    || !exactKeys(receipt.engine, ["state", "docker", "buildx", "serverVersion", "pullResponse",
      "compressedDigestVerification", "compressedSizeVerification"])
    || !exactKeys(receipt.image, ["imageId", "diffIds", "platform"])
    || !exactKeys(receipt.archive, ["state", "imageId", "diffIds", "archiveSha256", "archiveBytes", "saveResponse"])
    || !exactKeys(receipt.publisher, ["result", "runId", "recipeRevision", "receiptSha256", "receiptBytes"])
    || receipt.kind !== contract.kind
    || receipt.state !== "VERIFIED" || receipt.authority !== contract.authority
    || receipt.publication !== "PUBLISHED_UNADMITTED" || receipt.registryWrite !== "NOT_ATTEMPTED"
    || receipt.vulnerabilityAudit !== "NOT_ATTEMPTED" || receipt.imageExecution !== contract.imageExecution
    || receipt.admission !== "NOT_AUTHORIZED" || receipt.supportStartedAt !== null
    || receipt.supportEndsAt !== null || receipt.archiveUntil !== null
    || !RUN_ID.test(receipt.runId) || !REVISION.test(receipt.recipeRevision)
    || receipt.subject !== policy.subject || receipt.alias !== localAlias(receipt.runId, receipt.recipeRevision)
    || receipt.remoteManifest?.state !== "RAW_MANIFEST_VERIFIED"
    || receipt.remoteManifest?.digest !== policy.manifest.digest || receipt.remoteManifest?.bytes !== policy.manifest.bytes
    || receipt.remoteManifest?.mediaType !== policy.manifest.mediaType
    || JSON.stringify(receipt.remoteManifest.config) !== JSON.stringify(policy.manifest.config)
    || !sameDescriptors(receipt.remoteManifest.layers, policy.manifest.layers)
    || receipt.remoteManifest.baseLayerCount !== 10 || receipt.remoteManifest.newLayerCount !== 2
    || receipt.engine?.state !== "ENGINE_VERIFIED" || receipt.engine?.serverVersion !== EXPECTED_SERVER_VERSION
    || typeof receipt.engine.docker !== "string" || receipt.engine.docker.length < 1 || receipt.engine.docker.length > 512
    || typeof receipt.engine.buildx !== "string" || receipt.engine.buildx.length < 1 || receipt.engine.buildx.length > 512
    || !["SUCCESS", "FAILED_BUT_EXACT_STATE_CONFIRMED"].includes(receipt.engine.pullResponse)
    || receipt.engine.compressedDigestVerification !== "MANAGED_MOBY_PULL"
    || receipt.engine.compressedSizeVerification !== "RECORDED_ONLY"
    || receipt.image?.imageId !== policy.candidate.imageId || !sameArray(receipt.image?.diffIds, policy.candidate.diffIds)
    || receipt.image?.platform !== policy.platform
    || receipt.archive?.state !== "ARCHIVE_VERIFIED" || receipt.archive?.imageId !== policy.candidate.imageId
    || !sameArray(receipt.archive?.diffIds, policy.candidate.diffIds) || !SHA256.test(receipt.archive?.archiveSha256 ?? "")
    || !Number.isSafeInteger(receipt.archive?.archiveBytes) || receipt.archive.archiveBytes < 1024
    || !["SUCCESS", "FAILED_BUT_EXACT_ARCHIVE_CONFIRMED"].includes(receipt.archive.saveResponse)
    || receipt.publisher?.result !== policy.publisher.result
    || receipt.publisher?.runId !== policy.publisher.runId
    || receipt.publisher?.recipeRevision !== policy.publisher.recipeRevision
    || receipt.publisher?.receiptSha256 !== policy.publisher.receiptSha256
    || receipt.publisher?.receiptBytes !== policy.publisher.receiptBytes
    || !Array.isArray(receipt.phases) || receipt.phases.length !== contract.phases.length
    || !sameArray(receipt.phases.map((phase) => phase?.name), contract.phases)
    || receipt.phases.some((phase) => !exactKeys(phase, ["name", "result", "durationMs"])
      || typeof phase.name !== "string" || phase.name.length < 1 || phase.name.length > 128
      || phase.result !== "PASSED" || !Number.isSafeInteger(phase.durationMs) || phase.durationMs < 0)) {
    fail(contract.invalidCode);
  }
  return cloneFrozen(receipt);
}

export function validatePostgresRemoteCandidateReceipt(receipt, policyInput) {
  return validateRemoteReceipt(receipt, policyInput, {
    kind: "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1", authority: "REMOTE_READ_ONLY",
    imageExecution: "NOT_ATTEMPTED", phases: SCANNER_PHASE_NAMES,
    invalidCode: "postgres_remote_candidate_receipt_invalid",
  });
}

export function validatePostgresRemoteRuntimeMaterialReceipt(receipt, policyInput) {
  return validateRemoteReceipt(receipt, policyInput, {
    kind: "POSTGRES_REMOTE_RUNTIME_MATERIAL_RECEIPT_V1", authority: "DIAGNOSTIC_ONLY",
    imageExecution: "VERIFIED_DIAGNOSTIC", phases: RUNTIME_PHASE_NAMES,
    invalidCode: "postgres_remote_runtime_material_receipt_invalid",
  });
}

async function withRemotePostgresMaterial(inputValue, inspectMaterial, dependencies, lane) {
  const input = validateInput(inputValue);
  if (typeof inspectMaterial !== "function" || !plain(dependencies)
    || Object.keys(dependencies).some((key) => !["commandRunner", "saveRunner", "validateArchive", "now", "platform", "env"].includes(key))) {
    fail("postgres_remote_candidate_arguments_invalid");
  }
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "linux") fail("postgres_remote_candidate_requires_linux");
  if (input.signal?.aborted) fail("postgres_remote_candidate_aborted");
  assertPrivateEmptyDirectory(input.parent);
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  const saveRunner = dependencies.saveRunner ?? defaultSaveRunner;
  const archiveValidator = dependencies.validateArchive ?? validatePostgresCandidateArchive;
  const now = dependencies.now ?? Date.now; const env = dependencies.env ?? process.env; const started = now();
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN.length < 1 || env.GITHUB_TOKEN.length > 8192) {
    fail("postgres_remote_candidate_environment_invalid");
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
  const alias = localAlias(input.runId, input.recipeRevision);
  const archiveFile = path.join(work, "candidate.tar");
  const phases = []; const phase = async (name, operation) => {
    const phaseStarted = now();
    try { const result = await operation(); phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted }); return result; }
    catch (error) { phases.push({ name, result: "FAILED", reason: fixedReason(error), durationMs: now() - phaseStarted }); throw error; }
  };
  let primaryFailure; let result; let inspectedResult; let inspectionFailed = false;
  let runtimeCleanupFailure = null; let runtimeConfig;
  let priorIds = []; let pullAttempted = false; let owned = false; let tagged = false;
  try {
    const version = bounded((await phase("managed_engine", () => run(commandRunner, "docker",
      ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], options(authBase)))).stdout);
    const parts = version.split("|");
    if (parts.length !== 2 || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u.test(parts[0])
      || parts[1] !== EXPECTED_SERVER_VERSION) fail("postgres_remote_candidate_engine_invalid");
    const buildx = bounded(run(commandRunner, "docker", ["buildx", "version"], options(authBase)).stdout);
    await phase("registry_login", () => run(commandRunner, "docker", ["login", "ghcr.io", "--username",
      policy.owner, "--password-stdin"], { ...options(authBase), input: `${env.GITHUB_TOKEN}\n` }));
    const rawTag = await phase("raw_tag_manifest", () => run(commandRunner, "docker",
      ["buildx", "imagetools", "inspect", "--raw", published], options(authBase)).stdout);
    const manifest = validatePostgresRemoteRawManifest(rawTag, policy);
    await phase("anonymous_digest_denied", () => {
      const remote = observe(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", policy.subject], options(anonymousBase));
      try {
        if (classifyAnonymousRemoteRead(remote) !== "AUTHORIZATION_DENIED") fail("postgres_remote_candidate_privacy_invalid");
      } catch { fail("postgres_remote_candidate_privacy_invalid"); }
    });
    await phase("raw_digest_manifest", () => {
      const rawDigest = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", policy.subject], options(authBase)).stdout;
      if (rawDigest !== rawTag) fail("postgres_remote_candidate_manifest_mismatch");
      validatePostgresRemoteRawManifest(rawDigest, policy);
    });
    priorIds = await phase("local_inventory_before", () => imageIds(run(commandRunner, "docker",
      ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], options(authBase)).stdout));
    await phase("local_collision_check", () => {
      for (const reference of [policy.subject, alias, policy.candidate.imageId]) {
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", reference], options(authBase)))) {
          fail("postgres_remote_candidate_local_collision");
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
        const image = validatePostgresRemoteImage(inspected.stdout, policy);
        owned = true;
        if (lane === "runtime") {
          if (!plain(image.config)) fail("postgres_remote_candidate_image_invalid");
          runtimeConfig = cloneFrozen(image.config);
        }
      }
    }
    if (!owned) fail("postgres_remote_candidate_pull_ownership_unverified");
    const pullResponse = pullResult.error || pullResult.status !== 0 ? "FAILED_BUT_EXACT_STATE_CONFIRMED" : "SUCCESS";
    await phase("simple_local_alias", () => {
      const response = observe(commandRunner, "docker", ["image", "tag", policy.subject, alias], options(authBase));
      const image = validatePostgresRemoteImage(run(commandRunner, "docker",
        ["image", "inspect", "--format", "{{json .}}", policy.subject], options(authBase)).stdout, policy, alias);
      tagged = true;
      if (lane === "runtime" && JSON.stringify(image.config) !== JSON.stringify(runtimeConfig)) {
        fail("postgres_remote_candidate_image_invalid");
      }
      if (response.error || response.status !== 0) fail("postgres_remote_candidate_alias_failed");
      return true;
    });
    const privateFile = createPrivateFile(archiveFile);
    let saveResult;
    try {
      saveResult = await phase("private_docker_save", async () => {
        const saveOptions = { ...options(authBase), handle: privateFile.handle };
        const response = await saveRunner("docker", ["image", "save", alias], saveOptions);
        if (typeof response?.stdout !== "string" || typeof response?.stderr !== "string"
          || Buffer.byteLength(response.stdout) + Buffer.byteLength(response.stderr) > MAX_OUTPUT_BYTES) {
          fail("postgres_remote_candidate_command_failed");
        }
        return response;
      });
      fsyncSync(privateFile.handle);
      validatePrivateFile(archiveFile, privateFile.identity);
    } finally { closeSync(privateFile.handle); }
    const archiveProof = validateArchiveProof(await phase("full_archive_validation", () => archiveValidator(
      readFileSync(archiveFile), { imageId: policy.candidate.imageId, tag: alias,
        expectedDiffIds: policy.candidate.diffIds, expectedLayers: 12 },
    )), policy, alias);
    const saveResponse = saveResult.error || saveResult.status !== 0 ? "FAILED_BUT_EXACT_ARCHIVE_CONFIRMED" : "SUCCESS";
    const snapshot = lane === "runtime"
      ? Object.freeze({ parent: work, dockerConfig: auth, config: runtimeConfig,
        imageId: policy.candidate.imageId, diffIds: cloneFrozen(policy.candidate.diffIds), subject: policy.subject,
        archiveProof, runId: input.runId, recipeRevision: input.recipeRevision, signal: operationController.signal })
      : Object.freeze({ file: archiveFile, archiveProof, policy, subject: policy.subject,
        imageId: policy.candidate.imageId, diffIds: policy.candidate.diffIds, runId: input.runId,
        recipeRevision: input.recipeRevision, signal: operationController.signal });
    await phase(lane === "runtime" ? "runtime_diagnostics" : "private_archive_callback", async () => {
      try { inspectedResult = await inspectMaterial(snapshot); } catch (error) {
        inspectionFailed = true;
        if (lane === "runtime") {
          if (error?.message === "postgres_runtime_cleanup_uncertain") {
            runtimeCleanupFailure = "postgres_remote_runtime_cleanup_uncertain";
          }
          throw runtimeDiagnosticsFailure(runtimeCleanupFailure);
        }
        throw inspectionFailure();
      }
    });
    result = { kind: lane === "runtime" ? "POSTGRES_REMOTE_RUNTIME_MATERIAL_RECEIPT_V1"
      : "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1", state: "VERIFIED",
      authority: lane === "runtime" ? "DIAGNOSTIC_ONLY" : "REMOTE_READ_ONLY",
      publication: "PUBLISHED_UNADMITTED", registryWrite: "NOT_ATTEMPTED",
      vulnerabilityAudit: "NOT_ATTEMPTED", imageExecution: lane === "runtime" ? "VERIFIED_DIAGNOSTIC" : "NOT_ATTEMPTED",
      admission: "NOT_AUTHORIZED",
      supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
      runId: input.runId, recipeRevision: input.recipeRevision,
      subject: policy.subject, alias, remoteManifest: manifest,
      engine: { state: "ENGINE_VERIFIED", docker: version, buildx, serverVersion: EXPECTED_SERVER_VERSION,
        pullResponse, compressedDigestVerification: "MANAGED_MOBY_PULL",
        compressedSizeVerification: "RECORDED_ONLY" },
      image: { imageId: policy.candidate.imageId, diffIds: policy.candidate.diffIds, platform: policy.platform },
      archive: { state: "ARCHIVE_VERIFIED", imageId: archiveProof.imageId, diffIds: archiveProof.diffIds,
        archiveSha256: archiveProof.archiveSha256, archiveBytes: archiveProof.archiveBytes, saveResponse },
      publisher: { result: policy.publisher.result, runId: policy.publisher.runId,
        recipeRevision: policy.publisher.recipeRevision, receiptSha256: policy.publisher.receiptSha256,
        receiptBytes: policy.publisher.receiptBytes }, phases };
  } catch (error) { primaryFailure = error; }
  finally { globalThis.clearTimeout(timer); input.signal?.removeEventListener("abort", abort); }

  const cleanupStarted = now(); const cleanupFailures = [];
  const cleanupOptions = () => postgresRemoteCleanupOptions(authBase, cleanupStarted, now);
  if (owned) {
    try {
      const current = imageIds(run(commandRunner, "docker", ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (!sameArray(current, expectedInventory(priorIds, policy.candidate.imageId))) fail("postgres_remote_candidate_cleanup_ownership_unverified");
      validatePostgresRemoteImage(run(commandRunner, "docker",
        ["image", "inspect", "--format", "{{json .}}", policy.subject], cleanupOptions()).stdout, policy, tagged ? alias : undefined);
      if (tagged) {
        observe(commandRunner, "docker", ["image", "rm", alias], cleanupOptions());
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", alias], cleanupOptions()))) {
          fail("postgres_remote_candidate_image_cleanup_failed");
        }
      }
      const subjectState = observe(commandRunner, "docker", ["image", "inspect", policy.subject], cleanupOptions());
      if (!inspectAbsent(subjectState)) {
        validatePostgresRemoteImage(run(commandRunner, "docker",
          ["image", "inspect", "--format", "{{json .}}", policy.subject], cleanupOptions()).stdout, policy);
        observe(commandRunner, "docker", ["image", "rm", policy.subject], cleanupOptions());
      }
      for (const reference of [alias, policy.subject, policy.candidate.imageId]) {
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", reference], cleanupOptions()))) {
          fail("postgres_remote_candidate_image_cleanup_failed");
        }
      }
      const after = imageIds(run(commandRunner, "docker", ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (!sameArray(after, priorIds)) fail("postgres_remote_candidate_image_cleanup_failed");
    } catch (error) { cleanupFailures.push(fixedReason(error)); }
  } else if (pullAttempted) {
    try {
      const current = imageIds(run(commandRunner, "docker", ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"], cleanupOptions()).stdout);
      if (!sameArray(current, priorIds)) fail("postgres_remote_candidate_cleanup_ownership_unverified");
    } catch { cleanupFailures.push("postgres_remote_candidate_cleanup_ownership_unverified"); }
  }
  phases.push({ name: "owned_docker_cleanup", result: cleanupFailures.length ? "FAILED" : "PASSED",
    ...(cleanupFailures.length ? { reasons: cleanupFailures } : {}), durationMs: now() - cleanupStarted });
  let temporaryFailure; const temporaryStarted = now();
  try {
    if (runtimeCleanupFailure) fail("postgres_remote_candidate_temporary_cleanup_failed");
    if (!existsSync(work) || lstatSync(work).isSymbolicLink() || realpathSync(work) !== work
      || path.dirname(work) !== input.parent) fail("postgres_remote_candidate_temporary_cleanup_failed");
    rmSync(work, { recursive: true, force: false });
    assertPrivateEmptyDirectory(input.parent);
  } catch (error) { temporaryFailure = error; }
  phases.push({ name: "owned_temporary_cleanup", result: temporaryFailure ? "FAILED" : "PASSED",
    ...(temporaryFailure ? { reason: fixedReason(temporaryFailure) } : {}), durationMs: now() - temporaryStarted });
  if (lane === "runtime" && (primaryFailure || cleanupFailures.length || temporaryFailure)) {
    throw runtimeMaterialFailure({ inspectionFailed, runtimeCleanupFailure,
      primaryFailure: primaryFailure
        ? inspectionFailed ? runtimeCleanupFailure ?? "postgres_remote_runtime_diagnostics_failed"
          : fixedReason(primaryFailure) : null,
      imageCleanupFailure: cleanupFailures[0] ?? null,
      temporaryCleanupFailure: temporaryFailure ? fixedReason(temporaryFailure) : null });
  }
  if (cleanupFailures.length) throw new Error(cleanupFailures[0]);
  if (temporaryFailure) throw new Error(fixedReason(temporaryFailure));
  if (primaryFailure) {
    if (isInspectionFailure(primaryFailure)) throw primaryFailure;
    throw new Error(fixedReason(primaryFailure));
  }
  if (lane === "runtime") return Object.freeze({
    material: validatePostgresRemoteRuntimeMaterialReceipt(result, policy), runtime: inspectedResult,
  });
  return validatePostgresRemoteCandidateReceipt(result, policy);
}

export function withVerifiedRemotePostgresCandidate(input, inspectArchive, dependencies = {}) {
  return withRemotePostgresMaterial(input, inspectArchive, dependencies, "scanner");
}

export function withVerifiedRemotePostgresRuntimeMaterial(input, runDiagnostics, dependencies = {}) {
  return withRemotePostgresMaterial(input, runDiagnostics, dependencies, "runtime");
}
