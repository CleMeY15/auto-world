declare const taxonomyCatalogIdBrand: unique symbol;
declare const taxonomyReleaseIdBrand: unique symbol;
declare const taxonomyAttributionIdBrand: unique symbol;
declare const makeIdBrand: unique symbol;
declare const modelIdBrand: unique symbol;

export type TaxonomyCatalogId = string & { readonly [taxonomyCatalogIdBrand]: true };
export type TaxonomyReleaseId = string & { readonly [taxonomyReleaseIdBrand]: true };
export type TaxonomyAttributionId = string & { readonly [taxonomyAttributionIdBrand]: true };
export type MakeId = string & { readonly [makeIdBrand]: true };
export type ModelId = string & { readonly [modelIdBrand]: true };

export interface TaxonomyReleaseReferenceV1 {
  readonly catalogId: TaxonomyCatalogId;
  readonly releaseId: TaxonomyReleaseId;
  readonly revision: number;
}

export interface TaxonomyNameV1 {
  readonly value: string;
  readonly attributionId: TaxonomyAttributionId;
}

export interface TaxonomyAttributionV1 {
  readonly attributionId: TaxonomyAttributionId;
  readonly kind: "synthetic_fixture";
  readonly fixtureRef: string;
}

export interface TaxonomyMakeV1 {
  readonly makeId: MakeId;
  readonly primaryName: TaxonomyNameV1;
  readonly aliases: readonly TaxonomyNameV1[];
}

export interface TaxonomyModelV1 {
  readonly modelId: ModelId;
  readonly makeId: MakeId;
  readonly primaryName: TaxonomyNameV1;
  readonly aliases: readonly TaxonomyNameV1[];
}

export interface TaxonomyReleaseV1 extends TaxonomyReleaseReferenceV1 {
  readonly schemaVersion: 1;
  readonly releasedAt: string;
  readonly dataMode: "synthetic";
  readonly attributions: readonly TaxonomyAttributionV1[];
  readonly makes: readonly TaxonomyMakeV1[];
  readonly models: readonly TaxonomyModelV1[];
}

export type TaxonomyEntryReferenceV1 =
  | {
      readonly kind: "make";
      readonly release: TaxonomyReleaseReferenceV1;
      readonly makeId: MakeId;
    }
  | {
      readonly kind: "model";
      readonly release: TaxonomyReleaseReferenceV1;
      readonly modelId: ModelId;
    };

export type TaxonomyMakeLookupResult =
  | { readonly status: "found"; readonly data: TaxonomyMakeV1 }
  | { readonly status: "not_found" };

export type TaxonomyModelLookupResult =
  | { readonly status: "found"; readonly data: TaxonomyModelV1 }
  | { readonly status: "not_found" };

export type TaxonomyEntryResolutionResult =
  | { readonly status: "found"; readonly kind: "make"; readonly data: TaxonomyMakeV1 }
  | { readonly status: "found"; readonly kind: "model"; readonly data: TaxonomyModelV1 }
  | { readonly status: "not_found" }
  | { readonly status: "release_mismatch" };

