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
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const MiB = 1024 * 1024;
const MAX_OUTPUT_BYTES = MiB;
const COMMAND_TIMEOUT_MS = 120_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const SEAWEED_PACKAGE_BOOTSTRAP = Object.freeze({
  workflowPath: ".github/workflows/seaweed-package-bootstrap.yml",
  repository: "CleMeY15/auto-world",
  image: "ghcr.io/clemey15/auto-world-seaweedfs-s3",
  owner: "CleMeY15",
  outputDirectory: "seaweed-package-bootstrap",
  mainRefUrl: "https://api.github.com/repos/CleMeY15/auto-world/git/ref/heads/main",
  platform: "linux/amd64",
  payloadPath: "bootstrap.txt",
  payload: "auto-world-seaweedfs-s3-package-bootstrap-v1\n",
  dockerfile: [
    "FROM scratch",
    "LABEL org.opencontainers.image.source=\"https://github.com/CleMeY15/auto-world\"",
    "LABEL org.opencontainers.image.description=\"Harmless Auto World SeaweedFS package bootstrap; not a runtime image\"",
    "COPY bootstrap.txt /bootstrap.txt",
    "",
  ].join("\n"),
});

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixedReason(error) {
  const message = error instanceof Error ? error.message : "seaweed_package_bootstrap_unknown_failure";
  return /^seaweed_package_bootstrap_[a-z0-9_]+$/u.test(message)
    ? message
    : "seaweed_package_bootstrap_command_failed";
}

export function parseBootstrapArguments(argv) {
  if (argv.length === 2 && argv[0] === "--output" && path.isAbsolute(argv[1])) {
    return { output: path.resolve(argv[1]) };
  }
  throw new Error("seaweed_package_bootstrap_arguments_invalid");
}

export function validateBootstrapContext(env, platform = process.platform) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || env.RUNNER_ENVIRONMENT !== "github-hosted") {
    throw new Error("seaweed_package_bootstrap_requires_github_linux");
  }
  if (
    env.GITHUB_REPOSITORY !== SEAWEED_PACKAGE_BOOTSTRAP.repository
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_WORKFLOW_REF !== `${SEAWEED_PACKAGE_BOOTSTRAP.repository}/${SEAWEED_PACKAGE_BOOTSTRAP.workflowPath}@refs/heads/main`
  ) {
    throw new Error("seaweed_package_bootstrap_context_invalid");
  }
  if (
    env.GITHUB_JOB !== "publish"
    || env.GITHUB_RUN_NUMBER !== "1"
    || env.GITHUB_RUN_ATTEMPT !== "1"
    || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? "")
    || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "")
  ) {
    throw new Error("seaweed_package_bootstrap_identity_invalid");
  }
  if (
    typeof env.GITHUB_TOKEN !== "string"
    || env.GITHUB_TOKEN.length === 0
    || !path.isAbsolute(env.RUNNER_TEMP ?? "")
    || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")
  ) {
    throw new Error("seaweed_package_bootstrap_environment_invalid");
  }
  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  const runnerTemp = path.resolve(env.RUNNER_TEMP);
  for (const directory of [workspace, runnerTemp]) {
    if (!existsSync(directory)) throw new Error("seaweed_package_bootstrap_directory_invalid");
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) {
      throw new Error("seaweed_package_bootstrap_directory_invalid");
    }
  }
  return {
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    sourceSha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN,
    workspace,
    runnerTemp,
  };
}

export function parsePublishedDigest(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("seaweed_package_bootstrap_metadata_invalid");
  }
  const digest = metadata["containerimage.digest"];
  if (typeof digest !== "string" || !DIGEST_PATTERN.test(digest)) {
    throw new Error("seaweed_package_bootstrap_digest_invalid");
  }
  return digest;
}

function validateOutputPath(output, context) {
  if (
    path.basename(output) !== SEAWEED_PACKAGE_BOOTSTRAP.outputDirectory
    || path.dirname(output) !== context.runnerTemp
    || existsSync(output)
  ) {
    throw new Error("seaweed_package_bootstrap_output_path_invalid");
  }
}

function commandEnvironment(env, dockerConfig, temporaryDirectory) {
  const clean = {
    DOCKER_CONFIG: dockerConfig,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TMPDIR: temporaryDirectory,
    TZ: "UTC",
  };
  for (const name of ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "XDG_CONFIG_HOME"]) {
    if (typeof env[name] === "string") clean[name] = env[name];
  }
  return clean;
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    input: options.input,
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
}

function run(commandRunner, command, args, options, expectedStatuses = [0]) {
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    throw new Error("seaweed_package_bootstrap_output_exceeded");
  }
  if (result?.error || !expectedStatuses.includes(result?.status)) {
    throw new Error("seaweed_package_bootstrap_command_failed");
  }
  return { status: result.status, stdout, stderr };
}

