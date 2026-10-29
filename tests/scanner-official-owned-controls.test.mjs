import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OWNED_SCANNER,
  OwnedQualificationLifecycle,
  canonicalOwnedJson,
  createSharedBudgetController,
  parseOwnedGoBuildInfo,
  validateDiagnosticReceipt,
  validateLegacyBaselineConservation,
  validateOfficialNegativeControl,
  validateOwnedBuildInfo,
  validateOwnedBuilderAudit,
  validateOwnedControlSet,
  validateOwnedPublicEvidenceDirectory,
  validateOwnedQualificationProof,
  validateReproduciblePair,
  validateSameDatabaseComparison,
  validateSelfAuditSet,
} from "../scripts/scanner/owned-controls.mjs";
import { parseOfficialGoBuildInfo } from "../scripts/scanner/official-build-info.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (character) => character.repeat(64);
const h1 = (character) => `h1:${character.repeat(43)}=`;

function modules() {
  return Array.from({ length: 110 }, (_, index) => ({
    path: index === 0 ? OWNED_SCANNER.goJosePath : `example.com/dependency/module${index}`,
    version: index === 0 ? OWNED_SCANNER.goJoseVersion : `v1.0.${index}`,
    sum: index === 0 ? OWNED_SCANNER.goJoseSum : h1(String.fromCharCode(65 + index % 26)),
    goModSum: index === 0 ? OWNED_SCANNER.goJoseGoModSum : h1(String.fromCharCode(97 + index % 26)),
    compiled: true,
  })).sort((left, right) => `${left.path}@${left.version}`.localeCompare(`${right.path}@${right.version}`, "en"));
}

function closure(items = modules()) {
  const materials = items.map((item, index) => ({ path: item.path, version: item.version,
    zip: { bytes: index + 10, sha256: hash("1") }, mod: { bytes: index + 20, sha256: hash("2") }, info: { bytes: index + 30, sha256: hash("3") } }));
  return { sha256: createHash("sha256").update(`${canonicalOwnedJson({ modules: items, materials })}\n`).digest("hex"), modules: items, materials };
}

function rawBuildInfo(items = modules()) {
  return [
    "/out/trivy: go1.27.3",
    `\tpath\t${OWNED_SCANNER.commandPath}`,
    `\tmod\t${OWNED_SCANNER.mainPath}\t(devel)`,
    ...items.map((item) => `\tdep\t${item.path}\t${item.version}\t${item.sum}`),
    "\tbuild\t-buildmode=exe",
    "\tbuild\t-compiler=gc",
    "\tbuild\t-trimpath=true",
    "\tbuild\tCGO_ENABLED=0",
    "\tbuild\tGOARCH=amd64",
    "\tbuild\tGOOS=linux",
    "\tbuild\tGOAMD64=v1",
  ].join("\n") + "\n";
}

function run() {
  return { workflow: "data-foundation-audit", runId: "123456", runAttempt: 1, sourceSha: "a".repeat(40) };
}

function source() {
  return { repository: OWNED_SCANNER.sourceRepository, commit: OWNED_SCANNER.sourceCommit, tree: OWNED_SCANNER.sourceTree,
    patchSha256: OWNED_SCANNER.patchSha256, goModSha256: OWNED_SCANNER.goModSha256, goSumSha256: OWNED_SCANNER.goSumSha256 };
}

function receipt(construction) {
  const items = modules();
  return {
    schemaVersion: 1,
    receiptKind: OWNED_SCANNER.receiptKind,
    state: "BUILD_DIAGNOSTIC",
    construction,
    run: run(),
    source: source(),
    compiler: { delivery: construction === "A" ? "BUILDER_IMAGE" : "OFFICIAL_ARCHIVE", goVersion: "go1.27.3", goos: "linux", goarch: "amd64", cgoEnabled: false,
      identity: construction === "A"
        ? { kind: "OCI_PLATFORM", reference: OWNED_SCANNER.builderReference, indexDigest: OWNED_SCANNER.builderIndexDigest, platformDigest: OWNED_SCANNER.builderPlatformDigest }
        : { kind: "GO_ARCHIVE", url: OWNED_SCANNER.goArchiveUrl, bytes: OWNED_SCANNER.goArchiveBytes, sha256: OWNED_SCANNER.goArchiveSha256 } },
    binary: { path: "/out/trivy", bytes: 123_456_789, sha256: hash("e") },
    build: { commandPath: OWNED_SCANNER.commandPath, appVersion: "0.76.1",
      flags: ["-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid= -extldflags=-static -X github.com/aquasecurity/trivy/pkg/version/app.ver=0.76.1"],
      rawBuildInfo: rawBuildInfo(items) },
    closure: closure(items),
    journal: [{ stage: "build", status: "ATTEMPTED", monotonicMs: 1 }, { stage: "build", status: "PASSED", monotonicMs: 2 }],
  };
}

