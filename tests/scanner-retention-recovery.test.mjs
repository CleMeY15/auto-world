import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SCANNER_RETENTION as P, sha256, validateScannerRetentionPublisherReceiptBytes }
  from "../scripts/scanner/retention-policy.mjs";
import { validateScannerRetentionRecoveryApis, validateScannerRetentionFailedPublisherReceipt,
  verifyScannerRetentionPublisherRecovery } from "../scripts/scanner/retention-recovery.mjs";

const original = JSON.parse(readFileSync(new URL("./fixtures/scanner-retention/recovery-original.json", import.meta.url)));
const context = { runId: "43999999999", headSha: "a".repeat(40), token: "fixture-only-token" };
const now = () => Date.parse("2026-11-17T12:00:00Z");
const base = `https://api.github.com/repos/${P.repository}`;
const zip = Buffer.from(original.zipBase64, "base64");
const receipt = Buffer.from(original.receipt);

function fixture() {
  const { previous, jobs, artifact, artifacts, commit } = globalThis.structuredClone(original);
  const current = { ...previous, id: Number(context.runId), head_sha: context.headSha,
    run_number: 2, status: "in_progress", conclusion: null };
  return { previous, current, jobs, artifact, artifacts, commit,
    workflow: { id: P.publisher.recovery.workflowId, path: P.publisher.workflow, state: "active" },
    history: { total_count: 2, workflow_runs: [current, previous] } };
}

