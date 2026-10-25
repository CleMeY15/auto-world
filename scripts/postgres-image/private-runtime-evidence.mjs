import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { posix as path } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { authenticatePostgresPrivateRuntimeEvidence, validatePostgresPrivateRuntimeEvidenceReceipt } from "./private-runtime-evidence-input.mjs";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN, postgresPrivateRuntimeEvidenceLimits as LIMITS,
  postgresPrivateRuntimeEvidenceFailureCodes as CODES } from "./private-runtime-evidence-policy.mjs";
import { postgresPrivateRuntimeEvidenceRecord as record, postgresPrivateRuntimeEvidenceIdentity as identity,
  validatePostgresPrivateRuntimeEvidenceSources as validateSources, validatePostgresPrivateRuntimeEvidenceFrame as validateFrame,
  postgresPrivateRuntimeEvidenceLocation as location } from "./private-runtime-evidence-protocol.mjs";
import { POSTGRES_PRIVATE_EVIDENCE_PIN as LEGACY_PIN, postgresPrivateEvidenceLimits as LEGACY_LIMITS } from "./private-evidence-policy.mjs";
import { COLD_LOAD_PIN } from "./cold-load-policy.mjs";
import { inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";
import { sealPostgresSqlBackup } from "./candidate-sql-backup-restore.mjs";

const PREFIX = "postgres_private_runtime_evidence_";
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const OWN_FILE = ["dev", "ino", "uid", "gid", "mode", "nlink"];
const fail = (reason) => { throw new Error(PREFIX + reason); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const directoryIdentity = (stat) => Object.fromEntries(DIRECTORY.map((key) => [key, identity(stat)[key]]));
const canonical = (file) => typeof file === "string" && file.length <= 1024 && path.isAbsolute(file)
  && path.normalize(file) === file && !/[\\\0]/u.test(file);
const remaining = (deadline) => Math.max(1, Math.min(LIMITS.gitCommandMs, deadline - Date.now()));
function check(deadline, signal) {
  if (signal?.aborted || Date.now() >= deadline) fail("operation_failed");
}
function nativeActor() {
  if (process.platform !== "linux" || [process.getuid?.(), process.geteuid?.(), process.getgid?.(), process.getegid?.()].some((id) => id !== 1000)) fail("context_invalid");
}
function errorReason(error) {
  try {
    const message = error?.message;
    if (typeof message === "string" && CODES.some((reason) => message === PREFIX + reason)) return message.slice(PREFIX.length);
    if (message === "postgres_private_evidence_source_bundle_git_invalid") return "git_invalid";
    if (["postgres_sql_backup_descriptor_cleanup_failed", "postgres_private_evidence_source_bundle_cleanup_uncertain",
      "postgres_private_evidence_source_bundle_git_cleanup_uncertain"].includes(message)) return "cleanup_uncertain";
  } catch { /* Dependency messages are never output. */ }
  return "operation_failed";
}
function failure(error, phase, uncertain = false) {
  const reason = uncertain ? "cleanup_uncertain" : errorReason(error);
  const value = new Error(PREFIX + reason); value.phase = phase;
  value.cleanup = reason === "cleanup_uncertain" ? "UNVERIFIED" : "CONFIRMED"; return value;
}
function closeUnclaimedSources(sources) {
  let uncertain = false;
  for (const source of sources) {
    try {
      const actual = fs.fstatSync(source.fd, { bigint: true });
      if (String(actual.dev) !== source.identity.dev || String(actual.ino) !== source.identity.ino) { uncertain = true; continue; }
      fs.closeSync(source.fd);
    } catch (error) { if (error?.code !== "EBADF") uncertain = true; }
  }
  return uncertain;
}

function sourceSpecification(specs) {
  if (!Array.isArray(specs) || specs.length !== 3) fail("source_invalid");
  return specs.map((value, index) => {
    const v = record(value, ["role", "fd", "source", "name", "size", "sha256", "uid", "gid", "mode"]);
    if (v.role !== PIN.sources[index].role || v.name !== PIN.sources[index].name || !canonical(v.source)
      || !Number.isSafeInteger(v.fd) || v.fd < 3 || !Number.isSafeInteger(v.size) || v.size < 1 || v.size > LIMITS.sourceBytes
      || typeof v.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(v.sha256) || v.mode !== 0o600
      || ["uid", "gid"].some((key) => !Number.isSafeInteger(v[key]) || v[key] < 0)) fail("source_invalid");
    return Object.freeze(v);
  });
}

function createSession(input) {
  nativeActor();
  input = record(input, ["parent", "directory", "sources", "specs", "deadline", "signal"]);
  if (!canonical(input.parent) || !canonical(input.directory) || path.dirname(input.directory) !== input.parent
    || !Number.isSafeInteger(input.deadline) || input.deadline <= Date.now() || input.deadline > Date.now() + LIMITS.operationMs
    || !(input.signal instanceof globalThis.AbortSignal)) fail("context_invalid");
  const specs = sourceSpecification(input.specs); const sources = validateSources(input.sources, specs);
  if (new Set(sources.map((source) => source.fd)).size !== 3 || sources.some((source) => source.source === input.directory
    || source.source.startsWith(input.directory + "/") || input.directory.startsWith(source.source + "/"))) fail("source_invalid");
  const handles = sources.map((source) => ({ fd: source.fd, source: true, file: source.source, expected: source, identity: source.identity }));
  const directories = new Map(); const ancestors = new Map(); const files = [];
  let closed = false; let copied = false; let receipt; let cleanupDeadline;
  const tick = () => check(input.deadline, input.signal);
  const cleanupTick = () => { cleanupDeadline ??= Date.now() + LIMITS.cleanupMs; if (Date.now() >= cleanupDeadline) fail("cleanup_uncertain"); };
  const anchor = (directory) => {
    for (let file = directory;; file = path.dirname(file)) {
      const stat = fs.lstatSync(file, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(file) !== file) fail("copy_failed");
      const current = directoryIdentity(stat);
      if (ancestors.has(file) && !isDeepStrictEqual(ancestors.get(file), current)) fail("copy_failed");
      ancestors.set(file, current); if (file === "/") break;
    }
  };
  const guards = (held = true, cleanup = false) => {
    if (cleanup) cleanupTick(); else tick();
    for (const [file, expected] of ancestors) {
      const stat = fs.lstatSync(file, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(file) !== file || !isDeepStrictEqual(directoryIdentity(stat), expected)) fail("copy_failed");
    }
    for (const [file, entry] of directories) {
      const stat = fs.lstatSync(file, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || !isDeepStrictEqual(directoryIdentity(stat), entry.identity)
        || held && !isDeepStrictEqual(directoryIdentity(fs.fstatSync(entry.fd, { bigint: true })), entry.identity)) fail("copy_failed");
    }
  };
  const holdDirectory = (file, privateMode) => {
    anchor(file); const stat = fs.lstatSync(file, { bigint: true });
    if (stat.uid !== 1000n || stat.gid !== 1000n || (stat.mode & 0o7022n) !== 0n
      || privateMode && (stat.mode & 0o7777n) !== 0o700n || fs.statfsSync(file, { bigint: true }).type !== 0xef53n) fail("copy_failed");
    const result = spawnSync("/usr/bin/findmnt", ["--noheadings", "--output", "FSTYPE", "--target", file], {
      encoding: null, timeout: Math.min(10000, remaining(input.deadline)), maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    });
    if (result.error || result.signal || result.status !== 0 || result.stderr.length || !result.stdout.equals(Buffer.from("ext4\n"))) fail("copy_failed");
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const entry = { fd, identity: directoryIdentity(stat) }; handles.push(entry); directories.set(file, entry); guards();
  };
  const sourceGuard = (item) => {
    tick(); const stat = fs.fstatSync(item.fd, { bigint: true });
    if (!stat.isFile() || !isDeepStrictEqual(identity(stat), item.identity) || fs.readlinkSync("/proc/self/fd/" + item.fd) !== item.file) fail("source_invalid");
    const information = fs.readFileSync("/proc/self/fdinfo/" + item.fd, "utf8");
    const matches = [...information.matchAll(/^flags:\s+([0-7]{1,16})\s*$/gmu)];
    if (information.length > 4096 || matches.length !== 1) fail("source_invalid");
    const flags = BigInt("0o" + matches[0][1]);
    if ((flags & 3n) !== 0n || (flags & 0o10000000n) !== 0n) fail("source_invalid");
  };
  const fileGuard = (item) => {
    guards(); const stat = fs.fstatSync(item.fd, { bigint: true }); const named = fs.lstatSync(item.file, { bigint: true });
    if (!stat.isFile() || !named.isFile() || named.isSymbolicLink() || fs.realpathSync(item.file) !== item.file
      || !isDeepStrictEqual(identity(stat), identity(named)) || stat.nlink !== 1n || Number(stat.size) !== item.expected.size
      || item.privateFile && (stat.uid !== 1000n || stat.gid !== 1000n || (stat.mode & 0o7777n) !== 0o600n)
      || item.identity && !isDeepStrictEqual(identity(stat), item.identity)) fail("copy_failed");
    return identity(stat);
  };
  const read = (item, collect = true) => {
    if (item.source) sourceGuard(item); else fileGuard(item);
    if (item.expected.size > (item.bundle ? LEGACY_LIMITS.bundleBytes : LIMITS.sourceBytes)) fail("source_invalid");
    const bytes = Buffer.alloc(collect ? item.expected.size : 65536); const digest = createHash("sha256"); let position = 0;
    while (position < item.expected.size) {
      tick(); const offset = collect ? position : 0;
      const count = fs.readSync(item.fd, bytes, offset, Math.min(65536, item.expected.size - position), position);
      if (count < 1) fail(item.source ? "source_invalid" : "copy_failed");
      digest.update(bytes.subarray(offset, offset + count)); position += count;
    }
    if (fs.readSync(item.fd, Buffer.alloc(1), 0, 1, position) !== 0 || digest.digest("hex") !== item.expected.sha256) fail(item.source ? "source_invalid" : "copy_failed");
    if (item.source) sourceGuard(item); else fileGuard(item); return collect ? bytes : undefined;
  };
  const inventory = (withReceipt = Boolean(receipt)) => {
    guards();
    const root = ["backup", "cold-receipt.json", "sql-receipt.json", ...(withReceipt ? ["receipt.json"] : [])].sort();
    if (!isDeepStrictEqual(fs.readdirSync(input.directory).sort(), root)
      || !isDeepStrictEqual(fs.readdirSync(path.join(input.directory, "backup")), ["diagnostic.dump"])) fail("copy_failed");
  };
  const createFile = (file, bytes, expected) => {
    guards(); const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    const item = { fd, file, expected, privateFile: true }; handles.push(item);
    const initial = fs.fstatSync(fd, { bigint: true }); item.own = identity(initial);
    if (!initial.isFile() || initial.size !== 0n || initial.uid !== 1000n || initial.gid !== 1000n
      || (initial.mode & 0o7777n) !== 0o600n || initial.nlink !== 1n) fail("copy_failed");
    let position = 0;
    while (position < bytes.length) { tick(); const count = fs.writeSync(fd, bytes, position, bytes.length - position, position); if (count < 1) fail("copy_failed"); position += count; }
    fs.fsyncSync(fd); item.identity = fileGuard(item); if (!read(item).equals(bytes)) fail("copy_failed"); return item;
  };
  const sealAll = () => { guards(); for (const item of handles) if (item.expected) read(item, false); if (copied) inventory(); };
  const close = () => {
    if (closed) return; closed = true; let uncertain = false;
    for (const item of handles.slice().reverse()) { try { fs.closeSync(item.fd); } catch { uncertain = true; } }
    if (uncertain) fail("cleanup_uncertain");
  };
  const retire = () => {
    if (!receipt) return;
    guards(!closed, true);
    const named = fs.lstatSync(receipt.file, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || !OWN_FILE.every((key) => identity(named)[key] === receipt.own[key])) fail("cleanup_uncertain");
    if (!closed) {
      const actual = fs.fstatSync(receipt.fd, { bigint: true });
      if (!actual.isFile() || !OWN_FILE.every((key) => identity(actual)[key] === receipt.own[key])) fail("cleanup_uncertain");
    }
    fs.unlinkSync(receipt.file); receipt = undefined;
  };
  const payloads = () => files.map((item, index) => ({ name: specs[index].name, role: specs[index].role,
    size: specs[index].size, sha256: specs[index].sha256, sourceIdentity: { ...sources[index].identity }, identity: { ...item.identity } }));
  const openReference = (file, expected, bundle) => {
    if (!canonical(file) || !Number.isSafeInteger(expected.size) || expected.size < 1
      || expected.size > (bundle ? LEGACY_LIMITS.bundleBytes : LIMITS.sourceBytes)) fail("source_invalid");
    const privateFile = bundle || file === path.join(PIN.legacy.directory, "receipt.json");
    if (privateFile && !directories.has(path.dirname(file))) holdDirectory(path.dirname(file), true);
    anchor(path.dirname(file)); const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const item = { fd, file, expected, bundle, privateFile };
    handles.push(item); item.identity = fileGuard(item);
    if (bundle && !isDeepStrictEqual(item.identity, expected.identity)) fail("source_invalid");
    return read(item, !bundle);
  };
  try {
    for (const item of handles) read(item, false);
    holdDirectory(input.parent, false);
    const capacity = fs.statfsSync(input.parent, { bigint: true });
    if (capacity.bavail * capacity.bsize < BigInt(specs.reduce((sum, item) => sum + item.size, LIMITS.receiptBytes + LIMITS.reservedDiskBytes))) fail("copy_failed");
    return {
      readSources: () => sources.map((source, index) => read(handles[index])),
      reference: (file, expected) => openReference(file, expected, false),
      referenceBundle: (file, expected) => openReference(file, expected, true),
      copy: () => {
        if (copied) fail("copy_failed"); guards(); fs.mkdirSync(input.directory, { mode: 0o700 }); holdDirectory(input.directory, true);
        fs.mkdirSync(path.join(input.directory, "backup"), { mode: 0o700 }); holdDirectory(path.join(input.directory, "backup"), true);
        sources.forEach((source, index) => { const bytes = read(handles[index]); const file = createFile(path.join(input.directory, specs[index].name), bytes, specs[index]);
          files.push(file); if (!read(handles[index]).equals(bytes)) fail("source_invalid"); });
        copied = true; sealAll(); return payloads();
      },
      directories: () => ["", "backup"].map((name) => ({ name, identity: { ...directories.get(path.join(input.directory, name)).identity } })),
      payloads,
      publish: (bytes) => {
        if (!copied || receipt || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > LIMITS.receiptBytes) fail("publication_failed");
        inventory(false); const expected = { size: bytes.length, sha256: hash(bytes) };
        guards(); const fd = fs.openSync(path.join(input.directory, "receipt.json"), fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        receipt = { fd, file: path.join(input.directory, "receipt.json"), expected, privateFile: true }; handles.push(receipt);
        const initial = fs.fstatSync(fd, { bigint: true }); receipt.own = identity(initial);
        if (!initial.isFile() || initial.size !== 0n || initial.uid !== 1000n || initial.gid !== 1000n || initial.nlink !== 1n || (initial.mode & 0o7777n) !== 0o600n) fail("publication_failed");
        let position = 0;
        while (position < bytes.length) { tick(); const count = fs.writeSync(fd, bytes, position, bytes.length - position, position); if (count < 1) fail("publication_failed"); position += count; }
        fs.fsyncSync(fd); receipt.identity = fileGuard(receipt); if (!read(receipt).equals(bytes)) fail("publication_failed"); inventory();
        return { name: "receipt.json", size: bytes.length, sha256: expected.sha256, identity: { ...receipt.identity } };
      },
      seal: sealAll, retire, close,
    };
  } catch (error) {
    let uncertain = false; try { close(); } catch { uncertain = true; }
    throw failure(error, "SOURCE", uncertain);
  }
}

// This fixture surface proves native copy discipline, not historical/default acceptance.
export function createPostgresPrivateRuntimeEvidenceCopySession(input) {
  const held = createSession(input);
  const safe = (action, phase) => (...args) => { try { return action(...args); } catch (error) { throw failure(error, phase); } };
  return Object.freeze({
    copy: safe(() => ({ kind: "POSTGRES_PRIVATE_RUNTIME_EVIDENCE_FILES_V1", state: "PARTIAL_HELPER_PROOF", scope: "NATIVE_COPY_ONLY",
      payloads: held.copy(), directories: held.directories() }), "COPY"),
    publish: safe((proof) => {
      if (proof?.kind !== "POSTGRES_PRIVATE_RUNTIME_EVIDENCE_FILES_V1" || proof.state !== "PARTIAL_HELPER_PROOF" || proof.scope !== "NATIVE_COPY_ONLY") fail("publication_failed");
      return held.publish(Buffer.from(JSON.stringify(proof) + "\n"));
    }, "PUBLICATION"),
    seal: safe(held.seal, "FINALIZE"), retire: safe(held.retire, "CLEANUP"), close: safe(held.close, "CLEANUP"),
  });
}

export async function intakePostgresPrivateRuntimeEvidence(startValue, controls) {
  let held; let inheritedSources; let phase = "CONTEXT";
  try {
    nativeActor(); const start = validateFrame(startValue, { kind: "START" });
    inheritedSources = start.sources;
    controls = record(controls, Object.hasOwn(controls ?? {}, "result") ? ["commit", "finalize", "result"] : ["commit", "finalize"]);
    if (typeof controls.commit !== "function" || typeof controls.finalize !== "function"
      || Object.hasOwn(controls, "result") && typeof controls.result !== "function") fail("control_invalid");
    const signal = globalThis.AbortSignal.timeout(start.deadline - Date.now()); const startedAt = new Date().toISOString();
    phase = "SOURCE";
    const before = await inspectPostgresPrivateEvidenceSource({ workspace: PIN.workspace, deadline: start.deadline, signal });
    const expected = { ...location(start.nonce, before.head), sources: start.sources };
    held = createSession({ parent: PIN.parent, directory: expected.directory, sources: start.sources, specs: PIN.sources, deadline: start.deadline, signal });
    const sources = held.readSources(); phase = "HISTORY";
    const policyBytes = held.reference(path.join(PIN.workspace, LEGACY_PIN.policyFiles.candidate), LEGACY_PIN.publicFiles.find((file) => file.name === LEGACY_PIN.policyFiles.candidate));
    const runtimePolicyBytes = held.reference(path.join(PIN.workspace, LEGACY_PIN.policyFiles.runtime), LEGACY_PIN.publicFiles.find((file) => file.name === LEGACY_PIN.policyFiles.runtime));
    const copyReceiptBytes = held.reference(COLD_LOAD_PIN.copyReceiptFile, LEGACY_PIN.copyReceipt);
    const legacyReceiptBytes = held.reference(path.join(PIN.legacy.directory, "receipt.json"), PIN.legacy);
    const authenticated = authenticatePostgresPrivateRuntimeEvidence({ policyBytes, runtimePolicyBytes, copyReceiptBytes,
      coldReceiptBytes: sources[0], sqlReceiptBytes: sources[1], legacyReceiptBytes });
    held.referenceBundle(path.join(PIN.legacy.directory, "source", "recipes.bundle"), authenticated.legacyReceipt.bundle.file);
    const original = sealPostgresSqlBackup(authenticated.history.backupOriginal);
    if (!isDeepStrictEqual(original, authenticated.history.backupOriginal)
      || !isDeepStrictEqual({ ...original.identity, size: original.size }, start.sources[2].identity)) fail("historical_invalid");
    phase = "COPY"; const payloads = held.copy();
    const backupCopy = sealPostgresSqlBackup({ ...original, directory: path.join(expected.directory, "backup"),
      identity: Object.fromEntries(Object.entries(payloads[2].identity).filter(([key]) => key !== "size")) });
    const after = await inspectPostgresPrivateEvidenceSource({ workspace: PIN.workspace, deadline: start.deadline, signal });
    if (!isDeepStrictEqual(before, after)) fail("source_invalid"); held.seal();
    const receiptValue = { kind: "POSTGRES_PRIVATE_RUNTIME_EVIDENCE_RECEIPT_V1", state: "PUBLISHED_AWAITING_SUPERVISOR_ACK",
      purpose: PIN.purpose, authority: "LOCAL_DIAGNOSTIC", executionId: expected.executionId, recipeRevision: expected.recipeRevision,
      githubRunId: null, directory: expected.directory, filesystem: "EXT4", actor: { uid: 1000, gid: 1000 },
      subject: PIN.subject, imageId: authenticated.history.imageId, tag: authenticated.history.tag,
      payloads, directories: held.directories(), history: authenticated.history, backupCopy, sourceGit: { before, after },
      startedAt, preparedAt: new Date().toISOString(), historicalIntegrity: "VERIFIED", currentness: "NOT_EVALUATED",
      runtimePermission: "NOT_GRANTED", closure: "INCOMPLETE", requiredMissing: PIN.requiredMissing,
      supervisorAckRequired: true, sourceUnchanged: true, privateState: "RETAINED", network: "NOT_ATTEMPTED", registryRead: "NOT_ATTEMPTED",
      registryWrite: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null };
    validatePostgresPrivateRuntimeEvidenceReceipt(receiptValue, expected);
    phase = "PREPARED";
    const prepared = { kind: "PREPARED", nonce: start.nonce, recipeRevision: expected.recipeRevision,
      executionId: expected.executionId, directory: expected.directory, payloads };
    const commit = validateFrame(await controls.commit(prepared), { kind: "COMMIT", nonce: start.nonce });
    if (!isDeepStrictEqual(commit.sources, start.sources)) fail("control_invalid"); held.seal();
    phase = "PUBLICATION";
    const receipt = held.publish(Buffer.from(JSON.stringify(receiptValue, null, 2) + "\n"));
    const post = await inspectPostgresPrivateEvidenceSource({ workspace: PIN.workspace, deadline: start.deadline, signal });
    if (!isDeepStrictEqual(before, post) || !isDeepStrictEqual(sealPostgresSqlBackup(original), original)
      || !isDeepStrictEqual(sealPostgresSqlBackup(backupCopy), backupCopy)) fail("source_invalid"); held.seal();
    phase = "FINALIZE";
    validateFrame(await controls.finalize({ kind: "PUBLISHED", nonce: start.nonce, recipeRevision: expected.recipeRevision,
      executionId: expected.executionId, directory: expected.directory, receipt }), { kind: "FINALIZE", nonce: start.nonce });
    if (!isDeepStrictEqual(sealPostgresSqlBackup(original), original) || !isDeepStrictEqual(sealPostgresSqlBackup(backupCopy), backupCopy)) fail("source_invalid");
    const finalSource = await inspectPostgresPrivateEvidenceSource({ workspace: PIN.workspace, deadline: start.deadline, signal });
    if (!isDeepStrictEqual(before, finalSource)) fail("source_invalid"); held.seal(); held.close();
    const result = validateFrame({ kind: "RESULT", nonce: start.nonce, recipeRevision: expected.recipeRevision, executionId: expected.executionId,
      directory: expected.directory, receipt, payloads, sourceUnchanged: true, descriptorsClosed: true }, { kind: "RESULT", nonce: start.nonce });
    if (controls.result) await controls.result(result);
    return result;
  } catch (error) {
    let uncertain = false;
    if (held) { try { held.retire(); } catch { uncertain = true; } try { held.close(); } catch { uncertain = true; } }
    else if (inheritedSources) uncertain = closeUnclaimedSources(inheritedSources);
    const projected = failure(error, phase, uncertain);
    if (!held && !inheritedSources) projected.cleanup = "UNVERIFIED";
    throw projected;
  }
}
