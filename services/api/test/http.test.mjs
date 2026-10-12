import assert from "node:assert/strict";
import test from "node:test";
import { createDemoApi } from "../dist/index.js";

const NOW = "2026-10-11T22:00:00.000Z";
const HOST = "127.0.0.1:3210";
const LISTING_ID = "lst_synthetic_publication";

function result(overrides = {}) {
  return {
    listingId: LISTING_ID,
    availability: "active",
    price: { status: "unavailable" },
    mileage: { status: "unavailable" },
    evidence: [],
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    schemaVersion: 1,
    dataMode: "synthetic",
    fixtureVersion: "fixture-v1",
    dataAsOf: NOW,
    state: "complete",
    results: [result()],
    totalCount: 1,
    ...overrides,
  };
}

function port(overrides = {}) {
  return {
    async search() { return { success: true, data: response() }; },
    async getListing() { return { success: true, data: response() }; },
    ...overrides,
  };
}

async function app(readPort = port(), extras = {}) {
  const instance = createDemoApi({ readPort, clock: () => new Date(NOW), requestIds: () => "req_00000000000000000000000000000001", ...extras });
  await instance.ready();
  return instance;
}

function json(responseValue) { return JSON.parse(responseValue.body); }

test("search publishes only the closed validated envelope and propagates context", async () => {
  let query;
  let context;
  const instance = await app(port({ async search(queryValue, contextValue) { query = queryValue; context = contextValue; return { success: true, data: response() }; } }));
  const requestId = "req_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const reply = await instance.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json", "x-request-id": requestId }, payload: { schemaVersion: 1, sort: "listing_asc" } });
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(query, { schemaVersion: 1, sort: "listing_asc" });
  assert.equal(context.requestId, requestId);
  assert.equal(context.signal.aborted, false);
  assert.deepEqual(json(reply), { schemaVersion: 1, requestId, data: response() });
  assert.equal(reply.headers["cache-control"], "no-store");
  assert.equal(reply.headers["x-content-type-options"], "nosniff");
  assert.match(reply.headers["content-type"], /^application\/json; charset=utf-8/u);
  await instance.close();
});

test("detail is exact, supports withdrawn history, and maps empty to not_found", async () => {
  const withdrawn = response({ results: [result({ availability: "withdrawn" })] });
  const instance = await app(port({ async getListing() { return { success: true, data: withdrawn }; } }));
  const reply = await instance.inject({ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST } });
  assert.equal(reply.statusCode, 200);
  assert.equal(json(reply).data.results[0].availability, "withdrawn");
  await instance.close();

  const missing = await app(port({ async getListing() { return { success: true, data: response({ results: [], totalCount: 0 }) }; } }));
  const absent = await missing.inject({ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST } });
  assert.equal(absent.statusCode, 404);
  assert.equal(json(absent).error.code, "not_found");
  await missing.close();
});

test("protocol denials use the closed status and error vocabulary", async () => {
  const instance = await app();
  const sameOrigin = await instance.inject({ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST, origin: `http://${HOST}` } });
  assert.equal(sameOrigin.statusCode, 200);
  assert.equal(sameOrigin.headers["access-control-allow-origin"], `http://${HOST}`);
  assert.equal(sameOrigin.headers.vary, "Origin");
  const cases = [
    [{ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "text/plain" }, payload: "x" }, 415, "unsupported_content_type"],
    [{ method: "GET", url: "/v1/demo/search", headers: { host: HOST } }, 405, "method_not_allowed"],
    [{ method: "OPTIONS", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST } }, 405, "method_not_allowed"],
    [{ method: "GET", url: "/unknown?secret=value", headers: { host: HOST } }, 404, "not_found"],
    [{ method: "GET", url: `/v1/demo/listings/${LISTING_ID}?x=1`, headers: { host: HOST } }, 400, "invalid_request"],
    [{ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: "localhost:3210" } }, 400, "invalid_request"],
    [{ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST, origin: "null" } }, 400, "invalid_request"],
    [{ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST, Forwarded: "for=127.0.0.1" } }, 400, "invalid_request"],
    [{ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST, "X-Forwarded-Host": HOST } }, 400, "invalid_request"],
    [{ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST, "x-forwarded-for": "127.0.0.1" } }, 400, "invalid_request"],
  ];
  for (const [request, status, code] of cases) {
    const reply = await instance.inject(request);
    assert.equal(reply.statusCode, status);
    assert.deepEqual(Object.keys(json(reply)).sort(), ["error", "requestId", "schemaVersion"]);
    assert.deepEqual(json(reply).error, { code });
    assert.doesNotMatch(reply.body, /secret|localhost|null/u);
  }
  await instance.close();
});

