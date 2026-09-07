import { createHash } from "node:crypto";
import { closeSync, createReadStream, fstatSync, openSync, readSync } from "node:fs";
import { canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";

export const MATERIAL_LIMITS = Object.freeze({
  binaryBytes: 512 * 1024 * 1024,
  archiveBytes: 2 * 1024 * 1024 * 1024,
  closureBytes: 4 * 1024 * 1024 * 1024,
  closureEntries: 200_000,
  receiptBytes: 8 * 1024 * 1024,
  receiptMembers: 100_000,
  receiptDepth: 32,
});

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const TOOL_NAMES = new Set(["oras", "cosign", "trivy"]);
const TARGETS = new Set(["linux-amd64", "windows-amd64"]);
export const MANAGED_RUNNER_UTILITY_PATHS = Object.freeze({
  bash: "/usr/bin/bash",
  curl: "/usr/bin/curl",
  gcc: "/usr/bin/gcc",
  git: "/usr/bin/git",
  gpg: "/usr/bin/gpg",
  gzip: "/usr/bin/gzip",
  make: "/usr/bin/make",
  openssl: "/usr/bin/openssl",
  tar: "/usr/bin/tar",
  unshare: "/usr/bin/unshare",
});
const MANAGED_RUNNER_UTILITY_NAMES = Object.freeze(Object.keys(MANAGED_RUNNER_UTILITY_PATHS));
const TRIVY_SOURCE_SYMLINKS = Object.freeze([
  { path: "pkg/fanal/analyzer/language/golang/binary/testdata/symlink", target: "foo", blob: "19102815663d23f8b75a47e7a01965dcdc96468c", size: 3 },
  { path: "pkg/fanal/analyzer/language/rust/binary/testdata/symlink", target: "foo", blob: "19102815663d23f8b75a47e7a01965dcdc96468c", size: 3 },
  { path: "pkg/fanal/walker/testdata/fs/sym.txt", target: "bar", blob: "ba0e162e1c47469e3fe4b393a8bf8c569f302116", size: 3 },
]);
export const TRIVY_WASM_INPUTS = Object.freeze([
  { path: "pkg/module/testdata/analyzer/analyzer.go", output: "pkg/module/testdata/analyzer/analyzer.wasm", goos: "wasip1", goarch: "wasm", buildMode: "c-shared" },
  { path: "pkg/module/testdata/happy/happy.go", output: "pkg/module/testdata/happy/happy.wasm", goos: "wasip1", goarch: "wasm", buildMode: "c-shared" },
  { path: "pkg/module/testdata/scanner/scanner.go", output: "pkg/module/testdata/scanner/scanner.wasm", goos: "wasip1", goarch: "wasm", buildMode: "c-shared" },
]);
export const TRIVY_PATCH_IDENTITIES = Object.freeze([
  { order: 1, kind: "grpc-1.83.1", path: "infra/supply-chain/patches/trivy-grpc-1.83.1.patch", sha256: "bd2d0fcb63bf9956775d5ced20d9538b89f3485c4ec113e44b1d64c809d30f24", size: 6145 },
  { order: 2, kind: "fixture-locking", path: "infra/supply-chain/patches/trivy-fixture-locking.patch", sha256: "a8002eb8f212475e8d6fc74f6a46b196b727fbacbba0c8168478dd99d6eea1c8", size: 33_047 },
]);
const ORAS_EVIDENCE_MATERIALS = Object.freeze([
  { name: "KEYS", path: "infra/supply-chain/materials/oras/KEYS", url: "https://raw.githubusercontent.com/oras-project/oras/db9e29505c3059f2b8fde34ae8cae266c5c765e9/KEYS", sha256: "3420b86b255693414e73422a09a2c86334ec902496a2fb84c938a47637fc5ea3", size: 5324 },
  { name: "tag.json", path: "infra/supply-chain/materials/oras/tag.json", url: "https://api.github.com/repos/oras-project/oras/git/tags/2f11c9ec2d4816bf0a7a709f7a51ed5ca5d2d5c5", sha256: "ce80be58b6babf8b0d35e20783f059ac39339eb20af46350ff0489bc83a7c3a7", size: 3284 },
  { name: "commit.json", path: "infra/supply-chain/materials/oras/commit.json", url: "https://api.github.com/repos/oras-project/oras/git/commits/db9e29505c3059f2b8fde34ae8cae266c5c765e9", sha256: "1c0efb500f636fb143dcc7168ae83c6e26f7dfa5249c2a3c44369e5f3fb59912", size: 2304 },
  { name: "oras_1.3.4_checksums.txt", path: "infra/supply-chain/materials/oras/oras_1.3.4_checksums.txt", url: "https://github.com/oras-project/oras/releases/download/v1.3.4/oras_1.3.4_checksums.txt", sha256: "19d479e497fb5e30c7de3c621e3ed337e3857de0d96542021a73e2d8016dbe5a", size: 2240 },
  { name: "oras_1.3.4_checksums.txt.asc", path: "infra/supply-chain/materials/oras/oras_1.3.4_checksums.txt.asc", url: "https://github.com/oras-project/oras/releases/download/v1.3.4/oras_1.3.4_checksums.txt.asc", sha256: "a26dd27f65d9f44b5ca24ff40b960e2de150c61541cafb20b78fb84d60e9293f", size: 228 },
]);

function fail(message) {
  throw new Error(`material_contract:${message}`);
}

function object(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name}_must_be_object`);
  }
  return value;
}

function closed(value, required, optional, name) {
  const record = object(value, name);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(`${name}_unknown_field`);
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) fail(`${name}_missing_${key}`);
  }
  return record;
}

function string(value, name, pattern) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    fail(`${name}_invalid`);
  }
  return value;
}

function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${name}_invalid`);
  return value;
}

