import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";

const helper = fileURLToPath(new URL("../scripts/postgres-image/source-notices-inspect.py", import.meta.url));
const python = process.platform === "linux" ? "/usr/bin/python3.12"
  : "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const available = fs.existsSync(python);
const env = { PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = (bytes) => ({ bytes: bytes.toString("base64") });
const pureCode = `import base64,hashlib,json,runpy,sys
m=runpy.run_path(sys.argv[1]);v=json.load(sys.stdin)
class Reader:
 def __init__(self,b):self.data=b;self.size=len(b)
 def read_at(self,p,n):return self.data[p:p+n]
try:
 r=Reader(base64.b64decode(v['bytes'],validate=True))
 if v['kind']=='tar':x=m['_inspect_tar'](r,v['root'],v['selected'],v.get('pax'),tuple(v['link']) if v.get('link') else None)
 else:x=m['_inspect_zip'](r,v['module'],v['selected'])
 x['files']={k:base64.b64encode(b).decode('ascii') for k,b in x['files'].items()}
 print(json.dumps({'state':'PURE_PARSER_VERIFIED','value':x},sort_keys=True))
except BaseException:
 print(json.dumps({'state':'PURE_PARSER_REFUSED'}))
`;
function pure(input) {
  const result = spawnSync(python, ["-I", "-S", "-B", "-c", pureCode, helper], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 15000, maxBuffer: 512 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}
const pureOptions = { skip: available ? false : "Configured public Python runtime unavailable; no parser success claimed" };
const root = "fixture";
const tarInput = (bytes, extra = {}) => ({ kind: "tar", root, selected: ["LICENSE", "NOTICE", "VERSION"], ...source(bytes), ...extra });
const moduleName = "github.com/moby/sys/user";
const zipInput = (bytes) => ({ kind: "zip", module: moduleName, selected: ["LICENSE", "NOTICE", "PATENTS", "go.mod"], ...source(bytes) });
const prefix = moduleName + "@v0.1.0/";
const octal = (n, size) => Buffer.from(n.toString(8).padStart(size - 1, "0") + "\0", "ascii");
function header(name, bytes = Buffer.alloc(0), type = "0", link = "") {
  const h = Buffer.alloc(512); h.write(name, 0, 100); octal(0o644, 8).copy(h, 100); octal(1000, 8).copy(h, 108); octal(1000, 8).copy(h, 116);
  octal(bytes.length, 12).copy(h, 124); octal(0, 12).copy(h, 136); h.fill(32, 148, 156); h.write(type, 156, 1); h.write(link, 157, 100);
  h.write("ustar\0", 257, 6); h.write("00", 263, 2);
  const sum = h.reduce((a, b) => a + b, 0); h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}
function tarRaw(entries, tail = Buffer.alloc(1024)) {
  return Buffer.concat([...entries.flatMap((e) => {
    const b = e.bytes ?? Buffer.alloc(0); return [header(e.name, b, e.type ?? "0", e.link ?? ""), b, Buffer.alloc((-b.length >>> 0) % 512)];
  }), tail]);
}
const tar = (entries, tail) => gzipSync(tarRaw(entries, tail));
const tarEntries = () => [{ name: root + "/", type: "5" }, { name: root + "/LICENSE", bytes: Buffer.from("harmless license\n") },
  { name: root + "/VERSION", bytes: Buffer.from("fixture-version\n") }];
function pax(key, value) {
  const body = key + "=" + value + "\n"; let length = Buffer.byteLength(body) + 3;
  for (;;) { const next = Buffer.byteLength(String(length) + " " + body); if (next === length) return Buffer.from(String(length) + " " + body); length = next; }
}
function zip(entries) {
  const locals = []; const central = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "ascii"); const raw = e.bytes ?? Buffer.from("fixture"); const method = e.method ?? 8;
    const compressed = e.compressed ?? (method === 8 ? deflateRawSync(raw) : raw); const size = e.rawSize ?? raw.length; const checksum = e.crc ?? crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6);
    local.writeUInt16LE(method, 8); local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(checksum, 4);
    descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(size, 12);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 8);
    c.writeUInt16LE(method, 10); c.writeUInt32LE(checksum, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed, descriptor); central.push(c, name); offset += 30 + name.length + compressed.length + 16;
  }
  const c = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, c, end]);
}
const zipEntries = () => [{ name: prefix + "LICENSE", bytes: Buffer.from("license\n"), method: 0 },
  { name: prefix + "go.mod", bytes: Buffer.from("module " + moduleName + "\n") }, { name: prefix + "source.go", bytes: Buffer.from("package user\n") }];
