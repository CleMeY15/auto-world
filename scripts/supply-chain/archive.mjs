import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { StrictDataError } from "./strict-json.mjs";

const BLOCK = 512;
const fail = (code) => {
  throw new StrictDataError(code);
};
const isZero = (bytes) => bytes.every((byte) => byte === 0);
const decodeField = (bytes) => {
  const end = bytes.indexOf(0);
  if (end !== -1 && !isZero(bytes.subarray(end + 1))) fail("TAR_FIELD_INVALID");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, end === -1 ? bytes.length : end),
    );
  } catch {
    fail("TAR_HEADER_ENCODING_INVALID");
  }
};
const parseOctal = (bytes) => {
  if ((bytes[0] & 0x80) !== 0) fail("TAR_NUMBER_INVALID");
  const text = decodeField(bytes).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/u.test(text)) fail("TAR_NUMBER_INVALID");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) fail("TAR_NUMBER_INVALID");
  return value;
};
const safePath = (name, type) => {
  const normalized = type === "5" && name.endsWith("/") ? name.slice(0, -1) : name;
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..") ||
    (type === "0" && name.endsWith("/"))
  ) {
    fail("TAR_PATH_INVALID");
  }
  return normalized;
};
const toChunks = async function* (input) {
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    yield Buffer.from(input);
    return;
  }
  if (input?.[Symbol.asyncIterator]) {
    const iterator = input[Symbol.asyncIterator]();
    try {
      while (true) {
        const result = await iterator.next();
        if (result.done) return;
        if (!Buffer.isBuffer(result.value) && !(result.value instanceof Uint8Array)) {
          fail("TAR_INPUT_INVALID");
        }
        yield Buffer.from(result.value);
      }
    } finally {
      if (typeof iterator.return === "function") await iterator.return();
    }
  }
  if (input?.[Symbol.iterator]) {
    const iterator = input[Symbol.iterator]();
    try {
      while (true) {
        const result = iterator.next();
        if (result.done) return;
        if (!Buffer.isBuffer(result.value) && !(result.value instanceof Uint8Array)) {
          fail("TAR_INPUT_INVALID");
        }
        yield Buffer.from(result.value);
      }
    } finally {
      if (typeof iterator.return === "function") iterator.return();
    }
  }
  fail("TAR_INPUT_INVALID");
};

class StreamReader {
  constructor(input, maximum, closeStreams) {
    this.input = input;
    this.closeStreams = closeStreams;
    this.iterator = toChunks(input)[Symbol.asyncIterator]();
    this.chunk = Buffer.alloc(0);
    this.offset = 0;
    this.done = false;
    this.maximum = maximum;
    this.total = 0;
  }

  async close(suppressFailure) {
    let closeFailed = false;
    try {
      if (typeof this.iterator.return === "function") {
        await this.iterator.return();
      }
    } catch {
      closeFailed = true;
    }
    try {
      if (typeof this.input?.destroy === "function" && this.input.destroyed !== true) {
        this.input.destroy();
      }
    } catch {
      closeFailed = true;
    }
    if (Array.isArray(this.closeStreams)) {
      const closed = new Set([this.input]);
      for (const stream of this.closeStreams) {
        if (closed.has(stream)) continue;
        closed.add(stream);
        try {
          if (typeof stream?.destroy === "function" && stream.destroyed !== true) {
            stream.destroy();
          }
        } catch {
          closeFailed = true;
        }
      }
    }
    if (closeFailed && !suppressFailure) fail("TAR_STREAM_CLOSE_FAILED");
  }

  async nextChunk() {
    while (this.offset >= this.chunk.length && !this.done) {
      let result;
      try {
        result = await this.iterator.next();
      } catch {
        fail("TAR_STREAM_INVALID");
      }
      this.done = result.done === true;
      this.chunk = this.done ? Buffer.alloc(0) : result.value;
      this.offset = 0;
      if (!this.done && this.chunk.length === 0) continue;
    }
  }

  async consume(length, visitor) {
    let remaining = length;
    while (remaining > 0) {
      await this.nextChunk();
      if (this.done) fail("TAR_TRUNCATED");
      const count = Math.min(remaining, this.chunk.length - this.offset);
      const slice = this.chunk.subarray(this.offset, this.offset + count);
      this.offset += count;
      remaining -= count;
      this.total += count;
      if (this.total > this.maximum) fail("TAR_ARCHIVE_TOO_LARGE");
      visitor(slice);
    }
  }

