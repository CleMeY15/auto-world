import assert from "node:assert/strict";
import { test } from "node:test";
import { createSyntheticHarness } from "@auto-world/synthetic-connector/demo";
import { createSyntheticDemoReadPort, DEMO_CURSOR_CAPACITY } from "../demo/createSyntheticDemoReadPort.mjs";
import { seedPublications } from "./pagination-seed.mjs";

const NOW = Date.parse("2026-10-12T10:00:00.000Z");
const context = () => ({ requestId: "req_0123456789abcdef0123456789abcdef", signal: new globalThis.AbortController().signal });
const query = (overrides = {}) => ({ schemaVersion: 1, sort: "listing_asc", ...overrides });

async function portFor(scenario, options = {}, runOverrides = {}) {
  const harness = createSyntheticHarness({ initialTime: NOW });
  const run = await harness.run(scenario, runOverrides);
  assert.equal(run.status, options.expectedStatus ?? "completed", JSON.stringify(run));
  const port = await createSyntheticDemoReadPort({ harness, nowMs: () => options.nowMs ?? NOW,
    cursorCapacity: options.cursorCapacity });
  return { harness, port };
}

test("reads a genuine finalized SDK snapshot and publishes only sanitized evidence", async () => {
  const { harness, port } = await portFor("contradictory");
  const outcome = await port.search(query(), context());
  assert.equal(outcome.success, true);
  assert.equal(outcome.data.state, "complete");
  assert.equal(outcome.data.totalCount, 1);
  assert.equal(outcome.data.dataAsOf, new Date(NOW).toISOString());
  const prices = [...harness.storage.snapshot().observations.values()].filter((item) => item.field === "price")
    .sort((left, right) => left.observationId < right.observationId ? -1 : 1);
  assert.equal(outcome.data.results[0].price.value.amountMinor, prices.at(-1).value.amountMinor,
    "equal timestamp tie is ordinal-ASCII ascending and the last observation wins");
  assert.equal(outcome.data.results[0].evidence.length, 3);
  assert.match(outcome.data.results[0].price.evidenceId, /^ev_[0-9a-f]{64}$/);
  const published = JSON.stringify(outcome);
  const privateState = harness.storage.snapshot();
  const privateObservation = [...privateState.observations.values()][0];
  for (const forbidden of ["src_sdk_synthetic", "publication-contradictory", privateObservation.observationId,
    privateObservation.provenance.raw.sha256, "connectorRunId", "raw", "identity", "vin"]) {
    assert.equal(published.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("applies filters deterministically and preserves contradictory history", async () => {
  const { port } = await portFor("contradictory");
  const accepted = await port.search(query({ priceMaxMinor: 2_100_000, mileageMaxKm: 60_000 }), context());
  assert.equal(accepted.success, true);
  assert.equal(accepted.data.totalCount, 1);
  assert.deepEqual(accepted.data.results[0].evidence.filter((item) => item.field === "price")
    .map((item) => item.value.amountMinor).sort(), [2_000_000, 2_100_000]);
  const excluded = await port.search(query({ priceMaxMinor: 1_999_999 }), context());
  assert.equal(excluded.success, true);
  assert.equal(excluded.data.totalCount, 0);
  assert.deepEqual(excluded.data.results, []);
});

test("search excludes withdrawals while detail retains their immutable history", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await harness.run("withdrawnBaseline", { invocationKey: "read-withdrawn-base" })).status, "completed");
  assert.equal((await harness.run("withdrawnDelta", { mode: "incremental", invocationKey: "read-withdrawn-delta" })).status, "completed");
  const port = await createSyntheticDemoReadPort({ harness, nowMs: () => harness.time.clock.nowMs() });
  const search = await port.search(query(), context());
  assert.equal(search.success, true);
  assert.equal(search.data.state, "complete");
  assert.equal(search.data.totalCount, 0);
  const listingId = [...harness.storage.snapshot().projections.values()][0].listingId;
  const detail = await port.getListing(listingId, context());
  assert.equal(detail.success, true);
  assert.equal(detail.data.results[0].availability, "withdrawn");
  assert.equal(detail.data.results[0].evidence.length, 2);
  assert.equal(detail.data.results[0].price.status, "observed");
});

test("returns honest missing detail without fabricating store availability", async () => {
  const { port } = await portFor("valid");
  const missing = await port.getListing(`lst_${"f".repeat(64)}`, context());
  assert.equal(missing.success, true);
  assert.equal(missing.data.state, "complete");
  assert.equal(missing.data.totalCount, 0);
  assert.deepEqual(missing.data.results, []);
});

test("reports incomplete and stale projections without a total count", async () => {
  const partial = await portFor("partialInterrupted", { expectedStatus: "failed" }, { invocationKey: "read-partial" });
  const partialSnapshot = partial.harness.storage.snapshot();
  assert.ok([...partialSnapshot.runs.values()].every((run) => run.status === "running"));
  assert.ok([...partialSnapshot.ledger.values()].filter((entry) => entry.kind === "page.committed")
    .every((entry) => entry.data.checkpoint.status === "running"));
  const partialOutcome = await partial.port.search(query(), context());
  assert.equal(partialOutcome.success, true);
  assert.equal(partialOutcome.data.state, "partial");
  assert.equal(partialOutcome.data.reason, "projection_incomplete");
  assert.equal(Object.hasOwn(partialOutcome.data, "totalCount"), false);

  const stale = await portFor("valid", { nowMs: NOW + 60_001 });
  const staleOutcome = await stale.port.search(query(), context());
  assert.equal(staleOutcome.success, true);
  assert.equal(staleOutcome.data.state, "stale");
  assert.equal(staleOutcome.data.reason, "projection_stale");
  assert.equal(Object.hasOwn(staleOutcome.data, "totalCount"), false);

  const boundary = await portFor("valid", { nowMs: NOW + 60_000 });
  assert.equal((await boundary.port.search(query(), context())).data.state, "complete");
});

test("rejects malformed or hostile running checkpoints instead of publishing a partial snapshot", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await harness.run("partialInterrupted", { invocationKey: "read-malformed-partial" })).status, "failed");
  const authentic = harness.storage.snapshot();
  const runId = [...authentic.runs.keys()][0];
  const pageOperationKey = [...authentic.ledger.values()]
    .find((entry) => entry.kind === "page.committed").operationKey;
  const mutations = [
    ["unsupported run status", (snapshot) => { snapshot.runs.get(runId).status = "unsupported"; }],
    ["numeric run completion key", (snapshot) => { snapshot.runs.get(runId).completionOperationKey = 42; }],
    ["fractional run final revision", (snapshot) => { snapshot.runs.get(runId).finalInventoryRevision = 1.5; }],
    ["object run final generation", (snapshot) => { snapshot.runs.get(runId).finalInventoryGenerationId = {}; }],
    ["numeric run completedAt", (snapshot) => { snapshot.runs.get(runId).completedAt = 42; }],
    ["object run result", (snapshot) => { snapshot.runs.get(runId).result = {}; }],
    ["unsupported embedded status", (snapshot) => {
      snapshot.ledger.get(pageOperationKey).data.checkpoint.status = "unsupported";
    }],
    ["numeric embedded completion key", (snapshot) => {
      snapshot.ledger.get(pageOperationKey).data.checkpoint.completionOperationKey = 42;
    }],
    ["fractional embedded final revision", (snapshot) => {
      snapshot.ledger.get(pageOperationKey).data.checkpoint.finalInventoryRevision = 1.5;
    }],
    ["object embedded final generation", (snapshot) => {
      snapshot.ledger.get(pageOperationKey).data.checkpoint.finalInventoryGenerationId = {};
    }],
    ["numeric embedded completedAt", (snapshot) => {
      snapshot.ledger.get(pageOperationKey).data.checkpoint.completedAt = 42;
    }],
    ["object embedded result", (snapshot) => {
      snapshot.ledger.get(pageOperationKey).data.checkpoint.result = {};
    }],
  ];
  for (const [label, mutate] of mutations) {
    const snapshot = globalThis.structuredClone(authentic);
    mutate(snapshot);
    const port = await createSyntheticDemoReadPort({ snapshotProvider: () => snapshot, nowMs: () => NOW });
    assert.equal((await port.search(query(), context())).error.code, "read_unavailable", label);
  }

  let getterCalled = false;
  const accessorSnapshot = globalThis.structuredClone(authentic);
  Object.defineProperty(accessorSnapshot.runs.get(runId), "status", {
    enumerable: true,
    get() { getterCalled = true; return "running"; },
  });
  const accessorPort = await createSyntheticDemoReadPort({ snapshotProvider: () => accessorSnapshot, nowMs: () => NOW });
  assert.equal((await accessorPort.search(query(), context())).error.code, "read_unavailable");
  assert.equal(getterCalled, false);

  const proxySnapshot = globalThis.structuredClone(authentic);
  const revocable = Proxy.revocable(proxySnapshot.ledger.get(pageOperationKey).data.checkpoint, {});
  revocable.revoke();
  proxySnapshot.ledger.get(pageOperationKey).data.checkpoint = revocable.proxy;
  const proxyPort = await createSyntheticDemoReadPort({ snapshotProvider: () => proxySnapshot, nowMs: () => NOW });
  assert.equal((await proxyPort.search(query(), context())).error.code, "read_unavailable");
});

