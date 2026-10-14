/* global AbortController, DOMException, ReadableStream, Request, Response, TextDecoder */
import assert from "node:assert/strict";
import test from "node:test";
import { recordAnalyticsEvent } from "../.test-dist/src/demo/analytics.js";
import { createDemoClient, createDemoClientV2 } from "../.test-dist/src/demo/client.js";
import { parseDemoCatalogHttpOutcomeV2, parseDemoHttpOutcome, parseDemoHttpOutcomeV2 } from "../.test-dist/src/demo/protocol.js";
import { createDemoProxyHandler, formatDemoProxyTelemetry } from "../.test-dist/src/demo/proxy.js";

const NOW = "2026-10-12T08:00:00.000Z";
const ID = "lst_demo_publication";
const REQUEST_ID = "req_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function result(overrides = {}) { return { listingId: ID, availability: "active", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [], ...overrides }; }
function data(overrides = {}) { return { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "fixture-v1", dataAsOf: NOW, state: "complete", results: [result()], totalCount: 1, ...overrides }; }
function envelope(overrides = {}) { return JSON.stringify({ schemaVersion: 1, requestId: REQUEST_ID, data: data(overrides) }); }
const release = { catalogId: "taxcat_fixture", releaseId: "taxrel_fixture", revision: 1 };
function v2Result(overrides = {}) { return { ...result(), description: { status: "unavailable" }, descriptionEvidence: [], ...overrides }; }
function v2Data(overrides = {}) { return { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: "fixture-v2", taxonomyRelease: release, dataAsOf: NOW, state: "complete", results: [v2Result()], totalCount: 1, ...overrides }; }
function v2Envelope(overrides = {}) { return JSON.stringify({ schemaVersion: 2, requestId: REQUEST_ID, data: v2Data(overrides) }); }
function catalogEnvelope() { return JSON.stringify({ schemaVersion: 2, requestId: REQUEST_ID, data: { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: "fixture-v2", taxonomyRelease: { schemaVersion: 1, ...release, releasedAt: NOW, dataMode: "synthetic", attributions: [{ attributionId: "taxattr_fixture", kind: "synthetic_fixture", fixtureRef: "fixture" }], makes: [{ makeId: "make_fixture", primaryName: { value: "Marque UI fictive", attributionId: "taxattr_fixture" }, aliases: [] }], models: [{ modelId: "model_fixture", makeId: "make_fixture", primaryName: { value: "Modèle UI fictif", attributionId: "taxattr_fixture" }, aliases: [] }] } } }); }
function request(path, init = {}) { const { headers, ...rest } = init; return new Request(`http://127.0.0.1:3107${path}`, { ...rest, headers: { host: "127.0.0.1:3107", ...headers } }); }
function apiResponse(body, status = 200, headers = {}) { return new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } }); }

test("closed HTTP parser validates wrappers, status, temporal DTO and detail identity", () => {
  assert.equal(parseDemoHttpOutcome(envelope(), 200, NOW).ok, true);
  assert.equal(parseDemoHttpOutcome(envelope(), 200, NOW, ID).ok, true);
  assert.equal(parseDemoHttpOutcome(envelope({ results: [result({ listingId: "lst_other" })] }), 200, NOW, ID), undefined);
  assert.equal(parseDemoHttpOutcome('{"schemaVersion":1,"requestId":"req_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","requestId":"req_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","data":{}}', 200, NOW), undefined);
  assert.equal(parseDemoHttpOutcome(JSON.stringify({ schemaVersion: 1, requestId: REQUEST_ID, error: { code: "not_found" } }), 503, NOW), undefined);
});

