import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";

const KiB = 1024;
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const REPOSITORY = "CleMeY15/auto-world";
const ACCEPTED_BASE = "4517b120f1e126dff15e710a34d950694e20eae5";
const HEAD_BRANCH = "codex/task-0005-git-materials-v9";
const WORKFLOW = ".github/workflows/task005-git-materials-v9.yml";
const CARRIER = "golang@sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747";
const INDEX_URL = "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/APKINDEX.tar.gz";
const APK_BASE_URL = "https://dl-cdn.alpinelinux.org/alpine/v3.24/main/x86_64/";
const SECDB_URL = "https://secdb.alpinelinux.org/v3.24/main.json";
const PRIVATE_NAME = "task005-git-materials-v9-private";
const PUBLIC_NAME = "task005-git-materials-v9-public";
const RECEIPT_NAME = "receipt.json";
const MANIFEST_NAME = "manifest.json";
const CARRIER_MARKER = "carrier-initially-absent";
const CARRIER_ID_MARKER = "carrier-image-id";
const FAILURE_MARKER = "failure-code";
const LIMITS = Object.freeze({
  actorMs: 21 * 60_000,
  transferMs: 10 * 60_000,
  childMs: 5 * 60_000,
  childOutputBytes: 8 * MiB,
  indexBytes: 16 * MiB,
  secdbBytes: 64 * MiB,
  apkCount: 64,
  apkBytes: 64 * MiB,
  apkAggregateBytes: 512 * MiB,
  expandedEvidenceBytes: 256 * MiB,
  privateBytes: 2 * GiB,
  publicFileBytes: 4 * MiB,
  publicAggregateBytes: 8 * MiB,
  minimumFreeBytes: 20 * GiB,
  eventBytes: 64 * KiB,
});
const PUBLIC_CODES = new Set([
  "task005_git_materials_arguments_invalid",
  "task005_git_materials_capacity_failed",
  "task005_git_materials_carrier_identity_failed",
  "task005_git_materials_carrier_ownership_failed",
  "task005_git_materials_carrier_pull_failed",
  "task005_git_materials_child_failed",
  "task005_git_materials_child_timeout",
  "task005_git_materials_cleanup_failed",
  "task005_git_materials_context_invalid",
  "task005_git_materials_download_failed",
  "task005_git_materials_material_invalid",
  "task005_git_materials_material_limit_exceeded",
  "task005_git_materials_private_root_invalid",
  "task005_git_materials_probe_not_run",
  "task005_git_materials_public_cap_exceeded",
  "task005_git_materials_public_cleanup_failed",
  "task005_git_materials_public_root_invalid",
  "task005_git_materials_secdb_invalid",
  "task005_git_materials_solver_invalid",
  "task005_git_materials_url_invalid",
]);
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const VERSION = /^[a-z0-9][a-z0-9+._-]{0,127}$/u;
const APK_FILENAME = /^[a-z0-9][a-z0-9+._-]{0,191}\.apk$/u;
const FAILURE_MARKER_BYTES = 1024;
const CHILD_OPERATIONS = Object.freeze([
  "PROBE_IMAGE_LIST", "PROBE_IMAGE_PULL", "PROBE_IMAGE_INSPECT", "PROBE_APK_VERSION",
  "PROBE_HELP_ROOT", "PROBE_HELP_ADD", "PROBE_HELP_VERIFY", "PROBE_HELP_QUERY",
  "PROBE_HELP_MANIFEST", "PROBE_HELP_FETCH", "PROBE_HELP_VERSION", "MATERIAL_KEYS",
  "MATERIAL_INSTALLED_BEFORE", "MATERIAL_INDEX_VERIFY", "MATERIAL_SIMULATE_FIRST",
  "MATERIAL_QUERY", "MATERIAL_APK_VERIFY", "MATERIAL_APK_INDEX_BINDING", "MATERIAL_APK_MANIFEST",
  "MATERIAL_SIMULATE_SECOND", "MATERIAL_INSTALLED_AFTER", "MATERIAL_VERSION_COMPARE",
  "CLEANUP_CONTAINER_DISCOVER", "CLEANUP_CONTAINER_LIST", "CLEANUP_CONTAINER_REMOVE",
  "CLEANUP_IMAGE_LIST", "CLEANUP_IMAGE_REMOVE",
]);
const CHILD_OPERATION_SET = new Set(CHILD_OPERATIONS);
const CHILD_REASONS = new Set(["TIMEOUT", "OUTPUT_CAP", "SPAWN_ERROR", "SIGNAL", "EXIT_STATUS", "RESULT_INVALID"]);
const CHILD_SIGNALS = new Set([
  "SIGABRT", "SIGALRM", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL",
  "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGTRAP", "SIGUSR1", "SIGUSR2",
]);
const DIAGNOSTIC_KEYS = Object.freeze(["operation", "reason", "status", "signal", "stdoutBytes", "stderrBytes"]);
const INDEX_VERIFY_ENTRYPOINT = "/sbin/apk";
const INDEX_VERIFY_ARGS = Object.freeze([
  "--keys-dir", "/etc/apk/keys", "verify", "/materials/repo/APKINDEX.tar.gz",
]);
const INDEX_VERIFY_PREFIX = "/materials/repo/APKINDEX.tar.gz: ";
const INDEX_VERIFY_UNKNOWN = "APK_INDEX_VERIFY_UNKNOWN";
const INDEX_VERIFY_NATIVE_LINES = new Map([
  ["UNTRUSTED signature", "APKE_SIGNATURE_UNTRUSTED"],
  ["BAD signature", "APKE_SIGNATURE_INVALID"],
  ["crypto error", "APKE_CRYPTO_ERROR"],
  ["cryptographic algorithm not supported", "APKE_CRYPTO_NOT_SUPPORTED"],
  ["cryptographic key format not recognized", "APKE_CRYPTO_KEY_FORMAT"],
  ["unexpected end of file", "APKE_EOF"],
  ["file format is invalid or inconsistent", "APKE_FORMAT_INVALID"],
  ["file format is obsolete (e.g. missing embedded checksum)", "APKE_FORMAT_OBSOLETE"],
  ["file format not supported (in this applet)", "APKE_FORMAT_NOT_SUPPORTED"],
  ["v2 index format error", "APKE_V2NDX_FORMAT"],
  ["v2 package format error", "APKE_V2PKG_FORMAT"],
  ["v2 package integrity error", "APKE_V2PKG_INTEGRITY"],
  ["file integrity error", "APKE_FILE_INTEGRITY"],
  ["Permission denied", "EACCES"],
]);
const INDEX_VERIFY_KNOWN_LENGTHS = new Map([...INDEX_VERIFY_NATIVE_LINES].map(([literal, category]) => [
  category, Buffer.byteLength(`${INDEX_VERIFY_PREFIX}${literal}\n`),
]));
const INDEX_VERIFY_CATEGORIES = new Set([...INDEX_VERIFY_KNOWN_LENGTHS.keys(), INDEX_VERIFY_UNKNOWN]);
const VALIDATOR_ERROR_SNAPSHOTS = new WeakMap();
const TRUSTED_NATIVE_ERROR_CATEGORIES = new WeakMap();
const MATERIAL_OWNER_BINDINGS = new WeakMap();
const MAX_MATERIAL_ID = 2_147_483_647;
const DEFAULT_IDENTITY_IO = Object.freeze({
  getuid: () => process.getuid(),
  getgid: () => process.getgid(),
  lstat: (target) => lstat(target),
});

function failure(code, childDiagnostic) {
  return Object.assign(new Error(code), { code }, childDiagnostic === undefined ? {} : { childDiagnostic });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hasControl(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function ownValue(error, key) {
  if (error === null || typeof error !== "object" && typeof error !== "function") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function requiredOwnData(value, key) {
  if (value === null || typeof value !== "object" && typeof value !== "function" || isProxy(value)) {
    throw failure("task005_git_materials_private_root_invalid");
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    throw failure("task005_git_materials_private_root_invalid");
  }
  if (descriptor === undefined || !("value" in descriptor)) {
    throw failure("task005_git_materials_private_root_invalid");
  }
  return descriptor.value;
}

function supportedMaterialId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_MATERIAL_ID;
}

async function bindMaterialOwner(context, resources, identityIo) {
  try {
    const privateRoot = requiredOwnData(context, "privateRoot");
    if (typeof privateRoot !== "string" || privateRoot === "") throw new Error("invalid private root");
    const getuid = requiredOwnData(identityIo, "getuid");
    const getgid = requiredOwnData(identityIo, "getgid");
    const identityLstat = requiredOwnData(identityIo, "lstat");
    if (typeof getuid !== "function" || typeof getgid !== "function" || typeof identityLstat !== "function"
      || isProxy(getuid) || isProxy(getgid) || isProxy(identityLstat)
      || resources === null || typeof resources !== "object" || isProxy(resources)) {
      throw new Error("invalid identity I/O");
    }
    if (MATERIAL_OWNER_BINDINGS.has(resources)) throw new Error("owner already bound");
    const uid = getuid();
    const gid = getgid();
    const pendingInfo = identityLstat(privateRoot);
    if (pendingInfo !== null && (typeof pendingInfo === "object" || typeof pendingInfo === "function")
      && isProxy(pendingInfo)) throw new Error("invalid owner stat");
    const info = await pendingInfo;
    const ownerUid = requiredOwnData(info, "uid");
    const ownerGid = requiredOwnData(info, "gid");
    const mode = requiredOwnData(info, "mode");
    if (!supportedMaterialId(uid) || !supportedMaterialId(gid)
      || !supportedMaterialId(ownerUid) || !supportedMaterialId(ownerGid)
      || !Number.isSafeInteger(mode) || mode < 0 || mode > 0xffff_ffff
      || (mode & 0o170000) !== 0o040000 || (mode & 0o777) !== 0o700
      || ownerUid !== uid || ownerGid !== gid) {
      throw new Error("invalid private owner");
    }
    const binding = Object.freeze({ privateRoot, uid, gid, user: `${uid}:${gid}` });
    MATERIAL_OWNER_BINDINGS.set(resources, binding);
    return binding;
  } catch {
    throw failure("task005_git_materials_private_root_invalid");
  }
}

function materialRunBinding(context, resources, operation, mounts) {
  if (!Array.isArray(mounts) || isProxy(mounts)) {
    throw failure("task005_git_materials_private_root_invalid");
  }
  const length = requiredOwnData(mounts, "length");
  if (length === 0) return undefined;
  if (length !== 1 || !operation.startsWith("MATERIAL_")) {
    throw failure("task005_git_materials_private_root_invalid");
  }
  const mount = requiredOwnData(mounts, "0");
  if (mount === null || typeof mount !== "object" || isProxy(mount)) {
    throw failure("task005_git_materials_private_root_invalid");
  }
  let keys;
  try {
    if (Object.getOwnPropertySymbols(mount).length !== 0) {
      throw failure("task005_git_materials_private_root_invalid");
    }
    keys = Object.getOwnPropertyNames(mount);
  } catch {
    throw failure("task005_git_materials_private_root_invalid");
  }
  if (!keys.includes("source") || !keys.includes("target")
    || keys.some((key) => !["source", "target", "readonly"].includes(key))) {
    throw failure("task005_git_materials_private_root_invalid");
  }
  const source = requiredOwnData(mount, "source");
  const target = requiredOwnData(mount, "target");
  const readonly = keys.includes("readonly") ? requiredOwnData(mount, "readonly") : true;
  const privateRoot = requiredOwnData(context, "privateRoot");
  const binding = resources !== null && typeof resources === "object" && !isProxy(resources)
    ? MATERIAL_OWNER_BINDINGS.get(resources) : undefined;
  if (binding === undefined || binding.privateRoot !== privateRoot
    || source !== privateRoot || target !== "/materials" || readonly !== true) {
    throw failure("task005_git_materials_private_root_invalid");
  }
  return Object.freeze({
    binding,
    mounts: Object.freeze([Object.freeze({ source, target, readonly: true })]),
  });
}

function publicFailure(error) {
  const record = safeFailureRecord(error);
  return canonicalJson({
    actor: "TASK005_GIT_MATERIALS_V1",
    authority: "DIAGNOSTIC_ONLY",
    installationAuthorization: false,
    state: "FAILED",
    ...record,
  });
}

function safeErrorCode(error) {
  const candidate = ownValue(error, "code");
  return typeof candidate === "string" && PUBLIC_CODES.has(candidate)
    ? candidate : "task005_git_materials_failed";
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object") return false;
  try {
    return Object.getPrototypeOf(value) === Object.prototype;
  } catch {
    return false;
  }
}

function ownDataKeys(value, expectedKeys) {
  if (!isPlainRecord(value)) return false;
  try {
    if (Object.getOwnPropertySymbols(value).length !== 0) return false;
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor;
    });
  } catch {
    return false;
  }
}

