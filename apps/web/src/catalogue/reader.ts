import { isListingId } from "./listing-id.ts";
export { isListingId } from "./listing-id.ts";
import http from "node:http";
import { privateCatalogEnabled } from "./mode.ts";
import { sortLabels, type CatalogSort, flagKeys, numericFilterLimits, optionKeys, type FilterOptions, type FlagKey, type NumericFilter, type OptionKey } from "./filters.ts";

type Query = Readonly<Record<string, string | string[] | undefined>>;
const numericFilters = Object.keys(numericFilterLimits) as NumericFilter[];
const textFilters = ["model", ...optionKeys] as const;
export type PageWindow = {
  readonly html?: 1;
  readonly after?: string;
  readonly trail?: readonly string[];
  readonly sort?: CatalogSort;
  readonly limit: number;
  readonly q?: string;
  readonly brand?: string;
} & Readonly<Partial<Record<NumericFilter, number> & Record<FlagKey, 1> & Record<"model" | OptionKey, string>>>;

function isBrandLabel(value: unknown): value is string {
  return typeof value === "string" && /^[\p{L}\p{N}][\p{L}\p{N} .&-]{0,49}$/u.test(value);
}
function isFilterLabel(value: unknown): value is string {
  return typeof value === "string" && /^[\p{L}\p{N}][\p{L}\p{N} .&!+’'(),/-]{0,49}$/u.test(value);
}
export interface Publication {
  id: string;
  label: string;
  sourceUrl: string;
  observedAt: string;
  dateKind: "source_capture" | "file_export";
  year: number | null;
  price: number | null;
  km: number | null;
  photos: readonly string[];
  features: Readonly<Partial<Record<OptionKey, string>>>;
  doors: number | null;
  seats: number | null;
  firstOwner: boolean | null;
  inspectionValid: boolean | null;
  serviceBook: boolean | null;
}
const readerSocket = "/run/aw-private-catalog/reader.sock";
const maxResponseBytes = 8 * 1024 * 1024;
const photoPrefix = "https://img.leboncoin.fr/api/v1/lbcpb1/images/";
const hashPhoto = /^(?:[0-9a-f]{2}\/){3}[0-9a-f]{40}\.jpg$/u;
const prefixedPhoto = /^gh\/(?:[0-9a-f]{2}\/){2}gh[0-9a-f]{38}\.jpg$/u;
const uuidPhoto = /^(?:[0-9a-f]{2}\/){3}[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
function isPhotoReference(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(photoPrefix) || /\s/u.test(value)) return false;
  const [path, query, extra] = value.slice(photoPrefix.length).split("?");
  if (!path || extra !== undefined || (query !== undefined && !/^rule=[A-Za-z0-9_-]{1,100}$/u.test(query))) return false;
  return hashPhoto.test(path) || prefixedPhoto.test(path) || uuidPhoto.test(path);
}
function validCursor(value: unknown, sort: CatalogSort): value is string {
  if (sort === "default") return isListingId(value);
  if (typeof value !== "string") return false;
  const [mode, key, id, ...extra] = value.split("~");
  return mode === sort && key !== undefined && /^(?:x|-?[0-9]{1,20})$/u.test(key)
    && isListingId(id) && !extra.length;
}
const maxPreviousPages = 8;
export function nextWindow(window: PageWindow, after: string): PageWindow {
  const starts = [...(window.trail ?? []), window.after ?? "first"];
  // A changed result set can revisit a cursor already present in the URL.
  const trail = starts.slice(starts.lastIndexOf(after) + 1).slice(-maxPreviousPages);
  return { ...window, after, trail };
}
export function previousWindow(window: PageWindow): PageWindow | null {
  const previous = window.trail?.at(-1);
  if (!previous) return null;
  return { ...window, after: previous === "first" ? undefined : previous, trail: window.trail?.slice(0, -1) };
}
export const maxQueryLength = 80;
export function pageWindow(query: Query): PageWindow | null {
  const allowed = ["after", "trail", "html", "sort", "limit", "q", "brand", ...textFilters, ...flagKeys, ...numericFilters];
  if (Object.keys(query).some(key => !allowed.includes(key))) return null;
  if (query.html !== undefined && query.html !== "1") return null;
  const after = query.after;
  const limit = query.limit ?? "20";
  const rawQuery = query.q ?? "";
  if (typeof rawQuery !== "string" || [...rawQuery].length > maxQueryLength || /\p{Cc}/u.test(rawQuery)) return null;
  const q = rawQuery.trim();
  const sort = query.sort ?? "default";
  if (typeof sort !== "string" || !Object.hasOwn(sortLabels, sort)) return null;
  const order = sort as CatalogSort;
  if (after !== undefined && !validCursor(after, order)) return null;
  let trail: string[] | undefined;
  if (query.trail !== undefined) {
    if (!after || typeof query.trail !== "string" || query.trail.length > maxPreviousPages * 64) return null;
    trail = query.trail.split(",");
    if (trail.length > maxPreviousPages || new Set([...trail, after]).size !== trail.length + 1
      || !trail.every((cursor, index) => index === 0 && cursor === "first" || validCursor(cursor, order))) return null;
  }
  if (typeof limit !== "string" || !/^(?:[1-9][0-9]?|100)$/u.test(limit)) return null;
  const brand = query.brand;
  if (brand !== undefined && brand !== "" && !isBrandLabel(brand)) return null;
  const flags: Partial<Record<FlagKey, 1>> = {};
  for (const key of flagKeys) {
    const raw = query[key];
    if (raw === undefined || raw === "") continue;
    if (raw !== "1") return null;
    flags[key] = 1;
  }
  const labels: Partial<Record<"model" | OptionKey, string>> = {};
  for (const key of textFilters) {
    const raw = query[key];
    if (raw === undefined || raw === "") continue;
    if (!isFilterLabel(raw)) return null;
    if (key === "model" && !/^[\p{L}\p{N} .&!+-]+$/u.test(raw)) return null;
    labels[key] = raw;
  }
  if (labels.model && !brand) return null;
  const bounds: Partial<Record<NumericFilter, number>> = {};
  for (const key of numericFilters) {
    const raw = query[key];
    if (raw === undefined || raw === "") continue;
    if (typeof raw !== "string" || !/^[0-9]{1,16}$/u.test(raw)) return null;
    const value = Number(raw);
    const [min, max] = numericFilterLimits[key];
    if (value < min || value > max) return null;
    bounds[key] = value;
  }
  for (const [min, max] of [["priceMin","priceMax"], ["yearMin","yearMax"], ["kmMin","kmMax"], ["seatsMin","seatsMax"]] as const) {
    const lower = bounds[min], upper = bounds[max];
    if (lower !== undefined && upper !== undefined && lower > upper) return null;
  }
  return { after, ...(query.html ? { html: 1 } : {}), ...(trail ? { trail } : {}), ...(order === "default" ? {} : { sort: order }), limit: Number(limit), ...(q ? { q } : {}), ...(brand ? { brand } : {}), ...labels, ...flags, ...bounds };
}
function windowQuery(window: PageWindow) {
  const query = new URLSearchParams();
  if (window.sort && window.sort !== "default") query.set("sort", window.sort);
  if (window.q) query.set("q", window.q);
  if (window.after) query.set("after", window.after);
  if (window.limit !== 20) query.set("limit", String(window.limit));
  if (window.brand) query.set("brand", window.brand);
  for (const key of [...textFilters, ...flagKeys, ...numericFilters]) {
    if (window[key] !== undefined) query.set(key, String(window[key]));
  }
  return query;
}
export function windowPath(window: PageWindow, id?: string) {
  const query = windowQuery(window);
  if (window.html) query.set("html", "1");
  if (window.after && window.trail?.length) query.set("trail", window.trail.join(","));
  return `/catalogue${id ? `/${id}` : ""}${query.size ? `?${query}` : ""}`;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function numberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function labelOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string" && value.length > 0 && value.length <= 100;
}
function featureLabels(row: Record<string, unknown>) {
  const features: Partial<Record<OptionKey, string>> = {};
  for (const key of optionKeys) {
    const value = row[key];
    if (value == null) continue;
    if (!isFilterLabel(value)) throw new Error("catalog_feature_invalid");
    features[key] = value;
  }
  return features;
}
function countOrNull(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 9) throw new Error("catalog_feature_invalid");
  return value;
}
function flagOrNull(value: unknown) {
  if (value == null) return null;
  if (typeof value !== "boolean") throw new Error("catalog_feature_invalid");
  return value;
}
export function readPublication(value: unknown): Publication {
  if (!object(value) || !isListingId(value.source_listing_id)
    || value.source_label !== "Leboncoin"
    || value.source_url !== `https://www.leboncoin.fr/ad/voitures/${value.source_listing_id}`
    || typeof value.observed_at !== "string" || !Number.isFinite(Date.parse(value.observed_at))
    || (value.observed_at_kind !== undefined && value.observed_at_kind !== "source_capture" && value.observed_at_kind !== "file_export")
    || !labelOrNull(value.brand) || !labelOrNull(value.model)
    || !numberOrNull(value.price_amount_minor) || value.price_currency !== (value.price_amount_minor === null ? null : "EUR")
    || !numberOrNull(value.year) || !numberOrNull(value.mileage_km)
    || !Array.isArray(value.images) || value.images.length > 200
    || !value.images.every(isPhotoReference)) {
    throw new Error("catalog_publication_invalid");
  }
  return { id: value.source_listing_id, label: [value.brand, value.model].filter(Boolean).join(" ") || `Annonce ${value.source_listing_id}`,
    sourceUrl: value.source_url, observedAt: value.observed_at, dateKind: value.observed_at_kind ?? "source_capture",
    year: value.year, price: value.price_amount_minor,
    km: value.mileage_km, photos: value.images, features: featureLabels(value),
    doors: countOrNull(value.doors), seats: countOrNull(value.seats), firstOwner: flagOrNull(value.firstOwner),
    inspectionValid: flagOrNull(value.inspectionValid), serviceBook: flagOrNull(value.serviceBook) };
}
async function fetchReader(path: string) {
  if (!privateCatalogEnabled()) throw new Error("catalog_disabled");
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http.get({
      socketPath: readerSocket,
      path,
      headers: { Host: "localhost", Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    }, resolve).once("error", reject);
  });
  try {
    if (response.statusCode === 404) return undefined;
    if (response.statusCode !== 200 || !/^application\/json(?:;|$)/iu.test(response.headers["content-type"] ?? "")) {
      throw new Error("catalog_read_failed");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > maxResponseBytes) throw new Error("catalog_response_too_large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    response.destroy();
  }
}
function cursorForLastItem(item: Publication, order: CatalogSort) {
  if (order === "default") return item.id;
  const [field] = order.split("-");
  let value: number | bigint | null;
  if (field === "observed") {
    // Date.parse retains milliseconds; the reader's key also includes the remaining microseconds.
    const fraction = /\.([0-9]+)/u.exec(item.observedAt)?.[1] ?? "";
    value = BigInt(Date.parse(item.observedAt)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
  } else {
    value = field === "km" ? item.km : field === "price" ? item.price : item.year;
  }
  return [order, value ?? "x", item.id].join("~");
}
export async function fetchList(window: PageWindow) {
  const query = windowQuery(window);
  query.set("limit", String(window.limit));
  const page = await fetchReader(`/internal/catalog?${query}`);
  if (!object(page) || page.dataset !== "autoworld/leboncoin" || !Array.isArray(page.items) || page.items.length > window.limit
    || !Array.isArray(page.brands) || page.brands.length > 256 || !page.brands.every(isBrandLabel)) {
    throw new Error("catalog_page_invalid");
  }
  const modelMap = page.modelsByBrand;
  const options = page.filterOptions;
  if (!object(modelMap) || Object.keys(modelMap).length !== page.brands.length || !object(options)
    || !page.brands.every(brand => Object.hasOwn(modelMap, brand) && validChoices(modelMap[brand]))
    || !optionKeys.every(key => validChoices(options[key]))) throw new Error("catalog_filters_invalid");
  const items = page.items.map(readPublication);
  const order = window.sort ?? "default";
  const ids = new Set<string>();
  let previous = window.after ?? "";
  for (const item of items) {
    if (ids.has(item.id) || (order === "default" && item.id <= previous)) throw new Error("catalog_page_order_invalid");
    ids.add(item.id);
    previous = item.id;
  }
  const last = items.at(-1);
  if (page.next_cursor !== null && (!last || !validCursor(page.next_cursor, order) || page.next_cursor !== cursorForLastItem(last, order))) {
    throw new Error("catalog_cursor_invalid");
  }
  return { dataset: page.dataset, items, next: page.next_cursor, brands: page.brands,
    modelsByBrand: modelMap as Readonly<Record<string, readonly string[]>>, filterOptions: options as FilterOptions };
}
function validChoices(values: unknown): values is string[] {
  return Array.isArray(values) && values.length <= 256 && values.every(isFilterLabel) && new Set(values).size === values.length;
}
export async function fetchDetail(id: string) {
  if (!isListingId(id)) throw new Error("catalog_id_invalid");
  const payload = await fetchReader(`/internal/catalog/${id}`);
  if (payload === undefined) return null;
  const item = readPublication(payload);
  if (item.id !== id) throw new Error("catalog_id_mismatch");
  return item;
}
