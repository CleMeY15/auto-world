import { isDeepStrictEqual, types } from "node:util";

import { candidateContractV2 } from "./gosu-derivative-candidate-v2.mjs";
import { validatePostgresConfigDelta } from "./evidence.mjs";

const FS_ERROR = "postgres_gosu_derivative_filesystem_delta_invalid";
const CONFIG_ERROR = "postgres_gosu_derivative_config_delta_invalid";
const MAX_MTIME = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
const EXECUTABLE = "usr/local/bin/gosu";
const EVIDENCE_ROOT = "usr/share/licenses/auto-world-gosu";
const DOCUMENT_NAMES = ["gosu-LICENSE", "moby-user-LICENSE", "go-LICENSE", "go-PATENTS", "x-sys-LICENSE",
  "x-sys-PATENTS", "notices.json", "module-closure.json", "sbom.cdx.json", "version.txt", "build-info.txt",
  "derivative-manifest.json"];
const PARENTS = ["usr", "usr/local", "usr/local/bin", "usr/share", "usr/share/licenses", EVIDENCE_ROOT];
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?($|\/))(?!.*\\)(?!.*\/\/)[\x21-\x7e]+(?<!\/)$/u;
const SHA = /^[a-f0-9]{64}$/u;

function fail(code = FS_ERROR) { throw new Error(code); }

// Inspect only own data descriptors after rejecting proxies. Callers never supply callbacks.
function record(value, keys, code = FS_ERROR) {
  if (value === null || typeof value !== "object" || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > 256 || ownKeys.some((key) => typeof key !== "string") ||
      (keys && (ownKeys.length !== keys.length || keys.some((key) => !ownKeys.includes(key))))) fail(code);
  const copy = {};
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail(code);
    Object.defineProperty(copy, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return copy;
}

function array(value, maximum, code = FS_ERROR) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) fail(code);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(value).length !== length + 1) fail(code);
  const copy = new Array(length);
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) fail(code);
    copy[index] = descriptor.value;
  }
  return copy;
}

function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function path(value) {
  return typeof value === "string" && value.length <= 512 && PATH.test(value) && value.split("/").length <= 32;
}

function entry(value) {
  const item = record(value);
  const fields = ["path", "type", "mode", "uid", "gid", "mtime", "size"];
  if (!path(item.path) || !["file", "directory", "symlink", "hardlink"].includes(item.type) ||
      !integer(item.mode, 0o7777) || !integer(item.uid, 2147483647) || !integer(item.gid, 2147483647) ||
      !integer(item.mtime, MAX_MTIME) || !integer(item.size)) fail();
  if (item.type === "file") {
    fields.push("sha256");
    if (typeof item.sha256 !== "string" || !SHA.test(item.sha256)) fail();
  } else if (item.type === "directory") {
    if (item.size !== 0) fail();
  } else {
    fields.push("linkname");
    if (typeof item.linkname !== "string" || item.linkname.length === 0 || item.linkname.length > 1024 ||
        Buffer.byteLength(item.linkname) > 1024 || (item.type === "hardlink" && (!path(item.linkname) || item.size !== 0))) fail();
  }
  record(item, fields);
  return item;
}

function inventory(value) {
  const entries = array(value, 100000);
  if (entries.length === 0) fail();
  const result = new Map();
  let pathBytes = 0;
  for (const value of entries) {
    const item = entry(value);
    pathBytes += item.path.length + (item.linkname ? Buffer.byteLength(item.linkname) : 0);
    if (pathBytes > 153600000 || result.has(item.path)) fail();
    result.set(item.path, item);
  }
  for (const item of result.values()) {
    if (item.type === "hardlink") {
      const target = result.get(item.linkname);
      if (target?.type !== "file" || ["mode", "uid", "gid", "mtime"].some((key) => target[key] !== item[key])) fail();
    }
  }
  return result;
}

function installedFile(value, expectedPath, mode) {
  const item = entry(value);
  if (item.path !== expectedPath || item.type !== "file" || item.mode !== mode || item.uid !== 0 || item.gid !== 0) fail();
  return item;
}

