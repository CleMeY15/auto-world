import { createHash } from "node:crypto";
import { mkdir, open, readFile, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { TextDecoder, TextEncoder } from "node:util";

const BLOCK = 512;
const MiB = 1024 ** 2;
const DIGEST = /^[0-9a-f]{64}$/u;
const DRIVE = /^[A-Za-z]:/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const GOSU_ARCHIVE_LIMITS_V1 = Object.freeze({
  gosu: Object.freeze({ members: 64, memberBytes: 64 * 1024, totalBytes: 256 * 1024, depth: 8, pathBytes: 256 }),
  go: Object.freeze({ members: 50_000, memberBytes: 64 * MiB, totalBytes: 1024 * MiB, depth: 32, pathBytes: 1024 }),
  module: Object.freeze({ members: 2048, memberBytes: 8 * MiB, totalBytes: 32 * MiB, depth: 16, pathBytes: 512 }),
  sumdb: Object.freeze({ members: 4096, memberBytes: MiB, totalBytes: 16 * MiB, depth: 16, pathBytes: 512 }),
  publicTree: Object.freeze({ members: 128, memberBytes: 64 * MiB, totalBytes: 128 * MiB, depth: 8, pathBytes: 512 }),
  preparationTarBytes: 132 * MiB,
});

function failure(code) { throw new Error(code); }
export function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
export function exactIdentity(bytes) { return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) }); }
export function assertIdentity(bytes, expected, code = "gosu_material_identity_invalid") {
  if (!Buffer.isBuffer(bytes) || expected?.bytes !== bytes.length || !DIGEST.test(expected?.sha256 ?? "") || sha256(bytes) !== expected.sha256) failure(code);
  return exactIdentity(bytes);
}

export function canonicalArchivePath(value, limits, { directory = false } = {}) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\") || value.startsWith("/") || value.startsWith("//") || DRIVE.test(value)) failure("gosu_archive_path_invalid");
  const candidate = directory && value.endsWith("/") ? value.slice(0, -1) : value;
  if (!candidate || candidate.endsWith("/") || candidate.normalize("NFC") !== candidate) failure("gosu_archive_path_invalid");
  const parts = candidate.split("/");
  if (parts.length > limits.depth || parts.some((part) => !part || part === "." || part === "..") || encoder.encode(candidate).length > limits.pathBytes) failure("gosu_archive_path_invalid");
  return candidate;
}

function octal(block, offset, length, maximum = Number.MAX_SAFE_INTEGER, allowEmpty = false) {
  const raw = block.subarray(offset, offset + length);
  if (raw[0] & 0x80) failure("gosu_tar_number_invalid");
  const text = raw.toString("ascii").replaceAll("\0", "").trim();
  if (!text && allowEmpty) return 0; if (!/^[0-7]+$/u.test(text)) failure("gosu_tar_number_invalid");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) failure("gosu_tar_number_invalid");
  return value;
}
function field(block, offset, length) {
  const bytes = block.subarray(offset, offset + length); const nul = bytes.indexOf(0); const end = nul < 0 ? bytes.length : nul;
  if (nul >= 0 && bytes.subarray(nul + 1).some(Boolean)) failure("gosu_tar_header_invalid");
  try { return decoder.decode(bytes.subarray(0, end)); } catch { failure("gosu_tar_header_invalid"); }
}
function header(block, limits) {
  if (!block.subarray(257, 263).equals(Buffer.from("ustar\0")) || !block.subarray(263, 265).equals(Buffer.from("00"))) failure("gosu_tar_format_invalid");
  const copy = Buffer.from(block); const expected = octal(block, 148, 8, 256 * BLOCK); copy.fill(0x20, 148, 156);
  if (copy.reduce((sum, byte) => sum + byte, 0) !== expected) failure("gosu_tar_checksum_invalid");
  const type = String.fromCharCode(block[156] || 48);
  const name = field(block, 0, 100); const prefix = field(block, 345, 155); const rawPath = prefix ? `${prefix}/${name}` : name;
  const size = octal(block, 124, 12, limits.memberBytes);
  const mode = octal(block, 100, 8, 0o7777); const uid = octal(block, 108, 8, Number.MAX_SAFE_INTEGER, true); const gid = octal(block, 116, 8, Number.MAX_SAFE_INTEGER, true); const mtime = octal(block, 136, 12, Number.MAX_SAFE_INTEGER, true); const devMajor = octal(block, 329, 8, Number.MAX_SAFE_INTEGER, true); const devMinor = octal(block, 337, 8, Number.MAX_SAFE_INTEGER, true);
  const link = field(block, 157, 100);
  return { rawPath, type, size, mode, uid, gid, mtime, devMajor, devMinor, uname: field(block, 265, 32), gname: field(block, 297, 32), link };
}
function pax(bytes) {
  const result = Object.create(null); let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset); if (space < 1) failure("gosu_tar_pax_invalid");
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (!/^[1-9][0-9]*$/u.test(lengthText)) failure("gosu_tar_pax_invalid");
    const length = Number(lengthText);
    if (!Number.isSafeInteger(length) || length < 4 || offset + length > bytes.length || bytes[offset + length - 1] !== 0x0a) failure("gosu_tar_pax_invalid");
    if (String(length).length + 1 + (offset + length - 1 - (space + 1)) + 1 !== length) failure("gosu_tar_pax_invalid");
    let record; try { record = decoder.decode(bytes.subarray(space + 1, offset + length - 1)); } catch { failure("gosu_tar_pax_invalid"); }
    const equal = record.indexOf("=");
    if (equal < 1) failure("gosu_tar_pax_invalid"); const key = record.slice(0, equal); const value = record.slice(equal + 1);
    if (!new Set(["path", "linkpath", "comment", "mtime", "atime", "ctime"]).has(key) || Object.hasOwn(result, key)) failure("gosu_tar_pax_invalid");
    result[key] = value; offset += length;
  }
  return result;
}

