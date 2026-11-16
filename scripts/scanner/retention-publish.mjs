import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  createReadStream,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statfsSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { Writable } from "node:stream";
import {
  classifyAnonymousRemoteRead,
  parsePublishedDigest,
  validateRemoteManifest,
} from "../package-bootstrap/registry-proof.mjs";
import { parseBuildKitVersions } from "../package-bootstrap/prepare.mjs";
import { streamGitHubArtifactZip } from "../seaweed-image/download-artifact-zip.mjs";
import { scanRawUstar } from "../seaweed-image/archive.mjs";
import { githubArtifactZipProfiles, scanOwnedGitHubArtifactZip } from "../seaweed-image/read-artifact-zip.mjs";
import { validateScannerRetentionPublisherTools, validateScannerRetentionQualificationTools }
  from "./retention-tool-identity.mjs";
import {
  SCANNER_RETENTION,
  canonicalJsonBytes,
  createScannerRetentionPublicationBinding,
  createScannerRetentionQualificationBinding,
  createScannerRetentionRestoreManifest,
  scannerRetentionPublisherPhases,
  sha256,
  validateScannerRetentionPublisherBinding,
  validateScannerRetentionPublisherReceiptBytes,
} from "./retention-policy.mjs";

const REVISION = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const PACKAGE_NAME = "auto-world-scanner-closure";
const PACKAGE_OWNER = "CleMeY15";
const MAIN_REF_URL = "https://api.github.com/repos/CleMeY15/auto-world/git/ref/heads/main";
const MAIN_COMMIT_URL = "https://api.github.com/repos/CleMeY15/auto-world/git/commits/";
const PACKAGE_URL = `https://api.github.com/users/${PACKAGE_OWNER}/packages/container/${PACKAGE_NAME}`;
const PACKAGE_VERSIONS_URL = `${PACKAGE_URL}/versions?per_page=2&page=1`;
const INDEX_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]);
const MANIFEST_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]);
const CONFIG_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.config.v1+json",
  "application/vnd.docker.container.image.v1+json",
]);
const LAYER_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.layer.v1.tar",
  "application/vnd.oci.image.layer.v1.tar+gzip",
  "application/vnd.docker.image.rootfs.diff.tar",
  "application/vnd.docker.image.rootfs.diff.tar.gzip",
]);

function fail(reason) {
  throw new Error(reason);
}

function fixedReason(error, fallback = "scanner_retention_bootstrap_command_failed") {
  if (!(error instanceof Error)) return fallback;
  const message = error.message;
  return /^scanner_retention_(?:bootstrap|read_proof|publish|mode|arguments)_[a-z0-9_]+$/u.test(message)
    ? message
    : fallback;
}

const fixedReadReason = (error) => fixedReason(error, "scanner_retention_read_proof_command_failed");

export function parseScannerRetentionArguments(argv) {
  if (argv.length === 3 && argv[0] === "read-proof" && argv[1] === "--output" && path.isAbsolute(argv[2])) {
    return { mode: "read-proof", output: path.resolve(argv[2]) };
  }
  if (argv.length === 3 && argv[0] === "publish" && argv[1] === "--output" && path.isAbsolute(argv[2])) {
    return { mode: "publish", output: path.resolve(argv[2]) };
  }
  if (argv.length === 3 && argv[0] === "bootstrap" && argv[1] === "--output" && path.isAbsolute(argv[2])) {
    return { mode: "bootstrap", output: path.resolve(argv[2]) };
  }
  fail("scanner_retention_arguments_invalid");
}

const PUBLISH_WORKFLOW = ".github/workflows/scanner-retention-publish.yml";
const PUBLISH_WORKFLOW_REF = `${SCANNER_RETENTION.repository}/${PUBLISH_WORKFLOW}@refs/heads/main`;
const PUBLISH_PHASES = scannerRetentionPublisherPhases;

export function validateScannerRetentionClosurePolicy(closure = SCANNER_RETENTION.closure) {
  if (!closure || closure.format !== "ustar" || closure.blockingFactor !== 1
    || closure.tarCapBytes !== 468374629 || closure.expandedCapBytes !== 468322405
    || closure.publisherPeakBytes !== 4016376616 || closure.publisherRequiredFreeBytes !== 5020470770
    || !Array.isArray(closure.members) || closure.members.length !== 50) {
    fail("scanner_retention_publish_policy_invalid");
  }
  const paths = closure.members.map((member) => member?.path);
  if (new Set(paths).size !== 50 || paths.some((entry) => typeof entry !== "string"
    || !/^scanner-closure\/[\x21-\x7e]+$/u.test(entry))
    || paths.some((entry, index) => index > 0 && Buffer.compare(Buffer.from(paths[index - 1]), Buffer.from(entry)) >= 0)) {
    fail("scanner_retention_publish_policy_invalid");
  }
  for (const member of closure.members) {
    if (!Object.hasOwn(member, "origin") || !Object.hasOwn(member, "sourcePath")
      || !Object.hasOwn(member, "producer") || !Object.hasOwn(member, "bytes")
      || !Object.hasOwn(member, "sha256") || !Object.hasOwn(member, "capBytes")
      || !Object.hasOwn(member, "headerMode") || !Number.isSafeInteger(member.capBytes)
      || member.capBytes < 1 || ![0o444, 0o555].includes(member.headerMode)
      || (member.path === "scanner-closure/binary/trivy") !== (member.headerMode === 0o555)
      || (member.bytes !== null && (!Number.isSafeInteger(member.bytes) || member.bytes < 0 || member.bytes > member.capBytes))
      || (member.sha256 !== null && !HEX_SHA256.test(member.sha256))) {
      fail("scanner_retention_publish_policy_invalid");
    }
  }
  return closure;
}

export function scannerRetentionTarInvocation({ archive, stage, memberList }) {
  if (![archive, stage, memberList].every((entry) => typeof entry === "string"
    && (path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry)))) {
    fail("scanner_retention_publish_tar_arguments_invalid");
  }
  validateScannerRetentionClosurePolicy();
  return Object.freeze(["--create", `--file=${archive}`, "--format=ustar", "--blocking-factor=1",
    "--no-recursion", "--sort=name", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner",
    "--no-acls", "--no-selinux", "--no-xattrs", `--directory=${stage}`, "--null",
    "--verbatim-files-from", `--files-from=${memberList}`]);
}

export function validateScannerRetentionPublishContext(env, platform = process.platform) {
  const publisher = SCANNER_RETENTION.publisher;
  const token = env.GITHUB_TOKEN;
  if (!publisher || platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_OS !== "Linux" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REPOSITORY !== SCANNER_RETENTION.repository || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_WORKFLOW_REF !== PUBLISH_WORKFLOW_REF || env.GITHUB_JOB !== publisher.job
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID ?? "") || !REVISION.test(env.GITHUB_SHA ?? "")
    || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA
    || env.RUNNER_TEMP !== "/home/runner/work/_temp" || typeof env.GITHUB_WORKSPACE !== "string"
    || !path.posix.isAbsolute(env.GITHUB_WORKSPACE) || path.posix.normalize(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE
    || typeof token !== "string" || token.length < 1 || token.length > 8192 || /\s/u.test(token)
    || env.GH_TOKEN !== token || typeof env.PATH !== "string" || env.PATH.length < 1 || env.PATH.length > 32768
    || /[\r\n\0]/u.test(env.PATH)) fail("scanner_retention_publish_context_invalid");
  return Object.freeze({ publisher, token, runId: env.GITHUB_RUN_ID, headSha: env.GITHUB_SHA,
    workspace: env.GITHUB_WORKSPACE, runnerTemp: env.RUNNER_TEMP, path: env.PATH });
}

export function scannerRetentionPublisherChildEnvironment(context, dockerConfig, work) {
  for (const value of [dockerConfig, work]) if (typeof value !== "string"
    || (!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value))) {
    fail("scanner_retention_publish_environment_invalid");
  }
  return Object.freeze({ CI: "true", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
    HOME: work, TMPDIR: work, RUNNER_TEMP: context.runnerTemp, GITHUB_WORKSPACE: context.workspace,
    GH_PROMPT_DISABLED: "1", GH_DEBUG: "", DOCKER_CONFIG: dockerConfig,
    GOTOOLCHAIN: "local", PATH: context.path });
}

export function createScannerRetentionPublisherReceipt(context, values = {}) {
  const receipt = {
    schemaVersion: 1, state: values.state ?? "PUBLISHED_UNADMITTED", result: values.result ?? "FAILED",
    repository: SCANNER_RETENTION.repository, workflow: PUBLISH_WORKFLOW, runId: context.runId,
    runAttempt: 1, headSha: context.headSha, headTree: values.headTree ?? null,
    qualificationArtifact: values.qualificationArtifact ?? null, package: SCANNER_RETENTION.package,
    tag: values.tag ?? null, ghcrManifestDigest: values.ghcrManifestDigest ?? null,
    innerTar: values.innerTar ?? null, restoreManifest: values.restoreManifest ?? null,
    oci: values.oci ?? null, phases: values.phases ?? [],
    cleanup: values.cleanup ?? { state: "PENDING", image: "NOT_CREATED", container: "NOT_CREATED",
      buildCache: "NOT_CREATED", authenticatedDockerConfig: "NOT_CREATED", ownedPathRemoved: false },
    claims: { forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED", scannerExecuted: false,
      retained: false, restored: false, admitted: false, supportStart: null, supportEnd: null },
  };
  let bytes;
  try { bytes = canonicalJsonBytes(receipt, 262144); }
  catch (error) {
    if (error?.message === "scanner_retention_json_cap_exceeded") fail("scanner_retention_publish_receipt_too_large");
    throw error;
  }
  if (bytes.length > 262144) fail("scanner_retention_publish_receipt_too_large");
  return Object.freeze({ receipt: Object.freeze(receipt), bytes });
}

export async function TEST_ONLY_runScannerRetentionPublish(options = {}) {
  const context = (options.validateContext ?? validateScannerRetentionPublishContext)(options.env ?? process.env,
    options.platform ?? process.platform);
  validateScannerRetentionClosurePolicy(options.closure ?? SCANNER_RETENTION.closure);
  if (typeof options.runPhase !== "function") fail("scanner_retention_publish_dependencies_invalid");
  const phases = [];
  const values = {};
  for (const name of PUBLISH_PHASES) {
    const started = (options.now ?? Date.now)();
    try {
      const result = await options.runPhase(name, Object.freeze({ context, values: Object.freeze({ ...values }) }));
      if (!result || typeof result !== "object" || Array.isArray(result)) fail("scanner_retention_publish_phase_invalid");
      Object.assign(values, result.values ?? {});
      phases.push({ name, result: "PASSED", durationMs: Math.max(0, (options.now ?? Date.now)() - started) });
    } catch (error) {
      phases.push({ name, result: "FAILED", durationMs: Math.max(0, (options.now ?? Date.now)() - started) });
      const failure = new Error(fixedReason(error, "scanner_retention_publish_command_failed"));
      failure.publisherProgress = { context, values, phases };
      throw failure;
    }
  }
  return createScannerRetentionPublisherReceipt(context, { ...values, state: "PUBLISHED_UNADMITTED",
    result: "PASSED", phases });
}

function publishRun(commandRunner, context, command, args, { input, env, cwd = context.workspace, timeout } = {}) {
  return run(commandRunner, command, args, { cwd, env, input, timeout: context.publisher.operationTimeoutMs,
    ...(timeout === undefined ? {} : { timeout }),
    failurePrefix: "scanner_retention_publish" });
}

function publishDockerInventory(commandRunner, context, options) {
  const read = (args) => [...new Set(publishRun(commandRunner, context, "docker", args, options).stdout
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean))].sort();
  return Object.freeze({
    images: read(["image", "ls", "--all", "--no-trunc", "--quiet"]),
    containers: read(["container", "ls", "--all", "--no-trunc", "--quiet"]),
    volumes: read(["volume", "ls", "--quiet"]),
  });
}

function addedInventory(current, baseline) {
  return current.filter((identity) => !baseline.includes(identity));
}

function writeExclusive(filename, bytes, mode = 0o400) {
  let descriptor;
  try {
    descriptor = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (!Number.isSafeInteger(written) || written < 1) fail("scanner_retention_publish_write_failed");
      offset += written;
    }
    fsyncSync(descriptor); const info = fstatSync(descriptor);
    if (!info.isFile() || info.nlink !== 1 || info.size !== bytes.length) fail("scanner_retention_publish_write_failed");
    closeSync(descriptor); descriptor = undefined; chmodSync(filename, mode);
  } catch (error) {
    if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* original failure wins */ }
    if (/^scanner_retention_publish_/u.test(error?.message ?? "")) throw error;
    fail("scanner_retention_publish_write_failed");
  }
}

function writePublisherReceipt(output, bytes) {
  // This is the sole public payload. Its ZIP profile requires the producer's 0644 mode.
  writeExclusive(path.join(output, "publisher-receipt.json"), bytes, 0o644);
}

export const TEST_ONLY_writeScannerRetentionPublisherReceipt = writePublisherReceipt;

function securePublishDirectory(directory) {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory
    || (info.mode & 0o077) !== 0) fail("scanner_retention_publish_directory_invalid");
}

function publishDirectoryIdentity(directory) {
  securePublishDirectory(directory);
  const info = lstatSync(directory);
  return { dev: info.dev, ino: info.ino, uid: info.uid };
}

