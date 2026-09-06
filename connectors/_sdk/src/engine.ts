import { verifyAuthorityHead, type AuthorityCheckResult } from "./authority.js";
import type { ConnectorRunId, ValidationResult } from "@auto-world/vehicle-schema";
import { buildCanonicalPageEffects } from "./candidates.js";
import { buildFullFinalization, deriveRetentionDeadlines } from "./effects.js";
import { decodeJsonPage } from "./json.js";
import {
  deriveAttemptCompletionKey, deriveAttemptReservationKey, deriveOpenOperationKey,
  derivePageCommitKey, derivePageKey, deriveRawSnapshotId, deriveRunId,
  deriveScopeId, deriveStageOperationKey, deriveTerminalOperationKey,
  digestConnectorRequest, digestSourceConfiguration, sha256Bytes,
} from "./keys.js";
import {
  parseAttemptCompletionReceipt, parseAttemptReservationReceipt, parseFullRunReceipt,
  parseOpenRunResult, parsePageCommitReceipt, parseRunTerminalReceipt, parseSourceLease,
  parseStageRawReceipt, parseStagedRawPage, parseMutationReceiptOrNull,
} from "./receipts.js";
import { parseAdapterFetchResult, parseConnectorRunRequest, parseMappedPageDraft, parseStoreResult } from "./validation.js";
import type {
  AdapterFailure, AttemptOutcome, ConnectorCheckpoint, ConnectorError,
  ConnectorErrorCode, ConnectorMutationKind, ConnectorPhase, ConnectorPorts,
  ConnectorRunRequest, ConnectorRunResult, ExactUtcTimestamp, PendingRawPage,
  PolicyObligations, RunningConnectorCheckpoint, SchedulerPort, SourceLease,
  StoreFailureCode, StoreResult,
} from "./types.js";

export const systemScheduler: SchedulerPort = Object.freeze({
  schedule(ms: number, onElapsed: () => void) {
    const timer = setTimeout(onElapsed, ms);
    return Object.freeze({ cancel() { clearTimeout(timer); } });
  },
});

class RunFault extends Error {
  constructor(readonly code: ConnectorErrorCode, readonly phase: ConnectorPhase, readonly attempt: number, readonly retryable = false) { super(code); }
}
interface LeaseContext { current: SourceLease; renewAtMs: number }

function now(ports: ConnectorPorts): number {
  let value: number;
  try { value = ports.clock.nowMs(); } catch { throw new RunFault("runtime_capability", "runtime", 0); }
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > 253_402_300_799_999) throw new RunFault("runtime_capability", "runtime", 0);
  return value;
}
function timestamp(value: number): ExactUtcTimestamp { return new Date(value).toISOString(); }
function effectBudget(ports: ConnectorPorts, deadlineAtMs: number, maximumMs: number, phase: ConnectorPhase, attempt = 0): number {
  const remaining = deadlineAtMs - now(ports);
  if (remaining <= 0) throw new RunFault("deadline", phase, attempt);
  return Math.min(maximumMs, remaining);
}

function assertPorts(ports: ConnectorPorts): void {
  try {
    if (!ports || typeof ports !== "object" || typeof ports.authority?.loadVerifiedCurrent !== "function" ||
        typeof ports.lease?.acquire !== "function" || typeof ports.lease?.renew !== "function" || typeof ports.lease?.release !== "function" ||
        typeof ports.store?.openRun !== "function" || typeof ports.store?.reserveAttempt !== "function" || typeof ports.store?.completeAttempt !== "function" ||
        typeof ports.store?.stageRaw !== "function" || typeof ports.store?.loadStagedRaw !== "function" || typeof ports.store?.commitPage !== "function" ||
        typeof ports.store?.finalizeFullRun !== "function" || typeof ports.store?.lookupMutation !== "function" || typeof ports.store?.recordRunTerminal !== "function" ||
        typeof ports.adapter?.fetchPage !== "function" || typeof ports.adapter?.mapPage !== "function" || typeof ports.clock?.nowMs !== "function" ||
        typeof ports.scheduler?.schedule !== "function" || typeof ports.random?.next !== "function" || typeof ports.telemetry?.emit !== "function") throw new Error();
  } catch { throw new RunFault("runtime_capability", "runtime", 0); }
}

function assertNativeCapabilities(): void {
  try {
    if (typeof globalThis.crypto?.subtle?.digest !== "function") throw new Error();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(new Uint8Array());
  } catch {
    throw new RunFault("runtime_capability", "runtime", 0);
  }
}

