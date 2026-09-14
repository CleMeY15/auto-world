import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  armRedisCleanup, assertResourceBudget, buildSeaweed, canonicalMaterial, cleanupBuildResources, clippedFinalizationTimeout, clippedTimeout, createModuleIsolation, createRedisLifecycle, finalizeRedisCleanup,
  isMissingRedisContainer, parseArguments, redisRunArguments, removeOwnedTree, safeBaseEnvironment,
  moduleIsolationArguments, sha256, summarizeGoTestJson, validateArtifactAllowlist, validateArtifactDirectory, validateBuildInfo, validateFinalModuleClosure,
  validateModuleIsolationCheckpoint, validatePostTestState, validateRestoredSource,
  validateSeaweedLock, validateShallowBoundary, validateVersionOutput,
} from "../scripts/seaweed/build.mjs";

const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(path.join(root, "infra/seaweed/seaweed-lock.json"), "utf8"));

test("Seaweed lock binds the exact reviewed source, compiler, patch, manifest, and production variant", () => {
  assert.equal(validateSeaweedLock(lock), lock);
  assert.throws(() => validateSeaweedLock({ ...lock, patch: { ...lock.patch, size: lock.patch.size + 1 } }), /seaweed_lock_invalid/u);
  for (const field of ["patch", "moduleChanges", "requiredTests"]) {
    const bytes = readFileSync(path.join(root, lock[field].path));
    assert.equal(bytes.length, lock[field].size);
    assert.equal(sha256(bytes), lock[field].sha256);
    assert.throws(() => canonicalMaterial(Buffer.concat([bytes, Buffer.from("x")]), lock[field]), /seaweed_material_changed/u);
  }
  assert.deepEqual(lock.build.tags, []);
  assert.equal(lock.build.cgoEnabled, "0");
  assert.doesNotMatch(lock.build.ldflags, /(?:^|\s)-(?:s|w)(?:\s|$)|trimpath|buildid/u);
});

test("bounded arguments, deadlines, resources, and artifact paths fail closed", () => {
  const output = path.resolve(tmpdir(), "seaweed-build-1");
  assert.deepEqual(parseArguments(["--repeat", "1", "--output", output]), { output, repeat: 1 });
  assert.throws(() => parseArguments(["--repeat", "3", "--output", output]), /seaweed_arguments_invalid/u);
  assert.equal(clippedTimeout({ deadlineMs: 100, finalizationReserveMs: 20 }, 10, 90), 70);
  assert.throws(() => clippedTimeout({ deadlineMs: 100, finalizationReserveMs: 20 }, 80, 1), /seaweed_inner_deadline_exceeded/u);
  assert.equal(clippedFinalizationTimeout({ deadlineMs: 100 }, 80, 60), 20);
  assert.throws(() => clippedFinalizationTimeout({ deadlineMs: 100 }, 100, 1), /seaweed_inner_deadline_exceeded/u);
  const limits = { workBytes: 10, retainedBytes: 10, minimumFreeBytes: 5, aggregateLogBytes: 10 };
  assert.doesNotThrow(() => assertResourceBudget({ workBytes: 5, retainedBytes: 5, freeBytes: 5, logBytes: 10, limits }));
  for (const changed of [{ workBytes: 6 }, { retainedBytes: 11 }, { freeBytes: 4 }, { logBytes: 11 }]) {
    assert.throws(() => assertResourceBudget({ workBytes: 5, retainedBytes: 5, freeBytes: 5, logBytes: 10, limits, ...changed }), /seaweed_.+_failed|seaweed_.+_exceeded/u);
  }
  assert.equal(validateArtifactAllowlist(["weed", "materials/required-tests.json", "materials/modules/" + "a".repeat(64) + "/source.zip"]), true);
  assert.throws(() => validateArtifactAllowlist(["weed", "../secret"]), /seaweed_artifact_allowlist_invalid/u);
});

test("required go test events bind package plus top-level name and retain skips", () => {
  const required = ["example.test/pkg:TestRequired"];
  const output = Buffer.from([
    { Action: "pass", Package: "example.test/pkg", Test: "TestRequired" },
    { Action: "skip", Package: "example.test/pkg", Test: "TestIntentional" },
  ].map(JSON.stringify).join("\n") + "\n");
  assert.deepEqual(summarizeGoTestJson(output, required), { requiredPassed: 1, skips: ["example.test/pkg:TestIntentional"] });
  assert.throws(() => summarizeGoTestJson(Buffer.from(JSON.stringify({ Action: "skip", Package: "example.test/pkg", Test: "TestRequired" })), required), /seaweed_required_test_failed/u);
  assert.throws(() => summarizeGoTestJson(Buffer.from("not-json"), required), /seaweed_test_output_invalid/u);
});

