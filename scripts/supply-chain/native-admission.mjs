import { link, lstat, mkdtemp, opendir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCandidateArtifactMatrix, loadVerifiedCandidateRecords } from "./candidate-artifacts.mjs";
import { validateNativeCiIdentity, NATIVE_WORKFLOW_PATH } from "./ci-identity.mjs";
import { deriveGoInventory } from "./go-inventory.mjs";
import { MATERIAL_LIMITS, validateMaterialLock, validateSourceSelection } from "./materials.mjs";
import { readFileBounded, verifyNativeAuditFiles } from "./native-audit.mjs";
import { compareBaselineReports, loadBaselineExpectedInventory, normalizeBaselineComparisonReport, validateNativeAuditComparisonArtifact } from "./baseline-comparison.mjs";
import { validateBaselineTcbReceipt } from "./baseline-tcb.mjs";
import { policyError } from "./process.mjs";
import { loadScannerFixtureManifest, scannerFixtureArtifactInventory, validateScannerFixtureReport } from "./scanner-fixtures.mjs";
import { assertClosedObject, canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";
import { validatePreparationWorkflow } from "./workflow-policy.mjs";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const HASH = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^\/?[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,254}$/u;
const TOOLS = Object.freeze(["oras", "cosign", "trivy"]);
const BUILD_KEYS = Object.freeze(TOOLS.flatMap((tool) => [1, 2].map((repeat) => `${tool}:${repeat}`)));
const SUBJECTS = Object.freeze([
  Object.freeze({ tool: "oras", target: "linux-amd64", prefix: "oras-linux-amd64", filename: "oras" }),
  Object.freeze({ tool: "cosign", target: "linux-amd64", prefix: "cosign-linux-amd64", filename: "cosign" }),
  Object.freeze({ tool: "cosign", target: "windows-amd64", prefix: "cosign-windows-amd64", filename: "cosign.exe" }),
  Object.freeze({ tool: "trivy", target: "linux-amd64", prefix: "trivy-linux-amd64", filename: "trivy" }),
]);
export const NATIVE_ADMISSION_REVIEW_KINDS = Object.freeze(["code_security", "architecture"]);
const AUTH_KEYS = Object.freeze(["GITHUB_TOKEN", "GH_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL",
  "DOCKER_CONFIG", "REGISTRY_AUTH_FILE", "COSIGN_PASSWORD", "SIGSTORE_ID_TOKEN"]);
const REVIEW_PATHS = Object.freeze({
  code_security: Object.freeze({ receipt: "docs/validation/native-admission/code-security-review.json", report: "docs/validation/native-admission/code-security-review.md" }),
  architecture: Object.freeze({ receipt: "docs/validation/native-admission/architecture-review.json", report: "docs/validation/native-admission/architecture-review.md" }),
});
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const NATIVE_ADMISSION_IMPORT_PATHS = Object.freeze([
  "scripts/supply-chain/audit-artifacts.mjs", "scripts/supply-chain/baseline-comparison.mjs",
  "scripts/supply-chain/baseline-scanner.mjs", "scripts/supply-chain/baseline-tcb.mjs",
  "scripts/supply-chain/candidate-artifacts.mjs", "scripts/supply-chain/candidate-records.mjs",
  "scripts/supply-chain/ci-identity.mjs", "scripts/supply-chain/go-inventory.mjs",
  "scripts/supply-chain/materials.mjs", "scripts/supply-chain/native-admission.mjs",
  "scripts/supply-chain/native-audit.mjs", "scripts/supply-chain/process.mjs",
  "scripts/supply-chain/scanner-fixtures.mjs", "scripts/supply-chain/strict-json.mjs",
  "scripts/supply-chain/workflow-policy.mjs",
]);
const fail = (code) => { throw policyError(code); };

function same(actual, expected, code = "native_admission_identity_mismatch") {
  if (canonicalJsonBuffer(actual).compare(canonicalJsonBuffer(expected)) !== 0) fail(code);
}

function identity(value, cap = Number.MAX_SAFE_INTEGER) {
  assertClosedObject(value, ["sha256", "size"]);
  if (!HASH.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > cap) fail("native_admission_identity_invalid");
  return value;
}

function fileIdentity(value, expectedPath, cap) {
  assertClosedObject(value, ["path", "sha256", "size"]);
  if (value.path !== expectedPath) fail("native_admission_path_invalid");
  identity({ sha256: value.sha256, size: value.size }, cap);
  return value;
}

function requireLocalDataOnly(environment) {
  if (!environment || typeof environment !== "object" || environment.GITHUB_ACTIONS === "true" ||
      AUTH_KEYS.some((key) => typeof environment[key] === "string" && environment[key].length > 0)) fail("native_admission_local_only");
}

export function assertNativeAdmissionBudget(sizes) {
  if (!Array.isArray(sizes) || sizes.length < 1 || sizes.length > 200_000 ||
      sizes.some((size) => !Number.isSafeInteger(size) || size < 1 || size > 2 * GiB)) fail("native_admission_budget_invalid");
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!Number.isSafeInteger(total) || total > 8 * GiB) fail("native_admission_budget_exceeded");
  return total;
}

async function preflightEvidenceBudget(paths, repositoryFiles) {
  const sizes = [...repositoryFiles.values()].map((entry) => entry.size);
  const pending = [...paths];
  let entries = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!path.isAbsolute(current) || await realpath(current) !== current) fail("native_admission_preflight_invalid");
    const info = await lstat(current);
    entries += 1;
    if (entries > 200_000 || info.isSymbolicLink()) fail("native_admission_preflight_invalid");
    if (info.isDirectory()) {
      for await (const entry of await opendir(current)) pending.push(path.join(current, entry.name));
    } else if (info.isFile() && info.nlink === 1) sizes.push(info.size);
    else fail("native_admission_preflight_invalid");
  }
  return assertNativeAdmissionBudget(sizes);
}

async function exactFiles(directory, names, code) {
  if (!path.isAbsolute(directory) || await realpath(directory) !== directory) fail(code);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail(code);
  const actual = [];
  for await (const entry of await opendir(directory)) {
    if (!entry.isFile()) fail(code);
    actual.push(entry.name);
  }
  same(actual.sort(), [...names].sort(), code);
}

async function boundedJson(file, cap, { canonical = true } = {}) {
  const bytes = await readFileBounded(file, cap);
  const value = parseBoundedJson(bytes, { maxBytes: cap, maxDepth: MATERIAL_LIMITS.receiptDepth, maxMembers: MATERIAL_LIMITS.receiptMembers });
  if (canonical && canonicalJsonBuffer(value).compare(bytes) !== 0) fail("native_admission_json_noncanonical");
  return Object.freeze({ bytes, value, sha256: sha256(bytes), size: bytes.length });
}

