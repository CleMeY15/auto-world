import {
  parseDemoCatalogResponseV2,
  parseDemoSearchQueryV2,
  parseDemoSearchResponseV2,
  type DemoCatalogResponseV2,
  type DemoSearchQueryV2,
  type DemoSearchResponseV2,
  type TaxonomyReleaseReferenceV1,
} from "@auto-world/demo-search-contract";
import { isKnownMake, isKnownModel } from "./catalog.ts";
import type { DemoFilterInputV2 } from "./model.ts";
import {
  createNamedCollectionEngine,
  normalizeNamedCollectionName,
  ownDataObject,
  type NamedCollectionStorageStatus,
} from "./named-collection-store.ts";
import { parseStrictJson } from "./strict-json.ts";

export const DEMO_SAVED_SEARCHES_KEY = "auto-world.demo.saved-searches.v1";
export const SAVED_SEARCH_LIMIT = 10;
const BYTE_LIMIT = 16_384;

export type SavedSearchStorageStatus = NamedCollectionStorageStatus;
export interface SavedSearchCriteria {
  readonly query: Omit<DemoSearchQueryV2, "cursor">;
  readonly binding?: { readonly fixtureVersion: string; readonly taxonomyRelease: TaxonomyReleaseReferenceV1 };
}
export interface SavedSearch { readonly name: string; readonly criteria: SavedSearchCriteria }
export interface SavedSearchSnapshot { readonly searches: readonly SavedSearch[]; readonly storageStatus: SavedSearchStorageStatus; readonly canUndo: boolean }
export interface SavedSearchStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface SavedSearchStorageEvent { readonly key: string | null; readonly newValue: string | null; readonly storageArea?: SavedSearchStorage | null }
export interface SavedSearchStore {
  getSnapshot(): SavedSearchSnapshot;
  getServerSnapshot(): SavedSearchSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): SavedSearchSnapshot;
  add(name: unknown, criteria: unknown): { readonly ok: true } | { readonly ok: false; readonly reason: "invalid" | "duplicate" | "full" | "readonly" };
  remove(key: string): boolean;
  undo(): SavedSearch | undefined;
  reset(): { readonly ok: true; readonly scope: "persisted" | "session" } | { readonly ok: false };
  reconcileStorageEvent(event: SavedSearchStorageEvent): void;
}

type Decoded = { readonly kind: "valid"; readonly searches: readonly SavedSearch[] } | { readonly kind: "corrupt" } | { readonly kind: "future" };
const emptySearches = Object.freeze([]) as readonly SavedSearch[];
const serverSnapshot: SavedSearchSnapshot = Object.freeze({ searches: emptySearches, storageStatus: "unhydrated", canUndo: false });
const fixturePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const catalogPattern = /^taxcat_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const releasePattern = /^taxrel_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

function matchesFull(pattern: RegExp, value: string): boolean {
  const match = pattern.exec(value);
  return match !== null && match[0].length === value.length;
}

function normalizeNegativeZeroQuery(input: unknown): unknown {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return input;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const output: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string") return input;
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return input;
      output[key] = (key === "priceMaxMinor" || key === "mileageMaxKm") && Object.is(descriptor.value, -0) ? 0 : descriptor.value;
    }
    return output;
  } catch {
    return input;
  }
}

function parseBinding(input: unknown): SavedSearchCriteria["binding"] | undefined {
  const binding = ownDataObject(input, ["fixtureVersion", "taxonomyRelease"]);
  if (binding === undefined || typeof binding.fixtureVersion !== "string" || !matchesFull(fixturePattern, binding.fixtureVersion)) return undefined;
  const release = ownDataObject(binding.taxonomyRelease, ["catalogId", "releaseId", "revision"]);
  if (release === undefined || typeof release.catalogId !== "string" || !matchesFull(catalogPattern, release.catalogId) || typeof release.releaseId !== "string" || !matchesFull(releasePattern, release.releaseId) || !Number.isSafeInteger(release.revision) || (release.revision as number) <= 0) return undefined;
  return Object.freeze({
    fixtureVersion: binding.fixtureVersion,
    taxonomyRelease: Object.freeze({ catalogId: release.catalogId, releaseId: release.releaseId, revision: release.revision }) as TaxonomyReleaseReferenceV1,
  });
}

