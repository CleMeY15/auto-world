import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { scanPinnedBase } from "./base-scan.mjs";
import { fetchPinnedBaseManifest, streamPinnedBaseBlob } from "./registry-base.mjs";

const DEFAULT_TIMEOUT_MS = 45 * 60_000;
const MAX_TIMEOUT_MS = 60 * 60_000;
const MAX_REGISTRY_CALL_MS = 30 * 60_000;
const STAGING_NAME = ".seaweed-base-materialization-staging";
const OUTPUT_NAME = "seaweed-base-materialized";
const POLICY_ROOT = fileURLToPath(new URL("../../infra/seaweed-image/", import.meta.url));
const POLICY_NAMES = Object.freeze(["base-manifest.json", "base-config.json", "base-filesystem.json"]);
const CLEANUP_AUTHORITIES = new WeakMap();
const MAX_RAW_BYTES = 2 * 1024 ** 3;
const MAX_ENTRY_READ_BYTES = 256 * 1024 ** 2;

function failure(code, details = {}) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", stage: "BASE_MATERIALIZATION",
    authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", ...details });
}

function lowerCode(error) {
  for (const value of [error?.code, error?.message]) {
    if (typeof value === "string" && /^seaweed_[a-z0-9_]+$/u.test(value)) return value;
  }
  return undefined;
}

function exactDescriptor(left, right) {
  return left?.mediaType === right?.mediaType && left?.digest === right?.digest && left?.size === right?.size;
}

function exactRemoteDescriptors(remote, manifest) {
  return exactDescriptor(remote?.config, manifest?.config) && Array.isArray(remote?.layers)
    && remote.layers.length === 10 && Array.isArray(manifest?.layers) && manifest.layers.length === 10
    && remote.layers.every((descriptor, index) => exactDescriptor(descriptor, manifest.layers[index])
      && /^sha256:[a-f0-9]{64}$/u.test(descriptor.digest) && Number.isSafeInteger(descriptor.size) && descriptor.size > 0);
}

function identity(stat) {
  return Object.freeze({ dev: stat.dev.toString(), ino: stat.ino.toString(), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString() });
}

function sameIdentity(left, right) { return Object.keys(left).every((key) => left[key] === right[key]); }
function sameNode(left, right) { return ["dev", "ino", "uid", "gid", "mode"].every((key) => left[key] === right[key]); }
function sameOwnedNode(left, right) { return sameNode(left, right) && left.nlink === right.nlink; }

function detachedFrozen(value) {
  if (value === null || typeof value !== "object") return value;
  const copy = Array.isArray(value) ? value.map(detachedFrozen)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detachedFrozen(item)]));
  return Object.freeze(copy);
}

async function privateDirectory(directory, uid) {
  const stat = await lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(uid)
    || (stat.mode & 0o777n) !== 0o700n || await realpath(directory) !== directory) {
    throw failure("seaweed_base_materialization_parent_invalid");
  }
  return identity(stat);
}

async function snapshotTree(root, uid) {
  const records = new Map();
  const walk = async (directory, relative = "") => {
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const absolute = path.join(directory, name); const child = path.join(relative, name);
      const stat = await lstat(absolute, { bigint: true });
      if (stat.isSymbolicLink() || stat.uid !== BigInt(uid) || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1n))) {
        throw failure("seaweed_base_materialization_ownership_invalid");
      }
      records.set(child, Object.freeze({ type: stat.isDirectory() ? "directory" : "file", identity: identity(stat) }));
      if (stat.isDirectory()) await walk(absolute, child);
    }
  };
  const rootStat = await lstat(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== BigInt(uid) || await realpath(root) !== root) {
    throw failure("seaweed_base_materialization_ownership_invalid");
  }
  records.set("", Object.freeze({ type: "directory", identity: identity(rootStat) }));
  await walk(root);
  return records;
}

