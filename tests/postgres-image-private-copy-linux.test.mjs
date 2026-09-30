import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync,
  rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { exportPostgresPrivateCopy, importPostgresPrivateCopy, sealPostgresPrivateCopy, runPostgresPrivateCopyLinux,
  validatePostgresPrivateCopyLinuxResult } from "../scripts/postgres-image/private-copy-linux.mjs";
import { retainedFixture } from "./fixtures/postgres-private-retention.mjs";

const linux = process.platform === "linux" && process.getuid() > 0 && process.getgid() > 0;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
function scope(t, fixture = retainedFixture()) {
  const root = mkdtempSync("/tmp/aw-pg-private-copy-"); chmodSync(root, 0o700);
  const source = path.join(root, "retained"); mkdirSync(source, { mode: 0o700 });
  const pin = { sourceDirectory: source, originalRecipeRevision: fixture.recipeRevision,
    originalExecutionId: `local-${fixture.runId}`, sourceGid: process.getgid(), ownerUid: process.getuid(), importGid: process.getgid(),
    policySha256: hash(Buffer.from(JSON.stringify(fixture.policy))),
    importPrefix: path.join(root, "pg-private-reimport-"),
    files: [{ name: "candidate.tar", size: fixture.archive.length, sha256: hash(fixture.archive) },
      { name: "retention-receipt.json", size: fixture.receiptBytes.length, sha256: hash(fixture.receiptBytes) }],
    totalBytes: fixture.archive.length + fixture.receiptBytes.length };
  writeFileSync(path.join(source, pin.files[0].name), fixture.archive, { mode: 0o600 });
  writeFileSync(path.join(source, pin.files[1].name), fixture.receiptBytes, { mode: 0o600 });
  t.after(() => rmSync(root, { recursive: true }));
  const value = { pin, policy: fixture.policy, recipeRevision: "b".repeat(40), parent: root };
  return { root, source, pin, fixture, value, transfer: Buffer.concat([fixture.archive, fixture.receiptBytes]) };
}
function sink(onWrite) {
  const chunks = []; const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) {
    chunks.push(Buffer.from(chunk)); if (onWrite) onWrite(chunk); setTimeout(done, 1);
  } });
  return { chunks, output };
}
function pureAck(fixture = retainedFixture()) {
  const pin = { sourceDirectory: "/tmp/owned-retained", originalRecipeRevision: fixture.recipeRevision,
    originalExecutionId: `local-${fixture.runId}`, sourceGid: 989, policySha256: hash(Buffer.from(JSON.stringify(fixture.policy))),
    files: [{ name: "candidate.tar", size: fixture.archive.length, sha256: hash(fixture.archive) },
      { name: "retention-receipt.json", size: fixture.receiptBytes.length, sha256: hash(fixture.receiptBytes) }],
    totalBytes: fixture.archive.length + fixture.receiptBytes.length };
  const files = pin.files.map((item, index) => ({ ...item, identity: { dev: "1", ino: String(index + 1), uid: 1000,
    gid: 989, mode: 0o600, nlink: 1, mtimeNs: "1000000", ctimeNs: "1000000" } }));
  const result = { kind: "POSTGRES_PRIVATE_COPY_LINUX_RESULT_V1", operation: "EXPORT", state: "VERIFIED",
    recipeRevision: "b".repeat(40), originalRecipeRevision: pin.originalRecipeRevision, originalExecutionId: pin.originalExecutionId,
    sourceDirectory: pin.sourceDirectory, directory: pin.sourceDirectory, sourceFiles: files, files,
    archiveProof: fixture.proof, filesystem: "EXT4" };
  return { result, pin, fixture };
}

test("closed proof acknowledgement validates on Windows without executing Linux", async (t) => {
  const { result, pin, fixture } = pureAck();
  assert.deepEqual(validatePostgresPrivateCopyLinuxResult(result, pin, fixture.policy, fixture.proof), result);
  assert.ok(Object.isFrozen(validatePostgresPrivateCopyLinuxResult(result, pin, fixture.policy).archiveProof.rawLayers));
  const changes = [
    (v) => { v.extra = "private"; }, (v) => { v.filesystem = "NTFS"; },
    (v) => { v.originalExecutionId = "local-123"; }, (v) => { v.files[0].identity.uid = 0; },
    (v) => { v.files[0].identity.nlink = 2; }, (v) => { v.sourceFiles[1].identity.ino = v.sourceFiles[0].identity.ino; },
    (v) => { v.archiveProof.extra = true; }, (v) => { v.archiveProof.archiveMembers = 31; },
    (v) => { v.archiveProof.rawLayers.pop(); }, (v) => { v.archiveProof.compatibilityRecords.pop(); },
    (v) => { v.archiveProof.rawLayers[0].digest = `sha256:${"f".repeat(64)}`; },
    (v) => { v.archiveProof.compatibilityRecords[0].parent = "f".repeat(64); },
    (v) => { v.archiveProof.compatibilityRecords[0].rich = true; },
    (v) => { v.archiveProof.configBytes++; }, (v) => { v.archiveProof.tag = "aw-postgres-gosu:wrong"; },
    (v) => { v.archiveProof.manifestBytes = -1; }, (v) => { v.archiveProof.manifestDigest = "private"; },
    (v) => { v.archiveProof.remoteLayerVerification = "VERIFIED"; },
  ];
  for (let index = 0; index < changes.length; index++) await t.test(`substitution ${index}`, () => {
    const modified = clone(result); changes[index](modified);
    assert.throws(() => validatePostgresPrivateCopyLinuxResult(modified, pin, fixture.policy, modified.archiveProof),
      /^Error: postgres_private_copy_linux_result_invalid$/u);
  });
});

