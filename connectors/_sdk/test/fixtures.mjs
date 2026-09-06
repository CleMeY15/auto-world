import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers";
import { parseSourceRegistry } from "@auto-world/source-registry";
import { parseSourceId } from "@auto-world/vehicle-schema";

export const NOW = Date.parse("2026-09-06T12:00:00.000Z");
export const SOURCE = parseSourceId("src_sdk_synthetic").data;
export const utf8 = (value) => new globalThis.TextEncoder().encode(value);
export const copy = (value) => globalThis.structuredClone(value);
export const ok = (data) => ({ acknowledged: true, success: true, data: copy(data) });
export const fail = (code) => ({ acknowledged: true, success: false, failure: { code, retryable: false } });

export function registry(overrides = {}) {
  const configuration = {
    displayName: "Synthetic SDK fixture",
    territories: ["FR"],
    acquisitionMethods: ["feed"],
    credentials: { kind: "none" },
    legalStatus: "dealer_feed",
    policy: {
      authorization: {
        basisRef: "evidence_sdk_synthetic",
        reviewerRef: "actor_sdk_reviewer",
        reviewedAt: "2026-01-01T00:00:00.000Z",
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2027-01-01T00:00:00.000Z",
      },
      grants: [{
        territory: "FR", acquisitionMethod: "feed", audience: "internal",
        fields: ["source_listing_id", "url", "price", "mileage", "power", "co2", "vin"],
      }],
      caching: { allowed: false, maxAgeSeconds: 0 },
      retention: { rawSeconds: 86400, normalizedSeconds: 172800, mediaSeconds: 0, piiSeconds: 0 },
      media: { mode: "none", attributionRequired: false },
      pii: { mode: "none", purposeRef: null },
      takedown: { contactRef: "contact_sdk", procedureRef: "procedure_sdk", maxResponseSeconds: 3600 },
      ...overrides.policy,
    },
    operations: {
      incremental: true, fullReconcileIntervalSeconds: 86400, deletionMode: "both",
      deletionPropagationSeconds: 3600, freshnessSeconds: 3600,
      requestsPerMinute: 120, concurrency: 4, timeoutMs: 1000, maxRetries: 6,
      ...overrides.operations,
    },
    healthPolicy: {
      maxSampleAgeSeconds: 900, maxSuccessAgeSeconds: 1800,
      maxErrorBps: 100, maxParseErrorBps: 100, maxStaleBps: 100, maxLatencyP95Ms: 500,
    },
  };
  const result = parseSourceRegistry({
    schemaVersion: 1, sourceId: SOURCE,
    revisions: [
      {
        revision: 1, state: "disabled", configuration,
        event: { eventId: "aud_sdk_create", kind: "create", actorRef: "actor_sdk",
          at: "2026-01-02T00:00:00.000Z", reasonRef: "reason_sdk" },
      },
      {
        revision: 2, state: "enabled", configuration,
        event: { eventId: "aud_sdk_enable", kind: "enable", actorRef: "actor_sdk",
          at: "2026-01-03T00:00:00.000Z", reasonRef: "reason_sdk" },
      },
    ],
  });
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
}

export function request(overrides = {}) {
  return {
    schemaVersion: 1, sourceId: SOURCE, territory: "FR", acquisitionMethod: "feed",
    audience: "internal", fields: ["price", "source_listing_id"], mode: "full",
    invocationKey: "synthetic-1", adapterVersion: "fixture-1", mapperVersion: "mapper-1",
    ...overrides,
    limits: {
      maxPages: 10, maxItems: 100, maxRunMs: 100000, maxEffectMs: 2000,
      maxPageBytes: 4096, maxJsonDepth: 8, maxJsonMembers: 1000,
      ...overrides.limits,
    },
  };
}

export function fakeTime(initial = NOW) {
  let current = initial;
  let sequence = 0;
  const timers = new Map();
  const clock = { nowMs: () => current };
  const scheduler = {
    schedule(ms, callback) {
      assert.ok(Number.isFinite(ms) && ms >= 0, "invalid timer duration");
      const id = ++sequence;
      timers.set(id, { at: current + ms, callback });
      return { cancel() { timers.delete(id); } };
    },
  };
  function advance(ms) {
    const target = current + ms;
    assert.ok(target >= current);
    let remaining = 10000;
    for (;;) {
      const due = [...timers].filter(([, item]) => item.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!due) break;
      assert.ok(remaining-- > 0, "unbounded scheduler loop");
      timers.delete(due[0]);
      current = due[1].at;
      due[1].callback();
    }
    current = target;
  }
  async function drive(promise, { autoAdvance = true } = {}) {
    let settled = false;
    let value;
    let error;
    promise.then((result) => { settled = true; value = result; },
      (reason) => { settled = true; error = reason; });
    // Event-loop yields let native WebCrypto finish; this is not a wall-clock sleep.
    for (let turn = 0; turn < 20000 && !settled; turn += 1) {
      await new Promise(nextTurn);
      if (!settled && autoAdvance && turn % 20 === 19 && timers.size) {
        const next = Math.min(...[...timers.values()].map((timer) => timer.at));
        advance(next - current);
      }
    }
    assert.ok(settled, "synthetic run did not settle within bounded event-loop turns");
    if (error) throw error;
    return value;
  }
  return { clock, scheduler, advance, drive, timers };
}

export function fakeLease(time, trace = []) {
  let current = null;
  let fence = 0;
  let grantedTtlMs = 0;
  return {
    async acquire(input) {
      trace.push("lease.acquire");
      if (current && current.expiresAtMs > time.clock.nowMs()) throw new Error("synthetic lease held");
      grantedTtlMs = input.ttlMs;
      current = { leaseId: "lease_" + (++fence), leaseFence: fence,
        expiresAtMs: time.clock.nowMs() + input.ttlMs };
      return copy(current);
    },
    async renew(input) {
      trace.push("lease.renew");
      if (!current || input.lease.leaseFence !== current.leaseFence ||
          current.expiresAtMs <= time.clock.nowMs()) throw new Error("synthetic lease lost");
      // Lease duration is known from the initial grant, not invented by the runner.
      current = { ...current, expiresAtMs: time.clock.nowMs() + grantedTtlMs };
      return copy(current);
    },
    async release(input) {
      trace.push("lease.release");
      if (current?.leaseFence === input.lease.leaseFence) current = null;
    },
  };
}

export function activeItem(id = "publication-1", amountMinor = 123400) {
  return { sourceListingId: id, outcome: "active",
    observations: [{ field: "price", value: { amountMinor, currency: "EUR" }, confidenceBps: 10000 }] };
}

export function adapter(pages = [{ items: [activeItem()] }], trace = []) {
  return {
    async fetchPage(input) {
      trace.push("fetch:" + input.pageOrdinal + ":" + input.attempt);
      const page = pages[input.pageOrdinal];
      if (!page) throw new Error("synthetic unexpected page");
      const bytes = utf8(JSON.stringify(page));
      assert.ok(bytes.byteLength <= input.maxResponseBytes, "synthetic stream cap");
      return { success: true, page: {
        pageIdentity: "page-" + input.pageOrdinal, bytes,
        nextCursor: input.pageOrdinal === pages.length - 1 ? "watermark-1" : "cursor-" + (input.pageOrdinal + 1),
        complete: input.pageOrdinal === pages.length - 1,
      } };
    },
    async mapPage(input) {
      trace.push("map");
      return copy(input.decoded);
    },
  };
}