class TarConsumer {
  constructor(limits, options = {}) { this.limits = limits; this.options = options; this.buffer = Buffer.alloc(0); this.entries = []; this.names = new Set(); this.total = 0; this.regularTotal = 0; this.memberCount = 0; this.ended = false; this.zero = 0; this.pendingPax = null; this.globalPax = Object.create(null); this.lastName = null; }
  async push(chunk) { this.buffer = Buffer.concat([this.buffer, chunk]); await this.drain(false); }
  async drain(final) {
    while (this.buffer.length >= BLOCK && !this.ended) {
      const first = this.buffer.subarray(0, BLOCK);
      if (first.every((byte) => byte === 0)) { this.buffer = this.buffer.subarray(BLOCK); this.zero += 1; if (this.zero === 2) this.ended = true; continue; }
      if (this.zero) failure("gosu_tar_terminator_invalid");
      const parsed = header(first, this.limits); const padded = Math.ceil(parsed.size / BLOCK) * BLOCK;
      if (this.buffer.length < BLOCK + padded) break;
      if (this.buffer.subarray(BLOCK + parsed.size, BLOCK + padded).some(Boolean)) failure("gosu_tar_padding_invalid");
      const body = Buffer.from(this.buffer.subarray(BLOCK, BLOCK + parsed.size)); this.buffer = this.buffer.subarray(BLOCK + padded);
      if (parsed.type === "x" || parsed.type === "g") {
        const data = pax(body);
        if (parsed.type === "g") {
          if (this.pendingPax || Object.keys(this.globalPax).length || Object.keys(data).some((key) => key !== "comment")) failure("gosu_tar_pax_profile_invalid");
          Object.assign(this.globalPax, data);
        } else {
          if (this.pendingPax || Object.keys(data).some((key) => !new Set(["path", "linkpath", "mtime", "atime", "ctime"]).has(key))) failure("gosu_tar_pax_profile_invalid");
          this.pendingPax = data;
        }
        this.countMetadata(parsed.size); continue;
      }
      const metadata = { ...this.globalPax, ...(this.pendingPax ?? {}) }; this.pendingPax = null;
      const raw = metadata.path ?? parsed.rawPath; const directory = parsed.type === "5"; const itemPath = canonicalArchivePath(raw, this.limits, { directory });
      if (this.options.strictUstar && (Object.keys(metadata).length || parsed.type !== "0" || parsed.mode !== 0o644 || parsed.uid || parsed.gid || parsed.mtime || parsed.devMajor || parsed.devMinor || parsed.uname || parsed.gname || parsed.link || this.lastName !== null && this.lastName.localeCompare(itemPath, "en") >= 0)) failure("gosu_ustar_profile_invalid"); this.lastName = itemPath;
      if (this.names.has(itemPath)) failure("gosu_archive_duplicate_invalid"); this.names.add(itemPath);
      const type = parsed.type === "0" || parsed.type === "\0" ? "file" : directory ? "directory" : parsed.type === "2" ? "symlink" : null;
      if (!type) failure("gosu_archive_type_invalid");
      if (type !== "file" && parsed.size !== 0) failure("gosu_tar_header_invalid");
      if (type !== "symlink" && parsed.link) failure("gosu_tar_header_invalid");
      if (type === "symlink") {
        const target = metadata.linkpath ?? parsed.link;
        const allowed = this.options.symlink && itemPath === this.options.symlink.path && target === this.options.symlink.target;
        if (!allowed) failure("gosu_archive_link_invalid");
        this.entries.push({ path: itemPath, type, target }); this.countMetadata(0); continue;
      }
      this.countMetadata(parsed.size);
      const entry = { path: itemPath, type, mode: parsed.mode, bytes: parsed.size, ...(type === "file" ? { sha256: sha256(body) } : {}) };
      this.entries.push(entry);
      if (type === "file") this.regularTotal += parsed.size;
      if (type === "file" && this.options.onFile) await this.options.onFile(entry, body);
    }
    if (final && (!this.ended || this.pendingPax || (this.options.strictUstar ? this.buffer.length !== 0 : this.buffer.some(Boolean)))) failure("gosu_tar_eof_invalid");
  }
  countMetadata(size) { this.memberCount += 1; if (this.memberCount > this.limits.members) failure("gosu_archive_member_limit"); this.total += size; if (this.total > this.limits.totalBytes) failure("gosu_archive_total_limit"); }
}