function removePublishDirectory(directory, identity) {
  if (!identity) fail("scanner_retention_publish_directory_unowned");
  const current = publishDirectoryIdentity(directory);
  if (current.dev !== identity.dev || current.ino !== identity.ino || current.uid !== identity.uid) {
    fail("scanner_retention_publish_directory_changed");
  }
  rmSync(directory, { recursive: true, force: false });
}

function publisherAbsent(result, type, identity) {
  if (type !== "builder") {
    try { return exactReadAbsent(result, type); }
    catch { fail("scanner_retention_publish_cleanup_inspect_failed"); }
  }
  if (result.error || result.signal || result.status !== 1
    || !result.stderr.includes(`no builder "${identity}" found`)) {
    fail("scanner_retention_publish_cleanup_inspect_failed");
  }
  return true;
}

export const TEST_ONLY_scannerRetentionPublisherAbsent = publisherAbsent;

function publishEntrySink(stage, mappings) {
  const selected = new Map(mappings.map((mapping) => [mapping.sourcePath, mapping]));
  return (entry) => {
    const mapping = selected.get(entry.path);
    if (!mapping) return new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const output = path.join(stage, ...mapping.closurePath.split("/"));
    mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    let descriptor = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | constants.O_NOFOLLOW, 0o600); let bytes = 0; const chunks = [];
    return new Writable({
      write(chunk, _encoding, callback) {
        try { bytes += chunk.length; chunks.push(Buffer.from(chunk)); let offset = 0;
          while (offset < chunk.length) { const written = writeSync(descriptor, chunk, offset, chunk.length - offset);
            if (written < 1) fail("scanner_retention_publish_write_failed"); offset += written; } callback(); }
        catch (error) { callback(error); }
      },
      final(callback) {
        try { fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
          const value = Buffer.concat(chunks, bytes);
          if (bytes !== mapping.bytes || sha256(value) !== mapping.sha256) fail("scanner_retention_publish_qualification_member_invalid");
          chmodSync(output, 0o444); callback(); } catch (error) { callback(error); }
      },
      destroy(error, callback) { try { if (descriptor !== undefined) closeSync(descriptor); callback(error); }
        catch (closeError) { callback(error ?? closeError); } },
    });
  };
}

async function verifyQualificationApi(context, fetchImpl, now) {
  const q = SCANNER_RETENTION.qualification; const base = `https://api.github.com/repos/${q.repository}`;
  const [runResult, jobsResult, artifactResult, commitResult] = await Promise.all([
    requestApi(fetchImpl, `${base}/actions/runs/${q.runId}`, context.token, [200]),
    requestApi(fetchImpl, `${base}/actions/runs/${q.runId}/attempts/${q.runAttempt}/jobs?per_page=100&page=1`, context.token, [200]),
    requestApi(fetchImpl, `${base}/actions/artifacts/${q.artifact.id}`, context.token, [200]),
    requestApi(fetchImpl, `${base}/git/commits/${q.headSha}`, context.token, [200]),
  ]);
  const runBody = parseJson(runResult.bytes); const jobsBody = parseJson(jobsResult.bytes);
  const artifact = parseJson(artifactResult.bytes); const commit = parseJson(commitResult.bytes);
  const jobs = Array.isArray(jobsBody?.jobs) ? jobsBody.jobs.filter((job) => job?.id === q.jobId) : [];
  const requiredSteps = [
    "Check out source without persistent credentials", "Provision exact managed Node.js",
    "Run pure scanner and workflow regression tests", "Verify official scanner provenance before extraction",
    "Qualify tools, build and audit all five managed runtime roles",
    "Preserve public reports and provenance, including failures",
  ];
  const steps = Array.isArray(jobs[0]?.steps) ? jobs[0].steps : [];
  const observedAt = now();
  if (runBody?.id !== q.runId || runBody.run_attempt !== 1 || runBody.path !== q.workflow
    || runBody.event !== "push" || runBody.head_branch !== "main" || runBody.head_sha !== q.headSha
    || runBody.repository?.full_name !== q.repository || runBody.status !== "completed" || runBody.conclusion !== "success"
    || commit?.sha !== q.headSha || commit?.tree?.sha !== q.headTree || jobsBody.total_count !== 1
    || jobsBody.jobs?.length !== 1 || jobs.length !== 1
    || jobs[0].name !== "Audit builders, construct and audit managed subjects" || jobs[0].status !== "completed"
    || jobs[0].run_id !== q.runId || jobs[0].run_attempt !== q.runAttempt || jobs[0].head_sha !== q.headSha
    || requiredSteps.some((name) => {
      const matches = steps.filter((step) => step?.name === name);
      return matches.length !== 1 || matches[0].status !== "completed" || matches[0].conclusion !== "success";
    })
    || jobs[0].conclusion !== "success" || artifact?.id !== q.artifact.id || artifact.name !== q.artifact.name
    || artifact.expired !== false || artifact.size_in_bytes !== q.artifact.sizeInBytes
    || artifact.digest !== q.artifact.digest || artifact.url !== q.artifact.url
    || artifact.archive_download_url !== q.artifact.archiveDownloadUrl
    || artifact.workflow_run?.id !== q.runId || artifact.workflow_run?.head_sha !== q.headSha
    || artifact.created_at !== q.artifact.createdAt || artifact.updated_at !== q.artifact.updatedAt
    || artifact.expires_at !== q.artifact.expiresAt || !Number.isFinite(observedAt)
    || !Number.isFinite(Date.parse(artifact.expires_at))
    || Date.parse(artifact.expires_at) <= observedAt) fail("scanner_retention_publish_qualification_api_invalid");
  return Object.freeze({ id: artifact.id, name: artifact.name, size: artifact.size_in_bytes,
    digest: artifact.digest, expiresAt: artifact.expires_at });
}

export const TEST_ONLY_verifyScannerRetentionQualificationApi = verifyQualificationApi;

export function validateScannerRetentionReadbackState(image, container, expected) {
  const state = container?.State;
  if (image?.Id !== expected.imageId || image?.Os !== "linux" || image?.Architecture !== "amd64"
    || !Array.isArray(image.RepoDigests) || !image.RepoDigests.includes(expected.subject)
    || container?.Id !== expected.containerId || container?.Image !== expected.imageId
    || container?.Name !== `/${expected.containerName}` || container?.Config?.Image !== expected.subject
    || state?.Status !== "created" || state?.Running !== false || state?.Paused !== false
    || state?.Restarting !== false || state?.Dead !== false
    || state?.StartedAt !== "0001-01-01T00:00:00Z" || state?.FinishedAt !== "0001-01-01T00:00:00Z") {
    fail("scanner_retention_publish_readback_invalid");
  }
  return Object.freeze({ imageId: image.Id, containerId: container.Id, stoppedNeverStarted: true });
}

async function readQualifiedRepositoryBlob(context, fetchImpl, item) {
  const endpoint = `https://api.github.com/repos/${SCANNER_RETENTION.repository}/contents/${item.sourcePath
    .split("/").map(encodeURIComponent).join("/")}?ref=${SCANNER_RETENTION.qualification.headSha}`;
  const body = parseJson((await requestApi(fetchImpl, endpoint, context.token, [200])).bytes);
  if (body?.type !== "file" || body.path !== item.sourcePath || body.size !== item.bytes
    || body.encoding !== "base64" || typeof body.content !== "string") fail("scanner_retention_publish_source_blob_invalid");
  const bytes = Buffer.from(body.content.replaceAll("\n", ""), "base64");
  if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) fail("scanner_retention_publish_source_blob_invalid");
  return bytes;
}

function validateStagedClosure(stage, allowGenerated = false) {
  const members = validateScannerRetentionClosurePolicy().members;
  for (const member of members) {
    if (!allowGenerated && member.origin === "GENERATED_POSTCONDITION") continue;
    const file = path.join(stage, ...member.path.split("/"));
    const info = lstatSync(file); const bytes = readFileSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || bytes.length > member.capBytes
      || (member.bytes !== null && bytes.length !== member.bytes)
      || (member.sha256 !== null && sha256(bytes) !== member.sha256)) fail("scanner_retention_publish_staged_member_invalid");
    chmodSync(file, member.headerMode);
  }
}

function stageVerifiedBytes(state, closurePath, bytes, expected = {}) {
  if (!Buffer.isBuffer(bytes) || (expected.bytes !== undefined && bytes.length !== expected.bytes)
    || (expected.sha256 !== undefined && sha256(bytes) !== expected.sha256)) {
    fail("scanner_retention_publish_staged_member_invalid");
  }
  const output = path.join(state.stage, ...closurePath.split("/"));
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  writeExclusive(output, bytes, closurePath === "scanner-closure/binary/trivy" ? 0o500 : 0o400);
}

function publisherDescriptor(value, allowedMediaTypes, cap) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !allowedMediaTypes.has(value.mediaType) || typeof value.digest !== "string" || !DIGEST.test(value.digest)
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > cap) {
    fail("scanner_retention_publish_manifest_invalid");
  }
  return value;
}

function parseDockerManifest(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > SCANNER_RETENTION.publisher.registryCapBytes) {
    fail("scanner_retention_publish_manifest_invalid");
  }
  const bytes = Buffer.from(raw, "utf8"); const body = parseJson(bytes);
  if (body?.schemaVersion !== 2 || !MANIFEST_MEDIA_TYPES.has(body.mediaType)
    || !body.config || !Array.isArray(body.layers) || body.layers.length !== 1) {
    fail("scanner_retention_publish_manifest_invalid");
  }
  const rawConfig = publisherDescriptor(body.config, CONFIG_MEDIA_TYPES, SCANNER_RETENTION.publisher.registryCapBytes);
  const rawLayer = publisherDescriptor(body.layers[0], LAYER_MEDIA_TYPES, SCANNER_RETENTION.closure.tarCapBytes + 1024 ** 2);
  const config = { digest: rawConfig.digest, mediaType: rawConfig.mediaType, bytes: rawConfig.size,
    sha256: rawConfig.digest.slice("sha256:".length) };
  const layer = { digest: rawLayer.digest, mediaType: rawLayer.mediaType, bytes: rawLayer.size,
    sha256: rawLayer.digest.slice("sha256:".length) };
  return { bytes, digest: `sha256:${sha256(bytes)}`, mediaType: body.mediaType, config, layer };
}

export const TEST_ONLY_parseScannerRetentionPublisherManifest = parseDockerManifest;

function validatePublisherCurrentTools(state, context, commandRunner, options, checkpoint, log) {
  validateScannerRetentionQualificationTools(readFileSync(
    path.join(state.stage, "scanner-closure/qualification/runner-tools.txt"),
  ));
  const identity = validateScannerRetentionPublisherTools({
    docker: publishRun(commandRunner, context, "docker", ["version", "--format", "{{json .}}"], options()).stdout,
    buildx: publishRun(commandRunner, context, "docker", ["buildx", "version"], options()).stdout,
    go: publishRun(commandRunner, context, "go", ["version"], options()).stdout,
  });
  log(`${JSON.stringify({ event: "scanner_retention_publish_tools", checkpoint, ...identity })}\n`);
  return identity;
}

function publishOciCandidate(state, context, commandRunner, options, log) {
  const contextRoot = path.join(state.work, "oci-context"); mkdirSync(contextRoot, { mode: 0o700 });
  writeExclusive(path.join(contextRoot, "Dockerfile"), Buffer.from("FROM scratch\nCOPY scanner-closure.tar /closure/scanner-closure.tar\n", "utf8"));
  writeExclusive(path.join(contextRoot, "scanner-closure.tar"), readFileSync(state.archive));
  const initialTools = validatePublisherCurrentTools(state, context, commandRunner, options, "before_login", log);
  publishRun(commandRunner, context, "docker", ["login", "ghcr.io", "--username", "CleMeY15", "--password-stdin"],
    { ...options(), input: `${context.token}\n` });
  state.builderBaseline = publishDockerInventory(commandRunner, context, options());
  const builder = `aw-scanner-retention-${context.runId}`;
  publishRun(commandRunner, context, "docker", ["buildx", "create", "--name", builder,
    "--driver", "docker-container", "--use"], options());
  state.builder = builder;
  state.builderAcquired = true;
  const builderInspection = publishRun(commandRunner, context, "docker", ["buildx", "inspect", "--bootstrap", state.builder], options()).stdout;
  state.buildKitBackendVersions = parseBuildKitVersions(builderInspection);
  if (!Array.isArray(state.buildKitBackendVersions) || state.buildKitBackendVersions.length < 1) {
    fail("scanner_retention_publish_tool_identity_invalid");
  }
  const beforePush = validatePublisherCurrentTools(state, context, commandRunner, options, "before_push", log);
  if (JSON.stringify(beforePush) !== JSON.stringify(initialTools)) {
    fail("scanner_retention_publish_tool_identity_changed");
  }
  publishRun(commandRunner, context, "docker", ["buildx", "build", "--builder", state.builder,
    "--platform", "linux/amd64", "--provenance=false", "--sbom=false", "--pull=false",
    "--no-cache", "--output", `type=registry,name=${state.tag},push=true`, contextRoot], options());
  const raw = publishRun(commandRunner, context, "docker", ["buildx", "imagetools", "inspect", "--raw", state.tag], options()).stdout;
  state.manifest = parseDockerManifest(raw); state.subject = `${SCANNER_RETENTION.package}@${state.manifest.digest}`;
  return { values: { ghcrManifestDigest: state.manifest.digest, oci: { manifest: {
    mediaType: state.manifest.mediaType, bytes: state.manifest.bytes.length, sha256: sha256(state.manifest.bytes) },
    config: state.manifest.config, layer: state.manifest.layer, readback: null } } };
}

export const TEST_ONLY_publishScannerRetentionCandidate = publishOciCandidate;

