import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compareBuilds, comparisonReceiptBytes, parseCompareArguments, productionMaterialContract, runComparison } from "../scripts/seaweed/compare.mjs";
import { EC_PACKAGE, EC_TESTS, summarizeEcPreflight } from "../scripts/seaweed/ec-preflight.mjs";
import { BASELINE_COPYLOCKS, requireBaselineCopylocks } from "../scripts/seaweed/copylocks.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lockBytes = readFileSync(path.join(repositoryRoot, "infra/seaweed/seaweed-lock.json"));
const lock = JSON.parse(lockBytes);
const codeSha = "b".repeat(40);
const requiredTests = JSON.parse(readFileSync(path.join(repositoryRoot, lock.requiredTests.path)));
const pristineSum = readFileSync(path.join(repositoryRoot, "tests/fixtures/seaweed-source/upstream/go.sum"));
const keys = (entries) => entries.map((entry) => `${entry.package}:${entry.name}`);
const groups = { normal: [...keys(requiredTests.required.redis), ...keys(requiredTests.required.nonShortIntegration), ...keys(requiredTests.required.copylocks)],
  fullTags: [...keys(requiredTests.required.redis), ...keys(requiredTests.required.nonShortIntegration), ...keys(requiredTests.required.copylocks)], projectGrpc: keys(requiredTests.required.seaweedGrpc) };
const phases = ["compiler_download", "compiler_extract", "compiler_identity", "compiler_work_cleanup", "source_checkout", "source_bundle", "source_bundle_verify", "source_restore", "source_restore_patch", "source_restore_cleanup", "patch_apply", "tidy_diff", "module_isolation_prepare", "module_download", "module_verify", "module_material_retention", "production_build", "binary_work_cleanup", "test_preflight", "ec_corrected_cache_cleanup", "redis_helper", "normal_tests", "normal_tests_cache_cleanup", "full_tag_tests", "full_tag_tests_cache_cleanup", "project_grpc_tests", "vet", "grpc_transport_tests", "post_test_module_download", "post_test_module_verify", "redis_cleanup", "work_cleanup", "cleanup"];
const isolationSteps = ["module_download", "module_verify", "post_test_module_download", "post_test_module_verify"];
phases.splice(phases.indexOf("binary_work_cleanup"), 1);
phases.splice(phases.indexOf("redis_cleanup"), 0, "post_test_cache_cleanup", "module_archive_retention", "binary_work_cleanup");
phases.splice(phases.indexOf("patch_apply"), 0, "ec_baseline_build", "ec_baseline_tests", "baseline_vet_diagnostic", "ec_baseline_cleanup");
phases.push("ec_corrected_tests");
const ecLog = Buffer.from([...EC_TESTS.map((Test) => ({ Package: EC_PACKAGE, Test, Action: "pass" })), { Package: EC_PACKAGE, Action: "pass" }].map(JSON.stringify).join("\n") + "\n");
const baselineVetLog = (lines = BASELINE_COPYLOCKS) => Buffer.from(`${lines.join("\n")}\n`);
const knownDownloads = pristineSum.toString("utf8").split("\n").flatMap((line) => {
  const match = /^(\S+) (\S+) h1:/u.exec(line); return match && !match[2].endsWith("/go.mod") ? [`${match[1]} ${match[2]}`] : [];
}).slice(0, 2);
const serverLog = Buffer.from("seaweed-server-logs:v1\nfiles=0\nsourceBytes=0\n");

function goLog(required) { return Buffer.from(required.map((key) => { const split = key.lastIndexOf(":"); return JSON.stringify({ Action: "pass", Package: key.slice(0, split), Test: key.slice(split + 1) }); }).join("\n") + "\n"); }

