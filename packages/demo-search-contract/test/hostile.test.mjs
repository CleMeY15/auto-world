import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseDemoResult,
  parseDemoSearchQuery,
  parseDemoSearchResponse,
} from "@auto-world/demo-search-contract";
import { FRESH_AS_OF, completeResponse, demoQuery, demoResult } from "./fixtures.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("accepts null-prototype records when their values are valid", () => {
  const input = Object.assign(Object.create(null), demoQuery());
  assert.deepEqual(assertSuccess(parseDemoSearchQuery(input)), demoQuery());
});

test("rejects class instances, symbols and non-enumerable keys", () => {
  class QueryInput {
    constructor() {
      Object.assign(this, demoQuery());
    }
  }
  assertIssue(parseDemoSearchQuery(new QueryInput()), "invalid_object", "$");
  const symbol = demoQuery();
  symbol[Symbol("hidden")] = true;
  assertIssue(parseDemoSearchQuery(symbol), "unknown_key", "$");
  const hidden = demoQuery();
  Object.defineProperty(hidden, "hidden", { value: true });
  assertIssue(parseDemoSearchQuery(hidden), "unknown_key", "$");
});

test("rejects accessors without invoking them at root and nested boundaries", () => {
  let calls = 0;
  const query = demoQuery();
  Object.defineProperty(query, "sort", {
    enumerable: true,
    get() {
      calls += 1;
      return "listing_asc";
    },
  });
  assertIssue(parseDemoSearchQuery(query), "invalid_object", "$");
  const result = demoResult();
  Object.defineProperty(result.price.value, "amountMinor", {
    enumerable: true,
    get() {
      calls += 1;
      return 1;
    },
  });
  assertIssue(parseDemoResult(result), "invalid_object", "$.price.value");
  assert.equal(calls, 0);
});

test("rejects sparse, augmented and custom-prototype arrays", () => {
  const sparse = completeResponse({ results: [demoResult(), demoResult({ listingId: "lst_second" })], totalCount: 2 });
  delete sparse.results[1];
  assertIssue(parseDemoSearchResponse(sparse, FRESH_AS_OF), "invalid_object", "$.results");
  const augmented = completeResponse();
  augmented.results.extra = true;
  assertIssue(parseDemoSearchResponse(augmented, FRESH_AS_OF), "invalid_object", "$.results");
  const custom = completeResponse();
  Object.setPrototypeOf(custom.results, { synthetic: true });
  assertIssue(parseDemoSearchResponse(custom, FRESH_AS_OF), "invalid_object", "$.results");
});

test("sanitizes hostile reflection failures and revoked proxies", () => {
  const secret = "synthetic-secret-value";
  const hostile = new Proxy(demoQuery(), {
    ownKeys() {
      throw new Error(secret);
    },
  });
  const hostileResult = parseDemoSearchQuery(hostile);
  assertIssue(hostileResult, "invalid_object", "$");
  assert.equal(JSON.stringify(hostileResult).includes(secret), false);
  const { proxy, revoke } = Proxy.revocable(completeResponse(), {});
  revoke();
  assertIssue(parseDemoSearchResponse(proxy, FRESH_AS_OF), "invalid_object", "$");
});

test("rejects inherited and parsed prototype-pollution keys", () => {
  const inherited = Object.assign(Object.create({ polluted: true }), demoQuery());
  assertIssue(parseDemoSearchQuery(inherited), "invalid_object", "$");
  const poison = JSON.parse('{"__proto__":{"polluted":true}}');
  assertIssue(parseDemoResult({ ...demoResult(), ...poison }), "unknown_key", "$");
  assert.equal(({}).polluted, undefined);
});
