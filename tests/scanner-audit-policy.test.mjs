import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateImageReport, MAX_DATABASE_AGE_MS, SCANNER_VERSION, validateDatabaseMetadata } from "../scripts/scanner/audit-policy.mjs";

const pin = { repository: "synthetic/image", manifestDigest: `sha256:${"a".repeat(64)}`, platform: { digest: `sha256:${"b".repeat(64)}`, os: "linux", architecture: "amd64", variant: null } };
const now = new Date("2026-09-14T10:00:00Z");
const finding = { Severity: "HIGH", VulnerabilityID: "CVE-2099-0001", PkgName: "fixture", InstalledVersion: "1.0", FixedVersion: "" };
const disposition = {
  imageDigest: pin.manifestDigest, target: "synthetic", vulnerabilityId: finding.VulnerabilityID,
  packageName: finding.PkgName, installedVersion: finding.InstalledVersion, decision: "unfixed_local_ci_only",
  reason: "Synthetic review fixture only, never an actual exception.", independentReview: "https://github.com/CleMeY15/auto-world/pull/999",
  reviewedAt: "2026-09-13T00:00:00Z", expiresAt: "2026-09-20T00:00:00Z",
};
function report(findings = []) {
  return {
    SchemaVersion: 2, Trivy: { Version: SCANNER_VERSION }, CreatedAt: now.toISOString(),
    ArtifactType: "container_image", ArtifactName: `${pin.repository}@${pin.manifestDigest}`,
    Metadata: { ImageConfig: { os: "linux", architecture: "amd64" }, OS: { EOSL: false } },
    Results: [{ Target: "synthetic", Class: "os-pkgs", Type: "alpine", Packages: [{ Name: "fixture", Version: "1.0" }], Vulnerabilities: findings }],
  };
}
const evaluate = (value, exceptions = []) => evaluateImageReport(value, pin, exceptions, now);

test("exact repository plus parent or platform digest is required", () => {
  for (const digest of [pin.manifestDigest, pin.platform.digest]) {
    assert.deepEqual(evaluate({ ...report(), ArtifactName: `${pin.repository}@${digest}` }), { findings: [], blockers: [] });
  }
  for (const name of [`other/image@${pin.manifestDigest}`, `${pin.repository}@sha256:${"c".repeat(64)}`, `${pin.repository}:latest`, `prefix-${pin.repository}@${pin.manifestDigest}`, `${pin.repository}@${pin.manifestDigest} `]) {
    assert.throws(() => evaluate({ ...report(), ArtifactName: name }), /scanner_image_report_invalid/u);
  }
});

test("old scanner version and wrong subject type or platform never pass", () => {
  for (const change of [{ Trivy: { Version: "0.74.0" } }, { Trivy: {} }, { SchemaVersion: 0 }, { ArtifactType: "filesystem" }, { Metadata: { ImageConfig: { os: "linux", architecture: "arm64" } } }]) {
    assert.throws(() => evaluate({ ...report(), ...change }), /scanner_image_report_invalid/u);
  }
  for (const badPin of [null, { ...pin, manifestDigest: "latest" }, { ...pin, repository: "synthetic/image@extra" }, { ...pin, platform: { ...pin.platform, architecture: "arm64" } }]) {
    assert.throws(() => evaluateImageReport(report(), badPin, [], now), /scanner_image_pin_invalid/u);
  }
});

test("a missing, partial or malformed package inventory is not a clean audit", () => {
  for (const change of [null, { Results: [] }, { Results: [{ ...report().Results[0], Packages: [] }] }, { Results: [{ Target: "synthetic" }] }, { Results: [{ ...report().Results[0], Packages: [{ Name: "fixture" }] }] }, { Results: [{ ...report().Results[0], Vulnerabilities: null }] }]) {
    assert.throws(() => evaluate(change === null ? null : { ...report(), ...change }), /scanner_image_report_invalid/u);
  }
  const duplicate = report();
  duplicate.Results.push(duplicate.Results[0]);
  assert.throws(() => evaluate(duplicate), /scanner_image_report_invalid/u);
  assert.throws(() => evaluate(report([{ ...finding, PkgName: "not-in-inventory" }])), /scanner_image_report_invalid/u);
});

test("critical, fixable high and end-of-life OS cannot be waived", () => {
  for (const value of [{ ...finding, Severity: "CRITICAL" }, { ...finding, FixedVersion: "2.0" }]) {
    const result = evaluate(report([value]), [disposition]);
    assert.equal(result.blockers[0].code, "image_vulnerability_blocked");
    assert.equal(result.findings.length, 1);
  }
  const eos = report();
  eos.Metadata.OS.EOSL = true;
  assert.deepEqual(evaluate(eos).blockers, [{ code: "image_os_end_of_life" }]);
});

