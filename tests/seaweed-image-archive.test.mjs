import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { buildFixtureTar, fixtureEntries } from "../scripts/image-import-fixture/archive.mjs";
import { scanGzipLayer, scanRawUstar, seaweedArchiveLimits } from "../scripts/seaweed-image/archive.mjs";

const BLOCK = 512;

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(value, "ascii");
  assert.ok(bytes.length <= length);
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  writeString(buffer, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

function checksumHeader(header) {
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
}

function makeHeader({ path, prefix = "", type = "file", content = Buffer.alloc(0), linkname = "", mode = 0o644 } = {}) {
  const header = Buffer.alloc(BLOCK);
  writeString(header, 0, 100, path);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, type === "file" ? content.length : 0);
  writeOctal(header, 136, 12, 1_700_000_000);
  writeString(header, 156, 1, type === "file" ? "0" : type === "directory" ? "5" : type === "symlink" ? "2" : type);
  writeString(header, 157, 100, linkname);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "root");
  writeString(header, 297, 32, "root");
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, prefix);
  checksumHeader(header);
  return header;
}

function makeTar(entries, endBlocks = 2) {
  const parts = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0);
    parts.push(makeHeader({ ...entry, content }));
    if ((entry.type ?? "file") === "file") {
      parts.push(content);
      const padding = (BLOCK - content.length % BLOCK) % BLOCK;
      if (padding > 0) parts.push(Buffer.alloc(padding));
    }
  }
  parts.push(Buffer.alloc(endBlocks * BLOCK));
  return Buffer.concat(parts);
}

function identity(tar, compressed = gzipSync(tar)) {
  return {
    compressed,
    descriptor: { size: compressed.length, digest: `sha256:${hash(compressed)}` },
    diffId: `sha256:${hash(tar)}`,
  };
}

async function scan(tar, { compressed, chunks, ...options } = {}) {
  const values = identity(tar, compressed);
  return scanGzipLayer({
    input: Readable.from(chunks ?? [values.compressed]),
    descriptor: values.descriptor,
    diffId: values.diffId,
    ...options,
  });
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof Error && error.message === code);
}

test("scanGzipLayer streams the existing fixture into closed canonical metadata", async () => {
  const tar = buildFixtureTar();
  const compressed = gzipSync(tar);
  const result = await scan(tar, { chunks: Array.from(compressed, (byte) => Buffer.from([byte])) });
  assert.deepEqual(Object.keys(result), ["compressedSize", "compressedDigest", "uncompressedSize", "diffId", "members"]);
  assert.equal(result.members.length, fixtureEntries.length);
  assert.deepEqual(result.members[0], {
    memberOrdinal: 0,
    uncompressedHeaderOffset: 0,
    uncompressedDataOffset: 512,
    entry: { path: "usr", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 1_700_000_000, size: 0 },
  });
  const file = result.members.find((member) => member.entry.path === "workspace/public.txt");
  assert.deepEqual(Object.keys(file.entry), ["path", "type", "mode", "uid", "gid", "mtime", "size", "sha256"]);
  assert.equal(file.entry.sha256, hash(Buffer.from("public synthetic metadata\n")));
  const link = result.members.find((member) => member.entry.path === "workspace/public-link");
  assert.equal(link.entry.linkname, "public.txt");
});

test("scanRawUstar independently verifies the complete raw archive and its DiffID", async () => {
  const tar = buildFixtureTar();
  const diffId = `sha256:${hash(tar)}`;
  const result = await scanRawUstar({ input: Readable.from([tar]), diffId });
  assert.equal(result.rawSize, tar.length);
  assert.equal(result.diffId, diffId);
  assert.equal(result.members.length, fixtureEntries.length);
  assert.deepEqual(result.members.map(({ entry }) => entry), (await scan(tar)).members.map(({ entry }) => entry));
});

test("scanRawUstar rejects truncation, trailing bytes and a wrong DiffID", async () => {
  const tar = makeTar([{ path: "a", content: Buffer.from("a") }]);
  const diffId = `sha256:${hash(tar)}`;
  await rejectsCode(scanRawUstar({ input: Readable.from([tar.subarray(0, -512)]), diffId }),
    "seaweed_archive_tar_eoa_invalid");
  await rejectsCode(scanRawUstar({ input: Readable.from([Buffer.concat([tar, Buffer.alloc(512)])]), diffId }),
    "seaweed_archive_tar_eoa_invalid");
  await rejectsCode(scanRawUstar({ input: Readable.from([tar]), diffId: `sha256:${"0".repeat(64)}` }),
    "seaweed_archive_diffid_mismatch");
});

test("scanRawUstar aborts an input without returning an inventory", async () => {
  const tar = makeTar([{ path: "a", content: Buffer.from("a") }]);
  const controller = new globalThis.AbortController();
  controller.abort();
  await rejectsCode(scanRawUstar({ input: Readable.from([tar]), diffId: `sha256:${hash(tar)}`, signal: controller.signal }),
    "seaweed_archive_stream_invalid");
});