function validateOperation(operation) {
  if (typeof operation !== "string" || !CHILD_OPERATION_SET.has(operation)) {
    throw failure("task005_git_materials_child_failed");
  }
  return operation;
}

function projectChildDiagnostic(value) {
  if (!ownDataKeys(value, DIAGNOSTIC_KEYS)) return undefined;
  const operation = ownValue(value, "operation");
  const reason = ownValue(value, "reason");
  const status = ownValue(value, "status");
  const signal = ownValue(value, "signal");
  const stdoutBytes = ownValue(value, "stdoutBytes");
  const stderrBytes = ownValue(value, "stderrBytes");
  if (!CHILD_OPERATION_SET.has(operation) || !CHILD_REASONS.has(reason)
    || !Number.isSafeInteger(stdoutBytes) || stdoutBytes < 0 || stdoutBytes > LIMITS.childOutputBytes + 1
    || !Number.isSafeInteger(stderrBytes) || stderrBytes < 0 || stderrBytes > LIMITS.childOutputBytes + 1
    || reason === "EXIT_STATUS" !== (Number.isSafeInteger(status) && status >= 1 && status <= 255)
    || reason !== "EXIT_STATUS" && status !== null
    || reason === "SIGNAL" !== (typeof signal === "string" && (CHILD_SIGNALS.has(signal) || signal === "OTHER"))
    || reason !== "SIGNAL" && signal !== null) return undefined;
  return { operation, reason, status, signal, stdoutBytes, stderrBytes };
}

function diagnosticMatchesCode(code, diagnostic) {
  return diagnostic.reason === "TIMEOUT"
    ? code === "task005_git_materials_child_timeout"
    : code === "task005_git_materials_child_failed";
}

function nativeCategoryRealizable(code, childDiagnostic, nativeErrorCategory) {
  if (code !== "task005_git_materials_child_failed"
    || !INDEX_VERIFY_CATEGORIES.has(nativeErrorCategory)
    || childDiagnostic.operation !== "MATERIAL_INDEX_VERIFY"
    || childDiagnostic.reason !== "EXIT_STATUS"
    || childDiagnostic.status !== 1
    || childDiagnostic.signal !== null) return false;
  if (nativeErrorCategory === INDEX_VERIFY_UNKNOWN) {
    return childDiagnostic.stdoutBytes + childDiagnostic.stderrBytes <= LIMITS.childOutputBytes;
  }
  return childDiagnostic.stdoutBytes === INDEX_VERIFY_KNOWN_LENGTHS.get(nativeErrorCategory)
    && childDiagnostic.stderrBytes === 0;
}

function trustedNativeCategory(value) {
  if (value === null || typeof value !== "object" && typeof value !== "function") return undefined;
  return TRUSTED_NATIVE_ERROR_CATEGORIES.get(value);
}

function createSafeFailureRecord(code, childDiagnostic, nativeErrorCategory) {
  const record = childDiagnostic === undefined ? { code } : { code, childDiagnostic };
  if (childDiagnostic !== undefined
    && nativeCategoryRealizable(code, childDiagnostic, nativeErrorCategory)) {
    record.nativeErrorCategory = nativeErrorCategory;
    TRUSTED_NATIVE_ERROR_CATEGORIES.set(record, nativeErrorCategory);
  }
  return record;
}

function safeFailureRecord(error) {
  const code = safeErrorCode(error);
  const childDiagnostic = projectChildDiagnostic(ownValue(error, "childDiagnostic"));
  return childDiagnostic !== undefined && diagnosticMatchesCode(code, childDiagnostic)
    ? createSafeFailureRecord(code, childDiagnostic, trustedNativeCategory(error)) : { code };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

function validateCanonicalUrl(raw, kind = "any") {
  if (!["any", "index", "secdb", "apk"].includes(kind)) throw failure("task005_git_materials_url_invalid");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw failure("task005_git_materials_url_invalid");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== ""
    || parsed.port !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw failure("task005_git_materials_url_invalid");
  }
  if (kind === "index" && raw !== INDEX_URL) throw failure("task005_git_materials_url_invalid");
  if (kind === "secdb" && raw !== SECDB_URL) throw failure("task005_git_materials_url_invalid");
  if (kind === "apk") {
    if (!raw.startsWith(APK_BASE_URL)) throw failure("task005_git_materials_url_invalid");
    const filename = raw.slice(APK_BASE_URL.length);
    if (!APK_FILENAME.test(filename) || filename.includes("..")) throw failure("task005_git_materials_url_invalid");
  }
  if (kind === "any") {
    if (raw === INDEX_URL || raw === SECDB_URL) return raw;
    return validateCanonicalUrl(raw, "apk");
  }
  return raw;
}

async function readEvent(eventPath) {
  if (!path.isAbsolute(eventPath ?? "") || path.normalize(eventPath) !== eventPath) {
    throw failure("task005_git_materials_context_invalid");
  }
  let info;
  try {
    info = await lstat(eventPath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 2 || info.size > LIMITS.eventBytes
      || await realpath(eventPath) !== eventPath) throw failure("task005_git_materials_context_invalid");
  } catch {
    throw failure("task005_git_materials_context_invalid");
  }
  let event;
  try {
    event = JSON.parse(await readFile(eventPath, "utf8"));
  } catch {
    throw failure("task005_git_materials_context_invalid");
  }
  return event;
}

async function requireContext(env, platform = process.platform) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_EVENT_NAME !== "pull_request"
    || env.GITHUB_EVENT_ACTION !== "opened" || env.GITHUB_BASE_REF !== "main" || env.GITHUB_HEAD_REF !== HEAD_BRANCH
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1" || !RUN_ID.test(env.GITHUB_RUN_ID ?? "")
    || !REVISION.test(env.GITHUB_SHA ?? "") || !path.isAbsolute(env.RUNNER_TEMP ?? "")
    || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
    throw failure("task005_git_materials_context_invalid");
  }
  let runnerTemp;
  try {
    runnerTemp = await realpath(env.RUNNER_TEMP);
  } catch {
    throw failure("task005_git_materials_context_invalid");
  }
  if (runnerTemp !== env.RUNNER_TEMP) throw failure("task005_git_materials_context_invalid");
  const event = await readEvent(env.GITHUB_EVENT_PATH);
  const pull = event?.pull_request;
  const number = event?.number;
  const workflowRef = `${REPOSITORY}/${WORKFLOW}@refs/pull/${number}/merge`;
  if (!Number.isSafeInteger(number) || number < 1 || number === 202 || event?.action !== "opened"
    || event?.repository?.full_name !== REPOSITORY || pull?.draft !== true || pull?.state !== "open"
    || pull?.base?.ref !== "main" || pull?.base?.sha !== ACCEPTED_BASE || pull?.base?.repo?.full_name !== REPOSITORY
    || pull?.head?.ref !== HEAD_BRANCH || pull?.head?.repo?.full_name !== REPOSITORY
    || pull?.head?.sha !== env.GITHUB_HEAD_SHA || !REVISION.test(env.GITHUB_HEAD_SHA ?? "")
    || env.GITHUB_WORKFLOW_REF !== workflowRef) {
    throw failure("task005_git_materials_context_invalid");
  }
  return Object.freeze({
    eventNumber: number,
    headSha: env.GITHUB_HEAD_SHA,
    mergeSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    runnerTemp,
    privateRoot: path.join(runnerTemp, PRIVATE_NAME),
    publicRoot: path.join(runnerTemp, PUBLIC_NAME),
  });
}

function snapshotCommandResult(result) {
  return Object.freeze({
    stdout: ownValue(result, "stdout"),
    stderr: ownValue(result, "stderr"),
    error: ownValue(result, "error"),
    signal: ownValue(result, "signal"),
    status: ownValue(result, "status"),
  });
}

function snapshotDenseStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  let lengthDescriptor;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    return undefined;
  }
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
  if (!Number.isSafeInteger(length) || length < 0) return undefined;
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      return undefined;
    }
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return undefined;
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function validateCommandResult(result, expected = [0], operation) {
  validateOperation(operation);
  const stdoutValue = ownValue(result, "stdout");
  const stderrValue = ownValue(result, "stderr");
  const stdout = Buffer.isBuffer(stdoutValue) ? stdoutValue : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(stderrValue) ? stderrValue : Buffer.alloc(0);
  const error = ownValue(result, "error");
  const errorCode = ownValue(error, "code");
  const signalValue = ownValue(result, "signal");
  const statusValue = ownValue(result, "status");
  const overflow = stdout.length + stderr.length > LIMITS.childOutputBytes;
  if (!error && !signalValue
    && expected.includes(statusValue) && !overflow) return { stdout, stderr, status: statusValue };
  let reason;
  if (errorCode === "ETIMEDOUT") reason = "TIMEOUT";
  else if (errorCode === "ENOBUFS" || overflow) reason = "OUTPUT_CAP";
  else if (error) reason = "SPAWN_ERROR";
  else if (typeof signalValue === "string" && signalValue !== "") reason = "SIGNAL";
  else if (Number.isSafeInteger(statusValue) && statusValue >= 1 && statusValue <= 255
    && !expected.includes(statusValue)) reason = "EXIT_STATUS";
  else reason = "RESULT_INVALID";
  const childDiagnostic = {
    operation,
    reason,
    status: reason === "EXIT_STATUS" ? statusValue : null,
    signal: reason === "SIGNAL" ? CHILD_SIGNALS.has(signalValue) ? signalValue : "OTHER" : null,
    stdoutBytes: Math.min(stdout.length, LIMITS.childOutputBytes + 1),
    stderrBytes: Math.min(stderr.length, LIMITS.childOutputBytes + 1),
  };
  const createdError = failure(reason === "TIMEOUT"
    ? "task005_git_materials_child_timeout" : "task005_git_materials_child_failed", childDiagnostic);
  VALIDATOR_ERROR_SNAPSHOTS.set(createdError, result);
  throw createdError;
}

function runCommand(operation, command, executable, args, options, expected = [0]) {
  validateOperation(operation);
  return validateCommandResult(command(executable, args, options), expected, operation);
}

function defaultCommand(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: null,
    maxBuffer: LIMITS.childOutputBytes + 1,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
}

function dockerEnvironment(env) {
  return { PATH: env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", DOCKER_CONFIG: env.DOCKER_CONFIG ?? "" };
}

function containerName(runId, ordinal) {
  return `aw-task005-git-materials-${runId}-${String(ordinal).padStart(3, "0")}`;
}

function dockerRunArguments({ name, runId, entrypoint, args, mounts = [], materialUser }) {
  return ["run", "--rm", "--pull", "never", "--platform", "linux/amd64",
    ...(materialUser === undefined ? [] : ["--user", materialUser]), "--network", "none",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true", "--pids-limit", "64",
    "--memory", "256m", "--memory-swap", "256m", "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--name", name, "--label", "com.auto-world.task005.git-materials-v9=true",
    "--label", `com.auto-world.github-run-id=${runId}`,
    ...mounts.flatMap(({ source, target, readonly = true }) => ["--mount",
      `type=bind,src=${source},dst=${target}${readonly ? ",readonly" : ""}`]),
    "--entrypoint", entrypoint, CARRIER, ...args];
}

function exactIndexVerifyTuple(operation, entrypoint, args) {
  return operation === "MATERIAL_INDEX_VERIFY" && entrypoint === INDEX_VERIFY_ENTRYPOINT
    && args !== undefined && args.length === INDEX_VERIFY_ARGS.length
    && INDEX_VERIFY_ARGS.every((value, index) => args[index] === value);
}

function classifyIndexVerifyFailure(snapshot) {
  const stdout = snapshot.stdout;
  const stderr = snapshot.stderr;
  if (!Buffer.isBuffer(stdout) || stdout.length < 1 || stdout.length > 256
    || !Buffer.isBuffer(stderr) || stderr.length !== 0) return INDEX_VERIFY_UNKNOWN;
  let text;
  try {
    text = new globalThis.TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stdout);
  } catch {
    return INDEX_VERIFY_UNKNOWN;
  }
  for (const [literal, category] of INDEX_VERIFY_NATIVE_LINES) {
    if (text === `${INDEX_VERIFY_PREFIX}${literal}\n`) return category;
  }
  return INDEX_VERIFY_UNKNOWN;
}

function runCarrier(context, resources, command, operation, entrypoint, args, mounts = [], timeoutMs = LIMITS.childMs) {
  validateOperation(operation);
  const argsSnapshot = operation === "MATERIAL_INDEX_VERIFY" && entrypoint === INDEX_VERIFY_ENTRYPOINT
    ? snapshotDenseStringArray(args) : undefined;
  const commandArgs = argsSnapshot ?? args;
  const categoryEligible = exactIndexVerifyTuple(operation, entrypoint, argsSnapshot);
  const helpProbe = HELP_PROBES.find((probe) => probe.operation === operation);
  if (helpProbe !== undefined && (entrypoint !== "/sbin/apk" || !Array.isArray(args)
    || args.length !== helpProbe.args.length || helpProbe.args.some((value, index) => args[index] !== value)
    || !Array.isArray(mounts) || mounts.length !== 0)) {
    throw failure("task005_git_materials_probe_not_run");
  }
  const materialBinding = materialRunBinding(context, resources, operation, mounts);
  const commandMounts = materialBinding?.mounts ?? mounts;
  resources.nextOrdinal += 1;
  const name = containerName(context.runId, resources.nextOrdinal);
  resources.containerNames.push(name);
  let resultSnapshot;
  try {
    const result = command("docker", dockerRunArguments({
      name, runId: context.runId, entrypoint, args: commandArgs, mounts: commandMounts,
      materialUser: materialBinding?.binding.user,
    }), {
      cwd: context.privateRoot,
      env: dockerEnvironment(process.env),
      timeoutMs,
    });
    resultSnapshot = snapshotCommandResult(result);
    const validated = validateCommandResult(resultSnapshot, helpProbe === undefined ? [0] : [1], operation);
    if (helpProbe !== undefined) {
      const rawStdout = resultSnapshot.stdout;
      const rawStderr = resultSnapshot.stderr;
      if (!Buffer.isBuffer(rawStdout) || rawStdout.length === 0
        || !Buffer.isBuffer(rawStderr) || rawStderr.length !== 0) {
        throw failure("task005_git_materials_probe_not_run");
      }
      strictUtf8(rawStdout, "task005_git_materials_probe_not_run");
    }
    return validated;
  } catch (error) {
    if (categoryEligible && resultSnapshot !== undefined
      && VALIDATOR_ERROR_SNAPSHOTS.get(error) === resultSnapshot) {
      const childDiagnostic = projectChildDiagnostic(ownValue(error, "childDiagnostic"));
      const code = safeErrorCode(error);
      if (childDiagnostic !== undefined && nativeCategoryRealizable(code, childDiagnostic, INDEX_VERIFY_UNKNOWN)) {
        let nativeErrorCategory;
        try {
          nativeErrorCategory = classifyIndexVerifyFailure(resultSnapshot);
        } catch {
          nativeErrorCategory = INDEX_VERIFY_UNKNOWN;
        }
        if (nativeCategoryRealizable(code, childDiagnostic, nativeErrorCategory)) {
          TRUSTED_NATIVE_ERROR_CATEGORIES.set(error, nativeErrorCategory);
        }
      }
    }
    throw error;
  }
}

function parseApkVersion(bytes) {
  const text = bytes.toString("utf8").trim();
  if (!/^apk-tools [0-9]+\.[0-9]+\.[0-9]+(?:[-+._a-z0-9]*)?, compiled for x86_64\.$/u.test(text)) {
    throw failure("task005_git_materials_probe_not_run");
  }
  return text;
}

const HELP_PROBES = Object.freeze([
  Object.freeze({ name: "root", operation: "PROBE_HELP_ROOT", args: Object.freeze(["--help"]) }),
  Object.freeze({ name: "add", operation: "PROBE_HELP_ADD", args: Object.freeze(["add", "--help"]) }),
  Object.freeze({ name: "verify", operation: "PROBE_HELP_VERIFY", args: Object.freeze(["verify", "--help"]) }),
  Object.freeze({ name: "query", operation: "PROBE_HELP_QUERY", args: Object.freeze(["query", "--help"]) }),
  Object.freeze({ name: "manifest", operation: "PROBE_HELP_MANIFEST", args: Object.freeze(["manifest", "--help"]) }),
  Object.freeze({ name: "fetch", operation: "PROBE_HELP_FETCH", args: Object.freeze(["fetch", "--help"]) }),
  Object.freeze({ name: "version", operation: "PROBE_HELP_VERSION", args: Object.freeze(["version", "--help"]) }),
]);
const GLOBAL_HELP_TOKENS = Object.freeze(["--keys-dir", "--repositories-file", "--root"]);

function addHelpTokens(help) {
  if (help?.add === undefined) return new Set();
  const value = strictUtf8(help.add, "task005_git_materials_probe_not_run");
  const ordered = value.split(/[ \t\n\v\f\r]+/u).filter(Boolean);
  const tokens = new Set(ordered);
  if (ordered.some((token, index) => token === "--root," && ordered[index + 1] === "-p"
    && ordered[index + 2] === "ROOT")) tokens.add("--root");
  return tokens;
}

function selectNetworkDenial(tokens) {
  if (tokens.has("--network[=BOOL]")) return "--network=no";
  if (tokens.has("--no-network")) return "--no-network";
  return undefined;
}

function assessHelp(help) {
  const required = {
    add: ["--simulate"],
    verify: ["verify"],
    query: ["--format", "--fields", "--from", "--recursive"],
    manifest: ["manifest"],
    fetch: ["--stdout"],
    version: ["--test"],
  };
  const missing = [];
  for (const [name, tokens] of Object.entries(required)) {
    const value = help[name]?.toString("utf8") ?? "";
    for (const token of tokens) if (!value.includes(token)) missing.push(`${name}:${token}`);
  }
  const globalTokens = addHelpTokens(help);
  for (const token of GLOBAL_HELP_TOKENS) if (!globalTokens.has(token)) missing.push(`add:${token}`);
  if (selectNetworkDenial(globalTokens) === undefined) missing.push("add:network-denial");
  return Object.freeze({ complete: missing.length === 0, missing: Object.freeze(missing.sort()) });
}

async function requireCapacity(root, statfsImpl = statfs) {
  const value = await statfsImpl(root, { bigint: true });
  const free = value.bavail * value.bsize;
  if (free < BigInt(LIMITS.minimumFreeBytes)) throw failure("task005_git_materials_capacity_failed");
  return Number(free > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : free);
}

