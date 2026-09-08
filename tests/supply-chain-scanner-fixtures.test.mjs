import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";
import {
  loadScannerFixtureManifest,
  runScannerFixtures,
  scannerFixtureArtifactInventory,
  scannerFixtureArguments,
  validateScannerFixtureArtifact,
  verifyScannerFixtureScratch,
  verifyScannerFixtureReportFile,
  validateScannerFixtureReport,
} from "../scripts/supply-chain/scanner-fixtures.mjs";
import { sha256 } from "../scripts/supply-chain/strict-json.mjs";

const finding = (VulnerabilityID, PkgName, InstalledVersion, FixedVersion) => ({
  VulnerabilityID, PkgName, InstalledVersion, FixedVersion,
});
const result = (Target, Type, Packages, Vulnerabilities = []) => ({
  Target, Class: "lang-pkgs", Type, Packages: Packages.map(([Name, Version]) => ({ Name, Version })), Vulnerabilities,
});
const report = (ArtifactName, Results) => ({
  SchemaVersion: 2, ArtifactName, ArtifactType: "filesystem", Trivy: { Version: "0.74.0-autoworld.1" }, Results,
});

function goReport() {
  const value = report("gomod", [
    result("go.mod", "gomod", [
      ["github.com/docker/distribution", "v2.7.1+incompatible"],
      ["github.com/open-policy-agent/opa", "v0.35.0"],
      ["golang.org/x/text", "v0.3.6"],
    ], [
      finding("GMS-2022-20", "github.com/docker/distribution", "v2.7.1+incompatible", "v2.8.0"),
      finding("CVE-2022-23628", "github.com/open-policy-agent/opa", "v0.35.0", "0.37.0"),
      finding("CVE-2021-38561", "golang.org/x/text", "v0.3.6", "0.3.7"),
    ]),
    result("submod/go.mod", "gomod", [["github.com/docker/distribution", "v2.7.1+incompatible"]], [
      finding("GMS-2022-20", "github.com/docker/distribution", "v2.7.1+incompatible", "v2.8.0"),
    ]),
    result("submod2/go.mod", "gomod", [["github.com/docker/distribution", "v2.7.1+incompatible"]], [
      finding("GMS-2022-20", "github.com/docker/distribution", "v2.7.1+incompatible", "v2.8.0"),
    ]),
  ]);
  for (const entry of value.Results) {
    const suffix = entry.Target === "go.mod" ? "" : `/${entry.Target.split("/")[0]}`;
    const Name = `github.com/testdata/testdata${suffix}`;
    entry.Packages.push({ ID: Name, Name, Relationship: "root" });
  }
  return value;
}

function warReport() {
  return report("test.war", [result("test.war", "jar", [["com.fasterxml.jackson.core:jackson-databind", "2.9.10.6"]], [
    finding("CVE-2021-20190", "com.fasterxml.jackson.core:jackson-databind", "2.9.10.6", "2.9.10.7"),
  ])]);
}

