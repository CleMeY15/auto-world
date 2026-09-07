import { chmod, copyFile, lstat, mkdir, realpath, writeFile } from "node:fs/promises";
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

// Reserve every bounded report/receipt before copying database or subject bytes.
// Repeated hash reads are not new artifacts; distinct on-disk copies count here.
// This accounts admitted files and fixed command outputs; it cannot impose an
// operating-system quota on arbitrary writes by the untrusted candidate.
export function assertNativeAuditBudget({ matrixBytes, binarySizes, databaseSizes, fixtureBytes = 4 * MiB }) {
  const validSize = (value) => Number.isSafeInteger(value) && value > 0;
  if (!validSize(matrixBytes) || !Array.isArray(binarySizes) || binarySizes.length !== 4 ||
      binarySizes.some((size) => !validSize(size) || size > 512 * MiB) || databaseSizes !== undefined && (!Array.isArray(databaseSizes) ||
      databaseSizes.length !== 4 || databaseSizes.some((size, index) => !validSize(size) || size > (index % 2 ? 8 : 2048) * MiB)) ||
      !validSize(fixtureBytes) || fixtureBytes > 4 * MiB) fail("native_audit_budget_invalid");
  const binaries = binarySizes.reduce((sum, value) => sum + value, 0);
  const artifactBaseBytes = binaries + 880 * MiB + fixtureBytes;
  // The public packager copies one verified source leaf at a time and releases
  // it after validation, so one maximum-size database is the transfer peak.
  const transferPeakBytes = 2 * 1024 * MiB;
  const jobBaseBytes = matrixBytes + artifactBaseBytes + binaries + fixtureBytes + transferPeakBytes;
  const databaseCapacityBytes = Math.min(6 * 1024 * MiB - artifactBaseBytes,
    Math.floor((8 * 1024 * MiB - jobBaseBytes) / 2));
  if (databaseCapacityBytes < 4) fail("native_audit_budget_exceeded");
  if (databaseSizes === undefined) return Object.freeze({ artifactBaseBytes, jobBaseBytes, transferPeakBytes, databaseCapacityBytes });
  const databases = databaseSizes.reduce((sum, value) => sum + value, 0);
  const artifactBytes = artifactBaseBytes + databases;
  const jobBytes = jobBaseBytes + 2 * databases;
  if (databases > databaseCapacityBytes || artifactBytes > 6 * 1024 * MiB || jobBytes > 8 * 1024 * MiB) fail("native_audit_budget_exceeded");
  return Object.freeze({ artifactBaseBytes, jobBaseBytes, transferPeakBytes, databaseCapacityBytes, databaseBytes: databases, artifactBytes, jobBytes });
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
  const audit = await createOwnedDirectory(context.runnerTemp);
  const progress = { phase: "staging" };
  const destination = path.join(context.runnerTemp, "native-audit");
  let status = "failed";
  let expectedFiles;
  try {
    const result = await collectNativeScans(context, audit, progress);
    expectedFiles = result.expectedFiles;
    status = "passed";
    return { ...result, directory: destination };
  } finally {
    try {
      await publishNativeAuditDiagnostics({ workspace: audit.path, destination, phase: progress.phase, status,
        ...(status === "passed" ? { expectedFiles } : {}) });
    } finally { await removeOwnedDirectory(audit); }
  }
}

