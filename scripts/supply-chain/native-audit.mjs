import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { assertClosedObject, parseBoundedJson } from "./strict-json.mjs";
import { policyError } from "./process.mjs";

const MiB = 1024 * 1024;
const digestPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const severities = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const nativeVersions = { oras: "1.3.4-autoworld.1", cosign: "3.1.3-autoworld.1", trivy: "0.74.0-autoworld.1" };

function requireTrue(condition, code = "native_audit_invalid") {
  if (!condition) throw policyError(code);
}

function same(actual, expected) {
  requireTrue(expected !== undefined && actual === expected, "native_identity_mismatch");
}

async function inspectFile(file, maxBytes, collect = false) {
  requireTrue(typeof file === "string" && path.isAbsolute(file) && Number.isSafeInteger(maxBytes) && maxBytes > 0, "evidence_path_invalid");
  const stat = await lstat(file);
  requireTrue(stat.isFile() && !stat.isSymbolicLink() && await realpath(file) === path.resolve(file), "evidence_path_invalid");
  requireTrue(stat.size > 0 && stat.size <= maxBytes, "evidence_size_invalid");
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  let size = 0;
  const chunks = [];
  try {
    const opened = await handle.stat();
    requireTrue(opened.ino === stat.ino && opened.dev === stat.dev && opened.size === stat.size, "evidence_changed");
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      requireTrue(size <= maxBytes && size <= stat.size, "evidence_changed");
      hash.update(buffer.subarray(0, bytesRead));
      if (collect) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const end = await handle.stat();
    requireTrue(size === stat.size && end.size === stat.size && end.mtimeMs === stat.mtimeMs, "evidence_changed");
  } finally { await handle.close(); }
  return Object.freeze({ sha256: hash.digest("hex"), size, ...(collect ? { bytes: Buffer.concat(chunks) } : {}) });
}

export async function hashFileBounded(file, maxBytes) {
  return inspectFile(file, maxBytes);
}

export async function readFileBounded(file, maxBytes) {
  return (await inspectFile(file, maxBytes, true)).bytes;
}

function validateDatabase(database, name, now, metadata, expected) {
  assertClosedObject(database, ["name", "sha256", "metadataSha256", "updatedAt", "downloadedAt"]);
  same(database.name, name);
  requireTrue(digestPattern.test(database.sha256) && digestPattern.test(database.metadataSha256));
  for (const key of ["name", "sha256", "metadataSha256"]) same(database[key], expected[key]);
  assertClosedObject(metadata, ["Version", "UpdatedAt", "NextUpdate", "DownloadedAt"]);
  same(metadata.Version, name === "vulnerability" ? 2 : 1);
  requireTrue([metadata.UpdatedAt, metadata.NextUpdate, metadata.DownloadedAt].every((value) => typeof value === "string" && Number.isFinite(Date.parse(value))));
  same(Date.parse(database.updatedAt), Date.parse(metadata.UpdatedAt));
  same(Date.parse(database.downloadedAt), Date.parse(metadata.DownloadedAt));
  requireTrue([database.updatedAt, database.downloadedAt].every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(value)));
  const updated = Date.parse(database.updatedAt);
  const downloaded = Date.parse(database.downloadedAt);
  requireTrue(Number.isFinite(updated) && Number.isFinite(downloaded) && updated <= now &&
    downloaded <= now && updated <= downloaded && now - updated <= 48 * 3600000, "native_database_stale");
}

