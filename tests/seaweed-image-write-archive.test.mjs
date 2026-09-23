import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { scanGzipLayer, seaweedArchiveLimits } from "../scripts/seaweed-image/archive.mjs";
import { writeUstarArchive } from "../scripts/seaweed-image/write-archive.mjs";

const BLOCK = 512;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const file = (path, content, overrides = {}) => ({
  path, type: "file", mode: 0o644, uid: 1, gid: 2, mtime: 1_700_000_000,
  size: content.length, sha256: sha(content), ...overrides,
});
const directory = (path, overrides = {}) => ({
  path, type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 1_700_000_000, size: 0, ...overrides,
});
const symlink = (path, linkname, overrides = {}) => ({
  path, type: "symlink", mode: 0o777, uid: 0, gid: 0, mtime: 1_700_000_000, size: 0, linkname, ...overrides,
});
const byteStream = (chunks) => Readable.from(chunks, { objectMode: false });

function collector({ delay = 0, failAfter } = {}) {
  const chunks = [];
  let bytes = 0;
  const sink = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (failAfter !== undefined && bytes > failAfter) {
        callback(new Error("synthetic sink failure"));
        return;
      }
      chunks.push(Buffer.from(chunk));
      if (delay > 0) setTimeout(callback, delay);
      else callback();
    },
  });
  return { sink, bytes: () => bytes, output: () => Buffer.concat(chunks) };
}

function opener(contents, { chunks = 1, calls = [] } = {}) {
  return (entry) => {
    calls.push(entry);
    const content = contents.get(entry.path);
    assert.ok(Buffer.isBuffer(content));
    const values = [];
    for (let offset = 0; offset < content.length; offset += chunks) values.push(content.subarray(offset, offset + chunks));
    return byteStream(values);
  };
}

async function write(entries, contents = new Map(), options = {}) {
  const target = collector(options.sink);
  const receipt = await writeUstarArchive({ entries, sink: target.sink, openContent: opener(contents, options.open), signal: options.signal });
  return { receipt, tar: target.output(), target };
}

function parseString(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString("ascii");
}

function parseOctal(block, offset, length) {
  return Number.parseInt(parseString(block, offset, length).trim(), 8);
}

function independentlyInspect(tar, expectedEntries) {
  let offset = 0;
  const seen = [];
  for (const expected of expectedEntries) {
    const header = tar.subarray(offset, offset + BLOCK);
    assert.equal(header.length, BLOCK);
    assert.equal(header.subarray(257, 263).toString("latin1"), "ustar\0");
    assert.equal(header.subarray(263, 265).toString("ascii"), "00");
    assert.ok(header.subarray(265, 329).every((byte) => byte === 0));
    assert.equal(parseOctal(header, 329, 8), 0);
    assert.equal(parseOctal(header, 337, 8), 0);
    assert.ok(header.subarray(500).every((byte) => byte === 0));
    const checksumBytes = Buffer.from(header);
    checksumBytes.fill(0x20, 148, 156);
    assert.equal(parseOctal(header, 148, 8), checksumBytes.reduce((sum, byte) => sum + byte, 0));
    const name = parseString(header, 0, 100);
    const prefix = parseString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    assert.equal(path, expected.path);
    assert.equal(String.fromCharCode(header[156]), expected.type === "file" ? "0" : expected.type === "directory" ? "5" : "2");
    assert.equal(parseOctal(header, 100, 8), expected.mode);
    assert.equal(parseOctal(header, 108, 8), expected.uid);
    assert.equal(parseOctal(header, 116, 8), expected.gid);
    assert.equal(parseOctal(header, 124, 12), expected.size);
    assert.equal(parseOctal(header, 136, 12), expected.mtime);
    assert.equal(parseString(header, 157, 100), expected.type === "symlink" ? expected.linkname : "");
    offset += BLOCK;
    if (expected.type === "file") {
      const body = tar.subarray(offset, offset + expected.size);
      assert.equal(sha(body), expected.sha256);
      offset += expected.size;
      const padding = (BLOCK - expected.size % BLOCK) % BLOCK;
      assert.ok(tar.subarray(offset, offset + padding).every((byte) => byte === 0));
      offset += padding;
    }
    seen.push(path);
  }
  assert.equal(tar.length, offset + 2 * BLOCK);
  assert.ok(tar.subarray(offset).every((byte) => byte === 0));
  return seen;
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.message, code);
    assert.equal(error.state, "INCOMPLETE");
    assert.ok(Number.isSafeInteger(error.generatedBytes));
    return true;
  });
}

