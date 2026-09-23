import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  cleanupMaterializedSeaweedBase, materializePinnedSeaweedBase, TEST_ONLY_materializePinnedSeaweedBase,
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

test("preserves a substituted partial blob and refuses cleanup authority", { skip: !linux }, async () => {
  const value = scope();
  value.options.stream = async ({ sink }) => {
    const target = sink.path; await sink.close(); writeFileSync(target, "foreign"); throw new Error("synthetic_transport_failure");
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

test("cleanup refuses a changed promoted file without removing it", { skip: !linux }, async () => {
  const value = scope();
  try {
    const receipt = await TEST_ONLY_materializePinnedSeaweedBase(value.options);
    const file = path.join(receipt.outputPath, "base-manifest.json"); writeFileSync(file, "changed");
    await assert.rejects(cleanupMaterializedSeaweedBase(receipt), /cleanup_failed/u);
    assert.equal(readFileSync(file, "utf8"), "changed");
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});
