import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN, postgresPrivateRuntimeEvidenceLimits as LIMITS,
  postgresPrivateRuntimeEvidenceEnvironment as ENV, postgresPrivateRuntimeEvidenceFailureCodes as CODES,
  postgresPrivateRuntimeEvidencePhases as PHASES, freezePostgresPrivateRuntimeEvidence as freeze } from "./private-runtime-evidence-policy.mjs";
import { postgresPrivateRuntimeEvidenceChannel, postgresPrivateRuntimeEvidenceLocation,
  validatePostgresPrivateRuntimeEvidenceFrame, validatePostgresPrivateRuntimeEvidenceSources,
  validatePostgresPrivateRuntimeEvidenceAcknowledgement } from "./private-runtime-evidence-protocol.mjs";

const PREFIX = "postgres_private_runtime_evidence_";
const DIRECTORY_ID = ["dev", "ino", "uid", "gid", "mode"];
const SOURCE_KEYS = ["role", "fd", "source", "name", "size", "sha256", "uid", "gid", "mode"];
const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKER = path.join(ROOT, "scripts/postgres-image/private-runtime-evidence-worker.mjs");
const DROP = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
const plain = value => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Reflect.ownKeys(value).every(key => typeof key === "string")
  && isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...keys].sort())
  && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
const fail = code => { throw new Error(PREFIX + code); };
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid),
  mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink), size: Number(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) });
const directoryIdentity = stat => Object.fromEntries(DIRECTORY_ID.map(key => [key, identity(stat)[key]]));
const absolute = value => typeof value === "string" && value.length <= 512 && path.posix.isAbsolute(value)
  && path.posix.normalize(value) === value && !/[\0\\]/u.test(value);
function remaining(deadline, signal) {
  if (signal?.aborted || Date.now() >= deadline) fail("operation_failed");
  return deadline - Date.now();
}

function processProof(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) fail("control_invalid");
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const parts = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const argvBytes = readFileSync(`/proc/${pid}/cmdline`);
  if (stat.length > 4096 || status.length > 16384 || argvBytes.length > 4096) fail("control_invalid");
  return { startTicks: parts[19], status, executable: readlinkSync(`/proc/${pid}/exe`), argv: argvBytes.toString("utf8").split("\0") };
}
function processIdentity(value, pid, startTicks, parentPid) {
  if (!Number.isSafeInteger(pid) || pid < 2 || !Number.isSafeInteger(parentPid) || parentPid < 2
    || typeof startTicks !== "string" || !/^[1-9][0-9]{0,19}$/u.test(startTicks)
    || !exact(value, ["startTicks", "status", "executable", "argv"]) || typeof value.status !== "string"
    || value.status.length > 16384 || value.startTicks !== startTicks || typeof value.executable !== "string"
    || !Array.isArray(value.argv) || value.argv.some(arg => typeof arg !== "string")
    || !new RegExp(`^Pid:\\s+${pid}\\s*$`, "mu").test(value.status)
    || !new RegExp(`^PPid:\\s+${parentPid}\\s*$`, "mu").test(value.status)) fail("control_invalid");
  return value;
}
export function validatePostgresPrivateRuntimeEvidenceWorkerProcess(value, expected) {
  if (!exact(expected, ["pid", "startTicks", "parentPid", "node", "worker"])
    || !absolute(expected.node) || !absolute(expected.worker)) fail("control_invalid");
  processIdentity(value, expected.pid, expected.startTicks, expected.parentPid);
  if (value.executable !== expected.node || !isDeepStrictEqual(value.argv, [expected.node, expected.worker, ""])
    || !/^Uid:\s+1000\s+1000\s+1000\s+1000\s*$/mu.test(value.status)
    || !/^Gid:\s+1000\s+1000\s+1000\s+1000\s*$/mu.test(value.status)
    || !/^Groups:[ \t]*$/mu.test(value.status) || !/^NoNewPrivs:\s+1\s*$/mu.test(value.status)
    || ["CapInh", "CapPrm", "CapEff", "CapAmb"].some(key => !new RegExp(`^${key}:\\s+0{16}\\s*$`, "mu").test(value.status))) fail("control_invalid");
  return Object.freeze({ pid: expected.pid, startTicks: expected.startTicks, uid: 1000, gid: 1000,
    supplementaryGroups: 0, capabilities: 0, noNewPrivileges: true });
}
function rootActor() {
  if (process.platform !== "linux" || [process.getuid(), process.geteuid(), process.getgid(), process.getegid()].some(id => id !== 0)) fail("context_invalid");
}
function waitBounded(promise, milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > LIMITS.operationMs) fail("control_invalid");
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(PREFIX + "control_invalid")), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

