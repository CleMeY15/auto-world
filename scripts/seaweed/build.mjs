import { createHash } from "node:crypto";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmSync, statfsSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { stableModuleClosure } from "../scanner/build.mjs";
import { runMonitoredCommand as defaultRunner } from "./command-monitor.mjs";
export { commandMonitorScript, runMonitoredCommand } from "./command-monitor.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LOCK_PATH = path.join(ROOT, "infra/seaweed/seaweed-lock.json");
const DEFAULT_WORK = "/tmp/auto-world-seaweed-source-diagnostic";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function identity(file, cap = 2 * 1024 ** 3) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > cap) throw new Error("seaweed_material_invalid");
  const bytes = readFileSync(file);
  return { sha256: sha256(bytes), size: bytes.length };
}

function fileIdentity(file, cap = 2 * 1024 ** 3) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > cap) throw new Error("seaweed_artifact_invalid");
  const bytes = readFileSync(file);
  return { sha256: sha256(bytes), size: bytes.length };
}

export function canonicalMaterial(bytes, descriptor) {
  if (!Buffer.isBuffer(bytes)) throw new Error("seaweed_material_invalid");
  if (bytes.length !== descriptor.size || sha256(bytes) !== descriptor.sha256) throw new Error("seaweed_material_changed");
  return bytes;
}

export function validateSeaweedLock(lock) {
  const digest = /^[a-f0-9]{64}$/u;
  if (lock?.schemaVersion !== 1 || lock.state !== "diagnostic_only" || lock.source?.commit !== "c5073360007d28385a33426a42ac3e4ec504c5a3" ||
      lock.source?.tree !== "bce9e3f66721208f35888124183f80bd76d64f90" || lock.source?.version !== "4.47" ||
      lock.source?.commitUnixTime !== 1789349515 || lock.source?.shallowBoundary?.sha256 !== "85485d485c3fb431c98532676da79828422e8b94102790984f473d14c8fc6300" ||
      lock.source?.shallowBoundary?.size !== 41 || lock.source?.bundleMaximumBytes !== 256 * 1024 ** 2 ||
      lock.compiler?.version !== "1.26.8" || !digest.test(lock.compiler?.sha256 ?? "") || lock.patch?.size !== 12782 ||
      lock.patch?.sha256 !== "804c8ac03c3e4e01de04c102ace1ad73186116de983b451f01056e4600f24168" ||
      lock.requiredTests?.sha256 !== "d8a5b9f48011d6a3b1ef89ac9824dbf8f116fd7dc05b46b1c8dca49464ee221a" || lock.requiredTests?.size !== 6134 ||
      lock.moduleChanges?.count !== 8 || lock.grpc?.version !== "v1.85.0-dev.0.20260825072537-93e31b48545e" ||
      lock.build?.goos !== "linux" || lock.build?.goarch !== "amd64" || lock.build?.goamd64 !== "v1" || lock.build?.cgoEnabled !== "0" ||
      !Array.isArray(lock.build?.tags) || lock.build.tags.length !== 0 || lock.build?.commitValue !== "c507336+aw.804c8ac03c3e" ||
      lock.build?.ldflags !== "-extldflags -static -X github.com/seaweedfs/seaweedfs/weed/util/version.COMMIT=c507336+aw.804c8ac03c3e" ||
      lock.limits?.innerDeadlineMs > 85 * 60_000 || lock.limits?.retainedBytes !== 2 * 1024 ** 3 || lock.limits?.workBytes !== 12 * 1024 ** 3 ||
      lock.limits?.minimumFreeBytes !== 1024 ** 3 || lock.limits?.logBytes !== 64 * 1024 ** 2 || lock.limits?.aggregateLogBytes !== 128 * 1024 ** 2 ||
      !Array.isArray(lock.upstreamMaterials) || lock.upstreamMaterials.length !== 5 || lock.redis?.subject !== "redis@sha256:76961cd2a0f40ef6fdd334b6b1b3a76a2bad1848d89f3030ca30a7521d4a9493" ||
      !Array.isArray(lock.redis.requiredTests) || lock.redis.requiredTests.length !== 15 || !Array.isArray(lock.grpcProjectTests) || lock.grpcProjectTests.length !== 12) {
    throw new Error("seaweed_lock_invalid");
  }
  return lock;
}

export function parseArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--repeat" || !["1", "2"].includes(argv[1]) || argv[2] !== "--output" || !path.isAbsolute(argv[3])) {
    throw new Error("seaweed_arguments_invalid");
  }
  return { output: path.resolve(argv[3]), repeat: Number(argv[1]) };
}

export function clippedTimeout({ deadlineMs, finalizationReserveMs }, elapsedMs, requestedMs) {
  const remaining = deadlineMs - finalizationReserveMs - elapsedMs;
  if (!Number.isSafeInteger(remaining) || remaining < 1) throw new Error("seaweed_inner_deadline_exceeded");
  return Math.min(requestedMs, remaining);
}

export function clippedFinalizationTimeout({ deadlineMs }, elapsedMs, requestedMs) {
  const remaining = deadlineMs - elapsedMs;
  if (!Number.isSafeInteger(remaining) || remaining < 1) throw new Error("seaweed_inner_deadline_exceeded");
  return Math.min(requestedMs, remaining);
}

function treeBytes(directory, cap, rejectSymlinks = true) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const info = lstatSync(absolute);
    if (rejectSymlinks && info.isSymbolicLink()) throw new Error("seaweed_symlink_invalid");
    total += info.isDirectory() ? treeBytes(absolute, cap - total, rejectSymlinks) : info.size;
    if (total > cap) throw new Error("seaweed_artifact_budget_exceeded");
  }
  return total;
}

export function assertResourceBudget({ workBytes, retainedBytes, freeBytes, logBytes, limits }) {
  if (workBytes + retainedBytes > limits.workBytes) throw new Error("seaweed_work_budget_exceeded");
  if (retainedBytes > limits.retainedBytes) throw new Error("seaweed_retained_budget_exceeded");
  if (freeBytes < limits.minimumFreeBytes) throw new Error("seaweed_free_space_reserve_failed");
  if (logBytes > limits.aggregateLogBytes) throw new Error("seaweed_log_budget_exceeded");
}

export function removeOwnedTree(work, root = "/tmp") {
  const target = path.resolve(work);
  if (target !== path.join(path.resolve(root), "auto-world-seaweed-source-diagnostic") || !existsSync(target) || lstatSync(target).isSymbolicLink() || realpathSync(target) !== target) {
    throw new Error("seaweed_cleanup_path_invalid");
  }
  const makeWritable = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("seaweed_cleanup_symlink_invalid");
      if (entry.isDirectory()) makeWritable(absolute);
      chmodSync(absolute, entry.isDirectory() ? 0o700 : 0o600);
    }
  };
  makeWritable(target);
  rmSync(target, { recursive: true, force: false });
}

