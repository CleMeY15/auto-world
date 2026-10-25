import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, chownSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdtempSync,
  mkdirSync, openSync, readFileSync, readlinkSync, readSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { startPostgresRuntimeDaemonLease, postgresRuntimeDaemonFailureDiagnostic } from "../docker-isolated/daemon-postgres-runtime.mjs";
import { validatePostgresLocalRuntimeRestoreProof, validatePostgresLocalRuntimeRestoreFailureDiagnostic } from "./candidate-local-runtime-restore.mjs";
import { authenticatePostgresRuntimeRestoreMaterial, authenticatePriorPostgresColdLoad, postgresRuntimeRestoreEngineInput, validatePostgresRuntimeRestoreEngineIdentity } from "./runtime-restore-input.mjs";
import { POSTGRES_RUNTIME_RESTORE_PIN as PIN, postgresRuntimeRestoreLimits as LIMITS } from "./runtime-restore-policy.mjs";
import { assertPostgresRuntimeRestoreWriterHealthy, postgresRuntimeRestoreFrameReader, postgresRuntimeRestoreParentControl, writePostgresRuntimeRestoreFrame } from "./runtime-restore-protocol.mjs";
import { validatePostgresRuntimeRestoreWorkerStatus } from "./runtime-restore-worker.mjs";
import { validatePostgresPrivateCopyLinuxResult } from "./private-copy-linux.mjs";
import { preflightLocalPostgresRuntimeAudit, stagePostgresRuntimeAudit, sealPostgresRuntimeAuditStage, replayLocalPostgresRuntimeAudit, validatePostgresRuntimeAuditStageProof } from "./runtime-restore-audit.mjs";
import { validatePostgresSqlBackupProof } from "./candidate-sql-backup-restore.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKER = path.join(ROOT, "scripts/postgres-image/runtime-restore-worker.mjs");
const SETPRIV = "/usr/bin/setpriv";
const CAP = LIMITS.receiptBytes;
const FOREIGN = ["sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537",
  "sha256:1105aaf5e7223aac9caeb251ff2ad4eb09d9f4d97ba4e5afde52e0f017f848aa"].sort();
