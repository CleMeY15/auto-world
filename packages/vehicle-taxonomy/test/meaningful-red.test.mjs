import assert from "node:assert/strict";
import test from "node:test";

import {
  findTaxonomyMake,
  parseMakeId,
  parseTaxonomyRelease,
} from "../dist/index.js";

const base = () => ({
  schemaVersion: 1,
  catalogId: "taxcat_synthetic",
  releaseId: "taxrel_release_1",
  revision: 1,
  releasedAt: "2026-10-12T00:00:00.000Z",
  dataMode: "synthetic",
  attributions: [{ attributionId: "taxattr_a", kind: "synthetic_fixture", fixtureRef: "fixture/a" }],
  makes: [{ makeId: "make_a", primaryName: { value: "Aster", attributionId: "taxattr_a" }, aliases: [] }],
  models: [{ modelId: "model_a", makeId: "make_a", primaryName: { value: "Arc", attributionId: "taxattr_a" }, aliases: [] }],
});

test("rejects a model whose parent make is absent", () => {
  const input = base();
  input.models[0].makeId = "make_missing";
  const result = parseTaxonomyRelease(input);
  assert.equal(result.success, false);
  assert.deepEqual(result.issues[0], { code: "invalid_value", path: "release.models[0].makeId" });
});

test("rejects an alias whose attribution is absent", () => {
  const input = base();
  input.makes[0].aliases.push({ value: "Asteria", attributionId: "taxattr_missing" });
  const result = parseTaxonomyRelease(input);
  assert.equal(result.success, false);
  assert.deepEqual(result.issues[0], { code: "invalid_value", path: "release.makes[0].aliases[0].attributionId" });
});

test("rejects an accessor without invoking it", () => {
  let invoked = false;
  const input = base();
  Object.defineProperty(input, "revision", { enumerable: true, get() { invoked = true; throw new Error("SECRET"); } });
  const result = parseTaxonomyRelease(input);
  assert.equal(result.success, false);
  assert.equal(invoked, false);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("detaches parsed output from caller mutation", () => {
  const input = base();
  const result = parseTaxonomyRelease(input);
  assert.equal(result.success, true);
  input.makes[0].primaryName.value = "Changed";
  assert.equal(result.data.makes[0].primaryName.value, "Aster");
});

test("returns not_found for a valid absent make id", () => {
  const release = parseTaxonomyRelease(base());
  const absent = parseMakeId("make_absent");
  assert.equal(release.success, true);
  assert.equal(absent.success, true);
  assert.deepEqual(findTaxonomyMake(release.data, absent.data), { status: "not_found" });
});
