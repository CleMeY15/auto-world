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
const TRIVY_SOURCE_SYMLINKS = Object.freeze([
  { path: "pkg/fanal/analyzer/language/golang/binary/testdata/symlink", target: "foo", blob: "19102815663d23f8b75a47e7a01965dcdc96468c", size: 3 },
  { path: "pkg/fanal/analyzer/language/rust/binary/testdata/symlink", target: "foo", blob: "19102815663d23f8b75a47e7a01965dcdc96468c", size: 3 },
  { path: "pkg/fanal/walker/testdata/fs/sym.txt", target: "bar", blob: "ba0e162e1c47469e3fe4b393a8bf8c569f302116", size: 3 },
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
  }));
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
  if (record.orasVerification !== undefined) {
    const verification = closed(record.orasVerification, ["tagObject", "tagTarget", "releaseKeyFingerprint", "referenceArchiveSha256", "signingEvidenceSha256"], [], `${name}_oras_verification`);
    string(verification.tagObject, `${name}_tag_object`, COMMIT);
    string(verification.tagTarget, `${name}_tag_target`, COMMIT);
    if (verification.tagTarget !== record.commit) fail(`${name}_tag_target_mismatch`);
    string(verification.releaseKeyFingerprint, `${name}_release_key`, /^[0-9A-F]{40}$/);
    string(verification.referenceArchiveSha256, `${name}_reference_archive`, SHA256);
    string(verification.signingEvidenceSha256, `${name}_signing_evidence`, SHA256);
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
  if (!Array.isArray(root.tools) || root.tools.length !== 3) fail("tools_invalid");
  const tools = root.tools.map(validateSelectionTool);
  if (new Set(tools.map((entry) => entry.name)).size !== tools.length) fail("tool_duplicate");
  return parseBoundedJson(canonicalJsonBuffer(root));
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

export function validateMaterialProposal(value, expectedSelectionSha256, expectedTool, expectedPatchKinds, expectedRequiredEvidence) {
  const root = closed(value, ["schemaVersion", "state", "selectionSha256", "tool", "sourceTree", "sourceArchive", "compilerArchive", "modules", "patches", "testMaterials", "sourceDateEpoch", "recipeFiles", "recipeSha256", "requiredEvidence", "sourceEvidence", "managedRunner", "complete", "blockers"], [], "proposal");
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
  if (!Array.isArray(root.testMaterials) || root.testMaterials.length > MATERIAL_LIMITS.closureEntries) fail("proposal_test_materials_invalid");
  root.testMaterials.forEach((entry, index) => {
    const record = closed(entry, ["name", "kind", "origin", "path", "sha256", "size"], [], `test_material_${index}`);
    string(record.name, `test_material_${index}_name`, /^[a-z0-9_.-]+$/);
    string(record.kind, `test_material_${index}_kind`, /^[a-z0-9_-]+$/);
    fixedHttpsUrl(record.origin, `test_material_${index}_origin`);
    const expectedOrigin = record.kind === "git-fixture-archive"
      ? "https://github.com/aquasecurity/trivy-test-repo"
      : "https://mirror.openshift.com/pub/openshift-v4/amd64/dependencies/rpms/4.10-beta/socat-1.7.3.2-2.el7.x86_64.rpm";
    if (record.origin !== expectedOrigin) fail("test_material_origin_invalid");
    repositoryPath(record.path, `test_material_${index}_path`, "infra/supply-chain/materials");
    string(record.sha256, `test_material_${index}_sha256`, SHA256);
    integer(record.size, `test_material_${index}_size`, 1, MATERIAL_LIMITS.archiveBytes);
  });
  if (root.modules.length + root.testMaterials.length + root.patches.length > MATERIAL_LIMITS.closureEntries) fail("proposal_closure_entries_exceeded");
  const closureBytes = [...root.modules.map((entry) => entry.zipSize), ...root.testMaterials.map((entry) => entry.size), ...root.patches.map((entry) => entry.size)]
    .reduce((total, size) => total + size, root.sourceArchive.size + root.compilerArchive.size);
  if (!Number.isSafeInteger(closureBytes) || closureBytes > MATERIAL_LIMITS.closureBytes) fail("proposal_closure_bytes_exceeded");
  integer(root.sourceDateEpoch, "proposal_source_date_epoch", 1, 4_102_444_800);
  strings(root.requiredEvidence, "proposal_required_evidence");
  if (expectedRequiredEvidence && canonicalJsonBuffer(root.requiredEvidence).compare(canonicalJsonBuffer(expectedRequiredEvidence)) !== 0) fail("proposal_required_evidence_mismatch");
  const sourceEvidence = closed(root.sourceEvidence, ["licenseFiles", "noticeFiles", "noticeStatus", "provenanceSha256"], [], "proposal_source_evidence");
  validateEvidenceFiles(sourceEvidence.licenseFiles, "proposal_license_files");
  validateEvidenceFiles(sourceEvidence.noticeFiles, "proposal_notice_files");
  if (!new Set(["present", "absent-in-pinned-source"]).has(sourceEvidence.noticeStatus) ||
      (sourceEvidence.noticeStatus === "present") !== (sourceEvidence.noticeFiles.length > 0)) fail("proposal_notice_status_invalid");
  string(sourceEvidence.provenanceSha256, "proposal_source_provenance", SHA256);
  if (sourceEvidence.provenanceSha256 !== sourceEvidenceProvenance(root)) fail("proposal_source_provenance_mismatch");
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
  if (!Array.isArray(runner.utilities) || runner.utilities.length === 0) fail("proposal_runner_utilities_invalid");
  runner.utilities.forEach((entry, index) => {
    const utility = closed(entry, ["name", "path", "identity"], [], `runner_utility_${index}`);
    string(utility.name, `runner_utility_${index}_name`);
    string(utility.path, `runner_utility_${index}_path`, /^\//);
    string(utility.identity, `runner_utility_${index}_identity`);
  });
  if (typeof root.complete !== "boolean") fail("proposal_complete_invalid");
  strings(root.blockers, "proposal_blockers");
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
    return validateMaterialProposal(entry, selectionSha, selected.name, selected.patchPolicy.allowedKinds, selected.requiredEvidence);
  });
  if (new Set(proposals.map((entry) => entry.tool)).size !== 3) fail("lock_proposal_duplicate");
  if (proposals.some((entry) => !entry.complete)) fail("lock_proposal_incomplete");
  for (const proposal of proposals) {
    const expected = selection.tools.find((entry) => entry.name === proposal.tool).recipeFiles;
    if (canonicalJsonBuffer(proposal.recipeFiles.map((entry) => entry.path)).compare(canonicalJsonBuffer(expected)) !== 0) fail("lock_recipe_files_mismatch");
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