async function exactInputBytes(input, expected) {
  if (!Number.isSafeInteger(expected?.bytes) || expected.bytes < 1 || expected.bytes > 1024 * MiB || !DIGEST.test(expected?.sha256 ?? "")) failure("gosu_material_identity_invalid");
  if (typeof input === "string") {
    const info = await lstat(input);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== expected.bytes) failure("gosu_archive_transport_invalid");
  }
  const bytes = typeof input === "string" ? await readFile(input) : Buffer.from(input);
  assertIdentity(bytes, expected);
  return bytes;
}

function gzipPayloadRange(bytes) {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8 || bytes[3] !== 0) failure("gosu_archive_gzip_invalid");
  return { start: 10, end: bytes.length - 8 };
}

export async function scanGzipTar(input, expected, limits, options = {}) {
  if (!limits || !Number.isSafeInteger(limits.members)) failure("gosu_archive_limits_invalid");
  const bytes = await exactInputBytes(input, expected); const range = gzipPayloadRange(bytes); const packed = bytes.subarray(range.start, range.end);
  const tar = new TarConsumer(limits, options); const inflater = createInflateRaw(); let expanded = 0; let crc = 0xffffffff;
  const sink = new Writable({ write(chunk, _encoding, callback) {
    expanded = (expanded + chunk.length) >>> 0;
    for (const byte of chunk) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    tar.push(chunk).then(() => callback(), callback);
  } });
  try { await pipeline(Readable.from([packed]), inflater, sink); } catch (error) { if (error.message?.startsWith("gosu_")) throw error; failure("gosu_archive_gzip_invalid"); }
  if (inflater.bytesWritten !== packed.length) failure("gosu_archive_gzip_trailing_invalid");
  if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32LE(bytes.length - 8) || expanded !== bytes.readUInt32LE(bytes.length - 4)) failure("gosu_archive_gzip_trailer_invalid");
  await tar.drain(true); return Object.freeze({ compressedBytes: bytes.length, entries: tar.entries, regularBytes: tar.regularTotal, expandedBytes: tar.total });
}