async function createOwnedDirectory(directory) {
  await mkdir(directory, { mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700
    || await realpath(directory) !== directory) throw failure("task005_git_materials_private_root_invalid");
}

async function privateTreeBytes(root) {
  let total = 0;
  const pending = [root];
  let entries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const name of await readdir(current)) {
      entries += 1;
      if (entries > 256) throw failure("task005_git_materials_material_limit_exceeded");
      const candidate = path.join(current, name);
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) throw failure("task005_git_materials_material_invalid");
      if (info.isDirectory()) pending.push(candidate);
      else if (info.isFile() && info.nlink === 1) total += info.size;
      else throw failure("task005_git_materials_material_invalid");
      if (total > LIMITS.privateBytes) throw failure("task005_git_materials_material_limit_exceeded");
    }
  }
  return total;
}

async function assertAbsent(target, code = "task005_git_materials_cleanup_failed") {
  try {
    await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw failure(code);
  }
  throw failure(code);
}

async function removePrivateRoot(root) {
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700
      || await realpath(root) !== root) throw failure("task005_git_materials_cleanup_failed");
    await rm(root, { recursive: true, force: false });
  } catch (error) {
    if (error?.code !== "ENOENT") throw failure("task005_git_materials_cleanup_failed");
  }
  await assertAbsent(root);
}

async function removePublicRoot(root) {
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700
      || await realpath(root) !== root) throw failure("task005_git_materials_public_cleanup_failed");
    const entries = (await readdir(root)).sort();
    if (entries.length !== 2 || entries[0] !== MANIFEST_NAME || entries[1] !== RECEIPT_NAME) {
      throw failure("task005_git_materials_public_cleanup_failed");
    }
    for (const name of entries) {
      const file = path.join(root, name);
      const fileInfo = await lstat(file);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.nlink !== 1
        || fileInfo.size < 2 || fileInfo.size > LIMITS.publicFileBytes || (fileInfo.mode & 0o777) !== 0o600) {
        throw failure("task005_git_materials_public_cleanup_failed");
      }
      await rm(file);
    }
    await rmdir(root);
  } catch (error) {
    if (error?.code !== "ENOENT") throw failure("task005_git_materials_public_cleanup_failed");
  }
  await assertAbsent(root, "task005_git_materials_public_cleanup_failed");
}

async function writePublicFiles(root, receipt, manifest) {
  const receiptBytes = Buffer.from(canonicalJson(receipt));
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  if (receiptBytes.length > LIMITS.publicFileBytes || manifestBytes.length > LIMITS.publicFileBytes
    || receiptBytes.length + manifestBytes.length > LIMITS.publicAggregateBytes) {
    throw failure("task005_git_materials_public_cap_exceeded");
  }
  await createOwnedDirectory(root);
  try {
    await writeFile(path.join(root, RECEIPT_NAME), receiptBytes, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(root, MANIFEST_NAME), manifestBytes, { flag: "wx", mode: 0o600 });
  } catch {
    await rm(path.join(root, RECEIPT_NAME), { force: true });
    await rm(path.join(root, MANIFEST_NAME), { force: true });
    await rmdir(root).catch(() => undefined);
    throw failure("task005_git_materials_public_root_invalid");
  }
}

function blockedEvidence(error) {
  const record = safeFailureRecord(error);
  return {
    receipt: {
      actor: "TASK005_GIT_MATERIALS_V1",
      authority: "DIAGNOSTIC_ONLY",
      cleanup: { containersAbsent: true, privateFilesAbsent: true },
      ...record,
      installationAuthorization: false,
      state: "BLOCKED",
    },
    manifest: {
      actor: "TASK005_GIT_MATERIALS_MANIFEST_V1",
      authority: "DIAGNOSTIC_ONLY",
      files: [],
      installationAuthorization: false,
      state: "EMPTY_BLOCKED",
    },
  };
}

async function writeFailureMarker(context, error) {
  const value = Buffer.from(canonicalJson(safeFailureRecord(error)));
  if (value.length > FAILURE_MARKER_BYTES) throw failure("task005_git_materials_cleanup_failed");
  await writeFile(path.join(context.privateRoot, FAILURE_MARKER), value, { flag: "wx", mode: 0o600 });
}

function validateFailureMarkerRecord(value) {
  if (!isPlainRecord(value)) throw failure("task005_git_materials_cleanup_failed");
  const keys = (() => {
    try {
      if (Object.getOwnPropertySymbols(value).length !== 0) return [];
      return Object.getOwnPropertyNames(value);
    } catch {
      return [];
    }
  })();
  if (keys.length < 1 || keys.length > 3 || !keys.includes("code")
    || keys.some((key) => !["code", "childDiagnostic", "nativeErrorCategory"].includes(key))
    || !keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor;
    })) throw failure("task005_git_materials_cleanup_failed");
  const code = ownValue(value, "code");
  if (typeof code !== "string" || !PUBLIC_CODES.has(code) && code !== "task005_git_materials_failed") {
    throw failure("task005_git_materials_cleanup_failed");
  }
  if (!keys.includes("childDiagnostic")) {
    if (keys.includes("nativeErrorCategory")) throw failure("task005_git_materials_cleanup_failed");
    return { code };
  }
  const childDiagnostic = projectChildDiagnostic(ownValue(value, "childDiagnostic"));
  if (childDiagnostic === undefined || !diagnosticMatchesCode(code, childDiagnostic)) {
    throw failure("task005_git_materials_cleanup_failed");
  }
  if (!keys.includes("nativeErrorCategory")) return { code, childDiagnostic };
  const nativeErrorCategory = ownValue(value, "nativeErrorCategory");
  if (!nativeCategoryRealizable(code, childDiagnostic, nativeErrorCategory)) {
    throw failure("task005_git_materials_cleanup_failed");
  }
  return createSafeFailureRecord(code, childDiagnostic, nativeErrorCategory);
}

async function readFailureMarker(context, io = { lstat, readFile }) {
  const marker = path.join(context.privateRoot, FAILURE_MARKER);
  try {
    const info = await io.lstat(marker);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600
      || !Number.isSafeInteger(info.size) || info.size < 3 || info.size > FAILURE_MARKER_BYTES) {
      throw failure("task005_git_materials_cleanup_failed");
    }
    const bytes = await io.readFile(marker);
    if (!Buffer.isBuffer(bytes) || bytes.length !== info.size) throw failure("task005_git_materials_cleanup_failed");
    const value = strictUtf8(bytes, "task005_git_materials_cleanup_failed");
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw failure("task005_git_materials_cleanup_failed");
    }
    const record = validateFailureMarkerRecord(parsed);
    if (canonicalJson(record) !== value) throw failure("task005_git_materials_cleanup_failed");
    return record;
  } catch (error) {
    if (ownValue(error, "code") === "ENOENT") return undefined;
    throw failure("task005_git_materials_cleanup_failed");
  }
}

function notRunEvidence(context, version, help, assessment, cleanup, imageId, availableBytes) {
  const capabilities = Object.fromEntries(Object.keys(help).sort().map((name) => [name, {
    bytes: help[name].length,
    sha256: sha256(help[name]),
  }]));
  const receipt = {
    actor: "TASK005_GIT_MATERIALS_V1",
    authority: "DIAGNOSTIC_ONLY",
    installationAuthorization: false,
    state: "NOT_RUN",
    reason: "APK_CAPABILITY_UNAVAILABLE",
    source: {
      acceptedBase: ACCEPTED_BASE,
      headSha: context.headSha,
      mergeSha: context.mergeSha,
      pullRequest: context.eventNumber,
      runAttempt: 1,
      runId: context.runId,
      runNumber: 1,
    },
    carrier: { reference: CARRIER, apkVersion: version, ...(imageId ? { imageId } : {}) },
    capabilities,
    missingCapabilities: assessment.missing,
    materialsAcquired: false,
    packagePayloadExecuted: false,
    packageInstalled: false,
    gitExecuted: false,
    stage2: "BLOCKED",
    resources: { availableBytes, limits: LIMITS },
    cleanup,
  };
  const manifest = {
    actor: "TASK005_GIT_MATERIALS_MANIFEST_V1",
    state: "EMPTY_NOT_RUN",
    authority: "DIAGNOSTIC_ONLY",
    installationAuthorization: false,
    canonicalUrls: [INDEX_URL, SECDB_URL],
    files: [],
  };
  return { receipt, manifest };
}

function listDockerImages(context, command, operation, timeoutMs = 30_000) {
  const observed = runCommand(operation, command, "docker", ["image", "ls", "--all", "--digests", "--no-trunc",
    "--format", "{{.Repository}}@{{.Digest}}|{{.ID}}"], {
    cwd: context.runnerTemp, env: dockerEnvironment(process.env), timeoutMs,
  });
  const lines = observed.stdout.toString("utf8").split(/\r?\n/u).filter(Boolean);
  if (lines.length > 4096) throw failure("task005_git_materials_carrier_ownership_failed");
  return lines.map((line) => {
    const separator = line.lastIndexOf("|");
    const reference = line.slice(0, separator);
    const imageId = line.slice(separator + 1);
    if (separator < 1 || reference.length > 512 || hasControl(reference) || reference.includes("|")
      || !/^sha256:[0-9a-f]{64}$/u.test(imageId)
      || reference !== "<none>@<none>"
        && !/^[^@|\s]+@(?:<none>|sha256:[0-9a-f]{64})$/u.test(reference)) {
      throw failure("task005_git_materials_carrier_ownership_failed");
    }
    return { imageId, reference };
  });
}

function remainingMs(deadlineAt, monotonicNow, cap) {
  const remaining = Math.floor(deadlineAt - monotonicNow());
  if (remaining < 1) throw failure("task005_git_materials_child_timeout");
  return Math.min(cap, remaining);
}

