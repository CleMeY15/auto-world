import type {
  DemoCatalogResponseV2,
  DemoDescriptionValueV2,
  DemoResultV2,
  DemoSearchResponseV2,
} from "@auto-world/demo-search-contract";
import { resolveDescription } from "./catalog.ts";

export const COMPARISON_LIMIT = 3;

export interface ComparisonEntry {
  readonly result: DemoResultV2;
  readonly index: number;
}

export type ComparisonRow = {
  readonly field: "availability" | "make" | "model" | "firstRegistrationYear" | "price" | "mileage";
  readonly status: "same" | "different" | "incomplete" | "incompatible" | "insufficient";
};

export function selectComparisonEntries(
  response: DemoSearchResponseV2 | undefined,
  ids: readonly string[],
): readonly ComparisonEntry[] {
  if (response === undefined) return Object.freeze([]);
  const selected = new Set<string>();
  const entries: ComparisonEntry[] = [];
  for (const listingId of ids) {
    if (selected.has(listingId)) continue;
    const index = response.results.findIndex((result) => result.listingId === listingId);
    if (index < 0) continue;
    selected.add(listingId);
    entries.push(Object.freeze({ result: response.results[index]!, index }));
    if (entries.length === COMPARISON_LIMIT) break;
  }
  return Object.freeze(entries);
}

export function toggleComparisonSelection(
  ids: readonly string[],
  response: DemoSearchResponseV2 | undefined,
  listingId: string,
): readonly string[] {
  const current = selectComparisonEntries(response, ids).map((entry) => entry.result.listingId as string);
  const selectedIndex = current.indexOf(listingId);
  if (selectedIndex >= 0) return Object.freeze(current.filter((_, index) => index !== selectedIndex));
  if (current.length === COMPARISON_LIMIT || response?.results.some((result) => result.listingId === listingId) !== true) {
    return Object.freeze(current);
  }
  return Object.freeze([...current, listingId]);
}

function knownDescriptions(
  entries: readonly ComparisonEntry[],
  catalog: DemoCatalogResponseV2 | undefined,
): readonly (DemoDescriptionValueV2 | undefined)[] {
  return entries.map(({ result }) => {
    if (result.description.status !== "authored_synthetic") return undefined;
    return resolveDescription(catalog, result.description.value) === undefined ? undefined : result.description.value;
  });
}

function exactStatus<T>(values: readonly (T | undefined)[]): ComparisonRow["status"] {
  if (values.length < 2) return "insufficient";
  if (values.some((value) => value === undefined)) return "incomplete";
  const first = values[0] as T;
  return values.every((value) => value === first) ? "same" : "different";
}

function measuredStatus<T extends { readonly unit: string; readonly amount: number }>(
  values: readonly (T | undefined)[],
): ComparisonRow["status"] {
  if (values.length < 2) return "insufficient";
  if (values.some((value) => value === undefined)) return "incomplete";
  const known = values as readonly T[];
  const first = known[0]!;
  if (known.some((value) => value.unit !== first.unit)) return "incompatible";
  return known.every((value) => value.amount === first.amount) ? "same" : "different";
}

function priceStatus(entries: readonly ComparisonEntry[]): ComparisonRow["status"] {
  if (entries.length < 2) return "insufficient";
  const values = entries.map(({ result }) => result.price.status === "observed" ? result.price.value : undefined);
  if (values.some((value) => value === undefined)) return "incomplete";
  const known = values as { readonly currency: string; readonly amountMinor: number }[];
  const first = known[0]!;
  if (known.some((value) => value.currency !== first.currency)) return "incompatible";
  return known.every((value) => value.amountMinor === first.amountMinor) ? "same" : "different";
}

export function comparisonRows(
  entries: readonly ComparisonEntry[],
  catalog: DemoCatalogResponseV2 | undefined,
): readonly ComparisonRow[] {
  const descriptions = knownDescriptions(entries, catalog);
  const rows: ComparisonRow[] = [
    { field: "availability", status: exactStatus(entries.map(({ result }) => result.availability)) },
    { field: "price", status: priceStatus(entries) },
    {
      field: "mileage",
      status: measuredStatus(entries.map(({ result }) => result.mileage.status === "observed" ? result.mileage.value : undefined)),
    },
    { field: "make", status: exactStatus(descriptions.map((value) => value?.makeId)) },
    { field: "model", status: exactStatus(descriptions.map((value) => value?.modelId)) },
    { field: "firstRegistrationYear", status: exactStatus(descriptions.map((value) => value?.firstRegistrationYear)) },
  ];
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

function hasConflictingTuples(values: readonly (readonly unknown[])[]): boolean {
  return new Set(values.map((value) => JSON.stringify(value))).size > 1;
}

export function comparisonConflicts(result: DemoResultV2): { readonly observations: boolean; readonly descriptions: boolean } {
  const priceValues = result.evidence
    .filter((evidence) => evidence.field === "price")
    .map((evidence) => [evidence.value.amountMinor, evidence.value.currency] as const);
  const mileageValues = result.evidence
    .filter((evidence) => evidence.field === "mileage")
    .map((evidence) => [evidence.value.amount, evidence.value.unit] as const);
  const descriptionValues = result.descriptionEvidence.map(({ value }) => [
    value.release.catalogId,
    value.release.releaseId,
    value.release.revision,
    value.makeId,
    value.modelId,
    value.firstRegistrationYear,
  ] as const);
  return Object.freeze({
    observations: hasConflictingTuples(priceValues) || hasConflictingTuples(mileageValues),
    descriptions: hasConflictingTuples(descriptionValues),
  });
}
