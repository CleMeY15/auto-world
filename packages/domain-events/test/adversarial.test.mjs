import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkObservationChangeEvidence,
  parseObservationChangeEvent,
} from "@auto-world/domain-events";

const LISTING_ID = "lst_synthetic_events";
const SOURCE_ID = "src_synthetic_events";
const PREVIOUS_AT = "2026-10-12T10:00:00.000Z";
const INTERMEDIATE_AT = "2026-10-12T10:30:00.000Z";
const CURRENT_AT = "2026-10-12T11:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function syntheticProvenance(observedAt, suffix, overrides = {}) {
  const { raw: rawOverrides = {}, ...rest } = overrides;
  return {
    sourceId: SOURCE_ID,
    observedAt,
    acquisitionMethod: "feed",
    legalStatus: "dealer_feed",
    confidenceBps: 9000,
    raw: {
      snapshotId: `raw_${suffix}`,
      connectorRunId: `run_${suffix}`,
      sha256: "a".repeat(64),
      ...rawOverrides,
    },
    ...rest,
  };
}

function syntheticObservation({
  observationId,
  observedAt,
  field = "price",
  value = { amountMinor: 4_250_000, currency: "EUR" },
  subject = { kind: "listing", listingId: LISTING_ID },
  sourceId = SOURCE_ID,
  confidenceBps = 9000,
  suffix = observationId,
} = {}) {
  return {
    schemaVersion: 1,
    observationId,
    subject,
    field,
    value,
    provenance: syntheticProvenance(observedAt, suffix, {
      sourceId,
      confidenceBps,
    }),
  };
}

function pricePair() {
  return {
    previous: syntheticObservation({
      observationId: "obs_price_previous",
      observedAt: PREVIOUS_AT,
      suffix: "price_previous",
    }),
    current: syntheticObservation({
      observationId: "obs_price_current",
      observedAt: CURRENT_AT,
      value: { amountMinor: 4_100_000, currency: "EUR" },
      suffix: "price_current",
    }),
  };
}

function mileagePair() {
  return {
    previous: syntheticObservation({
      observationId: "obs_mileage_previous",
      observedAt: PREVIOUS_AT,
      field: "mileage",
      value: { amount: 12_000, unit: "km" },
      suffix: "mileage_previous",
    }),
    current: syntheticObservation({
      observationId: "obs_mileage_current",
      observedAt: CURRENT_AT,
      field: "mileage",
      value: { amount: 12_500, unit: "km" },
      suffix: "mileage_current",
    }),
  };
}

function priceEvent(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: "evt_price_change_1",
    type: "price.changed",
    listingId: LISTING_ID,
    previousObservationId: "obs_price_previous",
    currentObservationId: "obs_price_current",
    observedAt: CURRENT_AT,
    occurredAt: "2026-10-12T11:00:01.000Z",
    ...overrides,
  };
}

function mileageEvent(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: "evt_mileage_change_1",
    type: "mileage.changed",
    listingId: LISTING_ID,
    previousObservationId: "obs_mileage_previous",
    currentObservationId: "obs_mileage_current",
    observedAt: CURRENT_AT,
    occurredAt: "2026-10-12T11:00:01.000Z",
    ...overrides,
  };
}

function assertSuccess(result) {
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
}

function assertIssue(result, code, path) {
  assert.equal(result.success, false, JSON.stringify(result));
  assert.deepEqual(result.issues, [{ code, path }]);
}