function validateRunContext(value, files) {
  assertClosedObject(value, ["schemaVersion", "state", "repository", "prNumber", "run", "source", "startedAt", "completedAt",
    "selection", "materialLock", "workflow", "nativeRecipeFiles", "admissionRecipeFiles"]);
  if (value.schemaVersion !== 1 || value.state !== "native_evidence_context" || value.repository !== "CleMeY15/auto-world" ||
      !Number.isSafeInteger(value.prNumber) || value.prNumber < 1) fail("native_admission_run_context_invalid");
  assertClosedObject(value.source, ["headSha", "baseSha", "mergeSha", "mergeTree", "mergeParents"]);
  if (![value.source.headSha, value.source.baseSha, value.source.mergeSha, value.source.mergeTree].every((entry) => COMMIT.test(entry)) ||
      canonicalJsonBuffer(value.source.mergeParents).compare(canonicalJsonBuffer([value.source.baseSha, value.source.headSha])) !== 0 ||
      value.source.mergeSha !== value.run.sourceSha || value.run.workflowSha !== value.run.sourceSha || value.run.event !== "pull_request" ||
      value.run.workflowRef !== `CleMeY15/auto-world/${NATIVE_WORKFLOW_PATH}@refs/pull/${value.prNumber}/merge`) fail("native_admission_run_context_invalid");
  validateNativeCiIdentity(value.run, value.run);
  const started = Date.parse(value.startedAt);
  const completed = Date.parse(value.completedAt);
  if (![value.startedAt, value.completedAt].every((entry) => typeof entry === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(entry)) ||
      !Number.isFinite(started) || !Number.isFinite(completed) || completed < started) fail("native_admission_run_time_invalid");
  for (const [entry, expectedPath, cap] of [[value.selection, "infra/supply-chain/native-sources.json", MATERIAL_LIMITS.receiptBytes],
    [value.materialLock, "infra/supply-chain/native-materials.lock.json", MATERIAL_LIMITS.receiptBytes],
    [value.workflow, NATIVE_WORKFLOW_PATH, 64 * 1024]]) fileIdentity(entry, expectedPath, cap);
  if (value.run.workflowFileSha256 !== value.workflow.sha256) fail("native_admission_run_context_invalid");
  for (const [list, count] of [[value.nativeRecipeFiles, 19], [value.admissionRecipeFiles, null]]) {
    if (!Array.isArray(list) || count !== null && list.length !== count || list.length < 1 || list.length > 32) fail("native_admission_recipe_invalid");
    const seen = new Set();
    for (const entry of list) {
      if (!/^scripts\/supply-chain\/[a-z0-9-]+\.mjs$/u.test(entry?.path ?? "") || seen.has(entry.path)) fail("native_admission_recipe_invalid");
      fileIdentity(entry, entry.path, 8 * MiB);
      seen.add(entry.path);
    }
  }
  if (!value.admissionRecipeFiles.some((entry) => entry.path === "scripts/supply-chain/native-admission.mjs")) fail("native_admission_recipe_invalid");
  same(value.admissionRecipeFiles.map((entry) => entry.path), NATIVE_ADMISSION_IMPORT_PATHS, "native_admission_recipe_invalid");
  const required = [value.selection, value.materialLock, value.workflow, ...value.nativeRecipeFiles, ...value.admissionRecipeFiles];
  const expectedByPath = new Map();
  for (const expected of required) {
    const prior = expectedByPath.get(expected.path);
    if (prior && (prior.sha256 !== expected.sha256 || prior.size !== expected.size)) fail("native_admission_recipe_invalid");
    expectedByPath.set(expected.path, expected);
    const actual = files.get(expected.path);
    if (!actual || actual.sha256 !== expected.sha256 || actual.size !== expected.size) fail("native_admission_repository_input_invalid");
  }
  if (files.size !== expectedByPath.size) fail("native_admission_repository_input_invalid");
  return Object.freeze({ ...value, run: Object.freeze({ ...value.run }), source: Object.freeze({ ...value.source }), started, completed });
}

function validateInputBytes(input, expectedPath, cap) {
  assertClosedObject(input, ["path", "bytes", "sha256", "size"]);
  if (!Buffer.isBuffer(input.bytes) || input.path !== expectedPath || input.bytes.length !== input.size ||
      input.size < 1 || input.size > cap || sha256(input.bytes) !== input.sha256) fail("native_admission_repository_input_invalid");
  return input;
}

export async function validateNativeAdmissionRepositoryContext(repositoryRoot, repository) {
  if (!path.isAbsolute(repositoryRoot) || await realpath(repositoryRoot) !== repositoryRoot ||
      await realpath(MODULE_ROOT) !== repositoryRoot) fail("native_admission_repository_root_invalid");
  assertClosedObject(repository, ["context", "files", "authorIds"]);
  validateInputBytes(repository.context, "native-admission-context.json", 8 * MiB);
  if (!Array.isArray(repository.authorIds) || repository.authorIds.length < 2 || repository.authorIds.length > 16 ||
      repository.authorIds.some((entry) => !SAFE_ID.test(entry)) || new Set(repository.authorIds).size !== repository.authorIds.length ||
      !repository.authorIds.includes("/root") || !repository.authorIds.includes("/root/bootstrap_native_executor")) fail("native_admission_author_identity_invalid");
  if (!Array.isArray(repository.files) || repository.files.length < 1 || repository.files.length > 64) fail("native_admission_repository_input_invalid");
  const files = new Map();
  for (const entry of repository.files) {
    if (!entry || typeof entry.path !== "string" || files.has(entry.path)) fail("native_admission_repository_input_invalid");
    validateInputBytes(entry, entry.path, entry.path === NATIVE_WORKFLOW_PATH ? 64 * 1024 : 8 * MiB);
    files.set(entry.path, Object.freeze({ path: entry.path, bytes: Buffer.from(entry.bytes), sha256: entry.sha256, size: entry.size }));
  }
  const contextValue = parseBoundedJson(repository.context.bytes, { maxBytes: 8 * MiB, maxDepth: 32, maxMembers: 100_000 });
  if (canonicalJsonBuffer(contextValue).compare(repository.context.bytes) !== 0) fail("native_admission_json_noncanonical");
  const context = validateRunContext(contextValue, files);
  await verifyRepositoryFiles(repositoryRoot, files);
  return Object.freeze({ context, contextIdentity: Object.freeze({ path: repository.context.path, sha256: repository.context.sha256, size: repository.context.size }),
    files, authorIds: Object.freeze([...repository.authorIds]) });
}

async function verifyRepositoryFiles(repositoryRoot, files) {
  for (const [relative, expected] of files) {
    const cap = relative === NATIVE_WORKFLOW_PATH ? 64 * 1024 : 8 * MiB;
    const bytes = await readFileBounded(path.join(repositoryRoot, relative), cap);
    if (bytes.length !== expected.size || sha256(bytes) !== expected.sha256 || !bytes.equals(expected.bytes)) fail("native_admission_repository_input_changed");
  }
}

function deriveExpectations(selection, lock, lockSha256, run) {
  const sources = Object.fromEntries(lock.proposals.map((proposal) => [proposal.tool, proposal.sourceArchive]));
  const expectations = TOOLS.flatMap((tool) => [1, 2].map((repeat) => {
    const selected = selection.tools.find((entry) => entry.name === tool);
    const proposal = lock.proposals.find((entry) => entry.tool === tool);
    return { tool, repeat, sourceCommit: selected.commit, repositoryCommit: run.sourceSha,
      selectionSha256: lock.selectionSha256, materialLockSha256: lockSha256, recipeSha256: proposal.recipeSha256,
      compilerVersion: selection.compiler.version, runnerImageVersion: proposal.managedRunner.imageVersion,
      utilityInventorySha256: sha256(canonicalJsonBuffer(proposal.managedRunner.utilities)), run };
  }));
  return { sources, expectations };
}

function buildEntry(record, recordSha256) {
  return Object.freeze({ tool: record.tool, repeat: record.repeat, artifact: `native-candidate-${record.tool}-${record.repeat}`,
    recordSha256, sourceCommit: record.sourceCommit, repositoryCommit: record.repositoryCommit,
    selectionSha256: record.selectionSha256, materialLockSha256: record.materialLockSha256, recipeSha256: record.recipeSha256,
    run: record.run, runner: record.runner,
    outputs: record.outputs.map(({ target, sha256: digest, size, buildInfoSha256 }) => ({ target, sha256: digest, size, buildInfoSha256 })) });
}

function auditPaths(directory, subject) {
  const prefix = subject.prefix;
  return { receipt: path.join(directory, prefix, "receipt.json"), binary: path.join(directory, prefix, subject.filename),
    scanner: path.join(directory, "trivy-linux-amd64/trivy"), scannerVersion: path.join(directory, "scanner-version.json"),
    buildInfo: path.join(directory, prefix, "build-info.json"), moduleGraph: path.join(directory, prefix, "module-graph.json"),
    material: path.join(directory, prefix, "material-lock.json"), recipe: path.join(directory, prefix, "recipe.json"),
    sbom: path.join(directory, prefix, "sbom.json"), report: path.join(directory, prefix, "report.json"),
    database: path.join(directory, "databases/vulnerability.db"), databaseMetadata: path.join(directory, "databases/vulnerability.metadata.json"),
    javaDatabase: path.join(directory, "databases/java.db"), javaDatabaseMetadata: path.join(directory, "databases/java.metadata.json") };
}

