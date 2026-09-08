import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { StrictDataError } from "./strict-json.mjs";

const BLOCK = 512;
const NATIVE_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
const NATIVE_ARCHIVE_ENTRIES = 200_000;
const NATIVE_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const GO_PAX_RECORDS = Object.freeze([
  Object.freeze({
    header: "go/test/fixedbugs/issue27836.dir/PaxHeaders.0/foo.go",
    path: "go/test/fixedbugs/issue27836.dir/Þfoo.go",
    payload: "50 path=go/test/fixedbugs/issue27836.dir/Þfoo.go\n",
    target: "go/test/fixedbugs/issue27836.dir/foo.go",
  }),
  Object.freeze({
    header: "go/test/fixedbugs/issue27836.dir/PaxHeaders.0/main.go",
    path: "go/test/fixedbugs/issue27836.dir/Þmain.go",
    payload: "51 path=go/test/fixedbugs/issue27836.dir/Þmain.go\n",
    target: "go/test/fixedbugs/issue27836.dir/main.go",
  }),
]);
const TRIVY_LINKS = Object.freeze(new Map([
  ["pkg/fanal/analyzer/language/golang/binary/testdata/symlink", "foo"],
  ["pkg/fanal/analyzer/language/rust/binary/testdata/symlink", "foo"],
  ["pkg/fanal/walker/testdata/fs/sym.txt", "bar"],
]));
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

const validateHeader = (header, allowedTypes) => {
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
  if (!allowedTypes.has(type)) fail("TAR_TYPE_UNSUPPORTED");
  const prefix = decodeField(header.subarray(345, 500));
  const base = decodeField(header.subarray(0, 100));
  const rawName = prefix ? `${prefix}/${base}` : base;
  const name = safePath(rawName, type);
  const size = parseOctal(header.subarray(124, 136));
  if (type === "5" && size !== 0) fail("TAR_DIRECTORY_SIZE_INVALID");
  if (type === "2" && size !== 0) fail("TAR_LINK_INVALID");
  if ((type === "2" || type === "x") && size > 256 * 1024) fail("TAR_SPECIAL_SIZE_INVALID");
  const linkTarget = decodeField(header.subarray(157, 257));
  if ((type === "0" || type === "5" || type === "x") && linkTarget !== "") {
    fail("TAR_LINK_INVALID");
  }
  if (type === "2" && (linkTarget === "" || linkTarget.startsWith("/") || linkTarget.includes("\\") ||
      /^[A-Za-z]:/u.test(linkTarget) || linkTarget.split("/").some((part) => part === "" || part === "." || part === ".."))) {
    fail("TAR_LINK_INVALID");
  }
  return { linkTarget, name, size, type };
};

