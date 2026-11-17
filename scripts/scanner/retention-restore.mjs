import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statfsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PassThrough, Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { scanRawUstar } from "../seaweed-image/archive.mjs";
import {
  SCANNER_RETENTION as P, canonicalJsonBytes, createScannerRetentionPublicationBinding,
  sha256, validateScannerRetentionRestoreManifestBytes, validateScannerRetentionSidecarBytes,
} from "./retention-policy.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SID = "S-1-5-21-3270712108-3124063012-814912821-500";
const MANIFEST = "scanner-closure/restore-manifest.json";
const HEX = /^[a-f0-9]{64}$/u;
const ID = /^[a-f0-9]{16}$/u;
const VOLUME = /^[a-f0-9]{8}$/u;
const fail = (code = "incomplete") => { throw new Error(`scanner_retention_local_${code}`); };
const failure = (code) => new Error(`scanner_retention_local_${code}`);

// Only this environment reaches offline tools. No inherited credentials, proxy or tool lookup.
export function scannerRetentionLocalEnvironment() {
  return Object.freeze({ SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows",
    TEMP: "C:\\Users\\Administrator\\AppData\\Local\\Temp", TMP: "C:\\Users\\Administrator\\AppData\\Local\\Temp",
    PATH: "C:\\Windows\\System32;C:\\Windows", LANG: "C", LC_ALL: "C", TZ: "UTC" });
}

export function scannerRetentionByteGuard(expected, cap) {
  if (!Number.isSafeInteger(cap) || cap < 0 || cap > P.closure.tarCapBytes
    || (expected !== null && (!Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || expected.bytes > cap
      || typeof expected.sha256 !== "string" || !HEX.test(expected.sha256)))) fail("byte_guard_invalid");
  let count = 0; const hash = createHash("sha256");
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (!Buffer.isBuffer(chunk) || count + chunk.length > cap
        || (expected !== null && count + chunk.length > expected.bytes)) return callback(failure("output_limit"));
      count += chunk.length; hash.update(chunk); callback(null, chunk);
    },
    flush(callback) {
      const digest = hash.digest("hex");
      callback(expected !== null && (count !== expected.bytes || digest !== expected.sha256)
        ? failure("bytes_mismatch") : null);
    },
  });
}