function strings(value, name, { unique = true, allowed } = {}) {
  if (!Array.isArray(value)) fail(`${name}_must_be_array`);
  const seen = new Set();
  return value.map((entry, index) => {
    const item = string(entry, `${name}_${index}`);
    if (allowed && !allowed.has(item)) fail(`${name}_${index}_unsupported`);
    if (unique && seen.has(item)) fail(`${name}_duplicate`);
    seen.add(item);
    return item;
  });
}

function fixedHttpsUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(string(value, name));
  } catch {
    fail(`${name}_invalid_url`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`${name}_unsafe_url`);
  }
  const allowedHosts = new Set(["github.com", "api.github.com", "raw.githubusercontent.com", "go.dev", "dl.google.com", "mirror.openshift.com"]);
  if (!allowedHosts.has(parsed.hostname)) fail(`${name}_host_not_allowed`);
  return parsed.href;
}

function digestRecord(value, name) {
  const record = closed(value, ["sha256", "size"], [], name);
  string(record.sha256, `${name}_sha256`, SHA256);
  integer(record.size, `${name}_size`, 1, MATERIAL_LIMITS.archiveBytes);
  return record;
}

function repositoryPath(value, name, prefix) {
  const candidate = string(value, name, /^[a-z0-9_./-]+$/u);
  if (!candidate.startsWith(`${prefix}/`) || candidate.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail(`${name}_invalid`);
  }
  return candidate;
}

function sourcePath(value, name) {
  const candidate = string(value, name);
  const hasControl = [...candidate].some((character) => character.codePointAt(0) <= 31 || character.codePointAt(0) === 127);
  if (candidate.includes("\\") || hasControl || candidate.startsWith("/") || /^[A-Za-z]:/u.test(candidate) ||
      candidate.split("/").some((part) => part === "" || part === "." || part === "..")) fail(`${name}_invalid`);
  return candidate;
}

function validateEvidenceFiles(value, name) {
  if (!Array.isArray(value) || value.length > MATERIAL_LIMITS.closureEntries) fail(`${name}_invalid`);
  const records = value.map((entry, index) => {
    const record = closed(entry, ["path", "sha256", "size"], [], `${name}_${index}`);
    sourcePath(record.path, `${name}_${index}_path`);
    string(record.sha256, `${name}_${index}_sha256`, SHA256);
    integer(record.size, `${name}_${index}_size`, 1, MATERIAL_LIMITS.archiveBytes);
    return record;
  });
  const paths = records.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length || paths.some((entry, index) => index > 0 && paths[index - 1].localeCompare(entry, "en") >= 0)) fail(`${name}_order_invalid`);
  return records;
}

export function sourceEvidenceProvenance(proposal) {
  return sha256(canonicalJsonBuffer({
    selectionSha256: proposal.selectionSha256,
    tool: proposal.tool,
    sourceTree: proposal.sourceTree,
    sourceArchive: proposal.sourceArchive,
    sourceDateEpoch: proposal.sourceDateEpoch,
    recipeSha256: proposal.recipeSha256,
    requiredEvidence: proposal.requiredEvidence,
    licenseFiles: proposal.sourceEvidence.licenseFiles,
    noticeFiles: proposal.sourceEvidence.noticeFiles,
    noticeStatus: proposal.sourceEvidence.noticeStatus,
    wasmInputs: proposal.sourceEvidence.wasmInputs,
  }));
}

function validateWasmInputs(value, required) {
  if (!Array.isArray(value) || value.length !== (required ? TRIVY_WASM_INPUTS.length : 0)) fail("proposal_wasm_inputs_invalid");
  value.forEach((entry, index) => {
    const record = closed(entry, ["path", "output", "goos", "goarch", "buildMode", "sha256", "size"], [], `proposal_wasm_input_${index}`);
    sourcePath(record.path, `proposal_wasm_input_${index}_path`);
    sourcePath(record.output, `proposal_wasm_input_${index}_output`);
    string(record.goos, `proposal_wasm_input_${index}_goos`);
    string(record.goarch, `proposal_wasm_input_${index}_goarch`);
    string(record.buildMode, `proposal_wasm_input_${index}_build_mode`);
    string(record.sha256, `proposal_wasm_input_${index}_sha256`, SHA256);
    integer(record.size, `proposal_wasm_input_${index}_size`, 1, 1024 * 1024);
    const expected = TRIVY_WASM_INPUTS[index];
    if (!expected || canonicalJsonBuffer({ path: record.path, output: record.output, goos: record.goos, goarch: record.goarch, buildMode: record.buildMode })
      .compare(canonicalJsonBuffer(expected)) !== 0) fail("proposal_wasm_input_identity_mismatch");
  });
  return value;
}