test("paginates 41 genuine SDK publications with stable replay and global count", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await seedPublications(harness, 41)).status, "completed");
  const port = await createSyntheticDemoReadPort({ harness, nowMs: () => NOW });
  const first = await port.search(query(), context());
  assert.equal(first.success, true);
  assert.equal(first.data.results.length, 20);
  assert.equal(first.data.totalCount, 41);
  assert.match(first.data.nextCursor, /^cur_[0-9a-f]{64}$/);
  const middle = await port.search(query({ cursor: first.data.nextCursor }), context());
  const replay = await port.search(query({ cursor: first.data.nextCursor }), context());
  assert.deepEqual(replay, middle);
  assert.equal(middle.data.results.length, 20);
  assert.equal(middle.data.totalCount, 41);
  assert.match(middle.data.nextCursor, /^cur_[0-9a-f]{64}$/);
  const last = await port.search(query({ cursor: middle.data.nextCursor }), context());
  assert.equal(last.data.results.length, 1);
  assert.equal(Object.hasOwn(last.data, "nextCursor"), false);
  assert.equal(new Set([...first.data.results, ...middle.data.results, ...last.data.results]
    .map((item) => item.listingId)).size, 41);
  assert.equal((await port.search(query({ sort: "price_asc", cursor: first.data.nextCursor }), context())).error.code,
    "invalid_cursor");
  assert.equal((await port.search(query({ cursor: `cur_${"0".repeat(64)}` }), context())).error.code, "invalid_cursor");
});

