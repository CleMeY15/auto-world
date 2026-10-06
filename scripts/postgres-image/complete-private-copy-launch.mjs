import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { posix as path } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { TextDecoder, isDeepStrictEqual } from "node:util";
import { getPostgresCompletePrivateCopyPolicySha256, TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy,
  validateLoadedPostgresCompletePrivateCopyPolicy } from
  "./complete-private-copy-policy.mjs";

const PREFIX = "postgres_complete_private_copy_launch_";
const PLAN_KIND = "POSTGRES_COMPLETE_PRIVATE_COPY_LAUNCH_PLAN_V1";
const PLAN_CAP_KIND = "LOADED_POSTGRES_COMPLETE_PRIVATE_COPY_LAUNCH_PLAN_V1";
const CONTROL_KIND = "POSTGRES_LAUNCH_CONTROL_POLICY_V1";
const CONTROL_CAP_KIND = "LOADED_POSTGRES_LAUNCH_CONTROL_POLICY_V1";
const CHILD_KIND = "POSTGRES_COMPLETE_PRIVATE_COPY_CHILD_DESCRIPTOR_V1";
const NODE = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
const NODE_SIZE = 124836408;
const NODE_SHA256 = "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327";
const STAGE_PARENT = "/opt/auto-world/approved-passive-launchers";
const PRIVATE_ROOT = "/opt/auto-world/private-archives";
const ENVIRONMENT = Object.freeze({ PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" });
const PLAN_KEYS = ["kind", "executionId", "recipeRevision", "policySha256", "reservationBytes", "stagePath", "references",
  "lateSelectors", "callerReferenceId", "runtimeReferenceId", "outputLimits"];
const REFERENCE_KEYS = ["referenceId", "groupId", "role", "path", "size", "sha256", "sha512", "gitBlobSha1", "ownerProfile",
  "nativeIdentity", "parentIdentity"];
const SELECTOR_KEYS = ["referenceId", "groupId", "role", "path", "ownerProfile"];
const IDENTITY_KEYS = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const PARENT_KEYS = ["dev", "ino", "uid", "gid", "mode"];
const PROOF_KEYS = ["path", "size", "sha256", "nativeIdentity", "parentIdentity"];
const DESCRIPTOR_KEYS = ["kind", "state", "executionId", "launchPlanSha256", "receipt", "inventory", "capacity", "claims"];
const CLAIM_KEYS = ["authority", "closure", "secondCompletePrivateCopy", "processEOF", "processExit", "admission", "currentness",
  "runtimePermission", "supportStartedAt", "supportEndsAt", "archiveUntil", "selectedFixtureOnly"];
const CONTROL_KEYS = ["kind", "executionId", "launchPlanSha256", "policySha256", "references"];
const LIMIT_KEYS = ["stdoutBytes", "stderrBytes", "operationMs", "cleanupMs"];
const SHA256 = /^[a-f0-9]{64}$/u;
const SHA512 = /^[a-f0-9]{128}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const EXECUTION = /^pg-complete-([a-f0-9]{24})$/u;
const REVISION = /^[a-f0-9]{40}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:+@-]{0,191}$/u;
const ROLE = /^[A-Z][A-Z0-9_]{0,191}$/u;
const MAX_JSON = 16 * 1024 * 1024;
const LAUNCH_CONTROL_RESERVED_BYTES = 256 * 1024 * 1024;
const FIXED_LIMITS = Object.freeze({ stdoutBytes: 64 * 1024, stderrBytes: 64 * 1024, operationMs: 15 * 60_000, cleanupMs: 10_000 });
const PROFILES = new Map([
  ["ROOT_PRIVATE", [[0, 0, 0o600], [0, 0, 0o700]]],
  ["ROOT_PROTECTED", [[0, 0, 0o400], [0, 0, 0o700]]],
  ["ROOT_PROTECTED_RECIPE", [[0, 0, 0o400], [0, 0, 0o700]]],
  ["ROOT_EXECUTABLE", [[0, 0, 0o755], [0, 0, 0o755]]],
]);
const loadedPlans = new WeakSet();
const testPlans = new WeakSet();
const closedChildren = new WeakSet();
const testChildren = new WeakSet();
const childPlans = new WeakMap();
const loadedControls = new WeakSet();
const testControls = new WeakSet();
const testLateReferences = new WeakMap();

const fail = reason => { throw new Error(PREFIX + reason); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const plain = value => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const freeze = value => value && typeof value === "object" ? Object.freeze(Array.isArray(value) ? value.map(freeze)
  : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)]))) : value;
