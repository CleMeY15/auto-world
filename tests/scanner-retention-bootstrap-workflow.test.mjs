import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(
  new URL("../.github/workflows/scanner-retention-package-bootstrap.yml", import.meta.url),
  "utf8",
));

const bootstrapGuard = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}";

test("scanner retention package bootstrap is a one-shot no-input protected-main writer", () => {
  assert.deepEqual(Object.keys(workflow).sort(), ["concurrency", "jobs", "name", "on", "permissions"]);
  assert.equal(workflow.name, "Scanner retention package bootstrap");
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, {
    group: "scanner-retention-package-bootstrap",
    "cancel-in-progress": false,
  });
  assert.deepEqual(Object.keys(workflow.jobs), ["bootstrap"]);

  const job = workflow.jobs.bootstrap;
  assert.deepEqual(Object.keys(job).sort(), ["if", "permissions", "runs-on", "steps", "timeout-minutes"]);
  assert.equal(job.if, bootstrapGuard);
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 10);
  assert.deepEqual(job.permissions, { contents: "read", packages: "write" });
  assert.equal(job.secrets, undefined);
  assert.equal(job.services, undefined);
  assert.equal(job.container, undefined);
});

test("scanner bootstrap uses pinned actions and exposes the token only to its bounded command", () => {
  const steps = workflow.jobs.bootstrap.steps;
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.map((step) => Object.keys(step).sort()), [
    ["name", "uses", "with"],
    ["name", "uses", "with"],
    ["continue-on-error", "env", "id", "name", "run"],
    ["if", "name", "uses", "with"],
    ["if", "name", "run"],
  ]);

  const actions = steps.filter((step) => step.uses);
  assert.deepEqual(actions.map(({ uses, with: options }) => ({ uses, with: options })), [
    {
      uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      with: { "persist-credentials": false },
    },
    {
      uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      with: { "node-version": "22.23.2", cache: "" },
    },
    {
      uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      with: {
        name: "scanner-retention-bootstrap-${{ github.run_id }}-${{ github.run_attempt }}",
        path: "${{ runner.temp }}/scanner-retention-bootstrap/receipt.json",
        "if-no-files-found": "error",
        "retention-days": 14,
        "compression-level": 6,
      },
    },
  ]);
  for (const action of actions) assert.match(action.uses, /@[a-f0-9]{40}$/u);

  const bootstrap = steps[2];
  assert.equal(bootstrap.id, "bootstrap");
  assert.equal(bootstrap["continue-on-error"], true);
  assert.deepEqual(bootstrap.env, { GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(
    bootstrap.run,
    "node scripts/scanner/retention-publish.mjs bootstrap --output \"${RUNNER_TEMP}/scanner-retention-bootstrap\"",
  );
  assert.equal(steps[3].if, "${{ always() }}");
  assert.equal(steps[4].if, "${{ steps.bootstrap.outcome != 'success' }}");
  assert.equal(steps[4].run, "exit 1");

  for (const [index, step] of steps.entries()) {
    if (index !== 2) assert.equal(step.env, undefined);
  }
});

test("scanner bootstrap uploads only its public receipt and contains no broader trigger or privilege", () => {
  const serialized = JSON.stringify(workflow);
  for (const forbidden of [
    "pull_request",
    "push",
    "schedule",
    "workflow_call",
    "workflow_run",
    "repository_dispatch",
    "id-token",
    "attestations",
    "actions\":\"write",
    "packages\":\"read",
    "secrets.",
    "download-artifact",
    "retention-publish.mjs read-proof",
    "retention-publish.mjs publish",
    "retention-restore.mjs",
    ".tar",
    "private-archive",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }

  const upload = workflow.jobs.bootstrap.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.with.path, "${{ runner.temp }}/scanner-retention-bootstrap/receipt.json");
  assert.doesNotMatch(upload.with.path, /[*?\[\]]|(?:^|\/)\.\.(?:\/|$)/u);
  assert.equal(workflow.jobs.bootstrap.steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@")).length, 1);
});
