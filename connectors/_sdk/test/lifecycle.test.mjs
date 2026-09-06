import assert from "node:assert/strict";
import { test } from "node:test";
import { appendSourceRevision } from "@auto-world/source-registry";
import * as sdk from "@auto-world/connector-sdk";
import { activeItem, adapter, copy, fakeLease, fakeTime, NOW, registry, request, utf8 } from "./fixtures.mjs";
import { syntheticStore } from "./store.mjs";

function harness(options = {}) {
  const time = fakeTime();
  const trace = [];
  const events = [];
  const storage = syntheticStore(time, trace);
  let current = registry(options.registry);
  let authorityLoads = 0;
  const ports = {
    clock: time.clock, scheduler: time.scheduler, random: { next: () => 0 },
    telemetry: { emit: (event) => events.push(copy(event)) },
    lease: fakeLease(time, trace), store: storage.port,
    adapter: adapter(options.pages, trace),
    authority: {
      async loadVerifiedCurrent(input) {
        authorityLoads += 1;
        trace.push("authority");
        options.onAuthority?.(authorityLoads, { time, input, setRegistry: (value) => { current = value; }, current });
        return {
          trust: "authenticated_current", registry: current,
          authorityRevision: current.revisions.at(-1).revision, verifiedAsOf: input.asOf,
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
const fetches = (h) => h.trace.filter((entry) => entry.startsWith("fetch:"));
const onlyRun = (h) => [...h.storage.snapshot().runs.values()][0];

test("public lifecycle persists raw then maps, commits and finalizes with complete provenance", async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.pages, 1);
  assert.equal(result.items, 1);
  const state = h.storage.snapshot();
  assert.equal(state.raw.size, 1);
  assert.equal(state.versions.size, 1);
  assert.equal(state.observations.size, 1);
  assert.ok(h.trace.indexOf("store.raw.staged") < h.trace.indexOf("map"));
  assert.ok(h.trace.indexOf("map") < h.trace.indexOf("store.page.committed"));
  assert.ok(h.trace.indexOf("store.page.committed") < h.trace.indexOf("store.full.finalized"));
  const observation = [...state.observations.values()][0];
  const raw = state.raw.get(observation.provenance.raw.snapshotId);
  assert.equal(observation.provenance.raw.connectorRunId, result.runId);
  assert.equal(observation.provenance.raw.sha256, raw.pending.sha256);
  assert.equal(observation.provenance.observedAt, raw.pending.capturedAt);
  assert.equal(observation.provenance.acquisitionMethod, "feed");
  assert.equal(observation.provenance.legalStatus, "dealer_feed");
  assert.equal(h.time.timers.size, 0);
});

test("exact observation duplicates collapse while contradictory values retain distinct provenance", async () => {
  const item = activeItem();
  item.observations.push(copy(item.observations[0]), {
    field: "price", value: { amountMinor: 999, currency: "EUR" }, confidenceBps: 10000,
  });
  const h = harness({ pages: [{ items: [item] }] });
  assert.equal((await h.run()).status, "completed");
  const observations = [...h.storage.snapshot().observations.values()];
  assert.equal(observations.length, 2);
  assert.notEqual(observations[0].observationId, observations[1].observationId);
  assert.equal(observations[0].provenance.raw.snapshotId, observations[1].provenance.raw.snapshotId);
});

test("full VIN receives only the pinned internal access policy and no canonical identity", async () => {
  const item = activeItem();
  item.observations = [{ field: "vin", value: { status: "full", vin: "WVWZZZ1JZXW000001" }, confidenceBps: 10000 }];
  const h = harness({ pages: [{ items: [item] }] });
  assert.equal((await h.run(request({ fields: ["source_listing_id", "vin"] }))).status, "completed");
  const state = h.storage.snapshot();
  assert.deepEqual([...state.observations.values()][0].value.accessPolicy,
    { visibility: "internal", policyRef: "evidence_sdk_synthetic" });
  assert.deepEqual([...state.listings.values()][0].identity, { status: "unresolved" });
  assert.ok(!JSON.stringify(h.events).includes("WVWZZZ1JZXW000001"));
});

for (const addition of ["url", "vin"]) {
  test("mapper cannot broaden the requested field scope with " + addition, async () => {
    const item = activeItem();
    if (addition === "url") item.url = "https://example.invalid/private-publication";
    else item.observations.push({ field: "vin", value: { status: "full", vin: "WVWZZZ1JZXW000001" }, confidenceBps: 10000 });
    const h = harness({ pages: [{ items: [item] }] });
    const result = await h.run();
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "adapter_output_invalid");
    assert.equal(h.storage.snapshot().raw.size, 1);
    assert.equal(h.storage.snapshot().observations.size, 0);
  });
}

test("publication identity survives URL changes while each run appends distinct evidence", async () => {
  const h = harness({ pages: [{ items: [{ ...activeItem(), url: "https://example.invalid/one" }] }] });
  const fields = ["source_listing_id", "price", "url"];
  assert.equal((await h.run(request({ fields }))).status, "completed");
  const first = [...h.storage.snapshot().listings.values()][0].listingId;
  h.ports.adapter = adapter([{ items: [{ ...activeItem(), url: "https://example.invalid/two" }] }], h.trace);
  assert.equal((await h.run(request({ fields, invocationKey: "second" }))).status, "completed");
  const state = h.storage.snapshot();
  assert.equal(state.listings.size, 2);
  assert.deepEqual([...new Set([...state.listings.values()].map((item) => item.listingId))], [first]);
  assert.equal(state.versions.size, 2);
  assert.equal(state.observations.size, 2);
});

test("retry exhaustion returns a terminal error, not a promise of another SDK retry", async () => {
  const h = harness({ registry: { operations: { maxRetries: 0 } } });
  h.ports.adapter.fetchPage = async () => ({ success: false, failure: { kind: "transient" } });
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "acquisition_failed");
  assert.equal(result.error.attempt, 1);
  assert.equal(result.error.retryable, false);
});

for (const corruption of ["runId", "requestSha256"]) {
  test("completed store replay must bind to the requested " + corruption, async () => {
    const h = harness();
    assert.equal((await h.run()).status, "completed");
    const original = h.ports.store.openRun;
    h.ports.store.openRun = async (input) => {
      const response = copy(await original(input));
      if (corruption === "runId") {
        const foreign = "run_" + "f".repeat(64);
        response.data.checkpoint.runId = foreign;
        response.data.checkpoint.result.runId = foreign;
        response.data.result.runId = foreign;
      } else response.data.checkpoint.requestSha256 = "f".repeat(64);
      return response;
    };
    const result = await h.run();
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "checkpoint_conflict");
    assert.equal(fetches(h).length, 1);
  });
}

