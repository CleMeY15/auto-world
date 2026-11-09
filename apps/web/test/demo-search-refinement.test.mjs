import assert from "node:assert/strict";
import test from "node:test";
import { parseFilterInputV3 } from "../.test-dist/src/demo/model.js";
import { removeSearchCriterion } from "../.test-dist/src/demo/search-refinement.js";

const release = { catalogId: "taxcat_refinement", releaseId: "taxrel_refinement_v1", revision: 1 };
const makeId = "make_refinement";
const modelId = "model_refinement";
const binding = { fixtureVersion: "refinement-v1", taxonomyRelease: release };
const catalog = {
  schemaVersion: 2,
  dataMode: "synthetic",
  fixtureVersion: binding.fixtureVersion,
  taxonomyRelease: {
    schemaVersion: 1,
    ...release,
    releasedAt: "2026-11-09T08:00:00.000Z",
    dataMode: "synthetic",
    attributions: [{ attributionId: "taxattr_refinement", kind: "synthetic_fixture", fixtureRef: "refinement/catalog" }],
    makes: [{ makeId, primaryName: { value: "Marque affinée", attributionId: "taxattr_refinement" }, aliases: [] }],
    models: [{ modelId, makeId, primaryName: { value: "Modèle affiné", attributionId: "taxattr_refinement" }, aliases: [] }],
  },
};
const completeCriteria = {
  query: {
    schemaVersion: 3,
    sort: "mileage_desc",
    text: "modele affine",
    priceMaxMinor: Number.MAX_SAFE_INTEGER,
    mileageMaxKm: 1e-7,
    makeId,
    modelId,
    firstRegistrationYear: 2022,
  },
  binding,
};

function remove(criterion, criteria = completeCriteria, currentCatalog = catalog) {
  return removeSearchCriterion(criteria, criterion, currentCatalog);
}

test("removes keyword text and produces a canonical V2 query on reparse", () => {
  const input = remove("text");
  assert.ok(input);
  assert.equal(input.text, "");
  assert.deepEqual(parseFilterInputV3(input), {
    ok: true,
    query: {
      schemaVersion: 2,
      sort: "mileage_desc",
      priceMaxMinor: Number.MAX_SAFE_INTEGER,
      mileageMaxKm: 1e-7,
      makeId,
      modelId,
      firstRegistrationYear: 2022,
    },
  });
});

test("removes price while preserving exact mileage and sort values", () => {
  const input = remove("priceMaxMinor");
  assert.ok(input);
  assert.equal(input.priceMaxEUR, "");
  assert.equal(input.mileageMaxKm, "0.0000001");
  assert.equal(input.sort, "mileage_desc");
  assert.equal(parseFilterInputV3(input).ok, true);
});

test("removes mileage while preserving maximum safe cents exactly", () => {
  const input = remove("mileageMaxKm");
  assert.ok(input);
  assert.equal(input.mileageMaxKm, "");
  assert.equal(input.priceMaxEUR, "90071992547409.91");
  assert.equal(parseFilterInputV3(input).ok, true);
});

test("removes a numeric field from V2 while preserving the other exact value and sort", () => {
  const input = removeSearchCriterion({
    query: { schemaVersion: 2, sort: "price_desc", priceMaxMinor: 12_345, mileageMaxKm: 1e-7 },
  }, "priceMaxMinor");
  assert.ok(input);
  assert.equal(input.priceMaxEUR, "");
  assert.equal(input.mileageMaxKm, "0.0000001");
  assert.deepEqual(parseFilterInputV3(input), {
    ok: true,
    query: { schemaVersion: 2, sort: "price_desc", mileageMaxKm: 1e-7 },
  });
});

test("removing the last V2 field retains a cursorless sorted query", () => {
  const input = removeSearchCriterion({
    query: { schemaVersion: 2, sort: "listing_asc", priceMaxMinor: 12_345 },
  }, "priceMaxMinor");
  assert.ok(input);
  assert.deepEqual(parseFilterInputV3(input), {
    ok: true,
    query: { schemaVersion: 2, sort: "listing_asc" },
  });
});

test("removes the first registration year without changing identity", () => {
  const input = remove("firstRegistrationYear");
  assert.ok(input);
  assert.equal(input.firstRegistrationYear, "");
  assert.equal(input.makeId, makeId);
  assert.equal(input.modelId, modelId);
});

test("removing a model retains its make and catalogue binding", () => {
  const input = remove("modelId");
  assert.ok(input);
  assert.equal(input.makeId, makeId);
  assert.equal(input.modelId, "");
  const parsed = parseFilterInputV3(input);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.query.makeId, makeId);
  assert.equal(parsed.query.modelId, undefined);
});

test("removing a make also removes its dependent model without a catalogue", () => {
  const input = removeSearchCriterion(completeCriteria, "makeId");
  assert.ok(input);
  assert.equal(input.makeId, "");
  assert.equal(input.modelId, "");
  const parsed = parseFilterInputV3(input);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.query.makeId, undefined);
  assert.equal(parsed.query.modelId, undefined);
});

test("rejects a removal when the selected criterion is absent", () => {
  assert.equal(removeSearchCriterion({ query: { schemaVersion: 2, sort: "listing_asc" } }, "priceMaxMinor"), undefined);
});

test("rejects an unknown runtime criterion", () => {
  assert.equal(removeSearchCriterion(completeCriteria, "sellerId", catalog), undefined);
});

test("rejects criteria carrying a pagination cursor", () => {
  const criteria = { ...completeCriteria, query: { ...completeCriteria.query, cursor: `cur_${"a".repeat(64)}` } };
  assert.equal(removeSearchCriterion(criteria, "text", catalog), undefined);
});

test("rejects hostile accessor criteria without invoking the accessor", () => {
  let calls = 0;
  const criteria = {};
  Object.defineProperty(criteria, "query", { enumerable: true, get() { calls += 1; return completeCriteria.query; } });
  assert.equal(removeSearchCriterion(criteria, "text", catalog), undefined);
  assert.equal(calls, 0);
});

test("rejects retained identity when the current catalogue does not match", () => {
  const mismatched = { ...catalog, fixtureVersion: "refinement-v2" };
  assert.equal(remove("text", completeCriteria, mismatched), undefined);
});

test("does not mutate the source criteria", () => {
  const source = globalThis.structuredClone(completeCriteria);
  const before = globalThis.structuredClone(source);
  assert.ok(remove("modelId", source));
  assert.deepEqual(source, before);
});