function jsonSequence(bytes) {
  const text = bytes.toString("utf8");
  const records = [];
  let start = -1; let depth = 0; let quoted = false; let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") { if (depth === 0) start = index; depth += 1; }
    else if (char === "}") { depth -= 1; if (depth === 0) records.push(JSON.parse(text.slice(start, index + 1))); }
    else if (depth === 0 && !/\s/u.test(char)) throw new Error("seaweed_module_output_invalid");
    if (depth < 0) throw new Error("seaweed_module_output_invalid");
  }
  if (depth !== 0 || quoted || records.length < 1) throw new Error("seaweed_module_output_invalid");
  return records;
}

export function validateBuildInfo(value, lock, binary = `${DEFAULT_WORK}/bin/weed`) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 8 * 1024 ** 2) throw new Error("seaweed_build_info_invalid");
  const lines = value.split(/\r?\n/u).map((line) => line.trimStart());
  if (lines[0] !== `${binary}: go${lock.compiler.version}`) throw new Error("seaweed_build_info_invalid");
  const grpc = lines.filter((line) => line.startsWith("dep\tgoogle.golang.org/grpc\t"));
  if (grpc.length !== 1 || JSON.stringify(grpc[0].split("\t")) !== JSON.stringify(["dep", "google.golang.org/grpc", lock.grpc.version, lock.grpc.sum])) throw new Error("seaweed_build_info_invalid");
  const exact = new Map([
    ["CGO_ENABLED", "0"], ["GOARCH", "amd64"], ["GOOS", "linux"], ["GOAMD64", "v1"],
    ["vcs.revision", lock.source.commit], ["vcs.modified", "true"], ["-compiler", "gc"], ["-ldflags", JSON.stringify(lock.build.ldflags)],
  ]);
  for (const [key, expected] of exact) {
    const prefix = `build\t${key}=`; const matches = lines.filter((line) => line.startsWith(prefix));
    if (matches.length !== 1 || matches[0].slice(prefix.length) !== expected) throw new Error("seaweed_build_info_invalid");
  }
  if (lines.some((line) => line.startsWith("build\t-tags="))) throw new Error("seaweed_build_tags_invalid");
  return true;
}

export function validateArtifactAllowlist(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || new Set(paths).size !== paths.length) throw new Error("seaweed_artifact_allowlist_invalid");
  const exact = new Set(["weed", "go-build-info.txt", "module-closure.json", "test-summary.json", "material-inventory.json", "build-receipt.json"]);
  const patterns = [
    /^logs\/\d{2}-[a-z0-9_]+\.log$/u,
    /^materials\/(?:go1\.26\.8\.linux-amd64\.tar\.gz|seaweedfs-source\.bundle|seaweedfs-source-shallow\.txt|seaweedfs-grpc\.patch|module-changes\.tsv|required-tests\.json|DERIVATIVE-NOTICE\.txt)$/u,
    /^materials\/upstream\/(?:LICENSE|weed\/glog\/LICENSE|docker\/Dockerfile\.go_build|\.github\/workflows\/(?:go|container_release_unified)\.yml)$/u,
    /^materials\/modules\/[a-f0-9]{64}\/(?:source\.zip|module\.(?:mod|info)|notice-\d{3}\.txt)$/u,
  ];
  for (const item of paths) {
    if (typeof item !== "string" || item.includes("\\") || item.startsWith("/") || item.includes("../") || (!exact.has(item) && !patterns.some((pattern) => pattern.test(item)))) {
      throw new Error("seaweed_artifact_allowlist_invalid");
    }
  }
  return true;
}

function artifactInventory(directory) {
  const entries = [];
  const walk = (current, relative = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name); const name = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("seaweed_symlink_invalid");
      if (entry.isDirectory()) walk(absolute, name); else entries.push({ path: name, ...fileIdentity(absolute) });
    }
  };
  walk(directory); return entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

export function validateArtifactDirectory(directory, limits = validateSeaweedLock(JSON.parse(readFileSync(LOCK_PATH))).limits) {
  const root = path.resolve(directory);
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory() || realpathSync(root) !== root) throw new Error("seaweed_artifact_directory_invalid");
  const entries = artifactInventory(root); const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const logTotal = entries.filter((entry) => entry.path.startsWith("logs/")).reduce((sum, entry) => sum + entry.size, 0);
  if (total > limits.retainedBytes || logTotal > limits.aggregateLogBytes || entries.some((entry) => entry.path.startsWith("logs/") && entry.size > limits.logBytes)) throw new Error("seaweed_artifact_budget_exceeded");
  const receipt = JSON.parse(readFileSync(path.join(root, "build-receipt.json"), "utf8"));
  if (receipt?.schemaVersion !== 1 || !["PASSED", "FAILED"].includes(receipt.result)) throw new Error("seaweed_artifact_receipt_invalid");
  if (receipt.result === "FAILED") {
    if (entries.some((entry) => entry.path !== "build-receipt.json" && !/^logs\/\d{2}-[a-z0-9_]+\.log$/u.test(entry.path))) throw new Error("seaweed_failed_artifact_unsafe");
    return { result: "FAILED", totalBytes: total };
  }
  const recorded = JSON.parse(readFileSync(path.join(root, "material-inventory.json"), "utf8"));
  if (!Array.isArray(recorded) || new Set(recorded.map((entry) => entry.path)).size !== recorded.length) throw new Error("seaweed_artifact_inventory_invalid");
  validateArtifactAllowlist(recorded.map((entry) => entry.path));
  const actual = new Map(entries.map((entry) => [entry.path, entry]));
  validateArtifactAllowlist(entries.map((entry) => entry.path));
  const expectedSet = [...recorded.map((entry) => entry.path), "build-receipt.json", "material-inventory.json"].sort();
  if (JSON.stringify([...actual.keys()].sort()) !== JSON.stringify(expectedSet)) throw new Error("seaweed_artifact_set_changed");
  for (const expected of recorded) {
    const found = actual.get(expected.path);
    if (!found || found.sha256 !== expected.sha256 || found.size !== expected.size) throw new Error("seaweed_artifact_inventory_changed");
  }
  for (const required of ["weed", "go-build-info.txt", "module-closure.json", "test-summary.json", "materials/go1.26.8.linux-amd64.tar.gz", "materials/seaweedfs-source.bundle", "materials/seaweedfs-source-shallow.txt", "materials/seaweedfs-grpc.patch", "materials/module-changes.tsv", "materials/required-tests.json", "materials/DERIVATIVE-NOTICE.txt", "materials/upstream/LICENSE", "materials/upstream/weed/glog/LICENSE", "materials/upstream/docker/Dockerfile.go_build", "materials/upstream/.github/workflows/go.yml", "materials/upstream/.github/workflows/container_release_unified.yml"]) {
    if (!actual.has(required)) throw new Error("seaweed_artifact_required_missing");
  }
  const modules = JSON.parse(readFileSync(path.join(root, "module-closure.json"), "utf8"));
  if (!Array.isArray(modules) || modules.length < 1) throw new Error("seaweed_artifact_module_closure_invalid");
  let grpcLicense = false; let grpcNotice = false;
  for (const module of modules) {
    if (!/^[a-f0-9]{64}$/u.test(module?.id ?? "") || !Array.isArray(module.notices) || typeof module.files !== "object") throw new Error("seaweed_artifact_module_closure_invalid");
    for (const [name, descriptor] of Object.entries(module.files)) {
      const found = actual.get(`materials/modules/${module.id}/${name}`);
      if (!found || found.sha256 !== descriptor.sha256 || found.size !== descriptor.size) throw new Error("seaweed_artifact_required_missing");
    }
    for (const notice of module.notices) {
      const found = actual.get(`materials/modules/${module.id}/${notice.file}`);
      if (!found || found.sha256 !== notice.sha256 || found.size !== notice.size) throw new Error("seaweed_artifact_required_missing");
    }
    if (module.path === "google.golang.org/grpc") {
      grpcLicense = module.notices.some((notice) => path.posix.basename(notice.archiveEntry).toLowerCase() === "license");
      grpcNotice = module.notices.some((notice) => path.posix.basename(notice.archiveEntry).toLowerCase() === "notice.txt");
    }
  }
  if (!grpcLicense || !grpcNotice) throw new Error("seaweed_grpc_notices_missing");
  return { result: "PASSED", totalBytes: total };
}

