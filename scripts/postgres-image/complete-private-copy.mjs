import fs from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { posix as path } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual } from "node:util";
import { getPostgresCompletePrivateCopyPolicySha256, getPostgresCompletePrivateCopyReferences,
  postgresCompletePrivateCopyPolicyContract, postgresCompletePrivateCopyPolicyLimits,
  TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy, validateLoadedPostgresCompletePrivateCopyPolicy } from
  "./complete-private-copy-policy.mjs";
import { copyEvidenceGeneration, retrieveEvidenceGeneration, TEST_ONLY_copyEvidenceGeneration,
  TEST_ONLY_retrieveEvidenceGeneration } from "./evidence-generation-transfer.mjs";

const PREFIX = "postgres_complete_private_copy_";
const STORAGE_ROOT = "/opt/auto-world/private-archives";
const WINDOWS_ROOT = "/mnt/c";
const INPUT_KEYS = ["policy", "executionId", "recipeRevision", "launchPlanSha256", "launchControlReservedBytes", "signal"];
const STABLE = ["dev", "ino", "uid", "gid", "mode", "nlink"];
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const SHA256 = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const EXECUTION = /^pg-complete-([0-9a-f]{24})$/u;
const LIMITS = Object.freeze({ operationMs: 15 * 60 * 1000, outputMs: 10000, policyBytes: 16 * 1024 * 1024,
  inventoryBytes: 16 * 1024 * 1024, receiptBytes: 16 * 1024 * 1024, acknowledgementBytes: 64 * 1024,
  reserveBytes: 1024 ** 3, descriptorSafety: 64 });
export const postgresCompletePrivateCopyLaunchControlReservedBytes = 256 * 1024 * 1024;
const FAILURE_REASONS = new Set(["arguments_invalid", "requires_native_root", "policy_invalid", "capacity_invalid", "descriptors_invalid",
  "storage_invalid", "publication_failed", "file_changed", "transfer_failed", "inventory_invalid", "deadline_exceeded", "aborted",
  "output_failed", "cleanup_uncertain", "operation_failed"]);
const failures = new WeakMap();

const encode = value => Buffer.from(`${JSON.stringify(value)}\n`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const identityKey = value => `${value.dev}:${value.ino}`;
const native = value => ({ dev: String(value.dev), ino: String(value.ino), uid: Number(value.uid), gid: Number(value.gid),
  mode: Number(value.mode & 0o7777n), nlink: Number(value.nlink), size: Number(value.size),
  mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) });
const directoryNative = value => Object.fromEntries(DIRECTORY.map(key => [key, native(value)[key]]));
const freeze = value => value && typeof value === "object" ? Object.freeze(Array.isArray(value) ? value.map(freeze)
  : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)]))) : value;
