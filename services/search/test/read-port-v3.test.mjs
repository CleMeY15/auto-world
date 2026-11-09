import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE } from "@auto-world/synthetic-connector/demo";
import { createSearchReadPortV2 } from "../.prototype-dist/read-port-v2.js";
import { createSearchKeywordReadPort } from "../.prototype-dist/read-port-v3.js";

const NOW = Date.parse("2026-01-01T00:01:00.000Z");
const fixtureVersion = "synthetic-prototype-web-v2";
const catalog = { schemaVersion: 2, dataMode: "synthetic", fixtureVersion,
  taxonomyRelease: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE };
const taxonomyRelease = { catalogId: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.catalogId,
  releaseId: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.releaseId, revision: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.revision };
const item = (index) => ({ listingId: `lst_${index.toString(16).padStart(64, "0")}`, availability: "active",
  price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [],
  description: { status: "unavailable" }, descriptionEvidence: [] });
const items = Array.from({ length: 25 }, (_, index) => item(index));
const publication = (overrides = {}) => ({ indexName: `aw-v2-search-${"a".repeat(32)}`, revision: 1, mappingVersion: 2,
  snapshot: { schemaVersion: 2, fixtureVersion, taxonomyRelease,
    mapperVersion: "synthetic-prototype-web-mapper-v2", profileFingerprint: `prf_${"b".repeat(64)}`,
    dataAsOf: "2026-01-01T00:00:30.000Z", completeness: "complete", fingerprint: "c".repeat(64) },
  documentCount: items.length, pendingRelevant: false, ...overrides });
const context = (signal = new globalThis.AbortController().signal) => ({ requestId: `req_${"1".repeat(32)}`, signal });

function transport(calls) {
  return { async searchKeyword(indexName, query, modelIds, offset) {
    calls.push({ indexName, query, modelIds, offset });
    return { results: items.slice(offset, offset + 20), total: items.length };
  } };
}

test("V3 resolves current catalog labels before transport and paginates in its own cursor domain", async () => {
  const calls = [];
  const port = createSearchKeywordReadPort({ catalog, loadPublication: async () => publication(), search: transport(calls), nowMs: () => NOW,
    randomBytes: () => new Uint8Array(32).fill(7) });
  const query = { schemaVersion: 3, sort: "listing_asc", text: "marque a" };
  const first = await port.search(query, context());
  assert.equal(first.success, true, JSON.stringify({ first, calls }));
  assert.equal(first.data.results.length, 20);
  assert.match(first.data.nextCursor, /^cur_[0-9a-f]{64}$/u);
  assert.ok(calls[0].modelIds.length > 0);
  assert.equal(calls[0].offset, 0);

  const replay = await port.search({ ...query, text: " A, marque ", cursor: first.data.nextCursor }, context());
  assert.equal(replay.success, true);
  assert.equal(replay.data.results.length, 5);
  assert.equal(calls[1].offset, 20);
  assert.deepEqual(calls[1].modelIds, calls[0].modelIds);

  const equivalentIds = [];
  const equivalent = createSearchKeywordReadPort({ catalog, loadPublication: async () => publication(),
    search: { async searchKeyword(_indexName, _query, modelIds) { equivalentIds.push(modelIds); return { results: items.slice(0, 20), total: items.length }; } }, nowMs: () => NOW });
  assert.equal((await equivalent.search({ schemaVersion: 3, sort: "listing_asc", text: "a" }, context())).success, true);
  assert.deepEqual(equivalentIds[0], calls[0].modelIds);
  assert.deepEqual(await port.search({ ...query, text: "a", cursor: first.data.nextCursor }, context()),
    { success: false, error: { code: "invalid_cursor" } });
  assert.deepEqual(await port.search({ ...query, cursor: `cur_${"9".repeat(64)}` }, context()),
    { success: false, error: { code: "invalid_cursor" } });
});

test("V3 distinguishes omitted, empty and nonempty model restrictions", async () => {
  const calls = [];
  const port = createSearchKeywordReadPort({ catalog, loadPublication: async () => publication(), search: transport(calls), nowMs: () => NOW });
  const unfiltered = await port.search({ schemaVersion: 3, sort: "price_asc" }, context());
  assert.equal(unfiltered.success, true, JSON.stringify({ unfiltered, calls }));
  assert.equal(calls[0].modelIds, undefined);
  assert.equal((await port.search({ schemaVersion: 3, sort: "price_asc", text: "words absent catalog" }, context())).success, true);
  assert.deepEqual(calls[1].modelIds, []);
  assert.deepEqual(await port.search({ schemaVersion: 3, sort: "price_asc", text: "!!!" }, context()),
    { success: false, error: { code: "invalid_query" } });
});

