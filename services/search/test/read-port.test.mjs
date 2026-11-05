import assert from "node:assert/strict";
import { test } from "node:test";
import { createSearchReadPort } from "../.prototype-dist/read-port.js";

const NOW = Date.parse("2026-01-01T00:01:00.000Z");
const listingId = (value) => `lst_${Number(value).toString(16).padStart(64, "0")}`;

function publication(overrides = {}) {
  return {
    indexName: `aw-v1-search-${"a".repeat(32)}`,
    snapshot: {
      schemaVersion: 1,
      fixtureVersion: "synthetic-search-v1",
      dataAsOf: "2026-01-01T00:00:30.000Z",
      completeness: "complete",
      fingerprint: "b".repeat(64),
    },
    documentCount: 25,
    pendingRelevant: false,
    revision: 1,
    ...overrides,
  };
}

function item(digit) {
  return { listingId: listingId(digit), availability: "active", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [] };
}

const context = (signal = new globalThis.AbortController().signal) => ({ requestId: `req_${"1".repeat(32)}`, signal });
const query = (extra = {}) => ({ schemaVersion: 1, sort: "listing_asc", ...extra });

test("cursor replay is stable and an old generation invalidates it", async () => {
  let current = publication();
  const calls = [];
  const search = {
    async search(indexName, request, offset) {
      calls.push({ indexName, request, offset });
      return offset === 0 ? { results: Array.from({ length: 20 }, (_, index) => item(index + 1)), total: 25 } : { results: [item(21)], total: 25 };
    },
    async detail() { return null; },
  };
  const port = createSearchReadPort({ loadPublication: async () => current, search, nowMs: () => NOW, randomBytes: () => new Uint8Array(32).fill(7) });
  const first = await port.search(query(), context());
  assert.equal(first.success, true);
  assert.equal(first.data.state, "complete");
  assert.ok(first.data.nextCursor);
  const replayA = await port.search(query({ cursor: first.data.nextCursor }), context());
  const replayB = await port.search(query({ cursor: first.data.nextCursor }), context());
  assert.deepEqual(replayA, replayB);
  assert.deepEqual(calls.map((call) => call.offset), [0, 20, 20]);

  current = publication({ revision: 2, indexName: `aw-v1-search-${"c".repeat(32)}`, snapshot: { ...publication().snapshot, fingerprint: "d".repeat(64) } });
  assert.deepEqual(await port.search(query({ cursor: first.data.nextCursor }), context()), { success: false, error: { code: "invalid_cursor" } });
});

test("pending relevant events force partial without count; stale still takes precedence", async () => {
  let current = publication({ pendingRelevant: true });
  const search = { async search() { return { results: [item("1")], total: 1 }; }, async detail() { return null; } };
  let clock = NOW;
  const port = createSearchReadPort({ loadPublication: async () => current, search, nowMs: () => clock });
  const partial = await port.search(query(), context());
  assert.equal(partial.success, true);
  assert.equal(partial.data.state, "partial");
  assert.equal("totalCount" in partial.data, false);

  clock = Date.parse("2026-01-01T00:01:31.000Z");
  const stale = await port.search(query(), context());
  assert.equal(stale.success, true);
  assert.equal(stale.data.state, "stale");
  assert.equal("totalCount" in stale.data, false);
});

test("the same publication revision cannot identify two generations", async () => {
  let current = publication({ revision: 1 });
  const search = { async search() { return { results: [], total: 0 }; }, async detail() { return null; } };
  const port = createSearchReadPort({ loadPublication: async () => current, search, nowMs: () => NOW });
  assert.equal((await port.search(query(), context())).success, true);
  current = publication({ revision: 1, indexName: `aw-v1-search-${"c".repeat(32)}`, snapshot: { ...publication().snapshot, fingerprint: "d".repeat(64) } });
  assert.deepEqual(await port.search(query(), context()), { success: false, error: { code: "read_unavailable" } });
});

test("missing publication, malformed query and cancellation fail closed", async () => {
  const search = { async search() { throw new Error("must not run"); }, async detail() { return null; } };
  const port = createSearchReadPort({ loadPublication: async () => null, search, nowMs: () => NOW });
  assert.deepEqual(await port.search(query(), context()), { success: false, error: { code: "read_unavailable" } });
  assert.deepEqual(await port.search({ schemaVersion: 1, sort: "unknown" }, context()), { success: false, error: { code: "read_unavailable" } });
  const controller = new globalThis.AbortController();
  controller.abort();
  assert.deepEqual(await port.search(query(), context(controller.signal)), { success: false, error: { code: "cancelled" } });
});