test("resumed raw bytes are rehashed before decoding rather than trusting stored metadata", async () => {
  const h = harness();
  h.storage.faults.set("raw.staged", "after");
  assert.equal((await h.run()).status, "failed");
  const original = h.ports.store.loadStagedRaw;
  h.ports.store.loadStagedRaw = async (input) => {
    const result = copy(await original(input));
    result.data.bytes[0] ^= 1;
    return result;
  };
  const result = await h.run();
  assert.equal(result.error.code, "raw_conflict");
  assert.equal(h.trace.includes("map"), false);
  assert.equal(fetches(h).length, 1);
});

test("exact completed replay never fetches or duplicates evidence", async () => {
  const h = harness();
  const first = await h.run();
  const before = h.storage.snapshot();
  const calls = fetches(h).length;
  const again = await h.run();
  assert.deepEqual(again, first);
  assert.equal(fetches(h).length, calls);
  assert.equal(h.storage.snapshot().observations.size, before.observations.size);
  assert.equal(h.storage.snapshot().tombstones.size, before.tombstones.size);
});

test("changed mapper/request reuse conflicts without acquisition or evidence loss", async () => {
  const h = harness();
  assert.equal((await h.run()).status, "completed");
  const calls = fetches(h).length;
  const result = await h.run(request({ mapperVersion: "mapper-2" }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "idempotency_conflict");
  assert.equal(fetches(h).length, calls);
  assert.equal(h.storage.snapshot().observations.size, 1);
});

for (const mutation of ["raw.staged", "page.committed", "full.finalized"]) {
  test("lost acknowledgement after " + mutation + " resumes without refetch or duplicate evidence", async () => {
    const h = harness();
    h.storage.faults.set(mutation, "after");
    const result = await h.run();
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "mutation_indeterminate");
    const calls = fetches(h).length;
    const resumed = await h.run();
    assert.equal(resumed.status, "completed", JSON.stringify(resumed));
    assert.equal(fetches(h).length, calls);
    assert.equal(h.storage.snapshot().raw.size, 1);
    assert.equal(h.storage.snapshot().observations.size, 1);
    assert.equal(h.time.timers.size, 0);
  });
}

