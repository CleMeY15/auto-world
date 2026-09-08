import { chmod, lstat, mkdir, opendir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_AUDIT_ARTIFACT_FILES, publishNativeAuditDiagnostics } from "./audit-artifacts.mjs";
import { copyExpectedFile, loadCandidateContext, loadVerifiedCandidateRecords, verifyCandidateArtifactMatrix } from "./candidate-artifacts.mjs";
import { deriveGoInventory } from "./go-inventory.mjs";
import { hashFileBounded, readFileBounded, verifyNativeAuditFiles } from "./native-audit.mjs";
import { createOwnedDirectory, policyError, removeOwnedDirectory, runCommand } from "./process.mjs";
import { runScannerFixtures } from "./scanner-fixtures.mjs";
import { canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";

const MiB = 1024 * 1024;
const DB_REPOSITORIES = Object.freeze({
  vulnerability: "ghcr.io/aquasecurity/trivy-db:2",
  java: "ghcr.io/aquasecurity/trivy-java-db:1",
});
const BASH = "/usr/bin/bash";
const DATABASE_CAPTURE_LIMIT = 64 * MiB;
const DATABASE_DIAGNOSTIC_LIMIT = 64 * 1024;
const DATABASE_EXIT_TOKEN = "AUTOWORLD_DATABASE_EXIT=";
const DATABASE_EXIT = /\nAUTOWORLD_DATABASE_EXIT=([0-9]{1,3})\n$/u;
const DATABASE_COMMANDS = Object.freeze({
  vulnerability: Object.freeze({
    commandClass: "trivy_vulnerability_database_download",
    args: (cacheDirectory) => ["fs", "--cache-dir", cacheDirectory, "--db-repository", DB_REPOSITORIES.vulnerability, "--download-db-only", "--quiet"],
  }),
  java: Object.freeze({
    commandClass: "trivy_java_database_download",
    args: (cacheDirectory) => ["fs", "--cache-dir", cacheDirectory, "--java-db-repository", DB_REPOSITORIES.java, "--download-java-db-only", "--quiet"],
  }),
});
const COMMAND_FAILURE_CODES = new Set(["command_refused", "command_start_failed", "command_timeout", "command_output_limit", "command_output_forbidden", "command_failed"]);
const DATABASE_ERROR_CLASSES = Object.freeze([
  ["authentication", /(?:unauthorized|authentication required|access denied|forbidden)/iu],
  ["rate_limit", /(?:too many requests|rate[ -]?limit)/iu],
  ["name_resolution", /(?:no such host|name resolution|temporary failure in name resolution)/iu],
  ["connection", /(?:connection refused|connection reset|network is unreachable|i\/o timeout|context deadline exceeded|tls handshake timeout)/iu],
  ["tls", /(?:x509:|certificate|tls:)/iu],
  ["registry_not_found", /(?:manifest unknown|blob unknown|not found)/iu],
  ["registry_response", /(?:unexpected status|unexpected response|invalid manifest)/iu],
  ["filesystem", /(?:permission denied|no space left on device|read-only file system)/iu],
]);
const DATABASE_STATUS_HINTS = Object.freeze([401, 403, 404, 408, 429, 500, 502, 503, 504]);
const DATABASE_SUBPHASE_ERRORS = Object.freeze({
  inventory: "native_database_inventory_refused",
  budget: "native_database_budget_refused",
  identity: "native_database_identity_refused",
  materialize: "native_database_materialize_refused",
  metadata: "native_database_metadata_refused",
});
const SUBJECTS = Object.freeze([
  ["oras", "linux-amd64"], ["cosign", "linux-amd64"], ["cosign", "windows-amd64"], ["trivy", "linux-amd64"],
]);
const fail = (code) => { throw policyError(code); };

export function parseNativeScanArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) fail("native_scan_arguments_refused");
  return Object.freeze({ mode: "scan" });
}

export function nativeScanArguments(format, cacheDirectory, target = "subject") {
  if (!new Set(["cyclonedx", "json"]).has(format) || !path.isAbsolute(cacheDirectory) || target !== "subject") fail("native_scan_arguments_refused");
  return ["fs", "--cache-dir", cacheDirectory, "--skip-db-update", "--skip-java-db-update", "--offline-scan", "--quiet",
    "--cache-backend", "memory", "--scanners", "vuln", "--format", format, ...(format === "json" ? ["--list-all-pkgs"] : []), target];
}

export function databaseDownloadArguments(scanner, cacheDirectory, kind) {
  if (typeof kind !== "string" || !Object.hasOwn(DATABASE_COMMANDS, kind)) fail("native_database_arguments_refused");
  const command = DATABASE_COMMANDS[kind];
  if (typeof scanner !== "string" || !path.isAbsolute(scanner) || scanner.includes("\0") ||
      typeof cacheDirectory !== "string" || !path.isAbsolute(cacheDirectory) || cacheDirectory.includes("\0")) fail("native_database_arguments_refused");
  return ["--noprofile", "--norc", "-c", '"$@"; code=$?; printf "\\nAUTOWORLD_DATABASE_EXIT=%s\\n" "$code"',
    "--", scanner, ...command.args(cacheDirectory)];
}

function databaseCommand(kind) {
  if (typeof kind !== "string" || !Object.hasOwn(DATABASE_COMMANDS, kind)) fail("native_database_diagnostic_invalid");
  return DATABASE_COMMANDS[kind];
}

function databaseStreamIdentity(bytes) {
  return Object.freeze({ sha256: sha256(bytes), size: bytes.length });
}

