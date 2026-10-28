/* global DOMException */
import assert from "node:assert/strict";
import test from "node:test";
import { parseFilterInputV2 } from "../.test-dist/src/demo/model.js";
import {
  captureSavedSearchCriteria,
  createSavedSearchStore,
  DEMO_SAVED_SEARCHES_KEY,
  getSavedSearchKey,
  matchingSavedSearchCatalog,
  SAVED_SEARCH_LIMIT,
  savedSearchToFilterInput,
} from "../.test-dist/src/demo/saved-searches.js";

const release = { catalogId: "taxcat_saved", releaseId: "taxrel_saved_v1", revision: 1 };
const makeId = "make_saved";
const modelId = "model_saved";
const catalog = {
  schemaVersion: 2,
  dataMode: "synthetic",
  fixtureVersion: "saved-v1",
  taxonomyRelease: {
    schemaVersion: 1,
    ...release,
    releasedAt: "2026-10-15T08:00:00.000Z",
    dataMode: "synthetic",
    attributions: [{ attributionId: "taxattr_saved", kind: "synthetic_fixture", fixtureRef: "saved/searches" }],
    makes: [{ makeId, primaryName: { value: "Marque enregistrée", attributionId: "taxattr_saved" }, aliases: [] }],
    models: [{ modelId, makeId, primaryName: { value: "Modèle enregistré", attributionId: "taxattr_saved" }, aliases: [] }],
  },
};
const response = {
  schemaVersion: 2,
  dataMode: "synthetic",
  fixtureVersion: "saved-v1",
  taxonomyRelease: release,
  dataAsOf: "2026-10-15T08:00:00.000Z",
  state: "complete",
  results: [],
  totalCount: 0,
};
const numericCriteria = { query: { schemaVersion: 2, sort: "listing_asc", priceMaxMinor: 12345, mileageMaxKm: 123.5 } };
const identityCriteria = { query: { schemaVersion: 2, sort: "price_asc", makeId, modelId, firstRegistrationYear: 2022 }, binding: { fixtureVersion: "saved-v1", taxonomyRelease: release } };

function memory(initial = null) {
  let value = initial;
  return {
    get value() { return value; },
    set value(next) { value = next; },
    getItem(key) { assert.equal(key, DEMO_SAVED_SEARCHES_KEY); return value; },
    setItem(key, next) { assert.equal(key, DEMO_SAVED_SEARCHES_KEY); value = next; },
    removeItem(key) { assert.equal(key, DEMO_SAVED_SEARCHES_KEY); value = null; },
  };
}

test("pure helpers capture cursorless criteria and require the exact catalogue for identity", () => {
  const cursor = `cur_${"a".repeat(64)}`;
  const captured = captureSavedSearchCriteria({ ...identityCriteria.query, cursor }, response, response.dataAsOf);
  assert.ok(captured);
  assert.equal("cursor" in captured.query, false);
  assert.deepEqual(captured.binding, { fixtureVersion: "saved-v1", taxonomyRelease: release });
  assert.equal(Object.isFrozen(captured), true);
  assert.equal(Object.isFrozen(captured.query), true);
  assert.ok(matchingSavedSearchCatalog(captured, catalog));
  assert.equal(matchingSavedSearchCatalog(captured, { ...catalog, fixtureVersion: "other" }), undefined);
  assert.equal(matchingSavedSearchCatalog(captured, { ...catalog, taxonomyRelease: { ...catalog.taxonomyRelease, models: [] } }), undefined);
  assert.equal(savedSearchToFilterInput(captured), undefined);
  assert.deepEqual(savedSearchToFilterInput(captured, undefined, true), {
    priceMaxEUR: "", mileageMaxKm: "", sort: "price_asc", text: "", makeId: "", modelId: "", firstRegistrationYear: "2022",
  });
});

test("capture validates projection freshness at receipt time, not its observation time", () => {
  const stale = { ...response, state: "stale", reason: "projection_stale" };
  delete stale.totalCount;
  const receivedAt = "2026-10-15T08:01:00.001Z";
  assert.deepEqual(captureSavedSearchCriteria(numericCriteria.query, stale, receivedAt), numericCriteria);
  assert.equal(captureSavedSearchCriteria(numericCriteria.query, stale, response.dataAsOf), undefined);
  assert.equal(captureSavedSearchCriteria(numericCriteria.query, response, receivedAt), undefined);
  assert.ok(captureSavedSearchCriteria(numericCriteria.query, response, response.dataAsOf));
});

