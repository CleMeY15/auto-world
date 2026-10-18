import assert from "node:assert/strict";
import test from "node:test";

import { parseAnalyticsEvent, recordAnalyticsEvent } from "../.test-dist/src/demo/analytics.js";

test("search-link analytics accept only the approved event and screen vocabulary", () => {
  const accepted = [
    { eventName: "search_link_created", screen: "results", outcome: "success" },
    { eventName: "search_link_copied", screen: "results", outcome: "success" },
    { eventName: "search_link_copied", screen: "results", outcome: "error" },
    { eventName: "search_link_loaded", screen: "shared", outcome: "success" },
  ];
  for (const event of accepted) assert.deepEqual(parseAnalyticsEvent(event), event);

  assert.equal(parseAnalyticsEvent({ eventName: "search_link_opened", screen: "shared", outcome: "success" }), undefined);
  assert.equal(parseAnalyticsEvent({ eventName: "search_link_loaded", screen: "received", outcome: "success" }), undefined);
});

test("search-link analytics reject URL, criteria, origin, identifiers and free-form context", () => {
  for (const forbidden of ["url", "query", "criteria", "binding", "origin", "href", "hash", "message", "error", "name", "freeform", "fixtureVersion", "makeId", "modelId", "listingId"]) {
    assert.equal(parseAnalyticsEvent({
      eventName: "search_link_created",
      screen: "results",
      outcome: "success",
      [forbidden]: "private",
    }), undefined);
  }
});

test("search-link analytics remain collector-free and tolerate sink failure", () => {
  assert.equal(recordAnalyticsEvent({ eventName: "search_link_created", screen: "results", outcome: "success" }), true);
  assert.equal(recordAnalyticsEvent(
    { eventName: "search_link_copied", screen: "results", outcome: "error" },
    () => { throw new Error("collector unavailable"); },
  ), true);
});