test("a small injected cursor capacity fails without evicting an existing continuation", async () => {
  assert.equal(DEMO_CURSOR_CAPACITY, 1_024);
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await seedPublications(harness, 41)).status, "completed");
  const port = await createSyntheticDemoReadPort({ harness, nowMs: () => NOW, cursorCapacity: 1 });
  const first = await port.search(query(), context());
  assert.equal(first.success, true);
  const unavailable = await port.search(query({ cursor: first.data.nextCursor }), context());
  assert.deepEqual(unavailable, { success: false, error: { code: "read_unavailable" } });
  const replayFirst = await port.search(query(), context());
  assert.equal(replayFirst.success, true);
  assert.equal(replayFirst.data.nextCursor, first.data.nextCursor);
});

test("the default map admits exactly 1024 continuations and preserves existing replay", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await seedPublications(harness, 21)).status, "completed");
  const port = await createSyntheticDemoReadPort({ harness, nowMs: () => NOW });
  let first;
  for (let index = 0; index < DEMO_CURSOR_CAPACITY; index += 1) {
    const page = await port.search(query({ priceMaxMinor: 2_000_000 + index }), context());
    assert.equal(page.success, true, `allocation ${index + 1}`);
    assert.match(page.data.nextCursor, /^cur_[0-9a-f]{64}$/);
    if (index === 0) first = page;
  }
  const replay = await port.search(query({ priceMaxMinor: 2_000_000, cursor: first.data.nextCursor }), context());
  assert.equal(replay.success, true);
  assert.equal(replay.data.results.length, 1);
  assert.equal(Object.hasOwn(replay.data, "nextCursor"), false);
  const denied = await port.search(query({ priceMaxMinor: 3_000_000 }), context());
  assert.deepEqual(denied, { success: false, error: { code: "read_unavailable" } });
});