function u16(bytes, offset) { return bytes.readUInt16LE(offset); } function u32(bytes, offset) { return bytes.readUInt32LE(offset); }
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
async function inflate(bytes, declared, limit) {
  let actual = 0; const chunks = []; const inflater = createInflateRaw(); const sink = new Writable({ write(chunk, _e, cb) { actual += chunk.length; if (actual > declared || actual > limit) return cb(new Error("gosu_zip_expanded_limit")); chunks.push(chunk); cb(); } });
  try { await pipeline(Readable.from([bytes]), inflater, sink); } catch (error) { if (error.message?.startsWith("gosu_")) throw error; failure("gosu_zip_deflate_invalid"); }
  if (inflater.bytesWritten !== bytes.length) failure("gosu_zip_deflate_trailing_invalid");
  if (actual !== declared) failure("gosu_zip_size_invalid"); return Buffer.concat(chunks, actual);
}
export async function scanModuleZip(input, expected, limits = GOSU_ARCHIVE_LIMITS_V1.module, options = {}) {
  const bytes = await exactInputBytes(input, expected);
  const endStart = Math.max(0, bytes.length - 65_557); let end = -1;
  for (let at = bytes.length - 22; at >= endStart; at -= 1) if (u32(bytes, at) === 0x06054b50) { end = at; break; }
  if (end < 0 || u16(bytes, end + 4) || u16(bytes, end + 6) || u16(bytes, end + 20) || end + 22 !== bytes.length) failure("gosu_zip_eof_invalid");
  const count = u16(bytes, end + 10); const centralBytes = u32(bytes, end + 12); const centralAt = u32(bytes, end + 16);
  if (count > limits.members || centralAt + centralBytes !== end) failure("gosu_zip_directory_invalid");
  const entries = []; const names = new Set(); const ranges = []; let offset = centralAt; let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || u32(bytes, offset) !== 0x02014b50) failure("gosu_zip_directory_invalid");
    const flags = u16(bytes, offset + 8); const method = u16(bytes, offset + 10); const crc = u32(bytes, offset + 16); const compressed = u32(bytes, offset + 20); const expanded = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28); const extraLength = u16(bytes, offset + 30); const commentLength = u16(bytes, offset + 32); const localAt = u32(bytes, offset + 42);
    if (flags !== 0x8 || method !== 8 || extraLength || commentLength || compressed === 0xffffffff || expanded === 0xffffffff) failure("gosu_zip_profile_invalid");
    if (offset + 46 + nameLength > end) failure("gosu_zip_directory_invalid");
    let rawName; try { rawName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { failure("gosu_zip_profile_invalid"); }
    const directory = rawName.endsWith("/"); const itemPath = canonicalArchivePath(rawName, limits, { directory });
    if (names.has(itemPath)) failure("gosu_archive_duplicate_invalid"); names.add(itemPath);
    if (u32(bytes, localAt) !== 0x04034b50 || u16(bytes, localAt + 6) !== flags || u16(bytes, localAt + 8) !== method || u16(bytes, localAt + 28) || u16(bytes, localAt + 26) !== nameLength || u32(bytes, localAt + 14) || u32(bytes, localAt + 18) || u32(bytes, localAt + 22)) failure("gosu_zip_local_invalid");
    let localName; try { localName = decoder.decode(bytes.subarray(localAt + 30, localAt + 30 + nameLength)); } catch { failure("gosu_zip_local_invalid"); } if (localName !== rawName) failure("gosu_zip_local_invalid");
    const payloadAt = localAt + 30 + nameLength; const packed = bytes.subarray(payloadAt, payloadAt + compressed); if (packed.length !== compressed) failure("gosu_zip_eof_invalid");
    const descriptorAt = payloadAt + compressed; if (descriptorAt + 16 > centralAt || u32(bytes, descriptorAt) !== 0x08074b50) failure("gosu_zip_descriptor_invalid"); const valuesAt = descriptorAt + 4;
    if (u32(bytes, valuesAt) !== crc || u32(bytes, valuesAt + 4) !== compressed || u32(bytes, valuesAt + 8) !== expanded) failure("gosu_zip_descriptor_invalid");
    if (directory && (expanded || compressed)) failure("gosu_zip_profile_invalid");
    const body = directory ? Buffer.alloc(0) : method === 0 ? Buffer.from(packed) : await inflate(packed, expanded, limits.memberBytes);
    if (body.length !== expanded || crc32(body) !== crc) failure("gosu_zip_crc_invalid");
    total += body.length; if (total > limits.totalBytes) failure("gosu_archive_total_limit");
    const entry = { path: itemPath, type: directory ? "directory" : "file", bytes: body.length, ...(directory ? {} : { sha256: sha256(body) }) }; entries.push(entry);
    if (!directory && options.onFile) await options.onFile(entry, body); ranges.push([localAt, descriptorAt + 16]); offset += 46 + nameLength;
  }
  ranges.sort((a, b) => a[0] - b[0]); if (!ranges.length || ranges[0][0] !== 0 || ranges.at(-1)[1] !== centralAt || ranges.some((range, index) => index && ranges[index - 1][1] !== range[0])) failure("gosu_zip_local_layout_invalid");
  if (offset !== end) failure("gosu_zip_directory_invalid"); return Object.freeze({ entries, regularBytes: total });
}

