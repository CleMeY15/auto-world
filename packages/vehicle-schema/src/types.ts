declare const vehicleEntityIdBrand: unique symbol;
declare const listingIdBrand: unique symbol;
declare const observationIdBrand: unique symbol;
declare const sourceIdBrand: unique symbol;
declare const connectorRunIdBrand: unique symbol;
declare const rawSnapshotIdBrand: unique symbol;

export type VehicleEntityId = string & { readonly [vehicleEntityIdBrand]: true };
export type ListingId = string & { readonly [listingIdBrand]: true };
export type ObservationId = string & { readonly [observationIdBrand]: true };
export type SourceId = string & { readonly [sourceIdBrand]: true };
export type ConnectorRunId = string & { readonly [connectorRunIdBrand]: true };
export type RawSnapshotId = string & { readonly [rawSnapshotIdBrand]: true };

export type ValidationIssueCode =
  | "invalid_type"
  | "unknown_key"
  | "missing_field"
  | "invalid_value"
  | "unsupported_version"
  | "duplicate_id"
  | "observation_conflict"
  | "invalid_object";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: string;
}

export type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

export interface VehicleEntity {
  readonly schemaVersion: 1;
  readonly vehicleId: VehicleEntityId;
  readonly identityStatus: "candidate";
  readonly observationIds: readonly ObservationId[];
}

export type ListingIdentity =
  | { readonly status: "unresolved" }
  | { readonly status: "candidate"; readonly vehicleId: VehicleEntityId };

export interface Listing {
  readonly schemaVersion: 1;
  readonly listingId: ListingId;
  readonly sourceId: SourceId;
  readonly sourceListingId: string;
  readonly identity: ListingIdentity;
  readonly observationIds: readonly ObservationId[];
  readonly url?: string;
}

export type AcquisitionMethod = "api" | "feed" | "crawl" | "manual";

export type LegalStatus =
  | "official_api"
  | "licensed_partner"
  | "dealer_feed"
  | "permitted_crawl"
  | "restricted"
  | "blocked"
  | "unknown";

export interface RawReference {
  readonly snapshotId: RawSnapshotId;
  readonly connectorRunId: ConnectorRunId;
  readonly sha256: string;
}

export interface Provenance {
  readonly sourceId: SourceId;
  readonly observedAt: string;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly legalStatus: LegalStatus;
  readonly confidenceBps: number;
  readonly raw: RawReference;
}

export type ObservationSubject =
  | { readonly kind: "vehicle"; readonly vehicleId: VehicleEntityId }
  | { readonly kind: "listing"; readonly listingId: ListingId };

export type Currency = "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "KRW";
export type MileageUnit = "km" | "mi";
export type PowerUnit = "kw" | "metric_hp";
export type Co2Standard = "wltp" | "nedc";

export type IdentityEvidence =
  | { readonly status: "unavailable" }
  | { readonly status: "withheld" }
  | {
      readonly status: "full";
      readonly vin: string;
      readonly accessPolicy: {
        readonly visibility: "internal";
        readonly policyRef: string;
      };
    };

interface ObservationBase {
  readonly schemaVersion: 1;
  readonly observationId: ObservationId;
  readonly subject: ObservationSubject;
  readonly provenance: Provenance;
}

export type Observation =
  | (ObservationBase & {
      readonly field: "price";
      readonly value: { readonly amountMinor: number; readonly currency: Currency };
    })
  | (ObservationBase & {
      readonly field: "mileage";
      readonly value: { readonly amount: number; readonly unit: MileageUnit };
    })
  | (ObservationBase & {
      readonly field: "power";
      readonly value: { readonly amount: number; readonly unit: PowerUnit };
    })
  | (ObservationBase & {
      readonly field: "co2";
      readonly value: {
        readonly amount: number;
        readonly unit: "g_per_km";
        readonly standard: Co2Standard;
      };
    })
  | (ObservationBase & {
      readonly field: "vin";
      readonly value: IdentityEvidence;
    });

export type ObservationCollection = readonly Observation[];
