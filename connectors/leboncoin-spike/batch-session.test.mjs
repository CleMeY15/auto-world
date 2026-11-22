import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { createBatchSessionGuard } from "./batch-session.mjs";
import { observeBatchPage } from "./batch-runtime.mjs";

const FIRST = "https://www.leboncoin.fr/ad/voitures/3305814470";
const SECOND = "https://www.leboncoin.fr/ad/voitures/3312238672";
const USER_ID = "autofindex-bounded-batch";
const INITIAL_TIME = Date.parse("2026-11-22T21:00:00.000Z");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * Deterministic API model, not a browser or a claim about live-site access.
 * At each 60s tick, an empty session is reaped without an extra grace period.
 * The local evaluate expressions run unchanged in isolated JavaScript contexts.
 */
function simulatedApi(options = {}) {
  let clock = INITIAL_TIME; let nextReap = clock + 60_000;
  let session = null; let contexts = 0; let sequence = 0; let reaped = 0;
  let anchor = null; let maxPages = 0; let sourceCreations = 0; let sourceDeletes = 0; let anchorDeletes = 0;
  let failSourceEvaluate = false; let loseAfterSourceClose = false; let failAnchorDelete = false;
  let failSourceDelete = false; let heldSource = null;
  const calls = []; const sourceContexts = [];
  const tick = () => {
    while (clock >= nextReap) {
      if (session && session.pages.size === 0) { session = null; reaped += 1; }
      nextReap += 60_000;
    }
  };
  const advance = (ms) => { clock += ms; tick(); };
  const api = async (method, path, body, timeoutMs) => {
    calls.push({ method, path, body, timeoutMs });
    advance(1);
    if (method === "POST" && path === "/tabs") {
      if (!session) session = { id: ++contexts, pages: new Map(), toolCalls: 0 };
      assert.equal(body.userId, USER_ID); assert.equal(body.sessionKey, "batch100");
      const local = !Object.hasOwn(body, "url");
      const id = `tab_${++sequence}`;
      const url = local ? "about:blank" : body.url;
      const page = { id, local, url, sandbox: createContext({ location: { href: url } }) };
      session.pages.set(id, page); maxPages = Math.max(maxPages, session.pages.size);
      if (local) anchor = page;
      else {
        sourceCreations += 1; sourceContexts.push(session.id);
        if (heldSource) { heldSource.started.resolve(); await heldSource.release.promise; }
      }
      return { status: 200, data: { tabId: local && options.invalidAnchorId ? "../invalid" : id,
        url: local && options.wrongAnchorUrl ? "https://example.invalid/unexpected" : url,
        httpStatus: local ? null : options.sourceStatus ?? 200, navigationOk: true } };
    }
    const match = /^\/tabs\/([A-Za-z0-9_-]+)(?:\/evaluate|\?userId=autofindex-bounded-batch)$/u.exec(path);
    assert.ok(match, "only local tab read/close API operations are expected");
    const page = session?.pages.get(match[1]);
    if (method === "POST" && path.endsWith("/evaluate")) {
      assert.equal(body.userId, USER_ID);
      if (!page) return { status: 404, data: { ok: false } };
      session.toolCalls += 1;
      if (page.local) {
        if (options.failInitialization && session.toolCalls === 1) throw new Error("synthetic local evaluation failure");
        return { status: 200, data: { ok: true, result: runInContext(body.expression, page.sandbox, { timeout: 500 }) } };
      }
      if (failSourceEvaluate) throw new Error("synthetic source DOM failure");
      return { status: 200, data: { ok: true, result: { url: page.url, title: "Synthetic listing",
        text: "Synthetic fixture only", viewport: { width: 1000, height: 800 }, frames: [],
        targets: { title: [], price: [] }, links: [], page_status: { texts: [], notice_only: false },
        listing: { schema_version: "leboncoin-dom-observation/v1", titles: ["Synthetic listing"], prices: ["1 000 €"],
          criteria: [], photos: [], times: [], location: [] } } } };
    }
    assert.equal(method, "DELETE");
    if (match[1] === anchor?.id) {
      anchorDeletes += 1;
      if (failAnchorDelete) throw new Error("synthetic close failure");
    } else {
      sourceDeletes += 1;
      if (failSourceDelete) return { status: 500, data: { ok: false } };
    }
    if (!page) return { status: 404, data: { ok: false } };
    session.pages.delete(page.id);
    if (!page.local && loseAfterSourceClose && anchor) session.pages.delete(anchor.id);
    return { status: 200, data: { ok: true } };
  };
  return { api, calls, advance, now: () => clock, wait: async (ms) => { advance(ms); },
    metrics: () => ({ contexts, reaped, maxPages, sourceCreations, sourceDeletes, anchorDeletes,
      currentPages: session?.pages.size ?? 0, sourceContexts: [...sourceContexts] }),
    loseAnchor: () => { session?.pages.delete(anchor?.id); },
    replaceAnchorGlobal: () => { anchor.sandbox = createContext({ location: { href: "about:blank" } }); },
    changeAnchorUrl: () => { anchor.sandbox.location.href = "about:blank#changed"; },
    failSourceEvaluate: () => { failSourceEvaluate = true; },
    loseAfterSourceClose: () => { loseAfterSourceClose = true; },
    failAnchorDelete: () => { failAnchorDelete = true; },
    failSourceDelete: () => { failSourceDelete = true; },
    holdNextSource: () => { heldSource = { started: deferred(), release: deferred() }; return heldSource; },
    markerValue: () => anchor?.sandbox.__autofindex_batch_session_nonce__,
  };
}