async function probeCarrier(context, command, resources, timing = {}) {
  const monotonicNow = timing.monotonicNow ?? (() => globalThis.performance.now());
  const deadlineAt = timing.deadlineAt ?? monotonicNow() + LIMITS.actorMs;
  const env = dockerEnvironment(process.env);
  if (listDockerImages(context, command, "PROBE_IMAGE_LIST", remainingMs(deadlineAt, monotonicNow, 30_000))
    .some((image) => image.reference === CARRIER)) {
    throw failure("task005_git_materials_carrier_ownership_failed");
  }
  await writeFile(path.join(context.privateRoot, CARRIER_MARKER), "INITIAL_ABSENT\n", { flag: "wx", mode: 0o600 });
  resources.carrierMayBeOwned = true;
  const pulled = runCommand("PROBE_IMAGE_PULL", command, "docker", ["pull", "--platform", "linux/amd64", CARRIER], {
    cwd: context.privateRoot, env, timeoutMs: remainingMs(deadlineAt, monotonicNow, LIMITS.transferMs),
  });
  if (pulled.stdout.length + pulled.stderr.length < 1) throw failure("task005_git_materials_carrier_pull_failed");
  const inspected = runCommand("PROBE_IMAGE_INSPECT", command, "docker", ["image", "inspect", "--format", "{{json .RepoDigests}}|{{.Id}}", CARRIER], {
    cwd: context.privateRoot, env, timeoutMs: remainingMs(deadlineAt, monotonicNow, 30_000),
  }).stdout.toString("utf8").trim();
  const digest = CARRIER.slice(CARRIER.indexOf("@") + 1);
  const separator = inspected.lastIndexOf("|");
  const imageId = inspected.slice(separator + 1);
  let repoDigests;
  try {
    repoDigests = JSON.parse(inspected.slice(0, separator));
  } catch {
    throw failure("task005_git_materials_carrier_identity_failed");
  }
  if (!Array.isArray(repoDigests) || repoDigests.length < 1 || repoDigests.length > 32
    || repoDigests.some((value) => typeof value !== "string" || value.length > 512 || hasControl(value))
    || !repoDigests.includes(`golang@${digest}`) || !/^sha256:[0-9a-f]{64}$/u.test(imageId)) {
    throw failure("task005_git_materials_carrier_identity_failed");
  }
  await writeFile(path.join(context.privateRoot, CARRIER_ID_MARKER), `${imageId}\n`, { flag: "wx", mode: 0o600 });
  const version = parseApkVersion(runCarrier(context, resources, command, "PROBE_APK_VERSION", "/sbin/apk", ["--version"], [],
    remainingMs(deadlineAt, monotonicNow, LIMITS.childMs)).stdout);
  const help = {};
  for (const probe of HELP_PROBES) {
    help[probe.name] = runCarrier(context, resources, command, probe.operation, "/sbin/apk", probe.args, [],
      remainingMs(deadlineAt, monotonicNow, LIMITS.childMs)).stdout;
  }
  return { version, help, imageId };
}

function strictUtf8(bytes, code = "task005_git_materials_material_invalid") {
  try {
    return new globalThis.TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw failure(code);
  }
}

function networkArgument(help) {
  const selected = selectNetworkDenial(addHelpTokens(help));
  if (selected !== undefined) return selected;
  throw failure("task005_git_materials_probe_not_run");
}

async function downloadBytes(url, maximumBytes, fetchImpl, deadlineAt, clock = Date.now) {
  validateCanonicalUrl(url, url === INDEX_URL ? "index" : url === SECDB_URL ? "secdb" : "apk");
  let current = url;
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    const remaining = Math.min(LIMITS.transferMs, deadlineAt - clock());
    if (remaining < 1) throw failure("task005_git_materials_download_failed");
    const controller = new globalThis.AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), remaining);
    const aborted = new Promise((_, reject) => controller.signal.addEventListener("abort",
      () => reject(failure("task005_git_materials_download_failed")), { once: true }));
    let response;
    try {
      response = await Promise.race([fetchImpl(current, { redirect: "manual", signal: controller.signal,
        headers: { "user-agent": "auto-world-task005-git-materials-v9" } }), aborted]);
      if ([301, 302, 303, 307, 308].includes(response?.status)) {
        const location = response.headers.get("location");
        if (typeof location !== "string") throw failure("task005_git_materials_download_failed");
        const next = new URL(location, current).href;
        validateCanonicalUrl(next, url === INDEX_URL ? "index" : url === SECDB_URL ? "secdb" : "apk");
        await response.body?.cancel?.();
        current = next;
        continue;
      }
      if (!response?.ok || current !== url || response.url && response.url !== url || !response.body) {
        throw failure("task005_git_materials_download_failed");
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && (!/^[0-9]+$/u.test(contentLength) || Number(contentLength) > maximumBytes)) {
        throw failure("task005_git_materials_material_limit_exceeded");
      }
      const chunks = [];
      let total = 0;
      const reader = response.body.getReader();
      while (true) {
        if (clock() >= deadlineAt || controller.signal.aborted) {
          await reader.cancel().catch(() => undefined);
          throw failure("task005_git_materials_download_failed");
        }
        const part = await Promise.race([reader.read(), aborted]);
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) throw failure("task005_git_materials_download_failed");
        total += part.value.length;
        if (total > maximumBytes) {
          await reader.cancel();
          throw failure("task005_git_materials_material_limit_exceeded");
        }
        chunks.push(Buffer.from(part.value));
      }
      if (total < 1 || contentLength !== null && Number(contentLength) !== total) {
        throw failure("task005_git_materials_download_failed");
      }
      return { bytes: Buffer.concat(chunks, total), headers: response.headers };
    } catch (error) {
      try {
        await response?.body?.cancel?.();
      } catch {
        // Best-effort cancellation must not replace the bounded primary failure.
      }
      const code = ownValue(error, "code");
      if (typeof code === "string" && PUBLIC_CODES.has(code)) throw error;
      throw failure("task005_git_materials_download_failed");
    } finally {
      globalThis.clearTimeout(timer);
    }
  }
  throw failure("task005_git_materials_download_failed");
}

function parseKeyManifest(bytes) {
  const lines = strictUtf8(bytes).trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length < 1 || lines.length > 32) throw failure("task005_git_materials_material_invalid");
  const entries = lines.map((line) => {
    const parts = line.split("\t");
    if (parts.length !== 3 || !/^[A-Za-z0-9@._+-]{1,128}\.rsa\.pub$/u.test(parts[0])
      || !/^[1-9][0-9]{0,8}$/u.test(parts[1]) || !/^[0-9a-f]{64}$/u.test(parts[2])) {
      throw failure("task005_git_materials_material_invalid");
    }
    return { name: parts[0], bytes: Number(parts[1]), sha256: parts[2] };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(entries.map((entry) => entry.name)).size !== entries.length) {
    throw failure("task005_git_materials_material_invalid");
  }
  return entries;
}

function parseInstalledHash(bytes) {
  const match = strictUtf8(bytes).trim().match(/^([0-9a-f]{64}) {2}\/lib\/apk\/db\/installed$/u);
  if (!match) throw failure("task005_git_materials_material_invalid");
  return match[1];
}

function parseStdinHash(bytes) {
  const match = strictUtf8(bytes).trim().match(/^([0-9a-f]{64}) {2}-$/u);
  if (!match) throw failure("task005_git_materials_material_invalid");
  return match[1];
}

function parseTransaction(bytes) {
  const text = strictUtf8(bytes, "task005_git_materials_solver_invalid");
  if (/\b(?:Upgrading|Downgrading|Purging|Reinstalling)\b/u.test(text)) {
    throw failure("task005_git_materials_solver_invalid");
  }
  const entries = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\(([1-9][0-9]*)\/([1-9][0-9]*)\) Installing ([a-z0-9][a-z0-9+._-]{0,127}) \(([a-z0-9][a-z0-9+._-]{0,127})\)$/u);
    if (match) entries.push({ order: Number(match[1]), total: Number(match[2]), action: "ADD", name: match[3], version: match[4] });
    else if (/^\([0-9]+\/[0-9]+\) /u.test(line)) throw failure("task005_git_materials_solver_invalid");
  }
  if (entries.length < 1 || entries.length > LIMITS.apkCount || entries[0].order !== 1
    || entries.some((entry, index) => entry.order !== index + 1 || entry.total !== entries.length)
    || new Set(entries.map((entry) => entry.name)).size !== entries.length
    || !entries.some((entry) => entry.name === "git" && entry.version === "2.54.0-r0")) {
    throw failure("task005_git_materials_solver_invalid");
  }
  return entries.map((entry) => ({ action: entry.action, name: entry.name, order: entry.order, version: entry.version }));
}

function stringArray(value, maximum = 256) {
  if (value === null || value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > maximum || values.some((entry) => typeof entry !== "string" || entry.length > 1024
    || hasControl(entry))) throw failure("task005_git_materials_material_invalid");
  return values;
}

function parseQuery(bytes, transaction) {
  let value;
  try {
    value = JSON.parse(strictUtf8(bytes));
  } catch {
    throw failure("task005_git_materials_material_invalid");
  }
  const records = Array.isArray(value) ? value : value?.packages;
  if (!Array.isArray(records) || records.length !== transaction.length) {
    throw failure("task005_git_materials_material_invalid");
  }
  const normalized = records.map((record) => {
    const installedSize = record?.["installed-size"];
    const size = record?.["file-size"];
    if (typeof record?.name !== "string" || typeof record?.version !== "string"
      || typeof record?.arch !== "string" || record.arch !== "x86_64"
      || !Number.isSafeInteger(size) || size < 1 || size > LIMITS.apkBytes
      || !Number.isSafeInteger(installedSize) || installedSize < 1 || installedSize > LIMITS.expandedEvidenceBytes
      || typeof record?.license !== "string" || record.license.length < 1 || record.license.length > 512
      || hasControl(record.license)
      || typeof record?.origin !== "string" || !VERSION.test(record.origin)
      || typeof record?.maintainer !== "string" || record.maintainer.length < 1 || record.maintainer.length > 512
      || hasControl(record.maintainer)
      || typeof record?.commit !== "string" || !/^[0-9a-f]{40}$/u.test(record.commit)) {
      throw failure("task005_git_materials_material_invalid");
    }
    const expected = transaction.find((entry) => entry.name === record.name);
    if (!expected || expected.version !== record.version) throw failure("task005_git_materials_material_invalid");
    return {
      architecture: record.arch,
      commitDeclaration: record.commit,
      dependencies: stringArray(record.depends),
      installIf: stringArray(record["install-if"]),
      installedSize,
      license: record.license,
      maintainer: record.maintainer,
      name: record.name,
      origin: record.origin,
      size,
      version: record.version,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(normalized.map((record) => record.name)).size !== normalized.length) {
    throw failure("task005_git_materials_material_invalid");
  }
  return normalized;
}

function parseRegularManifest(bytes) {
  const text = strictUtf8(bytes);
  const entries = text.trim().split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = line.match(/^(SHA1|SHA256):([0-9a-f]+) {2}(.+)$/u);
    if (!match || match[1] === "SHA1" && match[2].length !== 40 || match[1] === "SHA256" && match[2].length !== 64
      || match[3].length > 4096 || match[3].startsWith("/") || match[3].includes("\\")
      || match[3].split("/").some((part) => part === "" || part === "." || part === "..")
      || hasControl(match[3])) throw failure("task005_git_materials_material_invalid");
    return { algorithm: match[1], digest: match[2], path: match[3] };
  }).sort((left, right) => left.path.localeCompare(right.path) || left.algorithm.localeCompare(right.algorithm));
  if (entries.length < 1 || new Set(entries.map((entry) => entry.path)).size !== entries.length) {
    throw failure("task005_git_materials_material_invalid");
  }
  const canonical = Buffer.from(canonicalJson(entries));
  if (canonical.length > LIMITS.expandedEvidenceBytes) throw failure("task005_git_materials_material_limit_exceeded");
  return { entries, bytes: canonical.length, sha256: sha256(canonical) };
}

