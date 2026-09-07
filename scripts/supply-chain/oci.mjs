import {
  assertClosedObject,
  canonicalJsonBuffer,
  parseBoundedJson,
  sha256,
  StrictDataError,
} from "./strict-json.mjs";

const OCI_LAYOUT_MEDIA = "application/vnd.oci.image.layout.header.v1+json";
const OCI_INDEX_MEDIA = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST_MEDIA = "application/vnd.oci.image.manifest.v1+json";
const OCI_CONFIG_MEDIA = "application/vnd.oci.image.config.v1+json";
const REF_ANNOTATION = "org.opencontainers.image.ref.name";
const JSON_LIMIT = 4 * 1024;
const LAYOUT_LIMIT = 32 * 1024;
const ASSET_LIMIT = 256 * 1024;

const fail = (code) => {
  throw new StrictDataError(code);
};
const digestOf = (bytes) => `sha256:${sha256(bytes)}`;
const blobPath = (digest) => `blobs/sha256/${digest.slice(7)}`;
const descriptor = (mediaType, bytes, extra = {}) => ({
  mediaType,
  digest: digestOf(bytes),
  size: bytes.byteLength,
  ...extra,
});

export function createBootstrapFixture() {
  const layout = canonicalJsonBuffer({ imageLayoutVersion: "1.0.0" });
  const config = canonicalJsonBuffer({
    architecture: "amd64",
    config: {},
    history: [],
    os: "linux",
    rootfs: { diff_ids: [], type: "layers" },
  });
  const configDescriptor = descriptor(OCI_CONFIG_MEDIA, config);
  const manifest = canonicalJsonBuffer({
    config: configDescriptor,
    layers: [],
    mediaType: OCI_MANIFEST_MEDIA,
    schemaVersion: 2,
  });
  const child = descriptor(OCI_MANIFEST_MEDIA, manifest, {
    platform: { architecture: "amd64", os: "linux" },
  });
  const inner = canonicalJsonBuffer({
    manifests: [child],
    mediaType: OCI_INDEX_MEDIA,
    schemaVersion: 2,
  });
  const parent = descriptor(OCI_INDEX_MEDIA, inner, {
    annotations: { [REF_ANNOTATION]: "bootstrap" },
  });
  const outer = canonicalJsonBuffer({ manifests: [parent], schemaVersion: 2 });
  const files = new Map([
    ["oci-layout", layout],
    ["index.json", outer],
    [blobPath(parent.digest), inner],
    [blobPath(child.digest), manifest],
    [blobPath(configDescriptor.digest), config],
  ]);
  return {
    childDigest: child.digest,
    configDigest: configDescriptor.digest,
    files,
    parentDigest: parent.digest,
  };
}

const exactKeys = (value, keys) => assertClosedObject(value, keys);
const parseCanonical = (bytes) => {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) fail("OCI_FILE_INVALID");
  if (bytes.byteLength > JSON_LIMIT) fail("OCI_JSON_TOO_LARGE");
  const parsed = parseBoundedJson(bytes, {
    maxBytes: JSON_LIMIT,
    maxDepth: 12,
    maxMembers: 128,
  });
  if (!Buffer.from(bytes).equals(canonicalJsonBuffer(parsed))) fail("OCI_JSON_NONCANONICAL");
  return parsed;
};
const assertDigest = (digest) => {
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) fail("OCI_DIGEST_INVALID");
};
const validateDescriptor = (value, mediaType, { annotations = false, platform = false } = {}) => {
  exactKeys(
    value,
    ["digest", "mediaType", "size", ...(annotations ? ["annotations"] : []), ...(platform ? ["platform"] : [])],
  );
  if (value.mediaType !== mediaType) fail("OCI_MEDIA_TYPE_INVALID");
  assertDigest(value.digest);
  if (!Number.isSafeInteger(value.size) || value.size < 0 || value.size > ASSET_LIMIT) {
    fail("OCI_SIZE_INVALID");
  }
  return value;
};
const requireSingleton = (value) => {
  if (!Array.isArray(value) || value.length !== 1) fail("OCI_DESCRIPTOR_COUNT_INVALID");
  return value[0];
};

