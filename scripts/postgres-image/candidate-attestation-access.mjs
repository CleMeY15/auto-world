import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, readdirSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

import { validatePostgresRemotePolicy, validatePostgresRemoteRawManifest } from "./candidate-remote.mjs";
import { classifyAnonymousRemoteRead } from "../package-bootstrap/registry-proof.mjs";

export const POSTGRES_ATTESTATION_ACCESS = Object.freeze({
  repository: "CleMeY15/auto-world",
  workflowPath: ".github/workflows/postgres-candidate-attest-v2.yml",
  job: "access",
  policyPath: "infra/postgres-image/candidate-remote.json",
  controlsPath: "infra/postgres-image/package-controls.json",
  outputDirectory: "postgres-candidate-attestation-access",
  subject: "ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93",
});

const WORKFLOW_REF = `${POSTGRES_ATTESTATION_ACCESS.repository}/${POSTGRES_ATTESTATION_ACCESS.workflowPath}@refs/heads/main`;
const MAIN_BRANCH_URL = `https://api.github.com/repos/${POSTGRES_ATTESTATION_ACCESS.repository}/branches/main`;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const API_TIMEOUT_MS = 30_000;
const SENSITIVE = /(?:ghp_|github_pat_|bearer\s+|authorization\s*[:=]\s*|password\s*[:=]\s*|token\s*[:=]\s*)[^\n]{1,256}/iu;
const PHASE_NAMES = Object.freeze([
  "protected_main_and_checkout", "committed_policy_and_controls", "managed_tool_identity",
  "authorized_registry_login", "authorized_manifest_before", "anonymous_manifest_denied",
  "authorized_manifest_after", "credential_and_temporary_cleanup",
]);
const PUBLIC_FAILURE_PHASES = Object.freeze(["UNKNOWN", ...PHASE_NAMES]);
const BUILDX_DIRECTORIES = Object.freeze(["activity", "defaults", "instances"]);

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function identity(bytes) { return Object.freeze({ sha256: sha256(bytes), bytes: bytes.length }); }
function visibleAscii(value) {
  return typeof value === "string" && Array.from(value).every((character) => {
    const code = character.charCodeAt(0); return code >= 0x21 && code <= 0x7e;
  });
}
function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, cloneFrozen(item)])));
  return value;
}
function data(value, code, depth = 0) {
  if (depth > 32) fail(code);
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object"
    || Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1 || descriptors.length.value !== value.length || value.length > 4096) fail(code);
    return Array.from({ length: value.length }, (_unused, index) => {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail(code);
      return data(descriptor.value, code, depth + 1);
    });
  }
  if (keys.length > 512 || keys.some((key) => typeof key !== "string"
    || !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable)) fail(code);
  return Object.fromEntries(keys.map((key) => [key, data(descriptors[key].value, code, depth + 1)]));
}
function encode(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  return `{${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`).join(",")}}`;
}
function fixedReason(error) {
  const message = error instanceof Error ? error.message : "postgres_attestation_access_failed";
  return /^(?:postgres_attestation_access|postgres_remote_candidate|package_registry)_[a-z0-9_]+$/u.test(message)
    ? message : "postgres_attestation_access_failed";
}
function fixedPublicReason(value) {
  const candidate = typeof value === "string" ? value
    : typeof value?.code === "string" ? value.code : value instanceof Error ? value.message : "";
  return /^(?:postgres_attestation_access|postgres_remote_candidate|package_registry)_[a-z0-9_]+$/u.test(candidate)
    ? candidate : "postgres_attestation_access_failed";
}
function instant(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}
function nowIso(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("postgres_attestation_access_clock_invalid");
  return value.toISOString();
}
function parseJson(bytes, code) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(code); }
}

export function validatePostgresPackageControls(value) {
  value = data(value, "postgres_attestation_access_controls_invalid");
  if (!exactKeys(value, ["kind", "state", "authority", "observedAt", "observationSource",
    "observationPrecision", "liveApiAuthority", "package", "visibility", "sourceRepository", "inheritSourcePermissions",
    "actionsRepositories", "codespacesRepositories", "directMembers", "forkAccessTest", "forkIsolation"])
    || value.kind !== "POSTGRES_PACKAGE_CONTROLS_V1" || value.state !== "OBSERVED"
    || value.authority !== "AUTHENTICATED_SETTINGS_UI_OBSERVATION"
    || !instant(value.observedAt) || value.observationSource !== "AUTHENTICATED_GITHUB_SETTINGS_UI"
    || value.observationPrecision !== "MINUTE"
    || value.liveApiAuthority !== "NOT_ESTABLISHED"
    || value.package !== "ghcr.io/clemey15/auto-world-postgres-gosu" || value.visibility !== "Private"
    || value.sourceRepository !== POSTGRES_ATTESTATION_ACCESS.repository
    || value.inheritSourcePermissions !== true
    || !isDeepStrictEqual(value.actionsRepositories,
      [{ repository: POSTGRES_ATTESTATION_ACCESS.repository, role: "Admin" }])
    || !isDeepStrictEqual(value.codespacesRepositories, []) || !isDeepStrictEqual(value.directMembers, [])
    || value.forkAccessTest !== "SKIPPED_BY_USER" || value.forkIsolation !== "NOT_VERIFIED") {
    fail("postgres_attestation_access_controls_invalid");
  }
  return cloneFrozen(value);
}

export function requirePostgresAttestationAccessContext(env, {
  platform = process.platform, uid = process.getuid?.(), gid = process.getgid?.(),
} = {}) {
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_JOB !== POSTGRES_ATTESTATION_ACCESS.job
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== POSTGRES_ATTESTATION_ACCESS.repository
    || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF || env.GITHUB_RUN_NUMBER !== "1"
    || env.GITHUB_RUN_ATTEMPT !== "1" || !RUN_ID.test(env.GITHUB_RUN_ID ?? "")
    || !REVISION.test(env.GITHUB_SHA ?? "") || typeof env.RUNNER_TEMP !== "string"
    || !path.isAbsolute(env.RUNNER_TEMP) || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP
    || typeof env.GITHUB_WORKSPACE !== "string" || !path.isAbsolute(env.GITHUB_WORKSPACE)
    || path.normalize(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) {
    fail("postgres_attestation_access_context_invalid");
  }
  try {
    if (realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP
      || realpathSync(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) fail("postgres_attestation_access_context_invalid");
  } catch { fail("postgres_attestation_access_context_invalid"); }
  return Object.freeze({ workspace: env.GITHUB_WORKSPACE, runnerTemp: env.RUNNER_TEMP,
    work: path.join(env.RUNNER_TEMP, `postgres-attestation-access-${env.GITHUB_RUN_ID}-attempt-1`),
    output: path.join(env.RUNNER_TEMP, POSTGRES_ATTESTATION_ACCESS.outputDirectory),
    runId: env.GITHUB_RUN_ID, recipeRevision: env.GITHUB_SHA, uid, gid });
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", env: options.env,
    input: options.input, maxBuffer: MAX_OUTPUT_BYTES, timeout: options.timeoutMs, windowsHide: true });
}

function observe(commandRunner, command, args, options) {
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
    fail("postgres_attestation_access_command_output_exceeded");
  }
  return { error: result?.error, status: result?.status, stdout, stderr };
}

function run(commandRunner, command, args, options) {
  const result = observe(commandRunner, command, args, options);
  if (result.error || result.status !== 0) fail("postgres_attestation_access_command_failed");
  return result;
}

function commandEnvironment(env, dockerConfig, temporaryDirectory) {
  const clean = { BUILDX_CONFIG: path.join(dockerConfig, "buildx"), DOCKER_CONFIG: dockerConfig,
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TMPDIR: temporaryDirectory, TZ: "UTC" };
  for (const name of ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "XDG_CONFIG_HOME"]) {
    if (typeof env[name] === "string") clean[name] = env[name];
  }
  return clean;
}

function makePrivateDirectory(directory, parent, uid, gid) {
  if (path.dirname(directory) !== parent || existsSync(directory)) fail("postgres_attestation_access_path_invalid");
  mkdirSync(directory, { mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || info.gid !== gid
    || (info.mode & 0o777) !== 0o700
    || realpathSync(directory) !== directory) fail("postgres_attestation_access_path_invalid");
  return Object.freeze({ dev: info.dev, ino: info.ino, uid: info.uid, gid: info.gid, mode: info.mode & 0o777 });
}

function makePrivateEmptyFile(file, parent, uid, gid) {
  if (path.dirname(file) !== parent || existsSync(file)) fail("postgres_attestation_access_path_invalid");
  let handle;
  try {
    handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(handle, 0o600);
    const info = fstatSync(handle); const pathname = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== uid || info.gid !== gid
      || (info.mode & 0o777) !== 0o600
      || info.size !== 0 || pathname.isSymbolicLink() || info.dev !== pathname.dev || info.ino !== pathname.ino
      || realpathSync(file) !== file) fail("postgres_attestation_access_path_invalid");
    return Object.freeze({ dev: info.dev, ino: info.ino, uid: info.uid, gid: info.gid,
      mode: info.mode & 0o777, nlink: info.nlink, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs });
  } catch (error) {
    if (/^postgres_attestation_access_/u.test(error?.message ?? "")) throw error;
    fail("postgres_attestation_access_path_invalid");
  } finally { if (handle !== undefined) closeSync(handle); }
}

function sameOwnedDirectory(directory, expected) {
  if (!existsSync(directory)) return false;
  const info = lstatSync(directory);
  return info.isDirectory() && !info.isSymbolicLink() && info.dev === expected.dev
    && info.ino === expected.ino && info.uid === expected.uid && info.gid === expected.gid
    && (info.mode & 0o777) === expected.mode
    && realpathSync(directory) === directory;
}

function buildxLayout(directory, uid, gid) {
  const directories = Object.fromEntries(BUILDX_DIRECTORIES.map((name) => {
    const child = path.join(directory, name);
    return [name, Object.freeze({ path: child, identity: makePrivateDirectory(child, directory, uid, gid) })];
  }));
  const lock = path.join(directory, ".lock");
  return Object.freeze({ directories: Object.freeze(directories),
    lock: Object.freeze({ path: lock, identity: makePrivateEmptyFile(lock, directory, uid, gid) }) });
}

function pinnedRegular(file, expected, uid, gid, { minimum = 0, maximum, exactMode = 0o600 } = {}) {
  let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(handle); const pathname = lstatSync(file);
    const current = { dev: before.dev, ino: before.ino, uid: before.uid, gid: before.gid,
      mode: before.mode & 0o777, nlink: before.nlink, size: before.size,
      mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs };
    if (!before.isFile() || before.nlink !== 1 || pathname.isSymbolicLink() || before.uid !== uid || before.gid !== gid
      || (before.mode & 0o777) !== exactMode || before.size < minimum || before.size > maximum
      || before.dev !== pathname.dev || before.ino !== pathname.ino || realpathSync(file) !== file
      || (expected && ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeMs", "ctimeMs"]
        .some((key) => Object.hasOwn(expected, key) && current[key] !== expected[key]))) {
      fail("postgres_attestation_access_cleanup_uncertain");
    }
    const bytes = readFileSync(handle); const after = fstatSync(handle);
    if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      fail("postgres_attestation_access_cleanup_uncertain");
    }
    return Object.freeze({ bytes, identity: Object.freeze(current) });
  } catch (error) {
    if (error?.message === "postgres_attestation_access_cleanup_uncertain") throw error;
    fail("postgres_attestation_access_cleanup_uncertain");
  } finally { if (handle !== undefined) closeSync(handle); }
}

function inspectDockerConfig(file, context) {
  if (!existsSync(file)) return null;
  const observed = pinnedRegular(file, null, context.uid, context.gid, { minimum: 2, maximum: 64 * 1024 });
  let value;
  try { value = data(JSON.parse(observed.bytes.toString("utf8")), "postgres_attestation_access_cleanup_uncertain"); }
  catch { fail("postgres_attestation_access_cleanup_uncertain"); }
  const entry = value?.auths?.["ghcr.io"];
  if (!exactKeys(value, ["auths"]) || !exactKeys(value.auths, ["ghcr.io"]) || !exactKeys(entry, ["auth"])
    || typeof entry.auth !== "string" || entry.auth.length < 1 || entry.auth.length > 16 * 1024
    || !visibleAscii(entry.auth)) fail("postgres_attestation_access_cleanup_uncertain");
  return observed.identity;
}

function inspectBuildxCurrent(file, context) {
  if (!existsSync(file)) return null;
  const observed = pinnedRegular(file, null, context.uid, context.gid, { minimum: 2, maximum: 1024 });
  let value;
  try { value = data(JSON.parse(observed.bytes.toString("utf8")), "postgres_attestation_access_cleanup_uncertain"); }
  catch { fail("postgres_attestation_access_cleanup_uncertain"); }
  if (!exactKeys(value, ["Key", "Name", "Global"]) || typeof value.Key !== "string"
    || value.Key.length < 1 || value.Key.length > 256 || !visibleAscii(value.Key)
    || value.Name !== "" || value.Global !== false) fail("postgres_attestation_access_cleanup_uncertain");
  return observed.identity;
}

function inspectBuildx(directory, identity, layout, context) {
  if (!sameOwnedDirectory(directory, identity)) fail("postgres_attestation_access_cleanup_uncertain");
  const current = path.join(directory, "current");
  const expected = [".lock", ...BUILDX_DIRECTORIES, ...(existsSync(current) ? ["current"] : [])].sort();
  if (!isDeepStrictEqual(readdirSync(directory).sort(), expected)) fail("postgres_attestation_access_cleanup_uncertain");
  for (const name of BUILDX_DIRECTORIES) {
    const child = layout.directories[name];
    if (!sameOwnedDirectory(child.path, child.identity) || readdirSync(child.path).length !== 0) {
      fail("postgres_attestation_access_cleanup_uncertain");
    }
  }
  pinnedRegular(layout.lock.path, layout.lock.identity, context.uid, context.gid, { minimum: 0, maximum: 0 });
  return inspectBuildxCurrent(current, context);
}

function inspectAccessWork(context, owned) {
  if (!sameOwnedDirectory(context.work, owned.work)
    || !sameOwnedDirectory(owned.auth.path, owned.auth.identity)
    || !sameOwnedDirectory(owned.anonymous.path, owned.anonymous.identity)) {
    fail("postgres_attestation_access_cleanup_uncertain");
  }
  const expectedRoot = [path.basename(owned.anonymous.path), path.basename(owned.auth.path)].sort();
  if (!isDeepStrictEqual(readdirSync(context.work).sort(), expectedRoot)
    || !isDeepStrictEqual(readdirSync(owned.auth.path).sort(), ["buildx", ...(existsSync(owned.config) ? ["config.json"] : [])].sort())
    || !isDeepStrictEqual(readdirSync(owned.anonymous.path).sort(), ["buildx"])) {
    fail("postgres_attestation_access_cleanup_uncertain");
  }
  return Object.freeze({ config: inspectDockerConfig(owned.config, context),
    authCurrent: inspectBuildx(owned.authBuildx.path, owned.authBuildx.identity, owned.authBuildx.layout, context),
    anonymousCurrent: inspectBuildx(owned.anonymousBuildx.path, owned.anonymousBuildx.identity,
      owned.anonymousBuildx.layout, context) });
}

function unlinkPinned(file, identity, parent, parentIdentity, context) {
  if (!identity || !sameOwnedDirectory(parent, parentIdentity)) fail("postgres_attestation_access_cleanup_uncertain");
  pinnedRegular(file, identity, context.uid, context.gid, { minimum: identity.size, maximum: identity.size });
  unlinkSync(file);
  if (existsSync(file)) fail("postgres_attestation_access_cleanup_uncertain");
}

function removeOwnedAccessWork(context, owned) {
  const observed = inspectAccessWork(context, owned);
  if (observed.authCurrent) unlinkPinned(path.join(owned.authBuildx.path, "current"), observed.authCurrent,
    owned.authBuildx.path, owned.authBuildx.identity, context);
  if (observed.anonymousCurrent) unlinkPinned(path.join(owned.anonymousBuildx.path, "current"),
    observed.anonymousCurrent, owned.anonymousBuildx.path, owned.anonymousBuildx.identity, context);
  if (observed.config) unlinkPinned(owned.config, observed.config, owned.auth.path, owned.auth.identity, context);
  for (const buildx of [owned.authBuildx, owned.anonymousBuildx]) {
    unlinkPinned(buildx.layout.lock.path, buildx.layout.lock.identity, buildx.path, buildx.identity, context);
    for (const name of BUILDX_DIRECTORIES) {
      const child = buildx.layout.directories[name];
      if (!sameOwnedDirectory(child.path, child.identity) || readdirSync(child.path).length !== 0) {
        fail("postgres_attestation_access_cleanup_uncertain");
      }
      rmdirSync(child.path);
    }
    if (!sameOwnedDirectory(buildx.path, buildx.identity) || readdirSync(buildx.path).length !== 0) {
      fail("postgres_attestation_access_cleanup_uncertain");
    }
    rmdirSync(buildx.path);
  }
  rmdirSync(owned.auth.path); rmdirSync(owned.anonymous.path); rmdirSync(context.work);
  if (existsSync(context.work)) fail("postgres_attestation_access_cleanup_uncertain");
}

function accessCleanupFailure(primaryFailure, cleanupError) {
  return Object.assign(new Error("postgres_attestation_access_cleanup_uncertain", { cause: cleanupError }), {
    code: "postgres_attestation_access_cleanup_uncertain",
    phase: "credential_and_temporary_cleanup",
    primaryFailure: primaryFailure ? fixedReason(primaryFailure) : null,
    cleanupFailure: fixedReason(cleanupError),
  });
}

function phaseFailure(phase, error) {
  return Object.assign(new Error(fixedReason(error), { cause: error }), { code: fixedReason(error), phase });
}

export function publicPostgresAttestationAccessFailure(error) {
  const code = fixedPublicReason(error); const phase = PUBLIC_FAILURE_PHASES.includes(error?.phase) ? error.phase : "UNKNOWN";
  return Object.freeze({ code, phase,
    primaryFailure: error?.code === "postgres_attestation_access_cleanup_uncertain"
      ? (error.primaryFailure ? fixedPublicReason(error.primaryFailure) : "UNKNOWN") : code,
    cleanupFailure: error?.code === "postgres_attestation_access_cleanup_uncertain"
      ? fixedPublicReason(error.cleanupFailure) : "NOT_APPLICABLE" });
}

function boundedRegular(file, cap, uid) {
  let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(handle); const pathname = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || pathname.isSymbolicLink() || before.uid !== uid
      || (before.mode & 0o022) !== 0 || before.size < 2 || before.size > cap
      || before.dev !== pathname.dev || before.ino !== pathname.ino) fail("postgres_attestation_access_input_invalid");
    const bytes = readFileSync(handle); const after = fstatSync(handle);
    if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail("postgres_attestation_access_input_invalid");
    return bytes;
  } catch (error) {
    if (error?.message === "postgres_attestation_access_input_invalid") throw error;
    fail("postgres_attestation_access_input_invalid");
  } finally { if (handle !== undefined) closeSync(handle); }
}

function defaultReadCommitted(relative, context, commandRunner) {
  const working = boundedRegular(path.join(context.workspace, ...relative.split("/")), MAX_FILE_BYTES, context.uid);
  const result = commandRunner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: MAX_FILE_BYTES + 1, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0 || typeof result.stdout !== "string"
    || Buffer.byteLength(result.stdout) > MAX_FILE_BYTES || !Buffer.from(result.stdout).equals(working)) {
    fail("postgres_attestation_access_input_uncommitted");
  }
  return working;
}

async function boundedResponse(response) {
  if (response?.status !== 200 || !response.body) fail("postgres_attestation_access_main_invalid");
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_OUTPUT_BYTES) { await reader.cancel(); fail("postgres_attestation_access_main_invalid"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export async function verifyPostgresAttestationAccessMain(context, env, {
  commandRunner = defaultCommandRunner, fetchImpl = globalThis.fetch, timeoutMs = API_TIMEOUT_MS,
} = {}) {
  const token = env.GITHUB_TOKEN;
  if (typeof token !== "string" || token.length < 1 || token.length > 8192 || env.GH_TOKEN !== token
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > API_TIMEOUT_MS) {
    fail("postgres_attestation_access_environment_invalid");
  }
  const options = { cwd: context.workspace,
    env: { PATH: env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: MAX_OUTPUT_BYTES, timeoutMs: 60_000 };
  const status = commandRunner("git", ["status", "--porcelain=v1", "--untracked-files=all"], options);
  const head = commandRunner("git", ["rev-parse", "HEAD"], options);
  if (status?.error || status?.status !== 0 || typeof status.stdout !== "string" || status.stdout !== ""
    || head?.error || head?.status !== 0 || typeof head.stdout !== "string"
    || head.stdout.trim() !== context.recipeRevision) fail("postgres_attestation_access_checkout_invalid");
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(MAIN_BRANCH_URL, { redirect: "error", signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
        "User-Agent": "auto-world-postgres-attestation-access", "X-GitHub-Api-Version": "2022-11-28" } });
    const branch = parseJson(await boundedResponse(response), "postgres_attestation_access_main_invalid");
    if (branch?.name !== "main" || branch?.protected !== true || branch?.commit?.sha !== context.recipeRevision) {
      fail("postgres_attestation_access_main_invalid");
    }
    return true;
  } catch (error) {
    if (error?.message === "postgres_attestation_access_main_invalid") throw error;
    fail("postgres_attestation_access_main_invalid");
  } finally { globalThis.clearTimeout(timer); }
}

function toolIdentity(value) {
  const result = value.trim();
  if (result.length < 1 || result.length > 512 || /[^\x20-\x7e]/u.test(result)) {
    fail("postgres_attestation_access_tool_invalid");
  }
  return result;
}

function receiptShape(value) {
  return exactKeys(value, ["kind", "state", "authority", "repository", "workflowPath", "job", "ref",
    "runId", "runAttempt", "recipeRevision", "subject", "platform", "policy", "packageControls",
    "tools", "remoteManifest", "observations", "access", "operations", "support", "phases"])
    && value.kind === "POSTGRES_CANDIDATE_ATTESTATION_ACCESS_RECEIPT_V1" && value.state === "VERIFIED"
    && value.authority === "REMOTE_MANIFEST_ACCESS_ONLY"
    && value.repository === POSTGRES_ATTESTATION_ACCESS.repository
    && value.workflowPath === POSTGRES_ATTESTATION_ACCESS.workflowPath && value.job === "access"
    && value.ref === "refs/heads/main" && RUN_ID.test(value.runId) && value.runAttempt === "1"
    && REVISION.test(value.recipeRevision) && value.subject === POSTGRES_ATTESTATION_ACCESS.subject
    && value.platform === "linux/amd64"
    && exactKeys(value.policy, ["path", "sha256", "bytes"]) && value.policy.path === POSTGRES_ATTESTATION_ACCESS.policyPath
    && SHA256.test(value.policy.sha256) && Number.isSafeInteger(value.policy.bytes) && value.policy.bytes > 1
    && exactKeys(value.packageControls, ["path", "sha256", "bytes", "observation"])
    && value.packageControls.path === POSTGRES_ATTESTATION_ACCESS.controlsPath
    && SHA256.test(value.packageControls.sha256) && Number.isSafeInteger(value.packageControls.bytes)
    && value.packageControls.bytes > 1 && plain(value.packageControls.observation)
    && exactKeys(value.tools, ["docker", "buildx", "trustBoundary"])
    && typeof value.tools.docker === "string" && typeof value.tools.buildx === "string"
    && value.tools.trustBoundary === "MANAGED_GITHUB_HOSTED_DOCKER_BUILDX"
    && value.remoteManifest?.state === "RAW_MANIFEST_VERIFIED"
    && value.remoteManifest?.digest === value.subject.slice(value.subject.indexOf("@") + 1)
    && exactKeys(value.observations, ["startedAt", "authorizedBeforeAt", "anonymousDeniedAt",
      "authorizedAfterAt", "completedAt"])
    && Object.values(value.observations).every(instant)
    && Date.parse(value.observations.startedAt) <= Date.parse(value.observations.authorizedBeforeAt)
    && Date.parse(value.observations.authorizedBeforeAt) <= Date.parse(value.observations.anonymousDeniedAt)
    && Date.parse(value.observations.anonymousDeniedAt) <= Date.parse(value.observations.authorizedAfterAt)
    && Date.parse(value.observations.authorizedAfterAt) <= Date.parse(value.observations.completedAt)
    && exactKeys(value.access, ["authorizedBefore", "anonymous", "authorizedAfter", "manifestBytesIdentical",
      "packageConfigurationAuthority", "forkAccessTest", "forkIsolation"])
    && value.access.authorizedBefore === "VERIFIED" && value.access.anonymous === "AUTHORIZATION_DENIED"
    && value.access.authorizedAfter === "VERIFIED" && value.access.manifestBytesIdentical === true
    && value.access.packageConfigurationAuthority === "SETTINGS_UI_OBSERVATION_ONLY"
    && value.access.forkAccessTest === "SKIPPED_BY_USER" && value.access.forkIsolation === "NOT_VERIFIED"
    && exactKeys(value.operations, ["publication", "registryWrite", "imagePull", "imageSave", "imageExecution",
      "signing", "admission", "credentialCleanup", "temporaryCleanup"])
    && Object.entries(value.operations).every(([key, item]) => ["credentialCleanup", "temporaryCleanup"].includes(key)
      ? item === "VERIFIED" : item === (key === "admission" ? "NOT_AUTHORIZED" : "NOT_ATTEMPTED"))
    && exactKeys(value.support, ["supportStartedAt", "supportEndsAt", "archiveUntil"])
    && value.support.supportStartedAt === null && value.support.supportEndsAt === null
    && value.support.archiveUntil === null
    && Array.isArray(value.phases) && value.phases.length === PHASE_NAMES.length
    && isDeepStrictEqual(value.phases.map((phase) => phase?.name), PHASE_NAMES)
    && value.phases.every((phase) => exactKeys(phase, ["name", "result", "durationMs"])
      && phase.result === "PASSED" && Number.isSafeInteger(phase.durationMs) && phase.durationMs >= 0);
}

export function validatePostgresAttestationAccessReceipt(value, policyInput, binding) {
  if (Object.hasOwn(Object.prototype, "toJSON") || Object.hasOwn(Array.prototype, "toJSON")) {
    fail("postgres_attestation_access_receipt_invalid");
  }
  value = data(value, "postgres_attestation_access_receipt_invalid");
  binding = data(binding, "postgres_attestation_access_receipt_invalid");
  const policy = validatePostgresRemotePolicy(data(policyInput, "postgres_attestation_access_receipt_invalid"));
  const committedPolicyBytes = readFileSync(new URL("../../infra/postgres-image/candidate-remote.json", import.meta.url));
  const committedPolicyIdentity = identity(committedPolicyBytes);
  let committedPolicy;
  try { committedPolicy = validatePostgresRemotePolicy(JSON.parse(committedPolicyBytes.toString("utf8"))); }
  catch { fail("postgres_attestation_access_receipt_invalid"); }
  let validatedControls;
  try { validatedControls = validatePostgresPackageControls(value?.packageControls?.observation); }
  catch { fail("postgres_attestation_access_receipt_invalid"); }
  if (!exactKeys(binding, ["runId", "recipeRevision", "controlsIdentity"])
    || !RUN_ID.test(binding.runId ?? "") || !REVISION.test(binding.recipeRevision ?? "")
    || !exactKeys(binding.controlsIdentity, ["sha256", "bytes"])
    || !SHA256.test(binding.controlsIdentity.sha256 ?? "")
    || !Number.isSafeInteger(binding.controlsIdentity.bytes) || binding.controlsIdentity.bytes < 2
    || !receiptShape(value) || value.runId !== binding.runId
    || value.recipeRevision !== binding.recipeRevision || value.subject !== policy.subject
    || value.platform !== policy.platform || !isDeepStrictEqual(policy, committedPolicy)
    || !isDeepStrictEqual(value.policy, { path: POSTGRES_ATTESTATION_ACCESS.policyPath, ...committedPolicyIdentity })
    || !isDeepStrictEqual(value.remoteManifest.config, policy.manifest.config)
    || !isDeepStrictEqual(value.remoteManifest.layers, policy.manifest.layers)
    || value.remoteManifest.bytes !== policy.manifest.bytes
    || value.packageControls.sha256 !== binding.controlsIdentity.sha256
    || value.packageControls.bytes !== binding.controlsIdentity.bytes
    || !isDeepStrictEqual(validatedControls, value.packageControls.observation)) {
    fail("postgres_attestation_access_receipt_invalid");
  }
  const bytes = Buffer.from(`${encode(value)}\n`, "utf8");
  if (bytes.length > MAX_OUTPUT_BYTES || SENSITIVE.test(bytes.toString("utf8"))) {
    fail("postgres_attestation_access_receipt_invalid");
  }
  return cloneFrozen(value);
}

function writeReceipt(context, value) {
  makePrivateDirectory(context.output, context.runnerTemp, context.uid, context.gid);
  const bytes = Buffer.from(`${encode(data(value, "postgres_attestation_access_receipt_write_invalid"))}\n`, "utf8");
  let handle;
  try {
    handle = openSync(path.join(context.output, "access-receipt.json"),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(handle, 0o600); writeFileSync(handle, bytes);
    const info = fstatSync(handle);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== context.uid || (info.mode & 0o777) !== 0o600
      || info.size !== bytes.length || info.size > MAX_OUTPUT_BYTES) fail("postgres_attestation_access_receipt_write_invalid");
  } catch (error) {
    if (/^postgres_attestation_access_/u.test(error?.message ?? "")) throw error;
    fail("postgres_attestation_access_receipt_write_invalid");
  } finally { if (handle !== undefined) closeSync(handle); }
  return bytes;
}

export async function collectPostgresAttestationAccess(input, env = process.env, dependencies = {}) {
  if (!exactKeys(input, ["now"]) || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())
    || !plain(dependencies) || Object.keys(dependencies).some((key) => !["context", "commandRunner", "fetchImpl",
      "readCommitted", "now", "policyValidator", "manifestValidator", "anonymousClassifier"].includes(key))) {
    fail("postgres_attestation_access_arguments_invalid");
  }
  const context = requirePostgresAttestationAccessContext(env, dependencies.context);
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const readCommitted = dependencies.readCommitted ?? ((relative) => defaultReadCommitted(relative, context, commandRunner));
  const now = dependencies.now ?? (() => new Date());
  const policyValidator = dependencies.policyValidator ?? validatePostgresRemotePolicy;
  const manifestValidator = dependencies.manifestValidator ?? validatePostgresRemoteRawManifest;
  const anonymousClassifier = dependencies.anonymousClassifier ?? classifyAnonymousRemoteRead;
  if (existsSync(context.work) || existsSync(context.output)) fail("postgres_attestation_access_path_invalid");
  const workIdentity = makePrivateDirectory(context.work, context.runnerTemp, context.uid, context.gid);
  const auth = path.join(context.work, "docker-auth"); const anonymous = path.join(context.work, "docker-anonymous");
  const authIdentity = makePrivateDirectory(auth, context.work, context.uid, context.gid);
  const anonymousIdentity = makePrivateDirectory(anonymous, context.work, context.uid, context.gid);
  const authBuildx = path.join(auth, "buildx"); const anonymousBuildx = path.join(anonymous, "buildx");
  const authBuildxIdentity = makePrivateDirectory(authBuildx, auth, context.uid, context.gid);
  const anonymousBuildxIdentity = makePrivateDirectory(anonymousBuildx, anonymous, context.uid, context.gid);
  const authBuildxLayout = buildxLayout(authBuildx, context.uid, context.gid);
  const anonymousBuildxLayout = buildxLayout(anonymousBuildx, context.uid, context.gid);
  const owned = { work: workIdentity, auth: { path: auth, identity: authIdentity },
    anonymous: { path: anonymous, identity: anonymousIdentity },
    config: path.join(auth, "config.json"),
    authBuildx: { path: authBuildx, identity: authBuildxIdentity, layout: authBuildxLayout },
    anonymousBuildx: { path: anonymousBuildx, identity: anonymousBuildxIdentity, layout: anonymousBuildxLayout } };
  const authOptions = { cwd: context.work, env: commandEnvironment(env, auth, context.work),
    maxBuffer: MAX_OUTPUT_BYTES, timeoutMs: COMMAND_TIMEOUT_MS };
  const anonymousOptions = { ...authOptions, env: commandEnvironment(env, anonymous, context.work) };
  const phases = []; const startedAt = input.now.toISOString(); let primaryFailure; let receipt; let committed;
  const phase = async (name, operation) => {
    const phaseStarted = Date.now();
    try { const result = await operation(); phases.push({ name, result: "PASSED", durationMs: Date.now() - phaseStarted }); return result; }
    catch (error) {
      phases.push({ name, result: "FAILED", durationMs: Date.now() - phaseStarted });
      throw phaseFailure(name, error);
    }
  };
  try {
    await phase("protected_main_and_checkout", () => verifyPostgresAttestationAccessMain(context, env,
      { commandRunner, fetchImpl }));
    committed = await phase("committed_policy_and_controls", () => {
      const policyBytes = readCommitted(POSTGRES_ATTESTATION_ACCESS.policyPath);
      const controlsBytes = readCommitted(POSTGRES_ATTESTATION_ACCESS.controlsPath);
      if (!Buffer.isBuffer(policyBytes) || !Buffer.isBuffer(controlsBytes)
        || policyBytes.length > MAX_FILE_BYTES || controlsBytes.length > MAX_FILE_BYTES) {
        fail("postgres_attestation_access_input_invalid");
      }
      const policy = policyValidator(parseJson(policyBytes, "postgres_attestation_access_input_invalid"));
      const controls = validatePostgresPackageControls(parseJson(controlsBytes, "postgres_attestation_access_input_invalid"));
      if (policy.subject !== POSTGRES_ATTESTATION_ACCESS.subject) fail("postgres_attestation_access_input_invalid");
      return { policy, controls, policyBytes, controlsBytes };
    });
    const tools = await phase("managed_tool_identity", () => ({
      docker: toolIdentity(run(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], authOptions).stdout),
      buildx: toolIdentity(run(commandRunner, "docker", ["buildx", "version"], authOptions).stdout),
      trustBoundary: "MANAGED_GITHUB_HOSTED_DOCKER_BUILDX",
    }));
    await phase("authorized_registry_login", () => {
      if (typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN.length < 1 || env.GITHUB_TOKEN.length > 8192
        || env.GH_TOKEN !== env.GITHUB_TOKEN) fail("postgres_attestation_access_environment_invalid");
      run(commandRunner, "docker", ["login", "ghcr.io", "--username", committed.policy.owner, "--password-stdin"],
        { ...authOptions, input: `${env.GITHUB_TOKEN}\n` });
    });
    const authorizedBeforeAt = nowIso(now);
    const before = await phase("authorized_manifest_before", () => {
      const raw = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", committed.policy.subject], authOptions).stdout;
      return { raw, proof: manifestValidator(raw, committed.policy) };
    });
    const anonymousDeniedAt = nowIso(now);
    await phase("anonymous_manifest_denied", () => {
      const result = observe(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", committed.policy.subject], anonymousOptions);
      if (anonymousClassifier(result) !== "AUTHORIZATION_DENIED") fail("postgres_attestation_access_privacy_invalid");
    });
    const authorizedAfterAt = nowIso(now);
    const after = await phase("authorized_manifest_after", () => {
      const raw = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", committed.policy.subject], authOptions).stdout;
      const proof = manifestValidator(raw, committed.policy);
      if (raw !== before.raw || !isDeepStrictEqual(proof, before.proof)) fail("postgres_attestation_access_manifest_changed");
      return { raw, proof };
    });
    receipt = { kind: "POSTGRES_CANDIDATE_ATTESTATION_ACCESS_RECEIPT_V1", state: "VERIFIED",
      authority: "REMOTE_MANIFEST_ACCESS_ONLY", repository: POSTGRES_ATTESTATION_ACCESS.repository,
      workflowPath: POSTGRES_ATTESTATION_ACCESS.workflowPath, job: "access", ref: "refs/heads/main",
      runId: context.runId, runAttempt: "1", recipeRevision: context.recipeRevision,
      subject: committed.policy.subject, platform: committed.policy.platform,
      policy: { path: POSTGRES_ATTESTATION_ACCESS.policyPath, ...identity(committed.policyBytes) },
      packageControls: { path: POSTGRES_ATTESTATION_ACCESS.controlsPath, ...identity(committed.controlsBytes),
        observation: committed.controls }, tools, remoteManifest: after.proof,
      observations: { startedAt, authorizedBeforeAt, anonymousDeniedAt, authorizedAfterAt, completedAt: authorizedAfterAt },
      access: { authorizedBefore: "VERIFIED", anonymous: "AUTHORIZATION_DENIED", authorizedAfter: "VERIFIED",
        manifestBytesIdentical: true, packageConfigurationAuthority: "SETTINGS_UI_OBSERVATION_ONLY",
        forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED" },
      operations: { publication: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", imagePull: "NOT_ATTEMPTED",
        imageSave: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED",
        admission: "NOT_AUTHORIZED", credentialCleanup: "VERIFIED", temporaryCleanup: "VERIFIED" },
      support: { supportStartedAt: null, supportEndsAt: null, archiveUntil: null }, phases };
  } catch (error) { primaryFailure = error; }

  const cleanupStarted = Date.now(); let cleanupError;
  try {
    removeOwnedAccessWork(context, owned);
  } catch (error) { cleanupError = error; }
  phases.push({ name: "credential_and_temporary_cleanup", result: cleanupError ? "FAILED" : "PASSED",
    durationMs: Date.now() - cleanupStarted });
  if (cleanupError) throw accessCleanupFailure(primaryFailure, cleanupError);
  if (primaryFailure) throw primaryFailure;
  receipt.observations.completedAt = nowIso(now);
  const validated = validatePostgresAttestationAccessReceipt(receipt, committed.policy,
    { runId: context.runId, recipeRevision: context.recipeRevision,
      controlsIdentity: identity(committed.controlsBytes) });
  writeReceipt(context, validated);
  return validated;
}

export async function runPostgresAttestationAccess(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (!isDeepStrictEqual(argv, ["execute"])) fail("postgres_attestation_access_arguments_invalid");
  return collectPostgresAttestationAccess({ now: new Date() }, env, dependencies);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { await runPostgresAttestationAccess(); }
  catch (error) { console.error(encode(publicPostgresAttestationAccessFailure(error))); process.exitCode = 1; }
}
