import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LOCK_PATH = path.join(ROOT, "infra/scanner/scanner-lock.json");
const MAX_LOG = 64 * 1024 * 1024;
const MiB = 1024 * 1024;

export function removeOwnedBuildTree(work, runnerTemp) {
  const target = path.resolve(work);
  if (path.dirname(target) !== path.resolve(runnerTemp) || !/^aw-scanner-build-[12]$/u.test(path.basename(target))) {
    throw new Error("scanner_cleanup_path_invalid");
  }
  if (!existsSync(target)) return;
  if (lstatSync(target).isSymbolicLink()) throw new Error("scanner_cleanup_path_invalid");
  const makeDirectoriesWritable = (directory) => {
    chmodSync(directory, 0o700);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) makeDirectoriesWritable(path.join(directory, entry.name));
    }
  };
  makeDirectoriesWritable(target);
  rmSync(target, { recursive: true, force: true });
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseBuildArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("scanner_build_arguments_invalid");
    const key = argv[index].slice(2);
    if (values.has(key)) throw new Error("scanner_build_arguments_invalid");
    values.set(key, argv[index + 1]);
  }
  if ([...values.keys()].some((key) => !["repeat", "output"].includes(key))) throw new Error("scanner_build_arguments_invalid");
  const repeat = Number(values.get("repeat"));
  const outputValue = values.get("output");
  if (typeof outputValue !== "string" || !path.isAbsolute(outputValue)) throw new Error("scanner_build_arguments_invalid");
  const output = path.resolve(outputValue);
  if (![1, 2].includes(repeat)) throw new Error("scanner_build_arguments_invalid");
  return { repeat, output };
}

function run(command, args, { cwd, env, timeout = 10 * 60_000, log } = {}) {
  const result = spawnSync(command, args, { cwd, env, timeout, maxBuffer: MAX_LOG, encoding: null, windowsHide: true });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  if (log) writeFileSync(log, Buffer.concat([stdout, stderr]), { flag: "wx" });
  if (result.error || result.status !== 0) {
    const error = new Error(`scanner_build_command_failed:${path.basename(command)}:${result.status ?? "error"}`);
    error.cause = result.error;
    throw error;
  }
  return stdout;
}

function fileIdentity(file, cap = 1024 * 1024 * 1024) {
  const info = lstatSync(file, { bigint: false });
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > cap) throw new Error("scanner_build_file_invalid");
  const bytes = readFileSync(file);
  return { sha256: sha256(bytes), size: bytes.length };
}

export function validateBuildLock(lock) {
  if (lock?.schemaVersion !== 1 || lock.state !== "diagnostic_only" || lock.scanner?.version !== "0.74.0-autoworld.2" ||
      !/^[a-f0-9]{40}$/u.test(lock.scanner.sourceCommit) || lock.compiler?.version !== "1.26.8" ||
      !/^sha256:[a-f0-9]{64}$/u.test(lock.baseline?.platformDigest) || !Array.isArray(lock.patches) || lock.patches.length !== 3 ||
      !Array.isArray(lock.fixtures) || lock.fixtures.length !== 11 || !Array.isArray(lock.images) || lock.images.length !== 6) {
    throw new Error("scanner_build_lock_invalid");
  }
  return lock;
}

function assertLockedFiles(entries) {
  for (const entry of entries) {
    const absolute = path.join(ROOT, entry.path);
    const actual = fileIdentity(absolute, 64 * 1024 * 1024);
    if (actual.sha256 !== entry.sha256 || actual.size !== entry.size) throw new Error("scanner_build_material_changed");
  }
}

function directoryBytes(directory) {
  let total = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    total += entry.isDirectory() ? directoryBytes(absolute) : statSync(absolute).size;
    if (total > 6 * 1024 ** 3) throw new Error("scanner_build_artifact_budget_exceeded");
  }
  return total;
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
    else if (depth === 0 && !/\s/u.test(char)) throw new Error("scanner_module_output_invalid");
    if (depth < 0) throw new Error("scanner_module_output_invalid");
  }
  if (depth !== 0 || quoted || records.length < 1) throw new Error("scanner_module_output_invalid");
  return records;
}

