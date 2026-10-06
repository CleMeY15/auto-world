import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, chownSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync,
  linkSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync,
  readdirSync, unlinkSync, writeSync,
} from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { openPostgresAdmissionAuthority } from "./admission-authority.mjs";
import {
  getPostgresAdmissionImageArchiveSource,
  loadPostgresAdmissionArchiveContext,
  verifyPostgresAdmissionArchiveFast,
} from "./admission-archive-maintenance.mjs";
import {
  createPostgresRuntimeDaemonHelper,
  postgresRuntimeDaemonConfiguration,
} from "../docker-isolated/daemon-postgres-runtime-helper.mjs";
import {
  validatePostgresRuntimeDaemonInfo,
  validatePostgresRuntimeDaemonStartProof,
  validatePostgresRuntimeDaemonStopProof,
} from "../docker-isolated/daemon-postgres-runtime.mjs";
import { createPostgresAdmissionObservability } from "./admission-observability.mjs";

const KIND = "POSTGRES_SUPPORTED_SESSION_V1";
const INTENTS = Object.freeze(["SERVICE", "SQL_CHECK", "MIGRATION", "BACKUP", "RESTORE_VERIFY"]);
const COMMON_PHASES = Object.freeze([
  "AUTHORITY", "IMAGE_ACQUIRE", "DAEMON_START", "IMAGE_LOAD", "VOLUME_CREATE",
  "CONTAINER_CREATE", "CONTAINER_START", "READINESS",
]);
const PHASES = Object.freeze([
  ...COMMON_PHASES, "SERVICE", "SQL_CHECK", "MIGRATION", "BACKUP", "RESTORE_VERIFY", "STOP", "CLEANUP",
]);
const RESULT_PHASES = Object.freeze(Object.fromEntries(INTENTS.filter((intent) => intent !== "MIGRATION")
  .map((intent) => [intent, Object.freeze([...COMMON_PHASES, intent, "STOP", "CLEANUP"])])));
const FAILURE_CODES = new Set([
  "postgres_admission_arguments_invalid", "postgres_admission_authority_denied",
  "postgres_admission_execution_files_invalid", "postgres_admission_archive_invalid",
  "postgres_admission_daemon_invalid", "postgres_admission_image_invalid",
  "postgres_admission_volume_invalid", "postgres_admission_container_invalid",
  "postgres_admission_readiness_failed", "postgres_admission_sql_check_failed",
  "postgres_admission_migration_contract_unavailable", "postgres_admission_backup_failed",
  "postgres_admission_restore_failed", "postgres_admission_lease_expired",
  "postgres_admission_operation_cancelled", "postgres_admission_cleanup_uncertain",
  "postgres_admission_observability_sink_failed",
  "postgres_admission_authority_revoked",
]);
const ROOT = "/opt/auto-world/postgres-admission";
const BACKUPS = path.join(ROOT, "backups");
const DATA_BINDING = "postgres-data-binding.json";
const DOCKER = "/usr/bin/docker";
const DOCKERD = "/usr/bin/dockerd";
const CONTAINERD = "/run/containerd/containerd.sock";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT_CAP = 1024 ** 2;
const ARCHIVE_CAP = 4 * 1024 ** 3;
const CHUNK = 1024 ** 2;
const LEASE_RENEW_AT = 35_000;
const RENEWAL_BUDGET = 20_000;
const RENEWAL_DRAIN_BUFFER = 5_000;
const WATCH_INTERVAL = 1_000;
const DRAIN_MS = 30_000;
const OPERATION_MINIMUM = 5_000;
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const caps = new WeakMap();
let sessionActive = false;

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, names) => plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...names].sort());
const freeze = (value) => Array.isArray(value) ? Object.freeze(value.map(freeze)) : plain(value)
  ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)]))) : value;
const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const prettyBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function fail(code, phase, cause) {
  throw Object.assign(new Error(code), { phase, cause: cause instanceof Error ? cause : undefined });
}

function postgresIdentity(value, phase = "VOLUME_CREATE") {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) fail("postgres_admission_volume_invalid", phase);
  return value;
}

function assertNoSinkFailure(state, phase) {
  if (state.sinkFailure) throw Object.assign(state.sinkFailure, { phase });
}

function observationReason(error) {
  const reasons = {
    postgres_admission_authority_denied: "AUTHORITY_INVALID",
    postgres_admission_execution_files_invalid: "AUTHORITY_INVALID",
    postgres_admission_archive_invalid: "ARCHIVE_MISMATCH",
    postgres_admission_daemon_invalid: "DAEMON_SUBSTITUTED",
    postgres_admission_lease_expired: "DEADLINE_EXCEEDED",
    postgres_admission_operation_cancelled: "CANCELLED",
    postgres_admission_cleanup_uncertain: "CLEANUP_UNCERTAIN",
    postgres_admission_authority_revoked: "REVOKED",
  };
  return reasons[error?.message] ?? "OPERATION_FAILED";
}

function observe(state, method, value, phase) {
  try { return state.observability[method](value); }
  catch (error) { fail("postgres_admission_observability_sink_failed", phase, error); }
}

function observeCurrentness(state, phase = "AUTHORITY") {
  const source = state.binding?.currentness;
  const names = ["p2ValidUntil", "p3SettingsValidUntil", "p3ManifestValidUntil", "archiveValidUntil", "supportValidUntil"];
  if (!exact(source, names)) fail("postgres_admission_authority_denied", phase);
  const remaining = Object.fromEntries(names.map(name => {
    const milliseconds = Date.parse(source[name]);
    if (typeof source[name] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(source[name])
      || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== source[name]) {
      fail("postgres_admission_authority_denied", phase);
    }
    return [name, Math.max(0, (milliseconds - Date.now()) / 1000)];
  }));
  observe(state, "currentness", {
    p2SecondsRemaining: remaining.p2ValidUntil,
    p3SettingsSecondsRemaining: remaining.p3SettingsValidUntil,
    p3ManifestSecondsRemaining: remaining.p3ManifestValidUntil,
    archiveHealthSecondsRemaining: remaining.archiveValidUntil,
    supportSecondsRemaining: remaining.supportValidUntil,
  }, phase);
  const expired = [
    ["p2ValidUntil", "P2_EXPIRED", "P2_WARNING", "P2_STALE"],
    ["p3SettingsValidUntil", "P3_SETTINGS_EXPIRED", "P3_SETTINGS_WARNING", "P3_SETTINGS_STALE"],
    ["p3ManifestValidUntil", "P3_MANIFEST_EXPIRED", "P3_MANIFEST_WARNING", "P3_MANIFEST_STALE"],
    ["archiveValidUntil", "ARCHIVE_EXPIRED", "ARCHIVE_WARNING", "ARCHIVE_STALE"],
  ];
  for (const [name, expiredAlert, warningAlert, reason] of expired) {
    if (remaining[name] === 0) observe(state, "alert", { alert: expiredAlert, severity: "CRITICAL", reason, durationMs: 0,
      publicId: state.binding.revisionSha256 }, phase);
    else if (remaining[name] <= 60) observe(state, "alert", { alert: warningAlert, severity: "WARNING", reason: "NONE",
      durationMs: 0, publicId: state.binding.revisionSha256 }, phase);
  }
}

async function observedPhase(state, phase, action) {
  state.phases.push(phase);
  const started = performance.now();
  try {
    const result = await action();
    assertNoSinkFailure(state, phase);
    observe(state, "phase", { phase, result: "SUCCEEDED", reason: "NONE",
      durationMs: Math.max(0, performance.now() - started) }, phase);
    return result;
  } catch (error) {
    if (error?.message === "postgres_admission_observability_sink_failed") throw error;
    observe(state, "phase", { phase, result: "FAILED", reason: observationReason(error),
      durationMs: Math.max(0, performance.now() - started) }, phase);
    throw error;
  }
}

export function validatePostgresSupportedSessionInput(value) {
  if (!exact(value, ["kind", "intent"]) || value.kind !== KIND || !INTENTS.includes(value.intent)) {
    fail("postgres_admission_arguments_invalid", "AUTHORITY");
  }
  return freeze({ kind: KIND, intent: value.intent });
}

