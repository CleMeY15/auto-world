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
import { parseStrictJson } from "./strict-json.ts";

export const DEMO_SAVED_SEARCHES_KEY = "auto-world.demo.saved-searches.v1";
export const SAVED_SEARCH_LIMIT = 10;
const BYTE_LIMIT = 16_384;

export type SavedSearchStorageStatus = "unhydrated" | "persisted" | "session" | "corrupt" | "future" | "denied" | "quota";
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
type Removal = { readonly search: SavedSearch; readonly key: string; readonly index: number };
const emptySearches = Object.freeze([]) as readonly SavedSearch[];
const serverSnapshot: SavedSearchSnapshot = Object.freeze({ searches: emptySearches, storageStatus: "unhydrated", canUndo: false });
const fixturePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const catalogPattern = /^taxcat_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const releasePattern = /^taxrel_[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const forbiddenNamePattern = /[\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;

function ownDataObject(input: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (Object.getOwnPropertySymbols(input).length !== 0) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Object.keys(descriptors).sort().join("\u0000") !== [...keys].sort().join("\u0000")) return undefined;
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return undefined;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return undefined;
  }
}

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

function normalizeName(input: unknown, requireCanonical = false): string | undefined {
  if (typeof input !== "string" || forbiddenNamePattern.test(input)) return undefined;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return undefined;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return undefined;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return undefined;
  }
  const normalized = input.trim().normalize("NFC");
  if (requireCanonical && normalized !== input) return undefined;
  const length = [...normalized].length;
  return length >= 1 && length <= 60 ? normalized : undefined;
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
    const name = normalizeName(entry.name, true);
    const criteria = parseSavedSearchCriteria(entry.criteria);
    if (name === undefined || criteria === undefined) return { kind: "corrupt" };
    const key = getSavedSearchKey(criteria);
    if (keys.has(key)) return { kind: "corrupt" };
    keys.add(key);
    searches.push(Object.freeze({ name, criteria }));
  }
  return { kind: "valid", searches: Object.freeze(searches) };
}

