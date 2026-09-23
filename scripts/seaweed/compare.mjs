import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { summarizeGoTestJson, validateArtifactAllowlist, validateArtifactDirectory, validateBuildInfo } from "./build.mjs";
import { summarizeEcPreflight } from "./ec-preflight.mjs";

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
const lockBytes = readFileSync(path.resolve(import.meta.dirname, "../../infra/seaweed/seaweed-lock.json"));
const expectedLock = JSON.parse(lockBytes);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");

export function productionMaterialContract() {
  const fromFile = (name) => { const bytes = readFileSync(path.join(repositoryRoot, name)); return { sha256: digest(bytes), size: bytes.length }; };
  const locked = (descriptor) => ({ sha256: descriptor.sha256, size: descriptor.size });
  return new Map([
    ["materials/go1.26.8.linux-amd64.tar.gz", { sha256: expectedLock.compiler.sha256, size: expectedLock.compiler.size }],
    ["materials/seaweedfs-source-shallow.txt", locked(expectedLock.source.shallowBoundary)], ["materials/seaweedfs-grpc.patch", locked(expectedLock.patch)],
    ["materials/module-changes.tsv", locked(expectedLock.moduleChanges)], ["materials/required-tests.json", locked(expectedLock.requiredTests)],
    ["materials/DERIVATIVE-NOTICE.txt", fromFile("infra/seaweed/DERIVATIVE-NOTICE.txt")],
    ...expectedLock.upstreamMaterials.map((entry) => [`materials/upstream/${entry.path}`, locked(entry)]),
  ]);
}

const requiredTests = JSON.parse(readFileSync(path.join(repositoryRoot, expectedLock.requiredTests.path)));
const testKeys = (entries) => entries.map((entry) => `${entry.package}:${entry.name}`);
const requiredGroups = { normal: [...testKeys(requiredTests.required.redis), ...testKeys(requiredTests.required.nonShortIntegration)],
  fullTags: [...testKeys(requiredTests.required.redis), ...testKeys(requiredTests.required.nonShortIntegration)], projectGrpc: testKeys(requiredTests.required.seaweedGrpc) };
const requiredPhases = ["compiler_download", "compiler_extract", "compiler_identity", "compiler_work_cleanup", "source_checkout", "source_bundle", "source_bundle_verify", "source_restore", "source_restore_patch", "source_restore_cleanup", "patch_apply", "tidy_diff", "module_isolation_prepare", "module_download", "module_verify", "module_material_retention", "production_build", "binary_work_cleanup", "test_preflight", "ec_corrected_cache_cleanup", "redis_helper", "normal_tests", "normal_tests_cache_cleanup", "full_tag_tests", "full_tag_tests_cache_cleanup", "project_grpc_tests", "vet", "grpc_transport_tests", "post_test_module_download", "post_test_module_verify", "redis_cleanup", "work_cleanup", "cleanup"];
const requiredIsolationSteps = ["module_download", "module_verify", "post_test_module_download", "post_test_module_verify"];
requiredPhases.push("ec_baseline_build", "ec_baseline_tests", "ec_baseline_cleanup", "ec_corrected_tests", "post_test_cache_cleanup", "module_archive_retention");
const orderedPhases = ["module_material_retention", "production_build", "normal_tests", "full_tag_tests", "project_grpc_tests", "vet", "grpc_transport_tests",
  "post_test_module_download", "post_test_module_verify", "post_test_cache_cleanup", "module_archive_retention", "binary_work_cleanup"];
const requiredToolKeys = ["curl", "docker", "git", "tar", "unzip"];

