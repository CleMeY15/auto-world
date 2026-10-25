import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";

import { scanRawUstar } from "../seaweed-image/archive.mjs";
import { candidateContractV2 } from "./gosu-derivative-candidate-v2.mjs";
import { validateCandidateFilesystemV2 } from "./gosu-derivative-filesystem-v2.mjs";

const INPUT_ERROR = "gosu_derivative_image_proof_input_invalid";
const ARCHIVE_ERROR = "gosu_derivative_image_proof_archive_invalid";
const PAIR_ERROR = "gosu_derivative_image_proof_pair_invalid";
const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const JSON_LIMIT = 4 * MiB;
const OUTER_MEMBERS = 4096;
const LAYER_MEMBERS = 100_000;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))(?!.*\\)(?!.*\/\/)[\x21-\x7e]+(?<!\/)$/u;
const HEX = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/u;
const HISTORY_FIELDS = Object.freeze(["created", "created_by", "author", "comment", "empty_layer"]);
const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const OCI_CONFIG = "application/vnd.oci.image.config.v1+json";
const OCI_LAYER = "application/vnd.oci.image.layer.v1.tar";
const handles = new WeakMap();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
const typedByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const typedSet = Uint8Array.prototype.set;
const arrayBufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const byteLength = Buffer.byteLength.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);

function fail(code) { throw new Error(code); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function validPath(value) {
  return typeof value === "string" && value.length <= 512 && byteLength(value) <= 512
    && PATH.test(value) && value.split("/").length <= 32;
}
function parentOf(value) {
  const index = value.lastIndexOf("/");
  return index === -1 ? "" : value.slice(0, index);
}
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value !== null && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)])));
  }
  return value;
}

function record(value, fields, code) {
  if (value === null || typeof value !== "object" || types.isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const names = Reflect.ownKeys(value);
  if (names.length !== fields.length || names.some((name) => typeof name !== "string" || !fields.includes(name))) fail(code);
  const copy = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail(code);
    Object.defineProperty(copy, name, { value: descriptor.value, enumerable: true, configurable: true, writable: true });
  }
  return copy;
}

function denseArray(value, maximum, code) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!integer(length, maximum) || Reflect.ownKeys(value).length !== length + 1) fail(code);
  const copy = new Array(length);
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail(code);
    copy[index] = descriptor.value;
  }
  return copy;
}

function copyBytes(value) {
  if (value === null || typeof value !== "object" || types.isProxy(value)) fail(INPUT_ERROR);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Buffer.prototype && prototype !== Uint8Array.prototype) fail(INPUT_ERROR);
  let length; let offset; let backing;
  try {
    length = typedByteLength.call(value);
    offset = typedByteOffset.call(value);
    backing = typedBuffer.call(value);
    if (types.isSharedArrayBuffer(backing) || arrayBufferResizable?.call(backing) === true) fail(INPUT_ERROR);
    const backingLength = arrayBufferByteLength.call(backing);
    new DataView(backing);
    if (!integer(length, GiB) || length === 0 || !integer(offset) || offset + length > backingLength) fail(INPUT_ERROR);
  } catch { fail(INPUT_ERROR); }
  const copy = new Uint8Array(length);
  try { typedSet.call(copy, value); } catch { fail(INPUT_ERROR); }
  return copy;
}

function snapshotSubject(value, length) {
  const subject = record(value, ["role", "archive", "configId"], INPUT_ERROR);
  const archive = record(subject.archive, ["bytes", "sha256"], INPUT_ERROR);
  if (!["BASE", "CANDIDATE"].includes(subject.role) || !integer(archive.bytes, GiB) || archive.bytes === 0
    || archive.bytes !== length || typeof archive.sha256 !== "string" || !HEX.test(archive.sha256)
    || typeof subject.configId !== "string" || !DIGEST.test(subject.configId)) fail(INPUT_ERROR);
  return freeze({ role: subject.role, archive, configId: subject.configId });
}

function chunks(bytes) {
  return (function* boundedChunks() {
    for (let offset = 0; offset < bytes.length; offset += MiB) {
      yield bytes.subarray(offset, Math.min(bytes.length, offset + MiB));
    }
  }());
}