test("raw-store failure before atomic staging prevents map/progress and allows a safe new fetch", async () => {
  const h = harness();
  h.storage.faults.set("raw.staged", "before");
  assert.equal((await h.run()).error.code, "mutation_indeterminate");
  assert.equal(h.storage.snapshot().raw.size, 0);
  assert.equal(h.trace.includes("map"), false);
  assert.equal(onlyRun(h).committedPages, 0);
  assert.equal((await h.run()).status, "completed");
  assert.equal(fetches(h).length, 2);
});

test("malformed JSON preserves staged raw and never invokes mapping or canonical commit", async () => {
  const h = harness();
  h.ports.adapter.fetchPage = async () => ({ success: true, page: {
    pageIdentity: "broken", bytes: utf8('{"opaque":"synthetic-secret","opaque":2}'),
    nextCursor: null, complete: true,
  } });
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "duplicate_member");
  const state = h.storage.snapshot();
  assert.equal(state.raw.size, 1);
  assert.equal(state.observations.size, 0);
  assert.equal(state.tombstones.size, 0);
  assert.equal(onlyRun(h).committedPages, 0);
  assert.equal(h.trace.includes("map"), false);
  assert.ok(!JSON.stringify([result, h.events]).includes("synthetic-secret"));
});

test("oversized acquisition is rejected before raw storage and mapping", async () => {
  const h = harness();
  h.ports.adapter.fetchPage = async () => ({ success: true, page: {
    pageIdentity: "oversized", bytes: new Uint8Array(4097), nextCursor: null, complete: true,
  } });
  const result = await h.run();
  assert.equal(result.error.code, "payload_too_large");
  assert.equal(h.storage.snapshot().raw.size, 0);
  assert.equal(h.trace.includes("map"), false);
});

test("incremental requires an initial full baseline and inherits the committed watermark", async () => {
  const h = harness();
  const denied = await h.run(request({ mode: "incremental", invocationKey: "early-incremental" }));
  assert.equal(denied.error.code, "full_reconciliation_required");
  assert.equal(fetches(h).length, 0);
  assert.equal((await h.run()).status, "completed");
  let observedCursor;
  const original = h.ports.adapter.fetchPage;
  h.ports.adapter.fetchPage = async (input) => { observedCursor = input.cursor; return original(input); };
  const delta = await h.run(request({ mode: "incremental", invocationKey: "delta-1" }));
  assert.equal(delta.status, "completed", JSON.stringify(delta));
  assert.equal(observedCursor, "watermark-1");
  assert.equal(h.storage.snapshot().observations.size, 2);
  assert.equal(h.storage.snapshot().versions.size, 2);
});

test("incremental capability and exact full cadence boundary fail closed", async () => {
  const unsupported = harness({ registry: { operations: { incremental: false } } });
  assert.equal((await unsupported.run()).status, "completed");
  assert.equal((await unsupported.run(request({ mode: "incremental", invocationKey: "delta" }))).error.code,
    "full_reconciliation_required");
  const h = harness({ registry: { operations: { fullReconcileIntervalSeconds: 2 } } });
  assert.equal((await h.run()).status, "completed");
  h.time.advance(2000);
  const calls = fetches(h).length;
  const result = await h.run(request({ mode: "incremental", invocationKey: "overdue" }));
  assert.equal(result.error.code, "full_reconciliation_required");
  assert.equal(fetches(h).length, calls);
});

for (const mode of ["both", "full_reconciliation", "explicit_tombstone"]) {
  test("full reconciliation preserves mode-specific absence semantics for " + mode, async () => {
    const h = harness({ registry: { operations: { deletionMode: mode } },
      pages: [{ items: [activeItem("a"), activeItem("b")] }] });
    assert.equal((await h.run()).status, "completed");
    h.ports.adapter = adapter([{ items: [activeItem("a")] }], h.trace);
    const second = await h.run(request({ invocationKey: "full-2" }));
    assert.equal(second.status, "completed", JSON.stringify(second));
    const state = h.storage.snapshot();
    const missing = [...state.tombstones.values()].filter((item) => item.kind === "inferred_missing");
    assert.equal(missing.length, mode === "explicit_tombstone" ? 0 : 1);
    if (missing.length) {
      assert.equal(missing[0].sourceListingId, "b");
      assert.equal(Object.hasOwn(missing[0], "raw"), false);
    }
    assert.deepEqual([...state.inventories.values()][0].activeSourceListingIds,
      mode === "explicit_tombstone" ? ["a", "b"] : ["a"]);
    assert.equal(state.observations.size, 3);
  });
}