function createProductionPublisherRunner(parsed, {
  commandRunner = defaultCommandRunner, fetchImpl = globalThis.fetch, now = Date.now,
  download = streamGitHubArtifactZip, scan = scanOwnedGitHubArtifactZip, statfs = statfsSync,
  log = (record) => process.stdout.write(record),
} = {}) {
  const state = { parsed, commandRunner, fetchImpl, now, download, scan };
  const phase = async (name, { context }) => {
    state.context = context;
    if (state.operationDeadline !== undefined && now() >= state.operationDeadline) {
      fail("scanner_retention_publish_timeout");
    }
    const options = (dockerConfig = state.dockerConfig) => ({
      cwd: context.workspace,
      env: scannerRetentionPublisherChildEnvironment(context, dockerConfig, state.work),
      timeout: state.operationDeadline === undefined ? context.publisher.operationTimeoutMs
        : Math.max(1, state.operationDeadline - now()),
    });
    if (name === "context_and_capacity") {
      validateScannerRetentionPublisherBinding();
      state.operationDeadline = now() + context.publisher.operationTimeoutMs;
      if (parsed.output !== path.join(context.runnerTemp, "scanner-retention-publisher-public")) {
        fail("scanner_retention_publish_output_invalid");
      }
      securePublishDirectory(parsed.output);
      const capacity = statfs(context.runnerTemp);
      const available = capacity.bavail * capacity.bsize;
      if (!Number.isSafeInteger(available) || available < SCANNER_RETENTION.closure.publisherRequiredFreeBytes) {
        fail("scanner_retention_publish_capacity_invalid");
      }
      state.work = path.join(context.runnerTemp, `scanner-retention-publish-${context.runId}`);
      state.provenanceRoot = path.join(context.runnerTemp, "trivy-provenance");
      state.stage = path.join(state.work, "stage"); state.downloadRoot = path.join(state.work, "qualification-download");
      state.dockerConfig = path.join(state.work, "docker-auth"); state.readDockerConfig = path.join(state.work, "docker-readback");
      mkdirSync(state.work, { mode: 0o700 });
      state.workIdentity = publishDirectoryIdentity(state.work);
      for (const directory of [state.stage, state.downloadRoot, state.dockerConfig, state.readDockerConfig]) {
        mkdirSync(directory, { recursive: false, mode: 0o700 }); securePublishDirectory(directory);
      }
      return { values: {} };
    }
    if (name === "protected_main") {
      if (readdirSync(context.workspace).length < 1) fail("scanner_retention_publish_checkout_invalid");
      const status = publishRun(commandRunner, context, "git", ["status", "--porcelain=v1"], options());
      if (status.stdout !== "") fail("scanner_retention_publish_checkout_invalid");
      const sha = boundedIdentity(publishRun(commandRunner, context, "git", ["rev-parse", "HEAD"], options()).stdout,
        "scanner_retention_publish_checkout_invalid");
      const tree = boundedIdentity(publishRun(commandRunner, context, "git", ["rev-parse", "HEAD^{tree}"], options()).stdout,
        "scanner_retention_publish_checkout_invalid");
      if (sha !== context.headSha || !REVISION.test(tree)) fail("scanner_retention_publish_checkout_invalid");
      await verifyProtectedMain(fetchImpl, { token: context.token, sourceSha: context.headSha }, tree);
      state.headTree = tree; return { values: { headTree: tree } };
    }
    if (name === "package_controls") {
      const packageResult = parseJson((await requestApi(fetchImpl, PACKAGE_URL, context.token, [200])).bytes);
      const versions = parseJson((await requestApi(fetchImpl, PACKAGE_VERSIONS_URL, context.token, [200])).bytes);
      const bootstrap = SCANNER_RETENTION.readProof.bootstrap;
      const bootstrapTag = bootstrap.tag.slice(`${SCANNER_RETENTION.package}:`.length);
      if (packageResult?.id !== SCANNER_RETENTION.observations.packageId || packageResult.visibility !== "private"
        || packageResult.repository?.full_name !== SCANNER_RETENTION.repository || !Array.isArray(versions)
        || versions.length !== 1 || versions[0]?.name !== bootstrap.manifestDigest
        || !Array.isArray(versions[0]?.metadata?.container?.tags)
        || versions[0].metadata.container.tags.length !== 1
        || versions[0].metadata.container.tags[0] !== bootstrapTag) fail("scanner_retention_publish_package_controls_invalid");
      return { values: {} };
    }
    if (name === "qualification_api") {
      state.qualificationArtifact = await verifyQualificationApi(context, fetchImpl, now);
      return { values: { qualificationArtifact: { id: state.qualificationArtifact.id,
        name: state.qualificationArtifact.name, digest: state.qualificationArtifact.digest,
        bytes: state.qualificationArtifact.size, expiresAt: state.qualificationArtifact.expiresAt } } };
    }
    if (name === "qualification_zip") {
      const zip = path.join(state.downloadRoot, "artifact.zip"); let handle;
      try {
        handle = await open(zip, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await download({ artifact: state.qualificationArtifact, handle,
          timeoutMs: Math.max(1, state.operationDeadline - now()),
          env: { ...scannerRetentionPublisherChildEnvironment(context, state.dockerConfig, state.work), GH_TOKEN: context.token } });
        await handle.sync(); await handle.close(); handle = undefined;
        state.qualificationScan = await scan({ file: zip, root: state.downloadRoot,
          descriptor: state.qualificationArtifact, profile: githubArtifactZipProfiles.scannerRetention,
          openEntrySink: publishEntrySink(state.stage, SCANNER_RETENTION.qualification.sourceMappings) });
      } finally { try { await handle?.close(); } catch { /* original failure wins */ } }
      return { values: {} };
    }
    if (name === "official_provenance") {
      const root = state.provenanceRoot; state.provenanceIdentity = publishDirectoryIdentity(root);
      const fresh = [
        ["scanner-closure/upstream/trivy_0.76.2_Linux-64bit.tar.gz", "download/trivy_0.76.2_Linux-64bit.tar.gz", 52714130, "bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf"],
        ["scanner-closure/binary/trivy", "bin/trivy", 176386208, "6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3"],
        ["scanner-closure/inventory/go-build-info.txt", "public/go-build-info.txt", 37019, "a3049a3271abec48a51c86d64b68847e9e382f1039975556d8a5e4c1887d975b"],
        ["scanner-closure/provenance/trivy.attestation.jsonl", "public/trivy.attestation.jsonl"],
        ...["verification-workflow.json", "verification-identity.json", "verification-after-controls.json",
          "provenance-controls.tsv", "changed-bytes.stdout.txt", "changed-bytes.stderr.txt",
          "wrong-source.stdout.txt", "wrong-source.stderr.txt", "wrong-workflow.stdout.txt",
          "wrong-workflow.stderr.txt", "wrong-ref.stdout.txt", "wrong-ref.stderr.txt", "received-sha256.txt"]
          .map((file) => [`scanner-closure/provenance/${file}`, `public/${file}`]),
      ];
      for (const [closurePath, relative, bytes, digest] of fresh) {
        const value = readFileSync(path.join(root, ...relative.split("/")));
        stageVerifiedBytes(state, closurePath, value, { ...(bytes === undefined ? {} : { bytes }),
          ...(digest === undefined ? {} : { sha256: digest }) });
      }
      const probe = Buffer.from("module auto.world/scanner-version-probe\n\ngo 1.27.3\n\nrequire github.com/aquasecurity/trivy v0.76.2\n", "utf8");
      stageVerifiedBytes(state, "scanner-closure/qualification/scanner-version-probe.go.mod", probe,
        SCANNER_RETENTION.qualification.deterministicQualifiedProbe);
      return { values: {} };
    }
    if (name === "qualified_source_blobs") {
      for (const item of SCANNER_RETENTION.qualification.staticQualifiedBlobs) {
        stageVerifiedBytes(state, item.closurePath, await readQualifiedRepositoryBlob(context, fetchImpl, item), item);
      }
      return { values: {} };
    }
    if (name === "canonical_manifests") {
      const publication = createScannerRetentionPublicationBinding({ headSha: context.headSha,
        headTree: state.headTree, runId: context.runId });
      stageVerifiedBytes(state, "scanner-closure/source/qualification-binding.json",
        canonicalJsonBytes(createScannerRetentionQualificationBinding(), 1048576));
      stageVerifiedBytes(state, "scanner-closure/source/publication-binding.json", canonicalJsonBytes(publication, 1048576));
      const files = validateScannerRetentionClosurePolicy().members.filter((member) => member.path !== "scanner-closure/restore-manifest.json")
        .map((member) => { const bytes = readFileSync(path.join(state.stage, ...member.path.split("/")));
          return { path: member.path, class: member.origin, bytes: bytes.length, sha256: sha256(bytes) }; });
      const restoreManifest = createScannerRetentionRestoreManifest({ publication, files });
      const restoreBytes = canonicalJsonBytes(restoreManifest, 2097152);
      stageVerifiedBytes(state, "scanner-closure/restore-manifest.json", restoreBytes);
      state.restoreManifest = { bytes: restoreBytes.length, sha256: sha256(restoreBytes) };
      validateStagedClosure(state.stage, true);
      return { values: { restoreManifest: state.restoreManifest } };
    }
    if (name === "deterministic_ustar") {
      const paths = validateScannerRetentionClosurePolicy().members.map((member) => member.path);
      const memberList = path.join(state.work, "members.nul"); const archive = path.join(state.work, "scanner-closure.tar");
      writeExclusive(memberList, Buffer.from(`${paths.join("\0")}\0`, "ascii"), 0o400);
      const version = publishRun(commandRunner, context, "tar", ["--version"], options()).stdout.split("\n")[0];
      if (version !== "tar (GNU tar) 1.35") fail("scanner_retention_publish_tar_identity_invalid");
      publishRun(commandRunner, context, "tar", scannerRetentionTarInvocation({ archive, stage: state.stage, memberList }), options());
      const bytes = readFileSync(archive); if (bytes.length > SCANNER_RETENTION.closure.tarCapBytes) fail("scanner_retention_publish_tar_invalid");
      state.archive = archive; state.innerTar = { bytes: bytes.length, sha256: sha256(bytes) };
      const scanResult = await scanRawUstar({ input: createReadStream(archive, { flags: constants.O_RDONLY }),
        diffId: `sha256:${state.innerTar.sha256}`, maxRawBytes: SCANNER_RETENTION.closure.tarCapBytes,
        maxMembers: 50, allowHardlinks: false, requireEmptyOwnerNames: true });
      if (scanResult.rawSize !== state.innerTar.bytes || scanResult.members.length !== 50) {
        fail("scanner_retention_publish_tar_invalid");
      }
      for (const [index, member] of validateScannerRetentionClosurePolicy().members.entries()) {
        const entry = scanResult.members[index]?.entry;
        if (entry?.path !== member.path || entry.type !== "file" || entry.mode !== member.headerMode
          || entry.uid !== 0 || entry.gid !== 0 || entry.mtime !== 0
          || (member.bytes !== null && entry.size !== member.bytes) || Object.hasOwn(entry, "linkname")
          || !HEX_SHA256.test(entry.sha256 ?? "")) fail("scanner_retention_publish_tar_invalid");
        const staged = readFileSync(path.join(state.stage, ...member.path.split("/")));
        if (entry.size !== staged.length || entry.sha256 !== sha256(staged)) fail("scanner_retention_publish_tar_invalid");
      }
      state.tag = `${SCANNER_RETENTION.package}:${SCANNER_RETENTION.publisher.tagPrefix}${state.innerTar.sha256}`;
      return { values: { innerTar: state.innerTar, tag: state.tag } };
    }
    if (name === "oci_candidate_push") return publishOciCandidate(state, context, commandRunner, options, log);
    if (name === "owned_local_state_removed") {
      publishRun(commandRunner, context, "docker", ["buildx", "rm", state.builder], options());
      const builderAbsent = observe(commandRunner, "docker", ["buildx", "inspect", state.builder], {
        ...options(), failurePrefix: "scanner_retention_publish" });
      publisherAbsent(builderAbsent, "builder", state.builder);
      state.builder = undefined;
      let current = publishDockerInventory(commandRunner, context, options());
      if (addedInventory(current.containers, state.builderBaseline.containers).length !== 0
        || addedInventory(current.volumes, state.builderBaseline.volumes).length !== 0) {
        fail("scanner_retention_publish_builder_cleanup_invalid");
      }
      for (const id of addedInventory(current.images, state.builderBaseline.images)) {
        const tags = parseJson(Buffer.from(publishRun(commandRunner, context, "docker", ["image", "inspect",
          "--format", "{{json .RepoTags}}", id], options()).stdout, "utf8"));
        if (!Array.isArray(tags) || tags.length < 1
          || tags.some((tag) => typeof tag !== "string" || !tag.startsWith("moby/buildkit:"))) {
          fail("scanner_retention_publish_builder_cleanup_invalid");
        }
        publishRun(commandRunner, context, "docker", ["image", "rm", id], options());
      }
      const after = publishDockerInventory(commandRunner, context, options());
      if (JSON.stringify(after) !== JSON.stringify(state.builderBaseline)) {
        fail("scanner_retention_publish_builder_cleanup_invalid");
      }
      rmSync(path.join(state.work, "oci-context"), { recursive: true, force: false });
      return { values: {} };
    }
    if (name === "authenticated_digest_readback") {
      const before = observe(commandRunner, "docker", ["image", "inspect", state.manifest.config.digest], {
        ...options(state.readDockerConfig), failurePrefix: "scanner_retention_publish" });
      if (!publisherAbsent(before, "image")) fail("scanner_retention_publish_preexisting_image");
      publishRun(commandRunner, context, "docker", ["login", "ghcr.io", "--username", "CleMeY15", "--password-stdin"],
        { ...options(state.readDockerConfig), input: `${context.token}\n` });
      publishRun(commandRunner, context, "docker", ["pull", "--platform", "linux/amd64", state.subject], options(state.readDockerConfig));
      state.pulled = true;
      state.container = `aw-scanner-retention-readback-${context.runId}`;
      const created = publishRun(commandRunner, context, "docker", ["create", "--name", state.container, "--network", "none",
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--pull", "never",
        state.subject, SCANNER_RETENTION.publisher.contextPayloadPath], options(state.readDockerConfig));
      state.containerId = created.stdout.trim();
      if (!CONTAINER_ID.test(state.containerId)) fail("scanner_retention_publish_readback_invalid");
      const image = parseJson(Buffer.from(publishRun(commandRunner, context, "docker", ["image", "inspect",
        state.subject, "--format", "{{json .}}"], options(state.readDockerConfig)).stdout));
      const container = parseJson(Buffer.from(publishRun(commandRunner, context, "docker", ["container", "inspect",
        state.containerId, "--format", "{{json .}}"], options(state.readDockerConfig)).stdout));
      const observed = validateScannerRetentionReadbackState(image, container, { subject: state.subject,
        imageId: state.manifest.config.digest, containerId: state.containerId, containerName: state.container });
      const copied = path.join(state.work, "readback.tar");
      publishRun(commandRunner, context, "docker", ["cp", `${state.container}:${SCANNER_RETENTION.publisher.contextPayloadPath}`, copied],
        options(state.readDockerConfig));
      const bytes = readFileSync(copied); if (bytes.length !== state.innerTar.bytes || sha256(bytes) !== state.innerTar.sha256) {
        fail("scanner_retention_publish_readback_invalid");
      }
      state.ociReadback = { imageId: observed.imageId, containerId: observed.containerId,
        innerTarBytes: bytes.length, innerTarSha256: sha256(bytes), stoppedNeverStarted: observed.stoppedNeverStarted };
      return { values: { oci: { manifest: { mediaType: state.manifest.mediaType,
        bytes: state.manifest.bytes.length, sha256: sha256(state.manifest.bytes) }, config: state.manifest.config,
        layer: state.manifest.layer, readback: state.ociReadback } } };
    }
    if (name === "owned_docker_cleanup") {
      publishRun(commandRunner, context, "docker", ["rm", state.containerId], options(state.readDockerConfig));
      publishRun(commandRunner, context, "docker", ["image", "rm", state.subject], options(state.readDockerConfig));
      const containerAbsent = observe(commandRunner, "docker", ["container", "inspect", state.containerId], {
        ...options(state.readDockerConfig), failurePrefix: "scanner_retention_publish" });
      const imageAbsent = observe(commandRunner, "docker", ["image", "inspect", state.manifest.config.digest], {
        ...options(state.readDockerConfig), failurePrefix: "scanner_retention_publish" });
      if (!publisherAbsent(containerAbsent, "container") || !publisherAbsent(imageAbsent, "image")) {
        fail("scanner_retention_publish_docker_cleanup_invalid");
      }
      if (JSON.stringify(publishDockerInventory(commandRunner, context, options(state.readDockerConfig)))
        !== JSON.stringify(state.builderBaseline)) fail("scanner_retention_publish_docker_cleanup_invalid");
      state.containerId = undefined; state.pulled = false;
      return { values: { cleanup: { state: "PASSED", image: "REMOVED", container: "REMOVED",
        buildCache: "REMOVED", authenticatedDockerConfig: "REMOVED", ownedPathRemoved: false } } };
    }
    if (name === "owned_path_cleanup") {
      const finalValues = { cleanup: { state: "PASSED", image: "REMOVED", container: "REMOVED",
        buildCache: "REMOVED", authenticatedDockerConfig: "REMOVED", ownedPathRemoved: true } };
      removePublishDirectory(state.work, state.workIdentity); state.workIdentity = undefined;
      removePublishDirectory(state.provenanceRoot, state.provenanceIdentity); state.provenanceIdentity = undefined;
      return { values: finalValues };
    }
    fail("scanner_retention_publish_phase_invalid");
  };
  phase.cleanup = async () => {
    const context = state.context;
    if (!context) return;
    const cleanupDeadline = now() + context.publisher.cleanupTimeoutMs;
    const cleanupOptions = (dockerConfig) => ({ cwd: context.workspace,
      env: scannerRetentionPublisherChildEnvironment(context, dockerConfig, state.work),
      timeout: Math.max(1, cleanupDeadline - now()) });
    if (CONTAINER_ID.test(state.containerId ?? "") && state.readDockerConfig && existsSync(state.readDockerConfig)) {
      observe(commandRunner, "docker", ["rm", "--force", state.containerId], {
        ...cleanupOptions(state.readDockerConfig), failurePrefix: "scanner_retention_publish" });
    }
    if (state.pulled && state.subject && state.readDockerConfig && existsSync(state.readDockerConfig)) {
      observe(commandRunner, "docker", ["image", "rm", state.subject], {
        ...cleanupOptions(state.readDockerConfig), failurePrefix: "scanner_retention_publish" });
    }
    if (state.builder && state.dockerConfig && existsSync(state.dockerConfig)) {
      observe(commandRunner, "docker", ["buildx", "rm", state.builder], {
        ...cleanupOptions(state.dockerConfig), failurePrefix: "scanner_retention_publish" });
    }
    if (state.builderAcquired && state.builderBaseline && state.dockerConfig && existsSync(state.dockerConfig)) {
      try {
        let current = publishDockerInventory(commandRunner, context, cleanupOptions(state.dockerConfig));
        for (const id of addedInventory(current.containers, state.builderBaseline.containers)) {
          const inspected = observe(commandRunner, "docker", ["container", "inspect", "--format", "{{.Name}}", id], {
            ...cleanupOptions(state.dockerConfig), failurePrefix: "scanner_retention_publish" });
          if (inspected.error || inspected.status !== 0
            || inspected.stdout.trim() !== `/buildx_buildkit_${state.builder}0`) continue;
          observe(commandRunner, "docker", ["container", "rm", "--force", id], {
            ...cleanupOptions(state.dockerConfig), failurePrefix: "scanner_retention_publish" });
        }
        current = publishDockerInventory(commandRunner, context, cleanupOptions(state.dockerConfig));
        for (const name of addedInventory(current.volumes, state.builderBaseline.volumes)) {
          if (name !== `buildx_buildkit_${state.builder}0_state`) continue;
          observe(commandRunner, "docker", ["volume", "rm", name], {
            ...cleanupOptions(state.dockerConfig), failurePrefix: "scanner_retention_publish" });
        }
        current = publishDockerInventory(commandRunner, context, cleanupOptions(state.dockerConfig));
        for (const id of addedInventory(current.images, state.builderBaseline.images)) {
          const inspected = observe(commandRunner, "docker", ["image", "inspect", "--format", "{{json .RepoTags}}", id], {
            ...cleanupOptions(state.dockerConfig), failurePrefix: "scanner_retention_publish" });
          if (inspected.error || inspected.status !== 0) continue;
          let tags; try { tags = JSON.parse(inspected.stdout); } catch { continue; }
          if (!Array.isArray(tags) || tags.length < 1
            || tags.some((tag) => typeof tag !== "string" || !tag.startsWith("moby/buildkit:"))) continue;
          observe(commandRunner, "docker", ["image", "rm", id], {
            ...cleanupOptions(state.dockerConfig), failurePrefix: "scanner_retention_publish" });
        }
      } catch { /* failed best-effort cleanup remains a failed publication */ }
    }
    if (state.workIdentity) {
      try { removePublishDirectory(state.work, state.workIdentity); } catch { /* failure receipt remains authoritative */ }
    }
    if (state.provenanceIdentity) {
      try { removePublishDirectory(state.provenanceRoot, state.provenanceIdentity); } catch { /* failure receipt remains authoritative */ }
    }
    return { state: "UNKNOWN", image: state.pulled ? "UNKNOWN" : "NOT_ACQUIRED",
      container: state.containerId ? "UNKNOWN" : "NOT_ACQUIRED", buildCache: state.builderAcquired ? "UNKNOWN" : "NOT_ACQUIRED",
      authenticatedDockerConfig: "UNKNOWN", ownedPathRemoved: state.workIdentity ? !existsSync(state.work) : false };
  };
  return phase;
}

export const TEST_ONLY_createScannerRetentionPublisherRunner = createProductionPublisherRunner;

function validateDirectory(directory) {
  if (!existsSync(directory)) fail("scanner_retention_bootstrap_directory_invalid");
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) {
    fail("scanner_retention_bootstrap_directory_invalid");
  }
}