export function summarizeDatabaseDownloadCapture(stdout, stderr, kind, durationMs) {
  const command = databaseCommand(kind);
  if (!Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr) || stdout.length + stderr.length > DATABASE_CAPTURE_LIMIT ||
      !Number.isSafeInteger(durationMs) || durationMs < 0 || durationMs > 45 * 60 * 1000) fail("native_database_capture_invalid");
  const text = stdout.toString("utf8");
  const marker = DATABASE_EXIT.exec(text);
  const firstMarker = text.indexOf(DATABASE_EXIT_TOKEN);
  if (!marker || firstMarker < 0 || firstMarker !== text.lastIndexOf(DATABASE_EXIT_TOKEN) ||
      stderr.includes(Buffer.from(DATABASE_EXIT_TOKEN)) || Number(marker[1]) > 255) fail("native_database_capture_invalid");
  const body = stdout.subarray(0, stdout.length - Buffer.byteLength(marker[0]));
  const streams = [body.toString("utf8"), stderr.toString("utf8")];
  const originalExitCode = Number(marker[1]);
  const errorClasses = DATABASE_ERROR_CLASSES.filter(([, expression]) => streams.some((stream) => expression.test(stream))).map(([name]) => name).sort();
  if (originalExitCode !== 0 && errorClasses.length === 0) errorClasses.push("unclassified_failure");
  const statusHints = DATABASE_STATUS_HINTS.filter((status) => streams.some((stream) => new RegExp(`(?:^|[^0-9])${status}(?:[^0-9]|$)`, "u").test(stream))).map((status) => `http_${status}`);
  const diagnostic = Object.freeze({ schemaVersion: 1, state: "diagnostic_only", phase: "databases", subphase: "download",
    database: kind, commandClass: command.commandClass, captureStatus: "complete", originalExitCode, durationMs,
    stdout: databaseStreamIdentity(body), stderr: databaseStreamIdentity(stderr), errorClasses, statusHints });
  if (canonicalJsonBuffer(diagnostic).length > DATABASE_DIAGNOSTIC_LIMIT) fail("native_database_diagnostic_too_large");
  return diagnostic;
}

export function unavailableDatabaseDiagnostic(kind, commandFailureCode, durationMs) {
  const command = databaseCommand(kind);
  if (!COMMAND_FAILURE_CODES.has(commandFailureCode) && commandFailureCode !== "capture_invalid") fail("native_database_diagnostic_invalid");
  const diagnostic = { schemaVersion: 1, state: "diagnostic_only", phase: "databases", subphase: "download",
    database: kind, commandClass: command.commandClass, captureStatus: "unavailable", originalExitCode: null, commandFailureCode };
  if (Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs <= 45 * 60 * 1000) diagnostic.durationMs = durationMs;
  return Object.freeze(diagnostic);
}

function emitDatabaseDiagnostic(diagnostic) {
  const bytes = canonicalJsonBuffer(diagnostic);
  if (bytes.length > DATABASE_DIAGNOSTIC_LIMIT) fail("native_database_diagnostic_too_large");
  process.stdout.write(`${bytes.toString("utf8")}\n`);
}

export async function runDatabaseDownload(scanner, cacheDirectory, kind, options) {
  let result;
  try {
    result = await runCommand(BASH, databaseDownloadArguments(scanner, cacheDirectory, kind),
      { ...options, maxOutputBytes: DATABASE_CAPTURE_LIMIT });
  } catch (error) {
    const code = COMMAND_FAILURE_CODES.has(error?.code) ? error.code : "command_failed";
    emitDatabaseDiagnostic(unavailableDatabaseDiagnostic(kind, code, error?.durationMs));
    throw error;
  }
  let diagnostic;
  try {
    diagnostic = summarizeDatabaseDownloadCapture(result.stdout, result.stderr, kind, result.durationMs);
  } catch (error) {
    emitDatabaseDiagnostic(unavailableDatabaseDiagnostic(kind, "capture_invalid", result.durationMs));
    throw error;
  }
  if (diagnostic.originalExitCode !== 0) {
    emitDatabaseDiagnostic(diagnostic);
    throw Object.assign(policyError("command_failed"), { exitCode: diagnostic.originalExitCode, durationMs: diagnostic.durationMs });
  }
  return diagnostic;
}

async function databaseSubphase(subphase, operation) {
  if (typeof operation !== "function") fail("native_database_diagnostic_invalid");
  try {
    return await operation();
  } catch (error) {
    emitDatabaseDiagnostic(databaseSubphaseDiagnostic(subphase));
    throw error;
  }
}

export function databaseSubphaseDiagnostic(subphase) {
  if (typeof subphase !== "string" || !Object.hasOwn(DATABASE_SUBPHASE_ERRORS, subphase)) fail("native_database_diagnostic_invalid");
  const commandFailureCode = DATABASE_SUBPHASE_ERRORS[subphase];
  return Object.freeze({ schemaVersion: 1, state: "diagnostic_only", phase: "databases", subphase,
    database: "all", commandClass: "postdownload_validation", captureStatus: "unavailable", originalExitCode: null,
    commandFailureCode });
}