test("owned build info preserves the honest devel main and has no VCS claims", () => {
  const parsed = parseOwnedGoBuildInfo(Buffer.from(rawBuildInfo(), "utf8"));
  assert.deepEqual(parsed.main, { path: OWNED_SCANNER.mainPath, version: "(devel)", sum: "" });
  assert.equal(Object.keys(parsed.settings).some((key) => key.startsWith("vcs")), false);
  assert.equal(parsed.dependencies.find((item) => item.path === OWNED_SCANNER.goJosePath)?.version, "v4.1.6");
});

test("the unchanged official profile rejects the owned devel identity", () => {
  assert.throws(() => parseOfficialGoBuildInfo(Buffer.from(rawBuildInfo())), /scanner_official_go_build_info_invalid/u);
});

test("owned build info rejects fabricated official main and VCS provenance", () => {
  for (const changed of [
    rawBuildInfo().replace("(devel)", "v0.76.1+dirty"),
    rawBuildInfo().replace("\tbuild\tGOOS=linux", `\tbuild\tvcs.revision=${OWNED_SCANNER.sourceCommit}\n\tbuild\tGOOS=linux`),
    rawBuildInfo().replace("\tbuild\t-trimpath=true", '\tbuild\t-ldflags="-s -w"\n\tbuild\t-trimpath=true'),
  ]) assert.throws(() => parseOwnedGoBuildInfo(Buffer.from(changed)), /scanner_owned_build_info_invalid/u);
});

test("compiled build info is exactly a subset marked by the complete closure", () => {
  const frozen = closure();
  assert.equal(validateOwnedBuildInfo(Buffer.from(rawBuildInfo()), frozen).dependencies.length, frozen.modules.length);
  frozen.modules[4].compiled = false;
  frozen.sha256 = createHash("sha256").update(`${canonicalOwnedJson({ modules: frozen.modules, materials: frozen.materials })}\n`).digest("hex");
  assert.throws(() => validateOwnedBuildInfo(Buffer.from(rawBuildInfo()), frozen), /scanner_owned_compiled_closure_mismatch/u);
});

test("diagnostic receipts enforce producer, compiler delivery and fixed application version", () => {
  assert.equal(validateDiagnosticReceipt(receipt("A")).construction, "A");
  const cases = [
    (value) => { value.receiptKind = "aqua-trivy"; },
    (value) => { value.build.appVersion = "0.76.1-autoworld.1"; },
    (value) => { value.compiler.delivery = "OFFICIAL_ARCHIVE"; },
    (value) => { value.compiler.identity.platformDigest = `sha256:${hash("9")}`; },
    (value) => { value.source.goModSha256 = hash("9"); },
    (value) => { value.run.sourceSha = hash("9"); },
    (value) => { value.closure.modules[0].version = "v4.1.5"; },
    (value) => { value.closure.materials[0].zip.bytes += 1; },
    (value) => { value.build.rawBuildInfo = value.build.rawBuildInfo.replace("(devel)", "v0.76.1"); },
    (value) => { value.build.rawBuildInfo = value.build.rawBuildInfo.replace("-trimpath=true", "-trimpath=false"); },
  ];
  for (const mutate of cases) {
    const value = receipt("A");
    mutate(value);
    assert.throws(() => validateDiagnosticReceipt(value), /scanner_owned_/u);
  }
});

test("canonical owned JSON preserves finite Trivy decimal scores", () => {
  assert.equal(canonicalOwnedJson({ score: 7.5, vector: "CVSS:3.1" }), '{"score":7.5,"vector":"CVSS:3.1"}');
  assert.throws(() => canonicalOwnedJson({ score: Number.NaN }), /scanner_owned_canonical_value_invalid/u);
});

