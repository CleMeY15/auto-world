import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync,
  realpathSync, rmSync, statfsSync, utimesSync, writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LOCK_PATH = path.join(ROOT, "infra/scanner/owned-scanner-lock.json");
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const SAFE_NAME = /^aw-owned-scanner-[a-z0-9-]{8,96}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const RECEIPT_KIND = "auto-world-trivy-0.76.1-jose4.1.6-r1";
const LOCK_CANONICAL_SHA256 = "d8a119d9b7ea820ee54331082a7bc58847d5107a7f730bd73350455ab9ec2bb3";
const BUILD_FLAGS = [
  "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid= -extldflags=-static -X github.com/aquasecurity/trivy/pkg/version/app.ver=0.76.1"
];
const TRIVY_SOURCE_SYMLINKS = Object.freeze(new Map([
  ["pkg/fanal/analyzer/language/golang/binary/testdata/symlink", Object.freeze({ target: "foo", gitBlobSha1: "19102815663d23f8b75a47e7a01965dcdc96468c" })],
  ["pkg/fanal/analyzer/language/rust/binary/testdata/symlink", Object.freeze({ target: "foo", gitBlobSha1: "19102815663d23f8b75a47e7a01965dcdc96468c" })],
  ["pkg/fanal/walker/testdata/fs/sym.txt", Object.freeze({ target: "bar", gitBlobSha1: "ba0e162e1c47469e3fe4b393a8bf8c569f302116" })],
]));
const fail = (code) => { throw new Error(code); };

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") fail("scanner_owned_json_invalid");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fileIdentity(file, cap, { allowEmpty = false } = {}) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > cap || (!allowEmpty && info.size < 1)) fail("scanner_owned_file_invalid");
  const bytes = readFileSync(file);
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

function assertIdentity(file, expected, cap, options) {
  const actual = fileIdentity(file, cap, options);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail("scanner_owned_material_changed");
  return actual;
}

export function validateOwnedScannerLock(lock) {
  if (!exactKeys(lock, ["schemaVersion", "state", "receiptKind", "scanner", "patch", "notice", "goJose", "compiler", "build", "fixtures", "limits"]) ||
      lock.schemaVersion !== 1 || lock.state !== "BUILD_DIAGNOSTIC_NOT_QUALIFIED" || lock.receiptKind !== RECEIPT_KIND ||
      lock.scanner?.sourceCommit !== "e713f67f7d54decdcd9b3132c9751833dcced698" || lock.scanner?.sourceTree !== "2b2e1ef32745d09fbd85b9d040da722333dd4258" ||
      lock.scanner?.cliVersion !== "0.76.1" || lock.scanner?.commandPath !== "github.com/aquasecurity/trivy/cmd/trivy" ||
      lock.patch?.changedPaths?.join("\0") !== "go.mod\0go.sum" || lock.patch?.substitutions !== 3 ||
      lock.goJose?.version !== "v4.1.6" || lock.goJose?.commit !== "a0111f82742fa92bceec9ede40845e73319e6230" ||
      lock.compiler?.version !== "go1.27.3" || lock.compiler?.builder?.platformDigest !== "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747" ||
      lock.compiler?.archive?.sha256 !== "65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40" ||
      lock.build?.outputPath !== "/out/trivy" || JSON.stringify(lock.build?.flags) !== JSON.stringify(BUILD_FLAGS) ||
      !Array.isArray(lock.fixtures?.rust) || lock.fixtures.rust.length !== 2 || sha256(Buffer.from(canonicalJson(lock))) !== LOCK_CANONICAL_SHA256) fail("scanner_owned_lock_invalid");
  for (const identity of [lock.scanner.original.goMod, lock.scanner.original.goSum, lock.scanner.patched.goMod, lock.scanner.patched.goSum,
    lock.patch, lock.notice, lock.goJose.goMod, lock.goJose.goSum, lock.compiler.archive, lock.fixtures.rpm, lock.fixtures.git, ...lock.fixtures.rust]) {
    if (!Number.isSafeInteger(identity?.bytes) || identity.bytes < 0 || !HASH.test(identity?.sha256 ?? "")) fail("scanner_owned_lock_invalid");
  }
  return Object.freeze(lock);
}

export function validateOwnedOutput(output, runnerTemp) {
  if (typeof output !== "string" || !path.isAbsolute(output) || path.resolve(output) !== output || typeof runnerTemp !== "string" || !path.isAbsolute(runnerTemp)) fail("scanner_owned_output_invalid");
  const parent = path.resolve(runnerTemp);
  if (output === parent || !output.startsWith(`${parent}${path.sep}`) || path.relative(parent, output).split(path.sep).length > 3) fail("scanner_owned_output_invalid");
  return output;
}

function run(command, args, { cwd, env, timeoutMs, maxBytes, logFile, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd, env, timeout: timeoutMs, maxBuffer: maxBytes, encoding: null, windowsHide: true });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  if (stdout.length > maxBytes || stderr.length > maxBytes) fail("scanner_owned_child_output_exceeded");
  if (logFile) writeFileSync(logFile, Buffer.concat([stdout, stderr]), { flag: "wx", mode: 0o600 });
  if (!allowFailure && (result.error || result.signal || result.status !== 0)) {
    const error = new Error(`scanner_owned_command_failed:${path.basename(command)}:${result.status ?? result.signal ?? "error"}`);
    error.cause = result.error;
    throw error;
  }
  return { status: result.status, signal: result.signal, stdout, stderr };
}

function mount(source, target, readOnly = false) {
  if (!path.isAbsolute(source) || !target.startsWith("/")) fail("scanner_owned_mount_invalid");
  return `${source}:${target}${readOnly ? ":ro" : ""}`;
}

export function ownedContainerCreateArguments(runArgs, { name, owner }) {
  if (!Array.isArray(runArgs) || runArgs[0] !== "run" || runArgs[1] !== "--rm" ||
      !/^aw-owned-scanner-\d+-\d+-(?:upstream|managed)-c\d+$/u.test(name ?? "") || !/^[a-z0-9-]{8,160}$/u.test(owner ?? "")) fail("scanner_owned_container_identity_invalid");
  if (runArgs.includes("none") && runArgs.includes("--network") && !runArgs.includes("--pull=never")) fail("scanner_owned_offline_pull_policy_invalid");
  return ["create", "--name", name, "--label", `com.autoworld.owned-scanner=${owner}`, ...runArgs.slice(2)];
}

function dockerObjectAbsent(result, target) {
  if (result.status !== 1) return false;
  let message;
  try { message = new TextDecoder("utf-8", { fatal: true }).decode(result.stderr).trim(); } catch { return false; }
  return message === `Error: No such object: ${target}` || message === `Error response from daemon: No such container: ${target}` ||
    message === `Error response from daemon: No such object: ${target}`;
}

export function createOwnedContainerRunner({ runValue, scope, budget = { commandTimeoutMs: (value) => value, cleanupCommandTimeoutMs: (value) => value }, dockerEnv = process.env, executeCommand = run }) {
  let counter = 0;
  const live = new Map();
  const owner = `${runValue.runId}-${runValue.runAttempt}-${runValue.sourceSha}`;
  if (typeof budget.commandTimeoutMs !== "function" || typeof budget.cleanupCommandTimeoutMs !== "function") fail("scanner_owned_time_budget_refused");
  const invoke = (args, options) => executeCommand("/usr/bin/docker", args, { ...options, timeoutMs: budget.commandTimeoutMs(options.timeoutMs), env: dockerEnv });
  const cleanupInvoke = (args, options) => {
    let budgetError; let timeoutMs;
    try { timeoutMs = budget.cleanupCommandTimeoutMs(options.timeoutMs); }
    catch (error) { budgetError = error; timeoutMs = Math.min(options.timeoutMs, 5_000); }
    try { return { result: executeCommand("/usr/bin/docker", args, { ...options, timeoutMs, env: dockerEnv }), budgetError }; }
    catch (error) { return { error, budgetError }; }
  };
  const inspectArguments = (target) => ["inspect", "--format", "{{.Id}}", target];
  const inspectIdentityArguments = (target) => ["inspect", "--format", "{{index .Config.Labels \"com.autoworld.owned-scanner\"}}|{{.Id}}", target];
  const inspect = (target) => invoke(inspectArguments(target), { timeoutMs: 60_000, maxBytes: MiB, allowFailure: true });
  const inspectIdentity = (target) => invoke(inspectIdentityArguments(target), { timeoutMs: 60_000, maxBytes: MiB, allowFailure: true });
  const cleanup = (id) => {
    const removed = cleanupInvoke(["rm", "--force", id], { timeoutMs: 60_000, maxBytes: MiB, allowFailure: true });
    const remaining = cleanupInvoke(inspectArguments(id), { timeoutMs: 60_000, maxBytes: MiB, allowFailure: true });
    const absent = removed.result && (removed.result.status === 0 || dockerObjectAbsent(removed.result, id)) && remaining.result && dockerObjectAbsent(remaining.result, id);
    if (absent) live.delete(id);
    const firstError = removed.budgetError ?? removed.error ?? remaining.budgetError ?? remaining.error;
    if (!absent) { const error = new Error("scanner_owned_container_cleanup_uncertain"); error.cause = firstError; throw error; }
    if (firstError) throw firstError;
  };
  const recoverCreated = (name, primary) => {
    const observed = cleanupInvoke(inspectIdentityArguments(name), { timeoutMs: 60_000, maxBytes: MiB, allowFailure: true });
    if (observed.budgetError || observed.error) primary.cleanupError ??= observed.budgetError ?? observed.error;
    const text = observed.result?.stdout.toString("utf8").trim() ?? "";
    const [observedOwner, observedId] = text.split("|");
    if (observed.result?.status === 0 && observedOwner === owner && /^[a-f0-9]{64}$/u.test(observedId)) {
      live.set(observedId, name); try { cleanup(observedId); } catch (error) { primary.cleanupError ??= error; }
    } else if (!observed.result || !dockerObjectAbsent(observed.result, name)) primary.cleanupError ??= new Error("scanner_owned_container_collision");
  };
  const execute = (runArgs, options) => {
    counter += 1;
    const name = `aw-owned-scanner-${runValue.runId}-${runValue.runAttempt}-${scope}-c${counter}`;
    const collision = inspect(name);
    if (!dockerObjectAbsent(collision, name)) fail("scanner_owned_container_collision");
    let created;
    try { created = invoke(ownedContainerCreateArguments(runArgs, { name, owner }), { timeoutMs: 60_000, maxBytes: MiB }); }
    catch (error) { recoverCreated(name, error); throw error; }
    const id = created.stdout.toString("utf8").trim();
    if (!/^[a-f0-9]{64}$/u.test(id)) {
      const error = new Error("scanner_owned_container_identity_invalid"); recoverCreated(name, error); throw error;
    }
    live.set(id, name);
    let identity;
    try { identity = inspectIdentity(name); }
    catch (error) { try { cleanup(id); } catch (cleanupError) { error.cleanupError = cleanupError; } throw error; }
    if (identity.stdout.toString("utf8").trim() !== `${owner}|${id}`) { const error = new Error("scanner_owned_container_identity_invalid"); try { cleanup(id); } catch (cleanupError) { error.cleanupError = cleanupError; } throw error; }
    let result; let primary;
    try { result = invoke(["start", "--attach", id], options); }
    catch (error) { primary = error; }
    try { cleanup(id); } catch (error) { if (primary) primary.cleanupError = error; else throw error; }
    if (primary) throw primary;
    return result;
  };
  const cleanupAll = () => {
    let first;
    for (const id of [...live.keys()]) try { cleanup(id); } catch (error) { first ??= error; }
    if (live.size > 0 || first) throw first ?? new Error("scanner_owned_container_cleanup_uncertain");
    return true;
  };
  return Object.freeze({ execute, cleanupAll, liveCount: () => live.size });
}