// Reserve every bounded report/receipt before copying database or subject bytes.
// Repeated hash reads are not new artifacts; distinct on-disk copies count here.
// This accounts admitted files and fixed command outputs; it cannot impose an
// operating-system quota on arbitrary writes by the untrusted candidate.
function nativeAuditBudgetValues({ matrixBytes, binarySizes, databaseSizes, fixtureBytes = 4 * MiB }) {
  const validSize = (value) => Number.isSafeInteger(value) && value > 0;
  if (!validSize(matrixBytes) || !Array.isArray(binarySizes) || binarySizes.length !== 4 ||
      binarySizes.some((size) => !validSize(size) || size > 512 * MiB) || databaseSizes !== undefined && (!Array.isArray(databaseSizes) ||
      databaseSizes.length !== 4 || databaseSizes.some((size) => !validSize(size))) ||
      !validSize(fixtureBytes) || fixtureBytes > 4 * MiB) fail("native_audit_budget_invalid");
  const binaries = binarySizes.reduce((sum, value) => sum + value, 0);
  const artifactBaseBytes = binaries + 880 * MiB + fixtureBytes;
  const maxBinaryBytes = Math.max(...binarySizes);
  const packageTransferBytes = 2 * 1024 * MiB;
  const scanBaseBytes = matrixBytes + artifactBaseBytes + maxBinaryBytes + fixtureBytes;
  const packageBaseBytes = matrixBytes + artifactBaseBytes + packageTransferBytes;
  const databaseCapacityBytes = Math.min(6 * 1024 * MiB - artifactBaseBytes,
    Math.floor((8 * 1024 * MiB - scanBaseBytes) / 2), 8 * 1024 * MiB - packageBaseBytes);
  if (databaseCapacityBytes < 4) fail("native_audit_budget_exceeded");
  const base = { artifactBaseBytes, scanBaseBytes, packageBaseBytes, packageTransferBytes, databaseCapacityBytes };
  if (databaseSizes === undefined) return Object.freeze(base);
  const databases = databaseSizes.reduce((sum, value) => sum + value, 0);
  const artifactBytes = artifactBaseBytes + databases;
  const scanBytes = scanBaseBytes + 2 * databases;
  const packageBytes = packageBaseBytes + databases;
  const values = { ...base, databaseBytes: databases, artifactBytes, scanBytes, packageBytes, jobBytes: Math.max(scanBytes, packageBytes) };
  if (Object.values(values).some((value) => !Number.isSafeInteger(value))) fail("native_audit_budget_invalid");
  return Object.freeze(values);
}

function classifyNativeAuditBudget(databaseSizes, totals) {
  if (!Array.isArray(databaseSizes) || databaseSizes.length !== 4 || databaseSizes.some((size) => !Number.isSafeInteger(size) || size < 1) ||
      !totals || typeof totals !== "object" || Array.isArray(totals) ||
      !["artifactBytes", "scanBytes", "packageBytes"].every((key) => Number.isSafeInteger(totals[key]) && totals[key] >= 0)) {
    fail("native_audit_budget_invalid");
  }
  if (databaseSizes.some((size, index) => size > (index % 2 ? 8 : 2048) * MiB)) return "per_file";
  if (totals.artifactBytes > 6 * 1024 * MiB) return "artifact_total";
  if (totals.scanBytes > 8 * 1024 * MiB) return "scan_total";
  if (totals.packageBytes > 8 * 1024 * MiB) return "package_total";
  return null;
}

export function assertNativeAuditBudget(input) {
  const values = nativeAuditBudgetValues(input);
  if (input.databaseSizes !== undefined && classifyNativeAuditBudget(input.databaseSizes, values) !== null) fail("native_audit_budget_exceeded");
  return values;
}

export function databaseBudgetDiagnostic(input) {
  let totals;
  try { totals = nativeAuditBudgetValues(input); } catch { fail("native_database_diagnostic_invalid"); }
  if (!Array.isArray(input.databaseSizes) || input.databaseSizes.length !== 4) fail("native_database_diagnostic_invalid");
  const reason = classifyNativeAuditBudget(input.databaseSizes, totals);
  if (reason === null) fail("native_database_diagnostic_invalid");
  const [vulnerability, vulnerabilityMetadata, java, javaMetadata] = input.databaseSizes;
  const diagnostic = Object.freeze({ schemaVersion: 1, state: "diagnostic_only", phase: "databases", subphase: "budget",
    database: "all", commandClass: "postdownload_validation", captureStatus: "unavailable", originalExitCode: null,
    commandFailureCode: "native_database_budget_refused",
    databaseSizes: Object.freeze({ vulnerability, vulnerabilityMetadata, java, javaMetadata }),
    totals: Object.freeze({ databaseBytes: totals.databaseBytes, artifactBytes: totals.artifactBytes,
      scanBytes: totals.scanBytes, packageBytes: totals.packageBytes, jobBytes: totals.jobBytes }), reason });
  if (canonicalJsonBuffer(diagnostic).length > DATABASE_DIAGNOSTIC_LIMIT) fail("native_database_diagnostic_too_large");
  return diagnostic;
}

export function nativeAuditSummaryBytes({ budget, results, fixtureManifest, fixtureMaterials, fixtureReports }) {
  if (!budget || typeof budget !== "object" || !Array.isArray(results) || results.length !== 4 ||
      !fixtureManifest || typeof fixtureManifest !== "object" || !Array.isArray(fixtureMaterials) || fixtureMaterials.length !== 8 ||
      !Array.isArray(fixtureReports) || fixtureReports.length !== 3) fail("native_audit_summary_invalid");
  const summarized = results.map(({ tool, target, state, packageCount, findings, blockers }) => {
    if (!Array.isArray(findings) || !Array.isArray(blockers)) fail("native_audit_summary_invalid");
    return { tool, target, state, packageCount, findingCount: findings.length, blockerCount: blockers.length,
      findingsSha256: sha256(canonicalJsonBuffer(findings)), blockersSha256: sha256(canonicalJsonBuffer(blockers)) };
  });
  const bytes = canonicalJsonBuffer({ schemaVersion: 1, budget, results: summarized,
    fixtures: { manifest: fixtureManifest, materials: fixtureMaterials, reports: fixtureReports } });
  if (bytes.length > 8 * MiB) fail("native_audit_summary_too_large");
  return bytes;
}

export function nativeAuditPreflightBudget(matrix, records) {
  if (!matrix || typeof matrix !== "object" || !Number.isSafeInteger(matrix.consumedBytes) || matrix.consumedBytes < 1 ||
      !Array.isArray(matrix.records) || matrix.records.length !== 6 || !Array.isArray(records) || records.length !== 6) fail("native_audit_staging_invalid");
  const binarySizes = SUBJECTS.map(([tool, target]) => {
    const record = records.find((entry) => entry.tool === tool && entry.repeat === 1);
    const output = record?.outputs?.find((entry) => entry.target === target);
    if (!output || !Number.isSafeInteger(output.size)) fail("native_audit_subject_missing");
    return output.size;
  });
  return Object.freeze({ binarySizes: Object.freeze(binarySizes),
    budget: assertNativeAuditBudget({ matrixBytes: matrix.consumedBytes, binarySizes }) });
}