export function summarizeGoTestJson(bytes, required) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 64 * 1024 ** 2 || !Array.isArray(required) || required.length < 1) throw new Error("seaweed_test_output_invalid");
  const events = bytes.toString("utf8").trim().split("\n").map((line) => {
    try { return JSON.parse(line); } catch { throw new Error("seaweed_test_output_invalid"); }
  });
  const terminal = new Map(); const skips = [];
  for (const event of events) {
    if (typeof event.Package !== "string" || typeof event.Action !== "string") continue;
    if (typeof event.Test === "string" && ["pass", "fail", "skip"].includes(event.Action)) {
      const key = `${event.Package}:${event.Test}`;
      terminal.set(key, event.Action);
      if (event.Action === "skip") skips.push(key);
    }
  }
  for (const requirement of required) {
    const matches = requirement.includes(":") ? [requirement] : [...terminal.keys()].filter((key) => key.endsWith(`:${requirement}`));
    if (matches.length !== 1 || terminal.get(matches[0]) !== "pass") throw new Error("seaweed_required_test_failed");
  }
  return { requiredPassed: required.length, skips: [...new Set(skips)].sort() };
}

export function validateFinalModuleClosure(initial, final, lock) {
  if (!Array.isArray(initial) || !Array.isArray(final) || JSON.stringify(final) !== JSON.stringify(initial)) throw new Error("seaweed_module_closure_changed");
  const grpc = final.filter((entry) => entry.path === "google.golang.org/grpc");
  if (grpc.length !== 1 || grpc[0].version !== lock.grpc.version || grpc[0].sum !== lock.grpc.sum || grpc[0].goModSum !== lock.grpc.goModSum) throw new Error("seaweed_grpc_module_invalid");
  return grpc[0];
}

export function validatePostTestState(initialClosure, finalClosure, moduleFiles, lock) {
  const grpc = validateFinalModuleClosure(initialClosure, finalClosure, lock);
  if (JSON.stringify(moduleFiles) !== JSON.stringify(lock.moduleFiles.after)) throw new Error("seaweed_module_files_changed");
  return grpc;
}

const MODULE_ISOLATION_STEPS = ["module_download", "module_verify", "post_test_module_download", "post_test_module_verify"];

function checkedModuleDirectory(directory, expectedParent, expectedName) {
  const resolved = path.resolve(directory);
  if (resolved !== path.join(path.resolve(expectedParent), expectedName) || !existsSync(resolved) || lstatSync(resolved).isSymbolicLink() ||
      !lstatSync(resolved).isDirectory() || realpathSync(resolved) !== resolved) throw new Error("seaweed_module_isolation_path_invalid");
  return resolved;
}

function goSumLines(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 8 * 1024 ** 2 || bytes.at(-1) !== 0x0a) throw new Error("seaweed_module_isolation_sum_invalid");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("seaweed_module_isolation_sum_invalid"); }
  const lines = text.trimEnd().split("\n");
  if (lines.some((line) => !/^\S+ \S+ h1:[A-Za-z0-9+/]{43}=$/u.test(line)) || new Set(lines).size !== lines.length) throw new Error("seaweed_module_isolation_sum_invalid");
  return lines;
}

function canonicalModuleFile(file, descriptor) {
  const actual = identity(file, 8 * 1024 ** 2);
  if (JSON.stringify(actual) !== JSON.stringify({ sha256: descriptor.sha256, size: descriptor.size })) throw new Error("seaweed_material_changed");
  return readFileSync(file);
}

export function createModuleIsolation(sourceDirectory, workDirectory, lock) {
  const work = checkedModuleDirectory(workDirectory, path.dirname(path.resolve(workDirectory)), "auto-world-seaweed-source-diagnostic");
  const source = checkedModuleDirectory(sourceDirectory, work, "source");
  const modFile = path.join(work, "module-isolation.mod"); const sumFile = path.join(work, "module-isolation.sum");
  if (existsSync(modFile) || existsSync(sumFile)) throw new Error("seaweed_module_isolation_path_invalid");
  const sourceMod = canonicalModuleFile(path.join(source, "go.mod"), lock.moduleFiles.after["go.mod"]);
  const sourceSum = canonicalModuleFile(path.join(source, "go.sum"), lock.moduleFiles.after["go.sum"]);
  writeFileSync(modFile, sourceMod, { flag: "wx", mode: 0o600 }); writeFileSync(sumFile, sourceSum, { flag: "wx", mode: 0o600 });
  return { source, work, modFile, sumFile, modIdentity: materialIdentity(sourceMod), originalSumLines: goSumLines(sourceSum) };
}

export function moduleIsolationArguments(step, modFile) {
  if (!MODULE_ISOLATION_STEPS.includes(step) || !path.isAbsolute(modFile) || path.basename(modFile) !== "module-isolation.mod" ||
      path.basename(path.dirname(modFile)) !== "auto-world-seaweed-source-diagnostic") throw new Error("seaweed_module_isolation_arguments_invalid");
  return step.endsWith("download") ? ["mod", "download", `-modfile=${modFile}`, "-json", "all"] : ["mod", "verify", `-modfile=${modFile}`];
}