function sameRecord(left, right) {
  return left?.type === right?.type && (left.nodeOnly === true ? sameOwnedNode(left.identity, right.identity) : left.type === "directory"
    ? sameNode(left.identity, right.identity) : sameIdentity(left.identity, right.identity));
}

async function removeVerifiedTree(root, parent, uid, expected) {
  const parentBefore = await privateDirectory(parent, uid);
  if (path.dirname(root) !== parent || ![path.join(parent, STAGING_NAME), path.join(parent, OUTPUT_NAME)].includes(root)) return false;
  const parentNames = await readdir(parent);
  if (parentNames.length !== 1 || parentNames[0] !== path.basename(root)) return false;
  let observed;
  try { observed = await snapshotTree(root, uid); } catch { return false; }
  if (!(expected instanceof Map) || observed.size !== expected.size) return false;
  for (const [name, record] of expected) if (!sameRecord(record, observed.get(name))) return false;
  const names = [...observed.keys()].filter(Boolean)
    .sort((left, right) => right.split(path.sep).length - left.split(path.sep).length || right.localeCompare(left));
  try {
    for (const name of names) {
      const target = path.join(root, name); const stat = await lstat(target, { bigint: true });
      const current = Object.freeze({ type: stat.isDirectory() && !stat.isSymbolicLink() ? "directory" : "file", identity: identity(stat) });
      if (!sameRecord(expected.get(name), current)) return false;
      if (stat.isDirectory() && !stat.isSymbolicLink()) await rmdir(target); else await unlink(target);
    }
    const rootStat = await lstat(root, { bigint: true });
    if (!sameRecord(expected.get(""), Object.freeze({ type: "directory", identity: identity(rootStat) }))) return false;
    await rmdir(root);
  } catch { return false; }
  return sameNode(parentBefore, identity(await lstat(parent, { bigint: true }))) && (await readdir(parent)).length === 0;
}

async function exclusiveFile(file, uid, write, owned, staging) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.chmod(0o600);
    const createdDescriptor = await handle.stat({ bigint: true });
    const createdPathname = await lstat(file, { bigint: true });
    if (!createdDescriptor.isFile() || createdDescriptor.nlink !== 1n || createdDescriptor.uid !== BigInt(uid)
      || (createdDescriptor.mode & 0o777n) !== 0o600n || !sameIdentity(identity(createdDescriptor), identity(createdPathname))) {
      throw failure("seaweed_base_materialization_output_invalid");
    }
    owned.set(path.relative(staging, file), Object.freeze({ type: "file", nodeOnly: true, identity: identity(createdDescriptor) }));
    const value = await write(handle);
    await handle.sync();
    const descriptor = await handle.stat({ bigint: true });
    const pathname = await lstat(file, { bigint: true });
    if (!descriptor.isFile() || descriptor.nlink !== 1n || descriptor.uid !== BigInt(uid)
      || (descriptor.mode & 0o777n) !== 0o600n || !sameIdentity(identity(descriptor), identity(pathname))) {
      throw failure("seaweed_base_materialization_output_invalid");
    }
    owned.set(path.relative(staging, file), Object.freeze({ type: "file", identity: identity(descriptor) }));
    return value;
  } finally { await handle.close(); }
}

async function writeBytes(file, bytes, uid, owned, staging) {
  return exclusiveFile(file, uid, async (handle) => {
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.write(bytes, offset, bytes.length - offset, offset);
      if (result.bytesWritten < 1) throw failure("seaweed_base_materialization_output_invalid");
      offset += result.bytesWritten;
    }
  }, owned, staging);
}

async function downloadBlob({ descriptor, file, stream, signal, timeoutMs, uid, owned, staging }) {
  return exclusiveFile(file, uid, async (handle) => {
    const receipt = await stream({ descriptor, sink: handle, signal, timeoutMs });
    if (receipt?.size !== descriptor.size || receipt?.digest !== descriptor.digest || receipt?.mediaType !== descriptor.mediaType
      || receipt?.authority !== "PINNED_BASE_ONLY" || receipt?.candidateAuthorization !== "NOT_AUTHORIZED") {
      throw failure("seaweed_base_materialization_blob_invalid");
    }
  }, owned, staging);
}

