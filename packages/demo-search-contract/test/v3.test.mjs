import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeDemoSearchText,
  parseDemoCatalogResponseV2,
  parseDemoSearchQuery,
  parseDemoSearchQueryV2,
  parseDemoSearchQueryV3,
  resolveDemoSearchModels,
} from "@auto-world/demo-search-contract";
import { catalogResponse, MAKE_ID, MODEL_ID } from "./fixtures-v2.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

const query = (overrides = {}) => ({ schemaVersion: 3, sort: "listing_asc", ...overrides });

test("V3 canonicalizes words and keeps every V2 filter in a detached frozen query", () => {
  const input = query({ text: "  ALPHA—école e\u0301cole  ", makeId: MAKE_ID, modelId: MODEL_ID,
    priceMaxMinor: 0, mileageMaxKm: 0.5, firstRegistrationYear: 2024, cursor: `cur_${"a".repeat(64)}` });
  const output = assertSuccess(parseDemoSearchQueryV3(input));
  assert.deepEqual(output, { ...input, text: "alpha ecole" });
  input.text = "changed";
  assert.equal(output.text, "alpha ecole");
  assert.equal(Object.isFrozen(output), true);
  assert.deepEqual(assertSuccess(parseDemoSearchQueryV3(output)), output);
  assert.deepEqual(assertSuccess(parseDemoSearchQueryV3(query())), query());
});

test("V3 normalization is locale-free, bounded and idempotent across Unicode forms", () => {
  const table = [
    ["ZÉRO alpha—Alpha", "alpha zero"], ["Ａｌｐｈａ １２", "12 alpha"],
    ["ONE* Alpha?", "alpha one"], ["école e\u0301cole", "ecole"],
    ["日本 車", "日本 車"], ["İ", "i"], ["ﬃ", "ffi"],
    ["𐐀", "𐐨"], ["a ".repeat(60), "a"],
  ];
  for (const [raw, canonical] of table) {
    assert.equal(assertSuccess(normalizeDemoSearchText(raw)), canonical);
    assert.equal(assertSuccess(normalizeDemoSearchText(canonical)), canonical);
  }
  assertSuccess(normalizeDemoSearchText("a".repeat(32)));
  assertSuccess(normalizeDemoSearchText("a b c d e f g h"));
  const boundary = Array.from({ length: 8 }, (_, index) => `${index}${"a".repeat(13)}`).join(" ");
  assert.equal(boundary.length, 119);
  assertSuccess(normalizeDemoSearchText(`${boundary} `));
  assertIssue(normalizeDemoSearchText(`${boundary}  `), "invalid_value", "$.text");
  const expanded = Array.from({ length: 8 }, (_, index) => `${index}${"ﬃ".repeat(5)}`).join(" ");
  assert.ok([...expanded].length < 120);
  assert.ok([...expanded.normalize("NFKD")].length > 120);
  assertIssue(normalizeDemoSearchText(expanded), "invalid_value", "$.text");
});

test("canonical text remains stable across Unicode compatibility and case combinations", () => {
  const labels = ["É", "ﬃ", "①", "K", "ǅ", "ǰ", "İ", "Σ", "ẞ", "𐐀", "車", "Ａ"];
  for (const left of labels) for (const right of labels) {
    const first = assertSuccess(normalizeDemoSearchText(`${left}—${right} ${left}`));
    assert.equal(assertSuccess(normalizeDemoSearchText(first)), first);
    const parsed = assertSuccess(parseDemoSearchQueryV3(query({ text: first })));
    assert.equal(parsed.text, first);
  }
});

test("V3 rejects invalid text rather than broadening the search", () => {
  for (const text of ["", "   ", "---*?", "a\nb", "a\tb", "a\u0000b", "a\u200db", "a\u202eb", "\ud800", "\udfff",
    "a".repeat(33), "a ".repeat(61), "a b c d e f g h i", "x".repeat(10000)]) {
    assertIssue(parseDemoSearchQueryV3(query({ text })), "invalid_value", "$.text");
  }
  for (const text of [undefined, null, 1, [], {}, new String("alpha")]) {
    assertIssue(parseDemoSearchQueryV3(query({ text })), "invalid_type", "$.text");
  }
});

