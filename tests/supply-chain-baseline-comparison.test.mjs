import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { NATIVE_AUDIT_ARTIFACT_FILES } from "../scripts/supply-chain/audit-artifacts.mjs";
import { baselineDockerArguments, compareBaselineReports, normalizeBaselineComparisonReport,
  loadBaselineExpectedInventory, validateBaselineDockerArguments, validateBaselineExpectedInventory,
  validateNativeAuditComparisonArtifact } from "../scripts/supply-chain/baseline-comparison.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";

const paths = { configDirectory: "/runner/private/config", fixturesDirectory: "/runner/private/fixtures", cacheDirectory: "/runner/private/cache" };
const clone = (value) => JSON.parse(JSON.stringify(value));

test("baseline Docker argv is exact, non-root, offline and has only two read-only inputs", () => {
  for (const operation of ["probe", "gomod-vulnerable", "java-war-vulnerable"]) {
    const args = baselineDockerArguments({ ...paths, operation });
    assert.equal(validateBaselineDockerArguments(args, paths, operation), true);
    assert.equal(args.filter((entry) => entry === "--mount").length, 2);
    assert.ok(args.includes("65532:65532"));
    for (const required of ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true", "--memory-swap"] ) {
      assert.ok(args.includes(required));
    }
    for (const forbidden of ["--privileged", "--cap-add", "--network=host", "--pid=host", "--ipc=host", "--use-api-socket", "-v", "--volume"]) {
      assert.equal(args.includes(forbidden), false);
    }
  }
  const original = baselineDockerArguments({ ...paths, operation: "gomod-vulnerable" });
  for (const mutate of [
    (args) => args.with(args.indexOf("65532:65532"), "0:0"),
    (args) => args.with(args.indexOf("--network=none"), "--network=host"),
    (args) => args.filter((entry) => entry !== "--read-only"),
    (args) => [...args, "--privileged"],
    (args) => args.with(args.indexOf("--pull=never"), "--pull=always"),
  ]) assert.throws(() => validateBaselineDockerArguments(mutate(original), paths, "gomod-vulnerable"), { code: "baseline_comparison_arguments_refused" });
  for (const invalid of ["relative", "/path,option", "/safe/../escape"]) {
    assert.throws(() => baselineDockerArguments({ ...paths, cacheDirectory: invalid, operation: "gomod-vulnerable" }), { code: "baseline_comparison_arguments_refused" });
  }
});

function packageEntry(target, name, version, purl = "") {
  return { target, class: "lang-pkgs", type: target.endsWith(".war") ? "jar" : "gomod", name, version, purl };
}

function rawResult(target, type, name, version, finding) {
  return { Target: target, Class: "lang-pkgs", Type: type, Packages: [{ Name: name, Version: version }],
    Vulnerabilities: finding ? [{ VulnerabilityID: finding, PkgName: name, InstalledVersion: version, FixedVersion: "fixed",
      Severity: "HIGH", Status: "fixed", SeveritySource: "nvd", PrimaryURL: "https://example.invalid/advisory",
      DataSource: { ID: "nvd", Name: "NVD", URL: "https://example.invalid/source" } }] : [] };
}

function goResult(target, root, dependency, version, finding) {
  return { Target: target, Class: "lang-pkgs", Type: "gomod",
    Packages: [{ ID: root, Name: root, Relationship: "root" }, { Name: dependency, Version: version, Relationship: "direct" }],
    Vulnerabilities: finding ? [{ VulnerabilityID: finding, PkgName: dependency, InstalledVersion: version, FixedVersion: "fixed",
      Severity: "HIGH", Status: "fixed", SeveritySource: "nvd", PrimaryURL: "https://example.invalid/advisory",
      DataSource: { ID: "nvd", Name: "NVD", URL: "https://example.invalid/source" } }] : [] };
}

function report(fixtureId, version, finding = "CVE-2026-1") {
  const go = fixtureId === "gomod-vulnerable";
  const target = go ? "gomod" : "test.war";
  return { SchemaVersion: 2, ArtifactType: "filesystem", ArtifactName: version === "0.74.0" ? `/fixtures/${go ? "gomod" : "java/test.war"}` : target, Trivy: { Version: version },
    Results: go ? [goResult("go.mod", "github.com/testdata/testdata", "example/a", "v1.0.0", finding),
      goResult("submod/go.mod", "github.com/testdata/testdata/submod", "example/b", "v2.0.0"),
      goResult("submod2/go.mod", "github.com/testdata/testdata/submod2", "example/c", "v3.0.0")]
      : [rawResult("test.war", "jar", "example:war", "1.0.0", finding)] };
}

