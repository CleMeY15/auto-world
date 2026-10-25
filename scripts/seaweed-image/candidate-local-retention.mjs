import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  readSync, realpathSync, readdirSync, statSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { validateSavedSeaweedCandidate } from "./candidate-archive.mjs";
import {
  validateRemoteSeaweedCandidatePolicy, validateRemoteSeaweedCandidateReceipt, withVerifiedRemoteSeaweedCandidate,
} from "./candidate-remote.mjs";

const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
const COPY_BUFFER_BYTES = 1024 ** 2;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const ARCHIVE_NAME = "candidate.tar";
const RECEIPT_NAME = "retention-receipt.json";
const PENDING_RECEIPT_NAME = ".retention-receipt.pending";
const LOCAL_PHASES = ["private_archive_copy", "retained_archive_validation", "remote_cleanup"];

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function validateLocalSeaweedRetentionReceipt(receipt, policyInput) {
  const policy = validateRemoteSeaweedCandidatePolicy(policyInput);
  const keys = ["kind", "state", "authority", "origin", "executionId", "githubRunId",
    "candidateAuthorization", "admission", "signing", "registryWrite", "runId", "recipeRevision",
    "subject", "imageId", "diffId", "archiveProof", "remoteMaterialReceipt", "phases"];
  if (!exactKeys(receipt, keys) || receipt.kind !== "SEAWEED_LOCAL_CANDIDATE_RETENTION_RECEIPT_V1"
    || receipt.state !== "RETAINED" || receipt.authority !== "LOCAL_DIAGNOSTIC"
    || receipt.origin !== "LOCAL_DIAGNOSTIC" || receipt.githubRunId !== null
    || !RUN_ID.test(receipt.runId) || !REVISION.test(receipt.recipeRevision)
    || receipt.executionId !== `local-${receipt.runId}` || receipt.candidateAuthorization !== "NOT_AUTHORIZED"
    || receipt.admission !== "NOT_AUTHORIZED" || receipt.signing !== "NOT_ATTEMPTED"
    || receipt.registryWrite !== "NOT_ATTEMPTED" || receipt.subject !== policy.subject
    || receipt.imageId !== policy.candidate.imageId || receipt.diffId !== policy.candidate.diffId
    || !Array.isArray(receipt.phases) || receipt.phases.length !== LOCAL_PHASES.length
    || receipt.phases.some((phase, index) => !exactKeys(phase, ["name", "result", "durationMs"])
      || phase.name !== LOCAL_PHASES[index] || phase.result !== "PASSED"
      || !Number.isSafeInteger(phase.durationMs) || phase.durationMs < 0)) {
    fail("seaweed_local_retention_receipt_invalid");
  }
  const material = validateRemoteSeaweedCandidateReceipt(receipt.remoteMaterialReceipt, policy);
  const proof = receipt.archiveProof;
  if (material.runId !== receipt.runId || material.recipeRevision !== receipt.recipeRevision
    || !exactKeys(proof, ["kind", "authority", "candidateAuthorization", "imageId", "identityType", "tag",
      "serverVersion", "archiveSha256", "archiveBytes", "archiveMembers", "configSha256", "configBytes",
      "layerSha256", "layerBytes", "diffId", "rawSize", "memberCount"])
    || proof.kind !== "SEAWEED_SAVED_CANDIDATE_PROOF_V1" || proof.authority !== "PREPARATION_ONLY"
    || proof.candidateAuthorization !== "NOT_AUTHORIZED" || proof.identityType !== "CLASSIC_CONFIG_ID"
    || proof.imageId !== policy.candidate.imageId || proof.diffId !== policy.candidate.diffId
    || proof.tag !== material.alias || proof.serverVersion !== "28.0.4"
    || proof.archiveSha256 !== material.archive.archiveSha256 || proof.archiveBytes !== material.archive.archiveBytes
    || proof.archiveBytes > MAX_ARCHIVE_BYTES || !Number.isSafeInteger(proof.archiveMembers)
    || proof.archiveMembers < 1 || proof.archiveMembers > 64
    || proof.configSha256 !== policy.source.configSha256 || proof.configBytes !== policy.source.configBytes
    || proof.layerSha256 !== policy.source.savedLayerSha256 || proof.layerBytes !== policy.source.savedLayerBytes
    || proof.rawSize !== policy.candidate.rawSize || proof.memberCount !== policy.candidate.memberCount) {
    fail("seaweed_local_retention_receipt_invalid");
  }
  return cloneFrozen(receipt);
}
function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, cloneFrozen(item)])));
  return value;
}
function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.uid === right.uid
    && left.gid === right.gid && left.mode === right.mode && left.nlink === right.nlink;
}
function identity(value) {
  return { dev: value.dev, ino: value.ino, size: value.size, mtimeNs: value.mtimeNs, ctimeNs: value.ctimeNs,
    uid: value.uid, gid: value.gid, mode: value.mode, nlink: value.nlink };
}
function checkSignal(signal) {
  if (signal?.aborted) fail("seaweed_local_retention_aborted");
}
function assertPrivateEmptyDirectory(value, code) {
  if (typeof value !== "string" || !path.isAbsolute(value)) fail(code);
  let descriptor;
  try {
    const link = lstatSync(value, { bigint: true });
    descriptor = statSync(value, { bigint: true });
    if (link.isSymbolicLink() || !descriptor.isDirectory() || realpathSync(value) !== value
      || descriptor.uid !== BigInt(process.getuid()) || (descriptor.mode & 0o777n) !== 0o700n
      || readdirSync(value).length !== 0) fail(code);
  } catch { fail(code); }
}
function separated(left, right) {
  const contains = (base, target) => {
    const relation = path.relative(base, target);
    return relation === "" || (!path.isAbsolute(relation) && relation !== ".."
      && !relation.startsWith(`..${path.sep}`));
  };
  return !contains(left, right) && !contains(right, left);
}
function validateInput(value) {
  const allowed = new Set(["parent", "destination", "policy", "runId", "recipeRevision", "signal",
    "validateFilesystem", "validateRuntimeConfig"]);
  if (!plain(value) || Object.keys(value).some((key) => !allowed.has(key))
    || typeof value.parent !== "string" || typeof value.destination !== "string"
    || !plain(value.policy) || !RUN_ID.test(value.runId) || !REVISION.test(value.recipeRevision)
    || typeof value.validateFilesystem !== "function" || typeof value.validateRuntimeConfig !== "function"
    || (value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal))) {
    fail("seaweed_local_retention_input_invalid");
  }
  assertPrivateEmptyDirectory(value.parent, "seaweed_local_retention_parent_invalid");
  assertPrivateEmptyDirectory(value.destination, "seaweed_local_retention_destination_invalid");
  if (!separated(value.parent, value.destination)) fail("seaweed_local_retention_paths_invalid");
  let policy;
  try { policy = validateRemoteSeaweedCandidatePolicy(value.policy); }
  catch { fail("seaweed_local_retention_input_invalid"); }
  return Object.freeze({ ...value, policy });
}
function validateCallbackSnapshot(value, input) {
  if (!plain(value) || typeof value.file !== "string" || !plain(value.archiveProof)
    || JSON.stringify(value.policy) !== JSON.stringify(input.policy) || value.subject !== input.policy.subject
    || value.imageId !== input.policy.candidate?.imageId || value.diffId !== input.policy.candidate?.diffId
    || value.runId !== input.runId || value.recipeRevision !== input.recipeRevision
    || !DIGEST.test(value.imageId) || !DIGEST.test(value.diffId)) {
    fail("seaweed_local_retention_material_invalid");
  }
}
function validateSource(file, expectedBytes) {
  let link; let handle;
  try {
    link = lstatSync(file, { bigint: true });
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const descriptor = fstatSync(handle, { bigint: true });
    if (link.isSymbolicLink() || !descriptor.isFile() || descriptor.nlink !== 1n
      || descriptor.uid !== BigInt(process.getuid()) || descriptor.size !== BigInt(expectedBytes)
      || descriptor.size < 1n || descriptor.size > BigInt(MAX_ARCHIVE_BYTES)
      || !sameIdentity(identity(link), identity(descriptor))) fail("seaweed_local_retention_source_invalid");
    return { handle, identity: identity(descriptor), bytes: Number(descriptor.size) };
  } catch (error) {
    if (handle !== undefined) closeSync(handle);
    if (error instanceof Error && error.message === "seaweed_local_retention_source_invalid") throw error;
    fail("seaweed_local_retention_source_invalid");
  }
}
function copyPrivateArchive(sourceFile, destinationFile, expectedBytes, signal) {
  const source = validateSource(sourceFile, expectedBytes); let destination;
  try {
    destination = openSync(destinationFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      | constants.O_NOFOLLOW, 0o600);
    fchmodSync(destination, 0o600);
    const created = fstatSync(destination, { bigint: true });
    if (!created.isFile() || created.nlink !== 1n || created.uid !== BigInt(process.getuid())
      || created.size !== 0n || (created.mode & 0o777n) !== 0o600n) fail("seaweed_local_retention_destination_invalid");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES); let position = 0;
    while (position < source.bytes) {
      checkSignal(signal);
      const count = readSync(source.handle, buffer, 0, Math.min(buffer.length, source.bytes - position), position);
      if (count < 1) fail("seaweed_local_retention_copy_failed");
      let written = 0;
      while (written < count) {
        const size = writeSync(destination, buffer, written, count - written);
        if (size < 1) fail("seaweed_local_retention_copy_failed");
        written += size;
      }
      position += count;
    }
    if (readSync(source.handle, buffer, 0, 1, source.bytes) !== 0) fail("seaweed_local_retention_source_invalid");
    fsyncSync(destination); checkSignal(signal);
    const sourceAfter = fstatSync(source.handle, { bigint: true });
    const sourcePathAfter = lstatSync(sourceFile, { bigint: true });
    const destinationAfter = fstatSync(destination, { bigint: true });
    const destinationPathAfter = lstatSync(destinationFile, { bigint: true });
    if (!sameIdentity(source.identity, identity(sourceAfter)) || !sameIdentity(source.identity, identity(sourcePathAfter))
      || destinationAfter.size !== BigInt(source.bytes) || destinationAfter.nlink !== 1n
      || (destinationAfter.mode & 0o777n) !== 0o600n
      || !sameIdentity(identity(destinationAfter), identity(destinationPathAfter))) {
      fail("seaweed_local_retention_copy_changed");
    }
  } catch (error) {
    if (error instanceof Error && /^seaweed_local_retention_/u.test(error.message)) throw error;
    fail("seaweed_local_retention_copy_failed");
  } finally {
    if (destination !== undefined) closeSync(destination);
    closeSync(source.handle);
  }
}
function sameProof(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function publishReceipt(destination, receipt) {
  const pending = path.join(destination, PENDING_RECEIPT_NAME);
  const target = path.join(destination, RECEIPT_NAME); let handle;
  try {
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    handle = openSync(pending, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      | constants.O_NOFOLLOW, 0o600);
    fchmodSync(handle, 0o600);
    let position = 0;
    while (position < bytes.length) {
      const size = writeSync(handle, bytes, position, bytes.length - position);
      if (size < 1) fail("seaweed_local_retention_receipt_failed");
      position += size;
    }
    fsyncSync(handle); closeSync(handle); handle = undefined;
    const before = lstatSync(pending, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid())
      || before.size !== BigInt(bytes.length) || (before.mode & 0o777n) !== 0o600n) {
      fail("seaweed_local_retention_receipt_failed");
    }
    linkSync(pending, target); unlinkSync(pending);
    const after = lstatSync(target, { bigint: true });
    if (!after.isFile() || after.nlink !== 1n || after.uid !== BigInt(process.getuid())
      || after.size !== BigInt(bytes.length) || (after.mode & 0o777n) !== 0o600n) {
      fail("seaweed_local_retention_receipt_failed");
    }
    const directory = openSync(destination, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (handle !== undefined) closeSync(handle);
    if (error instanceof Error && error.message === "seaweed_local_retention_receipt_failed") throw error;
    fail("seaweed_local_retention_receipt_failed");
  }
  return target;
}

export async function retainLocalSeaweedCandidate(inputValue, dependencies = {}) {
  if (process.platform !== "linux") fail("seaweed_local_retention_requires_linux");
  if (!plain(dependencies) || Object.keys(dependencies).some((key) => !["remoteProvider", "validateArchive",
    "providerDependencies"].includes(key)) || (dependencies.providerDependencies !== undefined
      && !plain(dependencies.providerDependencies))) fail("seaweed_local_retention_arguments_invalid");
  const input = validateInput(inputValue); checkSignal(input.signal);
  const remoteProvider = dependencies.remoteProvider ?? withVerifiedRemoteSeaweedCandidate;
  const archiveValidator = dependencies.validateArchive ?? validateSavedSeaweedCandidate;
  if (typeof remoteProvider !== "function" || typeof archiveValidator !== "function") {
    fail("seaweed_local_retention_arguments_invalid");
  }
  const archiveFile = path.join(input.destination, ARCHIVE_NAME); let retainedProof; let cleanupStarted;
  const phases = [];
  const remoteMaterialReceipt = await remoteProvider({ parent: input.parent, policy: input.policy,
    runId: input.runId, recipeRevision: input.recipeRevision, validateFilesystem: input.validateFilesystem,
    validateRuntimeConfig: input.validateRuntimeConfig, signal: input.signal },
  async (snapshot) => {
    checkSignal(input.signal); validateCallbackSnapshot(snapshot, input);
    if (!Number.isSafeInteger(snapshot.archiveProof.archiveBytes) || snapshot.archiveProof.archiveBytes < 1
      || snapshot.archiveProof.archiveBytes > MAX_ARCHIVE_BYTES) fail("seaweed_local_retention_material_invalid");
    let started = Date.now();
    copyPrivateArchive(snapshot.file, archiveFile, snapshot.archiveProof.archiveBytes, input.signal);
    phases.push({ name: "private_archive_copy", result: "PASSED", durationMs: Math.max(0, Date.now() - started) });
    started = Date.now();
    retainedProof = await archiveValidator({ file: archiveFile, imageId: snapshot.imageId,
      tag: snapshot.archiveProof.tag, diffId: snapshot.diffId, rawSize: snapshot.archiveProof.rawSize,
      memberCount: snapshot.archiveProof.memberCount, serverVersion: snapshot.archiveProof.serverVersion,
      validateFilesystem: input.validateFilesystem, validateRuntimeConfig: input.validateRuntimeConfig,
      ...(input.signal ? { signal: input.signal } : {}) });
    if (!sameProof(retainedProof, snapshot.archiveProof)) fail("seaweed_local_retention_proof_mismatch");
    phases.push({ name: "retained_archive_validation", result: "PASSED", durationMs: Math.max(0, Date.now() - started) });
    cleanupStarted = Date.now();
  }, dependencies.providerDependencies ?? {});
  phases.push({ name: "remote_cleanup", result: "PASSED", durationMs: Math.max(0, Date.now() - cleanupStarted) });
  checkSignal(input.signal);
  if (!retainedProof || !plain(remoteMaterialReceipt) || remoteMaterialReceipt.kind !== "SEAWEED_REMOTE_CANDIDATE_RECEIPT_V1"
    || remoteMaterialReceipt.state !== "VERIFIED" || remoteMaterialReceipt.authority !== "REMOTE_READ_ONLY"
    || remoteMaterialReceipt.candidateAuthorization !== "NOT_AUTHORIZED"
    || remoteMaterialReceipt.runId !== input.runId || remoteMaterialReceipt.recipeRevision !== input.recipeRevision
    || remoteMaterialReceipt.subject !== input.policy.subject || remoteMaterialReceipt.archive?.archiveSha256 !== retainedProof.archiveSha256
    || remoteMaterialReceipt.archive?.archiveBytes !== retainedProof.archiveBytes
    || remoteMaterialReceipt.archive?.imageId !== retainedProof.imageId
    || remoteMaterialReceipt.archive?.diffId !== retainedProof.diffId) fail("seaweed_local_retention_remote_receipt_invalid");
  const receipt = validateLocalSeaweedRetentionReceipt({ kind: "SEAWEED_LOCAL_CANDIDATE_RETENTION_RECEIPT_V1", state: "RETAINED",
    authority: "LOCAL_DIAGNOSTIC", origin: "LOCAL_DIAGNOSTIC", executionId: `local-${input.runId}`,
    githubRunId: null, candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED", signing: "NOT_ATTEMPTED",
    registryWrite: "NOT_ATTEMPTED", runId: input.runId, recipeRevision: input.recipeRevision,
    subject: input.policy.subject, imageId: input.policy.candidate.imageId, diffId: input.policy.candidate.diffId,
    archiveProof: retainedProof, remoteMaterialReceipt, phases }, input.policy);
  const receiptFile = publishReceipt(input.destination, receipt);
  return Object.freeze({ receipt, archiveFile, receiptFile });
}
