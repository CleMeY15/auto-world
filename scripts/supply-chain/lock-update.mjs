import { createReadStream } from "node:fs";
import { access, lstat, mkdir, readlink, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { createGunzip } from "node:zlib";
import { validateGoCompilerTarArchive, validateNativeSourceTarArchive, validateTarArchive } from "./archive.mjs";
import { canonicalJsonBuffer, sha256 } from "./strict-json.mjs";
import {
  MATERIAL_LIMITS,
  materialError,
  readBoundedJsonFile,
  sha256File,
  validateMaterialLock,
  validateMaterialProposal,
  validateSourceSelection,
} from "./materials.mjs";
import { runCommand } from "./process.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SELECTION = path.join(REPOSITORY_ROOT, "infra/supply-chain/native-sources.json");
const LINUX_BINARIES = Object.freeze({
  bash: "/usr/bin/bash", curl: "/usr/bin/curl", git: "/usr/bin/git", gpg: "/usr/bin/gpg",
  gzip: "/usr/bin/gzip", make: "/usr/bin/make", openssl: "/usr/bin/openssl", tar: "/usr/bin/tar",
  gcc: "/usr/bin/gcc", unshare: "/usr/bin/unshare",
});

function usage() {
  return "usage: lock-update.mjs propose --tool <oras|cosign|trivy> --workspace <absolute> --output <absolute.json> [--selection <absolute.json>] | merge --proposal <absolute.json> (three times) --output <absolute.json> [--selection <absolute.json>]";
}

function safeErrorCode(error) {
  const materialPrefix = "material_contract:";
  const candidate = typeof error?.code === "string" ? error.code
    : typeof error?.message === "string" && error.message.startsWith(materialPrefix) ? error.message.slice(materialPrefix.length)
      : "phase_failed";
  return /^[A-Za-z0-9_]{1,96}$/u.test(candidate) ? candidate : "phase_failed";
}

function emitDiagnostic(phase, status, code, durationMs) {
  process.stdout.write(`${canonicalJsonBuffer({ phase, status, code, durationMs }).toString("utf8")}\n`);
}

async function runPhase(phase, operation) {
  const started = Date.now();
  emitDiagnostic(phase, "started", "ok", 0);
  try {
    const result = await operation();
    emitDiagnostic(phase, "passed", "ok", Date.now() - started);
    return result;
  } catch (error) {
    emitDiagnostic(phase, "failed", safeErrorCode(error), Date.now() - started);
    if (error && typeof error === "object") error.diagnosticEmitted = true;
    throw error;
  }
}

export function parseLockUpdateArgs(argv) {
  if (!Array.isArray(argv) || !new Set(["propose", "merge"]).has(argv[0])) materialError("lock_update_command_invalid");
  const command = argv[0];
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) materialError("lock_update_arguments_invalid");
    const key = flag.slice(2);
    if (!new Set(["tool", "workspace", "output", "selection", "proposal"]).has(key)) materialError("lock_update_argument_unknown");
    if (key !== "proposal" && values.has(key)) materialError("lock_update_argument_duplicate");
    if (key === "proposal") values.set(key, [...(values.get(key) ?? []), value]);
    else values.set(key, value);
  }
  const selection = path.resolve(values.get("selection") ?? DEFAULT_SELECTION);
  const output = values.get("output");
  if (!output || !path.isAbsolute(output)) materialError("lock_update_output_must_be_absolute");
  if (command === "propose") {
    const tool = values.get("tool");
    const workspace = values.get("workspace");
    if (!new Set(["oras", "cosign", "trivy"]).has(tool) || !workspace || !path.isAbsolute(workspace) || values.has("proposal")) materialError("lock_update_propose_arguments_invalid");
    return { command, tool, workspace: path.resolve(workspace), output: path.resolve(output), selection };
  }
  const proposals = values.get("proposal") ?? [];
  if (proposals.length !== 3 || values.has("tool") || values.has("workspace") || proposals.some((item) => !path.isAbsolute(item))) materialError("lock_update_merge_arguments_invalid");
  return { command, proposals: proposals.map((item) => path.resolve(item)), output: path.resolve(output), selection };
}

function safeEnvironment(workspace, extra = {}) {
  return {
    HOME: path.join(workspace, "home"), TMPDIR: path.join(workspace, "tmp"), LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
    PATH: "/usr/local/bin:/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", ...extra,
  };
}

