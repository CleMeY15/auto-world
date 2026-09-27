import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = JSON.parse(readFileSync(new URL("../.github/workflows/postgres-package-bootstrap.yml", import.meta.url), "utf8"));

test("PostgreSQL bootstrap has one input-free main-only read lane after its exhausted write", () => {
  assert.deepEqual(Object.keys(workflow).sort(), ["concurrency", "jobs", "name", "on", "permissions"]);
  assert.equal(workflow.name, "PostgreSQL package private read");
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, { group: "postgres-package-private-read", "cancel-in-progress": false });
  assert.deepEqual(Object.keys(workflow.jobs), ["verify"]);
  const job = workflow.jobs.verify;
  assert.deepEqual(Object.keys(job).sort(), ["if", "permissions", "runs-on", "steps", "timeout-minutes"]);
  assert.equal(job.if, "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 2 && github.run_attempt == 1 }}");
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 15);
  assert.deepEqual(job.permissions, { contents: "read", packages: "read" });
});

test("PostgreSQL private reader retains only its receipt with no publication, signing or service execution", () => {
  const steps = workflow.jobs.verify.steps;
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.map((step) => Object.keys(step).sort()), [
    ["name", "uses", "with"], ["name", "uses", "with"],
    ["continue-on-error", "env", "id", "name", "run", "timeout-minutes"],
    ["if", "name", "uses", "with"], ["if", "name", "run"],
  ]);
  assert.deepEqual(steps.filter((step) => step.uses).map(({ uses, with: options }) => ({ uses, with: options })), [
    { uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", with: { "persist-credentials": false } },
    { uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", with: { "node-version": "22.23.2", cache: "" } },
    { uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", with: {
      name: "postgres-package-private-read-receipt", path: "${{ runner.temp }}/postgres-package-private-read/receipt.json",
      "if-no-files-found": "error", "retention-days": 14, "compression-level": 6,
    } },
  ]);
  assert.deepEqual(steps.filter((step) => step.run).map((step) => step.run), [
    "node scripts/postgres-image/package-private-read.mjs --output \"${RUNNER_TEMP}/postgres-package-private-read\"", "exit 1",
  ]);
  const verify = steps.find((step) => step.id === "verify");
  assert.deepEqual(verify.env, { GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(verify["timeout-minutes"], 12);
  assert.equal(verify["continue-on-error"], true);
  assert.equal(steps[3].if, "${{ always() }}");
  assert.equal(steps[4].if, "${{ steps.verify.outcome != 'success' }}");
  const serialized = JSON.stringify(workflow);
  for (const forbidden of ["workflow_call", "id-token", "attestations", "secrets.", "diagnostic.mjs", "scan.mjs", "candidate-image.tar", "--push", "package-bootstrap.mjs"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