async function collectNativeScans(context, audit, progress) {
  const started = Date.now();
  const expectedInventory = createExpectedFileInventory();
  const matrixDirectory = path.join(context.runnerTemp, "native-candidates");
  const matrix = await verifyCandidateArtifactMatrix(matrixDirectory, context.expectations, context.sources);
  const records = await loadVerifiedCandidateRecords(matrixDirectory, matrix, context.expectations);
  const { binarySizes, budget: preflightBudget } = nativeAuditPreflightBudget(matrix, records);
  const staged = await stageNativeAuditSubjects({ matrixDirectory, auditDirectory: audit.path, records });
  for (const entry of staged) expectedInventory.capture(`${entry.tool}-${entry.target}/${entry.filename}`, entry.output);
  await verifyStagedSubjects(staged);
  const cache = await createOwnedDirectory(context.runnerTemp);
  const home = await createOwnedDirectory(context.runnerTemp);
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

  progress.phase = "databases";
  await runCommand(scanner, ["fs", "--cache-dir", cache.path, "--db-repository", DB_REPOSITORIES.vulnerability, "--download-db-only", "--quiet"],
    { ...common, timeoutMs: remaining(started), maxOutputBytes: 64 * MiB });
  await verifyStagedSubjects(staged);
  await runCommand(scanner, ["fs", "--cache-dir", cache.path, "--java-db-repository", DB_REPOSITORIES.java, "--download-java-db-only", "--quiet"],
    { ...common, timeoutMs: remaining(started), maxOutputBytes: 64 * MiB });
  await verifyStagedSubjects(staged);
  const cacheDatabasePaths = {
    database: path.join(cache.path, "db/trivy.db"), databaseMetadata: path.join(cache.path, "db/metadata.json"),
    javaDatabase: path.join(cache.path, "java-db/trivy-java.db"), javaDatabaseMetadata: path.join(cache.path, "java-db/metadata.json"),
  };
  const databaseSizes = await Promise.all(Object.values(cacheDatabasePaths).map(async (file) => (await lstat(file)).size));
  const budget = assertNativeAuditBudget({ matrixBytes: matrix.consumedBytes,
    binarySizes,
    databaseSizes });
  if (budget.databaseCapacityBytes !== preflightBudget.databaseCapacityBytes) fail("native_audit_budget_changed");
  const databaseDirectory = path.join(audit.path, "databases");
  await mkdir(databaseDirectory);
  const databasePaths = {
    database: path.join(databaseDirectory, "vulnerability.db"), databaseMetadata: path.join(databaseDirectory, "vulnerability.metadata.json"),
    javaDatabase: path.join(databaseDirectory, "java.db"), javaDatabaseMetadata: path.join(databaseDirectory, "java.metadata.json"),
  };
  const vulnerabilityMetadataBytes = await readFileBounded(cacheDatabasePaths.databaseMetadata, 8 * MiB);
  const javaMetadataBytes = await readFileBounded(cacheDatabasePaths.javaDatabaseMetadata, 8 * MiB);
  const databaseHashes = {
    database: await hashFileBounded(cacheDatabasePaths.database, 2 * 1024 * MiB),
    databaseMetadata: { sha256: sha256(vulnerabilityMetadataBytes), size: vulnerabilityMetadataBytes.length },
    javaDatabase: await hashFileBounded(cacheDatabasePaths.javaDatabase, 2 * 1024 * MiB),
    javaDatabaseMetadata: { sha256: sha256(javaMetadataBytes), size: javaMetadataBytes.length },
  };
  expectedInventory.capture("databases/vulnerability.db", databaseHashes.database);
  expectedInventory.capture("databases/vulnerability.metadata.json", databaseHashes.databaseMetadata);
  expectedInventory.capture("databases/java.db", databaseHashes.javaDatabase);
  expectedInventory.capture("databases/java.metadata.json", databaseHashes.javaDatabaseMetadata);
  await copyFile(cacheDatabasePaths.database, databasePaths.database);
  await writeFile(databasePaths.databaseMetadata, vulnerabilityMetadataBytes, { flag: "wx" });
  await copyFile(cacheDatabasePaths.javaDatabase, databasePaths.javaDatabase);
  await writeFile(databasePaths.javaDatabaseMetadata, javaMetadataBytes, { flag: "wx" });
  requireDigest(await hashFileBounded(databasePaths.database, 2 * 1024 * MiB), databaseHashes.database);
  requireDigest(await hashFileBounded(databasePaths.javaDatabase, 2 * 1024 * MiB), databaseHashes.javaDatabase);
  const metadata = {
    vulnerability: parseBoundedJson(vulnerabilityMetadataBytes),
    java: parseBoundedJson(javaMetadataBytes),
  };
  const databases = [
    databaseRecord("vulnerability", databaseHashes.database, databaseHashes.databaseMetadata, metadata.vulnerability),
    databaseRecord("java", databaseHashes.javaDatabase, databaseHashes.javaDatabaseMetadata, metadata.java),
  ];

  const results = [];
  const audits = [];
  progress.phase = "subjects";
  for (const stagedSubject of staged) {
    const { tool, target, output, evidenceDirectory, binary, filename } = stagedSubject;
    const expectation = context.expectations.find((entry) => entry.tool === tool && entry.repeat === 1);
    const selected = context.selection.tools.find((entry) => entry.name === tool);
    const proposal = context.lock.proposals.find((entry) => entry.tool === tool);
    const work = await createOwnedDirectory(context.runnerTemp);
    const subjectDirectory = path.join(work.path, "subject");
    await mkdir(subjectDirectory);
    const scannedBinary = path.join(subjectDirectory, filename);
    await copyExpectedFile(binary, scannedBinary, output, 512 * MiB);
    const binaryHash = Object.freeze({ sha256: output.sha256, size: output.size });
    await verifyStagedSubjects(staged);
    const sbomFile = path.join(evidenceDirectory, "sbom.json");
    const reportFile = path.join(evidenceDirectory, "report.json");
    const sbomBytes = await capture(scanner, nativeScanArguments("cyclonedx", cache.path), { cwd: work.path, env: environment }, sbomFile, started);
    requireDigest(await hashFileBounded(scannedBinary, 512 * MiB), binaryHash, "native_audit_subject_changed");
    await verifyStagedSubjects(staged);
    const reportBytes = await capture(scanner, nativeScanArguments("json", cache.path), { cwd: work.path, env: environment }, reportFile, started);
    requireDigest(await hashFileBounded(scannedBinary, 512 * MiB), binaryHash, "native_audit_subject_changed");
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
    results.push({ tool, target, ...evaluation });
    audits.push({ tool, target, files, expected, evaluation });
  }
  progress.phase = "fixtures";
  const fixtureResult = await runScannerFixtures({ scanner, cacheDirectory: cache.path, workspace: audit.path,
    environment, deadline: started + 45 * 60 * 1000 });
  await verifyStagedSubjects(staged);
  requireDigest(await hashFileBounded(cacheDatabasePaths.database, 2 * 1024 * MiB), databaseHashes.database);
  requireDigest(await hashFileBounded(cacheDatabasePaths.databaseMetadata, 8 * MiB), databaseHashes.databaseMetadata);
  requireDigest(await hashFileBounded(cacheDatabasePaths.javaDatabase, 2 * 1024 * MiB), databaseHashes.javaDatabase);
  requireDigest(await hashFileBounded(cacheDatabasePaths.javaDatabaseMetadata, 8 * MiB), databaseHashes.javaDatabaseMetadata);
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
