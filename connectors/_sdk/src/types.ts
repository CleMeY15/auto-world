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
} from "@auto-world/vehicle-schema";
import type {
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
  | {
      readonly success: true;
      readonly data: T;
      readonly nextState: SourceRuntimeState;
    }
  | {
      readonly success: false;
      readonly failure: {
        readonly code:
          | "circuit_open"
          | "stale_fence"
          | "runtime_conflict"
          | "invalid_state";
      };
    };

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