test("retries cursor entropy collisions exactly four times then fails closed", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await seedPublications(harness, 41)).status, "completed");
  let calls = 0;
  const port = await createSyntheticDemoReadPort({ harness, nowMs: () => NOW, randomBytes: () => {
    calls += 1;
    return new globalThis.Uint8Array(32);
  } });
  assert.equal((await port.search(query(), context())).success, true);
  const collision = await port.search(query({ sort: "price_desc" }), context());
  assert.equal(collision.success, false);
  assert.equal(collision.error.code, "read_unavailable");
  assert.equal(calls, 5, "one accepted token plus four bounded collision attempts");
});

test("invalidates old cursors after a genuine committed snapshot replacement", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await seedPublications(harness, 41)).status, "completed");
  const port = await createSyntheticDemoReadPort({ harness, nowMs: () => harness.time.clock.nowMs() });
  const first = await port.search(query(), context());
  assert.equal(first.success, true);
  harness.time.advance(1);
  assert.equal((await seedPublications(harness, 1, { offset: 100, mode: "incremental" })).status, "completed");
  const rejected = await port.search(query({ cursor: first.data.nextCursor }), context());
  assert.equal(rejected.success, false);
  assert.equal(rejected.error.code, "invalid_cursor");
});

test("rejects corrupted incremental head and full-baseline associations", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await seedPublications(harness, 41)).status, "completed");
  assert.equal((await seedPublications(harness, 1, { offset: 100, mode: "incremental" })).status, "completed");
  const authentic = harness.storage.snapshot();
  const genuine = await createSyntheticDemoReadPort({ snapshotProvider: () => authentic,
    nowMs: () => harness.time.clock.nowMs() });
  assert.equal((await genuine.search(query(), context())).data.state, "complete");

  const mutateCases = [
    ["current receipt generation", (snapshot) => {
      [...snapshot.ledger.values()].filter((entry) => entry.kind === "page.committed").at(-1)
        .data.inventoryGenerationId = `inv_${"0".repeat(64)}`;
    }],
    ["current receipt revision", (snapshot) => {
      [...snapshot.ledger.values()].filter((entry) => entry.kind === "page.committed").at(-1)
        .data.inventoryRevision += 1;
    }],
    ["baseline completion key", (snapshot) => {
      [...snapshot.runs.values()].find((run) => run.request.mode === "full").completionOperationKey =
        `final_${"0".repeat(64)}`;
    }],
    ["baseline final revision", (snapshot) => {
      [...snapshot.runs.values()].find((run) => run.request.mode === "full").finalInventoryRevision += 1;
    }],
    ["baseline receipt generation", (snapshot) => {
      [...snapshot.ledger.values()].find((entry) => entry.kind === "full.finalized")
        .data.inventoryGenerationId = `inv_${"0".repeat(64)}`;
    }],
    ["coordinated forged incremental head generation", (snapshot) => {
      const forged = `inv_${"0".repeat(64)}`;
      [...snapshot.inventories.values()][0].generationId = forged;
      const run = [...snapshot.runs.values()].find((item) => item.request.mode === "incremental");
      run.finalInventoryGenerationId = forged;
      const receipt = [...snapshot.ledger.values()].filter((entry) => entry.kind === "page.committed").at(-1);
      receipt.data.inventoryGenerationId = forged;
      receipt.data.checkpoint.finalInventoryGenerationId = forged;
    }],
  ];
  for (const [label, mutate] of mutateCases) {
    const snapshot = globalThis.structuredClone(authentic);
    mutate(snapshot);
    const port = await createSyntheticDemoReadPort({ snapshotProvider: () => snapshot,
      nowMs: () => harness.time.clock.nowMs() });
    assert.equal((await port.search(query(), context())).error.code, "read_unavailable", label);
  }
});

