import { createHash } from "node:crypto";
import { TextDecoder, TextEncoder, types } from "node:util";

const LOCK_ANCHOR = Object.freeze({ bytes: 7276, sha256: "34d6affcc89c60fae029831ac9569ca3967e65c542b4ba62817797843f43e031" });
const RAW_JSON_LIMIT = 65_536;
const BYTE_LIMIT = 67_108_864;
const DOCUMENT_LIMIT = 262_144;
const DOCUMENT_TOTAL_LIMIT = 1_048_576;
const RECIPE_LIMIT = 4_096;
const HEX = /^[0-9a-f]{64}$/u;
const handles = new WeakMap();
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
const typedByteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
const typedBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const arrayBufferResizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable")?.get;
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const typedSet = Uint8Array.prototype.set;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const RECIPE_TEXT = "FROM postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3\nCOPY --chown=0:0 gosu /usr/local/bin/gosu\nCOPY --chown=0:0 auto-world-gosu/ /usr/share/licenses/auto-world-gosu/\n";
function fail(code) { throw new Error(code); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function identity(bytes) { return Object.freeze({ bytes: bytes.byteLength, sha256: hash(bytes) }); }
function canonical(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function isPlain(value) { return value !== null && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactDataRecord(value, keys) {
  if (!isPlain(value)) return false;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || !names.every((name) => typeof name === "string" && keys.includes(name))) return false;
  return names.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor.enumerable && Object.hasOwn(descriptor, "value");
  });
}
function exactDenseArray(value, length) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || lengthDescriptor.value !== length) return false;
  const names = Reflect.ownKeys(value);
  if (names.length !== length + 1 || !names.includes("length")) return false;
  return Array.from({ length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    return Boolean(descriptor?.enumerable && Object.hasOwn(descriptor, "value"));
  }).every(Boolean);
}
function validIdentity(value) {
  return exactDataRecord(value, ["bytes", "sha256"]) && Number.isSafeInteger(value.bytes) && value.bytes >= 0
    && typeof value.sha256 === "string" && HEX.test(value.sha256);
}
function deepCloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepCloneFrozen));
  if (value && typeof value === "object") return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepCloneFrozen(child)])));
  return value;
}
function nativeBytesView(value, code) {
  if (value === null || typeof value !== "object" || types.isProxy(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Buffer.prototype && prototype !== Uint8Array.prototype) fail(code);
  let length; let offset; let backing;
  try {
    length = typedByteLength.call(value); offset = typedByteOffset.call(value); backing = typedBuffer.call(value);
  } catch { fail(code); }
  if (types.isSharedArrayBuffer(backing)) fail(code);
  try {
    if (arrayBufferResizable?.call(backing) === true) fail(code);
    const backingLength = arrayBufferByteLength.call(backing);
    new DataView(backing);
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(offset) || offset < 0 || offset + length > backingLength) fail(code);
  } catch { fail(code); }
  return { value, length };
}
function copyNativeBytes(value, cap, code) {
  const checked = nativeBytesView(value, code);
  if (checked.length > cap) fail(code);
  const copy = new Uint8Array(checked.length);
  try { typedSet.call(copy, checked.value); } catch { fail(code); }
  return copy;
}
function matchBytes(body, expected, cap, code) {
  if (!validIdentity(expected) || expected.bytes > cap) fail(code);
  const copy = copyNativeBytes(body, cap, code);
  const actual = identity(copy);
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) fail(code);
  return actual;
}
function file(path, mode, size, sha256) {
  return { path, type: "file", mode, uid: 0, gid: 0, mtime: 0, size, sha256 };
}
function buildContract(lock) {
  const base = {
    indexDigest: lock.base.indexDigest,
    platformDigest: lock.base.platformDigest,
    configId: lock.base.configId,
    platform: { os: "linux", architecture: "amd64", variant: null },
  };
  const baseExecutable = {
    path: "usr/local/bin/gosu", type: "file", mode: 0o755, uid: 0, gid: 0, mtime: 1789680549,
    size: 1769900, sha256: "52c8749d0142edd234e9d6bd5237dff2d81e71f43537e2f4f66f75dd4b243dd0",
  };
  const replacement = { ...lock.binary };
  const source = lock.sourceContract.source;
  const compiler = lock.sourceContract.compiler;
  const modules = lock.sourceContract.modules;
  const documents = lock.evidence.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }));
  const manifestValue = {
    kind: "POSTGRES_GOSU_DERIVATIVE_IMAGE_EVIDENCE_V2",
    schemaVersion: 2,
    component: lock.component,
    state: "PREPARATION_ONLY",
    authority: "NOT_AUTHORIZED",
    base,
    source: {
      module: source.module, version: source.version, commit: source.commit,
      archive: source.archive, goMod: source.goMod, goSum: source.goSum,
    },
    compiler: { version: compiler.version, identity: compiler.identity, archive: compiler.archive },
    modules: modules.map((item) => ({ id: item.id, path: item.path, version: item.version, zip: item.zip, mod: item.mod })),
    binary: replacement,
    preparation: {
      runId: lock.preparation.runId, headSha: lock.preparation.headSha, attempt: lock.preparation.attempt,
      event: lock.preparation.event, workflowId: lock.preparation.workflowId, repositoryId: lock.preparation.repositoryId,
      artifacts: lock.preparation.artifacts,
      acceptance: lock.preparation.acceptance,
      comparison: lock.preparation.comparison,
      documentProjection: lock.preparation.documentProjection,
    },
    documents,
    claims: {
      actualTestCount: 0, functionalValidation: "NOT_ESTABLISHED", vulnerabilityClearance: "NOT_ESTABLISHED", image: "UNBUILT",
    },
    dates: { supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null },
  };
  const manifestText = canonical(manifestValue);
  const manifestBytes = new TextEncoder().encode(manifestText);
  if (manifestBytes.byteLength > RAW_JSON_LIMIT) fail("postgres_gosu_derivative_evidence_invalid");
  const manifest = { text: manifestText, identity: identity(manifestBytes) };
  const recipeBytes = new TextEncoder().encode(RECIPE_TEXT);
  if (recipeBytes.byteLength > RECIPE_LIMIT) fail("postgres_gosu_derivative_context_invalid");
  const recipe = { text: RECIPE_TEXT, identity: identity(recipeBytes) };
  const evidenceFiles = [
    ...documents.map((item) => file(`usr/share/licenses/auto-world-gosu/${item.name}`, 0o644, item.bytes, item.sha256)),
    file("usr/share/licenses/auto-world-gosu/derivative-manifest.json", 0o644, manifest.identity.bytes, manifest.identity.sha256),
  ];
  const parentPaths = [
    { path: "usr", creation: { mode: 0o755, uid: 0, gid: 0 }, mtimePolicy: "BUILD_WINDOW" },
    { path: "usr/local", creation: { mode: 0o755, uid: 0, gid: 0 }, mtimePolicy: "BUILD_WINDOW" },
    { path: "usr/local/bin", creation: { mode: 0o755, uid: 0, gid: 0 }, mtimePolicy: "BUILD_WINDOW" },
    { path: "usr/share", creation: { mode: 0o755, uid: 0, gid: 0 }, mtimePolicy: "BUILD_WINDOW" },
    { path: "usr/share/licenses", creation: { mode: 0o755, uid: 0, gid: 0 }, mtimePolicy: "BUILD_WINDOW" },
    { path: "usr/share/licenses/auto-world-gosu", creation: { mode: 0o755, uid: 0, gid: 0 }, mtimePolicy: "ZERO" },
  ];
  const contextEntries = [
    file("Dockerfile", 0o644, recipe.identity.bytes, recipe.identity.sha256),
    file("gosu", 0o755, replacement.size, replacement.sha256),
    { path: "auto-world-gosu", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 0, size: 0 },
    ...evidenceFiles.map((item) => ({ ...item, path: `auto-world-gosu/${item.path.slice("usr/share/licenses/auto-world-gosu/".length)}` })),
  ];
  return deepCloneFrozen({
    schemaVersion: 2,
    authority: "NOT_AUTHORIZED",
    image: "UNBUILT",
    base,
    baseExecutable,
    replacement,
    evidenceFiles,
    parentPaths,
    manifest,
    recipe,
    contextEntries,
    builderProfile: "STRICT_INHERITED_CONFIG_V2",
  });
}