function memberBody(archive, member) {
  const start = member.uncompressedDataOffset;
  const end = start + member.entry.size;
  if (!integer(start, archive.length) || !integer(end, archive.length) || end > archive.length) fail(ARCHIVE_ERROR);
  return archive.subarray(start, end);
}

function boundedJson(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > JSON_LIMIT
    || bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail(ARCHIVE_ERROR);
  let value;
  try { value = JSON.parse(textDecoder.decode(bytes)); } catch { fail(ARCHIVE_ERROR); }
  let nodes = 0;
  function inspect(item, depth) {
    if (++nodes > 100_000 || depth > 32) fail(ARCHIVE_ERROR);
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") { if (!Number.isFinite(item)) fail(ARCHIVE_ERROR); return item; }
    if (typeof item === "string") { if (byteLength(item) > 65_536) fail(ARCHIVE_ERROR); return item; }
    if (Array.isArray(item)) {
      const values = denseArray(item, 100_000, ARCHIVE_ERROR);
      return values.map((child) => inspect(child, depth + 1));
    }
    if (item === null || typeof item !== "object" || Object.getPrototypeOf(item) !== Object.prototype) fail(ARCHIVE_ERROR);
    const result = {};
    for (const [key, child] of Object.entries(item)) {
      if (byteLength(key) > 65_536) fail(ARCHIVE_ERROR);
      Object.defineProperty(result, key, { value: inspect(child, depth + 1), enumerable: true,
        configurable: true, writable: true });
    }
    return result;
  }
  return freeze(inspect(value, 0));
}

function jsonRecord(value, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(ARCHIVE_ERROR);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !required.includes(key) && !optional.includes(key))) fail(ARCHIVE_ERROR);
  return value;
}

function descriptor(value, mediaType, maximum, optional = []) {
  jsonRecord(value, ["mediaType", "digest", "size"], optional);
  if (value.mediaType !== mediaType || typeof value.digest !== "string" || !DIGEST.test(value.digest)
    || !integer(value.size, maximum) || value.size === 0) fail(ARCHIVE_ERROR);
  return value;
}

function blobMember(byPath, buffer, value, maximum) {
  const selected = descriptor(value, value.mediaType, maximum);
  const member = byPath.get(`blobs/sha256/${selected.digest.slice(7)}`);
  if (member?.entry.type !== "file" || member.entry.size !== selected.size) fail(ARCHIVE_ERROR);
  const body = memberBody(buffer, member);
  if (`sha256:${hash(body)}` !== selected.digest) fail(ARCHIVE_ERROR);
  return { member, body };
}

function annotations(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.entries(value).some(([key, item]) => byteLength(key) > 65_536
      || typeof item !== "string" || byteLength(item) > 65_536)) fail(ARCHIVE_ERROR);
}

function ociSelectors(byPath, buffer, manifest, configBody, config, expectedLayers, subject) {
  const layoutMember = byPath.get("oci-layout");
  const indexMember = byPath.get("index.json");
  if (layoutMember?.entry.type !== "file" || indexMember?.entry.type !== "file") fail(ARCHIVE_ERROR);
  const layout = jsonRecord(boundedJson(memberBody(buffer, layoutMember)), ["imageLayoutVersion"]);
  if (layout.imageLayoutVersion !== "1.0.0") fail(ARCHIVE_ERROR);
  const index = jsonRecord(boundedJson(memberBody(buffer, indexMember)), ["schemaVersion", "mediaType", "manifests"]);
  const manifests = denseArray(index.manifests, 1, ARCHIVE_ERROR);
  if (index.schemaVersion !== 2 || index.mediaType !== OCI_INDEX || manifests.length !== 1) fail(ARCHIVE_ERROR);
  const indexDescriptor = descriptor(manifests[0], OCI_MANIFEST, JSON_LIMIT, ["annotations", "platform"]);
  if (Object.hasOwn(indexDescriptor, "annotations")) annotations(indexDescriptor.annotations);
  if (Object.hasOwn(indexDescriptor, "platform")) {
    const platform = jsonRecord(indexDescriptor.platform, ["os", "architecture"]);
    if (platform.os !== "linux" || platform.architecture !== "amd64") fail(ARCHIVE_ERROR);
  }
  const { body: ociManifestBody } = blobMember(byPath, buffer,
    { mediaType: OCI_MANIFEST, digest: indexDescriptor.digest, size: indexDescriptor.size }, JSON_LIMIT);
  const ociManifest = jsonRecord(boundedJson(ociManifestBody), ["schemaVersion", "mediaType", "config", "layers"]);
  const layerDescriptors = denseArray(ociManifest.layers, 12, ARCHIVE_ERROR);
  if (ociManifest.schemaVersion !== 2 || ociManifest.mediaType !== OCI_MANIFEST
    || layerDescriptors.length !== expectedLayers) fail(ARCHIVE_ERROR);
  const configDescriptor = descriptor(ociManifest.config, OCI_CONFIG, JSON_LIMIT);
  if (configDescriptor.digest !== subject.configId || configDescriptor.size !== configBody.length) fail(ARCHIVE_ERROR);
  blobMember(byPath, buffer, configDescriptor, JSON_LIMIT);
  for (let index = 0; index < layerDescriptors.length; index++) {
    const layerDescriptor = descriptor(layerDescriptors[index], OCI_LAYER, GiB);
    const path = `blobs/sha256/${layerDescriptor.digest.slice(7)}`;
    if (layerDescriptor.digest !== config.diffIds[index] || manifest.layers[index] !== path) fail(ARCHIVE_ERROR);
    blobMember(byPath, buffer, layerDescriptor, GiB);
  }
}

