import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";

import { scanRawUstar } from "./archive.mjs";
import { cleanupMaterializedSeaweedBase, materializePinnedSeaweedBase, withMaterializedSeaweedBase } from "./materialize-base.mjs";
import {
  cleanupMaterializedSeaweedSource, materializeReviewedSeaweedSource, withMaterializedSeaweedSource,
} from "./materialize-source-zips.mjs";
import { createTransformPlan } from "./plan.mjs";
import { validatePlannedFilesystem } from "./plan.mjs";
import { writeUstarArchive } from "./write-archive.mjs";

const CONTENT_CHUNK_BYTES = 1024 ** 2;
const PLANNED_BACKEND = Object.freeze({
  method: "MOBY_IMAGE_IMPORT", platform: "linux/amd64", serverVersion: "28.0.4", store: "CLASSIC_CONFIG_ID",
});
const RECEIPT_AUTHORITIES = new WeakMap();
const DIRECTORY_NAMES = Object.freeze(["base", "output", "source"]);
const PARTIAL_NAME = "rootfs.tar.partial";
const FINAL_NAME = "rootfs.tar";
const REVISION = /^[a-f0-9]{40}$/u;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const DEFAULT_TIMEOUT_MS = 130 * 60_000;
const MAX_TIMEOUT_MS = 140 * 60_000;

function rootfsError(code, details = {}) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", authority: "PREPARATION_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", ...details });
}

function identity(stat) {
  return Object.freeze({ dev: stat.dev.toString(), ino: stat.ino.toString(), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString() });
}

function sameIdentity(left, right) { return Object.keys(left).every((key) => left[key] === right[key]); }
function sameNode(left, right) { return ["dev", "ino", "uid", "gid", "mode"].every((key) => left[key] === right[key]); }
function sameOwnedNode(left, right) { return sameNode(left, right) && left.nlink === right.nlink; }

async function privateDirectory(directory, uid) {
  const stat = await lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(uid)
    || (stat.mode & 0o777n) !== 0o700n || await realpath(directory) !== directory) {
    throw rootfsError("seaweed_rootfs_materialization_directory_invalid");
  }
  return identity(stat);
}

async function exactChildClosure(parent, receipt) {
  if (typeof receipt?.outputPath !== "string" || path.dirname(receipt.outputPath) !== parent) return false;
  const names = await readdir(parent);
  return names.length === 1 && names[0] === path.basename(receipt.outputPath);
}

function snapshotOptions(input, testOnly) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw rootfsError("seaweed_rootfs_materialization_options_invalid");
  const fields = Object.getOwnPropertyDescriptors(input);
  const injected = ["platform", "uid", "materializeSource", "materializeBase", "withSource", "withBase",
    "cleanupSource", "cleanupBase", "writeRootfs", "scanRootfs", "validateFilesystem", "beforeRename"];
  const permitted = new Set(["parent", "recipeRevision", "createdAt", "signal", "timeoutMs", ...(testOnly ? injected : [])]);
  if (Reflect.ownKeys(fields).some((key) => !permitted.has(key) || !("value" in fields[key]))) {
    throw rootfsError("seaweed_rootfs_materialization_options_invalid");
  }
  const value = (name) => fields[name]?.value;
  const settings = {
    parent: value("parent"), recipeRevision: value("recipeRevision"), createdAt: value("createdAt"), signal: value("signal"),
    timeoutMs: value("timeoutMs") ?? DEFAULT_TIMEOUT_MS,
    platform: value("platform") ?? process.platform, uid: value("uid") ?? process.getuid?.(),
    materializeSource: value("materializeSource") ?? materializeReviewedSeaweedSource,
    materializeBase: value("materializeBase") ?? materializePinnedSeaweedBase,
    withSource: value("withSource") ?? withMaterializedSeaweedSource,
    withBase: value("withBase") ?? withMaterializedSeaweedBase,
    cleanupSource: value("cleanupSource") ?? cleanupMaterializedSeaweedSource,
    cleanupBase: value("cleanupBase") ?? cleanupMaterializedSeaweedBase,
    writeRootfs: value("writeRootfs") ?? writePlannedRootfs, scanRootfs: value("scanRootfs") ?? scanRawUstar,
    validateFilesystem: value("validateFilesystem") ?? validatePlannedFilesystem, beforeRename: value("beforeRename"),
  };
  const timestamp = typeof settings.createdAt === "string" ? Date.parse(settings.createdAt) : Number.NaN;
  if (typeof settings.parent !== "string" || !path.isAbsolute(settings.parent) || path.normalize(settings.parent) !== settings.parent
    || !REVISION.test(settings.recipeRevision ?? "") || /^0+$/u.test(settings.recipeRevision)
    || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== settings.createdAt
    || settings.signal !== undefined && !(settings.signal instanceof globalThis.AbortSignal)
    || !Number.isSafeInteger(settings.timeoutMs) || settings.timeoutMs <= 0 || settings.timeoutMs > MAX_TIMEOUT_MS
    || settings.platform !== "linux" || !Number.isSafeInteger(settings.uid) || settings.uid < 0
    || ![settings.materializeSource, settings.materializeBase, settings.withSource, settings.withBase,
      settings.cleanupSource, settings.cleanupBase, settings.writeRootfs, settings.scanRootfs,
      settings.validateFilesystem].every((item) => typeof item === "function")
    || settings.beforeRename !== undefined && typeof settings.beforeRename !== "function") {
    throw rootfsError("seaweed_rootfs_materialization_options_invalid");
  }
  return Object.freeze(settings);
}