function fixture(root, repeat, bytes = Buffer.from("binary"), { downloads = [] } = {}) {
  const directory = path.join(root, `seaweed-build-${repeat}`); mkdirSync(directory);
  const binary = "/tmp/auto-world-seaweed-source-diagnostic/bin/weed";
  const buildInfo = [`${binary}: go${lock.compiler.version}`, `\tdep\tgoogle.golang.org/grpc\t${lock.grpc.version}\t${lock.grpc.sum}`, "\tbuild\t-compiler=gc", `\tbuild\t-ldflags=${JSON.stringify(lock.build.ldflags)}`, "\tbuild\tCGO_ENABLED=0", "\tbuild\tGOARCH=amd64", "\tbuild\tGOOS=linux", "\tbuild\tGOAMD64=v1", `\tbuild\tvcs.revision=${lock.source.commit}`, "\tbuild\tvcs.modified=true"].join("\n");
  const summary = Object.fromEntries(Object.entries(groups).map(([key, required]) => [key, { requiredPassed: required.length, skips: [] }]));
  const files = new Map([["weed", bytes], ["go-build-info.txt", Buffer.from(buildInfo)], ["test-summary.json", Buffer.from(JSON.stringify(summary))],
    ["logs/01-normal_tests.log", goLog(groups.normal)], ["logs/02-normal_tests_stderr.log", Buffer.from("successful diagnostic warning\n")],
    ["logs/03-full_tag_tests.log", goLog(groups.fullTags)], ["logs/04-project_grpc_tests.log", goLog(groups.projectGrpc)]]);
  for (const name of ["go1.26.8.linux-amd64.tar.gz", "seaweedfs-source.bundle", "seaweedfs-grpc.patch", "module-changes.tsv", "required-tests.json", "DERIVATIVE-NOTICE.txt"]) files.set(`materials/${name}`, Buffer.from(name));
  files.set("materials/seaweedfs-source-shallow.txt", Buffer.from(`${lock.source.commit}\n`));
  for (const name of ["LICENSE", "weed/glog/LICENSE", "docker/Dockerfile.go_build", ".github/workflows/go.yml", ".github/workflows/container_release_unified.yml"]) files.set(`materials/upstream/${name}`, Buffer.from(name));
  const id = "a".repeat(64); const moduleFiles = {};
  for (const name of ["source.zip", "module.mod", "module.info"]) {
    const value = Buffer.from(name); files.set(`materials/modules/${id}/${name}`, value); moduleFiles[name] = { sha256: sha256(value), size: value.length };
  }
  const notices = [{ archiveEntry: "LICENSE", file: "notice-001.txt" }, { archiveEntry: "NOTICE.txt", file: "notice-002.txt" }].map((notice) => {
    const value = Buffer.from(notice.archiveEntry); files.set(`materials/modules/${id}/${notice.file}`, value); return { ...notice, sha256: sha256(value), size: value.length };
  });
  files.set("module-closure.json", Buffer.from(JSON.stringify([{ id, path: "google.golang.org/grpc", files: moduleFiles, notices }])));
  for (const [index, arm] of ["baseline", "corrected"].entries()) files.set(`logs/0${index + 5}-ec_${arm}_tests.log`, ecLog);
  for (const [index, arm] of ["baseline", "corrected"].entries()) files.set(`logs/0${index + 7}-ec_${arm}_server_logs.log`, serverLog);
  const vetLog = baselineVetLog([...downloads.map((entry) => `go: downloading ${entry}`), ...BASELINE_COPYLOCKS]);
  files.set("logs/09-baseline_vet_diagnostic.log", vetLog);
  for (const [name, value] of files) { const target = path.join(directory, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, value); }
  const inventory = [...files].map(([name, value]) => ({ path: name.replaceAll("\\", "/"), sha256: sha256(value), size: value.length })).sort((a, b) => a.path.localeCompare(b.path, "en"));
  writeFileSync(path.join(directory, "material-inventory.json"), `${JSON.stringify(inventory)}\n`);
  const receipt = {
    schemaVersion: 1, result: "PASSED", repeat, sourceCommit: lock.source.commit, sourceTree: lock.source.tree, derivativeCommit: lock.build.commitValue,
    lock: { sha256: sha256(lockBytes), size: lockBytes.length }, patch: { sha256: lock.patch.sha256, size: lock.patch.size },
    compiler: { archive: { sha256: lock.compiler.sha256, size: lock.compiler.size }, version: `go version go${lock.compiler.version} linux/amd64` },
    codeCheckout: { repository: "CleMeY15/auto-world", ref: "refs/heads/main", sha: codeSha, actualSha: codeSha },
    workflowRun: { runId: "123", attempt: "1", job: "build" }, runtime: { node: "v22.23.2", platform: "linux", architecture: "x64", imageOS: "ubuntu24", imageVersion: "1" },
    tools: { curl: "curl 1", docker: "28", git: "git 2", tar: "tar 1", unzip: "UnZip 1" },
    moduleClosure: { result: "UNCHANGED_AFTER_TESTS", count: 1, grpcVersion: lock.grpc.version },
    moduleMaterials: { total: 1, completed: 1, current: null },
    moduleArchives: { total: 1, completed: 1, current: null, totalBytes: moduleFiles["source.zip"].size, retainedBytes: moduleFiles["source.zip"].size },
    moduleIsolation: { result: "PASSED", checkpoints: isolationSteps.map((name) => ({ name, result: "PASSED", source: "UNCHANGED", alternateMod: "UNCHANGED", alternateSum: { sha256: "c".repeat(64), size: 289700 }, additionalSumLines: 2 })) },
    sourceRetention: { bundle: { sha256: sha256(files.get("materials/seaweedfs-source.bundle")), size: files.get("materials/seaweedfs-source.bundle").length }, shallow: { sha256: sha256(files.get("materials/seaweedfs-source-shallow.txt")), size: files.get("materials/seaweedfs-source-shallow.txt").length }, restoration: "PASSED", commitUnixTime: String(lock.source.commitUnixTime) },
    sourcePatchFiles: { checkpoints: [["checkout", "before"], ["restoration_before", "before"], ["restoration_after", "after"], ["prepatch", "before"],
      ["after_patch", "after"], ["prebuild", "after"], ["post_ec", "after"], ["post_tests", "after"], ["final", "after"]]
      .map(([name, state]) => ({ name, state, files: lock.sourcePatchFiles[state] })) },
    phases: phases.map((name) => ({ name, result: "PASSED", durationMs: 1 })),
    ecPreflight: {
      baseline: { binary: { sha256: "d".repeat(64), size: 123 }, modules: lock.moduleFiles.before, ...summarizeEcPreflight(ecLog, 0) },
      corrected: { binary: { sha256: sha256(bytes), size: bytes.length }, modules: lock.moduleFiles.after, ...summarizeEcPreflight(ecLog, 0) },
    },
    serverLogs: ["baseline", "corrected"].map((arm) => ({ phase: `ec_${arm}`, result: "PASSED", bytes: serverLog.length })),
    baselineVet: requireBaselineCopylocks(vetLog, { status: 1, groupAbsent: true }, pristineSum),
    cacheCleanup: ["corrected_ec", "normal_tests", "full_tag_tests", "post_tests"].map((boundary) => ({ boundary, entries: { gocache: { beforeBytes: 10, afterBytes: 0 }, tmp: { beforeBytes: 5, afterBytes: 0 } }, beforeBytes: 15, afterBytes: 0, freedBytes: 15 })),
    testSummary: summary,
  };
  writeFileSync(path.join(directory, "build-receipt.json"), `${JSON.stringify(receipt)}\n`);
  return directory;
}