test("export and fresh ext4 reimport use real files and the complete twelve-layer production parser", { skip: !linux }, async (t) => {
  const s = scope(t); const before = s.pin.files.map((item) => lstatSync(path.join(s.source, item.name), { bigint: true }));
  const output = sink(); const exported = await exportPostgresPrivateCopy(s.value, output.output);
  assert.deepEqual(Buffer.concat(output.chunks), s.transfer);
  const imported = await importPostgresPrivateCopy(s.value, Readable.from(Array.from({ length: Math.ceil(s.transfer.length / 17) },
    (_, index) => s.transfer.subarray(index * 17, (index + 1) * 17))));
  assert.equal(imported.operation, "IMPORT"); assert.equal(imported.filesystem, "EXT4");
  assert.deepEqual(imported.archiveProof, s.fixture.proof); assert.deepEqual(imported.sourceFiles, exported.sourceFiles);
  assert.notEqual(imported.directory, s.source); assert.equal(lstatSync(imported.directory).mode & 0o7777, 0o700);
  for (let index = 0; index < s.pin.files.length; index++) {
    const item = s.pin.files[index]; const file = path.join(imported.directory, item.name); const stat = lstatSync(file);
    assert.equal(stat.uid, process.getuid()); assert.equal(stat.gid, process.getgid()); assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.nlink, 1);
    assert.equal(hash(readFileSync(file)), item.sha256); assert.notEqual(stat.ino, Number(before[index].ino));
    const unchanged = lstatSync(path.join(s.source, item.name), { bigint: true });
    for (const key of ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"]) assert.equal(unchanged[key], before[index][key]);
  }
  assert.deepEqual(fs.readdirSync(imported.directory).sort(), ["candidate.tar", "retention-receipt.json"]);
  const sealed = await sealPostgresPrivateCopy(s.value, imported.directory);
  assert.equal(sealed.operation, "SEAL"); assert.deepEqual({ ...sealed, operation: "IMPORT" }, imported);
});

test("final read-only seal rejects changed copies, changed originals and outside paths without creating files", { skip: !linux }, async (t) => {
  for (const [name, mutate] of [
    ["copy", (s, result) => chmodSync(path.join(result.directory, "candidate.tar"), 0o644)],
    ["original", (s) => chmodSync(path.join(s.source, "candidate.tar"), 0o644)],
    ["outside", (_s, result) => { result.directory = "/tmp/outside"; }],
  ]) await t.test(name, async (sub) => {
    const s = scope(sub); const result = clone(await importPostgresPrivateCopy(s.value, Readable.from([s.transfer])));
    mutate(s, result); const before = fs.readdirSync(s.root).sort();
    await assert.rejects(sealPostgresPrivateCopy(s.value, result.directory), /^Error: postgres_private_copy_linux_[a-z_]+$/u);
    assert.deepEqual(fs.readdirSync(s.root).sort(), before);
  });
});

test("source links, metadata, byte or policy substitutions fail before a binary byte is emitted", { skip: !linux }, async (t) => {
  const changes = [
    (s) => chmodSync(path.join(s.source, "candidate.tar"), 0o644),
    (s) => { const file = path.join(s.source, "candidate.tar"); renameSync(file, file + ".real"); symlinkSync(file + ".real", file); },
    (s) => linkSync(path.join(s.source, "candidate.tar"), path.join(s.root, "linked")),
    (s) => writeFileSync(path.join(s.source, "candidate.tar"), Buffer.alloc(s.fixture.archive.length), { mode: 0o600 }),
    (s) => { s.value.policy = { ...s.fixture.policy, subject: "private" }; },
    (s) => { s.value.pin = { ...s.pin, originalRecipeRevision: "c".repeat(40) }; },
    (s) => chmodSync(s.source, 0o755),
  ];
  for (let index = 0; index < changes.length; index++) await t.test(`source ${index}`, async (sub) => {
    const s = scope(sub); changes[index](s); const output = sink();
    await assert.rejects(exportPostgresPrivateCopy(s.value, output.output), /^Error: postgres_private_copy_linux_[a-z_]+$/u);
    assert.equal(output.chunks.length, 0);
  });
});