export function releaseEvidenceProvenance(proposal) {
  const releaseEvidence = { ...proposal.releaseEvidence };
  delete releaseEvidence.provenanceSha256;
  return sha256(canonicalJsonBuffer({
    selectionSha256: proposal.selectionSha256,
    tool: proposal.tool,
    sourceTree: proposal.sourceTree,
    recipeSha256: proposal.recipeSha256,
    releaseEvidence,
  }));
}

function validateReleaseEvidence(value, expected, sourceTree) {
  const record = closed(value, ["materials", "referenceArchive", "gpg", "tag", "commit", "provenanceSha256"], [], "proposal_release_evidence");
  if (!Array.isArray(record.materials) || record.materials.length !== ORAS_EVIDENCE_MATERIALS.length) fail("proposal_release_materials_invalid");
  record.materials.forEach((entry, index) => {
    const material = closed(entry, ["name", "path", "url", "sha256", "size"], [], `proposal_release_material_${index}`);
    string(material.name, `proposal_release_material_${index}_name`);
    sourcePath(material.path, `proposal_release_material_${index}_path`);
    if (!material.path.startsWith("infra/supply-chain/materials/oras/")) fail("proposal_release_material_path_invalid");
    fixedHttpsUrl(material.url, `proposal_release_material_${index}_url`);
    string(material.sha256, `proposal_release_material_${index}_sha256`, SHA256);
    integer(material.size, `proposal_release_material_${index}_size`, 1, 1024 * 1024);
  });
  if (canonicalJsonBuffer(record.materials).compare(canonicalJsonBuffer(expected?.materials ?? ORAS_EVIDENCE_MATERIALS)) !== 0) fail("proposal_release_materials_mismatch");
  const archive = closed(record.referenceArchive, ["url", "sha256", "size"], [], "proposal_release_archive");
  fixedHttpsUrl(archive.url, "proposal_release_archive_url");
  string(archive.sha256, "proposal_release_archive_sha256", SHA256);
  integer(archive.size, "proposal_release_archive_size", 1, MATERIAL_LIMITS.archiveBytes);
  if (expected && (archive.url !== expected.referenceArchiveUrl || archive.sha256 !== expected.referenceArchiveSha256)) fail("proposal_release_archive_mismatch");
  const gpg = closed(record.gpg, ["fingerprint", "verified"], [], "proposal_release_gpg");
  string(gpg.fingerprint, "proposal_release_gpg_fingerprint", /^[0-9A-F]{40}$/u);
  if (gpg.verified !== true || (expected && gpg.fingerprint !== expected.releaseKeyFingerprint)) fail("proposal_release_gpg_invalid");
  const tag = closed(record.tag, ["recordSha256", "object", "target", "verified", "reason"], [], "proposal_release_tag");
  string(tag.recordSha256, "proposal_release_tag_record", SHA256);
  string(tag.object, "proposal_release_tag_object", COMMIT);
  string(tag.target, "proposal_release_tag_target", COMMIT);
  if (tag.verified !== true || tag.reason !== "valid" || (expected && (tag.object !== expected.tagObject || tag.target !== expected.tagTarget))) fail("proposal_release_tag_invalid");
  const commit = closed(record.commit, ["recordSha256", "commit", "tree", "verified", "reason"], [], "proposal_release_commit");
  string(commit.recordSha256, "proposal_release_commit_record", SHA256);
  string(commit.commit, "proposal_release_commit_identity", COMMIT);
  string(commit.tree, "proposal_release_commit_tree", COMMIT);
  if (commit.verified !== true || commit.reason !== "valid" || commit.commit !== (expected?.tagTarget ?? commit.commit) || commit.tree !== sourceTree) fail("proposal_release_commit_invalid");
  if (expected && (tag.recordSha256 !== expected.materials[1].sha256 || commit.recordSha256 !== expected.materials[2].sha256)) fail("proposal_release_record_mismatch");
  string(record.provenanceSha256, "proposal_release_provenance", SHA256);
  return record;
}

function compilerArchive(value, name) {
  const record = closed(value, ["goos", "url", "sha256"], [], name);
  if (!new Set(["linux", "windows"]).has(record.goos)) fail(`${name}_goos_unsupported`);
  fixedHttpsUrl(record.url, `${name}_url`);
  string(record.sha256, `${name}_sha256`, SHA256);
  return record;
}

