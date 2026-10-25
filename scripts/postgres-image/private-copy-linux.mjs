import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdtempSync, openSync,
  readFileSync, readSync, realpathSync, readdirSync, statfsSync, writeSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { validateLocalPostgresRetentionReceipt } from "./candidate-local-retention.mjs";
import { postgresCandidateProofLimits, validatePostgresCandidateArchive } from "./candidate-proof.mjs";
import { validatePostgresRemotePolicy } from "./candidate-remote.mjs";
import { validateLocalPostgresRetentionPolicyBytes } from "./local-retention-diagnostic.mjs";
import { PRIVATE_COPY_PIN } from "./private-copy-policy.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CAP = 64 * 1024;
const HEX = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const PREFIX = "postgres_private_copy_linux_";
const REASONS = new Set(["arguments_invalid", "requires_linux_nonroot", "storage_invalid", "source_changed",
  "identity_invalid", "policy_invalid", "receipt_invalid", "archive_invalid", "input_invalid", "input_truncated",
  "input_trailing", "copy_changed", "stream_failed", "capacity_insufficient", "aborted", "result_invalid",
  "source_invalid", "source_revision_invalid", "operation_failed", "descriptor_cleanup_failed"]);
const PHASES = new Set(["CONTEXT", "SOURCE", "EXPORT", "IMPORT", "VALIDATION", "SEAL", "CLEANUP"]);
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, expected) => plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const freeze = (value) => Array.isArray(value) ? Object.freeze(value.map(freeze)) : plain(value)
  ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)]))) : value;
