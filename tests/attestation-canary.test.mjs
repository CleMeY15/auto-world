import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { branchRef, classifyResult, mainRef, negativeProved, verificationArgs, verifyPair } from "../scripts/verify-attestation-canary.mjs";

const mainSha = "a".repeat(40);
const branchSha = "b".repeat(40);
const fixturePath = "docs/fixtures/attestation-canary.txt";
const workflowPath = ".github/workflows/attestation-canary.yml";
const validEntry = {
  attestation: { bundle: { testOnly: true } },
  verificationResult: { signature: { certificate: { testOnly: true } }, statement: { testOnly: true } },
};
const success = () => ({ code: 0, processError: false, stdout: JSON.stringify([validEntry]), stderr: "", durationMs: 0 });
const rejected = (source = false) => ({
  code: 1, processError: false, stdout: "", durationMs: 0,
  stderr: source
    ? `Policy verification failed\nError: expected BuildSignerDigest to be ${mainSha}, got ${branchSha}`
    : 'Sigstore verification failed\nError: verifying with issuer "sigstore.dev"',
});

async function inputs(t) {
  const directory = await mkdtemp(join(tmpdir(), "aw-attestation-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "canary.txt");
  const bundle = join(directory, "bundle.json");
  await writeFile(file, "public test only\n");
  await writeFile(bundle, JSON.stringify({ mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json" }));
  return { file, bundle, sha: mainSha, ref: mainRef };
}

test("manual canary has exactly one bounded job and no extra capability", async () => {
  // JSON is a YAML subset, allowing the real workflow to be checked with the
  // built-in parser rather than a new dependency or an ad-hoc YAML parser.
  const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
  assert.deepEqual(Object.keys(workflow).sort(), ["concurrency", "jobs", "name", "on", "permissions"]);
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ["canary"]);
  const job = workflow.jobs.canary;
  assert.deepEqual(Object.keys(job).sort(), ["defaults", "if", "permissions", "runs-on", "steps", "timeout-minutes"]);
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 10);
  assert.deepEqual(job.permissions, { contents: "read", "id-token": "write", attestations: "write" });
  assert.equal(job.if, `github.repository == 'CleMeY15/auto-world' && github.run_attempt == 1 && (github.ref == '${mainRef}' || github.ref == '${branchRef}')`);
  assert.equal(job.steps.length, 5);
  assert.deepEqual(job.steps.map((step) => Object.keys(step).sort()), [
    ["name", "uses", "with"], ["name", "run"], ["name", "run"],
    ["id", "name", "uses", "with"], ["name", "uses", "with"],
  ]);
  assert.deepEqual(job.steps.filter((step) => step.uses).map((step) => step.uses), [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
    "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  ]);
  assert.equal(job.steps[0].with["persist-credentials"], false);
  assert.deepEqual(Object.keys(job.steps[0].with).sort(), ["fetch-depth", "persist-credentials", "sparse-checkout", "sparse-checkout-cone-mode"]);
  assert.deepEqual(job.steps[3].with, { "subject-path": fixturePath, "push-to-registry": false, "create-storage-record": false });
  assert.equal(job.steps[3].id, "attest");
  assert.equal(job.steps[4].with.name, "attestation-canary-${{ github.run_id }}-${{ github.run_attempt }}");
  assert.equal(job.steps[4].with["if-no-files-found"], "error");
  assert.deepEqual(job.steps[4].with.path.split("\n"), [
    "${{ steps.attest.outputs.bundle-path }}", fixturePath,
    ...["gh-version", "gh-help", "gh-sha256", "input-sha256", "run"].map((part) => "${{ runner.temp }}/canary-" + part + ".txt"),
  ]);
  assert.doesNotMatch(JSON.stringify(workflow), /pull_request_target|workflow_run|repository_dispatch|packages|artifact-metadata|secrets\.|docker|npm |curl |wget |node /u);
  const fixture = await readFile(fixturePath);
  assert.equal(createHash("sha256").update(fixture).digest("hex"), "d8bacf5b23f03435e17bde784994c671270c6bc8b610aabe7883e304c8346663");
  assert.ok(job.steps[1].run.includes("d8bacf5b23f03435e17bde784994c671270c6bc8b610aabe7883e304c8346663"));
  for (const flag of ["cert-identity", "cert-oidc-issuer", "source-ref", "source-digest", "signer-digest", "signer-workflow", "deny-self-hosted-runners", "predicate-type", "bundle", "format"]) {
    assert.ok(job.steps[2].run.includes(flag));
  }
});

test("both official invocations keep every common binding without mutually exclusive flags", () => {
  for (const ref of [mainRef, branchRef]) {
    const base = { file: "public.txt", bundle: "unique.json", sha: mainSha, ref };
    for (const mode of ["identity", "workflow"]) {
      const args = verificationArgs({ ...base, mode });
      assert.deepEqual(args.slice(0, 2), ["attestation", "verify"]);
      assert.deepEqual(args.filter((arg) => arg.startsWith("--")), [
        "--repo", "--hostname", mode === "identity" ? "--cert-identity" : "--signer-workflow",
        "--cert-oidc-issuer", "--source-ref", "--source-digest", "--signer-digest",
        "--deny-self-hosted-runners", "--predicate-type", "--bundle", "--format",
      ]);
      for (const [flag, expected] of [["--repo", "CleMeY15/auto-world"], ["--hostname", "github.com"],
        ["--source-ref", ref], ["--source-digest", mainSha], ["--signer-digest", mainSha],
        ["--cert-oidc-issuer", "https://token.actions.githubusercontent.com"],
        ["--predicate-type", "https://slsa.dev/provenance/v1"], ["--format", "json"]]) {
        assert.equal(args[args.indexOf(flag) + 1], expected);
      }
      assert.ok(args.includes(mode === "identity"
        ? `https://github.com/CleMeY15/auto-world/.github/workflows/attestation-canary.yml@${ref}`
        : "CleMeY15/auto-world/.github/workflows/attestation-canary.yml"));
    }
  }
  assert.throws(() => verificationArgs({ sha: "main", ref: mainRef, mode: "identity" }), /canary_policy_invalid/u);
  assert.throws(() => verificationArgs({ sha: mainSha, ref: "refs/heads/other", mode: "identity" }), /canary_policy_invalid/u);
});

test("unexpected CLI, transport, malformed or ambiguous results are errors, never verified negatives", () => {
  for (const result of [
    { ...success(), processError: true }, { ...success(), code: null },
    { ...success(), stdout: "not JSON" }, { ...success(), stdout: "[]" },
    { ...success(), stdout: JSON.stringify([validEntry, validEntry]) },
    { ...success(), stdout: '[{"attestation":{}}]' },
    { ...rejected(), stderr: "unknown flag: --source-digest" },
    { ...rejected(), stderr: rejected().stderr + "\nHTTP 503 connection timeout" },
    { ...rejected(), stderr: rejected().stderr + "\nconnection reset by peer" },
    { ...rejected(), stderr: "no such file or directory" },
    { ...rejected(), stderr: "unexpected end of JSON input" },
    { ...rejected(), code: 2 },
  ]) assert.equal(classifyResult(result).status, "ERROR");
});

test("positive requires the same unique attestation from both successful official checks", async (t) => {
  const options = await inputs(t);
  const calls = [];
  const result = await verifyPair(options, async (args) => { calls.push(args); return success(); });
  assert.equal(result.status, "VERIFIED");
  assert.equal(calls.length, 2);
  assert.equal(calls[0][calls[0].indexOf("--bundle") + 1], calls[1][calls[1].indexOf("--bundle") + 1]);
  let call = 0;
  await assert.rejects(verifyPair(options, async () => (++call === 1 ? success() : {
    ...success(), stdout: JSON.stringify([{ ...validEntry, attestation: { different: true } }]),
  })), /canary_verification_disagrees/u);
});

test("bundle collection, missing/truncated input and substitution fail closed", async (t) => {
  const options = await inputs(t);
  let calls = 0;
  const execute = async () => { calls++; return success(); };
  const original = await readFile(options.bundle);
  await writeFile(options.bundle, `[${original.toString()}]`);
  await assert.rejects(verifyPair(options, execute), /canary_bundle_ambiguous/u);
  await writeFile(options.bundle, `${original.toString()}\n${original.toString()}`);
  await assert.rejects(verifyPair(options, execute), SyntaxError);
  await writeFile(options.bundle, "{");
  await assert.rejects(verifyPair(options, execute), SyntaxError);
  await assert.rejects(verifyPair({ ...options, bundle: join(options.bundle, "missing") }, execute));
  assert.equal(calls, 0);
  await writeFile(options.bundle, original);
  await assert.rejects(verifyPair(options, async () => {
    await writeFile(options.bundle, `${original.toString()} `);
    return success();
  }), /canary_input_changed/u);
});

test("real-negative classification requires a valid own-identity control and the intended perturbation", async (t) => {
  const options = await inputs(t);
  const control = await verifyPair(options, async () => success());
  const branchBundle = options.bundle + ".branch";
  await writeFile(branchBundle, JSON.stringify({ mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json", testRun: "branch" }));
  const branchOptions = { ...options, bundle: branchBundle, sha: branchSha, ref: branchRef };
  const branchControl = await verifyPair(branchOptions, async () => success());
  let count = 0;
  const branchRejected = await verifyPair({ ...branchOptions, sha: mainSha, ref: mainRef }, async () => rejected(++count === 2));
  assert.equal(negativeProved("branch", branchControl, branchRejected, control), true);
  assert.equal(negativeProved("branch", control, branchRejected, control), false);
  assert.equal(negativeProved("branch", { ...branchControl, status: "ERROR" }, branchRejected, control), false);
  assert.equal(negativeProved("branch", branchControl, { ...branchRejected, bundleSha256: "other" }, control), false);
  assert.equal(negativeProved("branch", branchControl, { ...branchRejected, invocations: [] }, control), false);
  const arbitraryCommit = { ...branchRejected, policy: { ...branchRejected.policy, sha: "c".repeat(40) } };
  assert.equal(negativeProved("branch", branchControl, arbitraryCommit, control), false);
  for (const invalidMain of [
    undefined, { ...control, status: "ERROR" },
    { ...control, policy: { ...control.policy, ref: branchRef } },
    { ...control, policy: { ...control.policy, wrongIdentity: true } },
    { ...control, invocations: [] }, { ...control, invocations: [control.invocations[0]] },
    { ...control, invocations: [{ status: "ERROR" }, control.invocations[1]] },
    { ...control, fileSha256: "another-file" }, { ...control, bundleSha256: branchControl.bundleSha256 },
  ]) assert.equal(negativeProved("branch", branchControl, branchRejected, invalidMain), false);
  const wrong = await verifyPair({ ...options, wrongIdentity: true }, async () => rejected());
  assert.equal(negativeProved("wrong-workflow", control, wrong, control), true);
  assert.equal(negativeProved("wrong-workflow", control, branchRejected, control), false);
  await writeFile(options.file, "changed public bytes\n");
  const tamper = await verifyPair(options, async () => rejected());
  assert.equal(negativeProved("tamper", control, tamper, control), true);
  assert.equal(negativeProved("wrong-workflow", control, tamper, control), false);
  assert.equal(negativeProved("tamper", control, { ...tamper, status: "ERROR" }, control), false);
});
