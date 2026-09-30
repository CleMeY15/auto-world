import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(new URL(
  "../.github/workflows/postgres-candidate-remote-runtime-diagnostic-v2.yml", import.meta.url), "utf8"));
const policy = JSON.parse(await readFile(new URL(
  "../infra/postgres-image/candidate-runtime.json", import.meta.url), "utf8"));
const runtime = workflow.jobs.runtime;
const steps = runtime.steps;

test("remote PostgreSQL runtime has one input-free first-main diagnostic with read permissions", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency,
    { group: "postgres-candidate-remote-runtime-diagnostic-v2", "cancel-in-progress": false });
  assert.deepEqual(Object.keys(workflow.jobs), ["runtime"]);
  assert.equal(runtime.if, "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}");
  assert.equal(runtime["runs-on"], "ubuntu-24.04");
  assert.equal(runtime["timeout-minutes"], 45);
  assert.deepEqual(runtime.permissions, { contents: "read", actions: "read", packages: "read" });
  assert.doesNotMatch(JSON.stringify(workflow),
    /"(?:packages|contents|actions)":"write"|id-token|attestations|secrets|pull_request|workflow_run|workflow_call|schedule|repository_dispatch|github\.event\.inputs|inputs\./iu);
});

test("runtime requires hosted first dispatch, exact clean source and pinned managed tools", () => {
  assert.equal(steps.length, 10);
  const guard = steps[0].run;
  for (const [variable, value] of [
    ["GITHUB_REPOSITORY", "CleMeY15/auto-world"], ["RUNNER_ENVIRONMENT", "github-hosted"],
    ["GITHUB_EVENT_NAME", "workflow_dispatch"], ["GITHUB_REF", "refs/heads/main"],
    ["GITHUB_RUN_NUMBER", "1"], ["GITHUB_RUN_ATTEMPT", "1"],
    ["GITHUB_WORKFLOW_REF", "CleMeY15/auto-world/.github/workflows/postgres-candidate-remote-runtime-diagnostic-v2.yml@refs/heads/main"],
  ]) assert.ok(guard.includes(`test "$${variable}" = '${value}'`));
  assert.match(guard, /^set -euo pipefail$/mu);
  assert.match(steps[1].run, /test "\$available_kib" -ge 6291456/u);
  assert.match(steps[1].run, /'28\.0\.4\|28\.0\.4'/u);
  assert.equal(steps[2].uses, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
  assert.deepEqual(steps[2].with, { "persist-credentials": false });
  assert.match(steps[3].run, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
  assert.match(steps[3].run, /test -z "\$\(git status --porcelain --untracked-files=normal\)"/u);
  assert.equal(steps[4].uses, "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020");
  assert.deepEqual(steps[4].with, { "node-version": "22.23.2", cache: "" });
  for (const step of steps.slice(0, 6)) assert.equal(step["continue-on-error"], undefined);
});

test("runtime downloads only the committed successful audit artifact and rejects digest mismatch", () => {
  const download = steps[5];
  assert.equal(download.uses, "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c");
  assert.deepEqual(download.with, {
    "artifact-ids": String(policy.audit.artifact.id), "run-id": policy.audit.runId,
    repository: policy.audit.repository, "github-token": "${{ github.token }}",
    path: "${{ runner.temp }}/postgres-runtime-audit-download",
    "merge-multiple": true, "digest-mismatch": "error",
  });
  assert.equal(policy.audit.files.length, 16);
  assert.equal(policy.authority, "DIAGNOSTIC_ONLY");
  assert.equal(policy.admission, "NOT_AUTHORIZED");
  for (const field of ["supportStartedAt", "supportEndsAt", "archiveUntil"])
    assert.equal(policy[field], null);
});

test("one production entrypoint owns runtime and cleanup gates the sole public receipt upload", () => {
  assert.equal(steps[6].id, "runtime");
  assert.equal(steps[6]["continue-on-error"], true);
  assert.equal(steps[6]["timeout-minutes"], 30);
  assert.deepEqual(steps[6].env,
    { GH_TOKEN: "${{ github.token }}", GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(steps[6].run,
    "node scripts/postgres-image/candidate-remote-runtime-diagnostic.mjs execute");
  assert.equal(steps[7].id, "cleanup");
  assert.equal(steps[7].if, "${{ always() }}");
  assert.equal(steps[7]["continue-on-error"], true);
  assert.equal(steps[7]["timeout-minutes"], 5);
  assert.equal(steps[7].env, undefined);
  assert.equal(steps[7].run,
    "node scripts/postgres-image/candidate-remote-runtime-diagnostic.mjs cleanup");
  assert.equal(steps[8].if, "${{ always() && steps.cleanup.outcome == 'success' }}");
  assert.equal(steps[8].uses, "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
  assert.deepEqual(steps[8].with, {
    name: "postgres-candidate-remote-runtime-diagnostic",
    path: "${{ runner.temp }}/postgres-candidate-remote-runtime-evidence",
    "if-no-files-found": "warn", "retention-days": 14, "compression-level": 0,
  });
  assert.equal(steps[9].if,
    "${{ steps.runtime.outcome != 'success' || steps.cleanup.outcome != 'success' }}");
  assert.equal(steps[9].run, "exit 1");
  assert.doesNotMatch(JSON.stringify(workflow),
    /candidate-publish|package-bootstrap|docker\s+(?:login|push|run|create|start|exec)|buildx\s+build|gh\s+workflow\s+run|\.tar|private-archive/iu);
});
