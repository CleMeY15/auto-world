import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

const BLOCK = 512;
const DEFAULT_MAXIMUM_BYTES = 1024 ** 3;
const MAXIMUM_JSON_BYTES = 4 * 1024 ** 2;
const MAXIMUM_MEMBERS = 64;
const MAXIMUM_LAYER_BYTES = 1024 ** 3;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TAG = /^aw-postgres-gosu:[0-9a-f]{24}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))(?!.*\\)(?!.*\/\/)[A-Za-z0-9._/-]+\/?$/u;
const OCI_CONFIG = "application/vnd.oci.image.config.v1+json";
const DOCKER_CONFIG = "application/vnd.docker.container.image.v1+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json";
const OCI_LAYER = "application/vnd.oci.image.layer.v1.tar";
const OCI_GZIP_LAYER = "application/vnd.oci.image.layer.v1.tar+gzip";
const DOCKER_GZIP_LAYER = "application/vnd.docker.image.rootfs.diff.tar.gzip";
const HEX = /^[0-9a-f]{64}$/u;
const ZERO_CONTAINER_CONFIG = Object.freeze({ Hostname: "", Domainname: "", User: "", AttachStdin: false,
  AttachStdout: false, AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null,
  Image: "", Volumes: null, WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null });

function fail(reason, cause) {
  const code = `postgres_candidate_proof_${reason}`;
  throw cause === undefined ? Object.assign(new Error(code), { code })
    : Object.assign(new Error(code, { cause }), { code });
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}
function exact(value, expected) {
  if (Array.isArray(expected)) return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => exact(entry, expected[index]));
  if (plain(expected)) return exactKeys(value, Object.keys(expected))
    && Object.entries(expected).every(([key, entry]) => exact(value[key], entry));
  return Object.is(value, expected);
}
function freezeArray(values) { return Object.freeze(values.map((value) => Object.freeze({ ...value }))); }

function requireDigest(value, reason = "options_invalid") {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(reason);
  return value;
}

function field(block, offset, length) {
  const bytes = block.subarray(offset, offset + length); const zero = bytes.indexOf(0);
  const end = zero < 0 ? bytes.length : zero;
  if (bytes.subarray(end + (zero < 0 ? 0 : 1)).some((byte) => byte !== 0)
    || bytes.subarray(0, end).some((byte) => byte < 0x20 || byte > 0x7e)) fail("tar_header_invalid");
  return bytes.subarray(0, end).toString("ascii");
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

function parseTar(buffer, maximumBytes) {
  if (!Buffer.isBuffer(buffer) || !Number.isSafeInteger(maximumBytes) || maximumBytes < BLOCK * 2
    || maximumBytes > DEFAULT_MAXIMUM_BYTES || buffer.length < BLOCK * 2 || buffer.length > maximumBytes
    || buffer.length % BLOCK !== 0) fail("archive_size_invalid");
  const entries = new Map(); let offset = 0; let zeroBlocks = 0;
  while (offset < buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) {
      zeroBlocks += 1; offset += BLOCK;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks !== 0) fail("tar_eoa_invalid");
    const checksum = octal(block, 148, 8, BLOCK * 256); const copy = Buffer.from(block);
    copy.fill(0x20, 148, 156);
    if (copy.reduce((sum, byte) => sum + byte, 0) !== checksum) fail("tar_checksum_invalid");
    if (!block.subarray(257, 263).equals(Buffer.from("ustar\0"))
      || !block.subarray(263, 265).equals(Buffer.from("00"))) fail("tar_format_invalid");
    octal(block, 100, 8, 0o7777); octal(block, 108, 8, 0x7fffffff); octal(block, 116, 8, 0x7fffffff);
    octal(block, 136, 12, Number.MAX_SAFE_INTEGER); field(block, 265, 32); field(block, 297, 32);
    if (octal(block, 329, 8, 0, true) !== 0 || octal(block, 337, 8, 0, true) !== 0
      || block.subarray(500).some((byte) => byte !== 0)) fail("tar_header_invalid");
    const name = field(block, 0, 100); const prefix = field(block, 345, 155);
    const member = prefix ? `${prefix}/${name}` : name;
    if (!member || !SAFE_PATH.test(member) || member.split("/").some((part) => part.startsWith(".wh."))
      || entries.has(member)) fail("tar_name_invalid");
    const typeFlag = String.fromCharCode(block[156] || 0x30);
    const type = typeFlag === "0" ? "file" : typeFlag === "5" ? "directory" : null;
    if (type === null) fail("tar_type_invalid");
    const size = octal(block, 124, 12, maximumBytes);
    if (field(block, 157, 100) !== "" || type === "directory" && (size !== 0 || !member.endsWith("/"))
      || type === "file" && member.endsWith("/")) fail("tar_header_invalid");
    const start = offset + BLOCK; const end = start + size; const next = start + Math.ceil(size / BLOCK) * BLOCK;
    if (end > buffer.length || next > buffer.length) fail("archive_truncated");
    if (buffer.subarray(end, next).some((byte) => byte !== 0)) fail("tar_padding_invalid");
    entries.set(member, Object.freeze({ path: member, type, size, content: buffer.subarray(start, end) }));
    if (entries.size > MAXIMUM_MEMBERS) fail("archive_member_limit");
    offset = next;
  }
  if (zeroBlocks !== 2 || buffer.subarray(offset).some((byte) => byte !== 0)) fail("tar_eoa_invalid");
  return entries;
}

