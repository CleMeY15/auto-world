import type { ValidationResult } from "@auto-world/vehicle-schema";
import { parseConnectorRunRequest } from "./validation.js";
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
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\p{Cc}]/u.test(value); }
function nullableText(value: unknown): boolean { return value === null || text(value); }
function stringArray(value: unknown, maximum = 100_000): value is readonly string[] { return Array.isArray(value) && value.length <= maximum && value.every(text); }
function utc(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && new Date(value).toISOString() === value; }
function digest(value: unknown): value is string { return typeof value === "string" && value.length === 64 && !/[^0-9a-f]/u.test(value); }
function snapshot<T>(value: T, seen = new Set<object>(), depth = 0): T {
  if (typeof value !== "object" || value === null) return value;
  if (depth > 64 || seen.has(value)) throw new Error("invalid_object");
  seen.add(value);
  if (value instanceof Uint8Array) {
    const copy = value.slice();
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
  return record(value) && exact(value, ["status", "runId", "pages", "items", "checkpointRevision"]) && value.status === "completed" && text(value.runId) && integer(value.pages) && integer(value.items) && integer(value.checkpointRevision);
}
function scope(value: unknown, sourceId: unknown): boolean {
  return record(value) && exact(value, ["scopeId", "sourceId", "territory", "acquisitionMethod"]) && text(value.scopeId) && value.sourceId === sourceId && text(value.territory) && text(value.acquisitionMethod);
}
function deadlines(value: unknown): boolean {
  return record(value) && exact(value, ["rawRetainUntil", "normalizedRetainUntil", "mediaRetainUntil", "piiRetainUntil", "cacheUntil"]) && utc(value.rawRetainUntil) && utc(value.normalizedRetainUntil) && (value.mediaRetainUntil === null || utc(value.mediaRetainUntil)) && (value.piiRetainUntil === null || utc(value.piiRetainUntil)) && (value.cacheUntil === null || utc(value.cacheUntil));
}
function pendingRaw(value: unknown): boolean {
  return record(value) && exact(value, ["operationKey", "pageOrdinal", "pageIdentity", "snapshotId", "sha256", "byteLength", "capturedAt", "nextCursor", "complete", "deadlines"]) && text(value.operationKey) && integer(value.pageOrdinal) && value.pageOrdinal <= 999 && text(value.pageIdentity) && text(value.snapshotId) && digest(value.sha256) && integer(value.byteLength) && value.byteLength <= 1_048_576 && utc(value.capturedAt) && nullableText(value.nextCursor) && typeof value.complete === "boolean" && deadlines(value.deadlines);
}
function obligations(value: unknown): boolean {
  if (!record(value) || !exact(value, ["grant", "legalStatus", "authorizationBasisRef", "authorizationValidUntil", "caching", "retention", "media", "pii", "takedown"]) || !record(value.grant) || !record(value.caching) || !record(value.retention) || !record(value.media) || !record(value.pii) || !record(value.takedown)) return false;
  return exact(value.grant, ["territory", "acquisitionMethod", "audience", "fields"]) && value.grant.audience === "internal" && stringArray(value.grant.fields, 11) && text(value.authorizationBasisRef) && utc(value.authorizationValidUntil) && exact(value.caching, ["allowed", "maxAgeSeconds"]) && typeof value.caching.allowed === "boolean" && integer(value.caching.maxAgeSeconds) && exact(value.retention, ["rawSeconds", "normalizedSeconds", "mediaSeconds", "piiSeconds"]) && Object.values(value.retention).every((entry) => integer(entry)) && exact(value.media, ["mode", "attributionRequired"]) && typeof value.media.attributionRequired === "boolean" && exact(value.pii, ["mode", "purposeRef"]) && exact(value.takedown, ["contactRef", "procedureRef", "maxResponseSeconds"]);
}
function operations(value: unknown): boolean {
  return record(value) && exact(value, ["incremental", "fullReconcileIntervalSeconds", "deletionMode", "deletionPropagationSeconds", "freshnessSeconds", "requestsPerMinute", "concurrency", "timeoutMs", "maxRetries"]) && typeof value.incremental === "boolean" && typeof value.deletionMode === "string" && integer(value.fullReconcileIntervalSeconds) && integer(value.deletionPropagationSeconds) && integer(value.freshnessSeconds) && integer(value.requestsPerMinute, 1) && integer(value.concurrency, 1) && integer(value.timeoutMs, 1) && integer(value.maxRetries);
}

function checkpointShape(value: Record<string, unknown>): boolean {
  const keys = value.status === "running" ? RUNNING_KEYS : value.status === "completed" ? COMPLETED_KEYS : null;
  if (keys === null || !exact(value, keys) || value.schemaVersion !== 1 || !integer(value.checkpointRevision) || !integer(value.leaseFence, 1) || !text(value.sourceId) || !text(value.runId)) return false;
  const request = parseConnectorRunRequest(value.request);
  if (!request.success || request.data.sourceId !== value.sourceId || !digest(value.requestSha256) || !digest(value.configurationSha256) || !utc(value.startedAt) || !integer(value.authorityRevision, 1) || !integer(value.registryRevision, 1) || !text(value.authorizationBasisRef) || !obligations(value.obligations) || !scope(value.scope, value.sourceId)) return false;
  if (value.status === "running") return operations(value.operations) && integer(value.nextPageOrdinal) && value.nextPageOrdinal <= 1_000 && integer(value.expectedInventoryRevision) && integer(value.committedPages) && integer(value.committedItems) && integer(value.committedRawBytes) && stringArray(value.baselineActiveSourceListingIds) && Array.isArray(value.visitedCursors) && value.visitedCursors.length <= 1_000 && value.visitedCursors.every(nullableText) && nullableText(value.nextCursor) && nullableText(value.finalPageCommitKey) && nullableText(value.lastPageCommitKey) && (value.pendingRaw === null || pendingRaw(value.pendingRaw)) && stringArray(value.stagedActiveSourceListingIds) && stringArray(value.stagedEndedSourceListingIds);
  return utc(value.completedAt) && text(value.completionOperationKey) && integer(value.finalInventoryRevision) && integer(value.committedPages) && integer(value.committedItems) && completedResult(value.result) && (value.result as Record<string, unknown>).runId === value.runId;
}

export function parseSourceLease(input: unknown): ValidationResult<SourceLease> {
  return publish(input, (value) => exact(value, ["leaseId", "leaseFence", "expiresAtMs"]) && text(value.leaseId) && integer(value.leaseFence, 1) && integer(value.expiresAtMs));
}
export function parseAttemptReservationReceipt(input: unknown): ValidationResult<AttemptReservation> {
  return publish(input, (value) => exact(value, ["reservationKey", "runtimeRevision", "notBeforeMs", "nextRequestAtMs", "ownsHalfOpenProbe"]) && text(value.reservationKey) && integer(value.runtimeRevision, 1) && integer(value.notBeforeMs) && integer(value.nextRequestAtMs) && typeof value.ownsHalfOpenProbe === "boolean");
}
export function parseAttemptCompletionReceipt(input: unknown): ValidationResult<AttemptCompletionReceipt> {
  return publish(input, (value) => exact(value, ["operationKey", "reservationKey", "runtime"]) && text(value.operationKey) && text(value.reservationKey) && record(value.runtime) && exact(value.runtime, ["schemaVersion", "sourceId", "revision", "nextRequestAtMs", "circuit"]));
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
  return publish(input, (value) => exact(value, ["operationKey", "snapshotId", "sha256", "byteLength", "checkpointRevision"]) && text(value.operationKey) && text(value.snapshotId) && text(value.sha256) && integer(value.byteLength) && integer(value.checkpointRevision));
}
export function parseStagedRawPage(input: unknown): ValidationResult<StagedRawPage> {
  return publish(input, (value) => exact(value, ["pending", "bytes", "obligations"]) && pendingRaw(value.pending) && value.bytes instanceof Uint8Array && value.bytes.byteLength === (value.pending as Record<string, unknown>).byteLength && obligations(value.obligations));
}
export function parsePageCommitReceipt(input: unknown): ValidationResult<PageCommitReceipt> {
  return publish(input, (value) => {
    if (!exact(value, ["operationKey", "checkpointRevision", "inventoryGenerationId", "inventoryRevision", "committedPages", "committedItems", "complete", "checkpoint"]) || !text(value.operationKey) || !integer(value.checkpointRevision) || !integer(value.inventoryRevision) || !integer(value.committedPages) || !integer(value.committedItems) || typeof value.complete !== "boolean") return false;
    const checkpoint = parseConnectorCheckpoint(value.checkpoint);
    return checkpoint.success && checkpoint.data.checkpointRevision === value.checkpointRevision && checkpoint.data.committedPages === value.committedPages && checkpoint.data.committedItems === value.committedItems && (checkpoint.data.status !== "completed" || value.complete === true);
  });
}
export function parseFullRunReceipt(input: unknown): ValidationResult<FullRunReceipt> {
  return publish(input, (value) => exact(value, ["operationKey", "finalizationKey", "checkpointRevision", "inventoryGenerationId", "inventoryRevision", "inferredMissing", "result"]) && text(value.operationKey) && text(value.finalizationKey) && integer(value.checkpointRevision) && integer(value.inventoryRevision) && Array.isArray(value.inferredMissing) && value.inferredMissing.length <= 100_000 && completedResult(value.result));
}
export function parseMutationReceiptOrNull(input: unknown): ValidationResult<MutationReceipt | null> {
  if (input === null) return valid(null);
  return publish(input, (value) => exact(value, ["operationKey", "kind", "payloadSha256", "record"]) && text(value.operationKey) && text(value.kind) && digest(value.payloadSha256) && record(value.record) && exact(value.record, ["schemaVersion", "kind", "operationKey", "sourceId", "runId", "leaseFence", "recordedAt", "checkpointRevision", "runtimeRevision", "pageOrdinal", "itemCount", "byteCount", "outcome", "errorCode"]));
}
export function parseRunTerminalReceipt(input: unknown): ValidationResult<RunTerminalReceipt> {
  return publish(input, (value) => exact(value, ["operationKey", "checkpointRevision", "recorded"]) && text(value.operationKey) && (value.checkpointRevision === null || integer(value.checkpointRevision)) && value.recorded === true);
}
