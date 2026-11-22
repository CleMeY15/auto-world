import assert from "node:assert/strict";
import test from "node:test";
import { freezeManifest, publicHttpsUrl, digest } from "../dist/manifest.js";
import { encodeCapture, decodeCapture } from "../dist/capture.js";

const manifest = () => ({ schemaVersion: 1, sourceId: "src_owned_fixture", territory: "FR",
  origin: "https://inventory.example", maxBodyBytes: 4096,
  entries: [{ sourceListingId: "car-1", url: "https://inventory.example/cars/1" }] });

test("manifest freezes a detached ordered snapshot and binds content into its digest", () => {
  const input = manifest();
  const frozen = freezeManifest(input);
  assert.ok(frozen);
  const original = frozen.sha256;
  input.entries[0].url = "https://inventory.example/cars/2";
  assert.equal(frozen.manifest.entries[0].url, "https://inventory.example/cars/1");
  assert.notEqual(freezeManifest(input).sha256, original);
  assert.notEqual(freezeManifest({ ...manifest(), maxBodyBytes: 2048 }).sha256, original);
  assert.ok(Object.isFrozen(frozen.manifest.entries[0]));
});

test("manifest rejects duplicate ids, duplicate URLs, foreign origins and unbounded budgets", () => {
  for (const changed of [
    { entries: [manifest().entries[0], manifest().entries[0]] },
    { entries: [manifest().entries[0], { sourceListingId: "car-2", url: manifest().entries[0].url }] },
    { entries: [{ sourceListingId: "car-1", url: "https://foreign.example/cars/1" }] },
    { entries: [] }, { maxBodyBytes: 524289 }, { maxBodyBytes: 0 },
    { origin: "https://inventory.example/" }, { territory: "ZZ" },
    { entries: Array.from({ length: 101 }, (_, index) => ({ sourceListingId: `car-${index}`, url: `https://inventory.example/cars/${index}` })) },
  ]) assert.equal(freezeManifest({ ...manifest(), ...changed }), null);
});

test("manifest rejects accessors without invoking them", () => {
  const input = manifest();
  Object.defineProperty(input, "origin", { get() { throw new Error("getter executed"); }, enumerable: true });
  assert.equal(freezeManifest(input), null);
});

test("URL boundary rejects credentials, fragments, local hosts, literal IPs and alternate ports", () => {
  for (const value of ["http://inventory.example/a", "https://a:b@inventory.example/a", "https://inventory.example/a#x",
    "https://127.0.0.1/a", "https://2130706433/a", "https://[::1]/a", "https://localhost/a", "https://inventory.local/a",
    "https://inventory.example:8443/a", "https://inventory.example./a", "https://inventory.example/a b"]) {
    assert.equal(publicHttpsUrl(value), null, value);
  }
});

test("capture retains exact bytes with independent body and envelope hashes", () => {
  const frozen = freezeManifest(manifest());
  const body = new Uint8Array([0, 255, 60, 62, 10, 13, 9]);
  const bytes = encodeCapture(body, frozen.manifest, frozen.sha256, 0);
  const envelope = JSON.parse(new globalThis.TextDecoder().decode(bytes));
  assert.equal(envelope.bodySha256, digest(body));
  assert.notEqual(digest(bytes), envelope.bodySha256);
  assert.deepEqual(decodeCapture(envelope, frozen.manifest, frozen.sha256).body, body);
});

test("capture refuses altered bytes, noncanonical base64, identity, ordinal or manifest", () => {
  const frozen = freezeManifest(manifest());
  const envelope = JSON.parse(new globalThis.TextDecoder().decode(encodeCapture(new Uint8Array([1, 2, 3]), frozen.manifest, frozen.sha256, 0)));
  for (const change of [{ bodyBase64: "AgID" }, { bodyBase64: "AQID\n" }, { bodyLength: 4 },
    { sourceListingId: "other" }, { url: "https://inventory.example/other" }, { ordinal: 1 },
    { manifestSha256: "0".repeat(64) }, { status: 404 }, { extra: true }]) {
    assert.equal(decodeCapture({ ...envelope, ...change }, frozen.manifest, frozen.sha256), null);
  }
});