export function validateScannerRetentionBootstrapContext(env, platform = process.platform) {
  const bootstrap = SCANNER_RETENTION.bootstrap;
  const workflowRef = `${SCANNER_RETENTION.repository}/${bootstrap.workflow}@refs/heads/main`;
  if (
    platform !== "linux"
    || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_OS !== "Linux"
    || env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) fail("scanner_retention_bootstrap_requires_github_linux");
  if (
    env.GITHUB_REPOSITORY !== SCANNER_RETENTION.repository
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_WORKFLOW_REF !== workflowRef
  ) fail("scanner_retention_bootstrap_context_invalid");
  if (
    env.GITHUB_JOB !== bootstrap.job
    || env.GITHUB_RUN_NUMBER !== String(bootstrap.firstRunNumber)
    || env.GITHUB_RUN_ATTEMPT !== String(bootstrap.runAttempt)
    || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? "")
    || !REVISION.test(env.GITHUB_SHA ?? "")
    || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA
  ) fail("scanner_retention_bootstrap_identity_invalid");
  if (
    typeof env.GITHUB_TOKEN !== "string"
    || env.GITHUB_TOKEN.length < 1
    || env.GITHUB_TOKEN.length > 8192
    || /[\r\n\0]/u.test(env.GITHUB_TOKEN)
    || typeof env.PATH !== "string"
    || env.PATH.length < 1
    || env.PATH.length > 32768
    || /[\r\n\0]/u.test(env.PATH)
    || !path.isAbsolute(env.RUNNER_TEMP ?? "")
    || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")
  ) fail("scanner_retention_bootstrap_environment_invalid");
  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  const runnerTemp = path.resolve(env.RUNNER_TEMP);
  validateDirectory(workspace);
  validateDirectory(runnerTemp);
  return {
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    sourceSha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN,
    path: env.PATH,
    workspace,
    runnerTemp,
  };
}

function validateOutput(output, context) {
  if (
    path.basename(output) !== SCANNER_RETENTION.bootstrap.outputDirectory
    || path.dirname(output) !== context.runnerTemp
    || existsSync(output)
  ) fail("scanner_retention_bootstrap_output_path_invalid");
}

function childEnvironment(context, dockerConfig, work) {
  return {
    BUILDX_CONFIG: path.join(dockerConfig, "buildx"),
    DOCKER_CONFIG: dockerConfig,
    HOME: path.join(work, "home"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: context.path,
    TMPDIR: path.join(work, "tmp"),
    TZ: "UTC",
    XDG_CONFIG_HOME: path.join(work, "xdg"),
  };
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    input: options.input,
    maxBuffer: SCANNER_RETENTION.bootstrap.commandOutputCapBytes,
    timeout: options.timeout ?? SCANNER_RETENTION.bootstrap.commandTimeoutMs,
    windowsHide: true,
  });
}

export const TEST_ONLY_defaultCommandRunner = defaultCommandRunner;

function observe(commandRunner, command, args, options) {
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > SCANNER_RETENTION.bootstrap.commandOutputCapBytes) {
    fail(`${options.failurePrefix ?? "scanner_retention_bootstrap"}_command_output_exceeded`);
  }
  return { error: result?.error, status: result?.status, stdout, stderr };
}

function run(commandRunner, command, args, options, expectedStatuses = [0]) {
  const result = observe(commandRunner, command, args, options);
  if (result.error || !expectedStatuses.includes(result.status)) {
    fail(`${options.failurePrefix ?? "scanner_retention_bootstrap"}_command_failed`);
  }
  return result;
}

function boundedIdentity(value, reason = "scanner_retention_bootstrap_tool_identity_invalid") {
  const result = value.trim();
  if (result.length < 1 || result.length > 512 || /[^\x20-\x7e]/u.test(result)) {
    fail(reason);
  }
  return result;
}

async function readResponseBytes(response, cap) {
  const contentLength = response?.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined && (!/^\d+$/u.test(contentLength) || Number(contentLength) > cap)) {
    fail("scanner_retention_bootstrap_api_response_invalid");
  }
  if (!response?.body?.getReader) fail("scanner_retention_bootstrap_api_response_invalid");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    const chunk = Buffer.from(item.value);
    bytes += chunk.length;
    if (bytes > cap) {
      await reader.cancel();
      fail("scanner_retention_bootstrap_api_response_invalid");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function requestApi(fetchImpl, url, token, statuses) {
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "auto-world-scanner-retention-bootstrap",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      fail("scanner_retention_bootstrap_api_request_failed");
    }
    if (response?.redirected === true || !statuses.includes(response?.status)) {
      fail("scanner_retention_bootstrap_api_status_ambiguous");
    }
    const bytes = await readResponseBytes(response, SCANNER_RETENTION.bootstrap.commandOutputCapBytes);
    return { status: response.status, bytes };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("scanner_retention_bootstrap_api_response_invalid");
  }
}