export function validateOrasAdmissionEvidence(value, binarySha256) {
  assertClosedObject(value, ["binarySha256", "childDigest", "configDigest", "negatives", "parentDigest", "phase", "status"]);
  if (value.binarySha256 !== binarySha256 || value.phase !== "oras_cli_integration" || value.status !== "passed" ||
      ![value.parentDigest, value.childDigest, value.configDigest].every((entry) => /^sha256:[a-f0-9]{64}$/u.test(entry)) ||
      !Array.isArray(value.negatives) || value.negatives.length !== 6) fail("native_admission_oras_cli_invalid");
  const codes = value.negatives.map((entry) => entry?.code);
  same(codes, ["redirect_refused", "bearer_refused", "upload-location_refused", "proxy_environment_refused",
    "native_proxy_auth_scoped", "native_proxy_connect_refused"], "native_admission_oras_cli_invalid");
  for (const entry of value.negatives.slice(0, 3)) {
    assertClosedObject(entry, ["code", "scope", "challenges", "authenticatedRequests", "secondaryRequests"]);
    if (entry.scope !== "native_cli" || ![entry.challenges, entry.authenticatedRequests, entry.secondaryRequests].every((item) => Number.isSafeInteger(item) && item > 0)) fail("native_admission_oras_cli_invalid");
  }
  const environment = value.negatives[3];
  assertClosedObject(environment, ["code", "scope", "nativeCommandExecuted", "secondaryRequests"]);
  if (environment.scope !== "subprocess_environment_boundary" || environment.nativeCommandExecuted !== false || environment.secondaryRequests !== 0) fail("native_admission_oras_cli_invalid");
  const scoped = value.negatives[4];
  assertClosedObject(scoped, ["code", "scope", "nativeCommandExecuted", "authenticatedRequests", "proxyConnects"]);
  if (scoped.scope !== "native_cli" || scoped.nativeCommandExecuted !== true || ![scoped.authenticatedRequests, scoped.proxyConnects].every((item) => Number.isSafeInteger(item) && item > 0)) fail("native_admission_oras_cli_invalid");
  const refused = value.negatives[5];
  assertClosedObject(refused, ["code", "scope", "nativeCommandExecuted", "challenges", "secondaryRequests"]);
  if (refused.scope !== "native_cli" || refused.nativeCommandExecuted !== true || ![refused.challenges, refused.secondaryRequests].every((item) => Number.isSafeInteger(item) && item > 0)) fail("native_admission_oras_cli_invalid");
}

export function validateCosignAdmissionEvidence(value, binarySha256, source) {
  assertClosedObject(value, ["binarySha256", "bundleSha256", "network", "networkProof", "primaryKeySha256", "publicKeyBase64",
    "bundleBase64", "subjectBase64", "revokedLedger", "sourceCommit", "sourceSha256", "status", "subjectSha256", "tests"]);
  if (value.binarySha256 !== binarySha256 || value.sourceCommit !== source.commit || value.sourceSha256 !== source.archive.sha256 ||
      value.status !== "passed" || value.network !== "isolated_namespace" || value.revokedLedger !== "cosign_ledger_revoked" ||
      ![value.bundleSha256, value.primaryKeySha256, value.subjectSha256].every((entry) => HASH.test(entry)) ||
      ![value.publicKeyBase64, value.bundleBase64, value.subjectBase64].every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 8 * MiB)) {
    fail("native_admission_cosign_cli_invalid");
  }
  assertClosedObject(value.tests, ["missingKey", "tamper", "valid", "wrongKey"]);
  same(value.tests, { missingKey: "key_missing", tamper: "signature_invalid", valid: "signature_valid", wrongKey: "signature_invalid" }, "native_admission_cosign_cli_invalid");
  assertClosedObject(value.networkProof, ["interfaces", "ipv4NonLoopbackRoutes", "ipv6NonLoopbackRoutes", "status", "namespaceSha256", "parentNamespaceSha256", "probe"]);
  if (value.networkProof.status !== "isolated" || canonicalJsonBuffer(value.networkProof.interfaces).compare(canonicalJsonBuffer(["lo"])) !== 0 ||
      value.networkProof.ipv4NonLoopbackRoutes !== 0 || value.networkProof.ipv6NonLoopbackRoutes !== 0 ||
      !HASH.test(value.networkProof.namespaceSha256) || !HASH.test(value.networkProof.parentNamespaceSha256) ||
      value.networkProof.namespaceSha256 === value.networkProof.parentNamespaceSha256 || value.networkProof.probe !== "ENETUNREACH") fail("native_admission_cosign_cli_invalid");
  for (const [encoded, expected] of [[value.publicKeyBase64, value.primaryKeySha256], [value.bundleBase64, value.bundleSha256], [value.subjectBase64, value.subjectSha256]]) {
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length < 1 || bytes.length > 6 * MiB || bytes.toString("base64") !== encoded || sha256(bytes) !== expected) fail("native_admission_cosign_cli_invalid");
  }
}

async function validateCliDirectory(directory, matrix, records, lock, selection) {
  const names = ["native-cli-results.json", "oras-integration-native.json", "cosign-airgap-native.json"];
  await exactFiles(directory, names, "native_admission_cli_inventory_invalid");
  const summary = await boundedJson(path.join(directory, names[0]), 8 * MiB);
  assertClosedObject(summary.value, ["schemaVersion", "run", "materialLockSha256", "matrixSha256", "results"]);
  if (summary.value.schemaVersion !== 1 || summary.value.materialLockSha256 !== records[0].materialLockSha256 ||
      summary.value.matrixSha256 !== sha256(canonicalJsonBuffer(matrix)) || !Array.isArray(summary.value.results) || summary.value.results.length !== 2) {
    fail("native_admission_cli_summary_invalid");
  }
  validateNativeCiIdentity(summary.value.run, matrix.run);
  const expected = [{ tool: "oras", filename: names[1] }, { tool: "cosign", filename: names[2] }];
  const details = [];
  for (const [index, selected] of expected.entries()) {
    const result = summary.value.results[index];
    assertClosedObject(result, ["tool", "filename", "sha256", "binarySha256"]);
    const record = records.find((entry) => entry.tool === selected.tool && entry.repeat === 1);
    const output = record?.outputs.find((entry) => entry.target === "linux-amd64");
    if (!output || result.tool !== selected.tool || result.filename !== selected.filename || result.binarySha256 !== output.sha256) fail("native_admission_cli_summary_invalid");
    const detail = await boundedJson(path.join(directory, selected.filename), 8 * MiB, { canonical: false });
    if (detail.sha256 !== result.sha256) fail("native_admission_cli_summary_invalid");
    if (selected.tool === "oras") validateOrasAdmissionEvidence(detail.value, output.sha256);
    else {
      const source = selection.tools.find((entry) => entry.name === "cosign");
      const proposal = lock.proposals.find((entry) => entry.tool === "cosign");
      validateCosignAdmissionEvidence(detail.value, output.sha256, { commit: source.commit, archive: proposal.sourceArchive });
    }
    details.push(Object.freeze({ tool: selected.tool, path: selected.filename, sha256: detail.sha256, size: detail.size }));
  }
  return Object.freeze({ summary: Object.freeze({ path: names[0], sha256: summary.sha256, size: summary.size }), details: Object.freeze(details) });
}

