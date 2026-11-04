/* global DOMException */
import assert from "node:assert/strict";
import test from "node:test";

import { encodeComparisonLinkFragment } from "../.test-dist/src/demo/comparison-link.js";
import {
  createSavedComparisonStore,
  DEMO_SAVED_COMPARISONS_KEY,
  SAVED_COMPARISON_LIMIT,
} from "../.test-dist/src/demo/saved-comparisons.js";
import { createNamedCollectionEngine } from "../.test-dist/src/demo/named-collection-store.js";
import { createSavedSearchStore, DEMO_SAVED_SEARCHES_KEY } from "../.test-dist/src/demo/saved-searches.js";

const fragments = Array.from({ length: SAVED_COMPARISON_LIMIT + 2 }, (_, index) => encodeComparisonLinkFragment([
  `lst_saved-comparison-${index}-a`,
  `lst_saved-comparison-${index}-b`,
]));
assert.equal(fragments.every((fragment) => typeof fragment === "string"), true);

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    values,
    writes,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes.push({ key, value }); values.set(key, value); },
    removeItem(key) { writes.push({ key, value: null }); values.delete(key); },
  };
}

function comparisonBytes(comparisons) {
  return JSON.stringify({ schemaVersion: 1, comparisons });
}

test("saved comparisons persist canonical fragments with normalized names and cached immutable snapshots", () => {
  let providerCalls = 0;
  const storage = memory();
  const store = createSavedComparisonStore({ storageProvider: () => { providerCalls += 1; return storage; } });
  const server = store.getServerSnapshot();
  assert.equal(server.storageStatus, "unhydrated");
  assert.equal(providerCalls, 0);
  assert.deepEqual(store.add("Trop tôt", fragments[0]), { ok: false, reason: "readonly" });
  assert.deepEqual(store.rename(fragments[0], "Trop tôt", server), { ok: false, reason: "readonly" });
  assert.equal(providerCalls, 0);

  const hydrated = store.hydrate();
  assert.equal(providerCalls, 1);
  assert.strictEqual(store.getSnapshot(), hydrated);
  assert.deepEqual(store.add("  E\u0301lectriques  ", fragments[0]), { ok: true });
  const snapshot = store.getSnapshot();
  assert.strictEqual(store.getSnapshot(), snapshot);
  assert.deepEqual(snapshot.comparisons, [{ name: "Électriques", fragment: fragments[0] }]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.comparisons), true);
  assert.equal(Object.isFrozen(snapshot.comparisons[0]), true);
  assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), JSON.stringify({
    schemaVersion: 1,
    comparisons: [{ name: "Électriques", fragment: fragments[0] }],
  }));
});

test("direct additions reject hostile names, noncanonical fragments, duplicates and overflow", () => {
  const store = createSavedComparisonStore({ storageProvider: () => memory() });
  store.hydrate();
  const noncanonical = fragments[0].replace("%5B", "%5b");
  assert.notEqual(noncanonical, fragments[0]);
  let coercions = 0;
  const hostile = { toString() { coercions += 1; throw new Error("must not coerce"); } };
  for (const [name, fragment] of [
    ["", fragments[0]],
    ["\u0000", fragments[0]],
    ["\u202etest", fragments[0]],
    ["\ud800", fragments[0]],
    ["x".repeat(61), fragments[0]],
    ["Invalide", "#comparison-link/v1/%"],
    ["Décorée", noncanonical],
    ["Objet", hostile],
  ]) assert.deepEqual(store.add(name, fragment), { ok: false, reason: "invalid" });
  assert.equal(coercions, 0);

  assert.deepEqual(store.add("Première", fragments[0]), { ok: true });
  assert.deepEqual(store.add("Même fragment", fragments[0]), { ok: false, reason: "duplicate" });
  for (let index = 1; index < SAVED_COMPARISON_LIMIT; index += 1) {
    assert.deepEqual(store.add(`Comparaison ${index}`, fragments[index]), { ok: true });
  }
  assert.deepEqual(store.add("Pleine", fragments[SAVED_COMPARISON_LIMIT]), { ok: false, reason: "full" });
});

