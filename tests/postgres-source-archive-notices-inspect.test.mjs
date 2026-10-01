import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";

const helper = fileURLToPath(new URL("../scripts/postgres-image/source-archive-notices-inspect.py", import.meta.url));
const python = process.platform === "linux" ? "/usr/bin/python3.12"
  : "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const pureOptions = { skip: fs.existsSync(python) ? false : "Configured public Python runtime unavailable; no parser proof claimed" };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pureCode = `import base64,bz2,io,json,lzma,runpy,sys
m=runpy.run_path(sys.argv[1]);v=json.load(sys.stdin)
b=base64.b64decode(v['bytes'],validate=True)
if v.get('compression')=='BZIP2':b=bz2.compress(b)
if v.get('compression')=='XZ':b=lzma.compress(b,format=lzma.FORMAT_XZ)
if v.get('trailer'):b+=base64.b64decode(v['trailer'],validate=True)
if v.get('truncate'):b=b[:-v['truncate']]
# Lower bounds exercise refusal branches only; this is never the native CLI.
for k,n in v.get('lowerLimits',{}).items():
 assert type(n) is int and 0<n<m['LIMITS'][k]
 m['LIMITS'][k]=n
r=io.BytesIO(b);r.size=len(b)
try:
 x=m['inspect_archive'](r)
 print(json.dumps({'state':'PARTIAL_PARSER_PROOF','value':x},sort_keys=True))
except BaseException as e:
 reason=e.reason if isinstance(e,m['InspectionError']) else 'archive_invalid'
 print(json.dumps({'state':'REFUSED','reason':reason},sort_keys=True))
