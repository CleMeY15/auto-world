import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { hashFileBounded } from "../scripts/supply-chain/native-audit.mjs";
import { assertNativeAuditBudget, nativeAuditPreflightBudget, nativeAuditSummaryBytes, nativeScanArguments, parseNativeScanArgs, stageNativeAuditSubjects } from "../scripts/supply-chain/native-scan.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";
import { sha256 } from "../scripts/supply-chain/strict-json.mjs";

test("native runner CLI exposes only the fixed Linux audit operation", () => {
  assert.deepEqual(parseNativeScanArgs([]), { mode: "scan" });
  for (const args of [["--enable"], ["--subject", "other"], ["upload"]]) {
    assert.throws(() => parseNativeScanArgs(args), { code: "native_scan_arguments_refused" });
  }
});
test("scanner commands freeze databases, stay offline and retain full JSON packages", () => {
  const cyclonedx = nativeScanArguments("cyclonedx", "/owned/cache");
  const json = nativeScanArguments("json", "/owned/cache");
  for (const args of [cyclonedx, json]) {
    for (const flag of ["--skip-db-update", "--skip-java-db-update", "--offline-scan", "--quiet", "--cache-backend", "memory", "--scanners", "vuln"]) {
      assert.ok(args.includes(flag));
    }
    assert.equal(args.at(-1), "subject");
    assert.equal(args.includes("--output"), false);
  }
  assert.equal(cyclonedx.includes("--list-all-pkgs"), false);
  assert.equal(json.includes("--list-all-pkgs"), true);
  for (const format of ["sarif", "table", ""]) assert.throws(() => nativeScanArguments(format, "/owned/cache"));
});

test("native audit refuses cumulative input and copy overflow before copying", () => {
  const GiB = 1024 ** 3;
  const known = { matrixBytes: 1, binarySizes: [1, 1, 1, 1], fixtureBytes: 1 };
  const preflight = assertNativeAuditBudget(known);
  assert.ok(preflight.databaseCapacityBytes > 0);
  assert.equal(preflight.transferPeakBytes, 2 * GiB);
  const reconciled = assertNativeAuditBudget({ ...known, databaseSizes: [1, 1, 1, 1] });
  assert.equal(reconciled.databaseBytes, 4);
  assert.ok(reconciled.artifactBytes <= 6 * GiB && reconciled.jobBytes <= 8 * GiB);
  assert.throws(() => assertNativeAuditBudget({ ...known, matrixBytes: 8 * GiB }), { code: "native_audit_budget_exceeded" });
  assert.throws(() => assertNativeAuditBudget({ ...known, databaseSizes: [2 * GiB, 1, 2 * GiB, 1] }), { code: "native_audit_budget_exceeded" });
  for (const values of [{ ...known, binarySizes: [1] }, { ...known, matrixBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...known, databaseSizes: [1, 9 * 1024 ** 2, 1, 1] }]) {
    assert.throws(() => assertNativeAuditBudget(values), { code: "native_audit_budget_invalid" });
  }
});

test("native audit preflight derives four sizes from the verified record snapshot", () => {
  const output = (target, size) => ({ target, size });
  const records = Object.freeze([
    Object.freeze({ tool: "oras", repeat: 1, outputs: Object.freeze([output("linux-amd64", 11)]) }),
    Object.freeze({ tool: "oras", repeat: 2, outputs: Object.freeze([output("linux-amd64", 11)]) }),
    Object.freeze({ tool: "cosign", repeat: 1, outputs: Object.freeze([output("linux-amd64", 22), output("windows-amd64", 33)]) }),
    Object.freeze({ tool: "cosign", repeat: 2, outputs: Object.freeze([output("linux-amd64", 22), output("windows-amd64", 33)]) }),
    Object.freeze({ tool: "trivy", repeat: 1, outputs: Object.freeze([output("linux-amd64", 44)]) }),
    Object.freeze({ tool: "trivy", repeat: 2, outputs: Object.freeze([output("linux-amd64", 44)]) }),
  ]);
  // This is the verifier's actual public result shape: it carries record
  // identities and consumedBytes, with no synthetic matrix.binaries field.
  const matrix = Object.freeze({ schemaVersion: 1,
    records: Object.freeze(records.map((record) => Object.freeze({ artifact: `native-candidate-${record.tool}-${record.repeat}`, sha256: "a".repeat(64) }))),
    consumedBytes: 123 });
  const preflight = nativeAuditPreflightBudget(matrix, records);
  assert.deepEqual(preflight.binarySizes, [11, 22, 33, 44]);
  assert.ok(preflight.budget.databaseCapacityBytes > 0);
  assert.equal(Object.hasOwn(matrix, "binaries"), false);
});

