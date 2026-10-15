import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPARISON_LIMIT,
  comparisonConflicts,
  comparisonRows,
  selectComparisonEntries,
  toggleComparisonSelection,
} from "../.test-dist/src/demo/comparison.js";

const NOW = "2026-10-15T08:00:00.000Z";
const release = { catalogId: "taxcat_fixture", releaseId: "taxrel_fixture", revision: 1 };
const attribution = { kind: "synthetic_fixture", fixtureRef: "fixture" };

function description(overrides = {}) {
  return { release, makeId: "make_fixture", modelId: "model_fixture", firstRegistrationYear: 2022, attribution, ...overrides };
}

function result(index, overrides = {}) {
  const listingId = `lst_demo_${index}`;
  return {
    listingId,
    availability: "active",
    price: { status: "observed", value: { amountMinor: 10_001, currency: "EUR" }, evidenceId: `ev_price_${index}` },
    mileage: { status: "observed", value: { amount: 10_000.001, unit: "km" }, evidenceId: `ev_mileage_${index}` },
    evidence: [],
    description: { status: "authored_synthetic", value: description(), evidenceId: `de_current_${index}` },
    descriptionEvidence: [],
    ...overrides,
  };
}

function response(results) {
  return { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: "fixture-v2", taxonomyRelease: release, dataAsOf: NOW, state: "complete", results, totalCount: results.length };
}

function catalog(overrides = {}) {
  return {
    schemaVersion: 2,
    dataMode: "synthetic",
    fixtureVersion: "fixture-v2",
    taxonomyRelease: {
      schemaVersion: 1,
      ...release,
      releasedAt: NOW,
      dataMode: "synthetic",
      attributions: [{ attributionId: "taxattr_fixture", ...attribution }],
      makes: [{ makeId: "make_fixture", primaryName: { value: "Marque fictive", attributionId: "taxattr_fixture" }, aliases: [] }],
      models: [
        { modelId: "model_fixture", makeId: "make_fixture", primaryName: { value: "Modèle fictif", attributionId: "taxattr_fixture" }, aliases: [] },
        { modelId: "model_other", makeId: "make_fixture", primaryName: { value: "Autre modèle", attributionId: "taxattr_fixture" }, aliases: [] },
      ],
      ...overrides,
    },
  };
}

function statuses(entries, acceptedCatalog = catalog()) {
  return Object.fromEntries(comparisonRows(entries, acceptedCatalog).map((row) => [row.field, row.status]));
}

test("selection is unique, response-bound, ordered, capped and immutable", () => {
  const results = [result(0), result(1), result(2), result(3)];
  const data = response(results);
  const ids = [results[2].listingId, "lst_unknown", results[0].listingId, results[2].listingId, results[1].listingId, results[3].listingId];
  const idsBefore = globalThis.structuredClone(ids);
  const dataBefore = globalThis.structuredClone(data);

  assert.equal(COMPARISON_LIMIT, 3);
  assert.deepEqual(selectComparisonEntries(data, ids).map(({ result: selected, index }) => [selected.listingId, index]), [
    [results[2].listingId, 2],
    [results[0].listingId, 0],
    [results[1].listingId, 1],
  ]);
  assert.deepEqual(ids, idsBefore);
  assert.deepEqual(data, dataBefore);
  assert.deepEqual(selectComparisonEntries(undefined, ids), []);
});

test("toggle adds valid IDs, rejects unknown/full additions and always permits removal", () => {
  const results = [result(0), result(1), result(2), result(3)];
  const data = response(results);
  assert.deepEqual(toggleComparisonSelection([], data, results[0].listingId), [results[0].listingId]);
  assert.deepEqual(toggleComparisonSelection([results[0].listingId, "lst_unknown"], data, results[1].listingId), [results[0].listingId, results[1].listingId]);
  const full = results.slice(0, 3).map((item) => item.listingId);
  assert.deepEqual(toggleComparisonSelection(full, data, results[3].listingId), full);
  assert.deepEqual(toggleComparisonSelection(full, data, results[1].listingId), [results[0].listingId, results[2].listingId]);
  assert.deepEqual(toggleComparisonSelection(full, data, "lst_unknown"), full);
  assert.deepEqual(toggleComparisonSelection(full, undefined, results[0].listingId), []);
});

test("rows distinguish insufficient, exact tiny/huge differences and zero as known", () => {
  const first = result(0, {
    price: { status: "observed", value: { amountMinor: 0, currency: "EUR" }, evidenceId: "ev_price_0" },
    mileage: { status: "observed", value: { amount: 9_007_199_254_740_990, unit: "km" }, evidenceId: "ev_mileage_0" },
  });
  const second = result(1, {
    price: { status: "observed", value: { amountMinor: 1, currency: "EUR" }, evidenceId: "ev_price_1" },
    mileage: { status: "observed", value: { amount: 9_007_199_254_740_991, unit: "km" }, evidenceId: "ev_mileage_1" },
  });
  const data = response([first, second]);
  assert.deepEqual(new Set(Object.values(statuses(selectComparisonEntries(data, [first.listingId])))), new Set(["insufficient"]));
  assert.deepEqual(statuses(selectComparisonEntries(data, [first.listingId, second.listingId])), {
    availability: "same",
    make: "same",
    model: "same",
    firstRegistrationYear: "same",
    price: "different",
    mileage: "different",
  });

  const tinyFirst = result(2, {
    price: { status: "observed", value: { amountMinor: 0, currency: "EUR" }, evidenceId: "ev_price_2" },
    mileage: { status: "observed", value: { amount: 1e-7, unit: "km" }, evidenceId: "ev_mileage_2" },
  });
  const tinySecond = result(3, {
    price: { status: "observed", value: { amountMinor: 0, currency: "EUR" }, evidenceId: "ev_price_3" },
    mileage: { status: "observed", value: { amount: 2e-7, unit: "km" }, evidenceId: "ev_mileage_3" },
  });
  const tinyData = response([tinyFirst, tinySecond]);
  const tinyEntries = selectComparisonEntries(tinyData, [tinyFirst.listingId, tinySecond.listingId]);
  const tinyBefore = globalThis.structuredClone(tinyEntries);
  const acceptedCatalog = catalog();
  const catalogBefore = globalThis.structuredClone(acceptedCatalog);
  const tinyStatuses = statuses(tinyEntries, acceptedCatalog);
  assert.equal(tinyStatuses.price, "same");
  assert.equal(tinyStatuses.mileage, "different");
  assert.deepEqual(tinyEntries, tinyBefore);
  assert.deepEqual(acceptedCatalog, catalogBefore);

  const zeroFirst = result(4, { mileage: { status: "observed", value: { amount: 0, unit: "km" }, evidenceId: "ev_mileage_4" } });
  const zeroSecond = result(5, { mileage: { status: "observed", value: { amount: 0, unit: "km" }, evidenceId: "ev_mileage_5" } });
  const zeroData = response([zeroFirst, zeroSecond]);
  assert.equal(statuses(selectComparisonEntries(zeroData, [zeroFirst.listingId, zeroSecond.listingId])).mileage, "same");
});