function parseSecdb(bytes, packages, compareVersion) {
  let value;
  try {
    value = JSON.parse(strictUtf8(bytes, "task005_git_materials_secdb_invalid"));
  } catch {
    throw failure("task005_git_materials_secdb_invalid");
  }
  if (value?.distroversion !== "v3.24" || value?.reponame !== "main" || !Array.isArray(value?.packages)) {
    throw failure("task005_git_materials_secdb_invalid");
  }
  const byName = new Map();
  for (const entry of value.packages) {
    const name = entry?.pkg?.name;
    if (typeof name !== "string" || byName.has(name) || entry.pkg.secfixes !== undefined
      && (entry.pkg.secfixes === null || typeof entry.pkg.secfixes !== "object" || Array.isArray(entry.pkg.secfixes))) {
      throw failure("task005_git_materials_secdb_invalid");
    }
    byName.set(name, entry.pkg.secfixes ?? {});
  }
  return packages.map((pkg) => {
    const secfixes = byName.get(pkg.origin);
    if (secfixes === undefined) return { source: pkg.origin, packageVersion: pkg.version, state: "UNKNOWN", fixes: [] };
    const fixes = [];
    for (const threshold of Object.keys(secfixes).sort()) {
      const cves = secfixes[threshold];
      if (!Array.isArray(cves) || cves.length < 1 || cves.some((cve) => typeof cve !== "string" || !/^CVE-[0-9]{4}-[0-9]{4,}$/u.test(cve))) {
        throw failure("task005_git_materials_secdb_invalid");
      }
      if (threshold === "0") {
        for (const cve of [...new Set(cves)].sort()) fixes.push({ cve, state: "SECDB_ZERO_SENTINEL_UNRESOLVED", threshold: "0" });
      } else {
        if (!VERSION.test(threshold)) throw failure("task005_git_materials_secdb_invalid");
        const relation = compareVersion(pkg.version, threshold);
        if (!["<", "=", ">"].includes(relation)) throw failure("task005_git_materials_secdb_invalid");
        for (const cve of [...new Set(cves)].sort()) fixes.push({ cve, state: relation === "<" ? "BELOW_RECORDED_FIX" : "AT_OR_ABOVE_RECORDED_FIX", threshold });
      }
    }
    return { source: pkg.origin, packageVersion: pkg.version, state: fixes.length === 0 ? "UNKNOWN" : "OBSERVED", fixes };
  }).sort((left, right) => left.source.localeCompare(right.source));
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function validateEvidence(evidence, context) {
  if (evidence === null || typeof evidence !== "object" || evidence.receipt === null
    || typeof evidence.receipt !== "object" || evidence.manifest === null || typeof evidence.manifest !== "object") {
    throw failure("task005_git_materials_material_invalid");
  }
  const receipt = evidence.receipt;
  const manifest = evidence.manifest;
  if (receipt.state === "NOT_RUN") {
    if (receipt.actor !== "TASK005_GIT_MATERIALS_V1" || receipt.installationAuthorization !== false
      || receipt.materialsAcquired !== false || receipt.stage2 !== "BLOCKED"
      || manifest.state !== "EMPTY_NOT_RUN" || manifest.installationAuthorization !== false) {
      throw failure("task005_git_materials_material_invalid");
    }
  } else {
    const top = ["actor", "authority", "boundaries", "carrier", "cleanup", "closure", "execution", "index",
      "installationAuthority", "keyManifest", "packages", "resources", "secdb", "security", "source", "state", "transaction"];
    const boundaryKeys = ["hookContent", "indexMetadata", "nonregularFileMetadata", "regularFileManifest", "repoCommitMeaning"];
    const receiptPackages = Array.isArray(receipt.packages) ? receipt.packages : [];
    const manifestPackages = Array.isArray(manifest.packages) ? manifest.packages : [];
    if (receipt.actor !== "OWNED_SCANNER_GIT_MATERIAL_OBSERVATION_V1"
      || receipt.state !== "MATERIAL_OBSERVATION_ONLY" || receipt.authority !== "DIAGNOSTIC_ONLY"
      || receipt.installationAuthority !== false || Object.keys(receipt).sort().join("|") !== top.sort().join("|")
      || Object.keys(receipt.boundaries ?? {}).sort().join("|") !== boundaryKeys.sort().join("|")
      || receipt.boundaries.indexMetadata !== "OBSERVED" || receipt.boundaries.regularFileManifest !== "OBSERVED"
      || receipt.boundaries.hookContent !== "NOT_INSPECTED"
      || receipt.boundaries.nonregularFileMetadata !== "NOT_INSPECTED"
      || receipt.boundaries.repoCommitMeaning !== "SIGNED_INDEX_DECLARATION_ONLY"
      || receipt.execution?.gitExecuted !== false || receipt.execution?.packageInstalled !== false
      || receipt.execution?.packagePayloadExecuted !== false || receipt.security?.stage2 !== "BLOCKED"
      || receipt.security?.exhaustiveCoverage !== false || receipt.security?.severityAvailable !== false
      || receipt.security?.stillUnfixedStateAvailable !== false
      || receipt.index?.genericVerification !== "PASSED"
      || receipt.index?.repositoryAcceptance !== "SOLE_LOCAL_REPOSITORY_SOLVE_PASSED"
      || !/^sha256:[0-9a-f]{64}$/u.test(receipt.carrier?.imageId ?? "")
      || !["WITHIN_48_HOURS_NONAUTHORITATIVE", "STALE_BLOCKING_STAGE2"].includes(receipt.secdb?.freshness)
      || !Number.isFinite(receipt.secdb?.acquisitionToUseMs) || receipt.secdb.acquisitionToUseMs < 0
      || receipt.secdb.acquisitionToUseMs > 48 * 60 * 60_000
      || !Number.isFinite(receipt.secdb?.snapshotAgeMs) || receipt.secdb.snapshotAgeMs < 0
      || manifest.actor !== "TASK005_GIT_MATERIALS_MANIFEST_V1"
      || manifest.state !== "MATERIAL_OBSERVATION_ONLY" || manifest.installationAuthorization !== false
      || receiptPackages.length < 1 || manifestPackages.length !== receiptPackages.length
      || new Set(receiptPackages.map((pkg) => pkg?.name)).size !== receiptPackages.length
      || new Set(manifestPackages.map((pkg) => pkg?.filename)).size !== manifestPackages.length
      || manifestPackages.some((pkg) => pkg?.indexBinding !== "VERIFIED_BY_APK_FETCH"
        || pkg?.localSignature !== "VERIFIED_BY_APK_VERIFY")) {
      throw failure("task005_git_materials_material_invalid");
    }
    for (const pkg of receiptPackages) {
      const material = manifestPackages.find((item) => item.filename === `${pkg.name}-${pkg.version}.apk`);
      if (!material || material.bytes !== pkg.size || !/^[0-9a-f]{64}$/u.test(material.sha256 ?? "")
        || material.url !== `${APK_BASE_URL}${material.filename}`) {
        throw failure("task005_git_materials_material_invalid");
      }
    }
  }
  const serialized = canonicalJson(evidence);
  if (serialized.includes(context.runnerTemp) || serialized.includes("/materials")
    || /\b(?:COMPLETE|QUALIFIED)\b/u.test(serialized) || /installationAuthority":true/u.test(serialized)) {
    throw failure("task005_git_materials_material_invalid");
  }
  const inspect = (value) => {
    if (Array.isArray(value)) for (const item of value) inspect(item);
    else if (value !== null && typeof value === "object") for (const item of Object.values(value)) inspect(item);
    else if (typeof value === "string" && value.includes("://")) validateCanonicalUrl(value, "any");
  };
  inspect(evidence);
  return evidence;
}

async function materializeObservation({ context, probe, command, resources, fetchImpl, now = Date.now, monotonicNow = now,
  wallNow = now, deadlineAt = monotonicNow() + LIMITS.actorMs, availableBytes,
  identityIo = DEFAULT_IDENTITY_IO }) {
  const started = monotonicNow();
  const transferDeadline = Math.min(deadlineAt, started + LIMITS.transferMs);
  const ensureTime = () => {
    if (monotonicNow() >= deadlineAt) throw failure("task005_git_materials_child_timeout");
  };
  await bindMaterialOwner(context, resources, identityIo);
  const network = networkArgument(probe.help);
  const repo = path.join(context.privateRoot, "repo");
  await mkdir(repo, { mode: 0o700 });
  const repositories = path.join(context.privateRoot, "repositories");
  await writeFile(repositories, "ndx file:///materials/repo/APKINDEX.tar.gz\n", { flag: "wx", mode: 0o600 });
  const mounts = Object.freeze([Object.freeze({ source: context.privateRoot, target: "/materials" })]);
  const carrier = (operation, entrypoint, args, timeoutMs = LIMITS.childMs) => {
    ensureTime();
    const result = runCarrier(context, resources, command, operation, entrypoint, args, mounts,
      remainingMs(deadlineAt, monotonicNow, timeoutMs));
    if (result.stderr.length !== 0) throw failure("task005_git_materials_material_invalid");
    return result.stdout;
  };
  const keyScript = "set -eu; find /etc/apk/keys -mindepth 1 -maxdepth 1 -exec /bin/sh -ceu 'for f do [ -f \"$f\" ] && [ ! -L \"$f\" ] && [ \"$(stat -c %h \"$f\")\" = 1 ] || exit 41; n=$(basename \"$f\"); b=$(wc -c < \"$f\"); h=$(sha256sum \"$f\" | cut -d\" \" -f1); printf \"%s\\t%s\\t%s\\n\" \"$n\" \"$b\" \"$h\"; done' actor {} +";
  const keys = parseKeyManifest(carrier("MATERIAL_KEYS", "/bin/sh", ["-ceu", keyScript]));
  const installedBefore = parseInstalledHash(carrier("MATERIAL_INSTALLED_BEFORE", "/bin/busybox",
    ["sha256sum", "/lib/apk/db/installed"]));
  const index = await downloadBytes(INDEX_URL, LIMITS.indexBytes, fetchImpl,
    transferDeadline, monotonicNow);
  const indexPath = path.join(repo, "APKINDEX.tar.gz");
  await writeFile(indexPath, index.bytes, { flag: "wx", mode: 0o600 });
  carrier("MATERIAL_INDEX_VERIFY", "/sbin/apk", ["--keys-dir", "/etc/apk/keys", "verify", "/materials/repo/APKINDEX.tar.gz"]);
  const apkBase = ["--keys-dir", "/etc/apk/keys", "--repositories-file", "/materials/repositories", network];
  const simulate = (operation) => parseTransaction(carrier(operation, "/sbin/apk",
    [...apkBase, "add", "--simulate", "git=2.54.0-r0"]));
  const transactionA = simulate("MATERIAL_SIMULATE_FIRST");
  const selectors = transactionA.map((entry) => `${entry.name}=${entry.version}`);
  const queryFields = "name,version,arch,file-size,installed-size,license,origin,maintainer,commit,depends,install-if";
  const packages = parseQuery(carrier("MATERIAL_QUERY", "/sbin/apk", [...apkBase, "query", "--from", "repositories",
    "--format", "json", "--fields", queryFields, ...selectors]), transactionA);
  let aggregateApkBytes = 0;
  let expandedEvidenceBytes = 0;
  const packageFiles = [];
  for (const pkg of packages) {
    ensureTime();
    const filename = `${pkg.name}-${pkg.version}.apk`;
    if (!APK_FILENAME.test(filename)) throw failure("task005_git_materials_material_invalid");
    const url = validateCanonicalUrl(`${APK_BASE_URL}${filename}`, "apk");
    const downloaded = await downloadBytes(url, LIMITS.apkBytes, fetchImpl,
      transferDeadline, monotonicNow);
    if (downloaded.bytes.length !== pkg.size) throw failure("task005_git_materials_material_invalid");
    aggregateApkBytes += downloaded.bytes.length;
    if (aggregateApkBytes > LIMITS.apkAggregateBytes) throw failure("task005_git_materials_material_limit_exceeded");
    const destination = path.join(repo, filename);
    await writeFile(destination, downloaded.bytes, { flag: "wx", mode: 0o600 });
    carrier("MATERIAL_APK_VERIFY", "/sbin/apk", ["--keys-dir", "/etc/apk/keys", "verify", `/materials/repo/${filename}`]);
    const selector = `${pkg.name}=${pkg.version}`;
    const fetchScript = "set -eu; set -o pipefail; /sbin/apk --keys-dir /etc/apk/keys --repositories-file /materials/repositories \"$1\" fetch --stdout \"$2\" | /bin/busybox sha256sum";
    const repositoryHash = parseStdinHash(carrier("MATERIAL_APK_INDEX_BINDING", "/bin/sh",
      ["-ceu", fetchScript, "actor", network, selector]));
    if (repositoryHash !== sha256(downloaded.bytes)) throw failure("task005_git_materials_material_invalid");
    const regular = parseRegularManifest(carrier("MATERIAL_APK_MANIFEST", "/sbin/apk",
      ["manifest", `/materials/repo/${filename}`]));
    expandedEvidenceBytes += regular.bytes;
    if (expandedEvidenceBytes > LIMITS.expandedEvidenceBytes) {
      throw failure("task005_git_materials_material_limit_exceeded");
    }
    packageFiles.push({
      bytes: downloaded.bytes.length,
      filename,
      regularFiles: regular,
      sha256: sha256(downloaded.bytes),
      indexBinding: "VERIFIED_BY_APK_FETCH",
      localSignature: "VERIFIED_BY_APK_VERIFY",
      url,
    });
  }
  const transactionB = simulate("MATERIAL_SIMULATE_SECOND");
  if (!sameJson(transactionA, transactionB)) throw failure("task005_git_materials_solver_invalid");
  const installedAfter = parseInstalledHash(carrier("MATERIAL_INSTALLED_AFTER", "/bin/busybox",
    ["sha256sum", "/lib/apk/db/installed"]));
  if (installedBefore !== installedAfter) throw failure("task005_git_materials_solver_invalid");
  const secdb = await downloadBytes(SECDB_URL, LIMITS.secdbBytes, fetchImpl,
    transferDeadline, monotonicNow);
  const secdbAcquiredAt = wallNow();
  const collectedAt = new Date(secdbAcquiredAt).toISOString();
  const lastModified = secdb.headers.get("last-modified");
  const etag = secdb.headers.get("etag");
  const modifiedAt = Date.parse(lastModified ?? "");
  if (!lastModified || !etag || etag.length > 512 || hasControl(etag)
    || !Number.isFinite(modifiedAt) || modifiedAt > wallNow() + 5 * 60_000) {
    throw failure("task005_git_materials_secdb_invalid");
  }
  const compare = (left, right) => {
    const output = carrier("MATERIAL_VERSION_COMPARE", "/sbin/apk", ["version", "--test", left, right]);
    const relation = strictUtf8(output, "task005_git_materials_secdb_invalid").trim();
    if (!["<", "=", ">"].includes(relation)) throw failure("task005_git_materials_secdb_invalid");
    return relation;
  };
  const advisories = parseSecdb(secdb.bytes, packages, compare);
  const acquisitionToUseMs = Math.max(0, wallNow() - secdbAcquiredAt);
  if (acquisitionToUseMs > 48 * 60 * 60_000) throw failure("task005_git_materials_secdb_invalid");
  const zeroSentinels = advisories.flatMap((record) => record.fixes
    .filter((item) => item.state === "SECDB_ZERO_SENTINEL_UNRESOLVED")
    .map((item) => ({ cve: item.cve, source: record.source })));
  const unknownSources = advisories.filter((record) => record.state === "UNKNOWN").map((record) => record.source);
  const privateBytes = await privateTreeBytes(context.privateRoot);
  const secdbAgeMs = Math.max(0, secdbAcquiredAt - modifiedAt);
  const indexIdentity = { bytes: index.bytes.length, genericVerification: "PASSED",
    repositoryAcceptance: "SOLE_LOCAL_REPOSITORY_SOLVE_PASSED", sha256: sha256(index.bytes), url: INDEX_URL };
  const secdbIdentity = { bytes: secdb.bytes.length, collectedAt, etag, lastModified,
    freshness: secdbAgeMs <= 48 * 60 * 60_000 ? "WITHIN_48_HOURS_NONAUTHORITATIVE" : "STALE_BLOCKING_STAGE2",
    acquisitionToUseMs, sha256: sha256(secdb.bytes), snapshotAgeMs: secdbAgeMs, url: SECDB_URL };
  const transactionHash = sha256(Buffer.from(canonicalJson(transactionA)));
  const closureHash = sha256(Buffer.from(canonicalJson(packageFiles.map(({ filename, bytes, sha256: hash }) => ({ filename, bytes, sha256: hash })))));
  const manifest = {
    actor: "TASK005_GIT_MATERIALS_MANIFEST_V1",
    authority: "DIAGNOSTIC_ONLY",
    installationAuthorization: false,
    state: "MATERIAL_OBSERVATION_ONLY",
    index: indexIdentity,
    keys,
    packages: packageFiles,
    secdb: secdbIdentity,
  };
  const receipt = {
    actor: "OWNED_SCANNER_GIT_MATERIAL_OBSERVATION_V1",
    authority: "DIAGNOSTIC_ONLY",
    state: "MATERIAL_OBSERVATION_ONLY",
    installationAuthority: false,
    source: { acceptedBase: ACCEPTED_BASE, headSha: context.headSha, mergeSha: context.mergeSha,
      pullRequest: context.eventNumber, runAttempt: 1, runId: context.runId, runNumber: 1 },
    carrier: { apkVersion: probe.version, imageId: probe.imageId, reference: CARRIER,
      capabilities: Object.fromEntries(Object.keys(probe.help).sort().map((name) => [name, {
        bytes: probe.help[name].length, sha256: sha256(probe.help[name]),
      }])) },
    index: indexIdentity,
    keyManifest: { count: keys.length, sha256: sha256(Buffer.from(canonicalJson(keys))) },
    secdb: secdbIdentity,
    packages,
    transaction: { action: "ADD_ONLY", entries: transactionA, installedDatabaseBefore: installedBefore,
      installedDatabaseAfter: installedAfter, sha256: transactionHash },
    closure: { count: packageFiles.length, compressedBytes: aggregateApkBytes, expandedEvidenceBytes,
      installedBytes: packages.reduce((total, pkg) => total + pkg.installedSize, 0), privateBytes, sha256: closureHash },
    boundaries: {
      hookContent: "NOT_INSPECTED",
      indexMetadata: "OBSERVED",
      nonregularFileMetadata: "NOT_INSPECTED",
      regularFileManifest: "OBSERVED",
      repoCommitMeaning: "SIGNED_INDEX_DECLARATION_ONLY",
    },
    security: { advisories, exhaustiveCoverage: false, severityAvailable: false, stillUnfixedStateAvailable: false,
      stage2: "BLOCKED", unknownSources: [...new Set(unknownSources)].sort(),
      zeroSentinels: [...new Map(zeroSentinels.map((item) => [`${item.source}|${item.cve}`, item])).values()] },
    resources: { availableBytes, limits: LIMITS },
    execution: { gitExecuted: false, packageInstalled: false, packagePayloadExecuted: false },
    cleanup: { containersAbsent: true, privateFilesAbsent: true },
  };
  const projected = Buffer.byteLength(canonicalJson(receipt)) + Buffer.byteLength(canonicalJson(manifest));
  if (projected > LIMITS.publicAggregateBytes) throw failure("task005_git_materials_public_cap_exceeded");
  return { receipt, manifest };
}

function cleanupContainers(context, names, command) {
  const env = dockerEnvironment(process.env);
  for (const name of names) {
    const observed = listDockerContainers(context, command).find((container) => container.name === name);
    if (!observed) continue;
    if (observed.actor !== "true" || observed.runId !== context.runId) {
      throw failure("task005_git_materials_container_ownership_failed");
    }
    runCommand("CLEANUP_CONTAINER_REMOVE", command, "docker", ["container", "rm", "--force", name], {
      cwd: context.runnerTemp, env, timeoutMs: 30_000,
    });
    if (listDockerContainers(context, command).some((container) => container.name === name)) {
      throw failure("task005_git_materials_cleanup_failed");
    }
  }
}

function listDockerContainers(context, command) {
  const observed = runCommand("CLEANUP_CONTAINER_LIST", command, "docker", ["container", "ls", "--all", "--format",
    "{{.Names}}|{{.Label \"com.auto-world.task005.git-materials-v9\"}}|{{.Label \"com.auto-world.github-run-id\"}}"], {
    cwd: context.runnerTemp, env: dockerEnvironment(process.env), timeoutMs: 30_000,
  });
  const lines = observed.stdout.toString("utf8").split(/\r?\n/u).filter(Boolean);
  if (lines.length > 4096) throw failure("task005_git_materials_container_ownership_failed");
  return lines.map((line) => {
    const parts = line.split("|");
    if (parts.length !== 3 || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$/u.test(parts[0])
      || parts.some((part) => hasControl(part) || part.length > 255)) {
      throw failure("task005_git_materials_container_ownership_failed");
    }
    return { name: parts[0], actor: parts[1], runId: parts[2] };
  });
}

function discoverOwnedContainers(context, command) {
  const env = dockerEnvironment(process.env);
  const observed = runCommand("CLEANUP_CONTAINER_DISCOVER", command, "docker", ["container", "ls", "--all", "--filter",
    "label=com.auto-world.task005.git-materials-v9=true", "--filter", `label=com.auto-world.github-run-id=${context.runId}`,
    "--format", "{{.Names}}"], { cwd: context.runnerTemp, env, timeoutMs: 30_000 });
  const names = observed.stdout.toString("utf8").split(/\r?\n/u).filter(Boolean);
  if (new Set(names).size !== names.length || names.length > 64
    || names.some((name) => !new RegExp(`^aw-task005-git-materials-${context.runId}-[0-9]{3}$`, "u").test(name))) {
    throw failure("task005_git_materials_container_ownership_failed");
  }
  return names;
}

async function cleanupOwnedState(context, command, resources = {}) {
  const discovered = discoverOwnedContainers(context, command);
  const names = [...new Set([...(resources.containerNames ?? []), ...discovered])];
  cleanupContainers(context, names, command);
  const marker = path.join(context.privateRoot, CARRIER_MARKER);
  let mayRemoveCarrier = resources.carrierMayBeOwned === true;
  try {
    const info = await lstat(marker);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== 15
      || (info.mode & 0o777) !== 0o600 || await readFile(marker, "utf8") !== "INITIAL_ABSENT\n") {
      throw failure("task005_git_materials_carrier_ownership_failed");
    }
    mayRemoveCarrier = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (mayRemoveCarrier) {
    const env = dockerEnvironment(process.env);
    let recordedImageId;
    try {
      const identityInfo = await lstat(path.join(context.privateRoot, CARRIER_ID_MARKER));
      const identityValue = (await readFile(path.join(context.privateRoot, CARRIER_ID_MARKER), "utf8")).trim();
      if (!identityInfo.isFile() || identityInfo.isSymbolicLink() || identityInfo.nlink !== 1
        || (identityInfo.mode & 0o777) !== 0o600 || identityInfo.size !== 72
        || !/^sha256:[0-9a-f]{64}$/u.test(identityValue)) {
        throw failure("task005_git_materials_carrier_ownership_failed");
      }
      recordedImageId = identityValue;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const carrierImages = listDockerImages(context, command, "CLEANUP_IMAGE_LIST").filter((image) => image.reference === CARRIER);
    if (carrierImages.length > 1) throw failure("task005_git_materials_carrier_ownership_failed");
    if (carrierImages.length === 1) {
      const [{ imageId }] = carrierImages;
      if (recordedImageId !== undefined && recordedImageId !== imageId) {
        throw failure("task005_git_materials_carrier_ownership_failed");
      }
      runCommand("CLEANUP_IMAGE_REMOVE", command, "docker", ["image", "rm", CARRIER], {
        cwd: context.runnerTemp, env, timeoutMs: 60_000,
      });
    }
    if (listDockerImages(context, command, "CLEANUP_IMAGE_LIST").some((image) => image.reference === CARRIER)) {
      throw failure("task005_git_materials_cleanup_failed");
    }
  }
  await removePrivateRoot(context.privateRoot);
}

async function executeActor(context, options = {}) {
  const monotonicNow = options.monotonicNow ?? options.now ?? (() => globalThis.performance.now());
  const wallNow = options.wallNow ?? options.now ?? Date.now;
  const deadlineAt = monotonicNow() + LIMITS.actorMs;
  const command = options.command ?? defaultCommand;
  const availableBytes = await requireCapacity(context.runnerTemp, options.statfs ?? statfs);
  await assertAbsent(context.privateRoot, "task005_git_materials_private_root_invalid");
  await assertAbsent(context.publicRoot, "task005_git_materials_public_root_invalid");
  await createOwnedDirectory(context.privateRoot);
  let firstError;
  let evidence;
  const resources = { carrierMayBeOwned: false, containerNames: [], nextOrdinal: 0 };
  try {
    const probe = await (options.probe ?? probeCarrier)(context, command, resources, { deadlineAt, monotonicNow });
    const assessment = assessHelp(probe.help);
    if (!assessment.complete) {
      evidence = notRunEvidence(context, probe.version, probe.help, assessment, {
        containersAbsent: true, privateFilesAbsent: true,
      }, probe.imageId, availableBytes);
    } else {
      evidence = await (options.materialize ?? materializeObservation)({
        availableBytes, context, probe, command, limits: LIMITS, resources,
        fetchImpl: options.fetchImpl ?? globalThis.fetch,
        deadlineAt, monotonicNow, wallNow, identityIo: options.identityIo,
      });
    }
  } catch (error) {
    firstError = error;
    await writeFailureMarker(context, firstError).catch(() => undefined);
  }
  let cleanupComplete = false;
  try {
    await (options.cleanup ?? cleanupOwnedState)(context, command, resources);
    cleanupComplete = true;
  } catch (cleanupError) {
    if (firstError === undefined) {
      firstError = cleanupError;
      await writeFailureMarker(context, firstError).catch(() => undefined);
    }
  }
  if (firstError !== undefined) {
    if (cleanupComplete) {
      const blocked = blockedEvidence(firstError);
      await writePublicFiles(context.publicRoot, blocked.receipt, blocked.manifest);
    }
    throw firstError;
  }
  validateEvidence(evidence, context);
  await writePublicFiles(context.publicRoot, evidence.receipt, evidence.manifest);
  return evidence;
}

async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  if (argv.length !== 1 || !["execute", "cleanup", "dispose-public"].includes(argv[0])) {
    throw failure("task005_git_materials_arguments_invalid");
  }
  const context = await requireContext(env, options.platform ?? process.platform);
  const log = options.log ?? console.log;
  if (argv[0] === "execute") {
    const evidence = await executeActor(context, options);
    log(canonicalJson({
      actor: "TASK005_GIT_MATERIALS_V1",
      authority: "DIAGNOSTIC_ONLY",
      installationAuthorization: false,
      state: evidence.receipt.state,
    }).trimEnd());
    return evidence;
  }
  if (argv[0] === "cleanup") {
    let deferredFailure;
    let markerError;
    try {
      deferredFailure = await readFailureMarker(context);
    } catch (error) {
      markerError = error;
    }
    let cleanupError;
    try {
      if (options.cleanup) await options.cleanup(context, options.command ?? defaultCommand, {});
      else if ((await lstat(context.privateRoot).catch((error) => ownValue(error, "code") === "ENOENT"
        ? null : Promise.reject(error))) === null) {
        const names = discoverOwnedContainers(context, options.command ?? defaultCommand);
        if (names.length !== 0) throw failure("task005_git_materials_cleanup_failed");
      } else {
        await cleanupOwnedState(context, options.command ?? defaultCommand, {});
      }
      await assertAbsent(context.privateRoot);
    } catch (error) {
      cleanupError = error;
    }
    if (markerError !== undefined) throw markerError;
    if (cleanupError !== undefined) throw cleanupError;
    if (deferredFailure !== undefined) {
      await assertAbsent(context.publicRoot, "task005_git_materials_public_root_invalid");
      const blocked = blockedEvidence(deferredFailure);
      await writePublicFiles(context.publicRoot, blocked.receipt, blocked.manifest);
    }
    log(canonicalJson({ state: "CLEANED", installationAuthorization: false }).trimEnd());
    return;
  }
  await removePublicRoot(context.publicRoot);
  log(canonicalJson({ state: "PUBLIC_COPY_DISPOSED", installationAuthorization: false }).trimEnd());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(publicFailure(error).trimEnd());
    process.exitCode = 1;
  });
}