function recipeEvidence(tool, selected, proposal, compilerVersion) {
  return {
    tool, commit: selected.commit, modifiedVersion: selected.modifiedVersion, targets: selected.targets,
    compiler: compilerVersion, tests: selected.upstreamTests, patchPolicy: selected.patchPolicy,
    requiredEvidence: selected.requiredEvidence, recipeFiles: proposal.recipeFiles,
  };
}

function databaseRecord(name, database, metadataFile, metadata) {
  return {
    name, repository: DB_REPOSITORIES[name], sha256: database.sha256, metadataSha256: metadataFile.sha256,
    updatedAt: metadata.UpdatedAt, downloadedAt: metadata.DownloadedAt,
  };
}

function requireDigest(actual, expected, code = "native_database_changed") {
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) fail(code);
}

async function verifyExactDirectory(directory, expected, code) {
  try {
    if (!path.isAbsolute(directory) || await realpath(directory) !== directory) fail(code);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) fail(code);
    const remaining = new Map(expected);
    for await (const entry of await opendir(directory)) {
      const kind = remaining.get(entry.name);
      if (!kind || !remaining.delete(entry.name)) fail(code);
      const child = path.join(directory, entry.name);
      const childInfo = await lstat(child);
      if (childInfo.isSymbolicLink() || await realpath(child) !== child ||
          kind === "directory" && !childInfo.isDirectory() ||
          kind === "file" && (!childInfo.isFile() || childInfo.nlink !== 1)) fail(code);
    }
    if (remaining.size) fail(code);
  } catch (error) {
    if (error?.code === code) throw error;
    fail(code);
  }
}

export async function verifyNativeEmptyDirectory(directory) {
  await verifyExactDirectory(directory, [], "native_audit_scratch_inventory_refused");
}

export async function verifyNativeSubjectWork(directory, filename, expectedIdentity) {
  if (typeof filename !== "string" || filename !== path.basename(filename) || !filename ||
      !expectedIdentity || !/^[a-f0-9]{64}$/u.test(expectedIdentity.sha256 ?? "") ||
      !Number.isSafeInteger(expectedIdentity.size) || expectedIdentity.size < 1 || expectedIdentity.size > 512 * MiB) {
    fail("native_audit_scratch_inventory_refused");
  }
  await verifyExactDirectory(directory, [["subject", "directory"]], "native_audit_scratch_inventory_refused");
  const subject = path.join(directory, "subject");
  await verifyExactDirectory(subject, [[filename, "file"]], "native_audit_scratch_inventory_refused");
  requireDigest(await hashFileBounded(path.join(subject, filename), 512 * MiB), expectedIdentity, "native_audit_subject_changed");
  await verifyExactDirectory(directory, [["subject", "directory"]], "native_audit_scratch_inventory_refused");
  await verifyExactDirectory(subject, [[filename, "file"]], "native_audit_scratch_inventory_refused");
}

const DATABASE_CACHE_FILES = Object.freeze({
  database: Object.freeze({ directory: "db", filename: "trivy.db", cap: 2048 * MiB }),
  databaseMetadata: Object.freeze({ directory: "db", filename: "metadata.json", cap: 8 * MiB }),
  javaDatabase: Object.freeze({ directory: "java-db", filename: "trivy-java.db", cap: 2048 * MiB }),
  javaDatabaseMetadata: Object.freeze({ directory: "java-db", filename: "metadata.json", cap: 8 * MiB }),
});

export async function verifyNativeDatabaseCache(directory, identities) {
  if (identities !== undefined && (!identities || typeof identities !== "object" || Array.isArray(identities) ||
      Object.keys(identities).length !== 4 || Object.keys(DATABASE_CACHE_FILES).some((key) => !Object.hasOwn(identities, key)))) {
    fail("native_database_identity_refused");
  }
  await verifyExactDirectory(directory, [["db", "directory"], ["java-db", "directory"]], "native_database_inventory_refused");
  for (const name of ["db", "java-db"]) {
    const files = Object.values(DATABASE_CACHE_FILES).filter((entry) => entry.directory === name);
    await verifyExactDirectory(path.join(directory, name), files.map((entry) => [entry.filename, "file"]), "native_database_inventory_refused");
  }
  if (identities !== undefined) {
    for (const [key, contract] of Object.entries(DATABASE_CACHE_FILES)) {
      try {
        requireDigest(await hashFileBounded(path.join(directory, contract.directory, contract.filename), contract.cap), identities[key], "native_database_identity_refused");
      } catch (error) {
        if (error?.code === "native_database_identity_refused") throw error;
        fail("native_database_identity_refused");
      }
    }
    await verifyNativeDatabaseCache(directory);
  }
}

const AUDIT_LIFECYCLES = new WeakMap();

function createAuditLifecycle() {
  const lifecycle = Object.freeze({});
  AUDIT_LIFECYCLES.set(lifecycle, { active: 0, releaseFailed: false });
  return lifecycle;
}

function auditLifecycleState(lifecycle) {
  const state = AUDIT_LIFECYCLES.get(lifecycle);
  if (!state) fail("native_audit_lifecycle_invalid");
  return state;
}

export async function runOwnedAuditWork(base, operation, lifecycle) {
  if (typeof operation !== "function") fail("native_audit_lifecycle_invalid");
  const state = lifecycle === undefined ? undefined : auditLifecycleState(lifecycle);
  const owned = await createOwnedDirectory(base);
  if (state) state.active += 1;
  try { return await operation(owned); }
  finally {
    try { await removeOwnedDirectory(owned); }
    catch {
      if (state) state.releaseFailed = true;
      fail("native_audit_cleanup_failed");
    } finally {
      if (state) state.active -= 1;
    }
  }
}

