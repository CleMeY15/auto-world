import type {
  AcquisitionMethod,
  LegalStatus,
  SourceId,
} from "@auto-world/vehicle-schema";

export type Territory = "FR" | "DE" | "KR" | "GB" | "US" | "CH" | "JP";
export type Audience = "internal" | "consumer" | "b2b";
export type SourceField =
  | "source_listing_id"
  | "url"
  | "price"
  | "mileage"
  | "power"
  | "co2"
  | "vin"
  | "description"
  | "media"
  | "seller_pii";

export type SourceCredentials =
  | { readonly kind: "none" }
  | { readonly kind: "secret_ref"; readonly ref: string };

export interface SourceAuthorization {
  readonly basisRef: string;
  readonly reviewerRef: string;
  readonly reviewedAt: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

export interface SourceGrant {
  readonly territory: Territory;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly audience: Audience;
  readonly fields: readonly SourceField[];
}

export interface CachingPolicy {
  readonly allowed: boolean;
  readonly maxAgeSeconds: number;
}

export interface RetentionPolicy {
  readonly rawSeconds: number;
  readonly normalizedSeconds: number;
  readonly mediaSeconds: number;
  readonly piiSeconds: number;
}

export interface MediaPolicy {
  readonly mode: "none" | "reference" | "licensed_copy";
  readonly attributionRequired: boolean;
}

export type PiiPolicy =
  | { readonly mode: "none"; readonly purposeRef: null }
  | {
      readonly mode: "professional_only" | "private_seller";
      readonly purposeRef: string;
    };

export interface TakedownPolicy {
  readonly contactRef: string;
  readonly procedureRef: string;
  readonly maxResponseSeconds: number;
}

export interface DeclaredSourcePolicy {
  readonly authorization: SourceAuthorization;
  readonly grants: readonly SourceGrant[];
  readonly caching: CachingPolicy;
  readonly retention: RetentionPolicy;
  readonly media: MediaPolicy;
  readonly pii: PiiPolicy;
  readonly takedown: TakedownPolicy;
}

export interface SourceOperations {
  readonly incremental: boolean;
  readonly fullReconcileIntervalSeconds: number;
  readonly deletionMode: "explicit_tombstone" | "full_reconciliation" | "both";
  readonly deletionPropagationSeconds: number;
  readonly freshnessSeconds: number;
  readonly requestsPerMinute: number;
  readonly concurrency: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export interface SourceHealthPolicy {
  readonly maxSampleAgeSeconds: number;
  readonly maxSuccessAgeSeconds: number;
  readonly maxErrorBps: number;
  readonly maxParseErrorBps: number;
  readonly maxStaleBps: number;
  readonly maxLatencyP95Ms: number;
}

export interface SourceConfiguration {
  readonly displayName: string;
  readonly territories: readonly Territory[];
  readonly acquisitionMethods: readonly AcquisitionMethod[];
  readonly credentials: SourceCredentials;
  readonly legalStatus: LegalStatus;
  readonly policy: DeclaredSourcePolicy | null;
  readonly operations: SourceOperations;
  readonly healthPolicy: SourceHealthPolicy;
}

export type SourceState = "disabled" | "enabled" | "takedown";
export type SourceEventKind =
  | "create"
  | "replace_configuration"
  | "enable"
  | "disable"
  | "takedown";

export interface SourceEvent {
  readonly eventId: string;
  readonly kind: SourceEventKind;
  readonly actorRef: string;
  readonly at: string;
  readonly reasonRef: string;
}

export interface SourceRevision {
  readonly revision: number;
  readonly state: SourceState;
  readonly configuration: SourceConfiguration;
  readonly event: SourceEvent;
}

export interface SourceRegistry {
  readonly schemaVersion: 1;
  readonly sourceId: SourceId;
  readonly revisions: readonly SourceRevision[];
}

export interface PolicyEligibilityRequest {
  readonly territory: Territory;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly fields: readonly SourceField[];
  readonly audience: Audience;
}

export type PolicyIneligibilityReason =
  | "future_revision"
  | "takedown"
  | "disabled"
  | "legal_status"
  | "missing_policy"
  | "policy_not_current"
  | "internal_only_field"
  | "scope_not_granted";

interface PolicyEligibilityBase {
  readonly sourceId: SourceId;
  readonly revision: number;
  readonly asOf: string;
}

export type PolicyEligibility =
  | (PolicyEligibilityBase & {
      readonly eligible: true;
      readonly policy: DeclaredSourcePolicy;
    })
  | (PolicyEligibilityBase & {
      readonly eligible: false;
      readonly reason: PolicyIneligibilityReason;
    });

export type CircuitState = "closed" | "open" | "half_open";

export interface SourceHealthSample {
  readonly sourceId: SourceId;
  readonly windowStartAt: string;
  readonly windowEndAt: string;
  readonly lastSuccessAt: string | null;
  readonly requestCount: number;
  readonly itemCount: number;
  readonly errorBps: number | null;
  readonly parseErrorBps: number | null;
  readonly staleBps: number | null;
  readonly latencyP95Ms: number | null;
  readonly circuit: CircuitState;
}

export type SourceHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";
export type SourceHealthReason =
  | "circuit_open"
  | "no_success"
  | "stale_success"
  | "stale_sample"
  | "missing_measurements"
  | "circuit_half_open"
  | "error_rate"
  | "parse_error_rate"
  | "stale_ratio"
  | "latency";

export interface SourceHealth {
  readonly sourceId: SourceId;
  readonly revision: number;
  readonly asOf: string;
  readonly status: SourceHealthStatus;
  readonly reasons: readonly SourceHealthReason[];
}
