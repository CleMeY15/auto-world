import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { scannerRetentionPublisherChildEnvironment } from "./retention-publish.mjs";
import { sha256 } from "./retention-policy.mjs";
import { validateScannerRetentionPublisherTools } from "./retention-tool-identity.mjs";

const PREFIX = "scanner_retention_tools_probe_";
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const OWNER_LABEL = "world.auto.scanner-retention-tools-owner";
const FIXTURE = Buffer.from("Auto World scanner retention tool compatibility proof.\n", "utf8");
const ZERO_TIME = "0001-01-01T00:00:00Z";
const CAP = 1024 * 1024;
const fail = (code) => { throw new Error(`${PREFIX}${code}`); };

// A timeout/output overflow kills the whole process group, including plugin children.
// Even an otherwise successful command fails if a descendant survives its exit.
async function nativeCommand(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env,
      detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const output = { stdout: [], stderr: [] }; let size = 0; let error;
    const killGroup = () => {
      if (!child.pid) return false;
      try { process.kill(-child.pid, 0); }
      catch (caught) { if (caught.code === "ESRCH") return false; error ??= caught; return true; }
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (caught) { if (caught.code !== "ESRCH") error ??= caught; }
      return true;
    };
    const timer = setTimeout(() => { error ??= new Error(`${PREFIX}command_timeout`); killGroup(); }, options.timeout);
    for (const channel of ["stdout", "stderr"]) child[channel].on("data", (bytes) => {
      size += bytes.length;
      if (size > CAP) { error ??= new Error(`${PREFIX}command_output_limit`); killGroup(); }
      else output[channel].push(bytes);
    });
    child.on("error", (caught) => { error ??= caught; });
    child.on("exit", () => {
      if (killGroup()) error ??= new Error(`${PREFIX}surviving_child`);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, error, stdout: Buffer.concat(output.stdout).toString("utf8"),
        stderr: Buffer.concat(output.stderr).toString("utf8") });
    });
  });
}

function line(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > CAP) fail("output_invalid");
  const result = value.endsWith("\n") ? value.slice(0, -1) : value;
  if (/[\r\n\0]/u.test(result)) fail("output_invalid");
  return result;
}

function labels(value, owner) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 1 && value[OWNER_LABEL] === owner;
}

