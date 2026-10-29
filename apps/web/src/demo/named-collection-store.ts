export type NamedCollectionStorageStatus = "unhydrated" | "persisted" | "session" | "corrupt" | "future" | "denied" | "quota";

export interface NamedCollectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface NamedCollectionStorageEvent {
  readonly key: string | null;
  readonly newValue: string | null;
  readonly storageArea?: NamedCollectionStorage | null;
}

export type NamedCollectionDecoded<Item> =
  | { readonly kind: "valid"; readonly items: readonly Item[] }
  | { readonly kind: "corrupt" }
  | { readonly kind: "future" };

interface NamedCollectionAdapter<Item, Snapshot> {
  readonly storageKey: string;
  readonly limit: number;
  readonly emptyItems: readonly Item[];
  readonly serverSnapshot: Snapshot;
  clone(item: Item): Item;
  key(item: Item): string;
  encode(items: readonly Item[]): string | undefined;
  decode(source: string): NamedCollectionDecoded<Item>;
  snapshot(items: readonly Item[], storageStatus: NamedCollectionStorageStatus, canUndo: boolean): Snapshot;
}

export interface NamedCollectionEngine<Item, Snapshot> {
  getSnapshot(): Snapshot;
  getServerSnapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  hydrate(): Snapshot;
  prepareMutation(): boolean;
  addPrepared(item: Item): "added" | "duplicate" | "full";
  remove(key: string): boolean;
  undo(): Item | undefined;
  reset(): { readonly ok: true; readonly scope: "persisted" | "session" } | { readonly ok: false };
  reconcileStorageEvent(event: NamedCollectionStorageEvent): void;
}