test("V3 invalidates cursors on publication revision and rejects V2 namespace tokens", async () => {
  let current = publication();
  const calls = [];
  const port = createSearchKeywordReadPort({ catalog, loadPublication: async () => current, search: transport(calls), nowMs: () => NOW,
    randomBytes: () => new Uint8Array(32).fill(8) });
  const first = await port.search({ schemaVersion: 3, sort: "listing_asc", text: "fictif" }, context());
  assert.equal(first.success, true, JSON.stringify(first));
  const v2 = createSearchReadPortV2({ catalog, loadPublication: async () => current, nowMs: () => NOW,
    randomBytes: () => new Uint8Array(32).fill(8), search: {
      async searchV2(_indexName, _query, offset) { return { results: items.slice(offset, offset + 20), total: items.length }; },
      async detailV2() { return null; },
    } });
  const v2First = await v2.search({ schemaVersion: 2, sort: "listing_asc" }, context());
  assert.equal(v2First.success, true);
  assert.notEqual(v2First.data.nextCursor, first.data.nextCursor);
  assert.deepEqual(await port.search({ schemaVersion: 3, sort: "listing_asc", text: "fictif", cursor: v2First.data.nextCursor }, context()),
    { success: false, error: { code: "invalid_cursor" } });
  current = publication({ revision: 2, indexName: `aw-v2-search-${"d".repeat(32)}`,
    snapshot: { ...publication().snapshot, fingerprint: "e".repeat(64) } });
  assert.deepEqual(await port.search({ schemaVersion: 3, sort: "listing_asc", text: "fictif", cursor: first.data.nextCursor }, context()),
    { success: false, error: { code: "invalid_cursor" } });
  assert.deepEqual(await port.search({ schemaVersion: 3, sort: "listing_asc", text: "fictif", cursor: `cur_${"2".repeat(64)}` }, context()),
    { success: false, error: { code: "invalid_cursor" } });
});

test("V3 preserves an existing cursor at capacity, rejects revision rollback and observes late cancellation", async () => {
  let current = publication();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const port = createSearchKeywordReadPort({ catalog, loadPublication: async () => current, nowMs: () => NOW, cursorCapacity: 1,
    search: { async searchKeyword(_indexName, query, _modelIds, offset) {
      if (query.text === "b") await pending;
      return { results: items.slice(offset, offset + 20), total: items.length };
    } } });
  const first = await port.search({ schemaVersion: 3, sort: "listing_asc", text: "a" }, context());
  assert.equal(first.success, true);
  assert.deepEqual(await port.search({ schemaVersion: 3, sort: "listing_asc", text: "modele" }, context()),
    { success: false, error: { code: "read_unavailable" } });
  assert.equal((await port.search({ schemaVersion: 3, sort: "listing_asc", text: "a", cursor: first.data.nextCursor }, context())).success, true);

  current = publication({ revision: 2, indexName: `aw-v2-search-${"d".repeat(32)}`,
    snapshot: { ...publication().snapshot, fingerprint: "e".repeat(64) } });
  assert.equal((await port.search({ schemaVersion: 3, sort: "listing_asc", text: "a" }, context())).success, true);
  current = publication();
  assert.deepEqual(await port.search({ schemaVersion: 3, sort: "listing_asc", text: "a" }, context()),
    { success: false, error: { code: "read_unavailable" } });

  const controller = new globalThis.AbortController();
  current = publication({ revision: 3, indexName: `aw-v2-search-${"f".repeat(32)}`,
    snapshot: { ...publication().snapshot, fingerprint: "7".repeat(64) } });
  const late = port.search({ schemaVersion: 3, sort: "listing_asc", text: "b" }, context(controller.signal));
  controller.abort(); release();
  assert.deepEqual(await late, { success: false, error: { code: "cancelled" } });
});

test("V3 parser failure never evaluates a hostile cursor getter", async () => {
  let evaluated = false;
  const input = { schemaVersion: 3, sort: "invalid", get cursor() { evaluated = true; throw new Error("private"); } };
  const port = createSearchKeywordReadPort({ catalog, loadPublication: async () => publication(), search: transport([]), nowMs: () => NOW });
  assert.deepEqual(await port.search(input, context()), { success: false, error: { code: "invalid_query" } });
  assert.equal(evaluated, false);
});
