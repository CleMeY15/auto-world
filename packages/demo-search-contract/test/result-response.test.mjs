import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEMO_FRESHNESS_MS,
  parseDemoResult,
  parseDemoSearchResponse,
} from "@auto-world/demo-search-contract";
import {
  CURSOR,
  DATA_AS_OF,
  FRESH_AS_OF,
  MILEAGE_EVIDENCE_ID,
  PRICE_EVIDENCE_ID,
  STALE_AS_OF,
  clone,
  completeResponse,
  demoResult,
} from "./fixtures.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("accepts sanitized chronological evidence and freezes a detached result", () => {
  const input = demoResult();
  const parsed = assertSuccess(parseDemoResult(input));
  input.price.value.amountMinor = 1;
  input.evidence[0].value.amountMinor = 1;
  assert.equal(parsed.price.value.amountMinor, 1_234_500);
  assert.equal(parsed.evidence[0].value.amountMinor, 1_234_500);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.evidence), true);
  assert.equal(Object.isFrozen(parsed.evidence[0].value), true);
});

test("requires selected fields to reference the last evidence for that field", () => {
  const input = demoResult();
  input.evidence.push({
    evidenceId: `ev_${"d".repeat(64)}`,
    field: "price",
    observedAt: "2026-09-06T11:59:30.000Z",
    confidenceBps: 5_000,
    value: { amountMinor: 1_200_000, currency: "EUR" },
  });
  assertIssue(parseDemoResult(input), "invalid_value", "$.price");
});

test("requires unavailable exactly when no evidence exists for the field", () => {
  const valid = demoResult({
    mileage: { status: "unavailable" },
    evidence: [demoResult().evidence[0]],
  });
  assertSuccess(parseDemoResult(valid));
  assertIssue(
    parseDemoResult(demoResult({ price: { status: "unavailable" } })),
    "invalid_value",
    "$.price",
  );
});

test("retains contradictory evidence and accepts all availability states", () => {
  for (const availability of ["active", "withdrawn", "deleted", "missing"]) {
    const input = demoResult({ availability });
    input.evidence.splice(1, 0, {
      evidenceId: `ev_${"e".repeat(64)}`,
      field: "price",
      observedAt: "2026-09-06T11:58:30.000Z",
      confidenceBps: 4_000,
      value: { amountMinor: 9_999_999, currency: "USD" },
    });
    input.price = {
      status: "observed",
      value: { amountMinor: 9_999_999, currency: "USD" },
      evidenceId: `ev_${"e".repeat(64)}`,
    };
    assertSuccess(parseDemoResult(input));
  }
});

test("enforces evidence ID, confidence, chronology and per-result uniqueness bounds", () => {
  const duplicate = demoResult();
  duplicate.evidence[1].evidenceId = PRICE_EVIDENCE_ID;
  assertIssue(parseDemoResult(duplicate), "duplicate_id", "$.evidence[1].evidenceId");
  const reversed = demoResult();
  reversed.evidence.reverse();
  assertIssue(parseDemoResult(reversed), "invalid_value", "$.evidence[1].observedAt");
  const confidence = demoResult();
  confidence.evidence[0].confidenceBps = 10_001;
  assertIssue(parseDemoResult(confidence), "invalid_value", "$.evidence[0].confidenceBps");
  const tooMany = demoResult({ evidence: Array.from({ length: 257 }, () => demoResult().evidence[0]) });
  assertIssue(parseDemoResult(tooMany), "invalid_value", "$.evidence");
});

test("rejects internal or unapproved public fields at their schema boundary", () => {
  for (const field of ["sourceId", "sourceListingId", "runId", "snapshotId", "sha256", "vin", "url", "seller", "make", "photo"]) {
    assertIssue(parseDemoResult({ ...demoResult(), [field]: "synthetic-secret" }), "unknown_key", "$");
  }
});

test("accepts a fresh complete response at the inclusive freshness boundary", () => {
  assert.equal(DEMO_FRESHNESS_MS, 60_000);
  assert.deepEqual(assertSuccess(parseDemoSearchResponse(completeResponse(), FRESH_AS_OF)), completeResponse());
});

test("enforces complete, partial and stale state-specific fields", () => {
  const partial = completeResponse({ state: "partial", reason: "projection_incomplete" });
  delete partial.totalCount;
  assertSuccess(parseDemoSearchResponse(partial, FRESH_AS_OF));
  const stale = completeResponse({ state: "stale", reason: "projection_stale" });
  delete stale.totalCount;
  assertSuccess(parseDemoSearchResponse(stale, STALE_AS_OF));
  assertIssue(parseDemoSearchResponse(completeResponse(), STALE_AS_OF), "invalid_value", "$.state");
  assertIssue(parseDemoSearchResponse(stale, FRESH_AS_OF), "invalid_value", "$.state");
  assertIssue(parseDemoSearchResponse(partial, STALE_AS_OF), "invalid_value", "$.state");
});

