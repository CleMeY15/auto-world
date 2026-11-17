import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SCANNER_RETENTION as P } from "../scripts/scanner/retention-policy.mjs";
import { TEST_ONLY_verifyScannerRetentionQualificationApi, TEST_ONLY_parseScannerRetentionPublisherManifest,
  TEST_ONLY_createScannerRetentionPublisherRunner, TEST_ONLY_runScannerRetentionPublish,
  TEST_ONLY_scannerRetentionPublisherAbsent,
  validateScannerRetentionReadbackState }
  from "../scripts/scanner/retention-publish.mjs";
import { authenticateScannerRetentionPublisherArtifact, runScannerRetentionCopy,
  validateScannerRetentionCopyRoot } from "../scripts/scanner/retention-copy.mjs";
import { scannerRetentionLinuxCreateArguments, scannerRetentionLinuxImageAbsent,
  validateScannerRetentionPublisherObservation } from "../scripts/scanner/retention-copy-linux.mjs";

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

test("copy refuses alternate checkouts before intake or credential transfer", async () => {
  const root = "C:\\Users\\Administrator\\Documents\\ChatGPT\\Auto-world";
  const script = `${root}\\scripts\\scanner\\retention-copy-linux.mjs`;
  validateScannerRetentionCopyRoot(root, root, script);
  for (const values of [["C:\\worktree", root, script], [root, "C:\\replacement", script],
    [root, root, "C:\\other\\retention-copy-linux.mjs"], ["\\\\host\\share", root, script]]) {
    assert.throws(() => validateScannerRetentionCopyRoot(...values), /checkout_invalid/u);
  }
  if (process.platform !== "win32") {
    let effects = 0;
    await assert.rejects(runScannerRetentionCopy({ fetchImpl: () => { effects++; } }), /checkout_invalid/u);
    assert.equal(effects, 0);
  }
});

