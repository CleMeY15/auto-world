import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { assertPublicationPreserved, queryApplication, readAll } from "../scripts/prototype-application/http.mjs";

const requestId = "req_0123456789abcdef0123456789abcdef";
const metadata = {
  schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "synthetic-search-v1",
  dataAsOf: "2026-09-06T12:00:00.000Z",
};
const complete = (results, totalCount, nextCursor) => ({
  ...metadata, state: "complete", results, totalCount,
  ...(nextCursor === undefined ? {} : { nextCursor }),
});
const stale = (results, nextCursor, overrides = {}) => ({
  ...metadata, ...overrides, state: "stale", reason: "projection_stale", results,
  ...(nextCursor === undefined ? {} : { nextCursor }),
});

async function withServer(respond, action) {
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      await respond(request, Buffer.concat(chunks).toString("utf8"), response);
    } catch (error) {
      response.destroy(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  try {
    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

test("queryApplication sends V1 filters and returns a successful query", async () => {
  let observed;
  await withServer((request, body, response) => {
    observed = { method: request.method, url: request.url, body: JSON.parse(body) };
    sendJson(response, 200, { requestId, schemaVersion: 1, data: { results: [], totalCount: 0 } });
  }, async (url) => {
    const result = await queryApplication(url, { sort: "price_asc", priceMaxMinor: 2_500_000, mileageMaxKm: 80_000 });
    assert.deepEqual(result, { results: [], totalCount: 0 });
  });
  assert.deepEqual(observed, {
    method: "POST",
    url: "/v1/demo/search",
    body: { schemaVersion: 1, sort: "price_asc", priceMaxMinor: 2_500_000, mileageMaxKm: 80_000 },
  });
});

test("queryApplication exposes the API typed read-unavailable response", async () => {
  await withServer((_request, _body, response) => {
    sendJson(response, 503, { requestId, schemaVersion: 1, error: { code: "read_unavailable", retryable: true } });
  }, async (url) => {
    assert.deepEqual(await queryApplication(url, {}, 503), { code: "read_unavailable", retryable: true });
  });
});

test("readAll follows cursors while preserving total-count and listing uniqueness", async () => {
  const observedCursors = [];
  const publication = await withServer((_request, body, response) => {
    const query = JSON.parse(body);
    observedCursors.push(query.cursor);
    const data = query.cursor === undefined
      ? complete([{ listingId: "listing-1" }, { listingId: "listing-2" }], 3, "page-2")
      : complete([{ listingId: "listing-3" }], 3);
    sendJson(response, 200, { requestId, schemaVersion: 1, data });
  }, readAll);
  assert.deepEqual(observedCursors, [undefined, "page-2"]);
  assert.deepEqual(publication.results.map((item) => item.listingId), ["listing-1", "listing-2", "listing-3"]);
  assert.equal(publication.totalCount, 3);
  assert.equal("nextCursor" in publication, false);
});

test("readAll accepts stale recovery and assertPublicationPreserved permits only freshness metadata changes", async () => {
  const fresh = { ...metadata, state: "complete", results: [{ listingId: "listing-1", price: 10 }], totalCount: 1 };
  const recovered = await withServer((_request, _body, response) => {
    sendJson(response, 200, { requestId, schemaVersion: 1,
      data: stale([{ listingId: "listing-1", price: 10 }]) });
  }, (url) => readAll(url, { expectedCount: 1 }));
  assert.deepEqual(recovered, {
    ...metadata, state: "stale", reason: "projection_stale",
    results: [{ listingId: "listing-1", price: 10 }],
  });
  assert.doesNotThrow(() => assertPublicationPreserved(recovered, fresh));
});

test("readAll preserves a complete-to-stale transition while traversing one publication", async () => {
  const value = await withServer((_request, body, response) => {
    const query = JSON.parse(body);
    const data = query.cursor === undefined
      ? complete([{ listingId: "listing-1" }, { listingId: "listing-2" }], 3, "page-2")
      : stale([{ listingId: "listing-3" }]);
    sendJson(response, 200, { requestId, schemaVersion: 1, data });
  }, readAll);
  assert.deepEqual(value, {
    ...metadata, state: "stale", reason: "projection_stale",
    results: [{ listingId: "listing-1" }, { listingId: "listing-2" }, { listingId: "listing-3" }],
  });
});

test("readAll rejects partial state and stale reads without an explicit expected count", async () => {
  await withServer((_request, _body, response) => {
    sendJson(response, 200, { requestId, schemaVersion: 1, data: {
      ...metadata, state: "partial", reason: "projection_incomplete", results: [],
    } });
  }, async (url) => {
    await assert.rejects(() => readAll(url), /application_publication_state_invalid/u);
  });
  await withServer((_request, _body, response) => {
    sendJson(response, 200, { requestId, schemaVersion: 1, data: stale([]) });
  }, async (url) => {
    await assert.rejects(() => readAll(url), /application_expected_count_required/u);
  });
});

test("readAll rejects changed publication metadata, counts, duplicate IDs and missing rows", async (t) => {
  const cases = [
    ["dataAsOf", (query) => query.cursor === undefined
      ? complete([{ listingId: "listing-1" }], 2, "page-2")
      : stale([{ listingId: "listing-2" }], undefined, { dataAsOf: "2026-09-06T12:00:01.000Z" })],
    ["count", (query) => query.cursor === undefined
      ? complete([{ listingId: "listing-1" }], 2, "page-2")
      : complete([{ listingId: "listing-2" }], 3)],
    ["duplicate", (query) => query.cursor === undefined
      ? complete([{ listingId: "listing-1" }], 2, "page-2")
      : complete([{ listingId: "listing-1" }], 2)],
    ["missing", () => complete([{ listingId: "listing-1" }], 2)],
  ];
  for (const [name, page] of cases) {
    await t.test(name, async () => {
      await withServer((_request, body, response) => {
        sendJson(response, 200, { requestId, schemaVersion: 1, data: page(JSON.parse(body)) });
      }, async (url) => {
        await assert.rejects(() => readAll(url));
      });
    });
  }
});

test("assertPublicationPreserved rejects changed rows and invalid publication shapes", () => {
  const expected = complete([{ listingId: "listing-1", price: 10 }], 1);
  assert.throws(() => assertPublicationPreserved(
    complete([{ listingId: "listing-1", price: 11 }], 1), expected));
  assert.throws(() => assertPublicationPreserved(
    { ...stale([{ listingId: "listing-1", price: 10 }]), totalCount: 1 }, expected));
  assert.throws(() => assertPublicationPreserved(
    { ...expected, state: "partial", reason: "projection_incomplete" }, expected),
  /application_publication_state_invalid/u);
});

test("queryApplication rejects non-loopback targets and HTTP redirects", async () => {
  await assert.rejects(() => queryApplication("http://localhost:3211"), /application_loopback_required/u);
  await assert.rejects(() => queryApplication("https://127.0.0.1:3211"), /application_loopback_required/u);
  await withServer((_request, _body, response) => {
    response.writeHead(302, { location: "http://example.invalid/" });
    response.end();
  }, async (url) => {
    await assert.rejects(() => queryApplication(url));
  });
});