test("build metadata requires corrected dependency, platform, VCS revision, modified state, and no tags", () => {
  const binary = "/tmp/auto-world-seaweed-source-diagnostic/bin/weed";
  const info = [`${binary}: go${lock.compiler.version}`, `\tdep\tgoogle.golang.org/grpc\t${lock.grpc.version}\t${lock.grpc.sum}`, "\tbuild\t-compiler=gc", `\tbuild\t-ldflags=${JSON.stringify(lock.build.ldflags)}`, "\tbuild\tCGO_ENABLED=0", "\tbuild\tGOARCH=amd64", "\tbuild\tGOOS=linux", "\tbuild\tGOAMD64=v1", `\tbuild\tvcs.revision=${lock.source.commit}`, "\tbuild\tvcs.modified=true"].join("\n");
  assert.equal(validateBuildInfo(info, lock), true);
  assert.throws(() => validateBuildInfo(info.replace("vcs.modified=true", "vcs.modified=false"), lock), /seaweed_build_info_invalid/u);
  assert.throws(() => validateBuildInfo(info.replace("GOARCH=amd64", "GOARCH=amd64evil"), lock), /seaweed_build_info_invalid/u);
  assert.throws(() => validateBuildInfo(info.replace(lock.grpc.version, `${lock.grpc.version}-evil`), lock), /seaweed_build_info_invalid/u);
  assert.throws(() => validateBuildInfo(info.replace(lock.build.commitValue, "wrong-commit"), lock), /seaweed_build_info_invalid/u);
  assert.throws(() => validateBuildInfo(info.replace(`go${lock.compiler.version}`, "go0.0.0"), lock), /seaweed_build_info_invalid/u);
  assert.throws(() => validateBuildInfo(`${info}\n\tbuild\t-tags=elastic`, lock), /seaweed_build_tags_invalid/u);
});

