import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { auditSubjects, evaluateImageReport } from "../scripts/data-infra/audit-policy.mjs";

const pin = { manifestDigest: `sha256:${"a".repeat(64)}`, platform: { digest: `sha256:${"b".repeat(64)}`, os: "linux", architecture: "amd64" } };
const now = new Date("2026-09-06T00:00:00Z");
const report = (findings = []) => ({ SchemaVersion: 2, Trivy: { Version: "0.74.0" }, CreatedAt: now.toISOString(), ArtifactType: "container_image", ArtifactName: `synthetic@${pin.manifestDigest}`, Metadata: { ImageConfig: { os: "linux", architecture: "amd64" } }, Results: [{ Target: "synthetic", Vulnerabilities: findings }] });
const finding = { Severity: "HIGH", VulnerabilityID: "CVE-2099-0001", PkgName: "synthetic", InstalledVersion: "1", FixedVersion: "" };
const disposition = { imageDigest: pin.manifestDigest, target: "synthetic", vulnerabilityId: finding.VulnerabilityID, packageName: finding.PkgName, installedVersion: "1", decision: "unfixed_local_ci_only", reason: "Synthetic reviewed risk test, never a real exception.", independentReview: "https://github.com/CleMeY15/auto-world/pull/7", reviewedAt: "2026-09-05T00:00:00Z", expiresAt: "2026-09-12T00:00:00Z" };

test("candidate scans cannot replace shipped subjects or accept arbitrary registries and platforms", () => {
  const shipped = JSON.parse(readFileSync(new URL("../infra/images.json", import.meta.url), "utf8")).images;
  const candidates = JSON.parse(readFileSync(new URL("../infra/image-candidates.json", import.meta.url), "utf8"));
  const subjects = auditSubjects(shipped, candidates);
  assert.deepEqual(subjects.filter((item) => item.purpose === "shipped").map((item) => item.key), Object.keys(shipped));
  assert.equal(subjects.length, 8);
  for (const mutate of [
    (value) => { value.images.postgres.repository = "untrusted/postgres"; },
    (value) => { value.images.postgres.manifestDigest = "latest"; },
    (value) => { value.images.postgres.platform.architecture = "arm64"; },
    (value) => { value.images.trivy = value.images.postgres; },
    (value) => { value.images = []; },
  ]) {
    const changed = globalThis.structuredClone(candidates);
    mutate(changed);
    assert.throws(() => auditSubjects(shipped, changed), /candidates_invalid/u);
  }
});

test("image audit fails closed on wrong image/platform/tool or empty report", () => {
  assert.equal(evaluateImageReport(report(), pin, [], now).blockers.length, 0);
  for (const changed of [{ SchemaVersion: 0 }, { Results: [] }, { ArtifactName: "synthetic:latest" }, { Trivy: { Version: "other" } }, { Metadata: { ImageConfig: { os: "linux", architecture: "arm64" } } }]) {
    assert.throws(() => evaluateImageReport({ ...report(), ...changed }, pin), /invalid/u);
  }
});

test("every critical and fixable high blocks even with a disposition", () => {
  for (const value of [{ ...finding, Severity: "CRITICAL" }, { ...finding, FixedVersion: "2" }]) {
    assert.equal(evaluateImageReport(report([value]), pin, [disposition], now).blockers.length, 1);
  }
});

test("unfixed high requires exact dated independently reviewed disposition", () => {
  assert.equal(evaluateImageReport(report([finding]), pin, [], now).blockers.length, 1);
  assert.equal(evaluateImageReport(report([finding]), pin, [disposition], now).blockers.length, 0);
  for (const changed of [{ imageDigest: "wrong" }, { installedVersion: "2" }, { expiresAt: "2026-09-01T00:00:00Z" }, { expiresAt: "2027-09-01T00:00:00Z" }, { independentReview: "self-approved" }, { reason: "ok" }]) {
    assert.equal(evaluateImageReport(report([finding]), pin, [{ ...disposition, ...changed }], now).blockers.length, 1);
  }
  assert.equal(evaluateImageReport(report([finding]), pin, [], now).findings.length, 1);
});