async function verifyProtectedMain(fetchImpl, context, localTree) {
  const ref = await requestApi(fetchImpl, MAIN_REF_URL, context.token, [200]);
  const refBody = parseJson(ref.bytes);
  if (refBody?.object?.type !== "commit" || refBody.object.sha !== context.sourceSha) {
    fail("scanner_retention_bootstrap_main_ref_mismatch");
  }
  const commit = await requestApi(fetchImpl, `${MAIN_COMMIT_URL}${context.sourceSha}`, context.token, [200]);
  const commitBody = parseJson(commit.bytes);
  if (commitBody?.sha !== context.sourceSha || !REVISION.test(commitBody?.tree?.sha ?? "") || commitBody.tree.sha !== localTree) {
    fail("scanner_retention_bootstrap_main_tree_mismatch");
  }
}

async function inspectPackageBeforeWrite(fetchImpl, context) {
  const response = await requestApi(fetchImpl, PACKAGE_URL, context.token, [200, 404]);
  if (response.status === 404) {
    return {
      packageLookup: "NOT_FOUND_OPAQUE",
      packageId: null,
      visibility: "NOT_OBSERVED",
      existingVersions: "NOT_VERIFIED",
    };
  }
  const body = parseJson(response.bytes);
  if (
    !Number.isSafeInteger(body?.id)
    || body.id < 1
    || body.name !== PACKAGE_NAME
    || body.package_type !== "container"
    || body.visibility !== "private"
    || body.url !== PACKAGE_URL
    || body.owner?.login !== PACKAGE_OWNER
    || body.repository?.full_name !== SCANNER_RETENTION.repository
  ) fail("scanner_retention_bootstrap_package_identity_invalid");
  const versions = await requestApi(fetchImpl, PACKAGE_VERSIONS_URL, context.token, [200]);
  const versionBody = parseJson(versions.bytes);
  if (!Array.isArray(versionBody) || versionBody.length !== 0) {
    fail("scanner_retention_bootstrap_existing_versions_ambiguous");
  }
  return {
    packageLookup: "EXACT_PRIVATE_PACKAGE_WITHOUT_VERSIONS",
    packageId: body.id,
    visibility: "Private",
    existingVersions: 0,
  };
}

function descriptor(value, allowedMediaTypes) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || !allowedMediaTypes.has(value.mediaType)
    || !DIGEST.test(value.digest ?? "")
    || !Number.isSafeInteger(value.size)
    || value.size < 1
    || value.size > SCANNER_RETENTION.bootstrap.registryCapBytes
  ) fail("scanner_retention_bootstrap_remote_manifest_invalid");
  return value;
}

function parseManifest(raw, allowedMediaTypes) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("scanner_retention_bootstrap_remote_manifest_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 2 || !allowedMediaTypes.has(value.mediaType)) {
    fail("scanner_retention_bootstrap_remote_manifest_invalid");
  }
  return value;
}

function validateImageManifest(raw) {
  const manifest = parseManifest(raw, MANIFEST_MEDIA_TYPES);
  const config = descriptor(manifest.config, CONFIG_MEDIA_TYPES);
  if (!Array.isArray(manifest.layers) || manifest.layers.length !== 1) {
    fail("scanner_retention_bootstrap_remote_manifest_invalid");
  }
  const layer = descriptor(manifest.layers[0], LAYER_MEDIA_TYPES);
  if (config.size + layer.size + Buffer.byteLength(raw) > SCANNER_RETENTION.bootstrap.registryCapBytes) {
    fail("scanner_retention_bootstrap_registry_budget_exceeded");
  }
  return { configBytes: config.size, layerBytes: layer.size };
}

function inspectAbsent(result) {
  if (result.status === 1 && /no such (?:image|object)/iu.test(`${result.stdout}\n${result.stderr}`)) return true;
  if (result.status === 0) return false;
  fail("scanner_retention_bootstrap_local_inspect_failed");
}

function writeReceipt(output, receipt) {
  const bytes = canonicalJsonBytes(receipt, SCANNER_RETENTION.bootstrap.receiptCapBytes);
  writeFileSync(path.join(output, "receipt.json"), bytes, { flag: "wx", mode: 0o600 });
}

function initialReceipt(context, tag) {
  const bootstrap = SCANNER_RETENTION.bootstrap;
  return {
    schemaVersion: 1,
    state: "PREPARING",
    result: "FAILED",
    repository: context.repository,
    workflow: bootstrap.workflow,
    runId: context.runId,
    runAttempt: Number(context.runAttempt),
    headSha: context.sourceSha,
    headTree: null,
    package: SCANNER_RETENTION.package,
    tag,
    subject: null,
    payload: { path: `/${bootstrap.payload.name}`, bytes: bootstrap.payload.bytes, sha256: bootstrap.payload.sha256 },
    recipe: {
      path: bootstrap.recipe.name,
      bytes: bootstrap.recipe.bytes,
      sha256: bootstrap.recipe.sha256,
      base: "scratch",
      network: "none",
      provenance: false,
      sbom: false,
    },
    access: {
      packageLookup: "NOT_ATTEMPTED",
      packageId: null,
      visibility: "NOT_OBSERVED",
      existingVersions: "NOT_VERIFIED",
      write: "NOT_ATTEMPTED",
      manifestDigest: null,
      manifestBytes: null,
      childManifestDigest: null,
      childManifestBytes: null,
      configBytes: null,
      layerBytes: null,
      capacity: {
        projectedPeakBytes: bootstrap.projectedPeakBytes,
        requiredFreeBytes: bootstrap.requiredFreeBytes,
        observedFreeBytes: null,
      },
      tools: { docker: null, buildx: null, buildKitBackendVersions: null },
    },
    phases: [],
    cleanup: { state: "PENDING", ownedPathRemoved: false, ownedLocalImage: "NOT_OBSERVED" },
    claims: {
      forkAccessTest: "SKIPPED_BY_USER",
      forkIsolation: "NOT_VERIFIED",
      scannerExecuted: false,
      retained: false,
      restored: false,
      admitted: false,
      supportStart: null,
      supportEnd: null,
    },
  };
}

async function executeBootstrap({
  argv,
  commandRunner,
  env,
  fetchImpl,
  now,
  platform,
  statfs,
  removeOwnedPath,
}) {
  const started = now();
  const parsed = parseScannerRetentionArguments(argv);
  const context = validateScannerRetentionBootstrapContext(env, platform);
  validateOutput(parsed.output, context);
  const work = path.join(context.runnerTemp, `aw-scanner-retention-bootstrap-${context.runId}-attempt-${context.runAttempt}`);
  if (existsSync(work)) fail("scanner_retention_bootstrap_owned_path_exists");
  mkdirSync(parsed.output, { mode: 0o700 });
  mkdirSync(work, { mode: 0o700 });
  const dockerConfig = path.join(work, "docker-config");
  const buildContext = path.join(work, "context");
  for (const directory of [dockerConfig, path.join(dockerConfig, "buildx"), buildContext, path.join(work, "home"), path.join(work, "tmp"), path.join(work, "xdg")]) {
    mkdirSync(directory, { mode: 0o700 });
  }
  const tag = `${SCANNER_RETENTION.package}:bootstrap-v1-run-${context.runId}`;
  const receipt = initialReceipt(context, tag);
  const options = { cwd: work, env: childEnvironment(context, dockerConfig, work) };
  const gitOptions = { ...options, cwd: context.workspace };
  const phase = async (name, operation) => {
    if (now() - started > SCANNER_RETENTION.bootstrap.timeoutMs) fail("scanner_retention_bootstrap_job_timeout");
    const phaseStarted = now();
    try {
      const result = await operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted });
      return result;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: fixedReason(error), durationMs: now() - phaseStarted });
      throw error;
    }
  };
  let primaryFailure;
  let writeStarted = false;
  try {
    await phase("runner_capacity", () => {
      const capacity = statfs(context.runnerTemp, { bigint: true });
      if (typeof capacity?.bavail !== "bigint" || typeof capacity?.bsize !== "bigint") {
        fail("scanner_retention_bootstrap_capacity_invalid");
      }
      const free = capacity.bavail * capacity.bsize;
      if (free > BigInt(Number.MAX_SAFE_INTEGER)) fail("scanner_retention_bootstrap_capacity_invalid");
      receipt.access.capacity.observedFreeBytes = Number(free);
      if (free < BigInt(SCANNER_RETENTION.bootstrap.requiredFreeBytes)) fail("scanner_retention_bootstrap_capacity_insufficient");
    });
    await phase("checkout_identity", () => {
      const head = run(commandRunner, "git", ["rev-parse", "HEAD"], gitOptions).stdout.trim();
      const tree = run(commandRunner, "git", ["rev-parse", "HEAD^{tree}"], gitOptions).stdout.trim();
      const status = run(commandRunner, "git", ["status", "--porcelain=v1", "--untracked-files=all"], gitOptions).stdout;
      if (head !== context.sourceSha || !REVISION.test(tree) || status !== "") {
        fail("scanner_retention_bootstrap_checkout_identity_invalid");
      }
      receipt.headTree = tree;
    });
    await phase("protected_main_identity", () => verifyProtectedMain(fetchImpl, context, receipt.headTree));
    await phase("direct_package_prewrite_lookup", async () => {
      Object.assign(receipt.access, await inspectPackageBeforeWrite(fetchImpl, context));
    });
    await phase("managed_tool_identity", () => {
      receipt.access.tools.docker = boundedIdentity(run(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], options).stdout);
      receipt.access.tools.buildx = boundedIdentity(run(commandRunner, "docker", ["buildx", "version"], options).stdout);
      receipt.access.tools.buildKitBackendVersions = parseBuildKitVersions(run(commandRunner, "docker", ["buildx", "inspect"], options).stdout);
    });
    await phase("local_collision_check", () => {
      if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", tag], options))) {
        fail("scanner_retention_bootstrap_local_collision");
      }
    });
    await phase("fixed_scratch_materialization", () => {
      const bootstrap = SCANNER_RETENTION.bootstrap;
      const payloadPath = path.join(buildContext, bootstrap.payload.name);
      const recipePath = path.join(buildContext, bootstrap.recipe.name);
      writeFileSync(payloadPath, bootstrap.payload.text, { flag: "wx", mode: 0o600 });
      writeFileSync(recipePath, bootstrap.recipe.text, { flag: "wx", mode: 0o600 });
      const expected = [[bootstrap.payload.name, bootstrap.payload], [bootstrap.recipe.name, bootstrap.recipe]];
      if (readdirSync(buildContext).sort().join("\n") !== expected.map(([name]) => name).sort().join("\n")) {
        fail("scanner_retention_bootstrap_context_invalid");
      }
      let total = 0;
      for (const [name, material] of expected) {
        const file = path.join(buildContext, name);
        const info = lstatSync(file);
        const bytes = readFileSync(file);
        if (!info.isFile() || info.isSymbolicLink() || bytes.length !== material.bytes || sha256(bytes) !== material.sha256) {
          fail("scanner_retention_bootstrap_material_invalid");
        }
        total += bytes.length;
      }
      if (total !== bootstrap.payload.bytes + bootstrap.recipe.bytes || total > bootstrap.contextCapBytes) {
        fail("scanner_retention_bootstrap_context_budget_exceeded");
      }
    });
    await phase("registry_login", () => {
      run(commandRunner, "docker", ["login", "ghcr.io", "--username", PACKAGE_OWNER, "--password-stdin"], {
        ...options,
        input: `${context.token}\n`,
      });
    });
    const metadataPath = path.join(work, "metadata.json");
    const manifestDigest = await phase("harmless_first_write", () => {
      receipt.state = "WRITE_STARTED_OUTCOME_UNCONFIRMED";
      receipt.access.write = "ATTEMPTED_OUTCOME_UNCONFIRMED";
      writeStarted = true;
      run(commandRunner, "docker", [
        "buildx", "build",
        "--platform", SCANNER_RETENTION.bootstrap.platform,
        "--network=none",
        "--provenance=false",
        "--sbom=false",
        "--push",
        "--metadata-file", metadataPath,
        "--tag", tag,
        "--file", path.join(buildContext, SCANNER_RETENTION.bootstrap.recipe.name),
        buildContext,
      ], options);
      if (!existsSync(metadataPath)) fail("scanner_retention_bootstrap_metadata_invalid");
      const info = lstatSync(metadataPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > SCANNER_RETENTION.bootstrap.commandOutputCapBytes) {
        fail("scanner_retention_bootstrap_metadata_invalid");
      }
      let metadata;
      try {
        metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      } catch {
        fail("scanner_retention_bootstrap_metadata_invalid");
      }
      try {
        return parsePublishedDigest(metadata);
      } catch {
        fail("scanner_retention_bootstrap_metadata_invalid");
      }
    });
    receipt.subject = `${SCANNER_RETENTION.package}@${manifestDigest}`;
    receipt.access.manifestDigest = manifestDigest;
    receipt.access.write = "PUBLISHED_UNADMITTED";
    receipt.state = "PUBLISHED_UNADMITTED";
    await phase("authenticated_digest_readback", () => {
      const raw = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", receipt.subject], options).stdout;
      let top;
      try {
        top = validateRemoteManifest(raw, manifestDigest);
      } catch {
        fail("scanner_retention_bootstrap_remote_manifest_invalid");
      }
      receipt.access.manifestBytes = top.size;
      const topValue = parseManifest(raw, new Set([...INDEX_MEDIA_TYPES, ...MANIFEST_MEDIA_TYPES]));
      let imageRaw = raw;
      if (INDEX_MEDIA_TYPES.has(topValue.mediaType)) {
        if (!Array.isArray(topValue.manifests) || topValue.manifests.length !== 1) {
          fail("scanner_retention_bootstrap_remote_manifest_invalid");
        }
        const item = descriptor(topValue.manifests[0], MANIFEST_MEDIA_TYPES);
        if (item.platform?.os !== "linux" || item.platform?.architecture !== "amd64") {
          fail("scanner_retention_bootstrap_remote_manifest_invalid");
        }
        receipt.access.childManifestDigest = item.digest;
        const childSubject = `${SCANNER_RETENTION.package}@${item.digest}`;
        imageRaw = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", childSubject], options).stdout;
        let child;
        try {
          child = validateRemoteManifest(imageRaw, item.digest);
        } catch {
          fail("scanner_retention_bootstrap_remote_manifest_invalid");
        }
        if (child.size !== item.size) fail("scanner_retention_bootstrap_remote_manifest_invalid");
        receipt.access.childManifestBytes = child.size;
      }
      const image = validateImageManifest(imageRaw);
      receipt.access.configBytes = image.configBytes;
      receipt.access.layerBytes = image.layerBytes;
      if (
        receipt.access.manifestBytes
          + (receipt.access.childManifestBytes ?? 0)
          + image.configBytes
          + image.layerBytes
        > SCANNER_RETENTION.bootstrap.registryCapBytes
      ) fail("scanner_retention_bootstrap_registry_budget_exceeded");
    });
    await phase("no_local_image_retained", () => {
      const local = observe(commandRunner, "docker", ["image", "inspect", tag], options);
      if (inspectAbsent(local)) {
        receipt.cleanup.ownedLocalImage = "ABSENT";
      } else {
        run(commandRunner, "docker", ["image", "rm", "--force", tag], options);
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", tag], options))) {
          fail("scanner_retention_bootstrap_cleanup_local_image_failed");
        }
        receipt.cleanup.ownedLocalImage = "REMOVED";
      }
    });
    receipt.result = "PASSED";
  } catch (error) {
    primaryFailure = error;
  }

  const cleanupStarted = now();
  let localCleanupFailure;
  if (writeStarted) {
    try {
      if (receipt.cleanup.ownedLocalImage === "NOT_OBSERVED") {
        const local = observe(commandRunner, "docker", ["image", "inspect", tag], options);
        if (inspectAbsent(local)) {
          receipt.cleanup.ownedLocalImage = "ABSENT";
        } else {
          run(commandRunner, "docker", ["image", "rm", "--force", tag], options);
          if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", tag], options))) {
            fail("scanner_retention_bootstrap_cleanup_local_image_failed");
          }
          receipt.cleanup.ownedLocalImage = "REMOVED";
        }
      }
    } catch (error) {
      localCleanupFailure = error;
    }
  } else receipt.cleanup.ownedLocalImage = "NOT_CREATED";
  let pathCleanupFailure;
  try {
    if (
      !existsSync(work)
      || lstatSync(work).isSymbolicLink()
      || realpathSync(work) !== work
      || path.dirname(work) !== context.runnerTemp
    ) fail("scanner_retention_bootstrap_cleanup_path_invalid");
    removeOwnedPath(work);
    if (existsSync(work)) fail("scanner_retention_bootstrap_cleanup_path_invalid");
    receipt.cleanup.ownedPathRemoved = true;
  } catch (error) {
    pathCleanupFailure = error;
  }
  const cleanupFailure = localCleanupFailure ?? pathCleanupFailure;
  receipt.cleanup.state = cleanupFailure ? "FAILED" : "PASSED";
  receipt.phases.push({
    name: "owned_cleanup",
    result: cleanupFailure ? "FAILED" : "PASSED",
    ...(cleanupFailure ? { reason: fixedReason(cleanupFailure) } : {}),
    durationMs: now() - cleanupStarted,
  });
  if (cleanupFailure) receipt.result = "FAILED";
  writeReceipt(parsed.output, receipt);
  if (primaryFailure) fail(fixedReason(primaryFailure));
  if (cleanupFailure) fail(fixedReason(cleanupFailure));
  return receipt;
}

