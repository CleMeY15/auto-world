import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { assertManagedArchiveUnchanged, captureManagedArchive } from "../scripts/scanner/managed-archive.mjs";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const linux = { skip: process.platform !== "linux" ? "Requires native Linux file identity and open flags; no Windows substitute." : false };
const archivePath = path.resolve(os.tmpdir(), "managed-image-postgres.tar");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const controlled = (operation) => assert.rejects(operation, /^Error: scanner_managed_archive_[a-z_]+$/u);

async function fixture(t, bytes = Buffer.from("owned small archive fixture\n"), role = "postgres") {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, "aw-managed-archive-test-"));
  assert.equal(path.dirname(directory), parent);
  assert.ok(path.basename(directory).startsWith("aw-managed-archive-test-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), parent);
    assert.ok(path.basename(directory).startsWith("aw-managed-archive-test-"));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, `managed-image-${role}.tar`);
  await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  await fs.chmod(file, 0o444);
  return { file, directory, bytes };
}

function observeOpen(t, onHandle) {
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    onHandle(handle, args);
    return handle;
  });
}

for (const [label, file, role, options] of [
  ["relative path", "managed-image-postgres.tar", "postgres", {}],
  ["wrong role basename", archivePath, "opensearch", {}],
  ["unknown role", archivePath, "redis", {}],
  ["role coercion", archivePath, ["postgres"], {}],
  ["path coercion", [archivePath], "postgres", {}],
  ["path NUL", `${archivePath}\0`, "postgres", {}],
  ["path comma", path.join(path.dirname(archivePath), "comma,dir", path.basename(archivePath)), "postgres", {}],
  ["path newline", path.join(path.dirname(archivePath), "line\ndir", path.basename(archivePath)), "postgres", {}],
  ["dot alias", `${path.dirname(archivePath)}${path.sep}.${path.sep}${path.basename(archivePath)}`, "postgres", {}],
  ["null options", archivePath, "postgres", null],
  ["array options", archivePath, "postgres", []],
  ["unknown override", archivePath, "postgres", { skipOwner: true }],
  ["zero cap", archivePath, "postgres", { cap: 0 }],
  ["negative cap", archivePath, "postgres", { cap: -1 }],
  ["fractional cap", archivePath, "postgres", { cap: 1.5 }],
  ["string cap", archivePath, "postgres", { cap: "256" }],
  ["unsafe cap", archivePath, "postgres", { cap: Number.MAX_SAFE_INTEGER + 1 }],
  ["raised PostgreSQL cap", archivePath, "postgres", { cap: 2 * GiB + 1 }],
  ["raised AWS cap", path.resolve(os.tmpdir(), "managed-image-aws-cli.tar"), "aws-cli", { cap: 2 * GiB + 1 }],
  ["raised OpenSearch cap", path.resolve(os.tmpdir(), "managed-image-opensearch.tar"), "opensearch", { cap: 4 * GiB + 1 }],
]) {
  test(`managed archive rejects ${label} before filesystem access`, async () => {
    await assert.rejects(captureManagedArchive(file, role, options), /scanner_managed_archive_arguments_invalid/u);
  });
}

test("managed archive refuses non-Linux execution without a weaker platform override", { skip: process.platform === "linux" }, async () => {
  await assert.rejects(captureManagedArchive(archivePath, "postgres"), /scanner_managed_archive_requires_linux/u);
});

