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

test("publication-link analytics accept only the approved detail event envelope", () => {
  const accepted = [
    { eventName: "listing_link_created", screen: "detail", outcome: "success" },
    { eventName: "listing_link_created", screen: "detail", outcome: "error" },
    { eventName: "listing_link_copied", screen: "detail", outcome: "success" },
    { eventName: "listing_link_copied", screen: "detail", outcome: "error" },
  ];
  for (const event of accepted) assert.deepEqual(parseAnalyticsEvent(event), event);

  assert.equal(parseAnalyticsEvent({ eventName: "listing_link_loaded", screen: "detail", outcome: "success" }), undefined);
  assert.equal(parseAnalyticsEvent({ eventName: "listing_link_created", screen: "results", outcome: "success" }), undefined);
  for (const eventName of ["listing_link_created", "listing_link_copied"]) {
    for (const outcome of ["empty", "offline", "partial", "stale"]) {
      assert.equal(parseAnalyticsEvent({ eventName, screen: "detail", outcome }), undefined);
    }
  }
});

test("publication-link analytics reject URLs, publication identifiers and free-form context", () => {
  for (const forbidden of ["url", "origin", "href", "hash", "message", "error", "name", "freeform", "fixtureVersion", "listingId", "vehicleId", "sourceId"]) {
    assert.equal(parseAnalyticsEvent({
      eventName: "listing_link_created",
      screen: "detail",
      outcome: "success",
      [forbidden]: "private",
    }), undefined);
  }
});

test("publication-link analytics remain collector-free and tolerate sink failure", () => {
  assert.equal(recordAnalyticsEvent({ eventName: "listing_link_created", screen: "detail", outcome: "success" }), true);
  assert.equal(recordAnalyticsEvent(
    { eventName: "listing_link_copied", screen: "detail", outcome: "error" },
    () => { throw new Error("collector unavailable"); },
  ), true);
});