function record(value, keys) {
  if (!plain(value)) fail("invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some(key => typeof key !== "string" || !keys.includes(key))) fail("invalid");
  return Object.fromEntries(keys.map(key => {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("invalid");
    return [key, descriptor.value];
  }));
}
function array(value, maximum = 4096) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail("invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1 || descriptors.length?.value !== value.length) fail("invalid");
  return Array.from({ length: value.length }, (_unused, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("invalid");
    return descriptor.value;
  });
}
function absolute(value) {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/") || value === "/" || path.normalize(value) !== value
    || /[\0\r\n\\]/u.test(value)) fail("invalid");
  return value;
}
function identity(value, keys, fileSize) {
  const result = record(value, keys);
  if (![result.dev, result.ino, ...(keys === IDENTITY_KEYS ? [result.mtimeNs, result.ctimeNs] : [])]
    .every(item => typeof item === "string" && /^(?:0|[1-9][0-9]{0,29})$/u.test(item))
    || ![result.uid, result.gid, result.mode].every(Number.isSafeInteger)) fail("invalid");
  if (keys === IDENTITY_KEYS && (!Number.isSafeInteger(result.nlink) || result.nlink !== 1 || result.size !== fileSize)) fail("invalid");
  return result;
}
function reference(value) {
  const result = record(value, REFERENCE_KEYS);
  if (!TOKEN.test(result.referenceId) || !TOKEN.test(result.groupId) || !ROLE.test(result.role)) fail("invalid");
  result.path = absolute(result.path);
  if (!Number.isSafeInteger(result.size) || result.size < 0 || result.size > MAX_JSON * 1024 || !SHA256.test(result.sha256)
    || result.sha512 !== null && !SHA512.test(result.sha512) || result.gitBlobSha1 !== null && !SHA1.test(result.gitBlobSha1)) fail("invalid");
  const profile = PROFILES.get(result.ownerProfile);
  if (!profile) fail("invalid");
  result.nativeIdentity = identity(result.nativeIdentity, IDENTITY_KEYS, result.size);
  result.parentIdentity = identity(result.parentIdentity, PARENT_KEYS);
  if (!isDeepStrictEqual([result.nativeIdentity.uid, result.nativeIdentity.gid, result.nativeIdentity.mode], profile[0])
    || !isDeepStrictEqual([result.parentIdentity.uid, result.parentIdentity.gid, result.parentIdentity.mode], profile[1])) fail("invalid");
  return result;
}
function selector(value) {
  const result = record(value, SELECTOR_KEYS);
  if (!TOKEN.test(result.referenceId) || !TOKEN.test(result.groupId) || !ROLE.test(result.role) || !PROFILES.has(result.ownerProfile)) fail("invalid");
  result.path = absolute(result.path);
  return result;
}
function canonical(bytes, maximum = MAX_JSON) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 3 || bytes.length > maximum || bytes.at(-1) !== 10) fail("invalid");
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  if (!isDeepStrictEqual(bytes, Buffer.from(`${JSON.stringify(value)}\n`))) fail("invalid");
  return value;
}
function native(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid), mode: Number(stat.mode & 0o7777n),
    nlink: Number(stat.nlink), size: Number(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
}
function parentNative(stat) { const value = native(stat); return Object.fromEntries(PARENT_KEYS.map(key => [key, value[key]])); }
function nativeContext() {
  if (process.platform !== "linux" || process.version !== "v22.23.2" || process.execPath !== NODE
    || [process.getuid?.(), process.geteuid?.(), process.getgid?.(), process.getegid?.()].some(value => value !== 0)) fail("native_required");
}
function closeLedger(entries, close = (fd) => fs.closeSync(fd)) {
  let uncertain = false;
  for (const entry of entries) try { close(entry.fd, entry.label); } catch { uncertain = true; }
  return uncertain;
}
function heldRead(file, maximum, expectedProfile, operations = {}) {
  const parent = path.dirname(file), parentStat = fs.lstatSync(parent, { bigint: true }), named = fs.lstatSync(file, { bigint: true });
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !named.isFile() || named.isSymbolicLink() || named.nlink !== 1n
    || fs.realpathSync(file) !== file || fs.realpathSync(parent) !== parent) fail("native_invalid");
  const profile = PROFILES.get(expectedProfile);
  if (!profile || !isDeepStrictEqual([Number(named.uid), Number(named.gid), Number(named.mode & 0o7777n)], profile[0])
    || !isDeepStrictEqual([Number(parentStat.uid), Number(parentStat.gid), Number(parentStat.mode & 0o7777n)], profile[1])
    || named.size > BigInt(maximum)) fail("native_invalid");
  const anchors = []; let current = parent; let fd;
  try {
    for (;;) {
      const stat = fs.lstatSync(current, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0n || stat.gid !== 0n || (stat.mode & 0o022n) !== 0n
        || fs.realpathSync(current) !== current) fail("native_invalid");
      anchors.push({ path: current, identity: parentNative(stat), fd: fs.openSync(current,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW) });
      if (current === "/") break; current = path.dirname(current);
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = native(named), held = native(fs.fstatSync(fd, { bigint: true }));
    if (!isDeepStrictEqual(before, held) || anchors.some(item => !isDeepStrictEqual(item.identity,
      parentNative(fs.fstatSync(item.fd, { bigint: true }))) || !isDeepStrictEqual(item.identity,
      parentNative(fs.lstatSync(item.path, { bigint: true }))))) fail("native_invalid");
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (count < 1) fail("native_invalid"); offset += count; }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0 || !isDeepStrictEqual(before, native(fs.fstatSync(fd, { bigint: true })))) fail("native_invalid");
    return { bytes, size: bytes.length, sha256: digest(bytes), nativeIdentity: before, parentIdentity: parentNative(parentStat) };
  } finally {
    const entries = [...(fd === undefined ? [] : [{ fd, label: "file" }]),
      ...anchors.reverse().map((item, index) => ({ fd: item.fd, label: `anchor-${index}` }))];
    if (closeLedger(entries, operations.close)) fail("cleanup_uncertain");
  }
}
function validateReferenceSet(references) {
  let priorId = ""; const ids = new Set(), objects = new Map(), paths = new Map();
  for (const item of references) {
    if (item.referenceId <= priorId || ids.has(item.referenceId)) fail("invalid");
    priorId = item.referenceId; ids.add(item.referenceId);
    const prior = objects.get(item.sha256);
    if (prior && (prior.size !== item.size || prior.sha512 !== null && item.sha512 !== null && prior.sha512 !== item.sha512
      || prior.gitBlobSha1 !== null && item.gitBlobSha1 !== null && prior.gitBlobSha1 !== item.gitBlobSha1)) fail("invalid");
    objects.set(item.sha256, prior ?? item);
    const priorPath = paths.get(item.path);
    if (priorPath && !isDeepStrictEqual(priorPath, item)) fail("invalid");
    paths.set(item.path, item);
  }
}
function snapshotPlan(value, policy, production, rawSha256, ownProof) {
  const plan = record(value, PLAN_KEYS), match = typeof plan.executionId === "string" ? EXECUTION.exec(plan.executionId) : null;
  if (plan.kind !== PLAN_KIND || !match || !REVISION.test(plan.recipeRevision) || !SHA256.test(plan.policySha256)
    || production && plan.policySha256 !== getPostgresCompletePrivateCopyPolicySha256(policy)
    || plan.reservationBytes !== LAUNCH_CONTROL_RESERVED_BYTES
    || plan.stagePath !== `${STAGE_PARENT}/pg-complete-launch-${match[1]}`) fail("invalid");
  plan.references = array(plan.references).map(reference); validateReferenceSet(plan.references);
  if (plan.references.some(item => item.path !== NODE && !item.path.startsWith(`${plan.stagePath}/`))) fail("invalid");
  plan.lateSelectors = array(plan.lateSelectors, 3).map(selector);
  if (!isDeepStrictEqual(plan.lateSelectors.map(item => path.basename(item.path)), ["invoker.py", "supervisor.mjs", "supervisor.test.mjs"])
    || plan.lateSelectors.some(item => path.dirname(item.path) !== plan.stagePath) || new Set(plan.lateSelectors.map(item => item.referenceId)).size !== 3) fail("invalid");
  const reservedIds = new Set(["actor-stderr", "actor-stdout", "capacity", "inventory", "launch-plan", "provisional-receipt",
    ...plan.lateSelectors.map(item => item.referenceId)]);
  if (plan.references.some(item => reservedIds.has(item.referenceId))) fail("invalid");
  const caller = plan.references.find(item => item.referenceId === plan.callerReferenceId);
  const runtime = plan.references.find(item => item.referenceId === plan.runtimeReferenceId);
  if (!caller || caller.path !== `${plan.stagePath}/caller.mjs` || !runtime || runtime.path !== NODE || runtime.size !== NODE_SIZE
    || runtime.sha256 !== NODE_SHA256 || runtime.ownerProfile !== "ROOT_EXECUTABLE") fail("invalid");
  plan.outputLimits = record(plan.outputLimits, LIMIT_KEYS);
  if (!isDeepStrictEqual(plan.outputLimits, FIXED_LIMITS)) fail("invalid");
  const own = { referenceId: "launch-plan", groupId: "P5_LAUNCH_CONTROL", role: "LAUNCH_PLAN", path: `${plan.stagePath}/launch-plan.json`,
    size: ownProof.size, sha256: rawSha256, sha512: null, gitBlobSha1: null, ownerProfile: "ROOT_PROTECTED",
    nativeIdentity: ownProof.nativeIdentity, parentIdentity: ownProof.parentIdentity };
  const result = freeze({ kind: PLAN_CAP_KIND, authority: production ? "HASH_LOADED_NATIVE_PRODUCTION" : "TEST_ONLY_HASH_LOADED",
    executionId: plan.executionId, nonce: match[1], recipeRevision: plan.recipeRevision, policySha256: plan.policySha256,
    launchPlanSha256: rawSha256, stagePath: plan.stagePath, references: plan.references, lateSelectors: plan.lateSelectors,
    callerReferenceId: plan.callerReferenceId, runtimeReferenceId: plan.runtimeReferenceId, outputLimits: plan.outputLimits, ownReference: own });
  (production ? loadedPlans : testPlans).add(result); return result;
}
function validatePlan(value, production = true) {
  const set = production ? loadedPlans : testPlans;
  if (!value || !set.has(value) || !Object.isFrozen(value) || value.kind !== PLAN_CAP_KIND) fail("capability_invalid");
  return value;
}