test("authenticates every historical incremental terminal before publishing the latest head", async () => {
  const harness = createSyntheticHarness({ initialTime: NOW });
  assert.equal((await seedPublications(harness, 41)).status, "completed");
  assert.equal((await seedPublications(harness, 1, { offset: 100, mode: "incremental" })).status, "completed");
  assert.equal((await seedPublications(harness, 1, { offset: 200, mode: "incremental" })).status, "completed");
  const authentic = harness.storage.snapshot();
  const incrementalRuns = [...authentic.runs.values()].filter((run) => run.request.mode === "incremental");
  assert.equal(incrementalRuns.length, 2);
  const historicalRunId = incrementalRuns[0].runId;
  const authenticPort = await createSyntheticDemoReadPort({ snapshotProvider: () => authentic,
    nowMs: () => harness.time.clock.nowMs() });
  const positive = await authenticPort.search(query(), context());
  assert.equal(positive.success, true);
  assert.equal(positive.data.state, "complete");
  assert.equal(positive.data.totalCount, 43);

  const mutations = [
    ["historical marker false", (snapshot) => {
      [...snapshot.ledger.values()].find((entry) => entry.kind === "page.committed" &&
        entry.record.runId === historicalRunId).data.complete = false;
    }],
    ["historical marker null", (snapshot) => {
      [...snapshot.ledger.values()].find((entry) => entry.kind === "page.committed" &&
        entry.record.runId === historicalRunId).data.complete = null;
    }],
    ["historical mode full", (snapshot) => {
      snapshot.runs.get(historicalRunId).request.mode = "full";
    }],
    ["historical mode invalid", (snapshot) => {
      snapshot.runs.get(historicalRunId).request.mode = "unsupported";
    }],
    ["coherent marker and checkpoint downgrade", (snapshot) => {
      const receipt = [...snapshot.ledger.values()].find((entry) => entry.kind === "page.committed" &&
        entry.record.runId === historicalRunId);
      receipt.data.complete = false;
      receipt.data.checkpoint.status = "running";
      receipt.data.checkpoint.lastPageCommitKey = receipt.operationKey;
      delete receipt.data.checkpoint.completionOperationKey;
      delete receipt.data.checkpoint.completedAt;
      delete receipt.data.checkpoint.finalInventoryGenerationId;
      delete receipt.data.checkpoint.finalInventoryRevision;
      delete receipt.data.checkpoint.result;
    }],
    ["coherent downgrade plus failed run", (snapshot) => {
      const receipt = [...snapshot.ledger.values()].find((entry) => entry.kind === "page.committed" &&
        entry.record.runId === historicalRunId);
      receipt.data.complete = false;
      receipt.data.checkpoint.status = "running";
      receipt.data.checkpoint.lastPageCommitKey = receipt.operationKey;
      delete receipt.data.checkpoint.completionOperationKey;
      delete receipt.data.checkpoint.completedAt;
      delete receipt.data.checkpoint.finalInventoryGenerationId;
      delete receipt.data.checkpoint.finalInventoryRevision;
      delete receipt.data.checkpoint.result;
      snapshot.runs.get(historicalRunId).status = "failed";
    }],
    ["historical status", (snapshot) => { snapshot.runs.get(historicalRunId).status = "failed"; }],
    ["historical completion operation", (snapshot) => {
      snapshot.runs.get(historicalRunId).completionOperationKey = `commit_${"0".repeat(64)}`;
    }],
    ["historical final revision", (snapshot) => {
      snapshot.runs.get(historicalRunId).finalInventoryRevision += 1;
    }],
    ["historical embedded checkpoint", (snapshot) => {
      [...snapshot.ledger.values()].find((entry) => entry.kind === "page.committed" &&
        entry.record.runId === historicalRunId).data.checkpoint.finalInventoryRevision += 1;
    }],
  ];
  for (const [label, mutate] of mutations) {
    const snapshot = globalThis.structuredClone(authentic);
    mutate(snapshot);
    const port = await createSyntheticDemoReadPort({ snapshotProvider: () => snapshot,
      nowMs: () => harness.time.clock.nowMs() });
    assert.equal((await port.search(query(), context())).error.code, "read_unavailable", label);
  }
});

