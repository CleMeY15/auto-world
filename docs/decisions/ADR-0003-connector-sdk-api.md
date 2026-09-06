# ADR-0003 appendix — Connector SDK V1 public contract

Status: Accepted contract, 2026-09-06. Independent architecture readiness CLEAR; frozen before SDK implementation. Real source activation remains out of scope. Read with [ADR-0003](ADR-0003-connector-sdk-contract.md).

## Contract choices

- The SDK exposes one lifecycle entry point, `runConnector`; parsers for request, adapter output, JSON and port receipts remain public where runtime boundaries require them.
- Every awaited port input carries a child `AbortSignal`. Clock, scheduler, random and telemetry are synchronous by design.
- Store calls return an acknowledged `StoreResult<T>`. A rejected/thrown/timed-out mutation is indeterminate; it never means acknowledged absence or permits automatic resend. Rejected/timed-out reads terminate without mutation (store_failed/deadline), never invent absent data.
- Every store mutation carries `schemaVersion`, `sourceId`, `runId`, `operationKey`, `leaseFence` and `signal`. Attempt completion also carries the exact reservation key and runtime revision.
- `ListingVersionEvidence` is append-only evidence. `ListingProjection` is the separately mutable CAS head. Explicit and inferred tombstones are distinct unions so inferred absence cannot pretend to have raw-page provenance.
- Connector `PolicyObligations` pins the one contextual internal grant plus authorization/retention/access obligations. It is deliberately narrower than the complete registry policy, but sufficient to enforce the exact approved request.
- All DTO properties and arrays are readonly. Bytes returned by a storage implementation must be defensive copies; structural immutability of `Uint8Array` cannot be expressed by TypeScript alone.

## Public declarations