const expectedInventory = Object.freeze([
  { fixtureId: "gomod-vulnerable", packages: [packageEntry("go.mod", "github.com/testdata/testdata", ""), packageEntry("go.mod", "example/a", "v1.0.0"),
    packageEntry("submod/go.mod", "github.com/testdata/testdata/submod", ""), packageEntry("submod/go.mod", "example/b", "v2.0.0"),
    packageEntry("submod2/go.mod", "github.com/testdata/testdata/submod2", ""), packageEntry("submod2/go.mod", "example/c", "v3.0.0")] },
  { fixtureId: "java-war-vulnerable", packages: [packageEntry("test.war", "example:war", "1.0.0")] },
]);

function auditArtifactBytes(contract) {
  if (contract.path !== "native-audit-results.json") return Buffer.from(contract.path);
  return canonicalJsonBuffer({ schemaVersion: 1, budget: {}, results: [{}, {}, {}, {}], fixtures: {} });
}

test("pure baseline comparison requires full source inventory and reports package, version and CVE drift", () => {
  const candidate = ["gomod-vulnerable", "java-war-vulnerable"].map((id) => normalizeBaselineComparisonReport(id, report(id, "0.74.0-autoworld.1"), "0.74.0-autoworld.1"));
  const baseline = ["gomod-vulnerable", "java-war-vulnerable"].map((id) => normalizeBaselineComparisonReport(id, report(id, "0.74.0"), "0.74.0"));
  assert.equal(compareBaselineReports(candidate, baseline, expectedInventory).matched, true);
  const missing = clone(report("gomod-vulnerable", "0.74.0"));
  missing.Results[0].Packages = [];
  assert.throws(() => normalizeBaselineComparisonReport("gomod-vulnerable", missing, "0.74.0"), { code: "baseline_report_invalid" });
  const changedVersion = clone(report("java-war-vulnerable", "0.74.0"));
  changedVersion.Results[0].Packages[0].Version = "2.0.0";
  changedVersion.Results[0].Vulnerabilities[0].InstalledVersion = "2.0.0";
  const versionComparison = compareBaselineReports(candidate, [baseline[0], normalizeBaselineComparisonReport("java-war-vulnerable", changedVersion, "0.74.0")], expectedInventory);
  assert.equal(versionComparison.matched, false);
  assert.equal(versionComparison.comparisons[1].baselineUnexpectedPackages.length, 1);
  const changedCve = clone(report("java-war-vulnerable", "0.74.0", "CVE-2026-2"));
  const cveComparison = compareBaselineReports(candidate, [baseline[0], normalizeBaselineComparisonReport("java-war-vulnerable", changedCve, "0.74.0")], expectedInventory);
  assert.equal(cveComparison.matched, false);
  assert.equal(cveComparison.comparisons[1].baselineOnlyFindings.length, 1);
  assert.throws(() => compareBaselineReports(candidate, baseline, []), { code: "baseline_expected_inventory_missing" });

  const validRoots = report("gomod-vulnerable", "0.74.0");
  const normalizedRoot = normalizeBaselineComparisonReport("gomod-vulnerable", validRoots, "0.74.0");
  assert.deepEqual(normalizedRoot.packages.find((entry) => entry.name === "github.com/testdata/testdata"),
    packageEntry("go.mod", "github.com/testdata/testdata", ""));
  for (const mutate of [
    (value) => { value.Results[0].Packages[0].ID = "substituted"; },
    (value) => { value.Results[0].Packages[0].Relationship = "direct"; },
    (value) => { value.Results[0].Packages[0].Identifier = {}; },
    (value) => { value.Results[0].Packages[0].Version = "v1.0.0"; },
    (value) => { value.Results[0].Packages.push(clone(value.Results[0].Packages[0])); },
    (value) => { value.Results[0].Packages.shift(); },
    (value) => { delete value.Results[0].Packages[1].Version; },
  ]) {
    const hostile = clone(validRoots);
    mutate(hostile);
    assert.throws(() => normalizeBaselineComparisonReport("gomod-vulnerable", hostile, "0.74.0"), { code: "baseline_report_invalid" });
  }
});

