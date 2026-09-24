import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseGateArguments, runArtifactGate } from "../scripts/seaweed/artifact-gate.mjs";

function fixture(operation) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-artifact-gate-"));
  const directory = path.join(root, "seaweed-build-1");
  const output = path.join(root, "seaweed-artifact-gate-1.json");
  try { operation({ root, directory, output, argv: ["--directory", directory, "--output", output], env: { RUNNER_TEMP: root } }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("artifact gate accepts bounded failed diagnostic evidence without reporting a successful build", () => fixture((options) => {
  const result = runArtifactGate({ ...options, validate: () => ({ result: "FAILED", totalBytes: 200 }) });
  assert.equal(result.result, "PASSED");
  assert.equal(result.buildResult, "FAILED");
  assert.deepEqual(JSON.parse(readFileSync(options.output, "utf8")), result);
}));

test("artifact gate retains only a fixed reason when validation throws sensitive content", () => fixture((options) => {
  const privateDiagnostic = "synthetic-sensitive-output-must-not-be-retained";
  assert.throws(() => runArtifactGate({ ...options, validate: () => { throw new Error(privateDiagnostic); } }), /seaweed_public_artifact_validation_failed/u);
  const bytes = readFileSync(options.output, "utf8");
  assert.equal(bytes.includes(privateDiagnostic), false);
  assert.deepEqual(JSON.parse(bytes), { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "FAILED", repeat: 1, reason: "seaweed_public_artifact_validation_failed" });
}));

test("artifact gate rejects missing build evidence", () => fixture((options) => {
  assert.throws(() => runArtifactGate(options), /seaweed_public_artifact_validation_failed/u);
  assert.equal(JSON.parse(readFileSync(options.output, "utf8")).result, "FAILED");
}));

test("artifact gate rejects an oversized validator result", () => fixture((options) => {
  assert.throws(() => runArtifactGate({ ...options, validate: () => ({ result: "PASSED", totalBytes: 2 * 1024 ** 3 + 1 }) }), /seaweed_public_artifact_validation_failed/u);
  assert.equal(JSON.parse(readFileSync(options.output, "utf8")).result, "FAILED");
}));

test("artifact gate refuses output replacement and paths outside its owned runner directory", () => fixture((options) => {
  const validate = () => ({ result: "PASSED", totalBytes: 100 });
  const wrong = path.join(options.root, "unrelated.json");
  assert.throws(() => runArtifactGate({ ...options, argv: ["--directory", options.directory, "--output", wrong], validate }), /seaweed_artifact_gate_path_invalid/u);
  assert.equal(existsSync(wrong), false);
  runArtifactGate({ ...options, validate });
  const original = readFileSync(options.output, "utf8");
  assert.throws(() => runArtifactGate({ ...options, validate }), /seaweed_artifact_gate_path_invalid/u);
  assert.equal(readFileSync(options.output, "utf8"), original);
}));

test("artifact gate arguments reject relative, duplicated or extra paths", () => {
  for (const argv of [[], ["--directory", "relative", "--output", "/tmp/out"], ["--directory", "/tmp/in", "--directory", "/tmp/out"],
    ["--directory", "/tmp/in", "--output", "/tmp/out", "--extra", "x"]]) assert.throws(() => parseGateArguments(argv), /seaweed_artifact_gate_arguments_invalid/u);
});
