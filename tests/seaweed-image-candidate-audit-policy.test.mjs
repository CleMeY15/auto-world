import assert from "node:assert/strict";
import { test } from "node:test";
import { SCANNER_VERSION } from "../scripts/scanner/audit-policy.mjs";
import { evaluateLocalSeaweedCandidateAudit } from "../scripts/seaweed-image/candidate-audit-policy.mjs";

const now = new Date("2026-09-24T12:00:00Z");
const subject = {
  artifactName: "/candidate/saved.tar", imageId: `sha256:${"a".repeat(64)}`,
  archiveSha256: "b".repeat(64), tag: "auto-world/seaweed-candidate:run-14",
};

function vulnerabilityReport() {
  return {
    SchemaVersion: 2, Trivy: { Version: SCANNER_VERSION }, CreatedAt: now.toISOString(),
    ArtifactType: "container_image", ArtifactName: subject.artifactName,
    Metadata: { ImageID: subject.imageId, RepoTags: [subject.tag],
      ImageConfig: { os: "linux", architecture: "amd64" }, OS: { Family: "alpine", Name: "3.24.1" } },
    Results: [
      { Target: "/candidate/saved.tar (alpine 3.24.1)", Class: "os-pkgs", Type: "alpine", Packages: [
        { Name: "alpine-baselayout", Version: "3.7.0", Release: "r0" },
      ], Vulnerabilities: [] },
      { Target: "usr/bin/weed", Class: "lang-pkgs", Type: "gobinary", Packages: [
        { Name: "github.com/seaweedfs/seaweedfs", Version: "v3.99" },
        { Name: "stdlib", Version: "v1.25.1" },
      ], Vulnerabilities: [] },
    ],
  };
}