const ENV = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: "/home/autoworld" });
const DROP = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
const PHASES = ["CONTEXT", "MATERIAL", "AUDIT", "DAEMON", "WORKER", "FINAL_SEAL", "CLEANUP", "RECEIPT"];
const CODES = new Set(["postgres_runtime_restore_context_invalid", "postgres_runtime_restore_material_invalid", "postgres_runtime_restore_control_invalid",
  "postgres_runtime_restore_worker_failed", "postgres_runtime_restore_daemon_failed", "postgres_runtime_restore_cleanup_uncertain", "postgres_runtime_restore_receipt_failed"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, fields) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...fields].sort());
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code = "postgres_runtime_restore_context_invalid") => { throw new Error(code); };
const bytes = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
function json(value) { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)); } catch { fail(); } }
export function postgresRuntimeRestoreSupervisorFailureDiagnostic(error, phase = "CONTEXT") {
  let code = "postgres_runtime_restore_context_invalid";
  try { const message = error?.message; if (CODES.has(message)) code = message; } catch { /* No arbitrary errors/output. */ }
  return Object.freeze({ code, phase: PHASES.includes(phase) ? phase : "CONTEXT" });
}
function installed(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || stat.gid !== 0 || stat.nlink !== 1 || (stat.mode & 0o022) !== 0
    || (stat.mode & 0o111) === 0 || realpathSync(file) !== file) fail();
  for (let ancestor = path.dirname(file);; ancestor = path.dirname(ancestor)) {
    const dir = lstatSync(ancestor);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== 0 || dir.gid !== 0 || (dir.mode & 0o022) !== 0 || realpathSync(ancestor) !== ancestor) fail();
    if (ancestor === "/") break;
  }
}
function output(command, args, env = ENV, timeout = 30_000) {
  const value = spawnSync(command, args, { cwd: ROOT, env, encoding: null, timeout, maxBuffer: CAP, windowsHide: true });
  if (value.error || value.signal || value.status !== 0 || !Buffer.isBuffer(value.stdout) || value.stdout.length > CAP
    || !Buffer.isBuffer(value.stderr) || value.stderr.length) fail();
  return value.stdout;
}
function sourceRevision(deadline) {
  if (lstatSync(ROOT).uid !== 1000 || realpathSync(ROOT) !== ROOT) fail();
  const git = (args) => output(SETPRIV, [...DROP, "/usr/bin/git", "-C", ROOT, ...args], ENV,
    deadline ? Math.min(10_000, remainingBudget(deadline)) : 10_000).toString("utf8").trim();
  const revision = git(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(revision) || git(["status", "--porcelain", "--untracked-files=normal"]) !== "") fail();
  return revision;
}
function fixedBytes(file, size, expectedSha) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true }); const named = lstatSync(file, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(size) || size > CAP
      || named.isSymbolicLink() || realpathSync(file) !== file || !sameFile(before, named)) fail("postgres_runtime_restore_material_invalid");
    const content = readFileSync(fd);
    if (content.length !== size || sha(content) !== expectedSha || !sameFile(before, fstatSync(fd, { bigint: true }))
      || !sameFile(before, lstatSync(file, { bigint: true }))) fail("postgres_runtime_restore_material_invalid");
    return content;
  } finally { closeSync(fd); }
}
function sameFile(a, b) {
  return ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].every((key) => a[key] === b[key]);
}
export function postgresRuntimeRestoreClientIdentity(value, nonce) {
  const fields = ["purpose", "authority", "admission", "root", "socket", "endpoint", "dockerConfig", "contextName", "pid", "startTicks", "daemonId",
    "version", "dataRoot", "execRoot", "containerdAddress", "containersNamespace", "pluginsNamespace", "configSha256", "argvSha256",
    "rootActor", "clientActor", "socketProof", "socketDirectoryProof"];
  if (!exact(value, fields) || value.purpose !== "POSTGRES_RUNTIME_SQL_RESTORE" || value.authority !== "LOCAL_DIAGNOSTIC"
    || value.admission !== "NOT_AUTHORIZED" || !isDeepStrictEqual(value.rootActor, { uid: 0, gid: 0 })
    || !isDeepStrictEqual(value.clientActor, { uid: 1000, gid: 1000 })
    || value.socketProof?.uid !== 0 || value.socketProof?.gid !== 1000 || value.socketProof?.mode !== 0o660
    || value.socketDirectoryProof?.uid !== 0 || value.socketDirectoryProof?.gid !== 1000 || value.socketDirectoryProof?.mode !== 0o710
    || !Number.isSafeInteger(value.pid) || value.pid < 2 || typeof value.startTicks !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value.startTicks)
    || value.version !== "28.0.4" || ![value.configSha256, value.argvSha256].every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/u.test(hash))
    || typeof value.root !== "string" || !/^\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}$/u.test(value.root)
    || value.socket !== `${value.root}/endpoint/docker.sock` || value.endpoint !== `unix://${value.socket}`
    || value.dataRoot !== `${value.root}/infra/data` || value.execRoot !== `${value.root}/infra/exec`
    || value.dockerConfig !== `${value.root}/client` || value.containerdAddress !== "/run/containerd/containerd.sock"
    || typeof value.daemonId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/u.test(value.daemonId)
    || typeof value.contextName !== "string" || !/^aw-pg-restore-[0-9a-f]{24}$/u.test(value.contextName)
    || value.containersNamespace !== `awpgsql-${value.contextName.slice(14)}` || value.pluginsNamespace !== `plugins.awpgsql-${value.contextName.slice(14)}`
    || nonce !== undefined && (typeof nonce !== "string" || !/^[0-9a-f]{24}$/u.test(nonce) || value.contextName !== `aw-pg-restore-${nonce}`)) fail();
  for (const proof of [value.socketProof, value.socketDirectoryProof]) {
    if (!exact(proof, ["dev", "ino", "uid", "gid", "mode"]) || ![proof.dev, proof.ino].every((n) => typeof n === "string" && /^[1-9][0-9]{0,19}$/u.test(n))) fail();
  }
  const result = { endpoint: value.endpoint, daemonId: value.daemonId, dataRoot: value.dataRoot,
    containerdAddress: value.containerdAddress, containersNamespace: value.containersNamespace, pluginsNamespace: value.pluginsNamespace,
    dockerConfig: value.dockerConfig, contextName: value.contextName, socket: value.socketProof, socketDirectory: value.socketDirectoryProof };
  return validatePostgresRuntimeRestoreEngineIdentity(result, value.contextName.slice(14));
}
export function validatePostgresRuntimeRestoreRootAcknowledgement(value, identity, state, principalSha) {
  if (!plain(identity) || typeof identity.daemonId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/u.test(identity.daemonId)
    || typeof identity.endpoint !== "string" || !/^unix:\/\/\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}\/endpoint\/docker\.sock$/u.test(identity.endpoint)
    || !Number.isSafeInteger(identity.pid) || identity.pid < 2) fail("postgres_runtime_restore_daemon_failed");
  if (!["VERIFIED", "VERIFIED_EMPTY", "VERIFIED_IMAGE_ONLY"].includes(state)) fail("postgres_runtime_restore_daemon_failed");
  const counts = state === "VERIFIED_EMPTY" ? { images: 0, containers: 0, volumes: 0 }
    : state === "VERIFIED_IMAGE_ONLY" ? { images: 1, containers: 0, volumes: 0 } : {};
  const expected = { state, purpose: "POSTGRES_RUNTIME_SQL_RESTORE", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    daemonId: identity.daemonId, endpoint: identity.endpoint, pid: identity.pid, principalImageCount: 2,
    principalSnapshotSha256: principalSha ?? value?.principalSnapshotSha256, ...counts };
  if (typeof expected.principalSnapshotSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(expected.principalSnapshotSha256)
    || !isDeepStrictEqual(value, expected)) fail("postgres_runtime_restore_daemon_failed");
  return value;
}
function materialSeal(recipeRevision, material, deadline) {
  const value = json(output(SETPRIV, [...DROP, PIN.node, path.join(ROOT, "scripts/postgres-image/private-copy-linux.mjs"), "seal", PIN.directory], ENV,
    deadline ? Math.min(30_000, remainingBudget(deadline)) : 30_000));
  validatePostgresPrivateCopyLinuxResult(value, PIN.original, material.policy, material.copyReceipt.linuxFinalProof.archiveProof);
  if (!isDeepStrictEqual({ ...value, recipeRevision: PIN.copyRecipeRevision }, material.copyReceipt.linuxFinalProof)
    || value.recipeRevision !== recipeRevision) fail("postgres_runtime_restore_material_invalid");
  return value;
}
function childProcessProof(pid) {
  const root = `/proc/${pid}`;
  const stat = readFileSync(path.join(root, "stat"), "utf8");
  const parts = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
  return { startTicks: parts[19], status: readFileSync(path.join(root, "status"), "utf8"),
    executable: readlinkSync(path.join(root, "exe")), argv: readFileSync(path.join(root, "cmdline")).toString("utf8").split("\0") };
}
export function validatePostgresRuntimeRestoreWorkerProcess(value, pid, expectedStartTicks, parentPid) {
  if (!Number.isSafeInteger(parentPid) || parentPid < 2 || !exact(value, ["startTicks", "status", "executable", "argv"])
    || typeof value.startTicks !== "string" || typeof expectedStartTicks !== "string" || typeof value.status !== "string"
    || !/^[1-9][0-9]{0,19}$/u.test(value.startTicks) || value.startTicks !== expectedStartTicks
    || value.executable !== PIN.node || !isDeepStrictEqual(value.argv, [PIN.node, WORKER, ""])
    || !new RegExp(`^PPid:\\s+${parentPid}\\s*$`, "mu").test(value.status ?? "")) fail("postgres_runtime_restore_control_invalid");
  return validatePostgresRuntimeRestoreWorkerStatus(value.status, pid);
}
async function runWorker(start, lease, initial, auditStage, material, deadline) {
  const child = spawn(SETPRIV, [...DROP, PIN.node, WORKER], { cwd: ROOT,
    env: { ...ENV, DOCKER_CONFIG: start.identity.dockerConfig }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let exit; let childError; let stderrBytes = 0; let startTicks; let timer; let restoreBoundary = false;
  const exited = new Promise((resolve) => {
    child.once("error", () => { childError = true; resolve(); });
    child.once("close", (status, signal) => { exit = { status, signal }; resolve(); });
  });
  child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
  child.stderr.on("error", () => { childError = true; });
  const reader = postgresRuntimeRestoreFrameReader(child.stdout);
  const control = postgresRuntimeRestoreParentControl(start.nonce, start.identity, PIN.auditReceiptSha256);
  const remaining = () => remainingBudget(deadline);
  try {
    if (!Number.isSafeInteger(child.pid) || child.pid < 2) fail("postgres_runtime_restore_worker_failed");
    startTicks = childProcessProof(child.pid).startTicks;
    timer = setTimeout(() => {
      try { if (childProcessProof(child.pid).startTicks === startTicks) child.kill("SIGKILL"); } catch { /* Never signal a replacement PID. */ }
      reader.close();
    }, remaining());
    await writePostgresRuntimeRestoreFrame(child.stdin, start);
    for (;;) {
      const frame = await reader.next(Math.min(90_000, remaining()));
      if (stderrBytes || childError) fail("postgres_runtime_restore_worker_failed");
      if (frame.kind === "FAILURE") {
        if (!exact(frame, ["kind", "nonce", "diagnostic"]) || frame.nonce !== start.nonce) fail("postgres_runtime_restore_worker_failed");
        throw Object.assign(new Error("postgres_runtime_restore_worker_failed"), {
          workerFailure: validatePostgresLocalRuntimeRestoreFailureDiagnostic(frame.diagnostic),
        });
      }
      if (frame.kind === "REQUEST") {
        const request = control.accept(frame);
        validatePostgresRuntimeRestoreWorkerProcess(childProcessProof(child.pid), child.pid, startTicks, process.pid);
        const observed = await lease.verifyIdentity();
        validatePostgresRuntimeRestoreRootAcknowledgement(observed, lease.identity, "VERIFIED", initial.principalSnapshotSha256);
        // This grant precedes restore-volume creation, not an inspection of an already restored volume.
        if (request.phase === "RESTORE_START" && !restoreBoundary) {
          validatePostgresRuntimeRestoreRootAcknowledgement(await lease.verifyInventory("IMAGE_ONLY"), lease.identity,
            "VERIFIED_IMAGE_ONLY", initial.principalSnapshotSha256);
          restoreBoundary = true;
        }
        let audit;
        if (request.intent === "AUDIT") {
          const summary = replayLocalPostgresRuntimeAudit(auditStage, { policy: material.runtimePolicy, workspace: ROOT, deadline });
          audit = { state: "VERIFIED_CURRENT", purpose: PIN.purpose, phase: request.phase, daemonId: start.identity.daemonId,
            endpoint: start.identity.endpoint, ...summary };
        }
        remaining();
        validatePostgresRuntimeRestoreWorkerProcess(childProcessProof(child.pid), child.pid, startTicks, process.pid);
        reader.assertReadyToReply();
        const grant = control.grant(request, audit);
        await writePostgresRuntimeRestoreFrame(child.stdin, grant, () => reader.allowNext());
      } else {
        if (!exact(frame, ["kind", "nonce", "recipeRevision", "executionId", "proof", "sourceBefore", "sourceAfter", "workerActor"])
          || frame.kind !== "RESULT" || frame.nonce !== start.nonce || frame.recipeRevision !== start.recipeRevision
          || frame.executionId !== start.executionId || !restoreBoundary) fail("postgres_runtime_restore_worker_failed");
        control.assertComplete();
        validatePostgresLocalRuntimeRestoreProof(frame.proof, postgresRuntimeRestoreEngineInput(start));
        if (!isDeepStrictEqual(frame.workerActor, validatePostgresRuntimeRestoreWorkerProcess(childProcessProof(child.pid), child.pid, startTicks, process.pid))) fail();
        reader.assertReadyToReply();
        await writePostgresRuntimeRestoreFrame(child.stdin, { kind: "FINISH", nonce: start.nonce, recipeRevision: start.recipeRevision, executionId: start.executionId });
        child.stdin.end();
        let exitTimer;
        try { await Promise.race([exited, new Promise((_, reject) => {
          exitTimer = setTimeout(() => reject(new Error("postgres_runtime_restore_worker_failed")), remaining());
        })]); } finally { clearTimeout(exitTimer); }
        clearTimeout(timer); remaining();
        if (childError || exit?.status !== 0 || exit?.signal || stderrBytes) fail("postgres_runtime_restore_worker_failed");
        reader.assertFinished(); assertPostgresRuntimeRestoreWriterHealthy(child.stdin);
        return frame;
      }
    }
  } finally {
    clearTimeout(timer); reader.close();
    try {
      if (!exit) {
        try { if (startTicks && childProcessProof(child.pid).startTicks === startTicks) child.kill("SIGKILL"); }
        catch { /* No guessed PID or replacement-process signal. */ }
        let cleanupTimer;
        try { await Promise.race([exited, new Promise((resolve) => { cleanupTimer = setTimeout(resolve, 5_000); })]); }
        finally { clearTimeout(cleanupTimer); }
        if (!exit && Number.isSafeInteger(child.pid) && child.pid > 1) fail("postgres_runtime_restore_cleanup_uncertain");
      }
    } finally { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
  }
}
export function validatePostgresLocalRuntimeRestoreReceipt(value, start, material) {
  const fields = ["schemaVersion", "kind", "state", "authority", "origin", "executionId", "githubRunId", "recipeRevision",
    "originalRecipeRevision", "originalExecutionId", "copyRecipeRevision", "copyExecutionId", "copyReceiptSha256", "policySha256",
    "priorColdLoadSha256", "runtimePolicySha256", "auditRunId", "auditRecipeRevision", "auditReceiptSha256", "auditStage", "auditStageFinal",
    "backupFinal", "startedAt", "finishedAt", "daemonIdentity", "initialInventory", "finalInventory", "daemonCleanup", "worker", "sourceInitial", "sourceFinal",
    "imageLoad", "imageExecution", "serviceRestore", "sqlRestore", "registryRead", "registryWrite", "signing", "admission",
    "supportStartedAt", "supportEndsAt", "archiveUntil", "failure", "daemonFailure", "workerFailure"];
  if (!exact(value, fields) || value.schemaVersion !== 1 || value.kind !== "POSTGRES_LOCAL_RUNTIME_SQL_RESTORE_RECEIPT_V1"
    || value.state !== "VERIFIED" || value.authority !== "LOCAL_DIAGNOSTIC" || value.origin !== "LOCAL_DIAGNOSTIC"
    || value.githubRunId !== null || value.recipeRevision !== start.recipeRevision || value.executionId !== start.executionId
    || value.originalRecipeRevision !== PIN.original.originalRecipeRevision || value.originalExecutionId !== PIN.original.originalExecutionId
    || value.copyRecipeRevision !== PIN.copyRecipeRevision || value.copyExecutionId !== PIN.copyExecutionId
    || value.copyReceiptSha256 !== PIN.copyReceiptSha256 || value.policySha256 !== PIN.original.policySha256
    || value.priorColdLoadSha256 !== PIN.priorColdLoad.sha256 || value.runtimePolicySha256 !== PIN.runtimePolicy.sha256
    || value.auditRunId !== PIN.auditRunId || value.auditRecipeRevision !== PIN.auditRecipeRevision || value.auditReceiptSha256 !== PIN.auditReceiptSha256
    || value.auditStageFinal !== "UNCHANGED" || ["imageLoad", "imageExecution", "serviceRestore", "sqlRestore"].some((name) => value[name] !== "VERIFIED")
    || value.failure !== null || value.daemonFailure !== null || value.workerFailure !== null
    || ["registryRead", "registryWrite", "signing"].some((name) => value[name] !== "NOT_ATTEMPTED")
    || value.admission !== "NOT_AUTHORIZED" || ["supportStartedAt", "supportEndsAt", "archiveUntil"].some((name) => value[name] !== null)
    || [value.startedAt, value.finishedAt].some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(date)
      || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date)
    || Date.parse(value.finishedAt) < Date.parse(value.startedAt)) fail("postgres_runtime_restore_receipt_failed");
  validatePostgresRuntimeAuditStageProof(value.auditStage, material.runtimePolicy);
  if (value.auditStage.source !== PIN.auditDirectory || value.auditStage.target !== `${start.workDirectory}/audit-evidence`) fail("postgres_runtime_restore_receipt_failed");
  const initial = validatePostgresRuntimeRestoreRootAcknowledgement(value.initialInventory, value.daemonIdentity, "VERIFIED_EMPTY");
  validatePostgresRuntimeRestoreRootAcknowledgement(value.finalInventory, value.daemonIdentity, "VERIFIED_EMPTY", initial.principalSnapshotSha256);
  if (!isDeepStrictEqual(value.daemonCleanup, { state: "STOPPED", purpose: PIN.purpose, authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    daemonId: value.daemonIdentity.daemonId, endpoint: value.daemonIdentity.endpoint, pid: value.daemonIdentity.pid,
    principalImageCount: 2, principalSnapshotSha256: initial.principalSnapshotSha256, isolatedFinalInventory: "EMPTY",
    processGone: true, socketGone: true, pidFileGone: true, privateState: "RETAINED" })) fail("postgres_runtime_restore_receipt_failed");
  if (!isDeepStrictEqual(postgresRuntimeRestoreClientIdentity(value.daemonIdentity, start.nonce), start.identity)) fail("postgres_runtime_restore_receipt_failed");
  if (!exact(value.worker, ["kind", "nonce", "recipeRevision", "executionId", "proof", "sourceBefore", "sourceAfter", "workerActor"])
    || value.worker.kind !== "RESULT" || value.worker.nonce !== start.nonce || value.worker.recipeRevision !== start.recipeRevision
    || value.worker.executionId !== start.executionId || !isDeepStrictEqual(value.worker.workerActor, { uid: 1000, gid: 1000,
      supplementalGroups: "CLEARED", inheritedCapabilities: "NONE", effectiveCapabilities: "NONE", ambientCapabilities: "NONE", noNewPrivileges: true })) fail("postgres_runtime_restore_receipt_failed");
  validatePostgresLocalRuntimeRestoreProof(value.worker.proof, postgresRuntimeRestoreEngineInput(start));
  validatePostgresSqlBackupProof(value.backupFinal, `${start.workDirectory}/backup`);
  if (!isDeepStrictEqual(value.backupFinal, value.worker.proof.backup.file)) fail("postgres_runtime_restore_receipt_failed");
  for (const seal of [value.sourceInitial, value.sourceFinal, value.worker.sourceBefore, value.worker.sourceAfter]) {
    validatePostgresPrivateCopyLinuxResult(seal, PIN.original, material.policy, material.copyReceipt.linuxFinalProof.archiveProof);
    if (!isDeepStrictEqual(seal, value.sourceInitial) || !isDeepStrictEqual({ ...seal, recipeRevision: PIN.copyRecipeRevision },
      material.copyReceipt.linuxFinalProof) || seal.recipeRevision !== start.recipeRevision) fail("postgres_runtime_restore_receipt_failed");
  }
  return value;
}
export function publishPostgresRuntimeRestoreReceipt(file, receipt, validate) {
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (process.platform !== "linux" || !Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) fail("postgres_runtime_restore_receipt_failed");
  const parentGid = uid === 0 ? 1000 : gid;
  const parent = lstatSync(path.dirname(file), { bigint: true }); const content = bytes(receipt); let fd; let own;
  try {
    if (content.length > CAP || !parent.isDirectory() || parent.isSymbolicLink() || realpathSync(path.dirname(file)) !== path.dirname(file)
      || parent.uid !== BigInt(uid) || parent.gid !== BigInt(parentGid) || (parent.mode & 0o7777n) !== 0o710n) fail();
    if (validate) validate(receipt);
    fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); own = fstatSync(fd, { bigint: true });
    writeFileSync(fd, content); fsyncSync(fd);
    const current = fstatSync(fd, { bigint: true }); const named = lstatSync(file, { bigint: true });
    if (!current.isFile() || current.uid !== BigInt(uid) || current.gid !== BigInt(gid) || current.nlink !== 1n || (current.mode & 0o7777n) !== 0o600n
      || current.dev !== own.dev || current.ino !== own.ino || !isDeepStrictEqual(current, named)) fail();
    const reread = Buffer.alloc(content.length); const count = readSync(fd, reread, 0, reread.length, 0);
    const finalParent = lstatSync(path.dirname(file), { bigint: true });
    if (count !== content.length || !reread.equals(content) || readSync(fd, Buffer.alloc(1), 0, 1, content.length) !== 0
      || !sameFile(current, fstatSync(fd, { bigint: true })) || !sameFile(current, lstatSync(file, { bigint: true }))
      || !["dev", "ino", "uid", "gid", "mode"].every((key) => parent[key] === finalParent[key])) fail();
    if (validate) validate(json(reread));
    const sealed = fstatSync(fd, { bigint: true }); const sealedNamed = lstatSync(file, { bigint: true });
    const sealedDirectory = lstatSync(path.dirname(file), { bigint: true });
    const finalBytes = Buffer.alloc(content.length);
    if (!sameFile(current, sealed) || !sameFile(sealed, sealedNamed)
      || !["dev", "ino", "uid", "gid", "mode"].every((key) => parent[key] === sealedDirectory[key])
      || readSync(fd, finalBytes, 0, finalBytes.length, 0) !== content.length || !finalBytes.equals(content)
      || !sameFile(sealed, fstatSync(fd, { bigint: true })) || !sameFile(sealed, lstatSync(file, { bigint: true }))) fail();
    closeSync(fd); fd = undefined;
    return Object.freeze({ size: content.length, sha256: sha(content) });
  } catch {
    if (own) {
      try {
        const current = lstatSync(file, { bigint: true }); const dir = lstatSync(path.dirname(file), { bigint: true });
        if (current.dev !== own.dev || current.ino !== own.ino || current.uid !== BigInt(uid) || current.gid !== BigInt(gid)
          || current.nlink !== 1n || (current.mode & 0o7777n) !== 0o600n || dir.dev !== parent.dev || dir.ino !== parent.ino) fail();
        unlinkSync(file);
      } catch { fail("postgres_runtime_restore_cleanup_uncertain"); }
    }
    fail("postgres_runtime_restore_receipt_failed");
  } finally { if (fd !== undefined) closeSync(fd); }
}
function backupSeal(proof, deadline) {
  validatePostgresSqlBackupProof(proof);
  const result = spawnSync(SETPRIV, [...DROP, PIN.node, path.join(ROOT, "scripts/postgres-image/runtime-restore-backup-seal.mjs")],
    { cwd: ROOT, env: ENV, input: bytes(proof), encoding: null, timeout: Math.min(10_000, remainingBudget(deadline)), maxBuffer: CAP, windowsHide: true });
  if (result.error || result.signal || result.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length > CAP
    || !Buffer.isBuffer(result.stderr) || result.stderr.length) fail("postgres_runtime_restore_material_invalid");
  const observed = json(result.stdout);
  if (!isDeepStrictEqual(observed, proof)) fail("postgres_runtime_restore_material_invalid");
  return observed;
}
function pinnedMaterialBytes(material) {
  const policyBytes = fixedBytes(path.join(ROOT, PIN.policyFile), 4_848, PIN.original.policySha256);
  const copyBytes = fixedBytes(PIN.copyReceiptFile, PIN.copyReceiptBytes, PIN.copyReceiptSha256);
  const runtimeBytes = fixedBytes(path.join(ROOT, PIN.runtimePolicy.file), PIN.runtimePolicy.size, PIN.runtimePolicy.sha256);
  const observed = authenticatePostgresRuntimeRestoreMaterial(policyBytes, copyBytes, runtimeBytes);
  if (material && !isDeepStrictEqual(observed, material)) fail("postgres_runtime_restore_material_invalid");
  authenticatePriorPostgresColdLoad(fixedBytes(PIN.priorColdLoad.file, PIN.priorColdLoad.size, PIN.priorColdLoad.sha256), observed, policyBytes, copyBytes);
  return { policyBytes, copyBytes, runtimeBytes, material: observed };
}
export async function runLocalPostgresRuntimeRestore(argv = process.argv.slice(2)) {
  if (argv.length || process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0 || process.version !== "v22.23.2"
    || ["GITHUB_ACTIONS", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH"]
      .some((name) => Object.hasOwn(process.env, name))) fail();
  for (const file of [SETPRIV, PIN.node, "/usr/bin/git", "/usr/bin/docker", "/usr/bin/dockerd"]) installed(file);
  const deadline = Date.now() + LIMITS.supervisorMs; const recipeRevision = sourceRevision(deadline); const startedAt = new Date().toISOString();
  const { policyBytes, copyBytes, runtimeBytes, material } = pinnedMaterialBytes();
  const sourceInitial = materialSeal(recipeRevision, material, deadline); remainingBudget(deadline);
  const parent = mkdtempSync("/var/tmp/aw-pr-"); chownSync(parent, 0, 1000); chmodSync(parent, 0o710);
  const workDirectory = path.join(parent, "work");
  const nonce = randomBytes(12).toString("hex"); const executionId = `local-pg-restore-${nonce}`;
  let lease; let start; let initialInventory; let finalInventory; let daemonCleanup; let worker; let sourceFinal; let auditStage; let backupFinal;
  let primaryFailure; let daemonFailure; let workerFailure; let auditStageFinal; let phase = "AUDIT";
  const stageOptions = { directory: path.join(workDirectory, "audit-evidence"), policy: material.runtimePolicy, workspace: ROOT, deadline };
  try {
    remainingBudget(deadline);
    preflightLocalPostgresRuntimeAudit({ source: PIN.auditDirectory, policy: material.runtimePolicy, workspace: ROOT, deadline });
    phase = "DAEMON";
    const primaryInfo = json(output("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", "info", "--format", "{{json .}}"],
      { ...ENV, HOME: parent, DOCKER_CONFIG: parent }, Math.min(10_000, remainingBudget(deadline))));
    if (primaryInfo.ID !== "a827b675-0ff5-4a75-ab42-cca1bdd1eb53") fail("postgres_runtime_restore_daemon_failed");
    const principal = { id: primaryInfo.ID, root: primaryInfo.DockerRootDir, containerdAddress: primaryInfo.Containerd?.Address,
      containersNamespace: primaryInfo.Containerd?.Namespaces?.Containers, pluginsNamespace: primaryInfo.Containerd?.Namespaces?.Plugins, imageIds: FOREIGN };
    lease = await startPostgresRuntimeDaemonLease({ purpose: PIN.purpose, parent, nonce, principal, candidate: { imageId: PIN.imageId, tag: PIN.tag } });
    remainingBudget(deadline);
    initialInventory = validatePostgresRuntimeRestoreRootAcknowledgement(await lease.verifyInventory("EMPTY"), lease.identity, "VERIFIED_EMPTY");
    // The lease creates only its infrastructure in a proven empty parent. No candidate exists yet.
    mkdirSync(workDirectory, { mode: 0o700 }); chownSync(workDirectory, 1000, 1000); chmodSync(workDirectory, 0o700);
    phase = "AUDIT";
    auditStage = stagePostgresRuntimeAudit({ source: PIN.auditDirectory, target: stageOptions.directory, policy: material.runtimePolicy, workspace: ROOT, deadline });
    replayLocalPostgresRuntimeAudit(auditStage, { policy: material.runtimePolicy, workspace: ROOT, deadline });
    start = { kind: "START", nonce, recipeRevision, executionId, identity: postgresRuntimeRestoreClientIdentity(lease.identity, nonce),
      policyBytesBase64: policyBytes.toString("base64"), copyReceiptBytesBase64: copyBytes.toString("base64"), runtimePolicyBytesBase64: runtimeBytes.toString("base64"),
      workDirectory, auditReceiptSha256: PIN.auditReceiptSha256 };
    phase = "WORKER"; worker = await runWorker(start, lease, initialInventory, auditStage, material, deadline);
    phase = "FINAL_SEAL"; remainingBudget(deadline); sourceFinal = materialSeal(recipeRevision, material, deadline);
    if (!isDeepStrictEqual(sourceInitial, sourceFinal) || sourceRevision(deadline) !== recipeRevision) fail("postgres_runtime_restore_material_invalid");
    sealPostgresRuntimeAuditStage(stageOptions, auditStage); backupFinal = backupSeal(worker.proof.backup.file, deadline);
    finalInventory = validatePostgresRuntimeRestoreRootAcknowledgement(await lease.verifyInventory("EMPTY"), lease.identity, "VERIFIED_EMPTY", initialInventory.principalSnapshotSha256);
    remainingBudget(deadline);
  } catch (error) {
    primaryFailure = postgresRuntimeRestoreSupervisorFailureDiagnostic(error, phase);
    if (phase === "DAEMON") daemonFailure = postgresRuntimeDaemonFailureDiagnostic(error);
    try { if (error?.workerFailure) workerFailure = validatePostgresLocalRuntimeRestoreFailureDiagnostic(error.workerFailure); }
    catch { /* Preserve only the closed failure vocabulary. */ }
  }
  if (lease) {
    const cleanupDeadline = Date.now() + LIMITS.daemonCleanupMs;
    try { daemonCleanup = await lease.stop({ requireEmpty: !primaryFailure }); }
    catch (error) { daemonFailure = postgresRuntimeDaemonFailureDiagnostic(error); primaryFailure = postgresRuntimeRestoreSupervisorFailureDiagnostic(new Error("postgres_runtime_restore_cleanup_uncertain"), "CLEANUP"); }
    if (!primaryFailure) {
      try {
        phase = "FINAL_SEAL"; remainingBudget(cleanupDeadline);
        sourceFinal = materialSeal(recipeRevision, material, cleanupDeadline);
        if (!isDeepStrictEqual(sourceInitial, sourceFinal) || sourceRevision(cleanupDeadline) !== recipeRevision) fail("postgres_runtime_restore_material_invalid");
        pinnedMaterialBytes(material);
        sealPostgresRuntimeAuditStage({ ...stageOptions, deadline: cleanupDeadline }, auditStage); auditStageFinal = "UNCHANGED";
        backupFinal = backupSeal(worker.proof.backup.file, cleanupDeadline); remainingBudget(cleanupDeadline);
      } catch (error) { primaryFailure = postgresRuntimeRestoreSupervisorFailureDiagnostic(error, "FINAL_SEAL"); }
    }
  }
  const receipt = { schemaVersion: 1, kind: "POSTGRES_LOCAL_RUNTIME_SQL_RESTORE_RECEIPT_V1", state: primaryFailure ? "INCOMPLETE" : "VERIFIED",
    authority: "LOCAL_DIAGNOSTIC", origin: "LOCAL_DIAGNOSTIC", executionId, githubRunId: null, recipeRevision,
    originalRecipeRevision: PIN.original.originalRecipeRevision, originalExecutionId: PIN.original.originalExecutionId,
    copyRecipeRevision: PIN.copyRecipeRevision, copyExecutionId: PIN.copyExecutionId, copyReceiptSha256: PIN.copyReceiptSha256,
    policySha256: PIN.original.policySha256, priorColdLoadSha256: PIN.priorColdLoad.sha256, runtimePolicySha256: PIN.runtimePolicy.sha256,
    auditRunId: PIN.auditRunId, auditRecipeRevision: PIN.auditRecipeRevision, auditReceiptSha256: PIN.auditReceiptSha256,
    auditStage: auditStage ?? null, auditStageFinal: auditStageFinal ?? null, backupFinal: backupFinal ?? null,
    startedAt, finishedAt: new Date().toISOString(), daemonIdentity: lease?.identity ?? null,
    initialInventory: initialInventory ?? null, finalInventory: finalInventory ?? null, daemonCleanup: daemonCleanup ?? null, worker: worker ?? null,
    sourceInitial, sourceFinal: sourceFinal ?? null, imageLoad: primaryFailure ? "NOT_VERIFIED" : "VERIFIED",
    imageExecution: primaryFailure ? "NOT_VERIFIED" : "VERIFIED", serviceRestore: primaryFailure ? "NOT_VERIFIED" : "VERIFIED", sqlRestore: primaryFailure ? "NOT_VERIFIED" : "VERIFIED",
    registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null, failure: primaryFailure ?? null, daemonFailure: daemonFailure ?? null, workerFailure: workerFailure ?? null };
  const written = publishPostgresRuntimeRestoreReceipt(path.join(parent, "receipt.json"), receipt,
    primaryFailure ? undefined : (v) => validatePostgresLocalRuntimeRestoreReceipt(v, start, material));
  if (primaryFailure) fail(primaryFailure.code);
  return Object.freeze({ state: receipt.state, authority: receipt.authority, admission: receipt.admission, executionId,
    recipeRevision, privateRoot: parent, receipt: written, daemonCleanup, imageExecution: receipt.imageExecution, sqlRestore: receipt.sqlRestore });
}
function remainingBudget(deadline) {
  const value = deadline - Date.now();
  if (!Number.isSafeInteger(value) || value < 1) fail("postgres_runtime_restore_control_invalid");
  return value;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalPostgresRuntimeRestore().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(JSON.stringify({ state: "INCOMPLETE", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
      ...postgresRuntimeRestoreSupervisorFailureDiagnostic(error) })); process.exitCode = 1;
  });
}
