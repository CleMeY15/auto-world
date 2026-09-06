import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "@auto-world/connector-sdk";
import * as keys from "../dist/keys.js";
import { copy, NOW, SOURCE } from "./fixtures.mjs";
import { referenceKey } from "./store.mjs";

for (const [kind, parts, expected] of [
  ["sample", [], "2c2ac03a400514c1e00c61c563a5e20a59e0c54a2ca5608f0a20b1c82072335c"],
  ["sample", ["a", "bc"], "0bf97cf12504c0c206596c59bbf47ddd66b21a63393e98b8d6d642ddb0c305f6"],
  ["sample", ["ab", "c"], "47f9b9c7cb244cf40a65fdf146f1145ca2b03a815a747a835dc63bd8e9e4dc8a"],
  ["sample", ["é", "水"], "7b12a53a0601c6c96bbd56b0faa5636fb3b9f73b2ce6157249d0e10dd6d5da63"],
  ["run", ["src_synthetic", "schedule-1"], "cefe9e159c10cda0e871025c7a54191d0b3b795d8f1924ffa3f080c0c211be76"],
]) {
  test("SHA256 framing golden: " + kind + " " + parts.join("/"), async () => {
    assert.equal(await keys.hashConnectorKey(kind, parts), expected);
  });
}

test("identity framing rejects lone surrogates instead of replacing them and colliding", async () => {
  for (const invalid of ["\uD800", "x\uD800", "\uDC00", "\uD800x"]) {
    await assert.rejects(keys.hashConnectorKey("sample", [invalid]), /connector_invalid_unicode/);
  }
  assert.notEqual(await keys.hashConnectorKey("sample", ["\uD83D\uDE97"]),
    await keys.hashConnectorKey("sample", ["\uFFFD"]));
});

