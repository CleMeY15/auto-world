import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { inflateRawSync } from "node:zlib";

const BLOCK = 512;
const MAX_FIXTURE_TAR = 64 * 1024;
const MAX_SAVED_TAR = 4 * 1024 ** 2;
const MAX_CONFIG = 256 * 1024;
const MAX_MEMBERS = 128;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HEX = /^[0-9a-f]{64}$/u;
const SAFE_NAME = /^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/?$/u;
const SERVER_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/u;

export const IMPORT_MESSAGE = "auto-world synthetic import fixture v1";

const ZERO_CONTAINER_CONFIG = Object.freeze({
  Hostname: "", Domainname: "", User: "", AttachStdin: false, AttachStdout: false, AttachStderr: false,
  Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null, Image: "", Volumes: null,
  WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null,
});

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export const fixtureEntries = Object.freeze([
  Object.freeze({ path: "usr/", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 1_700_000_000 }),
  Object.freeze({ path: "usr/local/", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 1_700_000_001 }),
  Object.freeze({ path: "usr/local/bin/", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 1_700_000_002 }),
  Object.freeze({ path: "usr/local/bin/fixture-entrypoint", type: "file", mode: 0o755, uid: 0, gid: 0, mtime: 1_700_000_003, content: Buffer.from("AUTO WORLD PUBLIC SYNTHETIC FIXTURE\n") }),
  Object.freeze({ path: "workspace/", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 1_700_000_004 }),
  Object.freeze({ path: "workspace/data/", type: "directory", mode: 0o700, uid: 1000, gid: 1000, mtime: 1_700_000_005 }),
  Object.freeze({ path: "workspace/owner.txt", type: "file", mode: 0o640, uid: 1000, gid: 1000, mtime: 1_700_000_006, content: Buffer.from("uid=1000 gid=1000\n") }),
  Object.freeze({ path: "workspace/public.txt", type: "file", mode: 0o444, uid: 123, gid: 456, mtime: 1_700_000_007, content: Buffer.from("public synthetic metadata\n") }),
  Object.freeze({ path: "workspace/public-link", type: "symlink", mode: 0o777, uid: 1000, gid: 1000, mtime: 1_700_000_008, linkname: "public.txt" }),
]);

function requireOwner(owner) {
  if (typeof owner !== "string" || !OWNER.test(owner)) throw new Error("image_import_fixture_owner_invalid");
}

export function fixtureConfig(owner) {
  requireOwner(owner);
  return {
    Entrypoint: ["/usr/local/bin/fixture-entrypoint"],
    Cmd: ["verify", "--synthetic"],
    Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "AW_FIXTURE=public"],
    WorkingDir: "/workspace",
    Volumes: { "/workspace/data": {} },
    ExposedPorts: { "8080/tcp": {} },
    Labels: { "com.auto-world.import-fixture": owner },
  };
}

function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error("image_import_fixture_tar_field_invalid");
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("image_import_fixture_tar_field_invalid");
  const octal = value.toString(8);
  if (octal.length > length - 1) throw new Error("image_import_fixture_tar_field_invalid");
  writeString(header, offset, length, `${octal.padStart(length - 1, "0")}\0`);
}

function fixtureHeader(entry) {
  const header = Buffer.alloc(BLOCK);
  writeString(header, 0, 100, entry.path);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, entry.uid);
  writeOctal(header, 116, 8, entry.gid);
  writeOctal(header, 124, 12, entry.type === "file" ? entry.content.length : 0);
  writeOctal(header, 136, 12, entry.mtime);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, entry.type === "file" ? "0" : entry.type === "directory" ? "5" : "2");
  if (entry.type === "symlink") writeString(header, 157, 100, entry.linkname);
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "root");
  writeString(header, 297, 32, "root");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