function fixtureMaterialContract(directory) {
  const inventory = JSON.parse(readFileSync(path.join(directory, "material-inventory.json"), "utf8"));
  const required = new Set(["materials/go1.26.8.linux-amd64.tar.gz", "materials/seaweedfs-source-shallow.txt", "materials/seaweedfs-grpc.patch", "materials/module-changes.tsv", "materials/required-tests.json", "materials/DERIVATIVE-NOTICE.txt", ...lock.upstreamMaterials.map((entry) => `materials/upstream/${entry.path}`)]);
  return new Map(inventory.filter((entry) => required.has(entry.path)).map(({ path: name, sha256: hash, size }) => [name, { sha256: hash, size }]));
}

function compareFixtures(first, second, expected = {}) { return compareBuilds(first, second, expected, fixtureMaterialContract(first)); }

function rewriteInventoryEntry(directory, name) {
  const inventoryPath = path.join(directory, "material-inventory.json"); const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")); const bytes = readFileSync(path.join(directory, name));
  const entry = inventory.find((candidate) => candidate.path === name); entry.sha256 = sha256(bytes); entry.size = bytes.length; writeFileSync(inventoryPath, JSON.stringify(inventory));
}

test("production material contract contains only artifact digest and size descriptors", () => {
  const contract = productionMaterialContract();
  assert.equal(contract.get("materials/seaweedfs-grpc.patch").sha256, lock.patch.sha256);
  assert.equal(contract.get("materials/module-changes.tsv").size, lock.moduleChanges.size);
  for (const descriptor of contract.values()) assert.deepEqual(Object.keys(descriptor).sort(), ["sha256", "size"]);
});

