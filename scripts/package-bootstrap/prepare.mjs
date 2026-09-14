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

const MiB = 1024 * 1024;
const MAX_COMMAND_OUTPUT = MiB;
const MAX_ARTIFACT_BYTES = 8 * MiB;
const COMMAND_TIMEOUT_MS = 120_000;

export const BOOTSTRAP = Object.freeze({
  repository: "CleMeY15/auto-world",
  sourceUrl: "https://github.com/CleMeY15/auto-world",
  platform: "linux/amd64",
  payload: "auto-world-private-package-boundary-v1\n",
  dockerfile: [
    "FROM scratch",
    "COPY proof.txt /proof.txt",
    'LABEL org.opencontainers.image.source="https://github.com/CleMeY15/auto-world"',
    "",
  ].join("\n"),
  imageSizeLimit: MiB,
  payloadSizeLimit: 1024,
});

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== "--output" || !path.isAbsolute(argv[1])) {
    throw new Error("package_bootstrap_arguments_invalid");
  }
  return { output: path.resolve(argv[1]) };
}

export function validatePreparationContext(env, platform = process.platform) {
  const eventName = env.GITHUB_EVENT_NAME ?? "";
  const ref = env.GITHUB_REF ?? "";
  const permittedEvent = eventName === "pull_request" ||
    ((eventName === "push" || eventName === "workflow_dispatch") && ref === "refs/heads/main");
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux") {
    throw new Error("package_bootstrap_requires_linux_actions");
  }
  if (env.GITHUB_REPOSITORY !== BOOTSTRAP.repository || !permittedEvent) {
    throw new Error("package_bootstrap_context_invalid");
  }
  if (!/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "") || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? "") || env.GITHUB_RUN_ATTEMPT !== "1") {
    throw new Error("package_bootstrap_identity_invalid");
  }
  if (typeof env.RUNNER_TEMP !== "string" || !path.isAbsolute(env.RUNNER_TEMP)) {
    throw new Error("package_bootstrap_runner_temp_invalid");
  }
  return {
    eventName,
    ref,
    repository: env.GITHUB_REPOSITORY,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runId: env.GITHUB_RUN_ID,
    runnerTemp: path.resolve(env.RUNNER_TEMP),
    sourceSha: env.GITHUB_SHA,
  };
}

export function validateOutputPath(output, runnerTemp) {
  const root = path.resolve(runnerTemp);
  const target = path.resolve(output);
  const relative = path.relative(root, target);
  if (path.basename(target) !== "package-bootstrap" || path.dirname(target) !== root || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("package_bootstrap_output_path_invalid");
  }
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) {
    throw new Error("package_bootstrap_runner_temp_invalid");
  }
  if (existsSync(target)) throw new Error("package_bootstrap_owned_path_exists");
  return target;
}

export function validateLocalImageId(value) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error("package_bootstrap_local_image_id_invalid");
  }
  return { type: "DOCKER_CONFIG_ID", value };
}

export function validateImageMetadata(metadata) {
  const localImageIdentity = validateLocalImageId(metadata?.Id);
  if (metadata?.Os !== "linux" || metadata?.Architecture !== "amd64") {
    throw new Error("package_bootstrap_image_platform_invalid");
  }
  if (!Number.isSafeInteger(metadata?.Size) || metadata.Size < 1 || metadata.Size > BOOTSTRAP.imageSizeLimit) {
    throw new Error("package_bootstrap_image_size_invalid");
  }
  if (metadata?.Config?.Labels?.["org.opencontainers.image.source"] !== BOOTSTRAP.sourceUrl) {
    throw new Error("package_bootstrap_image_source_invalid");
  }
  return {
    architecture: metadata.Architecture,
    localImageIdentity,
    os: metadata.Os,
    size: metadata.Size,
    source: metadata.Config.Labels["org.opencontainers.image.source"],
  };
}

export function assertPayloadIntegrity(actual, expected = Buffer.from(BOOTSTRAP.payload, "utf8")) {
  if (!Buffer.isBuffer(actual) || actual.length < 1 || actual.length > BOOTSTRAP.payloadSizeLimit || !actual.equals(expected)) {
    throw new Error("package_bootstrap_payload_integrity_failed");
  }
  return { sha256: sha256(actual), size: actual.length };
}