test("native byte digest covers the exact view, not the entire backing buffer", async () => {
  const bytes = new Uint8Array([0, 97, 98, 99, 0]);
  assert.equal(await keys.sha256Bytes(bytes.subarray(1, 4)),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("all persisted identity formulas match independent fixed-order reference encoding", async () => {
  const run = await keys.deriveRunId(SOURCE, "one");
  assert.equal(run, referenceKey("run_", "run", SOURCE, "one"));
  const page = await keys.derivePageKey(run, 0, "p1");
  const raw = await keys.deriveRawSnapshotId(SOURCE, page);
  const scope = await keys.deriveScopeId(SOURCE, "FR", "feed");
  const listing = await keys.deriveListingId(SOURCE, "a");
  const sha = "a".repeat(64);
  const at = new Date(NOW).toISOString();
  assert.equal(page, referenceKey("page_", "page", run, "0", "p1"));
  assert.equal(raw, referenceKey("raw_", "raw", SOURCE, page));
  assert.equal(scope, referenceKey("scope_", "scope", SOURCE, "FR", "feed"));
  assert.equal(listing, referenceKey("lst_", "listing", SOURCE, "a"));
  assert.equal(await keys.deriveItemKey(SOURCE, "a"), referenceKey("item_", "item", SOURCE, "a"));
  assert.equal(await keys.deriveListingVersionId(listing, run, raw, sha, "v1"),
    referenceKey("lv_", "listing-version", listing, run, raw, sha, "v1"));
  const draft = { field: "price", value: { amountMinor: 100, currency: "EUR" }, confidenceBps: 10000 };
  assert.equal(await keys.deriveObservationId(listing, draft, at, run, raw, sha, "v1"),
    referenceKey("obs_", "observation", listing, "price", "amountMinor=100;currency=EUR", "10000", at, run, raw, sha, "v1"));
  assert.equal(await keys.deriveExplicitTombstoneId(scope, "a", "deleted", at, run, raw, sha),
    referenceKey("tmb_", "explicit-tombstone", scope, "a", "deleted", at, run, raw, sha));
  const generation = await keys.deriveInventoryGenerationId(scope, run, "empty");
  const commit = await keys.derivePageCommitKey(page, sha, "v1");
  const final = await keys.deriveFinalizationKey(scope, run, "empty", generation, commit);
  assert.equal(generation, referenceKey("inv_", "inventory", scope, run, "empty"));
  assert.equal(commit, referenceKey("commit_", "commit", page, sha, "v1"));
  assert.equal(final, referenceKey("final_", "finalization", scope, run, "empty", generation, commit));
  assert.equal(await keys.deriveMissingTombstoneId(scope, "a", "empty", generation, final),
    referenceKey("tmb_", "missing-tombstone", scope, "a", "empty", generation, final));
  assert.notEqual(await keys.deriveMissingTombstoneId(scope, "a", "empty", generation, final),
    await keys.deriveMissingTombstoneId(scope, "b", "empty", generation, final));
  assert.equal(await keys.deriveAttemptReservationKey(run, 1, 0, 1),
    referenceKey("reserve_", "attempt-reservation", run, "1", "0", "1"));
});

test("same value/time/digest in different runs cannot collide while provenance differs", async () => {
  const one = await keys.deriveRunId(SOURCE, "one");
  const two = await keys.deriveRunId(SOURCE, "two");
  const rawOne = await keys.deriveRawSnapshotId(SOURCE, await keys.derivePageKey(one, 0, "p"));
  const rawTwo = await keys.deriveRawSnapshotId(SOURCE, await keys.derivePageKey(two, 0, "p"));
  const listing = await keys.deriveListingId(SOURCE, "a");
  const draft = { field: "mileage", value: { amount: 10, unit: "km" }, confidenceBps: 10000 };
  const sha = "a".repeat(64);
  const at = new Date(NOW).toISOString();
  assert.notEqual(await keys.deriveObservationId(listing, draft, at, one, rawOne, sha, "v"),
    await keys.deriveObservationId(listing, draft, at, two, rawTwo, sha, "v"));
});

function runtime() {
  return { schemaVersion: 1, sourceId: SOURCE, revision: 0, nextRequestAtMs: 0,
    circuit: { state: "closed", consecutiveTransientFailures: 0, openedAtMs: null,
      probeOwnerFence: null, probeExpiresAtMs: null } };
}
function reservation(nowMs = NOW, fence = 1, attempt = 1) {
  const runId = referenceKey("run_", "run", SOURCE, "synthetic");
  return { schemaVersion: 1, sourceId: SOURCE, runId,
    operationKey: referenceKey("reserve_", "attempt-reservation", runId, fence, 0, attempt),
    leaseFence: fence, signal: new globalThis.AbortController().signal,
    pageOrdinal: 0, attempt, nowMs, requestIntervalMs: 500,
    circuitOpenMs: 60000, transientFailureThreshold: 5, probeTtlMs: 1000 };
}
function complete(state, reserved, input, kind, completedAtMs = reserved.notBeforeMs) {
  return sdk.reduceAttemptCompletion(state, reserved, {
    schemaVersion: 1, sourceId: SOURCE, runId: input.runId, leaseFence: input.leaseFence,
    operationKey: referenceKey("attempt_", "attempt", input.runId, reserved.reservationKey),
    signal: input.signal, reservationKey: reserved.reservationKey,
    expectedRuntimeRevision: reserved.runtimeRevision, outcome: { kind },
    completedAtMs,
  });
}

test("durable rate reservation advances before fetch and does not mutate input", () => {
  const original = runtime();
  const frozen = copy(original);
  const first = sdk.reduceAttemptReservation(original, reservation());
  assert.equal(first.success, true);
  assert.deepEqual(original, frozen);
  assert.equal(first.data.notBeforeMs, NOW);
  assert.equal(first.nextState.nextRequestAtMs, NOW + 500);
  const second = sdk.reduceAttemptReservation(first.nextState, reservation(NOW, 1, 2));
  assert.equal(second.success, true);
  assert.equal(second.data.notBeforeMs, NOW + 500);
});

test("attempt completion cannot consume a reservation before its source-wide rate slot", () => {
  const input = reservation();
  const reserved = sdk.reduceAttemptReservation(runtime(), input);
  assert.equal(complete(reserved.nextState, reserved.data, input, "success", reserved.data.notBeforeMs - 1).success, false);
  assert.equal(complete(reserved.nextState, reserved.data, input, "success", reserved.data.notBeforeMs).success, true);
});

test("circuit opens at five typed transient failures then admits exactly one expiring probe", () => {
  let state = runtime();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const input = reservation(NOW + (attempt - 1) * 500, 1, attempt);
    const reserved = sdk.reduceAttemptReservation(state, input);
    assert.equal(reserved.success, true);
    const completed = complete(reserved.nextState, reserved.data, input, "transient");
    assert.equal(completed.success, true);
    state = completed.nextState;
    assert.equal(state.circuit.consecutiveTransientFailures, attempt);
  }
  assert.equal(state.circuit.state, "open");
  const openedAt = state.circuit.openedAtMs;
  assert.equal(sdk.reduceAttemptReservation(state, reservation(openedAt + 59999, 2)).failure.code, "circuit_open");
  const probeInput = reservation(openedAt + 60000, 2);
  const probe = sdk.reduceAttemptReservation(state, probeInput);
  assert.equal(probe.success, true);
  assert.equal(probe.data.ownsHalfOpenProbe, true);
  assert.equal(probe.nextState.circuit.probeExpiresAtMs, probe.data.notBeforeMs + 1000);
  assert.equal(sdk.reduceAttemptReservation(probe.nextState, reservation(openedAt + 60001, 3)).success, false);
  const success = complete(probe.nextState, probe.data, probeInput, "success");
  assert.equal(success.success, true);
  assert.equal(success.nextState.circuit.state, "closed");
  assert.equal(success.nextState.circuit.consecutiveTransientFailures, 0);
});

test("rate-limited failures do not increment transient count and wrong revision fails", () => {
  const input = reservation();
  const reserved = sdk.reduceAttemptReservation(runtime(), input);
  const limited = complete(reserved.nextState, reserved.data, input, "rate_limited");
  assert.equal(limited.success, true);
  assert.equal(limited.nextState.circuit.consecutiveTransientFailures, 0);
  assert.equal(complete(limited.nextState, reserved.data, input, "success").success, false);
});

test("runtime reducers fail closed on unsafe primitives and hostile descriptors", () => {
  let called = 0;
  const hostile = runtime();
  Object.defineProperty(hostile, "revision", { enumerable: true, get() { called += 1; throw new Error("synthetic-private"); } });
  for (const state of [hostile, { ...runtime(), revision: -0 }, { ...runtime(), nextRequestAtMs: NaN },
    { ...runtime(), sourceId: "src_wrong" }]) {
    const result = sdk.reduceAttemptReservation(state, reservation());
    assert.equal(result.success, false);
    assert.ok(!JSON.stringify(result).includes("synthetic-private"));
  }
  assert.equal(called, 0);
});