test("form restoration round-trips exact safe cents and exponent-form mileage", () => {
  for (const criteria of [
    { query: { schemaVersion: 2, sort: "price_desc", priceMaxMinor: 0, mileageMaxKm: 0 } },
    { query: { schemaVersion: 2, sort: "mileage_asc", priceMaxMinor: Number.MAX_SAFE_INTEGER, mileageMaxKm: 1e-7 } },
    { query: { schemaVersion: 2, sort: "mileage_desc", mileageMaxKm: Number.MIN_VALUE } },
  ]) {
    const input = savedSearchToFilterInput(criteria);
    assert.ok(input);
    const parsed = parseFilterInputV2(input);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.query, criteria.query);
  }
  for (const sort of ["listing_asc", "price_asc", "price_desc", "mileage_asc", "mileage_desc"]) {
    const input = savedSearchToFilterInput({ query: { schemaVersion: 2, sort } });
    assert.equal(parseFilterInputV2(input).query.sort, sort);
  }
  assert.equal(
    getSavedSearchKey({ query: { schemaVersion: 2, sort: "listing_asc", mileageMaxKm: -0 } }),
    getSavedSearchKey({ query: { schemaVersion: 2, sort: "listing_asc", mileageMaxKm: 0 } }),
  );
});

test("store hydrates without server reads, normalizes names, persists canonical identity and undo order", () => {
  let providerCalls = 0;
  const storage = memory();
  const store = createSavedSearchStore({ storageProvider: () => { providerCalls += 1; return storage; } });
  assert.equal(store.getServerSnapshot().storageStatus, "unhydrated");
  assert.equal(providerCalls, 0);
  assert.equal(store.add("too early", numericCriteria).reason, "readonly");
  store.hydrate();
  assert.equal(providerCalls, 1);
  const hydratedSnapshot = store.getSnapshot();
  assert.strictEqual(store.getSnapshot(), hydratedSnapshot);
  assert.deepEqual(store.add("  E\u0301lectrique  ", numericCriteria), { ok: true });
  assert.deepEqual(store.add("Même filtre", numericCriteria), { ok: false, reason: "duplicate" });
  assert.equal(store.getSnapshot().searches[0].name, "Électrique");
  const firstKey = getSavedSearchKey(numericCriteria);
  assert.equal(store.remove(firstKey), true);
  assert.equal(store.getSnapshot().canUndo, true);
  assert.deepEqual(store.undo(), { name: "Électrique", criteria: numericCriteria });
  assert.deepEqual(JSON.parse(storage.value), { schemaVersion: 1, searches: [{ name: "Électrique", criteria: numericCriteria }] });
  assert.equal(Object.isFrozen(store.getSnapshot()), true);
  assert.equal(Object.isFrozen(store.getSnapshot().searches), true);
  assert.equal(Object.isFrozen(store.getSnapshot().searches[0].criteria.query), true);
});

test("store rejects hostile direct values, invalid names, cursor, missing bindings and capacity overflow", () => {
  const storage = memory();
  const store = createSavedSearchStore({ storageProvider: () => storage });
  store.hydrate();
  let getterCalls = 0;
  const query = {};
  Object.defineProperty(query, "schemaVersion", { enumerable: true, get() { getterCalls += 1; return 2; } });
  Object.defineProperty(query, "sort", { enumerable: true, value: "listing_asc" });
  assert.deepEqual(store.add("Getter", { query }), { ok: false, reason: "invalid" });
  assert.equal(getterCalls, 0);
  for (const prototypeValue of [null, 0]) {
    const prototypeQuery = { schemaVersion: 2, sort: "listing_asc" };
    Object.defineProperty(prototypeQuery, "__proto__", { enumerable: true, value: prototypeValue });
    assert.deepEqual(store.add("Prototype", { query: prototypeQuery }), { ok: false, reason: "invalid" });
  }
  const hostile = new Proxy({}, { ownKeys() { throw new Error("hostile proxy"); } });
  assert.doesNotThrow(() => store.add("Proxy", hostile));
  assert.deepEqual(store.add("Proxy", hostile), { ok: false, reason: "invalid" });
  for (const bad of ["", "\u0000", "\u202etest", "\ud800", "x".repeat(61)]) assert.equal(store.add(bad, numericCriteria).reason, "invalid");
  assert.equal(store.add("Cursor", { query: { ...numericCriteria.query, cursor: `cur_${"b".repeat(64)}` } }).reason, "invalid");
  assert.equal(store.add("Sans provenance", { query: identityCriteria.query }).reason, "invalid");
  assert.equal(store.add("Provenance inutile", { query: numericCriteria.query, binding: identityCriteria.binding }).reason, "invalid");
  assert.equal(store.add("Provenance absente", { query: numericCriteria.query, binding: undefined }).reason, "invalid");
  assert.equal(store.add("Provenance ligne", { query: identityCriteria.query, binding: { ...identityCriteria.binding, fixtureVersion: "saved-v1\n" } }).reason, "invalid");
  for (let index = 0; index < SAVED_SEARCH_LIMIT; index += 1) assert.deepEqual(store.add(`Recherche ${index}`, { query: { schemaVersion: 2, sort: "listing_asc", mileageMaxKm: index } }), { ok: true });
  assert.deepEqual(store.add("Pleine", { query: { schemaVersion: 2, sort: "listing_asc", mileageMaxKm: 99 } }), { ok: false, reason: "full" });
});