export function loadPostgresCompletePrivateCopyLaunchPlan(bytes, externallyReviewedSha256, authenticLoadedCompletePolicy) {
  try {
    validateLoadedPostgresCompletePrivateCopyPolicy(authenticLoadedCompletePolicy);
    if (!SHA256.test(externallyReviewedSha256) || digest(bytes) !== externallyReviewedSha256) fail("invalid");
    nativeContext(); const value = canonical(bytes), match = EXECUTION.exec(value.executionId);
    if (!match) fail("invalid");
    const proof = heldRead(`${STAGE_PARENT}/pg-complete-launch-${match[1]}/launch-plan.json`, MAX_JSON, "ROOT_PROTECTED");
    if (!isDeepStrictEqual(proof.bytes, bytes)) fail("native_invalid");
    const plan = snapshotPlan(value, authenticLoadedCompletePolicy, true, externallyReviewedSha256, proof);
    for (const item of plan.references) {
      const observed = heldRead(item.path, Math.max(MAX_JSON, item.size), item.ownerProfile);
      if (!isDeepStrictEqual({ size: observed.size, sha256: observed.sha256, nativeIdentity: observed.nativeIdentity,
        parentIdentity: observed.parentIdentity }, { size: item.size, sha256: item.sha256, nativeIdentity: item.nativeIdentity,
        parentIdentity: item.parentIdentity })) fail("native_invalid");
    }
    return plan;
  } catch { fail("invalid"); }
}
export function validateLoadedPostgresCompletePrivateCopyLaunchPlan(value) { return validatePlan(value, true); }