async function bounded<T>(ports: ConnectorPorts, parent: AbortSignal, ms: number, phase: ConnectorPhase, attempt: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (parent.aborted) throw new RunFault("cancelled", phase, attempt);
  const controller = new AbortController();
  let reason: "deadline" | "cancelled" | null = null;
  const cancel = () => { reason = "cancelled"; controller.abort(); };
  parent.addEventListener("abort", cancel, { once: true });
  let scheduled;
  let removeChildAbort: () => void = () => undefined;
  try {
    scheduled = ports.scheduler.schedule(ms, () => { reason = "deadline"; controller.abort(); });
    const aborted = new Promise<never>((_, reject) => {
      const rejectAbort = () => reject(new RunFault(reason === "cancelled" ? "cancelled" : "deadline", phase, attempt));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      removeChildAbort = () => controller.signal.removeEventListener("abort", rejectAbort);
    });
    return await Promise.race([
      operation(controller.signal),
      aborted,
    ]);
  } finally {
    parent.removeEventListener("abort", cancel);
    removeChildAbort();
    try { scheduled?.cancel(); } catch { /* best effort */ }
  }
}

function storeCode(code: StoreFailureCode, phase: ConnectorPhase): ConnectorErrorCode {
  if (code === "stale_fence") return "lease_lost";
  if (code === "fence_not_quiesced") return "fence_not_quiesced";
  if (code === "idempotency_conflict") return "idempotency_conflict";
  if (code === "checkpoint_conflict" || code === "inventory_conflict" || code === "runtime_conflict") return "checkpoint_conflict";
  if (code === "raw_conflict") return "raw_conflict";
  if (code === "retention_expired") return "retention_expired";
  if (code === "full_reconciliation_required") return "full_reconciliation_required";
  if (code === "circuit_open") return "circuit_open";
  if (phase === "finalize") return "finalize_failed";
  return "store_failed";
}

async function mutation<T>(ports: ConnectorPorts, signal: AbortSignal, ms: number, phase: ConnectorPhase, attempt: number, invoke: (signal: AbortSignal) => Promise<StoreResult<T>>, parse: (value: unknown) => ValidationResult<T>): Promise<T> {
  let raw: unknown;
  try { raw = await bounded(ports, signal, ms, phase, attempt, invoke); }
  catch (error) {
    if (error instanceof RunFault && error.code === "cancelled") throw error;
    throw new RunFault("mutation_indeterminate", phase, attempt);
  }
  const result = parseStoreResult(raw, parse);
  if (!result.success) throw new RunFault("store_failed", phase, attempt);
  if (!result.data.success) throw new RunFault(storeCode(result.data.failure.code, phase), phase, attempt);
  return result.data.data;
}

async function storeRead<T>(ports: ConnectorPorts, signal: AbortSignal, ms: number, phase: ConnectorPhase, invoke: (signal: AbortSignal) => Promise<StoreResult<T>>, parse: (value: unknown) => ValidationResult<T>): Promise<T> {
  let raw: unknown;
  try { raw = await bounded(ports, signal, ms, phase, 0, invoke); }
  catch (error) { if (error instanceof RunFault) throw error; throw new RunFault("store_failed", phase, 0); }
  const result = parseStoreResult(raw, parse);
  if (!result.success) throw new RunFault("store_failed", phase, 0);
  if (!result.data.success) throw new RunFault(storeCode(result.data.failure.code, phase), phase, 0);
  return result.data.data;
}

async function requireMutationReceipt(ports: ConnectorPorts, signal: AbortSignal, checkpoint: RunningConnectorCheckpoint, operationKey: string, kind: "raw.staged" | "page.committed", timeoutMs: number): Promise<void> {
  const receipt = await storeRead(ports, signal, timeoutMs, kind === "raw.staged" ? "stage_raw" : "commit", (child) => ports.store.lookupMutation({ schemaVersion: 1, sourceId: checkpoint.sourceId, runId: checkpoint.runId, operationKey, leaseFence: checkpoint.leaseFence, expectedKind: kind, signal: child }), parseMutationReceiptOrNull);
  if (receipt === null || receipt.operationKey !== operationKey || receipt.kind !== kind || receipt.record.sourceId !== checkpoint.sourceId || receipt.record.runId !== checkpoint.runId) {
    throw new RunFault("checkpoint_conflict", kind === "raw.staged" ? "stage_raw" : "commit", 0);
  }
}