test("production cleanup preserves colliding and replaced directories", async (t) => {
  for (const scenario of ["collision", "replacement", "owned"]) {
    const root = mkdtempSync(path.join(tmpdir(), "scanner-publisher-cleanup-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const output = path.join(root, "scanner-retention-publisher-public"); mkdirSync(output, { mode: 0o700 });
    const provenance = path.join(root, "trivy-provenance"); mkdirSync(provenance, { mode: 0o700 });
    writeFileSync(path.join(provenance, "foreign"), "preserve");
    const work = path.join(root, "scanner-retention-publish-42");
    if (scenario === "collision") { mkdirSync(work, { mode: 0o700 }); writeFileSync(path.join(work, "foreign"), "preserve"); }
    let commands = 0;
    const runner = TEST_ONLY_createScannerRetentionPublisherRunner({ output }, {
      statfs: () => ({ bavail: P.closure.publisherRequiredFreeBytes, bsize: 1 }),
      commandRunner: () => { commands++; throw new Error("unexpected command"); },
    });
    const context = { runnerTemp: root, workspace: root, runId: "42", publisher: P.publisher, path: process.env.PATH };
    if (scenario === "collision") await assert.rejects(runner("context_and_capacity", { context }), { code: "EEXIST" });
    else await runner("context_and_capacity", { context });
    if (scenario === "replacement") {
      renameSync(work, `${work}-original`); mkdirSync(work, { mode: 0o700 });
      writeFileSync(path.join(work, "foreign"), "preserve");
    }
    await runner.cleanup();
    assert.equal(readFileSync(path.join(provenance, "foreign"), "utf8"), "preserve");
    assert.equal(commands, 0);
    if (scenario === "owned") assert.equal(existsSync(work), false);
    else assert.equal(readFileSync(path.join(work, "foreign"), "utf8"), "preserve");
  }
});

test("publication failure retains completed phases, known digest and failed phase without private error text", async () => {
  await assert.rejects(TEST_ONLY_runScannerRetentionPublish({
    validateContext: () => ({ runId: "42", headSha: "a".repeat(40) }),
    runPhase: async (name) => {
      if (name === "authenticated_digest_readback") throw new Error("credential-shaped private failure");
      return { values: name === "oci_candidate_push" ? { ghcrManifestDigest: `sha256:${"b".repeat(64)}` } : {} };
    },
  }), (error) => {
    assert.equal(error.message, "scanner_retention_publish_command_failed");
    assert.equal(error.publisherProgress.values.ghcrManifestDigest, `sha256:${"b".repeat(64)}`);
    assert.equal(error.publisherProgress.phases.at(-1).name, "authenticated_digest_readback");
    assert.equal(error.publisherProgress.phases.at(-1).result, "FAILED");
    assert.ok(error.publisherProgress.phases.slice(0, -1).every((phase) => phase.result === "PASSED"));
    return true;
  });
});

test("cleanup accepts only explicit absence, not daemon errors or interrupted inspections", () => {
  const result = { status: 1, stdout: "", stderr: "Error: No such image: sha256:abc", signal: null };
  assert.equal(TEST_ONLY_scannerRetentionPublisherAbsent(result, "image"), true);
  assert.equal(TEST_ONLY_scannerRetentionPublisherAbsent({ ...result, status: 0 }, "image"), false);
  assert.equal(TEST_ONLY_scannerRetentionPublisherAbsent({ ...result,
    stderr: 'ERROR: no builder "aw-scanner-retention-42" found' }, "builder", "aw-scanner-retention-42"), true);
  for (const changed of [{ ...result, stderr: "Cannot connect to the Docker daemon" },
    { ...result, signal: "SIGTERM" }, { ...result, error: new Error("private detail") },
    { ...result, status: 2 }]) {
    assert.throws(() => TEST_ONLY_scannerRetentionPublisherAbsent(changed, "image"), /cleanup_inspect_failed/u);
  }
  assert.throws(() => TEST_ONLY_scannerRetentionPublisherAbsent({ ...result,
    stderr: "Cannot connect to the Docker daemon" }, "builder", "aw-scanner-retention-42"), /cleanup_inspect_failed/u);
});

test("publisher accepts bounded archive layers larger than the harmless bootstrap payload", () => {
  const value = { schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: `sha256:${"a".repeat(64)}`, size: 1024 },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: `sha256:${"b".repeat(64)}`,
      size: 60 * 1024 ** 2 }] };
  const parse = () => TEST_ONLY_parseScannerRetentionPublisherManifest(JSON.stringify(value));
  assert.equal(parse().layer.bytes, 60 * 1024 ** 2);
  const layerCap = P.closure.tarCapBytes + 1024 ** 2;
  value.layers[0].size = layerCap; assert.equal(parse().layer.bytes, layerCap);
  for (const size of [0, -1, 1.5, layerCap + 1, "100"]) {
    value.layers[0].size = size;
    assert.throws(parse, /scanner_retention_publish_manifest_invalid/u);
  }
  value.layers[0].size = 60 * 1024 ** 2;
  value.config.size = P.publisher.registryCapBytes + 1;
  assert.throws(parse, /scanner_retention_publish_manifest_invalid/u);
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
  const binding = { runId: "123", runAttempt: 1, runNumber: 2, headSha: "a".repeat(40), headTree: "b".repeat(40),
    artifactId: 456, artifactName: `${P.publisher.artifactNamePrefix}123-1`, artifactDigest: `sha256:${"c".repeat(64)}`,
    artifactBytes: 100, receiptBytes: 100, receiptSha256: "d".repeat(64) };
  const fixture = () => ({
    run: { id: 123, run_attempt: 1, run_number: 2, workflow_id: 420550475,
      path: P.publisher.workflow, event: "workflow_dispatch",
      head_branch: "main", head_sha: binding.headSha, repository: { full_name: P.repository },
      status: "completed", conclusion: "success" },
    jobs: { total_count: 1, jobs: [{ id: 789, run_id: 123, run_attempt: 1, head_sha: binding.headSha,
      name: "Publish exact private scanner retention candidate",
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
  for (const mutate of [
    (data) => { data.run.run_number = 1; }, (data) => { data.run.run_number = 3; },
    (data) => { data.run.run_attempt = 2; }, (data) => { data.run.workflow_id++; },
    (data) => { data.jobs.jobs[0].run_id++; }, (data) => { data.jobs.jobs[0].run_attempt = 2; },
    (data) => { data.jobs.jobs[0].head_sha = "c".repeat(40); },
    (data) => { data.jobs.jobs[0].id = 0; }, (data) => { data.jobs.jobs.push({ name: "foreign" }); },
  ]) {
    const data = fixture(); mutate(data);
    await assert.rejects(execute(data), /publisher_api_invalid/u);
  }
  assert.equal(validateScannerRetentionPublisherObservation(binding).runNumber, 2);
  for (const changed of [{ ...binding, runNumber: 1 }, { ...binding, runNumber: 3 },
    { ...binding, runAttempt: 2 }, { ...binding, runId: P.publisher.recovery.predecessor.runId,
      artifactName: `${P.publisher.artifactNamePrefix}${P.publisher.recovery.predecessor.runId}-1` }]) {
    let effects = 0;
    await assert.rejects(authenticateScannerRetentionPublisherArtifact(changed, "test-token", () => { effects++; }),
      /publisher_observation_invalid/u);
    assert.equal(effects, 0);
  }
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

test("Linux copy refuses ambiguous image inspection before login, pull and cleanup", () => {
  const absent = { status: 1, signal: null, stdout: Buffer.from("[]\n"),
    stderr: Buffer.from("Error response from daemon: No such image: ghcr.io/example@sha256:abc\n") };
  assert.equal(scannerRetentionLinuxImageAbsent(absent), true);
  assert.equal(scannerRetentionLinuxImageAbsent({ ...absent, status: 0 }), false);
  for (const changed of [{ ...absent, stderr: Buffer.from("Cannot connect to the Docker daemon") },
    { ...absent, signal: "SIGTERM" }, { ...absent, error: new Error("failure") },
    { ...absent, status: 2 }, { ...absent, stderr: "not a byte buffer" }]) {
    assert.throws(() => scannerRetentionLinuxImageAbsent(changed), /scanner_retention_copy_linux_image_inspect_failed/u);
  }
});