async function validateAudit(directory, repositoryRoot, matrix, records, selection, lock, startedAt, completedAt) {
  const artifact = await validateNativeAuditComparisonArtifact(directory);
  const scannerOutput = records.find((entry) => entry.tool === "trivy" && entry.repeat === 1)?.outputs.find((entry) => entry.target === "linux-amd64");
  if (!scannerOutput) fail("native_admission_audit_invalid");
  const databaseIdentities = [
    { name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db:2", sha256: artifact.identities.get("databases/vulnerability.db")?.sha256,
      metadataSha256: artifact.identities.get("databases/vulnerability.metadata.json")?.sha256 },
    { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db:1", sha256: artifact.identities.get("databases/java.db")?.sha256,
      metadataSha256: artifact.identities.get("databases/java.metadata.json")?.sha256 },
  ];
  if (databaseIdentities.some((entry) => !HASH.test(entry.sha256 ?? "") || !HASH.test(entry.metadataSha256 ?? ""))) fail("native_admission_audit_invalid");
  const subjects = [];
  for (const subject of SUBJECTS) {
    const record = records.find((entry) => entry.tool === subject.tool && entry.repeat === 1);
    const output = record?.outputs.find((entry) => entry.target === subject.target);
    const selected = selection.tools.find((entry) => entry.name === subject.tool);
    const proposal = lock.proposals.find((entry) => entry.tool === subject.tool);
    if (!output || !selected || !proposal) fail("native_admission_audit_invalid");
    const inventory = deriveGoInventory({ tool: subject.tool, buildInfo: output.buildInfo, lockedModules: proposal.modules, goVersion: selection.compiler.version });
    const expectedSubject = { name: subject.tool, version: selected.modifiedVersion,
      os: subject.target === "windows-amd64" ? "windows" : "linux", architecture: "amd64", sha256: output.sha256, size: output.size,
      sourceCommit: selected.commit, materialSha256: record.materialLockSha256, recipeSha256: proposal.recipeSha256,
      buildInfoSha256: output.buildInfoSha256, moduleGraphSha256: sha256(canonicalJsonBuffer(proposal.modules)) };
    const files = auditPaths(directory, subject);
    const expectedFileIdentities = Object.fromEntries(Object.entries(files).map(([key, file]) => {
      const relative = path.relative(directory, file).split(path.sep).join("/");
      const captured = artifact.identities.get(relative);
      if (!captured) fail("native_admission_audit_invalid");
      return [key, { sha256: captured.sha256, size: captured.size }];
    }));
    const reportBytes = await readFileBounded(files.report, 64 * MiB);
    if (sha256(reportBytes) !== expectedFileIdentities.report.sha256 || reportBytes.length !== expectedFileIdentities.report.size) fail("native_admission_audit_changed");
    const report = parseBoundedJson(reportBytes, { maxBytes: 64 * MiB, maxDepth: 32, maxMembers: 100_000 });
    const created = Date.parse(report.CreatedAt);
    if (!Number.isFinite(created) || created < startedAt || created > completedAt) fail("native_admission_audit_time_invalid");
    const evaluation = await verifyNativeAuditFiles(files, { run: matrix.run, subject: expectedSubject,
      scanner: { name: "trivy", version: selection.tools.find((entry) => entry.name === "trivy").modifiedVersion, sha256: scannerOutput.sha256 },
      databases: databaseIdentities, artifactName: "subject", scanTarget: subject.filename, requiredPackages: inventory.packages }, created, expectedFileIdentities);
    if (evaluation.state !== "audit_proposal" || evaluation.blockers.length !== 0) fail("native_admission_audit_blocked");
    const receipt = artifact.identities.get(`${subject.prefix}/receipt.json`);
    const evidence = Object.fromEntries(["sbom", "report", "build-info", "module-graph", "material-lock", "recipe"].map((name) => {
      const item = artifact.identities.get(`${subject.prefix}/${name}.json`);
      if (!item) fail("native_admission_audit_invalid");
      return [name, item.sha256];
    }));
    subjects.push(Object.freeze({ subject, output, selected, proposal, receipt, evidence, evaluation }));
  }
  const summaryFile = artifact.identities.get("native-audit-results.json");
  if (!summaryFile) fail("native_admission_audit_invalid");
  assertClosedObject(artifact.summary.fixtures, ["manifest", "materials", "reports"]);
  fileIdentity(artifact.summary.fixtures.manifest, "infra/supply-chain/materials/scanner-fixtures/manifest.json", 64 * 1024);
  const fixtureManifest = await loadScannerFixtureManifest({ sha256: artifact.summary.fixtures.manifest.sha256,
    size: artifact.summary.fixtures.manifest.size });
  for (const item of subjects) {
    const result = artifact.summary.results.find((entry) => entry.tool === item.subject.tool && entry.target === item.subject.target);
    if (!result) fail("native_admission_audit_summary_invalid");
    assertClosedObject(result, ["tool", "target", "state", "packageCount", "findingCount", "blockerCount", "findingsSha256", "blockersSha256"]);
    if (result.state !== item.evaluation.state || result.packageCount !== item.evaluation.packageCount ||
        result.findingCount !== item.evaluation.findings.length || result.blockerCount !== 0 ||
        result.findingsSha256 !== sha256(canonicalJsonBuffer(item.evaluation.findings)) ||
        result.blockersSha256 !== sha256(canonicalJsonBuffer(item.evaluation.blockers))) fail("native_admission_audit_summary_invalid");
  }
  const fixtureInventory = scannerFixtureArtifactInventory();
  const expectedMaterials = fixtureManifest.fixtures.flatMap((entry) => entry.material).map((entry) => ({
    path: `materials/${entry.path}`, sha256: entry.sha256, size: entry.size,
  }));
  const expectedReports = fixtureManifest.fixtures.map(({ id }) => {
    const relative = `fixtures/reports/${id}.json`;
    const actual = artifact.identities.get(relative);
    if (!actual) fail("native_admission_audit_summary_invalid");
    return { fixtureId: id, path: relative, sha256: actual.sha256, size: actual.size };
  });
  same(fixtureInventory.materials, expectedMaterials.map((entry) => entry.path), "native_admission_audit_summary_invalid");
  same(fixtureInventory.reports.map((entry) => `fixtures/${entry}`), expectedReports.map((entry) => entry.path), "native_admission_audit_summary_invalid");
  same(artifact.summary.fixtures.materials, expectedMaterials, "native_admission_audit_summary_invalid");
  same(artifact.summary.fixtures.reports, expectedReports, "native_admission_audit_summary_invalid");
  for (const id of ["gomod-vulnerable", "java-war-vulnerable", "java-jar-clean-candidate"]) {
    const bytes = await readFileBounded(path.join(directory, `fixtures/reports/${id}.json`), 64 * MiB);
    const captured = artifact.identities.get(`fixtures/reports/${id}.json`);
    if (!captured || sha256(bytes) !== captured.sha256 || bytes.length !== captured.size) fail("native_admission_audit_changed");
    validateScannerFixtureReport(id, parseBoundedJson(bytes, { maxBytes: 64 * MiB, maxDepth: 32, maxMembers: 100_000 }));
  }
  return Object.freeze({ artifact, subjects: Object.freeze(subjects), scanner: Object.freeze({ name: "trivy",
    version: selection.tools.find((entry) => entry.name === "trivy").modifiedVersion, sha256: scannerOutput.sha256 }),
    databases: Object.freeze(databaseIdentities), fixtureManifest: Object.freeze({ identity: { ...artifact.summary.fixtures.manifest }, value: fixtureManifest }),
    packageReceipt: Object.freeze({ path: "diagnostic-package.json", ...artifact.packageIdentity }),
    summary: Object.freeze({ path: "native-audit-results.json", sha256: summaryFile.sha256, size: summaryFile.size }) });
}

