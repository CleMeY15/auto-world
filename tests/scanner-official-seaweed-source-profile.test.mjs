import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateArchiveImageReport } from "../scripts/scanner/official-controls.mjs";
import {
  bindManagedSeaweedSourceEvidence,
  evaluateManagedSeaweedArchiveReport,
  managedSeaweedHashArguments,
} from "../scripts/scanner/seaweed-source-profile.mjs";

const fixtureUrl = (name) => new URL(`fixtures/scanner-official/managed-seaweed-source/${name}`, import.meta.url);
const fixture = (name) => readFileSync(fixtureUrl(name));
const jsonFixture = (name) => JSON.parse(fixture(name).toString("utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const now = new Date("2026-11-09T14:00:00Z");
const candidate = "7596c85c80dfdf59177e1b51c443c5f74d82852f23cb87d3378d142c42f27179";
const inherited = "sha256:14d28a8561c0323bfa76edd6bca302081ac63d3b0cb7ef45955a69e729ce0f06";
const materialNames = Object.freeze([
  "source-sha256.txt", "original-module-sha256.txt", "corrected-module-sha256.txt", "go.mod", "go.sum",
  "module-verify.txt", "compiler-version.txt", "module-inventory.json", "build-info.txt", "binary-sha256.txt",
]);
const subject = Object.freeze({
  kind: "LOCAL_MANAGED_IMAGE_V1",
  imageId: "sha256:cc1fb4c602837eeef50c4ff3ec183eb4097076da8c91423039ec4863556a1bff",
  os: "linux",
  architecture: "amd64",
  archiveSha256: "1ee7e3cb0c73207c295110c000bc8fa0710efa97e1e9986d18775dc361ae0b48",
  archiveBytes: 755001856,
  archiveCapBytes: 2 * 1024 ** 3,
  artifactName: "/managed-image-seaweedfs.tar",
});

function materialView(changes = {}) {
  const files = new Map(materialNames.map((name) => [name, fixture(name)]));
  for (const [name, bytes] of Object.entries(changes)) files.set(name, bytes);
  return Object.freeze({
    list: () => [...files.keys()],
    has: (name) => files.has(name),
    read: (name, maxBytes) => {
      const bytes = files.get(name);
      if (!Buffer.isBuffer(bytes) || bytes.length > maxBytes) throw new Error("fixture_view_invalid");
      return Buffer.from(bytes);
    },
  });
}

function proof(overrides = {}) {
  return {
    view: materialView(),
    baseInspection: fixture("managed-seaweedfs-base-inspect.json"),
    finalInspection: fixture("managed-seaweedfs-inspect.json"),
    finalInventory: Buffer.from(`${candidate}  /usr/bin/weed\n`),
    ...overrides,
  };
}

function bound(overrides = {}) {
  return bindManagedSeaweedSourceEvidence(subject, proof(overrides));
}

function reportAndSbom() {
  return { report: jsonFixture("image-seaweedfs.json"), sbom: jsonFixture("image-seaweedfs.cdx.json") };
}

function evaluate(report, sbom, evidence = bound(), at = now) {
  return evaluateManagedSeaweedArchiveReport(report, sbom, subject, evidence, at);
}

function goResult(report) {
  return report.Results.find((entry) => entry.Type === "gobinary");
}

function mainPackage(report) {
  return goResult(report).Packages.find((entry) => entry.ID === "github.com/seaweedfs/seaweedfs");
}

function mainComponent(sbom) {
  return sbom.components.find((entry) => entry.purl === "pkg:golang/github.com/seaweedfs/seaweedfs");
}

function formatVersion(pkg) {
  return `${pkg.Epoch ? `${pkg.Epoch}:` : ""}${pkg.Version}${pkg.Release ? `-${pkg.Release}` : ""}`;
}

function assertDeepFrozen(value) {
  if (value && typeof value === "object") {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertDeepFrozen(child);
  }
}

test("canonical source inventories retain their reviewed bytes and SHA-256", () => {
  for (const expected of [
    ["../scripts/scanner/seaweed-source-packages.json", 90964, "d831ecc18c448d5e9a67de71017d45155d2e555de1fb81afd0ef4e594b41e4fb", 245],
    ["../scripts/scanner/seaweed-source-sbom.json", 119199, "de271a4e0cc7291b8496ec71f6610f2c72c8d3765731640ad5f62621bc3e251c", 245],
  ]) {
    const original = readFileSync(new URL(expected[0], import.meta.url));
    const bytes = Buffer.from(original.toString("utf8").replaceAll("\r\n", "\n"));
    assert.equal(bytes.length, expected[1]);
    assert.equal(hash(bytes), expected[2]);
    assert.equal(JSON.parse(bytes).length, expected[3]);
    assert.equal(bytes.includes(0x0d), false);
  }
});

test("exact source, build, inspection and visible binary proofs bind to one immutable subject", () => {
  const inputs = proof();
  const before = Object.fromEntries(materialNames.map((name) => [name, hash(fixture(name))]));
  const evidence = bindManagedSeaweedSourceEvidence(subject, inputs);
  assertDeepFrozen(evidence);
  assert.equal(evidence.kind, "SOURCE_BOUND_SEAWEED_V1");
  assert.equal(evidence.finalSha256, candidate);
  assert.equal(evidence.layers.overlayIndex, 10);
  assert.equal(evidence.layers.inheritedDiffID, inherited);
  assert.deepEqual(evidence.inspections.base, { bytes: inputs.baseInspection.length, sha256: hash(inputs.baseInspection) });
  assert.deepEqual(evidence.inspections.final, { bytes: inputs.finalInspection.length, sha256: hash(inputs.finalInspection) });
  assert.equal(evidence.subject.archiveSha256, subject.archiveSha256);
  assert.equal(hash(inputs.baseInspection), hash(fixture("managed-seaweedfs-base-inspect.json")));
  assert.equal(hash(inputs.finalInspection), hash(fixture("managed-seaweedfs-inspect.json")));
  assert.equal(hash(inputs.finalInventory), hash(Buffer.from(`${candidate}  /usr/bin/weed\n`)));
  assert.deepEqual(Object.fromEntries(materialNames.map((name) => [name, hash(fixture(name))])), before);
});

test("the exact report projects only the unversioned main while preserving raw inputs", () => {
  const { report, sbom } = reportAndSbom();
  const reportBefore = JSON.stringify(report), sbomBefore = JSON.stringify(sbom);
  assert.throws(() => evaluateArchiveImageReport(report, subject, now), /scanner_image_report_invalid/u);
  const result = evaluate(report, sbom);
  assert.equal(JSON.stringify(report), reportBefore);
  assert.equal(JSON.stringify(sbom), sbomBefore);
  assert.deepEqual({ raw: result.rawPackageCount, versioned: result.versionedPackageCount, sourceBound: result.sourceBoundPackageCount },
    { raw: 274, versioned: 273, sourceBound: 1 });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.sourceComponents.length, 1);
  assert.deepEqual(result.sourceComponents[0], {
    profile: "SOURCE_BOUND_SEAWEED_V1", target: "usr/bin/weed", name: "github.com/seaweedfs/seaweedfs", version: null,
    sourceCommit: "ffa87c25fdf587178b1521ad87f2a4a72a02e584", sourceArchiveBytes: 81881370,
    sourceArchiveSha256: "d650e7a8a2cbec8a1725386f87f5eb803c95aa84417530aec58c1925fd23a2c9",
    originalGoModSha256: "4980945b680fa12c0457f0aa909926401860d66e816eccc6f8508c71a5290ee8",
    originalGoSumSha256: "78c8b44110c4633c5721e0f7dad0fe99308116ebb7bdd5dafb160dc378f31d89",
    goModSha256: "5b7892540b197eb5156333ffc9ae108084849db07d0dea57b7060339f840a1a9",
    goSumSha256: "abd0d0de5302a1a571dcff5527f8bc929380f9d80abd0593416e9129dde0e96a",
    moduleInventorySha256: "08196d6bfd4aea8f9df956bbec0b25cf44c969fff4a6181de9fbb59ab1d1c5af",
    buildInfoSha256: "8e51d77d80000889804be06e6f5ebd4d1faca583a7d3fe7fc390d5548124a74d",
    builderPlatformDigest: "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747",
    compiler: "go1.27.3", candidateSha256: candidate, finalSha256: candidate,
    baseImageId: "sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6",
    inheritedDiffID: inherited, overlayDiffID: bound().layers.overlayDiffID,
    baseInspectionBytes: fixture("managed-seaweedfs-base-inspect.json").length,
    baseInspectionSha256: hash(fixture("managed-seaweedfs-base-inspect.json")),
    finalInspectionBytes: fixture("managed-seaweedfs-inspect.json").length,
    finalInspectionSha256: hash(fixture("managed-seaweedfs-inspect.json")),
    imageId: subject.imageId, archiveSha256: subject.archiveSha256, archiveBytes: subject.archiveBytes,
    mainVersionLookup: "UNAVAILABLE", mainVulnerabilityCoverage: "UNAVAILABLE_NO_VERSION",
    sourceAdvisoryCoverage: "NOT_ESTABLISHED", supportCoverage: "NOT_ESTABLISHED", admission: "NOT_AUTHORIZED",
  });
});

test("hash measurement arguments are fixed to the authenticated local image and visible weed binary", () => {
  assert.deepEqual(managedSeaweedHashArguments(subject), ["run", "--rm", "--pull=never", "--platform", "linux/amd64",
    "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true", "--user", "1000:1000",
    "--pids-limit", "16", "--memory", "64m", "--memory-swap", "64m", "--cpus", "1", "--entrypoint", "sha256sum",
    subject.imageId, "/usr/bin/weed"]);
  for (const mutate of [
    (value) => { value.kind = "UPSTREAM"; }, (value) => { value.imageId = `sha256:${"0".repeat(63)}`; },
    (value) => { value.os = "windows"; }, (value) => { value.architecture = "arm64"; },
    (value) => { value.archiveSha256 = "0".repeat(63); }, (value) => { value.archiveBytes = 0; },
    (value) => { value.archiveCapBytes -= 1; }, (value) => { value.artifactName = "/managed-image-postgres.tar"; },
  ]) {
    const changed = clone(subject); mutate(changed);
    assert.throws(() => managedSeaweedHashArguments(changed), /scanner_managed_seaweed_source_evidence_invalid/u);
  }
});

test("every bounded source material and detached proof rejects substitution", () => {
  for (const name of materialNames) {
    const changed = Buffer.from(fixture(name)); changed[0] ^= 1;
    assert.throws(() => bound({ view: materialView({ [name]: changed }) }), /scanner_managed_seaweed_source_/u, name);
  }
  for (const [name, bytes] of [
    ["baseInspection", fixture("managed-seaweedfs-base-inspect.json")],
    ["finalInspection", fixture("managed-seaweedfs-inspect.json")],
    ["finalInventory", Buffer.from(`${candidate}  /usr/bin/weed\n`)],
  ]) {
    const changed = Buffer.from(bytes); changed[0] ^= 1;
    assert.throws(() => bound({ [name]: changed }), /scanner_managed_seaweed_source_/u, name);
  }
  const shared = Buffer.alloc(1024);
  assert.throws(() => bindManagedSeaweedSourceEvidence(subject, proof({ baseInspection: shared.subarray(0, 512),
    finalInspection: shared.subarray(256, 768) })), /scanner_managed_seaweed_source_/u);
  assert.throws(() => bindManagedSeaweedSourceEvidence(subject, proof({ view: { ...materialView() } })),
    /scanner_managed_seaweed_source_evidence_invalid/u);
});

test("valid-looking inspection and post-binding subject substitutions are rejected", () => {
  for (const [name, mutate] of [
    ["baseInspection", (value) => { value[0].Id = `sha256:${"1".repeat(64)}`; }],
    ["baseInspection", (value) => { value[0].RootFS.Type = "foreign"; }],
    ["baseInspection", (value) => { value[0].RootFS.Layers[1] = `sha256:${"2".repeat(64)}`; }],
    ["finalInspection", (value) => { value[0].Id = `sha256:${"3".repeat(64)}`; }],
    ["finalInspection", (value) => { value[0].RootFS.Type = "foreign"; }],
    ["finalInspection", (value) => { value[0].RootFS.Layers[10] = inherited; }],
    ["finalInspection", (value) => { value[0].RootFS.Layers[13] = "not-a-digest"; }],
  ]) {
    const value = jsonFixture(name === "baseInspection" ? "managed-seaweedfs-base-inspect.json" : "managed-seaweedfs-inspect.json");
    mutate(value);
    assert.throws(() => bound({ [name]: Buffer.from(`${JSON.stringify(value)}\n`) }), /scanner_managed_seaweed_/u);
  }
  const { report, sbom } = reportAndSbom(), evidence = bound(), changed = clone(subject);
  changed.archiveSha256 = "4".repeat(64);
  assert.throws(() => evaluateManagedSeaweedArchiveReport(report, sbom, changed, evidence, now),
    /scanner_managed_seaweed_source_profile_invalid/u);
});

test("closed report and SBOM identities reject additions, removals, versions, relations and layer drift", () => {
  const mutations = [
    [(report) => { goResult(report).Packages.pop(); }, () => {}],
    [(report) => { goResult(report).Packages.push(clone(goResult(report).Packages[1])); }, () => {}],
    [(report) => { mainPackage(report).Version = undefined; }, () => {}],
    [(report) => { mainPackage(report).Version = null; }, () => {}],
    [(report) => { mainPackage(report).Version = ""; }, () => {}],
    [(report) => { mainPackage(report).RootPkg = undefined; }, () => {}],
    [(report) => { mainPackage(report).RootPkg = ""; }, () => {}],
    [(report) => { mainPackage(report).Locations = undefined; }, () => {}],
    [(report) => { mainPackage(report).Locations = []; }, () => {}],
    [(report) => { mainPackage(report).DependsOn.pop(); }, () => {}],
    [(report) => { goResult(report).Packages[1].Version = "v0.0.0"; }, () => {}],
    [(report) => { goResult(report).Packages[1].Layer.DiffID = `sha256:${"7".repeat(64)}`; }, () => {}],
    [(report) => { report.Metadata.ImageConfig.rootfs.type = "foreign"; }, () => {}],
    [() => {}, (sbom) => { sbom.components.splice(sbom.components.findIndex((entry) => entry.purl?.startsWith("pkg:golang/")), 1); }],
    [() => {}, (sbom) => { const item = sbom.components.find((entry) => entry.purl?.startsWith("pkg:golang/")); item["bom-ref"] += "-changed"; }],
    [() => {}, (sbom) => { mainComponent(sbom).version = undefined; }],
    [() => {}, (sbom) => { mainComponent(sbom).version = null; }],
    [() => {}, (sbom) => { mainComponent(sbom).version = ""; }],
    [() => {}, (sbom) => { const item = sbom.components.find((entry) => entry.name === "cel.dev/expr"); item.version = "v0.0.0"; }],
    [() => {}, (sbom) => { const item = sbom.components.find((entry) => entry.name === "cel.dev/expr"); item.properties.find((entry) => entry.name.endsWith("LayerDiffID")).value = `sha256:${"8".repeat(64)}`; }],
  ];
  for (const [changeReport, changeSbom] of mutations) {
    const { report, sbom } = reportAndSbom(); changeReport(report); changeSbom(sbom);
    assert.throws(() => evaluate(report, sbom), /scanner_/u);
  }
});

test("a fresh authenticated overlay layer is accepted and unrelated layer substitutions fail", () => {
  const fresh = `sha256:${"a".repeat(64)}`;
  const finalInspection = jsonFixture("managed-seaweedfs-inspect.json");
  const oldOverlay = finalInspection[0].RootFS.Layers[10];
  finalInspection[0].RootFS.Layers[10] = fresh;
  const evidence = bound({ finalInspection: Buffer.from(`${JSON.stringify(finalInspection)}\n`) });
  const { report, sbom } = reportAndSbom();
  report.Metadata.DiffIDs[10] = fresh;
  report.Metadata.ImageConfig.rootfs.diff_ids[10] = fresh;
  for (const pkg of goResult(report).Packages) if (pkg.Layer?.DiffID === oldOverlay) pkg.Layer.DiffID = fresh;
  for (const component of sbom.components) {
    const property = component.properties?.find((entry) => entry.name.endsWith("LayerDiffID"));
    if (property?.value === oldOverlay) property.value = fresh;
  }
  assert.equal(evaluate(report, sbom, evidence).sourceComponents[0].overlayDiffID, fresh);
  goResult(report).Packages.find((entry) => entry.Name === "stdlib").Layer.DiffID = inherited;
  assert.throws(() => evaluate(report, sbom, evidence), /scanner_/u);
});

test("main references and contradictory optional dependency identities are refused before generic evaluation", () => {
  const mainPurl = "pkg:golang/github.com/seaweedfs/seaweedfs";
  const cases = [
    { PkgName: "github.com/seaweedfs/seaweedfs" },
    { PkgID: "github.com/seaweedfs/seaweedfs" },
    { PURL: mainPurl },
    { PURL: `${mainPurl}#weed` },
    { UID: "e668706a42c11fc9" },
    { PkgIdentifier: { PURL: mainPurl } },
    { PkgIdentifier: { PURL: `${mainPurl}#weed` } },
    { PkgIdentifier: { UID: "e668706a42c11fc9" } },
    { PkgName: "cel.dev/expr", PURL: "pkg:golang/cel.dev/expr@v0.25.3", PkgIdentifier: { PURL: "pkg:golang/foreign@v1" } },
    { PkgName: "cel.dev/expr", UID: "206a18edfbf0a897", PkgIdentifier: { UID: "0000000000000000" } },
    { PkgName: "cel.dev/expr", PkgIdentifier: "not-an-identity" },
    { PkgName: "cel.dev/expr", PURL: 42 },
  ];
  for (const references of cases) {
    const { report, sbom } = reportAndSbom();
    goResult(report).Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0001", Severity: "HIGH",
      PkgName: "cel.dev/expr", InstalledVersion: "v0.25.3", ...references }];
    assert.throws(() => evaluate(report, sbom), /scanner_managed_seaweed_source_profile_invalid/u);
  }
});

