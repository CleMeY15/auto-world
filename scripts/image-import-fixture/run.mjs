import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildFixtureTar, fixtureConfig, IMPORT_MESSAGE, sha256, validateRuntimeConfig, validateSavedImage } from "./archive.mjs";

const MiB = 1024 * 1024;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const fail = (reason) => { throw new Error(`image_import_${reason}`); };
const safeReason = (error) => /^image_import_[a-z0-9_]+$/u.test(error?.message ?? "") ? error.message : "image_import_operation_failed";

export function validateContext(env, platform = process.platform) {
  if (platform !== "linux" || env.RUNNER_OS !== "Linux" || env.GITHUB_ACTIONS !== "true") fail("requires_linux_actions");
  if (env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_REF !== "refs/heads/main" ||
      !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)) fail("context_invalid");
  if (!/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "") || !/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID ?? "") ||
      env.GITHUB_RUN_ATTEMPT !== "1") fail("identity_invalid");
  if (!path.isAbsolute(env.RUNNER_TEMP ?? "")) fail("runner_temp_invalid");
  const runnerTemp = path.resolve(env.RUNNER_TEMP);
  if (!existsSync(runnerTemp) || !lstatSync(runnerTemp).isDirectory() || lstatSync(runnerTemp).isSymbolicLink() ||
      realpathSync(runnerTemp) !== runnerTemp) fail("runner_temp_invalid");
  return { repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID, attempt: 1, event: env.GITHUB_EVENT_NAME, runnerTemp };
}

function identity(directory) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) fail("owned_directory_invalid");
  return { dev: stat.dev, ino: stat.ino };
}

function assertOwnedDirectory(directory, expected, root) {
  if (path.dirname(directory) !== root || realpathSync(root) !== root) fail("owned_directory_invalid");
  const actual = identity(directory);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) fail("owned_directory_changed");
}

export function importChanges(owner) {
  const config = fixtureConfig(owner);
  return [
    `ENTRYPOINT ${JSON.stringify(config.Entrypoint)}`,
    `CMD ${JSON.stringify(config.Cmd)}`,
    ...config.Env.map((entry) => `ENV ${entry}`),
    `WORKDIR ${config.WorkingDir}`,
    `VOLUME ${JSON.stringify(Object.keys(config.Volumes))}`,
    ...Object.keys(config.ExposedPorts).map((port) => `EXPOSE ${port}`),
    ...Object.entries(config.Labels).map(([key, value]) => `LABEL ${key}=${value}`),
  ];
}

export function validateImage(metadata, { imageId, tag, owner }) {
  if (!IMAGE_ID.test(imageId) || metadata?.Id !== imageId || metadata?.Os !== "linux" || metadata?.Architecture !== "amd64" ||
      metadata?.RepoTags?.length !== 1 || metadata.RepoTags[0] !== tag ||
      !Number.isSafeInteger(metadata?.Size) || metadata.Size < 1 || metadata.Size > 64 * 1024) fail("image_identity_invalid");
  validateRuntimeConfig(metadata.Config, owner);
  if (metadata?.RootFS?.Type !== "layers" || metadata?.RootFS?.Layers?.length !== 1 ||
      !IMAGE_ID.test(metadata.RootFS.Layers[0])) fail("image_layers_invalid");
  return metadata.RootFS.Layers[0];
}

function defaultCommandRunner(args, options) {
  return spawnSync("docker", args, { ...options, encoding: "utf8", maxBuffer: MiB, windowsHide: true, killSignal: "SIGKILL" });
}