test("guard creates exactly one local blank page without a navigation URL and no source calls", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(fake.calls[0].body, { userId: USER_ID, sessionKey: "batch100" });
  assert.equal(Object.hasOwn(fake.calls[0].body, "url"), false);
  assert.equal(fake.metrics().sourceCreations, 0);
  assert.match(fake.markerValue(), /^[a-f0-9]{64}$/u);
  assert.deepEqual(guard.stats(), { anchor_creation_calls: 1, anchor_initialized: true,
    continuity_checks: 0, continuity_failures: 0, source_observations_started: 0, source_observations_completed: 0,
    continuity_lost: false, halted: false, stop_reason: null, close_calls: 0, closed: false });
  await guard.close();
});

test("old last-tab closure loses its modeled context at a reaper tick, while a guarded session survives", async () => {
  const old = simulatedApi();
  await observeBatchPage(old.api, FIRST, old);
  old.advance(61_000);
  await observeBatchPage(old.api, SECOND, old);
  assert.deepEqual(old.metrics().sourceContexts, [1, 2]); assert.equal(old.metrics().reaped, 1);

  const kept = simulatedApi(); const guard = await createBatchSessionGuard(kept.api, kept);
  const first = await guard.observe(FIRST);
  kept.advance(61_000);
  const second = await guard.observe(SECOND);
  assert.deepEqual(kept.metrics().sourceContexts, [1, 1]); assert.equal(kept.metrics().reaped, 0);
  assert.equal(kept.metrics().maxPages, 2); assert.equal(kept.metrics().currentPages, 1);
  assert.deepEqual(first.record.session_continuity, { before: true, after: true });
  assert.deepEqual(second.record.session_continuity, { before: true, after: true });
  assert.equal(guard.stats().continuity_checks, 4);
  assert.equal(guard.stats().source_observations_completed, 2);
  assert.equal(new Date(second.completed_at).getTime(), kept.now());
  assert.deepEqual(await guard.close(), { established: true, tab_closed: true });
  assert.equal(kept.metrics().currentPages, 0);
});

test("a lost local page prevents the next source open and is never recreated", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  fake.loseAnchor();
  await assert.rejects(guard.observe(FIRST), { message: "session_continuity_lost", source_observation_started: false });
  const count = fake.calls.length;
  await assert.rejects(guard.observe(SECOND), /session_unavailable/u);
  assert.equal(fake.calls.length, count); assert.equal(fake.metrics().sourceCreations, 0);
  assert.equal(guard.stats().anchor_creation_calls, 1); assert.equal(guard.stats().continuity_failures, 1);
  assert.equal(guard.stats().continuity_lost, true);
  await guard.close();
});

