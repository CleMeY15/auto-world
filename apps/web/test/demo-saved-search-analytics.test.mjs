import assert from "node:assert/strict";
import test from "node:test";

import { parseAnalyticsEvent, recordAnalyticsEvent } from "../.test-dist/src/demo/analytics.js";

test("saved-search analytics accept only the closed event envelope", () => {
  const names = ["saved_search_added", "saved_search_restored", "saved_search_removed", "saved_search_undone"];
  for (const eventName of names) {
    assert.deepEqual(parseAnalyticsEvent({ eventName, screen: "saved", outcome: "success" }), { eventName, screen: "saved", outcome: "success" });
  }

  for (const forbidden of ["name", "query", "binding", "cursor", "listingId", "results"]) {
    assert.equal(parseAnalyticsEvent({ eventName: "saved_search_added", screen: "results", outcome: "success", [forbidden]: "private" }), undefined);
  }
});

test("saved-search analytics remain collector-free by default", () => {
  assert.equal(recordAnalyticsEvent({ eventName: "saved_search_added", screen: "results", outcome: "success" }), true);
});
