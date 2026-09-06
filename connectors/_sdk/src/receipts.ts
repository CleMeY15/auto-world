import { parseConnectorRunId, parseListingId, parseRawSnapshotId, parseSourceId, type ValidationResult } from "@auto-world/vehicle-schema";
import { parseConnectorRunRequest } from "./validation.js";
import { parseSourceRuntimeState } from "./runtime-state.js";
import type {
  AttemptCompletionReceipt, AttemptReservation,
  ConnectorCheckpoint, FullRunReceipt, MutationReceipt, OpenRunResult,
  PageCommitReceipt, RunTerminalReceipt,
  SourceLease, StageRawReceipt, StagedRawPage,
} from "./types.js";

function invalid<T>(path = "$"): ValidationResult<T> {
  return Object.freeze({ success: false, issues: Object.freeze([Object.freeze({ code: "invalid_object" as const, path })]) });
}
function valid<T>(data: T): ValidationResult<T> { return Object.freeze({ success: true, data }); }
function record(value: unknown): value is Record<string, unknown> {
  try { return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) && Object.getOwnPropertySymbols(value).length === 0; }
  catch { return false; }
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Object.keys(descriptors).length === keys.length && keys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
    });
  } catch { return false; }
}
function integer(value: unknown, min = 0): value is number { return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min; }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\p{Cc}\p{Cs}]/u.test(value); }
function nullableCursor(value: unknown): boolean { return value === null || (typeof value === "string" && value.length <= 2048); }
function publication(value: unknown): value is string { return text(value) && value.length <= 256 && value.trim() === value; }
function stringArray(value: unknown, maximum = 100_000): value is readonly string[] { return Array.isArray(value) && value.length <= maximum && value.every(text); }
function utc(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && new Date(value).toISOString() === value; }
function digest(value: unknown): value is string { return typeof value === "string" && value.length === 64 && !/[^0-9a-f]/u.test(value); }
function literal(value: unknown, values: readonly string[]): boolean { return typeof value === "string" && values.includes(value); }
function range(value: unknown, min: number, max: number): boolean { return integer(value, min) && value <= max; }
function key(value: unknown, prefix: string): boolean { return typeof value === "string" && value.startsWith(prefix) && digest(value.slice(prefix.length)); }
function generation(value: unknown): boolean { return value === "empty" || key(value, "inv_"); }
function uniqueStrings(value: unknown, max = 100_000): value is readonly string[] { return stringArray(value, max) && new Set(value).size === value.length; }
function publications(value: unknown): boolean { return uniqueStrings(value) && value.every(publication); }
const METHODS = ["api", "feed", "crawl", "manual"];
const TERRITORIES = ["FR", "DE", "KR", "GB", "US", "CH", "JP"];
const FIELDS = ["source_listing_id", "url", "price", "mileage", "power", "co2", "vin", "description", "media", "seller_pii"];
const MUTATIONS = ["run.opened", "attempt.reserved", "attempt.completed", "raw.staged", "page.committed", "full.finalized", "circuit.changed", "run.terminal"];
const ERRORS = ["invalid_request", "runtime_capability", "cancelled", "deadline", "authority_untrusted", "authority_regression", "policy_revision_changed", "policy_ineligible", "policy_revoked", "full_reconciliation_required", "lease_unavailable", "lease_lost", "fence_not_quiesced", "circuit_open", "rate_limited", "acquisition_failed", "payload_too_large", "invalid_utf8", "invalid_json", "json_too_deep", "json_too_large", "duplicate_member", "adapter_output_invalid", "idempotency_conflict", "checkpoint_conflict", "mutation_indeterminate", "raw_conflict", "cursor_cycle", "limit_exceeded", "retention_expired", "store_failed", "finalize_failed"];
function snapshot<T>(value: T, seen = new Set<object>(), depth = 0): T {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value !== "object") throw new Error("invalid_scalar");
  if (depth > 64 || seen.has(value)) throw new Error("invalid_object");
  seen.add(value);
  if (value instanceof Uint8Array) {
    if (Object.getPrototypeOf(value) !== Uint8Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw new Error("invalid_bytes");
    const copy = Uint8Array.prototype.slice.call(value);
    const keys = Reflect.ownKeys(value);
    if (copy.byteLength > 1_048_576 || keys.length !== copy.byteLength || keys.some((name) => typeof name !== "string" || !/^\d+$/.test(name))) throw new Error("invalid_bytes");
    seen.delete(value);
    return copy as T;
  }
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const lengthDescriptor = descriptors.length;
    if (Object.getOwnPropertySymbols(value).length !== 0 || lengthDescriptor === undefined || !("value" in lengthDescriptor) || lengthDescriptor.value !== value.length || Object.keys(descriptors).length !== value.length + 1 || value.length > 100_000) throw new Error("invalid_array");
    const copy: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new Error("invalid_array");
      copy.push(snapshot(descriptor.value, seen, depth + 1));
    }
    seen.delete(value);
    return Object.freeze(copy) as T;
  }
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || Object.getOwnPropertySymbols(value).length !== 0) throw new Error("invalid_object");
  const output: Record<string, unknown> = {};
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = Object.entries(descriptors);
  if (entries.length > 200_000) throw new Error("invalid_object");
  for (const [key, descriptor] of entries) {
    if (!("value" in descriptor) || !descriptor.enumerable || key === "__proto__" || key === "prototype" || key === "constructor") throw new Error("invalid_object");
    Object.defineProperty(output, key, { value: snapshot(descriptor.value, seen, depth + 1), enumerable: true, configurable: false, writable: false });
  }
  seen.delete(value);
  return Object.freeze(output) as T;
}
function publish<T>(input: unknown, predicate: (value: Record<string, unknown>) => boolean): ValidationResult<T> {
  try {
    const detached = snapshot(input);
    if (!record(detached) || !predicate(detached)) return invalid();
    return valid(Object.freeze(detached) as T);
  } catch { return invalid(); }
}