async function decompressLayer({ compressed, raw, diffId, uid, remainingRaw, owned, staging, signal }) {
  let size = 0; const hash = createHash("sha256");
  await exclusiveFile(raw, uid, async (handle) => {
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > remainingRaw) { callback(failure("seaweed_base_materialization_raw_limit")); return; }
        hash.update(chunk); callback(null, chunk);
      },
    });
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        const writeAll = async () => {
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
            if (bytesWritten < 1) throw failure("seaweed_base_materialization_output_invalid");
            offset += bytesWritten;
          }
        };
        writeAll().then(() => callback(), callback);
      },
    });
    await pipeline(createReadStream(compressed, { signal }), createGunzip(), counter, sink, { signal });
  }, owned, staging);
  if (`sha256:${hash.digest("hex")}` !== diffId) throw failure("seaweed_base_materialization_diffid_invalid");
  return size;
}

function tarString(block, start, length) {
  const bytes = block.subarray(start, start + length); const zero = bytes.indexOf(0);
  return bytes.subarray(0, zero < 0 ? bytes.length : zero).toString("utf8");
}

function tarOctal(block, start, length) {
  const value = tarString(block, start, length).trim();
  if (!/^[0-7]+$/u.test(value)) throw failure("seaweed_base_materialization_reference_invalid");
  return Number.parseInt(value, 8);
}

async function validateReference(handle, reference, rawSize, signal) {
  const { entry, uncompressedHeaderOffset, uncompressedDataOffset } = reference;
  if (!Number.isSafeInteger(uncompressedHeaderOffset) || !Number.isSafeInteger(uncompressedDataOffset)
    || uncompressedHeaderOffset < 0 || uncompressedDataOffset !== uncompressedHeaderOffset + 512
    || uncompressedDataOffset + entry.size > rawSize) throw failure("seaweed_base_materialization_reference_invalid");
  const header = Buffer.alloc(512); const read = await handle.read(header, 0, 512, uncompressedHeaderOffset);
  if (read.bytesRead !== 512) throw failure("seaweed_base_materialization_reference_invalid");
  const name = tarString(header, 0, 100); const prefix = tarString(header, 345, 155);
  const observedPath = (prefix ? `${prefix}/${name}` : name).replace(/\/$/u, "");
  const typeFlag = String.fromCharCode(header[156]);
  const observedType = typeFlag === "0" ? "file" : typeFlag === "2" ? "symlink" : typeFlag === "5" ? "directory" : "invalid";
  if (observedPath !== entry.path || observedType !== entry.type || tarOctal(header, 100, 8) !== entry.mode
    || tarOctal(header, 108, 8) !== entry.uid || tarOctal(header, 116, 8) !== entry.gid
    || tarOctal(header, 124, 12) !== entry.size || tarOctal(header, 136, 12) !== entry.mtime
    || (entry.type === "symlink" && tarString(header, 157, 100) !== entry.linkname)) {
    throw failure("seaweed_base_materialization_reference_invalid");
  }
  if (entry.type === "file") {
    const hash = createHash("sha256"); const chunk = Buffer.alloc(Math.min(1024 ** 2, Math.max(1, entry.size)));
    let offset = 0;
    while (offset < entry.size) {
      if (signal?.aborted) throw failure("seaweed_base_materialization_aborted");
      const length = Math.min(chunk.length, entry.size - offset);
      const body = await handle.read(chunk, 0, length, uncompressedDataOffset + offset);
      if (body.bytesRead < 1) throw failure("seaweed_base_materialization_reference_invalid");
      hash.update(chunk.subarray(0, body.bytesRead)); offset += body.bytesRead;
    }
    if (hash.digest("hex") !== entry.sha256) throw failure("seaweed_base_materialization_reference_invalid");
  }
}