function manifestEntry(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(ARCHIVE_ERROR);
  const required = ["Config", "RepoTags", "Layers"];
  const optional = ["Parent", "LayerSources"];
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) || keys.some((key) => ![...required, ...optional].includes(key))) {
    fail(ARCHIVE_ERROR);
  }
  if (Object.hasOwn(value, "Parent") && typeof value.Parent !== "string") fail(ARCHIVE_ERROR);
  if (Object.hasOwn(value, "LayerSources") && (value.LayerSources === null || typeof value.LayerSources !== "object"
    || Array.isArray(value.LayerSources) || Object.getPrototypeOf(value.LayerSources) !== Object.prototype)) fail(ARCHIVE_ERROR);
  const layers = denseArray(value.Layers, 12, ARCHIVE_ERROR);
  const tags = value.RepoTags === null ? [] : denseArray(value.RepoTags, 128, ARCHIVE_ERROR);
  if (typeof value.Config !== "string" || !validPath(value.Config) || layers.length === 0
    || layers.some((path) => !validPath(path)) || new Set(layers).size !== layers.length
    || tags.some((tag) => typeof tag !== "string" || tag.length === 0 || byteLength(tag) > 4096)) fail(ARCHIVE_ERROR);
  return { config: value.Config, layers, tags };
}

function fullConfig(value, layerCount) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype || value.os !== "linux" || value.architecture !== "amd64"
    || value.config === null || typeof value.config !== "object" || Array.isArray(value.config)
    || Object.getPrototypeOf(value.config) !== Object.prototype) fail(ARCHIVE_ERROR);
  const rootfs = value.rootfs;
  if (rootfs === null || typeof rootfs !== "object" || Array.isArray(rootfs)
    || Object.getPrototypeOf(rootfs) !== Object.prototype || Object.keys(rootfs).length !== 2
    || !Object.hasOwn(rootfs, "diff_ids") || !Object.hasOwn(rootfs, "type")
    || rootfs.type !== "layers") fail(ARCHIVE_ERROR);
  const diffIds = denseArray(rootfs.diff_ids, 12, ARCHIVE_ERROR);
  if (diffIds.length !== layerCount || diffIds.some((item) => typeof item !== "string" || !DIGEST.test(item))) fail(ARCHIVE_ERROR);
  const history = denseArray(value.history, 100_000, ARCHIVE_ERROR);
  for (const item of history) {
    if (item === null || typeof item !== "object" || Array.isArray(item)
      || Object.getPrototypeOf(item) !== Object.prototype) fail(ARCHIVE_ERROR);
    for (const field of HISTORY_FIELDS) {
      if (!Object.hasOwn(item, field)) continue;
      if (field === "empty_layer" ? typeof item[field] !== "boolean" : typeof item[field] !== "string") fail(ARCHIVE_ERROR);
    }
  }
  return { full: value, runtime: value.config, rootfs, diffIds, history };
}