test("comparison reads both real artifacts and compares actual binary bytes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-"));
  const first = fixture(root, 1); const second = fixture(root, 2);
  const result = compareFixtures(first, second);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.result, "PASSED");
  assert.equal(result.compared.some((entry) => entry.path === "weed"), true);
  writeFileSync(path.join(second, "weed"), "mutated");
  assert.throws(() => compareFixtures(first, second), /seaweed_artifact_inventory_changed/u);
  rmSync(root, { recursive: true, force: true });
});

test("comparison retains both runner revisions without treating imageVersion as a shared build input", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-runtime-"));
  try {
    const first = fixture(root, 1); const second = fixture(root, 2);
    const runtimes = [];
    for (const [index, directory] of [first, second].entries()) {
      const file = path.join(directory, "build-receipt.json");
      const receipt = JSON.parse(readFileSync(file));
      receipt.runtime.imageVersion = index === 0 ? "20260907.300.1" : "20260920.314.1";
      runtimes.push({ repeat: index + 1, ...receipt.runtime });
      writeFileSync(file, JSON.stringify(receipt));
    }
    const result = compareFixtures(first, second);
    assert.equal(result.schemaVersion, 2);
    assert.deepEqual(result.provenance.runtimes, runtimes);
    assert.equal(Object.hasOwn(result.provenance, "runtime"), false);
    const file = path.join(second, "build-receipt.json");
    const receipt = JSON.parse(readFileSync(file)); receipt.runtime.imageVersion = runtimes[0].imageVersion;
    writeFileSync(file, JSON.stringify(receipt));
    assert.deepEqual(compareFixtures(first, second).provenance.runtimes,
      [runtimes[0], { ...runtimes[0], repeat: 2 }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("comparison rejects changed shared runtime dimensions, unknown fields and tool drift", () => {
  const mutations = [
    (receipt) => { delete receipt.runtime.imageVersion; },
    (receipt) => { receipt.runtime.extra = "hidden"; },
    (receipt) => { receipt.runtime.imageVersion = ""; },
    (receipt) => { receipt.runtime.node = "v24.18.0"; },
    (receipt) => { receipt.runtime.architecture = "arm64"; },
    (receipt) => { receipt.runtime.platform = "darwin"; },
    (receipt) => { receipt.runtime.imageOS = "ubuntu22"; },
    (receipt) => { receipt.tools.git = "different observed version"; },
  ];
  for (const mutate of mutations) {
    const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-runtime-invalid-"));
    try {
      const first = fixture(root, 1); const second = fixture(root, 2);
      const file = path.join(second, "build-receipt.json");
      const receipt = JSON.parse(readFileSync(file)); mutate(receipt); writeFileSync(file, JSON.stringify(receipt));
      assert.throws(() => compareFixtures(first, second), /seaweed_compare_provenance_(?:invalid|changed)/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("comparison rejects missing, failed, and substituted second evidence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-"));
  const first = fixture(root, 1); const second = fixture(root, 2);
  const receiptPath = path.join(second, "build-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")); receipt.result = "FAILED"; writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => compareFixtures(first, second), /seaweed_failed_artifact_unsafe/u);
  rmSync(second, { recursive: true, force: true });
  assert.throws(() => compareFixtures(first, second), /seaweed_compare_input_invalid/u);
  rmSync(root, { recursive: true, force: true });
});

test("comparison rejects matching candidate claims that do not match the current run", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-")); const first = fixture(root, 1); const second = fixture(root, 2);
  assert.throws(() => compareFixtures(first, second, { repository: "CleMeY15/auto-world", ref: "refs/heads/main", codeSha: "c".repeat(40), runId: "123", attempt: "1" }), /seaweed_compare_current_run_invalid/u);
  const receiptPath = path.join(second, "build-receipt.json"); const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  receipt.compiler.archive.sha256 = "0".repeat(64); writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => compareFixtures(first, second), /seaweed_compare_provenance_invalid/u);
  rmSync(root, { recursive: true, force: true });
});

test("comparison rejects fabricated phases, tools, test summaries, build metadata, and remanifested locked materials", () => {
  const cases = [
    (directory) => { const file = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(file)); receipt.phases = []; writeFileSync(file, JSON.stringify(receipt)); },
    (directory) => { const file = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(file)); receipt.tools = {}; writeFileSync(file, JSON.stringify(receipt)); },
    (directory) => { const file = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(file)); receipt.moduleIsolation.checkpoints.pop(); writeFileSync(file, JSON.stringify(receipt)); },
    (directory) => { writeFileSync(path.join(directory, "test-summary.json"), JSON.stringify({ normal: { requiredPassed: 31, skips: ["fabricated"] }, fullTags: { requiredPassed: 31, skips: [] }, projectGrpc: { requiredPassed: 12, skips: [] } })); rewriteInventoryEntry(directory, "test-summary.json"); },
    (directory) => { writeFileSync(path.join(directory, "go-build-info.txt"), "fabricated"); rewriteInventoryEntry(directory, "go-build-info.txt"); },
    (directory) => { writeFileSync(path.join(directory, "materials/seaweedfs-grpc.patch"), "fabricated"); rewriteInventoryEntry(directory, "materials/seaweedfs-grpc.patch"); },
  ];
  for (const mutate of cases) {
    const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-")); const first = fixture(root, 1); const second = fixture(root, 2); mutate(second);
    assert.throws(() => compareFixtures(first, second), /seaweed_(?:compare|build_info)_/u); rmSync(root, { recursive: true, force: true });
  }
});

