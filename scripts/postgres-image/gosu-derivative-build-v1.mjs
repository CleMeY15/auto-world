import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { appendFile, chmod, lstat, mkdir, opendir, readFile, readdir, readlink, realpath, rename, rmdir, rm, unlink, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  GOSU_ARCHIVE_LIMITS_V1, assertIdentity, exactIdentity, materializeArchiveFile, scanGzipTar,
  scanModuleZip, scanPreparationTar, writeDeterministicUstar,
} from "./gosu-derivative-archives-v1.mjs";
import {
  GOSU_PUBLIC_FILES_V1, assertInitiallyAbsentOwnedChild, canonicalJson, canonicalNotices, canonicalSbom, fileIdentity, moduleClosure, parseGosuBuildInfo,
  parseUpstreamTestJson, reviewedIdentities, validateBuildReceipt, validatePublicTree,
  validateLock, validateModuleInfoCacheIdentity,
} from "./gosu-derivative-controls-v1.mjs";

const scriptFile = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(scriptFile), "../..");
const lockFile = path.join(repo, "infra/postgres-image/materials/gosu-derivative-lock-v1.json");
const MAX_DOWNLOAD = 1024 * 1024 ** 2;
const GOSU_CLEANUP_LIMITS_V1 = Object.freeze({ entries: 100_000, depth: 64, pathBytes: 4096 });
const COMMAND_STAGES = Object.freeze([
  "online_go_version", "online_mod_download", "online_mod_verify", "offline_go_test",
  "offline_go_build", "offline_gosu_version", "offline_go_build_info", "offline_isolation",
]);
const COMMAND_STAGE_SET = new Set(COMMAND_STAGES);
const COMMAND_REASONS = Object.freeze(["spawn", "timeout", "output_limit", "signal", "exit"]);
const CHILD_COMMAND_STAGES = Object.freeze(["offline_go_test", "offline_go_build", "offline_gosu_version", "offline_go_build_info"]);
const CHILD_FIXED_CODES = Object.freeze([
  "gosu_command_stage_invalid", "gosu_command_result_invalid", "gosu_offline_environment_invalid",
  "gosu_offline_identity_invalid", "gosu_offline_network_invalid", "gosu_offline_privilege_invalid",
  "gosu_offline_evidence_invalid", "gosu_tests_invalid", "gosu_tests_failed", "gosu_source_mutated",
  "gosu_version_invalid", "gosu_build_info_invalid", "gosu_build_info_vcs_invalid", "gosu_sumdb_invalid",
  "gosu_lock_identity_invalid",
]);
const ISOLATION_REASONS = Object.freeze([
  "setup_arguments_invalid", "setup_environment_invalid", "repeat_invalid",
  "uid_invalid", "gid_invalid", "original_netns_invalid", "original_mntns_invalid",
  "scratch_invalid", "output_invalid", "owned_paths_invalid", "ci_invalid",
  "run_id_invalid", "run_attempt_invalid", "head_sha_invalid", "job_invalid",
  "namespace_net_invalid", "namespace_mnt_invalid", "namespace_transition_invalid", "namespace_changed_invalid",
  "setup_platform_invalid", "setup_root_invalid", "setup_read_failed", "setup_netns_reused", "setup_mntns_reused",
  "setup_sysfs_not_directory", "setup_sysfs_symlink", "boundary_netns_reused", "boundary_mntns_reused",
  "boundary_observation_invalid", "boundary_interfaces_invalid", "boundary_routes_present",
  "boundary_flags_invalid", "boundary_flags_number_invalid", "boundary_loopback_missing", "boundary_loopback_up",
  "setup_mount_spawn", "setup_mount_timeout", "setup_mount_output_limit", "setup_mount_signal", "setup_mount_exit", "setup_mount_result_invalid",
  "setup_setpriv_spawn", "setup_setpriv_timeout", "setup_setpriv_output_limit", "setup_setpriv_signal", "setup_setpriv_exit", "setup_setpriv_result_invalid",
]);
const ISOLATION_FAILURES = Object.freeze(Object.fromEntries(ISOLATION_REASONS.map((reason) => {
  const code = `gosu_offline_network_invalid\ngosu_isolation_reason_${reason}`;
  return [reason, Object.freeze({ code, line: Buffer.from(`${code}\n`, "ascii") })];
})));
const CHILD_READ_STAGES = Object.freeze([
  "lock_read", "boundary_netns_read", "boundary_mntns_read", "boundary_status_read",
  "boundary_routes_read", "boundary_interfaces_read", "boundary_loopback_flags_read",
]);
const CHILD_MAIN_FAILURES = Object.freeze(Object.fromEntries([
  ...CHILD_READ_STAGES.flatMap((stage) => ["permission_denied", "path_unavailable", "unclassified"].map((reason) => `${stage}_${reason}`)),
  "runtime_invalid", "arguments_invalid", "lock_json_invalid", "lock_contract_invalid", "main_unclassified",
].map((reason) => {
  const code = `gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_${reason}`;
  return [reason, Object.freeze({ code, line: Buffer.from(`${code}\n`, "ascii") })];
})));
const CHILD_FAILURE_LINES = Object.freeze([
  ...CHILD_COMMAND_STAGES.flatMap((stage) => COMMAND_REASONS.map((reason) => `gosu_command_failed_${stage}_${reason}`)),
  ...CHILD_FIXED_CODES,
].map((code) => Object.freeze({ code, line: Buffer.from(`${code}\n`, "ascii") })).concat(Object.values(ISOLATION_FAILURES), Object.values(CHILD_MAIN_FAILURES)));
const MAX_CHILD_FAILURE_LINE_BYTES = Math.max(...CHILD_FAILURE_LINES.map(({ line }) => line.length));
const MAX_ORDINARY_ID = 4_294_967_294;
const SETUP_ENV_KEYS = Object.freeze([
  "AW_GOSU_ORIGINAL_NETNS", "AW_GOSU_ORIGINAL_MNTNS", "AW_GOSU_EXPECT_UID", "AW_GOSU_EXPECT_GID",
  "AW_GOSU_REPEAT", "AW_GOSU_SCRATCH", "AW_GOSU_OUTPUT", "AW_GOSU_CI_RUN_ID", "AW_GOSU_CI_RUN_ATTEMPT",
  "AW_GOSU_CI_HEAD_SHA", "AW_GOSU_CI_JOB",
]);
function fail(code) { throw new Error(code); }
function isolationFailure(reason) { fail(ISOLATION_FAILURES[reason].code); }
function childMainFailure(reason) { fail(CHILD_MAIN_FAILURES[reason].code); }
function ownErrorData(error, key) {
  try {
    if (!(error instanceof Error)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch { return undefined; }
}
async function childRead(stage, operation, offlineEntered) {
  try { return await operation(); }
  catch (error) {
    if (!offlineEntered) throw error;
    const code = ownErrorData(error, "code");
    childMainFailure(`${stage}_${code === "EACCES" || code === "EPERM" ? "permission_denied" : code === "ENOENT" || code === "ENOTDIR" ? "path_unavailable" : "unclassified"}`);
  }
}
function formatChildMainFailure(error, offlineEntered) {
  if (!offlineEntered) return formatGosuPreparationFailure(error);
  const message = ownErrorData(error, "message");
  const recognized = CHILD_FAILURE_LINES.find(({ code }) => code === message);
  return `${recognized?.code ?? CHILD_MAIN_FAILURES.main_unclassified.code}\n`;
}
function cleanupFailure(error) { return error?.message?.startsWith("gosu_cleanup_") ? error : new Error("gosu_cleanup_failed", { cause: error }); }

async function checkedOwnedGosuScratch(scratch, runnerTemp) {
  if (typeof scratch !== "string" || typeof runnerTemp !== "string" || !path.isAbsolute(scratch) || !path.isAbsolute(runnerTemp)) fail("gosu_cleanup_path_invalid");
  const parent = path.resolve(runnerTemp); const target = path.resolve(scratch); const filesystemRoot = path.parse(parent).root;
  if (parent === filesystemRoot || target === parent || path.dirname(target) !== parent || !/^aw-gosu-preparation-[12]$/u.test(path.basename(target))) fail("gosu_cleanup_path_invalid");
  try {
    for (let current = parent; ; current = path.dirname(current)) { const info = await lstat(current); if (info.isSymbolicLink()) fail("gosu_cleanup_path_invalid"); if (path.dirname(current) === current) break; }
    const parentInfo = await lstat(parent); const targetInfo = await lstat(target); const [canonicalParent, canonicalTarget] = await Promise.all([realpath(parent), realpath(target)]);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || !targetInfo.isDirectory() || targetInfo.isSymbolicLink() || canonicalTarget !== path.join(canonicalParent, path.basename(target))) fail("gosu_cleanup_path_invalid");
  } catch (error) { throw cleanupFailure(error); }
  return target;
}

export async function removeOwnedGosuScratch(scratch, runnerTemp) {
  const target = await checkedOwnedGosuScratch(scratch, runnerTemp); let entries = 0;
  async function removeDirectory(entry) { for (let attempt = 0; ; attempt += 1) { try { await rmdir(entry); return; } catch (error) { if (attempt >= 3 || !["ENOTEMPTY", "EPERM"].includes(error.code)) throw error; await delay(20 * (attempt + 1)); } } }
  async function removeEntry(entry, depth) {
    const relative = path.relative(target, entry); const pathBytes = Buffer.byteLength(relative);
    if (depth > GOSU_CLEANUP_LIMITS_V1.depth || pathBytes > GOSU_CLEANUP_LIMITS_V1.pathBytes || entries > GOSU_CLEANUP_LIMITS_V1.entries) fail("gosu_cleanup_limit_exceeded");
    const info = await lstat(entry);
    if (info.isSymbolicLink()) { await unlink(entry); return; }
    if (info.isDirectory()) {
      await chmod(entry, 0o700);
      for await (const child of await opendir(entry)) {
        const { name } = child;
        entries += 1;
        if (entries > GOSU_CLEANUP_LIMITS_V1.entries || name === "." || name === ".." || path.basename(name) !== name) fail("gosu_cleanup_limit_exceeded");
        await removeEntry(path.join(entry, name), depth + 1);
      }
      const finalInfo = await lstat(entry); if (!finalInfo.isDirectory() || finalInfo.isSymbolicLink()) fail("gosu_cleanup_path_invalid");
      await removeDirectory(entry); return;
    }
    if (!info.isFile()) fail("gosu_cleanup_entry_invalid");
    if (info.nlink === 1) await chmod(entry, 0o600);
    await unlink(entry);
  }
  try { await removeEntry(target, 0); } catch (error) { throw cleanupFailure(error); }
}

export async function completeOwnedGosuScratch(primaryError, scratch, runnerTemp) {
  try { await removeOwnedGosuScratch(scratch, runnerTemp); }
  catch (cleanupError) {
    if (primaryError) throw new AggregateError([primaryError, cleanupError], primaryError.message, { cause: cleanupError });
    throw cleanupError;
  }
  if (primaryError) throw primaryError;
}
export function formatGosuPreparationFailure(error) {
  const primary = error instanceof AggregateError ? error.errors[0] : error; const message = primary?.message?.startsWith("gosu_") ? primary.message : "gosu_preparation_failed";
  return `${message}${error instanceof AggregateError ? "\ngosu_cleanup_failed" : ""}\n`;
}
function cleanEnv(base) {
  return {
    HOME: base.home, TMPDIR: base.tmp, PATH: base.path, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
    GOENV: "off", GOTOOLCHAIN: "local", GOWORK: "off", GOFLAGS: "", GOPRIVATE: "", GONOSUMDB: "", GONOPROXY: "",
    GOCACHE: base.gocache, GOMODCACHE: base.gomodcache, GOPATH: base.gopath, CGO_ENABLED: "0", GOOS: "linux", GOARCH: "amd64",
    GOPROXY: base.offline ? "off" : "https://proxy.golang.org", GOSUMDB: base.offline ? "off" : base.sumdb,
    NODE_OPTIONS: "", NODE_PATH: "",
  };
}
export function moduleInfoCacheIdentity(item) { return validateModuleInfoCacheIdentity(item); }
async function loadLock() { const bytes = await readFile(lockFile); const value = JSON.parse(bytes); validateLock(value); return { value, identity: exactIdentity(bytes) }; }
async function loadChildLock(offlineEntered = true, read = readFile) {
  const bytes = await childRead("lock_read", () => read(lockFile), offlineEntered);
  let value;
  try { value = JSON.parse(bytes); } catch (error) { if (offlineEntered) childMainFailure("lock_json_invalid"); throw error; }
  try { validateLock(value); } catch (error) { if (offlineEntered) childMainFailure("lock_contract_invalid"); throw error; }
  return { value, identity: exactIdentity(bytes) };
}
async function openDownload(url, redirects = 0) {
  if (redirects > 3 || !url.startsWith("https://")) fail("gosu_download_url_invalid");
  const response = await new Promise((resolve, reject) => { const request = https.get(url, { headers: { "user-agent": "auto-world-gosu-preparer-v1", accept: "application/octet-stream" } }, resolve); request.setTimeout(120_000, () => request.destroy(new Error("gosu_download_timeout"))); request.on("error", reject); });
  if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) { response.resume(); return openDownload(new URL(response.headers.location, url).href, redirects + 1); }
  if (response.statusCode !== 200) { response.resume(); fail("gosu_download_failed"); }
  return response;
}
async function download(url, target, expected) {
  const partial = `${target}.partial`; let total = 0; const hash = createHash("sha256"); const response = await openDownload(url);
  const output = createWriteStream(partial, { flags: "wx", mode: 0o600 }); response.on("data", (chunk) => { total += chunk.length; if (total > expected.bytes || total > MAX_DOWNLOAD) response.destroy(new Error("gosu_download_size_invalid")); hash.update(chunk); });
  await pipeline(response, output);
  if (total !== expected.bytes || hash.digest("hex") !== expected.sha256) { await rm(partial, { force: true }); fail("gosu_material_identity_invalid"); }
  await rename(partial, target);
}
function commandFailure(stage, reason) { fail(`gosu_command_failed_${stage}_${reason}`); }
function runCommand(stage, command, args, { cwd, env, cap = 8 * 1024 ** 2, timeout = 20 * 60_000 } = {}, runner) {
  if (!COMMAND_STAGE_SET.has(stage)) fail("gosu_command_stage_invalid");
  let result;
  try { result = runner(command, args, { cwd, env, timeout, maxBuffer: cap, encoding: null, windowsHide: true }); }
  catch { commandFailure(stage, "spawn"); }
  if (!result || typeof result !== "object" || Array.isArray(result)) fail("gosu_command_result_invalid");
  let error; let signal; let status; let stdout; let stderr;
  try { ({ error, signal, status, stdout, stderr } = result); } catch { fail("gosu_command_result_invalid"); }
  if (error !== undefined && !(error instanceof Error)) fail("gosu_command_result_invalid");
  if (error) {
    let code;
    try { code = error.code; } catch { commandFailure(stage, "spawn"); }
    commandFailure(stage, code === "ETIMEDOUT" ? "timeout" : code === "ENOBUFS" ? "output_limit" : "spawn");
  }
  if (signal !== null && (typeof signal !== "string" || signal.length === 0)) fail("gosu_command_result_invalid");
  if (status !== null && !Number.isInteger(status)) fail("gosu_command_result_invalid");
  if (signal !== null) commandFailure(stage, "signal");
  if (!Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr)) fail("gosu_command_result_invalid");
  if (status !== 0) {
    if (status === null) fail("gosu_command_result_invalid");
    if (stage === "offline_isolation" && Buffer.isBuffer(stderr) && stderr.length <= MAX_CHILD_FAILURE_LINE_BYTES) {
      const propagated = CHILD_FAILURE_LINES.find(({ line }) => stderr.equals(line));
      if (propagated) fail(propagated.code);
    }
    commandFailure(stage, "exit");
  }
  return { status, stdout, stderr };
}
function run(stage, command, args, options) { return runCommand(stage, command, args, options, spawnSync); }
export const TEST_ONLY = Object.freeze({
  repo, scriptFile,
  runCommand: (stage, command, args, options, runner) => runCommand(stage, command, args, options, runner),
  setupEnvironment, buildOuterIsolationInvocation,
  runOfflineSetup: (environment, adapters, commandArguments = ["offline-setup", environment?.AW_GOSU_REPEAT]) => dispatchOfflineSetup(commandArguments, environment, adapters),
  validateOfflineNetworkObservation,
  formatChildMainFailure, childRead, loadLock: loadChildLock, collectOfflineBoundary, main,
});
function setupScalar(value, pattern, reason) { if (typeof value !== "string" || !pattern.test(value)) isolationFailure(reason); return value; }
function ordinaryId(value, reason) { setupScalar(value, /^(?:[1-9]|[1-9][0-9]{1,9})$/u, reason); const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ORDINARY_ID || String(parsed) !== value) isolationFailure(reason); return value; }
function namespaceValue(value, kind, reason = kind === "net" ? "namespace_net_invalid" : "namespace_mnt_invalid") { return setupScalar(value, new RegExp(`^${kind}:\\[[1-9][0-9]*\\]$`, "u"), reason); }
function ownedSetupPaths(scratch, output, repeat) {
  for (const [value, reason] of [[scratch, "scratch_invalid"], [output, "output_invalid"]]) if (typeof value !== "string" || !value.startsWith("/") || path.posix.normalize(value) !== value || value === "/") isolationFailure(reason);
  const scratchParent = path.posix.dirname(scratch); if (scratchParent === "/" || path.posix.dirname(output) !== scratchParent || path.posix.basename(scratch) !== `aw-gosu-preparation-${repeat}` || path.posix.basename(output) !== `gosu-preparation-${repeat}`) isolationFailure("owned_paths_invalid");
}
function setupEnvironment(configuration) {
  const repeat = setupScalar(configuration?.repeat, /^[12]$/u, "repeat_invalid"); const uid = ordinaryId(configuration?.uid, "uid_invalid"); const gid = ordinaryId(configuration?.gid, "gid_invalid");
  const originalNetns = namespaceValue(configuration?.originalNetns, "net", "original_netns_invalid"); const originalMntns = namespaceValue(configuration?.originalMntns, "mnt", "original_mntns_invalid"); ownedSetupPaths(configuration?.scratch, configuration?.output, repeat);
  const ci = configuration?.ci; if (!ci || typeof ci !== "object" || Array.isArray(ci)) isolationFailure("ci_invalid");
  const runId = setupScalar(ci.runId, /^[1-9][0-9]*$/u, "run_id_invalid"); const runAttempt = setupScalar(ci.runAttempt, /^[1-9][0-9]*$/u, "run_attempt_invalid"); const headSha = setupScalar(ci.headSha, /^[0-9a-f]{40}$/u, "head_sha_invalid"); const job = setupScalar(ci.job, /^build_[12]$/u, "job_invalid");
  return {
    AW_GOSU_ORIGINAL_NETNS: originalNetns, AW_GOSU_ORIGINAL_MNTNS: originalMntns, AW_GOSU_EXPECT_UID: uid,
    AW_GOSU_EXPECT_GID: gid, AW_GOSU_REPEAT: repeat, AW_GOSU_SCRATCH: configuration.scratch,
    AW_GOSU_OUTPUT: configuration.output, AW_GOSU_CI_RUN_ID: runId, AW_GOSU_CI_RUN_ATTEMPT: runAttempt,
    AW_GOSU_CI_HEAD_SHA: headSha, AW_GOSU_CI_JOB: job,
  };
}
function validateSetupEnvironment(environment) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment) || Object.keys(environment).sort().join("\0") !== [...SETUP_ENV_KEYS].sort().join("\0")) isolationFailure("setup_environment_invalid");
  return setupEnvironment({
    repeat: environment.AW_GOSU_REPEAT, scratch: environment.AW_GOSU_SCRATCH, output: environment.AW_GOSU_OUTPUT,
    uid: environment.AW_GOSU_EXPECT_UID, gid: environment.AW_GOSU_EXPECT_GID, originalNetns: environment.AW_GOSU_ORIGINAL_NETNS,
    originalMntns: environment.AW_GOSU_ORIGINAL_MNTNS, ci: { runId: environment.AW_GOSU_CI_RUN_ID, runAttempt: environment.AW_GOSU_CI_RUN_ATTEMPT, headSha: environment.AW_GOSU_CI_HEAD_SHA, job: environment.AW_GOSU_CI_JOB },
  });
}
function buildOuterIsolationInvocation(configuration) {
  const environment = setupEnvironment(configuration); const assignments = Object.entries(environment).map(([key, value]) => `${key}=${value}`);
  return {
    command: "/usr/bin/sudo",
    args: ["-n", "--", "/usr/bin/unshare", "--mount", "--propagation", "private", "--net", "--", "/usr/bin/env", "-i", ...assignments, process.execPath, scriptFile, "offline-setup", environment.AW_GOSU_REPEAT],
    options: { cwd: repo, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 70 * 60_000, cap: 1024 * 1024 },
  };
}
function setupProcess(stage, command, args, options, runner, propagateChild) {
  let result; try { result = runner(command, args, { ...options, encoding: null, windowsHide: true }); } catch { isolationFailure(`${stage}_spawn`); }
  if (!result || typeof result !== "object" || Array.isArray(result)) isolationFailure(`${stage}_result_invalid`);
  let error; let signal; let status; let stdout; let stderr;
  try { ({ error, signal, status, stdout, stderr } = result); } catch { isolationFailure(`${stage}_result_invalid`); }
  if (error !== undefined && !(error instanceof Error)) isolationFailure(`${stage}_result_invalid`);
  if (error) {
    let code; try { code = error.code; } catch { isolationFailure(`${stage}_spawn`); }
    isolationFailure(`${stage}_${code === "ETIMEDOUT" ? "timeout" : code === "ENOBUFS" ? "output_limit" : "spawn"}`);
  }
  if (signal !== null && (typeof signal !== "string" || signal.length === 0)) isolationFailure(`${stage}_result_invalid`);
  if (status !== null && !Number.isInteger(status)) isolationFailure(`${stage}_result_invalid`);
  if (signal !== null) isolationFailure(`${stage}_signal`);
  if (!Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr)) isolationFailure(`${stage}_result_invalid`);
  if (status !== 0) {
    if (status === null) isolationFailure(`${stage}_result_invalid`);
    if (propagateChild && Buffer.isBuffer(stderr) && stderr.length <= MAX_CHILD_FAILURE_LINE_BYTES) { const child = CHILD_FAILURE_LINES.find(({ line }) => stderr.equals(line)); if (child) fail(child.code); }
    isolationFailure(`${stage}_exit`);
  }
}
async function copyLockedMaterials(lock, materials) {
  const descriptors = [
    [lock.source.url, lock.source.file, { bytes: lock.source.bytes, sha256: lock.source.sha256 }],
    [lock.compiler.url, lock.compiler.file, { bytes: lock.compiler.bytes, sha256: lock.compiler.sha256 }],
    [lock.goSource.url, lock.goSource.file, { bytes: lock.goSource.bytes, sha256: lock.goSource.sha256 }],
    ...lock.modules.flatMap((item) => [[`${item.proxyBase}.zip`, item.zip.file, item.zip], [`${item.proxyBase}.mod`, item.mod.file, item.mod], [`${item.proxyBase}.info`, item.info.file, item.info]]),
  ];
  for (const [url, name, expected] of descriptors) await download(url, path.join(materials, name), expected);
}
async function extractTar(file, expected, limits, rootName, target, extra = {}) {
  const prefix = `${rootName}/`; const selected = new Map();
  const options = extra.symlink ? { ...extra, symlink: { ...extra.symlink, path: `${rootName}/${extra.symlink.path}` } } : extra;
  const result = await scanGzipTar(file, expected, limits, { ...options, onFile: async (entry, bytes) => {
    if (entry.path === rootName) return; if (!entry.path.startsWith(prefix)) fail("gosu_archive_root_invalid");
    const relative = entry.path.slice(prefix.length); if (!relative) return; await materializeArchiveFile(target, relative, bytes, entry.mode); if (extra.selectedPaths?.has(relative)) selected.set(relative, { identity: exactIdentity(bytes), bytes });
  } }); return { ...result, selected };
}
function assertSelected(selected, relative, expected) { const value = selected.get(relative); if (!value) fail("gosu_selected_file_missing"); assertIdentity(value.bytes, expected, "gosu_selected_file_invalid"); return value.bytes; }
async function buildOnline(repeat, lock, scratch, output) {
  const materials = path.join(output, "materials"); const licenses = path.join(output, "licenses"); const source = path.join(scratch, "source"); const compiler = path.join(scratch, "compiler");
  await Promise.all([mkdir(materials), mkdir(licenses), mkdir(source), mkdir(compiler), mkdir(path.join(scratch, "home")), mkdir(path.join(scratch, "tmp")), mkdir(path.join(scratch, "gocache")), mkdir(path.join(scratch, "gomodcache")), mkdir(path.join(scratch, "gopath"))]);
  await copyLockedMaterials(lock, materials);
  const gosu = await extractTar(path.join(materials, lock.source.file), { bytes: lock.source.bytes, sha256: lock.source.sha256 }, GOSU_ARCHIVE_LIMITS_V1.gosu, lock.source.root, source, { symlink: lock.source.symlink, selectedPaths: new Set(["go.mod", "go.sum", "LICENSE", ".gitignore"]) });
  if (gosu.entries.length !== lock.source.observedArchive.entries || gosu.regularBytes !== lock.source.observedArchive.regularBytes) fail("gosu_source_archive_measurement_invalid");
  const compilerScan = await extractTar(path.join(materials, lock.compiler.file), { bytes: lock.compiler.bytes, sha256: lock.compiler.sha256 }, GOSU_ARCHIVE_LIMITS_V1.go, "go", compiler, { selectedPaths: new Set() });
  if (compilerScan.entries.length !== lock.compiler.observedArchive.entries || compilerScan.regularBytes !== lock.compiler.observedArchive.regularBytes) fail("gosu_compiler_archive_measurement_invalid");
  const sourceScan = await scanGzipTar(path.join(materials, lock.goSource.file), { bytes: lock.goSource.bytes, sha256: lock.goSource.sha256 }, GOSU_ARCHIVE_LIMITS_V1.go, { onFile: async (entry, bytes) => {
    if (entry.path === "go/LICENSE") await writeFile(path.join(licenses, "go-LICENSE"), bytes, { flag: "wx" }); if (entry.path === "go/PATENTS") await writeFile(path.join(licenses, "go-PATENTS"), bytes, { flag: "wx" });
  } });
  if (sourceScan.entries.length !== lock.goSource.observedArchive.entries || sourceScan.regularBytes !== lock.goSource.observedArchive.regularBytes) fail("gosu_source_archive_measurement_invalid");
  const goMod = assertSelected(gosu.selected, "go.mod", lock.source.goMod); const goSum = assertSelected(gosu.selected, "go.sum", lock.source.goSum); const gosuLicense = assertSelected(gosu.selected, "LICENSE", lock.source.license); const gitignore = gosu.selected.get(".gitignore")?.bytes; assertIdentity(gitignore, { bytes: lock.source.symlink.targetBytes, sha256: lock.source.symlink.targetSha256 }, "gosu_symlink_target_invalid");
  await Promise.all([writeFile(path.join(materials, "gosu.go.mod"), goMod, { flag: "wx" }), writeFile(path.join(materials, "gosu.go.sum"), goSum, { flag: "wx" }), writeFile(path.join(licenses, "gosu-LICENSE"), gosuLicense, { flag: "wx" })]);
  assertIdentity(await readFile(path.join(licenses, "go-LICENSE")), lock.goSource.license, "gosu_go_license_invalid"); assertIdentity(await readFile(path.join(licenses, "go-PATENTS")), lock.goSource.patents, "gosu_go_patents_invalid");
  for (const item of lock.modules) {
    const selected = new Map(); const moduleScan = await scanModuleZip(path.join(materials, item.zip.file), item.zip, GOSU_ARCHIVE_LIMITS_V1.module, { onFile: async (entry, bytes) => { selected.set(entry.path, bytes); } }); if (moduleScan.entries.length !== item.zip.observedArchive.entries || moduleScan.regularBytes !== item.zip.observedArchive.regularBytes) fail("gosu_module_archive_measurement_invalid");
    const prefix = `${item.path}@${item.version}/`; const license = selected.get(`${prefix}${item.license.path}`); assertIdentity(license, item.license, "gosu_module_license_invalid"); await writeFile(path.join(licenses, `${item.id}-LICENSE`), license, { flag: "wx" });
    if (item.patents) { const patents = selected.get(`${prefix}${item.patents.path}`); assertIdentity(patents, item.patents, "gosu_module_patents_invalid"); await writeFile(path.join(licenses, `${item.id}-PATENTS`), patents, { flag: "wx" }); }
  }
  const go = path.join(compiler, "bin", "go"); const base = { home: path.join(scratch, "home"), tmp: path.join(scratch, "tmp"), path: `${path.join(compiler, "bin")}:/usr/local/bin:/usr/bin:/bin`, gocache: path.join(scratch, "gocache"), gomodcache: path.join(scratch, "gomodcache"), gopath: path.join(scratch, "gopath"), sumdb: lock.sumdb, offline: false };
  const env = cleanEnv(base); const version = run("online_go_version", go, ["version"], { cwd: source, env }).stdout.toString().trim(); if (version !== lock.compiler.identity) fail("gosu_compiler_identity_invalid");
  const before = await Promise.all([fileIdentity(path.join(source, "go.mod")), fileIdentity(path.join(source, "go.sum"))]); const downloaded = run("online_mod_download", go, ["mod", "download", "-json", "all"], { cwd: source, env }).stdout.toString(); run("online_mod_verify", go, ["mod", "verify"], { cwd: source, env }); const after = await Promise.all([fileIdentity(path.join(source, "go.mod")), fileIdentity(path.join(source, "go.sum"))]); if (JSON.stringify(before) !== JSON.stringify(after)) fail("gosu_source_mutated");
  const modules = downloaded.trim().split(/\n(?=\{)/u).filter(Boolean).map((item) => JSON.parse(item)); if (modules.length !== 2) fail("gosu_module_closure_invalid");
  for (const expected of lock.modules) { const actual = modules.find((item) => item.Path === expected.path); if (!actual || actual.Version !== expected.version || actual.Sum !== expected.zip.h1 || actual.GoModSum !== expected.mod.h1) fail("gosu_module_closure_invalid"); for (const [key, descriptor] of [["Zip", expected.zip], ["GoMod", expected.mod], ["Info", moduleInfoCacheIdentity(expected)]]) assertIdentity(await readFile(actual[key]), descriptor, "gosu_module_cache_invalid"); }
  await writeFile(path.join(scratch, "online.json"), canonicalJson({ repeat, sourceFiles: after, compilerEntries: compilerScan.entries.length, compilerRegularBytes: compilerScan.regularBytes, sourceEntries: sourceScan.entries.length, sourceRegularBytes: sourceScan.regularBytes }), { flag: "wx" });
  return { source, compiler, go, base };
}
export async function readNetworkNamespaceIdentity() { const value = await readlink("/proc/self/ns/net"); return namespaceValue(value, "net"); }
export async function readMountNamespaceIdentity() { const value = await readlink("/proc/self/ns/mnt"); return namespaceValue(value, "mnt"); }
export async function assertNetworkNamespaceChanged(original) { const current = await readNetworkNamespaceIdentity(); if (!/^net:\[[1-9][0-9]*\]$/u.test(original ?? "") || current === original) isolationFailure("namespace_changed_invalid"); return current; }
export function namespaceTransitionIdentity(original, current) { if (!/^net:\[[1-9][0-9]*\]$/u.test(original ?? "") || !/^net:\[[1-9][0-9]*\]$/u.test(current ?? "") || original === current) isolationFailure("namespace_transition_invalid"); const originalBytes = Buffer.from(original); const currentBytes = Buffer.from(current); const transition = Buffer.alloc(8 + originalBytes.length + currentBytes.length); transition.writeUInt32BE(originalBytes.length, 0); originalBytes.copy(transition, 4); transition.writeUInt32BE(currentBytes.length, 4 + originalBytes.length); currentBytes.copy(transition, 8 + originalBytes.length); return exactIdentity(transition); }
function validateOfflineNetworkObservation(observation) {
  if (observation.platform !== "linux" || observation.euid === 0 || observation.nodeOptions || observation.nodePath || observation.goenv !== "off" || observation.gotoolchain !== "local" || observation.gowork !== "off" || observation.goproxy !== "off" || observation.gosumdb !== "off" || observation.goflags) fail("gosu_offline_environment_invalid");
  const expectedUid = Number(ordinaryId(observation.expectedUid, "uid_invalid")); const expectedGid = Number(ordinaryId(observation.expectedGid, "gid_invalid"));
  if (observation.euid !== expectedUid || observation.egid !== expectedGid || !Array.isArray(observation.groups) || observation.groups.length < 1 || observation.groups.some((group) => group !== expectedGid)) fail("gosu_offline_identity_invalid");
  namespaceValue(observation.originalNetns, "net"); namespaceValue(observation.netns, "net"); namespaceValue(observation.originalMntns, "mnt"); namespaceValue(observation.mntns, "mnt");
  if (observation.netns === observation.originalNetns) isolationFailure("boundary_netns_reused");
  if (observation.mntns === observation.originalMntns) isolationFailure("boundary_mntns_reused");
  if (typeof observation.status !== "string" || typeof observation.routes !== "string" || typeof observation.loopbackFlags !== "string") isolationFailure("boundary_observation_invalid");
  const caps = Object.fromEntries(observation.status.split("\n").map((line) => line.split(":")).filter((item) => item.length === 2).map(([key, value]) => [key, value.trim()]));
  if (caps.CapEff !== "0000000000000000" || caps.CapBnd !== "0000000000000000" || caps.CapAmb !== "0000000000000000" || caps.NoNewPrivs !== "1") fail("gosu_offline_privilege_invalid");
  if (!Array.isArray(observation.interfaces) || observation.interfaces.length !== 1 || observation.interfaces[0] !== "lo") isolationFailure("boundary_interfaces_invalid");
  if (observation.routes.trim().split("\n").length !== 1) isolationFailure("boundary_routes_present");
  if (!/^0x(?:0|[1-9a-f][0-9a-f]{0,7})\n$/u.test(observation.loopbackFlags)) isolationFailure("boundary_flags_invalid");
  const flags = Number.parseInt(observation.loopbackFlags.slice(2, -1), 16);
  if (!Number.isSafeInteger(flags)) isolationFailure("boundary_flags_number_invalid");
  if ((flags & 0x8) !== 0x8) isolationFailure("boundary_loopback_missing");
  if ((flags & 0x1) !== 0) isolationFailure("boundary_loopback_up");
  const raw = { status: Buffer.from(observation.status), routes: Buffer.from(observation.routes), loopbackFlags: Buffer.from(observation.loopbackFlags) }; const namespaceTransition = namespaceTransitionIdentity(observation.originalNetns, observation.netns);
  if (namespaceTransition.bytes < 22 || namespaceTransition.bytes > 136 || raw.status.length < 1 || raw.status.length > 64 * 1024 || raw.routes.length > 1024 * 1024 || raw.loopbackFlags.length < 1 || raw.loopbackFlags.length > 64) fail("gosu_offline_evidence_invalid");
  return { checks: { namespaceChanged: true, loopbackDown: true, routesEmpty: true, ordinaryIdentity: true, zeroCapabilities: true, noNewPrivileges: true }, evidence: { namespaceTransition, ...Object.fromEntries(Object.entries(raw).map(([key, bytes]) => [key, exactIdentity(bytes)])) } };
}
async function collectOfflineBoundary(adapters = { readlink, readFile, readdir }, offlineEntered = offlineMainEntered) {
  const [netns, mntns, status, routes, interfaces, loopbackFlags] = await Promise.all([
    childRead("boundary_netns_read", () => adapters.readlink("/proc/self/ns/net"), offlineEntered).then((value) => namespaceValue(value, "net")),
    childRead("boundary_mntns_read", () => adapters.readlink("/proc/self/ns/mnt"), offlineEntered).then((value) => namespaceValue(value, "mnt")),
    childRead("boundary_status_read", () => adapters.readFile("/proc/self/status", "utf8"), offlineEntered),
    childRead("boundary_routes_read", () => adapters.readFile("/proc/net/route", "utf8"), offlineEntered),
    childRead("boundary_interfaces_read", () => adapters.readdir("/sys/class/net"), offlineEntered),
    childRead("boundary_loopback_flags_read", () => adapters.readFile("/sys/class/net/lo/flags", "utf8"), offlineEntered),
  ]);
  return { netns, mntns, status, routes, interfaces, loopbackFlags };
}
export async function assertOfflineBoundary() {
  const { netns, mntns, status, routes, interfaces, loopbackFlags } = await collectOfflineBoundary();
  return validateOfflineNetworkObservation({
    platform: process.platform, euid: process.geteuid?.(), egid: process.getegid?.(), groups: process.getgroups?.(), expectedUid: process.env.AW_GOSU_EXPECT_UID, expectedGid: process.env.AW_GOSU_EXPECT_GID,
    originalNetns: process.env.AW_GOSU_ORIGINAL_NETNS, netns, originalMntns: process.env.AW_GOSU_ORIGINAL_MNTNS, mntns,
    nodeOptions: process.env.NODE_OPTIONS, nodePath: process.env.NODE_PATH, goenv: process.env.GOENV, gotoolchain: process.env.GOTOOLCHAIN, gowork: process.env.GOWORK, goproxy: process.env.GOPROXY, gosumdb: process.env.GOSUMDB, goflags: process.env.GOFLAGS,
    status, routes, interfaces, loopbackFlags,
  });
}
async function runOfflineSetupWith(environmentInput, adapters) {
  const environment = validateSetupEnvironment(environmentInput);
  if (adapters?.platform !== "linux") isolationFailure("setup_platform_invalid");
  if (adapters.geteuid?.() !== 0) isolationFailure("setup_root_invalid");
  let netns; let mntns; let sys;
  try { [netns, mntns, sys] = await Promise.all([adapters.readlink("/proc/self/ns/net"), adapters.readlink("/proc/self/ns/mnt"), adapters.lstat("/sys")]); } catch { isolationFailure("setup_read_failed"); }
  namespaceValue(netns, "net"); namespaceValue(mntns, "mnt");
  if (netns === environment.AW_GOSU_ORIGINAL_NETNS) isolationFailure("setup_netns_reused");
  if (mntns === environment.AW_GOSU_ORIGINAL_MNTNS) isolationFailure("setup_mntns_reused");
  if (!sys.isDirectory()) isolationFailure("setup_sysfs_not_directory");
  if (sys.isSymbolicLink()) isolationFailure("setup_sysfs_symlink");
  const commandOptions = { cwd: "/", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 60_000, maxBuffer: 1024 * 1024 };
  setupProcess("setup_mount", "/usr/bin/mount", ["--internal-only", "--no-canonicalize", "--types", "sysfs", "--options", "ro,nosuid,nodev,noexec", "--source", "sysfs", "--target", "/sys"], commandOptions, adapters.runner, false);
  const scratch = environment.AW_GOSU_SCRATCH; const compiler = path.posix.join(scratch, "compiler"); const offline = cleanEnv({ home: path.posix.join(scratch, "home"), tmp: path.posix.join(scratch, "tmp"), path: `${path.posix.join(compiler, "bin")}:/usr/local/bin:/usr/bin:/bin`, gocache: path.posix.join(scratch, "gocache"), gomodcache: path.posix.join(scratch, "gomodcache"), gopath: path.posix.join(scratch, "gopath"), offline: true });
  for (const key of SETUP_ENV_KEYS) offline[key] = environment[key];
  const setpriv = [`--reuid=${environment.AW_GOSU_EXPECT_UID}`, `--regid=${environment.AW_GOSU_EXPECT_GID}`, "--clear-groups", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--", "/usr/bin/env", "-i", ...Object.entries(offline).map(([key, value]) => `${key}=${value}`), process.execPath, scriptFile, "offline", environment.AW_GOSU_REPEAT];
  setupProcess("setup_setpriv", "/usr/bin/setpriv", setpriv, { ...commandOptions, timeout: 70 * 60_000 }, adapters.runner, true);
}
async function dispatchOfflineSetup(commandArguments, environment, adapters) {
  if (!Array.isArray(commandArguments) || commandArguments.length !== 2 || commandArguments[0] !== "offline-setup" || !/^[12]$/u.test(commandArguments[1]) || commandArguments[1] !== environment?.AW_GOSU_REPEAT) isolationFailure("setup_arguments_invalid");
  return runOfflineSetupWith(environment, adapters);
}
async function runOfflineSetup(commandArguments, environment) {
  return dispatchOfflineSetup(commandArguments, environment, { platform: process.platform, geteuid: () => process.geteuid?.(), readlink, lstat, runner: spawnSync });
}
async function offlinePhase(repeat, lock, lockIdentity, scratch, output, source, compiler, base) {
  const cutoff = await assertOfflineBoundary(); const go = path.join(compiler, "bin", "go"); const env = cleanEnv({ ...base, offline: true }); const binary = path.join(output, "gosu");
  const testsRaw = run("offline_go_test", go, ["test", ...lock.build.testFlags], { cwd: source, env, cap: 16 * 1024 ** 2, timeout: 30 * 60_000 }).stdout.toString(); const tests = parseUpstreamTestJson(testsRaw); await writeFile(path.join(output, "upstream-tests.json"), canonicalJson(tests), { flag: "wx" });
  run("offline_go_build", go, ["build", ...lock.build.flags, "-o", binary, lock.build.package], { cwd: source, env, timeout: 30 * 60_000 }); await chmod(binary, 0o755);
  const online = JSON.parse(await readFile(path.join(scratch, "online.json"), "utf8")); const sourceFiles = await Promise.all([fileIdentity(path.join(source, "go.mod")), fileIdentity(path.join(source, "go.sum"))]); if (JSON.stringify(sourceFiles) !== JSON.stringify(online.sourceFiles)) fail("gosu_source_mutated");
  const version = run("offline_gosu_version", binary, ["--version"], { cwd: source, env }).stdout.toString().trim(); if (version !== "1.19 (go1.26.9 on linux/amd64; gc)") fail("gosu_version_invalid"); await writeFile(path.join(output, "version.txt"), `${version}\n`, { flag: "wx" });
  const buildInfoText = run("offline_go_build_info", go, ["version", "-m", "./gosu"], { cwd: output, env }).stdout.toString(); parseGosuBuildInfo(buildInfoText, lock); await writeFile(path.join(output, "build-info.txt"), buildInfoText, { flag: "wx" });
  await writeFile(path.join(output, "module-closure.json"), canonicalJson(moduleClosure(lock)), { flag: "wx" });
  const binaryIdentity = await fileIdentity(binary); await writeFile(path.join(output, "sbom.cdx.json"), canonicalJson(canonicalSbom(lock, binaryIdentity)), { flag: "wx" });
  await writeFile(path.join(output, "network-cutoff.json"), canonicalJson({ kind: "GOSU_NETWORK_CUTOFF_V1", checks: cutoff.checks, evidence: cutoff.evidence }), { flag: "wx" });
  await writeFile(path.join(output, "licenses/notices.json"), canonicalJson(canonicalNotices()), { flag: "wx" });
  const sumdbRoot = path.join(scratch, "gomodcache", "cache", "download", "sumdb"); const sumdbEntries = [];
  async function collectSumdb(directory, prefix = "") { const entries = await import("node:fs/promises").then((fs) => fs.readdir(directory, { withFileTypes: true })); for (const entry of entries) { const relative = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.isSymbolicLink()) fail("gosu_sumdb_invalid"); if (entry.isDirectory()) await collectSumdb(path.join(directory, entry.name), relative); else if (entry.isFile()) sumdbEntries.push({ path: relative, type: "file", bytes: await readFile(path.join(directory, entry.name)) }); else fail("gosu_sumdb_invalid"); } }
  await collectSumdb(sumdbRoot); const sumdbBytes = sumdbEntries.reduce((total, entry) => total + entry.bytes.length, 0); if (!sumdbEntries.length || sumdbEntries.length > GOSU_ARCHIVE_LIMITS_V1.sumdb.members || sumdbBytes > GOSU_ARCHIVE_LIMITS_V1.sumdb.totalBytes || sumdbEntries.some((entry) => entry.bytes.length > GOSU_ARCHIVE_LIMITS_V1.sumdb.memberBytes || entry.path.split("/").length > GOSU_ARCHIVE_LIMITS_V1.sumdb.depth || Buffer.byteLength(entry.path) > GOSU_ARCHIVE_LIMITS_V1.sumdb.pathBytes)) fail("gosu_sumdb_invalid"); await writeDeterministicUstar(sumdbEntries, path.join(output, "sumdb-proofs.tar"), GOSU_ARCHIVE_LIMITS_V1.sumdb);
  const fileNames = GOSU_PUBLIC_FILES_V1.filter((item) => !["build-receipt.json", "controls.json"].includes(item)); const files = Object.fromEntries(await Promise.all(fileNames.map(async (name) => [name, await fileIdentity(path.join(output, name))])));
  const reviewed = await reviewedIdentities(); if (JSON.stringify(reviewed.lock) !== JSON.stringify(lockIdentity)) fail("gosu_lock_identity_invalid"); const ci = { runId: process.env.AW_GOSU_CI_RUN_ID, runAttempt: process.env.AW_GOSU_CI_RUN_ATTEMPT, headSha: process.env.AW_GOSU_CI_HEAD_SHA, job: process.env.AW_GOSU_CI_JOB };
  const receipt = { kind: "POSTGRES_GOSU_DERIVATIVE_BUILD_RECEIPT_V1", state: "PREPARATION_ONLY", authority: "NOT_AUTHORIZED", supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null, repeat, component: lock.component, lock: lockIdentity, ci, source: { commit: lock.source.commit, archive: { bytes: lock.source.bytes, sha256: lock.source.sha256 }, vcsStamping: "DISABLED" }, compiler: { version: lock.compiler.identity, archive: { bytes: lock.compiler.bytes, sha256: lock.compiler.sha256 } }, node: { version: process.version, executable: reviewed.node }, helper: reviewed.helper, environment: { nodeOptionsEmpty: true, nodePathEmpty: true, goEnvOff: true, goToolchainLocal: true, goWorkOff: true, goFlagsEmpty: true }, networkCutoff: cutoff, build: { package: lock.build.package, flags: lock.build.flags, goos: lock.build.goos, goarch: lock.build.goarch, cgoEnabled: lock.build.cgoEnabled, mainVersion: "(devel)", vcs: false }, tests: { count: tests.run, passed: tests.passed, skipped: tests.skipped, failed: tests.failed, packagesPassed: tests.packagesPassed, packagesSkipped: tests.packagesSkipped, functionalValidation: tests.functionalValidation }, binary: binaryIdentity, files, claims: { preparation: "REPRODUCIBLE_SOURCE_PREPARATION_ONLY", candidateAdmission: "NOT_AUTHORIZED", vulnerabilityClearance: "NOT_ESTABLISHED", functionalValidation: tests.functionalValidation, actualTestCount: tests.run } };
  validateBuildReceipt(receipt, lock, reviewed); const receiptBytes = Buffer.from(canonicalJson(receipt)); await writeFile(path.join(output, "build-receipt.json"), receiptBytes, { flag: "wx" }); const controls = { kind: "POSTGRES_GOSU_DERIVATIVE_CONTROLS_V1", state: "PREPARATION_ONLY", authority: "NOT_AUTHORIZED", supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null, valid: true, receipt: exactIdentity(receiptBytes), files }; await writeFile(path.join(output, "controls.json"), canonicalJson(controls), { flag: "wx" }); return receipt;
}
async function main(adapters = { loadLock: loadChildLock, offlinePhase }) {
  const [command, repeatText] = process.argv.slice(2); offlineMainEntered = command === "offline";
  if (process.version !== "v22.23.2" || process.env.NODE_OPTIONS || process.env.NODE_PATH) { if (offlineMainEntered) childMainFailure("runtime_invalid"); fail("gosu_node_runtime_invalid"); }
  if (command === "offline-setup") { await runOfflineSetup(process.argv.slice(2), process.env); return; }
  const repeat = Number(repeatText);
  if (command === "offline") { const { value: lock } = await adapters.loadLock(true); const scratch = process.env.AW_GOSU_SCRATCH; const output = process.env.AW_GOSU_OUTPUT; if (![1, 2].includes(repeat) || !scratch || !output) childMainFailure("arguments_invalid"); const compiler = path.join(scratch, "compiler"); const base = { home: path.join(scratch, "home"), tmp: path.join(scratch, "tmp"), path: `${path.join(compiler, "bin")}:/usr/local/bin:/usr/bin:/bin`, gocache: path.join(scratch, "gocache"), gomodcache: path.join(scratch, "gomodcache"), gopath: path.join(scratch, "gopath"), sumdb: lock.sumdb }; await adapters.offlinePhase(repeat, lock, (await adapters.loadLock(true)).identity, scratch, output, path.join(scratch, "source"), compiler, base); return; }
  const { value: lock } = await loadLock();
  if (command !== "prepare" || ![1, 2].includes(repeat) || process.platform !== "linux" || !process.env.RUNNER_TEMP) fail("gosu_arguments_invalid");
  const scratch = await assertInitiallyAbsentOwnedChild(process.env.RUNNER_TEMP, `aw-gosu-preparation-${repeat}`); const output = await assertInitiallyAbsentOwnedChild(process.env.RUNNER_TEMP, `gosu-preparation-${repeat}`); await mkdir(scratch, { mode: 0o700 }); let primaryError;
  try { await mkdir(output, { mode: 0o700 }); await buildOnline(repeat, lock, scratch, output); const uid = process.getuid(); const gid = process.getgid(); if (uid === 0) fail("gosu_runner_identity_invalid"); const [originalNetns, originalMntns] = await Promise.all([readNetworkNamespaceIdentity(), readMountNamespaceIdentity()]); const invocation = buildOuterIsolationInvocation({ repeat: String(repeat), scratch, output, uid: String(uid), gid: String(gid), originalNetns, originalMntns, ci: { runId: process.env.AW_GOSU_CI_RUN_ID ?? "", runAttempt: process.env.AW_GOSU_CI_RUN_ATTEMPT ?? "", headSha: process.env.AW_GOSU_CI_HEAD_SHA ?? "", job: process.env.AW_GOSU_CI_JOB ?? "" } }); run("offline_isolation", invocation.command, invocation.args, invocation.options); const receipt = JSON.parse(await readFile(path.join(output, "build-receipt.json"), "utf8")); await validatePublicTree(output, receipt, lock, await reviewedIdentities()); const entries = await Promise.all(GOSU_PUBLIC_FILES_V1.map(async (name) => ({ path: name, type: "file", bytes: await readFile(path.join(output, name)) }))); const tar = path.join(process.env.RUNNER_TEMP, `gosu-preparation-${repeat}.tar`); const identity = await writeDeterministicUstar(entries, tar); await scanPreparationTar(tar, identity, new Set(GOSU_PUBLIC_FILES_V1)); if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tar_sha256=${identity.sha256}\ntar_bytes=${identity.bytes}\n`); process.stdout.write(canonicalJson({ repeat, ...identity })); }
  catch (error) { primaryError = error; }
  await completeOwnedGosuScratch(primaryError, scratch, process.env.RUNNER_TEMP);
}
let offlineMainEntered = false;
if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptFile)) main().catch((error) => { if (offlineMainEntered) process.stderr.write(formatChildMainFailure(error, true)); else process.stderr.write(formatGosuPreparationFailure(error)); process.exitCode = 1; });