async function authority(ports: ConnectorPorts, request: ConnectorRunRequest, signal: AbortSignal, ms: number, attempt = 0): Promise<AuthorityCheckResult & { success: true }> {
  const asOf = timestamp(now(ports));
  let raw: unknown;
  try { raw = await bounded(ports, signal, ms, "authority", attempt, (child) => ports.authority.loadVerifiedCurrent({ sourceId: request.sourceId, asOf, signal: child })); }
  catch (error) { if (error instanceof RunFault) throw error; throw new RunFault("authority_untrusted", "authority", attempt); }
  const checked = verifyAuthorityHead(raw, request, asOf);
  if (!checked.success) throw new RunFault(checked.code, "authority", attempt);
  return checked;
}

function ensureSameAuthority(current: AuthorityCheckResult & { success: true }, pinned: RunningConnectorCheckpoint): void {
  if (current.head.authorityRevision !== pinned.authorityRevision || current.registryRevision !== pinned.registryRevision || current.head.authorizationBasisRef !== pinned.authorizationBasisRef) {
    throw new RunFault("policy_revision_changed", "authority", 0);
  }
}

async function recheckAuthority(ports: ConnectorPorts, checkpoint: RunningConnectorCheckpoint, signal: AbortSignal, timeoutMs: number): Promise<void> {
  try {
    const current = await authority(ports, checkpoint.request, signal, timeoutMs);
    ensureSameAuthority(current, checkpoint);
  } catch (error) {
    if (error instanceof RunFault && error.code === "policy_ineligible") {
      throw new RunFault("policy_revoked", "authority", error.attempt);
    }
    throw error;
  }
}

async function sleep(ports: ConnectorPorts, signal: AbortSignal, milliseconds: number, attempt: number): Promise<void> {
  if (milliseconds <= 0) return;
  if (signal.aborted) throw new RunFault("cancelled", "reserve", attempt);
  let scheduled: { cancel(): void } | undefined;
  let removeAbort: () => void = () => undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => { onAbort(); reject(new RunFault("cancelled", "reserve", attempt)); };
      const onAbort = () => scheduled?.cancel();
      signal.addEventListener("abort", abort, { once: true });
      removeAbort = () => signal.removeEventListener("abort", abort);
      scheduled = ports.scheduler.schedule(milliseconds, () => {
        signal.removeEventListener("abort", abort);
        resolve();
      });
    });
  } finally {
    removeAbort();
    try { scheduled?.cancel(); } catch { /* best effort */ }
  }
}

async function ensureLease(ports: ConnectorPorts, signal: AbortSignal, lease: LeaseContext, timeoutMs: number): Promise<void> {
  const currentMs = now(ports);
  if (currentMs < lease.renewAtMs && currentMs < lease.current.expiresAtMs) return;
  let raw: unknown;
  try { raw = await bounded(ports, signal, timeoutMs, "lease", 0, (child) => ports.lease.renew({ lease: lease.current, signal: child })); }
  catch { throw new RunFault("lease_lost", "lease", 0); }
  const parsed = parseSourceLease(raw);
  const renewedAt = now(ports);
  if (!parsed.success || parsed.data.leaseFence !== lease.current.leaseFence || parsed.data.leaseId !== lease.current.leaseId || parsed.data.expiresAtMs <= renewedAt) throw new RunFault("lease_lost", "lease", 0);
  lease.current = parsed.data;
  lease.renewAtMs = renewedAt + Math.floor((parsed.data.expiresAtMs - renewedAt) / 2);
}

async function waitUntil(ports: ConnectorPorts, signal: AbortSignal, targetMs: number, attempt: number, lease: LeaseContext, timeoutMs: number, deadlineAtMs: number): Promise<void> {
  while (now(ports) < targetMs) {
    const wakeAt = Math.min(targetMs, lease.renewAtMs, deadlineAtMs);
    await sleep(ports, signal, wakeAt - now(ports), attempt);
    if (now(ports) >= deadlineAtMs) throw new RunFault("deadline", "runtime", attempt);
    await ensureLease(ports, signal, lease, timeoutMs);
  }
}

function randomDelay(ports: ConnectorPorts, retryIndex: number, retryAfterMs?: number): number {
  let value: number;
  try { value = ports.random.next(); } catch { throw new RunFault("runtime_capability", "runtime", retryIndex + 1); }
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RunFault("runtime_capability", "runtime", retryIndex + 1);
  const ceiling = Math.min(30_000, 250 * 2 ** retryIndex);
  const jitter = Math.floor(value * (ceiling + 1));
  const retry = retryAfterMs === undefined ? 0 : retryAfterMs;
  if (!Number.isSafeInteger(retry) || retry < 0 || retry > 300_000) throw new RunFault("adapter_output_invalid", "acquire", retryIndex + 1);
  return Math.max(jitter, retry);
}