`;
function pure(bytes, extra = {}) {
  const result = spawnSync(python, ["-I", "-S", "-B", "-c", pureCode, helper], {
    input: JSON.stringify({ bytes: bytes.toString("base64"), ...extra }), encoding: "utf8",
    timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}
const octal = (n, length) => Buffer.from(n.toString(8).padStart(length - 1, "0") + "\0", "ascii");
function header(name, size, type = "0", link = "") {
  const h = Buffer.alloc(512); h.write(name, 0, 100); octal(0o644, 8).copy(h, 100); octal(1000, 8).copy(h, 108); octal(1000, 8).copy(h, 116);
  octal(size, 12).copy(h, 124); octal(0, 12).copy(h, 136); h.fill(32, 148, 156); h.write(type, 156, 1); h.write(link, 157, 100);
  h.write("ustar\0", 257, 6); h.write("00", 263, 2);
  h.write(h.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}
function tar(entries, trailer = Buffer.alloc(1024)) {
  return Buffer.concat([...entries.flatMap((entry) => {
    const bytes = entry.bytes ?? Buffer.alloc(0);
    return [header(entry.name, entry.size ?? bytes.length, entry.type ?? "0", entry.link ?? ""), bytes, Buffer.alloc((512 - bytes.length % 512) % 512)];
  }), trailer]);
}
const sample = () => [{ name: "src/", type: "5" }, { name: "src/LICENSE", bytes: Buffer.from("harmless license\n") },
  { name: "src/notice.md", bytes: Buffer.from("notice\n") }, { name: "src/code.py", bytes: Buffer.from("raise Exception('NEVER_EXECUTE')\n") }];
function pax(key, value) {
  const body = key + "=" + value + "\n"; let size = Buffer.byteLength(body) + 3;
  for (;;) { const next = Buffer.byteLength(size + " " + body); if (next === size) return Buffer.from(size + " " + body); size = next; }
}
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8"), raw = entry.bytes ?? Buffer.alloc(0), method = entry.method ?? 8;
    const packed = entry.packed ?? (method === 8 ? deflateRawSync(raw) : raw), size = entry.size ?? raw.length, checksum = entry.crc ?? crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x808, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeUInt32LE(packed.length, 8); descriptor.writeUInt32LE(size, 12);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x808, 8);
    c.writeUInt16LE(method, 10); c.writeUInt32LE(checksum, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(((entry.mode ?? 0o100644) * 65536) >>> 0, 38); c.writeUInt32LE(offset, 42);
    locals.push(local, name, packed, descriptor); central.push(c, name); offset += 30 + name.length + packed.length + 16;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function refused(bytes, reason, extra = {}) {
  const result = pure(bytes, extra); assert.equal(result.state, "REFUSED"); if (reason) assert.equal(result.reason, reason);
}

test("passive TAR candidates retain path/hash metadata, execute nothing and declare stdlib coverage gaps", pureOptions, () => {
  const result = pure(tar(sample())); assert.equal(result.state, "PARTIAL_PARSER_PROOF"); const value = result.value;
  assert.equal(value.format, "TAR"); assert.equal(value.compression, "NONE"); assert.equal(value.counts.members, 4);
  assert.deepEqual(value.candidates.map((candidate) => candidate.path), ["src/LICENSE", "src/notice.md"]);
  assert.equal(value.candidates[0].sha256, hash(sample()[1].bytes)); assert.equal(value.candidates[0].size, 17);
  assert.deepEqual(Object.keys(value.candidates[0]).sort(), ["linkTarget", "path", "resolution", "sha256", "size", "type"]);
  assert.equal(value.coverage.payloadValidation, "NOTICE_BYTES_HASHED"); assert.ok(value.coverage.gaps.length > 0);
  assert.equal(value.archiveFullyValidated, undefined); assert.equal(value.descriptorsClosed, undefined);
});
for (const compression of ["GZIP", "BZIP2", "XZ"]) {
  test(`passive ${compression} decoder consumes a complete tiny TAR and refuses trailers/truncation`, pureOptions, () => {
    const raw = tar(sample()), bytes = compression === "GZIP" ? gzipSync(raw) : raw;
    const extra = compression === "GZIP" ? {} : { compression };
    const result = pure(bytes, extra); assert.equal(result.state, "PARTIAL_PARSER_PROOF"); assert.equal(result.value.compression, compression);
    assert.equal(result.value.counts.decodedStreamBytes, raw.length);
    refused(bytes, "decoder_trailing_data", { ...extra, trailer: Buffer.from("unexpected").toString("base64") });
    refused(bytes, undefined, { ...extra, truncate: 6 });
  });
}
test("gzip concatenation and a second TAR after its terminator are refused", pureOptions, () => {
  const bytes = gzipSync(tar(sample())); refused(Buffer.concat([bytes, bytes]), "decoder_trailing_data");
  refused(tar(sample(), Buffer.concat([Buffer.alloc(1024), tar(sample())])), "archive_invalid");
});
test("TAR requires a second zero end block and rejects corrupt headers or short notice bodies", pureOptions, () => {
  refused(tar(sample(), Buffer.alloc(512)), "archive_invalid");
  const corrupt = tar(sample()); corrupt[148] = 0xff; refused(corrupt);
  refused(tar([{ name: "LICENSE", size: 1000, bytes: Buffer.from("short") }], Buffer.alloc(0)));
});
test("TAR path traversal, absolute/backslash/control paths and casefold collisions are refused", pureOptions, () => {
  for (const name of ["../LICENSE", "/LICENSE", "C:/LICENSE", "a\\LICENSE", "a//LICENSE", "a/./LICENSE", "a\u0001/LICENSE"]) {
    refused(tar([{ name, bytes: Buffer.from("x") }]), "path_invalid");
  }
  refused(tar([{ name: "LICENSE", bytes: Buffer.from("x") }, { name: "license", bytes: Buffer.from("x") }]), "duplicate_path");
});
test("TAR notices include unfollowed symlink/hardlink/device pointers and filename variants", pureOptions, () => {
  const bytes = tar([{ name: "a/LICENCE.txt", bytes: Buffer.from("L") }, { name: "COPYING.LESSER", type: "2", link: "../../outside" },
    { name: "NOTICE", type: "1", link: "a/LICENCE.txt" }, { name: "LEGAL", type: "5" }, { name: "PATENTS", type: "6" }]);
  const result = pure(bytes); assert.equal(result.state, "PARTIAL_PARSER_PROOF"); assert.equal(result.value.candidates.length, 5);
  const links = result.value.candidates.filter((candidate) => ["SYMLINK", "HARDLINK"].includes(candidate.type));
  assert.deepEqual(links.map((candidate) => [candidate.path, candidate.sha256, candidate.linkTarget, candidate.resolution]),
    [["COPYING.LESSER", null, "../../outside", "UNRESOLVED_NO_FOLLOW"], ["NOTICE", null, "a/LICENCE.txt", "UNRESOLVED_NO_FOLLOW"]]);
  assert.equal(result.value.candidates.find((candidate) => candidate.path === "LEGAL").type, "DIRECTORY");
});
test("PAX paths are validated after stdlib resolution and sparse formats are refused before data access", pureOptions, () => {
  const result = pure(tar([{ name: "PaxHeader", type: "x", bytes: pax("path", "src/LICENSE.long") }, { name: "short", bytes: Buffer.from("pax") }]));
  assert.equal(result.state, "PARTIAL_PARSER_PROOF"); assert.equal(result.value.candidates[0].path, "src/LICENSE.long");
  refused(tar([{ name: "PaxHeader", type: "x", bytes: pax("path", "../LICENSE") }, { name: "short", bytes: Buffer.from("pax") }]), "path_invalid");
  refused(tar([{ name: "LICENSE", type: "S" }]), "sparse_unsupported");
  const sparse = Buffer.concat([pax("GNU.sparse.map", "0,1"), pax("GNU.sparse.size", "1")]);
  refused(tar([{ name: "PaxHeader", type: "x", bytes: sparse }, { name: "LICENSE", bytes: Buffer.from("x") }]), "sparse_unsupported");
});
test("production TAR notice, PAX and path caps refuse oversized selected records", pureOptions, () => {
  refused(tar([{ name: "LICENSE", bytes: Buffer.alloc(256 * 1024 + 1) }]), "notice_limit");
  refused(tar([{ name: "PaxHeader", type: "x", bytes: Buffer.alloc(64 * 1024 + 1) }, { name: "LICENSE", bytes: Buffer.from("x") }]), "extension_limit");
  refused(tar([{ name: "PaxHeader", type: "x", bytes: pax("path", "x".repeat(4097)) }, { name: "LICENSE", bytes: Buffer.from("x") }]), "path_invalid");
});
test("global PAX accumulation and extension header chains are independently bounded", pureOptions, () => {
  const globals = tar([{ name: "Global1", type: "g", bytes: pax("a", "123456789012") },
    { name: "Global2", type: "g", bytes: pax("b", "123456789012") }, { name: "LICENSE", bytes: Buffer.from("x") }]);
  refused(globals, "extension_limit", { lowerLimits: { extensionBytes: 24 } });
  const chain = tar([{ name: "Pax1", type: "x", bytes: pax("path", "first") },
    { name: "Pax2", type: "x", bytes: pax("path", "second") }, { name: "LICENSE", bytes: Buffer.from("x") }]);
  refused(chain, "member_limit", { lowerLimits: { members: 2 } });
  refused(tar(sample()), "index_limit", { lowerLimits: { indexBytes: 8 } });
});
test("lowered pure-only bounds exercise member/candidate/decoded/output refusal without native acceptance", pureOptions, () => {
  refused(tar(sample()), "member_limit", { lowerLimits: { members: 2 } });
  refused(tar(sample()), "candidate_limit", { lowerLimits: { candidates: 1 } });
  refused(gzipSync(tar([{ name: "source.bin", bytes: Buffer.alloc(20000) }])), "decoded_limit", { lowerLimits: { decodedBytes: 16384 } });
  refused(tar(sample()), "output_limit", { lowerLimits: { outputBytes: 64 } });
});
test("passive ZIP reads every member CRC, records only notice metadata and explicit envelope limitations", pureOptions, () => {
  const result = pure(zip([{ name: "src/LICENSE", bytes: Buffer.from("zip license"), method: 0 },
    { name: "src/source.py", bytes: Buffer.from("raise Exception('NEVER_EXECUTE')") }, { name: "src/NOTICE.md", bytes: Buffer.from("notice") }]));
  assert.equal(result.state, "PARTIAL_PARSER_PROOF"); assert.equal(result.value.format, "ZIP"); assert.equal(result.value.counts.members, 3);
  assert.equal(result.value.candidates[0].sha256, hash(Buffer.from("zip license"))); assert.equal(result.value.coverage.payloadValidation, "ALL_MEMBER_CRC_READS");
  assert.ok(result.value.coverage.gaps.length > 0); assert.equal(JSON.stringify(result).includes("NEVER_EXECUTE"), false);
});
test("ZIP symlink notice body is a bounded unfollowed pointer rather than a regular file proof", pureOptions, () => {
  const result = pure(zip([{ name: "NOTICE", bytes: Buffer.from("../../outside"), mode: 0o120777 }]));
  assert.equal(result.state, "PARTIAL_PARSER_PROOF"); assert.deepEqual(result.value.candidates[0], {
    path: "NOTICE", type: "SYMLINK", size: 13, sha256: null, linkTarget: "../../outside", resolution: "UNRESOLVED_NO_FOLLOW",
  });
});
test("ZIP CRC corruption in an unselected file, trailers and damaged compressed streams are refused", pureOptions, () => {
  refused(zip([{ name: "source.py", bytes: Buffer.from("code"), crc: 0 }]));
  refused(Buffer.concat([zip([{ name: "LICENSE", bytes: Buffer.from("x") }]), Buffer.from("trailing")]));
  refused(zip([{ name: "LICENSE", bytes: Buffer.from("hello"), packed: Buffer.from([1, 2, 3]) }]));
});
test("ZIP paths/casefold duplicates/unsupported codec and notice caps are refused", pureOptions, () => {
  for (const name of ["../LICENSE", "/LICENSE"]) refused(zip([{ name, bytes: Buffer.from("x") }]), "path_invalid");
  // Windows ZipInfo normalizes backslashes before our orig_filename check.
  refused(zip([{ name: "a\\LICENSE", bytes: Buffer.from("x") }]));
  refused(zip([{ name: "LICENSE", bytes: Buffer.from("x") }, { name: "License", bytes: Buffer.from("x") }]), "duplicate_path");
  refused(zip([{ name: "LICENSE", bytes: Buffer.from("x"), method: 99 }]), "format_unsupported");
  refused(zip([{ name: "LICENSE", bytes: Buffer.alloc(256 * 1024 + 1) }]), "notice_limit");
});
test("ZIP declared expansion bombs are bounded before decompression and ZIP64 is an explicit refusal", pureOptions, () => {
  refused(zip([0, 1, 2].map((number) => ({ name: "source" + number, size: 0xfffffffe }))), "decoded_limit");
  const bytes = zip([{ name: "LICENSE", bytes: Buffer.from("x") }]); bytes.writeUInt16LE(0xffff, bytes.length - 14); bytes.writeUInt16LE(0xffff, bytes.length - 12);
  refused(bytes, "format_unsupported");
});
test("unknown archive formats are refused without an opaque success claim", pureOptions, () => {
  refused(Buffer.from("not an archive"), "format_unsupported"); refused(Buffer.alloc(0), "input_invalid");
});

const nativeAvailable = process.platform === "linux" && fs.existsSync(python) && fs.existsSync("/usr/bin/setpriv")
  && (process.geteuid() === 0 || process.geteuid() === 1000 && process.getegid() === 1000
    && /^Groups:[ \t]*$/mu.test(fs.readFileSync("/proc/self/status", "utf8")));
const nativeOptions = { skip: nativeAvailable ? false : "Actual Linux root→1000 or kernel-empty-groups actor required; parser proof is separate" };
const environment = { PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" };
function nativeFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aw-source-notice-test-")); fs.chmodSync(directory, 0o700);
  if (process.geteuid() === 0) fs.chownSync(directory, 1000, 1000);
  const file = path.join(directory, "source.tar"), code = path.join(directory, "reader.py"), bytes = tar(sample());
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: "wx" }); fs.writeFileSync(code, fs.readFileSync(helper), { mode: 0o600, flag: "wx" });
  fs.chmodSync(file, 0o600); fs.chmodSync(code, 0o600);
  if (process.geteuid() === 0) { fs.chownSync(file, 1000, 1000); fs.chownSync(code, 1000, 1000); }
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith("aw-source-notice-test-"));
    fs.rmSync(directory, { recursive: true, force: false });
  });
  return { file, code, bytes };
}
function invoke(fixture, expected, flags = fs.constants.O_RDONLY) {
  const fd = fs.openSync(fixture.file, flags | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const first = Buffer.alloc(1); fs.readSync(fd, first, 0, 1, null);
    const args = process.geteuid() === 0 ? ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs"] : ["--no-new-privs"];
    const result = spawnSync("/usr/bin/setpriv", [...args, python, "-I", "-S", "-B", fixture.code], {
      input: JSON.stringify(expected), env: environment, encoding: "utf8", stdio: ["pipe", "pipe", "pipe", fd], timeout: 15000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    const next = Buffer.alloc(1); assert.equal(fs.readSync(fd, next, 0, 1, null), 1); assert.equal(next[0], fixture.bytes[1]);
    assert.equal(fs.fstatSync(fd).size, fixture.bytes.length);
    return result;
  } finally { fs.closeSync(fd); }
}
test("actual inherited readonly FD authenticates bytes/seals, preserves parent cursor and closes before bounded metadata output", nativeOptions, (t) => {
  const fixture = nativeFixture(t), result = invoke(fixture, { fd: 3, size: fixture.bytes.length, sha256: hash(fixture.bytes) });
  assert.equal(result.status, 0); assert.equal(result.stderr, ""); const value = JSON.parse(result.stdout);
  assert.equal(value.state, "NOTICE_CANDIDATES_OBSERVED"); assert.equal(value.descriptorsClosed, true); assert.equal(value.admission, "NONE");
  assert.equal(value.noticeClosure, "NOT_ESTABLISHED"); assert.equal(value.sourceClosure, "NOT_ESTABLISHED");
  assert.equal(value.source.sha256, hash(fixture.bytes)); assert.equal(value.source.identity.uid, 1000); assert.equal(value.source.identity.gid, 1000);
  assert.equal(value.source.identity.mode, 0o600); assert.equal(value.source.identity.nlink, 1); assert.equal(value.candidates.length, 2);
  assert.equal(value.kind, "POSTGRES_SOURCE_ARCHIVE_NOTICE_INSPECTION_V1"); assert.equal(value.archiveFullyValidated, undefined);
});
test("actual size/SHA mismatch and malformed input produce fixed errors without candidate output", nativeOptions, (t) => {
  const fixture = nativeFixture(t);
  for (const [expected, reason, cleanup] of [[{ fd: 3, size: fixture.bytes.length, sha256: "0".repeat(64) }, "checksum_mismatch", "CONFIRMED"],
    [{ fd: 3, size: fixture.bytes.length + 1, sha256: hash(fixture.bytes) }, "source_changed", "CONFIRMED"],
    [{ fd: 3, size: fixture.bytes.length, sha256: hash(fixture.bytes), extra: "private-never-output" }, "input_invalid", "UNVERIFIED"]]) {
    const result = invoke(fixture, expected); assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.deepEqual(JSON.parse(result.stderr), { state: "INCOMPLETE", code: "postgres_source_archive_notice_" + reason, cleanup });
    assert.equal(result.stderr.includes("private-never-output"), false);
  }
});
test("actual writable source FD is refused without claiming unknown descriptor closure", nativeOptions, (t) => {
  const fixture = nativeFixture(t), result = invoke(fixture, { fd: 3, size: fixture.bytes.length, sha256: hash(fixture.bytes) }, fs.constants.O_RDWR);
  assert.equal(result.status, 1); assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { state: "INCOMPLETE", code: "postgres_source_archive_notice_descriptor_invalid", cleanup: "UNVERIFIED" });
});