const TRACKED_FIXTURE_INPUT_KEYS = Object.freeze([
  "cacheDirectory", "deadline", "environment", "runnerTemp", "scanner", "workspace",
]);

export async function runTrackedScannerFixtures(input, lifecycle, executeFixture = runScannerFixtures) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(TRACKED_FIXTURE_INPUT_KEYS) ||
      typeof input.runnerTemp !== "string" || !path.isAbsolute(input.runnerTemp) ||
      typeof input.scanner !== "string" || !path.isAbsolute(input.scanner) ||
      typeof input.cacheDirectory !== "string" || !path.isAbsolute(input.cacheDirectory) ||
      typeof input.workspace !== "string" || !path.isAbsolute(input.workspace) ||
      !input.environment || typeof input.environment !== "object" || Array.isArray(input.environment) ||
      !Number.isSafeInteger(input.deadline) || typeof executeFixture !== "function") fail("native_audit_lifecycle_invalid");
  auditLifecycleState(lifecycle);
  const { runnerTemp, scanner, cacheDirectory, workspace, environment, deadline } = input;
  return runOwnedAuditWork(runnerTemp, ({ path: scratch }) => executeFixture(Object.freeze({
    scanner, cacheDirectory, workspace, scratch, environment, deadline,
  })), lifecycle);
}

function createExpectedFileInventory() {
  const contracts = new Map(NATIVE_AUDIT_ARTIFACT_FILES.map((entry) => [entry.path, entry.cap]));
  const captured = new Map();
  return Object.freeze({
    capture(relative, identity) {
      const cap = contracts.get(relative);
      if (cap === undefined || captured.has(relative) || !identity || !/^[a-f0-9]{64}$/u.test(identity.sha256) ||
          !Number.isSafeInteger(identity.size) || identity.size < 1 || identity.size > cap) fail("native_audit_expected_inventory_invalid");
      captured.set(relative, Object.freeze({ path: relative, sha256: identity.sha256, size: identity.size, cap }));
    },
    finish() {
      if (captured.size !== contracts.size) fail("native_audit_expected_inventory_incomplete");
      return Object.freeze(NATIVE_AUDIT_ARTIFACT_FILES.map(({ path: relative }) => {
        const entry = captured.get(relative);
        if (!entry) fail("native_audit_expected_inventory_incomplete");
        return entry;
      }));
    },
  });
}

const bytesIdentity = (bytes) => Object.freeze({ sha256: sha256(bytes), size: bytes.length });

async function verifyExpectedFiles(directory, expectedFiles) {
  for (const entry of expectedFiles) {
    requireDigest(await hashFileBounded(path.join(directory, entry.path), entry.cap), entry, "native_audit_evidence_changed");
  }
}

export async function stageNativeAuditSubjects({ matrixDirectory, auditDirectory, records }) {
  if (!path.isAbsolute(matrixDirectory) || !path.isAbsolute(auditDirectory) || !Array.isArray(records) || records.length !== 6) fail("native_audit_staging_invalid");
  const staged = [];
  for (const [tool, target] of SUBJECTS) {
    const matches = records.filter((entry) => entry.tool === tool && entry.repeat === 1);
    if (matches.length !== 1) fail("native_audit_staging_invalid");
    const record = matches[0];
    const outputs = record.outputs.filter((entry) => entry.target === target);
    if (outputs.length !== 1) fail("native_audit_subject_missing");
    const output = outputs[0];
    const evidenceDirectory = path.join(auditDirectory, `${tool}-${target}`);
    await mkdir(evidenceDirectory);
    const binary = path.join(evidenceDirectory, path.basename(output.path));
    await copyExpectedFile(path.join(matrixDirectory, `native-candidate-${tool}-1`, output.path), binary, output, 512 * MiB);
    staged.push(Object.freeze({ tool, target, output, evidenceDirectory, binary, filename: path.basename(output.path) }));
  }
  return Object.freeze(staged);
}

async function verifyStagedSubjects(staged) {
  for (const entry of staged) requireDigest(await hashFileBounded(entry.binary, 512 * MiB), entry.output, "native_audit_subject_changed");
}

function remaining(started) {
  const value = 45 * 60 * 1000 - (Date.now() - started);
  if (value < 1) fail("native_audit_timeout");
  return Math.min(10 * 60 * 1000, value);
}

async function capture(executable, args, options, destination, started) {
  const result = await runCommand(executable, args, { ...options, timeoutMs: remaining(started), maxOutputBytes: 64 * MiB });
  await writeFile(destination, result.stdout, { flag: "wx", mode: 0o600 });
  return result.stdout;
}

// Linux CI is the only execution surface. The runner starts from the already
// verified six-artifact matrix and retains raw scanner output before evaluation.
export async function runNativeScans() {
  const context = await loadCandidateContext();
  const destination = path.join(context.runnerTemp, "native-audit");
  return runNativeAuditOrchestration({ runnerTemp: context.runnerTemp, destination,
    collect: (audit, progress, lifecycle) => collectNativeScans(context, audit, progress, lifecycle) });
}