function errorResult(runId: ConnectorRunId | null, fault: RunFault, checkpointRevision: number | null): Exclude<ConnectorRunResult, { readonly status: "completed" }> {
  const status = fault.code === "cancelled" ? "cancelled" : "failed";
  const error: ConnectorError = Object.freeze({ code: fault.code, phase: fault.phase, retryable: fault.retryable, attempt: fault.attempt });
  return Object.freeze({ status, runId, error, checkpointRevision });
}

function emitMutation(ports: ConnectorPorts, input: { kind: ConnectorMutationKind; operationKey: string; sourceId: string; runId: ConnectorRunId; leaseFence: number; checkpointRevision?: number | null; runtimeRevision?: number | null; pageOrdinal?: number | null; itemCount?: number | null; byteCount?: number | null; outcome?: "success" | "failed" | "cancelled" | null; errorCode?: ConnectorErrorCode | null }): void {
  try {
    ports.telemetry.emit(Object.freeze({ schemaVersion: 1, kind: input.kind, operationKey: input.operationKey, sourceId: input.sourceId as ConnectorRunRequest["sourceId"], runId: input.runId, leaseFence: input.leaseFence, recordedAt: timestamp(now(ports)), checkpointRevision: input.checkpointRevision ?? null, runtimeRevision: input.runtimeRevision ?? null, pageOrdinal: input.pageOrdinal ?? null, itemCount: input.itemCount ?? null, byteCount: input.byteCount ?? null, outcome: input.outcome ?? "success", errorCode: input.errorCode ?? null }));
  } catch { /* telemetry is never authoritative */ }
}

async function finalize(ports: ConnectorPorts, signal: AbortSignal, checkpoint: RunningConnectorCheckpoint, effectMs: number, authorityRevision: number, lease: LeaseContext, deadlineAtMs: number): Promise<ConnectorRunResult> {
  const timeoutMs = effectBudget(ports, deadlineAtMs, effectMs, "finalize");
  await ensureLease(ports, signal, lease, timeoutMs);
  await recheckAuthority(ports, checkpoint, signal, effectBudget(ports, deadlineAtMs, effectMs, "authority"));
  const input = await buildFullFinalization(checkpoint, timestamp(now(ports)), authorityRevision, signal);
  const receipt = await mutation(ports, signal, timeoutMs, "finalize", 0, (child) => ports.store.finalizeFullRun({ ...input, signal: child }), parseFullRunReceipt);
  if (receipt.operationKey !== input.operationKey || receipt.finalizationKey !== input.finalizationKey || receipt.result.runId !== checkpoint.runId || receipt.result.pages !== checkpoint.committedPages || receipt.result.items !== checkpoint.committedItems || receipt.result.checkpointRevision !== receipt.checkpointRevision) throw new RunFault("checkpoint_conflict", "finalize", 0);
  emitMutation(ports, { kind: "full.finalized", operationKey: input.operationKey, sourceId: checkpoint.sourceId, runId: checkpoint.runId, leaseFence: checkpoint.leaseFence, checkpointRevision: receipt.checkpointRevision });
  return receipt.result;
}