export function stableModuleClosure(bytes) {
  const closure = jsonSequence(bytes).map((entry) => {
    if (entry.Error || typeof entry.Path !== "string" || typeof entry.Version !== "string" || typeof entry.Sum !== "string" ||
        typeof entry.GoModSum !== "string" || typeof entry.Zip !== "string" || !path.isAbsolute(entry.Zip)) throw new Error("scanner_module_output_invalid");
    return { path: entry.Path, version: entry.Version, sum: entry.Sum, goModSum: entry.GoModSum, zip: fileIdentity(entry.Zip, 256 * MiB) };
  }).sort((left, right) => `${left.path}@${left.version}`.localeCompare(`${right.path}@${right.version}`, "en"));
  if (new Set(closure.map((entry) => `${entry.path}@${entry.version}`)).size !== closure.length) throw new Error("scanner_module_output_invalid");
  return closure;
}

export function buildScanner({ repeat, output }) {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP) {
    throw new Error("scanner_build_requires_linux_actions");
  }
  const lockBytes = readFileSync(LOCK_PATH);
  const lock = validateBuildLock(JSON.parse(lockBytes));
  assertLockedFiles([...lock.patches, ...lock.fixtures]);
  const work = path.join(process.env.RUNNER_TEMP, `aw-scanner-build-${repeat}`);
  if (existsSync(work) || existsSync(output)) throw new Error("scanner_build_owned_path_exists");
  mkdirSync(output, { recursive: true });
  mkdirSync(work, { recursive: true });
  const logs = path.join(output, "logs");
  mkdirSync(logs);
  const receipt = { schemaVersion: 1, state: "diagnostic_only", result: "failed", repeat, scannerVersion: lock.scanner.version,
    sourceCommit: lock.scanner.sourceCommit, lock: { sha256: sha256(lockBytes), size: lockBytes.length }, phases: [] };
  const phase = (name, operation) => {
    const started = Date.now();
    try {
      const value = operation();
      receipt.phases.push({ name, result: "passed", durationMs: Date.now() - started });
      return value;
    } catch (error) {
      receipt.phases.push({ name, result: "failed", durationMs: Date.now() - started, reason: String(error.message).slice(0, 512) });
      throw error;
    }
  };
  let primaryFailure;
  try {
    const goArchive = path.join(work, "go.tar.gz");
    phase("compiler_download", () => run("/usr/bin/curl", ["--fail", "--location", "--proto", "=https", "--tlsv1.2", "--max-filesize", "134217728", "--max-time", "600", "--output", goArchive, lock.compiler.url], { cwd: work, log: path.join(logs, "compiler-download.log") }));
    receipt.compilerArchive = fileIdentity(goArchive, 128 * 1024 * 1024);
    if (receipt.compilerArchive.sha256 !== lock.compiler.sha256 || receipt.compilerArchive.size !== lock.compiler.size) throw new Error("scanner_compiler_changed");
    phase("compiler_extract", () => run("/usr/bin/tar", ["-xzf", goArchive, "-C", work], { cwd: work, log: path.join(logs, "compiler-extract.log") }));
    const go = path.join(work, "go/bin/go");
    receipt.compilerVersion = phase("compiler_identity", () => run(go, ["version"], { cwd: work }).toString("utf8").trim());

    const source = path.join(work, "trivy");
    phase("source_checkout", () => {
      run("/usr/bin/git", ["-c", "credential.helper=", "init", source], { cwd: work });
      run("/usr/bin/git", ["-C", source, "remote", "add", "origin", lock.scanner.repositoryUrl], { cwd: work });
      run("/usr/bin/git", ["-c", "credential.helper=", "-C", source, "fetch", "--depth=1", "--no-tags", "origin", lock.scanner.sourceCommit], { cwd: work, timeout: 15 * 60_000, log: path.join(logs, "source-fetch.log") });
      run("/usr/bin/git", ["-C", source, "checkout", "--detach", "FETCH_HEAD"], { cwd: work });
    });
    const head = run("/usr/bin/git", ["-C", source, "rev-parse", "HEAD"], { cwd: work }).toString("utf8").trim();
    if (head !== lock.scanner.sourceCommit) throw new Error("scanner_source_commit_changed");
    receipt.sourceTree = run("/usr/bin/git", ["-C", source, "rev-parse", "HEAD^{tree}"], { cwd: work }).toString("utf8").trim();
    for (const patch of lock.patches) phase(`patch_${patch.order}`, () => run("/usr/bin/git", ["-C", source, "apply", "--whitespace=error-all", path.join(ROOT, patch.path)], { cwd: work, log: path.join(logs, `patch-${patch.order}.log`) }));
    for (const material of lock.upstreamTestMaterials) {
      const destination = path.join(source, material.destination);
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(path.join(ROOT, material.source), destination);
      const actual = fileIdentity(destination, 64 * 1024 * 1024);
      if (actual.sha256 !== material.sha256 || actual.size !== material.size) throw new Error("scanner_upstream_fixture_changed");
    }

    const env = { ...process.env, HOME: path.join(work, "home"), TMPDIR: `/tmp/aw-trivy-${repeat}`, GOPATH: path.join(work, "gopath"),
      GOCACHE: path.join(work, "gocache"), GOMODCACHE: path.join(work, "gomodcache"), GOTOOLCHAIN: "local", GOPROXY: "https://proxy.golang.org",
      GOSUMDB: "sum.golang.org", GOFLAGS: "-mod=readonly", CGO_ENABLED: "0", GOEXPERIMENT: "jsonv2", TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
      PATH: `${path.dirname(go)}:/usr/local/bin:/usr/bin:/bin` };
    mkdirSync(env.HOME); mkdirSync(env.TMPDIR);
    const moduleBefore = ["go.mod", "go.sum"].map((name) => ({ name, ...fileIdentity(path.join(source, name), 8 * 1024 * 1024) }));
    phase("tidy_diff", () => run(go, ["mod", "tidy", "-diff"], { cwd: source, env: { ...env, GOFLAGS: "" }, timeout: 20 * 60_000, log: path.join(logs, "tidy-diff.log") }));
    phase("module_download", () => {
      const modules = run(go, ["mod", "download", "-json"], { cwd: source, env, timeout: 25 * 60_000, log: path.join(logs, "module-download.log") });
      writeFileSync(path.join(output, "module-closure.json"), `${JSON.stringify(stableModuleClosure(modules), null, 2)}\n`, { flag: "wx" });
      run(go, ["mod", "verify"], { cwd: source, env, timeout: 10 * 60_000, log: path.join(logs, "module-verify.log") });
    });
    const moduleAfter = ["go.mod", "go.sum"].map((name) => ({ name, ...fileIdentity(path.join(source, name), 8 * 1024 * 1024) }));
    if (JSON.stringify(moduleBefore) !== JSON.stringify(moduleAfter)) throw new Error("scanner_module_files_changed");
    phase("upstream_unit", () => run("/usr/bin/bash", ["--noprofile", "--norc", "-c", `"${go}" tool mage test:unit`], { cwd: source, env, timeout: 85 * 60_000, log: path.join(logs, "upstream-unit.log") }));
    const binary = path.join(output, "trivy");
    phase("build", () => run(go, ["build", "-trimpath", "-buildvcs=false", "-ldflags", `-s -w -buildid= -X=github.com/aquasecurity/trivy/pkg/version/app.ver=${lock.scanner.version}`, "-o", binary, "./cmd/trivy"], { cwd: source, env, timeout: 30 * 60_000, log: path.join(logs, "build.log") }));
    receipt.binary = fileIdentity(binary, 512 * 1024 * 1024);
    const buildInfo = run(go, ["version", "-m", binary], { cwd: source, env });
    writeFileSync(path.join(output, "go-build-info.txt"), buildInfo, { flag: "wx" });
    receipt.buildInfo = fileIdentity(path.join(output, "go-build-info.txt"), 8 * 1024 * 1024);
    receipt.versionOutput = run(binary, ["--version"], { cwd: source, env }).toString("utf8").trim();
    if (!receipt.versionOutput.includes(lock.scanner.version)) throw new Error("scanner_version_mismatch");
    receipt.modules = { before: moduleBefore, after: moduleAfter, closure: fileIdentity(path.join(output, "module-closure.json"), 16 * 1024 * 1024) };
    receipt.runner = { imageOS: process.env.ImageOS ?? "", imageVersion: process.env.ImageVersion ?? "", architecture: process.arch,
      git: run("/usr/bin/git", ["--version"], { cwd: work }).toString("utf8").trim(), tar: run("/usr/bin/tar", ["--version"], { cwd: work }).toString("utf8").split("\n")[0] };
    receipt.result = "passed";
  } catch (error) {
    primaryFailure = error;
  }
  let finalizationFailure;
  try {
    phase("cleanup", () => removeOwnedBuildTree(work, process.env.RUNNER_TEMP));
  } catch (error) {
    receipt.result = "failed";
    finalizationFailure = error;
  }
  try {
    receipt.artifactBytes = directoryBytes(output);
    writeFileSync(path.join(output, "build-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    finalizationFailure ??= error;
  }
  if (primaryFailure) throw primaryFailure;
  if (finalizationFailure) throw finalizationFailure;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  buildScanner(parseBuildArguments(process.argv.slice(2)));
}