test("decode rejects extra, duplicate, prototype, duplicate criteria, noncanonical names, oversize and future bytes", () => {
  const invalidValues = [
    '{"schemaVersion":1,"searches":[],"tracking":"x"}',
    '{"schemaVersion":1,"schemaVersion":1,"searches":[]}',
    '{"schemaVersion":1,"searches":[],"__proto__":{}}',
    JSON.stringify({ schemaVersion: 1, searches: [{ name: " spaced ", criteria: numericCriteria }] }),
    JSON.stringify({ schemaVersion: 1, searches: [{ name: "A", criteria: numericCriteria }, { name: "B", criteria: numericCriteria }] }),
    `{"schemaVersion":1,"searches":[],"padding":"${"x".repeat(17_000)}"}`,
  ];
  for (const value of invalidValues) {
    const store = createSavedSearchStore({ storageProvider: () => memory(value) });
    assert.equal(store.hydrate().storageStatus, "corrupt");
    assert.equal(store.add("Blocked", numericCriteria).reason, "readonly");
  }
  const futureBytes = '{"schemaVersion":2,"searches":[],"policy":"future"}';
  const futureStorage = memory(futureBytes);
  const future = createSavedSearchStore({ storageProvider: () => futureStorage });
  assert.equal(future.hydrate().storageStatus, "future");
  assert.deepEqual(future.reset(), { ok: false });
  assert.equal(futureStorage.value, futureBytes);
});

test("persisted mutations reread latest state and actual events ignore stale payloads and wrong storage", () => {
  const storage = memory();
  const store = createSavedSearchStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("Local", numericCriteria);
  const externalCriteria = { query: { schemaVersion: 2, sort: "price_desc", mileageMaxKm: 7 } };
  storage.value = JSON.stringify({ schemaVersion: 1, searches: [{ name: "Externe", criteria: externalCriteria }] });
  assert.deepEqual(store.add("Après", identityCriteria), { ok: true });
  assert.deepEqual(store.getSnapshot().searches.map((item) => item.name), ["Externe", "Après"]);
  storage.value = null;
  store.reconcileStorageEvent({ key: DEMO_SAVED_SEARCHES_KEY, newValue: "stale", storageArea: storage });
  assert.deepEqual(store.getSnapshot().searches, []);
  store.add("Encore", numericCriteria);
  const other = memory();
  storage.value = null;
  store.reconcileStorageEvent({ key: null, newValue: null, storageArea: other });
  assert.equal(store.getSnapshot().searches.length, 1);
  store.reconcileStorageEvent({ key: null, newValue: null, storageArea: storage });
  assert.equal(store.getSnapshot().searches.length, 0);
});

test("noncanonical valid JSON is accepted and canonicalized by the next explicit mutation", () => {
  const storage = memory(`{ "searches" : [ { "criteria" : { "query" : { "sort" : "listing_asc", "schemaVersion" : 2 } }, "name" : "Valide" } ], "schemaVersion" : 1 }`);
  const store = createSavedSearchStore({ storageProvider: () => storage });
  assert.equal(store.hydrate().storageStatus, "persisted");
  assert.deepEqual(store.add("Deux", numericCriteria), { ok: true });
  assert.equal(storage.value, JSON.stringify({ schemaVersion: 1, searches: [
    { name: "Valide", criteria: { query: { schemaVersion: 2, sort: "listing_asc" } } },
    { name: "Deux", criteria: numericCriteria },
  ] }));
});

test("quota and denied sessions retain local edits and preserve original bytes", () => {
  const original = JSON.stringify({ schemaVersion: 1, searches: [] });
  const storage = memory(original);
  storage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  const quota = createSavedSearchStore({ storageProvider: () => storage });
  quota.hydrate();
  assert.deepEqual(quota.add("Un", numericCriteria), { ok: true });
  assert.equal(quota.getSnapshot().storageStatus, "quota");
  assert.deepEqual(quota.add("Deux", identityCriteria), { ok: true });
  assert.deepEqual(quota.getSnapshot().searches.map((item) => item.name), ["Un", "Deux"]);
  assert.equal(storage.value, original);
  quota.reconcileStorageEvent({ key: DEMO_SAVED_SEARCHES_KEY, newValue: original, storageArea: storage });
  assert.equal(quota.getSnapshot().searches.length, 2);
  assert.deepEqual(quota.reset(), { ok: true, scope: "session" });
  assert.equal(storage.value, original);

  const denied = createSavedSearchStore({ storageProvider() { throw new DOMException("denied", "SecurityError"); } });
  assert.equal(denied.hydrate().storageStatus, "denied");
  assert.deepEqual(denied.add("Session", numericCriteria), { ok: true });
  assert.equal(denied.getSnapshot().storageStatus, "denied");
});

