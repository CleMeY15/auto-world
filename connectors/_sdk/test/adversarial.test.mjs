import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers";
import { test } from "node:test";
import * as sdk from "@auto-world/connector-sdk";
import {
  activeItem, adapter, copy, fakeLease, fakeTime, NOW, registry, request,
} from "./fixtures.mjs";
import { syntheticStore } from "./store.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

async function waitFor(predicate, message) {
  for (let turn = 0; turn < 2_000; turn += 1) {
    if (predicate()) return;
    await new Promise(nextTurn);
  }
  assert.fail(message);
}

function harness(options = {}) {
  const time = fakeTime();
  const trace = [];
  const events = [];
  const storage = syntheticStore(time, trace);
  let current = registry(options.registry);
  const ports = {
    clock: time.clock,
    scheduler: time.scheduler,
    random: { next: () => 0 },
    telemetry: { emit: (event) => events.push(copy(event)) },
    lease: fakeLease(time, trace),
    store: storage.port,
    adapter: adapter(options.pages, trace),
    authority: {
      async loadVerifiedCurrent(input) {
        trace.push("authority");
        return {
          trust: "authenticated_current",
          registry: current,
          authorityRevision: current.revisions.at(-1).revision,
          verifiedAsOf: input.asOf,
          authorizationBasisRef: current.revisions.at(-1).configuration.policy.authorization.basisRef,
        };
      },
    },
  };
  return {
    time, trace, events, storage, ports,
    get registry() { return current; },
    set registry(value) { current = value; },
    run: (input = request(), signal) => time.drive(sdk.runConnector(input, ports, signal)),
  };
}

const fetchCount = (harnessValue) => harnessValue.trace.filter((entry) => entry.startsWith("fetch:")).length;

test("rejects a policy-scope mismatch before lease, acquisition or storage", async () => {
  const h = harness();
  const result = await h.run(request({ territory: "DE" }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "policy_ineligible");
  assert.deepEqual(h.trace, ["authority"]);
  assert.equal(h.storage.snapshot().raw.size, 0);
});

test("reports retention expiry when authorization expires during acquisition", async () => {
  const authorization = {
    basisRef: "evidence_sdk_synthetic",
    reviewerRef: "actor_sdk_reviewer",
    reviewedAt: "2026-01-01T00:00:00.000Z",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: new Date(NOW + 1_000).toISOString(),
  };
  const h = harness({ registry: { policy: { authorization } } });
  h.storage.hooks.set("raw.staged", async (phase) => {
    if (phase !== "before") return;
    h.storage.hooks.delete("raw.staged");
    h.time.advance(1_000);
  });
  h.registry = registry({
    policy: { authorization },
    operations: { timeoutMs: 2_000 },
  });
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "retention_expired");
  assert.equal(result.error.phase, "stage_raw");
  assert.equal(h.storage.snapshot().raw.size, 0);
});

test("keeps the source circuit open across invocations and closes it after one half-open success", async () => {
  const h = harness();
  let transient = true;
  let calls = 0;
  h.ports.adapter.fetchPage = async () => {
    calls += 1;
    return transient
      ? { success: false, failure: { kind: "transient" } }
      : { success: true, page: {
        pageIdentity: "recovered", bytes: new globalThis.TextEncoder().encode('{"items":[]}'),
        nextCursor: null, complete: true,
      } };
  };

  const first = await h.run();
  assert.equal(first.error.code, "circuit_open");
  assert.equal(calls, 5);
  const second = await h.run(request({ invocationKey: "blocked-while-open" }));
  assert.equal(second.error.code, "circuit_open");
  assert.equal(calls, 5);

  h.time.advance(60_000);
  transient = false;
  const recovered = await h.run(request({ invocationKey: "half-open-probe" }));
  assert.equal(recovered.status, "completed", JSON.stringify(recovered));
  const runtime = [...h.storage.snapshot().runtimes.values()][0];
  assert.equal(runtime.circuit.state, "closed");
  assert.equal(runtime.circuit.consecutiveTransientFailures, 0);
});

