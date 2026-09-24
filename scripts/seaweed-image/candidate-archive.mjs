import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { TextDecoder } from "node:util";

import { scanRawUstar } from "./archive.mjs";

const BLOCK = 512;
const MAX_RAW_BYTES = 2 * 1024 ** 3;
const MAX_OVERHEAD_BYTES = 64 * 1024 ** 2;
const MAX_OUTER_MEMBERS = 32;
const MAX_JSON_BYTES = 1024 ** 2;
const READ_CHUNK_BYTES = 1024 ** 2;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TAG = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))(?!.*\\)(?!.*\/\/)[\x21-\x7e]+\/?$/u;
const ZERO_CONTAINER_CONFIG = Object.freeze({ Hostname: "", Domainname: "", User: "", AttachStdin: false,
  AttachStdout: false, AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null,
  Image: "", Volumes: null, WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null });

export const SEAWEED_CANDIDATE_IMPORT_MESSAGE = "Auto World SeaweedFS S3 derivative v1";

function fail(reason, cause) {
  const code = `seaweed_candidate_archive_${reason}`;
  throw cause === undefined ? Object.assign(new Error(code), { code }) : Object.assign(new Error(code, { cause }), { code });
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exact(value, expected) {
  if (Array.isArray(expected)) return Array.isArray(value) && value.length === expected.length
    && value.every((item, index) => exact(item, expected[index]));
  if (plain(expected)) return plain(value) && Object.keys(value).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, item]) => Object.hasOwn(value, key) && exact(value[key], item));
  return Object.is(value, expected);
}

function snapshotOptions(input) {
  if (!plain(input)) fail("options_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = ["file", "imageId", "tag", "diffId", "rawSize", "memberCount", "serverVersion",
    "validateFilesystem", "validateRuntimeConfig", "signal"];
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]))) {
    fail("options_invalid");
  }
  const value = (key) => descriptors[key]?.value;
  const result = { file: value("file"), imageId: value("imageId"), tag: value("tag"), diffId: value("diffId"),
    rawSize: value("rawSize"), memberCount: value("memberCount"), serverVersion: value("serverVersion"),
    validateFilesystem: value("validateFilesystem"), validateRuntimeConfig: value("validateRuntimeConfig"), signal: value("signal") };
  if (typeof result.file !== "string" || result.file.length > 32_768 || !path.isAbsolute(result.file) || path.normalize(result.file) !== result.file
    || typeof result.imageId !== "string" || !DIGEST.test(result.imageId) || typeof result.tag !== "string"
    || result.tag.length > 255 || !TAG.test(result.tag)
    || typeof result.diffId !== "string" || !DIGEST.test(result.diffId)
    || !Number.isSafeInteger(result.rawSize) || result.rawSize < BLOCK * 2 || result.rawSize > MAX_RAW_BYTES
    || !Number.isSafeInteger(result.memberCount) || result.memberCount < 1 || result.memberCount > 100_000
    || result.serverVersion !== "28.0.4" || typeof result.validateFilesystem !== "function"
    || typeof result.validateRuntimeConfig !== "function"
    || result.signal !== undefined && !(result.signal instanceof globalThis.AbortSignal)) fail("options_invalid");
  return Object.freeze(result);
}

function identity(stat) {
  return Object.freeze({ dev: stat.dev.toString(), ino: stat.ino.toString(), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString() });
}

function sameIdentity(left, right) { return Object.keys(left).every((key) => left[key] === right[key]); }

function checkSignal(signal) { if (signal?.aborted) fail("aborted"); }

async function readExact(handle, buffer, position, signal) {
  let offset = 0;
  while (offset < buffer.length) {
    checkSignal(signal);
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (bytesRead < 1) fail("truncated");
    offset += bytesRead;
  }
}

function field(block, offset, length) {
  const value = block.subarray(offset, offset + length); const zero = value.indexOf(0);
  const end = zero < 0 ? value.length : zero;
  if (value.subarray(end + (zero < 0 ? 0 : 1)).some((byte) => byte !== 0)
    || value.subarray(0, end).some((byte) => byte < 0x20 || byte > 0x7e)) fail("tar_header_invalid");
  return value.subarray(0, end).toString("ascii");
}