// Testable native supervisor: the caller already owns a real child and readonly source reader.
// It never spawns a command or opens a destination. Only the fixed CLI below supplies production inputs.
export async function supervisePostgresPrivateRuntimeEvidenceChild(input) {
  if (!exact(input, ["child", "reader", "nonce", "deadline", "node", "worker", "sources", ...(Object.hasOwn(input ?? {}, "signal") ? ["signal"] : [])])
    || typeof input.nonce !== "string" || !/^[0-9a-f]{24}$/u.test(input.nonce)
    || !Number.isSafeInteger(input.deadline) || input.deadline - Date.now() > LIMITS.operationMs
    || !absolute(input.node) || !absolute(input.worker)
    || input.signal !== undefined && !(input.signal instanceof globalThis.AbortSignal)) fail("context_invalid");
  rootActor();
  const { child, reader, nonce, deadline, node, worker, sources: spec, signal } = input;
  if (!child || !child.stdin || !child.stdout || !child.stderr || typeof child.once !== "function"
    || typeof child.kill !== "function" || !reader || typeof reader.seal !== "function" || typeof reader.close !== "function") fail("context_invalid");
  const sources = validatePostgresPrivateRuntimeEvidenceSources(reader.sources, spec);
  const channel = postgresPrivateRuntimeEvidenceChannel(child.stdout, child.stdin, { nonce, sources: spec });
  let exit; let childError = false; let stderrError = false; let stderrBytes = 0; let stderrEnded = false;
  let startTicks; let rootClosed = false; let phase = "SOURCE";
  let closeResolve; const closed = new Promise(resolve => { closeResolve = resolve; });
  let rejectAbort; const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  // A spawn error can precede the first race; retain the original rejected promise for every gate.
  void aborted.catch(() => {});
  const onClose = (status, signal) => { exit = { status, signal }; closeResolve(); };
  const onError = () => { childError = true; rejectAbort(new Error(PREFIX + "control_invalid")); };
  const onStderr = chunk => {
    stderrBytes += Buffer.isBuffer(chunk) ? chunk.length : 1; stderrError = true;
    rejectAbort(new Error(PREFIX + "control_invalid"));
  };
  const onStderrEnd = () => { stderrEnded = true; };
  const onStderrError = () => { stderrError = true; rejectAbort(new Error(PREFIX + "control_invalid")); };
  child.once("close", onClose); child.on("error", onError); child.stderr.on("data", onStderr);
  child.stderr.once("end", onStderrEnd); child.stderr.on("error", onStderrError);
  const onAbort = () => rejectAbort(new Error(PREFIX + "operation_failed"));
  signal?.addEventListener("abort", onAbort, { once: true });
  const interruptible = promise => Promise.race([promise, aborted]);
  const budget = cap => Math.min(cap, remaining(deadline, signal));
  const healthy = () => { remaining(deadline, signal); channel.healthy(); if (childError || stderrError || stderrBytes) fail("control_invalid"); };
  const checkWorker = () => validatePostgresPrivateRuntimeEvidenceWorkerProcess(processProof(child.pid),
    { pid: child.pid, startTicks, parentPid: process.pid, node, worker });
  const reseal = () => { if (!isDeepStrictEqual(reader.seal(), sources)) fail("source_invalid"); healthy(); };
  const take = async (kind, recipeRevision) => {
    const observed = validatePostgresPrivateRuntimeEvidenceFrame(await interruptible(channel.next(budget(LIMITS.gitCommandMs))),
      { nonce, recipeRevision, sources: spec });
    if (observed.kind === "FAILED") { phase = observed.phase; throw new Error(observed.code); }
    return validatePostgresPrivateRuntimeEvidenceFrame(observed, { kind, nonce, recipeRevision, sources: spec });
  };
  let completed = false;
  try {
    remaining(deadline, signal);
    const initial = processProof(child.pid); startTicks = initial.startTicks;
    processIdentity(initial, child.pid, startTicks, process.pid);
    reseal(); await interruptible(channel.send({ kind: "START", nonce, deadline, sources }, budget(LIMITS.cleanupMs)));
    const prepared = await take("PREPARED");
    phase = "PREPARED"; healthy(); checkWorker();
    if (prepared.payloads.some((file, index) => !isDeepStrictEqual(file.sourceIdentity, sources[index].identity))) fail("control_invalid");
    reseal(); await interruptible(channel.sendAndAllowNext({ kind: "COMMIT", nonce, sources }, budget(LIMITS.cleanupMs)));
    const published = await take("PUBLISHED", prepared.recipeRevision);
    phase = "PUBLICATION"; healthy(); checkWorker(); reseal();
    reader.close(); rootClosed = true;
    await interruptible(channel.send({ kind: "FINALIZE", nonce, rootSourcesUnchanged: true, rootDescriptorsClosed: true }, budget(LIMITS.cleanupMs)));
    await interruptible(channel.endAndAllowNext(budget(LIMITS.cleanupMs))); phase = "FINALIZE";
    const result = await take("RESULT", prepared.recipeRevision);
    if (!isDeepStrictEqual(result.payloads, prepared.payloads) || !isDeepStrictEqual(result.receipt, published.receipt)) fail("control_invalid");
    await interruptible(channel.eof(budget(LIMITS.cleanupMs))); await interruptible(waitBounded(closed, budget(LIMITS.cleanupMs))); healthy();
    if (exit?.status !== 0 || exit.signal !== null || !stderrEnded || !channel.writerClosed()) fail("control_invalid");
    completed = true;
    return freeze({ state: "PARTIAL_TRANSPORT_PROOF", nonce, recipeRevision: prepared.recipeRevision, executionId: prepared.executionId, directory: prepared.directory,
      sources, payloads: prepared.payloads, receipt: published.receipt });
  } catch (error) {
    let uncertain = false;
    const cleanupDeadline = Date.now() + LIMITS.cleanupMs;
    try { reader.close(); rootClosed = true; } catch { uncertain = true; }
    if (!exit) {
      try {
        // No resource operation follows a control fault; EOF lets the worker retire its own provisional receipt.
        await channel.send({ kind: "ABORT", nonce }, Math.max(1, Math.min(1000, cleanupDeadline - Date.now())));
        await channel.end(Math.max(1, Math.min(1000, cleanupDeadline - Date.now())));
      } catch { if (!child.stdin.destroyed) child.stdin.end(); }
      try { await waitBounded(closed, Math.max(1, Math.min(1000, cleanupDeadline - Date.now()))); } catch { /* Owned signal below. */ }
      if (!exit) {
        try {
          const observed = processIdentity(processProof(child.pid), child.pid, startTicks, process.pid);
          const nodeProcess = observed.executable === node && isDeepStrictEqual(observed.argv, [node, worker, ""]);
          const droppingProcess = observed.executable === PIN.setpriv && isDeepStrictEqual(observed.argv, [PIN.setpriv, ...DROP, node, worker, ""]);
          if (!nodeProcess && !droppingProcess) fail("cleanup_uncertain");
          child.kill("SIGTERM"); uncertain = true;
          try { await waitBounded(closed, Math.max(1, Math.min(1000, cleanupDeadline - Date.now()))); } catch {
            const current = processIdentity(processProof(child.pid), child.pid, startTicks, process.pid);
            if (current.executable !== observed.executable || !isDeepStrictEqual(current.argv, observed.argv)) fail("cleanup_uncertain");
            child.kill("SIGKILL"); await waitBounded(closed, Math.max(1, cleanupDeadline - Date.now()));
          }
        } catch { uncertain = true; }
      }
    }
    if (!exit || !rootClosed) uncertain = true;
    const failure = postgresPrivateRuntimeEvidenceSupervisorFailureDiagnostic(uncertain ? new Error(PREFIX + "cleanup_uncertain") : error, phase,
      "UNVERIFIED");
    throw Object.assign(new Error(failure.code), { diagnostic: failure });
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!exit) {
      // Closing this parent's pipes is permitted even when process ownership cannot be proved.
      // Leave the unproved child untouched and prevent late pipe errors from exposing raw diagnostics.
      const terminal = () => {};
      child.on("error", terminal); child.once("close", () => child.removeListener("error", terminal));
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        stream.on("error", terminal); stream.once("close", () => stream.removeListener("error", terminal)); stream.destroy();
      }
      child.unref();
    }
    channel.dispose(); child.removeListener("close", onClose); child.removeListener("error", onError);
    child.stderr.removeListener("data", onStderr); child.stderr.removeListener("end", onStderrEnd); child.stderr.removeListener("error", onStderrError);
    if (!completed && !rootClosed) { try { reader.close(); } catch { /* Already reported as uncertain. */ } }
  }
}

