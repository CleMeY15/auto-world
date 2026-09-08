import assert from "node:assert/strict";
import { link, lstat, mkdir, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { hashFileBounded } from "../scripts/supply-chain/native-audit.mjs";
import { assertNativeAuditBudget, databaseBudgetDiagnostic, nativeAuditPreflightBudget, nativeAuditSummaryBytes, nativeScanArguments, parseNativeScanArgs, runNativeAuditOrchestration, runOwnedAuditWork, runTrackedScannerFixtures, stageNativeAuditSubjects, verifyNativeDatabaseCache, verifyNativeEmptyDirectory, verifyNativeSubjectWork } from "../scripts/supply-chain/native-scan.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";
import { sha256 } from "../scripts/supply-chain/strict-json.mjs";

const GiB = 1024 ** 3;

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
  const known = { matrixBytes: 1, binarySizes: [1, 1, 1, 1], fixtureBytes: 1 };
  const preflight = assertNativeAuditBudget(known);
  assert.ok(preflight.databaseCapacityBytes > 0);
  assert.equal(preflight.packageTransferBytes, 2 * GiB);
  const reconciled = assertNativeAuditBudget({ ...known, databaseSizes: [1, 1, 1, 1] });
  assert.equal(reconciled.databaseBytes, 4);
  assert.ok(reconciled.artifactBytes <= 6 * GiB && reconciled.scanBytes <= 8 * GiB && reconciled.packageBytes <= 8 * GiB);
  assert.throws(() => assertNativeAuditBudget({ ...known, matrixBytes: 8 * GiB }), { code: "native_audit_budget_exceeded" });
  assert.throws(() => assertNativeAuditBudget({ ...known, databaseSizes: [2 * GiB, 1, 2 * GiB, 1] }), { code: "native_audit_budget_exceeded" });
  for (const values of [{ ...known, binarySizes: [1] }, { ...known, matrixBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...known, databaseSizes: [1, "9", 1, 1] }]) {
    assert.throws(() => assertNativeAuditBudget(values), { code: "native_audit_budget_invalid" });
  }
});

test("native audit phase budgets accept the verified DB measurement under unchanged caps", () => {
  const input = {
    matrixBytes: 1_046_926_814,
    binarySizes: [13_163_072, 141_203_284, 142_822_912, 168_288_382],
    databaseSizes: [1_371_025_408, 143, 1_520_816_128, 140],
    fixtureBytes: 4 * 1024 ** 2,
  };
  const measured = assertNativeAuditBudget(input);
  const preflight = assertNativeAuditBudget({ ...input, databaseSizes: undefined });
  assert.equal(measured.databaseBytes, 2_891_841_819);
  assert.equal(measured.artifactBytes, 4_284_260_653);
  assert.equal(measured.scanBytes, 8_395_511_972);
  assert.equal(measured.packageBytes, 7_478_671_115);
  assert.equal(measured.scanBytes, preflight.scanBaseBytes + 2 * measured.databaseBytes);
  assert.equal(measured.packageBytes, preflight.packageBaseBytes + measured.databaseBytes);
  assert.equal(measured.jobBytes, measured.scanBytes);
  assert.ok(measured.artifactBytes <= 6 * 1024 ** 3);
  assert.ok(measured.jobBytes <= 8 * 1024 ** 3);
});

