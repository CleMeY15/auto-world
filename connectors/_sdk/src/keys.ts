import {
  parseConnectorRunId,
  parseListingId,
  parseObservationId,
  parseRawSnapshotId,
  type ConnectorRunId,
  type ListingId,
  type ObservationId,
  type RawSnapshotId,
  type SourceId,
} from "@auto-world/vehicle-schema";
import type { SourceConfiguration } from "@auto-world/source-registry";
import type {
  ConnectorRunRequest,
  ConnectorScopeId,
  InventoryGenerationId,
  LifecycleTombstoneId,
  ListingVersionId,
  ObservationDraft,
  OperationKey,
  Sha256Digest,
} from "./types.js";

export type ConnectorKeyKind =
  | "sample"
  | "request"
  | "source-configuration"
  | "run"
  | "page"
  | "raw"
  | "item"
  | "scope"
  | "listing"
  | "listing-version"
  | "observation"
  | "explicit-tombstone"
  | "missing-tombstone"
  | "inventory"
  | "commit"
  | "finalization"
  | "attempt-reservation"
  | "open"
  | "stage"
  | "attempt"
  | "terminal";

const PREFIX = new TextEncoder().encode("aw-connector-v1\0");
const encoder = new TextEncoder();

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function frame(part: string): Uint8Array {
  for (let index = 0; index < part.length; index += 1) {
    const code = part.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff) throw new Error("connector_invalid_unicode");
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = part.charCodeAt(index + 1);
      if (index + 1 >= part.length || low < 0xdc00 || low > 0xdfff) throw new Error("connector_invalid_unicode");
      index += 1;
    }
  }
  const bytes = encoder.encode(part);
  return concat([encoder.encode(`${bytes.byteLength}:`), bytes, new Uint8Array([0])]);
}

function digestToHex(buffer: ArrayBuffer): Sha256Digest {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(bytes: Uint8Array): Promise<Sha256Digest> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error("connector_crypto_unavailable");
  const copy = bytes.slice();
  return digestToHex(await subtle.digest("SHA-256", copy));
}

export async function sha256Bytes(bytes: Uint8Array): Promise<Sha256Digest> {
  if (!(bytes instanceof Uint8Array)) throw new Error("connector_invalid_bytes");
  return digest(bytes);
}

export async function hashConnectorKey(
  kind: ConnectorKeyKind,
  parts: readonly string[],
): Promise<Sha256Digest> {
  return digest(concat([PREFIX, frame(kind), ...parts.map(frame)]));
}

export async function derivePrefixedKey(
  prefix: string,
  kind: ConnectorKeyKind,
  parts: readonly string[],
): Promise<string> {
  return `${prefix}${await hashConnectorKey(kind, parts)}`;
}

function assertGenerated<T>(result: { readonly success: true; readonly data: T } | { readonly success: false }): T {
  if (!result.success) throw new Error("connector_generated_id_invalid");
  return result.data;
}

export async function deriveRunId(sourceId: SourceId, invocationKey: string): Promise<ConnectorRunId> {
  return assertGenerated(parseConnectorRunId(await derivePrefixedKey("run_", "run", [sourceId, invocationKey])));
}

export async function derivePageKey(runId: ConnectorRunId, pageOrdinal: number, pageIdentity: string): Promise<OperationKey> {
  return derivePrefixedKey("page_", "page", [runId, String(pageOrdinal), pageIdentity]);
}

export async function deriveRawSnapshotId(sourceId: SourceId, pageKey: OperationKey): Promise<RawSnapshotId> {
  return assertGenerated(parseRawSnapshotId(await derivePrefixedKey("raw_", "raw", [sourceId, pageKey])));
}

export async function deriveItemKey(sourceId: SourceId, sourceListingId: string): Promise<OperationKey> {
  return derivePrefixedKey("item_", "item", [sourceId, sourceListingId]);
}

