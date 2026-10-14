import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync,
  realpathSync, readdirSync, statfsSync, unlinkSync, writeSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, types } from "node:util";
import { crc32 } from "node:zlib";

import {
  candidateContractV2, openCandidateLockV2, validateCandidateContextV2,
} from "./gosu-derivative-candidate-v2.mjs";
import { scanRawUstar as scanPreparationUstarV1 } from "./gosu-derivative-archives-v1.mjs";
import { GOSU_PUBLIC_FILES_V1 } from "./gosu-derivative-controls-v1.mjs";
import { scanRawUstar as scanSeaweedRawUstar } from "../seaweed-image/archive.mjs";

const MiB = 1024 ** 2;
const BLOCK = 512;
const ZIP_LIMIT = 136 * MiB;
const INPUT_TAR_LIMIT = 132 * MiB;
const INPUT_MEMBER_LIMIT = 64 * MiB;
const INPUT_EXPANDED_LIMIT = 128 * MiB;
const BINARY_LIMIT = 64 * MiB;
const BODY_LIMIT = 65 * MiB;
const OUTPUT_LIMIT = 66 * MiB;
const DOCUMENT_LIMIT = 256 * 1024;
const EVIDENCE_LIMIT = MiB;
const RECIPE_LIMIT = 4096;
const READ_CHUNK = MiB;
const ORIGINAL_ZIP_IDENTITY = Object.freeze({ bytes: 105_074_334, sha256: "8b6e5b2bf25263eb5d88beb29a14a0ce94f04e84532545b5f4b67c420d0b485c" });
const ORIGINAL_TAR_IDENTITY = Object.freeze({ bytes: 105_074_176, sha256: "60225c765c783733e729694110878d1265dcd5a6f977c3ad8db101cc34bc50d8" });
const ORIGINAL_CRC32 = "4b368a3f";
const LOCK_IDENTITY = Object.freeze({ bytes: 7276, sha256: "34d6affcc89c60fae029831ac9569ca3967e65c542b4ba62817797843f43e031" });
const ZIP_NAME = "gosu-preparation-1.tar";
const HEX64 = /^[0-9a-f]{64}$/u;
const HEX8 = /^[0-9a-f]{8}$/u;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
const typedByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const arrayBufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const typedSet = Uint8Array.prototype.set;

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "../..");
const originalFile = path.join(repoRoot, ".omx", "gosu-real-preparation-run38485260984-v5", "gosu-preparation-1-original.zip");
const lockFile = path.join(repoRoot, "infra", "postgres-image", "gosu-derivative-candidate-lock-v2.json");
const outputRoot = "/home/autoworld/auto-world-private-contexts";
const childName = "gosu-candidate-context-v2";

const CODES = Object.freeze({
  identity: "gosu_candidate_context_identity_invalid",
  zip: "gosu_candidate_context_zip_profile_invalid",
  tar: "gosu_candidate_context_tar_profile_invalid",
  payload: "gosu_candidate_context_payload_invalid",
  owned: "gosu_candidate_context_owned_target_invalid",
  write: "gosu_candidate_context_write_failed",
});

const CONTEXT_PATHS = Object.freeze([
  "Dockerfile",
  "gosu",
  "auto-world-gosu",
  "auto-world-gosu/gosu-LICENSE",
  "auto-world-gosu/moby-user-LICENSE",
  "auto-world-gosu/go-LICENSE",
  "auto-world-gosu/go-PATENTS",
  "auto-world-gosu/x-sys-LICENSE",
  "auto-world-gosu/x-sys-PATENTS",
  "auto-world-gosu/notices.json",
  "auto-world-gosu/module-closure.json",
  "auto-world-gosu/sbom.cdx.json",
  "auto-world-gosu/version.txt",
  "auto-world-gosu/build-info.txt",
  "auto-world-gosu/derivative-manifest.json",
]);

function fail(code) { throw new Error(code); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function identity(bytes) { return Object.freeze({ bytes: bytes.length, sha256: hash(bytes) }); }
function canonical(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === "object" && !Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)])));
  }
  return value;
}
function plain(value) {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== null && Object.getPrototypeOf(prototype) === null;
}
function exactRecord(value, keys) {
  if (!plain(value)) return false;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some((name) => typeof name !== "string" || !keys.includes(name))) return false;
  return names.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, "value"));
  });
}
function denseArray(value, length) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value)) return false;
  const names = Reflect.ownKeys(value);
  if (names.length !== length + 1 || !names.includes("length")) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value !== length) return false;
  return Array.from({ length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
    .every((item) => item?.enumerable && Object.hasOwn(item, "value"));
}
function validIdentity(value, maximum, positive = true) {
  return exactRecord(value, ["bytes", "sha256"])
    && Number.isSafeInteger(value.bytes) && value.bytes >= (positive ? 1 : 0) && value.bytes <= maximum
    && typeof value.sha256 === "string" && HEX64.test(value.sha256);
}
function nativeCopy(value, cap, code) {
  if (value === null || typeof value !== "object" || types.isProxy(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Buffer.prototype && prototype !== Uint8Array.prototype) fail(code);
  let length; let offset; let backing;
  try {
    length = typedByteLength.call(value);
    offset = typedByteOffset.call(value);
    backing = typedBuffer.call(value);
    if (types.isSharedArrayBuffer(backing) || arrayBufferResizable?.call(backing) === true) fail(code);
    const backingLength = arrayBufferByteLength.call(backing);
    new DataView(backing);
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset) || offset < 0 || offset + length > backingLength || length > cap) fail(code);
  } catch { fail(code); }
  const result = Buffer.allocUnsafeSlow(length);
  try { typedSet.call(result, value); } catch { fail(code); }
  return result;
}
function sameBytes(actual, expected) { return actual.length === expected.length && actual.equals(expected); }
function expectBytes(bytes, offset, expected, code) {
  if (offset < 0 || offset + expected.length > bytes.length || !sameBytes(bytes.subarray(offset, offset + expected.length), expected)) fail(code);
}
function expectZero(bytes, offset, length, code) {
  if (offset < 0 || offset + length > bytes.length || bytes.subarray(offset, offset + length).some(Boolean)) fail(code);
}
function uint16(bytes, offset, code) { if (offset + 2 > bytes.length) fail(code); return bytes.readUInt16LE(offset); }
function uint32(bytes, offset, code) { if (offset + 4 > bytes.length) fail(code); return bytes.readUInt32LE(offset); }
function crcHex(bytes) { return Number(crc32(bytes)).toString(16).padStart(8, "0"); }