const RUNNING_KEYS = ["schemaVersion", "status", "checkpointRevision", "sourceId", "runId", "leaseFence", "request", "requestSha256", "startedAt", "authorityRevision", "registryRevision", "configurationSha256", "authorizationBasisRef", "obligations", "operations", "scope", "baselineGenerationId", "baselineActiveSourceListingIds", "expectedInventoryGenerationId", "expectedInventoryRevision", "lastCompletedFullAt", "nextPageOrdinal", "nextCursor", "committedPages", "committedItems", "committedRawBytes", "visitedCursors", "finalPageCommitKey", "lastPageCommitKey", "pendingRaw", "stagedActiveSourceListingIds", "stagedEndedSourceListingIds"] as const;
const COMPLETED_KEYS = ["schemaVersion", "status", "checkpointRevision", "sourceId", "runId", "leaseFence", "request", "requestSha256", "startedAt", "completedAt", "completionOperationKey", "authorityRevision", "registryRevision", "configurationSha256", "authorizationBasisRef", "obligations", "scope", "baselineGenerationId", "finalInventoryGenerationId", "finalInventoryRevision", "committedPages", "committedItems", "result"] as const;

function completedResult(value: unknown): boolean {
  return record(value) && exact(value, ["status", "runId", "pages", "items", "checkpointRevision"]) && value.status === "completed" && parseConnectorRunId(value.runId).success && range(value.pages, 0, 1000) && range(value.items, 0, 100_000) && integer(value.checkpointRevision);
}
function scope(value: unknown, sourceId: unknown): boolean {
  return record(value) && exact(value, ["scopeId", "sourceId", "territory", "acquisitionMethod"]) && key(value.scopeId, "scope_") && value.sourceId === sourceId && parseSourceId(value.sourceId).success && literal(value.territory, TERRITORIES) && literal(value.acquisitionMethod, METHODS);
}
function deadlines(value: unknown): boolean {
  return record(value) && exact(value, ["rawRetainUntil", "normalizedRetainUntil", "mediaRetainUntil", "piiRetainUntil", "cacheUntil"]) && utc(value.rawRetainUntil) && utc(value.normalizedRetainUntil) && (value.mediaRetainUntil === null || utc(value.mediaRetainUntil)) && (value.piiRetainUntil === null || utc(value.piiRetainUntil)) && (value.cacheUntil === null || utc(value.cacheUntil));
}
function pendingRaw(value: unknown): boolean {
  return record(value) && exact(value, ["operationKey", "pageOrdinal", "pageIdentity", "snapshotId", "sha256", "byteLength", "capturedAt", "nextCursor", "complete", "deadlines"]) && key(value.operationKey, "stage_") && integer(value.pageOrdinal) && value.pageOrdinal <= 999 && publication(value.pageIdentity) && parseRawSnapshotId(value.snapshotId).success && digest(value.sha256) && integer(value.byteLength) && value.byteLength <= 1_048_576 && utc(value.capturedAt) && nullableCursor(value.nextCursor) && typeof value.complete === "boolean" && deadlines(value.deadlines);
}
function obligations(value: unknown): boolean {
  if (!record(value) || !exact(value, ["grant", "legalStatus", "authorizationBasisRef", "authorizationValidUntil", "caching", "retention", "media", "pii", "takedown"]) || !record(value.grant) || !record(value.caching) || !record(value.retention) || !record(value.media) || !record(value.pii) || !record(value.takedown)) return false;
  return exact(value.grant, ["territory", "acquisitionMethod", "audience", "fields"]) && value.grant.audience === "internal" && literal(value.grant.territory, TERRITORIES) && literal(value.grant.acquisitionMethod, METHODS) && uniqueStrings(value.grant.fields, 10) && value.grant.fields.includes("source_listing_id") && value.grant.fields.every((field) => FIELDS.includes(field)) && literal(value.legalStatus, ["official_api", "licensed_partner", "dealer_feed", "permitted_crawl"]) && text(value.authorizationBasisRef) && utc(value.authorizationValidUntil) &&
    exact(value.caching, ["allowed", "maxAgeSeconds"]) && typeof value.caching.allowed === "boolean" && range(value.caching.maxAgeSeconds, value.caching.allowed ? 1 : 0, value.caching.allowed ? 315_360_000 : 0) &&
    exact(value.retention, ["rawSeconds", "normalizedSeconds", "mediaSeconds", "piiSeconds"]) && Object.values(value.retention).every((entry) => range(entry, 0, 315_360_000)) &&
    exact(value.media, ["mode", "attributionRequired"]) && literal(value.media.mode, ["none", "reference", "licensed_copy"]) && typeof value.media.attributionRequired === "boolean" &&
    exact(value.pii, ["mode", "purposeRef"]) && (value.pii.mode === "none" ? value.pii.purposeRef === null : literal(value.pii.mode, ["professional_only", "private_seller"]) && text(value.pii.purposeRef)) &&
    exact(value.takedown, ["contactRef", "procedureRef", "maxResponseSeconds"]) && text(value.takedown.contactRef) && text(value.takedown.procedureRef) && range(value.takedown.maxResponseSeconds, 1, 315_360_000);
}
function operations(value: unknown): boolean {
  return record(value) && exact(value, ["incremental", "fullReconcileIntervalSeconds", "deletionMode", "deletionPropagationSeconds", "freshnessSeconds", "requestsPerMinute", "concurrency", "timeoutMs", "maxRetries"]) && typeof value.incremental === "boolean" && literal(value.deletionMode, ["explicit_tombstone", "full_reconciliation", "both"]) && range(value.fullReconcileIntervalSeconds, 1, 315_360_000) && range(value.deletionPropagationSeconds, 1, 315_360_000) && range(value.freshnessSeconds, 1, 315_360_000) && range(value.requestsPerMinute, 1, 1_000_000) && range(value.concurrency, 1, 1000) && range(value.timeoutMs, 1, 300_000) && range(value.maxRetries, 0, 20);
}