test("reproducibility requires A/B byte, raw identity, closure and run equality", () => {
  assert.equal(validateReproduciblePair(receipt("A"), receipt("B")).state, "IDENTITY_REPRODUCIBLE");
  for (const mutate of [
    (value) => { value.binary.sha256 = hash("1"); },
    (value) => { value.run.runAttempt = 2; },
    (value) => { value.build.rawBuildInfo = value.build.rawBuildInfo.replace("-compiler=gc", "-compiler=gccgo"); },
    (value) => { value.closure.sha256 = hash("2"); },
  ]) {
    const right = receipt("B");
    mutate(right);
    assert.throws(() => validateReproduciblePair(receipt("A"), right), /scanner_owned_/u);
  }
});

function selfReport({ severity = "LOW", version = "0.76.1" } = {}) {
  const dependencies = modules().map((item) => ({ Name: item.path, Version: item.version, Identifier: { PURL: `pkg:golang/${item.path}@${item.version}` } }));
  dependencies.unshift({ Name: "stdlib", Version: "v1.27.3", Identifier: { PURL: "pkg:golang/stdlib@v1.27.3" } });
  const main = { Name: OWNED_SCANNER.mainPath, Identifier: { PURL: `pkg:golang/${OWNED_SCANNER.mainPath}` } };
  return { SchemaVersion: 2, ArtifactName: "/subject", ArtifactType: "filesystem", Trivy: { Version: version }, Results: [{ Target: "trivy", Class: "lang-pkgs", Type: "gobinary",
    Packages: [main, ...dependencies], Vulnerabilities: severity === null ? [] : [{ VulnerabilityID: "CVE-TEST", PkgName: dependencies[1].Name,
      InstalledVersion: dependencies[1].Version, Severity: severity, PkgIdentifier: dependencies[1].Identifier }] }] };
}

function selfSbom(report) {
  const application = { type: "application", name: report.Results[0].Target, "bom-ref": "application" };
  const libraries = report.Results[0].Packages.map((item, index) => ({ type: "library", name: item.Name,
    ...(item.Version ? { version: item.Version } : {}), purl: item.Identifier.PURL, "bom-ref": `library-${index}` }));
  const components = [application, ...libraries];
  return { bomFormat: "CycloneDX", metadata: { component: { type: "application", name: report.ArtifactName, "bom-ref": "root" } }, components,
    dependencies: [{ ref: "root", dependsOn: ["application"] }, ...components.map((item) => ({ ref: item["bom-ref"], dependsOn: [] }))] };
}

function pair() { return validateReproduciblePair(receipt("A"), receipt("B")); }
const databaseJoin = () => ({ vulnerabilityDbSha256: hash("3"), javaDbSha256: hash("4") });

test("four self/cross-self scans conserve JSON and CycloneDX inventory", () => {
  const report = selfReport({ severity: null });
  const reports = Object.fromEntries(["aOnA", "aOnB", "bOnA", "bOnB"].map((name) => [name, clone(report)]));
  const sboms = Object.fromEntries(Object.entries(reports).map(([name, value]) => [name, selfSbom(value)]));
  const pairProof = pair();
  assert.equal(validateSelfAuditSet({ reports, sboms, databaseJoin: databaseJoin(), pair: pairProof }).state, "SELF_AUDITED");
  assert.throws(() => validateSelfAuditSet({ reports, sboms, databaseJoin: databaseJoin(), pair: clone(pairProof) }), /scanner_owned_self_set_invalid/u);
  sboms.bOnB.components.pop();
  assert.throws(() => validateSelfAuditSet({ reports, sboms, databaseJoin: databaseJoin(), pair: pair() }), /scanner_owned_sbom_inventory_mismatch/u);
});

test("self inventory binds names and versions to PURLs and keeps the directory distinct from its binary", () => {
  for (const mutation of [
    (reports) => { reports.aOnA.Results[0].Packages[0].Name = "example.com/forged"; },
    (_reports, sboms) => { sboms.aOnA.metadata.component.name = "/other-subject"; },
    (_reports, sboms) => { sboms.aOnA.components[0].name = "/subject"; },
    (_reports, sboms) => { sboms.aOnA.components[1].name = "example.com/forged"; },
  ]) {
    const reports = Object.fromEntries(["aOnA", "aOnB", "bOnA", "bOnB"].map((name) => [name, selfReport({ severity: null })]));
    const sboms = Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, selfSbom(report)]));
    mutation(reports, sboms);
    assert.throws(() => validateSelfAuditSet({ reports, sboms, databaseJoin: databaseJoin(), pair: pair() }), /scanner_owned_/u);
  }
});