async function validateBaselineDirectory(directory, auditDirectory, audit, matrix, run, repositoryFiles, fixtureManifest) {
  const names = ["baseline-comparison.json", "gomod-vulnerable.json", "java-war-vulnerable.json", "tcb-managed-docker.json", "tcb-inventory.json"];
  await exactFiles(directory, names, "native_admission_baseline_inventory_invalid");
  const receipt = await boundedJson(path.join(directory, names[0]), 8 * MiB);
  assertClosedObject(receipt.value, ["schemaVersion", "state", "comparisonStatus", "run", "baseline", "candidate", "tcbEvidence", "reports", "comparison"]);
  if (receipt.value.schemaVersion !== 1 || receipt.value.state !== "failed_non_admitted" || receipt.value.comparisonStatus !== "match") fail("native_admission_baseline_invalid");
  validateNativeCiIdentity(receipt.value.run, run);
  assertClosedObject(receipt.value.baseline, ["image", "version", "tcbIdentitySha256"]);
  assertClosedObject(receipt.value.candidate, ["version", "matrixSha256"]);
  if (receipt.value.baseline.version !== "0.74.0" || !/^aquasec\/trivy@sha256:[a-f0-9]{64}$/u.test(receipt.value.baseline.image) ||
      !HASH.test(receipt.value.baseline.tcbIdentitySha256) || receipt.value.candidate.version !== "0.74.0-autoworld.1" ||
      receipt.value.candidate.matrixSha256 !== sha256(canonicalJsonBuffer(matrix))) fail("native_admission_baseline_invalid");
  if (!Array.isArray(receipt.value.tcbEvidence) || receipt.value.tcbEvidence.length !== 2 ||
      !Array.isArray(receipt.value.reports) || receipt.value.reports.length !== 2 ||
      !Array.isArray(receipt.value.comparison) || receipt.value.comparison.length !== 2) fail("native_admission_baseline_invalid");
  const expectedTcb = ["tcb-managed-docker.json", "tcb-inventory.json"];
  const tcb = [];
  const tcbValues = [];
  let verifiedTcb;
  for (const [index, entry] of receipt.value.tcbEvidence.entries()) {
    fileIdentity(entry, expectedTcb[index], 64 * 1024);
    const actual = await boundedJson(path.join(directory, entry.path), 64 * 1024);
    if (actual.sha256 !== entry.sha256 || actual.size !== entry.size) fail("native_admission_baseline_changed");
    tcb.push(Object.freeze({ ...entry }));
    tcbValues.push(actual.value);
  }
  const [managed, inventory] = tcbValues;
  const baselineRecipe = repositoryFiles.get("scripts/supply-chain/baseline-scanner.mjs");
  if (!baselineRecipe) fail("native_admission_baseline_invalid");
  verifiedTcb = await validateBaselineTcbReceipt(managed, inventory,
    { expectedRun: run, expectedRecipeSha256: baselineRecipe.sha256 });
  if (verifiedTcb.identitySha256 !== receipt.value.baseline.tcbIdentitySha256 ||
      receipt.value.baseline.image !== `aquasec/trivy@${verifiedTcb.image.child}`) fail("native_admission_baseline_invalid");
  const expectedInventory = await loadBaselineExpectedInventory(fixtureManifest);
  const candidateReports = [];
  const baselineReports = [];
  const expected = [];
  for (const [index, id] of ["gomod-vulnerable", "java-war-vulnerable"].entries()) {
    const entry = receipt.value.reports[index];
    assertClosedObject(entry, ["fixtureId", "path", "sha256", "size"]);
    if (entry.fixtureId !== id || entry.path !== `${id}.json`) fail("native_admission_baseline_invalid");
    identity({ sha256: entry.sha256, size: entry.size }, 64 * MiB);
    const actualBytes = await readFileBounded(path.join(directory, entry.path), 64 * MiB);
    if (sha256(actualBytes) !== entry.sha256 || actualBytes.length !== entry.size) fail("native_admission_baseline_changed");
    const baselineReport = parseBoundedJson(actualBytes, { maxBytes: 64 * MiB, maxDepth: 32, maxMembers: 100_000 });
    const candidateBytes = await readFileBounded(path.join(auditDirectory, `fixtures/reports/${id}.json`), 64 * MiB);
    const candidateReport = parseBoundedJson(candidateBytes, { maxBytes: 64 * MiB, maxDepth: 32, maxMembers: 100_000 });
    const normalizedCandidate = normalizeBaselineComparisonReport(id, candidateReport, "0.74.0-autoworld.1");
    const normalizedBaseline = normalizeBaselineComparisonReport(id, baselineReport, "0.74.0");
    candidateReports.push(normalizedCandidate);
    baselineReports.push(normalizedBaseline);
    expected.push(expectedInventory.find((item) => item.fixtureId === id));
    const retained = audit.artifact.identities.get(`fixtures/reports/${id}.json`);
    if (!retained || retained.sha256 !== sha256(candidateBytes) || retained.size !== candidateBytes.length) fail("native_admission_baseline_changed");
  }
  const comparison = compareBaselineReports(candidateReports, baselineReports, expected);
  if (!comparison.matched) fail("native_admission_baseline_mismatch");
  same(receipt.value.comparison, comparison.comparisons, "native_admission_baseline_invalid");
  return Object.freeze({ receipt: Object.freeze({ path: names[0], sha256: receipt.sha256, size: receipt.size }),
    state: receipt.value.state, comparisonStatus: receipt.value.comparisonStatus, tcbIdentitySha256: receipt.value.baseline.tcbIdentitySha256,
    evidence: Object.freeze(tcb), reports: Object.freeze(receipt.value.reports.map((entry) => Object.freeze({ ...entry }))) });
}

function closureIdentity(files) {
  return sha256(canonicalJsonBuffer(files.map(({ path: filename, sha256: digest, size }) => ({ path: filename, sha256: digest, size }))));
}

