import { decodeComparisonLinkFragment, encodeComparisonLinkFragment } from "./comparison-link.ts";
import {
  createNamedCollectionEngine,
  normalizeNamedCollectionName,
  ownDataObject,
  type NamedCollectionStorageStatus,
} from "./named-collection-store.ts";
import { parseStrictJson } from "./strict-json.ts";

export const DEMO_SAVED_COMPARISONS_KEY = "auto-world.demo.saved-comparisons.v1";
export const SAVED_COMPARISON_LIMIT = 10;
const BYTE_LIMIT = 16_384;
const FUTURE_VERSION_INSPECTION_BYTE_LIMIT = 65_536;

export type SavedComparisonStorageStatus = NamedCollectionStorageStatus;
export interface SavedComparison { readonly name: string; readonly fragment: string }
export interface SavedComparisonSnapshot { readonly comparisons: readonly SavedComparison[]; readonly storageStatus: SavedComparisonStorageStatus; readonly canUndo: boolean }
export interface SavedComparisonStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface SavedComparisonStorageEvent { readonly key: string | null; readonly newValue: string | null; readonly storageArea?: SavedComparisonStorage | null }
export interface SavedComparisonStore {
  getSnapshot(): SavedComparisonSnapshot;
  getServerSnapshot(): SavedComparisonSnapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): SavedComparisonSnapshot;
  add(name: unknown, fragment: unknown): { readonly ok: true } | { readonly ok: false; readonly reason: "invalid" | "duplicate" | "full" | "readonly" };
  remove(fragment: string): boolean;
  undo(): SavedComparison | undefined;
  reset(): { readonly ok: true; readonly scope: "persisted" | "session" } | { readonly ok: false };
  reconcileStorageEvent(event: SavedComparisonStorageEvent): void;
}

type Decoded = { readonly kind: "valid"; readonly comparisons: readonly SavedComparison[] } | { readonly kind: "corrupt" } | { readonly kind: "future" };
const emptyComparisons = Object.freeze([]) as readonly SavedComparison[];
const serverSnapshot: SavedComparisonSnapshot = Object.freeze({ comparisons: emptyComparisons, storageStatus: "unhydrated", canUndo: false });

function canonicalFragment(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const decoded = decodeComparisonLinkFragment(input);
  if (decoded.status !== "valid") return undefined;
  const canonical = encodeComparisonLinkFragment(decoded.listingIds);
  return canonical === input ? canonical : undefined;
}

function cloneComparison(comparison: SavedComparison): SavedComparison {
  return Object.freeze({ name: comparison.name, fragment: comparison.fragment });
}

function encode(comparisons: readonly SavedComparison[]): string | undefined {
  const value = JSON.stringify({ schemaVersion: 1, comparisons: comparisons.map(({ name, fragment }) => ({ name, fragment })) });
  return new TextEncoder().encode(value).byteLength <= BYTE_LIMIT ? value : undefined;
}

function decode(source: string): Decoded {
  const byteLength = new TextEncoder().encode(source).byteLength;
  if (byteLength > FUTURE_VERSION_INSPECTION_BYTE_LIMIT) return { kind: "future" };
  let versionInput: unknown;
  try { versionInput = JSON.parse(source); } catch { return { kind: "corrupt" }; }
  if (typeof versionInput === "object" && versionInput !== null && !Array.isArray(versionInput)) {
    const schemaVersion = (versionInput as Record<string, unknown>).schemaVersion;
    if (typeof schemaVersion === "number" && schemaVersion > 1) return { kind: "future" };
  }
  let input: unknown;
  try { input = parseStrictJson(source); } catch { return { kind: "corrupt" }; }
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { kind: "corrupt" };
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1) return { kind: "corrupt" };
  if (byteLength > BYTE_LIMIT) return { kind: "corrupt" };
  if (Object.keys(value).sort().join() !== "comparisons,schemaVersion" || !Array.isArray(value.comparisons) || value.comparisons.length > SAVED_COMPARISON_LIMIT) return { kind: "corrupt" };
  const comparisons: SavedComparison[] = [];
  const fragments = new Set<string>();
  for (const item of value.comparisons) {
    const entry = ownDataObject(item, ["name", "fragment"]);
    if (entry === undefined) return { kind: "corrupt" };
    const name = normalizeNamedCollectionName(entry.name, true);
    const fragment = canonicalFragment(entry.fragment);
    if (name === undefined || fragment === undefined || fragments.has(fragment)) return { kind: "corrupt" };
    fragments.add(fragment);
    comparisons.push(Object.freeze({ name, fragment }));
  }
  return { kind: "valid", comparisons: Object.freeze(comparisons) };
}

export function createSavedComparisonStore(options: { readonly storageProvider?: () => SavedComparisonStorage | null } = {}): SavedComparisonStore {
  const storageProvider = options.storageProvider ?? (() => typeof window === "undefined" ? null : window.localStorage);
  const engine = createNamedCollectionEngine<SavedComparison, SavedComparisonSnapshot>({
    storageKey: DEMO_SAVED_COMPARISONS_KEY,
    limit: SAVED_COMPARISON_LIMIT,
    emptyItems: emptyComparisons,
    serverSnapshot,
    clone: cloneComparison,
    key: (comparison) => comparison.fragment,
    encode,
    decode: (source) => {
      const decoded = decode(source);
      return decoded.kind === "valid" ? { kind: "valid", items: decoded.comparisons } : decoded;
    },
    snapshot: (comparisons, storageStatus, canUndo) => Object.freeze({ comparisons, storageStatus, canUndo }),
  }, storageProvider);
  const store: SavedComparisonStore = {
    getSnapshot: engine.getSnapshot,
    getServerSnapshot: engine.getServerSnapshot,
    subscribe: engine.subscribe,
    hydrate: engine.hydrate,
    add(nameInput: unknown, fragmentInput: unknown) {
      if (!engine.prepareMutation()) return { ok: false, reason: "readonly" };
      const name = normalizeNamedCollectionName(nameInput);
      const fragment = canonicalFragment(fragmentInput);
      if (name === undefined || fragment === undefined) return { ok: false, reason: "invalid" };
      const result = engine.addPrepared(Object.freeze({ name, fragment }));
      return result === "added" ? { ok: true } : { ok: false, reason: result };
    },
    remove(fragmentInput: string) {
      const fragment = canonicalFragment(fragmentInput);
      return fragment !== undefined && engine.remove(fragment);
    },
    undo: engine.undo,
    reset: engine.reset,
    reconcileStorageEvent: engine.reconcileStorageEvent,
  };
  return Object.freeze(store);
}
