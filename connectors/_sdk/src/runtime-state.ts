import type {
  AttemptCompletionReceipt, AttemptOutcome, AttemptReservation, CompleteAttemptRequest,
  ReserveAttemptRequest, SourceCircuitState, SourceRuntimeReduction, SourceRuntimeState,
} from "./types.js";

type DataRecord = Readonly<Record<string, unknown>>;
const CIRCUIT_KEYS = ["state", "consecutiveTransientFailures", "openedAtMs", "probeOwnerFence", "probeExpiresAtMs"] as const;
const STATE_KEYS = ["schemaVersion", "sourceId", "revision", "nextRequestAtMs", "circuit"] as const;

function failure<T>(code: "circuit_open" | "stale_fence" | "runtime_conflict" | "invalid_state"): SourceRuntimeReduction<T> {
  return Object.freeze({ success: false, failure: Object.freeze({ code }) });
}

function inspectRecord(input: unknown, expectedKeys: readonly string[]): DataRecord | null {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Object.prototype || Object.getOwnPropertySymbols(input).length !== 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Object.keys(descriptors);
    if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !(key in descriptors))) return null;
    const output: Record<string, unknown> = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch { return null; }
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
}

function identifier(value: unknown, prefix: string, maximumTailLength: number): value is string {
  if (typeof value !== "string" || !value.startsWith(prefix)) return false;
  const tail = value.slice(prefix.length);
  return tail.length >= 1 && tail.length <= maximumTailLength && !/[^A-Za-z0-9_-]/u.test(tail);
}

function key(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.length === prefix.length + 64 && value.startsWith(prefix) && !/[^0-9a-f]/u.test(value.slice(prefix.length));
}

function parseCircuit(input: unknown): SourceCircuitState | null {
  const value = inspectRecord(input, CIRCUIT_KEYS);
  if (value === null || (value.state !== "closed" && value.state !== "open" && value.state !== "half_open") ||
      !integer(value.consecutiveTransientFailures, 0, 5)) return null;
  for (const part of [value.openedAtMs, value.probeOwnerFence, value.probeExpiresAtMs]) {
    if (part !== null && !integer(part, 0, Number.MAX_SAFE_INTEGER)) return null;
  }
  const shapeValid = value.state === "closed"
    ? value.openedAtMs === null && value.probeOwnerFence === null && value.probeExpiresAtMs === null
    : value.state === "open"
      ? value.openedAtMs !== null && value.probeOwnerFence === null && value.probeExpiresAtMs === null
      : value.openedAtMs !== null && value.probeOwnerFence !== null && value.probeExpiresAtMs !== null;
  if (!shapeValid) return null;
  return Object.freeze({ ...value }) as unknown as SourceCircuitState;
}

function parseState(input: unknown): SourceRuntimeState | null {
  const value = inspectRecord(input, STATE_KEYS);
  if (value === null || value.schemaVersion !== 1 || !identifier(value.sourceId, "src_", 64) ||
      !integer(value.revision, 0, Number.MAX_SAFE_INTEGER - 1) || !integer(value.nextRequestAtMs, 0, Number.MAX_SAFE_INTEGER)) return null;
  const circuit = parseCircuit(value.circuit);
  if (circuit === null) return null;
  return Object.freeze({ schemaVersion: 1, sourceId: value.sourceId, revision: value.revision, nextRequestAtMs: value.nextRequestAtMs, circuit }) as SourceRuntimeState;
}

function parseOutcome(input: unknown): AttemptOutcome | null {
  const value = inspectRecord(input, ["kind"]);
  if (value === null || (value.kind !== "success" && value.kind !== "rate_limited" && value.kind !== "transient" && value.kind !== "terminal")) return null;
  return Object.freeze({ kind: value.kind });
}

function advance(state: SourceRuntimeState, nextRequestAtMs: number, circuit: SourceCircuitState): SourceRuntimeState {
  return Object.freeze({ schemaVersion: 1, sourceId: state.sourceId, revision: state.revision + 1, nextRequestAtMs, circuit: Object.freeze({ ...circuit }) });
}

