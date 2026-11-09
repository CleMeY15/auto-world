import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(
  new URL("../.github/workflows/scanner-retention-package-read.yml", import.meta.url),
  "utf8",
));

const readGuard = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}";

test("scanner retention read proof is a first-run no-input protected-main reader", () => {
  assert.deepEqual(Object.keys(workflow).sort(), ["concurrency", "jobs", "name", "on", "permissions"]);
  assert.equal(workflow.name, "Scanner retention package read proof");
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, { group: "scanner-retention-package-read", "cancel-in-progress": false });
  assert.deepEqual(Object.keys(workflow.jobs), ["read-proof"]);

  const job = workflow.jobs["read-proof"];
  assert.equal(job.if, readGuard);
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 10);
  assert.deepEqual(job.permissions, { contents: "read", packages: "read" });
  assert.equal(job.secrets, undefined);
  assert.equal(job.services, undefined);
  assert.equal(job.container, undefined);
});

test("read proof uses the pinned toolchain, receipt-only upload and bounded outcome enforcement", () => {
  const steps = workflow.jobs["read-proof"].steps;
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.filter((step) => step.uses).map(({ uses, with: options }) => ({ uses, with: options })), [
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
        name: "scanner-retention-read-proof-${{ github.run_id }}-${{ github.run_attempt }}",
        path: "${{ runner.temp }}/scanner-retention-read-proof/receipt.json",
        "if-no-files-found": "error",
        "retention-days": 14,
        "compression-level": 6,
      },
    },
  ]);
  for (const action of steps.filter((step) => step.uses)) assert.match(action.uses, /@[a-f0-9]{40}$/u);

  const execute = steps[2];
  assert.equal(execute.id, "read-proof");
  assert.equal(execute["continue-on-error"], true);
  assert.deepEqual(execute.env, { GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(execute.run, "node scripts/scanner/retention-publish.mjs read-proof --output \"${RUNNER_TEMP}/scanner-retention-read-proof\"");
  assert.equal(steps[3].if, "${{ always() }}");
  assert.equal(steps[4].if, "${{ steps.read-proof.outcome != 'success' }}");
  assert.equal(steps[4].run, "exit 1");
  for (const [index, step] of steps.entries()) if (index !== 2) assert.equal(step.env, undefined);
});

test("read proof has no writer, OIDC, scanner execution or broad artifact surface", () => {
  const serialized = JSON.stringify(workflow);
  for (const forbidden of [
    "pull_request", "push", "schedule", "workflow_call", "workflow_run", "repository_dispatch",
    "id-token", "attestations", "actions\":\"write", "packages\":\"write", "secrets.",
    "download-artifact", "retention-publish.mjs bootstrap", "retention-publish.mjs publish",
    "retention-restore.mjs", "trivy", ".tar", "private-archive",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);

  const upload = workflow.jobs["read-proof"].steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.with.path, "${{ runner.temp }}/scanner-retention-read-proof/receipt.json");
  assert.doesNotMatch(upload.with.path, /[*?[\]]|(?:^|\/)\.\.(?:\/|$)/u);
  assert.equal(workflow.jobs["read-proof"].steps.filter((step) => step.uses?.startsWith("actions/upload-artifact@")).length, 1);
});