test("rejects an event accessor without invoking it or leaking its thrown text", () => {
  const secret = "SECRET_ACCESSOR_SENTINEL";
  const input = priceEvent();
  let getterCalls = 0;
  Object.defineProperty(input, "eventId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error(secret);
    },
  });

  const result = parseObservationChangeEvent(input);

  assert.equal(getterCalls, 0);
  assertIssue(result, "invalid_object", "$");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("fails closed when proxy reflection throws without leaking the proxy message", () => {
  const secret = "SECRET_PROXY_SENTINEL";
  const proxy = new Proxy({}, {
    ownKeys() {
      throw new Error(secret);
    },
  });

  const result = parseObservationChangeEvent(proxy);

  assertIssue(result, "invalid_object", "$");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("fails closed for a revoked proxy", () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();

  assertIssue(parseObservationChangeEvent(proxy), "invalid_object", "$");
});

test("rejects a hidden event property", () => {
  const input = priceEvent();
  Object.defineProperty(input, "hidden", {
    enumerable: false,
    value: "SECRET_HIDDEN_SENTINEL",
  });

  assertIssue(parseObservationChangeEvent(input), "unknown_key", "$");
});

test("rejects a symbol event property", () => {
  const input = priceEvent();
  input[Symbol("SECRET_SYMBOL_SENTINEL")] = true;

  assertIssue(parseObservationChangeEvent(input), "unknown_key", "$");
});

test("rejects an event with a custom prototype", () => {
  const input = Object.assign(Object.create({ inherited: true }), priceEvent());

  assertIssue(parseObservationChangeEvent(input), "invalid_object", "$");
});

test("accepts an exact event stored in a null-prototype object", () => {
  const input = Object.assign(Object.create(null), priceEvent());

  assert.deepEqual(assertSuccess(parseObservationChangeEvent(input)), priceEvent());
});

test("does not expose an invalid input string in a validation issue", () => {
  const secret = "evt_SECRET_INPUT_SENTINEL!";
  const result = parseObservationChangeEvent(priceEvent({ eventId: secret }));

  assertIssue(result, "invalid_value", "$.eventId");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("accepts the minimum and maximum calendar-valid event timestamps", () => {
  const minimum = priceEvent({
    observedAt: "0001-01-01T00:00:00.000Z",
    occurredAt: "0001-01-01T00:00:00.000Z",
  });
  const maximum = priceEvent({
    observedAt: "9999-12-31T23:59:59.999Z",
    occurredAt: "9999-12-31T23:59:59.999Z",
  });

  assertSuccess(parseObservationChangeEvent(minimum));
  assertSuccess(parseObservationChangeEvent(maximum));
});

test("rejects calendar-invalid event timestamps", () => {
  for (const observedAt of [
    "0000-01-01T00:00:00.000Z",
    "2026-02-29T00:00:00.000Z",
    "2026-04-31T00:00:00.000Z",
    "2026-13-01T00:00:00.000Z",
  ]) {
    assertIssue(
      parseObservationChangeEvent(priceEvent({ observedAt })),
      "invalid_value",
      "$.observedAt",
    );
  }
});

test("rejects an occurrence time earlier than its observation time", () => {
  const result = parseObservationChangeEvent(priceEvent({
    occurredAt: "2026-10-12T10:59:59.999Z",
  }));

  assertIssue(result, "invalid_value", "$.occurredAt");
});

test("rebases an event parser error before inspecting either observation", () => {
  const result = checkObservationChangeEvidence(
    priceEvent({ type: "listing.removed" }),
    null,
    null,
  );

  assertIssue(result, "invalid_value", "$.event.type");
});

test("rebases a previous observation parser error before inspecting the current observation", () => {
  const result = checkObservationChangeEvidence(priceEvent(), null, null);

  assertIssue(result, "invalid_type", "$.previousObservation");
});

test("rebases a current observation parser error after valid earlier inputs", () => {
  const { previous } = pricePair();
  const result = checkObservationChangeEvidence(priceEvent(), previous, null);

  assertIssue(result, "invalid_type", "$.currentObservation");
});

test("rebases and sanitizes a hostile current observation proxy failure", () => {
  const secret = "SECRET_CURRENT_PROXY_SENTINEL";
  const { previous } = pricePair();
  const current = new Proxy({}, {
    ownKeys() {
      throw new Error(secret);
    },
  });

  const result = checkObservationChangeEvidence(priceEvent(), previous, current);

  assertIssue(result, "invalid_object", "$.currentObservation");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("reports a previous observation reference mismatch first", () => {
  const { previous, current } = pricePair();
  previous.observationId = "obs_wrong_previous";
  current.subject = { kind: "vehicle", vehicleId: "veh_wrong_current" };

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.previousObservation.observationId",
  );
});

test("reports a current observation reference mismatch before subject checks", () => {
  const { previous, current } = pricePair();
  current.observationId = "obs_wrong_current";
  previous.subject = { kind: "vehicle", vehicleId: "veh_wrong_previous" };

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.currentObservation.observationId",
  );
});

test("reports a non-listing previous subject at the stable subject path", () => {
  const { previous, current } = pricePair();
  previous.subject = { kind: "vehicle", vehicleId: "veh_previous" };

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.previousObservation.subject",
  );
});

test("reports a non-listing current subject at the stable subject path", () => {
  const { previous, current } = pricePair();
  current.subject = { kind: "vehicle", vehicleId: "veh_current" };

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.currentObservation.subject",
  );
});

test("reports a previous listing mismatch at its listing ID path", () => {
  const { previous, current } = pricePair();
  previous.subject.listingId = "lst_other_previous";

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.previousObservation.subject.listingId",
  );
});

test("reports a current listing mismatch at its listing ID path", () => {
  const { previous, current } = pricePair();
  current.subject.listingId = "lst_other_current";

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.currentObservation.subject.listingId",
  );
});

test("reports a previous field mismatch before later consistency checks", () => {
  const { previous, current } = pricePair();
  previous.field = "mileage";
  previous.value = { amount: 12_000, unit: "km" };
  current.provenance.sourceId = "src_other";

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.previousObservation.field",
  );
});

test("reports a current field mismatch before source consistency", () => {
  const { previous, current } = pricePair();
  current.field = "mileage";
  current.value = { amount: 12_500, unit: "km" };
  current.provenance.sourceId = "src_other";

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.currentObservation.field",
  );
});

test("reports a provenance source mismatch at the current source path", () => {
  const { previous, current } = pricePair();
  current.provenance.sourceId = "src_other";
  current.provenance.observedAt = PREVIOUS_AT;
  current.value = clone(previous.value);

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.currentObservation.provenance.sourceId",
  );
});