export async function deriveScopeId(sourceId: SourceId, territory: string, acquisitionMethod: string): Promise<ConnectorScopeId> {
  return derivePrefixedKey("scope_", "scope", [sourceId, territory, acquisitionMethod]) as Promise<ConnectorScopeId>;
}

export async function deriveListingId(sourceId: SourceId, sourceListingId: string): Promise<ListingId> {
  return assertGenerated(parseListingId(await derivePrefixedKey("lst_", "listing", [sourceId, sourceListingId])));
}

export async function deriveListingVersionId(
  listingId: ListingId,
  runId: ConnectorRunId,
  snapshotId: RawSnapshotId,
  rawSha256: Sha256Digest,
  mapperVersion: string,
): Promise<ListingVersionId> {
  return derivePrefixedKey("lv_", "listing-version", [listingId, runId, snapshotId, rawSha256, mapperVersion]) as Promise<ListingVersionId>;
}

export function encodeObservationValue(draft: ObservationDraft): string {
  if (draft.field === "price") return `amountMinor=${draft.value.amountMinor};currency=${draft.value.currency}`;
  if (draft.field === "mileage" || draft.field === "power") return `amount=${String(draft.value.amount)};unit=${draft.value.unit}`;
  if (draft.field === "co2") return `amount=${String(draft.value.amount)};unit=g_per_km;standard=${draft.value.standard}`;
  return draft.value.status === "full" ? `status=full;vin=${draft.value.vin}` : `status=${draft.value.status}`;
}

export async function deriveObservationId(
  listingId: ListingId,
  draft: ObservationDraft,
  capturedAt: string,
  runId: ConnectorRunId,
  snapshotId: RawSnapshotId,
  rawSha256: Sha256Digest,
  mapperVersion: string,
): Promise<ObservationId> {
  const value = await derivePrefixedKey("obs_", "observation", [listingId, draft.field, encodeObservationValue(draft), String(draft.confidenceBps), capturedAt, runId, snapshotId, rawSha256, mapperVersion]);
  return assertGenerated(parseObservationId(value));
}

export async function deriveExplicitTombstoneId(
  scopeId: ConnectorScopeId,
  sourceListingId: string,
  outcome: "withdrawn" | "deleted",
  capturedAt: string,
  runId: ConnectorRunId,
  snapshotId: RawSnapshotId,
  rawSha256: Sha256Digest,
): Promise<LifecycleTombstoneId> {
  return derivePrefixedKey("tmb_", "explicit-tombstone", [scopeId, sourceListingId, outcome, capturedAt, runId, snapshotId, rawSha256]) as Promise<LifecycleTombstoneId>;
}

export async function deriveInventoryGenerationId(scopeId: ConnectorScopeId, runId: ConnectorRunId, baseline: InventoryGenerationId | "empty"): Promise<InventoryGenerationId> {
  return derivePrefixedKey("inv_", "inventory", [scopeId, runId, baseline]) as Promise<InventoryGenerationId>;
}

export async function derivePageCommitKey(pageKey: OperationKey, rawSha256: Sha256Digest, mapperVersion: string): Promise<OperationKey> {
  return derivePrefixedKey("commit_", "commit", [pageKey, rawSha256, mapperVersion]);
}

export async function deriveFinalizationKey(scopeId: ConnectorScopeId, runId: ConnectorRunId, baseline: InventoryGenerationId | "empty", next: InventoryGenerationId, finalPageCommitKey: OperationKey): Promise<OperationKey> {
  return derivePrefixedKey("final_", "finalization", [scopeId, runId, baseline, next, finalPageCommitKey]);
}

export async function deriveMissingTombstoneId(scopeId: ConnectorScopeId, sourceListingId: string, baseline: InventoryGenerationId | "empty", next: InventoryGenerationId, finalizationKey: OperationKey): Promise<LifecycleTombstoneId> {
  return derivePrefixedKey("tmb_", "missing-tombstone", [scopeId, sourceListingId, baseline, next, finalizationKey]) as Promise<LifecycleTombstoneId>;
}

