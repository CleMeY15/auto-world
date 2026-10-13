import assert from "node:assert/strict";
import test from "node:test";

import * as domainEvents from "../dist/index.js";
import {
  checkObservationChangeEvidence,
  parseDomainEventId,
  parseObservationChangeEvent,
} from "../dist/index.js";
import {
  clone,
  priceEvent,
  syntheticObservation,
} from "./fixtures/synthetic.mjs";

const firstIssue = (result) => {
  assert.equal(result.success, false);
  return result.issues[0];
};

const previousPrice = () => syntheticObservation();
const currentPrice = () => syntheticObservation({
  observationId: "obs_price_current",
  value: { amountMinor: 4_100_000, currency: "EUR" },
  observedAt: "2026-10-12T11:00:00.000Z",
  rawIndex: 2,
});

test("exports only the closed runtime contract and workspace marker", () => {
  assert.deepEqual(Object.keys(domainEvents).sort(), [
    "checkObservationChangeEvidence",
    "parseDomainEventId",
    "parseObservationChangeEvent",
    "workspaceBoundary",
  ]);
});

test("parses the exact event ID grammar", () => {
  for (const accepted of ["evt_a", `evt_a${"-".repeat(63)}`, "evt_A1_b-c"]) {
    assert.equal(parseDomainEventId(accepted).success, true, accepted);
  }
  for (const rejected of [
    "evt_",
    `evt_a${"-".repeat(64)}`,
    "evt_-leading",
    "reserve_other",
    "page_other",
    "evt_space value",
    "evt_unicode_é",
    "evt_line\n",
    "evt_control_\u0000",
  ]) {
    assert.deepEqual(firstIssue(parseDomainEventId(rejected)), { code: "invalid_value", path: "$" });
  }
});

test("parses both closed event members and returns detached frozen values", () => {
  for (const input of [priceEvent(), priceEvent({
    eventId: "evt_synthetic_mileage_change",
    type: "mileage.changed",
    previousObservationId: "obs_mileage_previous",
    currentObservationId: "obs_mileage_current",
  })]) {
    const expected = clone(input);
    const result = parseObservationChangeEvent(input);
    assert.equal(result.success, true);
    input.eventId = "evt_mutated";
    assert.deepEqual(result.data, expected);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.data), true);
  }
});

test("rejects unsupported versions, names, equal references, unknown keys and malformed times", () => {
  const cases = [
    [priceEvent({ schemaVersion: 2 }), "unsupported_version", "$.schemaVersion"],
    [priceEvent({ type: "listing.removed" }), "invalid_value", "$.type"],
    [priceEvent({ currentObservationId: "obs_price_previous" }), "invalid_value", "$.currentObservationId"],
    [{ ...priceEvent(), copiedPrice: 4_100_000 }, "unknown_key", "$"],
    [priceEvent({ observedAt: "2026-02-29T11:00:00.000Z" }), "invalid_value", "$.observedAt"],
    [priceEvent({ occurredAt: "2026-10-12T10:59:59.999Z" }), "invalid_value", "$.occurredAt"],
  ];
  for (const [input, code, path] of cases) {
    assert.deepEqual(firstIssue(parseObservationChangeEvent(input)), { code, path });
  }
});

test("structural parsing does not establish evidence consistency", () => {
  const parsed = parseObservationChangeEvent(priceEvent());
  assert.equal(parsed.success, true);
  const mismatched = currentPrice();
  mismatched.observationId = "obs_unreferenced";
  assert.deepEqual(
    firstIssue(checkObservationChangeEvidence(parsed.data, previousPrice(), mismatched)),
    { code: "invalid_value", path: "$.currentObservation.observationId" },
  );
});

test("checks both subject kinds before listing ID matches", () => {
  const previous = previousPrice();
  const current = currentPrice();
  previous.subject.listingId = "lst_other_previous";
  current.subject = { kind: "vehicle", vehicleId: "veh_other_current" };
  assert.deepEqual(
    firstIssue(checkObservationChangeEvidence(priceEvent(), previous, current)),
    { code: "invalid_value", path: "$.currentObservation.subject" },
  );
});

test("accepts consistent supplied evidence without exporting authority or direction claims", () => {
  const result = checkObservationChangeEvidence(priceEvent(), previousPrice(), currentPrice());
  assert.equal(result.success, true);
  assert.deepEqual(Object.keys(result.data), ["event", "previousObservation", "currentObservation"]);
  assert.equal("direction" in result.data, false);
  assert.equal("authorized" in result.data, false);
  assert.equal("committed" in result.data, false);
  assert.equal(Object.isFrozen(result.data), true);
  assert.equal(Object.isFrozen(result.data.previousObservation.value), true);
});

test("parses exact replay and changed same-ID content independently", () => {
  const first = parseObservationChangeEvent(priceEvent());
  const replay = parseObservationChangeEvent(clone(priceEvent()));
  const changed = parseObservationChangeEvent(priceEvent({ occurredAt: "2026-10-12T11:00:02.000Z" }));
  assert.equal(first.success && replay.success && changed.success, true);
  assert.deepEqual(first.data, replay.data);
  assert.equal(first.data.eventId, changed.data.eventId);
  assert.notDeepEqual(first.data, changed.data);
});
