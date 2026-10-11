import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { appendSourceRevision } from "@auto-world/source-registry";
import { createSyntheticHarness, SYNTHETIC_CORPUS_MANIFEST } from "@auto-world/synthetic-connector/demo";

const stateOf = (harness) => harness.storage.snapshot();
const values = (map) => [...map.values()];
const fixtureFetches = (harness) => harness.trace.filter((entry) => entry.startsWith("fixture.fetch:"));

test("manifest pins exact UTF-8 bytes and the single SDK scope", async () => {
  assert.deepEqual(SYNTHETIC_CORPUS_MANIFEST.source, {
    sourceId: "src_sdk_synthetic",
    territory: "FR",
    acquisitionMethod: "feed",
    scopeId: "scope_7d18dbe77c718e18cb036fbb21b1658a783498188d5b547ed5c5413a5c743414",
  });
  for (const descriptor of Object.values(SYNTHETIC_CORPUS_MANIFEST.files)) {
    const bytes = await readFile(new URL(`../demo/corpus/${descriptor.name}`, import.meta.url));
    assert.equal(bytes.byteLength, descriptor.byteLength, descriptor.name);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256, descriptor.name);
    const text = new globalThis.TextDecoder("utf-8", { fatal: true }).decode(bytes);
    for (const forbidden of ["vin", "http://", "https://", "seller", "photo", "make", "model", "year"]) {
      assert.equal(text.toLowerCase().includes(forbidden), false, `${descriptor.name}:${forbidden}`);
    }
  }
});

test("valid fixture commits unresolved listings and exact listing-scoped raw provenance", async () => {
  const harness = createSyntheticHarness();
  const result = await harness.run("valid");
  assert.equal(result.status, "completed", JSON.stringify(result));
  const state = stateOf(harness);
  assert.equal(state.raw.size, 1);
  assert.equal(state.listings.size, 1);
  assert.equal(state.versions.size, 1);
  assert.equal(state.observations.size, 2);
  assert.equal(state.projections.size, 1);
  assert.equal(state.tombstones.size, 0);
  const raw = values(state.raw)[0];
  assert.equal(raw.pending.sha256, SYNTHETIC_CORPUS_MANIFEST.files.valid.sha256);
  assert.equal(raw.pending.byteLength, SYNTHETIC_CORPUS_MANIFEST.files.valid.byteLength);
  const listing = values(state.listings)[0];
  const version = values(state.versions)[0];
  assert.deepEqual(listing.identity, { status: "unresolved" });
  assert.equal(version.listingId, listing.listingId);
  assert.deepEqual(version.observationIds.sort(), values(state.observations).map((item) => item.observationId).sort());
  for (const observation of values(state.observations)) {
    assert.deepEqual(observation.subject, { kind: "listing", listingId: listing.listingId });
    assert.equal(observation.provenance.sourceId, "src_sdk_synthetic");
    assert.equal(observation.provenance.raw.connectorRunId, result.runId);
    assert.equal(observation.provenance.raw.snapshotId, raw.pending.snapshotId);
    assert.equal(observation.provenance.raw.sha256, raw.pending.sha256);
    assert.equal(observation.provenance.observedAt, raw.pending.capturedAt);
    assert.equal(observation.provenance.acquisitionMethod, "feed");
    assert.equal(observation.provenance.legalStatus, "dealer_feed");
    assert.equal(observation.provenance.confidenceBps, observation.field === "price" ? 10000 : 9000);
  }
  assert.equal(Object.hasOwn(state, "vehicles"), false);
  assert.equal(Object.hasOwn(state, "vehicleEntities"), false);
});

test("malformed bytes stage raw before decode and publish nothing", async () => {
  const harness = createSyntheticHarness();
  const result = await harness.run("malformed", { invocationKey: "malformed" });
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "duplicate_member");
  const state = stateOf(harness);
  assert.equal(state.raw.size, 1);
  assert.equal(values(state.raw)[0].pending.sha256, SYNTHETIC_CORPUS_MANIFEST.files.malformed.sha256);
  assert.equal(state.listings.size, 0);
  assert.equal(state.observations.size, 0);
  assert.equal(state.projections.size, 0);
});

test("contradictory values remain distinct immutable observations", async () => {
  const harness = createSyntheticHarness();
  assert.equal((await harness.run("contradictory", { invocationKey: "contradictory" })).status, "completed");
  const state = stateOf(harness);
  const prices = values(state.observations).filter((item) => item.field === "price");
  assert.deepEqual(prices.map((item) => item.value.amountMinor).sort(), [2000000, 2100000]);
  assert.equal(new Set(prices.map((item) => item.observationId)).size, 2);
  assert.equal(new Set(prices.map((item) => item.provenance.raw.sha256)).size, 1);
  prices[0].value.amountMinor = 1;
  assert.deepEqual(values(stateOf(harness).observations).filter((item) => item.field === "price")
    .map((item) => item.value.amountMinor).sort(), [2000000, 2100000]);
});