function validateBuildEvidence(directory, receipt, inventory, materialContract) {
  const inventoryMap = new Map(inventory.map((entry) => [entry.path, entry]));
  for (const [name, descriptor] of materialContract) if (JSON.stringify(inventoryMap.get(name)) !== JSON.stringify({ path: name, ...descriptor })) throw new Error("seaweed_compare_material_contract_invalid");
  if (receipt.sourceRetention?.restoration !== "PASSED" || receipt.sourceRetention?.commitUnixTime !== String(expectedLock.source.commitUnixTime) ||
      JSON.stringify(receipt.sourceRetention?.shallow) !== JSON.stringify(expectedLock.source.shallowBoundary) ||
      JSON.stringify(receipt.sourceRetention?.bundle) !== JSON.stringify(inventoryMap.get("materials/seaweedfs-source.bundle") && { sha256: inventoryMap.get("materials/seaweedfs-source.bundle").sha256, size: inventoryMap.get("materials/seaweedfs-source.bundle").size })) throw new Error("seaweed_compare_source_restore_invalid");
  const phases = new Map((receipt.phases ?? []).map((phase) => [phase.name, phase.result]));
  if (phases.size !== receipt.phases?.length || requiredPhases.some((name) => phases.get(name) !== "PASSED")) throw new Error("seaweed_compare_phases_invalid");
  const indices = orderedPhases.map((name) => receipt.phases.findIndex((phase) => phase.name === name));
  if (indices.some((index, position) => position > 0 && index <= indices[position - 1])) throw new Error("seaweed_compare_phases_invalid");
  const cleanupBoundaries = ["corrected_ec", "normal_tests", "full_tag_tests", "post_tests"];
  if (!Array.isArray(receipt.cacheCleanup) || receipt.cacheCleanup.length !== cleanupBoundaries.length || receipt.cacheCleanup.some((cleanup, index) => {
    const entries = cleanup?.entries;
    return cleanup?.boundary !== cleanupBoundaries[index] || !Number.isSafeInteger(cleanup.beforeBytes) || cleanup.beforeBytes < 0 || cleanup.beforeBytes > expectedLock.limits.workBytes ||
      cleanup.afterBytes !== 0 || cleanup.freedBytes !== cleanup.beforeBytes || !entries ||
      !Number.isSafeInteger(entries.gocache?.beforeBytes) || entries.gocache.beforeBytes < 0 || entries.gocache.afterBytes !== 0 ||
      !Number.isSafeInteger(entries.tmp?.beforeBytes) || entries.tmp.beforeBytes < 0 || entries.tmp.afterBytes !== 0 ||
      entries.gocache.beforeBytes + entries.tmp.beforeBytes !== cleanup.beforeBytes;
  })) throw new Error("seaweed_compare_cache_cleanup_invalid");
  const retainedModules = JSON.parse(readFileSync(path.join(directory, "module-closure.json"), "utf8"));
  if (!Number.isSafeInteger(receipt.moduleMaterials?.total) || receipt.moduleMaterials.total < 1 ||
      receipt.moduleMaterials.total !== retainedModules.length || receipt.moduleMaterials.total !== receipt.moduleClosure?.count ||
      receipt.moduleMaterials.completed !== receipt.moduleMaterials.total || receipt.moduleMaterials.current !== null) {
    throw new Error("seaweed_compare_module_materials_invalid");
  }
  const archives = receipt.moduleArchives;
  const archiveNames = new Set(); let archiveBytes = 0;
  for (const module of retainedModules) {
    const descriptor = module.files?.["source.zip"]; const name = `materials/modules/${module.id}/source.zip`;
    const actual = inventoryMap.get(name);
    if (archiveNames.has(name) || !/^[a-f0-9]{64}$/u.test(descriptor?.sha256 ?? "") || !Number.isSafeInteger(descriptor?.size) ||
        descriptor.size < 1 || descriptor.size > 256 * 1024 ** 2 || actual?.size !== descriptor.size || actual?.sha256 !== descriptor.sha256) throw new Error("seaweed_compare_module_archives_invalid");
    archiveNames.add(name); archiveBytes += descriptor.size;
  }
  if (!Number.isSafeInteger(archiveBytes) || archiveBytes > expectedLock.limits.retainedBytes ||
      [...inventoryMap.keys()].filter((name) => /^materials\/modules\/[a-f0-9]{64}\/source\.zip$/u.test(name)).length !== archiveNames.size ||
      archives?.total !== retainedModules.length || archives.completed !== archives.total || archives.current !== null ||
      archives.totalBytes !== archiveBytes || archives.retainedBytes !== archiveBytes) throw new Error("seaweed_compare_module_archives_invalid");
  const checkpoints = receipt.moduleIsolation?.checkpoints;
  if (receipt.moduleIsolation?.result !== "PASSED" || !Array.isArray(checkpoints) || checkpoints.length !== requiredIsolationSteps.length ||
      checkpoints.some((checkpoint, index) => checkpoint?.name !== requiredIsolationSteps[index] || checkpoint.result !== "PASSED" || checkpoint.source !== "UNCHANGED" ||
        checkpoint.alternateMod !== "UNCHANGED" || !/^[a-f0-9]{64}$/u.test(checkpoint.alternateSum?.sha256 ?? "") || !Number.isSafeInteger(checkpoint.alternateSum?.size) ||
        checkpoint.alternateSum.size < 1 || checkpoint.alternateSum.size > 8 * 1024 ** 2 || !Number.isSafeInteger(checkpoint.additionalSumLines) || checkpoint.additionalSumLines < 0)) {
    throw new Error("seaweed_compare_module_isolation_invalid");
  }
  const buildInfo = readFileSync(path.join(directory, "go-build-info.txt"), "utf8"); validateBuildInfo(buildInfo, expectedLock);
  for (const arm of ["baseline", "corrected"]) {
    const preflight = receipt.ecPreflight?.[arm];
    const expectedModules = expectedLock.moduleFiles[arm === "baseline" ? "before" : "after"];
    if (preflight?.result !== "PASSED" || preflight.exitStatus !== 0 || JSON.stringify(preflight.modules) !== JSON.stringify(expectedModules) ||
        !/^[a-f0-9]{64}$/u.test(preflight.binary?.sha256 ?? "") || !Number.isSafeInteger(preflight.binary?.size) || preflight.binary.size < 1) throw new Error("seaweed_compare_ec_preflight_invalid");
    const matching = [...inventoryMap.keys()].filter((name) => new RegExp(`^logs/\\d{2}-ec_${arm}_tests\\.log$`, "u").test(name));
    if (matching.length !== 1) throw new Error("seaweed_compare_ec_preflight_invalid");
    const actual = summarizeEcPreflight(readFileSync(path.join(directory, matching[0])), preflight.exitStatus);
    if (actual.result !== "PASSED" || JSON.stringify(actual.tests) !== JSON.stringify(preflight.tests)) throw new Error("seaweed_compare_ec_preflight_invalid");
    const serverEvidence = receipt.serverLogs?.filter((entry) => entry.phase === `ec_${arm}`);
    if (serverEvidence?.length !== 1 || serverEvidence[0].result !== "PASSED") throw new Error("seaweed_compare_ec_preflight_invalid");
    const serverLogs = [...inventoryMap.keys()].filter((name) => new RegExp(`^logs/\\d{2}-ec_${arm}_server_logs\\.log$`, "u").test(name));
    if (serverLogs.length !== 1 || inventoryMap.get(serverLogs[0]).size !== serverEvidence[0].bytes || serverEvidence[0].bytes < 1 ||
        serverEvidence[0].bytes > 8 * 1024 ** 2) throw new Error("seaweed_compare_ec_preflight_invalid");
  }
  const retainedBinary = inventoryMap.get("weed");
  if (receipt.ecPreflight.corrected.binary.sha256 !== retainedBinary?.sha256 || receipt.ecPreflight.corrected.binary.size !== retainedBinary?.size) throw new Error("seaweed_compare_ec_preflight_invalid");
  const summary = JSON.parse(readFileSync(path.join(directory, "test-summary.json"), "utf8"));
  if (JSON.stringify(Object.keys(summary).sort()) !== JSON.stringify(Object.keys(requiredGroups).sort())) throw new Error("seaweed_compare_test_summary_invalid");
  if (JSON.stringify(receipt.testSummary) !== JSON.stringify(summary)) throw new Error("seaweed_compare_test_summary_invalid");
  for (const [key, required] of Object.entries(requiredGroups)) {
    const suffix = key === "normal" ? "normal_tests" : key === "fullTags" ? "full_tag_tests" : "project_grpc_tests";
    const matches = [...inventoryMap.keys()].filter((name) => new RegExp(`^logs/\\d{2}-${suffix}\\.log$`, "u").test(name));
    if (matches.length !== 1) throw new Error("seaweed_compare_test_log_invalid");
    const actual = summarizeGoTestJson(readFileSync(path.join(directory, matches[0])), required);
    if (JSON.stringify(actual) !== JSON.stringify(summary[key])) throw new Error("seaweed_compare_test_summary_invalid");
  }
}