function addChild(children, parent, path) {
  let set = children.get(parent);
  if (!set) { set = new Set(); children.set(parent, set); }
  set.add(path);
}

function removePath(nodes, children, path) {
  const stack = [path];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const child of children.get(current) ?? []) stack.push(child);
    children.delete(current);
    nodes.delete(current);
    children.get(parentOf(current))?.delete(current);
  }
}

function ensureParents(nodes, children, path) {
  const parts = path.split("/");
  let current = "";
  for (let index = 0; index < parts.length - 1; index++) {
    current = current ? `${current}/${parts[index]}` : parts[index];
    const existing = nodes.get(current);
    if (existing && !["directory", "placeholder"].includes(existing.type)) fail(ARCHIVE_ERROR);
    if (!existing) {
      nodes.set(current, Object.freeze({ type: "placeholder" }));
      if (nodes.size > LAYER_MEMBERS) fail(ARCHIVE_ERROR);
      addChild(children, parentOf(current), current);
    }
  }
}

function applyMember(nodes, children, member) {
  const entry = member.entry;
  if (!validPath(entry.path) || !integer(entry.mode, 0o7777) || !integer(entry.uid, 2147483647)
    || !integer(entry.gid, 2147483647) || !integer(entry.mtime, Math.floor(Number.MAX_SAFE_INTEGER / 1000))
    || !integer(entry.size)) fail(ARCHIVE_ERROR);
  ensureParents(nodes, children, entry.path);
  const existing = nodes.get(entry.path);
  if (entry.type === "directory" && existing && ["directory", "placeholder"].includes(existing.type)) {
    nodes.set(entry.path, Object.freeze({ ...entry }));
    return;
  }
  if (existing) removePath(nodes, children, entry.path);
  let node;
  if (entry.type === "file") {
    if (typeof entry.sha256 !== "string" || !HEX.test(entry.sha256)) fail(ARCHIVE_ERROR);
    node = Object.freeze({ ...entry });
  } else if (entry.type === "hardlink") {
    if (!validPath(entry.linkname)) fail(ARCHIVE_ERROR);
    node = nodes.get(entry.linkname);
    if (!node || node.type !== "file") fail(ARCHIVE_ERROR);
  } else if (entry.type === "symlink") {
    if (typeof entry.linkname !== "string" || entry.linkname.length === 0 || byteLength(entry.linkname) > 1024) fail(ARCHIVE_ERROR);
    node = Object.freeze({ ...entry });
  } else if (entry.type === "directory") {
    node = Object.freeze({ ...entry });
  } else fail(ARCHIVE_ERROR);
  nodes.set(entry.path, node);
  if (nodes.size > LAYER_MEMBERS) fail(ARCHIVE_ERROR);
  addChild(children, parentOf(entry.path), entry.path);
}

function projectInventory(nodes) {
  if (nodes.size === 0 || nodes.size > LAYER_MEMBERS) fail(ARCHIVE_ERROR);
  const result = [];
  for (const path of [...nodes.keys()].sort()) {
    const node = nodes.get(path);
    if (node.type === "placeholder") fail(ARCHIVE_ERROR);
    result.push(node.type === "file" ? { path, type: "file", mode: node.mode, uid: node.uid, gid: node.gid,
      mtime: node.mtime, size: node.size, sha256: node.sha256 } : { path, type: node.type, mode: node.mode,
      uid: node.uid, gid: node.gid, mtime: node.mtime, size: node.size,
      ...(node.type === "symlink" ? { linkname: node.linkname } : {}) });
  }
  return freeze(result);
}