export function openCandidateLockV2(rawBytes) {
  const raw = copyNativeBytes(rawBytes, RAW_JSON_LIMIT, "postgres_gosu_derivative_lock_invalid");
  if (raw.byteLength !== LOCK_ANCHOR.bytes || hash(raw) !== LOCK_ANCHOR.sha256 || raw[0] === 0xef) fail("postgres_gosu_derivative_lock_invalid");
  let text; let value;
  try { text = textDecoder.decode(raw); value = JSON.parse(text); } catch { fail("postgres_gosu_derivative_lock_invalid"); }
  if (text !== canonical(value)) fail("postgres_gosu_derivative_lock_invalid");
  const snapshot = deepCloneFrozen(value);
  const contract = buildContract(snapshot);
  const handle = Object.freeze(Object.create(null));
  handles.set(handle, Object.freeze({ lock: snapshot, contract }));
  return handle;
}

export function candidateContractV2(handle) {
  if ((handle !== null && typeof handle === "object" && types.isProxy(handle)) || !handles.has(handle)) fail("postgres_gosu_derivative_lock_invalid");
  return deepCloneFrozen(handles.get(handle).contract);
}

export function matchExactBytesV2(body, expectedIdentity) {
  return matchBytes(body, expectedIdentity, BYTE_LIMIT, "postgres_gosu_derivative_binary_identity_invalid");
}