function cyclonedxReport() {
  const properties = (value) => [{ name: "aquasecurity:trivy:PkgType", value }];
  return {
    bomFormat: "CycloneDX", specVersion: "1.7", version: 1,
    metadata: { component: { type: "container", name: subject.artifactName } },
    components: [
      { type: "application", name: "usr/bin/weed", properties: [
        { name: "aquasecurity:trivy:Type", value: "gobinary" },
        { name: "aquasecurity:trivy:Class", value: "lang-pkgs" },
      ] },
      { type: "library", name: "alpine-baselayout", version: "3.7.0-r0", properties: properties("alpine") },
      { type: "library", name: "github.com/seaweedfs/seaweedfs", version: "v3.99", properties: properties("gobinary") },
      { type: "library", name: "stdlib", version: "v1.25.1", properties: properties("gobinary") },
      { type: "operating-system", name: "alpine", version: "3.24.1", properties: [
        { name: "aquasecurity:trivy:Class", value: "os-pkgs" },
        { name: "aquasecurity:trivy:Type", value: "alpine" },
      ] },
    ],
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const evaluate = (changes = {}) => evaluateLocalSeaweedCandidateAudit({
  vulnerabilityReport: changes.vulnerabilityReport ?? vulnerabilityReport(),
  cyclonedxReport: changes.cyclonedxReport ?? cyclonedxReport(),
  subject: changes.subject ?? subject, now: changes.now ?? now,
});

test("a clean local archive audit returns its local identities without inventing a manifest digest", () => {
  const result = evaluate();
  assert.equal(result.state, "COMPLETE");
  assert.deepEqual(result.subject, { kind: "LOCAL_DOCKER_SAVE_ARCHIVE", ...subject, os: "linux", architecture: "amd64" });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.inventory, { resultCount: 2, packageCount: 3, sbomComponentCount: 5 });
  assert.equal("manifestDigest" in result.subject, false);
  const explicitlySupported = vulnerabilityReport(); explicitlySupported.Metadata.OS.EOSL = false;
  assert.equal(evaluate({ vulnerabilityReport: explicitlySupported }).state, "COMPLETE");
});

test("the scanner-visible archive path, image ID and tag are exact independent identities", () => {
  for (const mutate of [
    (report) => { report.ArtifactName += " "; },
    (report) => { report.Metadata.ImageID = `sha256:${"c".repeat(64)}`; },
    (report) => { report.Metadata.RepoTags = []; },
    (report) => { report.Metadata.RepoTags = [subject.tag, "extra:test"]; },
    (report) => { report.Metadata.RepoTags = ["auto-world/seaweed-candidate:other"]; },
  ]) {
    const report = vulnerabilityReport(); mutate(report);
    assert.throws(() => evaluate({ vulnerabilityReport: report }), /seaweed_candidate_audit_invalid/u);
  }
  for (const changed of [
    { artifactName: "candidate/saved.tar" }, { imageId: `sha256:${"c".repeat(64)}` },
    { archiveSha256: "not-a-hash" }, { tag: "latest" },
  ]) assert.throws(() => evaluate({ subject: { ...subject, ...changed } }), /seaweed_candidate_audit_invalid/u);
  assert.throws(() => evaluate({ subject: { ...subject, manifestDigest: `sha256:${"d".repeat(64)}` } }),
    /seaweed_candidate_audit_invalid/u);
});

test("only a fresh report from the pinned scanner for linux amd64 passes", () => {
  for (const mutate of [
    (report) => { report.Trivy.Version = "0.74.0"; },
    (report) => { report.SchemaVersion = 1; },
    (report) => { report.ArtifactType = "filesystem"; },
    (report) => { report.Metadata.ImageConfig.os = "windows"; },
    (report) => { report.Metadata.ImageConfig.architecture = "arm64"; },
    (report) => { report.Metadata.ImageConfig.variant = "v8"; },
    (report) => { delete report.Metadata.OS; },
    (report) => { report.Metadata.OS = null; },
    (report) => { delete report.Metadata.OS.Family; },
    (report) => { report.Metadata.OS.Family = ""; },
    (report) => { delete report.Metadata.OS.Name; },
    (report) => { report.Metadata.OS.Name = ""; },
    (report) => { report.Metadata.OS.Extra = "unexpected"; },
    (report) => { report.Metadata.OS.EOSL = null; },
    (report) => { report.Metadata.OS.EOSL = "false"; },
    (report) => { report.Results[0].Type = "debian"; },
    (report) => { report.Results[0].Target = "/candidate/saved.tar (alpine 3.24.0)"; },
    (report) => { report.CreatedAt = "2026-09-22T11:59:59Z"; },
    (report) => { report.CreatedAt = "2026-09-24T12:00:01Z"; },
    (report) => { report.CreatedAt = "2026-02-31T00:00:00Z"; },
  ]) {
    const report = vulnerabilityReport(); mutate(report);
    assert.throws(() => evaluate({ vulnerabilityReport: report }), /seaweed_candidate_audit_invalid/u);
  }
  assert.throws(() => evaluate({ now: new Date("invalid") }), /seaweed_candidate_audit_invalid/u);
});

test("exactly one weed Go target is required and removed Rust executables cannot reappear", () => {
  for (const mutate of [
    (report) => { report.Results.pop(); },
    (report) => { report.Results[1].Target = "usr/bin/weed (gobinary)"; },
    (report) => { report.Results.push(clone(report.Results[1])); },
    (report) => { report.Results.push({ Target: "usr/bin/weed-volume", Class: "lang-pkgs", Type: "rustbinary",
      Packages: [{ Name: "weed-volume", Version: "1" }] }); },
    (report) => { report.Results[1].Packages.push({ Name: "/usr/bin/weed-worker", Version: "1" }); },
  ]) {
    const report = vulnerabilityReport(); mutate(report);
    assert.throws(() => evaluate({ vulnerabilityReport: report }), /seaweed_candidate_audit_invalid/u);
  }
  const sbom = cyclonedxReport();
  sbom.components[3].name = "usr/bin/weed-worker";
  assert.throws(() => evaluate({ cyclonedxReport: sbom }), /seaweed_candidate_audit_invalid/u);
});

test("CycloneDX must be a bounded one-to-one inventory of all JSON packages", () => {
  for (const mutate of [
    (sbom) => { sbom.bomFormat = "SPDX"; },
    (sbom) => { sbom.specVersion = "1.3"; },
    (sbom) => { sbom.specVersion = "1.8"; },
    (sbom) => { sbom.metadata.component.name += " "; },
    (sbom) => { sbom.components.pop(); },
    (sbom) => { sbom.components[1].version = "13.8-1"; },
    (sbom) => { sbom.components[1].properties[0].value = "debian"; },
    (sbom) => { sbom.components.push(clone(sbom.components[1])); },
    (sbom) => { sbom.components[0].name = "usr/bin/weed-volume"; },
    (sbom) => { sbom.components[0].properties[0].value = "rustbinary"; },
    (sbom) => { sbom.components[0].properties[1].value = "os-pkgs"; },
    (sbom) => { sbom.components.push(clone(sbom.components[0])); },
    (sbom) => { sbom.components.shift(); },
    (sbom) => { sbom.components.push({ type: "framework", name: "foreign" }); },
  ]) {
    const sbom = cyclonedxReport(); mutate(sbom);
    assert.throws(() => evaluate({ cyclonedxReport: sbom }), /seaweed_candidate_audit_invalid/u);
  }
  const duplicateJson = vulnerabilityReport();
  duplicateJson.Results[1].Packages.push(clone(duplicateJson.Results[1].Packages[0]));
  assert.throws(() => evaluate({ vulnerabilityReport: duplicateJson }), /seaweed_candidate_audit_invalid/u);
  const tooManyResults = vulnerabilityReport();
  tooManyResults.Results = Array.from({ length: 4097 }, (_, index) => ({ Target: `target-${index}`,
    Class: "os-pkgs", Type: "debian", Packages: [{ Name: `package-${index}`, Version: "1" }] }));
  assert.throws(() => evaluate({ vulnerabilityReport: tooManyResults }), /seaweed_candidate_audit_invalid/u);
});

test("the native operating-system component must exactly match the JSON OS identity", () => {
  for (const mutate of [
    (sbom) => { sbom.components.at(-1).name = "debian"; },
    (sbom) => { sbom.components.at(-1).version = "3.23.0"; },
    (sbom) => { sbom.components.at(-1).properties[0].value = "lang-pkgs"; },
    (sbom) => { sbom.components.at(-1).properties[1].value = "debian"; },
    (sbom) => { sbom.components.push(clone(sbom.components.at(-1))); },
    (sbom) => { sbom.components.pop(); },
  ]) {
    const sbom = cyclonedxReport(); mutate(sbom);
    assert.throws(() => evaluate({ cyclonedxReport: sbom }), /seaweed_candidate_audit_invalid/u);
  }
});

test("all HIGH and CRITICAL findings block because the local policy has no disposition input", () => {
  assert.throws(() => evaluateLocalSeaweedCandidateAudit({ vulnerabilityReport: vulnerabilityReport(),
    cyclonedxReport: cyclonedxReport(), subject, dispositions: [] }), /seaweed_candidate_audit_invalid/u);
  for (const finding of [
    { Severity: "HIGH", VulnerabilityID: "CVE-2099-0001", PkgName: "alpine-baselayout", InstalledVersion: "3.7.0-r0", FixedVersion: "" },
    { Severity: "HIGH", VulnerabilityID: "CVE-2099-0001", PkgName: "alpine-baselayout", InstalledVersion: "3.7.0-r0", FixedVersion: "3.7.1-r0" },
    { Severity: "CRITICAL", VulnerabilityID: "CVE-2099-0001", PkgName: "alpine-baselayout", InstalledVersion: "3.7.0-r0", FixedVersion: "" },
  ]) {
    const report = vulnerabilityReport(); report.Results[0].Vulnerabilities = [finding];
    const result = evaluate({ vulnerabilityReport: report });
    assert.equal(result.state, "BLOCKED");
    assert.equal(result.findings.length, 1);
    assert.equal(result.blockers.length, 1);
    assert.equal(result.blockers[0].code, finding.Severity === "HIGH" && !finding.FixedVersion
      ? "unfixed_high_needs_independent_disposition" : "image_vulnerability_blocked");
    assert.deepEqual(result.findings[0].subject, result.subject);
    assert.equal("imageDigest" in result.findings[0], false);
  }
  const report = vulnerabilityReport(); report.Metadata.OS.EOSL = true;
  assert.deepEqual(evaluate({ vulnerabilityReport: report }).blockers[0].code, "image_os_end_of_life");
});
