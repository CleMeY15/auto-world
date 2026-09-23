import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import test from "node:test";

import { scanRawUstar } from "../scripts/seaweed-image/archive.mjs";
import {
  cleanupMaterializedSeaweedRootfs, createRootfsContentOpener, TEST_ONLY_materializeReviewedSeaweedRootfs,
} from "../scripts/seaweed-image/materialize-rootfs.mjs";
import { writeUstarArchive } from "../scripts/seaweed-image/write-archive.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const linux = process.platform === "linux";
const entry = (name, bytes) => ({ path: name, type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 1_700_000_000,
  size: bytes.length, sha256: hash(bytes) });

test("rootfs content routing writes verified base, replacement binary and notice bytes", async () => {
  const baseBytes = Buffer.from("kept base file");
  const weedBytes = Buffer.alloc(1024 ** 2 + 7, 0x77);
  const noticeBytes = Buffer.from("accepted notice\n");
  const entries = [entry("usr/lib/kept", baseBytes), entry("usr/bin/weed", weedBytes), entry("usr/share/auto-world/seaweedfs/NOTICE", noticeBytes)];
  const called = [];
  const base = { readEntry: async (name) => { called.push(name); assert.equal(name, "usr/lib/kept"); return Buffer.from(baseBytes); } };
  const source = { readBinary: async () => Buffer.from(weedBytes) };
  const noticeEntries = [{ ...entries[2], content: Buffer.from(noticeBytes) }];
  const output = [];
  const sink = new Writable({ write(chunk, _encoding, callback) { output.push(Buffer.from(chunk)); callback(); } });
  const receipt = await writeUstarArchive({ entries, sink,
    openContent: createRootfsContentOpener({ base, source, noticeEntries }) });
  const tar = Buffer.concat(output);
  const scanned = await scanRawUstar({ input: Readable.from([tar.subarray(0, 1024 ** 2), tar.subarray(1024 ** 2)]), diffId: receipt.diffId });
  assert.deepEqual(scanned.members.map(({ entry: member }) => member), entries);
  assert.equal(scanned.rawSize, receipt.rawSize);
  assert.deepEqual(called, ["usr/lib/kept"]);
});

test("rootfs content routing cannot pass mutated notice bytes through the writer", async () => {
  const approved = Buffer.from("approved");
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const planned = entry("usr/share/auto-world/seaweedfs/NOTICE", approved);
  const openContent = createRootfsContentOpener({
    base: { readEntry: async () => { throw new Error("base should not be used"); } },
    source: { readBinary: async () => { throw new Error("source should not be used"); } },
    noticeEntries: [{ ...planned, content: Buffer.from("tampered") }],
  });
  await assert.rejects(writeUstarArchive({ entries: [planned], sink: output, openContent }),
    /seaweed_ustar_content_(?:hash|size)_mismatch/u);
});

function transactionScope({ writeFailure = false } = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "aw-rootfs-materialization-")); chmodSync(parent, 0o700);
  const raw = Buffer.from("synthetic verified rootfs"); const diffId = `sha256:${hash(raw)}`;
  const codeRevision = "2".repeat(40); const binarySha = "a".repeat(64); const binarySize = 123_456;
  const child = (kind) => ({ kind, marker: `${kind}.owned`, ...(kind === "source" ? {
    repository: "CleMeY15/auto-world", workflowId: 358_072_544, runId: 35_884_717_093, attempt: 1,
    sourceSha: codeRevision,
  } : {}) });
  const materialize = (kind) => async ({ parent: childParent }) => {
    const receipt = child(kind); receipt.outputPath = path.join(childParent, receipt.marker);
    writeFileSync(receipt.outputPath, kind, { mode: 0o600 }); return receipt;
  };
  const cleanup = async (receipt) => {
    const childParent = path.join(parent, receipt.kind); unlinkSync(path.join(childParent, receipt.marker));
    return { state: "CLEANED" };
  };
  const sourceIdentity = { binary: { sha256: binarySha, size: binarySize }, runId: "35884717093", attempt: 1, codeRevision };
  const inputs = { baseMaterials: new Map([["base-manifest.json", Buffer.from("manifest")]]),
    source: { ...sourceIdentity, recipeRevision: "1".repeat(40), createdAt: "2026-09-23T12:34:56.789Z" } };
  const options = { parent, recipeRevision: "1".repeat(40), createdAt: "2026-09-23T12:34:56.789Z",
    platform: "linux", uid: process.getuid(), materializeSource: materialize("source"), materializeBase: materialize("base"),
    withSource: async (_receipt, callback) => callback({ sourceIdentity }), withBase: async (_receipt, callback) => callback({}),
    cleanupSource: cleanup, cleanupBase: cleanup,
    writeRootfs: async ({ sink }) => {
      if (writeFailure) throw new Error("synthetic writer failure");
      sink.end(raw); await finished(sink);
      return { inputs, plan: { entries: [] }, receipt: { rawSize: raw.length, diffId, memberCount: 0 } };
    },
    scanRootfs: async ({ input, diffId: expected }) => {
      const chunks = []; for await (const chunk of input) chunks.push(Buffer.from(chunk));
      assert.equal(expected, diffId); assert.deepEqual(Buffer.concat(chunks), raw);
      return { rawSize: raw.length, diffId, members: [] };
    },
    validateFilesystem: () => ({ kind: "SEAWEED_INVENTORY_PLAN_MATCH_V1", authority: "PREPARATION_ONLY", entries: 0 }) };
  return { parent, options, raw, diffId, codeRevision, binarySha, binarySize };
}