test("an absent detail is definitive only for a fresh complete publication", async () => {
  let current = publication({ pendingRelevant: true });
  const search = { async search() { return { results: [], total: 0 }; }, async detail() { return null; } };
  const port = createSearchReadPort({ loadPublication: async () => current, search, nowMs: () => NOW });
  assert.deepEqual(await port.getListing(listingId(1), context()), { success: false, error: { code: "read_unavailable" } });
  current = publication();
  const found = await port.getListing(listingId(1), context());
  assert.equal(found.success, true);
  assert.equal(found.data.state, "complete");
  assert.deepEqual(found.data.results, []);
});

test("cursor capacity refuses a new continuation without evicting the existing cursor", async () => {
  const results = Array.from({ length: 20 }, (_, index) => item(index + 1));
  const search = { async search(...args) { const offset = args[2]; return { results: offset === 0 ? results : Array.from({ length: 5 }, (_, index) => item(index + 21)), total: 25 }; }, async detail() { return null; } };
  const port = createSearchReadPort({ loadPublication: async () => publication(), search, nowMs: () => NOW, cursorCapacity: 1 });
  const first = await port.search(query(), context());
  assert.equal(first.success, true);
  assert.ok(first.data.nextCursor);
  assert.deepEqual(await port.search(query({ priceMaxMinor: 10_000 }), context()), { success: false, error: { code: "read_unavailable" } });
  const replay = await port.search(query({ cursor: first.data.nextCursor }), context());
  assert.equal(replay.success, true);
});

test("a delayed old generation cannot insert a stale cursor after a new generation clears the session", async () => {
  let current = publication();
  let releaseOld;
  let markOldStarted;
  const oldResult = new Promise((resolve) => { releaseOld = resolve; });
  const oldStarted = new Promise((resolve) => { markOldStarted = resolve; });
  let newCalls = 0;
  const search = {
    async search(indexName) {
      if (indexName.endsWith("a".repeat(32))) {
        markOldStarted();
        return oldResult;
      }
      newCalls += 1;
      return newCalls === 1
        ? { results: [], total: 0 }
        : { results: Array.from({ length: 20 }, (_, index) => item(index + 1)), total: 25 };
    },
    async detail() { return null; },
  };
  const port = createSearchReadPort({ loadPublication: async () => current, search, nowMs: () => NOW, cursorCapacity: 1 });
  const delayed = port.search(query(), context());
  await oldStarted;
  current = publication({ revision: 2, indexName: `aw-v1-search-${"c".repeat(32)}`, snapshot: { ...publication().snapshot, fingerprint: "d".repeat(64) } });
  const replacement = await port.search(query(), context());
  assert.equal(replacement.success, true);
  releaseOld({ results: Array.from({ length: 20 }, (_, index) => item(index + 1)), total: 25 });
  assert.deepEqual(await delayed, { success: false, error: { code: "read_unavailable" } });
  const currentPage = await port.search(query(), context());
  assert.equal(currentPage.success, true);
  assert.ok(currentPage.data.nextCursor);
});

test("a delayed older publication cannot roll back a newer cursor session", async () => {
  const oldPublication = publication({ revision: 1 });
  const newPublication = publication({
    revision: 2,
    indexName: `aw-v1-search-${"c".repeat(32)}`,
    snapshot: { ...publication().snapshot, fingerprint: "d".repeat(64) },
  });
  let releaseOld;
  const delayedLoad = new Promise((resolve) => { releaseOld = resolve; });
  let loads = 0;
  const search = {
    async search(...args) {
      const offset = args[2];
      return offset === 0
        ? { results: Array.from({ length: 20 }, (_, index) => item(index + 1)), total: 25 }
        : { results: Array.from({ length: 5 }, (_, index) => item(index + 21)), total: 25 };
    },
    async detail() { return null; },
  };
  const port = createSearchReadPort({
    loadPublication: async () => ++loads === 1 ? delayedLoad : newPublication,
    search,
    nowMs: () => NOW,
    cursorCapacity: 1,
  });
  const delayed = port.search(query(), context());
  const currentPage = await port.search(query(), context());
  assert.equal(currentPage.success, true);
  assert.ok(currentPage.data.nextCursor);
  releaseOld(oldPublication);
  assert.deepEqual(await delayed, { success: false, error: { code: "read_unavailable" } });
  const replay = await port.search(query({ cursor: currentPage.data.nextCursor }), context());
  assert.equal(replay.success, true);
  assert.equal(replay.data.results.length, 5);
});
