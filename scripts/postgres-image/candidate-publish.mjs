import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, rmSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

import lockJson from "../../infra/postgres-image/lock.json" with { type: "json" };
import { classifyAnonymousRemoteRead, validateRemoteManifest } from "../package-bootstrap/registry-proof.mjs";
import {
  dockerBuildArguments, ephemeralContainerArguments, validateBaseInspect, validateCandidateInspect, validateDiagnosticLock,
  validateDockerVersion, validateMaterialBytes,
} from "./diagnostic.mjs";
import { verifyPostgresFilesystem } from "./filesystem.mjs";
import {
  validatePostgresCandidateArchive, validatePostgresCandidateRemoteManifest,
} from "./candidate-proof.mjs";

const MiB = 1024 ** 2;
const MAX_OUTPUT_BYTES = 4 * MiB;
const MAX_ARCHIVE_BYTES = 1024 ** 3;
const COMMAND_TIMEOUT_MS = 10 * 60_000;
const OPERATION_TIMEOUT_MS = 27 * 60_000;
const CLEANUP_RESERVE_MS = 3 * 60_000;
const CLEANUP_TIMEOUT_MS = 2 * 60_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const IMAGE_ID = DIGEST;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const OWNER_LABEL = "com.auto-world.postgres-diagnostic";
const PURPOSE_LABEL = "com.auto-world.postgres-diagnostic-purpose";
const PURPOSE = "gosu-correction-runtime";

const BOOTSTRAP = Object.freeze({
  subject: "ghcr.io/clemey15/auto-world-postgres-gosu@sha256:9ee2f2da7187b0d0ecd3cbab83b7356f9ef032650b33604ff13e711e3462e408",
  digest: "sha256:9ee2f2da7187b0d0ecd3cbab83b7356f9ef032650b33604ff13e711e3462e408",
});

export const POSTGRES_CANDIDATE_PUBLISH = Object.freeze({
  workflowPath: ".github/workflows/postgres-candidate-publish.yml",
  repository: "CleMeY15/auto-world",
  owner: "CleMeY15",
  image: "ghcr.io/clemey15/auto-world-postgres-gosu",
  packageId: 15_408_021,
  branchUrl: "https://api.github.com/repos/CleMeY15/auto-world/branches/main",
  outputDirectory: "postgres-candidate-publish",
  platform: "linux/amd64",
  sourceFiles: Object.freeze([
    ".github/workflows/postgres-candidate-publish.yml",
    "scripts/postgres-image/candidate-publish.mjs",
    "scripts/postgres-image/candidate-proof.mjs",
    "scripts/postgres-image/diagnostic.mjs",
    "scripts/postgres-image/filesystem.mjs",
    "scripts/postgres-image/evidence.mjs",
    "scripts/seaweed-image/archive.mjs",
    "scripts/package-bootstrap/registry-proof.mjs",
    "scripts/package-bootstrap/prepare.mjs",
    "infra/postgres-image/Dockerfile",
    "infra/postgres-image/lock.json",
    "infra/postgres-image/filesystem-policy.json",
    "infra/postgres-image/materials/gosu-1.19-r5.apk",
    "infra/postgres-image/materials/APKINDEX-v3.24-community-x86_64.tar.gz",
    "infra/postgres-image/materials/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub",
    "infra/postgres-image/materials/APKBUILD-1e1aed58b7720fcb6b1859043d543b33019d8c4f",
    "infra/postgres-image/materials/provenance.json",
  ]),
});

function fail(code) { throw new Error(code); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function fixedReason(error) {
  const message = error instanceof Error ? error.message : "postgres_candidate_publish_unknown_failure";
  return /^postgres_candidate_(?:publish|proof)_[a-z0-9_]+$/u.test(message)
    || /^postgres_(?:diagnostic|gosu_filesystem)_[a-z0-9_]+$/u.test(message)
    ? message : "postgres_candidate_publish_command_failed";
}

export function parseCandidatePublishArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== "--output"
    || typeof argv[1] !== "string" || !path.isAbsolute(argv[1]) || path.normalize(argv[1]) !== argv[1]) {
    fail("postgres_candidate_publish_arguments_invalid");
  }
  return { output: argv[1] };
}

export function validateCandidatePublishContext(env, platform = process.platform) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux"
    || env.RUNNER_ENVIRONMENT !== "github-hosted") fail("postgres_candidate_publish_requires_github_linux");
  if (env.GITHUB_REPOSITORY !== POSTGRES_CANDIDATE_PUBLISH.repository
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_WORKFLOW_REF !== `${POSTGRES_CANDIDATE_PUBLISH.repository}/${POSTGRES_CANDIDATE_PUBLISH.workflowPath}@refs/heads/main`) {
    fail("postgres_candidate_publish_context_invalid");
  }
  if (env.GITHUB_JOB !== "publish" || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !RUN_ID.test(env.GITHUB_RUN_ID ?? "") || !REVISION.test(env.GITHUB_SHA ?? "")) {
    fail("postgres_candidate_publish_identity_invalid");
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN.length < 1
    || typeof env.DOCKER_CONTEXT === "string" && env.DOCKER_CONTEXT.length > 0
    || !path.isAbsolute(env.RUNNER_TEMP ?? "") || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")) {
    fail("postgres_candidate_publish_environment_invalid");
  }
  const runnerTemp = path.resolve(env.RUNNER_TEMP); const workspace = path.resolve(env.GITHUB_WORKSPACE);
  for (const directory of [runnerTemp, workspace]) {
    const info = existsSync(directory) ? lstatSync(directory) : undefined;
    if (!info?.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) {
      fail("postgres_candidate_publish_directory_invalid");
    }
  }
  return { repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID, sourceSha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN, runnerTemp, workspace };
}