async function validateWinningReferences(index, rawFiles, signal) {
  const handles = [];
  try {
    for (const file of rawFiles) handles.push(await open(file, constants.O_RDONLY | constants.O_NOFOLLOW));
    const sizes = await Promise.all(handles.map(async (handle) => Number((await handle.stat({ bigint: true })).size)));
    for (const reference of index.members) await validateReference(handles[reference.layerIndex], reference, sizes[reference.layerIndex], signal);
  } finally { await Promise.allSettled(handles.map((handle) => handle.close())); }
}

async function hashFile(file, signal) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n) throw failure("seaweed_base_materialization_identity_invalid");
    const hash = createHash("sha256"); const buffer = Buffer.alloc(1024 ** 2); let offset = 0;
    while (offset < Number(stat.size)) {
      if (signal?.aborted) throw failure("seaweed_base_materialization_aborted");
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(stat.size) - offset), offset);
      if (bytesRead < 1) throw failure("seaweed_base_materialization_identity_invalid");
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    return { size: Number(stat.size), digest: `sha256:${hash.digest("hex")}` };
  } finally { await handle.close(); }
}

function exactEntryPath(value) {
  return typeof value === "string"
    && /^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))(?!.*\\)(?!.*\/\/)[\x21-\x7e]+(?<!\/)$/u.test(value);
}

async function verifyBorrowPath(authority, rawFile, expectedRaw) {
  const parent = await privateDirectory(authority.parent, authority.uid);
  const output = await lstat(authority.outputPath, { bigint: true });
  const layers = await lstat(path.join(authority.outputPath, "layers"), { bigint: true });
  const raw = await lstat(rawFile, { bigint: true });
  if (!sameNode(authority.parentIdentity, parent)
    || !sameRecord(authority.snapshot.get(""), Object.freeze({ type: "directory", identity: identity(output) }))
    || !sameRecord(authority.snapshot.get("layers"), Object.freeze({ type: "directory", identity: identity(layers) }))
    || !sameRecord(expectedRaw, Object.freeze({ type: "file", identity: identity(raw) }))) {
    throw failure("seaweed_base_materialization_read_substituted");
  }
}

async function readBorrowedEntry(authority, reference, active) {
  if (!active()) throw failure("seaweed_base_materialization_read_expired");
  if (reference.entry.type !== "file") throw failure("seaweed_base_materialization_read_not_file");
  if (!Number.isSafeInteger(reference.entry.size) || reference.entry.size < 0
    || reference.entry.size > MAX_ENTRY_READ_BYTES) throw failure("seaweed_base_materialization_read_limit");
  const rawFile = authority.rawFiles[reference.layerIndex];
  if (typeof rawFile !== "string") throw failure("seaweed_base_materialization_read_substituted");
  const relative = path.relative(authority.outputPath, rawFile);
  const expectedRaw = authority.snapshot.get(relative);
  if (expectedRaw?.type !== "file") throw failure("seaweed_base_materialization_read_substituted");
  await verifyBorrowPath(authority, rawFile, expectedRaw);
  const handle = await open(rawFile, constants.O_RDONLY | constants.O_NOFOLLOW)
    .catch(() => { throw failure("seaweed_base_materialization_read_substituted"); });
  try {
    const descriptor = await handle.stat({ bigint: true });
    const pathname = await lstat(rawFile, { bigint: true });
    if (!sameRecord(expectedRaw, Object.freeze({ type: "file", identity: identity(descriptor) }))
      || !sameIdentity(identity(descriptor), identity(pathname))) {
      throw failure("seaweed_base_materialization_read_substituted");
    }
    await validateReference(handle, reference, Number(descriptor.size));
    if (!active()) throw failure("seaweed_base_materialization_read_expired");
    const bytes = Buffer.alloc(reference.entry.size); let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, reference.uncompressedDataOffset + offset);
      if (bytesRead < 1) throw failure("seaweed_base_materialization_reference_invalid");
      offset += bytesRead;
    }
    const afterDescriptor = await handle.stat({ bigint: true });
    const afterPathname = await lstat(rawFile, { bigint: true });
    if (!active()) throw failure("seaweed_base_materialization_read_expired");
    if (!sameRecord(expectedRaw, Object.freeze({ type: "file", identity: identity(afterDescriptor) }))
      || !sameIdentity(identity(afterDescriptor), identity(afterPathname))) {
      throw failure("seaweed_base_materialization_read_substituted");
    }
    await verifyBorrowPath(authority, rawFile, expectedRaw);
    if (createHash("sha256").update(bytes).digest("hex") !== reference.entry.sha256) {
      throw failure("seaweed_base_materialization_reference_invalid");
    }
    return bytes;
  } finally { await handle.close(); }
}

