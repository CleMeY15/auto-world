import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";
import {
  buildFixtureTar, fixtureConfig, fixtureEntries, sha256, validateRuntimeConfig, validateSavedImage,
} from "../scripts/image-import-fixture/archive.mjs";

const BLOCK = 512;
const OWNER = "run-12345-attempt-1";
const TAG = `auto-world-import-fixture:${OWNER}`;
const CREATED = "2026-09-23T12:00:00Z";

function octal(header, offset, length, value) {
  Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`, "ascii").copy(header, offset);
}

function header({ name, content = Buffer.alloc(0), type = "0", mode = 0o644, uid = 0, gid = 0, mtime = 1 }) {
  const value = Buffer.alloc(BLOCK);
  Buffer.from(name).copy(value, 0); octal(value, 100, 8, mode); octal(value, 108, 8, uid); octal(value, 116, 8, gid);
  octal(value, 124, 12, content.length); octal(value, 136, 12, mtime); value.fill(0x20, 148, 156);
  value[156] = type.charCodeAt(0); Buffer.from("ustar\0").copy(value, 257); Buffer.from("00").copy(value, 263);
  const sum = value.reduce((total, byte) => total + byte, 0);
  Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `).copy(value, 148);
  return value;
}

function tar(entries, { end = true, trailing = Buffer.alloc(0) } = {}) {
  const parts = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0); parts.push(header({ ...entry, content }), content);
    const padding = (BLOCK - content.length % BLOCK) % BLOCK; if (padding) parts.push(Buffer.alloc(padding));
  }
  if (end) parts.push(Buffer.alloc(BLOCK * 2));
  parts.push(trailing);
  return Buffer.concat(parts);
}

function json(value) { return Buffer.from(JSON.stringify(value)); }

