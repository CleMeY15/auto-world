import assert from "node:assert/strict";
import { test } from "node:test";

import { parseObservation } from "@auto-world/vehicle-schema";
import {
  SYNTHETIC_DIGEST,
  syntheticObservation,
  syntheticProvenance,
} from "./fixtures/synthetic.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("parses each closed observation field discriminant", () => {
  const cases = [
    ["price", { amountMinor: 0, currency: "JPY" }],
    ["mileage", { amount: 12_345.5, unit: "mi" }],
    ["power", { amount: 225.25, unit: "metric_hp" }],
    ["co2", { amount: 0, unit: "g_per_km", standard: "wltp" }],
    ["vin", { status: "withheld" }],
  ];
  for (const [field, value] of cases) {
    const input = syntheticObservation({ field, value });
    assert.deepEqual(assertSuccess(parseObservation(input)), input);
  }
});

test("rejects mismatched vehicle subject IDs", () => {
  const subject = { kind: "vehicle", vehicleId: "lst_wrong" };
  assertIssue(parseObservation(syntheticObservation({ subject })), "invalid_value", "$.subject.vehicleId");
});

test("rejects an observation ID from another runtime namespace", () => {
  assertIssue(parseObservation(syntheticObservation({ observationId: "lst_wrong" })), "invalid_value", "$.observationId");
});

test("rejects mismatched listing subject properties", () => {
  const subject = { kind: "listing", vehicleId: "veh_wrong" };
  assertIssue(parseObservation(syntheticObservation({ subject })), "unknown_key", "$.subject");
});

test("rejects unsupported observation fields", () => {
  assertIssue(parseObservation(syntheticObservation({ field: "seller_note", value: "trusted" })), "invalid_value", "$.field");
});

test("accepts confidence boundaries including zero", () => {
  for (const confidenceBps of [0, 10_000]) {
    const provenance = syntheticProvenance({ confidenceBps });
    assertSuccess(parseObservation(syntheticObservation({ provenance })));
  }
});