export {
  CHILD_OPERATIONS as TEST_ONLY_CHILD_OPERATIONS,
  LIMITS as TEST_ONLY_LIMITS,
  assessHelp as TEST_ONLY_assessHelp,
  canonicalJson as TEST_ONLY_canonicalJson,
  cleanupOwnedState as TEST_ONLY_cleanupOwnedState,
  downloadBytes as TEST_ONLY_downloadBytes,
  executeActor as TEST_ONLY_executeActor,
  main as TEST_ONLY_main,
  notRunEvidence as TEST_ONLY_notRunEvidence,
  materializeObservation as TEST_ONLY_materializeObservation,
  parseKeyManifest as TEST_ONLY_parseKeyManifest,
  parseQuery as TEST_ONLY_parseQuery,
  parseRegularManifest as TEST_ONLY_parseRegularManifest,
  parseSecdb as TEST_ONLY_parseSecdb,
  parseTransaction as TEST_ONLY_parseTransaction,
  publicFailure as TEST_ONLY_publicFailure,
  privateTreeBytes as TEST_ONLY_privateTreeBytes,
  readFailureMarker as TEST_ONLY_readFailureMarker,
  requireContext as TEST_ONLY_requireContext,
  runCarrier as TEST_ONLY_runCarrier,
  runCommand as TEST_ONLY_runCommand,
  validateCanonicalUrl as TEST_ONLY_validateCanonicalUrl,
  validateCommandResult as TEST_ONLY_validateCommandResult,
  validateEvidence as TEST_ONLY_validateEvidence,
  writeFailureMarker as TEST_ONLY_writeFailureMarker,
};
