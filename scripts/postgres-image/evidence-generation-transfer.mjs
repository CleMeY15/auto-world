import fs from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { posix as path } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createSourceRetentionNativeSession } from "./source-retention-native-session.mjs";
import { getPostgresCompletePrivateCopyPolicySha256, getPostgresCompletePrivateCopyReferences,
  TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy, validateLoadedPostgresCompletePrivateCopyPolicy } from
  "./complete-private-copy-policy.mjs";
import { getPostgresLaunchControlExecutionId, getPostgresLaunchControlLaunchPlanSha256,
  getPostgresLaunchControlPolicySha256, getPostgresLaunchControlReferences,
  validateLoadedPostgresLaunchControlPolicy } from "./complete-private-copy-launch.mjs";

const PREFIX = "postgres_evidence_generation_transfer_";
const STORAGE_ROOT = "/opt/auto-world/private-archives";
const INPUT_KEYS = ["references", "directory", "deadline", "signal", "sourceGeneration", "forbiddenIdentities"];
const REFERENCE_KEYS = ["referenceId", "groupId", "role", "path", "size", "sha256", "sha512", "gitBlobSha1",
  "ownerProfile", "nativeIdentity", "parentIdentity"];
const NATIVE_KEYS = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const PARENT_KEYS = ["dev", "ino", "uid", "gid", "mode"];
const PROFILES = new Map([
  ["ROOT_PRIVATE", { file: [0, 0, 0o600], parent: [0, 0, 0o700] }],
  ["ACTOR_PRIVATE", { file: [1000, 1000, 0o600], parent: [1000, 1000, 0o700] }],
  ["IMAGE_PRIVATE", { file: [1000, 989, 0o600], parent: [1000, 989, 0o700] }],
  ["ROOT_SHARED_PARENT", { file: [0, 0, 0o600], parent: [1000, 1000, 0o750] }],
  ["ROOT_PROTECTED", { file: [0, 0, 0o400], parent: [0, 0, 0o700] }],
  ["ROOT_PROTECTED_RECIPE", { file: [0, 0, 0o400], parent: [0, 0, 0o700] }],
  ["ROOT_ACTOR_PROTECTED_RECIPE", { file: [0, 1000, 0o440], parent: [0, 1000, 0o750] }],
  ["ROOT_TRAVERSABLE_CODE_PARENT", { file: [0, 0, 0o600], parent: [0, 1000, 0o750] }],
  ["ACTOR_EXECUTABLE_PRIVATE", { file: [1000, 1000, 0o700], parent: [1000, 1000, 0o700] }],
  ["ROOT_EXECUTABLE", { file: [0, 0, 0o755], parent: [0, 0, 0o755] }],
]);
const GENERATIONS = Object.freeze({ ORIGINAL: "COPY", COPY: "RETRIEVE" });
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const IDENTITY = /^(?:0|[1-9][0-9]{0,29}):(?:0|[1-9][0-9]{0,29})$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:+@-]{0,191}$/u;
const ROLE = /^[A-Z][A-Z0-9_]{0,191}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA512 = /^[0-9a-f]{128}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const LIMITS = Object.freeze({ references: 2048, fileBytes: 1024 ** 3, referenceBytes: 12 * 1024 ** 3,
  operationMs: 15 * 60 * 1000, chunkBytes: 1024 ** 2 });
const failures = new WeakMap();
const productionCopies = new WeakMap();
const testCopies = new WeakMap();

const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const encode = value => Buffer.from(`${JSON.stringify(value)}\n`);
const identityKey = value => `${value.dev}:${value.ino}`;
const native = value => ({ dev: String(value.dev), ino: String(value.ino), uid: Number(value.uid), gid: Number(value.gid),
  mode: Number(value.mode & 0o7777n), nlink: Number(value.nlink), size: Number(value.size),
  mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) });
const directoryNative = value => Object.fromEntries(PARENT_KEYS.map(key => [key, native(value)[key]]));
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
function absolute(value) { return typeof value === "string" && value !== "/" && Buffer.byteLength(value) <= 4096 && path.isAbsolute(value)
  && path.normalize(value) === value && !value.includes("//") && !/[\0\r\n\\]/u.test(value); }