const snapshotShape = {
  path: archivePath, role: "postgres", cap: 256, size: 3, sha256: "a".repeat(64),
  identity: { dev: "1", ino: "2", mode: "33060", uid: "1000", gid: "1000", nlink: "1", size: "3", mtimeNs: "4", ctimeNs: "5" },
};
for (const [label, mutate] of [
  ["absent snapshot", () => undefined],
  ["array snapshot", () => []],
  ["extra property", (value) => ({ ...value, trusted: true })],
  ["missing identity", (value) => ({ ...value, identity: undefined })],
  ["numeric hash", (value) => ({ ...value, sha256: 123 })],
  ["uppercase hash", (value) => ({ ...value, sha256: "A".repeat(64) })],
  ["string cap", (value) => ({ ...value, cap: "256" })],
  ["symbol cap", (value) => ({ ...value, cap: Symbol("invalid") })],
  ["invalid size", (value) => ({ ...value, size: 257 })],
  ["numeric identity", (value) => ({ ...value, identity: { ...value.identity, ino: 2 } })],
  ["missing identity field", (value) => { delete value.identity.ctimeNs; return value; }],
  ["extra identity field", (value) => ({ ...value, identity: { ...value.identity, atimeNs: "6" } })],
  ["inconsistent identity size", (value) => ({ ...value, identity: { ...value.identity, size: "4" } })],
]) {
  test(`managed archive recheck rejects ${label}`, async () => {
    await assert.rejects(assertManagedArchiveUnchanged(mutate(JSON.parse(JSON.stringify(snapshotShape)))), /scanner_managed_archive_snapshot_invalid/u);
  });
}

test("managed archive hashes every byte across chunks and retains a frozen JSON-friendly identity", linux, async (t) => {
  const bytes = Buffer.alloc(2 * MiB + 73);
  for (let offset = 0; offset < bytes.length; offset++) bytes[offset] = offset % 251;
  const { file } = await fixture(t, bytes);
  const before = await fs.stat(file, { bigint: true });
  const snapshot = await captureManagedArchive(file, "postgres");
  assert.equal(snapshot.cap, 2 * GiB);
  assert.equal(snapshot.size, bytes.length);
  assert.equal(snapshot.sha256, sha256(bytes));
  assert.equal(snapshot.path, file);
  assert.equal(snapshot.role, "postgres");
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.identity));
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  for (const key of Object.keys(snapshot.identity)) assert.equal(snapshot.identity[key], before[key].toString(), key);
  assert.equal(Object.hasOwn(snapshot.identity, "atimeNs"), false);
  assert.equal(await assertManagedArchiveUnchanged(snapshot), true);
  assert.equal(await assertManagedArchiveUnchanged(snapshot), true);
  assert.deepEqual(await fs.readFile(file), bytes);
});

test("managed archive uses exact role caps with tiny files and allows only a lowered cap", linux, async (t) => {
  for (const [role, cap] of [["postgres", 2 * GiB], ["opensearch", 4 * GiB], ["aws-cli", 2 * GiB]]) {
    const { file } = await fixture(t, Buffer.alloc(256, 97), role);
    assert.equal((await captureManagedArchive(file, role)).cap, cap);
    const bounded = await captureManagedArchive(file, role, { cap: 256 });
    assert.equal(bounded.cap, 256);
    assert.equal(bounded.size, 256);
    assert.equal(await assertManagedArchiveUnchanged(bounded), true);
    await controlled(captureManagedArchive(file, role, { cap: 255 }));
  }
});

test("managed archive keeps one 1MiB buffer, continues short reads, and performs the final EOF read", linux, async (t) => {
  const { file, bytes } = await fixture(t, Buffer.alloc(MiB + 31, 113));
  const buffers = new Set(), positions = [], counts = [];
  let closes = 0;
  observeOpen(t, (handle, [, flags]) => {
    assert.equal(flags, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    t.mock.method(handle, "read", async (buffer, offset, length, position) => {
      assert.equal(buffer.length, MiB);
      assert.equal(offset, 0);
      assert.equal(length, MiB);
      buffers.add(buffer); positions.push(position);
      const result = await read(buffer, offset, Math.min(length, 16381), position);
      counts.push(result.bytesRead);
      return result;
    });
    t.mock.method(handle, "close", async () => { closes++; return close(); });
  });
  const snapshot = await captureManagedArchive(file, "postgres");
  assert.equal(snapshot.sha256, sha256(bytes));
  assert.equal(buffers.size, 1);
  assert.ok(counts.length > 60);
  assert.equal(counts.at(-1), 0);
  assert.equal(positions.at(-1), bytes.length);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), bytes.length);
  assert.equal(closes, 1);
});