test("comparison rejects matching fabricated mandatory evidence in both builds", () => {
  for (const mutate of [
    (receipt) => { receipt.phases = []; },
    (receipt) => { receipt.tools = {}; },
    (receipt) => { receipt.phases = receipt.phases.filter(({ name }) => name !== "module_material_retention"); },
    ...["compiler_work_cleanup", "source_restore_cleanup", "binary_work_cleanup", "ec_corrected_cache_cleanup", "normal_tests_cache_cleanup", "full_tag_tests_cache_cleanup"].map((required) => (receipt) => { receipt.phases = receipt.phases.filter(({ name }) => name !== required); }),
    (receipt) => { delete receipt.moduleMaterials; },
    (receipt) => { receipt.moduleMaterials.completed = 0; },
    (receipt) => { receipt.moduleMaterials.current = { module: 1, operation: "notice", notice: 1 }; },
    (receipt) => { receipt.moduleMaterials.total = 2; receipt.moduleMaterials.completed = 2; receipt.moduleClosure.count = 2; },
    (receipt) => { delete receipt.ecPreflight; },
    (receipt) => { receipt.ecPreflight.baseline.result = "FAILED"; },
    (receipt) => { receipt.ecPreflight.corrected.tests.pop(); },
    (receipt) => { receipt.ecPreflight.corrected.binary.sha256 = "a".repeat(64); },
    (receipt) => { receipt.ecPreflight.baseline.modules = lock.moduleFiles.after; },
    (receipt) => { receipt.serverLogs = []; },
    (receipt) => { receipt.serverLogs[0].bytes += 1; },
    (receipt) => { receipt.phases = receipt.phases.filter(({ name }) => name !== "ec_baseline_cleanup"); },
    (receipt) => { delete receipt.sourcePatchFiles; },
    (receipt) => { receipt.sourcePatchFiles.checkpoints[0].files = lock.sourcePatchFiles.after; },
    (receipt) => { delete receipt.baselineVet; },
    (receipt) => { receipt.baselineVet.log.sha256 = "0".repeat(64); },
    (receipt) => { delete receipt.cacheCleanup; },
    (receipt) => { receipt.cacheCleanup[1].freedBytes += 1; },
    (receipt) => { receipt.cacheCleanup.pop(); },
    ...["post_test_cache_cleanup", "module_archive_retention"].map((required) => (receipt) => { receipt.phases = receipt.phases.filter(({ name }) => name !== required); }),
    (receipt) => { delete receipt.moduleArchives; },
    (receipt) => { receipt.moduleArchives.completed = 0; },
    (receipt) => { receipt.moduleArchives.total = 2; receipt.moduleArchives.completed = 2; },
    (receipt) => { receipt.moduleArchives.current = 1; },
    (receipt) => { receipt.moduleArchives.totalBytes += 1; },
    (receipt) => { receipt.moduleArchives.retainedBytes -= 1; },
    (receipt) => { delete receipt.testSummary; },
  ]) {
    const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-")); const first = fixture(root, 1); const second = fixture(root, 2);
    for (const directory of [first, second]) {
      const file = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(file)); mutate(receipt); writeFileSync(file, JSON.stringify(receipt));
    }
    assert.throws(() => compareFixtures(first, second), /seaweed_compare_(?:phases|provenance|module_materials|module_archives|ec_preflight|source_patch_files|baseline_vet|cache_cleanup|test_summary)_invalid/u);
    rmSync(root, { recursive: true, force: true });
  }
});

