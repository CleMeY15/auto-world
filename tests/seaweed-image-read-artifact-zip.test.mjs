import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { chmod, link, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { crc32, deflateRawSync } from "node:zlib";

import {
  githubArtifactZipProfiles, scanGitHubArtifactZip, scanOwnedGitHubArtifactZip,
} from "../scripts/seaweed-image/read-artifact-zip.mjs";

const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function zip(entries, overrides = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [ordinal, candidate] of entries.entries()) {
    const name = Buffer.from(candidate.path, "ascii");
    const raw = Buffer.from(candidate.content);
    const method = candidate.method ?? 0;
    const encoded = method === 8 ? deflateRawSync(raw) : raw;
    const compressed = candidate.compressedSuffix === undefined ? encoded : Buffer.concat([encoded, candidate.compressedSuffix]);
    const checksum = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0008, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x1234, 10);
    local.writeUInt16LE(0x5678, 12);
    local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeUInt32LE(compressed.length, 8);
    descriptor.writeUInt32LE(raw.length, 12);
    locals.push(local, name, compressed, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x032d, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0008, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0x1234, 12);
    central.writeUInt16LE(0x5678, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((candidate.mode ?? 0o100644) * 65_536 + 0x20, 38);
    central.writeUInt32LE(offset, 42);
    if (overrides.central && overrides.central.ordinal === ordinal) overrides.central.mutate(central);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length + descriptor.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

function source(bytes, hook) {
  return {
    size: bytes.length,
    readAt(position, length) {
      const value = bytes.subarray(position, position + length);
      return hook?.(position, length, value) ?? value;
    },
  };
}

function sinks(outputs, options = {}) {
  return (entry) => {
    options.calls?.push(entry);
    const chunks = [];
    const sink = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        if (options.fail) return callback(new Error("sink failed"));
        chunks.push(Buffer.from(chunk));
        if (options.delay) setTimeout(callback, options.delay);
        else callback();
      },
      final(callback) {
        outputs.set(entry.path, Buffer.concat(chunks));
        callback();
      },
    });
    return sink;
  };
}

async function scan(bytes, profile, openEntrySink, extra = {}) {
  return scanGitHubArtifactZip({
    source: extra.source ?? source(bytes), descriptor: { size: bytes.length, digest: sha(bytes) },
    profile, openEntrySink, signal: extra.signal,
  });
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.message, code);
    assert.equal(error.state, "INCOMPLETE");
    assert.ok(Number.isSafeInteger(error.entriesProcessed));
    assert.ok(Number.isSafeInteger(error.verifiedBytes));
    return true;
  });
}

test("prehashes, preflights and streams a stored build artifact with frozen provisional metadata", async () => {
  const bytes = zip([{ path: "weed", content: Buffer.from("binary"), method: 0, mode: 0o100755 }]);
  const outputs = new Map();
  const calls = [];
  const receipt = await scan(bytes, githubArtifactZipProfiles.build, (entry, context) => {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(context));
    assert.equal(context.integrity, "PROVISIONAL");
    return sinks(outputs, { calls })(entry);
  });
  assert.equal(receipt.kind, "GITHUB_ARTIFACT_ZIP_SCAN_RECEIPT_V1");
  assert.equal(receipt.authority, "PREPARATION_ONLY");
  assert.equal(receipt.state, "COMPLETE");
  assert.equal(receipt.zipDigest, sha(bytes));
  assert.equal(receipt.entryCount, 1);
  assert.equal(receipt.entries[0].sha256, sha(Buffer.from("binary")).slice(7));
  assert.deepEqual(outputs.get("weed"), Buffer.from("binary"));
  assert.equal(calls.length, 1);
});

test("streams the exact deflated gate and comparison profiles", async () => {
  for (const [profile, name] of [
    [githubArtifactZipProfiles.gate1, "seaweed-artifact-gate-1.json"],
    [githubArtifactZipProfiles.gate2, "seaweed-artifact-gate-2.json"],
    [githubArtifactZipProfiles.comparison, "seaweed-comparison.json"],
  ]) {
    const content = Buffer.from('{"result":"PASSED"}\n');
    const bytes = zip([{ path: name, content, method: 8, mode: 0o100644 }]);
    const outputs = new Map();
    const receipt = await scan(bytes, profile, sinks(outputs, { delay: 1 }));
    assert.deepEqual(outputs.get(name), content);
    assert.equal(receipt.entries[0].method, 8);
  }
});

