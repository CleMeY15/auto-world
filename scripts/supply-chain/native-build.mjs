import { createReadStream } from "node:fs";
import { access, chmod, copyFile, lstat, mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { createGunzip } from "node:zlib";
import { validateTarArchive } from "./archive.mjs";
import { canonicalJsonBuffer, sha256 } from "./strict-json.mjs";
import { canonicalSourceArchive, collectRecipeFiles, fetchExactSource } from "./lock-update.mjs";
import {
  MATERIAL_LIMITS,
  assertDigest,
  materialError,
  readBoundedJsonFile,
  sha256File,
  validateMaterialLock,
  validateSourceSelection,
} from "./materials.mjs";
import { runCommand } from "./process.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SELECTION_PATH = path.join(REPOSITORY_ROOT, "infra/supply-chain/native-sources.json");
const LOCK_PATH = path.join(REPOSITORY_ROOT, "infra/supply-chain/native-materials.lock.json");
const BIN = Object.freeze({ curl: "/usr/bin/curl", git: "/usr/bin/git", make: "/usr/bin/make", tar: "/usr/bin/tar" });

function environment(workspace, goRoot, extra = {}) {
  return {
    HOME: path.join(workspace, "home"), TMPDIR: path.join(workspace, "tmp"), LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
    PATH: `${path.join(goRoot, "bin")}:/usr/local/bin:/usr/bin:/bin`, GOPATH: path.join(workspace, "gopath"),
    GOCACHE: path.join(workspace, "gocache"), GOMODCACHE: path.join(workspace, "gomodcache"), GOTOOLCHAIN: "local",
    GOPROXY: "https://proxy.golang.org", GOSUMDB: "sum.golang.org", GOFLAGS: "-mod=readonly", ...extra,
  };
}

export function parseNativeBuildArgs(argv) {
  if (argv[0] !== "build") materialError("native_build_command_invalid");
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) materialError("native_build_arguments_invalid");
    const key = flag.slice(2);
    if (!new Set(["tool", "lock", "workspace", "output", "repeat"]).has(key) || values.has(key)) materialError("native_build_argument_refused");
    values.set(key, value);
  }
  const tool = values.get("tool");
  const lock = path.resolve(values.get("lock") ?? "");
  const workspace = values.get("workspace");
  const output = values.get("output");
  const repeat = Number(values.get("repeat"));
  if (!new Set(["oras", "cosign", "trivy"]).has(tool) || lock !== LOCK_PATH || !workspace || !path.isAbsolute(workspace) || !output || !path.isAbsolute(output) || !new Set([1, 2]).has(repeat)) {
    materialError("native_build_arguments_invalid");
  }
  return { tool, lock, workspace: path.resolve(workspace), output: path.resolve(output), repeat };
}

async function download(url, destination, cwd) {
  await runCommand(BIN.curl, ["--fail", "--location", "--proto", "=https", "--tlsv1.2", "--max-filesize", String(MATERIAL_LIMITS.archiveBytes), "--max-time", "600", "--output", destination, url], {
    cwd, env: environment(cwd, path.join(cwd, "unused")), timeoutMs: 10 * 60 * 1000, maxOutputBytes: 1024 * 1024,
  });
  return sha256File(destination);
}

async function validateGzipTar(filePath, expectedPrefix) {
  const source = createReadStream(filePath);
  const gunzip = createGunzip();
  const entries = await validateTarArchive(source.pipe(gunzip), {
    maxArchiveBytes: MATERIAL_LIMITS.closureBytes,
    maxEntries: MATERIAL_LIMITS.closureEntries,
    maxFileBytes: MATERIAL_LIMITS.archiveBytes,
    maxTotalFileBytes: MATERIAL_LIMITS.closureBytes,
    closeStreams: [source],
  });
  if (entries.length === 0 || entries.some((entry) => entry.path !== expectedPrefix && !entry.path.startsWith(`${expectedPrefix}/`))) materialError("native_build_archive_path_invalid");
}