export function postgresAdmissionFailureDiagnostic(error, intent = "SERVICE") {
  let code = "postgres_admission_authority_denied";
  let phase = "AUTHORITY";
  try {
    if (FAILURE_CODES.has(error?.message)) code = error.message;
    if (PHASES.includes(error?.phase)) phase = error.phase;
  } catch { /* Diagnostic construction is closed. */ }
  return freeze({
    kind: "POSTGRES_SUPPORTED_SESSION_FAILURE_V1", state: "FAILED",
    intent: INTENTS.includes(intent) ? intent : "SERVICE", phase, code,
  });
}

export function validatePostgresAdmissionFailureDiagnostic(value) {
  if (!exact(value, ["kind", "state", "intent", "phase", "code"])
    || value.kind !== "POSTGRES_SUPPORTED_SESSION_FAILURE_V1" || value.state !== "FAILED"
    || !INTENTS.includes(value.intent) || !PHASES.includes(value.phase) || !FAILURE_CODES.has(value.code)) {
    fail("postgres_admission_arguments_invalid", "AUTHORITY");
  }
  return freeze({ ...value });
}

export function validatePostgresSupportedSessionResult(value) {
  const expectedPhases = RESULT_PHASES[value?.intent];
  if (!exact(value, ["kind", "state", "intent", "admissionGeneration", "authorityRevision", "resolvedMainSha", "phases", "cleanup"])
    || value.kind !== "POSTGRES_SUPPORTED_SESSION_RESULT_V1" || value.state !== "COMPLETED" || !expectedPhases
    || !Number.isSafeInteger(value.admissionGeneration) || value.admissionGeneration < 1
    || !Number.isSafeInteger(value.authorityRevision) || value.authorityRevision < 1
    || typeof value.resolvedMainSha !== "string" || !COMMIT.test(value.resolvedMainSha)
    || !isDeepStrictEqual(value.phases, expectedPhases)
    || !isDeepStrictEqual(value.cleanup, {
      containers: "REMOVED", image: "REMOVED", daemon: "STOPPED", volumes: "PRESERVED", backups: "PRESERVED",
    })) fail("postgres_admission_arguments_invalid", "AUTHORITY");
  return freeze({ ...value, phases: [...value.phases], cleanup: { ...value.cleanup } });
}

function childEnvironment(home, dockerConfig) {
  return Object.freeze({
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: home, DOCKER_CONFIG: dockerConfig,
  });
}

function createDirectory(directory, mode, gid = 0) {
  mkdirSync(directory, { mode, recursive: false });
  chownSync(directory, 0, gid);
  chmodSync(directory, mode);
  const observed = lstatSync(directory, { bigint: true });
  if (!observed.isDirectory() || observed.isSymbolicLink() || observed.uid !== 0n || observed.gid !== BigInt(gid)
    || (observed.mode & 0o7777n) !== BigInt(mode) || realpathSync(directory) !== directory) {
    fail("postgres_admission_daemon_invalid", "DAEMON_START");
  }
}

function ownedDirectory(directory, uid, gid, mode = 0o700) {
  const observed = lstatSync(directory, { bigint: true });
  if (!observed.isDirectory() || observed.isSymbolicLink() || observed.uid !== BigInt(uid) || observed.gid !== BigInt(gid)
    || (observed.mode & 0o7777n) !== BigInt(mode) || realpathSync(directory) !== directory) {
    fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  }
  return observed;
}

function exists(file) {
  try { lstatSync(file); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function syncDirectory(directory) {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeExclusive(file, raw, mode = 0o600) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  let failure;
  try {
    let offset = 0;
    while (offset < raw.length) {
      const count = writeSync(fd, raw, offset, raw.length - offset, offset);
      if (count < 1) fail("postgres_admission_daemon_invalid", "DAEMON_START");
      offset += count;
    }
    fchmodSync(fd, mode);
    fsyncSync(fd);
  } catch (error) { failure = error; }
  finally {
    try { closeSync(fd); } catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}

function nativeIdentity(stat) {
  return freeze({
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs),
  });
}

function parentIdentity(stat) {
  return freeze({
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode & 0o7777n),
  });
}

function socketIdentity(stat) {
  return freeze({
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink),
  });
}

function dataIdentity(stat) {
  return freeze({
    dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode & 0o7777n),
  });
}

function readDataBinding(file) {
  const before = lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0n || before.gid !== 0n || before.nlink !== 1n
    || (before.mode & 0o7777n) !== 0o400n || before.size < 2n || before.size > 4096n || realpathSync(file) !== file) {
    fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  }
  const raw = readFileSync(file);
  const after = lstatSync(file, { bigint: true });
  if (!isDeepStrictEqual(nativeIdentity(before), nativeIdentity(after)) || raw.length !== Number(before.size)) {
    fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  }
  let value;
  try { value = JSON.parse(raw); } catch (error) { fail("postgres_admission_volume_invalid", "VOLUME_CREATE", error); }
  if (!raw.equals(canonicalBytes(value))) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  return value;
}

