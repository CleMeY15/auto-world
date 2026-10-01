import fs from "node:fs";
import { posix as path } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { clearTimeout, setTimeout } from "node:timers";
import { createSourceRetentionNativeSession } from "./source-retention-native-session.mjs";
import { validateCompiledPostgresCoreEvidenceInventoryPolicy, validateLoadedPostgresCoreEvidenceInventoryPolicy,
  getPostgresCoreEvidenceLoadedPolicySha256, getPostgresCoreEvidenceRetrievalReferences,
  getPostgresCoreEvidenceSourceBundleReference } from "./core-evidence-inventory-policy.mjs";
import { createPostgresCoreEvidenceInventory, loadPostgresCoreEvidenceInventory,
  serializePostgresCoreEvidenceInventory } from "./core-evidence-inventory.mjs";

const PREFIX = "postgres_core_evidence_retrieval_";
const PHASES = ["CONTEXT", "POLICY", "REFERENCES", "INVENTORY", "PUBLISH", "FINAL_SEAL", "OUTPUT", "CLEANUP"];
const REASONS = new Set(["arguments_invalid", "requires_native_root", "policy_invalid", "storage_invalid", "capacity_invalid", "file_invalid",
  "file_changed", "reference_invalid", "inventory_invalid", "publication_failed", "deadline_exceeded", "aborted", "cleanup_uncertain", "output_failed", "operation_failed"]);
const META = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const STABLE = ["dev", "ino", "uid", "gid", "mode", "nlink"];
const PROFILES = { ROOT_PRIVATE: [0, 0, 0o600], ACTOR_PRIVATE: [1000, 1000, 0o600], IMAGE_PRIVATE: [1000, 989, 0o600],
  ROOT_SHARED_PARENT: [0, 0, 0o600], ROOT_TRAVERSABLE_CODE_PARENT: [0, 0, 0o600], ROOT_PROTECTED_RECIPE: [0, 0, 0o400], ROOT_ACTOR_PROTECTED_RECIPE: [0, 1000, 0o440] };
const PARENTS = { ROOT_PRIVATE: [0, 0, 0o700], ACTOR_PRIVATE: [1000, 1000, 0o700], IMAGE_PRIVATE: [1000, 989, 0o700],
  ROOT_SHARED_PARENT: [1000, 1000, 0o750], ROOT_TRAVERSABLE_CODE_PARENT: [0, 1000, 0o750], ROOT_PROTECTED_RECIPE: [0, 0, 0o700], ROOT_ACTOR_PROTECTED_RECIPE: [0, 1000, 0o750] };
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const HEX = /^[0-9a-f]{64}$/u;
const errors = new WeakMap();
export const postgresCoreEvidenceRetrievalLimits = Object.freeze({ references: 1024, fileBytes: 1024 ** 3, totalBytes: 8 * 1024 ** 3,
  bundleBytes: 512 * 1024 ** 2, inventoryBytes: 16 * 1024 ** 2, receiptBytes: 8 * 1024 ** 2, acknowledgementBytes: 65536,
  operationMs: 15 * 60 * 1000, outputMs: 10000, cleanupMs: 10000, reserveBytes: 1024 ** 3 });
const LIMITS = postgresCoreEvidenceRetrievalLimits;
const CLAIMS = Object.freeze({ authority: "LOCAL_DIAGNOSTIC_ROOT_RETRIEVAL", trustBoundary: "TRUSTED_ADMIN_ROOT_KERNEL",
  hostileSameUidIsolation: "NOT_CLAIMED", offHostImmutability: "NOT_CLAIMED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED",
  signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value) + "\n");
const native = s => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const dirNative = s => Object.fromEntries(DIRECTORY.map(key => [key, native(s)[key]]));
const freeze = value => value && typeof value === "object" ? Object.freeze(Array.isArray(value) ? value.map(freeze)
  : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)]))) : value;
