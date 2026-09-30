import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync, readSync,
  realpathSync, statfsSync, writeSync } from "node:fs";
import path from "node:path";
import { setTimeout, clearTimeout } from "node:timers";
import { isDeepStrictEqual } from "node:util";

export const postgresSqlBackupLimits = Object.freeze({ bytes: 16 * 1024 ** 2, outputBytes: 1024 ** 2 });
const FILE = "diagnostic.dump"; const HEX = /^[0-9a-f]{64}$/u;
const plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, list) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...list].sort());
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, freeze(x)]))) : v;
const fail = (reason) => { throw new Error(`postgres_sql_backup_${reason}`); };
const canonical = (v) => typeof v === "string" && v.length < 512 && path.posix.isAbsolute(v) && path.posix.normalize(v) === v;
const metadata = (v) => ({ dev: String(v.dev), ino: String(v.ino), uid: Number(v.uid), gid: Number(v.gid),
  mode: Number(v.mode & 0o7777n), nlink: Number(v.nlink), mtimeNs: String(v.mtimeNs), ctimeNs: String(v.ctimeNs) });
function nativeDirectory(directory) {
  if (process.platform !== "linux" || !(process.getuid?.() > 0) || !(process.getgid?.() > 0)
    || process.geteuid?.() !== process.getuid() || process.getegid?.() !== process.getgid()) fail("requires_nonroot_linux");
  if (!canonical(directory)) fail("directory_invalid");
  const s = lstatSync(directory, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(directory) !== directory || s.uid !== BigInt(process.getuid())
    || s.gid !== BigInt(process.getgid()) || (s.mode & 0o7777n) !== 0o700n || statfsSync(directory, { bigint: true }).type !== 0xef53n) fail("directory_invalid");
  const r = spawnSync("/usr/bin/findmnt", ["--noheadings", "--output", "FSTYPE", "--target", directory],
    { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: null, timeout: 10_000, maxBuffer: 1024 });
  if (r.error || r.signal || r.status !== 0 || r.stderr.length || !r.stdout.equals(Buffer.from("ext4\n"))) fail("directory_invalid");
  return { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode };
}
function pathSeal(directory, directoryIdentity, file, fd, expected) {
  const parent = lstatSync(directory, { bigint: true }); const stat = fstatSync(fd, { bigint: true }); const named = lstatSync(file, { bigint: true });
  if (!parent.isDirectory() || parent.isSymbolicLink() || realpathSync(directory) !== directory
    || Object.entries(directoryIdentity).some(([k, v]) => parent[k] !== v)
    || !stat.isFile() || named.isSymbolicLink() || realpathSync(file) !== file || stat.uid !== BigInt(process.getuid())
    || stat.gid !== BigInt(process.getgid()) || (stat.mode & 0o7777n) !== 0o600n || stat.nlink !== 1n
    || !isDeepStrictEqual(metadata(stat), metadata(named)) || stat.size !== named.size
    || stat.size < 5n || stat.size > BigInt(postgresSqlBackupLimits.bytes)
    || expected && (!isDeepStrictEqual(metadata(stat), expected.identity) || stat.size !== BigInt(expected.size))) fail("file_changed");
  const hash = createHash("sha256"); const buffer = Buffer.alloc(65536); let position = 0;
  if (readSync(fd, buffer, 0, 5, 0) !== 5 || !buffer.subarray(0, 5).equals(Buffer.from("PGDMP"))) fail("format_invalid");
  while (position < Number(stat.size)) {
    const n = readSync(fd, buffer, 0, Math.min(buffer.length, Number(stat.size) - position), position);
    if (n < 1) fail("file_changed");
    hash.update(buffer.subarray(0, n)); position += n;
  }
  if (readSync(fd, buffer, 0, 1, position) !== 0) fail("file_changed");
  const sha256 = hash.digest("hex"); const final = fstatSync(fd, { bigint: true }); const finalNamed = lstatSync(file, { bigint: true });
  const finalParent = lstatSync(directory, { bigint: true });
  if (!isDeepStrictEqual(metadata(stat), metadata(final)) || !isDeepStrictEqual(metadata(stat), metadata(finalNamed))
    || final.size !== stat.size || finalNamed.size !== stat.size || Object.entries(directoryIdentity).some(([k, v]) => finalParent[k] !== v)
    || expected && sha256 !== expected.sha256) fail("file_changed");
  return freeze({ kind: "POSTGRES_SQL_PRIVATE_DUMP_V1", state: "SEALED", directory, name: FILE,
    size: Number(stat.size), sha256, identity: metadata(stat), format: "POSTGRESQL_CUSTOM",
    interpretation: "NOT_FULLY_ESTABLISHED_BY_TRANSPORT" });
}
export function validatePostgresSqlBackupProof(value, expectedDirectory) {
  if (!keys(value, ["kind", "state", "directory", "name", "size", "sha256", "identity", "format", "interpretation"])
    || value.kind !== "POSTGRES_SQL_PRIVATE_DUMP_V1" || value.state !== "SEALED" || !canonical(value.directory)
    || expectedDirectory !== undefined && value.directory !== expectedDirectory || value.name !== FILE
    || !Number.isSafeInteger(value.size) || value.size < 5 || value.size > postgresSqlBackupLimits.bytes || typeof value.sha256 !== "string" || !HEX.test(value.sha256)
    || !keys(value.identity, ["dev", "ino", "uid", "gid", "mode", "nlink", "mtimeNs", "ctimeNs"])
    || !["dev", "ino", "mtimeNs", "ctimeNs"].every((k) => typeof value.identity[k] === "string" && /^[0-9]{1,20}$/u.test(value.identity[k]))
    || value.identity.ino === "0" || !Number.isSafeInteger(value.identity.uid) || value.identity.uid < 1
    || !Number.isSafeInteger(value.identity.gid) || value.identity.gid < 1 || value.identity.mode !== 0o600 || value.identity.nlink !== 1
    || value.format !== "POSTGRESQL_CUSTOM" || value.interpretation !== "NOT_FULLY_ESTABLISHED_BY_TRANSPORT") fail("proof_invalid");
  return freeze(globalThis.structuredClone(value));
}
function result(value, inputBytes) {
  if (!plain(value) || value.error || value.signal || value.status !== 0 || !Buffer.isBuffer(value.stdout) || !Buffer.isBuffer(value.stderr)
    || value.stdout.length + value.stderr.length > postgresSqlBackupLimits.outputBytes
    || inputBytes !== undefined && value.inputBytes !== inputBytes) fail("transport_failed");
}
function controls(value, control) {
  if (!keys(control, ["run"]) || typeof control.run !== "function" || !(value.signal instanceof globalThis.AbortSignal)) fail("arguments_invalid");
  if (value.signal.aborted) fail("aborted");
}
export async function dumpPostgresDiagnosticSql(value, control) {
  if (!keys(value, ["directory", "signal"])) fail("arguments_invalid"); controls(value, control);
  const before = nativeDirectory(value.directory); const file = path.join(value.directory, FILE);
  let fd; let bytes = 0;
  try {
    fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); fchmodSync(fd, 0o600);
    const sink = (chunk) => {
      if (!Buffer.isBuffer(chunk) || value.signal.aborted || bytes + chunk.length > postgresSqlBackupLimits.bytes) fail("output_overflow");
      let offset = 0; while (offset < chunk.length) { const n = writeSync(fd, chunk, offset, chunk.length - offset, bytes + offset);
        if (n < 1) fail("write_failed"); offset += n; } bytes += chunk.length;
    };
    const r = await control.run(Object.freeze({ operation: "DUMP", outputSink: sink })); result(r);
    if (value.signal.aborted || bytes < 5 || r.outputBytes !== bytes) fail("transport_failed");
    fsyncSync(fd); return pathSeal(value.directory, before, file, fd);
  } finally { if (fd !== undefined) { try { closeSync(fd); } catch { fail("descriptor_cleanup_failed"); } } }
}
export function sealPostgresSqlBackup(value) {
  const proof = validatePostgresSqlBackupProof(value); const before = nativeDirectory(proof.directory); let fd;
  try { fd = openSync(path.join(proof.directory, FILE), constants.O_RDONLY | constants.O_NOFOLLOW);
    return pathSeal(proof.directory, before, path.join(proof.directory, FILE), fd, proof);
  } finally { if (fd !== undefined) { try { closeSync(fd); } catch { fail("descriptor_cleanup_failed"); } } }
}
export async function restorePostgresDiagnosticSql(value, control) {
  if (!keys(value, ["proof", "signal"])) fail("arguments_invalid"); controls(value, control);
  const proof = validatePostgresSqlBackupProof(value.proof); const before = nativeDirectory(proof.directory); let fd;
  try {
    const file = path.join(proof.directory, FILE); fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    pathSeal(proof.directory, before, file, fd, proof);
    // Positioned seals leave the newly opened shared FD at offset0 for the binary transport.
    const r = await control.run(Object.freeze({ operation: "RESTORE", inputFd: fd, inputBytes: proof.size })); result(r, proof.size);
    if (value.signal.aborted) fail("aborted"); return pathSeal(proof.directory, before, file, fd, proof);
  } finally { if (fd !== undefined) { try { closeSync(fd); } catch { fail("descriptor_cleanup_failed"); } } }
}
export function postgresSqlCommandTransport(command, args, options) {
  return new Promise((resolve) => {
    options.beforeSpawn?.();
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true,
      stdio: [options.inputFd === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const chunks = { stdout: [], stderr: [] }; let outputBytes = 0; let inputBytes = 0; let captured = 0;
    let forced = false; let done = false; let ended = options.inputFd === undefined; let timer; let closeTimer; let killed = false; let cancelWrite;
    const finish = (status, signal) => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(closeTimer); options.signal.removeEventListener("abort", kill);
      cancelWrite?.(); if (!ended) forced = true;
      if (forced) { child.stdin?.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
      resolve({ status, signal, error: forced, inputBytes, outputBytes, stdout: Buffer.concat(chunks.stdout), stderr: Buffer.concat(chunks.stderr) });
    };
    const kill = () => {
      if (done) return; forced = true; cancelWrite?.();
      if (!killed) { killed = true; try { child.kill("SIGKILL"); } catch { /* Server exec quiescence is established by the engine's owned-container stop. */ } }
      if (closeTimer === undefined) closeTimer = setTimeout(() => finish(null, null), 1000);
    };
    child.stdout.on("data", (chunk) => {
      if (done) return;
      try {
        if (options.outputSink) { if (outputBytes + chunk.length > postgresSqlBackupLimits.bytes) throw new Error("overflow"); options.outputSink(chunk); outputBytes += chunk.length; }
        else { captured += chunk.length; if (captured > postgresSqlBackupLimits.outputBytes) throw new Error("overflow"); chunks.stdout.push(chunk); }
      } catch { kill(); }
    });
    child.stderr.on("data", (chunk) => { if (done) return; captured += chunk.length;
      if (captured > postgresSqlBackupLimits.outputBytes) kill(); else chunks.stderr.push(chunk); });
    for (const stream of [child.stdout, child.stderr, child.stdin].filter(Boolean)) stream.on("error", kill);
    child.on("error", () => { forced = true; if (Number.isSafeInteger(child.pid) && child.pid > 1) kill(); else finish(null, null); });
    child.on("close", finish);
    timer = setTimeout(kill, options.timeoutMs); options.signal.addEventListener("abort", kill, { once: true });
    if (options.signal.aborted) kill();
    if (options.inputFd !== undefined) {
      child.stdin.once("finish", () => { ended = true; });
      const write = (chunk) => new Promise((yes, no) => {
        const finishWrite = (error) => { cancelWrite = undefined; if (error) no(error); else yes(); };
        cancelWrite = () => finishWrite(new Error("transport interrupted"));
        if (done || forced) { cancelWrite(); return; } child.stdin.write(chunk, finishWrite);
      });
      (async () => {
        const buffer = Buffer.alloc(65536);
        while (inputBytes < options.inputBytes && !done && !forced) {
          const n = readSync(options.inputFd, buffer, 0, Math.min(buffer.length, options.inputBytes - inputBytes), inputBytes);
          if (n < 1) { kill(); return; }
          const chunk = Buffer.from(buffer.subarray(0, n));
          await write(chunk); inputBytes += n;
        }
        if (done || forced || inputBytes !== options.inputBytes || readSync(options.inputFd, buffer, 0, 1, inputBytes) !== 0) { kill(); return; }
        child.stdin.end();
      })().catch(kill);
    }
  });
}