test("OS package inventory includes its epoch and release when matching a finding", () => {
  for (const [pkg, installed] of [
    [{ Name: "fixture", Version: "2.41.5", Release: "0+deb13u1", Epoch: 1 }, "1:2.41.5-0+deb13u1"],
    [{ Name: "fixture", Version: "5.1.0", Release: "3.amzn2023.0.3" }, "5.1.0-3.amzn2023.0.3"],
    [{ Name: "fixture", Version: "1.0", Epoch: 0 }, "1.0"],
  ]) {
    const value = report([{ ...finding, InstalledVersion: installed }]);
    value.Results[0].Packages = [pkg];
    assert.equal(evaluate(value).blockers[0].code, "unfixed_high_needs_independent_disposition");
    value.Results[0].Vulnerabilities[0].InstalledVersion = `${installed}-other`;
    assert.throws(() => evaluate(value), /scanner_image_report_invalid/u);
  }
});

test("unfixed high needs an exact, current, bounded independently reviewed assertion", () => {
  assert.equal(evaluate(report([finding])).blockers.length, 1);
  assert.equal(evaluate(report([finding]), [disposition]).blockers.length, 0);
  for (const change of [{ imageDigest: pin.platform.digest }, { target: "elsewhere" }, { installedVersion: "1.1" }, { vulnerabilityId: "CVE-2099-0002" }, { expiresAt: now.toISOString() }, { expiresAt: "2026-12-01T00:00:00Z" }, { reviewedAt: "2026-09-15T00:00:00Z" }, { independentReview: "https://github.com/CleMeY15/auto-world.evil/pull/1" }, { reason: "ok" }]) {
    assert.equal(evaluate(report([finding]), [{ ...disposition, ...change }]).blockers.length, 1);
  }
  assert.throws(() => evaluate(report(), {}), /scanner_dispositions_invalid/u);
});

test("future, ambiguous or expired scan dates and invalid clocks fail", () => {
  assert.equal(evaluate({ ...report(), CreatedAt: new Date(now.getTime() - MAX_DATABASE_AGE_MS).toISOString() }).blockers.length, 0);
  for (const CreatedAt of ["2026-09-14", "yesterday", new Date(now.getTime() + 1).toISOString(), new Date(now.getTime() - MAX_DATABASE_AGE_MS - 1).toISOString()]) {
    assert.throws(() => evaluate({ ...report(), CreatedAt }), /scanner_image_report_invalid/u);
  }
  assert.throws(() => evaluateImageReport(report(), pin, [], new Date("invalid")), /scanner_audit_clock_invalid/u);
});

test("both database metadata records must be ordered and fresh", () => {
  for (const Version of [2, 1]) {
    const metadata = { Version, UpdatedAt: "2026-09-13T10:00:00Z", DownloadedAt: "2026-09-14T09:00:00Z" };
    assert.equal(validateDatabaseMetadata(metadata, { now, expectedVersion: Version }).version, Version);
    for (const changed of [{ UpdatedAt: "2026-09-12T09:59:59Z" }, { UpdatedAt: "2026-09-14T10:00:01Z" }, { UpdatedAt: "2026-09-14T09:30:00Z" }, { DownloadedAt: "2026-09-14T10:00:01Z" }, { DownloadedAt: null }, { Version: 0 }, { Version: 3 - Version }]) {
      assert.throws(() => validateDatabaseMetadata({ ...metadata, ...changed }, { now, expectedVersion: Version }), /scanner_database_metadata_invalid/u);
    }
    assert.throws(() => validateDatabaseMetadata(metadata, { now }), /scanner_database_metadata_invalid/u);
  }
});

test("oversized report inventories and malformed OS versions fail before evaluation", () => {
  const tooManyPackages = report();
  tooManyPackages.Results[0].Packages = Array(100_001).fill({ Name: "fixture", Version: "1.0" });
  assert.throws(() => evaluate(tooManyPackages), /scanner_image_report_invalid/u);
  const tooManyFindings = report(Array(100_001).fill(finding));
  assert.throws(() => evaluate(tooManyFindings), /scanner_image_report_invalid/u);
  for (const change of [{ Epoch: -1 }, { Epoch: 1.5 }, { Release: 1 }, { Version: "v".repeat(16_385) }]) {
    const value = report();
    Object.assign(value.Results[0].Packages[0], change);
    assert.throws(() => evaluate(value), /scanner_image_report_invalid/u);
  }
});

test("findings outside the requested severity or malformed fields fail as report errors", () => {
  for (const value of [null, { ...finding, Severity: "MEDIUM" }, { ...finding, VulnerabilityID: "" }, { ...finding, FixedVersion: 2 }]) {
    assert.throws(() => evaluate(report([value])), /scanner_image_report_invalid/u);
  }
});