test("rename changes only the selected name at its original position, including in a full collection", () => {
  const storage = memory();
  const store = createSavedComparisonStore({ storageProvider: () => storage });
  store.hydrate();
  for (let index = 0; index < SAVED_COMPARISON_LIMIT; index += 1) {
    assert.deepEqual(store.add(`Comparaison ${index}`, fragments[index]), { ok: true });
  }
  const before = store.getSnapshot();
  const writesBefore = storage.writes.length;
  assert.deepEqual(store.rename(fragments[4], "  Comparaison 3  ", before), { ok: true, outcome: "renamed" });

  const after = store.getSnapshot();
  assert.notStrictEqual(after, before);
  assert.deepEqual(before.comparisons[4], { name: "Comparaison 4", fragment: fragments[4] });
  assert.equal(Object.isFrozen(after), true);
  assert.equal(Object.isFrozen(after.comparisons[4]), true);
  assert.deepEqual(after.comparisons.map(({ fragment }) => fragment), fragments.slice(0, SAVED_COMPARISON_LIMIT));
  assert.deepEqual(after.comparisons.map(({ name }) => name), [
    "Comparaison 0", "Comparaison 1", "Comparaison 2", "Comparaison 3", "Comparaison 3",
    "Comparaison 5", "Comparaison 6", "Comparaison 7", "Comparaison 8", "Comparaison 9",
  ]);
  assert.equal(storage.writes.length, writesBefore + 1);
  assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), comparisonBytes(after.comparisons));
});

test("prepared replacement rejects a changed key and a missing index without mutating storage", () => {
  const storage = memory();
  const empty = Object.freeze([]);
  const server = Object.freeze({ items: empty, storageStatus: "unhydrated", canUndo: false });
  const engine = createNamedCollectionEngine({
    storageKey: "prepared-replacement-test",
    limit: 2,
    emptyItems: empty,
    serverSnapshot: server,
    clone: (item) => Object.freeze({ id: item.id, value: item.value }),
    key: (item) => item.id,
    encode: (items) => JSON.stringify(items),
    decode: (source) => ({ kind: "valid", items: JSON.parse(source) }),
    snapshot: (items, storageStatus, canUndo) => Object.freeze({ items, storageStatus, canUndo }),
  }, () => storage);
  engine.hydrate();
  assert.equal(engine.prepareMutation(), true);
  assert.equal(engine.addPrepared(Object.freeze({ id: "a", value: "A" })), "added");
  const expected = engine.getSnapshot();
  const writesBefore = storage.writes.length;

  assert.equal(engine.replacePrepared("a", Object.freeze({ id: "b", value: "B" })), false);
  assert.equal(engine.replacePrepared("missing", Object.freeze({ id: "missing", value: "B" })), false);
  assert.strictEqual(engine.getSnapshot(), expected);
  assert.equal(storage.writes.length, writesBefore);
});

test("rename normalizes names and returns an immutable zero-write no-op snapshot", () => {
  const storage = memory();
  const store = createSavedComparisonStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("Électriques", fragments[0]);
  const expected = store.getSnapshot();
  const writesBefore = storage.writes.length;

  assert.deepEqual(store.rename(fragments[0], "  E\u0301lectriques  ", expected), { ok: true, outcome: "unchanged" });
  assert.strictEqual(store.getSnapshot(), expected);
  assert.equal(storage.writes.length, writesBefore);
  assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), comparisonBytes(expected.comparisons));
});

test("rename rejects hostile inputs and missing targets without coercion or writes", () => {
  const storage = memory();
  const store = createSavedComparisonStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("Initiale", fragments[0]);
  const expected = store.getSnapshot();
  const writesBefore = storage.writes.length;
  let coercions = 0;
  const hostile = { toString() { coercions += 1; throw new Error("must not coerce"); } };

  for (const [fragment, name] of [
    [fragments[0], ""],
    [fragments[0], "\u202etest"],
    [fragments[0], "\ud800"],
    [fragments[0], "x".repeat(61)],
    [fragments[0].replace("%5B", "%5b"), "Décorée"],
    [hostile, "Objet"],
    [fragments[0], hostile],
  ]) assert.deepEqual(store.rename(fragment, name, expected), { ok: false, reason: "invalid" });
  assert.deepEqual(store.rename(fragments[1], "Absente", expected), { ok: false, reason: "stale" });
  assert.equal(coercions, 0);
  assert.strictEqual(store.getSnapshot(), expected);
  assert.equal(storage.writes.length, writesBefore);
});