export function ownedBuildDockerArguments({ lock, source, moduleCache, buildCache, output, user, officialGoRoot = null }) {
  if (!/^\d+:\d+$/u.test(user ?? "")) fail("scanner_owned_container_user_invalid");
  const args = ["run", "--rm", "--platform", "linux/amd64", "--user", user, "--network", "none", "--pull=never", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "2048",
    "--memory", "4g", "--memory-swap", "4g", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=2g", "-v", mount(source, "/src", true),
    "-v", mount(moduleCache, "/gomodcache"), "-v", mount(buildCache, "/gocache"), "-v", mount(output, "/out"), "-w", "/src",
    "-e", "CGO_ENABLED=0", "-e", "GOOS=linux", "-e", "GOARCH=amd64", "-e", "GOAMD64=v1", "-e", "GOTOOLCHAIN=local", "-e", "GOPROXY=off", "-e", "GOSUMDB=off",
    "-e", "GOPRIVATE=", "-e", "GONOPROXY=", "-e", "GONOSUMDB=",
    "-e", "GOENV=off", "-e", "GOWORK=off", "-e", "GOFLAGS=-mod=readonly", "-e", "GOMODCACHE=/gomodcache", "-e", "GOCACHE=/gocache", "-e", "HOME=/tmp/home",
    "-e", "TZ=UTC", "-e", "LANG=C.UTF-8", "-e", "LC_ALL=C.UTF-8"];
  if (officialGoRoot) args.push("-v", mount(officialGoRoot, "/usr/local/go", true));
  args.push(lock.compiler.builder.reference, "/bin/sh", "-euc", [
    "test \"$(go version)\" = 'go version go1.27.3 linux/amd64'",
    "test \"$(go env GOENV)\" = 'off'",
    "mkdir -p /tmp/home",
    "go build -mod=readonly -trimpath -buildvcs=false -ldflags='-s -w -buildid= -extldflags=-static -X github.com/aquasecurity/trivy/pkg/version/app.ver=0.76.1' -o /out/trivy ./cmd/trivy",
    "test -f /out/trivy && test ! -L /out/trivy"
  ].join("\n"));
  return args;
}

function safeOwnedRoot(privateRoot, runnerTemp) {
  const target = path.resolve(privateRoot);
  const parent = path.resolve(runnerTemp);
  if (path.dirname(target) !== parent || !SAFE_NAME.test(path.basename(target))) fail("scanner_owned_cleanup_path_invalid");
  if (existsSync(target)) {
    const info = lstatSync(target);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(target) !== target) fail("scanner_owned_cleanup_path_invalid");
  }
  return target;
}

function makeTreeWritable(directory) {
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) makeTreeWritable(item); else chmodSync(item, 0o600);
  }
}

export function removeOwnedScannerPaths(privateRoot, runnerTemp, relativePaths = null) {
  const root = safeOwnedRoot(privateRoot, runnerTemp);
  const targets = relativePaths === null ? [root] : relativePaths.map((relative) => {
    if (typeof relative !== "string" || path.isAbsolute(relative) || relative.includes("..") || relative.includes("\0")) fail("scanner_owned_cleanup_path_invalid");
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) fail("scanner_owned_cleanup_path_invalid");
    return target;
  });
  for (const target of targets) {
    if (!existsSync(target)) continue;
    const info = lstatSync(target);
    if (info.isSymbolicLink()) fail("scanner_owned_cleanup_path_invalid");
    if (info.isDirectory()) makeTreeWritable(target);
    else chmodSync(target, 0o600);
    rmSync(target, { recursive: true, force: true });
    if (existsSync(target)) fail("scanner_owned_cleanup_uncertain");
  }
  return true;
}

export function runOwnedFinalCleanup({ beginCleanup, cleanupContainers, cleanupPaths }) {
  if (![beginCleanup, cleanupContainers, cleanupPaths].every((operation) => typeof operation === "function")) fail("scanner_owned_cleanup_invalid");
  let first;
  for (const operation of [beginCleanup, cleanupContainers, cleanupPaths]) {
    try { operation(); } catch (error) { if (!first) first = error; else (first.cleanupErrors ??= []).push(error); }
  }
  if (first) throw first;
  return true;
}

export function ownedCleanupEvidence(cleanupFailure, absent) {
  if (typeof absent !== "boolean") fail("scanner_owned_cleanup_invalid");
  const messages = [];
  const seen = new Set();
  const visit = (error) => {
    if (!error || typeof error !== "object" || seen.has(error)) return;
    seen.add(error); messages.push(String(error.message)); visit(error.cause);
    for (const nested of error.cleanupErrors ?? []) visit(nested);
  };
  visit(cleanupFailure);
  return Object.freeze({ attempted: true, absent, failure: cleanupFailure ? String(cleanupFailure.message).slice(0, 256) : null,
    budgetFailure: messages.includes("scanner_owned_time_budget_refused") });
}

export function ownedFailureResult({ run: runValue, primary, cleanup, budget: budgetValue, journal }) {
  if (!primary || typeof primary !== "object" || typeof primary.message !== "string" || !cleanup || cleanup.attempted !== true ||
      !Array.isArray(journal) || !budgetValue || typeof budgetValue !== "object") fail("scanner_owned_failure_receipt_invalid");
  return Object.freeze({ schemaVersion: 1, receiptKind: RECEIPT_KIND, state: "BUILD_DIAGNOSTIC", result: "FAILED", run: runValue,
    firstFailure: primary.message.slice(0, 512), cleanup, budget: budgetValue, journal });
}

function gitBlobSha1(bytes) {
  return createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
}

function treeWalker(directory, cap, { trivySource = false } = {}, collect = false) {
  if (!Number.isSafeInteger(cap) || cap < 1 || typeof trivySource !== "boolean") fail("scanner_owned_tree_invalid");
  let total = 0;
  const entries = [], symlinks = new Set(), caseFolded = new Set();
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const item = path.join(current, entry.name);
      const relative = path.relative(directory, item).split(path.sep).join("/");
      const info = lstatSync(item);
      if (trivySource) {
        const folded = relative.toLocaleLowerCase("en-US");
        if (caseFolded.has(folded)) fail("scanner_owned_tree_invalid");
        caseFolded.add(folded);
      }
      if (info.isSymbolicLink()) {
        if (!trivySource || !entry.isSymbolicLink()) fail("scanner_owned_tree_invalid");
        const expected = TRIVY_SOURCE_SYMLINKS.get(relative);
        if (!expected || symlinks.has(relative)) fail("scanner_owned_tree_invalid");
        const target = readlinkSync(item, { encoding: "utf8" });
        const bytes = Buffer.from(target, "utf8");
        if (target !== expected.target || gitBlobSha1(bytes) !== expected.gitBlobSha1) fail("scanner_owned_tree_invalid");
        symlinks.add(relative); total += bytes.length;
        if (collect) entries.push({ path: relative, type: "symlink", target, bytes: bytes.length, sha256: sha256(bytes), gitBlobSha1: expected.gitBlobSha1 });
      } else if (info.isDirectory() && entry.isDirectory()) visit(item);
      else if (info.isFile() && entry.isFile()) {
        total += info.size;
        if (collect) entries.push({ path: relative, ...fileIdentity(item, cap, { allowEmpty: true }) });
      }
      else fail("scanner_owned_tree_invalid");
      if (total > cap) fail("scanner_owned_tree_budget_exceeded");
    }
  };
  visit(directory);
  if (trivySource && (symlinks.size !== TRIVY_SOURCE_SYMLINKS.size || [...TRIVY_SOURCE_SYMLINKS.keys()].some((item) => !symlinks.has(item)))) {
    fail("scanner_owned_tree_invalid");
  }
  return { total, entries };
}

export function directoryBytes(directory, cap, options) {
  return treeWalker(directory, cap, options).total;
}

export function manifestTree(directory, cap, options) {
  return treeWalker(directory, cap, options, true).entries;
}