test("self audit blocks HIGH and CRITICAL findings and any main-module finding", () => {
  for (const severity of ["HIGH", "CRITICAL"]) {
    const report = selfReport({ severity });
    const reports = Object.fromEntries(["aOnA", "aOnB", "bOnA", "bOnB"].map((name) => [name, clone(report)]));
    const sboms = Object.fromEntries(Object.entries(reports).map(([name, value]) => [name, selfSbom(value)]));
    assert.throws(() => validateSelfAuditSet({ reports, sboms, databaseJoin: databaseJoin(), pair: pair() }), /scanner_owned_self_audit_blocked/u);
  }
  const report = selfReport();
  report.Results[0].Vulnerabilities[0].PkgName = OWNED_SCANNER.mainPath;
  report.Results[0].Vulnerabilities[0].PkgIdentifier = { PURL: `pkg:golang/${OWNED_SCANNER.mainPath}` };
  const reports = Object.fromEntries(["aOnA", "aOnB", "bOnA", "bOnB"].map((name) => [name, clone(report)]));
  const sboms = Object.fromEntries(Object.entries(reports).map(([name, value]) => [name, selfSbom(value)]));
  assert.throws(() => validateSelfAuditSet({ reports, sboms, databaseJoin: databaseJoin(), pair: pair() }), /scanner_owned_unversioned_main_finding_blocked/u);
});

function controlReport() {
  return { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, Results: [{ Target: "fixture", Type: "gomod", Packages: [
    { Name: "example.com/app", Version: "v1.0.0", Identifier: { PURL: "pkg:golang/example.com/app@v1.0.0" } },
  ], Vulnerabilities: [{ VulnerabilityID: "CVE-ONE", PkgName: "example.com/app", InstalledVersion: "v1.0.0", FixedVersion: "v1.0.1",
    Severity: "HIGH", PkgIdentifier: { PURL: "pkg:golang/example.com/app@v1.0.0" } }] }] };
}

test("same-database comparison conserves exact package PURLs and findings", () => {
  assert.equal(validateSameDatabaseComparison({ owned: controlReport(), official: controlReport(), databaseJoin: databaseJoin(), controlName: "go-vulnerable" }).findings.length, 1);
  const changed = controlReport();
  changed.Results[0].Packages[0].Identifier.PURL += "-changed";
  assert.throws(() => validateSameDatabaseComparison({ owned: changed, official: controlReport(), databaseJoin: databaseJoin(), controlName: "go-vulnerable" }),
    /scanner_owned_detection_conservation_failed/u);
  const downgraded = controlReport();
  downgraded.Results[0].Vulnerabilities[0].Severity = "MEDIUM";
  assert.throws(() => validateSameDatabaseComparison({ owned: downgraded, official: controlReport(), databaseJoin: databaseJoin(), controlName: "go-vulnerable" }),
    /scanner_owned_detection_conservation_failed/u);
});

test("official negative control requires the exact rejected go-jose finding", () => {
  const report = controlReport();
  report.Results[0].Packages[0] = { Name: OWNED_SCANNER.goJosePath, Version: "v4.1.5", Identifier: { PURL: `pkg:golang/${OWNED_SCANNER.goJosePath}@v4.1.5` } };
  report.Results[0].Vulnerabilities[0] = { VulnerabilityID: "CVE-2026-116587", PkgName: OWNED_SCANNER.goJosePath, InstalledVersion: "v4.1.5",
    FixedVersion: "4.1.6", Severity: "HIGH", PkgIdentifier: report.Results[0].Packages[0].Identifier };
  assert.equal(validateOfficialNegativeControl(report).state, "OFFICIAL_REFERENCE_REJECTED");
  report.Results[0].Vulnerabilities[0].InstalledVersion = "v4.1.6";
  assert.throws(() => validateOfficialNegativeControl(report), /scanner_owned_official_negative_control_invalid/u);
});

function selfProof(pairProof = pair()) {
  const report = selfReport({ severity: null });
  const reports = Object.fromEntries(["aOnA", "aOnB", "bOnA", "bOnB"].map((name) => [name, clone(report)]));
  const sboms = Object.fromEntries(Object.entries(reports).map(([name, value]) => [name, selfSbom(value)]));
  return validateSelfAuditSet({ reports, sboms, databaseJoin: databaseJoin(), pair: pairProof });
}