export function buildFixtureTar() {
  const parts = [];
  for (const entry of fixtureEntries) {
    parts.push(fixtureHeader(entry));
    if (entry.type === "file") {
      parts.push(entry.content);
      const padding = (BLOCK - entry.content.length % BLOCK) % BLOCK;
      if (padding) parts.push(Buffer.alloc(padding));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  const result = Buffer.concat(parts);
  if (result.length > MAX_FIXTURE_TAR) throw new Error("image_import_fixture_tar_oversized");
  return result;
}

function fieldString(block, offset, length) {
  const field = block.subarray(offset, offset + length);
  const zero = field.indexOf(0);
  const end = zero < 0 ? field.length : zero;
  if (field.subarray(end + (zero < 0 ? 0 : 1)).some((byte) => byte !== 0)) throw new Error("image_import_tar_header_invalid");
  const value = field.subarray(0, end);
  if (value.some((byte) => byte < 0x20 || byte > 0x7e)) throw new Error("image_import_tar_header_invalid");
  return value.toString("ascii");
}

function octal(block, offset, length, maximum) {
  const raw = block.subarray(offset, offset + length);
  if (raw[0] & 0x80) throw new Error("image_import_tar_octal_invalid");
  const text = raw.toString("ascii").replace(/[\0 ]+$/u, "");
  if (!/^[0-7]+$/u.test(text)) throw new Error("image_import_tar_octal_invalid");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error("image_import_tar_octal_invalid");
  return value;
}

function parseTar(buffer, { maximumBytes, maximumMembers = MAX_MEMBERS } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < BLOCK * 2 || buffer.length > maximumBytes || buffer.length % BLOCK !== 0) {
    throw new Error("image_import_tar_size_invalid");
  }
  const entries = [];
  const names = new Set();
  let offset = 0;
  let endBlocks = 0;
  while (offset < buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) {
      endBlocks += 1; offset += BLOCK;
      if (endBlocks === 2) break;
      continue;
    }
    if (endBlocks !== 0) throw new Error("image_import_tar_eoa_invalid");
    const checksum = octal(block, 148, 8, 256 * BLOCK);
    const copy = Buffer.from(block); copy.fill(0x20, 148, 156);
    if (copy.reduce((sum, byte) => sum + byte, 0) !== checksum) throw new Error("image_import_tar_checksum_invalid");
    const magic = block.subarray(257, 263);
    if (!magic.equals(Buffer.from("ustar\0")) || !block.subarray(263, 265).equals(Buffer.from("00"))) throw new Error("image_import_tar_format_invalid");
    const name = fieldString(block, 0, 100); const prefix = fieldString(block, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    if (!fullName || !SAFE_NAME.test(fullName) || fullName.includes("\\") || names.has(fullName)) throw new Error("image_import_tar_name_invalid");
    names.add(fullName);
    const typeFlag = String.fromCharCode(block[156] || 0x30);
    const type = typeFlag === "0" ? "file" : typeFlag === "5" ? "directory" : typeFlag === "2" ? "symlink" : null;
    if (type === null || fullName.split("/").some((part) => part === ".wh..wh..opq" || part.startsWith(".wh."))) {
      throw new Error("image_import_tar_type_invalid");
    }
    const size = octal(block, 124, 12, maximumBytes);
    const mode = octal(block, 100, 8, 0o7777);
    const uid = octal(block, 108, 8, 0x7fffffff);
    const gid = octal(block, 116, 8, 0x7fffffff);
    const mtime = octal(block, 136, 12, Number.MAX_SAFE_INTEGER);
    const linkname = fieldString(block, 157, 100);
    if ((type !== "file" && size !== 0) || (type === "directory" && (!fullName.endsWith("/") || linkname))
      || (type === "file" && (fullName.endsWith("/") || linkname)) || (type === "symlink" && (fullName.endsWith("/") || !linkname || !SAFE_NAME.test(linkname)))) {
      throw new Error("image_import_tar_header_invalid");
    }
    const contentStart = offset + BLOCK; const contentEnd = contentStart + size;
    const next = contentStart + Math.ceil(size / BLOCK) * BLOCK;
    if (contentEnd > buffer.length || next > buffer.length || buffer.subarray(contentEnd, next).some((byte) => byte !== 0)) {
      throw new Error("image_import_tar_padding_invalid");
    }
    entries.push({ path: fullName, type, mode, uid, gid, mtime, linkname, content: buffer.subarray(contentStart, contentEnd) });
    if (entries.length > maximumMembers) throw new Error("image_import_tar_member_limit");
    offset = next;
  }
  if (endBlocks !== 2 || buffer.subarray(offset).some((byte) => byte !== 0)) throw new Error("image_import_tar_eoa_invalid");
  return entries;
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactJson(value, expected) {
  if (Array.isArray(expected)) return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => exactJson(entry, expected[index]));
  if (plainObject(expected)) return plainObject(value) && Object.keys(value).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, entry]) => Object.hasOwn(value, key) && exactJson(value[key], entry));
  return Object.is(value, expected);
}