export function validateGitArchiveListing(listingText, verboseText) {
  const listing = listingText.split("\n").filter(Boolean);
  const verbose = verboseText.split("\n").filter(Boolean);
  if (listing.length < 1 || listing.length !== verbose.length) fail("scanner_owned_git_fixture_invalid");
  const members = listing.map((item, index) => {
    const type = verbose[index][0] === "-" ? "file" : verbose[index][0] === "d" ? "directory" : null;
    if (!type || item !== item.normalize("NFC") || item.length > 512 || !item.startsWith("test-repo/") || item.startsWith("/") || item.includes("\\") || item.includes("\0") ||
        item.split("/").some((part) => part === "." || part === "..") || type === "directory" !== item.endsWith("/")) fail("scanner_owned_git_fixture_invalid");
    return { path: type === "directory" ? item.slice(0, -1) : item, type };
  });
  const names = members.map((item) => item.path);
  if (new Set(names).size !== names.length || new Set(names.map((item) => item.toLocaleLowerCase("en-US"))).size !== names.length) fail("scanner_owned_git_fixture_invalid");
  return Object.freeze(members.map((item) => Object.freeze(item)));
}

function noticeManifest(directory, cap) {
  const entries = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const item = path.join(current, entry.name);
      if (entry.isSymbolicLink()) fail("scanner_owned_notice_tree_invalid");
      if (entry.isDirectory()) visit(item);
      else if (entry.isFile() && /^(?:license|notice|copying)(?:\..*)?$/iu.test(entry.name)) {
        entries.push({ path: path.relative(directory, item).split(path.sep).join("/"), ...fileIdentity(item, cap, { allowEmpty: true }) });
      }
    }
  };
  visit(directory);
  return entries;
}

function validateSourcePatch(source, lock) {
  assertIdentity(path.join(source, "go.mod"), lock.scanner.patched.goMod, 8 * MiB);
  assertIdentity(path.join(source, "go.sum"), lock.scanner.patched.goSum, 8 * MiB);
  const mod = readFileSync(path.join(source, "go.mod"), "utf8");
  const sum = readFileSync(path.join(source, "go.sum"), "utf8");
  if ((mod.match(/github\.com\/go-jose\/go-jose\/v4 v4\.1\.6/gu) ?? []).length !== 1 ||
      (sum.match(/github\.com\/go-jose\/go-jose\/v4 v4\.1\.6(?:\/go\.mod)? /gu) ?? []).length !== 2 || /go-jose\/go-jose\/v4 v4\.1\.5/gu.test(`${mod}\n${sum}`)) {
    fail("scanner_owned_patch_invalid");
  }
}

export function validateModuleClosure(downloads, modules, compiledPaths, lock) {
  if (!Array.isArray(downloads) || !Array.isArray(modules) || !Array.isArray(compiledPaths)) fail("scanner_owned_module_closure_invalid");
  const downloaded = new Map();
  for (const entry of downloads) {
    if (entry?.Error || typeof entry?.Path !== "string" || typeof entry?.Version !== "string" || typeof entry?.Sum !== "string" || typeof entry?.GoModSum !== "string" ||
        !entry.ZipIdentity || !HASH.test(entry.ZipIdentity.sha256) || !Number.isSafeInteger(entry.ZipIdentity.bytes) ||
        !entry.ModIdentity || !HASH.test(entry.ModIdentity.sha256) || !entry.InfoIdentity || !HASH.test(entry.InfoIdentity.sha256) ||
        !entry.DirIdentity || !HASH.test(entry.DirIdentity.sha256) || !Number.isSafeInteger(entry.DirIdentity.bytes)) fail("scanner_owned_module_closure_invalid");
    const key = `${entry.Path}@${entry.Version}`;
    if (downloaded.has(key)) fail("scanner_owned_module_closure_invalid");
    downloaded.set(key, entry);
  }
  const compiled = new Set(compiledPaths);
  if (compiledPaths.length !== compiled.size || compiledPaths.some((item) => typeof item !== "string" || item.length < 1)) fail("scanner_owned_module_closure_invalid");
  const dependencyModules = modules.filter((entry) => entry?.Path !== "github.com/aquasecurity/trivy");
  const modulePaths = new Set(dependencyModules.map((entry) => entry?.Path));
  if (modulePaths.size !== dependencyModules.length || compiledPaths.some((item) => !modulePaths.has(item)) || downloaded.size !== dependencyModules.length) fail("scanner_owned_module_closure_invalid");
  const closure = dependencyModules.map((entry) => {
    const key = `${entry.Path}@${entry.Version}`;
    const material = downloaded.get(key);
    if (!material || entry.Replace || entry.Sum !== material.Sum || entry.GoModSum !== material.GoModSum) fail("scanner_owned_module_closure_invalid");
    return { path: entry.Path, version: entry.Version, sum: entry.Sum, goModSum: entry.GoModSum, compiled: compiled.has(entry.Path) };
  }).sort((a, b) => `${a.path}@${a.version}`.localeCompare(`${b.path}@${b.version}`, "en"));
  if (closure.length !== downloaded.size || new Set(closure.map((entry) => `${entry.path}@${entry.version}`)).size !== closure.length) fail("scanner_owned_module_closure_invalid");
  for (const item of compiled) if (!closure.some((entry) => entry.path === item)) fail("scanner_owned_compiled_module_missing");
  const jose = closure.filter((entry) => entry.path === lock.goJose.module);
  if (jose.length !== 1 || jose[0].version !== lock.goJose.version || jose[0].sum !== lock.goJose.sum || jose[0].goModSum !== lock.goJose.goModSum || !jose[0].compiled) fail("scanner_owned_go_jose_closure_invalid");
  const materials = dependencyModules.map((entry) => {
    const material = downloaded.get(`${entry.Path}@${entry.Version}`);
    return { path: entry.Path, version: entry.Version, zip: material.ZipIdentity, mod: material.ModIdentity, info: material.InfoIdentity, dir: material.DirIdentity };
  }).sort((a, b) => `${a.path}@${a.version}`.localeCompare(`${b.path}@${b.version}`, "en"));
  return Object.freeze({ modules: closure, materials, sha256: sha256(Buffer.from(`${canonicalJson({ modules: closure, materials })}\n`)) });
}

function strictText(bytes, code = "scanner_owned_preparation_invalid") {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(code); }
}

function byteIdentity(bytes) {
  return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
}

function parseGoSum(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 8 * MiB) fail("scanner_owned_preparation_invalid");
  const text = strictText(bytes);
  if (text.includes("\r") || !text.endsWith("\n")) fail("scanner_owned_preparation_invalid");
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => line.length < 1) || new Set(lines).size !== lines.length) fail("scanner_owned_preparation_invalid");
  const parsed = lines.map((line) => {
    const fields = line.split(" ");
    if (fields.length !== 3 || fields.some((field) => field.length < 1) || !fields[2].startsWith("h1:") || fields[0].startsWith(".") ||
        fields[0].startsWith("/") || fields[0].includes("\\") || fields[0].includes("\0")) fail("scanner_owned_preparation_invalid");
    const goMod = fields[1].endsWith("/go.mod");
    const version = goMod ? fields[1].slice(0, -7) : fields[1];
    if (!version.startsWith("v") || version.length < 2) fail("scanner_owned_preparation_invalid");
    return Object.freeze({ line, path: fields[0], version, sum: fields[2], goMod });
  });
  return Object.freeze(parsed);
}

function normalizeGraph(graphText) {
  if (typeof graphText !== "string" || Buffer.byteLength(graphText) > 8 * MiB || graphText.includes("\r")) fail("scanner_owned_preparation_invalid");
  const lines = graphText.split("\n").filter(Boolean);
  if (lines.length < 1 || new Set(lines).size !== lines.length || lines.some((line) => line.split(" ").length !== 2)) fail("scanner_owned_preparation_invalid");
  return Object.freeze([...lines].sort());
}

function validatePreparationSeals(seals, identities) {
  const stages = ["initialized", "tidy", "download", "modules", "graph", "deps", "verify"];
  if (!Array.isArray(seals) || seals.length !== stages.length) fail("scanner_owned_preparation_invalid");
  for (const [index, seal] of seals.entries()) {
    if (!exactKeys(seal, ["stage", "canonicalMod", "canonicalSum", "privateMod", "privateSum"]) || seal.stage !== stages[index] ||
        canonicalJson(seal.canonicalMod) !== canonicalJson(identities.canonicalMod) || canonicalJson(seal.canonicalSum) !== canonicalJson(identities.canonicalSum) ||
        canonicalJson(seal.privateMod) !== canonicalJson(identities.canonicalMod) || !Number.isSafeInteger(seal.privateSum?.bytes) || seal.privateSum.bytes < 1 ||
        seal.privateSum.bytes > 8 * MiB || !HASH.test(seal.privateSum?.sha256 ?? "")) fail("scanner_owned_preparation_invalid");
  }
  if (canonicalJson(seals[0].privateSum) !== canonicalJson(identities.canonicalSum) || canonicalJson(seals[1].privateSum) !== canonicalJson(identities.canonicalSum) ||
      canonicalJson(seals.at(-1).privateSum) !== canonicalJson(identities.privateSum)) fail("scanner_owned_preparation_invalid");
}