function putOctal(block, offset, length, value) { const text = value.toString(8).padStart(length - 1, "0"); if (text.length >= length) failure("gosu_ustar_value_invalid"); block.write(text, offset, length - 1, "ascii"); }
function splitUstarName(name) { if (Buffer.byteLength(name) <= 100) return [name, ""]; for (let at = name.lastIndexOf("/"); at > 0; at = name.lastIndexOf("/", at - 1)) { const prefix = name.slice(0, at); const leaf = name.slice(at + 1); if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(leaf) <= 100) return [leaf, prefix]; } failure("gosu_ustar_path_invalid"); }
export async function writeDeterministicUstar(entries, destination, limits = GOSU_ARCHIVE_LIMITS_V1.publicTree) {
  const handle = await open(destination, "wx", 0o600); try {
    for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path, "en"))) {
      const itemPath = canonicalArchivePath(entry.path, limits, { directory: entry.type === "directory" }); const data = entry.type === "file" ? Buffer.from(entry.bytes) : Buffer.alloc(0); if (data.length > limits.memberBytes) failure("gosu_ustar_value_invalid"); const [name, prefix] = splitUstarName(itemPath);
      const block = Buffer.alloc(BLOCK); block.write(name); putOctal(block, 100, 8, entry.type === "directory" ? 0o755 : 0o644); putOctal(block, 108, 8, 0); putOctal(block, 116, 8, 0); putOctal(block, 124, 12, data.length); putOctal(block, 136, 12, 0); block.fill(0x20, 148, 156); block[156] = entry.type === "directory" ? 53 : 48; block.write("ustar\0", 257, 6, "ascii"); block.write("00", 263, 2, "ascii"); block.write(prefix, 345); putOctal(block, 329, 8, 0); putOctal(block, 337, 8, 0); putOctal(block, 148, 8, block.reduce((sum, byte) => sum + byte, 0));
      await handle.write(block); if (data.length) await handle.write(data); const padding = (BLOCK - data.length % BLOCK) % BLOCK; if (padding) await handle.write(Buffer.alloc(padding));
    }
    await handle.write(Buffer.alloc(BLOCK * 2));
  } finally { await handle.close(); }
  const bytes = await readFile(destination); if (bytes.length > GOSU_ARCHIVE_LIMITS_V1.preparationTarBytes) failure("gosu_preparation_tar_limit"); return exactIdentity(bytes);
}

export async function scanPreparationTar(file, expected, allowlist) {
  const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > GOSU_ARCHIVE_LIMITS_V1.preparationTarBytes) failure("gosu_preparation_tar_invalid");
  const bytes = await readFile(file); assertIdentity(bytes, expected, "gosu_transport_identity_invalid"); const consumer = new TarConsumer(GOSU_ARCHIVE_LIMITS_V1.publicTree, { strictUstar: true, onFile: async (entry, body) => { if (!allowlist.has(entry.path)) failure("gosu_public_output_unknown"); entry.body = body; } }); await consumer.push(bytes); await consumer.drain(true);
  if (consumer.entries.some((entry) => entry.type !== "file") || consumer.entries.length !== allowlist.size) failure("gosu_public_output_invalid"); return consumer.entries;
}

export async function scanRawUstar(bytes, limits = GOSU_ARCHIVE_LIMITS_V1.sumdb, options = {}) {
  const consumer = new TarConsumer(limits, { ...options, strictUstar: true }); await consumer.push(Buffer.from(bytes)); await consumer.drain(true); return Object.freeze({ entries: consumer.entries, regularBytes: consumer.regularTotal, expandedBytes: consumer.total });
}

export async function materializeArchiveFile(root, relative, bytes, mode = 0o600) { const target = path.join(root, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx", mode: mode & 0o777 }); }
