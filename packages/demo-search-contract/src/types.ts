import type {
  Currency,
  ListingId,
  MileageUnit,
} from "@auto-world/vehicle-schema";
import type {
  MakeId,
  ModelId,
  TaxonomyReleaseReferenceV1,
  TaxonomyReleaseV1,
} from "@auto-world/vehicle-taxonomy";

export type DemoSearchSort =
  | "listing_asc"
  | "price_asc"
  | "price_desc"
  | "mileage_asc"
  | "mileage_desc";

export interface DemoSearchQueryV1 {
  readonly schemaVersion: 1;
  readonly sort: DemoSearchSort;
  readonly priceMaxMinor?: number;
  readonly mileageMaxKm?: number;
  readonly cursor?: string;
}

export interface DemoPriceValue {
  readonly amountMinor: number;
  readonly currency: Currency;
}

export interface DemoMileageValue {
  readonly amount: number;
  readonly unit: MileageUnit;
}

export type DemoPriceField =
  | { readonly status: "unavailable" }
  | {
      readonly status: "observed";
      readonly value: DemoPriceValue;
      readonly evidenceId: string;
    };

export type DemoMileageField =
  | { readonly status: "unavailable" }
  | {
      readonly status: "observed";
      readonly value: DemoMileageValue;
      readonly evidenceId: string;
    };

export type DemoEvidence =
  | {
      readonly evidenceId: string;
      readonly field: "price";
      readonly observedAt: string;
      readonly confidenceBps: number;
      readonly value: DemoPriceValue;
    }
  | {
      readonly evidenceId: string;
      readonly field: "mileage";
      readonly observedAt: string;
      readonly confidenceBps: number;
      readonly value: DemoMileageValue;
    };

export interface DemoResultV1 {
  readonly listingId: ListingId;
  readonly availability: "active" | "withdrawn" | "deleted" | "missing";
  readonly price: DemoPriceField;
  readonly mileage: DemoMileageField;
  readonly evidence: readonly DemoEvidence[];
}

interface DemoSearchResponseBaseV1 {
  readonly schemaVersion: 1;
  readonly dataMode: "synthetic";
  readonly fixtureVersion: string;
  readonly dataAsOf: string;
  readonly results: readonly DemoResultV1[];
  readonly nextCursor?: string;
}

export type DemoSearchResponseV1 =
  | (DemoSearchResponseBaseV1 & {
      readonly state: "complete";
      readonly totalCount: number;
    })
  | (DemoSearchResponseBaseV1 & {
      readonly state: "partial";
      readonly reason: "projection_incomplete";
    })
  | (DemoSearchResponseBaseV1 & {
      readonly state: "stale";
      readonly reason: "projection_stale";
    });

export interface DemoReadContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
}

export type DemoReadFailureCode =
  | "invalid_cursor"
  | "read_unavailable"
  | "cancelled";

export type DemoReadOutcome =
  | { readonly success: true; readonly data: DemoSearchResponseV1 }
  | {
      readonly success: false;
      readonly error: { readonly code: DemoReadFailureCode };
    };

export interface DemoReadPort {
  search(
    query: DemoSearchQueryV1,
    context: DemoReadContext,
  ): Promise<DemoReadOutcome>;
  getListing(
    listingId: ListingId,
    context: DemoReadContext,
  ): Promise<DemoReadOutcome>;
}

export interface DemoSearchQueryV2 {
  readonly schemaVersion: 2;
  readonly sort: DemoSearchSort;
  readonly priceMaxMinor?: number;
  readonly mileageMaxKm?: number;
  readonly makeId?: MakeId;
  readonly modelId?: ModelId;
  readonly firstRegistrationYear?: number;
  readonly cursor?: string;
}

export interface DemoDescriptionAttributionV2 {
  readonly kind: "synthetic_fixture";
  readonly fixtureRef: string;
}

export interface DemoDescriptionValueV2 {
  readonly release: TaxonomyReleaseReferenceV1;
  readonly makeId: MakeId;
  readonly modelId: ModelId;
  readonly firstRegistrationYear: number;
  readonly attribution: DemoDescriptionAttributionV2;
}

export interface DemoDescriptionEvidenceV2 {
  readonly evidenceId: string;
  readonly capturedAt: string;
  readonly value: DemoDescriptionValueV2;
}

export type DemoDescriptionFieldV2 =
  | { readonly status: "unavailable" }
  | {
      readonly status: "authored_synthetic";
      readonly value: DemoDescriptionValueV2;
      readonly evidenceId: string;
    };

export interface DemoResultV2 extends DemoResultV1 {
  readonly description: DemoDescriptionFieldV2;
  readonly descriptionEvidence: readonly DemoDescriptionEvidenceV2[];
}

interface DemoSearchResponseBaseV2 {
  readonly schemaVersion: 2;
  readonly dataMode: "synthetic";
  readonly fixtureVersion: string;
  readonly taxonomyRelease: TaxonomyReleaseReferenceV1;
  readonly dataAsOf: string;
  readonly results: readonly DemoResultV2[];
  readonly nextCursor?: string;
}

export type DemoSearchResponseV2 =
  | (DemoSearchResponseBaseV2 & {
      readonly state: "complete";
      readonly totalCount: number;
    })
  | (DemoSearchResponseBaseV2 & {
      readonly state: "partial";
      readonly reason: "projection_incomplete";
    })
  | (DemoSearchResponseBaseV2 & {
      readonly state: "stale";
      readonly reason: "projection_stale";
    });

export interface DemoCatalogResponseV2 {
  readonly schemaVersion: 2;
  readonly dataMode: "synthetic";
  readonly fixtureVersion: string;
  readonly taxonomyRelease: TaxonomyReleaseV1;
}

export type DemoReadFailureCodeV2 =
  | "invalid_query"
  | DemoReadFailureCode;

export type DemoReadOutcomeV2 =
  | { readonly success: true; readonly data: DemoSearchResponseV2 }
  | {
      readonly success: false;
      readonly error: { readonly code: DemoReadFailureCodeV2 };
    };

export type DemoCatalogReadFailureCodeV2 = "read_unavailable" | "cancelled";

export type DemoCatalogReadOutcomeV2 =
  | { readonly success: true; readonly data: DemoCatalogResponseV2 }
  | {
      readonly success: false;
      readonly error: { readonly code: DemoCatalogReadFailureCodeV2 };
    };

export interface DemoReadPortV2 {
  catalog(context: DemoReadContext): Promise<DemoCatalogReadOutcomeV2>;
  search(
    query: DemoSearchQueryV2,
    context: DemoReadContext,
  ): Promise<DemoReadOutcomeV2>;
  getListing(
    listingId: ListingId,
    context: DemoReadContext,
  ): Promise<DemoReadOutcomeV2>;
}