function expectation(value) {
  const input = record(value, ["baseExecutable", "replacement", "evidenceFiles", "parentPaths", "mtimeWindow"]);
  const baseExecutable = installedFile(input.baseExecutable, EXECUTABLE, 0o755);
  const replacement = installedFile(input.replacement, EXECUTABLE, 0o755);
  if (baseExecutable.size === 0 || baseExecutable.size > 67108864 || replacement.size === 0 ||
      replacement.size > 67108864 || replacement.mtime !== 0 || isDeepStrictEqual(baseExecutable, replacement)) fail();
  const files = array(input.evidenceFiles, 12);
  if (files.length !== 12) fail();
  let documentBytes = 0;
  const evidenceFiles = files.map((value, index) => {
    const item = installedFile(value, `${EVIDENCE_ROOT}/${DOCUMENT_NAMES[index]}`, 0o644);
    documentBytes += item.size;
    if (item.mtime !== 0 || item.size > 262144 || documentBytes > 1048576) fail();
    return item;
  });
  const parents = array(input.parentPaths, 6);
  if (parents.length !== 6) fail();
  const parentPaths = parents.map((value, index) => {
    const item = record(value, ["path", "creation", "mtimePolicy"]);
    const creation = record(item.creation, ["mode", "uid", "gid"]);
    if (item.path !== PARENTS[index] || creation.mode !== 0o755 || creation.uid !== 0 || creation.gid !== 0 ||
        item.mtimePolicy !== (index === 5 ? "ZERO" : "BUILD_WINDOW")) fail();
    return { path: item.path, creation, mtimePolicy: item.mtimePolicy };
  });
  const window = record(input.mtimeWindow, ["startSeconds", "endSeconds"]);
  if (!integer(window.startSeconds, MAX_MTIME) || !integer(window.endSeconds, MAX_MTIME) ||
      window.startSeconds > window.endSeconds || window.endSeconds - window.startSeconds > 600) fail();
  return { baseExecutable, replacement, evidenceFiles, parentPaths, mtimeWindow: window };
}

function withoutMtime(value) { const copy = { ...value }; delete copy.mtime; return copy; }
function parentOf(value) { return value.slice(0, value.lastIndexOf("/")); }
function frozenPaths(values) { return Object.freeze([...values].sort()); }

export function compareFilesystemInventoriesV2(value) {
  const input = record(value, ["baseEntries", "candidateEntries", "expectation"]);
  const expected = expectation(input.expectation);
  const base = inventory(input.baseEntries);
  const candidate = inventory(input.candidateEntries);
  if (base.has("usr/bin/gosu") || candidate.has("usr/bin/gosu") ||
      !isDeepStrictEqual(base.get(EXECUTABLE), expected.baseExecutable) ||
      !isDeepStrictEqual(candidate.get(EXECUTABLE), expected.replacement)) fail();
  const evidencePaths = new Set(expected.evidenceFiles.map((item) => item.path));
  for (const item of expected.evidenceFiles) {
    if (base.has(item.path) || !isDeepStrictEqual(candidate.get(item.path), item)) fail();
  }
  for (const [name] of base) {
    if (name.startsWith(`${EVIDENCE_ROOT}/`)) fail();
  }
  for (const [name] of candidate) {
    if (name.startsWith(`${EVIDENCE_ROOT}/`) && !evidencePaths.has(name)) fail();
  }
  const addedDirectories = new Set();
  for (const parent of expected.parentPaths) {
    if (!base.has(parent.path)) addedDirectories.add(parent.path);
  }
  const directChanges = new Set([EXECUTABLE, ...evidencePaths, ...addedDirectories].map(parentOf));
  const mtimeChangedDirectories = new Set();
  const inWindow = (value) => value >= expected.mtimeWindow.startSeconds && value <= expected.mtimeWindow.endSeconds;
  for (const parent of expected.parentPaths) {
    const before = base.get(parent.path);
    const after = candidate.get(parent.path);
    if (!after || after.type !== "directory") fail();
    if (before) {
      if (before.type !== "directory" || !isDeepStrictEqual(withoutMtime(before), withoutMtime(after))) fail();
      if (parent.mtimePolicy === "ZERO") {
        if (before.mtime !== 0 || after.mtime !== 0) fail();
      } else if (before.mtime !== after.mtime) {
        if (!directChanges.has(parent.path) || !inWindow(after.mtime)) fail();
        mtimeChangedDirectories.add(parent.path);
      }
    } else {
      if (!isDeepStrictEqual(withoutMtime(after), { path: parent.path, type: "directory", ...parent.creation, size: 0 }) ||
          (parent.mtimePolicy === "ZERO" ? after.mtime !== 0 : !inWindow(after.mtime))) fail();
    }
  }
  // The base must already represent the executable's literal directory chain.
  if (PARENTS.slice(0, 3).some((name) => base.get(name)?.type !== "directory")) fail();
  const allowed = new Set([EXECUTABLE, ...evidencePaths, ...PARENTS]);
  for (const name of new Set([...base.keys(), ...candidate.keys()])) {
    if (!allowed.has(name) && !isDeepStrictEqual(base.get(name), candidate.get(name))) fail();
  }
  return Object.freeze({ scope: "FILESYSTEM_PREDICATE_MATCH_ONLY", authority: "NOT_AUTHORIZED",
    baseMembers: base.size, candidateMembers: candidate.size, replaced: Object.freeze([EXECUTABLE]),
    addedFiles: frozenPaths(evidencePaths), addedDirectories: frozenPaths(addedDirectories),
    mtimeChangedDirectories: frozenPaths(mtimeChangedDirectories) });
}