test("scanGzipLayer accepts one TAR stream split over concatenated gzip members", async () => {
  const tar = makeTar([{ path: "deep.txt", content: Buffer.from("split gzip") }]);
  const split = 600;
  const compressed = Buffer.concat([gzipSync(tar.subarray(0, split)), gzipSync(tar.subarray(split))]);
  const result = await scan(tar, { compressed });
  assert.equal(result.members[0].entry.sha256, hash(Buffer.from("split gzip")));
});

test("scanGzipLayer supports USTAR prefixes and special mode bits", async () => {
  const tar = makeTar([{ path: "tool", prefix: "usr/local/bin", content: Buffer.from("x"), mode: 0o4755 }]);
  const result = await scan(tar);
  assert.equal(result.members[0].entry.path, "usr/local/bin/tool");
  assert.equal(result.members[0].entry.mode, 0o4755);
});

test("scanGzipLayer permits symlink traversal only while resolution remains in the container root", async () => {
  const valid = makeTar([
    { path: "usr/lib/tool", type: "symlink", linkname: "../bin/tool" },
    { path: "absolute", type: "symlink", linkname: "/usr/bin/tool" },
  ]);
  assert.equal((await scan(valid)).members.length, 2);
  const invalid = makeTar([{ path: "usr/link", type: "symlink", linkname: "../../escape" }]);
  await rejectsCode(scan(invalid), "seaweed_archive_tar_link_invalid");
});

test("scanGzipLayer authenticates compressed and raw identities", async () => {
  const tar = makeTar([{ path: "a", content: Buffer.from("a") }]);
  const values = identity(tar);
  await rejectsCode(scanGzipLayer({
    input: Readable.from([values.compressed]),
    descriptor: { ...values.descriptor, digest: `sha256:${"0".repeat(64)}` },
    diffId: values.diffId,
  }), "seaweed_archive_compressed_identity_invalid");
  await rejectsCode(scanGzipLayer({
    input: Readable.from([values.compressed]), descriptor: values.descriptor, diffId: `sha256:${"0".repeat(64)}`,
  }), "seaweed_archive_diffid_mismatch");

  const mutableDescriptor = { ...values.descriptor };
  const mutatingInput = new Readable({
    read() {
      mutableDescriptor.size = 1;
      mutableDescriptor.digest = `sha256:${"f".repeat(64)}`;
      this.push(values.compressed);
      this.push(null);
    },
  });
  const result = await scanGzipLayer({ input: mutatingInput, descriptor: mutableDescriptor, diffId: values.diffId });
  assert.equal(result.compressedSize, values.compressed.length);
});

test("scanGzipLayer rejects malformed gzip framing and ignored compressed trailing zeros", async () => {
  const tar = makeTar([{ path: "a", content: Buffer.from("a") }]);
  const valid = gzipSync(tar);
  const crcBroken = Buffer.from(valid);
  crcBroken[crcBroken.length - 8] ^= 1;
  await rejectsCode(scan(tar, { compressed: crcBroken }), "seaweed_archive_stream_invalid");
  await rejectsCode(scan(tar, { compressed: valid.subarray(0, valid.length - 3) }), "seaweed_archive_stream_invalid");
  await rejectsCode(scan(tar, { compressed: Buffer.concat([valid, Buffer.alloc(8)]) }), "seaweed_archive_gzip_trailing_data");
});

test("scanGzipLayer rejects a second TAR archive and all raw bytes after the exact two EOA blocks", async () => {
  const first = makeTar([{ path: "first", content: Buffer.from("1") }]);
  const second = makeTar([{ path: "second", content: Buffer.from("2") }]);
  await rejectsCode(scan(Buffer.concat([first, second]), {
    compressed: Buffer.concat([gzipSync(first), gzipSync(second)]),
  }), "seaweed_archive_tar_eoa_invalid");
  const extraZero = Buffer.concat([first, Buffer.alloc(BLOCK)]);
  await rejectsCode(scan(extraZero), "seaweed_archive_tar_eoa_invalid");
});

test("scanGzipLayer enforces raw, member, compressed and input chunk bounds", async () => {
  const tar = makeTar([{ path: "a", content: Buffer.from("a") }, { path: "b", content: Buffer.from("b") }]);
  await rejectsCode(scan(tar, { maxRawBytes: tar.length - 1 }), "seaweed_archive_raw_limit");
  await rejectsCode(scan(tar, { maxMembers: 1 }), "seaweed_archive_tar_member_limit");
  const oversized = Buffer.alloc(seaweedArchiveLimits.inputChunkBytes + 1);
  await rejectsCode(scanGzipLayer({
    input: Readable.from([oversized]),
    descriptor: { size: oversized.length, digest: `sha256:${hash(oversized)}` },
    diffId: `sha256:${"0".repeat(64)}`,
  }), "seaweed_archive_input_chunk_invalid");
  await rejectsCode(scanGzipLayer({
    input: Readable.from([Buffer.alloc(2)]),
    descriptor: { size: 1, digest: `sha256:${"0".repeat(64)}` },
    diffId: `sha256:${"0".repeat(64)}`,
  }), "seaweed_archive_compressed_limit");
});

