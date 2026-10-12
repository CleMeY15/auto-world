import assert from "node:assert/strict";
import test from "node:test";

import {
  findTaxonomyMake,
  findTaxonomyModel,
  parseMakeId,
  parseModelId,
  parseTaxonomyAttributionId,
  parseTaxonomyCatalogId,
  parseTaxonomyEntryReference,
  parseTaxonomyRelease,
  parseTaxonomyReleaseId,
  parseTaxonomyReleaseReference,
  resolveTaxonomyEntryReference,
} from "../dist/index.js";
import { syntheticTaxonomyRelease } from "./fixtures/synthetic-release.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const firstIssue = (result) => {
  assert.equal(result.success, false);
  return result.issues[0];
};

test("keeps every golden corpus label explicitly synthetic", () => {
  for (const entry of [...syntheticTaxonomyRelease.makes, ...syntheticTaxonomyRelease.models]) {
    for (const name of [entry.primaryName, ...entry.aliases]) {
      assert.match(name.value, /^AW Fixture /u);
    }
  }
});

test("parses all five distinct ID domains and rejects cross-domain or malformed values", () => {
  const cases = [
    [parseTaxonomyCatalogId, "taxcat_fixture", "make_fixture"],
    [parseTaxonomyReleaseId, "taxrel_fixture", "taxcat_fixture"],
    [parseTaxonomyAttributionId, "taxattr_fixture", "taxrel_fixture"],
    [parseMakeId, "make_fixture", "model_fixture"],
    [parseModelId, "model_fixture", "make_fixture"],
  ];
  for (const [parser, accepted, wrongDomain] of cases) {
    assert.equal(parser(accepted).success, true);
    for (const rejected of [wrongDomain, accepted.split("_")[0] + "_", `${accepted} `, `${accepted}\n`, `${accepted}\r`, `${accepted}\u2028`, `${accepted}\u2029`, `${accepted}é`, `${accepted}\u0000`, `_${accepted}`]) {
      assert.equal(parser(rejected).success, false, rejected);
    }
  }
});

test("parses the synthetic golden release deterministically and deeply freezes it", () => {
  const first = parseTaxonomyRelease(clone(syntheticTaxonomyRelease));
  const second = parseTaxonomyRelease(clone(syntheticTaxonomyRelease));
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(first.data, second.data);
  assert.equal(first.data.makes.length, 4);
  assert.equal(first.data.models.length, 8);
  assert.equal(first.data.attributions.length, 4);
  assert.equal(first.data.models.filter((model) => model.primaryName.value === "AW Fixture Shared Model").length, 2);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.data), true);
  assert.equal(Object.isFrozen(first.data.models), true);
  assert.equal(Object.isFrozen(first.data.models[0].primaryName), true);
});

test("rejects envelope, version, revision, timestamp, and mode violations", () => {
  const mutations = [
    [(input) => { delete input.models; }, "missing_field", "release.models"],
    [(input) => { input.secret = "sentinel"; }, "unknown_key", "release"],
    [(input) => { input.schemaVersion = 2; }, "unsupported_version", "release.schemaVersion"],
    [(input) => { input.revision = 0; }, "invalid_value", "release.revision"],
    [(input) => { input.revision = 1.5; }, "invalid_value", "release.revision"],
    [(input) => { input.revision = Number.MAX_SAFE_INTEGER + 1; }, "invalid_value", "release.revision"],
    [(input) => { input.releasedAt = "2026-02-30T00:00:00.000Z"; }, "invalid_value", "release.releasedAt"],
    [(input) => { input.releasedAt = "2026-10-12T00:00:00.000+00:00"; }, "invalid_value", "release.releasedAt"],
    [(input) => { input.dataMode = "production"; }, "invalid_value", "release.dataMode"],
  ];
  for (const [mutate, code, path] of mutations) {
    const input = clone(syntheticTaxonomyRelease);
    mutate(input);
    assert.deepEqual(firstIssue(parseTaxonomyRelease(input)), { code, path });
  }
});