test("closed V2 parsers distinguish catalog and result envelopes", () => {
  assert.equal(parseDemoHttpOutcomeV2(v2Envelope(), 200, NOW).ok, true);
  assert.equal(parseDemoHttpOutcomeV2(v2Envelope(), 200, NOW, ID).ok, true);
  assert.equal(parseDemoCatalogHttpOutcomeV2(catalogEnvelope(), 200).ok, true);
  assert.equal(parseDemoCatalogHttpOutcomeV2(v2Envelope(), 200), undefined);
  assert.equal(parseDemoHttpOutcomeV2(JSON.stringify({ schemaVersion: 2, requestId: REQUEST_ID, error: { code: "invalid_query" } }), 400, NOW).code, "invalid_query");
});

test("catalog HTTP outcomes reject search semantics but retain closed transport and flag errors", async () => {
  for (const code of ["invalid_query", "invalid_cursor"]) {
    const body = JSON.stringify({ schemaVersion: 2, requestId: REQUEST_ID, error: { code } });
    assert.equal(parseDemoCatalogHttpOutcomeV2(body, 400), undefined);
    const handler = createDemoProxyHandler({ route: "catalog", schemaVersion: 2, isEnabled: () => true, fetchImpl: async () => apiResponse(body, 400) });
    const response = await handler(request("/api/demo/v2/catalog", { method: "GET" }));
    assert.equal(response.status, 503);
    const outcome = await response.json();
    assert.equal(outcome.error.code, "read_unavailable");
    assert.notEqual(outcome.requestId, REQUEST_ID);
  }
  for (const [code, status] of [["invalid_request", 400], ["not_found", 404], ["method_not_allowed", 405], ["cancelled", 408], ["request_too_large", 413], ["unsupported_content_type", 415], ["read_unavailable", 503]]) {
    const body = JSON.stringify({ schemaVersion: 2, requestId: REQUEST_ID, error: { code } });
    assert.deepEqual(parseDemoCatalogHttpOutcomeV2(body, status), { ok: false, requestId: REQUEST_ID, code });
    assert.equal(parseDemoCatalogHttpOutcomeV2(body, 200), undefined);
  }
});