function validateStoredZipIdentity(expectedIdentity) {
  if (!exactRecord(expectedIdentity, ["zip", "tar", "crc32"])
    || !validIdentity(expectedIdentity.zip, ZIP_LIMIT)
    || !validIdentity(expectedIdentity.tar, INPUT_TAR_LIMIT)
    || typeof expectedIdentity.crc32 !== "string" || !HEX8.test(expectedIdentity.crc32)
    || expectedIdentity.zip.bytes !== expectedIdentity.tar.bytes + 158) fail(CODES.identity);
}

export function parseStoredPreparationZipV2(nativeBytes, expectedIdentity) {
  validateStoredZipIdentity(expectedIdentity);
  const bytes = nativeCopy(nativeBytes, ZIP_LIMIT, CODES.identity);
  if (bytes.length !== expectedIdentity.zip.bytes || hash(bytes) !== expectedIdentity.zip.sha256) fail(CODES.identity);
  const name = Buffer.from(ZIP_NAME, "ascii");
  const dataOffset = 30 + name.length;
  const descriptorOffset = dataOffset + expectedIdentity.tar.bytes;
  const centralOffset = descriptorOffset + 16;
  const eocdOffset = centralOffset + 46 + name.length;
  if (dataOffset !== 52 || eocdOffset + 22 !== bytes.length) fail(CODES.zip);

  if (uint32(bytes, 0, CODES.zip) !== 0x04034b50 || uint16(bytes, 4, CODES.zip) !== 20
    || uint16(bytes, 6, CODES.zip) !== 8 || uint16(bytes, 8, CODES.zip) !== 0
    || uint16(bytes, 10, CODES.zip) !== 48292 || uint16(bytes, 12, CODES.zip) !== 23885
    || uint32(bytes, 14, CODES.zip) !== 0 || uint32(bytes, 18, CODES.zip) !== 0 || uint32(bytes, 22, CODES.zip) !== 0
    || uint16(bytes, 26, CODES.zip) !== name.length || uint16(bytes, 28, CODES.zip) !== 0) fail(CODES.zip);
  expectBytes(bytes, 30, name, CODES.zip);

  if (uint32(bytes, descriptorOffset, CODES.zip) !== 0x08074b50
    || bytes.subarray(descriptorOffset + 4, descriptorOffset + 8).toString("hex") !== expectedIdentity.crc32.match(/../gu).reverse().join("")
    || uint32(bytes, descriptorOffset + 8, CODES.zip) !== expectedIdentity.tar.bytes
    || uint32(bytes, descriptorOffset + 12, CODES.zip) !== expectedIdentity.tar.bytes) fail(CODES.zip);

  if (uint32(bytes, centralOffset, CODES.zip) !== 0x02014b50 || uint16(bytes, centralOffset + 4, CODES.zip) !== 0x032d
    || uint16(bytes, centralOffset + 6, CODES.zip) !== 20 || uint16(bytes, centralOffset + 8, CODES.zip) !== 8
    || uint16(bytes, centralOffset + 10, CODES.zip) !== 0 || uint16(bytes, centralOffset + 12, CODES.zip) !== 48292
    || uint16(bytes, centralOffset + 14, CODES.zip) !== 23885
    || uint32(bytes, centralOffset + 16, CODES.zip) !== Number.parseInt(expectedIdentity.crc32, 16)
    || uint32(bytes, centralOffset + 20, CODES.zip) !== expectedIdentity.tar.bytes
    || uint32(bytes, centralOffset + 24, CODES.zip) !== expectedIdentity.tar.bytes
    || uint16(bytes, centralOffset + 28, CODES.zip) !== name.length
    || uint16(bytes, centralOffset + 30, CODES.zip) !== 0 || uint16(bytes, centralOffset + 32, CODES.zip) !== 0
    || uint16(bytes, centralOffset + 34, CODES.zip) !== 0 || uint16(bytes, centralOffset + 36, CODES.zip) !== 0
    || uint32(bytes, centralOffset + 38, CODES.zip) !== 0x81800020
    || uint32(bytes, centralOffset + 42, CODES.zip) !== 0) fail(CODES.zip);
  expectBytes(bytes, centralOffset + 46, name, CODES.zip);

  if (uint32(bytes, eocdOffset, CODES.zip) !== 0x06054b50 || uint16(bytes, eocdOffset + 4, CODES.zip) !== 0
    || uint16(bytes, eocdOffset + 6, CODES.zip) !== 0 || uint16(bytes, eocdOffset + 8, CODES.zip) !== 1
    || uint16(bytes, eocdOffset + 10, CODES.zip) !== 1 || uint32(bytes, eocdOffset + 12, CODES.zip) !== 46 + name.length
    || uint32(bytes, eocdOffset + 16, CODES.zip) !== centralOffset || uint16(bytes, eocdOffset + 20, CODES.zip) !== 0) fail(CODES.zip);

  const tarBytes = Buffer.allocUnsafeSlow(expectedIdentity.tar.bytes);
  bytes.copy(tarBytes, 0, dataOffset, descriptorOffset);
  const tarIdentity = identity(tarBytes);
  if (!isDeepStrictEqual(tarIdentity, expectedIdentity.tar) || crcHex(tarBytes) !== expectedIdentity.crc32) fail(CODES.identity);
  return freeze({
    tarBytes,
    tarIdentity,
    profile: {
      kind: "GOSU_PREPARATION_STORED_ZIP_PROFILE_V2", name: ZIP_NAME, flags: 8, method: 0,
      localOffset: 0, dataOffset, descriptorOffset, centralOffset, eocdOffset,
      localBytes: dataOffset, descriptorBytes: 16, centralBytes: 46 + name.length, eocdBytes: 22,
    },
  });
}