function normalizedFindings(report, scanTarget) {
  const findings = [];
  const packages = new Set();
  requireTrue(Array.isArray(report.Results) && report.Results.length === 1, "native_inventory_invalid");
  const result = report.Results[0];
  requireTrue(result.Class === "lang-pkgs" && result.Type === "gobinary" && result.Target === scanTarget, "native_inventory_invalid");
  requireTrue(Array.isArray(result.Packages) && result.Packages.length > 0, "native_inventory_invalid");
  for (const entry of result.Packages) {
    requireTrue(typeof entry.Name === "string" && entry.Name.length > 0 && typeof entry.Version === "string" && entry.Version.length > 0, "native_inventory_invalid");
    const key = `${entry.Name}@${entry.Version}`;
    requireTrue(!packages.has(key), "native_inventory_invalid");
    packages.add(key);
  }
  requireTrue(result.Vulnerabilities === undefined || Array.isArray(result.Vulnerabilities));
  const identities = new Set();
  for (const entry of result.Vulnerabilities ?? []) {
    requireTrue(severities.has(entry.Severity), "native_severity_invalid");
    for (const key of ["VulnerabilityID", "PkgName", "InstalledVersion"]) {
      requireTrue(typeof entry[key] === "string" && entry[key].length > 0 && entry[key].length <= 2048);
    }
    requireTrue(entry.FixedVersion === undefined || typeof entry.FixedVersion === "string");
    requireTrue(packages.has(`${entry.PkgName}@${entry.InstalledVersion}`), "native_finding_inventory_mismatch");
    const finding = {
      target: result.Target, vulnerabilityId: entry.VulnerabilityID,
      packageName: entry.PkgName, installedVersion: entry.InstalledVersion,
      severity: entry.Severity, fixedVersion: entry.FixedVersion ?? "",
    };
    const identity = JSON.stringify(finding);
    requireTrue(!identities.has(identity), "native_finding_duplicate");
    identities.add(identity);
    findings.push(finding);
  }
  return { packages, findings };
}

// Expected values come from the reviewed build/material/run identity. Receipt
// self-assertions or an authentic signature over another subject cannot supply them.
export function evaluateNativeAudit(receipt, report, sbom, expected, now = Date.now(), databaseMetadata) {
  assertClosedObject(receipt, ["schemaVersion", "kind", "state", "run", "subject", "scanner", "databases", "evidence"]);
  requireTrue(receipt.schemaVersion === 1 && receipt.kind === "native_binary" && receipt.state === "audited_candidate");
  requireTrue(Number.isFinite(now));
  assertClosedObject(receipt.run, ["id", "attempt", "workflowSha", "sourceSha"]);
  for (const key of ["id", "attempt", "workflowSha", "sourceSha"]) same(receipt.run[key], expected.run[key]);
  requireTrue(/^[1-9][0-9]*$/u.test(receipt.run.id) && Number.isSafeInteger(receipt.run.attempt) && receipt.run.attempt > 0 &&
    commitPattern.test(receipt.run.workflowSha) && commitPattern.test(receipt.run.sourceSha));
  assertClosedObject(receipt.subject, ["name", "version", "os", "architecture", "sha256", "size", "sourceCommit", "materialSha256", "recipeSha256", "buildInfoSha256", "moduleGraphSha256"]);
  for (const key of Object.keys(receipt.subject)) same(receipt.subject[key], expected.subject[key]);
  requireTrue(nativeVersions[receipt.subject.name] === receipt.subject.version &&
    ["linux", "windows"].includes(receipt.subject.os) && receipt.subject.architecture === "amd64" &&
    (receipt.subject.os !== "windows" || receipt.subject.name === "cosign") &&
    commitPattern.test(receipt.subject.sourceCommit) && Number.isSafeInteger(receipt.subject.size) && receipt.subject.size > 0 && receipt.subject.size <= 512 * MiB);
  for (const key of ["sha256", "materialSha256", "recipeSha256", "buildInfoSha256", "moduleGraphSha256"]) requireTrue(digestPattern.test(receipt.subject[key]));
  assertClosedObject(receipt.scanner, ["name", "version", "sha256"]);
  requireTrue(receipt.scanner.name === "trivy" && receipt.scanner.version === nativeVersions.trivy && digestPattern.test(receipt.scanner.sha256));
  for (const key of ["name", "version", "sha256"]) same(receipt.scanner[key], expected.scanner[key]);
  requireTrue(Array.isArray(receipt.databases) && receipt.databases.length === 2);
  requireTrue(Array.isArray(databaseMetadata) && databaseMetadata.length === 2 && Array.isArray(expected.databases) && expected.databases.length === 2);
  validateDatabase(receipt.databases[0], "vulnerability", now, databaseMetadata[0], expected.databases[0]);
  validateDatabase(receipt.databases[1], "java", now, databaseMetadata[1], expected.databases[1]);
  assertClosedObject(receipt.evidence, ["sbomSha256", "reportSha256"]);
  for (const value of Object.values(receipt.evidence)) requireTrue(digestPattern.test(value));
  const created = Date.parse(report.CreatedAt);
  requireTrue(report.SchemaVersion === 2 && report.ArtifactType === "filesystem" && report.ArtifactName === expected.artifactName &&
    report.Trivy?.Version === receipt.scanner.version && typeof report.CreatedAt === "string" && Number.isFinite(created) &&
    created <= now && now - created <= 48 * 3600000 &&
    receipt.databases.every((database) => created >= Date.parse(database.downloadedAt)), "native_report_invalid");
  const { packages, findings } = normalizedFindings(report, expected.scanTarget);
  requireTrue(Array.isArray(expected.requiredPackages) && expected.requiredPackages.length > 0 &&
    new Set(expected.requiredPackages).size === expected.requiredPackages.length &&
    expected.requiredPackages.length === packages.size && expected.requiredPackages.every((entry) => packages.has(entry)), "native_inventory_incomplete");
  requireTrue(sbom.bomFormat === "CycloneDX" && Array.isArray(sbom.components) && sbom.components.length > 0, "native_sbom_invalid");
  const sbomPackages = new Set(sbom.components.map((entry) => `${entry.name}@${entry.version}`));
  requireTrue(sbomPackages.size === sbom.components.length && sbomPackages.size === packages.size &&
    [...packages].every((entry) => sbomPackages.has(entry)), "native_sbom_inventory_mismatch");
  // No disposition has been granted. Supporting one requires an exact independently
  // reviewed policy change; an embedded approval string is not authority.
  const blockers = findings.filter((entry) => entry.severity === "CRITICAL" || entry.severity === "HIGH");
  return Object.freeze({ state: blockers.length ? "rejected" : "audit_proposal", findings, blockers, packageCount: packages.size });
}