test("import rejects short, extra, corrupt and nonbinary input while preserving its private staging", { skip: !linux }, async (t) => {
  for (const [name, input, code] of [
    ["short", (s) => Readable.from([s.transfer.subarray(0, -1)]), "input_truncated"],
    ["extra", (s) => Readable.from([s.transfer, Buffer.from([0])]), "input_trailing"],
    ["corrupt", (s) => { const bytes = Buffer.from(s.transfer); bytes[512] ^= 1; return Readable.from([bytes]); }, "copy_changed"],
    ["text", () => Readable.from(["private raw text"]), "input_invalid"],
  ]) await t.test(name, async (sub) => {
    const s = scope(sub); let error;
    try { await importPostgresPrivateCopy(s.value, input(s)); } catch (caught) { error = caught; }
    assert.equal(error.message, `postgres_private_copy_linux_${code}`); assert.equal(error.phase, "IMPORT");
    assert.ok(existsSync(error.directory)); assert.equal(lstatSync(error.directory).mode & 0o7777, 0o700);
    assert.equal(existsSync(path.join(error.directory, "copy-receipt.json")), false);
    assert.equal(hash(readFileSync(path.join(s.source, "candidate.tar"))), s.pin.files[0].sha256);
  });
});

test("source mutation during export or import cannot return a VERIFIED acknowledgement", { skip: !linux }, async (t) => {
  await t.test("export", async (sub) => {
    const s = scope(sub); let changed = false;
    const output = sink(() => { if (!changed) { changed = true; chmodSync(path.join(s.source, "retention-receipt.json"), 0o644); } });
    await assert.rejects(exportPostgresPrivateCopy(s.value, output.output), /postgres_private_copy_linux_identity_invalid/u);
  });
  await t.test("import original inode", async (sub) => {
    const s = scope(sub);
    const input = Readable.from((async function* () {
      yield s.transfer.subarray(0, 512); const file = path.join(s.source, "candidate.tar"); renameSync(file, path.join(s.root, "original-archive"));
      writeFileSync(file, s.fixture.archive, { mode: 0o600 }); yield s.transfer.subarray(512);
    })());
    await assert.rejects(importPostgresPrivateCopy(s.value, input), /postgres_private_copy_linux_identity_invalid/u);
  });
});

test("malformed receipt or malformed archive with independently pinned hashes still fails complete validation", { skip: !linux }, async (t) => {
  await t.test("receipt", async (sub) => {
    const fixture = retainedFixture(); fixture.retention.admission = "AUTHORIZED";
    fixture.receiptBytes = Buffer.from(JSON.stringify(fixture.retention)); const s = scope(sub, fixture); const output = sink();
    await assert.rejects(exportPostgresPrivateCopy(s.value, output.output), /postgres_private_copy_linux_receipt_invalid/u);
    assert.equal(output.chunks.length, 0);
  });
  await t.test("archive", async (sub) => {
    const fixture = retainedFixture(); fixture.archive[512] ^= 1;
    fixture.retention = clone(fixture.retention);
    fixture.retention.archiveProof.archiveSha256 = hash(fixture.archive);
    fixture.retention.remoteMaterialReceipt.archive.archiveSha256 = hash(fixture.archive);
    fixture.receiptBytes = Buffer.from(JSON.stringify(fixture.retention)); const s = scope(sub, fixture); const output = sink();
    await assert.rejects(exportPostgresPrivateCopy(s.value, output.output), /postgres_private_copy_linux_archive_invalid/u);
    assert.equal(output.chunks.length, 0);
  });
});

