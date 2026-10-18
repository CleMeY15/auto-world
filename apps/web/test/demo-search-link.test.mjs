import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchLink,
  decodeSearchLinkFragment,
  encodeSearchLinkFragment,
  isSearchLinkFragment,
  SEARCH_LINK_MAX_LENGTH,
  SEARCH_LINK_PREFIX,
} from "../.test-dist/src/demo/search-link.js";

const release = { catalogId: "taxcat_links", releaseId: "taxrel_links_v1", revision: 7 };
const binding = { fixtureVersion: "links-v1", taxonomyRelease: release };
const identityCriteria = {
  query: {
    schemaVersion: 2,
    sort: "price_asc",
    priceMaxMinor: 9_007_199_254_740_991,
    mileageMaxKm: 5e-324,
    makeId: "make_links",
    modelId: "model_links",
    firstRegistrationYear: 2026,
  },
  binding,
};

function fragmentFromJson(source, version = "v1") {
  return `${SEARCH_LINK_PREFIX}${version}/${encodeURIComponent(source)}`;
}

test("fragment helpers recognize the route and round-trip canonical criteria", () => {
  assert.equal(SEARCH_LINK_PREFIX, "#search-link/");
  assert.equal(SEARCH_LINK_MAX_LENGTH, 4096);
  assert.equal(isSearchLinkFragment("#search-link"), true);
  assert.equal(isSearchLinkFragment("#search-link/v1/x"), true);
  assert.equal(isSearchLinkFragment("#search-links/v1/x"), false);

  const cases = [
    { query: { schemaVersion: 2, sort: "listing_asc" } },
    { query: { schemaVersion: 2, sort: "price_asc", priceMaxMinor: 0, mileageMaxKm: 0 } },
    { query: { schemaVersion: 2, sort: "price_desc", priceMaxMinor: Number.MAX_SAFE_INTEGER, mileageMaxKm: Number.MAX_SAFE_INTEGER } },
    { query: { schemaVersion: 2, sort: "mileage_asc", mileageMaxKm: Number.MIN_VALUE } },
    { query: { schemaVersion: 2, sort: "mileage_desc", mileageMaxKm: 1e-7, firstRegistrationYear: 1886 } },
    identityCriteria,
  ];
  for (const criteria of cases) {
    const encoded = encodeSearchLinkFragment(criteria);
    assert.ok(encoded);
    const decoded = decodeSearchLinkFragment(encoded);
    assert.equal(decoded.status, "valid");
    assert.deepEqual(decoded.criteria, criteria);
    assert.equal(Object.isFrozen(decoded.criteria), true);
    assert.equal(Object.isFrozen(decoded.criteria.query), true);
    if (decoded.criteria.binding !== undefined) {
      assert.equal(Object.isFrozen(decoded.criteria.binding), true);
      assert.equal(Object.isFrozen(decoded.criteria.binding.taxonomyRelease), true);
    }
    assert.equal(encodeSearchLinkFragment(decoded.criteria), encoded);
  }
});

test("encoding normalizes negative zero and returns a detached frozen value on decode", () => {
  const input = { query: { schemaVersion: 2, sort: "listing_asc", priceMaxMinor: -0, mileageMaxKm: -0 } };
  const fragment = encodeSearchLinkFragment(input);
  assert.ok(fragment);
  input.query.sort = "price_desc";
  input.query.priceMaxMinor = 42;
  const decoded = decodeSearchLinkFragment(fragment);
  assert.deepEqual(decoded, { status: "valid", criteria: { query: { schemaVersion: 2, sort: "listing_asc", priceMaxMinor: 0, mileageMaxKm: 0 } } });
  assert.equal(Object.is(decoded.criteria.query.priceMaxMinor, -0), false);
  assert.equal(Object.is(decoded.criteria.query.mileageMaxKm, -0), false);
});

test("encoding rejects accessors, symbols, non-plain values, hostile proxies, cursor, unknown fields and binding errors", () => {
  let getterCalls = 0;
  const accessorQuery = {};
  Object.defineProperty(accessorQuery, "schemaVersion", { enumerable: true, get() { getterCalls += 1; return 2; } });
  Object.defineProperty(accessorQuery, "sort", { enumerable: true, value: "listing_asc" });
  assert.equal(encodeSearchLinkFragment({ query: accessorQuery }), undefined);
  assert.equal(getterCalls, 0);

  const symbolCriteria = { query: { schemaVersion: 2, sort: "listing_asc" }, [Symbol("private")]: true };
  const nullPrototypeQuery = Object.assign(Object.create(null), { schemaVersion: 2, sort: "listing_asc" });
  const inherited = Object.create({ query: { schemaVersion: 2, sort: "listing_asc" } });
  const hostile = new Proxy({}, { ownKeys() { throw new Error("hostile proxy"); } });
  const invalid = [
    symbolCriteria,
    { query: nullPrototypeQuery, extra: true },
    inherited,
    [],
    new Date(0),
    hostile,
    { query: { schemaVersion: 2, sort: "listing_asc", cursor: `cur_${"a".repeat(64)}` } },
    { query: { schemaVersion: 2, sort: "listing_asc", private: true } },
    { query: { schemaVersion: 2, sort: "listing_asc", mileageMaxKm: Number.MAX_VALUE } },
    { query: identityCriteria.query },
    { query: { schemaVersion: 2, sort: "listing_asc" }, binding },
    { query: identityCriteria.query, binding: { ...binding, fixtureVersion: "links-v1\n" } },
    { query: identityCriteria.query, binding: { ...binding, taxonomyRelease: { ...release, revision: 0 } } },
    { query: { ...identityCriteria.query, makeId: undefined }, binding },
  ];
  for (const value of invalid) assert.doesNotThrow(() => assert.equal(encodeSearchLinkFragment(value), undefined));
});