test("explicit ended inventory is removed without also inferring missing", async () => {
  const h = harness({ pages: [{ items: [activeItem("a"), activeItem("b")] }] });
  assert.equal((await h.run()).status, "completed");
  h.ports.adapter = adapter([{ items: [activeItem("a"), { sourceListingId: "b", outcome: "deleted" }] }], h.trace);
  assert.equal((await h.run(request({ invocationKey: "full-2" }))).status, "completed");
  const state = h.storage.snapshot();
  assert.equal([...state.tombstones.values()].filter((item) => item.kind === "explicit").length, 1);
  assert.equal([...state.tombstones.values()].filter((item) => item.kind === "inferred_missing").length, 0);
  assert.equal(state.observations.size, 3);
});

test("duplicate publications across full pages fail without inferring absence", async () => {
  const h = harness({ pages: [{ items: [activeItem("a")] }, { items: [activeItem("a", 999)] }] });
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(h.storage.snapshot().observations.size, 1);
  assert.equal(h.storage.snapshot().tombstones.size, 0);
  assert.equal([...h.storage.snapshot().inventories.values()][0].generationId, "empty");
});

test("revocation after the first committed page prevents further acquisition and full absence inference", async () => {
  const h = harness({ pages: [{ items: [activeItem("a")] }, { items: [activeItem("b")] }] });
  const original = h.ports.store.commitPage;
  h.ports.store.commitPage = async (input) => {
    const result = await original(input);
    if (result.success) {
      const head = h.registry.revisions.at(-1);
      const changed = appendSourceRevision(h.registry, {
        revision: head.revision + 1, state: "disabled", configuration: head.configuration,
        event: { eventId: "aud_sdk_disable", kind: "disable", actorRef: "actor_sdk",
          at: new Date(h.time.clock.nowMs()).toISOString(), reasonRef: "reason_revoked" },
      });
      assert.equal(changed.success, true);
      h.registry = changed.data;
    }
    return result;
  };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.ok(["policy_revision_changed", "policy_revoked"].includes(result.error.code));
  assert.equal(fetches(h).length, 1);
  assert.equal(h.storage.snapshot().observations.size, 1);
  assert.equal(h.storage.snapshot().tombstones.size, 0);
});

test("staged raw expires at equality before load, decode or refetch on resume", async () => {
  const h = harness({ registry: { policy: {
    retention: { rawSeconds: 1, normalizedSeconds: 100, mediaSeconds: 0, piiSeconds: 0 },
  } } });
  h.storage.faults.set("raw.staged", "after");
  assert.equal((await h.run()).status, "failed");
  h.time.advance(1000);
  const before = h.trace.length;
  const result = await h.run();
  assert.equal(result.error.code, "retention_expired");
  assert.equal(result.error.phase, "stage_raw");
  assert.ok(!h.trace.slice(before).some((event) => event === "map" || event === "store.loadRaw" || event.startsWith("fetch:")));
});

for (const phase of ["stage_ack", "pre_map_authority", "map_result"]) {
  test("retention expiry during " + phase + " stops fresh raw processing", async () => {
    const h = harness({ registry: {
      policy: { retention: { rawSeconds: 1, normalizedSeconds: 100, mediaSeconds: 0, piiSeconds: 0 } },
      operations: { timeoutMs: 2000 },
    } });
    if (phase === "stage_ack") {
      const original = h.ports.store.stageRaw;
      h.ports.store.stageRaw = async (input) => { const value = await original(input); h.time.advance(1000); return value; };
    } else if (phase === "pre_map_authority") {
      const original = h.ports.authority.loadVerifiedCurrent;
      h.ports.authority.loadVerifiedCurrent = async (input) => {
        const value = await original(input);
        if (h.trace.includes("store.raw.staged")) h.time.advance(1000);
        return value;
      };
    } else {
      const original = h.ports.adapter.mapPage;
      h.ports.adapter.mapPage = async (input) => { const value = await original(input); h.time.advance(1000); return value; };
    }
    const result = await h.run();
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "retention_expired");
    assert.equal(result.error.phase, "stage_raw");
    assert.equal(h.storage.snapshot().observations.size, 0);
    assert.equal(h.trace.includes("map"), phase === "map_result");
  });
}