function chunks(load, signal) {
  return Readable.from((async function* () {
    signal?.throwIfAborted();
    const bytes = await load();
    if (!Buffer.isBuffer(bytes)) throw new Error("seaweed_rootfs_content_invalid");
    for (let offset = 0; offset < bytes.length; offset += CONTENT_CHUNK_BYTES) {
      signal?.throwIfAborted();
      yield bytes.subarray(offset, Math.min(bytes.length, offset + CONTENT_CHUNK_BYTES));
    }
  })(), { objectMode: false });
}

export function createRootfsContentOpener({ base, source, noticeEntries } = {}) {
  if (typeof base?.readEntry !== "function" || typeof source?.readBinary !== "function" || !Array.isArray(noticeEntries)) {
    throw new Error("seaweed_rootfs_capability_invalid");
  }
  const noticeContent = new Map(noticeEntries.filter((entry) => entry.type === "file")
    .map((entry) => [entry.path, entry.content]));
  return (entry, { signal } = {}) => chunks(() => {
    if (entry.path === "usr/bin/weed") return source.readBinary();
    if (noticeContent.has(entry.path)) return Buffer.from(noticeContent.get(entry.path));
    return base.readEntry(entry.path);
  }, signal);
}

export async function writePlannedRootfs({ base, source, recipeRevision, createdAt, sink, signal } = {}) {
  if (base === null || typeof base !== "object" || source === null || typeof source !== "object"
    || typeof base.readEntry !== "function" || typeof source.readBinary !== "function") {
    throw new Error("seaweed_rootfs_capability_invalid");
  }
  const inputs = {
    baseMaterials: base.baseMaterials,
    source: { ...source.sourceIdentity, recipeRevision, createdAt },
    moduleClosureBytes: source.moduleClosureBytes,
    materials: source.materials,
    backend: PLANNED_BACKEND,
  };
  const plan = createTransformPlan(inputs);
  const receipt = await writeUstarArchive({
    entries: plan.entries, sink, signal,
    openContent: createRootfsContentOpener({ base, source, noticeEntries: plan.notices.entries }),
  });
  return { inputs, plan, receipt };
}

function fileSink(handle) {
  return new Writable({
    write(chunk, _encoding, callback) {
      const writeAll = async () => {
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
          if (bytesWritten < 1) throw rootfsError("seaweed_rootfs_materialization_write_failed");
          offset += bytesWritten;
        }
      };
      writeAll().then(() => callback(), callback);
    },
  });
}

async function exactFile(file, expected, uid) {
  const stat = await lstat(file, { bigint: true });
  const observed = identity(stat);
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.uid === BigInt(uid)
    && (stat.mode & 0o777n) === 0o600n && sameIdentity(expected, observed);
}