function parseJson(entry, reason) {
  if (entry?.type !== "file" || entry.size < 2 || entry.size > MAXIMUM_JSON_BYTES) fail(reason);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry.content)); }
  catch (error) { fail(reason, error); }
}

function descriptor(value, mediaTypes, reason) {
  if (!exactKeys(value, ["mediaType", "digest", "size"]) || !mediaTypes.includes(value.mediaType)
    || !DIGEST.test(value.digest ?? "") || !Number.isSafeInteger(value.size) || value.size < 1
    || value.size > MAXIMUM_LAYER_BYTES) fail(reason);
  return value;
}

function blob(entries, digest, size, reason) {
  const entry = entries.get(`blobs/sha256/${digest.slice(7)}`);
  if (entry?.type !== "file" || entry.size !== size || `sha256:${sha256(entry.content)}` !== digest) fail(reason);
  return entry;
}

function archiveOptions(options) {
  if (!plain(options)) fail("options_invalid");
  const keys = Object.keys(options);
  if (keys.some((key) => !["imageId", "tag", "expectedDiffIds", "expectedLayers", "maximumBytes"].includes(key))) {
    fail("options_invalid");
  }
  requireDigest(options.imageId);
  if (typeof options.tag !== "string" || !TAG.test(options.tag) || !Array.isArray(options.expectedDiffIds)
    || options.expectedDiffIds.some((value) => !DIGEST.test(value))
    || new Set(options.expectedDiffIds).size !== options.expectedDiffIds.length) fail("options_invalid");
  const expectedLayers = options.expectedLayers ?? 12; const maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  if (expectedLayers !== 12 || options.expectedDiffIds.length !== expectedLayers || !Number.isSafeInteger(maximumBytes)
    || maximumBytes < BLOCK * 2 || maximumBytes > DEFAULT_MAXIMUM_BYTES) fail("options_invalid");
  return Object.freeze({ imageId: options.imageId, tag: options.tag,
    expectedDiffIds: Object.freeze([...options.expectedDiffIds]), expectedLayers, maximumBytes });
}

