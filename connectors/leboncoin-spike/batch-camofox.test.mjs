import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BATCH_PLAN, BATCH_PLAN_SHA256, DETAIL_BATCH_PLAN, DETAIL_BATCH_PLAN_SHA256,
  RESUME_BATCH_PLAN, RESUME_BATCH_PLAN_SHA256, SESSION_BATCH_PLAN, SESSION_BATCH_PLAN_SHA256, runBatch } from "./batch-camofox.mjs";
import { canonicalListingUrl } from "./batch-dom.mjs";
import { RESUME_CHECKPOINT } from "./batch-resume-checkpoint.mjs";
import { observeBatchPage } from "./batch-runtime.mjs";

function discoveryRecord(links, overrides = {}) {
  return { api_status: 200, navigation: { httpStatus: 200, url: BATCH_PLAN.start_url, navigationOk: true }, tab_closed: true,
    dom: { url: BATCH_PLAN.start_url, title: "Voitures", text: "", viewport: { width: 1280, height: 900 },
      frames: [], targets: { title: [], price: [] }, links: links.map((href) => ({ href, text: "Voiture", rel: "" })),
      page_status: {}, listing: { schema_version: "leboncoin-dom-observation/v1", titles: [], prices: [], criteria: [], photos: [], times: [], location: [] } },
    ...overrides };
}
const url = (i) => `https://www.leboncoin.fr/ad/voitures/${3300000000 + i}`;

test("direct route opens only known seeds and never the catalogue when no recommendations are observed", async () => {
  let clock = Date.parse("2026-11-22T20:00:00.000Z"); const calls = [];
  const result = await runBatch({ plan: DETAIL_BATCH_PLAN, now: () => clock, wait: async (ms) => { clock += ms; },
    observe: async ({ url: target, kind }) => {
      calls.push({ target, kind }); const started_at = new Date(clock).toISOString(); clock += 100;
      const record = discoveryRecord([]); record.navigation = { httpStatus: 404, url: target }; record.dom.url = target;
      return { started_at, completed_at: new Date(clock).toISOString(), record };
    } });
  assert.deepEqual(calls.map((item) => item.target), DETAIL_BATCH_PLAN.seed_urls);
  assert.ok(calls.every((item) => item.kind === "listing"));
  assert.equal(result.summary.discovery_pages_attempted, 0); assert.equal(result.summary.discovered, 3);
  assert.equal(result.summary.plan_sha256, DETAIL_BATCH_PLAN_SHA256);
  assert.equal(BATCH_PLAN_SHA256, "7910bfddfb612fe22acde23d2d5b73eaf3ffbb4099e4585a29ed1270cfd5de29");
});

test("the direct route stops on a refused known seed instead of trying another seed", async () => {
  let calls = 0;
  const result = await runBatch({ plan: DETAIL_BATCH_PLAN, observe: async ({ url: target }) => {
    calls += 1; const record = discoveryRecord([]); record.navigation = { httpStatus: 403, url: target }; record.dom.url = target;
    return { started_at: "2026-11-22T20:00:00.000Z", completed_at: "2026-11-22T20:00:01.000Z", record };
  } });
  assert.equal(calls, 1); assert.equal(result.summary.attempted, 1); assert.equal(result.summary.rejected, 1);
  assert.equal(result.summary.stop_reason, "source_refused");
});

test("the guarded route still stops at the first source refusal", async () => {
  let calls = 0;
  const result = await runBatch({ plan: SESSION_BATCH_PLAN, observe: async ({ url: target }) => {
    calls += 1;
    const record = discoveryRecord([], { navigation: { httpStatus: 403, url: target },
      session_continuity: { before: true, after: true } });
    record.dom.url = target;
    return { started_at: "2026-11-22T20:00:00.000Z", completed_at: "2026-11-22T20:00:01.000Z", record };
  } });
  assert.equal(calls, 1); assert.equal(result.summary.stop_reason, "source_refused");
  assert.equal(result.summary.local_session_guard_verified, true);
  assert.equal(result.summary.network_request_count, "not_measured");
  assert.equal(result.summary.plan_sha256, SESSION_BATCH_PLAN_SHA256);
  assert.notEqual(SESSION_BATCH_PLAN_SHA256, DETAIL_BATCH_PLAN_SHA256);
});