async function exactOwnedFile(file, expected, uid) {
  const stat = await lstat(file, { bigint: true });
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.uid === BigInt(uid)
    && (stat.mode & 0o777n) === 0o600n && sameOwnedNode(expected, identity(stat));
}

async function scanVerifiedRootfs(file, expectedIdentity, uid, scanRootfs, diffId, signal) {
  const verifyHandle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let input;
  try {
    const before = await verifyHandle.stat({ bigint: true });
    if (!sameIdentity(expectedIdentity, identity(before)) || !await exactFile(file, expectedIdentity, uid)) {
      throw rootfsError("seaweed_rootfs_materialization_output_changed");
    }
    input = verifyHandle.createReadStream({ autoClose: false });
    const scanned = await scanRootfs({ input, diffId, signal });
    const after = await verifyHandle.stat({ bigint: true });
    if (!sameIdentity(expectedIdentity, identity(after)) || !await exactFile(file, expectedIdentity, uid)) {
      throw rootfsError("seaweed_rootfs_materialization_output_changed");
    }
    return scanned;
  } finally {
    input?.destroy();
    if (input !== undefined) await finished(input, { cleanup: true }).catch(() => undefined);
    await verifyHandle.close();
  }
}

function validatedLineage(sourceReceipt, source, recipeRevision, createdAt) {
  const identity = source?.sourceIdentity;
  if (typeof sourceReceipt?.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/u.test(sourceReceipt.repository)
    || !Number.isSafeInteger(sourceReceipt.workflowId) || sourceReceipt.workflowId <= 0
    || !Number.isSafeInteger(sourceReceipt.runId) || sourceReceipt.runId <= 0
    || sourceReceipt.attempt !== 1 || !REVISION.test(sourceReceipt.sourceSha ?? "")
    || identity?.runId !== String(sourceReceipt.runId) || identity?.attempt !== sourceReceipt.attempt
    || identity?.codeRevision !== sourceReceipt.sourceSha || !SHA256_HEX.test(identity?.binary?.sha256 ?? "")
    || !Number.isSafeInteger(identity?.binary?.size) || identity.binary.size <= 0) {
    throw rootfsError("seaweed_rootfs_materialization_lineage_invalid");
  }
  return Object.freeze({ sourceRepository: sourceReceipt.repository, sourceWorkflowId: sourceReceipt.workflowId,
    sourceAttempt: sourceReceipt.attempt, sourceCodeRevision: identity.codeRevision,
    sourceBinaryDigest: `sha256:${identity.binary.sha256}`, sourceBinarySize: identity.binary.size,
    recipeRevision, createdAt });
}

async function publishNoReplace(partialFile, finalFile, expected, uid) {
  await link(partialFile, finalFile).catch((error) => {
    if (error?.code === "EEXIST") throw rootfsError("seaweed_rootfs_materialization_collision");
    throw error;
  });
  try {
    const partial = await lstat(partialFile, { bigint: true }); const final = await lstat(finalFile, { bigint: true });
    if (!partial.isFile() || !final.isFile() || partial.nlink !== 2n || final.nlink !== 2n
      || partial.uid !== BigInt(uid) || final.uid !== BigInt(uid)
      || !sameNode(expected, identity(partial)) || !sameIdentity(identity(partial), identity(final))) {
      throw rootfsError("seaweed_rootfs_materialization_output_changed");
    }
    await unlink(partialFile);
  } catch (error) {
    try {
      const partial = await lstat(partialFile, { bigint: true }); const final = await lstat(finalFile, { bigint: true });
      if (sameNode(identity(partial), identity(final))) await unlink(finalFile);
    } catch { /* Preserve any path that cannot be proved to be our link. */ }
    throw error;
  }
}