export async function runNativeAuditOrchestration({ runnerTemp, destination, collect, publish = publishNativeAuditDiagnostics }) {
  if (typeof runnerTemp !== "string" || !path.isAbsolute(runnerTemp) || typeof destination !== "string" || !path.isAbsolute(destination) ||
      typeof collect !== "function" || typeof publish !== "function") fail("native_audit_lifecycle_invalid");
  const audit = await createOwnedDirectory(runnerTemp);
  const lifecycle = createAuditLifecycle();
  const progress = { phase: "staging" };
  let status = "failed";
  let expectedFiles;
  let result;
  let failure;
  try {
    result = await collect(audit, progress, lifecycle);
    expectedFiles = result.expectedFiles;
    status = "passed";
  } catch (error) { failure = error; }
  const state = auditLifecycleState(lifecycle);
  const released = state.active === 0 && !state.releaseFailed;
  if (!released && !failure) failure = policyError("native_audit_cleanup_failed");
  try {
    if (released) await publish({ workspace: audit.path, destination, phase: progress.phase, status,
      ...(status === "passed" ? { expectedFiles } : {}) });
  } catch (error) { failure = error; }
  finally {
    try {
      await removeOwnedDirectory(audit);
    } catch (error) { failure = error; }
  }
  if (failure) throw failure;
  return { ...result, directory: destination };
}

async function collectNativeScans(context, audit, progress, lifecycle) {
  const started = Date.now();
  const expectedInventory = createExpectedFileInventory();
  const matrixDirectory = path.join(context.runnerTemp, "native-candidates");
  const matrix = await verifyCandidateArtifactMatrix(matrixDirectory, context.expectations, context.sources);
  const records = await loadVerifiedCandidateRecords(matrixDirectory, matrix, context.expectations);
  const { binarySizes, budget: preflightBudget } = nativeAuditPreflightBudget(matrix, records);
  const staged = await stageNativeAuditSubjects({ matrixDirectory, auditDirectory: audit.path, records });
  for (const entry of staged) expectedInventory.capture(`${entry.tool}-${entry.target}/${entry.filename}`, entry.output);
  await verifyStagedSubjects(staged);
  return runOwnedAuditWork(context.runnerTemp, (cache) => runOwnedAuditWork(context.runnerTemp, (home) =>
    collectNativeScansWithScratch({ context, audit, progress, started, expectedInventory, matrix, binarySizes,
      preflightBudget, staged, cache, home, lifecycle }), lifecycle), lifecycle);
}