function validateSelectionTool(value, index) {
  const name = `tools_${index}`;
  const record = closed(value, ["name", "version", "modifiedVersion", "repository", "commit", "sourceRepositoryUrl", "sourceSymlinks", "targets", "timeoutMinutes", "patchPolicy", "recipeFiles", "upstreamTests", "requiredEvidence"], ["orasVerification", "knownFixtureBlockers"], name);
  string(record.name, `${name}_name`);
  if (!TOOL_NAMES.has(record.name)) fail(`${name}_unsupported`);
  string(record.version, `${name}_version`, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  string(record.modifiedVersion, `${name}_modified_version`, /^[0-9]+\.[0-9]+\.[0-9]+-autoworld\.1$/);
  const repository = string(record.repository, `${name}_repository`, /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i);
  string(record.commit, `${name}_commit`, COMMIT);
  fixedHttpsUrl(record.sourceRepositoryUrl, `${name}_source_repository_url`);
  if (record.sourceRepositoryUrl !== `https://github.com/${repository}.git`) fail(`${name}_source_repository_url_invalid`);
  if (!Array.isArray(record.sourceSymlinks)) fail(`${name}_source_symlinks_invalid`);
  record.sourceSymlinks.forEach((entry, linkIndex) => {
    const link = closed(entry, ["path", "target", "blob", "size"], [], `${name}_source_symlink_${linkIndex}`);
    repositoryPath(link.path, `${name}_source_symlink_${linkIndex}_path`, "pkg");
    string(link.target, `${name}_source_symlink_${linkIndex}_target`, /^[a-z0-9_.-]+$/u);
    string(link.blob, `${name}_source_symlink_${linkIndex}_blob`, COMMIT);
    integer(link.size, `${name}_source_symlink_${linkIndex}_size`, 1, 4096);
  });
  const expectedSymlinks = record.name === "trivy" ? TRIVY_SOURCE_SYMLINKS : [];
  if (canonicalJsonBuffer(record.sourceSymlinks).compare(canonicalJsonBuffer(expectedSymlinks)) !== 0) fail(`${name}_source_symlinks_mismatch`);
  const targets = strings(record.targets, `${name}_targets`, { allowed: TARGETS });
  const expectedTargets = record.name === "cosign" ? ["linux-amd64", "windows-amd64"] : ["linux-amd64"];
  if (canonicalJsonBuffer(targets).compare(canonicalJsonBuffer(expectedTargets)) !== 0) fail(`${name}_target_set_invalid`);
  integer(record.timeoutMinutes, `${name}_timeout`, 1, record.name === "oras" ? 30 : record.name === "cosign" ? 60 : 90);
  const patchPolicy = closed(record.patchPolicy, ["allowedKinds", "additionalPatchReviewRequired"], [], `${name}_patch_policy`);
  strings(patchPolicy.allowedKinds, `${name}_patch_kinds`);
  if (patchPolicy.additionalPatchReviewRequired !== true) fail(`${name}_patch_review_must_be_true`);
  strings(record.recipeFiles, `${name}_recipe_files`);
  if (record.recipeFiles.length === 0 || record.recipeFiles.some((file) => !/^scripts\/supply-chain\/[a-z0-9-]+\.mjs$/u.test(file))) fail(`${name}_recipe_files_invalid`);
  strings(record.upstreamTests, `${name}_upstream_tests`);
  strings(record.requiredEvidence, `${name}_required_evidence`);
  if (record.knownFixtureBlockers !== undefined) strings(record.knownFixtureBlockers, `${name}_fixture_blockers`);
  if ((record.name === "oras") !== (record.orasVerification !== undefined)) fail(`${name}_oras_verification_presence_invalid`);
  if (record.orasVerification !== undefined) {
    const verification = closed(record.orasVerification, ["tagObject", "tagTarget", "releaseKeyFingerprint", "referenceArchiveUrl", "referenceArchiveSha256", "materials"], [], `${name}_oras_verification`);
    string(verification.tagObject, `${name}_tag_object`, COMMIT);
    string(verification.tagTarget, `${name}_tag_target`, COMMIT);
    if (verification.tagTarget !== record.commit) fail(`${name}_tag_target_mismatch`);
    string(verification.releaseKeyFingerprint, `${name}_release_key`, /^[0-9A-F]{40}$/);
    fixedHttpsUrl(verification.referenceArchiveUrl, `${name}_reference_archive_url`);
    if (verification.referenceArchiveUrl !== "https://github.com/oras-project/oras/releases/download/v1.3.4/oras_1.3.4_linux_amd64.tar.gz") fail(`${name}_reference_archive_url_invalid`);
    string(verification.referenceArchiveSha256, `${name}_reference_archive`, SHA256);
    if (!Array.isArray(verification.materials) || verification.materials.length !== ORAS_EVIDENCE_MATERIALS.length) fail(`${name}_evidence_materials_invalid`);
    verification.materials.forEach((entry, materialIndex) => {
      const material = closed(entry, ["name", "path", "url", "sha256", "size"], [], `${name}_evidence_material_${materialIndex}`);
      string(material.name, `${name}_evidence_material_${materialIndex}_name`);
      sourcePath(material.path, `${name}_evidence_material_${materialIndex}_path`);
      if (!material.path.startsWith("infra/supply-chain/materials/oras/")) fail(`${name}_evidence_material_path_invalid`);
      fixedHttpsUrl(material.url, `${name}_evidence_material_${materialIndex}_url`);
      string(material.sha256, `${name}_evidence_material_${materialIndex}_sha256`, SHA256);
      integer(material.size, `${name}_evidence_material_${materialIndex}_size`, 1, 1024 * 1024);
    });
    if (canonicalJsonBuffer(verification.materials).compare(canonicalJsonBuffer(ORAS_EVIDENCE_MATERIALS)) !== 0) fail(`${name}_evidence_materials_mismatch`);
  }
  return record;
}

export function validateSourceSelection(value) {
  const root = closed(value, ["schemaVersion", "state", "compiler", "managedRunner", "tools"], [], "selection");
  if (root.schemaVersion !== 1 || root.state !== "selected") fail("selection_header_invalid");
  const compiler = closed(root.compiler, ["version", "archives"], [], "compiler");
  if (compiler.version !== "1.26.8") fail("compiler_version_invalid");
  if (!Array.isArray(compiler.archives) || compiler.archives.length !== 2) fail("compiler_archives_invalid");
  const archives = compiler.archives.map(compilerArchive);
  if (new Set(archives.map((entry) => entry.goos)).size !== archives.length) fail("compiler_archive_duplicate");
  for (const archive of archives) {
    const expected = archive.goos === "linux"
      ? "https://go.dev/dl/go1.26.8.linux-amd64.tar.gz"
      : "https://go.dev/dl/go1.26.8.windows-amd64.zip";
    if (archive.url !== expected) fail("compiler_archive_url_invalid");
  }
  const runner = closed(root.managedRunner, ["label", "requiredUtilities"], [], "managed_runner");
  if (runner.label !== "ubuntu-24.04") fail("managed_runner_invalid");
  strings(runner.requiredUtilities, "managed_runner_utilities");
  if (new Set(runner.requiredUtilities).size !== runner.requiredUtilities.length ||
      canonicalJsonBuffer([...runner.requiredUtilities].sort()).compare(canonicalJsonBuffer([...MANAGED_RUNNER_UTILITY_NAMES].sort())) !== 0) fail("managed_runner_utilities_mismatch");
  if (!Array.isArray(root.tools) || root.tools.length !== 3) fail("tools_invalid");
  const tools = root.tools.map(validateSelectionTool);
  if (new Set(tools.map((entry) => entry.name)).size !== tools.length) fail("tool_duplicate");
  return parseBoundedJson(canonicalJsonBuffer(root));
}

export function validateManagedRunnerUtilities(value, expectedNames = MANAGED_RUNNER_UTILITY_NAMES) {
  if (!Array.isArray(value) || value.length !== expectedNames.length) fail("proposal_runner_utilities_invalid");
  if (new Set(expectedNames).size !== expectedNames.length ||
      canonicalJsonBuffer([...expectedNames].sort()).compare(canonicalJsonBuffer([...MANAGED_RUNNER_UTILITY_NAMES].sort())) !== 0) fail("proposal_runner_utilities_expected_invalid");
  const utilities = value.map((entry, index) => {
    const utility = closed(entry, ["name", "path", "identity"], [], `runner_utility_${index}`);
    string(utility.name, `runner_utility_${index}_name`);
    string(utility.path, `runner_utility_${index}_path`, /^\//);
    string(utility.identity, `runner_utility_${index}_identity`);
    if (utility.name !== MANAGED_RUNNER_UTILITY_NAMES[index] || utility.path !== MANAGED_RUNNER_UTILITY_PATHS[utility.name]) fail("proposal_runner_utility_identity_mismatch");
    return utility;
  });
  if (new Set(utilities.map((entry) => entry.name)).size !== utilities.length) fail("proposal_runner_utility_duplicate");
  return utilities;
}

export function assertManagedRunnerUtilitiesMatch(expected, actual, expectedNames = MANAGED_RUNNER_UTILITY_NAMES) {
  const locked = validateManagedRunnerUtilities(expected, expectedNames);
  const observed = validateManagedRunnerUtilities(actual, expectedNames);
  if (canonicalJsonBuffer(observed).compare(canonicalJsonBuffer(locked)) !== 0) fail("native_build_runner_utility_drift");
  return observed;
}

function validateModule(value, index) {
  const name = `modules_${index}`;
  const record = closed(value, ["path", "version", "sum", "goModSum", "zipSha256", "zipSize"], [], name);
  string(record.path, `${name}_path`, /^[^\s@]+$/);
  string(record.version, `${name}_version`, /^v[^\s]+$/);
  string(record.sum, `${name}_sum`, /^h1:[A-Za-z0-9+/]{43}=$/);
  string(record.goModSum, `${name}_gomod_sum`, /^h1:[A-Za-z0-9+/]{43}=$/);
  string(record.zipSha256, `${name}_zip_sha256`, SHA256);
  integer(record.zipSize, `${name}_zip_size`, 1, MATERIAL_LIMITS.archiveBytes);
  return record;
}

function validatePatch(value, index) {
  const name = `patches_${index}`;
  const record = closed(value, ["order", "kind", "path", "sha256", "size"], [], name);
  integer(record.order, `${name}_order`, 1, 100);
  string(record.kind, `${name}_kind`, /^[a-z0-9_.-]+$/);
  repositoryPath(record.path, `${name}_path`, "infra/supply-chain/patches");
  string(record.sha256, `${name}_sha256`, SHA256);
  integer(record.size, `${name}_size`, 1, 1024 * 1024);
  return record;
}

export function validateMaterialProposal(value, expectedSelectionSha256, expectedTool, expectedPatchKinds, expectedRequiredEvidence, expectedOrasVerification) {
  const root = closed(value, ["schemaVersion", "state", "selectionSha256", "tool", "sourceTree", "sourceArchive", "compilerArchive", "modules", "patches", "patchProposals", "testMaterials", "sourceDateEpoch", "recipeFiles", "recipeSha256", "requiredEvidence", "sourceEvidence", "managedRunner", "complete", "blockers"], ["releaseEvidence"], "proposal");
  if (root.schemaVersion !== 1 || root.state !== "material_lock_proposal") fail("proposal_header_invalid");
  string(root.selectionSha256, "proposal_selection_sha256", SHA256);
  if (expectedSelectionSha256 && root.selectionSha256 !== expectedSelectionSha256) fail("proposal_selection_mismatch");
  string(root.tool, "proposal_tool");
  if (!TOOL_NAMES.has(root.tool) || (expectedTool && root.tool !== expectedTool)) fail("proposal_tool_mismatch");
  string(root.sourceTree, "proposal_source_tree", COMMIT);
  digestRecord(root.sourceArchive, "proposal_source_archive");
  const compiler = closed(root.compilerArchive, ["goos", "sha256", "size"], [], "proposal_compiler_archive");
  if (compiler.goos !== "linux") fail("proposal_compiler_goos_invalid");
  digestRecord({ sha256: compiler.sha256, size: compiler.size }, "proposal_compiler_digest");
  if (!Array.isArray(root.modules) || root.modules.length === 0 || root.modules.length > MATERIAL_LIMITS.closureEntries) fail("proposal_modules_invalid");
  const modules = root.modules.map(validateModule);
  const moduleIds = modules.map((entry) => `${entry.path}@${entry.version}`);
  if (new Set(moduleIds).size !== moduleIds.length) fail("proposal_module_duplicate");
  if (!Array.isArray(root.patches) || root.patches.length > 100) fail("proposal_patches_invalid");
  const patches = root.patches.map(validatePatch);
  if (patches.some((entry, index) => entry.order !== index + 1)) fail("proposal_patch_order_invalid");
  if (expectedPatchKinds && patches.some((entry) => !expectedPatchKinds.includes(entry.kind))) fail("proposal_patch_kind_not_selected");
  if (!Array.isArray(root.patchProposals) || root.patchProposals.length > 100) fail("proposal_patch_proposals_invalid");
  root.patchProposals.forEach((entry, index) => {
    const proposed = closed(entry, ["kind", "path", "sha256", "size"], [], `patch_proposal_${index}`);
    string(proposed.kind, `patch_proposal_${index}_kind`, /^[a-z0-9_.-]+$/u);
    if (expectedPatchKinds && !expectedPatchKinds.includes(proposed.kind)) fail("proposal_patch_kind_not_selected");
    repositoryPath(proposed.path, `patch_proposal_${index}_path`, "proposal-assets/trivy");
    string(proposed.sha256, `patch_proposal_${index}_sha256`, SHA256);
    integer(proposed.size, `patch_proposal_${index}_size`, 1, 1024 * 1024);
  });
  if (!Array.isArray(root.testMaterials) || root.testMaterials.length > MATERIAL_LIMITS.closureEntries) fail("proposal_test_materials_invalid");
  root.testMaterials.forEach((entry, index) => {
    const record = closed(entry, ["name", "kind", "origin", "path", "sha256", "size"], [], `test_material_${index}`);
    string(record.name, `test_material_${index}_name`, /^[a-z0-9_.-]+$/);
    string(record.kind, `test_material_${index}_kind`, /^[a-z0-9_-]+$/);
    if (!new Set(["git-fixture-archive", "rpm-fixture"]).has(record.kind)) fail("test_material_kind_invalid");
    fixedHttpsUrl(record.origin, `test_material_${index}_origin`);
    const expectedOrigin = record.kind === "git-fixture-archive"
      ? "https://github.com/aquasecurity/trivy-test-repo"
      : "https://mirror.openshift.com/pub/openshift-v4/amd64/dependencies/rpms/4.10-beta/socat-1.7.3.2-2.el7.x86_64.rpm";
    if (record.origin !== expectedOrigin) fail("test_material_origin_invalid");
    repositoryPath(record.path, `test_material_${index}_path`, "infra/supply-chain/materials");
    string(record.sha256, `test_material_${index}_sha256`, SHA256);
    integer(record.size, `test_material_${index}_size`, 1, MATERIAL_LIMITS.archiveBytes);
    if ((record.kind === "git-fixture-archive" && record.name !== "trivy-test-repo-git-worktree") ||
        (record.kind === "rpm-fixture" && record.name !== "trivy-socat-rpm")) fail("test_material_identity_invalid");
    if (record.name === "trivy-test-repo-git-worktree" && (record.sha256 !== "082504160f61c7539bf67e3c85c0f614c4536b2e2a09a5fcb76461b3c81b6d76" || record.size !== 33_353)) fail("test_material_identity_invalid");
    if (record.name === "trivy-socat-rpm" && (record.sha256 !== "629571bd05c7ae50170a7a94d2b987489e7f50de7d733955f70fb8e396831ba9" || record.size !== 296_692)) fail("test_material_identity_invalid");
  });
  if (new Set(root.testMaterials.map((entry) => entry.name)).size !== root.testMaterials.length) fail("proposal_test_material_duplicate");
  if (root.modules.length + root.testMaterials.length + root.patches.length + root.patchProposals.length > MATERIAL_LIMITS.closureEntries) fail("proposal_closure_entries_exceeded");
  const closureBytes = [...root.modules.map((entry) => entry.zipSize), ...root.testMaterials.map((entry) => entry.size), ...root.patches.map((entry) => entry.size), ...root.patchProposals.map((entry) => entry.size)]
    .reduce((total, size) => total + size, root.sourceArchive.size + root.compilerArchive.size);
  if (!Number.isSafeInteger(closureBytes) || closureBytes > MATERIAL_LIMITS.closureBytes) fail("proposal_closure_bytes_exceeded");
  integer(root.sourceDateEpoch, "proposal_source_date_epoch", 1, 4_102_444_800);
  strings(root.requiredEvidence, "proposal_required_evidence");
  if (expectedRequiredEvidence && canonicalJsonBuffer(root.requiredEvidence).compare(canonicalJsonBuffer(expectedRequiredEvidence)) !== 0) fail("proposal_required_evidence_mismatch");
  const sourceEvidence = closed(root.sourceEvidence, ["licenseFiles", "noticeFiles", "noticeStatus", "wasmInputs", "provenanceSha256"], [], "proposal_source_evidence");
  validateEvidenceFiles(sourceEvidence.licenseFiles, "proposal_license_files");
  validateEvidenceFiles(sourceEvidence.noticeFiles, "proposal_notice_files");
  validateWasmInputs(sourceEvidence.wasmInputs, root.requiredEvidence.includes("wasm-prerequisites"));
  if (!new Set(["present", "absent-in-pinned-source"]).has(sourceEvidence.noticeStatus) ||
      (sourceEvidence.noticeStatus === "present") !== (sourceEvidence.noticeFiles.length > 0)) fail("proposal_notice_status_invalid");
  string(sourceEvidence.provenanceSha256, "proposal_source_provenance", SHA256);
  if (sourceEvidence.provenanceSha256 !== sourceEvidenceProvenance(root)) fail("proposal_source_provenance_mismatch");
  const requiresReleaseEvidence = ["release-checksum-signature", "tag-verification", "commit-verification"].some((item) => root.requiredEvidence.includes(item));
  if (requiresReleaseEvidence !== (root.releaseEvidence !== undefined)) fail("proposal_release_evidence_presence_invalid");
  if (root.releaseEvidence !== undefined) {
    const releaseEvidence = validateReleaseEvidence(root.releaseEvidence, expectedOrasVerification, root.sourceTree);
    const releaseBytes = releaseEvidence.materials.reduce((total, entry) => total + entry.size, releaseEvidence.referenceArchive.size);
    if (root.modules.length + root.testMaterials.length + root.patches.length + releaseEvidence.materials.length + 1 > MATERIAL_LIMITS.closureEntries) fail("proposal_closure_entries_exceeded");
    if (!Number.isSafeInteger(releaseBytes) || releaseBytes + closureBytes > MATERIAL_LIMITS.closureBytes) fail("proposal_closure_bytes_exceeded");
    if (root.releaseEvidence.provenanceSha256 !== releaseEvidenceProvenance(root)) fail("proposal_release_provenance_mismatch");
  }
  if (!Array.isArray(root.recipeFiles) || root.recipeFiles.length === 0) fail("proposal_recipe_files_invalid");
  root.recipeFiles.forEach((entry, index) => {
    const recipe = closed(entry, ["path", "sha256", "size"], [], `recipe_file_${index}`);
    string(recipe.path, `recipe_file_${index}_path`, /^scripts\/supply-chain\/[a-z0-9-]+\.mjs$/u);
    string(recipe.sha256, `recipe_file_${index}_sha256`, SHA256);
    integer(recipe.size, `recipe_file_${index}_size`, 1, 1024 * 1024);
  });
  if (new Set(root.recipeFiles.map((entry) => entry.path)).size !== root.recipeFiles.length) fail("proposal_recipe_file_duplicate");
  string(root.recipeSha256, "proposal_recipe_sha256", SHA256);
  const runner = closed(root.managedRunner, ["label", "imageVersion", "utilities"], [], "proposal_runner");
  if (runner.label !== "ubuntu-24.04") fail("proposal_runner_label_invalid");
  string(runner.imageVersion, "proposal_runner_image_version");
  validateManagedRunnerUtilities(runner.utilities);
  if (typeof root.complete !== "boolean") fail("proposal_complete_invalid");
  strings(root.blockers, "proposal_blockers");
  if (root.patchProposals.length > 0 && root.complete) fail("proposal_patch_proposals_unresolved");
  if (root.complete && expectedPatchKinds && canonicalJsonBuffer(patches.map((entry) => entry.kind)).compare(canonicalJsonBuffer(expectedPatchKinds)) !== 0) fail("proposal_patches_incomplete");
  if (root.complete && root.tool === "trivy" && canonicalJsonBuffer(patches).compare(canonicalJsonBuffer(TRIVY_PATCH_IDENTITIES)) !== 0) fail("proposal_patch_identity_mismatch");
  if (root.complete && root.requiredEvidence.includes("git-fixture-closure") && !root.testMaterials.some((entry) => entry.name === "trivy-test-repo-git-worktree")) fail("proposal_git_fixture_evidence_missing");
  if (root.complete && root.requiredEvidence.includes("rpm-fixture") && !root.testMaterials.some((entry) => entry.name === "trivy-socat-rpm")) fail("proposal_rpm_fixture_evidence_missing");
  if (root.complete && root.requiredEvidence.includes("mage-1.17.2") && !root.modules.some((entry) => entry.path === "github.com/magefile/mage" && entry.version === "v1.17.2")) fail("proposal_mage_evidence_missing");
  if (root.complete && patches.some((entry) => entry.kind === "grpc-1.83.1") && !root.modules.some((entry) => entry.path === "google.golang.org/grpc" && entry.version === "v1.83.1")) fail("proposal_grpc_evidence_missing");
  if (root.requiredEvidence.includes("license") && sourceEvidence.licenseFiles.length === 0 && !root.blockers.includes("source-license-evidence-missing")) fail("proposal_license_evidence_unaccounted");
  if (root.complete !== (root.blockers.length === 0)) fail("proposal_completion_mismatch");
  return parseBoundedJson(canonicalJsonBuffer(root));
}

export function validateMaterialLock(value, selection) {
  const root = closed(value, ["schemaVersion", "state", "selectionSha256", "proposals"], [], "lock");
  if (root.schemaVersion !== 1 || root.state !== "material_locked") fail("lock_header_invalid");
  const selectionSha = sha256(canonicalJsonBuffer(selection));
  string(root.selectionSha256, "lock_selection_sha256", SHA256);
  if (root.selectionSha256 !== selectionSha) fail("lock_selection_mismatch");
  if (!Array.isArray(root.proposals) || root.proposals.length !== 3) fail("lock_proposals_invalid");
  const proposals = root.proposals.map((entry) => {
    const selected = selection.tools.find((tool) => tool.name === entry?.tool);
    if (!selected) fail("lock_proposal_tool_not_selected");
    return validateMaterialProposal(entry, selectionSha, selected.name, selected.patchPolicy.allowedKinds, selected.requiredEvidence, selected.orasVerification);
  });
  if (new Set(proposals.map((entry) => entry.tool)).size !== 3) fail("lock_proposal_duplicate");
  if (proposals.some((entry) => !entry.complete)) fail("lock_proposal_incomplete");
  if (proposals.some((entry) => canonicalJsonBuffer(entry.managedRunner.utilities)
    .compare(canonicalJsonBuffer(proposals[0].managedRunner.utilities)) !== 0)) fail("lock_runner_utilities_mismatch");
  if (proposals.some((entry) => entry.managedRunner.imageVersion !== proposals[0].managedRunner.imageVersion)) fail("lock_runner_identity_mismatch");
  for (const proposal of proposals) {
    const selected = selection.tools.find((entry) => entry.name === proposal.tool);
    const expectedCompiler = selection.compiler.archives.find((entry) => entry.goos === "linux");
    if (proposal.compilerArchive.sha256 !== expectedCompiler.sha256) fail("lock_compiler_archive_mismatch");
    if (canonicalJsonBuffer(proposal.recipeFiles.map((entry) => entry.path)).compare(canonicalJsonBuffer(selected.recipeFiles)) !== 0) fail("lock_recipe_files_mismatch");
  }
  return parseBoundedJson(canonicalJsonBuffer(root));
}

export function readBoundedJsonFile(filePath) {
  const descriptor = openSync(filePath, "r");
  try {
    const size = fstatSync(descriptor).size;
    if (!Number.isSafeInteger(size) || size < 1 || size > MATERIAL_LIMITS.receiptBytes) fail("json_file_size_invalid");
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset);
      if (count === 0) fail("json_file_truncated");
      offset += count;
    }
    if (readSync(descriptor, Buffer.alloc(1), 0, 1, offset) !== 0) fail("json_file_grew_during_read");
    return parseBoundedJson(bytes, {
      maxBytes: MATERIAL_LIMITS.receiptBytes,
      maxDepth: MATERIAL_LIMITS.receiptDepth,
      maxMembers: MATERIAL_LIMITS.receiptMembers,
    });
  } finally {
    closeSync(descriptor);
  }
}

export async function sha256File(filePath, maximumBytes = MATERIAL_LIMITS.archiveBytes) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    size += chunk.length;
    if (size > maximumBytes) fail("file_too_large");
    hash.update(chunk);
  }
  if (size === 0) fail("file_empty");
  return { sha256: hash.digest("hex"), size };
}

export function assertDigest(actual, expected, label) {
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) fail(`${label}_digest_mismatch`);
}

export function materialError(message) {
  fail(message);
}