async function removeComposite(authority) {
  try {
    const names = (await readdir(authority.parent)).sort();
    if (names.length !== DIRECTORY_NAMES.length || names.some((name, index) => name !== DIRECTORY_NAMES[index])
      || !sameNode(authority.parentIdentity, await privateDirectory(authority.parent, authority.uid))) return false;
    const outputNames = await readdir(authority.outputParent);
    if (outputNames.length !== 1 || outputNames[0] !== FINAL_NAME
      || !sameNode(authority.directoryIdentities.output, await privateDirectory(authority.outputParent, authority.uid))
      || !await exactFile(authority.outputFile, authority.outputIdentity, authority.uid)) return false;
    if ((await readdir(authority.sourceParent)).length !== 1 || (await readdir(authority.baseParent)).length !== 1) return false;
    await authority.cleanupSource(authority.sourceReceipt);
    await authority.cleanupBase(authority.baseReceipt);
    if ((await readdir(authority.sourceParent)).length !== 0 || (await readdir(authority.baseParent)).length !== 0) return false;
    if (!await exactFile(authority.outputFile, authority.outputIdentity, authority.uid)) return false;
    await unlink(authority.outputFile);
    for (const name of ["output", "source", "base"]) {
      const directory = authority[`${name}Parent`];
      if ((await readdir(directory)).length !== 0
        || !sameNode(authority.directoryIdentities[name], await privateDirectory(directory, authority.uid))) return false;
      await rmdir(directory);
    }
    return (await readdir(authority.parent)).length === 0
      && sameNode(authority.parentIdentity, await privateDirectory(authority.parent, authority.uid));
  } catch { return false; }
}

async function cleanFailed({ parent, uid, parentIdentity, directories, directoryIdentities, outputFile, outputNodeIdentity,
  sourceReceipt, baseReceipt, cleanupSource, cleanupBase }) {
  let clean = true;
  try {
    if (outputNodeIdentity !== undefined) {
      if (await exactOwnedFile(outputFile, outputNodeIdentity, uid)) await unlink(outputFile); else clean = false;
    }
    if (sourceReceipt !== undefined) await cleanupSource(sourceReceipt); else if ((await readdir(directories.source)).length !== 0) clean = false;
    if (baseReceipt !== undefined) await cleanupBase(baseReceipt); else if ((await readdir(directories.base)).length !== 0) clean = false;
    for (const name of ["output", "source", "base"]) {
      const directory = directories[name];
      if (directoryIdentities[name] !== undefined && (await readdir(directory)).length === 0
        && sameNode(directoryIdentities[name], await privateDirectory(directory, uid))) await rmdir(directory);
      else clean = false;
    }
    if ((await readdir(parent)).length !== 0 || !sameNode(parentIdentity, await privateDirectory(parent, uid))) clean = false;
  } catch { clean = false; }
  return clean;
}