test("loss of the local guard stops new pages and preserves earlier qualified data", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/3305814470.json", import.meta.url), "utf8"));
  let calls = 0; let clock = Date.parse("2026-11-22T20:00:00.000Z"); const saved = [];
  const result = await runBatch({ plan: SESSION_BATCH_PLAN, now: () => clock, wait: async (ms) => { clock += ms; },
    observe: async ({ url: target }) => {
      calls += 1; const started_at = new Date(clock).toISOString(); clock += 100;
      const record = discoveryRecord([], { navigation: { httpStatus: 200, url: target },
        session_continuity: { before: true, after: calls === 1 } });
      record.dom.url = target; record.dom.listing = globalThis.structuredClone(fixture);
      return { started_at, completed_at: new Date(clock).toISOString(), record };
    }, onObservation: async ({ ordinal }) => { saved.push(ordinal); } });
  assert.equal(calls, 2); assert.equal(result.summary.stop_reason, "session_continuity_lost");
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].normalized.source.listing_id, "3305814470");
  assert.equal(result.summary.local_session_guard_verified, false); assert.deepEqual(saved, [1, 2]);
});

test("the guarded route cannot accept an observation without continuity proof", async () => {
  let calls = 0;
  const result = await runBatch({ plan: SESSION_BATCH_PLAN, observe: async () => {
    calls += 1;
    return { started_at: "2026-11-22T20:00:00.000Z", completed_at: "2026-11-22T20:00:01.000Z",
      record: discoveryRecord([]) };
  } });
  assert.equal(calls, 1); assert.equal(result.summary.stop_reason, "session_continuity_lost");
  assert.equal(result.summary.complete, 0); assert.equal(result.summary.local_session_guard_verified, false);
});

test("a guard lost before navigation does not count an unopened source page or report global continuity", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/3305814470.json", import.meta.url), "utf8"));
  let dispatches = 0; let clock = Date.parse("2026-11-22T20:00:00.000Z");
  const result = await runBatch({ plan: SESSION_BATCH_PLAN, now: () => clock, wait: async (ms) => { clock += ms; },
    observe: async ({ url: target }) => {
      dispatches += 1;
      if (dispatches === 2) throw Object.assign(new Error("session_continuity_lost"), { source_observation_started: false });
      const started_at = new Date(clock).toISOString(); clock += 100;
      const record = discoveryRecord([], { navigation: { httpStatus: 200, url: target },
        session_continuity: { before: true, after: true } });
      record.dom.url = target; record.dom.listing = globalThis.structuredClone(fixture);
      return { started_at, completed_at: new Date(clock).toISOString(), record };
    } });
  assert.equal(dispatches, 2); assert.equal(result.summary.attempted, 1); assert.equal(result.summary.complete, 1);
  assert.equal(result.summary.rejected, 0); assert.equal(result.measurements.length, 1);
  assert.equal(result.summary.pre_navigation_failures, 1); assert.equal(result.summary.session_continuity_lost, true);
  assert.equal(result.summary.local_session_guard_verified, false); assert.equal(result.summary.stop_reason, "session_continuity_lost");
});

test("source refusal remains visible when the local guard also disappears after that page", async () => {
  const result = await runBatch({ plan: SESSION_BATCH_PLAN, observe: async ({ url: target }) => {
    const record = discoveryRecord([], { navigation: { httpStatus: 403, url: target },
      session_continuity: { before: true, after: false }, error: "session_continuity_lost" });
    record.dom.url = target;
    return { started_at: "2026-11-22T20:00:00.000Z", completed_at: "2026-11-22T20:00:01.000Z", record };
  } });
  assert.equal(result.summary.stop_reason, "source_refused"); assert.equal(result.summary.session_continuity_lost, true);
  assert.equal(result.summary.attempted, 1); assert.equal(result.summary.pre_navigation_failures, 0);
  assert.equal(result.summary.local_session_guard_verified, false); assert.equal(result.measurements[0].navigation_status, 403);
});

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

