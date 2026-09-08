import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJsonBuffer,
  sha256,
} from "../scripts/supply-chain/strict-json.mjs";
import {
  createBootstrapFixture,
  OCI_MEDIA_TYPES,
  validateBootstrapFixture,
} from "../scripts/supply-chain/oci.mjs";

const code = (expected) => (error) => error?.code === expected;
const digest = (bytes) => `sha256:${sha256(bytes)}`;
const pathFor = (value) => `blobs/sha256/${value.slice(7)}`;
const cloneFiles = (files) => new Map([...files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
const parsed = (bytes) => JSON.parse(bytes.toString("utf8"));

const replaceBlob = (files, oldDigest, value) => {
  const bytes = canonicalJsonBuffer(value);
  const nextDigest = digest(bytes);
  files.delete(pathFor(oldDigest));
  files.set(pathFor(nextDigest), bytes);
  return { bytes, digest: nextDigest };
};

test("bootstrap fixture is reproducible and binds the inner index as parent", () => {
  const first = createBootstrapFixture();
  const second = createBootstrapFixture();
  assert.deepEqual([...first.files], [...second.files]);
  assert.deepEqual(validateBootstrapFixture(first.files), {
    childDigest: first.childDigest,
    configDigest: first.configDigest,
    parentDigest: first.parentDigest,
  });
  assert.notEqual(first.parentDigest, digest(first.files.get("index.json")));
  assert.equal(parsed(first.files.get(pathFor(first.parentDigest))).mediaType, OCI_MEDIA_TYPES.index);
});

test("OCI validation rejects direct manifest roots and unknown outer fields", () => {
  const fixture = createBootstrapFixture();
  const files = cloneFiles(fixture.files);
  const outer = parsed(files.get("index.json"));
  outer.manifests[0].mediaType = OCI_MEDIA_TYPES.manifest;
  files.set("index.json", canonicalJsonBuffer(outer));
  assert.throws(() => validateBootstrapFixture(files), code("OCI_MEDIA_TYPE_INVALID"));

  const unknown = cloneFiles(fixture.files);
  unknown.set("index.json", canonicalJsonBuffer({ ...parsed(unknown.get("index.json")), extra: true }));
  assert.throws(() => validateBootstrapFixture(unknown), code("SCHEMA_FIELD_UNKNOWN"));
});

test("OCI validation rejects missing, altered, and orphan blobs", () => {
  const fixture = createBootstrapFixture();
  const missing = cloneFiles(fixture.files);
  missing.delete(pathFor(fixture.childDigest));
  assert.throws(() => validateBootstrapFixture(missing), code("OCI_BLOB_MISSING"));

  const altered = cloneFiles(fixture.files);
  altered.get(pathFor(fixture.configDigest))[0] ^= 1;
  assert.throws(() => validateBootstrapFixture(altered), code("OCI_DIGEST_MISMATCH"));

  const orphan = cloneFiles(fixture.files);
  orphan.set(`blobs/sha256/${"0".repeat(64)}`, Buffer.from("orphan"));
  assert.throws(() => validateBootstrapFixture(orphan), code("OCI_FILE_ORPHAN"));
});

test("OCI validation rejects a nonzero layer and wrong platform after digest rewiring", () => {
  const fixture = createBootstrapFixture();
  const layered = cloneFiles(fixture.files);
  const manifest = parsed(layered.get(pathFor(fixture.childDigest)));
  manifest.layers.push({ digest: `sha256:${"0".repeat(64)}`, mediaType: "application/vnd.oci.image.layer.v1.tar", size: 0 });
  const nextManifest = replaceBlob(layered, fixture.childDigest, manifest);
  const inner = parsed(layered.get(pathFor(fixture.parentDigest)));
  inner.manifests[0].digest = nextManifest.digest;
  inner.manifests[0].size = nextManifest.bytes.length;
  const nextInner = replaceBlob(layered, fixture.parentDigest, inner);
  const outer = parsed(layered.get("index.json"));
  outer.manifests[0].digest = nextInner.digest;
  outer.manifests[0].size = nextInner.bytes.length;
  layered.set("index.json", canonicalJsonBuffer(outer));
  assert.throws(() => validateBootstrapFixture(layered), code("OCI_LAYERS_INVALID"));

  const wrongPlatform = cloneFiles(fixture.files);
  const platformInner = parsed(wrongPlatform.get(pathFor(fixture.parentDigest)));
  platformInner.manifests[0].platform.architecture = "arm64";
  const replacedInner = replaceBlob(wrongPlatform, fixture.parentDigest, platformInner);
  const platformOuter = parsed(wrongPlatform.get("index.json"));
  platformOuter.manifests[0].digest = replacedInner.digest;
  platformOuter.manifests[0].size = replacedInner.bytes.length;
  wrongPlatform.set("index.json", canonicalJsonBuffer(platformOuter));
  assert.throws(() => validateBootstrapFixture(wrongPlatform), code("OCI_PLATFORM_INVALID"));
});

test("OCI validation enforces canonical JSON and exact layout boundary", () => {
  const fixture = createBootstrapFixture();
  const noncanonical = cloneFiles(fixture.files);
  noncanonical.set("oci-layout", Buffer.from('{ "imageLayoutVersion": "1.0.0" }'));
  assert.throws(() => validateBootstrapFixture(noncanonical), code("OCI_JSON_NONCANONICAL"));

  const total = [...fixture.files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  const fillerLength = 32 * 1024 - total;
  const boundary = cloneFiles(fixture.files);
  boundary.set("boundary", Buffer.alloc(fillerLength));
  assert.throws(() => validateBootstrapFixture(boundary), code("OCI_FILE_ORPHAN"));
  boundary.set("boundary", Buffer.alloc(fillerLength + 1));
  assert.throws(() => validateBootstrapFixture(boundary), code("OCI_LAYOUT_TOO_LARGE"));

  const oversizedAsset = cloneFiles(fixture.files);
  oversizedAsset.set("oversized", Buffer.alloc(256 * 1024 + 1));
  assert.throws(() => validateBootstrapFixture(oversizedAsset), code("OCI_ASSET_TOO_LARGE"));
});