test("strict JSON rejects malformed, duplicate, escaped duplicate, prototype and oversized input", async () => {
  let portCalls = 0;
  const instance = await app(port({ async search() { portCalls += 1; return { success: true, data: response() }; } }));
  const hostile = [
    '{"schemaVersion":1,"sort":"listing_asc","sort":"price_asc"}',
    '{"schemaVersion":1,"sort":"listing_asc","s\\u006frt":"price_asc"}',
    '{"schemaVersion":1,"sort":"listing_asc","__proto__":{}}',
    '{"schemaVersion":1,"sort":',
    '\u00a0{"schemaVersion":1,"sort":"listing_asc"}',
    '\ufeff{"schemaVersion":1,"sort":"listing_asc"}',
  ];
  for (const payload of hostile) {
    const reply = await instance.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload });
    assert.equal(reply.statusCode, 400);
    assert.equal(json(reply).error.code, "invalid_request");
  }
  const oversized = await instance.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: JSON.stringify({ schemaVersion: 1, sort: "listing_asc", padding: "x".repeat(9_000) }) });
  assert.equal(oversized.statusCode, 413);
  assert.equal(json(oversized).error.code, "request_too_large");
  assert.equal(portCalls, 0);
  await instance.close();
});

test("invalid requests get a fresh server correlation and read failures never expose internals", async () => {
  const instance = await app(port({ async search() { throw new Error("VIN raw_source internal-secret"); } }));
  const invalid = await instance.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json", "x-request-id": "attacker-value" }, payload: { schemaVersion: 1, sort: "listing_asc" } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(json(invalid).requestId, "req_00000000000000000000000000000001");
  assert.doesNotMatch(invalid.body, /attacker/u);
  const failed = await instance.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: { schemaVersion: 1, sort: "listing_asc" } });
  assert.equal(failed.statusCode, 503);
  assert.equal(json(failed).error.code, "read_unavailable");
  assert.doesNotMatch(failed.body, /VIN|raw_source|internal-secret/u);
  await instance.close();
});

test("malformed DTOs and route-specific violations fail closed", async () => {
  const malformed = await app(port({ async search() { return { success: true, data: response({ results: [result({ availability: "withdrawn" })] }) }; } }));
  const search = await malformed.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: { schemaVersion: 1, sort: "listing_asc" } });
  assert.equal(search.statusCode, 503);
  await malformed.close();
  const detail = await app(port({ async getListing() { return { success: true, data: response({ nextCursor: `cur_${"a".repeat(64)}`, totalCount: 2 }) }; } }));
  const resultValue = await detail.inject({ method: "GET", url: `/v1/demo/listings/${LISTING_ID}`, headers: { host: HOST } });
  assert.equal(resultValue.statusCode, 503);
  await detail.close();
});

test("read failure codes map only to their frozen HTTP statuses", async () => {
  for (const [code, status] of [["invalid_cursor", 400], ["read_unavailable", 503], ["cancelled", 408]]) {
    const instance = await app(port({ async search() { return { success: false, error: { code } }; } }));
    const reply = await instance.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: { schemaVersion: 1, sort: "listing_asc" } });
    assert.equal(reply.statusCode, status);
    assert.equal(json(reply).error.code, code);
    await instance.close();
  }
});

test("hostile read outcomes remain inside the internal 503 boundary", async () => {
  const hostile = [
    new Proxy({}, { ownKeys() { throw new Error("proxy-secret"); } }),
    Object.defineProperty({}, "success", { enumerable: true, get() { throw new Error("getter-secret"); } }),
  ];
  for (const outcome of hostile) {
    const instance = await app(port({ async search() { return outcome; } }));
    const reply = await instance.inject({ method: "POST", url: "/v1/demo/search", headers: { host: HOST, "content-type": "application/json" }, payload: { schemaVersion: 1, sort: "listing_asc" } });
    assert.equal(reply.statusCode, 503);
    assert.equal(json(reply).error.code, "read_unavailable");
    assert.doesNotMatch(reply.body, /proxy-secret|getter-secret/u);
    await instance.close();
  }
});
