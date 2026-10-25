import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync,
  realpathSync, readdirSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import { posix as path } from "node:path";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { authenticateColdLoadMaterial } from "./cold-load-input.mjs";
import { validatePostgresRemotePolicy } from "./candidate-remote.mjs";
import { validatePostgresRemoteRuntimePolicy } from "./candidate-remote-runtime-diagnostic.mjs";
import { sealPostgresPrivateCopy, validatePostgresPrivateCopyLinuxResult } from "./private-copy-linux.mjs";
import { stagePostgresRuntimeAudit, sealPostgresRuntimeAuditStage, validatePostgresRuntimeAuditStageProof } from "./runtime-restore-audit.mjs";
import { POSTGRES_PRIVATE_EVIDENCE_PIN, postgresPrivateEvidenceBlobPins, postgresPrivateEvidenceLimits as LIMITS } from "./private-evidence-policy.mjs";
import { createPostgresPrivateEvidenceSourceBundle, validatePostgresPrivateEvidenceSourceBundle,
  validatePostgresPrivateEvidenceSourceBundleProof, inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";

const PREFIX = "postgres_private_evidence_";
const HEX = /^[0-9a-f]{64}$/u; const REV = /^[0-9a-f]{40}$/u; const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const NATIVE = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const OWN_FILE = ["dev", "ino", "uid", "gid", "mode", "nlink"];
const RECIPES = ["publication", "audit", "runtime", "retention", "copy", "cold", "sql"];
export const postgresPrivateEvidencePhases = Object.freeze(["SOURCE", "HEALTH_BEFORE", "AUDIT_STAGE", "COPY", "BUNDLE", "FINAL_SEALS"]);
const FAILURE_PHASES = ["CONTEXT", ...postgresPrivateEvidencePhases, "PUBLISH", "CLEANUP"];
const REASONS = new Set(["arguments_invalid", "requires_native_actor", "source_invalid", "storage_invalid", "file_invalid", "file_changed", "policy_invalid",
  "audit_invalid", "health_invalid", "bundle_invalid", "git_invalid", "inventory_invalid", "capacity_invalid", "deadline_exceeded", "aborted", "publication_failed", "cleanup_uncertain", "receipt_invalid", "operation_failed"]);
const plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, names) => plain(v) && isDeepStrictEqual(Reflect.ownKeys(v).sort(), [...names].sort())
  && names.every((name) => Object.hasOwn(Object.getOwnPropertyDescriptor(v, name), "value"));
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([k, child]) => [k, freeze(child)]))) : v;
const hash = (v) => createHash("sha256").update(v).digest("hex");
const fail = (reason) => { throw new Error(PREFIX + reason); };
const absolute = (v) => typeof v === "string" && v.length <= 1024 && path.isAbsolute(v) && path.normalize(v) === v && !/[\0\\]/u.test(v);
const relative = (v) => typeof v === "string" && v.length <= 256 && /^[A-Za-z0-9@._/-]+$/u.test(v)
  && !path.isAbsolute(v) && path.normalize(v) === v && v.split("/").every((part) => part !== "." && part !== ".." && part !== "");