test("rejects duplicate and out-of-order IDs with stable paths", () => {
  const duplicate = clone(syntheticTaxonomyRelease);
  duplicate.makes[1].makeId = duplicate.makes[0].makeId;
  assert.deepEqual(firstIssue(parseTaxonomyRelease(duplicate)), { code: "duplicate_id", path: "release.makes[1]" });
  const unordered = clone(syntheticTaxonomyRelease);
  [unordered.models[0], unordered.models[1]] = [unordered.models[1], unordered.models[0]];
  assert.deepEqual(firstIssue(parseTaxonomyRelease(unordered)), { code: "invalid_value", path: "release.models[1]" });

  const duplicateAttribution = clone(syntheticTaxonomyRelease);
  duplicateAttribution.attributions[1].attributionId = duplicateAttribution.attributions[0].attributionId;
  assert.deepEqual(firstIssue(parseTaxonomyRelease(duplicateAttribution)), { code: "duplicate_id", path: "release.attributions[1]" });

  const duplicateModel = clone(syntheticTaxonomyRelease);
  duplicateModel.models[1].modelId = duplicateModel.models[0].modelId;
  assert.deepEqual(firstIssue(parseTaxonomyRelease(duplicateModel)), { code: "duplicate_id", path: "release.models[1]" });
});

test("rejects invalid names, aliases, and attribution records", () => {
  const invalidNames = ["", " padded", "e\u0301", "line\nname", "bidi\u202Ename"];
  for (const value of invalidNames) {
    const input = clone(syntheticTaxonomyRelease);
    input.makes[0].primaryName.value = value;
    assert.equal(parseTaxonomyRelease(input).success, false, JSON.stringify(value));
  }
  const duplicateAlias = clone(syntheticTaxonomyRelease);
  duplicateAlias.makes[0].aliases.push({ value: "AW Fixture Label A", attributionId: "taxattr_gamma" });
  assert.equal(parseTaxonomyRelease(duplicateAlias).success, false);
  const primaryAlias = clone(syntheticTaxonomyRelease);
  primaryAlias.makes[0].aliases = [{ value: "AW Fixture Make Alpha", attributionId: "taxattr_beta" }];
  assert.equal(parseTaxonomyRelease(primaryAlias).success, false);
  const unsupportedKind = clone(syntheticTaxonomyRelease);
  unsupportedKind.attributions[0].kind = "source";
  assert.equal(parseTaxonomyRelease(unsupportedKind).success, false);
  const badFixtureRef = clone(syntheticTaxonomyRelease);
  badFixtureRef.attributions[0].fixtureRef = "https://invalid.example";
  assert.equal(parseTaxonomyRelease(badFixtureRef).success, false);
});

test("parses closed release and entry references", () => {
  const release = parseTaxonomyReleaseReference({ catalogId: "taxcat_fixture_catalog", releaseId: "taxrel_fixture_release_1", revision: 1 });
  assert.equal(release.success, true);
  assert.equal(Object.isFrozen(release.data), true);
  const make = parseTaxonomyEntryReference({ kind: "make", release: release.data, makeId: "make_aster" });
  const model = parseTaxonomyEntryReference({ kind: "model", release: release.data, modelId: "model_arc" });
  assert.equal(make.success, true);
  assert.equal(model.success, true);
  assert.equal(parseTaxonomyEntryReference({ kind: "make", release: release.data, modelId: "model_arc" }).success, false);
  assert.equal(parseTaxonomyEntryReference({ kind: "other", release: release.data, makeId: "make_aster" }).success, false);
});

test("looks up exact IDs and returns new frozen wrappers reusing records", () => {
  const release = parseTaxonomyRelease(clone(syntheticTaxonomyRelease));
  const makeId = parseMakeId("make_aster");
  const modelId = parseModelId("model_arc");
  const absentMake = parseMakeId("make_absent");
  const absentModel = parseModelId("model_absent");
  assert.equal(release.success && makeId.success && modelId.success && absentMake.success && absentModel.success, true);
  const make = findTaxonomyMake(release.data, makeId.data);
  const makeAgain = findTaxonomyMake(release.data, makeId.data);
  const model = findTaxonomyModel(release.data, modelId.data);
  assert.equal(make.status, "found");
  assert.equal(model.status, "found");
  assert.equal(make.data, release.data.makes[0]);
  assert.equal(model.data, release.data.models[0]);
  assert.notEqual(make, makeAgain);
  assert.equal(Object.isFrozen(make), true);
  assert.deepEqual(findTaxonomyMake(release.data, absentMake.data), { status: "not_found" });
  assert.deepEqual(findTaxonomyModel(release.data, absentModel.data), { status: "not_found" });
});