function configuration(value) {
  const seen = new WeakSet();
  let nodes = 0;
  let serializedBytes = 0;
  function addBytes(count) {
    serializedBytes += count;
    if (serializedBytes > 65536) fail(CONFIG_ERROR);
  }
  function copy(value, depth) {
    if (++nodes > 4096 || depth > 16) fail(CONFIG_ERROR);
    if (value === null || typeof value === "boolean") { addBytes(Buffer.byteLength(JSON.stringify(value))); return value; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail(CONFIG_ERROR);
      addBytes(Buffer.byteLength(JSON.stringify(value))); return value;
    }
    if (typeof value === "string") {
      if (value.length > 8192 || Buffer.byteLength(value) > 8192) fail(CONFIG_ERROR);
      addBytes(Buffer.byteLength(JSON.stringify(value))); return value;
    }
    if (typeof value !== "object" || types.isProxy(value) || seen.has(value)) fail(CONFIG_ERROR);
    seen.add(value);
    if (Array.isArray(value)) {
      const items = array(value, 1024, CONFIG_ERROR);
      addBytes(2 + Math.max(0, items.length - 1));
      return items.map((item) => copy(item, depth + 1));
    }
    const object = record(value, undefined, CONFIG_ERROR);
    const keys = Object.keys(object);
    addBytes(2 + Math.max(0, keys.length - 1) + keys.length);
    const result = {};
    for (const key of keys) {
      if (key.length > 256 || Buffer.byteLength(key) > 256) fail(CONFIG_ERROR);
      addBytes(Buffer.byteLength(JSON.stringify(key)));
      Object.defineProperty(result, key, { value: copy(object[key], depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  // A runtime configuration is an object, even though its descendant values may be scalars.
  record(value, undefined, CONFIG_ERROR);
  const result = copy(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) !== serializedBytes) fail(CONFIG_ERROR);
  return result;
}

export function validateCandidateConfigurationV2(handle, value) {
  candidateContractV2(handle);
  const input = record(value, ["baseConfig", "candidateConfig"], CONFIG_ERROR);
  const base = configuration(input.baseConfig);
  const candidate = configuration(input.candidateConfig);
  try { validatePostgresConfigDelta(base, candidate, {}, undefined); }
  catch { fail(CONFIG_ERROR); }
  if (!isDeepStrictEqual(base, candidate)) fail(CONFIG_ERROR);
  return Object.freeze({ scope: "CONFIG_PREDICATE_MATCH_ONLY", authority: "NOT_AUTHORIZED", profile: "STRICT_INHERITED_CONFIG_V2" });
}

export function validateCandidateFilesystemV2(handle, value) {
  const contract = candidateContractV2(handle);
  const input = record(value, ["baseEntries", "candidateEntries", "baseConfig", "candidateConfig", "buildWindow"]);
  const window = record(input.buildWindow, ["startedAtMs", "completedAtMs"]);
  if (!integer(window.startedAtMs) || !integer(window.completedAtMs) || window.startedAtMs > window.completedAtMs ||
      window.completedAtMs - window.startedAtMs > 600000) fail();
  validateCandidateConfigurationV2(handle, { baseConfig: input.baseConfig, candidateConfig: input.candidateConfig });
  const delta = compareFilesystemInventoriesV2({ baseEntries: input.baseEntries, candidateEntries: input.candidateEntries,
    expectation: { baseExecutable: contract.baseExecutable, replacement: contract.replacement, evidenceFiles: contract.evidenceFiles,
      parentPaths: contract.parentPaths,
      mtimeWindow: { startSeconds: Math.floor(window.startedAtMs / 1000), endSeconds: Math.floor(window.completedAtMs / 1000) } } });
  return Object.freeze({ ...delta, scope: "CONDITIONAL_ON_AUTHENTICATED_OCI" });
}