test("OS findings cannot cross-reference the source-bound main through direct or nested subpath PURLs", () => {
  for (const identity of [{ PURL: "pkg:golang/github.com/seaweedfs/seaweedfs#weed" },
    { PkgIdentifier: { PURL: "pkg:golang/github.com/seaweedfs/seaweedfs#weed" } }]) {
    const { report, sbom } = reportAndSbom(), result = report.Results.find((entry) => entry.Type === "alpine"), pkg = result.Packages[0];
    result.Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0003", Severity: "HIGH", PkgName: pkg.Name,
      InstalledVersion: formatVersion(pkg), ...identity }];
    assert.throws(() => evaluate(report, sbom), /scanner_managed_seaweed_source_profile_invalid/u);
  }
});

test("reviewed dependency and OS findings retain the unchanged generic policy", () => {
  const { report, sbom } = reportAndSbom();
  goResult(report).Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0001", Severity: "CRITICAL", PkgName: "cel.dev/expr",
    InstalledVersion: "v0.25.3", PkgID: "cel.dev/expr@v0.25.3", PURL: "pkg:golang/cel.dev/expr@v0.25.3",
    UID: "206a18edfbf0a897" }];
  const osResult = report.Results.find((entry) => entry.Type === "alpine"), osPackage = osResult.Packages[0];
  osResult.Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0002", Severity: "HIGH", PkgName: osPackage.Name,
    InstalledVersion: formatVersion(osPackage), FixedVersion: "99.0-r0" }];
  const result = evaluate(report, sbom);
  assert.equal(result.findings.length, 2);
  assert.equal(result.blockers.length, 2);
  assert.ok(result.blockers.every((entry) => entry.code === "image_vulnerability_blocked"));
});

test("stale reports and evidence forged outside the binder never become source-bound", () => {
  const { report, sbom } = reportAndSbom();
  assert.throws(() => evaluate(report, sbom, bound(), new Date("2026-11-12T14:00:00Z")), /scanner_archive_report_invalid/u);
  assert.throws(() => evaluateManagedSeaweedArchiveReport(report, sbom, subject, clone(bound()), now),
    /scanner_managed_seaweed_source_profile_invalid/u);
});
