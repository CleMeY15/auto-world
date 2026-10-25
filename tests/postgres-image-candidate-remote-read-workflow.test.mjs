import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(
  new URL("../.github/workflows/postgres-candidate-remote-read.yml", import.meta.url), "utf8"));
const mainOnly = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}";
const checkout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupNode = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const upload = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";

test("remote read is an input-free first-run protected-main workflow with read-only permissions", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, { group: "postgres-candidate-remote-read", "cancel-in-progress": false });
  assert.deepEqual(Object.keys(workflow.jobs), ["read"]);
  const job = workflow.jobs.read;
  assert.equal(job.if, mainOnly); assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.deepEqual(job.permissions, { contents: "read", packages: "read" });
  const serialized = JSON.stringify(workflow);
  assert.doesNotMatch(serialized,
    /packages":"write|contents":"write|actions":"(?:read|write)|id-token|attestations|secrets|pull_request|workflow_run|workflow_call|schedule|repository_dispatch/iu);
});

test("workflow pins tools, managed Docker identity and exact checkout", () => {
  const steps = workflow.jobs.read.steps;
  assert.deepEqual(steps.filter((step) => step.uses).map((step) => step.uses), [checkout, setupNode, upload]);
  assert.match(steps[0].run, /GITHUB_RUN_NUMBER.*'1'/su);
  assert.match(steps[0].run, /GITHUB_RUN_ATTEMPT.*'1'/su);
  assert.match(steps[0].run,
    /postgres-candidate-remote-read\.yml@refs\/heads\/main/u);
  assert.match(steps[1].run, /28\.0\.4\|28\.0\.4/u);
  assert.deepEqual(steps[2].with, { "persist-credentials": false });
  assert.match(steps[3].run, /git rev-parse HEAD/u);
  assert.match(steps[3].run, /git status --porcelain --untracked-files=normal/u);
  assert.deepEqual(steps[4].with, { "node-version": "22.23.2", cache: "" });
});

test("workflow invokes only the read-only entrypoint, cleans first and uploads only its receipt", () => {
  const steps = workflow.jobs.read.steps;
  const tokens = { GH_TOKEN: "${{ github.token }}", GITHUB_TOKEN: "${{ github.token }}" };
  assert.equal(steps[5].run, "node scripts/postgres-image/candidate-remote-read.mjs execute");
  assert.deepEqual(steps[5].env, tokens); assert.equal(steps[5]["continue-on-error"], true);
  assert.equal(steps[6].if, "${{ always() }}");
  assert.equal(steps[6].run, "node scripts/postgres-image/candidate-remote-read.mjs cleanup");
  assert.equal(steps[6]["continue-on-error"], true);
  assert.deepEqual(steps[7].with, { name: "postgres-candidate-remote-read-receipt",
    path: "${{ runner.temp }}/postgres-candidate-remote-read-evidence/receipt.json",
    "if-no-files-found": "error", "retention-days": 14, "compression-level": 6 });
  const serialized = JSON.stringify(workflow);
  assert.equal([...serialized.matchAll(/candidate-remote-read\.mjs execute/gu)].length, 1);
  assert.equal([...serialized.matchAll(/candidate-remote-read\.mjs cleanup/gu)].length, 1);
  assert.doesNotMatch(serialized,
    /docker\s+(?:run|start|exec|push)|candidate-(?:publish|scan)|scan\.mjs|\.tar|private-archive|source\.zip|source-zips/iu);
});