export function validateCandidateContextV2(handle, input) {
  if ((handle !== null && typeof handle === "object" && types.isProxy(handle)) || !handles.has(handle)) fail("postgres_gosu_derivative_context_invalid");
  if (!exactDataRecord(input, ["entries"]) || !exactDenseArray(input.entries, 15)) fail("postgres_gosu_derivative_context_invalid");
  const contract = handles.get(handle).contract;
  const expectedByPath = new Map(contract.contextEntries.map((entry) => [entry.path, entry]));
  const entriesByPath = new Map();
  let bodyTotal = 0;
  let evidenceBodyTotal = 0;
  for (const entry of input.entries) {
    const directoryKeys = ["path", "type", "mode", "uid", "gid", "mtime"];
    if (!exactDataRecord(entry, directoryKeys) && !exactDataRecord(entry, [...directoryKeys, "body"])) fail("postgres_gosu_derivative_context_invalid");
    if (typeof entry.path !== "string" || entry.path.length > 512 || entriesByPath.has(entry.path)) fail("postgres_gosu_derivative_context_invalid");
    const expected = expectedByPath.get(entry.path);
    if (!expected) fail("postgres_gosu_derivative_context_invalid");
    if (expected.type === "directory") {
      if (!exactDataRecord(entry, ["path", "type", "mode", "uid", "gid", "mtime"])) fail("postgres_gosu_derivative_context_invalid");
    } else {
      if (!exactDataRecord(entry, ["path", "type", "mode", "uid", "gid", "mtime", "body"])) fail("postgres_gosu_derivative_context_invalid");
    }
    for (const key of ["path", "type", "mode", "uid", "gid", "mtime"]) if (entry[key] !== expected[key]) fail("postgres_gosu_derivative_context_invalid");
    entriesByPath.set(expected.path, entry);
    if (expected.type === "file") {
      const viewed = nativeBytesView(entry.body, "postgres_gosu_derivative_context_invalid");
      const cap = expected.path === "gosu" ? BYTE_LIMIT : expected.path === "Dockerfile" ? RECIPE_LIMIT : DOCUMENT_LIMIT;
      if (viewed.length > cap) fail("postgres_gosu_derivative_context_invalid");
      bodyTotal += viewed.length;
      if (expected.path.startsWith("auto-world-gosu/")) evidenceBodyTotal += viewed.length;
    }
  }
  if (evidenceBodyTotal > DOCUMENT_TOTAL_LIMIT || bodyTotal > BYTE_LIMIT + DOCUMENT_TOTAL_LIMIT + RECIPE_LIMIT) fail("postgres_gosu_derivative_context_invalid");
  let evidenceBytes = 0;
  for (const expected of contract.contextEntries) {
    const entry = entriesByPath.get(expected.path);
    if (expected.type === "directory") continue;
    const actual = matchBytes(entry.body, { bytes: expected.size, sha256: expected.sha256 },
      entry.path === "gosu" ? BYTE_LIMIT : entry.path === "Dockerfile" ? RECIPE_LIMIT : DOCUMENT_LIMIT,
      "postgres_gosu_derivative_context_invalid");
    if (entry.path.startsWith("auto-world-gosu/")) evidenceBytes += actual.bytes;
  }
  if (evidenceBytes > DOCUMENT_TOTAL_LIMIT) fail("postgres_gosu_derivative_context_invalid");
  return deepCloneFrozen({
    scope: "CONTEXT_BYTES_MATCH_SOURCE_CONTRACT_ONLY",
    authority: "NOT_AUTHORIZED",
    image: "UNBUILT",
    files: 14,
    directories: 1,
    binary: { bytes: contract.replacement.size, sha256: contract.replacement.sha256 },
    evidenceBytes,
    manifest: contract.manifest.identity,
    recipe: contract.recipe.identity,
  });
}
