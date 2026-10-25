import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync,
  readSync, realpathSync, readdirSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { postgresCandidateProofLimits, validatePostgresCandidateArchive } from "./candidate-proof.mjs";
import { validatePostgresRemoteCandidateReceipt, validatePostgresRemotePolicy,
  withVerifiedRemotePostgresCandidate } from "./candidate-remote.mjs";

const MAX_BYTES = postgresCandidateProofLimits.archiveBytes;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HEX = /^[0-9a-f]{64}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RAW_LAYER = "application/vnd.oci.image.layer.v1.tar";
const PHASES = ["private_archive_copy", "retained_archive_validation", "remote_cleanup", "post_cleanup_archive_validation"];
const ERROR_PREFIX = "postgres_local_retention_";
const ERROR_CODES = new Set(["directory_invalid", "file_changed", "proof_invalid", "receipt_invalid", "aborted",
  "source_invalid", "destination_invalid", "copy_failed", "copy_changed", "proof_mismatch", "archive_invalid",
  "receipt_failed", "receipt_cleanup_uncertain", "requires_linux_nonroot", "arguments_invalid", "input_invalid",
  "paths_invalid", "directory_changed", "material_invalid", "remote_failed", "remote_receipt_invalid", "operation_failed"]
  .map((reason) => `${ERROR_PREFIX}${reason}`));
const fail = (reason) => { throw new Error(`${ERROR_PREFIX}${reason}`); };
function knownError(error) {
  try {
    if (!(error instanceof Error)) return null;
    const code = error.message;
    return ERROR_CODES.has(code) ? code : null;
  } catch { return null; }
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exactKeys = (value, keys) => plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const frozen = (value) => Array.isArray(value) ? Object.freeze(value.map(frozen)) : plain(value)
  ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, frozen(item)]))) : value;
