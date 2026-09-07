import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createReadStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { createGunzip, gzipSync } from "node:zlib";
import { validateTarArchive } from "../scripts/supply-chain/archive.mjs";

const BLOCK = 512;
const code = (expected) => (error) => error?.code === expected;
const octal = (value, length) => Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`);

const header = (name, size, type = "0", checksumEncoding = "nul-space") => {
  const value = Buffer.alloc(BLOCK);
  value.write(name, 0, 100, "utf8");
  octal(0o644, 8).copy(value, 100);
  octal(0, 8).copy(value, 108);
  octal(0, 8).copy(value, 116);
  octal(size, 12).copy(value, 124);
  octal(0, 12).copy(value, 136);
  value.fill(0x20, 148, 156);
  value.write(type, 156, 1, "ascii");
  value.write("ustar", 257, 5, "ascii");
  value.write("00", 263, 2, "ascii");
  const checksum = value.reduce((sum, byte) => sum + byte, 0);
  const digits = checksum.toString(8);
  const encoded = checksumEncoding === "seven-nul"
    ? `${digits.padStart(7, "0")}\0`
    : `${digits.padStart(6, "0")}\0 `;
  Buffer.from(encoded).copy(value, 148);
  return value;
};
const tar = (entries, { terminators = 2 } = {}) => {
  const parts = [];
  for (const entry of entries) {
    const contents = Buffer.from(entry.contents ?? "");
    parts.push(header(entry.name, contents.length, entry.type));
    parts.push(contents);
    parts.push(Buffer.alloc((BLOCK - (contents.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * terminators));
  return Buffer.concat(parts);
};
async function* chunks(bytes) {
  for (let offset = 0; offset < bytes.length; offset += 37) {
    yield bytes.subarray(offset, offset + 37);
  }
}
const trackedSource = (bytes, chunkSize = bytes.length) => {
  let offset = 0;
  let reads = 0;
  let returned = false;
  const iterator = {
    async next() {
      reads += 1;
      if (offset >= bytes.length) return { done: true };
      const value = bytes.subarray(offset, offset + chunkSize);
      offset += value.length;
      return { done: false, value };
    },
    async return() {
      returned = true;
      return { done: true };
    },
  };
  return {
    get reads() {
      return reads;
    },
    get returned() {
      return returned;
    },
    source: {
      [Symbol.asyncIterator]() {
        return iterator;
      },
    },
  };
};

test("tar validator streams file hashes without extracting contents", async () => {
  const archive = tar([{ name: "blobs/sha256/value", contents: "payload" }]);
  const entries = await validateTarArchive(chunks(archive), {
    maxArchiveBytes: archive.length,
    maxFileBytes: 7,
    maxTotalFileBytes: 7,
  });
  assert.deepEqual(entries, [{
    path: "blobs/sha256/value",
    sha256: "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
    size: 7,
    type: "file",
  }]);
  await assert.rejects(
    validateTarArchive(archive, { maxArchiveBytes: archive.length - 1 }),
    code("TAR_ARCHIVE_TOO_LARGE"),
  );
  await assert.rejects(
    validateTarArchive(archive, { maxFileBytes: 6 }),
    code("TAR_FILE_TOO_LARGE"),
  );
});

test("tar validator accepts canonical directory entries and normalizes their path", async () => {
  const entries = await validateTarArchive(tar([{ name: "blobs/", type: "5" }]));
  assert.deepEqual(entries, [{
    path: "blobs",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    size: 0,
    type: "directory",
  }]);
});

test("tar validator accepts the two supported checksum terminators", async () => {
  const sevenDigitHeader = header("file", 0, "0", "seven-nul");
  const archive = Buffer.concat([sevenDigitHeader, Buffer.alloc(BLOCK * 2)]);
  assert.equal((await validateTarArchive(archive))[0].path, "file");

  const paxHeader = header("pax_global_header", 0, "g", "seven-nul");
  await assert.rejects(
    validateTarArchive(Buffer.concat([paxHeader, Buffer.alloc(BLOCK * 2)])),
    code("TAR_TYPE_UNSUPPORTED"),
  );
});

test("tar validator rejects traversal, absolute, drive, and duplicate paths", async () => {
  for (const name of ["../escape", "/absolute", "C:/drive", "a//b", "a/./b"]) {
    await assert.rejects(validateTarArchive(tar([{ name }])), code("TAR_PATH_INVALID"));
  }
  await assert.rejects(
    validateTarArchive(tar([{ name: "same" }, { name: "same" }])),
    code("TAR_PATH_DUPLICATE"),
  );
});

test("tar validator rejects links, devices, PAX, sparse, and malformed checksums", async () => {
  for (const type of ["1", "2", "3", "4", "6", "x", "g", "S", "L", "K"]) {
    await assert.rejects(validateTarArchive(tar([{ name: "unsafe", type }])), code("TAR_TYPE_UNSUPPORTED"));
  }
  const invalid = tar([{ name: "file" }]);
  invalid[0] ^= 1;
  await assert.rejects(validateTarArchive(invalid), code("TAR_CHECKSUM_INVALID"));

  const invalidTerminator = tar([{ name: "file" }]);
  invalidTerminator[154] = 0x20;
  invalidTerminator[155] = 0;
  await assert.rejects(validateTarArchive(invalidTerminator), code("TAR_CHECKSUM_INVALID"));
});

test("tar validator rejects nonzero padding, incomplete terminators, count, and aggregate overflow", async () => {
  const badPadding = tar([{ name: "file", contents: "x" }]);
  badPadding[BLOCK + 1] = 1;
  await assert.rejects(validateTarArchive(badPadding), code("TAR_PADDING_INVALID"));

  await assert.rejects(
    validateTarArchive(tar([{ name: "file" }], { terminators: 1 })),
    code("TAR_TERMINATOR_MISSING"),
  );
  await assert.rejects(
    validateTarArchive(tar([{ name: "one" }, { name: "two" }]), { maxEntries: 1 }),
    code("TAR_ENTRIES_EXCEEDED"),
  );
  await assert.rejects(
    validateTarArchive(tar([{ name: "one", contents: "12" }, { name: "two", contents: "34" }]), {
      maxTotalFileBytes: 3,
    }),
    code("TAR_TOTAL_TOO_LARGE"),
  );
});

test("tar validator rejects missing blocks and trailing nonzero data", async () => {
  const truncated = tar([{ name: "file", contents: "payload" }]).subarray(0, 700);
  await assert.rejects(validateTarArchive(truncated), code("TAR_TRUNCATED"));

  const trailing = Buffer.concat([tar([{ name: "file" }]), Buffer.alloc(BLOCK, 1)]);
  await assert.rejects(validateTarArchive(trailing), code("TAR_TRAILING_DATA"));
});

test("tar validator rejects malformed header encoding and stream failures with fixed codes", async () => {
  const malformed = tar([{ name: "file" }]);
  malformed[0] = 0xc3;
  malformed[1] = 0x28;
  malformed.fill(0x20, 148, 156);
  const checksum = malformed.subarray(0, BLOCK).reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(malformed, 148);
  await assert.rejects(validateTarArchive(malformed), code("TAR_HEADER_ENCODING_INVALID"));

  async function* failingStream() {
    yield Buffer.alloc(10);
    throw new Error("sensitive transport detail");
  }
  await assert.rejects(validateTarArchive(failingStream()), code("TAR_STREAM_INVALID"));
});

test("tar validator returns an async iterator after validation rejection", async () => {
  const invalid = tar([{ name: "file" }]);
  invalid[0] ^= 1;
  let returned = false;
  let reads = 0;
  const source = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      reads += 1;
      return { done: false, value: invalid };
    },
    async return() {
      returned = true;
      return { done: true };
    },
  };

  await assert.rejects(validateTarArchive(source), code("TAR_CHECKSUM_INVALID"));
  assert.equal(returned, true);
  assert.equal(reads, 1, "closing the source must not read another chunk");
});

test("tar validator returns async iterators after success and limit rejection", async () => {
  const archive = tar([{ name: "file", contents: "payload" }]);
  const successful = trackedSource(archive, 37);
  await validateTarArchive(successful.source);
  assert.equal(successful.returned, true);

  const limited = trackedSource(archive);
  await assert.rejects(
    validateTarArchive(limited.source, { maxArchiveBytes: BLOCK - 1 }),
    code("TAR_ARCHIVE_TOO_LARGE"),
  );
  assert.equal(limited.returned, true);
  assert.equal(limited.reads, 1, "limit cleanup must not read another chunk");
});

test("iterator cleanup failure does not replace the validation error", async () => {
  const invalid = tar([{ name: "file" }]);
  invalid[0] ^= 1;
  const source = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      return { done: false, value: invalid };
    },
    async return() {
      throw new Error("cleanup detail that must stay hidden");
    },
  };
  await assert.rejects(validateTarArchive(source), code("TAR_CHECKSUM_INVALID"));
});

test("tar validator destroys a file-to-gunzip stream chain after rejection", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "auto-world-tar-stream-"));
  const archivePath = path.join(directory, "invalid.tar.gz");
  const invalid = tar([{ name: "file" }]);
  invalid[0] ^= 1;
  writeFileSync(archivePath, gzipSync(Buffer.concat([invalid, randomBytes(2 * 1024 * 1024)])));
  const source = createReadStream(archivePath, { highWaterMark: 1024 });
  const gunzip = source.pipe(createGunzip());

  try {
    await assert.rejects(
      validateTarArchive(gunzip, {
        closeStreams: [source],
        maxArchiveBytes: 4 * 1024 * 1024,
      }),
      code("TAR_CHECKSUM_INVALID"),
    );
    await new Promise((resolve, reject) => {
      if (source.closed) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => reject(new Error("source stream did not close")), 1_000);
      source.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    assert.equal(source.destroyed, true);
    assert.equal(gunzip.destroyed, true);
  } finally {
    source.destroy();
    gunzip.destroy();
    rmSync(directory, { force: true, recursive: true });
  }
});