async function materializeArchive(state, source, target) {
  if (!exact(source, ["path", "size", "sha256", "nativeIdentity", "parentIdentity"])
    || typeof source.path !== "string" || !path.isAbsolute(source.path) || !Number.isSafeInteger(source.size)
    || source.size < 1 || source.size > ARCHIVE_CAP || !SHA256.test(source.sha256)
    || !exact(source.nativeIdentity, ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"])
    || !exact(source.parentIdentity, ["dev", "ino", "uid", "gid", "mode"])) {
    fail("postgres_admission_archive_invalid", "IMAGE_ACQUIRE");
  }
  const parent = path.dirname(source.path);
  const beforeParent = lstatSync(parent, { bigint: true });
  const before = lstatSync(source.path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(source.size)
    || !beforeParent.isDirectory() || beforeParent.isSymbolicLink() || realpathSync(source.path) !== source.path
    || !isDeepStrictEqual(nativeIdentity(before), source.nativeIdentity)
    || !isDeepStrictEqual(parentIdentity(beforeParent), source.parentIdentity)) {
    fail("postgres_admission_archive_invalid", "IMAGE_ACQUIRE");
  }
  const input = openSync(source.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const output = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400);
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(CHUNK);
  let total = 0;
  let failure;
  try {
    while (total < source.size) {
      if (performance.now() >= state.binding.deadlineMonotonic) fail("postgres_admission_lease_expired", "IMAGE_ACQUIRE");
      const count = readSync(input, buffer, 0, Math.min(buffer.length, source.size - total), null);
      if (count < 1) fail("postgres_admission_archive_invalid", "IMAGE_ACQUIRE");
      hash.update(buffer.subarray(0, count));
      let written = 0;
      while (written < count) {
        const value = writeSync(output, buffer, written, count - written, total + written);
        if (value < 1) fail("postgres_admission_archive_invalid", "IMAGE_ACQUIRE");
        written += value;
      }
      total += count;
      await assertLease(state, "IMAGE_ACQUIRE", OPERATION_MINIMUM);
      await delay(0, undefined, { signal: state.abort.signal });
    }
    if (readSync(input, buffer, 0, 1, null) !== 0 || hash.digest("hex") !== source.sha256) {
      fail("postgres_admission_archive_invalid", "IMAGE_ACQUIRE");
    }
    const after = fstatSync(input, { bigint: true });
    const final = lstatSync(source.path, { bigint: true });
    const finalParent = lstatSync(parent, { bigint: true });
    if (!isDeepStrictEqual(nativeIdentity(after), source.nativeIdentity)
      || !isDeepStrictEqual(nativeIdentity(final), source.nativeIdentity)
      || !isDeepStrictEqual(parentIdentity(finalParent), source.parentIdentity)
      || finalParent.mtimeNs !== beforeParent.mtimeNs || finalParent.ctimeNs !== beforeParent.ctimeNs) {
      fail("postgres_admission_archive_invalid", "IMAGE_ACQUIRE");
    }
    fchmodSync(output, 0o400);
    fsyncSync(output);
  } catch (error) { failure = error; throw error; }
  finally {
    for (const fd of [output, input]) {
      try { closeSync(fd); } catch (error) { if (!failure) failure = error; }
    }
    if (failure && !FAILURE_CODES.has(failure.message)) fail("postgres_admission_archive_invalid", "IMAGE_ACQUIRE", failure);
  }
}

function verifyExecutionFiles(generationRoot) {
  if (!Array.isArray(generationRoot?.executionFiles) || generationRoot.executionFiles.length < 2) {
    fail("postgres_admission_execution_files_invalid", "AUTHORITY");
  }
  const expected = new Map();
  let previous = "";
  for (const item of generationRoot.executionFiles) {
    if (!exact(item, ["path", "size", "sha256"]) || typeof item.path !== "string" || path.isAbsolute(item.path)
      || item.path.includes("\\") || item.path.split("/").includes("..") || expected.has(item.path)
      || !Number.isSafeInteger(item.size) || item.size < 1 || !SHA256.test(item.sha256)) {
      fail("postgres_admission_execution_files_invalid", "AUTHORITY");
    }
    if (item.path <= previous) fail("postgres_admission_execution_files_invalid", "AUTHORITY");
    previous = item.path;
    expected.set(item.path, item);
  }
  for (const required of ["scripts/postgres-image/admission-broker.mjs", "scripts/postgres-image/admitted-postgres.mjs"]) {
    if (!expected.has(required)) fail("postgres_admission_execution_files_invalid", "AUTHORITY");
  }
  for (const pin of expected.values()) {
    const file = path.resolve(REPOSITORY_ROOT, ...pin.path.split("/"));
    if (!file.startsWith(`${REPOSITORY_ROOT}${path.sep}`) || realpathSync(file) !== file) {
      fail("postgres_admission_execution_files_invalid", "AUTHORITY");
    }
    const before = lstatSync(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(pin.size)) {
      fail("postgres_admission_execution_files_invalid", "AUTHORITY");
    }
    const raw = readFileSync(file);
    const after = lstatSync(file, { bigint: true });
    if (raw.length !== pin.size || sha256(raw) !== pin.sha256
      || !isDeepStrictEqual(nativeIdentity(before), nativeIdentity(after))) {
      fail("postgres_admission_execution_files_invalid", "AUTHORITY");
    }
  }
}

function operationCap(state, phase) {
  assertNoSinkFailure(state, phase);
  if (!PHASES.includes(phase) || state.draining || state.operationBusy) {
    fail("postgres_admission_operation_cancelled", phase);
  }
  const now = performance.now();
  if (state.binding.deadlineMonotonic - now < OPERATION_MINIMUM) fail("postgres_admission_lease_expired", phase);
  const cap = Object.freeze({});
  caps.set(cap, { state, phase, consumed: false, deadline: now + OPERATION_MINIMUM,
    lease: state.lease, binding: state.binding, endpoint: state.endpoint, daemonChild: state.daemonChild,
    socketIdentity: state.socketIdentity, imageLoaded: state.imageLoaded,
    volume: state.volume, container: state.container });
  return cap;
}

function consumeOperation(cap, state, phase) {
  const record = caps.get(cap);
  if (!record || record.state !== state || record.phase !== phase || record.consumed
    || record.deadline < performance.now() || state.draining || state.operationBusy
    || record.lease !== state.lease || record.binding !== state.binding || record.endpoint !== state.endpoint
    || record.daemonChild !== state.daemonChild || record.socketIdentity !== state.socketIdentity
    || record.imageLoaded !== state.imageLoaded || record.volume !== state.volume || record.container !== state.container) {
    fail("postgres_admission_operation_cancelled", phase);
  }
  record.consumed = true;
  state.operationBusy = true;
}

function spawnBounded(state, phase, command, args, options = {}) {
  if (!options.cleanup) consumeOperation(operationCap(state, phase), state, phase);
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let forcedFailure;
    const stdout = [];
    const stderr = [];
    let out = 0;
    let err = 0;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) globalThis.clearTimeout(timer);
      if (state.activeChild === child) state.activeChild = undefined;
      if (!options.cleanup) state.operationBusy = false;
      if (error) reject(error); else resolve(result);
    };
    try {
      child = spawn(command, args, {
        cwd: options.cwd, env: options.env,
        stdio: options.stdio ?? ["ignore", "pipe", "pipe"], detached: false, windowsHide: true,
      });
      state.activeChild = child;
      timer = globalThis.setTimeout(() => {
        forcedFailure ??= Object.assign(new Error(options.failureCode ?? "postgres_admission_operation_cancelled"), { phase });
        child.kill("SIGKILL");
      }, options.timeoutMs ?? 10_000);
    } catch (error) {
      finish(Object.assign(new Error(options.failureCode ?? "postgres_admission_operation_cancelled"), { phase, cause: error }));
      return;
    }
    child.once("error", (error) => finish(Object.assign(
      new Error(options.failureCode ?? "postgres_admission_operation_cancelled"), { phase, cause: error },
    )));
    child.stdout?.on("data", (chunk) => {
      out += chunk.length;
      if (out > (options.stdoutLimit ?? OUTPUT_CAP)) {
        forcedFailure ??= Object.assign(new Error(options.failureCode ?? "postgres_admission_operation_cancelled"), { phase });
        child.kill("SIGKILL");
      } else stdout.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      err += chunk.length;
      if (err > (options.stderrLimit ?? OUTPUT_CAP)) {
        forcedFailure ??= Object.assign(new Error(options.failureCode ?? "postgres_admission_operation_cancelled"), { phase });
        child.kill("SIGKILL");
      } else stderr.push(Buffer.from(chunk));
    });
    child.once("close", (code, signal) => {
      const result = { code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
      const allowed = options.allowed ?? [0];
      if (forcedFailure) finish(forcedFailure);
      else if (!allowed.includes(code) || signal !== null || (!options.allowStderr && result.stderr.length !== 0)) {
        finish(Object.assign(new Error(options.failureCode ?? "postgres_admission_operation_cancelled"), { phase }));
      } else finish(undefined, result);
    });
  });
}

async function daemonGuard(state, phase, signal = state.abort.signal) {
  if (!state.helper || !state.daemonChild || !state.socketIdentity) fail("postgres_admission_daemon_invalid", phase);
  try {
    const proof = await state.helper.verify(state.spec, state.daemonChild, signal);
    if (!exact(proof, ["state", "pid", "startTicks", "uid", "gid", "executable", "version", "argvSha256", "configSha256"])
      || proof.state !== "RUNNING" || proof.pid !== state.daemonChild.pid || proof.startTicks !== state.daemonChild.startTicks
      || proof.uid !== 0 || proof.gid !== 0 || proof.executable !== DOCKERD || proof.version !== "28.0.4"
      || proof.argvSha256 !== state.spec.argvSha256 || proof.configSha256 !== state.spec.configSha256) {
      fail("postgres_admission_daemon_invalid", phase);
    }
    const socket = lstatSync(state.spec.socket, { bigint: true });
    if (!socket.isSocket() || socket.isSymbolicLink() || !isDeepStrictEqual(socketIdentity(socket), state.socketIdentity)) {
      fail("postgres_admission_daemon_invalid", phase);
    }
    if (state.dataDirectory) {
      const data = dataIdentity(ownedDirectory(state.dataDirectory, state.postgresUid, state.postgresGid));
      if (!isDeepStrictEqual(data, state.dataIdentity)) fail("postgres_admission_volume_invalid", phase);
    }
  } catch (error) {
    if (FAILURE_CODES.has(error?.message)) throw error;
    fail("postgres_admission_daemon_invalid", phase, error);
  }
}

function validateVolumeInspection(state, inspected, phase) {
  if (inspected?.Name !== state.volume.name || inspected?.Driver !== "local" || inspected?.Scope !== "local"
    || !isDeepStrictEqual(inspected?.Labels, state.volume.labels)
    || !isDeepStrictEqual(inspected?.Options, { device: state.volume.dataDirectory, o: "bind", type: "none" })) {
    fail("postgres_admission_volume_invalid", phase);
  }
}