test("V2 proxy uses only literal catalog, search and detail destinations", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return apiResponse(url.endsWith("/catalog") ? catalogEnvelope() : v2Envelope()); };
  const catalog = createDemoProxyHandler({ route: "catalog", schemaVersion: 2, isEnabled: () => true, clock: () => new Date(NOW), fetchImpl });
  const search = createDemoProxyHandler({ route: "search", schemaVersion: 2, isEnabled: () => true, clock: () => new Date(NOW), fetchImpl });
  const detail = createDemoProxyHandler({ route: "detail", schemaVersion: 2, isEnabled: () => true, clock: () => new Date(NOW), fetchImpl });
  assert.equal((await catalog(request("/api/demo/v2/catalog", { method: "GET" }))).status, 200);
  assert.equal((await search(request("/api/demo/v2/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status, 200);
  assert.equal((await detail(request(`/api/demo/v2/listings/${ID}`, { method: "GET" }), ID)).status, 200);
  assert.deepEqual(calls, ["http://127.0.0.1:3210/v2/demo/catalog", "http://127.0.0.1:3210/v2/demo/search", `http://127.0.0.1:3210/v2/demo/listings/${ID}`]);
});

test("proxy uses the fixed destination, strips incoming headers and preserves the original strict body", async () => {
  const calls = [];
  const telemetry = [];
  const handle = createDemoProxyHandler({ route: "search", isEnabled: () => true, clock: () => new Date(NOW), telemetry: (event) => telemetry.push(event), async fetchImpl(url, init) { calls.push({ url, init }); return apiResponse(envelope({ results: [], totalCount: 0 }), 200, { "set-cookie": "secret=x", location: "https://attacker.invalid" }); } });
  const original = '{"schemaVersion":1,"sort":"listing_asc","sort":"price_asc"}';
  const response = await handle(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json", forwarded: "host=attacker.invalid", "x-forwarded-host": "attacker.invalid", cookie: "secret" }, body: original }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, "http://127.0.0.1:3210/v1/demo/search");
  assert.deepEqual(Object.keys(calls[0].init.headers), ["content-type"]);
  assert.equal(new TextDecoder().decode(calls[0].init.body), original);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(telemetry, [{ route: "search", status: 200, durationMs: 0 }]);
});

test("detail proxy validates the public ID and forwards only its encoded fixed path", async () => {
  const calls = [];
  const handle = createDemoProxyHandler({ route: "detail", isEnabled: () => true, clock: () => new Date(NOW), async fetchImpl(url, init) { calls.push({ url, init }); return apiResponse(envelope()); } });
  assert.equal((await handle(request(`/api/demo/listings/${ID}`, { method: "GET", headers: { cookie: "secret", forwarded: "for=attacker" } }), ID)).status, 200);
  assert.equal(calls[0].url, `http://127.0.0.1:3210/v1/demo/listings/${ID}`);
  assert.equal(calls[0].init.headers, undefined);
  assert.equal((await handle(request("/api/demo/listings/invalid", { method: "GET" }), "../invalid")).status, 400);
  assert.equal(calls.length, 1);
});

test("validated upstream errors keep their correlation while hostile status mappings are replaced", async () => {
  const valid = createDemoProxyHandler({ route: "search", isEnabled: () => true, async fetchImpl() { return apiResponse(JSON.stringify({ schemaVersion: 1, requestId: REQUEST_ID, error: { code: "invalid_query" } }), 400); } });
  const validResponse = await valid(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.deepEqual(await validResponse.json(), { schemaVersion: 1, requestId: REQUEST_ID, error: { code: "invalid_query" } });
  const hostile = createDemoProxyHandler({ route: "search", isEnabled: () => true, async fetchImpl() { return apiResponse(JSON.stringify({ schemaVersion: 1, requestId: REQUEST_ID, error: { code: "not_found" } }), 503); } });
  const hostileBody = await (await hostile(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).json();
  assert.equal(hostileBody.error.code, "read_unavailable");
  assert.notEqual(hostileBody.requestId, REQUEST_ID);
});

test("proxy rejects hostile host/origin/site, body limits, disabled mode and aborts", async () => {
  let calls = 0;
  const handle = createDemoProxyHandler({ route: "search", isEnabled: () => true, clock: () => new Date(NOW), async fetchImpl() { calls += 1; return apiResponse(envelope()); } });
  const cases = [
    request("/api/demo/search", { method: "POST", headers: { host: "localhost:3107", "content-type": "application/json" }, body: "{}" }),
    request("/api/demo/search", { method: "POST", headers: { origin: "http://attacker.invalid", "content-type": "application/json" }, body: "{}" }),
    request("/api/demo/search", { method: "POST", headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: "{}" }),
    request("/api/demo/search?x=1", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json", "content-length": "9000" }, body: "{}" }),
    request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: new Uint8Array([0xff]) }),
  ];
  for (const candidate of cases) assert.notEqual((await handle(candidate)).status, 200);
  assert.equal(calls, 0);
  const disabled = createDemoProxyHandler({ route: "search", isEnabled: () => false });
  assert.equal((await disabled(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status, 404);

  const controller = new AbortController();
  const aborted = createDemoProxyHandler({ route: "search", isEnabled: () => true, fetchImpl: async (_url, init) => {
    if (init.signal.aborted) throw new DOMException("aborted", "AbortError");
    return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
  } });
  const pending = aborted(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: controller.signal }));
  controller.abort();
  assert.equal((await pending).status, 408);
});

test("proxy fails closed on oversized, malformed and duplicate upstream wrappers", async () => {
  for (const source of ["x".repeat(1_048_577), '{"schemaVersion":1,"requestId":"req_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","requestId":"req_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","data":{}}', new Uint8Array([0xff])]) {
    const handle = createDemoProxyHandler({ route: "search", isEnabled: () => true, async fetchImpl() { return apiResponse(source); } });
    const response = await handle(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "read_unavailable");
  }
  const wrongMedia = createDemoProxyHandler({ route: "search", isEnabled: () => true, async fetchImpl() { return new Response(envelope({ results: [], totalCount: 0 }), { status: 200, headers: { "content-type": "text/plain" } }); } });
  assert.equal((await wrongMedia(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status, 503);
});

test("proxy enforces the deadline while reading and ignores a late fetch success", async () => {
  const telemetry = [];
  const stalledBody = createDemoProxyHandler({ route: "search", isEnabled: () => true, telemetry: (event) => telemetry.push(event), async fetchImpl() {
    return apiResponse(new ReadableStream({ start() { /* deliberately stalled */ } }));
  } });
  const ignoredAbort = createDemoProxyHandler({ route: "search", isEnabled: () => true, telemetry: (event) => telemetry.push(event), async fetchImpl() {
    await new Promise((resolve) => setTimeout(resolve, 7_050));
    return apiResponse(envelope({ results: [], totalCount: 0 }));
  } });
  const started = Date.now();
  const [stalledResponse, lateResponse] = await Promise.all([
    stalledBody(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })),
    ignoredAbort(request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })),
  ]);
  assert.ok(Date.now() - started >= 6_800);
  for (const response of [stalledResponse, lateResponse]) {
    assert.equal(response.status, 408);
    const body = await response.json();
    assert.equal(body.error.code, "cancelled");
    assert.match(body.requestId, /^req_[0-9a-f]{32}$/u);
  }
  assert.deepEqual(telemetry.map((event) => [event.status, event.code]), [[408, "cancelled"], [408, "cancelled"]]);
});

test("client has no retry and analytics reject identifiers, queries and unknown fields", async () => {
  let calls = 0;
  const client = createDemoClient({ clock: () => new Date(NOW), async fetchImpl() { calls += 1; return new Response(envelope(), { status: 200 }); } });
  assert.equal((await client.search({ schemaVersion: 1, sort: "listing_asc" })).ok, true);
  assert.equal(calls, 1);
  const events = [];
  assert.equal(recordAnalyticsEvent({ eventName: "search_submitted", screen: "search", outcome: "success" }, (event) => events.push(event)), true);
  assert.equal(recordAnalyticsEvent({ eventName: "detail_opened", screen: "detail", outcome: "success", listingId: ID }, (event) => events.push(event)), false);
  assert.equal(recordAnalyticsEvent({ eventName: "search_submitted", screen: "search", outcome: "success", query: "secret" }), false);
  assert.equal(recordAnalyticsEvent(new Proxy({}, { ownKeys() { throw new Error("secret"); } })), false);
  assert.equal(events.length, 1);
});

test("V2 client bootstraps catalog without a hidden search and keeps literal same-origin paths", async () => {
  const paths = [];
  const client = createDemoClientV2({ clock: () => new Date(NOW), async fetchImpl(url) { paths.push(url); return new Response(url.endsWith("catalog") ? catalogEnvelope() : v2Envelope(), { status: 200 }); } });
  assert.equal((await client.catalog()).ok, true);
  assert.deepEqual(paths, ["/api/demo/v2/catalog"]);
  assert.equal((await client.search({ schemaVersion: 2, sort: "listing_asc" })).ok, true);
  assert.equal((await client.listing(ID)).ok, true);
  assert.deepEqual(paths, ["/api/demo/v2/catalog", "/api/demo/v2/search", `/api/demo/v2/listings/${ID}`]);
});

test("proxy telemetry formatter exposes only the closed operational fields", () => {
  const output = formatDemoProxyTelemetry({ route: "detail", status: 503, durationMs: 60_000, code: "read_unavailable" });
  assert.deepEqual(JSON.parse(output), { name: "web.demo_proxy", route: "detail", status: 503, durationMs: 60_000, code: "read_unavailable" });
  assert.doesNotMatch(output, /url|header|body|requestId|listing|stack|query/iu);
});