test("rejects pinned-scope receipts with corrupted source, scope or dangling run", async () => {
  const { harness } = await portFor("valid");
  const authentic = harness.storage.snapshot();
  const finalReceipt = [...authentic.ledger.values()].find((entry) => entry.kind === "full.finalized");
  const mutations = [
    ["receipt source", (snapshot) => {
      snapshot.ledger.get(finalReceipt.operationKey).record.sourceId = "src_corrupted";
    }],
    ["run exact scope", (snapshot) => {
      snapshot.runs.get(finalReceipt.record.runId).scope.territory = "DE";
    }],
    ["dangling run", (snapshot) => {
      snapshot.runs.delete(finalReceipt.record.runId);
    }],
  ];
  for (const [label, mutate] of mutations) {
    const snapshot = globalThis.structuredClone(authentic);
    mutate(snapshot);
    const port = await createSyntheticDemoReadPort({ snapshotProvider: () => snapshot, nowMs: () => NOW });
    assert.equal((await port.search(query(), context())).error.code, "read_unavailable", label);
  }
});

test("rejects missing or mismatched observations referenced by an SDK listing version", async () => {
  const { harness } = await portFor("valid");
  const authentic = harness.storage.snapshot();
  const version = [...authentic.versions.values()][0];
  const observationId = version.observationIds[0];
  const mutations = [
    ["missing observation", (snapshot) => snapshot.observations.delete(observationId)],
    ["mismatched subject", (snapshot) => {
      snapshot.observations.get(observationId).subject.listingId = `lst_${"0".repeat(64)}`;
    }],
    ["mismatched raw link", (snapshot) => {
      snapshot.observations.get(observationId).provenance.raw.sha256 = "0".repeat(64);
    }],
  ];
  for (const [label, mutate] of mutations) {
    const snapshot = globalThis.structuredClone(authentic);
    mutate(snapshot);
    const port = await createSyntheticDemoReadPort({ snapshotProvider: () => snapshot, nowMs: () => NOW });
    assert.equal((await port.search(query(), context())).error.code, "read_unavailable", label);
  }
});

test("requires every published version to have its committed raw page association", async () => {
  const { harness } = await portFor("valid");
  const authentic = harness.storage.snapshot();
  const version = [...authentic.versions.values()][0];
  const mutations = [
    ["missing raw snapshot", (snapshot) => snapshot.raw.delete(version.raw.snapshotId)],
    ["raw digest mismatch", (snapshot) => {
      snapshot.raw.get(version.raw.snapshotId).pending.sha256 = "0".repeat(64);
    }],
    ["committed page mismatch", (snapshot) => {
      [...snapshot.ledger.values()].find((entry) => entry.kind === "page.committed").record.pageOrdinal += 1;
    }],
  ];
  for (const [label, mutate] of mutations) {
    const snapshot = globalThis.structuredClone(authentic);
    mutate(snapshot);
    const port = await createSyntheticDemoReadPort({ snapshotProvider: () => snapshot, nowMs: () => NOW });
    assert.equal((await port.search(query(), context())).error.code, "read_unavailable", label);
  }
});

test("fails closed on corrupted association, future watermark, cancellation and invalid capacity", async () => {
  const { harness } = await portFor("valid");
  const corrupted = harness.storage.snapshot();
  corrupted.inventories.get([...corrupted.inventories.keys()][0]).revision += 1;
  const corruptPort = await createSyntheticDemoReadPort({ snapshotProvider: () => corrupted, nowMs: () => NOW });
  assert.equal((await corruptPort.search(query(), context())).error.code, "read_unavailable");

  const futurePort = await createSyntheticDemoReadPort({ harness, nowMs: () => NOW - 1 });
  assert.equal((await futurePort.search(query(), context())).error.code, "read_unavailable");
  const controller = new globalThis.AbortController(); controller.abort("private cancellation message");
  const cancelled = await futurePort.search(query(), { requestId: context().requestId, signal: controller.signal });
  assert.deepEqual(cancelled, { success: false, error: { code: "cancelled" } });
  await assert.rejects(createSyntheticDemoReadPort({ harness, cursorCapacity: 1_025 }),
    { message: "demo_cursor_capacity_invalid" });
});