async function collect(stream, cap) {
  const chunks = []; let count = 0;
  for await (const chunk of stream) {
    if (!Buffer.isBuffer(chunk) || (count += chunk.length) > cap) fail("output_limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, count);
}

// All operations own exact ChildProcess references. A timeout never becomes successful cleanup.
async function processGroup(work, { spawnImpl = spawn, timeoutMs = P.local.operationTimeoutMs,
  cleanupMs = P.local.cleanupTimeoutMs } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > P.local.operationTimeoutMs
    || !Number.isSafeInteger(cleanupMs) || cleanupMs < 1 || cleanupMs > P.local.cleanupTimeoutMs) fail("deadline_invalid");
  const children = []; const streams = []; const tasks = [];
  let timer; let cleanupTimer;
  const track = (promise) => { promise.catch(() => {}); tasks.push(promise); return promise; };
  const context = {
    stream(stream) { streams.push(stream); return stream; }, track,
    start(spec) {
      const child = spawnImpl(spec.command, spec.args, { cwd: ROOT, env: scannerRetentionLocalEnvironment(),
        windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      const record = { child, closed: false, close: null, done: null };
      record.close = new Promise((resolve) => child.once("close", (code, signal) => {
        record.closed = true; resolve({ code, signal });
      }));
      record.done = track(new Promise((resolve, reject) => {
        child.once("error", () => reject(failure("child_failed")));
        record.close.then(({ code, signal }) => code === 0 && signal === null ? resolve() : reject(failure("child_failed")));
      }));
      children.push(record);
      streams.push(child.stdin, child.stdout, child.stderr);
      return record;
    },
  };
  try {
    return await Promise.race([track(Promise.resolve().then(() => work(context))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(failure("deadline")), timeoutMs); })]);
  } catch (cause) {
    for (const stream of streams) { try { stream.destroy(); } catch { /* Closure checked below. */ } }
    for (const { child, closed } of children) {
      if (!closed) { try { child.kill("SIGKILL"); } catch { /* Unknown close remains a refusal. */ } }
    }
    const closed = await Promise.race([
      Promise.all(children.map((record) => record.close)).then(() => true),
      new Promise((resolve) => { cleanupTimer = setTimeout(() => resolve(false), cleanupMs); }),
    ]);
    // Observed task failures stay observed; do not await a suspended consumer without a deadline.
    Promise.allSettled(tasks).catch(() => {});
    throw Object.assign(failure(closed ? "operation_failed" : "cleanup_uncertain"),
      { cause, cleanup: closed ? "CHILDREN_CLOSED" : "UNKNOWN" });
  } finally { globalThis.clearTimeout(timer); globalThis.clearTimeout(cleanupTimer); }
}

export async function runScannerRetentionLocalCommand(spec, { input = Buffer.alloc(0),
  expected = null, stdoutCap = P.local.proofCapBytes, consume, ...runtime } = {}) {
  return processGroup(async (context) => {
    const { child, done } = context.start(spec);
    const source = context.stream(Buffer.isBuffer(input) ? Readable.from([input]) : input);
    const output = context.stream(new PassThrough());
    const guard = context.stream(scannerRetentionByteGuard(expected, stdoutCap));
    const writing = context.track(pipeline(source, child.stdin));
    const reading = context.track(pipeline(child.stdout, guard, output));
    const consuming = context.track((async () => {
      const result = consume ? await consume(output) : await collect(output, stdoutCap);
      if (!output.readableEnded) fail("consumer_closed_early");
      return result;
    })());
    const errors = context.track(collect(child.stderr, P.local.stderrCapBytes));
    const result = await Promise.all([done, writing, reading, consuming, errors]);
    if (result[4].length !== 0) fail("child_stderr");
    return result[3];
  }, runtime);
}

export async function pipeScannerRetentionLocalCommands(sourceSpec, destinationSpec, expected,
  { sourceInput = Buffer.alloc(0), ...runtime } = {}) {
  return processGroup(async (context) => {
    const source = context.start(sourceSpec); const destination = context.start(destinationSpec);
    const input = context.stream(Readable.from([sourceInput]));
    const guard = context.stream(scannerRetentionByteGuard(expected, P.closure.tarCapBytes));
    const result = await Promise.all([source.done, destination.done,
      context.track(pipeline(input, source.child.stdin)),
      context.track(pipeline(source.child.stdout, guard, destination.child.stdin)),
      context.track(collect(source.child.stderr, P.local.stderrCapBytes)),
      context.track(collect(destination.child.stdout, P.local.proofCapBytes)),
      context.track(collect(destination.child.stderr, P.local.stderrCapBytes))]);
    if (result[4].length !== 0 || result[6].length !== 0) fail("child_stderr");
    return result[5];
  }, runtime);
}

function exact(value, keys) {
  // canonicalJsonBytes rejects proxies, accessors, duplicate/non-data properties and coercions.
  canonicalJsonBytes(value, P.local.proofCapBytes);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).join("\0") === keys.join("\0");
}

function parseProof(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > P.local.proofCapBytes) fail("proof_invalid");
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("proof_invalid"); }
  if (!canonicalJsonBytes(value, P.local.proofCapBytes).equals(bytes)) fail("proof_invalid");
  return value;
}

function directoryProof(value, previous) {
  if (!exact(value, ["volumeSerial", "fileId", "ownerSid", "protectedAcl", "ntfs", "reparse", "flush"])
    || !VOLUME.test(value.volumeSerial) || !ID.test(value.fileId) || value.ownerSid !== SID
    || value.protectedAcl !== true || value.ntfs !== true || value.reparse !== false
    || !["NOT_ATTEMPTED", "SUPPORTED_SUCCEEDED", "UNSUPPORTED"].includes(value.flush)
    || previous && (value.volumeSerial !== previous.volumeSerial || value.fileId !== previous.fileId)) fail("directory_proof_invalid");
}

function fileProof(value, name, identity, directory, previous) {
  if (!exact(value, ["name", "bytes", "sha256", "fileId", "ownerSid", "protectedAcl", "nlink"])
    || value.name !== name || value.bytes !== identity.bytes || value.sha256 !== identity.sha256
    || !ID.test(value.fileId) || value.ownerSid !== SID || value.protectedAcl !== true || value.nlink !== 1
    || value.fileId === directory.fileId || previous && value.fileId !== previous.fileId) fail("file_proof_invalid");
}