function expectedEntryShape(entry, index) {
  const expectedPath = CONTEXT_PATHS[index];
  const directory = index === 2;
  const keys = directory
    ? ["path", "type", "mode", "uid", "gid", "mtime", "size"]
    : ["path", "type", "mode", "uid", "gid", "mtime", "size", "sha256", "body"];
  if (!exactRecord(entry, keys) || entry.path !== expectedPath || entry.type !== (directory ? "directory" : "file")
    || entry.mode !== (index === 1 || directory ? 0o755 : 0o644) || entry.uid !== 0 || entry.gid !== 0 || entry.mtime !== 0
    || !Number.isSafeInteger(entry.size) || entry.size < 0) fail(CODES.payload);
  if (directory) { if (entry.size !== 0) fail(CODES.payload); return { ...entry }; }
  const cap = index === 0 ? RECIPE_LIMIT : index === 1 ? BINARY_LIMIT : DOCUMENT_LIMIT;
  if (entry.size < 1 || entry.size > cap || typeof entry.sha256 !== "string" || !HEX64.test(entry.sha256)) fail(CODES.payload);
  const body = nativeCopy(entry.body, cap, CODES.payload);
  if (body.length !== entry.size || hash(body) !== entry.sha256) fail(CODES.payload);
  return { path: entry.path, type: entry.type, mode: entry.mode, uid: 0, gid: 0, mtime: 0, size: entry.size, sha256: entry.sha256, body };
}
function snapshotContextEntries(entries) {
  if (!denseArray(entries, 15)) fail(CODES.payload);
  const result = entries.map(expectedEntryShape);
  const evidenceBytes = result.slice(3).reduce((sum, entry) => sum + entry.size, 0);
  const bodyBytes = result.reduce((sum, entry) => sum + entry.size, 0);
  if (evidenceBytes > EVIDENCE_LIMIT || bodyBytes > BODY_LIMIT) fail(CODES.payload);
  return result;
}
function tarOctal(value, digits, code = CODES.tar) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  const text = value.toString(8);
  if (text.length > digits) fail(code);
  return Buffer.from(`${text.padStart(digits, "0")}\0`, "ascii");
}
function checksumOctal(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0o777777) fail(CODES.tar);
  return Buffer.from(`${value.toString(8).padStart(6, "0")}\0 `, "ascii");
}
function makeCanonicalHeader(entry) {
  const name = Buffer.from(entry.path, "ascii");
  if (name.length !== entry.path.length || name.length > 99 || entry.path.includes("\0") || entry.path.endsWith("/")) fail(CODES.payload);
  const header = Buffer.alloc(BLOCK);
  name.copy(header, 0);
  tarOctal(entry.mode, 7).copy(header, 100);
  tarOctal(0, 7).copy(header, 108);
  tarOctal(0, 7).copy(header, 116);
  tarOctal(entry.size, 11).copy(header, 124);
  tarOctal(0, 11).copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = entry.type === "directory" ? 0x35 : 0x30;
  Buffer.from("ustar\0", "ascii").copy(header, 257);
  Buffer.from("00", "ascii").copy(header, 263);
  tarOctal(0, 7).copy(header, 329);
  tarOctal(0, 7).copy(header, 337);
  checksumOctal(header.reduce((sum, byte) => sum + byte, 0)).copy(header, 148);
  return header;
}

export function encodeCandidateContextUstarV2(entries) {
  const snapshot = snapshotContextEntries(entries);
  let total = BLOCK * 2;
  for (const entry of snapshot) total += BLOCK + (entry.type === "file" ? Math.ceil(entry.size / BLOCK) * BLOCK : 0);
  if (!Number.isSafeInteger(total) || total > OUTPUT_LIMIT) fail(CODES.payload);
  const tarBytes = Buffer.alloc(total);
  let offset = 0;
  for (const entry of snapshot) {
    makeCanonicalHeader(entry).copy(tarBytes, offset); offset += BLOCK;
    if (entry.type === "file") { entry.body.copy(tarBytes, offset); offset += Math.ceil(entry.size / BLOCK) * BLOCK; }
  }
  if (offset + BLOCK * 2 !== tarBytes.length) fail(CODES.tar);
  return Object.freeze({ tarBytes, identity: identity(tarBytes) });
}

function exactOctalField(bytes, offset, digits, value) {
  return sameBytes(bytes.subarray(offset, offset + digits + 1), tarOctal(value, digits));
}
function verifyHeaderIndependently(bytes, offset, entry) {
  const header = bytes.subarray(offset, offset + BLOCK);
  if (header.length !== BLOCK) fail(CODES.tar);
  const name = Buffer.from(entry.path, "ascii");
  if (!sameBytes(header.subarray(0, name.length), name) || header[name.length] !== 0) fail(CODES.tar);
  expectZero(header, name.length + 1, 100 - name.length - 1, CODES.tar);
  if (!exactOctalField(header, 100, 7, entry.mode) || !exactOctalField(header, 108, 7, 0)
    || !exactOctalField(header, 116, 7, 0) || !exactOctalField(header, 124, 11, entry.size)
    || !exactOctalField(header, 136, 11, 0) || header[156] !== (entry.type === "directory" ? 0x35 : 0x30)) fail(CODES.tar);
  const copy = Buffer.from(header); copy.fill(0x20, 148, 156);
  if (!sameBytes(header.subarray(148, 156), checksumOctal(copy.reduce((sum, byte) => sum + byte, 0)))) fail(CODES.tar);
  expectZero(header, 157, 100, CODES.tar);
  expectBytes(header, 257, Buffer.from("ustar\0", "ascii"), CODES.tar);
  expectBytes(header, 263, Buffer.from("00", "ascii"), CODES.tar);
  expectZero(header, 265, 64, CODES.tar);
  if (!exactOctalField(header, 329, 7, 0) || !exactOctalField(header, 337, 7, 0)) fail(CODES.tar);
  expectZero(header, 345, 167, CODES.tar);
}