```ts
import type {
  AcquisitionMethod,
  ConnectorRunId,
  Currency,
  LegalStatus,
  Listing,
  ListingId,
  MileageUnit,
  Observation,
  ObservationId,
  PowerUnit,
  RawReference,
  RawSnapshotId,
  SourceId,
  ValidationResult,
} from "@auto-world/vehicle-schema";
import type {
  Audience,
  CachingPolicy,
  CircuitState,
  MediaPolicy,
  PiiPolicy,
  RetentionPolicy,
  SourceField,
  SourceGrant,
  SourceRegistry,
  SourceOperations,
  TakedownPolicy,
  Territory,
} from "@auto-world/source-registry";

declare const listingVersionIdBrand: unique symbol;
declare const lifecycleTombstoneIdBrand: unique symbol;
declare const inventoryGenerationIdBrand: unique symbol;
declare const connectorScopeIdBrand: unique symbol;

export type ListingVersionId = string & {
  readonly [listingVersionIdBrand]: true;
};
export type LifecycleTombstoneId = string & {
  readonly [lifecycleTombstoneIdBrand]: true;
};
export type InventoryGenerationId = string & {
  readonly [inventoryGenerationIdBrand]: true;
};
export type ConnectorScopeId = string & {
  readonly [connectorScopeIdBrand]: true;
};

export type ConnectorMode = "incremental" | "full";
export type ListingOutcome = "active" | "withdrawn" | "deleted";
export type OperationKey = string;
export type Sha256Digest = string;
export type ExactUtcTimestamp = string;

export interface ConnectorRunLimits {
  readonly maxPages: number;
  readonly maxItems: number;
  readonly maxRunMs: number;
  readonly maxEffectMs: number;
  readonly maxPageBytes: number;
  readonly maxJsonDepth: number;
  readonly maxJsonMembers: number;
}

export interface ConnectorRunRequest {
  readonly schemaVersion: 1;
  readonly sourceId: SourceId;
  readonly territory: Territory;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly audience: "internal";
  readonly fields: readonly SourceField[];
  readonly mode: ConnectorMode;
  readonly invocationKey: string;
  readonly adapterVersion: string;
  readonly mapperVersion: string;
  readonly limits: ConnectorRunLimits;
}

export type ConnectorPhase =
  | "authority"
  | "lease"
  | "open"
  | "reserve"
  | "acquire"
  | "stage_raw"
  | "decode"
  | "map"
  | "commit"
  | "finalize"
  | "runtime";

export type ConnectorErrorCode =
  | "invalid_request"
  | "runtime_capability"
  | "cancelled"
  | "deadline"
  | "authority_untrusted"
  | "authority_regression"
  | "policy_revision_changed"
  | "policy_ineligible"
  | "policy_revoked"
  | "full_reconciliation_required"
  | "lease_unavailable"
  | "lease_lost"
  | "fence_not_quiesced"
  | "circuit_open"
  | "rate_limited"
  | "acquisition_failed"
  | "payload_too_large"
  | "invalid_utf8"
  | "invalid_json"
  | "json_too_deep"
  | "json_too_large"
  | "duplicate_member"
  | "adapter_output_invalid"
  | "idempotency_conflict"
  | "checkpoint_conflict"
  | "mutation_indeterminate"
  | "raw_conflict"
  | "cursor_cycle"
  | "limit_exceeded"
  | "retention_expired"
  | "store_failed"
  | "finalize_failed";

export interface ConnectorError {
  readonly code: ConnectorErrorCode;
  readonly phase: ConnectorPhase;
  readonly retryable: boolean;
  readonly attempt: number;
}

export type ConnectorRunResult =
  | {
      readonly status: "completed";
      readonly runId: ConnectorRunId;
      readonly pages: number;
      readonly items: number;
      readonly checkpointRevision: number;
    }
  | {
      readonly status: "failed" | "cancelled";
      readonly runId: ConnectorRunId | null;
      readonly error: ConnectorError;
      readonly checkpointRevision: number | null;
    };

export function runConnector(
  request: ConnectorRunRequest,
  ports: ConnectorPorts,
  signal?: AbortSignal,
): Promise<ConnectorRunResult>;

export function parseConnectorRunRequest(
  input: unknown,
): ValidationResult<ConnectorRunRequest>;

export interface ConnectorPorts {
  readonly authority: AuthoritativeRegistryPort;
  readonly lease: ConnectorLeasePort;
  readonly store: ConnectorStorePort;
  readonly adapter: ConnectorAdapterPort;
  readonly clock: ClockPort;
  readonly scheduler: SchedulerPort;
  readonly random: RandomPort;
  readonly telemetry: TelemetryPort;
}

export interface LoadVerifiedCurrentRequest {
  readonly sourceId: SourceId;
  readonly asOf: ExactUtcTimestamp;
  readonly signal: AbortSignal;
}

export interface VerifiedSourceHead {
  readonly trust: "authenticated_current";
  readonly registry: SourceRegistry;
  readonly authorityRevision: number;
  readonly verifiedAsOf: ExactUtcTimestamp;
  readonly authorizationBasisRef: string;
}

export interface AuthoritativeRegistryPort {
  loadVerifiedCurrent(
    input: LoadVerifiedCurrentRequest,
  ): Promise<VerifiedSourceHead>;
}

export interface SourceLease {
  readonly leaseId: string;
  readonly leaseFence: number;
  readonly expiresAtMs: number;
}

export interface AcquireLeaseRequest {
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly ttlMs: number;
  readonly signal: AbortSignal;
}

export interface RenewLeaseRequest {
  readonly lease: SourceLease;
  readonly signal: AbortSignal;
}

export interface ReleaseLeaseRequest {
  readonly lease: SourceLease;
  readonly signal: AbortSignal;
}

export interface ConnectorLeasePort {
  acquire(input: AcquireLeaseRequest): Promise<SourceLease>;
  renew(input: RenewLeaseRequest): Promise<SourceLease>;
  release(input: ReleaseLeaseRequest): Promise<void>;
}

export interface ClockPort {
  nowMs(): number;
}

export interface ScheduledOperation {
  cancel(): void;
}

export interface SchedulerPort {
  schedule(ms: number, onElapsed: () => void): ScheduledOperation;
}

export const systemScheduler: SchedulerPort;

export interface RandomPort {
  next(): number;
}

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;
export type JsonArray = readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface JsonDecodeLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxMembers: number;
}

export type JsonLocationClass =
  | "byte"
  | "token"
  | "member"
  | "depth"
  | "document";

export interface JsonDecodeIssue {
  readonly code:
    | "payload_too_large"
    | "invalid_utf8"
    | "invalid_json"
    | "json_too_deep"
    | "json_too_large"
    | "duplicate_member";
  readonly location: JsonLocationClass;
  readonly offset: number;
}

export type JsonDecodeResult =
  | { readonly success: true; readonly data: JsonValue }
  | { readonly success: false; readonly issues: readonly JsonDecodeIssue[] };

export function decodeJsonPage(
  bytes: Uint8Array,
  limits: JsonDecodeLimits,
): JsonDecodeResult;

export interface FetchPageRequest {
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly pageOrdinal: number;
  readonly cursor: string | null;
  readonly mode: ConnectorMode;
  readonly maxResponseBytes: number;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export interface AcquiredPage {
  readonly pageIdentity: string;
  readonly bytes: Uint8Array;
  readonly nextCursor: string | null;
  readonly complete: boolean;
}

export interface AdapterFailure {
  readonly kind: "rate_limited" | "transient" | "terminal";
  readonly retryAfterMs?: number;
}

export type AdapterFetchResult =
  | { readonly success: true; readonly page: AcquiredPage }
  | { readonly success: false; readonly failure: AdapterFailure };

export type VinObservationDraft =
  | { readonly status: "unavailable" }
  | { readonly status: "withheld" }
  | { readonly status: "full"; readonly vin: string };

interface ObservationDraftBase {
  readonly confidenceBps: number;
}

export type ObservationDraft =
  | (ObservationDraftBase & {
      readonly field: "price";
      readonly value: {
        readonly amountMinor: number;
        readonly currency: Currency;
      };
    })
  | (ObservationDraftBase & {
      readonly field: "mileage";
      readonly value: { readonly amount: number; readonly unit: MileageUnit };
    })
  | (ObservationDraftBase & {
      readonly field: "power";
      readonly value: { readonly amount: number; readonly unit: PowerUnit };
    })
  | (ObservationDraftBase & {
      readonly field: "co2";
      readonly value: {
        readonly amount: number;
        readonly unit: "g_per_km";
        readonly standard: "wltp" | "nedc";
      };
    })
  | (ObservationDraftBase & {
      readonly field: "vin";
      readonly value: VinObservationDraft;
    });

export type MappedItemDraft =
  | {
      readonly sourceListingId: string;
      readonly outcome: "active";
      readonly url?: string;
      readonly observations: readonly ObservationDraft[];
    }
  | {
      readonly sourceListingId: string;
      readonly outcome: "withdrawn" | "deleted";
    };

export interface MappedPageDraft {
  readonly items: readonly MappedItemDraft[];
}

export interface MapPageRequest {
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly territory: Territory;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly fields: readonly SourceField[];
  readonly raw: RawReference;
  readonly decoded: JsonValue;
  readonly signal: AbortSignal;
}

export interface ConnectorAdapterPort {
  fetchPage(input: FetchPageRequest): Promise<AdapterFetchResult>;
  mapPage(input: MapPageRequest): Promise<MappedPageDraft>;
}

export interface PolicyObligations {
  readonly grant: SourceGrant & { readonly audience: "internal" };
  readonly legalStatus: LegalStatus;
  readonly authorizationBasisRef: string;
  readonly authorizationValidUntil: ExactUtcTimestamp;
  readonly caching: CachingPolicy;
  readonly retention: RetentionPolicy;
  readonly media: MediaPolicy;
  readonly pii: PiiPolicy;
  readonly takedown: TakedownPolicy;
}

export interface RetentionDeadlines {
  readonly rawRetainUntil: ExactUtcTimestamp;
  readonly normalizedRetainUntil: ExactUtcTimestamp;
  readonly mediaRetainUntil: ExactUtcTimestamp | null;
  readonly piiRetainUntil: ExactUtcTimestamp | null;
  readonly cacheUntil: ExactUtcTimestamp | null;
}

export interface ConnectorScope {
  readonly scopeId: ConnectorScopeId;
  readonly sourceId: SourceId;
  readonly territory: Territory;
  readonly acquisitionMethod: AcquisitionMethod;
}

export interface InventoryHead {
  readonly schemaVersion: 1;
  readonly scope: ConnectorScope;
  readonly generationId: InventoryGenerationId | "empty";
  readonly revision: number;
  readonly activeSourceListingIds: readonly string[];
  readonly lastCompletedFullAt: ExactUtcTimestamp | null;
  readonly incrementalCursor: string | null;
}

export interface PendingRawPage {
  readonly operationKey: OperationKey;
  readonly pageOrdinal: number;
  readonly pageIdentity: string;
  readonly snapshotId: RawSnapshotId;
  readonly sha256: Sha256Digest;
  readonly byteLength: number;
  readonly capturedAt: ExactUtcTimestamp;
  readonly nextCursor: string | null;
  readonly complete: boolean;
  readonly deadlines: RetentionDeadlines;
}

export interface RunningConnectorCheckpoint {
  readonly schemaVersion: 1;
  readonly status: "running";
  readonly checkpointRevision: number;
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly leaseFence: number;
  readonly request: ConnectorRunRequest;
  readonly requestSha256: Sha256Digest;
  readonly startedAt: ExactUtcTimestamp;
  readonly authorityRevision: number;
  readonly registryRevision: number;
  readonly configurationSha256: Sha256Digest;
  readonly authorizationBasisRef: string;
  readonly obligations: PolicyObligations;
  readonly operations: SourceOperations;
  readonly scope: ConnectorScope;
  readonly baselineGenerationId: InventoryGenerationId | "empty";
  readonly baselineActiveSourceListingIds: readonly string[];
  readonly expectedInventoryGenerationId: InventoryGenerationId | "empty";
  readonly expectedInventoryRevision: number;
  readonly lastCompletedFullAt: ExactUtcTimestamp | null;
  readonly nextPageOrdinal: number;
  readonly nextCursor: string | null;
  readonly committedPages: number;
  readonly committedItems: number;
  readonly committedRawBytes: number;
  readonly visitedCursors: readonly (string | null)[];
  readonly finalPageCommitKey: OperationKey | null;
  readonly lastPageCommitKey: OperationKey | null;
  readonly pendingRaw: PendingRawPage | null;
  readonly stagedActiveSourceListingIds: readonly string[];
  readonly stagedEndedSourceListingIds: readonly string[];
}

export interface CompletedConnectorCheckpoint {
  readonly schemaVersion: 1;
  readonly status: "completed";
  readonly checkpointRevision: number;
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly leaseFence: number;
  readonly request: ConnectorRunRequest;
  readonly requestSha256: Sha256Digest;
  readonly startedAt: ExactUtcTimestamp;
  readonly completedAt: ExactUtcTimestamp;
  readonly completionOperationKey: OperationKey;
  readonly authorityRevision: number;
  readonly registryRevision: number;
  readonly configurationSha256: Sha256Digest;
  readonly authorizationBasisRef: string;
  readonly obligations: PolicyObligations;
  readonly scope: ConnectorScope;
  readonly baselineGenerationId: InventoryGenerationId | "empty";
  readonly finalInventoryGenerationId: InventoryGenerationId | "empty";
  readonly finalInventoryRevision: number;
  readonly committedPages: number;
  readonly committedItems: number;
  readonly result: Extract<ConnectorRunResult, { readonly status: "completed" }>;
}

export type ConnectorCheckpoint =
  | RunningConnectorCheckpoint
  | CompletedConnectorCheckpoint;

export type OpenRunResult =
  | {
      readonly status: "opened" | "resumed";
      readonly oldFencesQuiesced: true;
      readonly checkpoint: RunningConnectorCheckpoint;
    }
  | {
      readonly status: "completed";
      readonly oldFencesQuiesced: true;
      readonly checkpoint: CompletedConnectorCheckpoint;
      readonly result: Extract<
        ConnectorRunResult,
        { readonly status: "completed" }
      >;
    };

export interface StoreMutationBase {
  readonly schemaVersion: 1;
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly operationKey: OperationKey;
  readonly leaseFence: number;
  readonly signal: AbortSignal;
}

export interface OpenRunRequest extends StoreMutationBase {
  readonly request: ConnectorRunRequest;
  readonly requestSha256: Sha256Digest;
  readonly openedAt: ExactUtcTimestamp;
  readonly authority: VerifiedSourceHead;
  readonly registryRevision: number;
  readonly configurationSha256: Sha256Digest;
  readonly obligations: PolicyObligations;
  readonly operations: SourceOperations;
  readonly scope: ConnectorScope;
}

export interface SourceCircuitState {
  readonly state: CircuitState;
  readonly consecutiveTransientFailures: number;
  readonly openedAtMs: number | null;
  readonly probeOwnerFence: number | null;
  readonly probeExpiresAtMs: number | null;
}

export interface SourceRuntimeState {
  readonly schemaVersion: 1;
  readonly sourceId: SourceId;
  readonly revision: number;
  readonly nextRequestAtMs: number;
  readonly circuit: SourceCircuitState;
}

export interface ReserveAttemptRequest extends StoreMutationBase {
  readonly pageOrdinal: number;
  readonly attempt: number;
  readonly nowMs: number;
  readonly requestIntervalMs: number;
  readonly circuitOpenMs: 60_000;
  readonly transientFailureThreshold: 5;
  readonly probeTtlMs: number;
}

export interface AttemptReservation {
  readonly reservationKey: OperationKey;
  readonly runtimeRevision: number;
  readonly notBeforeMs: number;
  readonly nextRequestAtMs: number;
  readonly ownsHalfOpenProbe: boolean;
}

export type AttemptOutcome =
  | { readonly kind: "success" }
  | { readonly kind: "rate_limited" }
  | { readonly kind: "transient" }
  | { readonly kind: "terminal" };

export interface CompleteAttemptRequest extends StoreMutationBase {
  readonly reservationKey: OperationKey;
  readonly expectedRuntimeRevision: number;
  readonly outcome: AttemptOutcome;
  readonly completedAtMs: number;
}

export interface AttemptCompletionReceipt {
  readonly operationKey: OperationKey;
  readonly reservationKey: OperationKey;
  readonly runtime: SourceRuntimeState;
}

export type SourceRuntimeReduction<T> =
  | { readonly success: true; readonly data: T; readonly nextState: SourceRuntimeState }
  | { readonly success: false; readonly failure: { readonly code: "circuit_open" | "stale_fence" | "runtime_conflict" | "invalid_state" } };

export function reduceAttemptReservation(
  state: SourceRuntimeState,
  request: ReserveAttemptRequest,
): SourceRuntimeReduction<AttemptReservation>;

export function reduceAttemptCompletion(
  state: SourceRuntimeState,
  reservation: AttemptReservation,
  request: CompleteAttemptRequest,
): SourceRuntimeReduction<AttemptCompletionReceipt>;

export interface StageRawRequest extends StoreMutationBase {
  readonly checkpointRevision: number;
  readonly pageOrdinal: number;
  readonly pageIdentity: string;
  readonly snapshotId: RawSnapshotId;
  readonly sha256: Sha256Digest;
  readonly bytes: Uint8Array;
  readonly capturedAt: ExactUtcTimestamp;
  readonly nextCursor: string | null;
  readonly complete: boolean;
  readonly obligations: PolicyObligations;
  readonly deadlines: RetentionDeadlines;
}

export interface StageRawReceipt {
  readonly operationKey: OperationKey;
  readonly snapshotId: RawSnapshotId;
  readonly sha256: Sha256Digest;
  readonly byteLength: number;
  readonly checkpointRevision: number;
}

export interface LoadStagedRawRequest {
  readonly schemaVersion: 1;
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly snapshotId: RawSnapshotId;
  readonly leaseFence: number;
  readonly asOf: ExactUtcTimestamp;
  readonly signal: AbortSignal;
}

export interface StagedRawPage {
  readonly pending: PendingRawPage;
  readonly bytes: Uint8Array;
  readonly obligations: PolicyObligations;
}

export interface ListingVersionEvidence {
  readonly schemaVersion: 1;
  readonly listingVersionId: ListingVersionId;
  readonly listingId: ListingId;
  readonly sourceId: SourceId;
  readonly sourceListingId: string;
  readonly connectorRunId: ConnectorRunId;
  readonly mapperVersion: string;
  readonly capturedAt: ExactUtcTimestamp;
  readonly url?: string;
  readonly observationIds: readonly ObservationId[];
  readonly raw: RawReference;
  readonly deadlines: RetentionDeadlines;
}

export interface ListingProjection {
  readonly schemaVersion: 1;
  readonly listingId: ListingId;
  readonly sourceId: SourceId;
  readonly sourceListingId: string;
  readonly scope: ConnectorScope;
  readonly latestVersionId: ListingVersionId | null;
  readonly state: "active" | "withdrawn" | "deleted" | "missing";
  readonly projectionRevision: number;
  readonly updatedAt: ExactUtcTimestamp;
}

export interface ExplicitLifecycleTombstone {
  readonly schemaVersion: 1;
  readonly tombstoneId: LifecycleTombstoneId;
  readonly kind: "explicit";
  readonly outcome: "withdrawn" | "deleted";
  readonly scope: ConnectorScope;
  readonly listingId: ListingId;
  readonly sourceListingId: string;
  readonly runId: ConnectorRunId;
  readonly capturedAt: ExactUtcTimestamp;
  readonly raw: RawReference;
  readonly deadlines: RetentionDeadlines;
}

export interface InferredMissingTombstone {
  readonly schemaVersion: 1;
  readonly tombstoneId: LifecycleTombstoneId;
  readonly kind: "inferred_missing";
  readonly scope: ConnectorScope;
  readonly listingId: ListingId;
  readonly sourceListingId: string;
  readonly runId: ConnectorRunId;
  readonly baselineGenerationId: InventoryGenerationId | "empty";
  readonly inventoryGenerationId: InventoryGenerationId;
  readonly finalizationKey: OperationKey;
  readonly completedAt: ExactUtcTimestamp;
}

export type LifecycleTombstone =
  | ExplicitLifecycleTombstone
  | InferredMissingTombstone;

export interface CanonicalPageEffects {
  readonly listings: readonly Listing[];
  readonly listingVersions: readonly ListingVersionEvidence[];
  readonly observations: readonly Observation[];
  readonly explicitTombstones: readonly ExplicitLifecycleTombstone[];
  readonly activeSourceListingIds: readonly string[];
  readonly endedSourceListingIds: readonly string[];
}

export interface CommitPageRequest extends StoreMutationBase {
  readonly expectedCheckpointRevision: number;
  readonly expectedInventoryGenerationId: InventoryGenerationId | "empty";
  readonly expectedInventoryRevision: number;
  readonly pending: PendingRawPage;
  readonly effects: CanonicalPageEffects;
  readonly nextPageOrdinal: number;
  readonly nextCursor: string | null;
  readonly pageItemCount: number;
  readonly complete: boolean;
  readonly authorityRevision: number;
  readonly committedAt: ExactUtcTimestamp;
}

export interface PageCommitReceipt {
  readonly operationKey: OperationKey;
  readonly checkpointRevision: number;
  readonly inventoryGenerationId: InventoryGenerationId | "empty";
  readonly inventoryRevision: number;
  readonly committedPages: number;
  readonly committedItems: number;
  readonly complete: boolean;
  readonly checkpoint: ConnectorCheckpoint;
}

export interface FinalizeFullRunRequest extends StoreMutationBase {
  readonly expectedCheckpointRevision: number;
  readonly scope: ConnectorScope;
  readonly baselineGenerationId: InventoryGenerationId | "empty";
  readonly expectedInventoryGenerationId: InventoryGenerationId | "empty";
  readonly expectedInventoryRevision: number;
  readonly inventoryGenerationId: InventoryGenerationId;
  readonly finalPageCommitKey: OperationKey;
  readonly finalizationKey: OperationKey;
  readonly completedAt: ExactUtcTimestamp;
  readonly authorityRevision: number;
  readonly nextActiveSourceListingIds: readonly string[];
  readonly inferredMissing: readonly InferredMissingTombstone[];
  readonly deletionMode:
    | "explicit_tombstone"
    | "full_reconciliation"
    | "both";
}

export interface FullRunReceipt {
  readonly operationKey: OperationKey;
  readonly finalizationKey: OperationKey;
  readonly checkpointRevision: number;
  readonly inventoryGenerationId: InventoryGenerationId;
  readonly inventoryRevision: number;
  readonly inferredMissing: readonly InferredMissingTombstone[];
  readonly result: Extract<ConnectorRunResult, { readonly status: "completed" }>;
}

export type ConnectorMutationKind =
  | "run.opened"
  | "attempt.reserved"
  | "attempt.completed"
  | "raw.staged"
  | "page.committed"
  | "full.finalized"
  | "circuit.changed"
  | "run.terminal";

export interface ConnectorMutationRecord {
  readonly schemaVersion: 1;
  readonly kind: ConnectorMutationKind;
  readonly operationKey: OperationKey;
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly leaseFence: number;
  readonly recordedAt: ExactUtcTimestamp;
  readonly checkpointRevision: number | null;
  readonly runtimeRevision: number | null;
  readonly pageOrdinal: number | null;
  readonly itemCount: number | null;
  readonly byteCount: number | null;
  readonly outcome: "success" | "failed" | "cancelled" | null;
  readonly errorCode: ConnectorErrorCode | null;
}

export interface MutationReceipt {
  readonly operationKey: OperationKey;
  readonly kind: ConnectorMutationKind;
  readonly payloadSha256: Sha256Digest;
  readonly record: ConnectorMutationRecord;
}

export interface LookupMutationRequest {
  readonly schemaVersion: 1;
  readonly sourceId: SourceId;
  readonly runId: ConnectorRunId;
  readonly operationKey: OperationKey;
  readonly leaseFence: number;
  readonly expectedKind: ConnectorMutationKind;
  readonly signal: AbortSignal;
}

export interface RecordRunTerminalRequest extends StoreMutationBase {
  readonly expectedCheckpointRevision: number | null;
  readonly terminalAt: ExactUtcTimestamp;
  readonly result: Exclude<ConnectorRunResult, { readonly status: "completed" }>;
}

export interface RunTerminalReceipt {
  readonly operationKey: OperationKey;
  readonly checkpointRevision: number | null;
  readonly recorded: true;
}

export type StoreFailureCode =
  | "stale_fence"
  | "fence_not_quiesced"
  | "idempotency_conflict"
  | "checkpoint_conflict"
  | "inventory_conflict"
  | "runtime_conflict"
  | "raw_conflict"
  | "retention_expired"
  | "full_reconciliation_required"
  | "circuit_open"
  | "not_found"
  | "invalid_state";

export interface StoreFailure {
  readonly code: StoreFailureCode;
  readonly retryable: false;
}

export type StoreResult<T> =
  | { readonly acknowledged: true; readonly success: true; readonly data: T }
  | {
      readonly acknowledged: true;
      readonly success: false;
      readonly failure: StoreFailure;
    };

export interface ConnectorStorePort {
  openRun(input: OpenRunRequest): Promise<StoreResult<OpenRunResult>>;
  reserveAttempt(
    input: ReserveAttemptRequest,
  ): Promise<StoreResult<AttemptReservation>>;
  completeAttempt(
    input: CompleteAttemptRequest,
  ): Promise<StoreResult<AttemptCompletionReceipt>>;
  stageRaw(input: StageRawRequest): Promise<StoreResult<StageRawReceipt>>;
  loadStagedRaw(
    input: LoadStagedRawRequest,
  ): Promise<StoreResult<StagedRawPage>>;
  commitPage(input: CommitPageRequest): Promise<StoreResult<PageCommitReceipt>>;
  finalizeFullRun(
    input: FinalizeFullRunRequest,
  ): Promise<StoreResult<FullRunReceipt>>;
  lookupMutation(
    input: LookupMutationRequest,
  ): Promise<StoreResult<MutationReceipt | null>>;
  recordRunTerminal(
    input: RecordRunTerminalRequest,
  ): Promise<StoreResult<RunTerminalReceipt>>;
}

export type ConnectorTelemetryEvent = ConnectorMutationRecord;

export interface TelemetryPort {
  emit(event: ConnectorTelemetryEvent): void;
}

export function parseAdapterFetchResult(
  input: unknown,
): ValidationResult<AdapterFetchResult>;
export function parseMappedPageDraft(
  input: unknown,
): ValidationResult<MappedPageDraft>;
export function parseStoreResult<T>(
  input: unknown,
  parseData: (input: unknown) => ValidationResult<T>,
): ValidationResult<StoreResult<T>>;
```

