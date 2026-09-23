import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import sourceLock from "../../infra/seaweed/seaweed-lock.json" with { type: "json" };
import { createNoticePlan } from "./notices.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const copy = (value) => JSON.parse(JSON.stringify(value));
const fail = (reason) => { throw new Error(`seaweed_image_${reason}`); };
const HEX = /^[a-f0-9]{64}$/u;
const REVISION = /^[a-f0-9]{40}$/u;
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))(?!.*\\)(?!.*\/\/)[\x21-\x7e]+(?<!\/)$/u;

export const baseMaterialIdentities = Object.freeze({
  "base-manifest.json": Object.freeze({ sha256: "f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362", size: 2193 }),
  "base-config.json": Object.freeze({ sha256: "31d61f5e8771cbd5993912cd051be0c7bcdc207faaa12c50e1a3b8371631c927", size: 13676 }),
  "base-filesystem.json": Object.freeze({ sha256: "82a8ea5decc1dfd578eacfa8fdf146423c34c357b9cfc1f962ed2b32942a5180", size: 116924 }),
});
const oldBinaryHashes = new Set([
  "dc7f0bd80235fa27dcaa19bfe13e37f4b7fc27c9f26e0153fc58f2bc7489f41d",
  "b2f00d79b4052e75c2b0dbe256283438c04a2fea6f3e12459b0d6d646bc90ad5",
  "163eef53fc85a2074e2cd5eb980b902b30a2e766b2f3c189ac60180cce46931e",
]);
const removedPaths = ["usr/bin/weed-volume", "usr/bin/weed-worker"];
const runtimeFields = ["Entrypoint", "Cmd", "Env", "WorkingDir", "Volumes", "ExposedPorts"];
const backendContract = Object.freeze({ method: "MOBY_IMAGE_IMPORT", platform: "linux/amd64", serverVersion: "28.0.4", store: "CLASSIC_CONFIG_ID" });
const serializedDefaults = Object.freeze({ Hostname: "", Domainname: "", AttachStdin: false, AttachStdout: false,
  AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Image: "", OnBuild: null });

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function validateEntry(entry) {
  const fields = ["path", "type", "mode", "uid", "gid", "mtime", "size"];
  if (entry?.type === "file") fields.push("sha256");
  else if (entry?.type === "symlink") fields.push("linkname");
  else if (entry?.type !== "directory") fail("inventory_entry_invalid");
  if (!exactKeys(entry, fields) || typeof entry.path !== "string" || !PATH.test(entry.path) ||
      entry.path.split("/").some((part) => part.startsWith(".wh.")) ||
      !Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777 ||
      [entry.uid, entry.gid, entry.mtime, entry.size].some((value) => !Number.isSafeInteger(value) || value < 0) ||
      (entry.type !== "file" && entry.size !== 0) ||
      (entry.type === "file" && (typeof entry.sha256 !== "string" || !HEX.test(entry.sha256))) ||
      (entry.type === "symlink" && (typeof entry.linkname !== "string" || !entry.linkname || /[\0\r\n\\]/u.test(entry.linkname)))) {
    fail("inventory_entry_invalid");
  }
}

export function validateBaseMaterials(materials) {
  if (!(materials instanceof Map) || !isDeepStrictEqual([...materials.keys()].sort(), Object.keys(baseMaterialIdentities).sort())) fail("base_material_set_invalid");
  const parsed = {};
  for (const [name, identity] of Object.entries(baseMaterialIdentities)) {
    const bytes = materials.get(name);
    if (!Buffer.isBuffer(bytes) || bytes.length !== identity.size || hash(bytes) !== identity.sha256) fail("base_material_identity_invalid");
    parsed[name] = JSON.parse(bytes.toString("utf8"));
  }
  const manifest = parsed["base-manifest.json"];
  const config = parsed["base-config.json"];
  const filesystem = parsed["base-filesystem.json"];
  if (manifest.config.digest !== `sha256:${baseMaterialIdentities["base-config.json"].sha256}` ||
      manifest.config.size !== baseMaterialIdentities["base-config.json"].size || manifest.layers.length !== 10 ||
      config.os !== "linux" || config.architecture !== "amd64" || config.rootfs.type !== "layers" ||
      config.rootfs.diff_ids.length !== 10 || Object.hasOwn(config.config, "User") || config.config.ArgsEscaped !== true ||
      !exactKeys(config.config, [...runtimeFields, "Labels", "ArgsEscaped"]) ||
      filesystem.schemaVersion !== 1 || filesystem.entries.length !== 561) fail("base_contract_invalid");
  const paths = new Set();
  for (const entry of filesystem.entries) {
    validateEntry(entry);
    if (paths.has(entry.path)) fail("base_contract_invalid");
    paths.add(entry.path);
  }
  return { manifest, config, entries: filesystem.entries };
}

function sourceMetadata(value) {
  if (!exactKeys(value, ["binary", "runId", "attempt", "codeRevision", "recipeRevision", "createdAt"]) || value.attempt !== 1 ||
      !exactKeys(value.binary, ["sha256", "size"]) || typeof value.binary.sha256 !== "string" || !HEX.test(value.binary.sha256) || /^0+$/u.test(value.binary.sha256) || oldBinaryHashes.has(value.binary.sha256) ||
      !Number.isSafeInteger(value.binary.size) || value.binary.size < 1 || value.binary.size > 512 * 1024 ** 2 ||
      typeof value.runId !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value.runId) ||
      typeof value.codeRevision !== "string" || !REVISION.test(value.codeRevision) || /^0+$/u.test(value.codeRevision) ||
      typeof value.recipeRevision !== "string" || !REVISION.test(value.recipeRevision) || /^0+$/u.test(value.recipeRevision) ||
      typeof value.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.createdAt) ||
      !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) fail("source_manifest_invalid");
  return copy(value);
}

