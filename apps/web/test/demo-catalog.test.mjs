import assert from "node:assert/strict";
import test from "node:test";
import { catalogMatchesResponse, modelsForMake, resolveDescription } from "../.test-dist/src/demo/catalog.js";

const releaseRef = { catalogId: "taxcat_fixture", releaseId: "taxrel_fixture", revision: 1 };
const catalog = {
  schemaVersion: 2,
  dataMode: "synthetic",
  fixtureVersion: "fixture-v2",
  taxonomyRelease: {
    schemaVersion: 1,
    ...releaseRef,
    releasedAt: "2026-10-14T08:00:00.000Z",
    dataMode: "synthetic",
    attributions: [{ attributionId: "taxattr_fixture", kind: "synthetic_fixture", fixtureRef: "ui-description" }],
    makes: [{ makeId: "make_fixture", primaryName: { value: "Marque UI fictive", attributionId: "taxattr_fixture" }, aliases: [] }],
    models: [{ modelId: "model_fixture", makeId: "make_fixture", primaryName: { value: "Modèle UI fictif", attributionId: "taxattr_fixture" }, aliases: [] }],
  },
};
const response = { fixtureVersion: "fixture-v2", taxonomyRelease: releaseRef };
const value = { release: releaseRef, makeId: "make_fixture", modelId: "model_fixture", firstRegistrationYear: 2022, attribution: { kind: "synthetic_fixture", fixtureRef: "ui-description" } };

test("catalog matching binds fixture and release before label resolution", () => {
  assert.equal(catalogMatchesResponse(catalog, response), true);
  assert.equal(catalogMatchesResponse(catalog, { ...response, fixtureVersion: "other" }), false);
  assert.equal(catalogMatchesResponse(catalog, { ...response, taxonomyRelease: { ...releaseRef, revision: 2 } }), false);
  assert.deepEqual(resolveDescription(catalog, value), { makeLabel: "Marque UI fictive", modelLabel: "Modèle UI fictif", firstRegistrationYear: 2022 });
  assert.equal(resolveDescription(undefined, value), undefined);
  assert.equal(resolveDescription(catalog, { ...value, attribution: { kind: "synthetic_fixture", fixtureRef: "unadmitted" } }), undefined);
});

test("model choices stay scoped to their parent make", () => {
  assert.deepEqual(modelsForMake(catalog, "make_fixture").map((model) => model.modelId), ["model_fixture"]);
  assert.deepEqual(modelsForMake(catalog, "make_unknown"), []);
});
