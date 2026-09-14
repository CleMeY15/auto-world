import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compareBuilds, parseCompareArguments, productionMaterialContract, runComparison } from "../scripts/seaweed/compare.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const lockBytes = readFileSync(path.join(repositoryRoot, "infra/seaweed/seaweed-lock.json"));
const lock = JSON.parse(lockBytes);
const codeSha = "b".repeat(40);
const requiredTests = JSON.parse(readFileSync(path.join(repositoryRoot, lock.requiredTests.path)));
const keys = (entries) => entries.map((entry) => `${entry.package}:${entry.name}`);
const groups = { normal: [...keys(requiredTests.required.redis), ...keys(requiredTests.required.nonShortIntegration)], fullTags: [...keys(requiredTests.required.redis), ...keys(requiredTests.required.nonShortIntegration)], projectGrpc: keys(requiredTests.required.seaweedGrpc) };
const phases = ["compiler_download", "compiler_extract", "compiler_identity", "compiler_work_cleanup", "source_checkout", "source_bundle", "source_bundle_verify", "source_restore", "source_restore_patch", "source_restore_cleanup", "patch_apply", "tidy_diff", "module_isolation_prepare", "module_download", "module_verify", "module_material_retention", "production_build", "binary_work_cleanup", "test_preflight", "redis_helper", "normal_tests", "full_tag_tests", "project_grpc_tests", "vet", "grpc_transport_tests", "post_test_module_download", "post_test_module_verify", "redis_cleanup", "work_cleanup", "cleanup"];
const isolationSteps = ["module_download", "module_verify", "post_test_module_download", "post_test_module_verify"];

function goLog(required) { return Buffer.from(required.map((key) => { const split = key.lastIndexOf(":"); return JSON.stringify({ Action: "pass", Package: key.slice(0, split), Test: key.slice(split + 1) }); }).join("\n") + "\n"); }

function fixture(root, repeat, bytes = Buffer.from("binary")) {
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
    moduleIsolation: { result: "PASSED", checkpoints: isolationSteps.map((name) => ({ name, result: "PASSED", source: "UNCHANGED", alternateMod: "UNCHANGED", alternateSum: { sha256: "c".repeat(64), size: 289700 }, additionalSumLines: 2 })) },
    sourceRetention: { bundle: { sha256: sha256(files.get("materials/seaweedfs-source.bundle")), size: files.get("materials/seaweedfs-source.bundle").length }, shallow: { sha256: sha256(files.get("materials/seaweedfs-source-shallow.txt")), size: files.get("materials/seaweedfs-source-shallow.txt").length }, restoration: "PASSED", commitUnixTime: String(lock.source.commitUnixTime) },
    phases: phases.map((name) => ({ name, result: "PASSED", durationMs: 1 })),
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
  assert.equal(result.result, "PASSED");
  assert.equal(result.compared.some((entry) => entry.path === "weed"), true);
  writeFileSync(path.join(second, "weed"), "mutated");
  assert.throws(() => compareFixtures(first, second), /seaweed_artifact_inventory_changed/u);
  rmSync(root, { recursive: true, force: true });
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
    ...["compiler_work_cleanup", "source_restore_cleanup", "binary_work_cleanup"].map((required) => (receipt) => { receipt.phases = receipt.phases.filter(({ name }) => name !== required); }),
    (receipt) => { delete receipt.moduleMaterials; },
    (receipt) => { receipt.moduleMaterials.completed = 0; },
    (receipt) => { receipt.moduleMaterials.current = { module: 1, operation: "notice", notice: 1 }; },
    (receipt) => { receipt.moduleMaterials.total = 2; receipt.moduleMaterials.completed = 2; receipt.moduleClosure.count = 2; },
  ]) {
    const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-")); const first = fixture(root, 1); const second = fixture(root, 2);
    for (const directory of [first, second]) {
      const file = path.join(directory, "build-receipt.json"); const receipt = JSON.parse(readFileSync(file)); mutate(receipt); writeFileSync(file, JSON.stringify(receipt));
    }
    assert.throws(() => compareFixtures(first, second), /seaweed_compare_(?:phases|provenance|module_materials)_invalid/u);
    rmSync(root, { recursive: true, force: true });
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
  assert.deepEqual(receipt, { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "FAILED", reason: "seaweed_compare_material_contract_invalid" });
  assert.ok(readFileSync(output).length < 1024 ** 2);
  rmSync(runnerTemp, { recursive: true, force: true });
});

test("comparison CLI accepts only fixed absolute build-root and output arguments", () => {
  const buildRoot = path.resolve(tmpdir(), "builds"); const output = path.resolve(tmpdir(), "comparison.json");
  assert.deepEqual(parseCompareArguments(["--build-root", buildRoot, "--output", output]), { buildRoot, output });
  assert.throws(() => parseCompareArguments(["--build-root", "relative", "--output", output]), /seaweed_compare_arguments_invalid/u);
});