export function reduceAttemptReservation(stateInput: SourceRuntimeState, requestInput: ReserveAttemptRequest): SourceRuntimeReduction<AttemptReservation> {
  const state = parseState(stateInput);
  const request = inspectRecord(requestInput, ["schemaVersion", "sourceId", "runId", "operationKey", "leaseFence", "signal", "pageOrdinal", "attempt", "nowMs", "requestIntervalMs", "circuitOpenMs", "transientFailureThreshold", "probeTtlMs"]);
  if (state === null || request === null || request.schemaVersion !== 1 || request.sourceId !== state.sourceId ||
      !identifier(request.runId, "run_", 128) || !key(request.operationKey, "reserve_") ||
      !integer(request.leaseFence, 1, Number.MAX_SAFE_INTEGER) || !integer(request.pageOrdinal, 0, 999) ||
      !integer(request.attempt, 1, 21) || !integer(request.nowMs, 0, Number.MAX_SAFE_INTEGER) ||
      !integer(request.requestIntervalMs, 1, 60_000) || request.circuitOpenMs !== 60_000 ||
      request.transientFailureThreshold !== 5 || !integer(request.probeTtlMs, 1, 300_000)) return failure("invalid_state");

  const notBeforeMs = Math.max(request.nowMs, state.nextRequestAtMs);
  const nextRequestAtMs = notBeforeMs + request.requestIntervalMs;
  const probeExpiresAtMs = notBeforeMs + request.probeTtlMs;
  if (!Number.isSafeInteger(nextRequestAtMs) || !Number.isSafeInteger(probeExpiresAtMs)) return failure("invalid_state");

  let circuit = state.circuit;
  let ownsHalfOpenProbe = false;
  if (circuit.state === "open") {
    if (circuit.openedAtMs === null || request.nowMs < circuit.openedAtMs + request.circuitOpenMs) return failure("circuit_open");
    circuit = { state: "half_open", consecutiveTransientFailures: circuit.consecutiveTransientFailures, openedAtMs: circuit.openedAtMs, probeOwnerFence: request.leaseFence, probeExpiresAtMs };
    ownsHalfOpenProbe = true;
  } else if (circuit.state === "half_open") {
    if (circuit.probeExpiresAtMs === null) return failure("invalid_state");
    if (circuit.probeOwnerFence === request.leaseFence && request.nowMs < circuit.probeExpiresAtMs) ownsHalfOpenProbe = true;
    else if (request.nowMs >= circuit.probeExpiresAtMs) {
      circuit = { state: "half_open", consecutiveTransientFailures: circuit.consecutiveTransientFailures, openedAtMs: circuit.openedAtMs, probeOwnerFence: request.leaseFence, probeExpiresAtMs };
      ownsHalfOpenProbe = true;
    } else return failure("circuit_open");
  }

  const updated = advance(state, nextRequestAtMs, circuit);
  const reservation = Object.freeze({ reservationKey: request.operationKey as string, runtimeRevision: updated.revision, notBeforeMs, nextRequestAtMs, ownsHalfOpenProbe });
  return Object.freeze({ success: true, data: reservation, nextState: updated });
}

export function reduceAttemptCompletion(stateInput: SourceRuntimeState, reservationInput: AttemptReservation, requestInput: CompleteAttemptRequest): SourceRuntimeReduction<AttemptCompletionReceipt> {
  const state = parseState(stateInput);
  const reservation = inspectRecord(reservationInput, ["reservationKey", "runtimeRevision", "notBeforeMs", "nextRequestAtMs", "ownsHalfOpenProbe"]);
  const request = inspectRecord(requestInput, ["schemaVersion", "sourceId", "runId", "operationKey", "leaseFence", "signal", "reservationKey", "expectedRuntimeRevision", "outcome", "completedAtMs"]);
  const outcome = request === null ? null : parseOutcome(request.outcome);
  if (state === null || reservation === null || request === null || outcome === null || request.schemaVersion !== 1 || request.sourceId !== state.sourceId ||
      !identifier(request.runId, "run_", 128) || !key(request.operationKey, "attempt_") || !key(reservation.reservationKey, "reserve_") ||
      request.reservationKey !== reservation.reservationKey || request.expectedRuntimeRevision !== state.revision || reservation.runtimeRevision !== state.revision ||
      reservation.nextRequestAtMs !== state.nextRequestAtMs || !integer(reservation.notBeforeMs, 0, Number.MAX_SAFE_INTEGER) || typeof reservation.ownsHalfOpenProbe !== "boolean" ||
      !integer(request.leaseFence, 1, Number.MAX_SAFE_INTEGER) || !integer(request.completedAtMs, 0, Number.MAX_SAFE_INTEGER)) return failure("runtime_conflict");

  if (state.circuit.state === "half_open") {
    if (reservation.ownsHalfOpenProbe !== true || state.circuit.probeOwnerFence !== request.leaseFence || state.circuit.probeExpiresAtMs === null || request.completedAtMs >= state.circuit.probeExpiresAtMs) return failure("stale_fence");
  } else if (reservation.ownsHalfOpenProbe) return failure("runtime_conflict");

  let circuit = state.circuit;
  if (outcome.kind === "success") circuit = { state: "closed", consecutiveTransientFailures: 0, openedAtMs: null, probeOwnerFence: null, probeExpiresAtMs: null };
  else if (state.circuit.state === "half_open") circuit = { state: "open", consecutiveTransientFailures: outcome.kind === "transient" ? Math.min(5, circuit.consecutiveTransientFailures + 1) : circuit.consecutiveTransientFailures, openedAtMs: request.completedAtMs, probeOwnerFence: null, probeExpiresAtMs: null };
  else if (outcome.kind === "transient") {
    const failures = Math.min(5, circuit.consecutiveTransientFailures + 1);
    circuit = failures >= 5 ? { state: "open", consecutiveTransientFailures: failures, openedAtMs: request.completedAtMs, probeOwnerFence: null, probeExpiresAtMs: null } : { ...circuit, consecutiveTransientFailures: failures };
  }

  const updated = advance(state, state.nextRequestAtMs, circuit);
  const receipt = Object.freeze({ operationKey: request.operationKey as string, reservationKey: request.reservationKey as string, runtime: updated });
  return Object.freeze({ success: true, data: receipt, nextState: updated });
}
