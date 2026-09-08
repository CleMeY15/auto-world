import assert from "node:assert/strict";
import { test } from "node:test";
import * as oci from "../scripts/supply-chain/oci.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";

// Pinned oras-go/v2.6.2 marshals the transport Index and Descriptor structs in
// this order: tagged parent, then the single digest-only child manifest.
// Content-addressed blobs are copied without reserialization.
const copiedFixture = () => {
  const fixture = oci.createBootstrapFixture();
  const parent = JSON.parse(fixture.files.get("index.json")).manifests[0];
  const child = JSON.parse(fixture.files.get(`blobs/sha256/${parent.digest.slice(7)}`)).manifests[0];
  const index = Buffer.from(`{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[{"mediaType":"application/vnd.oci.image.index.v1+json","digest":"${parent.digest}","size":${parent.size},"annotations":{"org.opencontainers.image.ref.name":"bootstrap"}},{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"${child.digest}","size":${child.size},"platform":{"architecture":"amd64","os":"linux"}}]}`);
  assert.equal(index.length, 503);
  assert.equal(sha256(index), "4d87d7560b88f51a04b219279483621ec4fd32744e67446a5c12a9f97ae0bba2");
  const files = new Map([...fixture.files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  files.set("index.json", index);
  return { fixture, files };
};

const refused = (files) => assert.throws(() => oci.validateOrasCopiedFixture(files),
  (error) => error?.code === "OCI_COPIED_PROFILE_MISMATCH");

test("pinned ORAS copied profile preserves the exact source graph without rewriting input", () => {
  const { fixture, files } = copiedFixture();
  const before = new Map([...files].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  assert.throws(() => oci.validateBootstrapFixture(files), (error) => error?.code === "OCI_JSON_NONCANONICAL");
  assert.deepEqual(oci.validateOrasCopiedFixture(files), oci.validateBootstrapFixture(fixture.files));
  assert.deepEqual(files, before);
  assert.equal(fixture.files.get("index.json").length, 247);
});

test("ORAS copied profile rejects every alternate transport serialization or descriptor", () => {
  const { fixture, files } = copiedFixture();
  const index = files.get("index.json");
  const parsed = JSON.parse(index);
  const descriptor = parsed.manifests[0];
  const child = parsed.manifests[1];
  const variants = [fixture.files.get("index.json"), canonicalJsonBuffer(parsed),
    Buffer.concat([index, Buffer.from("\n")]), Buffer.from(JSON.stringify(parsed, null, 2)),
    Buffer.from(JSON.stringify({ ...parsed, extra: true })),
    Buffer.from(JSON.stringify({ ...parsed, manifests: [{ ...descriptor, extra: true }, child] })),
    Buffer.from(JSON.stringify({ ...parsed, manifests: [descriptor, descriptor, child] })),
    Buffer.from(JSON.stringify({ ...parsed, manifests: [{ ...descriptor, size: descriptor.size + 1 }, child] })),
    Buffer.from(index.toString().replace("bootstrap", "other-tag")),
    Buffer.from(index.toString().replace(descriptor.digest, `sha256:${"0".repeat(64)}`)),
  ];
  for (const variant of variants) refused(new Map(files).set("index.json", variant));
});

test("ORAS copied profile requires the exact digest-only child after the tagged parent", () => {
  const { files } = copiedFixture();
  const parsed = JSON.parse(files.get("index.json"));
  const [parent, child] = parsed.manifests;
  const encode = (manifests) => Buffer.from(JSON.stringify({ ...parsed, manifests }));
  const omitted = encode([parent]);
  assert.equal(omitted.length, 301);
  assert.equal(sha256(omitted), "d66f6dd5e3986378305f240943c37e8462f960a50e7c389a2536bad765181776");
  const variants = [omitted, encode([child, parent]), encode([parent, child, child]),
    encode([parent, { ...child, digest: `sha256:${"0".repeat(64)}` }]),
    encode([parent, { ...child, mediaType: parent.mediaType }]),
    encode([parent, { ...child, size: child.size + 1 }]),
    encode([parent, { ...child, platform: { architecture: "arm64", os: "linux" } }]),
    encode([parent, { ...child, platform: { architecture: "amd64", os: "windows" } }]),
    encode([parent, { ...child, platform: { os: "linux", architecture: "amd64" } }]),
    encode([parent, { ...child, annotations: { "org.opencontainers.image.ref.name": "child" } }]),
    encode([parent, { ...child, extra: true }]),
  ];
  for (const variant of variants) refused(new Map(files).set("index.json", variant));
});

test("ORAS copied profile binds all five paths and every layout or blob byte", () => {
  const { files } = copiedFixture();
  for (const [name, bytes] of files) {
    const missing = new Map(files);
    missing.delete(name);
    refused(missing);
    const altered = Buffer.from(bytes);
    altered[0] ^= 1;
    refused(new Map(files).set(name, altered));
    refused(new Map(files).set(name, new Uint8Array(bytes)));
  }
  refused(new Map(files).set("orphan", Buffer.from("secret sentinel")));
  const replaced = new Map(files);
  replaced.delete("oci-layout");
  replaced.set("../outside", Buffer.from("secret sentinel"));
  refused(replaced);
  refused(new Map(files).set("oci-layout", Buffer.alloc(256 * 1024 + 1)));
  refused(null);
  refused({ size: 5 });
});
