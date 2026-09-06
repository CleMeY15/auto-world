import { createHash } from "node:crypto";
import * as sdk from "@auto-world/connector-sdk";
import { copy, fail, ok } from "./fixtures.mjs";

const same = (left, right) => stable(left) === stable(right);
function stable(value) {
  if (value instanceof Uint8Array) return JSON.stringify([...value]);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).filter((key) => key !== "signal" && key !== "leaseFence")
      .sort().map((key) => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
const digest = (value) => createHash("sha256").update(stable(value)).digest("hex");
const union = (...arrays) => [...new Set(arrays.flat())].sort();
const without = (values, excluded) => values.filter((value) => !excluded.includes(value));
class Rejected extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireState(condition, code = "invalid_state") {
  if (!condition) throw new Rejected(code);
}

export function referenceKey(prefix, kind, ...parts) {
  const frame = (part) => {
    const bytes = Buffer.from(String(part), "utf8");
    return Buffer.concat([Buffer.from(String(bytes.length) + ":"), bytes, Buffer.from([0])]);
  };
  const bytes = Buffer.concat([Buffer.from("aw-connector-v1\0"), frame(kind), ...parts.map(frame)]);
  return prefix + createHash("sha256").update(bytes).digest("hex");
}

export function syntheticStore(time, trace = []) {
  let state = {
    version: 0, fences: new Map(), runs: new Map(), inventories: new Map(),
    runtimes: new Map(), reservations: new Map(), completions: new Map(),
    raw: new Map(), versions: new Map(), listings: new Map(), observations: new Map(),
    tombstones: new Map(), projections: new Map(), ledger: new Map(), outbox: [],
  };
  const faults = new Map();
  const hooks = new Map();
  const now = () => new Date(time.clock.nowMs()).toISOString();
  const scopeKey = (input) => input.scope.scopeId;
  function inventory(draft, scope) {
    if (!draft.inventories.has(scope.scopeId)) {
      draft.inventories.set(scope.scopeId, {
        schemaVersion: 1, scope: copy(scope), generationId: "empty", revision: 0,
        activeSourceListingIds: [], lastCompletedFullAt: null, incrementalCursor: null,
      });
    }
    return draft.inventories.get(scope.scopeId);
  }
  function running(draft, input) {
    const run = draft.runs.get(input.runId);
    requireState(run?.status === "running");
    requireState(run.sourceId === input.sourceId);
    return run;
  }
  function append(map, key, value) {
    requireState(!map.has(key) || same(map.get(key), value), "idempotency_conflict");
    map.set(key, copy(value));
  }
  function completed(run, head, operationKey, completedAt) {
    const result = { status: "completed", runId: run.runId, pages: run.committedPages,
      items: run.committedItems, checkpointRevision: run.checkpointRevision };
    return {
      schemaVersion: 1, status: "completed", checkpointRevision: run.checkpointRevision,
      sourceId: run.sourceId, runId: run.runId, leaseFence: run.leaseFence,
      request: copy(run.request), requestSha256: run.requestSha256, startedAt: run.startedAt,
      completedAt, completionOperationKey: operationKey, authorityRevision: run.authorityRevision,
      registryRevision: run.registryRevision, configurationSha256: run.configurationSha256,
      authorizationBasisRef: run.authorizationBasisRef, obligations: copy(run.obligations),
      scope: copy(run.scope), baselineGenerationId: run.baselineGenerationId,
      finalInventoryGenerationId: head.generationId, finalInventoryRevision: head.revision,
      committedPages: run.committedPages, committedItems: run.committedItems, result,
    };
  }
  function project(draft, run, listingId, publication, outcome, at, versionId = null) {
    const key = run.scope.scopeId + ":" + listingId;
    const prior = draft.projections.get(key);
    draft.projections.set(key, {
      schemaVersion: 1, listingId, sourceId: run.sourceId, sourceListingId: publication,
      scope: copy(run.scope), latestVersionId: versionId ?? prior?.latestVersionId ?? null,
      state: outcome, projectionRevision: (prior?.projectionRevision ?? 0) + 1, updatedAt: at,
    });
  }
  async function mutate(kind, input, action, opening = false) {
    trace.push("store." + kind);
    const injected = faults.get(kind);
    faults.delete(kind);
    if (injected === "before") throw new Error("synthetic unacknowledged mutation");
    await hooks.get(kind)?.("before", input);
    const currentFence = state.fences.get(input.sourceId) ?? 0;
    if ((!opening && input.leaseFence !== currentFence) || input.leaseFence < currentFence) return fail("stale_fence");
    const fingerprint = digest(input);
    const old = state.ledger.get(input.operationKey);
    if (old) return same(old.payloadSha256, fingerprint) ? ok(old.data) : fail("idempotency_conflict");
    const draft = copy(state);
    let data;
    try {
      data = action(draft);
    } catch (error) {
      if (error instanceof Rejected) return fail(error.code);
      throw error;
    }
    const run = draft.runs.get(input.runId);
    const record = {
      schemaVersion: 1, kind, operationKey: input.operationKey, sourceId: input.sourceId,
      runId: input.runId, leaseFence: input.leaseFence, recordedAt: now(),
      checkpointRevision: run?.checkpointRevision ?? null, runtimeRevision: draft.runtimes.get(input.sourceId)?.revision ?? null,
      pageOrdinal: input.pageOrdinal ?? input.pending?.pageOrdinal ?? null,
      itemCount: input.pageItemCount ?? null, byteCount: input.bytes?.byteLength ?? null,
      outcome: input.result?.status ?? "success", errorCode: input.result?.error.code ?? null,
    };
    draft.ledger.set(input.operationKey, { operationKey: input.operationKey, kind,
      payloadSha256: fingerprint, record, data: copy(data) });
    draft.outbox.push(record);
    await hooks.get(kind)?.("prepared", input);
    if (state.version !== draft.version) {
      return fail(state.fences.get(input.sourceId) !== input.leaseFence ? "stale_fence" : "checkpoint_conflict");
    }
    draft.version += 1;
    state = draft;
    if (injected === "after") throw new Error("synthetic lost acknowledgement after commit");
    return ok(data);
  }
  const port = {
    openRun(input) {
      return mutate("run.opened", input, (draft) => {
        draft.fences.set(input.sourceId, input.leaseFence);
        const head = inventory(draft, input.scope);
        const old = draft.runs.get(input.runId);
        if (old) {
          requireState(old.requestSha256 === input.requestSha256, "idempotency_conflict");
          if (old.status === "completed") {
            return { status: "completed", oldFencesQuiesced: true, checkpoint: old, result: old.result };
          }
          requireState(old.authorityRevision === input.authority.authorityRevision &&
            old.configurationSha256 === input.configurationSha256, "idempotency_conflict");
          requireState(old.expectedInventoryRevision === head.revision &&
            old.expectedInventoryGenerationId === head.generationId, "inventory_conflict");
          old.leaseFence = input.leaseFence;
          old.checkpointRevision += 1;
          return { status: "resumed", oldFencesQuiesced: true, checkpoint: old };
        }
        if (input.request.mode === "incremental") {
          requireState(input.operations.incremental && head.lastCompletedFullAt !== null &&
            time.clock.nowMs() < Date.parse(head.lastCompletedFullAt) +
              input.operations.fullReconcileIntervalSeconds * 1000, "full_reconciliation_required");
        }
        const run = {
          schemaVersion: 1, status: "running", checkpointRevision: 1,
          sourceId: input.sourceId, runId: input.runId, leaseFence: input.leaseFence,
          request: copy(input.request), requestSha256: input.requestSha256, startedAt: input.openedAt,
          authorityRevision: input.authority.authorityRevision, registryRevision: input.registryRevision,
          configurationSha256: input.configurationSha256,
          authorizationBasisRef: input.obligations.authorizationBasisRef,
          obligations: copy(input.obligations), operations: copy(input.operations), scope: copy(input.scope),
          baselineGenerationId: head.generationId, baselineActiveSourceListingIds: [...head.activeSourceListingIds],
          expectedInventoryGenerationId: head.generationId, expectedInventoryRevision: head.revision,
          lastCompletedFullAt: head.lastCompletedFullAt, nextPageOrdinal: 0,
          nextCursor: input.request.mode === "full" ? null : head.incrementalCursor,
          committedPages: 0, committedItems: 0, committedRawBytes: 0, visitedCursors: [],
          finalPageCommitKey: null, lastPageCommitKey: null, pendingRaw: null,
          stagedActiveSourceListingIds: [], stagedEndedSourceListingIds: [],
        };
        draft.runs.set(input.runId, run);
        return { status: "opened", oldFencesQuiesced: true, checkpoint: run };
      }, true);
    },
    reserveAttempt(input) {
      return mutate("attempt.reserved", input, (draft) => {
        const runtime = draft.runtimes.get(input.sourceId) ?? {
          schemaVersion: 1, sourceId: input.sourceId, revision: 0, nextRequestAtMs: 0,
          circuit: { state: "closed", consecutiveTransientFailures: 0,
            openedAtMs: null, probeOwnerFence: null, probeExpiresAtMs: null },
        };
        const reduced = sdk.reduceAttemptReservation(runtime, input);
        requireState(reduced.success, reduced.failure?.code);
        draft.runtimes.set(input.sourceId, copy(reduced.nextState));
        draft.reservations.set(input.operationKey, { data: copy(reduced.data), fence: input.leaseFence });
        return reduced.data;
      });
    },
    completeAttempt(input) {
      return mutate("attempt.completed", input, (draft) => {
        const reserved = draft.reservations.get(input.reservationKey);
        requireState(reserved?.fence === input.leaseFence, "stale_fence");
        requireState(!draft.completions.has(input.reservationKey), "idempotency_conflict");
        const reduced = sdk.reduceAttemptCompletion(draft.runtimes.get(input.sourceId), reserved.data, input);
        requireState(reduced.success, reduced.failure?.code);
        draft.completions.set(input.reservationKey, copy(input.outcome));
        draft.runtimes.set(input.sourceId, copy(reduced.nextState));
        return reduced.data;
      });
    },
    stageRaw(input) {
      return mutate("raw.staged", input, (draft) => {
        const run = running(draft, input);
        requireState(run.checkpointRevision === input.checkpointRevision, "checkpoint_conflict");
        requireState(run.pendingRaw === null && run.nextPageOrdinal === input.pageOrdinal);
        requireState(time.clock.nowMs() < Date.parse(input.deadlines.rawRetainUntil), "retention_expired");
        requireState(same(run.obligations, input.obligations));
        requireState(createHash("sha256").update(input.bytes).digest("hex") === input.sha256, "raw_conflict");
        const pending = {
          operationKey: input.operationKey, pageOrdinal: input.pageOrdinal, pageIdentity: input.pageIdentity,
          snapshotId: input.snapshotId, sha256: input.sha256, byteLength: input.bytes.byteLength,
          capturedAt: input.capturedAt, nextCursor: input.nextCursor, complete: input.complete,
          deadlines: copy(input.deadlines),
        };
        append(draft.raw, input.snapshotId, { pending, bytes: copy(input.bytes), obligations: copy(input.obligations) });
        run.pendingRaw = pending;
        run.checkpointRevision += 1;
        return { operationKey: input.operationKey, snapshotId: input.snapshotId, sha256: input.sha256,
          byteLength: input.bytes.byteLength, checkpointRevision: run.checkpointRevision };
      });
    },
    async loadStagedRaw(input) {
      trace.push("store.loadRaw");
      if (input.leaseFence !== state.fences.get(input.sourceId)) return fail("stale_fence");
      const raw = state.raw.get(input.snapshotId);
      if (!raw) return fail("not_found");
      if (Date.parse(input.asOf) >= Date.parse(raw.pending.deadlines.rawRetainUntil)) return fail("retention_expired");
      return ok(raw);
    },
    commitPage(input) {
      return mutate("page.committed", input, (draft) => {
        const run = running(draft, input);
        const head = inventory(draft, run.scope);
        requireState(run.checkpointRevision === input.expectedCheckpointRevision, "checkpoint_conflict");
        requireState(head.revision === input.expectedInventoryRevision &&
          head.generationId === input.expectedInventoryGenerationId, "inventory_conflict");
        requireState(same(run.pendingRaw, input.pending) && draft.raw.has(input.pending.snapshotId));
        requireState(input.authorityRevision === run.authorityRevision);
        const { effects } = input;
        const allIds = [...effects.activeSourceListingIds, ...effects.endedSourceListingIds];
        requireState(new Set(allIds).size === allIds.length && allIds.length === input.pageItemCount);
        if (run.request.mode === "full") {
          const seen = [...run.stagedActiveSourceListingIds, ...run.stagedEndedSourceListingIds];
          requireState(allIds.every((id) => !seen.includes(id)), "idempotency_conflict");
        }
        requireState(run.committedItems + allIds.length <= run.request.limits.maxItems);
        for (const observation of effects.observations) {
          requireState(observation.provenance.sourceId === run.sourceId &&
            observation.provenance.raw.snapshotId === input.pending.snapshotId &&
            observation.provenance.raw.connectorRunId === run.runId &&
            observation.provenance.raw.sha256 === input.pending.sha256);
          append(draft.observations, observation.observationId, observation);
        }
        for (const version of effects.listingVersions) {
          append(draft.versions, version.listingVersionId, version);
          const listing = effects.listings.find((item) => item.listingId === version.listingId);
          requireState(listing !== undefined);
          append(draft.listings, version.listingVersionId, listing);
          project(draft, run, version.listingId, version.sourceListingId, "active", version.capturedAt, version.listingVersionId);
        }
        for (const tombstone of effects.explicitTombstones) {
          requireState(run.operations.deletionMode !== "full_reconciliation");
          append(draft.tombstones, tombstone.tombstoneId, tombstone);
          project(draft, run, tombstone.listingId, tombstone.sourceListingId, tombstone.outcome, tombstone.capturedAt);
        }
        if (run.request.mode === "incremental") {
          head.activeSourceListingIds = without(union(head.activeSourceListingIds, effects.activeSourceListingIds), effects.endedSourceListingIds);
          head.revision += 1;
          if (input.complete) head.incrementalCursor = input.nextCursor;
        } else {
          run.stagedActiveSourceListingIds = union(run.stagedActiveSourceListingIds, effects.activeSourceListingIds);
          run.stagedEndedSourceListingIds = union(run.stagedEndedSourceListingIds, effects.endedSourceListingIds);
        }
        run.expectedInventoryRevision = head.revision;
        run.expectedInventoryGenerationId = head.generationId;
        run.visitedCursors.push(run.nextCursor);
        run.nextCursor = input.nextCursor;
        run.nextPageOrdinal = input.nextPageOrdinal;
        run.committedPages += 1;
        run.committedItems += input.pageItemCount;
        run.committedRawBytes += input.pending.byteLength;
        run.pendingRaw = null;
        run.lastPageCommitKey = input.operationKey;
        run.checkpointRevision += 1;
        if (input.complete) run.finalPageCommitKey = input.operationKey;
        const checkpoint = input.complete && run.request.mode === "incremental"
          ? completed(run, head, input.operationKey, input.committedAt) : run;
        draft.runs.set(run.runId, checkpoint);
        return { operationKey: input.operationKey, checkpointRevision: run.checkpointRevision,
          inventoryGenerationId: head.generationId, inventoryRevision: head.revision,
          committedPages: run.committedPages, committedItems: run.committedItems,
          complete: input.complete, checkpoint };
      });
    },
    finalizeFullRun(input) {
      return mutate("full.finalized", input, (draft) => {
        const run = running(draft, input);
        const head = inventory(draft, run.scope);
        requireState(run.request.mode === "full" && run.pendingRaw === null && run.finalPageCommitKey === input.finalPageCommitKey);
        requireState(run.checkpointRevision === input.expectedCheckpointRevision, "checkpoint_conflict");
        requireState(head.revision === input.expectedInventoryRevision &&
          head.generationId === input.expectedInventoryGenerationId, "inventory_conflict");
        requireState(input.baselineGenerationId === run.baselineGenerationId &&
          input.authorityRevision === run.authorityRevision && same(input.scope, run.scope));
        requireState(input.deletionMode === run.operations.deletionMode);
        const explicitOnly = input.deletionMode === "explicit_tombstone";
        const nextActive = explicitOnly
          ? without(union(run.baselineActiveSourceListingIds, run.stagedActiveSourceListingIds), run.stagedEndedSourceListingIds)
          : [...run.stagedActiveSourceListingIds];
        const absent = explicitOnly ? [] : without(without(run.baselineActiveSourceListingIds,
          run.stagedActiveSourceListingIds), run.stagedEndedSourceListingIds);
        requireState(same([...input.nextActiveSourceListingIds].sort(), nextActive.sort()));
        requireState(same(input.inferredMissing.map((item) => item.sourceListingId).sort(), absent.sort()));
        for (const tombstone of input.inferredMissing) {
          requireState(tombstone.kind === "inferred_missing" && tombstone.runId === run.runId &&
            same(tombstone.scope, run.scope) && tombstone.finalizationKey === input.finalizationKey);
          requireState(tombstone.tombstoneId === referenceKey("tmb_", "missing-tombstone", run.scope.scopeId,
            tombstone.sourceListingId, run.baselineGenerationId, input.inventoryGenerationId, input.finalizationKey));
          append(draft.tombstones, tombstone.tombstoneId, tombstone);
          project(draft, run, tombstone.listingId, tombstone.sourceListingId, "missing", input.completedAt);
        }
        head.activeSourceListingIds = nextActive;
        head.generationId = input.inventoryGenerationId;
        head.revision += 1;
        head.lastCompletedFullAt = input.completedAt;
        head.incrementalCursor = run.nextCursor;
        run.checkpointRevision += 1;
        const checkpoint = completed(run, head, input.operationKey, input.completedAt);
        draft.runs.set(run.runId, checkpoint);
        return { operationKey: input.operationKey, finalizationKey: input.finalizationKey,
          checkpointRevision: checkpoint.checkpointRevision, inventoryGenerationId: head.generationId,
          inventoryRevision: head.revision, inferredMissing: copy(input.inferredMissing), result: checkpoint.result };
      });
    },
    async lookupMutation(input) {
      trace.push("store.lookup:" + input.expectedKind);
      if (input.leaseFence !== state.fences.get(input.sourceId)) return fail("stale_fence");
      const receipt = state.ledger.get(input.operationKey);
      if (!receipt) return ok(null);
      if (receipt.kind !== input.expectedKind || receipt.record.runId !== input.runId ||
          receipt.record.sourceId !== input.sourceId) return fail("idempotency_conflict");
      const { data: _data, ...publicReceipt } = receipt;
      void _data;
      return ok(publicReceipt);
    },
    recordRunTerminal(input) {
      return mutate("run.terminal", input, () => ({
        operationKey: input.operationKey, checkpointRevision: input.expectedCheckpointRevision, recorded: true,
      }));
    },
  };
  return { port, faults, hooks, snapshot: () => copy(state), scopeKey };
}