test("decode rejects closed-shape violations, duplicate fragments, noncanonical names and oversized bytes", () => {
  const invalidValues = [
    '{"schemaVersion":1,"comparisons":[],"tracking":"x"}',
    '{"schemaVersion":1,"schemaVersion":1,"comparisons":[]}',
    '{"schemaVersion":1,"comparisons":[],"__proto__":{}}',
    JSON.stringify({ schemaVersion: 1, comparisons: [{ name: " spaced ", fragment: fragments[0] }] }),
    JSON.stringify({ schemaVersion: 1, comparisons: [{ name: "A", fragment: fragments[0] }, { name: "B", fragment: fragments[0] }] }),
    JSON.stringify({ schemaVersion: 1, comparisons: [{ name: "Décorée", fragment: fragments[0].replace("%5B", "%5b") }] }),
    `{"schemaVersion":1,"comparisons":[],"padding":"${"x".repeat(17_000)}"}`,
  ];
  for (const value of invalidValues) {
    const storage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: value });
    const store = createSavedComparisonStore({ storageProvider: () => storage });
    assert.equal(store.hydrate().storageStatus, "corrupt");
    assert.deepEqual(store.add("Bloquée", fragments[1]), { ok: false, reason: "readonly" });
    assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), value);
  }

  const futureBytes = '{"schemaVersion":2,"comparisons":[],"policy":"future"}';
  const futureStorage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: futureBytes });
  const future = createSavedComparisonStore({ storageProvider: () => futureStorage });
  assert.equal(future.hydrate().storageStatus, "future");
  assert.deepEqual(future.reset(), { ok: false });
  assert.equal(futureStorage.values.get(DEMO_SAVED_COMPARISONS_KEY), futureBytes);

  const oversizedFutureBytes = JSON.stringify({ schemaVersion: 2, comparisons: [], policy: "x".repeat(17_000) });
  const oversizedFutureStorage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: oversizedFutureBytes });
  const oversizedFuture = createSavedComparisonStore({ storageProvider: () => oversizedFutureStorage });
  assert.equal(oversizedFuture.hydrate().storageStatus, "future");
  assert.deepEqual(oversizedFuture.reset(), { ok: false });
  assert.equal(oversizedFutureStorage.values.get(DEMO_SAVED_COMPARISONS_KEY), oversizedFutureBytes);

  const extendedFutureBytes = '{"schemaVersion":2,"constructor":"new field","nested":{"prototype":{"enabled":true},"__proto__":{"safe":true}}}';
  const extendedFutureStorage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: extendedFutureBytes });
  const extendedFuture = createSavedComparisonStore({ storageProvider: () => extendedFutureStorage });
  assert.equal(extendedFuture.hydrate().storageStatus, "future");
  assert.deepEqual(extendedFuture.reset(), { ok: false });
  assert.equal(extendedFutureStorage.values.get(DEMO_SAVED_COMPARISONS_KEY), extendedFutureBytes);

  const unsupportedOversizedBytes = JSON.stringify({ unsupported: "x".repeat(70_000) });
  const unsupportedOversizedStorage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: unsupportedOversizedBytes });
  const unsupportedOversized = createSavedComparisonStore({ storageProvider: () => unsupportedOversizedStorage });
  assert.equal(unsupportedOversized.hydrate().storageStatus, "future");
  assert.deepEqual(unsupportedOversized.reset(), { ok: false });
  assert.equal(unsupportedOversizedStorage.values.get(DEMO_SAVED_COMPARISONS_KEY), unsupportedOversizedBytes);
});

test("remove and undo preserve order while external changes invalidate stale undo", () => {
  const storage = memory();
  const store = createSavedComparisonStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("A", fragments[0]);
  store.add("B", fragments[1]);
  assert.equal(store.remove(fragments[0]), true);
  assert.equal(store.getSnapshot().canUndo, true);
  assert.deepEqual(store.undo(), { name: "A", fragment: fragments[0] });
  assert.deepEqual(store.getSnapshot().comparisons.map(({ name }) => name), ["A", "B"]);

  store.remove(fragments[0]);
  storage.values.set(DEMO_SAVED_COMPARISONS_KEY, JSON.stringify({ schemaVersion: 1, comparisons: [{ name: "Externe", fragment: fragments[2] }] }));
  assert.equal(store.undo(), undefined);
  assert.deepEqual(store.getSnapshot().comparisons.map(({ name }) => name), ["Externe"]);
  assert.equal(store.getSnapshot().canUndo, false);
});