export function validateModuleIsolationCheckpoint(state, lock, step) {
  if (!MODULE_ISOLATION_STEPS.includes(step) || state?.modFile !== path.join(state.work ?? "", "module-isolation.mod") ||
      state?.sumFile !== path.join(state.work ?? "", "module-isolation.sum")) throw new Error("seaweed_module_isolation_path_invalid");
  const work = checkedModuleDirectory(state.work, path.dirname(path.resolve(state.work)), "auto-world-seaweed-source-diagnostic");
  const source = checkedModuleDirectory(state.source, work, "source");
  canonicalModuleFile(path.join(source, "go.mod"), lock.moduleFiles.after["go.mod"]);
  canonicalModuleFile(path.join(source, "go.sum"), lock.moduleFiles.after["go.sum"]);
  const mod = identity(state.modFile, 8 * 1024 ** 2);
  if (JSON.stringify(mod) !== JSON.stringify(state.modIdentity)) throw new Error("seaweed_module_isolation_mod_changed");
  const sum = identity(state.sumFile, 8 * 1024 ** 2); const sumBytes = readFileSync(state.sumFile); const sumLines = goSumLines(sumBytes); const present = new Set(sumLines);
  if (state.originalSumLines.some((line) => !present.has(line))) throw new Error("seaweed_module_isolation_sum_invalid");
  return { name: step, result: "PASSED", source: "UNCHANGED", alternateMod: "UNCHANGED", alternateSum: sum, additionalSumLines: sumLines.length - state.originalSumLines.length };
}

export function validateShallowBoundary(bytes, lock) {
  if (!canonicalMaterial(bytes, lock.source.shallowBoundary).equals(Buffer.from(`${lock.source.commit}\n`, "utf8"))) throw new Error("seaweed_shallow_boundary_invalid");
  return true;
}

export function validateRestoredSource(actual, lock) {
  if (actual?.fsck !== "PASSED" || actual.head !== lock.source.commit || actual.tree !== lock.source.tree || actual.commitUnixTime !== String(lock.source.commitUnixTime) ||
      JSON.stringify(actual.pristine) !== JSON.stringify(lock.moduleFiles.before) || JSON.stringify(actual.corrected) !== JSON.stringify(lock.moduleFiles.after) ||
      JSON.stringify(actual.changed) !== JSON.stringify(["go.mod", "go.sum"])) throw new Error("seaweed_source_restore_invalid");
  return true;
}

export function validateVersionOutput(value, lock) {
  if (value !== `version 30GB ${lock.source.version} ${lock.build.commitValue} linux amd64`) throw new Error("seaweed_version_output_invalid");
  return true;
}

function commandEnvironment(work, go, test = false) {
  return {
    CGO_ENABLED: test ? "1" : "0", GOARCH: "amd64", GOENV: "off", GOEXPERIMENT: "", GOFLAGS: "-mod=readonly", GOAMD64: "v1",
    GOCACHE: path.join(work, "gocache"), GOMAXPROCS: "2", GOMODCACHE: path.join(work, "gomodcache"), GOOS: "linux",
    GOPATH: path.join(work, "gopath"), GOPROXY: "https://proxy.golang.org", GOSUMDB: "sum.golang.org", GOTOOLCHAIN: "local", GOWORK: "off",
    HOME: path.join(work, "home"), LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: `${path.dirname(go)}:/usr/local/bin:/usr/bin:/bin`,
    REDIS_ADDR: "127.0.0.1:6379", RUN_REDIS_TESTS: "1", TMPDIR: path.join(work, "tmp"), TZ: "UTC",
  };
}

export function sanitizedFailureReason(error) {
  return /^seaweed_[a-z0-9_]+$/u.test(error?.message ?? "") ? error.message : "seaweed_operation_failed";
}

export function createRedisLifecycle() {
  return { creationAttempted: false };
}

export function armRedisCleanup(lifecycle) {
  lifecycle.creationAttempted = true;
}

export function finalizeRedisCleanup(lifecycle, cleanup) {
  if (lifecycle.creationAttempted) cleanup();
}

export function cleanupBuildResources(receipt, operations, now = Date.now) {
  const started = now(); let failure;
  for (const [name, operation] of Object.entries(operations)) {
    const phaseStarted = now();
    try {
      operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted });
    } catch (error) {
      failure ??= error;
      receipt.phases.push({ name, result: "FAILED", reason: sanitizedFailureReason(error), durationMs: now() - phaseStarted });
    }
  }
  const summary = { name: "cleanup", result: failure ? "FAILED" : "PASSED", durationMs: now() - started };
  if (failure) {
    summary.reason = sanitizedFailureReason(failure);
    receipt.result = "FAILED";
    receipt.cleanupReason = summary.reason;
    receipt.reason ??= summary.reason;
  }
  receipt.phases.push(summary);
  return failure;
}

function validateOutput(output, runnerTemp, repeat) {
  const root = path.resolve(runnerTemp);
  const target = path.resolve(output);
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory() || realpathSync(root) !== root ||
      path.dirname(target) !== root || path.basename(target) !== `seaweed-build-${repeat}` || existsSync(target)) throw new Error("seaweed_output_path_invalid");
  return target;
}

function materialIdentity(bytes) {
  return { sha256: sha256(bytes), size: bytes.length };
}