test("writes deterministic USTAR metadata, offsets, hashes and exact EOA in caller order", async () => {
  const alpha = Buffer.from("alpha\n");
  const beta = Buffer.alloc(700, 0x62);
  const entries = [directory("z"), file("z/beta", beta, { mode: 0o4755, uid: 12, gid: 34 }), symlink("a-link", "/z/beta"), file("alpha", alpha)];
  const contents = new Map([["z/beta", beta], ["alpha", alpha]]);
  const first = await write(entries, contents, { open: { chunks: 7 }, sink: { delay: 1 } });
  const second = await write(entries, contents, { open: { chunks: 509 } });
  assert.deepEqual(first.tar, second.tar);
  assert.deepEqual(independentlyInspect(first.tar, entries), entries.map((entry) => entry.path));
  assert.equal(first.receipt.kind, "SEAWEED_USTAR_WRITE_RECEIPT_V1");
  assert.equal(first.receipt.authority, "PREPARATION_ONLY");
  assert.equal(first.receipt.state, "COMPLETE");
  assert.equal(first.receipt.rawSize, first.tar.length);
  assert.equal(first.receipt.expectedRawSize, first.tar.length);
  assert.equal(first.receipt.diffId, `sha256:${sha(first.tar)}`);
  assert.equal(first.receipt.memberCount, entries.length);
  assert.deepEqual(first.receipt.members.map((member) => member.entry), entries);
  assert.deepEqual(first.receipt.members.map((member) => member.uncompressedHeaderOffset), [0, 512, 2048, 2560]);
  assert.deepEqual(first.receipt.members.map((member) => member.uncompressedDataOffset), [512, 1024, 2560, 3072]);
});

test("round trips a long notice path through gzip and the existing strict reader", async () => {
  const content = Buffer.from("synthetic notice\n");
  const longPath = `${"usr/share/auto-world/seaweedfs/modules/"}${"a".repeat(64)}/notice-001.txt`;
  const entries = [directory("usr/share/auto-world/seaweedfs/modules"), file(longPath, content)];
  const result = await write(entries, new Map([[longPath, content]]));
  const compressed = gzipSync(result.tar);
  const scanned = await scanGzipLayer({
    input: byteStream([compressed]),
    descriptor: { size: compressed.length, digest: `sha256:${sha(compressed)}` },
    diffId: result.receipt.diffId,
  });
  assert.deepEqual(scanned.members, result.receipt.members);
});

test("uses the rightmost valid USTAR split and rejects unrepresentable names before I/O", async () => {
  const valid100 = "a".repeat(100);
  const valid255 = `${"p".repeat(154)}/${"n".repeat(100)}`;
  const valid256 = `${"p".repeat(155)}/${"n".repeat(100)}`;
  const empty = Buffer.alloc(0);
  const result = await write([file(valid100, empty), file(valid255, empty), file(valid256, empty)],
    new Map([[valid100, empty], [valid255, empty], [valid256, empty]]));
  assert.deepEqual(independentlyInspect(result.tar, result.receipt.members.map(({ entry }) => entry)), [valid100, valid255, valid256]);

  for (const path of ["a".repeat(101), `${"p".repeat(156)}/${"n".repeat(100)}`, `${"p".repeat(155)}/${"n".repeat(101)}`]) {
    const target = collector();
    let opens = 0;
    await rejectsCode(writeUstarArchive({ entries: [file(path, empty)], sink: target.sink, openContent: () => { opens += 1; return byteStream([]); } }),
      "seaweed_ustar_path_unrepresentable");
    assert.equal(target.output().length, 0);
    assert.equal(opens, 0);
  }
});

test("preserves entry order and changes bytes for a caller permutation", async () => {
  const empty = Buffer.alloc(0);
  const a = file("a", empty);
  const b = file("b", empty);
  const contents = new Map([["a", empty], ["b", empty]]);
  const forward = await write([a, b], contents);
  const reverse = await write([b, a], contents);
  assert.notEqual(forward.receipt.diffId, reverse.receipt.diffId);
  assert.deepEqual(forward.receipt.members.map(({ entry }) => entry.path), ["a", "b"]);
  assert.deepEqual(reverse.receipt.members.map(({ entry }) => entry.path), ["b", "a"]);
});