test("rename preserves an unrelated local removal undo and its original insertion index", () => {
  const storage = memory();
  const store = createSavedComparisonStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("A", fragments[0]);
  store.add("B", fragments[1]);
  store.add("C", fragments[2]);
  assert.equal(store.remove(fragments[0]), true);
  const expected = store.getSnapshot();
  assert.equal(expected.canUndo, true);

  assert.deepEqual(store.rename(fragments[1], "B renommée", expected), { ok: true, outcome: "renamed" });
  assert.equal(store.getSnapshot().canUndo, true);
  assert.deepEqual(store.undo(), { name: "A", fragment: fragments[0] });
  assert.deepEqual(store.getSnapshot().comparisons, [
    { name: "A", fragment: fragments[0] },
    { name: "B renommée", fragment: fragments[1] },
    { name: "C", fragment: fragments[2] },
  ]);
});

test("persisted mutations reread latest bytes and storage events read authority instead of payload", () => {
  const storage = memory();
  const store = createSavedComparisonStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("Locale", fragments[0]);
  storage.values.set(DEMO_SAVED_COMPARISONS_KEY, JSON.stringify({ schemaVersion: 1, comparisons: [{ name: "Externe", fragment: fragments[1] }] }));
  assert.deepEqual(store.add("Après", fragments[2]), { ok: true });
  assert.deepEqual(store.getSnapshot().comparisons.map(({ name }) => name), ["Externe", "Après"]);

  storage.values.delete(DEMO_SAVED_COMPARISONS_KEY);
  store.reconcileStorageEvent({ key: DEMO_SAVED_COMPARISONS_KEY, newValue: "stale", storageArea: storage });
  assert.deepEqual(store.getSnapshot().comparisons, []);
  store.add("Encore", fragments[0]);
  const other = memory();
  storage.values.delete(DEMO_SAVED_COMPARISONS_KEY);
  store.reconcileStorageEvent({ key: null, newValue: null, storageArea: other });
  assert.equal(store.getSnapshot().comparisons.length, 1);
  store.reconcileStorageEvent({ key: null, newValue: null, storageArea: storage });
  assert.equal(store.getSnapshot().comparisons.length, 0);
});

test("rename rejects every externally changed snapshot without overwriting or resurrecting data", () => {
  const cases = [
    {
      name: "renamed target",
      external: [{ name: "Externe", fragment: fragments[0] }, { name: "B", fragment: fragments[1] }],
    },
    {
      name: "removed target",
      external: [{ name: "B", fragment: fragments[1] }],
    },
    {
      name: "reordered collection",
      external: [{ name: "B", fragment: fragments[1] }, { name: "A", fragment: fragments[0] }],
    },
    {
      name: "unrelated changed bytes",
      external: [{ name: "A", fragment: fragments[0] }, { name: "B externe", fragment: fragments[1] }],
    },
  ];

  for (const scenario of cases) {
    const storage = memory();
    const store = createSavedComparisonStore({ storageProvider: () => storage });
    store.hydrate();
    store.add("A", fragments[0]);
    store.add("B", fragments[1]);
    const expected = store.getSnapshot();
    const externalBytes = comparisonBytes(scenario.external);
    storage.values.set(DEMO_SAVED_COMPARISONS_KEY, externalBytes);
    const writesBefore = storage.writes.length;

    assert.deepEqual(store.rename(fragments[0], `Locale ${scenario.name}`, expected), { ok: false, reason: "stale" }, scenario.name);
    assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), externalBytes, scenario.name);
    assert.equal(storage.writes.length, writesBefore, scenario.name);
    assert.deepEqual(store.getSnapshot().comparisons, scenario.external, scenario.name);
  }

  const resetStorage = memory();
  const resetStore = createSavedComparisonStore({ storageProvider: () => resetStorage });
  resetStore.hydrate();
  resetStore.add("A", fragments[0]);
  const resetExpected = resetStore.getSnapshot();
  resetStorage.values.delete(DEMO_SAVED_COMPARISONS_KEY);
  const resetWrites = resetStorage.writes.length;
  assert.deepEqual(resetStore.rename(fragments[0], "Locale", resetExpected), { ok: false, reason: "stale" });
  assert.equal(resetStorage.values.has(DEMO_SAVED_COMPARISONS_KEY), false);
  assert.equal(resetStorage.writes.length, resetWrites);
  assert.deepEqual(resetStore.getSnapshot().comparisons, []);
});