test("decoding rejects duplicate, prototype, private, unknown and invalid criteria members", () => {
  const invalidJson = [
    '{"query":{"schemaVersion":2,"sort":"listing_asc"},"query":{"schemaVersion":2,"sort":"listing_asc"}}',
    '{"query":{"schemaVersion":2,"sort":"listing_asc","__proto__":null}}',
    '{"query":{"schemaVersion":2,"sort":"listing_asc","constructor":null}}',
    '{"query":{"schemaVersion":2,"sort":"listing_asc","prototype":null}}',
    '{"query":{"schemaVersion":2,"sort":"listing_asc","private":true}}',
    '{"query":{"schemaVersion":2,"sort":"listing_asc"},"private":true}',
    JSON.stringify({ query: { schemaVersion: 2, sort: "listing_asc", cursor: `cur_${"b".repeat(64)}` } }),
    JSON.stringify({ query: identityCriteria.query }),
    JSON.stringify({ query: { schemaVersion: 2, sort: "listing_asc" }, binding }),
    JSON.stringify({ query: { ...identityCriteria.query, modelId: "model_other" }, binding: { ...binding, extra: true } }),
  ];
  for (const source of invalidJson) assert.deepEqual(decodeSearchLinkFragment(fragmentFromJson(source)), { status: "invalid" });
});

test("decoding distinguishes unsupported versions and rejects malformed URI, UTF-8 and double encoding", () => {
  const valid = encodeSearchLinkFragment({ query: { schemaVersion: 2, sort: "listing_asc" } });
  assert.ok(valid);
  const encodedPayload = valid.slice(`${SEARCH_LINK_PREFIX}v1/`.length);
  assert.deepEqual(decodeSearchLinkFragment(`${SEARCH_LINK_PREFIX}v2/${encodedPayload}`), { status: "unsupported" });
  assert.deepEqual(decodeSearchLinkFragment(`${SEARCH_LINK_PREFIX}v999/${encodedPayload}`), { status: "unsupported" });
  for (const fragment of [
    "#search-link",
    SEARCH_LINK_PREFIX,
    `${SEARCH_LINK_PREFIX}v1`,
    `${SEARCH_LINK_PREFIX}version2/${encodedPayload}`,
    `${SEARCH_LINK_PREFIX}v1/`,
    `${SEARCH_LINK_PREFIX}v1/%`,
    `${SEARCH_LINK_PREFIX}v1/%ED%A0%80`,
    `${SEARCH_LINK_PREFIX}v1/${encodeURIComponent(encodedPayload)}`,
    "#results",
    42,
    null,
  ]) assert.deepEqual(decodeSearchLinkFragment(fragment), { status: "invalid" });
});

test("the raw fragment length cap is enforced before decoding", () => {
  const prefix = `${SEARCH_LINK_PREFIX}v1/`;
  const json = JSON.stringify({ query: { schemaVersion: 2, sort: "listing_asc" } });
  const encoded = encodeURIComponent(json);
  // JSON permits trailing whitespace. Raw spaces pad the fragment without
  // changing its valid payload or confusing the cap with decoded JSON length.
  const exact = `${prefix}${encoded}${" ".repeat(SEARCH_LINK_MAX_LENGTH - prefix.length - encoded.length)}`;
  const over = `${exact} `;
  assert.equal(exact.length, SEARCH_LINK_MAX_LENGTH);
  assert.equal(over.length, SEARCH_LINK_MAX_LENGTH + 1);
  assert.deepEqual(decodeSearchLinkFragment(exact), { status: "valid", criteria: { query: { schemaVersion: 2, sort: "listing_asc" } } });
  assert.deepEqual(decodeSearchLinkFragment(over), { status: "invalid" });
});

test("URL construction pins the destination to the HTTP(S) origin and fixed demo path", () => {
  const criteria = { query: { schemaVersion: 2, sort: "listing_asc", mileageMaxKm: 0 } };
  const fragment = encodeSearchLinkFragment(criteria);
  assert.ok(fragment);
  assert.equal(
    buildSearchLink(criteria, "https://example.com:8443/tracked/path?utm_source=private#detail/listing"),
    `https://example.com:8443/demo${fragment}`,
  );
  assert.equal(buildSearchLink(criteria, "http://127.0.0.1:3000/anything?secret=yes"), `http://127.0.0.1:3000/demo${fragment}`);
  let coercions = 0;
  const hostilePageUrl = { toString() { coercions += 1; throw new Error("must not coerce"); } };
  assert.equal(buildSearchLink(criteria, hostilePageUrl), undefined);
  assert.equal(coercions, 0);
  const syntheticCredentialUrl = new URL("https://example.com/demo");
  syntheticCredentialUrl.username = "synthetic-user";
  syntheticCredentialUrl.password = "synthetic-password";
  assert.equal(buildSearchLink(criteria, syntheticCredentialUrl.href), undefined);
  for (const pageUrl of [
    "ftp://example.com/demo",
    "file:///demo",
    "data:text/plain,hello",
    "https://user@example.com/demo",
    "https://",
    "https://exa mple.com/demo",
    "https://[::1/demo",
    "https://example.com:bad/demo",
    "/demo",
    "not a URL",
  ]) assert.equal(buildSearchLink(criteria, pageUrl), undefined);
  assert.equal(buildSearchLink({ query: { schemaVersion: 2, sort: "listing_asc", destination: "https://evil.example" } }, "https://example.com/demo"), undefined);
});