export function validateRuntimeConfig(config, owner) {
  requireOwner(owner);
  if (!plainObject(config)) throw new Error("image_import_runtime_config_invalid");
  const rawUserRepresentation = Object.hasOwn(config, "User") ? "PRESENT_EMPTY" : "ABSENT";
  if (Object.hasOwn(config, "User") && config.User !== "") throw new Error("image_import_runtime_user_invalid");
  const withoutUser = { ...config }; delete withoutUser.User;
  const allowedDefaults = { Hostname: "", Domainname: "", AttachStdin: false, AttachStdout: false, AttachStderr: false,
    Tty: false, OpenStdin: false, StdinOnce: false, Image: "", OnBuild: null };
  for (const [key, value] of Object.entries(allowedDefaults)) {
    if (Object.hasOwn(withoutUser, key)) {
      if (!Object.is(withoutUser[key], value)) throw new Error("image_import_runtime_config_invalid");
      delete withoutUser[key];
    }
  }
  if (!exactJson(withoutUser, fixtureConfig(owner))) throw new Error("image_import_runtime_config_invalid");
  return rawUserRepresentation;
}

function parseJson(entry, errorCode) {
  if (entry.type !== "file" || entry.content.length < 2 || entry.content.length > MAX_CONFIG) throw new Error(errorCode);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry.content)); }
  catch (error) { throw new Error(errorCode, { cause: error }); }
}

function exactFixtureInventory(entries) {
  if (entries.length !== fixtureEntries.length) throw new Error("image_import_fixture_inventory_invalid");
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const expected of fixtureEntries) {
    const actual = byPath.get(expected.path);
    if (!actual) throw new Error("image_import_fixture_inventory_invalid");
    if (actual.path !== expected.path || actual.type !== expected.type || actual.mode !== expected.mode || actual.uid !== expected.uid
      || actual.gid !== expected.gid || actual.mtime !== expected.mtime || actual.linkname !== (expected.linkname ?? "")) {
      throw new Error("image_import_fixture_inventory_invalid");
    }
    if (actual.type === "file" && !actual.content.equals(expected.content)) throw new Error("image_import_fixture_inventory_invalid");
  }
}

function imageHex(imageId) {
  if (typeof imageId !== "string") throw new Error("image_import_image_id_invalid");
  const value = imageId.startsWith("sha256:") ? imageId.slice(7) : imageId;
  if (!HEX.test(value)) throw new Error("image_import_image_id_invalid");
  return value;
}

