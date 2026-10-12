import assert from "node:assert/strict";
import { link, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import {
  GOSU_ARCHIVE_LIMITS_V1, scanGzipTar, scanModuleZip, scanPreparationTar, sha256, writeDeterministicUstar,
} from "../scripts/postgres-image/gosu-derivative-archives-v1.mjs";

function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function zip(name, body, { flags = 8, method = 8, extra = Buffer.alloc(0), descriptor = true, signed = true, packedSuffix = Buffer.alloc(0) } = {}) {
  const nameBytes = Buffer.from(name); const packed = Buffer.concat([method === 8 ? deflateRawSync(body) : body, packedSuffix]); const crc = crc32(body);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(extra.length, 28);
  const tail = descriptor ? Buffer.alloc(signed ? 16 : 12) : Buffer.alloc(0); if (descriptor) { const at = signed ? 4 : 0; if (signed) tail.writeUInt32LE(0x08074b50); tail.writeUInt32LE(crc, at); tail.writeUInt32LE(packed.length, at + 4); tail.writeUInt32LE(body.length, at + 8); }
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt16LE(extra.length, 30);
  const centralAt = local.length + nameBytes.length + extra.length + packed.length + tail.length; const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + nameBytes.length + extra.length, 12); end.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, nameBytes, extra, packed, tail, central, nameBytes, extra, end]);
}
async function temp() { return mkdtemp(path.join(os.tmpdir(), "gosu-derivative-test-")); }

test("strict USTAR round trip authenticates exact bytes and rejects trailing, truncation and changed identity", async () => {
  const root = await temp(); try {
    const tar = path.join(root, "fixture.tar"); await writeDeterministicUstar([{ path: "root/file", type: "file", bytes: Buffer.from("safe") }], tar); const raw = await readFile(tar); const gz = gzipSync(raw, { mtime: 0 }); const expected = { bytes: gz.length, sha256: sha256(gz) };
    const result = await scanGzipTar(gz, expected, GOSU_ARCHIVE_LIMITS_V1.gosu); assert.equal(result.entries[0].path, "root/file"); assert.equal(result.regularBytes, 4);
    for (const suffix of [Buffer.from("x"), Buffer.from([1, 2, 3, 4])]) { const trailing = Buffer.concat([gz, suffix]); await assert.rejects(scanGzipTar(trailing, { bytes: trailing.length, sha256: sha256(trailing) }, GOSU_ARCHIVE_LIMITS_V1.gosu), /gosu_archive_(?:gzip|tar)/u); }
    await assert.rejects(scanGzipTar(gz.subarray(0, -1), { bytes: gz.length - 1, sha256: sha256(gz.subarray(0, -1)) }, GOSU_ARCHIVE_LIMITS_V1.gosu), /gosu_archive_gzip_invalid/u);
    await assert.rejects(scanGzipTar(gz, { bytes: gz.length, sha256: "0".repeat(64) }, GOSU_ARCHIVE_LIMITS_V1.gosu), /gosu_material_identity_invalid/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Go module ZIP profile checks descriptor, CRC, flags, extras, names and exact EOF", async () => {
  const good = zip("example.test/mod@v1.0.0/LICENSE", Buffer.from("license")); const expected = { bytes: good.length, sha256: sha256(good) };
  const result = await scanModuleZip(good, expected); assert.equal(result.entries.length, 1); assert.equal(result.regularBytes, 7);
  const badCrc = Buffer.from(good); badCrc.writeUInt32LE(0, 30 + Buffer.byteLength("example.test/mod@v1.0.0/LICENSE") + deflateRawSync(Buffer.from("license")).length + 4);
  await assert.rejects(scanModuleZip(badCrc, { bytes: badCrc.length, sha256: sha256(badCrc) }), /gosu_zip_descriptor_invalid/u);
  for (const bad of [zip("../escape", Buffer.from("x")), zip("a\\b", Buffer.from("x")), zip("safe", Buffer.from("x"), { flags: 0 }), zip("safe", Buffer.from("x"), { extra: Buffer.from([1]) })]) await assert.rejects(scanModuleZip(bad, { bytes: bad.length, sha256: sha256(bad) }), /gosu_(?:archive_path|zip_profile)_invalid/u);
  const unsigned = zip("safe", Buffer.from("x"), { signed: false }); await assert.rejects(scanModuleZip(unsigned, { bytes: unsigned.length, sha256: sha256(unsigned) }), /gosu_zip_descriptor_invalid/u);
  const deflateTrailing = zip("safe", Buffer.from("x"), { packedSuffix: Buffer.from([1, 2, 3, 4]) }); await assert.rejects(scanModuleZip(deflateTrailing, { bytes: deflateTrailing.length, sha256: sha256(deflateTrailing) }), /gosu_zip_deflate_trailing_invalid/u);
  const trailing = Buffer.concat([good, Buffer.alloc(1)]); await assert.rejects(scanModuleZip(trailing, { bytes: trailing.length, sha256: sha256(trailing) }), /gosu_zip_eof_invalid/u);
});

test("archive implementation stays Node builtins only and encodes all fixed caps", async () => {
  const source = await readFile(new URL("../scripts/postgres-image/gosu-derivative-archives-v1.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'](?:tar|adm-zip|yauzl|unzipper)|python|execFile|spawn/u);
  assert.deepEqual(GOSU_ARCHIVE_LIMITS_V1.gosu, { members: 64, memberBytes: 65536, totalBytes: 262144, depth: 8, pathBytes: 256 });
  assert.equal(GOSU_ARCHIVE_LIMITS_V1.preparationTarBytes, 132 * 1024 ** 2);
});

test("preparation transport authenticates the originating byte identity before exposing members", async () => {
  const root = await temp(); try { const tar = path.join(root, "preparation.tar"); const identity = await writeDeterministicUstar([{ path: "only.txt", type: "file", bytes: Buffer.from("retained") }], tar); const entries = await scanPreparationTar(tar, identity, new Set(["only.txt"])); assert.equal(entries[0].body.toString(), "retained"); await assert.rejects(scanPreparationTar(tar, { ...identity, sha256: "0".repeat(64) }, new Set(["only.txt"])), /gosu_transport_identity_invalid/u); await assert.rejects(scanPreparationTar(tar, identity, new Set(["other.txt"])), /gosu_public_output_unknown/u); const hardlink = path.join(root, "linked.tar"); await link(tar, hardlink); await assert.rejects(scanPreparationTar(hardlink, identity, new Set(["only.txt"])), /gosu_preparation_tar_invalid/u);
    const raw = await readFile(tar); const badPadding = Buffer.from(raw); badPadding[512 + Buffer.byteLength("retained")] = 1; const badPaddingFile = path.join(root, "bad-padding.tar"); await import("node:fs/promises").then((fs) => fs.writeFile(badPaddingFile, badPadding)); await assert.rejects(scanPreparationTar(badPaddingFile, { bytes: badPadding.length, sha256: sha256(badPadding) }, new Set(["only.txt"])), /gosu_tar_padding_invalid/u);
    const extraZero = Buffer.concat([raw, Buffer.alloc(512)]); const extraZeroFile = path.join(root, "extra-zero.tar"); await import("node:fs/promises").then((fs) => fs.writeFile(extraZeroFile, extraZero)); await assert.rejects(scanPreparationTar(extraZeroFile, { bytes: extraZero.length, sha256: sha256(extraZero) }, new Set(["only.txt"])), /gosu_tar_eof_invalid/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