test("V3 preserves strict old contracts and rejects future versions or incompatible filters", () => {
  assertIssue(parseDemoSearchQuery({ schemaVersion: 1, sort: "listing_asc", text: "alpha" }), "unknown_key", "$");
  assertIssue(parseDemoSearchQueryV2({ schemaVersion: 2, sort: "listing_asc", text: "alpha" }), "unknown_key", "$");
  for (const schemaVersion of [1, 2, 4]) {
    assertIssue(parseDemoSearchQueryV3(query({ schemaVersion })), "unsupported_version", "$.schemaVersion");
  }
  assertIssue(parseDemoSearchQueryV3({ sort: "listing_asc" }), "missing_field", "$.schemaVersion");
  assertIssue(parseDemoSearchQueryV3(query({ schemaVersion: "3" })), "invalid_type", "$.schemaVersion");
  assertIssue(parseDemoSearchQueryV3(query({ modelId: MODEL_ID })), "missing_field", "$.makeId");
  assertIssue(parseDemoSearchQueryV3(query({ sort: "relevance" })), "invalid_value", "$.sort");
  assertIssue(parseDemoSearchQueryV3(query({ cursor: "private" })), "invalid_value", "$.cursor");
  assertIssue(parseDemoSearchQueryV3(query({ priceMaxMinor: -1 })), "invalid_value", "$.priceMaxMinor");
  assertIssue(parseDemoSearchQueryV3(query({ firstRegistrationYear: 1885 })), "invalid_value", "$.firstRegistrationYear");
});

test("V3 refuses hostile descriptors, symbols and prototypes without invoking accessors", () => {
  let calls = 0;
  const accessor = query();
  Object.defineProperty(accessor, "text", { enumerable: true, get() { calls += 1; return "alpha"; } });
  assertIssue(parseDemoSearchQueryV3(accessor), "invalid_object", "$");
  assert.equal(calls, 0);
  const hidden = query();
  Object.defineProperty(hidden, "text", { value: "alpha" });
  assertIssue(parseDemoSearchQueryV3(hidden), "invalid_object", "$");
  assertIssue(parseDemoSearchQueryV3(query({ [Symbol("secret")]: 1 })), "unknown_key", "$");
  assertIssue(parseDemoSearchQueryV3(query({ sourceId: "secret" })), "unknown_key", "$");
  assertIssue(parseDemoSearchQueryV3(Object.create(query())), "invalid_object", "$");
  assertIssue(parseDemoSearchQueryV3(new Proxy({}, { ownKeys() { throw new Error("private"); } })), "invalid_object", "$");
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assertIssue(parseDemoSearchQueryV3(revoked.proxy), "invalid_object", "$");
  assertSuccess(parseDemoSearchQueryV3(Object.assign(Object.create(null), query({ text: "alpha" }))));
});

test("shared resolver uses all primary words, never aliases, and retains ambiguous model labels", () => {
  const input = catalogResponse();
  const attributionId = "taxattr_aw_fixture";
  const name = (value) => ({ value, attributionId });
  input.taxonomyRelease.makes[0].primaryName = name("Alphà Auto");
  input.taxonomyRelease.makes[0].aliases = [name("SecretMake")];
  input.taxonomyRelease.models[0].primaryName = name("One");
  input.taxonomyRelease.models[0].aliases = [name("SecretModel")];
  input.taxonomyRelease.makes.push({ makeId: "make_beta", primaryName: name("Beta"), aliases: [] });
  input.taxonomyRelease.models.push({ modelId: "model_beta_one", makeId: "make_beta", primaryName: name("One"), aliases: [] });
  const catalog = assertSuccess(parseDemoCatalogResponseV2(input)).taxonomyRelease;
  for (const [text, expected] of [
    ["one", [MODEL_ID, "model_beta_one"]], ["ONE ALPHA", [MODEL_ID]],
    ["Auto Alpha One", [MODEL_ID]], ["beta one", ["model_beta_one"]],
    ["alpha beta", []], ["alp", []], ["2024", []], ["SecretMake", []], ["SecretModel", []],
    ["alpha OR beta", []],
  ]) {
    const matches = resolveDemoSearchModels(catalog, text);
    assert.deepEqual(matches, expected);
    assert.equal(Object.isFrozen(matches), true);
  }
  assert.throws(() => resolveDemoSearchModels(catalog, ""), /invalid_keyword_text/);
  assert.throws(() => resolveDemoSearchModels({ ...catalog, models: Array(16_385).fill(catalog.models[0]) }, "one"), /keyword_catalog_limit/);
});
