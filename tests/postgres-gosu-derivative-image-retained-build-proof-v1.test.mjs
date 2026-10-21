import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const OBSERVATION_TEST = fileURLToPath(
  new URL("./postgres-gosu-derivative-image-observation-v2.test.mjs", import.meta.url),
);

const REQUIRED_VM_CASES = [
  "rejects wrong public shapes and unknown dependencies before work",
  "keeps injected authority simulated and the fixed protocol sequence",
  "proof failure returns no retention snapshot",
  "zero dependency protocol simulation returns the complete closed snapshot after one fixed flow",
  "zero dependency protocol simulation proof failure seals no archive",
  "zero dependency protocol simulation candidate seal failure returns only partial failure",
  "zero dependency protocol simulation archive close uncertainty returns no complete snapshot",
  "zero dependency protocol simulation close path replacement returns no complete snapshot",
  "zero dependency protocol simulation close deadline expiry returns no complete snapshot",
  "zero dependency protocol simulation context close uncertainty returns no complete snapshot",
  "projects a closed snapshot from the exact proof identities",
  "seals both exact archive identities before closing every owner",
  "rejects archive symlinks special files metadata drift and extra links",
  "rejects parent replacement and unauthorized namespace changes",
  "classifies every fsync failure and closes every owner once",
  "treats close failure as stability uncertainty without retry",
  "detects deadline expiry caused by close and still attempts every owner once",
  "detects named path replacement performed during close",
  "preserves stability classification when named guard receives raw ENOENT",
  "context-style owner failure attempts every descriptor without retry",
  "closes deadline rollback before snapshot success",
  "preserves legacy result shapes and keeps retention opt in",
];

test("retained build proof V1 VM cases execute in the ordinary test suite", () => {
  const environment = { ...process.env, NODE_NO_WARNINGS: "1" };
  delete environment.NODE_TEST_CONTEXT;
  const result = childProcess.spawnSync(process.execPath, [
    "--experimental-vm-modules",
    "--test",
    "--test-reporter=tap",
    "--test-name-pattern=^retained build proof V1 VM",
    OBSERVATION_TEST,
  ], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 16 * 1024 ** 2,
    timeout: 120_000,
  });
  const transcript = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, transcript);
  assert.match(result.stdout, new RegExp(`# pass ${REQUIRED_VM_CASES.length}(?:\\r?\\n|$)`, "u"), transcript);
  assert.match(result.stdout, /# fail 0(?:\r?\n|$)/u, transcript);
  assert.match(result.stdout, /# cancelled 0(?:\r?\n|$)/u, transcript);
  for (const name of REQUIRED_VM_CASES) {
    assert.match(result.stdout, new RegExp(`ok \\d+ - retained build proof V1 VM .*${name}`, "u"), transcript);
  }
});