const alias = (runId, revision) => `aw-postgres-gosu:${sha(Buffer.from(`${runId}:${revision}`)).slice(0, 24)}`;
function checkSignal(signal) { if (signal?.aborted) fail("aborted"); }
function identity(stat) {
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode, nlink: stat.nlink,
    size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
}
const same = (left, right) => isDeepStrictEqual(left, identity(right));
function privateDirectory(file, empty = false) {
  try {
    const stat = lstatSync(file, { bigint: true });
    if (typeof file !== "string" || !path.isAbsolute(file) || path.normalize(file) !== file || realpathSync(file) !== file
      || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid())
      || stat.gid !== BigInt(process.getgid()) || (stat.mode & 0o7777n) !== 0o700n
      || empty && readdirSync(file).length !== 0) fail("directory_invalid");
    return { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode };
  } catch { fail("directory_invalid"); }
}
function separated(left, right) {
  const inside = (base, target) => {
    const value = path.relative(base, target);
    return value === "" || !path.isAbsolute(value) && value !== ".." && !value.startsWith(`..${path.sep}`);
  };
  return !inside(left, right) && !inside(right, left);
}
function privateFile(fd, file, expected) {
  const stat = fstatSync(fd, { bigint: true }); const entry = lstatSync(file, { bigint: true });
  if (!stat.isFile() || entry.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== BigInt(process.getuid())
    || stat.gid !== BigInt(process.getgid()) || (stat.mode & 0o7777n) !== 0o600n || stat.size > BigInt(MAX_BYTES)
    || !same(identity(stat), entry) || expected !== undefined && !same(expected, stat)) fail("file_changed");
  return identity(stat);
}
function archiveProof(proof, policy, tag) {
  if (!exactKeys(proof, ["archiveSha256", "archiveBytes", "archiveMembers", "imageId", "tag", "configDigest",
    "configBytes", "diffIds", "rawLayers", "manifestDigest", "manifestBytes", "compatibilityRecords", "remoteLayerVerification"])
    || !HEX.test(proof.archiveSha256) || !Number.isSafeInteger(proof.archiveBytes) || proof.archiveBytes < 1024
    || proof.archiveBytes > MAX_BYTES || proof.archiveMembers !== 32 || proof.imageId !== policy.candidate.imageId
    || proof.tag !== tag || proof.configDigest !== policy.candidate.imageId || proof.configBytes !== policy.manifest.config.size
    || !isDeepStrictEqual(proof.diffIds, policy.candidate.diffIds) || !DIGEST.test(proof.manifestDigest)
    || !Number.isSafeInteger(proof.manifestBytes) || proof.manifestBytes < 1
    || proof.manifestBytes > postgresCandidateProofLimits.jsonBytes || !Array.isArray(proof.rawLayers)
    || proof.rawLayers.length !== 12 || proof.rawLayers.some((item, index) => !exactKeys(item, ["digest", "size", "mediaType"])
      || item.digest !== policy.candidate.diffIds[index] || item.mediaType !== RAW_LAYER
      || !Number.isSafeInteger(item.size) || item.size < 1024 || item.size % 512 !== 0 || item.size > MAX_BYTES)
    || !Array.isArray(proof.compatibilityRecords) || proof.compatibilityRecords.length !== 12
    || proof.compatibilityRecords.some((item, index, records) => !exactKeys(item, ["blobDigest", "id", "parent", "rich"])
      || !DIGEST.test(item.blobDigest) || !HEX.test(item.id) || item.parent !== (index === 0 ? null : records[index - 1].id)
      || item.rich !== (index === 11)) || new Set(proof.compatibilityRecords.map((item) => item.id)).size !== 12
    || new Set(proof.compatibilityRecords.map((item) => item.blobDigest)).size !== 12
    || proof.rawLayers.reduce((total, item) => total + item.size, proof.configBytes + proof.manifestBytes) > proof.archiveBytes
    || proof.remoteLayerVerification !== "NOT_ESTABLISHED_BY_DOCKER_SAVE") fail("proof_invalid");
  return frozen(proof);
}
export function validateLocalPostgresRetentionReceipt(value, policyValue) {
  try {
    const policy = validatePostgresRemotePolicy(policyValue);
    if (!exactKeys(value, ["kind", "state", "authority", "origin", "executionId", "githubRunId", "candidateAuthorization",
      "admission", "signing", "registryWrite", "imageExecution", "supportStartedAt", "supportEndsAt", "archiveUntil",
      "runId", "recipeRevision", "subject", "imageId", "diffIds", "archiveProof", "remoteMaterialReceipt", "phases"])
      || value.kind !== "POSTGRES_LOCAL_CANDIDATE_RETENTION_RECEIPT_V1" || value.state !== "RETAINED"
      || value.authority !== "LOCAL_DIAGNOSTIC" || value.origin !== "LOCAL_DIAGNOSTIC" || !RUN_ID.test(value.runId)
      || !REVISION.test(value.recipeRevision) || value.executionId !== `local-${value.runId}` || value.githubRunId !== null
      || value.candidateAuthorization !== "NOT_AUTHORIZED" || value.admission !== "NOT_AUTHORIZED"
      || value.signing !== "NOT_ATTEMPTED" || value.registryWrite !== "NOT_ATTEMPTED" || value.imageExecution !== "NOT_ATTEMPTED"
      || value.supportStartedAt !== null || value.supportEndsAt !== null || value.archiveUntil !== null
      || value.subject !== policy.subject || value.imageId !== policy.candidate.imageId
      || !isDeepStrictEqual(value.diffIds, policy.candidate.diffIds) || !Array.isArray(value.phases)
      || value.phases.length !== PHASES.length || value.phases.some((item, index) => !exactKeys(item, ["name", "result", "durationMs"])
        || item.name !== PHASES[index] || item.result !== "PASSED" || !Number.isSafeInteger(item.durationMs) || item.durationMs < 0)) fail("receipt_invalid");
    const material = validatePostgresRemoteCandidateReceipt(value.remoteMaterialReceipt, policy);
    const proof = archiveProof(value.archiveProof, policy, alias(value.runId, value.recipeRevision));
    if (material.runId !== value.runId || material.recipeRevision !== value.recipeRevision || material.alias !== proof.tag
      || material.archive.archiveSha256 !== proof.archiveSha256 || material.archive.archiveBytes !== proof.archiveBytes) fail("receipt_invalid");
    return frozen(value);
  } catch { fail("receipt_invalid"); }
}
function copy(sourceFile, target, proof, guard, signal) {
  let source; let destination;
  try {
    guard(); checkSignal(signal);
    source = openSync(sourceFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = privateFile(source, sourceFile);
    if (before.size !== BigInt(proof.archiveBytes)) fail("source_invalid");
    destination = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const created = privateFile(destination, target);
    if (created.size !== 0n) fail("destination_invalid");
    const buffer = Buffer.allocUnsafe(1024 ** 2); const hash = createHash("sha256"); let position = 0;
    while (position < proof.archiveBytes) {
      guard(); checkSignal(signal);
      const count = readSync(source, buffer, 0, Math.min(buffer.length, proof.archiveBytes - position), position);
      if (count < 1) fail("copy_failed"); hash.update(buffer.subarray(0, count));
      let written = 0;
      while (written < count) { const amount = writeSync(destination, buffer, written, count - written); if (amount < 1) fail("copy_failed"); written += amount; }
      position += count;
    }
    if (readSync(source, buffer, 0, 1, position) !== 0 || hash.digest("hex") !== proof.archiveSha256) fail("source_invalid");
    fsyncSync(destination); guard(); checkSignal(signal); privateFile(source, sourceFile, before);
    const copied = privateFile(destination, target);
    if (copied.dev !== created.dev || copied.ino !== created.ino || copied.size !== before.size) fail("copy_changed");
    return copied;
  } catch (error) {
    const code = knownError(error); if (code) fail(code.slice(ERROR_PREFIX.length));
    fail("copy_failed");
  } finally { if (source !== undefined) closeSync(source); if (destination !== undefined) closeSync(destination); }
}
async function validateCopy(file, expectedIdentity, proof, policy, validateArchive, guard, signal) {
  let fd;
  try {
    guard(); checkSignal(signal); fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    privateFile(fd, file, expectedIdentity); const bytes = readFileSync(fd);
    if (bytes.length !== proof.archiveBytes || sha(bytes) !== proof.archiveSha256) fail("copy_changed");
    const checked = archiveProof(await validateArchive(bytes, { imageId: policy.candidate.imageId, tag: proof.tag,
      expectedDiffIds: policy.candidate.diffIds, expectedLayers: 12, maximumBytes: MAX_BYTES }), policy, proof.tag);
    guard(); checkSignal(signal); privateFile(fd, file, expectedIdentity);
    if (!isDeepStrictEqual(checked, proof)) fail("proof_mismatch");
    return checked;
  } catch (error) {
    const code = knownError(error); if (code) fail(code.slice(ERROR_PREFIX.length));
    fail("archive_invalid");
  } finally { if (fd !== undefined) closeSync(fd); }
}
function publish(destination, receipt, guard) {
  const pending = path.join(destination, ".retention-receipt.pending"); const target = path.join(destination, "retention-receipt.json");
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`); let fd; let dir; let published = false;
  try {
    guard(); fd = openSync(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let offset = 0;
    while (offset < bytes.length) { const written = writeSync(fd, bytes, offset, bytes.length - offset); if (written < 1) fail("receipt_failed"); offset += written; }
    fsyncSync(fd); const identity = privateFile(fd, pending);
    if (identity.size !== BigInt(bytes.length)) fail("receipt_failed");
    guard(); linkSync(pending, target); published = true; unlinkSync(pending);
    const linked = privateFile(fd, target);
    if (linked.dev !== identity.dev || linked.ino !== identity.ino) fail("receipt_failed");
    const seal = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const sealedIdentity = privateFile(seal, target, linked);
      if (!readFileSync(seal).equals(bytes)) fail("receipt_failed");
      privateFile(seal, target, sealedIdentity);
    } finally { closeSync(seal); }
    guard();
    dir = openSync(destination, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); fsyncSync(dir);
    return target;
  } catch {
    if (published) {
      try {
        const stat = lstatSync(target, { bigint: true }); const own = fstatSync(fd, { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== own.dev || stat.ino !== own.ino
          || stat.uid !== BigInt(process.getuid()) || stat.gid !== BigInt(process.getgid()) || (stat.mode & 0o7777n) !== 0o600n) fail("receipt_cleanup_uncertain");
        unlinkSync(target);
      } catch { fail("receipt_cleanup_uncertain"); }
    }
    fail("receipt_failed");
  }
  finally { if (fd !== undefined) closeSync(fd); if (dir !== undefined) closeSync(dir); }
}
async function retainCandidate(value, dependencies = {}) {
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (process.platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1) fail("requires_linux_nonroot");
  if (!plain(dependencies) || Object.keys(dependencies).some((key) => !["remoteProvider", "validateArchive", "providerDependencies"].includes(key))
    || dependencies.providerDependencies !== undefined && !plain(dependencies.providerDependencies)) fail("arguments_invalid");
  if (!plain(value) || Object.keys(value).some((key) => !["parent", "destination", "policy", "runId", "recipeRevision", "signal"].includes(key))
    || !["parent", "destination", "policy", "runId", "recipeRevision"].every((key) => Object.hasOwn(value, key))
    || !RUN_ID.test(value.runId) || !REVISION.test(value.recipeRevision)
    || value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal)) fail("input_invalid");
  let policy;
  try { policy = validatePostgresRemotePolicy(value.policy); } catch { fail("input_invalid"); }
  const input = Object.freeze({ ...value, policy }); checkSignal(input.signal);
  const parent = privateDirectory(input.parent, true); const destination = privateDirectory(input.destination, true);
  if (!separated(input.parent, input.destination)) fail("paths_invalid");
  const guard = () => {
    if (!isDeepStrictEqual(parent, privateDirectory(input.parent)) || !isDeepStrictEqual(destination, privateDirectory(input.destination))) fail("directory_changed");
  };
  const remoteProvider = dependencies.remoteProvider ?? withVerifiedRemotePostgresCandidate;
  const validateArchive = dependencies.validateArchive ?? validatePostgresCandidateArchive;
  if (typeof remoteProvider !== "function" || typeof validateArchive !== "function") fail("arguments_invalid");
  const file = path.join(input.destination, "candidate.tar"); const phases = [];
  let proof; let copiedIdentity; let cleanupStarted; let callbacks = 0; let material;
  const phase = async (name, operation) => { const started = Date.now(); const result = await operation();
    phases.push({ name, result: "PASSED", durationMs: Math.max(0, Date.now() - started) }); return result; };
  try {
    material = await remoteProvider({ parent: input.parent, policy, runId: input.runId, recipeRevision: input.recipeRevision,
      ...(input.signal ? { signal: input.signal } : {}) }, async (snapshot) => {
      callbacks++; guard(); checkSignal(input.signal); checkSignal(snapshot?.signal);
      if (callbacks !== 1 || !exactKeys(snapshot, ["file", "archiveProof", "policy", "subject", "imageId", "diffIds", "runId", "recipeRevision", "signal"])
        || snapshot.file !== path.join(input.parent, `remote-${input.runId}-attempt-1`, "candidate.tar")
        || !isDeepStrictEqual(snapshot.policy, policy) || snapshot.subject !== policy.subject || snapshot.imageId !== policy.candidate.imageId
        || !isDeepStrictEqual(snapshot.diffIds, policy.candidate.diffIds) || snapshot.runId !== input.runId
        || snapshot.recipeRevision !== input.recipeRevision || snapshot.signal !== undefined && !(snapshot.signal instanceof globalThis.AbortSignal)) fail("material_invalid");
      privateDirectory(path.dirname(snapshot.file)); proof = archiveProof(snapshot.archiveProof, policy, alias(input.runId, input.recipeRevision));
      copiedIdentity = await phase("private_archive_copy", () => copy(snapshot.file, file, proof, guard, snapshot.signal ?? input.signal));
      await phase("retained_archive_validation", () => validateCopy(file, copiedIdentity, proof, policy, validateArchive, guard, snapshot.signal ?? input.signal));
      cleanupStarted = Date.now();
    }, dependencies.providerDependencies ?? {});
  } catch (error) {
    const code = knownError(error); if (code) fail(code.slice(ERROR_PREFIX.length));
    fail("remote_failed");
  }
  guard(); checkSignal(input.signal);
  try { material = validatePostgresRemoteCandidateReceipt(material, policy); } catch { fail("remote_receipt_invalid"); }
  if (callbacks !== 1 || !proof || cleanupStarted === undefined || material.runId !== input.runId
    || material.recipeRevision !== input.recipeRevision || material.alias !== proof.tag
    || material.archive.archiveSha256 !== proof.archiveSha256 || material.archive.archiveBytes !== proof.archiveBytes) fail("remote_receipt_invalid");
  privateDirectory(input.parent, true);
  phases.push({ name: "remote_cleanup", result: "PASSED", durationMs: Math.max(0, Date.now() - cleanupStarted) });
  await phase("post_cleanup_archive_validation", () => validateCopy(file, copiedIdentity, proof, policy, validateArchive, guard, input.signal));
  const receipt = validateLocalPostgresRetentionReceipt({ kind: "POSTGRES_LOCAL_CANDIDATE_RETENTION_RECEIPT_V1", state: "RETAINED",
    authority: "LOCAL_DIAGNOSTIC", origin: "LOCAL_DIAGNOSTIC", executionId: `local-${input.runId}`, githubRunId: null,
    candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED", signing: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED",
    imageExecution: "NOT_ATTEMPTED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    runId: input.runId, recipeRevision: input.recipeRevision, subject: policy.subject, imageId: policy.candidate.imageId,
    diffIds: policy.candidate.diffIds, archiveProof: proof, remoteMaterialReceipt: material, phases }, policy);
  const receiptGuard = () => {
    guard(); checkSignal(input.signal); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { privateFile(fd, file, copiedIdentity); } finally { closeSync(fd); }
  };
  const receiptFile = publish(input.destination, receipt, receiptGuard);
  return Object.freeze({ receipt, archiveFile: file, receiptFile });
}
export async function retainLocalPostgresCandidate(value, dependencies = {}) {
  try { return await retainCandidate(value, dependencies); }
  catch (error) { const code = knownError(error); fail(code ? code.slice(ERROR_PREFIX.length) : "operation_failed"); }
}
