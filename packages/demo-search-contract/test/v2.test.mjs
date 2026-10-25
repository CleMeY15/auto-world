import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseDemoCatalogResponseV2,
  parseDemoResultV2,
  parseDemoSearchQueryV2,
  parseDemoSearchResponseV2,
} from "@auto-world/demo-search-contract";
import { FRESH_AS_OF } from "./fixtures.mjs";
import {
  DESCRIPTION_EVIDENCE_ID,
  MAKE_ID,
  MODEL_ID,
  TAXONOMY_RELEASE_REFERENCE,
  catalogResponse,
  completeResponseV2,
  demoResultV2,
  descriptionValue,
} from "./fixtures-v2.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("accepts exact V2 filters and requires a make for a model", () => {
  const query = {
    schemaVersion: 2,
    sort: "listing_asc",
    priceMaxMinor: 0,
    mileageMaxKm: 1.5,
    makeId: MAKE_ID,
    modelId: MODEL_ID,
    firstRegistrationYear: 1886,
    cursor: `cur_${"c".repeat(64)}`,
  };
  assert.deepEqual(assertSuccess(parseDemoSearchQueryV2(query)), query);
  assertIssue(
    parseDemoSearchQueryV2({ schemaVersion: 2, sort: "listing_asc", modelId: MODEL_ID }),
    "missing_field",
    "$.makeId",
  );
  assertIssue(
    parseDemoSearchQueryV2({ schemaVersion: 2, sort: "listing_asc", firstRegistrationYear: 1885 }),
    "invalid_value",
    "$.firstRegistrationYear",
  );
  assertIssue(
    parseDemoSearchQueryV2({ schemaVersion: 2, sort: "listing_asc", makeId: "make_" }),
    "invalid_value",
    "$.makeId",
  );
  assertIssue(
    parseDemoSearchQueryV2({ schemaVersion: 1, sort: "listing_asc" }),
    "unsupported_version",
    "$.schemaVersion",
  );
  assertIssue(
    parseDemoSearchQueryV2({ schemaVersion: 3, sort: "listing_asc" }),
    "unsupported_version",
    "$.schemaVersion",
  );
});

test("parses atomic authored descriptions and preserves unavailable history", () => {
  const parsed = assertSuccess(parseDemoResultV2(demoResultV2()));
  assert.equal(parsed.description.status, "authored_synthetic");
  assert.equal(Object.isFrozen(parsed.descriptionEvidence[0].value.release), true);

  assertSuccess(parseDemoResultV2(demoResultV2({ description: { status: "unavailable" } })));
  assertIssue(
    parseDemoResultV2(demoResultV2({
      description: {
        status: "authored_synthetic",
        value: descriptionValue({ firstRegistrationYear: undefined }),
        evidenceId: DESCRIPTION_EVIDENCE_ID,
      },
    })),
    "invalid_type",
    "$.description.value.firstRegistrationYear",
  );
});

test("requires selected description membership, chronological unique evidence and strict IDs", () => {
  const missing = demoResultV2();
  missing.description.evidenceId = `de_${"e".repeat(64)}`;
  assertIssue(parseDemoResultV2(missing), "invalid_value", "$.description");

  const duplicate = demoResultV2();
  duplicate.descriptionEvidence.push({ ...duplicate.descriptionEvidence[0] });
  assertIssue(parseDemoResultV2(duplicate), "duplicate_id", "$.descriptionEvidence[1].evidenceId");

  const malformed = demoResultV2();
  malformed.descriptionEvidence[0].evidenceId = `de_${"A".repeat(64)}`;
  assertIssue(parseDemoResultV2(malformed), "invalid_value", "$.descriptionEvidence[0].evidenceId");
});