test("native audit summary retains only bounded finding identities and counts", () => {
  const results = ["oras", "cosign-linux", "cosign-windows", "trivy"].map((tool) => ({
    tool, target: "linux-amd64", state: "audit_proposal", packageCount: 2,
    findings: [{ vulnerabilityId: "CVE-2026-1" }], blockers: [],
  }));
  const fixtureManifest = { path: "manifest.json", sha256: "a".repeat(64), size: 1 };
  const fixtureMaterials = Array.from({ length: 8 }, (_, value) => ({ path: `${value}`, sha256: "b".repeat(64), size: value + 1 }));
  const fixtureReports = [1, 2, 3].map((value) => ({ fixtureId: `fixture-${value}`, path: `fixtures/reports/${value}.json`, sha256: "c".repeat(64), size: value }));
  const parsed = JSON.parse(nativeAuditSummaryBytes({ budget: { jobBytes: 1 }, results, fixtureManifest, fixtureMaterials, fixtureReports }));
  assert.equal(parsed.results[0].findingCount, 1);
  assert.equal(Object.hasOwn(parsed.results[0], "findings"), false);
  assert.equal(parsed.fixtures.materials.length, 8);
  const oversized = fixtureReports.map((entry, index) => index ? entry : { ...entry, path: `fixtures/${"x".repeat(8 * 1024 * 1024)}` });
  assert.throws(() => nativeAuditSummaryBytes({ budget: { jobBytes: 1 }, results, fixtureManifest, fixtureMaterials, fixtureReports: oversized }), { code: "native_audit_summary_too_large" });
});

test("native audit stages all subjects against the pre-execution record snapshot", async () => {
  const owned = await createOwnedDirectory();
  try {
    const matrixDirectory = path.join(owned.path, "matrix");
    const auditDirectory = path.join(owned.path, "audit");
    await mkdir(matrixDirectory);
    await mkdir(auditDirectory);
    const targets = { oras: ["linux-amd64", "oras"], cosign: ["linux-amd64", "cosign", "windows-amd64", "cosign.exe"], trivy: ["linux-amd64", "trivy"] };
    const records = [];
    for (const [tool, values] of Object.entries(targets)) {
      const outputs = [];
      const artifact = path.join(matrixDirectory, `native-candidate-${tool}-1`, "out");
      await mkdir(artifact, { recursive: true });
      for (let index = 0; index < values.length; index += 2) {
        const bytes = Buffer.from(`${tool}-${values[index]}`);
        const output = { target: values[index], path: `out/${values[index + 1]}`, sha256: sha256(bytes), size: bytes.length, buildInfo: [] };
        outputs.push(output);
        await writeFile(path.join(artifact, values[index + 1]), bytes);
      }
      records.push(Object.freeze({ tool, repeat: 1, outputs: Object.freeze(outputs) }), Object.freeze({ tool, repeat: 2, outputs: Object.freeze(outputs) }));
    }
    const staged = await stageNativeAuditSubjects({ matrixDirectory, auditDirectory, records: Object.freeze(records) });
    assert.equal(staged.length, 4);
    await writeFile(path.join(matrixDirectory, "native-candidate-trivy-1/out/trivy"), "substitute");
    const stagedTrivy = staged.find(({ tool }) => tool === "trivy");
    assert.deepEqual(await hashFileBounded(stagedTrivy.binary, 1024), { sha256: stagedTrivy.output.sha256, size: stagedTrivy.output.size });

    const secondAudit = path.join(owned.path, "second-audit");
    await mkdir(secondAudit);
    await assert.rejects(stageNativeAuditSubjects({ matrixDirectory, auditDirectory: secondAudit, records }), { code: "candidate_copy_source_invalid" });
  } finally { await removeOwnedDirectory(owned); }
});