export function validateSavedImage(buffer, { imageId, tag, owner, serverVersion } = {}) {
  requireOwner(owner);
  if (typeof serverVersion !== "string" || serverVersion.length > 64 || !SERVER_VERSION.test(serverVersion)) throw new Error("image_import_server_version_invalid");
  const expectedImage = imageHex(imageId);
  if (tag !== `auto-world-import-fixture:${owner}`) throw new Error("image_import_tag_invalid");
  const outer = parseTar(buffer, { maximumBytes: MAX_SAVED_TAR });
  const files = new Map(outer.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry]));
  const manifestEntry = files.get("manifest.json");
  if (!manifestEntry) throw new Error("image_import_save_manifest_invalid");
  const manifest = parseJson(manifestEntry, "image_import_save_manifest_invalid");
  if (!Array.isArray(manifest) || manifest.length !== 1 || !plainObject(manifest[0])) throw new Error("image_import_save_manifest_invalid");
  const item = manifest[0];
  if (!/^blobs\/sha256\/[0-9a-f]{64}$/u.test(item.Config) || !exactJson(item.RepoTags, [tag])
    || !Array.isArray(item.Layers) || item.Layers.length !== 1 || !/^blobs\/sha256\/[0-9a-f]{64}$/u.test(item.Layers[0])) {
    throw new Error("image_import_save_manifest_invalid");
  }
  const layoutEntry = files.get("oci-layout"); const indexEntry = files.get("index.json");
  if (!layoutEntry || !indexEntry) throw new Error("image_import_save_oci_invalid");
  if (!exactJson(parseJson(layoutEntry, "image_import_save_oci_invalid"), { imageLayoutVersion: "1.0.0" })) {
    throw new Error("image_import_save_oci_invalid");
  }
  const index = parseJson(indexEntry, "image_import_save_oci_invalid");
  if (!plainObject(index) || index.schemaVersion !== 2 || index.mediaType !== "application/vnd.oci.image.index.v1+json"
    || !exactJson(Object.keys(index).sort(), ["manifests", "mediaType", "schemaVersion"])
    || !Array.isArray(index.manifests) || index.manifests.length !== 1) throw new Error("image_import_save_oci_invalid");
  const descriptor = index.manifests[0];
  if (!validDescriptor(descriptor, new Set(["application/vnd.oci.image.manifest.v1+json"]))
    || !exactJson(Object.keys(descriptor).sort(), ["annotations", "digest", "mediaType", "size"])
    || !validIndexAnnotations(descriptor.annotations, owner)) {
    throw new Error("image_import_save_oci_invalid");
  }
  const manifestPath = digestPath(descriptor.digest);
  const ociManifestEntry = files.get(manifestPath);
  if (!ociManifestEntry || ociManifestEntry.content.length !== descriptor.size) throw new Error("image_import_save_oci_invalid");
  const ociManifest = parseJson(ociManifestEntry, "image_import_save_oci_invalid");
  if (!plainObject(ociManifest) || ociManifest.schemaVersion !== 2 || ociManifest.mediaType !== "application/vnd.oci.image.manifest.v1+json"
    || !exactJson(Object.keys(ociManifest).sort(), ["config", "layers", "mediaType", "schemaVersion"])
    || !validDescriptor(ociManifest.config, new Set(["application/vnd.oci.image.config.v1+json"]))
    || !exactJson(Object.keys(ociManifest.config).sort(), ["digest", "mediaType", "size"])
    || !Array.isArray(ociManifest.layers) || ociManifest.layers.length !== 1
    || !validDescriptor(ociManifest.layers[0], LAYER_MEDIA_TYPES)
    || !exactJson(Object.keys(ociManifest.layers[0]).sort(), ["digest", "mediaType", "size"])) throw new Error("image_import_save_oci_invalid");
  const configPath = digestPath(ociManifest.config.digest); const layerPath = digestPath(ociManifest.layers[0].digest);
  if (item.Config !== configPath || item.Layers[0] !== layerPath) throw new Error("image_import_save_manifest_invalid");
  const configEntry = files.get(configPath); const layerEntry = files.get(layerPath);
  if (!configEntry || configEntry.content.length !== ociManifest.config.size || configEntry.content.length > MAX_CONFIG
    || !layerEntry || layerEntry.content.length !== ociManifest.layers[0].size) throw new Error("image_import_save_blob_invalid");
  if (sha256(configEntry.content) !== configPath.slice("blobs/sha256/".length)) throw new Error("image_import_save_config_invalid");
  const referencedBlobs = new Set([manifestPath, configPath, layerPath]); const extraBlobs = [];
  for (const [name, entry] of files) {
    if (name.startsWith("blobs/sha256/")) {
      if (sha256(entry.content) !== name.slice("blobs/sha256/".length)) throw new Error("image_import_save_blob_invalid");
      if (!referencedBlobs.has(name)) extraBlobs.push(entry);
    }
  }
  const repositories = files.get("repositories"); const classic = repositories !== undefined || Object.hasOwn(item, "LayerSources") || extraBlobs.length > 0;
  if (!classic && !exactJson(Object.keys(item).sort(), ["Config", "Layers", "RepoTags"])) throw new Error("image_import_save_manifest_invalid");
  const config = parseJson(configEntry, "image_import_save_config_invalid");
  const rawUserRepresentation = validateImageConfig(config, { classic, owner, serverVersion });
  const rawLayer = decodeLayer(layerEntry.content, ociManifest.layers[0].mediaType);
  const diffID = `sha256:${sha256(rawLayer)}`;
  if (config.rootfs.diff_ids[0] !== diffID) throw new Error("image_import_save_diffid_invalid");
  if (classic) validateClassicCompatibility({ item, repositories, extraBlobs, config, layerEntry,
    layerMediaType: ociManifest.layers[0].mediaType, diffID, owner, serverVersion });
  const allowed = new Set(["oci-layout", "index.json", "manifest.json", ...referencedBlobs, "blobs/", "blobs/sha256/",
    ...(classic ? ["repositories", extraBlobs[0].path] : [])]);
  if (outer.some((entry) => !allowed.has(entry.path))) throw new Error("image_import_save_member_invalid");
  const layer = parseTar(rawLayer, { maximumBytes: MAX_FIXTURE_TAR });
  exactFixtureInventory(layer);
  const manifestDigest = descriptor.digest.slice(7);
  const configDigest = configPath.slice("blobs/sha256/".length);
  const identityType = classic && expectedImage === configDigest ? "CLASSIC_CONFIG_ID"
    : !classic && expectedImage === manifestDigest ? "CONTAINERD_MANIFEST_ID" : null;
  if (identityType === null) throw new Error("image_import_image_id_mismatch");
  return Object.freeze({
    imageId: `sha256:${expectedImage}`, identityType, tag, rawUserRepresentation,
    archiveSha256: sha256(buffer), archiveBytes: buffer.length, archiveMembers: outer.length,
    configSha256: configDigest, configBytes: configEntry.content.length,
    layerSha256: sha256(layerEntry.content), layerBytes: layerEntry.content.length, rawLayerBytes: rawLayer.length,
    layerMembers: layer.length, diffID,
  });
}