const identity = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const directoryIdentity = (s) => Object.fromEntries(DIRECTORY.map((k) => [k, identity(s)[k]]));
function nativeIdentity(value, privateFile = true) {
  return exact(value, NATIVE) && ["dev", "ino", "mtimeNs", "ctimeNs"].every((k) => typeof value[k] === "string" && DECIMAL.test(value[k]))
    && ["uid", "gid", "mode", "nlink", "size"].every((k) => Number.isSafeInteger(value[k]) && value[k] >= 0)
    && value.nlink === 1 && (!privateFile || value.uid === 1000 && value.gid === 1000 && value.mode === 0o600);
}
function reason(error) {
  try { const message = error?.message;
    if (typeof message === "string" && message.startsWith(PREFIX) && REASONS.has(message.slice(PREFIX.length))) return message.slice(PREFIX.length);
    if (message === "postgres_private_evidence_source_bundle_git_invalid") return "git_invalid";
    if (["postgres_runtime_restore_audit_cleanup_uncertain", "postgres_private_copy_linux_descriptor_cleanup_failed", "postgres_private_evidence_source_bundle_cleanup_uncertain",
      "postgres_private_evidence_source_bundle_git_cleanup_uncertain"].includes(message)) return "cleanup_uncertain";
  } catch { /* Dependency properties are untrusted. */ } return "operation_failed";
}
export function postgresPrivateEvidenceFailureDiagnostic(error) {
  let phase; let cleanup; try { phase = error?.phase; cleanup = error?.cleanup; } catch { /* Closed fallback. */ }
  const safeReason = reason(error);
  return Object.freeze({ code: PREFIX + safeReason, phase: FAILURE_PHASES.includes(phase) ? phase : "CONTEXT", cleanup: safeReason !== "cleanup_uncertain" && cleanup === "CONFIRMED" ? "CONFIRMED" : "UNVERIFIED" });
}
export function validatePostgresPrivateEvidenceFailureDiagnostic(value) {
  if (!exact(value, ["code", "phase", "cleanup"]) || !isDeepStrictEqual(postgresPrivateEvidenceFailureDiagnostic(Object.assign(new Error(value.code), value)), value)) fail("receipt_invalid");
  return freeze({ ...value });
}
function inputValue(value) {
  if (!exact(value, Object.hasOwn(value ?? {}, "signal") ? ["workspace", "recipeRevision", "executionId", "directory", "pin", "signal"] : ["workspace", "recipeRevision", "executionId", "directory", "pin"])
    || !absolute(value.workspace) || typeof value.recipeRevision !== "string" || !REV.test(value.recipeRevision)
    || typeof value.executionId !== "string" || !/^local-evidence-intake-[0-9a-f]{24}$/u.test(value.executionId) || !absolute(value.directory)
    || value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal)) fail("arguments_invalid");
  const pin = value.pin;
  if (!exact(pin, Object.keys(POSTGRES_PRIVATE_EVIDENCE_PIN)) || pin.purpose !== "POSTGRES_PRIVATE_EVIDENCE_INTAKE" || pin.workspace !== value.workspace
    || !absolute(pin.parent) || typeof pin.directoryPrefix !== "string" || !/^[A-Za-z0-9-]+-$/u.test(pin.directoryPrefix) || pin.ownerUid !== 1000 || pin.ownerGid !== 1000
    || typeof pin.subject !== "string" || !/^ghcr\.io\/clemey15\/auto-world-postgres-gosu@sha256:[0-9a-f]{64}$/u.test(pin.subject)
    || !exact(pin.candidate, ["imageId", "tag"]) || typeof pin.candidate.imageId !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(pin.candidate.imageId)
    || typeof pin.candidate.tag !== "string" || !/^aw-postgres-gosu:[0-9a-f]{24}$/u.test(pin.candidate.tag)
    || !absolute(pin.importDirectory) || !absolute(pin.copyReceiptFile) || !absolute(pin.auditDirectory)
    || !exact(pin.copyReceipt, ["size", "sha256"]) || !Number.isSafeInteger(pin.copyReceipt.size) || pin.copyReceipt.size < 1 || pin.copyReceipt.size > LIMITS.staticFileBytes
    || typeof pin.copyReceipt.sha256 !== "string" || !HEX.test(pin.copyReceipt.sha256)
    || !exact(pin.policyFiles, ["candidate", "runtime", "lock"]) || Object.values(pin.policyFiles).some((v) => !relative(v))
    || !Array.isArray(pin.publicFiles) || pin.publicFiles.length !== 11 || pin.publicFiles.some((f) => !exact(f, ["name", "source", "size", "sha256"])
      || f.name !== f.source || !relative(f.source) || !Number.isSafeInteger(f.size) || f.size < 1 || f.size > LIMITS.staticFileBytes || typeof f.sha256 !== "string" || !HEX.test(f.sha256))
    || new Set(pin.publicFiles.map((f) => f.name)).size !== 11 || !isDeepStrictEqual(pin.publicFiles.map((f) => f.name).sort(), POSTGRES_PRIVATE_EVIDENCE_PIN.publicFiles.map((f) => f.name).sort())
    || Object.values(pin.policyFiles).some((v) => !pin.publicFiles.some((f) => f.name === v)) || !exact(pin.recipes, RECIPES)
    || Object.values(pin.recipes).some((v) => typeof v !== "string" || !REV.test(v)) || !plain(pin.original)
    || !isDeepStrictEqual(pin.requiredMissing, POSTGRES_PRIVATE_EVIDENCE_PIN.requiredMissing)
    || value.directory !== path.join(pin.parent, pin.directoryPrefix + value.executionId.slice("local-evidence-intake-".length))) fail("arguments_invalid");
  for (const source of [value.workspace, pin.auditDirectory, pin.original.sourceDirectory, pin.importDirectory, pin.copyReceiptFile]) {
    if (!absolute(source) || source === value.directory || source.startsWith(value.directory + "/") || value.directory.startsWith(source + "/")) fail("arguments_invalid");
  }
  return Object.freeze({ ...value, pin: freeze(globalThis.structuredClone(pin)) });
}
function decode(value, expected) {
  if (typeof value !== "string" || value.length > LIMITS.receiptBytes || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) fail("receipt_invalid");
  const bytes = Buffer.from(value, "base64"); if (bytes.toString("base64") !== value || bytes.length !== expected.size || hash(bytes) !== expected.sha256) fail("receipt_invalid");
  return bytes;
}
const json = (bytes) => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("policy_invalid"); } };
function policies(policyBytes, runtimeBytes, pin) {
  const policy = validatePostgresRemotePolicy(json(policyBytes)); const runtimePolicy = validatePostgresRemoteRuntimePolicy(json(runtimeBytes), policy);
  if (policy.subject !== pin.subject || policy.candidate.imageId !== pin.candidate.imageId) fail("policy_invalid"); return { policy, runtimePolicy };
}
function bundleInput(input, deadline, signal) {
  return { workspace: input.workspace, directory: path.join(input.directory, "source"), recipeRevision: input.recipeRevision,
    recipes: input.pin.recipes, blobPins: postgresPrivateEvidenceBlobPins(input.recipeRevision, input.pin), deadline, ...(signal ? { signal } : {}) };
}
function payloadExpectations(input, runtimePolicy, bundle) {
  return [...runtimePolicy.audit.files.map((f) => ({ name: "audit/" + f.name, source: path.join(input.pin.auditDirectory, f.name), size: f.size, sha256: f.sha256 })),
    ...input.pin.publicFiles.map((f) => ({ name: "public/" + f.name, source: path.join(input.workspace, f.source), size: f.size, sha256: f.sha256 })),
    { name: "references/copy-receipt.json", source: input.pin.copyReceiptFile, ...input.pin.copyReceipt },
    { name: "source/recipes.bundle", source: null, size: bundle.size, sha256: bundle.sha256 }].sort((a, b) => a.name.localeCompare(b.name, "en"));
}
export function validatePostgresPrivateEvidenceReceipt(value, inputRaw) {
  try {
    const input = inputValue(inputRaw); const names = ["kind", "state", "authority", "purpose", "executionId", "recipeRevision", "githubRunId", "subject", "imageId", "tag", "directory", "filesystem", "actor",
      "policyBytesBase64", "runtimePolicyBytesBase64", "payloads", "directories", "audit", "bundle", "health", "phases", "startedAt", "finishedAt", "historicalIntegrity", "currentness", "runtimePermission", "closure", "requiredMissing",
      "sourceUnchanged", "privateState", "registryRead", "registryWrite", "network", "signing", "admission", "supportStartedAt", "supportEndsAt", "archiveUntil"];
    if (!exact(value, names) || Buffer.byteLength(JSON.stringify(value)) > LIMITS.receiptBytes || value.kind !== "POSTGRES_PRIVATE_EVIDENCE_INTAKE_V1" || value.state !== "INTAKE_VERIFIED"
      || value.authority !== "LOCAL_DIAGNOSTIC" || value.purpose !== input.pin.purpose || value.executionId !== input.executionId || value.recipeRevision !== input.recipeRevision || value.githubRunId !== null
      || value.subject !== input.pin.subject || value.imageId !== input.pin.candidate.imageId || value.tag !== input.pin.candidate.tag || value.directory !== input.directory || value.filesystem !== "EXT4"
      || !isDeepStrictEqual(value.actor, { uid: 1000, gid: 1000 }) || value.historicalIntegrity !== "VERIFIED" || value.currentness !== "NOT_EVALUATED" || value.runtimePermission !== "NOT_GRANTED"
      || value.closure !== "INCOMPLETE" || !isDeepStrictEqual(value.requiredMissing, input.pin.requiredMissing) || value.sourceUnchanged !== true || value.privateState !== "RETAINED"
      || ["registryRead", "registryWrite", "network", "signing"].some((k) => value[k] !== "NOT_ATTEMPTED") || value.admission !== "NOT_AUTHORIZED"
      || ["supportStartedAt", "supportEndsAt", "archiveUntil"].some((k) => value[k] !== null)) fail("receipt_invalid");
    const policyBytes = decode(value.policyBytesBase64, input.pin.publicFiles.find((f) => f.name === input.pin.policyFiles.candidate));
    const runtimeBytes = decode(value.runtimePolicyBytesBase64, input.pin.publicFiles.find((f) => f.name === input.pin.policyFiles.runtime));
    const { policy, runtimePolicy } = policies(policyBytes, runtimeBytes, input.pin);
    const bundle = validatePostgresPrivateEvidenceSourceBundleProof(value.bundle, bundleInput(input, Date.now() + LIMITS.operationMs));
    const bundleFile = bundle.file; const expected = payloadExpectations(input, runtimePolicy, bundleFile);
    if (!Array.isArray(value.payloads) || value.payloads.length !== 29 || value.payloads.some((file, index) => !exact(file, ["name", "source", "size", "sha256", "sourceIdentity", "identity"])
      || !["name", "source", "size", "sha256"].every((k) => file[k] === expected[index][k]) || !nativeIdentity(file.identity) || file.identity.size !== file.size
      || (file.source === null ? file.sourceIdentity !== null : !nativeIdentity(file.sourceIdentity, false) || file.sourceIdentity.size !== file.size))) fail("receipt_invalid");
    const bundlePayload = value.payloads.find((f) => f.name === "source/recipes.bundle");
    if (!isDeepStrictEqual(bundlePayload.identity, bundleFile.identity)) fail("receipt_invalid");
    for (const file of bundle.source.files) {
      const copied = value.payloads.find((f) => f.name === "public/" + file.path);
      if (!copied || !isDeepStrictEqual(copied.sourceIdentity, file.identity)) fail("receipt_invalid");
    }
    if (new Set(value.payloads.map((f) => f.identity.dev + ":" + f.identity.ino)).size !== 29 || !Array.isArray(value.directories) || value.directories.some((d) => !exact(d, ["name", "identity"])
      || d.name !== "" && !relative(d.name) || !exact(d.identity, DIRECTORY) || !["dev", "ino"].every((k) => typeof d.identity[k] === "string" && DECIMAL.test(d.identity[k]))
      || d.identity.uid !== 1000 || d.identity.gid !== 1000 || d.identity.mode !== 0o700)) fail("receipt_invalid");
    const directoryNames = new Set(["", "audit", "public", "references", "source"]);
    for (const f of expected) { let parent = path.dirname(f.name); while (parent !== ".") { directoryNames.add(parent); parent = path.dirname(parent); } }
    if (!isDeepStrictEqual(value.directories.map((d) => d.name).sort(), [...directoryNames].sort())) fail("receipt_invalid");
    validatePostgresRuntimeAuditStageProof(value.audit, runtimePolicy);
    if (value.audit.source !== input.pin.auditDirectory || value.audit.target !== path.join(input.directory, "audit")) fail("receipt_invalid");
    for (const file of value.audit.files) {
      const copied = value.payloads.find((f) => f.name === "audit/" + file.name);
      if (!isDeepStrictEqual(copied.identity, file.target) || !isDeepStrictEqual(copied.sourceIdentity, file.source)) fail("receipt_invalid");
    }
    for (const [key, name] of [["policy", input.pin.policyFiles.runtime], ["candidate", input.pin.policyFiles.candidate], ["lock", input.pin.policyFiles.lock],
      ["dockerfile", "infra/postgres-image/Dockerfile"], ["publication", "infra/postgres-image/candidate-publication-receipt.json"]]) {
      const expected = input.pin.publicFiles.find((f) => f.name === name);
      if (!isDeepStrictEqual(value.audit.sourceIdentities[key], { size: expected.size, sha256: expected.sha256 })) fail("receipt_invalid");
    }
    if (!exact(value.health, ["before", "after"]) || !isDeepStrictEqual(value.health.before, value.health.after)) fail("receipt_invalid");
    for (const seal of Object.values(value.health)) {
      validatePostgresPrivateCopyLinuxResult(seal, input.pin.original, policy);
      if (seal.operation !== "SEAL" || seal.directory !== input.pin.importDirectory || seal.recipeRevision !== input.recipeRevision || seal.archiveProof.tag !== input.pin.candidate.tag) fail("receipt_invalid");
    }
    const iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
    if (!iso(value.startedAt) || !iso(value.finishedAt) || Date.parse(value.finishedAt) < Date.parse(value.startedAt) || Date.parse(value.finishedAt) - Date.parse(value.startedAt) > LIMITS.operationMs
      || !Array.isArray(value.phases) || value.phases.length !== postgresPrivateEvidencePhases.length || value.phases.some((p, i) => !exact(p, ["name", "result", "durationMs"])
        || p.name !== postgresPrivateEvidencePhases[i] || p.result !== "PASSED" || !Number.isSafeInteger(p.durationMs) || p.durationMs < 0 || p.durationMs > LIMITS.operationMs)) fail("receipt_invalid");
    return freeze(globalThis.structuredClone(value));
  } catch { fail("receipt_invalid"); }
}
function check(deadline, signal) {
  if (signal?.aborted) fail("aborted"); if (Date.now() >= deadline) fail("deadline_exceeded");
}
function native() {
  if (process.platform !== "linux" || process.getuid?.() !== 1000 || process.getgid?.() !== 1000 || process.geteuid?.() !== 1000 || process.getegid?.() !== 1000) fail("requires_native_actor");
}
function session(deadline, signal) {
  const files = []; const directories = new Map(); const ancestors = new Map(); let closed = false;
  const anchor = (file) => { let current = file; while (true) {
    const stat = lstatSync(current, { bigint: true }); if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(current) !== current) fail("storage_invalid");
    const observed = directoryIdentity(stat); if (ancestors.has(current) && !isDeepStrictEqual(ancestors.get(current), observed)) fail("file_changed");
    ancestors.set(current, observed); const parent = path.dirname(current); if (parent === current) break; current = parent;
  } };
  const guards = () => { check(deadline, signal); for (const [file, expected] of ancestors) {
    const value = lstatSync(file, { bigint: true }); if (!value.isDirectory() || value.isSymbolicLink() || realpathSync(file) !== file || !isDeepStrictEqual(expected, directoryIdentity(value))) fail("file_changed");
  } for (const [file, entry] of directories) if (!isDeepStrictEqual(entry.identity, directoryIdentity(fstatSync(entry.fd, { bigint: true }))) || !isDeepStrictEqual(entry.identity, directoryIdentity(lstatSync(file, { bigint: true })))) fail("file_changed"); };
  const holdDirectory = (file, privateMode = true) => { anchor(file); const s = lstatSync(file, { bigint: true });
    if (s.uid !== 1000n || s.gid !== 1000n || (s.mode & 0o7022n) !== 0n || privateMode && (s.mode & 0o7777n) !== 0o700n
      || statfsSync(file, { bigint: true }).type !== 0xef53n) fail("storage_invalid");
    const mount = spawnSync("/usr/bin/findmnt", ["--noheadings", "--output", "FSTYPE", "--target", file],
      { encoding: null, timeout: Math.min(10000, Math.max(1, deadline - Date.now())), maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
    if (mount.error || mount.status !== 0 || mount.signal || mount.stderr.length !== 0 || !mount.stdout.equals(Buffer.from("ext4\n"))) fail("storage_invalid");
    const fd = openSync(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); const entry = { fd, identity: directoryIdentity(s) }; directories.set(file, entry); guards(); return entry;
  };
  const makeDirectory = (file) => { guards(); mkdirSync(file, { mode: 0o700 }); return holdDirectory(file); };
  const fileGuard = (item) => { guards(); const s = fstatSync(item.fd, { bigint: true }); const named = lstatSync(item.file, { bigint: true });
    if (!s.isFile() || !named.isFile() || named.isSymbolicLink() || realpathSync(item.file) !== item.file || s.nlink !== 1n
      || !isDeepStrictEqual(identity(s), identity(named)) || item.privateFile && (s.uid !== 1000n || s.gid !== 1000n || (s.mode & 0o7777n) !== 0o600n)
      || item.publicFile && (s.uid !== 1000n || s.gid !== 1000n || (s.mode & 0o7022n) !== 0n)
      || item.identity && !isDeepStrictEqual(item.identity, identity(s)) || Number(s.size) !== item.expected.size) fail("file_changed"); return identity(s);
  };
  const open = (file, expected, options = {}) => { anchor(path.dirname(file)); check(deadline, signal);
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); const item = { fd, file, expected, ...options }; files.push(item); item.identity = fileGuard(item); return item;
  };
  const seal = (item, bytes) => { fileGuard(item); const digest = createHash("sha256"); const buffer = Buffer.allocUnsafe(1024 ** 2); let offset = 0;
    while (offset < item.expected.size) { check(deadline, signal); const n = readSync(item.fd, buffer, 0, Math.min(buffer.length, item.expected.size - offset), offset);
      if (n < 1) fail("file_changed"); const part = buffer.subarray(0, n); digest.update(part); if (bytes) part.copy(bytes, offset); offset += n; }
    if (readSync(item.fd, buffer, 0, 1, offset) !== 0 || digest.digest("hex") !== item.expected.sha256) fail("file_changed"); fileGuard(item);
  };
  const read = (item) => { if (item.expected.size > LIMITS.staticFileBytes) fail("file_invalid"); const b = Buffer.alloc(item.expected.size); seal(item, b); return b;
  };
  const copy = (original, destination) => { const b = read(original); guards(); const fd = openSync(destination, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const item = { fd, file: destination, expected: original.expected, privateFile: true }; files.push(item); const empty = fstatSync(fd, { bigint: true });
    if (!empty.isFile() || empty.nlink !== 1n || empty.uid !== 1000n || empty.gid !== 1000n || (empty.mode & 0o7777n) !== 0o600n || empty.size !== 0n) fail("file_invalid");
    let offset = 0; while (offset < b.length) { check(deadline, signal); const n = writeSync(fd, b, offset, b.length - offset, offset); if (n < 1) fail("file_invalid"); offset += n; }
    fsyncSync(fd); item.identity = fileGuard(item); if (!read(item).equals(b) || !read(original).equals(b)) fail("file_changed"); return item;
  };
  const close = () => { if (closed) return; closed = true; let failed = false;
    for (const entry of [...files, ...directories.values()]) try { closeSync(entry.fd); } catch { failed = true; }
    if (failed) fail("cleanup_uncertain");
  };
  return { files, directories, guards, holdDirectory, makeDirectory, open, read, seal, copy, close, isClosed: () => closed };
}
async function archiveHealth(input, policyBytes, copyBytes, signal) {
  const material = authenticateColdLoadMaterial(policyBytes, copyBytes);
  const seal = await sealPostgresPrivateCopy({ pin: input.pin.original, policy: material.policy, recipeRevision: input.recipeRevision, signal }, input.pin.importDirectory);
  validatePostgresPrivateCopyLinuxResult(seal, input.pin.original, material.policy, material.copyReceipt.linuxFinalProof.archiveProof);
  if (!isDeepStrictEqual({ ...seal, recipeRevision: material.copyReceipt.linuxFinalProof.recipeRevision }, material.copyReceipt.linuxFinalProof)) fail("health_invalid"); return seal;
}
function inventories(input, held, payloads, receipt = false) {
  held.guards(); const entries = new Map([...held.directories.keys()].filter((v) => v === input.directory || v.startsWith(input.directory + "/")).map((v) => [v, []]));
  for (const dir of entries.keys()) if (dir !== input.directory) entries.get(path.dirname(dir)).push(path.basename(dir));
  for (const file of payloads) entries.get(path.dirname(file.file)).push(path.basename(file.file));
  if (receipt) entries.get(input.directory).push("receipt.json");
  for (const [dir, expected] of entries) if (!isDeepStrictEqual(readdirSync(dir).sort(), expected.sort())) fail("inventory_invalid");
}
function publish(file, value, input) {
  const bytes = Buffer.from(JSON.stringify(validatePostgresPrivateEvidenceReceipt(value, input), null, 2) + "\n");
  if (bytes.length > LIMITS.receiptBytes) fail("publication_failed"); let fd; let own; let failure; let result;
  try { fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); own = identity(fstatSync(fd, { bigint: true }));
    let offset = 0; while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset, offset); if (n < 1) fail("publication_failed"); offset += n; } fsyncSync(fd);
    const metadata = identity(fstatSync(fd, { bigint: true })); if (!nativeIdentity(metadata) || metadata.size !== bytes.length || !isDeepStrictEqual(metadata, identity(lstatSync(file, { bigint: true })))) fail("publication_failed");
    const read = Buffer.alloc(bytes.length); let position = 0; while (position < read.length) { const n = readSync(fd, read, position, read.length - position, position); if (n < 1) fail("publication_failed"); position += n; }
    if (readSync(fd, Buffer.alloc(1), 0, 1, read.length) !== 0 || !read.equals(bytes) || !isDeepStrictEqual(metadata, identity(fstatSync(fd, { bigint: true })))
      || !isDeepStrictEqual(metadata, identity(lstatSync(file, { bigint: true })))) fail("publication_failed");
    result = { name: "receipt.json", size: bytes.length, sha256: hash(bytes), identity: metadata };
  } catch (error) { failure = error; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { failure = new Error(PREFIX + "cleanup_uncertain"); }
    if (failure && own) { try { const observed = identity(lstatSync(file, { bigint: true })); if (["dev", "ino", "uid", "gid", "mode", "nlink"].some((k) => observed[k] !== own[k])) fail("cleanup_uncertain"); unlinkSync(file); }
      catch { failure = new Error(PREFIX + "cleanup_uncertain"); } }
  }
  if (failure) throw failure; return result;
}
export async function intakePostgresPrivateEvidence(inputRaw, dependencies = {}) {
  let phase = "CONTEXT"; let held; let receiptFile; let receiptIdentity; let receiptDescriptor; let failure; let result; const started = Date.now();
  const retireReceipt = () => {
    if (!receiptIdentity) return;
    const entry = lstatSync(receiptFile, { bigint: true }); const current = identity(entry);
    if (!entry.isFile() || entry.isSymbolicLink() || OWN_FILE.some((key) => current[key] !== receiptIdentity[key])) fail("cleanup_uncertain");
    if (receiptDescriptor && !held.isClosed()) {
      const heldFile = fstatSync(receiptDescriptor.fd, { bigint: true });
      if (!heldFile.isFile() || OWN_FILE.some((key) => identity(heldFile)[key] !== receiptIdentity[key])) fail("cleanup_uncertain");
    }
    unlinkSync(receiptFile); receiptIdentity = undefined;
  };
  try {
    const input = inputValue(inputRaw); native();
    if (!plain(dependencies) || Object.keys(dependencies).some((k) => !["auditStage", "auditSeal", "archiveHealth"].includes(k)) || Object.values(dependencies).some((v) => typeof v !== "function")) fail("arguments_invalid");
    const deadline = started + LIMITS.operationMs; const signal = globalThis.AbortSignal.any([globalThis.AbortSignal.timeout(LIMITS.operationMs), ...(input.signal ? [input.signal] : [])]);
    const phases = []; const record = async (name, action) => { phase = name; check(deadline, signal); const at = Date.now(); const value = await action(); check(deadline, signal);
      phases.push({ name, result: "PASSED", durationMs: Date.now() - at }); return value; };
    held = session(deadline, signal); const originals = new Map(); const copied = []; let audit; let bundle; let before; let after; let sourceContext;
    const { policyBytes, runtimeBytes, copyBytes, policy, runtimePolicy } = await record("SOURCE", async () => {
      sourceContext = await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal });
      if (sourceContext.head !== input.recipeRevision) fail("source_invalid");
      held.holdDirectory(input.pin.parent, false); const disk = statfsSync(input.pin.parent, { bigint: true });
      if (disk.bavail * disk.bsize < BigInt(LIMITS.reservedDiskBytes)) fail("capacity_invalid");
      for (const expected of input.pin.publicFiles) originals.set(expected.name, held.open(path.join(input.workspace, expected.source), expected, { publicFile: true }));
      const policyBytes = held.read(originals.get(input.pin.policyFiles.candidate)); const runtimeBytes = held.read(originals.get(input.pin.policyFiles.runtime));
      const copyOriginal = held.open(input.pin.copyReceiptFile, input.pin.copyReceipt); originals.set("copy-receipt", copyOriginal); const copyBytes = held.read(copyOriginal);
      const accepted = policies(policyBytes, runtimeBytes, input.pin);
      held.makeDirectory(input.directory); for (const name of ["public", "references", "source"]) held.makeDirectory(path.join(input.directory, name));
      return { policyBytes, runtimeBytes, copyBytes, ...accepted };
    });
    before = await record("HEALTH_BEFORE", () => (dependencies.archiveHealth ?? archiveHealth)(input, policyBytes, copyBytes, signal));
    validatePostgresPrivateCopyLinuxResult(before, input.pin.original, policy);
    audit = await record("AUDIT_STAGE", async () => {
      const value = await (dependencies.auditStage ?? stagePostgresRuntimeAudit)({ source: input.pin.auditDirectory, target: path.join(input.directory, "audit"), policy: runtimePolicy, workspace: input.workspace, deadline });
      validatePostgresRuntimeAuditStageProof(value, runtimePolicy);
      if (value.source !== input.pin.auditDirectory || value.target !== path.join(input.directory, "audit")) fail("audit_invalid");
      held.holdDirectory(path.join(input.directory, "audit"));
      for (const expected of runtimePolicy.audit.files) {
        const original = held.open(path.join(input.pin.auditDirectory, expected.name), expected, { privateFile: true }); const target = held.open(path.join(input.directory, "audit", expected.name), expected, { privateFile: true });
        const proofFile = value.files.find((f) => f.name === expected.name);
        if (!isDeepStrictEqual(original.identity, proofFile.source) || !isDeepStrictEqual(target.identity, proofFile.target)
          || !held.read(original).equals(held.read(target))) fail("audit_invalid");
        originals.set("audit/" + expected.name, original); copied.push({ ...target, name: "audit/" + expected.name, source: original.file, sourceIdentity: original.identity });
      } return value;
    });
    await record("COPY", async () => {
      for (const expected of input.pin.publicFiles) {
        const name = "public/" + expected.name; let parent = path.dirname(path.join(input.directory, name)); const missing = [];
        while (!held.directories.has(parent)) { missing.unshift(parent); parent = path.dirname(parent); }
        for (const dir of missing) held.makeDirectory(dir);
        const original = originals.get(expected.name); const target = held.copy(original, path.join(input.directory, name)); copied.push({ ...target, name, source: original.file, sourceIdentity: original.identity });
      }
      const original = originals.get("copy-receipt"); const target = held.copy(original, path.join(input.directory, "references/copy-receipt.json"));
      copied.push({ ...target, name: "references/copy-receipt.json", source: original.file, sourceIdentity: original.identity });
    });
    bundle = await record("BUNDLE", async () => {
      const value = await createPostgresPrivateEvidenceSourceBundle(bundleInput(input, deadline, signal));
      validatePostgresPrivateEvidenceSourceBundleProof(value, bundleInput(input, deadline));
      const target = held.open(path.join(input.directory, "source/recipes.bundle"), value.file, { privateFile: true });
      if (!isDeepStrictEqual(target.identity, value.file.identity)) fail("bundle_invalid"); held.seal(target);
      copied.push({ ...target, name: "source/recipes.bundle", source: null, sourceIdentity: null }); return value;
    });
    await record("FINAL_SEALS", async () => {
      inventories(input, held, copied); for (const original of originals.values()) held.seal(original); for (const target of copied) held.seal(target);
      const sealedAudit = await (dependencies.auditSeal ?? sealPostgresRuntimeAuditStage)({ directory: path.join(input.directory, "audit"), policy: runtimePolicy, workspace: input.workspace, deadline }, audit);
      if (!isDeepStrictEqual(sealedAudit, audit)) fail("audit_invalid");
      after = await (dependencies.archiveHealth ?? archiveHealth)(input, policyBytes, copyBytes, signal);
      validatePostgresPrivateCopyLinuxResult(after, input.pin.original, policy); if (!isDeepStrictEqual(before, after)) fail("health_invalid");
      await validatePostgresPrivateEvidenceSourceBundle(bundle, bundleInput(input, deadline, signal));
      if (!isDeepStrictEqual(sourceContext, await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }))) fail("source_invalid");
      inventories(input, held, copied); for (const original of originals.values()) held.seal(original); for (const target of copied) held.seal(target);
      for (const dir of held.directories.values()) fsyncSync(dir.fd);
    });
    const receipt = validatePostgresPrivateEvidenceReceipt({ kind: "POSTGRES_PRIVATE_EVIDENCE_INTAKE_V1", state: "INTAKE_VERIFIED", authority: "LOCAL_DIAGNOSTIC", purpose: input.pin.purpose,
      executionId: input.executionId, recipeRevision: input.recipeRevision, githubRunId: null, subject: input.pin.subject, imageId: input.pin.candidate.imageId, tag: input.pin.candidate.tag,
      directory: input.directory, filesystem: "EXT4", actor: { uid: 1000, gid: 1000 }, policyBytesBase64: policyBytes.toString("base64"), runtimePolicyBytesBase64: runtimeBytes.toString("base64"),
      payloads: copied.map((item) => ({ name: item.name, source: item.source, size: item.expected.size, sha256: item.expected.sha256, sourceIdentity: item.sourceIdentity, identity: item.identity })).sort((a, b) => a.name.localeCompare(b.name, "en")),
      directories: [...held.directories].filter(([file]) => file === input.directory || file.startsWith(input.directory + "/")).map(([file, value]) => ({ name: path.relative(input.directory, file), identity: value.identity })).sort((a, b) => a.name.localeCompare(b.name, "en")),
      audit, bundle, health: { before, after }, phases, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), historicalIntegrity: "VERIFIED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED",
      closure: "INCOMPLETE", requiredMissing: input.pin.requiredMissing, sourceUnchanged: true, privateState: "RETAINED", registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", network: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED",
      admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null }, input);
    phase = "PUBLISH"; held.guards(); receiptFile = path.join(input.directory, "receipt.json"); const published = publish(receiptFile, receipt, input); receiptIdentity = published.identity;
    const publishedFile = held.open(receiptFile, published, { privateFile: true });
    receiptDescriptor = publishedFile;
    if (!isDeepStrictEqual(publishedFile.identity, receiptIdentity)) fail("publication_failed"); held.seal(publishedFile);
    fsyncSync(held.directories.get(input.directory).fd); inventories(input, held, copied, true);
    for (const original of originals.values()) held.seal(original); for (const target of copied) held.seal(target);
    const finalHealth = await (dependencies.archiveHealth ?? archiveHealth)(input, policyBytes, copyBytes, signal);
    validatePostgresPrivateCopyLinuxResult(finalHealth, input.pin.original, policy);
    if (!isDeepStrictEqual(finalHealth, after)) fail("health_invalid");
    if (!isDeepStrictEqual(sourceContext, await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }))) fail("source_invalid");
    inventories(input, held, copied, true); for (const original of originals.values()) held.seal(original); for (const target of copied) held.seal(target);
    held.seal(publishedFile); check(deadline, signal); held.close();
    result = freeze({ state: "INTAKE_VERIFIED", executionId: input.executionId, recipeRevision: input.recipeRevision, directory: input.directory, receipt: published });
  } catch (error) { failure = error; }
  finally {
    if (failure && receiptIdentity) try { retireReceipt(); } catch { failure = new Error(PREFIX + "cleanup_uncertain"); phase = "CLEANUP"; }
    if (held) try { held.close(); } catch { failure = new Error(PREFIX + "cleanup_uncertain"); phase = "CLEANUP"; }
    if (failure && receiptIdentity) try { retireReceipt(); } catch { failure = new Error(PREFIX + "cleanup_uncertain"); phase = "CLEANUP"; }
  }
  if (failure) { const safeReason = reason(failure); const error = new Error(PREFIX + safeReason); error.phase = phase; error.cleanup = safeReason === "cleanup_uncertain" ? "UNVERIFIED" : "CONFIRMED"; throw error; } return result;
}