test("rejects future watermarks, malformed explicit clocks and evidence after the watermark", () => {
  assertIssue(parseDemoSearchResponse(completeResponse(), "2026-09-06T11:59:59.999Z"), "invalid_value", "$.dataAsOf");
  assertIssue(parseDemoSearchResponse(completeResponse(), "2026-02-30T00:00:00.000Z"), "invalid_value", "$.asOf");
  const futureEvidence = completeResponse();
  futureEvidence.results[0].evidence[1].observedAt = "2026-09-06T12:00:00.001Z";
  assertIssue(parseDemoSearchResponse(futureEvidence, FRESH_AS_OF), "invalid_value", "$.results[0].evidence[1].observedAt");
});

test("enforces response result, evidence and count uniqueness bounds", () => {
  const duplicateListing = completeResponse({ results: [demoResult(), demoResult()], totalCount: 2 });
  assertIssue(parseDemoSearchResponse(duplicateListing, FRESH_AS_OF), "duplicate_id", "$.results[1].listingId");
  const second = demoResult({ listingId: "lst_second" });
  const duplicateEvidence = completeResponse({ results: [demoResult(), second], totalCount: 2 });
  assertIssue(parseDemoSearchResponse(duplicateEvidence, FRESH_AS_OF), "duplicate_id", "$.results[1].evidence[0].evidenceId");
  assertIssue(parseDemoSearchResponse(completeResponse({ totalCount: 10_001 }), FRESH_AS_OF), "invalid_value", "$.totalCount");
  assertIssue(parseDemoSearchResponse(completeResponse({ results: Array.from({ length: 21 }, (_, index) => demoResult({ listingId: `lst_${index}` })), totalCount: 21 }), FRESH_AS_OF), "invalid_value", "$.results");
});

test("checks only necessary cursor shape and state conditions", () => {
  assertIssue(parseDemoSearchResponse(completeResponse({ results: [], totalCount: 1, nextCursor: CURSOR }), FRESH_AS_OF), "invalid_value", "$.nextCursor");
  assertIssue(parseDemoSearchResponse(completeResponse({ nextCursor: CURSOR }), FRESH_AS_OF), "invalid_value", "$.nextCursor");
  assertSuccess(parseDemoSearchResponse(completeResponse({ totalCount: 2, nextCursor: CURSOR }), FRESH_AS_OF));
});

test("rejects forbidden state keys without leaking their input values", () => {
  const secret = "synthetic-secret-value";
  const response = completeResponse({ state: "partial", reason: "projection_incomplete", totalCount: 1, [secret]: secret });
  const parsed = parseDemoSearchResponse(response, FRESH_AS_OF);
  assertIssue(parsed, "unknown_key", "$");
  assert.equal(JSON.stringify(parsed).includes(secret), false);
});

test("round-trips successful response data without retaining input references", () => {
  const input = completeResponse();
  const parsed = assertSuccess(parseDemoSearchResponse(input, FRESH_AS_OF));
  const roundTrip = assertSuccess(parseDemoSearchResponse(clone(parsed), FRESH_AS_OF));
  assert.deepEqual(roundTrip, parsed);
  input.results[0].evidence[0].value.amountMinor = 1;
  assert.equal(parsed.results[0].evidence[0].value.amountMinor, 1_234_500);
  assert.equal(Object.isFrozen(parsed.results), true);
});

test("fixture and opaque token grammars stay narrow", () => {
  assertIssue(parseDemoSearchResponse(completeResponse({ fixtureVersion: " synthetic-search-v1" }), FRESH_AS_OF), "invalid_value", "$.fixtureVersion");
  assertIssue(parseDemoSearchResponse(completeResponse({ nextCursor: `cur_${"C".repeat(64)}`, totalCount: 2 }), FRESH_AS_OF), "invalid_value", "$.nextCursor");
  const invalidEvidence = demoResult();
  invalidEvidence.evidence[0].evidenceId = `ev_${"A".repeat(64)}`;
  assertIssue(parseDemoResult(invalidEvidence), "invalid_value", "$.evidence[0].evidenceId");
  assert.equal(MILEAGE_EVIDENCE_ID.startsWith("ev_"), true);
  assert.equal(DATA_AS_OF.length, 24);
});