function negativeProof() {
  const report = controlReport();
  report.Results[0].Packages[0] = { Name: OWNED_SCANNER.goJosePath, Version: "v4.1.5", Identifier: { PURL: `pkg:golang/${OWNED_SCANNER.goJosePath}@v4.1.5` } };
  report.Results[0].Vulnerabilities[0] = { VulnerabilityID: "CVE-2026-116587", PkgName: OWNED_SCANNER.goJosePath, InstalledVersion: "v4.1.5",
    FixedVersion: "4.1.6", Severity: "HIGH", PkgIdentifier: report.Results[0].Packages[0].Identifier };
  return validateOfficialNegativeControl(report);
}

function legacyInventory() {
  return { packages: [JSON.stringify(["fixture", "gomod", "example.com/app", "v1.0.0"])],
    findings: [JSON.stringify(["fixture", "CVE-ONE", "example.com/app", "v1.0.0", "v1.0.1"])] };
}

function controlSetProof(pairProof) {
  const comparisons = ["version-probe", "fixture-gomod-vulnerable", "fixture-java-war-vulnerable", "fixture-java-jar-clean-candidate",
    "cargo-lock-vulnerable", "cargo-lock-clean"].map((controlName) => validateSameDatabaseComparison({
    owned: controlReport(), official: controlReport(), databaseJoin: databaseJoin(), controlName,
  }));
  const legacyBaselines = ["fixture-gomod-vulnerable", "fixture-java-war-vulnerable"].map((controlName) =>
    validateLegacyBaselineConservation({ controlName, observed: legacyInventory(), baseline: legacyInventory() }));
  return validateOwnedControlSet({ run: pairProof.run, binary: pairProof.binary, databaseJoin: databaseJoin(), comparisons,
    officialNegative: negativeProof(), legacyBaselines });
}

function builderProof(pairProof) {
  const now = new Date("2026-10-28T12:00:00.000Z");
  const subject = { role: "go-builder", repository: "library/golang", version: "1.27.3-alpine3.24", manifestDigest: OWNED_SCANNER.builderIndexDigest,
    platform: { os: "linux", architecture: "amd64", variant: null, digest: OWNED_SCANNER.builderPlatformDigest } };
  const artifactName = `${subject.repository}@${subject.platform.digest}`;
  const report = { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, CreatedAt: now.toISOString(), ArtifactType: "container_image", ArtifactName: artifactName,
    Metadata: { ImageConfig: { os: "linux", architecture: "amd64" } }, Results: [{ Target: "alpine", Class: "os-pkgs", Type: "alpine",
      Packages: [{ Name: "busybox", Version: "1.0.0", Identifier: { PURL: "pkg:apk/alpine/busybox@1.0.0" } }], Vulnerabilities: [] }] };
  const sbom = { bomFormat: "CycloneDX", metadata: { component: { type: "container", name: artifactName } },
    components: [{ type: "library", name: "busybox", version: "1.0.0", purl: "pkg:apk/alpine/busybox@1.0.0" }] };
  return validateOwnedBuilderAudit({ run: pairProof.run, binary: pairProof.binary, databaseJoin: databaseJoin(), subject, report, sbom,
    inventory: { packageCount: 1, applicationCount: 0, operatingSystemCount: 0 }, now });
}

const cleanupProof = () => ({ constructionResourcesAbsent: true, duplicateBAbsent: true, candidateARetained: true });

test("qualification lifecycle is ordered and preserves first failure forever", () => {
  const lifecycle = new OwnedQualificationLifecycle({ run: run(), source: source(), binary: receipt("A").binary, databaseJoin: databaseJoin() });
  assert.throws(() => lifecycle.advance("BUILD_DIAGNOSTIC", "SELF_AUDITED", { proof: { state: "SELF_AUDITED" } }), /scanner_owned_lifecycle_transition_invalid/u);
  lifecycle.advance("BUILD_DIAGNOSTIC", "IDENTITY_REPRODUCIBLE", { proof: pair() });
  lifecycle.fail("first_failure");
  lifecycle.fail("second_failure");
  lifecycle.recordCleanup(cleanupProof());
  assert.equal(lifecycle.snapshot().firstFailure, "first_failure");
  assert.throws(() => lifecycle.receipt(), /scanner_owned_qualification_unavailable/u);
});

