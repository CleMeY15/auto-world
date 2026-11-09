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
import { parsePublishedDigest, validateRemoteManifest } from "../package-bootstrap/registry-proof.mjs";
import { parseBuildKitVersions } from "../package-bootstrap/prepare.mjs";
import { SCANNER_RETENTION, canonicalJsonBytes, sha256 } from "./retention-policy.mjs";

const REVISION = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
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

function fixedReason(error) {
  const message = error instanceof Error ? error.message : "scanner_retention_bootstrap_unknown_failure";
  return /^scanner_retention_(?:bootstrap|mode|arguments)_[a-z0-9_]+$/u.test(message)
    ? message
    : "scanner_retention_bootstrap_command_failed";
}

export function parseScannerRetentionArguments(argv) {
  if (argv[0] === "read-proof" || argv[0] === "publish") fail("scanner_retention_mode_not_implemented");
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
    timeout: SCANNER_RETENTION.bootstrap.commandTimeoutMs,
    windowsHide: true,
  });
}

function observe(commandRunner, command, args, options) {
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > SCANNER_RETENTION.bootstrap.commandOutputCapBytes) {
    fail("scanner_retention_bootstrap_command_output_exceeded");
  }
  return { error: result?.error, status: result?.status, stdout, stderr };
}

function run(commandRunner, command, args, options, expectedStatuses = [0]) {
  const result = observe(commandRunner, command, args, options);
  if (result.error || !expectedStatuses.includes(result.status)) fail("scanner_retention_bootstrap_command_failed");
  return result;
}

function boundedIdentity(value) {
  const result = value.trim();
  if (result.length < 1 || result.length > 512 || /[^\x20-\x7e]/u.test(result)) {
    fail("scanner_retention_bootstrap_tool_identity_invalid");
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
      if (!inspectAbsent(observe(commandRunner, "docker", ["image", "inspect", tag], options))) {
        fail("scanner_retention_bootstrap_local_image_retained");
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

async function main() {
  return executeBootstrap({
    argv: process.argv.slice(2),
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
    console.error(`scanner_retention_bootstrap_failed:${fixedReason(error)}`);
    process.exitCode = 1;
  }
}