## Frozen formulas and runtime bounds

- Request tokens (`invocationKey`, adapter version, mapper version) are trimmed ASCII `[A-Za-z0-9][A-Za-z0-9._-]*`, length 1–128. Request fields are unique, canonical-order sorted and include `source_listing_id`.
- Run limits are: pages 1–1,000; items 1–100,000; run milliseconds 1–86,400,000; effect milliseconds 1–300,000; page bytes 1–1,048,576; JSON depth 1–64; JSON members 1–100,000.
- `leaseTtlMs = max(30_000, 2 * sourceTimeoutMs + 5_000)`, maximum 605,000. Renew no later than lease half-life before the next effect.
- `requestIntervalMs = ceil(60_000 / requestsPerMinute)`. Reservation atomically returns `notBeforeMs = max(nowMs, previousNextRequestAtMs)` and stores `nextRequestAtMs = notBeforeMs + requestIntervalMs` before fetch.
- Reservation key is `reserve_ + hash("attempt-reservation", runId, leaseFence, pageOrdinal, attempt)`. A new fence always receives a new reservation key and consumes a new source-wide rate slot.
- Five typed transient failures open the circuit for 60,000 ms. Rate limits do not increment the transient counter. Half-open has one fenced owner whose probe expires after the source timeout. A successful acquisition closes and resets the circuit even if later decode or mapping fails.
- Retry count is at most `maxRetries + 1`, therefore at most 21 attempts. Full jitter is `floor(random * (min(30_000, 250 * 2^retryIndex) + 1))`; a valid retry-after 0–300,000 ms takes the maximum.
- Raw effective TTL is `min(rawSeconds, piiSeconds when seller_pii is requested, mediaSeconds when media is requested and mode is licensed_copy)`. Reject a nonpositive applicable TTL.
- Each retention deadline is `min(capturedAt + matchingRetentionSeconds, authorizationValidUntil)`. `cacheUntil` is null when caching is false; otherwise it is `min(capturedAt + maxAgeSeconds, normalizedRetainUntil)`. Exact equality with raw retention expiry is expired.
- Hash framing is UTF-8 `aw-connector-v1\0`, then the key kind and every scalar part encoded as ASCII byte-length, `:`, exact UTF-8 bytes, `\0`. No generic object serialization, URL, locale conversion or Unicode normalization participates.
- Golden key order:
  - run: source ID, invocation key;
  - page: run ID, page ordinal, page identity;
  - raw: source ID, page key;
  - item: source ID, source publication ID;
  - page commit: page key, raw SHA-256, mapper version;
  - scope: source ID, territory, acquisition method;
  - listing: source ID, source publication ID;
  - listing version: listing ID, run ID, snapshot ID, raw SHA-256, mapper version;
  - observation: listing ID, field, fixed field-value encoding, confidence BPS, captured time, run ID, snapshot ID, raw SHA-256, mapper version;
  - explicit tombstone: scope ID, source publication ID, outcome, captured time, run ID, snapshot ID, raw SHA-256;
  - inventory generation: scope ID, run ID, baseline generation or `empty`;
  - finalization: scope ID, run ID, baseline generation or `empty`, new generation, final page commit key;
  - inferred missing tombstone: scope ID, missing source publication ID, baseline generation or `empty`, new generation, finalization key.

