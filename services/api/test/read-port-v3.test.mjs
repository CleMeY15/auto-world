import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticDescriptionHarness } from "@auto-world/synthetic-connector/demo";
import { createSyntheticDemoKeywordReadPort, createSyntheticDemoReadPortV2, createSyntheticDemoReadPortsV2V3 } from "../demo/createSyntheticDemoReadPort.mjs";

const NOW = Date.parse("2026-10-14T10:00:00.000Z");
const context = (signal = new globalThis.AbortController().signal) => ({
  requestId: "req_0123456789abcdef0123456789abcdef", signal,
});
const query = (overrides = {}) => ({ schemaVersion: 3, sort: "listing_asc", ...overrides });

async function harnessFor(name = "descriptionBaseline") {
  const harness = createSyntheticDescriptionHarness({ initialTime: NOW });
  assert.equal((await harness.run(name, { invocationKey: `v3-${name}`,
    ...(name === "descriptionPagination" ? { limits: { maxPageBytes: 64 * 1024, maxJsonMembers: 5_000, maxItems: 100 } } : {}) })).status, "completed");
  return harness;
}

test("offline V3 matches current primary labels with every existing sort and structured filters", async () => {
  const harness = await harnessFor();
  const port = await createSyntheticDemoKeywordReadPort({ harness, nowMs: () => harness.time.clock.nowMs() });
  for (const sort of ["listing_asc", "price_asc", "price_desc", "mileage_asc", "mileage_desc"]) {
    const found = await port.search(query({ sort, text: "  MODÈLE, A1 ", makeId: "make_aurora_fictive",
      modelId: "model_aurora_a1_fictif", firstRegistrationYear: 2022 }), context());
    assert.equal(found.success, true, `${sort}: ${JSON.stringify(found)}`);
    assert.equal(found.data.results.every((item) => item.description.status === "authored_synthetic" &&
      item.description.value.modelId === "model_aurora_a1_fictif"), true);
  }
  const unknown = await port.search(query({ text: "modele introuvable" }), context());
  assert.equal(unknown.success, true);
  assert.equal(unknown.data.results.length, 0);
  assert.equal(unknown.data.totalCount, 0);
});

test("offline V3 excludes historical-only descriptions and never widens invalid text", async () => {
  const harness = await harnessFor();
  assert.equal((await harness.run("descriptionOmittedDelta", { mode: "incremental", invocationKey: "v3-omitted" })).status, "completed");
  const v2 = await createSyntheticDemoReadPortV2({ harness, nowMs: () => harness.time.clock.nowMs() });
  const v3 = await createSyntheticDemoKeywordReadPort({ harness, nowMs: () => harness.time.clock.nowMs() });
  const all = await v2.search({ schemaVersion: 2, sort: "listing_asc" }, context());
  const historical = all.data.results.find((item) => item.description.status === "unavailable" && item.descriptionEvidence.length > 0);
  assert.ok(historical);
  const keyword = await v3.search(query({ text: "fictif" }), context());
  assert.equal(keyword.success, true);
  assert.equal(keyword.data.results.some((item) => item.listingId === historical.listingId), false);
  assert.deepEqual(await v3.search(query({ text: "!!!" }), context()), { success: false, error: { code: "invalid_query" } });
  const controller = new globalThis.AbortController(); controller.abort("private");
  assert.deepEqual(await v3.search(query({ text: "fictif" }), context(controller.signal)), { success: false, error: { code: "cancelled" } });
});

test("offline V3 cursor replays normalized text and rejects changed text and V2 tokens", async () => {
  const harness = await harnessFor("descriptionPagination");
  const v2 = await createSyntheticDemoReadPortV2({ harness, nowMs: () => harness.time.clock.nowMs() });
  const v3 = await createSyntheticDemoKeywordReadPort({ harness, nowMs: () => harness.time.clock.nowMs() });
  const first = await v3.search(query({ text: "fictif" }), context());
  assert.equal(first.success, true);
  assert.equal(first.data.results.length, 20);
  assert.match(first.data.nextCursor, /^cur_[a-f0-9]{64}$/u);
  const next = await v3.search(query({ text: " FICTIF ", cursor: first.data.nextCursor }), context());
  assert.equal(next.success, true);
  assert.deepEqual(await v3.search(query({ text: "modele", cursor: first.data.nextCursor }), context()),
    { success: false, error: { code: "invalid_cursor" } });
  const old = await v2.search({ schemaVersion: 2, sort: "listing_asc" }, context());
  assert.equal(old.success, true);
  assert.deepEqual(await v3.search(query({ text: "fictif", cursor: old.data.nextCursor }), context()),
    { success: false, error: { code: "invalid_cursor" } });
});

test("offline server pair shares one snapshot and data watermark while owning separate cursors", async () => {
  const harness = await harnessFor("descriptionPagination");
  const { readPortV2, keywordReadPort } = await createSyntheticDemoReadPortsV2V3({ harness,
    nowMs: () => harness.time.clock.nowMs(), randomBytes: () => new Uint8Array(32).fill(6) });
  const structured = await readPortV2.search({ schemaVersion: 2, sort: "listing_asc" }, context());
  const keyword = await keywordReadPort.search(query({ text: "fictif" }), context());
  assert.equal(structured.success, true); assert.equal(keyword.success, true);
  assert.equal(keyword.data.dataAsOf, structured.data.dataAsOf);
  assert.equal(keyword.data.fixtureVersion, structured.data.fixtureVersion);
  assert.notEqual(keyword.data.nextCursor, structured.data.nextCursor);
  assert.deepEqual(await keywordReadPort.search(query({ text: "fictif", cursor: structured.data.nextCursor }), context()),
    { success: false, error: { code: "invalid_cursor" } });
});