export function validatePrivatePreparation({ canonicalMod, canonicalSum, privateMod, privateSum, downloads, modules, graphText, sumdbLines, seals, lock }) {
  if (![canonicalMod, canonicalSum, privateMod, privateSum].every(Buffer.isBuffer) || canonicalMod.length < 1 || canonicalMod.length > 8 * MiB || privateMod.length > 8 * MiB ||
      !Array.isArray(downloads) || !Array.isArray(modules) || !Array.isArray(sumdbLines)) fail("scanner_owned_preparation_invalid");
  const identities = { canonicalMod: byteIdentity(canonicalMod), canonicalSum: byteIdentity(canonicalSum), privateSum: byteIdentity(privateSum) };
  if (canonicalJson(identities.canonicalMod) !== canonicalJson(lock?.scanner?.patched?.goMod) ||
      canonicalJson(identities.canonicalSum) !== canonicalJson(lock?.scanner?.patched?.goSum) || !privateMod.equals(canonicalMod)) fail("scanner_owned_preparation_invalid");
  const canonical = parseGoSum(canonicalSum); const prepared = parseGoSum(privateSum);
  const canonicalLines = new Set(canonical.map((entry) => entry.line)); const preparedLines = new Map(prepared.map((entry) => [entry.line, entry]));
  if ([...canonicalLines].some((line) => !preparedLines.has(line))) fail("scanner_owned_preparation_invalid");
  const selected = new Map();
  for (const module of modules) {
    if (module?.Main === true) {
      if (module.Path !== "github.com/aquasecurity/trivy" || module.Replace) fail("scanner_owned_preparation_invalid");
      continue;
    }
    if (typeof module?.Path !== "string" || typeof module?.Version !== "string" || typeof module?.Sum !== "string" || typeof module?.GoModSum !== "string" || module.Replace) fail("scanner_owned_preparation_invalid");
    const key = `${module.Path}@${module.Version}`;
    if (selected.has(key)) fail("scanner_owned_preparation_invalid");
    selected.set(key, module);
  }
  const downloaded = new Map();
  for (const entry of downloads) {
    if (entry?.Error || typeof entry?.Path !== "string" || typeof entry?.Version !== "string" || typeof entry?.Sum !== "string" || typeof entry?.GoModSum !== "string") fail("scanner_owned_preparation_invalid");
    const key = `${entry.Path}@${entry.Version}`;
    if (downloaded.has(key)) fail("scanner_owned_preparation_invalid");
    downloaded.set(key, entry);
  }
  if (selected.size !== downloaded.size) fail("scanner_owned_preparation_invalid");
  for (const [key, module] of selected) {
    const material = downloaded.get(key);
    if (!material || material.Sum !== module.Sum || material.GoModSum !== module.GoModSum ||
        !preparedLines.has(`${module.Path} ${module.Version} ${material.Sum}`) || !preparedLines.has(`${module.Path} ${module.Version}/go.mod ${material.GoModSum}`)) fail("scanner_owned_preparation_invalid");
  }
  const graph = normalizeGraph(graphText); const graphNodes = new Set(graph.flatMap((line) => line.split(" ")));
  const authenticated = new Set(sumdbLines);
  if (authenticated.size !== sumdbLines.length || sumdbLines.some((line) => typeof line !== "string" || line.includes("\r") || line.includes("\n"))) fail("scanner_owned_preparation_invalid");
  const additions = [];
  for (const entry of prepared) {
    if (entry.path === lock.goJose.module && (entry.version !== lock.goJose.version || entry.sum !== (entry.goMod ? lock.goJose.goModSum : lock.goJose.sum))) fail("scanner_owned_preparation_invalid");
    if (canonicalLines.has(entry.line)) continue;
    const selectedModule = selected.get(`${entry.path}@${entry.version}`);
    if (selectedModule) {
      const expected = entry.goMod ? selectedModule.GoModSum : selectedModule.Sum;
      if (entry.sum !== expected) fail("scanner_owned_preparation_invalid");
      additions.push({ line: entry.line, kind: entry.goMod ? "SELECTED_GO_MOD" : "SELECTED_ZIP", path: entry.path, version: entry.version });
    } else {
      if (!entry.goMod || !graphNodes.has(`${entry.path}@${entry.version}`) || !authenticated.has(entry.line)) fail("scanner_owned_preparation_invalid");
      additions.push({ line: entry.line, kind: "HISTORICAL_GO_MOD", path: entry.path, version: entry.version });
    }
  }
  if (additions.length > 4096 || privateSum.length - canonicalSum.length > 2 * MiB) fail("scanner_owned_preparation_invalid");
  validatePreparationSeals(seals, identities);
  const semanticSumSha256 = sha256(Buffer.from(`${[...preparedLines.keys()].sort().join("\n")}\n`));
  return Object.freeze({ privateMod: identities.canonicalMod, privateSum: identities.privateSum, semanticSumSha256,
    additions: Object.freeze(additions.sort((a, b) => a.line.localeCompare(b.line, "en")).map(Object.freeze)), graph,
    sumdbLines: Object.freeze(additions.filter((entry) => entry.kind === "HISTORICAL_GO_MOD").map((entry) => entry.line).sort()), seals: Object.freeze(seals.map((seal) => Object.freeze({ ...seal }))) });
}

export function validatePreparationPair(a, b) {
  if (!a?.preparation || !b?.preparation || !a?.closure || !b?.closure) fail("scanner_owned_preparation_mismatch");
  const semantic = (value) => ({ privateMod: value.preparation.privateMod, semanticSumSha256: value.preparation.semanticSumSha256, additions: value.preparation.additions,
    graph: value.preparation.graph, sumdbLines: value.preparation.sumdbLines, closure: value.closure });
  if (canonicalJson(semantic(a)) !== canonicalJson(semantic(b))) fail("scanner_owned_preparation_mismatch");
  return true;
}

function stage(budget, journal, name, requestedMs, operation) {
  const full = `owned:${name}`;
  const reservation = budget.startStage(full, requestedMs);
  const started = reservation.startedMonotonicMs;
  journal.push({ stage: full, status: "ATTEMPTED", monotonicMs: started });
  try {
    const value = operation(reservation.timeoutMs);
    budget.finishStage(full, "PASSED");
    const completed = budget.snapshot().journal.at(-1)?.monotonicMs ?? started;
    journal.push({ stage: full, status: "PASSED", monotonicMs: completed });
    return value;
  } catch (error) {
    try { budget.finishStage(full, "FAILED"); } catch (budgetError) { error.cause ??= budgetError; }
    const completed = budget.snapshot().journal.at(-1)?.monotonicMs ?? started;
    journal.push({ stage: full, status: "FAILED", monotonicMs: completed });
    throw error;
  }
}

function runIdentity() {
  const value = { workflow: process.env.GITHUB_WORKFLOW ?? "", runId: process.env.GITHUB_RUN_ID ?? "", runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? ""), sourceSha: process.env.GITHUB_SHA ?? "" };
  if (!value.workflow || !/^\d+$/u.test(value.runId) || !Number.isSafeInteger(value.runAttempt) || value.runAttempt < 1 || !COMMIT.test(value.sourceSha)) fail("scanner_owned_run_identity_invalid");
  return value;
}

function writePublicJson(root, relative, value, files, limits) {
  const bytes = Buffer.from(`${canonicalJson(value)}\n`);
  if (bytes.length > limits.publicFileBytes) fail("scanner_owned_public_evidence_exceeded");
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  files.push({ path: relative.split(path.sep).join("/"), bytes: bytes.length, sha256: sha256(bytes), mediaType: "application/json" });
}

function writePublicManifest(root, runIdValue, files, limits) {
  if (files.length + 1 > limits.publicEntries) fail("scanner_owned_public_evidence_exceeded");
  const normalized = files.map((entry) => ({ ...entry })).sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (new Set(normalized.map((entry) => entry.path.toLocaleLowerCase("en-US"))).size !== normalized.length || normalized.some((entry) => entry.path.length > 512 || entry.path.startsWith("/") || entry.path.includes("..") || entry.path.includes("\\"))) fail("scanner_owned_public_evidence_invalid");
  const manifest = { schemaVersion: 1, kind: "OWNED_SCANNER_PUBLIC_EVIDENCE_V1", run: runIdValue, files: normalized };
  const bytes = Buffer.from(`${canonicalJson(manifest)}\n`);
  if (bytes.length > limits.publicFileBytes || files.reduce((sum, item) => sum + item.bytes, bytes.length) > limits.publicTotalBytes) fail("scanner_owned_public_evidence_exceeded");
  writeFileSync(path.join(root, "public-manifest.json"), bytes, { flag: "wx", mode: 0o600 });
  return Object.freeze(manifest);
}

function ensureSpace(directory, requiredBytes) {
  const stats = statfsSync(directory);
  const free = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isSafeInteger(free) || free < requiredBytes) fail("scanner_owned_space_refused");
  return free;
}

export function requiredOwnedFreeBytes(scope, stagedIncrementalPeak) {
  if (!["upstream", "managed"].includes(scope) || !Number.isSafeInteger(stagedIncrementalPeak) || stagedIncrementalPeak < 1) fail("scanner_owned_space_projection_invalid");
  const projected = Math.ceil(stagedIncrementalPeak * 1.25);
  return scope === "managed" ? Math.max(20 * GiB, projected) : projected;
}