## Synthetic contract expectations

- Public parsers accept only dense ordinary arrays and plain/null-prototype objects with enumerable data properties; unknown, symbol, non-enumerable, accessor, dangerous-prototype and reflective failures fail closed without echoing input.
- Strict JSON accepts exact byte/depth/member bounds and all JSON categories, builds dense arrays/null-prototype objects and rejects BOM, malformed UTF-8/JSON, trailing input, overflow numbers, lone escaped surrogates, prototype-sensitive decoded names and escape-equivalent duplicate members.
- Mapper drafts cannot supply canonical IDs, provenance, observed time, identity, access policy or arbitrary catchall fields. Active items have 0–16 observation drafts; ended items have no URL or observations. Total observations per page are at most 100,000.
- Exact draft duplicates collapse. Same-field changed values/confidence remain distinct. A full run rejects duplicate source publication IDs across pages before committing that page or inferring absence.
- Every mutation is exact-replay idempotent and changed-reuse conflicting. Store `success:false` is an acknowledged typed rejection. Promise rejection, arbitrary throw or mutation timeout is `mutation_indeterminate`; recovery needs a new fence, proven old-fence quiescence and matching/explicitly absent ledger receipt.
- `openRun` validates the current inventory against the persisted expected head for a running checkpoint. It never silently rebases. A completed exact replay returns the persisted result without adapter calls or comparison to a later inventory generation.
- Full reconciliation changes inventory only in `finalizeFullRun`. `full_reconciliation|both` infer scoped missing from the pinned baseline; `explicit_tombstone` retains unseen prior active publications and emits no inferred-missing tombstone. Partial, failed, cancelled, revoked or indeterminate runs infer nothing.
- Every durable mutation records one versioned ledger/outbox event atomically. Telemetry is an allowlisted best-effort mirror; sink failure cannot affect the run or become rights/state evidence.
- Fixtures remain synthetic and contain no real source payload, credential, seller PII or VIN. Passing them proves neither authentic authority, durable fencing/storage, source minimization, encryption/retention/takedown workers nor production monitoring.