test("rejects traversal, duplicates, wrong profile method and non-allowlisted build paths before opening sinks", async () => {
  const cases = [
    [zip([{ path: "../weed", content: "x" }]), githubArtifactZipProfiles.build, "seaweed_artifact_zip_path_invalid"],
    [zip([{ path: "weed", content: "x" }, { path: "weed", content: "y" }]), githubArtifactZipProfiles.build, "seaweed_artifact_zip_path_invalid"],
    [zip([{ path: "weed", content: "x", method: 8 }]), githubArtifactZipProfiles.build, "seaweed_artifact_zip_profile_invalid"],
    [zip([{ path: "secret", content: "x" }]), githubArtifactZipProfiles.build, "seaweed_artifact_zip_profile_invalid"],
  ];
  for (const [bytes, profile, code] of cases) {
    let calls = 0;
    await rejectsCode(scan(bytes, profile, () => { calls += 1; return new Writable(); }), code);
    assert.equal(calls, 0);
  }
});

test("enforces observed modes, ZIP32 sentinels and raw limits before opening sinks", async () => {
  const modulePath = `materials/modules/${"a".repeat(64)}/source.zip`;
  const valid = zip([
    { path: "weed", content: "x", mode: 0o100755 },
    { path: modulePath, content: "module", mode: 0o100600 },
    { path: "go-build-info.txt", content: "info", mode: 0o100644 },
  ]);
  assert.equal((await scan(valid, githubArtifactZipProfiles.build, sinks(new Map()))).entryCount, 3);

  const wrongMode = zip([{ path: "weed", content: "x", mode: 0o100644 }]);
  const zip64 = zip([{ path: "weed", content: "x", mode: 0o100755 }], {
    central: { ordinal: 0, mutate: (header) => header.writeUInt32LE(0xffff_ffff, 20) },
  });
  const oversized = zip([{ path: "weed", content: "x", mode: 0o100755 }], {
    central: { ordinal: 0, mutate: (header) => header.writeUInt32LE(2 * 1024 ** 3 + 1, 24) },
  });
  for (const bytes of [wrongMode, zip64, oversized]) {
    let calls = 0;
    await assert.rejects(scan(bytes, githubArtifactZipProfiles.build, () => { calls += 1; return new Writable(); }), /seaweed_artifact_zip_/u);
    assert.equal(calls, 0);
  }
});

test("rejects central tampering, truncation, trailing bytes, bad descriptors and CRC before success", async () => {
  const original = zip([{ path: "weed", content: "payload", mode: 0o100755 }]);
  const variants = [];
  variants.push(Buffer.concat([original, Buffer.from([0])]));
  variants.push(original.subarray(0, original.length - 1));
  const descriptorBad = Buffer.from(original);
  const descriptorAt = 30 + 4 + 7;
  descriptorBad.writeUInt32LE(0, descriptorAt + 4);
  variants.push(descriptorBad);
  const centralBad = Buffer.from(original);
  const centralAt = descriptorAt + 16;
  centralBad.writeUInt32LE(0, centralAt + 16);
  variants.push(centralBad);
  for (const bytes of variants) {
    await assert.rejects(scan(bytes, githubArtifactZipProfiles.build, sinks(new Map())), /seaweed_artifact_zip_/u);
  }
});

test("treats sink bytes as provisional, stops after integrity failure and rejects deflate tails", async () => {
  const bytes = zip([
    { path: "weed", content: "payload", mode: 0o100755 },
    { path: "go-build-info.txt", content: "later", mode: 0o100644 },
  ]);
  const corrupt = Buffer.from(bytes);
  corrupt[30 + Buffer.byteLength("weed") + 2] ^= 1;
  const opened = [];
  const outputs = new Map();
  await rejectsCode(scan(corrupt, githubArtifactZipProfiles.build, (entry) => {
    opened.push(entry.path);
    return sinks(outputs)(entry);
  }), "seaweed_artifact_zip_entry_integrity_invalid");
  assert.deepEqual(opened, ["weed"]);
  assert.equal(outputs.has("weed"), true);
  assert.equal(outputs.has("go-build-info.txt"), false);

  const tail = zip([{
    path: "seaweed-comparison.json", content: "{}\n", method: 8, mode: 0o100644, compressedSuffix: Buffer.from([0]),
  }]);
  await rejectsCode(scan(tail, githubArtifactZipProfiles.comparison, sinks(new Map())), "seaweed_artifact_zip_deflate_trailing_data");
});

