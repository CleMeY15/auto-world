import { parseListingId, type ListingId } from "@auto-world/vehicle-schema";
import { parseStrictJson } from "./strict-json.ts";

export const DEMO_FAVORITES_KEY = "auto-world.demo.favorites.v1";
const byteLimit = 8_192;
const itemLimit = 100;

export type FavoritesStorageStatus = "unhydrated" | "persisted" | "session" | "corrupt" | "future" | "denied" | "quota";
export interface FavoritesSnapshot { readonly listingIds: readonly ListingId[]; readonly storageStatus: FavoritesStorageStatus; readonly canUndo: boolean }
export interface FavoritesStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface FavoritesStorageEvent { readonly key: string | null; readonly newValue: string | null; readonly storageArea?: FavoritesStorage | null }
export interface FavoritesEventTarget { addEventListener(type: "storage", listener: (event: FavoritesStorageEvent) => void): void; removeEventListener(type: "storage", listener: (event: FavoritesStorageEvent) => void): void }
export interface FavoritesStore {
  getSnapshot(): FavoritesSnapshot;
  getServerSnapshot(): FavoritesSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): FavoritesSnapshot;
  add(listingId: unknown): boolean;
  remove(listingId: unknown): boolean;
  undo(): boolean;
  reset(): boolean;
  reconcileStorageEvent(event: FavoritesStorageEvent): void;
}

type Decoded = { readonly kind: "valid"; readonly ids: readonly ListingId[] } | { readonly kind: "corrupt" } | { readonly kind: "future" };
const serverSnapshot: FavoritesSnapshot = Object.freeze({ listingIds: Object.freeze([]), storageStatus: "unhydrated", canUndo: false });

function decode(source: string): Decoded {
  if (new TextEncoder().encode(source).byteLength > byteLimit) return { kind: "corrupt" };
  let input: unknown;
  try { input = parseStrictJson(source); } catch { return { kind: "corrupt" }; }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { kind: "corrupt" };
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1) return typeof value.schemaVersion === "number" && value.schemaVersion > 1 ? { kind: "future" } : { kind: "corrupt" };
  if (Object.keys(value).sort().join() !== "listingIds,schemaVersion" || !Array.isArray(value.listingIds) || value.listingIds.length > itemLimit) return { kind: "corrupt" };
  const ids: ListingId[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.listingIds.length; index += 1) {
    if (!(index in value.listingIds)) return { kind: "corrupt" };
    const parsed = parseListingId(value.listingIds[index]);
    if (!parsed.success || seen.has(parsed.data)) return { kind: "corrupt" };
    seen.add(parsed.data);
    ids.push(parsed.data);
  }
  if (encode(ids) !== source) return { kind: "corrupt" };
  return { kind: "valid", ids: Object.freeze(ids) };
}
function encode(ids: readonly ListingId[]): string | undefined {
  const value = JSON.stringify({ schemaVersion: 1, listingIds: ids });
  return new TextEncoder().encode(value).byteLength <= byteLimit ? value : undefined;
}
function failureStatus(error: unknown): FavoritesStorageStatus {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "QuotaExceededError" ? "quota" : "denied";
}

export function createFavoritesStore(options: { readonly storageProvider?: () => FavoritesStorage | null; readonly eventTarget?: FavoritesEventTarget } = {}): FavoritesStore {
  const storageProvider = options.storageProvider ?? (() => typeof window === "undefined" ? null : window.localStorage);
  let ids: readonly ListingId[] = Object.freeze([]);
  let storageStatus: FavoritesStorageStatus = "unhydrated";
  let removal: { readonly id: ListingId; readonly index: number } | undefined;
  let snapshot: FavoritesSnapshot = serverSnapshot;
  let storage: FavoritesStorage | null | undefined;
  let storageAuthority = false;
  const listeners = new Set<() => void>();
  const update = (nextIds = ids, nextStatus = storageStatus, nextRemoval = removal): void => {
    ids = Object.freeze([...nextIds]);
    storageStatus = nextStatus;
    removal = nextRemoval !== undefined && !ids.includes(nextRemoval.id) && ids.length < itemLimit ? nextRemoval : undefined;
    snapshot = Object.freeze({ listingIds: ids, storageStatus, canUndo: removal !== undefined });
    for (const listener of listeners) listener();
  };
  const resolveStorage = (): FavoritesStorage | null => {
    if (storage !== undefined) return storage;
    try { storage = storageProvider(); } catch { storage = null; }
    return storage;
  };
  const persist = (nextIds: readonly ListingId[]): FavoritesStorageStatus => {
    if (!storageAuthority) return storageStatus === "future" || storageStatus === "corrupt" ? storageStatus : "session";
    const target = resolveStorage();
    if (target === null) return "session";
    const value = encode(nextIds);
    if (value === undefined) return "quota";
    try { target.setItem(DEMO_FAVORITES_KEY, value); return "persisted"; }
    catch (error) { storageAuthority = false; return failureStatus(error); }
  };
  const reconcileStorageEvent = (event: FavoritesStorageEvent): void => {
    if (storageStatus === "unhydrated") return;
    if (event.key !== DEMO_FAVORITES_KEY || (event.storageArea !== undefined && storage !== undefined && event.storageArea !== storage)) return;
    if (event.newValue === null) { storageAuthority = true; update([], "persisted", removal); return; }
    const decoded = decode(event.newValue);
    storageAuthority = decoded.kind === "valid";
    if (decoded.kind === "valid") update(decoded.ids, "persisted", removal);
    else update(ids, decoded.kind, removal);
  };
  options.eventTarget?.addEventListener("storage", reconcileStorageEvent);
  const store: FavoritesStore = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    hydrate() {
      const target = resolveStorage();
      if (target === null) { update(ids, "denied"); return snapshot; }
      try {
        const value = target.getItem(DEMO_FAVORITES_KEY);
        if (value === null) { storageAuthority = true; update([], "persisted"); }
        else {
          const decoded = decode(value);
          storageAuthority = decoded.kind === "valid";
          update(decoded.kind === "valid" ? decoded.ids : ids, decoded.kind === "valid" ? "persisted" : decoded.kind);
        }
      } catch (error) { storageAuthority = false; update(ids, failureStatus(error)); }
      return snapshot;
    },
    add(input: unknown) {
      const parsed = parseListingId(input);
      if (!parsed.success || ids.includes(parsed.data) || ids.length >= itemLimit) return false;
      const next = [...ids, parsed.data];
      update(next, persist(next), removal);
      return true;
    },
    remove(input: unknown) {
      const parsed = parseListingId(input);
      if (!parsed.success) return false;
      const index = ids.indexOf(parsed.data);
      if (index < 0) return false;
      const next = ids.filter((id) => id !== parsed.data);
      update(next, persist(next), { id: parsed.data, index });
      return true;
    },
    undo() {
      if (removal === undefined) return false;
      if (ids.includes(removal.id) || ids.length >= itemLimit) { update(ids, storageStatus, undefined); return false; }
      const next = [...ids];
      next.splice(Math.min(removal.index, next.length), 0, removal.id);
      const status = persist(next);
      update(next, status, undefined);
      return true;
    },
    reset() {
      if (storageStatus === "future") return false;
      const target = resolveStorage();
      if (target === null) { update([], "session", undefined); return true; }
      try { target.removeItem(DEMO_FAVORITES_KEY); storageAuthority = true; update([], "persisted", undefined); return true; }
      catch (error) { storageAuthority = false; update(ids, failureStatus(error), removal); return false; }
    },
    reconcileStorageEvent,
  };
  return Object.freeze(store);
}
