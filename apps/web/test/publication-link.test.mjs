import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicationLink } from "../.test-dist/src/demo/publication-link.js";

test("publication links pin accepted listing IDs to the current HTTP(S) origin", () => {
  assert.equal(
    buildPublicationLink("lst_synthetic-01", "https://example.com:8443/tracked/path?utm_source=private#saved"),
    "https://example.com:8443/demo#detail/lst_synthetic-01",
  );
  assert.equal(
    buildPublicationLink(`lst_${"a".repeat(64)}`, "http://127.0.0.1:3000/results?secret=yes#detail/lst_other"),
    `http://127.0.0.1:3000/demo#detail/lst_${"a".repeat(64)}`,
  );
});

test("publication links reject invalid listing IDs without coercing hostile inputs", () => {
  let coercions = 0;
  const hostile = { toString() { coercions += 1; throw new Error("must not coerce"); } };
  for (const listingId of [
    "lst_",
    `lst_${"a".repeat(65)}`,
    "lst_-starts-with-symbol",
    "lst_contains space",
    "lst_contains/slash",
    "lst_contains%2Fencoding",
    "lst_é",
    "other_synthetic",
    "lst_synthetic?private=yes",
    42,
    null,
    undefined,
    hostile,
  ]) assert.doesNotThrow(() => assert.equal(buildPublicationLink(listingId, "https://example.com/demo"), undefined));
  assert.equal(coercions, 0);
});

test("publication links reject unsafe or malformed page origins without inheriting payload", () => {
  let coercions = 0;
  const hostilePageUrl = { toString() { coercions += 1; throw new Error("must not coerce"); } };
  assert.equal(buildPublicationLink("lst_synthetic", hostilePageUrl), undefined);
  assert.equal(coercions, 0);

  const credentialUrl = new URL("https://example.com/demo");
  credentialUrl.username = "synthetic-user";
  credentialUrl.password = "synthetic-password";
  assert.equal(buildPublicationLink("lst_synthetic", credentialUrl.href), undefined);

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
  ]) assert.equal(buildPublicationLink("lst_synthetic", pageUrl), undefined);
});