test("the same local URL without the original nonce cannot establish continuity", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  fake.replaceAnchorGlobal();
  await assert.rejects(guard.observe(FIRST), /session_continuity_lost/u);
  assert.equal(fake.metrics().sourceCreations, 0); assert.equal(guard.stats().continuity_lost, true);
  await guard.close();
});

test("the original nonce at a changed local URL cannot establish continuity", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  fake.changeAnchorUrl();
  await assert.rejects(guard.observe(FIRST), /session_continuity_lost/u);
  assert.equal(fake.metrics().sourceCreations, 0); await guard.close();
});

test("non-string and off-origin targets cannot open a source tab", async () => {
  for (const target of [null, undefined, {}, "https://example.invalid/ad/voitures/3305814470"]) {
    const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
    const calls = fake.calls.length;
    await assert.rejects(guard.observe(target), /invalid_target/u);
    assert.equal(fake.calls.length, calls); assert.equal(fake.metrics().sourceCreations, 0);
    await assert.rejects(guard.observe(FIRST), /session_unavailable/u);
    await guard.close();
  }
});

test("loss after a source observation returns its capture with explicit failure and latches", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  fake.loseAfterSourceClose();
  const capture = await guard.observe(FIRST);
  assert.equal(capture.record.navigation.httpStatus, 200); assert.equal(capture.record.dom.url, FIRST);
  assert.equal(capture.record.tab_closed, true); assert.equal(capture.record.error, "session_continuity_lost");
  assert.deepEqual(capture.record.session_continuity, { before: true, after: false });
  assert.equal(new Date(capture.completed_at).getTime(), fake.now());
  const count = fake.calls.length;
  await assert.rejects(guard.observe(SECOND), /session_unavailable/u);
  assert.equal(fake.calls.length, count); assert.equal(fake.metrics().sourceCreations, 1);
  assert.equal(guard.stats().source_observations_completed, 1);
  await guard.close();
});

test("post-observation timestamp includes the local check after source-tab cleanup", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  const capture = await guard.observe(FIRST);
  const closeIndex = fake.calls.findIndex((call) => call.method === "DELETE");
  assert.equal(fake.calls[closeIndex + 1].method, "POST");
  assert.ok(fake.calls[closeIndex + 1].path.endsWith("/evaluate"));
  assert.equal(new Date(capture.completed_at).getTime(), fake.now());
  assert.equal(fake.calls.at(-1).path, "/tabs/tab_1/evaluate");
  await guard.close();
});

test("source DOM failure still closes the source tab, preserves its error and prevents another open", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  fake.failSourceEvaluate();
  const capture = await guard.observe(FIRST);
  assert.equal(capture.record.error, "operation_failed"); assert.equal(capture.record.tab_closed, true);
  assert.deepEqual(capture.record.session_continuity, { before: true, after: true });
  assert.equal(guard.stats().continuity_lost, false); assert.equal(guard.stats().halted, true);
  const count = fake.calls.length;
  await assert.rejects(guard.observe(SECOND), /session_unavailable/u);
  assert.equal(fake.calls.length, count); assert.equal(fake.metrics().sourceDeletes, 1);
  assert.deepEqual(await guard.close(), { established: true, tab_closed: true });
});

test("an unclosed source tab latches even when the local continuity marker remains valid", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  fake.failSourceDelete();
  const capture = await guard.observe(FIRST);
  assert.equal(capture.record.tab_closed, false);
  assert.deepEqual(capture.record.session_continuity, { before: true, after: true });
  await assert.rejects(guard.observe(SECOND), /session_unavailable/u);
  assert.equal(fake.metrics().sourceCreations, 1); assert.equal(fake.metrics().maxPages, 2);
  await guard.close();
});