export function runDiagnostic({ argv = process.argv.slice(2), env = process.env, platform = process.platform,
  commandRunner = defaultCommandRunner } = {}) {
  const context = validateContext(env, platform);
  const output = path.join(context.runnerTemp, "image-import-fixture");
  if (argv.length !== 2 || argv[0] !== "--output" || !path.isAbsolute(argv[1]) || path.resolve(argv[1]) !== output) fail("output_invalid");
  const owner = `run-${context.runId}-attempt-1`;
  const tag = `auto-world-import-fixture:${owner}`;
  const work = path.join(context.runnerTemp, `aw-image-import-${owner}`);
  if (existsSync(output) || existsSync(work)) fail("owned_path_exists");
  mkdirSync(output, { mode: 0o700 });
  const outputIdentity = identity(output);
  mkdirSync(work, { mode: 0o700 });
  const workIdentity = identity(work);
  const dockerConfig = path.join(work, "docker-config");
  mkdirSync(dockerConfig, { mode: 0o700 });
  const commandEnv = { PATH: env.PATH ?? "", DOCKER_CONFIG: dockerConfig, DOCKER_HOST: "unix:///var/run/docker.sock",
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TMPDIR: work };
  const startedAt = Date.now();
  const deadline = startedAt + 7 * 60_000;
  const cleanupDeadline = startedAt + 8.5 * 60_000;
  const receipt = { schemaVersion: 1, state: "SYNTHETIC_IMPORT_SAVE_ONLY", result: "FAILED",
    repository: context.repository, sourceSha: context.sourceSha, sourceRef: context.ref, event: context.event,
    runId: context.runId, runAttempt: context.attempt, platform: "linux/amd64",
    imageExecution: "NOT_ATTEMPTED", publication: "NOT_ATTEMPTED", seaweedAcceptance: "NOT_ESTABLISHED", phases: [] };
  const phase = (name, operation) => {
    const started = Date.now();
    try {
      const result = operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: Date.now() - started });
      return result;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: safeReason(error), durationMs: Date.now() - started });
      throw error;
    }
  };
  const command = (args, expectedStatuses = [0], cleanup = false) => {
    const remaining = (cleanup ? cleanupDeadline : deadline) - Date.now();
    if (remaining <= 0) fail("deadline_exceeded");
    const result = commandRunner(args, { cwd: work, env: commandEnv, timeout: Math.min(120_000, remaining) });
    if (result?.error || !expectedStatuses.includes(result?.status)) fail("command_failed");
    if (typeof result.stdout !== "string" || typeof result.stderr !== "string" ||
        Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MiB) fail("command_output_invalid");
    return result;
  };
  const absent = (reference, cleanup = false) => {
    const result = command(["image", "inspect", reference], [0, 1], cleanup);
    if (result.status === 0) fail("image_exists");
    if (result.stdout.trim() !== "[]" || result.stderr.trim() !== `Error response from daemon: No such image: ${reference}`) fail("absence_unproven");
  };
  const inspect = (cleanup = false) => {
    const result = command(["image", "inspect", "--format", "{{json .}}", tag], [0], cleanup);
    try { return JSON.parse(result.stdout); } catch { fail("inspect_json_invalid"); }
  };
  let ownedImage = false;
  let imageId;
  let failure;
  try {
    receipt.tools = phase("managed_engine_identity", () => {
      const value = command(["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"]).stdout.trim();
      if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?\|[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/u.test(value) || value.length > 128) fail("engine_version_invalid");
      const [client, server] = value.split("|");
      return { client, server, trustBoundary: "MANAGED_DOCKER_ENGINE" };
    });
    phase("tag_absence", () => absent(tag));
    const rootfs = path.join(work, "rootfs.tar");
    receipt.fixture = phase("fixture_materialization", () => {
      const bytes = buildFixtureTar();
      if (!Buffer.isBuffer(bytes) || bytes.length > 64 * 1024) fail("fixture_budget_exceeded");
      writeFileSync(rootfs, bytes, { flag: "wx", mode: 0o600 });
      return { sha256: sha256(bytes), size: bytes.length };
    });
    phase("image_import", () => {
      const changes = importChanges(owner).flatMap((change) => ["--change", change]);
      imageId = command(["image", "import", "--platform", "linux/amd64", "--message", IMPORT_MESSAGE, ...changes, rootfs, tag]).stdout.trim();
      if (!IMAGE_ID.test(imageId)) fail("import_identity_invalid");
    });
    const diffID = phase("image_ownership", () => {
      const actual = validateImage(inspect(), { imageId, tag, owner });
      ownedImage = true;
      return actual;
    });
    receipt.image = { imageId, diffID };
    receipt.archive = phase("save_and_verify", () => {
      const saved = path.join(work, "saved.tar");
      command(["image", "save", "--output", saved, tag]);
      assertOwnedDirectory(work, workIdentity, context.runnerTemp);
      const stat = lstatSync(saved);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > 4 * MiB) fail("saved_file_invalid");
      const proof = validateSavedImage(readFileSync(saved), { imageId, tag, owner, serverVersion: receipt.tools.server });
      if (proof.diffID !== diffID) fail("inspect_archive_layer_mismatch");
      return proof;
    });
    receipt.image.identityType = receipt.archive.identityType;
  } catch (error) { failure = error; }
  try {
    phase("image_cleanup", () => {
      if (!ownedImage) {
        receipt.cleanupOwnership = "NOT_ESTABLISHED_NO_IMAGE_REMOVAL";
        return;
      }
      validateImage(inspect(true), { imageId, tag, owner });
      command(["image", "rm", tag], [0], true);
      absent(tag, true);
      absent(imageId, true);
      receipt.cleanupOwnership = "EXACT_IMAGE_REMOVED_ABSENCE_VERIFIED";
    });
  } catch (error) { failure ??= error; }
  try {
    phase("temporary_cleanup", () => {
      assertOwnedDirectory(work, workIdentity, context.runnerTemp);
      rmSync(work, { recursive: true, force: false });
      if (existsSync(work)) fail("temporary_cleanup_failed");
    });
  } catch (error) { failure ??= error; }
  if (!failure) receipt.result = "PASSED";
  assertOwnedDirectory(output, outputIdentity, context.runnerTemp);
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  if (bytes.length > 64 * 1024) fail("receipt_budget_exceeded");
  writeFileSync(path.join(output, "receipt.json"), bytes, { flag: "wx", mode: 0o600 });
  if (failure) throw new Error(safeReason(failure));
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { runDiagnostic(); } catch (error) {
    console.error(`image_import_failed:${safeReason(error)}`);
    process.exitCode = 1;
  }
}