## Resolved declaration details

- The two pure runtime reducers implement SDK-owned deterministic rate/circuit transitions. Inputs supply time/configuration; reducers do no I/O and validate source/revision/numeric invariants. They do not authenticate a lease or prove one-time reservation consumption: the enclosing store transaction must fence, bind reservation key/owner and enforce exact replay in its ledger. Half-open expiry starts at the reserved notBefore time plus probe TTL, not before the delayed request can begin. A failed probe reopens for 60 seconds; only typed transient outcomes increment the consecutive-transient counter (clamped at threshold); successful acquisition closes/resets. Acknowledged terminal/rate-limited outcomes outside a probe do not increment it.

- Deterministic ID/key prefixes are `run_`, `page_`, `raw_`, `item_`, `scope_`, `lst_`, `lv_`, `obs_`, `tmb_`, `inv_`, `commit_`, `final_`, `reserve_` followed by 64 lowercase SHA256 hex. Hash kinds are respectively `run`, `page`, `raw`, `item`, `scope`, `listing`, `listing-version`, `observation`, `explicit-tombstone` or `missing-tombstone`, `inventory`, `commit`, `finalization`, `attempt-reservation`. Store lifecycle operation keys for open, stage, completion and terminal use separate `open_`, `stage_`, `attempt_`, `terminal_` prefixes/kinds and fixed scalar order documented with their implementation; these are transport lifecycle keys, never vehicle identities. Stage binds snapshot ID, attempt completion binds reservation key, open binds run/fence, terminal binds run/fence/checkpoint revision/status/stable error.