async function executePages(ports: ConnectorPorts, signal: AbortSignal, initial: RunningConnectorCheckpoint, obligations: PolicyObligations, lease: LeaseContext, deadlineAtMs: number, onCheckpoint: (value: ConnectorCheckpoint) => void): Promise<ConnectorRunResult> {
  let checkpoint = initial;
  const operationTimeout = Math.min(checkpoint.request.limits.maxEffectMs, checkpoint.operations.timeoutMs);
  const timeout = (phase: ConnectorPhase, attempt = 0) => effectBudget(ports, deadlineAtMs, operationTimeout, phase, attempt);
  if (checkpoint.pendingRaw === null && checkpoint.lastPageCommitKey !== null) {
    await requireMutationReceipt(ports, signal, checkpoint, checkpoint.lastPageCommitKey, "page.committed", timeout("commit"));
  }
  while (true) {
    await ensureLease(ports, signal, lease, timeout("lease"));
    if (checkpoint.committedPages >= checkpoint.request.limits.maxPages) throw new RunFault("limit_exceeded", "acquire", 0);
    await recheckAuthority(ports, checkpoint, signal, timeout("authority"));

    let pending: PendingRawPage;
    let bytes: Uint8Array;
    if (checkpoint.pendingRaw !== null) {
      pending = checkpoint.pendingRaw;
      if (now(ports) >= Date.parse(pending.deadlines.rawRetainUntil)) {
        throw new RunFault("retention_expired", "stage_raw", 0);
      }
      await requireMutationReceipt(ports, signal, checkpoint, pending.operationKey, "raw.staged", timeout("stage_raw"));
      const staged = await storeRead(ports, signal, timeout("stage_raw"), "stage_raw", (child) => ports.store.loadStagedRaw({ schemaVersion: 1, sourceId: checkpoint.sourceId, runId: checkpoint.runId, snapshotId: pending.snapshotId, leaseFence: checkpoint.leaseFence, asOf: timestamp(now(ports)), signal: child }), parseStagedRawPage);
      if (staged.pending.operationKey !== pending.operationKey || staged.pending.sha256 !== pending.sha256 || staged.pending.snapshotId !== pending.snapshotId) throw new RunFault("raw_conflict", "stage_raw", 0);
      bytes = staged.bytes;
      if (await sha256Bytes(bytes) !== pending.sha256 || JSON.stringify(staged.obligations) !== JSON.stringify(checkpoint.obligations)) {
        throw new RunFault("raw_conflict", "stage_raw", 0);
      }
    } else {
      let acquired: { pageIdentity: string; bytes: Uint8Array; nextCursor: string | null; complete: boolean } | null = null;
      for (let attempt = 1; attempt <= checkpoint.operations.maxRetries + 1; attempt += 1) {
        await recheckAuthority(ports, checkpoint, signal, timeout("authority", attempt));
        const reservationKey = await deriveAttemptReservationKey(checkpoint.runId, checkpoint.leaseFence, checkpoint.nextPageOrdinal, attempt);
        const reservation = await mutation(ports, signal, timeout("reserve", attempt), "reserve", attempt, (child) => ports.store.reserveAttempt({ schemaVersion: 1, sourceId: checkpoint.sourceId, runId: checkpoint.runId, operationKey: reservationKey, leaseFence: checkpoint.leaseFence, signal: child, pageOrdinal: checkpoint.nextPageOrdinal, attempt, nowMs: now(ports), requestIntervalMs: Math.ceil(60_000 / checkpoint.operations.requestsPerMinute), circuitOpenMs: 60_000, transientFailureThreshold: 5, probeTtlMs: checkpoint.operations.timeoutMs }), parseAttemptReservationReceipt);
        if (reservation.reservationKey !== reservationKey || reservation.runtimeRevision < 1) throw new RunFault("checkpoint_conflict", "reserve", attempt);
        emitMutation(ports, { kind: "attempt.reserved", operationKey: reservationKey, sourceId: checkpoint.sourceId, runId: checkpoint.runId, leaseFence: checkpoint.leaseFence, runtimeRevision: reservation.runtimeRevision, pageOrdinal: checkpoint.nextPageOrdinal });
        await waitUntil(ports, signal, reservation.notBeforeMs, attempt, lease, operationTimeout, deadlineAtMs);
        await ensureLease(ports, signal, lease, timeout("lease", attempt));
        await recheckAuthority(ports, checkpoint, signal, timeout("authority", attempt));
        let fetchRaw: unknown;
        try { fetchRaw = await bounded(ports, signal, timeout("acquire", attempt), "acquire", attempt, (child) => ports.adapter.fetchPage({ sourceId: checkpoint.sourceId, runId: checkpoint.runId, pageOrdinal: checkpoint.nextPageOrdinal, cursor: checkpoint.nextCursor, mode: checkpoint.request.mode, maxResponseBytes: checkpoint.request.limits.maxPageBytes, attempt, signal: child })); }
        catch (error) { if (error instanceof RunFault) throw error; throw new RunFault("acquisition_failed", "acquire", attempt); }
        const fetch = parseAdapterFetchResult(fetchRaw);
        if (!fetch.success) throw new RunFault("adapter_output_invalid", "acquire", attempt);
        const outcome: AttemptOutcome = fetch.data.success ? { kind: "success" } : { kind: fetch.data.failure.kind };
        const completionKey = await deriveAttemptCompletionKey(checkpoint.runId, reservation.reservationKey);
        const completion = await mutation(ports, signal, timeout("reserve", attempt), "reserve", attempt, (child) => ports.store.completeAttempt({ schemaVersion: 1, sourceId: checkpoint.sourceId, runId: checkpoint.runId, operationKey: completionKey, leaseFence: checkpoint.leaseFence, signal: child, reservationKey: reservation.reservationKey, expectedRuntimeRevision: reservation.runtimeRevision, outcome, completedAtMs: now(ports) }), parseAttemptCompletionReceipt);
        if (completion.operationKey !== completionKey || completion.reservationKey !== reservation.reservationKey || completion.runtime.sourceId !== checkpoint.sourceId) throw new RunFault("checkpoint_conflict", "reserve", attempt);
        emitMutation(ports, { kind: "attempt.completed", operationKey: completionKey, sourceId: checkpoint.sourceId, runId: checkpoint.runId, leaseFence: checkpoint.leaseFence, runtimeRevision: completion.runtime.revision, pageOrdinal: checkpoint.nextPageOrdinal, outcome: outcome.kind === "success" ? "success" : "failed" });
        if (fetch.data.success) { acquired = fetch.data.page; break; }
        const failure: AdapterFailure = fetch.data.failure;
        if (failure.kind === "terminal" || attempt > checkpoint.operations.maxRetries) throw new RunFault(failure.kind === "rate_limited" ? "rate_limited" : "acquisition_failed", "acquire", attempt);
        await waitUntil(ports, signal, now(ports) + randomDelay(ports, attempt - 1, failure.retryAfterMs), attempt, lease, operationTimeout, deadlineAtMs);
      }
      if (acquired === null) throw new RunFault("acquisition_failed", "acquire", checkpoint.operations.maxRetries + 1);
      if (acquired.bytes.byteLength > checkpoint.request.limits.maxPageBytes) throw new RunFault("payload_too_large", "acquire", 0);
      const captureMs = now(ports);
      const capturedAt = timestamp(captureMs);
      const pageKey = await derivePageKey(checkpoint.runId, checkpoint.nextPageOrdinal, acquired.pageIdentity);
      const snapshotId = await deriveRawSnapshotId(checkpoint.sourceId, pageKey);
      const sha256 = await sha256Bytes(acquired.bytes);
      const deadlines = deriveRetentionDeadlines(capturedAt, obligations);
      const stageKey = await deriveStageOperationKey(checkpoint.runId, snapshotId);
      pending = Object.freeze({ operationKey: stageKey, pageOrdinal: checkpoint.nextPageOrdinal, pageIdentity: acquired.pageIdentity, snapshotId, sha256, byteLength: acquired.bytes.byteLength, capturedAt, nextCursor: acquired.nextCursor, complete: acquired.complete, deadlines });
      await recheckAuthority(ports, checkpoint, signal, timeout("authority"));
      await ensureLease(ports, signal, lease, timeout("lease"));
      const staged = await mutation(ports, signal, timeout("stage_raw"), "stage_raw", 0, (child) => ports.store.stageRaw({ schemaVersion: 1, sourceId: checkpoint.sourceId, runId: checkpoint.runId, operationKey: stageKey, leaseFence: checkpoint.leaseFence, signal: child, checkpointRevision: checkpoint.checkpointRevision, pageOrdinal: pending.pageOrdinal, pageIdentity: pending.pageIdentity, snapshotId, sha256, bytes: acquired!.bytes.slice(), capturedAt, nextCursor: pending.nextCursor, complete: pending.complete, obligations, deadlines }), parseStageRawReceipt);
      if (staged.operationKey !== stageKey || staged.snapshotId !== snapshotId || staged.sha256 !== sha256 || staged.byteLength !== pending.byteLength || staged.checkpointRevision !== checkpoint.checkpointRevision + 1) throw new RunFault("raw_conflict", "stage_raw", 0);
      emitMutation(ports, { kind: "raw.staged", operationKey: stageKey, sourceId: checkpoint.sourceId, runId: checkpoint.runId, leaseFence: checkpoint.leaseFence, checkpointRevision: staged.checkpointRevision, pageOrdinal: pending.pageOrdinal, byteCount: pending.byteLength });
      checkpoint = Object.freeze({ ...checkpoint, checkpointRevision: staged.checkpointRevision, pendingRaw: pending });
      onCheckpoint(checkpoint);
      bytes = acquired.bytes.slice();
    }

    await recheckAuthority(ports, checkpoint, signal, timeout("authority"));
    const decoded = decodeJsonPage(bytes, { maxBytes: checkpoint.request.limits.maxPageBytes, maxDepth: checkpoint.request.limits.maxJsonDepth, maxMembers: checkpoint.request.limits.maxJsonMembers });
    if (!decoded.success) throw new RunFault(decoded.issues[0]?.code ?? "invalid_json", "decode", 0);
    let mappedRaw: unknown;
    try { mappedRaw = await bounded(ports, signal, timeout("map"), "map", 0, (child) => ports.adapter.mapPage({ sourceId: checkpoint.sourceId, runId: checkpoint.runId, territory: checkpoint.request.territory, acquisitionMethod: checkpoint.request.acquisitionMethod, fields: checkpoint.request.fields, raw: { snapshotId: pending.snapshotId, connectorRunId: checkpoint.runId, sha256: pending.sha256 }, decoded: decoded.data, signal: child })); }
    catch (error) { if (error instanceof RunFault) throw error; throw new RunFault("adapter_output_invalid", "map", 0); }
    const mapped = parseMappedPageDraft(mappedRaw);
    if (!mapped.success) throw new RunFault("adapter_output_invalid", "map", 0);
    if (checkpoint.committedItems + mapped.data.items.length > checkpoint.request.limits.maxItems) throw new RunFault("limit_exceeded", "commit", 0);
    if (!pending.complete && (pending.nextCursor === null || checkpoint.visitedCursors.includes(pending.nextCursor))) throw new RunFault("cursor_cycle", "commit", 0);
    const effects = await buildCanonicalPageEffects({ request: checkpoint.request, checkpoint, pending, draft: mapped.data });
    if (!effects.success) throw new RunFault("adapter_output_invalid", "map", 0);
    const pageKey = await derivePageKey(checkpoint.runId, pending.pageOrdinal, pending.pageIdentity);
    const commitKey = await derivePageCommitKey(pageKey, pending.sha256, checkpoint.request.mapperVersion);
    await recheckAuthority(ports, checkpoint, signal, timeout("authority"));
    await ensureLease(ports, signal, lease, timeout("lease"));
    const receipt = await mutation(ports, signal, timeout("commit"), "commit", 0, (child) => ports.store.commitPage({ schemaVersion: 1, sourceId: checkpoint.sourceId, runId: checkpoint.runId, operationKey: commitKey, leaseFence: checkpoint.leaseFence, signal: child, expectedCheckpointRevision: checkpoint.checkpointRevision, expectedInventoryGenerationId: checkpoint.expectedInventoryGenerationId, expectedInventoryRevision: checkpoint.expectedInventoryRevision, pending, effects: effects.data, nextPageOrdinal: pending.pageOrdinal + 1, nextCursor: pending.nextCursor, pageItemCount: mapped.data.items.length, complete: pending.complete, authorityRevision: checkpoint.authorityRevision, committedAt: timestamp(now(ports)) }), parsePageCommitReceipt);
    if (receipt.operationKey !== commitKey || receipt.checkpoint.sourceId !== checkpoint.sourceId || receipt.checkpoint.runId !== checkpoint.runId || receipt.complete !== pending.complete) throw new RunFault("checkpoint_conflict", "commit", 0);
    emitMutation(ports, { kind: "page.committed", operationKey: commitKey, sourceId: checkpoint.sourceId, runId: checkpoint.runId, leaseFence: checkpoint.leaseFence, checkpointRevision: receipt.checkpointRevision, pageOrdinal: pending.pageOrdinal, itemCount: mapped.data.items.length, byteCount: pending.byteLength });
    onCheckpoint(receipt.checkpoint);
    if (receipt.checkpoint.status === "completed") return receipt.checkpoint.result;
    checkpoint = receipt.checkpoint;
    if (pending.complete) return finalize(ports, signal, checkpoint, operationTimeout, checkpoint.authorityRevision, lease, deadlineAtMs);
  }
}

