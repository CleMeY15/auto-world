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
const MAX_OUTPUT_BYTES = MiB;
const COMMAND_TIMEOUT_MS = 120_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const SEAWEED_PACKAGE_PRIVATE_READ = Object.freeze({
  workflowPath: ".github/workflows/seaweed-package-bootstrap.yml",
  repository: "CleMeY15/auto-world",
  image: "ghcr.io/clemey15/auto-world-seaweedfs-s3",
  owner: "CleMeY15",
  outputDirectory: "seaweed-package-private-read",
  platform: "linux/amd64",
  digest: "sha256:2ac4a586d6b419247314e639b0ee777a549e91b6c6040ca01a218d4bb877338a",
  payloadPath: "bootstrap.txt",
  payload: "auto-world-seaweedfs-s3-package-bootstrap-v1\n",
  sourceUrl: "https://github.com/CleMeY15/auto-world",
  description: "Harmless Auto World SeaweedFS package bootstrap; not a runtime image",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixedReason(error) {
  const message = error instanceof Error ? error.message : "seaweed_package_private_read_unknown_failure";
  return /^seaweed_package_private_read_[a-z0-9_]+$/u.test(message)
    ? message
    : "seaweed_package_private_read_command_failed";
}

export function parsePrivateReadArguments(argv) {
  if (argv.length === 2 && argv[0] === "--output" && path.isAbsolute(argv[1])) {
    return { output: path.resolve(argv[1]) };
  }
  throw new Error("seaweed_package_private_read_arguments_invalid");
}

export function validatePrivateReadContext(env, platform = process.platform) {
  if (
    platform !== "linux"
    || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_OS !== "Linux"
    || env.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    throw new Error("seaweed_package_private_read_requires_github_linux");
  }
  if (
    env.GITHUB_REPOSITORY !== SEAWEED_PACKAGE_PRIVATE_READ.repository
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_WORKFLOW_REF !== `${SEAWEED_PACKAGE_PRIVATE_READ.repository}/${SEAWEED_PACKAGE_PRIVATE_READ.workflowPath}@refs/heads/main`
  ) {
    throw new Error("seaweed_package_private_read_context_invalid");
  }
  if (
    env.GITHUB_JOB !== "verify"
    || env.GITHUB_RUN_NUMBER !== "2"
    || env.GITHUB_RUN_ATTEMPT !== "1"
    || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? "")
    || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "")
  ) {
    throw new Error("seaweed_package_private_read_identity_invalid");
  }
  if (
    typeof env.GITHUB_TOKEN !== "string"
    || env.GITHUB_TOKEN.length === 0
    || !path.isAbsolute(env.RUNNER_TEMP ?? "")
    || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")
  ) {
    throw new Error("seaweed_package_private_read_environment_invalid");
  }
  const runnerTemp = path.resolve(env.RUNNER_TEMP);
  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  for (const directory of [runnerTemp, workspace]) {
    if (!existsSync(directory)) throw new Error("seaweed_package_private_read_directory_invalid");
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== directory) {
      throw new Error("seaweed_package_private_read_directory_invalid");
    }
  }
  return {
    repository: env.GITHUB_REPOSITORY,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runId: env.GITHUB_RUN_ID,
    runNumber: env.GITHUB_RUN_NUMBER,
    runnerTemp,
    sourceSha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN,
    workspace,
  };
}

function validateOutputPath(output, context) {
  if (
    path.basename(output) !== SEAWEED_PACKAGE_PRIVATE_READ.outputDirectory
    || path.dirname(output) !== context.runnerTemp
    || existsSync(output)
  ) {
    throw new Error("seaweed_package_private_read_output_path_invalid");
  }
}

function commandEnvironment(env, dockerConfig, temporaryDirectory) {
  const clean = {
    BUILDX_CONFIG: path.join(dockerConfig, "buildx"),
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

function observeCommand(commandRunner, command, args, options) {
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    throw new Error("seaweed_package_private_read_output_exceeded");
  }
  return { error: result?.error, status: result?.status, stdout, stderr };
}

function run(commandRunner, command, args, options, expectedStatuses = [0]) {
  const result = observeCommand(commandRunner, command, args, options);
  if (result.error || !expectedStatuses.includes(result.status)) {
    throw new Error("seaweed_package_private_read_command_failed");
  }
  return result;
}

function boundedIdentity(value) {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512 || /[^\x20-\x7e]/u.test(normalized)) {
    throw new Error("seaweed_package_private_read_tool_identity_invalid");
  }
  return normalized;
}

