/* global DOMException */
import assert from "node:assert/strict";
import test from "node:test";
import { createFavoritesStore, DEMO_FAVORITES_KEY } from "../.test-dist/src/demo/favorites.js";

function memory(initial = null) {
  let value = initial;
  return { get value() { return value; }, getItem(key) { assert.equal(key, DEMO_FAVORITES_KEY); return value; }, setItem(key, next) { assert.equal(key, DEMO_FAVORITES_KEY); value = next; }, removeItem(key) { assert.equal(key, DEMO_FAVORITES_KEY); value = null; } };
}

test("favorites persist canonical insertion order and undo against current cross-tab state", () => {
  const storage = memory();
  const store = createFavoritesStore({ storageProvider: () => storage });
  assert.equal(store.getServerSnapshot().storageStatus, "unhydrated");
  assert.equal(store.hydrate().storageStatus, "persisted");
  assert.equal(store.add("lst_first"), true);
  assert.equal(store.add("lst_second"), true);
  assert.equal(store.remove("lst_first"), true);
  store.reconcileStorageEvent({ key: DEMO_FAVORITES_KEY, newValue: JSON.stringify({ schemaVersion: 1, listingIds: ["lst_second", "lst_third"] }), storageArea: storage });
  assert.equal(store.undo(), true);
  assert.deepEqual(store.getSnapshot().listingIds, ["lst_first", "lst_second", "lst_third"]);
  assert.deepEqual(JSON.parse(storage.value), { schemaVersion: 1, listingIds: ["lst_first", "lst_second", "lst_third"] });
});

test("future and corrupt values are preserved until an allowed explicit reset", () => {
  const futureBytes = '{"schemaVersion":2,"listingIds":["lst_future"],"newPolicy":{"mode":"future"}}';
  const futureStorage = memory(futureBytes);
  const future = createFavoritesStore({ storageProvider: () => futureStorage });
  assert.equal(future.hydrate().storageStatus, "future");
  assert.equal(future.add("lst_session"), true);
  assert.equal(futureStorage.value, futureBytes);
  assert.equal(future.reset(), false);
  assert.equal(futureStorage.value, futureBytes);

  const corruptStorage = memory('{"schemaVersion":1,"listingIds":["lst_a","lst_a"]}');
  const corrupt = createFavoritesStore({ storageProvider: () => corruptStorage });
  assert.equal(corrupt.hydrate().storageStatus, "corrupt");
  assert.equal(corrupt.reset(), true);
  assert.equal(corruptStorage.value, null);
});

test("denied and quota storage stay explicit while session favorites remain usable", () => {
  const denied = createFavoritesStore({ storageProvider() { throw new DOMException("denied", "SecurityError"); } });
  assert.equal(denied.hydrate().storageStatus, "denied");
  assert.equal(denied.add("lst_session"), true);
  assert.deepEqual(denied.getSnapshot().listingIds, ["lst_session"]);
  assert.equal(denied.getSnapshot().storageStatus, "session");
  const quotaStorage = memory();
  quotaStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  const quota = createFavoritesStore({ storageProvider: () => quotaStorage });
  quota.hydrate();
  quota.add("lst_quota");
  assert.equal(quota.getSnapshot().storageStatus, "quota");
});

test("a failed read quarantines writes until explicit recovery", () => {
  let original = '{"schemaVersion":1,"listingIds":["lst_existing"]}';
  let writes = 0;
  const storage = {
    getItem() { throw new DOMException("denied", "SecurityError"); },
    setItem(_key, value) { writes += 1; original = value; },
    removeItem() { original = null; },
  };
  const store = createFavoritesStore({ storageProvider: () => storage });
  assert.equal(store.hydrate().storageStatus, "denied");
  assert.equal(store.add("lst_session"), true);
  assert.equal(store.getSnapshot().storageStatus, "session");
  assert.equal(writes, 0);
  assert.equal(original, '{"schemaVersion":1,"listingIds":["lst_existing"]}');
  store.reconcileStorageEvent({ key: DEMO_FAVORITES_KEY, newValue: original, storageArea: storage });
  assert.equal(store.add("lst_after_recovery"), true);
  assert.equal(writes, 1);
});

test("cross-tab reconciliation clears undo when restoration is no longer applicable", () => {
  const storage = memory();
  const store = createFavoritesStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("lst_removed");
  store.add("lst_base");
  store.remove("lst_removed");
  assert.equal(store.getSnapshot().canUndo, true);
  store.reconcileStorageEvent({ key: DEMO_FAVORITES_KEY, newValue: JSON.stringify({ schemaVersion: 1, listingIds: ["lst_removed", "lst_base"] }), storageArea: storage });
  assert.equal(store.getSnapshot().canUndo, false);
  assert.equal(store.undo(), false);

  store.remove("lst_removed");
  assert.equal(store.getSnapshot().canUndo, true);
  const full = Array.from({ length: 100 }, (_, index) => `lst_full_${index}`);
  store.reconcileStorageEvent({ key: DEMO_FAVORITES_KEY, newValue: JSON.stringify({ schemaVersion: 1, listingIds: full }), storageArea: storage });
  assert.equal(store.getSnapshot().listingIds.length, 100);
  assert.equal(store.getSnapshot().canUndo, false);
  assert.equal(store.undo(), false);
});

test("favorites enforce exact shape, valid IDs and the 100 item ceiling", () => {
  const storage = memory();
  const store = createFavoritesStore({ storageProvider: () => storage });
  store.hydrate();
  for (let index = 0; index < 100; index += 1) assert.equal(store.add(`lst_${index}`), true);
  assert.equal(store.add("lst_100"), false);
  assert.equal(store.add("invalid"), false);
  assert.equal(store.getSnapshot().listingIds.length, 100);
  store.reconcileStorageEvent({ key: DEMO_FAVORITES_KEY, newValue: '{"schemaVersion":1,"listingIds":[],"tracking":"x"}', storageArea: storage });
  assert.equal(store.getSnapshot().storageStatus, "corrupt");
  assert.equal(store.getSnapshot().listingIds.length, 100);
  store.reconcileStorageEvent({ key: DEMO_FAVORITES_KEY, newValue: '{ "schemaVersion":1,"listingIds":[]}', storageArea: storage });
  assert.equal(store.getSnapshot().storageStatus, "corrupt");
});
