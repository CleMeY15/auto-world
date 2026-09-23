import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateImageReport, SCANNER_VERSION } from "../scripts/scanner/audit-policy.mjs";
import { collectImageAudits } from "../scripts/scanner/audit.mjs";

const lock = JSON.parse(readFileSync(new URL("../infra/scanner/scanner-lock.json", import.meta.url), "utf8"));
const pin = lock.images.find((image) => image.role === "seaweedfs");
const now = new Date("2026-09-23T11:00:00Z");
const expected = [
  ["usr/bin/weed", "gobinary"],
  ["usr/bin/weed-volume", "rustbinary"],
  ["usr/bin/weed-worker", "rustbinary"],
];

// Synthetic report-shape controls, not recovered Rust packages or a real scan.
function report() {
  return {
    SchemaVersion: 2, Trivy: { Version: SCANNER_VERSION }, CreatedAt: now.toISOString(),
    ArtifactType: "container_image", ArtifactName: `${pin.repository}@${pin.platform.digest}`,
    Metadata: { ImageConfig: { os: "linux", architecture: "amd64" }, OS: { EOSL: false } },
    Results: [
      { Target: "synthetic Alpine", Class: "os-pkgs", Type: "alpine", Packages: [{ Name: "fixture-os", Version: "1.0" }] },
      ...expected.map(([Target, Type]) => ({ Target, Class: "lang-pkgs", Type, Packages: [{ Name: "fixture-library", Version: "1.0" }] })),
    ],
  };
}
const evaluate = (value, image = pin) => evaluateImageReport(value, image, [], now);
const gaps = (value) => evaluate(value).blockers.filter((entry) => entry.code === "image_inventory_incomplete");

test("the known Seaweed coverage control stays bound to the inventoried immutable platform", () => {
  assert.equal(pin.platform.digest, "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362");
  assert.deepEqual(evaluate(report()), { findings: [], blockers: [] });
  const value = report();
  value.Results = value.Results.slice(0, 2);
  assert.deepEqual(gaps(value).map(({ target, type }) => [target, type]), expected.slice(1));
  assert.equal(evaluate(value, { ...pin, role: "renamed" }).blockers.length, 2);
  value.ArtifactName = `${pin.repository}@${pin.manifestDigest}`;
  assert.equal(gaps(value).length, 2);
});

test("omitting any known executable inventory is a blocker even with zero findings", () => {
  for (const [target, type] of expected) {
    const value = report();
    value.Results = value.Results.filter((entry) => entry.Target !== target);
    assert.deepEqual(gaps(value), [{ code: "image_inventory_incomplete", imageDigest: pin.platform.digest, target, class: "lang-pkgs", type }]);
  }
});

test("a lockfile, another path or another analyzer cannot stand in for the shipped Rust binary", () => {
  for (const change of [
    { Target: "app/Cargo.lock", Type: "cargo" },
    { Target: "usr/bin/another-worker" },
    { Target: "usr/bin/weed-worker (rust-binary)" },
    { Type: "rust-binary" },
    { Type: "gobinary" },
    { Class: "os-pkgs" },
  ]) {
    const value = report();
    Object.assign(value.Results.at(-1), change);
    assert.equal(gaps(value).length, 1);
    assert.equal(gaps(value)[0].target, "usr/bin/weed-worker");
  }
});

test("existing vulnerability findings survive incomplete executable coverage", () => {
  const value = report();
  value.Results = value.Results.slice(0, 2);
  value.Results[1].Vulnerabilities = [{ Severity: "HIGH", VulnerabilityID: "CVE-2099-0001", PkgName: "fixture-library", InstalledVersion: "1.0", FixedVersion: "2.0" }];
  const evaluated = evaluate(value);
  assert.equal(evaluated.findings.length, 1);
  assert.equal(evaluated.blockers.filter((entry) => entry.code === "image_vulnerability_blocked").length, 1);
  assert.equal(evaluated.blockers.filter((entry) => entry.code === "image_inventory_incomplete").length, 2);
});

test("the collector preserves coverage rejection and raw identity while continuing other subjects", async () => {
  const value = report();
  value.Results = value.Results.slice(0, 2);
  const other = { repository: "synthetic/other", role: "other", manifestDigest: `sha256:${"a".repeat(64)}`, platform: { ...pin.platform, digest: `sha256:${"b".repeat(64)}` } };
  const identity = { sha256: "c".repeat(64), size: 123 };
  const checked = [];
  const result = await collectImageAudits([pin, other], {
    beforeScan: async () => undefined, scan: async () => undefined,
    afterScan: async (image) => { checked.push(image.role); },
    captureReport: async () => ({ identity }),
    readReport: async (image) => ({ ...value, ArtifactName: `${image.repository}@${image.platform.digest}` }),
    evaluate: async (image, input) => evaluate(input, image),
  });
  assert.deepEqual(checked, ["seaweedfs", "other"]);
  assert.deepEqual(result.reports.map(({ result: state, findingCount, blockerCount }) => ({ state, findingCount, blockerCount })), [
    { state: "rejected", findingCount: 0, blockerCount: 2 },
    { state: "passed", findingCount: 0, blockerCount: 0 },
  ]);
  assert.deepEqual(result.reports[0].report, identity);
  assert.equal(result.reports[0].stage, "policy");
  assert.equal(result.blockers.length, 2);
});