function gitArgs(args) {
  return ["-c", "credential.helper=", "-c", "core.askPass=/bin/false", "-c", "core.hooksPath=/dev/null",
    "-c", "protocol.file.allow=never", "-c", "submodule.recurse=false", ...args];
}

async function runGit(args, cwd, workspace, timeoutMs = 60_000) {
  return runCommand(LINUX_BINARIES.git, gitArgs(args), {
    cwd, env: safeEnvironment(workspace), timeoutMs, maxOutputBytes: 32 * 1024 * 1024,
  });
}

export function validateGitTree(bytes, allowedSymlinks = []) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    materialError("source_git_tree_encoding_invalid");
  }
  const records = text.split("\0").filter(Boolean);
  if (records.length === 0 || records.length > MATERIAL_LIMITS.closureEntries) materialError("source_git_tree_count_invalid");
  let totalBytes = 0;
  const paths = new Set();
  const expectedSymlinks = new Map(allowedSymlinks.map((entry) => [entry.path, entry]));
  const observedSymlinks = new Set();
  for (const record of records) {
    const match = /^(100644|100755|120000) blob ([0-9a-f]{40}) +([0-9]+)\t([^\0]+)$/u.exec(record);
    if (!match) materialError("source_git_tree_entry_refused");
    const name = match[4];
    const hasControl = [...name].some((character) => character.codePointAt(0) <= 0x1f || character.codePointAt(0) === 0x7f);
    if (name.startsWith("/") || name.includes("\\") || hasControl || /^[A-Za-z]:/u.test(name) ||
        name.split("/").some((part) => part === "" || part === "." || part === "..") || paths.has(name)) {
      materialError("source_git_tree_path_refused");
    }
    paths.add(name);
    const size = Number(match[3]);
    if (!Number.isSafeInteger(size) || size > MATERIAL_LIMITS.archiveBytes) materialError("source_git_tree_file_size_invalid");
    if (match[1] === "120000") {
      const expected = expectedSymlinks.get(name);
      if (!expected || expected.blob !== match[2] || expected.size !== size || observedSymlinks.has(name)) materialError("source_git_tree_symlink_refused");
      observedSymlinks.add(name);
    }
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MATERIAL_LIMITS.closureBytes) materialError("source_git_tree_bytes_exceeded");
  }
  if (observedSymlinks.size !== expectedSymlinks.size) materialError("source_git_tree_symlink_missing");
  return records.length;
}

export async function fetchExactSource(selected, workspace, phase = (_name, operation) => operation()) {
  const prefix = `${selected.repository.split("/")[1]}-${selected.commit}`;
  const sourceDirectory = path.join(workspace, prefix);
  await phase("source_fetch", async () => {
    await mkdir(sourceDirectory);
    await runGit(["init", "--quiet", "--template=", sourceDirectory], workspace, workspace);
    await runGit(["-C", sourceDirectory, "remote", "add", "origin", selected.sourceRepositoryUrl], workspace, workspace);
    await runGit(["-C", sourceDirectory, "fetch", "--quiet", "--depth=1", "--no-tags", "origin", selected.commit], workspace, workspace, 10 * 60 * 1000);
    const fetched = (await runGit(["-C", sourceDirectory, "rev-parse", "FETCH_HEAD^{commit}"], workspace, workspace)).stdout.toString("utf8").trim();
    if (fetched !== selected.commit) materialError("source_git_commit_mismatch");
  });
  return phase("tree_check", async () => {
    const tree = (await runGit(["-C", sourceDirectory, "rev-parse", `${selected.commit}^{tree}`], workspace, workspace)).stdout.toString("utf8").trim();
    if (!/^[0-9a-f]{40}$/u.test(tree)) materialError("source_git_tree_invalid");
    const listing = await runGit(["-C", sourceDirectory, "ls-tree", "-r", "-l", "-z", "--full-tree", selected.commit], workspace, workspace);
    validateGitTree(listing.stdout, selected.sourceSymlinks);
    await runGit(["-C", sourceDirectory, "checkout", "--quiet", "--detach", selected.commit], workspace, workspace);
    await validateCheckedOutSource(sourceDirectory, selected.sourceSymlinks);
    const epochText = (await runGit(["-C", sourceDirectory, "show", "-s", "--format=%ct", selected.commit], workspace, workspace)).stdout.toString("utf8").trim();
    const sourceDateEpoch = Number(epochText);
    if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 1) materialError("source_date_epoch_invalid");
    return { prefix, sourceDirectory, sourceDateEpoch, sourceTree: tree, tool: selected.name };
  });
}