function proof(value, fixedPath) {
  const result = record(value, PROOF_KEYS);
  if (result.path !== fixedPath || !Number.isSafeInteger(result.size) || result.size < 1 || result.size > MAX_JSON || !SHA256.test(result.sha256)) fail("child_invalid");
  result.nativeIdentity = identity(result.nativeIdentity, IDENTITY_KEYS, result.size);
  result.parentIdentity = identity(result.parentIdentity, PARENT_KEYS);
  if (!isDeepStrictEqual([result.nativeIdentity.uid, result.nativeIdentity.gid, result.nativeIdentity.mode], [0, 0, 0o600])
    || !isDeepStrictEqual([result.parentIdentity.uid, result.parentIdentity.gid, result.parentIdentity.mode], [0, 0, 0o700])) fail("child_invalid");
  return result;
}
function referenceFromProof(referenceId, role, item) {
  return { referenceId, groupId: "P5_DYNAMIC_CONTROL", role, path: item.path, size: item.size, sha256: item.sha256,
    sha512: null, gitBlobSha1: null, ownerProfile: "ROOT_PRIVATE", nativeIdentity: item.nativeIdentity, parentIdentity: item.parentIdentity };
}
function resolvedLateReferences(plan, production) {
  if (!production) {
    const values = testLateReferences.get(plan);
    if (!values) fail("capability_invalid");
    return values;
  }
  return plan.lateSelectors.map(item => {
    const observed = heldRead(item.path, MAX_JSON, item.ownerProfile);
    return reference({ ...item, size: observed.size, sha256: observed.sha256, sha512: null, gitBlobSha1: null,
      nativeIdentity: observed.nativeIdentity, parentIdentity: observed.parentIdentity });
  });
}
function resealReferences(values, production) {
  if (!production) return values;
  return values.map(item => {
    const observed = heldRead(item.path, Math.max(MAX_JSON, item.size), item.ownerProfile);
    if (!isDeepStrictEqual({ size: observed.size, sha256: observed.sha256, nativeIdentity: observed.nativeIdentity,
      parentIdentity: observed.parentIdentity }, { size: item.size, sha256: item.sha256, nativeIdentity: item.nativeIdentity,
      parentIdentity: item.parentIdentity })) fail("native_invalid");
    return item;
  });
}
function validateReceipt(bytes, plan, descriptor, receiptProof) {
  if (digest(bytes) !== receiptProof.sha256 || bytes.length !== receiptProof.size) fail("child_invalid");
  const receipt = canonical(bytes);
  const top = record(receipt, ["kind", "state", "execution", "policy", "capacity", "generations", "preservation", "claims"]);
  if (top.kind !== "POSTGRES_COMPLETE_PRIVATE_COPY_RECEIPT_V1" || top.state !== "PUBLISHED_AWAITING_COPY_RETRIEVAL_ACK"
    || !plain(top.execution) || top.execution.executionId !== plan.executionId || top.execution.recipeRevision !== plan.recipeRevision
    || top.execution.launchPlanSha256 !== plan.launchPlanSha256 || top.policy?.sha256 !== plan.policySha256
    || top.preservation?.receipt !== null || !isDeepStrictEqual(top.claims, descriptor.claims)) fail("child_invalid");
}
function descriptor(bytes, plan, testOnly, readProof) {
  const value = record(canonical(bytes, FIXED_LIMITS.stdoutBytes), DESCRIPTOR_KEYS);
  if (value.kind !== CHILD_KIND || value.state !== "PUBLISHED_AWAITING_COPY_RETRIEVAL_ACK" || value.executionId !== plan.executionId
    || value.launchPlanSha256 !== plan.launchPlanSha256) fail("child_invalid");
  const root = `${PRIVATE_ROOT}/${testOnly ? "test-pg-complete" : "pg-complete"}`;
  const proofRoot = `${root}-proof-${plan.nonce}`;
  value.receipt = proof(value.receipt, `${proofRoot}/receipt.json`);
  value.inventory = proof(value.inventory, `${proofRoot}/inventory.json`);
  value.capacity = proof(value.capacity, `${root}-capacity-${plan.nonce}.json`);
  value.claims = record(value.claims, CLAIM_KEYS);
  if (value.claims.authority !== "PRIVATE_CHILD_PROVISIONAL_ONLY" || value.claims.closure !== "NOT_ESTABLISHED"
    || value.claims.secondCompletePrivateCopy !== "AWAITING_ROOT_ACK" || value.claims.processEOF !== "NOT_OBSERVED"
    || value.claims.processExit !== "NOT_OBSERVED" || value.claims.admission !== "NOT_AUTHORIZED"
    || value.claims.currentness !== "NOT_EVALUATED" || value.claims.runtimePermission !== "NOT_GRANTED"
    || value.claims.supportStartedAt !== null || value.claims.supportEndsAt !== null || value.claims.archiveUntil !== null
    || value.claims.selectedFixtureOnly !== testOnly) fail("child_invalid");
  for (const item of [value.receipt, value.inventory, value.capacity]) {
    const observed = readProof(item.path, MAX_JSON, "ROOT_PRIVATE");
    if (!isDeepStrictEqual({ size: observed.size, sha256: observed.sha256, nativeIdentity: observed.nativeIdentity,
      parentIdentity: observed.parentIdentity }, { size: item.size, sha256: item.sha256, nativeIdentity: item.nativeIdentity,
      parentIdentity: item.parentIdentity })) fail("child_invalid");
    if (item === value.receipt) validateReceipt(observed.bytes, plan, value, item);
  }
  return value;
}
async function supervise(plan, signal, hooks, testOnly) {
  const outputPath = `${plan.stagePath}/actor.stdout.jsonl`, errorPath = `${plan.stagePath}/actor.stderr.txt`;
  const processResult = await hooks.process({ node: NODE, caller: `${plan.stagePath}/caller.mjs`, cwd: "/", env: ENVIRONMENT,
    outputPath, errorPath, limits: FIXED_LIMITS, signal });
  const result = record(processResult, ["status", "signal", "closed", "stdoutEnded", "stderrEnded"]);
  if (result.status !== 0 || result.signal !== null || result.closed !== true || result.stdoutEnded !== true || result.stderrEnded !== true) fail("process_invalid");
  const stdout = hooks.read(outputPath, FIXED_LIMITS.stdoutBytes, "ROOT_PRIVATE");
  const stderr = hooks.read(errorPath, FIXED_LIMITS.stderrBytes, "ROOT_PRIVATE");
  if (stderr.size !== 0 || stderr.bytes.length !== 0) fail("process_invalid");
  const observed = descriptor(stdout.bytes, plan, testOnly, hooks.read);
  const dynamic = [referenceFromProof("actor-stderr", "RAW_ACTOR_STDERR", { ...stderr, path: errorPath }),
    referenceFromProof("actor-stdout", "RAW_ACTOR_STDOUT", { ...stdout, path: outputPath }),
    referenceFromProof("capacity", "CAPACITY", observed.capacity), referenceFromProof("inventory", "INVENTORY", observed.inventory),
    referenceFromProof("provisional-receipt", "PROVISIONAL_RECEIPT", observed.receipt)].sort((a, b) => a.referenceId.localeCompare(b.referenceId));
  const cap = freeze({ kind: "CLOSED_POSTGRES_COMPLETE_PRIVATE_COPY_CHILD_V1", authority: testOnly ? "TEST_ONLY_CLOSED_PROCESS" : "NATIVE_CLOSED_PROCESS",
    executionId: plan.executionId, launchPlanSha256: plan.launchPlanSha256, claims: observed.claims, references: dynamic });
  (testOnly ? testChildren : closedChildren).add(cap); childPlans.set(cap, plan); return cap;
}
function defaultProcess(spec) {
  return new Promise((resolve, reject) => {
    let outFd, errFd, child, settled = false, timedOut = false, overflow = false, cleanupTimer;
    let stdoutEnded = false, stderrEnded = false, closed = false, status, childSignal, outputBytes = 0, errorBytes = 0, failure;
    let timer; let abort;
    const cleanupOperations = spec.TEST_ONLY_cleanupOperations ?? {};
    const closeLogs = (sync = true) => {
      const entries = [[outFd, "stdout"], [errFd, "stderr"]].filter(([fd]) => fd !== undefined);
      let uncertain = false;
      if (sync) for (const [fd, label] of entries) try {
        (cleanupOperations.fsync ?? ((value) => fs.fsyncSync(value)))(fd, label);
      } catch { uncertain = true; }
      if (closeLedger(entries.map(([fd, label]) => ({ fd, label })), cleanupOperations.close)) uncertain = true;
      return !uncertain;
    };
    const finish = () => {
      if (settled || !closed || !stdoutEnded || !stderrEnded) return;
      settled = true; clearTimeout(timer); if (cleanupTimer) clearTimeout(cleanupTimer);
      spec.signal?.removeEventListener("abort", abort);
      const logsClosed = closeLogs();
      if (!logsClosed || failure || timedOut || overflow) {
        reject(new Error(PREFIX + (!logsClosed ? "cleanup_uncertain" : timedOut ? "timeout" : "process_invalid"))); return;
      }
      resolve({ status, signal: childSignal, closed: true, stdoutEnded: true, stderrEnded: true });
    };
    const stop = reason => {
      if (reason === "timeout") timedOut = true; else overflow = true;
      if (!closed || !stdoutEnded || !stderrEnded) try { process.kill(-child.pid, "SIGKILL"); } catch { failure = "cleanup_uncertain"; }
      cleanupTimer ??= setTimeout(() => {
        if (settled) return; settled = true; child.unref(); closeLogs();
        reject(new Error(PREFIX + "cleanup_uncertain"));
      }, spec.limits.cleanupMs);
    };
    const tee = (fd, stderr) => chunk => {
      if (!Buffer.isBuffer(chunk)) { failure = "process_invalid"; stop("overflow"); return; }
      const prior = stderr ? errorBytes : outputBytes, cap = stderr ? spec.limits.stderrBytes : spec.limits.stdoutBytes;
      const next = prior + chunk.length;
      if (stderr) errorBytes = next; else outputBytes = next;
      const accepted = Math.max(0, Math.min(chunk.length, cap - prior));
      try { let offset = 0; while (offset < accepted) { const count = fs.writeSync(fd, chunk, offset, accepted - offset); if (count < 1) throw new Error(); offset += count; } }
      catch { failure = "process_invalid"; stop("overflow"); return; }
      if (next > cap) stop("overflow");
    };
    try {
      outFd = fs.openSync(spec.outputPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      errFd = fs.openSync(spec.errorPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      child = (spec.TEST_ONLY_spawn ?? spawn)(spec.node, [spec.caller], { cwd: spec.cwd, env: spec.env,
        stdio: ["ignore", "pipe", "pipe"], detached: true, windowsHide: true });
    } catch {
      reject(new Error(PREFIX + (closeLogs(false) ? "process_invalid" : "cleanup_uncertain"))); return;
    }
    timer = setTimeout(() => stop("timeout"), spec.limits.operationMs);
    abort = () => stop("timeout"); spec.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => { failure = "process_invalid"; });
    child.stdout.on("data", tee(outFd, false)); child.stderr.on("data", tee(errFd, true));
    child.stdout.once("end", () => { stdoutEnded = true; finish(); });
    child.stderr.once("end", () => { stderrEnded = true; finish(); });
    child.stdout.once("error", () => { failure = "process_invalid"; stop("overflow"); });
    child.stderr.once("error", () => { failure = "process_invalid"; stop("overflow"); });
    child.once("close", (value, signalValue) => { closed = true; status = value; childSignal = signalValue; finish(); });
    if (spec.signal?.aborted) abort();
  });
}
export async function TEST_ONLY_runPostgresCompletePrivateCopyDefaultProcess(value) {
  const keys = ["caller", "outputPath", "errorPath", "operationMs", "cleanupMs",
    ...(Object.hasOwn(value ?? {}, "fault") ? ["fault"] : []),
    ...(Object.hasOwn(value ?? {}, "signal") ? ["signal"] : [])];
  const input = record(value, keys); nativeContext();
  const parentPath = path.dirname(input.caller);
  if (!/^\/var\/tmp\/aw-pg-launch-process-[A-Za-z0-9._-]+$/u.test(parentPath)
    || input.outputPath !== `${parentPath}/actor.stdout.jsonl` || input.errorPath !== `${parentPath}/actor.stderr.txt`
    || !Number.isSafeInteger(input.operationMs) || input.operationMs < 25 || input.operationMs > FIXED_LIMITS.operationMs
    || !Number.isSafeInteger(input.cleanupMs) || input.cleanupMs < 25 || input.cleanupMs > FIXED_LIMITS.cleanupMs
    || ![undefined, "FSYNC_FIRST", "CLOSE_FIRST", "SPAWN_CLOSE_FIRST"].includes(input.fault)
    || input.signal !== undefined && !(input.signal instanceof globalThis.AbortSignal)) fail("invalid");
  const parentStat = fs.lstatSync(parentPath, { bigint: true }), callerStat = fs.lstatSync(input.caller, { bigint: true });
  if (!parentStat.isDirectory() || parentStat.uid !== 0n || parentStat.gid !== 0n || (parentStat.mode & 0o7777n) !== 0o700n
    || !callerStat.isFile() || callerStat.isSymbolicLink() || callerStat.uid !== 0n || callerStat.gid !== 0n
    || callerStat.nlink !== 1n || (callerStat.mode & 0o7777n) !== 0o400n) fail("invalid");
  const attempts = []; let firstClose = true; let firstFsync = true;
  const cleanupOperations = {
    fsync(fd, label) { attempts.push(`fsync:${label}`); if (input.fault === "FSYNC_FIRST" && firstFsync) { firstFsync = false; throw new Error("TEST_ONLY"); }
      firstFsync = false; fs.fsyncSync(fd); },
    close(fd, label) { attempts.push(`close:${label}`); fs.closeSync(fd);
      if (["CLOSE_FIRST", "SPAWN_CLOSE_FIRST"].includes(input.fault) && firstClose) { firstClose = false; throw new Error("TEST_ONLY"); } firstClose = false; },
  };
  try {
    return await defaultProcess({ node: NODE, caller: input.caller, cwd: "/", env: ENVIRONMENT,
      outputPath: input.outputPath, errorPath: input.errorPath,
      limits: { stdoutBytes: FIXED_LIMITS.stdoutBytes, stderrBytes: FIXED_LIMITS.stderrBytes,
        operationMs: input.operationMs, cleanupMs: input.cleanupMs }, signal: input.signal, TEST_ONLY_cleanupOperations: cleanupOperations,
      ...(input.fault === "SPAWN_CLOSE_FIRST" ? { TEST_ONLY_spawn() { throw new Error("TEST_ONLY"); } } : {}) });
  } catch (error) {
    Object.defineProperty(error, "TEST_ONLY_cleanupAttempts", { value: Object.freeze([...attempts]), enumerable: false }); throw error;
  }
}
export function TEST_ONLY_readPostgresCompletePrivateCopyLaunchFile(value) {
  const input = record(value, ["path", "fault"]); nativeContext();
  if (!new RegExp(`^${PRIVATE_ROOT}/test-pg-launch-held-[A-Za-z0-9._-]+/object\\.bin$`, "u").test(input.path)
    || !["FILE_CLOSE", "ANCHOR_CLOSE"].includes(input.fault)) fail("invalid");
  const attempts = []; let selected = false;
  try {
    return heldRead(input.path, MAX_JSON, "ROOT_PRIVATE", { close(fd, label) {
      attempts.push(label); fs.closeSync(fd);
      if (!selected && (input.fault === "FILE_CLOSE" && label === "file" || input.fault === "ANCHOR_CLOSE" && label.startsWith("anchor-"))) {
        selected = true; throw new Error("TEST_ONLY");
      }
    } });
  } catch (error) {
    Object.defineProperty(error, "TEST_ONLY_cleanupAttempts", { value: Object.freeze([...attempts]), enumerable: false }); throw error;
  }
}
export async function runPostgresCompletePrivateCopyChild(loadedPlan, options = {}, dependencies = {}) {
  record(dependencies, []); const input = record(options, Object.hasOwn(options ?? {}, "signal") ? ["signal"] : []);
  const signal = input.signal; const plan = validatePlan(loadedPlan, true); nativeContext();
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal)) fail("invalid");
  return await supervise(plan, signal, { process: defaultProcess, read: heldRead }, false);
}

