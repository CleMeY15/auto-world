import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseBuildArguments, removeOwnedBuildTree, stableModuleClosure, validateBuildLock } from "../scripts/scanner/build.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("cleanup removes readonly Go cache directories only inside its owned build root", () => {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-cleanup-test-"));
  const work = path.join(runnerTemp, "aw-scanner-build-1");
  const module = path.join(work, "gomodcache", "fixture@v1.0.0");
  mkdirSync(module, { recursive: true });
  writeFileSync(path.join(module, "LICENSE"), "synthetic fixture");
  chmodSync(path.join(module, "LICENSE"), 0o444);
  chmodSync(module, 0o555);
  try {
    assert.throws(() => removeOwnedBuildTree(runnerTemp, runnerTemp), /scanner_cleanup_path_invalid/u);
    assert.throws(() => removeOwnedBuildTree(work, path.join(runnerTemp, "other")), /scanner_cleanup_path_invalid/u);
    removeOwnedBuildTree(work, runnerTemp);
    assert.equal(existsSync(work), false);
  } finally {
    if (existsSync(module)) chmodSync(module, 0o700);
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});

test("module closure binds archive bytes while ignoring independent cache paths", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "aw-modules-test-"));
  try {
    const paths = ["one.zip", "two.zip"].map((name) => path.join(temporary, name));
    for (const file of paths) writeFileSync(file, "synthetic module archive");
    const record = (Zip) => Buffer.from(JSON.stringify({ Path: "example.test/module", Version: "v1.0.0", Sum: "h1:synthetic", GoModSum: "h1:synthetic-mod", Zip }));
    assert.deepEqual(stableModuleClosure(record(paths[0])), stableModuleClosure(record(paths[1])));
    writeFileSync(paths[1], "changed module archive");
    assert.notDeepEqual(stableModuleClosure(record(paths[0])), stableModuleClosure(record(paths[1])));
    assert.throws(() => stableModuleClosure(Buffer.from('{"Error":"download failed"}')), /scanner_module_output_invalid/u);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("scanner build arguments require one explicit absolute output and repeat", () => {
  const output = path.resolve(root, "out");
  assert.deepEqual(parseBuildArguments(["--repeat", "1", "--output", output]), { repeat: 1, output });
  for (const args of [[], ["--repeat", "1"], ["--output", output], ["--repeat", "1", "--repeat", "2", "--output", output],
    ["--repeat", "3", "--output", output], ["--repeat", "1", "--output", "relative"]]) {
    assert.throws(() => parseBuildArguments(args), /scanner_build_arguments_invalid/u);
  }
});

test("scanner lock binds corrected source, compiler, patches, fixtures, baseline, and six roles", async () => {
  const lock = validateBuildLock(JSON.parse(await readFile(path.join(root, "infra/scanner/scanner-lock.json"), "utf8")));
  assert.equal(lock.scanner.sourceCommit, "e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994");
  assert.equal(lock.compiler.sha256, "d0f743b33e8d8945e6b1f432edd15785c70507121d6e2a723b21285eddf8b57b");
  assert.deepEqual(lock.patches.map((entry) => entry.order), [1, 2, 3]);
  assert.equal(lock.patches[2].upstreamCommit, "8c905373332df11a268a0cebc07627cc08485fee");
  assert.equal(lock.baseline.platformDigest, "sha256:ee940acbf1f58ebadb42d01434ce4609530bf1b52536afbd1eee66cd7123c5c9");
  assert.deepEqual(lock.images.map((entry) => entry.role), ["postgres", "opensearch", "redis", "seaweedfs", "aws-cli", "baseline-trivy"]);
  assert.deepEqual(lock.alternatives.map((entry) => [entry.role, entry.alternativeFor, entry.manifestDigest, entry.platform.digest]), [
    ["postgres-alpine", "postgres", "sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73", "sha256:7456ef82e5f5bc43d997f4781bbd7c0d6389bff397564649a356e206ba473aee"],
    ["redis-alpine", "redis", "sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576", "sha256:9c3ecc609a8087c0f11c494fefaf37a8f7bf9a967631d4a0da8967a9810be354"],
  ]);
});
