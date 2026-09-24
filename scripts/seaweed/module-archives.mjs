import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, realpathSync, unlinkSync, writeSync,
} from "node:fs";
import path from "node:path";

const MAX_ARCHIVE_BYTES = 256 * 1024 ** 2;
const BUFFER_BYTES = 1024 ** 2;
const MODULE_DIRECTORY = /^[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function trustedDirectory(directory, errorCode) {
  const resolved = path.resolve(directory);
  try {
    const info = lstatSync(resolved, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved) !== resolved) throw new Error(errorCode);
    return { path: resolved, info };
  } catch (error) {
    if (error?.message === errorCode) throw error;
    throw new Error(errorCode, { cause: error });
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.nlink === right.nlink && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function snapshotIdentity(info) {
  return {
    device: info.dev.toString(), inode: info.ino.toString(),
    mtimeNs: info.mtimeNs.toString(), ctimeNs: info.ctimeNs.toString(),
  };
}

function matchesSnapshot(info, snapshot) {
  return info.dev.toString() === snapshot.device && info.ino.toString() === snapshot.inode
    && info.size === BigInt(snapshot.size) && info.mtimeNs.toString() === snapshot.mtimeNs
    && info.ctimeNs.toString() === snapshot.ctimeNs;
}

function requireRegular(info, errorCode) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.size < 1n || info.size > BigInt(MAX_ARCHIVE_BYTES)) {
    throw new Error(errorCode);
  }
}

function validateDescendant(file, root, errorCode) {
  const relative = path.relative(root, file);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) throw new Error(errorCode);
}

function validateParents(parent, root, rootInfo, errorCode) {
  if (parent === root) return;
  validateDescendant(parent, root, errorCode);
  let current = root;
  for (const part of path.relative(root, parent).split(path.sep)) {
    current = path.join(current, part);
    const entry = trustedDirectory(current, errorCode);
    if (entry.info.dev !== rootInfo.dev) throw new Error(errorCode);
  }
}

function sourceBoundary(sourceFile, cacheRoot) {
  if (typeof sourceFile !== "string" || typeof cacheRoot !== "string" || !path.isAbsolute(sourceFile) || !path.isAbsolute(cacheRoot)) {
    throw new Error("seaweed_module_archive_source_invalid");
  }
  const cache = trustedDirectory(cacheRoot, "seaweed_module_archive_source_invalid");
  const download = trustedDirectory(path.join(cache.path, "cache", "download"), "seaweed_module_archive_source_invalid");
  if (download.info.dev !== cache.info.dev) throw new Error("seaweed_module_archive_source_invalid");
  const source = path.resolve(sourceFile);
  if (source !== sourceFile) throw new Error("seaweed_module_archive_source_invalid");
  validateDescendant(source, download.path, "seaweed_module_archive_source_invalid");
  validateParents(path.dirname(source), download.path, download.info, "seaweed_module_archive_source_invalid");
  return source;
}

function openSource(source, expected) {
  let before;
  try { before = lstatSync(source, { bigint: true }); }
  catch (error) { throw new Error("seaweed_module_archive_source_invalid", { cause: error }); }
  requireRegular(before, "seaweed_module_archive_source_invalid");
  if (realpathSync(source) !== source || (expected && !matchesSnapshot(before, expected))) {
    throw new Error(expected ? "seaweed_module_archive_source_changed" : "seaweed_module_archive_source_invalid");
  }
  let descriptor;
  try { descriptor = openSync(source, constants.O_RDONLY | NOFOLLOW); }
  catch (error) { throw new Error("seaweed_module_archive_source_invalid", { cause: error }); }
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    requireRegular(opened, "seaweed_module_archive_source_invalid");
    if (!sameIdentity(before, opened) || (expected && !matchesSnapshot(opened, expected))) {
      throw new Error(expected ? "seaweed_module_archive_source_changed" : "seaweed_module_archive_source_invalid");
    }
    return { descriptor, identity: opened, size: Number(opened.size) };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function readFingerprint(descriptor, expectedSize, onChunk) {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(Math.min(BUFFER_BYTES, expectedSize));
  let position = 0;
  while (position < expectedSize) {
    const wanted = Math.min(buffer.length, expectedSize - position);
    const count = readSync(descriptor, buffer, 0, wanted, position);
    if (count === 0) throw new Error("seaweed_module_archive_source_changed");
    const chunk = buffer.subarray(0, count);
    hash.update(chunk);
    if (onChunk) onChunk(chunk);
    position += count;
  }
  if (readSync(descriptor, Buffer.alloc(1), 0, 1, expectedSize) !== 0) throw new Error("seaweed_module_archive_source_changed");
  return { sha256: hash.digest("hex"), size: position };
}

function checkedFingerprint(source, entry, expected) {
  const fingerprint = readFingerprint(entry.descriptor, entry.size);
  const after = fstatSync(entry.descriptor, { bigint: true });
  const linked = lstatSync(source, { bigint: true });
  requireRegular(linked, "seaweed_module_archive_source_changed");
  if (!sameIdentity(entry.identity, after) || !sameIdentity(after, linked) || realpathSync(source) !== source) {
    throw new Error("seaweed_module_archive_source_changed");
  }
  if (expected && (fingerprint.sha256 !== expected.sha256 || fingerprint.size !== expected.size)) {
    throw new Error("seaweed_module_archive_source_changed");
  }
  return fingerprint;
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || typeof snapshot.sourceFile !== "string"
    || !SHA256.test(snapshot.sha256) || !Number.isSafeInteger(snapshot.size) || snapshot.size < 1 || snapshot.size > MAX_ARCHIVE_BYTES
    || !DECIMAL.test(snapshot.device) || !DECIMAL.test(snapshot.inode) || !DECIMAL.test(snapshot.mtimeNs) || !DECIMAL.test(snapshot.ctimeNs)) {
    throw new Error("seaweed_module_archive_snapshot_invalid");
  }
}