test("rejects JSON expansion bounds before sinks and aborts after the final identity read", async () => {
  const oversized = zip([{ path: "seaweed-comparison.json", content: "{}", method: 8 }], {
    central: { ordinal: 0, mutate: (header) => header.writeUInt32LE(1024 ** 2 + 1, 24) },
  });
  let opens = 0;
  await rejectsCode(scan(oversized, githubArtifactZipProfiles.comparison, () => { opens += 1; return new Writable(); }), "seaweed_artifact_zip_profile_limit");
  assert.equal(opens, 0);

  const bytes = zip([{ path: "weed", content: "x", mode: 0o100755 }]);
  const controller = new globalThis.AbortController();
  let wholeReads = 0;
  const aborting = source(bytes, (position, length, value) => {
    if (position === 0 && length === bytes.length && ++wholeReads === 2) controller.abort();
    return value;
  });
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, sinks(new Map()), { source: aborting, signal: controller.signal }), "seaweed_artifact_zip_aborted");
});

test("aborts during local-layout preflight and rejects invalid signals before sinks", async () => {
  const bytes = zip([{ path: "weed", content: "x", mode: 0o100755 }]);
  const controller = new globalThis.AbortController();
  let reads = 0;
  let opens = 0;
  const aborting = source(bytes, (_position, _length, value) => {
    reads += 1;
    if (reads === 4) controller.abort();
    return value;
  });
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, () => { opens += 1; return new Writable(); }, {
    source: aborting, signal: controller.signal,
  }), "seaweed_artifact_zip_aborted");
  assert.equal(opens, 0);

  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, () => { opens += 1; return new Writable(); }, {
    signal: { aborted: false },
  }), "seaweed_artifact_zip_signal_invalid");
  assert.equal(opens, 0);
});

test("rejects source changes after delivery and detaches mutable readAt buffers", async () => {
  const bytes = zip([{ path: "weed", content: "payload", mode: 0o100755 }]);
  let wholeReads = 0;
  const changing = source(bytes, (position, length, value) => {
    if (position === 0 && length === bytes.length && ++wholeReads === 2) {
      const changed = Buffer.from(value);
      changed[40] ^= 1;
      return changed;
    }
    return value;
  });
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, sinks(new Map()), { source: changing }), "seaweed_artifact_zip_source_changed");

  const scratch = Buffer.alloc(bytes.length);
  const detached = {
    size: bytes.length,
    readAt(position, length) {
      bytes.copy(scratch, 0, position, position + length);
      const view = scratch.subarray(0, length);
      Promise.resolve().then(() => view.fill(0));
      return view;
    },
  };
  const receipt = await scan(bytes, githubArtifactZipProfiles.build, sinks(new Map()), { source: detached });
  assert.equal(receipt.entryCount, 1);
});

test("propagates sink failure, aborts before sinks, and rejects async sink openers", async () => {
  const bytes = zip([{ path: "weed", content: Buffer.alloc(64), mode: 0o100755 }]);
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, sinks(new Map(), { fail: true })), "seaweed_artifact_zip_entry_stream_invalid");
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, async () => new Writable()), "seaweed_artifact_zip_sink_invalid");
  const controller = new globalThis.AbortController();
  controller.abort();
  let calls = 0;
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, () => { calls += 1; return new Writable(); }, { signal: controller.signal }), "seaweed_artifact_zip_aborted");
  assert.equal(calls, 0);
});

test("classifies caller abort during active delivery, awaits cleanup and never opens a later sink", async () => {
  const bytes = zip([
    { path: "weed", content: Buffer.alloc(256 * 1024, 0x61), mode: 0o100755 },
    { path: "go-build-info.txt", content: "later", mode: 0o100644 },
  ]);
  const controller = new globalThis.AbortController();
  const opened = [];
  let destroyFinished = false;
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, (entry) => {
    opened.push(entry.path);
    return new Writable({
      write() {
        setTimeout(() => controller.abort(), 0);
      },
      destroy(error, callback) {
        setTimeout(() => {
          destroyFinished = true;
          callback(error);
        }, 10);
      },
    });
  }, { signal: controller.signal }), "seaweed_artifact_zip_aborted");
  assert.equal(destroyFinished, true);
  assert.deepEqual(opened, ["weed"]);
});

test("rejects accessor source identities and short reads", async () => {
  const bytes = zip([{ path: "weed", content: "x", mode: 0o100755 }]);
  const accessor = { get size() { return bytes.length; }, readAt(position, length) { return bytes.subarray(position, position + length); } };
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, sinks(new Map()), { source: accessor }), "seaweed_artifact_zip_source_invalid");
  const short = { size: bytes.length, readAt(position, length) { return bytes.subarray(position, position + Math.max(0, length - 1)); } };
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, sinks(new Map()), { source: short }), "seaweed_artifact_zip_source_read_invalid");
  const extra = { size: bytes.length, readAt(position, length) { return Buffer.alloc(length + 1, bytes[position] ?? 0); } };
  await rejectsCode(scan(bytes, githubArtifactZipProfiles.build, sinks(new Map()), { source: extra }), "seaweed_artifact_zip_source_read_invalid");
});

