import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  classifyAnonymousRemoteRead,
  parsePublishedDigest,
  validateRemoteManifest,
} from "../package-bootstrap/registry-proof.mjs";
import { parseBuildKitVersions } from "../package-bootstrap/prepare.mjs";
import { SCANNER_RETENTION, canonicalJsonBytes, sha256 } from "./retention-policy.mjs";

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
  return /^scanner_retention_(?:bootstrap|read_proof|mode|arguments)_[a-z0-9_]+$/u.test(message)
    ? message
    : fallback;
}

const fixedReadReason = (error) => fixedReason(error, "scanner_retention_read_proof_command_failed");

export function parseScannerRetentionArguments(argv) {
  if (argv.length === 3 && argv[0] === "read-proof" && argv[1] === "--output" && path.isAbsolute(argv[2])) {
    return { mode: "read-proof", output: path.resolve(argv[2]) };
  }
  if (argv[0] === "publish") fail("scanner_retention_mode_not_implemented");
  if (argv.length === 3 && argv[0] === "bootstrap" && argv[1] === "--output" && path.isAbsolute(argv[2])) {
    return { mode: "bootstrap", output: path.resolve(argv[2]) };
  }
  fail("scanner_retention_arguments_invalid");
}

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
    const operation = process.argv[2] === "read-proof" ? "read_proof" : "bootstrap";
    const reason = operation === "read_proof" ? fixedReadReason(error) : fixedReason(error);
    console.error(`scanner_retention_${operation}_failed:${reason}`);
    process.exitCode = 1;
  }
}
