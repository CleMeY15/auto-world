import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "@auto-world/connector-sdk";
import { activeItem, adapter, copy, fakeLease, fakeTime, registry, request } from "../test-support/fixtures.mjs";
import { syntheticStore } from "../test-support/store.mjs";

function harness(options = {}) {
  const time = fakeTime();
  const trace = [];
  const storage = syntheticStore(time, trace);
  const current = registry(options.registry);
  const ports = {
    clock: time.clock, scheduler: time.scheduler, random: { next: () => 0 },
    telemetry: { emit() {} }, lease: fakeLease(time, trace), store: storage.port,
    adapter: adapter(options.pages, trace),
    authority: {
      async loadVerifiedCurrent(input) {
        return {
          trust: "authenticated_current", registry: current,
          authorityRevision: current.revisions.at(-1).revision, verifiedAsOf: input.asOf,
          authorizationBasisRef: current.revisions.at(-1).configuration.policy.authorization.basisRef,
        };
      },
    },
  };
  return {
    time, trace, storage, ports,
    run: (input = request()) => time.drive(sdk.runConnector(input, ports)),
  };
}

function projectionStates(h) {
  return Object.fromEntries([...h.storage.snapshot().projections.values()]
    .map((projection) => [projection.sourceListingId, projection.state]).sort());
}

function activeInventory(h) {
  return [...h.storage.snapshot().inventories.values()][0].activeSourceListingIds;
}

async function interruptAfterPage(h, invocationKey, items) {
  h.ports.adapter = adapter([{ items }], h.trace);
  h.storage.faults.set("page.committed", "after");
  const result = await h.run(request({ invocationKey }));
  assert.equal(result.status, "failed");
}

test("a disjoint full run reconciles active projections left by an interrupted first full", async () => {
  const h = harness();
  await interruptAfterPage(h, "partial-a", [activeItem("a")]);
  h.ports.adapter = adapter([{ items: [activeItem("b")] }], h.trace);
  assert.equal((await h.run(request({ invocationKey: "complete-b" }))).status, "completed");
  assert.deepEqual(activeInventory(h), ["b"]);
  assert.deepEqual(projectionStates(h), { a: "missing", b: "active" });
});

test("explicit-only full keeps interrupted actives without resurrecting explicit ends", async () => {
  const h = harness({
    registry: { operations: { deletionMode: "explicit_tombstone" } },
    pages: [{ items: [activeItem("a"), activeItem("b")] }],
  });
  assert.equal((await h.run(request({ invocationKey: "baseline" }))).status, "completed");
  await interruptAfterPage(h, "partial-explicit", [
    { sourceListingId: "a", outcome: "withdrawn" },
    { sourceListingId: "b", outcome: "deleted" },
    activeItem("c"),
  ]);
  h.ports.adapter = adapter([{ items: [activeItem("d")] }], h.trace);
  assert.equal((await h.run(request({ invocationKey: "fresh-full" }))).status, "completed");
  assert.deepEqual(activeInventory(h), ["c", "d"]);
  assert.deepEqual(projectionStates(h), { a: "withdrawn", b: "deleted", c: "active", d: "active" });
});

test("both mode preserves explicit ends and infers missing only for currently active projections", async () => {
  const h = harness({ pages: [{ items: [activeItem("a"), activeItem("b"), activeItem("c")] }] });
  assert.equal((await h.run(request({ invocationKey: "baseline" }))).status, "completed");
  await interruptAfterPage(h, "partial-both", [
    { sourceListingId: "a", outcome: "withdrawn" },
    { sourceListingId: "b", outcome: "deleted" },
    activeItem("d"),
  ]);
  h.ports.adapter = adapter([{ items: [activeItem("e")] }], h.trace);
  assert.equal((await h.run(request({ invocationKey: "fresh-full" }))).status, "completed");
  assert.deepEqual(activeInventory(h), ["e"]);
  assert.deepEqual(projectionStates(h), {
    a: "withdrawn", b: "deleted", c: "missing", d: "missing", e: "active",
  });
});

test("an older running checkpoint cannot resume after a newer same-scope run was recorded", async () => {
  const h = harness();
  h.storage.faults.set("raw.staged", "after");
  assert.equal((await h.run(request({ invocationKey: "old-a" }))).status, "failed");
  await interruptAfterPage(h, "newer-b", [activeItem("b")]);
  const resumed = await h.run(request({ invocationKey: "old-a" }));
  assert.equal(resumed.status, "failed");
  assert.equal(resumed.error.code, "checkpoint_conflict");
  assert.equal(resumed.error.phase, "open");
});

test("the same running checkpoint resumes normally and its completion replays exactly", async () => {
  const h = harness();
  h.storage.faults.set("raw.staged", "after");
  assert.equal((await h.run(request({ invocationKey: "same-a" }))).status, "failed");
  const completed = await h.run(request({ invocationKey: "same-a" }));
  assert.equal(completed.status, "completed");
  assert.deepEqual(await h.run(request({ invocationKey: "same-a" })), completed);
  assert.equal(h.trace.filter((entry) => entry.startsWith("fetch:")).length, 1);
});

test("a new full fails closed when the completed inventory has no corresponding projection", async () => {
  const h = harness({ pages: [{ items: [activeItem("a")] }] });
  assert.equal((await h.run(request({ invocationKey: "baseline" }))).status, "completed");
  h.storage.seed((state) => state.projections.clear());
  let failureCode;
  const open = h.ports.store.openRun;
  h.ports.store.openRun = async (input) => {
    const result = await open(input);
    if (!result.success) failureCode = result.failure.code;
    return result;
  };
  const result = await h.run(request({ invocationKey: "corrupt-inventory" }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "checkpoint_conflict");
  assert.equal(failureCode, "inventory_conflict");
});

test("a new full rejects more than 100000 currently active projection identities", async () => {
  const h = harness({ pages: [{ items: [activeItem("baseline")] }] });
  assert.equal((await h.run(request({ invocationKey: "baseline" }))).status, "completed");
  h.storage.seed((state) => {
    const sample = copy([...state.projections.values()][0]);
    for (let index = 0; index < 100_000; index += 1) {
      const sourceListingId = `overflow-${String(index).padStart(6, "0")}`;
      state.projections.set(`overflow:${index}`, { ...sample, sourceListingId });
    }
  });
  let failureCode;
  const open = h.ports.store.openRun;
  h.ports.store.openRun = async (input) => {
    const result = await open(input);
    if (!result.success) failureCode = result.failure.code;
    return result;
  };
  const result = await h.run(request({ invocationKey: "overflow" }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "store_failed");
  assert.equal(failureCode, "invalid_state");
});

test("a new full baseline uses deterministic JavaScript UTF-16 ordering for valid Unicode publications", async () => {
  const astral = "publication-\u{10000}";
  const privateUseBmp = "publication-\uE000";
  const h = harness({ pages: [{ items: [activeItem(privateUseBmp), activeItem(astral)] }] });
  assert.equal((await h.run(request({ invocationKey: "unicode-baseline" }))).status, "completed");
  h.storage.faults.set("run.opened", "after");
  const opened = await h.run(request({ invocationKey: "unicode-new-full" }));
  assert.equal(opened.status, "failed");
  const checkpoint = [...h.storage.snapshot().runs.values()].find((run) => run.status === "running");
  assert.notEqual(checkpoint, undefined);
  assert.deepEqual(checkpoint.baselineActiveSourceListingIds, [astral, privateUseBmp]);
  assert.equal(h.trace.filter((entry) => entry.startsWith("fetch:")).length, 1);
});