test("rename preserves corrupt and future bytes as readonly after an unseen replacement", () => {
  for (const [expectedStatus, externalBytes] of [
    ["corrupt", '{"schemaVersion":1,"comparisons":[{"name":"bad"}]}'],
    ["future", '{"schemaVersion":2,"comparisons":[],"policy":"external"}'],
  ]) {
    const storage = memory();
    const store = createSavedComparisonStore({ storageProvider: () => storage });
    store.hydrate();
    store.add("A", fragments[0]);
    const expected = store.getSnapshot();
    storage.values.set(DEMO_SAVED_COMPARISONS_KEY, externalBytes);
    const writesBefore = storage.writes.length;

    assert.deepEqual(store.rename(fragments[0], "Locale", expected), { ok: false, reason: "readonly" });
    assert.equal(store.getSnapshot().storageStatus, expectedStatus);
    assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), externalBytes);
    assert.equal(storage.writes.length, writesBefore);
  }
});

test("a persisted read failure invalidates the old snapshot, then permits an explicit session rename", () => {
  const storage = memory();
  let failReads = false;
  const getItem = storage.getItem;
  storage.getItem = (key) => {
    if (failReads) throw new DOMException("denied", "SecurityError");
    return getItem.call(storage, key);
  };
  const store = createSavedComparisonStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("A", fragments[0]);
  const persisted = store.getSnapshot();
  const writesBefore = storage.writes.length;
  failReads = true;

  assert.deepEqual(store.rename(fragments[0], "Session", persisted), { ok: false, reason: "stale" });
  const denied = store.getSnapshot();
  assert.equal(denied.storageStatus, "denied");
  assert.deepEqual(store.rename(fragments[0], "Session", denied), { ok: true, outcome: "renamed" });
  assert.equal(store.getSnapshot().storageStatus, "denied");
  assert.deepEqual(store.getSnapshot().comparisons, [{ name: "Session", fragment: fragments[0] }]);
  assert.equal(storage.writes.length, writesBefore);
  assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), comparisonBytes(persisted.comparisons));
});

test("quota and denied modes retain session comparisons without erasing preserved bytes", () => {
  const original = JSON.stringify({ schemaVersion: 1, comparisons: [] });
  const storage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: original });
  storage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  const quota = createSavedComparisonStore({ storageProvider: () => storage });
  quota.hydrate();
  assert.deepEqual(quota.add("Une", fragments[0]), { ok: true });
  assert.equal(quota.getSnapshot().storageStatus, "quota");
  assert.deepEqual(quota.add("Deux", fragments[1]), { ok: true });
  assert.deepEqual(quota.getSnapshot().comparisons.map(({ name }) => name), ["Une", "Deux"]);
  assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), original);
  quota.reconcileStorageEvent({ key: DEMO_SAVED_COMPARISONS_KEY, newValue: original, storageArea: storage });
  assert.equal(quota.getSnapshot().comparisons.length, 2);
  assert.deepEqual(quota.reset(), { ok: true, scope: "session" });
  assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), original);

  const denied = createSavedComparisonStore({ storageProvider() { throw new DOMException("denied", "SecurityError"); } });
  assert.equal(denied.hydrate().storageStatus, "denied");
  assert.deepEqual(denied.add("Session", fragments[0]), { ok: true });
  assert.equal(denied.getSnapshot().storageStatus, "denied");
});