function validatePayloadShape(payload) {
  assertClosedObject(payload, ["schemaVersion", "state", "intendedStage", "activation", "repository", "run", "authors", "materials",
    "builds", "outputs", "reproduction", "cli", "audit", "baseline"]);
  if (payload.schemaVersion !== 1 || payload.state !== "native_admission_payload" || payload.intendedStage !== "merged_pending_activation") fail("native_admission_payload_invalid");
  assertClosedObject(payload.activation, ["status", "capabilities"]);
  if (payload.activation.status !== "blocked" || !Array.isArray(payload.activation.capabilities) || payload.activation.capabilities.length !== 0) fail("native_admission_capability_refused");
  assertClosedObject(payload.repository, ["context", "selection", "materialLock", "workflow", "nativeRecipeSha256", "admissionRecipeSha256"]);
  fileIdentity(payload.repository.context, "native-admission-context.json", 8 * MiB);
  for (const entry of [payload.repository.selection, payload.repository.materialLock, payload.repository.workflow]) identity(entry, 8 * MiB);
  if (![payload.repository.nativeRecipeSha256, payload.repository.admissionRecipeSha256].every((entry) => HASH.test(entry))) fail("native_admission_payload_invalid");
  if (!Array.isArray(payload.authors) || payload.authors.length < 2 || new Set(payload.authors).size !== payload.authors.length || payload.authors.some((entry) => !SAFE_ID.test(entry))) fail("native_admission_author_identity_invalid");
  if (!payload.authors.includes("/root") || !payload.authors.includes("/root/bootstrap_native_executor")) fail("native_admission_author_identity_invalid");
  validateNativeCiIdentity(payload.run, payload.run);
  assertClosedObject(payload.materials, ["selectionSha256", "materialLockSha256", "moduleGraphs"]);
  assertClosedObject(payload.materials.moduleGraphs, TOOLS);
  if (![payload.materials.selectionSha256, payload.materials.materialLockSha256, ...Object.values(payload.materials.moduleGraphs)].every((entry) => HASH.test(entry))) fail("native_admission_payload_invalid");
  if (payload.materials.materialLockSha256 !== payload.repository.materialLock.sha256) fail("native_admission_payload_invalid");
  if (!Array.isArray(payload.builds) || payload.builds.length !== 6 || new Set(payload.builds.map((entry) => `${entry.tool}:${entry.repeat}`)).size !== 6 ||
      !BUILD_KEYS.every((key) => payload.builds.some((entry) => `${entry.tool}:${entry.repeat}` === key))) fail("native_admission_builds_invalid");
  for (const entry of payload.builds) {
    assertClosedObject(entry, ["tool", "repeat", "artifact", "recordSha256", "sourceCommit", "repositoryCommit", "selectionSha256",
      "materialLockSha256", "recipeSha256", "run", "runner", "outputs"]);
    if (!TOOLS.includes(entry.tool) || ![1, 2].includes(entry.repeat) || entry.artifact !== `native-candidate-${entry.tool}-${entry.repeat}` || !HASH.test(entry.recordSha256) || !Array.isArray(entry.outputs)) fail("native_admission_builds_invalid");
    if (!COMMIT.test(entry.sourceCommit) || entry.repositoryCommit !== payload.run.sourceSha ||
        entry.selectionSha256 !== payload.materials.selectionSha256 || entry.materialLockSha256 !== payload.repository.materialLock.sha256 ||
        !HASH.test(entry.recipeSha256)) fail("native_admission_builds_invalid");
    validateNativeCiIdentity(entry.run, payload.run);
    assertClosedObject(entry.runner, ["label", "imageVersion", "utilityInventorySha256"]);
    if (entry.runner.label !== "ubuntu-24.04" || entry.runner.imageVersion !== "20260831.293.1" ||
        !HASH.test(entry.runner.utilityInventorySha256)) fail("native_admission_builds_invalid");
    for (const output of entry.outputs) {
      assertClosedObject(output, ["target", "sha256", "size", "buildInfoSha256"]);
      identity({ sha256: output.sha256, size: output.size }, 2 * GiB);
      if (!HASH.test(output.buildInfoSha256)) fail("native_admission_builds_invalid");
    }
    const expectedTargets = entry.tool === "cosign" ? ["linux-amd64", "windows-amd64"] : ["linux-amd64"];
    if (canonicalJsonBuffer(entry.outputs.map((output) => output.target)).compare(canonicalJsonBuffer(expectedTargets)) !== 0) fail("native_admission_builds_invalid");
  }
  if (new Set(payload.builds.map((entry) => entry.recordSha256)).size !== 6) fail("native_admission_builds_invalid");
  const runner = canonicalJsonBuffer(payload.builds[0].runner);
  if (payload.builds.some((entry) => canonicalJsonBuffer(entry.runner).compare(runner) !== 0)) fail("native_admission_builds_invalid");
  if (!Array.isArray(payload.outputs) || payload.outputs.length !== 4 || new Set(payload.outputs.map((entry) => `${entry.tool}:${entry.target}`)).size !== 4) fail("native_admission_outputs_invalid");
  same(payload.outputs.map((entry) => `${entry.tool}:${entry.target}`), SUBJECTS.map((entry) => `${entry.tool}:${entry.target}`), "native_admission_outputs_invalid");
  for (const entry of payload.outputs) {
    assertClosedObject(entry, ["tool", "target", "sha256", "size", "buildInfoSha256"]);
    identity({ sha256: entry.sha256, size: entry.size }, 2 * GiB);
    if (!HASH.test(entry.buildInfoSha256)) fail("native_admission_outputs_invalid");
  }
  for (const subject of SUBJECTS) {
    const twins = payload.builds.filter((entry) => entry.tool === subject.tool).map((entry) => entry.outputs.find((output) => output.target === subject.target));
    const retained = payload.outputs.find((entry) => entry.tool === subject.tool && entry.target === subject.target);
    if (!retained || twins.some((entry) => !entry) || canonicalJsonBuffer(twins[0]).compare(canonicalJsonBuffer(twins[1])) !== 0 ||
        ["target", "sha256", "size", "buildInfoSha256"].some((key) => twins[0][key] !== retained[key])) fail("native_admission_outputs_invalid");
  }
  assertClosedObject(payload.reproduction, ["sha256", "size", "state"]);
  identity({ sha256: payload.reproduction.sha256, size: payload.reproduction.size }, 8 * MiB);
  assertClosedObject(payload.cli, ["summary", "details"]);
  fileIdentity(payload.cli.summary, "native-cli-results.json", 8 * MiB);
  if (!Array.isArray(payload.cli.details) || payload.cli.details.length !== 2) fail("native_admission_payload_invalid");
  for (const [index, entry] of payload.cli.details.entries()) {
    assertClosedObject(entry, ["tool", "path", "sha256", "size"]);
    if (entry.tool !== ["oras", "cosign"][index] || entry.path !== ["oras-integration-native.json", "cosign-airgap-native.json"][index]) fail("native_admission_payload_invalid");
    identity({ sha256: entry.sha256, size: entry.size }, 8 * MiB);
  }
  assertClosedObject(payload.audit, ["package", "summary", "fileCount", "subjects", "scanner", "databases", "fixtureManifest"]);
  fileIdentity(payload.audit.package, "diagnostic-package.json", 64 * 1024);
  fileIdentity(payload.audit.summary, "native-audit-results.json", 8 * MiB);
  assertClosedObject(payload.audit.scanner, ["name", "version", "sha256"]);
  if (payload.audit.scanner.name !== "trivy" || payload.audit.scanner.version !== "0.74.0-autoworld.1" ||
      !HASH.test(payload.audit.scanner.sha256)) fail("native_admission_payload_invalid");
  if (!Array.isArray(payload.audit.databases) || payload.audit.databases.length !== 2) fail("native_admission_payload_invalid");
  for (const entry of payload.audit.databases) {
    assertClosedObject(entry, ["name", "repository", "sha256", "metadataSha256"]);
    if (![entry.sha256, entry.metadataSha256].every((value) => HASH.test(value))) fail("native_admission_payload_invalid");
  }
  if (canonicalJsonBuffer(payload.audit.databases.map((entry) => [entry.name, entry.repository])).compare(canonicalJsonBuffer([
    ["vulnerability", "ghcr.io/aquasecurity/trivy-db:2"], ["java", "ghcr.io/aquasecurity/trivy-java-db:1"]])) !== 0 ||
      payload.audit.scanner.sha256 !== payload.outputs.find((entry) => entry.tool === "trivy" && entry.target === "linux-amd64")?.sha256) fail("native_admission_payload_invalid");
  fileIdentity(payload.audit.fixtureManifest, "infra/supply-chain/materials/scanner-fixtures/manifest.json", 64 * 1024);
  for (const entry of payload.audit.subjects) {
    assertClosedObject(entry, ["tool", "target", "receipt", "evidence"]);
    assertClosedObject(entry.receipt, ["sha256", "size", "cap"]);
    if (entry.receipt.cap !== 8 * MiB) fail("native_admission_payload_invalid");
    identity({ sha256: entry.receipt.sha256, size: entry.receipt.size }, entry.receipt.cap);
    assertClosedObject(entry.evidence, ["sbom", "report", "build-info", "module-graph", "material-lock", "recipe"]);
    if (!Object.values(entry.evidence).every((value) => HASH.test(value))) fail("native_admission_payload_invalid");
    const output = payload.outputs.find((item) => item.tool === entry.tool && item.target === entry.target);
    if (!output || entry.evidence["build-info"] !== output.buildInfoSha256 || entry.evidence["module-graph"] !== payload.materials.moduleGraphs[entry.tool] ||
        entry.evidence["material-lock"] !== payload.repository.materialLock.sha256 ||
        entry.evidence.recipe !== payload.builds.find((item) => item.tool === entry.tool).recipeSha256) fail("native_admission_payload_invalid");
  }
  same(payload.audit.subjects.map((entry) => `${entry.tool}:${entry.target}`), SUBJECTS.map((entry) => `${entry.tool}:${entry.target}`), "native_admission_payload_invalid");
  assertClosedObject(payload.baseline, ["receipt", "state", "comparisonStatus", "tcbIdentitySha256", "evidence", "reports"]);
  fileIdentity(payload.baseline.receipt, "baseline-comparison.json", 8 * MiB);
  if (!HASH.test(payload.baseline.tcbIdentitySha256) || !Array.isArray(payload.baseline.evidence) || payload.baseline.evidence.length !== 2 ||
      !Array.isArray(payload.baseline.reports) || payload.baseline.reports.length !== 2) fail("native_admission_payload_invalid");
  for (const entry of payload.baseline.evidence) fileIdentity(entry, entry.path, 64 * 1024);
  if (canonicalJsonBuffer(payload.baseline.evidence.map((entry) => entry.path)).compare(canonicalJsonBuffer(["tcb-managed-docker.json", "tcb-inventory.json"])) !== 0) fail("native_admission_payload_invalid");
  for (const entry of payload.baseline.reports) {
    assertClosedObject(entry, ["fixtureId", "path", "sha256", "size"]);
    identity({ sha256: entry.sha256, size: entry.size }, 64 * MiB);
  }
  if (canonicalJsonBuffer(payload.baseline.reports.map((entry) => [entry.fixtureId, entry.path])).compare(canonicalJsonBuffer([
    ["gomod-vulnerable", "gomod-vulnerable.json"], ["java-war-vulnerable", "java-war-vulnerable.json"]])) !== 0) fail("native_admission_payload_invalid");
  if (payload.reproduction.state !== "reproducible_candidate" || payload.audit.fileCount !== 49 || payload.audit.subjects.length !== 4 ||
      payload.baseline.state !== "failed_non_admitted" || payload.baseline.comparisonStatus !== "match") fail("native_admission_payload_invalid");
  return payload;
}

export function validateNativeAdmissionPayload(bytes, expected = undefined) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 8 * MiB) fail("native_admission_payload_size_invalid");
  const value = parseBoundedJson(bytes, { maxBytes: 8 * MiB, maxDepth: 32, maxMembers: 100_000 });
  if (!canonicalJsonBuffer(value).equals(bytes)) fail("native_admission_json_noncanonical");
  validatePayloadShape(value);
  if (expected) same(value, expected, "native_admission_payload_changed");
  return value;
}