test("HTTP403 or429 is not retried through a new page or another source observation", async () => {
  for (const sourceStatus of [403, 429]) {
    const fake = simulatedApi({ sourceStatus }); const guard = await createBatchSessionGuard(fake.api, fake);
    const capture = await guard.observe(FIRST);
    assert.equal(capture.record.navigation.httpStatus, sourceStatus);
    assert.deepEqual(capture.record.session_continuity, { before: true, after: true });
    const count = fake.calls.length;
    await assert.rejects(guard.observe(SECOND), /session_unavailable/u);
    assert.equal(fake.calls.length, count); assert.equal(fake.metrics().sourceCreations, 1);
    assert.equal(guard.stats().stop_reason, "source_refused"); await guard.close();
  }
});

test("initialization failure cleans a known local tab and exposes only a fixed error", async () => {
  for (const options of [{ failInitialization: true }, { wrongAnchorUrl: true }]) {
    const fake = simulatedApi(options);
    await assert.rejects(createBatchSessionGuard(fake.api, fake), { message: "session_initialization_failed" });
    assert.equal(fake.metrics().anchorDeletes, 1); assert.equal(fake.metrics().currentPages, 0);
    assert.equal(fake.metrics().sourceCreations, 0);
  }
});

test("malformed local identifiers are never interpolated into a read or deletion path", async () => {
  const fake = simulatedApi({ invalidAnchorId: true });
  await assert.rejects(createBatchSessionGuard(fake.api, fake), { message: "session_initialization_failed" });
  assert.equal(fake.calls.length, 1); assert.equal(fake.metrics().sourceCreations, 0);
});

test("close is idempotent, sends one local deletion and prevents subsequent observations", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  const first = guard.close(); const second = guard.close();
  assert.equal(first, second);
  assert.deepEqual(await first, { established: true, tab_closed: true });
  assert.deepEqual(await guard.close(), { established: true, tab_closed: true });
  assert.equal(fake.metrics().anchorDeletes, 1); assert.equal(guard.stats().close_calls, 1);
  assert.equal(guard.stats().closed, true);
  const count = fake.calls.length;
  await assert.rejects(guard.observe(FIRST), /session_unavailable/u); assert.equal(fake.calls.length, count);
});

test("unconfirmed local cleanup stays unconfirmed and is not retried by close", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  fake.failAnchorDelete();
  assert.deepEqual(await guard.close(), { established: false, tab_closed: false });
  assert.deepEqual(await guard.close(), { established: false, tab_closed: false });
  assert.equal(fake.metrics().anchorDeletes, 1); assert.equal(guard.stats().closed, false);
});

test("concurrent observations cannot open two source tabs and close waits for the active one", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  const held = fake.holdNextSource();
  const first = guard.observe(FIRST);
  await held.started.promise;
  await assert.rejects(guard.observe(SECOND), /session_busy/u);
  const closing = guard.close();
  assert.equal(fake.metrics().anchorDeletes, 0);
  await assert.rejects(guard.observe(SECOND), /session_unavailable/u);
  held.release.resolve();
  const capture = await first; const cleanup = await closing;
  assert.deepEqual(capture.record.session_continuity, { before: true, after: true });
  assert.deepEqual(cleanup, { established: true, tab_closed: true });
  assert.equal(fake.metrics().sourceCreations, 1); assert.equal(fake.metrics().maxPages, 2);
  assert.equal(fake.metrics().sourceDeletes, 1); assert.equal(fake.metrics().anchorDeletes, 1);
});

test("statistics are closed scalar metadata without marker, tab identity, source URL or evaluation code", async () => {
  const fake = simulatedApi(); const guard = await createBatchSessionGuard(fake.api, fake);
  const marker = fake.markerValue();
  await guard.observe(FIRST); await guard.close();
  const stats = guard.stats(); const serialized = JSON.stringify(stats);
  assert.equal(serialized.includes(marker), false); assert.equal(serialized.includes("tab_1"), false);
  assert.equal(serialized.includes(FIRST), false); assert.equal(serialized.includes("globalThis"), false);
  assert.equal(serialized.includes("about:blank"), false);
  assert.ok(Object.values(stats).every((value) => value === null || ["number", "boolean", "string"].includes(typeof value)));
  assert.equal(Object.isFrozen(stats), true);
  assert.ok(fake.calls.every((call) => !call.path.includes("/navigate")));
});
