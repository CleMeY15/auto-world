import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSyntheticDescriptionHarness,
  SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST,
} from "@auto-world/synthetic-connector/demo";
import { createSyntheticDemoReadPortV2 } from "../demo/createSyntheticDemoReadPort.mjs";

const NOW = Date.parse("2026-10-14T10:00:00.000Z");
const context = () => ({
  requestId: "req_0123456789abcdef0123456789abcdef",
  signal: new globalThis.AbortController().signal,
});
const query = (overrides = {}) => ({ schemaVersion: 2, sort: "listing_asc", ...overrides });

async function populated() {
  const harness = createSyntheticDescriptionHarness({ initialTime: NOW });
  assert.equal((await harness.run("descriptionBaseline", { invocationKey: "v2-base" })).status, "completed");
  assert.equal((await harness.run("descriptionDelta", {
    mode: "incremental",
    invocationKey: "v2-delta",
  })).status, "completed");
  const port = await createSyntheticDemoReadPortV2({ harness, nowMs: () => harness.time.clock.nowMs() });
  return { harness, port };
}

test("V2 catalog and search expose attributed synthetic descriptions without private identities", async () => {
  const { port } = await populated();
  const catalog = await port.catalog(context());
  assert.equal(catalog.success, true);
  assert.equal(catalog.data.fixtureVersion, "synthetic-description-v2");
  assert.deepEqual(catalog.data.taxonomyRelease.makes.map((item) => item.primaryName.value),
    ["Marque A fictive", "Marque B fictive"]);

  const outcome = await port.search(query(), context());
  assert.equal(outcome.success, true, JSON.stringify(outcome));
  assert.equal(outcome.data.totalCount, 8);
  const unavailable = outcome.data.results.find((item) => item.description.status === "unavailable");
  assert.ok(unavailable);
  const contradictory = outcome.data.results.find((item) => item.descriptionEvidence.length === 2);
  assert.ok(contradictory);
  assert.equal(contradictory.description.status, "authored_synthetic");
  assert.equal(contradictory.description.value.makeId, "make_boreal_fictive");
  assert.equal(contradictory.description.value.modelId, "model_boreal_b2_fictif");
  assert.equal(contradictory.description.value.firstRegistrationYear, 2022);
  assert.deepEqual(contradictory.descriptionEvidence.map((item) => item.value.makeId),
    ["make_aurora_fictive", "make_boreal_fictive"]);
  const serialized = JSON.stringify(outcome);
  for (const forbidden of ["sourceListingId", "connectorRunId", "snapshotId", "raw_", "publication-description"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("V2 applies exact identity filters and rejects unknown or cross-parent pairs", async () => {
  const { port } = await populated();
  const make = await port.search(query({ makeId: "make_aurora_fictive" }), context());
  assert.equal(make.success, true);
  assert.equal(make.data.results.length, 3);
  assert.equal(make.data.results.every((item) => item.description.value.makeId === "make_aurora_fictive"), true);

  const combined = await port.search(query({
    makeId: "make_boreal_fictive",
    modelId: "model_boreal_b1_fictif",
    firstRegistrationYear: 2022,
    priceMaxMinor: 1_600_000,
    mileageMaxKm: 40_000,
  }), context());
  assert.equal(combined.success, true);
  assert.equal(combined.data.results.length, 1);
  assert.equal(combined.data.results[0].description.value.modelId, "model_boreal_b1_fictif");

  for (const invalid of [
    query({ makeId: "make_unknown" }),
    query({ makeId: "make_aurora_fictive", modelId: "model_boreal_b1_fictif" }),
    query({ modelId: "model_boreal_b1_fictif" }),
  ]) {
    assert.deepEqual(await port.search(invalid, context()), {
      success: false,
      error: { code: "invalid_query" },
    });
  }
});

test("V2 raw corruption fails closed while cancellation remains sanitized", async () => {
  const { harness } = await populated();
  const authentic = harness.storage.snapshot();
  const corrupted = globalThis.structuredClone(authentic);
  const raw = [...corrupted.raw.values()][0];
  raw.bytes[0] ^= 1;
  const port = await createSyntheticDemoReadPortV2({ snapshotProvider: () => corrupted,
    nowMs: () => harness.time.clock.nowMs() });
  assert.deepEqual(await port.search(query(), context()), {
    success: false,
    error: { code: "read_unavailable" },
  });

  const controller = new globalThis.AbortController();
  controller.abort("private cancellation reason");
  assert.deepEqual(await port.catalog({ requestId: context().requestId, signal: controller.signal }), {
    success: false,
    error: { code: "cancelled" },
  });
});

test("latest omitted description is unavailable while history and repeated declarations are retained", async () => {
  const omittedHarness = createSyntheticDescriptionHarness({ initialTime: NOW });
  assert.equal((await omittedHarness.run("descriptionBaseline", { invocationKey: "v2-omitted-base" })).status,
    "completed");
  assert.equal((await omittedHarness.run("descriptionOmittedDelta", {
    mode: "incremental",
    invocationKey: "v2-omitted-delta",
  })).status, "completed");
  const omittedPort = await createSyntheticDemoReadPortV2({ harness: omittedHarness,
    nowMs: () => omittedHarness.time.clock.nowMs() });
  const omittedSearch = await omittedPort.search(query(), context());
  assert.equal(omittedSearch.success, true);
  const historical = omittedSearch.data.results.find((item) => item.descriptionEvidence.length === 1 &&
    item.description.status === "unavailable");
  assert.ok(historical);
  assert.equal((await omittedPort.search(query({ makeId: "make_aurora_fictive" }), context())).data.results
    .some((item) => item.listingId === historical.listingId), false);

  const repeatedHarness = createSyntheticDescriptionHarness({ initialTime: NOW });
  assert.equal((await repeatedHarness.run("descriptionBaseline", { invocationKey: "v2-repeat-base" })).status,
    "completed");
  assert.equal((await repeatedHarness.run("descriptionBaseline", {
    mode: "incremental",
    invocationKey: "v2-repeat-delta",
  })).status, "completed");
  const repeatedPort = await createSyntheticDemoReadPortV2({ harness: repeatedHarness,
    nowMs: () => repeatedHarness.time.clock.nowMs() });
  const repeated = await repeatedPort.search(query(), context());
  assert.equal(repeated.success, true);
  assert.equal(repeated.data.results.every((item) => item.description.status === "unavailable" ||
    item.descriptionEvidence.length === 2), true);
  assert.equal(new Set(repeated.data.results.flatMap((item) => item.descriptionEvidence)
    .map((item) => item.evidenceId)).size, 14);
});

test("tied capture times select and order authored history by ASCII listing version identity", async () => {
  const { harness } = await populated();
  const snapshot = harness.storage.snapshot();
  const projection = [...snapshot.projections.values()]
    .find((item) => item.sourceListingId === "publication-description-history");
  const versions = [...snapshot.versions.values()]
    .filter((item) => item.sourceListingId === "publication-description-history")
    .sort((left, right) => left.listingVersionId < right.listingVersionId ? -1 : 1);
  assert.equal(versions.length, 2);
  const tiedAt = versions[1].capturedAt;
  const baselineSnapshotId = versions.find((item) =>
    item.raw.sha256 === SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.files.descriptionBaseline.sha256).raw.snapshotId;
  for (const version of snapshot.versions.values()) {
    if (version.raw.snapshotId !== baselineSnapshotId) continue;
    version.capturedAt = tiedAt;
    snapshot.raw.get(version.raw.snapshotId).pending.capturedAt = tiedAt;
    for (const observationId of version.observationIds) {
      snapshot.observations.get(observationId).provenance.observedAt = tiedAt;
    }
  }
  projection.latestVersionId = versions[1].listingVersionId;
  const port = await createSyntheticDemoReadPortV2({ snapshotProvider: () => snapshot,
    nowMs: () => harness.time.clock.nowMs() });
  const outcome = await port.search(query(), context());
  assert.equal(outcome.success, true, JSON.stringify(outcome));
  const result = outcome.data.results.find((item) => item.descriptionEvidence.length === 2);
  assert.ok(result);
  assert.deepEqual(result.descriptionEvidence.map((item) => item.capturedAt), [tiedAt, tiedAt]);
  const expectedMake = versions[1].raw.sha256 === SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.files.descriptionDelta.sha256
    ? "make_boreal_fictive"
    : "make_aurora_fictive";
  assert.equal(result.description.value.makeId, expectedMake);
  assert.equal(result.description.evidenceId, result.descriptionEvidence[1].evidenceId);
});

test("V2 rejects a coherently repointed admitted raw when committed deterministic identities are unchanged", async () => {
  const { harness, port } = await populated();
  const authentic = await port.search(query(), context());
  assert.equal(authentic.success, true);
  assert.equal(authentic.data.results.some((item) => item.price.status === "observed" &&
    item.price.value.amountMinor === 1_640_000), true);

  const omittedHarness = createSyntheticDescriptionHarness({ initialTime: NOW });
  assert.equal((await omittedHarness.run("descriptionOmittedDelta", {
    invocationKey: "v2-substitution-source",
  })).status, "completed");
  const omittedSnapshot = omittedHarness.storage.snapshot();
  const omittedDescriptor = SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.files.descriptionOmittedDelta;
  const omittedRaw = [...omittedSnapshot.raw.values()]
    .find((item) => item.pending.sha256 === omittedDescriptor.sha256);
  assert.ok(omittedRaw);

  const substituted = globalThis.structuredClone(harness.storage.snapshot());
  const deltaDescriptor = SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.files.descriptionDelta;
  const raw = [...substituted.raw.values()].find((item) => item.pending.sha256 === deltaDescriptor.sha256);
  assert.ok(raw);
  raw.bytes = omittedRaw.bytes.slice();
  raw.pending.sha256 = omittedDescriptor.sha256;
  raw.pending.byteLength = omittedDescriptor.byteLength;
  raw.pending.pageIdentity = `${SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.fixtureVersion}:${omittedDescriptor.name}`;
  for (const version of substituted.versions.values()) {
    if (version.raw.snapshotId === raw.pending.snapshotId) version.raw.sha256 = omittedDescriptor.sha256;
  }
  for (const observation of substituted.observations.values()) {
    if (observation.provenance.raw.snapshotId === raw.pending.snapshotId) {
      observation.provenance.raw.sha256 = omittedDescriptor.sha256;
    }
  }
  const substitutedPort = await createSyntheticDemoReadPortV2({ snapshotProvider: () => substituted,
    nowMs: () => harness.time.clock.nowMs() });
  assert.deepEqual(await substitutedPort.search(query(), context()), {
    success: false,
    error: { code: "read_unavailable" },
  });
});

test("V2 cursor binds exact filters and invalidates after raw-backed snapshot replacement", async () => {
  const harness = createSyntheticDescriptionHarness({ initialTime: NOW });
  assert.equal((await harness.run("descriptionPagination", {
    invocationKey: "v2-pagination",
    limits: { maxPageBytes: 64 * 1024, maxJsonMembers: 5_000, maxItems: 100 },
  })).status, "completed");
  const port = await createSyntheticDemoReadPortV2({ harness, nowMs: () => harness.time.clock.nowMs() });
  const first = await port.search(query(), context());
  assert.equal(first.success, true);
  assert.equal(first.data.fixtureVersion, SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.fixtureVersion);
  assert.equal(first.data.results.length, 20);
  assert.equal(first.data.totalCount, 41);
  assert.match(first.data.nextCursor, /^cur_[a-f0-9]{64}$/);

  const middle = await port.search(query({ cursor: first.data.nextCursor }), context());
  const replay = await port.search(query({ cursor: first.data.nextCursor }), context());
  assert.equal(middle.success, true);
  assert.deepEqual(replay, middle);
  assert.equal(middle.data.results.length, 20);
  assert.match(middle.data.nextCursor, /^cur_[a-f0-9]{64}$/);
  assert.deepEqual(await port.search(query({ makeId: "make_aurora_fictive", cursor: first.data.nextCursor }), context()), {
    success: false,
    error: { code: "invalid_cursor" },
  });

  const last = await port.search(query({ cursor: middle.data.nextCursor }), context());
  assert.equal(last.success, true);
  assert.equal(last.data.results.length, 1);
  assert.equal(Object.hasOwn(last.data, "nextCursor"), false);

  assert.equal((await harness.run("descriptionDelta", {
    mode: "incremental",
    invocationKey: "v2-pagination-replacement",
  })).status, "completed");
  assert.deepEqual(await port.search(query({ cursor: first.data.nextCursor }), context()), {
    success: false,
    error: { code: "invalid_cursor" },
  });
});