function verifiedProvenance(receipt, expectedRepeat, expected = {}) {
  const exact = {
    sourceCommit: expectedLock.source.commit, sourceTree: expectedLock.source.tree, derivativeCommit: expectedLock.build.commitValue,
    lock: { sha256: digest(lockBytes), size: lockBytes.length }, patch: { sha256: expectedLock.patch.sha256, size: expectedLock.patch.size },
    compiler: { archive: { sha256: expectedLock.compiler.sha256, size: expectedLock.compiler.size }, version: `go version go${expectedLock.compiler.version} linux/amd64` },
  };
  for (const [key, value] of Object.entries(exact)) if (JSON.stringify(receipt[key]) !== JSON.stringify(value)) throw new Error("seaweed_compare_provenance_invalid");
  if (receipt.repeat !== expectedRepeat || receipt.codeCheckout?.repository !== "CleMeY15/auto-world" || receipt.codeCheckout?.ref !== "refs/heads/main" ||
      receipt.codeCheckout?.sha !== receipt.codeCheckout?.actualSha || !/^[a-f0-9]{40}$/u.test(receipt.codeCheckout?.sha ?? "") ||
      receipt.workflowRun?.attempt !== "1" || !/^\d+$/u.test(receipt.workflowRun?.runId ?? "") || receipt.workflowRun?.job !== "build" ||
      receipt.runtime?.node !== "v22.23.2" || receipt.runtime?.platform !== "linux" || receipt.runtime?.architecture !== "x64" ||
      typeof receipt.runtime?.imageOS !== "string" || receipt.runtime.imageOS.length < 1 || typeof receipt.runtime?.imageVersion !== "string" || receipt.runtime.imageVersion.length < 1 ||
      !receipt.tools || JSON.stringify(Object.keys(receipt.tools).sort()) !== JSON.stringify(requiredToolKeys) ||
      requiredToolKeys.some((key) => typeof receipt.tools[key] !== "string" || receipt.tools[key].length < 1) ||
      receipt.moduleClosure?.result !== "UNCHANGED_AFTER_TESTS" || receipt.moduleClosure?.grpcVersion !== expectedLock.grpc.version) throw new Error("seaweed_compare_provenance_invalid");
  if ((expected.repository && receipt.codeCheckout.repository !== expected.repository) || (expected.ref && receipt.codeCheckout.ref !== expected.ref) ||
      (expected.codeSha && receipt.codeCheckout.sha !== expected.codeSha) || (expected.runId && receipt.workflowRun.runId !== expected.runId) ||
      (expected.attempt && receipt.workflowRun.attempt !== expected.attempt)) throw new Error("seaweed_compare_current_run_invalid");
  return exact;
}