export function validateBootstrapFixture(files) {
  if (!(files instanceof Map)) fail("OCI_FILES_INVALID");
  let total = 0;
  for (const [name, bytes] of files) {
    if (typeof name !== "string" || !Buffer.isBuffer(bytes)) fail("OCI_FILE_INVALID");
    if (name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) {
      fail("OCI_PATH_INVALID");
    }
    if (bytes.byteLength > ASSET_LIMIT) fail("OCI_ASSET_TOO_LARGE");
    total += bytes.byteLength;
    if (total > LAYOUT_LIMIT) fail("OCI_LAYOUT_TOO_LARGE");
  }
  if (!files.has("oci-layout") || !files.has("index.json")) fail("OCI_FILE_MISSING");

  const layout = parseCanonical(files.get("oci-layout"));
  exactKeys(layout, ["imageLayoutVersion"]);
  if (layout.imageLayoutVersion !== "1.0.0") fail("OCI_LAYOUT_VERSION_INVALID");

  const outer = parseCanonical(files.get("index.json"));
  exactKeys(outer, ["manifests", "schemaVersion"]);
  if (outer.schemaVersion !== 2 || Object.hasOwn(outer, "mediaType")) fail("OCI_OUTER_INVALID");
  const parent = validateDescriptor(requireSingleton(outer.manifests), OCI_INDEX_MEDIA, {
    annotations: true,
  });
  exactKeys(parent.annotations, [REF_ANNOTATION]);
  if (parent.annotations[REF_ANNOTATION] !== "bootstrap") fail("OCI_REFERENCE_INVALID");

  const expectedPaths = new Set(["oci-layout", "index.json"]);
  const load = (entry) => {
    const path = blobPath(entry.digest);
    expectedPaths.add(path);
    const bytes = files.get(path);
    if (!bytes) fail("OCI_BLOB_MISSING");
    if (bytes.byteLength !== entry.size) fail("OCI_SIZE_MISMATCH");
    if (digestOf(bytes) !== entry.digest) fail("OCI_DIGEST_MISMATCH");
    return { bytes, parsed: parseCanonical(bytes) };
  };

  const inner = load(parent).parsed;
  exactKeys(inner, ["manifests", "mediaType", "schemaVersion"]);
  if (inner.schemaVersion !== 2 || inner.mediaType !== OCI_INDEX_MEDIA) fail("OCI_INNER_INVALID");
  const child = validateDescriptor(requireSingleton(inner.manifests), OCI_MANIFEST_MEDIA, {
    platform: true,
  });
  exactKeys(child.platform, ["architecture", "os"]);
  if (child.platform.os !== "linux" || child.platform.architecture !== "amd64") {
    fail("OCI_PLATFORM_INVALID");
  }
  if (child.digest === parent.digest) fail("OCI_GRAPH_CYCLE");

  const manifest = load(child).parsed;
  exactKeys(manifest, ["config", "layers", "mediaType", "schemaVersion"]);
  if (manifest.schemaVersion !== 2 || manifest.mediaType !== OCI_MANIFEST_MEDIA) {
    fail("OCI_MANIFEST_INVALID");
  }
  if (!Array.isArray(manifest.layers) || manifest.layers.length !== 0) fail("OCI_LAYERS_INVALID");
  const configEntry = validateDescriptor(manifest.config, OCI_CONFIG_MEDIA);
  if (new Set([parent.digest, child.digest, configEntry.digest]).size !== 3) fail("OCI_GRAPH_CYCLE");

  const config = load(configEntry).parsed;
  exactKeys(config, ["architecture", "config", "history", "os", "rootfs"]);
  exactKeys(config.config, []);
  exactKeys(config.rootfs, ["diff_ids", "type"]);
  if (
    config.architecture !== "amd64" ||
    config.os !== "linux" ||
    !Array.isArray(config.history) ||
    config.history.length !== 0 ||
    config.rootfs.type !== "layers" ||
    !Array.isArray(config.rootfs.diff_ids) ||
    config.rootfs.diff_ids.length !== 0
  ) {
    fail("OCI_CONFIG_INVALID");
  }
  for (const path of files.keys()) {
    if (!expectedPaths.has(path)) fail("OCI_FILE_ORPHAN");
  }
  if (files.size !== expectedPaths.size) fail("OCI_FILE_MISSING");

  return Object.freeze({
    childDigest: child.digest,
    configDigest: configEntry.digest,
    parentDigest: parent.digest,
  });
}

export const OCI_MEDIA_TYPES = Object.freeze({
  config: OCI_CONFIG_MEDIA,
  index: OCI_INDEX_MEDIA,
  layout: OCI_LAYOUT_MEDIA,
  manifest: OCI_MANIFEST_MEDIA,
});