const LAYER_MEDIA_TYPES = new Set([
  "application/vnd.oci.image.layer.v1.tar",
  "application/vnd.oci.image.layer.v1.tar+gzip",
]);

function validateImageConfig(config, { classic, owner, serverVersion }) {
  const keys = classic
    ? ["architecture", "comment", "config", "container_config", "created", "docker_version", "history", "os", "rootfs"]
    : ["architecture", "config", "created", "history", "os", "rootfs"];
  if (!plainObject(config) || !exactJson(Object.keys(config).sort(), keys) || config.os !== "linux" || config.architecture !== "amd64"
    || typeof config.created !== "string" || !Number.isFinite(Date.parse(config.created))
    || !exactJson(config.history, [{ created: config.created, comment: IMPORT_MESSAGE }]) || !plainObject(config.rootfs)
    || !exactJson(Object.keys(config.rootfs).sort(), ["diff_ids", "type"]) || config.rootfs.type !== "layers"
    || !Array.isArray(config.rootfs.diff_ids) || config.rootfs.diff_ids.length !== 1 || !plainObject(config.config)) {
    throw new Error("image_import_save_config_invalid");
  }
  if (classic && (config.comment !== IMPORT_MESSAGE || config.docker_version !== serverVersion
    || !exactJson(config.container_config, ZERO_CONTAINER_CONFIG))) throw new Error("image_import_save_config_invalid");
  return validateRuntimeConfig(config.config, owner);
}