test("database budget diagnostic closes sizes, totals and refusal reason", () => {
  const input = { matrixBytes: 1, binarySizes: [1, 1, 1, 1], fixtureBytes: 1 };
  const perFile = databaseBudgetDiagnostic({ ...input, databaseSizes: [2 * 1024 ** 3 + 1, 1, 1, 1] });
  assert.equal(perFile.reason, "per_file");
  assert.deepEqual(Object.keys(perFile.databaseSizes), ["vulnerability", "vulnerabilityMetadata", "java", "javaMetadata"]);
  assert.equal(typeof perFile.totals.scanBytes, "number");
  const artifactOverflow = { matrixBytes: 1, binarySizes: [300 * 1024 ** 2, 300 * 1024 ** 2, 300 * 1024 ** 2, 300 * 1024 ** 2],
    fixtureBytes: 1, databaseSizes: [2 * GiB, 1, 2_113_929_214, 1] };
  const artifact = databaseBudgetDiagnostic(artifactOverflow);
  assert.equal(artifact.reason, "artifact_total");
  assert.equal(artifact.totals.packageBytes - artifact.totals.artifactBytes, artifactOverflow.matrixBytes + 2 * GiB);
  assert.throws(() => databaseBudgetDiagnostic({ ...input, databaseSizes: [1, "sentinel", 1, 1] }), { code: "native_database_diagnostic_invalid" });
  assert.equal(JSON.stringify(perFile).includes("sentinel"), false);
});