export function parseBuildKitVersions(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_COMMAND_OUTPUT) {
    throw new Error("package_bootstrap_buildkit_identity_invalid");
  }
  const versions = [...value.matchAll(/^\s*BuildKit:\s*(\S+)\s*$/gmu)].map((match) => match[1]);
  if (versions.length < 1 || versions.some((version) => !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version))) {
    throw new Error("package_bootstrap_buildkit_identity_invalid");
  }
  return versions;
}

function safeReason(error) {
  const message = error instanceof Error ? error.message : "package_bootstrap_unknown_failure";
  return /^package_bootstrap_[a-z0-9_]+$/u.test(message) ? message : "package_bootstrap_command_failed";
}

function commandEnvironment(env, temporaryDirectory) {
  const permitted = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "XDG_CONFIG_HOME"];
  const clean = { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TMPDIR: temporaryDirectory, TZ: "UTC" };
  for (const name of permitted) if (typeof env[name] === "string") clean[name] = env[name];
  return clean;
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    maxBuffer: MAX_COMMAND_OUTPUT,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
}

function runCommand(commandRunner, command, args, options, expectedStatuses = [0]) {
  const result = commandRunner(command, args, options);
  if (result?.error || !expectedStatuses.includes(result?.status)) throw new Error("package_bootstrap_command_failed");
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_COMMAND_OUTPUT) throw new Error("package_bootstrap_command_output_exceeded");
  return { status: result.status, stdout };
}

function boundedVersion(value) {
  const version = value.trim();
  if (version.length < 1 || version.length > 512 || /[^\x20-\x7e]/u.test(version)) {
    throw new Error("package_bootstrap_tool_version_invalid");
  }
  return version;
}

function directoryBytes(directory) {
  let bytes = 0;
  for (const name of ["proof.txt", "Dockerfile", "receipt.json"]) {
    const file = path.join(directory, name);
    if (existsSync(file)) {
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("package_bootstrap_artifact_invalid");
      bytes += info.size;
    }
  }
  if (bytes > MAX_ARTIFACT_BYTES) throw new Error("package_bootstrap_artifact_budget_exceeded");
  return bytes;
}