test("subprocess base environment is credential-free and Redis is bounded before creation", () => {
  const work = path.resolve(tmpdir(), "owned");
  assert.deepEqual(Object.keys(safeBaseEnvironment(work)).sort(), ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ"]);
  assert.equal(safeBaseEnvironment(work).TZ, "UTC");
  const args = redisRunArguments("aw-seaweed-redis-1", lock.redis.subject);
  for (const pair of [["--cpus", "1"], ["--memory", "256m"], ["--memory-swap", "256m"], ["--pids-limit", "128"], ["--publish", "127.0.0.1:6379:6379"]]) {
    assert.equal(args[args.indexOf(pair[0]) + 1], pair[1]);
  }
  assert.equal(isMissingRedisContainer({ status: 1, stderr: Buffer.from("Error: No such object: aw-seaweed-redis-1\n") }, "aw-seaweed-redis-1"), true);
  assert.equal(isMissingRedisContainer({ status: 1, stderr: Buffer.from("network timeout") }, "aw-seaweed-redis-1"), false);
  const lifecycle = createRedisLifecycle(); let cleaned = 0;
  try { armRedisCleanup(lifecycle); throw new Error("synthetic_start_timeout"); }
  catch (error) { assert.match(error.message, /synthetic_start_timeout/u); }
  finally { finalizeRedisCleanup(lifecycle, () => { cleaned += 1; }); }
  assert.equal(cleaned, 1);
});

test("final module validation requires the complete unchanged closure and exact effective gRPC", () => {
  const grpc = { path: "google.golang.org/grpc", version: lock.grpc.version, sum: lock.grpc.sum, goModSum: lock.grpc.goModSum, zip: { sha256: "a".repeat(64), size: 1 } };
  const closure = [{ path: "example.test/module", version: "v1.0.0", sum: "h1:a", goModSum: "h1:b", zip: { sha256: "b".repeat(64), size: 1 } }, grpc];
  const copied = JSON.parse(JSON.stringify(closure));
  assert.deepEqual(validateFinalModuleClosure(closure, copied, lock), grpc);
  assert.throws(() => validateFinalModuleClosure(closure, closure.slice(1), lock), /seaweed_module_closure_changed/u);
  const changed = JSON.parse(JSON.stringify(closure)); changed[1].version += "-substituted";
  assert.throws(() => validateFinalModuleClosure(changed, changed, lock), /seaweed_grpc_module_invalid/u);
  assert.deepEqual(validatePostTestState(closure, copied, lock.moduleFiles.after, lock), grpc);
  assert.throws(() => validatePostTestState(closure, copied, { ...lock.moduleFiles.after, "go.sum": { ...lock.moduleFiles.after["go.sum"], size: 1 } }, lock), /seaweed_module_files_changed/u);
});

test("module download and verification use an isolated modfile and validate all four checkpoints", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "seaweed-module-isolation-"));
  const work = path.join(parent, "auto-world-seaweed-source-diagnostic"); const source = path.join(work, "source"); mkdirSync(source, { recursive: true });
  const modBytes = Buffer.from("module example.test/isolation\n\ngo 1.26\n");
  const sumBytes = Buffer.from(`example.test/dependency v1.0.0 h1:${"A".repeat(43)}=\n`);
  writeFileSync(path.join(source, "go.mod"), modBytes); writeFileSync(path.join(source, "go.sum"), sumBytes);
  const syntheticLock = { moduleFiles: { after: { "go.mod": { sha256: sha256(modBytes), size: modBytes.length }, "go.sum": { sha256: sha256(sumBytes), size: sumBytes.length } } } };
  try {
    const state = createModuleIsolation(source, work, syntheticLock);
    const steps = ["module_download", "module_verify", "post_test_module_download", "post_test_module_verify"];
    for (const step of steps) assert.deepEqual(moduleIsolationArguments(step, state.modFile), step.endsWith("download") ? ["mod", "download", `-modfile=${state.modFile}`, "-json", "all"] : ["mod", "verify", `-modfile=${state.modFile}`]);
    assert.throws(() => moduleIsolationArguments(steps[0], path.join(parent, "foreign.mod")), /seaweed_module_isolation_arguments_invalid/u);
    writeFileSync(state.sumFile, Buffer.concat([sumBytes, Buffer.from(`example.test/added v1.0.0 h1:${"B".repeat(43)}=\n`)]));
    const checkpoints = steps.map((step) => validateModuleIsolationCheckpoint(state, syntheticLock, step));
    assert.deepEqual(checkpoints.map(({ name, result, source: sourceState, alternateMod, additionalSumLines }) => ({ name, result, source: sourceState, alternateMod, additionalSumLines })),
      steps.map((name) => ({ name, result: "PASSED", source: "UNCHANGED", alternateMod: "UNCHANGED", additionalSumLines: 1 })));
    writeFileSync(path.join(source, "go.sum"), Buffer.concat([sumBytes, Buffer.from("mutation\n")]));
    assert.throws(() => validateModuleIsolationCheckpoint(state, syntheticLock, steps[0]), /seaweed_material_changed/u);
    writeFileSync(path.join(source, "go.sum"), sumBytes); writeFileSync(path.join(source, "go.mod"), Buffer.concat([modBytes, Buffer.from("// mutation\n")]));
    assert.throws(() => validateModuleIsolationCheckpoint(state, syntheticLock, steps[0]), /seaweed_material_changed/u);
    writeFileSync(path.join(source, "go.mod"), modBytes); writeFileSync(state.modFile, Buffer.concat([modBytes, Buffer.from("// mutation\n")]));
    assert.throws(() => validateModuleIsolationCheckpoint(state, syntheticLock, steps[0]), /seaweed_module_isolation_mod_changed/u);
    writeFileSync(state.modFile, modBytes); writeFileSync(state.sumFile, Buffer.from(`example.test/substitute v1.0.0 h1:${"C".repeat(43)}=\n`));
    assert.throws(() => validateModuleIsolationCheckpoint(state, syntheticLock, steps[0]), /seaweed_module_isolation_sum_invalid/u);
    writeFileSync(state.sumFile, Buffer.alloc(8 * 1024 ** 2 + 1, 0x41));
    assert.throws(() => validateModuleIsolationCheckpoint(state, syntheticLock, steps[0]), /seaweed_material_invalid/u);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("retained shallow boundary, offline restore identity, and exact normal version fail closed", () => {
  const shallow = Buffer.from(`${lock.source.commit}\n`);
  assert.equal(validateShallowBoundary(shallow, lock), true);
  assert.throws(() => validateShallowBoundary(Buffer.from(`${"0".repeat(40)}\n`), lock), /seaweed_material_changed/u);
  const restored = { fsck: "PASSED", head: lock.source.commit, tree: lock.source.tree, commitUnixTime: String(lock.source.commitUnixTime), pristine: lock.moduleFiles.before, corrected: lock.moduleFiles.after, changed: ["go.mod", "go.sum"] };
  assert.equal(validateRestoredSource(restored, lock), true);
  for (const mutation of [{ ...restored, fsck: "FAILED" }, { ...restored, head: "0".repeat(40) }, { ...restored, tree: "0".repeat(40) }, { ...restored, changed: ["go.mod"] }]) assert.throws(() => validateRestoredSource(mutation, lock), /seaweed_source_restore_invalid/u);
  const version = `version 30GB ${lock.source.version} ${lock.build.commitValue} linux amd64`;
  assert.equal(validateVersionOutput(version, lock), true);
  assert.throws(() => validateVersionOutput(`${version} substituted`, lock), /seaweed_version_output_invalid/u);
});

test("cleanup removes only the exact owned nonsymlink tree", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "seaweed-clean-"));
  const owned = path.join(parent, "auto-world-seaweed-source-diagnostic");
  mkdirSync(owned); writeFileSync(path.join(owned, "x"), "x");
  removeOwnedTree(owned, parent);
  const foreign = path.join(parent, "foreign"); mkdirSync(foreign);
  assert.throws(() => removeOwnedTree(foreign, parent), /seaweed_cleanup_path_invalid/u);
  const target = path.join(parent, "target"); mkdirSync(target);
  const linked = path.join(parent, "auto-world-seaweed-source-diagnostic");
  symlinkSync(target, linked, "junction");
  assert.throws(() => removeOwnedTree(linked, parent), /seaweed_cleanup_path_invalid/u);
  rmSync(parent, { recursive: true, force: true });
});

