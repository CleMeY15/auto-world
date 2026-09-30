import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = JSON.parse(await readFile(
  new URL("../.github/workflows/postgres-candidate-remote-audit.yml", import.meta.url), "utf8"));
const mainOnly = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}";
const checkout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const setupNode = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const download = "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c";
const upload = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a";

test("PostgreSQL remote audit is input-free, first-run main only and read only", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency,
    { group: "postgres-candidate-remote-audit", "cancel-in-progress": false });
  assert.deepEqual(Object.keys(workflow.jobs), ["build", "audit"]);
  const build = workflow.jobs.build;
  assert.equal(build.if, mainOnly);
  assert.equal(build["runs-on"], "ubuntu-24.04");
  assert.equal(build["timeout-minutes"], 90);
  assert.deepEqual(build.permissions, { contents: "read" });
  assert.deepEqual(build.strategy, { "fail-fast": false, matrix: { repeat: [1, 2] } });
  const audit = workflow.jobs.audit;
  assert.equal(audit.if, mainOnly);
  assert.equal(audit.needs, "build");
  assert.equal(audit["runs-on"], "ubuntu-24.04");
  assert.equal(audit["timeout-minutes"], 360);
  assert.deepEqual(audit.permissions,
    { contents: "read", actions: "read", packages: "read" });
  assert.doesNotMatch(JSON.stringify(workflow),
    /"(?:packages|contents|actions)":"write"|id-token|attestations|secrets|pull_request|workflow_run|workflow_call|schedule|repository_dispatch|github\.event\.inputs|inputs\./iu);
});

test("both jobs guard the managed runner and exact first dispatch before checkout", () => {
  for (const job of Object.values(workflow.jobs)) {
    const guard = job.steps[0];
    assert.equal(guard.name, "Require the first reviewed main dispatch");
    assert.equal(guard["timeout-minutes"], 2);
    assert.match(guard.run, /^set -euo pipefail$/mu);
    assert.match(guard.run, /test "\$GITHUB_REPOSITORY" = 'CleMeY15\/auto-world'/u);
    assert.match(guard.run, /test "\$RUNNER_ENVIRONMENT" = 'github-hosted'/u);
    assert.match(guard.run, /test "\$GITHUB_EVENT_NAME" = 'workflow_dispatch'/u);
    assert.match(guard.run, /test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
    assert.match(guard.run, /test "\$GITHUB_RUN_NUMBER" = '1'/u);
    assert.match(guard.run, /test "\$GITHUB_RUN_ATTEMPT" = '1'/u);
    assert.match(guard.run,
      /test "\$GITHUB_WORKFLOW_REF" = 'CleMeY15\/auto-world\/\.github\/workflows\/postgres-candidate-remote-audit\.yml@refs\/heads\/main'/u);
    assert.equal(guard["continue-on-error"], undefined);
  }
});

test("independent scanner builds use pinned reviewed source without registry capabilities", () => {
  const steps = workflow.jobs.build.steps;
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.filter((step) => step.uses).map((step) => step.uses),
    [checkout, setupNode, upload]);
  assert.deepEqual(steps[1].with, { "persist-credentials": false });
  assert.deepEqual(steps[2].with, { "node-version": "22.23.2", cache: "" });
  assert.equal(steps[3].run,
    "node scripts/scanner/build.mjs --repeat ${{ matrix.repeat }} --output \"${RUNNER_TEMP}/scanner-build-${{ matrix.repeat }}\"");
  assert.equal(steps[3]["continue-on-error"], undefined);
  assert.equal(steps[4].if, "${{ always() }}");
  assert.deepEqual(steps[4].with, {
    name: "scanner-build-${{ matrix.repeat }}",
    path: "${{ runner.temp }}/scanner-build-${{ matrix.repeat }}",
    "if-no-files-found": "warn", "retention-days": 14, "compression-level": 0,
  });
  assert.doesNotMatch(JSON.stringify(steps), /github\.token|GH_TOKEN|GITHUB_TOKEN|packages|scripts\/postgres-image/u);
});