test("rejects invalid confidence values", () => {
  for (const confidenceBps of [-1, 10_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const provenance = syntheticProvenance({ confidenceBps });
    assertIssue(parseObservation(syntheticObservation({ provenance })), "invalid_value", "$.provenance.confidenceBps");
  }
});

test("rejects a confidence string without coercion", () => {
  const provenance = syntheticProvenance({ confidenceBps: "10000" });
  assertIssue(parseObservation(syntheticObservation({ provenance })), "invalid_type", "$.provenance.confidenceBps");
});

test("accepts the exact supported currency whitelist", () => {
  for (const currency of ["EUR", "USD", "GBP", "CHF", "JPY", "KRW"]) {
    assertSuccess(parseObservation(syntheticObservation({ value: { amountMinor: 0, currency } })));
  }
});

test("rejects unsupported currencies", () => {
  for (const currency of ["eur", "CAD", ""]) {
    assertIssue(parseObservation(syntheticObservation({ value: { amountMinor: 0, currency } })), "invalid_value", "$.value.currency");
  }
});

test("rejects a non-string currency type", () => {
  assertIssue(
    parseObservation(syntheticObservation({ value: { amountMinor: 0, currency: null } })),
    "invalid_type",
    "$.value.currency",
  );
});

test("rejects invalid money amounts without coercion", () => {
  for (const amountMinor of [-0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertIssue(parseObservation(syntheticObservation({ value: { amountMinor, currency: "EUR" } })), "invalid_value", "$.value.amountMinor");
  }
});

test("rejects a money string without coercion", () => {
  assertIssue(
    parseObservation(syntheticObservation({ value: { amountMinor: "100", currency: "EUR" } })),
    "invalid_type",
    "$.value.amountMinor",
  );
});

test("rejects invalid measurement values", () => {
  for (const amount of [-0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assertIssue(parseObservation(syntheticObservation({ field: "mileage", value: { amount, unit: "km" } })), "invalid_value", "$.value.amount");
  }
});

test("rejects a measurement string without coercion", () => {
  assertIssue(
    parseObservation(syntheticObservation({ field: "mileage", value: { amount: "1", unit: "km" } })),
    "invalid_type",
    "$.value.amount",
  );
});

test("rejects a field-discriminant unit mismatch", () => {
  assertIssue(
    parseObservation(syntheticObservation({ field: "mileage", value: { amount: 1, unit: "kw" } })),
    "invalid_value",
    "$.value.unit",
  );
});

test("requires the CO2 standard", () => {
  assertIssue(
    parseObservation(syntheticObservation({ field: "co2", value: { amount: 1, unit: "g_per_km" } })),
    "missing_field",
    "$.value.standard",
  );
});

test("accepts exact UTC millisecond calendar timestamps", () => {
  for (const observedAt of ["0001-01-01T00:00:00.000Z", "2000-02-29T23:59:59.999Z", "9999-12-31T23:59:59.999Z"]) {
    assertSuccess(parseObservation(syntheticObservation({ provenance: syntheticProvenance({ observedAt }) })));
  }
});

test("rejects invalid timestamp forms and rollover dates", () => {
  for (const observedAt of [
    "2026-09-06T12:34:56Z",
    "2026-09-06T12:34:56.789+00:00",
    "2026-02-29T12:34:56.789Z",
    "2026-13-01T12:34:56.789Z",
    "2026-09-06T12:34:60.000Z",
    "2026-09-06",
  ]) {
    assertIssue(
      parseObservation(syntheticObservation({ provenance: syntheticProvenance({ observedAt }) })),
      "invalid_value",
      "$.provenance.observedAt",
    );
  }
});

test("requires source publication provenance", () => {
  const provenance = syntheticProvenance();
  delete provenance.sourceId;
  assertIssue(parseObservation(syntheticObservation({ provenance })), "missing_field", "$.provenance.sourceId");
});

test("rejects provenance source IDs from another runtime namespace", () => {
  const provenance = syntheticProvenance({ sourceId: "veh_wrong" });
  assertIssue(parseObservation(syntheticObservation({ provenance })), "invalid_value", "$.provenance.sourceId");
});

test("retains non-production legal states as evidence", () => {
  for (const legalStatus of ["restricted", "blocked", "unknown"]) {
    assertSuccess(parseObservation(syntheticObservation({ provenance: syntheticProvenance({ legalStatus }) })));
  }
});

test("rejects invented legal states", () => {
  assertIssue(
    parseObservation(syntheticObservation({ provenance: syntheticProvenance({ legalStatus: "probably_allowed" }) })),
    "invalid_value",
    "$.provenance.legalStatus",
  );
});

test("requires a lower-case SHA-256 raw reference digest", () => {
  for (const sha256 of [SYNTHETIC_DIGEST.toUpperCase(), "a".repeat(63), "g".repeat(64), `${SYNTHETIC_DIGEST}\n`]) {
    assertIssue(
      parseObservation(syntheticObservation({ provenance: syntheticProvenance({ raw: { sha256 } }) })),
      "invalid_value",
      "$.provenance.raw.sha256",
    );
  }
});

test("rejects raw-reference IDs from the wrong namespaces", () => {
  const provenance = syntheticProvenance({ raw: { snapshotId: "run_wrong" } });
  assertIssue(parseObservation(syntheticObservation({ provenance })), "invalid_value", "$.provenance.raw.snapshotId");
});

test("rejects connector-run IDs from the wrong namespace", () => {
  const provenance = syntheticProvenance({ raw: { connectorRunId: "raw_wrong" } });
  assertIssue(parseObservation(syntheticObservation({ provenance })), "invalid_value", "$.provenance.raw.connectorRunId");
});

test("does not retain nested caller references in observations", () => {
  const input = syntheticObservation();
  const parsed = assertSuccess(parseObservation(input));
  input.value.amountMinor = 1;
  input.provenance.raw.sha256 = "b".repeat(64);
  assert.equal(parsed.value.amountMinor, 4_250_000);
  assert.equal(parsed.provenance.raw.sha256, SYNTHETIC_DIGEST);
});

test("deep-freezes every nested observation object", () => {
  const parsed = assertSuccess(parseObservation(syntheticObservation()));
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.subject), true);
  assert.equal(Object.isFrozen(parsed.value), true);
  assert.equal(Object.isFrozen(parsed.provenance), true);
  assert.equal(Object.isFrozen(parsed.provenance.raw), true);
  assert.throws(() => {
    parsed.provenance.raw.sha256 = "b".repeat(64);
  }, TypeError);
});

test("round-trips a parsed observation through JSON", () => {
  const parsed = assertSuccess(parseObservation(syntheticObservation()));
  assert.deepEqual(assertSuccess(parseObservation(JSON.parse(JSON.stringify(parsed)))), parsed);
});