test("native audit enforces exact scan, package and DB-file boundaries end to end", () => {
  const scanEqual = { matrixBytes: 1, binarySizes: [1, 1, 1, 1], fixtureBytes: 1,
    databaseSizes: [2 * GiB, 1, 1_686_110_202, 1] };
  assert.equal(assertNativeAuditBudget(scanEqual).scanBytes, 8 * GiB);
  const scanOver = { ...scanEqual, matrixBytes: 2 };
  assert.throws(() => assertNativeAuditBudget(scanOver), { code: "native_audit_budget_exceeded" });
  assert.equal(databaseBudgetDiagnostic(scanOver).reason, "scan_total");

  const packageEqual = { matrixBytes: 3_372_220_414, binarySizes: [1, 1, 1, 1], fixtureBytes: 1,
    databaseSizes: [2_147_483_642, 1, 1, 1] };
  assert.equal(assertNativeAuditBudget(packageEqual).packageBytes, 8 * GiB);
  const packageOver = { ...packageEqual, matrixBytes: packageEqual.matrixBytes + 1 };
  assert.throws(() => assertNativeAuditBudget(packageOver), { code: "native_audit_budget_exceeded" });
  assert.equal(databaseBudgetDiagnostic(packageOver).reason, "package_total");

  for (const index of [0, 2]) {
    const sizes = [1, 1, 1, 1];
    sizes[index] = 2 * GiB;
    assertNativeAuditBudget({ matrixBytes: 1, binarySizes: [1, 1, 1, 1], fixtureBytes: 1, databaseSizes: sizes });
    sizes[index] += 1;
    assert.equal(databaseBudgetDiagnostic({ matrixBytes: 1, binarySizes: [1, 1, 1, 1], fixtureBytes: 1, databaseSizes: sizes }).reason, "per_file");
  }
  for (const index of [1, 3]) {
    const sizes = [1, 1, 1, 1];
    sizes[index] = 8 * 1024 ** 2;
    assertNativeAuditBudget({ matrixBytes: 1, binarySizes: [1, 1, 1, 1], fixtureBytes: 1, databaseSizes: sizes });
    sizes[index] += 1;
    assert.equal(databaseBudgetDiagnostic({ matrixBytes: 1, binarySizes: [1, 1, 1, 1], fixtureBytes: 1, databaseSizes: sizes }).reason, "per_file");
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

test("native audit closes subject, database and home scratch inventories", async () => {
  const owned = await createOwnedDirectory();
  try {
    const subjectWork = path.join(owned.path, "subject-work");
    const subject = path.join(subjectWork, "subject");
    await mkdir(subject, { recursive: true });
    const binary = path.join(subject, "tool");
    await writeFile(binary, "native");
    const identity = await hashFileBounded(binary, 1024);
    await verifyNativeSubjectWork(subjectWork, "tool", identity);
    await writeFile(path.join(subjectWork, "extra"), "sentinel");
    await assert.rejects(verifyNativeSubjectWork(subjectWork, "tool", identity), { code: "native_audit_scratch_inventory_refused" });

    const cache = path.join(owned.path, "cache");
    await mkdir(path.join(cache, "db"), { recursive: true });
    await mkdir(path.join(cache, "java-db"), { recursive: true });
    const files = {
      database: ["db/trivy.db", "vulnerability"], databaseMetadata: ["db/metadata.json", "vulnerability-metadata"],
      javaDatabase: ["java-db/trivy-java.db", "java"], javaDatabaseMetadata: ["java-db/metadata.json", "java-metadata"],
    };
    const identities = {};
    for (const [key, [relative, bytes]] of Object.entries(files)) {
      const file = path.join(cache, relative);
      await writeFile(file, bytes);
      identities[key] = await hashFileBounded(file, 1024);
    }
    await verifyNativeDatabaseCache(cache, identities);
    await writeFile(path.join(cache, "unexpected"), "sentinel");
    await assert.rejects(verifyNativeDatabaseCache(cache, identities), { code: "native_database_inventory_refused" });
    await rm(path.join(cache, "unexpected"));
    await writeFile(path.join(cache, "db/trivy.db"), "growth");
    await assert.rejects(verifyNativeDatabaseCache(cache, identities), { code: "native_database_identity_refused" });

    const home = path.join(owned.path, "home");
    await mkdir(home);
    await verifyNativeEmptyDirectory(home);
    await writeFile(path.join(home, "unexpected"), "sentinel");
    await assert.rejects(verifyNativeEmptyDirectory(home), { code: "native_audit_scratch_inventory_refused" });
  } finally { await removeOwnedDirectory(owned); }
});

test("owned audit work cleans sequentially, preserves siblings and refuses cleanup failure", async () => {
  const parent = await createOwnedDirectory();
  try {
    const sibling = path.join(parent.path, "sibling-sentinel");
    await writeFile(sibling, "keep");
    const beforeInvalidLifecycle = await readdir(parent.path);
    await assert.rejects(runOwnedAuditWork(parent.path, async () => {}, Object.freeze({})), { code: "native_audit_lifecycle_invalid" });
    assert.deepEqual(await readdir(parent.path), beforeInvalidLifecycle);
    let first;
    await runOwnedAuditWork(parent.path, async ({ path: directory }) => {
      first = directory;
      await writeFile(path.join(directory, "work"), "one");
    });
    await assert.rejects(hashFileBounded(path.join(first, "work"), 16));
    await runOwnedAuditWork(parent.path, async ({ path: directory }) => {
      assert.notEqual(directory, first);
      await writeFile(path.join(directory, "work"), "two");
    });
    const operationFailure = new Error("operation-failed");
    let failedWork;
    await assert.rejects(runOwnedAuditWork(parent.path, async ({ path: directory }) => {
      failedWork = directory;
      await writeFile(path.join(directory, "work"), "three");
      throw operationFailure;
    }), (error) => error === operationFailure);
    await assert.rejects(lstat(failedWork), { code: "ENOENT" });
    assert.equal((await hashFileBounded(sibling, 16)).size, 4);
    await assert.rejects(runOwnedAuditWork(parent.path, async (handle) => {
      await rm(handle.path, { recursive: true });
      return { status: "passed" };
    }), { code: "native_audit_cleanup_failed" });
    assert.equal((await hashFileBounded(sibling, 16)).size, 4);
  } finally { await removeOwnedDirectory(parent); }
});

test("native audit orchestration publishes only after every required scratch owner is released", async () => {
  const parent = await createOwnedDirectory();
  try {
    const sibling = path.join(parent.path, "sibling-sentinel");
    await writeFile(sibling, "keep");
    const invalidInput = { runnerTemp: parent.path, scanner: path.join(parent.path, "scanner"), cacheDirectory: path.join(parent.path, "cache"),
      workspace: path.join(parent.path, "workspace"), environment: {}, deadline: Date.now() + 10_000 };
    const beforeInvalid = await readdir(parent.path);
    await assert.rejects(runTrackedScannerFixtures({ ...invalidInput, extra: true }, Object.freeze({}), async () => {}),
      { code: "native_audit_lifecycle_invalid" });
    await assert.rejects(runTrackedScannerFixtures(invalidInput, Object.freeze({}), null), { code: "native_audit_lifecycle_invalid" });
    assert.deepEqual(await readdir(parent.path), beforeInvalid);
    const run = async (name, behavior) => {
      const destination = path.join(parent.path, name);
      let published = 0;
      let work;
      let residual;
      const operationError = new Error("ordinary-operation-failure");
      const collect = async (audit, _progress, lifecycle) => {
        await runTrackedScannerFixtures({ runnerTemp: parent.path, scanner: path.join(parent.path, "scanner"),
          cacheDirectory: path.join(parent.path, "cache"), workspace: audit.path, environment: {}, deadline: Date.now() + 10_000 },
        lifecycle, async (input) => {
          assert.deepEqual(Object.keys(input), ["scanner", "cacheDirectory", "workspace", "scratch", "environment", "deadline"]);
          work = input.scratch;
          assert.equal(await realpath(work), work);
          assert.equal(path.dirname(work), parent.path);
          assert.equal(path.dirname(input.workspace), parent.path);
          assert.equal(await readdir(work).then((entries) => entries.length), 0);
          await writeFile(path.join(work, "work"), name);
          if (behavior === "operation-error") throw operationError;
          if (behavior === "fixture-cleanup-error") {
            residual = path.join(parent.path, `${name}-residual`);
            assert.equal(path.dirname(path.resolve(residual)), parent.path);
            await rename(work, residual);
          }
        });
        return { expectedFiles: [], results: [] };
      };
      const publish = async ({ status }) => {
        published += 1;
        await assert.rejects(lstat(work), { code: "ENOENT" });
        assert.equal(status, behavior === "operation-error" ? "failed" : "passed");
        await mkdir(destination);
      };
      let failure;
      try { await runNativeAuditOrchestration({ runnerTemp: parent.path, destination, collect, publish }); }
      catch (error) { failure = error; }
      return { destination, failure, operationError, published, residual, work };
    };

    const success = await run("success-public", "success");
    assert.equal(success.failure, undefined);
    assert.equal(success.published, 1);
    assert.ok((await lstat(success.destination)).isDirectory());

    const ordinary = await run("failure-public", "operation-error");
    assert.equal(ordinary.failure, ordinary.operationError);
    assert.equal(ordinary.published, 1);
    assert.ok((await lstat(ordinary.destination)).isDirectory());

    const cleanup = await run("fixture-cleanup-must-not-publish", "fixture-cleanup-error");
    assert.equal(cleanup.failure?.code, "native_audit_cleanup_failed");
    assert.equal(cleanup.published, 0);
    await assert.rejects(lstat(cleanup.destination), { code: "ENOENT" });
    await assert.rejects(lstat(cleanup.work), { code: "ENOENT" });
    assert.equal((await lstat(path.join(cleanup.residual, "work"))).isFile(), true);
    await rm(cleanup.residual, { recursive: true });
    assert.equal((await hashFileBounded(sibling, 16)).size, 4);
  } finally { await removeOwnedDirectory(parent); }
});

test("database cache rejects hard-linked substitutions", async () => {
  const owned = await createOwnedDirectory();
  try {
    const cache = path.join(owned.path, "cache");
    await mkdir(path.join(cache, "db"), { recursive: true });
    await mkdir(path.join(cache, "java-db"), { recursive: true });
    const original = path.join(owned.path, "outside");
    await writeFile(original, "same");
    await link(original, path.join(cache, "db/trivy.db"));
    await writeFile(path.join(cache, "db/metadata.json"), "meta");
    await writeFile(path.join(cache, "java-db/trivy-java.db"), "java");
    await writeFile(path.join(cache, "java-db/metadata.json"), "meta");
    await assert.rejects(verifyNativeDatabaseCache(cache), { code: "native_database_inventory_refused" });
  } finally { await removeOwnedDirectory(owned); }
});
