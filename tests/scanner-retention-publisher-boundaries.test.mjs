import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SCANNER_RETENTION as P } from "../scripts/scanner/retention-policy.mjs";
import { TEST_ONLY_verifyScannerRetentionQualificationApi, validateScannerRetentionReadbackState }
  from "../scripts/scanner/retention-publish.mjs";
import { authenticateScannerRetentionPublisherArtifact } from "../scripts/scanner/retention-copy.mjs";
import { scannerRetentionLinuxCreateArguments } from "../scripts/scanner/retention-copy-linux.mjs";

const q = P.qualification;
const now = () => Date.parse("2026-11-16T12:00:00Z");
const base = `https://api.github.com/repos/${P.repository}`;
const requiredSteps = [
  "Check out source without persistent credentials", "Provision exact managed Node.js",
  "Run pure scanner and workflow regression tests", "Verify official scanner provenance before extraction",
  "Qualify tools, build and audit all five managed runtime roles",
  "Preserve public reports and provenance, including failures",
];

test("local tool policy binds the exact wrapper and native helper source bytes", () => {
  for (const tool of [P.local.wrapper, P.local.helper]) {
    const bytes = readFileSync(new URL(`../${tool.file}`, import.meta.url));
    assert.equal(tool.bytes, bytes.length);
    assert.equal(tool.sha256, createHash("sha256").update(bytes).digest("hex"));
  }
});

function qualification() {
  return {
    run: { id: q.runId, run_attempt: 1, path: q.workflow, event: "push", head_branch: "main", head_sha: q.headSha,
      repository: { full_name: P.repository }, status: "completed", conclusion: "success" },
    jobs: { total_count: 1, jobs: [{ id: q.jobId, name: "Audit builders, construct and audit managed subjects",
      run_id: q.runId, run_attempt: 1, head_sha: q.headSha, status: "completed", conclusion: "success",
      steps: requiredSteps.map((name) => ({ name, status: "completed", conclusion: "success" })) }] },
    commit: { sha: q.headSha, tree: { sha: q.headTree } },
    artifact: { id: q.artifact.id, name: q.artifact.name, expired: false, size_in_bytes: q.artifact.sizeInBytes,
      digest: q.artifact.digest, url: q.artifact.url, archive_download_url: q.artifact.archiveDownloadUrl,
      workflow_run: { id: q.runId, head_sha: q.headSha }, created_at: q.artifact.createdAt,
      updated_at: q.artifact.updatedAt, expires_at: q.artifact.expiresAt },
  };
}

function transport(data, runId, headSha, artifactId) {
  const routes = new Map([
    [`${base}/actions/runs/${runId}`, data.run],
    [`${base}/actions/runs/${runId}/attempts/1/jobs?per_page=100&page=1`, data.jobs],
    [`${base}/actions/artifacts/${artifactId}`, data.artifact],
    [`${base}/actions/runs/${runId}/artifacts?per_page=100&page=1`, { total_count: 1, artifacts: [data.artifact] }],
    [`${base}/git/commits/${headSha}`, data.commit],
  ]);
  return async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof globalThis.AbortSignal);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.ok(routes.has(url), `Unexpected endpoint: ${url}`);
    return globalThis.Response.json(routes.get(url));
  };
}

test("qualification API requires the exact unexpired artifact and successful material-producing steps", async () => {
  const execute = (data, clock = now) => TEST_ONLY_verifyScannerRetentionQualificationApi({ token: "test-token" },
    transport(data, q.runId, q.headSha, q.artifact.id), clock);
  assert.equal((await execute(qualification())).digest, q.artifact.digest);
  for (const mutate of [
    (d) => { delete d.artifact.expires_at; },
    (d) => { d.artifact.expires_at = "invalid"; },
    (d) => { d.artifact.expires_at = "2027-01-01T00:00:00Z"; },
    (d) => { d.artifact.created_at = "2026-11-16T00:00:00Z"; },
    (d) => { d.artifact.updated_at = null; },
    (d) => { d.jobs.jobs[0].steps[3].conclusion = "skipped"; },
    (d) => { d.jobs.jobs[0].steps.pop(); },
    (d) => { d.jobs.jobs[0].steps.push(d.jobs.jobs[0].steps[0]); },
    (d) => { d.jobs.jobs[0].run_id++; },
    (d) => { d.jobs.jobs[0].run_attempt = 2; },
    (d) => { d.jobs.jobs.push(d.jobs.jobs[0]); },
    (d) => { d.jobs.total_count = 2; },
    (d) => { d.jobs.jobs = null; },
  ]) {
    const data = qualification(); mutate(data);
    await assert.rejects(execute(data), /scanner_retention_publish_qualification_api_invalid/u);
  }
  for (const clock of [() => NaN, () => Date.parse(q.artifact.expiresAt)]) {
    await assert.rejects(execute(qualification(), clock), /qualification_api_invalid/u);
  }
});