test("comparison validates authentic baseline downloads independently in both arms", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-downloads-"));
  try {
    const first = fixture(root, 1, Buffer.from("binary"), { downloads: [knownDownloads[0]] });
    const second = fixture(root, 2, Buffer.from("binary"), { downloads: [knownDownloads[1]] });
    assert.doesNotThrow(() => compareFixtures(first, second));
    for (const directory of [first, second]) {
      const file = path.join(directory, "logs/09-baseline_vet_diagnostic.log");
      writeFileSync(file, baselineVetLog(["go: downloading example.invalid/unknown v1.0.0", ...BASELINE_COPYLOCKS]));
      rewriteInventoryEntry(directory, "logs/09-baseline_vet_diagnostic.log");
      assert.throws(() => compareFixtures(first, second), /seaweed_compare_baseline_vet_invalid/u);
      const download = directory === first ? knownDownloads[0] : knownDownloads[1];
      writeFileSync(file, baselineVetLog([`go: downloading ${download}`, ...BASELINE_COPYLOCKS])); rewriteInventoryEntry(directory, "logs/09-baseline_vet_diagnostic.log");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("comparison reparses the retained baseline vet log instead of trusting a remanifested receipt", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-baseline-vet-"));
  try {
    const first = fixture(root, 1); const second = fixture(root, 2);
    for (const directory of [first, second]) {
      const logPath = path.join(directory, "logs/09-baseline_vet_diagnostic.log");
      const changed = Buffer.from(`${BASELINE_COPYLOCKS.slice(1).join("\n")}\n`); writeFileSync(logPath, changed); rewriteInventoryEntry(directory, "logs/09-baseline_vet_diagnostic.log");
      const receiptPath = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(receiptPath));
      receipt.baselineVet.log = { sha256: sha256(changed), size: changed.length }; receipt.baselineVet.diagnostics = BASELINE_COPYLOCKS.slice(1);
      writeFileSync(receiptPath, JSON.stringify(receipt));
    }
    assert.throws(() => compareFixtures(first, second), /seaweed_compare_baseline_vet_invalid/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("comparison rejects early archive retention and reordered test or finalization phases in both receipts", () => {
  for (const [moved, before] of [["baseline_vet_diagnostic", "ec_baseline_tests"], ["ec_baseline_cleanup", "baseline_vet_diagnostic"],
    ["patch_apply", "ec_baseline_cleanup"], ["module_archive_retention", "production_build"], ["post_test_module_verify", "full_tag_tests"],
    ["post_test_cache_cleanup", "post_test_module_verify"], ["binary_work_cleanup", "module_archive_retention"], ["full_tag_tests", "normal_tests"]]) {
    const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-phase-order-"));
    try {
      const first = fixture(root, 1); const second = fixture(root, 2);
      for (const directory of [first, second]) {
        const file = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(file));
        const [entry] = receipt.phases.splice(receipt.phases.findIndex(({ name }) => name === moved), 1);
        receipt.phases.splice(receipt.phases.findIndex(({ name }) => name === before), 0, entry);
        writeFileSync(file, JSON.stringify(receipt));
      }
      assert.throws(() => compareFixtures(first, second), /seaweed_compare_phases_invalid/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("comparison rejects omitted, duplicated and truncated archives despite matching receipts and inventories", () => {
  for (const mutation of ["omit", "duplicate", "truncate"]) {
    const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-archives-"));
    try {
      const first = fixture(root, 1); const second = fixture(root, 2);
      for (const directory of [first, second]) {
        const closureFile = path.join(directory, "module-closure.json"); const modules = JSON.parse(readFileSync(closureFile));
        const zipName = `materials/modules/${modules[0].id}/source.zip`;
        if (mutation === "omit") {
          delete modules[0].files["source.zip"]; rmSync(path.join(directory, zipName));
          const file = path.join(directory, "material-inventory.json");
          writeFileSync(file, JSON.stringify(JSON.parse(readFileSync(file)).filter(({ path: name }) => name !== zipName)));
        } else if (mutation === "duplicate") {
          modules.push(modules[0]);
          const file = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(file));
          receipt.moduleClosure.count = 2; receipt.moduleMaterials.total = 2; receipt.moduleMaterials.completed = 2;
          receipt.moduleArchives.total = 2; receipt.moduleArchives.completed = 2;
          receipt.moduleArchives.totalBytes *= 2; receipt.moduleArchives.retainedBytes *= 2; writeFileSync(file, JSON.stringify(receipt));
        } else {
          writeFileSync(path.join(directory, zipName), "short"); rewriteInventoryEntry(directory, zipName);
        }
        writeFileSync(closureFile, JSON.stringify(modules)); rewriteInventoryEntry(directory, "module-closure.json");
      }
      assert.throws(() => compareFixtures(first, second), /seaweed_(?:compare_module_archives_invalid|artifact_required_missing)/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("comparison rejects internally consistent cleanup evidence above the locked budget", () => {
  for (const extra of [0, 1]) {
    const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-cache-cap-"));
    try {
      const first = fixture(root, 1); const second = fixture(root, 2);
      for (const directory of [first, second]) {
        const file = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(file));
        const cleanup = receipt.cacheCleanup[1];
        cleanup.entries.gocache.beforeBytes = lock.limits.workBytes;
        cleanup.entries.tmp.beforeBytes = extra;
        cleanup.beforeBytes = lock.limits.workBytes + extra;
        cleanup.freedBytes = cleanup.beforeBytes;
        writeFileSync(file, JSON.stringify(receipt));
      }
      if (extra) assert.throws(() => compareFixtures(first, second), /seaweed_compare_cache_cleanup_invalid/u);
      else assert.doesNotThrow(() => compareFixtures(first, second));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("comparison rejects a substituted retained source bundle even when its inventory and receipt are remanifested", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-")); const first = fixture(root, 1); const second = fixture(root, 2);
  const bundle = path.join(second, "materials/seaweedfs-source.bundle"); writeFileSync(bundle, "substituted-bundle"); rewriteInventoryEntry(second, "materials/seaweedfs-source.bundle");
  const receiptPath = path.join(second, "build-receipt.json"); const receipt = JSON.parse(readFileSync(receiptPath)); const bytes = readFileSync(bundle);
  receipt.sourceRetention.bundle = { sha256: sha256(bytes), size: bytes.length }; writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => compareFixtures(first, second), /seaweed_compare_bytes_changed:materials\/seaweedfs-source\.bundle/u);
  rmSync(root, { recursive: true, force: true });
});

test("comparison rejects unrecorded files and writes a bounded sanitized failure receipt", () => {
  const runnerTemp = mkdtempSync(path.join(tmpdir(), "seaweed-runner-")); const buildRoot = path.join(runnerTemp, "builds"); mkdirSync(buildRoot);
  fixture(buildRoot, 1); const second = fixture(buildRoot, 2); writeFileSync(path.join(second, "unrecorded"), "private");
  assert.throws(() => compareFixtures(path.join(buildRoot, "seaweed-build-1"), second), /seaweed_artifact_allowlist_invalid/u);
  const output = path.join(runnerTemp, "seaweed-comparison.json");
  const env = { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: "compare", GITHUB_SHA: codeSha, GITHUB_RUN_ID: "123", RUNNER_TEMP: runnerTemp };
  assert.throws(() => runComparison({ argv: ["--build-root", buildRoot, "--output", output], env, platform: "linux" }), /seaweed_compare_material_contract_invalid/u);
  const receipt = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(receipt, { schemaVersion: 2, state: "DIAGNOSTIC_ONLY", result: "FAILED", reason: "seaweed_compare_material_contract_invalid" });
  assert.ok(readFileSync(output).length < 1024 ** 2);
  rmSync(runnerTemp, { recursive: true, force: true });
});

test("comparison CLI accepts only fixed absolute build-root and output arguments", () => {
  const buildRoot = path.resolve(tmpdir(), "builds"); const output = path.resolve(tmpdir(), "comparison.json");
  assert.deepEqual(parseCompareArguments(["--build-root", buildRoot, "--output", output]), { buildRoot, output });
  assert.throws(() => parseCompareArguments(["--build-root", "relative", "--output", output]), /seaweed_compare_arguments_invalid/u);
});

test("compact comparison receipt retains a full module inventory under the unchanged byte cap", () => {
  const result = { schemaVersion: 2, state: "DIAGNOSTIC_ONLY", result: "PASSED",
    compared: Array.from({ length: 4817 }, (_, index) => ({
      path: `materials/modules/${index.toString(16).padStart(64, "0")}/notice-001.txt`, sha256: "b".repeat(64), size: 1234,
    })) };
  assert(Buffer.byteLength(JSON.stringify(result, null, 2) + "\n") > 1024 ** 2);
  const bytes = comparisonReceiptBytes(result);
  assert(bytes.length <= 1024 ** 2);
  assert.deepEqual(JSON.parse(bytes), result);
  assert.equal(bytes.at(-1), 10);
  assert.throws(() => comparisonReceiptBytes({ ...result, extra: "x".repeat(1024 ** 2) }), /seaweed_compare_receipt_oversized/u);
});