export function parseCompareArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--build-root" || argv[2] !== "--output" || !path.isAbsolute(argv[1]) || !path.isAbsolute(argv[3])) throw new Error("seaweed_compare_arguments_invalid");
  return { buildRoot: path.resolve(argv[1]), output: path.resolve(argv[3]) };
}

function verifiedBuild(directory, expectedRepeat, expected, materialContract) {
  if (!existsSync(directory) || lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) throw new Error("seaweed_compare_input_invalid");
  if (validateArtifactDirectory(directory).result !== "PASSED") throw new Error("seaweed_compare_receipt_invalid");
  const receipt = JSON.parse(readFileSync(path.join(directory, "build-receipt.json"), "utf8"));
  const inventory = JSON.parse(readFileSync(path.join(directory, "material-inventory.json"), "utf8"));
  if (receipt?.schemaVersion !== 1 || receipt.result !== "PASSED" || receipt.repeat !== expectedRepeat || receipt.sourceCommit !== "c5073360007d28385a33426a42ac3e4ec504c5a3" || !Array.isArray(inventory)) throw new Error("seaweed_compare_receipt_invalid");
  verifiedProvenance(receipt, expectedRepeat, expected);
  validateBuildEvidence(directory, receipt, inventory, materialContract);
  validateArtifactAllowlist(inventory.map((entry) => entry.path));
  for (const entry of inventory) {
    const file = path.resolve(directory, entry.path);
    if (!file.startsWith(`${directory}${path.sep}`) || !existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error("seaweed_compare_material_missing");
    const bytes = readFileSync(file);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error("seaweed_compare_material_changed");
  }
  return { receipt, inventory: new Map(inventory.map((entry) => [entry.path, entry])), directory };
}

export function compareBuilds(firstDirectory, secondDirectory, expected = {}, materialContract = productionMaterialContract()) {
  const first = verifiedBuild(firstDirectory, 1, expected, materialContract); const second = verifiedBuild(secondDirectory, 2, expected, materialContract);
  for (const key of ["sourceCommit", "sourceTree", "derivativeCommit", "lock", "patch", "compiler", "codeCheckout", "workflowRun", "runtime", "tools", "moduleClosure", "moduleIsolation", "moduleMaterials", "moduleArchives", "ecPreflight"]) {
    if (JSON.stringify(first.receipt[key]) !== JSON.stringify(second.receipt[key])) throw new Error("seaweed_compare_provenance_changed");
  }
  const deterministic = [...first.inventory.keys()].filter((name) => !name.startsWith("logs/")).sort();
  const secondDeterministic = [...second.inventory.keys()].filter((name) => !name.startsWith("logs/")).sort();
  if (JSON.stringify(deterministic) !== JSON.stringify(secondDeterministic)) throw new Error("seaweed_compare_set_changed");
  const compared = [];
  for (const name of deterministic) {
    const left = readFileSync(path.join(first.directory, name)); const right = readFileSync(path.join(second.directory, name));
    if (!left.equals(right)) throw new Error(`seaweed_compare_bytes_changed:${name}`);
    compared.push({ path: name, sha256: digest(left), size: left.length });
  }
  if (!compared.some((entry) => entry.path === "weed")) throw new Error("seaweed_compare_binary_missing");
  return { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "PASSED", source: { commit: first.receipt.sourceCommit, tree: first.receipt.sourceTree },
    lock: first.receipt.lock, patch: first.receipt.patch, compiler: first.receipt.compiler, provenance: { codeCheckout: first.receipt.codeCheckout, workflowRun: first.receipt.workflowRun, runtime: first.receipt.runtime, tools: first.receipt.tools }, compared };
}

export function runComparison({ argv = process.argv.slice(2), env = process.env, platform = process.platform } = {}) {
  const { buildRoot, output } = parseCompareArguments(argv);
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_JOB !== "compare" || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "") || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? "")) throw new Error("seaweed_compare_context_invalid");
  const runnerTemp = path.resolve(env.RUNNER_TEMP ?? "");
  if (!path.isAbsolute(env.RUNNER_TEMP ?? "") || path.dirname(output) !== runnerTemp || path.basename(output) !== "seaweed-comparison.json" || existsSync(output)) throw new Error("seaweed_compare_output_invalid");
  try {
    const result = compareBuilds(path.join(buildRoot, "seaweed-build-1"), path.join(buildRoot, "seaweed-build-2"), { repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, codeSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT });
    const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    if (bytes.length > 1024 ** 2) throw new Error("seaweed_compare_receipt_oversized");
    writeFileSync(output, bytes, { flag: "wx" });
    return result;
  } catch (error) {
    const reason = /^seaweed_[a-z0-9_:.-]+$/u.test(error?.message ?? "") ? error.message.split(":", 1)[0] : "seaweed_compare_failed";
    writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "FAILED", reason }, null, 2)}\n`, { flag: "wx" });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) runComparison();