test("real non-ext4 storage and stream failures are rejected without successful proofs", { skip: !linux }, async (t) => {
  await t.test("non-ext4", async (sub) => {
    const s = scope(sub); const root = mkdtempSync("/dev/shm/aw-pg-private-copy-"); chmodSync(root, 0o700);
    sub.after(() => rmSync(root, { recursive: true }));
    for (const item of s.pin.files) writeFileSync(path.join(root, item.name), readFileSync(path.join(s.source, item.name)), { mode: 0o600 });
    const output = sink();
    await assert.rejects(exportPostgresPrivateCopy({ ...s.value, pin: { ...s.pin, sourceDirectory: root } }, output.output), /postgres_private_copy_linux_storage_invalid/u);
    assert.equal(output.chunks.length, 0);
  });
  await t.test("failed sink", async (sub) => {
    const s = scope(sub); const output = new Writable({ write(_chunk, _encoding, done) { done(new Error("private output detail")); } });
    await assert.rejects(exportPostgresPrivateCopy(s.value, output), (error) => {
      assert.equal(error.message, "postgres_private_copy_linux_operation_failed"); assert.equal(error.phase, "EXPORT"); return true;
    });
  });
  await t.test("abort during input", async (sub) => {
    const s = scope(sub); const controller = new globalThis.AbortController();
    const input = Readable.from((async function* () { yield s.transfer.subarray(0, 512); controller.abort(); yield s.transfer.subarray(512); })());
    await assert.rejects(importPostgresPrivateCopy({ ...s.value, signal: controller.signal }, input), /postgres_private_copy_linux_aborted/u);
  });
});

test("abort, fsync failure and a closed forged getter never publish success", { skip: !linux }, async (t) => {
  await t.test("abort", async (sub) => {
    const s = scope(sub); const controller = new globalThis.AbortController(); controller.abort();
    await assert.rejects(exportPostgresPrivateCopy({ ...s.value, signal: controller.signal }, sink().output), /postgres_private_copy_linux_aborted/u);
  });
  await t.test("fsync", async (sub) => {
    const s = scope(sub); const original = fs.fsyncSync;
    fs.fsyncSync = () => { throw new Error("private native detail"); }; syncBuiltinESMExports();
    try { await assert.rejects(importPostgresPrivateCopy(s.value, Readable.from([s.transfer])), (error) => {
      assert.equal(error.message, "postgres_private_copy_linux_operation_failed"); assert.equal(error.cause, undefined);
      assert.ok(existsSync(error.directory)); return true;
    }); } finally { fs.fsyncSync = original; syncBuiltinESMExports(); }
  });
  await t.test("getter", async (sub) => {
    const s = scope(sub); let reads = 0; const error = new Error();
    Object.defineProperty(error, "message", { get() { return reads++ === 0 ? "postgres_private_copy_linux_source_invalid" : "private secret"; } });
    const value = { get pin() { throw error; }, policy: s.fixture.policy, recipeRevision: "b".repeat(40) };
    await assert.rejects(exportPostgresPrivateCopy(value, sink().output), (result) => {
      assert.equal(result.message, "postgres_private_copy_linux_source_invalid"); assert.equal(reads, 1); assert.equal(result.cause, undefined); return true;
    });
  });
});

test("copy mutation during the final original seal and descriptor cleanup failure take priority over success", { skip: !linux }, async (t) => {
  await t.test("late copy mutation", async (sub) => {
    const s = scope(sub); const original = fs.readSync; let mutated = false;
    fs.readSync = (fd, ...args) => {
      const source = fs.readlinkSync(`/proc/self/fd/${fd}`); const directory = fs.readdirSync(s.root).find((name) => name.startsWith("pg-private-reimport-"));
      if (!mutated && source === path.join(s.source, "candidate.tar") && directory) {
        mutated = true; chmodSync(path.join(s.root, directory, "candidate.tar"), 0o644);
      }
      return original(fd, ...args);
    }; syncBuiltinESMExports();
    try { await assert.rejects(importPostgresPrivateCopy(s.value, Readable.from([s.transfer])), /postgres_private_copy_linux_identity_invalid/u);
      assert.equal(mutated, true);
    } finally { fs.readSync = original; syncBuiltinESMExports(); }
  });
  await t.test("cleanup", async (sub) => {
    const s = scope(sub); const original = fs.closeSync; let failed = false;
    fs.closeSync = (fd) => { original(fd); if (!failed) { failed = true; throw new Error("private close detail"); } };
    syncBuiltinESMExports();
    try { await assert.rejects(exportPostgresPrivateCopy(s.value, sink().output), (error) => {
      assert.equal(error.message, "postgres_private_copy_linux_descriptor_cleanup_failed"); assert.equal(error.phase, "CLEANUP");
      assert.equal(error.cause, undefined); return true;
    }); } finally { fs.closeSync = original; syncBuiltinESMExports(); }
  });
});

test("production CLI rejects parameters and requires the actual pinned Linux context", async () => {
  await assert.rejects(runPostgresPrivateCopyLinux(["import", "/tmp/arbitrary"]), /postgres_private_copy_linux_arguments_invalid/u);
  await assert.rejects(runPostgresPrivateCopyLinux(["anything"]), /postgres_private_copy_linux_arguments_invalid/u);
  await assert.rejects(runPostgresPrivateCopyLinux(["seal", "/tmp/outside"]), /postgres_private_copy_linux_arguments_invalid/u);
});