test("publisher receipt intake rejects ambiguous expiry and future creation before copy", async () => {
  const binding = { runId: "123", runAttempt: 1, runNumber: 1, headSha: "a".repeat(40), headTree: "b".repeat(40),
    artifactId: 456, artifactName: `${P.publisher.artifactNamePrefix}123-1`, artifactDigest: `sha256:${"c".repeat(64)}`,
    artifactBytes: 100, receiptBytes: 100, receiptSha256: "d".repeat(64) };
  const fixture = () => ({
    run: { id: 123, run_attempt: 1, run_number: 1, path: P.publisher.workflow, event: "workflow_dispatch",
      head_branch: "main", head_sha: binding.headSha, repository: { full_name: P.repository },
      status: "completed", conclusion: "success" },
    jobs: { total_count: 1, jobs: [{ name: "Publish exact private scanner retention candidate",
      status: "completed", conclusion: "success" }] },
    commit: { sha: binding.headSha, tree: { sha: binding.headTree } },
    artifact: { id: binding.artifactId, name: binding.artifactName, digest: binding.artifactDigest,
      size_in_bytes: 100, expired: false, url: `${base}/actions/artifacts/456`,
      archive_download_url: `${base}/actions/artifacts/456/zip`, workflow_run: { id: 123, head_sha: binding.headSha },
      created_at: "2026-11-16T00:00:00Z", expires_at: "2026-11-23T00:00:00Z" },
  });
  const execute = (data, clock = now) => authenticateScannerRetentionPublisherArtifact(binding, "test-token",
    transport(data, 123, binding.headSha, 456), clock);
  assert.equal((await execute(fixture())).createdAt, "2026-11-16T00:00:00.000Z");
  for (const [field, value] of [["expires_at", undefined], ["expires_at", "invalid"],
    ["expires_at", "2026-11-16T12:00:00Z"], ["created_at", "invalid"],
    ["created_at", "2026-11-17T00:00:00Z"], ["created_at", null]]) {
    const data = fixture(); data.artifact[field] = value;
    await assert.rejects(execute(data), /scanner_retention_copy_publisher_api_invalid/u);
  }
  await assert.rejects(execute(fixture(), () => NaN), /publisher_api_invalid/u);
});

test("never-started proof comes from the exact pulled image and actual container inspection", () => {
  const expected = { subject: `${P.package}@sha256:${"a".repeat(64)}`, imageId: `sha256:${"b".repeat(64)}`,
    containerId: "c".repeat(64), containerName: "aw-scanner-retention-readback-123" };
  const image = { Id: expected.imageId, Os: "linux", Architecture: "amd64", RepoDigests: [expected.subject] };
  const container = { Id: expected.containerId, Name: `/${expected.containerName}`, Image: expected.imageId,
    Config: { Image: expected.subject }, State: { Status: "created", Running: false, Paused: false,
      Restarting: false, Dead: false, StartedAt: "0001-01-01T00:00:00Z", FinishedAt: "0001-01-01T00:00:00Z" } };
  assert.equal(validateScannerRetentionReadbackState(image, container, expected).stoppedNeverStarted, true);
  for (const mutate of [
    (i) => { i.Id = `sha256:${"d".repeat(64)}`; },
    (i) => { i.RepoDigests = []; },
    (_i, c) => { c.Id = "d".repeat(64); },
    (_i, c) => { c.Image = `sha256:${"d".repeat(64)}`; },
    (_i, c) => { c.Name = "/foreign"; },
    (_i, c) => { c.State.Running = true; },
    (_i, c) => { c.State.StartedAt = "2026-11-16T00:00:00Z"; },
    (_i, c) => { c.State.Status = "exited"; },
    (_i, c) => { delete c.State; },
  ]) {
    const i = globalThis.structuredClone(image); const c = globalThis.structuredClone(container); mutate(i, c);
    assert.throws(() => validateScannerRetentionReadbackState(i, c, expected), /readback_invalid/u);
  }
});

test("scratch archive copy has an explicit inert command and never pulls a fallback", () => {
  const subject = `${P.package}@sha256:${"a".repeat(64)}`;
  const args = scannerRetentionLinuxCreateArguments("aw-scanner-retention-copy-0123456789abcdef", subject);
  assert.equal(args[0], "create");
  assert.deepEqual(args.slice(-4), ["--pull", "never", subject, P.publisher.contextPayloadPath]);
  assert.throws(() => scannerRetentionLinuxCreateArguments("foreign", subject), /container_identity/u);
  assert.throws(() => scannerRetentionLinuxCreateArguments("aw-scanner-retention-copy-0123456789abcdef",
    `${P.package}:latest`), /container_identity/u);
});
