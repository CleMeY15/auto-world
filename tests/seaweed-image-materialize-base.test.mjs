import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  cleanupMaterializedSeaweedBase, materializePinnedSeaweedBase, TEST_ONLY_materializePinnedSeaweedBase,
  withMaterializedSeaweedBase,
} from "../scripts/seaweed-image/materialize-base.mjs";

const linux = process.platform === "linux";
const policyRoot = path.resolve(import.meta.dirname, "../infra/seaweed-image");
const manifestBytes = await readFile(path.join(policyRoot, "base-manifest.json"));
const configBytes = await readFile(path.join(policyRoot, "base-config.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const emptyTar = Buffer.alloc(1024);
const compressed = gzipSync(emptyTar, { level: 9, mtime: 0 });
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function scope() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "aw-base-materialization-")); chmodSync(parent, 0o700);
  let fetchCalls = 0;
  const fetch = async () => {
    fetchCalls += 1;
    return Object.freeze({ bytes: Buffer.from(manifestBytes), digest: digest(manifestBytes),
      mediaType: "application/vnd.oci.image.manifest.v1+json", config: Object.freeze({ ...manifest.config }),
      layers: Object.freeze(manifest.layers.map((item) => Object.freeze({ ...item }))) });
  };
  const stream = async ({ descriptor, sink }) => {
    const bytes = descriptor.digest === manifest.config.digest ? configBytes : compressed;
    let offset = 0;
    while (offset < bytes.length) {
      const result = await sink.write(bytes, offset, bytes.length - offset, null);
      offset += result.bytesWritten;
    }
    return Object.freeze({ size: descriptor.size, digest: descriptor.digest, mediaType: descriptor.mediaType,
      authority: "PINNED_BASE_ONLY", candidateAuthorization: "NOT_AUTHORIZED" });
  };
  const scan = async () => ({ totals: { compressedBytes: compressed.length * 10, rawBytes: emptyTar.length * 10,
    memberCount: 0, visibleEntries: 0 }, members: [], layers: Array.from({ length: 10 }, (_, layerIndex) => ({ layerIndex,
    compressedSize: compressed.length, compressedDigest: digest(compressed), uncompressedSize: emptyTar.length,
    diffId: digest(emptyTar), memberCount: 0 })) });
  return { parent, options: { parent, platform: "linux", uid: process.getuid(), fetch, stream, scan }, fetchCalls: () => fetchCalls };
}

function tarFile(name, bytes) {
  const header = Buffer.alloc(512);
  const field = (offset, length, value) => header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
  header.write(name, 0, 100, "utf8"); field(100, 8, 0o755); field(108, 8, 0); field(116, 8, 0);
  field(124, 12, bytes.length); field(136, 12, 0); header[156] = "0".charCodeAt(0);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512), Buffer.alloc(1024)]);
}

function readableScope() {
  const value = scope(); const contents = Buffer.from("verified seaweed base entry\n");
  const firstTar = tarFile("usr/bin/weed", contents); const firstCompressed = gzipSync(firstTar, { level: 9, mtime: 0 });
  const firstDigest = manifest.layers[0].digest;
  value.options.stream = async ({ descriptor, sink }) => {
    const bytes = descriptor.digest === manifest.config.digest ? configBytes
      : descriptor.digest === firstDigest ? firstCompressed : compressed;
    let offset = 0;
    while (offset < bytes.length) {
      const result = await sink.write(bytes, offset, bytes.length - offset, null); offset += result.bytesWritten;
    }
    return Object.freeze({ size: descriptor.size, digest: descriptor.digest, mediaType: descriptor.mediaType,
      authority: "PINNED_BASE_ONLY", candidateAuthorization: "NOT_AUTHORIZED" });
  };
  value.options.scan = async () => ({ kind: "PUBLIC_BASE_REPLAY_INDEX_V1", authority: "PREPARATION_ONLY",
    materials: {}, totals: { compressedBytes: firstCompressed.length + compressed.length * 9,
      rawBytes: firstTar.length + emptyTar.length * 9, memberCount: 1, visibleEntries: 1 },
    layers: Array.from({ length: 10 }, (_, layerIndex) => ({ layerIndex,
      compressedSize: layerIndex === 0 ? firstCompressed.length : compressed.length,
      compressedDigest: digest(layerIndex === 0 ? firstCompressed : compressed),
      uncompressedSize: layerIndex === 0 ? firstTar.length : emptyTar.length,
      diffId: digest(layerIndex === 0 ? firstTar : emptyTar), memberCount: layerIndex === 0 ? 1 : 0 })),
    members: [{ layerIndex: 0, compressedDigest: digest(firstCompressed), memberOrdinal: 0,
      uncompressedHeaderOffset: 0, uncompressedDataOffset: 512,
      entry: { path: "usr/bin/weed", type: "file", mode: 0o755, uid: 0, gid: 0, mtime: 0,
        size: contents.length, sha256: digest(contents).slice("sha256:".length) } }] });
  return { ...value, contents };
}

