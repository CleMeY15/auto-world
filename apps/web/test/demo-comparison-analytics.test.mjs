import assert from "node:assert/strict";
import test from "node:test";

import { parseAnalyticsEvent, recordAnalyticsEvent } from "../.test-dist/src/demo/analytics.js";

test("comparison analytics extend only the closed public envelope", () => {
  for (const eventName of ["comparison_added", "comparison_removed", "comparison_opened"]) {
    assert.deepEqual(parseAnalyticsEvent({ eventName, screen: "compare", outcome: "success" }), {
      eventName,
      screen: "compare",
      outcome: "success",
    });
  }

  for (const forbidden of ["listingId", "ids", "values", "query", "count", "currency", "unit"]) {
    assert.equal(parseAnalyticsEvent({
      eventName: "comparison_added",
      screen: "results",
      outcome: "success",
      [forbidden]: "private",
    }), undefined);
  }
  assert.equal(parseAnalyticsEvent({ eventName: "comparison_ranked", screen: "compare", outcome: "success" }), undefined);
});

test("comparison analytics remain collector-free and tolerate sink failure", () => {
  assert.equal(recordAnalyticsEvent({ eventName: "comparison_opened", screen: "compare", outcome: "success" }), true);
  assert.equal(recordAnalyticsEvent(
    { eventName: "comparison_removed", screen: "compare", outcome: "success" },
    () => { throw new Error("collector unavailable"); },
  ), true);
});