async function executeMaterialization(options) {
  const { parent, uid, recipeRevision, createdAt, signal, timeoutMs } = options;
  let timedOut = false;
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const operationSignal = signal === undefined ? controller.signal : globalThis.AbortSignal.any([signal, controller.signal]);
  const check = () => {
    if (timedOut) throw rootfsError("seaweed_rootfs_materialization_timeout");
    if (signal?.aborted || operationSignal.aborted) throw rootfsError("seaweed_rootfs_materialization_aborted");
  };
  try { check(); } catch (error) { globalThis.clearTimeout(timer); throw error; }
  const parentIdentity = await privateDirectory(parent, uid).catch((error) => { globalThis.clearTimeout(timer); throw error; });
  const initialNames = await readdir(parent).catch((error) => { globalThis.clearTimeout(timer); throw error; });
  if (initialNames.length !== 0) {
    globalThis.clearTimeout(timer); throw rootfsError("seaweed_rootfs_materialization_parent_not_empty");
  }
  const directories = Object.fromEntries(DIRECTORY_NAMES.map((name) => [name, path.join(parent, name)]));
  const directoryIdentities = {};
  let sourceReceipt; let baseReceipt; let outputIdentity; let outputNodeIdentity; let written; let lineage; let failure;
  const partialFile = path.join(directories.output, PARTIAL_NAME); const finalFile = path.join(directories.output, FINAL_NAME);
  try {
    for (const name of DIRECTORY_NAMES) {
      await mkdir(directories[name], { mode: 0o700 });
      directoryIdentities[name] = await privateDirectory(directories[name], uid);
    }
    sourceReceipt = await options.materializeSource({ parent: directories.source, signal: operationSignal });
    baseReceipt = await options.materializeBase({ parent: directories.base, signal: operationSignal });
    if (!await exactChildClosure(directories.source, sourceReceipt) || !await exactChildClosure(directories.base, baseReceipt)) {
      throw rootfsError("seaweed_rootfs_materialization_child_invalid");
    }
    check();
    const handle = await open(partialFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      await handle.chmod(0o600);
      const descriptor = await handle.stat({ bigint: true });
      const pathname = await lstat(partialFile, { bigint: true });
      if (!descriptor.isFile() || descriptor.nlink !== 1n || descriptor.uid !== BigInt(uid)
        || (descriptor.mode & 0o777n) !== 0o600n || !sameIdentity(identity(descriptor), identity(pathname))) {
        throw rootfsError("seaweed_rootfs_materialization_output_invalid");
      }
      outputNodeIdentity = identity(descriptor); outputIdentity = outputNodeIdentity;
      written = await options.withSource(sourceReceipt, (source) => {
        lineage = validatedLineage(sourceReceipt, source, recipeRevision, createdAt);
        return options.withBase(baseReceipt, (base) => options.writeRootfs({
          base, source, recipeRevision, createdAt, sink: fileSink(handle), signal: operationSignal,
        }));
      });
      check();
      if (written?.inputs?.source?.runId !== String(sourceReceipt.runId)
        || written.inputs.source.attempt !== lineage.sourceAttempt
        || written.inputs.source.codeRevision !== lineage.sourceCodeRevision
        || written.inputs.source.binary?.sha256 !== lineage.sourceBinaryDigest.slice("sha256:".length)
        || written.inputs.source.binary?.size !== lineage.sourceBinarySize
        || written.inputs.source.recipeRevision !== recipeRevision || written.inputs.source.createdAt !== createdAt) {
        throw rootfsError("seaweed_rootfs_materialization_lineage_invalid");
      }
      await handle.sync();
      const syncedDescriptor = await handle.stat({ bigint: true });
      const syncedPathname = await lstat(partialFile, { bigint: true });
      if (!syncedDescriptor.isFile() || syncedDescriptor.nlink !== 1n || syncedDescriptor.uid !== BigInt(uid)
        || (syncedDescriptor.mode & 0o777n) !== 0o600n || !sameIdentity(identity(syncedDescriptor), identity(syncedPathname))) {
        throw rootfsError("seaweed_rootfs_materialization_output_invalid");
      }
      outputIdentity = identity(syncedDescriptor);
    } finally { await handle.close(); }
    const scannedPartial = await scanVerifiedRootfs(partialFile, outputIdentity, uid, options.scanRootfs, written.receipt.diffId, operationSignal);
    check();
    const partialMatch = options.validateFilesystem(scannedPartial.members.map(({ entry }) => entry), written.inputs);
    if (partialMatch?.kind !== "SEAWEED_INVENTORY_PLAN_MATCH_V1" || partialMatch.entries !== written.plan.entries.length
      || scannedPartial.rawSize !== written.receipt.rawSize || scannedPartial.diffId !== written.receipt.diffId
      || scannedPartial.members.length !== written.receipt.memberCount) {
      throw rootfsError("seaweed_rootfs_materialization_verification_failed");
    }
    if ((await readdir(directories.output)).length !== 1 || (await readdir(directories.output))[0] !== PARTIAL_NAME) {
      throw rootfsError("seaweed_rootfs_materialization_collision");
    }
    await options.beforeRename?.({ parent, partialFile, finalFile });
    if ((await readdir(directories.output)).length !== 1 || (await readdir(directories.output))[0] !== PARTIAL_NAME
      || !await exactFile(partialFile, outputIdentity, uid)) throw rootfsError("seaweed_rootfs_materialization_collision");
    await publishNoReplace(partialFile, finalFile, outputIdentity, uid);
    outputIdentity = identity(await lstat(finalFile, { bigint: true }));
    if (!await exactFile(finalFile, outputIdentity, uid)) throw rootfsError("seaweed_rootfs_materialization_output_changed");
    const scanned = await scanVerifiedRootfs(finalFile, outputIdentity, uid, options.scanRootfs, written.receipt.diffId, operationSignal);
    check();
    if (scanned.rawSize !== scannedPartial.rawSize || scanned.diffId !== scannedPartial.diffId
      || scanned.members.length !== scannedPartial.members.length) {
      throw rootfsError("seaweed_rootfs_materialization_verification_failed");
    }
    const parentNames = (await readdir(parent)).sort();
    const outputNames = await readdir(directories.output);
    if (parentNames.length !== DIRECTORY_NAMES.length || parentNames.some((name, index) => name !== DIRECTORY_NAMES[index])
      || outputNames.length !== 1 || outputNames[0] !== FINAL_NAME
      || !sameNode(parentIdentity, await privateDirectory(parent, uid))
      || !sameNode(directoryIdentities.source, await privateDirectory(directories.source, uid))
      || !sameNode(directoryIdentities.base, await privateDirectory(directories.base, uid))
      || !sameNode(directoryIdentities.output, await privateDirectory(directories.output, uid))
      || !await exactChildClosure(directories.source, sourceReceipt)
      || !await exactChildClosure(directories.base, baseReceipt)) {
      throw rootfsError("seaweed_rootfs_materialization_collision");
    }
    check();
    const baseManifest = written.inputs.baseMaterials.get("base-manifest.json");
    const receipt = Object.freeze({ kind: "SEAWEED_ROOTFS_MATERIALIZATION_RECEIPT_V1", state: "MATERIALIZED",
      authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", rawSize: scanned.rawSize,
      diffId: scanned.diffId, memberCount: scanned.members.length, sourceRunId: written.inputs.source.runId,
      baseManifestDigest: `sha256:${createHash("sha256").update(baseManifest).digest("hex")}`, ...lineage });
    RECEIPT_AUTHORITIES.set(receipt, { parent, uid, parentIdentity, sourceParent: directories.source, baseParent: directories.base,
      outputParent: directories.output, outputFile: finalFile, outputIdentity, directoryIdentities,
      sourceReceipt, baseReceipt, cleanupSource: options.cleanupSource, cleanupBase: options.cleanupBase, cleaning: false });
    globalThis.clearTimeout(timer);
    return receipt;
  } catch (error) { failure = error; }
  let failedOutput = partialFile;
  if (outputNodeIdentity !== undefined && await exactOwnedFile(finalFile, outputNodeIdentity, uid).catch(() => false)) failedOutput = finalFile;
  const clean = await cleanFailed({ parent, uid, parentIdentity, directories, directoryIdentities, outputFile: failedOutput,
    outputNodeIdentity, sourceReceipt, baseReceipt,
  cleanupSource: options.cleanupSource, cleanupBase: options.cleanupBase });
  globalThis.clearTimeout(timer);
  if (!clean) throw rootfsError("seaweed_rootfs_materialization_cleanup_failed", { originalCode: failure?.code });
  if (timedOut) throw rootfsError("seaweed_rootfs_materialization_timeout", { originalCode: failure?.code });
  if (signal?.aborted || operationSignal.aborted || failure?.name === "AbortError") {
    throw rootfsError("seaweed_rootfs_materialization_aborted", { originalCode: failure?.code });
  }
  if (typeof failure?.code === "string" && failure.code.startsWith("seaweed_")) throw failure;
  throw rootfsError("seaweed_rootfs_materialization_failed");
}

export async function materializeReviewedSeaweedRootfs(input) { return executeMaterialization(snapshotOptions(input, false)); }
export async function TEST_ONLY_materializeReviewedSeaweedRootfs(input) { return executeMaterialization(snapshotOptions(input, true)); }

export async function cleanupMaterializedSeaweedRootfs(receipt) {
  const authority = RECEIPT_AUTHORITIES.get(receipt);
  if (authority === undefined || authority.cleaning) throw rootfsError("seaweed_rootfs_materialization_cleanup_unauthorized");
  authority.cleaning = true;
  try {
    if (!await removeComposite(authority)) throw rootfsError("seaweed_rootfs_materialization_cleanup_failed");
    RECEIPT_AUTHORITIES.delete(receipt);
    return Object.freeze({ state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" });
  } finally { authority.cleaning = false; }
}