function verifyCandidateContextUstarV2(nativeBytes, entries) {
  const snapshot = snapshotContextEntries(entries);
  const bytes = nativeCopy(nativeBytes, OUTPUT_LIMIT, CODES.tar);
  let expectedLength = BLOCK * 2;
  for (const entry of snapshot) expectedLength += BLOCK + (entry.type === "file" ? Math.ceil(entry.size / BLOCK) * BLOCK : 0);
  if (bytes.length !== expectedLength) fail(CODES.tar);
  let offset = 0;
  for (const entry of snapshot) {
    verifyHeaderIndependently(bytes, offset, entry); offset += BLOCK;
    if (entry.type === "file") {
      const body = bytes.subarray(offset, offset + entry.size);
      if (!sameBytes(body, entry.body) || hash(body) !== entry.sha256) fail(CODES.tar);
      const padded = Math.ceil(entry.size / BLOCK) * BLOCK;
      expectZero(bytes, offset + entry.size, padded - entry.size, CODES.tar);
      offset += padded;
    }
  }
  expectZero(bytes, offset, BLOCK * 2, CODES.tar);
  return Object.freeze({ identity: identity(bytes), entries: snapshot });
}

function snapshotNativeStatV2(stat) {
  if (stat === null || typeof stat !== "object") fail(CODES.owned);
  const keys = ["dev", "ino", "mode", "nlink", "size", "uid", "gid", "mtimeNs", "ctimeNs", "birthtimeNs"];
  const result = Object.fromEntries(keys.map((key) => {
    const value = stat[key];
    if (typeof value !== "bigint" || value < 0n) fail(CODES.owned);
    return [key, key === "mode" || key === "nlink" || key === "size" || key === "uid" || key === "gid" ? Number(value) : String(value)];
  }));
  if (["mode", "nlink", "size", "uid", "gid"].some((key) => !Number.isSafeInteger(result[key]))) fail(CODES.owned);
  return Object.freeze(result);
}
function sameNativeFile(left, right) { return isDeepStrictEqual(left, right); }
function sameExcept(left, right, allowed) {
  return Object.keys(left).every((key) => allowed.includes(key) || left[key] === right[key]);
}
function isRegular(stat) { return typeof stat.isFile === "function" && stat.isFile() && !stat.isSymbolicLink(); }
function isDirectory(stat) { return typeof stat.isDirectory === "function" && stat.isDirectory() && !stat.isSymbolicLink(); }

function closeQuietly(io, fd) { if (fd !== undefined) try { io.closeSync(fd); } catch { /* retained failure path */ } }
function closeStrict(io, fd, code = CODES.write) { try { io.closeSync(fd); } catch { fail(code); } }
function makeDirectorySessionV2(io, file, { privateRoot = false, output = false, allowWorldWrite = false } = {}) {
  let named;
  try { named = io.lstatSync(file, { bigint: true }); } catch { fail(CODES.owned); }
  if (!isDirectory(named) || io.realpathSync(file) !== file) fail(CODES.owned);
  const initial = snapshotNativeStatV2(named);
  if ((initial.mode & 0o6000) !== 0 || (!privateRoot && !allowWorldWrite && (initial.mode & 0o0022) !== 0)) fail(CODES.owned);
  if (privateRoot && (initial.mode & 0o7777) !== 0o700) fail(CODES.owned);
  if (output && (initial.uid !== 1000 || initial.gid !== 1000 || io.statfsSync(file, { bigint: true }).type !== 0xef53n)) fail(CODES.owned);
  let fd;
  try { fd = io.openSync(file, io.constants.O_RDONLY | io.constants.O_DIRECTORY | io.constants.O_NOFOLLOW); } catch { fail(CODES.owned); }
  let expected = initial; let closed = false;
  const guard = () => {
    if (closed) fail(CODES.owned);
    let pathStat; let fdStat;
    try { pathStat = io.lstatSync(file, { bigint: true }); fdStat = io.fstatSync(fd, { bigint: true }); } catch { fail(CODES.owned); }
    if (!isDirectory(pathStat) || !isDirectory(fdStat) || io.realpathSync(file) !== file) fail(CODES.owned);
    const pathSnapshot = snapshotNativeStatV2(pathStat); const fdSnapshot = snapshotNativeStatV2(fdStat);
    if (!sameNativeFile(pathSnapshot, fdSnapshot) || !sameNativeFile(pathSnapshot, expected)) fail(CODES.owned);
    return pathSnapshot;
  };
  const refresh = (allowed) => {
    if (!Array.isArray(allowed) || allowed.some((key) => !["mtimeNs", "ctimeNs", "nlink"].includes(key))) fail(CODES.owned);
    let pathStat; let fdStat;
    try { pathStat = io.lstatSync(file, { bigint: true }); fdStat = io.fstatSync(fd, { bigint: true }); } catch { fail(CODES.owned); }
    const current = snapshotNativeStatV2(pathStat); const held = snapshotNativeStatV2(fdStat);
    if (!isDirectory(pathStat) || !isDirectory(fdStat) || io.realpathSync(file) !== file || !sameNativeFile(current, held)) fail(CODES.owned);
    for (const key of Object.keys(expected)) if (!allowed.includes(key) && current[key] !== expected[key]) fail(CODES.owned);
    expected = current;
    return current;
  };
  return { file, fd, guard, refresh, close: () => { if (closed) return; io.closeSync(fd); closed = true; } };
}
function assertAncestorDirectoriesV2(io, file, { allowWorldWrite = false } = {}) {
  const resolved = path.resolve(file);
  if (resolved !== file) fail(CODES.owned);
  const parsed = path.parse(resolved); let cursor = parsed.root;
  const sessions = [makeDirectorySessionV2(io, cursor, { allowWorldWrite })];
  for (const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    sessions.push(makeDirectorySessionV2(io, cursor, { allowWorldWrite }));
  }
  return sessions;
}
function guardSessions(sessions) { for (const session of sessions) session.guard(); }
function closeSessions(sessions) { let failed = false; while (sessions.length) { const session = sessions.pop(); try { session.close(); } catch { failed = true; } } if (failed) fail(CODES.write); }
function closeSessionsQuietly(sessions) { while (sessions.length) try { sessions.pop().close(); } catch { /* already failed */ } }