function directoryIdentity(directory) {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) {
    fail("postgres_candidate_publish_owned_path_invalid");
  }
  return { dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode };
}
function requireDirectory(directory, expected) {
  const actual = directoryIdentity(directory);
  if (["dev", "ino", "uid", "mode"].some((key) => actual[key] !== expected[key])) {
    fail("postgres_candidate_publish_owned_path_replaced");
  }
}

function cleanEnvironment(dockerConfig, temporaryDirectory) {
  return { PATH: "/usr/bin:/bin", HOME: temporaryDirectory, LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    TZ: "UTC", TMPDIR: temporaryDirectory, DOCKER_HOST: "unix:///var/run/docker.sock",
    DOCKER_CONFIG: dockerConfig, BUILDX_CONFIG: path.join(dockerConfig, "buildx"), DOCKER_BUILDKIT: "0" };
}
function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: options.encoding ?? "utf8", env: options.env,
    input: options.input, maxBuffer: MAX_OUTPUT_BYTES, timeout: options.timeout, windowsHide: true });
}
function observe(runner, command, args, options) {
  const result = runner(command, args, options) ?? {};
  const stdout = typeof result.stdout === "string" || Buffer.isBuffer(result.stdout) ? result.stdout : "";
  const stderr = typeof result.stderr === "string" || Buffer.isBuffer(result.stderr) ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    fail("postgres_candidate_publish_output_exceeded");
  }
  return { error: result.error, signal: result.signal, status: result.status, stdout, stderr };
}
function run(runner, command, args, options) {
  const result = observe(runner, command, args, options);
  if (result.error || result.signal || result.status !== 0) fail("postgres_candidate_publish_command_failed");
  return result;
}