export async function TEST_ONLY_runScannerRetentionBootstrap(options = {}) {
  return executeBootstrap({
    argv: options.argv ?? ["bootstrap", "--output", options.output],
    commandRunner: options.commandRunner ?? defaultCommandRunner,
    env: options.env ?? process.env,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    now: options.now ?? Date.now,
    platform: options.platform ?? process.platform,
    statfs: options.statfs ?? statfsSync,
    removeOwnedPath: options.removeOwnedPath ?? ((target) => rmSync(target, { recursive: true, force: false })),
  });
}

function readFail(code) {
  fail(`scanner_retention_read_proof_${code}`);
}

function exactKeys(value, keys, code) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)
  ) readFail(code);
}

export function validateScannerRetentionReadProofBinding(readProof = SCANNER_RETENTION.readProof) {
  exactKeys(readProof, [
    "workflow", "job", "platform", "outputDirectory", "firstRunNumber", "runAttempt", "payloadPath",
    "registryCapBytes", "receiptCapBytes", "operationTimeoutMs", "cleanupTimeoutMs", "receiptReserveMs",
    "commandTimeoutMs", "commandOutputCapBytes",
    "bootstrap", "bootstrapOutcome", "packageSettings",
  ], "binding_invalid");
  const bootstrap = readProof.bootstrap;
  const bootstrapOutcome = readProof.bootstrapOutcome;
  const packageSettings = readProof.packageSettings;
  exactKeys(bootstrap, [
    "runId", "runAttempt", "headSha", "headTree", "artifactId", "artifactName", "artifactDigest",
    "receiptBytes", "receiptSha256", "tag", "subject", "manifestDigest", "manifestBytes",
    "childManifestDigest", "childManifestBytes", "configBytes", "layerBytes",
  ], "binding_invalid");
  exactKeys(packageSettings, [
    "packageId", "visibility", "repository", "inheritance", "actionsGrant", "proofSha256",
  ], "binding_invalid");
  exactKeys(bootstrapOutcome, [
    "runConclusion", "receiptResult", "publication", "authenticatedReadback", "cleanup", "failedPhase",
  ], "binding_invalid");
  const requiredBootstrap = [
    "runId", "runAttempt", "headSha", "headTree", "artifactId", "artifactName", "artifactDigest",
    "receiptBytes", "receiptSha256", "tag", "subject", "manifestDigest", "manifestBytes", "configBytes", "layerBytes",
  ];
  if (requiredBootstrap.some((key) => bootstrap[key] === null)
    || Object.values(packageSettings).some((value) => value === null)) readFail("binding_unbound");
  const hasChild = bootstrap.childManifestDigest !== null || bootstrap.childManifestBytes !== null;
  if (hasChild && (bootstrap.childManifestDigest === null || bootstrap.childManifestBytes === null)) {
    readFail("binding_invalid");
  }
  if (
    readProof.workflow !== ".github/workflows/scanner-retention-package-read.yml"
    || readProof.job !== "read-proof"
    || readProof.platform !== "linux/amd64"
    || readProof.outputDirectory !== "scanner-retention-read-proof"
    || readProof.firstRunNumber !== 1
    || readProof.runAttempt !== 1
    || readProof.payloadPath !== "/bootstrap.txt"
    || readProof.registryCapBytes !== SCANNER_RETENTION.bootstrap.registryCapBytes
    || readProof.receiptCapBytes !== SCANNER_RETENTION.bootstrap.receiptCapBytes
    || readProof.operationTimeoutMs !== 240_000
    || readProof.cleanupTimeoutMs !== 60_000
    || readProof.receiptReserveMs !== 10_000
    || readProof.commandTimeoutMs !== SCANNER_RETENTION.bootstrap.commandTimeoutMs
    || readProof.commandOutputCapBytes !== SCANNER_RETENTION.bootstrap.commandOutputCapBytes
    || bootstrapOutcome.runConclusion !== "failure"
    || bootstrapOutcome.receiptResult !== "FAILED"
    || bootstrapOutcome.publication !== "PUBLISHED_UNADMITTED"
    || bootstrapOutcome.authenticatedReadback !== "PASSED"
    || bootstrapOutcome.cleanup !== "PASSED"
    || bootstrapOutcome.failedPhase !== "no_local_image_retained"
  ) readFail("binding_invalid");
  if (
    !/^\d+$/u.test(String(bootstrap.runId))
    || bootstrap.runAttempt !== 1
    || !REVISION.test(bootstrap.headSha)
    || !REVISION.test(bootstrap.headTree)
    || !Number.isSafeInteger(bootstrap.artifactId)
    || bootstrap.artifactId < 1
    || bootstrap.artifactName !== `scanner-retention-bootstrap-${bootstrap.runId}-${bootstrap.runAttempt}`
    || !DIGEST.test(bootstrap.artifactDigest)
    || !Number.isSafeInteger(bootstrap.receiptBytes)
    || bootstrap.receiptBytes < 1
    || bootstrap.receiptBytes > readProof.receiptCapBytes
    || !HEX_SHA256.test(bootstrap.receiptSha256)
    || bootstrap.tag !== `${SCANNER_RETENTION.package}:bootstrap-v1-run-${bootstrap.runId}`
    || !DIGEST.test(bootstrap.manifestDigest)
    || bootstrap.subject !== `${SCANNER_RETENTION.package}@${bootstrap.manifestDigest}`
    || !Number.isSafeInteger(bootstrap.manifestBytes)
    || bootstrap.manifestBytes < 1
    || bootstrap.manifestBytes > readProof.registryCapBytes
    || (hasChild && !DIGEST.test(bootstrap.childManifestDigest))
    || (hasChild && (!Number.isSafeInteger(bootstrap.childManifestBytes) || bootstrap.childManifestBytes < 1))
    || !Number.isSafeInteger(bootstrap.configBytes)
    || bootstrap.configBytes < 1
    || !Number.isSafeInteger(bootstrap.layerBytes)
    || bootstrap.layerBytes < 1
    || bootstrap.manifestBytes + (bootstrap.childManifestBytes ?? 0) + bootstrap.configBytes + bootstrap.layerBytes
      > readProof.registryCapBytes
  ) readFail("binding_invalid");
  if (
    !Number.isSafeInteger(packageSettings.packageId)
    || packageSettings.packageId < 1
    || packageSettings.visibility !== "Private"
    || packageSettings.repository !== SCANNER_RETENTION.repository
    || typeof packageSettings.inheritance !== "boolean"
    || !["READ", "WRITE", "ADMIN"].includes(packageSettings.actionsGrant)
    || !HEX_SHA256.test(packageSettings.proofSha256)
  ) readFail("binding_invalid");
  return readProof;
}

function validateReadProofContext(env, readProof, platform = process.platform) {
  const workflowRef = `${SCANNER_RETENTION.repository}/${readProof.workflow}@refs/heads/main`;
  if (
    platform !== "linux"
    || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_OS !== "Linux"
    || env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) readFail("requires_github_linux");
  if (
    env.GITHUB_REPOSITORY !== SCANNER_RETENTION.repository
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_WORKFLOW_REF !== workflowRef
  ) readFail("context_invalid");
  if (
    env.GITHUB_JOB !== readProof.job
    || env.GITHUB_RUN_NUMBER !== String(readProof.firstRunNumber)
    || env.GITHUB_RUN_ATTEMPT !== String(readProof.runAttempt)
    || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? "")
    || !REVISION.test(env.GITHUB_SHA ?? "")
    || env.GITHUB_WORKFLOW_SHA !== env.GITHUB_SHA
  ) readFail("identity_invalid");
  if (
    typeof env.GITHUB_TOKEN !== "string"
    || env.GITHUB_TOKEN.length < 1
    || env.GITHUB_TOKEN.length > 8192
    || /[\r\n\0]/u.test(env.GITHUB_TOKEN)
    || typeof env.PATH !== "string"
    || env.PATH.length < 1
    || env.PATH.length > 32768
    || /[\r\n\0]/u.test(env.PATH)
    || !path.isAbsolute(env.RUNNER_TEMP ?? "")
    || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")
  ) readFail("environment_invalid");
  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  const runnerTemp = path.resolve(env.RUNNER_TEMP);
  directoryIdentity(workspace, "workspace_invalid");
  directoryIdentity(runnerTemp, "runner_temp_invalid");
  return {
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    sourceSha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN,
    path: env.PATH,
    workspace,
    runnerTemp,
  };
}

function directoryIdentity(directory, code) {
  if (!existsSync(directory)) readFail(code);
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) readFail(code);
  return { dev: info.dev, ino: info.ino };
}

function requireDirectoryIdentity(directory, expected, code) {
  const actual = directoryIdentity(directory, code);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) readFail(code);
}

function validateReadOutput(output, context, readProof) {
  if (
    path.basename(output) !== readProof.outputDirectory
    || path.dirname(output) !== context.runnerTemp
    || existsSync(output)
  ) readFail("output_path_invalid");
}

function readChildEnvironment(context, dockerConfig, scopeRoot) {
  return {
    BUILDX_CONFIG: path.join(dockerConfig, "buildx"),
    DOCKER_CONFIG: dockerConfig,
    HOME: path.join(scopeRoot, "home"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: context.path,
    TMPDIR: path.join(scopeRoot, "tmp"),
    TZ: "UTC",
    XDG_CONFIG_HOME: path.join(scopeRoot, "xdg"),
  };
}

function inventory(commandRunner, type, options) {
  const args = type === "image"
    ? ["image", "ls", "--no-trunc", "--quiet"]
    : ["container", "ls", "--all", "--no-trunc", "--quiet"];
  const pattern = type === "image" ? /^sha256:[a-f0-9]{64}$/u : CONTAINER_ID;
  const lines = run(commandRunner, "docker", args, options).stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.some((line) => !pattern.test(line))) readFail("local_inventory_invalid");
  return [...new Set(lines)].sort();
}

