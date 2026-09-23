import { createHash } from "node:crypto";
import { Transform, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

const BLOCK_BYTES = 512;
const MAX_COMPRESSED_BYTES = 256 * 1024 ** 2;
const MAX_RAW_BYTES = 2 * 1024 ** 3;
const MAX_MEMBERS = 100_000;
const MAX_INPUT_CHUNK_BYTES = 1024 ** 2;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

function archiveError(code, cause) {
  return cause === undefined ? new Error(code) : new Error(code, { cause });
}

function isArchiveError(error) {
  return error instanceof Error && error.message.startsWith("seaweed_archive_");
}

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function requireDigest(value, code) {
  if (typeof value !== "string" || !DIGEST.test(value)) throw archiveError(code);
}

function requireLimit(value, maximum, code) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw archiveError(code);
}

function parseString(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  const end = nul === -1 ? field.length : nul;
  if (nul !== -1 && field.subarray(nul + 1).some((byte) => byte !== 0)) {
    throw archiveError("seaweed_archive_tar_header_invalid");
  }
  const value = field.subarray(0, end);
  if (value.some((byte) => byte < 0x20 || byte > 0x7e)) {
    throw archiveError("seaweed_archive_tar_header_invalid");
  }
  return value.toString("ascii");
}

function parseOctal(block, offset, length, { allowEmpty = false, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const field = block.subarray(offset, offset + length);
  if (field.some((byte) => byte > 0x7f)) throw archiveError("seaweed_archive_tar_octal_invalid");
  const nul = field.indexOf(0);
  const end = nul === -1 ? field.length : nul;
  if (nul !== -1 && field.subarray(nul + 1).some((byte) => byte !== 0 && byte !== 0x20)) {
    throw archiveError("seaweed_archive_tar_octal_invalid");
  }
  const text = field.subarray(0, end).toString("ascii");
  if (!/^[ ]*[0-7]*[ ]*$/u.test(text)) throw archiveError("seaweed_archive_tar_octal_invalid");
  const digits = text.trim();
  if (digits.length === 0) {
    if (allowEmpty) return 0;
    throw archiveError("seaweed_archive_tar_octal_invalid");
  }
  const value = Number.parseInt(digits, 8);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw archiveError("seaweed_archive_tar_octal_invalid");
  }
  return value;
}

function canonicalPath(rawPath, type) {
  if (!rawPath || rawPath.startsWith("/") || rawPath.includes("\\") || rawPath.includes("//")) {
    throw archiveError("seaweed_archive_tar_path_invalid");
  }
  const path = type === "directory" && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  if (!path || path.endsWith("/")) throw archiveError("seaweed_archive_tar_path_invalid");
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."
    || part === ".wh..wh..opq" || part.startsWith(".wh."))) {
    throw archiveError("seaweed_archive_tar_path_invalid");
  }
  return path;
}

function validateLinkTarget(path, linkname) {
  if (!linkname || linkname.includes("\\") || linkname.includes("//") || linkname.endsWith("/")) {
    throw archiveError("seaweed_archive_tar_link_invalid");
  }
  const stack = linkname.startsWith("/") ? [] : path.split("/").slice(0, -1);
  for (const part of linkname.split("/")) {
    if (part === "" && linkname.startsWith("/")) continue;
    if (part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) throw archiveError("seaweed_archive_tar_link_invalid");
      stack.pop();
      continue;
    }
    if (part === "" || part === ".wh..wh..opq" || part.startsWith(".wh.")) {
      throw archiveError("seaweed_archive_tar_link_invalid");
    }
    stack.push(part);
  }
  if (stack.length === 0) throw archiveError("seaweed_archive_tar_link_invalid");
}