async function validateArchive(
  input,
  {
    closeStreams = [],
    maxArchiveBytes = 32 * 1024,
    maxEntries = 1_000,
    maxFileBytes = 256 * 1024,
    maxTotalFileBytes = 32 * 1024,
  } = {},
  profile = Object.freeze({ allowedTypes: new Set(["0", "5"]), kind: "strict" }),
) {
  const reader = new StreamReader(input, maxArchiveBytes, closeStreams);
  const names = new Set();
  const entries = [];
  let totalFileBytes = 0;
  let terminators = 0;
  const profileState = {
    directories: 0,
    effectiveNames: new Set(),
    files: 0,
    links: new Map(),
    paxIndex: 0,
    pendingPax: null,
    rootSeen: false,
  };

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
        if (profileState.pendingPax) fail("TAR_PAX_TARGET_MISSING");
        if (profile.kind === "go" &&
            (profileState.paxIndex !== GO_PAX_RECORDS.length || profileState.directories !== 1_667 || profileState.files !== 15_036)) {
          fail("TAR_GO_PROFILE_MISMATCH");
        }
        if (profile.kind === "native") {
          if (!profileState.rootSeen) fail("TAR_NATIVE_ROOT_INVALID");
          const expectedLinks = profile.tool === "trivy" ? TRIVY_LINKS : new Map();
          if (profileState.links.size !== expectedLinks.size) fail("TAR_NATIVE_LINK_SET_INVALID");
          for (const [relative, target] of expectedLinks) {
            if (profileState.links.get(`${profile.prefix}/${relative}`) !== target) fail("TAR_NATIVE_LINK_SET_INVALID");
          }
        }
        return Object.freeze(entries.map((entry) => Object.freeze(entry)));
      }
      if (terminators !== 0) fail("TAR_TERMINATOR_INVALID");
      const entry = validateHeader(header, profile.allowedTypes);
      if (names.has(entry.name)) fail("TAR_PATH_DUPLICATE");
      names.add(entry.name);
      if (entries.length >= maxEntries) fail("TAR_ENTRIES_EXCEEDED");
      if (entry.size > maxFileBytes) fail("TAR_FILE_TOO_LARGE");
      totalFileBytes += entry.size;
      if (!Number.isSafeInteger(totalFileBytes) || totalFileBytes > maxTotalFileBytes) {
        fail("TAR_TOTAL_TOO_LARGE");
      }
      let body;
      const hash = createHash("sha256");
      if (entry.type === "x") {
        body = await reader.read(entry.size);
        hash.update(body);
      } else {
        await reader.consume(entry.size, (part) => hash.update(part));
      }
      const padding = (BLOCK - (entry.size % BLOCK)) % BLOCK;
      if (padding > 0 && !isZero(await reader.read(padding))) fail("TAR_PADDING_INVALID");

      if (profile.kind === "go") {
        if (entry.name !== "go" && !entry.name.startsWith("go/")) fail("TAR_GO_PATH_INVALID");
        if (entry.type === "x") {
          if (profileState.pendingPax) fail("TAR_GO_PAX_TARGET_INVALID");
          const expected = GO_PAX_RECORDS[profileState.paxIndex];
          if (!expected || entry.name !== expected.header || !body.equals(Buffer.from(expected.payload, "utf8"))) {
            fail("TAR_GO_PAX_INVALID");
          }
          profileState.pendingPax = expected.target;
          profileState.paxIndex += 1;
          continue;
        }
        let effectiveName = entry.name;
        if (profileState.pendingPax) {
          if (entry.type !== "0" || entry.name !== profileState.pendingPax) fail("TAR_GO_PAX_TARGET_INVALID");
          effectiveName = GO_PAX_RECORDS[profileState.paxIndex - 1].path;
          profileState.pendingPax = null;
        }
        if (profileState.effectiveNames.has(effectiveName)) fail("TAR_PATH_DUPLICATE");
        profileState.effectiveNames.add(effectiveName);
      }
      if (profile.kind === "native") {
        if (entry.name !== profile.prefix && !entry.name.startsWith(`${profile.prefix}/`)) {
          fail("TAR_NATIVE_PATH_INVALID");
        }
        for (const relative of TRIVY_LINKS.keys()) {
          if (entry.name.startsWith(`${profile.prefix}/${relative}/`)) fail("TAR_NATIVE_LINK_ANCESTOR_INVALID");
        }
        if (entry.name === profile.prefix) {
          if (entry.type !== "5") fail("TAR_NATIVE_ROOT_INVALID");
          profileState.rootSeen = true;
        }
        if (entry.type === "2") {
          const relative = entry.name.slice(profile.prefix.length + 1);
          if (profile.tool !== "trivy") fail("TAR_NATIVE_LINK_INVALID");
          if (!TRIVY_LINKS.has(relative)) fail("TAR_NATIVE_LINK_PATH_INVALID");
          if (TRIVY_LINKS.get(relative) !== entry.linkTarget) fail("TAR_NATIVE_LINK_TARGET_INVALID");
          if (profileState.links.has(entry.name)) fail("TAR_NATIVE_LINK_INVALID");
          profileState.links.set(entry.name, entry.linkTarget);
        }
      }
      if (entry.type === "0") profileState.files += 1;
      if (entry.type === "5") profileState.directories += 1;
      entries.push({
        ...(entry.type === "2" ? { linkTarget: entry.linkTarget } : {}),
        path: entry.name,
        sha256: hash.digest("hex"),
        size: entry.size,
        type: entry.type === "5" ? "directory" : entry.type === "2" ? "symlink" : "file",
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

export function validateTarArchive(input, options = {}) {
  return validateArchive(input, options);
}

export function validateGoCompilerTarArchive(input, { closeStreams = [] } = {}) {
  return validateArchive(input, {
    closeStreams,
    maxArchiveBytes: NATIVE_ARCHIVE_BYTES,
    maxEntries: NATIVE_ARCHIVE_ENTRIES,
    maxFileBytes: NATIVE_FILE_BYTES,
    maxTotalFileBytes: NATIVE_ARCHIVE_BYTES,
  }, Object.freeze({ allowedTypes: new Set(["0", "5", "x"]), kind: "go" }));
}

export function validateNativeSourceTarArchive(
  input,
  { closeStreams = [], expectedPrefix, tool } = {},
) {
  if (!new Set(["oras", "cosign", "trivy"]).has(tool) ||
      typeof expectedPrefix !== "string" || !/^[a-z0-9_.-]+-[0-9a-f]{40}$/u.test(expectedPrefix)) {
    fail("TAR_NATIVE_PROFILE_INVALID");
  }
  return validateArchive(input, {
    closeStreams,
    maxArchiveBytes: NATIVE_ARCHIVE_BYTES,
    maxEntries: NATIVE_ARCHIVE_ENTRIES,
    maxFileBytes: NATIVE_FILE_BYTES,
    maxTotalFileBytes: NATIVE_ARCHIVE_BYTES,
  }, Object.freeze({ allowedTypes: new Set(["0", "2", "5"]), kind: "native", prefix: expectedPrefix, tool }));
}