function octal(block, offset, length, maximum, allowEmpty = false) {
  const bytes = block.subarray(offset, offset + length);
  if ((bytes[0] & 0x80) !== 0) fail("tar_octal_invalid");
  const text = bytes.toString("ascii").replace(/[\0 ]+$/u, "");
  if (allowEmpty && text === "") return 0;
  if (!/^[0-7]+$/u.test(text)) fail("tar_octal_invalid");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail("tar_octal_invalid");
  return value;
}

function parseHeader(block, archiveBytes) {
  const checksum = octal(block, 148, 8, BLOCK * 256); const copy = Buffer.from(block); copy.fill(0x20, 148, 156);
  if (copy.reduce((sum, byte) => sum + byte, 0) !== checksum) fail("tar_checksum_invalid");
  if (!block.subarray(257, 263).equals(Buffer.from("ustar\0"))
    || !block.subarray(263, 265).equals(Buffer.from("00"))) fail("tar_format_invalid");
  octal(block, 100, 8, 0o7777); octal(block, 108, 8, 0x7fffffff); octal(block, 116, 8, 0x7fffffff);
  octal(block, 136, 12, Number.MAX_SAFE_INTEGER); field(block, 265, 32); field(block, 297, 32);
  if (octal(block, 329, 8, 0, true) !== 0 || octal(block, 337, 8, 0, true) !== 0
    || block.subarray(500).some((byte) => byte !== 0)) fail("tar_header_invalid");
  const name = field(block, 0, 100); const prefix = field(block, 345, 155); const fullPath = prefix ? `${prefix}/${name}` : name;
  if (!fullPath || !SAFE_PATH.test(fullPath) || fullPath.split("/").some((part) => part.startsWith(".wh."))) fail("tar_name_invalid");
  const typeFlag = String.fromCharCode(block[156] || 0x30);
  const type = typeFlag === "0" ? "file" : typeFlag === "5" ? "directory" : null;
  if (type === null) fail("tar_type_invalid");
  const size = octal(block, 124, 12, archiveBytes);
  if (field(block, 157, 100) !== "" || type === "directory" && (size !== 0 || !fullPath.endsWith("/"))
    || type === "file" && fullPath.endsWith("/")) fail("tar_header_invalid");
  return { path: fullPath, type, size };
}

async function inspectContent(handle, position, size, retain, signal) {
  const hash = createHash("sha256"); const retained = retain ? Buffer.alloc(size) : undefined;
  const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, Math.max(1, size))); let offset = 0;
  while (offset < size) {
    const length = Math.min(chunk.length, size - offset); const view = chunk.subarray(0, length);
    await readExact(handle, view, position + offset, signal); hash.update(view);
    if (retained !== undefined) view.copy(retained, offset);
    offset += length;
  }
  return { sha256: hash.digest("hex"), bytes: retained };
}

async function requireZeroRange(handle, position, length, signal) {
  const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, Math.max(1, length))); let offset = 0;
  while (offset < length) {
    const view = chunk.subarray(0, Math.min(chunk.length, length - offset));
    await readExact(handle, view, position + offset, signal);
    if (view.some((byte) => byte !== 0)) fail("tar_eoa_invalid");
    offset += view.length;
  }
}