export async function verifyNativeAuditFiles(files, expected, now = Date.now()) {
  assertClosedObject(files, ["receipt", "binary", "scanner", "buildInfo", "moduleGraph", "material", "recipe", "sbom", "report", "database", "javaDatabase", "databaseMetadata", "javaDatabaseMetadata"]);
  const caps = { receipt: 8 * MiB, binary: 512 * MiB, scanner: 512 * MiB, buildInfo: 8 * MiB, moduleGraph: 8 * MiB, material: 8 * MiB, recipe: 8 * MiB, sbom: 64 * MiB, report: 64 * MiB, database: 2 * 1024 * MiB, javaDatabase: 2 * 1024 * MiB, databaseMetadata: 8 * MiB, javaDatabaseMetadata: 8 * MiB };
  const hashes = Object.create(null);
  for (const [key, file] of Object.entries(files)) hashes[key] = await inspectFile(file, caps[key], ["receipt", "report", "sbom", "databaseMetadata", "javaDatabaseMetadata"].includes(key));
  const receipt = parseBoundedJson(hashes.receipt.bytes, { maxBytes: caps.receipt });
  const report = parseBoundedJson(hashes.report.bytes, { maxBytes: caps.report });
  const sbom = parseBoundedJson(hashes.sbom.bytes, { maxBytes: caps.sbom });
  same(hashes.binary.sha256, receipt.subject.sha256);
  same(hashes.binary.size, receipt.subject.size);
  same(hashes.scanner.sha256, receipt.scanner.sha256);
  same(hashes.buildInfo.sha256, receipt.subject.buildInfoSha256);
  same(hashes.moduleGraph.sha256, receipt.subject.moduleGraphSha256);
  same(hashes.material.sha256, receipt.subject.materialSha256);
  same(hashes.recipe.sha256, receipt.subject.recipeSha256);
  same(hashes.sbom.sha256, receipt.evidence.sbomSha256);
  same(hashes.report.sha256, receipt.evidence.reportSha256);
  same(hashes.database.sha256, receipt.databases[0].sha256);
  same(hashes.javaDatabase.sha256, receipt.databases[1].sha256);
  same(hashes.databaseMetadata.sha256, receipt.databases[0].metadataSha256);
  same(hashes.javaDatabaseMetadata.sha256, receipt.databases[1].metadataSha256);
  const metadata = ["databaseMetadata", "javaDatabaseMetadata"].map((key) => parseBoundedJson(hashes[key].bytes, { maxBytes: caps[key] }));
  return evaluateNativeAudit(receipt, report, sbom, expected, now, metadata);
}
