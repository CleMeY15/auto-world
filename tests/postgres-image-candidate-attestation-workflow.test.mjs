import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { access as fsAccess, readFile } from "node:fs/promises";
import test from "node:test";
import { ATTESTATION, SIGNER_JOB_BUDGET_MS } from "../scripts/postgres-image/candidate-attestation.mjs";

const workflow = JSON.parse(readFileSync(new URL("../docs/validation/postgres-attestation/workflow.json", import.meta.url)));
const { access, signer, verifier } = workflow.jobs;
const action = (job, name) => job.steps.find(step => step.uses?.startsWith(`actions/${name}@`));
const named = (job, name) => job.steps.find(step => step.name === name);
const guard = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}";

test("successful one-shot producer is retired while its exact recipe and run remain inspectable", async () => {
  await assert.rejects(fsAccess(new URL("../.github/workflows/postgres-candidate-attest-v2.yml", import.meta.url)),
    { code: "ENOENT" });
  const run = JSON.parse(await readFile(new URL("../docs/validation/postgres-attestation/run.json", import.meta.url)));
  const disabled = JSON.parse(await readFile(
    new URL("../docs/validation/postgres-attestation/workflow-disabled.json", import.meta.url)));
  assert.deepEqual({ id: run.id, workflowId: run.workflow_id, number: run.run_number,
    attempt: run.run_attempt, event: run.event, branch: run.head_branch, revision: run.head_sha,
    path: run.path, status: run.status, conclusion: run.conclusion }, {
    id: 36858133579, workflowId: 372103738, number: 1, attempt: 1,
    event: "workflow_dispatch", branch: "main",
    revision: "64778982b86faf17cb4ede9fd8027869049f6602",
    path: ATTESTATION.workflowPath, status: "completed", conclusion: "success",
  });
  assert.equal(disabled.id, 372103738);
  assert.equal(disabled.path, ATTESTATION.workflowPath);
  assert.equal(disabled.state, "disabled_manually");
});

test("one input-free main dispatch separates registry access, signer and verifier capabilities", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ["access", "signer", "verifier"]);
  assert.deepEqual(access.permissions, { contents: "read", packages: "read" });
  assert.deepEqual(signer.permissions, { contents: "read", actions: "read", "id-token": "write", attestations: "write" });
  assert.deepEqual(verifier.permissions, { contents: "read", actions: "read", packages: "read" });
  assert.equal(signer.needs, "access"); assert.equal(verifier.needs, "signer");
  assert.equal(signer["timeout-minutes"] * 60 * 1000, SIGNER_JOB_BUDGET_MS);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  for (const job of [access, signer, verifier]) {
    assert.equal(job.if, guard); assert.equal(job["runs-on"], "ubuntu-24.04");
    assert.equal(action(job, "checkout").with["persist-credentials"], false);
    assert.equal(action(job, "setup-node").with["node-version"], "22.23.2");
    assert.ok(job.steps[0].run.includes(ATTESTATION.workflowPath));
    assert.ok(job.steps[0].run.includes('test "$GITHUB_RUN_ATTEMPT" = \'1\''));
    for (const step of job.steps.filter(step => step.uses)) assert.match(step.uses, /^actions\/[\w-]+@[0-9a-f]{40}$/u);
  }
  assert.doesNotMatch(JSON.stringify(workflow), /continue-on-error|secrets\.|pull_request|schedule|workflow_call|attestation-canary/u);
});

test("access uploads only the closed public manifest-access receipt", () => {
  const collect = named(access, "Verify authenticated and anonymous manifest reads");
  assert.equal(collect.run, "node scripts/postgres-image/candidate-attestation-access.mjs execute");
  const upload = action(access, "upload-artifact");
  assert.equal(upload.id, "access-evidence");
  assert.equal(upload.with.name, "postgres-candidate-attestation-access");
  assert.equal(upload.with.path, "${{ runner.temp }}/postgres-candidate-attestation-access/access-receipt.json");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.doesNotMatch(JSON.stringify(access), /id-token|attestations|packages.*write|candidate-publish|candidate\.tar/u);
});

test("signer authenticates API ZIP inputs and current P1/P2/P3 before the fixed official action", () => {
  const input = named(signer, "Authenticate and download this run access evidence");
  assert.equal(input.env.POSTGRES_ATTESTATION_ACCESS_ARTIFACT_ID, "${{ needs.access.outputs.artifact-id }}");
  assert.equal(input.run, "node scripts/postgres-image/attestation-artifact-input.mjs access");
  const audit = named(signer, "Authenticate and download the reviewed audit evidence");
  assert.equal(audit.run, "node scripts/postgres-image/attestation-artifact-input.mjs audit");
  const prepare = named(signer, "Validate current evidence and prepare the closed predicate");
  const attest = signer.steps.find(step => step.id === "attest");
  for (const step of [input, audit]) assert.ok(signer.steps.indexOf(step) < signer.steps.indexOf(prepare));
  assert.ok(signer.steps.indexOf(prepare) < signer.steps.indexOf(attest));
  assert.equal(prepare.run, "node scripts/postgres-image/candidate-attestation.mjs prepare");
  assert.equal(attest.uses, "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6");
  assert.deepEqual(attest.with, {
    "subject-name": ATTESTATION.subjectName, "subject-digest": ATTESTATION.subjectDigest,
    "predicate-type": ATTESTATION.predicateType,
    "predicate-path": "${{ runner.temp }}/postgres-candidate-attestation/predicate.json",
    "push-to-registry": false, "create-storage-record": false,
  });
  assert.doesNotMatch(JSON.stringify(signer), /DOCKER_CONFIG|packages|docker\s|buildx|candidate-publish/u);
});

