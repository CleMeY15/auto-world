import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { mergeLayerInventories, scanPinnedBase } from "../scripts/seaweed-image/base-scan.mjs";
import { baseMaterialIdentities } from "../scripts/seaweed-image/plan.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const entry = (path, type = "directory", extra = {}) => ({ path, type, mode: 0o755, uid: 0, gid: 0, mtime: 1,
  size: 0, ...(type === "file" ? { sha256: "b".repeat(64) } : {}), ...extra });
const layer = (entries, compressedDigest = digest) => ({ compressedDigest, members: entries.map((entry, memberOrdinal) =>
  ({ memberOrdinal, uncompressedHeaderOffset: memberOrdinal * 512, uncompressedDataOffset: (memberOrdinal + 1) * 512, entry })) });
const baseMaterials = () => new Map(Object.keys(baseMaterialIdentities).map((name) =>
  [name, readFileSync(path.join(import.meta.dirname, "../infra/seaweed-image", name))]));

test("base overlay preserves exact later same-type metadata and winning raw references", () => {
  const first = layer([entry("usr"), entry("usr/a", "file"), entry("usr/z", "symlink", { linkname: "a", mode: 0o777 })]);
  const second = layer([entry("usr/a", "file", { mtime: 2, mode: 0o4755, uid: 42, gid: 99 })], `sha256:${"c".repeat(64)}`);
  const result = mergeLayerInventories([first, second]);
  assert.deepEqual(result.map(({ entry }) => entry.path), ["usr", "usr/a", "usr/z"]);
  assert.deepEqual(result[1], { layerIndex: 1, compressedDigest: second.compressedDigest,
    memberOrdinal: 0, uncompressedHeaderOffset: 0, uncompressedDataOffset: 512, entry: second.members[0].entry });
  assert.equal(result[2].entry.linkname, "a");
  result[1].entry.uid = 999;
  assert.equal(second.members[0].entry.uid, 42);
});

test("base overlay rejects duplicates, type changes and all non-directory ancestors", () => {
  assert.throws(() => mergeLayerInventories([layer([entry("x"), entry("x")])]), /duplicate_member/u);
  for (const type of ["file", "symlink"]) {
    assert.throws(() => mergeLayerInventories([layer([entry("x")]), layer([entry("x", type)])]), /type_collision/u);
    assert.throws(() => mergeLayerInventories([layer([entry("x", type), entry("x/y")])]), /non_directory_ancestor/u);
    assert.throws(() => mergeLayerInventories([layer([entry("x/y"), entry("x", type)])]), /non_directory_ancestor/u);
  }
  assert.throws(() => mergeLayerInventories([layer([entry("x/y")])]), /missing_directory_ancestor/u);
  assert.equal(mergeLayerInventories([layer([entry("x/y"), entry("x")])]).length, 2);
});

test("base overlay rejects unsafe names, unknown types, malformed layers and cumulative member overflow", () => {
  for (const name of ["/x", "../x", "x/../y", "x//y", "x\\y", "x/", "x/.wh.y", "x/./y", ""]) {
    assert.throws(() => mergeLayerInventories([layer([entry(name)])]), /entry_invalid/u);
  }
  assert.throws(() => mergeLayerInventories([layer([entry("x", "hardlink")])]), /entry_invalid/u);
  assert.throws(() => mergeLayerInventories([layer([], "bad")]), /layer_invalid/u);
  assert.throws(() => mergeLayerInventories(Array(11).fill(layer([]))), /layer_set_invalid/u);
  assert.throws(() => mergeLayerInventories([layer(Array.from({ length: 100_001 }, (_, index) => entry(`p${index}`)))]), /member_limit_exceeded/u);
});

test("base overlay rejects corrupt ordinals, raw offsets and content ranges", () => {
  for (const mutation of [
    (member) => { member.memberOrdinal = 1; },
    (member) => { member.uncompressedHeaderOffset = -512; },
    (member) => { member.uncompressedHeaderOffset = 1; },
    (member) => { member.uncompressedDataOffset = 513; },
    (member) => { member.entry.size = 1; },
  ]) {
    const value = layer([entry("x")]); mutation(value.members[0]);
    assert.throws(() => mergeLayerInventories([value]), /reference_invalid/u);
  }
  const gap = layer([entry("x", "file", { size: 513 }), entry("y")]);
  assert.throws(() => mergeLayerInventories([gap]), /reference_invalid/u);
  gap.members[1].uncompressedHeaderOffset = 1536;
  gap.members[1].uncompressedDataOffset = 2048;
  assert.equal(mergeLayerInventories([gap]).length, 2);
  gap.members[1].memberOrdinal = 0;
  assert.throws(() => mergeLayerInventories([gap]), /reference_invalid/u);
});

test("pinned base authenticates all public metadata before any blob I/O", async () => {
  let calls = 0;
  const openBlob = () => { calls += 1; throw new Error("unexpected I/O"); };
  for (const name of Object.keys(baseMaterialIdentities)) {
    const materials = baseMaterials();
    materials.get(name)[0] ^= 1;
    await assert.rejects(scanPinnedBase({ baseMaterials: materials, openBlob }), /base_material_identity_invalid/u);
  }
  const missing = baseMaterials(); missing.delete("base-config.json");
  await assert.rejects(scanPinnedBase({ baseMaterials: missing, openBlob }), /base_material_set_invalid/u);
  await assert.rejects(scanPinnedBase({ baseMaterials: baseMaterials() }), /opener_invalid/u);
  assert.equal(calls, 0);
});

test("pinned base stops at first invalid blob and closes its stream", async () => {
  const calls = [];
  let input;
  await assert.rejects(scanPinnedBase({ baseMaterials: baseMaterials(), openBlob: (request) => {
    calls.push(request);
    assert(Object.isFrozen(request));
    assert(Object.isFrozen(request.descriptor));
    assert.equal(request.layerIndex, 0);
    assert.equal(request.descriptor.digest, "sha256:55afa1ecc21d2bb5e5045f32dafee56272ffd89860bac26f6c32123439af26a4");
    input = Readable.from([Buffer.from("corrupt public blob")]);
    return input;
  } }));
  assert.equal(calls.length, 1);
  assert.equal(input.destroyed, true);
});

test("pinned base propagates open failure without trying another layer", async () => {
  let calls = 0;
  await assert.rejects(scanPinnedBase({ baseMaterials: baseMaterials(), openBlob: () => {
    calls += 1; throw new Error("owned blob unavailable");
  } }), /owned blob unavailable/u);
  assert.equal(calls, 1);
});