test("replays a completed run after later inventory evolution without reverting inventory", async () => {
  const h = harness({ pages: [{ items: [activeItem("first")] }] });
  const first = await h.run();
  assert.equal(first.status, "completed");
  h.ports.adapter = adapter([{ items: [activeItem("later")] }], h.trace);
  assert.equal((await h.run(request({ invocationKey: "later-run" }))).status, "completed");
  const evolved = [...h.storage.snapshot().inventories.values()][0];
  assert.deepEqual(evolved.activeSourceListingIds, ["later"]);
  const calls = fetchCount(h);

  const replay = await h.run();
  assert.deepEqual(replay, first);
  assert.equal(fetchCount(h), calls);
  assert.deepEqual([...h.storage.snapshot().inventories.values()][0].activeSourceListingIds, ["later"]);
});

test("enforces the cumulative item limit before committing the overflowing page", async () => {
  const h = harness({ pages: [
    { items: [activeItem("a"), activeItem("b")] },
    { items: [activeItem("c"), activeItem("d")] },
  ] });
  const result = await h.run(request({ limits: { maxItems: 3 } }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "limit_exceeded");
  assert.equal(result.error.phase, "commit");
  const state = h.storage.snapshot();
  assert.equal(state.observations.size, 2);
  assert.equal(state.raw.size, 2);
  assert.equal(state.tombstones.size, 0);
  assert.equal([...state.inventories.values()][0].generationId, "empty");
});

test("enforces the cumulative page limit before acquiring another page", async () => {
  const h = harness({ pages: [
    { items: [activeItem("a")] },
    { items: [activeItem("b")] },
  ] });
  const result = await h.run(request({ limits: { maxPages: 1 } }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "limit_exceeded");
  assert.equal(result.error.phase, "acquire");
  assert.equal(fetchCount(h), 1);
  assert.equal(h.storage.snapshot().observations.size, 1);
  assert.equal([...h.storage.snapshot().inventories.values()][0].generationId, "empty");
});

test("invalidates a late prepared raw write after a newer fence opens", async () => {
  const h = harness();
  const prepared = deferred();
  const release = deferred();
  h.storage.hooks.set("raw.staged", async (phase) => {
    if (phase !== "prepared") return;
    h.storage.hooks.delete("raw.staged");
    prepared.resolve();
    await release.promise;
  });

  const firstPromise = h.run();
  await prepared.promise;
  const first = await firstPromise;
  assert.equal(first.error.code, "mutation_indeterminate");
  const second = await h.run();
  assert.equal(second.status, "completed", JSON.stringify(second));
  release.resolve();
  await new Promise(nextTurn);

  const state = h.storage.snapshot();
  assert.equal(state.raw.size, 1);
  assert.equal(state.observations.size, 1);
  assert.equal(state.versions.size, 1);
});

test("cancellation while mapping preserves raw evidence and prevents canonical commit", async () => {
  const h = harness();
  const entered = deferred();
  h.ports.adapter.mapPage = (input) => {
    entered.resolve();
    return new Promise((resolve) => input.signal.addEventListener("abort", () => resolve({ items: [] }), { once: true }));
  };
  const controller = new globalThis.AbortController();
  const promise = sdk.runConnector(request(), h.ports, controller.signal);
  await entered.promise;
  controller.abort("synthetic-private-map-cancel");
  const result = await h.time.drive(promise, { autoAdvance: false });
  assert.equal(result.status, "cancelled");
  assert.equal(result.error.phase, "map");
  assert.equal(h.storage.snapshot().raw.size, 1);
  assert.equal(h.storage.snapshot().observations.size, 0);
  assert.equal(h.time.timers.size, 0);
});

test("cancellation while raw staging is in flight never reaches mapping or canonical commit", async () => {
  const h = harness();
  const entered = deferred();
  const release = deferred();
  h.storage.hooks.set("raw.staged", async (phase) => {
    if (phase !== "before") return;
    h.storage.hooks.delete("raw.staged");
    entered.resolve();
    await release.promise;
  });
  const controller = new globalThis.AbortController();
  const promise = sdk.runConnector(request(), h.ports, controller.signal);
  await entered.promise;
  controller.abort("synthetic-private-stage-cancel");
  const result = await h.time.drive(promise, { autoAdvance: false });
  assert.equal(result.status, "cancelled");
  assert.equal(result.error.phase, "stage_raw");
  assert.equal(h.trace.includes("map"), false);
  assert.equal(h.storage.snapshot().observations.size, 0);
  release.resolve();
  await new Promise(nextTurn);
  assert.equal(h.storage.snapshot().observations.size, 0);
  assert.equal(h.time.timers.size, 0);
});

test("cancellation while page commit is in flight resumes without refetching or duplicating evidence", async () => {
  const h = harness();
  const entered = deferred();
  const release = deferred();
  h.storage.hooks.set("page.committed", async (phase) => {
    if (phase !== "prepared") return;
    h.storage.hooks.delete("page.committed");
    entered.resolve();
    await release.promise;
  });
  const controller = new globalThis.AbortController();
  const promise = sdk.runConnector(request(), h.ports, controller.signal);
  await entered.promise;
  controller.abort("synthetic-private-commit-cancel");
  const cancelled = await h.time.drive(promise, { autoAdvance: false });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error.phase, "commit");
  const calls = fetchCount(h);
  release.resolve();
  await new Promise(nextTurn);
  const resumed = await h.run();
  assert.equal(resumed.status, "completed", JSON.stringify(resumed));
  assert.equal(fetchCount(h), calls);
  assert.equal(h.storage.snapshot().observations.size, 1);
  assert.equal(h.storage.snapshot().versions.size, 1);
});

test("cancellation during a rate-limit wait removes every scheduled timer", async () => {
  const h = harness({ pages: [
    { items: [activeItem("a")] },
    { items: [activeItem("b")] },
  ], registry: { operations: { requestsPerMinute: 1 } } });
  const controller = new globalThis.AbortController();
  const promise = sdk.runConnector(request(), h.ports, controller.signal);
  await waitFor(() => h.trace.filter((entry) => entry === "store.attempt.reserved").length >= 2 && h.time.timers.size >= 1,
    "rate-limit wait did not schedule its cancellable timers");
  controller.abort("synthetic-private-reserve-cancel");
  const result = await h.time.drive(promise, { autoAdvance: false });
  assert.equal(result.status, "cancelled");
  assert.equal(result.error.phase, "reserve");
  assert.equal(h.time.timers.size, 0);
});

test("does not invoke accessors in a hostile completed store response", async () => {
  const h = harness();
  assert.equal((await h.run()).status, "completed");
  const original = h.ports.store.openRun;
  let accesses = 0;
  h.ports.store.openRun = async (input) => {
    await original(input);
    const hostile = {};
    Object.defineProperty(hostile, "status", {
      enumerable: true,
      get() { accesses += 1; throw new Error("synthetic-private-accessor"); },
    });
    return { acknowledged: true, success: true, data: hostile };
  };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "store_failed");
  assert.equal(accesses, 0);
  assert.ok(!JSON.stringify([result, h.events]).includes("synthetic-private"));
});