test("a timer waking at 9999ms waits the residual interval before another navigation", async () => {
  let clock = Date.parse("2026-11-22T20:00:00.000Z"); const waits = []; const opens = [];
  const result = await runBatch({ now: () => clock, wait: async (ms) => {
    waits.push(ms); clock += waits.length === 1 ? 9999 : ms;
  }, observe: async ({ url: target, kind }) => {
    opens.push({ target, at: clock }); const started_at = new Date(clock).toISOString(); clock += 100;
    const record = discoveryRecord(kind === "discovery" ? [url(1)] : []);
    if (kind === "listing") { record.navigation = { httpStatus: 404, url: target }; record.dom.url = target; }
    return { started_at, completed_at: new Date(clock).toISOString(), record };
  } });
  assert.deepEqual(waits, [10_000, 2]);
  assert.equal(opens.length, 2); assert.equal(opens[1].target, url(1));
  assert.equal(opens[1].at - (opens[0].at + 100), 10_001);
  assert.equal(result.measurements[1].previous_gap_ms, 10_001);
  assert.equal(result.summary.stop_reason, null); assert.equal(result.summary.attempted, 1);
  assert.equal(result.summary.status, "sample_exhausted");
});

test("a wait making no clock progress stops immediately without another navigation", async () => {
  let clock = Date.parse("2026-11-22T20:00:00.000Z"); let calls = 0; const waits = [];
  const result = await runBatch({ now: () => clock, wait: async (ms) => { waits.push(ms); }, observe: async () => {
    calls += 1; const started_at = new Date(clock).toISOString(); clock += 100;
    return { started_at, completed_at: new Date(clock).toISOString(), record: discoveryRecord([url(1)]) };
  } });
  assert.equal(calls, 1); assert.equal(result.summary.stop_reason, "interval_not_met");
  assert.deepEqual(waits, [10_000]); assert.equal(result.summary.attempted, 0);
});

test("progressing but persistently early timers stop after three wakes with the 10000ms minimum intact", async () => {
  let clock = Date.parse("2026-11-22T20:00:00.000Z"); let calls = 0; const waits = [];
  const result = await runBatch({ now: () => clock, wait: async (ms) => { waits.push(ms); clock += 1; },
    observe: async () => {
      calls += 1; const started_at = new Date(clock).toISOString(); clock += 100;
      return { started_at, completed_at: new Date(clock).toISOString(), record: discoveryRecord([url(1)]) };
    } });
  assert.deepEqual(waits, [10_000, 9999, 9998]);
  assert.equal(calls, 1); assert.equal(result.summary.stop_reason, "interval_not_met");
  assert.equal(result.summary.attempted, 0); assert.equal(result.summary.status, "stopped");
});

test("resume checkpoint has 31 canonical unique candidates disjoint from 22 collected URLs and caps the remainder at 78", () => {
  const seeds = RESUME_CHECKPOINT.seed_urls; const excluded = RESUME_CHECKPOINT.previously_collected_urls;
  assert.equal(seeds.length, 31); assert.equal(new Set(seeds).size, 31);
  assert.equal(excluded.length, 22); assert.equal(new Set(excluded).size, 22);
  assert.ok([...seeds, ...excluded].every((target) => canonicalListingUrl(target) === target));
  assert.ok(seeds.every((target) => !excluded.includes(target)));
  assert.equal(RESUME_CHECKPOINT.collected, excluded.length);
  assert.equal(RESUME_CHECKPOINT.remaining_limit, 78);
  assert.equal(RESUME_CHECKPOINT.collected + RESUME_CHECKPOINT.remaining_limit, BATCH_PLAN.max_listing_pages);
  assert.deepEqual(RESUME_BATCH_PLAN.seed_urls, seeds); assert.deepEqual(RESUME_BATCH_PLAN.excluded_urls, excluded);
  assert.equal(RESUME_BATCH_PLAN.max_listing_pages, 78); assert.equal(RESUME_BATCH_PLAN.max_discovery_pages, 0);
  assert.equal(RESUME_BATCH_PLAN.start_url, null); assert.equal(RESUME_BATCH_PLAN.min_gap_ms, 10_000);
  assert.equal(RESUME_BATCH_PLAN.resume_from.run_id, RESUME_CHECKPOINT.run_id);
  assert.equal(RESUME_BATCH_PLAN.resume_from.source_revision, RESUME_CHECKPOINT.source_revision);
  assert.equal(RESUME_BATCH_PLAN.resume_from.batch_id, RESUME_CHECKPOINT.batch_id);
  assert.equal(RESUME_BATCH_PLAN.resume_from.plan_sha256, RESUME_CHECKPOINT.plan_sha256);
  assert.equal(RESUME_BATCH_PLAN.resume_from.collected, 22);
  assert.match(RESUME_BATCH_PLAN_SHA256, /^[a-f0-9]{64}$/u);
});