const forbiddenNamePattern = /[\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;

export function ownDataObject(input: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
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

export function normalizeNamedCollectionName(input: unknown, requireCanonical = false): string | undefined {
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

function failureStatus(error: unknown): NamedCollectionStorageStatus {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "QuotaExceededError" ? "quota" : "denied";
}

export function createNamedCollectionEngine<Item, Snapshot>(
  adapter: NamedCollectionAdapter<Item, Snapshot>,
  storageProvider: () => NamedCollectionStorage | null,
): NamedCollectionEngine<Item, Snapshot> {
  type Removal = { readonly item: Item; readonly key: string; readonly index: number };
  let items = adapter.emptyItems;
  let storageStatus: NamedCollectionStorageStatus = "unhydrated";
  let removal: Removal | undefined;
  let snapshot = adapter.serverSnapshot;
  let storage: NamedCollectionStorage | null | undefined;
  let observedBytes: string | null | undefined;
  const clearRemoval = Symbol("clearRemoval");
  const listeners = new Set<() => void>();
  const resolveStorage = (): NamedCollectionStorage | null => {
    if (storage !== undefined) return storage;
    try { storage = storageProvider(); } catch { storage = null; }
    return storage;
  };
  const update = (nextItems = items, nextStatus = storageStatus, nextRemoval: Removal | typeof clearRemoval | undefined = removal): void => {
    items = Object.freeze(nextItems.map(adapter.clone));
    storageStatus = nextStatus;
    const candidate = nextRemoval === clearRemoval ? undefined : nextRemoval;
    removal = candidate !== undefined && items.length < adapter.limit && !items.some((item) => adapter.key(item) === candidate.key)
      ? candidate
      : undefined;
    snapshot = adapter.snapshot(items, storageStatus, removal !== undefined);
    for (const listener of listeners) listener();
  };
  const applyBytes = (bytes: string | null, clearUndo = true): NamedCollectionDecoded<Item> => {
    observedBytes = bytes;
    if (bytes === null) {
      update(adapter.emptyItems, "persisted", clearUndo ? clearRemoval : removal);
      return { kind: "valid", items: adapter.emptyItems };
    }
    const decoded = adapter.decode(bytes);
    if (decoded.kind === "valid") update(decoded.items, "persisted", clearUndo ? clearRemoval : removal);
    else update(items, decoded.kind, clearUndo ? clearRemoval : removal);
    return decoded;
  };
  const rereadPersisted = (): boolean => {
    const target = resolveStorage();
    if (target === null) { update(items, "session", removal); return false; }
    try {
      const bytes = target.getItem(adapter.storageKey);
      if (bytes !== observedBytes) applyBytes(bytes);
      return storageStatus === "persisted";
    } catch (error) { update(items, failureStatus(error), removal); return false; }
  };
  const persist = (next: readonly Item[]): NamedCollectionStorageStatus => {
    if (storageStatus !== "persisted") return storageStatus;
    const target = resolveStorage();
    if (target === null) return "session";
    const bytes = adapter.encode(next);
    if (bytes === undefined) return "quota";
    try { target.setItem(adapter.storageKey, bytes); observedBytes = bytes; return "persisted"; }
    catch (error) { return failureStatus(error); }
  };
  const writable = (): boolean => {
    if (storageStatus === "unhydrated" || storageStatus === "corrupt" || storageStatus === "future") return false;
    if (storageStatus === "persisted") rereadPersisted();
    return !(["unhydrated", "corrupt", "future"] as readonly NamedCollectionStorageStatus[]).includes(storageStatus);
  };
  const engine: NamedCollectionEngine<Item, Snapshot> = {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => adapter.serverSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate() {
      if (storageStatus !== "unhydrated") return snapshot;
      const target = resolveStorage();
      if (target === null) { update(items, "denied"); return snapshot; }
      try { applyBytes(target.getItem(adapter.storageKey)); }
      catch (error) { update(items, failureStatus(error)); }
      return snapshot;
    },
    prepareMutation: writable,
    addPrepared(item: Item) {
      const key = adapter.key(item);
      if (items.some((candidate) => adapter.key(candidate) === key)) return "duplicate";
      if (items.length >= adapter.limit) return "full";
      const next = [...items, item];
      const status = persist(next);
      update(next, status, removal);
      return "added";
    },
    remove(key: string) {
      if (!writable() || key === "") return false;
      const index = items.findIndex((item) => adapter.key(item) === key);
      if (index < 0) return false;
      const item = items[index]!;
      const next = items.filter((_, itemIndex) => itemIndex !== index);
      const status = persist(next);
      update(next, status, { item, key, index });
      return true;
    },
    undo() {
      if (!writable()) return undefined;
      const current = removal;
      if (current === undefined) return undefined;
      if (items.length >= adapter.limit || items.some((item) => adapter.key(item) === current.key)) {
        update(items, storageStatus, clearRemoval);
        return undefined;
      }
      const next = [...items];
      next.splice(Math.min(current.index, next.length), 0, current.item);
      const status = persist(next);
      update(next, status, clearRemoval);
      return adapter.clone(current.item);
    },
    reset() {
      if (storageStatus === "unhydrated" || storageStatus === "future") return { ok: false };
      if (storageStatus === "session" || storageStatus === "quota" || storageStatus === "denied") {
        update(adapter.emptyItems, storageStatus, clearRemoval);
        return { ok: true, scope: "session" };
      }
      const target = resolveStorage();
      if (target === null) return { ok: false };
      try {
        const current = target.getItem(adapter.storageKey);
        if (current !== observedBytes) { applyBytes(current); return { ok: false }; }
        target.removeItem(adapter.storageKey);
        observedBytes = null;
        update(adapter.emptyItems, "persisted", clearRemoval);
        return { ok: true, scope: "persisted" };
      } catch (error) { update(items, failureStatus(error), removal); return { ok: false }; }
    },
    reconcileStorageEvent(event: NamedCollectionStorageEvent) {
      if (storageStatus === "unhydrated" || (event.key !== null && event.key !== adapter.storageKey)) return;
      const target = resolveStorage();
      if (event.storageArea !== undefined && event.storageArea !== null && target !== event.storageArea) return;
      if (target === null) return;
      try {
        const bytes = target.getItem(adapter.storageKey);
        if (bytes !== observedBytes) applyBytes(bytes);
      } catch (error) { update(items, failureStatus(error), removal); }
    },
  };
  return Object.freeze(engine);
}