function fail(reason) { const error = new Error(PREFIX + reason); errors.set(error, { reason, phase: "CONTEXT", cleanup: "CONFIRMED" }); throw error; }
function need(value, reason) { if (!value) fail(reason); }
function record(value, fields) {
  need(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "arguments_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  need(keys.length === fields.length && keys.every(key => typeof key === "string" && fields.includes(key)), "arguments_invalid");
  return Object.fromEntries(fields.map(key => { const d = descriptors[key]; need(d?.enumerable && Object.hasOwn(d, "value"), "arguments_invalid"); return [key, d.value]; }));
}
function dataTree(value, depth = 0, budget = { left: 300000 }) {
  need(--budget.left >= 0 && depth <= 32, "arguments_invalid");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) { need(typeof value !== "number" || Number.isFinite(value), "arguments_invalid"); return; }
  const array = Array.isArray(value); need(array ? Object.getPrototypeOf(value) === Array.prototype : value && Object.getPrototypeOf(value) === Object.prototype, "arguments_invalid");
  const keys = Reflect.ownKeys(value); if (array) need(keys.length === value.length + 1, "arguments_invalid");
  for (const key of keys) { if (array && key === "length") continue; const d = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === "string" && d.enumerable && Object.hasOwn(d, "value") && (!array || /^(?:0|[1-9][0-9]*)$/u.test(key)), "arguments_invalid"); dataTree(d.value, depth + 1, budget); }
}
function metadata(value, size) {
  record(value, META); return ["dev", "ino", "mtimeNs", "ctimeNs"].every(key => typeof value[key] === "string" && DECIMAL.test(value[key]))
    && ["uid", "gid", "mode", "nlink", "size"].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
    && value.uid === 0 && value.gid === 0 && value.mode === 0o600 && value.nlink === 1 && value.size === size;
}
function privateDirectoryMetadata(value) {
  record(value, DIRECTORY); return ["dev", "ino"].every(key => typeof value[key] === "string" && DECIMAL.test(value[key]))
    && value.uid === 0 && value.gid === 0 && value.mode === 0o700;
}
function absolute(value) { return typeof value === "string" && value !== "/" && Buffer.byteLength(value) <= 4096 && path.isAbsolute(value)
  && path.normalize(value) === value && ![...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "\\"); }