test("preflights every entry, duplicate, whiteout and explicit ancestor before writes or opens", async () => {
  const empty = Buffer.alloc(0);
  const cases = [
    [[file("ok", empty), { ...file("late", empty), extra: true }], "seaweed_ustar_entry_invalid"],
    [[file("same", empty), directory("same")], "seaweed_ustar_duplicate_path"],
    [[file(".wh.deleted", empty)], "seaweed_ustar_entry_invalid"],
    [[file("parent", empty), file("parent/child", empty)], "seaweed_ustar_ancestor_invalid"],
    [[symlink("parent", "/target"), file("parent/child", empty)], "seaweed_ustar_ancestor_invalid"],
    [[symlink("unsafe", "../escape")], "seaweed_ustar_entry_invalid"],
    [[file("bad-mode", empty, { mode: 0o10000 })], "seaweed_ustar_entry_invalid"],
    [[file("bad-uid", empty, { uid: 0o10000000 })], "seaweed_ustar_entry_invalid"],
    [[file("bad-gid", empty, { gid: 0o10000000 })], "seaweed_ustar_entry_invalid"],
    [[file("bad-mtime", empty, { mtime: 0o100000000000 })], "seaweed_ustar_entry_invalid"],
    [[file("too-large", empty, { size: seaweedArchiveLimits.rawBytes })], "seaweed_ustar_raw_limit"],
  ];
  for (const [entries, code] of cases) {
    const target = collector();
    let opens = 0;
    await rejectsCode(writeUstarArchive({ entries, sink: target.sink, openContent: () => { opens += 1; return byteStream([]); } }), code);
    assert.equal(target.output().length, 0);
    assert.equal(opens, 0);
  }
  await write([file("missing/parents/allowed", empty)], new Map([["missing/parents/allowed", empty]]));
});

test("passes a frozen cloned descriptor to a synchronous opener", async () => {
  const content = Buffer.from("immutable");
  const original = file("immutable", content);
  const target = collector();
  let observed;
  const receipt = await writeUstarArchive({
    entries: [original], sink: target.sink,
    openContent(entry, context) {
      observed = entry;
      original.path = "mutated";
      assert.equal(Object.isFrozen(entry), true);
      assert.notEqual(entry, original);
      assert.equal(Object.isFrozen(context), true);
      assert.equal(typeof context.signal.addEventListener, "function");
      return byteStream([content]);
    },
  });
  assert.equal(observed.path, "immutable");
  assert.equal(receipt.members[0].entry.path, "immutable");

  const asyncTarget = collector();
  await rejectsCode(writeUstarArchive({ entries: [file("x", Buffer.alloc(0))], sink: asyncTarget.sink, openContent: async () => byteStream([]) }),
    "seaweed_ustar_content_opener_async");
  assert.equal(asyncTarget.output().length, 0);
  const rejectedTarget = collector();
  await rejectsCode(writeUstarArchive({
    entries: [file("x", Buffer.alloc(0))], sink: rejectedTarget.sink,
    openContent: async () => { throw new Error("rejected opener"); },
  }), "seaweed_ustar_content_opener_async");
  assert.equal(rejectedTarget.output().length, 0);
});

test("rejects short, extra, wrong-hash, object and oversized content chunks", async () => {
  const expected = Buffer.from("expected");
  const variants = [
    [byteStream([expected.subarray(0, 2)]), "seaweed_ustar_content_size_mismatch"],
    [byteStream([Buffer.concat([expected, Buffer.from("x")])]), "seaweed_ustar_content_size_mismatch"],
    [byteStream([Buffer.alloc(expected.length)]), "seaweed_ustar_content_hash_mismatch"],
    [Readable.from([{ bad: true }]), "seaweed_ustar_content_invalid"],
    [byteStream([Buffer.alloc(seaweedArchiveLimits.inputChunkBytes + 1)]), "seaweed_ustar_content_chunk_invalid"],
  ];
  for (const [source, code] of variants) {
    const target = collector();
    await rejectsCode(writeUstarArchive({ entries: [file("x", expected)], sink: target.sink, openContent: () => source }), code);
    assert.equal(source.destroyed, true);
  }
});

test("stops after source or sink failure, cleans the active source and never opens a later file", async () => {
  const content = Buffer.from("content");
  for (const scenario of ["source", "sink"]) {
    const calls = [];
    let active;
    const target = collector(scenario === "sink" ? { failAfter: 512 } : {});
    const promise = writeUstarArchive({
      entries: [file("first", content), file("second", content)], sink: target.sink,
      openContent(entry) {
        calls.push(entry.path);
        active = scenario === "source"
          ? new Readable({ read() { this.destroy(new Error("synthetic source failure")); } })
          : byteStream([content]);
        return active;
      },
    });
    await rejectsCode(promise, scenario === "source" ? "seaweed_ustar_content_stream_invalid" : "seaweed_ustar_stream_invalid");
    assert.deepEqual(calls, ["first"]);
    assert.equal(active.destroyed, true);
  }
});