function validateContainerInspection(state, inspected, phase) {
  const expectedMounts = [
    { Type: "bind", Source: state.secretPath, Destination: "/run/secrets/postgres-password", RW: false },
    { Type: "volume", Name: state.volume.name, Destination: "/var/lib/postgresql/data", RW: true },
  ];
  if (inspected?.Id !== state.container.id || inspected?.Image !== state.binding.image.configDigest
    || !isDeepStrictEqual(inspected?.Labels, state.container.labels) || !isDeepStrictEqual(inspected?.Mounts, expectedMounts)) {
    fail("postgres_admission_container_invalid", phase);
  }
}

async function runtimeOwnershipGuard(state, phase) {
  const inspect = async (args, code) => {
    const result = await spawnBounded(state, phase, DOCKER, ["--host", state.endpoint, ...args], {
      cwd: state.infra, env: state.childEnv, failureCode: code,
    });
    let value;
    try { value = JSON.parse(result.stdout); } catch (error) { fail(code, phase, error); }
    return value;
  };
  if (state.imageLoaded) {
    const value = await inspect(["image", "inspect", "--format", "{{json .}}", state.binding.image.configDigest],
      "postgres_admission_image_invalid");
    if (value?.Id !== state.binding.image.configDigest || sha256(canonicalBytes(value?.RootFS?.Layers)) !== state.binding.image.diffIdsSha256) {
      fail("postgres_admission_image_invalid", phase);
    }
  }
  if (state.volume) validateVolumeInspection(state,
    await inspect(["volume", "inspect", "--format", "{{json .}}", state.volume.name], "postgres_admission_volume_invalid"), phase);
  if (state.container) validateContainerInspection(state,
    await inspect(["container", "inspect", "--format", "{{json .}}", state.container.id], "postgres_admission_container_invalid"), phase);
}

async function docker(state, phase, args, options = {}) {
  if (!options.cleanup) await assertLease(state, phase, options.timeoutMs ?? 10_000);
  const guardSignal = options.cleanup ? state.cleanupAbort?.signal : state.abort.signal;
  await daemonGuard(state, phase, guardSignal);
  if (!options.cleanup && !options.skipOwnershipGuard) await runtimeOwnershipGuard(state, phase);
  const result = await spawnBounded(state, phase, DOCKER, ["--host", state.endpoint, ...args], {
    cwd: state.infra, env: state.childEnv, failureCode: options.failureCode, ...options,
  });
  await daemonGuard(state, phase, guardSignal);
  if (!options.cleanup && !options.skipOwnershipGuard) await runtimeOwnershipGuard(state, phase);
  return result;
}

async function assertLease(state, phase, minimum = OPERATION_MINIMUM) {
  assertNoSinkFailure(state, phase);
  try {
    const binding = state.authority.assertCurrent(state.lease, phase, minimum);
    if (binding.admissionGeneration !== state.binding.admissionGeneration
      || binding.archiveSetId !== state.binding.archiveSetId
      || !isDeepStrictEqual(binding.image, state.binding.image)
      || !isDeepStrictEqual(binding.generationRoot, state.binding.generationRoot)) {
      fail("postgres_admission_authority_denied", phase);
    }
    state.binding = binding;
    assertNoSinkFailure(state, phase);
    return binding;
  } catch (error) {
    if (error?.message === "postgres_admission_lease_expired") throw error;
    fail("postgres_admission_authority_denied", phase, error);
  }
}

function acquireArchive(state) {
  const context = loadPostgresAdmissionArchiveContext(state.binding.generationRoot);
  verifyPostgresAdmissionArchiveFast(context);
  const source = getPostgresAdmissionImageArchiveSource(context);
  state.archiveContext = context;
  state.archiveSource = source;
}

async function setupDaemon(state) {
  const suffix = randomBytes(3).toString("hex");
  const parent = `/var/tmp/aw-pr-${suffix}`;
  createDirectory(parent, 0o710, 1000);
  const infra = path.join(parent, "infra");
  const endpointDirectory = path.join(parent, "endpoint");
  createDirectory(infra, 0o700);
  createDirectory(endpointDirectory, 0o700);
  for (const directory of ["data", "exec", "client"]) createDirectory(path.join(infra, directory), 0o700);
  const nonce = randomBytes(12).toString("hex");
  const socket = path.join(endpointDirectory, "docker.sock");
  let spec = {
    root: parent, infrastructure: infra, endpointDirectory, rootClient: path.join(infra, "client"), uid: 0, gid: 0,
    executable: DOCKERD, version: "28.0.4", nonce,
    args: ["--config-file", path.join(infra, "daemon.json"), "--containerd-plugins-namespace", `plugins.awpgsql-${nonce}`],
    configFile: path.join(infra, "daemon.json"), configSha256: "0".repeat(64), argvSha256: "0".repeat(64),
    pidFile: path.join(infra, "daemon.pid"), logFile: path.join(infra, "daemon.log"), socket,
    dataRoot: path.join(infra, "data"), execRoot: path.join(infra, "exec"), containerdAddress: CONTAINERD,
    containersNamespace: `awpgsql-${nonce}`, pluginsNamespace: `plugins.awpgsql-${nonce}`,
  };
  spec.argvSha256 = sha256(prettyBytes([spec.executable, ...spec.args]));
  const config = prettyBytes(postgresRuntimeDaemonConfiguration(spec));
  spec.configSha256 = sha256(config);
  spec = freeze(spec);
  writeExclusive(spec.configFile, config);
  writeExclusive(path.join(spec.rootClient, "config.json"), prettyBytes({}));
  writeExclusive(spec.logFile, Buffer.alloc(0));
  state.root = parent;
  state.infra = infra;
  state.spec = spec;
  state.endpoint = `unix://${socket}`;
  state.childEnv = childEnvironment(infra, spec.rootClient);
  state.helper = createPostgresRuntimeDaemonHelper();
  const started = await state.helper.start(spec, state.abort.signal);
  validatePostgresRuntimeDaemonStartProof(started, state.binding.revisionSha256);
  state.daemonChild = started;
  const socketStat = lstatSync(spec.socket, { bigint: true });
  if (!socketStat.isSocket() || socketStat.isSymbolicLink() || socketStat.uid !== 0n || socketStat.gid !== 1000n
    || socketStat.nlink !== 1n || (socketStat.mode & 0o7777n) !== 0o660n) {
    fail("postgres_admission_daemon_invalid", "DAEMON_START");
  }
  state.socketIdentity = socketIdentity(socketStat);
  const result = await docker(state, "DAEMON_START", ["info", "--format", "{{json .}}"], {
    failureCode: "postgres_admission_daemon_invalid",
  });
  let info;
  try { info = JSON.parse(result.stdout); } catch (error) { fail("postgres_admission_daemon_invalid", "DAEMON_START", error); }
  validatePostgresRuntimeDaemonInfo(info, {
    id: started.daemonId, root: spec.dataRoot, containerdAddress: spec.containerdAddress,
    containersNamespace: spec.containersNamespace, pluginsNamespace: spec.pluginsNamespace,
  });
}

async function loadImage(state) {
  const target = path.join(state.infra, "admitted-image.tar");
  await materializeArchive(state, state.archiveSource, target);
  state.archiveFile = target;
  const loaded = await docker(state, "IMAGE_LOAD", ["image", "load", "--input", target], {
    failureCode: "postgres_admission_image_invalid", timeoutMs: 20_000,
  });
  if (loaded.stdout.length === 0) fail("postgres_admission_image_invalid", "IMAGE_LOAD");
  const image = state.binding.image;
  const inspectedResult = await docker(state, "IMAGE_LOAD", [
    "image", "inspect", "--format", "{{json .}}", image.configDigest,
  ], { failureCode: "postgres_admission_image_invalid" });
  let inspected;
  try { inspected = JSON.parse(inspectedResult.stdout); } catch (error) { fail("postgres_admission_image_invalid", "IMAGE_LOAD", error); }
  const diffIds = inspected?.RootFS?.Layers;
  if (inspected?.Id !== image.configDigest || !Array.isArray(diffIds)
    || sha256(canonicalBytes(diffIds)) !== image.diffIdsSha256) {
    fail("postgres_admission_image_invalid", "IMAGE_LOAD");
  }
  state.imageLoaded = true;
  await runtimeOwnershipGuard(state, "IMAGE_LOAD");
}