export function validateScannerRetentionPairProof(bytes, state, sidecar, sidecarBytes, previous) {
  const value = parseProof(bytes); const staged = state === "STAGED";
  if (!["STAGED", "COMMITTED", "INSPECTED"].includes(state)
    || !exact(value, staged ? ["kind", "state", "directory", "tar"] : ["kind", "state", "directory", "tar", "sidecar"])
    || value.kind !== "SCANNER_RETENTION_PRIVATE_COPY_V1" || value.state !== state) fail("pair_proof_invalid");
  directoryProof(value.directory, previous?.directory);
  fileProof(value.tar, `${sidecar.copy.relativePath}${staged ? ".part" : ""}`, sidecar.innerTar, value.directory, previous?.tar);
  if (!staged) {
    fileProof(value.sidecar, sidecar.copy.relativePath.replace(/\.tar$/u, ".sidecar.json"),
      { bytes: sidecarBytes.length, sha256: sha256(sidecarBytes) }, value.directory, previous?.sidecar);
    if (value.sidecar.fileId === value.tar.fileId) fail("pair_proof_invalid");
  }
  if (state === "COMMITTED" && value.directory.flush === "NOT_ATTEMPTED") fail("pair_proof_invalid");
  return value;
}

function canonicalToolStat(file) {
  if (realpathSync(file).toLowerCase() !== path.resolve(file).toLowerCase()) fail("tool_identity");
  const value = lstatSync(file);
  if (!value.isFile() || value.isSymbolicLink()) fail("tool_identity");
  return value;
}

function sameToolStat(before, after, links) {
  if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
    || before.nlink !== links || after.nlink !== links) fail("tool_identity");
}

// Production supplies the second name only for the policy-bound Windows tar role.
// These checks retain the trusted-host assumption; the handles close before later execution.
export function assertScannerRetentionToolFile(file, expected, hardlinkPath) {
  if (!Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || !HEX.test(expected.sha256)) fail("tool_unbound");
  if (hardlinkPath !== undefined && (typeof hardlinkPath !== "string" || !path.isAbsolute(hardlinkPath)
    || path.resolve(file).toLowerCase() === path.resolve(hardlinkPath).toLowerCase())) fail("tool_unbound");
  const links = hardlinkPath === undefined ? 1 : 2;
  let fd; let alias;
  try {
    const initial = canonicalToolStat(file);
    fd = openSync(file, "r");
    const before = fstatSync(fd);
    sameToolStat(initial, before, links);
    if (before.size !== expected.bytes || sha256(readFileSync(fd)) !== expected.sha256) fail("tool_identity");
    sameToolStat(before, fstatSync(fd), links);
    if (hardlinkPath !== undefined) {
      sameToolStat(before, canonicalToolStat(hardlinkPath), links);
      alias = openSync(hardlinkPath, "r");
      sameToolStat(before, fstatSync(alias), links);
      sameToolStat(before, canonicalToolStat(hardlinkPath), links);
    }
    sameToolStat(before, canonicalToolStat(file), links);
    sameToolStat(before, fstatSync(fd), links);
    if (alias !== undefined) sameToolStat(before, fstatSync(alias), links);
  } catch { fail("tool_identity"); }
  finally {
    try { if (alias !== undefined) closeSync(alias); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
}

export function assertScannerRetentionLocalTools() {
  if (process.platform !== "win32" || process.version !== P.local.node.version
    || path.resolve(process.execPath).toLowerCase() !== path.resolve(P.local.node.path).toLowerCase()) fail("host_invalid");
  for (const tool of [P.local.node, P.local.powershell]) assertScannerRetentionToolFile(tool.path, tool);
  assertScannerRetentionToolFile(P.local.tar.path, P.local.tar, P.local.tar.hardlinkPath);
  for (const tool of [P.local.wrapper, P.local.helper]) assertScannerRetentionToolFile(path.join(ROOT, tool.file), tool);
}

export function assertScannerRetentionLocalCapacity() {
  const capacity = statfsSync("C:/", { bigint: true });
  if (capacity.bavail * capacity.bsize < BigInt(P.closure.localRequiredFreeBytes)) fail("capacity");
}

export function scannerRetentionHelperCommand(operation, sidecar, proof, sidecarBytes) {
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(ROOT, P.local.wrapper.file),
    "-Operation", operation, "-InnerTarSha256", sidecar.innerTar.sha256, "-InnerTarBytes", String(sidecar.innerTar.bytes)];
  if (!["StageTar", "CommitPair", "InspectPair", "ExportTar"].includes(operation)) fail("operation_invalid");
  if (operation !== "StageTar") {
    args.push("-VolumeSerial", proof.directory.volumeSerial, "-DirectoryFileId", proof.directory.fileId,
      "-TarFileId", proof.tar.fileId, "-SidecarSha256", sha256(sidecarBytes), "-SidecarBytes", String(sidecarBytes.length));
    if (operation !== "CommitPair") args.push("-SidecarFileId", proof.sidecar.fileId);
  }
  return { command: P.local.powershell.path, args };
}

function restoreHelper(operation, phase, sidecar, nonce, proof) {
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", path.join(ROOT, P.local.wrapper.file),
    "-Operation", operation, ...(operation === "InspectRestore" ? ["-Phase", phase] : []),
    "-InnerTarSha256", sidecar.innerTar.sha256, "-RestoreNonce", nonce,
    "-RestoreManifestSha256", sidecar.restoreManifest.sha256, "-RestoreManifestBytes", String(sidecar.restoreManifest.bytes)];
  if (proof) args.push("-VolumeSerial", proof.directory.volumeSerial, "-DirectoryFileId", proof.directory.fileId);
  return { command: P.local.powershell.path, args };
}