test("qualification requires validator-issued proofs, exact controls, builder policy and construction cleanup", () => {
  const pairResult = pair(), self = selfProof(pairResult), controls = controlSetProof(pairResult), builder = builderProof(pairResult);
  const cleanup = cleanupProof();
  const lifecycle = new OwnedQualificationLifecycle({ run: pairResult.run, source: pairResult.source, binary: pairResult.binary, databaseJoin: databaseJoin() });
  for (const [current, next, proof] of [
    ["BUILD_DIAGNOSTIC", "IDENTITY_REPRODUCIBLE", pairResult], ["IDENTITY_REPRODUCIBLE", "SELF_AUDITED", self],
    ["SELF_AUDITED", "CONTROLS_PASSED", controls], ["CONTROLS_PASSED", "BUILDER_AUDITED", builder],
  ]) {
    assert.throws(() => lifecycle.advance(current, next, { proof: clone(proof) }), /scanner_owned_lifecycle_binding_invalid/u);
    lifecycle.advance(current, next, { proof });
  }
  lifecycle.recordCleanup(cleanup);
  const finalProof = validateOwnedQualificationProof({ pair: pairResult, self, controls, builder, cleanup });
  assert.throws(() => lifecycle.advance("BUILDER_AUDITED", "QUALIFIED_FOR_THIS_JOB", { proof: clone(finalProof) }), /scanner_owned_lifecycle_binding_invalid/u);
  lifecycle.advance("BUILDER_AUDITED", "QUALIFIED_FOR_THIS_JOB", { proof: finalProof });
  const qualified = lifecycle.receipt();
  assert.equal(qualified.mainVersionLookup, "UNAVAILABLE");
  assert.equal(qualified.sourceBinding, "SOURCE_BOUND_UNVERSIONED_MAIN");
});

test("control aggregation refuses missing names, unbranded placeholders and legacy baseline loss", () => {
  const pairResult = pair();
  assert.throws(() => validateOwnedControlSet({ run: pairResult.run, binary: pairResult.binary, databaseJoin: databaseJoin(),
    comparisons: Array.from({ length: 6 }, () => ({ controlName: "version-probe" })), officialNegative: negativeProof(), legacyBaselines: [] }),
  /scanner_owned_control_set_invalid/u);
  const baseline = legacyInventory(), observed = legacyInventory();
  observed.findings = [];
  assert.throws(() => validateLegacyBaselineConservation({ controlName: "fixture-gomod-vulnerable", observed, baseline }),
    /scanner_owned_legacy_baseline_loss/u);
});

test("shared budget clips commands to phase, lane and global cleanup reserve", () => {
  let current = 0;
  const budget = createSharedBudgetController({ now: () => current, totalMs: 1_000, cleanupReserveMs: 100, ownedCapMs: 500, downstreamCapMs: 700 });
  assert.deepEqual(budget.startStage("owned:build", 800), { timeoutMs: 500, startedMonotonicMs: 0 });
  current = 100;
  assert.equal(budget.commandTimeoutMs(450), 400);
  current = 500;
  budget.finishStage("owned:build", "PASSED");
  assert.throws(() => budget.startStage("owned:second", 1), /scanner_owned_time_budget_refused/u);
  assert.equal(budget.startStage("downstream:audit", 900).timeoutMs, 400);
  current = 650;
  budget.finishStage("downstream:audit", "FAILED");
  assert.equal(budget.snapshot().firstFailure, "scanner_owned_stage_failed:downstream:audit");
  assert.equal(budget.beginCleanup().timeoutMs, 100);
  assert.throws(() => budget.startStage("downstream:late", 1), /scanner_owned_time_budget_refused/u);
});

test("shared budget rejects regressing clocks and refuses before consuming cleanup reserve", () => {
  let current = 10;
  const budget = createSharedBudgetController({ now: () => current, totalMs: 100, cleanupReserveMs: 20, ownedCapMs: 80, downstreamCapMs: 80 });
  current = 91;
  assert.throws(() => budget.startStage("owned:late", 1), /scanner_owned_time_budget_refused/u);
  current = 9;
  assert.throws(() => budget.remainingMs(), /scanner_owned_time_budget_refused/u);
});

