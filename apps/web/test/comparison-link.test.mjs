import assert from "node:assert/strict";
import test from "node:test";

import {
  buildComparisonLink,
  COMPARISON_LINK_MAX_LENGTH,
  COMPARISON_LINK_PREFIX,
  decodeComparisonLinkFragment,
  encodeComparisonLinkFragment,
  isComparisonLinkFragment,
  resolveComparisonBundle,
} from "../.test-dist/src/demo/comparison-link.js";
import { createDemoClientV2, loadSavedDetailsV2 } from "../.test-dist/src/demo/client.js";

const listingIds = ["lst_comparison-link-01", "lst_comparison-link-02", "lst_comparison-link-03"];
const release = { catalogId: "taxcat_comparison_links", releaseId: "taxrel_comparison_links_v1", revision: 1 };

function result(listingId, availability = "active") {
  return {
    listingId,
    availability,
    price: { status: "unavailable" },
    mileage: { status: "unavailable" },
    evidence: [],
    description: { status: "unavailable" },
    descriptionEvidence: [],
  };
}

function response(listingId, options = {}) {
  const state = options.state ?? "complete";
  const common = {
    schemaVersion: 2,
    dataMode: "synthetic",
    fixtureVersion: options.fixtureVersion ?? "comparison-links-v1",
    taxonomyRelease: options.taxonomyRelease ?? release,
    dataAsOf: options.dataAsOf ?? "2026-10-20T10:14:12.125Z",
    results: [result(listingId, options.availability)],
  };
  return state === "complete"
    ? { ...common, state, totalCount: 1 }
    : { ...common, state, reason: state === "partial" ? "projection_incomplete" : "projection_stale" };
}

function acceptedItem(listingId, options) {
  return { listingId, outcome: { ok: true, requestId: `req_${listingId.padEnd(32, "a").slice(0, 32)}`, data: response(listingId, options) } };
}

function fragmentFromJson(source, version = "v1") {
  return `${COMPARISON_LINK_PREFIX}${version}/${encodeURIComponent(source)}`;
}

test("comparison link fragments preserve the ordered two or three publication IDs", () => {
  assert.equal(COMPARISON_LINK_PREFIX, "#comparison-link/");
  assert.equal(COMPARISON_LINK_MAX_LENGTH, 1_024);
  assert.equal(isComparisonLinkFragment("#comparison-link"), true);
  assert.equal(isComparisonLinkFragment("#comparison-link/v1/x"), true);
  assert.equal(isComparisonLinkFragment("#comparison-links/v1/x"), false);

  for (const ids of [listingIds.slice(0, 2), listingIds]) {
    const fragment = encodeComparisonLinkFragment(ids);
    assert.ok(fragment);
    const decoded = decodeComparisonLinkFragment(fragment);
    assert.deepEqual(decoded, { status: "valid", listingIds: ids });
    assert.equal(Object.isFrozen(decoded.listingIds), true);
  }
});

test("decoded publication IDs are detached from the creator selection", () => {
  const input = listingIds.slice(0, 2);
  const fragment = encodeComparisonLinkFragment(input);
  assert.ok(fragment);
  input.reverse();
  assert.deepEqual(decodeComparisonLinkFragment(fragment), { status: "valid", listingIds: listingIds.slice(0, 2) });
});

test("comparison link encoding rejects invalid cardinality, duplicate IDs and invalid IDs without coercion", () => {
  let coercions = 0;
  const hostileId = { toString() { coercions += 1; throw new Error("must not coerce"); } };
  const invalid = [
    [],
    [listingIds[0]],
    [...listingIds, "lst_comparison-link-04"],
    [listingIds[0], listingIds[0]],
    [listingIds[0], "lst_"],
    [listingIds[0], "lst_contains/slash"],
    [listingIds[0], hostileId],
  ];
  for (const value of invalid) assert.doesNotThrow(() => assert.equal(encodeComparisonLinkFragment(value), undefined));
  assert.equal(coercions, 0);
});

