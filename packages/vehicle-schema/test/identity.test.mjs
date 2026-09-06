import { test } from "node:test";

import { parseObservation } from "@auto-world/vehicle-schema";
import {
  SYNTHETIC_VIN,
  syntheticObservation,
  syntheticProvenance,
} from "./fixtures/synthetic.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

function fullVin(overrides = {}) {
  return {
    status: "full",
    vin: SYNTHETIC_VIN,
    accessPolicy: { visibility: "internal", policyRef: "synthetic-policy-1" },
    ...overrides,
  };
}

test("accepts syntactically valid full VIN evidence with internal policy and permitted provenance", () => {
  for (const legalStatus of ["official_api", "licensed_partner", "dealer_feed", "permitted_crawl"]) {
    const provenance = syntheticProvenance({ legalStatus });
    assertSuccess(parseObservation(syntheticObservation({ field: "vin", value: fullVin(), provenance })));
  }
});

test("rejects full VIN evidence under non-permitted legal states", () => {
  for (const legalStatus of ["restricted", "blocked", "unknown"]) {
    const provenance = syntheticProvenance({ legalStatus });
    assertIssue(
      parseObservation(syntheticObservation({ field: "vin", value: fullVin(), provenance })),
      "invalid_value",
      "$.provenance.legalStatus",
    );
  }
});

test("rejects malformed full VIN syntax", () => {
  for (const vin of ["SHORT", "SYNTHETIC12345678", "SYNTHET1C1234567I", "synthet1c12345678", "SYNTHET1C1234567Å", `${SYNTHETIC_VIN}\n`]) {
    assertIssue(
      parseObservation(syntheticObservation({ field: "vin", value: fullVin({ vin }) })),
      "invalid_value",
      "$.value.vin",
    );
  }
});

test("requires full VIN access policy provenance", () => {
  const value = fullVin();
  delete value.accessPolicy;
  assertIssue(parseObservation(syntheticObservation({ field: "vin", value })), "missing_field", "$.value.accessPolicy");
});

test("requires internal VIN visibility", () => {
  const value = fullVin({ accessPolicy: { visibility: "public", policyRef: "synthetic-policy-1" } });
  assertIssue(parseObservation(syntheticObservation({ field: "vin", value })), "invalid_value", "$.value.accessPolicy.visibility");
});

test("rejects secret-like policy reference text", () => {
  const value = fullVin({ accessPolicy: { visibility: "internal", policyRef: "Bearer synthetic secret" } });
  assertIssue(parseObservation(syntheticObservation({ field: "vin", value })), "invalid_value", "$.value.accessPolicy.policyRef");
});

test("rejects a trailing line terminator in a policy reference", () => {
  for (const policyRef of ["synthetic-policy\n", "synthetic-policy\r", "synthetic-policy\u2028"]) {
    const value = fullVin({ accessPolicy: { visibility: "internal", policyRef } });
    assertIssue(parseObservation(syntheticObservation({ field: "vin", value })), "invalid_value", "$.value.accessPolicy.policyRef");
  }
});

test("unavailable VIN evidence cannot carry a fabricated value", () => {
  assertIssue(
    parseObservation(syntheticObservation({ field: "vin", value: { status: "unavailable", vin: SYNTHETIC_VIN } })),
    "unknown_key",
    "$.value",
  );
});

test("withheld VIN evidence cannot carry access policy", () => {
  assertIssue(
    parseObservation(syntheticObservation({ field: "vin", value: { status: "withheld", accessPolicy: { visibility: "internal", policyRef: "synthetic-policy-1" } } })),
    "unknown_key",
    "$.value",
  );
});

test("validation issues never echo full VIN evidence", () => {
  const result = parseObservation(syntheticObservation({ field: "vin", value: fullVin({ unexpected: SYNTHETIC_VIN }) }));
  assertIssue(result, "unknown_key", "$.value");
});
