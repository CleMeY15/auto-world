import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(new URL("../.github/workflows/seaweed-candidate-publish.yml", import.meta.url), "utf8"));
const mainOnly = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}";

test("candidate publication grants only a one-shot main writer without signing or execution jobs", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, { group: "seaweed-candidate-publication", "cancel-in-progress": false });
  assert.deepEqual(Object.keys(workflow.jobs), ["publish"]);
  const job = workflow.jobs.publish;
  assert.equal(job.if, mainOnly);
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 180);
  assert.deepEqual(job.permissions, { contents: "read", actions: "read", packages: "write" });
  for (const key of ["secrets", "services", "container", "outputs", "strategy"]) assert.equal(job[key], undefined);
  assert.doesNotMatch(JSON.stringify(workflow), /id-token|attestations|pull_request|workflow_run|workflow_call|schedule|repository_dispatch|docker\s+(run|create)|--privileged/iu);
});

test("candidate workflow pins tooling, checks capacity and uploads only a bounded receipt", () => {
  const steps = workflow.jobs.publish.steps;
  const actions = steps.filter((step) => step.uses);
  assert.deepEqual(actions.map((step) => step.uses), [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  ]);
  assert.deepEqual(actions[0].with, { "persist-credentials": false });
  assert.deepEqual(actions[1].with, { "node-version": "22.23.2", cache: "" });
  assert.equal(actions[2].if, "${{ always() }}");
  assert.deepEqual(actions[2].with, {
    name: "seaweed-candidate-publish-receipt",
    path: "${{ runner.temp }}/seaweed-candidate-publish/receipt.json",
    "if-no-files-found": "error", "retention-days": 14, "compression-level": 6,
  });
  const commands = steps.filter((step) => step.run);
  assert.equal(commands.length, 3);
  assert.equal(commands[0]["timeout-minutes"], 2);
  assert.match(commands[0].run, /set -euo pipefail/u);
  assert.match(commands[0].run, /test "\$available_kib" -ge 12582912/u);
  assert.match(commands[0].run, /docker version --format '\{\{\.Server\.Version\}\}'\)" = '28\.0\.4'/u);
  assert.equal(commands[1].id, "publish");
  assert.equal(commands[1]["timeout-minutes"], 165);
  assert.equal(commands[1]["continue-on-error"], true);
  assert.deepEqual(commands[1].env, { GH_TOKEN: "${{ github.token }}", GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(commands[1].run, "node scripts/seaweed-image/candidate-publish.mjs --output \"${RUNNER_TEMP}/seaweed-candidate-publish\"");
  assert.equal(commands[2].if, "${{ steps.publish.outcome != 'success' }}");
  assert.equal(commands[2].run, "exit 1");
  assert.equal(steps.indexOf(commands[0]) < steps.indexOf(commands[1]), true);
  assert.equal(steps.indexOf(actions[2]) > steps.indexOf(commands[1]), true);
  assert.doesNotMatch(JSON.stringify(workflow), /download-artifact|buildx\s+build|needs\.|\*\.tar|\*\.zip/iu);
});