async function parseSave(archive, subject) {
  const buffer = bufferFrom(archive.buffer, archive.byteOffset, archive.byteLength);
  let outer;
  try {
    outer = await scanRawUstar({ input: Readable.from(chunks(buffer)), diffId: `sha256:${subject.archive.sha256}`,
      maxRawBytes: buffer.length, maxMembers: OUTER_MEMBERS });
  } catch { fail(ARCHIVE_ERROR); }
  if (outer.rawSize !== buffer.length || outer.members.some((member) => !validPath(member.entry.path)
    || !["file", "directory"].includes(member.entry.type))) {
    fail(ARCHIVE_ERROR);
  }
  const byPath = new Map(outer.members.map((member) => [member.entry.path, member]));
  const manifestMember = byPath.get("manifest.json");
  if (manifestMember?.entry.type !== "file") fail(ARCHIVE_ERROR);
  const manifestValue = boundedJson(memberBody(buffer, manifestMember));
  const manifestArray = denseArray(manifestValue, 1, ARCHIVE_ERROR);
  if (manifestArray.length !== 1) fail(ARCHIVE_ERROR);
  const manifest = manifestEntry(manifestArray[0]);
  const configPath = `blobs/sha256/${subject.configId.slice(7)}`;
  if (manifest.config !== configPath) fail(ARCHIVE_ERROR);
  const configMember = byPath.get(configPath);
  if (configMember?.entry.type !== "file") fail(ARCHIVE_ERROR);
  const configBody = memberBody(buffer, configMember);
  if (`sha256:${hash(configBody)}` !== subject.configId) fail(ARCHIVE_ERROR);
  const expectedLayers = subject.role === "BASE" ? 10 : 12;
  if (manifest.layers.length !== expectedLayers) fail(ARCHIVE_ERROR);
  const config = fullConfig(boundedJson(configBody), expectedLayers);
  ociSelectors(byPath, buffer, manifest, configBody, config, expectedLayers, subject);
  const nodes = new Map();
  const children = new Map();
  const layers = [];
  let memberCount = 0;
  for (let index = 0; index < manifest.layers.length; index++) {
    const layerMember = byPath.get(manifest.layers[index]);
    if (layerMember?.entry.type !== "file") fail(ARCHIVE_ERROR);
    const body = memberBody(buffer, layerMember);
    let scanned;
    try {
      scanned = await scanRawUstar({ input: Readable.from(chunks(body)), diffId: config.diffIds[index],
        maxRawBytes: body.length, maxMembers: LAYER_MEMBERS, allowHardlinks: true });
    } catch { fail(ARCHIVE_ERROR); }
    memberCount += scanned.members.length;
    if (memberCount > LAYER_MEMBERS) fail(ARCHIVE_ERROR);
    for (const member of scanned.members) applyMember(nodes, children, member);
    layers.push(freeze({ storedBytes: body.length, storedSha256: hash(body), diffId: config.diffIds[index],
      members: scanned.members.map((member) => freeze({ ...member.entry })) }));
  }
  const state = {
    subject,
    config,
    layers: Object.freeze(layers),
    nodes,
    inventory: projectInventory(nodes),
    memberCount,
  };
  const handle = Object.freeze(Object.create(null));
  handles.set(handle, state);
  return handle;
}

export async function openGosuDerivativeDockerSaveV1(bytes, subject) {
  let archive; let accepted;
  try {
    archive = copyBytes(bytes);
    accepted = snapshotSubject(subject, archive.byteLength);
  } catch { fail(INPUT_ERROR); }
  try {
    if (accepted.archive.sha256 !== hash(archive)) fail(ARCHIVE_ERROR);
    return await parseSave(archive, accepted);
  }
  catch { fail(ARCHIVE_ERROR); }
}

function timeNanoseconds(value) {
  if (typeof value !== "string") fail(PAIR_ERROR);
  const match = RFC3339.exec(value);
  if (!match) fail(PAIR_ERROR);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ""] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
    || hour > 23 || minute > 59 || second > 59) fail(PAIR_ERROR);
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  const days = era * 146097 + dayOfEra - 719468;
  const seconds = BigInt(days * 86400 + hour * 3600 + minute * 60 + second);
  return seconds * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}

function validateFullConfig(base, candidate, window) {
  const strip = (value) => Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["created", "rootfs", "history"].includes(key)));
  if (!isDeepStrictEqual(strip(base.full), strip(candidate.full))
    || !isDeepStrictEqual(candidate.diffIds.slice(0, 10), base.diffIds)
    || candidate.history.length !== base.history.length + 2
    || !isDeepStrictEqual(candidate.history.slice(0, base.history.length), base.history)
    || base.history.filter((item) => item.empty_layer !== true).length !== 10
    || candidate.history.slice(-2).some((item) => item.empty_layer === true)) fail(PAIR_ERROR);
  const start = BigInt(window.startedAtMs) * 1_000_000n;
  const end = BigInt(window.completedAtMs) * 1_000_000n;
  const times = [candidate.full.created, ...candidate.history.slice(-2).map((item) => item.created)]
    .filter((value) => value !== undefined);
  if (times.some((value) => { const time = timeNanoseconds(value); return time < start || time > end; })) fail(PAIR_ERROR);
}