function sameInventory(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactReadAbsent(result, type) {
  if (result.error || result.signal) readFail("local_inspect_failed");
  if (result.status === 0) return false;
  const pattern = type === "image" ? /no such (?:image|object)/iu : /no such container/iu;
  if (result.status === 1 && pattern.test(`${result.stdout}\n${result.stderr}`)) return true;
  readFail("local_inspect_failed");
}

function validateReadRemoteManifest(raw, digest) {
  try { return validateRemoteManifest(raw, digest); } catch { readFail("remote_manifest_invalid"); }
}

function parseReadManifest(raw, mediaTypes) {
  try { return parseManifest(raw, mediaTypes); } catch { readFail("remote_manifest_invalid"); }
}

function readDescriptor(value, mediaTypes) {
  try { return descriptor(value, mediaTypes); } catch { readFail("remote_manifest_invalid"); }
}

function readImageManifest(raw, binding) {
  const manifest = parseReadManifest(raw, MANIFEST_MEDIA_TYPES);
  const config = readDescriptor(manifest.config, CONFIG_MEDIA_TYPES);
  if (!Array.isArray(manifest.layers) || manifest.layers.length !== 1) readFail("remote_manifest_invalid");
  const layer = readDescriptor(manifest.layers[0], LAYER_MEDIA_TYPES);
  if (config.size !== binding.configBytes || layer.size !== binding.layerBytes) readFail("remote_manifest_invalid");
  return { config, layer };
}

function validateAnonymousRead(result) {
  if (result.error || result.signal) readFail("anonymous_remote_read_error");
  try { return classifyAnonymousRemoteRead(result); } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.endsWith("anonymous_remote_read_succeeded")) readFail("anonymous_remote_read_succeeded");
    readFail("anonymous_remote_read_error");
  }
}

function expectedReadLabels(ownerLabel) {
  return {
    "org.auto-world.scanner-retention-read-owner": ownerLabel,
    "org.opencontainers.image.description": "Harmless scanner closure package bootstrap; not runtime",
    "org.opencontainers.image.source": "https://github.com/CleMeY15/auto-world",
  };
}

function exactLabels(labels, expected) {
  return labels !== null
    && typeof labels === "object"
    && !Array.isArray(labels)
    && JSON.stringify(Object.keys(labels).sort()) === JSON.stringify(Object.keys(expected).sort())
    && Object.entries(expected).every(([name, value]) => labels[name] === value);
}

function validateReadImage(raw, subject, manifest) {
  let image;
  try { image = JSON.parse(raw); } catch { readFail("image_invalid"); }
  if (
    image?.Id !== manifest.config.digest
    || image?.Os !== "linux"
    || image?.Architecture !== "amd64"
    || !Number.isSafeInteger(image?.Size)
    || image.Size < 1
    || image.Size > SCANNER_RETENTION.readProof.registryCapBytes
    || !Array.isArray(image?.RepoTags)
    || image.RepoTags.length !== 0
    || !Array.isArray(image?.RepoDigests)
    || image.RepoDigests.length !== 1
    || image.RepoDigests[0] !== subject
    || !exactLabels(image?.Config?.Labels, {
      "org.opencontainers.image.description": "Harmless scanner closure package bootstrap; not runtime",
      "org.opencontainers.image.source": "https://github.com/CleMeY15/auto-world",
    })
  ) readFail("image_invalid");
  return { id: image.Id, size: image.Size, subject };
}

function validateReadContainer(raw, expected) {
  let container;
  try { container = JSON.parse(raw); } catch { readFail("container_invalid"); }
  if (
    !CONTAINER_ID.test(container?.Id ?? "")
    || (expected.id && container.Id !== expected.id)
    || container?.Name !== `/${expected.name}`
    || container?.Image !== expected.imageId
    || container?.Config?.Image !== expected.subject
    || JSON.stringify(container?.Config?.Cmd) !== JSON.stringify([SCANNER_RETENTION.readProof.payloadPath])
    || !exactLabels(container?.Config?.Labels, expectedReadLabels(expected.ownerLabel))
    || container?.State?.Running !== false
    || container?.State?.Status !== "created"
    || container?.HostConfig?.NetworkMode !== "none"
    || container?.HostConfig?.ReadonlyRootfs !== true
    || JSON.stringify(container?.HostConfig?.CapDrop ?? []) !== JSON.stringify(["ALL"])
    || JSON.stringify(container?.HostConfig?.SecurityOpt ?? []) !== JSON.stringify(["no-new-privileges=true"])
    || !Array.isArray(container?.Mounts)
    || container.Mounts.length !== 0
  ) readFail("container_invalid");
  return { id: container.Id, name: expected.name };
}

function validateReadPayload(filename) {
  const info = lstatSync(filename);
  const expected = SCANNER_RETENTION.bootstrap.payload;
  if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes) readFail("payload_invalid");
  const bytes = readFileSync(filename);
  if (sha256(bytes) !== expected.sha256 || !bytes.equals(Buffer.from(expected.text))) readFail("payload_invalid");
  return { path: SCANNER_RETENTION.readProof.payloadPath, bytes: bytes.length, sha256: sha256(bytes) };
}

async function verifyReadProtectedMain(fetchImpl, context, localTree) {
  try { await verifyProtectedMain(fetchImpl, context, localTree); } catch { readFail("protected_main_invalid"); }
}

function initialReadReceipt(context, readProof) {
  const binding = readProof.bootstrap;
  return {
    schemaVersion: 1,
    state: "VERIFYING_PRIVATE_READ",
    result: "FAILED",
    repository: context.repository,
    workflow: readProof.workflow,
    runId: context.runId,
    runAttempt: Number(context.runAttempt),
    headSha: context.sourceSha,
    headTree: null,
    package: SCANNER_RETENTION.package,
    tag: binding.tag,
    subject: binding.subject,
    payload: { path: readProof.payloadPath, bytes: SCANNER_RETENTION.bootstrap.payload.bytes, sha256: SCANNER_RETENTION.bootstrap.payload.sha256 },
    recipe: { bytes: SCANNER_RETENTION.bootstrap.recipe.bytes, sha256: SCANNER_RETENTION.bootstrap.recipe.sha256, base: "scratch" },
    access: {
      bootstrap: { ...binding },
      bootstrapOutcome: { ...readProof.bootstrapOutcome },
      packageSettings: { ...readProof.packageSettings },
      authorizedManifestBefore: null,
      anonymousRead: "NOT_ATTEMPTED",
      authorizedManifestAfter: null,
      image: null,
      container: null,
      copiedPayload: null,
      localInventoryBefore: null,
      localInventoryAfter: null,
      tools: { docker: null, buildx: null },
    },
    phases: [],
    cleanup: { state: "PENDING", container: "NOT_CREATED", image: "NOT_PULLED", ownedPathRemoved: false },
    claims: {
      forkAccessTest: "SKIPPED_BY_USER",
      forkIsolation: "NOT_VERIFIED",
      scannerExecuted: false,
      retained: false,
      restored: false,
      admitted: false,
      supportStart: null,
      supportEnd: null,
    },
  };
}

