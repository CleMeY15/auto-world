import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { POSTGRES_UPSTREAM_SOURCE_PIN as PIN } from "../scripts/postgres-image/postgres-upstream-source-policy.mjs";

const helper = fileURLToPath(new URL("../scripts/postgres-image/postgres-source-notices-inspect.py", import.meta.url));
const core = fileURLToPath(new URL("../scripts/postgres-image/source-notices-inspect.py", import.meta.url));
const python = process.platform === "linux" ? "/usr/bin/python3.12"
  : "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const available = fs.existsSync(python);
const pureOptions = { skip: available ? false : "Configured public Python unavailable; no parser success claimed" };
const env = { PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = "public-fixture";
const pgSha = "dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979";
const dockerfile = Buffer.from(`FROM harmless\nENV PG_VERSION 17.11\nENV PG_SHA256 ${pgSha}\n`);
const pureCode = `import base64,bz2,hashlib,json,runpy,sys
m=runpy.run_path(sys.argv[1]);old=runpy.run_path(sys.argv[2]);v=json.load(sys.stdin)
class Source:
 def __init__(self,b):self.data=b;self.size=len(b)
 def read_at(self,p,n):return self.data[p:p+n]
try:
 raw=base64.b64decode(v.get('bytes',''),validate=True)
 if v['op']=='binding':value=m['_docker_binding'](raw)
 elif v['op']=='pins':value={'pins':m['PINS'],'selected':m['SELECTED_PINS'],'runtime':m['RUNTIME_PINS'],'coreSize':m['OLD_HELPER_SIZE'],'coreSha':m['OLD_HELPER_SHA256']}
 else:
  packed=bz2.compress(raw) if v.get('compress') else raw
  if v.get('truncate'):packed=packed[:-v['truncate']]
  if v.get('concat'):packed+=bz2.compress(b'other stream')
  if v.get('corrupt'):
   changed=bytearray(packed);changed[10]^=1;packed=bytes(changed)
  if v.get('trailer'):packed+=base64.b64decode(v['trailer'],validate=True)
  source=Source(packed);reader=m['_BZ2Reader'](source,v.get('cap',m['MAX_TAR_BYTES']))
  if v['op']=='bz2':
   chunks=[];pending=False
   while True:
    pending|=not reader.decoder.needs_input and not reader.done
    part=reader.read(v.get('pull',65536))
    if not part:break
    chunks.append(part)
   data=b''.join(chunks);value={'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'total':reader.total,'done':reader.done,'empty':not reader.buffer,'drainedPendingInput':pending}
  else:
   value=old['_inspect_tar'](source,v['root'],v['selected'],v.get('pax'),_reader=reader)
   value['files']={k:base64.b64encode(b).decode('ascii') for k,b in value['files'].items()}
   value['decodedTarBytes']=reader.total
 print(json.dumps({'state':'TOY_PASSIVE_VERIFIED','value':value},sort_keys=True))
except BaseException:
 print(json.dumps({'state':'TOY_PASSIVE_REFUSED'}))
`;
function pure(input) {
  const result = spawnSync(python, ["-I", "-S", "-B", "-c", pureCode, helper, core], {
    input: JSON.stringify(input), encoding: "utf8", timeout: 15000, maxBuffer: 256 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}
const bzipInput = (bytes, extra = {}) => ({ op: "bz2", bytes: bytes.toString("base64"), compress: true, ...extra });
const octal = (n, size) => Buffer.from(n.toString(8).padStart(size - 1, "0") + "\0", "ascii");
function header(name, bytes, kind = "0", link = "") {
  const h = Buffer.alloc(512); h.write(name, 0, 100); octal(0o644, 8).copy(h, 100); octal(1000, 8).copy(h, 108); octal(1000, 8).copy(h, 116);
  octal(bytes.length, 12).copy(h, 124); octal(0, 12).copy(h, 136); h.fill(32, 148, 156); h.write(kind, 156, 1); h.write(link, 157, 100);
  h.write("ustar\0", 257, 6); h.write("00", 263, 2); h.write(h.reduce((sum, v) => sum + v, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8); return h;
}
function tarRaw(entries, tail = Buffer.alloc(1024)) {
  return Buffer.concat([...entries.flatMap(e => { const b = e.bytes ?? Buffer.alloc(0); return [header(e.name, b, e.kind ?? "0", e.link ?? ""), b, Buffer.alloc((-b.length >>> 0) % 512)]; }), tail]);
}
const entries = () => [{ name: root + "/", kind: "5" }, { name: root + "/COPYRIGHT", bytes: Buffer.from("public copyright\n") }];
const tarInput = (bytes, extra = {}) => ({ op: "tar", bytes: bytes.toString("base64"), compress: true, root, selected: ["COPYRIGHT", "LICENSE", "NOTICE"], ...extra });
function pax(key, value) { const body = `${key}=${value}\n`; let n = Buffer.byteLength(body) + 3; for (;;) { const next = Buffer.byteLength(`${n} ${body}`); if (n === next) return Buffer.from(`${n} ${body}`); n = next; } }

test("single bzip2 stream drains buffered decoder data without requesting another input", pureOptions, () => {
  const bytes = Buffer.alloc(3 * 65536 + 17, 65); const result = pure(bzipInput(bytes, { pull: 65536 }));
  assert.equal(result.state, "TOY_PASSIVE_VERIFIED"); assert.deepEqual(result.value, { size: bytes.length, sha256: sha(bytes), total: bytes.length, done: true, empty: true, drainedPendingInput: true });
});
test("bzip2 exact cap proves EOF while one byte over cap and expansion bombs refuse", pureOptions, () => {
  const bytes = Buffer.alloc(1024, 65); const result = pure(bzipInput(bytes, { cap: bytes.length, pull: 17 }));
  assert.equal(result.state, "TOY_PASSIVE_VERIFIED"); assert.equal(result.value.total, 1024); assert.equal(result.value.done, true);
  for (const raw of [Buffer.alloc(1025, 65), Buffer.alloc(1024 * 1024, 65)]) assert.equal(pure(bzipInput(raw, { cap: 1024 })).state, "TOY_PASSIVE_REFUSED");
  for (const cap of [0, -1, 192 * 1024 ** 2 + 1, [1024]]) assert.equal(pure(bzipInput(bytes, { cap })).state, "TOY_PASSIVE_REFUSED");
});
test("bzip2 refuses truncation CRC corruption concatenation and both buffered and late trailers", pureOptions, () => {
  const bytes = Buffer.from("small harmless payload\n");
  for (const extra of [{ truncate: 1 }, { truncate: 8 }, { corrupt: true }, { concat: true }, { trailer: Buffer.from("tail").toString("base64") },
    { trailer: Buffer.alloc(65537, 1).toString("base64") }]) assert.equal(pure(bzipInput(bytes, extra)).state, "TOY_PASSIVE_REFUSED");
  const invalid = Buffer.from("BZh9not a valid stream"); assert.equal(pure({ ...bzipInput(invalid), compress: false }).state, "TOY_PASSIVE_REFUSED");
});
test("bzip2 zero-content EOF and small pulls stay bounded and preserve exact bytes", pureOptions, () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from("x"), Buffer.alloc(65536 + 1, 91)]) {
    const result = pure(bzipInput(bytes, { pull: 1 })); assert.equal(result.state, "TOY_PASSIVE_VERIFIED"); assert.equal(result.value.sha256, sha(bytes)); assert.equal(result.value.size, bytes.length);
  }
});
test("shared TAR parser preserves selected bytes and exact decoded count for a bzip2 toy", pureOptions, () => {
  const raw = tarRaw(entries()); const result = pure(tarInput(raw)); assert.equal(result.state, "TOY_PASSIVE_VERIFIED");
  assert.equal(result.value.entries, 2); assert.equal(result.value.uncompressedBytes, 17); assert.equal(result.value.decodedTarBytes, raw.length);
  assert.equal(Buffer.from(result.value.files.COPYRIGHT, "base64").toString(), "public copyright\n"); assert.equal(result.value.files.LICENSE, undefined); assert.deepEqual(result.value.symlinks, []);
});
test("shared TAR refuses root aliases traversal casefold collisions and all links or devices", pureOptions, () => {
  for (const extra of [{ name: "foreign/x", bytes: Buffer.from("x") }, { name: root + "/../x", bytes: Buffer.from("x") },
    { name: root + "/copyright", bytes: Buffer.from("x") }, { name: root + "/link", kind: "2", link: "COPYRIGHT" },
    { name: root + "/hard", kind: "1", link: "COPYRIGHT" }, { name: root + "/device", kind: "3" }]) assert.equal(pure(tarInput(tarRaw([...entries(), extra]))).state, "TOY_PASSIVE_REFUSED");
});
test("shared TAR rejects nonzero or missing EOA checksum mutations and selected notice overflow", pureOptions, () => {
  for (const tail of [Buffer.alloc(512), Buffer.from("not aligned"), Buffer.alloc(1024, 1)]) assert.equal(pure(tarInput(tarRaw(entries(), tail))).state, "TOY_PASSIVE_REFUSED");
  const raw = tarRaw(entries()); raw[148] ^= 1; assert.equal(pure(tarInput(raw)).state, "TOY_PASSIVE_REFUSED");
  const oversized = entries(); oversized[1].bytes = Buffer.alloc(16 * 1024 + 1); assert.equal(pure(tarInput(tarRaw(oversized))).state, "TOY_PASSIVE_REFUSED");
});
test("shared TAR only permits the fixed passive PAX declaration and unchanged gzip framing", pureOptions, () => {
  const comment = "a".repeat(40); const raw = tarRaw([{ name: "pax_global_header", kind: "g", bytes: pax("comment", comment) }, ...entries()]);
  assert.equal(pure(tarInput(raw, { pax: comment })).state, "TOY_PASSIVE_VERIFIED");
  assert.equal(pure(tarInput(raw, { pax: "b".repeat(40) })).state, "TOY_PASSIVE_REFUSED");
  assert.equal(pure(tarInput(tarRaw([{ name: root + "/PaxHeaders/x", kind: "x", bytes: pax("size", "12") }, ...entries()]))).state, "TOY_PASSIVE_REFUSED");
  const gzip = gzipSync(tarRaw(entries()));
  const code = `import base64,json,runpy,sys\nm=runpy.run_path(sys.argv[1]);b=base64.b64decode(sys.argv[2]);s=type('S',(),{'size':len(b),'read_at':lambda self,p,n:b[p:p+n]})();r=m['_GzipReader'](s);v=m['_inspect_tar'](s,'public-fixture',['COPYRIGHT'],_reader=r);print(json.dumps({'entries':v['entries'],'decoded':r.total}))`;
  const result = spawnSync(python, ["-I", "-S", "-B", "-c", code, core, gzip.toString("base64")], { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(result.status, 0); assert.equal(result.stderr, ""); assert.deepEqual(JSON.parse(result.stdout), { entries: 2, decoded: tarRaw(entries()).length });
});
test("Docker binding accepts only exact single SPACE definitions and no shell or equal-form normalization", pureOptions, () => {
  const accepted = pure({ op: "binding", bytes: dockerfile.toString("base64") }); assert.equal(accepted.state, "TOY_PASSIVE_VERIFIED"); assert.equal(accepted.value.pgVersion, "17.11"); assert.equal(accepted.value.pgSourceSha256, pgSha);
  for (const value of [Buffer.from(dockerfile.toString().replace("PG_VERSION 17.11", "PG_VERSION=17.11")), Buffer.concat([dockerfile, Buffer.from("ENV PG_VERSION 17.11\n")]),
    Buffer.concat([dockerfile, Buffer.from(" env PG_VERSION=17.11\n")]), Buffer.from(dockerfile.toString().replace(pgSha, "$UNTRUSTED")),
    Buffer.from(dockerfile.toString().replaceAll("\n", "\r\n")), Buffer.from([255])]) assert.equal(pure({ op: "binding", bytes: value.toString("base64") }).state, "TOY_PASSIVE_REFUSED");
});
test("fixed pins preserve two exact archives five texts code8 and root bz2 identities", pureOptions, () => {
  const value = pure({ op: "pins" }).value; assert.deepEqual(value.pins.map(v => v.role), ["POSTGRES_UPSTREAM_SOURCE", "DOCKER_LIBRARY_POSTGRES_SOURCE"]);
  assert.deepEqual(value.pins.map(v => v.size), [21787224, 56252]); assert.deepEqual(value.pins.map(v => v.entries), [7718, 122]); assert.deepEqual(value.pins.map(v => v.raw), [135730425, 680576]); assert.deepEqual(value.pins.map(v => v.decoded), [141578240, 768000]);
  assert.equal(value.coreSize, fs.statSync(core).size); assert.equal(value.coreSha, sha(fs.readFileSync(core)));
  assert.equal(value.selected[0].COPYRIGHT[0], 1198); assert.equal(Object.keys(value.selected[0]).length + Object.keys(value.selected[1]).length, 5);
  assert.deepEqual(value.runtime.map(v => v.size), [11847, 32112]);
  assert.equal(value.coreSize, PIN.inspector.core.size); assert.equal(value.coreSha, PIN.inspector.core.sha256);
  for (const [i, row] of value.pins.entries()) {
    const fixed = PIN.archives[i]; assert.equal(row.role, fixed.role); assert.equal(row.name, fixed.name); assert.equal(row.size, fixed.size); assert.equal(row.sha256, fixed.sha256);
    assert.equal(row.entries, fixed.entries); assert.equal(row.raw, fixed.uncompressedBytes); assert.equal(row.decoded, fixed.decodedTarBytes);
    assert.deepEqual(Object.entries(value.selected[i]).map(([member, [size, sha256]]) => ({ path: member, size, sha256 })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), fixed.selectedFiles);
    assert.deepEqual(row.selected.filter(name => !Object.hasOwn(value.selected[i], name)).sort(), fixed.missingSelectedFiles);
  }
  assert.deepEqual(value.runtime, PIN.python.files.slice(-2).map(v => ({ path: v.source, size: v.size, sha256: v.sha256 })));
});

const native = available && process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000;
const nativeOptions = { skip: native ? false : "Real Linux UID/GID1000 with fixed Python required for native descriptor fixtures" };
const cleared = native && /^Groups:[ \t]*$/mu.test(fs.readFileSync("/proc/self/status", "utf8")) && /^NoNewPrivs:[ \t]+1$/mu.test(fs.readFileSync("/proc/self/status", "utf8"));
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-upstream-python-"))); fs.chmodSync(directory, 0o700); const identity = fs.lstatSync(directory, { bigint: true });
  t.after(() => { const stat = fs.lstatSync(directory, { bigint: true }); assert.equal(stat.dev, identity.dev); assert.equal(stat.ino, identity.ino); assert.equal(fs.realpathSync(directory), directory); fs.rmSync(directory, { recursive: true }); });
  const file = path.join(directory, "harmless.bin"); fs.writeFileSync(file, "public readonly fixture\n", { flag: "wx", mode: 0o600 }); fs.chmodSync(file, 0o600); return { directory, file };
}
const fdCode = `import hashlib,json,os,runpy,sys
m=runpy.run_path(sys.argv[1]);v=json.load(sys.stdin)
try:
 s=m['HeldDescriptor'](3,v['size'],v['sha256'],1000,(0o600,));s.fingerprint()
 if v.get('mutate'):
  with open(v['file'],'r+b',buffering=0) as w:w.write(b'X')
  s.fingerprint()
 print(json.dumps({'state':'NATIVE_READONLY_VERIFIED','identity':s.before}))
except m['InspectionError'] as e:print(json.dumps({'state':'REFUSED','code':m['PREFIX']+e.reason}))
`;
function nativeRead(file, flags, extra = {}) {
  const bytes = fs.readFileSync(file); const fd = fs.openSync(file, flags);
  try { const result = spawnSync(python, ["-I", "-S", "-B", "-c", fdCode, helper], { input: JSON.stringify({ file, size: bytes.length, sha256: sha(bytes), ...extra }), env, stdio: ["pipe", "pipe", "pipe", fd], encoding: "utf8", timeout: 15000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, ""); return JSON.parse(result.stdout);
  } finally { fs.closeSync(fd); }
}
test("native descriptor retains all nine fields readonly identity and true1000 ownership", nativeOptions, t => {
  const f = fixture(t); const value = nativeRead(f.file, fs.constants.O_RDONLY); assert.equal(value.state, "NATIVE_READONLY_VERIFIED");
  assert.deepEqual(Object.keys(value.identity).sort(), ["ctimeNs", "dev", "gid", "ino", "mode", "mtimeNs", "nlink", "size", "uid"]); assert.equal(value.identity.uid, 1000); assert.equal(value.identity.mode, 0o600); assert.equal(value.identity.ino, String(fs.statSync(f.file, { bigint: true }).ino));
});
test("native descriptor rejects readwrite O_PATH special modes broad modes hardlinks and mutations", nativeOptions, t => {
  const f = fixture(t); for (const flags of [fs.constants.O_RDWR, 0x200000]) assert.equal(nativeRead(f.file, flags).code, "postgres_upstream_source_inspect_descriptor_invalid");
  for (const mode of [0o4600, 0o660, 0o644]) { fs.chmodSync(f.file, mode); assert.equal(nativeRead(f.file, fs.constants.O_RDONLY).code, "postgres_upstream_source_inspect_descriptor_invalid"); }
  fs.chmodSync(f.file, 0o600); assert.equal(nativeRead(f.file, fs.constants.O_RDONLY, { mutate: true }).code, "postgres_upstream_source_inspect_source_changed");
  fs.linkSync(f.file, path.join(f.directory, "linked")); assert.equal(nativeRead(f.file, fs.constants.O_RDONLY).code, "postgres_upstream_source_inspect_descriptor_invalid");
});
test("native close covers every inherited slot before output and prioritizes uncertain closure", nativeOptions, t => {
  const f = fixture(t); const fd = fs.openSync(f.file, fs.constants.O_RDONLY);
  const code = `import errno,json,os,runpy,sys\nm=runpy.run_path(sys.argv[1]);os.close(8) if sys.argv[2]=='uncertain' else None;r=m['_close_descriptors']('archive_invalid');closed=[]\nfor n in range(3,9):\n try:os.fstat(n);closed.append(False)\n except OSError as e:closed.append(e.errno==errno.EBADF)\nprint(json.dumps({'result':r,'closed':closed}))`;
  try { for (const condition of ["normal", "uncertain"]) {
    const result = spawnSync(python, ["-I", "-S", "-B", "-c", code, helper, condition], { env, stdio: ["ignore", "pipe", "pipe", fd, fd, fd, fd, fd, fd], encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0); assert.equal(result.stderr, ""); assert.deepEqual(JSON.parse(result.stdout), { result: condition === "normal" ? "archive_invalid" : "cleanup_uncertain", closed: Array(6).fill(true) }); assert.equal(fs.fstatSync(fd).nlink, 1);
  } } finally { fs.closeSync(fd); }
});
test("actual six-slot entry point authenticates runtime and code then refuses unpinned toy sources", { skip: cleared ? false : "Actual1000/cleared groups/NNP1 required for fixed six-slot command refusal" }, t => {
  const f = fixture(t); const paths = [path.join(f.directory, "pg-toy"), path.join(f.directory, "docker-toy"),
    "/usr/lib/python3.12/bz2.py", "/usr/lib/python3.12/lib-dynload/_bz2.cpython-312-x86_64-linux-gnu.so",
    path.join(f.directory, "self.py"), path.join(f.directory, "core.py")];
  for (const [i, size] of [[0, 21787224], [1, 56252]]) { fs.writeFileSync(paths[i], "harmless unpinned bytes\n", { flag: "wx", mode: 0o600 }); fs.chmodSync(paths[i], 0o600); fs.truncateSync(paths[i], size); }
  fs.copyFileSync(helper, paths[4], fs.constants.COPYFILE_EXCL); fs.chmodSync(paths[4], 0o600); fs.copyFileSync(core, paths[5], fs.constants.COPYFILE_EXCL); fs.chmodSync(paths[5], 0o600);
  for (const [i, pin] of PIN.python.files.slice(-2).entries()) { const stat = fs.statSync(paths[i + 2]); assert.equal(stat.uid, 0); assert.equal(stat.gid, 0); assert.equal(stat.mode & 0o7777, 0o644); assert.equal(stat.nlink, 1); assert.equal(sha(fs.readFileSync(paths[i + 2])), pin.sha256); }
  const fds = paths.map(name => fs.openSync(name, fs.constants.O_RDONLY)); const original = paths.filter((_, i) => i !== 2 && i !== 3).map(name => sha(fs.readFileSync(name)));
  try {
    const invoke = (extra = [], overrides = env, slots = fds) => spawnSync(python, ["-I", "-S", "-B", "/proc/self/fd/7", ...extra], { env: overrides, stdio: ["ignore", "pipe", "pipe", ...slots], encoding: "utf8", timeout: 15000 });
    const result = invoke(); assert.equal(result.error, undefined); assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.equal(result.stderr, "postgres_upstream_source_inspect_fingerprint_invalid\n");
    const extra = invoke(["not-an-accepted-argument"]); assert.equal(extra.status, 1); assert.equal(extra.stderr, "postgres_upstream_source_inspect_context_invalid\n");
    const broad = invoke([], { ...env, UNSUPPORTED: "harmless" }); assert.equal(broad.status, 1); assert.equal(broad.stderr, "postgres_upstream_source_inspect_context_invalid\n");
    const writable = fs.openSync(paths[4], fs.constants.O_RDWR);
    try { const slots = [...fds]; slots[4] = writable; const refused = invoke([], env, slots); assert.equal(refused.status, 1); assert.equal(refused.stdout, ""); assert.equal(refused.stderr, "postgres_upstream_source_inspect_descriptor_invalid\n"); }
    finally { fs.closeSync(writable); }
    fs.chmodSync(paths[4], 0o4600); const special = invoke(); assert.equal(special.status, 1); assert.equal(special.stderr, "postgres_upstream_source_inspect_descriptor_invalid\n"); fs.chmodSync(paths[4], 0o600);
    const bytes = fs.readFileSync(paths[5]); bytes[0] ^= 1; fs.writeFileSync(paths[5], bytes); const changed = invoke(); assert.equal(changed.status, 1); assert.equal(changed.stderr, "postgres_upstream_source_inspect_fingerprint_invalid\n"); fs.writeFileSync(paths[5], fs.readFileSync(core));
    assert.deepEqual(paths.filter((_, i) => i !== 2 && i !== 3).map(name => sha(fs.readFileSync(name))), original); for (const fd of fds) assert.equal(fs.fstatSync(fd).nlink, 1);
  } finally { for (const fd of fds) fs.closeSync(fd); }
});
