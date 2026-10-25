import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const CAPS = new Map([["postgres", 2 * GiB], ["opensearch", 4 * GiB], ["aws-cli", 2 * GiB]]);
const IDENTITY = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const fail = (code) => { throw new Error(code); };
const keysAre = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function archiveArguments(file, role, options) {
  if (typeof role !== "string" || !CAPS.has(role) || typeof file !== "string" || !path.isAbsolute(file) ||
      /[\0,\r\n]/u.test(file) || path.resolve(file) !== file || path.basename(file) !== `managed-image-${role}.tar` ||
      options === null || typeof options !== "object" || Array.isArray(options) ||
      Object.keys(options).some((key) => key !== "cap")) fail("scanner_managed_archive_arguments_invalid");
  const cap = Object.hasOwn(options, "cap") ? options.cap : CAPS.get(role);
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > CAPS.get(role)) fail("scanner_managed_archive_arguments_invalid");
  return cap;
}

function checkedIdentity(stats, uid, cap) {
  if (!IDENTITY.every((key) => typeof stats[key] === "bigint") || !stats.isFile() || stats.isSymbolicLink() ||
      stats.nlink !== 1n || stats.uid !== uid || (stats.mode & 0o222n) !== 0n || stats.size < 1n || stats.size > BigInt(cap)) {
    fail("scanner_managed_archive_invalid");
  }
  return Object.fromEntries(IDENTITY.map((key) => [key, stats[key].toString()]));
}

function assertSameIdentity(actual, expected) {
  if (IDENTITY.some((key) => actual[key] !== expected[key])) fail("scanner_managed_archive_changed");
}

export async function captureManagedArchive(file, role, options = {}) {
  const cap = archiveArguments(file, role, options);
  if (process.platform !== "linux" || typeof process.getuid !== "function" || typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW === 0 ||
      typeof constants.O_NONBLOCK !== "number" || constants.O_NONBLOCK === 0) fail("scanner_managed_archive_requires_linux");
  const runnerUid = process.getuid();
  if (!Number.isSafeInteger(runnerUid) || runnerUid < 0) fail("scanner_managed_archive_requires_linux");
  const uid = BigInt(runnerUid);
  let handle;
  try {
    if (await fs.realpath(file) !== file) fail("scanner_managed_archive_invalid");
    const initial = checkedIdentity(await fs.lstat(file, { bigint: true }), uid, cap);
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    assertSameIdentity(checkedIdentity(await handle.stat({ bigint: true }), uid, cap), initial);
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(MiB);
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length) fail("scanner_managed_archive_invalid");
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > cap || BigInt(size) > BigInt(initial.size)) fail("scanner_managed_archive_changed");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (BigInt(size) !== BigInt(initial.size)) fail("scanner_managed_archive_changed");
    assertSameIdentity(checkedIdentity(await handle.stat({ bigint: true }), uid, cap), initial);
    assertSameIdentity(checkedIdentity(await fs.lstat(file, { bigint: true }), uid, cap), initial);
    if (await fs.realpath(file) !== file) fail("scanner_managed_archive_changed");
    return Object.freeze({ path: file, role, cap, size, sha256: hash.digest("hex"), identity: Object.freeze(initial) });
  } catch (error) {
    if (error instanceof Error && /^scanner_managed_archive_[a-z_]+$/u.test(error.message)) throw error;
    fail("scanner_managed_archive_invalid");
  } finally {
    if (handle) {
      try { await handle.close(); } catch { fail("scanner_managed_archive_close_failed"); }
    }
  }
}

export async function assertManagedArchiveUnchanged(snapshot) {
  if (!keysAre(snapshot, ["path", "role", "cap", "size", "sha256", "identity"]) ||
      !Number.isSafeInteger(snapshot.cap) || snapshot.cap < 1 || !Number.isSafeInteger(snapshot.size) || snapshot.size < 1 || snapshot.size > snapshot.cap ||
      typeof snapshot.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(snapshot.sha256) || !keysAre(snapshot.identity, IDENTITY) ||
      IDENTITY.some((key) => typeof snapshot.identity[key] !== "string" || !/^-?(?:0|[1-9]\d{0,31})$/u.test(snapshot.identity[key])) ||
      snapshot.identity.size !== String(snapshot.size)) fail("scanner_managed_archive_snapshot_invalid");
  const observed = await captureManagedArchive(snapshot.path, snapshot.role, { cap: snapshot.cap });
  if (observed.size !== snapshot.size || observed.sha256 !== snapshot.sha256) fail("scanner_managed_archive_changed");
  assertSameIdentity(observed.identity, snapshot.identity);
  return true;
}