async function executeReadProof({
  argv,
  binding,
  commandRunner,
  env,
  fetchImpl,
  now,
  platform,
  removeOwnedPath,
}) {
  const started = now();
  const parsed = parseScannerRetentionArguments(argv);
  if (parsed.mode !== "read-proof") readFail("mode_invalid");
  const readProof = validateScannerRetentionReadProofBinding(binding);
  const context = validateReadProofContext(env, readProof, platform);
  validateReadOutput(parsed.output, context, readProof);
  const runnerTempIdentity = directoryIdentity(context.runnerTemp, "runner_temp_invalid");
  const work = path.join(context.runnerTemp, `aw-scanner-retention-read-${context.runId}-attempt-${context.runAttempt}`);
  if (existsSync(work)) readFail("owned_path_exists");
  mkdirSync(parsed.output, { mode: 0o700 });
  const outputIdentity = directoryIdentity(parsed.output, "output_path_invalid");
  mkdirSync(work, { mode: 0o700 });
  const workIdentity = directoryIdentity(work, "owned_path_invalid");
  const authRoot = path.join(work, "authenticated");
  const anonymousRoot = path.join(work, "anonymous");
  const authConfig = path.join(authRoot, "docker");
  const anonymousConfig = path.join(anonymousRoot, "docker");
  for (const root of [authRoot, anonymousRoot]) {
    for (const directory of [root, path.join(root, "docker"), path.join(root, "docker", "buildx"), path.join(root, "home"), path.join(root, "tmp"), path.join(root, "xdg")]) {
      if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
    }
  }
  if (process.platform === "linux" && [authConfig, anonymousConfig].some(
    (directory) => (lstatSync(directory).mode & 0o777) !== 0o700,
  )) readFail("docker_config_mode_invalid");
  const operationDeadline = started + readProof.operationTimeoutMs;
  const cleanupDeadline = operationDeadline + readProof.cleanupTimeoutMs;
  const receiptDeadline = cleanupDeadline + readProof.receiptReserveMs;
  const commandOptions = (dockerConfig, scopeRoot, cleanup = false) => {
    requireDirectoryIdentity(context.runnerTemp, runnerTempIdentity, "owned_path_replaced");
    requireDirectoryIdentity(work, workIdentity, "owned_path_replaced");
    const remaining = (cleanup ? cleanupDeadline : operationDeadline) - now();
    if (!Number.isFinite(remaining) || remaining < 1_000) readFail(cleanup ? "cleanup_timeout" : "job_timeout");
    return {
      cwd: work,
      env: readChildEnvironment(context, dockerConfig, scopeRoot),
      failurePrefix: "scanner_retention_read_proof",
      timeout: Math.floor(Math.min(readProof.commandTimeoutMs, remaining)),
    };
  };
  const authOptions = (cleanup = false) => commandOptions(authConfig, authRoot, cleanup);
  const anonymousOptions = () => commandOptions(anonymousConfig, anonymousRoot, false);
  const receipt = initialReadReceipt(context, readProof);
  const phase = async (name, operation) => {
    const phaseStarted = now();
    try {
      const result = await operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: Math.max(0, now() - phaseStarted) });
      return result;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: fixedReadReason(error), durationMs: Math.max(0, now() - phaseStarted) });
      throw error;
    }
  };
  const containerName = `aw-scanner-retention-read-${context.runId}`;
  const ownerLabel = `${context.sourceSha}:${context.runId}:${context.runAttempt}`;
  let baselineImages;
  let baselineContainers;
  let manifest;
  let image;
  let container;
  let pullAttempted = false;
  let createAttempted = false;
  let returnedContainerId;
  let primaryFailure;
  try {
    await phase("checkout_identity", () => {
      const options = { ...authOptions(), cwd: context.workspace };
      const head = run(commandRunner, "git", ["rev-parse", "HEAD"], options).stdout.trim();
      const tree = run(commandRunner, "git", ["rev-parse", "HEAD^{tree}"], options).stdout.trim();
      const status = run(commandRunner, "git", ["status", "--porcelain=v1", "--untracked-files=all"], options).stdout;
      if (head !== context.sourceSha || !REVISION.test(tree) || status !== "") readFail("checkout_identity_invalid");
      receipt.headTree = tree;
    });
    await phase("protected_main_identity", () => verifyReadProtectedMain(fetchImpl, context, receipt.headTree));
    await phase("managed_tool_identity", () => {
      receipt.access.tools.docker = boundedIdentity(run(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], authOptions()).stdout, "scanner_retention_read_proof_tool_identity_invalid");
      receipt.access.tools.buildx = boundedIdentity(run(commandRunner, "docker", ["buildx", "version"], authOptions()).stdout, "scanner_retention_read_proof_tool_identity_invalid");
    });
    await phase("authorized_registry_login", () => run(commandRunner, "docker", ["login", "ghcr.io", "--username", PACKAGE_OWNER, "--password-stdin"], {
      ...authOptions(), input: `${context.token}\n`,
    }));
    let rawBefore;
    let childRawBefore = null;
    receipt.access.authorizedManifestBefore = await phase("authorized_manifest_before", () => {
      rawBefore = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", readProof.bootstrap.subject], authOptions()).stdout;
      const topProof = validateReadRemoteManifest(rawBefore, readProof.bootstrap.manifestDigest);
      if (topProof.size !== readProof.bootstrap.manifestBytes) readFail("remote_manifest_invalid");
      const top = parseReadManifest(rawBefore, new Set([...INDEX_MEDIA_TYPES, ...MANIFEST_MEDIA_TYPES]));
      let childProof = null;
      let imageRaw = rawBefore;
      if (INDEX_MEDIA_TYPES.has(top.mediaType)) {
        if (!Array.isArray(top.manifests) || top.manifests.length !== 1) readFail("remote_manifest_invalid");
        const child = readDescriptor(top.manifests[0], MANIFEST_MEDIA_TYPES);
        if (child.digest !== readProof.bootstrap.childManifestDigest || child.size !== readProof.bootstrap.childManifestBytes
          || child.platform?.os !== "linux" || child.platform?.architecture !== "amd64") readFail("remote_manifest_invalid");
        childRawBefore = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", `${SCANNER_RETENTION.package}@${child.digest}`], authOptions()).stdout;
        childProof = validateReadRemoteManifest(childRawBefore, child.digest);
        if (childProof.size !== child.size) readFail("remote_manifest_invalid");
        imageRaw = childRawBefore;
      } else if (readProof.bootstrap.childManifestDigest !== null || readProof.bootstrap.childManifestBytes !== null) {
        readFail("remote_manifest_invalid");
      }
      manifest = readImageManifest(imageRaw, readProof.bootstrap);
      return { manifestDigest: topProof.sha256, manifestBytes: topProof.size, childManifestDigest: childProof?.sha256 ?? null,
        childManifestBytes: childProof?.size ?? null, configDigest: manifest.config.digest, configBytes: manifest.config.size,
        layerDigest: manifest.layer.digest, layerBytes: manifest.layer.size };
    });
    receipt.access.anonymousRead = await phase("anonymous_manifest_denied", () => validateAnonymousRead(observe(
      commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", readProof.bootstrap.subject], anonymousOptions(),
    )));
    receipt.access.authorizedManifestAfter = await phase("authorized_manifest_after", () => {
      const rawAfter = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", readProof.bootstrap.subject], authOptions()).stdout;
      const childRawAfter = readProof.bootstrap.childManifestDigest === null ? null : run(
        commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", `${SCANNER_RETENTION.package}@${readProof.bootstrap.childManifestDigest}`], authOptions(),
      ).stdout;
      if (rawAfter !== rawBefore || childRawAfter !== childRawBefore) readFail("remote_manifest_changed");
      validateReadRemoteManifest(rawAfter, readProof.bootstrap.manifestDigest);
      if (childRawAfter !== null) validateReadRemoteManifest(childRawAfter, readProof.bootstrap.childManifestDigest);
      return { ...receipt.access.authorizedManifestBefore };
    });
    await phase("local_collision_and_inventory", () => {
      baselineImages = inventory(commandRunner, "image", authOptions());
      baselineContainers = inventory(commandRunner, "container", authOptions());
      const subjectState = observe(commandRunner, "docker", ["image", "inspect", readProof.bootstrap.subject], authOptions());
      const configState = observe(commandRunner, "docker", ["image", "inspect", manifest.config.digest], authOptions());
      const containerState = observe(commandRunner, "docker", ["container", "inspect", containerName], authOptions());
      if (!exactReadAbsent(subjectState, "image") || !exactReadAbsent(configState, "image")
        || !exactReadAbsent(containerState, "container") || baselineImages.includes(manifest.config.digest)) {
        readFail("local_collision");
      }
      receipt.access.localInventoryBefore = {
        images: { count: baselineImages.length, sha256: sha256(Buffer.from(baselineImages.join("\n"))) },
        containers: { count: baselineContainers.length, sha256: sha256(Buffer.from(baselineContainers.join("\n"))) },
      };
    });
    await phase("protected_main_before_pull", () => verifyReadProtectedMain(fetchImpl, context, receipt.headTree));
    await phase("authorized_pinned_pull", () => {
      pullAttempted = true;
      run(commandRunner, "docker", ["pull", "--platform", readProof.platform, readProof.bootstrap.subject], authOptions());
    });
    receipt.access.image = await phase("exact_pulled_image", () => {
      const inspected = run(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", readProof.bootstrap.subject], authOptions());
      const candidate = validateReadImage(inspected.stdout, readProof.bootstrap.subject, manifest);
      const current = inventory(commandRunner, "image", authOptions());
      const added = current.filter((id) => !baselineImages.includes(id));
      if (added.length !== 1 || added[0] !== candidate.id) readFail("image_ownership_uncertain");
      image = candidate;
      return candidate;
    });
    returnedContainerId = await phase("stopped_container_create", () => {
      createAttempted = true;
      const result = run(commandRunner, "docker", [
        "create", "--name", containerName,
        "--label", `org.auto-world.scanner-retention-read-owner=${ownerLabel}`,
        "--network", "none", "--read-only", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges=true", "--pull", "never",
        readProof.bootstrap.subject, readProof.payloadPath,
      ], authOptions());
      const id = result.stdout.trim();
      if (!CONTAINER_ID.test(id)) readFail("container_create_failed");
      return id;
    });
    receipt.access.container = await phase("exact_stopped_container", () => {
      const inspected = run(commandRunner, "docker", ["container", "inspect", "--format", "{{json .}}", containerName], authOptions());
      const candidate = validateReadContainer(inspected.stdout, { id: returnedContainerId, name: containerName,
        ownerLabel, subject: readProof.bootstrap.subject, imageId: manifest.config.digest });
      const current = inventory(commandRunner, "container", authOptions());
      const added = current.filter((id) => !baselineContainers.includes(id));
      if (added.length !== 1 || added[0] !== candidate.id) readFail("container_ownership_uncertain");
      container = candidate;
      return candidate;
    });
    receipt.access.copiedPayload = await phase("stopped_container_payload", () => {
      const copied = path.join(work, "copied-bootstrap.txt");
      run(commandRunner, "docker", ["cp", `${returnedContainerId}:${readProof.payloadPath}`, copied], authOptions());
      return validateReadPayload(copied);
    });
    receipt.state = "PRIVATE_READ_PROOF";
    receipt.result = "PASSED";
  } catch (error) { primaryFailure = error; }

  const cleanupStarted = now();
  const cleanupFailures = [];
  let containerSafeForImageCleanup = true;
  if (baselineContainers && createAttempted && !container) {
    try {
      const state = observe(commandRunner, "docker", ["container", "inspect", "--format", "{{json .}}", containerName], authOptions(true));
      if (!exactReadAbsent(state, "container")) {
        const candidate = validateReadContainer(state.stdout, { id: returnedContainerId, name: containerName,
          ownerLabel, subject: readProof.bootstrap.subject, imageId: manifest.config.digest });
        const added = inventory(commandRunner, "container", authOptions(true)).filter((id) => !baselineContainers.includes(id));
        if (added.length !== 1 || added[0] !== candidate.id) readFail("container_ownership_uncertain");
        container = candidate;
      }
    } catch {
      containerSafeForImageCleanup = false;
      cleanupFailures.push("scanner_retention_read_proof_container_cleanup_uncertain");
    }
  }
  if (container) {
    try {
      run(commandRunner, "docker", ["rm", container.id], authOptions(true));
      if (!exactReadAbsent(observe(commandRunner, "docker", ["container", "inspect", containerName], authOptions(true)), "container")
        || !exactReadAbsent(observe(commandRunner, "docker", ["container", "inspect", container.id], authOptions(true)), "container")
        || !sameInventory(inventory(commandRunner, "container", authOptions(true)), baselineContainers)) {
        readFail("container_cleanup_failed");
      }
      receipt.cleanup.container = "REMOVED";
    } catch {
      containerSafeForImageCleanup = false;
      cleanupFailures.push("scanner_retention_read_proof_container_cleanup_failed");
      receipt.cleanup.container = "UNCERTAIN";
    }
  } else if (createAttempted) receipt.cleanup.container = "UNCERTAIN";

  if (baselineImages && pullAttempted && !image && containerSafeForImageCleanup) {
    try {
      const state = observe(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", readProof.bootstrap.subject], authOptions(true));
      if (!exactReadAbsent(state, "image")) {
        const candidate = validateReadImage(state.stdout, readProof.bootstrap.subject, manifest);
        const added = inventory(commandRunner, "image", authOptions(true)).filter((id) => !baselineImages.includes(id));
        if (added.length !== 1 || added[0] !== candidate.id) readFail("image_ownership_uncertain");
        image = candidate;
      }
    } catch { cleanupFailures.push("scanner_retention_read_proof_image_cleanup_uncertain"); }
  }
  if (image && containerSafeForImageCleanup) {
    try {
      run(commandRunner, "docker", ["image", "rm", readProof.bootstrap.subject], authOptions(true));
      if (!exactReadAbsent(observe(commandRunner, "docker", ["image", "inspect", readProof.bootstrap.subject], authOptions(true)), "image")
        || !exactReadAbsent(observe(commandRunner, "docker", ["image", "inspect", manifest.config.digest], authOptions(true)), "image")
        || !sameInventory(inventory(commandRunner, "image", authOptions(true)), baselineImages)) {
        readFail("image_cleanup_failed");
      }
      receipt.cleanup.image = "REMOVED";
    } catch {
      cleanupFailures.push("scanner_retention_read_proof_image_cleanup_failed");
      receipt.cleanup.image = "UNCERTAIN";
    }
  } else if (pullAttempted) receipt.cleanup.image = "UNCERTAIN";
  if (baselineImages && baselineContainers) {
    try {
      const images = inventory(commandRunner, "image", authOptions(true));
      const containers = inventory(commandRunner, "container", authOptions(true));
      receipt.access.localInventoryAfter = {
        images: { count: images.length, sha256: sha256(Buffer.from(images.join("\n"))) },
        containers: { count: containers.length, sha256: sha256(Buffer.from(containers.join("\n"))) },
      };
      if (!sameInventory(images, baselineImages) || !sameInventory(containers, baselineContainers)) readFail("inventory_cleanup_failed");
    } catch { cleanupFailures.push("scanner_retention_read_proof_inventory_cleanup_failed"); }
  }
  receipt.phases.push({ name: "owned_docker_cleanup", result: cleanupFailures.length ? "FAILED" : "PASSED",
    ...(cleanupFailures.length ? { reason: cleanupFailures[0], reasons: [...new Set(cleanupFailures)] } : {}),
    durationMs: Math.max(0, now() - cleanupStarted) });

  const pathCleanupStarted = now();
  let pathCleanupFailure;
  try {
    requireDirectoryIdentity(context.runnerTemp, runnerTempIdentity, "cleanup_path_invalid");
    requireDirectoryIdentity(work, workIdentity, "cleanup_path_invalid");
    if (path.dirname(work) !== context.runnerTemp) readFail("cleanup_path_invalid");
    removeOwnedPath(work);
    if (existsSync(work)) readFail("cleanup_path_invalid");
    receipt.cleanup.ownedPathRemoved = true;
  } catch (error) { pathCleanupFailure = error; }
  if (pathCleanupFailure) cleanupFailures.push(fixedReadReason(pathCleanupFailure));
  receipt.phases.push({ name: "owned_path_cleanup", result: pathCleanupFailure ? "FAILED" : "PASSED",
    ...(pathCleanupFailure ? { reason: fixedReadReason(pathCleanupFailure) } : {}),
    durationMs: Math.max(0, now() - pathCleanupStarted) });
  if (now() >= receiptDeadline) cleanupFailures.push("scanner_retention_read_proof_receipt_timeout");
  receipt.cleanup.state = cleanupFailures.length ? "FAILED" : "PASSED";
  if (cleanupFailures.length) receipt.result = "FAILED";
  requireDirectoryIdentity(parsed.output, outputIdentity, "receipt_path_invalid");
  writeReceipt(parsed.output, receipt);
  if (primaryFailure) fail(fixedReadReason(primaryFailure));
  if (cleanupFailures.length) fail(cleanupFailures[0]);
  return receipt;
}

export async function TEST_ONLY_runScannerRetentionReadProof(options = {}) {
  return executeReadProof({
    argv: options.argv ?? ["read-proof", "--output", options.output],
    binding: options.binding ?? SCANNER_RETENTION.readProof,
    commandRunner: options.commandRunner ?? defaultCommandRunner,
    env: options.env ?? process.env,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    now: options.now ?? Date.now,
    platform: options.platform ?? process.platform,
    removeOwnedPath: options.removeOwnedPath ?? ((target) => rmSync(target, { recursive: true, force: false })),
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseScannerRetentionArguments(argv);
  if (parsed.mode === "publish") {
    const productionRunner = createProductionPublisherRunner(parsed);
    try {
      const result = await TEST_ONLY_runScannerRetentionPublish({ env: process.env, platform: process.platform,
        runPhase: productionRunner });
      validateScannerRetentionPublisherReceiptBytes(result.bytes, { headSha: result.receipt.headSha,
        headTree: result.receipt.headTree, runId: result.receipt.runId });
      writePublisherReceipt(parsed.output, result.bytes);
      return result;
    } catch (error) {
      const cleanup = await productionRunner.cleanup();
      try {
        const context = validateScannerRetentionPublishContext(process.env, process.platform);
        const progress = error.publisherProgress;
        const failed = createScannerRetentionPublisherReceipt(context, { ...progress?.values,
          phases: progress?.phases ?? [], cleanup, result: "FAILED" });
        writePublisherReceipt(parsed.output, failed.bytes);
      } catch { /* the original refusal remains authoritative */ }
      throw error;
    }
  }
  if (parsed.mode === "read-proof") return executeReadProof({
    argv,
    binding: SCANNER_RETENTION.readProof,
    commandRunner: defaultCommandRunner,
    env: process.env,
    fetchImpl: globalThis.fetch,
    now: Date.now,
    platform: process.platform,
    removeOwnedPath: (target) => rmSync(target, { recursive: true, force: false }),
  });
  return executeBootstrap({
    argv,
    commandRunner: defaultCommandRunner,
    env: process.env,
    fetchImpl: globalThis.fetch,
    now: Date.now,
    platform: process.platform,
    statfs: statfsSync,
    removeOwnedPath: (target) => rmSync(target, { recursive: true, force: false }),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    await main();
  } catch (error) {
    const operation = process.argv[2] === "read-proof" ? "read_proof"
      : process.argv[2] === "publish" ? "publish" : "bootstrap";
    const reason = operation === "read_proof" ? fixedReadReason(error)
      : operation === "publish" ? fixedReason(error, "scanner_retention_publish_command_failed") : fixedReason(error);
    console.error(`scanner_retention_${operation}_failed:${reason}`);
    process.exitCode = 1;
  }
}
