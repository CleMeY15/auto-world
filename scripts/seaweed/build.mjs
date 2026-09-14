import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmSync, statfsSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { stableModuleClosure } from "../scanner/build.mjs";

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
  if (workBytes > limits.workBytes) throw new Error("seaweed_work_budget_exceeded");
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

export function validateBuildInfo(value, lock) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 8 * 1024 ** 2) throw new Error("seaweed_build_info_invalid");
  const required = new Map([
    ["dep\tgoogle.golang.org/grpc\t", lock.grpc.version],
    ["build\tCGO_ENABLED=", "0"], ["build\tGOARCH=", "amd64"], ["build\tGOOS=", "linux"], ["build\tGOAMD64=", "v1"],
    ["build\tvcs.revision=", lock.source.commit], ["build\tvcs.modified=", "true"],
  ]);
  const lines = value.split(/\r?\n/u).map((line) => line.trimStart());
  for (const [prefix, expected] of required) {
    const matches = lines.filter((line) => line.startsWith(prefix));
    if (matches.length !== 1 || !matches[0].includes(expected)) throw new Error("seaweed_build_info_invalid");
  }
  if (lines.some((line) => line.startsWith("build\t-tags="))) throw new Error("seaweed_build_tags_invalid");
  return true;
}

export function validateArtifactAllowlist(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || new Set(paths).size !== paths.length) throw new Error("seaweed_artifact_allowlist_invalid");
  const exact = new Set(["weed", "go-build-info.txt", "module-closure.json", "test-summary.json", "material-inventory.json", "build-receipt.json"]);
  const patterns = [
    /^logs\/\d{2}-[a-z0-9_]+\.log$/u,
    /^materials\/(?:go1\.26\.8\.linux-amd64\.tar\.gz|seaweedfs-source\.tar|seaweedfs-grpc\.patch|module-changes\.tsv|required-tests\.json|DERIVATIVE-NOTICE\.txt)$/u,
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
  for (const required of ["weed", "go-build-info.txt", "module-closure.json", "test-summary.json", "materials/go1.26.8.linux-amd64.tar.gz", "materials/seaweedfs-source.tar", "materials/seaweedfs-grpc.patch", "materials/module-changes.tsv", "materials/required-tests.json", "materials/DERIVATIVE-NOTICE.txt", "materials/upstream/LICENSE", "materials/upstream/weed/glog/LICENSE", "materials/upstream/docker/Dockerfile.go_build", "materials/upstream/.github/workflows/go.yml", "materials/upstream/.github/workflows/container_release_unified.yml"]) {
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

function commandEnvironment(work, go, test = false) {
  return {
    CGO_ENABLED: test ? "1" : "0", GOARCH: "amd64", GOENV: "off", GOEXPERIMENT: "", GOFLAGS: "-mod=readonly", GOAMD64: "v1",
    GOCACHE: path.join(work, "gocache"), GOMAXPROCS: "2", GOMODCACHE: path.join(work, "gomodcache"), GOOS: "linux",
    GOPATH: path.join(work, "gopath"), GOPROXY: "https://proxy.golang.org", GOSUMDB: "sum.golang.org", GOTOOLCHAIN: "local", GOWORK: "off",
    HOME: path.join(work, "home"), LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: `${path.dirname(go)}:/usr/local/bin:/usr/bin:/bin`,
    REDIS_ADDR: "127.0.0.1:6379", RUN_REDIS_TESTS: "1", TMPDIR: path.join(work, "tmp"), TZ: test ? "America/Sao_Paulo" : "UTC",
  };
}

function defaultRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: null, env: options.env, maxBuffer: options.maxBuffer, timeout: options.timeout, windowsHide: true });
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

