import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, readdirSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import { posix as path } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";
import { inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";
import { POSTGRES_GOSU_SOURCE_PIN as PIN, POSTGRES_GOSU_SOURCE_CLAIMS as CLAIMS, postgresGosuSourceLimits as LIMITS } from "./gosu-source-policy.mjs";

const PREFIX = "postgres_gosu_source_";
const PHASES = Object.freeze(["SOURCE", "INPUTS", "COPY", "INSPECT", "PUBLISH", "FINAL_SEAL"]);
const FAILURE_PHASES = ["CONTEXT", ...PHASES, "OUTPUT", "CLEANUP"];
const REASONS = new Set(["arguments_invalid", "requires_native_actor", "source_invalid", "git_invalid", "storage_invalid", "capacity_invalid",
  "file_invalid", "file_changed", "python_invalid", "inspection_failed", "proof_invalid", "publication_failed", "deadline_exceeded", "aborted",
  "cleanup_uncertain", "output_failed", "operation_failed"]);
const META = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const STABLE = ["dev", "ino", "uid", "gid", "mode", "nlink"];
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const HEX = /^[0-9a-f]{64}$/u;
const REV = /^[0-9a-f]{40}$/u;
const ACTOR = Object.freeze({ uid: 1000, gid: 1000, capabilities: "ZERO", noNewPrivs: 1 });
const ARCHIVE_COUNTS = Object.freeze([{ entries: 27, uncompressedBytes: 50265 }, { entries: 7, uncompressedBytes: 42341 },
  { entries: 506, uncompressedBytes: 8794105 }, { entries: 16677, uncompressedBytes: 145142081 }]);
const MISSING = Object.freeze(["COMPLETE_APK_SOURCE_AND_NOTICES", "POSTGRESQL_SOURCE_AND_NOTICES", "RETAINED_LOWER_LAYER_COVERAGE", "OFFICIAL_ATTESTATION_BUNDLE", "SECOND_WINDOWS_EVIDENCE_COPY"]);
const plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, keys) => plain(v) && Reflect.ownKeys(v).every((key) => typeof key === "string") && isDeepStrictEqual(Reflect.ownKeys(v).sort(), [...keys].sort()) && Reflect.ownKeys(v).every((key) => {
  const d = Object.getOwnPropertyDescriptor(v, key); return typeof key === "string" && d.enumerable && Object.hasOwn(d, "value");
});
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([key, item]) => [key, freeze(item)]))) : v;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const absolute = (v) => typeof v === "string" && v.length <= 1024 && v !== "/" && path.isAbsolute(v) && path.normalize(v) === v && !/[\0\r\n\\]/u.test(v);
const relative = (v) => typeof v === "string" && /^[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*$/u.test(v) && v.split("/").every((part) => part !== "." && part !== "..");
const reasons = new WeakMap();
const errorValue = (reason) => { const error = new Error(PREFIX + reason); reasons.set(error, reason); return error; };
const fail = (reason) => { throw errorValue(reason); };
const native = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const directoryNative = (s) => Object.fromEntries(DIRECTORY.map((key) => [key, native(s)[key]]));
function dataTree(value, depth = 0, budget = { left: 10000 }) {
  if (--budget.left < 0 || depth > 20) fail("proof_invalid");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) fail("proof_invalid"); return;
  }
  const array = Array.isArray(value);
  if (!array && !plain(value) || array && (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1)) fail("proof_invalid");
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value") || array && !/^(?:0|[1-9][0-9]*)$/u.test(key)) fail("proof_invalid");
    dataTree(d.value, depth + 1, budget);
  }
}
function metadata(value, size, uid = 1000, gid = 1000, mode = 0o600) {
  return exact(value, META) && ["dev", "ino", "mtimeNs", "ctimeNs"].every((key) => typeof value[key] === "string" && DECIMAL.test(value[key])) &&
    ["uid", "gid", "mode", "nlink", "size"].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0) &&
    value.uid === uid && value.gid === gid && value.mode === mode && value.nlink === 1 && value.size === size;
}
function ownValue(value, key) { try { const d = Object.getOwnPropertyDescriptor(value ?? {}, key); return d && Object.hasOwn(d, "value") ? d.value : undefined; } catch { return undefined; } }
function safeReason(error) {
  const branded = reasons.get(error); if (branded) return branded;
  if (!types.isNativeError(error)) return "operation_failed";
  const message = ownValue(error, "message");
  if (typeof message === "string" && message.startsWith(PREFIX) && REASONS.has(message.slice(PREFIX.length))) return message.slice(PREFIX.length);
  if (message === "postgres_private_evidence_source_bundle_git_invalid") return "git_invalid";
  if (["postgres_private_evidence_source_bundle_cleanup_uncertain", "postgres_private_evidence_source_bundle_git_cleanup_uncertain"].includes(message)) return "cleanup_uncertain";
  return "operation_failed";
}
export function postgresGosuSourceRetentionFailureDiagnostic(error) {
  const reason = safeReason(error); const known = reasons.has(error) || types.isNativeError(error);
  const phase = known ? ownValue(error, "phase") : undefined; const cleanup = known ? ownValue(error, "cleanup") : undefined;
  return Object.freeze({ code: PREFIX + reason, phase: FAILURE_PHASES.includes(phase) ? phase : "CONTEXT",
    cleanup: reason !== "cleanup_uncertain" && cleanup === "CONFIRMED" ? "CONFIRMED" : "UNVERIFIED" });
}
export function validatePostgresGosuSourceRetentionFailureDiagnostic(value) {
  try {
    dataTree(value);
    if (!exact(value, ["code", "phase", "cleanup"]) || typeof value.code !== "string" || !value.code.startsWith(PREFIX) || !REASONS.has(value.code.slice(PREFIX.length)) ||
      !FAILURE_PHASES.includes(value.phase) || !["CONFIRMED", "UNVERIFIED"].includes(value.cleanup) || value.code === PREFIX + "cleanup_uncertain" && value.cleanup !== "UNVERIFIED") fail("proof_invalid");
    return freeze({ ...value });
  } catch { fail("proof_invalid"); }
}
function inputValue(value, pin, requireInputIdentity = false) {
  dataTree(pin);
  if (!exact(pin, Object.keys(PIN))) fail("arguments_invalid");
  const fields = ["workspace", "recipeRevision", "executionId", "directory", ...(plain(value) && Object.hasOwn(value, "signal") ? ["signal"] : [])];
  if (!exact(value, fields) || value.workspace !== pin.workspace || !absolute(value.workspace) || typeof value.recipeRevision !== "string" || !REV.test(value.recipeRevision) ||
    typeof value.executionId !== "string" || !/^local-gosu-source-retention-[0-9a-f]{24}$/u.test(value.executionId) || !absolute(value.directory) ||
    value.directory !== path.join(pin.parent, pin.directoryPrefix + value.executionId.slice(PIN.executionPrefix.length)) || value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal) ||
    !absolute(pin.parent) || !absolute(pin.inputDirectory) || pin.directoryPrefix !== PIN.directoryPrefix || pin.executionPrefix !== PIN.executionPrefix || pin.subject !== PIN.subject ||
    !isDeepStrictEqual(pin.python, PIN.python) || !isDeepStrictEqual(pin.inspector, PIN.inspector) || !isDeepStrictEqual(pin.recipe, PIN.recipe) ||
    !exact(pin.parentIdentity, DIRECTORY) || pin.parentIdentity.uid !== 1000 || pin.parentIdentity.gid !== 1000 || pin.parentIdentity.mode !== 0o750 ||
    requireInputIdentity && (!exact(pin.inputDirectoryIdentity, DIRECTORY) || pin.inputDirectoryIdentity.uid !== 1000 || pin.inputDirectoryIdentity.gid !== 1000 || pin.inputDirectoryIdentity.mode !== 0o700) ||
    !Array.isArray(pin.archives) || pin.archives.length !== 4 || pin.archives.some((a, i) => !exact(a, Object.keys(PIN.archives[i])) ||
      !Number.isSafeInteger(a.size) || a.size < 1 || a.size > LIMITS.sourceBytes || typeof a.sha256 !== "string" || !HEX.test(a.sha256) ||
      Object.keys(a).filter((key) => !["size", "sha256"].includes(key)).some((key) => !isDeepStrictEqual(a[key], PIN.archives[i][key]))) ||
    pin.archives.reduce((total, a) => total + a.size, 0) > LIMITS.inputBytes ||
    [pin.inputDirectory, value.workspace].some((v) => value.directory === v || value.directory.startsWith(v + "/") || v.startsWith(value.directory + "/"))) fail("arguments_invalid");
  return value;
}
function inspectionValue(value, pin, includeBytes) {
  try {
    dataTree(value); dataTree(pin);
    if (!exact(value, ["kind", "state", "scope", "archives"]) || value.kind !== "POSTGRES_GOSU_SOURCE_INSPECTION_V1" || value.state !== "VERIFIED" ||
      value.scope !== "FIXED_GOSU_GO_DECLARED_SOURCE_ARCHIVES" || !Array.isArray(value.archives) || value.archives.length !== 4 || Buffer.byteLength(JSON.stringify(value)) > LIMITS.inspectionBytes) fail("proof_invalid");
    let selectedBytes = 0;
    for (const [i, expected] of pin.archives.entries()) {
      const a = value.archives[i]; const selected = [...expected.selectedFiles].sort((x, y) => x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
      if (!exact(a, ["role", "name", "size", "sha256", "identity", "entries", "uncompressedBytes", "selectedFiles", "missingSelectedFiles", "bindings"]) ||
        ["role", "name", "size", "sha256"].some((key) => a[key] !== expected[key]) || !metadata(a.identity, a.size) ||
        a.entries !== ARCHIVE_COUNTS[i].entries || a.uncompressedBytes !== ARCHIVE_COUNTS[i].uncompressedBytes ||
        !isDeepStrictEqual(a.bindings, expected.bindings) || !isDeepStrictEqual(a.missingSelectedFiles, [...expected.missingSelectedFiles].sort()) ||
        !Array.isArray(a.selectedFiles) || a.selectedFiles.length !== selected.length) fail("proof_invalid");
      for (const [j, file] of selected.entries()) {
        const v = a.selectedFiles[j];
        if (!exact(v, ["path", "size", "sha256", ...(includeBytes ? ["base64"] : [])]) || v.path !== file.path || v.size !== file.size || v.sha256 !== file.sha256 || v.size > 16 * 1024) fail("proof_invalid");
        selectedBytes += v.size;
        if (includeBytes) {
          if (typeof v.base64 !== "string" || v.base64.length > 24000) fail("proof_invalid"); const bytes = Buffer.from(v.base64, "base64");
          if (bytes.length !== v.size || bytes.toString("base64") !== v.base64 || hash(bytes) !== file.sha256) fail("proof_invalid");
        }
      }
    }
    if (selectedBytes > 128 * 1024 || new Set(value.archives.map((a) => a.identity.dev + ":" + a.identity.ino)).size !== 4) fail("proof_invalid");
    if (includeBytes) {
      const gosuSum = Buffer.from(value.archives[0].selectedFiles.find((v) => v.path === "go.sum").base64, "base64").toString("utf8");
      for (const a of value.archives.slice(1, 3)) for (const [version, h1] of [[a.bindings.version, a.bindings.h1], [a.bindings.version + "/go.mod", a.bindings.goModH1]])
        if (!gosuSum.split("\n").includes(`${a.bindings.module} ${version} ${h1}`)) fail("proof_invalid");
    }
    return freeze(globalThis.structuredClone(value));
  } catch { fail("proof_invalid"); }
}
export function validatePostgresGosuSourceInspection(value, pin = PIN) { return inspectionValue(value, pin, true); }
export function validatePostgresGosuSourceInspectionMetadata(value, pin = PIN) { return inspectionValue(value, pin, false); }
export function validatePostgresGosuSourceRetentionReceipt(value, input, pin = PIN) {
  try {
    dataTree(value); inputValue(input, pin);
    if (!exact(value, ["kind", "state", "authority", "scope", "subject", "recipeRevision", "executionId", "directory", "filesystem", "actor", "sources", "inspection",
      "python", "recipe", "claims", "requiredMissing", "phases", "sourceUnchanged"]) || value.kind !== "POSTGRES_GOSU_SOURCE_RETENTION_V1" || value.state !== "SOURCES_RETAINED" ||
      value.authority !== "LOCAL_DIAGNOSTIC" || value.scope !== "FOUR_FIXED_GOSU_GO_SOURCE_ARCHIVES" || value.subject !== pin.subject || value.filesystem !== "EXT4" ||
      ["recipeRevision", "executionId", "directory"].some((key) => value[key] !== input[key]) || !isDeepStrictEqual(value.actor, ACTOR) || !isDeepStrictEqual(value.claims, CLAIMS) ||
      !isDeepStrictEqual(value.requiredMissing, MISSING) || value.sourceUnchanged !== true || !Array.isArray(value.sources) || value.sources.length !== 4 ||
      !Array.isArray(value.phases) || value.phases.length !== PHASES.length || value.phases.some((v, i) => !exact(v, ["name", "result", "durationMs"]) || v.name !== PHASES[i] ||
        v.result !== "PASSED" || !Number.isSafeInteger(v.durationMs) || v.durationMs < 0 || v.durationMs > LIMITS.operationMs) ||
      !exact(value.python, ["executable", "version", "trust", "transitiveStdlibClosure", "files"]) ||
      ["executable", "version", "trust", "transitiveStdlibClosure"].some((key) => value.python[key] !== pin.python[key]) || !Array.isArray(value.python.files) || value.python.files.length !== 3 ||
      !exact(value.recipe, ["source", "size", "sha256", "identity"]) || ["source", "size", "sha256"].some((key) => value.recipe[key] !== pin.recipe[key]) ||
      !metadata(value.recipe.identity, pin.recipe.size, 1000, 1000, value.recipe.identity.mode) || (value.recipe.identity.mode & 0o7022) !== 0 ||
      Buffer.byteLength(JSON.stringify(value)) > LIMITS.receiptBytes) fail("proof_invalid");
    const inspection = validatePostgresGosuSourceInspectionMetadata(value.inspection, pin); const ids = [];
    for (const [i, expected] of pin.archives.entries()) {
      const a = value.sources[i];
      if (!exact(a, ["role", "name", "sourceUrl", "size", "sha256", "sourceIdentity", "identity"]) ||
        ["role", "name", "sourceUrl", "size", "sha256"].some((key) => a[key] !== expected[key]) || !metadata(a.sourceIdentity, a.size) ||
        !metadata(a.identity, a.size) || !isDeepStrictEqual(a.identity, inspection.archives[i].identity)) fail("proof_invalid");
      ids.push(a.sourceIdentity.dev + ":" + a.sourceIdentity.ino, a.identity.dev + ":" + a.identity.ino);
    }
    if (new Set(ids).size !== 8) fail("proof_invalid");
    for (const [i, expected] of pin.python.files.entries()) {
      const v = value.python.files[i];
      if (!exact(v, ["source", "size", "mode", "sha256", "identity"]) || ["source", "size", "mode", "sha256"].some((key) => v[key] !== expected[key]) ||
        !metadata(v.identity, v.size, 0, 0, expected.mode)) fail("proof_invalid");
    }
    return freeze(globalThis.structuredClone(value));
  } catch { fail("proof_invalid"); }
}
export function validatePostgresGosuSourceRetentionAcknowledgement(value, expected) {
  try {
    dataTree(value); dataTree(expected);
    if (!exact(expected, ["recipeRevision", "executionId", "directory"]) || typeof expected.recipeRevision !== "string" || !REV.test(expected.recipeRevision) ||
      typeof expected.executionId !== "string" || !/^local-gosu-source-retention-[0-9a-f]{24}$/u.test(expected.executionId) || !absolute(expected.directory) ||
      !exact(value, ["kind", "state", "recipeRevision", "executionId", "directory", "receipt", "sourceUnchanged", "descriptorsClosed"]) ||
      value.kind !== "POSTGRES_GOSU_SOURCE_RETENTION_ACK_V1" || value.state !== "SOURCES_RETAINED" || value.sourceUnchanged !== true || value.descriptorsClosed !== true ||
      ["recipeRevision", "executionId", "directory"].some((key) => value[key] !== expected[key]) || !exact(value.receipt, ["name", "size", "sha256", "identity"]) ||
      value.receipt.name !== "receipt.json" || !Number.isSafeInteger(value.receipt.size) || value.receipt.size < 1 || value.receipt.size > LIMITS.receiptBytes ||
      typeof value.receipt.sha256 !== "string" || !HEX.test(value.receipt.sha256) || !metadata(value.receipt.identity, value.receipt.size) ||
      Buffer.byteLength(JSON.stringify(value)) > LIMITS.acknowledgementBytes) fail("proof_invalid");
    return freeze(globalThis.structuredClone(value));
  } catch { fail("proof_invalid"); }
}

function nativeActor() {
  if (process.platform !== "linux" || process.versions.node !== "22.23.2" || process.getuid() !== 1000 || process.getgid() !== 1000 || process.geteuid() !== 1000 || process.getegid() !== 1000 ||
    !isDeepStrictEqual(process.getgroups(), [1000])) fail("requires_native_actor");
  const status = readFileSync("/proc/self/status", "utf8");
  if (["CapInh", "CapPrm", "CapEff", "CapAmb"].some((key) => !new RegExp(`^${key}:[ \\t]+0{16}$`, "mu").test(status)) ||
    !/^NoNewPrivs:[ \t]+1$/mu.test(status) || !/^Groups:[ \t]*$/mu.test(status) ||
    !/^Uid:[ \t]+1000[ \t]+1000[ \t]+1000[ \t]+1000$/mu.test(status) || !/^Gid:[ \t]+1000[ \t]+1000[ \t]+1000[ \t]+1000$/mu.test(status)) fail("requires_native_actor");
}
async function outputWithinDeadline(action, acknowledgement, signal, deadline) {
  if (signal.aborted || Date.now() >= deadline) fail("output_failed");
  let timer; let abort;
  try {
    await Promise.race([Promise.resolve().then(() => action(acknowledgement)), new Promise((resolve, reject) => {
      abort = () => reject(errorValue("output_failed")); signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, Math.min(LIMITS.outputMs, deadline - Date.now()));
    })]);
    if (signal.aborted || Date.now() >= deadline) fail("output_failed");
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}
function session(deadline, signal) {
  const handles = []; const anchors = new Map(); let closed = false;
  const check = () => { if (signal.aborted) fail("aborted"); if (Date.now() >= deadline) fail("deadline_exceeded"); };
  const anchor = (file, rootOnly = false) => {
    let at = "/";
    for (const part of ["", ...file.split("/").filter(Boolean)]) {
      if (part) at = path.join(at, part); const s = lstatSync(at, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(at) !== at || !(rootOnly ? s.uid === 0n : [0n, 1000n].includes(s.uid)) ||
        (s.mode & 0o6000n) !== 0n || (s.mode & 0o0022n) !== 0n && !(s.uid === 0n && (s.mode & 0o1000n) !== 0n && !rootOnly)) fail("storage_invalid");
      if (anchors.has(at)) continue;
      const fd = openSync(at, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(fd); anchors.set(at, { fd, identity: directoryNative(s) });
    }
  };
  const guards = (bounded = true) => {
    if (bounded) check();
    for (const [file, entry] of anchors) {
      const s = lstatSync(file, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(file) !== file || !isDeepStrictEqual(directoryNative(s), entry.identity) ||
        !closed && !isDeepStrictEqual(directoryNative(fstatSync(entry.fd, { bigint: true })), entry.identity)) fail("file_changed");
    }
  };
  const directory = (file, expected) => {
    anchor(file); if (!isDeepStrictEqual(directoryNative(lstatSync(file, { bigint: true })), expected) || statfsSync(file, { bigint: true }).type !== 0xef53n) fail("storage_invalid");
    const result = spawnSync("/usr/bin/findmnt", ["--noheadings", "--output", "FSTYPE", "--target", file], { timeout: Math.min(10000, Math.max(1, deadline - Date.now())), maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
    if (result.error || result.status !== 0 || result.signal || result.stderr.length || !result.stdout.equals(Buffer.from("ext4\n"))) fail("storage_invalid"); guards();
  };
  const fileGuard = (item, unchanged = true) => {
    guards(); const s = fstatSync(item.fd, { bigint: true }); const named = lstatSync(item.file, { bigint: true }); const id = native(s);
    if (!s.isFile() || !named.isFile() || named.isSymbolicLink() || realpathSync(item.file) !== item.file || !isDeepStrictEqual(native(named), id) ||
      !metadata(id, item.expected.size, item.uid, item.gid, item.mode) || unchanged && item.identity && !isDeepStrictEqual(item.identity, id)) fail("file_changed"); return id;
  };
  const open = (file, expected, uid = 1000, gid = 1000, mode = 0o600, rootOnly = false) => {
    anchor(path.dirname(file), rootOnly); guards(); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); handles.push(fd);
    const item = { file, fd, expected, uid, gid, mode }; item.identity = fileGuard(item);
    const flags = /^flags:[ \t]+([0-7]+)$/mu.exec(readFileSync(`/proc/self/fdinfo/${fd}`, "utf8"));
    if (!flags || (Number.parseInt(flags[1], 8) & 3) !== constants.O_RDONLY) fail("file_invalid"); return item;
  };
  const read = (item, retain = false) => {
    fileGuard(item); const buffer = Buffer.alloc(Math.min(1024 ** 2, item.expected.size)); const digest = createHash("sha256"); const chunks = []; let at = 0;
    while (at < item.expected.size) { check(); const n = readSync(item.fd, buffer, 0, Math.min(buffer.length, item.expected.size - at), at);
      if (n < 1) fail("file_changed"); digest.update(buffer.subarray(0, n)); if (retain) chunks.push(Buffer.from(buffer.subarray(0, n))); at += n; }
    if (readSync(item.fd, Buffer.alloc(1), 0, 1, at) !== 0 || digest.digest("hex") !== item.expected.sha256) fail("file_changed"); fileGuard(item);
    return retain ? Buffer.concat(chunks) : undefined;
  };
  const create = (file, expected) => {
    anchor(path.dirname(file)); guards(); const fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); handles.push(fd);
    return { file, fd, expected, uid: 1000, gid: 1000, mode: 0o600, own: native(fstatSync(fd, { bigint: true })) };
  };
  const copy = (source, file) => {
    fileGuard(source); const target = create(file, source.expected); const buffer = Buffer.alloc(Math.min(1024 ** 2, source.expected.size)); let at = 0;
    while (at < source.expected.size) { check(); const n = readSync(source.fd, buffer, 0, Math.min(buffer.length, source.expected.size - at), at);
      if (n < 1) fail("file_changed"); let wrote = 0; while (wrote < n) { const count = writeSync(target.fd, buffer, wrote, n - wrote, at + wrote); if (count < 1) fail("publication_failed"); wrote += count; } at += n; }
    fsyncSync(target.fd); target.identity = fileGuard(target, false); read(source); read(target); return target;
  };
  const publish = (file, bytes) => {
    const item = create(file, { size: bytes.length, sha256: hash(bytes) });
    return { item, finish() { let at = 0; while (at < bytes.length) { check(); const n = writeSync(item.fd, bytes, at, bytes.length - at, at); if (n < 1) fail("publication_failed"); at += n; }
      fsyncSync(item.fd); item.identity = fileGuard(item, false); if (!read(item, true).equals(bytes)) fail("publication_failed"); } };
  };
  const close = () => { if (closed) return; closed = true; let uncertain = false; for (const fd of handles.splice(0)) try { closeSync(fd); } catch { uncertain = true; }
    if (uncertain) fail("cleanup_uncertain"); };
  const retire = (item) => {
    guards(false); const s = lstatSync(item.file, { bigint: true }); const id = native(s);
    if (!s.isFile() || s.isSymbolicLink() || realpathSync(item.file) !== item.file || STABLE.some((key) => id[key] !== item.own[key])) fail("cleanup_uncertain"); unlinkSync(item.file);
  };
  return { guards, directory, open, read, create, copy, publish, close, retire, fileGuard, check };
}
function gitBlob(input, source, deadline) {
  if (!relative(source)) fail("source_invalid");
  const r = spawnSync("/usr/bin/git", ["--no-replace-objects", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "cat-file", "blob", `${input.recipeRevision}:${source}`], {
    cwd: input.workspace, timeout: Math.min(LIMITS.commandMs, Math.max(1, deadline - Date.now())), maxBuffer: 256 * 1024,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file" } });
  if (r.error || r.status !== 0 || r.signal || r.stderr.length || r.stdout.length < 1) fail("source_invalid"); return r.stdout;
}
async function inspectCopies(items, script, pin, signal, deadline) {
  const controller = new globalThis.AbortController(); const bounded = globalThis.AbortSignal.any([signal, controller.signal]);
  let child; let timeout; let termination; let failure; let settled = false;
  const stdout = []; const stderr = []; let bytes = 0; let stderrBytes = 0;
  try {
    return await new Promise((resolve, reject) => {
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(termination); bounded.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(value); };
      const abort = () => stop(signal.aborted ? "aborted" : "inspection_failed");
      const stop = (reason) => {
        failure ??= reason; if (child && child.exitCode === null && child.signalCode === null) try { child.kill("SIGKILL"); } catch { failure = "cleanup_uncertain"; }
        termination ??= setTimeout(() => { child?.stdout?.destroy(); child?.stderr?.destroy(); finish(errorValue("cleanup_uncertain")); }, LIMITS.cleanupMs);
      };
      if (bounded.aborted || Date.now() >= deadline) { finish(errorValue(signal.aborted ? "aborted" : "deadline_exceeded")); return; }
      child = spawn(pin.python.executable, pin.python.arguments, { cwd: "/", env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: "/home/autoworld" },
        stdio: ["ignore", "pipe", "pipe", ...items.map((v) => v.fd), script.fd] });
      bounded.addEventListener("abort", abort, { once: true }); timeout = setTimeout(() => stop("deadline_exceeded"), Math.min(LIMITS.inspectionMs, deadline - Date.now()));
      child.on("error", () => { failure = "inspection_failed"; stop(failure); });
      child.stdout.on("error", () => stop("inspection_failed")); child.stderr.on("error", () => stop("inspection_failed"));
      child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > LIMITS.inspectionBytes) stop("inspection_failed"); else stdout.push(Buffer.from(chunk)); });
      child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; if (stderrBytes > 1024) stop("inspection_failed"); else stderr.push(Buffer.from(chunk)); });
      child.on("close", (code, sig) => {
        if (Buffer.concat(stderr).equals(Buffer.from("postgres_gosu_source_inspect_cleanup_uncertain\n"))) failure = "cleanup_uncertain";
        if (failure || code !== 0 || sig || stderrBytes !== 0 || !child.stdout.readableEnded || !child.stderr.readableEnded) { finish(errorValue(failure ?? "inspection_failed")); return; }
        try { const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(stdout)); const value = JSON.parse(raw);
          if (raw !== JSON.stringify(value) + "\n") fail("inspection_failed"); finish(null, validatePostgresGosuSourceInspection(value, pin));
        } catch { finish(errorValue("inspection_failed")); }
      });
    });
  } finally { controller.abort(); clearTimeout(timeout); clearTimeout(termination); }
}
function fixedControls(controls, dependencies) {
  if (!exact(controls, Object.hasOwn(controls ?? {}, "result") ? ["result"] : []) || controls.result !== undefined && typeof controls.result !== "function" ||
    !exact(dependencies, Object.hasOwn(dependencies ?? {}, "pin") ? ["pin"] : [])) fail("arguments_invalid");
}
async function publishAndAcknowledge({ held, input, source, all, receipt, controls, signal, deadline, inventory, onPublication, onOutput, partial }) {
  const bytes = Buffer.from(JSON.stringify(receipt) + "\n"); if (bytes.length > LIMITS.receiptBytes) fail("publication_failed");
  const pending = held.publish(path.join(input.directory, "receipt.json"), bytes); onPublication(pending.item); pending.finish();
  for (const item of all) held.read(item);
  if (!isDeepStrictEqual(source, await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }))) fail("source_invalid");
  for (const item of all) held.read(item);
  inventory(true); if (!held.read(pending.item, true).equals(bytes)) fail("publication_failed"); held.guards(); held.close();
  const expected = { recipeRevision: input.recipeRevision, executionId: input.executionId, directory: input.directory };
  const receiptFile = { name: "receipt.json", size: bytes.length, sha256: hash(bytes), identity: pending.item.identity };
  const acknowledgement = partial ? freeze({ kind: "TEST_ONLY_POSTGRES_GOSU_COPY_PUBLICATION_ACK_V1", state: "PARTIAL_NATIVE_COPY_PROOF", ...expected,
    receipt: receiptFile, sourceUnchanged: true, descriptorsClosed: true, inspection: "NOT_ATTEMPTED", sourceClosure: "NOT_ESTABLISHED" })
    : validatePostgresGosuSourceRetentionAcknowledgement({ kind: "POSTGRES_GOSU_SOURCE_RETENTION_ACK_V1", state: "SOURCES_RETAINED", ...expected,
      receipt: receiptFile, sourceUnchanged: true, descriptorsClosed: true }, expected);
  onOutput(); if (controls.result) await outputWithinDeadline(controls.result, acknowledgement, signal, deadline); return acknowledgement;
}
async function operate(inputRaw, controls, dependencies, partial) {
  let held; let publication; let phase = "CONTEXT";
  try {
    fixedControls(controls, dependencies); const pin = dependencies.pin ?? PIN; const input = inputValue(inputRaw, pin, true);
    if (!partial && !isDeepStrictEqual(pin, PIN)) fail("arguments_invalid"); nativeActor();
    const deadline = Date.now() + LIMITS.operationMs; const signal = globalThis.AbortSignal.any([globalThis.AbortSignal.timeout(LIMITS.operationMs), ...(input.signal ? [input.signal] : [])]);
    held = session(deadline, signal); const phases = []; let source;
    const record = async (name, action) => { phase = name; const at = Date.now(); held.guards(); const value = await action(); held.guards(); phases.push({ name, result: "PASSED", durationMs: Date.now() - at }); return value; };
    await record("SOURCE", async () => {
      source = await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }); if (source.head !== input.recipeRevision) fail("source_invalid");
      held.directory(pin.parent, pin.parentIdentity); held.directory(pin.inputDirectory, pin.inputDirectoryIdentity);
      if (statfsSync(pin.parent, { bigint: true }).bavail * statfsSync(pin.parent, { bigint: true }).bsize < BigInt(LIMITS.reservedDiskBytes)) fail("capacity_invalid");
    });
    const originals = await record("INPUTS", () => {
      if (!isDeepStrictEqual(readdirSync(pin.inputDirectory).sort(), pin.archives.map((v) => v.name).sort())) fail("file_invalid");
      const items = pin.archives.map((v) => held.open(path.join(pin.inputDirectory, v.name), v)); for (const item of items) held.read(item);
      if (new Set(items.map((v) => v.identity.dev + ":" + v.identity.ino)).size !== 4) fail("file_invalid"); return items;
    });
    const copies = await record("COPY", () => {
      mkdirSync(input.directory, { mode: 0o700 }); held.directory(input.directory, { ...directoryNative(lstatSync(input.directory, { bigint: true })), uid: 1000, gid: 1000, mode: 0o700 });
      const target = path.join(input.directory, "archives"); mkdirSync(target, { mode: 0o700 }); held.directory(target, { ...directoryNative(lstatSync(target, { bigint: true })), uid: 1000, gid: 1000, mode: 0o700 });
      if (readdirSync(target).length || !isDeepStrictEqual(readdirSync(input.directory), ["archives"])) fail("publication_failed");
      return originals.map((v) => held.copy(v, path.join(target, v.expected.name)));
    });
    const sourceProofs = copies.map((v, i) => ({ role: v.expected.role, name: v.expected.name, sourceUrl: v.expected.sourceUrl, size: v.expected.size, sha256: v.expected.sha256,
      sourceIdentity: originals[i].identity, identity: v.identity }));
    if (new Set(sourceProofs.flatMap((v) => [v.sourceIdentity.dev + ":" + v.sourceIdentity.ino, v.identity.dev + ":" + v.identity.ino])).size !== 8) fail("file_invalid");
    const all = [...originals, ...copies]; let inspection; let python; let recipe;
    const inventory = (receiptPresent = false) => {
      if (!isDeepStrictEqual(readdirSync(pin.inputDirectory).sort(), pin.archives.map((v) => v.name).sort()) ||
        !isDeepStrictEqual(readdirSync(input.directory).sort(), receiptPresent ? ["archives", "receipt.json"] : ["archives"]) ||
        !isDeepStrictEqual(readdirSync(path.join(input.directory, "archives")).sort(), pin.archives.map((v) => v.name).sort())) fail("publication_failed");
    };
    if (!partial) await record("INSPECT", async () => {
      const runtime = pin.python.files.map((v) => held.open(v.source, v, 0, 0, v.mode, true)); for (const item of runtime) held.read(item); all.push(...runtime);
      const scriptBytes = gitBlob(input, pin.inspector.source, deadline); const scriptPath = path.join(input.workspace, pin.inspector.source); const scriptStat = lstatSync(scriptPath, { bigint: true });
      const script = held.open(scriptPath, { size: scriptBytes.length, sha256: hash(scriptBytes) }, 1000, 1000, Number(scriptStat.mode & 0o7777n));
      if ((script.mode & 0o7022) !== 0) fail("source_invalid"); held.read(script); all.push(script);
      const recipePath = path.join(input.workspace, pin.recipe.source); const recipeStat = lstatSync(recipePath, { bigint: true });
      const material = held.open(recipePath, pin.recipe, 1000, 1000, Number(recipeStat.mode & 0o7777n));
      if ((material.mode & 0o7022) !== 0 || !gitBlob(input, pin.recipe.source, deadline).equals(held.read(material, true))) fail("source_invalid"); all.push(material);
      const readers = copies.map((v) => held.open(v.file, v.expected));
      if (readers.some((v, i) => !isDeepStrictEqual(v.identity, copies[i].identity))) fail("file_changed");
      for (const item of readers) held.read(item); all.push(...readers);
      inspection = await inspectCopies(readers, script, pin, signal, deadline);
      if (inspection.archives.some((v, i) => !isDeepStrictEqual(v.identity, copies[i].identity))) fail("inspection_failed");
      inspection = validatePostgresGosuSourceInspectionMetadata({ ...inspection, archives: inspection.archives.map((a) => ({ ...a,
        selectedFiles: a.selectedFiles.map(({ path: memberPath, size, sha256 }) => ({ path: memberPath, size, sha256 })) })) }, pin);
      python = { executable: pin.python.executable, version: pin.python.version, trust: pin.python.trust, transitiveStdlibClosure: pin.python.transitiveStdlibClosure,
        files: runtime.map((v) => ({ ...v.expected, identity: v.identity })) };
      recipe = { ...pin.recipe, identity: material.identity };
    });
    if (partial) {
      for (const item of all) held.read(item); held.guards();
      if (!isDeepStrictEqual(source, await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }))) fail("source_invalid");
      inventory();
      if (partial === "COPY") { held.close(); return freeze({ kind: "TEST_ONLY_POSTGRES_GOSU_COPY_V1", state: "PARTIAL_NATIVE_COPY_PROOF", scope: "NATIVE_BYTES_AND_PRIVATE_COPIES_ONLY", sources: sourceProofs,
        descriptorsClosed: true, inspection: "NOT_ATTEMPTED", sourceClosure: "NOT_ESTABLISHED" }); }
      phase = "PUBLISH";
      return await publishAndAcknowledge({ held, input, pin, source, all, controls, signal, deadline, inventory, partial: true,
        onPublication: (item) => { publication = item; }, onOutput: () => { phase = "OUTPUT"; },
        receipt: { kind: "TEST_ONLY_POSTGRES_GOSU_COPY_PUBLICATION_V1", state: "PARTIAL_NATIVE_COPY_PROOF", scope: "NATIVE_BYTES_AND_PRIVATE_COPIES_ONLY",
          sources: sourceProofs, inspection: "NOT_ATTEMPTED", sourceClosure: "NOT_ESTABLISHED" } });
    }
    await record("PUBLISH", () => { for (const item of all) held.read(item); });
    await record("FINAL_SEAL", async () => { for (const item of all) held.read(item);
      if (!isDeepStrictEqual(source, await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }))) fail("source_invalid"); });
    const receipt = validatePostgresGosuSourceRetentionReceipt({ kind: "POSTGRES_GOSU_SOURCE_RETENTION_V1", state: "SOURCES_RETAINED", authority: "LOCAL_DIAGNOSTIC", scope: "FOUR_FIXED_GOSU_GO_SOURCE_ARCHIVES",
      subject: pin.subject, recipeRevision: input.recipeRevision, executionId: input.executionId, directory: input.directory, filesystem: "EXT4", actor: ACTOR, sources: sourceProofs,
      inspection, python, recipe, claims: CLAIMS, requiredMissing: MISSING, phases, sourceUnchanged: true }, input, pin);
    return await publishAndAcknowledge({ held, input, pin, source, all, receipt, controls, signal, deadline, inventory, partial: false,
      onPublication: (item) => { publication = item; }, onOutput: () => { phase = "OUTPUT"; } });
  } catch (error) {
    let reason = safeReason(error); let uncertain = reason === "cleanup_uncertain";
    if (publication) try { held.retire(publication); } catch { uncertain = true; }
    try { held?.close(); } catch { uncertain = true; }
    if (uncertain) { reason = "cleanup_uncertain"; phase = "CLEANUP"; } else if (phase === "OUTPUT") reason = "output_failed";
    const failure = errorValue(reason); failure.phase = phase; failure.cleanup = uncertain ? "UNVERIFIED" : "CONFIRMED"; throw failure;
  }
}
export async function collectPostgresGosuSources(input, controls = {}, dependencies = {}) { return await operate(input, controls, dependencies, false); }
// Fixtures prove only native copies. This never runs an inspector or publishes a retention receipt/ACK.
export async function TEST_ONLY_retainPostgresGosuSourceArchiveCopies(input, dependencies = {}) { return await operate(input, {}, dependencies, "COPY"); }
// Exercises the identical publication lifecycle, with an explicit partial receipt/ACK and no source-inspection claim.
export async function TEST_ONLY_publishPostgresGosuSourceArchiveCopies(input, controls = {}, dependencies = {}) { return await operate(input, controls, dependencies, "PUBLISH"); }