function inputRecord(value) {
  return record(value, ["policy", "directory", "executionId", "recipeRevision", ...(Object.hasOwn(value ?? {}, "signal") ? ["signal"] : [])]);
}
function expectation(input, partial = false) {
  const nonce = typeof input.executionId === "string" ? /^local-core-evidence-([0-9a-f]{24})$/u.exec(input.executionId)?.[1] : undefined;
  need(nonce && input.directory === `/var/tmp/pg-core-evidence-${nonce}` && typeof input.recipeRevision === "string"
    && /^[0-9a-f]{40}$/u.test(input.recipeRevision), "arguments_invalid");
  try { if (partial) validateCompiledPostgresCoreEvidenceInventoryPolicy(input.policy); else validateLoadedPostgresCoreEvidenceInventoryPolicy(input.policy); }
  catch { fail("policy_invalid"); }
  return { executionId: input.executionId, recipeRevision: input.recipeRevision, directory: input.directory, subject: input.policy.subject,
    policySha256: partial ? null : getPostgresCoreEvidenceLoadedPolicySha256(input.policy) };
}
function sourceBundle(policy, refs, partial) {
  const bundle = getPostgresCoreEvidenceSourceBundleReference(policy);
  need(partial || bundle !== null, "policy_invalid");
  if (bundle === null) return null;
  const ref = refs.find(item => item.referenceId === bundle.referenceId);
  if (partial && !ref) return null;
  need(ref && ref.ownerProfile === "ACTOR_PRIVATE" && ref.size > 0 && ref.size <= LIMITS.bundleBytes
    && bundle.role === "SOURCE_RECIPE_BUNDLE" && bundle.provenance.kind === "VERIFIED_GIT_SOURCE_BUNDLE"
    && bundle.provenance.subject === policy.subject && typeof bundle.provenance.identifier === "string"
    && /^[0-9a-f]{40}$/u.test(bundle.provenance.identifier) && bundle.provenance.state === "BUNDLE_VERIFIED", "policy_invalid");
  const proof = record(bundle.proof, ["kind", "review", "fsck", "references", "state", "receiptReferenceId", "receiptSha256", "recipeRevision"]);
  const receipt = policy.references.find(item => item.id === proof.receiptReferenceId);
  need(proof.kind === "REVIEWED_SOURCE_BUNDLE_HELPER_PROOF" && proof.review === "INDEPENDENTLY_ACCEPTED" && proof.fsck === "STRICT_FULL"
    && proof.references === 8 && proof.state === "BUNDLE_VERIFIED" && proof.recipeRevision === bundle.provenance.identifier
    && receipt?.historical === false && receipt.role === "SOURCE_RECIPE_BUNDLE_HELPER_PROOF" && receipt.object.sha256 === proof.receiptSha256
    && isDeepStrictEqual(receipt.provenance, { kind: "VERIFIED_GIT_SOURCE_BUNDLE_HELPER_PROOF", subject: policy.subject,
      identifier: proof.recipeRevision, state: "BUNDLE_VERIFIED" }), "policy_invalid");
  return ref;
}
function localReferences(policy) {
  const refs = getPostgresCoreEvidenceRetrievalReferences(policy); need(refs.length > 0 && refs.length <= LIMITS.references, "reference_invalid");
  let bytes = 0;
  for (const ref of refs) { dataTree(ref); need(absolute(ref.path) && Number.isSafeInteger(ref.size) && ref.size >= 0 && ref.size <= LIMITS.fileBytes
    && typeof ref.sha256 === "string" && HEX.test(ref.sha256) && isDeepStrictEqual([ref.nativeIdentity.uid, ref.nativeIdentity.gid, ref.nativeIdentity.mode], PROFILES[ref.ownerProfile]), "reference_invalid");
    const expectedRole = { "historical-cold-receipt": "ROOT_COLD_LOAD_RECEIPT", "historical-sql-receipt": "ROOT_SQL_RESTORE_RECEIPT" }[ref.referenceId];
    const rootParent = ref.ownerProfile === "ROOT_PRIVATE" && expectedRole && expectedRole === policy.references.find(item => item.id === ref.referenceId)?.role
      && isDeepStrictEqual([ref.parentIdentity.uid, ref.parentIdentity.gid, ref.parentIdentity.mode], [0, 1000, 0o710]);
    need(isDeepStrictEqual([ref.parentIdentity.uid, ref.parentIdentity.gid, ref.parentIdentity.mode], PARENTS[ref.ownerProfile]) || rootParent, "reference_invalid");
    bytes += ref.size; need(Number.isSafeInteger(bytes) && bytes <= LIMITS.totalBytes, "reference_invalid"); }
  return refs;
}
export function postgresCoreEvidenceRetrievalFailureDiagnostic(error) {
  const value = errors.get(error);
  return Object.freeze({ code: PREFIX + (value?.reason ?? "operation_failed"), phase: PHASES.includes(value?.phase) ? value.phase : "CONTEXT",
    cleanup: value?.reason !== "cleanup_uncertain" && value?.cleanup === "CONFIRMED" ? "CONFIRMED" : "UNVERIFIED" });
}
export function validatePostgresCoreEvidenceRetrievalFailureDiagnostic(value) {
  try { const item = record(value, ["code", "phase", "cleanup"]);
    need(typeof item.code === "string" && item.code.startsWith(PREFIX) && REASONS.has(item.code.slice(PREFIX.length)) && PHASES.includes(item.phase)
      && ["CONFIRMED", "UNVERIFIED"].includes(item.cleanup) && (item.code !== PREFIX + "cleanup_uncertain" || item.cleanup === "UNVERIFIED"), "arguments_invalid"); return freeze(item);
  } catch { fail("arguments_invalid"); }
}
function outputProof(value, name, limit) {
  record(value, ["name", "size", "sha256", "identity"]); need(value.name === name && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= limit
    && typeof value.sha256 === "string" && HEX.test(value.sha256) && metadata(value.identity, value.size), "inventory_invalid");
}
function disjointProofs(files, directory, refs) {
  const key = identity => `${identity.dev}:${identity.ino}`;
  const originals = new Set(refs.flatMap(ref => [key(ref.nativeIdentity), key(ref.parentIdentity)]));
  const ids = files.map(key);
  need(!originals.has(key(directory)) && new Set(ids).size === ids.length
    && ids.every(id => !originals.has(id) && id !== key(directory)), "inventory_invalid");
}
function receiptExpected(input, partial, refs, inventory) {
  return { kind: partial ? "TEST_ONLY_POSTGRES_CORE_EVIDENCE_RETRIEVAL_RECEIPT_V1" : "POSTGRES_CORE_EVIDENCE_RETRIEVAL_RECEIPT_V1",
    state: "PUBLISHED_AWAITING_RETRIEVAL_ACK", ...expectation(input, partial), references: refs,
    claims: { ...CLAIMS, closure: partial ? "NOT_ESTABLISHED" : "CATALOG_COMPLETE_RETRIEVAL_REQUIRED",
      acceptanceRequiresClosedRetrieverAck: true, selectedReferencesOnly: !!partial },
    inventory: { name: "inventory.json", size: inventory.length, sha256: sha(inventory) },
    sourceUnchanged: true, descriptorClosure: "REQUIRED_BEFORE_ACK", phases: ["POLICY", "REFERENCES", "INVENTORY", "PUBLISH", "FINAL_SEAL"] };
}
export function validatePostgresCoreEvidenceRetrievalReceipt(value, inputRaw) {
  try { dataTree(value); const input = inputRecord(inputRaw), refs = localReferences(input.policy), bytes = serializePostgresCoreEvidenceInventory(createPostgresCoreEvidenceInventory(input.policy), input.policy);
    const result = record(value, ["kind", "state", "executionId", "recipeRevision", "directory", "subject", "policySha256", "references", "claims", "inventory",
      "sourceUnchanged", "descriptorClosure", "phases", "directoryIdentity", "inventoryIdentity", "bundle"]);
    const expected = receiptExpected(input, false, refs, bytes);
    need(Object.entries(expected).every(([key, item]) => isDeepStrictEqual(result[key], item)), "inventory_invalid");
    need(privateDirectoryMetadata(result.directoryIdentity), "inventory_invalid");
    need(metadata(result.inventoryIdentity, bytes.length), "inventory_invalid");
    const ref = sourceBundle(input.policy, refs, false); outputProof(result.bundle, "source/recipes.bundle", LIMITS.bundleBytes);
    need(result.bundle.size === ref.size && result.bundle.sha256 === ref.sha256, "inventory_invalid");
    disjointProofs([result.inventoryIdentity, result.bundle.identity], result.directoryIdentity, refs);
    return freeze(result);
  } catch { fail("inventory_invalid"); }
}
export function validatePostgresCoreEvidenceRetrievalAcknowledgement(value, inputRaw) {
  try { dataTree(value); const input = inputRecord(inputRaw), result = record(value, ["kind", "state", "executionId", "recipeRevision", "directory", "subject", "policySha256", "directoryIdentity", "inventory",
    "receipt", "bundle", "references", "sourceUnchanged", "descriptorsClosed", "claims"]); const expected = expectation(input), refs = localReferences(input.policy);
    need(result.kind === "POSTGRES_CORE_EVIDENCE_RETRIEVAL_ACK_V1" && result.state === "RETRIEVED" && Object.entries(expected).every(([key, item]) => result[key] === item)
      && result.sourceUnchanged === true && result.descriptorsClosed === true && isDeepStrictEqual(result.claims, { ...CLAIMS, closure: "CORE_COMPLETE",
        acceptanceRequiresClosedRetrieverAck: true, selectedReferencesOnly: false }), "inventory_invalid");
    need(privateDirectoryMetadata(result.directoryIdentity), "inventory_invalid");
    outputProof(result.inventory, "inventory.json", LIMITS.inventoryBytes); outputProof(result.receipt, "receipt.json", LIMITS.receiptBytes);
    const bytes = serializePostgresCoreEvidenceInventory(createPostgresCoreEvidenceInventory(input.policy), input.policy);
    need(result.inventory.size === bytes.length && result.inventory.sha256 === sha(bytes) && isDeepStrictEqual(result.references,
      { count: refs.length, bytes: refs.reduce((sum, ref) => sum + ref.size, 0), digest: sha(encode(refs)) }), "inventory_invalid");
    const ref = sourceBundle(input.policy, refs, false); outputProof(result.bundle, "source/recipes.bundle", LIMITS.bundleBytes);
    need(result.bundle.size === ref.size && result.bundle.sha256 === ref.sha256, "inventory_invalid");
    const receipt = { ...receiptExpected(input, false, refs, bytes), directoryIdentity: result.directoryIdentity,
      inventoryIdentity: result.inventory.identity, bundle: result.bundle };
    validatePostgresCoreEvidenceRetrievalReceipt(receipt, input);
    const receiptBytes = encode(receipt);
    need(result.receipt.size === receiptBytes.length && result.receipt.sha256 === sha(receiptBytes), "inventory_invalid");
    disjointProofs([result.inventory.identity, result.receipt.identity, result.bundle.identity], result.directoryIdentity, refs); return freeze(result);
  } catch { fail("inventory_invalid"); }
}
async function bounded(callback, value, signal, deadline, reason) {
  if (!callback) return;
  const ms = Math.min(LIMITS.outputMs, Math.max(1, deadline - Date.now())), expires = Date.now() + ms;
  await new Promise((resolve, reject) => { let done = false; const finish = ok => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
    if (ok && !signal.aborted && Date.now() < expires && Date.now() < deadline) resolve(); else { try { fail(reason); } catch (error) { reject(error); } } }; const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), ms); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted || Date.now() >= deadline) finish(false); else Promise.resolve().then(() => callback(value)).then(() => finish(true), () => finish(false)); });
}
function rootWriter(session, deadline, signal) {
  const handles = [], directories = [], files = []; let closed = false;
  const check = () => { session.guards(); need(!signal.aborted && Date.now() < deadline, signal.aborted ? "aborted" : "deadline_exceeded"); };
  const guards = () => { session.guards(false); for (const entry of directories) { const s = fs.lstatSync(entry.path, { bigint: true }); need(s.isDirectory()
    && !s.isSymbolicLink() && fs.realpathSync(entry.path) === entry.path && isDeepStrictEqual(dirNative(s), entry.identity)
    && (closed || isDeepStrictEqual(dirNative(fs.fstatSync(entry.fd, { bigint: true })), entry.identity)), "cleanup_uncertain"); } };
  const holdDirectory = file => { const before = fs.lstatSync(file, { bigint: true }); need(before.isDirectory() && !before.isSymbolicLink() && fs.realpathSync(file) === file, "storage_invalid");
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); handles.push(fd);
    need(isDeepStrictEqual(dirNative(before), dirNative(fs.fstatSync(fd, { bigint: true }))) && fs.statfsSync(`/proc/self/fd/${fd}`, { bigint: true }).type === 0xef53n, "storage_invalid");
    const entry = { path: file, fd, identity: dirNative(before) }; directories.push(entry); return entry; };
  const prepare = () => { for (const file of ["/", "/var", "/var/tmp"]) { const parent = holdDirectory(file);
    need(parent.identity.uid === 0 && parent.identity.gid === 0 && (file === "/var/tmp" ? parent.identity.mode === 0o1777 : (parent.identity.mode & 0o6022) === 0), "storage_invalid"); } };
  const mkdir = file => { check(); guards(); fs.mkdirSync(file, { mode: 0o700 }); const entry = holdDirectory(file);
    need(entry.identity.uid === 0 && entry.identity.gid === 0 && entry.identity.mode === 0o700, "storage_invalid");
    fs.fsyncSync(directories.find(item => item.path === path.dirname(file)).fd); fs.fsyncSync(entry.fd); guards(); return entry; };
  const guardFile = item => { guards(); const opened = fs.fstatSync(item.fd, { bigint: true }), named = fs.lstatSync(item.file, { bigint: true });
    need(opened.isFile() && named.isFile() && !named.isSymbolicLink() && fs.realpathSync(item.file) === item.file
      && metadata(native(opened), item.size) && isDeepStrictEqual(native(opened), native(named))
      && isDeepStrictEqual(native(opened), item.identity), "file_changed"); };
  const seal = item => { check(); guardFile(item); const buffer = Buffer.alloc(Math.min(1024 ** 2, Math.max(1, item.size))); const digest = createHash("sha256"); let at = 0;
    while (at < item.size) { check(); const n = fs.readSync(item.fd, buffer, 0, Math.min(buffer.length, item.size - at), at); need(n > 0, "file_changed"); digest.update(buffer.subarray(0, n)); at += n; }
    need(fs.readSync(item.fd, Buffer.alloc(1), 0, 1, at) === 0 && digest.digest("hex") === item.sha256, "file_changed"); guardFile(item); };
  const publish = (file, size, digest, source) => { check(); guards(); const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); handles.push(fd);
    const item = { file, fd, size, sha256: digest, own: native(fs.fstatSync(fd, { bigint: true })) }; files.push(item);
    need(item.own.uid === 0 && item.own.gid === 0 && item.own.mode === 0o600 && item.own.nlink === 1, "publication_failed");
    const block = Buffer.alloc(Math.min(1024 ** 2, Math.max(1, size))); let at = 0;
    while (at < size) { check(); const part = Buffer.isBuffer(source) ? source.subarray(at, at + block.length) : (() => { const count = fs.readSync(source.fd, block, 0, Math.min(block.length, size - at), at); need(count > 0, "file_changed"); return block.subarray(0, count); })();
      let wrote = 0; while (wrote < part.length) { const n = fs.writeSync(fd, part, wrote, part.length - wrote, at + wrote); need(n > 0, "publication_failed"); wrote += n; } at += part.length; }
    fs.fsyncSync(fd); item.identity = native(fs.fstatSync(fd, { bigint: true })); seal(item); fs.fsyncSync(directories.find(entry => entry.path === path.dirname(file)).fd); guards(); return item; };
  const close = () => { if (closed) return; closed = true; let uncertain = false; for (const fd of handles.splice(0).reverse()) try { fs.closeSync(fd); } catch { uncertain = true; }
    need(!uncertain, "cleanup_uncertain"); };
  const retire = item => { guards(); const s = fs.lstatSync(item.file, { bigint: true }); need(s.isFile() && !s.isSymbolicLink() && fs.realpathSync(item.file) === item.file
    && STABLE.every(key => native(s)[key] === item.own[key]), "cleanup_uncertain"); fs.unlinkSync(item.file);
    // Closure may already have succeeded; reopen only the proven own directory for durability of retirement.
    const directory = directories.find(entry => entry.path === path.dirname(item.file)); const fd = fs.openSync(directory.path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    let uncertain = false; try { need(isDeepStrictEqual(dirNative(fs.fstatSync(fd, { bigint: true })), directory.identity), "cleanup_uncertain"); fs.fsyncSync(fd); } finally { try { fs.closeSync(fd); } catch { uncertain = true; } }
    need(!uncertain, "cleanup_uncertain"); guards(); };
  return { prepare, mkdir, publish, seal, guards, close, retire, files, directories };
}
async function operate(inputRaw, controlsRaw, dependencies, partial) {
  let phase = "CONTEXT", session, writer, receipt, errorValue, inputSignal, abortListener;
  const controller = new globalThis.AbortController(), deadline = Date.now() + LIMITS.operationMs;
  try {
    record(dependencies, []); const input = inputRecord(inputRaw), controls = record(controlsRaw, Object.hasOwn(controlsRaw ?? {}, "result") ? ["result"] : []);
    need(controls.result === undefined || typeof controls.result === "function", "arguments_invalid");
    need(input.signal === undefined || input.signal instanceof globalThis.AbortSignal, "arguments_invalid");
    if (input.signal?.aborted) fail("aborted"); inputSignal = input.signal; abortListener = () => controller.abort(); inputSignal?.addEventListener("abort", abortListener, { once: true });
    const expected = expectation(input, !!partial); let refs = localReferences(input.policy);
    if (partial) { record(partial, ["referenceIds", "hooks"]); dataTree(partial.referenceIds); need(Array.isArray(partial.referenceIds) && partial.referenceIds.length > 0
      && partial.referenceIds.length <= 16 && new Set(partial.referenceIds).size === partial.referenceIds.length, "arguments_invalid");
      const chosen = new Set(partial.referenceIds); refs = refs.filter(ref => chosen.has(ref.referenceId)); need(refs.length === chosen.size, "arguments_invalid");
      const hooks = record(partial.hooks, Object.keys(partial.hooks)); need(Object.keys(hooks).every(key => ["afterReferences", "afterPublication", "beforeClose"].includes(key) && typeof hooks[key] === "function"), "arguments_invalid"); }
    phase = "POLICY";
    need(process.platform === "linux" && process.version === "v22.23.2" && process.getuid() === 0 && process.geteuid() === 0 && process.getgid() === 0 && process.getegid() === 0, "requires_native_root");
    const status = fs.readFileSync("/proc/self/status", "utf8"); for (const field of ["Uid", "Gid"]) need(new RegExp(`^${field}:[ \\t]+0[ \\t]+0[ \\t]+0[ \\t]+0$`, "mu").test(status), "requires_native_root");
    const signal = controller.signal; session = createSourceRetentionNativeSession(deadline, signal, fail);
    phase = "REFERENCES"; const opened = new Map(), parents = new Set();
    for (const ref of refs) { session.guards(); const item = opened.get(ref.path) ?? session.open(ref.path, ref, ...PROFILES[ref.ownerProfile]);
      const parent = path.dirname(ref.path); if (!parents.has(parent)) { session.directory(parent, ref.parentIdentity); parents.add(parent); }
      need(isDeepStrictEqual(item.identity, ref.nativeIdentity) && isDeepStrictEqual(dirNative(fs.lstatSync(path.dirname(ref.path), { bigint: true })), ref.parentIdentity)
        && fs.statfsSync(`/proc/self/fd/${item.fd}`, { bigint: true }).type === 0xef53n, "reference_invalid"); opened.set(ref.path, item); }
    const reseal = () => { for (const ref of refs) { const item = opened.get(ref.path); session.read(item); const digest512 = ref.sha512 === null ? null : createHash("sha512");
      const blob = ref.gitBlobSha1 === null ? null : createHash("sha1").update(`blob ${ref.size}\0`); const buffer = Buffer.alloc(Math.min(1024 ** 2, Math.max(1, ref.size))); let at = 0;
      if (digest512 || blob) { session.fileGuard(item); while (at < ref.size) { session.check(); const n = fs.readSync(item.fd, buffer, 0, Math.min(buffer.length, ref.size - at), at);
        need(n > 0, "file_changed"); digest512?.update(buffer.subarray(0, n)); blob?.update(buffer.subarray(0, n)); at += n; }
        need(fs.readSync(item.fd, Buffer.alloc(1), 0, 1, at) === 0 && (!digest512 || digest512.digest("hex") === ref.sha512) && (!blob || blob.digest("hex") === ref.gitBlobSha1), "file_changed"); }
      session.fileGuard(item); need(isDeepStrictEqual(dirNative(fs.lstatSync(path.dirname(ref.path), { bigint: true })), ref.parentIdentity), "file_changed"); } session.guards(); };
    reseal(); if (partial) await bounded(partial.hooks.afterReferences, undefined, signal, deadline, "operation_failed"); reseal();
    phase = "INVENTORY"; const inventoryBytes = partial ? encode({ kind: "TEST_ONLY_POSTGRES_CORE_EVIDENCE_SELECTED_INVENTORY_V1",
      references: refs, closure: "NOT_ESTABLISHED", selectedReferencesOnly: true }) : serializePostgresCoreEvidenceInventory(createPostgresCoreEvidenceInventory(input.policy), input.policy);
    need(inventoryBytes.length <= LIMITS.inventoryBytes, "inventory_invalid"); if (!partial) loadPostgresCoreEvidenceInventory(inventoryBytes, input.policy);
    const bundleRef = sourceBundle(input.policy, refs, !!partial);
    const space = fs.statfsSync("/var/tmp", { bigint: true }); need(space.type === 0xef53n && space.bavail * space.bsize >= BigInt(LIMITS.reserveBytes
      + inventoryBytes.length + LIMITS.receiptBytes + (bundleRef?.size ?? 0)), "capacity_invalid");
    need(refs.every(ref => !ref.path.startsWith(input.directory + "/") && ref.path !== input.directory), "storage_invalid");
    phase = "PUBLISH"; writer = rootWriter(session, deadline, signal); writer.prepare();
    session.directory("/var/tmp", dirNative(fs.lstatSync("/var/tmp", { bigint: true }))); const directory = writer.mkdir(input.directory);
    const inventoryFile = writer.publish(path.join(input.directory, "inventory.json"), inventoryBytes.length, sha(inventoryBytes), inventoryBytes);
    let bundleFile = null; if (bundleRef) { writer.mkdir(path.join(input.directory, "source")); bundleFile = writer.publish(path.join(input.directory, "source/recipes.bundle"), bundleRef.size, bundleRef.sha256, opened.get(bundleRef.path)); }
    const proof = item => ({ name: path.relative(input.directory, item.file), size: item.size, sha256: item.sha256, identity: item.identity });
    const value = { ...receiptExpected(input, !!partial, refs, inventoryBytes), directoryIdentity: directory.identity, inventoryIdentity: inventoryFile.identity, bundle: bundleFile ? proof(bundleFile) : null };
    if (!partial) validatePostgresCoreEvidenceRetrievalReceipt(value, input); const receiptBytes = encode(value); need(receiptBytes.length <= LIMITS.receiptBytes, "inventory_invalid");
    receipt = writer.publish(path.join(input.directory, "receipt.json"), receiptBytes.length, sha(receiptBytes), receiptBytes);
    if (partial) await bounded(partial.hooks.afterPublication, freeze({ receipt: receipt.file, directory: input.directory }), signal, deadline, "operation_failed");
    const compareBundle = () => { if (!bundleFile) return; const original = opened.get(bundleRef.path), left = Buffer.alloc(1024 ** 2), right = Buffer.alloc(1024 ** 2); let at = 0;
      session.fileGuard(original); writer.seal(bundleFile);
      while (at < bundleRef.size) { session.check(); const length = Math.min(left.length, bundleRef.size - at), a = fs.readSync(original.fd, left, 0, length, at), b = fs.readSync(bundleFile.fd, right, 0, length, at);
        need(a === length && b === length && left.subarray(0, length).equals(right.subarray(0, length)), "file_changed"); at += length; }
      need(fs.readSync(original.fd, left, 0, 1, at) === 0 && fs.readSync(bundleFile.fd, right, 0, 1, at) === 0, "file_changed"); session.fileGuard(original); writer.seal(bundleFile); };
    phase = "FINAL_SEAL"; reseal(); for (const file of writer.files) writer.seal(file); compareBundle();
    need(isDeepStrictEqual(fs.readdirSync(input.directory).sort(), bundleFile ? ["inventory.json", "receipt.json", "source"] : ["inventory.json", "receipt.json"])
      && (!bundleFile || isDeepStrictEqual(fs.readdirSync(path.join(input.directory, "source")), ["recipes.bundle"])), "file_changed");
    if (partial) await bounded(partial.hooks.beforeClose, undefined, signal, deadline, "operation_failed");
    reseal(); for (const file of writer.files) writer.seal(file); compareBundle();
    const sourceIds = new Set(refs.map(ref => `${ref.nativeIdentity.dev}:${ref.nativeIdentity.ino}`));
    need(writer.files.every(file => !sourceIds.has(`${file.identity.dev}:${file.identity.ino}`)), "publication_failed");
    writer.guards(); session.close(); writer.close();
    const result = { kind: partial ? "TEST_ONLY_POSTGRES_CORE_EVIDENCE_RETRIEVAL_ACK_V1" : "POSTGRES_CORE_EVIDENCE_RETRIEVAL_ACK_V1",
      state: partial ? "PARTIAL_ROOT_RETRIEVAL_PROOF" : "RETRIEVED", ...expected, directoryIdentity: directory.identity, inventory: proof(inventoryFile), receipt: proof(receipt), bundle: bundleFile ? proof(bundleFile) : null,
      references: { count: refs.length, bytes: refs.reduce((sum, ref) => sum + ref.size, 0), digest: sha(encode(refs)) }, sourceUnchanged: true,
      descriptorsClosed: true, claims: { ...CLAIMS, closure: partial ? "NOT_ESTABLISHED" : "CORE_COMPLETE",
        acceptanceRequiresClosedRetrieverAck: true, selectedReferencesOnly: !!partial } };
    if (!partial) validatePostgresCoreEvidenceRetrievalAcknowledgement(result, input); need(encode(result).length <= LIMITS.acknowledgementBytes, "inventory_invalid");
    phase = "OUTPUT"; await bounded(controls.result, freeze(result), signal, deadline, "output_failed");
    writer.guards(); for (const file of writer.files) need(isDeepStrictEqual(native(fs.lstatSync(file.file, { bigint: true })), file.identity), "file_changed");
    for (const ref of refs) need(isDeepStrictEqual(native(fs.lstatSync(ref.path, { bigint: true })), ref.nativeIdentity), "file_changed");
    session.check();
    return freeze(result);
  } catch (error) {
    let uncertain = errors.get(error)?.reason === "cleanup_uncertain";
    receipt ??= writer?.files.find(item => path.basename(item.file) === "receipt.json");
    try { if (receipt) writer.retire(receipt); } catch { uncertain = true; }
    try { session?.close(); } catch { uncertain = true; } try { writer?.close(); } catch { uncertain = true; }
    if (uncertain) { try { fail("cleanup_uncertain"); } catch (value) { errorValue = value; } phase = "CLEANUP"; }
    else if (errors.has(error)) errorValue = error;
    else { try { fail("operation_failed"); } catch (value) { errorValue = value; } }
    errors.set(errorValue, { reason: errors.get(errorValue).reason, phase, cleanup: uncertain ? "UNVERIFIED" : "CONFIRMED" }); throw errorValue;
  } finally { inputSignal?.removeEventListener("abort", abortListener); controller.abort(); }
}
export async function retrievePostgresCoreEvidence(input, controls = {}, dependencies = {}) { return await operate(input, controls, dependencies, null); }
export async function TEST_ONLY_retrievePostgresCoreEvidence(input, controls = {}, options) { record(options, ["referenceIds", "hooks"]); return await operate(input, controls, {}, options); }