function dependencies(data = fixture(), { body = zip, response = null } = {}) {
  let downloads = 0; const endpoints = [];
  const fetchImpl = async (url, options) => {
    endpoints.push(url);
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Bearer ${context.token}`);
    assert.ok(options.signal instanceof globalThis.AbortSignal);
    if (response) return response();
    let value;
    if (url.endsWith(`/actions/workflows/${P.publisher.recovery.workflowId}`)) value = data.workflow;
    else if (url.endsWith("/runs?per_page=100&page=1")) value = data.history;
    else if (url.endsWith(`/actions/runs/${P.publisher.recovery.predecessor.runId}`)) value = data.previous;
    else if (url.endsWith(`/actions/runs/${context.runId}`)) value = data.current;
    else if (url.endsWith("/attempts/1/jobs?per_page=100&page=1")) value = data.jobs;
    else if (url.endsWith(`/actions/artifacts/${P.publisher.recovery.predecessor.artifactId}`)) value = data.artifact;
    else if (url.endsWith("/artifacts?per_page=100&page=1")) value = data.artifacts;
    else if (url.endsWith(`/git/commits/${P.publisher.recovery.predecessor.headSha}`)) value = data.commit;
    else assert.fail(`Unexpected endpoint ${url}`);
    assert.ok(url.startsWith(`${base}/`));
    return new globalThis.Response(JSON.stringify(value));
  };
  const download = async ({ artifact, handle, timeoutMs, env }) => {
    downloads++;
    assert.deepEqual(artifact, { id: 14286078082, size: 923,
      digest: "sha256:bad3839ebf36ebac5d1a085bcfa241cf966c83d8c51b6ebb9821d5f36592c1b9" });
    assert.equal(env.GH_TOKEN, context.token); assert.ok(timeoutMs <= 60000);
    await handle.write(body, 0, body.length, 0);
  };
  return { endpoints, downloads: () => downloads, execute: (overrides = {}) => verifyScannerRetentionPublisherRecovery({
    context, env: { PATH: "/usr/bin:/bin" }, now, deadline: now() + 60000, fetchImpl, download, ...overrides,
  }) };
}

test("authentic failed publisher ZIP and receipt remain failed and never qualify as publication", async () => {
  const old = P.publisher.recovery.predecessor;
  assert.equal(zip.length, old.artifactBytes); assert.equal(`sha256:${sha256(zip)}`, old.artifactDigest);
  assert.equal(receipt.length, old.receiptBytes); assert.equal(sha256(receipt), old.receiptSha256);
  assert.equal(validateScannerRetentionFailedPublisherReceipt(receipt).cleanup, "UNKNOWN");
  assert.throws(() => validateScannerRetentionPublisherReceiptBytes(receipt,
    { runId: old.runId, headSha: old.headSha, headTree: old.headTree }), /publication_identity_invalid/u);
  const deps = dependencies();
  assert.deepEqual(await deps.execute(), { runId: old.runId, result: "FAILED", cleanup: "UNKNOWN",
    receiptSha256: old.receiptSha256 });
  assert.equal(deps.downloads(), 1); assert.equal(new Set(deps.endpoints).size, 8);
});

test("history refuses reused, extra, missing, recreated, branch and foreign publisher runs", () => {
  const mutations = [
    (d) => { d.history.total_count = 3; },
    (d) => { d.history.workflow_runs.push(globalThis.structuredClone(d.current)); },
    (d) => { d.history.workflow_runs.pop(); },
    (d) => { d.history.workflow_runs[1] = globalThis.structuredClone(d.current); },
    (d) => { d.workflow.id++; }, (d) => { d.workflow.state = "disabled_manually"; },
    (d) => { d.workflow.path = ".github/workflows/other.yml"; },
    (d) => { d.previous.run_attempt = 2; }, (d) => { d.previous.conclusion = "success"; },
    (d) => { d.previous.head_sha = context.headSha; }, (d) => { d.previous.id++; },
    (d) => { d.current.id++; }, (d) => { d.current.run_number = 1; },
    (d) => { d.current.run_number = 3; }, (d) => { d.current.run_attempt = 2; },
    (d) => { d.current.head_branch = "branch"; }, (d) => { d.current.event = "push"; },
    (d) => { d.current.workflow_id++; }, (d) => { d.current.status = "completed"; },
    (d) => { d.current.head_repository.full_name = "foreign/repository"; },
    (d) => { d.commit.tree.sha = context.headSha; },
  ];
  validateScannerRetentionRecoveryApis(fixture(), context, now);
  for (const mutate of mutations) {
    const data = fixture(); mutate(data);
    assert.throws(() => validateScannerRetentionRecoveryApis(data, context, now), /recovery_history_invalid/u);
  }
  assert.throws(() => validateScannerRetentionRecoveryApis(fixture(),
    { ...context, runId: P.publisher.recovery.predecessor.runId }, now), /context_invalid/u);
});

test("job and artifact identity mutations refuse before any artifact download", async () => {
  const mutations = [
    (d) => { d.jobs.total_count = 2; }, (d) => { d.jobs.jobs[0].id++; },
    (d) => { d.jobs.jobs[0].run_attempt = 2; }, (d) => { d.jobs.jobs[0].head_sha = context.headSha; },
    (d) => { d.jobs.jobs[0].conclusion = "success"; }, (d) => { d.jobs.jobs[0].run_id++; },
    (d) => { d.artifact.id++; }, (d) => { d.artifact.digest = `sha256:${"1".repeat(64)}`; },
    (d) => { d.artifact.size_in_bytes++; }, (d) => { d.artifact.name = "other"; },
    (d) => { d.artifact.created_at = "invalid"; }, (d) => { d.artifact.expired = true; },
    (d) => { d.artifact.expires_at = "2027-01-01T00:00:00Z"; },
    (d) => { d.artifact.archive_download_url = "https://foreign.invalid/a.zip"; },
    (d) => { d.artifact.workflow_run.head_sha = context.headSha; },
    (d) => { d.artifacts.total_count = 2; }, (d) => { d.artifacts.artifacts = []; },
    (d) => { d.artifacts.artifacts[0].digest = "changed"; },
  ];
  for (const mutate of mutations) {
    const data = fixture(); mutate(data); const deps = dependencies(data);
    await assert.rejects(deps.execute(), /recovery_(?:job|artifact)_invalid/u);
    assert.equal(deps.downloads(), 0);
  }
  for (const time of [NaN, Date.parse(P.publisher.recovery.predecessor.expiresAt), 0]) {
    assert.throws(() => validateScannerRetentionRecoveryApis(fixture(), context, () => time), /artifact_invalid/u);
  }
});

test("recovery refuses altered, truncated and oversized ZIP or receipt bytes", async () => {
  const changed = Buffer.from(zip); changed[100] ^= 1;
  for (const body of [changed, zip.subarray(1), Buffer.concat([zip, Buffer.from("x")])]) {
    await assert.rejects(dependencies(fixture(), { body }).execute(), /recovery_zip_invalid/u);
  }
  for (const body of [receipt.subarray(1), Buffer.concat([receipt, Buffer.from("\n")]),
    Buffer.from(original.receipt.replace('"FAILED"', '"PASSED"'))]) {
    assert.throws(() => validateScannerRetentionFailedPublisherReceipt(body), /recovery_receipt_invalid/u);
  }
});

test("recovery APIs refuse redirects, failures, invalid JSON, cap overruns and elapsed deadlines", async () => {
  for (const response of [
    () => new globalThis.Response("{}", { status: 302 }), () => new globalThis.Response("{}", { status: 403 }),
    () => new globalThis.Response("not-json"), () => new globalThis.Response("{}", { headers: { "content-length": "1048577" } }),
    () => new globalThis.Response("x".repeat(1048577)),
    () => ({ status: 200, redirected: true }),
  ]) {
    const deps = dependencies(fixture(), { response });
    await assert.rejects(deps.execute(), /recovery_api_invalid/u);
    assert.equal(deps.downloads(), 0);
  }
  await assert.rejects(dependencies().execute({ deadline: now() }), /recovery_timeout/u);
});

test("recovery API deadline also bounds an unresponsive transport and cancels an unfinished body", async () => {
  await assert.rejects(dependencies().execute({ deadline: now() + 10,
    fetchImpl: () => new Promise(() => {}) }), /recovery_timeout/u);
  let cancelled = 0;
  await assert.rejects(dependencies().execute({ deadline: now() + 10,
    fetchImpl: async () => new globalThis.Response(new globalThis.ReadableStream({
      cancel() { cancelled++; },
    })),
  }), /recovery_timeout/u);
  assert.ok(cancelled > 0);
});
