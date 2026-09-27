import { isDeepStrictEqual } from "node:util";

const GOSU_OLD = "usr/local/bin/gosu";
const GOSU_NEW = "usr/bin/gosu";
const GOSU_NEW_ENTRY = Object.freeze({
  path: GOSU_NEW, type: "file", mode: 0o755, uid: 0, gid: 0,
  size: 1_977_120, sha256: "6d3214ab9d2f1e9ffda75ea2f6bb1f454a13a78dd70318e09eee814ce32cce03",
});
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))(?!.*\\)(?!.*\/\/)[\x21-\x7e]+(?<!\/)$/u;
const APK_PATH = /^(?:etc\/apk\/world|lib\/apk\/db\/(?:installed|scripts\.tar|triggers))$/u;

function invalid(check) {
  const error = new Error("postgres_gosu_filesystem_delta_invalid");
  error.diagnostic = { check };
  throw error;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validateEntry(entry) {
  if (!object(entry) || !SAFE_PATH.test(entry.path ?? "") || !["file", "directory", "symlink"].includes(entry.type) ||
      !Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777 ||
      !Number.isSafeInteger(entry.uid) || entry.uid < 0 || !Number.isSafeInteger(entry.gid) || entry.gid < 0 ||
      !Number.isSafeInteger(entry.mtime) || entry.mtime < 0 || !Number.isSafeInteger(entry.size) || entry.size < 0) invalid("entry_shape");
  const keys = entry.type === "file" ? ["path", "type", "mode", "uid", "gid", "mtime", "size", "sha256"]
    : entry.type === "symlink" ? ["path", "type", "mode", "uid", "gid", "mtime", "size", "linkname"]
      : ["path", "type", "mode", "uid", "gid", "mtime", "size"];
  if (!exactKeys(entry, keys) || (entry.type === "file" && !/^[a-f0-9]{64}$/u.test(entry.sha256)) ||
      (entry.type === "symlink" && (typeof entry.linkname !== "string" || entry.linkname.length === 0))) invalid("entry_shape");
}

function inventory(entries, check) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 100_000) invalid(check);
  const result = new Map();
  for (const entry of entries) {
    validateEntry(entry);
    if (result.has(entry.path)) invalid("duplicate_path");
    result.set(entry.path, entry);
  }
  return result;
}

function ancestors(path) {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join("/"));
}

function withoutMtime(entry) {
  const copy = { ...entry };
  delete copy.mtime;
  return copy;
}

function validateConfig(baseConfig, candidateConfig, expectedAdditionalLabels) {
  if (!object(baseConfig) || !object(candidateConfig) || !object(expectedAdditionalLabels)) invalid("config_shape");
  const labelEntries = Object.entries(expectedAdditionalLabels);
  if (labelEntries.length > 32 || labelEntries.some(([key, value]) => !key || key.length > 256 ||
      typeof value !== "string" || value.length === 0 || value.length > 4096)) invalid("config_labels");
  const baseLabels = baseConfig.Labels ?? {};
  const candidateLabels = candidateConfig.Labels ?? {};
  if (!object(baseLabels) || !object(candidateLabels) || labelEntries.some(([key]) => Object.hasOwn(baseLabels, key))) {
    invalid("config_labels");
  }
  const baseWithoutLabels = { ...baseConfig };
  const candidateWithoutLabels = { ...candidateConfig };
  delete baseWithoutLabels.Labels;
  delete candidateWithoutLabels.Labels;
  if (!isDeepStrictEqual(baseWithoutLabels, candidateWithoutLabels) ||
      !isDeepStrictEqual(candidateLabels, { ...baseLabels, ...expectedAdditionalLabels })) invalid("config_changed");
}

function executable(entry) {
  return entry?.type === "file" && (entry.mode & 0o111) !== 0;
}

function validateExpectedApkChanges(changes, base, candidate) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 8) invalid("apk_changes_missing");
  const paths = new Set();
  for (const change of changes) {
    if (!exactKeys(change, ["path", "before", "after"]) || !APK_PATH.test(change.path ?? "") || paths.has(change.path)) {
      invalid("apk_change_shape");
    }
    validateEntry(change.before);
    validateEntry(change.after);
    if (change.before.path !== change.path || change.after.path !== change.path || change.before.type !== "file" ||
        change.after.type !== "file" || isDeepStrictEqual(change.before, change.after) ||
        !isDeepStrictEqual(base.get(change.path), change.before) || !isDeepStrictEqual(candidate.get(change.path), change.after) ||
        executable(change.before) || executable(change.after)) invalid("apk_change_identity");
    paths.add(change.path);
  }
  return paths;
}

export function validatePostgresGosuFilesystemDelta(input = {}) {
  if (!exactKeys(input, ["baseEntries", "candidateEntries", "baseConfig", "candidateConfig", "expectedAdditionalLabels",
    "expectedApkChanges"])) {
    invalid("input_shape");
  }
  validateConfig(input.baseConfig, input.candidateConfig, input.expectedAdditionalLabels);
  const base = inventory(input.baseEntries, "base_inventory");
  const candidate = inventory(input.candidateEntries, "candidate_inventory");
  const oldGosu = base.get(GOSU_OLD);
  if (!oldGosu || oldGosu.type !== "file" || !executable(oldGosu) || candidate.has(GOSU_OLD) || base.has(GOSU_NEW)) {
    invalid("old_gosu_contract");
  }
  const newGosu = candidate.get(GOSU_NEW);
  if (!newGosu || !Object.entries(GOSU_NEW_ENTRY).every(([key, value]) => newGosu[key] === value)) invalid("new_gosu_identity");

  const apkPaths = validateExpectedApkChanges(input.expectedApkChanges, base, candidate);
  const changedPaths = new Set([GOSU_OLD, GOSU_NEW, ...apkPaths]);
  const directoryMtimePaths = new Set([...changedPaths].flatMap(ancestors));
  const allPaths = new Set([...base.keys(), ...candidate.keys()]);
  for (const path of allPaths) {
    const before = base.get(path);
    const after = candidate.get(path);
    if (changedPaths.has(path)) continue;
    if (before && after && directoryMtimePaths.has(path) && before.type === "directory" && after.type === "directory" &&
        isDeepStrictEqual(withoutMtime(before), withoutMtime(after))) continue;
    if (!isDeepStrictEqual(before, after)) invalid(executable(before) || executable(after) ? "unexpected_executable_change" : "unexpected_filesystem_change");
  }
  return Object.freeze({
    state: "VERIFIED_DIAGNOSTIC_DELTA", deleted: Object.freeze([GOSU_OLD]), added: Object.freeze([GOSU_NEW]),
    apkChanged: Object.freeze([...apkPaths].sort()), directoryMtimeOnly: Object.freeze([...directoryMtimePaths]
      .filter((path) => base.get(path)?.mtime !== candidate.get(path)?.mtime).sort()),
  });
}

export const postgresGosuFilesystemContract = Object.freeze({ oldPath: GOSU_OLD, newEntry: GOSU_NEW_ENTRY });