function canonicalQuery(input: unknown, rejectCursor = true): Omit<DemoSearchQueryV2, "cursor"> | undefined {
  const parsed = parseDemoSearchQueryV2(normalizeNegativeZeroQuery(input));
  if (!parsed.success || (rejectCursor && parsed.data.cursor !== undefined)) return undefined;
  const query = parsed.data;
  return Object.freeze({
    schemaVersion: 2 as const,
    sort: query.sort,
    ...(query.priceMaxMinor === undefined ? {} : { priceMaxMinor: Object.is(query.priceMaxMinor, -0) ? 0 : query.priceMaxMinor }),
    ...(query.mileageMaxKm === undefined ? {} : { mileageMaxKm: Object.is(query.mileageMaxKm, -0) ? 0 : query.mileageMaxKm }),
    ...(query.makeId === undefined ? {} : { makeId: query.makeId }),
    ...(query.modelId === undefined ? {} : { modelId: query.modelId }),
    ...(query.firstRegistrationYear === undefined ? {} : { firstRegistrationYear: query.firstRegistrationYear }),
  });
}

export function parseSavedSearchCriteria(input: unknown): SavedSearchCriteria | undefined {
  let hasBinding: boolean;
  try { hasBinding = typeof input === "object" && input !== null && Object.hasOwn(input, "binding"); }
  catch { return undefined; }
  const value = ownDataObject(input, hasBinding ? ["query", "binding"] : ["query"]);
  if (value === undefined) return undefined;
  const query = canonicalQuery(value.query);
  if (query === undefined) return undefined;
  const hasIdentity = query.makeId !== undefined || query.modelId !== undefined;
  const binding = Object.hasOwn(value, "binding") ? parseBinding(value.binding) : undefined;
  if (hasBinding && binding === undefined) return undefined;
  if (hasIdentity !== (binding !== undefined)) return undefined;
  return Object.freeze({ query, ...(binding === undefined ? {} : { binding }) });
}

function cloneSearch(search: SavedSearch): SavedSearch {
  return Object.freeze({ name: search.name, criteria: parseSavedSearchCriteria(search.criteria)! });
}

function canonicalEntry(search: SavedSearch): object {
  return { name: search.name, criteria: search.criteria };
}

function encode(searches: readonly SavedSearch[]): string | undefined {
  const value = JSON.stringify({ schemaVersion: 1, searches: searches.map(canonicalEntry) });
  return new TextEncoder().encode(value).byteLength <= BYTE_LIMIT ? value : undefined;
}

function decode(source: string): Decoded {
  if (new TextEncoder().encode(source).byteLength > BYTE_LIMIT) return { kind: "corrupt" };
  let input: unknown;
  try { input = parseStrictJson(source); } catch { return { kind: "corrupt" }; }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { kind: "corrupt" };
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1) return typeof value.schemaVersion === "number" && value.schemaVersion > 1 ? { kind: "future" } : { kind: "corrupt" };
  if (Object.keys(value).sort().join() !== "schemaVersion,searches" || !Array.isArray(value.searches) || value.searches.length > SAVED_SEARCH_LIMIT) return { kind: "corrupt" };
  const searches: SavedSearch[] = [];
  const keys = new Set<string>();
  for (const item of value.searches) {
    const entry = ownDataObject(item, ["name", "criteria"]);
    if (entry === undefined) return { kind: "corrupt" };
    const name = normalizeNamedCollectionName(entry.name, true);
    const criteria = parseSavedSearchCriteria(entry.criteria);
    if (name === undefined || criteria === undefined) return { kind: "corrupt" };
    const key = getSavedSearchKey(criteria);
    if (keys.has(key)) return { kind: "corrupt" };
    keys.add(key);
    searches.push(Object.freeze({ name, criteria }));
  }
  return { kind: "valid", searches: Object.freeze(searches) };
}

export function getSavedSearchKey(criteria: SavedSearchCriteria): string {
  const parsed = parseSavedSearchCriteria(criteria);
  if (parsed === undefined) return "";
  return JSON.stringify(parsed);
}

export function captureSavedSearchCriteria(query: DemoSearchQueryV2, response: DemoSearchResponseV2, receivedAt: string = new Date().toISOString()): SavedSearchCriteria | undefined {
  const parsedQuery = parseDemoSearchQueryV2(query);
  const parsedResponse = parseDemoSearchResponseV2(response, receivedAt);
  if (!parsedQuery.success || !parsedResponse.success) return undefined;
  const cursorless = { ...parsedQuery.data };
  delete cursorless.cursor;
  const queryWithoutCursor = canonicalQuery(cursorless);
  if (queryWithoutCursor === undefined) return undefined;
  const hasIdentity = queryWithoutCursor.makeId !== undefined || queryWithoutCursor.modelId !== undefined;
  const binding = hasIdentity ? Object.freeze({ fixtureVersion: parsedResponse.data.fixtureVersion, taxonomyRelease: parsedResponse.data.taxonomyRelease }) : undefined;
  return parseSavedSearchCriteria({ query: queryWithoutCursor, ...(binding === undefined ? {} : { binding }) });
}