async function probePostgresIdentity(state) {
  const nonce = randomBytes(12).toString("hex");
  const labels = [
    "--label", `com.auto-world.postgres-admission-generation=${state.binding.admissionGeneration}`,
    "--label", `com.auto-world.postgres-admission-revision=${state.binding.authorityRevision}`,
    "--label", `com.auto-world.postgres-admission-nonce=${nonce}`,
    "--label", "com.auto-world.postgres-admission-role=identity-probe",
  ];
  const observed = {};
  state.probes = new Set();
  for (const [field, option] of [["uid", "-u"], ["gid", "-g"]]) {
    const name = `aw-pg-admitted-${nonce}-${field}`;
    state.probes.add(name);
    const result = await docker(state, "VOLUME_CREATE", [
      "container", "run", "--rm", "--name", name, ...labels, "--network", "none", "--read-only",
      "--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--entrypoint", "/usr/bin/id",
      state.binding.image.configDigest, option, "postgres",
    ], { failureCode: "postgres_admission_volume_invalid" });
    state.probes.delete(name);
    const value = result.stdout.toString("utf8");
    if (!/^[1-9][0-9]{0,4}\n$/u.test(value)) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
    observed[field] = postgresIdentity(Number(value.trim()));
  }
  state.postgresUid = observed.uid;
  state.postgresGid = observed.gid;
  state.postgresUser = `${observed.uid}:${observed.gid}`;
}

function preflightPersistentData(state) {
  if (state.intent === "RESTORE_VERIFY") return;
  ownedDirectory(ROOT, 0, 0);
  const generation = path.join(ROOT, `generation-${state.binding.admissionGeneration}`);
  if (!exists(generation)) {
    createDirectory(generation, 0o700);
    const data = path.join(generation, "postgres-data");
    createDirectory(data, 0o700);
    if (readdirSync(data).length !== 0) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
    syncDirectory(generation);
    syncDirectory(ROOT);
    state.freshDataReservation = true;
    return;
  }
  ownedDirectory(generation, 0, 0);
  const data = path.join(generation, "postgres-data");
  const bindingFile = path.join(generation, DATA_BINDING);
  if (!exists(bindingFile) || !exists(data)) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  const binding = readDataBinding(bindingFile);
  const expectedRootSha256 = sha256(canonicalBytes(state.binding.generationRoot));
  if (!exact(binding, ["generationRootSha256", "configDigest", "dataDirectory", "postgresUid", "postgresGid"])
    || binding.generationRootSha256 !== expectedRootSha256 || binding.configDigest !== state.binding.image.configDigest
    || postgresIdentity(binding.postgresUid) !== binding.postgresUid
    || postgresIdentity(binding.postgresGid) !== binding.postgresGid
    || !exact(binding.dataDirectory, ["dev", "ino", "uid", "gid", "mode"])) {
    fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  }
  const observed = dataIdentity(ownedDirectory(data, binding.postgresUid, binding.postgresGid));
  if (!isDeepStrictEqual(observed, binding.dataDirectory)) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  state.preflightDataBinding = binding;
}

function preparePersistentData(state) {
  postgresIdentity(state.postgresUid);
  postgresIdentity(state.postgresGid);
  ownedDirectory(ROOT, 0, 0);
  const generation = path.join(ROOT, state.intent === "RESTORE_VERIFY"
    ? `restore-generation-${state.binding.admissionGeneration}` : `generation-${state.binding.admissionGeneration}`);
  const data = path.join(generation, state.intent === "RESTORE_VERIFY" ? `restore-${state.containerNonce}` : "postgres-data");
  const bindingFile = path.join(generation, DATA_BINDING);
  if (state.intent === "RESTORE_VERIFY") {
    if (!exists(generation)) createDirectory(generation, 0o700);
    ownedDirectory(generation, 0, 0);
    if (exists(data)) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
    createDirectory(data, 0o700);
    if (readdirSync(data).length !== 0) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
    chownSync(data, state.postgresUid, state.postgresGid);
    chmodSync(data, 0o700);
    state.dataDirectory = data;
    state.dataIdentity = dataIdentity(ownedDirectory(data, state.postgresUid, state.postgresGid));
    syncDirectory(generation);
    return;
  }
  const expectedRootSha256 = sha256(canonicalBytes(state.binding.generationRoot));
  if (state.freshDataReservation) {
    ownedDirectory(generation, 0, 0);
    ownedDirectory(data, 0, 0);
    if (readdirSync(data).length !== 0) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
    chownSync(data, state.postgresUid, state.postgresGid);
    chmodSync(data, 0o700);
    const identity = dataIdentity(ownedDirectory(data, state.postgresUid, state.postgresGid));
    const binding = {
      generationRootSha256: expectedRootSha256, configDigest: state.binding.image.configDigest,
      dataDirectory: identity, postgresUid: state.postgresUid, postgresGid: state.postgresGid,
    };
    writeExclusive(bindingFile, canonicalBytes(binding), 0o400);
    syncDirectory(generation);
  }
  ownedDirectory(generation, 0, 0);
  if (!exists(bindingFile) || !exists(data)) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  const binding = readDataBinding(bindingFile);
  if (!exact(binding, ["generationRootSha256", "configDigest", "dataDirectory", "postgresUid", "postgresGid"])
    || binding.generationRootSha256 !== expectedRootSha256 || binding.configDigest !== state.binding.image.configDigest
    || binding.postgresUid !== state.postgresUid || binding.postgresGid !== state.postgresGid
    || !exact(binding.dataDirectory, ["dev", "ino", "uid", "gid", "mode"])) {
    fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  }
  const observed = dataIdentity(ownedDirectory(data, state.postgresUid, state.postgresGid));
  if (!isDeepStrictEqual(observed, binding.dataDirectory)
    || state.preflightDataBinding && !isDeepStrictEqual(binding, state.preflightDataBinding)) {
    fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
  }
  state.dataDirectory = data;
  state.dataIdentity = observed;
}