function parseHeader(block, maximumSize) {
  if (!block.subarray(257, 263).equals(Buffer.from("ustar\0"))
    || !block.subarray(263, 265).equals(Buffer.from("00"))) {
    throw archiveError("seaweed_archive_tar_format_invalid");
  }
  if (block.subarray(500).some((byte) => byte !== 0)) throw archiveError("seaweed_archive_tar_header_invalid");
  const expectedChecksum = parseOctal(block, 148, 8, { maximum: 256 * BLOCK_BYTES });
  const checksumBlock = Buffer.from(block);
  checksumBlock.fill(0x20, 148, 156);
  if (checksumBlock.reduce((total, byte) => total + byte, 0) !== expectedChecksum) {
    throw archiveError("seaweed_archive_tar_checksum_invalid");
  }
  const typeFlag = String.fromCharCode(block[156]);
  const type = typeFlag === "0" ? "file" : typeFlag === "2" ? "symlink" : typeFlag === "5" ? "directory" : null;
  if (type === null) throw archiveError("seaweed_archive_tar_type_invalid");
  const name = parseString(block, 0, 100);
  const prefix = parseString(block, 345, 155);
  const path = canonicalPath(prefix ? `${prefix}/${name}` : name, type);
  const size = parseOctal(block, 124, 12, { maximum: maximumSize });
  const mode = parseOctal(block, 100, 8, { maximum: 0o7777 });
  const uid = parseOctal(block, 108, 8);
  const gid = parseOctal(block, 116, 8);
  const mtime = parseOctal(block, 136, 12);
  const linkname = parseString(block, 157, 100);
  parseString(block, 265, 32);
  parseString(block, 297, 32);
  if (parseOctal(block, 329, 8, { allowEmpty: true }) !== 0
    || parseOctal(block, 337, 8, { allowEmpty: true }) !== 0) {
    throw archiveError("seaweed_archive_tar_header_invalid");
  }
  if ((type !== "file" && size !== 0) || (type !== "symlink" && linkname !== "")) {
    throw archiveError("seaweed_archive_tar_header_invalid");
  }
  if (type === "symlink") validateLinkTarget(path, linkname);
  return { path, type, mode, uid, gid, mtime, size, ...(type === "symlink" ? { linkname } : {}) };
}

class TarScanner {
  constructor({ maxRawBytes, maxMembers }) {
    this.maxRawBytes = maxRawBytes;
    this.maxMembers = maxMembers;
    this.members = [];
    this.names = new Set();
    this.header = Buffer.alloc(BLOCK_BYTES);
    this.headerBytes = 0;
    this.rawOffset = 0;
    this.eoaBlocks = 0;
    this.current = null;
    this.remaining = 0;
    this.padding = 0;
  }

  consume(chunk) {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.eoaBlocks === 2) throw archiveError("seaweed_archive_tar_eoa_invalid");
      if (this.current !== null && this.remaining > 0) {
        const length = Math.min(this.remaining, chunk.length - offset);
        this.current.hash.update(chunk.subarray(offset, offset + length));
        this.remaining -= length;
        this.rawOffset += length;
        offset += length;
        if (this.remaining === 0) this.finishFile();
        continue;
      }
      if (this.padding > 0) {
        const length = Math.min(this.padding, chunk.length - offset);
        if (chunk.subarray(offset, offset + length).some((byte) => byte !== 0)) {
          throw archiveError("seaweed_archive_tar_padding_invalid");
        }
        this.padding -= length;
        this.rawOffset += length;
        offset += length;
        continue;
      }
      const length = Math.min(BLOCK_BYTES - this.headerBytes, chunk.length - offset);
      chunk.copy(this.header, this.headerBytes, offset, offset + length);
      this.headerBytes += length;
      this.rawOffset += length;
      offset += length;
      if (this.headerBytes === BLOCK_BYTES) this.finishHeader();
    }
  }

  finishHeader() {
    const headerOffset = this.rawOffset - BLOCK_BYTES;
    if (this.header.every((byte) => byte === 0)) {
      this.eoaBlocks += 1;
      this.headerBytes = 0;
      return;
    }
    if (this.eoaBlocks !== 0) throw archiveError("seaweed_archive_tar_eoa_invalid");
    const entry = parseHeader(this.header, this.maxRawBytes);
    if (this.names.has(entry.path)) throw archiveError("seaweed_archive_tar_duplicate_invalid");
    this.names.add(entry.path);
    if (this.members.length >= this.maxMembers) throw archiveError("seaweed_archive_tar_member_limit");
    const member = {
      memberOrdinal: this.members.length,
      uncompressedHeaderOffset: headerOffset,
      uncompressedDataOffset: headerOffset + BLOCK_BYTES,
      entry,
    };
    this.headerBytes = 0;
    if (entry.type === "file") {
      this.current = { member, hash: createHash("sha256") };
      this.remaining = entry.size;
      this.padding = (BLOCK_BYTES - entry.size % BLOCK_BYTES) % BLOCK_BYTES;
      if (this.remaining === 0) this.finishFile();
    } else {
      this.members.push(member);
    }
  }

  finishFile() {
    this.current.member.entry.sha256 = this.current.hash.digest("hex");
    this.members.push(this.current.member);
    this.current = null;
  }

  finish() {
    if (this.headerBytes !== 0 || this.current !== null || this.remaining !== 0 || this.padding !== 0) {
      throw archiveError("seaweed_archive_tar_truncated");
    }
    if (this.eoaBlocks < 2 || this.rawOffset % BLOCK_BYTES !== 0) {
      throw archiveError("seaweed_archive_tar_eoa_invalid");
    }
    return this.members;
  }
}

