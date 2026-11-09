import type { DemoCatalogResponseV2 } from "@auto-world/demo-search-contract";

import type { DemoFilterInputV2 } from "./model";
import {
  parseSavedSearchCriteria,
  savedSearchToFilterInput,
} from "./saved-searches";

export type SearchCriterion =
  | "text"
  | "makeId"
  | "modelId"
  | "firstRegistrationYear"
  | "priceMaxMinor"
  | "mileageMaxKm";

const searchCriteria = new Set<SearchCriterion>([
  "text",
  "makeId",
  "modelId",
  "firstRegistrationYear",
  "priceMaxMinor",
  "mileageMaxKm",
]);

export function removeSearchCriterion(
  criteria: unknown,
  criterion: SearchCriterion,
  catalog?: DemoCatalogResponseV2,
): DemoFilterInputV2 | undefined {
  if (!searchCriteria.has(criterion)) return undefined;
  const parsed = parseSavedSearchCriteria(criteria);
  if (parsed === undefined || !Object.hasOwn(parsed.query, criterion)) return undefined;

  const query: Record<string, unknown> = { ...parsed.query };
  delete query[criterion];

  const removesIdentity = criterion === "makeId";
  if (removesIdentity) delete query.modelId;
  const candidate = parseSavedSearchCriteria({
    query,
    ...(removesIdentity ? {} : parsed.binding === undefined ? {} : { binding: parsed.binding }),
  });
  if (candidate === undefined) return undefined;
  return savedSearchToFilterInput(candidate, catalog);
}