test("completed replay performs no acquisition and appends no duplicate evidence", async () => {
  const harness = createSyntheticHarness();
  const first = await harness.run("valid");
  const before = stateOf(harness);
  const fetchCount = fixtureFetches(harness).length;
  const replay = await harness.run("valid");
  assert.deepEqual(replay, first);
  assert.equal(fixtureFetches(harness).length, fetchCount);
  assert.equal(stateOf(harness).observations.size, before.observations.size);
  assert.equal(stateOf(harness).versions.size, before.versions.size);
});

test("default invocation binds the selected scenario while exact scenario replay stays idempotent", async () => {
  const harness = createSyntheticHarness();
  assert.equal((await harness.run("valid")).status, "completed");
  const firstFetches = fixtureFetches(harness).length;
  assert.equal((await harness.run("valid")).status, "completed");
  assert.equal(fixtureFetches(harness).length, firstFetches);
  assert.equal((await harness.run("contradictory")).status, "completed");
  assert.equal(fixtureFetches(harness).length, firstFetches + 1);
  assert.equal(stateOf(harness).raw.size, 2);

  const conflict = createSyntheticHarness();
  assert.equal((await conflict.run("valid", { invocationKey: "shared-scenario-key" })).status, "completed");
  const before = fixtureFetches(conflict).length;
  const result = await conflict.run("contradictory", { invocationKey: "shared-scenario-key" });
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "idempotency_conflict");
  assert.equal(fixtureFetches(conflict).length, before);
});

test("request overrides cannot escape the manifest source and scope", async () => {
  const harness = createSyntheticHarness();
  const protectedOverrides = {
    sourceId: "src_other",
    territory: "DE",
    acquisitionMethod: "api",
    audience: "consumer",
    fields: ["vin"],
    adapterVersion: "other-adapter",
    mapperVersion: "other-mapper",
  };
  for (const [key, value] of Object.entries(protectedOverrides)) {
    await assert.rejects(harness.run("valid", { [key]: value }),
      { message: "synthetic_fixture_overrides_invalid" });
  }
  let getterCalls = 0;
  await assert.rejects(harness.run("valid", { get invocationKey() { getterCalls += 1; return "ignored"; } }),
    { message: "synthetic_fixture_overrides_invalid" });
  await assert.rejects(harness.run("valid", { limits: {
    get maxPages() { getterCalls += 1; return 1; },
  } }), { message: "synthetic_fixture_overrides_invalid" });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const throwing = new Proxy({}, { getPrototypeOf() { throw new Error("private-reflection-message"); } });
  for (const value of [revoked.proxy, throwing]) {
    await assert.rejects(harness.run("valid", value), { message: "synthetic_fixture_overrides_invalid" });
    await assert.rejects(harness.run("valid", { limits: value }), { message: "synthetic_fixture_overrides_invalid" });
  }
  for (const limits of [Object.create({ maxPages: 1 }), { unsupported: 1 }, []]) {
    await assert.rejects(harness.run("valid", { limits }), { message: "synthetic_fixture_overrides_invalid" });
  }
  assert.equal(getterCalls, 0);
  assert.equal(harness.trace.length, 0);
  assert.equal(stateOf(harness).runs.size, 0);
  const result = await harness.run("valid");
  assert.equal(result.status, "completed", JSON.stringify(result));
  const state = stateOf(harness);
  const run = values(state.runs)[0];
  assert.equal(run.sourceId, SYNTHETIC_CORPUS_MANIFEST.source.sourceId);
  assert.deepEqual(run.scope, SYNTHETIC_CORPUS_MANIFEST.source);
  assert.deepEqual(run.request.fields, ["mileage", "price", "source_listing_id"]);
  assert.equal(run.request.audience, "internal");
  assert.equal(run.request.adapterVersion, "synthetic-search-v1-valid");
  assert.equal(run.request.mapperVersion, "synthetic-search-mapper-v1");
});

test("explicit withdrawal ends the active projection and preserves historical evidence", async () => {
  const harness = createSyntheticHarness();
  assert.equal((await harness.run("withdrawnBaseline", { invocationKey: "withdrawn-baseline" })).status, "completed");
  const before = stateOf(harness);
  assert.equal(before.observations.size, 2);
  const delta = await harness.run("withdrawnDelta", { mode: "incremental", invocationKey: "withdrawn-delta" });
  assert.equal(delta.status, "completed", JSON.stringify(delta));
  const state = stateOf(harness);
  assert.equal(state.observations.size, 2);
  assert.equal(values(state.tombstones).filter((item) => item.kind === "explicit").length, 1);
  assert.equal(values(state.projections)[0].state, "withdrawn");
  assert.deepEqual(values(state.inventories)[0].activeSourceListingIds, []);
});

