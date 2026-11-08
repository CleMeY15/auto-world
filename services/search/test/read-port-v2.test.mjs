import assert from "node:assert/strict";
import { test } from "node:test";
import { SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE } from "@auto-world/synthetic-connector/demo";
import { createSearchReadPortV2 } from "../.prototype-dist/read-port-v2.js";

const NOW = Date.parse("2026-01-01T00:01:00.000Z");
const fixtureVersion = "synthetic-prototype-web-v2";
const catalog = { schemaVersion: 2, dataMode: "synthetic", fixtureVersion,
  taxonomyRelease: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE };
const taxonomyRelease = { catalogId: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.catalogId,
  releaseId: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.releaseId, revision: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.revision };
const listingId = `lst_${"1".repeat(64)}`;
const item = { listingId, availability: "active", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [],
  description: { status: "unavailable" }, descriptionEvidence: [] };
const publication = (overrides = {}) => ({ indexName: `aw-v2-search-${"a".repeat(32)}`, revision: 1, mappingVersion: 2,
  snapshot: { schemaVersion: 2, fixtureVersion, taxonomyRelease,
    mapperVersion: "synthetic-prototype-web-mapper-v2", profileFingerprint: `prf_${"b".repeat(64)}`,
    dataAsOf: "2026-01-01T00:00:30.000Z", completeness: "complete", fingerprint: "c".repeat(64) },
  documentCount: 1, pendingRelevant: false, ...overrides });
const context = (signal = new globalThis.AbortController().signal) => ({ requestId: `req_${"1".repeat(32)}`, signal });

test("V2 catalog, filters and detail are bound to the persistent publication", async () => {
  const calls = [];
  const port = createSearchReadPortV2({ catalog, loadPublication: async () => publication(), nowMs: () => NOW,
    search: {
      async searchV2(indexName, query, offset) { calls.push({ indexName, query, offset }); return { results: [item], total: 1 }; },
      async detailV2() { return item; },
    } });
  assert.deepEqual(await port.catalog(context()), { success: true, data: catalog });
  const result = await port.search({ schemaVersion: 2, sort: "price_asc", makeId: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.makes[0].makeId }, context());
  assert.equal(result.success, true);
  assert.equal(result.data.state, "complete");
  assert.equal(result.data.totalCount, 1);
  assert.equal(calls[0].offset, 0);
  assert.equal((await port.getListing(listingId, context())).success, true);
});

test("V2 refuses mismatched release, V1 publication and malformed queries without transport fallback", async () => {
  let current = publication({ mappingVersion: 1 });
  let calls = 0;
  const port = createSearchReadPortV2({ catalog, loadPublication: async () => current, nowMs: () => NOW,
    search: { async searchV2() { calls += 1; return { results: [], total: 0 }; }, async detailV2() { calls += 1; return null; } } });
  assert.deepEqual(await port.search({ schemaVersion: 2, sort: "listing_asc" }, context()), { success: false, error: { code: "read_unavailable" } });
  current = publication({ snapshot: { ...publication().snapshot, fixtureVersion: "other-fixture" } });
  assert.deepEqual(await port.catalog(context()), { success: false, error: { code: "read_unavailable" } });
  assert.deepEqual(await port.search({ schemaVersion: 2, sort: "invalid" }, context()), { success: false, error: { code: "invalid_query" } });
  assert.equal(calls, 0);
});
