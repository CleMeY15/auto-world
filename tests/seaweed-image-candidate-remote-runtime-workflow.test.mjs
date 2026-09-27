import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(
  new URL("../.github/workflows/seaweed-candidate-remote-runtime.yml", import.meta.url), "utf8"));
const mainOnly = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 2 && github.run_attempt == 1 }}";
const runtime = workflow.jobs.runtime;
const steps = runtime.steps;

test("remote runtime grants only read permissions on a unique reviewed main dispatch", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ["runtime"]);
  assert.deepEqual(workflow.concurrency,
    { group: "seaweed-candidate-remote-runtime", "cancel-in-progress": false });
  assert.equal(runtime.if, mainOnly);
  assert.equal(runtime["runs-on"], "ubuntu-24.04");
  assert.equal(runtime["timeout-minutes"], 120);
  assert.deepEqual(runtime.permissions, { contents: "read", actions: "read", packages: "read" });
  assert.doesNotMatch(JSON.stringify(workflow),
    /packages":"write|contents":"write|actions":"write|id-token|attestations|secrets|pull_request|workflow_run|workflow_call|schedule|repository_dispatch/iu);
});

test("runtime guards repository, runner and exact second reviewed dispatch before checkout", () => {
  const guard = steps[0];
  assert.equal(guard.name, "Require the second reviewed main dispatch");
  assert.equal(guard["timeout-minutes"], 2);
  assert.match(guard.run, /^set -euo pipefail$/mu);
  for (const [variable, value] of [["GITHUB_REPOSITORY", "CleMeY15/auto-world"],
    ["RUNNER_ENVIRONMENT", "github-hosted"], ["GITHUB_EVENT_NAME", "workflow_dispatch"],
    ["GITHUB_REF", "refs/heads/main"], ["GITHUB_RUN_NUMBER", "2"], ["GITHUB_RUN_ATTEMPT", "1"],
    ["GITHUB_WORKFLOW_REF", "CleMeY15/auto-world/.github/workflows/seaweed-candidate-remote-runtime.yml@refs/heads/main"]]) {
    assert.ok(guard.run.includes(`test "$${variable}" = '${value}'`));
  }
});

test("runtime retains pinned tooling, owned capacity and current checkout identity", () => {
  assert.deepEqual(steps.filter((step) => step.uses).map((step) => step.uses), [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  ]);
  assert.match(steps[1].run, /test "\$available_kib" -ge 4194304/u);
  assert.match(steps[1].run, /test "\$\(docker version --format '\{\{\.Server\.Version\}\}'\)" = '28\.0\.4'/u);
  assert.deepEqual(steps[2].with, { "persist-credentials": false });
  assert.match(steps[3].run, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
  assert.deepEqual(steps[4].with, { "node-version": "22.23.2", cache: "" });
});

test("runtime consumes only the fixed prior audit and keeps transport credentials outside cleanup", () => {
  assert.deepEqual(steps[5].with, { name: "seaweed-candidate-remote-audit",
    repository: "CleMeY15/auto-world", "run-id": "36325906357", "github-token": "${{ github.token }}",
    path: "${{ runner.temp }}/seaweed-candidate-remote-audit-input" });
  assert.equal(steps[5]["timeout-minutes"], 10);
  assert.equal(steps[6]["timeout-minutes"], 105);
  assert.deepEqual(steps[6].env, { GH_TOKEN: "${{ github.token }}", GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(steps[6].run, "node scripts/seaweed-image/candidate-remote-runtime-diagnostic.mjs execute");
  assert.equal(steps[7].if, "${{ always() }}");
  assert.equal(steps[7].env, undefined);
  assert.equal(steps[7].run, "node scripts/seaweed-image/candidate-remote-runtime-diagnostic.mjs cleanup");
});

test("runtime publishes only a bounded technical receipt after its cleanup step", () => {
  assert.equal(steps[8].if, "${{ always() }}");
  assert.deepEqual(steps[8].with, { name: "seaweed-candidate-remote-runtime",
    path: "${{ runner.temp }}/seaweed-candidate-remote-runtime-evidence/runtime-receipt.json",
    "if-no-files-found": "warn", "retention-days": 14, "compression-level": 0 });
  const serialized = JSON.stringify(workflow);
  assert.equal([...serialized.matchAll(/candidate-remote-runtime-diagnostic\.mjs execute/gu)].length, 1);
  assert.equal([...serialized.matchAll(/candidate-remote-runtime-diagnostic\.mjs cleanup/gu)].length, 1);
  assert.doesNotMatch(serialized,
    /candidate-publish|package-bootstrap|docker\s+(?:login|push|run|create|start)|buildx\s+build|gh\s+workflow\s+run|\.tar|private-archive|source\.zip|source-zips/iu);
});