test("resolves only matching release tuples and routes the supplied snapshot", () => {
  const release = parseTaxonomyRelease(clone(syntheticTaxonomyRelease));
  const reference = parseTaxonomyEntryReference({
    kind: "make",
    release: { catalogId: "taxcat_fixture_catalog", releaseId: "taxrel_fixture_release_1", revision: 1 },
    makeId: "make_aster",
  });
  assert.equal(release.success && reference.success, true);
  const found = resolveTaxonomyEntryReference(release.data, reference.data);
  assert.equal(found.status, "found");
  assert.equal(found.kind, "make");
  assert.equal(found.data, release.data.makes[0]);
  for (const key of ["catalogId", "releaseId", "revision"]) {
    const changed = clone({ kind: "make", release: reference.data.release, makeId: "make_aster" });
    changed.release[key] = key === "catalogId" ? "taxcat_other" : key === "releaseId" ? "taxrel_other" : 2;
    const parsed = parseTaxonomyEntryReference(changed);
    assert.equal(parsed.success, true);
    assert.deepEqual(resolveTaxonomyEntryReference(release.data, parsed.data), { status: "release_mismatch" });
  }
});

test("returns sanitized failures for hostile accessors and proxies", () => {
  let invoked = false;
  const input = clone(syntheticTaxonomyRelease);
  Object.defineProperty(input.makes[0], "primaryName", {
    enumerable: true,
    get() { invoked = true; throw new Error("SECRET_ACCESSOR"); },
  });
  const accessorResult = parseTaxonomyRelease(input);
  assert.equal(accessorResult.success, false);
  assert.equal(invoked, false);
  const proxy = new Proxy(clone(syntheticTaxonomyRelease), { ownKeys() { throw new Error("SECRET_PROXY"); } });
  const proxyResult = parseTaxonomyRelease(proxy);
  assert.equal(proxyResult.success, false);
  assert.equal(JSON.stringify([accessorResult, proxyResult]).includes("SECRET"), false);
});

test("rejects custom prototypes and bounded collection overflow", () => {
  const customPrototype = clone(syntheticTaxonomyRelease);
  Object.setPrototypeOf(customPrototype.models[0], { custom: true });
  assert.equal(parseTaxonomyRelease(customPrototype).success, false);

  const aliases = clone(syntheticTaxonomyRelease);
  aliases.makes[0].aliases = Array.from({ length: 33 }, (_, index) => ({
    value: `Alias${String(index).padStart(2, "0")}`,
    attributionId: "taxattr_alpha",
  }));
  assert.deepEqual(firstIssue(parseTaxonomyRelease(aliases)), { code: "invalid_value", path: "release.makes[0].aliases" });

  for (const [key, maximum, template] of [
    ["attributions", 2048, { attributionId: "taxattr_overflow", kind: "synthetic_fixture", fixtureRef: "fixture/overflow" }],
    ["makes", 1024, { makeId: "make_overflow", primaryName: { value: "Overflow", attributionId: "taxattr_alpha" }, aliases: [] }],
    ["models", 16384, { modelId: "model_overflow", makeId: "make_aster", primaryName: { value: "Overflow", attributionId: "taxattr_alpha" }, aliases: [] }],
  ]) {
    const input = clone(syntheticTaxonomyRelease);
    input[key] = Array.from({ length: maximum + 1 }, () => template);
    assert.deepEqual(firstIssue(parseTaxonomyRelease(input)), { code: "invalid_value", path: `release.${key}` });
  }
});