- `attempt.completed` is a durable event because it is a mutation. Lease methods retain direct promises; failed/indeterminate lease acquisition or renewal stops the engine, and no retry assumes it was released. StoreResult distinguishes acknowledged business failures from indeterminate mutations, not authenticated permission.
- ADR-0002's piiSeconds governs seller_pii. VIN remains internal with normalized retention and authorization ceiling; the SDK does not reinterpret zero seller-PII retention as a VIN grant, prohibition or public projection.
- `openRun` atomically reads the current inventory itself by scope. A caller never invents/passes a current inventory; this eliminates an otherwise missing inventory read port. The returned running checkpoint carries the pinned baseline active identities (bounded at 100,000) needed to compute missing evidence.
- Full starts with null acquisition cursor; a new incremental invocation starts with the scoped committed incrementalCursor. A complete page's nextCursor is the adapter's next incremental watermark (nullable), persisted to scoped inventory only on successful incremental completion or full finalization. Nonfinal pages require a non-null next cursor; checkpoint visitedCursors detects nonfinal cycles across resumes. Final watermark reuse is valid and is not a within-run loop.
- Full final page commit persists finalPageCommitKey and remains running pending finalization; resume finalizes without fetching another page. Incremental final page commit records completion atomically. PageCommitReceipt carries the resulting checkpoint, so no unmodelled read/update operation is needed.
- Pending raw records its staging operation key, running progress retains lastPageCommitKey, and completed checkpoints retain completionOperationKey. Resume looks up the corresponding durable receipt by source/run/key/kind after openRun quiescence. The SDK does not invent a lost command digest: receipts bind those identities, and exact raw metadata/digest/candidate/checkpoint consistency is checked before continuation. Store payloadSha256 is the store's immutable semantic-command audit digest, excluding transport signal and lease fence; idempotent command replay must still compare the complete semantic content, not trust a hash supplied by the caller. A pending raw checkpoint with no staging receipt is invalid state, not permission to fetch again.
- The SDK constructs final next-active membership and all inferred tombstones from the pinned baseline and committed staged membership. finalizeFullRun verifies the exact mode-specific set difference/union, receipt sequence, keys and unchanged head atomically before storing those candidates; the persistence port does not invent evidence IDs. Pure source-runtime/circuit reduction helpers may live in the SDK so production stores can apply them within CAS, with independent golden transition tests.
- The store derives scoped ListingProjection heads from active version evidence and explicit/missing tombstones within page/finalization CAS. It does not require the SDK to guess an existing projection revision. Projection includes scope, so a missing result in one territory/method never changes another scoped projection. ListingVersionEvidence and canonical Listing records are active-page evidence; ended outcomes append explicit tombstones without inventing an active version.
- Every returned checkpoint/inventory/staged-membership array is bounded (100,000 publication identities; at most 1,000 cursor entries). The SDK uses bounded page work and does not load an unbounded historical observation collection. Store snapshots/receipts are strictly validated and detached before use. The exact full DTOs are not themselves proof that a production store implements these invariants.