test("independent fixture inventory is byte-pinned, complete and source-bound", async () => {
  const manifest = JSON.parse(await readFile("infra/supply-chain/materials/scanner-fixtures/manifest.json", "utf8"));
  const inventory = JSON.parse(await readFile("infra/supply-chain/materials/baseline-fixtures/expected-inventory.json", "utf8"));
  const validated = validateBaselineExpectedInventory(inventory, manifest);
  assert.equal(validated.length, 2);
  assert.equal(validated.reduce((sum, entry) => sum + entry.packages.length, 0), 43);
  assert.deepEqual(await loadBaselineExpectedInventory(manifest), validated);
  const missing = clone(inventory);
  missing.targets[0].packages.pop();
  assert.throws(() => validateBaselineExpectedInventory(missing, manifest), { code: "baseline_expected_inventory_invalid" });
  const substituted = clone(inventory);
  substituted.materials["java/test.war"].sha256 = "0".repeat(64);
  assert.throws(() => validateBaselineExpectedInventory(substituted, manifest), { code: "baseline_expected_inventory_invalid" });
  const inventedReportPurl = clone(inventory);
  inventedReportPurl.targets[0].packages[0].purl = inventedReportPurl.targets[0].packages[0].canonicalPurl;
  assert.throws(() => validateBaselineExpectedInventory(inventedReportPurl, manifest), { code: "baseline_expected_inventory_invalid" });
  const incompleteRootContract = clone(inventory);
  incompleteRootContract.targets[0].reportJsonRootPackageOmittedFields = ["Version"];
  assert.throws(() => validateBaselineExpectedInventory(incompleteRootContract, manifest), { code: "baseline_expected_inventory_invalid" });
});

test("native audit input requires the exact 49-file passed package and rejects additions or changed bytes", async () => {
  const owned = await createOwnedDirectory();
  try {
    const artifact = path.join(owned.path, "audit");
    await mkdir(artifact);
    const files = [];
    for (const contract of NATIVE_AUDIT_ARTIFACT_FILES) {
      const bytes = auditArtifactBytes(contract);
      await mkdir(path.dirname(path.join(artifact, contract.path)), { recursive: true });
      await writeFile(path.join(artifact, contract.path), bytes);
      files.push({ path: contract.path, sha256: sha256(bytes), size: bytes.length });
    }
    await writeFile(path.join(artifact, "diagnostic-package.json"), canonicalJsonBuffer({ schemaVersion: 1, state: "diagnostic_only",
      executionStatus: "passed", phase: "complete", files }));
    const validated = await validateNativeAuditComparisonArtifact(artifact);
    assert.equal(validated.identities.size, 49);
    await writeFile(path.join(artifact, "unexpected"), "x");
    await assert.rejects(validateNativeAuditComparisonArtifact(artifact), { code: "baseline_audit_artifact_invalid" });
  } finally { await removeOwnedDirectory(owned); }

  const changed = await createOwnedDirectory();
  try {
    const artifact = path.join(changed.path, "audit");
    await mkdir(artifact);
    const files = [];
    for (const contract of NATIVE_AUDIT_ARTIFACT_FILES) {
      const bytes = auditArtifactBytes(contract);
      await mkdir(path.dirname(path.join(artifact, contract.path)), { recursive: true });
      await writeFile(path.join(artifact, contract.path), bytes);
      files.push({ path: contract.path, sha256: sha256(bytes), size: bytes.length });
    }
    await writeFile(path.join(artifact, "diagnostic-package.json"), canonicalJsonBuffer({ schemaVersion: 1, state: "diagnostic_only",
      executionStatus: "passed", phase: "complete", files }));
    await writeFile(path.join(artifact, NATIVE_AUDIT_ARTIFACT_FILES[0].path), "substitution");
    await assert.rejects(validateNativeAuditComparisonArtifact(artifact), { code: "baseline_audit_artifact_changed" });
  } finally { await removeOwnedDirectory(changed); }
});
