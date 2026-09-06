import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "@auto-world/connector-sdk";
import { activeItem, copy, request, utf8 } from "./fixtures.mjs";

test("request parsing canonicalizes fields and detaches immutable input", () => {
  const input = request({ fields: ["source_listing_id", "price"] });
  const result = sdk.parseConnectorRunRequest(input);
  assert.equal(result.success, true);
  input.fields.push("seller_pii");
  input.limits.maxPages = 999;
  assert.deepEqual(result.data.fields, ["price", "source_listing_id"]);
  assert.equal(result.data.limits.maxPages, 10);
  assert.ok(Object.isFrozen(result.data));
  assert.ok(Object.isFrozen(result.data.fields));
  assert.ok(Object.isFrozen(result.data.limits));
});

for (const [name, change] of [
  ["version", (value) => { value.schemaVersion = 2; }],
  ["unknown key", (value) => { value["synthetic-private-unknown"] = "opaque"; }],
  ["missing publication scope", (value) => { value.fields = ["price"]; }],
  ["duplicate field", (value) => { value.fields = ["source_listing_id", "price", "price"]; }],
  ["consumer scope", (value) => { value.audience = "consumer"; }],
  ["wrong source ID domain", (value) => { value.sourceId = "run_other"; }],
  ["oversize token", (value) => { value.invocationKey = "x".repeat(129); }],
  ["token newline", (value) => { value.mapperVersion = "mapper\n"; }],
  ["zero page limit", (value) => { value.limits.maxPages = 0; }],
  ["oversize page limit", (value) => { value.limits.maxPages = 1001; }],
  ["unsafe integer", (value) => { value.limits.maxItems = Number.MAX_SAFE_INTEGER + 1; }],
  ["negative zero", (value) => { value.limits.maxEffectMs = -0; }],
  ["NaN", (value) => { value.limits.maxPageBytes = NaN; }],
  ["sparse fields", (value) => { value.fields = new Array(2); value.fields[0] = "source_listing_id"; }],
]) {
  test("request rejects " + name + " without disclosing dynamic content", () => {
    const value = request();
    change(value);
    const result = sdk.parseConnectorRunRequest(value);
    assert.equal(result.success, false);
    assert.ok(!JSON.stringify(result).includes("synthetic-private-unknown"));
    assert.ok(Object.isFrozen(result));
  });
}

test("request boundary never invokes accessors/coercion or leaks reflective exceptions", () => {
  let called = 0;
  const accessor = request();
  Object.defineProperty(accessor, "sourceId", { enumerable: true, get() { called += 1; throw new Error("synthetic-private"); } });
  const hidden = request();
  Object.defineProperty(hidden, "private", { value: true, enumerable: false });
  const symbolic = request();
  symbolic[Symbol("synthetic-private")] = true;
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const throwing = new Proxy({}, { ownKeys() { throw new Error("synthetic-private"); } });
  for (const input of [accessor, hidden, symbolic, revoked.proxy, throwing, Object.create({ inherited: true })]) {
    const result = sdk.parseConnectorRunRequest(input);
    assert.equal(result.success, false);
    assert.ok(!JSON.stringify(result).includes("synthetic-private"));
  }
  assert.equal(called, 0);
});

test("adapter result preserves a defensive raw byte copy and rejects ambiguous unions", () => {
  const bytes = utf8('{"items":[]}');
  const parsed = sdk.parseAdapterFetchResult({ success: true, page: {
    pageIdentity: "one", bytes, nextCursor: null, complete: true,
  } });
  assert.equal(parsed.success, true);
  bytes.fill(0);
  assert.deepEqual(parsed.data.page.bytes, utf8('{"items":[]}'));
  for (const input of [
    { success: true, failure: { kind: "terminal" } },
    { success: false, failure: { kind: "transient", retryAfterMs: -1 } },
    { success: false, failure: { kind: "rate_limited", retryAfterMs: 300001 } },
    { success: false, failure: { kind: "other" } },
  ]) {
    assert.equal(sdk.parseAdapterFetchResult(input).success, false);
  }
});

test("mapper validation rejects forged fields/time/access policy and bounds observations", () => {
  const item = activeItem();
  assert.equal(sdk.parseMappedPageDraft({ items: [item] }).success, true);
  for (const changed of [
    { ...copy(item), sourceId: "src_forged" },
    { ...copy(item), raw: {} },
    { ...copy(item), observedAt: "2026-01-01T00:00:00.000Z" },
    { ...copy(item), observations: Array.from({ length: 17 }, () => copy(item.observations[0])) },
    { sourceListingId: "ended", outcome: "deleted", observations: [] },
    { ...copy(item), observations: [{ field: "other", value: "opaque", confidenceBps: 1 }] },
    { ...copy(item), observations: [{ field: "vin", value: { status: "withheld", accessPolicy: {} }, confidenceBps: 1 }] },
  ]) {
    assert.equal(sdk.parseMappedPageDraft({ items: [changed] }).success, false);
  }
});

test("publication IDs reject lone surrogates while preserving valid scalar sequences", () => {
  for (const sourceListingId of ["x\uD800", "\uDC00", "\uD800x"]) {
    assert.equal(sdk.parseMappedPageDraft({ items: [{ ...activeItem(), sourceListingId }] }).success, false);
  }
  for (const sourceListingId of ["x\uFFFD", "x\uD83D\uDE97"]) {
    assert.equal(sdk.parseMappedPageDraft({ items: [{ ...activeItem(), sourceListingId }] }).success, true);
  }
});

test("store envelope parser distinguishes typed acknowledgement from malformed or hostile outcomes", () => {
  const parseNull = (value) => value === null ? { success: true, data: null }
    : { success: false, issues: [{ code: "invalid_value", path: "$" }] };
  assert.equal(sdk.parseStoreResult({ acknowledged: true, success: true, data: null }, parseNull).success, true);
  assert.equal(sdk.parseStoreResult({ acknowledged: true, success: false,
    failure: { code: "checkpoint_conflict", retryable: false } }, parseNull).success, true);
  assert.equal(sdk.parseStoreResult({ acknowledged: false, success: true, data: null }, parseNull).success, false);
  let called = 0;
  const hostile = { success: true, data: null };
  Object.defineProperty(hostile, "acknowledged", { enumerable: true, get() { called += 1; return true; } });
  assert.equal(sdk.parseStoreResult(hostile, parseNull).success, false);
  assert.equal(called, 0);
});