export function buildSeaweed({ argv = process.argv.slice(2), commandRunner = defaultRunner, env = process.env, now = Date.now, platform = process.platform, workRoot = DEFAULT_WORK } = {}) {
  const { output, repeat } = parseArguments(argv);
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_JOB !== "build") {
    throw new Error("seaweed_context_invalid");
  }
  if (!/^\d+$/u.test(env.GITHUB_RUN_ID ?? "") || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "") || !path.isAbsolute(env.RUNNER_TEMP ?? "")) throw new Error("seaweed_identity_invalid");
  validateOutput(output, env.RUNNER_TEMP, repeat);
  if (workRoot !== DEFAULT_WORK || existsSync(workRoot)) throw new Error("seaweed_owned_path_exists");
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
  const logs = path.join(output, "logs"); const materials = path.join(output, "materials");
  mkdirSync(logs); mkdirSync(materials);
  const started = now(); let aggregateLogs = 0; let commandIndex = 0; let redisCreated = false;
  const receipt = { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "FAILED", repeat, sourceCommit: lock.source.commit,
    sourceTree: lock.source.tree, sourceVersion: lock.source.version, derivativeCommit: lock.build.commitValue, buildTags: [],
    platform: "linux/amd64", cgoEnabled: "0", notRun: lock.notRun, lock: materialIdentity(lockBytes), patch: materialIdentity(patch),
    moduleChanges: materialIdentity(moduleChanges), phases: [] };
  const run = (phaseName, command, args, options = {}) => {
    if (options.budget !== false) budget();
    const timeout = clippedTimeout({ deadlineMs: lock.limits.innerDeadlineMs, finalizationReserveMs: lock.limits.finalizationReserveMs }, now() - started, options.timeout ?? 20 * 60_000);
    const result = commandRunner(command, args, { cwd: options.cwd ?? workRoot, env: options.env, maxBuffer: lock.limits.logBytes, timeout });
    const stdout = Buffer.isBuffer(result?.stdout) ? result.stdout : Buffer.alloc(0);
    const stderr = Buffer.isBuffer(result?.stderr) ? result.stderr : Buffer.alloc(0);
    const logBytes = Buffer.concat([stdout, stderr]);
    if (logBytes.length > lock.limits.logBytes) throw new Error("seaweed_command_log_exceeded");
    if (options.log !== false) {
      aggregateLogs += logBytes.length;
      if (aggregateLogs > lock.limits.aggregateLogBytes) throw new Error("seaweed_log_budget_exceeded");
      writeFileSync(path.join(logs, `${String(commandIndex += 1).padStart(2, "0")}-${phaseName}.log`), logBytes, { flag: "wx" });
    }
    if (result?.error || result?.status !== 0) throw new Error(`seaweed_${phaseName}_failed`);
    if (options.budget !== false) budget();
    return stdout;
  };
  const phase = (name, operation) => {
    const phaseStarted = now();
    try { const value = operation(); receipt.phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted }); return value; }
    catch (error) { receipt.phases.push({ name, result: "FAILED", reason: /^seaweed_[a-z0-9_]+$/u.test(error.message) ? error.message : "seaweed_operation_failed", durationMs: now() - phaseStarted }); throw error; }
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
    const gitEnv = { HOME: path.join(workRoot, "home"), LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/local/bin:/usr/bin:/bin", TZ: "UTC" };
    mkdirSync(gitEnv.HOME); mkdirSync(path.join(workRoot, "tmp"));
    phase("source_checkout", () => {
      run("source_init", "/usr/bin/git", ["-c", "credential.helper=", "init", source], { env: gitEnv });
      run("source_remote", "/usr/bin/git", ["-C", source, "remote", "add", "origin", lock.source.repositoryUrl], { env: gitEnv });
      run("source_fetch", "/usr/bin/git", ["-c", "credential.helper=", "-C", source, "fetch", "--depth=1", "--no-tags", "origin", lock.source.commit], { env: gitEnv, timeout: 15 * 60_000 });
      run("source_checkout", "/usr/bin/git", ["-C", source, "checkout", "--detach", "FETCH_HEAD"], { env: gitEnv });
    });
    const head = run("source_head", "/usr/bin/git", ["-C", source, "rev-parse", "HEAD"], { env: gitEnv, log: false }).toString("utf8").trim();
    const tree = run("source_tree", "/usr/bin/git", ["-C", source, "rev-parse", "HEAD^{tree}"], { env: gitEnv, log: false }).toString("utf8").trim();
    if (head !== lock.source.commit || tree !== lock.source.tree) throw new Error("seaweed_source_changed");
    const sourceArchive = path.join(materials, "seaweedfs-source.tar");
    phase("source_archive", () => run("source_archive", "/usr/bin/git", ["-C", source, "archive", "--format=tar", `--output=${sourceArchive}`, "HEAD"], { env: gitEnv }));
    receipt.sourceArchive = identity(sourceArchive);
    const checkModuleFiles = (expected) => {
      for (const name of ["go.mod", "go.sum"]) {
        const actual = identity(path.join(source, name), 8 * 1024 ** 2);
        if (JSON.stringify(actual) !== JSON.stringify(expected[name])) throw new Error("seaweed_module_files_changed");
      }
    };
    checkModuleFiles(lock.moduleFiles.before);
    const appliedPatch = path.join(workRoot, "seaweedfs-grpc.patch");
    writeFileSync(appliedPatch, patch, { flag: "wx" });
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
    const moduleOutput = phase("module_download", () => run("module_download", go, ["mod", "download", "-json", "all"], { cwd: source, env: prodEnv, timeout: 30 * 60_000 }));
    const stable = stableModuleClosure(moduleOutput);
    const rawModules = jsonSequence(moduleOutput);
    if (stable.length !== rawModules.length) throw new Error("seaweed_module_output_invalid");
    phase("module_verify", () => run("module_verify", go, ["mod", "verify"], { cwd: source, env: prodEnv }));
    checkModuleFiles(lock.moduleFiles.after);
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
    validateBuildInfo(buildInfo, lock); writeFileSync(path.join(output, "go-build-info.txt"), buildInfo, { flag: "wx" });
    const versionOutput = run("version_output", binary, ["version"], { cwd: source, env: prodEnv }).toString("utf8").trim();
    if (!versionOutput.includes(lock.source.version) || !versionOutput.includes(lock.build.commitValue)) throw new Error("seaweed_version_output_invalid");
    receipt.versionOutput = versionOutput;
    testEnv.WEED_BINARY = binary;
    phase("test_preflight", () => {
      if (run("test_user", "/usr/bin/id", ["-u"], { env: gitEnv, log: false }).toString("utf8").trim() === "0") throw new Error("seaweed_test_requires_nonroot");
      run("test_zoneinfo", "/usr/bin/test", ["-r", "/usr/share/zoneinfo/America/Sao_Paulo"], { env: gitEnv, log: false });
    });
    const redisName = `aw-seaweed-redis-${repeat}`;
    phase("redis_helper", () => {
      const inspect = commandRunner("/usr/bin/docker", ["container", "inspect", redisName], { cwd: workRoot, env: gitEnv, maxBuffer: lock.limits.logBytes, timeout: 60_000 });
      if (inspect.status === 0) throw new Error("seaweed_redis_collision");
      run("redis_pull", "/usr/bin/docker", ["pull", lock.redis.subject], { env: gitEnv, timeout: 10 * 60_000 });
      run("redis_start", "/usr/bin/docker", ["run", "--detach", "--name", redisName, "--publish", "127.0.0.1:6379:6379", lock.redis.subject], { env: gitEnv });
      redisCreated = true;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const ready = commandRunner("/usr/bin/docker", ["exec", redisName, "redis-cli", "ping"], { cwd: workRoot, env: gitEnv, maxBuffer: lock.limits.logBytes, timeout: 30_000 });
        if (ready.status === 0 && Buffer.from(ready.stdout ?? "").toString("utf8").trim() === "PONG") return;
        run("redis_wait", "/usr/bin/sleep", ["2"], { env: gitEnv, log: false, timeout: 5_000 });
      }
      throw new Error("seaweed_redis_not_ready");
    });
    const testSummary = {};
    const normalOutput = phase("normal_tests", () => run("normal_tests", go, ["test", "-json", "-count=1", "-p=2", "./..."], { cwd: path.join(source, "weed"), env: testEnv, timeout: 75 * 60_000 }));
    testSummary.normal = summarizeGoTestJson(normalOutput, [...redisTests, ...integrationTests]);
    const fullOutput = phase("full_tag_tests", () => run("full_tag_tests", go, ["test", "-json", "-count=1", "-p=2", "-tags=elastic,gocdk,sqlite,ydb,tarantool,tikv,rclone", "./..."], { cwd: path.join(source, "weed"), env: testEnv, timeout: 75 * 60_000 }));
    testSummary.fullTags = summarizeGoTestJson(fullOutput, [...redisTests, ...integrationTests]);
    const grpcProjectOutput = phase("project_grpc_tests", () => run("project_grpc_tests", go, ["test", "-json", "-count=1", "-p=2", "./weed/pb"], { cwd: source, env: testEnv, timeout: 20 * 60_000 }));
    testSummary.projectGrpc = summarizeGoTestJson(grpcProjectOutput, grpcTests);
    writeFileSync(path.join(output, "test-summary.json"), `${JSON.stringify(testSummary, null, 2)}\n`, { flag: "wx" });
    phase("vet", () => run("vet", go, ["vet", "-p=2", "./..."], { cwd: path.join(source, "weed"), env: testEnv, timeout: 45 * 60_000 }));
    const grpcDir = run("grpc_dir", go, ["list", "-m", "-f", "{{.Dir}}", "google.golang.org/grpc"], { cwd: source, env: testEnv, log: false }).toString("utf8").trim();
    if (!path.isAbsolute(grpcDir) || !grpcDir.startsWith(path.join(workRoot, "gomodcache"))) throw new Error("seaweed_grpc_directory_invalid");
    receipt.grpcTransport = { directory: grpcDir, version: lock.grpc.version, closure: "seaweed_mvs" };
    phase("grpc_transport_tests", () => run("grpc_transport_tests", go, ["test", "-count=1", "-p=2", "-v", "google.golang.org/grpc/internal/transport"], { cwd: source, env: testEnv, timeout: 30 * 60_000 }));
    const inventory = artifactInventory(output).filter((entry) => entry.path !== "material-inventory.json" && entry.path !== "build-receipt.json");
    validateArtifactAllowlist(inventory.map((entry) => entry.path));
    writeFileSync(path.join(output, "material-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`, { flag: "wx" });
    receipt.inventory = identity(path.join(output, "material-inventory.json"), 64 * 1024 ** 2);
    budget(); receipt.result = "PASSED";
  } catch (error) { primaryFailure = error; }
  if (redisCreated) {
    try { const result = commandRunner("/usr/bin/docker", ["rm", "--force", `aw-seaweed-redis-${repeat}`], { cwd: workRoot, env: {}, maxBuffer: 1024 ** 2, timeout: 60_000 }); if (result.error || result.status !== 0) throw new Error("seaweed_redis_cleanup_failed"); }
    catch (error) { cleanupFailure = error; receipt.result = "FAILED"; }
  }
  try { removeOwnedTree(workRoot); receipt.phases.push({ name: "cleanup", result: "PASSED", durationMs: 0 }); }
  catch (error) { cleanupFailure ??= error; receipt.result = "FAILED"; receipt.phases.push({ name: "cleanup", result: "FAILED", reason: error.message, durationMs: 0 }); }
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