function failureStatus(error: unknown): SavedSearchStorageStatus {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "QuotaExceededError" ? "quota" : "denied";
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
  let searches = emptySearches;
  let storageStatus: SavedSearchStorageStatus = "unhydrated";
  let removal: Removal | undefined;
  let snapshot = serverSnapshot;
  let storage: SavedSearchStorage | null | undefined;
  let observedBytes: string | null | undefined;
  const clearRemoval = Symbol("clearRemoval");
  const listeners = new Set<() => void>();
  const resolveStorage = (): SavedSearchStorage | null => {
    if (storage !== undefined) return storage;
    try { storage = storageProvider(); } catch { storage = null; }
    return storage;
  };
  const update = (nextSearches = searches, nextStatus = storageStatus, nextRemoval: Removal | typeof clearRemoval | undefined = removal): void => {
    searches = Object.freeze(nextSearches.map(cloneSearch));
    storageStatus = nextStatus;
    const candidate = nextRemoval === clearRemoval ? undefined : nextRemoval;
    removal = candidate !== undefined && searches.length < SAVED_SEARCH_LIMIT && !searches.some((search) => getSavedSearchKey(search.criteria) === candidate.key)
      ? candidate
      : undefined;
    snapshot = Object.freeze({ searches, storageStatus, canUndo: removal !== undefined });
    for (const listener of listeners) listener();
  };
  const applyBytes = (bytes: string | null, clearUndo = true): Decoded => {
    observedBytes = bytes;
    if (bytes === null) { update(emptySearches, "persisted", clearUndo ? clearRemoval : removal); return { kind: "valid", searches: emptySearches }; }
    const decoded = decode(bytes);
    if (decoded.kind === "valid") update(decoded.searches, "persisted", clearUndo ? clearRemoval : removal);
    else update(searches, decoded.kind, clearUndo ? clearRemoval : removal);
    return decoded;
  };
  const rereadPersisted = (): boolean => {
    const target = resolveStorage();
    if (target === null) { update(searches, "session", removal); return false; }
    try {
      const bytes = target.getItem(DEMO_SAVED_SEARCHES_KEY);
      if (bytes !== observedBytes) applyBytes(bytes);
      return storageStatus === "persisted";
    } catch (error) { update(searches, failureStatus(error), removal); return false; }
  };
  const persist = (next: readonly SavedSearch[]): SavedSearchStorageStatus => {
    if (storageStatus !== "persisted") return storageStatus;
    const target = resolveStorage();
    if (target === null) return "session";
    const bytes = encode(next);
    if (bytes === undefined) return "quota";
    try { target.setItem(DEMO_SAVED_SEARCHES_KEY, bytes); observedBytes = bytes; return "persisted"; }
    catch (error) { return failureStatus(error); }
  };
  const writable = (): boolean => {
    if (storageStatus === "unhydrated" || storageStatus === "corrupt" || storageStatus === "future") return false;
    if (storageStatus === "persisted") rereadPersisted();
    return !(["unhydrated", "corrupt", "future"] as readonly SavedSearchStorageStatus[]).includes(storageStatus);
  };
  const reconcileStorageEvent = (event: SavedSearchStorageEvent): void => {
    if (storageStatus === "unhydrated" || (event.key !== null && event.key !== DEMO_SAVED_SEARCHES_KEY)) return;
    const target = resolveStorage();
    if (event.storageArea !== undefined && event.storageArea !== null && target !== event.storageArea) return;
    if (target === null) return;
    try {
      const bytes = target.getItem(DEMO_SAVED_SEARCHES_KEY);
      if (bytes !== observedBytes) applyBytes(bytes);
    } catch (error) { update(searches, failureStatus(error), removal); }
  };
  const store: SavedSearchStore = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate() {
      if (storageStatus !== "unhydrated") return snapshot;
      const target = resolveStorage();
      if (target === null) { update(searches, "denied"); return snapshot; }
      try { applyBytes(target.getItem(DEMO_SAVED_SEARCHES_KEY)); }
      catch (error) { update(searches, failureStatus(error)); }
      return snapshot;
    },
    add(nameInput: unknown, criteriaInput: unknown) {
      if (!writable()) return { ok: false, reason: "readonly" };
      const name = normalizeName(nameInput);
      const criteria = parseSavedSearchCriteria(criteriaInput);
      if (name === undefined || criteria === undefined) return { ok: false, reason: "invalid" };
      const key = getSavedSearchKey(criteria);
      if (searches.some((item) => getSavedSearchKey(item.criteria) === key)) return { ok: false, reason: "duplicate" };
      if (searches.length >= SAVED_SEARCH_LIMIT) return { ok: false, reason: "full" };
      const next = [...searches, Object.freeze({ name, criteria })];
      const status = persist(next);
      update(next, status, removal);
      return { ok: true };
    },
    remove(key: string) {
      if (!writable() || key === "") return false;
      const index = searches.findIndex((item) => getSavedSearchKey(item.criteria) === key);
      if (index < 0) return false;
      const search = searches[index]!;
      const next = searches.filter((_, itemIndex) => itemIndex !== index);
      const status = persist(next);
      update(next, status, { search, key, index });
      return true;
    },
    undo() {
      if (!writable()) return undefined;
      const current = removal;
      if (current === undefined) return undefined;
      if (searches.length >= SAVED_SEARCH_LIMIT || searches.some((item) => getSavedSearchKey(item.criteria) === current.key)) { update(searches, storageStatus, clearRemoval); return undefined; }
      const next = [...searches];
      next.splice(Math.min(current.index, next.length), 0, current.search);
      const status = persist(next);
      update(next, status, clearRemoval);
      return cloneSearch(current.search);
    },
    reset() {
      if (storageStatus === "unhydrated" || storageStatus === "future") return { ok: false };
      if (storageStatus === "session" || storageStatus === "quota" || storageStatus === "denied") { update(emptySearches, storageStatus, clearRemoval); return { ok: true, scope: "session" }; }
      const target = resolveStorage();
      if (target === null) return { ok: false };
      try {
        const current = target.getItem(DEMO_SAVED_SEARCHES_KEY);
        if (current !== observedBytes) { applyBytes(current); return { ok: false }; }
        target.removeItem(DEMO_SAVED_SEARCHES_KEY);
        observedBytes = null;
        update(emptySearches, "persisted", clearRemoval);
        return { ok: true, scope: "persisted" };
      } catch (error) { update(searches, failureStatus(error), removal); return { ok: false }; }
    },
    reconcileStorageEvent,
  };
  return Object.freeze(store);
}