function fileSnapshotV2(io, file, fd, expected, { output = false } = {}) {
  let named; let opened;
  try { named = io.lstatSync(file, { bigint: true }); opened = io.fstatSync(fd, { bigint: true }); } catch { fail(output ? CODES.write : CODES.owned); }
  if (!isRegular(named) || !isRegular(opened) || io.realpathSync(file) !== file) fail(output ? CODES.write : CODES.owned);
  const left = snapshotNativeStatV2(named); const right = snapshotNativeStatV2(opened);
  if (!sameNativeFile(left, right) || left.nlink !== 1 || left.size !== expected.bytes
    || output && (left.uid !== 1000 || left.gid !== 1000 || (left.mode & 0o7777) !== 0o600)
    || !output && (left.uid !== 1000 || left.gid !== 1000)) fail(output ? CODES.write : CODES.owned);
  return left;
}
function readExactHeldV2(io, item, code) {
  const before = fileSnapshotV2(io, item.file, item.fd, item.expected, { output: item.output });
  const bytes = Buffer.alloc(item.expected.bytes); let offset = 0;
  while (offset < bytes.length) {
    let count; try { count = io.readSync(item.fd, bytes, offset, Math.min(READ_CHUNK, bytes.length - offset), offset); } catch { fail(code); }
    if (!Number.isSafeInteger(count) || count < 1) fail(code); offset += count;
  }
  const extra = Buffer.alloc(1); let trailing;
  try { trailing = io.readSync(item.fd, extra, 0, 1, bytes.length); } catch { fail(code); }
  if (trailing !== 0 || hash(bytes) !== item.expected.sha256) fail(code);
  const after = fileSnapshotV2(io, item.file, item.fd, item.expected, { output: item.output });
  if (!sameNativeFile(before, after)) fail(code);
  return bytes;
}
function writeAllV2(io, fd, bytes, code) {
  let offset = 0;
  while (offset < bytes.length) {
    let count; try { count = io.writeSync(fd, bytes, offset, Math.min(READ_CHUNK, bytes.length - offset), offset); } catch { fail(code); }
    if (!Number.isSafeInteger(count) || count < 1) fail(code); offset += count;
  }
}

function writeDurableFileV2(io, directorySession, file, bytes, code = CODES.write) {
  directorySession.guard();
  const body = nativeCopy(bytes, OUTPUT_LIMIT, code);
  const expected = identity(body); let fd;
  try { fd = io.openSync(file, io.constants.O_RDWR | io.constants.O_CREAT | io.constants.O_EXCL | io.constants.O_NOFOLLOW, 0o600); } catch { fail(code); }
  const item = { file, fd, expected, output: true };
  try {
    const initial = snapshotNativeStatV2(io.fstatSync(fd, { bigint: true }));
    if (initial.size !== 0 || initial.nlink !== 1 || initial.uid !== 1000 || initial.gid !== 1000 || (initial.mode & 0o7777) !== 0o600) fail(code);
    directorySession.refresh(["mtimeNs", "ctimeNs"]);
    writeAllV2(io, fd, body, code); io.fsyncSync(fd);
    if (!readExactHeldV2(io, item, code).equals(body)) fail(code);
    directorySession.guard();
    return item;
  } catch (error) {
    closeQuietly(io, fd);
    if (error?.message === code) throw error;
    fail(code);
  }
}
function closeAndReadbackV2(io, directorySession, item, body, code = CODES.write) {
  closeStrict(io, item.fd, code); item.fd = undefined; directorySession.guard();
  let fd;
  try { fd = io.openSync(item.file, io.constants.O_RDONLY | io.constants.O_NOFOLLOW); } catch { fail(code); }
  try {
    const reopened = { ...item, fd };
    if (!readExactHeldV2(io, reopened, code).equals(body)) fail(code);
  } finally { closeStrict(io, fd, code); }
}
function promotePartialV2(io, directorySession, partialItem, finalPath) {
  directorySession.guard();
  const before = fileSnapshotV2(io, partialItem.file, partialItem.fd, partialItem.expected, { output: true });
  try { io.linkSync(partialItem.file, finalPath); } catch { fail(CODES.write); }
  directorySession.refresh(["mtimeNs", "ctimeNs"]);
  const partial = snapshotNativeStatV2(io.lstatSync(partialItem.file, { bigint: true }));
  const final = snapshotNativeStatV2(io.lstatSync(finalPath, { bigint: true }));
  const held = snapshotNativeStatV2(io.fstatSync(partialItem.fd, { bigint: true }));
  if (!sameNativeFile(partial, final) || !sameNativeFile(partial, held)
    || !sameExcept(before, partial, ["ctimeNs", "nlink"]) || partial.nlink !== 2) fail(CODES.write);
  try { io.fsyncSync(directorySession.fd); io.unlinkSync(partialItem.file); } catch { fail(CODES.write); }
  directorySession.refresh(["mtimeNs", "ctimeNs"]);
  const finalAfter = snapshotNativeStatV2(io.lstatSync(finalPath, { bigint: true }));
  const heldAfter = snapshotNativeStatV2(io.fstatSync(partialItem.fd, { bigint: true }));
  if (!sameNativeFile(finalAfter, heldAfter) || !sameExcept(before, finalAfter, ["ctimeNs", "nlink"])
    || finalAfter.nlink !== 1) fail(CODES.write);
  try { io.fsyncSync(directorySession.fd); io.fsyncSync(partialItem.fd); } catch { fail(CODES.write); }
  const body = readExactHeldV2(io, { ...partialItem, file: finalPath }, CODES.write);
  closeStrict(io, partialItem.fd); partialItem.fd = undefined;
  let finalFd;
  try { finalFd = io.openSync(finalPath, io.constants.O_RDONLY | io.constants.O_NOFOLLOW); } catch { fail(CODES.write); }
  try { if (!readExactHeldV2(io, { file: finalPath, fd: finalFd, expected: partialItem.expected, output: true }, CODES.write).equals(body)) fail(CODES.write); }
  finally { closeStrict(io, finalFd); }
  return Object.freeze({ body, identity: partialItem.expected, physical: finalAfter });
}