const hash1 = (entries) => "h1:" + createHash("sha256").update(entries.map((e) => [e.name, hash(e.bytes)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  .map(([name, digest]) => digest + "  " + name + "\n").join("")).digest("base64");

test("pure tar preserves notice bytes and hashes all selected identities without filesystem extraction", pureOptions, () => {
  const result = pure(tarInput(tar(tarEntries(), Buffer.alloc(21 * 512)))); assert.equal(result.state, "PURE_PARSER_VERIFIED");
  assert.equal(result.value.entries, 3); assert.equal(result.value.uncompressedBytes, 33); assert.deepEqual(result.value.symlinks, []);
  assert.equal(Buffer.from(result.value.files.LICENSE, "base64").toString(), "harmless license\n"); assert.equal(result.value.files.NOTICE, undefined);
});
test("pure tar accepts only declared passive global PAX and the exact un-followed symlink", pureOptions, () => {
  const commit = "a".repeat(40); const entries = [{ name: "pax_global_header", type: "g", bytes: pax("comment", commit) },
    ...tarEntries(), { name: root + "/.dockerignore", type: "2", link: ".gitignore" }];
  const result = pure(tarInput(tar(entries), { pax: commit, link: [".dockerignore", ".gitignore"] }));
  assert.equal(result.state, "PURE_PARSER_VERIFIED"); assert.equal(result.value.paxCommit, commit);
  assert.deepEqual(result.value.symlinks, [{ path: ".dockerignore", target: ".gitignore", followed: false }]);
  for (const change of [(e) => { e[0].bytes = pax("comment", "wrong"); }, (e) => { e.at(-1).link = "../foreign"; },
    (e) => { e.at(-1).name = root + "/different"; }, (e) => { e.push({ ...e.at(-1), name: root + "/another" }); }]) {
    const e = globalThis.structuredClone(entries); change(e); for (const x of e) if (x.bytes) x.bytes = Buffer.from(x.bytes);
    assert.equal(pure(tarInput(tar(e), { pax: commit, link: [".dockerignore", ".gitignore"] })).state, "PURE_PARSER_REFUSED");
  }
});
test("pure tar consumes valid local PAX UTF-8 paths and refuses unmatched or arbitrary PAX fields", pureOptions, () => {
  const entries = [...tarEntries(), { name: root + "/PaxHeaders/file", type: "x", bytes: pax("path", root + "/þfile.go") },
    { name: root + "/file.go", bytes: Buffer.from("public fixture\n") }];
  assert.equal(pure(tarInput(tar(entries))).state, "PURE_PARSER_VERIFIED");
  for (const e of [entries.slice(0, -1), [...tarEntries(), { name: root + "/PaxHeaders/file", type: "x", bytes: pax("size", "10") }, entries.at(-1)],
    [...tarEntries(), { name: root + "/PaxHeaders/file", type: "x", bytes: pax("path", "../foreign") }, entries.at(-1)]])
    assert.equal(pure(tarInput(tar(e))).state, "PURE_PARSER_REFUSED");
});
test("pure tar rejects path aliases, case collisions, extra roots, devices, hardlinks, and oversized notices", pureOptions, () => {
  const cases = [{ name: "/foreign", bytes: Buffer.from("x") }, { name: root + "/../foreign", bytes: Buffer.from("x") },
    { name: root + "/bad\\path", bytes: Buffer.from("x") }, { name: root + "/license", bytes: Buffer.from("x") },
    { name: root + "/node", type: "3" }, { name: root + "/hard", type: "1", link: root + "/LICENSE" },
    { name: root + "/NOTICE", bytes: Buffer.alloc(16 * 1024 + 1) }];
  for (const e of cases) assert.equal(pure(tarInput(tar([...tarEntries(), e]))).state, "PURE_PARSER_REFUSED");
  assert.equal(pure(tarInput(tar(tarEntries().slice(1)))).state, "PURE_PARSER_REFUSED");
});
test("pure tar rejects corrupt framing, padding, incomplete gzip, concatenated gzip, and trailing bytes", pureOptions, () => {
  const raw = tarRaw(tarEntries()); const corruptHeader = Buffer.from(raw); corruptHeader[0] ^= 1;
  const corruptPadding = Buffer.from(raw); corruptPadding[1024 + 17] = 1;
  const compressed = gzipSync(raw); const crc = Buffer.from(compressed); crc[crc.length - 8] ^= 1;
  for (const b of [gzipSync(corruptHeader), gzipSync(corruptPadding), compressed.subarray(0, compressed.length - 1), crc,
    Buffer.concat([compressed, Buffer.from("extra")]), Buffer.concat([compressed, gzipSync(Buffer.alloc(512))]),
    gzipSync(tarRaw(tarEntries(), Buffer.alloc(512))), gzipSync(tarRaw(tarEntries(), Buffer.from("nonzero trailing"))),
    gzipSync(tarRaw(tarEntries(), Buffer.alloc(35 * 512)))]) assert.equal(pure(tarInput(b)).state, "PURE_PARSER_REFUSED");
});
test("pure tar enforces the approved member and selected-byte budgets at their boundaries", pureOptions, () => {
  const notice = tarEntries(); notice[1].bytes = Buffer.alloc(16 * 1024, 88);
  assert.equal(Buffer.from(pure(tarInput(tar(notice))).value.files.LICENSE, "base64").length, 16 * 1024);
  const entries = [...tarEntries(), ...Array.from({ length: 19997 }, (_, i) => ({ name: root + "/directory" + i, type: "5" }))];
  assert.equal(pure(tarInput(tar(entries))).value.entries, 20000);
  assert.equal(pure(tarInput(tar([...entries, { name: root + "/extra", type: "5" }]))).state, "PURE_PARSER_REFUSED");
  const raw = Buffer.concat([header(root + "/", Buffer.alloc(0), "5"), header(root + "/oversized", { length: 16 * 1024 * 1024 + 1 }), Buffer.alloc(1024)]);
  assert.equal(pure(tarInput(gzipSync(raw))).state, "PURE_PARSER_REFUSED");
});
test("passive TAR PAX and module ZIP accept a 512-byte path and refuse 513 bytes", pureOptions, () => {
  for (const size of [512, 513]) {
    const tarPath = root + "/" + "a".repeat(size - Buffer.byteLength(root + "/"));
    const entries = [...tarEntries(), { name: root + "/PaxHeaders/file", type: "x", bytes: pax("path", tarPath) },
      { name: root + "/short", bytes: Buffer.from("harmless boundary fixture") }];
    const expected = size === 512 ? "PURE_PARSER_VERIFIED" : "PURE_PARSER_REFUSED";
    assert.equal(pure(tarInput(tar(entries))).state, expected);
    const zipPath = prefix + "a".repeat(size - Buffer.byteLength(prefix));
    assert.equal(pure(zipInput(zip([...zipEntries(), { name: zipPath }]))).state, expected);
  }
});
test("pure zip calculates full-prefix h1 and the distinct single-name go.mod h1 with complete CRC reads", pureOptions, () => {
  const entries = zipEntries(); const result = pure(zipInput(zip(entries))); assert.equal(result.state, "PURE_PARSER_VERIFIED");
  assert.equal(result.value.entries, 3); assert.equal(result.value.h1, hash1(entries));
  assert.equal(result.value.goModH1, hash1([{ name: "go.mod", bytes: entries[1].bytes }]));
  assert.notEqual(result.value.goModH1, hash1([entries[1]])); assert.equal(Buffer.from(result.value.files.LICENSE, "base64").toString(), "license\n");
});
test("pure zip rejects duplicate and folded paths, foreign prefix, traversal and directory entries", pureOptions, () => {
  for (const name of [prefix + "LICENSE", prefix + "license", "foreign@v0.1.0/file", prefix + "../file", prefix + "dir/", prefix + "bad\\name"])
    assert.equal(pure(zipInput(zip([...zipEntries(), { name }]))).state, "PURE_PARSER_REFUSED");
});
test("pure zip rejects forbidden metadata, inconsistent local records, holes, and archive trailers", pureOptions, () => {
  const base = zip(zipEntries()); const central = base.readUInt32LE(base.length - 6);
  const changes = [(b) => b.writeUInt16LE(9, central + 8), (b) => b.writeUInt32LE((0o120777 * 65536) >>> 0, central + 38),
    (b) => b.writeUInt16LE(1, central + 30), (b) => b.writeUInt16LE(1, central + 32), (b) => b.writeUInt16LE(1, central + 34),
    (b) => b.writeUInt16LE(45, central + 6), (b) => b.writeUInt16LE(0, 6), (b) => b.writeUInt16LE(8, 8),
    (b) => b.writeUInt32LE(1, central + 42), (b) => b.writeUInt16LE(1, b.length - 2), (b) => b.writeUInt16LE(20001, b.length - 12)];
  for (const change of changes) { const b = Buffer.from(base); change(b); assert.equal(pure(zipInput(b)).state, "PURE_PARSER_REFUSED"); }
  assert.equal(pure(zipInput(Buffer.concat([base, Buffer.from("extra")]))).state, "PURE_PARSER_REFUSED");
  assert.equal(pure(zipInput(Buffer.concat([Buffer.from("prefix"), base]))).state, "PURE_PARSER_REFUSED");
});
test("pure zip rejects CRC errors, truncated deflate, deflate tails and declared expansion bombs", pureOptions, () => {
  const entries = zipEntries(); const b = zip(entries); b[30 + Buffer.byteLength(entries[0].name)] ^= 1;
  assert.equal(pure(zipInput(b)).state, "PURE_PARSER_REFUSED");
  for (const replacement of [{ compressed: deflateRawSync(entries[1].bytes).subarray(0, -1) },
    { compressed: Buffer.concat([deflateRawSync(entries[1].bytes), Buffer.from("extra")]) }, { rawSize: 8 * 1024 * 1024 + 1 }])
    assert.equal(pure(zipInput(zip([entries[0], { ...entries[1], ...replacement }, entries[2]]))).state, "PURE_PARSER_REFUSED");
  assert.equal(pure(zipInput(zip(entries.filter((e) => !e.name.endsWith("go.mod"))))).state, "PURE_PARSER_REFUSED");
});
test("fixed helper pins preserve both Go checksum namespaces and selected notice fingerprints", pureOptions, () => {
  const code = `import json,runpy,sys
m=runpy.run_path(sys.argv[1]);print(json.dumps({'pins':m['PINS'],'notices':m['SELECTED_PINS']}))`;
  const result = spawnSync(python, ["-I", "-S", "-B", "-c", code, helper], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0); assert.equal(result.stderr, ""); const value = JSON.parse(result.stdout);
  assert.deepEqual(value.pins.map((v) => v.role), ["GOSU_SOURCE", "MOBY_USER_MODULE_SOURCE", "X_SYS_MODULE_SOURCE", "GO_STDLIB_SOURCE"]);
  assert.deepEqual(value.pins.map((v) => v.size), [17622, 13793, 1861264, 34150120]);
  assert.equal(value.pins[1].goModH1, "h1:fKJhFOnsCN6xZ5gSfbM6zaHGgDJMrqt9/reuj4T7MmU=");
  assert.equal(value.pins[2].goModH1, "h1:oPkhp1MJrh7nUepCBck5+mAzfO9JrbApNNgaTdGDITg=");
  assert.equal(value.notices[3].VERSION[0], 35); assert.equal(value.notices[0].NOTICE, undefined);
});
test("a genuinely closed diagnostic descriptor cannot expose a Python traceback", pureOptions, () => {
  const code = `import os,runpy,sys
m=runpy.run_path(sys.argv[1]);os.close(2);m['_diagnostic']('failed');print('CLOSED_DIAGNOSTIC_HANDLED')`;
  const result = spawnSync(python, ["-I", "-S", "-B", "-c", code, helper], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, ""); assert.match(result.stdout, /^CLOSED_DIAGNOSTIC_HANDLED\r?\n$/u);
});

const native = process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000 && available;
const nativeOptions = { skip: native ? false : "Real Linux UID/GID1000 with fixed Python required for native FD fixtures" };
const clearedActor = native && /^Groups:[ \t]*$/mu.test(fs.readFileSync("/proc/self/status", "utf8")) && /^NoNewPrivs:[ \t]+1$/mu.test(fs.readFileSync("/proc/self/status", "utf8"));
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-source-notices-fd-"))); fs.chmodSync(directory, 0o700);
  const before = fs.lstatSync(directory, { bigint: true });
  t.after(() => { const s = fs.lstatSync(directory, { bigint: true }); assert.equal(s.dev, before.dev); assert.equal(s.ino, before.ino);
    assert.equal(fs.realpathSync(directory), directory); fs.rmSync(directory, { recursive: true }); });
  const files = Array.from({ length: 4 }, (_, i) => path.join(directory, "source-" + i));
  for (const file of files) { fs.writeFileSync(file, "harmless readonly source fixture\n", { flag: "wx", mode: 0o600 }); fs.chmodSync(file, 0o600); }
  return { directory, files };
}
const nativeCode = `import hashlib,json,os,runpy,sys
m=runpy.run_path(sys.argv[1]);v=json.load(sys.stdin)
try:
 x=m['HeldSource'](3,v['pin']);x.fingerprint()
 if v.get('mutate'):
  with open(v['file'],'r+b',buffering=0) as w:w.write(b'X')
  x.fingerprint()
 print(json.dumps({'state':'NATIVE_FD_VERIFIED','identity':x.before}))
except m['InspectionError'] as e:print(json.dumps({'state':'NATIVE_FD_REFUSED','code':m['PREFIX']+e.reason}))
finally:os.close(3)
`;
function nativeRead(file, flags, extra = {}) {
  const bytes = fs.readFileSync(file); const fd = fs.openSync(file, flags);
  try {
    const r = spawnSync(python, ["-I", "-S", "-B", "-c", nativeCode, helper], { env, stdio: ["pipe", "pipe", "pipe", fd],
      input: JSON.stringify({ pin: { size: bytes.length, sha256: hash(bytes) }, file, ...extra }), encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.equal(r.error, undefined); assert.equal(r.status, 0); assert.equal(r.stderr, ""); assert.equal(fs.fstatSync(fd).isFile(), true); return JSON.parse(r.stdout);
  } finally { fs.closeSync(fd); }
}
test("native inherited readonly ext4 FD verifies all nine fields and leaves the parent's source FD usable", nativeOptions, (t) => {
  const f = fixture(t); const expected = fs.lstatSync(f.files[0], { bigint: true }); const result = nativeRead(f.files[0], fs.constants.O_RDONLY);
  assert.equal(result.state, "NATIVE_FD_VERIFIED"); assert.deepEqual(Object.keys(result.identity).sort(), ["ctimeNs", "dev", "gid", "ino", "mode", "mtimeNs", "nlink", "size", "uid"]);
  assert.equal(result.identity.ino, String(expected.ino)); assert.equal(result.identity.uid, 1000); assert.equal(result.identity.gid, 1000); assert.equal(result.identity.mode, 0o600);
});
test("native inherited FD refuses readwrite, O_PATH, special modes, broad modes, and hardlinks", nativeOptions, (t) => {
  const f = fixture(t); assert.equal(nativeRead(f.files[0], fs.constants.O_RDWR).code, "postgres_gosu_source_inspect_descriptor_invalid");
  assert.equal(nativeRead(f.files[0], 0x200000).code, "postgres_gosu_source_inspect_descriptor_invalid");
  for (const mode of [0o4600, 0o660, 0o644]) { fs.chmodSync(f.files[0], mode); assert.equal(nativeRead(f.files[0], fs.constants.O_RDONLY).code, "postgres_gosu_source_inspect_descriptor_invalid"); }
  fs.chmodSync(f.files[0], 0o600); fs.linkSync(f.files[0], path.join(f.directory, "linked"));
  assert.equal(nativeRead(f.files[0], fs.constants.O_RDONLY).code, "postgres_gosu_source_inspect_descriptor_invalid");
});
test("native held FD refuses changed bytes and metadata before it can return a success", nativeOptions, (t) => {
  const f = fixture(t); assert.equal(nativeRead(f.files[0], fs.constants.O_RDONLY, { mutate: true }).code, "postgres_gosu_source_inspect_source_changed");
});
test("native default entry point proves the cleared actor and four real FD identities, then refuses unpinned harmless bytes", {
  skip: clearedActor ? false : "Real Linux1000 cleared kernel groups and NNP1 required for default context rejection fixture",
}, (t) => {
  const f = fixture(t); const sizes = [17622, 13793, 1861264, 34150120];
  for (let i = 0; i < f.files.length; i++) fs.truncateSync(f.files[i], sizes[i]);
  const fds = f.files.map((file) => fs.openSync(file, fs.constants.O_RDONLY));
  try {
    const before = f.files.map((file) => hash(fs.readFileSync(file)));
    const result = spawnSync(python, ["-I", "-S", "-B", helper], { env, stdio: ["ignore", "pipe", "pipe", ...fds],
      encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.equal(result.stdout, "");
    assert.equal(result.stderr, "postgres_gosu_source_inspect_fingerprint_invalid\n");
    const argument = spawnSync(python, ["-I", "-S", "-B", helper, "harmless-unaccepted-argument"], { env, stdio: ["ignore", "pipe", "pipe", ...fds],
      encoding: "utf8", timeout: 15000, windowsHide: true });
    assert.equal(argument.error, undefined); assert.equal(argument.status, 1); assert.equal(argument.stdout, "");
    assert.equal(argument.stderr, "postgres_gosu_source_inspect_context_invalid\n");
    assert.deepEqual(f.files.map((file) => hash(fs.readFileSync(file))), before);
    for (const fd of fds) assert.equal(fs.fstatSync(fd).nlink, 1);
  } finally { for (const fd of fds) fs.closeSync(fd); }
});