function identity(value, keys, reason) {
  const result = record(value, keys, reason);
  need([result.dev, result.ino].every(item => typeof item === "string" && DECIMAL.test(item))
    && [result.uid, result.gid, result.mode].every(item => Number.isSafeInteger(item) && item >= 0 && item <= 0o777777), reason);
  return result;
}
function nativeIdentity(value, size) {
  const result = identity(value, NATIVE_KEYS, "reference_invalid");
  need([result.mtimeNs, result.ctimeNs].every(item => typeof item === "string" && DECIMAL.test(item))
    && Number.isSafeInteger(result.nlink) && result.nlink === 1 && Number.isSafeInteger(result.size) && result.size === size, "reference_invalid");
  return result;
}
function reference(value) {
  const result = record(value, REFERENCE_KEYS, "reference_invalid");
  need(typeof result.referenceId === "string" && TOKEN.test(result.referenceId) && typeof result.groupId === "string" && TOKEN.test(result.groupId)
    && typeof result.role === "string" && ROLE.test(result.role) && absolute(result.path)
    && Number.isSafeInteger(result.size) && result.size >= 0 && result.size <= LIMITS.fileBytes
    && typeof result.sha256 === "string" && SHA256.test(result.sha256)
    && (result.sha512 === null || typeof result.sha512 === "string" && SHA512.test(result.sha512))
    && (result.gitBlobSha1 === null || typeof result.gitBlobSha1 === "string" && SHA1.test(result.gitBlobSha1)), "reference_invalid");
  const profile = PROFILES.get(result.ownerProfile); need(profile, "reference_invalid");
  result.nativeIdentity = nativeIdentity(result.nativeIdentity, result.size);
  result.parentIdentity = identity(result.parentIdentity, PARENT_KEYS, "reference_invalid");
  const legacyCoreParent = result.groupId === "CORE" && result.ownerProfile === "ROOT_PRIVATE"
    && ((result.referenceId === "historical-cold-receipt" && result.role === "ROOT_COLD_LOAD_RECEIPT")
      || (result.referenceId === "historical-sql-receipt" && result.role === "ROOT_SQL_RESTORE_RECEIPT"))
    && isDeepStrictEqual([result.parentIdentity.uid, result.parentIdentity.gid, result.parentIdentity.mode], [0, 1000, 0o710]);
  need(isDeepStrictEqual([result.nativeIdentity.uid, result.nativeIdentity.gid, result.nativeIdentity.mode], profile.file)
    && (isDeepStrictEqual([result.parentIdentity.uid, result.parentIdentity.gid, result.parentIdentity.mode], profile.parent) || legacyCoreParent), "reference_invalid");
  return result;
}
function expectation(inputRaw, testOnly) {
  const input = record(inputRaw, INPUT_KEYS);
  const now = performance.now();
  need(Number.isFinite(input.deadline) && input.deadline > now && input.deadline <= now + LIMITS.operationMs
    && input.signal instanceof globalThis.AbortSignal && !input.signal.aborted
    && Object.hasOwn(GENERATIONS, input.sourceGeneration), "arguments_invalid");
  const targetGeneration = GENERATIONS[input.sourceGeneration], prefix = testOnly ? "test-pg-complete" : "pg-complete";
  need(new RegExp(`^${STORAGE_ROOT}/${prefix}-${targetGeneration.toLowerCase()}-[0-9a-f]{24}$`, "u").test(input.directory), "arguments_invalid");
  const forbiddenIdentities = array(input.forbiddenIdentities, LIMITS.references * 6 + 16);
  need(forbiddenIdentities.every(item => typeof item === "string" && IDENTITY.test(item))
    && forbiddenIdentities.every((item, index) => index === 0 || forbiddenIdentities[index - 1] < item), "arguments_invalid");
  const references = array(input.references, LIMITS.references, "reference_invalid").map(reference);
  need(references.length > 0 && new Set(references.map(item => item.referenceId)).size === references.length, "reference_invalid");
  let referenceBytes = 0; const paths = new Map(), objects = new Map();
  for (const item of references) {
    referenceBytes += item.size; need(Number.isSafeInteger(referenceBytes) && referenceBytes <= LIMITS.referenceBytes, "reference_invalid");
    const priorPath = paths.get(item.path);
    need(!priorPath || priorPath.size === item.size && priorPath.sha256 === item.sha256
      && isDeepStrictEqual(priorPath.nativeIdentity, item.nativeIdentity) && isDeepStrictEqual(priorPath.parentIdentity, item.parentIdentity), "reference_invalid");
    paths.set(item.path, item);
    const prior = objects.get(item.sha256);
    if (prior) {
      need(prior.size === item.size
        && !(prior.sha512 !== null && item.sha512 !== null && prior.sha512 !== item.sha512)
        && !(prior.gitBlobSha1 !== null && item.gitBlobSha1 !== null && prior.gitBlobSha1 !== item.gitBlobSha1), "digest_contradiction");
      prior.sha512 ??= item.sha512; prior.gitBlobSha1 ??= item.gitBlobSha1; prior.referenceIds.push(item.referenceId);
    } else objects.set(item.sha256, { sha256: item.sha256, size: item.size, sha512: item.sha512,
      gitBlobSha1: item.gitBlobSha1, referenceIds: [item.referenceId], sourcePath: item.path });
  }
  const forbidden = new Set(forbiddenIdentities);
  need(references.every(item => !forbidden.has(identityKey(item.nativeIdentity))), "foreign_identity");
  return { ...input, references, forbiddenIdentities, forbidden, objects: [...objects.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    targetGeneration, referenceBytes };
}
function digestFile(session, item, expected) {
  session.fileGuard(item); const sha256 = createHash("sha256"), sha512 = expected.sha512 === null ? null : createHash("sha512");
  const git = expected.gitBlobSha1 === null ? null : createHash("sha1").update(`blob ${expected.size}\0`);
  const buffer = Buffer.alloc(Math.min(LIMITS.chunkBytes, Math.max(1, expected.size))); let at = 0;
  while (at < expected.size) { session.check(); const count = fs.readSync(item.fd, buffer, 0, Math.min(buffer.length, expected.size - at), at);
    need(count > 0, "file_changed"); const part = buffer.subarray(0, count); sha256.update(part); sha512?.update(part); git?.update(part); at += count; }
  need(fs.readSync(item.fd, Buffer.alloc(1), 0, 1, at) === 0 && sha256.digest("hex") === expected.sha256
    && (!sha512 || sha512.digest("hex") === expected.sha512) && (!git || git.digest("hex") === expected.gitBlobSha1), "file_changed");
  session.fileGuard(item);
}
function rootWriter(session, deadline, signal, forbidden, reservationLimit, testHooks = {}) {
  const handles = [], directories = [], files = [], reservations = []; let closed = false;
  const check = () => { session.guards(); need(!signal.aborted && performance.now() < deadline, signal.aborted ? "aborted" : "deadline_exceeded"); };
  const guards = () => { session.guards(false); for (const entry of directories) { const named = fs.lstatSync(entry.path, { bigint: true });
    need(named.isDirectory() && !named.isSymbolicLink() && fs.realpathSync(entry.path) === entry.path
      && isDeepStrictEqual(directoryNative(named), entry.identity)
      && (closed || isDeepStrictEqual(directoryNative(fs.fstatSync(entry.fd, { bigint: true })), entry.identity)), "cleanup_uncertain"); } };
  const hold = file => { const before = fs.lstatSync(file, { bigint: true });
    need(before.isDirectory() && !before.isSymbolicLink() && fs.realpathSync(file) === file, "storage_invalid");
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW); handles.push(fd);
    const identity = directoryNative(before); need(isDeepStrictEqual(identity, directoryNative(fs.fstatSync(fd, { bigint: true })))
      && fs.statfsSync(`/proc/self/fd/${fd}`, { bigint: true }).type === 0xef53n, "storage_invalid");
    const entry = { path: file, fd, identity }; directories.push(entry); return entry; };
  const prepare = () => { for (const file of ["/", "/opt", "/opt/auto-world", STORAGE_ROOT]) { const entry = hold(file);
    need(entry.identity.uid === 0 && entry.identity.gid === 0 && (entry.identity.mode & 0o6022) === 0, "storage_invalid");
    if (file === STORAGE_ROOT) need(entry.identity.mode === 0o700, "storage_invalid"); } guards(); };
  const mkdir = file => { check(); guards(); fs.mkdirSync(file, { mode: 0o700 }); const entry = hold(file);
    need(entry.identity.uid === 0 && entry.identity.gid === 0 && entry.identity.mode === 0o700 && !forbidden.has(identityKey(entry.identity)), "foreign_identity");
    const parent = directories.find(item => item.path === path.dirname(file)); need(parent, "storage_invalid"); fs.fsyncSync(parent.fd); fs.fsyncSync(entry.fd); guards(); return entry; };
  const fileGuard = item => { guards(); const opened = fs.fstatSync(item.fd, { bigint: true }), named = fs.lstatSync(item.file, { bigint: true });
    const identity = native(opened); need(opened.isFile() && named.isFile() && !named.isSymbolicLink() && fs.realpathSync(item.file) === item.file
      && identity.uid === 0 && identity.gid === 0 && identity.mode === 0o600 && identity.nlink === 1 && identity.size === item.size
      && isDeepStrictEqual(identity, native(named)) && (!item.identity || isDeepStrictEqual(identity, item.identity)), "file_changed"); return identity; };
  const seal = item => { check(); fileGuard(item); const sha256 = createHash("sha256"), sha512 = item.sha512 === null ? null : createHash("sha512");
    const git = item.gitBlobSha1 === null ? null : createHash("sha1").update(`blob ${item.size}\0`);
    const buffer = Buffer.alloc(Math.min(LIMITS.chunkBytes, Math.max(1, item.size))); let at = 0;
    while (at < item.size) { check(); const count = fs.readSync(item.fd, buffer, 0, Math.min(buffer.length, item.size - at), at);
      need(count > 0, "file_changed"); const part = buffer.subarray(0, count); sha256.update(part); sha512?.update(part); git?.update(part); at += count; }
    need(fs.readSync(item.fd, Buffer.alloc(1), 0, 1, at) === 0 && sha256.digest("hex") === item.sha256
      && (!sha512 || sha512.digest("hex") === item.sha512) && (!git || git.digest("hex") === item.gitBlobSha1), "file_changed"); fileGuard(item); };
  const publish = (file, object, source, sourceSession, reservationDirectory) => { check(); guards(); let fd, item;
    for (let attempt = 0; attempt <= forbidden.size; attempt++) {
      fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); handles.push(fd);
      const own = native(fs.fstatSync(fd, { bigint: true }));
      const forcedReservation = testHooks.forceIdentityReservation?.(freeze({ candidate: file, identity: own })) === true;
      if (!forbidden.has(identityKey(own)) && !forcedReservation) { item = { file, fd, size: object.size, sha256: object.sha256, sha512: object.sha512,
        gitBlobSha1: object.gitBlobSha1, own }; break; }
      need(reservations.length < reservationLimit, "foreign_identity");
      const reservation = { file: path.join(reservationDirectory.path, `reserved-${String(reservations.length).padStart(6, "0")}-${own.dev}-${own.ino}`),
        fd, size: 0, sha256: sha("sha256", Buffer.alloc(0)), sha512: null, gitBlobSha1: null, own };
      const stable = ["dev", "ino", "uid", "gid", "mode", "size", "mtimeNs"], objectDirectory = directories.find(entry => entry.path === path.dirname(file));
      need(own.uid === 0 && own.gid === 0 && own.mode === 0o600 && own.nlink === 1 && own.size === 0
        && isDeepStrictEqual(own, native(fs.lstatSync(file, { bigint: true }))), "file_changed");
      testHooks.beforeIdentityReservation?.(freeze({ candidate: file, reservation: reservation.file, identity: own }));
      fs.linkSync(file, reservation.file); const linked = native(fs.fstatSync(fd, { bigint: true })), candidate = native(fs.lstatSync(file, { bigint: true }));
      const reserved = native(fs.lstatSync(reservation.file, { bigint: true }));
      need(stable.every(key => linked[key] === own[key]) && linked.nlink === 2 && isDeepStrictEqual(linked, candidate)
        && isDeepStrictEqual(linked, reserved), "file_changed");
      fs.fsyncSync(fd); fs.fsyncSync(objectDirectory.fd); fs.fsyncSync(reservationDirectory.fd);
      need(isDeepStrictEqual(native(fs.lstatSync(file, { bigint: true })), linked), "file_changed"); fs.unlinkSync(file);
      const unlinked = native(fs.fstatSync(fd, { bigint: true })), named = native(fs.lstatSync(reservation.file, { bigint: true }));
      need(stable.every(key => unlinked[key] === own[key]) && unlinked.nlink === 1 && isDeepStrictEqual(unlinked, named), "file_changed");
      fs.fsyncSync(fd); fs.fsyncSync(objectDirectory.fd); fs.fsyncSync(reservationDirectory.fd); reservation.identity = unlinked;
      seal(reservation); files.push(reservation); reservations.push(reservation); guards();
    }
    need(item, "foreign_identity"); files.push(item);
    need(item.own.uid === 0 && item.own.gid === 0 && item.own.mode === 0o600 && item.own.nlink === 1, "publication_failed");
    sourceSession.fileGuard(source); const buffer = Buffer.alloc(Math.min(LIMITS.chunkBytes, Math.max(1, object.size))); let at = 0;
    while (at < object.size) { check(); const count = fs.readSync(source.fd, buffer, 0, Math.min(buffer.length, object.size - at), at);
      need(count > 0, "file_changed"); let wrote = 0; while (wrote < count) { check(); const amount = fs.writeSync(fd, buffer, wrote, count - wrote, at + wrote);
        need(amount > 0, "publication_failed"); wrote += amount; } at += count; }
    need(fs.readSync(source.fd, Buffer.alloc(1), 0, 1, at) === 0, "file_changed"); sourceSession.fileGuard(source);
    fs.fsyncSync(fd); item.identity = native(fs.fstatSync(fd, { bigint: true }));
    need(!forbidden.has(identityKey(item.identity)), "foreign_identity"); forbidden.add(identityKey(item.identity)); seal(item);
    const parent = directories.find(entry => entry.path === path.dirname(file)); need(parent, "storage_invalid"); fs.fsyncSync(parent.fd); guards(); return item; };
  const close = () => { if (closed) return; closed = true; let uncertain = false;
    for (const fd of handles.splice(0).reverse()) try { fs.closeSync(fd); } catch { uncertain = true; }
    need(!uncertain, "cleanup_uncertain"); };
  return { prepare, mkdir, publish, seal, guards, close, directories, files, reservations };
}
function hooks(options) {
  if (options === undefined) return {};
  const value = record(options, ["hooks"]), entries = record(value.hooks, Object.keys(value.hooks));
  need(Object.keys(entries).every(key => ["afterSourcesSealed", "afterTargetCreated", "afterObjectPublished", "beforeSourceClose",
    "afterSourceClose", "beforeTargetClose", "beforeIdentityReservation", "forceIdentityReservation"].includes(key)
    && typeof entries[key] === "function"), "arguments_invalid"); return entries;
}
function run(inputRaw, options, testOnly) {
  let session, writer, sourceClosed = false, targetClosed = false, failure;
  try {
    const input = expectation(inputRaw, testOnly), testHooks = testOnly ? hooks(options) : (need(options === undefined, "arguments_invalid"), {});
    need(process.platform === "linux" && process.version === "v22.23.2" && process.getuid?.() === 0 && process.geteuid?.() === 0
      && process.getgid?.() === 0 && process.getegid?.() === 0, "requires_native_root");
    const status = fs.readFileSync("/proc/self/status", "utf8");
    for (const field of ["Uid", "Gid"]) need(new RegExp(`^${field}:[ \\t]+0[ \\t]+0[ \\t]+0[ \\t]+0$`, "mu").test(status), "requires_native_root");
    session = createSourceRetentionNativeSession(input.deadline, input.signal, fail, { clock: "MONOTONIC" });
    const opened = new Map(), parents = new Set();
    for (const ref of input.references) {
      const profile = PROFILES.get(ref.ownerProfile), item = opened.get(ref.path) ?? session.open(ref.path, ref, ...profile.file);
      const parent = path.dirname(ref.path); if (!parents.has(parent)) { session.directory(parent, ref.parentIdentity); parents.add(parent); }
      need(isDeepStrictEqual(item.identity, ref.nativeIdentity) && isDeepStrictEqual(directoryNative(fs.lstatSync(parent, { bigint: true })), ref.parentIdentity)
        && fs.statfsSync(`/proc/self/fd/${item.fd}`, { bigint: true }).type === 0xef53n, "reference_invalid"); opened.set(ref.path, item);
      digestFile(session, item, ref);
    }
    testHooks.afterSourcesSealed?.();
    writer = rootWriter(session, input.deadline, input.signal, new Set([...input.forbidden, ...input.references.map(ref => identityKey(ref.nativeIdentity))]),
      input.references.length * 3 + 13, testHooks);
    writer.prepare(); session.directory(STORAGE_ROOT, directoryNative(fs.lstatSync(STORAGE_ROOT, { bigint: true })));
    const storageRootIdentity = writer.directories.find(entry => entry.path === STORAGE_ROOT).identity;
    const generationDirectory = writer.mkdir(input.directory), objectsDirectory = writer.mkdir(path.join(input.directory, "objects"));
    const reservationDirectory = writer.mkdir(path.join(input.directory, "identity-reservations"));
    testHooks.afterTargetCreated?.(freeze({ directory: input.directory, objectsDirectory: path.join(input.directory, "objects") }));
    const published = new Map();
    for (const object of input.objects) {
      const item = writer.publish(path.join(input.directory, "objects", `${object.sha256}.blob`), object, opened.get(object.sourcePath), session, reservationDirectory);
      published.set(object.sha256, item); testHooks.afterObjectPublished?.(freeze({ sha256: object.sha256, path: item.file }));
    }
    for (const ref of input.references) digestFile(session, opened.get(ref.path), ref);
    for (const item of writer.files) writer.seal(item);
    need(isDeepStrictEqual(fs.readdirSync(input.directory).sort(), ["identity-reservations", "objects"])
      && isDeepStrictEqual(fs.readdirSync(path.join(input.directory, "objects")).sort(), input.objects.map(item => `${item.sha256}.blob`).sort())
      && isDeepStrictEqual(fs.readdirSync(reservationDirectory.path).sort(), writer.reservations.map(item => path.basename(item.file)).sort()), "file_changed");
    writer.guards(); testHooks.beforeSourceClose?.(); session.close(); sourceClosed = true; testHooks.afterSourceClose?.();
    for (const item of writer.files) writer.seal(item); writer.guards(); testHooks.beforeTargetClose?.(); writer.close(); targetClosed = true;
    writer.guards(); for (const item of writer.files) need(isDeepStrictEqual(native(fs.lstatSync(item.file, { bigint: true })), item.identity), "file_changed");
    const objectProofs = input.objects.map(object => { const item = published.get(object.sha256); return {
      sha256: object.sha256, size: object.size, sha512: object.sha512, gitBlobSha1: object.gitBlobSha1, path: item.file,
      identity: item.identity, parentIdentity: objectsDirectory.identity, referenceIds: [...object.referenceIds].sort(),
    }; });
    const reservationProofs = writer.reservations.map(item => ({ path: item.file, size: 0, sha256: item.sha256, identity: item.identity,
      parentIdentity: reservationDirectory.identity }));
    const targetReferences = input.references.map(ref => ({ ...ref, path: published.get(ref.sha256).file, ownerProfile: "ROOT_PRIVATE",
      nativeIdentity: published.get(ref.sha256).identity, parentIdentity: objectsDirectory.identity }));
    const result = { kind: "POSTGRES_EVIDENCE_GENERATION_TRANSFER_V1", state: "TRANSFERRED_SOURCE_CLOSED",
      sourceGeneration: input.sourceGeneration, targetGeneration: input.targetGeneration, directory: input.directory,
      storageRootIdentity, directoryIdentity: generationDirectory.identity, objectsDirectoryIdentity: objectsDirectory.identity,
      identityReservationsDirectoryIdentity: reservationDirectory.identity,
      sourceClosed: true, descriptorsClosed: true,
      claims: { authority: "INTERNAL_OPAQUE_TRANSFER_ONLY", admission: "NOT_AUTHORIZED", closure: "NOT_ESTABLISHED",
        policyAuthority: "NOT_ACCEPTED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED" },
      inventory: { references: { count: input.references.length, bytes: input.referenceBytes, digest: sha("sha256", encode(input.references)) },
        objects: { count: objectProofs.length, bytes: objectProofs.reduce((sum, item) => sum + item.size, 0), digest: sha("sha256", encode(objectProofs)) },
        identityReservations: { count: reservationProofs.length, digest: sha("sha256", encode(reservationProofs)) },
        forbiddenIdentitiesDigest: sha("sha256", encode(input.forbiddenIdentities)) }, identityReservations: reservationProofs,
      objects: objectProofs, targetReferences };
    return freeze(result);
  } catch (error) {
    let uncertain = failures.get(error) === "cleanup_uncertain";
    if (!sourceClosed) try { session?.close(); sourceClosed = true; } catch { uncertain = true; }
    if (!targetClosed) try { writer?.close(); targetClosed = true; } catch { uncertain = true; }
    if (uncertain) try { fail("cleanup_uncertain"); } catch (value) { failure = value; }
    else if (failures.has(error)) failure = error;
    else try { fail("operation_failed"); } catch (value) { failure = value; }
    throw failure;
  }
}