function settings(input, testOnly) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw failure("seaweed_base_materialization_options_invalid");
  const fields = Object.getOwnPropertyDescriptors(input);
  const permitted = new Set(["parent", "signal", "timeoutMs", ...(testOnly ? ["fetch", "stream", "scan", "platform", "uid", "now", "beforeRename", "afterRename"] : [])]);
  if (Reflect.ownKeys(fields).some((key) => !permitted.has(key) || !("value" in fields[key]))) throw failure("seaweed_base_materialization_options_invalid");
  const value = (key) => fields[key]?.value;
  const result = { parent: value("parent"), signal: value("signal"), timeoutMs: value("timeoutMs") ?? DEFAULT_TIMEOUT_MS,
    fetch: value("fetch") ?? fetchPinnedBaseManifest, stream: value("stream") ?? streamPinnedBaseBlob,
    scan: value("scan") ?? scanPinnedBase,
    platform: value("platform") ?? process.platform, uid: value("uid") ?? process.getuid?.(), now: value("now") ?? Date.now,
    beforeRename: value("beforeRename"), afterRename: value("afterRename") };
  if (typeof result.parent !== "string" || !path.isAbsolute(result.parent) || path.normalize(result.parent) !== result.parent
    || result.signal !== undefined && !(result.signal instanceof globalThis.AbortSignal)
    || !Number.isSafeInteger(result.timeoutMs) || result.timeoutMs <= 0 || result.timeoutMs > MAX_TIMEOUT_MS
    || result.platform !== "linux" || !Number.isSafeInteger(result.uid) || result.uid < 0
    || typeof result.fetch !== "function" || typeof result.stream !== "function" || typeof result.scan !== "function" || typeof result.now !== "function"
    || result.beforeRename !== undefined && typeof result.beforeRename !== "function"
    || result.afterRename !== undefined && typeof result.afterRename !== "function") throw failure("seaweed_base_materialization_options_invalid");
  return Object.freeze(result);
}

async function readPolicy() {
  return new Map(await Promise.all(POLICY_NAMES.map(async (name) => [name, await readFile(path.join(POLICY_ROOT, name))])));
}

function sameFetch(left, right) {
  return Buffer.isBuffer(right?.bytes) && left.digest === right.digest && left.mediaType === right.mediaType
    && left.bytes.equals(right.bytes) && exactDescriptor(left.config, right.config)
    && Array.isArray(right.layers) && left.layers.length === right.layers.length
    && left.layers.every((descriptor, index) => exactDescriptor(descriptor, right.layers[index]));
}