test("comparison link encoding rejects accessors, symbols, extras, sparse arrays and altered prototypes", () => {
  let getterCalls = 0;
  const accessor = [listingIds[0], listingIds[1]];
  Object.defineProperty(accessor, "0", { enumerable: true, get() { getterCalls += 1; return listingIds[0]; } });
  const symbolic = [listingIds[0], listingIds[1]];
  symbolic[Symbol("private")] = true;
  const extra = [listingIds[0], listingIds[1]];
  extra.private = true;
  const sparse = new Array(2);
  sparse[0] = listingIds[0];
  const changedPrototype = [listingIds[0], listingIds[1]];
  Object.setPrototypeOf(changedPrototype, null);
  const hostileProxy = new Proxy([], { ownKeys() { throw new Error("hostile proxy"); } });

  for (const value of [accessor, symbolic, extra, sparse, changedPrototype, hostileProxy, { 0: listingIds[0], 1: listingIds[1], length: 2 }]) {
    assert.doesNotThrow(() => assert.equal(encodeComparisonLinkFragment(value), undefined));
  }
  assert.equal(getterCalls, 0);
});

test("comparison link decoding distinguishes unsupported versions from invalid payloads", () => {
  const encoded = encodeURIComponent(JSON.stringify(listingIds.slice(0, 2)));
  assert.deepEqual(decodeComparisonLinkFragment(`${COMPARISON_LINK_PREFIX}v2/${encoded}`), { status: "unsupported" });
  assert.deepEqual(decodeComparisonLinkFragment(`${COMPARISON_LINK_PREFIX}v999/${encoded}`), { status: "unsupported" });
  for (const fragment of [
    "#comparison-link",
    COMPARISON_LINK_PREFIX,
    `${COMPARISON_LINK_PREFIX}v1`,
    `${COMPARISON_LINK_PREFIX}version2/${encoded}`,
    `${COMPARISON_LINK_PREFIX}v1/`,
    `${COMPARISON_LINK_PREFIX}v1/%`,
    `${COMPARISON_LINK_PREFIX}v1/%ED%A0%80`,
    `${COMPARISON_LINK_PREFIX}v1/${encodeURIComponent(encoded)}`,
    fragmentFromJson(JSON.stringify([listingIds[0], listingIds[0]])),
    fragmentFromJson(JSON.stringify({ listingIds: listingIds.slice(0, 2) })),
    fragmentFromJson(JSON.stringify([listingIds[0]])),
    "#results",
    42,
    null,
  ]) assert.deepEqual(decodeComparisonLinkFragment(fragment), { status: "invalid" });
});

test("comparison link decoding enforces the raw fragment cap before decoding", () => {
  const prefix = `${COMPARISON_LINK_PREFIX}v1/`;
  const encoded = encodeURIComponent(JSON.stringify(listingIds.slice(0, 2)));
  const exact = `${prefix}${encoded}${" ".repeat(COMPARISON_LINK_MAX_LENGTH - prefix.length - encoded.length)}`;
  assert.equal(exact.length, COMPARISON_LINK_MAX_LENGTH);
  assert.deepEqual(decodeComparisonLinkFragment(exact), { status: "valid", listingIds: listingIds.slice(0, 2) });
  assert.deepEqual(decodeComparisonLinkFragment(`${exact} `), { status: "invalid" });
});

test("comparison links pin the destination to a fresh HTTP(S) demo origin", () => {
  const ids = listingIds.slice(0, 2);
  const fragment = encodeComparisonLinkFragment(ids);
  assert.ok(fragment);
  assert.equal(buildComparisonLink(ids, "https://example.com:8443/private/path?token=secret#results"), `https://example.com:8443/demo${fragment}`);
  assert.equal(buildComparisonLink(ids, "http://127.0.0.1:3000/anything"), `http://127.0.0.1:3000/demo${fragment}`);

  let coercions = 0;
  const hostilePageUrl = { toString() { coercions += 1; throw new Error("must not coerce"); } };
  assert.equal(buildComparisonLink(ids, hostilePageUrl), undefined);
  assert.equal(coercions, 0);
  const syntheticCredentialUrl = new URL("https://example.com/demo");
  syntheticCredentialUrl.username = "synthetic-user";
  syntheticCredentialUrl.password = "synthetic-password";
  assert.equal(buildComparisonLink(ids, syntheticCredentialUrl.href), undefined);
  for (const pageUrl of [
    "ftp://example.com/demo",
    "file:///demo",
    "data:text/plain,hello",
    "https://",
    "https://exa mple.com/demo",
    "/demo",
    "not a URL",
  ]) assert.equal(buildComparisonLink(ids, pageUrl), undefined);
});

