import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const OBSERVATION_TEST = fileURLToPath(
  new URL("./postgres-gosu-derivative-image-observation-v2.test.mjs", import.meta.url),
);

test("build proof V1 VM cases execute in the ordinary test suite", () => {
  const environment = { ...process.env, NODE_NO_WARNINGS: "1" };
  delete environment.NODE_TEST_CONTEXT;
  const result = childProcess.spawnSync(process.execPath, [
    "--experimental-vm-modules",
    "--test",
    "--test-reporter=tap",
    "--test-name-pattern=^build proof V1",
    OBSERVATION_TEST,
  ], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 ** 2,
    timeout: 120_000,
  });
  const transcript = result.stdout + "\n" + result.stderr;
  assert.equal(result.status, 0, transcript);
  assert.match(result.stdout, /# pass 5(?:\r?\n|$)/u, transcript);
  assert.match(result.stdout, /# fail 0(?:\r?\n|$)/u, transcript);
  assert.match(result.stdout, /# cancelled 0(?:\r?\n|$)/u, transcript);
  for (const name of [
    "binds one fresh pair",
    "rejects wrong public shapes",
    "refuses rollback and unsafe completion clocks",
    "closes proof failures",
    "keeps the exact fixed build and archive flow",
  ]) {
    assert.match(result.stdout, new RegExp("ok [1-5] - build proof V1 .*" + name, "u"), transcript);
  }
});