function validateClassicCompatibility({ item, repositories, extraBlobs, config, layerEntry, layerMediaType, diffID, owner, serverVersion }) {
  if (!repositories || extraBlobs.length !== 1 || layerMediaType !== "application/vnd.oci.image.layer.v1.tar"
    || !exactJson(Object.keys(item).sort(), ["Config", "LayerSources", "Layers", "RepoTags"])) {
    throw new Error("image_import_save_classic_invalid");
  }
  const layerDigest = `sha256:${sha256(layerEntry.content)}`;
  const descriptor = { mediaType: "application/vnd.oci.image.layer.v1.tar", size: layerEntry.content.length, digest: layerDigest };
  if (!exactJson(item.LayerSources, { [diffID]: descriptor })) throw new Error("image_import_save_classic_invalid");
  const repository = parseJson(repositories, "image_import_save_classic_invalid");
  if (!exactJson(repository, { "auto-world-import-fixture": { [owner]: diffID.slice(7) } })) {
    throw new Error("image_import_save_classic_invalid");
  }
  const legacy = parseJson(extraBlobs[0], "image_import_save_classic_invalid");
  if (!plainObject(legacy) || !exactJson(Object.keys(legacy).sort(), ["architecture", "comment", "config", "container_config", "created", "docker_version", "id", "os"])
    || !HEX.test(legacy.id) || legacy.created !== config.created || legacy.architecture !== "amd64" || legacy.os !== "linux"
    || legacy.comment !== IMPORT_MESSAGE || legacy.docker_version !== serverVersion || !exactJson(legacy.config, config.config)
    || !exactJson(legacy.container_config, ZERO_CONTAINER_CONFIG)) throw new Error("image_import_save_classic_invalid");
}

function validDescriptor(value, mediaTypes) {
  return plainObject(value) && mediaTypes.has(value.mediaType) && /^sha256:[0-9a-f]{64}$/u.test(value.digest)
    && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= MAX_SAVED_TAR;
}

function validIndexAnnotations(value, owner) {
  return exactJson(value, {
    "io.containerd.image.name": `docker.io/library/auto-world-import-fixture:${owner}`,
    "org.opencontainers.image.ref.name": owner,
  });
}

function digestPath(digest) {
  return `blobs/sha256/${digest.slice(7)}`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeLayer(buffer, mediaType) {
  const gzip = mediaType.endsWith("+gzip") || mediaType.endsWith(".gzip");
  if (!gzip) {
    if (buffer.length > MAX_FIXTURE_TAR) throw new Error("image_import_save_layer_invalid");
    return buffer;
  }
  if (buffer.length < 18 || buffer[0] !== 0x1f || buffer[1] !== 0x8b || buffer[2] !== 8 || buffer[3] !== 0) {
    throw new Error("image_import_save_gzip_invalid");
  }
  const compressed = buffer.subarray(10, buffer.length - 8);
  let result;
  try { result = inflateRawSync(compressed, { info: true, maxOutputLength: MAX_FIXTURE_TAR }); }
  catch (error) { throw new Error("image_import_save_gzip_invalid", { cause: error }); }
  if (!result?.engine || result.engine.bytesWritten !== compressed.length) throw new Error("image_import_save_gzip_invalid");
  const raw = result.buffer;
  if (raw.length > MAX_FIXTURE_TAR || buffer.readUInt32LE(buffer.length - 8) !== crc32(raw)
    || buffer.readUInt32LE(buffer.length - 4) !== raw.length >>> 0) throw new Error("image_import_save_gzip_invalid");
  return raw;
}

export const imageImportFixtureLimits = Object.freeze({ fixtureTarBytes: MAX_FIXTURE_TAR, savedTarBytes: MAX_SAVED_TAR, configBytes: MAX_CONFIG, members: MAX_MEMBERS });