function fixtureLayer(mutator) {
  const entries = fixtureEntries.map((entry) => ({
    name: entry.path, type: entry.type === "file" ? "0" : entry.type === "directory" ? "5" : "2",
    mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime,
    content: entry.content ?? Buffer.alloc(0), linkname: entry.linkname,
  }));
  if (mutator) mutator(entries);
  const parts = [];
  for (const entry of entries) {
    const value = header(entry);
    if (entry.linkname) Buffer.from(entry.linkname).copy(value, 157);
    value.fill(0x20, 148, 156); const sum = value.reduce((total, byte) => total + byte, 0);
    Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `).copy(value, 148);
    parts.push(value, entry.content);
    const padding = (BLOCK - entry.content.length % BLOCK) % BLOCK; if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); return Buffer.concat(parts);
}

function savedImage({
  rawLayer = buildFixtureTar(), gzip = false, user = "absent", diffID, configChange, layerMediaType,
  extraEntries = [], manifestLayers, classic = false, storedLayerOverride,
} = {}) {
  const storedLayer = storedLayerOverride ?? (gzip ? gzipSync(rawLayer, { level: 6, mtime: 0 }) : rawLayer);
  const layerDigest = sha256(storedLayer);
  const runtime = fixtureConfig(OWNER); if (user === "empty") runtime.User = ""; if (user === "nonempty") runtime.User = "1000";
  configChange?.(runtime);
  const actualDiffID = diffID ?? `sha256:${sha256(rawLayer)}`;
  const config = json({ architecture: "amd64", os: "linux", created: CREATED, config: runtime,
    rootfs: { type: "layers", diff_ids: [actualDiffID] }, history: [{ created_by: "synthetic import" }] });
  const configDigest = sha256(config);
  const mediaType = layerMediaType ?? (gzip ? "application/vnd.oci.image.layer.v1.tar+gzip" : "application/vnd.oci.image.layer.v1.tar");
  const ociManifest = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: `sha256:${configDigest}`, size: config.length },
    layers: manifestLayers ?? [{ mediaType, digest: `sha256:${layerDigest}`, size: storedLayer.length }] });
  const manifestDigest = sha256(ociManifest);
  const index = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{
    mediaType: "application/vnd.oci.image.manifest.v1+json", digest: `sha256:${manifestDigest}`, size: ociManifest.length,
    annotations: { "io.containerd.image.name": `docker.io/library/${TAG}`, "org.opencontainers.image.ref.name": OWNER },
  }] });
  const compatibilityItem = { Config: `blobs/sha256/${configDigest}`, RepoTags: [TAG], Layers: [`blobs/sha256/${layerDigest}`] };
  const classicEntries = [];
  if (classic) {
    compatibilityItem.LayerSources = { [actualDiffID]: { mediaType: "application/vnd.oci.image.layer.v1.tar", size: storedLayer.length, digest: `sha256:${layerDigest}` } };
    const legacy = json({ id: "b".repeat(64), created: CREATED, config: runtime, architecture: "amd64", os: "linux" });
    classicEntries.push({ name: `blobs/sha256/${sha256(legacy)}`, content: legacy },
      { name: "repositories", content: json({ "auto-world-import-fixture": { [OWNER]: actualDiffID.slice(7) } }) });
  }
  const compatibility = json([compatibilityItem]);
  const archive = tar([
    { name: "oci-layout", content: json({ imageLayoutVersion: "1.0.0" }) },
    { name: "index.json", content: index }, { name: "manifest.json", content: compatibility },
    { name: `blobs/sha256/${manifestDigest}`, content: ociManifest },
    { name: `blobs/sha256/${configDigest}`, content: config },
    { name: `blobs/sha256/${layerDigest}`, content: storedLayer }, ...classicEntries, ...extraEntries,
  ]);
  return { archive, configDigest, layerDigest, manifestDigest, rawLayer };
}

function validate(item, imageId = item.manifestDigest) {
  return validateSavedImage(item.archive, { imageId: `sha256:${imageId}`, tag: TAG, owner: OWNER });
}

test("authored fixture is a small deterministic complete USTAR tree with mixed metadata", () => {
  const first = buildFixtureTar(); const second = buildFixtureTar();
  assert.deepEqual(first, second); assert.ok(first.length <= 64 * 1024); assert.equal(fixtureEntries.length, 9);
  assert.deepEqual(new Set(fixtureEntries.map((entry) => entry.type)), new Set(["file", "directory", "symlink"]));
  assert.ok(new Set(fixtureEntries.map((entry) => `${entry.uid}:${entry.gid}`)).size >= 3);
  assert.equal(first.subarray(first.length - BLOCK * 2).every((byte) => byte === 0), true);
});

test("runtime config distinguishes absent and empty User and rejects nonempty or unrelated changes", () => {
  assert.equal(validateRuntimeConfig(fixtureConfig(OWNER), OWNER), "ABSENT");
  assert.equal(validateRuntimeConfig({ ...fixtureConfig(OWNER), User: "" }, OWNER), "PRESENT_EMPTY");
  assert.throws(() => validateRuntimeConfig({ ...fixtureConfig(OWNER), User: "1000" }, OWNER), /image_import_runtime_user_invalid/u);
  assert.throws(() => validateRuntimeConfig({ ...fixtureConfig(OWNER), WorkingDir: "/tmp" }, OWNER), /image_import_runtime_config_invalid/u);
  assert.throws(() => validateRuntimeConfig({ ...fixtureConfig(OWNER), Extra: false }, OWNER), /image_import_runtime_config_invalid/u);
});

test("validates raw and bounded gzip hybrid saves with manifest image identity", () => {
  for (const gzip of [false, true]) {
    const item = savedImage({ gzip, user: gzip ? "empty" : "absent" }); const receipt = validate(item);
    assert.equal(receipt.identityType, "CONTAINERD_MANIFEST_ID");
    assert.equal(receipt.diffID, `sha256:${sha256(item.rawLayer)}`); assert.equal(receipt.layerMembers, 9);
    assert.equal(receipt.rawUserRepresentation, gzip ? "PRESENT_EMPTY" : "ABSENT");
    assert.match(receipt.archiveSha256, /^[0-9a-f]{64}$/u);
  }
  const reordered = savedImage({ rawLayer: fixtureLayer((entries) => entries.reverse()) });
  assert.doesNotThrow(() => validate(reordered));
});

test("validates the exact classic compatibility additions with config image identity", () => {
  const item = savedImage({ classic: true, user: "empty" });
  const receipt = validate(item, item.configDigest);
  assert.equal(receipt.identityType, "CLASSIC_CONFIG_ID");
  assert.equal(receipt.diffID, `sha256:${sha256(item.rawLayer)}`);
});

test("rejects checksum corruption, truncation, duplicate and traversal names, unsupported types, and octal bounds", () => {
  const checksum = savedImage(); checksum.archive[0] ^= 1;
  assert.throws(() => validate(checksum), /image_import_tar_checksum_invalid/u);
  const truncated = savedImage(); truncated.archive = truncated.archive.subarray(0, truncated.archive.length - 1);
  assert.throws(() => validate(truncated), /image_import_tar_size_invalid/u);
  for (const rawLayer of [
    fixtureLayer((entries) => { entries[1].name = entries[0].name; }),
    fixtureLayer((entries) => { entries[1].name = "../escape"; }),
    fixtureLayer((entries) => { entries[1].type = "1"; }),
  ]) assert.throws(() => validate(savedImage({ rawLayer })), /image_import_tar_(?:name|type)_invalid/u);
  const badOctal = fixtureLayer(); badOctal.fill(0x37, 100, 108); badOctal[107] = 0;
  badOctal.fill(0x20, 148, 156); const sum = badOctal.subarray(0, BLOCK).reduce((total, byte) => total + byte, 0);
  Buffer.from(`${sum.toString(8).padStart(6, "0")}\0 `).copy(badOctal, 148);
  assert.throws(() => validate(savedImage({ rawLayer: badOctal })), /image_import_tar_octal_invalid/u);
});

test("requires two zero end blocks, zero padding, and zero-only outer trailing blocks", () => {
  const missingEnd = buildFixtureTar().subarray(0, buildFixtureTar().length - BLOCK);
  assert.throws(() => validate(savedImage({ rawLayer: missingEnd })), /image_import_tar_eoa_invalid/u);
  const padding = Buffer.from(buildFixtureTar());
  const fileHeaderOffset = BLOCK * 3; const fileSize = fixtureEntries[3].content.length;
  padding[fileHeaderOffset + BLOCK + fileSize] = 1;
  assert.throws(() => validate(savedImage({ rawLayer: padding })), /image_import_tar_padding_invalid/u);
  const valid = savedImage(); valid.archive = Buffer.concat([valid.archive, Buffer.alloc(BLOCK)]);
  assert.doesNotThrow(() => validate(valid));
  const trailing = savedImage(); trailing.archive = Buffer.concat([trailing.archive, Buffer.alloc(BLOCK)]); trailing.archive.at(-1); trailing.archive[trailing.archive.length - 1] = 1;
  assert.throws(() => validate(trailing), /image_import_tar_eoa_invalid/u);
});

test("rejects config, diffID, layer-count, metadata and content drift", () => {
  assert.throws(() => validate(savedImage({ user: "nonempty" })), /image_import_runtime_user_invalid/u);
  assert.throws(() => validate(savedImage({ diffID: `sha256:${"0".repeat(64)}` })), /image_import_save_diffid_invalid/u);
  const twoLayers = savedImage({ manifestLayers: [] });
  assert.throws(() => validate(twoLayers), /image_import_save_oci_invalid/u);
  const metadata = savedImage({ rawLayer: fixtureLayer((entries) => { entries[4].uid = 999; }) });
  assert.throws(() => validate(metadata), /image_import_fixture_inventory_invalid/u);
  const content = savedImage({ rawLayer: fixtureLayer((entries) => { entries[7].content = Buffer.from("changed synthetic bytes\n"); }) });
  assert.throws(() => validate(content), /image_import_fixture_inventory_invalid/u);
});

test("rejects unreferenced blobs, unknown outer members, bad image identity, and malformed gzip", () => {
  const extraBlob = savedImage({ extraEntries: [{ name: `blobs/sha256/${"a".repeat(64)}`, content: Buffer.from("extra") }] });
  assert.throws(() => validate(extraBlob), /image_import_save_blob_invalid/u);
  const unknown = savedImage({ extraEntries: [{ name: "unexpected.txt", content: Buffer.from("extra") }] });
  assert.throws(() => validate(unknown), /image_import_save_member_invalid/u);
  const identity = savedImage(); assert.throws(() => validate(identity, "f".repeat(64)), /image_import_image_id_mismatch/u);
  const wrongMedia = savedImage({ gzip: true, layerMediaType: "application/vnd.oci.image.layer.v1.tar+zstd" });
  assert.throws(() => validate(wrongMedia), /image_import_save_oci_invalid/u);
  const raw = buildFixtureTar(); const concatenated = Buffer.concat([gzipSync(raw), gzipSync(raw)]);
  assert.throws(() => validate(savedImage({ rawLayer: raw, gzip: true, storedLayerOverride: concatenated })), /image_import_save_gzip_invalid/u);
  const tooMany = tar(Array.from({ length: 129 }, (_, index) => ({ name: `file-${index}`, content: Buffer.from("x") })));
  assert.throws(() => validateSavedImage(tooMany, { imageId: `sha256:${"f".repeat(64)}`, tag: TAG, owner: OWNER }), /image_import_tar_member_limit/u);
});