test("an overdue phase becomes the first failure and immediately enters refusal", () => {
  let current = 0;
  const budget = createSharedBudgetController({ now: () => current, totalMs: 1_000, cleanupReserveMs: 100, ownedCapMs: 800, downstreamCapMs: 800 });
  budget.startStage("owned:tests", 50);
  current = 51;
  assert.equal(budget.cleanupCommandTimeoutMs(500), 100);
  assert.throws(() => budget.finishStage("owned:tests", "PASSED"), /scanner_owned_time_budget_refused/u);
  assert.equal(budget.snapshot().firstFailure, "scanner_owned_time_budget_refused");
  assert.throws(() => budget.startStage("downstream:audit", 1), /scanner_owned_time_budget_refused/u);
  assert.equal(budget.beginCleanup().timeoutMs, 100);
});

test("public evidence validates canonical JSON, run join, hashes and closed regular files", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-owned-evidence-"));
  try {
    const bytes = Buffer.from('{"a":1,"z":2}\n', "utf8");
    writeFileSync(path.join(directory, "receipt.json"), bytes);
    const manifest = { schemaVersion: 1, kind: "OWNED_SCANNER_PUBLIC_EVIDENCE_V1", run: run(), files: [{ path: "receipt.json", bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "application/json" }] };
    const manifestBytes = Buffer.from(`${canonicalOwnedJson(manifest)}\n`);
    writeFileSync(path.join(directory, "public-manifest.json"), manifestBytes);
    assert.equal((await validateOwnedPublicEvidenceDirectory(directory, manifest, run())).totalBytes, bytes.length + manifestBytes.length);
    const changedRun = run();
    changedRun.runAttempt = 2;
    await assert.rejects(validateOwnedPublicEvidenceDirectory(directory, manifest, changedRun), /scanner_owned_public_evidence_join_invalid/u);
    writeFileSync(path.join(directory, "receipt.json"), Buffer.from('{"z":2,"a":1}\n'));
    manifest.files[0].bytes = 14;
    manifest.files[0].sha256 = createHash("sha256").update(Buffer.from('{"z":2,"a":1}\n')).digest("hex");
    writeFileSync(path.join(directory, "public-manifest.json"), Buffer.from(`${canonicalOwnedJson(manifest)}\n`));
    await assert.rejects(validateOwnedPublicEvidenceDirectory(directory, manifest, run()), /scanner_owned_public_evidence_noncanonical/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("public evidence rejects traversal and case-fold collisions before reading", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-owned-evidence-"));
  try {
    const descriptor = { path: "one.json", bytes: 3, sha256: hash("a"), mediaType: "application/json" };
    const manifest = { schemaVersion: 1, kind: "OWNED_SCANNER_PUBLIC_EVIDENCE_V1", run: run(), files: [descriptor, { ...descriptor, path: "ONE.JSON" }] };
    writeFileSync(path.join(directory, "public-manifest.json"), Buffer.from(`${canonicalOwnedJson(manifest)}\n`));
    await assert.rejects(validateOwnedPublicEvidenceDirectory(directory, manifest, run()), /scanner_owned_public_evidence_invalid/u);
    manifest.files = [{ ...descriptor, path: "../one.json" }];
    await assert.rejects(validateOwnedPublicEvidenceDirectory(directory, manifest, run()), /scanner_owned_public_evidence_invalid/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("public evidence rejects an undeclared regular file", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-owned-evidence-"));
  try {
    const bytes = Buffer.from('{"ok":true}\n');
    writeFileSync(path.join(directory, "receipt.json"), bytes);
    writeFileSync(path.join(directory, "unexpected.txt"), "not declared\n");
    const manifest = { schemaVersion: 1, kind: "OWNED_SCANNER_PUBLIC_EVIDENCE_V1", run: run(), files: [{ path: "receipt.json", bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "application/json" }] };
    writeFileSync(path.join(directory, "public-manifest.json"), Buffer.from(`${canonicalOwnedJson(manifest)}\n`));
    await assert.rejects(validateOwnedPublicEvidenceDirectory(directory, manifest, run()), /scanner_owned_public_evidence_undeclared_file/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("public evidence accepts an in-memory manifest when no manifest file is exported", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "aw-owned-evidence-"));
  try {
    const bytes = Buffer.from('{"score":7.5}\n');
    writeFileSync(path.join(directory, "report.json"), bytes);
    const manifest = { schemaVersion: 1, kind: "OWNED_SCANNER_PUBLIC_EVIDENCE_V1", run: run(), files: [{ path: "report.json", bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "application/json" }] };
    assert.equal((await validateOwnedPublicEvidenceDirectory(directory, manifest, run())).totalBytes, bytes.length);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