function boundedIdentity(value) {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512 || /[^\x20-\x7e]/u.test(normalized)) {
    throw new Error("seaweed_package_bootstrap_tool_identity_invalid");
  }
  return normalized;
}

async function verifyProtectedMain(fetchImpl, context) {
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    let response;
    try {
      response = await fetchImpl(SEAWEED_PACKAGE_BOOTSTRAP.mainRefUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${context.token}`,
          "User-Agent": "auto-world-seaweed-package-bootstrap",
        },
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new Error("seaweed_package_bootstrap_main_ref_request_failed");
    }
    if (!response?.ok) throw new Error("seaweed_package_bootstrap_main_ref_request_failed");
    const length = response.headers?.get?.("content-length");
    if (length !== null && length !== undefined && (!/^\d+$/u.test(length) || Number(length) > MAX_OUTPUT_BYTES)) {
      throw new Error("seaweed_package_bootstrap_main_ref_response_invalid");
    }
    if (!response.body?.getReader) throw new Error("seaweed_package_bootstrap_main_ref_response_invalid");
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
        throw new Error("seaweed_package_bootstrap_main_ref_response_invalid");
      }
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("seaweed_package_bootstrap_main_ref_response_invalid");
    }
    if (body?.object?.type !== "commit" || body.object.sha !== context.sourceSha) {
      throw new Error("seaweed_package_bootstrap_main_ref_mismatch");
    }
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function inspectAbsent(result) {
  if (result.status === 1 && /no such (?:image|object)/iu.test(`${result.stdout}\n${result.stderr}`)) return true;
  if (result.status === 0) return false;
  throw new Error("seaweed_package_bootstrap_local_inspect_failed");
}

function writeReceipt(output, receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) throw new Error("seaweed_package_bootstrap_receipt_too_large");
  writeFileSync(path.join(output, "receipt.json"), serialized, { flag: "wx", mode: 0o600 });
}

export async function runSeaweedPackageBootstrap({
  argv = process.argv.slice(2),
  commandRunner = defaultCommandRunner,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  platform = process.platform,
} = {}) {
  const started = now();
  const parsed = parseBootstrapArguments(argv);
  const context = validateBootstrapContext(env, platform);
  validateOutputPath(parsed.output, context);
  const work = path.join(context.runnerTemp, `aw-seaweed-package-bootstrap-${context.runId}-attempt-1`);
  if (existsSync(work)) throw new Error("seaweed_package_bootstrap_owned_path_exists");
  mkdirSync(parsed.output, { mode: 0o700 });
  mkdirSync(work, { mode: 0o700 });
  const dockerConfig = path.join(work, "docker-config");
  const buildContext = path.join(work, "context");
  mkdirSync(dockerConfig, { mode: 0o700 });
  mkdirSync(buildContext, { mode: 0o700 });
  const tag = `${SEAWEED_PACKAGE_BOOTSTRAP.image}:bootstrap-${context.runId}`;
  const options = { cwd: work, env: commandEnvironment(env, dockerConfig, work) };
  const receipt = {
    schemaVersion: 1,
    state: "PREPARING",
    result: "FAILED",
    publication: "NOT_ATTEMPTED",
    admission: "NOT_AUTHORIZED",
    packageConfiguration: "NOT_VERIFIED",
    postWriteGate: "AUTHENTICATED_SETTINGS_AND_REMOTE_READ_CONTROLS_REQUIRED",
    forkAccessTest: "SKIPPED_BY_USER",
    forkIsolation: "NOT_VERIFIED",
    repository: context.repository,
    image: SEAWEED_PACKAGE_BOOTSTRAP.image,
    sourceSha: context.sourceSha,
    sourceRef: "refs/heads/main",
    runId: context.runId,
    runAttempt: "1",
    payload: {
      path: `/${SEAWEED_PACKAGE_BOOTSTRAP.payloadPath}`,
      sha256: sha256(Buffer.from(SEAWEED_PACKAGE_BOOTSTRAP.payload)),
      size: Buffer.byteLength(SEAWEED_PACKAGE_BOOTSTRAP.payload),
    },
    recipe: {
      sha256: sha256(Buffer.from(SEAWEED_PACKAGE_BOOTSTRAP.dockerfile)),
      size: Buffer.byteLength(SEAWEED_PACKAGE_BOOTSTRAP.dockerfile),
      base: "scratch",
      network: "none",
      provenance: false,
      sbom: false,
    },
    phases: [],
  };
  const phase = async (name, operation) => {
    if (now() - started > JOB_TIMEOUT_MS) throw new Error("seaweed_package_bootstrap_job_timeout");
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
  try {
    receipt.tools = await phase("managed_tool_identity", () => ({
      docker: boundedIdentity(run(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], options).stdout),
      buildx: boundedIdentity(run(commandRunner, "docker", ["buildx", "version"], options).stdout),
      trustBoundary: "MANAGED_DOCKER_BUILDKIT",
    }));
    await phase("checkout_identity", () => {
      const head = run(commandRunner, "git", ["rev-parse", "HEAD"], { ...options, cwd: context.workspace }).stdout.trim();
      if (head !== context.sourceSha) throw new Error("seaweed_package_bootstrap_checkout_mismatch");
    });
    await phase("protected_main_identity", () => verifyProtectedMain(fetchImpl, context));
    await phase("local_collision_check", () => {
      if (!inspectAbsent(run(commandRunner, "docker", ["image", "inspect", tag], options, [0, 1]))) {
        throw new Error("seaweed_package_bootstrap_local_collision");
      }
    });
    await phase("fixed_scratch_materialization", () => {
      writeFileSync(path.join(buildContext, SEAWEED_PACKAGE_BOOTSTRAP.payloadPath), SEAWEED_PACKAGE_BOOTSTRAP.payload, { flag: "wx", mode: 0o600 });
      writeFileSync(path.join(work, "Dockerfile"), SEAWEED_PACKAGE_BOOTSTRAP.dockerfile, { flag: "wx", mode: 0o600 });
    });
    await phase("registry_login", () => {
      run(commandRunner, "docker", ["login", "ghcr.io", "--username", SEAWEED_PACKAGE_BOOTSTRAP.owner, "--password-stdin"], {
        ...options,
        input: `${context.token}\n`,
      });
    });
    const metadataPath = path.join(work, "metadata.json");
    const manifestDigest = await phase("harmless_first_write", () => {
      receipt.publication = "ATTEMPTED_OUTCOME_UNCONFIRMED";
      run(commandRunner, "docker", [
        "buildx", "build",
        "--platform", SEAWEED_PACKAGE_BOOTSTRAP.platform,
        "--network=none",
        "--provenance=false",
        "--sbom=false",
        "--push",
        "--metadata-file", metadataPath,
        "--tag", tag,
        "--file", path.join(work, "Dockerfile"),
        buildContext,
      ], options);
      if (!existsSync(metadataPath)) throw new Error("seaweed_package_bootstrap_metadata_invalid");
      const info = lstatSync(metadataPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_OUTPUT_BYTES) {
        throw new Error("seaweed_package_bootstrap_metadata_invalid");
      }
      let metadata;
      try {
        metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      } catch {
        throw new Error("seaweed_package_bootstrap_metadata_invalid");
      }
      return parsePublishedDigest(metadata);
    });
    receipt.manifestDigest = manifestDigest;
    receipt.subject = `${SEAWEED_PACKAGE_BOOTSTRAP.image}@${manifestDigest}`;
    receipt.state = "PUBLISHED_UNADMITTED";
    receipt.publication = "PUBLISHED_UNADMITTED";
    await phase("no_local_image_retained", () => {
      if (!inspectAbsent(run(commandRunner, "docker", ["image", "inspect", tag], options, [0, 1]))) {
        throw new Error("seaweed_package_bootstrap_local_image_retained");
      }
    });
    receipt.result = "PASSED";
  } catch (error) {
    primaryFailure = error;
  }

  const cleanupStarted = now();
  let cleanupFailure;
  try {
    if (
      !existsSync(work)
      || lstatSync(work).isSymbolicLink()
      || realpathSync(work) !== work
      || path.dirname(work) !== context.runnerTemp
    ) {
      throw new Error("seaweed_package_bootstrap_cleanup_path_invalid");
    }
    rmSync(work, { recursive: true, force: false });
  } catch (error) {
    cleanupFailure = error;
  }
  receipt.phases.push({
    name: "owned_temporary_cleanup",
    result: cleanupFailure ? "FAILED" : "PASSED",
    ...(cleanupFailure ? { reason: fixedReason(cleanupFailure) } : {}),
    durationMs: now() - cleanupStarted,
  });
  if (cleanupFailure) receipt.result = "FAILED";
  writeReceipt(parsed.output, receipt);
  if (primaryFailure) throw new Error(fixedReason(primaryFailure));
  if (cleanupFailure) throw new Error(fixedReason(cleanupFailure));
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    await runSeaweedPackageBootstrap();
  } catch (error) {
    console.error(`seaweed_package_bootstrap_failed:${fixedReason(error)}`);
    process.exitCode = 1;
  }
}