for (const [name, change] of [
  ["legal status", (checkpoint) => { checkpoint.obligations.legalStatus = "official_api"; }],
  ["retention", (checkpoint) => { checkpoint.obligations.retention.rawSeconds += 1; }],
  ["operation policy", (checkpoint) => { checkpoint.operations.maxRetries += 1; }],
  ["request fields", (checkpoint) => { checkpoint.request.fields.push("vin"); }],
  ["scope", (checkpoint) => { checkpoint.scope.territory = "DE"; }],
  ["basis", (checkpoint) => { checkpoint.authorizationBasisRef = "evidence_other"; }],
]) {
  test("open receipt cannot forge the pinned " + name, async () => {
    const h = harness();
    const original = h.ports.store.openRun;
    h.ports.store.openRun = async (input) => { const value = copy(await original(input)); change(value.data.checkpoint); return value; };
    const result = await h.run();
    assert.equal(result.status, "failed");
    assert.equal(fetches(h).length, 0);
    assert.equal(h.storage.snapshot().raw.size, 0);
  });
}

test("attempt completion runtime rejects secret-bearing scalar and malformed circuit before telemetry", async () => {
  for (const change of [
    (runtime) => { runtime.revision = "synthetic-private-runtime-secret"; },
    (runtime) => { runtime.circuit.state = "synthetic-private-runtime-secret"; },
    (runtime) => { runtime.circuit.consecutiveTransientFailures = -1; },
  ]) {
    const h = harness();
    const original = h.ports.store.completeAttempt;
    h.ports.store.completeAttempt = async (input) => { const value = copy(await original(input)); change(value.data.runtime); return value; };
    const result = await h.run();
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "store_failed");
    assert.ok(!JSON.stringify(h.events).includes("synthetic-private-runtime-secret"));
    assert.equal(h.storage.snapshot().raw.size, 0);
  }
});

test("finalization receives only the budget remaining after its authority recheck", async () => {
  const h = harness();
  const authority = h.ports.authority.loadVerifiedCurrent;
  let delayed = false;
  h.ports.authority.loadVerifiedCurrent = async (input) => {
    const value = await authority(input);
    if (!delayed && [...h.storage.snapshot().runs.values()].some((run) => run.finalPageCommitKey !== null)) { delayed = true; h.time.advance(90); }
    return value;
  };
  let finalizedAt = null;
  h.ports.store.finalizeFullRun = (input) => new Promise((resolve) => {
    h.time.scheduler.schedule(20, () => { finalizedAt = h.time.clock.nowMs(); resolve({ acknowledged: true, success: false, failure: { code: "store_failed", retryable: false } }); });
    input.signal.addEventListener("abort", () => { finalizedAt = h.time.clock.nowMs(); });
  });
  const result = await h.run(request({ limits: { maxRunMs: 100 } }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "mutation_indeterminate");
  assert.equal(finalizedAt, NOW + 100);
});

test("a full page commit cannot masquerade as completed and skip reconciliation", async () => {
  const h = harness();
  const original = h.ports.store.commitPage;
  h.ports.store.commitPage = async (input) => {
    const value = copy(await original(input));
    const run = value.data.checkpoint;
    const result = { status: "completed", runId: run.runId, pages: run.committedPages,
      items: run.committedItems, checkpointRevision: run.checkpointRevision };
    const { schemaVersion, checkpointRevision, sourceId, runId, leaseFence, request: runRequest,
      requestSha256, startedAt, authorityRevision, registryRevision, configurationSha256,
      authorizationBasisRef, obligations, scope, baselineGenerationId, committedPages, committedItems } = run;
    value.data.checkpoint = { schemaVersion, status: "completed", checkpointRevision, sourceId, runId,
      leaseFence, request: runRequest, requestSha256, startedAt, completedAt: input.committedAt,
      completionOperationKey: input.operationKey, authorityRevision, registryRevision, configurationSha256,
      authorizationBasisRef, obligations, scope, baselineGenerationId, committedPages, committedItems,
      finalInventoryGenerationId: value.data.inventoryGenerationId, finalInventoryRevision: value.data.inventoryRevision, result };
    return value;
  };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "checkpoint_conflict");
  assert.equal(onlyRun(h).status, "running");
  assert.equal([...h.storage.snapshot().inventories.values()][0].lastCompletedFullAt, null);
});