export async function runConnector(requestInput: ConnectorRunRequest, ports: ConnectorPorts, externalSignal?: AbortSignal): Promise<ConnectorRunResult> {
  let runId: ConnectorRunId | null = null;
  let lease: SourceLease | null = null;
  let leaseContext: LeaseContext | null = null;
  let checkpoint: ConnectorCheckpoint | null = null;
  const signal = externalSignal ?? new AbortController().signal;
  try {
    assertPorts(ports);
    assertNativeCapabilities();
    if (!(signal instanceof AbortSignal)) throw new RunFault("runtime_capability", "runtime", 0);
    const parsed = parseConnectorRunRequest(requestInput);
    if (!parsed.success) throw new RunFault("invalid_request", "runtime", 0);
    const request = parsed.data;
    const startedMs = now(ports);
    let deadlineAtMs = startedMs + parsed.data.limits.maxRunMs;
    if (!Number.isSafeInteger(deadlineAtMs)) throw new RunFault("invalid_request", "runtime", 0);
    runId = await deriveRunId(request.sourceId, request.invocationKey);
    const checked = await authority(ports, request, signal, effectBudget(ports, deadlineAtMs, request.limits.maxEffectMs, "authority"));
    const requestSha256 = await digestConnectorRequest(request);
    const configurationSha256 = await digestSourceConfiguration(checked.configuration);
    const scope = Object.freeze({ scopeId: await deriveScopeId(request.sourceId, request.territory, request.acquisitionMethod), sourceId: request.sourceId, territory: request.territory, acquisitionMethod: request.acquisitionMethod });
    const ttlMs = Math.max(30_000, 2 * checked.operations.timeoutMs + 5_000);
    let rawLease: unknown;
    try { rawLease = await bounded(ports, signal, effectBudget(ports, deadlineAtMs, request.limits.maxEffectMs, "lease"), "lease", 0, (child) => ports.lease.acquire({ sourceId: request.sourceId, runId: runId!, ttlMs, signal: child })); }
    catch (error) { if (error instanceof RunFault) throw error; throw new RunFault("lease_unavailable", "lease", 0); }
    const parsedLease = parseSourceLease(rawLease);
    if (!parsedLease.success || parsedLease.data.expiresAtMs <= now(ports)) throw new RunFault("lease_unavailable", "lease", 0);
    lease = parsedLease.data;
    leaseContext = { current: lease, renewAtMs: startedMs + Math.floor((lease.expiresAtMs - startedMs) / 2) };
    const openKey = await deriveOpenOperationKey(runId, lease.leaseFence);
    const opened = await mutation(ports, signal, effectBudget(ports, deadlineAtMs, request.limits.maxEffectMs, "open"), "open", 0, (child) => ports.store.openRun({ schemaVersion: 1, sourceId: request.sourceId, runId: runId!, operationKey: openKey, leaseFence: lease!.leaseFence, signal: child, request, requestSha256, openedAt: timestamp(startedMs), authority: checked.head, registryRevision: checked.registryRevision, configurationSha256, obligations: checked.obligations, operations: checked.operations, scope }), parseOpenRunResult);
    if (opened.checkpoint.sourceId !== request.sourceId || opened.checkpoint.runId !== runId || opened.checkpoint.requestSha256 !== requestSha256 || opened.checkpoint.configurationSha256 !== configurationSha256 || (opened.status !== "completed" && opened.checkpoint.leaseFence !== lease.leaseFence)) {
      throw new RunFault("checkpoint_conflict", "open", 0);
    }
    emitMutation(ports, { kind: "run.opened", operationKey: openKey, sourceId: request.sourceId, runId, leaseFence: lease.leaseFence, checkpointRevision: opened.checkpoint.checkpointRevision });
    checkpoint = opened.checkpoint;
    if (opened.status === "completed") return opened.result;
    deadlineAtMs = Date.parse(opened.checkpoint.startedAt) + request.limits.maxRunMs;
    if (!Number.isSafeInteger(deadlineAtMs) || now(ports) >= deadlineAtMs) throw new RunFault("deadline", "runtime", 0);
    if (opened.checkpoint.finalPageCommitKey !== null) {
      await requireMutationReceipt(ports, signal, opened.checkpoint, opened.checkpoint.finalPageCommitKey, "page.committed", effectBudget(ports, deadlineAtMs, request.limits.maxEffectMs, "commit"));
      return await finalize(ports, signal, opened.checkpoint, request.limits.maxEffectMs, opened.checkpoint.authorityRevision, leaseContext, deadlineAtMs);
    }
    return await executePages(ports, signal, opened.checkpoint, checked.obligations, leaseContext, deadlineAtMs, (value) => { checkpoint = value; });
  } catch (unknownError) {
    const fault = unknownError instanceof RunFault ? unknownError : new RunFault("runtime_capability", "runtime", 0);
    const result = errorResult(runId, fault, checkpoint?.checkpointRevision ?? null);
    if (runId !== null && lease !== null) {
      try {
        const operationKey = await deriveTerminalOperationKey(runId, lease.leaseFence, checkpoint?.checkpointRevision ?? null, result.status, result.error.code);
        const terminalSignal = new AbortController().signal;
        const terminal = await mutation(ports, terminalSignal, checkpoint && checkpoint.status === "running" ? checkpoint.request.limits.maxEffectMs : 1_000, "runtime", fault.attempt, (child) => ports.store.recordRunTerminal({ schemaVersion: 1, sourceId: checkpoint?.sourceId ?? requestInput.sourceId, runId: runId!, operationKey, leaseFence: lease!.leaseFence, signal: child, expectedCheckpointRevision: checkpoint?.checkpointRevision ?? null, terminalAt: timestamp(now(ports)), result }), parseRunTerminalReceipt);
        emitMutation(ports, { kind: "run.terminal", operationKey, sourceId: checkpoint?.sourceId ?? requestInput.sourceId, runId, leaseFence: lease.leaseFence, checkpointRevision: terminal.checkpointRevision, outcome: result.status, errorCode: result.error.code });
      } catch { /* best effort terminal record */ }
    }
    return result;
  } finally {
    if (leaseContext !== null) {
      try { await bounded(ports, new AbortController().signal, 1_000, "lease", 0, (child) => ports.lease.release({ lease: leaseContext!.current, signal: child })); } catch { /* never assume release */ }
    }
  }
}