test("corrupt reset is guarded by exact observed bytes and future replacement is never erased", () => {
  const corruptBytes = '{"schemaVersion":1,"searches":[{"name":"bad"}]}';
  const storage = memory(corruptBytes);
  const store = createSavedSearchStore({ storageProvider: () => storage });
  assert.equal(store.hydrate().storageStatus, "corrupt");
  storage.value = JSON.stringify({ schemaVersion: 1, searches: [{ name: "Recovered", criteria: numericCriteria }] });
  assert.deepEqual(store.reset(), { ok: false });
  assert.equal(store.getSnapshot().storageStatus, "persisted");
  assert.equal(storage.value, JSON.stringify({ schemaVersion: 1, searches: [{ name: "Recovered", criteria: numericCriteria }] }));
  storage.value = '{"schemaVersion":3,"searches":[]}';
  assert.deepEqual(store.reset(), { ok: false });
  assert.equal(store.getSnapshot().storageStatus, "future");
  assert.equal(storage.value, '{"schemaVersion":3,"searches":[]}');

  const resetStorage = memory(corruptBytes);
  const resettable = createSavedSearchStore({ storageProvider: () => resetStorage });
  resettable.hydrate();
  assert.deepEqual(resettable.reset(), { ok: true, scope: "persisted" });
  assert.equal(resetStorage.value, null);
});

test("latest corrupt data blocks a mutation and a failed reset retains memory and bytes", () => {
  const storage = memory();
  const store = createSavedSearchStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("Sûre", numericCriteria);
  const corrupt = '{"schemaVersion":1,"searches":[{"name":"incomplète"}]}';
  storage.value = corrupt;
  assert.deepEqual(store.add("Bloquée", identityCriteria), { ok: false, reason: "readonly" });
  assert.equal(store.getSnapshot().storageStatus, "corrupt");
  assert.deepEqual(store.getSnapshot().searches.map((item) => item.name), ["Sûre"]);
  storage.removeItem = () => { throw new DOMException("denied", "SecurityError"); };
  assert.deepEqual(store.reset(), { ok: false });
  assert.equal(storage.value, corrupt);
  assert.deepEqual(store.getSnapshot().searches.map((item) => item.name), ["Sûre"]);
});

test("external replacement clears undo and prevents resurrection", () => {
  const storage = memory();
  const store = createSavedSearchStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("À supprimer", numericCriteria);
  store.remove(getSavedSearchKey(numericCriteria));
  assert.equal(store.getSnapshot().canUndo, true);
  storage.value = JSON.stringify({ schemaVersion: 1, searches: [{ name: "Autre", criteria: identityCriteria }] });
  store.reconcileStorageEvent({ key: DEMO_SAVED_SEARCHES_KEY, newValue: storage.value, storageArea: storage });
  assert.equal(store.getSnapshot().canUndo, false);
  assert.equal(store.undo(), undefined);
});

test("undo is no longer offered when its criterion is re-added or the store becomes full", () => {
  const storage = memory();
  const store = createSavedSearchStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("Originale", numericCriteria);
  store.remove(getSavedSearchKey(numericCriteria));
  assert.equal(store.getSnapshot().canUndo, true);
  assert.deepEqual(store.add("Réajoutée", numericCriteria), { ok: true });
  assert.equal(store.getSnapshot().canUndo, false);

  store.remove(getSavedSearchKey(numericCriteria));
  for (let index = 0; index < SAVED_SEARCH_LIMIT; index += 1) {
    assert.deepEqual(store.add(`Remplissage ${index}`, { query: { schemaVersion: 2, sort: "listing_asc", mileageMaxKm: index } }), { ok: true });
  }
  assert.equal(store.getSnapshot().searches.length, SAVED_SEARCH_LIMIT);
  assert.equal(store.getSnapshot().canUndo, false);
  assert.equal(store.undo(), undefined);
});

test("undo rechecks removal after its persisted reread observes an external replacement", () => {
  const storage = memory();
  const store = createSavedSearchStore({ storageProvider: () => storage });
  store.hydrate();
  store.add("À supprimer", numericCriteria);
  store.remove(getSavedSearchKey(numericCriteria));
  storage.value = JSON.stringify({ schemaVersion: 1, searches: [{ name: "Autre", criteria: identityCriteria }] });
  assert.equal(store.undo(), undefined);
  assert.deepEqual(store.getSnapshot().searches.map((item) => item.name), ["Autre"]);
  assert.equal(store.getSnapshot().canUndo, false);
});
