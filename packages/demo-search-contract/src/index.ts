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
  DemoResultV1,
  DemoSearchQueryV1,
  DemoSearchResponseV1,
  DemoSearchSort,
} from "./types.js";