async function parseOuter(handle, archiveBytes, signal) {
  const entries = []; const names = new Set(); let position = 0; let endBlocks = 0;
  while (position < archiveBytes) {
    const block = Buffer.alloc(BLOCK); await readExact(handle, block, position, signal);
    if (block.every((byte) => byte === 0)) {
      endBlocks += 1; position += BLOCK;
      if (endBlocks === 2) break;
      continue;
    }
    if (endBlocks !== 0) fail("tar_eoa_invalid");
    const header = parseHeader(block, archiveBytes);
    if (names.has(header.path)) fail("tar_name_invalid");
    names.add(header.path);
    if (entries.length >= MAX_OUTER_MEMBERS) fail("tar_member_limit");
    const contentOffset = position + BLOCK; const padded = Math.ceil(header.size / BLOCK) * BLOCK;
    if (contentOffset + padded > archiveBytes) fail("truncated");
    const inspected = header.type === "file"
      ? await inspectContent(handle, contentOffset, header.size, header.size <= MAX_JSON_BYTES, signal)
      : { sha256: undefined, bytes: undefined };
    if (padded > header.size) {
      const padding = Buffer.alloc(padded - header.size); await readExact(handle, padding, contentOffset + header.size, signal);
      if (padding.some((byte) => byte !== 0)) fail("tar_padding_invalid");
    }
    entries.push(Object.freeze({ ...header, contentOffset, sha256: inspected.sha256, bytes: inspected.bytes }));
    position = contentOffset + padded;
  }
  if (endBlocks !== 2) fail("tar_eoa_invalid");
  await requireZeroRange(handle, position, archiveBytes - position, signal);
  return entries;
}

function json(entry, code) {
  if (entry?.type !== "file" || !Buffer.isBuffer(entry.bytes) || entry.bytes.length < 2 || entry.bytes.length > MAX_JSON_BYTES) fail(code);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes)); }
  catch (error) { fail(code, error); }
}

function descriptor(value, mediaType, maximum) {
  return plain(value) && exact(Object.keys(value).sort(), ["digest", "mediaType", "size"])
    && value.mediaType === mediaType && DIGEST.test(value.digest) && Number.isSafeInteger(value.size)
    && value.size > 0 && value.size <= maximum;
}

function digestPath(digest) { return `blobs/sha256/${digest.slice(7)}`; }

function splitTag(tag) {
  const separator = tag.lastIndexOf(":");
  return { repository: tag.slice(0, separator), label: tag.slice(separator + 1) };
}

function validateConfig(config, options) {
  const keys = ["architecture", "comment", "config", "container_config", "created", "docker_version", "history", "os", "rootfs"];
  if (!plain(config) || !exact(Object.keys(config).sort(), keys) || config.architecture !== "amd64" || config.os !== "linux"
    || config.comment !== SEAWEED_CANDIDATE_IMPORT_MESSAGE || config.docker_version !== options.serverVersion
    || !exact(config.container_config, ZERO_CONTAINER_CONFIG) || typeof config.created !== "string"
    || !Number.isFinite(Date.parse(config.created))
    || !exact(config.history, [{ created: config.created, comment: SEAWEED_CANDIDATE_IMPORT_MESSAGE }])
    || !exact(config.rootfs, { type: "layers", diff_ids: [options.diffId] }) || !plain(config.config)) fail("config_invalid");
}

function validateLegacy(entry, config, options) {
  const value = json(entry, "classic_invalid");
  const keys = ["architecture", "comment", "config", "container_config", "created", "docker_version", "id", "os"];
  if (!plain(value) || !exact(Object.keys(value).sort(), keys) || value.architecture !== "amd64" || value.os !== "linux"
    || typeof value.id !== "string" || !/^[0-9a-f]{64}$/u.test(value.id) || value.created !== config.created
    || value.comment !== SEAWEED_CANDIDATE_IMPORT_MESSAGE || value.docker_version !== options.serverVersion
    || !exact(value.config, config.config) || !exact(value.container_config, ZERO_CONTAINER_CONFIG)) fail("classic_invalid");
}

async function hashArchive(handle, size, signal) {
  const hash = createHash("sha256"); const chunk = Buffer.alloc(READ_CHUNK_BYTES); let offset = 0;
  while (offset < size) {
    const view = chunk.subarray(0, Math.min(chunk.length, size - offset));
    await readExact(handle, view, offset, signal); hash.update(view); offset += view.length;
  }
  return hash.digest("hex");
}

