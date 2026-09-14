import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import path from "node:path";
import { candidateDockerArguments, databaseDownloadDockerArguments, parseAuditArguments, validateDatabaseRegistryManifest } from "../scripts/scanner/audit.mjs";
import { assertFilesUnchanged, captureFiles, compareSameDatabase, parseGoBuildInfo, validateBuildPair, validateFixtureReport, validateSelfReport } from "../scripts/scanner/controls.mjs";

function receipt(repeat, sha = "a".repeat(64)) {
  return { schemaVersion: 1, state: "diagnostic_only", result: "passed", repeat, scannerVersion: "0.74.0-autoworld.2",
    sourceCommit: "1".repeat(40), sourceTree: "2".repeat(40), lock: { sha256: "3".repeat(64) }, binary: { sha256: sha, size: 10 },
    modules: { before: [{ name: "go.mod", sha256: "4".repeat(64), size: 1 }], closure: { sha256: "5".repeat(64), size: 1 } }, buildInfo: { sha256: "7".repeat(64), size: 1 },
    phases: Array.from({ length: 8 }, (_, index) => ({ name: String(index), result: "passed" })) };
}

function expected() {
  const value = [{ path: "example.test/module", version: "v1.0.0", sum: "h1:a", goModSum: "h1:b", zip: { sha256: "6".repeat(64), size: 1 } }];
  return { sourceCommit: "1".repeat(40), lockSha256: "3".repeat(64), moduleClosures: [
    { value, identity: { sha256: "5".repeat(64), size: 1 } }, { value: JSON.parse(JSON.stringify(value)), identity: { sha256: "5".repeat(64), size: 1 } },
  ], buildInfos: [
    { value: { normalized: true }, identity: { sha256: "7".repeat(64), size: 1 } },
    { value: { normalized: true }, identity: { sha256: "7".repeat(64), size: 1 } },
  ] };
}

test("independent build receipts require exact reproducibility", () => {
  assert.deepEqual(validateBuildPair(receipt(1), receipt(2), expected()), { sha256: "a".repeat(64), size: 10 });
  assert.throws(() => validateBuildPair(receipt(1), receipt(2, "b".repeat(64)), expected()), /scanner_reproducibility_mismatch/u);
  const wrongLock = expected(); wrongLock.lockSha256 = "7".repeat(64);
  assert.throws(() => validateBuildPair(receipt(1), receipt(2), wrongLock), /scanner_build_receipt_invalid/u);
  const changedClosure = expected(); changedClosure.moduleClosures[1].identity.sha256 = "8".repeat(64);
  assert.throws(() => validateBuildPair(receipt(1), receipt(2), changedClosure), /scanner_module_closure_changed/u);
  const changedBuildInfo = expected(); changedBuildInfo.buildInfos[1].identity.sha256 = "8".repeat(64);
  assert.throws(() => validateBuildPair(receipt(1), receipt(2), changedBuildInfo), /scanner_build_info_changed/u);
});

test("audit arguments require distinct explicit absolute directories", () => {
  const builds = path.resolve("builds");
  const output = path.resolve("audit");
  assert.deepEqual(parseAuditArguments(["--build-root", builds, "--output", output]), { buildRoot: builds, output });
  for (const args of [[], ["--build-root", builds], ["--build-root", "relative", "--output", output],
    ["--build-root", builds, "--output", builds], ["--build-root", builds, "--output", output, "--output", output]]) {
    assert.throws(() => parseAuditArguments(args), /scanner_audit_arguments_invalid/u);
  }
});

test("module closure validation uses the same case ordering as independent builders", () => {
  const inputs = expected();
  const entry = inputs.moduleClosures[0].value[0];
  const value = ["example.test/azure", "example.test/Big"].map((modulePath) => ({ ...entry, path: modulePath }));
  for (const closure of inputs.moduleClosures) closure.value = value;
  assert.doesNotThrow(() => validateBuildPair(receipt(1), receipt(2), inputs));
});