function readRegular(file, cap) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > cap) fail("file_invalid");
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(descriptor);
    if (current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size
      || current.nlink !== 1 || !current.isFile()) fail("file_invalid");
    const bytes = readFileSync(descriptor);
    if (bytes.length !== current.size || bytes.length > cap) fail("file_invalid");
    return bytes;
  } finally { closeSync(descriptor); }
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Injected command runner is for regression tests; the CLI never accepts an override.
export async function exerciseScannerRetentionTools({ work, env, runId, runAttempt, nonce,
  commandRunner = nativeCommand, now = Date.now, log = console.log }) {
  if (!/^[1-9][0-9]{0,15}$/u.test(runId) || !/^[1-9][0-9]{0,3}$/u.test(runAttempt)
    || !/^[a-f0-9]{32}$/u.test(nonce) || !path.isAbsolute(work)) fail("context_invalid");
  const deadline = now() + 300_000;
  // Reserve the last minute of the five-minute exercise for bounded cleanup.
  const operationDeadline = deadline - 60_000;
  let cleaning = false;
  const name = `aw-scanner-tools-${runId}-${runAttempt}-${nonce}`;
  const tag = `${name}:probe`; const owner = `${runId}:${runAttempt}:${nonce}`;
  const run = async (command, args, allowFailure = false) => {
    const remaining = (cleaning ? deadline : operationDeadline) - now();
    if (remaining <= 0) fail("deadline_exceeded");
    const timeout = Math.min(60_000, remaining);
    const result = await commandRunner(command, args, { cwd: work, env, timeout, maxBuffer: CAP });
    if (!result || typeof result.stdout !== "string" || typeof result.stderr !== "string"
      || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > CAP) fail("command_failed");
    // These commands have no credentials or external payloads. Preserve bounded
    // originals for review of actual build, inspection, copy and cleanup evidence.
    log(JSON.stringify({ phase: "command", command, args, timeoutMs: timeout,
      exitCode: result.status, signal: result.signal, executionError: Boolean(result.error),
      stdout: result.stdout, stderr: result.stderr }));
    if (result.error || result.signal || !Number.isInteger(result.status)) fail("command_failed");
    if (!allowFailure && result.status !== 0) fail("command_failed");
    return result;
  };
  const docker = async (args, allowFailure) => run("docker", args, allowFailure);
  const inspect = async (kind, identity) => {
    const result = await docker([kind, "inspect", identity, "--format", "{{json .}}"], true);
    if (result.status === 0) {
      try { return JSON.parse(line(result.stdout)); } catch { fail("inspect_invalid"); }
    }
    // Docker CLI v28.0.4 TemplateInspector.Flush emits one LF for zero records:
    // github.com/docker/cli/blob/v28.0.4/cli/command/inspect/inspector.go#L129-L135
    const absent = `Error response from daemon: No such ${kind}: ${identity}\n`;
    if (result.status === 1 && result.stdout === "\n" && result.stderr === absent) return null;
    fail("absence_uncertain");
  };
  const inventory = async () => {
    const result = {};
    for (const kind of ["image", "container"]) {
      const raw = (await docker([kind, "ls", "--all", "--quiet", "--no-trunc"])).stdout;
      const rows = raw === "" ? [] : raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : raw.split("\n");
      const pattern = kind === "image" ? IMAGE_ID : CONTAINER_ID;
      if (rows.length > 4096 || rows.some((row) => !pattern.test(row))) fail("inventory_invalid");
      result[kind] = [...new Set(rows)].sort();
    }
    return result;
  };
  const imageOwned = (image, expectedId) => {
    if (!image || !IMAGE_ID.test(image.Id ?? "") || (expectedId && image.Id !== expectedId)
      || image.Os !== "linux" || image.Architecture !== "amd64" || !Number.isSafeInteger(image.Size)
      || image.Size < FIXTURE.length || image.Size > CAP || !same(image.RepoTags, [tag])
      || !labels(image.Config?.Labels, owner)) fail("image_identity_invalid");
    return image.Id;
  };
  const containerOwned = (container, imageId, expectedId, requireCreated = true) => {
    if (!container || !CONTAINER_ID.test(container.Id ?? "") || (expectedId && container.Id !== expectedId)
      || container.Name !== `/${name}` || container.Image !== imageId || container.Config?.Image !== imageId
      || !labels(container.Config?.Labels, owner) || !same(container.Config?.Cmd, ["/proof-never-executed"])
      || container.HostConfig?.NetworkMode !== "none" || container.HostConfig?.ReadonlyRootfs !== true
      || !same(container.HostConfig?.CapDrop, ["ALL"])
      || !same(container.HostConfig?.SecurityOpt, ["no-new-privileges=true"])) fail("container_identity_invalid");
    const state = container.State;
    if (requireCreated && (!state || state.Status !== "created" || state.Running !== false
      || state.Paused !== false || state.Restarting !== false || state.OOMKilled !== false || state.Dead !== false
      || state.Pid !== 0 || state.ExitCode !== 0 || state.Error !== ""
      || state.StartedAt !== ZERO_TIME || state.FinishedAt !== ZERO_TIME)) fail("container_started");
    return container.Id;
  };
  let baseline; let imageId; let containerId; let buildAttempted = false; let createAttempted = false;
  let failure; let result;
  try {
    const tools = validateScannerRetentionPublisherTools({
      docker: (await docker(["version", "--format", "{{json .}}"])).stdout,
      buildx: (await docker(["buildx", "version"])).stdout,
      go: (await run("go", ["version"])).stdout,
    });
    log(JSON.stringify({ phase: "tools", ...tools }));
    // buildx inspect has no --format option. Read only its bounded top section,
    // before the Nodes section (whose records also contain Name fields).
    const builder = (await docker(["buildx", "inspect", "default"])).stdout;
    const header = builder.split(/\nNodes:[ \t]*\n/u)[0];
    const names = [...header.matchAll(/^Name:[ \t]+([^ \t\r\n]+)[ \t]*$/gmu)];
    const drivers = [...header.matchAll(/^Driver:[ \t]+([^ \t\r\n]+)[ \t]*$/gmu)];
    if (names.length !== 1 || names[0][1] !== "default" || drivers.length !== 1
      || drivers[0][1] !== "docker" || /[\r\0]/u.test(builder)) fail("default_driver_invalid");
    baseline = await inventory();
    if (await inspect("image", tag) !== null || await inspect("container", name) !== null) fail("name_collision");
    const context = path.join(work, "context"); mkdirSync(context, { mode: 0o700 });
    writeFileSync(path.join(context, "Dockerfile"), "FROM scratch\nCOPY proof.txt /proof.txt\n", { flag: "wx", mode: 0o600 });
    writeFileSync(path.join(context, "proof.txt"), FIXTURE, { flag: "wx", mode: 0o600 });
    const iidfile = path.join(work, "image-id");
    buildAttempted = true;
    await docker(["buildx", "build", "--builder", "default", "--platform", "linux/amd64", "--network", "none",
      "--pull=false", "--no-cache", "--provenance=false", "--sbom=false", "--load",
      "--label", `${OWNER_LABEL}=${owner}`, "--tag", tag, "--iidfile", iidfile, context]);
    const builtId = line(readRegular(iidfile, 72).toString("utf8"));
    if (!IMAGE_ID.test(builtId) || baseline.image.includes(builtId)) fail("image_identity_invalid");
    imageId = imageOwned(await inspect("image", tag), builtId);
    imageOwned(await inspect("image", imageId), imageId);
    createAttempted = true;
    const created = await docker(["create", "--name", name, "--label", `${OWNER_LABEL}=${owner}`,
      "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true",
      "--pull", "never", imageId, "/proof-never-executed"]);
    const createdId = line(created.stdout);
    if (!CONTAINER_ID.test(createdId) || baseline.container.includes(createdId)) fail("container_identity_invalid");
    containerId = containerOwned(await inspect("container", name), imageId, createdId);
    containerOwned(await inspect("container", containerId), imageId, containerId);
    const copied = path.join(work, "copied-proof.txt");
    await docker(["cp", `${containerId}:/proof.txt`, copied]);
    const bytes = readRegular(copied, FIXTURE.length);
    if (!bytes.equals(FIXTURE) || sha256(bytes) !== sha256(FIXTURE)) fail("copied_bytes_invalid");
    containerOwned(await inspect("container", containerId), imageId, containerId);
    result = { result: "PASSED", profileId: tools.profileId, profileSha256: tools.profileSha256,
      driver: "docker", imageId, containerId, payloadBytes: bytes.length, payloadSha256: sha256(bytes),
      stoppedNeverStarted: true, registryAccess: false, scannerExecuted: false };
  } catch (error) { failure = error; }
  cleaning = true;
  const cleanupErrors = [];
  const cleanup = async (action) => { try { await action(); } catch (error) { cleanupErrors.push(error); } };
  // A failed/timed-out creation can still have produced an object. Acquire it only
  // after rechecking the unique name, labels, immutable identity and baseline.
  await cleanup(async () => {
    if (buildAttempted && !imageId) {
      const candidate = await inspect("image", tag);
      if (candidate) {
        const id = imageOwned(candidate);
        if (baseline.image.includes(id)) fail("image_preexisting");
        imageId = id;
      }
    }
    if (createAttempted && !containerId) {
      const candidate = await inspect("container", name);
      if (candidate) {
        const id = containerOwned(candidate, imageId, undefined, false);
        if (baseline.container.includes(id)) fail("container_preexisting");
        containerId = id;
      }
    }
  });
  await cleanup(async () => {
    if (!containerId) return;
    containerOwned(await inspect("container", containerId), imageId, containerId, false);
    containerOwned(await inspect("container", name), imageId, containerId, false);
    await docker(["container", "rm", containerId]);
    if (await inspect("container", containerId) !== null || await inspect("container", name) !== null) fail("container_cleanup_failed");
  });
  await cleanup(async () => {
    if (!imageId) return;
    imageOwned(await inspect("image", imageId), imageId);
    imageOwned(await inspect("image", tag), imageId);
    await docker(["image", "rm", imageId]);
    if (await inspect("image", imageId) !== null || await inspect("image", tag) !== null) fail("image_cleanup_failed");
  });
  await cleanup(async () => { if (baseline && !same(await inventory(), baseline)) fail("inventory_changed"); });
  if (cleanupErrors.length) {
    log(JSON.stringify({ phase: "cleanup", result: "FAILED", reasons: cleanupErrors.map((error) =>
      error.message.startsWith(PREFIX) ? error.message : `${PREFIX}cleanup_failed`) }));
    failure ??= cleanupErrors[0];
  }
  if (failure) throw failure;
  log(JSON.stringify({ ...result, cleanup: "PASSED", inventoriesRestored: true,
    buildCache: "Default builder cache may remain; no pristine-cache claim." }));
  return result;
}