test("audit binds exact checkout and managed Docker and downloads only same-run scanner builds", () => {
  const steps = workflow.jobs.audit.steps;
  assert.equal(steps.length, 10);
  assert.deepEqual(steps.filter((step) => step.uses).map((step) => step.uses),
    [checkout, setupNode, download, upload]);
  assert.equal(steps[1]["timeout-minutes"], 2);
  assert.match(steps[1].run, /test "\$available_kib" -ge 12582912/u);
  assert.match(steps[1].run,
    /test "\$\(docker version --format '\{\{\.Client\.Version\}\}\|\{\{\.Server\.Version\}\}'\)" = '28\.0\.4\|28\.0\.4'/u);
  assert.deepEqual(steps[2].with, { "persist-credentials": false });
  assert.equal(steps[3]["timeout-minutes"], 2);
  assert.match(steps[3].run, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
  assert.match(steps[3].run,
    /test -z "\$\(git status --porcelain --untracked-files=normal\)"/u);
  assert.deepEqual(steps[4].with, { "node-version": "22.23.2", cache: "" });
  assert.deepEqual(steps[5].with,
    { pattern: "scanner-build-*", path: "${{ runner.temp }}/scanner-builds" });
  assert.doesNotMatch(JSON.stringify(steps[5]), /run-id|repository|github-token|merge-multiple/u);
});

test("audit entrypoint owns candidate reading and scanner execution with one execute call", () => {
  const steps = workflow.jobs.audit.steps;
  const audit = steps[6];
  assert.equal(audit.id, "scan_candidate");
  assert.equal(audit["timeout-minutes"], 270);
  assert.equal(audit["continue-on-error"], true);
  assert.deepEqual(audit.env,
    { GH_TOKEN: "${{ github.token }}", GITHUB_TOKEN: "${{ github.token }}" });
  assert.equal(audit.run, "node scripts/postgres-image/candidate-remote-audit.mjs execute");
  const serialized = JSON.stringify(workflow);
  assert.equal([...serialized.matchAll(/candidate-remote-audit\.mjs execute/gu)].length, 1);
  assert.doesNotMatch(serialized,
    /candidate-(?:publish|runtime)|package-bootstrap|docker\s+(?:login|push|run|create|start|exec)|buildx\s+build|gh\s+workflow\s+run|scan\.mjs|\.tar|private-archive|source\.zip|source-zips/iu);
});

test("public audit upload requires successful owned cleanup and artifact validation", () => {
  const steps = workflow.jobs.audit.steps;
  const cleanup = steps[7];
  assert.equal(cleanup.id, "cleanup");
  assert.equal(cleanup.if, "${{ always() }}");
  assert.equal(cleanup["timeout-minutes"], 5);
  assert.equal(cleanup["continue-on-error"], true);
  assert.equal(cleanup.env, undefined);
  assert.equal(cleanup.run, "node scripts/postgres-image/candidate-remote-audit.mjs cleanup");
  assert.equal([...JSON.stringify(workflow).matchAll(/candidate-remote-audit\.mjs cleanup/gu)].length, 1);
  assert.equal(steps[8].if, "${{ always() && steps.cleanup.outcome == 'success' }}");
  assert.deepEqual(steps[8].with, {
    name: "postgres-candidate-remote-audit",
    path: "${{ runner.temp }}/postgres-candidate-remote-audit-evidence",
    "if-no-files-found": "warn", "retention-days": 14, "compression-level": 0,
  });
});

test("a failed audit or cleanup fails the workflow after bounded evidence retention", () => {
  const enforce = workflow.jobs.audit.steps[9];
  assert.equal(enforce.name, "Enforce audit and cleanup outcomes");
  assert.equal(enforce.if,
    "${{ steps.scan_candidate.outcome != 'success' || steps.cleanup.outcome != 'success' }}");
  assert.equal(enforce.run, "exit 1");
  assert.equal(enforce["continue-on-error"], undefined);
});
