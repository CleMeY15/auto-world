import assert from "node:assert/strict";
import test from "node:test";
import { finished } from "node:stream/promises";
import { SCANNER_RETENTION as P, canonicalJsonBytes, scannerRetentionPublisherPhases, sha256 }
  from "../scripts/scanner/retention-policy.mjs";
import { scannerRetentionCopyErrorCode, TEST_ONLY_runScannerRetentionCopy } from "../scripts/scanner/retention-copy.mjs";

function intakeFixture(events) {
  const identity = { runId: "123456", headSha: "1".repeat(40), headTree: "2".repeat(40) };
  const innerTar = { bytes: 1024, sha256: "3".repeat(64) }; const q = P.qualification.artifact;
  const receipt = { schemaVersion: 1, state: "PUBLISHED_UNADMITTED", result: "PASSED", repository: P.repository,
    workflow: P.publisher.workflow, runId: identity.runId, runAttempt: 1, headSha: identity.headSha, headTree: identity.headTree,
    qualificationArtifact: { id: q.id, name: q.name, digest: q.digest, bytes: q.sizeInBytes, expiresAt: q.expiresAt },
    package: P.package, tag: `${P.package}:${P.publisher.tagPrefix}${innerTar.sha256}`, ghcrManifestDigest: `sha256:${"4".repeat(64)}`,
    innerTar, restoreManifest: { bytes: 100, sha256: "5".repeat(64) }, oci: {
      manifest: { mediaType: "application/vnd.oci.image.manifest.v1+json", bytes: 500, sha256: "4".repeat(64) },
      config: { digest: `sha256:${"6".repeat(64)}`, mediaType: "application/vnd.oci.image.config.v1+json", bytes: 800, sha256: "6".repeat(64) },
      layer: { digest: `sha256:${"7".repeat(64)}`, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", bytes: 4000, sha256: "7".repeat(64) },
      readback: { imageId: `sha256:${"6".repeat(64)}`, containerId: "8".repeat(64),
        innerTarBytes: innerTar.bytes, innerTarSha256: innerTar.sha256, stoppedNeverStarted: true },
    }, phases: scannerRetentionPublisherPhases.map((name) => ({ name, result: "PASSED", durationMs: 1 })),
    cleanup: { state: "PASSED", image: "REMOVED", container: "REMOVED", buildCache: "REMOVED",
      authenticatedDockerConfig: "REMOVED", ownedPathRemoved: true },
    claims: { forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED", scannerExecuted: false,
      retained: false, restored: false, admitted: false, supportStart: null, supportEnd: null } };
  const bytes = canonicalJsonBytes(receipt, P.publisher.receiptCapBytes);
  const binding = { runId: identity.runId, runAttempt: 1, runNumber: 2, headSha: identity.headSha, headTree: identity.headTree,
    artifactId: 456, artifactName: `${P.publisher.artifactNamePrefix}${identity.runId}-1`, artifactDigest: `sha256:${sha256(bytes)}`,
    artifactBytes: bytes.length, receiptBytes: bytes.length, receiptSha256: sha256(bytes) };
  const base = `https://api.github.com/repos/${P.repository}`;
  const artifact = { id: binding.artifactId, name: binding.artifactName, digest: binding.artifactDigest,
    size_in_bytes: bytes.length, expired: false, url: `${base}/actions/artifacts/456`,
    archive_download_url: `${base}/actions/artifacts/456/zip`, workflow_run: { id: Number(identity.runId), head_sha: identity.headSha },
    created_at: "2026-11-16T00:00:00Z", expires_at: "2026-11-23T00:00:00Z" };
  const routes = new Map([
    [`${base}/actions/runs/${identity.runId}`, { id: Number(identity.runId), run_attempt: 1, run_number: 2,
      workflow_id: P.publisher.recovery.workflowId, path: P.publisher.workflow, event: "workflow_dispatch",
      head_branch: "main", head_sha: identity.headSha, repository: { full_name: P.repository }, status: "completed", conclusion: "success" }],
    [`${base}/actions/runs/${identity.runId}/attempts/1/jobs?per_page=100&page=1`, { total_count: 1, jobs: [
      { id: 789, run_id: Number(identity.runId), run_attempt: 1, head_sha: identity.headSha,
        name: "Publish exact private scanner retention candidate", status: "completed", conclusion: "success" }] }],
    [`${base}/actions/artifacts/456`, artifact],
    [`${base}/actions/runs/${identity.runId}/artifacts?per_page=100&page=1`, { total_count: 1, artifacts: [artifact] }],
    [`${base}/git/commits/${identity.headSha}`, { sha: identity.headSha, tree: { sha: identity.headTree } }],
  ]);
  return { binding, token: "test-token", now: () => Date.parse("2026-11-17T00:00:00Z"),
    fetchImpl: async (url) => { events.push("api"); assert.ok(routes.has(url)); return globalThis.Response.json(routes.get(url)); },
    download: async ({ handle }) => { events.push("download"); await handle.write(bytes, 0, bytes.length, 0); },
    // Isolate ZIP transport only; production receipt/hash/sidecar validation still runs.
    scan: async ({ source, openEntrySink }) => {
      events.push("scan"); const sink = openEntrySink({ path: "publisher-receipt.json" });
      sink.end(await source.readAt(0, source.size)); await finished(sink);
    } };
}

for (const role of ["tools", "capacity"]) {
  for (const failAt of [1, 2]) {
    test(`${role} refusal at check${failAt} prevents every staging, commit and restore effect`, async () => {
      const events = []; const options = intakeFixture(events); const counts = { tools: 0, capacity: 0 };
      for (const current of ["tools", "capacity"]) options[current] = () => {
        counts[current]++; events.push(current);
        if (current === role && counts[current] === failAt) throw new Error(`scanner_retention_local_${role === "tools" ? "tool_identity" : "capacity"}`);
      };
      for (const effect of ["pipe", "run", "restore"]) options[effect] = () => { events.push(effect); assert.fail("unexpected copy effect"); };
      await assert.rejects(TEST_ONLY_runScannerRetentionCopy(options),
        { message: `scanner_retention_local_${role === "tools" ? "tool_identity" : "capacity"}` });
      assert.equal(events.some((event) => ["pipe", "run", "restore"].includes(event)), false);
      if (failAt === 1) assert.deepEqual(events, role === "tools" ? ["tools"] : ["tools", "capacity"]);
      else {
        assert.deepEqual(events.slice(0, 2), ["tools", "capacity"]);
        assert.deepEqual(events.slice(2, 9), [...Array(5).fill("api"), "download", "scan"]);
        assert.deepEqual(events.slice(9), role === "tools" ? ["tools"] : ["tools", "capacity"]);
      }
    });
  }
}

test("both preflights must pass before the production coordinator reaches StageTar", async () => {
  const events = []; const options = intakeFixture(events);
  options.tools = () => events.push("tools"); options.capacity = () => events.push("capacity");
  options.pipe = () => { events.push("StageTar"); throw new Error("fixture_stage_reached"); };
  await assert.rejects(TEST_ONLY_runScannerRetentionCopy(options), { message: "fixture_stage_reached" });
  assert.deepEqual(events, ["tools", "capacity", ...Array(5).fill("api"), "download", "scan", "tools", "capacity", "StageTar"]);
});

test("copy CLI diagnostic mapping emits only exact known safe codes", () => {
  let getterCalled = false;
  for (const code of ["scanner_retention_local_tool_identity", "scanner_retention_local_tool_unbound",
    "scanner_retention_local_host_invalid", "scanner_retention_local_capacity", "scanner_retention_copy_api_failed"]) {
    assert.equal(scannerRetentionCopyErrorCode(new Error(code)), code);
  }
  for (const value of [new Error("private detail"), new Error("scanner_retention_copy_private-detail"),
    new Error("scanner_retention_local_tool_identity\nprivate detail"), null, undefined,
    { get message() { getterCalled = true; return "private detail"; } }]) {
    assert.equal(scannerRetentionCopyErrorCode(value), "scanner_retention_copy_failed");
  }
  assert.equal(getterCalled, false);
});