export function validateScannerRetentionToolsProbeContext(env, platform, nodeVersion) {
  if (platform !== "linux" || nodeVersion !== "22.23.4" || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.RUNNER_OS !== "Linux"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.RUNNER_TEMP !== "/home/runner/work/_temp"
    || typeof env.GITHUB_WORKSPACE !== "string" || !path.isAbsolute(env.GITHUB_WORKSPACE)
    || !/^[1-9][0-9]{0,15}$/u.test(env.GITHUB_RUN_ID ?? "")
    || !/^[1-9][0-9]{0,3}$/u.test(env.GITHUB_RUN_ATTEMPT ?? "")
    || typeof env.PATH !== "string" || !env.PATH || env.PATH.length > 32768 || /[\r\n\0]/u.test(env.PATH)) fail("context_invalid");
  return { workspace: env.GITHUB_WORKSPACE, runnerTemp: env.RUNNER_TEMP, path: env.PATH };
}

async function main() {
  if (process.argv.length !== 2) fail("arguments_invalid");
  const context = validateScannerRetentionToolsProbeContext(process.env, process.platform, process.versions.node);
  if (realpathSync(context.workspace) !== process.cwd() || realpathSync(context.runnerTemp) !== context.runnerTemp) fail("context_invalid");
  const work = mkdtempSync(path.join(context.runnerTemp, "scanner-retention-tools-probe-"));
  const identity = lstatSync(work); const config = path.join(work, "docker");
  let failure;
  try {
    mkdirSync(config, { mode: 0o700 });
    await exerciseScannerRetentionTools({ work,
      env: scannerRetentionPublisherChildEnvironment(context, config, work),
      runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      nonce: randomBytes(16).toString("hex") });
  } catch (error) { failure = error; }
  try {
    const current = lstatSync(work);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev
      || current.ino !== identity.ino || current.uid !== identity.uid) fail("directory_changed");
    rmSync(work, { recursive: true, force: false });
  } catch (error) {
    console.error(`${PREFIX}directory_cleanup_failed`);
    failure ??= error;
  }
  if (failure) throw failure;
}

export const TEST_ONLY_scannerRetentionToolsCommand = nativeCommand;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message.startsWith("scanner_retention_") ? error.message : `${PREFIX}failed`);
    process.exitCode = 1;
  });
}
