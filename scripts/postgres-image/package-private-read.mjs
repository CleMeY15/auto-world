import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { classifyAnonymousRemoteRead, validateRemoteManifest } from "../package-bootstrap/registry-proof.mjs";
import { POSTGRES_PACKAGE_BOOTSTRAP, sha256 } from "./package-bootstrap.mjs";

const MiB = 1024 * 1024;
const MAX_OUTPUT_BYTES = MiB;
const COMMAND_TIMEOUT_MS = 120_000;
const CLEANUP_TIMEOUT_MS = 30_000;
const OPERATION_BUDGET_MS = 10 * 60_000;
const CLEANUP_RESERVE_MS = 60_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{40}$/u;
const RUN_ID = /^\d+$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;

export const POSTGRES_PACKAGE_PRIVATE_READ = Object.freeze({
  workflowPath: POSTGRES_PACKAGE_BOOTSTRAP.workflowPath,
  scriptPath: POSTGRES_PACKAGE_BOOTSTRAP.readerPath,
  repository: POSTGRES_PACKAGE_BOOTSTRAP.repository,
  image: POSTGRES_PACKAGE_BOOTSTRAP.image,
  owner: POSTGRES_PACKAGE_BOOTSTRAP.owner,
  outputDirectory: "postgres-package-private-read",
  branchUrl: POSTGRES_PACKAGE_BOOTSTRAP.branchUrl,
  platform: POSTGRES_PACKAGE_BOOTSTRAP.platform,
  digest: "sha256:9ee2f2da7187b0d0ecd3cbab83b7356f9ef032650b33604ff13e711e3462e408",
  configDigest: "sha256:cb3e9858fc85bf1fbc4fbaca353cb5b4263b20bd88fb1e6963b4081887eee1bf",
  manifestBytes: 524,
  payloadPath: POSTGRES_PACKAGE_BOOTSTRAP.payloadPath,
  payload: POSTGRES_PACKAGE_BOOTSTRAP.payload,
  payloadSha256: "3dcac3d89244976f683b3d6c26b91cd992b758baa17801f08b1533c0e235be38",
  sourceUrl: POSTGRES_PACKAGE_BOOTSTRAP.sourceUrl,
  description: POSTGRES_PACKAGE_BOOTSTRAP.description,
  imageSizeLimit: POSTGRES_PACKAGE_BOOTSTRAP.imageSizeLimit,
  authenticatedFiles: POSTGRES_PACKAGE_BOOTSTRAP.authenticatedFiles,
});

function fail(code) {
  throw new Error(code);
}

function fixedReason(error) {
  const message = error instanceof Error ? error.message : "postgres_package_private_read_unknown_failure";
  return /^postgres_package_private_read_[a-z0-9_]+$/u.test(message)
    ? message
    : "postgres_package_private_read_command_failed";
}

export function parsePrivateReadArguments(argv) {
  if (argv.length === 2 && argv[0] === "--output" && path.isAbsolute(argv[1])) {
    return Object.freeze({ output: path.resolve(argv[1]) });
  }
  fail("postgres_package_private_read_arguments_invalid");
}

function exactDirectory(directory) {
  if (!existsSync(directory)) fail("postgres_package_private_read_directory_invalid");
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) {
    fail("postgres_package_private_read_directory_invalid");
  }
}

function directoryIdentity(directory) {
  exactDirectory(directory);
  const info = lstatSync(directory);
  return Object.freeze({ dev: info.dev, ino: info.ino, uid: info.uid, mode: info.mode });
}

function requireDirectoryIdentity(directory, expected, code) {
  try {
    const actual = directoryIdentity(directory);
    if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.uid !== expected.uid ||
        actual.mode !== expected.mode) fail(code);
  } catch {
    fail(code);
  }
}