export async function scanGzipLayer({ input, descriptor, diffId, maxRawBytes = MAX_RAW_BYTES, maxMembers = MAX_MEMBERS } = {}) {
  if (input === null || typeof input !== "object" || typeof input.pipe !== "function" || typeof input.destroy !== "function") {
    throw archiveError("seaweed_archive_input_invalid");
  }
  try {
    if (!exactObject(descriptor, ["size", "digest"])) throw archiveError("seaweed_archive_descriptor_invalid");
    requireLimit(descriptor.size, MAX_COMPRESSED_BYTES, "seaweed_archive_descriptor_invalid");
    requireDigest(descriptor.digest, "seaweed_archive_descriptor_invalid");
    requireDigest(diffId, "seaweed_archive_diffid_invalid");
    requireLimit(maxRawBytes, MAX_RAW_BYTES, "seaweed_archive_limit_invalid");
    requireLimit(maxMembers, MAX_MEMBERS, "seaweed_archive_limit_invalid");
    const expectedCompressedSize = descriptor.size;
    const expectedCompressedDigest = descriptor.digest;
    const expectedDiffId = diffId;
    let compressedSize = 0;
    let uncompressedSize = 0;
    const compressedHash = createHash("sha256");
    const rawHash = createHash("sha256");
    const scanner = new TarScanner({ maxRawBytes, maxMembers });
    const compressedCounter = new Transform({
      transform(chunk, _encoding, callback) {
        try {
          if (!Buffer.isBuffer(chunk) || chunk.length > MAX_INPUT_CHUNK_BYTES) throw archiveError("seaweed_archive_input_chunk_invalid");
          compressedSize += chunk.length;
          if (compressedSize > expectedCompressedSize || compressedSize > MAX_COMPRESSED_BYTES) throw archiveError("seaweed_archive_compressed_limit");
          compressedHash.update(chunk);
          callback(null, chunk);
        } catch (error) { callback(error); }
      },
    });
    const gunzip = createGunzip();
    const rawSink = new Writable({
      write(chunk, _encoding, callback) {
        try {
          uncompressedSize += chunk.length;
          if (uncompressedSize > maxRawBytes) throw archiveError("seaweed_archive_raw_limit");
          rawHash.update(chunk);
          scanner.consume(chunk);
          callback();
        } catch (error) { callback(error); }
      },
    });
    await pipeline(input, compressedCounter, gunzip, rawSink);
    if (compressedSize !== expectedCompressedSize || `sha256:${compressedHash.digest("hex")}` !== expectedCompressedDigest) {
      throw archiveError("seaweed_archive_compressed_identity_invalid");
    }
    if (gunzip.bytesWritten !== compressedSize) throw archiveError("seaweed_archive_gzip_trailing_data");
    const members = scanner.finish();
    if (`sha256:${rawHash.digest("hex")}` !== expectedDiffId) throw archiveError("seaweed_archive_diffid_mismatch");
    return { compressedSize, compressedDigest: expectedCompressedDigest, uncompressedSize, diffId: expectedDiffId, members };
  } catch (error) {
    throw isArchiveError(error) ? error : archiveError("seaweed_archive_stream_invalid", error);
  } finally {
    input.destroy();
    await finished(input).catch(() => undefined);
  }
}

export const seaweedArchiveLimits = Object.freeze({
  compressedBytes: MAX_COMPRESSED_BYTES,
  rawBytes: MAX_RAW_BYTES,
  members: MAX_MEMBERS,
  inputChunkBytes: MAX_INPUT_CHUNK_BYTES,
});
