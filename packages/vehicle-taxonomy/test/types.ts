import type {
  ListingId,
  ObservationId,
  SourceId,
  VehicleEntityId,
} from "@auto-world/vehicle-schema";
import type {
  MakeId,
  ModelId,
  TaxonomyAttributionId,
  TaxonomyCatalogId,
  TaxonomyEntryReferenceV1,
  TaxonomyEntryResolutionResult,
  TaxonomyMakeLookupResult,
  TaxonomyMakeV1,
  TaxonomyModelLookupResult,
  TaxonomyReleaseId,
  TaxonomyReleaseV1,
} from "../src/index.js";

declare const catalogId: TaxonomyCatalogId;
declare const releaseId: TaxonomyReleaseId;
declare const attributionId: TaxonomyAttributionId;
declare const makeId: MakeId;
declare const modelId: ModelId;
declare const vehicleId: VehicleEntityId;
declare const listingId: ListingId;

type IsAssignable<From, To> = From extends To ? true : false;
type AssertFalse<Value extends false> = Value;
type TaxonomyIds = TaxonomyCatalogId | TaxonomyReleaseId | TaxonomyAttributionId | MakeId | ModelId;
type VehicleIds = VehicleEntityId | ListingId | ObservationId | SourceId;
type CatalogIsolation = AssertFalse<IsAssignable<TaxonomyCatalogId, TaxonomyReleaseId | TaxonomyAttributionId | MakeId | ModelId>>;
type ReleaseIsolation = AssertFalse<IsAssignable<TaxonomyReleaseId, TaxonomyCatalogId | TaxonomyAttributionId | MakeId | ModelId>>;
type AttributionIsolation = AssertFalse<IsAssignable<TaxonomyAttributionId, TaxonomyCatalogId | TaxonomyReleaseId | MakeId | ModelId>>;
type MakeIsolation = AssertFalse<IsAssignable<MakeId, TaxonomyCatalogId | TaxonomyReleaseId | TaxonomyAttributionId | ModelId>>;
type ModelIsolation = AssertFalse<IsAssignable<ModelId, TaxonomyCatalogId | TaxonomyReleaseId | TaxonomyAttributionId | MakeId>>;
type TaxonomyToVehicleIsolation = AssertFalse<IsAssignable<TaxonomyIds, VehicleIds>>;
type VehicleToTaxonomyIsolation = AssertFalse<IsAssignable<VehicleIds, TaxonomyIds>>;

// @ts-expect-error nominal ID domains are not interchangeable
const badCatalog: TaxonomyCatalogId = releaseId;
// @ts-expect-error nominal ID domains are not interchangeable
const badRelease: TaxonomyReleaseId = attributionId;
// @ts-expect-error nominal ID domains are not interchangeable
const badMake: MakeId = modelId;
// @ts-expect-error vehicle schema IDs are not taxonomy IDs
const badVehicle: MakeId = vehicleId;
// @ts-expect-error vehicle schema IDs are not taxonomy IDs
const badListing: ModelId = listingId;
// @ts-expect-error taxonomy IDs are not vehicle schema IDs
const badObservation: ObservationId = makeId;
// @ts-expect-error taxonomy IDs are not vehicle schema IDs
const badSource: SourceId = catalogId;

declare const release: TaxonomyReleaseV1;
// @ts-expect-error release fields are readonly
release.revision = 2;
// @ts-expect-error release arrays are readonly
release.models.push();
// @ts-expect-error nested name fields are readonly
release.makes[0].primaryName.value = "Changed";
// @ts-expect-error alias arrays are readonly
release.makes[0].aliases.push();
// @ts-expect-error unsupported generation field is absent
void release.makes[0].generation;

const makeReference: TaxonomyEntryReferenceV1 = {
  kind: "make",
  release: { catalogId, releaseId, revision: 1 },
  makeId,
};
// @ts-expect-error make references cannot carry model IDs
const badReference: TaxonomyEntryReferenceV1 = { kind: "make", release: makeReference.release, makeId: modelId };

declare const makeLookup: TaxonomyMakeLookupResult;
if (makeLookup.status === "found") {
  const make: TaxonomyMakeV1 = makeLookup.data;
  void make;
} else {
  // @ts-expect-error not_found has no data
  void makeLookup.data;
}

declare const modelLookup: TaxonomyModelLookupResult;
if (modelLookup.status === "not_found") {
  // @ts-expect-error not_found has no kind
  void modelLookup.kind;
}

declare const resolution: TaxonomyEntryResolutionResult;
if (resolution.status === "found" && resolution.kind === "make") {
  const make: TaxonomyMakeV1 = resolution.data;
  void make;
} else if (resolution.status !== "found") {
  // @ts-expect-error non-found outcomes have no data
  void resolution.data;
}

void [badCatalog, badRelease, badMake, badVehicle, badListing, badObservation, badSource, badReference];
type IsolationProofs = [
  CatalogIsolation,
  ReleaseIsolation,
  AttributionIsolation,
  MakeIsolation,
  ModelIsolation,
  TaxonomyToVehicleIsolation,
  VehicleToTaxonomyIsolation,
];
declare const isolationProofs: IsolationProofs;
void isolationProofs;
