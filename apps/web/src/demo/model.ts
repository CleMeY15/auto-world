import { parseDemoSearchQuery, type DemoSearchQueryV1, type DemoSearchSort } from "@auto-world/demo-search-contract";

export interface DemoFilterInput {
  readonly priceMaxEUR: string;
  readonly mileageMaxKm: string;
  readonly sort: DemoSearchSort;
  readonly text: string;
}

export type FilterInputResult =
  | { readonly ok: true; readonly query: DemoSearchQueryV1 }
  | { readonly ok: false; readonly code: "invalid_filter" | "unsupported_text"; readonly field: "priceMaxEUR" | "mileageMaxKm" | "sort" | "text" };

function parseDecimal(value: string, decimals: number): number | undefined {
  const normalized = value.trim();
  if (normalized === "") return undefined;
  if (!/^(?:0|[1-9][0-9]*)(?:[.,][0-9]{1,2})?$/u.test(normalized)) return Number.NaN;
  const [whole = "0", fraction = ""] = normalized.replace(",", ".").split(".");
  const scale = 10 ** decimals;
  const result = Number(whole) * scale + Number(fraction.padEnd(decimals, "0"));
  return Number.isSafeInteger(result) ? result : Number.NaN;
}

export function parseFilterInput(input: DemoFilterInput): FilterInputResult {
  if (input.text.trim() !== "") return { ok: false, code: "unsupported_text", field: "text" };
  const priceMaxMinor = parseDecimal(input.priceMaxEUR, 2);
  if (Number.isNaN(priceMaxMinor)) return { ok: false, code: "invalid_filter", field: "priceMaxEUR" };
  const mileage = input.mileageMaxKm.trim();
  const mileageMaxKm = mileage === "" ? undefined : Number(mileage.replace(",", "."));
  if (mileageMaxKm !== undefined && (!/^(?:0|[1-9][0-9]*)(?:[.,][0-9]+)?$/u.test(mileage) || !Number.isFinite(mileageMaxKm) || mileageMaxKm < 0 || mileageMaxKm > Number.MAX_SAFE_INTEGER)) {
    return { ok: false, code: "invalid_filter", field: "mileageMaxKm" };
  }
  const candidate = {
    schemaVersion: 1 as const,
    sort: input.sort,
    ...(priceMaxMinor === undefined ? {} : { priceMaxMinor }),
    ...(mileageMaxKm === undefined ? {} : { mileageMaxKm }),
  };
  const parsed = parseDemoSearchQuery(candidate);
  return parsed.success ? { ok: true, query: parsed.data } : { ok: false, code: "invalid_filter", field: "sort" };
}
