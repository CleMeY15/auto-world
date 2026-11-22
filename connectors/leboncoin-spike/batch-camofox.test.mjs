import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BATCH_PLAN, runBatch } from "./batch-camofox.mjs";
import { observeBatchPage } from "./batch-runtime.mjs";

function discoveryRecord(links, overrides = {}) {
  return { api_status: 200, navigation: { httpStatus: 200, url: BATCH_PLAN.start_url, navigationOk: true }, tab_closed: true,
    dom: { url: BATCH_PLAN.start_url, title: "Voitures", text: "", viewport: { width: 1280, height: 900 },
      frames: [], targets: { title: [], price: [] }, links: links.map((href) => ({ href, text: "Voiture", rel: "" })),
      page_status: {}, listing: { schema_version: "leboncoin-dom-observation/v1", titles: [], prices: [], criteria: [], photos: [], times: [], location: [] } },
    ...overrides };
}
const url = (i) => `https://www.leboncoin.fr/ad/voitures/${3300000000 + i}`;

test("a later refusal preserves the earlier complete observation and balanced counts", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/3305814470.json", import.meta.url), "utf8"));
  const first = "https://www.leboncoin.fr/ad/voitures/3305814470";
  let clock = Date.parse("2026-11-22T20:00:00.000Z"); const retained = [];
  const result = await runBatch({ now: () => clock, wait: async (ms) => { clock += ms; },
    observe: async ({ url: target, kind }) => {
      const started_at = new Date(clock).toISOString(); clock += 100;
      let record;
      if (kind === "discovery") record = discoveryRecord([first, url(2)]);
      else {
        record = discoveryRecord([]);
        record.navigation = { httpStatus: target === first ? 200 : 403, url: target };
        record.dom.url = target; record.dom.listing = globalThis.structuredClone(fixture);
      }
      return { started_at, completed_at: new Date(clock).toISOString(), record };
    }, onObservation: async ({ ordinal }) => { retained.push(ordinal); return { capture_sha256: "a".repeat(64) }; } });
  assert.equal(result.entries.length, 1); assert.equal(result.summary.complete, 1);
  assert.equal(result.summary.attempted, 2); assert.equal(result.summary.rejected, 1);
  assert.equal(result.summary.stored, 0); assert.equal(result.summary.status, "stopped");
  assert.deepEqual(retained, [1, 2, 3]);
  assert.equal(result.entries[0].normalized.source.listing_id, "3305814470");
});

test("batch stops at 100 distinct detail opens and does not trust duplicate/offsite URLs", async () => {
  let clock = Date.parse("2026-11-22T20:00:00.000Z"); const calls = [];
  const result = await runBatch({ now: () => clock, wait: async (ms) => { clock += ms; },
    observe: async ({ url: target, kind }) => {
      calls.push(target); const started_at = new Date(clock).toISOString(); clock += 100;
      const record = kind === "discovery" ? discoveryRecord([...Array.from({ length: 120 }, (_, i) => url(i + 1)), url(1), "https://example.com/ad/voitures/1"])
        : { ...discoveryRecord([]), navigation: { httpStatus: 404, url: target }, dom: { ...discoveryRecord([]).dom, url: target } };
      return { started_at, completed_at: new Date(clock).toISOString(), record };
    } });
  assert.equal(result.summary.discovery_pages_attempted, 1);
  assert.equal(result.summary.attempted, 100);
  assert.equal(new Set(calls).size, 101);
  assert.ok(result.measurements.slice(1).every((item) => item.previous_gap_ms >= 10_000));
});

test("HTTP403 stops the frontier without retrying or reaching detail pages", async () => {
  let calls = 0;
  const result = await runBatch({ observe: async () => {
    calls += 1; return { started_at: "2026-11-22T20:00:00.000Z", completed_at: "2026-11-22T20:00:01.000Z",
      record: discoveryRecord([url(1)], { navigation: { httpStatus: 403, url: BATCH_PLAN.start_url } }) };
  } });
  assert.equal(calls, 1); assert.equal(result.summary.attempted, 0);
  assert.equal(result.summary.status, "stopped"); assert.ok(result.summary.stop_reason);
});

test("a shortened wait never starts another navigation", async () => {
  let clock = Date.parse("2026-11-22T20:00:00.000Z"); let calls = 0;
  const result = await runBatch({ now: () => clock, wait: async () => {}, observe: async () => {
    calls += 1; const started_at = new Date(clock).toISOString(); clock += 100;
    return { started_at, completed_at: new Date(clock).toISOString(), record: discoveryRecord([url(1)]) };
  } });
  assert.equal(calls, 1); assert.equal(result.summary.stop_reason, "interval_not_met");
});

test("evidence output failure stops without using links from that page", async () => {
  let calls = 0;
  const result = await runBatch({ observe: async () => {
    calls += 1; return { started_at: "2026-11-22T20:00:00.000Z", completed_at: "2026-11-22T20:00:01.000Z", record: discoveryRecord([url(1)]) };
  }, onObservation: async () => { throw new Error("disk full"); } });
  assert.equal(calls, 1); assert.equal(result.summary.stop_reason, "evidence_output_failed"); assert.equal(result.entries.length, 0);
});

test("page open makes one navigation, one DOM read and one close", async () => {
  const calls = []; let clock = 0;
  const capture = await observeBatchPage(async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === "/tabs") return { status: 200, data: { tabId: "tab_1", httpStatus: 200, url: url(1), navigationOk: true } };
    if (method === "DELETE") return { status: 200, data: { ok: true } };
    return { status: 200, data: { ok: true, result: { url: url(1) } } };
  }, url(1), { wait: async (ms) => { clock += ms; }, now: () => clock });
  assert.equal(calls.filter((item) => item.path === "/tabs").length, 1);
  assert.equal(calls.length, 3); assert.equal(capture.record.tab_closed, true); assert.equal(capture.record.dom.url, url(1));
});

test("DOM read failure still closes its tab and is never retried", async () => {
  const calls = [];
  const capture = await observeBatchPage(async (method, path) => {
    calls.push({ method, path });
    if (path === "/tabs") return { status: 200, data: { tabId: "tab_1", httpStatus: 200, url: url(1) } };
    if (method === "DELETE") return { status: 200, data: { ok: true } };
    throw new Error("unavailable");
  }, url(1), { wait: async () => {} });
  assert.equal(calls.length, 3); assert.equal(capture.record.error, "operation_failed"); assert.equal(capture.record.tab_closed, true);
});

test("batch's public summary contains no listing text or image URLs", async () => {
  const result = await runBatch({ observe: async () => ({ started_at: "2026-11-22T20:00:00.000Z", completed_at: "2026-11-22T20:00:01.000Z",
    record: discoveryRecord([]) }) });
  assert.equal(result.summary.project_database_updated, false);
  assert.equal(result.summary.photos_downloaded, false);
  assert.equal(JSON.stringify(result.summary).includes("https://"), false);
});