export async function deriveAttemptReservationKey(runId: ConnectorRunId, leaseFence: number, pageOrdinal: number, attempt: number): Promise<OperationKey> {
  return derivePrefixedKey("reserve_", "attempt-reservation", [runId, String(leaseFence), String(pageOrdinal), String(attempt)]);
}

export async function deriveOpenOperationKey(runId: ConnectorRunId, leaseFence: number): Promise<OperationKey> {
  return derivePrefixedKey("open_", "open", [runId, String(leaseFence)]);
}

export async function deriveStageOperationKey(runId: ConnectorRunId, snapshotId: RawSnapshotId): Promise<OperationKey> {
  return derivePrefixedKey("stage_", "stage", [runId, snapshotId]);
}

export async function deriveAttemptCompletionKey(runId: ConnectorRunId, reservationKey: OperationKey): Promise<OperationKey> {
  return derivePrefixedKey("attempt_", "attempt", [runId, reservationKey]);
}

export async function deriveTerminalOperationKey(runId: ConnectorRunId, leaseFence: number, checkpointRevision: number | null, status: string, errorCode: string): Promise<OperationKey> {
  return derivePrefixedKey("terminal_", "terminal", [runId, String(leaseFence), checkpointRevision === null ? "none" : String(checkpointRevision), status, errorCode]);
}

export async function digestConnectorRequest(request: ConnectorRunRequest): Promise<Sha256Digest> {
  return hashConnectorKey("request", [
    String(request.schemaVersion), request.sourceId, request.territory, request.acquisitionMethod,
    request.audience, String(request.fields.length), ...request.fields, request.mode,
    request.invocationKey, request.adapterVersion, request.mapperVersion,
    String(request.limits.maxPages), String(request.limits.maxItems), String(request.limits.maxRunMs),
    String(request.limits.maxEffectMs), String(request.limits.maxPageBytes),
    String(request.limits.maxJsonDepth), String(request.limits.maxJsonMembers),
  ]);
}

export async function digestSourceConfiguration(configuration: SourceConfiguration): Promise<Sha256Digest> {
  const policy = configuration.policy;
  const parts: string[] = [
    configuration.displayName,
    String(configuration.territories.length), ...configuration.territories,
    String(configuration.acquisitionMethods.length), ...configuration.acquisitionMethods,
    configuration.credentials.kind,
    configuration.credentials.kind === "secret_ref" ? configuration.credentials.ref : "none",
    configuration.legalStatus,
  ];
  if (policy === null) {
    parts.push("no-policy");
  } else {
    parts.push("policy", policy.authorization.basisRef, policy.authorization.reviewerRef, policy.authorization.reviewedAt, policy.authorization.validFrom, policy.authorization.validUntil, String(policy.grants.length));
    for (const grant of policy.grants) parts.push(grant.territory, grant.acquisitionMethod, grant.audience, String(grant.fields.length), ...grant.fields);
    parts.push(String(policy.caching.allowed), String(policy.caching.maxAgeSeconds), String(policy.retention.rawSeconds), String(policy.retention.normalizedSeconds), String(policy.retention.mediaSeconds), String(policy.retention.piiSeconds), policy.media.mode, String(policy.media.attributionRequired), policy.pii.mode, policy.pii.purposeRef ?? "none", policy.takedown.contactRef, policy.takedown.procedureRef, String(policy.takedown.maxResponseSeconds));
  }
  const operations = configuration.operations;
  parts.push(String(operations.incremental), String(operations.fullReconcileIntervalSeconds), operations.deletionMode, String(operations.deletionPropagationSeconds), String(operations.freshnessSeconds), String(operations.requestsPerMinute), String(operations.concurrency), String(operations.timeoutMs), String(operations.maxRetries));
  const health = configuration.healthPolicy;
  parts.push(String(health.maxSampleAgeSeconds), String(health.maxSuccessAgeSeconds), String(health.maxErrorBps), String(health.maxParseErrorBps), String(health.maxStaleBps), String(health.maxLatencyP95Ms));
  return hashConnectorKey("source-configuration", parts);
}