async function ensureCommittedCleanLock(lockPath, workspace) {
  const relative = path.relative(REPOSITORY_ROOT, lockPath).replaceAll("\\", "/");
  const gitEnvironment = { PATH: "/usr/bin:/bin", HOME: path.join(workspace, "home"), TMPDIR: path.join(workspace, "tmp"), LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  await runCommand(BIN.git, ["-C", REPOSITORY_ROOT, "ls-files", "--error-unmatch", "--", relative], {
    cwd: REPOSITORY_ROOT, env: gitEnvironment, timeoutMs: 10_000,
  });
  try {
    await runCommand(BIN.git, ["-C", REPOSITORY_ROOT, "diff", "--quiet", "--exit-code", "--", relative], {
      cwd: REPOSITORY_ROOT, env: gitEnvironment, timeoutMs: 10_000,
    });
  } catch {
    materialError("native_build_lock_dirty");
  }
}

async function requireBuildRuntime(tool, repeat, workspace, output) {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || !process.env.ImageVersion ||
      !process.env.RUNNER_TEMP || !path.isAbsolute(process.env.RUNNER_TEMP)) materialError("native_build_requires_secret_free_github_actions_linux");
  const runnerTemp = await realpath(process.env.RUNNER_TEMP);
  if (path.dirname(workspace) !== runnerTemp || path.basename(workspace) !== `auto-world-native-build-${tool}-${repeat}` ||
      path.dirname(output) !== runnerTemp || path.basename(output) !== `native-build-${tool}-${repeat}.json`) materialError("native_build_owned_path_invalid");
  try {
    await lstat(workspace);
    materialError("native_build_workspace_exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await Promise.all(Object.values(BIN).map((item) => access(item)));
}

async function scanSourceTree(directory) {
  let count = 0;
  let bytes = 0;
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      count += 1;
      if (count > MATERIAL_LIMITS.closureEntries) materialError("native_build_source_entries_exceeded");
      const item = path.join(current, entry.name);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) materialError("native_build_source_entry_refused");
      if (entry.isDirectory()) pending.push(item);
      else {
        bytes += (await stat(item)).size;
        if (bytes > MATERIAL_LIMITS.closureBytes) materialError("native_build_source_bytes_exceeded");
      }
    }
  }
}

function jsonSequence(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const records = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") { if (depth === 0) start = index; depth += 1; }
    else if (char === "}") { depth -= 1; if (depth === 0) records.push(JSON.parse(text.slice(start, index + 1))); }
    else if (depth === 0 && !/\s/u.test(char)) materialError("native_build_module_json_invalid");
    if (depth < 0) materialError("native_build_module_json_invalid");
  }
  if (depth !== 0 || quoted || records.length === 0) materialError("native_build_module_json_invalid");
  return records;
}

async function verifyModules(go, source, env, expected) {
  const result = await runCommand(go, ["mod", "download", "-json", "all"], { cwd: source, env, timeoutMs: 20 * 60 * 1000, maxOutputBytes: 64 * 1024 * 1024 });
  const actual = [];
  for (const item of jsonSequence(result.stdout)) {
    if (item.Error || !item.Path || !item.Version || !item.Sum || !item.GoModSum || !item.Zip) materialError("native_build_module_closure_incomplete");
    const zip = await sha256File(item.Zip);
    actual.push({ path: item.Path, version: item.Version, sum: item.Sum, goModSum: item.GoModSum, zipSha256: zip.sha256, zipSize: zip.size });
  }
  actual.sort((left, right) => `${left.path}@${left.version}`.localeCompare(`${right.path}@${right.version}`, "en"));
  if (canonicalJsonBuffer(actual).compare(canonicalJsonBuffer(expected)) !== 0) materialError("native_build_module_closure_drift");
  await runCommand(go, ["mod", "verify"], { cwd: source, env, timeoutMs: 10 * 60 * 1000, maxOutputBytes: 8 * 1024 * 1024 });
}

async function runGo(go, args, cwd, env, timeoutMs) {
  return runCommand(go, args, { cwd, env, timeoutMs, maxOutputBytes: 64 * 1024 * 1024 });
}

async function runUpstreamTests(tool, selected, go, source, env) {
  const timeout = selected.timeoutMinutes * 60 * 1000;
  if (tool === "oras") {
    const before = await Promise.all([sha256File(path.join(source, "go.mod")), sha256File(path.join(source, "go.sum"))]);
    await runCommand(BIN.make, [`GO_EXE=${go}`, "test"], { cwd: source, env: { ...env, CGO_ENABLED: "1", GOFLAGS: "" }, timeoutMs: timeout, maxOutputBytes: 64 * 1024 * 1024 });
    const after = await Promise.all([sha256File(path.join(source, "go.mod")), sha256File(path.join(source, "go.sum"))]);
    if (canonicalJsonBuffer(before).compare(canonicalJsonBuffer(after)) !== 0) materialError("oras_upstream_test_changed_module_lock");
  } else if (tool === "cosign") {
    await runGo(go, ["test", "./cmd/cosign/cli/generate", "./cmd/cosign/cli/sign", "./cmd/cosign/cli/verify"], source, { ...env, CGO_ENABLED: "0" }, timeout);
    const list = await runGo(go, ["list", "./..."], source, env, 5 * 60 * 1000);
    const packages = list.stdout.toString("utf8").split(/\r?\n/u).filter((entry) => entry && !entry.includes("/third_party/"));
    if (packages.length === 0 || packages.length > 900) materialError("cosign_package_list_invalid");
    await runCommand(BIN.make, [`GOEXE=${go}`, "test"], { cwd: source, env: { ...env, CGO_ENABLED: "0" }, timeoutMs: timeout, maxOutputBytes: 64 * 1024 * 1024 });
    await runGo(go, ["test", "-race", ...packages], source, { ...env, CGO_ENABLED: "1" }, timeout);
  } else {
    await runGo(go, ["run", "tool", "mage", "test:unit"], source, { ...env, CGO_ENABLED: "0", GOEXPERIMENT: "jsonv2" }, timeout);
  }
}