export async function deriveNativeAdmissionPayload({ repositoryRoot, repository, candidateDirectory, reproducibilityFile,
  cliDirectory, auditDirectory, baselineDirectory, environment = process.env }) {
  requireLocalDataOnly(environment);
  const repo = await validateNativeAdmissionRepositoryContext(repositoryRoot, repository);
  const selectionInput = repo.files.get(repo.context.selection.path);
  const lockInput = repo.files.get(repo.context.materialLock.path);
  const workflowInput = repo.files.get(repo.context.workflow.path);
  const selection = validateSourceSelection(parseBoundedJson(selectionInput.bytes, { maxBytes: MATERIAL_LIMITS.receiptBytes }));
  const lock = validateMaterialLock(parseBoundedJson(lockInput.bytes, { maxBytes: MATERIAL_LIMITS.receiptBytes }), selection);
  validatePreparationWorkflow(workflowInput.bytes.toString("utf8"));
  if (sha256(canonicalJsonBuffer(selection)) !== lock.selectionSha256 || lockInput.sha256 !== repo.context.materialLock.sha256) fail("native_admission_material_invalid");
  const nativePaths = lock.proposals[0].recipeFiles.map((entry) => entry.path);
  same(repo.context.nativeRecipeFiles.map((entry) => entry.path), nativePaths, "native_admission_recipe_invalid");
  for (const proposal of lock.proposals) {
    same(proposal.recipeFiles, repo.context.nativeRecipeFiles, "native_admission_recipe_invalid");
  }
  await preflightEvidenceBudget([candidateDirectory, reproducibilityFile, cliDirectory, auditDirectory, baselineDirectory], repo.files);
  const { sources, expectations } = deriveExpectations(selection, lock, lockInput.sha256, repo.context.run);
  const matrix = await verifyCandidateArtifactMatrix(candidateDirectory, expectations, sources);
  const records = await loadVerifiedCandidateRecords(candidateDirectory, matrix, expectations);
  const reproduction = await boundedJson(reproducibilityFile, 8 * MiB);
  same(reproduction.value, matrix, "native_admission_reproduction_invalid");
  const cli = await validateCliDirectory(cliDirectory, matrix, records, lock, selection);
  const audit = await validateAudit(auditDirectory, repositoryRoot, matrix, records, selection, lock, repo.context.started, repo.context.completed);
  const baseline = await validateBaselineDirectory(baselineDirectory, auditDirectory, audit, matrix, repo.context.run, repo.files, audit.fixtureManifest.value);
  const builds = matrix.records.map((entry) => buildEntry(records.find((record) => `native-candidate-${record.tool}-${record.repeat}` === entry.artifact), entry.sha256));
  const outputs = SUBJECTS.map((subject) => {
    const output = records.find((record) => record.tool === subject.tool && record.repeat === 1).outputs.find((entry) => entry.target === subject.target);
    return { tool: subject.tool, target: subject.target, sha256: output.sha256, size: output.size, buildInfoSha256: output.buildInfoSha256 };
  });
  const payload = {
    schemaVersion: 1, state: "native_admission_payload", intendedStage: "merged_pending_activation",
    activation: { status: "blocked", capabilities: [] },
    repository: { context: repo.contextIdentity, selection: { sha256: selectionInput.sha256, size: selectionInput.size },
      materialLock: { sha256: lockInput.sha256, size: lockInput.size }, workflow: { sha256: workflowInput.sha256, size: workflowInput.size },
      nativeRecipeSha256: closureIdentity(repo.context.nativeRecipeFiles), admissionRecipeSha256: closureIdentity(repo.context.admissionRecipeFiles) },
    run: repo.context.run, authors: repo.authorIds,
    materials: { selectionSha256: lock.selectionSha256, materialLockSha256: lockInput.sha256,
      moduleGraphs: Object.fromEntries(lock.proposals.map((entry) => [entry.tool, sha256(canonicalJsonBuffer(entry.modules))])) },
    builds, outputs,
    reproduction: { sha256: reproduction.sha256, size: reproduction.size, state: reproduction.value.state }, cli,
    audit: { package: audit.packageReceipt, summary: audit.summary, fileCount: audit.artifact.identities.size,
      subjects: audit.subjects.map((entry) => ({ tool: entry.subject.tool, target: entry.subject.target, receipt: entry.receipt, evidence: entry.evidence })),
      scanner: audit.scanner, databases: audit.databases, fixtureManifest: audit.fixtureManifest.identity },
    baseline,
  };
  const bytes = canonicalJsonBuffer(payload);
  validateNativeAdmissionPayload(bytes, payload);
  await verifyCandidateArtifactMatrix(candidateDirectory, expectations, sources);
  await verifyRepositoryFiles(repositoryRoot, repo.files);
  return Object.freeze({ payload: Object.freeze(payload), bytes, sha256: sha256(bytes), size: bytes.length });
}

function validateReview(input, payloadResult, authors, expectedKind) {
  assertClosedObject(input, ["receipt", "report"]);
  validateInputBytes(input.receipt, REVIEW_PATHS[expectedKind].receipt, 8 * MiB);
  validateInputBytes(input.report, REVIEW_PATHS[expectedKind].report, 8 * MiB);
  const record = parseBoundedJson(input.receipt.bytes, { maxBytes: 8 * MiB, maxDepth: 32, maxMembers: 100_000 });
  if (!canonicalJsonBuffer(record).equals(input.receipt.bytes)) fail("native_admission_json_noncanonical");
  assertClosedObject(record, ["schemaVersion", "state", "kind", "verdict", "reviewerId", "payloadSha256", "run", "bindings", "report", "reviewSource"]);
  assertClosedObject(record.bindings, ["selectionSha256", "materialLockSha256", "workflowSha256", "nativeRecipeSha256", "admissionRecipeSha256"]);
  assertClosedObject(record.report, ["path", "sha256", "size"]);
  assertClosedObject(record.reviewSource, ["kind", "id"]);
  if (record.schemaVersion !== 1 || record.state !== "native_admission_review" || record.kind !== expectedKind || record.verdict !== "approve" ||
      !SAFE_ID.test(record.reviewerId) || authors.includes(record.reviewerId) || record.payloadSha256 !== payloadResult.sha256) fail("native_admission_review_invalid");
  validateNativeCiIdentity(record.run, payloadResult.payload.run);
  same(record.bindings, { selectionSha256: payloadResult.payload.repository.selection.sha256,
    materialLockSha256: payloadResult.payload.repository.materialLock.sha256,
    workflowSha256: payloadResult.payload.repository.workflow.sha256,
    nativeRecipeSha256: payloadResult.payload.repository.nativeRecipeSha256,
    admissionRecipeSha256: payloadResult.payload.repository.admissionRecipeSha256 }, "native_admission_review_invalid");
  same(record.report, { path: input.report.path, sha256: input.report.sha256, size: input.report.size }, "native_admission_review_invalid");
  if (record.reviewSource.kind === "git_commit" && !COMMIT.test(record.reviewSource.id)) {
    fail("native_admission_review_source_invalid");
  }
  return Object.freeze({ kind: expectedKind, reviewerId: record.reviewerId,
    receipt: { path: input.receipt.path, sha256: input.receipt.sha256, size: input.receipt.size }, report: record.report,
    reviewSource: record.reviewSource, record });
}

export function createNativeAdmissionReviewReceipt({ kind, reviewerId, payload, report, reviewSource }) {
  if (!NATIVE_ADMISSION_REVIEW_KINDS.includes(kind)) fail("native_admission_review_invalid");
  if (!payload || sha256(payload.bytes) !== payload.sha256 || payload.size !== payload.bytes.length) fail("native_admission_payload_changed");
  validateNativeAdmissionPayload(payload.bytes, payload.payload);
  if (!SAFE_ID.test(reviewerId) || payload.payload.authors.includes(reviewerId)) fail("native_admission_review_invalid");
  if (report.path !== REVIEW_PATHS[kind].report) fail("native_admission_review_invalid");
  fileIdentity(report, report.path, 8 * MiB);
  assertClosedObject(reviewSource, ["kind", "id"]);
  if (!["git_commit", "external_event"].includes(reviewSource.kind) || !SAFE_ID.test(reviewSource.id) ||
      reviewSource.kind === "git_commit" && !COMMIT.test(reviewSource.id)) fail("native_admission_review_source_invalid");
  const record = { schemaVersion: 1, state: "native_admission_review", kind, verdict: "approve", reviewerId,
    payloadSha256: payload.sha256, run: payload.payload.run,
    bindings: { selectionSha256: payload.payload.repository.selection.sha256, materialLockSha256: payload.payload.repository.materialLock.sha256,
      workflowSha256: payload.payload.repository.workflow.sha256, nativeRecipeSha256: payload.payload.repository.nativeRecipeSha256,
      admissionRecipeSha256: payload.payload.repository.admissionRecipeSha256 }, report, reviewSource };
  const bytes = canonicalJsonBuffer(record);
  return Object.freeze({ record: Object.freeze(record), bytes, sha256: sha256(bytes), size: bytes.length });
}

