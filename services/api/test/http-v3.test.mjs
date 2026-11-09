import assert from "node:assert/strict";
import test from "node:test";
import { createDemoApi } from "../dist/index.js";

const NOW = "2026-10-14T00:00:00.000Z";
const HOST = "127.0.0.1:3210";
const reference = { catalogId: "taxcat_http_fixture", releaseId: "taxrel_http_fixture", revision: 1 };
const result = { listingId: "lst_http_fixture", availability: "active", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [], description: { status: "unavailable" }, descriptionEvidence: [] };
const response = { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: "http-v2", taxonomyRelease: reference, dataAsOf: NOW, results: [result], state: "complete", totalCount: 1 };
const unavailable = { async search() { return { success: false, error: { code: "read_unavailable" } }; }, async getListing() { return this.search(); } };
const search = { method: "POST", url: "/v3/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: { schemaVersion: 3, sort: "listing_asc", text: "  Modèle   Fictif " } };

async function app(keywordReadPort, telemetry) {
  const instance = createDemoApi({ readPort: unavailable, keywordReadPort, clock: () => new Date(NOW), telemetry });
  await instance.ready();
  return instance;
}

test("V3 search exposes an outer V3 envelope with unchanged V2 result data", async (t) => {
  let received;
  const instance = await app({ async search(query, context) { received = { query, context }; return { success: true, data: response }; } });
  t.after(() => instance.close());
  const reply = await instance.inject(search);
  assert.equal(reply.statusCode, 200, reply.body);
  assert.equal(reply.json().schemaVersion, 3);
  assert.equal(reply.json().data.schemaVersion, 2);
  assert.deepEqual(reply.json().data, response);
  assert.equal(received.query.text, "fictif modele");
  assert.equal(received.context.signal.aborted, false);
});

test("V3 owns strict methods, query validation and error envelope version", async (t) => {
  const instance = await app({ async search() { return { success: false, error: { code: "invalid_cursor" } }; } });
  t.after(() => instance.close());
  for (const [request, status, code] of [
    [search, 400, "invalid_cursor"],
    [{ ...search, payload: { schemaVersion: 2, sort: "listing_asc", text: "secret" } }, 400, "invalid_query"],
    [{ ...search, payload: { schemaVersion: 3, sort: "listing_asc", text: "!!!" } }, 400, "invalid_query"],
    [{ method: "GET", url: "/v3/demo/search", headers: { host: HOST } }, 405, "method_not_allowed"],
    [{ ...search, url: "/v3/demo/search?secret=value" }, 400, "invalid_request"],
  ]) {
    const reply = await instance.inject(request);
    assert.equal(reply.statusCode, status, reply.body);
    assert.equal(reply.json().schemaVersion, 3);
    assert.deepEqual(reply.json().error, { code });
    assert.doesNotMatch(reply.body, /secret|value/u);
  }
});

test("V3 telemetry uses fixed route labels and never records keyword text", async (t) => {
  const events = [];
  const instance = await app({ async search() { throw new Error("private words"); } }, {
    metric(event) { events.push(event); }, log(event) { events.push(event); }, span(event) { events.push(event); }, alert(event) { events.push(event); },
  });
  t.after(() => instance.close());
  const reply = await instance.inject(search);
  assert.equal(reply.statusCode, 503);
  assert.equal(reply.json().schemaVersion, 3);
  assert.match(JSON.stringify(events), /\/v3\/demo\/search/u);
  assert.doesNotMatch(JSON.stringify(events), /modele|fictif|private words/iu);
});