test("a reservation receipt cannot erase the durable source-wide rate wait", async () => {
  const h = harness();
  assert.equal((await h.run()).status, "completed");
  const fetchCount = fetches(h).length;
  const original = h.ports.store.reserveAttempt;
  h.ports.store.reserveAttempt = async (input) => {
    const value = copy(await original(input));
    value.data.notBeforeMs = input.nowMs;
    return value;
  };
  const result = await h.run(request({ invocationKey: "second" }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "checkpoint_conflict");
  assert.equal(fetches(h).length, fetchCount);
});

for (const cursor of ["", "x".repeat(2048)]) {
  test("checkpoint and replay preserve an allowed opaque cursor of length " + cursor.length, async () => {
    const h = harness();
    const fetch = h.ports.adapter.fetchPage;
    h.ports.adapter.fetchPage = async (input) => {
      const result = await fetch(input);
      result.page.nextCursor = cursor;
      return result;
    };
    const first = await h.run();
    assert.equal(first.status, "completed");
    assert.equal([...h.storage.snapshot().inventories.values()][0].incrementalCursor, cursor);
    assert.deepEqual(await h.run(), first);
  });
}

test("authorization that expires while the current head is loading cannot start acquisition", async () => {
  const h = harness({ registry: { operations: { timeoutMs: 2000 }, policy: {
    authorization: { basisRef: "evidence_sdk_synthetic", reviewerRef: "actor_sdk_reviewer",
      reviewedAt: "2026-01-01T00:00:00.000Z", validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: new Date(NOW + 1000).toISOString() },
  } } });
  const original = h.ports.authority.loadVerifiedCurrent;
  h.ports.authority.loadVerifiedCurrent = async (input) => { const value = await original(input); h.time.advance(1000); return value; };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "policy_ineligible");
  assert.equal(fetches(h).length, 0);
  assert.equal(h.storage.snapshot().runs.size, 0);
});

test("a same-revision changed authority configuration fails the pinned digest recheck", async () => {
  const h = harness();
  const original = h.ports.authority.loadVerifiedCurrent;
  let reads = 0;
  h.ports.authority.loadVerifiedCurrent = async (input) => {
    const value = copy(await original(input));
    if (++reads > 1) {
      for (const revision of value.registry.revisions) revision.configuration.operations.maxRetries += 1;
    }
    return value;
  };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "policy_revision_changed");
  assert.equal(fetches(h).length, 0);
});

test("page acknowledgement cannot replace the pinned provenance policy for the next page", async () => {
  const h = harness({ pages: [{ items: [activeItem("first")] }, { items: [activeItem("second")] }] });
  const original = h.ports.store.commitPage;
  h.ports.store.commitPage = async (input) => {
    const value = copy(await original(input));
    value.data.checkpoint.obligations.legalStatus = "official_api";
    return value;
  };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "checkpoint_conflict");
  assert.equal(fetches(h).length, 1);
  assert.equal([...h.storage.snapshot().observations.values()][0].provenance.legalStatus, "dealer_feed");
});

for (const [name, change] of [
  ["baseline membership", (run) => { run.baselineActiveSourceListingIds.push("invented"); }],
  ["staged active membership", (run) => { run.stagedActiveSourceListingIds.push("invented"); }],
  ["staged ended membership", (run) => { run.stagedEndedSourceListingIds.push("invented"); }],
  ["visited cursor", (run) => { run.visitedCursors[0] = "invented"; }],
  ["raw counter", (run) => { run.committedRawBytes += 1; }],
  ["full cadence", (run) => { run.lastCompletedFullAt = new Date(NOW).toISOString(); }],
  ["inventory revision", (run) => { run.expectedInventoryRevision += 1; }],
]) {
  test("page receipt cannot alter " + name + " used by later reconciliation", async () => {
    const h = harness();
    const original = h.ports.store.commitPage;
    h.ports.store.commitPage = async (input) => { const value = copy(await original(input)); change(value.data.checkpoint); return value; };
    const result = await h.run();
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "checkpoint_conflict");
    assert.equal([...h.storage.snapshot().inventories.values()][0].lastCompletedFullAt, null);
  });
}

test("incremental completed result cannot disagree with its committed checkpoint counts", async () => {
  const h = harness();
  assert.equal((await h.run()).status, "completed");
  const original = h.ports.store.commitPage;
  h.ports.store.commitPage = async (input) => {
    const value = copy(await original(input));
    value.data.checkpoint.result.items += 1;
    return value;
  };
  const result = await h.run(request({ mode: "incremental", invocationKey: "second" }));
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "store_failed");
});

test("authorization expiry during lease acquisition prevents even opening a run", async () => {
  const h = harness({ registry: { operations: { timeoutMs: 2000 }, policy: {
    authorization: { basisRef: "evidence_sdk_synthetic", reviewerRef: "actor_sdk_reviewer",
      reviewedAt: "2026-01-01T00:00:00.000Z", validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: new Date(NOW + 1000).toISOString() },
  } } });
  const original = h.ports.lease.acquire;
  h.ports.lease.acquire = async (input) => { const value = await original(input); h.time.advance(1000); return value; };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "policy_ineligible");
  assert.equal(h.storage.snapshot().runs.size, 0);
  assert.equal(fetches(h).length, 0);
});

