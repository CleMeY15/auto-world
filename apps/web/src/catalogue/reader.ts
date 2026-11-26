import http from "node:http";
import { privateCatalogEnabled } from "./mode.ts";
import { numericFilterLimits, type NumericFilter } from "./filters.ts";

type Query = Readonly<Record<string, string | string[] | undefined>>;
const numericFilters = Object.keys(numericFilterLimits) as NumericFilter[];
export type PageWindow = {
  readonly after?: string;
  readonly limit: number;
  readonly q?: string;
  readonly brand?: string;
} & Readonly<Partial<Record<NumericFilter, number>>>;

function isBrandLabel(value: unknown): value is string {
  return typeof value === "string" && /^[\p{L}\p{N}][\p{L}\p{N} .&-]{0,49}$/u.test(value);
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
const idPattern = /^[1-9][0-9]{0,19}$/u;
export function isListingId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}
export const maxQueryLength = 80;
export function pageWindow(query: Query): PageWindow | null {
  const allowed = ["after", "limit", "q", "brand", ...numericFilters];
  if (Object.keys(query).some(key => !allowed.includes(key))) return null;
  const after = query.after;
  const limit = query.limit ?? "20";
  const rawQuery = query.q ?? "";
  if (typeof rawQuery !== "string" || [...rawQuery].length > maxQueryLength || /\p{Cc}/u.test(rawQuery)) return null;
  const q = rawQuery.trim();
  if (after !== undefined && !isListingId(after)) return null;
  if (typeof limit !== "string" || !/^(?:[1-9][0-9]?|100)$/u.test(limit)) return null;
  const brand = query.brand;
  if (brand !== undefined && brand !== "" && !isBrandLabel(brand)) return null;
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
  if (bounds.priceMin !== undefined && bounds.priceMax !== undefined && bounds.priceMin > bounds.priceMax) return null;
  if (bounds.yearMin !== undefined && bounds.yearMax !== undefined && bounds.yearMin > bounds.yearMax) return null;
  return { after, limit: Number(limit), ...(q ? { q } : {}), ...(brand ? { brand } : {}), ...bounds };
}
function windowQuery(window: PageWindow) {
  const query = new URLSearchParams();
  if (window.q) query.set("q", window.q);
  if (window.after) query.set("after", window.after);
  if (window.limit !== 20) query.set("limit", String(window.limit));
  if (window.brand) query.set("brand", window.brand);
  for (const key of numericFilters) {
    if (window[key] !== undefined) query.set(key, String(window[key]));
  }
  return query;
}
export function windowPath(window: PageWindow, id?: string) {
  const query = windowQuery(window);
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
    km: value.mileage_km, photos: value.images };
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
export async function fetchList(window: PageWindow) {
  const query = windowQuery(window);
  query.set("limit", String(window.limit));
  const page = await fetchReader(`/internal/catalog?${query}`);
  if (!object(page) || page.dataset !== "autoworld/leboncoin" || !Array.isArray(page.items) || page.items.length > window.limit
    || !Array.isArray(page.brands) || page.brands.length > 256 || !page.brands.every(isBrandLabel)) {
    throw new Error("catalog_page_invalid");
  }
  const items = page.items.map(readPublication);
  let previous = window.after ?? "";
  for (const item of items) {
    if (item.id <= previous) throw new Error("catalog_page_order_invalid");
    previous = item.id;
  }
  if (page.next_cursor !== null && (!isListingId(page.next_cursor) || page.next_cursor !== items.at(-1)?.id)) {
    throw new Error("catalog_cursor_invalid");
  }
  return { dataset: page.dataset, items, next: page.next_cursor, brands: page.brands };
}
export async function fetchDetail(id: string) {
  if (!isListingId(id)) throw new Error("catalog_id_invalid");
  const payload = await fetchReader(`/internal/catalog/${id}`);
  if (payload === undefined) return null;
  const item = readPublication(payload);
  if (item.id !== id) throw new Error("catalog_id_mismatch");
  return item;
}
