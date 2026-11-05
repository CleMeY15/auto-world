import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

export async function queryApplication(url, overrides = {}, expectedStatus = 200) {
  const endpoint = new URL(url);
  if (endpoint.hostname !== "127.0.0.1" || endpoint.protocol !== "http:" || endpoint.username || endpoint.password) {
    throw new Error("application_loopback_required");
  }
  const response = await globalThis.fetch(new URL("/v1/demo/search", endpoint), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, sort: "listing_asc", ...overrides }),
    signal: globalThis.AbortSignal.timeout(7_000), redirect: "error",
  });
  assert.equal(response.status, expectedStatus);
  const envelope = await response.json();
  assert.match(envelope.requestId, /^req_[0-9a-f]{32}$/u);
  assert.equal(envelope.schemaVersion, 1);
  if (expectedStatus !== 200) {
    assert.equal(envelope.error.code, "read_unavailable");
    return envelope.error;
  }
  assert.equal(typeof envelope.data, "object");
  return envelope.data;
}

function responseShape(data, expectedCount) {
  assert.ok(data !== null && typeof data === "object");
  assert.ok(Array.isArray(data.results));
  assert.ok(data.state === "complete" || data.state === "stale", "application_publication_state_invalid");
  if (data.state === "complete") {
    assert.equal(Object.hasOwn(data, "reason"), false);
    assert.ok(Number.isSafeInteger(data.totalCount) && data.totalCount >= 0);
    if (expectedCount !== undefined) assert.equal(data.totalCount, expectedCount);
  } else {
    assert.equal(data.reason, "projection_stale");
    assert.equal(Object.hasOwn(data, "totalCount"), false);
  }
}

function durableMetadata(data) {
  const { results: _results, nextCursor: _nextCursor, state: _state,
    reason: _reason, totalCount: _totalCount, ...metadata } = data;
  void _results; void _nextCursor; void _state; void _reason; void _totalCount;
  return metadata;
}

function preservedShape(data) {
  responseShape(data);
  assert.equal(Object.hasOwn(data, "nextCursor"), false);
  assert.equal(new Set(data.results.map((item) => item.listingId)).size, data.results.length);
  if (data.state === "complete") assert.equal(data.totalCount, data.results.length);
}

export function assertPublicationPreserved(actual, expected) {
  preservedShape(actual);
  preservedShape(expected);
  assert.deepEqual(durableMetadata(actual), durableMetadata(expected));
  assert.deepEqual(actual.results, expected.results);
}

export async function readAll(url, { expectedCount } = {}) {
  if (expectedCount !== undefined) {
    assert.ok(Number.isSafeInteger(expectedCount) && expectedCount >= 0, "application_expected_count_invalid");
  }
  const first = await queryApplication(url);
  responseShape(first, expectedCount);
  const count = expectedCount ?? (first.state === "complete" ? first.totalCount : undefined);
  assert.notEqual(count, undefined, "application_expected_count_required");
  const metadata = durableMetadata(first);
  const results = [...first.results];
  let actualState = first.state;
  let cursor = first.nextCursor;
  for (let page = 1; cursor !== undefined; page += 1) {
    if (page >= 100) throw new Error("application_paging_limit");
    const next = await queryApplication(url, { cursor });
    responseShape(next, count);
    assert.deepEqual(durableMetadata(next), metadata);
    if (next.state === "stale") actualState = "stale";
    results.push(...next.results);
    cursor = next.nextCursor;
  }
  assert.equal(results.length, count);
  assert.equal(new Set(results.map((item) => item.listingId)).size, count);
  return actualState === "complete"
    ? { ...metadata, state: "complete", results, totalCount: count }
    : { ...metadata, state: "stale", reason: "projection_stale", results };
}

export async function benchmark(url) {
  const samples = [];
  for (let index = 0; index < 50; index += 1) {
    const start = performance.now();
    await queryApplication(url, { sort: index % 2 ? "price_asc" : "mileage_desc",
      ...(index % 3 === 0 ? { priceMaxMinor: 1_000_500 } : {}),
      ...(index % 5 === 0 ? { mileageMaxKm: 20_750 } : {}) });
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  const p95Ms = samples[Math.ceil(samples.length * 0.95) - 1];
  assert.ok(p95Ms < 500, "application_search_latency_exceeded");
  return { transport: "loopback-http", concurrency: 1, samples: samples.length,
    p50Ms: samples[Math.ceil(samples.length * 0.5) - 1], p95Ms, maxMs: samples.at(-1),
    sorts: ["price_asc", "mileage_desc"], filters: ["priceMaxMinor", "mileageMaxKm"] };
}
