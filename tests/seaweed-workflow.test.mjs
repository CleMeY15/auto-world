import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = JSON.parse(readFileSync(new URL("../.github/workflows/seaweed-build.yml", import.meta.url), "utf8"));

function validateWorkflow(value) {
  assert.deepEqual(value.on, { workflow_dispatch: {} });
  assert.deepEqual(value.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(value.jobs), ["build", "compare"]);
  assert.doesNotMatch(JSON.stringify(value), /secrets\.|github\.token|id-token|packages\s*"\s*:|workflow_run/u);
  for (const job of Object.values(value.jobs)) {
    assert.equal(job["runs-on"], "ubuntu-24.04");
    for (const key of ["permissions", "secrets", "env", "container", "services"]) assert.equal(job[key], undefined);
    for (const step of job.steps) {
      assert.equal(step.env, undefined);
      if (step.uses) assert.match(step.uses, /^actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@[a-f0-9]{40}$/u);
      if (step.uses?.startsWith("actions/checkout@")) assert.deepEqual(step.with, { "persist-credentials": false });
      if (step.uses?.startsWith("actions/setup-node@")) assert.deepEqual(step.with, { "node-version": "22.23.2", cache: "" });
    }
  }
  assert.equal(value.jobs.build.if, "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_attempt == 1 }}");
  assert.deepEqual(value.jobs.build.strategy, { "fail-fast": false, matrix: { repeat: [1, 2] } });
  assert.equal(value.jobs.build["timeout-minutes"], 90);
  assert.deepEqual(value.jobs.compare.needs, ["build"]);
  const steps = value.jobs.build.steps;
  const gate = steps.findIndex((step) => step.id === "artifact_gate");
  const upload = steps.findIndex((step) => step.with?.name === "seaweed-build-${{ matrix.repeat }}");
  assert.ok(gate > 0 && upload > gate);
  assert.equal(steps[gate].if, "${{ always() }}");
  assert.equal(steps[upload].if, "${{ always() && steps.artifact_gate.outcome == 'success' }}");
  assert.deepEqual(steps[upload].with, { name: "seaweed-build-${{ matrix.repeat }}", path: "${{ runner.temp }}/seaweed-build-${{ matrix.repeat }}", "if-no-files-found": "error", "retention-days": 14, "compression-level": 0, "include-hidden-files": true });
  assert.equal(steps.at(-1).if, "${{ steps.build.outcome != 'success' || steps.artifact_gate.outcome != 'success' }}");
  assert.equal(steps.at(-1).run, "exit 1");
  const download = value.jobs.compare.steps.find((step) => step.uses?.startsWith("actions/download-artifact@"));
  assert.deepEqual(download.with, { pattern: "seaweed-build-*", path: "${{ runner.temp }}/seaweed-builds" });
  assert.equal(value.jobs.compare.steps.at(-1).if, "${{ steps.compare.outcome != 'success' }}");
  assert.equal(value.jobs.compare.steps.at(-1).run, "exit 1");
}

test("Seaweed workflow bounds manual main builds, permissions and validated artifact transport", () => validateWorkflow(workflow));

test("Seaweed workflow rejects privilege escalation, unguarded upload and cross-run artifact substitution", () => {
  for (const mutate of [
    (value) => { value.jobs.build.permissions = { packages: "write" }; },
    (value) => { value.on.pull_request = {}; },
    (value) => { value.jobs.build.steps.find((step) => step.with?.name === "seaweed-build-${{ matrix.repeat }}").if = "${{ always() }}"; },
    (value) => { value.jobs.compare.steps.find((step) => step.uses?.startsWith("actions/download-artifact@" )).with["run-id"] = "other-run"; },
  ]) {
    const changed = JSON.parse(JSON.stringify(workflow)); mutate(changed);
    assert.throws(() => validateWorkflow(changed));
  }
});
