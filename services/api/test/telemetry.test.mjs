import assert from "node:assert/strict";
import test from "node:test";
import { createDemoApi } from "../dist/index.js";

const NOW = "2026-10-11T22:00:00.000Z";
const HOST = "127.0.0.1:3210";
const cleanData = {
  schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "fixture-v1", dataAsOf: NOW, state: "complete",
  results: [], totalCount: 0,
};

test("telemetry is bounded, redacted, counted and sink failures cannot change responses", async () => {
  const events = [];
  const telemetry = {
    metric(event) { events.push(event); },
    log(event) { events.push(event); },
    span(event) { events.push(event); },
    alert(event) { events.push(event); throw new Error("sink failure"); },
  };
  const app = createDemoApi({
    readPort: { async search() { throw new Error("VIN SECRET raw payload cursor source-id"); }, async getListing() { return { success: true, data: cleanData }; } },
    clock: () => new Date(NOW), requestIds: () => "req_11111111111111111111111111111111", telemetry,
  });
  const reply = await app.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: { schemaVersion: 1, sort: "listing_asc", priceMaxMinor: 123456 } });
  assert.equal(reply.statusCode, 503);
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /VIN|SECRET|raw payload|cursor|source-id|123456/u);
  assert.equal(events.filter((event) => event.name === "api_requests_total").length, 1);
  assert.equal(events.filter((event) => event.name === "api_errors_total").length, 1);
  assert.equal(events.filter((event) => event.name === "api_request_duration_ms").length, 1);
  assert.equal(events.filter((event) => event.name === "api.search").length, 1);
  assert.equal(events.filter((event) => event.name === "read_port.query").length, 1);
  assert.equal(events.filter((event) => event.name === "api.failure").length, 1);
  for (const event of events) {
    const allowed = event.name === "api_requests_total" || event.name === "api_request_duration_ms" ? ["labels", "name", "value"]
      : event.name === "api_errors_total" ? ["labels", "name", "value"]
      : event.name === "api.failure" ? ["code", "name", "route", "status"]
      : ["durationMs", "name", "requestId", "route", "status", ...(event.code === undefined ? [] : ["code"])];
    assert.deepEqual(Object.keys(event).sort(), allowed.sort());
    if (event.name === "api_requests_total" || event.name === "api_request_duration_ms") {
      assert.deepEqual(event.labels, { route: "/v1/demo/search", status: "503" });
    }
    if (event.name === "api_errors_total") assert.deepEqual(event.labels, { code: "read_unavailable" });
  }
  await app.close();
});

test("malformed success DTOs terminate read-port telemetry as 503", async () => {
  const spans = [];
  const app = createDemoApi({
    readPort: { async search() { return { success: true, data: { ...cleanData, results: [{ availability: "active" }] } }; }, async getListing() { return { success: true, data: cleanData }; } },
    clock: () => new Date(NOW), telemetry: { span(event) { spans.push(event); } },
  });
  const reply = await app.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: { schemaVersion: 1, sort: "listing_asc" } });
  assert.equal(reply.statusCode, 503);
  assert.deepEqual(spans.find((event) => event.name === "read_port.query"), {
    name: "read_port.query", requestId: JSON.parse(reply.body).requestId, route: "/v1/demo/search", status: 503, durationMs: 0, code: "read_unavailable",
  });
  await app.close();
});

test("route-specific egress violations terminate read-port telemetry as 503", async () => {
  const listingId = "lst_synthetic_publication";
  const publicResult = { listingId, availability: "withdrawn", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [] };
  const scenarios = [
    {
      method: "POST", url: "/v1/demo/search", payload: { schemaVersion: 1, sort: "listing_asc" },
      port: { async search() { return { success: true, data: { ...cleanData, results: [publicResult], totalCount: 1 } }; }, async getListing() { return { success: true, data: cleanData }; } },
    },
    {
      method: "GET", url: `/v1/demo/listings/${listingId}`,
      port: { async search() { return { success: true, data: cleanData }; }, async getListing() { return { success: true, data: { ...cleanData, results: [publicResult], totalCount: 2, nextCursor: `cur_${"a".repeat(64)}` } }; } },
    },
  ];
  for (const scenario of scenarios) {
    const spans = [];
    const app = createDemoApi({ readPort: scenario.port, clock: () => new Date(NOW), telemetry: { span(event) { spans.push(event); } } });
    const reply = await app.inject({ method: scenario.method, url: scenario.url, headers: { host: HOST, ...(scenario.payload === undefined ? {} : { "content-type": "application/json" }) }, ...(scenario.payload === undefined ? {} : { payload: scenario.payload }) });
    assert.equal(reply.statusCode, 503);
    const terminal = spans.find((event) => event.name === "read_port.query");
    assert.equal(terminal.status, 503);
    assert.equal(terminal.code, "read_unavailable");
    await app.close();
  }
});