function cleanJarReport() {
  return report("jackson-core-2.15.0.jar", [result("jackson-core-2.15.0.jar", "jar", [["com.fasterxml.jackson.core:jackson-core", "2.15.0"]])]);
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const rejected = (fixtureId, value) => assert.throws(
  () => validateScannerFixtureReport(fixtureId, value),
  { code: "scanner_fixture_report_invalid" },
);

test("Go fixture JSON accepts only the three source-derived roots without version or identifier", async () => {
  const value = goReport();
  for (const entry of value.Results) {
    const bytes = await readFile(new URL(`../infra/supply-chain/materials/scanner-fixtures/gomod/${entry.Target}`, import.meta.url));
    const name = /^module (.+)$/mu.exec(bytes.toString("utf8"))[1].trim();
    assert.equal(entry.Packages.at(-1).Name, name);
  }
  assert.doesNotThrow(() => validateScannerFixtureReport("gomod-vulnerable", value));
  for (const mutate of [
    (entry) => { entry.Packages.pop(); },
    (entry) => { entry.Packages.at(-1).Version = ""; },
    (entry) => { entry.Packages.at(-1).Version = undefined; },
    (entry) => { entry.Packages.at(-1).Version = "v1.0.0"; },
    (entry) => { entry.Packages.at(-1).Identifier = {}; },
    (entry) => { entry.Packages.at(-1).ID = "other"; },
    (entry) => { entry.Packages.at(-1).Relationship = "direct"; },
    (entry) => { entry.Packages.at(-1).Name += "/other"; },
    (entry) => { delete entry.Packages[0].Version; },
  ]) {
    const changed = goReport();
    mutate(changed.Results[0]);
    rejected("gomod-vulnerable", changed);
  }
});

test("scanner fixture manifest is byte-pinned and closes exactly eight local inputs", async () => {
  const expected = { sha256: "68dfb6e1fdd196b23eb36256119a3050ea104a8a11c5109f34c1a389c34f2a30", size: 6184 };
  const manifest = await loadScannerFixtureManifest(expected);
  await assert.rejects(loadScannerFixtureManifest({ ...expected, sha256: "f".repeat(64) }),
    { code: "scanner_fixture_material_changed" });
  assert.deepEqual(manifest.fixtures.map(({ id }) => id), [
    "gomod-vulnerable", "java-war-vulnerable", "java-jar-clean-candidate",
  ]);
  assert.deepEqual(manifest.fixtures.flatMap(({ material }) => material.map(({ path: materialPath }) => materialPath)), [
    "gomod/go.mod", "gomod/go.sum", "gomod/submod/go.mod", "gomod/submod/go.sum",
    "gomod/submod2/go.mod", "gomod/submod2/go.sum", "java/test.war", "java/jackson-core-2.15.0.jar",
  ]);
});

test("scanner fixture argv is an offline JSON vulnerability scan with full package inventory", () => {
  const cache = path.resolve("owned-cache");
  for (const target of ["gomod", "test.war", "jackson-core-2.15.0.jar"]) {
    const args = scannerFixtureArguments(cache, target);
    for (const flag of ["--skip-db-update", "--skip-java-db-update", "--offline-scan", "--quiet", "--cache-backend", "memory", "--scanners", "vuln", "--format", "json", "--list-all-pkgs"]) {
      assert.ok(args.includes(flag));
    }
    assert.equal(args.at(-1), target);
    assert.equal(args.includes("--output"), false);
  }
  assert.throws(() => scannerFixtureArguments("relative", "gomod"), { code: "scanner_fixture_arguments_invalid" });
  assert.throws(() => scannerFixtureArguments(cache, "arbitrary"), { code: "scanner_fixture_arguments_invalid" });
});

test("fixture artifact admits only eight materials and three reports without scratch directories", async () => {
  const inventory = scannerFixtureArtifactInventory();
  assert.deepEqual(inventory.directories, ["materials", "reports"]);
  assert.equal(inventory.materials.length, 8);
  assert.equal(inventory.reports.length, 3);
  for (const scratch of ["home", "tmp", "gopath", "gocache", "gomodcache"]) {
    assert.equal([...inventory.directories, ...inventory.materials, ...inventory.reports].some((entry) => entry.split("/").includes(scratch)), false);
  }
  const owned = await createOwnedDirectory();
  try {
    const artifact = path.join(owned.path, "fixtures");
    await mkdir(artifact);
    for (const relative of [...inventory.materials, ...inventory.reports]) {
      const file = path.join(artifact, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, relative);
    }
    assert.equal(await validateScannerFixtureArtifact(artifact), true);
    await writeFile(path.join(artifact, "unbounded-cache"), "unexpected");
    await assert.rejects(validateScannerFixtureArtifact(artifact), { code: "scanner_fixture_artifact_invalid" });
  } finally { await removeOwnedDirectory(owned); }
});

test("fixture scratch is a precreated empty sibling and remains five exact empty directories", async () => {
  const parent = await createOwnedDirectory();
  let workspace;
  let scratch;
  try {
    workspace = await createOwnedDirectory(parent.path);
    scratch = await createOwnedDirectory(parent.path);
    assert.equal(await verifyScannerFixtureScratch({ scratch: scratch.path, workspace: workspace.path, initialized: false }), true);
    for (const name of ["home", "tmp", "gopath", "gocache", "gomodcache"]) await mkdir(path.join(scratch.path, name));
    assert.equal(await verifyScannerFixtureScratch({ scratch: scratch.path, workspace: workspace.path, initialized: true }), true);
    await writeFile(path.join(scratch.path, "home", "growth"), "sentinel");
    await assert.rejects(verifyScannerFixtureScratch({ scratch: scratch.path, workspace: workspace.path, initialized: true }),
      { code: "scanner_fixture_scratch_invalid" });
    await rm(path.join(scratch.path, "home", "growth"));
    await mkdir(path.join(scratch.path, "extra"));
    await assert.rejects(verifyScannerFixtureScratch({ scratch: scratch.path, workspace: workspace.path, initialized: true }),
      { code: "scanner_fixture_scratch_invalid" });
    await assert.rejects(verifyScannerFixtureScratch({ scratch: workspace.path, workspace: workspace.path, initialized: false }),
      { code: "scanner_fixture_scratch_invalid" });
  } finally {
    if (scratch) await removeOwnedDirectory(scratch);
    if (workspace) await removeOwnedDirectory(workspace);
    await removeOwnedDirectory(parent);
  }
});

test("fixture scratch refuses an expected directory replaced by a link", { skip: process.platform === "win32" }, async () => {
  const parent = await createOwnedDirectory();
  let workspace;
  let scratch;
  try {
    workspace = await createOwnedDirectory(parent.path);
    scratch = await createOwnedDirectory(parent.path);
    for (const name of ["home", "tmp", "gopath", "gocache", "gomodcache"]) await mkdir(path.join(scratch.path, name));
    await rm(path.join(scratch.path, "home"), { recursive: true });
    await symlink(workspace.path, path.join(scratch.path, "home"), "dir");
    await assert.rejects(verifyScannerFixtureScratch({ scratch: scratch.path, workspace: workspace.path, initialized: true }),
      { code: "scanner_fixture_scratch_invalid" });
  } finally {
    if (scratch) await removeOwnedDirectory(scratch);
    if (workspace) await removeOwnedDirectory(workspace);
    await removeOwnedDirectory(parent);
  }
});

test("pure fixture validator accepts the selected package and vulnerability contracts", () => {
  assert.equal(validateScannerFixtureReport("gomod-vulnerable", goReport()).results.length, 3);
  assert.equal(validateScannerFixtureReport("java-war-vulnerable", warReport()).results.length, 1);
  assert.equal(validateScannerFixtureReport("java-jar-clean-candidate", cleanJarReport()).results.length, 1);
});

test("Go fixture rejects empty inventory and missing or changed packages", () => {
  const emptyResults = goReport();
  emptyResults.Results = [];
  rejected("gomod-vulnerable", emptyResults);
  const emptyPackages = goReport();
  emptyPackages.Results[0].Packages = [];
  rejected("gomod-vulnerable", emptyPackages);
  const missingPackage = goReport();
  missingPackage.Results[0].Packages.splice(1, 1);
  rejected("gomod-vulnerable", missingPackage);
  const changedVersion = goReport();
  changedVersion.Results[0].Packages[0].Version = "v2.8.0";
  rejected("gomod-vulnerable", changedVersion);
});

test("vulnerable fixtures require selected CVEs, reject duplicates, and preserve fresh additions", () => {
  const missing = goReport();
  missing.Results[0].Vulnerabilities.pop();
  rejected("gomod-vulnerable", missing);
  const changed = warReport();
  changed.Results[0].Vulnerabilities[0].VulnerabilityID = "CVE-2099-0001";
  rejected("java-war-vulnerable", changed);
  const duplicate = goReport();
  duplicate.Results[0].Vulnerabilities.push(clone(duplicate.Results[0].Vulnerabilities[0]));
  rejected("gomod-vulnerable", duplicate);
  const absentFromInventory = warReport();
  absentFromInventory.Results[0].Vulnerabilities[0].PkgName = "attacker/substitute";
  rejected("java-war-vulnerable", absentFromInventory);
  const additional = warReport();
  additional.Results[0].Vulnerabilities.push(finding(
    "CVE-2099-0002", "com.fasterxml.jackson.core:jackson-databind", "2.9.10.6", "2.9.10.8",
  ));
  assert.equal(validateScannerFixtureReport("java-war-vulnerable", additional).results[0].findings.length, 2);
});

test("fixture reports bind the selected scanner version and exact scan target", () => {
  const wrongVersion = goReport();
  wrongVersion.Trivy.Version = "0.74.0";
  rejected("gomod-vulnerable", wrongVersion);
  const wrongTarget = warReport();
  wrongTarget.ArtifactName = "other.war";
  rejected("java-war-vulnerable", wrongTarget);
});

test("saved fixture report is reparsed and hashed from the original stdout bytes", async () => {
  const owned = await createOwnedDirectory();
  try {
    const reportPath = path.join(owned.path, "report.json");
    const bytes = Buffer.from(JSON.stringify(cleanJarReport()));
    const stdoutIdentity = { sha256: sha256(bytes), size: bytes.length };
    await writeFile(reportPath, bytes);
    assert.deepEqual(await verifyScannerFixtureReportFile({ fixtureId: "java-jar-clean-candidate", reportPath, stdoutIdentity }), {
      fixtureId: "java-jar-clean-candidate", path: reportPath, ...stdoutIdentity,
    });
    await writeFile(reportPath, Buffer.from(JSON.stringify(warReport())));
    await assert.rejects(verifyScannerFixtureReportFile({ fixtureId: "java-jar-clean-candidate", reportPath, stdoutIdentity }), {
      code: "scanner_fixture_report_changed",
    });
  } finally { await removeOwnedDirectory(owned); }
});

test("clean JAR requires its one exact package and zero findings", () => {
  for (const mutate of [
    (value) => { value.Results[0].Packages = []; },
    (value) => { value.Results[0].Packages[0].Name = "attacker/substitute"; },
    (value) => { value.Results[0].Packages[0].Version = "2.15.1"; },
    (value) => { value.Results[0].Packages.push({ Name: "extra", Version: "1.0.0" }); },
    (value) => { value.Results[0].Vulnerabilities = [finding("CVE-2025-52999", "com.fasterxml.jackson.core:jackson-core", "2.15.0", "2.15.1")]; },
  ]) {
    const invalid = cleanJarReport();
    mutate(invalid);
    rejected("java-jar-clean-candidate", invalid);
  }
});

test("fixture execution refuses a credential-bearing local workstation", async () => {
  if (process.platform === "linux" && process.env.GITHUB_ACTIONS === "true") return;
  await assert.rejects(runScannerFixtures({
    scanner: path.resolve("trivy"), cacheDirectory: path.resolve("cache"), workspace: path.resolve("workspace"),
    environment: {}, deadline: Date.now() + 1000,
  }), { code: "scanner_fixtures_require_linux_actions" });
});