function validateCompatibilityBlobs(entries, referenced, expectedLayers, config) {
  const candidates = [...entries.values()].filter((entry) => entry.type === "file"
    && /^blobs\/sha256\/[0-9a-f]{64}$/u.test(entry.path) && !referenced.has(entry.path));
  if (candidates.length !== expectedLayers) fail("archive_compatibility_invalid");
  const records = candidates.map((entry) => {
    if (entry.size > MAXIMUM_JSON_BYTES || sha256(entry.content) !== entry.path.slice("blobs/sha256/".length)) {
      fail("archive_compatibility_invalid");
    }
    const value = parseJson(entry, "archive_compatibility_invalid");
    const allowed = ["architecture", "config", "container", "container_config", "created", "docker_version", "id", "os", "parent"];
    if (!plain(value) || Object.keys(value).some((key) => !allowed.includes(key)) || !HEX.test(value.id ?? "")
      || value.os !== "linux" || typeof value.created !== "string" || value.created.length < 1 || value.created.length > 64
      || !plain(value.container_config) || value.parent !== undefined && !HEX.test(value.parent)) {
      fail("archive_compatibility_invalid");
    }
    const rich = Object.hasOwn(value, "config");
    if (rich) {
      if (!exactKeys(value, allowed) || value.architecture !== config.architecture || value.os !== config.os
        || value.docker_version !== config.docker_version || typeof value.container !== "string"
        || !HEX.test(value.container) || !exact(value.config, config.config)) fail("archive_compatibility_invalid");
    } else {
      const keys = value.parent === undefined ? ["id", "created", "container_config", "os"]
        : ["id", "parent", "created", "container_config", "os"];
      if (!exactKeys(value, keys) || !exact(value.container_config, ZERO_CONTAINER_CONFIG)) {
        fail("archive_compatibility_invalid");
      }
    }
    return { blobDigest: `sha256:${entry.path.slice("blobs/sha256/".length)}`, id: value.id,
      parent: value.parent ?? null, rich };
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  if (byId.size !== expectedLayers || records.filter(({ parent }) => parent === null).length !== 1
    || records.filter(({ rich }) => rich).length !== 1
    || records.some(({ parent }) => parent !== null && !byId.has(parent))) fail("archive_compatibility_invalid");
  const children = new Map(records.map(({ id }) => [id, []]));
  for (const record of records) if (record.parent !== null) children.get(record.parent).push(record.id);
  if ([...children.values()].some((value) => value.length > 1)) fail("archive_compatibility_invalid");
  const root = records.find(({ parent }) => parent === null); const ordered = []; let current = root;
  while (current !== undefined) {
    ordered.push(current); const [next] = children.get(current.id); current = next === undefined ? undefined : byId.get(next);
  }
  if (ordered.length !== expectedLayers || !ordered.at(-1).rich) fail("archive_compatibility_invalid");
  return freezeArray(ordered);
}

export function validatePostgresCandidateArchive(buffer, options) {
  const expected = archiveOptions(options); const entries = parseTar(buffer, expected.maximumBytes);
  const manifest = parseJson(entries.get("manifest.json"), "archive_manifest_invalid");
  if (!Array.isArray(manifest) || manifest.length !== 1
    || !exactKeys(manifest[0], ["Config", "RepoTags", "Layers", "LayerSources"])) fail("archive_manifest_invalid");
  const item = manifest[0]; const configPath = `blobs/sha256/${expected.imageId.slice(7)}`;
  const layerPaths = expected.expectedDiffIds.map((digest) => `blobs/sha256/${digest.slice(7)}`);
  if (item.Config !== configPath || !exact(item.RepoTags, [expected.tag]) || !exact(item.Layers, layerPaths)
    || !plain(item.LayerSources) || Object.keys(item.LayerSources).length !== expected.expectedLayers) {
    fail("archive_manifest_invalid");
  }
  const rawLayers = expected.expectedDiffIds.map((digest) => {
    const source = item.LayerSources[digest];
    if (!exactKeys(source, ["mediaType", "size", "digest"]) || source.mediaType !== OCI_LAYER
    || source.digest !== digest || !Number.isSafeInteger(source.size) || source.size < BLOCK * 2
    || source.size % BLOCK !== 0
      || source.size > MAXIMUM_LAYER_BYTES) fail("archive_layer_source_invalid");
    const entry = blob(entries, digest, source.size, "archive_layer_invalid");
    return { digest, size: entry.size, mediaType: source.mediaType };
  });
  const configEntry = entries.get(configPath);
  if (configEntry?.type !== "file" || configEntry.size > MAXIMUM_JSON_BYTES
    || `sha256:${sha256(configEntry.content)}` !== expected.imageId) fail("archive_config_invalid");
  const config = parseJson(configEntry, "archive_config_invalid");
  if (config?.rootfs?.type !== "layers" || !exact(config.rootfs.diff_ids, expected.expectedDiffIds)) {
    fail("archive_config_invalid");
  }
  const layout = parseJson(entries.get("oci-layout"), "archive_oci_invalid");
  if (!exact(layout, { imageLayoutVersion: "1.0.0" })) fail("archive_oci_invalid");
  const index = parseJson(entries.get("index.json"), "archive_oci_invalid");
  if (!exactKeys(index, ["schemaVersion", "mediaType", "manifests"]) || index.schemaVersion !== 2
    || index.mediaType !== "application/vnd.oci.image.index.v1+json" || !Array.isArray(index.manifests)
    || index.manifests.length !== 1 || !exactKeys(index.manifests[0], ["mediaType", "digest", "size", "annotations"])) {
    fail("archive_oci_invalid");
  }
  const indexDescriptor = index.manifests[0]; const reference = expected.tag.slice(expected.tag.indexOf(":") + 1);
  descriptor({ mediaType: indexDescriptor.mediaType, digest: indexDescriptor.digest, size: indexDescriptor.size },
    [OCI_MANIFEST], "archive_oci_invalid");
  if (!exact(indexDescriptor.annotations, { "io.containerd.image.name": `docker.io/library/${expected.tag}`,
    "org.opencontainers.image.ref.name": reference })) fail("archive_oci_invalid");
  const ociManifestEntry = blob(entries, indexDescriptor.digest, indexDescriptor.size, "archive_oci_invalid");
  const ociManifest = parseJson(ociManifestEntry, "archive_oci_invalid");
  if (!exactKeys(ociManifest, ["schemaVersion", "mediaType", "config", "layers"])
    || ociManifest.schemaVersion !== 2 || ociManifest.mediaType !== OCI_MANIFEST
    || !Array.isArray(ociManifest.layers) || ociManifest.layers.length !== expected.expectedLayers) {
    fail("archive_oci_invalid");
  }
  descriptor(ociManifest.config, [OCI_CONFIG], "archive_oci_invalid");
  if (ociManifest.config.digest !== expected.imageId || ociManifest.config.size !== configEntry.size) {
    fail("archive_oci_invalid");
  }
  const ociLayers = ociManifest.layers.map((value) => {
    descriptor(value, [OCI_LAYER], "archive_oci_invalid");
    blob(entries, value.digest, value.size, "archive_oci_invalid");
    return { digest: value.digest, size: value.size, mediaType: value.mediaType };
  });
  if (!exact(ociLayers, rawLayers)) fail("archive_oci_invalid");
  const repositories = parseJson(entries.get("repositories"), "archive_repositories_invalid");
  const [repository, tag] = expected.tag.split(":");
  if (!exact(repositories, { [repository]: { [tag]: expected.expectedDiffIds.at(-1).slice(7) } })) {
    fail("archive_repositories_invalid");
  }
  const referenced = new Set([configPath, `blobs/sha256/${indexDescriptor.digest.slice(7)}`, ...layerPaths]);
  const compatibilityRecords = validateCompatibilityBlobs(entries, referenced, expected.expectedLayers, config);
  const allowed = new Set(["blobs/", "blobs/sha256/", "manifest.json", "index.json", "oci-layout", "repositories",
    ...referenced, ...compatibilityRecords.map(({ blobDigest }) => `blobs/sha256/${blobDigest.slice(7)}`)]);
  if (entries.size !== allowed.size || [...entries.keys()].some((name) => !allowed.has(name))) fail("archive_member_invalid");
  return Object.freeze({
    archiveSha256: sha256(buffer), archiveBytes: buffer.length, archiveMembers: entries.size,
    imageId: expected.imageId, tag: expected.tag, configDigest: expected.imageId, configBytes: configEntry.size,
    diffIds: Object.freeze([...expected.expectedDiffIds]), rawLayers: freezeArray(rawLayers),
    manifestDigest: indexDescriptor.digest, manifestBytes: indexDescriptor.size,
    compatibilityRecords, remoteLayerVerification: "NOT_ESTABLISHED_BY_DOCKER_SAVE",
  });
}

function remoteOptions(options) {
  if (!plain(options) || Object.keys(options).some((key) => !["digest", "configDigest", "expectedLayers", "baseLayers"].includes(key))) {
    fail("options_invalid");
  }
  requireDigest(options.digest); requireDigest(options.configDigest);
  const expectedLayers = options.expectedLayers ?? 12; const baseLayers = options.baseLayers;
  if (expectedLayers !== 12 || !Array.isArray(baseLayers) || baseLayers.length !== expectedLayers - 2) {
    fail("options_invalid");
  }
  for (const value of baseLayers) descriptor(value, [OCI_GZIP_LAYER, DOCKER_GZIP_LAYER], "options_invalid");
  return Object.freeze({ digest: options.digest, configDigest: options.configDigest, expectedLayers,
    baseLayers: freezeArray(baseLayers) });
}

export function validatePostgresCandidateRemoteManifest(raw, options) {
  const expected = remoteOptions(options);
  if (typeof raw !== "string") fail("remote_manifest_invalid");
  const bytes = Buffer.from(raw, "utf8");
  if (bytes.length < 2 || bytes.length > MAXIMUM_JSON_BYTES || `sha256:${sha256(bytes)}` !== expected.digest) {
    fail("remote_manifest_invalid");
  }
  let manifest;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch (error) { fail("remote_manifest_invalid", error); }
  if (!exactKeys(manifest, ["schemaVersion", "mediaType", "config", "layers"]) || manifest.schemaVersion !== 2
    || ![OCI_MANIFEST, DOCKER_MANIFEST].includes(manifest.mediaType) || !Array.isArray(manifest.layers)
    || manifest.layers.length !== expected.expectedLayers) fail("remote_manifest_invalid");
  const configMediaType = manifest.mediaType === OCI_MANIFEST ? OCI_CONFIG : DOCKER_CONFIG;
  const layerMediaType = manifest.mediaType === OCI_MANIFEST ? OCI_GZIP_LAYER : DOCKER_GZIP_LAYER;
  descriptor(manifest.config, [configMediaType], "remote_manifest_invalid");
  if (manifest.config.digest !== expected.configDigest || manifest.config.size > MAXIMUM_JSON_BYTES) {
    fail("remote_manifest_invalid");
  }
  const layers = manifest.layers.map((value) => {
    descriptor(value, [layerMediaType], "remote_manifest_invalid");
    return { digest: value.digest, size: value.size, mediaType: value.mediaType };
  });
  if (new Set(layers.map(({ digest }) => digest)).size !== layers.length
    || !expected.baseLayers.every((value, index) => exact(layers[index], value))) fail("remote_manifest_invalid");
  return Object.freeze({ sha256: expected.digest, size: bytes.length, mediaType: manifest.mediaType,
    configDigest: expected.configDigest, configBytes: manifest.config.size, layers: freezeArray(layers),
    baseLayerCount: expected.baseLayers.length, newLayerCount: expected.expectedLayers - expected.baseLayers.length,
    remoteLayerVerification: "PENDING_INDEPENDENT_READ" });
}

export const postgresCandidateProofLimits = Object.freeze({ archiveBytes: DEFAULT_MAXIMUM_BYTES,
  jsonBytes: MAXIMUM_JSON_BYTES, members: MAXIMUM_MEMBERS, layers: 12, layerBytes: MAXIMUM_LAYER_BYTES });