test("page-effect construction checks continuation within the identity derivation loop", async () => {
  const h = harness();
  h.storage.faults.set("raw.staged", "after");
  assert.equal((await h.run()).status, "failed");
  const checkpoint = onlyRun(h);
  const { buildCanonicalPageEffects } = await import("../dist/candidates.js");
  const stop = new Error("synthetic cooperative stop");
  let checks = 0;
  await assert.rejects(buildCanonicalPageEffects({ request: checkpoint.request, checkpoint,
    pending: checkpoint.pendingRaw, draft: { items: Array.from({ length: 500 }, (_, index) => activeItem("publication-" + index)) },
    checkContinuation: () => { if (++checks === 8) throw stop; },
  }), (error) => error === stop);
  assert.equal(checks, 8);
});

test("full reconciliation checks continuation within large missing-membership derivation", async () => {
  const h = harness();
  h.storage.faults.set("page.committed", "after");
  assert.equal((await h.run()).status, "failed");
  const checkpoint = { ...onlyRun(h), baselineActiveSourceListingIds: Array.from({ length: 500 }, (_, index) => "missing-" + index) };
  const { buildFullFinalization } = await import("../dist/effects.js");
  const stop = new Error("synthetic cooperative stop");
  let checks = 0;
  await assert.rejects(buildFullFinalization(checkpoint, new Date(NOW).toISOString(), checkpoint.authorityRevision,
    new globalThis.AbortController().signal, () => { if (++checks === 8) throw stop; }), (error) => error === stop);
  assert.equal(checks, 8);
});

test("a renewal during a rate wait cannot exceed the remaining whole-run budget", async () => {
  const h = harness({ registry: { operations: { requestsPerMinute: 1 } } });
  const acquire = h.ports.lease.acquire;
  h.ports.lease.acquire = async (input) => ({ ...await acquire(input), expiresAtMs: NOW + 100 });
  let abortedAt = null;
  h.ports.lease.renew = (input) => new Promise(() => {
    input.signal.addEventListener("abort", () => { abortedAt = h.time.clock.nowMs(); });
  });
  h.ports.adapter.fetchPage = async () => ({ success: false, failure: { kind: "transient" } });
  const result = await h.run(request({ limits: { maxRunMs: 60 } }));
  assert.equal(result.status, "failed");
  assert.equal(abortedAt, NOW + 60);
  assert.equal(h.time.clock.nowMs(), NOW + 60);
});

test("cancellation during renewal retains cancelled outcome and cleans SDK timers", async () => {
  const h = harness({ registry: { operations: { requestsPerMinute: 1 } } });
  const controller = new globalThis.AbortController();
  const acquire = h.ports.lease.acquire;
  h.ports.lease.acquire = async (input) => ({ ...await acquire(input), expiresAtMs: NOW + 100 });
  h.ports.lease.renew = async () => { controller.abort(); return new Promise(() => {}); };
  h.ports.adapter.fetchPage = async () => ({ success: false, failure: { kind: "transient" } });
  const result = await h.run(request(), controller.signal);
  assert.equal(result.status, "cancelled");
  assert.equal(result.error.phase, "lease");
  assert.equal(h.time.timers.size, 0);
});

for (const phase of ["open", "finalize"]) {
  test("authorization expiring during the last " + phase + " lease renewal prevents mutation", async () => {
    const h = harness({ registry: { policy: {
      authorization: { basisRef: "evidence_sdk_synthetic", reviewerRef: "actor_sdk_reviewer",
        reviewedAt: "2026-01-01T00:00:00.000Z", validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: new Date(NOW + 600).toISOString() },
    } } });
    const acquire = h.ports.lease.acquire;
    h.ports.lease.acquire = async (input) => {
      const value = await acquire(input);
      if (phase === "open") h.time.advance(400);
      return { ...value, expiresAtMs: NOW + (phase === "open" ? 600 : 1000) };
    };
    const renew = h.ports.lease.renew;
    h.ports.lease.renew = async (input) => { const value = await renew(input); h.time.advance(phase === "open" ? 300 : 100); return value; };
    if (phase === "finalize") {
      const authority = h.ports.authority.loadVerifiedCurrent;
      let delayed = false;
      h.ports.authority.loadVerifiedCurrent = async (input) => {
        const value = await authority(input);
        if (!delayed && [...h.storage.snapshot().runs.values()].some((run) => run.finalPageCommitKey !== null)) { delayed = true; h.time.advance(550); }
        return value;
      };
    }
    const result = await h.run();
    assert.equal(result.status, "failed");
    if (phase === "open") assert.equal(h.storage.snapshot().runs.size, 0);
    else assert.equal([...h.storage.snapshot().inventories.values()][0].lastCompletedFullAt, null);
  });
}

