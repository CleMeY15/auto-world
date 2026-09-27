import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import process from "node:process";
import { performance } from "node:perf_hooks";
import { validateRemoteManifest } from "../package-bootstrap/registry-proof.mjs";

const MiB = 1024 * 1024;
const MAX_OUTPUT_BYTES = MiB;
const COMMAND_TIMEOUT_MS = 120_000;
const OPERATION_BUDGET_MS = 10 * 60_000;
const CLEANUP_RESERVE_MS = 60_000;
const CLEANUP_COMMAND_TIMEOUT_MS = 30_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{40}$/u;
const RUN_ID = /^\d+$/u;

export const POSTGRES_PACKAGE_BOOTSTRAP = Object.freeze({
  workflowPath: ".github/workflows/postgres-package-bootstrap.yml",
  scriptPath: "scripts/postgres-image/package-bootstrap.mjs",
  repository: "CleMeY15/auto-world",
  image: "ghcr.io/clemey15/auto-world-postgres-gosu",
  owner: "CleMeY15",
  outputDirectory: "postgres-package-bootstrap",
  branchUrl: "https://api.github.com/repos/CleMeY15/auto-world/branches/main",
  platform: "linux/amd64",
  payloadPath: "bootstrap.txt",
  payload: "auto-world-postgres-gosu-package-bootstrap-v1\n",
  sourceUrl: "https://github.com/CleMeY15/auto-world",
  description: "Harmless Auto World PostgreSQL gosu package bootstrap; not a runtime image",
  imageSizeLimit: 4 * MiB,
  dockerfile: [
    "FROM scratch",
    "LABEL org.opencontainers.image.source=\"https://github.com/CleMeY15/auto-world\"",
    "LABEL org.opencontainers.image.description=\"Harmless Auto World PostgreSQL gosu package bootstrap; not a runtime image\"",
    "COPY bootstrap.txt /bootstrap.txt",
    "",
  ].join("\n"),
  authenticatedFiles: Object.freeze([
    ".github/workflows/postgres-package-bootstrap.yml",
    "scripts/postgres-image/package-bootstrap.mjs",
    "scripts/package-bootstrap/registry-proof.mjs",
    "scripts/package-bootstrap/prepare.mjs",
  ]),
});

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(code) {
  throw new Error(code);
}

function fixedReason(error) {
  const message = error instanceof Error ? error.message : "postgres_package_bootstrap_unknown_failure";
  return /^postgres_package_bootstrap_[a-z0-9_]+$/u.test(message)
    ? message
    : "postgres_package_bootstrap_command_failed";
}

export function parseBootstrapArguments(argv) {
  if (argv.length === 2 && argv[0] === "--output" && path.isAbsolute(argv[1])) {
    return { output: path.resolve(argv[1]) };
  }
  fail("postgres_package_bootstrap_arguments_invalid");
}

function exactDirectory(directory) {
  if (!existsSync(directory)) fail("postgres_package_bootstrap_directory_invalid");
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) {
    fail("postgres_package_bootstrap_directory_invalid");
  }
}

export function validateBootstrapContext(env, platform = process.platform) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" ||
      env.RUNNER_ENVIRONMENT !== "github-hosted") fail("postgres_package_bootstrap_requires_github_linux");
  if (env.GITHUB_REPOSITORY !== POSTGRES_PACKAGE_BOOTSTRAP.repository || env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_WORKFLOW_REF !== `${POSTGRES_PACKAGE_BOOTSTRAP.repository}/${POSTGRES_PACKAGE_BOOTSTRAP.workflowPath}@refs/heads/main`) {
    fail("postgres_package_bootstrap_context_invalid");
  }
  if (env.GITHUB_JOB !== "publish" || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1" ||
      !RUN_ID.test(env.GITHUB_RUN_ID ?? "") || !REVISION.test(env.GITHUB_SHA ?? "")) {
    fail("postgres_package_bootstrap_identity_invalid");
  }
  if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN.length === 0 ||
      !path.isAbsolute(env.RUNNER_TEMP ?? "") || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")) {
    fail("postgres_package_bootstrap_environment_invalid");
  }
  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  const runnerTemp = path.resolve(env.RUNNER_TEMP);
  exactDirectory(workspace);
  exactDirectory(runnerTemp);
  return Object.freeze({ repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID,
    sourceSha: env.GITHUB_SHA, token: env.GITHUB_TOKEN, workspace, runnerTemp });
}