test("production API rejects injected registry or validation authority", async () => {
  await assert.rejects(materializePinnedSeaweedBase({ parent: path.resolve(os.tmpdir()), fetch: async () => {} }),
    /seaweed_base_materialization_options_invalid/u);
  await assert.rejects(materializePinnedSeaweedBase({ parent: path.resolve(os.tmpdir()), scan: async () => {} }),
    /seaweed_base_materialization_options_invalid/u);
});

test("materializes ten compressed blobs and ten full raw TARs, then cleans only through the live receipt", { skip: !linux }, async () => {
  const value = scope();
  const timeouts = [];
  const originalFetch = value.options.fetch; const originalStream = value.options.stream;
  value.options.fetch = async (options) => { timeouts.push(options.timeoutMs); return originalFetch(options); };
  value.options.stream = async (options) => { timeouts.push(options.timeoutMs); return originalStream(options); };
  try {
    const receipt = await TEST_ONLY_materializePinnedSeaweedBase(value.options);
    assert.deepEqual(Object.keys(receipt), ["kind", "state", "authority", "candidateAuthorization", "outputPath", "totals"]);
    assert.equal(receipt.kind, "SEAWEED_BASE_MATERIALIZATION_RECEIPT_V1");
    assert.equal(receipt.state, "MATERIALIZED"); assert.equal(receipt.authority, "PREPARATION_ONLY");
    assert.equal(receipt.candidateAuthorization, "NOT_AUTHORIZED"); assert.equal(value.fetchCalls(), 2);
    assert.equal(timeouts.length, 13); assert.equal(timeouts.every((timeout) => timeout <= 30 * 60_000), true);
    assert.equal(readdirSync(path.join(receipt.outputPath, "blobs")).length, 10);
    assert.equal(readdirSync(path.join(receipt.outputPath, "layers")).length, 10);
    assert.deepEqual(readFileSync(path.join(receipt.outputPath, "base-config.json")), configBytes);
    await assert.rejects(cleanupMaterializedSeaweedBase({ ...receipt }), /cleanup_unauthorized/u);
    assert.equal((await cleanupMaterializedSeaweedBase(receipt)).state, "CLEANED");
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("external abort interrupts an opened local scan stream and cleans owned inputs", { skip: !linux }, async () => {
  const value = scope(); const controller = new globalThis.AbortController(); value.options.signal = controller.signal;
  value.options.scan = async ({ openBlob }) => {
    const input = openBlob({ layerIndex: 0 }); controller.abort(); input.resume(); await finished(input);
    throw new Error("unreachable");
  };
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /materialization_aborted/u);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("abort before or after promotion yields no receipt and cleans only owned files", { skip: !linux }, async () => {
  for (const hook of ["beforeRename", "afterRename"]) {
    const value = scope(); const controller = new globalThis.AbortController();
    value.options.signal = controller.signal;
    value.options[hook] = async () => { controller.abort(); };
    try {
      await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /materialization_aborted/u);
      assert.deepEqual(readdirSync(value.parent), []);
    } finally { rmSync(value.parent, { recursive: true, force: true }); }
  }
});

test("rejects descriptor substitution before any blob write", { skip: !linux }, async () => {
  const value = scope(); let streams = 0;
  value.options.stream = async () => { streams += 1; };
  value.options.fetch = async () => ({ bytes: Buffer.from(manifestBytes), digest: digest(manifestBytes), mediaType: "x",
    config: { ...manifest.config }, layers: manifest.layers.map((item, index) => index === 0
      ? { ...item, digest: "../../foreign" } : { ...item }) });
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /manifest_invalid/u);
    assert.equal(streams, 0); assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("cleans an owned partial blob after the injected stream fails", { skip: !linux }, async () => {
  const value = scope(); let calls = 0;
  value.options.stream = async ({ sink }) => {
    calls += 1; await sink.write(Buffer.from("partial"), 0, 7, null); throw new Error("synthetic_transport_failure");
  };
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /materialization_failed/u);
    assert.equal(calls, 1); assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("cleans the owned partial file when fsync cannot complete", { skip: !linux }, async () => {
  const value = scope();
  value.options.stream = async ({ descriptor, sink }) => {
    await sink.write(Buffer.from("partial"), 0, 7, null);
    await sink.close();
    return { size: descriptor.size, digest: descriptor.digest, mediaType: descriptor.mediaType,
      authority: "PINNED_BASE_ONLY", candidateAuthorization: "NOT_AUTHORIZED" };
  };
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /materialization_failed/u);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("cleans the owned partial file when close fails after closing", { skip: !linux }, async () => {
  const value = scope();
  value.options.stream = async ({ descriptor, sink }) => {
    const originalClose = sink.close.bind(sink);
    sink.close = async () => { await originalClose(); throw new Error("injected close failure"); };
    return { size: descriptor.size, digest: descriptor.digest, mediaType: descriptor.mediaType,
      authority: "PINNED_BASE_ONLY", candidateAuthorization: "NOT_AUTHORIZED" };
  };
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /materialization_failed/u);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("rejects malformed gzip and wrong DiffID before promotion", { skip: !linux }, async () => {
  for (const corrupt of ["gzip", "diffid"]) {
    const value = scope();
    if (corrupt === "gzip") {
      value.options.stream = async ({ descriptor, sink }) => {
        const bytes = descriptor.digest === manifest.config.digest ? configBytes : Buffer.from("invalid gzip");
        await sink.write(bytes, 0, bytes.length, null);
        return { size: descriptor.size, digest: descriptor.digest, mediaType: descriptor.mediaType,
          authority: "PINNED_BASE_ONLY", candidateAuthorization: "NOT_AUTHORIZED" };
      };
    } else {
      const scan = value.options.scan;
      value.options.scan = async (input) => {
        const index = await scan(input);
        index.layers[0].diffId = `sha256:${"0".repeat(64)}`;
        return index;
      };
    }
    try {
      await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options));
      assert.deepEqual(readdirSync(value.parent), []);
    } finally { rmSync(value.parent, { recursive: true, force: true }); }
  }
});

test("preserves a substituted partial blob and refuses cleanup authority", { skip: !linux }, async () => {
  const value = scope();
  value.options.stream = async ({ sink }) => {
    const target = path.join(value.parent, ".seaweed-base-materialization-staging", "base-config.json");
    await sink.write(Buffer.from("partial"), 0, 7, null);
    unlinkSync(target);
    writeFileSync(target, "foreign", { mode: 0o600 });
    throw new Error("synthetic_transport_failure");
  };
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /cleanup_failed/u);
    assert.equal(readFileSync(path.join(value.parent, ".seaweed-base-materialization-staging/base-config.json"), "utf8"), "foreign");
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("rejects a malformed winning raw-TAR reference and removes its owned transaction", { skip: !linux }, async () => {
  const value = scope();
  value.options.scan = async () => ({ totals: { compressedBytes: compressed.length * 10, rawBytes: emptyTar.length * 10,
    memberCount: 1, visibleEntries: 1 }, layers: Array.from({ length: 10 }, (_, layerIndex) => ({ layerIndex,
    compressedSize: compressed.length, compressedDigest: digest(compressed), uncompressedSize: emptyTar.length,
    diffId: digest(emptyTar), memberCount: layerIndex === 0 ? 1 : 0 })), members: [{ layerIndex: 0,
    uncompressedHeaderOffset: 1, uncompressedDataOffset: 513,
    entry: { path: "x", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 0, sha256: digest(Buffer.alloc(0)).slice(7) } }] });
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /reference_invalid/u);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("preserves a substituted post-rename tree and reports cleanup failure", { skip: !linux }, async () => {
  const value = scope();
  value.options.afterRename = async ({ parent, outputPath }) => {
    const moved = path.join(parent, "owned-moved"); renameSync(outputPath, moved);
    const replacement = path.join(parent, "replacement"); writeFileSync(replacement, "foreign");
    symlinkSync(replacement, outputPath, "file");
  };
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /cleanup_failed/u);
    assert.equal(readFileSync(path.join(value.parent, "replacement"), "utf8"), "foreign");
    assert.equal(readdirSync(path.join(value.parent, "owned-moved", "blobs")).length, 10);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("refuses to replace an unknown empty destination directory", { skip: !linux }, async () => {
  const value = scope(); let unknownIdentity;
  const destination = path.join(value.parent, "seaweed-base-materialized");
  value.options.beforeRename = async () => {
    mkdirSync(destination, { mode: 0o700 });
    const stat = statSync(destination);
    unknownIdentity = { dev: stat.dev, ino: stat.ino };
  };
  try {
    await assert.rejects(TEST_ONLY_materializePinnedSeaweedBase(value.options), /cleanup_failed/u);
    const stat = statSync(destination);
    assert.deepEqual({ dev: stat.dev, ino: stat.ino }, unknownIdentity);
    assert.deepEqual(readdirSync(destination), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("cleanup refuses a changed promoted file without removing it", { skip: !linux }, async () => {
  const value = scope();
  try {
    const receipt = await TEST_ONLY_materializePinnedSeaweedBase(value.options);
    const file = path.join(receipt.outputPath, "base-manifest.json"); writeFileSync(file, "changed");
    await assert.rejects(cleanupMaterializedSeaweedBase(receipt), /cleanup_failed/u);
    assert.equal(readFileSync(file, "utf8"), "changed");
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("borrows the live receipt to read an authenticated visible file and detached base materials", { skip: !linux }, async () => {
  const value = readableScope();
  try {
    const receipt = await TEST_ONLY_materializePinnedSeaweedBase(value.options);
    await assert.rejects(withMaterializedSeaweedBase({ ...receipt }, async () => {}), /borrow_unauthorized/u);
    await assert.rejects(withMaterializedSeaweedBase(JSON.parse(JSON.stringify(receipt)), async () => {}), /borrow_unauthorized/u);
    let expiredRead;
    const result = await withMaterializedSeaweedBase(receipt, async (base) => {
      assert.deepEqual(Object.keys(base), ["baseMaterials", "index", "readEntry"]);
      assert.equal(base.index.kind, "PUBLIC_BASE_REPLAY_INDEX_V1");
      assert.equal(Object.isFrozen(base.index), true); assert.equal(Object.isFrozen(base.index.members[0]), true);
      assert.deepEqual(await base.readEntry("usr/bin/weed"), value.contents);
      await assert.rejects(base.readEntry("usr/bin/weed"), /read_replayed/u);
      await assert.rejects(base.readEntry("../usr/bin/weed"), /read_path_invalid/u);
      await assert.rejects(base.readEntry("usr/bin/missing"), /read_missing/u);
      const manifestCopy = base.baseMaterials.get("base-manifest.json");
      manifestCopy.fill(0); base.baseMaterials.clear(); expiredRead = base.readEntry;
      return "borrow-result";
    });
    assert.equal(result, "borrow-result");
    await assert.rejects(expiredRead("usr/bin/weed"), /read_expired/u);
    await withMaterializedSeaweedBase(receipt, async ({ baseMaterials, readEntry }) => {
      assert.deepEqual(baseMaterials.get("base-manifest.json"), manifestBytes);
      const pending = readEntry("usr/bin/weed");
      await assert.rejects(readEntry("usr/bin/weed"), /read_busy/u);
      assert.deepEqual(await pending, value.contents);
    });
    assert.equal((await cleanupMaterializedSeaweedBase(receipt)).state, "CLEANED");
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("rejects raw-TAR substitution before borrowed content is returned", { skip: !linux }, async () => {
  const value = readableScope();
  try {
    const receipt = await TEST_ONLY_materializePinnedSeaweedBase(value.options);
    const raw = readdirSync(path.join(receipt.outputPath, "layers"))[0];
    writeFileSync(path.join(receipt.outputPath, "layers", raw), tarFile("usr/bin/weed", Buffer.from("foreign")));
    await assert.rejects(withMaterializedSeaweedBase(receipt, ({ readEntry }) => readEntry("usr/bin/weed")), /read_substituted/u);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("refuses cleanup while a live materialization borrow is active", { skip: !linux }, async () => {
  const value = readableScope();
  try {
    const receipt = await TEST_ONLY_materializePinnedSeaweedBase(value.options);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let entered;
    const ready = new Promise((resolve) => { entered = resolve; });
    const borrowed = withMaterializedSeaweedBase(receipt, async ({ readEntry }) => {
      assert.deepEqual(await readEntry("usr/bin/weed"), value.contents); entered(); await gate;
    });
    await ready;
    await assert.rejects(cleanupMaterializedSeaweedBase(receipt), /cleanup_borrowed/u);
    assert.deepEqual(readdirSync(value.parent), ["seaweed-base-materialized"]);
    release(); await borrowed;
    assert.equal((await cleanupMaterializedSeaweedBase(receipt)).state, "CLEANED");
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});