function validateChild(value, production) {
  if (!value || !(production ? closedChildren : testChildren).has(value) || !Object.isFrozen(value)) fail("capability_invalid");
  return value;
}
export function getPostgresLaunchControlSpecification(planValue, childValue) {
  const production = loadedPlans.has(planValue), plan = validatePlan(planValue, production), child = validateChild(childValue, production);
  if (childPlans.get(child) !== plan || plan.executionId !== child.executionId || plan.launchPlanSha256 !== child.launchPlanSha256) fail("capability_invalid");
  const references = resealReferences([...plan.references, plan.ownReference, ...resolvedLateReferences(plan, production), ...child.references], production)
    .sort((a, b) => a.referenceId.localeCompare(b.referenceId));
  validateReferenceSet(references);
  return freeze({ kind: CONTROL_KIND, executionId: plan.executionId, launchPlanSha256: plan.launchPlanSha256,
    policySha256: plan.policySha256, references });
}
function loadControl(bytes, expectedSha256, plan, child, production) {
  if (!SHA256.test(expectedSha256) || digest(bytes) !== expectedSha256) fail("invalid");
  const raw = record(canonical(bytes), CONTROL_KEYS), specification = getPostgresLaunchControlSpecification(plan, child);
  if (raw.kind !== CONTROL_KIND || raw.executionId !== specification.executionId || raw.launchPlanSha256 !== specification.launchPlanSha256
    || raw.policySha256 !== specification.policySha256) fail("invalid");
  raw.references = array(raw.references).map(reference); validateReferenceSet(raw.references);
  const expected = new Map(specification.references.map(item => [item.referenceId, item]));
  if (raw.references.length !== expected.size) fail("invalid");
  for (const item of raw.references) {
    if (!expected.has(item.referenceId) || !isDeepStrictEqual(item, expected.get(item.referenceId))) fail("invalid");
  }
  const cap = freeze({ kind: CONTROL_CAP_KIND, authority: production ? "HASH_LOADED_PRODUCTION" : "TEST_ONLY_HASH_LOADED",
    policySha256: expectedSha256, executionId: raw.executionId, launchPlanSha256: raw.launchPlanSha256, references: raw.references });
  (production ? loadedControls : testControls).add(cap); return cap;
}
export function loadPostgresLaunchControlPolicy(bytes, expectedSha256, loadedPlan, closedChild) {
  return loadControl(bytes, expectedSha256, validatePlan(loadedPlan, true), validateChild(closedChild, true), true);
}
export function validateLoadedPostgresLaunchControlPolicy(value) {
  if (!value || !loadedControls.has(value) || !Object.isFrozen(value) || value.kind !== CONTROL_CAP_KIND) fail("capability_invalid");
  return value;
}
export function getPostgresLaunchControlReferences(value) { return validateLoadedPostgresLaunchControlPolicy(value).references; }
export function getPostgresLaunchControlPolicySha256(value) { return validateLoadedPostgresLaunchControlPolicy(value).policySha256; }
export function getPostgresLaunchControlExecutionId(value) { return validateLoadedPostgresLaunchControlPolicy(value).executionId; }
export function getPostgresLaunchControlLaunchPlanSha256(value) { return validateLoadedPostgresLaunchControlPolicy(value).launchPlanSha256; }