test("honors sink backpressure before opening the next file", async () => {
  const empty = Buffer.alloc(0);
  const calls = [];
  const chunks = [];
  let releaseWrite;
  let firstWriteStarted;
  const writeStarted = new Promise((resolve) => { firstWriteStarted = resolve; });
  const sink = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      if (releaseWrite === undefined) {
        releaseWrite = callback;
        firstWriteStarted();
      } else {
        callback();
      }
    },
  });
  let settled = false;
  const output = writeUstarArchive({
    entries: [file("first", empty), file("second", empty)], sink,
    openContent: opener(new Map([["first", empty], ["second", empty]]), { calls }),
  });
  output.then(() => { settled = true; }, () => { settled = true; });
  await writeStarted;
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(settled, false);
  assert.deepEqual(calls.map(({ path }) => path), ["first"]);
  releaseWrite();
  const receipt = await output;
  assert.equal(receipt.state, "COMPLETE");
  assert.deepEqual(calls.map(({ path }) => path), ["first", "second"]);
  assert.equal(Buffer.concat(chunks).length, receipt.rawSize);
});

test("waits for an active source delayed destroy callback before rejecting", async () => {
  const expected = Buffer.from("expected");
  let releaseDestroy;
  let markDestroyStarted;
  const destroyStarted = new Promise((resolve) => { markDestroyStarted = resolve; });
  const sourceFailure = new Error("synthetic delayed source failure");
  const source = new Readable({
    read() { this.destroy(sourceFailure); },
    destroy(error, callback) {
      releaseDestroy = () => { callback(error); };
      markDestroyStarted();
    },
  });
  const target = collector();
  let settled = false;
  const output = writeUstarArchive({ entries: [file("first", expected)], sink: target.sink, openContent: () => source });
  output.then(() => { settled = true; }, () => { settled = true; });
  await destroyStarted;
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(settled, false);
  assert.equal(source.destroyed, true);
  releaseDestroy();
  await rejectsCode(output, "seaweed_ustar_content_stream_invalid");
});

test("reports zero generated bytes for late preflight failure and positive bytes after a content failure", async () => {
  const valid = Buffer.from("valid");
  const preflightTarget = collector();
  await assert.rejects(writeUstarArchive({
    entries: [file("valid", valid), { ...file("late", valid), extra: true }], sink: preflightTarget.sink,
    openContent: opener(new Map([["valid", valid], ["late", valid]])),
  }), (error) => {
    assert.equal(error.message, "seaweed_ustar_entry_invalid");
    assert.equal(error.state, "INCOMPLETE");
    assert.equal(error.generatedBytes, 0);
    return true;
  });
  assert.equal(preflightTarget.output().length, 0);

  const contentTarget = collector();
  await assert.rejects(writeUstarArchive({
    entries: [file("short", valid)], sink: contentTarget.sink,
    openContent: () => byteStream([valid.subarray(0, 1)]),
  }), (error) => {
    assert.equal(error.message, "seaweed_ustar_content_size_mismatch");
    assert.equal(error.state, "INCOMPLETE");
    assert.ok(error.generatedBytes > 0);
    return true;
  });
});

test("abort interrupts an active content stream, cleans it and does not open subsequent members", async () => {
  const controller = new globalThis.AbortController();
  const calls = [];
  let active;
  const target = collector({ delay: 1 });
  const promise = writeUstarArchive({
    entries: [file("first", Buffer.alloc(8)), file("second", Buffer.alloc(0))], sink: target.sink, signal: controller.signal,
    openContent(entry) {
      calls.push(entry.path);
      active = new Readable({
        read() {
          this.push(Buffer.alloc(1));
          controller.abort();
        },
      });
      return active;
    },
  });
  await rejectsCode(promise, "seaweed_ustar_aborted");
  assert.deepEqual(calls, ["first"]);
  assert.equal(active.destroyed, true);
});

test("a pre-aborted signal writes nothing and never calls the opener", async () => {
  const controller = new globalThis.AbortController();
  controller.abort();
  const target = collector();
  let opens = 0;
  await rejectsCode(writeUstarArchive({
    entries: [file("never", Buffer.alloc(0))], sink: target.sink, signal: controller.signal,
    openContent() { opens += 1; return byteStream([]); },
  }), "seaweed_ustar_aborted");
  assert.equal(opens, 0);
  assert.equal(target.output().length, 0);
});

test("validates global bounds and public arguments before output", async () => {
  const target = collector();
  await rejectsCode(writeUstarArchive({ entries: new Array(seaweedArchiveLimits.members + 1), sink: target.sink, openContent() {} }),
    "seaweed_ustar_entries_invalid");
  await rejectsCode(writeUstarArchive({ entries: [], sink: {}, openContent() {} }), "seaweed_ustar_sink_invalid");
  await rejectsCode(writeUstarArchive({ entries: [], sink: collector().sink }), "seaweed_ustar_content_opener_invalid");
  await rejectsCode(writeUstarArchive({ entries: [], sink: collector().sink, openContent() {}, signal: {} }), "seaweed_ustar_signal_invalid");
  assert.equal(target.output().length, 0);
});
