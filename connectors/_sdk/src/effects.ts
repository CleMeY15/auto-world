import { deriveFinalizationKey, deriveInventoryGenerationId, deriveListingId, deriveMissingTombstoneId } from "./keys.js";
import type {
  ExactUtcTimestamp, FinalizeFullRunRequest, InferredMissingTombstone,
  PolicyObligations, RetentionDeadlines, RunningConnectorCheckpoint,
} from "./types.js";

function exactUtc(milliseconds: number): ExactUtcTimestamp {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 253_402_300_799_999) {
    throw new Error("connector_invalid_time");
  }
  return new Date(milliseconds).toISOString();
}

function deadline(capturedAtMs: number, seconds: number, authorizationEndMs: number): ExactUtcTimestamp {
  const candidate = capturedAtMs + seconds * 1_000;
  if (!Number.isSafeInteger(candidate)) throw new Error("connector_invalid_retention");
  return exactUtc(Math.min(candidate, authorizationEndMs));
}

export function deriveRetentionDeadlines(capturedAt: ExactUtcTimestamp, obligations: PolicyObligations): RetentionDeadlines {
  const capturedAtMs = Date.parse(capturedAt);
  const authorizationEndMs = Date.parse(obligations.authorizationValidUntil);
  if (!Number.isSafeInteger(capturedAtMs) || !Number.isSafeInteger(authorizationEndMs) || capturedAtMs >= authorizationEndMs) {
    throw new Error("connector_retention_expired");
  }
  let effectiveRawSeconds = obligations.retention.rawSeconds;
  if (obligations.grant.fields.includes("seller_pii")) {
    effectiveRawSeconds = Math.min(effectiveRawSeconds, obligations.retention.piiSeconds);
  }
  if (obligations.grant.fields.includes("media") && obligations.media.mode === "licensed_copy") {
    effectiveRawSeconds = Math.min(effectiveRawSeconds, obligations.retention.mediaSeconds);
  }
  if (effectiveRawSeconds <= 0) throw new Error("connector_retention_expired");
  const rawRetainUntil = deadline(capturedAtMs, effectiveRawSeconds, authorizationEndMs);
  const normalizedRetainUntil = deadline(capturedAtMs, obligations.retention.normalizedSeconds, authorizationEndMs);
  const mediaRetainUntil = obligations.retention.mediaSeconds === 0 ? null : deadline(capturedAtMs, obligations.retention.mediaSeconds, authorizationEndMs);
  const piiRetainUntil = obligations.retention.piiSeconds === 0 ? null : deadline(capturedAtMs, obligations.retention.piiSeconds, authorizationEndMs);
  const cacheUntil = obligations.caching.allowed
    ? exactUtc(Math.min(capturedAtMs + obligations.caching.maxAgeSeconds * 1_000, Date.parse(normalizedRetainUntil)))
    : null;
  return Object.freeze({ rawRetainUntil, normalizedRetainUntil, mediaRetainUntil, piiRetainUntil, cacheUntil });
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

export async function buildFullFinalization(
  checkpoint: RunningConnectorCheckpoint,
  completedAt: ExactUtcTimestamp,
  authorityRevision: number,
  signal: AbortSignal,
): Promise<Omit<FinalizeFullRunRequest, "operationKey"> & { readonly operationKey: string }> {
  if (checkpoint.finalPageCommitKey === null) throw new Error("connector_final_page_missing");
  const inventoryGenerationId = await deriveInventoryGenerationId(checkpoint.scope.scopeId, checkpoint.runId, checkpoint.baselineGenerationId);
  const finalizationKey = await deriveFinalizationKey(checkpoint.scope.scopeId, checkpoint.runId, checkpoint.baselineGenerationId, inventoryGenerationId, checkpoint.finalPageCommitKey);
  const ended = new Set(checkpoint.stagedEndedSourceListingIds);
  const stagedActive = sortedUnique(checkpoint.stagedActiveSourceListingIds.filter((id) => !ended.has(id)));
  const nextActiveSourceListingIds = checkpoint.operations.deletionMode === "explicit_tombstone"
    ? sortedUnique([...checkpoint.baselineActiveSourceListingIds, ...stagedActive].filter((id) => !ended.has(id)))
    : stagedActive;
  const nextActive = new Set(nextActiveSourceListingIds);
  const missingIds = checkpoint.operations.deletionMode === "explicit_tombstone"
    ? []
    : sortedUnique(checkpoint.baselineActiveSourceListingIds.filter((id) => !nextActive.has(id) && !ended.has(id)));
  const inferredMissing: InferredMissingTombstone[] = [];
  for (const sourceListingId of missingIds) {
    const listingId = await deriveListingId(checkpoint.sourceId, sourceListingId);
    const tombstoneId = await deriveMissingTombstoneId(checkpoint.scope.scopeId, sourceListingId, checkpoint.baselineGenerationId, inventoryGenerationId, finalizationKey);
    inferredMissing.push(Object.freeze({ schemaVersion: 1, tombstoneId, kind: "inferred_missing", scope: checkpoint.scope, listingId, sourceListingId, runId: checkpoint.runId, baselineGenerationId: checkpoint.baselineGenerationId, inventoryGenerationId, finalizationKey, completedAt }));
  }
  return Object.freeze({
    schemaVersion: 1,
    sourceId: checkpoint.sourceId,
    runId: checkpoint.runId,
    operationKey: finalizationKey,
    leaseFence: checkpoint.leaseFence,
    signal,
    expectedCheckpointRevision: checkpoint.checkpointRevision,
    scope: checkpoint.scope,
    baselineGenerationId: checkpoint.baselineGenerationId,
    expectedInventoryGenerationId: checkpoint.expectedInventoryGenerationId,
    expectedInventoryRevision: checkpoint.expectedInventoryRevision,
    inventoryGenerationId,
    finalPageCommitKey: checkpoint.finalPageCommitKey,
    finalizationKey,
    completedAt,
    authorityRevision,
    nextActiveSourceListingIds,
    inferredMissing: Object.freeze(inferredMissing),
    deletionMode: checkpoint.operations.deletionMode,
  });
}