test("Redis cleanup failure remains visible while work cleanup runs and the primary failure is preserved", () => {
  const receipt = { result: "FAILED", reason: "seaweed_normal_tests_failed", phases: [] };
  const redisFailure = new Error("seaweed_redis_cleanup_failed"); let workRemoved = false;
  const failure = cleanupBuildResources(receipt, {
    redis_cleanup: () => { throw redisFailure; },
    work_cleanup: () => { workRemoved = true; },
  }, () => 100);
  assert.equal(workRemoved, true);
  assert.equal(failure, redisFailure);
  assert.equal(receipt.reason, "seaweed_normal_tests_failed");
  assert.equal(receipt.cleanupReason, "seaweed_redis_cleanup_failed");
  assert.deepEqual(receipt.phases.map(({ name, result }) => ({ name, result })), [
    { name: "redis_cleanup", result: "FAILED" }, { name: "work_cleanup", result: "PASSED" }, { name: "cleanup", result: "FAILED" },
  ]);
  const successfulBuild = { result: "PASSED", phases: [] };
  cleanupBuildResources(successfulBuild, { work_cleanup: () => { throw new Error("private error details"); } }, () => 100);
  assert.equal(successfulBuild.result, "FAILED");
  assert.equal(successfulBuild.reason, "seaweed_operation_failed");
  assert.doesNotMatch(JSON.stringify(successfulBuild), /private error/u);
});

test("artifact validation permits only bounded failure logs or a complete passed inventory", () => {
  const failed = mkdtempSync(path.join(tmpdir(), "seaweed-artifact-")); mkdirSync(path.join(failed, "logs"));
  writeFileSync(path.join(failed, "logs/01-command.log"), "failure"); writeFileSync(path.join(failed, "build-receipt.json"), JSON.stringify({ schemaVersion: 1, result: "FAILED" }));
  assert.equal(validateArtifactDirectory(failed).result, "FAILED");
  writeFileSync(path.join(failed, "weed"), "partial");
  assert.throws(() => validateArtifactDirectory(failed), /seaweed_failed_artifact_unsafe/u);
  rmSync(failed, { recursive: true, force: true });
});

test("main build orchestration filters parent secrets, cleans owned work, and writes a top-level failure receipt", () => {
  const runnerTemp = mkdtempSync(path.join(tmpdir(), "seaweed-orchestration-")); const output = path.join(runnerTemp, "seaweed-build-1");
  const workRoot = path.join(runnerTemp, "auto-world-seaweed-source-diagnostic");
  assert.equal(existsSync(workRoot), false, "owned test work path must be unused");
  const seen = [];
  const commandRunner = (command, args, options) => { seen.push({ command, args, options }); return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("synthetic failure") }; };
  const env = { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: "build", GITHUB_RUN_ID: "123", GITHUB_SHA: "a".repeat(40), GITHUB_WORKSPACE: runnerTemp, RUNNER_TEMP: runnerTemp, SUPER_SECRET: "must-not-propagate" };
  assert.throws(() => buildSeaweed({ argv: ["--repeat", "1", "--output", output], commandRunner, env, platform: "linux", workRoot }), /seaweed_compiler_download_failed/u);
  assert.equal(seen.length, 1); assert.equal(Object.hasOwn(seen[0].options.env, "SUPER_SECRET"), false);
  assert.deepEqual(Object.keys(seen[0].options.env).sort(), ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR", "TZ"]);
  assert.equal(existsSync(workRoot), false);
  const receipt = JSON.parse(readFileSync(path.join(output, "build-receipt.json"), "utf8"));
  assert.equal(receipt.result, "FAILED"); assert.equal(receipt.reason, "seaweed_compiler_download_failed");
  assert.equal(receipt.phases.at(-1).name, "cleanup"); assert.equal(receipt.phases.at(-1).result, "PASSED");
  assert.deepEqual(readdirSync(output).sort(), ["build-receipt.json", "logs"]);
  rmSync(runnerTemp, { recursive: true, force: true });
});