test("composite rootfs transaction returns an opaque receipt and cleans only through its live capability", { skip: !linux }, async () => {
  const value = transactionScope();
  try {
    const receipt = await TEST_ONLY_materializeReviewedSeaweedRootfs(value.options);
    assert.deepEqual(Object.keys(receipt), ["kind", "state", "authority", "candidateAuthorization", "rawSize", "diffId",
      "memberCount", "sourceRunId", "baseManifestDigest", "sourceRepository", "sourceWorkflowId", "sourceAttempt",
      "sourceCodeRevision", "sourceBinaryDigest", "sourceBinarySize", "recipeRevision", "createdAt"]);
    assert.equal(receipt.kind, "SEAWEED_ROOTFS_MATERIALIZATION_RECEIPT_V1");
    assert.equal(receipt.state, "MATERIALIZED"); assert.equal(receipt.authority, "PREPARATION_ONLY");
    assert.equal(receipt.candidateAuthorization, "NOT_AUTHORIZED"); assert.equal(receipt.rawSize, value.raw.length);
    assert.equal(receipt.diffId, value.diffId); assert.equal(receipt.memberCount, 0);
    assert.equal(receipt.sourceRunId, "35884717093");
    assert.equal(receipt.baseManifestDigest, `sha256:${hash(Buffer.from("manifest"))}`);
    assert.equal(receipt.sourceRepository, "CleMeY15/auto-world"); assert.equal(receipt.sourceWorkflowId, 358_072_544);
    assert.equal(receipt.sourceAttempt, 1); assert.equal(receipt.sourceCodeRevision, value.codeRevision);
    assert.equal(receipt.sourceBinaryDigest, `sha256:${value.binarySha}`); assert.equal(receipt.sourceBinarySize, value.binarySize);
    assert.equal(receipt.recipeRevision, "1".repeat(40)); assert.equal(receipt.createdAt, "2026-09-23T12:34:56.789Z");
    assert.deepEqual(readdirSync(value.parent).sort(), ["base", "output", "source"]);
    assert.deepEqual(readFileSync(path.join(value.parent, "output/rootfs.tar")), value.raw);
    await assert.rejects(cleanupMaterializedSeaweedRootfs({ ...receipt }), /cleanup_unauthorized/u);
    assert.equal((await cleanupMaterializedSeaweedRootfs(receipt)).state, "CLEANED");
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("composite rootfs transaction cleans both child materializations after writer failure", { skip: !linux }, async () => {
  const value = transactionScope({ writeFailure: true });
  try {
    await assert.rejects(TEST_ONLY_materializeReviewedSeaweedRootfs(value.options), /seaweed_rootfs_materialization_failed/u);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("composite rootfs publication never replaces a colliding destination", { skip: !linux }, async () => {
  const value = transactionScope(); const foreign = Buffer.from("foreign destination");
  value.options.beforeRename = ({ finalFile }) => { writeFileSync(finalFile, foreign, { mode: 0o600 }); };
  try {
    await assert.rejects(TEST_ONLY_materializeReviewedSeaweedRootfs(value.options), /materialization_cleanup_failed/u);
    assert.deepEqual(readFileSync(path.join(value.parent, "output/rootfs.tar")), foreign);
    assert.deepEqual(readdirSync(path.join(value.parent, "output")), ["rootfs.tar"]);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("composite rootfs rejects a pre-aborted transaction before creating owned state", { skip: !linux }, async () => {
  const value = transactionScope(); const controller = new globalThis.AbortController(); controller.abort();
  value.options.signal = controller.signal;
  try {
    await assert.rejects(TEST_ONLY_materializeReviewedSeaweedRootfs(value.options), /materialization_aborted/u);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("composite rootfs classifies external abort during write after complete owned cleanup", { skip: !linux }, async () => {
  const value = transactionScope(); const controller = new globalThis.AbortController(); value.options.signal = controller.signal;
  value.options.writeRootfs = async () => {
    controller.abort(); throw Object.assign(new Error("wrapped abort"), { code: "seaweed_ustar_write_failed" });
  };
  try {
    await assert.rejects(TEST_ONLY_materializeReviewedSeaweedRootfs(value.options), /materialization_aborted/u);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("composite rootfs closes both scan streams and classifies abort during the published scan", { skip: !linux }, async () => {
  const value = transactionScope(); const controller = new globalThis.AbortController(); value.options.signal = controller.signal;
  const scan = value.options.scanRootfs; const streams = []; let calls = 0;
  value.options.scanRootfs = async (options) => {
    calls += 1; streams.push(options.input);
    if (calls === 2) {
      controller.abort(); throw Object.assign(new Error("wrapped scanner abort"), { code: "seaweed_archive_stream_invalid" });
    }
    return scan(options);
  };
  try {
    await assert.rejects(TEST_ONLY_materializeReviewedSeaweedRootfs(value.options), /materialization_aborted/u);
    assert.equal(calls, 2); assert.equal(streams.every((stream) => stream.destroyed), true);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("composite rootfs closes the active stream when either independent scan fails", { skip: !linux }, async () => {
  for (const failOn of [1, 2]) {
    const value = transactionScope(); const scan = value.options.scanRootfs; const streams = []; let calls = 0;
    value.options.scanRootfs = async (options) => {
      calls += 1; streams.push(options.input);
      if (calls === failOn) throw new Error(`synthetic scan ${failOn} failure`);
      return scan(options);
    };
    try {
      await assert.rejects(TEST_ONLY_materializeReviewedSeaweedRootfs(value.options), /materialization_failed/u);
      assert.equal(streams.every((stream) => stream.destroyed), true);
      assert.deepEqual(readdirSync(value.parent), []);
    } finally { rmSync(value.parent, { recursive: true, force: true }); }
  }
});

test("composite rootfs enforces its aggregate deadline and cleans after a wrapped timeout", { skip: !linux }, async () => {
  const value = transactionScope(); value.options.timeoutMs = 20;
  value.options.writeRootfs = async ({ signal }) => new Promise((_resolve, reject) => {
    const fail = () => reject(Object.assign(new Error("wrapped timeout"), {
      code: "seaweed_ustar_write_failed",
    }));
    if (signal.aborted) fail(); else signal.addEventListener("abort", fail, { once: true });
  });
  try {
    await assert.rejects(TEST_ONLY_materializeReviewedSeaweedRootfs(value.options), /materialization_timeout/u);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("composite rootfs preserves a same-byte inode substitution before publication", { skip: !linux }, async () => {
  const value = transactionScope();
  value.options.beforeRename = ({ partialFile }) => {
    const bytes = readFileSync(partialFile); unlinkSync(partialFile); writeFileSync(partialFile, bytes, { mode: 0o600 });
  };
  try {
    await assert.rejects(TEST_ONLY_materializeReviewedSeaweedRootfs(value.options), /materialization_cleanup_failed/u);
    assert.deepEqual(readFileSync(path.join(value.parent, "output/rootfs.tar.partial")), value.raw);
    assert.deepEqual(readdirSync(path.join(value.parent, "output")), ["rootfs.tar.partial"]);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});
