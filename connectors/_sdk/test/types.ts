import type {
  ConnectorRunRequest,
  ConnectorRunResult,
  InferredMissingTombstone,
  MappedItemDraft,
  ObservationDraft,
  OpenRunRequest,
  SourceRuntimeState,
  StoreResult,
} from "../src/index.js";
import type { ConnectorRunId, RawSnapshotId, SourceId } from "@auto-world/vehicle-schema";
import { parseConnectorRunRequest } from "../src/index.js";

declare const request: ConnectorRunRequest;
declare const opened: OpenRunRequest;
declare const missing: InferredMissingTombstone;
declare const runtime: SourceRuntimeState;
declare const rawId: RawSnapshotId;
declare const result: ConnectorRunResult;

// @ts-expect-error run fields are immutable
request.fields.push("seller_pii");
// @ts-expect-error nested limits are immutable
request.limits.maxItems = 999999;
// @ts-expect-error this SDK cannot request public redistribution
const consumer: ConnectorRunRequest = { ...request, audience: "consumer" };
// @ts-expect-error input cannot override the authoritative inventory read
const forgedInventory: OpenRunRequest = { ...opened, currentInventory: {} };
// @ts-expect-error a raw snapshot cannot be used as a connector run
const crossedRun: ConnectorRunId = rawId;
// @ts-expect-error source-ended items cannot carry fabricated active observations
const ended: MappedItemDraft = { sourceListingId: "synthetic", outcome: "deleted", observations: [] };
// @ts-expect-error a mapper cannot assign canonical provenance time
const forgedTime: ObservationDraft = { field: "price", value: { amountMinor: 100, currency: "EUR" }, confidenceBps: 10000, observedAt: "2026-09-06T12:00:00.000Z" };
// @ts-expect-error inferred absence has completed-run evidence, never a final-page raw reference
const raw = missing.raw;
// @ts-expect-error runtime reducer snapshots are immutable
runtime.circuit.state = "closed";
// @ts-expect-error unacknowledged mutation outcomes cannot masquerade as StoreResult success
const unacknowledged: StoreResult<null> = { acknowledged: false, success: true, data: null };

const parsed = parseConnectorRunRequest({});
if (parsed.success) {
  const source: SourceId = parsed.data.sourceId;
  void source;
}
if (result.status === "completed") {
  const run: ConnectorRunId = result.runId;
  void run;
} else {
  const maybeRun: ConnectorRunId | null = result.runId;
  void maybeRun;
}

void consumer;
void forgedInventory;
void crossedRun;
void ended;
void forgedTime;
void raw;
void unacknowledged;
