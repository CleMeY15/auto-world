export const workspaceBoundary = {
  name: "@auto-world/demo-search-contract",
  kind: "package",
  status: "active",
} as const;

export {
  DEMO_FRESHNESS_MS,
  DEMO_PAGE_SIZE,
  parseDemoResult,
  parseDemoSearchQuery,
  parseDemoSearchResponse,
} from "./parsers.js";
export {
  parseDemoCatalogResponseV2,
  parseDemoResultV2,
  parseDemoSearchQueryV2,
  parseDemoSearchResponseV2,
} from "./parsers-v2.js";

export type {
  MakeId,
  ModelId,
  TaxonomyAttributionId,
  TaxonomyAttributionV1,
  TaxonomyCatalogId,
  TaxonomyMakeV1,
  TaxonomyModelV1,
  TaxonomyNameV1,
  TaxonomyReleaseId,
  TaxonomyReleaseReferenceV1,
  TaxonomyReleaseV1,
} from "@auto-world/vehicle-taxonomy";

export type {
  DemoEvidence,
  DemoMileageField,
  DemoMileageValue,
  DemoPriceField,
  DemoPriceValue,
  DemoReadContext,
  DemoReadFailureCode,
  DemoReadOutcome,
  DemoReadPort,
  DemoReadPortV2,
  DemoResultV1,
  DemoResultV2,
  DemoCatalogReadFailureCodeV2,
  DemoCatalogReadOutcomeV2,
  DemoCatalogResponseV2,
  DemoDescriptionAttributionV2,
  DemoDescriptionEvidenceV2,
  DemoDescriptionFieldV2,
  DemoDescriptionValueV2,
  DemoReadFailureCodeV2,
  DemoReadOutcomeV2,
  DemoSearchQueryV1,
  DemoSearchQueryV2,
  DemoSearchResponseV1,
  DemoSearchResponseV2,
  DemoSearchSort,
} from "./types.js";