function copyRequest(value) {
  const result = record(value, ["authority", "executionId", "deadline", "signal"]), match = typeof result.executionId === "string"
    ? /^pg-complete-([0-9a-f]{24})$/u.exec(result.executionId) : null;
  need(match && Number.isFinite(result.deadline) && result.deadline > performance.now() && result.deadline <= performance.now() + LIMITS.operationMs
    && result.signal instanceof globalThis.AbortSignal && !result.signal.aborted, "arguments_invalid"); return { ...result, nonce: match[1] };
}
function retrieveRequest(value) {
  const result = record(value, ["copy", "deadline", "signal"]);
  need(Number.isFinite(result.deadline) && result.deadline > performance.now() && result.deadline <= performance.now() + LIMITS.operationMs
    && result.signal instanceof globalThis.AbortSignal && !result.signal.aborted, "arguments_invalid"); return result;
}
function exclusionKeys(references, transfer) {
  return [...new Set([
    ...references.flatMap(item => [identityKey(item.nativeIdentity), identityKey(item.parentIdentity)]),
    identityKey(transfer.directoryIdentity), identityKey(transfer.objectsDirectoryIdentity),
    identityKey(transfer.identityReservationsDirectoryIdentity), ...transfer.objects.map(item => identityKey(item.identity)),
    ...transfer.identityReservations.map(item => identityKey(item.identity)),
  ])].sort();
}
function withoutCurrentSources(forbidden, references) {
  const current = new Set(references.map(item => identityKey(item.nativeIdentity)));
  return forbidden.filter(item => !current.has(item));
}
function copyCapability(request, authoritySha256, references, lane, raw, testOnly) {
  const forbidden = exclusionKeys(references, raw), value = freeze({
    kind: testOnly ? "TEST_ONLY_POSTGRES_EVIDENCE_COPY_CAPABILITY_V1" : "POSTGRES_EVIDENCE_COPY_CAPABILITY_V1",
    state: "COPY_SOURCE_CLOSED", lane, executionId: request.executionId, authoritySha256, copy: raw,
    forbiddenIdentitiesDigest: sha("sha256", encode(forbidden)),
    claims: { authority: testOnly ? "TEST_ONLY_PRIVATE_COPY_CAPABILITY" : "AUTHENTIC_LOADED_AUTHORITY_PRIVATE_COPY_CAPABILITY",
      closure: "COPY_ONLY", admission: "NOT_AUTHORIZED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED" },
  });
  (testOnly ? testCopies : productionCopies).set(value, { references: raw.targetReferences, forbidden, lane,
    executionId: request.executionId, authoritySha256, nonce: request.nonce }); return value;
}
function testCopyOptions(value) {
  const result = record(value, ["references", "hooks", "forbiddenIdentities"]), references = array(result.references, LIMITS.references, "reference_invalid");
  const forbiddenIdentities = array(result.forbiddenIdentities, LIMITS.references * 6 + 16);
  need(forbiddenIdentities.every(item => typeof item === "string" && IDENTITY.test(item))
    && forbiddenIdentities.every((item, index) => index === 0 || forbiddenIdentities[index - 1] < item), "arguments_invalid");
  record(result.hooks, Object.keys(result.hooks)); return { references, hooks: result.hooks, forbiddenIdentities };
}
export function copyEvidenceGeneration(input) {
  const request = copyRequest(input); let references, authoritySha256, lane, nonce = request.nonce;
  try {
    const authority = validateLoadedPostgresCompletePrivateCopyPolicy(request.authority);
    references = getPostgresCompletePrivateCopyReferences(authority);
    authoritySha256 = getPostgresCompletePrivateCopyPolicySha256(authority); lane = "EVIDENCE";
  } catch {
    try {
      const authority = validateLoadedPostgresLaunchControlPolicy(request.authority);
      need(getPostgresLaunchControlExecutionId(authority) === request.executionId, "authority_invalid");
      const launchPlanSha256 = getPostgresLaunchControlLaunchPlanSha256(authority);
      nonce = sha("sha256", Buffer.from(`P5-CONTROLS\0${request.executionId}\0${launchPlanSha256}`)).slice(0, 24);
      references = getPostgresLaunchControlReferences(authority);
      authoritySha256 = getPostgresLaunchControlPolicySha256(authority); lane = "CONTROL";
    } catch { fail("authority_invalid"); }
  }
  const raw = run({ references, directory: `${STORAGE_ROOT}/pg-complete-copy-${nonce}`, deadline: request.deadline,
    signal: request.signal, sourceGeneration: "ORIGINAL", forbiddenIdentities: [] }, undefined, false);
  return copyCapability({ ...request, nonce }, authoritySha256, references, lane, raw, false);
}
export function retrieveEvidenceGeneration(input) {
  const request = retrieveRequest(input), privateValue = productionCopies.get(request.copy); need(privateValue, "copy_capability_invalid");
  const raw = run({ references: privateValue.references, directory: `${STORAGE_ROOT}/pg-complete-retrieve-${privateValue.nonce}`,
    deadline: request.deadline, signal: request.signal, sourceGeneration: "COPY",
    forbiddenIdentities: withoutCurrentSources(privateValue.forbidden, privateValue.references) }, undefined, false);
  return freeze({ kind: "POSTGRES_EVIDENCE_GENERATION_PAIR_V1", state: "RETRIEVE_SOURCE_CLOSED", lane: privateValue.lane,
    executionId: privateValue.executionId, authoritySha256: privateValue.authoritySha256,
    generations: { copy: request.copy.copy, retrieve: raw },
    preservation: { copyCapabilityAuthentic: true, originalsClosedBeforeRetrieve: request.copy.copy.sourceClosed === true,
      copyClosedBeforeRetrieve: request.copy.copy.descriptorsClosed === true, forbiddenIdentitiesDigest: request.copy.forbiddenIdentitiesDigest,
      pairwiseDisjoint: true, descriptorsClosed: raw.descriptorsClosed === true },
    claims: { authority: "AUTHENTIC_SAME_PROCESS_COPY_RETRIEVAL", closure: "GENERATION_PAIR_ONLY", admission: "NOT_AUTHORIZED",
      currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED" } });
}
export function TEST_ONLY_copyEvidenceGeneration(input, options) {
  const request = copyRequest(input); try { TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy(request.authority); } catch { fail("authority_invalid"); }
  const test = testCopyOptions(options), raw = run({ references: test.references,
    directory: `${STORAGE_ROOT}/test-pg-complete-copy-${request.nonce}`, deadline: request.deadline, signal: request.signal,
    sourceGeneration: "ORIGINAL", forbiddenIdentities: test.forbiddenIdentities }, { hooks: test.hooks }, true);
  return copyCapability(request, null, test.references, "EVIDENCE", raw, true);
}
export function TEST_ONLY_retrieveEvidenceGeneration(input, options = { hooks: {} }) {
  const request = retrieveRequest(input), privateValue = testCopies.get(request.copy); need(privateValue, "copy_capability_invalid");
  const value = record(options, ["hooks"]); record(value.hooks, Object.keys(value.hooks));
  const raw = run({ references: privateValue.references, directory: `${STORAGE_ROOT}/test-pg-complete-retrieve-${privateValue.nonce}`,
    deadline: request.deadline, signal: request.signal, sourceGeneration: "COPY",
    forbiddenIdentities: withoutCurrentSources(privateValue.forbidden, privateValue.references) }, value, true);
  return freeze({ kind: "TEST_ONLY_POSTGRES_EVIDENCE_GENERATION_PAIR_V1", state: "RETRIEVE_SOURCE_CLOSED", lane: privateValue.lane,
    executionId: privateValue.executionId, authoritySha256: null, generations: { copy: request.copy.copy, retrieve: raw },
    preservation: { copyCapabilityAuthentic: true, originalsClosedBeforeRetrieve: request.copy.copy.sourceClosed === true,
      copyClosedBeforeRetrieve: request.copy.copy.descriptorsClosed === true, forbiddenIdentitiesDigest: request.copy.forbiddenIdentitiesDigest,
      pairwiseDisjoint: true, descriptorsClosed: raw.descriptorsClosed === true },
    claims: { authority: "TEST_ONLY_AUTHENTIC_SAME_PROCESS_COPY_RETRIEVAL", closure: "NOT_ESTABLISHED", admission: "NOT_AUTHORIZED",
      currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED" } });
}
export function TEST_ONLY_runEvidenceGenerationTransfer(input, options) { return run(input, options, true); }
export function evidenceGenerationTransferFailureDiagnostic(error) {
  return Object.freeze({ code: PREFIX + (failures.get(error) ?? "operation_failed"), cleanup: failures.get(error) === "cleanup_uncertain" ? "UNVERIFIED" : "CONFIRMED" });
}
export const evidenceGenerationTransferContract = freeze({ storageRoot: STORAGE_ROOT, generations: GENERATIONS, limits: LIMITS,
  targetProfile: { ownerProfile: "ROOT_PRIVATE", file: [0, 0, 0o600], directory: [0, 0, 0o700] } });
