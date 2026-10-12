/* global AbortController */
import assert from "node:assert/strict";
import test from "node:test";
import { appendSearchPage, createSearchPagination, loadSavedDetails } from "../.test-dist/src/demo/client.js";
import { parseFilterInput } from "../.test-dist/src/demo/model.js";

const NOW = "2026-10-12T08:00:00.000Z";
const cursor = `cur_${"a".repeat(64)}`;
function result(index, evidenceId) { return { listingId: `lst_demo_${index}`, availability: "active", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: evidenceId === undefined ? [] : [{ evidenceId, field: "price", observedAt: NOW, confidenceBps: 9000, value: { amountMinor: 100, currency: "EUR" } }] }; }
function page(results, overrides = {}) { return { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "fixture-v1", dataAsOf: NOW, state: "complete", results, totalCount: 3, ...overrides }; }
function partialPage(results, overrides = {}) { return { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "fixture-v1", dataAsOf: NOW, state: "partial", reason: "projection_incomplete", results, ...overrides }; }
function stalePage(results, overrides = {}) { return { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: "fixture-v1", dataAsOf: NOW, state: "stale", reason: "projection_stale", results, ...overrides }; }

test("filter input produces only the public deterministic query", () => {
  assert.deepEqual(parseFilterInput({ priceMaxEUR: "12 000", mileageMaxKm: "20", sort: "price_asc", text: "" }), { ok: false, code: "invalid_filter", field: "priceMaxEUR" });
  assert.deepEqual(parseFilterInput({ priceMaxEUR: "12000,50", mileageMaxKm: "20000.5", sort: "price_asc", text: "" }), { ok: true, query: { schemaVersion: 1, sort: "price_asc", priceMaxMinor: 1_200_050, mileageMaxKm: 20_000.5 } });
  assert.deepEqual(parseFilterInput({ priceMaxEUR: "", mileageMaxKm: "", sort: "listing_asc", text: "SUV familial" }), { ok: false, code: "unsupported_text", field: "text" });
});

test("pagination preserves order and rejects snapshot, listing and evidence mixing", () => {
  const first = page([result(1)], { nextCursor: cursor, totalCount: 2 });
  const last = page([result(2)], { totalCount: 2 });
  const appended = appendSearchPage(first, last);
  assert.equal(appended.ok, true);
  assert.deepEqual(appended.data.results.map((item) => item.listingId), ["lst_demo_1", "lst_demo_2"]);
  assert.deepEqual(appendSearchPage(first, page([result(2)], { fixtureVersion: "fixture-v2" })), { ok: false, code: "changed_snapshot" });
  assert.deepEqual(appendSearchPage(first, page([result(1)], { totalCount: 2 })), { ok: false, code: "duplicate_result" });
  const evidence = `ev_${"b".repeat(64)}`;
  assert.deepEqual(appendSearchPage(page([result(1, evidence)], { nextCursor: cursor }), page([result(2, evidence)])), { ok: false, code: "duplicate_result" });
  assert.deepEqual(appendSearchPage(page([result(1)], { nextCursor: cursor }), page([result(2)], { totalCount: 3 })), { ok: false, code: "inconsistent_page" });
});

test("saved details uses at most four workers, preserves insertion order and stops on abort", async () => {
  let active = 0;
  let maximum = 0;
  const client = { async listing(listingId, { signal } = {}) { active += 1; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1; return signal?.aborted ? { ok: false, code: "cancelled" } : { ok: false, code: "not_found" }; }, async search() { throw new Error("unused"); } };
  const ids = Array.from({ length: 100 }, (_, index) => `lst_saved_${index}`);
  const loaded = await loadSavedDetails(client, ids);
  assert.equal(maximum, 4);
  assert.deepEqual(loaded.map((item) => item.listingId), ids);
  const controller = new AbortController();
  const seen = [];
  const pending = loadSavedDetails(client, ids, { signal: controller.signal, onItem(item) { seen.push(item); controller.abort(); } });
  await pending;
  assert.equal(seen.length, 1);
});

test("pagination generation rejects late first and continuation pages", () => {
  const pagination = createSearchPagination();
  const oldSearch = pagination.beginSearch();
  const currentSearch = pagination.beginSearch();
  assert.deepEqual(pagination.acceptFirst(oldSearch, page([result(9)], { totalCount: 1 })), { ok: false, code: "late_page" });
  assert.equal(pagination.acceptFirst(currentSearch, page([result(1)], { totalCount: 2, nextCursor: cursor })).ok, true);
  const oldNext = pagination.beginNext();
  const replacement = pagination.beginSearch();
  assert.deepEqual(pagination.acceptNext(oldNext, page([result(2)], { totalCount: 2 })), { ok: false, code: "late_page" });
  assert.equal(pagination.acceptFirst(replacement, page([result(3)], { totalCount: 1 })).ok, true);
});

test("pagination state can only remain stable or degrade monotonically to stale", () => {
  const complete = page([result(1)], { nextCursor: cursor, totalCount: 2 });
  const partial = partialPage([result(1)], { nextCursor: cursor });
  const stale = stalePage([result(1)], { nextCursor: cursor });
  assert.deepEqual(appendSearchPage(complete, partialPage([result(2)])), { ok: false, code: "changed_state" });
  assert.deepEqual(appendSearchPage(partial, page([result(2)], { totalCount: 2 })), { ok: false, code: "changed_state" });
  assert.deepEqual(appendSearchPage(stale, page([result(2)], { totalCount: 2 })), { ok: false, code: "changed_state" });
  const degradedComplete = appendSearchPage(complete, stalePage([result(2)]));
  assert.equal(degradedComplete.ok, true);
  assert.equal(degradedComplete.data.state, "stale");
  const degradedPartial = appendSearchPage(partial, stalePage([result(2)]));
  assert.equal(degradedPartial.ok, true);
  assert.equal(degradedPartial.data.state, "stale");
  const stillStale = appendSearchPage(stale, stalePage([result(2)]));
  assert.equal(stillStale.ok, true);
  assert.equal(stillStale.data.state, "stale");
});
