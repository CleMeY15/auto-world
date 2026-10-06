import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = JSON.parse(readFileSync(".github/workflows/postgres-admission-current-audit.yml", "utf8"));
const historical = JSON.parse(readFileSync(".github/workflows/postgres-candidate-remote-audit.yml", "utf8"));
const workflowRef = "CleMeY15/auto-world/.github/workflows/postgres-admission-current-audit.yml@refs/heads/main";
const action = (job, name) => job.steps.find(step => step.uses?.startsWith(`actions/${name}@`));

test("current audit is an input-free read-only manual main route with pinned same-run builds", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ["audit", "build"]);
  assert.deepEqual(workflow.concurrency, { group: "postgres-admission-current-audit", "cancel-in-progress": false });
  const guard = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number > 0 && github.run_attempt == 1 }}";
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.if, guard);
    assert.equal(job["runs-on"], "ubuntu-24.04");
    const context = job.steps.find(step => step.name === "Require reviewed main dispatch");
    assert.ok(context);
    assert.ok(context.run.includes(workflowRef));
    assert.ok(context.run.includes('[[ "$GITHUB_RUN_NUMBER" =~ ^[1-9][0-9]{0,19}$ ]]'));
    assert.ok(context.run.includes('test "$GITHUB_RUN_ATTEMPT" = \'1\''));
    assert.doesNotMatch(context.run, /GITHUB_RUN_NUMBER.*= '1'/u);
    const checkout = action(job, "checkout");
    assert.equal(checkout.uses, action(historical.jobs[name], "checkout").uses);
    assert.deepEqual(checkout.with, { "persist-credentials": false });
    const node = action(job, "setup-node");
    assert.equal(node.uses, action(historical.jobs[name], "setup-node").uses);
    assert.deepEqual(node.with, { "node-version": "22.23.2", cache: "" });
  }
  assert.deepEqual(workflow.jobs.build.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs.build.strategy, { "fail-fast": false, matrix: { repeat: [1, 2] } });
  assert.deepEqual(workflow.jobs.audit.permissions, { contents: "read", actions: "read", packages: "read" });
  assert.equal(workflow.jobs.audit.needs, "build");
  const download = action(workflow.jobs.audit, "download-artifact");
  assert.equal(download.uses, action(historical.jobs.audit, "download-artifact").uses);
  assert.deepEqual(download.with, { pattern: "scanner-build-*", path: "${{ runner.temp }}/scanner-builds" });
  const docker = workflow.jobs.audit.steps.find(step => step.name === "Require temporary capacity and managed Docker identity");
  assert.ok(docker.run.includes("'28.0.4|28.0.4'"));
  assert.ok(docker.run.includes("12582912"));
});

test("current audit passes one ephemeral token only to execute and validates cleanup without credentials", () => {
  const execute = workflow.jobs.audit.steps.find(step => step.id === "scan_candidate");
  const cleanup = workflow.jobs.audit.steps.find(step => step.id === "cleanup");
  assert.deepEqual(execute.env, { GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(execute.run, "node scripts/postgres-image/admission-current-audit.mjs execute");
  assert.equal(execute["continue-on-error"], true);
  assert.equal(cleanup.run, "node scripts/postgres-image/admission-current-audit.mjs cleanup");
  assert.equal(cleanup.env, undefined);
  assert.equal(cleanup.if, "${{ always() }}");
  assert.equal(cleanup["continue-on-error"], true);
  const outcome = workflow.jobs.audit.steps.at(-1);
  assert.equal(outcome.if, "${{ steps.scan_candidate.outcome != 'success' || steps.cleanup.outcome != 'success' }}");
  assert.equal(outcome.run, "exit 1");
});

test("raw failures and current success projection have separate closed retrievable artifact boundaries", () => {
  const uploads = workflow.jobs.audit.steps.filter(step => step.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(uploads.length, 2);
  const raw = uploads.find(step => step.with.name === "postgres-admission-current-audit");
  const current = uploads.find(step => step.with.name === "postgres-admission-current-audit-projection");
  assert.equal(raw.if, "${{ always() && steps.cleanup.outcome == 'success' }}");
  assert.equal(raw.with.path, "${{ runner.temp }}/postgres-admission-current-audit-evidence");
  assert.equal(current.if, "${{ always() && steps.scan_candidate.outcome == 'success' && steps.cleanup.outcome == 'success' }}");
  assert.equal(current.with.path, "${{ runner.temp }}/postgres-admission-current-audit-projection/current-audit.json");
  for (const upload of [...uploads, action(workflow.jobs.build, "upload-artifact")]) {
    assert.equal(upload.uses, action(historical.jobs.audit, "upload-artifact").uses);
    assert.equal(upload.with["if-no-files-found"], "error");
    assert.equal(upload.with["retention-days"], 14);
    assert.equal(upload.with["compression-level"], 0);
    assert.doesNotMatch(upload.with.path, /\*|candidate\.tar|private-archive|docker-config/u);
  }
});
