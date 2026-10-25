import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import { posix as path } from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const STABLE = ["dev", "ino", "uid", "gid", "mode", "nlink"];
const META = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const native = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n), nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const directoryNative = (s) => Object.fromEntries(DIRECTORY.map((key) => [key, native(s)[key]]));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, keys) => plain(v) && Reflect.ownKeys(v).every((key) => typeof key === "string") && isDeepStrictEqual(Reflect.ownKeys(v).sort(), [...keys].sort()) && Reflect.ownKeys(v).every((key) => {
  const d = Object.getOwnPropertyDescriptor(v, key); return typeof key === "string" && d.enumerable && Object.hasOwn(d, "value");
});
function metadata(value, size, uid = 1000, gid = 1000, mode = 0o600) {
  return exact(value, META) && ["dev", "ino", "mtimeNs", "ctimeNs"].every((key) => typeof value[key] === "string" && DECIMAL.test(value[key])) &&
    ["uid", "gid", "mode", "nlink", "size"].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0) &&
    value.uid === uid && value.gid === gid && value.mode === mode && value.nlink === 1 && value.size === size;
}

// Internal filesystem mechanism only. Each fixed publisher retains its own closed errors and authority.
export function createSourceRetentionNativeSession(deadline, signal, fail, options = undefined) {
  const clock = options === undefined ? Date.now : (() => {
    if (!exact(options, ["clock"]) || options.clock !== "MONOTONIC") fail("arguments_invalid");
    return performance.now.bind(performance);
  })();
  const handles = []; const anchors = new Map(); let closed = false;
  const check = () => { if (signal.aborted) fail("aborted"); if (clock() >= deadline) fail("deadline_exceeded"); };
  const anchor = (file, rootOnly = false) => {
    let at = "/";
    for (const part of ["", ...file.split("/").filter(Boolean)]) {
      if (part) at = path.join(at, part); const s = lstatSync(at, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(at) !== at || !(rootOnly ? s.uid === 0n : [0n, 1000n].includes(s.uid)) ||
        (s.mode & 0o6000n) !== 0n || (s.mode & 0o0022n) !== 0n && !(s.uid === 0n && (s.mode & 0o1000n) !== 0n && !rootOnly)) fail("storage_invalid");
      if (anchors.has(at)) continue;
      const fd = openSync(at, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(fd); anchors.set(at, { fd, identity: directoryNative(s) });
    }
  };
  const guards = (bounded = true) => {
    if (bounded) check();
    for (const [file, entry] of anchors) {
      const s = lstatSync(file, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(file) !== file || !isDeepStrictEqual(directoryNative(s), entry.identity) ||
        !closed && !isDeepStrictEqual(directoryNative(fstatSync(entry.fd, { bigint: true })), entry.identity)) fail("file_changed");
    }
  };
  const directory = (file, expected) => {
    anchor(file); if (!isDeepStrictEqual(directoryNative(lstatSync(file, { bigint: true })), expected) || statfsSync(file, { bigint: true }).type !== 0xef53n) fail("storage_invalid");
    const result = spawnSync("/usr/bin/findmnt", ["--noheadings", "--output", "FSTYPE", "--target", file], { timeout: Math.min(10000, Math.max(1, deadline - clock())), maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
    if (result.error || result.status !== 0 || result.signal || result.stderr.length || !result.stdout.equals(Buffer.from("ext4\n"))) fail("storage_invalid"); guards();
  };
  const fileGuard = (item, unchanged = true) => {
    guards(); const s = fstatSync(item.fd, { bigint: true }); const named = lstatSync(item.file, { bigint: true }); const id = native(s);
    if (!s.isFile() || !named.isFile() || named.isSymbolicLink() || realpathSync(item.file) !== item.file || !isDeepStrictEqual(native(named), id) ||
      !metadata(id, item.expected.size, item.uid, item.gid, item.mode) || unchanged && item.identity && !isDeepStrictEqual(item.identity, id)) fail("file_changed"); return id;
  };
  const open = (file, expected, uid = 1000, gid = 1000, mode = 0o600, rootOnly = false) => {
    anchor(path.dirname(file), rootOnly); guards(); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); handles.push(fd);
    const item = { file, fd, expected, uid, gid, mode }; item.identity = fileGuard(item);
    const flags = /^flags:[ \t]+([0-7]+)$/mu.exec(readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"));
    if (!flags || (Number.parseInt(flags[1], 8) & 3) !== constants.O_RDONLY) fail("file_invalid"); return item;
  };
  const read = (item, retain = false) => {
    fileGuard(item); const buffer = Buffer.alloc(Math.min(1024 ** 2, item.expected.size)); const digest = createHash("sha256"); const chunks = []; let at = 0;
    while (at < item.expected.size) { check(); const n = readSync(item.fd, buffer, 0, Math.min(buffer.length, item.expected.size - at), at);
      if (n < 1) fail("file_changed"); digest.update(buffer.subarray(0, n)); if (retain) chunks.push(Buffer.from(buffer.subarray(0, n))); at += n; }
    if (readSync(item.fd, Buffer.alloc(1), 0, 1, at) !== 0 || digest.digest("hex") !== item.expected.sha256) fail("file_changed"); fileGuard(item);
    return retain ? Buffer.concat(chunks) : undefined;
  };
  const create = (file, expected) => {
    anchor(path.dirname(file)); guards(); const fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); handles.push(fd);
    return { file, fd, expected, uid: 1000, gid: 1000, mode: 0o600, own: native(fstatSync(fd, { bigint: true })) };
  };
  const copy = (source, file) => {
    fileGuard(source); const target = create(file, source.expected); const buffer = Buffer.alloc(Math.min(1024 ** 2, source.expected.size)); let at = 0;
    while (at < source.expected.size) { check(); const n = readSync(source.fd, buffer, 0, Math.min(buffer.length, source.expected.size - at), at);
      if (n < 1) fail("file_changed"); let wrote = 0; while (wrote < n) { const count = writeSync(target.fd, buffer, wrote, n - wrote, at + wrote); if (count < 1) fail("publication_failed"); wrote += count; } at += n; }
    fsyncSync(target.fd); target.identity = fileGuard(target, false); read(source); read(target); return target;
  };
  const publish = (file, bytes) => {
    const item = create(file, { size: bytes.length, sha256: hash(bytes) });
    return { item, finish() { let at = 0; while (at < bytes.length) { check(); const n = writeSync(item.fd, bytes, at, bytes.length - at, at); if (n < 1) fail("publication_failed"); at += n; }
      fsyncSync(item.fd); item.identity = fileGuard(item, false); if (!read(item, true).equals(bytes)) fail("publication_failed"); } };
  };
  const close = () => { if (closed) return; closed = true; let uncertain = false; for (const fd of handles.splice(0)) try { closeSync(fd); } catch { uncertain = true; }
    if (uncertain) fail("cleanup_uncertain"); };
  const retire = (item) => {
    guards(false); const s = lstatSync(item.file, { bigint: true }); const id = native(s);
    if (!s.isFile() || s.isSymbolicLink() || realpathSync(item.file) !== item.file || STABLE.some((key) => id[key] !== item.own[key])) fail("cleanup_uncertain"); unlinkSync(item.file);
  };
  return { guards, directory, open, read, create, copy, publish, close, retire, fileGuard, check };
}