function checkpointShape(value: Record<string, unknown>): boolean {
  const keys = value.status === "running" ? RUNNING_KEYS : value.status === "completed" ? COMPLETED_KEYS : null;
  if (keys === null || !exact(value, keys) || value.schemaVersion !== 1 || !integer(value.checkpointRevision) || !integer(value.leaseFence, 1) || !parseSourceId(value.sourceId).success || !parseConnectorRunId(value.runId).success || !generation(value.baselineGenerationId)) return false;
  const request = parseConnectorRunRequest(value.request);
  if (!request.success || request.data.sourceId !== value.sourceId || !digest(value.requestSha256) || !digest(value.configurationSha256) || !utc(value.startedAt) || !integer(value.authorityRevision, 1) || !integer(value.registryRevision, 1) || !text(value.authorizationBasisRef) || !obligations(value.obligations) || !scope(value.scope, value.sourceId)) return false;
  if (!range(value.committedPages, 0, request.data.limits.maxPages) || !range(value.committedItems, 0, request.data.limits.maxItems)) return false;
  if (value.status === "running") return operations(value.operations) && value.nextPageOrdinal === value.committedPages && integer(value.expectedInventoryRevision) && generation(value.expectedInventoryGenerationId) && (value.lastCompletedFullAt === null || utc(value.lastCompletedFullAt)) && range(value.committedRawBytes, 0, request.data.limits.maxPages * request.data.limits.maxPageBytes) && publications(value.baselineActiveSourceListingIds) && Array.isArray(value.visitedCursors) && value.visitedCursors.length === value.committedPages && value.visitedCursors.every(nullableCursor) && nullableCursor(value.nextCursor) && (value.finalPageCommitKey === null || key(value.finalPageCommitKey, "commit_")) && (value.lastPageCommitKey === null || key(value.lastPageCommitKey, "commit_")) && (value.pendingRaw === null || pendingRaw(value.pendingRaw)) && publications(value.stagedActiveSourceListingIds) && publications(value.stagedEndedSourceListingIds);
  return utc(value.completedAt) && text(value.completionOperationKey) && integer(value.finalInventoryRevision) && generation(value.finalInventoryGenerationId) && completedResult(value.result) && record(value.result) && value.result.runId === value.runId && value.result.pages === value.committedPages && value.result.items === value.committedItems && value.result.checkpointRevision === value.checkpointRevision;
}