test("candidate scanner runs isolated without host or Docker socket access", () => {
  const args = candidateDockerArguments({ carrier: "aquasec/trivy@sha256:" + "a".repeat(64), scanner: path.resolve("trivy"), cache: path.resolve("cache"),
    mode: "fs", target: path.resolve("subject"), extra: ["--offline-scan"] });
  const joined = args.join(" ");
  assert.match(joined, /--network=none/u);
  assert.match(joined, /--read-only --cap-drop=ALL --security-opt=no-new-privileges=true --user 65532:65532/u);
  assert.match(joined, /dst=\/scanner,readonly/u);
  assert.match(joined, /dst=\/cache,readonly/u);
  assert.match(joined, /dst=\/subject,readonly/u);
  assert.doesNotMatch(joined, /docker\.sock|--privileged/u);
});

test("database downloader reserves two bounded archive copies and remains isolated", () => {
  const registries = ["trivy-db", "trivy-java-db"].map((name) => ({ repository: `ghcr.io/aquasecurity/${name}`, digest: `sha256:${"a".repeat(64)}` }));
  const args = databaseDownloadDockerArguments({ baseline: `aquasec/trivy@sha256:${"b".repeat(64)}`, cache: path.resolve("cache"), user: "1001:1001", registries, kind: "java" });
  const joined = args.join(" ");
  assert.match(joined, /--memory 4g --memory-swap 4g/u);
  assert.match(joined, /--tmpfs \/tmp:rw,nosuid,nodev,noexec,size=3g,mode=1777/u);
  assert.match(joined, /--read-only --cap-drop=ALL --security-opt=no-new-privileges=true/u);
  assert.match(joined, /--download-java-db-only$/u);
  assert.doesNotMatch(joined, /docker\.sock|--privileged/u);
});

test("database manifest preflight budgets two layer copies and one GiB headroom", () => {
  const manifest = (size) => Buffer.from(JSON.stringify({ schemaVersion: 2, layers: [{
    mediaType: "application/vnd.aquasecurity.trivy.db.layer.v1.tar+gzip", digest: `sha256:${"a".repeat(64)}`, size,
  }] }));
  assert.equal(validateDatabaseRegistryManifest(manifest(966074582)).layerBytes, 966074582);
  assert.throws(() => validateDatabaseRegistryManifest(manifest(1024 ** 3)), /scanner_database_layer_budget_exceeded/u);
  assert.throws(() => validateDatabaseRegistryManifest(manifest(0)), /scanner_database_registry_manifest_invalid/u);
});

test("known vulnerable fixture must retain its expected detection", () => {
  const fixture = { id: "gomod-vulnerable", expected: { findings: [{ target: "go.mod", id: "CVE-X", package: "example.test/a", version: "v1", fixedVersion: "v2" }] } };
  const report = { SchemaVersion: 2, ArtifactType: "filesystem", Trivy: { Version: "0.74.0-autoworld.2" }, Results: [{ Target: "go.mod", Type: "gomod", Class: "lang-pkgs",
    Packages: [{ Name: "example.test/a", Version: "v1" }], Vulnerabilities: [{ VulnerabilityID: "CVE-X", PkgName: "example.test/a", InstalledVersion: "v1", FixedVersion: "v2" }] }] };
  assert.equal(validateFixtureReport(fixture, report).findings.length, 1);
  report.Results[0].Vulnerabilities = [];
  assert.throws(() => validateFixtureReport(fixture, report), /scanner_fixture_detection_missing/u);
});

test("same-database comparison rejects baseline detection loss", () => {
  const baseline = { packages: ["a", "b"], findings: ["x"] };
  assert.deepEqual(compareSameDatabase({ packages: ["a", "b", "c"], findings: ["x", "y"] }, baseline), { baselineOnlyPackages: [], baselineOnlyFindings: [] });
  assert.throws(() => compareSameDatabase({ packages: ["a"], findings: [] }, baseline), /scanner_baseline_detection_loss/u);
});