function installed(file) {
  const named = lstatSync(file, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || named.uid !== 0n || named.gid !== 0n || named.nlink !== 1n
    || (named.mode & 0o022n) !== 0n || (named.mode & 0o111n) === 0n || realpathSync(file) !== file) fail("context_invalid");
  for (let ancestor = path.dirname(file);; ancestor = path.dirname(ancestor)) {
    const dir = lstatSync(ancestor);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== 0 || dir.gid !== 0 || (dir.mode & 0o022) !== 0
      || realpathSync(ancestor) !== ancestor) fail("context_invalid");
    if (ancestor === "/") break;
  }
  return identity(named);
}
export function validatePostgresPrivateRuntimeEvidenceEnvironment(value) {
  try {
    // Only Node's actual process.env may use its native prototype; ordinary inputs remain plain records.
    if (value !== process.env && !plain(value)) fail("context_invalid");
    const keys = Object.keys(ENV);
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== "string") || !isDeepStrictEqual(ownKeys.sort(), [...keys].sort())) fail("context_invalid");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable
      || typeof descriptors[key].value !== "string")) fail("context_invalid");
    const snapshot = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
    if (!isDeepStrictEqual(snapshot, ENV)) fail("context_invalid");
    return Object.freeze(snapshot);
  } catch { fail("context_invalid"); }
}
export async function runPostgresPrivateRuntimeEvidenceDiagnostic(argv = [], env = process.env) {
  const deadline = Date.now() + LIMITS.operationMs;
  if (!Array.isArray(argv) || argv.length) fail("context_invalid");
  validatePostgresPrivateRuntimeEvidenceEnvironment(env);
  rootActor();
  if (process.version !== "v22.23.2" || process.execPath !== PIN.node || ROOT !== PIN.workspace || realpathSync(ROOT) !== ROOT
    || process.cwd() !== ROOT) fail("context_invalid");
  const nodeIdentity = installed(PIN.node); const setprivIdentity = installed(PIN.setpriv);
  const version = spawnSync(PIN.setpriv, ["--version"], { cwd: ROOT, env: ENV, encoding: null,
    timeout: Math.min(10_000, remaining(deadline)), maxBuffer: 4096, windowsHide: true });
  if (version.error || version.signal || version.status !== 0 || !Buffer.isBuffer(version.stdout)
    || version.stdout.toString("utf8") !== "setpriv from util-linux 2.39.3\n" || !Buffer.isBuffer(version.stderr) || version.stderr.length) fail("context_invalid");
  const nonce = randomBytes(12).toString("hex"); const controller = new globalThis.AbortController();
  const stop = () => controller.abort(); process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const timer = setTimeout(stop, remaining(deadline));
  let child; let reader;
  try {
    reader = openPostgresPrivateRuntimeEvidenceSources({ sources: PIN.sources, deadline, signal: controller.signal });
    child = spawn(PIN.setpriv, [...DROP, PIN.node, WORKER], { cwd: ROOT, env: ENV,
      stdio: ["pipe", "pipe", "pipe", ...reader.descriptors], windowsHide: true });
    const observed = await supervisePostgresPrivateRuntimeEvidenceChild({ child, reader, nonce, deadline, node: PIN.node, worker: WORKER, sources: PIN.sources, signal: controller.signal });
    if (!isDeepStrictEqual(installed(PIN.node), nodeIdentity) || !isDeepStrictEqual(installed(PIN.setpriv), setprivIdentity)) fail("context_invalid");
    const location = postgresPrivateRuntimeEvidenceLocation(nonce, observed.recipeRevision);
    const ack = { state: "ADDENDUM_VERIFIED", authority: "LOCAL_DIAGNOSTIC", nonce, executionId: location.executionId,
      recipeRevision: location.recipeRevision, privateRoot: location.directory, receipt: observed.receipt, sources: observed.sources,
      payloads: observed.payloads, legacy: PIN.legacy,
      cleanup: { rootDescriptors: "CLOSED", workerDescriptors: "CLOSED", child: "CLOSED_EXIT_0", output: "EOF_ZERO_STDERR", writer: "CLOSED" },
      historicalIntegrity: "VERIFIED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED", closure: "INCOMPLETE",
      requiredMissing: PIN.requiredMissing, registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", network: "NOT_ATTEMPTED",
      signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null };
    return validatePostgresPrivateRuntimeEvidenceAcknowledgement(ack, { nonce, recipeRevision: observed.recipeRevision,
      sources: observed.sources, receipt: observed.receipt, payloads: observed.payloads });
  } catch (error) {
    reader?.close();
    throw error;
  } finally {
    clearTimeout(timer); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  }
}
function reason(error) {
  try { const message = error?.message;
    if (typeof message === "string" && message.startsWith(PREFIX) && CODES.includes(message.slice(PREFIX.length))) return message.slice(PREFIX.length);
  } catch { /* Dependencies do not select diagnostic text. */ } return "operation_failed";
}
export function postgresPrivateRuntimeEvidenceSupervisorFailureDiagnostic(error, phase = "CONTEXT", cleanup = "UNVERIFIED") {
  const code = reason(error);
  return Object.freeze({ code: PREFIX + code, phase: PHASES.includes(phase) ? phase : "CONTEXT",
    cleanup: code !== "cleanup_uncertain" && cleanup === "CONFIRMED" ? "CONFIRMED" : "UNVERIFIED" });
}
function readerInput(value) {
  if (!exact(value, ["sources", "deadline", ...(Object.hasOwn(value ?? {}, "signal") ? ["signal"] : [])])
    || !Number.isSafeInteger(value.deadline) || value.deadline - Date.now() > LIMITS.operationMs
    || value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal)
    || !Array.isArray(value.sources) || value.sources.length !== 3) fail("context_invalid");
  for (let index = 0; index < value.sources.length; index++) {
    const source = value.sources[index]; const role = PIN.sources[index];
    if (!exact(source, SOURCE_KEYS) || source.role !== role.role || source.fd !== role.fd || source.name !== role.name
      || !absolute(source.source) || !Number.isSafeInteger(source.size) || source.size < 1 || source.size > LIMITS.sourceBytes
      || typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(source.sha256)
      || source.uid !== role.uid || source.gid !== role.gid || source.mode !== role.mode) fail("context_invalid");
  }
  if (!/^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}\/receipt\.json$/u.test(value.sources[0].source)
    || !/^\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}\/receipt\.json$/u.test(value.sources[1].source)
    || value.sources[2].source !== path.posix.join(path.posix.dirname(value.sources[1].source), "work/backup/diagnostic.dump")) fail("context_invalid");
  if (process.platform !== "linux" || [process.getuid(), process.geteuid(), process.getgid(), process.getegid()].some(id => id !== 0)) fail("context_invalid");
  remaining(value.deadline, value.signal);
  return { ...value, sources: freeze(globalThis.structuredClone(value.sources)) };
}
function readonlyDescriptor(fd, source) {
  const info = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8");
  if (info.length > 4096) fail("source_invalid");
  const flags = info.match(/^flags:\s+([0-7]{1,12})\s*$/mu); const position = info.match(/^pos:\s+([0-9]+)\s*$/mu);
  if (!flags || !position || position[1] !== "0") fail("source_invalid");
  const value = Number.parseInt(flags[1], 8);
  if (!Number.isSafeInteger(value) || (value & 3) !== constants.O_RDONLY || (value & 0x200000) !== 0
    || readlinkSync(`/proc/self/fd/${fd}`) !== source) fail("source_invalid");
}