export async function canonicalSourceArchive({ prefix, sourceDateEpoch, tool }, workspace, phase = (_name, operation) => operation()) {
  return phase("archive", async () => {
    const tarPath = path.join(workspace, `${prefix}.tar`);
    await runCommand(LINUX_BINARIES.tar, ["--format=ustar", "--sort=name", `--mtime=@${sourceDateEpoch}`, "--owner=0", "--group=0", "--numeric-owner", `--exclude=${prefix}/.git`, "-cf", tarPath, prefix], {
      cwd: workspace, env: safeEnvironment(workspace), timeoutMs: 120_000, maxOutputBytes: 1024 * 1024,
    });
    const source = createReadStream(tarPath);
    await validateNativeSourceTarArchive(source, { closeStreams: [source], expectedPrefix: prefix, tool });
    await runCommand(LINUX_BINARIES.gzip, ["-n", "-9", tarPath], { cwd: workspace, env: safeEnvironment(workspace), timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 });
    const archivePath = `${tarPath}.gz`;
    await validateNativeGzipTar(archivePath, prefix, tool);
    return { archivePath, digest: await sha256File(archivePath) };
  });
}

async function requireLinuxProposalRuntime(tool, workspace, output) {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || !process.env.ImageVersion) {
    materialError("proposal_requires_secret_free_github_actions_linux");
  }
  if (!process.env.RUNNER_TEMP || !path.isAbsolute(process.env.RUNNER_TEMP)) materialError("proposal_runner_temp_invalid");
  const runnerTemp = await realpath(process.env.RUNNER_TEMP);
  if (path.dirname(workspace) !== runnerTemp || path.basename(workspace) !== `auto-world-native-${tool}` ||
      path.dirname(output) !== runnerTemp || path.basename(output) !== `native-lock-${tool}.json`) materialError("proposal_owned_path_invalid");
  try {
    await lstat(workspace);
    materialError("proposal_workspace_exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const executable of Object.values(LINUX_BINARIES)) await access(executable);
}

async function download(url, destination, cwd, maximumBytes = MATERIAL_LIMITS.archiveBytes) {
  await runCommand(LINUX_BINARIES.curl, ["--fail", "--location", "--proto", "=https", "--tlsv1.2", "--max-filesize", String(maximumBytes), "--max-time", "600", "--output", destination, url], {
    cwd, env: safeEnvironment(cwd), timeoutMs: 10 * 60 * 1000, maxOutputBytes: 1024 * 1024,
  });
  return sha256File(destination, maximumBytes);
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
  if (entries.length === 0 || entries.some((entry) => entry.path !== expectedPrefix && !entry.path.startsWith(`${expectedPrefix}/`))) {
    materialError("source_archive_path_invalid");
  }
  return entries;
}

async function validateGoCompilerGzipTar(filePath) {
  const source = createReadStream(filePath);
  const gunzip = createGunzip();
  return validateGoCompilerTarArchive(source.pipe(gunzip), { closeStreams: [source] });
}

async function validateNativeGzipTar(filePath, expectedPrefix, tool) {
  const source = createReadStream(filePath);
  const gunzip = createGunzip();
  return validateNativeSourceTarArchive(source.pipe(gunzip), { closeStreams: [source], expectedPrefix, tool });
}

export async function validateCheckedOutSource(directory, allowedSymlinks = []) {
  let entries = 0;
  let bytes = 0;
  const pending = [directory];
  const expectedSymlinks = new Map(allowedSymlinks.map((entry) => [entry.path, entry]));
  const observedSymlinks = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > MATERIAL_LIMITS.closureEntries) materialError("source_closure_entries_exceeded");
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const relative = path.relative(directory, target).replaceAll("\\", "/");
        const expected = expectedSymlinks.get(relative);
        const linkTarget = await readlink(target);
        if (!expected || observedSymlinks.has(relative) || linkTarget !== expected.target || Buffer.byteLength(linkTarget) !== expected.size) {
          materialError("source_closure_symlink_refused");
        }
        observedSymlinks.add(relative);
        bytes += expected.size;
        continue;
      }
      if (!entry.isDirectory() && !entry.isFile()) materialError("source_closure_unsupported_entry");
      if (entry.isDirectory()) pending.push(target);
      else {
        bytes += (await stat(target)).size;
        if (bytes > MATERIAL_LIMITS.closureBytes) materialError("source_closure_bytes_exceeded");
      }
    }
  }
  if (observedSymlinks.size !== expectedSymlinks.size) materialError("source_closure_symlink_missing");
  return { entries, bytes };
}