test("resume excludes collected seeds and recommended duplicates while reaching 78 complete new records without a 79th open", async () => {
  // Fixture-derived synthetic responses test the frontier only; no new live evidence.
  const fixture = JSON.parse(await readFile(new URL("./fixtures/3305814470.json", import.meta.url), "utf8"));
  const excluded = new Set(RESUME_BATCH_PLAN.excluded_urls);
  const fresh = Array.from({ length: 100 }, (_, index) => url(index + 1000));
  assert.ok(fresh.every((target) => !excluded.has(target) && !RESUME_BATCH_PLAN.seed_urls.includes(target)));
  const links = [...RESUME_BATCH_PLAN.excluded_urls.flatMap((target) => [target, `${target}?tracking=1#photo`]),
    ...RESUME_BATCH_PLAN.seed_urls.slice(0, 3), ...fresh];
  let clock = Date.parse("2026-11-22T20:00:00.000Z"); const calls = []; const retained = [];
  const result = await runBatch({ plan: RESUME_BATCH_PLAN, now: () => clock, wait: async (ms) => { clock += ms; },
    observe: async ({ url: target, kind }) => {
      calls.push({ target, kind }); const started_at = new Date(clock).toISOString(); clock += 100;
      const record = discoveryRecord(calls.length === 1 ? links : []);
      record.navigation = { httpStatus: 200, url: target, navigationOk: true };
      record.dom.url = target; record.dom.listing = globalThis.structuredClone(fixture);
      return { started_at, completed_at: new Date(clock).toISOString(), record };
    }, onObservation: async ({ ordinal }) => { retained.push(ordinal); return { capture_sha256: "b".repeat(64) }; } });
  assert.equal(calls.length, 78); assert.equal(new Set(calls.map((item) => item.target)).size, 78);
  assert.ok(calls.every((item) => item.kind === "listing" && !excluded.has(item.target)));
  assert.deepEqual(calls.slice(0, 31).map((item) => item.target), RESUME_BATCH_PLAN.seed_urls);
  assert.deepEqual(calls.slice(31).map((item) => item.target), fresh.slice(0, 47));
  assert.equal(result.summary.discovery_pages_attempted, 0); assert.equal(result.summary.attempted, 78);
  assert.equal(result.summary.complete, 78); assert.equal(result.entries.length, 78);
  assert.equal(result.summary.discovered, 131); assert.equal(result.summary.partial, 0); assert.equal(result.summary.rejected, 0);
  assert.equal(result.summary.status, "target_reached"); assert.equal(result.summary.stop_reason, null);
  assert.equal(result.summary.plan_sha256, RESUME_BATCH_PLAN_SHA256);
  assert.equal(result.summary.project_database_updated, false); assert.equal(result.summary.stored, 0);
  assert.deepEqual(retained, Array.from({ length: 78 }, (_, index) => index + 1));
  assert.ok(result.measurements.slice(1).every((item) => item.previous_gap_ms >= 10_000));
  assert.equal(new Set(result.entries.map((entry) => entry.normalized.source.original_url)).size, 78);
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
