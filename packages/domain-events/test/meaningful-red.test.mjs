import assert from "node:assert/strict";
import test from "node:test";

import {
  checkObservationChangeEvidence,
  parseObservationChangeEvent,
} from "../dist/index.js";
import {
  clone,
  priceEvent,
  syntheticObservation,
} from "./fixtures/synthetic.mjs";

const previousPrice = () => syntheticObservation();
const currentPrice = () => syntheticObservation({
  observationId: "obs_price_current",
  value: { amountMinor: 4_100_000, currency: "EUR" },
  observedAt: "2026-10-12T11:00:00.000Z",
  rawIndex: 2,
});
const previousMileage = () => syntheticObservation({
  observationId: "obs_mileage_previous",
  field: "mileage",
  value: { amount: 42_000, unit: "km" },
});
const currentMileage = () => syntheticObservation({
  observationId: "obs_mileage_current",
  field: "mileage",
  value: { amount: 42_500, unit: "km" },
  observedAt: "2026-10-12T11:00:00.000Z",
  rawIndex: 2,
});

test("rejects price.changed with mileage observations", () => {
  const event = priceEvent({
    previousObservationId: "obs_mileage_previous",
    currentObservationId: "obs_mileage_current",
  });
  assert.equal(checkObservationChangeEvidence(event, previousMileage(), currentMileage()).success, false);
});

test("rejects a current observation ID that differs from the event reference", () => {
  const current = currentPrice();
  current.observationId = "obs_other_current";
  assert.equal(checkObservationChangeEvidence(priceEvent(), previousPrice(), current).success, false);
});

test("rejects equal or reversed observation times", () => {
  for (const observedAt of ["2026-10-12T10:00:00.000Z", "2026-10-12T09:59:59.999Z"]) {
    const current = currentPrice();
    current.provenance.observedAt = observedAt;
    assert.equal(checkObservationChangeEvidence(priceEvent({ observedAt }), previousPrice(), current).success, false);
  }
});

test("rejects provenance-only changes when the exact field value is equal", () => {
  const current = currentPrice();
  current.value = clone(previousPrice().value);
  assert.equal(checkObservationChangeEvidence(priceEvent(), previousPrice(), current).success, false);
});

test("rejects a hostile accessor without invoking or leaking it", () => {
  let invoked = false;
  const event = priceEvent();
  Object.defineProperty(event, "type", {
    enumerable: true,
    get() {
      invoked = true;
      throw new Error("SECRET_ACCESSOR");
    },
  });
  const result = parseObservationChangeEvent(event);
  assert.equal(result.success, false);
  assert.equal(invoked, false);
  assert.equal(JSON.stringify(result).includes("SECRET_ACCESSOR"), false);
});

test("detaches parsed output from later caller mutation", () => {
  const input = priceEvent();
  const parsed = parseObservationChangeEvent(input);
  assert.equal(parsed.success, true);
  input.observedAt = "2026-10-12T12:00:00.000Z";
  assert.equal(parsed.data.observedAt, "2026-10-12T11:00:00.000Z");
});