test("owned Linux wrapper scans one no-follow regular file under its root", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "aw-zip-reader-"));
  try {
    const file = path.join(root, "artifact.zip");
    const bytes = zip([{ path: "seaweed-comparison.json", content: "{}\n", method: 8 }]);
    await writeFile(file, bytes, { mode: 0o600 });
    const receipt = await scanOwnedGitHubArtifactZip({
      file, root, descriptor: { size: bytes.length, digest: sha(bytes) }, profile: githubArtifactZipProfiles.comparison,
      openEntrySink: sinks(new Map()),
    });
    assert.equal(receipt.state, "COMPLETE");
    assert.equal(receipt.ownedFileIdentity.nlink, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(receipt)).ownedFileIdentity, receipt.ownedFileIdentity);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("owned Linux wrapper rejects linked, hardlinked and writable workflow paths", { skip: process.platform !== "linux" }, async () => {
  const outer = await mkdtemp(path.join(tmpdir(), "aw-zip-reader-negative-"));
  const bytes = zip([{ path: "seaweed-comparison.json", content: "{}\n", method: 8 }]);
  const options = (file, root) => ({
    file, root, descriptor: { size: bytes.length, digest: sha(bytes) }, profile: githubArtifactZipProfiles.comparison,
    openEntrySink: sinks(new Map()),
  });
  try {
    const realRoot = path.join(outer, "real-root");
    await mkdir(realRoot, { mode: 0o700 });
    const realFile = path.join(realRoot, "artifact.zip");
    await writeFile(realFile, bytes, { mode: 0o600 });
    const linkedRoot = path.join(outer, "linked-root");
    await symlink(realRoot, linkedRoot, "dir");
    await assert.rejects(scanOwnedGitHubArtifactZip(options(path.join(linkedRoot, "artifact.zip"), linkedRoot)), /seaweed_artifact_zip_owned_path_invalid/u);

    const leafRoot = path.join(outer, "leaf-root");
    await mkdir(leafRoot, { mode: 0o700 });
    const leafTarget = path.join(outer, "leaf-target.zip");
    await writeFile(leafTarget, bytes, { mode: 0o600 });
    const linkedFile = path.join(leafRoot, "artifact.zip");
    await symlink(leafTarget, linkedFile, "file");
    await assert.rejects(scanOwnedGitHubArtifactZip(options(linkedFile, leafRoot)), /seaweed_artifact_zip_owned_file_invalid/u);

    const hardRoot = path.join(outer, "hard-root");
    await mkdir(hardRoot, { mode: 0o700 });
    const hardFile = path.join(hardRoot, "artifact.zip");
    await writeFile(hardFile, bytes, { mode: 0o600 });
    await link(hardFile, path.join(outer, "other-link.zip"));
    await assert.rejects(scanOwnedGitHubArtifactZip(options(hardFile, hardRoot)), /seaweed_artifact_zip_owned_file_invalid/u);

    const writableRoot = path.join(outer, "writable-root");
    await mkdir(writableRoot, { mode: 0o720 });
    await chmod(writableRoot, 0o720);
    const writableFile = path.join(writableRoot, "artifact.zip");
    await writeFile(writableFile, bytes, { mode: 0o600 });
    await assert.rejects(scanOwnedGitHubArtifactZip(options(writableFile, writableRoot)), /seaweed_artifact_zip_owned_path_invalid/u);
    await chmod(writableRoot, 0o700);
    await chmod(writableFile, 0o620);
    await assert.rejects(scanOwnedGitHubArtifactZip(options(writableFile, writableRoot)), /seaweed_artifact_zip_owned_file_invalid/u);
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("owned Linux wrapper rejects file and root identity mutation during provisional delivery", { skip: process.platform !== "linux" }, async () => {
  for (const mutate of ["file", "root"]) {
    const root = await mkdtemp(path.join(tmpdir(), "aw-zip-reader-mutate-"));
    try {
      const file = path.join(root, "artifact.zip");
      const bytes = zip([{ path: "seaweed-comparison.json", content: "{}\n", method: 8 }]);
      await writeFile(file, bytes, { mode: 0o600 });
      await assert.rejects(scanOwnedGitHubArtifactZip({
        file, root, descriptor: { size: bytes.length, digest: sha(bytes) }, profile: githubArtifactZipProfiles.comparison,
        openEntrySink(entry) {
          chmodSync(mutate === "file" ? file : root, 0o720);
          return sinks(new Map())(entry);
        },
      }), /seaweed_artifact_zip_owned_(?:file|path)_changed/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