async function execute(options) {
  const { parent, uid, fetch, stream, scan, signal, timeoutMs, now, beforeRename, afterRename } = options;
  const started = now(); const deadline = started + timeoutMs; let timedOut = false;
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs); timer.unref?.();
  const operationSignal = signal === undefined ? controller.signal : globalThis.AbortSignal.any([signal, controller.signal]);
  const remaining = () => Math.floor(deadline - now());
  const registryTimeout = () => Math.min(MAX_REGISTRY_CALL_MS, remaining());
  const check = () => {
    if (timedOut || remaining() <= 0) throw failure("seaweed_base_materialization_timeout");
    if (signal?.aborted || operationSignal.aborted) throw failure("seaweed_base_materialization_aborted");
  };
  const staging = path.join(parent, STAGING_NAME); const outputPath = path.join(parent, OUTPUT_NAME);
  let stagingCreated = false; let outputCreated = false; let parentIdentity; let stagingIdentity; let cleanupSnapshot; let result; let thrown;
  const owned = new Map();
  try {
    check(); parentIdentity = await privateDirectory(parent, uid);
    if ((await readdir(parent)).length !== 0) throw failure("seaweed_base_materialization_parent_not_empty");
    await mkdir(staging, { mode: 0o700 }); stagingCreated = true;
    stagingIdentity = identity(await lstat(staging, { bigint: true }));
    await mkdir(path.join(staging, "blobs"), { mode: 0o700 });
    owned.set("blobs", Object.freeze({ type: "directory", identity: identity(await lstat(path.join(staging, "blobs"), { bigint: true })) }));
    await mkdir(path.join(staging, "layers"), { mode: 0o700 });
    owned.set("layers", Object.freeze({ type: "directory", identity: identity(await lstat(path.join(staging, "layers"), { bigint: true })) }));
    const policy = await readPolicy();
    const remote = await fetch({ signal: operationSignal, timeoutMs: registryTimeout() });
    const manifest = JSON.parse(policy.get("base-manifest.json").toString("utf8"));
    if (!Buffer.isBuffer(remote?.bytes) || !remote.bytes.equals(policy.get("base-manifest.json"))
      || remote.digest !== `sha256:${createHash("sha256").update(remote.bytes).digest("hex")}`
      || remote.mediaType !== manifest.mediaType
      || !exactRemoteDescriptors(remote, manifest)) throw failure("seaweed_base_materialization_manifest_invalid");
    const configFile = path.join(staging, "base-config.json");
    await downloadBlob({ descriptor: remote.config, file: configFile, stream, signal: operationSignal, timeoutMs: registryTimeout(), uid, owned, staging });
    const configBytes = await readFile(configFile);
    if (!configBytes.equals(policy.get("base-config.json"))) throw failure("seaweed_base_materialization_config_invalid");
    await writeBytes(path.join(staging, "base-manifest.json"), remote.bytes, uid, owned, staging);
    await writeBytes(path.join(staging, "base-filesystem.json"), policy.get("base-filesystem.json"), uid, owned, staging);
    const compressedFiles = []; const rawFiles = [];
    for (const [index, descriptor] of remote.layers.entries()) {
      check();
      const suffix = descriptor.digest.slice("sha256:".length);
      const compressed = path.join(staging, "blobs", `${String(index).padStart(2, "0")}-${suffix}.tar.gz`);
      const raw = path.join(staging, "layers", `${String(index).padStart(2, "0")}-${suffix}.tar`);
      await downloadBlob({ descriptor, file: compressed, stream, signal: operationSignal, timeoutMs: registryTimeout(), uid, owned, staging });
      compressedFiles.push(compressed); rawFiles.push(raw);
    }
    const materials = new Map([["base-manifest.json", remote.bytes], ["base-config.json", configBytes],
      ["base-filesystem.json", policy.get("base-filesystem.json")]]);
    const index = await scan({ baseMaterials: materials,
      openBlob: ({ layerIndex }) => createReadStream(compressedFiles[layerIndex], { signal: operationSignal }) });
    check();
    let rawBytes = 0;
    for (const [layerIndex, layer] of index.layers.entries()) {
      check();
      rawBytes += await decompressLayer({ compressed: compressedFiles[layerIndex], raw: rawFiles[layerIndex],
        diffId: layer.diffId, uid, remainingRaw: MAX_RAW_BYTES - rawBytes, owned, staging, signal: operationSignal });
      if (rawBytes !== index.layers.slice(0, layerIndex + 1).reduce((sum, item) => sum + item.uncompressedSize, 0)) {
        throw failure("seaweed_base_materialization_raw_size_invalid");
      }
    }
    if (rawBytes !== index.totals.rawBytes) throw failure("seaweed_base_materialization_raw_size_invalid");
    check();
    await validateWinningReferences(index, rawFiles, operationSignal);
    check();
    for (const [layerIndex, layer] of index.layers.entries()) {
      const compressedIdentity = await hashFile(compressedFiles[layerIndex], operationSignal);
      const rawIdentity = await hashFile(rawFiles[layerIndex], operationSignal);
      if (compressedIdentity.size !== layer.compressedSize || compressedIdentity.digest !== layer.compressedDigest
        || rawIdentity.size !== layer.uncompressedSize || rawIdentity.digest !== layer.diffId) {
        throw failure("seaweed_base_materialization_identity_invalid");
      }
    }
    check();
    const fresh = await fetch({ signal: operationSignal, timeoutMs: registryTimeout() });
    check();
    if (!sameFetch(remote, fresh)) throw failure("seaweed_base_materialization_manifest_changed");
    cleanupSnapshot = await snapshotTree(staging, uid);
    check();
    const expectedOwned = new Map([["", Object.freeze({ type: "directory", identity: stagingIdentity })], ...owned]);
    if (cleanupSnapshot.size !== expectedOwned.size) throw failure("seaweed_base_materialization_ownership_invalid");
    for (const [name, record] of expectedOwned) {
      if (!sameRecord(record, cleanupSnapshot.get(name))) throw failure("seaweed_base_materialization_ownership_invalid");
    }
    const parentBeforePromotion = await privateDirectory(parent, uid);
    check();
    if (!sameNode(parentIdentity, parentBeforePromotion)) throw failure("seaweed_base_materialization_parent_invalid");
    await beforeRename?.({ parent, outputPath });
    check();
    const parentAfterHook = await privateDirectory(parent, uid);
    check();
    if (!sameNode(parentIdentity, parentAfterHook)) throw failure("seaweed_base_materialization_parent_invalid");
    const parentNames = await readdir(parent);
    check();
    if (parentNames.length !== 1 || parentNames[0] !== STAGING_NAME) {
      throw failure("seaweed_base_materialization_promotion_collision");
    }
    try {
      await lstat(outputPath);
      throw failure("seaweed_base_materialization_promotion_collision");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    check();
    await rename(staging, outputPath); outputCreated = true;
    check();
    await afterRename?.({ parent, outputPath });
    check();
    const promoted = await snapshotTree(outputPath, uid);
    check();
    if (promoted.size !== cleanupSnapshot.size) throw failure("seaweed_base_materialization_promotion_invalid");
    for (const [name, record] of cleanupSnapshot) if (!sameRecord(record, promoted.get(name))) throw failure("seaweed_base_materialization_promotion_invalid");
    const finalParent = await privateDirectory(parent, uid);
    check();
    if (!sameNode(parentIdentity, finalParent)) throw failure("seaweed_base_materialization_parent_invalid");
    const completed = Object.freeze({ kind: "SEAWEED_BASE_MATERIALIZATION_RECEIPT_V1", state: "MATERIALIZED",
      authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", outputPath,
      totals: Object.freeze({ compressedBytes: index.totals.compressedBytes, rawBytes: index.totals.rawBytes,
        memberCount: index.totals.memberCount, visibleEntries: index.totals.visibleEntries }) });
    const privateIndex = detachedFrozen(index);
    CLEANUP_AUTHORITIES.set(completed, { parent, uid, outputPath, parentIdentity: finalParent, snapshot: promoted,
      index: privateIndex, references: new Map(privateIndex.members.map((reference) => [reference.entry.path, reference])),
      baseMaterials: new Map([...materials].map(([name, bytes]) => [name, Buffer.from(bytes)])),
      rawFiles: rawFiles.map((file) => path.join(outputPath, path.relative(staging, file))), borrows: 0 });
    result = completed;
  } catch (error) {
    const code = lowerCode(error);
    thrown = timedOut ? failure("seaweed_base_materialization_timeout")
      : signal?.aborted ? failure("seaweed_base_materialization_aborted")
      : code?.startsWith("seaweed_base_materialization_") ? error
      : failure("seaweed_base_materialization_failed", code === undefined ? {} : { originalCode: code });
  } finally {
    globalThis.clearTimeout(timer);
    if (result === undefined && stagingCreated) {
      const target = outputCreated ? outputPath : staging;
      const expected = cleanupSnapshot ?? (stagingIdentity === undefined ? undefined : new Map([
        ["", Object.freeze({ type: "directory", identity: stagingIdentity })], ...owned,
      ]));
      if (expected === undefined || !await removeVerifiedTree(target, parent, uid, expected)) {
        thrown = failure("seaweed_base_materialization_cleanup_failed", { originalCode: thrown?.code });
      }
    }
  }
  if (thrown !== undefined) throw thrown;
  return result;
}