async function buildOutputs(tool, selected, proposal, go, source, env, out) {
  const outputs = [];
  const date = new Date(proposal.sourceDateEpoch * 1000).toISOString().replace(".000Z", "Z");
  const build = async (target, filename, ldflags, packagePath) => {
    const [goos, goarch] = target.split("-");
    const destination = path.join(out, filename);
    await runGo(go, ["build", "-trimpath", "-buildvcs=false", "-ldflags", ldflags, "-o", destination, packagePath], source, {
      ...env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0", ...(tool === "trivy" ? { GOEXPERIMENT: "jsonv2" } : {}),
    }, selected.timeoutMinutes * 60 * 1000);
    const digest = await sha256File(destination, MATERIAL_LIMITS.binaryBytes);
    const info = await runGo(go, ["version", "-m", destination], source, env, 60_000);
    const buildInfo = info.stdout.toString("utf8").split(/\r?\n/u).slice(1).filter(Boolean).map((line) => line.trim());
    if (buildInfo.length === 0 || buildInfo.some((line) => line.length > 16_384)) materialError("native_build_info_invalid");
    outputs.push({ target, path: `out/${filename}`, ...digest, buildInfo, buildInfoSha256: sha256(canonicalJsonBuffer(buildInfo)) });
  };
  if (tool === "oras") {
    await build("linux-amd64", "oras", `-w -buildid= -X oras.land/oras/internal/version.Version=${selected.modifiedVersion} -X oras.land/oras/internal/version.GitCommit=${selected.commit} -X oras.land/oras/internal/version.GitTreeState=clean`, "./cmd/oras");
  } else if (tool === "cosign") {
    const flags = `-buildid= -X sigs.k8s.io/release-utils/version.gitVersion=${selected.modifiedVersion} -X sigs.k8s.io/release-utils/version.gitCommit=${selected.commit} -X sigs.k8s.io/release-utils/version.gitTreeState=clean -X sigs.k8s.io/release-utils/version.buildDate=${date}`;
    await build("linux-amd64", "cosign", flags, "./cmd/cosign");
    await build("windows-amd64", "cosign.exe", flags, "./cmd/cosign");
  } else {
    await build("linux-amd64", "trivy", `-s -w -buildid= -X=github.com/aquasecurity/trivy/pkg/version/app.ver=${selected.modifiedVersion}`, "./cmd/trivy");
  }
  return outputs;
}

async function materializeTestData(tool, proposal, source) {
  if (tool !== "trivy") return;
  const destinations = new Map([
    ["trivy-test-repo-git-worktree", "internal/gittest/testdata/locked/test-repo-git-worktree.tar.gz"],
    ["trivy-socat-rpm", "pkg/fanal/analyzer/pkg/rpm/testdata/locked/socat-1.7.3.2-2.el7.x86_64.rpm"],
  ]);
  for (const material of proposal.testMaterials) {
    const relativeDestination = destinations.get(material.name);
    if (!relativeDestination) materialError("native_build_test_material_unknown");
    const sourcePath = path.join(REPOSITORY_ROOT, material.path);
    if (!sourcePath.startsWith(`${path.join(REPOSITORY_ROOT, "infra/supply-chain/materials")}${path.sep}`)) materialError("native_build_test_material_path_refused");
    assertDigest(await sha256File(sourcePath), material, material.name);
    const destination = path.join(source, relativeDestination);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(sourcePath, destination);
  }
}