export function classifyAnonymousRemoteRead(result) {
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  if (Buffer.byteLength(combined) > MAX_OUTPUT_BYTES) {
    throw new Error("seaweed_package_private_read_anonymous_remote_error");
  }
  if (result?.status === 0) throw new Error("seaweed_package_private_read_anonymous_remote_succeeded");
  if (
    result?.error
    || result?.status !== 1
    || /(dial tcp|no such host|network|timed? out|timeout|tls|certificate|connection refused|connection reset|temporary failure)/u.test(combined)
  ) {
    throw new Error("seaweed_package_private_read_anonymous_remote_error");
  }
  if (/(unauthorized|authentication required|requested access.*denied|denied:\s*(?:denied|.*permission))/u.test(combined)) {
    return "AUTHORIZATION_DENIED";
  }
  throw new Error("seaweed_package_private_read_anonymous_remote_error");
}

export function validateRemoteManifest(raw, expectedDigest = SEAWEED_PACKAGE_PRIVATE_READ.digest) {
  if (typeof raw !== "string") throw new Error("seaweed_package_private_read_manifest_invalid");
  const bytes = Buffer.from(raw, "utf8");
  if (
    bytes.length === 0
    || bytes.length > MAX_OUTPUT_BYTES
    || !DIGEST_PATTERN.test(expectedDigest)
    || `sha256:${sha256(bytes)}` !== expectedDigest
  ) {
    throw new Error("seaweed_package_private_read_manifest_invalid");
  }
  return { sha256: expectedDigest, size: bytes.length };
}

function inspectAbsent(result, kind) {
  if (result.status === 0) return false;
  const pattern = kind === "image" ? /no such (?:image|object)/iu : /no such container/iu;
  if (result.status === 1 && pattern.test(`${result.stdout}\n${result.stderr}`)) return true;
  throw new Error("seaweed_package_private_read_local_inspect_failed");
}

function validateImageMetadata(raw, subject) {
  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    throw new Error("seaweed_package_private_read_image_metadata_invalid");
  }
  if (!DIGEST_PATTERN.test(metadata?.Id ?? "") || metadata.Id === SEAWEED_PACKAGE_PRIVATE_READ.digest) {
    throw new Error("seaweed_package_private_read_image_identity_invalid");
  }
  if (metadata?.Os !== "linux" || metadata?.Architecture !== "amd64") {
    throw new Error("seaweed_package_private_read_image_platform_invalid");
  }
  if (!Number.isSafeInteger(metadata?.Size) || metadata.Size < 1 || metadata.Size > MiB) {
    throw new Error("seaweed_package_private_read_image_size_invalid");
  }
  if (!Array.isArray(metadata?.RepoDigests) || !metadata.RepoDigests.includes(subject)) {
    throw new Error("seaweed_package_private_read_repo_digest_invalid");
  }
  const labels = metadata?.Config?.Labels;
  if (
    labels?.["org.opencontainers.image.source"] !== SEAWEED_PACKAGE_PRIVATE_READ.sourceUrl
    || labels?.["org.opencontainers.image.description"] !== SEAWEED_PACKAGE_PRIVATE_READ.description
  ) {
    throw new Error("seaweed_package_private_read_image_labels_invalid");
  }
  return {
    architecture: metadata.Architecture,
    localImageIdentity: { type: "DOCKER_CONFIG_ID", value: metadata.Id },
    os: metadata.Os,
    repoDigest: subject,
    size: metadata.Size,
    source: labels["org.opencontainers.image.source"],
    description: labels["org.opencontainers.image.description"],
  };
}

function validatePayload(file) {
  const info = lstatSync(file);
  const expected = Buffer.from(SEAWEED_PACKAGE_PRIVATE_READ.payload, "utf8");
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) {
    throw new Error("seaweed_package_private_read_payload_invalid");
  }
  const actual = readFileSync(file);
  if (!actual.equals(expected)) throw new Error("seaweed_package_private_read_payload_invalid");
  return { path: `/${SEAWEED_PACKAGE_PRIVATE_READ.payloadPath}`, sha256: sha256(actual), size: actual.length };
}

function writeReceipt(output, receipt) {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_OUTPUT_BYTES) {
    throw new Error("seaweed_package_private_read_receipt_too_large");
  }
  writeFileSync(path.join(output, "receipt.json"), serialized, { flag: "wx", mode: 0o600 });
}