async function createOwnedRuntime(state) {
  const nonce = randomBytes(12).toString("hex");
  state.containerNonce = nonce;
  const labels = [
    "--label", `com.auto-world.postgres-admission-generation=${state.binding.admissionGeneration}`,
    "--label", `com.auto-world.postgres-admission-revision=${state.binding.authorityRevision}`,
    "--label", `com.auto-world.postgres-admission-nonce=${nonce}`,
  ];
  const expectedLabels = freeze({
    "com.auto-world.postgres-admission-generation": String(state.binding.admissionGeneration),
    "com.auto-world.postgres-admission-revision": String(state.binding.authorityRevision),
    "com.auto-world.postgres-admission-nonce": nonce,
  });
  const volume = state.intent === "RESTORE_VERIFY" ? `aw-pg-admitted-${nonce}-restore`
    : `aw-pg-admitted-g${state.binding.admissionGeneration}-data`;
  const container = `aw-pg-admitted-${nonce}-service`;
  await observedPhase(state, "VOLUME_CREATE", async () => {
    await probePostgresIdentity(state);
    preparePersistentData(state);
    const volumeResult = await docker(state, "VOLUME_CREATE", ["volume", "create", "--driver", "local", ...labels,
      "--opt", "type=none", "--opt", "o=bind", "--opt", `device=${state.dataDirectory}`, volume], {
      failureCode: "postgres_admission_volume_invalid",
    });
    if (volumeResult.stdout.toString("utf8").trim() !== volume) fail("postgres_admission_volume_invalid", "VOLUME_CREATE");
    state.volume = freeze({ name: volume, dataDirectory: state.dataDirectory, nativeIdentity: state.dataIdentity,
      labels: expectedLabels });
    const inspectedResult = await docker(state, "VOLUME_CREATE", ["volume", "inspect", "--format", "{{json .}}", volume], {
      failureCode: "postgres_admission_volume_invalid",
    });
    let inspected;
    try { inspected = JSON.parse(inspectedResult.stdout); } catch (error) { fail("postgres_admission_volume_invalid", "VOLUME_CREATE", error); }
    validateVolumeInspection(state, inspected, "VOLUME_CREATE");
  });
  await observedPhase(state, "CONTAINER_CREATE", async () => {
    const secret = path.join(state.infra, "postgres-password");
    state.secretPath = secret;
    writeExclusive(secret, Buffer.from(`${randomBytes(32).toString("base64url")}\n`));
    state.secret = secret;
    const created = await docker(state, "CONTAINER_CREATE", [
      "container", "create", "--name", container, ...labels,
      "--env", "POSTGRES_USER=awapp", "--env", "POSTGRES_DB=awapp",
      "--env", "POSTGRES_PASSWORD_FILE=/run/secrets/postgres-password",
      "--mount", `type=bind,src=${secret},dst=/run/secrets/postgres-password,readonly`,
      "--mount", `type=volume,src=${volume},dst=/var/lib/postgresql/data,volume-nocopy`,
      state.binding.image.configDigest,
    ], { failureCode: "postgres_admission_container_invalid" });
    const id = created.stdout.toString("utf8").trim();
    if (!SHA256.test(id)) fail("postgres_admission_container_invalid", "CONTAINER_CREATE");
    state.container = freeze({ id, name: container, nonce, labels: expectedLabels });
    const inspectedResult = await docker(state, "CONTAINER_CREATE", [
      "container", "inspect", "--format", "{{json .}}", id,
    ], { failureCode: "postgres_admission_container_invalid" });
    let inspected;
    try { inspected = JSON.parse(inspectedResult.stdout); } catch (error) { fail("postgres_admission_container_invalid", "CONTAINER_CREATE", error); }
    validateContainerInspection(state, inspected, "CONTAINER_CREATE");
  });
  await observedPhase(state, "CONTAINER_START", () => docker(state, "CONTAINER_START", [
    "container", "start", state.container.id,
  ], { failureCode: "postgres_admission_container_invalid" }));
  await observedPhase(state, "READINESS", async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await assertLease(state, "READINESS");
      const ready = await docker(state, "READINESS", [
        "container", "exec", "--user", state.postgresUser, state.container.id, "pg_isready", "--host=/var/run/postgresql",
        "--port=5432", "--username=awapp", "--dbname=awapp", "--quiet",
      ], { allowed: [0, 1, 2], failureCode: "postgres_admission_readiness_failed" });
      if (ready.code === 0) {
        unlinkSync(state.secret);
        state.secret = undefined;
        return;
      }
      await delay(WATCH_INTERVAL, undefined, { signal: state.abort.signal });
    }
    fail("postgres_admission_readiness_failed", "READINESS");
  });
}

function psqlArgs(sql) {
  return [
    "container", "exec", "--user", "70:70", "CONTAINER", "psql", "--host=/var/run/postgresql", "--port=5432",
    "--username=awapp", "--no-password", "--dbname=awapp", "--no-psqlrc", "--set=ON_ERROR_STOP=1",
    "--quiet", "--tuples-only", "--no-align", "--command", sql,
  ];
}

async function sqlCheck(state, phase = "SQL_CHECK") {
  const sql = "BEGIN; CREATE TEMP TABLE auto_world_admission_probe (id integer PRIMARY KEY, payload text NOT NULL); "
    + "INSERT INTO auto_world_admission_probe VALUES (1, 'auto-world-admission-v1'); "
    + "SELECT payload FROM auto_world_admission_probe WHERE id = 1 AND current_database() = 'awapp' AND current_user = 'awapp'; ROLLBACK;";
  const args = psqlArgs(sql);
  args[4] = state.container.id;
  args[3] = state.postgresUser;
  const result = await docker(state, phase, args, { failureCode: "postgres_admission_sql_check_failed" });
  if (result.stdout.toString("utf8") !== "auto-world-admission-v1\n") fail("postgres_admission_sql_check_failed", phase);
}

function ensureBackupDirectory() {
  try { mkdirSync(ROOT, { mode: 0o700, recursive: false }); chownSync(ROOT, 0, 0); chmodSync(ROOT, 0o700); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  try { mkdirSync(BACKUPS, { mode: 0o700, recursive: false }); chownSync(BACKUPS, 0, 0); chmodSync(BACKUPS, 0o700); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  for (const directory of [ROOT, BACKUPS]) {
    const observed = lstatSync(directory, { bigint: true });
    if (!observed.isDirectory() || observed.isSymbolicLink() || observed.uid !== 0n || observed.gid !== 0n
      || (observed.mode & 0o7777n) !== 0o700n || realpathSync(directory) !== directory) {
      fail("postgres_admission_backup_failed", "BACKUP");
    }
  }
}

async function verifyOpenDump(state, fd, file, phase) {
    const before = fstatSync(fd, { bigint: true });
    const alias = lstatSync(file, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== 0n || before.gid !== 0n
      || (before.mode & 0o7777n) !== 0o600n || before.size < 5n || before.size > BigInt(ARCHIVE_CAP)
      || alias.isSymbolicLink() || !isDeepStrictEqual(nativeIdentity(before), nativeIdentity(alias))) {
      fail(phase === "BACKUP" ? "postgres_admission_backup_failed" : "postgres_admission_restore_failed", phase);
    }
    const header = Buffer.alloc(5);
    if (readSync(fd, header, 0, header.length, 0) !== header.length || !header.equals(Buffer.from("PGDMP"))) {
      fail(phase === "BACKUP" ? "postgres_admission_backup_failed" : "postgres_admission_restore_failed", phase);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(CHUNK);
    let offset = 0;
    while (offset < Number(before.size)) {
      if (performance.now() >= state.binding.deadlineMonotonic) fail("postgres_admission_lease_expired", phase);
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) - offset), offset);
      if (count < 1) fail("postgres_admission_restore_failed", phase);
      hash.update(buffer.subarray(0, count));
      offset += count;
      await assertLease(state, phase, OPERATION_MINIMUM);
      await delay(0, undefined, { signal: state.abort.signal });
    }
    if (readSync(fd, buffer, 0, 1, offset) !== 0) fail("postgres_admission_restore_failed", phase);
    const after = fstatSync(fd, { bigint: true });
    const finalAlias = lstatSync(file, { bigint: true });
    if (finalAlias.isSymbolicLink() || !isDeepStrictEqual(nativeIdentity(before), nativeIdentity(after))
      || !isDeepStrictEqual(nativeIdentity(before), nativeIdentity(finalAlias))) fail("postgres_admission_restore_failed", phase);
    return freeze({ identity: nativeIdentity(before), size: Number(before.size), sha256: hash.digest("hex") });
}

async function verifyDump(state, file, phase) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let failure;
  let result;
  try {
    result = await verifyOpenDump(state, fd, file, phase);
  } catch (error) { failure = error; }
  finally { try { closeSync(fd); } catch (error) { failure ??= error; } }
  if (failure) throw failure;
  return result;
}