export function matchingSavedSearchCatalog(criteria: SavedSearchCriteria, catalog: DemoCatalogResponseV2 | undefined): DemoCatalogResponseV2 | undefined {
  const parsedCriteria = parseSavedSearchCriteria(criteria);
  if (parsedCriteria === undefined || parsedCriteria.binding === undefined || catalog === undefined) return undefined;
  const parsedCatalog = parseDemoCatalogResponseV2(catalog);
  if (!parsedCatalog.success) return undefined;
  const binding = parsedCriteria.binding;
  const release = parsedCatalog.data.taxonomyRelease;
  if (binding.fixtureVersion !== parsedCatalog.data.fixtureVersion || binding.taxonomyRelease.catalogId !== release.catalogId || binding.taxonomyRelease.releaseId !== release.releaseId || binding.taxonomyRelease.revision !== release.revision) return undefined;
  const makeId = parsedCriteria.query.makeId;
  if (makeId === undefined || !isKnownMake(parsedCatalog.data, makeId)) return undefined;
  const modelId = parsedCriteria.query.modelId;
  if (modelId !== undefined && !isKnownModel(parsedCatalog.data, makeId, modelId)) return undefined;
  return parsedCatalog.data;
}

function centsToDecimal(value: number): string {
  const cents = BigInt(value);
  const whole = cents / 100n;
  const remainder = cents % 100n;
  return remainder === 0n ? whole.toString() : `${whole}.${remainder.toString().padStart(2, "0")}`;
}

function finiteToPlainDecimal(value: number): string {
  if (Object.is(value, -0) || value === 0) return "0";
  const source = value.toString().toLowerCase();
  if (!source.includes("e")) return source;
  const [mantissa = "0", exponentText = "0"] = source.split("e");
  const exponent = Number(exponentText);
  const [whole = "0", fraction = ""] = mantissa.split(".");
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) return `0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

export function savedSearchToFilterInput(criteria: SavedSearchCriteria, catalog?: DemoCatalogResponseV2, omitIdentity = false): DemoFilterInputV2 | undefined {
  const parsed = parseSavedSearchCriteria(criteria);
  if (parsed === undefined) return undefined;
  const hasIdentity = parsed.query.makeId !== undefined || parsed.query.modelId !== undefined;
  if (hasIdentity && !omitIdentity && matchingSavedSearchCatalog(parsed, catalog) === undefined) return undefined;
  return Object.freeze({
    priceMaxEUR: parsed.query.priceMaxMinor === undefined ? "" : centsToDecimal(parsed.query.priceMaxMinor),
    mileageMaxKm: parsed.query.mileageMaxKm === undefined ? "" : finiteToPlainDecimal(parsed.query.mileageMaxKm),
    sort: parsed.query.sort,
    text: "",
    makeId: omitIdentity ? "" : parsed.query.makeId ?? "",
    modelId: omitIdentity ? "" : parsed.query.modelId ?? "",
    firstRegistrationYear: parsed.query.firstRegistrationYear?.toString() ?? "",
  });
}

export function createSavedSearchStore(options: { readonly storageProvider?: () => SavedSearchStorage | null } = {}): SavedSearchStore {
  const storageProvider = options.storageProvider ?? (() => typeof window === "undefined" ? null : window.localStorage);
  const engine = createNamedCollectionEngine<SavedSearch, SavedSearchSnapshot>({
    storageKey: DEMO_SAVED_SEARCHES_KEY,
    limit: SAVED_SEARCH_LIMIT,
    emptyItems: emptySearches,
    serverSnapshot,
    clone: cloneSearch,
    key: (search) => getSavedSearchKey(search.criteria),
    encode,
    decode: (source) => {
      const decoded = decode(source);
      return decoded.kind === "valid" ? { kind: "valid", items: decoded.searches } : decoded;
    },
    snapshot: (searches, storageStatus, canUndo) => Object.freeze({ searches, storageStatus, canUndo }),
  }, storageProvider);
  const store: SavedSearchStore = {
    getSnapshot: engine.getSnapshot,
    getServerSnapshot: engine.getServerSnapshot,
    subscribe: engine.subscribe,
    hydrate: engine.hydrate,
    add(nameInput: unknown, criteriaInput: unknown) {
      if (!engine.prepareMutation()) return { ok: false, reason: "readonly" };
      const name = normalizeNamedCollectionName(nameInput);
      const criteria = parseSavedSearchCriteria(criteriaInput);
      if (name === undefined || criteria === undefined) return { ok: false, reason: "invalid" };
      const result = engine.addPrepared(Object.freeze({ name, criteria }));
      return result === "added" ? { ok: true } : { ok: false, reason: result };
    },
    remove: engine.remove,
    undo: engine.undo,
    reset: engine.reset,
    reconcileStorageEvent: engine.reconcileStorageEvent,
  };
  return Object.freeze(store);
}