export function validateReviewedNativeAdmissionProposal(bytes, expectedPayload) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 8 * MiB) fail("native_admission_proposal_size_invalid");
  const value = parseBoundedJson(bytes, { maxBytes: 8 * MiB, maxDepth: 32, maxMembers: 100_000 });
  if (!canonicalJsonBuffer(value).equals(bytes)) fail("native_admission_json_noncanonical");
  assertClosedObject(value, ["schemaVersion", "state", "intendedStage", "activation", "payload", "payloadSha256", "reviews", "supportingReviews"]);
  assertClosedObject(value.activation, ["status", "capabilities"]);
  if (value.schemaVersion !== 1 || value.state !== "reviewed_admission_proposal" || value.intendedStage !== "merged_pending_activation" ||
      value.payloadSha256 !== sha256(canonicalJsonBuffer(value.payload)) || !Array.isArray(value.reviews) || value.reviews.length !== 2 ||
      !Array.isArray(value.supportingReviews)) fail("native_admission_proposal_invalid");
  validatePayloadShape(value.payload);
  if (!expectedPayload) fail("native_admission_expected_payload_required");
  same(value.payload, expectedPayload, "native_admission_payload_changed");
  if (value.activation.status !== "blocked" || !Array.isArray(value.activation.capabilities) || value.activation.capabilities.length !== 0 ||
      canonicalJsonBuffer(value.reviews.map((entry) => entry.kind)).compare(canonicalJsonBuffer(NATIVE_ADMISSION_REVIEW_KINDS)) !== 0 ||
      new Set(value.reviews.map((entry) => entry.reviewerId)).size !== 2 || value.reviews.some((entry) => value.payload.authors.includes(entry.reviewerId))) {
    fail("native_admission_proposal_invalid");
  }
  for (const [index, entry] of value.reviews.entries()) {
    assertClosedObject(entry, ["kind", "reviewerId", "receipt", "report", "reviewSource", "record"]);
    if (entry.kind !== NATIVE_ADMISSION_REVIEW_KINDS[index] || !SAFE_ID.test(entry.reviewerId)) fail("native_admission_proposal_invalid");
    fileIdentity(entry.receipt, entry.receipt.path, 8 * MiB);
    fileIdentity(entry.report, entry.report.path, 8 * MiB);
    assertClosedObject(entry.reviewSource, ["kind", "id"]);
    if (entry.receipt.path !== REVIEW_PATHS[entry.kind].receipt || entry.report.path !== REVIEW_PATHS[entry.kind].report) fail("native_admission_review_invalid");
    assertClosedObject(entry.record, ["schemaVersion", "state", "kind", "verdict", "reviewerId", "payloadSha256", "run", "bindings", "report", "reviewSource"]);
    assertClosedObject(entry.record.bindings, ["selectionSha256", "materialLockSha256", "workflowSha256", "nativeRecipeSha256", "admissionRecipeSha256"]);
    assertClosedObject(entry.record.report, ["path", "sha256", "size"]);
    assertClosedObject(entry.record.reviewSource, ["kind", "id"]);
    if (entry.record.kind !== entry.kind || entry.record.reviewerId !== entry.reviewerId || entry.record.payloadSha256 !== value.payloadSha256 ||
        canonicalJsonBuffer(entry.record.report).compare(canonicalJsonBuffer(entry.report)) !== 0 ||
        canonicalJsonBuffer(entry.record.reviewSource).compare(canonicalJsonBuffer(entry.reviewSource)) !== 0 ||
        entry.record.schemaVersion !== 1 || entry.record.state !== "native_admission_review" || entry.record.verdict !== "approve" ||
        sha256(canonicalJsonBuffer(entry.record)) !== entry.receipt.sha256 || canonicalJsonBuffer(entry.record).length !== entry.receipt.size) fail("native_admission_review_invalid");
    if (!["git_commit", "external_event"].includes(entry.reviewSource.kind) || !SAFE_ID.test(entry.reviewSource.id) ||
        entry.reviewSource.kind === "git_commit" && !COMMIT.test(entry.reviewSource.id)) fail("native_admission_review_source_invalid");
    validateNativeCiIdentity(entry.record.run, value.payload.run);
    same(entry.record.bindings, { selectionSha256: value.payload.repository.selection.sha256,
      materialLockSha256: value.payload.repository.materialLock.sha256, workflowSha256: value.payload.repository.workflow.sha256,
      nativeRecipeSha256: value.payload.repository.nativeRecipeSha256, admissionRecipeSha256: value.payload.repository.admissionRecipeSha256 },
    "native_admission_review_invalid");
  }
  if (value.supportingReviews.length !== 0) fail("native_admission_supporting_review_invalid");
  return value;
}

async function writeNativeAdmissionExclusive(bytes, outputFile, expectedPayload) {
  validateReviewedNativeAdmissionProposal(bytes, expectedPayload);
  if (!path.isAbsolute(outputFile) || path.basename(outputFile) !== "native-admission.json") fail("native_admission_output_invalid");
  const parent = path.dirname(outputFile);
  if (await realpath(parent) !== parent) fail("native_admission_output_invalid");
  const staging = await mkdtemp(path.join(parent, ".native-admission-"));
  const staged = path.join(staging, "native-admission.json");
  try {
    await writeFile(staged, bytes, { flag: "wx", mode: 0o600 });
    await link(staged, outputFile);
    await unlink(staged);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return Object.freeze({ path: outputFile, sha256: sha256(bytes), size: bytes.length });
}

export async function finalizeNativeAdmissionProposal({ derivation, reviews, supportingReviews = [], outputFile, environment = process.env }) {
  requireLocalDataOnly(environment);
  if (outputFile !== path.join(derivation.repositoryRoot, "infra/supply-chain/native-admission.json")) fail("native_admission_output_invalid");
  const payload = await deriveNativeAdmissionPayload({ ...derivation, environment });
  if (!Array.isArray(reviews) || reviews.length !== 2 || !Array.isArray(supportingReviews) || supportingReviews.length !== 0) fail("native_admission_review_invalid");
  const validated = reviews.map((entry, index) => validateReview(entry, payload, payload.payload.authors, NATIVE_ADMISSION_REVIEW_KINDS[index]));
  if (validated[0].reviewerId === validated[1].reviewerId) fail("native_admission_reviewer_duplicate");
  const support = [];
  const proposal = { schemaVersion: 1, state: "reviewed_admission_proposal", intendedStage: "merged_pending_activation",
    activation: { status: "blocked", capabilities: [] }, payload: payload.payload, payloadSha256: payload.sha256,
    reviews: validated, supportingReviews: support };
  const bytes = canonicalJsonBuffer(proposal);
  validateReviewedNativeAdmissionProposal(bytes, payload.payload);
  const finalPayload = await deriveNativeAdmissionPayload({ ...derivation, environment });
  if (finalPayload.sha256 !== payload.sha256 || !finalPayload.bytes.equals(payload.bytes)) fail("native_admission_payload_changed");
  const written = await writeNativeAdmissionExclusive(bytes, outputFile, payload.payload);
  return Object.freeze({ ...written, proposal: Object.freeze(proposal) });
}

export async function validateNativeAdmissionEvidence({ proposalFile, derivation, reviews, environment = process.env }) {
  requireLocalDataOnly(environment);
  if (proposalFile !== path.join(derivation.repositoryRoot, "infra/supply-chain/native-admission.json")) fail("native_admission_output_invalid");
  const payload = await deriveNativeAdmissionPayload({ ...derivation, environment });
  const proposal = await boundedJson(proposalFile, 8 * MiB);
  validateReviewedNativeAdmissionProposal(proposal.bytes, payload.payload);
  if (!Array.isArray(reviews) || reviews.length !== 2) fail("native_admission_review_invalid");
  const validated = reviews.map((entry, index) => validateReview(entry, payload, payload.payload.authors, NATIVE_ADMISSION_REVIEW_KINDS[index]));
  same(proposal.value.reviews, validated, "native_admission_review_invalid");
  const finalPayload = await deriveNativeAdmissionPayload({ ...derivation, environment });
  if (finalPayload.sha256 !== payload.sha256 || !finalPayload.bytes.equals(payload.bytes)) fail("native_admission_payload_changed");
  return Object.freeze({ proposal: proposal.value, sha256: proposal.sha256, size: proposal.size });
}
