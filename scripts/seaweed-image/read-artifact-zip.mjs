import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { addAbortSignal, Readable, Transform, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";

import { validateArtifactAllowlist } from "../seaweed/build.mjs";

const EOCD_BYTES = 22;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER_BYTES = 30;
const DESCRIPTOR_BYTES = 16;
const MAX_ZIP_BYTES = 2 * 1024 ** 3;
const MAX_RAW_BYTES = 2 * 1024 ** 3;
const MAX_ENTRIES = 65_534;
const MAX_NAME_BYTES = 256;
const MAX_CENTRAL_BYTES = 20 * 1024 ** 2;
const CHUNK_BYTES = 1024 ** 2;
const MAX_JSON_ZIP_BYTES = 2 * 1024 ** 2;
const MAX_JSON_RAW_BYTES = 1024 ** 2;
const ZIP32_LIMIT = 0xffff_ffff;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ZIP_ERROR_CODES = new WeakMap();

export const githubArtifactZipProfiles = Object.freeze({
  build: "build",
  gate1: "gate-1",
  gate2: "gate-2",
  comparison: "comparison",
});

function zipError(code, cause) {
  const error = cause === undefined ? new Error(code) : new Error(code, { cause });
  ZIP_ERROR_CODES.set(error, code);
  return error;
}

function failed(error, entriesProcessed, verifiedBytes, signal) {
  const code = ZIP_ERROR_CODES.get(error)
    ?? (signal?.aborted === true && error?.name === "AbortError" ? "seaweed_artifact_zip_aborted" : "seaweed_artifact_zip_stream_invalid");
  const normalized = zipError(code, error);
  Object.defineProperties(normalized, {
    state: { value: "INCOMPLETE", enumerable: true },
    entriesProcessed: { value: entriesProcessed, enumerable: true },
    verifiedBytes: { value: verifiedBytes, enumerable: true },
  });
  return normalized;
}

function assertAbort(signal) {
  if (signal?.aborted === true) throw zipError("seaweed_artifact_zip_aborted", signal.reason);
}

function integer(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function canonicalPath(value) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "ascii") > MAX_NAME_BYTES
    || value.startsWith("/") || value.endsWith("/") || value.includes("\\") || value.includes(":") || value.includes("//")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

function profilePaths(profile, paths) {
  if (profile === githubArtifactZipProfiles.build) {
    try {
      validateArtifactAllowlist(paths);
    } catch (error) {
      throw zipError("seaweed_artifact_zip_profile_invalid", error);
    }
    return;
  }
  const expected = profile === githubArtifactZipProfiles.gate1 ? "seaweed-artifact-gate-1.json"
    : profile === githubArtifactZipProfiles.gate2 ? "seaweed-artifact-gate-2.json"
      : profile === githubArtifactZipProfiles.comparison ? "seaweed-comparison.json" : undefined;
  if (expected === undefined || paths.length !== 1 || paths[0] !== expected) throw zipError("seaweed_artifact_zip_profile_invalid");
}

function snapshotSource(source) {
  if (source === null || typeof source !== "object") {
    throw zipError("seaweed_artifact_zip_source_invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(source);
  if (!Object.hasOwn(descriptors, "size") || !Object.hasOwn(descriptors.size, "value")
    || !Object.hasOwn(descriptors, "readAt") || !Object.hasOwn(descriptors.readAt, "value")
    || !integer(descriptors.size.value, MAX_ZIP_BYTES) || typeof descriptors.readAt.value !== "function") {
    throw zipError("seaweed_artifact_zip_source_invalid");
  }
  return Object.freeze({ size: descriptors.size.value, readAt: descriptors.readAt.value.bind(source) });
}

function snapshotDescriptor(descriptor) {
  if (descriptor === null || typeof descriptor !== "object") throw zipError("seaweed_artifact_zip_descriptor_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(descriptor);
  if (!Object.hasOwn(descriptors, "size") || !Object.hasOwn(descriptors.size, "value")
    || !Object.hasOwn(descriptors, "digest") || !Object.hasOwn(descriptors.digest, "value")
    || !integer(descriptors.size.value, MAX_ZIP_BYTES) || !SHA256.test(descriptors.digest.value ?? "")) {
    throw zipError("seaweed_artifact_zip_descriptor_invalid");
  }
  return Object.freeze({ size: descriptors.size.value, digest: descriptors.digest.value });
}

async function readExact(source, position, length) {
  if (!integer(position, source.size) || !integer(length, CHUNK_BYTES) || position + length > source.size) {
    throw zipError("seaweed_artifact_zip_range_invalid");
  }
  let value;
  try {
    value = source.readAt(position, length);
    if (value?.then instanceof Function) value = await value;
  } catch (error) {
    throw zipError("seaweed_artifact_zip_source_read_failed", error);
  }
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw zipError("seaweed_artifact_zip_source_read_invalid");
  return Buffer.from(value);
}

async function readBounded(source, position, length, signal) {
  const chunks = [];
  for (let consumed = 0; consumed < length; consumed += CHUNK_BYTES) {
    assertAbort(signal);
    chunks.push(await readExact(source, position + consumed, Math.min(CHUNK_BYTES, length - consumed)));
    assertAbort(signal);
  }
  return Buffer.concat(chunks, length);
}

async function hashSource(source, signal) {
  const hash = createHash("sha256");
  for (let position = 0; position < source.size; position += CHUNK_BYTES) {
    assertAbort(signal);
    const chunk = await readExact(source, position, Math.min(CHUNK_BYTES, source.size - position));
    assertAbort(signal);
    hash.update(chunk);
  }
  assertAbort(signal);
  return `sha256:${hash.digest("hex")}`;
}

function parseMetadata(central, eocd, sourceSize) {
  const count = eocd.readUInt16LE(10);
  const centralSize = eocd.readUInt32LE(12);
  const centralOffset = eocd.readUInt32LE(16);
  if (eocd.readUInt32LE(0) !== 0x06054b50 || eocd.readUInt16LE(4) !== 0 || eocd.readUInt16LE(6) !== 0
    || eocd.readUInt16LE(8) !== count || count === 0 || count === 0xffff || count > MAX_ENTRIES
    || centralSize === ZIP32_LIMIT || centralOffset === ZIP32_LIMIT || centralSize > MAX_CENTRAL_BYTES
    || eocd.readUInt16LE(20) !== 0 || centralOffset + centralSize + EOCD_BYTES !== sourceSize
    || central.length !== centralSize) throw zipError("seaweed_artifact_zip_eocd_invalid");

  const entries = [];
  const paths = new Set();
  let cursor = 0;
  let rawTotal = 0;
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    if (cursor + CENTRAL_HEADER_BYTES > central.length || central.readUInt32LE(cursor) !== 0x02014b50) {
      throw zipError("seaweed_artifact_zip_central_invalid");
    }
    const madeBy = central.readUInt16LE(cursor + 4);
    const needed = central.readUInt16LE(cursor + 6);
    const flags = central.readUInt16LE(cursor + 8);
    const method = central.readUInt16LE(cursor + 10);
    const time = central.readUInt16LE(cursor + 12);
    const date = central.readUInt16LE(cursor + 14);
    const expectedCrc32 = central.readUInt32LE(cursor + 16);
    const compressedSize = central.readUInt32LE(cursor + 20);
    const rawSize = central.readUInt32LE(cursor + 24);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    const disk = central.readUInt16LE(cursor + 34);
    const internalAttributes = central.readUInt16LE(cursor + 36);
    const externalAttributes = central.readUInt32LE(cursor + 38);
    const localOffset = central.readUInt32LE(cursor + 42);
    if (madeBy !== 0x032d || needed !== 20 || flags !== 0x0008 || (method !== 0 && method !== 8)
      || compressedSize === ZIP32_LIMIT || rawSize === ZIP32_LIMIT || localOffset === ZIP32_LIMIT
      || nameLength === 0 || nameLength > MAX_NAME_BYTES || extraLength !== 0 || commentLength !== 0 || disk !== 0
      || internalAttributes !== 0 || (externalAttributes & 0xffff) !== 0x20) throw zipError("seaweed_artifact_zip_central_invalid");
    const mode = externalAttributes >>> 16;
    if (![0o100600, 0o100644, 0o100755].includes(mode) || (method === 0 && compressedSize !== rawSize)
      || cursor + CENTRAL_HEADER_BYTES + nameLength > central.length) throw zipError("seaweed_artifact_zip_entry_invalid");
    const nameBytes = central.subarray(cursor + CENTRAL_HEADER_BYTES, cursor + CENTRAL_HEADER_BYTES + nameLength);
    const name = nameBytes.toString("ascii");
    if (!nameBytes.equals(Buffer.from(name, "ascii")) || !canonicalPath(name) || paths.has(name)) {
      throw zipError("seaweed_artifact_zip_path_invalid");
    }
    rawTotal += rawSize;
    if (!Number.isSafeInteger(rawTotal) || rawTotal > MAX_RAW_BYTES) throw zipError("seaweed_artifact_zip_raw_limit");
    paths.add(name);
    entries.push({
      ordinal, path: name, mode, method, crc32: expectedCrc32, compressedSize, rawSize,
      localOffset, dosTime: time, dosDate: date,
    });
    cursor += CENTRAL_HEADER_BYTES + nameLength;
  }
  if (cursor !== central.length) throw zipError("seaweed_artifact_zip_central_invalid");
  if (central.length > count * (CENTRAL_HEADER_BYTES + MAX_NAME_BYTES)) throw zipError("seaweed_artifact_zip_central_invalid");
  return { entries, centralOffset, rawTotal };
}

async function validateLocalLayout(source, metadata, signal) {
  const complete = [];
  let expectedOffset = 0;
  for (const entry of metadata.entries) {
    assertAbort(signal);
    if (entry.localOffset !== expectedOffset) throw zipError("seaweed_artifact_zip_layout_invalid");
    const header = await readExact(source, entry.localOffset, LOCAL_HEADER_BYTES);
    assertAbort(signal);
    if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(4) !== 20 || header.readUInt16LE(6) !== 0x0008
      || header.readUInt16LE(8) !== entry.method || header.readUInt16LE(10) !== entry.dosTime || header.readUInt16LE(12) !== entry.dosDate
      || header.readUInt32LE(14) !== 0 || header.readUInt32LE(18) !== 0 || header.readUInt32LE(22) !== 0
      || header.readUInt16LE(26) !== Buffer.byteLength(entry.path) || header.readUInt16LE(28) !== 0) {
      throw zipError("seaweed_artifact_zip_local_invalid");
    }
    const name = await readExact(source, entry.localOffset + LOCAL_HEADER_BYTES, Buffer.byteLength(entry.path));
    assertAbort(signal);
    if (!name.equals(Buffer.from(entry.path, "ascii"))) throw zipError("seaweed_artifact_zip_local_invalid");
    const dataOffset = entry.localOffset + LOCAL_HEADER_BYTES + name.length;
    const descriptorOffset = dataOffset + entry.compressedSize;
    const descriptor = await readExact(source, descriptorOffset, DESCRIPTOR_BYTES);
    assertAbort(signal);
    if (descriptor.readUInt32LE(0) !== 0x08074b50 || descriptor.readUInt32LE(4) !== entry.crc32
      || descriptor.readUInt32LE(8) !== entry.compressedSize || descriptor.readUInt32LE(12) !== entry.rawSize) {
      throw zipError("seaweed_artifact_zip_descriptor_record_invalid");
    }
    complete.push(Object.freeze({ ...entry, dataOffset, descriptorOffset }));
    expectedOffset = descriptorOffset + DESCRIPTOR_BYTES;
  }
  if (expectedOffset !== metadata.centralOffset) throw zipError("seaweed_artifact_zip_layout_invalid");
  return Object.freeze(complete);
}

async function* rangeChunks(source, position, length, signal) {
  const end = position + length;
  while (position < end) {
    assertAbort(signal);
    const chunk = await readExact(source, position, Math.min(CHUNK_BYTES, end - position));
    position += chunk.length;
    yield chunk;
  }
}

async function deliverEntry(source, entry, openEntrySink, signal) {
  const context = Object.freeze({ signal, integrity: "PROVISIONAL" });
  let sink;
  try {
    sink = openEntrySink(entry, context);
  } catch (error) {
    throw zipError("seaweed_artifact_zip_sink_open_failed", error);
  }
  if (sink?.then instanceof Function) {
    Promise.resolve(sink).catch(() => undefined);
    throw zipError("seaweed_artifact_zip_sink_invalid");
  }
  if (!(sink instanceof Writable) || sink.writableObjectMode || sink.destroyed || sink.writableEnded) {
    if (sink instanceof Writable && !sink.destroyed) {
      sink.destroy();
      await finished(sink).catch(() => undefined);
    }
    throw zipError("seaweed_artifact_zip_sink_invalid");
  }
  const hash = createHash("sha256");
  let checksum = 0;
  let rawSize = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      if (chunk.length > CHUNK_BYTES) return callback(zipError("seaweed_artifact_zip_chunk_invalid"));
      rawSize += chunk.length;
      if (rawSize > entry.rawSize || rawSize > MAX_RAW_BYTES) return callback(zipError("seaweed_artifact_zip_raw_limit"));
      checksum = crc32(chunk, checksum);
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const input = Readable.from(rangeChunks(source, entry.dataOffset, entry.compressedSize, signal), { objectMode: false });
  const inflater = entry.method === 8 ? createInflateRaw() : undefined;
  if (signal !== undefined) {
    addAbortSignal(signal, input);
    addAbortSignal(signal, verifier);
    addAbortSignal(signal, sink);
    if (inflater !== undefined) addAbortSignal(signal, inflater);
  }
  try {
    if (inflater === undefined) await pipeline(input, verifier, sink);
    else await pipeline(input, inflater, verifier, sink);
  } catch (error) {
    if (signal?.aborted === true && error?.name === "AbortError") {
      throw zipError("seaweed_artifact_zip_aborted", error);
    }
    throw ZIP_ERROR_CODES.has(error) ? error : zipError("seaweed_artifact_zip_entry_stream_invalid", error);
  }
  if (inflater !== undefined && inflater.bytesWritten !== entry.compressedSize) throw zipError("seaweed_artifact_zip_deflate_trailing_data");
  if (rawSize !== entry.rawSize || (checksum >>> 0) !== entry.crc32) throw zipError("seaweed_artifact_zip_entry_integrity_invalid");
  return Object.freeze({ ...entry, sha256: hash.digest("hex") });
}

export async function scanGitHubArtifactZip({ source: candidateSource, descriptor: candidateDescriptor, profile, openEntrySink, signal } = {}) {
  let entriesProcessed = 0;
  let verifiedBytes = 0;
  try {
    assertAbort(signal);
    const source = snapshotSource(candidateSource);
    const descriptor = snapshotDescriptor(candidateDescriptor);
    if (signal !== undefined && (signal === null || typeof signal !== "object" || typeof signal.aborted !== "boolean"
      || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) {
      throw zipError("seaweed_artifact_zip_signal_invalid");
    }
    if (source.size !== descriptor.size || source.size < EOCD_BYTES) throw zipError("seaweed_artifact_zip_size_invalid");
    const jsonProfile = profile === githubArtifactZipProfiles.gate1 || profile === githubArtifactZipProfiles.gate2
      || profile === githubArtifactZipProfiles.comparison;
    if (profile !== githubArtifactZipProfiles.build && !jsonProfile) throw zipError("seaweed_artifact_zip_profile_invalid");
    if (jsonProfile && source.size > MAX_JSON_ZIP_BYTES) throw zipError("seaweed_artifact_zip_profile_limit");
    if (typeof openEntrySink !== "function") throw zipError("seaweed_artifact_zip_sink_opener_invalid");
    if (await hashSource(source, signal) !== descriptor.digest) throw zipError("seaweed_artifact_zip_digest_invalid");
    const eocd = await readExact(source, source.size - EOCD_BYTES, EOCD_BYTES);
    const centralSize = eocd.readUInt32LE(12);
    const centralOffset = eocd.readUInt32LE(16);
    if (centralSize > MAX_CENTRAL_BYTES || centralOffset + centralSize + EOCD_BYTES !== source.size) throw zipError("seaweed_artifact_zip_eocd_invalid");
    const central = await readBounded(source, centralOffset, centralSize, signal);
    const metadata = parseMetadata(central, eocd, source.size);
    if (jsonProfile && metadata.rawTotal > MAX_JSON_RAW_BYTES) throw zipError("seaweed_artifact_zip_profile_limit");
    const entries = await validateLocalLayout(source, metadata, signal);
    profilePaths(profile, entries.map((entry) => entry.path));
    const expectedMethod = profile === githubArtifactZipProfiles.build ? 0 : 8;
    if (entries.some((entry) => entry.method !== expectedMethod
      || (profile === githubArtifactZipProfiles.build
        ? entry.mode !== (entry.path === "weed" ? 0o100755 : /\/source\.zip$/u.test(entry.path) ? 0o100600 : 0o100644)
        : entry.mode !== 0o100644))) throw zipError("seaweed_artifact_zip_profile_invalid");
    const delivered = [];
    for (const entry of entries) {
      assertAbort(signal);
      const result = await deliverEntry(source, entry, openEntrySink, signal);
      delivered.push(result);
      entriesProcessed += 1;
      verifiedBytes += result.rawSize;
    }
    if (await hashSource(source, signal) !== descriptor.digest) throw zipError("seaweed_artifact_zip_source_changed");
    return Object.freeze({
      kind: "GITHUB_ARTIFACT_ZIP_SCAN_RECEIPT_V1", authority: "PREPARATION_ONLY", state: "COMPLETE",
      profile, zipSize: descriptor.size, zipDigest: descriptor.digest, entryCount: delivered.length,
      rawSize: metadata.rawTotal, entries: Object.freeze(delivered),
    });
  } catch (error) {
    throw failed(error, entriesProcessed, verifiedBytes, signal);
  }
}

function identity(value) {
  return Object.freeze({
    dev: value.dev.toString(10), ino: value.ino.toString(10), uid: Number(value.uid), gid: Number(value.gid),
    mode: Number(value.mode), nlink: Number(value.nlink),
    size: Number(value.size), mtimeNs: value.mtimeNs.toString(10), ctimeNs: value.ctimeNs.toString(10),
  });
}

function sameIdentity(first, second) {
  return Object.keys(first).every((key) => first[key] === second[key]);
}

export async function scanOwnedGitHubArtifactZip({ file, root, descriptor, profile, openEntrySink, signal } = {}) {
  let handle;
  let result;
  let pendingError;
  try {
    if (process.platform !== "linux" || constants.O_NOFOLLOW === undefined) throw zipError("seaweed_artifact_zip_owned_platform_invalid");
    if (!path.isAbsolute(file ?? "") || !path.isAbsolute(root ?? "")) throw zipError("seaweed_artifact_zip_owned_path_invalid");
    if (path.normalize(file) !== file || path.normalize(root) !== root || path.dirname(file) !== root) {
      throw zipError("seaweed_artifact_zip_owned_path_invalid");
    }
    const rootPathStat = await lstat(root, { bigint: true });
    const rootBefore = identity(rootPathStat);
    const owner = BigInt(process.getuid());
    if (!rootPathStat.isDirectory() || rootPathStat.isSymbolicLink() || await realpath(root) !== root
      || rootPathStat.uid !== owner || (rootPathStat.mode & 0o022n) !== 0n) {
      throw zipError("seaweed_artifact_zip_owned_path_invalid");
    }
    const pathBefore = await lstat(file, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n || pathBefore.dev !== rootPathStat.dev) {
      throw zipError("seaweed_artifact_zip_owned_file_invalid");
    }
    if (pathBefore.uid !== owner || (pathBefore.mode & 0o022n) !== 0n) throw zipError("seaweed_artifact_zip_owned_file_invalid");
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!sameIdentity(rootBefore, identity(await lstat(root, { bigint: true })))) {
      throw zipError("seaweed_artifact_zip_owned_path_changed");
    }
    const beforeStat = await handle.stat({ bigint: true });
    if (!beforeStat.isFile() || beforeStat.nlink !== 1n || beforeStat.size > BigInt(MAX_ZIP_BYTES)) {
      throw zipError("seaweed_artifact_zip_owned_file_invalid");
    }
    const before = identity(beforeStat);
    if (!sameIdentity(before, identity(pathBefore))) throw zipError("seaweed_artifact_zip_owned_file_changed");
    const size = Number(before.size);
    const source = Object.freeze({
      size,
      async readAt(position, length) {
        const buffer = Buffer.allocUnsafe(length);
        let bytesRead = 0;
        while (bytesRead < length) {
          const result = await handle.read(buffer, bytesRead, length - bytesRead, position + bytesRead);
          if (result.bytesRead === 0) break;
          bytesRead += result.bytesRead;
        }
        if (bytesRead !== length) return buffer.subarray(0, bytesRead);
        return buffer;
      },
    });
    const receipt = await scanGitHubArtifactZip({ source, descriptor, profile, openEntrySink, signal });
    const after = identity(await handle.stat({ bigint: true }));
    const pathAfter = identity(await lstat(file, { bigint: true }));
    const rootAfter = identity(await lstat(root, { bigint: true }));
    if (!sameIdentity(before, after) || !sameIdentity(before, pathAfter)) throw zipError("seaweed_artifact_zip_owned_file_changed");
    if (!sameIdentity(rootBefore, rootAfter) || await realpath(root) !== root) throw zipError("seaweed_artifact_zip_owned_path_changed");
    result = Object.freeze({ ...receipt, ownedFileIdentity: before });
  } catch (error) {
    pendingError = ZIP_ERROR_CODES.has(error) ? error : zipError("seaweed_artifact_zip_owned_file_invalid", error);
  }
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch (error) {
      pendingError = zipError("seaweed_artifact_zip_owned_close_failed",
        pendingError === undefined ? error : new AggregateError([pendingError, error], "seaweed_artifact_zip_owned_close_failed"));
    }
  }
  if (pendingError !== undefined) {
    throw failed(pendingError, pendingError.entriesProcessed ?? 0, pendingError.verifiedBytes ?? 0, signal);
  }
  return result;
}

export const githubArtifactZipLimits = Object.freeze({
  zipBytes: MAX_ZIP_BYTES, rawBytes: MAX_RAW_BYTES, entries: MAX_ENTRIES,
  nameBytes: MAX_NAME_BYTES, centralBytes: MAX_CENTRAL_BYTES, chunkBytes: CHUNK_BYTES,
  jsonZipBytes: MAX_JSON_ZIP_BYTES, jsonRawBytes: MAX_JSON_RAW_BYTES,
});