test("detaches a completed result nested inside a frozen store envelope", async () => {
  const h = harness();
  assert.equal((await h.run()).status, "completed");
  const original = h.ports.store.openRun;
  let storeResult;
  h.ports.store.openRun = async (input) => {
    const reply = await original(input);
    storeResult = copy(reply.data.result);
    const checkpoint = Object.freeze({ ...reply.data.checkpoint, result: storeResult });
    return {
      acknowledged: true,
      success: true,
      data: Object.freeze({ ...reply.data, checkpoint, result: storeResult }),
    };
  };
  const result = await h.run();
  assert.equal(result.status, "completed");
  storeResult.pages = 999;
  assert.equal(result.pages, 1);
  assert.equal(Object.isFrozen(result), true);
});

test("rejects unexpected keys in a completed store result without leaking their values", async () => {
  const h = harness();
  assert.equal((await h.run()).status, "completed");
  const original = h.ports.store.openRun;
  h.ports.store.openRun = async (input) => {
    const reply = await original(input);
    const hostileResult = { ...reply.data.result, unexpected: "synthetic-private-result" };
    return {
      acknowledged: true,
      success: true,
      data: {
        ...reply.data,
        checkpoint: { ...reply.data.checkpoint, result: hostileResult },
        result: hostileResult,
      },
    };
  };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "store_failed");
  assert.ok(!JSON.stringify([result, h.events]).includes("synthetic-private"));
});