export function validateScannerRetentionRawArchive(result, sidecar, manifest) {
  if (result.rawSize !== sidecar.innerTar.bytes || result.diffId !== `sha256:${sidecar.innerTar.sha256}`
    || !Array.isArray(result.members) || result.members.length !== 50) fail("archive_profile");
  let expanded = 0; let offset = 0;
  for (const [index, member] of result.members.entries()) {
    const expected = P.closure.members[index]; const entry = member.entry;
    const bound = expected.path === MANIFEST ? sidecar.restoreManifest
      : manifest?.files.find((file) => file.path === expected.path) ?? expected;
    if (member.memberOrdinal !== index || member.uncompressedHeaderOffset !== offset
      || member.uncompressedDataOffset !== offset + 512 || entry.path !== expected.path || entry.type !== "file"
      || entry.mode !== expected.headerMode || entry.uid !== 0 || entry.gid !== 0 || entry.mtime !== 0
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > expected.capBytes
      || bound.bytes !== null && entry.size !== bound.bytes || bound.sha256 !== null && entry.sha256 !== bound.sha256) fail("archive_profile");
    offset += 512 + Math.ceil(entry.size / 512) * 512; expanded += entry.size;
  }
  if (expanded > P.closure.expandedCapBytes || result.rawSize !== offset + 1024) fail("archive_profile");
  return expanded;
}

function restoreProof(bytes, phase, previous, sidecar, total) {
  const value = parseProof(bytes);
  if (!exact(value, phase === "EMPTY" ? ["kind", "phase", "directory", "files", "bytes"]
    : ["kind", "phase", "directory", "manifest", "files", "bytes"])
    || value.kind !== "SCANNER_RETENTION_RESTORE_INSPECTION_V1" || value.phase !== phase
    || value.files !== (phase === "EMPTY" ? 0 : 50) || value.bytes !== total) fail("restore_proof_invalid");
  directoryProof(value.directory, previous?.directory);
  if (phase !== "EMPTY" && (!exact(value.manifest, ["path", "bytes", "sha256"])
    || value.manifest.path !== MANIFEST || value.manifest.bytes !== sidecar.restoreManifest.bytes
    || value.manifest.sha256 !== sidecar.restoreManifest.sha256)) fail("restore_proof_invalid");
  return value;
}

function readBoundManifest(file, expected) {
  if (realpathSync(file).toLowerCase() !== path.resolve(file).toLowerCase() || lstatSync(file).isSymbolicLink()) fail("manifest_identity");
  const fd = openSync(file, "r");
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size !== expected.bytes) fail("manifest_identity");
    const bytes = Buffer.alloc(expected.bytes); let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (count < 1) fail("manifest_identity");
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0 || sha256(bytes) !== expected.sha256) fail("manifest_identity");
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail("manifest_identity");
    return bytes;
  } finally { closeSync(fd); }
}