function chunks(bytes) {
  return (function* makeChunks() { for (let offset = 0; offset < bytes.length; offset += READ_CHUNK) yield bytes.subarray(offset, Math.min(bytes.length, offset + READ_CHUNK)); }());
}
function projectForContractA(entries) {
  return { entries: entries.map((entry) => entry.type === "directory"
    ? { path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime }
    : { path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime, body: entry.body }) };
}
function fixedPreparationPathForContext(contextPath) {
  if (contextPath === "gosu") return "gosu";
  if (!contextPath.startsWith("auto-world-gosu/")) fail(CODES.payload);
  const name = contextPath.slice("auto-world-gosu/".length);
  if (["gosu-LICENSE", "moby-user-LICENSE", "go-LICENSE", "go-PATENTS", "x-sys-LICENSE", "x-sys-PATENTS", "notices.json"].includes(name)) return `licenses/${name}`;
  if (["module-closure.json", "sbom.cdx.json", "version.txt", "build-info.txt"].includes(name)) return name;
  fail(CODES.payload);
}
function runtimeGuardV2(io) {
  const runtime = io.runtime();
  if (!exactRecord(runtime, ["platform", "version", "uid", "euid", "gid", "egid", "nodeOptions", "nodePath"])
    || runtime.platform !== "linux" || runtime.version !== "v22.23.2"
    || runtime.uid !== 1000 || runtime.euid !== 1000 || runtime.gid !== 1000 || runtime.egid !== 1000
    || runtime.nodeOptions !== undefined || runtime.nodePath !== undefined) fail(CODES.owned);
}
function inventoryV2(io, directory) {
  try { return [...io.readdirSync(directory)].sort((a, b) => a.localeCompare(b, "en")); } catch { return []; }
}
function retainedStateV2(io, directory) {
  const names = inventoryV2(io, directory); const known = ["claim.json", "context.tar.partial", "context.tar", "success.json", "failure.json"];
  return { claim: names.includes("claim.json"), partial: names.includes("context.tar.partial"), context: names.includes("context.tar"),
    success: names.includes("success.json"), failure: names.includes("failure.json"), unknownEntries: names.filter((name) => !known.includes(name)).length };
}