async function collectNativeScansWithScratch({ context, audit, progress, started, expectedInventory, matrix, binarySizes,
  preflightBudget, staged, cache, home, lifecycle }) {
  const scannerSubject = staged.find((entry) => entry.tool === "trivy");
  if (!scannerSubject) fail("native_scanner_missing");
  const scanner = scannerSubject.binary;
  const scannerOutput = scannerSubject.output;
  await chmod(scanner, 0o700);
  requireDigest(await hashFileBounded(scanner, 512 * MiB), scannerOutput, "native_scanner_changed");
  const environment = { PATH: "/usr/bin:/bin", HOME: home.path, TMPDIR: home.path,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const common = { cwd: audit.path, env: environment };

  progress.phase = "scanner";
  const scannerVersionFile = path.join(audit.path, "scanner-version.json");
  const scannerVersionBytes = await capture(scanner, ["version", "--format", "json"], common, scannerVersionFile, started);
  const scannerVersionIdentity = bytesIdentity(scannerVersionBytes);
  expectedInventory.capture("scanner-version.json", scannerVersionIdentity);
  await verifyStagedSubjects(staged);
  const scannerVersion = parseBoundedJson(scannerVersionBytes, { maxBytes: 8 * MiB });
  const selectedScanner = context.selection.tools.find((entry) => entry.name === "trivy");
  if (scannerVersion.Version !== selectedScanner.modifiedVersion) fail("native_scanner_version_mismatch");
  await verifyNativeEmptyDirectory(home.path);

  progress.phase = "databases";
  await runDatabaseDownload(scanner, cache.path, "vulnerability", { ...common, timeoutMs: remaining(started) });
  await databaseSubphase("identity", () => verifyStagedSubjects(staged));
  await runDatabaseDownload(scanner, cache.path, "java", { ...common, timeoutMs: remaining(started) });
  await databaseSubphase("identity", () => verifyStagedSubjects(staged));
  const cacheDatabasePaths = {
    database: path.join(cache.path, "db/trivy.db"), databaseMetadata: path.join(cache.path, "db/metadata.json"),
    javaDatabase: path.join(cache.path, "java-db/trivy-java.db"), javaDatabaseMetadata: path.join(cache.path, "java-db/metadata.json"),
  };
  await databaseSubphase("inventory", () => verifyNativeDatabaseCache(cache.path));
  await verifyNativeEmptyDirectory(home.path);
  const databaseSizes = await databaseSubphase("inventory", () => Promise.all(Object.values(cacheDatabasePaths).map(async (file) => (await lstat(file)).size)));
  const budgetInput = { matrixBytes: matrix.consumedBytes, binarySizes, databaseSizes };
  let budget;
  try {
    budget = assertNativeAuditBudget(budgetInput);
    if (budget.databaseCapacityBytes !== preflightBudget.databaseCapacityBytes) fail("native_audit_budget_changed");
  } catch (error) {
    if (error?.code === "native_audit_budget_exceeded") emitDatabaseDiagnostic(databaseBudgetDiagnostic(budgetInput));
    else emitDatabaseDiagnostic(databaseSubphaseDiagnostic("budget"));
    throw error;
  }
  const databaseDirectory = path.join(audit.path, "databases");
  const databasePaths = {
    database: path.join(databaseDirectory, "vulnerability.db"), databaseMetadata: path.join(databaseDirectory, "vulnerability.metadata.json"),
    javaDatabase: path.join(databaseDirectory, "java.db"), javaDatabaseMetadata: path.join(databaseDirectory, "java.metadata.json"),
  };
  const { vulnerabilityMetadataBytes, javaMetadataBytes, databaseHashes } = await databaseSubphase("identity", async () => {
    const vulnerabilityBytes = await readFileBounded(cacheDatabasePaths.databaseMetadata, 8 * MiB);
    const javaBytes = await readFileBounded(cacheDatabasePaths.javaDatabaseMetadata, 8 * MiB);
    const hashes = {
      database: await hashFileBounded(cacheDatabasePaths.database, 2 * 1024 * MiB),
      databaseMetadata: { sha256: sha256(vulnerabilityBytes), size: vulnerabilityBytes.length },
      javaDatabase: await hashFileBounded(cacheDatabasePaths.javaDatabase, 2 * 1024 * MiB),
      javaDatabaseMetadata: { sha256: sha256(javaBytes), size: javaBytes.length },
    };
    const identitySizes = [hashes.database.size, hashes.databaseMetadata.size, hashes.javaDatabase.size, hashes.javaDatabaseMetadata.size];
    if (identitySizes.some((size, index) => size !== databaseSizes[index])) fail("native_database_identity_refused");
    expectedInventory.capture("databases/vulnerability.db", hashes.database);
    expectedInventory.capture("databases/vulnerability.metadata.json", hashes.databaseMetadata);
    expectedInventory.capture("databases/java.db", hashes.javaDatabase);
    expectedInventory.capture("databases/java.metadata.json", hashes.javaDatabaseMetadata);
    return { vulnerabilityMetadataBytes: vulnerabilityBytes, javaMetadataBytes: javaBytes, databaseHashes: hashes };
  });
  await databaseSubphase("identity", () => verifyNativeDatabaseCache(cache.path, databaseHashes));
  await databaseSubphase("materialize", async () => {
    await mkdir(databaseDirectory);
    await copyExpectedFile(cacheDatabasePaths.database, databasePaths.database, databaseHashes.database, 2 * 1024 * MiB);
    await writeFile(databasePaths.databaseMetadata, vulnerabilityMetadataBytes, { flag: "wx" });
    await copyExpectedFile(cacheDatabasePaths.javaDatabase, databasePaths.javaDatabase, databaseHashes.javaDatabase, 2 * 1024 * MiB);
    await writeFile(databasePaths.javaDatabaseMetadata, javaMetadataBytes, { flag: "wx" });
    requireDigest(await hashFileBounded(databasePaths.database, 2 * 1024 * MiB), databaseHashes.database);
    requireDigest(await hashFileBounded(databasePaths.javaDatabase, 2 * 1024 * MiB), databaseHashes.javaDatabase);
  });
  const databases = await databaseSubphase("metadata", async () => {
    const metadata = { vulnerability: parseBoundedJson(vulnerabilityMetadataBytes), java: parseBoundedJson(javaMetadataBytes) };
    return [databaseRecord("vulnerability", databaseHashes.database, databaseHashes.databaseMetadata, metadata.vulnerability),
      databaseRecord("java", databaseHashes.javaDatabase, databaseHashes.javaDatabaseMetadata, metadata.java)];
  });

  const results = [];
  const audits = [];
  progress.phase = "subjects";
  for (const stagedSubject of staged) {
    const { tool, target, output, evidenceDirectory, binary, filename } = stagedSubject;
    const expectation = context.expectations.find((entry) => entry.tool === tool && entry.repeat === 1);
    const selected = context.selection.tools.find((entry) => entry.name === tool);
    const proposal = context.lock.proposals.find((entry) => entry.tool === tool);
    const item = await runOwnedAuditWork(context.runnerTemp, async (work) => {
      const subjectDirectory = path.join(work.path, "subject");
      await mkdir(subjectDirectory);
      const scannedBinary = path.join(subjectDirectory, filename);
      await copyExpectedFile(binary, scannedBinary, output, 512 * MiB);
      const binaryHash = Object.freeze({ sha256: output.sha256, size: output.size });
      await verifyNativeSubjectWork(work.path, filename, binaryHash);
      await verifyStagedSubjects(staged);
      const sbomFile = path.join(evidenceDirectory, "sbom.json");
      const reportFile = path.join(evidenceDirectory, "report.json");
      const sbomBytes = await capture(scanner, nativeScanArguments("cyclonedx", cache.path), { cwd: work.path, env: environment }, sbomFile, started);
      await verifyNativeSubjectWork(work.path, filename, binaryHash);
      await verifyNativeDatabaseCache(cache.path, databaseHashes);
      await verifyNativeEmptyDirectory(home.path);
      await verifyStagedSubjects(staged);
      const reportBytes = await capture(scanner, nativeScanArguments("json", cache.path), { cwd: work.path, env: environment }, reportFile, started);
      await verifyNativeSubjectWork(work.path, filename, binaryHash);
      await verifyNativeDatabaseCache(cache.path, databaseHashes);
      await verifyNativeEmptyDirectory(home.path);
      await verifyStagedSubjects(staged);
      const inventory = deriveGoInventory({ tool, buildInfo: output.buildInfo, lockedModules: proposal.modules,
        goVersion: context.selection.compiler.version });
      const buildInfoFile = path.join(evidenceDirectory, "build-info.json");
      const moduleGraphFile = path.join(evidenceDirectory, "module-graph.json");
      const materialFile = path.join(evidenceDirectory, "material-lock.json");
      const recipeFile = path.join(evidenceDirectory, "recipe.json");
      const buildInfoBytes = canonicalJsonBuffer(output.buildInfo);
      const moduleGraphBytes = canonicalJsonBuffer(proposal.modules);
      await writeFile(buildInfoFile, buildInfoBytes, { flag: "wx" });
      await writeFile(moduleGraphFile, moduleGraphBytes, { flag: "wx" });
      await writeFile(materialFile, context.lockBytes, { flag: "wx" });
      const recipe = canonicalJsonBuffer(recipeEvidence(tool, selected, proposal, context.selection.compiler.version));
      if (sha256(recipe) !== proposal.recipeSha256) fail("native_audit_recipe_mismatch");
      await writeFile(recipeFile, recipe, { flag: "wx" });
      const evidenceHashes = {
        buildInfo: bytesIdentity(buildInfoBytes), moduleGraph: bytesIdentity(moduleGraphBytes),
        material: bytesIdentity(context.lockBytes), recipe: bytesIdentity(recipe),
        sbom: bytesIdentity(sbomBytes), report: bytesIdentity(reportBytes),
        scannerVersion: scannerVersionIdentity, scanner: scannerOutput,
      };
      const subject = { name: tool, version: selected.modifiedVersion, os: target.startsWith("windows") ? "windows" : "linux",
        architecture: "amd64", ...binaryHash, sourceCommit: selected.commit, materialSha256: evidenceHashes.material.sha256,
        recipeSha256: evidenceHashes.recipe.sha256, buildInfoSha256: evidenceHashes.buildInfo.sha256,
        moduleGraphSha256: evidenceHashes.moduleGraph.sha256 };
      const receipt = { schemaVersion: 1, kind: "native_binary", state: "audited_candidate", run: expectation.run, subject,
        scanner: { name: "trivy", version: selectedScanner.modifiedVersion, sha256: evidenceHashes.scanner.sha256 }, databases,
        evidence: { scannerVersionSha256: evidenceHashes.scannerVersion.sha256, sbomSha256: evidenceHashes.sbom.sha256, reportSha256: evidenceHashes.report.sha256 } };
      const receiptFile = path.join(evidenceDirectory, "receipt.json");
      const receiptBytes = canonicalJsonBuffer(receipt);
      await writeFile(receiptFile, receiptBytes, { flag: "wx" });
      const prefix = `${tool}-${target}`;
      expectedInventory.capture(`${prefix}/build-info.json`, evidenceHashes.buildInfo);
      expectedInventory.capture(`${prefix}/module-graph.json`, evidenceHashes.moduleGraph);
      expectedInventory.capture(`${prefix}/material-lock.json`, evidenceHashes.material);
      expectedInventory.capture(`${prefix}/recipe.json`, evidenceHashes.recipe);
      expectedInventory.capture(`${prefix}/receipt.json`, bytesIdentity(receiptBytes));
      expectedInventory.capture(`${prefix}/sbom.json`, evidenceHashes.sbom);
      expectedInventory.capture(`${prefix}/report.json`, evidenceHashes.report);
      const files = { receipt: receiptFile, binary, scanner, scannerVersion: scannerVersionFile, buildInfo: buildInfoFile,
        moduleGraph: moduleGraphFile, material: materialFile, recipe: recipeFile, sbom: sbomFile, report: reportFile, ...databasePaths };
      const expected = { run: expectation.run, subject, scanner: receipt.scanner,
        databases: databases.map(({ name, repository, sha256, metadataSha256 }) => ({ name, repository, sha256, metadataSha256 })),
        artifactName: "subject", scanTarget: filename, requiredPackages: inventory.packages };
      const evaluation = await verifyNativeAuditFiles(files, expected);
      await verifyNativeSubjectWork(work.path, filename, binaryHash);
      return { result: { tool, target, ...evaluation }, audit: { tool, target, files, expected, evaluation } };
    }, lifecycle);
    results.push(item.result);
    audits.push(item.audit);
  }
  progress.phase = "fixtures";
  const fixtureResult = await runTrackedScannerFixtures({ runnerTemp: context.runnerTemp, scanner,
    cacheDirectory: cache.path, workspace: audit.path, environment, deadline: started + 45 * 60 * 1000 }, lifecycle);
  await verifyStagedSubjects(staged);
  await verifyNativeDatabaseCache(cache.path, databaseHashes);
  await verifyNativeEmptyDirectory(home.path);
  for (const item of audits) {
    if (canonicalJsonBuffer(await verifyNativeAuditFiles(item.files, item.expected)).compare(canonicalJsonBuffer(item.evaluation)) !== 0) fail("native_audit_evidence_changed");
  }
  const fixtureReports = fixtureResult.reports.map(({ fixtureId, path: reportPath, sha256: reportSha256, size }) => ({
    fixtureId, path: path.relative(audit.path, reportPath).replaceAll("\\", "/"), sha256: reportSha256, size,
  }));
  if (fixtureReports.some((entry) => !entry.path.startsWith("fixtures/reports/"))) fail("native_audit_fixture_path_invalid");
  for (const entry of fixtureResult.materials) expectedInventory.capture(`fixtures/${entry.path}`, entry);
  for (const entry of fixtureReports) expectedInventory.capture(entry.path, entry);
  const finalBudget = assertNativeAuditBudget({ matrixBytes: matrix.consumedBytes,
    binarySizes, databaseSizes });
  if (canonicalJsonBuffer(finalBudget).compare(canonicalJsonBuffer(budget)) !== 0) fail("native_audit_budget_changed");
  progress.phase = "complete";
  const summaryBytes = nativeAuditSummaryBytes({
    budget, results, fixtureManifest: fixtureResult.manifestIdentity,
    fixtureMaterials: fixtureResult.materials, fixtureReports,
  });
  await writeFile(path.join(audit.path, "native-audit-results.json"), summaryBytes, { flag: "wx" });
  expectedInventory.capture("native-audit-results.json", bytesIdentity(summaryBytes));
  if (results.some((entry) => entry.state !== "audit_proposal")) fail("native_audit_blocked");
  const expectedFiles = expectedInventory.finish();
  await verifyExpectedFiles(audit.path, expectedFiles);
  await verifyNativeDatabaseCache(cache.path, databaseHashes);
  await verifyNativeEmptyDirectory(home.path);
  return { directory: await realpath(audit.path), results, expectedFiles };
}

async function main() {
  parseNativeScanArgs(process.argv.slice(2));
  const result = await runNativeScans();
  process.stdout.write(`${JSON.stringify({ phase: "native_scan", status: "pass", directory: result.directory })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("native_scan_failed\n"); process.exitCode = 1; });
}