export function validateOutputPath(output, runnerTemp) {
  if (path.basename(output) !== POSTGRES_PACKAGE_BOOTSTRAP.outputDirectory || path.dirname(output) !== runnerTemp ||
      existsSync(output)) fail("postgres_package_bootstrap_output_path_invalid");
  return output;
}

export function parsePublishedDigest(metadata) {
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail("postgres_package_bootstrap_metadata_invalid");
  }
  const digest = metadata["containerimage.digest"];
  if (!DIGEST.test(digest ?? "")) fail("postgres_package_bootstrap_digest_invalid");
  const configDigest = metadata["containerimage.config.digest"];
  if (!DIGEST.test(configDigest ?? "")) fail("postgres_package_bootstrap_metadata_invalid");
  return Object.freeze({ manifestDigest: digest, configDigest });
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
    maxBuffer: MAX_OUTPUT_BYTES, timeout: options.timeout, windowsHide: true });
}

function observe(commandRunner, command, args, options) {
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    fail("postgres_package_bootstrap_output_exceeded");
  }
  return { error: result?.error, status: result?.status, signal: result?.signal, stdout, stderr };
}

function run(commandRunner, command, args, options, expectedStatuses = [0]) {
  const result = observe(commandRunner, command, args, options);
  if (result.error || result.signal || !expectedStatuses.includes(result.status)) {
    fail("postgres_package_bootstrap_command_failed");
  }
  return result;
}

function boundedIdentity(value) {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512 || /[^\x20-\x7e]/u.test(normalized)) {
    fail("postgres_package_bootstrap_tool_identity_invalid");
  }
  return normalized;
}

function parseLocalImageIds(raw) {
  const ids = raw.split(/\r?\n/u).filter(Boolean);
  if (ids.some((id) => !DIGEST.test(id))) fail("postgres_package_bootstrap_local_inventory_ambiguous");
  return Object.freeze([...new Set(ids)].sort());
}

function readLocalImageIds(commandRunner, options) {
  return parseLocalImageIds(run(commandRunner, "docker",
    ["image", "ls", "--all", "--no-trunc", "--quiet"], options).stdout);
}