function rangeReadable(handle, start, size, signal) {
  let offset = 0; let reading = false;
  const input = new Readable({
    read() {
      if (reading) return;
      if (offset >= size) { this.push(null); return; }
      reading = true;
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, size - offset));
      handle.read(buffer, 0, buffer.length, start + offset).then(({ bytesRead }) => {
        reading = false;
        if (this.destroyed) return;
        if (bytesRead < 1) { this.destroy(Object.assign(new Error("seaweed_candidate_archive_truncated"), { code: "seaweed_candidate_archive_truncated" })); return; }
        offset += bytesRead; this.push(buffer.subarray(0, bytesRead));
      }, () => { reading = false; this.destroy(Object.assign(new Error("seaweed_candidate_archive_read_failed"), { code: "seaweed_candidate_archive_read_failed" })); });
    },
  });
  const abort = () => input.destroy(Object.assign(new Error("seaweed_candidate_archive_aborted"), { code: "seaweed_candidate_archive_aborted" }));
  signal?.addEventListener("abort", abort, { once: true });
  input.once("close", () => signal?.removeEventListener("abort", abort));
  if (signal?.aborted) abort();
  return input;
}

async function run(options) {
  checkSignal(options.signal);
  const pathBefore = await lstat(options.file, { bigint: true }).catch(() => fail("file_invalid"));
  const handle = await open(options.file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => fail("file_invalid"));
  try {
    const descriptorBefore = await handle.stat({ bigint: true });
    const before = identity(descriptorBefore);
    if (!descriptorBefore.isFile() || descriptorBefore.nlink !== 1n || !sameIdentity(before, identity(pathBefore))
      || descriptorBefore.size < BigInt(options.rawSize) || descriptorBefore.size > BigInt(options.rawSize + MAX_OVERHEAD_BYTES)
      || descriptorBefore.size % BigInt(BLOCK) !== 0n) fail("file_invalid");
    const archiveBytes = Number(descriptorBefore.size);
    const outer = await parseOuter(handle, archiveBytes, options.signal);
    const files = new Map(outer.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry]));
    const manifest = json(files.get("manifest.json"), "manifest_invalid");
    if (!Array.isArray(manifest) || manifest.length !== 1 || !plain(manifest[0])) fail("manifest_invalid");
    const item = manifest[0];
    if (!exact(Object.keys(item).sort(), ["Config", "LayerSources", "Layers", "RepoTags"])
      || !exact(item.RepoTags, [options.tag]) || !Array.isArray(item.Layers) || item.Layers.length !== 1
      || !/^blobs\/sha256\/[0-9a-f]{64}$/u.test(item.Config)
      || !/^blobs\/sha256\/[0-9a-f]{64}$/u.test(item.Layers[0])) fail("manifest_invalid");
    if (!exact(json(files.get("oci-layout"), "oci_invalid"), { imageLayoutVersion: "1.0.0" })) fail("oci_invalid");
    const index = json(files.get("index.json"), "oci_invalid"); const tagParts = splitTag(options.tag);
    if (!plain(index) || !exact(Object.keys(index).sort(), ["manifests", "mediaType", "schemaVersion"])
      || index.schemaVersion !== 2 || index.mediaType !== "application/vnd.oci.image.index.v1+json"
      || !Array.isArray(index.manifests) || index.manifests.length !== 1) fail("oci_invalid");
    const indexDescriptor = index.manifests[0];
    const expectedAnnotations = { "io.containerd.image.name": `docker.io/library/${options.tag}`,
      "org.opencontainers.image.ref.name": tagParts.label };
    if (!plain(indexDescriptor) || !exact(Object.keys(indexDescriptor).sort(), ["annotations", "digest", "mediaType", "size"])
      || !descriptor({ digest: indexDescriptor.digest, mediaType: indexDescriptor.mediaType, size: indexDescriptor.size },
        "application/vnd.oci.image.manifest.v1+json", MAX_JSON_BYTES)
      || !exact(indexDescriptor.annotations, expectedAnnotations)) fail("oci_invalid");
    const ociManifestEntry = files.get(digestPath(indexDescriptor.digest));
    if (ociManifestEntry?.size !== indexDescriptor.size || ociManifestEntry.sha256 !== indexDescriptor.digest.slice(7)) fail("oci_invalid");
    const ociManifest = json(ociManifestEntry, "oci_invalid");
    if (!plain(ociManifest) || !exact(Object.keys(ociManifest).sort(), ["config", "layers", "mediaType", "schemaVersion"])
      || ociManifest.schemaVersion !== 2 || ociManifest.mediaType !== "application/vnd.oci.image.manifest.v1+json"
      || !descriptor(ociManifest.config, "application/vnd.oci.image.config.v1+json", MAX_JSON_BYTES)
      || !Array.isArray(ociManifest.layers) || ociManifest.layers.length !== 1
      || !descriptor(ociManifest.layers[0], "application/vnd.oci.image.layer.v1.tar", options.rawSize)) fail("oci_invalid");
    const configPath = digestPath(ociManifest.config.digest); const layerPath = digestPath(ociManifest.layers[0].digest);
    if (item.Config !== configPath || item.Layers[0] !== layerPath) fail("manifest_invalid");
    const configEntry = files.get(configPath); const layerEntry = files.get(layerPath);
    if (configEntry?.size !== ociManifest.config.size || configEntry.sha256 !== ociManifest.config.digest.slice(7)
      || layerEntry?.size !== options.rawSize || layerEntry.sha256 !== ociManifest.layers[0].digest.slice(7)) fail("blob_invalid");
    if (options.imageId !== ociManifest.config.digest) fail("image_id_invalid");
    const config = json(configEntry, "config_invalid"); validateConfig(config, options);
    if (!exact(item.LayerSources, { [options.diffId]: { mediaType: "application/vnd.oci.image.layer.v1.tar",
      size: options.rawSize, digest: ociManifest.layers[0].digest } })) fail("classic_invalid");
    const repositories = json(files.get("repositories"), "classic_invalid");
    if (!exact(repositories, { [tagParts.repository]: { [tagParts.label]: options.diffId.slice(7) } })) fail("classic_invalid");
    const referenced = new Set([digestPath(indexDescriptor.digest), configPath, layerPath]);
    const extras = [...files.values()].filter((entry) => entry.path.startsWith("blobs/sha256/") && !referenced.has(entry.path));
    if (extras.length !== 1 || extras[0].sha256 !== extras[0].path.slice("blobs/sha256/".length)) fail("classic_invalid");
    validateLegacy(extras[0], config, options);
    const allowed = new Set(["oci-layout", "index.json", "manifest.json", "repositories", "blobs/", "blobs/sha256/",
      ...referenced, extras[0].path]);
    if (outer.some((entry) => !allowed.has(entry.path))) fail("member_invalid");
    try { await options.validateRuntimeConfig(config.config); } catch { fail("runtime_invalid"); }
    checkSignal(options.signal);
    const input = rangeReadable(handle, layerEntry.contentOffset, layerEntry.size, options.signal);
    const scanned = await scanRawUstar({ input, diffId: options.diffId, maxRawBytes: options.rawSize,
      maxMembers: options.memberCount, signal: options.signal });
    if (scanned.rawSize !== options.rawSize || scanned.members.length !== options.memberCount) fail("layer_invalid");
    try { await options.validateFilesystem(scanned.members.map((member) => member.entry)); } catch { fail("filesystem_invalid"); }
    checkSignal(options.signal);
    const archiveSha256 = await hashArchive(handle, archiveBytes, options.signal);
    const descriptorAfter = await handle.stat({ bigint: true }); const pathAfter = await lstat(options.file, { bigint: true }).catch(() => fail("file_changed"));
    if (!sameIdentity(before, identity(descriptorAfter)) || !sameIdentity(before, identity(pathAfter))) fail("file_changed");
    return Object.freeze({ kind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1", authority: "PREPARATION_ONLY",
      candidateAuthorization: "NOT_AUTHORIZED", imageId: options.imageId, identityType: "CLASSIC_CONFIG_ID",
      tag: options.tag, serverVersion: options.serverVersion,
      archiveSha256, archiveBytes, archiveMembers: outer.length, configSha256: configEntry.sha256, configBytes: configEntry.size,
      layerSha256: layerEntry.sha256, layerBytes: layerEntry.size, diffId: options.diffId,
      rawSize: scanned.rawSize, memberCount: scanned.members.length });
  } finally { await handle.close(); }
}

export async function validateSavedSeaweedCandidate(input) { return run(snapshotOptions(input)); }
