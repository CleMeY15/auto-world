import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticHarness } from "@auto-world/synthetic-connector/demo";
import { ProjectionRejected } from "../.prototype-dist/model.js";
import { captureSnapshot, projectCanonicalSnapshot } from "../.prototype-dist/snapshot.js";

const NOW = Date.parse("2026-10-12T10:00:00.000Z");

function canonical(snapshot) {
  const inventory = [...snapshot.inventories.values()][0];
  const events = [...snapshot.ledger.values()].filter((entry) => ["page.committed", "full.finalized"].includes(entry.kind));
  const versions = [...snapshot.versions.values()];
  return {
    inventory: { generation_id: inventory.generationId, revision: inventory.revision, head: inventory },
    runs: [...snapshot.runs.entries()].map(([run_id, checkpoint]) => ({ run_id, checkpoint })),
    events: events.map((entry) => ({
      run_id: entry.record.runId,
      operation_key: entry.operationKey,
      kind: entry.kind,
      receipt: { mutation: { operationKey: entry.operationKey, kind: entry.kind, payloadSha256: entry.payloadSha256,
        record: entry.record }, data: entry.data },
    })),
    projections: [...snapshot.projections.values()].map((projection) => ({
      listing_id: projection.listingId, source_listing_id: projection.sourceListingId,
      latest_version_id: projection.latestVersionId, state: projection.state,
      revision: projection.projectionRevision, projection,
    })),
    versions: versions.map((evidence) => ({
      run_id: evidence.connectorRunId, listing_version_id: evidence.listingVersionId,
      listing_id: evidence.listingId, source_listing_id: evidence.sourceListingId,
      snapshot_id: evidence.raw.snapshotId, raw_sha256: evidence.raw.sha256,
      listing: snapshot.listings.get(evidence.listingVersionId), evidence,
    })),
    observations: [...snapshot.observations.values()].map((observation) => {
      const version = versions.find((candidate) => candidate.observationIds.includes(observation.observationId));
      assert.ok(version);
      return {
        run_id: version.connectorRunId, observation_id: observation.observationId,
        listing_id: version.listingId, listing_version_id: version.listingVersionId,
        snapshot_id: version.raw.snapshotId, raw_sha256: version.raw.sha256, observation,
      };
    }),
    tombstones: [...snapshot.tombstones.values()].map((evidence) => ({
      run_id: evidence.runId, tombstone_id: evidence.tombstoneId, listing_id: evidence.listingId,
      source_listing_id: evidence.sourceListingId, kind: evidence.kind,
      snapshot_id: evidence.raw?.snapshotId ?? null, raw_sha256: evidence.raw?.sha256 ?? null, evidence,
    })),
    rawPages: [...snapshot.raw.values()].map(({ pending }) => ({
      run_id: versions.find((version) => version.raw.snapshotId === pending.snapshotId)?.connectorRunId ??
        [...snapshot.tombstones.values()].find((tombstone) => tombstone.raw?.snapshotId === pending.snapshotId)?.runId,
      snapshot_id: pending.snapshotId, sha256: pending.sha256, pending,
    })),
  };
}

async function fixture(scenario, overrides = {}, initial) {
  const harness = initial ?? createSyntheticHarness({ initialTime: NOW });
  const result = await harness.run(scenario, overrides);
  return { harness, result, input: canonical(harness.storage.snapshot()) };
}

test("projects a complete contradictory fixture into a stable sanitized public snapshot", async () => {
  const { input, harness, result } = await fixture("contradictory");
  assert.equal(result.status, "completed");
  const projected = projectCanonicalSnapshot(input, NOW);
  assert.equal(projected.completeness, "complete");
  assert.equal(projected.documents.length, 1);
  assert.equal(projected.documents[0].evidence.length, 3);
  assert.deepEqual(projected.documents[0].evidence.filter((item) => item.field === "price")
    .map((item) => item.value.amountMinor).sort(), [2_000_000, 2_100_000]);
  const prices = [...harness.storage.snapshot().observations.values()].filter((item) => item.field === "price")
    .sort((left, right) => left.observationId < right.observationId ? -1 : 1);
  assert.equal(projected.documents[0].price.value.amountMinor, prices.at(-1).value.amountMinor);
  const output = JSON.stringify(projected);
  const privateObservation = [...harness.storage.snapshot().observations.values()][0];
  for (const forbidden of ["src_sdk_synthetic", "publication-contradictory", privateObservation.observationId,
    privateObservation.provenance.raw.sha256, "connectorRunId", "policyRef", "rawRetainUntil", "vin"]) {
    assert.equal(output.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  assert.equal(projectCanonicalSnapshot(input, NOW).fingerprint, projected.fingerprint);
});

test("reports an interrupted full run as partial without inventing a fresh watermark", async () => {
  const { input, result } = await fixture("partialInterrupted", { invocationKey: "search-partial" });
  assert.equal(result.status, "failed");
  const projected = projectCanonicalSnapshot(input, NOW);
  assert.equal(projected.completeness, "partial");
  assert.equal(projected.dataAsOf, new Date(NOW).toISOString());
  assert.equal(projected.documents.length, 1);
});

test("keeps withdrawn history after an authenticated incremental completion", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await harness.run("withdrawnBaseline", { invocationKey: "search-withdrawn-base" })).status, "completed");
  assert.equal((await harness.run("withdrawnDelta", { mode: "incremental", invocationKey: "search-withdrawn-delta" })).status, "completed");
  const projected = projectCanonicalSnapshot(canonical(harness.storage.snapshot()), harness.time.clock.nowMs());
  assert.equal(projected.completeness, "complete");
  assert.equal(projected.documents.length, 1);
  assert.equal(projected.documents[0].availability, "withdrawn");
  assert.equal(projected.documents[0].evidence.length, 2);
});