export function prepareBootstrap({
  argv = process.argv.slice(2),
  commandRunner = defaultCommandRunner,
  env = process.env,
  platform = process.platform,
} = {}) {
  const context = validatePreparationContext(env, platform);
  const { output: requestedOutput } = parseArguments(argv);
  const output = validateOutputPath(requestedOutput, context.runnerTemp);
  const work = path.join(context.runnerTemp, `aw-package-bootstrap-${context.runId}-attempt-1`);
  if (existsSync(work)) throw new Error("package_bootstrap_owned_path_exists");

  const buildContext = path.join(work, "context");
  const payload = Buffer.from(BOOTSTRAP.payload, "utf8");
  const dockerfile = Buffer.from(BOOTSTRAP.dockerfile, "utf8");
  mkdirSync(output);

  const tag = `auto-world-bootstrap-preflight:run-${context.runId}`;
  const container = `aw-package-bootstrap-${context.runId}`;
  const commandOptions = { cwd: work, env: commandEnvironment(env, work) };
  const receipt = {
    schemaVersion: 1,
    state: "LOCAL_PREPARATION_ONLY",
    result: "FAILED",
    publication: "NOT_ATTEMPTED",
    packageConfiguration: "NOT_VERIFIED",
    forkAccessTest: "SKIPPED_BY_USER",
    forkIsolation: "NOT_VERIFIED",
    repository: context.repository,
    platform: BOOTSTRAP.platform,
    sourceSha: context.sourceSha,
    runId: context.runId,
    runAttempt: context.runAttempt,
    eventName: context.eventName,
    sourceRef: context.ref,
    payload: { sha256: sha256(payload), size: payload.length },
    recipe: { sha256: sha256(dockerfile), size: dockerfile.length },
    phases: [],
  };
  const phase = (name, operation) => {
    const started = Date.now();
    try {
      const value = operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: Date.now() - started });
      return value;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: safeReason(error), durationMs: Date.now() - started });
      throw error;
    }
  };

  let primaryFailure;
  let containerCreated = false;
  let imageBuilt = false;
  try {
    if (payload.length > BOOTSTRAP.payloadSizeLimit) throw new Error("package_bootstrap_payload_too_large");
    phase("context_materialization", () => {
      mkdirSync(work);
      mkdirSync(buildContext);
      writeFileSync(path.join(buildContext, "proof.txt"), payload, { flag: "wx" });
      writeFileSync(path.join(work, "Dockerfile"), dockerfile, { flag: "wx" });
      writeFileSync(path.join(output, "proof.txt"), payload, { flag: "wx" });
      writeFileSync(path.join(output, "Dockerfile"), dockerfile, { flag: "wx" });
    });
    receipt.tools = phase("managed_tool_identity", () => {
      const docker = runCommand(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], commandOptions).stdout;
      const buildx = runCommand(commandRunner, "docker", ["buildx", "version"], commandOptions).stdout;
      return { docker: boundedVersion(docker), buildx: boundedVersion(buildx), trustBoundary: "MANAGED_DOCKER_BUILDKIT" };
    });
    phase("collision_check", () => {
      const image = runCommand(commandRunner, "docker", ["image", "inspect", tag], commandOptions, [0, 1]);
      const existingContainer = runCommand(commandRunner, "docker", ["container", "inspect", container], commandOptions, [0, 1]);
      if (image.status === 0 || existingContainer.status === 0) throw new Error("package_bootstrap_docker_object_exists");
    });
    phase("image_build", () => {
      runCommand(commandRunner, "docker", [
        "buildx", "build", "--platform", BOOTSTRAP.platform, "--network=none", "--provenance=false", "--sbom=false", "--load",
        "--tag", tag, "--file", path.join(work, "Dockerfile"), buildContext,
      ], commandOptions);
      imageBuilt = true;
    });
    receipt.tools.buildKitBackendVersions = phase("buildkit_backend_identity", () => {
      const inspect = runCommand(commandRunner, "docker", ["buildx", "inspect"], commandOptions).stdout;
      return parseBuildKitVersions(inspect);
    });
    receipt.image = phase("image_inspect", () => {
      const raw = runCommand(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", tag], commandOptions).stdout;
      let metadata;
      try { metadata = JSON.parse(raw); } catch { throw new Error("package_bootstrap_image_metadata_invalid"); }
      return validateImageMetadata(metadata);
    });
    phase("stopped_container_create", () => {
      runCommand(commandRunner, "docker", ["create", "--name", container, "--pull=never", tag, "/proof.txt"], commandOptions);
      containerCreated = true;
    });
    receipt.copiedPayload = phase("stopped_container_copy", () => {
      const copied = path.join(work, "copied-proof.txt");
      runCommand(commandRunner, "docker", ["cp", `${container}:/proof.txt`, copied], commandOptions);
      const info = lstatSync(copied);
      if (!info.isFile() || info.isSymbolicLink() || info.size > BOOTSTRAP.payloadSizeLimit) throw new Error("package_bootstrap_payload_integrity_failed");
      return assertPayloadIntegrity(readFileSync(copied), payload);
    });
    receipt.result = "PASSED";
  } catch (error) {
    primaryFailure = error;
  }

  const cleanupFailures = [];
  const cleanupStarted = Date.now();
  if (containerCreated) {
    try { runCommand(commandRunner, "docker", ["rm", container], commandOptions); } catch (error) { cleanupFailures.push(safeReason(error)); }
  }
  if (imageBuilt) {
    try { runCommand(commandRunner, "docker", ["image", "rm", tag], commandOptions); } catch (error) { cleanupFailures.push(safeReason(error)); }
  }
  try {
    if (existsSync(work)) {
      if (lstatSync(work).isSymbolicLink() || path.dirname(path.resolve(work)) !== context.runnerTemp) {
        throw new Error("package_bootstrap_cleanup_path_invalid");
      }
      rmSync(work, { recursive: true, force: false });
    }
  } catch (error) {
    cleanupFailures.push(safeReason(error));
  }
  receipt.phases.push({
    name: "cleanup",
    result: cleanupFailures.length === 0 ? "PASSED" : "FAILED",
    ...(cleanupFailures.length === 0 ? {} : { reason: cleanupFailures[0] }),
    durationMs: Date.now() - cleanupStarted,
  });
  if (cleanupFailures.length > 0) receipt.result = "FAILED";
  receipt.artifactBytesBeforeReceipt = directoryBytes(output);
  writeFileSync(path.join(output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  const finalBytes = directoryBytes(output);
  if (finalBytes > MAX_ARTIFACT_BYTES) throw new Error("package_bootstrap_artifact_budget_exceeded");
  if (primaryFailure) throw new Error(safeReason(primaryFailure));
  if (cleanupFailures.length > 0) throw new Error(cleanupFailures[0]);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    prepareBootstrap();
  } catch (error) {
    console.error(`package_bootstrap_failed:${safeReason(error)}`);
    process.exitCode = 1;
  }
}