function fail(reason) { const error = new Error(PREFIX + reason); failures.set(error, reason); throw error; }
function need(value, reason) { if (!value) fail(reason); }
function record(value, keys, reason = "arguments_invalid") {
  need(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, reason);
  const descriptors = Object.getOwnPropertyDescriptors(value), ownKeys = Reflect.ownKeys(descriptors);
  need(ownKeys.length === keys.length && ownKeys.every(key => typeof key === "string" && keys.includes(key)), reason);
  return Object.fromEntries(keys.map(key => { const descriptor = descriptors[key];
    need(descriptor?.enumerable === true && Object.hasOwn(descriptor, "value"), reason); return [key, descriptor.value]; }));
}
function array(value, maximum, reason = "arguments_invalid") {
  need(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= maximum, reason);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  need(Reflect.ownKeys(descriptors).length === value.length + 1 && descriptors.length?.value === value.length, reason);
  return Array.from({ length: value.length }, (_unused, index) => {
    const descriptor = descriptors[String(index)]; need(descriptor?.enumerable === true && Object.hasOwn(descriptor, "value"), reason); return descriptor.value;
  });
}
function checkedAdd(left, right) { const value = left + right; need(Number.isSafeInteger(value), "capacity_invalid"); return value; }
function check(signal, deadline) { need(!signal.aborted, "aborted"); need(performance.now() < deadline, "deadline_exceeded"); }
function policyProjection(policy, policySha256, references, testOnly) {
  return { authority: testOnly ? "TEST_ONLY_COMPILED_CAPABILITY" : "HASH_LOADED_PRODUCTION", sha256: policySha256,
    subject: policy.subject, corePolicySha256: policy.corePolicySha256, coreReferenceDigest: policy.coreReferenceDigest,
    coreReferenceCount: policy.coreReferenceCount, supplementalAcceptance: policy.supplementalAcceptance,
    groups: { core: policy.corePolicy.groups, supplemental: policy.groups }, history: policy.corePolicy.history,
    references: { count: references.length, bytes: references.reduce((sum, item) => checkedAdd(sum, item.size), 0),
      digest: sha(encode(references)), selectedFixtureOnly: testOnly } };
}
function inventory(policy, policyProof, references, testOnly) {
  const objects = new Map();
  for (const reference of references) {
    const prior = objects.get(reference.sha256);
    if (prior) {
      need(prior.size === reference.size && !(prior.sha512 !== null && reference.sha512 !== null && prior.sha512 !== reference.sha512)
        && !(prior.gitBlobSha1 !== null && reference.gitBlobSha1 !== null && prior.gitBlobSha1 !== reference.gitBlobSha1), "inventory_invalid");
      prior.sha512 ??= reference.sha512; prior.gitBlobSha1 ??= reference.gitBlobSha1; prior.referenceIds.push(reference.referenceId);
    } else objects.set(reference.sha256, { sha256: reference.sha256, size: reference.size, sha512: reference.sha512,
      gitBlobSha1: reference.gitBlobSha1, referenceIds: [reference.referenceId] });
  }
  const physical = [...objects.values()].sort((left, right) => left.sha256.localeCompare(right.sha256));
  for (const item of physical) item.referenceIds.sort();
  const value = { kind: testOnly ? "TEST_ONLY_POSTGRES_COMPLETE_PRIVATE_COPY_INVENTORY_V1" : "POSTGRES_COMPLETE_PRIVATE_COPY_INVENTORY_V1",
    policy: policyProof, logicalGroups: { core: policy.corePolicy.groups, supplemental: policy.groups },
    history: policy.corePolicy.history, references, objects: physical,
    totals: { references: references.length, referenceBytes: references.reduce((sum, item) => checkedAdd(sum, item.size), 0),
      objects: physical.length, uniqueObjectBytes: physical.reduce((sum, item) => checkedAdd(sum, item.size), 0) } };
  const bytes = encode(value); need(bytes.length <= LIMITS.inventoryBytes, "inventory_invalid"); return { value, bytes, objects: physical };
}
function sourceAncestors(references) {
  const values = new Set();
  for (const reference of references) { let at = "/"; values.add(at);
    for (const part of path.dirname(reference.path).split("/").filter(Boolean)) { at = path.join(at, part); values.add(at); } }
  return values;
}
function transferDescriptorBudget(references) {
  const sourceFiles = new Set(references.map(item => item.path)).size, ancestors = sourceAncestors(references);
  let at = "/"; ancestors.add(at);
  for (const part of STORAGE_ROOT.split("/").filter(Boolean)) { at = path.join(at, part); ancestors.add(at); }
  const sourceAncestorCount = ancestors.size, objects = new Set(references.map(item => item.sha256)).size;
  const identityReservations = checkedAdd(checkedAdd(checkedAdd(references.length, references.length), references.length), 13);
  const writerDirectories = 7;
  const required = [sourceFiles, sourceAncestorCount, objects, identityReservations, writerDirectories, LIMITS.descriptorSafety]
    .reduce((sum, value) => checkedAdd(sum, value), 0);
  return { sourceFiles, sourceAncestors: sourceAncestorCount, objects, identityReservations, writerDirectories,
    safety: LIMITS.descriptorSafety, required };
}
function fileLimit() {
  const text = fs.readFileSync("/proc/self/limits", "utf8"), match = /^Max open files[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]+files[ \t]*$/mu.exec(text);
  need(match, "descriptors_invalid"); const soft = Number(match[1]), hard = Number(match[2]);
  need(Number.isSafeInteger(soft) && Number.isSafeInteger(hard) && soft > 0 && hard >= soft, "descriptors_invalid"); return { soft, hard };
}
function holdDirectories(files, protectedCount) {
  const entries = [], handles = [];
  try {
    for (const [index, file] of files.entries()) { const before = fs.lstatSync(file, { bigint: true });
      need(before.isDirectory() && !before.isSymbolicLink() && fs.realpathSync(file) === file, "storage_invalid");
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); handles.push(fd);
      const identity = directoryNative(before); need(isDeepStrictEqual(identity, directoryNative(fs.fstatSync(fd, { bigint: true }))), "storage_invalid");
      if (index < protectedCount) need(identity.uid === 0 && identity.gid === 0 && (identity.mode & 0o6022) === 0, "storage_invalid");
      entries.push({ path: file, fd, identity, statfs: fs.statfsSync(`/proc/self/fd/${fd}`, { bigint: true }) }); }
    return { entries, close() { let uncertain = false; for (const fd of handles.splice(0).reverse()) try { fs.closeSync(fd); } catch { uncertain = true; }
      need(!uncertain, "cleanup_uncertain"); } };
  } catch (error) { let uncertain = false; for (const fd of handles.splice(0).reverse()) try { fs.closeSync(fd); } catch { uncertain = true; }
    if (uncertain) fail("cleanup_uncertain"); throw error; }
}
function inspectCapacity(input, references, serializedCapabilityBytes, inventoryBytes, uniqueObjectBytes, fault, deadline, signal) {
  check(signal, deadline); const descriptorBudget = transferDescriptorBudget(references);
  const open = fs.readdirSync("/proc/self/fd").length, limits = fileLimit();
  need(fault !== "DESCRIPTORS" && limits.soft - open >= descriptorBudget.required, "descriptors_invalid");
  const policyReservationBytes = checkedAdd(serializedCapabilityBytes, serializedCapabilityBytes);
  const requiredBytes = 2n * BigInt(uniqueObjectBytes) + BigInt(policyReservationBytes)
    + 2n * BigInt(inventoryBytes + input.launchControlReservedBytes)
    + BigInt(LIMITS.receiptBytes + LIMITS.acknowledgementBytes + LIMITS.reserveBytes);
  need(requiredBytes <= BigInt(Number.MAX_SAFE_INTEGER), "capacity_invalid");
  const held = holdDirectories(["/", "/opt", "/opt/auto-world", STORAGE_ROOT, "/mnt", WINDOWS_ROOT], 4);
  try {
    const storage = held.entries[3], windows = held.entries[5];
    need(storage.identity.mode === 0o700 && storage.statfs.type === 0xef53n, "storage_invalid");
    const nativeAvailable = storage.statfs.bavail * storage.statfs.bsize, windowsAvailable = windows.statfs.bavail * windows.statfs.bsize;
    need(fault !== "CAPACITY_NATIVE" && nativeAvailable >= requiredBytes, "capacity_invalid");
    need(fault !== "CAPACITY_WINDOWS" && windowsAvailable >= requiredBytes, "capacity_invalid"); check(signal, deadline);
    return { kind: "POSTGRES_COMPLETE_PRIVATE_COPY_CAPACITY_V1", state: "CAPACITY_VERIFIED_BEFORE_EFFECT",
      execution: { executionId: input.executionId, recipeRevision: input.recipeRevision, launchPlanSha256: input.launchPlanSha256 },
      required: { uniqueObjectBytes, serializedCapabilityBytes, rawPolicyBytes: "UNAVAILABLE_BOUNDED_BY_SERIALIZED_CAPABILITY",
        policyReservationBytes, inventoryBytes, launchControlBytes: input.launchControlReservedBytes,
        receiptCap: LIMITS.receiptBytes, acknowledgementCap: LIMITS.acknowledgementBytes, reserveBytes: LIMITS.reserveBytes,
        totalBytes: Number(requiredBytes) },
      nativeLinux: { path: STORAGE_ROOT, type: String(storage.statfs.type), device: storage.identity.dev,
        blockSize: String(storage.statfs.bsize), availableBlocks: String(storage.statfs.bavail), availableBytes: String(nativeAvailable), identity: storage.identity },
      windowsHost: { path: WINDOWS_ROOT, type: String(windows.statfs.type), device: windows.identity.dev,
        blockSize: String(windows.statfs.bsize), availableBlocks: String(windows.statfs.bavail), availableBytes: String(windowsAvailable), identity: windows.identity },
      descriptors: { softLimit: limits.soft, hardLimit: limits.hard, openAtCheck: open, ...descriptorBudget,
        available: limits.soft - open },
      monotonic: { clock: "performance.now", operationLimitMs: LIMITS.operationMs,
        remainingMsAtCheck: Math.max(0, Math.floor(deadline - performance.now())) } };
  } finally { held.close(); }
}
function rootPublisher(deadline, signal, fault = "NONE") {
  const handles = [], directories = [], files = []; let closed = false;
  const checkAll = () => { check(signal, deadline); for (const entry of directories) { const named = fs.lstatSync(entry.path, { bigint: true });
    need(named.isDirectory() && !named.isSymbolicLink() && fs.realpathSync(entry.path) === entry.path
      && isDeepStrictEqual(directoryNative(named), entry.identity)
      && (closed || isDeepStrictEqual(directoryNative(fs.fstatSync(entry.fd, { bigint: true })), entry.identity)), "storage_invalid"); } };
  const hold = file => { const before = fs.lstatSync(file, { bigint: true }); need(before.isDirectory() && !before.isSymbolicLink()
    && fs.realpathSync(file) === file, "storage_invalid"); const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    handles.push({ fd, file }); const identity = directoryNative(before); need(isDeepStrictEqual(identity, directoryNative(fs.fstatSync(fd, { bigint: true })))
      && fs.statfsSync(`/proc/self/fd/${fd}`, { bigint: true }).type === 0xef53n, "storage_invalid");
    const entry = { path: file, fd, identity }; directories.push(entry); return entry; };
  try { for (const file of ["/", "/opt", "/opt/auto-world", STORAGE_ROOT]) { const entry = hold(file);
    need(entry.identity.uid === 0 && entry.identity.gid === 0 && (entry.identity.mode & 0o6022) === 0, "storage_invalid"); }
  need(directories.at(-1).identity.mode === 0o700, "storage_invalid"); }
  catch (error) { let uncertain = false; for (const item of handles.splice(0).reverse()) try { fs.closeSync(item.fd); } catch { uncertain = true; }
    if (uncertain) fail("cleanup_uncertain"); throw error; }
  const mkdir = file => { checkAll(); fs.mkdirSync(file, { mode: 0o700 }); const entry = hold(file);
    need(entry.identity.uid === 0 && entry.identity.gid === 0 && entry.identity.mode === 0o700, "storage_invalid");
    const parent = directories.find(item => item.path === path.dirname(file)); need(parent, "storage_invalid"); fs.fsyncSync(parent.fd); fs.fsyncSync(entry.fd); return entry; };
  const guard = item => { const opened = fs.fstatSync(item.fd, { bigint: true }), named = fs.lstatSync(item.file, { bigint: true }), identity = native(opened);
    need(opened.isFile() && named.isFile() && !named.isSymbolicLink() && fs.realpathSync(item.file) === item.file
      && identity.uid === 0 && identity.gid === 0 && identity.mode === 0o600 && identity.nlink === 1 && identity.size === item.size
      && isDeepStrictEqual(identity, native(named)) && (!item.identity || isDeepStrictEqual(identity, item.identity)), "file_changed"); return identity; };
  const seal = item => { checkAll(); guard(item); const digest = createHash("sha256"), buffer = Buffer.alloc(Math.min(1024 ** 2, Math.max(1, item.size))); let at = 0;
    while (at < item.size) { checkAll(); const count = fs.readSync(item.fd, buffer, 0, Math.min(buffer.length, item.size - at), at);
      need(count > 0, "file_changed"); digest.update(buffer.subarray(0, count)); at += count; }
    need(fs.readSync(item.fd, Buffer.alloc(1), 0, 1, at) === 0 && digest.digest("hex") === item.sha256, "file_changed"); guard(item); };
  const publish = (file, bytes, role) => { checkAll(); const fd = fs.openSync(file,
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); handles.push({ fd, file });
    const item = { file, fd, role, size: bytes.length, sha256: sha(bytes) }; files.push(item); let at = 0;
    while (at < bytes.length) { checkAll(); const count = fs.writeSync(fd, bytes, at, bytes.length - at, at); need(count > 0, "publication_failed"); at += count; }
    if (fault === "RECEIPT_FSYNC" && role === "RECEIPT") fail("publication_failed"); fs.fsyncSync(fd);
    if (fault === "RECEIPT_READBACK" && role === "RECEIPT" && bytes.length > 0) fs.writeSync(fd, Buffer.from([bytes[0] ^ 0xff]), 0, 1, 0);
    item.identity = native(fs.fstatSync(fd, { bigint: true })); seal(item); const parent = directories.find(entry => entry.path === path.dirname(file));
    need(parent, "storage_invalid"); fs.fsyncSync(parent.fd); checkAll(); return item; };
  const close = () => { if (closed) return; closed = true; let uncertain = false;
    for (const item of handles.splice(0).reverse()) try { fs.closeSync(item.fd); if (fault === "RECEIPT_CLOSE" && item.file.endsWith("/receipt.json")) uncertain = true; } catch { uncertain = true; }
    need(!uncertain, "cleanup_uncertain"); };
  const closedGuards = () => { check(signal, deadline); for (const entry of directories) need(isDeepStrictEqual(directoryNative(fs.lstatSync(entry.path, { bigint: true })), entry.identity), "file_changed");
    for (const item of files) need(isDeepStrictEqual(native(fs.lstatSync(item.file, { bigint: true })), item.identity), "file_changed"); };
  const retire = item => { const parent = directories.find(entry => entry.path === path.dirname(item.file)); need(parent, "cleanup_uncertain");
    const named = fs.lstatSync(item.file, { bigint: true }), identity = native(named);
    need(named.isFile() && !named.isSymbolicLink() && fs.realpathSync(item.file) === item.file
      && STABLE.every(key => identity[key] === item.identity[key]), "cleanup_uncertain"); fs.unlinkSync(item.file);
    const fd = fs.openSync(parent.path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); let uncertain = false;
    try { need(isDeepStrictEqual(directoryNative(fs.fstatSync(fd, { bigint: true })), parent.identity), "cleanup_uncertain"); fs.fsyncSync(fd); }
    finally { try { fs.closeSync(fd); } catch { uncertain = true; } } need(!uncertain, "cleanup_uncertain"); };
  return { mkdir, publish, close, closedGuards, retire, directories, files };
}
function proof(item, parentIdentity) {
  return { path: item.file, size: item.size, sha256: item.sha256, nativeIdentity: item.identity, parentIdentity };
}
function transferGuards(result, expectedGeneration, references, originals) {
  need(result?.kind === "POSTGRES_EVIDENCE_GENERATION_TRANSFER_V1" && result.state === "TRANSFERRED_SOURCE_CLOSED"
    && result.targetGeneration === expectedGeneration && result.sourceClosed === true && result.descriptorsClosed === true
    && result.targetReferences.length === references.length && result.inventory.references.count === references.length
    && result.inventory.objects.count === new Set(references.map(item => item.sha256)).size, "transfer_failed");
  const objectIds = result.objects.map(item => identityKey(item.identity));
  need(new Set(objectIds).size === objectIds.length && objectIds.every(item => !originals.has(item)), "transfer_failed"); return new Set(objectIds);
}
function options(value) {
  const item = record(value, ["fixtureReferences", "hooks", "fault"]), references = array(item.fixtureReferences, postgresCompletePrivateCopyPolicyLimits.references);
  const hooks = record(item.hooks, Object.keys(item.hooks)); need(Object.keys(hooks).every(key => ["afterCopy", "forceIdentityReservation"].includes(key)
    && typeof hooks[key] === "function"), "arguments_invalid");
  need(["NONE", "CAPACITY_NATIVE", "CAPACITY_WINDOWS", "DESCRIPTORS", "SECOND_TRANSFER", "RECEIPT_FSYNC", "RECEIPT_READBACK",
    "RECEIPT_CLOSE", "FOREIGN_RECEIPT"].includes(item.fault), "arguments_invalid"); return { references, hooks, fault: item.fault };
}
async function bounded(callback, value, signal, deadline) {
  if (!callback) return;
  const ms = Math.min(LIMITS.outputMs, Math.max(1, deadline - performance.now())), expires = performance.now() + ms;
  await new Promise((resolve, reject) => { let done = false; const finish = success => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
    if (success && !signal.aborted && performance.now() < expires && performance.now() < deadline) resolve(); else reject(new Error(PREFIX + "output_failed")); };
  const abort = () => finish(false), timer = setTimeout(() => finish(false), ms); signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted || performance.now() >= deadline) finish(false); else Promise.resolve().then(() => callback(value)).then(() => finish(true), () => finish(false)); });
}
function input(value) {
  const result = record(value, INPUT_KEYS), match = typeof result.executionId === "string" ? EXECUTION.exec(result.executionId) : null;
  need(match && typeof result.recipeRevision === "string" && REVISION.test(result.recipeRevision)
    && typeof result.launchPlanSha256 === "string" && SHA256.test(result.launchPlanSha256)
    && result.launchControlReservedBytes === postgresCompletePrivateCopyLaunchControlReservedBytes
    && (result.signal === undefined || result.signal instanceof globalThis.AbortSignal), "arguments_invalid");
  return { ...result, nonce: match[1] };
}
async function operate(inputRaw, controlsRaw, dependencies, fixtureOptions) {
  let capacityWriter, proofWriter, receipt, result, inputSignal, abortListener, cleanupUncertain = false;
  const controller = new globalThis.AbortController(), deadline = performance.now() + LIMITS.operationMs;
  try {
    record(dependencies, []); const request = input(inputRaw), controls = record(controlsRaw, Object.hasOwn(controlsRaw ?? {}, "result") ? ["result"] : []);
    need(controls.result === undefined || typeof controls.result === "function", "arguments_invalid");
    inputSignal = request.signal; abortListener = () => controller.abort(); inputSignal?.addEventListener("abort", abortListener, { once: true });
    if (inputSignal?.aborted) fail("aborted"); const testOnly = fixtureOptions !== null, test = testOnly ? options(fixtureOptions) : null;
    let policy, policySha256, references;
    try { policy = testOnly ? TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy(request.policy)
      : validateLoadedPostgresCompletePrivateCopyPolicy(request.policy);
    } catch { fail("policy_invalid"); }
    need(process.platform === "linux" && process.version === "v22.23.2" && process.getuid?.() === 0 && process.geteuid?.() === 0
      && process.getgid?.() === 0 && process.getegid?.() === 0, "requires_native_root");
    const status = fs.readFileSync("/proc/self/status", "utf8");
    for (const field of ["Uid", "Gid"]) need(new RegExp(`^${field}:[ \\t]+0[ \\t]+0[ \\t]+0[ \\t]+0$`, "mu").test(status), "requires_native_root");
    if (testOnly) references = test.references;
    else { policySha256 = getPostgresCompletePrivateCopyPolicySha256(policy); references = getPostgresCompletePrivateCopyReferences(policy); }
    need(references.length > 0, "inventory_invalid");
    const policyProof = policyProjection(policy, policySha256 ?? null, references, testOnly), policyBytes = encode(policy).length;
    need(policyBytes > 0 && policyBytes <= LIMITS.policyBytes, "policy_invalid"); const catalog = inventory(policy, policyProof, references, testOnly);
    const signal = controller.signal, capacityValue = inspectCapacity(request, references, policyBytes, catalog.bytes.length,
      catalog.value.totals.uniqueObjectBytes, test?.fault ?? "NONE", deadline, signal);
    const prefix = testOnly ? "test-pg-complete" : "pg-complete", capacityPath = `${STORAGE_ROOT}/${prefix}-capacity-${request.nonce}.json`;
    const copyDirectory = `${STORAGE_ROOT}/${prefix}-copy-${request.nonce}`, retrieveDirectory = `${STORAGE_ROOT}/${prefix}-retrieve-${request.nonce}`;
    const proofDirectory = `${STORAGE_ROOT}/${prefix}-proof-${request.nonce}`;
    need([capacityPath, copyDirectory, retrieveDirectory, proofDirectory].every(file => !fs.existsSync(file)), "storage_invalid");
    const capacityBytes = encode(capacityValue); need(capacityBytes.length <= LIMITS.receiptBytes, "capacity_invalid");
    capacityWriter = rootPublisher(deadline, signal); const capacityFile = capacityWriter.publish(capacityPath, capacityBytes, "CAPACITY");
    capacityWriter.close(); capacityWriter.closedGuards(); const capacityParent = capacityWriter.directories.find(item => item.path === STORAGE_ROOT);
    need(capacityParent, "storage_invalid");
    const capacityProof = { ...proof(capacityFile, capacityParent.identity), value: capacityValue, descriptorsClosed: true };
    const copyHooks = test?.hooks.forceIdentityReservation ? { forceIdentityReservation: test.hooks.forceIdentityReservation } : {};
    const copyCapability = testOnly ? TEST_ONLY_copyEvidenceGeneration({ authority: policy, executionId: request.executionId, deadline, signal },
      { references, hooks: copyHooks, forbiddenIdentities: [] })
      : copyEvidenceGeneration({ authority: policy, executionId: request.executionId, deadline, signal });
    const copy = copyCapability.copy;
    const originalIdentities = new Set(references.flatMap(item => [identityKey(item.nativeIdentity), identityKey(item.parentIdentity)]));
    const copyIds = transferGuards(copy, "COPY", references, originalIdentities); const hookResult = test?.hooks.afterCopy?.(copy);
    need(!(hookResult instanceof Promise), "arguments_invalid"); check(signal, deadline);
    let retrieve;
    try { const pair = testOnly ? TEST_ONLY_retrieveEvidenceGeneration({ copy: copyCapability, deadline, signal },
      { hooks: test.fault === "SECOND_TRANSFER" ? { afterTargetCreated() { throw new Error("TEST_ONLY_SECOND_TRANSFER"); } } : {} })
      : retrieveEvidenceGeneration({ copy: copyCapability, deadline, signal }); retrieve = pair.generations.retrieve; } catch { fail("transfer_failed"); }
    const retrieveIds = transferGuards(retrieve, "RETRIEVE", copy.targetReferences, new Set([...originalIdentities, ...copyIds]));
    need([...retrieveIds].every(item => !copyIds.has(item)), "transfer_failed");
    let originalUnchanged = true;
    if (!testOnly) for (const reference of references) { const named = fs.lstatSync(reference.path, { bigint: true });
      if (!isDeepStrictEqual(native(named), reference.nativeIdentity)) originalUnchanged = false; }
    need(testOnly || originalUnchanged, "file_changed");
    proofWriter = rootPublisher(deadline, signal, test?.fault ?? "NONE"); const proofRoot = proofWriter.mkdir(proofDirectory);
    const inventoryFile = proofWriter.publish(path.join(proofDirectory, "inventory.json"), catalog.bytes, "INVENTORY");
    const basePreservation = { originalsClosedBeforeRetrieve: copy.sourceClosed === true, originalUnchanged: testOnly ? "TEST_ONLY_NOT_AUTHORITY" : originalUnchanged,
      pairwiseDisjoint: true, descriptorsClosed: copy.descriptorsClosed === true && retrieve.descriptorsClosed === true,
      receipt: null };
    const base = { kind: testOnly ? "TEST_ONLY_POSTGRES_COMPLETE_PRIVATE_COPY_RECEIPT_V1" : "POSTGRES_COMPLETE_PRIVATE_COPY_RECEIPT_V1",
      state: "PUBLISHED_AWAITING_COPY_RETRIEVAL_ACK",
      execution: { executionId: request.executionId, recipeRevision: request.recipeRevision, launchPlanSha256: request.launchPlanSha256 },
      policy: policyProof, capacity: capacityProof,
      generations: { copy, retrieve, inventory: proof(inventoryFile, proofRoot.identity), proofDirectory: proofRoot.identity },
      preservation: basePreservation,
      claims: { authority: "PRIVATE_CHILD_PROVISIONAL_ONLY", closure: "NOT_ESTABLISHED", secondCompletePrivateCopy: "AWAITING_ROOT_ACK",
        processEOF: "NOT_OBSERVED", processExit: "NOT_OBSERVED", admission: "NOT_AUTHORIZED", currentness: "NOT_EVALUATED",
        runtimePermission: "NOT_GRANTED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
        selectedFixtureOnly: testOnly } };
    const receiptBytes = encode(base); need(receiptBytes.length <= LIMITS.receiptBytes, "inventory_invalid");
    receipt = proofWriter.publish(path.join(proofDirectory, "receipt.json"), receiptBytes, "RECEIPT"); proofWriter.close(); proofWriter.closedGuards();
    const receiptProof = proof(receipt, proofRoot.identity);
    result = freeze({ ...base, preservation: { ...basePreservation, receipt: receiptProof } });
    need(encode(result).length <= LIMITS.receiptBytes && isDeepStrictEqual(fs.readdirSync(proofDirectory).sort(), ["inventory.json", "receipt.json"]), "inventory_invalid");
    if (test?.fault === "FOREIGN_RECEIPT") { fs.renameSync(receipt.file, `${receipt.file}.owned`); fs.writeFileSync(receipt.file, "foreign receipt", { flag: "wx", mode: 0o600 }); fail("output_failed"); }
    await bounded(controls.result, result, signal, deadline); proofWriter.closedGuards(); check(signal, deadline); return result;
  } catch (error) {
    let failure = failures.has(error) ? error : (() => { try { fail(error?.message === PREFIX + "output_failed" ? "output_failed" : "operation_failed"); } catch (value) { return value; } })();
    if (receipt && proofWriter) try { proofWriter.retire(receipt); } catch { cleanupUncertain = true; }
    try { proofWriter?.close(); } catch { cleanupUncertain = true; }
    try { capacityWriter?.close(); } catch { cleanupUncertain = true; }
    if (cleanupUncertain || failures.get(error) === "cleanup_uncertain") try { fail("cleanup_uncertain"); } catch (value) { failure = value; }
    throw failure;
  } finally { inputSignal?.removeEventListener("abort", abortListener); controller.abort(); }
}

export async function runPostgresCompletePrivateCopy(inputValue, controls = {}, dependencies = {}) {
  return await operate(inputValue, controls, dependencies, null);
}
export async function TEST_ONLY_runPostgresCompletePrivateCopy(inputValue, controls = {}, fixtureOptions) {
  return await operate(inputValue, controls, {}, fixtureOptions);
}
export function postgresCompletePrivateCopyFailureDiagnostic(error) {
  const reason = failures.get(error) ?? "operation_failed";
  return Object.freeze({ code: PREFIX + (FAILURE_REASONS.has(reason) ? reason : "operation_failed"),
    cleanup: reason === "cleanup_uncertain" ? "UNVERIFIED" : "CONFIRMED" });
}
export const postgresCompletePrivateCopyContract = freeze({ storageRoot: STORAGE_ROOT, windowsRoot: WINDOWS_ROOT,
  subject: postgresCompletePrivateCopyPolicyContract.subject, launchControlReservedBytes: postgresCompletePrivateCopyLaunchControlReservedBytes,
  limits: LIMITS });