test("in-flight mapping is aborted at raw expiry and a later result cannot commit", async () => {
  const h = harness({ registry: { operations: { timeoutMs: 2000 }, policy: {
    retention: { rawSeconds: 1, normalizedSeconds: 100, mediaSeconds: 0, piiSeconds: 0 },
  } } });
  let childSignal;
  let abortedAt = null;
  let resolveLate;
  h.ports.adapter.mapPage = (input) => {
    childSignal = input.signal;
    input.signal.addEventListener("abort", () => { abortedAt = h.time.clock.nowMs(); });
    return new Promise((resolve) => { resolveLate = resolve; });
  };
  const result = await h.run();
  assert.equal(result.error.code, "retention_expired");
  assert.equal(result.error.phase, "stage_raw");
  assert.equal(abortedAt, NOW + 1000);
  assert.equal(childSignal.aborted, true);
  resolveLate({ items: [activeItem()] });
  await Promise.resolve();
  assert.equal(h.storage.snapshot().observations.size, 0);
  assert.equal(h.time.timers.size, 0);
});

test("resumed raw load is aborted at its remaining retention deadline", async () => {
  const h = harness({ registry: { operations: { timeoutMs: 2000 }, policy: {
    retention: { rawSeconds: 1, normalizedSeconds: 100, mediaSeconds: 0, piiSeconds: 0 },
  } } });
  h.storage.faults.set("raw.staged", "after");
  assert.equal((await h.run()).status, "failed");
  h.time.advance(500);
  let abortedAt = null;
  h.ports.store.loadStagedRaw = (input) => new Promise(() => {
    input.signal.addEventListener("abort", () => { abortedAt = h.time.clock.nowMs(); });
  });
  const result = await h.run();
  assert.equal(result.error.code, "retention_expired");
  assert.equal(abortedAt, NOW + 1000);
  assert.equal(h.storage.snapshot().observations.size, 0);
  assert.equal(fetches(h).length, 1);
});

test("pre-start cancellation has no authority/acquisition/store effects", async () => {
  const h = harness();
  const controller = new globalThis.AbortController();
  controller.abort("synthetic-private-cancel-reason");
  const result = await h.run(request(), controller.signal);
  assert.equal(result.status, "cancelled");
  assert.equal(result.error.code, "cancelled");
  assert.equal(h.trace.length, 0);
  assert.ok(!JSON.stringify(result).includes("synthetic-private"));
});

test("unacknowledged fetch timeout is terminal and cleans timers without retry", async () => {
  const h = harness();
  let calls = 0;
  let signal;
  let resolveLate;
  h.ports.adapter.fetchPage = (input) => {
    calls += 1;
    signal = input.signal;
    return new Promise((resolve) => { resolveLate = resolve; });
  };
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "deadline");
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
  resolveLate({ success: true, page: { pageIdentity: "late", bytes: utf8('{"items":[]}'), nextCursor: null, complete: true } });
  await Promise.resolve();
  assert.equal(h.storage.snapshot().raw.size, 0);
  assert.equal(h.time.timers.size, 0);
});

test("telemetry sink failures cannot change successful durable ingestion", async () => {
  const h = harness();
  h.ports.telemetry.emit = () => { throw new Error("synthetic-private-telemetry"); };
  const result = await h.run();
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.ok(h.storage.snapshot().outbox.length > 0);
});

test("all result/telemetry data excludes publication IDs, raw values and source references", async () => {
  const h = harness({ pages: [{ items: [activeItem("synthetic-private-publication")] }] });
  const result = await h.run();
  assert.equal(result.status, "completed");
  const emitted = JSON.stringify([result, h.events, h.storage.snapshot().outbox]);
  for (const forbidden of ["synthetic-private-publication", "evidence_sdk", "contact_sdk", "procedure_sdk", "amountMinor"]) {
    assert.ok(!emitted.includes(forbidden), forbidden);
  }
  assert.ok(h.time.clock.nowMs() >= NOW);
});