test("rejects equal observation times at the current provenance time path", () => {
  const { previous, current } = pricePair();
  current.provenance.observedAt = PREVIOUS_AT;
  current.value = clone(previous.value);

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.currentObservation.provenance.observedAt",
  );
});

test("rejects reversed observation times at the current provenance time path", () => {
  const { previous, current } = pricePair();
  current.provenance.observedAt = "2026-10-12T09:59:59.999Z";
  const event = priceEvent({
    observedAt: current.provenance.observedAt,
    occurredAt: current.provenance.observedAt,
  });

  assertIssue(
    checkObservationChangeEvidence(event, previous, current),
    "invalid_value",
    "$.currentObservation.provenance.observedAt",
  );
});

test("reports an event timestamp mismatch after pair chronology succeeds", () => {
  const { previous, current } = pricePair();
  current.value = clone(previous.value);
  const event = priceEvent({
    observedAt: "2026-10-12T11:00:00.001Z",
    occurredAt: "2026-10-12T11:00:00.001Z",
  });

  assertIssue(
    checkObservationChangeEvidence(event, previous, current),
    "invalid_value",
    "$.event.observedAt",
  );
});

test("rejects an equal price representation despite confidence and raw-reference changes", () => {
  const { previous, current } = pricePair();
  current.value = clone(previous.value);
  current.provenance.confidenceBps = 1000;
  current.provenance.raw.sha256 = "b".repeat(64);

  assertIssue(
    checkObservationChangeEvidence(priceEvent(), previous, current),
    "invalid_value",
    "$.currentObservation.value",
  );
});

test("accepts a currency-only price representation change without exporting direction", () => {
  const { previous, current } = pricePair();
  current.value = { amountMinor: previous.value.amountMinor, currency: "USD" };

  const data = assertSuccess(
    checkObservationChangeEvidence(priceEvent(), previous, current),
  );

  assert.deepEqual(Object.keys(data), [
    "event",
    "previousObservation",
    "currentObservation",
  ]);
  assert.equal("delta" in data, false);
  assert.equal("direction" in data, false);
});

test("accepts a unit-only mileage representation change without exporting conversion", () => {
  const { previous, current } = mileagePair();
  current.value = { amount: previous.value.amount, unit: "mi" };

  const data = assertSuccess(
    checkObservationChangeEvidence(mileageEvent(), previous, current),
  );

  assert.equal("delta" in data, false);
  assert.equal("conversion" in data, false);
  assert.equal("direction" in data, false);
});

test("parses changed content that independently reuses the same event ID", () => {
  const first = priceEvent();
  const second = priceEvent({
    currentObservationId: "obs_price_later",
    observedAt: "2026-10-12T12:00:00.000Z",
    occurredAt: "2026-10-12T12:00:01.000Z",
  });

  const parsedFirst = assertSuccess(parseObservationChangeEvent(first));
  const parsedSecond = assertSuccess(parseObservationChangeEvent(second));

  assert.equal(parsedFirst.eventId, parsedSecond.eventId);
  assert.notDeepEqual(parsedFirst, parsedSecond);
});

test("accepts a consistent supplied pair even when an intermediate observation is omitted", () => {
  const { previous, current } = pricePair();
  const intermediate = syntheticObservation({
    observationId: "obs_price_intermediate",
    observedAt: INTERMEDIATE_AT,
    value: { amountMinor: 4_200_000, currency: "EUR" },
    suffix: "price_intermediate",
  });

  const data = assertSuccess(
    checkObservationChangeEvidence(priceEvent(), previous, current),
  );

  assert.equal(data.previousObservation.observationId, previous.observationId);
  assert.equal(data.currentObservation.observationId, current.observationId);
  assert.equal(JSON.stringify(data).includes(intermediate.observationId), false);
});

test("returns detached and recursively frozen evidence", () => {
  const event = priceEvent();
  const { previous, current } = pricePair();
  const data = assertSuccess(
    checkObservationChangeEvidence(event, previous, current),
  );

  event.eventId = "evt_mutated";
  previous.value.amountMinor = 1;
  current.provenance.raw.sha256 = "b".repeat(64);

  assert.equal(data.event.eventId, "evt_price_change_1");
  assert.equal(data.previousObservation.value.amountMinor, 4_250_000);
  assert.equal(data.currentObservation.provenance.raw.sha256, "a".repeat(64));
  assert.equal(Object.isFrozen(data), true);
  assert.equal(Object.isFrozen(data.event), true);
  assert.equal(Object.isFrozen(data.previousObservation), true);
  assert.equal(Object.isFrozen(data.previousObservation.value), true);
  assert.equal(Object.isFrozen(data.currentObservation.provenance), true);
  assert.equal(Object.isFrozen(data.currentObservation.provenance.raw), true);
  assert.throws(() => {
    data.currentObservation.provenance.raw.sha256 = "c".repeat(64);
  }, TypeError);
});