export async function buildNativeCandidate({ tool, lock: lockPath, workspace, output, repeat }) {
  await requireBuildRuntime(tool, repeat, workspace, output);
  await mkdir(workspace, { recursive: false });
  await Promise.all(["home", "tmp", "gopath", "gocache", "gomodcache", "out"].map((item) => mkdir(path.join(workspace, item))));
  await ensureCommittedCleanLock(lockPath, workspace);
  const selection = validateSourceSelection(readBoundedJsonFile(SELECTION_PATH));
  const lock = validateMaterialLock(readBoundedJsonFile(lockPath), selection);
  const selected = selection.tools.find((entry) => entry.name === tool);
  const proposal = lock.proposals.find((entry) => entry.tool === tool);
  if (!proposal || proposal.managedRunner.imageVersion !== process.env.ImageVersion) materialError("native_build_runner_identity_mismatch");
  const recipe = await collectRecipeFiles(selected);
  const recipeSha256 = sha256(canonicalJsonBuffer({
    tool, commit: selected.commit, modifiedVersion: selected.modifiedVersion, targets: selected.targets,
    compiler: selection.compiler.version, tests: selected.upstreamTests, patchPolicy: selected.patchPolicy,
    recipeFiles: recipe.recipeFiles,
  }));
  if (recipe.missing || canonicalJsonBuffer(recipe.recipeFiles).compare(canonicalJsonBuffer(proposal.recipeFiles)) !== 0 || recipeSha256 !== proposal.recipeSha256) {
    materialError("native_build_recipe_drift");
  }
  const compilerArchive = path.join(workspace, "go.tar.gz");
  const sourceIdentity = await fetchExactSource(selected, workspace);
  if (sourceIdentity.sourceTree !== proposal.sourceTree || sourceIdentity.sourceDateEpoch !== proposal.sourceDateEpoch) materialError("native_build_source_identity_drift");
  const sourceArchive = await canonicalSourceArchive(sourceIdentity, workspace);
  assertDigest(sourceArchive.digest, proposal.sourceArchive, "source_archive");
  const compilerSelection = selection.compiler.archives.find((entry) => entry.goos === "linux");
  assertDigest(await download(compilerSelection.url, compilerArchive, workspace), proposal.compilerArchive, "compiler_archive");
  await validateGzipTar(compilerArchive, "go");
  await mkdir(path.join(workspace, "compiler"));
  await runCommand(BIN.tar, ["-xzf", compilerArchive, "-C", path.join(workspace, "compiler"), "--no-same-owner", "--no-same-permissions"], { cwd: workspace, env: environment(workspace, path.join(workspace, "compiler/go")), timeoutMs: 120_000 });
  const source = sourceIdentity.sourceDirectory;
  await scanSourceTree(source);
  for (const patch of proposal.patches) {
    const patchPath = path.join(REPOSITORY_ROOT, patch.path);
    assertDigest(await sha256File(patchPath, 1024 * 1024), patch, `patch_${patch.order}`);
    await runCommand(BIN.git, ["apply", "--check", "--whitespace=error-all", patchPath], { cwd: source, env: environment(workspace, path.join(workspace, "compiler/go")), timeoutMs: 60_000 });
    await runCommand(BIN.git, ["apply", "--whitespace=error-all", patchPath], { cwd: source, env: environment(workspace, path.join(workspace, "compiler/go")), timeoutMs: 60_000 });
  }
  await materializeTestData(tool, proposal, source);
  const go = path.join(workspace, "compiler/go/bin/go");
  await chmod(go, 0o755);
  const env = environment(workspace, path.join(workspace, "compiler/go"), { SOURCE_DATE_EPOCH: String(proposal.sourceDateEpoch) });
  const version = await runGo(go, ["version"], source, env, 60_000);
  if (!version.stdout.toString("utf8").includes("go1.26.8 linux/amd64")) materialError("native_build_compiler_identity_mismatch");
  await verifyModules(go, source, env, proposal.modules);
  await runUpstreamTests(tool, selected, go, source, env);
  const outputs = await buildOutputs(tool, selected, proposal, go, source, env, path.join(workspace, "out"));
  const linuxOutput = path.join(workspace, outputs.find((entry) => entry.target === "linux-amd64").path);
  const versionArgs = tool === "trivy" ? ["--version"] : ["version"];
  const versionResult = await runCommand(linuxOutput, versionArgs, { cwd: workspace, env, timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 });
  const versionText = versionResult.stdout.toString("utf8");
  if (!versionText.includes(selected.modifiedVersion) || versionText.includes(`${selected.version}+${selected.modifiedVersion}`)) materialError("native_build_version_identity_mismatch");
  const record = {
    schemaVersion: 1, state: "built_candidate", tool, repeat, sourceCommit: selected.commit,
    selectionSha256: lock.selectionSha256, materialLockSha256: (await sha256File(lockPath, MATERIAL_LIMITS.receiptBytes)).sha256,
    recipeSha256: proposal.recipeSha256, compilerVersion: selection.compiler.version,
    runner: { label: selection.managedRunner.label, imageVersion: process.env.ImageVersion },
    versionOutputSha256: sha256(versionResult.stdout), outputs,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, canonicalJsonBuffer(record));
  return record;
}

async function main() {
  await buildNativeCandidate(parseNativeBuildArgs(process.argv.slice(2)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message?.startsWith("material_contract:") ? error.message : "native_build_failed"}\n`);
    process.exitCode = 1;
  });
}