export function validatePrivateReadContext(env, platform = process.platform) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" ||
      env.RUNNER_ENVIRONMENT !== "github-hosted") fail("postgres_package_private_read_requires_github_linux");
  if (env.GITHUB_REPOSITORY !== POSTGRES_PACKAGE_PRIVATE_READ.repository ||
      env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_WORKFLOW_REF !== `${POSTGRES_PACKAGE_PRIVATE_READ.repository}/${POSTGRES_PACKAGE_PRIVATE_READ.workflowPath}@refs/heads/main`) {
    fail("postgres_package_private_read_context_invalid");
  }
  if (env.GITHUB_JOB !== "verify" || env.GITHUB_RUN_NUMBER !== "2" || env.GITHUB_RUN_ATTEMPT !== "1" ||
      !RUN_ID.test(env.GITHUB_RUN_ID ?? "") || !REVISION.test(env.GITHUB_SHA ?? "")) {
    fail("postgres_package_private_read_identity_invalid");
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN.length === 0 ||
      !path.isAbsolute(env.RUNNER_TEMP ?? "") || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")) {
    fail("postgres_package_private_read_environment_invalid");
  }
  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  const runnerTemp = path.resolve(env.RUNNER_TEMP);
  exactDirectory(workspace);
  exactDirectory(runnerTemp);
  return Object.freeze({ repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID,
    sourceSha: env.GITHUB_SHA, token: env.GITHUB_TOKEN, workspace, runnerTemp });
}

function validateOutputPath(output, runnerTemp) {
  if (path.basename(output) !== POSTGRES_PACKAGE_PRIVATE_READ.outputDirectory ||
      path.dirname(output) !== runnerTemp || existsSync(output)) {
    fail("postgres_package_private_read_output_path_invalid");
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
    input: options.input, maxBuffer: MAX_OUTPUT_BYTES, timeout: options.timeout, windowsHide: true });
}

function observe(commandRunner, command, args, options) {
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    fail("postgres_package_private_read_output_exceeded");
  }
  return { error: result?.error, status: result?.status, signal: result?.signal, stdout, stderr };
}

function run(commandRunner, command, args, options) {
  const result = observe(commandRunner, command, args, options);
  if (result.error || result.signal || result.status !== 0) fail("postgres_package_private_read_command_failed");
  return result;
}

function boundedIdentity(value) {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512 || /[^\x20-\x7e]/u.test(normalized)) {
    fail("postgres_package_private_read_tool_identity_invalid");
  }
  return normalized;
}

function identity(bytes) {
  return Object.freeze({ sha256: sha256(bytes), size: bytes.length });
}

function parseInventory(raw, pattern) {
  const values = raw.split(/\r?\n/u).filter(Boolean);
  if (values.some((value) => !pattern.test(value))) fail("postgres_package_private_read_inventory_invalid");
  return Object.freeze([...new Set(values)].sort());
}

function imageInventory(commandRunner, options) {
  return parseInventory(run(commandRunner, "docker",
    ["image", "ls", "--all", "--no-trunc", "--quiet"], options).stdout, DIGEST);
}

function containerInventory(commandRunner, options) {
  return parseInventory(run(commandRunner, "docker",
    ["container", "ls", "--all", "--no-trunc", "--quiet"], options).stdout, CONTAINER_ID);
}