const DEFAULT_ADAPTERS = Object.freeze({
  constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, realpathSync,
  readdirSync, statfsSync, unlinkSync, writeSync,
  runtime: () => ({
    platform: process.platform, version: process.version, uid: process.getuid?.(), euid: process.geteuid?.(),
    gid: process.getgid?.(), egid: process.getegid?.(), nodeOptions: process.env.NODE_OPTIONS, nodePath: process.env.NODE_PATH,
  }),
  now: () => new Date().toISOString(),
  repoRoot, originalFile, lockFile, outputRoot, childName,
  openCandidateLockV2, candidateContractV2, validateCandidateContextV2,
  parseStoredPreparationZipV2, encodeCandidateContextUstarV2, verifyCandidateContextUstarV2,
  scanPreparationUstarV1, scanSeaweedRawUstar,
  readable: (bytes) => Readable.from(chunks(bytes)),
});
function adaptersV2(overrides) {
  if (overrides === undefined) return DEFAULT_ADAPTERS;
  if (!plain(overrides)) fail(CODES.owned);
  return Object.freeze({ ...DEFAULT_ADAPTERS, ...overrides });
}
function openOriginalV2(io, sessions) {
  guardSessions(sessions); let fd;
  try { fd = io.openSync(io.originalFile, io.constants.O_RDONLY | io.constants.O_NOFOLLOW); } catch { fail(CODES.owned); }
  const item = { file: io.originalFile, fd, expected: ORIGINAL_ZIP_IDENTITY, output: false };
  try { item.initial = fileSnapshotV2(io, item.file, item.fd, item.expected); } catch (error) { closeQuietly(io, fd); throw error; }
  return item;
}
function assertOriginalStableV2(io, item) {
  if (!item || item.fd === undefined || !sameNativeFile(fileSnapshotV2(io, item.file, item.fd, item.expected), item.initial)) fail(CODES.identity);
}
function contextEntriesFromContract(contract, selected) {
  return contract.contextEntries.map((expected) => {
    if (expected.type === "directory") return { ...expected };
    let body;
    if (expected.path === "Dockerfile") body = Buffer.from(contract.recipe.text, "utf8");
    else if (expected.path === "auto-world-gosu/derivative-manifest.json") body = Buffer.from(contract.manifest.text, "utf8");
    else body = selected.get(fixedPreparationPathForContext(expected.path));
    if (!Buffer.isBuffer(body)) fail(CODES.payload);
    return { ...expected, body };
  });
}
async function scanPreparationInputV2(io, tarBytes) {
  const selectedNames = new Set(["gosu", "module-closure.json", "sbom.cdx.json", "version.txt", "build-info.txt",
    "licenses/gosu-LICENSE", "licenses/moby-user-LICENSE", "licenses/go-LICENSE", "licenses/go-PATENTS",
    "licenses/x-sys-LICENSE", "licenses/x-sys-PATENTS", "licenses/notices.json"]);
  const selected = new Map();
  const limits = { members: 28, memberBytes: INPUT_MEMBER_LIMIT, totalBytes: INPUT_EXPANDED_LIMIT, depth: 8, pathBytes: 512 };
  let scanned;
  try {
    scanned = await io.scanPreparationUstarV1(tarBytes, limits, { onFile: async (entry, body) => {
      if (selectedNames.has(entry.path)) selected.set(entry.path, Buffer.from(body));
    } });
  } catch { fail(CODES.tar); }
  if (scanned.entries.length !== 28 || scanned.entries.some((entry) => entry.type !== "file")
    || scanned.entries.map((entry) => entry.path).sort().join("\0") !== [...GOSU_PUBLIC_FILES_V1].sort().join("\0")
    || selected.size !== selectedNames.size) fail(CODES.tar);
  return selected;
}
async function verifySeaweedV2(io, tarBytes, expectedEntries) {
  let scanned;
  try {
    scanned = await io.scanSeaweedRawUstar({
      input: io.readable(tarBytes), diffId: `sha256:${hash(tarBytes)}`, maxRawBytes: OUTPUT_LIMIT,
      maxMembers: 15, allowHardlinks: false,
    });
  } catch { fail(CODES.tar); }
  if (scanned.rawSize !== tarBytes.length || scanned.members.length !== 15) fail(CODES.tar);
  const actual = scanned.members.map(({ entry, uncompressedDataOffset }) => ({ entry, uncompressedDataOffset }));
  const observed = [];
  for (let index = 0; index < expectedEntries.length; index += 1) {
    const expected = expectedEntries[index]; const member = actual[index]; const entry = member?.entry;
    if (!entry || entry.path !== expected.path || entry.type !== expected.type || entry.mode !== expected.mode
      || entry.uid !== 0 || entry.gid !== 0 || entry.mtime !== 0 || entry.size !== expected.size
      || expected.type === "file" && entry.sha256 !== expected.sha256) fail(CODES.tar);
    if (expected.type === "directory") {
      observed.push({ path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime, size: entry.size });
    } else {
      const end = member.uncompressedDataOffset + entry.size;
      if (!Number.isSafeInteger(member.uncompressedDataOffset) || member.uncompressedDataOffset < 0 || end > tarBytes.length) fail(CODES.tar);
      observed.push({ path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime,
        size: entry.size, sha256: entry.sha256, body: tarBytes.subarray(member.uncompressedDataOffset, end) });
    }
  }
  return observed;
}
function claimValueV2(io) {
  return {
    kind: "POSTGRES_GOSU_CANDIDATE_CONTEXT_CLAIM_V2", state: "OPERATING", authority: "NOT_AUTHORIZED",
    scope: "SOURCE_CONTEXT_ONLY", createdAt: io.now(), node: "22.23.2",
    source: { zip: ORIGINAL_ZIP_IDENTITY, tar: ORIGINAL_TAR_IDENTITY, crc32: ORIGINAL_CRC32 }, lock: LOCK_IDENTITY,
  };
}
function failureValueV2(io, child, code) {
  return {
    kind: "POSTGRES_GOSU_CANDIDATE_CONTEXT_FAILURE_V2", state: "FAILED_RETAINED", authority: "NOT_AUTHORIZED",
    scope: "SOURCE_CONTEXT_ONLY", failedAt: io.now(), code, retained: retainedStateV2(io, child),
  };
}
function physicalDescriptorV2(role, snapshot) {
  return { role, uid: snapshot.uid, gid: snapshot.gid, mode: snapshot.mode & 0o7777, nlink: snapshot.nlink, size: snapshot.size };
}
function physicalReceiptV2(io, root, child, destination, claimIdentity, contextSnapshot) {
  const claimFile = path.join(destination, "claim.json"); let claimFd;
  try { claimFd = io.openSync(claimFile, io.constants.O_RDONLY | io.constants.O_NOFOLLOW); } catch { fail(CODES.write); }
  let claim;
  try { claim = fileSnapshotV2(io, claimFile, claimFd, claimIdentity, { output: true }); }
  finally { closeStrict(io, claimFd); }
  return {
    directories: [physicalDescriptorV2("outputRoot", root.guard()), physicalDescriptorV2("attempt", child.guard())],
    files: [physicalDescriptorV2("claim", claim), physicalDescriptorV2("context", contextSnapshot)],
  };
}
function logicalDescriptorsV2(entries) {
  return entries.map((entry) => entry.type === "directory"
    ? { path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime, size: entry.size }
    : { path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime,
      size: entry.size, sha256: entry.sha256 });
}
function successValueV2(io, contextIdentity, entries, predicate, physical) {
  return {
    kind: "POSTGRES_GOSU_CANDIDATE_CONTEXT_RECEIPT_V2", state: "CONTEXT_MATERIALIZED_REVIEW_PENDING",
    authority: "NOT_AUTHORIZED", scope: "SOURCE_CONTEXT_ONLY", image: "UNBUILT", completedAt: io.now(),
    supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null,
    acceptedInput: { zip: ORIGINAL_ZIP_IDENTITY, tar: ORIGINAL_TAR_IDENTITY, crc32: ORIGINAL_CRC32, lock: LOCK_IDENTITY },
    context: contextIdentity, logicalEntries: logicalDescriptorsV2(entries), physical,
    predicate: { status: "PASS", scope: predicate.scope, authority: predicate.authority, image: predicate.image,
      files: predicate.files, directories: predicate.directories,
      binary: predicate.binary, evidenceBytes: predicate.evidenceBytes, manifest: predicate.manifest, recipe: predicate.recipe },
    claims: { functionalValidation: "NOT_ESTABLISHED", vulnerabilityClearance: "NOT_ESTABLISHED", image: "UNBUILT",
      candidateAdmission: "NOT_AUTHORIZED" },
  };
}
function publishClosedDocumentV2(io, directory, file, value) {
  const bytes = Buffer.from(canonical(value));
  const item = writeDurableFileV2(io, directory, file, bytes, CODES.write);
  closeAndReadbackV2(io, directory, item, bytes, CODES.write);
  try { io.fsyncSync(directory.fd); } catch { fail(CODES.write); }
  directory.guard();
  return identity(bytes);
}
function retainFailureBestEffortV2(io, childSession, sessions, code) {
  const destination = path.join(io.outputRoot, io.childName); let root = sessions.find((session) => session.file === io.outputRoot);
  let childSessionValue = childSession; const opened = [];
  const publish = () => {
    publishClosedDocumentV2(io, childSessionValue, path.join(destination, "failure.json"), failureValueV2(io, destination, code));
    io.fsyncSync(childSessionValue.fd); io.fsyncSync(root.fd);
  };
  let usable = false;
  if (root) try { root.guard(); childSessionValue.guard(); usable = true; } catch { /* reopen before the sole receipt attempt */ }
  try {
    if (!usable) {
      root = makeDirectorySessionV2(io, io.outputRoot, { privateRoot: true, output: true }); opened.push(root);
      childSessionValue = makeDirectorySessionV2(io, destination, { privateRoot: true, output: true }); opened.push(childSessionValue);
    }
    publish();
  } catch { /* fixed stderr/transcript remains the authoritative failure */ }
  finally { closeSessionsQuietly(opened); }
}

