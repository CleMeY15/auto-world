import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(new URL("../.github/workflows/seaweed-package-bootstrap.yml", import.meta.url), "utf8"));
const mainOnly = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 2 && github.run_attempt == 1 }}";

test("SeaweedFS package proof is a one-shot no-input protected-main reader", () => {
  assert.equal(workflow.name, "SeaweedFS package bootstrap");
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ["verify"]);
  const job = workflow.jobs.verify;
  assert.equal(job.if, mainOnly);
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 10);
  assert.deepEqual(job.permissions, { contents: "read", packages: "read" });
  assert.equal(job.secrets, undefined);
  assert.equal(job.services, undefined);
  assert.equal(job.container, undefined);
  assert.doesNotMatch(JSON.stringify(workflow), /id-token|attest|pull_request|workflow_run|schedule|repository_dispatch|packages["']?\s*:\s*["']write|\bpublish\b/iu);
});

test("workflow pins actions, fixes the verifier, and retains only its public receipt", () => {
  const steps = workflow.jobs.verify.steps;
  const actions = steps.filter((step) => step.uses);
  assert.deepEqual(actions.map((step) => step.uses.split("@")[0]), ["actions/checkout", "actions/setup-node", "actions/upload-artifact"]);
  for (const action of actions) assert.match(action.uses, /@[a-f0-9]{40}$/u);
  assert.deepEqual(actions[0].with, { "persist-credentials": false });
  assert.deepEqual(actions[1].with, { "node-version": "22.23.2", cache: "" });
  assert.equal(actions[2].if, "${{ always() }}");
  assert.deepEqual(actions[2].with, {
    name: "seaweed-package-private-read-receipt",
    path: "${{ runner.temp }}/seaweed-package-private-read/receipt.json",
    "if-no-files-found": "error",
    "retention-days": 14,
    "compression-level": 6,
  });
  const commands = steps.filter((step) => step.run);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].id, "verify");
  assert.equal(commands[0]["continue-on-error"], true);
  assert.deepEqual(commands[0].env, { GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(commands[0].run, "node scripts/seaweed-image/package-private-read.mjs --output \"${RUNNER_TEMP}/seaweed-package-private-read\"");
  assert.equal(commands[1].if, "${{ steps.verify.outcome != 'success' }}");
  assert.equal(commands[1].run, "exit 1");
  assert.doesNotMatch(JSON.stringify(workflow), /package-bootstrap\.mjs|buildx\s+build|docker\s+push|--push|steps\.publish|needs\.|outputs/iu);
});