test("frozen subject and database bytes are checked after execution", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aw-scanner-control-"));
  const file = path.join(directory, "subject");
  try {
    await writeFile(file, "before");
    const snapshot = await captureFiles([{ path: file, cap: 64 }]);
    assert.equal(await assertFilesUnchanged(snapshot), true);
    await writeFile(file, "after");
    await assert.rejects(assertFilesUnchanged(snapshot), /scanner_frozen_input_changed/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("locked Go build information normalizes independent paths and replacements", () => {
  const dependencies = Array.from({ length: 101 }, (_, index) => `\tdep\texample.test/module-${index}\tv1.0.${index}\th1:test`);
  dependencies.splice(2, 0, "\t=>\texample.test/replacement\tv2.0.0\th1:test");
  const body = ["\tpath\tgithub.com/aquasecurity/trivy/cmd/trivy", "\tmod\tgithub.com/aquasecurity/trivy\t(devel)\t", ...dependencies, "\tbuild\t-buildmode=exe"].join("\n");
  const first = parseGoBuildInfo(Buffer.from(`/tmp/repeat-1/trivy: go1.26.8-X:jsonv2\n${body}\n`));
  const second = parseGoBuildInfo(Buffer.from(`/tmp/repeat-2/trivy: go1.26.8-X:jsonv2\r\n${body.replaceAll("\n", "\r\n")}\r\n`));
  assert.deepEqual(first, second);
  assert.deepEqual(first.stdlib, { path: "stdlib", version: "v1.26.8" });
  assert.ok(first.dependencies.some((entry) => entry.path === "example.test/replacement" && entry.version === "v2.0.0"));
  assert.ok(!first.dependencies.some((entry) => entry.path === "example.test/module-1"));
});

test("self report and SBOM must contain the complete compiled Go inventory", () => {
  const buildInventory = { stdlib: { path: "stdlib", version: "v1.26.8" }, main: { path: "github.com/aquasecurity/trivy", version: null },
    dependencies: [{ path: "example.test/dependency", version: "v1.2.3" }] };
  const packages = [{ Name: "stdlib", Version: "v1.26.8" }, { Name: "github.com/aquasecurity/trivy", Version: "" }, { Name: "example.test/dependency", Version: "v1.2.3" }];
  const report = { SchemaVersion: 2, ArtifactName: "subject", ArtifactType: "filesystem", Trivy: { Version: "0.74.0-autoworld.2" }, Results: [{ Target: "subject", Type: "gobinary", Class: "lang-pkgs", Packages: packages }] };
  const properties = [{ name: "aquasecurity:trivy:Type", value: "gobinary" }, { name: "aquasecurity:trivy:Class", value: "lang-pkgs" }];
  const sbom = { bomFormat: "CycloneDX", metadata: { component: { type: "application", name: "subject" } }, components: [
    { type: "application", name: "subject", properties }, ...packages.map((entry) => ({
      type: "library", name: entry.Name, version: entry.Version, properties: [{ name: "aquasecurity:trivy:PkgType", value: "gobinary" }],
    })),
  ] };
  assert.equal(validateSelfReport(report, sbom, buildInventory).packages.length, 3);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const missingReport = clone(report); missingReport.Results[0].Packages.pop();
  assert.throws(() => validateSelfReport(missingReport, sbom, buildInventory), /scanner_self_inventory_missing/u);
  const substitutedReport = clone(report); substitutedReport.Results[0].Packages[2].Version = "v9.9.9";
  assert.throws(() => validateSelfReport(substitutedReport, sbom, buildInventory), /scanner_self_inventory_missing/u);
  const missingSbom = clone(sbom); missingSbom.components.pop();
  assert.throws(() => validateSelfReport(report, missingSbom, buildInventory), /scanner_sbom_inventory_mismatch/u);
  const substitutedSbom = clone(sbom); substitutedSbom.components[3].version = "v9.9.9";
  assert.throws(() => validateSelfReport(report, substitutedSbom, buildInventory), /scanner_sbom_inventory_mismatch/u);
  report.Results[0].Vulnerabilities = [{ VulnerabilityID: "CVE-X", PkgName: "github.com/aquasecurity/trivy", InstalledVersion: "v0.74.0", Severity: "HIGH" }];
  assert.throws(() => validateSelfReport(report, sbom, buildInventory), /scanner_self_audit_blocked/u);
});