function fail(reason) { throw new Error(`${PREFIX}${reason}`); }
function closedError(reason, phase, directory) {
  const error = new Error(`${PREFIX}${reason}`); error.phase = phase;
  if (directory) error.directory = directory; return error;
}
function nativeContext() {
  if (process.platform !== "linux" || !(process.getuid?.() > 0) || !(process.getgid?.() > 0)) fail("requires_linux_nonroot");
}
function safeReason(error) {
  try { const message = error instanceof Error ? error.message : "";
    const reason = typeof message === "string" && message.startsWith(PREFIX) ? message.slice(PREFIX.length) : "";
    return REASONS.has(reason) ? reason : "operation_failed";
  } catch { return "operation_failed"; }
}
function check(signal) { if (signal.aborted) fail("aborted"); }
function validatePin(pin) {
  if (!plain(pin) || typeof pin.sourceDirectory !== "string" || !path.posix.isAbsolute(pin.sourceDirectory)
    || path.posix.normalize(pin.sourceDirectory) !== pin.sourceDirectory || !REVISION.test(pin.originalRecipeRevision)
    || !/^local-[1-9][0-9]{0,19}$/u.test(pin.originalExecutionId) || !Number.isSafeInteger(pin.sourceGid) || pin.sourceGid < 1
    || !Number.isSafeInteger(pin.ownerUid ?? 1000) || (pin.ownerUid ?? 1000) < 1
    || !Number.isSafeInteger(pin.importGid ?? 1000) || (pin.importGid ?? 1000) < 1
    || !HEX.test(pin.policySha256) || !Array.isArray(pin.files) || pin.files.length !== 2
    || pin.files.some((item, index) => !keys(item, ["name", "size", "sha256"])
      || item.name !== ["candidate.tar", "retention-receipt.json"][index] || !HEX.test(item.sha256)
      || !Number.isSafeInteger(item.size) || item.size < 1
      || item.size > (index === 0 ? postgresCandidateProofLimits.archiveBytes : CAP))
    || pin.totalBytes !== pin.files.reduce((total, item) => total + item.size, 0)) fail("arguments_invalid");
  return freeze(pin);
}
function statIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode, nlink: stat.nlink,
    size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
}
function directoryIdentity(file, gid, privateMode = false) {
  const stat = lstatSync(file, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(file) !== file
    || stat.uid !== BigInt(process.getuid()) || gid !== undefined && stat.gid !== BigInt(gid)
    || privateMode && (stat.mode & 0o7777n) !== 0o700n) fail("storage_invalid");
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode };
}
function ancestors(file) {
  const result = new Map(); let current = file;
  for (;;) {
    const stat = lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(current) !== current) fail("storage_invalid");
    result.set(current, { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode });
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return () => { for (const [name, expected] of result) {
    const stat = lstatSync(name, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(name) !== name
      || !isDeepStrictEqual(expected, { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode })) fail("storage_invalid");
  } };
}
function ext4(file, requiredBytes = 0) {
  const stat = statfsSync(file, { bigint: true });
  if (stat.type !== 0xef53n) fail("storage_invalid");
  const mount = spawnSync("/usr/bin/findmnt", ["--noheadings", "--output", "FSTYPE", "--target", file],
    { encoding: null, timeout: 10_000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
  if (mount.error || mount.signal || mount.status !== 0 || mount.stderr.length !== 0
    || !mount.stdout.equals(Buffer.from("ext4\n"))) fail("storage_invalid");
  if (stat.bavail * stat.bsize < BigInt(requiredBytes)) fail("capacity_insufficient");
}
function fileIdentity(fd, file, gid, expected, size) {
  const stat = fstatSync(fd, { bigint: true }); const entry = lstatSync(file, { bigint: true });
  const identity = statIdentity(stat);
  if (!stat.isFile() || entry.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== BigInt(process.getuid())
    || stat.gid !== BigInt(gid) || (stat.mode & 0o7777n) !== 0o600n || realpathSync(file) !== file
    || !isDeepStrictEqual(identity, statIdentity(entry)) || size !== undefined && stat.size !== BigInt(size)
    || expected !== undefined && !isDeepStrictEqual(identity, expected)) fail("identity_invalid");
  return identity;
}
function seal(opened, guard, signal) {
  guard(); check(signal); fileIdentity(opened.fd, opened.file, opened.gid, opened.identity, opened.expected.size);
  const digest = createHash("sha256"); const buffer = Buffer.allocUnsafe(1024 ** 2); let offset = 0;
  while (offset < opened.expected.size) {
    check(signal); const count = readSync(opened.fd, buffer, 0, Math.min(buffer.length, opened.expected.size - offset), offset);
    if (count < 1) fail("source_changed"); digest.update(buffer.subarray(0, count)); offset += count;
  }
  if (readSync(opened.fd, buffer, 0, 1, offset) !== 0 || digest.digest("hex") !== opened.expected.sha256) fail("source_changed");
  guard(); fileIdentity(opened.fd, opened.file, opened.gid, opened.identity, opened.expected.size);
}
function readFixed(opened, guard, signal) {
  const bytes = Buffer.allocUnsafe(opened.expected.size); let offset = 0;
  while (offset < bytes.length) {
    check(signal); const count = readSync(opened.fd, bytes, offset, Math.min(1024 ** 2, bytes.length - offset), offset);
    if (count < 1) fail("source_changed"); offset += count;
  }
  const extra = Buffer.alloc(1);
  if (readSync(opened.fd, extra, 0, 1, offset) !== 0 || hash(bytes) !== opened.expected.sha256) fail("source_changed");
  guard(); fileIdentity(opened.fd, opened.file, opened.gid, opened.identity, opened.expected.size); return bytes;
}
function openFiles(directory, gid, pin, opened) {
  for (const expected of pin.files) {
    const file = path.join(directory, expected.name); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const item = { fd, file, gid, expected }; opened.push(item);
    item.identity = fileIdentity(fd, file, gid, undefined, expected.size);
  }
}
function validateMaterial(opened, pin, policy, guard, signal) {
  for (const item of opened) seal(item, guard, signal);
  const bytes = readFixed(opened[1], guard, signal); let receipt;
  try { receipt = validateLocalPostgresRetentionReceipt(JSON.parse(bytes.toString("utf8")), policy); }
  catch { fail("receipt_invalid"); }
  if (receipt.recipeRevision !== pin.originalRecipeRevision || receipt.executionId !== pin.originalExecutionId
    || receipt.archiveProof.archiveSha256 !== pin.files[0].sha256 || receipt.archiveProof.archiveBytes !== pin.files[0].size) fail("receipt_invalid");
  let proof;
  try { proof = validatePostgresCandidateArchive(readFixed(opened[0], guard, signal), { imageId: policy.candidate.imageId,
    tag: receipt.archiveProof.tag, expectedDiffIds: policy.candidate.diffIds, expectedLayers: 12,
    maximumBytes: postgresCandidateProofLimits.archiveBytes }); } catch { fail("archive_invalid"); }
  if (!isDeepStrictEqual(proof, receipt.archiveProof)) fail("archive_invalid");
  for (const item of opened) seal(item, guard, signal);
  return proof;
}
function descriptors(opened) {
  return opened.map((item) => ({ ...item.expected, identity: { dev: String(item.identity.dev), ino: String(item.identity.ino),
    uid: Number(item.identity.uid), gid: Number(item.identity.gid), mode: Number(item.identity.mode & 0o7777n),
    nlink: Number(item.identity.nlink), mtimeNs: String(item.identity.mtimeNs), ctimeNs: String(item.identity.ctimeNs) } }));
}
function proofShape(proof, pin, policy) {
  const digest = /^sha256:[0-9a-f]{64}$/u;
  const tag = `aw-postgres-gosu:${hash(Buffer.from(`${pin.originalExecutionId.slice(6)}:${pin.originalRecipeRevision}`)).slice(0, 24)}`;
  if (!keys(proof, ["archiveSha256", "archiveBytes", "archiveMembers", "imageId", "tag", "configDigest", "configBytes",
    "diffIds", "rawLayers", "manifestDigest", "manifestBytes", "compatibilityRecords", "remoteLayerVerification"])
    || proof.archiveSha256 !== pin.files[0].sha256 || proof.archiveBytes !== pin.files[0].size || proof.archiveMembers !== 32
    || proof.imageId !== policy.candidate.imageId || proof.configDigest !== proof.imageId || proof.tag !== tag
    || proof.configBytes !== policy.manifest.config.size || !isDeepStrictEqual(proof.diffIds, policy.candidate.diffIds)
    || !digest.test(proof.manifestDigest) || !Number.isSafeInteger(proof.manifestBytes) || proof.manifestBytes < 1
    || proof.manifestBytes > postgresCandidateProofLimits.jsonBytes || proof.remoteLayerVerification !== "NOT_ESTABLISHED_BY_DOCKER_SAVE"
    || !Array.isArray(proof.rawLayers) || proof.rawLayers.length !== 12
    || proof.rawLayers.some((item, index) => !keys(item, ["digest", "size", "mediaType"])
      || item.digest !== proof.diffIds[index] || item.mediaType !== "application/vnd.oci.image.layer.v1.tar"
      || !Number.isSafeInteger(item.size) || item.size < 1024 || item.size % 512 !== 0 || item.size > proof.archiveBytes)
    || !Array.isArray(proof.compatibilityRecords) || proof.compatibilityRecords.length !== 12
    || proof.compatibilityRecords.some((item, index, records) => !keys(item, ["blobDigest", "id", "parent", "rich"])
      || !digest.test(item.blobDigest) || !HEX.test(item.id) || item.parent !== (index === 0 ? null : records[index - 1].id)
      || item.rich !== (index === 11)) || new Set(proof.compatibilityRecords.map((item) => item.id)).size !== 12
    || new Set(proof.compatibilityRecords.map((item) => item.blobDigest)).size !== 12
    || proof.rawLayers.reduce((total, item) => total + item.size, proof.configBytes + proof.manifestBytes) > proof.archiveBytes) fail("result_invalid");
}
export function validatePostgresPrivateCopyLinuxResult(value, pinValue, policyValue, expectedProof) {
  try {
    const pin = validatePin(pinValue); const policy = validatePostgresRemotePolicy(policyValue);
    if (!keys(value, ["kind", "operation", "state", "recipeRevision", "originalRecipeRevision", "originalExecutionId",
      "sourceDirectory", "directory", "sourceFiles", "files", "archiveProof", "filesystem"])
      || value.kind !== "POSTGRES_PRIVATE_COPY_LINUX_RESULT_V1" || !["EXPORT", "IMPORT", "SEAL"].includes(value.operation)
      || value.state !== "VERIFIED" || !REVISION.test(value.recipeRevision) || value.originalRecipeRevision !== pin.originalRecipeRevision
      || value.originalExecutionId !== pin.originalExecutionId || value.sourceDirectory !== pin.sourceDirectory || value.filesystem !== "EXT4"
      || typeof value.directory !== "string" || !path.posix.isAbsolute(value.directory) || path.posix.normalize(value.directory) !== value.directory
      || value.operation === "EXPORT" && value.directory !== value.sourceDirectory
      || value.operation !== "EXPORT" && (value.directory === value.sourceDirectory
        || !value.directory.startsWith(`${pin.importPrefix ?? "/home/autoworld/pg-private-reimport-"}`)
        || !/^[A-Za-z0-9]{6}$/u.test(value.directory.slice((pin.importPrefix ?? "/home/autoworld/pg-private-reimport-").length)))) fail("result_invalid");
    for (const [name, gid] of [["sourceFiles", pin.sourceGid], ["files", value.operation === "EXPORT" ? pin.sourceGid : pin.importGid ?? 1000]]) {
      if (!Array.isArray(value[name]) || value[name].length !== 2 || value[name].some((item, index) =>
        !keys(item, ["name", "size", "sha256", "identity"]) || item.name !== pin.files[index].name || item.size !== pin.files[index].size
        || item.sha256 !== pin.files[index].sha256 || !keys(item.identity, ["dev", "ino", "uid", "gid", "mode", "nlink", "mtimeNs", "ctimeNs"])
        || ["dev", "ino", "mtimeNs", "ctimeNs"].some((key) => typeof item.identity[key] !== "string" || !DECIMAL.test(item.identity[key]))
        || item.identity.uid !== (pin.ownerUid ?? 1000) || !Number.isSafeInteger(item.identity.gid) || item.identity.gid < 1
        || (gid ?? 1000) !== item.identity.gid || item.identity.mode !== 0o600 || item.identity.nlink !== 1)) fail("result_invalid");
      if (new Set(value[name].map((item) => `${item.identity.dev}:${item.identity.ino}`)).size !== 2) fail("result_invalid");
    }
    if (value.operation === "EXPORT" && !isDeepStrictEqual(value.files, value.sourceFiles)
      || value.operation !== "EXPORT" && value.files.some((item) => value.sourceFiles.some((original) =>
        item.identity.dev === original.identity.dev && item.identity.ino === original.identity.ino))) fail("result_invalid");
    proofShape(value.archiveProof, pin, policy);
    if (expectedProof !== undefined && !isDeepStrictEqual(value.archiveProof, expectedProof)
      || Buffer.byteLength(JSON.stringify(value)) > CAP) fail("result_invalid");
    return freeze(value);
  } catch { fail("result_invalid"); }
}
function prepare(value) {
  nativeContext();
  if (!plain(value) || Object.keys(value).some((key) => !["pin", "policy", "recipeRevision", "parent", "signal", "directory"].includes(key))
    || !REVISION.test(value.recipeRevision) || value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal)) fail("arguments_invalid");
  const pin = validatePin(value.pin); const policy = validatePostgresRemotePolicy(value.policy);
  if ((pin.ownerUid ?? 1000) !== process.getuid() || (pin.importGid ?? 1000) !== process.getgid()) fail("requires_linux_nonroot");
  const signal = globalThis.AbortSignal.any([globalThis.AbortSignal.timeout(3 * 60_000), ...(value.signal ? [value.signal] : [])]); check(signal);
  const ancestry = ancestors(pin.sourceDirectory);
  const guard = () => { ancestry();
    if (!isDeepStrictEqual(readdirSync(pin.sourceDirectory).sort(), pin.files.map((item) => item.name).sort())) fail("source_invalid"); };
  guard(); directoryIdentity(pin.sourceDirectory, pin.sourceGid, true); ext4(pin.sourceDirectory);
  return { pin, policy, signal, guard };
}
async function writeChunk(stream, bytes, signal) {
  check(signal);
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      if (!error) stream.removeListener("error", onError); signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const onError = (error) => finish(error);
    const onAbort = () => finish(closedError("aborted", "EXPORT"));
    stream.once("error", onError); signal.addEventListener("abort", onAbort, { once: true });
    try { stream.write(bytes, finish); } catch (error) { finish(error); }
  });
  check(signal);
}
async function execute(operation, value, stream) {
  const opened = []; const copied = []; let phase = "CONTEXT"; let directory; let result; let failure; let copiedGuard;
  try {
    const context = prepare(value); const { pin, policy, signal, guard } = context;
    phase = "SOURCE"; openFiles(pin.sourceDirectory, pin.sourceGid, pin, opened);
    let proof = validateMaterial(opened, pin, policy, guard, signal);
    if (operation === "EXPORT") {
      phase = "EXPORT";
      for (const item of opened) {
        const digest = createHash("sha256"); const buffer = Buffer.allocUnsafe(1024 ** 2); let offset = 0;
        while (offset < item.expected.size) {
          guard(); check(signal); fileIdentity(item.fd, item.file, item.gid, item.identity, item.expected.size);
          const count = readSync(item.fd, buffer, 0, Math.min(buffer.length, item.expected.size - offset), offset);
          if (count < 1) fail("source_changed");
          const chunk = Buffer.from(buffer.subarray(0, count)); digest.update(chunk);
          await writeChunk(stream, chunk, signal); offset += count;
        }
        if (readSync(item.fd, buffer, 0, 1, offset) !== 0 || digest.digest("hex") !== item.expected.sha256) fail("source_changed");
      }
      directory = pin.sourceDirectory;
    } else if (operation === "IMPORT") {
      phase = "IMPORT";
      const parent = value.parent ?? "/home/autoworld";
      directoryIdentity(parent); const parentGuard = ancestors(parent); ext4(parent, pin.totalBytes + 1024 ** 3);
      const prefix = pin.importPrefix ?? path.join(parent, "pg-private-reimport-");
      if (path.dirname(prefix) !== parent || !prefix.endsWith("pg-private-reimport-")) fail("arguments_invalid");
      directory = mkdtempSync(prefix); chmodSync(directory, 0o700); const created = directoryIdentity(directory, process.getgid(), true);
      const copyGuard = () => { guard(); parentGuard();
        if (!isDeepStrictEqual(created, directoryIdentity(directory, process.getgid(), true))
          || !isDeepStrictEqual(readdirSync(directory).sort(), pin.files.map((item) => item.name).sort())) fail("copy_changed"); };
      copiedGuard = copyGuard;
      for (const expected of pin.files) {
        const file = path.join(directory, expected.name);
        const fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        copied.push({ fd, file, gid: process.getgid(), expected }); fileIdentity(fd, file, process.getgid(), undefined, 0);
      }
      let index = 0; let offset = 0; let digest = createHash("sha256");
      const onAbort = () => stream.destroy(new Error(`${PREFIX}aborted`)); signal.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const chunk of stream) {
          copyGuard(); check(signal); if (!Buffer.isBuffer(chunk)) fail("input_invalid"); let cursor = 0;
          while (cursor < chunk.length) {
            if (index === copied.length) fail("input_trailing");
            const item = copied[index]; const count = Math.min(chunk.length - cursor, item.expected.size - offset);
            let written = 0; while (written < count) {
              const amount = writeSync(item.fd, chunk, cursor + written, count - written); if (amount < 1) fail("stream_failed"); written += amount;
            }
            digest.update(chunk.subarray(cursor, cursor + count)); cursor += count; offset += count;
            if (offset === item.expected.size) {
              if (digest.digest("hex") !== item.expected.sha256) fail("copy_changed");
              fsyncSync(item.fd); item.identity = fileIdentity(item.fd, item.file, item.gid, undefined, item.expected.size);
              index++; offset = 0; if (index < copied.length) digest = createHash("sha256");
            }
          }
        }
      } finally { signal.removeEventListener("abort", onAbort); }
      if (index !== copied.length) fail("input_truncated");
      phase = "VALIDATION";
      // Reopen actual completed files before the complete default validator replay.
      for (const item of copied) {
        const expected = item.identity; closeSync(item.fd); item.fd = undefined;
        item.fd = openSync(item.file, constants.O_RDONLY | constants.O_NOFOLLOW);
        fileIdentity(item.fd, item.file, item.gid, expected, item.expected.size);
      }
      proof = validateMaterial(copied, pin, policy, copyGuard, signal);
      const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(fd); copyGuard(); } finally { closeSync(fd); }
    } else {
      phase = "SEAL"; directory = value.directory;
      const prefix = pin.importPrefix ?? "/home/autoworld/pg-private-reimport-";
      if (typeof directory !== "string" || !path.isAbsolute(directory) || path.normalize(directory) !== directory
        || !directory.startsWith(prefix) || !/^[A-Za-z0-9]{6}$/u.test(directory.slice(prefix.length))) fail("arguments_invalid");
      const ancestry = ancestors(directory); const copyGuard = () => { ancestry();
        if (!isDeepStrictEqual(readdirSync(directory).sort(), pin.files.map((item) => item.name).sort())) fail("storage_invalid"); };
      copiedGuard = copyGuard; copyGuard(); directoryIdentity(directory, process.getgid(), true); ext4(directory);
      openFiles(directory, process.getgid(), pin, copied); proof = validateMaterial(copied, pin, policy, copyGuard, signal);
    }
    phase = "SEAL"; for (const item of opened) seal(item, guard, signal);
    for (const item of copied) seal(item, copiedGuard, signal);
    guard(); if (copiedGuard) copiedGuard();
    for (const item of [...opened, ...copied]) fileIdentity(item.fd, item.file, item.gid, item.identity, item.expected.size);
    result = validatePostgresPrivateCopyLinuxResult({ kind: "POSTGRES_PRIVATE_COPY_LINUX_RESULT_V1", operation,
      state: "VERIFIED", recipeRevision: value.recipeRevision, originalRecipeRevision: pin.originalRecipeRevision,
      originalExecutionId: pin.originalExecutionId, sourceDirectory: pin.sourceDirectory, directory,
      sourceFiles: descriptors(opened), files: descriptors(operation === "EXPORT" ? opened : copied), archiveProof: proof, filesystem: "EXT4" }, pin, policy);
  } catch (error) {
    failure = closedError(safeReason(error), phase, directory);
  } finally {
    let failed = false; for (const item of [...opened, ...copied]) if (item.fd !== undefined) {
      try { closeSync(item.fd); } catch { failed = true; }
    }
    if (failed) failure = closedError("descriptor_cleanup_failed", "CLEANUP", directory);
  }
  if (failure) throw failure;
  return result;
}
export async function exportPostgresPrivateCopy(value, output) { return execute("EXPORT", value, output); }
export async function importPostgresPrivateCopy(value, input) { return execute("IMPORT", value, input); }
export async function sealPostgresPrivateCopy(value, directory) { return execute("SEAL", { ...value, directory }); }
function sourceRevision() {
  const environment = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  const git = (args) => {
    const result = spawnSync("/usr/bin/git", ["-C", ROOT, ...args], { env: environment, encoding: null, timeout: 10_000, maxBuffer: CAP });
    if (result.error || result.signal || result.status !== 0 || result.stderr.length) fail("source_revision_invalid");
    return result.stdout.toString("utf8").trim();
  };
  if (realpathSync(ROOT) !== ROOT || lstatSync(ROOT).uid !== process.getuid()) fail("source_revision_invalid");
  const revision = git(["rev-parse", "HEAD"]);
  if (!REVISION.test(revision) || git(["status", "--porcelain", "--untracked-files=normal"]) !== "") fail("source_revision_invalid");
  return revision;
}
export async function runPostgresPrivateCopyLinux(argv = process.argv.slice(2)) {
  if (!(argv.length === 1 && ["export", "import"].includes(argv[0]) || argv.length === 2 && argv[0] === "seal"
    && /^\/home\/autoworld\/pg-private-reimport-[A-Za-z0-9]{6}$/u.test(argv[1])) || process.platform !== "linux"
    || process.getuid?.() !== 1000 || process.getgid?.() !== 1000 || process.version !== "v22.23.2"
    || ["GITHUB_ACTIONS", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT"].some((key) => Object.hasOwn(process.env, key))) fail("arguments_invalid");
  const recipeRevision = sourceRevision(); const bytes = readFileSync(path.join(ROOT, "infra/postgres-image/candidate-remote.json"));
  if (hash(bytes) !== PRIVATE_COPY_PIN.policySha256) fail("policy_invalid");
  const policy = validateLocalPostgresRetentionPolicyBytes(bytes);
  const value = { pin: PRIVATE_COPY_PIN, policy, recipeRevision };
  let result;
  if (argv[0] === "seal") result = await sealPostgresPrivateCopy(value, argv[1]);
  else if (argv[0] === "export") result = await exportPostgresPrivateCopy(value, process.stdout);
  else result = await importPostgresPrivateCopy(value, process.stdin);
  if (sourceRevision() !== recipeRevision) fail("source_revision_invalid");
  const target = argv[0] === "export" ? process.stderr : process.stdout;
  if (!target.write(`${JSON.stringify(result)}\n`)) await once(target, "drain");
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresPrivateCopyLinux().catch((error) => {
    const result = { state: "INCOMPLETE", code: `${PREFIX}${safeReason(error)}`, phase: PHASES.has(error?.phase) ? error.phase : "CONTEXT" };
    const target = process.argv[2] === "export" ? process.stderr : process.stdout;
    target.write(`${JSON.stringify(result)}\n`); process.exitCode = 1;
  });
}