function sameInventory(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactAbsent(result, kind, reference) {
  if (result.error || result.signal) fail("postgres_package_private_read_local_inspect_failed");
  if (result.status === 0) return false;
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const expected = kind === "image"
    ? new Set([`Error: No such image: ${reference}`, `Error response from daemon: No such image: ${reference}`,
      `Error: No such object: ${reference}`, `Error response from daemon: No such object: ${reference}`])
    : new Set([`Error: No such container: ${reference}`, `Error response from daemon: No such container: ${reference}`,
      `Error: No such object: ${reference}`, `Error response from daemon: No such object: ${reference}`]);
  if (result.status === 1 && (stdout === "" || stdout === "[]") && expected.has(stderr)) return true;
  fail("postgres_package_private_read_local_inspect_failed");
}

async function readBoundedJsonResponse(response) {
  const length = response.headers?.get?.("content-length");
  if (length !== null && length !== undefined && (!/^\d+$/u.test(length) || Number(length) > MAX_OUTPUT_BYTES)) {
    fail("postgres_package_private_read_main_response_invalid");
  }
  if (!response.body?.getReader) fail("postgres_package_private_read_main_response_invalid");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    const chunk = Buffer.from(item.value);
    size += chunk.length;
    if (size > MAX_OUTPUT_BYTES) {
      await reader.cancel();
      fail("postgres_package_private_read_main_response_invalid");
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail("postgres_package_private_read_main_response_invalid"); }
}

async function verifyProtectedMain(fetchImpl, context, timeout) {
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), Math.min(15_000, timeout));
  try {
    let response;
    try {
      response = await fetchImpl(POSTGRES_PACKAGE_PRIVATE_READ.branchUrl, { headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${context.token}`,
        "User-Agent": "auto-world-postgres-package-private-read",
      }, redirect: "error", signal: controller.signal });
    } catch { fail("postgres_package_private_read_main_request_failed"); }
    if (!response?.ok) fail("postgres_package_private_read_main_request_failed");
    const body = await readBoundedJsonResponse(response);
    if (body?.name !== "main" || body.protected !== true || body.commit?.sha !== context.sourceSha) {
      fail("postgres_package_private_read_main_mismatch");
    }
  } finally { globalThis.clearTimeout(timer); }
}

function validateCodeBundle(commandRunner, context, options) {
  const head = run(commandRunner, "git", ["rev-parse", "HEAD"], { ...options, cwd: context.workspace }).stdout.trim();
  if (head !== context.sourceSha) fail("postgres_package_private_read_checkout_mismatch");
  const status = run(commandRunner, "git", ["status", "--porcelain=v1", "--untracked-files=all"],
    { ...options, cwd: context.workspace }).stdout;
  if (status !== "") fail("postgres_package_private_read_checkout_dirty");
  const files = POSTGRES_PACKAGE_PRIVATE_READ.authenticatedFiles.map((file) => {
    const filename = path.join(context.workspace, file);
    const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_OUTPUT_BYTES) {
      fail("postgres_package_private_read_checkout_dirty");
    }
    const working = readFileSync(filename);
    const committed = Buffer.from(run(commandRunner, "git", ["show", `HEAD:${file}`],
      { ...options, cwd: context.workspace }).stdout, "utf8");
    if (!working.equals(committed)) fail("postgres_package_private_read_checkout_dirty");
    return Object.freeze({ path: file, ...identity(working) });
  });
  return Object.freeze({ revision: head, files: Object.freeze(files) });
}

export function validatePinnedManifest(raw, hashValidator = validateRemoteManifest) {
  let proof;
  let manifest;
  try {
    proof = hashValidator(raw, POSTGRES_PACKAGE_PRIVATE_READ.digest);
    manifest = JSON.parse(raw);
  } catch { fail("postgres_package_private_read_manifest_invalid"); }
  const manifestTypes = new Set(["application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json"]);
  const configTypes = new Set(["application/vnd.oci.image.config.v1+json",
    "application/vnd.docker.container.image.v1+json"]);
  const layerTypes = new Set(["application/vnd.oci.image.layer.v1.tar+gzip",
    "application/vnd.docker.image.rootfs.diff.tar.gzip"]);
  const layer = manifest?.layers?.[0];
  if (proof.size !== POSTGRES_PACKAGE_PRIVATE_READ.manifestBytes || manifest?.schemaVersion !== 2 ||
      !manifestTypes.has(manifest?.mediaType) || manifest?.config?.digest !== POSTGRES_PACKAGE_PRIVATE_READ.configDigest ||
      !configTypes.has(manifest?.config?.mediaType) || !Number.isSafeInteger(manifest?.config?.size) ||
      manifest.config.size < 1 || manifest.config.size > MAX_OUTPUT_BYTES || !Array.isArray(manifest?.layers) ||
      manifest.layers.length !== 1 ||
      !layerTypes.has(layer?.mediaType) || !DIGEST.test(layer?.digest ?? "") || !Number.isSafeInteger(layer?.size) ||
      layer.size < 1 || layer.size > POSTGRES_PACKAGE_PRIVATE_READ.imageSizeLimit) {
    fail("postgres_package_private_read_manifest_invalid");
  }
  return Object.freeze({ ...proof, mediaType: manifest.mediaType,
    config: Object.freeze({ digest: manifest.config.digest, size: manifest.config.size }),
    layer: Object.freeze({ digest: layer.digest, size: layer.size }) });
}

function validateAnonymousDenial(result) {
  if (result.error || result.signal) fail("postgres_package_private_read_anonymous_remote_error");
  try { return classifyAnonymousRemoteRead(result); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.endsWith("anonymous_remote_read_succeeded")) {
      fail("postgres_package_private_read_anonymous_remote_succeeded");
    }
    fail("postgres_package_private_read_anonymous_remote_error");
  }
}

function exactLabels(labels, ownerLabel) {
  const expected = {
    "org.opencontainers.image.source": POSTGRES_PACKAGE_PRIVATE_READ.sourceUrl,
    "org.opencontainers.image.description": POSTGRES_PACKAGE_PRIVATE_READ.description,
    ...(ownerLabel ? { "org.auto-world.private-read-owner": ownerLabel } : {}),
  };
  return labels !== null && typeof labels === "object" && !Array.isArray(labels) &&
    JSON.stringify(Object.keys(labels).sort()) === JSON.stringify(Object.keys(expected).sort()) &&
    Object.entries(expected).every(([name, value]) => labels[name] === value);
}

function validateOwnedImage(raw, subject) {
  let image;
  try { image = JSON.parse(raw); } catch { fail("postgres_package_private_read_image_invalid"); }
  const tags = image?.RepoTags ?? [];
  if (image?.Id !== POSTGRES_PACKAGE_PRIVATE_READ.configDigest || image?.Os !== "linux" ||
      image?.Architecture !== "amd64" || !Number.isSafeInteger(image?.Size) || image.Size < 1 ||
      image.Size > POSTGRES_PACKAGE_PRIVATE_READ.imageSizeLimit || !Array.isArray(tags) || tags.length !== 0 ||
      !Array.isArray(image?.RepoDigests) || image.RepoDigests.length !== 1 || image.RepoDigests[0] !== subject ||
      !exactLabels(image?.Config?.Labels)) fail("postgres_package_private_read_image_invalid");
  return Object.freeze({ id: image.Id, size: image.Size, subject });
}

function validateOwnedContainer(raw, expected) {
  let container;
  try { container = JSON.parse(raw); } catch { fail("postgres_package_private_read_container_invalid"); }
  const capDrop = container?.HostConfig?.CapDrop ?? [];
  const securityOpt = container?.HostConfig?.SecurityOpt ?? [];
  if (!CONTAINER_ID.test(container?.Id ?? "") || (expected.id && container.Id !== expected.id) ||
      container?.Name !== `/${expected.name}` || container?.Image !== POSTGRES_PACKAGE_PRIVATE_READ.configDigest ||
      container?.Config?.Image !== expected.subject || JSON.stringify(container?.Config?.Cmd) !== JSON.stringify([expected.command]) ||
      !exactLabels(container?.Config?.Labels, expected.ownerLabel) || container?.State?.Running !== false ||
      container?.State?.Status !== "created" || container?.HostConfig?.NetworkMode !== "none" ||
      container?.HostConfig?.ReadonlyRootfs !== true || JSON.stringify(capDrop) !== JSON.stringify(["ALL"]) ||
      JSON.stringify(securityOpt) !== JSON.stringify(["no-new-privileges=true"]) ||
      !Array.isArray(container?.Mounts) || container.Mounts.length !== 0) {
    fail("postgres_package_private_read_container_invalid");
  }
  return Object.freeze({ id: container.Id, name: expected.name });
}

function validatePayload(filename) {
  const info = lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== Buffer.byteLength(POSTGRES_PACKAGE_PRIVATE_READ.payload)) {
    fail("postgres_package_private_read_payload_invalid");
  }
  const bytes = readFileSync(filename);
  if (sha256(bytes) !== POSTGRES_PACKAGE_PRIVATE_READ.payloadSha256 ||
      !bytes.equals(Buffer.from(POSTGRES_PACKAGE_PRIVATE_READ.payload))) {
    fail("postgres_package_private_read_payload_invalid");
  }
  return Object.freeze({ path: `/${POSTGRES_PACKAGE_PRIVATE_READ.payloadPath}`, ...identity(bytes) });
}

function writeReceipt(output, receipt, expectedOutput, runnerTemp, expectedRunnerTemp) {
  requireDirectoryIdentity(runnerTemp, expectedRunnerTemp, "postgres_package_private_read_receipt_path_invalid");
  requireDirectoryIdentity(output, expectedOutput, "postgres_package_private_read_receipt_path_invalid");
  const bytes = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(bytes) > MAX_OUTPUT_BYTES) fail("postgres_package_private_read_receipt_too_large");
  writeFileSync(path.join(output, "receipt.json"), bytes, { flag: "wx", mode: 0o600 });
}

export async function runPostgresPackagePrivateRead({
  argv = process.argv.slice(2), commandRunner = defaultCommandRunner, env = process.env,
  fetchImpl = globalThis.fetch, manifestHashValidator = validateRemoteManifest,
  now = () => performance.now(), platform = process.platform,
} = {}) {
  const started = now();
  const deadline = started + OPERATION_BUDGET_MS;
  const { output } = parsePrivateReadArguments(argv);
  const context = validatePrivateReadContext(env, platform);
  const runnerTempIdentity = directoryIdentity(context.runnerTemp);
  validateOutputPath(output, context.runnerTemp);
  const work = path.join(context.runnerTemp, `aw-postgres-package-private-read-${context.runId}-attempt-1`);
  if (existsSync(work)) fail("postgres_package_private_read_owned_path_exists");
  mkdirSync(output, { mode: 0o700 });
  if (lstatSync(output).isSymbolicLink() || realpathSync(output) !== output) {
    fail("postgres_package_private_read_output_path_invalid");
  }
  const outputIdentity = directoryIdentity(output);
  mkdirSync(work, { mode: 0o700 });
  const workIdentity = directoryIdentity(work);
  const authConfig = path.join(work, "docker-auth");
  const anonymousConfig = path.join(work, "docker-anonymous");
  mkdirSync(authConfig, { mode: 0o700 });
  mkdirSync(anonymousConfig, { mode: 0o700 });
  mkdirSync(path.join(authConfig, "buildx"), { mode: 0o700 });
  mkdirSync(path.join(anonymousConfig, "buildx"), { mode: 0o700 });
  const commandOptions = (dockerConfig, cleanup = false) => {
    requireDirectoryIdentity(context.runnerTemp, runnerTempIdentity,
      "postgres_package_private_read_owned_path_replaced");
    requireDirectoryIdentity(work, workIdentity, "postgres_package_private_read_owned_path_replaced");
    const remaining = deadline - now() - (cleanup ? 0 : CLEANUP_RESERVE_MS);
    if (!Number.isFinite(remaining) || remaining < 1_000) fail(cleanup
      ? "postgres_package_private_read_cleanup_timeout" : "postgres_package_private_read_job_timeout");
    return { cwd: work, env: commandEnvironment(env, dockerConfig, work),
      timeout: Math.floor(Math.min(cleanup ? CLEANUP_TIMEOUT_MS : COMMAND_TIMEOUT_MS, remaining)) };
  };
  const authOptions = (cleanup = false) => commandOptions(authConfig, cleanup);
  const anonymousOptions = () => commandOptions(anonymousConfig);
  const subject = `${POSTGRES_PACKAGE_PRIVATE_READ.image}@${POSTGRES_PACKAGE_PRIVATE_READ.digest}`;
  const containerName = `aw-postgres-package-private-read-${context.runId}`;
  const ownerLabel = `${context.sourceSha}:${context.runId}:1`;
  const receipt = {
    schemaVersion: 1, kind: "POSTGRES_GOSU_PACKAGE_PRIVATE_READ_V1", state: "VERIFYING_PRIVATE_READ", result: "FAILED",
    publication: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null,
    archiveUntil: null, forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED",
    packageSettings: "NOT_VERIFIED_BY_THIS_RECEIPT", repository: context.repository,
    image: POSTGRES_PACKAGE_PRIVATE_READ.image, manifestDigest: POSTGRES_PACKAGE_PRIVATE_READ.digest,
    configDigest: POSTGRES_PACKAGE_PRIVATE_READ.configDigest, subject, sourceSha: context.sourceSha,
    sourceRef: "refs/heads/main", runId: context.runId, runNumber: "2", runAttempt: "1",
    expectedPayload: { path: `/${POSTGRES_PACKAGE_PRIVATE_READ.payloadPath}`,
      sha256: POSTGRES_PACKAGE_PRIVATE_READ.payloadSha256, size: Buffer.byteLength(POSTGRES_PACKAGE_PRIVATE_READ.payload) },
    phases: [],
  };
  const phase = async (name, operation) => {
    const phaseStarted = now();
    try {
      authOptions();
      const value = await operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: Math.max(0, now() - phaseStarted) });
      return value;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: fixedReason(error),
        durationMs: Math.max(0, now() - phaseStarted) });
      throw error;
    }
  };

  let baselineImages;
  let baselineContainers;
  let pullAttempted = false;
  let createAttempted = false;
  let returnedContainerId;
  let ownedImage;
  let ownedContainer;
  let imageProvenAbsent = false;
  let containerProvenAbsent = false;
  let primaryFailure;
  try {
    receipt.tools = await phase("managed_tool_identity", () => ({
      docker: boundedIdentity(run(commandRunner, "docker",
        ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], authOptions()).stdout),
      buildx: boundedIdentity(run(commandRunner, "docker", ["buildx", "version"], authOptions()).stdout),
      node: process.version, trustBoundary: "GITHUB_HOSTED_MANAGED_DOCKER_BUILDKIT",
    }));
    receipt.code = await phase("checkout_and_import_closure", () => validateCodeBundle(commandRunner, context, authOptions()));
    await phase("protected_main_before_credentials", () => verifyProtectedMain(fetchImpl, context, authOptions().timeout));
    await phase("authorized_registry_login", () => run(commandRunner, "docker",
      ["login", "ghcr.io", "--username", POSTGRES_PACKAGE_PRIVATE_READ.owner, "--password-stdin"],
      { ...authOptions(), input: `${context.token}\n` }));
    let rawBefore;
    receipt.remoteManifestBefore = await phase("authorized_manifest_before", () => {
      rawBefore = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], authOptions()).stdout;
      return validatePinnedManifest(rawBefore, manifestHashValidator);
    });
    receipt.anonymousManifestDenied = await phase("anonymous_manifest_denied", () => validateAnonymousDenial(observe(
      commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], anonymousOptions())));
    receipt.remoteManifestAfter = await phase("authorized_manifest_after", () => {
      const rawAfter = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], authOptions()).stdout;
      const proof = validatePinnedManifest(rawAfter, manifestHashValidator);
      if (rawAfter !== rawBefore || JSON.stringify(proof) !== JSON.stringify(receipt.remoteManifestBefore)) {
        fail("postgres_package_private_read_manifest_changed");
      }
      return proof;
    });
    await phase("local_collision_and_inventory", () => {
      baselineImages = imageInventory(commandRunner, authOptions());
      baselineContainers = containerInventory(commandRunner, authOptions());
      const subjectState = observe(commandRunner, "docker", ["image", "inspect", subject], authOptions());
      const configState = observe(commandRunner, "docker", ["image", "inspect", POSTGRES_PACKAGE_PRIVATE_READ.configDigest], authOptions());
      const containerState = observe(commandRunner, "docker", ["container", "inspect", containerName], authOptions());
      if (!exactAbsent(subjectState, "image", subject) ||
          !exactAbsent(configState, "image", POSTGRES_PACKAGE_PRIVATE_READ.configDigest) ||
          !exactAbsent(containerState, "container", containerName) ||
          baselineImages.includes(POSTGRES_PACKAGE_PRIVATE_READ.configDigest)) {
        fail("postgres_package_private_read_local_collision");
      }
      receipt.localInventoryBefore = {
        images: { count: baselineImages.length, ...identity(Buffer.from(baselineImages.join("\n"))) },
        containers: { count: baselineContainers.length, ...identity(Buffer.from(baselineContainers.join("\n"))) },
      };
    });
    await phase("protected_main_before_pull", () => verifyProtectedMain(fetchImpl, context, authOptions().timeout));
    await phase("authorized_pinned_pull", () => {
      pullAttempted = true;
      const result = observe(commandRunner, "docker", ["pull", "--platform", POSTGRES_PACKAGE_PRIVATE_READ.platform, subject], authOptions());
      if (result.error || result.signal || result.status !== 0) fail("postgres_package_private_read_pull_failed");
    });
    receipt.pulledImage = await phase("exact_pulled_image", () => {
      const inspected = run(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", subject], authOptions());
      const image = validateOwnedImage(inspected.stdout, subject);
      const current = imageInventory(commandRunner, authOptions());
      const additional = current.filter((id) => !baselineImages.includes(id));
      if (additional.length !== 1 || additional[0] !== image.id) fail("postgres_package_private_read_image_ownership_uncertain");
      ownedImage = image;
      return image;
    });
    returnedContainerId = await phase("stopped_container_create", () => {
      createAttempted = true;
      const result = observe(commandRunner, "docker", ["create", "--name", containerName,
        "--label", `org.auto-world.private-read-owner=${ownerLabel}`, "--network", "none", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--pull", "never", subject,
        `/${POSTGRES_PACKAGE_PRIVATE_READ.payloadPath}`], authOptions());
      const id = result.stdout.trim();
      if (result.error || result.signal || result.status !== 0 || !CONTAINER_ID.test(id)) {
        fail("postgres_package_private_read_container_create_failed");
      }
      return id;
    });
    receipt.stoppedContainer = await phase("exact_stopped_container", () => {
      const inspected = run(commandRunner, "docker", ["container", "inspect", "--format", "{{json .}}", containerName], authOptions());
      const container = validateOwnedContainer(inspected.stdout, { id: returnedContainerId, name: containerName,
        ownerLabel, subject, command: `/${POSTGRES_PACKAGE_PRIVATE_READ.payloadPath}` });
      const current = containerInventory(commandRunner, authOptions());
      const additional = current.filter((id) => !baselineContainers.includes(id));
      if (additional.length !== 1 || additional[0] !== container.id) {
        fail("postgres_package_private_read_container_ownership_uncertain");
      }
      ownedContainer = container;
      return container;
    });
    receipt.copiedPayload = await phase("stopped_container_payload", () => {
      const copied = path.join(work, "copied-bootstrap.txt");
      run(commandRunner, "docker", ["cp", `${returnedContainerId}:/${POSTGRES_PACKAGE_PRIVATE_READ.payloadPath}`, copied], authOptions());
      return validatePayload(copied);
    });
    receipt.state = "PRIVATE_READ_PROOF";
    receipt.result = "PASSED";
  } catch (error) { primaryFailure = error; }

  const cleanupStarted = now();
  const cleanupFailures = [];
  let containerSafeForImageCleanup = true;
  if (baselineContainers && createAttempted && !ownedContainer) {
    try {
      const state = observe(commandRunner, "docker", ["container", "inspect", "--format", "{{json .}}", containerName], authOptions(true));
      if (!exactAbsent(state, "container", containerName)) {
        const candidate = validateOwnedContainer(state.stdout, { id: returnedContainerId, name: containerName,
          ownerLabel, subject, command: `/${POSTGRES_PACKAGE_PRIVATE_READ.payloadPath}` });
        const current = containerInventory(commandRunner, authOptions(true));
        const additional = current.filter((id) => !baselineContainers.includes(id));
        if (additional.length !== 1 || additional[0] !== candidate.id) {
          fail("postgres_package_private_read_container_ownership_uncertain");
        }
        ownedContainer = candidate;
      } else {
        const current = containerInventory(commandRunner, authOptions(true));
        if (!sameInventory(current, baselineContainers)) {
          fail("postgres_package_private_read_container_ownership_uncertain");
        }
        containerProvenAbsent = true;
      }
    } catch {
      containerSafeForImageCleanup = false;
      cleanupFailures.push("postgres_package_private_read_container_cleanup_uncertain");
    }
  }
  if (ownedContainer) {
    try {
      const removed = observe(commandRunner, "docker", ["rm", ownedContainer.id], authOptions(true));
      const byName = observe(commandRunner, "docker", ["container", "inspect", containerName], authOptions(true));
      const byId = observe(commandRunner, "docker", ["container", "inspect", ownedContainer.id], authOptions(true));
      const final = containerInventory(commandRunner, authOptions(true));
      if ((removed.error || removed.signal || removed.status !== 0) &&
          (!exactAbsent(byName, "container", containerName) || !exactAbsent(byId, "container", ownedContainer.id))) {
        fail("postgres_package_private_read_container_cleanup_failed");
      }
      if (!exactAbsent(byName, "container", containerName) || !exactAbsent(byId, "container", ownedContainer.id) ||
          !sameInventory(final, baselineContainers)) fail("postgres_package_private_read_container_cleanup_failed");
      receipt.containerCleanup = { state: "REMOVED", id: ownedContainer.id };
    } catch {
      containerSafeForImageCleanup = false;
      cleanupFailures.push("postgres_package_private_read_container_cleanup_failed");
      receipt.containerCleanup = { state: "UNCERTAIN" };
    }
  } else if (containerProvenAbsent) receipt.containerCleanup = { state: "ABSENT" };
  else if (createAttempted) receipt.containerCleanup = { state: "UNCERTAIN" };
  else receipt.containerCleanup = { state: "NOT_CREATED" };

  if (baselineImages && pullAttempted && !ownedImage && containerSafeForImageCleanup) {
    try {
      const state = observe(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", subject], authOptions(true));
      if (!exactAbsent(state, "image", subject)) {
        const candidate = validateOwnedImage(state.stdout, subject);
        const current = imageInventory(commandRunner, authOptions(true));
        const additional = current.filter((id) => !baselineImages.includes(id));
        if (additional.length !== 1 || additional[0] !== candidate.id) {
          fail("postgres_package_private_read_image_ownership_uncertain");
        }
        ownedImage = candidate;
      } else {
        const current = imageInventory(commandRunner, authOptions(true));
        if (!sameInventory(current, baselineImages)) fail("postgres_package_private_read_image_ownership_uncertain");
        imageProvenAbsent = true;
      }
    } catch {
      cleanupFailures.push("postgres_package_private_read_image_cleanup_uncertain");
    }
  }
  if (ownedImage && containerSafeForImageCleanup) {
    try {
      const removed = observe(commandRunner, "docker", ["image", "rm", subject], authOptions(true));
      const bySubject = observe(commandRunner, "docker", ["image", "inspect", subject], authOptions(true));
      const byConfig = observe(commandRunner, "docker", ["image", "inspect", POSTGRES_PACKAGE_PRIVATE_READ.configDigest], authOptions(true));
      const final = imageInventory(commandRunner, authOptions(true));
      if ((removed.error || removed.signal || removed.status !== 0) &&
          (!exactAbsent(bySubject, "image", subject) ||
            !exactAbsent(byConfig, "image", POSTGRES_PACKAGE_PRIVATE_READ.configDigest))) {
        fail("postgres_package_private_read_image_cleanup_failed");
      }
      if (!exactAbsent(bySubject, "image", subject) ||
          !exactAbsent(byConfig, "image", POSTGRES_PACKAGE_PRIVATE_READ.configDigest) ||
          !sameInventory(final, baselineImages)) fail("postgres_package_private_read_image_cleanup_failed");
      receipt.imageCleanup = { state: "REMOVED", id: ownedImage.id };
    } catch {
      cleanupFailures.push("postgres_package_private_read_image_cleanup_failed");
      receipt.imageCleanup = { state: "UNCERTAIN" };
    }
  } else if (imageProvenAbsent) receipt.imageCleanup = { state: "ABSENT" };
  else if (pullAttempted) receipt.imageCleanup = { state: "UNCERTAIN" };
  else receipt.imageCleanup = { state: "NOT_PULLED" };

  if (baselineContainers) {
    try {
      const finalContainers = containerInventory(commandRunner, authOptions(true));
      receipt.localContainersAfter = { count: finalContainers.length, ...identity(Buffer.from(finalContainers.join("\n"))) };
      if (!sameInventory(finalContainers, baselineContainers)) {
        fail("postgres_package_private_read_container_cleanup_uncertain");
      }
    } catch (error) { cleanupFailures.push(fixedReason(error)); }
  }
  if (baselineImages) {
    try {
      const finalImages = imageInventory(commandRunner, authOptions(true));
      receipt.localImagesAfter = { count: finalImages.length, ...identity(Buffer.from(finalImages.join("\n"))) };
      if (!sameInventory(finalImages, baselineImages)) fail("postgres_package_private_read_image_cleanup_uncertain");
    } catch (error) { cleanupFailures.push(fixedReason(error)); }
  }
  receipt.phases.push({ name: "owned_docker_cleanup", result: cleanupFailures.length ? "FAILED" : "PASSED",
    ...(cleanupFailures.length ? { reason: cleanupFailures[0], reasons: [...new Set(cleanupFailures)] } : {}),
    durationMs: Math.max(0, now() - cleanupStarted) });

  const temporaryStarted = now();
  let temporaryFailure;
  try {
    requireDirectoryIdentity(context.runnerTemp, runnerTempIdentity,
      "postgres_package_private_read_cleanup_path_invalid");
    requireDirectoryIdentity(work, workIdentity, "postgres_package_private_read_cleanup_path_invalid");
    if (path.dirname(work) !== context.runnerTemp) fail("postgres_package_private_read_cleanup_path_invalid");
    rmSync(work, { recursive: true, force: false });
  } catch (error) { temporaryFailure = error; }
  receipt.phases.push({ name: "owned_temporary_cleanup", result: temporaryFailure ? "FAILED" : "PASSED",
    ...(temporaryFailure ? { reason: fixedReason(temporaryFailure) } : {}),
    durationMs: Math.max(0, now() - temporaryStarted) });
  if (cleanupFailures.length || temporaryFailure) receipt.result = "FAILED";
  writeReceipt(output, receipt, outputIdentity, context.runnerTemp, runnerTempIdentity);
  if (primaryFailure) throw new Error(fixedReason(primaryFailure));
  if (cleanupFailures.length) throw new Error(cleanupFailures[0]);
  if (temporaryFailure) throw new Error(fixedReason(temporaryFailure));
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { await runPostgresPackagePrivateRead(); }
  catch (error) {
    console.error(`postgres_package_private_read_failed:${fixedReason(error)}`);
    process.exitCode = 1;
  }
}
