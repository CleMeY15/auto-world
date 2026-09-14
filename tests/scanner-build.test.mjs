import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseBuildArguments, validateBuildLock } from "../scripts/scanner/build.mjs";

const root = path.resolve(import.meta.dirname, "..");

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
});