test("rename remains memory-only in quota and denied modes", () => {
  const original = comparisonBytes([{ name: "Persistée", fragment: fragments[0] }]);
  const quotaStorage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: original });
  quotaStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  const quota = createSavedComparisonStore({ storageProvider: () => quotaStorage });
  quota.hydrate();
  assert.deepEqual(quota.add("Session", fragments[1]), { ok: true });
  const quotaSnapshot = quota.getSnapshot();
  assert.equal(quotaSnapshot.storageStatus, "quota");
  assert.deepEqual(quota.rename(fragments[0], "Quota", quotaSnapshot), { ok: true, outcome: "renamed" });
  assert.equal(quota.getSnapshot().storageStatus, "quota");
  assert.equal(quota.getSnapshot().comparisons[0].name, "Quota");
  assert.equal(quotaStorage.values.get(DEMO_SAVED_COMPARISONS_KEY), original);

  const denied = createSavedComparisonStore({ storageProvider() { throw new DOMException("denied", "SecurityError"); } });
  denied.hydrate();
  denied.add("Session", fragments[0]);
  const deniedSnapshot = denied.getSnapshot();
  assert.deepEqual(denied.rename(fragments[0], "Mémoire", deniedSnapshot), { ok: true, outcome: "renamed" });
  assert.deepEqual(denied.getSnapshot().comparisons, [{ name: "Mémoire", fragment: fragments[0] }]);
  assert.equal(denied.getSnapshot().storageStatus, "denied");
});

test("corrupt reset is exact-byte guarded and never erases a future replacement", () => {
  const corruptBytes = '{"schemaVersion":1,"comparisons":[{"name":"bad"}]}';
  const storage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: corruptBytes });
  const store = createSavedComparisonStore({ storageProvider: () => storage });
  assert.equal(store.hydrate().storageStatus, "corrupt");
  storage.values.set(DEMO_SAVED_COMPARISONS_KEY, JSON.stringify({ schemaVersion: 1, comparisons: [{ name: "Récupérée", fragment: fragments[0] }] }));
  assert.deepEqual(store.reset(), { ok: false });
  assert.equal(store.getSnapshot().storageStatus, "persisted");

  const futureReplacement = JSON.stringify({ schemaVersion: 3, comparisons: [], policy: "x".repeat(17_000) });
  storage.values.set(DEMO_SAVED_COMPARISONS_KEY, futureReplacement);
  assert.deepEqual(store.reset(), { ok: false });
  assert.equal(store.getSnapshot().storageStatus, "future");
  assert.equal(storage.values.get(DEMO_SAVED_COMPARISONS_KEY), futureReplacement);

  const resetStorage = memory({ [DEMO_SAVED_COMPARISONS_KEY]: corruptBytes });
  const resettable = createSavedComparisonStore({ storageProvider: () => resetStorage });
  resettable.hydrate();
  assert.deepEqual(resettable.reset(), { ok: true, scope: "persisted" });
  assert.equal(resetStorage.values.has(DEMO_SAVED_COMPARISONS_KEY), false);
});

test("saved comparison and saved search stores remain isolated by key", () => {
  const storage = memory();
  const comparisons = createSavedComparisonStore({ storageProvider: () => storage });
  const searches = createSavedSearchStore({ storageProvider: () => storage });
  comparisons.hydrate();
  searches.hydrate();
  comparisons.add("Comparaison", fragments[0]);
  searches.add("Recherche", { query: { schemaVersion: 2, sort: "listing_asc" } });
  const searchBytes = storage.values.get(DEMO_SAVED_SEARCHES_KEY);
  const storedComparisonBytes = storage.values.get(DEMO_SAVED_COMPARISONS_KEY);
  const expected = comparisons.getSnapshot();
  assert.deepEqual(comparisons.rename(fragments[0], "Comparaison renommée", expected), { ok: true, outcome: "renamed" });
  assert.equal(storage.values.get(DEMO_SAVED_SEARCHES_KEY), searchBytes);
  comparisons.reset();
  assert.equal(storage.values.get(DEMO_SAVED_SEARCHES_KEY), searchBytes);
  assert.equal(storage.values.has(DEMO_SAVED_COMPARISONS_KEY), false);
  assert.ok(storedComparisonBytes);
  searches.reset();
  assert.equal(storage.values.has(DEMO_SAVED_SEARCHES_KEY), false);
});