function parseJsonSequence(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const values = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") { if (depth === 0) start = index; depth += 1; }
    else if (character === "}") {
      depth -= 1;
      if (depth < 0) materialError("module_json_invalid");
      if (depth === 0) values.push(JSON.parse(text.slice(start, index + 1)));
    } else if (depth === 0 && !/\s/u.test(character)) materialError("module_json_invalid");
  }
  if (depth !== 0 || quoted || values.length === 0) materialError("module_json_invalid");
  return values;
}

async function moduleClosure(goExecutable, sourceDirectory, environment) {
  const result = await runCommand(goExecutable, ["mod", "download", "-json", "all"], {
    cwd: sourceDirectory, env: environment, timeoutMs: 20 * 60 * 1000, maxOutputBytes: 64 * 1024 * 1024,
  });
  const modules = [];
  for (const entry of parseJsonSequence(result.stdout)) {
    if (entry.Error || typeof entry.Path !== "string" || typeof entry.Version !== "string" || typeof entry.Sum !== "string" || typeof entry.GoModSum !== "string" || typeof entry.Zip !== "string") {
      materialError("module_closure_incomplete");
    }
    const zip = await sha256File(entry.Zip);
    modules.push({ path: entry.Path, version: entry.Version, sum: entry.Sum, goModSum: entry.GoModSum, zipSha256: zip.sha256, zipSize: zip.size });
  }
  modules.sort((left, right) => `${left.path}@${left.version}`.localeCompare(`${right.path}@${right.version}`, "en"));
  if (new Set(modules.map((entry) => `${entry.path}@${entry.version}`)).size !== modules.length) materialError("module_closure_duplicate");
  return modules;
}

async function utilityInventory(workspace) {
  const utilities = [];
  for (const [name, executable] of Object.entries(LINUX_BINARIES)) {
    const args = name === "openssl" ? ["version"] : ["--version"];
    const result = await runCommand(executable, args, { cwd: workspace, env: safeEnvironment(workspace), timeoutMs: 10_000, maxOutputBytes: 256 * 1024 });
    const identity = result.stdout.toString("utf8").split(/\r?\n/u)[0].slice(0, 500);
    if (!identity) materialError("runner_utility_identity_missing");
    utilities.push({ name, path: executable, identity });
  }
  return utilities;
}

export async function collectRecipeFiles(selected) {
  const recipeFiles = [];
  let missing = false;
  for (const relative of selected.recipeFiles) {
    const absolute = path.join(REPOSITORY_ROOT, relative);
    if (!absolute.startsWith(`${path.join(REPOSITORY_ROOT, "scripts/supply-chain")}${path.sep}`)) materialError("recipe_path_refused");
    try {
      recipeFiles.push({ path: relative, ...await sha256File(absolute, 1024 * 1024) });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing = true;
    }
  }
  return { recipeFiles, missing };
}