test("scanGzipLayer rejects invalid descriptors and caller limits before reading", async () => {
  const invalidInput = Readable.from([Buffer.from("unused")]);
  await rejectsCode(scanGzipLayer({ input: invalidInput, descriptor: { size: 1 }, diffId: `sha256:${"0".repeat(64)}` }), "seaweed_archive_descriptor_invalid");
  assert.equal(invalidInput.destroyed, true);
  const invalid = () => Readable.from([Buffer.from("unused")]);
  await rejectsCode(scanGzipLayer({
    input: invalid(), descriptor: { size: 1, digest: `sha256:${"0".repeat(64)}`, extra: true }, diffId: `sha256:${"0".repeat(64)}`,
  }), "seaweed_archive_descriptor_invalid");
  await rejectsCode(scanGzipLayer({
    input: invalid(), descriptor: { size: 1, digest: `sha256:${"0".repeat(64)}` }, diffId: "bad",
  }), "seaweed_archive_diffid_invalid");
  await rejectsCode(scanGzipLayer({
    input: invalid(), descriptor: { size: 1, digest: `sha256:${"0".repeat(64)}` }, diffId: `sha256:${"0".repeat(64)}`, maxMembers: 0,
  }), "seaweed_archive_limit_invalid");
});

test("scanGzipLayer rejects invalid TAR checksum, type, padding and truncation", async () => {
  const original = makeTar([{ path: "file", content: Buffer.from("x") }]);
  const checksum = Buffer.from(original); checksum[0] ^= 1;
  await rejectsCode(scan(checksum), "seaweed_archive_tar_checksum_invalid");
  const type = Buffer.from(original); type[156] = "1".charCodeAt(0); checksumHeader(type.subarray(0, BLOCK));
  await rejectsCode(scan(type), "seaweed_archive_tar_type_invalid");
  const padding = Buffer.from(original); padding[BLOCK + 1] = 1;
  await rejectsCode(scan(padding), "seaweed_archive_tar_padding_invalid");
  const truncated = original.subarray(0, original.length - 1);
  await rejectsCode(scan(truncated), "seaweed_archive_tar_truncated");
});

test("scanGzipLayer rejects unsafe, duplicate and hidden TAR names", async () => {
  for (const path of ["/absolute", "a//b", "a/../b", "a\\b", ".wh.deleted"]) {
    await rejectsCode(scan(makeTar([{ path }])), "seaweed_archive_tar_path_invalid");
  }
  await rejectsCode(scan(makeTar([{ path: "same" }, { path: "same" }])), "seaweed_archive_tar_duplicate_invalid");
  const hidden = makeTar([{ path: "short" }]);
  hidden[10] = "x".charCodeAt(0); checksumHeader(hidden.subarray(0, BLOCK));
  await rejectsCode(scan(hidden), "seaweed_archive_tar_header_invalid");
});

test("scanGzipLayer rejects base-256 and malformed octal plus nonzero device and unused fields", async () => {
  const tar = makeTar([{ path: "a" }]);
  const mutations = [
    (value) => { value[100] = 0x80; },
    (value) => { value[101] = 0xb1; },
    (value) => { value[100] = "8".charCodeAt(0); },
    (value) => { writeOctal(value, 329, 8, 1); },
    (value) => { value[500] = 1; },
  ];
  for (const mutate of mutations) {
    const value = Buffer.from(tar); mutate(value); checksumHeader(value.subarray(0, BLOCK));
    await assert.rejects(scan(value), (error) => error instanceof Error && error.message.startsWith("seaweed_archive_tar_"));
  }
});

test("scanGzipLayer requires exactly two aligned EOA blocks", async () => {
  await rejectsCode(scan(makeTar([{ path: "a" }], 1)), "seaweed_archive_tar_eoa_invalid");
  const noEnd = makeTar([{ path: "a", content: Buffer.from("x") }], 0);
  await rejectsCode(scan(noEnd), "seaweed_archive_tar_eoa_invalid");
});

test("scanGzipLayer destroys and awaits the caller stream after success and failure", async () => {
  const tar = makeTar([{ path: "a" }]);
  const values = identity(tar);
  const successInput = Readable.from([values.compressed]);
  await scanGzipLayer({ input: successInput, descriptor: values.descriptor, diffId: values.diffId });
  assert.equal(successInput.destroyed, true);

  const failureInput = new Readable({
    read() { this.destroy(new Error("source failed")); },
  });
  await rejectsCode(scanGzipLayer({ input: failureInput, descriptor: values.descriptor, diffId: values.diffId }), "seaweed_archive_stream_invalid");
  assert.equal(failureInput.destroyed, true);
});
