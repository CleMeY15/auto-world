/* global DOMException */
import assert from "node:assert/strict";
import test from "node:test";

import { encodeComparisonLinkFragment } from "../.test-dist/src/demo/comparison-link.js";
import {
  createSavedComparisonStore,
  DEMO_SAVED_COMPARISONS_KEY,
  SAVED_COMPARISON_LIMIT,
} from "../.test-dist/src/demo/saved-comparisons.js";
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

test("saved comparisons persist canonical fragments with normalized names and cached immutable snapshots", () => {
  let providerCalls = 0;
  const storage = memory();
  const store = createSavedComparisonStore({ storageProvider: () => { providerCalls += 1; return storage; } });
  const server = store.getServerSnapshot();
  assert.equal(server.storageStatus, "unhydrated");
  assert.equal(providerCalls, 0);
  assert.deepEqual(store.add("Trop tôt", fragments[0]), { ok: false, reason: "readonly" });
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
  const comparisonBytes = storage.values.get(DEMO_SAVED_COMPARISONS_KEY);
  comparisons.reset();
  assert.equal(storage.values.get(DEMO_SAVED_SEARCHES_KEY), searchBytes);
  assert.equal(storage.values.has(DEMO_SAVED_COMPARISONS_KEY), false);
  assert.ok(comparisonBytes);
  searches.reset();
  assert.equal(storage.values.has(DEMO_SAVED_SEARCHES_KEY), false);
});