async function backup(state) {
  await assertLease(state, "BACKUP", 20_000);
  ensureBackupDirectory();
  const final = path.join(BACKUPS, `generation-${state.binding.admissionGeneration}.dump`);
  const temporary = `${final}.tmp-${state.container.nonce}`;
  state.temporaryBackup = temporary;
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let failure;
  try {
    await daemonGuard(state, "BACKUP");
    await runtimeOwnershipGuard(state, "BACKUP");
    await spawnBounded(state, "BACKUP", DOCKER, [
      "--host", state.endpoint, "container", "exec", "--user", state.postgresUser, state.container.id,
      "pg_dump", "--host=/var/run/postgresql", "--port=5432", "--username=awapp", "--no-password",
      "--dbname=awapp", "--format=custom",
    ], { cwd: state.infra, env: state.childEnv, stdio: ["ignore", fd, "pipe"],
      failureCode: "postgres_admission_backup_failed", timeoutMs: 20_000 });
    await daemonGuard(state, "BACKUP");
    await runtimeOwnershipGuard(state, "BACKUP");
    fsyncSync(fd);
  } catch (error) { failure = error; }
  finally { try { closeSync(fd); } catch (error) { failure ??= error; } }
  if (failure) throw failure;
  await verifyDump(state, temporary, "BACKUP");
  try { linkSync(temporary, final); }
  catch (error) { fail("postgres_admission_backup_failed", "BACKUP", error); }
  unlinkSync(temporary);
  state.temporaryBackup = undefined;
  const directory = openSync(BACKUPS, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
  state.backup = final;
}

async function restoreVerify(state) {
  const source = path.join(BACKUPS, `generation-${state.binding.admissionGeneration}.dump`);
  const fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let failure;
  try {
    const before = await verifyOpenDump(state, fd, source, "RESTORE_VERIFY");
    await docker(state, "RESTORE_VERIFY", [
      "container", "exec", "--interactive", "--user", state.postgresUser, state.container.id,
      "pg_restore", "--host=/var/run/postgresql", "--port=5432", "--username=awapp", "--no-password",
      "--dbname=awapp", "--single-transaction", "--no-owner", "--no-privileges",
    ], { stdio: [fd, "pipe", "pipe"], failureCode: "postgres_admission_restore_failed", timeoutMs: 20_000 });
    const after = await verifyOpenDump(state, fd, source, "RESTORE_VERIFY");
    if (!isDeepStrictEqual(before, after)) fail("postgres_admission_restore_failed", "RESTORE_VERIFY");
  } catch (error) { failure = error; }
  finally { try { closeSync(fd); } catch (error) { failure ??= error; } }
  if (failure) throw failure;
  await sqlCheck(state, "RESTORE_VERIFY");
}

function abortedNormally(error, state) {
  return state.draining && (error?.name === "AbortError" || error?.code === "ABORT_ERR");
}

async function renewLoop(state) {
  while (!state.draining) {
    try { await delay(WATCH_INTERVAL, undefined, { signal: state.abort.signal }); }
    catch (error) { if (abortedNormally(error, state)) return; throw error; }
    if (state.draining) return;
    const now = performance.now();
    if (now >= state.binding.deadlineMonotonic) fail("postgres_admission_lease_expired", "AUTHORITY");
    const renewAt = Math.min(state.binding.issuedMonotonic + LEASE_RENEW_AT,
      state.binding.deadlineMonotonic - RENEWAL_BUDGET - RENEWAL_DRAIN_BUFFER);
    if (now >= renewAt) {
      const started = performance.now();
      observe(state, "leaseState", { state: "RENEWING" }, "AUTHORITY");
      try {
        const next = await state.authority.renew(state.lease);
        const binding = state.authority.assertCurrent(next, "AUTHORITY", 0);
        if (binding.admissionGeneration !== state.binding.admissionGeneration
          || binding.archiveSetId !== state.binding.archiveSetId
          || !isDeepStrictEqual(binding.image, state.binding.image)
          || !isDeepStrictEqual(binding.generationRoot, state.binding.generationRoot)) {
          fail("postgres_admission_authority_denied", "AUTHORITY");
        }
        verifyExecutionFiles(binding.generationRoot);
        const archive = loadPostgresAdmissionArchiveContext(binding.generationRoot);
        verifyPostgresAdmissionArchiveFast(archive);
        state.lease = next;
        state.binding = binding;
        observeCurrentness(state);
        observe(state, "renewal", { result: "SUCCEEDED", reason: "NONE",
          durationMs: Math.max(0, performance.now() - started) }, "AUTHORITY");
        observe(state, "leaseState", { state: "CURRENT" }, "AUTHORITY");
      } catch (error) {
        if (error?.message === "postgres_admission_observability_sink_failed") throw error;
        assertNoSinkFailure(state, "AUTHORITY");
        observeCurrentness(state);
        if (error?.message === "postgres_admission_authority_revoked") {
          observe(state, "leaseState", { state: "REVOKED" }, "AUTHORITY");
          if (state.container) observe(state, "alert", { alert: "REVOKED_WITH_OWNED_SERVICE", severity: "CRITICAL",
            reason: "REVOKED", durationMs: Math.max(0, performance.now() - started),
            publicId: state.binding.revisionSha256 }, "AUTHORITY");
        }
        observe(state, "alert", { alert: "RENEWAL_FAILURE", severity: "CRITICAL",
          reason: observationReason(error), durationMs: Math.max(0, performance.now() - started),
          publicId: state.binding.revisionSha256 }, "AUTHORITY");
        observe(state, "renewal", { result: "FAILED", reason: observationReason(error),
          durationMs: Math.max(0, performance.now() - started) }, "AUTHORITY");
        throw error;
      }
    }
  }
}

async function serviceForeground(state) {
  while (!state.draining) {
    await assertLease(state, "SERVICE", 0);
    const result = await docker(state, "SERVICE", [
      "container", "inspect", "--format", "{{json .State}}", state.container.id,
    ], { failureCode: "postgres_admission_container_invalid" });
    let inspected;
    try { inspected = JSON.parse(result.stdout); } catch (error) { fail("postgres_admission_container_invalid", "SERVICE", error); }
    if (inspected?.Running !== true || inspected?.Dead !== false) fail("postgres_admission_container_invalid", "SERVICE");
    try { await delay(WATCH_INTERVAL, undefined, { signal: state.abort.signal }); }
    catch (error) { if (!abortedNormally(error, state)) throw error; }
  }
}

async function cleanupDocker(state, phase, args) {
  return docker(state, phase, args, {
    cleanup: true, allowed: [0], failureCode: "postgres_admission_cleanup_uncertain", timeoutMs: 35_000,
  });
}

async function assertDockerAbsent(state, kind, identity) {
  const args = kind === "container" ? ["container", "ls", "--all", "--quiet", "--filter", `id=${identity}`]
    : ["image", "ls", "--quiet", "--no-trunc"];
  const result = await docker(state, "CLEANUP", args, {
    cleanup: true, allowed: [0], failureCode: "postgres_admission_cleanup_uncertain", timeoutMs: 10_000,
  });
  const lines = result.stdout.toString("utf8").trim().split(/\r?\n/u).filter(Boolean);
  if (kind === "container" ? lines.length !== 0 : lines.includes(identity)) fail("postgres_admission_cleanup_uncertain", "CLEANUP");
}

async function drain(state) {
  if (state.drained) return;
  const started = performance.now();
  let observationFailure;
  state.draining = true;
  state.abort.abort();
  state.cleanupAbort = new globalThis.AbortController();
  const cleanupTimer = globalThis.setTimeout(() => state.cleanupAbort.abort(), DRAIN_MS);
  try { observe(state, "leaseState", { state: "DRAINING" }, "CLEANUP"); }
  catch (error) { observationFailure = error; }
  try { state.activeChild?.kill("SIGTERM"); } catch { /* Continue bounded cleanup. */ }
  const deadline = performance.now() + DRAIN_MS;
  while (state.activeChild && performance.now() < deadline) await delay(25);
  if (state.activeChild) {
    try { state.activeChild.kill("SIGKILL"); } catch { /* Final ownership checks decide. */ }
    await delay(25);
  }
  let cleanupFailure;
  const attempt = async (action) => {
    try { await action(); return true; } catch (error) { cleanupFailure ??= error; return false; }
  };
  for (const probe of state.probes ?? []) {
    if (await attempt(async () => {
      await cleanupDocker(state, "CLEANUP", ["container", "rm", "--force", probe]);
      await assertDockerAbsent(state, "container", probe);
    })) state.probes.delete(probe);
  }
  if (state.container) {
    await attempt(() => cleanupDocker(state, "STOP", ["container", "stop", "--time", "30", state.container.id]));
    const removed = await attempt(async () => {
      await cleanupDocker(state, "CLEANUP", ["container", "rm", "--force", state.container.id]);
      await assertDockerAbsent(state, "container", state.container.id);
    });
    if (removed) state.container = undefined;
  }
  if (state.imageLoaded) {
    const removed = await attempt(async () => {
      await cleanupDocker(state, "CLEANUP", ["image", "rm", state.binding.image.configDigest]);
      await assertDockerAbsent(state, "image", state.binding.image.configDigest);
    });
    if (removed) state.imageLoaded = false;
  }
  if (state.helper && state.daemonChild) {
    await attempt(async () => {
      const stopped = await state.helper.stop(state.spec, state.daemonChild);
      validatePostgresRuntimeDaemonStopProof(stopped, state.daemonChild);
      state.daemonChild = undefined;
    });
  }
  for (const name of [state.secret, state.archiveFile, state.temporaryBackup].filter(Boolean)) {
    await attempt(() => unlinkSync(name));
  }
  state.secret = undefined;
  state.archiveFile = undefined;
  state.temporaryBackup = undefined;
  await attempt(() => state.authority?.close());
  globalThis.clearTimeout(cleanupTimer);
  state.drained = true;
  try {
    const durationMs = Math.max(0, performance.now() - started);
    if (state.phases.includes("STOP")) {
      const result = cleanupFailure ? "FAILED" : "SUCCEEDED";
      const reason = cleanupFailure ? "CLEANUP_UNCERTAIN" : "NONE";
      observe(state, "phase", { phase: "STOP", result, reason, durationMs }, "STOP");
      observe(state, "phase", { phase: "CLEANUP", result, reason, durationMs }, "CLEANUP");
    }
    observe(state, "leaseState", { state: "STOPPED" }, "CLEANUP");
    observe(state, "drain", { result: cleanupFailure ? "FAILED" : "SUCCEEDED",
      reason: cleanupFailure ? "CLEANUP_UNCERTAIN" : "NONE",
      durationMs }, "CLEANUP");
  } catch (error) { observationFailure ??= error; }
  if (cleanupFailure) fail("postgres_admission_cleanup_uncertain", "CLEANUP", cleanupFailure);
  if (observationFailure) throw observationFailure;
}

function normalizeFailure(error) {
  if (FAILURE_CODES.has(error?.message)) return error;
  return Object.assign(new Error("postgres_admission_authority_denied"), {
    phase: PHASES.includes(error?.phase) ? error.phase : "AUTHORITY", cause: error,
  });
}

export async function runPostgresSupportedSession(input) {
  const value = validatePostgresSupportedSessionInput(input);
  if (sessionActive) fail("postgres_admission_operation_cancelled", "AUTHORITY");
  sessionActive = true;
  const state = {
    abort: new globalThis.AbortController(), draining: false, drained: false, operationBusy: false, phases: [], intent: value.intent,
  };
  const sessionStarted = performance.now();
  let primary;
  const sinkError = () => {
    state.sinkFailure ??= Object.assign(new Error("postgres_admission_observability_sink_failed"), {
      phase: state.phases.at(-1) ?? "AUTHORITY",
    });
    primary ??= state.sinkFailure;
    state.draining = true;
    state.abort.abort();
    try { state.activeChild?.kill("SIGTERM"); } catch { /* Drain retains final ownership checks. */ }
  };
  process.stderr.on("error", sinkError);
  state.observability = createPostgresAdmissionObservability({ emit: (line) => {
    if (process.stderr.write(line) === false) fail("postgres_admission_observability_sink_failed", state.phases.at(-1) ?? "AUTHORITY");
  } });
  const signal = () => {
    primary ??= Object.assign(new Error("postgres_admission_operation_cancelled"), {
      phase: state.phases.at(-1) ?? "AUTHORITY",
    });
    state.draining = true;
    state.abort.abort();
  };
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  try {
    observe(state, "leaseState", { state: "ABSENT" }, "AUTHORITY");
    const authorityStarted = performance.now();
    try {
      await observedPhase(state, "AUTHORITY", async () => {
        state.authority = await openPostgresAdmissionAuthority();
        assertNoSinkFailure(state, "AUTHORITY");
        state.lease = await state.authority.acquire();
        assertNoSinkFailure(state, "AUTHORITY");
        state.binding = state.authority.assertCurrent(state.lease, "AUTHORITY", OPERATION_MINIMUM);
        verifyExecutionFiles(state.binding.generationRoot);
      });
      state.watcher = renewLoop(state).catch((error) => {
        if (!abortedNormally(error, state)) primary ??= error;
        state.draining = true;
        state.abort.abort();
        try { state.activeChild?.kill("SIGTERM"); } catch { /* Drain retains final ownership checks. */ }
      });
      observeCurrentness(state);
      observe(state, "authorityCheck", { result: "SUCCEEDED", reason: "NONE",
        durationMs: Math.max(0, performance.now() - authorityStarted), authoritySha256: state.binding.revisionSha256 }, "AUTHORITY");
      observe(state, "leaseState", { state: "CURRENT" }, "AUTHORITY");
    } catch (error) {
      observe(state, "authorityCheck", { result: "FAILED", reason: observationReason(error),
        durationMs: Math.max(0, performance.now() - authorityStarted), authoritySha256: null }, "AUTHORITY");
      throw error;
    }
    await observedPhase(state, "IMAGE_ACQUIRE", async () => {
      await assertLease(state, "IMAGE_ACQUIRE");
      acquireArchive(state);
    });
    if (value.intent === "MIGRATION") {
      await observedPhase(state, "MIGRATION", () => fail("postgres_admission_migration_contract_unavailable", "MIGRATION"));
    }
    assertNoSinkFailure(state, "VOLUME_CREATE");
    preflightPersistentData(state);
    await observedPhase(state, "DAEMON_START", async () => {
      await assertLease(state, "DAEMON_START");
      await setupDaemon(state);
    });
    await observedPhase(state, "IMAGE_LOAD", async () => {
      await assertLease(state, "IMAGE_LOAD");
      await loadImage(state);
    });
    await createOwnedRuntime(state);
    if (value.intent === "SERVICE") {
      await observedPhase(state, "SERVICE", () => serviceForeground(state));
    } else if (value.intent === "SQL_CHECK") {
      await observedPhase(state, "SQL_CHECK", async () => {
        await assertLease(state, "SQL_CHECK");
        await sqlCheck(state);
      });
    } else if (value.intent === "BACKUP") {
      await observedPhase(state, "BACKUP", async () => {
        await assertLease(state, "BACKUP");
        await backup(state);
      });
    } else if (value.intent === "RESTORE_VERIFY") {
      await observedPhase(state, "RESTORE_VERIFY", async () => {
        await assertLease(state, "RESTORE_VERIFY");
        await restoreVerify(state);
      });
    }
    state.draining = true;
    state.abort.abort();
    await state.watcher;
    if (primary) throw primary;
  } catch (error) { primary ??= normalizeFailure(error); }
  finally {
    if (value.intent !== "MIGRATION") state.phases.push("STOP", "CLEANUP");
    try { await drain(state); } catch (error) { primary = normalizeFailure(error); }
    try {
      observe(state, "session", { intent: value.intent, result: primary ? "FAILED" : "SUCCEEDED",
        reason: primary ? observationReason(primary) : "NONE",
      durationMs: Math.max(0, performance.now() - sessionStarted) }, state.phases.at(-1) ?? "AUTHORITY");
    } catch (error) { primary = normalizeFailure(error); }
    await delay(0);
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
    process.stderr.off("error", sinkError);
    sessionActive = false;
  }
  if (primary) throw primary;
  return validatePostgresSupportedSessionResult({
    kind: "POSTGRES_SUPPORTED_SESSION_RESULT_V1", state: "COMPLETED", intent: value.intent,
    admissionGeneration: state.binding.admissionGeneration, authorityRevision: state.binding.authorityRevision,
    resolvedMainSha: state.binding.resolvedMainSha, phases: state.phases,
    cleanup: { containers: "REMOVED", image: "REMOVED", daemon: "STOPPED", volumes: "PRESERVED", backups: "PRESERVED" },
  });
}
