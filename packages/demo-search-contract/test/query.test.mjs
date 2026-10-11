import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEMO_PAGE_SIZE,
  parseDemoSearchQuery,
} from "@auto-world/demo-search-contract";
import { CURSOR, demoQuery } from "./fixtures.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("accepts the closed V1 query vocabulary without defaults", () => {
  assert.equal(DEMO_PAGE_SIZE, 20);
  for (const sort of ["listing_asc", "price_asc", "price_desc", "mileage_asc", "mileage_desc"]) {
    const input = demoQuery({ sort, priceMaxMinor: 0, mileageMaxKm: 0, cursor: CURSOR });
    assert.deepEqual(assertSuccess(parseDemoSearchQuery(input)), input);
  }
});

test("accepts fractional finite kilometre maxima but only integer EUR cents", () => {
  assertSuccess(parseDemoSearchQuery(demoQuery({ mileageMaxKm: 1.5 })));
  assertIssue(parseDemoSearchQuery(demoQuery({ priceMaxMinor: 1.5 })), "invalid_value", "$.priceMaxMinor");
});

test("rejects coercion, negative zero, out-of-range values and unsupported versions", () => {
  assertIssue(parseDemoSearchQuery(demoQuery({ schemaVersion: 2 })), "unsupported_version", "$.schemaVersion");
  assertIssue(parseDemoSearchQuery(demoQuery({ schemaVersion: "1" })), "invalid_type", "$.schemaVersion");
  assertIssue(parseDemoSearchQuery(demoQuery({ priceMaxMinor: -0 })), "invalid_value", "$.priceMaxMinor");
  assertIssue(parseDemoSearchQuery(demoQuery({ mileageMaxKm: Infinity })), "invalid_value", "$.mileageMaxKm");
  assertIssue(parseDemoSearchQuery(demoQuery({ mileageMaxKm: Number.MAX_SAFE_INTEGER + 1 })), "invalid_value", "$.mileageMaxKm");
});

test("rejects natural language, unsupported sorts and malformed cursors", () => {
  assertIssue(parseDemoSearchQuery({ ...demoQuery(), text: "find a bargain" }), "unknown_key", "$");
  assertIssue(parseDemoSearchQuery(demoQuery({ sort: "recommended" })), "invalid_value", "$.sort");
  assertIssue(parseDemoSearchQuery(demoQuery({ cursor: `cur_${"A".repeat(64)}` })), "invalid_value", "$.cursor");
});

test("returns a detached deeply frozen query", () => {
  const input = demoQuery({ priceMaxMinor: 100 });
  const parsed = assertSuccess(parseDemoSearchQuery(input));
  input.priceMaxMinor = 200;
  assert.equal(parsed.priceMaxMinor, 100);
  assert.equal(Object.isFrozen(parsed), true);
  assert.throws(() => {
    parsed.sort = "price_desc";
  }, TypeError);
});