function destinationBoundary(destination, archiveRoot) {
  if (typeof destination !== "string" || typeof archiveRoot !== "string" || !path.isAbsolute(destination) || !path.isAbsolute(archiveRoot)) {
    throw new Error("seaweed_module_archive_destination_invalid");
  }
  const archive = trustedDirectory(archiveRoot, "seaweed_module_archive_destination_invalid");
  const resolved = path.resolve(destination);
  const parent = path.dirname(resolved);
  if (resolved !== destination || path.basename(resolved) !== "source.zip" || path.dirname(parent) !== archive.path
    || !MODULE_DIRECTORY.test(path.basename(parent))) throw new Error("seaweed_module_archive_destination_invalid");
  const target = trustedDirectory(parent, "seaweed_module_archive_destination_invalid");
  if (target.info.dev !== archive.info.dev) throw new Error("seaweed_module_archive_destination_invalid");
  return resolved;
}

function writeAll(descriptor, chunk, position) {
  let offset = 0;
  while (offset < chunk.length) {
    const count = writeSync(descriptor, chunk, offset, chunk.length - offset, position + offset);
    if (count === 0) throw new Error("seaweed_module_archive_copy_invalid");
    offset += count;
  }
}

function removeCreatedDestination(destination, archiveRoot, identity) {
  try {
    destinationBoundary(destination, archiveRoot);
    const current = lstatSync(destination, { bigint: true });
    if (current.isFile() && !current.isSymbolicLink() && current.nlink === 1n
      && current.dev === identity.dev && current.ino === identity.ino) unlinkSync(destination);
  } catch { return; }
}

export function snapshotModuleArchive(sourceFile, { cacheRoot, groupAbsent } = {}) {
  if (groupAbsent !== true) throw new Error("seaweed_module_archive_group_not_absent");
  const source = sourceBoundary(sourceFile, cacheRoot);
  const entry = openSource(source);
  try {
    const fingerprint = checkedFingerprint(source, entry);
    return { sourceFile: source, ...fingerprint, ...snapshotIdentity(entry.identity) };
  } finally {
    closeSync(entry.descriptor);
  }
}

export function retainModuleArchive(snapshot, destination, { cacheRoot, archiveRoot, groupAbsent } = {}) {
  if (groupAbsent !== true) throw new Error("seaweed_module_archive_group_not_absent");
  validateSnapshot(snapshot);
  const source = sourceBoundary(snapshot.sourceFile, cacheRoot);
  const target = destinationBoundary(destination, archiveRoot);
  const sourceEntry = openSource(source, snapshot);
  let destinationDescriptor;
  let destinationIdentity;
  try {
    checkedFingerprint(source, sourceEntry, snapshot);
    try {
      destinationDescriptor = openSync(target, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error("seaweed_module_archive_collision", { cause: error });
      throw error;
    }
    destinationIdentity = fstatSync(destinationDescriptor, { bigint: true });
    if (!destinationIdentity.isFile() || destinationIdentity.isSymbolicLink() || destinationIdentity.nlink !== 1n || destinationIdentity.size !== 0n) {
      throw new Error("seaweed_module_archive_copy_invalid");
    }
    const created = lstatSync(target, { bigint: true });
    if (!sameIdentity(destinationIdentity, created) || realpathSync(target) !== target) throw new Error("seaweed_module_archive_copy_invalid");
    let writePosition = 0;
    const copied = readFingerprint(sourceEntry.descriptor, sourceEntry.size, (chunk) => {
      writeAll(destinationDescriptor, chunk, writePosition);
      writePosition += chunk.length;
    });
    if (copied.sha256 !== snapshot.sha256 || copied.size !== snapshot.size || writePosition !== snapshot.size) {
      throw new Error("seaweed_module_archive_source_changed");
    }
    fsyncSync(destinationDescriptor);
    const written = fstatSync(destinationDescriptor, { bigint: true });
    if (written.dev !== destinationIdentity.dev || written.ino !== destinationIdentity.ino || written.nlink !== 1n
      || written.size !== BigInt(snapshot.size)) throw new Error("seaweed_module_archive_copy_invalid");
    const retained = readFingerprint(destinationDescriptor, snapshot.size);
    if (retained.sha256 !== snapshot.sha256 || retained.size !== snapshot.size) throw new Error("seaweed_module_archive_copy_invalid");
    checkedFingerprint(source, sourceEntry, snapshot);
    sourceBoundary(source, cacheRoot);
    destinationBoundary(target, archiveRoot);
    const retainedOpened = fstatSync(destinationDescriptor, { bigint: true });
    const linked = lstatSync(target, { bigint: true });
    if (!linked.isFile() || linked.isSymbolicLink() || linked.nlink !== 1n || !sameIdentity(written, retainedOpened) || !sameIdentity(retainedOpened, linked)
      || realpathSync(target) !== target) throw new Error("seaweed_module_archive_copy_invalid");
    return retained;
  } catch (error) {
    if (destinationDescriptor !== undefined) { closeSync(destinationDescriptor); destinationDescriptor = undefined; }
    if (destinationIdentity) removeCreatedDestination(target, archiveRoot, destinationIdentity);
    throw error;
  } finally {
    if (destinationDescriptor !== undefined) closeSync(destinationDescriptor);
    closeSync(sourceEntry.descriptor);
  }
}

export const moduleArchiveLimits = Object.freeze({ sourceBytes: MAX_ARCHIVE_BYTES });