export async function materializePinnedSeaweedBase(input) { return execute(settings(input, false)); }
export async function TEST_ONLY_materializePinnedSeaweedBase(input) { return execute(settings(input, true)); }

export async function withMaterializedSeaweedBase(receipt, callback) {
  const authority = CLEANUP_AUTHORITIES.get(receipt);
  if (authority === undefined || receipt?.outputPath !== authority.outputPath || typeof callback !== "function") {
    throw failure("seaweed_base_materialization_borrow_unauthorized");
  }
  authority.borrows += 1;
  let active = true; let reading = false;
  const pending = new Set();
  const used = new Set();
  const readEntry = (entryPath) => {
    if (!active) return Promise.reject(failure("seaweed_base_materialization_read_expired"));
    if (!exactEntryPath(entryPath)) return Promise.reject(failure("seaweed_base_materialization_read_path_invalid"));
    const reference = authority.references.get(entryPath);
    if (reference === undefined) return Promise.reject(failure("seaweed_base_materialization_read_missing"));
    if (reading) return Promise.reject(failure("seaweed_base_materialization_read_busy"));
    if (used.has(entryPath)) return Promise.reject(failure("seaweed_base_materialization_read_replayed"));
    reading = true; used.add(entryPath);
    const operation = readBorrowedEntry(authority, reference, () => active);
    pending.add(operation);
    const settled = () => { pending.delete(operation); reading = false; };
    operation.then(settled, settled);
    return operation;
  };
  const capability = Object.freeze({
    baseMaterials: new Map([...authority.baseMaterials].map(([name, bytes]) => [name, Buffer.from(bytes)])),
    index: detachedFrozen(authority.index),
    readEntry,
  });
  try {
    return await callback(capability);
  } finally {
    active = false;
    await Promise.allSettled([...pending]);
    authority.borrows -= 1;
  }
}

export async function cleanupMaterializedSeaweedBase(receipt) {
  const authority = CLEANUP_AUTHORITIES.get(receipt);
  if (authority === undefined || receipt?.outputPath !== authority.outputPath) throw failure("seaweed_base_materialization_cleanup_unauthorized");
  if (authority.borrows > 0) throw failure("seaweed_base_materialization_cleanup_borrowed");
  CLEANUP_AUTHORITIES.delete(receipt);
  const currentParent = identity(await lstat(authority.parent, { bigint: true }).catch(() => { throw failure("seaweed_base_materialization_cleanup_failed"); }));
  if (!sameNode(authority.parentIdentity, currentParent)
    || !await removeVerifiedTree(authority.outputPath, authority.parent, authority.uid, authority.snapshot)) {
    throw failure("seaweed_base_materialization_cleanup_failed");
  }
  return Object.freeze({ state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" });
}