for (const [label, change] of [
  ["same-size tail mutation", async (file, bytes) => { const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1; await fs.writeFile(file, changed); }],
  ["truncation", async (file) => fs.truncate(file, 3)],
  ["growth", async (file) => fs.appendFile(file, "new tail")],
  ["same-byte inode substitution", async (file, bytes) => { await fs.rename(file, `${file}.original`); await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }],
]) {
  test(`managed archive recheck refuses ${label} against the initial snapshot`, linux, async (t) => {
    const { file, bytes } = await fixture(t, Buffer.alloc(2 * MiB + 19, 83));
    const snapshot = await captureManagedArchive(file, "postgres");
    await fs.chmod(file, 0o600);
    await change(file, bytes);
    await fs.chmod(file, 0o444);
    await controlled(assertManagedArchiveUnchanged(snapshot));
    await controlled(assertManagedArchiveUnchanged(snapshot));
  });
}

test("managed archive rejects empty files and every write permission bit", linux, async (t) => {
  const { file } = await fixture(t, Buffer.alloc(0));
  await controlled(captureManagedArchive(file, "postgres"));
  await fs.chmod(file, 0o600);
  await fs.writeFile(file, "nonempty");
  for (const mode of [0o644, 0o464, 0o446]) {
    await fs.chmod(file, mode);
    await controlled(captureManagedArchive(file, "postgres"));
  }
});

test("managed archive refuses another expected runner UID without an owner bypass", linux, async (t) => {
  const { file } = await fixture(t);
  const actualUid = process.getuid();
  t.mock.method(process, "getuid", () => actualUid + 1);
  await controlled(captureManagedArchive(file, "postgres"));
});

test("managed archive rejects symbolic links, parent aliases, hard links and directories", linux, async (t) => {
  const { file, directory } = await fixture(t);
  await fs.rename(file, `${file}.original`);
  await fs.symlink(`${file}.original`, file);
  await controlled(captureManagedArchive(file, "postgres"));
  await fs.unlink(file);
  await fs.link(`${file}.original`, file);
  await controlled(captureManagedArchive(file, "postgres"));
  await fs.unlink(file);
  await fs.rename(`${file}.original`, file);
  const alias = `${directory}-alias`;
  await fs.symlink(directory, alias, "dir");
  try { await controlled(captureManagedArchive(path.join(alias, path.basename(file)), "postgres")); }
  finally { await fs.unlink(alias); }
  await fs.unlink(file);
  await fs.mkdir(file);
  await controlled(captureManagedArchive(file, "postgres"));
});

test("managed archive recheck refuses newly writable files and newly linked files", linux, async (t) => {
  const { file } = await fixture(t);
  const snapshot = await captureManagedArchive(file, "postgres");
  await fs.chmod(file, 0o644);
  await controlled(assertManagedArchiveUnchanged(snapshot));
  await fs.chmod(file, 0o444);
  await fs.link(file, `${file}.alias`);
  await controlled(assertManagedArchiveUnchanged(snapshot));
});

test("managed archive refuses a metadata-only timestamp change", linux, async (t) => {
  const { file } = await fixture(t);
  const snapshot = await captureManagedArchive(file, "postgres");
  const before = await fs.stat(file);
  await fs.utimes(file, before.atime, new Date(before.mtime.getTime() + 10000));
  await assert.rejects(assertManagedArchiveUnchanged(snapshot), /scanner_managed_archive_changed/u);
});

test("managed archive checks fstat immediately after a same-byte substitution before open", linux, async (t) => {
  const { file, bytes } = await fixture(t);
  const nativeOpen = fs.open.bind(fs);
  let reads = 0, closes = 0;
  t.mock.method(fs, "open", async (...args) => {
    await fs.rename(file, `${file}.original`);
    await fs.writeFile(file, bytes, { flag: "wx", mode: 0o444 });
    const handle = await nativeOpen(...args), close = handle.close.bind(handle);
    t.mock.method(handle, "read", async () => { reads++; throw new Error("must not read a substituted file"); });
    t.mock.method(handle, "close", async () => { closes++; return close(); });
    return handle;
  });
  await assert.rejects(captureManagedArchive(file, "postgres"), /scanner_managed_archive_changed/u);
  assert.equal(reads, 0);
  assert.equal(closes, 1);
});