function missingTombstone(value: unknown): boolean {
  return record(value) && exact(value, ["schemaVersion", "tombstoneId", "kind", "scope", "listingId", "sourceListingId", "runId", "baselineGenerationId", "inventoryGenerationId", "finalizationKey", "completedAt"]) && value.schemaVersion === 1 && value.kind === "inferred_missing" && key(value.tombstoneId, "tmb_") && record(value.scope) && scope(value.scope, value.scope.sourceId) && parseListingId(value.listingId).success && publication(value.sourceListingId) && parseConnectorRunId(value.runId).success && generation(value.baselineGenerationId) && key(value.inventoryGenerationId, "inv_") && key(value.finalizationKey, "final_") && utc(value.completedAt);
}

function mutationRecord(value: unknown): boolean {
  return record(value) && exact(value, ["schemaVersion", "kind", "operationKey", "sourceId", "runId", "leaseFence", "recordedAt", "checkpointRevision", "runtimeRevision", "pageOrdinal", "itemCount", "byteCount", "outcome", "errorCode"]) && value.schemaVersion === 1 && literal(value.kind, MUTATIONS) && text(value.operationKey) && parseSourceId(value.sourceId).success && parseConnectorRunId(value.runId).success && integer(value.leaseFence, 1) && utc(value.recordedAt) && (value.checkpointRevision === null || integer(value.checkpointRevision)) && (value.runtimeRevision === null || integer(value.runtimeRevision)) && (value.pageOrdinal === null || range(value.pageOrdinal, 0, 999)) && (value.itemCount === null || range(value.itemCount, 0, 100_000)) && (value.byteCount === null || range(value.byteCount, 0, 1_048_576_000)) && (value.outcome === null || literal(value.outcome, ["success", "failed", "cancelled"])) && (value.errorCode === null || literal(value.errorCode, ERRORS));
}