  async read(length) {
    const parts = [];
    await this.consume(length, (part) => parts.push(part));
    return Buffer.concat(parts, length);
  }

  async hasMore() {
    await this.nextChunk();
    return !this.done;
  }
}

const validateHeader = (header) => {
  const checksumField = header.subarray(148, 156);
  let checksumText;
  if (checksumField[6] === 0 && checksumField[7] === 0x20) {
    checksumText = checksumField.subarray(0, 6).toString("ascii");
  } else if (checksumField[7] === 0) {
    checksumText = checksumField.subarray(0, 7).toString("ascii");
  } else {
    fail("TAR_CHECKSUM_INVALID");
  }
  if (!/^[0-7]+$/u.test(checksumText)) fail("TAR_CHECKSUM_INVALID");
  const storedChecksum = Number.parseInt(checksumText, 8);
  let calculated = 0;
  for (let index = 0; index < header.length; index += 1) {
    calculated += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (storedChecksum !== calculated) fail("TAR_CHECKSUM_INVALID");
  const magic = decodeField(header.subarray(257, 263));
  const version = header.subarray(263, 265).toString("binary");
  if (magic !== "ustar" || version !== "00") fail("TAR_FORMAT_UNSUPPORTED");
  const type = header[156] === 0 ? "0" : String.fromCharCode(header[156]);
  if (!new Set(["0", "5"]).has(type)) fail("TAR_TYPE_UNSUPPORTED");
  const prefix = decodeField(header.subarray(345, 500));
  const base = decodeField(header.subarray(0, 100));
  const rawName = prefix ? `${prefix}/${base}` : base;
  const name = safePath(rawName, type);
  const size = parseOctal(header.subarray(124, 136));
  if (type === "5" && size !== 0) fail("TAR_DIRECTORY_SIZE_INVALID");
  if (decodeField(header.subarray(157, 257)) !== "") fail("TAR_LINK_INVALID");
  return { name, size, type };
};

export async function validateTarArchive(
  input,
  {
    closeStreams = [],
    maxArchiveBytes = 32 * 1024,
    maxEntries = 1_000,
    maxFileBytes = 256 * 1024,
    maxTotalFileBytes = 32 * 1024,
  } = {},
) {
  const reader = new StreamReader(input, maxArchiveBytes, closeStreams);
  const names = new Set();
  const entries = [];
  let totalFileBytes = 0;
  let terminators = 0;

  let validationFailed = false;
  try {
    for (const limit of [maxArchiveBytes, maxEntries, maxFileBytes, maxTotalFileBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 0) fail("TAR_LIMIT_INVALID");
    }
    if (
      !Array.isArray(closeStreams) ||
      closeStreams.some((stream) => typeof stream?.destroy !== "function")
    ) {
      fail("TAR_CLOSE_STREAMS_INVALID");
    }
    while (await reader.hasMore()) {
      const header = await reader.read(BLOCK);
      if (isZero(header)) {
        terminators += 1;
        if (terminators < 2) continue;
        while (await reader.hasMore()) {
          const trailing = await reader.read(BLOCK);
          if (!isZero(trailing)) fail("TAR_TRAILING_DATA");
        }
        return Object.freeze(entries.map((entry) => Object.freeze(entry)));
      }
      if (terminators !== 0) fail("TAR_TERMINATOR_INVALID");
      const entry = validateHeader(header);
      if (names.has(entry.name)) fail("TAR_PATH_DUPLICATE");
      names.add(entry.name);
      if (entries.length >= maxEntries) fail("TAR_ENTRIES_EXCEEDED");
      if (entry.size > maxFileBytes) fail("TAR_FILE_TOO_LARGE");
      totalFileBytes += entry.size;
      if (!Number.isSafeInteger(totalFileBytes) || totalFileBytes > maxTotalFileBytes) {
        fail("TAR_TOTAL_TOO_LARGE");
      }
      const hash = createHash("sha256");
      await reader.consume(entry.size, (part) => hash.update(part));
      const padding = (BLOCK - (entry.size % BLOCK)) % BLOCK;
      if (padding > 0 && !isZero(await reader.read(padding))) fail("TAR_PADDING_INVALID");
      entries.push({
        path: entry.name,
        sha256: hash.digest("hex"),
        size: entry.size,
        type: entry.type === "5" ? "directory" : "file",
      });
    }
    fail("TAR_TERMINATOR_MISSING");
  } catch (error) {
    validationFailed = true;
    throw error;
  } finally {
    await reader.close(validationFailed);
  }
}