function preparationScript(lock) {
  const mod = lock.scanner.patched.goMod;
  const sum = lock.scanner.patched.goSum;
  return [
    "set -euo pipefail", "test \"$(go version)\" = 'go version go1.27.3 linux/amd64'", "export GOTOOLCHAIN=local GOENV=off GOWORK=off",
    `test "$(wc -c < /src/go.mod | tr -d ' ')" = '${mod.bytes}' && test "$(sha256sum /src/go.mod | cut -d ' ' -f 1)" = '${mod.sha256}'`,
    `test "$(wc -c < /src/go.sum | tr -d ' ')" = '${sum.bytes}' && test "$(sha256sum /src/go.sum | cut -d ' ' -f 1)" = '${sum.sha256}'`,
    "seal() { stage=$1; cm_bytes=$(wc -c < /src/go.mod | tr -d ' '); cm_hash=$(sha256sum /src/go.mod | cut -d ' ' -f 1); cs_bytes=$(wc -c < /src/go.sum | tr -d ' '); cs_hash=$(sha256sum /src/go.sum | cut -d ' ' -f 1); pm_bytes=$(wc -c < /evidence/trivy.mod | tr -d ' '); pm_hash=$(sha256sum /evidence/trivy.mod | cut -d ' ' -f 1); ps_bytes=$(wc -c < /evidence/trivy.sum | tr -d ' '); ps_hash=$(sha256sum /evidence/trivy.sum | cut -d ' ' -f 1); printf '{\"stage\":\"%s\",\"canonicalMod\":{\"bytes\":%s,\"sha256\":\"%s\"},\"canonicalSum\":{\"bytes\":%s,\"sha256\":\"%s\"},\"privateMod\":{\"bytes\":%s,\"sha256\":\"%s\"},\"privateSum\":{\"bytes\":%s,\"sha256\":\"%s\"}}\\n' \"$stage\" \"$cm_bytes\" \"$cm_hash\" \"$cs_bytes\" \"$cs_hash\" \"$pm_bytes\" \"$pm_hash\" \"$ps_bytes\" \"$ps_hash\" >> /evidence/seals.jsonl; }",
    "seal initialized", "go env -json GOTOOLCHAIN GOENV GOWORK GOFLAGS GOPROXY GOSUMDB GOPRIVATE GONOPROXY GONOSUMDB > /evidence/effective-env.json",
    "GOFLAGS= go mod tidy -diff > /evidence/tidy.diff", "test ! -s /evidence/tidy.diff", "seal tidy",
    "go mod download -modfile=/evidence/trivy.mod -json all > /evidence/downloads.seq", "seal download",
    "go list -modfile=/evidence/trivy.mod -m -json all > /evidence/modules.seq", "seal modules",
    "go mod graph -modfile=/evidence/trivy.mod > /evidence/graph.txt", "seal graph",
    "go list -modfile=/evidence/trivy.mod -deps -json=Module ./cmd/trivy > /evidence/deps.seq", "seal deps",
    "go mod verify -modfile=/evidence/trivy.mod > /evidence/verify.txt", "test \"$(grep -c '^all modules verified$' /evidence/verify.txt)\" -eq 1", "seal verify"
  ].join("\n");
}

export function ownedPreparationDockerArguments({ lock, source, moduleCache, buildCache, evidence, user }) {
  if (!/^\d+:\d+$/u.test(user ?? "")) fail("scanner_owned_container_user_invalid");
  return ["run", "--rm", "--platform", "linux/amd64", "--user", user, "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "2048", "--memory", "4g", "--memory-swap", "4g", "--tmpfs", "/tmp:rw,nosuid,nodev,size=2g",
    "-v", mount(source, "/src", true), "-v", mount(moduleCache, "/gomodcache"), "-v", mount(buildCache, "/gocache"), "-v", mount(evidence, "/evidence"), "-w", "/src",
    "-e", "GOMODCACHE=/gomodcache", "-e", "GOCACHE=/gocache", "-e", "CGO_ENABLED=0", "-e", "GOOS=linux", "-e", "GOARCH=amd64", "-e", "GOAMD64=v1",
    "-e", "GOTOOLCHAIN=local", "-e", "GOENV=off", "-e", "GOWORK=off", "-e", "GOFLAGS=-mod=readonly", "-e", "GOPROXY=https://proxy.golang.org", "-e", "GOSUMDB=sum.golang.org", "-e", "GONOSUMDB=", "-e", "GONOPROXY=", "-e", "GOPRIVATE=",
    lock.compiler.builder.reference, "/bin/sh", "-euc", preparationScript(lock)];
}

function containerCachePath(value, moduleCache) {
  if (typeof value !== "string" || !value.startsWith("/gomodcache/")) fail("scanner_owned_module_download_invalid");
  const relative = value.slice("/gomodcache/".length).split("/");
  if (relative.some((part) => part.length < 1 || part === "." || part === ".." || part.includes("\\") || part.includes("\0"))) fail("scanner_owned_module_download_invalid");
  const resolved = path.resolve(moduleCache, ...relative);
  if (!resolved.startsWith(`${path.resolve(moduleCache)}${path.sep}`)) fail("scanner_owned_module_download_invalid");
  return resolved;
}

function enrichDownloads(downloads, moduleCache, cap) {
  return downloads.map((entry) => {
    if (entry.Error || !entry.Zip || !entry.GoMod || !entry.Info || !entry.Dir) fail("scanner_owned_module_download_invalid");
    const directory = containerCachePath(entry.Dir, moduleCache);
    const directoryInfo = lstatSync(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) fail("scanner_owned_module_download_invalid");
    const directoryManifest = manifestTree(directory, cap);
    const directoryBytesValue = directoryManifest.reduce((total, item) => total + item.bytes, 0);
    return { Path: entry.Path, Version: entry.Version, Sum: entry.Sum, GoModSum: entry.GoModSum,
      ZipIdentity: fileIdentity(containerCachePath(entry.Zip, moduleCache), cap),
      ModIdentity: fileIdentity(containerCachePath(entry.GoMod, moduleCache), 8 * MiB, { allowEmpty: true }),
      InfoIdentity: fileIdentity(containerCachePath(entry.Info, moduleCache), 8 * MiB),
      DirIdentity: { bytes: directoryBytesValue, sha256: sha256(Buffer.from(`${canonicalJson(directoryManifest)}\n`)) }, Origin: entry.Origin ?? null };
  });
}

function collectSumdbLines(sumdbRoot, cap) {
  if (!existsSync(sumdbRoot)) return Object.freeze([]);
  const manifest = manifestTree(sumdbRoot, cap);
  const lines = new Set();
  for (const entry of manifest) {
    if (entry.bytes > 8 * MiB) fail("scanner_owned_preparation_invalid");
    let text;
    try { text = strictText(readFileSync(path.join(sumdbRoot, ...entry.path.split("/")))); } catch { continue; }
    for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
      if (/^[^\s\\/][^\s\\]* v[^\s]+(?:\/go\.mod)? h1:[^\s]+$/u.test(line)) lines.add(line);
    }
  }
  return Object.freeze([...lines].sort());
}

function parseSeals(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 1 || bytes.length > 8 * MiB) fail("scanner_owned_preparation_invalid");
  const text = strictText(bytes);
  if (text.includes("\r") || !text.endsWith("\n")) fail("scanner_owned_preparation_invalid");
  try { return text.slice(0, -1).split("\n").map((line) => JSON.parse(line)); } catch { fail("scanner_owned_preparation_invalid"); }
}

function validatePreparationEnvironment(file) {
  let value;
  try { value = JSON.parse(strictText(readFileSync(file))); } catch { fail("scanner_owned_preparation_invalid"); }
  const expected = { GOENV: "off", GOFLAGS: "-mod=readonly", GONOPROXY: "", GONOSUMDB: "", GOPRIVATE: "", GOPROXY: "https://proxy.golang.org",
    GOSUMDB: "sum.golang.org", GOTOOLCHAIN: "local", GOWORK: "off" };
  if (canonicalJson(value) !== canonicalJson(expected)) fail("scanner_owned_preparation_invalid");
  return Object.freeze(expected);
}

export function ownedCompilerReceipt(lock, construction) {
  if (construction === "A") return Object.freeze({ delivery: "BUILDER_IMAGE", goVersion: lock.compiler.version, goos: "linux", goarch: "amd64", cgoEnabled: false,
    identity: { kind: "OCI_PLATFORM", reference: lock.compiler.builder.reference, indexDigest: lock.compiler.builder.indexDigest, platformDigest: lock.compiler.builder.platformDigest } });
  if (construction === "B") return Object.freeze({ delivery: "OFFICIAL_ARCHIVE", goVersion: lock.compiler.version, goos: "linux", goarch: "amd64", cgoEnabled: false,
    identity: { kind: "GO_ARCHIVE", url: lock.compiler.archive.url, bytes: lock.compiler.archive.bytes, sha256: lock.compiler.archive.sha256 } });
  fail("scanner_owned_construction_invalid");
}

function buildReceipt({ construction, run: runValue, lock, binary, rawBuildInfo, closure, journal }) {
  return { schemaVersion: 1, receiptKind: RECEIPT_KIND, state: "BUILD_DIAGNOSTIC", construction, run: runValue,
    source: { repository: lock.scanner.repositoryUrl, commit: lock.scanner.sourceCommit, tree: lock.scanner.sourceTree, patchSha256: lock.patch.sha256,
      goModSha256: lock.scanner.patched.goMod.sha256, goSumSha256: lock.scanner.patched.goSum.sha256 },
    compiler: ownedCompilerReceipt(lock, construction),
    binary: { path: lock.build.outputPath, ...fileIdentity(binary, lock.limits.binaryBytes) },
    build: { commandPath: lock.scanner.commandPath, appVersion: lock.scanner.cliVersion, flags: BUILD_FLAGS, rawBuildInfo },
    closure: { sha256: closure.sha256, modules: closure.modules, materials: closure.materials }, journal: journal.map((item) => ({ ...item })) };
}

