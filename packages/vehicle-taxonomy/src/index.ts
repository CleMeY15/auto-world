export const workspaceBoundary = {
  name: "@auto-world/vehicle-taxonomy",
  kind: "package",
  status: "active",
} as const;

export {
  findTaxonomyMake,
  findTaxonomyModel,
  parseMakeId,
  parseModelId,
  parseTaxonomyAttributionId,
  parseTaxonomyCatalogId,
  parseTaxonomyEntryReference,
  parseTaxonomyRelease,
  parseTaxonomyReleaseId,
  parseTaxonomyReleaseReference,
  resolveTaxonomyEntryReference,
} from "./parsers.js";

export type {
  MakeId,
  ModelId,
  TaxonomyAttributionId,
  TaxonomyAttributionV1,
  TaxonomyCatalogId,
  TaxonomyEntryReferenceV1,
  TaxonomyEntryResolutionResult,
  TaxonomyMakeLookupResult,
  TaxonomyMakeV1,
  TaxonomyModelLookupResult,
  TaxonomyModelV1,
  TaxonomyNameV1,
  TaxonomyReleaseId,
  TaxonomyReleaseReferenceV1,
  TaxonomyReleaseV1,
} from "./types.js";