test("rows report unknown before compatibility and mixed currency or unit as incompatible", () => {
  const unavailable = result(0, { price: { status: "unavailable" }, mileage: { status: "unavailable" }, description: { status: "unavailable" } });
  const usdMiles = result(1, {
    price: { status: "observed", value: { amountMinor: 10_001, currency: "USD" }, evidenceId: "ev_price_1" },
    mileage: { status: "observed", value: { amount: 10_000.001, unit: "mi" }, evidenceId: "ev_mileage_1" },
  });
  const eurKm = result(2);
  const data = response([unavailable, usdMiles, eurKm]);
  const incomplete = statuses(selectComparisonEntries(data, [unavailable.listingId, usdMiles.listingId, eurKm.listingId]));
  assert.equal(incomplete.price, "incomplete");
  assert.equal(incomplete.mileage, "incomplete");
  assert.equal(incomplete.make, "incomplete");
  const incompatible = statuses(selectComparisonEntries(data, [usdMiles.listingId, eurKm.listingId]));
  assert.equal(incompatible.price, "incompatible");
  assert.equal(incompatible.mileage, "incompatible");
});

test("description rows compare exact IDs but require matching release and attribution resolution", () => {
  const first = result(0);
  const different = result(1, { description: { status: "authored_synthetic", value: description({ modelId: "model_other", firstRegistrationYear: 2023 }), evidenceId: "de_current_1" } });
  const data = response([first, different]);
  const entries = selectComparisonEntries(data, [first.listingId, different.listingId]);
  assert.equal(statuses(entries).make, "same");
  assert.equal(statuses(entries).model, "different");
  assert.equal(statuses(entries).firstRegistrationYear, "different");
  assert.equal(Object.fromEntries(comparisonRows(entries, undefined).map((row) => [row.field, row.status])).model, "incomplete");
  assert.equal(statuses(entries, catalog({ revision: 2 })).model, "incomplete");
  assert.equal(statuses(entries, catalog({ attributions: [] })).model, "incomplete");
});

test("conflicts use exact typed tuples rather than rounded display strings", () => {
  const value = description();
  const conflicted = result(0, {
    evidence: [
      { evidenceId: "ev_price_a", field: "price", observedAt: NOW, confidenceBps: 9000, value: { amountMinor: 10_000, currency: "EUR" } },
      { evidenceId: "ev_price_b", field: "price", observedAt: NOW, confidenceBps: 8000, value: { amountMinor: 10_001, currency: "EUR" } },
      { evidenceId: "ev_mileage_a", field: "mileage", observedAt: NOW, confidenceBps: 9000, value: { amount: 1.001, unit: "km" } },
      { evidenceId: "ev_mileage_b", field: "mileage", observedAt: NOW, confidenceBps: 8000, value: { amount: 1.002, unit: "km" } },
    ],
    descriptionEvidence: [
      { evidenceId: "de_a", capturedAt: NOW, value },
      { evidenceId: "de_b", capturedAt: NOW, value: description({ release: { ...release, revision: 2 } }) },
    ],
  });
  const conflictedBefore = globalThis.structuredClone(conflicted);
  assert.deepEqual(comparisonConflicts(conflicted), { observations: true, descriptions: true });
  assert.deepEqual(conflicted, conflictedBefore);

  const repeated = result(1, {
    evidence: [
      { evidenceId: "ev_a", field: "price", observedAt: NOW, confidenceBps: 9000, value: { amountMinor: 0, currency: "EUR" } },
      { evidenceId: "ev_b", field: "price", observedAt: "2026-10-15T09:00:00.000Z", confidenceBps: 1000, value: { amountMinor: 0, currency: "EUR" } },
    ],
    descriptionEvidence: [
      { evidenceId: "de_a", capturedAt: NOW, value },
      { evidenceId: "de_b", capturedAt: "2026-10-15T09:00:00.000Z", value },
    ],
  });
  assert.deepEqual(comparisonConflicts(repeated), { observations: false, descriptions: false });

  const provenanceOnly = result(2, {
    descriptionEvidence: [
      { evidenceId: "de_a", capturedAt: NOW, value },
      { evidenceId: "de_b", capturedAt: NOW, value: description({ attribution: { kind: "synthetic_fixture", fixtureRef: "other-fixture" } }) },
    ],
  });
  assert.deepEqual(comparisonConflicts(provenanceOnly), { observations: false, descriptions: false });
});