async function prepareTrivyTestMaterials(workspace, epoch) {
  const assets = path.join(workspace, "proposal-assets", "trivy");
  await mkdir(assets, { recursive: true });
  const rpmName = "socat-1.7.3.2-2.el7.x86_64.rpm";
  const rpmUrl = `https://mirror.openshift.com/pub/openshift-v4/amd64/dependencies/rpms/4.10-beta/${rpmName}`;
  const rpmPath = path.join(assets, rpmName);
  const rpm = await download(rpmUrl, rpmPath, workspace);
  if (rpm.sha256 !== "629571bd05c7ae50170a7a94d2b987489e7f50de7d733955f70fb8e396831ba9" || rpm.size !== 296_692) {
    materialError("trivy_rpm_identity_mismatch");
  }

  const fixtureCommit = "8a19b492a589955c3e70c6ad8efd1e4ec6ae0d35";
  const fixtureDirectory = path.join(workspace, "test-repo");
  await runCommand(LINUX_BINARIES.git, ["-c", "credential.helper=", "-c", "core.askPass=/bin/false", "clone", "--no-checkout", "https://github.com/aquasecurity/trivy-test-repo.git", fixtureDirectory], {
    cwd: workspace, env: safeEnvironment(workspace), timeoutMs: 120_000, maxOutputBytes: 4 * 1024 * 1024,
  });
  const git = (args) => runCommand(LINUX_BINARIES.git, ["-C", fixtureDirectory, ...args], {
    cwd: workspace, env: safeEnvironment(workspace), timeoutMs: 60_000, maxOutputBytes: 4 * 1024 * 1024,
  });
  await git(["checkout", "--detach", fixtureCommit]);
  const remoteMain = (await git(["rev-parse", "refs/remotes/origin/main^{commit}"])).stdout.toString("utf8").trim();
  const remoteBranch = (await git(["rev-parse", "refs/remotes/origin/valid-branch^{commit}"])).stdout.toString("utf8").trim();
  const tag = (await git(["rev-parse", "refs/tags/v0.0.1^{commit}"])).stdout.toString("utf8").trim();
  if ([remoteMain, remoteBranch, tag].some((identity) => identity !== fixtureCommit)) materialError("trivy_git_fixture_refs_mismatch");
  await git(["branch", "-f", "main", fixtureCommit]);
  await git(["branch", "-f", "valid-branch", fixtureCommit]);
  await git(["symbolic-ref", "HEAD", "refs/heads/main"]);
  await git(["reset", "--hard", fixtureCommit]);
  const tree = (await git(["rev-parse", `${fixtureCommit}^{tree}`])).stdout.toString("utf8").trim();
  const parent = (await git(["rev-parse", `${fixtureCommit}^`])).stdout.toString("utf8").trim();
  if (tree !== "028f8b12792c2084211d02d883e3368ca87cc92f" || parent !== "d8920bebc6dceeadbf15f246eb9201fa387c70da") materialError("trivy_git_fixture_object_mismatch");
  await git(["reflog", "expire", "--expire=now", "--all"]);
  const gitArchivePath = path.join(assets, "test-repo-git-worktree.tar.gz");
  await runCommand(LINUX_BINARIES.tar, ["--sort=name", `--mtime=@${epoch}`, "--owner=0", "--group=0", "--numeric-owner", "-czf", gitArchivePath, "test-repo"], {
    cwd: workspace, env: safeEnvironment(workspace), timeoutMs: 120_000, maxOutputBytes: 1024 * 1024,
  });
  const gitArchive = await sha256File(gitArchivePath);
  await validateGzipTar(gitArchivePath, "test-repo");
  return [
    { name: "trivy-test-repo-git-worktree", kind: "git-fixture-archive", origin: "https://github.com/aquasecurity/trivy-test-repo", path: "infra/supply-chain/materials/trivy/test-repo-git-worktree.tar.gz", ...gitArchive },
    { name: "trivy-socat-rpm", kind: "rpm-fixture", origin: rpmUrl, path: `infra/supply-chain/materials/trivy/${rpmName}`, ...rpm },
  ];
}

