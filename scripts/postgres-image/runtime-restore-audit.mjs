import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readSync, realpathSync, readdirSync, writeSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { authenticatePostgresRemoteRuntimeSource, replayPostgresRuntimeAudit,
  validatePostgresRemoteRuntimePolicy } from "./candidate-remote-runtime-diagnostic.mjs";
import { MAX_DATABASE_AGE_MS, validateDatabaseMetadata } from "../scanner/audit-policy.mjs";

const CAPS = Object.freeze({ "infra/postgres-image/candidate-remote.json": 131072,
  "infra/postgres-image/candidate-runtime.json": 131072, "infra/postgres-image/lock.json": 1048576,
  "infra/postgres-image/Dockerfile": 1048576, "infra/postgres-image/candidate-publication-receipt.json": 1048576 });
const ENV = Object.freeze({ PATH: "/usr/bin:/bin", HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" });
const SETPRIV = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
const META = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const FILE = ["name", "sha256", "size", "source", "target"];
const PROOF = ["kind", "state", "source", "target", "sourceDirectory", "directory", "files", "sourceIdentities"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, keys) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort());
const fail = (suffix) => { throw new Error(`postgres_runtime_restore_audit_${suffix}`); };
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([k, v]) => [k, freeze(v)])));
  return value;
}
function actor(deadline) {
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (process.platform !== "linux" || ![0, 1000].includes(uid) || gid !== uid || process.geteuid?.() !== uid
    || process.getegid?.() !== gid || !Number.isSafeInteger(deadline) || deadline <= Date.now()
    || deadline - Date.now() > 20 * 60_000) fail("context_invalid");
  return uid;
}
function remaining(deadline) { const left = deadline - Date.now(); if (left <= 0) fail("deadline_exceeded"); return Math.min(10000, left); }
function absolute(file) {
  if (typeof file !== "string" || !path.posix.isAbsolute(file) || path.posix.normalize(file) !== file
    || file.includes("\0") || file.includes("\\")) fail("path_invalid");
}
function identity(s) {
  return { dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid),
    mode: Number(s.mode & 0o7777n), nlink: Number(s.nlink), size: Number(s.size),
    mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) };
}
function dir(file, privateMode = true) {
  absolute(file); const s = lstatSync(file, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== 1000n || s.gid !== 1000n
    || (s.mode & 0o7022n) !== 0n || privateMode && (s.mode & 0o7777n) !== 0o700n || realpathSync(file) !== file) fail("directory_invalid");
  return identity(s);
}
function checkFile(fd, file, cap, privateMode = true) {
  const s = fstatSync(fd, { bigint: true }); const entry = lstatSync(file, { bigint: true });
  if (!s.isFile() || !entry.isFile() || entry.isSymbolicLink() || s.nlink !== 1n || s.uid !== 1000n || s.gid !== 1000n
    || s.dev !== entry.dev || s.ino !== entry.ino || (s.mode & 0o7022n) !== 0n
    || privateMode && (s.mode & 0o7777n) !== 0o600n || s.size < 2n || s.size > BigInt(cap)
    || realpathSync(file) !== file || !isDeepStrictEqual(identity(s), identity(entry))) fail("file_invalid");
  return identity(s);
}
function readHeld(fd, file, cap, privateMode = true) {
  const before = checkFile(fd, file, cap, privateMode); const bytes = Buffer.alloc(before.size); let position = 0;
  while (position < bytes.length) {
    const count = readSync(fd, bytes, position, bytes.length - position, position);
    if (count < 1) fail("file_changed"); position += count;
  }
  if (readSync(fd, Buffer.alloc(1), 0, 1, position) !== 0 || !isDeepStrictEqual(before, checkFile(fd, file, cap, privateMode))) fail("file_changed");
  return { bytes, identity: before };
}
function closeAll(handles) {
  let uncertain = false;
  for (const fd of handles.splice(0)) { try { closeSync(fd); } catch { uncertain = true; } }
  if (uncertain) fail("cleanup_uncertain");
}
function guarded(fn) {
  const handles = [];
  try { return fn(handles); } catch (error) {
    let message; try { message = error instanceof Error ? error.message : ""; } catch { message = ""; }
    if (typeof message === "string" && /^postgres_runtime_restore_audit_(?:context_invalid|path_invalid|directory_invalid|file_invalid|file_changed|deadline_exceeded|source_invalid|source_uncommitted|stage_invalid|replay_failed|expired|cleanup_uncertain)$/u.test(message)) fail(message.slice("postgres_runtime_restore_audit_".length));
    fail("failed");
  } finally { closeAll(handles); }
}
function committedReader(workspace, deadline) {
  dir(workspace, false);
  return (relative, cap, context) => guarded((handles) => {
    if (!Object.hasOwn(CAPS, relative) || cap !== CAPS[relative] || context.workspace !== workspace || context.uid !== 1000) fail("source_invalid");
    const file = path.join(workspace, relative); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(fd);
    const before = readHeld(fd, file, cap, false);
    const binaries = ["/usr/bin/git", ...(process.getuid() === 0 ? ["/usr/bin/setpriv"] : [])].map((binary) => {
      const handle = openSync(binary, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(handle);
      const s = fstatSync(handle, { bigint: true }); const entry = lstatSync(binary, { bigint: true });
      if (!s.isFile() || s.uid !== 0n || s.gid !== 0n || s.nlink !== 1n || (s.mode & 0o7022n) !== 0n
        || (s.mode & 0o111n) === 0n || entry.dev !== s.dev || entry.ino !== s.ino || realpathSync(binary) !== binary) fail("source_invalid");
      return { binary, handle, metadata: identity(s) };
    });
    const args = ["show", `HEAD:${relative}`];
    const command = process.getuid() === 0 ? "/usr/bin/setpriv" : "/usr/bin/git";
    const result = spawnSync(command, command === "/usr/bin/setpriv" ? [...SETPRIV, "/usr/bin/git", ...args] : args,
      { cwd: workspace, env: ENV, encoding: null, timeout: remaining(deadline), maxBuffer: cap + 1, windowsHide: true });
    if (result.error || result.status !== 0 || result.signal !== null || !Buffer.isBuffer(result.stdout)
      || !Buffer.isBuffer(result.stderr) || result.stderr.length !== 0 || result.stdout.length > cap
      || !before.bytes.equals(result.stdout) || !isDeepStrictEqual(before, readHeld(fd, file, cap, false))) fail("source_uncommitted");
    if (binaries.some(({ binary, handle, metadata }) => !isDeepStrictEqual(metadata, identity(fstatSync(handle, { bigint: true })))
      || !isDeepStrictEqual(metadata, identity(lstatSync(binary, { bigint: true }))) || realpathSync(binary) !== binary)) fail("source_invalid");
    remaining(deadline); return before.bytes;
  });
}
function sourceClosure(policy, workspace, deadline) {
  const result = authenticatePostgresRemoteRuntimeSource({ workspace, uid: 1000 }, { readCommitted: committedReader(workspace, deadline) });
  const checked = validatePostgresRemoteRuntimePolicy(policy, result.candidatePolicy);
  if (!isDeepStrictEqual(checked, result.runtimePolicy)) fail("source_invalid");
  return result.identities;
}
function validateProof(value, policy) {
  if (!exact(value, PROOF) || value.kind !== "POSTGRES_RUNTIME_RESTORE_AUDIT_STAGE_V1" || value.state !== "STAGED"
    || !exact(value.sourceDirectory, META) || !exact(value.directory, META) || !Array.isArray(value.files)
    || value.files.length !== policy.audit.files.length || !exact(value.sourceIdentities, ["policy", "candidate", "lock", "dockerfile", "publication"])) fail("stage_invalid");
  absolute(value.source); absolute(value.target);
  const metadataValid = (v, fileSize) => exact(v, META)
    && [v.dev, v.ino].every((n) => typeof n === "string" && /^[1-9][0-9]{0,29}$/u.test(n))
    && [v.mtimeNs, v.ctimeNs].every((n) => typeof n === "string" && /^[0-9]{1,30}$/u.test(n))
    && v.uid === 1000 && v.gid === 1000 && v.mode === (fileSize === undefined ? 0o700 : 0o600)
    && v.nlink === (fileSize === undefined ? 2 : 1) && Number.isSafeInteger(v.size)
    && (fileSize === undefined ? v.size > 0 && v.size <= 1048576 : v.size === fileSize);
  if (!metadataValid(value.sourceDirectory) || !metadataValid(value.directory)) fail("stage_invalid");
  for (const [key, cap] of [["policy", CAPS["infra/postgres-image/candidate-runtime.json"]], ["candidate", CAPS["infra/postgres-image/candidate-remote.json"]],
    ["lock", 1048576], ["dockerfile", 1048576], ["publication", 1048576]]) {
    const v = value.sourceIdentities[key];
    if (!exact(v, ["sha256", "size"]) || typeof v.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(v.sha256)
      || !Number.isSafeInteger(v.size) || v.size < 2 || v.size > cap) fail("stage_invalid");
  }
  for (const [index, expected] of policy.audit.files.entries()) {
    const file = value.files[index];
    if (!exact(file, FILE) || !exact(file.source, META) || !exact(file.target, META)
      || file.name !== expected.name || file.sha256 !== expected.sha256 || file.size !== expected.size
      || !metadataValid(file.source, file.size) || !metadataValid(file.target, file.size)) fail("stage_invalid");
  }
}
export function validatePostgresRuntimeAuditStageProof(value, policy) {
  return guarded(() => { validateProof(value, policy); return freeze(globalThis.structuredClone(value)); });
}
function verifyFiles(proof, policy, handles) {
  validateProof(proof, policy);
  if (!isDeepStrictEqual(dir(proof.source), proof.sourceDirectory) || !isDeepStrictEqual(dir(proof.target), proof.directory)) fail("stage_invalid");
  const names = policy.audit.files.map((v) => v.name).sort();
  if (!isDeepStrictEqual(readdirSync(proof.source).sort(), names) || !isDeepStrictEqual(readdirSync(proof.target).sort(), names)) fail("stage_invalid");
  const bytes = {};
  for (const file of proof.files) {
    for (const [root, field] of [[proof.source, "source"], [proof.target, "target"]]) {
      const name = path.join(root, file.name); const fd = openSync(name, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(fd);
      const observed = readHeld(fd, name, file.size);
      if (!isDeepStrictEqual(observed.identity, file[field]) || sha(observed.bytes) !== file.sha256 || observed.bytes.length !== file.size) fail("stage_invalid");
      if (field === "target") bytes[file.name] = observed.bytes;
    }
  }
  return bytes;
}
export function stagePostgresRuntimeAudit({ source, target, policy, workspace, deadline }) {
  return guarded((handles) => {
    actor(deadline); absolute(target); const sourceIdentities = sourceClosure(policy, workspace, deadline);
    const sourceDirectory = dir(source); const parent = dir(path.dirname(target));
    if (target === source || target.startsWith(`${source}/`) || source.startsWith(`${target}/`)
      || !isDeepStrictEqual(readdirSync(source).sort(), policy.audit.files.map((v) => v.name).sort())) fail("source_invalid");
    mkdirSync(target, { mode: 0o700 });
    const directoryFd = openSync(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(directoryFd);
    const created = fstatSync(directoryFd, { bigint: true }); const createdPath = lstatSync(target, { bigint: true });
    if (!created.isDirectory() || created.uid !== BigInt(process.getuid()) || created.gid !== BigInt(process.getgid())
      || created.dev !== createdPath.dev || created.ino !== createdPath.ino || realpathSync(target) !== target) fail("directory_invalid");
    if (process.getuid() === 0) fchownSync(directoryFd, 1000, 1000);
    fchmodSync(directoryFd, 0o700);
    const files = [];
    for (const expected of policy.audit.files) {
      remaining(deadline); const original = path.join(source, expected.name);
      const sourceFd = openSync(original, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(sourceFd);
      const read = readHeld(sourceFd, original, expected.size);
      if (read.bytes.length !== expected.size || sha(read.bytes) !== expected.sha256) fail("source_invalid");
      const destination = path.join(target, expected.name);
      const targetFd = openSync(destination, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); handles.push(targetFd);
      const empty = fstatSync(targetFd, { bigint: true }); const emptyPath = lstatSync(destination, { bigint: true });
      if (!empty.isFile() || empty.uid !== BigInt(process.getuid()) || empty.gid !== BigInt(process.getgid()) || empty.nlink !== 1n
        || empty.size !== 0n || empty.dev !== emptyPath.dev || empty.ino !== emptyPath.ino || realpathSync(destination) !== destination) fail("file_invalid");
      if (process.getuid() === 0) fchownSync(targetFd, 1000, 1000);
      fchmodSync(targetFd, 0o600); let position = 0;
      while (position < read.bytes.length) { const count = writeSync(targetFd, read.bytes, position, read.bytes.length - position, position); if (count < 1) fail("file_invalid"); position += count; }
      fsyncSync(targetFd); const copied = readHeld(targetFd, destination, expected.size);
      if (!copied.bytes.equals(read.bytes) || !isDeepStrictEqual(read, readHeld(sourceFd, original, expected.size))) fail("file_changed");
      files.push({ ...expected, source: read.identity, target: copied.identity });
    }
    fsyncSync(directoryFd);
    const afterParent = dir(path.dirname(target));
    if (!["dev", "ino", "uid", "gid", "mode"].every((key) => parent[key] === afterParent[key])) fail("directory_invalid");
    const proof = freeze({ kind: "POSTGRES_RUNTIME_RESTORE_AUDIT_STAGE_V1", state: "STAGED", source, target,
      sourceDirectory, directory: dir(target), files, sourceIdentities });
    verifyFiles(proof, policy, handles);
    if (!isDeepStrictEqual(sourceIdentities, sourceClosure(policy, workspace, deadline))) fail("source_invalid");
    verifyFiles(proof, policy, handles);
    remaining(deadline); return proof;
  });
}
export function postgresRuntimeAuditValidUntil(evidence, report, now = new Date()) {
  try {
    const db = evidence.observed;
    for (const name of ["vulnerability", "java"]) validateDatabaseMetadata(db[name].value, { now, database: name });
    const text = report.CreatedAt;
    // Reuse the calendar/timestamp parser, without giving a report Java's age waiver.
    validateDatabaseMetadata({ Version: 2, UpdatedAt: text, DownloadedAt: text }, { now, database: "vulnerability" });
    const at = Date.parse(text); const deadline = Math.min(Date.parse(db.vulnerability.value.UpdatedAt), at) + MAX_DATABASE_AGE_MS;
    if (!Number.isFinite(at) || !(now instanceof Date) || !Number.isFinite(now.getTime()) || at > now.getTime()
      || at < Math.max(...["vulnerability", "java"].map((key) => Date.parse(db[key].value.DownloadedAt))) || now.getTime() >= deadline) fail("expired");
    return new Date(deadline).toISOString();
  } catch { fail("expired"); }
}
function replayAudit(proof, { policy, workspace, deadline }, preflight = false) {
  return guarded((handles) => {
    actor(deadline); const identities = sourceClosure(policy, workspace, deadline);
    if (!proof || !preflight && proof.source === proof.target || preflight && proof.source !== proof.target) fail("stage_invalid");
    if (!isDeepStrictEqual(identities, proof.sourceIdentities)) fail("source_invalid");
    const bytes = verifyFiles(proof, policy, handles);
    const nativeRead = committedReader(workspace, deadline); let cleanupUncertain = false;
    const readCommitted = (...args) => {
      try { return nativeRead(...args); } catch (error) {
        if (error.message === "postgres_runtime_restore_audit_cleanup_uncertain") cleanupUncertain = true;
        throw error;
      }
    };
    try { replayPostgresRuntimeAudit(proof.target, policy, { uid: 1000, workspace }, { readCommitted }); }
    catch { fail(cleanupUncertain ? "cleanup_uncertain" : "replay_failed"); }
    verifyFiles(proof, policy, handles);
    if (!isDeepStrictEqual(identities, sourceClosure(policy, workspace, deadline))) fail("source_invalid");
    verifyFiles(proof, policy, handles);
    const parse = (value) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
    const now = new Date(); const validUntil = postgresRuntimeAuditValidUntil(parse(bytes["database-evidence.json"]), parse(bytes["candidate-vulnerabilities.json"]), now);
    remaining(deadline);
    return freeze({ auditReceiptSha256: policy.audit.receipt.sha256, checkedAt: now.toISOString(), validUntil });
  });
}
export function replayLocalPostgresRuntimeAudit(proof, input) {
  return replayAudit(proof, input);
}
export function sealPostgresRuntimeAuditStage({ directory, policy, workspace, deadline }, expectedStageProof) {
  return guarded((handles) => {
    actor(deadline); const sourceIdentities = sourceClosure(policy, workspace, deadline);
    let proof = expectedStageProof;
    if (proof === undefined) {
      const directoryIdentity = dir(directory);
      if (!isDeepStrictEqual(readdirSync(directory).sort(), policy.audit.files.map((v) => v.name).sort())) fail("stage_invalid");
      const files = policy.audit.files.map((expected) => {
        const file = path.join(directory, expected.name); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(fd);
        const read = readHeld(fd, file, expected.size);
        if (read.bytes.length !== expected.size || sha(read.bytes) !== expected.sha256) fail("stage_invalid");
        return { ...expected, source: read.identity, target: read.identity };
      });
      // A standalone seal attests this directory only, never a different original directory.
      proof = freeze({ kind: "POSTGRES_RUNTIME_RESTORE_AUDIT_STAGE_V1", state: "STAGED", source: directory,
        target: directory, sourceDirectory: directoryIdentity, directory: directoryIdentity, files, sourceIdentities });
    }
    if (proof.target !== directory || !isDeepStrictEqual(sourceIdentities, proof.sourceIdentities)) fail("stage_invalid");
    verifyFiles(proof, policy, handles);
    if (!isDeepStrictEqual(sourceIdentities, sourceClosure(policy, workspace, deadline))) fail("source_invalid");
    verifyFiles(proof, policy, handles); remaining(deadline); return freeze(globalThis.structuredClone(proof));
  });
}
export function preflightLocalPostgresRuntimeAudit({ source, policy, workspace, deadline }) {
  const proof = sealPostgresRuntimeAuditStage({ directory: source, policy, workspace, deadline });
  // A read-only preflight authenticates originals; it establishes no separate retained copy.
  return replayAudit(proof, { policy, workspace, deadline }, true);
}
