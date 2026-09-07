import { chmod, copyFile, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCandidateContext, verifyCandidateArtifactMatrix } from "./candidate-artifacts.mjs";
import { deriveGoInventory } from "./go-inventory.mjs";
import { hashFileBounded, readFileBounded, verifyNativeAuditFiles } from "./native-audit.mjs";
import { createOwnedDirectory, policyError, runCommand } from "./process.mjs";
import { canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";

const MiB = 1024 * 1024;
const DB_REPOSITORIES = Object.freeze({
  vulnerability: "ghcr.io/aquasecurity/trivy-db:2",
  java: "ghcr.io/aquasecurity/trivy-java-db:1",
});
const fail = (code) => { throw policyError(code); };

export function parseNativeScanArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) fail("native_scan_arguments_refused");
  return Object.freeze({ mode: "scan" });
}

export function nativeScanArguments(format, cacheDirectory, target = "subject") {
  if (!new Set(["cyclonedx", "json"]).has(format) || !path.isAbsolute(cacheDirectory) || target !== "subject") fail("native_scan_arguments_refused");
  return ["fs", "--cache-dir", cacheDirectory, "--skip-db-update", "--skip-java-db-update", "--offline-scan", "--quiet",
    "--scanners", "vuln", "--format", format, ...(format === "json" ? ["--list-all-pkgs"] : []), target];
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
  const started = Date.now();
  const context = await loadCandidateContext();
  const matrixDirectory = path.join(context.runnerTemp, "native-candidates");
  await verifyCandidateArtifactMatrix(matrixDirectory, context.expectations, context.sources);
  const audit = await createOwnedDirectory(context.runnerTemp);
  const cache = await createOwnedDirectory(context.runnerTemp);
  const home = await createOwnedDirectory(context.runnerTemp);
  const scannerArtifact = path.join(matrixDirectory, "native-candidate-trivy-1");
  const scanner = path.join(scannerArtifact, "out/trivy");
  const scannerRecord = parseBoundedJson(await readFileBounded(path.join(scannerArtifact, "record.json"), 8 * MiB));
  const scannerOutput = scannerRecord.outputs.find((entry) => entry.target === "linux-amd64");
  if (!scannerOutput) fail("native_scanner_missing");
  await chmod(scanner, 0o700);
  requireDigest(await hashFileBounded(scanner, 512 * MiB), scannerOutput, "native_scanner_changed");
  const environment = { PATH: "/usr/bin:/bin", HOME: home.path, TMPDIR: home.path,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const common = { cwd: audit.path, env: environment };

  const scannerVersionFile = path.join(audit.path, "scanner-version.json");
  const scannerVersionBytes = await capture(scanner, ["version", "--format", "json"], common, scannerVersionFile, started);
  requireDigest(await hashFileBounded(scanner, 512 * MiB), scannerOutput, "native_scanner_changed");
  const scannerVersion = parseBoundedJson(scannerVersionBytes, { maxBytes: 8 * MiB });
  const selectedScanner = context.selection.tools.find((entry) => entry.name === "trivy");
  if (scannerVersion.Version !== selectedScanner.modifiedVersion) fail("native_scanner_version_mismatch");

  await runCommand(scanner, ["fs", "--cache-dir", cache.path, "--download-db-only", "--quiet"],
    { ...common, timeoutMs: remaining(started), maxOutputBytes: 64 * MiB });
  await runCommand(scanner, ["fs", "--cache-dir", cache.path, "--download-java-db-only", "--quiet"],
    { ...common, timeoutMs: remaining(started), maxOutputBytes: 64 * MiB });
  const cacheDatabasePaths = {
    database: path.join(cache.path, "db/trivy.db"), databaseMetadata: path.join(cache.path, "db/metadata.json"),
    javaDatabase: path.join(cache.path, "java-db/trivy-java.db"), javaDatabaseMetadata: path.join(cache.path, "java-db/metadata.json"),
  };
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

  const subjects = [
    ["oras", "linux-amd64"], ["cosign", "linux-amd64"], ["cosign", "windows-amd64"], ["trivy", "linux-amd64"],
  ];
  const results = [];
  for (const [tool, target] of subjects) {
    const expectation = context.expectations.find((entry) => entry.tool === tool && entry.repeat === 1);
    const selected = context.selection.tools.find((entry) => entry.name === tool);
    const proposal = context.lock.proposals.find((entry) => entry.tool === tool);
    const artifact = path.join(matrixDirectory, `native-candidate-${tool}-1`);
    const record = parseBoundedJson(await readFileBounded(path.join(artifact, "record.json"), 8 * MiB));
    const output = record.outputs.find((entry) => entry.target === target);
    if (!output) fail("native_audit_subject_missing");
    const work = await createOwnedDirectory(context.runnerTemp);
    const subjectDirectory = path.join(work.path, "subject");
    const evidenceDirectory = path.join(audit.path, `${tool}-${target}`);
    await mkdir(subjectDirectory);
    await mkdir(evidenceDirectory);
    const filename = path.basename(output.path);
    const binary = path.join(evidenceDirectory, filename);
    const scannedBinary = path.join(subjectDirectory, filename);
    await copyFile(path.join(artifact, output.path), binary);
    await copyFile(binary, scannedBinary);
    const binaryHash = await hashFileBounded(binary, 512 * MiB);
    if (binaryHash.sha256 !== output.sha256 || binaryHash.size !== output.size) fail("native_audit_subject_changed");
    requireDigest(await hashFileBounded(scannedBinary, 512 * MiB), binaryHash, "native_audit_subject_changed");
    const sbomFile = path.join(evidenceDirectory, "sbom.json");
    const reportFile = path.join(evidenceDirectory, "report.json");
    await capture(scanner, nativeScanArguments("cyclonedx", cache.path), { cwd: work.path, env: environment }, sbomFile, started);
    requireDigest(await hashFileBounded(scannedBinary, 512 * MiB), binaryHash, "native_audit_subject_changed");
    requireDigest(await hashFileBounded(scanner, 512 * MiB), scannerOutput, "native_scanner_changed");
    await capture(scanner, nativeScanArguments("json", cache.path), { cwd: work.path, env: environment }, reportFile, started);
    requireDigest(await hashFileBounded(scannedBinary, 512 * MiB), binaryHash, "native_audit_subject_changed");
    requireDigest(await hashFileBounded(scanner, 512 * MiB), scannerOutput, "native_scanner_changed");
    const inventory = deriveGoInventory({ tool, buildInfo: output.buildInfo, lockedModules: proposal.modules,
      goVersion: context.selection.compiler.version });
    const buildInfoFile = path.join(evidenceDirectory, "build-info.json");
    const moduleGraphFile = path.join(evidenceDirectory, "module-graph.json");
    const materialFile = path.join(evidenceDirectory, "material-lock.json");
    const recipeFile = path.join(evidenceDirectory, "recipe.json");
    await writeFile(buildInfoFile, canonicalJsonBuffer(output.buildInfo), { flag: "wx" });
    await writeFile(moduleGraphFile, canonicalJsonBuffer(proposal.modules), { flag: "wx" });
    await writeFile(materialFile, context.lockBytes, { flag: "wx" });
    const recipe = canonicalJsonBuffer(recipeEvidence(tool, selected, proposal, context.selection.compiler.version));
    if (sha256(recipe) !== proposal.recipeSha256) fail("native_audit_recipe_mismatch");
    await writeFile(recipeFile, recipe, { flag: "wx" });
    const evidenceHashes = {
      buildInfo: await hashFileBounded(buildInfoFile, 8 * MiB), moduleGraph: await hashFileBounded(moduleGraphFile, 8 * MiB),
      material: await hashFileBounded(materialFile, 8 * MiB), recipe: await hashFileBounded(recipeFile, 8 * MiB),
      sbom: await hashFileBounded(sbomFile, 64 * MiB), report: await hashFileBounded(reportFile, 64 * MiB),
      scannerVersion: await hashFileBounded(scannerVersionFile, 8 * MiB), scanner: await hashFileBounded(scanner, 512 * MiB),
    };
    const subject = { name: tool, version: selected.modifiedVersion, os: target.startsWith("windows") ? "windows" : "linux",
      architecture: "amd64", ...binaryHash, sourceCommit: selected.commit, materialSha256: evidenceHashes.material.sha256,
      recipeSha256: evidenceHashes.recipe.sha256, buildInfoSha256: evidenceHashes.buildInfo.sha256,
      moduleGraphSha256: evidenceHashes.moduleGraph.sha256 };
    const receipt = { schemaVersion: 1, kind: "native_binary", state: "audited_candidate", run: expectation.run, subject,
      scanner: { name: "trivy", version: selectedScanner.modifiedVersion, sha256: evidenceHashes.scanner.sha256 }, databases,
      evidence: { scannerVersionSha256: evidenceHashes.scannerVersion.sha256, sbomSha256: evidenceHashes.sbom.sha256, reportSha256: evidenceHashes.report.sha256 } };
    const receiptFile = path.join(evidenceDirectory, "receipt.json");
    await writeFile(receiptFile, canonicalJsonBuffer(receipt), { flag: "wx" });
    const files = { receipt: receiptFile, binary, scanner, scannerVersion: scannerVersionFile, buildInfo: buildInfoFile,
      moduleGraph: moduleGraphFile, material: materialFile, recipe: recipeFile, sbom: sbomFile, report: reportFile, ...databasePaths };
    const expected = { run: expectation.run, subject, scanner: receipt.scanner,
      databases: databases.map(({ name, repository, sha256, metadataSha256 }) => ({ name, repository, sha256, metadataSha256 })),
      artifactName: "subject", scanTarget: `subject/${filename}`, requiredPackages: inventory.packages };
    results.push({ tool, target, ...(await verifyNativeAuditFiles(files, expected)) });
  }
  requireDigest(await hashFileBounded(cacheDatabasePaths.database, 2 * 1024 * MiB), databaseHashes.database);
  requireDigest(await hashFileBounded(cacheDatabasePaths.databaseMetadata, 8 * MiB), databaseHashes.databaseMetadata);
  requireDigest(await hashFileBounded(cacheDatabasePaths.javaDatabase, 2 * 1024 * MiB), databaseHashes.javaDatabase);
  requireDigest(await hashFileBounded(cacheDatabasePaths.javaDatabaseMetadata, 8 * MiB), databaseHashes.javaDatabaseMetadata);
  await writeFile(path.join(audit.path, "native-audit-results.json"), canonicalJsonBuffer({ schemaVersion: 1, results }), { flag: "wx" });
  if (results.some((entry) => entry.state !== "audit_proposal")) fail("native_audit_blocked");
  return { directory: await realpath(audit.path), results };
}

async function main() {
  parseNativeScanArgs(process.argv.slice(2));
  const result = await runNativeScans();
  process.stdout.write(`${JSON.stringify({ phase: "native_scan", status: "pass", directory: result.directory })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("native_scan_failed\n"); process.exitCode = 1; });
}