// Structural planning only. The future adapter must authenticate the run and
// independently compare complete source artifacts before using these inputs.
export function createTransformPlan({ baseMaterials, source, moduleClosureBytes, materials, backend }) {
  if (!isDeepStrictEqual(backend, backendContract)) fail("backend_contract_invalid");
  const base = validateBaseMaterials(baseMaterials);
  const provenance = sourceMetadata(source);
  const notices = createNoticePlan({ moduleClosureBytes, materials, baseEntries: base.entries.map(({ path, type }) => ({ path, type })) });
  const preserved = base.entries.filter((entry) => entry.path !== "usr/bin/weed" && !removedPaths.includes(entry.path));
  const binary = { path: "usr/bin/weed", type: "file", mode: 0o755, uid: 0, gid: 0,
    mtime: sourceLock.source.commitUnixTime, size: provenance.binary.size, sha256: provenance.binary.sha256 };
  const additions = notices.entries.map(({ path, type, mode, uid, gid, mtime, size, sha256 }) =>
    ({ path, type, mode, uid, gid, mtime, size, ...(type === "file" ? { sha256 } : {}) }));
  const entries = [...preserved, binary, ...additions].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const seen = new Set();
  for (const entry of entries) {
    validateEntry(entry);
    if (seen.has(entry.path) || (entry.type === "file" && oldBinaryHashes.has(entry.sha256))) fail("plan_inventory_invalid");
    seen.add(entry.path);
  }
  if (preserved.length !== 558 || entries.length !== 559 + additions.length) fail("plan_inventory_invalid");
  const config = Object.fromEntries(runtimeFields.map((key) => [key, copy(base.config.config[key])]));
  Object.assign(config, serializedDefaults);
  config.User = "";
  config.Labels = {
    "org.opencontainers.image.title": "Auto World SeaweedFS S3",
    "org.opencontainers.image.description": "Bounded Go server/S3 derivative; Rust helper commands are unsupported.",
    "org.opencontainers.image.source": "https://github.com/CleMeY15/auto-world",
    "org.opencontainers.image.revision": provenance.recipeRevision,
    "org.opencontainers.image.version": sourceLock.build.commitValue,
    "org.opencontainers.image.created": provenance.createdAt,
    "org.opencontainers.image.base.name": "docker.io/chrislusf/seaweedfs:4.47",
    "org.opencontainers.image.base.digest": `sha256:${baseMaterialIdentities["base-manifest.json"].sha256}`,
    "com.auto-world.profile": "seaweed-s3-v1",
    "com.auto-world.source.commit": sourceLock.source.commit,
    "com.auto-world.source.patch": sourceLock.patch.sha256,
    "com.auto-world.source.run": provenance.runId,
    "com.auto-world.source.attempt": String(provenance.attempt),
    "com.auto-world.source.code-revision": provenance.codeRevision,
  };
  return {
    kind: "SEAWEED_TRANSFORM_PLAN_V1", authority: "PREPARATION_ONLY",
    base: { repository: "chrislusf/seaweedfs", platform: "linux/amd64", materials: copy(baseMaterialIdentities),
      layers: copy(base.manifest.layers), diffIds: [...base.config.rootfs.diff_ids], labels: copy(base.config.config.Labels) },
    source: provenance, backend: copy(backendContract),
    changeSet: { preserved: preserved.length, replaced: ["usr/bin/weed"], removed: [...removedPaths], added: additions.map((entry) => entry.path) },
    entries, config,
    configChanges: {
      preserved: [...runtimeFields],
      serializedDefaults: copy(serializedDefaults),
      normalizations: [
        { field: "User", before: "ABSENT", after: "PRESENT_EMPTY", reason: "DOCKER_IMPORT_LINUX_DEFAULT_USER" },
        { field: "ArgsEscaped", before: true, after: "ABSENT", reason: "DOCKER_IMPORT_WINDOWS_ONLY_FIELD" },
      ],
      labels: { removed: Object.keys(base.config.config.Labels).sort(), added: Object.keys(config.Labels).sort() },
      imageMetadata: { preserved: ["os", "architecture"], removed: ["moby.buildkit.cache.v0"], replaced: ["created", "history", "rootfs"] },
    },
    notices,
  };
}

export function validatePlannedFilesystem(actualEntries, inputs) {
  const plan = createTransformPlan(inputs);
  if (!Array.isArray(actualEntries) || actualEntries.length !== plan.entries.length) fail("candidate_inventory_mismatch");
  const seen = new Set();
  for (const entry of actualEntries) {
    validateEntry(entry);
    if (seen.has(entry.path)) fail("candidate_inventory_mismatch");
    seen.add(entry.path);
  }
  const sorted = [...actualEntries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!isDeepStrictEqual(sorted, plan.entries)) fail("candidate_inventory_mismatch");
  return { kind: "SEAWEED_INVENTORY_PLAN_MATCH_V1", authority: "PREPARATION_ONLY", entries: sorted.length };
}

export function validatePlannedRuntimeConfig(actualConfig, inputs) {
  const plan = createTransformPlan(inputs);
  if (!isDeepStrictEqual(actualConfig, plan.config)) fail("candidate_config_mismatch");
  return { kind: "SEAWEED_CONFIG_PLAN_MATCH_V1", authority: "PREPARATION_ONLY" };
}