function aliasGroups(nodes, ignored) {
  const pathsByInode = new Map();
  for (const [path, node] of nodes) {
    if (node.type !== "file" || ignored.has(path)) continue;
    let paths = pathsByInode.get(node);
    if (!paths) { paths = []; pathsByInode.set(node, paths); }
    paths.push(path);
  }
  const result = new Map();
  for (const paths of pathsByInode.values()) {
    const signature = paths.sort().join("\0");
    for (const path of paths) result.set(path, signature);
  }
  return result;
}

function validateAliases(base, candidate, allowed, executable) {
  const baseExecutable = base.nodes.get(executable);
  if (!baseExecutable || baseExecutable.type !== "file"
    || [...base.nodes.entries()].some(([path, node]) => path !== executable && node === baseExecutable)) fail(PAIR_ERROR);
  const before = aliasGroups(base.nodes, allowed);
  const after = aliasGroups(candidate.nodes, allowed);
  if (before.size !== after.size || [...before].some(([path, signature]) => after.get(path) !== signature)) fail(PAIR_ERROR);
}

export function proveGosuDerivativeImagePairV1(candidateLockHandle, value) {
  try {
    const contract = candidateContractV2(candidateLockHandle);
    const input = record(value, ["baseSave", "candidateSave", "buildWindow"], PAIR_ERROR);
    if (types.isProxy(input.baseSave) || types.isProxy(input.candidateSave) || input.baseSave === input.candidateSave
      || !handles.has(input.baseSave) || !handles.has(input.candidateSave)) fail(PAIR_ERROR);
    const base = handles.get(input.baseSave); const candidate = handles.get(input.candidateSave);
    const window = record(input.buildWindow, ["startedAtMs", "completedAtMs"], PAIR_ERROR);
    if (!integer(window.startedAtMs) || !integer(window.completedAtMs) || window.startedAtMs > window.completedAtMs
      || window.completedAtMs - window.startedAtMs > 600_000 || base.subject.role !== "BASE"
      || candidate.subject.role !== "CANDIDATE" || base.subject.configId !== contract.base.configId
      || base.subject.archive.bytes + candidate.subject.archive.bytes > 2 * GiB
      || base.memberCount + candidate.memberCount > LAYER_MEMBERS) fail(PAIR_ERROR);
    for (let index = 0; index < 10; index++) {
      const before = base.layers[index]; const after = candidate.layers[index];
      if (before.storedBytes !== after.storedBytes || before.storedSha256 !== after.storedSha256
        || before.diffId !== after.diffId) fail(PAIR_ERROR);
    }
    const allowed = new Set([contract.baseExecutable.path, ...contract.evidenceFiles.map((item) => item.path),
      ...contract.parentPaths.map((item) => item.path)]);
    for (const layer of candidate.layers.slice(10)) {
      if (layer.members.some((member) => !allowed.has(member.path) || ["hardlink", "symlink"].includes(member.type))) {
        fail(PAIR_ERROR);
      }
    }
    validateAliases(base, candidate, allowed, contract.baseExecutable.path);
    validateFullConfig(base.config, candidate.config, window);
    const delta = validateCandidateFilesystemV2(candidateLockHandle, { baseEntries: base.inventory,
      candidateEntries: candidate.inventory, baseConfig: base.config.runtime, candidateConfig: candidate.config.runtime,
      buildWindow: window });
    return freeze({
      scope: "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW",
      authority: "NOT_AUTHORIZED",
      profile: "POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1",
      base: { archive: base.subject.archive, configId: base.subject.configId, layers: 10 },
      candidate: { archive: candidate.subject.archive, configId: candidate.subject.configId, layers: 12 },
      inheritedLayers: 10,
      addedLayers: 2,
      configProfile: "STRICT_INHERITED_CONFIG_V2",
      delta,
    });
  } catch { fail(PAIR_ERROR); }
}