test("verifier downloads only this run signed artifact and uses the authenticated official CLI", () => {
  const intake = named(verifier, "Authenticate and download this run signed evidence");
  assert.equal(intake.env.POSTGRES_ATTESTATION_SIGNED_ARTIFACT_ID, "${{ needs.signer.outputs.artifact-id }}");
  assert.equal(intake.run, "node scripts/postgres-image/attestation-artifact-input.mjs signed");
  const setup = named(verifier, "Install the official pinned verification CLI").run;
  assert.match(setup, /gh_2\.98\.0_linux_amd64\.tar\.gz/u);
  assert.match(setup, /14863663/u);
  assert.match(setup, /3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de/u);
  assert.match(setup, /sha256sum --check --status/u);
  assert.equal(named(verifier, "Remove isolated registry credentials").if, "${{ always() }}");
  assert.doesNotMatch(JSON.stringify(verifier), /id-token|attestations|docker\s+(?:run|pull|login|push)|buildx/u);
});

test("finite public evidence contains only approved files and preserves private source/archive exclusion", () => {
  const signed = action(signer, "upload-artifact");
  assert.equal(signed.with.name, "postgres-candidate-attestation-signed");
  assert.deepEqual(signed.with.path.split("\n").map(item => item.split("/").at(-1)),
    ["predicate.json", "pre-sign-receipt.json", "bundle.json"]);
  for (const job of [access, signer, verifier]) {
    for (const step of job.steps.filter(step => step.uses?.startsWith("actions/upload-artifact@"))) {
      assert.equal(step.with["retention-days"], 14); assert.equal(step.with["compression-level"], 6);
      assert.doesNotMatch(step.with.path, /\*|private-archive|candidate\.tar|config\.json|audit-input/u);
    }
  }
});

test("the complete package-read inventory contains only reviewed manual main jobs", () => {
  const expected = [
    ["postgres-candidate-remote-audit.yml", "audit", 1], ["postgres-candidate-remote-read-v2.yml", "read", 1],
    ["postgres-candidate-remote-read.yml", "read", 1], ["postgres-candidate-remote-runtime-diagnostic-v2.yml", "runtime", 1],
    ["postgres-package-bootstrap.yml", "verify", 2], ["private-package-proof.yml", "verify", null],
    ["seaweed-candidate-remote-audit.yml", "audit", 1], ["seaweed-candidate-remote-runtime.yml", "runtime", 3],
    ["seaweed-package-bootstrap.yml", "verify", 2],
  ];
  const found = [];
  const documentation = readFileSync(new URL("../docs/validation/TASK-0005A-POSTGRES-ATTESTATION.md", import.meta.url), "utf8");
  const directory = new URL("../.github/workflows/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => /\.ya?ml$/u.test(name))) {
    const source = readFileSync(new URL(file, directory), "utf8");
    if (!/\bpackages["']?\s*:\s*["']?read/u.test(source)) continue;
    const definition = JSON.parse(source);
    assert.notEqual(definition.permissions?.packages, "read", "package read must be granted per job");
    assert.deepEqual(definition.on, { workflow_dispatch: {} });
    for (const [jobName, job] of Object.entries(definition.jobs)) {
      if (job.permissions?.packages !== "read") continue;
      found.push(`${file}#${jobName}`);
      const record = expected.find(([path, name]) => path === file && name === jobName);
      assert.ok(record, `unreviewed package-read job ${file}#${jobName}`);
      assert.ok(documentation.includes(`| \`${file}\` | ${jobName} |`));
      assert.ok(job.if.includes("github.repository == 'CleMeY15/auto-world'"));
      assert.ok(job.if.includes("github.event_name == 'workflow_dispatch'"));
      assert.ok(job.if.includes("github.ref == 'refs/heads/main'"));
      if (record[2] !== null) {
        assert.ok(job.if.includes(`github.run_number == ${record[2]}`));
        assert.ok(job.if.includes("github.run_attempt == 1"));
      }
      const checkout = action(job, "checkout");
      assert.ok(checkout); assert.equal(checkout.with["persist-credentials"], false);
      assert.equal(checkout.with.ref, undefined);
      assert.equal(job.permissions["id-token"], undefined);
      assert.equal(job.permissions.attestations, undefined);
    }
  }
  assert.deepEqual(found.sort(), expected.map(([file, name]) => `${file}#${name}`).sort());
});
