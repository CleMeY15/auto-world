import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = JSON.parse(readFileSync(new URL("../.github/workflows/image-import-fixture.yml", import.meta.url), "utf8"));

test("synthetic import workflow is main-only, input-free and source-read-only", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.on).sort(), ["push", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.workflow_dispatch, {});
  assert.deepEqual(workflow.on.push, { branches: ["main"], paths: [".github/workflows/image-import-fixture.yml", "scripts/image-import-fixture/**", "tests/image-import-fixture*.test.mjs"] });
  assert.deepEqual(workflow.concurrency, { group: "image-import-fixture", "cancel-in-progress": false });
  assert.deepEqual(Object.keys(workflow.jobs), ["diagnostic"]);
  const job = workflow.jobs.diagnostic;
  assert.equal(job.if, "${{ github.repository == 'CleMeY15/auto-world' && github.ref == 'refs/heads/main' && github.run_attempt == 1 }}");
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 10);
  assert.deepEqual(Object.keys(job).sort(), ["if", "runs-on", "steps", "timeout-minutes"]);
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|github\.token|id-token|packages\s*"\s*:|pull_request/u);
});

test("synthetic import pins actions, retains only sanitized receipt and propagates failure", () => {
  const steps = workflow.jobs.diagnostic.steps;
  assert.equal(steps.length, 5);
  assert.equal(steps[0].uses, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
  assert.deepEqual(steps[0].with, { "persist-credentials": false });
  assert.equal(steps[1].uses, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
  assert.deepEqual(steps[1].with, { "node-version": "22.23.2", cache: "" });
  assert.equal(steps[2].id, "diagnostic");
  assert.equal(steps[2]["continue-on-error"], true);
  assert.equal(steps[2].run, 'node scripts/image-import-fixture/run.mjs --output "${RUNNER_TEMP}/image-import-fixture"');
  assert.equal(steps[3].uses, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
  assert.equal(steps[3].if, "${{ always() }}");
  assert.deepEqual(steps[3].with, { name: "image-import-fixture-receipt", path: "${{ runner.temp }}/image-import-fixture/receipt.json",
    "if-no-files-found": "error", "retention-days": 14, "compression-level": 6 });
  assert.equal(steps[4].if, "${{ steps.diagnostic.outcome != 'success' }}");
  assert.equal(steps[4].run, "exit 1");
  for (const step of steps) assert.equal(step.env, undefined);
});