function sameImageIds(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inspectAbsent(result, reference) {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const expected = new Set([
    `Error: No such image: ${reference}`,
    `Error response from daemon: No such image: ${reference}`,
    `Error: No such object: ${reference}`,
    `Error response from daemon: No such object: ${reference}`,
  ]);
  if (result.error || result.signal) fail("postgres_package_bootstrap_local_inventory_ambiguous");
  if (result.status === 1 && (stdout === "" || stdout === "[]") &&
      expected.has(stderr)) return true;
  if (result.status === 0) return false;
  fail("postgres_package_bootstrap_local_inventory_ambiguous");
}

function remoteTagAbsent(result, expectedReference) {
  if (result.status === 0) fail("postgres_package_bootstrap_remote_tag_collision");
  const message = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const exactReferenceNotFound = expectedReference.length <= 512 && message.split(/\r?\n/u).some((line) =>
    line.trim() === `${expectedReference.toLowerCase()}: not found` ||
    line.trim() === `error: ${expectedReference.toLowerCase()}: not found`);
  if (result.error || result.signal || result.status !== 1 ||
      (!/(?:manifest unknown|name unknown|manifest.*not found|not found.*manifest)/u.test(message) &&
        !exactReferenceNotFound) ||
      /(?:unauthorized|denied|forbidden|timeout|timed out|tls|certificate|dial tcp|connection|no such host|network)/u.test(message)) {
    fail("postgres_package_bootstrap_remote_tag_state_ambiguous");
  }
}

function exactLabels(labels) {
  return labels !== null && typeof labels === "object" && !Array.isArray(labels) &&
    Object.keys(labels).length === 2 && labels["org.opencontainers.image.source"] === POSTGRES_PACKAGE_BOOTSTRAP.sourceUrl &&
    labels["org.opencontainers.image.description"] === POSTGRES_PACKAGE_BOOTSTRAP.description;
}

export function validateLocalBootstrapImage(raw, tag, { afterTagRemoval = false } = {}) {
  let image;
  try { image = JSON.parse(raw); } catch { fail("postgres_package_bootstrap_local_image_invalid"); }
  const tags = image?.RepoTags ?? [];
  if (image === null || typeof image !== "object" || Array.isArray(image) || !DIGEST.test(image.Id ?? "") ||
      image.Os !== "linux" || image.Architecture !== "amd64" || !Number.isSafeInteger(image.Size) ||
      image.Size < 1 || image.Size > POSTGRES_PACKAGE_BOOTSTRAP.imageSizeLimit || !exactLabels(image.Config?.Labels) ||
      !Array.isArray(tags) || (afterTagRemoval ? tags.length !== 0 : tags.length !== 1 || tags[0] !== tag)) {
    fail("postgres_package_bootstrap_local_image_invalid");
  }
  return Object.freeze({ id: image.Id, os: image.Os, architecture: image.Architecture, size: image.Size,
    labels: Object.freeze({ ...image.Config.Labels }), tags: Object.freeze([...tags]) });
}

async function readBoundedJsonResponse(response) {
  const length = response.headers?.get?.("content-length");
  if (length !== null && length !== undefined && (!/^\d+$/u.test(length) || Number(length) > MAX_OUTPUT_BYTES)) {
    fail("postgres_package_bootstrap_main_response_invalid");
  }
  if (!response.body?.getReader) fail("postgres_package_bootstrap_main_response_invalid");
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
      fail("postgres_package_bootstrap_main_response_invalid");
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { fail("postgres_package_bootstrap_main_response_invalid"); }
}

async function verifyProtectedMain(fetchImpl, context, timeout) {
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), Math.min(15_000, timeout));
  try {
    let response;
    try {
      response = await fetchImpl(POSTGRES_PACKAGE_BOOTSTRAP.branchUrl, { headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${context.token}`,
        "User-Agent": "auto-world-postgres-package-bootstrap",
      }, redirect: "error", signal: controller.signal });
    } catch { fail("postgres_package_bootstrap_main_request_failed"); }
    if (!response?.ok) fail("postgres_package_bootstrap_main_request_failed");
    const body = await readBoundedJsonResponse(response);
    if (body?.name !== "main" || body.protected !== true || body.commit?.sha !== context.sourceSha) {
      fail("postgres_package_bootstrap_main_mismatch");
    }
  } finally { globalThis.clearTimeout(timer); }
}

function identity(bytes) {
  return Object.freeze({ sha256: sha256(bytes), size: bytes.length });
}

function validateCodeBundle(commandRunner, context, options) {
  const files = POSTGRES_PACKAGE_BOOTSTRAP.authenticatedFiles;
  const head = run(commandRunner, "git", ["rev-parse", "HEAD"], { ...options, cwd: context.workspace }).stdout.trim();
  if (head !== context.sourceSha) fail("postgres_package_bootstrap_checkout_mismatch");
  const status = run(commandRunner, "git", ["status", "--porcelain=v1", "--untracked-files=all"],
    { ...options, cwd: context.workspace }).stdout;
  if (status !== "") fail("postgres_package_bootstrap_checkout_dirty");
  const records = files.map((file) => {
    const filename = path.join(context.workspace, file);
    const info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_OUTPUT_BYTES) {
      fail("postgres_package_bootstrap_checkout_dirty");
    }
    const working = readFileSync(filename);
    const committed = Buffer.from(run(commandRunner, "git", ["show", `HEAD:${file}`],
      { ...options, cwd: context.workspace }).stdout, "utf8");
    if (!working.equals(committed)) fail("postgres_package_bootstrap_checkout_dirty");
    return Object.freeze({ path: file, ...identity(working) });
  });
  return Object.freeze({ revision: head, files: Object.freeze(records) });
}

function checkedManifest(raw, digest, configDigest) {
  try {
    const proof = validateRemoteManifest(raw, digest);
    const manifest = JSON.parse(raw);
    const manifestTypes = new Set(["application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json"]);
    const configTypes = new Set(["application/vnd.oci.image.config.v1+json",
      "application/vnd.docker.container.image.v1+json"]);
    const layerTypes = new Set(["application/vnd.oci.image.layer.v1.tar+gzip",
      "application/vnd.docker.image.rootfs.diff.tar.gzip"]);
    const layer = manifest?.layers?.[0];
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest) || manifest.schemaVersion !== 2 ||
        !manifestTypes.has(manifest.mediaType) || manifest.config?.digest !== configDigest ||
        !configTypes.has(manifest.config?.mediaType) || !Number.isSafeInteger(manifest.config?.size) ||
        manifest.config.size < 1 || manifest.config.size > MAX_OUTPUT_BYTES || manifest.layers?.length !== 1 ||
        !layerTypes.has(layer?.mediaType) || !DIGEST.test(layer?.digest ?? "") || !Number.isSafeInteger(layer?.size) ||
        layer.size < 1 || layer.size > POSTGRES_PACKAGE_BOOTSTRAP.imageSizeLimit) {
      fail("postgres_package_bootstrap_remote_manifest_invalid");
    }
    return Object.freeze({ ...proof, configDigest });
  }
  catch { fail("postgres_package_bootstrap_remote_manifest_invalid"); }
}

function writeReceipt(output, receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) fail("postgres_package_bootstrap_receipt_too_large");
  writeFileSync(path.join(output, "receipt.json"), serialized, { flag: "wx", mode: 0o600 });
}

export async function runPostgresPackageBootstrap({
  argv = process.argv.slice(2), commandRunner = defaultCommandRunner, env = process.env,
  fetchImpl = globalThis.fetch, now = () => performance.now(), platform = process.platform,
} = {}) {
  const started = now();
  const deadline = started + OPERATION_BUDGET_MS;
  const parsed = parseBootstrapArguments(argv);
  const context = validateBootstrapContext(env, platform);
  validateOutputPath(parsed.output, context.runnerTemp);
  const work = path.join(context.runnerTemp, `aw-postgres-package-bootstrap-${context.runId}-attempt-1`);
  if (existsSync(work)) fail("postgres_package_bootstrap_owned_path_exists");
  mkdirSync(parsed.output, { mode: 0o700 });
  if (lstatSync(parsed.output).isSymbolicLink() || realpathSync(parsed.output) !== parsed.output) {
    fail("postgres_package_bootstrap_output_path_invalid");
  }
  mkdirSync(work, { mode: 0o700 });
  const dockerConfig = path.join(work, "docker-config");
  const buildContext = path.join(work, "context");
  mkdirSync(dockerConfig, { mode: 0o700 });
  mkdirSync(buildContext, { mode: 0o700 });
  const tag = `${POSTGRES_PACKAGE_BOOTSTRAP.image}:bootstrap-${context.runId}`;
  const commandOptions = (cleanup = false) => {
    const remaining = deadline - now() - (cleanup ? 0 : CLEANUP_RESERVE_MS);
    if (!Number.isFinite(remaining) || remaining < 1_000) fail(cleanup
      ? "postgres_package_bootstrap_cleanup_timeout" : "postgres_package_bootstrap_job_timeout");
    return { cwd: work, env: commandEnvironment(env, dockerConfig, work),
      timeout: Math.floor(Math.min(cleanup ? CLEANUP_COMMAND_TIMEOUT_MS : COMMAND_TIMEOUT_MS, remaining)) };
  };
  const receipt = {
    schemaVersion: 1, kind: "POSTGRES_GOSU_PACKAGE_BOOTSTRAP_V1", state: "PREPARING", result: "FAILED",
    publication: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null,
    supportEndsAt: null, archiveUntil: null, forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED",
    packageConfiguration: "NOT_VERIFIED", postWriteGate: "SETTINGS_AND_PRIVATE_READ_CONTROLS_REQUIRED",
    repository: context.repository, image: POSTGRES_PACKAGE_BOOTSTRAP.image, sourceSha: context.sourceSha,
    sourceRef: "refs/heads/main", runId: context.runId, runAttempt: "1",
    payload: { path: `/${POSTGRES_PACKAGE_BOOTSTRAP.payloadPath}`,
      ...identity(Buffer.from(POSTGRES_PACKAGE_BOOTSTRAP.payload)) },
    recipe: { ...identity(Buffer.from(POSTGRES_PACKAGE_BOOTSTRAP.dockerfile)), base: "scratch",
      network: "none", provenance: false, sbom: false,
      labels: { source: POSTGRES_PACKAGE_BOOTSTRAP.sourceUrl, description: POSTGRES_PACKAGE_BOOTSTRAP.description } },
    localInventoryAfter: null, phases: [],
  };
  const phase = async (name, operation) => {
    const phaseStarted = now();
    try {
      commandOptions();
      const value = await operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: Math.max(0, now() - phaseStarted) });
      return value;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: fixedReason(error),
        durationMs: Math.max(0, now() - phaseStarted) });
      throw error;
    }
  };
  let primaryFailure;
  let ownedImage;
  let priorImageIds = new Set();
  let writeAttempted = false;
  let localImageState = "NOT_CHECKED";
  try {
    receipt.tools = await phase("managed_tool_identity", () => ({
      docker: boundedIdentity(run(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], commandOptions()).stdout),
      buildx: boundedIdentity(run(commandRunner, "docker", ["buildx", "version"], commandOptions()).stdout),
      node: process.version,
      trustBoundary: "GITHUB_HOSTED_MANAGED_DOCKER_BUILDKIT",
    }));
    receipt.code = await phase("checkout_and_recipe_identity", () => validateCodeBundle(commandRunner, context, commandOptions()));
    await phase("protected_main_before_login", () => verifyProtectedMain(fetchImpl, context, commandOptions().timeout));
    await phase("local_tag_absent", () => {
      if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", tag], commandOptions()), tag)) {
        fail("postgres_package_bootstrap_local_tag_collision");
      }
    });
    priorImageIds = new Set(await phase("local_inventory_before", () => {
      const ids = readLocalImageIds(commandRunner, commandOptions());
      receipt.localInventoryBefore = identity(Buffer.from(ids.join("\n")));
      return ids;
    }));
    await phase("fixed_scratch_materialization", () => {
      writeFileSync(path.join(buildContext, POSTGRES_PACKAGE_BOOTSTRAP.payloadPath), POSTGRES_PACKAGE_BOOTSTRAP.payload,
        { flag: "wx", mode: 0o600 });
      writeFileSync(path.join(work, "Dockerfile"), POSTGRES_PACKAGE_BOOTSTRAP.dockerfile, { flag: "wx", mode: 0o600 });
    });
    await phase("registry_login", () => run(commandRunner, "docker",
      ["login", "ghcr.io", "--username", POSTGRES_PACKAGE_BOOTSTRAP.owner, "--password-stdin"],
      { ...commandOptions(), input: `${context.token}\n` }));
    await phase("remote_tag_absent", () => remoteTagAbsent(observe(commandRunner, "docker",
      ["buildx", "imagetools", "inspect", "--raw", tag], commandOptions()), tag));
    await phase("protected_main_before_write", () => verifyProtectedMain(fetchImpl, context, commandOptions().timeout));
    const metadataPath = path.join(work, "metadata.json");
    const published = await phase("harmless_first_write", () => {
      receipt.publication = "ATTEMPTED_OUTCOME_UNCONFIRMED";
      writeAttempted = true;
      const pushed = observe(commandRunner, "docker", ["buildx", "build", "--platform", POSTGRES_PACKAGE_BOOTSTRAP.platform,
        "--network=none", "--provenance=false", "--sbom=false", "--push", "--metadata-file", metadataPath,
        "--tag", tag, "--file", path.join(work, "Dockerfile"), buildContext], commandOptions());
      const local = observe(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", tag], commandOptions());
      if (local.error || local.signal) {
        localImageState = "INTERRUPTED";
        fail("postgres_package_bootstrap_local_inventory_ambiguous");
      }
      try {
        if (inspectAbsent(local, tag)) localImageState = "ABSENT";
        else {
          let candidate;
          try { candidate = validateLocalBootstrapImage(local.stdout, tag); }
          catch (error) { localImageState = "INVALID"; throw error; }
          if (priorImageIds.has(candidate.id)) {
            localImageState = "PREEXISTING";
            fail("postgres_package_bootstrap_local_image_preexisting");
          }
          ownedImage = candidate;
          localImageState = "OWNED";
        }
      } catch (error) {
        if (localImageState !== "INVALID") localImageState = "UNCERTAIN";
        throw error;
      }
      if (pushed.error || pushed.signal || pushed.status !== 0) fail("postgres_package_bootstrap_push_outcome_unconfirmed");
      if (!existsSync(metadataPath)) fail("postgres_package_bootstrap_metadata_invalid");
      const info = lstatSync(metadataPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_OUTPUT_BYTES) {
        fail("postgres_package_bootstrap_metadata_invalid");
      }
      let metadata;
      try { metadata = JSON.parse(readFileSync(metadataPath, "utf8")); }
      catch { fail("postgres_package_bootstrap_metadata_invalid"); }
      const result = parsePublishedDigest(metadata);
      if (ownedImage && ownedImage.id !== result.configDigest) fail("postgres_package_bootstrap_local_image_invalid");
      if (localImageState === "ABSENT") {
        const byId = observe(commandRunner, "docker",
          ["image", "inspect", "--format", "{{json .}}", result.configDigest], commandOptions());
        if (byId.error || byId.signal) {
          localImageState = "INTERRUPTED";
          fail("postgres_package_bootstrap_local_inventory_ambiguous");
        }
        if (!inspectAbsent(byId, result.configDigest)) {
          let candidate;
          try { candidate = validateLocalBootstrapImage(byId.stdout, tag, { afterTagRemoval: true }); }
          catch (error) { localImageState = "INVALID"; throw error; }
          if (candidate.id !== result.configDigest) {
            localImageState = "INVALID";
            fail("postgres_package_bootstrap_local_image_invalid");
          }
          if (priorImageIds.has(candidate.id)) localImageState = "PREEXISTING";
          else {
            ownedImage = candidate;
            localImageState = "OWNED";
          }
        }
      }
      return result;
    });
    const rawTag = await phase("remote_tag_manifest", () => {
      const raw = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", tag], commandOptions()).stdout;
      receipt.remoteTagManifest = checkedManifest(raw, published.manifestDigest, published.configDigest);
      return raw;
    });
    const subject = `${POSTGRES_PACKAGE_BOOTSTRAP.image}@${published.manifestDigest}`;
    await phase("remote_digest_manifest", () => {
      const raw = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], commandOptions()).stdout;
      const proof = checkedManifest(raw, published.manifestDigest, published.configDigest);
      if (raw !== rawTag || JSON.stringify(proof) !== JSON.stringify(receipt.remoteTagManifest)) {
        fail("postgres_package_bootstrap_remote_manifest_mismatch");
      }
      receipt.remoteDigestManifest = proof;
    });
    receipt.manifestDigest = published.manifestDigest;
    receipt.configDigest = published.configDigest;
    receipt.subject = subject;
    receipt.state = "PUBLISHED_UNADMITTED";
    receipt.publication = "PUBLISHED_UNADMITTED";
    receipt.result = "PASSED";
  } catch (error) { primaryFailure = error; }

  const cleanupStarted = now();
  const cleanupFailures = [];
  if (localImageState === "INTERRUPTED" || localImageState === "INVALID") {
    cleanupFailures.push("postgres_package_bootstrap_cleanup_uncertain");
  }
  if (writeAttempted && (localImageState === "NOT_CHECKED" || localImageState === "UNCERTAIN")) {
    try {
      const local = observe(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", tag], commandOptions(true));
      if (inspectAbsent(local, tag)) localImageState = "ABSENT";
      else {
        const candidate = validateLocalBootstrapImage(local.stdout, tag);
        if (priorImageIds.has(candidate.id)) {
          localImageState = "PREEXISTING";
          cleanupFailures.push("postgres_package_bootstrap_cleanup_uncertain");
        } else {
          ownedImage = candidate;
          localImageState = "OWNED";
        }
      }
    } catch {
      localImageState = "UNCERTAIN";
      cleanupFailures.push("postgres_package_bootstrap_cleanup_uncertain");
    }
  }
  if (writeAttempted) {
    try {
      const currentIds = readLocalImageIds(commandRunner, commandOptions(true));
      const additionalIds = currentIds.filter((id) => !priorImageIds.has(id));
      if (ownedImage) {
        if (additionalIds.length !== 1 || additionalIds[0] !== ownedImage.id) {
          ownedImage = undefined;
          localImageState = "UNCERTAIN";
          cleanupFailures.push("postgres_package_bootstrap_cleanup_uncertain");
        }
      } else if (additionalIds.length !== 0) {
        localImageState = "UNCERTAIN";
        cleanupFailures.push("postgres_package_bootstrap_cleanup_uncertain");
      }
      receipt.localInventoryAfter = identity(Buffer.from(currentIds.join("\n")));
    } catch {
      ownedImage = undefined;
      localImageState = "UNCERTAIN";
      cleanupFailures.push("postgres_package_bootstrap_cleanup_uncertain");
    }
  }
  if (ownedImage) {
    try {
      if (ownedImage.tags.length === 1) {
        run(commandRunner, "docker", ["image", "rm", tag], commandOptions(true));
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", tag], commandOptions(true)), tag)) {
          fail("postgres_package_bootstrap_local_cleanup_failed");
        }
      }
      const byId = observe(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", ownedImage.id], commandOptions(true));
      if (!inspectAbsent(byId, ownedImage.id)) {
        validateLocalBootstrapImage(byId.stdout, tag, { afterTagRemoval: true });
        run(commandRunner, "docker", ["image", "rm", ownedImage.id], commandOptions(true));
        if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", ownedImage.id], commandOptions(true)), ownedImage.id)) {
          fail("postgres_package_bootstrap_local_cleanup_failed");
        }
      }
      receipt.localImageCleanup = { state: "REMOVED", id: ownedImage.id };
      try {
        const finalIds = readLocalImageIds(commandRunner, commandOptions(true));
        receipt.localInventoryAfter = identity(Buffer.from(finalIds.join("\n")));
        if (!sameImageIds(finalIds, [...priorImageIds])) fail("postgres_package_bootstrap_local_cleanup_failed");
      } catch (error) { fail(fixedReason(error)); }
    } catch (error) {
      cleanupFailures.push(fixedReason(error));
      receipt.localImageCleanup = { state: "FAILED", id: ownedImage.id };
    }
  } else if (["UNCERTAIN", "INTERRUPTED", "INVALID"].includes(localImageState)) {
    receipt.localImageCleanup = { state: "UNCERTAIN" };
  } else if (localImageState === "PREEXISTING") receipt.localImageCleanup = { state: "PREEXISTING_NOT_REMOVED" };
  else receipt.localImageCleanup = { state: writeAttempted ? "ABSENT" : "NOT_CREATED" };
  try {
    if (!existsSync(work) || lstatSync(work).isSymbolicLink() || realpathSync(work) !== work ||
        path.dirname(work) !== context.runnerTemp) fail("postgres_package_bootstrap_cleanup_path_invalid");
    rmSync(work, { recursive: true, force: false });
  } catch (error) { cleanupFailures.push(fixedReason(error)); }
  receipt.phases.push({ name: "owned_cleanup", result: cleanupFailures.length === 0 ? "PASSED" : "FAILED",
    ...(cleanupFailures.length ? { reason: cleanupFailures[0] } : {}), durationMs: Math.max(0, now() - cleanupStarted) });
  if (cleanupFailures.length) receipt.result = "FAILED";
  writeReceipt(parsed.output, receipt);
  if (primaryFailure) throw new Error(fixedReason(primaryFailure));
  if (cleanupFailures.length) throw new Error(cleanupFailures[0]);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { await runPostgresPackageBootstrap(); }
  catch (error) {
    console.error(`postgres_package_bootstrap_failed:${fixedReason(error)}`);
    process.exitCode = 1;
  }
}
