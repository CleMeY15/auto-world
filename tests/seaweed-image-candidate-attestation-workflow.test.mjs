import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SIGNER_JOB_BUDGET_MS } from "../scripts/seaweed-image/candidate-attestation.mjs";

const workflow = JSON.parse(await readFile(
  new URL("../.github/workflows/seaweed-candidate-attest.yml", import.meta.url), "utf8"));
const { signer, verifier } = workflow.jobs;
const actions = (job) => job.steps.filter((step) => step.uses);
const stepNamed = (job, name) => job.steps.find((step) => step.name === name);
const guard = "${{ github.repository == 'CleMeY15/auto-world' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && github.run_number == 1 && github.run_attempt == 1 }}";

test("signing is input-free, first-attempt protected-main only with separate verifier authority", () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ["signer", "verifier"]);
  assert.deepEqual(signer.permissions, { contents: "read", actions: "read",
    "id-token": "write", attestations: "write" });
  assert.deepEqual(verifier.permissions, { contents: "read", actions: "read", packages: "read" });
  assert.equal(verifier.needs, "signer");
  assert.equal(signer["timeout-minutes"] * 60 * 1000, SIGNER_JOB_BUDGET_MS);
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  for (const job of [signer, verifier]) {
    assert.equal(job.if, guard);
    assert.equal(job["runs-on"], "ubuntu-24.04");
    assert.equal(job["timeout-minutes"], 20);
    const first = job.steps[0].run;
    for (const [name, value] of [
      ["GITHUB_REPOSITORY", "CleMeY15/auto-world"], ["RUNNER_ENVIRONMENT", "github-hosted"],
      ["GITHUB_REF", "refs/heads/main"], ["GITHUB_EVENT_NAME", "workflow_dispatch"],
      ["GITHUB_RUN_NUMBER", "1"], ["GITHUB_RUN_ATTEMPT", "1"],
      ["GITHUB_WORKFLOW_REF", "CleMeY15/auto-world/.github/workflows/seaweed-candidate-attest.yml@refs/heads/main"],
    ]) assert.ok(first.includes('test "$' + name + '" = \'' + value + "'"));
    for (const action of actions(job)) assert.match(action.uses, /^actions\/[\w-]+@[a-f0-9]{40}$/u);
    assert.equal(actions(job).find((step) => step.uses.startsWith("actions/checkout@")).with["persist-credentials"], false);
  }
});

test("signer validates the pinned prior audit before official exact-subject signing", () => {
  const download = actions(signer).find((step) => step.uses.startsWith("actions/download-artifact@"));
  assert.equal(download.with["run-id"], "36325906357");
  assert.equal(download.with.name, "seaweed-candidate-remote-audit");
  assert.equal(download.with.repository, "CleMeY15/auto-world");
  const prepare = stepNamed(signer, "Validate current evidence and prepare the closed predicate");
  const attest = signer.steps.find((step) => step.id === "attest");
  assert.ok(signer.steps.indexOf(download) < signer.steps.indexOf(prepare));
  assert.ok(signer.steps.indexOf(prepare) < signer.steps.indexOf(attest));
  assert.equal(prepare.run, "node scripts/seaweed-image/candidate-attestation.mjs prepare");
  assert.equal(attest.uses, "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6");
  assert.deepEqual(attest.with, {
    "subject-name": "ghcr.io/clemey15/auto-world-seaweedfs-s3",
    "subject-digest": "sha256:9739d848712cf40f158a9d44586b6166a0d51839eaeceebbadcad27980b1f504",
    "predicate-type": "https://github.com/CleMeY15/auto-world/attestations/private-image-evidence/v1",
    "predicate-path": "${{ runner.temp }}/seaweed-candidate-attestation/predicate.json",
    "push-to-registry": false, "create-storage-record": false,
  });
  assert.doesNotMatch(JSON.stringify(signer), /DOCKER_CONFIG|packages|docker\s|buildx|candidate-publish/iu);
});

test("verifier uses a fixed official CLI and only this run's signed evidence", () => {
  const setup = stepNamed(verifier, "Install the official pinned verification CLI").run;
  assert.match(setup, /gh_2\.98\.0_linux_amd64\.tar\.gz/u);
  assert.match(setup, /14863663/u);
  assert.match(setup, /3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de/u);
  assert.match(setup, /sha256sum --check --status/u);
  const input = actions(verifier).find((step) => step.uses.startsWith("actions/download-artifact@"));
  assert.equal(input.with["artifact-ids"], "${{ needs.signer.outputs.artifact-id }}");
  assert.equal(input.with["run-id"], undefined);
  const auth = stepNamed(verifier, "Prepare isolated read-only registry authentication");
  const verify = stepNamed(verifier, "Verify official policies and actual rejection controls");
  const cleanup = stepNamed(verifier, "Remove isolated registry credentials");
  assert.ok(verifier.steps.indexOf(auth) < verifier.steps.indexOf(verify));
  assert.ok(verifier.steps.indexOf(verify) < verifier.steps.indexOf(cleanup));
  assert.equal(cleanup.if, "${{ always() }}");
  assert.match(auth.run, /mode: 0o700/u);
  assert.match(auth.run, /mode:0o600/u);
  assert.match(cleanup.run, /isSymbolicLink/u);
  assert.match(cleanup.run, /item\.nlink !== 1/u);
  assert.doesNotMatch(cleanup.run, /recursive|rm -r/u);
  assert.doesNotMatch(JSON.stringify(verifier), /id-token|attestations|docker\s+(?:run|pull|login|push)|buildx/iu);
});

test("public artifacts are an explicit three-file bundle and bounded verification receipt", () => {
  const upload = actions(signer).find((step) => step.id === "evidence");
  assert.equal(upload.if, "${{ always() }}");
  assert.equal(upload.with["if-no-files-found"], "warn");
  assert.equal(stepNamed(signer, "Preserve the bounded official bundle").if,
    "${{ always() && steps.attest.outputs.bundle-path != '' }}");
  assert.deepEqual(upload.with.path.split("\n").map((entry) => entry.split("/").at(-1)),
    ["predicate.json", "pre-sign-receipt.json", "bundle.json"]);
  const verifyUpload = actions(verifier).find((step) => step.uses.startsWith("actions/upload-artifact@"));
  assert.match(verifyUpload.with.path, /\/seaweed-candidate-attestation-verification\/verification-receipt\.json$/u);
  for (const job of [signer, verifier]) {
    for (const step of actions(job).filter((entry) => entry.uses.startsWith("actions/upload-artifact@"))) {
      assert.equal(step.with["retention-days"], 14);
      assert.doesNotMatch(step.with.path, /\*|private-archive|candidate\.tar|config\.json|audit-input/u);
    }
  }
  assert.doesNotMatch(JSON.stringify(workflow), /continue-on-error|attestation-canary|secrets\.|workflow_call|pull_request|schedule/iu);
});
