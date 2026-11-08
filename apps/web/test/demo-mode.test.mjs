import assert from "node:assert/strict";
import test from "node:test";

import { demoBackendLabel, demoBackendOrigin, resolveDemoBackendMode } from "../.test-dist/src/demo/backend.js";
import { encodeComparisonLinkFragment } from "../.test-dist/src/demo/comparison-link.js";
import { createFavoritesStore, DEMO_FAVORITES_KEY, PROTOTYPE_FAVORITES_KEY } from "../.test-dist/src/demo/favorites.js";
import { createSavedComparisonStore, DEMO_SAVED_COMPARISONS_KEY, PROTOTYPE_SAVED_COMPARISONS_KEY } from "../.test-dist/src/demo/saved-comparisons.js";
import { createSavedSearchStore, DEMO_SAVED_SEARCHES_KEY, getSavedSearchKey, PROTOTYPE_SAVED_SEARCHES_KEY } from "../.test-dist/src/demo/saved-searches.js";
import { demoStorageKeys } from "../.test-dist/src/demo/storage-namespace.js";

function memory(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("backend mode resolution is closed and keeps the historical offline default", () => {
  assert.equal(resolveDemoBackendMode({ AUTO_WORLD_DEMO: "1" }), "offline");
  assert.equal(resolveDemoBackendMode({ AUTO_WORLD_DEMO: "1", AUTO_WORLD_WEB_BACKEND: "" }), "offline");
  assert.equal(resolveDemoBackendMode({ AUTO_WORLD_DEMO: "1", AUTO_WORLD_WEB_BACKEND: "offline" }), "offline");
  assert.equal(resolveDemoBackendMode({ AUTO_WORLD_DEMO: "1", AUTO_WORLD_WEB_BACKEND: "prototype" }), "prototype");
  for (const environment of [
    {},
    { AUTO_WORLD_DEMO: "0", AUTO_WORLD_WEB_BACKEND: "prototype" },
    { AUTO_WORLD_DEMO: "1", AUTO_WORLD_WEB_BACKEND: "disabled" },
    { AUTO_WORLD_DEMO: "1", AUTO_WORLD_WEB_BACKEND: "http://127.0.0.1:9999" },
    { AUTO_WORLD_DEMO: "1", AUTO_WORLD_WEB_BACKEND: "PROTOTYPE" },
  ]) assert.equal(resolveDemoBackendMode(environment), "disabled");
  assert.equal(demoBackendOrigin("offline"), "http://127.0.0.1:3210");
  assert.equal(demoBackendOrigin("prototype"), "http://127.0.0.1:3211");
  assert.equal(demoBackendLabel("prototype"), "Prototype local persistant");
});

test("offline and prototype stores use three fixed disjoint keys", () => {
  assert.deepEqual(demoStorageKeys("offline"), {
    favorites: DEMO_FAVORITES_KEY,
    savedSearches: DEMO_SAVED_SEARCHES_KEY,
    savedComparisons: DEMO_SAVED_COMPARISONS_KEY,
  });
  assert.deepEqual(demoStorageKeys("prototype"), {
    favorites: PROTOTYPE_FAVORITES_KEY,
    savedSearches: PROTOTYPE_SAVED_SEARCHES_KEY,
    savedComparisons: PROTOTYPE_SAVED_COMPARISONS_KEY,
  });
  assert.equal(new Set([...Object.values(demoStorageKeys("offline")), ...Object.values(demoStorageKeys("prototype"))]).size, 6);
  assert.throws(() => demoStorageKeys("arbitrary"));
});

test("prototype mutations leave every offline byte untouched and ignore offline events", () => {
  const offlineBytes = {
    [DEMO_FAVORITES_KEY]: JSON.stringify({ schemaVersion: 1, listingIds: ["lst_offline"] }),
    [DEMO_SAVED_SEARCHES_KEY]: JSON.stringify({ schemaVersion: 1, searches: [] }),
    [DEMO_SAVED_COMPARISONS_KEY]: JSON.stringify({ schemaVersion: 1, comparisons: [] }),
  };
  const storage = memory(offlineBytes);
  const favorites = createFavoritesStore({ namespace: "prototype", storageProvider: () => storage });
  const searches = createSavedSearchStore({ namespace: "prototype", storageProvider: () => storage });
  const comparisons = createSavedComparisonStore({ namespace: "prototype", storageProvider: () => storage });
  favorites.hydrate(); searches.hydrate(); comparisons.hydrate();

  assert.equal(favorites.add("lst_prototype-one"), true);
  assert.deepEqual(searches.add("Prototype", { query: { schemaVersion: 2, sort: "listing_asc" } }), { ok: true });
  const fragment = encodeComparisonLinkFragment(["lst_prototype-one", "lst_prototype-two"]);
  assert.deepEqual(comparisons.add("Prototype", fragment), { ok: true });

  const savedSearchKey = getSavedSearchKey(searches.getSnapshot().searches[0].criteria);
  assert.equal(favorites.remove("lst_prototype-one"), true);
  assert.equal(searches.remove(savedSearchKey), true);
  assert.equal(comparisons.remove(fragment), true);

  favorites.reconcileStorageEvent({ key: DEMO_FAVORITES_KEY, newValue: null, storageArea: storage });
  searches.reconcileStorageEvent({ key: DEMO_SAVED_SEARCHES_KEY, newValue: null, storageArea: storage });
  comparisons.reconcileStorageEvent({ key: DEMO_SAVED_COMPARISONS_KEY, newValue: null, storageArea: storage });
  assert.equal(favorites.undo(), true);
  assert.equal(searches.undo()?.name, "Prototype");
  assert.equal(comparisons.undo()?.name, "Prototype");
  assert.deepEqual(favorites.getSnapshot().listingIds, ["lst_prototype-one"]);
  assert.equal(searches.getSnapshot().searches.length, 1);
  assert.equal(comparisons.getSnapshot().comparisons.length, 1);

  for (const [key, bytes] of Object.entries(offlineBytes)) assert.equal(storage.values.get(key), bytes);
  assert.ok(storage.values.has(PROTOTYPE_FAVORITES_KEY));
  assert.ok(storage.values.has(PROTOTYPE_SAVED_SEARCHES_KEY));
  assert.ok(storage.values.has(PROTOTYPE_SAVED_COMPARISONS_KEY));

  assert.equal(favorites.reset(), true);
  assert.deepEqual(searches.reset(), { ok: true, scope: "persisted" });
  assert.deepEqual(comparisons.reset(), { ok: true, scope: "persisted" });
  for (const [key, bytes] of Object.entries(offlineBytes)) assert.equal(storage.values.get(key), bytes);
  assert.equal(storage.values.has(PROTOTYPE_FAVORITES_KEY), false);
  assert.equal(storage.values.has(PROTOTYPE_SAVED_SEARCHES_KEY), false);
  assert.equal(storage.values.has(PROTOTYPE_SAVED_COMPARISONS_KEY), false);
});