export function safeBaseEnvironment(workRoot) {
  return { HOME: path.join(workRoot, "home"), LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/local/bin:/usr/bin:/bin", TMPDIR: path.join(workRoot, "tmp"), TZ: "UTC" };
}

export function redisRunArguments(name, subject) {
  if (!/^aw-seaweed-redis-[12]$/u.test(name) || subject !== "redis@sha256:76961cd2a0f40ef6fdd334b6b1b3a76a2bad1848d89f3030ca30a7521d4a9493") throw new Error("seaweed_redis_arguments_invalid");
  return ["run", "--detach", "--name", name, "--cpus", "1", "--memory", "256m", "--memory-swap", "256m", "--pids-limit", "128", "--publish", "127.0.0.1:6379:6379", subject];
}

export function isMissingRedisContainer(result, name) {
  if (result?.error || result?.status !== 1 || !Buffer.isBuffer(result.stderr) || result.stderr.length > 1024 ** 2) return false;
  const text = result.stderr.toString("utf8").trim();
  return text === `Error: No such object: ${name}` || text === `Error response from daemon: No such container: ${name}`;
}

export function buildSeaweed({ argv = process.argv.slice(2), commandRunner = defaultRunner, env = process.env, now = Date.now, platform = process.platform, workRoot = DEFAULT_WORK } = {}) {
  const { output, repeat } = parseArguments(argv);
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_JOB !== "build") {
    throw new Error("seaweed_context_invalid");
  }
  if (!/^\d+$/u.test(env.GITHUB_RUN_ID ?? "") || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "") || !path.isAbsolute(env.RUNNER_TEMP ?? "") || !path.isAbsolute(env.GITHUB_WORKSPACE ?? "")) throw new Error("seaweed_identity_invalid");
  validateOutput(output, env.RUNNER_TEMP, repeat);
  const injectedRunner = commandRunner !== defaultRunner; const resolvedWork = path.resolve(workRoot);
  if ((!injectedRunner && workRoot !== DEFAULT_WORK) || (injectedRunner && (path.dirname(resolvedWork) !== path.resolve(env.RUNNER_TEMP) || path.basename(resolvedWork) !== "auto-world-seaweed-source-diagnostic")) || existsSync(resolvedWork)) throw new Error("seaweed_owned_path_exists");
  const lockBytes = readFileSync(LOCK_PATH);
  const lock = validateSeaweedLock(JSON.parse(lockBytes));
  const patch = canonicalMaterial(readFileSync(path.join(ROOT, lock.patch.path)), lock.patch);
  const moduleChanges = canonicalMaterial(readFileSync(path.join(ROOT, lock.moduleChanges.path)), lock.moduleChanges);
  const requiredTestsBytes = canonicalMaterial(readFileSync(path.join(ROOT, lock.requiredTests.path)), lock.requiredTests);
  const requiredTests = JSON.parse(requiredTestsBytes);
  if (requiredTests?.schemaVersion !== 1 || requiredTests.sourceCommit !== lock.source.commit || requiredTests.required?.redis?.length !== 15 ||
      requiredTests.required?.seaweedGrpc?.length !== 12 || requiredTests.required?.nonShortIntegration?.length !== 16) throw new Error("seaweed_required_tests_invalid");
  const requiredKeys = (group) => group.map(({ package: packageName, name }) => `${packageName}:${name}`);
  const redisTests = requiredKeys(requiredTests.required.redis);
  const grpcTests = requiredKeys(requiredTests.required.seaweedGrpc);
  const integrationTests = requiredKeys(requiredTests.required.nonShortIntegration);
  if (new Set([...redisTests, ...grpcTests, ...integrationTests]).size !== 43) throw new Error("seaweed_required_tests_invalid");
  const changes = moduleChanges.toString("utf8").trim().split("\n");
  if (changes.length !== lock.moduleChanges.count + 1) throw new Error("seaweed_module_changes_invalid");
  mkdirSync(output, { mode: 0o700 });
  mkdirSync(workRoot, { mode: 0o700 });
  mkdirSync(path.join(workRoot, "home"), { mode: 0o700 }); mkdirSync(path.join(workRoot, "tmp"), { mode: 0o700 });
  const logs = path.join(output, "logs"); const materials = path.join(output, "materials");
  mkdirSync(logs); mkdirSync(materials);
  const baseEnv = safeBaseEnvironment(workRoot);
  const started = now(); let aggregateLogs = 0; let commandIndex = 0; let runnerIndex = 0; const redisLifecycle = createRedisLifecycle();
  const receipt = { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "FAILED", repeat, sourceCommit: lock.source.commit,
    sourceTree: lock.source.tree, sourceVersion: lock.source.version, derivativeCommit: lock.build.commitValue, buildTags: [],
    platform: "linux/amd64", cgoEnabled: "0", notRun: lock.notRun, lock: materialIdentity(lockBytes), patch: materialIdentity(patch),
    moduleChanges: materialIdentity(moduleChanges), codeCheckout: { repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, ref: env.GITHUB_REF },
    workflowRun: { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, job: env.GITHUB_JOB },
    runtime: { node: process.version, architecture: process.arch, platform, imageOS: env.ImageOS ?? "", imageVersion: env.ImageVersion ?? "" }, phases: [] };
  const invoke = (command, args, options = {}) => {
    if (options.budget !== false) budget();
    const timeout = clippedTimeout({ deadlineMs: lock.limits.innerDeadlineMs, finalizationReserveMs: lock.limits.finalizationReserveMs }, now() - started, options.timeout ?? 20 * 60_000);
    runnerIndex += 1;
    const monitorPrefix = path.join(workRoot, "tmp", `command-${String(runnerIndex).padStart(3, "0")}`);
    const result = commandRunner(command, args, { cwd: options.cwd ?? workRoot, env: options.env ?? baseEnv, maxBuffer: lock.limits.logBytes, timeout,
      monitor: { stdout: `${monitorPrefix}.stdout`, stderr: `${monitorPrefix}.stderr`, marker: `${monitorPrefix}.marker`, work: workRoot, retained: output, limits: lock.limits } });
    const stdout = Buffer.isBuffer(result?.stdout) ? result.stdout : Buffer.alloc(0);
    const stderr = Buffer.isBuffer(result?.stderr) ? result.stderr : Buffer.alloc(0);
    const logBytes = Buffer.concat([stdout, stderr]);
    if (logBytes.length > lock.limits.logBytes) throw new Error("seaweed_command_log_exceeded");
    if (/^seaweed_[a-z0-9_]+$/u.test(result?.monitorReason ?? "")) throw new Error(result.monitorReason);
    if (options.budget !== false) budget();
    return { result, stdout, stderr, logBytes };
  };
  const run = (phaseName, command, args, options = {}) => {
    const { result, stdout, stderr, logBytes } = invoke(command, args, options);
    if (options.log !== false) {
      aggregateLogs += logBytes.length;
      if (aggregateLogs > lock.limits.aggregateLogBytes) throw new Error("seaweed_log_budget_exceeded");
      writeFileSync(path.join(logs, `${String(commandIndex += 1).padStart(2, "0")}-${phaseName}.log`), options.separateStderr ? stdout : logBytes, { flag: "wx" });
      if (options.separateStderr && stderr.length > 0) writeFileSync(path.join(logs, `${String(commandIndex += 1).padStart(2, "0")}-${phaseName}_stderr.log`), stderr, { flag: "wx" });
    }
    if (result?.error || result?.status !== 0) throw new Error(`seaweed_${phaseName}_failed`);
    return stdout;
  };
  const phase = (name, operation) => {
    const phaseStarted = now();
    try { const value = operation(); receipt.phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted }); return value; }
    catch (error) { receipt.phases.push({ name, result: "FAILED", reason: sanitizedFailureReason(error), durationMs: now() - phaseStarted }); throw error; }
  };
  const budget = () => {
    const stats = statfsSync(workRoot);
    assertResourceBudget({ workBytes: treeBytes(workRoot, lock.limits.workBytes), retainedBytes: treeBytes(output, lock.limits.retainedBytes),
      freeBytes: Number(stats.bavail) * Number(stats.bsize), logBytes: aggregateLogs, limits: lock.limits });
  };
  let primaryFailure; let cleanupFailure;
  try {
    const compilerArchive = path.join(workRoot, "go.tar.gz");
    phase("compiler_download", () => run("compiler_download", "/usr/bin/curl", ["--fail", "--location", "--proto", "=https", "--tlsv1.2", "--max-filesize", "134217728", "--max-time", "600", "--output", compilerArchive, lock.compiler.url]));
    const compilerIdentity = identity(compilerArchive, 128 * 1024 ** 2);
    if (compilerIdentity.sha256 !== lock.compiler.sha256 || compilerIdentity.size !== lock.compiler.size) throw new Error("seaweed_compiler_changed");
    copyFileSync(compilerArchive, path.join(materials, "go1.26.8.linux-amd64.tar.gz"));
    phase("compiler_extract", () => run("compiler_extract", "/usr/bin/tar", ["-xzf", compilerArchive, "-C", workRoot]));
    const go = path.join(workRoot, "go/bin/go");
    receipt.compiler = { archive: compilerIdentity, version: phase("compiler_identity", () => run("compiler_identity", go, ["version"], { log: false }).toString("utf8").trim()) };
    if (receipt.compiler.version !== "go version go1.26.8 linux/amd64") throw new Error("seaweed_compiler_identity_invalid");
    const source = path.join(workRoot, "source");
    const gitEnv = { ...baseEnv, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
    receipt.tools = {
      curl: run("curl_identity", "/usr/bin/curl", ["--version"], { env: baseEnv, log: false }).toString("utf8").split("\n")[0],
      docker: run("docker_identity", "/usr/bin/docker", ["version", "--format", "{{.Client.Version}}"], { env: baseEnv, log: false }).toString("utf8").trim(),
      git: run("git_identity", "/usr/bin/git", ["--version"], { env: gitEnv, log: false }).toString("utf8").trim(),
      tar: run("tar_identity", "/usr/bin/tar", ["--version"], { env: baseEnv, log: false }).toString("utf8").split("\n")[0],
      unzip: run("unzip_identity", "/usr/bin/unzip", ["-v"], { env: baseEnv, log: false }).toString("utf8").split("\n")[0],
    };
    const workspace = path.resolve(env.GITHUB_WORKSPACE);
    if (!existsSync(workspace) || lstatSync(workspace).isSymbolicLink() || !lstatSync(workspace).isDirectory() || realpathSync(workspace) !== workspace) throw new Error("seaweed_workspace_invalid");
    const actualCodeSha = run("code_checkout_identity", "/usr/bin/git", ["-C", workspace, "rev-parse", "HEAD"], { env: gitEnv, log: false }).toString("utf8").trim();
    if (actualCodeSha !== env.GITHUB_SHA) throw new Error("seaweed_code_checkout_changed");
    receipt.codeCheckout.actualSha = actualCodeSha;
    phase("source_checkout", () => {
      run("source_init", "/usr/bin/git", ["-c", "credential.helper=", "init", source], { env: gitEnv });
      run("source_remote", "/usr/bin/git", ["-C", source, "remote", "add", "origin", lock.source.repositoryUrl], { env: gitEnv });
      run("source_fetch", "/usr/bin/git", ["-c", "credential.helper=", "-C", source, "fetch", "--depth=1", "--no-tags", "origin", lock.source.commit], { env: gitEnv, timeout: 15 * 60_000 });
      run("source_checkout", "/usr/bin/git", ["-C", source, "checkout", "--detach", "FETCH_HEAD"], { env: gitEnv });
    });
    const head = run("source_head", "/usr/bin/git", ["-C", source, "rev-parse", "HEAD"], { env: gitEnv, log: false }).toString("utf8").trim();
    const tree = run("source_tree", "/usr/bin/git", ["-C", source, "rev-parse", "HEAD^{tree}"], { env: gitEnv, log: false }).toString("utf8").trim();
    if (head !== lock.source.commit || tree !== lock.source.tree) throw new Error("seaweed_source_changed");
    const moduleFileIdentities = (directory = source) => {
      const files = {};
      for (const name of ["go.mod", "go.sum"]) {
        files[name] = identity(path.join(directory, name), 8 * 1024 ** 2);
      }
      return files;
    };
    const checkModuleFiles = (expected, directory = source) => {
      if (JSON.stringify(moduleFileIdentities(directory)) !== JSON.stringify(expected)) throw new Error("seaweed_module_files_changed");
    };
    checkModuleFiles(lock.moduleFiles.before);
    const appliedPatch = path.join(workRoot, "seaweedfs-grpc.patch");
    writeFileSync(appliedPatch, patch, { flag: "wx" });
    const shallow = readFileSync(path.join(source, ".git/shallow")); validateShallowBoundary(shallow, lock);
    const sourceBundle = path.join(materials, "seaweedfs-source.bundle");
    phase("source_bundle", () => run("source_bundle", "/usr/bin/git", ["-C", source, "bundle", "create", sourceBundle, "HEAD"], { env: gitEnv, timeout: 15 * 60_000 }));
    const bundleIdentity = identity(sourceBundle, lock.source.bundleMaximumBytes);
    phase("source_bundle_verify", () => run("source_bundle_verify", "/usr/bin/git", ["-C", source, "bundle", "verify", sourceBundle], { env: gitEnv }));
    writeFileSync(path.join(materials, "seaweedfs-source-shallow.txt"), shallow, { flag: "wx" });
    const restored = path.join(workRoot, "restored-source");
    phase("source_restore", () => {
      run("source_restore_clone", "/usr/bin/git", ["-c", "core.autocrlf=false", "clone", "--no-checkout", "--no-local", sourceBundle, restored], { env: gitEnv, timeout: 15 * 60_000 });
      const restoredGit = path.join(restored, ".git");
      if (!existsSync(restoredGit) || lstatSync(restoredGit).isSymbolicLink() || !lstatSync(restoredGit).isDirectory()) throw new Error("seaweed_source_restore_invalid");
      writeFileSync(path.join(restoredGit, "shallow"), shallow);
      run("source_restore_fsck", "/usr/bin/git", ["-C", restored, "fsck", "--full"], { env: gitEnv });
      run("source_restore_checkout", "/usr/bin/git", ["-c", "core.autocrlf=false", "-C", restored, "checkout", "--detach", lock.source.commit], { env: gitEnv });
    });
    const restoredHead = run("source_restore_head", "/usr/bin/git", ["-C", restored, "rev-parse", "HEAD"], { env: gitEnv, log: false }).toString("utf8").trim();
    const restoredTree = run("source_restore_tree", "/usr/bin/git", ["-C", restored, "rev-parse", "HEAD^{tree}"], { env: gitEnv, log: false }).toString("utf8").trim();
    const restoredTime = run("source_restore_time", "/usr/bin/git", ["-C", restored, "show", "-s", "--format=%ct", "HEAD"], { env: gitEnv, log: false }).toString("utf8").trim();
    if (run("source_restore_status", "/usr/bin/git", ["-C", restored, "status", "--porcelain"], { env: gitEnv, log: false }).length !== 0) throw new Error("seaweed_source_restore_invalid");
    checkModuleFiles(lock.moduleFiles.before, restored);
    phase("source_restore_patch", () => run("source_restore_patch", "/usr/bin/git", ["-C", restored, "apply", "--whitespace=error-all", appliedPatch], { env: gitEnv }));
    checkModuleFiles(lock.moduleFiles.after, restored);
    const restoredChanged = run("source_restore_scope", "/usr/bin/git", ["-C", restored, "diff", "--name-only"], { env: gitEnv, log: false }).toString("utf8").trim().split("\n").sort();
    validateRestoredSource({ fsck: "PASSED", head: restoredHead, tree: restoredTree, commitUnixTime: restoredTime, pristine: lock.moduleFiles.before, corrected: lock.moduleFiles.after, changed: restoredChanged }, lock);
    receipt.sourceRetention = { bundle: bundleIdentity, shallow: materialIdentity(shallow), restoration: "PASSED", commitUnixTime: restoredTime };
    phase("patch_apply", () => run("patch_apply", "/usr/bin/git", ["-C", source, "apply", "--whitespace=error-all", appliedPatch], { env: gitEnv }));
    checkModuleFiles(lock.moduleFiles.after);
    const changed = run("patch_scope", "/usr/bin/git", ["-C", source, "diff", "--name-only"], { env: gitEnv, log: false }).toString("utf8").trim().split("\n").sort();
    if (JSON.stringify(changed) !== JSON.stringify(["go.mod", "go.sum"])) throw new Error("seaweed_patch_scope_invalid");
    copyFileSync(appliedPatch, path.join(materials, "seaweedfs-grpc.patch"));
    writeFileSync(path.join(materials, "module-changes.tsv"), moduleChanges, { flag: "wx" });
    writeFileSync(path.join(materials, "required-tests.json"), requiredTestsBytes, { flag: "wx" });
    copyFileSync(path.join(ROOT, "infra/seaweed/DERIVATIVE-NOTICE.txt"), path.join(materials, "DERIVATIVE-NOTICE.txt"));
    for (const material of lock.upstreamMaterials) {
      const actual = identity(path.join(source, material.path), 64 * 1024 ** 2);
      if (actual.sha256 !== material.sha256 || actual.size !== material.size) throw new Error("seaweed_upstream_material_changed");
      const destination = path.join(materials, "upstream", material.path);
      mkdirSync(path.dirname(destination), { recursive: true }); copyFileSync(path.join(source, material.path), destination);
    }
    const prodEnv = commandEnvironment(workRoot, go, false); const testEnv = commandEnvironment(workRoot, go, true);
    const tidy = phase("tidy_diff", () => run("tidy_diff", go, ["mod", "tidy", "-diff"], { cwd: source, env: { ...testEnv, GOFLAGS: "" }, timeout: 20 * 60_000 }));
    if (tidy.length !== 0) throw new Error("seaweed_tidy_diff_changed");
    const moduleIsolation = phase("module_isolation_prepare", () => createModuleIsolation(source, workRoot, lock));
    receipt.moduleIsolation = { result: "PREPARED", checkpoints: [] };
    const isolatedModuleCommand = (step, timeout) => phase(step, () => {
      const value = run(step, go, moduleIsolationArguments(step, moduleIsolation.modFile), { cwd: source, env: prodEnv, ...(timeout ? { timeout } : {}) });
      receipt.moduleIsolation.checkpoints.push(validateModuleIsolationCheckpoint(moduleIsolation, lock, step));
      return value;
    });
    const moduleOutput = isolatedModuleCommand("module_download", 30 * 60_000);
    const stable = stableModuleClosure(moduleOutput);
    const rawModules = jsonSequence(moduleOutput);
    if (stable.length !== rawModules.length) throw new Error("seaweed_module_output_invalid");
    isolatedModuleCommand("module_verify");
    const moduleDirectory = path.join(materials, "modules"); mkdirSync(moduleDirectory);
    const moduleInventory = [];
    let grpcNotices = new Set();
    for (const module of rawModules) {
      if (module.Error || typeof module.Path !== "string" || typeof module.Version !== "string" || typeof module.Zip !== "string" || typeof module.GoMod !== "string" || typeof module.Info !== "string") throw new Error("seaweed_module_output_invalid");
      const key = `${module.Path}@${module.Version}`; const id = sha256(Buffer.from(key)); const target = path.join(moduleDirectory, id); mkdirSync(target);
      const files = [["source.zip", module.Zip], ["module.mod", module.GoMod], ["module.info", module.Info]];
      const retained = {};
      for (const [name, sourceFile] of files) { copyFileSync(sourceFile, path.join(target, name)); retained[name] = identity(path.join(target, name), 256 * 1024 ** 2); }
      const listing = run("module_license_list", "/usr/bin/unzip", ["-Z1", module.Zip], { env: gitEnv, log: false, budget: false }).toString("utf8").split("\n").filter((name) => /(^|\/)(?:license|notice|copying)(?:\.[^/]*)?$/iu.test(name));
      const notices = [];
      for (let index = 0; index < listing.length; index += 1) {
        const bytes = run("module_notice", "/usr/bin/unzip", ["-p", module.Zip, listing[index]], { env: gitEnv, log: false, budget: false });
        if (bytes.length < 1 || bytes.length > 1024 ** 2) throw new Error("seaweed_module_notice_invalid");
        const name = `notice-${String(index + 1).padStart(3, "0")}.txt`; writeFileSync(path.join(target, name), bytes, { flag: "wx" });
        notices.push({ archiveEntry: listing[index], file: name, ...materialIdentity(bytes) });
        if (module.Path === "google.golang.org/grpc") grpcNotices.add(path.posix.basename(listing[index]).toLowerCase());
      }
      moduleInventory.push({ id, path: module.Path, version: module.Version, sum: module.Sum, goModSum: module.GoModSum, files: retained, notices });
      if (moduleInventory.length % 25 === 0) budget();
    }
    if (!grpcNotices.has("license") || !grpcNotices.has("notice.txt")) throw new Error("seaweed_grpc_notices_missing");
    const grpc = moduleInventory.find((entry) => entry.path === "google.golang.org/grpc");
    if (!grpc || grpc.version !== lock.grpc.version || grpc.sum !== lock.grpc.sum || grpc.goModSum !== lock.grpc.goModSum) throw new Error("seaweed_grpc_module_invalid");
    writeFileSync(path.join(output, "module-closure.json"), `${JSON.stringify(moduleInventory, null, 2)}\n`, { flag: "wx" });
    receipt.moduleCount = moduleInventory.length;
    const binary = path.join(workRoot, "bin/weed"); mkdirSync(path.dirname(binary));
    phase("production_build", () => run("production_build", go, ["build", "-p=2", "-buildvcs=true", "-ldflags", lock.build.ldflags, "-o", binary, "./weed"], { cwd: source, env: prodEnv, timeout: 45 * 60_000 }));
    copyFileSync(binary, path.join(output, "weed")); receipt.binary = identity(path.join(output, "weed"), 1024 ** 3);
    const buildInfo = run("build_info", go, ["version", "-m", binary], { cwd: source, env: prodEnv, log: false }).toString("utf8");
    validateBuildInfo(buildInfo, lock, binary); writeFileSync(path.join(output, "go-build-info.txt"), buildInfo, { flag: "wx" });
    const versionOutput = run("version_output", binary, ["version"], { cwd: source, env: prodEnv }).toString("utf8").trim();
    validateVersionOutput(versionOutput, lock);
    receipt.versionOutput = versionOutput;
    testEnv.WEED_BINARY = binary;
    phase("test_preflight", () => {
      if (run("test_user", "/usr/bin/id", ["-u"], { env: gitEnv, log: false }).toString("utf8").trim() === "0") throw new Error("seaweed_test_requires_nonroot");
      run("test_zoneinfo", "/usr/bin/test", ["-r", "/usr/share/zoneinfo/America/Sao_Paulo"], { env: gitEnv, log: false });
    });
    const redisName = `aw-seaweed-redis-${repeat}`;
    phase("redis_helper", () => {
      const { result: inspect } = invoke("/usr/bin/docker", ["container", "inspect", redisName], { env: gitEnv, timeout: 60_000 });
      if (inspect.status === 0) throw new Error("seaweed_redis_collision");
      if (!isMissingRedisContainer(inspect, redisName)) throw new Error("seaweed_redis_inspection_failed");
      run("redis_pull", "/usr/bin/docker", ["pull", lock.redis.subject], { env: gitEnv, timeout: 10 * 60_000 });
      armRedisCleanup(redisLifecycle);
      run("redis_start", "/usr/bin/docker", redisRunArguments(redisName, lock.redis.subject), { env: gitEnv });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const { result: ready, stdout: readyOutput } = invoke("/usr/bin/docker", ["exec", redisName, "redis-cli", "ping"], { env: gitEnv, timeout: 30_000 });
        if (ready.status === 0 && readyOutput.toString("utf8").trim() === "PONG") return;
        run("redis_wait", "/usr/bin/sleep", ["2"], { env: gitEnv, log: false, timeout: 5_000 });
      }
      throw new Error("seaweed_redis_not_ready");
    });
    const testSummary = {};
    const normalOutput = phase("normal_tests", () => run("normal_tests", go, ["test", "-json", "-count=1", "-p=2", "./..."], { cwd: path.join(source, "weed"), env: testEnv, timeout: 75 * 60_000, separateStderr: true }));
    testSummary.normal = summarizeGoTestJson(normalOutput, [...redisTests, ...integrationTests]);
    const fullOutput = phase("full_tag_tests", () => run("full_tag_tests", go, ["test", "-json", "-count=1", "-p=2", "-tags=elastic,gocdk,sqlite,ydb,tarantool,tikv,rclone", "./..."], { cwd: path.join(source, "weed"), env: testEnv, timeout: 75 * 60_000, separateStderr: true }));
    testSummary.fullTags = summarizeGoTestJson(fullOutput, [...redisTests, ...integrationTests]);
    const grpcProjectOutput = phase("project_grpc_tests", () => run("project_grpc_tests", go, ["test", "-json", "-count=1", "-p=2", "./weed/pb"], { cwd: source, env: testEnv, timeout: 20 * 60_000, separateStderr: true }));
    testSummary.projectGrpc = summarizeGoTestJson(grpcProjectOutput, grpcTests);
    writeFileSync(path.join(output, "test-summary.json"), `${JSON.stringify(testSummary, null, 2)}\n`, { flag: "wx" });
    phase("vet", () => run("vet", go, ["vet", "-p=2", "./..."], { cwd: path.join(source, "weed"), env: testEnv, timeout: 45 * 60_000 }));
    const grpcDir = run("grpc_dir", go, ["list", "-m", "-f", "{{.Dir}}", "google.golang.org/grpc"], { cwd: source, env: testEnv, log: false }).toString("utf8").trim();
    if (!path.isAbsolute(grpcDir) || !grpcDir.startsWith(path.join(workRoot, "gomodcache"))) throw new Error("seaweed_grpc_directory_invalid");
    receipt.grpcTransport = { directory: grpcDir, version: lock.grpc.version, closure: "seaweed_mvs" };
    phase("grpc_transport_tests", () => run("grpc_transport_tests", go, ["test", "-count=1", "-p=2", "-v", "google.golang.org/grpc/internal/transport"], { cwd: source, env: testEnv, timeout: 30 * 60_000 }));
    const finalModuleOutput = isolatedModuleCommand("post_test_module_download", 30 * 60_000);
    const finalClosure = stableModuleClosure(finalModuleOutput);
    isolatedModuleCommand("post_test_module_verify");
    const finalGrpc = validatePostTestState(stable, finalClosure, moduleFileIdentities(), lock);
    receipt.moduleIsolation.result = "PASSED";
    receipt.moduleClosure = { result: "UNCHANGED_AFTER_TESTS", count: stable.length, grpcVersion: finalGrpc.version };
    const inventory = artifactInventory(output).filter((entry) => entry.path !== "material-inventory.json" && entry.path !== "build-receipt.json");
    validateArtifactAllowlist(inventory.map((entry) => entry.path));
    writeFileSync(path.join(output, "material-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, { flag: "wx" });
    receipt.inventory = identity(path.join(output, "material-inventory.json"), 64 * 1024 ** 2);
    budget(); receipt.result = "PASSED";
  } catch (error) { primaryFailure = error; receipt.reason = sanitizedFailureReason(error); }
  const cleanupOperations = {};
  if (redisLifecycle.creationAttempted) {
    cleanupOperations.redis_cleanup = () => {
      const name = `aw-seaweed-redis-${repeat}`;
      finalizeRedisCleanup(redisLifecycle, () => {
        runnerIndex += 1; const prefix = path.join(workRoot, "tmp", `command-${String(runnerIndex).padStart(3, "0")}-cleanup`);
        const cleanupTimeout = clippedFinalizationTimeout({ deadlineMs: lock.limits.innerDeadlineMs }, now() - started, 60_000);
        const result = commandRunner("/usr/bin/docker", ["rm", "--force", name], { cwd: workRoot, env: baseEnv, maxBuffer: 1024 ** 2, timeout: cleanupTimeout, cleanup: "redis_container",
          monitor: { stdout: `${prefix}.stdout`, stderr: `${prefix}.stderr`, marker: `${prefix}.marker`, work: workRoot, retained: output, limits: lock.limits } });
        if (/^seaweed_[a-z0-9_]+$/u.test(result?.monitorReason ?? "")) throw new Error(result.monitorReason);
        if ((result.error || result.status !== 0) && !isMissingRedisContainer(result, name)) throw new Error("seaweed_redis_cleanup_failed");
      });
    };
  }
  cleanupOperations.work_cleanup = () => removeOwnedTree(workRoot, path.dirname(path.resolve(workRoot)));
  cleanupFailure = cleanupBuildResources(receipt, cleanupOperations, now);
  receipt.aggregateLogBytes = aggregateLogs;
  try {
    if (receipt.result === "FAILED") {
      for (const entry of readdirSync(output, { withFileTypes: true })) {
        if (entry.name !== "logs") rmSync(path.join(output, entry.name), { recursive: entry.isDirectory(), force: false });
      }
    }
    const retainedBytes = treeBytes(output, lock.limits.retainedBytes);
    receipt.retainedBytesBeforeReceipt = retainedBytes;
    writeFileSync(path.join(output, "build-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  } catch (error) { cleanupFailure ??= error; }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) buildSeaweed();