export function TEST_ONLY_loadPostgresCompletePrivateCopyLaunchPlan(bytes, expectedSha256, completePolicy, fixture) {
  if (!SHA256.test(expectedSha256) || digest(bytes) !== expectedSha256) fail("invalid");
  TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy(completePolicy);
  const options = record(fixture, ["ownProof", "lateReferences"]);
  const plan = snapshotPlan(canonical(bytes), completePolicy, false, expectedSha256, record(options.ownProof, PROOF_KEYS));
  const late = array(options.lateReferences, 3).map(reference);
  if (!isDeepStrictEqual(late.map(item => Object.fromEntries(SELECTOR_KEYS.map(key => [key, item[key]]))), plan.lateSelectors)) fail("invalid");
  testLateReferences.set(plan, freeze(late)); return plan;
}
export async function TEST_ONLY_runPostgresCompletePrivateCopyChild(plan, options, fixture) {
  const hooks = record(fixture, ["process", "read"]);
  if (typeof hooks.process !== "function" || typeof hooks.read !== "function") fail("invalid");
  const input = record(options ?? {}, Object.hasOwn(options ?? {}, "signal") ? ["signal"] : []);
  if (input.signal !== undefined && !(input.signal instanceof globalThis.AbortSignal)) fail("invalid");
  return await supervise(validatePlan(plan, false), input.signal, hooks, true);
}
export function TEST_ONLY_loadPostgresLaunchControlPolicy(bytes, expectedSha256, plan, child) {
  return loadControl(bytes, expectedSha256, validatePlan(plan, false), validateChild(child, false), false);
}
export function TEST_ONLY_validatePostgresLaunchControlPolicy(value) {
  if (!value || !testControls.has(value) || !Object.isFrozen(value)) fail("capability_invalid"); return value;
}
export const postgresCompletePrivateCopyLaunchContract = freeze({ planKind: PLAN_KIND, controlKind: CONTROL_KIND, childKind: CHILD_KIND,
  node: NODE, nodeSize: NODE_SIZE, nodeSha256: NODE_SHA256, stageParent: STAGE_PARENT, privateRoot: PRIVATE_ROOT,
  reservationBytes: LAUNCH_CONTROL_RESERVED_BYTES, outputLimits: FIXED_LIMITS, environment: ENVIRONMENT });