test("comparison bundle resolution preserves request order and independent response metadata", () => {
  const first = acceptedItem(listingIds[0], { dataAsOf: "2026-10-20T10:14:12.125Z", state: "complete" });
  const second = acceptedItem(listingIds[1], { dataAsOf: "2026-10-20T10:14:47.875Z", state: "partial" });
  const bundle = resolveComparisonBundle(listingIds.slice(0, 2), [second, first]);
  assert.equal(bundle.status, "ready");
  assert.deepEqual(bundle.entries.map((entry) => entry.result.listingId), listingIds.slice(0, 2));
  assert.deepEqual(bundle.responses.map(({ dataAsOf, state }) => ({ dataAsOf, state })), [
    { dataAsOf: "2026-10-20T10:14:12.125Z", state: "complete" },
    { dataAsOf: "2026-10-20T10:14:47.875Z", state: "partial" },
  ]);
});

test("comparison bundle resolution remains incomplete until every requested publication succeeds with its expected ID", () => {
  const first = acceptedItem(listingIds[0]);
  const failed = { listingId: listingIds[1], outcome: { ok: false, code: "read_unavailable" } };
  const mismatched = { listingId: listingIds[1], outcome: { ...acceptedItem(listingIds[0]).outcome } };
  assert.deepEqual(resolveComparisonBundle(listingIds.slice(0, 2), [first]), { status: "incomplete" });
  assert.deepEqual(resolveComparisonBundle(listingIds.slice(0, 2), [first, failed]), { status: "incomplete" });
  assert.deepEqual(resolveComparisonBundle(listingIds.slice(0, 2), [first, mismatched]), { status: "incomplete" });
});

test("comparison bundle resolution rejects mixed fixture and taxonomy release tuples", () => {
  const first = acceptedItem(listingIds[0]);
  const mixedFixture = acceptedItem(listingIds[1], { fixtureVersion: "comparison-links-v2" });
  const mixedRelease = acceptedItem(listingIds[1], { taxonomyRelease: { ...release, revision: 2 } });
  assert.deepEqual(resolveComparisonBundle(listingIds.slice(0, 2), [first, mixedFixture]), { status: "incompatible" });
  assert.deepEqual(resolveComparisonBundle(listingIds.slice(0, 2), [first, mixedRelease]), { status: "incompatible" });
});

test("comparison bundle resolution accepts successful ended publication states", () => {
  for (const availability of ["withdrawn", "deleted", "missing"]) {
    const bundle = resolveComparisonBundle(listingIds.slice(0, 2), [acceptedItem(listingIds[0]), acceptedItem(listingIds[1], { availability })]);
    assert.equal(bundle.status, "ready");
    assert.equal(bundle.entries[1].result.availability, availability);
  }
});

test("comparison detail loading preserves expected transport rejections as offline slot outcomes", async () => {
  const client = createDemoClientV2({ fetchImpl: async () => { throw new TypeError("network unavailable"); } });
  const items = await loadSavedDetailsV2(client, listingIds.slice(0, 2));
  assert.deepEqual(items.map(({ listingId, outcome }) => ({ listingId, outcome })), [
    { listingId: listingIds[0], outcome: { ok: false, code: "offline" } },
    { listingId: listingIds[1], outcome: { ok: false, code: "offline" } },
  ]);
});

test("comparison detail loading rejects unexpected client failures instead of returning an empty batch", async () => {
  const client = {
    catalog: async () => { throw new Error("unused"); },
    search: async () => { throw new Error("unused"); },
    listing: async () => { throw new Error("unexpected loader failure"); },
  };
  await assert.rejects(
    loadSavedDetailsV2(client, listingIds.slice(0, 2)),
    /unexpected loader failure/u,
  );
});