export function buildOwnedScanner({ output, scope, budget }) {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP || !["upstream", "managed"].includes(scope) ||
      !budget || ["startStage", "finishStage", "beginCleanup", "remainingMs", "commandTimeoutMs", "cleanupCommandTimeoutMs", "snapshot"].some((key) => typeof budget[key] !== "function")) fail("scanner_owned_build_requires_linux_actions");
  const runnerTemp = path.resolve(process.env.RUNNER_TEMP);
  const runnerUser = `${process.getuid()}:${process.getgid()}`;
  validateOwnedOutput(output, runnerTemp);
  const lockBytes = readFileSync(LOCK_PATH);
  const lock = validateOwnedScannerLock(JSON.parse(lockBytes));
  assertIdentity(path.join(ROOT, lock.patch.path), lock.patch, MiB);
  assertIdentity(path.join(ROOT, lock.notice.path), lock.notice, MiB);
  assertIdentity(path.join(ROOT, lock.fixtures.rpm.path), lock.fixtures.rpm, MiB);
  assertIdentity(path.join(ROOT, lock.fixtures.git.path), lock.fixtures.git, MiB);
  const runValue = runIdentity();
  const privateRoot = path.join(runnerTemp, `aw-owned-scanner-${runValue.runId}-${runValue.runAttempt}-${scope}`);
  safeOwnedRoot(privateRoot, runnerTemp);
  if (existsSync(privateRoot) || existsSync(output)) fail("scanner_owned_path_exists");
  mkdirSync(privateRoot, { recursive: false, mode: 0o700 });
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const publicFiles = [];
  const journal = [];
  const privateLogs = path.join(privateRoot, "private-logs");
  const evidence = path.join(privateRoot, "evidence");
  const dockerHome = path.join(privateRoot, "docker-home"); const dockerConfig = path.join(dockerHome, "config");
  mkdirSync(privateLogs); mkdirSync(evidence); mkdirSync(dockerHome, { mode: 0o700 }); mkdirSync(dockerConfig, { mode: 0o700 });
  const containers = createOwnedContainerRunner({ runValue, scope, budget, dockerEnv: { HOME: dockerHome, DOCKER_CONFIG: dockerConfig, PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" } });
  let firstFailure;
  let returnValue;
  const publicDirectory = { root: output, manifest: null };
  try {
    stage(budget, journal, "preparation", lock.limits.preparationMs, (timeoutMs) => {
      const bounded = (cap) => Math.min(timeoutMs, budget.commandTimeoutMs(cap));
      const stagedIncrementalPeak = 4 * lock.limits.sourceTreeBytes + 2 * lock.limits.moduleCacheBytes + 3 * lock.limits.buildCacheBytes +
        lock.limits.sourceArchiveBytes + lock.limits.compilerTreeBytes + 2 * lock.limits.binaryBytes + 2 * 64 * MiB + lock.fixtures.rpm.bytes + lock.fixtures.git.bytes;
      ensureSpace(privateRoot, requiredOwnedFreeBytes(scope, stagedIncrementalPeak));
      const source = path.join(privateRoot, "source-base");
      run("/usr/bin/git", ["-c", "credential.helper=", "clone", "--no-checkout", "--filter=blob:none", lock.scanner.repositoryUrl, source], { timeoutMs: bounded(15 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, "source-clone.log") });
      run("/usr/bin/git", ["-C", source, "checkout", "--detach", lock.scanner.sourceCommit], { timeoutMs: bounded(5 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, "source-checkout.log") });
      if (run("/usr/bin/git", ["-C", source, "rev-parse", "HEAD"], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8").trim() !== lock.scanner.sourceCommit ||
          run("/usr/bin/git", ["-C", source, "rev-parse", "HEAD^{tree}"], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8").trim() !== lock.scanner.sourceTree) fail("scanner_owned_source_changed");
      assertIdentity(path.join(source, "go.mod"), lock.scanner.original.goMod, 8 * MiB);
      assertIdentity(path.join(source, "go.sum"), lock.scanner.original.goSum, 8 * MiB);
      run("/usr/bin/git", ["-C", source, "apply", "--unidiff-zero", "--whitespace=error-all", path.join(ROOT, lock.patch.path)], { timeoutMs: bounded(60_000), maxBytes: MiB, logFile: path.join(privateLogs, "patch.log") });
      const changed = run("/usr/bin/git", ["-C", source, "diff", "--name-only"], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8").trim().split("\n");
      if (changed.join("\0") !== "go.mod\0go.sum") fail("scanner_owned_source_delta_invalid");
      validateSourcePatch(source, lock);
      const upstreamNotices = Object.fromEntries(["LICENSE", "NOTICE"].map((name) => [name, fileIdentity(path.join(source, name), MiB)]));
      const archive = path.join(privateRoot, "patched-source.tar.gz");
      run("/usr/bin/tar", ["--create", "--gzip", "--file", archive, "--exclude=.git", "--directory", source, "."], { timeoutMs: bounded(5 * 60_000), maxBytes: MiB, logFile: path.join(privateLogs, "source-archive.log") });
      const sourceArchive = fileIdentity(archive, lock.limits.sourceArchiveBytes);
      const sourceManifest = manifestTree(source, lock.limits.sourceTreeBytes, { trivySource: true }).filter((entry) => !entry.path.startsWith(".git/"));
      writePublicJson(output, "source.json", { schemaVersion: 1, source: { commit: lock.scanner.sourceCommit, tree: lock.scanner.sourceTree }, archive: sourceArchive,
        patched: lock.scanner.patched, files: sourceManifest, upstreamNotices, patch: { bytes: lock.patch.bytes, sha256: lock.patch.sha256 }, notice: { bytes: lock.notice.bytes, sha256: lock.notice.sha256 } }, publicFiles, lock.limits);

      const goArchive = path.join(privateRoot, "go1.27.3.tar.gz");
      run("/usr/bin/curl", ["--fail", "--location", "--proto", "=https", "--tlsv1.2", "--max-filesize", String(128 * MiB), "--max-time", "600", "--output", goArchive, lock.compiler.archive.url], { timeoutMs: bounded(11 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, "go-download.log") });
      assertIdentity(goArchive, lock.compiler.archive, 128 * MiB);
      const officialGo = path.join(privateRoot, "official-go"); mkdirSync(officialGo);
      run("/usr/bin/tar", ["-xzf", goArchive, "--strip-components=1", "-C", officialGo, "--no-same-owner", "--no-same-permissions"], { timeoutMs: bounded(5 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, "go-extract.log") });
      directoryBytes(officialGo, lock.limits.compilerTreeBytes);

      const preparations = {};
      for (const letter of ["a", "b"]) {
        const sourceCopy = path.join(privateRoot, `source-${letter}`); cpSync(source, sourceCopy, { recursive: true, verbatimSymlinks: true }); rmSync(path.join(sourceCopy, ".git"), { recursive: true, force: true });
        validateSourcePatch(sourceCopy, lock);
        const moduleCache = path.join(privateRoot, `gomodcache-${letter}`); const buildCache = path.join(privateRoot, `gocache-${letter}`); const prepEvidence = path.join(evidence, `prep-${letter}`);
        mkdirSync(moduleCache); mkdirSync(buildCache); mkdirSync(prepEvidence);
        copyFileSync(path.join(sourceCopy, "go.mod"), path.join(prepEvidence, "trivy.mod"));
        copyFileSync(path.join(sourceCopy, "go.sum"), path.join(prepEvidence, "trivy.sum"));
        assertIdentity(path.join(prepEvidence, "trivy.mod"), lock.scanner.patched.goMod, 8 * MiB);
        assertIdentity(path.join(prepEvidence, "trivy.sum"), lock.scanner.patched.goSum, 8 * MiB);
        const prepArgs = ownedPreparationDockerArguments({ lock, source: sourceCopy, moduleCache, buildCache, evidence: prepEvidence, user: runnerUser });
        containers.execute(prepArgs, { timeoutMs: bounded(25 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, `prepare-${letter}.log`) });
        directoryBytes(prepEvidence, 64 * MiB);
        for (const [name, allowEmpty] of [["trivy.mod", false], ["trivy.sum", false], ["tidy.diff", true], ["downloads.seq", false], ["modules.seq", false],
          ["graph.txt", false], ["deps.seq", false], ["verify.txt", false], ["seals.jsonl", false], ["effective-env.json", false]]) {
          fileIdentity(path.join(prepEvidence, name), name.startsWith("trivy.") ? 8 * MiB : lock.limits.childStreamBytes, { allowEmpty });
        }
        validateSourcePatch(sourceCopy, lock);
        directoryBytes(sourceCopy, lock.limits.sourceTreeBytes, { trivySource: true }); directoryBytes(moduleCache, lock.limits.moduleCacheBytes); directoryBytes(buildCache, lock.limits.buildCacheBytes);
        if (canonicalJson(manifestTree(sourceCopy, lock.limits.sourceTreeBytes, { trivySource: true })) !== canonicalJson(sourceManifest)) fail("scanner_owned_source_seal_changed");
        const downloadsJson = run("/usr/bin/jq", ["-s", ".", path.join(prepEvidence, "downloads.seq")], { timeoutMs: bounded(60_000), maxBytes: lock.limits.childStreamBytes }).stdout;
        const modulesJson = run("/usr/bin/jq", ["-s", ".", path.join(prepEvidence, "modules.seq")], { timeoutMs: bounded(60_000), maxBytes: lock.limits.childStreamBytes }).stdout;
        const compiledJson = run("/usr/bin/jq", ["-s", "[.[] | select(.Module != null and .Module.Main != true) | .Module.Path] | unique", path.join(prepEvidence, "deps.seq")], { timeoutMs: bounded(60_000), maxBytes: lock.limits.childStreamBytes }).stdout;
        const rawDownloads = JSON.parse(downloadsJson.toString("utf8"));
        const downloadMaterials = enrichDownloads(rawDownloads, moduleCache, 256 * MiB);
        const modules = JSON.parse(modulesJson.toString("utf8"));
        const closure = validateModuleClosure(downloadMaterials, modules, JSON.parse(compiledJson.toString("utf8")), lock);
        writeFileSync(path.join(evidence, `closure-${letter}.json`), `${canonicalJson(closure)}\n`, { flag: "wx", mode: 0o600 });
        const sumdbRoot = path.join(moduleCache, "cache", "download", "sumdb");
        const sumdbEvidence = existsSync(sumdbRoot) ? manifestTree(sumdbRoot, 64 * MiB) : [];
        const environment = validatePreparationEnvironment(path.join(prepEvidence, "effective-env.json"));
        const preparation = validatePrivatePreparation({ canonicalMod: readFileSync(path.join(sourceCopy, "go.mod")), canonicalSum: readFileSync(path.join(sourceCopy, "go.sum")),
          privateMod: readFileSync(path.join(prepEvidence, "trivy.mod")), privateSum: readFileSync(path.join(prepEvidence, "trivy.sum")), downloads: rawDownloads, modules,
          graphText: strictText(readFileSync(path.join(prepEvidence, "graph.txt"))), sumdbLines: collectSumdbLines(sumdbRoot, 64 * MiB), seals: parseSeals(path.join(prepEvidence, "seals.jsonl")), lock });
        preparations[letter] = { preparation, closure };
        writePublicJson(output, `module-preparation-${letter}.json`, { schemaVersion: 1, construction: letter.toUpperCase(), closureSha256: closure.sha256,
          materials: downloadMaterials.map((entry) => ({ path: entry.Path, version: entry.Version, sum: entry.Sum, goModSum: entry.GoModSum,
            zip: entry.ZipIdentity, mod: entry.ModIdentity, info: entry.InfoIdentity, dir: entry.DirIdentity, origin: entry.Origin })),
          preparation: { privateMod: preparation.privateMod, privateSum: preparation.privateSum, semanticSumSha256: preparation.semanticSumSha256,
            additions: preparation.additions.length,
            additionsSha256: sha256(Buffer.from(`${canonicalJson(preparation.additions)}\n`)), graphSha256: sha256(Buffer.from(`${preparation.graph.join("\n")}\n`)),
            sumdbRelevantSha256: sha256(Buffer.from(`${preparation.sumdbLines.join("\n")}\n`)), environment }, sumdbEvidence,
          notices: noticeManifest(moduleCache, 4 * MiB) }, publicFiles, lock.limits);
      }
      validatePreparationPair(preparations.a, preparations.b);
      const jose = path.join(privateRoot, "go-jose");
      run("/usr/bin/git", ["-c", "credential.helper=", "clone", "--no-checkout", "https://github.com/go-jose/go-jose.git", jose], { timeoutMs: bounded(10 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, "jose-clone.log") });
      run("/usr/bin/git", ["-C", jose, "checkout", "--detach", lock.goJose.commit], { timeoutMs: bounded(2 * 60_000), maxBytes: MiB });
      if (run("/usr/bin/git", ["-C", jose, "rev-parse", "HEAD^{tree}"], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8").trim() !== lock.goJose.tree) fail("scanner_owned_jose_source_changed");
      assertIdentity(path.join(jose, "go.mod"), lock.goJose.goMod, MiB); assertIdentity(path.join(jose, "go.sum"), lock.goJose.goSum, MiB, { allowEmpty: true });
      writePublicJson(output, "go-jose-source.json", { schemaVersion: 1, commit: lock.goJose.commit, tree: lock.goJose.tree,
        files: manifestTree(jose, lock.limits.sourceTreeBytes).filter((entry) => !entry.path.startsWith(".git/")), license: fileIdentity(path.join(jose, "LICENSE"), MiB) }, publicFiles, lock.limits);
    });

    stage(budget, journal, "tests", lock.limits.testsMs, (timeoutMs) => {
      const bounded = (cap) => Math.min(timeoutMs, budget.commandTimeoutMs(cap));
      const sourceA = path.join(privateRoot, "source-a");
      const testCopy = path.join(privateRoot, "trivy-test"); cpSync(sourceA, testCopy, { recursive: true, verbatimSymlinks: true });
      const rpmDestination = path.join(testCopy, "pkg/fanal/analyzer/pkg/rpm/testdata/socat-1.7.3.2-2.el7.x86_64.rpm"); mkdirSync(path.dirname(rpmDestination), { recursive: true }); copyFileSync(path.join(ROOT, lock.fixtures.rpm.path), rpmDestination); assertIdentity(rpmDestination, lock.fixtures.rpm, MiB);
      const gitParent = path.join(testCopy, "internal/gittest/testdata"); const gitDestination = path.join(gitParent, "test-repo"); mkdirSync(gitParent, { recursive: true });
      const listing = run("/usr/bin/tar", ["-tzf", path.join(ROOT, lock.fixtures.git.path)], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8");
      const verbose = run("/usr/bin/tar", ["-tvzf", path.join(ROOT, lock.fixtures.git.path), "--numeric-owner"], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8");
      const gitFixtureMembers = validateGitArchiveListing(listing, verbose);
      run("/usr/bin/tar", ["-xzf", path.join(ROOT, lock.fixtures.git.path), "-C", gitParent, "--no-same-owner", "--no-same-permissions"], { timeoutMs: bounded(60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, "git-fixture-extract.log") });
      const gitFixtureManifest = manifestTree(gitDestination, 16 * MiB);
      const gitCommit = run("/usr/bin/git", ["-C", gitDestination, "rev-parse", "main"], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8").trim();
      const gitBranch = run("/usr/bin/git", ["-C", gitDestination, "rev-parse", "valid-branch"], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8").trim();
      const gitTag = run("/usr/bin/git", ["-C", gitDestination, "rev-parse", "v0.0.1^{}"], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8").trim();
      const gitTree = run("/usr/bin/git", ["-C", gitDestination, "rev-parse", `${gitCommit}^{tree}`], { timeoutMs: bounded(60_000), maxBytes: MiB }).stdout.toString("utf8").trim();
      if ([gitCommit, gitBranch, gitTag].some((item) => item !== lock.fixtures.git.commit) || gitTree !== lock.fixtures.git.tree) fail("scanner_owned_git_fixture_invalid");
      const future = new Date(Date.now() + 60_000); utimesSync(rpmDestination, future, future); utimesSync(gitDestination, future, future);
      const before = manifestTree(testCopy, lock.limits.sourceTreeBytes, { trivySource: true });
      const rustRoot = path.join(privateRoot, "rust-controls"); mkdirSync(rustRoot, { mode: 0o755 });
      for (const [index, fixture] of lock.fixtures.rust.entries()) { const sourceFile = path.join(testCopy, fixture.path); assertIdentity(sourceFile, fixture, MiB); const destination = path.join(rustRoot, String(index + 1), "Cargo.lock"); mkdirSync(path.dirname(destination), { mode: 0o755 }); copyFileSync(sourceFile, destination); chmodSync(destination, 0o644); assertIdentity(destination, fixture, MiB); }
      const testArgs = ["run", "--rm", "--platform", "linux/amd64", "--user", runnerUser, "--network", "none", "--pull=never", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "4096", "--memory", "4g", "--memory-swap", "4g",
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=2g", "-v", mount(testCopy, "/src"), "-v", mount(path.join(privateRoot, "gomodcache-a"), "/gomodcache", true),
        "-v", mount(path.join(privateRoot, "test-cache"), "/test-cache"), "-w", "/src", "-e", "GOMODCACHE=/gomodcache", "-e", "GOCACHE=/test-cache/gocache", "-e", "GOTMPDIR=/test-cache/tmp",
        "-e", "GOPATH=/test-cache/gopath", "-e", "GOBIN=/test-cache/bin", "-e", "MAGEFILE_CACHE=/test-cache/mage", "-e", "HOME=/test-cache/home", "-e", "GOTOOLCHAIN=local", "-e", "GOPROXY=off", "-e", "GOSUMDB=off", "-e", "GONOSUMDB=", "-e", "GONOPROXY=", "-e", "GOPRIVATE=", "-e", "GOENV=off", "-e", "GOWORK=off", "-e", "CGO_ENABLED=0",
        lock.compiler.builder.reference, "/bin/sh", "-euc", "mkdir -p /test-cache/gocache /test-cache/tmp /test-cache/gopath /test-cache/bin /test-cache/mage /test-cache/home; go install -mod=readonly github.com/magefile/mage; /test-cache/bin/mage -v test:unit"];
      mkdirSync(path.join(privateRoot, "test-cache"));
      const trivyLog = path.join(privateLogs, "trivy-unit.log");
      containers.execute(testArgs, { timeoutMs: bounded(55 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: trivyLog });
      directoryBytes(path.join(privateRoot, "test-cache"), lock.limits.buildCacheBytes);
      const after = manifestTree(testCopy, lock.limits.sourceTreeBytes, { trivySource: true });
      const beforeMap = new Map(before.map((item) => [item.path, item]));
      const afterMap = new Map(after.map((item) => [item.path, item]));
      const allowed = [/^pkg\/module\/testdata\/(?:analyzer\/analyzer|happy\/happy|scanner\/scanner)\.wasm$/u, /^coverage\.txt$/u];
      const changes = after.filter((item) => !beforeMap.has(item.path) || canonicalJson(beforeMap.get(item.path)) !== canonicalJson(item)).map((item) => item.path);
      if (changes.some((item) => !allowed.some((rule) => rule.test(item))) || before.some((item) => !afterMap.has(item.path))) fail("scanner_owned_test_tree_changed");
      for (const expected of ["pkg/module/testdata/analyzer/analyzer.wasm", "pkg/module/testdata/happy/happy.wasm", "pkg/module/testdata/scanner/scanner.wasm", "coverage.txt"]) if (!after.some((item) => item.path === expected)) fail("scanner_owned_test_output_missing");

      const jose = path.join(privateRoot, "go-jose");
      const joseLicense = fileIdentity(path.join(jose, "LICENSE"), MiB);
      const joseArgs = ["run", "--rm", "--platform", "linux/amd64", "--user", runnerUser, "--network", "none", "--pull=never", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "4096", "--memory", "4g", "--memory-swap", "4g", "-v", mount(jose, "/src", true), "-w", "/src",
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=1g", "-e", "CGO_ENABLED=0", "-e", "GOOS=linux", "-e", "GOARCH=amd64", "-e", "GOAMD64=v1", "-e", "GOTOOLCHAIN=local", "-e", "GOPROXY=off", "-e", "GOSUMDB=off", "-e", "GONOSUMDB=", "-e", "GONOPROXY=", "-e", "GOPRIVATE=", "-e", "GOENV=off", "-e", "GOWORK=off",
        lock.compiler.builder.reference, "/bin/sh", "-euc", "mkdir -p /tmp/home /tmp/cache /tmp/work; HOME=/tmp/home GOCACHE=/tmp/cache GOTMPDIR=/tmp/work go test -mod=readonly -count=1 ./..."];
      const joseLog = path.join(privateLogs, "jose-tests.log");
      containers.execute(joseArgs, { timeoutMs: bounded(15 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: joseLog });
      assertIdentity(path.join(jose, "go.mod"), lock.goJose.goMod, MiB); assertIdentity(path.join(jose, "go.sum"), lock.goJose.goSum, MiB, { allowEmpty: true });
      const decodeLog = (file) => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file)).replaceAll("\r\n", "\n");
      const trivyText = decodeLog(trivyLog); const joseText = decodeLog(joseLog);
      writePublicJson(output, "tests.json", { schemaVersion: 1,
        trivy: { result: "PASSED", passedTests: (trivyText.match(/^--- PASS:/gmu) ?? []).length, passedPackages: (trivyText.match(/^ok\s+/gmu) ?? []).length,
          privateLog: fileIdentity(trivyLog, 2 * lock.limits.childStreamBytes), generated: after.filter((item) => allowed.some((rule) => rule.test(item.path))) },
        goJose: { result: "PASSED", commit: lock.goJose.commit, tree: lock.goJose.tree, license: joseLicense, passedPackages: (joseText.match(/^ok\s+/gmu) ?? []).length,
          privateLog: fileIdentity(joseLog, 2 * lock.limits.childStreamBytes) }, gitFixture: { commit: gitCommit, tree: gitTree, members: gitFixtureMembers, files: gitFixtureManifest }, rpm: lock.fixtures.rpm }, publicFiles, lock.limits);
      removeOwnedScannerPaths(privateRoot, runnerTemp, ["trivy-test", "test-cache", "go-jose"]);
    });

    const built = stage(budget, journal, "build-pair", lock.limits.buildPairMs, (timeoutMs) => {
      const bounded = (cap) => Math.min(timeoutMs, budget.commandTimeoutMs(cap));
      const outputs = {};
      for (const letter of ["a", "b"]) { outputs[letter] = path.join(privateRoot, `out-${letter}`); mkdirSync(outputs[letter], { mode: 0o755 }); }
      containers.execute(ownedBuildDockerArguments({ lock, source: path.join(privateRoot, "source-a"), moduleCache: path.join(privateRoot, "gomodcache-a"), buildCache: path.join(privateRoot, "gocache-a"), output: outputs.a, user: runnerUser }), { timeoutMs: bounded(20 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, "build-a.log") });
      containers.execute(ownedBuildDockerArguments({ lock, source: path.join(privateRoot, "source-b"), moduleCache: path.join(privateRoot, "gomodcache-b"), buildCache: path.join(privateRoot, "gocache-b"), output: outputs.b, user: runnerUser, officialGoRoot: path.join(privateRoot, "official-go") }), { timeoutMs: bounded(20 * 60_000), maxBytes: lock.limits.childStreamBytes, logFile: path.join(privateLogs, "build-b.log") });
      for (const letter of ["a", "b"]) directoryBytes(path.join(privateRoot, `gocache-${letter}`), lock.limits.buildCacheBytes);
      const binaryA = path.join(outputs.a, "trivy"); const binaryB = path.join(outputs.b, "trivy");
      chmodSync(binaryA, 0o555); chmodSync(binaryB, 0o555);
      const identityA = fileIdentity(binaryA, lock.limits.binaryBytes); const identityB = fileIdentity(binaryB, lock.limits.binaryBytes);
      if (canonicalJson(identityA) !== canonicalJson(identityB)) fail("scanner_owned_reproducibility_failed");
      const buildInfo = {};
      for (const letter of ["a", "b"]) {
        const officialGoRoot = letter === "b" ? path.join(privateRoot, "official-go") : null;
        const args = ownedBuildDockerArguments({ lock, source: path.join(privateRoot, `source-${letter}`), moduleCache: path.join(privateRoot, `gomodcache-${letter}`), buildCache: path.join(privateRoot, `gocache-${letter}`), output: outputs[letter], user: runnerUser, officialGoRoot });
        args[args.length - 1] = "go version -m /out/trivy";
        buildInfo[letter] = containers.execute(args, { timeoutMs: bounded(2 * 60_000), maxBytes: lock.limits.childStreamBytes }).stdout.toString("utf8");
      }
      if (buildInfo.a !== buildInfo.b) fail("scanner_owned_build_info_mismatch");
      const closureA = JSON.parse(readFileSync(path.join(evidence, "closure-a.json"), "utf8")); const closureB = JSON.parse(readFileSync(path.join(evidence, "closure-b.json"), "utf8"));
      if (canonicalJson(closureA) !== canonicalJson(closureB)) fail("scanner_owned_module_closure_mismatch");
      return { binaryA, binaryB, identityA, buildInfo, closureA, closureB };
    });
    const releasedPrivateResources = ["source-base", "patched-source.tar.gz", "go1.27.3.tar.gz", "source-a", "source-b", "gomodcache-a", "gomodcache-b", "gocache-a", "gocache-b", "official-go", "evidence", "docker-home"];
    stage(budget, journal, "release-private", 5 * 60_000, () => {
      if (containers.liveCount() !== 0) fail("scanner_owned_container_cleanup_uncertain");
      removeOwnedScannerPaths(privateRoot, runnerTemp, releasedPrivateResources);
      if (releasedPrivateResources.some((relative) => existsSync(path.join(privateRoot, relative)))) fail("scanner_owned_private_resource_cleanup_uncertain");
      return true;
    });
    const receiptA = buildReceipt({ construction: "A", run: runValue, lock, binary: built.binaryA, rawBuildInfo: built.buildInfo.a, closure: built.closureA, journal });
    const receiptB = buildReceipt({ construction: "B", run: runValue, lock, binary: built.binaryB, rawBuildInfo: built.buildInfo.b, closure: built.closureB, journal });
    const reproducibility = { schemaVersion: 1, receiptKind: RECEIPT_KIND, state: "BUILD_DIAGNOSTIC", run: runValue, binary: built.identityA,
      rawBuildInfoSha256: sha256(Buffer.from(built.buildInfo.a)), closureSha256: built.closureA.sha256, equal: true };
    writePublicJson(output, "build-a.json", receiptA, publicFiles, lock.limits); writePublicJson(output, "build-b.json", receiptB, publicFiles, lock.limits); writePublicJson(output, "reproducibility.json", reproducibility, publicFiles, lock.limits);
    returnValue = { kind: RECEIPT_KIND, lifecycleState: "BUILT_DIAGNOSTIC", candidatePath: built.binaryA, duplicatePath: built.binaryB, binaryAPath: built.binaryA, binaryBPath: built.binaryB,
      rawBuildInfo: { A: built.buildInfo.a, B: built.buildInfo.b }, closure: { A: built.closureA, B: built.closureB }, receipts: { buildA: receiptA, buildB: receiptB, reproducibility },
      measured: { binarySha256: built.identityA.sha256, binaryBytes: built.identityA.bytes, rawBuildInfoSha256: reproducibility.rawBuildInfoSha256, moduleClosureSha256: built.closureA.sha256 },
      releasedPrivateResources: releasedPrivateResources.map((relative) => ({ path: relative, absent: true })),
      controlFixturePaths: lock.fixtures.rust.map((fixture, index) => ({ ...fixture, sourcePath: fixture.path, path: path.join(privateRoot, "rust-controls", String(index + 1), "Cargo.lock") })) };
  } catch (error) {
    firstFailure = error;
  }
  if (firstFailure) {
    let cleanupFailure;
    try { runOwnedFinalCleanup({ beginCleanup: budget.beginCleanup, cleanupContainers: containers.cleanupAll, cleanupPaths: () => removeOwnedScannerPaths(privateRoot, runnerTemp) }); }
    catch (error) { cleanupFailure = error; firstFailure.cleanupError = error; }
    const ownedCleanup = ownedCleanupEvidence(cleanupFailure, containers.liveCount() === 0 && !existsSync(privateRoot));
    firstFailure.ownedCleanup = ownedCleanup;
    try {
      writePublicJson(output, "result.json", ownedFailureResult({ run: runValue, primary: firstFailure, cleanup: ownedCleanup,
        budget: budget.snapshot(), journal }), publicFiles, lock.limits);
      publicDirectory.manifest = writePublicManifest(output, runValue, publicFiles, lock.limits);
    } catch (error) { firstFailure.publicEvidenceError = error; }
    firstFailure.ownedPublicDirectory = publicDirectory;
    throw firstFailure;
  }
  try {
    writePublicJson(output, "result.json", { schemaVersion: 1, receiptKind: RECEIPT_KIND, state: "BUILD_DIAGNOSTIC", result: "PASSED", run: runValue, budget: budget.snapshot(), journal }, publicFiles, lock.limits);
    publicDirectory.manifest = writePublicManifest(output, runValue, publicFiles, lock.limits);
  } catch (error) {
    let cleanupFailure;
    try { runOwnedFinalCleanup({ beginCleanup: budget.beginCleanup, cleanupContainers: containers.cleanupAll, cleanupPaths: () => removeOwnedScannerPaths(privateRoot, runnerTemp) }); }
    catch (cleanupError) { cleanupFailure = cleanupError; error.cleanupError = cleanupError; }
    error.ownedCleanup = ownedCleanupEvidence(cleanupFailure, containers.liveCount() === 0 && !existsSync(privateRoot));
    error.ownedPublicDirectory = publicDirectory;
    throw error;
  }
  const cleanupDuplicate = () => removeOwnedScannerPaths(privateRoot, runnerTemp, ["out-b"]);
  const cleanupAll = () => runOwnedFinalCleanup({ beginCleanup: budget.beginCleanup, cleanupContainers: containers.cleanupAll, cleanupPaths: () => removeOwnedScannerPaths(privateRoot, runnerTemp) });
  const verify = () => !existsSync(privateRoot);
  return Object.freeze({ ...returnValue, publicDirectory: Object.freeze(publicDirectory), cleanup: Object.freeze({ ownedPaths: [privateRoot], cleanupDuplicate, cleanupAll, verify }) });
}
