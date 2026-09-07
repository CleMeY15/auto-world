import assert from "node:assert/strict";
import { link, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { evaluateNativeAudit, hashFileBounded, readFileBounded, verifyNativeAuditFiles } from "../scripts/supply-chain/native-audit.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";

// Synthetic contract tests only. These records are never native runtime proof.
const hash = "1".repeat(64);
const commit = "a".repeat(40);
const now = Date.parse("2026-09-07T12:00:00Z");
function fixture() {
  const run = { id: "123", attempt: 1, workflowSha: commit, sourceSha: commit,
    workflowRef: "CleMeY15/auto-world/.github/workflows/native-bootstrap.yml@refs/heads/main",
    event: "push", workflowFileSha256: hash };
  const subject = { name: "oras", version: "1.3.4-autoworld.1", os: "linux", architecture: "amd64", sha256: hash, size: 10, sourceCommit: commit, materialSha256: hash, recipeSha256: hash, buildInfoSha256: hash, moduleGraphSha256: hash };
  const scanner = { name: "trivy", version: "0.74.0-autoworld.1", sha256: hash };
  const repositories = { vulnerability: "ghcr.io/aquasecurity/trivy-db:2", java: "ghcr.io/aquasecurity/trivy-java-db:1" };
  const receipt = { schemaVersion: 1, kind: "native_binary", state: "audited_candidate", run, subject, scanner, databases: ["vulnerability", "java"].map((name) => ({ name, repository: repositories[name], sha256: hash, metadataSha256: hash, updatedAt: "2026-09-06T12:00:00Z", downloadedAt: "2026-09-07T11:00:00Z" })), evidence: { scannerVersionSha256: hash, sbomSha256: hash, reportSha256: hash } };
  const report = { SchemaVersion: 2, ArtifactType: "filesystem", ArtifactName: "subject", Trivy: { Version: scanner.version }, CreatedAt: "2026-09-07T11:30:00Z", Results: [{ Class: "lang-pkgs", Type: "gobinary", Target: "oras", Packages: [{ Name: "oras.land/oras" }, { Name: "stdlib", Version: "v1.26.8" }], Vulnerabilities: [] }] };
  const properties = (values) => Object.entries(values).map(([name, value]) => ({ name, value }));
  const sbom = { bomFormat: "CycloneDX", metadata: { component: { type: "application", name: "subject" }, tools: { components: [{ type: "application", name: "trivy" }] } }, components: [
    { type: "application", name: "oras", properties: properties({ "aquasecurity:trivy:Type": "gobinary", "aquasecurity:trivy:Class": "lang-pkgs" }) },
    { type: "library", name: "oras.land/oras", properties: properties({ "aquasecurity:trivy:PkgType": "gobinary" }) },
    { type: "library", name: "stdlib", version: "v1.26.8", properties: properties({ "aquasecurity:trivy:PkgType": "gobinary" }) },
  ] };
  const expected = globalThis.structuredClone({ run, subject, scanner, databases: receipt.databases.map(({ name, repository, sha256, metadataSha256 }) => ({ name, repository, sha256, metadataSha256 })), artifactName: report.ArtifactName, scanTarget: "oras", requiredPackages: [{ name: "oras.land/oras", version: "" }, { name: "stdlib", version: "v1.26.8" }] });
  const metadata = receipt.databases.map((entry, index) => ({ Version: index === 0 ? 2 : 1, UpdatedAt: entry.updatedAt, NextUpdate: "2026-09-08T12:00:00Z", DownloadedAt: entry.downloadedAt }));
  return { receipt, report, sbom, expected, metadata };
}
const evaluate = ({ receipt, report, sbom, expected, metadata }) => evaluateNativeAudit(receipt, report, sbom, expected, now, metadata);

test("native evidence contract produces a proposal, never admitted state", () => {
  assert.equal(evaluate(fixture()).state, "audit_proposal");
});

test("native evidence readers refuse actual hard-linked files", async () => {
  const owned = await createOwnedDirectory();
  try {
    const file = path.join(owned.path, "evidence.json");
    await writeFile(file, "{}");
    await link(file, path.join(owned.path, "alias.json"));
    await assert.rejects(hashFileBounded(file, 1024), { code: "evidence_path_invalid" });
    await assert.rejects(readFileBounded(file, 1024), { code: "evidence_path_invalid" });
  } finally {
    await removeOwnedDirectory(owned);
  }
});

test("all critical/high findings block, including unfixed high without disposition", () => {
  for (const severity of ["CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
    for (const fixed of ["", "1.26.9"]) {
      const data = fixture();
      data.report.Results[0].Vulnerabilities.push({ VulnerabilityID: "TEST-2026-0001", PkgName: "stdlib", InstalledVersion: "v1.26.8", Severity: severity, FixedVersion: fixed });
      assert.equal(evaluate(data).blockers.length, ["CRITICAL", "HIGH"].includes(severity) ? 1 : 0);
    }
  }
});

test("subject, scanner, run, inventory and database substitution fail", () => {
  const mutations = [
    (data) => { data.receipt.kind = "container_image"; },
    (data) => { data.receipt.subject.sha256 = "2".repeat(64); },
    (data) => { data.receipt.scanner.sha256 = "2".repeat(64); },
    (data) => { data.receipt.run.id = "124"; },
    (data) => { data.receipt.run.workflowSha = "b".repeat(40); },
    (data) => { data.receipt.subject.materialSha256 = "2".repeat(64); },
    (data) => { data.receipt.subject.os = "windows"; },
    (data) => { data.report.ArtifactType = "container_image"; },
    (data) => { data.report.Trivy.Version = "0.74.0"; },
    (data) => { data.report.Results[0].Target = "another-binary"; },
    (data) => { data.report.Results[0].Packages = []; },
    (data) => { data.sbom.components = []; },
    (data) => { data.sbom.components.push({ type: "library", name: "omitted-module", version: "v1.0.0", properties: [{ name: "aquasecurity:trivy:PkgType", value: "gobinary" }] }); },
    (data) => { data.sbom.components.push({ ...data.sbom.components[0] }); },
    (data) => { data.expected.requiredPackages.push({ name: "omitted-module", version: "v1.0.0" }); },
    (data) => { data.sbom.metadata.component.name = "other"; },
    (data) => { data.sbom.components[0].properties[0].value = "jar"; },
    (data) => { data.sbom.components[1].type = "application"; },
    (data) => { data.report.CreatedAt = "2000-01-01T00:00:00Z"; },
    (data) => { data.report.CreatedAt = "2026-09-07T10:59:59Z"; },
    (data) => { data.metadata[0].UpdatedAt = "2000-01-01T00:00:00Z"; },
    (data) => { data.metadata[0].DownloadedAt = "2026-09-07T13:00:00Z"; },
    (data) => { data.receipt.databases[1].updatedAt = "2026-09-05T11:59:59Z"; },
    (data) => { data.receipt.databases[0].updatedAt = "2026-09-07T13:00:00Z"; },
    (data) => { data.receipt.disposition = "approved"; },
    (data) => { data.report.Results[0].Vulnerabilities = [{ Severity: "UNKNOWN" }]; },
  ];
  for (const mutate of mutations) {
    const data = fixture(); mutate(data); assert.throws(() => evaluate(data));
  }
  const boundary = fixture();
  boundary.receipt.databases[0].updatedAt = "2026-09-05T12:00:00Z";
  boundary.metadata[0].UpdatedAt = boundary.receipt.databases[0].updatedAt;
  assert.equal(evaluate(boundary).state, "audit_proposal");
});

test("bounded file hashing accepts exact cap and rejects one over", async () => {
  const directory = await createOwnedDirectory();
  try {
    const file = path.join(directory.path, "subject.bin");
    await writeFile(file, Buffer.alloc(128, 42));
    assert.equal((await hashFileBounded(file, 128)).size, 128);
    assert.deepEqual(await readFileBounded(file, 128), Buffer.alloc(128, 42));
    await assert.rejects(readFileBounded(file, 127), { code: "evidence_size_invalid" });
    await assert.rejects(hashFileBounded(file, 127), { code: "evidence_size_invalid" });
  } finally { await removeOwnedDirectory(directory); }
});

test("file verification independently binds every evidence byte and detects substitution", async () => {
  const directory = await createOwnedDirectory();
  try {
    const data = fixture();
    const files = Object.fromEntries(["receipt", "binary", "scanner", "scannerVersion", "buildInfo", "moduleGraph", "material", "recipe", "sbom", "report", "database", "javaDatabase", "databaseMetadata", "javaDatabaseMetadata"].map((name) => [name, path.join(directory.path, `${name}.data`)]));
    for (const [name, file] of Object.entries(files)) {
      await writeFile(file, name === "sbom" ? JSON.stringify(data.sbom) : name === "report" ? JSON.stringify(data.report) : `synthetic-${name}`);
    }
    await writeFile(files.databaseMetadata, JSON.stringify(data.metadata[0]));
    await writeFile(files.javaDatabaseMetadata, JSON.stringify(data.metadata[1]));
    await writeFile(files.scannerVersion, JSON.stringify({ Version: data.receipt.scanner.version }));
    const hashes = {};
    for (const [name, file] of Object.entries(files)) hashes[name] = await hashFileBounded(file, 8192);
    const subject = data.receipt.subject;
    subject.sha256 = hashes.binary.sha256;
    subject.size = hashes.binary.size;
    for (const name of ["buildInfo", "moduleGraph", "material", "recipe"]) subject[`${name}Sha256`] = hashes[name].sha256;
    data.receipt.scanner.sha256 = hashes.scanner.sha256;
    data.receipt.evidence = { scannerVersionSha256: hashes.scannerVersion.sha256, sbomSha256: hashes.sbom.sha256, reportSha256: hashes.report.sha256 };
    data.receipt.databases[0].sha256 = hashes.database.sha256;
    data.receipt.databases[1].sha256 = hashes.javaDatabase.sha256;
    data.receipt.databases[0].metadataSha256 = hashes.databaseMetadata.sha256;
    data.receipt.databases[1].metadataSha256 = hashes.javaDatabaseMetadata.sha256;
    data.expected.subject = globalThis.structuredClone(subject);
    data.expected.scanner = globalThis.structuredClone(data.receipt.scanner);
    data.expected.databases = data.receipt.databases.map(({ name, repository, sha256, metadataSha256 }) => ({ name, repository, sha256, metadataSha256 }));
    await writeFile(files.receipt, JSON.stringify(data.receipt));
    assert.equal((await verifyNativeAuditFiles(files, data.expected, now)).state, "audit_proposal");
    for (const name of ["binary", "scanner", "scannerVersion", "buildInfo", "moduleGraph", "material", "recipe", "database", "javaDatabase"]) {
      await writeFile(files[name], "altered-byte-identity");
      await assert.rejects(verifyNativeAuditFiles(files, data.expected, now));
      await writeFile(files[name], name === "scannerVersion" ? JSON.stringify({ Version: data.receipt.scanner.version }) : `synthetic-${name}`);
    }
    await writeFile(files.report, JSON.stringify({ ...data.report, Results: [] }));
    await assert.rejects(verifyNativeAuditFiles(files, data.expected, now), { code: "native_identity_mismatch" });
  } finally { await removeOwnedDirectory(directory); }
});
