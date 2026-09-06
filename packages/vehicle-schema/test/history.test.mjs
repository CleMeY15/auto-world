import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendObservations,
  parseObservationCollection,
} from "@auto-world/vehicle-schema";
import { cloneSynthetic, syntheticObservation } from "./fixtures/synthetic.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("collapses an exact observation replay", () => {
  const observation = syntheticObservation();
  const parsed = assertSuccess(parseObservationCollection([observation, cloneSynthetic(observation)]));
  assert.equal(parsed.length, 1);
});

test("treats object-key ordering as irrelevant for exact replay", () => {
  const observation = syntheticObservation();
  const reordered = {
    provenance: cloneSynthetic(observation.provenance),
    value: cloneSynthetic(observation.value),
    field: observation.field,
    subject: cloneSynthetic(observation.subject),
    observationId: observation.observationId,
    schemaVersion: observation.schemaVersion,
  };
  assert.equal(assertSuccess(parseObservationCollection([observation, reordered])).length, 1);
});

test("rejects observation ID reuse with changed content", () => {
  const changed = syntheticObservation({ value: { amountMinor: 4_000_000, currency: "EUR" } });
  assertIssue(parseObservationCollection([syntheticObservation(), changed]), "observation_conflict", "$[1]");
});

test("retains contradictory observations with distinct IDs", () => {
  const first = syntheticObservation({
    observationId: "obs_mileage_1",
    field: "mileage",
    value: { amount: 10_000, unit: "km" },
  });
  const second = syntheticObservation({
    observationId: "obs_mileage_2",
    field: "mileage",
    value: { amount: 25_000, unit: "km" },
  });
  const parsed = assertSuccess(parseObservationCollection([first, second]));
  assert.deepEqual(parsed.map(({ observationId }) => observationId), ["obs_mileage_1", "obs_mileage_2"]);
});

test("preserves first-seen order rather than rewriting chronology", () => {
  const newer = syntheticObservation({
    observationId: "obs_newer",
    provenance: { ...syntheticObservation().provenance, observedAt: "2026-09-06T12:34:56.789Z" },
  });
  const older = syntheticObservation({
    observationId: "obs_older",
    provenance: { ...syntheticObservation().provenance, observedAt: "2025-09-06T12:34:56.789Z" },
  });
  const parsed = assertSuccess(parseObservationCollection([newer, older]));
  assert.deepEqual(parsed.map(({ observationId }) => observationId), ["obs_newer", "obs_older"]);
});

test("appends observations without mutating prior history", () => {
  const existing = [syntheticObservation()];
  const incoming = [syntheticObservation({ observationId: "obs_price_2" })];
  const parsed = assertSuccess(appendObservations(existing, incoming));
  incoming[0].value.amountMinor = 1;
  assert.equal(existing.length, 1);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].value.amountMinor, 4_250_000);
  assert.equal(Object.isFrozen(parsed), true);
});

test("collapses replay while appending", () => {
  const observation = syntheticObservation();
  const parsed = assertSuccess(appendObservations([observation], [cloneSynthetic(observation)]));
  assert.equal(parsed.length, 1);
});

test("rejects conflicting observation ID while appending", () => {
  const changed = syntheticObservation({ value: { amountMinor: 1, currency: "EUR" } });
  assertIssue(appendObservations([syntheticObservation()], [changed]), "observation_conflict", "$.incoming[0]");
});

test("reports an append conflict at the original incoming index", () => {
  const firstIncoming = syntheticObservation({ observationId: "obs_incoming" });
  const changedExisting = syntheticObservation({ value: { amountMinor: 1, currency: "EUR" } });
  assertIssue(
    appendObservations(
      [syntheticObservation()],
      [firstIncoming, cloneSynthetic(firstIncoming), changedExisting],
    ),
    "observation_conflict",
    "$.incoming[2]",
  );
});

test("rejects conflicting IDs within a new incoming batch without changing history", () => {
  const existing = [syntheticObservation({ observationId: "obs_existing" })];
  const first = syntheticObservation({ observationId: "obs_incoming" });
  const changed = { ...first, value: { amountMinor: 1, currency: "EUR" } };
  const before = cloneSynthetic(existing);
  assertIssue(appendObservations(existing, [first, changed]), "observation_conflict", "$.incoming[1]");
  assert.deepEqual(existing, before);
});

test("rejects invalid existing and incoming batches at their own schema paths", () => {
  assertIssue(appendObservations(null, []), "invalid_type", "$.existing");
  assertIssue(appendObservations([], {}), "invalid_type", "$.incoming");
  assertIssue(appendObservations([], [null]), "invalid_type", "$.incoming[0]");
});

test("rejects collections above the documented limit", () => {
  const oversized = Array.from({ length: 10_001 }, (_, index) =>
    syntheticObservation({ observationId: `obs_${index}` }),
  );
  assertIssue(parseObservationCollection(oversized), "invalid_value", "$");
});

test("rejects an append whose combined collection exceeds the limit", () => {
  const existing = Array.from({ length: 10_000 }, (_, index) =>
    syntheticObservation({ observationId: `obs_${index}` }),
  );
  const incoming = [syntheticObservation({ observationId: "obs_overflow" })];
  assertIssue(appendObservations(existing, incoming), "invalid_value", "$");
});

test("rejects a collection with a symbol property", () => {
  const collection = [syntheticObservation()];
  collection[Symbol("hidden")] = true;
  assertIssue(parseObservationCollection(collection), "invalid_object", "$");
});

test("rejects a collection accessor without invoking it", () => {
  let calls = 0;
  const collection = [syntheticObservation()];
  Object.defineProperty(collection, "0", {
    enumerable: true,
    get() {
      calls += 1;
      return syntheticObservation();
    },
  });
  assertIssue(parseObservationCollection(collection), "invalid_object", "$");
  assert.equal(calls, 0);
});

test("sanitizes a revoked collection proxy", () => {
  const { proxy, revoke } = Proxy.revocable([syntheticObservation()], {});
  revoke();
  assertIssue(parseObservationCollection(proxy), "invalid_object", "$");
});