async function boundedJson(fetchImpl, url, context, timeout) {
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), Math.min(15_000, timeout));
  try {
    let response;
    try {
      response = await fetchImpl(url, { redirect: "error", signal: controller.signal, headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${context.token}`,
        "User-Agent": "auto-world-postgres-candidate-publish", "X-GitHub-Api-Version": "2022-11-28",
      } });
    } catch { fail("postgres_candidate_publish_github_request_failed"); }
    if (!response?.ok || !response.body?.getReader) fail("postgres_candidate_publish_github_request_failed");
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const item = await reader.read(); if (item.done) break;
      const chunk = Buffer.from(item.value); size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) { await reader.cancel(); fail("postgres_candidate_publish_github_response_invalid"); }
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { fail("postgres_candidate_publish_github_response_invalid"); }
  } finally { globalThis.clearTimeout(timer); }
}
async function verifyProtectedMain(fetchImpl, context, timeout) {
  const value = await boundedJson(fetchImpl, POSTGRES_CANDIDATE_PUBLISH.branchUrl, context, timeout);
  if (value?.name !== "main" || value?.protected !== true || value?.commit?.sha !== context.sourceSha) {
    fail("postgres_candidate_publish_main_ref_mismatch");
  }
  return { sha: value.commit.sha, protected: true };
}
function text(value) { return Buffer.isBuffer(value) ? value.toString("utf8") : value; }
function parseJson(value, code) {
  try { return JSON.parse(text(value)); } catch { fail(code); }
}
function inventory(runner, options, kind) {
  const args = kind === "image" ? ["image", "ls", "--no-trunc", "--quiet"]
    : kind === "container" ? ["container", "ls", "--all", "--no-trunc", "--quiet"]
      : ["volume", "ls", "--quiet"];
  const values = text(run(runner, "docker", args, options).stdout).split(/\r?\n/u).filter(Boolean);
  const pattern = kind === "image" ? IMAGE_ID : kind === "container" ? CONTAINER_ID
    : /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;
  if (values.some((value) => !pattern.test(value))) fail("postgres_candidate_publish_local_inventory_invalid");
  return [...new Set(values)].sort();
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function absent(result, kind, reference) {
  if (result.status === 0 || result.error || result.signal) return false;
  const combined = `${text(result.stdout)}\n${text(result.stderr)}`;
  return result.status === 1 && (kind === "image" ? /no such image/iu : /no such (?:container|object)/iu).test(combined)
    && combined.toLowerCase().includes(reference.toLowerCase());
}
function classifyRemoteTagAbsence(result) {
  const combined = `${text(result.stdout)}\n${text(result.stderr)}`.toLowerCase();
  if (result.error || result.signal || Buffer.byteLength(combined) > MAX_OUTPUT_BYTES
    || /unauthorized|denied|forbidden|timeout|tls|certificate|connection|no such host/u.test(combined)) {
    fail("postgres_candidate_publish_remote_tag_check_error");
  }
  if (result.status === 0) fail("postgres_candidate_publish_remote_tag_exists");
  if (result.status === 1 && /manifest unknown|manifest.*not found|not found.*manifest/u.test(combined)) return "ABSENT";
  fail("postgres_candidate_publish_remote_tag_check_error");
}

export function validateBaseManifest(raw, expectedDigest = lockJson.base.platformDigest) {
  const manifest = parseJson(raw, "postgres_candidate_publish_base_manifest_invalid");
  const manifestMediaTypes = new Map([
    ["application/vnd.oci.image.manifest.v1+json", {
      config: "application/vnd.oci.image.config.v1+json", layer: "application/vnd.oci.image.layer.v1.tar+gzip",
    }],
    ["application/vnd.docker.distribution.manifest.v2+json", {
      config: "application/vnd.docker.container.image.v1+json", layer: "application/vnd.docker.image.rootfs.diff.tar.gzip",
    }],
  ]);
  const media = manifestMediaTypes.get(manifest?.mediaType);
  const annotations = manifest?.annotations;
  const annotationKeys = annotations && typeof annotations === "object" && !Array.isArray(annotations)
    ? Object.keys(annotations) : [];
  if (!exactKeys(manifest, ["schemaVersion", "mediaType", "config", "layers",
    ...(annotations === undefined ? [] : ["annotations"])])
    || manifest.schemaVersion !== 2 || !DIGEST.test(expectedDigest ?? "")
    || `sha256:${sha256(Buffer.from(raw, "utf8"))}` !== expectedDigest || !media
    || annotations !== undefined && (manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json"
      || annotationKeys.length < 1 || annotationKeys.length > 16
      || annotationKeys.some((key) => key.length < 1 || key.length > 128 || /[^\x20-\x7e]/u.test(key)
        || typeof annotations[key] !== "string" || annotations[key].length > 512
        || /[^\x20-\x7e]/u.test(annotations[key])))
    || !exactKeys(manifest.config, ["mediaType", "digest", "size"]) || manifest.config.mediaType !== media.config
    || manifest.config.digest !== lockJson.base.configId || !Number.isSafeInteger(manifest.config.size)
    || manifest.config.size < 1 || manifest.config.size > MAX_OUTPUT_BYTES
    || !Array.isArray(manifest.layers) || manifest.layers.length !== 10
    || manifest.layers.some((layer) => !exactKeys(layer, ["mediaType", "digest", "size"])
      || layer.mediaType !== media.layer || !DIGEST.test(layer.digest ?? "")
      || !Number.isSafeInteger(layer.size) || layer.size < 1 || layer.size > MAX_ARCHIVE_BYTES)) {
    fail("postgres_candidate_publish_base_manifest_invalid");
  }
  return { configDigest: manifest.config.digest, layers: manifest.layers.map((layer) => ({ ...layer })) };
}

function repositoryClosure(runner, context, options) {
  const status = text(run(runner, "git", ["status", "--porcelain", "--untracked-files=normal"], options).stdout).trim();
  const head = text(run(runner, "git", ["rev-parse", "HEAD"], options).stdout).trim();
  if (status !== "" || head !== context.sourceSha) fail("postgres_candidate_publish_repository_invalid");
  const files = new Map(); const records = [];
  for (const file of POSTGRES_CANDIDATE_PUBLISH.sourceFiles) {
    const result = run(runner, "git", ["show", `HEAD:${file}`], { ...options, encoding: null });
    const bytes = Buffer.from(result.stdout);
    const working = readFileSync(path.join(context.workspace, file));
    if (!bytes.equals(working)) fail("postgres_candidate_publish_repository_invalid");
    files.set(file, bytes); records.push({ path: file, size: bytes.length, sha256: sha256(bytes) });
  }
  const dockerfile = files.get("infra/postgres-image/Dockerfile");
  const parsedLock = validateDiagnosticLock(JSON.parse(files.get("infra/postgres-image/lock.json").toString("utf8")), dockerfile);
  for (const material of [parsedLock.apk, parsedLock.apk.index, ...parsedLock.apk.expectedKeys,
    parsedLock.apk.apkbuild, parsedLock.apk.provenance]) validateMaterialBytes(files.get(material.sourcePath), material);
  return { files, lock: parsedLock, records };
}

function writePrivate(file, bytes) { writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); }
function sameNode(left, right) {
  return ["dev", "ino", "uid", "mode", "nlink", "size"].every((key) => left[key] === right[key]);
}
export function readBoundedDockerFile(file, includeBytes = false, maximumBytes = MAX_ARCHIVE_BYTES) {
  if (typeof file !== "string" || !path.isAbsolute(file) || path.normalize(file) !== file
    || typeof includeBytes !== "boolean" || !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 1 || maximumBytes > MAX_ARCHIVE_BYTES) fail("postgres_candidate_publish_archive_invalid");
  let handle;
  try {
    const pathBefore = lstatSync(file);
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1
      || pathBefore.size < 1 || pathBefore.size > maximumBytes) fail("postgres_candidate_publish_archive_invalid");
    handle = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(handle);
    if (!before.isFile() || before.nlink !== 1 || before.size !== pathBefore.size || !sameNode(before, pathBefore)) {
      fail("postgres_candidate_publish_archive_invalid");
    }
    const hash = createHash("sha256"); const bytes = includeBytes ? Buffer.allocUnsafe(before.size) : undefined;
    const chunk = includeBytes ? bytes : Buffer.allocUnsafe(MiB); let offset = 0;
    while (offset < before.size) {
      const requested = Math.min(includeBytes ? before.size - offset : chunk.length, before.size - offset);
      const targetOffset = includeBytes ? offset : 0;
      const length = readSync(handle, chunk, targetOffset, requested, offset);
      if (length < 1) fail("postgres_candidate_publish_archive_invalid");
      hash.update(chunk.subarray(targetOffset, targetOffset + length)); offset += length;
    }
    if (readSync(handle, Buffer.allocUnsafe(1), 0, 1, offset) !== 0) fail("postgres_candidate_publish_archive_invalid");
    const after = fstatSync(handle); const pathAfter = lstatSync(file);
    if (!sameNode(before, after) || !sameNode(before, pathAfter) || pathAfter.isSymbolicLink()) {
      fail("postgres_candidate_publish_archive_invalid");
    }
    return { size: before.size, sha256: hash.digest("hex"), ...(includeBytes ? { bytes } : {}) };
  } catch (error) {
    if (error instanceof Error && error.message === "postgres_candidate_publish_archive_invalid") throw error;
    fail("postgres_candidate_publish_archive_invalid");
  } finally { if (handle !== undefined) closeSync(handle); }
}
function fileIdentity(file) {
  const { size, sha256: digest } = readBoundedDockerFile(file);
  return { size, sha256: digest };
}
function boundedIdentity(value) {
  const result = text(value).trim();
  if (result.length < 1 || result.length > 512 || /[^\x20-\x7e]/u.test(result)) {
    fail("postgres_candidate_publish_tool_identity_invalid");
  }
  return result;
}

function validateStoppedContainer(raw, expected) {
  const value = parseJson(raw, "postgres_candidate_publish_container_invalid");
  const container = Array.isArray(value) && value.length === 1 ? value[0] : undefined;
  if (!container || (expected.id !== undefined && container.Id !== expected.id) || !CONTAINER_ID.test(container.Id ?? "")
    || container.Name !== `/${expected.name}`
    || container.Image !== expected.imageId
    || container.Config?.Labels?.[OWNER_LABEL] !== expected.nonce
    || container.Config?.Labels?.[PURPOSE_LABEL] !== PURPOSE || container.State?.Status !== "created"
    || container.State?.Running !== false || container.HostConfig?.NetworkMode !== "none"
    || container.HostConfig?.ReadonlyRootfs !== true || !container.HostConfig?.CapDrop?.includes("ALL")
    || !container.HostConfig?.SecurityOpt?.includes("no-new-privileges=true")
    || container.HostConfig?.Tmpfs?.["/var/lib/postgresql/data"]
      !== "rw,nosuid,nodev,noexec,size=16777216,mode=0700"
    || Object.keys(container.HostConfig?.Tmpfs ?? {}).length !== 1
    || !Array.isArray(container.Mounts) || container.Mounts.some((mount) => mount.Type === "volume")) {
    fail("postgres_candidate_publish_container_invalid");
  }
  return { id: container.Id, name: expected.name };
}

function validateBootstrap(raw) {
  const proof = validateRemoteManifest(raw, BOOTSTRAP.digest);
  return { digest: proof.sha256, size: proof.size };
}
function anonymousDenied(result) {
  if (result.error || result.signal) fail("postgres_candidate_publish_anonymous_check_failed");
  let value;
  try {
    value = classifyAnonymousRemoteRead({ status: result.status, stdout: text(result.stdout), stderr: text(result.stderr) });
  } catch { fail("postgres_candidate_publish_anonymous_check_failed"); }
  if (value !== "AUTHORIZATION_DENIED") fail("postgres_candidate_publish_anonymous_check_failed");
  return value;
}

export async function runPostgresCandidatePublish(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseCandidatePublishArguments(argv);
  const env = dependencies.env ?? process.env;
  const context = validateCandidatePublishContext(env, dependencies.platform ?? process.platform);
  if (path.basename(args.output) !== POSTGRES_CANDIDATE_PUBLISH.outputDirectory
    || path.dirname(args.output) !== context.runnerTemp || existsSync(args.output)) {
    fail("postgres_candidate_publish_output_path_invalid");
  }
  const runner = dependencies.commandRunner ?? defaultCommandRunner;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const archiveValidator = dependencies.archiveValidator ?? validatePostgresCandidateArchive;
  const remoteValidator = dependencies.remoteValidator ?? validatePostgresCandidateRemoteManifest;
  const filesystemVerifier = dependencies.filesystemVerifier ?? verifyPostgresFilesystem;
  const bootstrapValidator = dependencies.bootstrapValidator ?? validateBootstrap;
  const baseManifestValidator = dependencies.baseManifestValidator ?? validateBaseManifest;
  const now = dependencies.now ?? Date.now; const started = now(); const deadline = started + OPERATION_TIMEOUT_MS;
  const runnerTempIdentity = directoryIdentity(context.runnerTemp);
  mkdirSync(args.output, { mode: 0o700 }); const outputIdentity = directoryIdentity(args.output);
  const work = path.join(context.runnerTemp, `aw-postgres-candidate-publish-${context.runId}-attempt-1`);
  if (existsSync(work)) fail("postgres_candidate_publish_owned_path_exists");
  mkdirSync(work, { mode: 0o700 }); const workIdentity = directoryIdentity(work);
  const authConfig = path.join(work, "docker-auth"); const anonymousConfig = path.join(work, "docker-anonymous");
  const buildContext = path.join(work, "context");
  for (const directory of [authConfig, anonymousConfig, buildContext, path.join(authConfig, "buildx"),
    path.join(anonymousConfig, "buildx")]) mkdirSync(directory, { mode: 0o700 });
  const options = (dockerConfig = anonymousConfig, cleanup = false, encoding = "utf8") => {
    requireDirectory(context.runnerTemp, runnerTempIdentity); requireDirectory(work, workIdentity);
    const remaining = deadline - now() - (cleanup ? 0 : CLEANUP_RESERVE_MS);
    if (remaining < 1_000) fail(cleanup ? "postgres_candidate_publish_cleanup_timeout" : "postgres_candidate_publish_timeout");
    return { cwd: context.workspace, env: cleanEnvironment(dockerConfig, work), encoding,
      timeout: Math.min(cleanup ? CLEANUP_TIMEOUT_MS : COMMAND_TIMEOUT_MS, remaining) };
  };
  const receipt = { schemaVersion: 1, kind: "POSTGRES_GOSU_CANDIDATE_PUBLISH_V1", state: "PREPARING",
    result: "FAILED", publication: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null,
    supportEndsAt: null, archiveUntil: null, repository: context.repository, sourceSha: context.sourceSha,
    runId: context.runId, runNumber: "1", runAttempt: "1", packageId: POSTGRES_CANDIDATE_PUBLISH.packageId,
    packageSettings: "NOT_VERIFIED_BY_THIS_RECEIPT", image: POSTGRES_CANDIDATE_PUBLISH.image, phases: [] };
  const phase = async (name, action) => {
    const phaseStarted = now();
    try { const value = await action(); receipt.phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted }); return value; }
    catch (error) { receipt.phases.push({ name, result: "FAILED", reason: fixedReason(error), durationMs: now() - phaseStarted }); throw error; }
  };
  const nonce = sha256(`${context.sourceSha}:${context.runId}:1`).slice(0, 24);
  const localTag = `aw-postgres-gosu:${nonce}`;
  const remoteTag = `candidate-${context.runId}-attempt-1`;
  const remoteReference = `${POSTGRES_CANDIDATE_PUBLISH.image}:${remoteTag}`;
  let baselineImages; let baselineContainers; let baselineVolumes; let baseAdded = false; let basePullAttempted = false;
  let candidateId; let candidateBuildAttempted = false; let remoteTagCreated = false; let pushAttempted = false;
  let baseInspect; let candidateInspect;
  const attemptedContainers = new Map(); let primaryFailure;
  try {
    receipt.code = await phase("checkout_and_source_closure", () => repositoryClosure(runner, context, options()));
    await phase("protected_main_before_credentials", () => verifyProtectedMain(fetchImpl, context, options().timeout));
    receipt.tools = await phase("managed_tool_identity", () => {
      const version = parseJson(run(runner, "docker", ["version", "--format", "{{json .}}"], options()).stdout,
        "postgres_candidate_publish_docker_invalid");
      const info = parseJson(run(runner, "docker", ["info", "--format", "{{json .}}"], options()).stdout,
        "postgres_candidate_publish_docker_invalid");
      validateDockerVersion(version, info, receipt.code.lock);
      return { docker: `${version.Client.Version}|${version.Server.Version}`,
        buildx: boundedIdentity(run(runner, "docker", ["buildx", "version"], options()).stdout), node: process.version,
        trustBoundary: "GITHUB_HOSTED_MANAGED_DOCKER_CLASSIC_BUILDER", packagesWriteScope: "JOB_WIDE_STATIC_PERMISSION" };
    });
    await phase("local_collision_and_inventory", () => {
      baselineImages = inventory(runner, options(), "image"); baselineContainers = inventory(runner, options(), "container");
      baselineVolumes = inventory(runner, options(), "volume");
      for (const ref of [localTag, remoteReference]) {
        if (!absent(observe(runner, "docker", ["image", "inspect", ref], options()), "image", ref)) {
          fail("postgres_candidate_publish_local_collision");
        }
      }
      receipt.localInventoryBefore = { images: baselineImages.length, containers: baselineContainers.length,
        volumes: baselineVolumes.length };
    });
    const baseRef = `${receipt.code.lock.base.repository}@${receipt.code.lock.base.platformDigest}`;
    const baseRaw = await phase("exact_public_base_manifest", () => {
      const raw = run(runner, "docker", ["buildx", "imagetools", "inspect", "--raw", baseRef], options()).stdout;
      return { raw: text(raw), proof: baseManifestValidator(text(raw)) };
    });
    await phase("exact_public_base_pull", () => {
      const before = inventory(runner, options(), "image");
      const preexisting = observe(runner, "docker", ["image", "inspect", baseRef], options());
      if (before.includes(receipt.code.lock.base.configId)) {
        if (absent(preexisting, "image", baseRef)) fail("postgres_candidate_publish_base_collision");
        validateBaseInspect(parseJson(preexisting.stdout, "postgres_candidate_publish_base_invalid"), receipt.code.lock);
      } else if (!absent(preexisting, "image", baseRef)) {
        fail("postgres_candidate_publish_base_collision");
      }
      basePullAttempted = true;
      run(runner, "docker", ["pull", "--platform", POSTGRES_CANDIDATE_PUBLISH.platform, baseRef], options());
      const base = validateBaseInspect(parseJson(run(runner, "docker", ["image", "inspect", baseRef], options()).stdout,
        "postgres_candidate_publish_base_invalid"), receipt.code.lock);
      baseInspect = base;
      baseAdded = !before.includes(base.Id); receipt.base = { imageId: base.Id, diffIds: base.RootFS.Layers,
        manifest: { configDigest: baseRaw.proof.configDigest, layers: baseRaw.proof.layers } };
    });
    await phase("fixed_offline_candidate_build", () => {
      writePrivate(path.join(buildContext, "Dockerfile"), receipt.code.files.get("infra/postgres-image/Dockerfile"));
      writePrivate(path.join(buildContext, receipt.code.lock.apk.fileName), receipt.code.files.get(receipt.code.lock.apk.sourcePath));
      writePrivate(path.join(buildContext, receipt.code.lock.apk.index.fileName), receipt.code.files.get(receipt.code.lock.apk.index.sourcePath));
      candidateBuildAttempted = true;
      run(runner, "docker", dockerBuildArguments(receipt.code.lock, buildContext, localTag, nonce), options());
      const candidate = validateCandidateInspect(parseJson(run(runner, "docker", ["image", "inspect", localTag], options()).stdout,
        "postgres_candidate_publish_candidate_invalid"), receipt.code.lock,
      validateBaseInspect(parseJson(run(runner, "docker", ["image", "inspect", baseRef], options()).stdout,
        "postgres_candidate_publish_base_invalid"), receipt.code.lock), nonce);
      candidateInspect = candidate;
      candidateId = candidate.Id; receipt.candidate = { configDigest: candidate.Id, diffIds: candidate.RootFS.Layers,
        localTag, remoteTag, labels: { [OWNER_LABEL]: nonce, [PURPOSE_LABEL]: PURPOSE } };
      const added = inventory(runner, options(), "image").filter((id) => !baselineImages.includes(id));
      const allowed = new Set([candidateId, ...(baseAdded ? [receipt.base.imageId] : [])]);
      if (added.length !== allowed.size || added.some((id) => !allowed.has(id))) {
        fail("postgres_candidate_publish_image_ownership_uncertain");
      }
    });
    const exportRootfs = async (kind, image, imageId) => phase(`${kind}_stopped_container_export`, () => {
      const name = `aw-pg-gosu-${nonce}-${kind}-export`;
      attemptedContainers.set(name, undefined);
      const create = run(runner, "docker", ephemeralContainerArguments({ name, image, nonce,
        entrypoint: "/bin/true" }), options());
      const id = text(create.stdout).trim(); if (!CONTAINER_ID.test(id)) fail("postgres_candidate_publish_container_invalid");
      attemptedContainers.set(name, id);
      validateStoppedContainer(run(runner, "docker", ["container", "inspect", id], options()).stdout,
        { id, name, nonce, imageId });
      const added = inventory(runner, options(), "container").filter((item) => !baselineContainers.includes(item));
      if (added.length !== attemptedContainers.size || !added.includes(id)) {
        fail("postgres_candidate_publish_container_ownership_uncertain");
      }
      const file = path.join(work, `${kind}-rootfs.tar`);
      run(runner, "docker", ["export", "--output", file, id], options());
      return { file, identity: fileIdentity(file) };
    });
    const baseExport = await exportRootfs("base", baseRef, receipt.base.imageId);
    const candidateExport = await exportRootfs("candidate", localTag, candidateId);
    receipt.filesystem = await phase("filesystem_policy", async () => {
      const verified = await filesystemVerifier({
      baseFile: baseExport.file, candidateFile: candidateExport.file, baseIdentity: baseExport.identity,
      candidateIdentity: candidateExport.identity, baseConfig: baseInspect, candidateConfig: candidateInspect,
      additionalLabels: receipt.candidate.labels, parentImage: receipt.base.imageId,
      startedAt: new Date(started).toISOString(), completedAt: new Date(now()).toISOString(),
      });
      return verified.result ?? verified;
    });
    receipt.archive = await phase("bounded_candidate_archive", () => {
      const archive = path.join(work, "candidate-image.tar");
      run(runner, "docker", ["image", "save", "--output", archive, localTag], options());
      const archiveFile = readBoundedDockerFile(archive, true);
      return archiveValidator(archiveFile.bytes, { imageId: candidateId, tag: localTag,
        expectedDiffIds: receipt.candidate.diffIds, expectedLayers: 12, maximumBytes: MAX_ARCHIVE_BYTES });
    });
    await phase("authorized_registry_login", () => run(runner, "docker", ["login", "ghcr.io", "--username",
      POSTGRES_CANDIDATE_PUBLISH.owner, "--password-stdin"], { ...options(authConfig), input: `${context.token}\n` }));
    let bootstrapRaw;
    receipt.bootstrap = await phase("private_bootstrap_auth_anonymous_auth", () => {
      bootstrapRaw = text(run(runner, "docker", ["buildx", "imagetools", "inspect", "--raw", BOOTSTRAP.subject], options(authConfig)).stdout);
      const first = bootstrapValidator(bootstrapRaw);
      const denied = anonymousDenied(observe(runner, "docker", ["buildx", "imagetools", "inspect", "--raw", BOOTSTRAP.subject], options()));
      const afterRaw = text(run(runner, "docker", ["buildx", "imagetools", "inspect", "--raw", BOOTSTRAP.subject], options(authConfig)).stdout);
      const after = bootstrapValidator(afterRaw);
      if (afterRaw !== bootstrapRaw || !same(first, after)) fail("postgres_candidate_publish_bootstrap_changed");
      return { ...first, anonymousRead: denied };
    });
    await phase("unique_remote_tag_absent", () => classifyRemoteTagAbsence(observe(runner, "docker",
      ["buildx", "imagetools", "inspect", "--raw", remoteReference], options(authConfig))));
    await phase("candidate_remote_tag", () => {
      run(runner, "docker", ["tag", localTag, remoteReference], options(authConfig)); remoteTagCreated = true;
    });
    await phase("protected_main_immediately_pre_push", () => verifyProtectedMain(fetchImpl, context, options(authConfig).timeout));
    const pushResult = await phase("single_candidate_push", () => {
      pushAttempted = true; receipt.publication = "ATTEMPTED_OUTCOME_UNCONFIRMED";
      return observe(runner, "docker", ["push", remoteReference], options(authConfig));
    });
    receipt.remote = await phase("exact_remote_manifest", () => {
      let rawResult;
      try { rawResult = run(runner, "docker", ["buildx", "imagetools", "inspect", "--raw", remoteReference], options(authConfig)); }
      catch (error) {
        if (pushResult.error || pushResult.signal || pushResult.status !== 0) {
          fail("postgres_candidate_publish_push_outcome_uncertain");
        }
        throw error;
      }
      const raw = text(rawResult.stdout);
      const digest = `sha256:${sha256(Buffer.from(raw, "utf8"))}`;
      return remoteValidator(raw, { digest, configDigest: candidateId,
        expectedLayers: 12, baseLayers: baseRaw.proof.layers });
    });
    receipt.subject = `${POSTGRES_CANDIDATE_PUBLISH.image}@${receipt.remote.sha256}`;
    await phase("exact_remote_digest_roundtrip", () => {
      const rawTag = text(run(runner, "docker", ["buildx", "imagetools", "inspect", "--raw", remoteReference], options(authConfig)).stdout);
      const rawDigest = text(run(runner, "docker", ["buildx", "imagetools", "inspect", "--raw", receipt.subject], options(authConfig)).stdout);
      if (rawTag !== rawDigest) fail("postgres_candidate_publish_remote_digest_mismatch");
      const verified = remoteValidator(rawDigest, { digest: receipt.remote.sha256, configDigest: candidateId,
        expectedLayers: 12, baseLayers: baseRaw.proof.layers });
      if (!same(verified, receipt.remote)) fail("postgres_candidate_publish_remote_digest_mismatch");
    });
    receipt.publication = "PUBLISHED_UNADMITTED"; receipt.state = "PUBLISHED_UNADMITTED";
    receipt.pushResponse = pushResult.error || pushResult.signal || pushResult.status !== 0
      ? "FAILED_BUT_REMOTE_EXACT_SUBJECT_CONFIRMED" : "SUCCESS";
    await phase("anonymous_candidate_denied", () => anonymousDenied(observe(runner, "docker",
      ["buildx", "imagetools", "inspect", "--raw", receipt.subject],
      options())));
    receipt.result = "PASSED";
  } catch (error) { primaryFailure = error; }

  const cleanupStarted = now(); const cleanupFailures = [];
  for (const [name, recordedId] of [...attemptedContainers.entries()].reverse()) {
    try {
      const inspected = observe(runner, "docker", ["container", "inspect", name], options(authConfig, true));
      if (absent(inspected, "container", name)) continue;
      const proven = validateStoppedContainer(inspected.stdout, { id: recordedId, name, nonce,
        imageId: name.endsWith("-base-export") ? receipt.base?.imageId : candidateId });
      const id = proven.id;
      const added = inventory(runner, options(authConfig, true), "container").filter((item) => !baselineContainers.includes(item));
      if (!added.includes(id) || added.some((item) => ![...attemptedContainers.values()].includes(item))) {
        fail("postgres_candidate_publish_container_ownership_uncertain");
      }
      const removed = observe(runner, "docker", ["rm", "--volumes", id], options(authConfig, true));
      if ((removed.error || removed.signal || removed.status !== 0)
        && !absent(observe(runner, "docker", ["container", "inspect", id], options(authConfig, true)), "container", id)) {
        fail("postgres_candidate_publish_container_cleanup_failed");
      }
    } catch { cleanupFailures.push("postgres_candidate_publish_container_cleanup_failed"); }
  }
  if (!candidateId && candidateBuildAttempted && baseInspect) {
    try {
      const inspected = observe(runner, "docker", ["image", "inspect", localTag], options(authConfig, true));
      if (!absent(inspected, "image", localTag)) {
        candidateInspect = validateCandidateInspect(parseJson(inspected.stdout,
          "postgres_candidate_publish_candidate_invalid"), lockJson, baseInspect, nonce);
        const added = inventory(runner, options(authConfig, true), "image").filter((id) => !baselineImages.includes(id));
        if (!added.includes(candidateInspect.Id) || added.some((id) => id !== candidateInspect.Id && id !== baseInspect.Id)) {
          fail("postgres_candidate_publish_image_ownership_uncertain");
        }
        candidateId = candidateInspect.Id;
      }
    } catch { cleanupFailures.push("postgres_candidate_publish_image_cleanup_uncertain"); }
  }
  if (candidateId) {
    try {
      const local = observe(runner, "docker", ["image", "inspect", localTag], options(authConfig, true));
      const remote = remoteTagCreated
        ? observe(runner, "docker", ["image", "inspect", remoteReference], options(authConfig, true)) : undefined;
      const proof = !absent(local, "image", localTag) ? local
        : remote && !absent(remote, "image", remoteReference) ? remote : undefined;
      if (proof) {
        const current = validateCandidateInspect(parseJson(proof.stdout,
          "postgres_candidate_publish_candidate_invalid"), lockJson, baseInspect, nonce);
        if (current.Id !== candidateId) fail("postgres_candidate_publish_image_ownership_uncertain");
        const added = inventory(runner, options(authConfig, true), "image").filter((id) => !baselineImages.includes(id));
        if (!added.includes(candidateId) || added.some((id) => id !== candidateId && id !== lockJson.base.configId)) {
          fail("postgres_candidate_publish_image_ownership_uncertain");
        }
        for (const reference of [...(remoteTagCreated ? [remoteReference] : []), localTag]) {
          const removed = observe(runner, "docker", ["image", "rm", reference], options(authConfig, true));
          if ((removed.error || removed.signal || removed.status !== 0)
            && !absent(observe(runner, "docker", ["image", "inspect", reference], options(authConfig, true)), "image", reference)) {
            fail("postgres_candidate_publish_image_cleanup_failed");
          }
        }
        const byId = observe(runner, "docker", ["image", "inspect", candidateId], options(authConfig, true));
        if (!absent(byId, "image", candidateId)) {
          const current = validateCandidateInspect(parseJson(byId.stdout,
            "postgres_candidate_publish_candidate_invalid"), lockJson, baseInspect, nonce);
          if (current.Id !== candidateId) fail("postgres_candidate_publish_image_ownership_uncertain");
          const removed = observe(runner, "docker", ["image", "rm", candidateId], options(authConfig, true));
          if ((removed.error || removed.signal || removed.status !== 0)
            && !absent(observe(runner, "docker", ["image", "inspect", candidateId], options(authConfig, true)), "image", candidateId)) {
            fail("postgres_candidate_publish_image_cleanup_failed");
          }
        }
      }
    } catch { cleanupFailures.push("postgres_candidate_publish_image_cleanup_failed"); }
  }
  if (!baseAdded && basePullAttempted && baselineImages && !baselineImages.includes(lockJson.base.configId)) {
    try {
      const inspected = observe(runner, "docker", ["image", "inspect", `${lockJson.base.repository}@${lockJson.base.platformDigest}`],
        options(authConfig, true));
      if (!absent(inspected, "image", `${lockJson.base.repository}@${lockJson.base.platformDigest}`)) {
        validateBaseInspect(parseJson(inspected.stdout, "postgres_candidate_publish_base_invalid"), lockJson);
        baseAdded = true;
      }
    } catch { cleanupFailures.push("postgres_candidate_publish_image_cleanup_uncertain"); }
  }
  if (baseAdded) {
    try {
      const reference = `${lockJson.base.repository}@${lockJson.base.platformDigest}`;
      const inspected = observe(runner, "docker", ["image", "inspect", reference], options(authConfig, true));
      if (!absent(inspected, "image", reference)) {
        validateBaseInspect(parseJson(inspected.stdout, "postgres_candidate_publish_base_invalid"), lockJson);
        run(runner, "docker", ["image", "rm", reference], options(authConfig, true));
      }
    }
    catch { cleanupFailures.push("postgres_candidate_publish_image_cleanup_failed"); }
  }
  try {
    if (baselineContainers && !same(inventory(runner, options(authConfig, true), "container"), baselineContainers)) {
      fail("postgres_candidate_publish_container_cleanup_uncertain");
    }
    if (baselineImages && !same(inventory(runner, options(authConfig, true), "image"), baselineImages)) {
      fail("postgres_candidate_publish_image_cleanup_uncertain");
    }
    if (baselineVolumes && !same(inventory(runner, options(authConfig, true), "volume"), baselineVolumes)) {
      fail("postgres_candidate_publish_volume_cleanup_uncertain");
    }
  } catch (error) { cleanupFailures.push(fixedReason(error)); }
  receipt.phases.push({ name: "owned_docker_cleanup", result: cleanupFailures.length ? "FAILED" : "PASSED",
    ...(cleanupFailures.length ? { reason: cleanupFailures[0], reasons: [...new Set(cleanupFailures)] } : {}),
    durationMs: now() - cleanupStarted });
  try { requireDirectory(work, workIdentity); rmSync(work, { recursive: true, force: false }); }
  catch { cleanupFailures.push("postgres_candidate_publish_temporary_cleanup_failed"); }
  receipt.phases.push({ name: "owned_temporary_cleanup", result: cleanupFailures.at(-1) === "postgres_candidate_publish_temporary_cleanup_failed"
    ? "FAILED" : "PASSED", durationMs: 0 });
  if (pushAttempted && receipt.publication !== "PUBLISHED_UNADMITTED") receipt.publication = "ATTEMPTED_OUTCOME_UNCONFIRMED";
  if (cleanupFailures.length) receipt.result = "FAILED";
  if (receipt.publication !== "PUBLISHED_UNADMITTED") {
    receipt.state = pushAttempted ? "OUTCOME_UNCONFIRMED" : "FAILED_BEFORE_PUBLICATION";
  }
  delete receipt.code?.files; delete receipt.code?.lock;
  requireDirectory(context.runnerTemp, runnerTempIdentity); requireDirectory(args.output, outputIdentity);
  writeFileSync(path.join(args.output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  if (primaryFailure) throw new Error(fixedReason(primaryFailure));
  if (cleanupFailures.length) throw new Error(cleanupFailures[0]);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { await runPostgresCandidatePublish(); }
  catch (error) { console.error(`postgres_candidate_publish_failed:${fixedReason(error)}`); process.exitCode = 1; }
}