// Called only from authenticated intake in the same process. No CLI and no online dependency.
// A later fresh process requires reviewed protected-main expectations, not the on-disk sidecar.
export async function restoreScannerRetentionCopy({ sidecarBytes, receiptBytes, authenticatedOptions, pairProof }, dependencies = {}) {
  const sidecar = validateScannerRetentionSidecarBytes(sidecarBytes, receiptBytes, authenticatedOptions);
  const run = dependencies.run ?? runScannerRetentionLocalCommand;
  const pipe = dependencies.pipe ?? pipeScannerRetentionLocalCommands;
  (dependencies.tools ?? assertScannerRetentionLocalTools)();
  (dependencies.capacity ?? assertScannerRetentionLocalCapacity)();
  const phases = [];
  const phase = async (name, action) => {
    const start = performance.now(); const result = await action();
    phases.push({ name, result: "PASSED", durationMs: Math.ceil(performance.now() - start) }); return result;
  };
  const inspected = await phase("inspect_committed_pair", async () => validateScannerRetentionPairProof(
    await run(scannerRetentionHelperCommand("InspectPair", sidecar, pairProof, sidecarBytes), { input: sidecarBytes }),
    "INSPECTED", sidecar, sidecarBytes, pairProof));
  const exportSpec = () => scannerRetentionHelperCommand("ExportTar", sidecar, inspected, sidecarBytes);
  const raw = await phase("raw_ustar_profile", () => run(exportSpec(), {
    expected: sidecar.innerTar, stdoutCap: sidecar.innerTar.bytes,
    consume: (input) => scanRawUstar({ input, diffId: `sha256:${sidecar.innerTar.sha256}`,
      maxRawBytes: P.closure.tarCapBytes, maxMembers: 50, allowHardlinks: false, requireEmptyOwnerNames: true }),
  }));
  validateScannerRetentionRawArchive(raw, sidecar);
  await phase("bsdtar_exact_list", async () => {
    const list = await pipe(exportSpec(), { command: P.local.tar.path, args: ["-t", "-f", "-"] }, sidecar.innerTar);
    const expected = P.closure.members.map((member) => member.path).join("\n") + "\n";
    if (list.toString("utf8").replace(/\r\n/gu, "\n") !== expected) fail("bsdtar_list");
  });
  const nonce = randomBytes(16).toString("hex");
  const target = path.join(P.local.directory, `restore-${sidecar.innerTar.sha256}-${nonce}`);
  const empty = await phase("prepare_empty_restore", async () => restoreProof(
    await run(restoreHelper("InspectRestore", "EMPTY", sidecar, nonce)), "EMPTY", null, sidecar, 0));
  await phase("extract_manifest_first", async () => {
    const output = await pipe(exportSpec(), { command: P.local.tar.path,
      args: ["-x", "-f", "-", "-C", target, "--no-same-owner", "--no-same-permissions", "--", MANIFEST] }, sidecar.innerTar);
    if (output.length !== 0) fail("bsdtar_output");
  });
  const manifestBytes = (dependencies.readManifest ?? readBoundManifest)(path.join(target, MANIFEST), sidecar.restoreManifest);
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length !== sidecar.restoreManifest.bytes
    || sha256(manifestBytes) !== sidecar.restoreManifest.sha256) fail("manifest_identity");
  const manifest = validateScannerRetentionRestoreManifestBytes(manifestBytes,
    createScannerRetentionPublicationBinding(authenticatedOptions.identity));
  const total = validateScannerRetentionRawArchive(raw, sidecar, manifest);
  await phase("extract_49_bound_members", async () => {
    const output = await pipe(exportSpec(), { command: P.local.tar.path,
      args: ["-x", "-f", "-", "-C", target, "--no-same-owner", "--no-same-permissions", "--",
        ...manifest.files.map((file) => file.path)] }, sidecar.innerTar);
    if (output.length !== 0) fail("bsdtar_output");
  });
  const sealed = await phase("seal_native_files", async () => restoreProof(
    await run(restoreHelper("InspectRestore", "SEALED", sidecar, nonce, empty), { input: manifestBytes }),
    "SEALED", empty, sidecar, total));
  // Removal is implemented by the native owner after full identity/ACL/hash revalidation.
  await phase("cleanup_owned_extraction", async () => {
    const removed = parseProof(await run(restoreHelper("CleanupRestore", "SEALED", sidecar, nonce, sealed), { input: manifestBytes }));
    if (!exact(removed, ["kind", "phase", "directory", "files", "state"])
      || removed.kind !== "SCANNER_RETENTION_RESTORE_INSPECTION_V1" || removed.phase !== "CLEANED"
      || removed.state !== "REMOVED" || removed.files !== 50 || !exact(removed.directory, ["volumeSerial", "fileId"])
      || removed.directory.fileId !== sealed.directory.fileId || removed.directory.volumeSerial !== sealed.directory.volumeSerial) fail("cleanup_uncertain");
  });
  return canonicalJsonBytes({ schemaVersion: 1, state: "LOCAL_BYTES_RESTORED_NOT_ADMITTED", result: "PASSED",
    sidecar: { bytes: sidecarBytes.length, sha256: sha256(sidecarBytes) }, innerTar: sidecar.innerTar,
    restoreManifest: sidecar.restoreManifest, members: 50,
    claims: { byteOnly: true, networkIo: false, scannerExecuted: false, admitted: false, supportStart: null, supportEnd: null },
    phases, cleanup: { processes: "CLOSED", extraction: "REMOVED" } }, P.local.receiptCapBytes);
}
