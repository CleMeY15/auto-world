import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { assertClosedObject, canonicalJsonBuffer, sha256 } from "./strict-json.mjs";
import { hashFileBounded } from "./native-audit.mjs";
import { policyError } from "./process.mjs";

const HASH = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const TOOLS = ["oras", "cosign", "trivy"];
const FILES = { oras: { "linux-amd64": "out/oras" }, cosign: { "linux-amd64": "out/cosign", "windows-amd64": "out/cosign.exe" }, trivy: { "linux-amd64": "out/trivy" } };
const fail = (code) => { throw policyError(code); };
const equal = (actual, expected) => {
  if (expected === undefined || actual !== expected) fail("candidate_identity_mismatch");
};

// Expected identities are derived from the independently read, committed lock
// and exact CI checkout. A candidate receipt must never supply its own expected.
export function validateNativeBuildRecord(record, expected) {
  assertClosedObject(record, ["schemaVersion", "state", "tool", "repeat", "sourceCommit", "repositoryCommit", "selectionSha256", "materialLockSha256", "recipeSha256", "compilerVersion", "runner", "run", "versionOutputSha256", "outputs"]);
  if (record.schemaVersion !== 1 || record.state !== "built_candidate" || !TOOLS.includes(record.tool) || ![1, 2].includes(record.repeat)) fail("candidate_record_invalid");
  for (const key of ["tool", "repeat", "sourceCommit", "repositoryCommit", "selectionSha256", "materialLockSha256", "recipeSha256", "compilerVersion"]) equal(record[key], expected[key]);
  if (!COMMIT.test(record.sourceCommit) || !COMMIT.test(record.repositoryCommit) || record.compilerVersion !== "1.26.8" ||
      ![record.selectionSha256, record.materialLockSha256, record.recipeSha256, record.versionOutputSha256].every((value) => HASH.test(value))) fail("candidate_record_invalid");
  assertClosedObject(record.run, ["id", "attempt", "workflowSha", "sourceSha"]);
  for (const key of ["id", "attempt", "workflowSha", "sourceSha"]) equal(record.run[key], expected.run?.[key]);
  if (typeof record.run.id !== "string" || !/^[1-9][0-9]*$/u.test(record.run.id) || !Number.isSafeInteger(record.run.attempt) ||
      record.run.attempt < 1 || !COMMIT.test(record.run.workflowSha) || record.run.sourceSha !== record.repositoryCommit) fail("candidate_run_invalid");
  assertClosedObject(record.runner, ["label", "imageVersion"]);
  equal(record.runner.label, "ubuntu-24.04");
  equal(record.runner.imageVersion, expected.runnerImageVersion);
  if (typeof record.runner.imageVersion !== "string" || !/^[0-9]{8}\.[0-9]+\.[0-9]+$/u.test(record.runner.imageVersion)) fail("candidate_runner_invalid");
  const targets = FILES[record.tool];
  if (!Array.isArray(record.outputs) || record.outputs.length !== Object.keys(targets).length) fail("candidate_outputs_invalid");
  const seen = new Set();
  for (const output of record.outputs) {
    assertClosedObject(output, ["target", "path", "sha256", "size", "buildInfo", "buildInfoSha256"]);
    if (!Object.hasOwn(targets, output.target) || seen.has(output.target) || output.path !== targets[output.target] ||
        !HASH.test(output.sha256) || !HASH.test(output.buildInfoSha256) || !Number.isSafeInteger(output.size) || output.size < 1 || output.size > 512 * 1024 * 1024) fail("candidate_outputs_invalid");
    seen.add(output.target);
    if (!Array.isArray(output.buildInfo) || output.buildInfo.length === 0 || output.buildInfo.length > 100_000 ||
        output.buildInfo.some((line) => typeof line !== "string" || line.length === 0 || line.length > 16_384)) fail("candidate_build_info_invalid");
    const bytes = canonicalJsonBuffer(output.buildInfo);
    if (bytes.length > 8 * 1024 * 1024 || sha256(bytes) !== output.buildInfoSha256) fail("candidate_build_info_invalid");
  }
  return record;
}

export async function verifyNativeBuildDirectory(directory, record, expected) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) || await realpath(directory) !== directory) fail("candidate_directory_invalid");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail("candidate_directory_invalid");
  validateNativeBuildRecord(record, expected);
  for (const output of record.outputs) {
    const actual = await hashFileBounded(path.join(directory, output.path), 512 * 1024 * 1024);
    equal(actual.sha256, output.sha256);
    equal(actual.size, output.size);
  }
  return record;
}

// This establishes only exact native byte reproducibility. Upstream tests, CLI
// probes, source closure and vulnerability audits are separate mandatory gates.
export function compareNativeBuilds(records, expectations) {
  if (!Array.isArray(records) || records.length !== 6 || !Array.isArray(expectations) || expectations.length !== 6) fail("candidate_matrix_incomplete");
  const expectedByKey = new Map();
  for (const expected of expectations) {
    const key = `${expected.tool}:${expected.repeat}`;
    if (!TOOLS.includes(expected.tool) || ![1, 2].includes(expected.repeat) || expectedByKey.has(key)) fail("candidate_matrix_invalid");
    expectedByKey.set(key, expected);
  }
  const byKey = new Map();
  for (const record of records) {
    const key = `${record.tool}:${record.repeat}`;
    if (byKey.has(key) || !expectedByKey.has(key)) fail("candidate_matrix_invalid");
    byKey.set(key, validateNativeBuildRecord(record, expectedByKey.get(key)));
  }
  const binaries = [];
  for (const tool of TOOLS) {
    const first = byKey.get(`${tool}:1`);
    const second = byKey.get(`${tool}:2`);
    if (!first || !second) fail("candidate_matrix_incomplete");
    for (const key of ["sourceCommit", "repositoryCommit", "selectionSha256", "materialLockSha256", "recipeSha256", "compilerVersion", "versionOutputSha256"]) {
      if (first[key] !== second[key]) fail("candidate_reproducibility_mismatch");
    }
    if (first.runner.imageVersion !== second.runner.imageVersion) fail("candidate_reproducibility_mismatch");
    if (sha256(canonicalJsonBuffer(first.run)) !== sha256(canonicalJsonBuffer(second.run))) fail("candidate_reproducibility_mismatch");
    for (const output of first.outputs) {
      const twin = second.outputs.find((entry) => entry.target === output.target);
      if (!twin || output.sha256 !== twin.sha256 || output.size !== twin.size || output.buildInfoSha256 !== twin.buildInfoSha256) fail("candidate_reproducibility_mismatch");
      binaries.push(Object.freeze({ tool, target: output.target, sha256: output.sha256, size: output.size }));
    }
  }
  return Object.freeze({ state: "reproducible_candidate", binaries: Object.freeze(binaries) });
}