test("binds every public description to the response release and page-wide evidence budget", () => {
  assertSuccess(parseDemoSearchResponseV2(completeResponseV2(), FRESH_AS_OF));
  const mismatch = completeResponseV2();
  mismatch.results[0].description.value.release.revision = 2;
  mismatch.results[0].descriptionEvidence[0].value.release.revision = 2;
  assertIssue(
    parseDemoSearchResponseV2(mismatch, FRESH_AS_OF),
    "invalid_value",
    "$.results[0].description.value.release",
  );

  const second = demoResultV2({ listingId: "lst_second" });
  second.evidence[0].evidenceId = `ev_${"e".repeat(64)}`;
  second.evidence[1].evidenceId = `ev_${"f".repeat(64)}`;
  second.price.evidenceId = second.evidence[0].evidenceId;
  second.mileage.evidenceId = second.evidence[1].evidenceId;
  const duplicate = completeResponseV2({
    results: [demoResultV2(), second],
    totalCount: 2,
  });
  assertIssue(
    parseDemoSearchResponseV2(duplicate, FRESH_AS_OF),
    "duplicate_id",
    "$.results[1].descriptionEvidence[0].evidenceId",
  );

  const evidence = (count, start) => Array.from({ length: count }, (_, index) => ({
    evidenceId: `de_${(start + index).toString(16).padStart(64, "0")}`,
    capturedAt: "2026-09-06T11:57:00.000Z",
    value: descriptionValue(),
  }));
  const firstOverBudget = demoResultV2({
    description: { status: "unavailable" },
    descriptionEvidence: evidence(128, 1),
  });
  const secondOverBudget = demoResultV2({
    listingId: "lst_second_budget",
    description: { status: "unavailable" },
    descriptionEvidence: evidence(129, 129),
  });
  secondOverBudget.evidence[0].evidenceId = `ev_${"e".repeat(64)}`;
  secondOverBudget.evidence[1].evidenceId = `ev_${"f".repeat(64)}`;
  secondOverBudget.price.evidenceId = secondOverBudget.evidence[0].evidenceId;
  secondOverBudget.mileage.evidenceId = secondOverBudget.evidence[1].evidenceId;
  assertIssue(
    parseDemoSearchResponseV2(completeResponseV2({
      results: [firstOverBudget, secondOverBudget],
      totalCount: 2,
    }), FRESH_AS_OF),
    "invalid_value",
    "$.results",
  );
});

test("parses a full detached taxonomy catalog and rejects hidden or extra authority", () => {
  const input = catalogResponse();
  const parsed = assertSuccess(parseDemoCatalogResponseV2(input));
  input.taxonomyRelease.makes[0].primaryName.value = "mutated";
  assert.equal(parsed.taxonomyRelease.makes[0].primaryName.value, "AW Fixture Alpha");
  assert.equal(Object.isFrozen(parsed.taxonomyRelease.models), true);

  assertIssue(
    parseDemoCatalogResponseV2({ ...catalogResponse(), sourceId: "secret" }),
    "unknown_key",
    "$",
  );
});

test("rejects hostile V2 accessors without invoking them", () => {
  let calls = 0;
  const input = demoResultV2();
  Object.defineProperty(input.description.value, "modelId", {
    enumerable: true,
    get() {
      calls += 1;
      return MODEL_ID;
    },
  });
  assertIssue(parseDemoResultV2(input), "invalid_object", "$.description.value");
  assert.equal(calls, 0);
  assert.deepEqual(TAXONOMY_RELEASE_REFERENCE, {
    catalogId: "taxcat_aw_fixture",
    releaseId: "taxrel_aw_fixture_v1",
    revision: 1,
  });
});

test("keeps nested response diagnostics closed and rejects future description evidence", () => {
  const missing = completeResponseV2();
  delete missing.results[0].price;
  assertIssue(
    parseDemoSearchResponseV2(missing, FRESH_AS_OF),
    "missing_field",
    "$.results[0].price",
  );

  const future = completeResponseV2();
  future.results[0].descriptionEvidence[0].capturedAt = "2026-09-06T12:00:00.001Z";
  assertIssue(
    parseDemoSearchResponseV2(future, FRESH_AS_OF),
    "invalid_value",
    "$.results[0].descriptionEvidence[0].capturedAt",
  );

  assertIssue(
    parseDemoResultV2({ ...demoResultV2(), sourceListingId: "hidden" }),
    "unknown_key",
    "$",
  );
});