export function parseSourceLease(input: unknown): ValidationResult<SourceLease> {
  return publish(input, (value) => exact(value, ["leaseId", "leaseFence", "expiresAtMs"]) && text(value.leaseId) && integer(value.leaseFence, 1) && integer(value.expiresAtMs));
}
export function parseAttemptReservationReceipt(input: unknown): ValidationResult<AttemptReservation> {
  return publish(input, (value) => exact(value, ["reservationKey", "runtimeRevision", "notBeforeMs", "nextRequestAtMs", "ownsHalfOpenProbe"]) && text(value.reservationKey) && integer(value.runtimeRevision, 1) && integer(value.notBeforeMs) && integer(value.nextRequestAtMs) && typeof value.ownsHalfOpenProbe === "boolean");
}
export function parseAttemptCompletionReceipt(input: unknown): ValidationResult<AttemptCompletionReceipt> {
  return publish(input, (value) => exact(value, ["operationKey", "reservationKey", "runtime"]) && text(value.operationKey) && text(value.reservationKey) && parseSourceRuntimeState(value.runtime) !== null);
}
export function parseConnectorCheckpoint(input: unknown): ValidationResult<ConnectorCheckpoint> { return publish(input, checkpointShape); }
export function parseOpenRunResult(input: unknown): ValidationResult<OpenRunResult> {
  return publish(input, (value) => {
    const completed = value.status === "completed";
    if (!exact(value, completed ? ["status", "oldFencesQuiesced", "checkpoint", "result"] : ["status", "oldFencesQuiesced", "checkpoint"]) || value.oldFencesQuiesced !== true) return false;
    if (completed) {
      const checkpoint = parseConnectorCheckpoint(value.checkpoint);
      return checkpoint.success && checkpoint.data.status === "completed" && completedResult(value.result) && (value.result as Record<string, unknown>).runId === checkpoint.data.runId && (value.result as Record<string, unknown>).checkpointRevision === checkpoint.data.checkpointRevision && (value.result as Record<string, unknown>).pages === checkpoint.data.committedPages && (value.result as Record<string, unknown>).items === checkpoint.data.committedItems;
    }
    return (value.status === "opened" || value.status === "resumed") && parseConnectorCheckpoint(value.checkpoint).success && (value.checkpoint as {status?:unknown}).status === "running";
  });
}
export function parseStageRawReceipt(input: unknown): ValidationResult<StageRawReceipt> {
  return publish(input, (value) => exact(value, ["operationKey", "snapshotId", "sha256", "byteLength", "checkpointRevision"]) && key(value.operationKey, "stage_") && parseRawSnapshotId(value.snapshotId).success && digest(value.sha256) && range(value.byteLength, 0, 1_048_576) && integer(value.checkpointRevision));
}
export function parseStagedRawPage(input: unknown): ValidationResult<StagedRawPage> {
  return publish(input, (value) => exact(value, ["pending", "bytes", "obligations"]) && pendingRaw(value.pending) && value.bytes instanceof Uint8Array && value.bytes.byteLength === (value.pending as Record<string, unknown>).byteLength && obligations(value.obligations));
}
export function parsePageCommitReceipt(input: unknown): ValidationResult<PageCommitReceipt> {
  return publish(input, (value) => {
    if (!exact(value, ["operationKey", "checkpointRevision", "inventoryGenerationId", "inventoryRevision", "committedPages", "committedItems", "complete", "checkpoint"]) || !key(value.operationKey, "commit_") || !integer(value.checkpointRevision) || !generation(value.inventoryGenerationId) || !integer(value.inventoryRevision) || !integer(value.committedPages) || !integer(value.committedItems) || typeof value.complete !== "boolean") return false;
    const checkpoint = parseConnectorCheckpoint(value.checkpoint);
    return checkpoint.success && checkpoint.data.checkpointRevision === value.checkpointRevision && checkpoint.data.committedPages === value.committedPages && checkpoint.data.committedItems === value.committedItems && (checkpoint.data.status !== "completed" || value.complete === true);
  });
}
export function parseFullRunReceipt(input: unknown): ValidationResult<FullRunReceipt> {
  return publish(input, (value) => exact(value, ["operationKey", "finalizationKey", "checkpointRevision", "inventoryGenerationId", "inventoryRevision", "inferredMissing", "result"]) && key(value.operationKey, "final_") && key(value.finalizationKey, "final_") && integer(value.checkpointRevision) && key(value.inventoryGenerationId, "inv_") && integer(value.inventoryRevision) && Array.isArray(value.inferredMissing) && value.inferredMissing.length <= 100_000 && value.inferredMissing.every(missingTombstone) && completedResult(value.result));
}
export function parseMutationReceiptOrNull(input: unknown): ValidationResult<MutationReceipt | null> {
  if (input === null) return valid(null);
  return publish(input, (value) => exact(value, ["operationKey", "kind", "payloadSha256", "record"]) && text(value.operationKey) && literal(value.kind, MUTATIONS) && digest(value.payloadSha256) && mutationRecord(value.record) && record(value.record) && value.record.operationKey === value.operationKey && value.record.kind === value.kind);
}
export function parseRunTerminalReceipt(input: unknown): ValidationResult<RunTerminalReceipt> {
  return publish(input, (value) => exact(value, ["operationKey", "checkpointRevision", "recorded"]) && text(value.operationKey) && (value.checkpointRevision === null || integer(value.checkpointRevision)) && value.recorded === true);
}