for (const [label, change] of [
  ["tail content", async (file) => { const writer = await fs.open(file, "r+"); try { await writer.write(Buffer.from("Z"), 0, 1, MiB + 30); } finally { await writer.close(); } }],
  ["truncation", async (file) => fs.truncate(file, 4)],
  ["growth", async (file) => fs.appendFile(file, "extra")],
  ["path substitution", async (file) => { await fs.rename(file, `${file}.original`); await fs.writeFile(file, Buffer.alloc(MiB + 31, 83), { flag: "wx", mode: 0o600 }); }],
]) {
  test(`managed archive detects ${label} during a read and closes its handle`, linux, async (t) => {
    const { file } = await fixture(t, Buffer.alloc(MiB + 31, 83));
    let changed = false, closes = 0;
    const nativeOpen = fs.open.bind(fs);
    t.mock.method(fs, "open", async (...args) => {
      const handle = await nativeOpen(...args);
      if (args[1] === "r+") return handle;
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      t.mock.method(handle, "read", async (...readArgs) => {
        const result = await read(...readArgs);
        if (!changed) {
          changed = true;
          await fs.chmod(file, 0o600);
          await change(file);
          await fs.chmod(file, 0o444);
        }
        return result;
      });
      t.mock.method(handle, "close", async () => { closes++; return close(); });
      return handle;
    });
    await controlled(captureManagedArchive(file, "postgres"));
    assert.equal(changed, true);
    assert.equal(closes, 1);
  });
}

for (const failure of ["read", "early EOF", "initial fstat", "final fstat", "close"]) {
  test(`managed archive fails closed on ${failure} and explicitly closes the handle`, linux, async (t) => {
    const { file } = await fixture(t);
    let closes = 0, stats = 0;
    observeOpen(t, (handle) => {
      const close = handle.close.bind(handle), stat = handle.stat.bind(handle);
      t.mock.method(handle, "close", async () => { closes++; await close(); if (failure === "close") throw new Error("synthetic close failure"); });
      if (failure === "read") t.mock.method(handle, "read", async () => { throw new Error("synthetic read failure"); });
      if (failure === "early EOF") t.mock.method(handle, "read", async () => ({ bytesRead: 0 }));
      t.mock.method(handle, "stat", async (...args) => {
        stats++;
        if ((failure === "initial fstat" && stats === 1) || (failure === "final fstat" && stats === 2)) throw new Error("synthetic stat failure");
        return stat(...args);
      });
    });
    await controlled(captureManagedArchive(file, "postgres"));
    assert.equal(closes, 1);
  });
}

test("managed archive rejects a Unix socket without opening a stream", linux, async (t) => {
  const { file } = await fixture(t);
  await fs.unlink(file);
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(file, resolve); });
    await controlled(captureManagedArchive(file, "postgres"));
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("managed archive rejects a FIFO and a FIFO substituted before open without blocking", linux, async (t) => {
  const { file } = await fixture(t);
  const probe = spawnSync("mkfifo", ["--version"], { timeout: 2000, encoding: "utf8", maxBuffer: 4096 });
  if (probe.error?.code === "ENOENT") { t.skip("Standard mkfifo is unavailable; no FIFO tool is installed."); return; }
  assert.equal(probe.status, 0);
  const fifo = () => {
    const result = spawnSync("mkfifo", ["--", file], { timeout: 2000, encoding: "utf8", maxBuffer: 4096 });
    assert.equal(result.status, 0, result.stderr);
  };
  await fs.unlink(file);
  fifo();
  await controlled(captureManagedArchive(file, "postgres"));
  await fs.unlink(file);
  await fs.writeFile(file, "regular", { flag: "wx", mode: 0o444 });
  const nativeOpen = fs.open.bind(fs);
  let observedFlags;
  t.mock.method(fs, "open", async (...args) => {
    observedFlags = args[1];
    assert.equal(observedFlags & constants.O_NONBLOCK, constants.O_NONBLOCK);
    await fs.unlink(file);
    fifo();
    return nativeOpen(...args);
  });
  await controlled(captureManagedArchive(file, "postgres"));
  assert.equal(observedFlags & constants.O_NONBLOCK, constants.O_NONBLOCK);
});
