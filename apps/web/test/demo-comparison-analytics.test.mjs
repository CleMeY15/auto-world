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

test("comparison-link analytics accept only the approved event, screen and outcome combinations", () => {
  const accepted = [
    { eventName: "comparison_link_created", screen: "compare", outcome: "success" },
    { eventName: "comparison_link_created", screen: "compare", outcome: "error" },
    { eventName: "comparison_link_copied", screen: "compare", outcome: "success" },
    { eventName: "comparison_link_copied", screen: "compare", outcome: "error" },
    { eventName: "comparison_link_loaded", screen: "received-comparison", outcome: "success" },
    { eventName: "comparison_link_loaded", screen: "received-comparison", outcome: "error" },
  ];
  for (const event of accepted) assert.deepEqual(parseAnalyticsEvent(event), event);

  assert.equal(parseAnalyticsEvent({ eventName: "comparison_link_created", screen: "results", outcome: "success" }), undefined);
  assert.equal(parseAnalyticsEvent({ eventName: "comparison_link_loaded", screen: "compare", outcome: "success" }), undefined);
  assert.equal(parseAnalyticsEvent({ eventName: "comparison_link_loaded", screen: "received-comparison", outcome: "offline" }), undefined);
});

test("comparison-link analytics reject URLs, identifiers, payloads and free-form errors", () => {
  for (const forbidden of ["url", "origin", "href", "hash", "listingId", "listingIds", "ids", "payload", "message", "error", "name", "freeform"]) {
    assert.equal(parseAnalyticsEvent({
      eventName: "comparison_link_created",
      screen: "compare",
      outcome: "success",
      [forbidden]: "private",
    }), undefined);
  }
});

test("comparison analytics remain collector-free and tolerate sink failure", () => {
  assert.equal(recordAnalyticsEvent({ eventName: "comparison_opened", screen: "compare", outcome: "success" }), true);
  assert.equal(recordAnalyticsEvent(
    { eventName: "comparison_removed", screen: "compare", outcome: "success" },
    () => { throw new Error("collector unavailable"); },
  ), true);
});