test("rejects corrupted provenance and causal timestamp regression with a fixed code", async () => {
  const first = await fixture("valid");
  const corrupted = globalThis.structuredClone(first.input);
  corrupted.observations[0].observation.provenance.raw.sha256 = "f".repeat(64);
  assert.throws(() => projectCanonicalSnapshot(corrupted, NOW), (error) =>
    error instanceof ProjectionRejected && error.code === "projection_invalid");

  const regressed = globalThis.structuredClone(first.input);
  regressed.events[0].receipt.mutation.record.recordedAt = "2026-10-12T10:00:01.000Z";
  assert.throws(() => projectCanonicalSnapshot(regressed, NOW + 2_000), (error) =>
    error instanceof ProjectionRejected && error.code === "projection_invalid");
});

test("causal ordering ignores input order and rejects an ambiguous fence/revision pair", async () => {
  const { input } = await fixture("valid");
  const reordered = globalThis.structuredClone(input);
  reordered.events.reverse();
  assert.deepEqual(projectCanonicalSnapshot(reordered, NOW), projectCanonicalSnapshot(input, NOW));

  const ambiguous = globalThis.structuredClone(input);
  ambiguous.events.push(globalThis.structuredClone(ambiguous.events[0]));
  assert.throws(() => projectCanonicalSnapshot(ambiguous, NOW), (error) =>
    error instanceof ProjectionRejected && error.code === "projection_invalid");
});

test("accepts immutable page history from an earlier lease fence after a faithful resumed completion", async () => {
  const { input } = await fixture("valid");
  const resumed = globalThis.structuredClone(input);
  const run = resumed.runs[0].checkpoint;
  const terminal = resumed.events.find((event) => event.kind === "full.finalized");
  const historicalPage = resumed.events.find((event) => event.kind === "page.committed");
  assert.ok(terminal && historicalPage);
  run.leaseFence = 2;
  terminal.receipt.mutation.record.leaseFence = 2;
  assert.equal(historicalPage.receipt.mutation.record.leaseFence, 1);
  assert.equal(historicalPage.receipt.data.checkpoint.leaseFence, 1);
  assert.equal(projectCanonicalSnapshot(resumed, NOW).completeness, "complete");
});

test("rejects ambiguous canonical primary keys before projection", async () => {
  const { input } = await fixture("valid");
  const duplicateRawIdentity = globalThis.structuredClone(input);
  duplicateRawIdentity.rawPages.push({ ...globalThis.structuredClone(duplicateRawIdentity.rawPages[0]), sha256: "e".repeat(64) });
  assert.throws(() => projectCanonicalSnapshot(duplicateRawIdentity, NOW), (error) =>
    error instanceof ProjectionRejected && error.code === "projection_invalid");

  const duplicateProjection = globalThis.structuredClone(input);
  duplicateProjection.projections.push(globalThis.structuredClone(duplicateProjection.projections[0]));
  assert.throws(() => projectCanonicalSnapshot(duplicateProjection, NOW), (error) =>
    error instanceof ProjectionRejected && error.code === "projection_invalid");
});

test("captureSnapshot uses only bounded allowlisted canonical columns", async () => {
  const { input } = await fixture("valid");
  const rows = [
    [input.inventory], input.runs, input.events, input.projections, input.versions,
    input.observations, input.tombstones, input.rawPages,
  ];
  const statements = [];
  const client = {
    async query(text) {
      statements.push(text);
      return { rows: rows.shift(), rowCount: 0, command: "SELECT", oid: 0, fields: [] };
    },
  };
  const projected = await captureSnapshot(client, NOW);
  assert.equal(projected.completeness, "complete");
  assert.equal(rows.length, 0);
  const sql = statements.join("\n").toLowerCase();
  for (const forbidden of ["raw_bytes", "obligations", "policy", "semantic_command", "select *"]) {
    assert.equal(sql.includes(forbidden), false, forbidden);
  }
  assert.ok(statements.every((statement) => /limit \d+/iu.test(statement)));
});