export async function proposeMaterialLock({ tool, workspace, output, selection: selectionPath }) {
  await requireLinuxProposalRuntime(tool, workspace, output);
  const selection = validateSourceSelection(readBoundedJsonFile(selectionPath));
  const selectionSha256 = sha256(canonicalJsonBuffer(selection));
  const selected = selection.tools.find((entry) => entry.name === tool);
  await mkdir(workspace, { recursive: false });
  await Promise.all([mkdir(path.join(workspace, "home")), mkdir(path.join(workspace, "tmp"))]);
  const compilerArchivePath = path.join(workspace, "go-linux.tar.gz");
  const sourceIdentity = await fetchExactSource(selected, workspace, runPhase);
  const sourceArchive = await canonicalSourceArchive(sourceIdentity, workspace, runPhase);
  const compilerSelection = selection.compiler.archives.find((entry) => entry.goos === "linux");
  const compilerArchive = await runPhase("compiler_verify", async () => {
    const digest = await download(compilerSelection.url, compilerArchivePath, workspace);
    if (digest.sha256 !== compilerSelection.sha256) materialError("compiler_archive_digest_mismatch");
    await validateGoCompilerGzipTar(compilerArchivePath);
    return digest;
  });

  const sourceDirectory = sourceIdentity.sourceDirectory;

  const compilerDirectory = path.join(workspace, "compiler");
  await mkdir(compilerDirectory);
  await runCommand(LINUX_BINARIES.tar, ["-xzf", compilerArchivePath, "-C", compilerDirectory, "--no-same-owner", "--no-same-permissions"], { cwd: workspace, env: safeEnvironment(workspace), timeoutMs: 120_000, maxOutputBytes: 1024 * 1024 });
  const goExecutable = path.join(compilerDirectory, "go/bin/go");
  const goPath = path.join(workspace, "gopath");
  const goCache = path.join(workspace, "gocache");
  const goModCache = path.join(workspace, "gomodcache");
  await Promise.all([mkdir(goPath), mkdir(goCache), mkdir(goModCache)]);
  const goEnvironment = safeEnvironment(workspace, {
    GOPATH: goPath, GOCACHE: goCache, GOMODCACHE: goModCache, GOTOOLCHAIN: "local",
    GOPROXY: "https://proxy.golang.org", GOSUMDB: "sum.golang.org", GOFLAGS: "-mod=readonly",
  });

  const blockers = ["required-source-evidence-closure-not-yet-implemented"];
  if (tool === "trivy") blockers.push("grpc-1.83.1-and-local-fixture-loader-exact-patches-not-yet-committed");
  if (tool === "oras") blockers.push("oras-release-gpg-and-github-signature-evidence-not-yet-byte-locked");
  const recipe = await collectRecipeFiles(selected);
  if (recipe.missing) blockers.push("required-native-test-harness-not-yet-committed");
  const sourceDateEpoch = sourceIdentity.sourceDateEpoch;
  const modules = await runPhase("modules", () => moduleClosure(goExecutable, sourceDirectory, goEnvironment));
  const testMaterials = await runPhase("fixtures", () => tool === "trivy" ? prepareTrivyTestMaterials(workspace, sourceDateEpoch) : Promise.resolve([]));
  const proposal = {
    schemaVersion: 1,
    state: "material_lock_proposal",
    selectionSha256,
    tool,
    sourceTree: sourceIdentity.sourceTree,
    sourceArchive: sourceArchive.digest,
    compilerArchive: { goos: "linux", ...compilerArchive },
    modules,
    patches: [],
    testMaterials,
    sourceDateEpoch,
    recipeFiles: recipe.recipeFiles,
    recipeSha256: sha256(canonicalJsonBuffer({
      tool, commit: selected.commit, modifiedVersion: selected.modifiedVersion, targets: selected.targets,
      compiler: selection.compiler.version, tests: selected.upstreamTests, patchPolicy: selected.patchPolicy,
      recipeFiles: recipe.recipeFiles,
    })),
    managedRunner: { label: selection.managedRunner.label, imageVersion: process.env.ImageVersion, utilities: await utilityInventory(workspace) },
    complete: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
  };
  await runPhase("proposal_write", async () => {
    validateMaterialProposal(proposal, selectionSha256, tool, selected.patchPolicy.allowedKinds);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, canonicalJsonBuffer(proposal));
  });
  return proposal;
}

export async function mergeMaterialProposals({ proposals: proposalPaths, output, selection: selectionPath }) {
  const selection = validateSourceSelection(readBoundedJsonFile(selectionPath));
  const selectionSha256 = sha256(canonicalJsonBuffer(selection));
  const proposals = proposalPaths.map((proposalPath) => {
    const candidate = readBoundedJsonFile(proposalPath);
    const selected = selection.tools.find((entry) => entry.name === candidate?.tool);
    if (!selected) materialError("merge_tool_not_selected");
    return validateMaterialProposal(candidate, selectionSha256, selected.name, selected.patchPolicy.allowedKinds);
  });
  proposals.sort((left, right) => left.tool.localeCompare(right.tool, "en"));
  if (new Set(proposals.map((entry) => entry.tool)).size !== 3) materialError("merge_tool_set_invalid");
  if (proposals.some((entry) => !entry.complete)) materialError("merge_incomplete_proposal_refused");
  const lock = { schemaVersion: 1, state: "material_locked", selectionSha256, proposals };
  validateMaterialLock(lock, selection);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, canonicalJsonBuffer(lock));
  return lock;
}

async function main() {
  const args = parseLockUpdateArgs(process.argv.slice(2));
  if (args.command === "propose") {
    const proposal = await proposeMaterialLock(args);
    if (!proposal.complete) {
      process.stderr.write(`material_proposal_incomplete:${proposal.blockers.join(",")}\n`);
      process.exitCode = 2;
    }
  } else await mergeMaterialProposals(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (!error?.diagnosticEmitted) emitDiagnostic("bootstrap", "failed", safeErrorCode(error), 0);
    process.stderr.write(`${error?.message?.startsWith("material_contract:") ? error.message : "material_lock_update_failed"}\n${usage()}\n`);
    process.exitCode = 1;
  });
}