// This low-level API accepts harmless fixture byte pins. The default CLI supplies only PIN.sources.
export function openPostgresPrivateRuntimeEvidenceSources(inputRaw) {
  const input = readerInput(inputRaw); const anchors = new Map(); const files = []; let closed = false; let closeFailed = false;
  const close = () => {
    if (closed) { if (closeFailed) fail("cleanup_uncertain"); return; } closed = true; let uncertain = false;
    for (const fd of [...files.map(file => file.descriptor), ...[...anchors.values()].map(anchor => anchor.descriptor)]) {
      try { closeSync(fd); } catch { uncertain = true; }
    }
    closeFailed = uncertain; if (uncertain) fail("cleanup_uncertain");
  };
  const guardAnchors = () => {
    if (closed) fail("source_invalid"); remaining(input.deadline, input.signal);
    for (const [file, anchor] of anchors) {
      const named = lstatSync(file, { bigint: true }); const held = fstatSync(anchor.descriptor, { bigint: true });
      if (!named.isDirectory() || named.isSymbolicLink() || !held.isDirectory() || realpathSync(file) !== file
        || !isDeepStrictEqual(directoryIdentity(named), anchor.identity) || !isDeepStrictEqual(directoryIdentity(held), anchor.identity)) fail("source_invalid");
    }
  };
  const guardFile = file => {
    guardAnchors(); readonlyDescriptor(file.descriptor, file.pin.source);
    const named = lstatSync(file.pin.source, { bigint: true }); const held = fstatSync(file.descriptor, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || !held.isFile() || realpathSync(file.pin.source) !== file.pin.source
      || !isDeepStrictEqual(identity(named), file.identity) || !isDeepStrictEqual(identity(held), file.identity)) fail("source_invalid");
  };
  const seal = () => {
    try {
      for (const file of files) {
        guardFile(file); const hash = createHash("sha256"); const bytes = Buffer.alloc(4096); let position = 0;
        while (position < file.pin.size) {
          remaining(input.deadline, input.signal); const count = readSync(file.descriptor, bytes, 0, Math.min(bytes.length, file.pin.size - position), position);
          if (count < 1) fail("source_invalid"); hash.update(bytes.subarray(0, count)); position += count;
        }
        if (readSync(file.descriptor, bytes, 0, 1, position) !== 0 || hash.digest("hex") !== file.pin.sha256) fail("source_invalid");
        guardFile(file);
      }
      guardAnchors(); return sources;
    } catch (error) {
      const safe = reason(error);
      // Real abort/deadline diagnostics remain distinct from unknown filesystem error text.
      fail(safe !== "operation_failed" || input.signal?.aborted || Date.now() >= input.deadline ? safe : "source_invalid");
    }
  };
  let sources;
  try {
    const coldParent = path.posix.dirname(input.sources[0].source); const sqlParent = path.posix.dirname(input.sources[1].source);
    for (const [file, uid, gid, mode] of [["/", 0, 0, 0o755], ["/var", 0, 0, 0o755], ["/var/tmp", 0, 0, 0o1777],
      [coldParent, 0, 1000, 0o710], [sqlParent, 0, 1000, 0o710], [path.posix.join(sqlParent, "work"), 1000, 1000, 0o700],
      [path.posix.join(sqlParent, "work/backup"), 1000, 1000, 0o700]]) {
      const named = lstatSync(file, { bigint: true });
      if (!named.isDirectory() || named.isSymbolicLink() || realpathSync(file) !== file || named.uid !== BigInt(uid)
        || named.gid !== BigInt(gid) || (named.mode & 0o7777n) !== BigInt(mode)) fail("source_invalid");
      const descriptor = openSync(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const anchor = { descriptor, identity: directoryIdentity(named) }; anchors.set(file, anchor); guardAnchors();
    }
    for (const pin of input.sources) {
      guardAnchors(); const named = lstatSync(pin.source, { bigint: true });
      if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || named.uid !== BigInt(pin.uid)
        || named.gid !== BigInt(pin.gid) || (named.mode & 0o7777n) !== BigInt(pin.mode) || named.size !== BigInt(pin.size)) fail("source_invalid");
      const descriptor = openSync(pin.source, constants.O_RDONLY | constants.O_NOFOLLOW);
      const file = { descriptor, pin, identity: identity(named) }; files.push(file); guardFile(file);
    }
    sources = freeze(files.map(file => ({ role: file.pin.role, fd: file.pin.fd, source: file.pin.source,
      size: file.pin.size, sha256: file.pin.sha256, identity: file.identity })));
    seal();
    return Object.freeze({ sources, descriptors: Object.freeze(files.map(file => file.descriptor)), seal, close });
  } catch (error) {
    try { close(); } catch { fail("cleanup_uncertain"); }
    const safe = reason(error); fail(safe === "operation_failed" ? "source_invalid" : safe);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresPrivateRuntimeEvidenceDiagnostic(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    const recorded = error && Object.getOwnPropertyDescriptor(error, "diagnostic")?.value;
    const diagnostic = exact(recorded, ["code", "phase", "cleanup"])
      ? postgresPrivateRuntimeEvidenceSupervisorFailureDiagnostic(new Error(recorded.code), recorded.phase, recorded.cleanup)
      : postgresPrivateRuntimeEvidenceSupervisorFailureDiagnostic(error);
    console.error(JSON.stringify({ state: "INCOMPLETE", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", ...diagnostic }));
    process.exitCode = 1;
  });
}
