import assert from "node:assert/strict";
import test from "node:test";
import { createDemoApi } from "../dist/index.js";

const NOW = "2026-10-14T00:00:00.000Z";
const HOST = "127.0.0.1:3210";
const release = { schemaVersion: 1, catalogId: "taxcat_http_fixture", releaseId: "taxrel_http_fixture", revision: 1, releasedAt: NOW, dataMode: "synthetic", attributions: [], makes: [], models: [] };
const reference = { catalogId: release.catalogId, releaseId: release.releaseId, revision: 1 };
const catalog = { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: "http-v2", taxonomyRelease: release };
const result = { listingId: "lst_http_fixture", availability: "active", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [], description: { status: "unavailable" }, descriptionEvidence: [] };
const response = { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: "http-v2", taxonomyRelease: reference, dataAsOf: NOW, results: [result], state: "complete", totalCount: 1 };
const v1 = { async search() { return { success: false, error: { code: "read_unavailable" } }; }, async getListing() { return this.search(); } };
const v2 = { async catalog() { return { success: true, data: catalog }; }, async search() { return { success: true, data: response }; }, async getListing() { return this.search(); } };

async function app(overrides = {}, telemetry) {
  const instance = createDemoApi({ readPort: v1, readPortV2: { ...v2, ...overrides }, clock: () => new Date(NOW), telemetry });
  await instance.ready();
  return instance;
}
const search = { method: "POST", url: "/v2/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: { schemaVersion: 2, sort: "listing_asc" } };

test("V2 catalog/search/detail expose closed envelopes without altering V1", async (t) => {
  let context;
  const instance = await app({ async catalog(input) { context = input; return v2.catalog(); } });
  t.after(() => instance.close());
  for (const [request, data] of [
    [{ method: "GET", url: "/v2/demo/catalog", headers: { host: HOST } }, catalog],
    [search, response],
    [{ method: "GET", url: `/v2/demo/listings/${result.listingId}`, headers: { host: HOST } }, response],
  ]) {
    const reply = await instance.inject(request);
    assert.equal(reply.statusCode, 200, reply.body);
    const body = reply.json();
    assert.equal(body.schemaVersion, 2);
    assert.match(body.requestId, /^req_[0-9a-f]{32}$/u);
    assert.deepEqual(body.data, data);
    assert.equal(reply.headers["cache-control"], "no-store");
  }
  assert.equal(context.signal.aborted, false);
  const old = await instance.inject({ ...search, url: "/v1/demo/search", payload: { schemaVersion: 1, sort: "listing_asc" } });
  assert.equal(old.json().schemaVersion, 1);
  assert.equal(old.statusCode, 503);
});

test("V2 rejects wrong schemas, methods, parents and loopback header spoofing", async (t) => {
  const instance = await app({ async search() { return { success: false, error: { code: "invalid_query" } }; } });
  t.after(() => instance.close());
  for (const [request, status, code] of [
    [search, 400, "invalid_query"],
    [{ ...search, payload: { schemaVersion: 1, sort: "listing_asc" } }, 400, "invalid_query"],
    [{ ...search, payload: { schemaVersion: 2, sort: "listing_asc", modelId: "model_orphan" } }, 400, "invalid_query"],
    [{ method: "POST", url: "/v2/demo/catalog", headers: { host: HOST } }, 405, "method_not_allowed"],
    [{ method: "GET", url: "/v2/demo/catalog?secret=value", headers: { host: HOST } }, 400, "invalid_request"],
    [{ method: "GET", url: "/v2/demo/catalog", headers: { host: HOST, origin: "https://external.invalid" } }, 400, "invalid_request"],
    [{ ...search, headers: { ...search.headers, "x-forwarded-host": HOST } }, 400, "invalid_request"],
  ]) {
    const reply = await instance.inject(request);
    assert.equal(reply.statusCode, status, reply.body);
    assert.equal(reply.json().schemaVersion, 2);
    assert.deepEqual(reply.json().error, { code });
    assert.doesNotMatch(reply.body, /external|secret|orphan/u);
  }
});

test("V2 validates returned data and redacts faults; catalog errors have their own vocabulary", async (t) => {
  for (const port of [
    { async catalog() { return { success: true, data: { ...catalog, raw: "secret" } }; } },
    { async catalog() { return { success: false, error: { code: "invalid_query" } }; } },
    { async catalog() { throw new Error("secret payload"); } },
  ]) {
    const instance = await app(port); t.after(() => instance.close());
    const reply = await instance.inject({ method: "GET", url: "/v2/demo/catalog", headers: { host: HOST } });
    assert.equal(reply.statusCode, 503);
    assert.deepEqual(reply.json().error, { code: "read_unavailable" });
    assert.doesNotMatch(reply.body, /secret|payload/u);
  }
  const events = [];
  const instance = await app({ async getListing() { return { success: true, data: { ...response, results: [{ ...result, listingId: "lst_wrong" }] } }; } }, { log(event) { events.push(event); } });
  t.after(() => instance.close());
  const reply = await instance.inject({ method: "GET", url: `/v2/demo/listings/${result.listingId}`, headers: { host: HOST } });
  assert.equal(reply.statusCode, 503);
  assert.equal(events[0].route, "/v2/demo/listings/:listingId");
  assert.doesNotMatch(JSON.stringify(events), /lst_http_fixture|lst_wrong|taxcat_/u);
});