async function materializeCandidateContextV2WithAdapters(overrides) {
  const io = adaptersV2(overrides);
  runtimeGuardV2(io);
  const allSessions = []; let child; let partial; let success = false; let original;
  try {
    const originalAncestors = assertAncestorDirectoriesV2(io, path.dirname(io.originalFile), { allowWorldWrite: true });
    allSessions.push(...originalAncestors);
    const outputAncestors = assertAncestorDirectoriesV2(io, path.dirname(io.outputRoot));
    allSessions.push(...outputAncestors);
    const root = makeDirectorySessionV2(io, io.outputRoot, { privateRoot: true, output: true }); allSessions.push(root);
    const destination = path.join(io.outputRoot, io.childName);
    try { io.lstatSync(destination, { bigint: true }); fail(CODES.owned); } catch (error) { if (error?.message === CODES.owned) throw error; if (error?.code !== "ENOENT") fail(CODES.owned); }
    root.guard();
    try { io.mkdirSync(destination, { mode: 0o700 }); } catch { fail(CODES.owned); }
    root.refresh(["mtimeNs", "ctimeNs", "nlink"]);
    child = makeDirectorySessionV2(io, destination, { privateRoot: true, output: true }); allSessions.push(child);

    const claimIdentity = publishClosedDocumentV2(io, child, path.join(destination, "claim.json"), claimValueV2(io));
    try { io.fsyncSync(child.fd); io.fsyncSync(root.fd); } catch { fail(CODES.write); }
    guardSessions(allSessions);

    original = openOriginalV2(io, originalAncestors);
    const originalBytes = readExactHeldV2(io, original, CODES.identity);
    assertOriginalStableV2(io, original);
    guardSessions(allSessions);
    const parsed = io.parseStoredPreparationZipV2(originalBytes, { zip: ORIGINAL_ZIP_IDENTITY, tar: ORIGINAL_TAR_IDENTITY, crc32: ORIGINAL_CRC32 });
    const selected = await scanPreparationInputV2(io, parsed.tarBytes);

    const lockBytes = (() => {
      let fd; try { fd = io.openSync(io.lockFile, io.constants.O_RDONLY | io.constants.O_NOFOLLOW); } catch { fail(CODES.identity); }
      try { return readExactHeldV2(io, { file: io.lockFile, fd, expected: LOCK_IDENTITY, output: false }, CODES.identity); }
      finally { closeStrict(io, fd, CODES.identity); }
    })();
    const handle = io.openCandidateLockV2(lockBytes); const contract = io.candidateContractV2(handle);
    const entries = contextEntriesFromContract(contract, selected);
    io.validateCandidateContextV2(handle, projectForContractA(entries));
    const encoded = io.encodeCandidateContextUstarV2(entries);
    const partialFile = path.join(destination, "context.tar.partial");
    partial = writeDurableFileV2(io, child, partialFile, encoded.tarBytes, CODES.write);
    try { io.fsyncSync(child.fd); } catch { fail(CODES.write); }
    const reread = readExactHeldV2(io, partial, CODES.write);
    io.verifyCandidateContextUstarV2(reread, entries);
    const observedEntries = await verifySeaweedV2(io, reread, entries);
    const predicate = io.validateCandidateContextV2(handle, projectForContractA(observedEntries));
    runtimeGuardV2(io); guardSessions(allSessions); assertOriginalStableV2(io, original);
    const promoted = promotePartialV2(io, child, partial, path.join(destination, "context.tar")); partial = undefined;
    assertOriginalStableV2(io, original);
    const physical = physicalReceiptV2(io, root, child, destination, claimIdentity, promoted.physical);
    publishClosedDocumentV2(io, child, path.join(destination, "success.json"),
      successValueV2(io, promoted.identity, observedEntries, predicate, physical));
    try { io.fsyncSync(child.fd); io.fsyncSync(root.fd); } catch { fail(CODES.write); }
    runtimeGuardV2(io); guardSessions(allSessions); assertOriginalStableV2(io, original);
    const inventory = inventoryV2(io, destination);
    if (inventory.join("\0") !== ["claim.json", "context.tar", "success.json"].sort().join("\0")) fail(CODES.write);
    closeStrict(io, original.fd); original.fd = undefined;
    closeSessions(allSessions);
    success = true;
    return freeze({ state: "CONTEXT_MATERIALIZED_REVIEW_PENDING", authority: "NOT_AUTHORIZED", context: promoted.identity, inventory });
  } catch (error) {
    const code = Object.values(CODES).includes(error?.message) ? error.message : CODES.write;
    if (child && !success) retainFailureBestEffortV2(io, child, allSessions, code);
    fail(code);
  } finally {
    if (original?.fd !== undefined) closeQuietly(io, original.fd);
    if (partial?.fd !== undefined) closeQuietly(io, partial.fd);
    closeSessionsQuietly(allSessions);
  }
}

export async function materializeCandidateContextV2(...arguments_) {
  if (arguments_.length !== 0) fail(CODES.owned);
  return materializeCandidateContextV2WithAdapters();
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptFile)) {
  if (process.argv.length !== 3 || process.argv[2] !== "--materialize") {
    process.stderr.write(`${CODES.owned}\n`); process.exitCode = 1;
  } else {
    materializeCandidateContextV2().then((result) => process.stdout.write(canonical(result))).catch((error) => {
      const code = Object.values(CODES).includes(error?.message) ? error.message : CODES.write;
      process.stderr.write(`${code}\n`); process.exitCode = 1;
    });
  }
}
