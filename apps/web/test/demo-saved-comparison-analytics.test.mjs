import assert from "node:assert/strict";
import test from "node:test";

import { parseAnalyticsEvent, recordAnalyticsEvent } from "../.test-dist/src/demo/analytics.js";

test("saved-comparison analytics accept only the approved event, screen and outcome combinations", () => {
  const accepted = [
    { eventName: "saved_comparison_added", screen: "compare", outcome: "success" },
    { eventName: "saved_comparison_added", screen: "received-comparison", outcome: "success" },
    { eventName: "saved_comparison_opened", screen: "saved", outcome: "success" },
    { eventName: "saved_comparison_removed", screen: "saved", outcome: "success" },
    { eventName: "saved_comparison_undone", screen: "saved", outcome: "success" },
  ];

  for (const event of accepted) assert.deepEqual(parseAnalyticsEvent(event), event);

  assert.equal(parseAnalyticsEvent({ eventName: "saved_comparison_added", screen: "saved", outcome: "success" }), undefined);
  assert.equal(parseAnalyticsEvent({ eventName: "saved_comparison_added", screen: "compare", outcome: "error" }), undefined);
  assert.equal(parseAnalyticsEvent({ eventName: "saved_comparison_opened", screen: "compare", outcome: "success" }), undefined);
  assert.equal(parseAnalyticsEvent({ eventName: "saved_comparison_removed", screen: "saved", outcome: "error" }), undefined);
});

test("saved-comparison analytics reject names, fragments, identifiers and counts", () => {
  for (const forbidden of ["name", "fragment", "hash", "url", "listingId", "listingIds", "ids", "count", "payload", "message"]) {
    assert.equal(parseAnalyticsEvent({
      eventName: "saved_comparison_added",
      screen: "compare",
      outcome: "success",
      [forbidden]: "private",
    }), undefined);
  }
});

test("saved-comparison analytics remain collector-free and tolerate sink failure", () => {
  assert.equal(recordAnalyticsEvent({ eventName: "saved_comparison_opened", screen: "saved", outcome: "success" }), true);
  assert.equal(recordAnalyticsEvent(
    { eventName: "saved_comparison_removed", screen: "saved", outcome: "success" },
    () => { throw new Error("collector unavailable"); },
  ), true);
});