export async function runSeaweedPackagePrivateRead({
  argv = process.argv.slice(2),
  commandRunner = defaultCommandRunner,
  env = process.env,
  manifestValidator = validateRemoteManifest,
  now = Date.now,
  platform = process.platform,
} = {}) {
  const started = now();
  const { output } = parsePrivateReadArguments(argv);
  const context = validatePrivateReadContext(env, platform);
  validateOutputPath(output, context);
  const work = path.join(context.runnerTemp, `aw-seaweed-package-private-read-${context.runId}-attempt-1`);
  if (existsSync(work)) throw new Error("seaweed_package_private_read_owned_path_exists");
  mkdirSync(output, { mode: 0o700 });
  mkdirSync(work, { mode: 0o700 });
  const authConfig = path.join(work, "docker-auth");
  const anonymousConfig = path.join(work, "docker-anonymous");
  mkdirSync(authConfig, { mode: 0o700 });
  mkdirSync(anonymousConfig, { mode: 0o700 });
  mkdirSync(path.join(authConfig, "buildx"), { mode: 0o700 });
  mkdirSync(path.join(anonymousConfig, "buildx"), { mode: 0o700 });

  const subject = `${SEAWEED_PACKAGE_PRIVATE_READ.image}@${SEAWEED_PACKAGE_PRIVATE_READ.digest}`;
  const container = `aw-seaweed-package-private-read-${context.runId}`;
  const authOptions = { cwd: work, env: commandEnvironment(env, authConfig, work) };
  const anonymousOptions = { cwd: work, env: commandEnvironment(env, anonymousConfig, work) };
  const receipt = {
    schemaVersion: 1,
    state: "VERIFYING_PRIVATE_READ",
    result: "FAILED",
    publication: "NOT_ATTEMPTED",
    admission: "NOT_AUTHORIZED",
    packageSettings: "NOT_VERIFIED_BY_THIS_RECEIPT",
    forkAccessTest: "SKIPPED_BY_USER",
    forkIsolation: "NOT_VERIFIED",
    repository: context.repository,
    image: SEAWEED_PACKAGE_PRIVATE_READ.image,
    manifestDigest: SEAWEED_PACKAGE_PRIVATE_READ.digest,
    subject,
    sourceSha: context.sourceSha,
    sourceRef: "refs/heads/main",
    runId: context.runId,
    runNumber: context.runNumber,
    runAttempt: context.runAttempt,
    expectedPayload: {
      path: `/${SEAWEED_PACKAGE_PRIVATE_READ.payloadPath}`,
      sha256: sha256(Buffer.from(SEAWEED_PACKAGE_PRIVATE_READ.payload, "utf8")),
      size: Buffer.byteLength(SEAWEED_PACKAGE_PRIVATE_READ.payload),
    },
    phases: [],
  };
  const phase = async (name, operation) => {
    if (now() - started > JOB_TIMEOUT_MS) throw new Error("seaweed_package_private_read_job_timeout");
    const phaseStarted = now();
    try {
      const value = await operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted });
      return value;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: fixedReason(error), durationMs: now() - phaseStarted });
      throw error;
    }
  };

  let ownedContainer = false;
  let ownedImage = false;
  let pullAttempted = false;
  let primaryFailure;
  try {
    receipt.tools = await phase("managed_tool_identity", () => ({
      docker: boundedIdentity(run(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], authOptions).stdout),
      buildx: boundedIdentity(run(commandRunner, "docker", ["buildx", "version"], authOptions).stdout),
      trustBoundary: "MANAGED_DOCKER_BUILDKIT",
    }));
    await phase("checkout_identity", () => {
      const head = run(commandRunner, "git", ["rev-parse", "HEAD"], { ...authOptions, cwd: context.workspace }).stdout.trim();
      if (head !== context.sourceSha) throw new Error("seaweed_package_private_read_checkout_mismatch");
    });
    await phase("authorized_registry_login", () => {
      run(commandRunner, "docker", ["login", "ghcr.io", "--username", SEAWEED_PACKAGE_PRIVATE_READ.owner, "--password-stdin"], {
        ...authOptions,
        input: `${context.token}\n`,
      });
    });
    receipt.remoteManifestBefore = await phase("remote_manifest_before", () => {
      const remote = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], authOptions);
      return manifestValidator(remote.stdout);
    });
    await phase("anonymous_manifest_denied", () => {
      const remote = observeCommand(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], anonymousOptions);
      return classifyAnonymousRemoteRead(remote);
    });
    receipt.remoteManifestAfter = await phase("remote_manifest_after", () => {
      const remote = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], authOptions);
      return manifestValidator(remote.stdout);
    });
    await phase("local_collision_check", () => {
      const image = run(commandRunner, "docker", ["image", "inspect", subject], authOptions, [0, 1]);
      const existingContainer = run(commandRunner, "docker", ["container", "inspect", container], authOptions, [0, 1]);
      if (!inspectAbsent(image, "image") || !inspectAbsent(existingContainer, "container")) {
        throw new Error("seaweed_package_private_read_local_collision");
      }
    });
    await phase("authorized_image_pull", () => {
      pullAttempted = true;
      const result = observeCommand(commandRunner, "docker", ["pull", "--platform", SEAWEED_PACKAGE_PRIVATE_READ.platform, subject], authOptions);
      if (result.error || result.status !== 0) throw new Error("seaweed_package_private_read_command_failed");
      ownedImage = true;
    });
    receipt.image = await phase("exact_image_inspection", () => {
      const inspected = run(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", subject], authOptions);
      return validateImageMetadata(inspected.stdout, subject);
    });
    await phase("stopped_container_create", () => {
      run(commandRunner, "docker", ["create", "--name", container, "--pull=never", subject, `/${SEAWEED_PACKAGE_PRIVATE_READ.payloadPath}`], authOptions);
      ownedContainer = true;
    });
    receipt.copiedPayload = await phase("stopped_container_copy", () => {
      const copied = path.join(work, "copied-bootstrap.txt");
      run(commandRunner, "docker", ["cp", `${container}:/${SEAWEED_PACKAGE_PRIVATE_READ.payloadPath}`, copied], authOptions);
      return validatePayload(copied);
    });
    receipt.anonymousManifestDenied = "PASSED";
    receipt.authorizedImagePull = "PASSED";
    receipt.state = "PRIVATE_READ_PROOF";
    receipt.result = "PASSED";
  } catch (error) {
    primaryFailure = error;
  }

  const dockerCleanupStarted = now();
  let dockerCleanupFailure;
  try {
    if (pullAttempted && !ownedImage) {
      const partialImage = run(commandRunner, "docker", ["image", "inspect", subject], authOptions, [0, 1]);
      ownedImage = !inspectAbsent(partialImage, "image");
    }
    if (ownedContainer) {
      run(commandRunner, "docker", ["rm", container], authOptions);
      if (!inspectAbsent(run(commandRunner, "docker", ["container", "inspect", container], authOptions, [0, 1]), "container")) {
        throw new Error("seaweed_package_private_read_container_cleanup_failed");
      }
    }
    if (ownedImage) {
      run(commandRunner, "docker", ["image", "rm", subject], authOptions);
      if (!inspectAbsent(run(commandRunner, "docker", ["image", "inspect", subject], authOptions, [0, 1]), "image")) {
        throw new Error("seaweed_package_private_read_image_cleanup_failed");
      }
    }
  } catch (error) {
    dockerCleanupFailure = error;
  }
  receipt.phases.push({
    name: "owned_docker_cleanup",
    result: dockerCleanupFailure ? "FAILED" : "PASSED",
    ...(dockerCleanupFailure ? { reason: fixedReason(dockerCleanupFailure) } : {}),
    durationMs: now() - dockerCleanupStarted,
  });

  const temporaryCleanupStarted = now();
  let temporaryCleanupFailure;
  try {
    const relative = path.relative(context.runnerTemp, work);
    if (
      !existsSync(work)
      || lstatSync(work).isSymbolicLink()
      || realpathSync(work) !== work
      || path.dirname(work) !== context.runnerTemp
      || relative.startsWith("..")
      || path.isAbsolute(relative)
    ) {
      throw new Error("seaweed_package_private_read_cleanup_path_invalid");
    }
    rmSync(work, { recursive: true, force: false });
  } catch (error) {
    temporaryCleanupFailure = error;
  }
  receipt.phases.push({
    name: "owned_temporary_cleanup",
    result: temporaryCleanupFailure ? "FAILED" : "PASSED",
    ...(temporaryCleanupFailure ? { reason: fixedReason(temporaryCleanupFailure) } : {}),
    durationMs: now() - temporaryCleanupStarted,
  });
  if (dockerCleanupFailure || temporaryCleanupFailure) receipt.result = "FAILED";
  writeReceipt(output, receipt);
  if (primaryFailure) throw new Error(fixedReason(primaryFailure));
  if (dockerCleanupFailure) throw new Error(fixedReason(dockerCleanupFailure));
  if (temporaryCleanupFailure) throw new Error(fixedReason(temporaryCleanupFailure));
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    await runSeaweedPackagePrivateRead();
  } catch (error) {
    console.error(`seaweed_package_private_read_failed:${fixedReason(error)}`);
    process.exitCode = 1;
  }
}