test("interrupted full run never infers absence; completed full run finalizes its generation", async () => {
  const interrupted = createSyntheticHarness();
  const failed = await interrupted.run("partialInterrupted", { invocationKey: "partial-interrupted" });
  assert.equal(failed.status, "failed");
  let state = stateOf(interrupted);
  assert.equal(state.observations.size, 1);
  assert.equal(state.tombstones.size, 0);
  assert.equal(values(state.inventories)[0].generationId, "empty");
  assert.equal(values(state.inventories)[0].lastCompletedFullAt, null);

  const completed = createSyntheticHarness();
  const result = await completed.run("partialFull", { invocationKey: "partial-completed" });
  assert.equal(result.status, "completed", JSON.stringify(result));
  state = stateOf(completed);
  assert.equal(state.observations.size, 2);
  assert.equal(values(state.inventories)[0].activeSourceListingIds.length, 2);
  assert.notEqual(values(state.inventories)[0].generationId, "empty");
  assert.notEqual(values(state.inventories)[0].lastCompletedFullAt, null);
});

test("empty full corpus has an honest finalization receipt", async () => {
  const harness = createSyntheticHarness();
  const result = await harness.run("empty", { invocationKey: "empty" });
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.items, 0);
  const state = stateOf(harness);
  assert.equal(state.observations.size, 0);
  assert.equal(values(state.inventories)[0].activeSourceListingIds.length, 0);
  assert.equal(values(state.ledger).filter((entry) => entry.kind === "full.finalized").length, 1);
});

test("mid-run revocation and already-expired structural authority fail closed", async () => {
  const revoked = createSyntheticHarness();
  const commit = revoked.ports.store.commitPage;
  revoked.ports.store.commitPage = async (input) => {
    const receipt = await commit(input);
    if (receipt.success) {
      const head = revoked.registry.revisions.at(-1);
      const changed = appendSourceRevision(revoked.registry, {
        revision: head.revision + 1,
        state: "disabled",
        configuration: head.configuration,
        event: { eventId: "aud_synthetic_revoke", kind: "disable", actorRef: "actor_synthetic",
          at: new Date(revoked.time.clock.nowMs()).toISOString(), reasonRef: "reason_synthetic_revoke" },
      });
      assert.equal(changed.success, true);
      revoked.registry = changed.data;
    }
    return receipt;
  };
  const revokedResult = await revoked.run("partialFull", { invocationKey: "revoked" });
  assert.ok(["policy_revision_changed", "policy_revoked"].includes(revokedResult.error.code));
  assert.equal(fixtureFetches(revoked).length, 1);

  const expired = createSyntheticHarness({ initialTime: Date.parse("2027-01-01T00:00:00.000Z") });
  assert.equal((await expired.run("valid", { invocationKey: "expired" })).error.code, "policy_ineligible");
  assert.equal(fixtureFetches(expired).length, 0);
});

test("raw expiry, cancellation and lost acknowledgement keep SDK failure semantics", async () => {
  const expiry = createSyntheticHarness({ registry: { policy: {
    retention: { rawSeconds: 1, normalizedSeconds: 172800, mediaSeconds: 0, piiSeconds: 0 },
  } } });
  expiry.storage.faults.set("raw.staged", "after");
  assert.equal((await expiry.run("valid", { invocationKey: "expiry" })).error.code, "mutation_indeterminate");
  expiry.time.advance(1000);
  assert.equal((await expiry.run("valid", { invocationKey: "expiry" })).error.code, "retention_expired");

  const cancelled = createSyntheticHarness();
  const controller = new globalThis.AbortController();
  controller.abort("private-cancel-reason");
  const cancelledResult = await cancelled.run("valid", { invocationKey: "cancelled" }, controller.signal);
  assert.equal(cancelledResult.status, "cancelled");
  assert.equal(cancelled.trace.length, 0);

  const resumed = createSyntheticHarness();
  resumed.storage.faults.set("page.committed", "after");
  assert.equal((await resumed.run("valid", { invocationKey: "commit-fault" })).error.code, "mutation_indeterminate");
  const fetchCount = fixtureFetches(resumed).length;
  assert.equal((await resumed.run("valid", { invocationKey: "commit-fault" })).status, "completed");
  assert.equal(fixtureFetches(resumed).length, fetchCount);
});

test("typed transient failures open the existing circuit and emit one bounded sanitized alert", async () => {
  const harness = createSyntheticHarness();
  const first = await harness.run("transientFailure", { invocationKey: "transient-1" });
  assert.equal(first.status, "failed");
  assert.ok(["acquisition_failed", "circuit_open"].includes(first.error.code));
  const second = await harness.run("transientFailure", { invocationKey: "transient-2" });
  assert.equal(second.status, "failed");
  assert.equal(second.error.code, "circuit_open");
  assert.deepEqual(harness.alerts, [{ code: "synthetic_connector_circuit_open", count: 1 }]);
  const observable = JSON.stringify([first, second, harness.alerts, harness.telemetry, stateOf(harness).outbox]);
  for (const forbidden of ["publication-", "amountMinor", "evidence_sdk", "procedure_sdk", "contact_sdk", "sha256"]) {
    assert.equal(observable.includes(forbidden), false, forbidden);
  }
});
