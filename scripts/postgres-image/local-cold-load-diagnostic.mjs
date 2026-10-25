import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, chownSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdtempSync,
  openSync, readFileSync, readlinkSync, readSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { startColdLoadDaemonLease, coldLoadDaemonFailureDiagnostic } from "../docker-isolated/daemon-cold-load.mjs";
import { validatePostgresCandidateColdLoadProof } from "./candidate-local-cold-load.mjs";
import { authenticateColdLoadMaterial, coldLoadEngineInput } from "./cold-load-input.mjs";
import { COLD_LOAD_PIN as PIN } from "./cold-load-policy.mjs";
import { assertColdLoadWriterHealthy, coldLoadFrameReader, coldLoadParentControl, writeColdLoadFrame } from "./cold-load-protocol.mjs";
import { validateColdLoadWorkerStatus } from "./cold-load-worker.mjs";
import { validatePostgresPrivateCopyLinuxResult } from "./private-copy-linux.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKER = path.join(ROOT, "scripts/postgres-image/cold-load-worker.mjs");
const SETPRIV = "/usr/bin/setpriv";
const CAP = 65_536;
const FOREIGN = ["sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537",
  "sha256:1105aaf5e7223aac9caeb251ff2ad4eb09d9f4d97ba4e5afde52e0f017f848aa"].sort();
const ENV = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: "/home/autoworld" });
const DROP = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
const PHASES = ["CONTEXT", "MATERIAL", "DAEMON", "WORKER", "FINAL_SEAL", "CLEANUP", "RECEIPT"];
const CODES = new Set(["postgres_cold_load_context_invalid", "postgres_cold_load_material_invalid", "postgres_cold_load_control_invalid",
  "postgres_cold_load_worker_failed", "postgres_cold_load_daemon_failed", "postgres_cold_load_cleanup_uncertain", "postgres_cold_load_receipt_failed"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, fields) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...fields].sort());
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code = "postgres_cold_load_context_invalid") => { throw new Error(code); };
const bytes = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
function json(value) { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)); } catch { fail(); } }
export function coldLoadSupervisorFailureDiagnostic(error, phase = "CONTEXT") {
  let code = "postgres_cold_load_context_invalid";
  try { const message = error?.message; if (CODES.has(message)) code = message; } catch { /* No arbitrary errors/output. */ }
  return Object.freeze({ code, phase: PHASES.includes(phase) ? phase : "CONTEXT" });
}
function installed(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0
    || (stat.mode & 0o111) === 0 || realpathSync(file) !== file) fail();
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
      || named.isSymbolicLink() || realpathSync(file) !== file || !sameFile(before, named)) fail("postgres_cold_load_material_invalid");
    const content = readFileSync(fd);
    if (content.length !== size || sha(content) !== expectedSha || !sameFile(before, fstatSync(fd, { bigint: true }))
      || !sameFile(before, lstatSync(file, { bigint: true }))) fail("postgres_cold_load_material_invalid");
    return content;
  } finally { closeSync(fd); }
}
function sameFile(a, b) {
  return ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].every((key) => a[key] === b[key]);
}
export function coldLoadClientIdentity(value, nonce) {
  const fields = ["purpose", "authority", "admission", "root", "socket", "endpoint", "dockerConfig", "contextName", "pid", "startTicks", "daemonId",
    "version", "dataRoot", "execRoot", "containerdAddress", "containersNamespace", "pluginsNamespace", "configSha256", "argvSha256",
    "rootActor", "clientActor", "socketProof", "socketDirectoryProof"];
  if (!exact(value, fields) || value.purpose !== "COLD_LOAD_ONLY" || value.authority !== "LOCAL_DIAGNOSTIC"
    || value.admission !== "NOT_AUTHORIZED" || !isDeepStrictEqual(value.rootActor, { uid: 0, gid: 0 })
    || !isDeepStrictEqual(value.clientActor, { uid: 1000, gid: 1000 })
    || value.socketProof?.uid !== 0 || value.socketProof?.gid !== 1000 || value.socketProof?.mode !== 0o660
    || value.socketDirectoryProof?.uid !== 0 || value.socketDirectoryProof?.gid !== 1000 || value.socketDirectoryProof?.mode !== 0o710
    || !Number.isSafeInteger(value.pid) || value.pid < 2 || typeof value.startTicks !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value.startTicks)
    || value.version !== "28.0.4" || ![value.configSha256, value.argvSha256].every((hash) => typeof hash === "string" && /^[0-9a-f]{64}$/u.test(hash))
    || typeof value.root !== "string" || !/^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u.test(value.root)
    || value.socket !== `${value.root}/endpoint/docker.sock` || value.endpoint !== `unix://${value.socket}`
    || value.dataRoot !== `${value.root}/infra/data` || value.execRoot !== `${value.root}/infra/exec`
    || value.dockerConfig !== `${value.root}/client` || value.containerdAddress !== "/run/containerd/containerd.sock"
    || typeof value.daemonId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/u.test(value.daemonId)
    || typeof value.contextName !== "string" || !/^aw-cold-[0-9a-f]{24}$/u.test(value.contextName)
    || value.containersNamespace !== `awcold-${value.contextName.slice(8)}` || value.pluginsNamespace !== `plugins.awcold-${value.contextName.slice(8)}`
    || nonce !== undefined && (typeof nonce !== "string" || !/^[0-9a-f]{24}$/u.test(nonce) || value.contextName !== `aw-cold-${nonce}`)) fail();
  for (const proof of [value.socketProof, value.socketDirectoryProof]) {
    if (!exact(proof, ["dev", "ino", "uid", "gid", "mode"]) || ![proof.dev, proof.ino].every((n) => typeof n === "string" && /^[1-9][0-9]{0,19}$/u.test(n))) fail();
  }
  return Object.freeze({ endpoint: value.endpoint, daemonId: value.daemonId, dataRoot: value.dataRoot,
    containerdAddress: value.containerdAddress, containersNamespace: value.containersNamespace, pluginsNamespace: value.pluginsNamespace,
    dockerConfig: value.dockerConfig, contextName: value.contextName, socket: value.socketProof, socketDirectory: value.socketDirectoryProof });
}
export function validateColdLoadRootAcknowledgement(value, identity, state, principalSha) {
  if (!["VERIFIED", "VERIFIED_EMPTY"].includes(state)) fail("postgres_cold_load_daemon_failed");
  const counts = state === "VERIFIED_EMPTY" ? { images: 0, containers: 0, volumes: 0 } : {};
  const expected = { state, purpose: "COLD_LOAD_ONLY", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    daemonId: identity.daemonId, endpoint: identity.endpoint, pid: identity.pid, principalImageCount: 2,
    principalSnapshotSha256: principalSha ?? value?.principalSnapshotSha256, ...counts };
  if (typeof expected.principalSnapshotSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(expected.principalSnapshotSha256)
    || !isDeepStrictEqual(value, expected)) fail("postgres_cold_load_daemon_failed");
  return value;
}
function materialSeal(recipeRevision, material, deadline) {
  const value = json(output(SETPRIV, [...DROP, PIN.node, path.join(ROOT, "scripts/postgres-image/private-copy-linux.mjs"), "seal", PIN.directory], ENV,
    deadline ? Math.min(30_000, remainingBudget(deadline)) : 30_000));
  validatePostgresPrivateCopyLinuxResult(value, PIN.original, material.policy, material.copyReceipt.linuxFinalProof.archiveProof);
  if (!isDeepStrictEqual({ ...value, recipeRevision: PIN.copyRecipeRevision }, material.copyReceipt.linuxFinalProof)
    || value.recipeRevision !== recipeRevision) fail("postgres_cold_load_material_invalid");
  return value;
}
function childProcessProof(pid) {
  const root = `/proc/${pid}`;
  const stat = readFileSync(path.join(root, "stat"), "utf8");
  const parts = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
  return { startTicks: parts[19], status: readFileSync(path.join(root, "status"), "utf8"),
    executable: readlinkSync(path.join(root, "exe")), argv: readFileSync(path.join(root, "cmdline")).toString("utf8").split("\0") };
}
export function validateColdLoadWorkerProcess(value, pid, expectedStartTicks, parentPid) {
  if (!Number.isSafeInteger(parentPid) || parentPid < 2 || !plain(value) || !/^[1-9][0-9]{0,19}$/u.test(value.startTicks ?? "") || value.startTicks !== expectedStartTicks
    || value.executable !== PIN.node || !isDeepStrictEqual(value.argv, [PIN.node, WORKER, ""])
    || !new RegExp(`^PPid:\\s+${parentPid}\\s*$`, "mu").test(value.status ?? "")) fail("postgres_cold_load_control_invalid");
  return validateColdLoadWorkerStatus(value.status, pid);
}
async function runWorker(start, lease, initial, deadline) {
  const child = spawn(SETPRIV, [...DROP, PIN.node, WORKER], { cwd: ROOT,
    env: { ...ENV, DOCKER_CONFIG: start.identity.dockerConfig }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let exit; let childError; let stderrBytes = 0; let startTicks; let timer;
  const exited = new Promise((resolve) => {
    child.once("error", () => { childError = true; resolve(); });
    child.once("close", (status, signal) => { exit = { status, signal }; resolve(); });
  });
  child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
  child.stderr.on("error", () => { childError = true; });
  const reader = coldLoadFrameReader(child.stdout); const control = coldLoadParentControl(start.nonce, start.identity);
  const remaining = () => { const value = deadline - Date.now(); if (value < 1) fail("postgres_cold_load_control_invalid"); return value; };
  try {
    if (!Number.isSafeInteger(child.pid) || child.pid < 2) fail("postgres_cold_load_worker_failed");
    startTicks = childProcessProof(child.pid).startTicks;
    timer = setTimeout(() => {
      try { if (childProcessProof(child.pid).startTicks === startTicks) child.kill("SIGKILL"); } catch { /* Never signal a replacement PID. */ }
      reader.close();
    }, remaining());
    await writeColdLoadFrame(child.stdin, start);
    for (;;) {
      const frame = await reader.next(Math.min(30_000, remaining()));
      if (stderrBytes || childError) fail("postgres_cold_load_worker_failed");
      if (frame.kind === "REQUEST") {
        const grant = control.accept(frame);
        validateColdLoadWorkerProcess(childProcessProof(child.pid), child.pid, startTicks, process.pid);
        const observed = await lease.verifyIdentity();
        validateColdLoadRootAcknowledgement(observed, lease.identity, "VERIFIED", initial.principalSnapshotSha256);
        validateColdLoadWorkerProcess(childProcessProof(child.pid), child.pid, startTicks, process.pid);
        reader.assertReadyToReply();
        await writeColdLoadFrame(child.stdin, grant, () => reader.allowNext());
      } else {
        if (!exact(frame, ["kind", "nonce", "recipeRevision", "executionId", "proof", "sourceBefore", "sourceAfter", "workerActor"])
          || frame.kind !== "RESULT" || frame.nonce !== start.nonce || frame.recipeRevision !== start.recipeRevision
          || frame.executionId !== start.executionId) fail("postgres_cold_load_worker_failed");
        control.assertComplete();
        const input = coldLoadEngineInput(start); validatePostgresCandidateColdLoadProof(frame.proof, input);
        if (!isDeepStrictEqual(frame.workerActor, validateColdLoadWorkerProcess(childProcessProof(child.pid), child.pid, startTicks, process.pid))) fail();
        reader.assertReadyToReply();
        await writeColdLoadFrame(child.stdin, { kind: "FINISH", nonce: start.nonce, recipeRevision: start.recipeRevision, executionId: start.executionId });
        child.stdin.end();
        await exited; clearTimeout(timer); remaining();
        if (childError || exit?.status !== 0 || exit?.signal || stderrBytes) fail("postgres_cold_load_worker_failed");
        reader.assertFinished(); assertColdLoadWriterHealthy(child.stdin);
        return frame;
      }
    }
  } finally {
    clearTimeout(timer); reader.close();
    try {
    if (!exit) {
      try {
        if (startTicks && childProcessProof(child.pid).startTicks === startTicks) child.kill("SIGKILL");
      } catch { /* No guessed PID or replacement-process signal. */ }
      let cleanupTimer;
      try { await Promise.race([exited, new Promise((resolve) => { cleanupTimer = setTimeout(resolve, 5_000); })]); }
      finally { clearTimeout(cleanupTimer); }
      if (!exit && !childError) fail("postgres_cold_load_cleanup_uncertain");
    }
    } finally { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
  }
}
export function validatePostgresColdLoadReceipt(value, start, material) {
  const fields = ["schemaVersion", "kind", "state", "authority", "origin", "executionId", "githubRunId", "recipeRevision",
    "originalRecipeRevision", "originalExecutionId", "copyRecipeRevision", "copyExecutionId", "copyReceiptSha256", "policySha256",
    "startedAt", "finishedAt", "daemonIdentity", "initialInventory", "finalInventory", "daemonCleanup", "worker", "sourceInitial", "sourceFinal",
    "imageLoad", "imageExecution", "serviceRestore", "sqlRestore", "registryRead", "registryWrite", "signing", "admission",
    "supportStartedAt", "supportEndsAt", "archiveUntil", "failure", "daemonFailure"];
  if (!exact(value, fields) || value.schemaVersion !== 1 || value.kind !== "POSTGRES_LOCAL_COLD_LOAD_RECEIPT_V1"
    || value.state !== "COLD_LOADED_AND_REMOVED" || value.authority !== "LOCAL_DIAGNOSTIC" || value.origin !== "LOCAL_DIAGNOSTIC"
    || value.githubRunId !== null || value.recipeRevision !== start.recipeRevision || value.executionId !== start.executionId
    || value.originalRecipeRevision !== PIN.original.originalRecipeRevision || value.originalExecutionId !== PIN.original.originalExecutionId
    || value.copyRecipeRevision !== PIN.copyRecipeRevision || value.copyExecutionId !== PIN.copyExecutionId
    || value.copyReceiptSha256 !== PIN.copyReceiptSha256 || value.policySha256 !== PIN.original.policySha256
    || value.imageLoad !== "VERIFIED" || value.failure !== null || value.daemonFailure !== null
    || ["imageExecution", "serviceRestore", "sqlRestore", "registryRead", "registryWrite", "signing"].some((name) => value[name] !== "NOT_ATTEMPTED")
    || value.admission !== "NOT_AUTHORIZED" || ["supportStartedAt", "supportEndsAt", "archiveUntil"].some((name) => value[name] !== null)
    || [value.startedAt, value.finishedAt].some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(date)
      || !Number.isFinite(Date.parse(date))) || Date.parse(value.finishedAt) < Date.parse(value.startedAt)) fail("postgres_cold_load_receipt_failed");
  const initial = validateColdLoadRootAcknowledgement(value.initialInventory, value.daemonIdentity, "VERIFIED_EMPTY");
  validateColdLoadRootAcknowledgement(value.finalInventory, value.daemonIdentity, "VERIFIED_EMPTY", initial.principalSnapshotSha256);
  if (!isDeepStrictEqual(value.daemonCleanup, { state: "STOPPED", purpose: "COLD_LOAD_ONLY", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    daemonId: value.daemonIdentity.daemonId, endpoint: value.daemonIdentity.endpoint, pid: value.daemonIdentity.pid,
    principalImageCount: 2, principalSnapshotSha256: initial.principalSnapshotSha256, isolatedFinalInventory: "EMPTY",
    processGone: true, socketGone: true, pidFileGone: true, privateState: "RETAINED" })) fail("postgres_cold_load_receipt_failed");
  if (!isDeepStrictEqual(coldLoadClientIdentity(value.daemonIdentity, start.nonce), start.identity)) fail("postgres_cold_load_receipt_failed");
  if (!exact(value.worker, ["kind", "nonce", "recipeRevision", "executionId", "proof", "sourceBefore", "sourceAfter", "workerActor"])
    || value.worker.kind !== "RESULT" || value.worker.nonce !== start.nonce || value.worker.recipeRevision !== start.recipeRevision
    || value.worker.executionId !== start.executionId || !isDeepStrictEqual(value.worker.workerActor, { uid: 1000, gid: 1000,
      supplementalGroups: "CLEARED", inheritedCapabilities: "NONE", effectiveCapabilities: "NONE", ambientCapabilities: "NONE", noNewPrivileges: true })) fail("postgres_cold_load_receipt_failed");
  validatePostgresCandidateColdLoadProof(value.worker.proof, coldLoadEngineInput(start));
  for (const seal of [value.sourceInitial, value.sourceFinal, value.worker.sourceBefore, value.worker.sourceAfter]) {
    validatePostgresPrivateCopyLinuxResult(seal, PIN.original, material.policy, material.copyReceipt.linuxFinalProof.archiveProof);
    if (!isDeepStrictEqual(seal, value.sourceInitial) || !isDeepStrictEqual({ ...seal, recipeRevision: PIN.copyRecipeRevision },
      material.copyReceipt.linuxFinalProof)) fail("postgres_cold_load_receipt_failed");
  }
  return value;
}
export function publishColdLoadReceipt(file, receipt, validate) {
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (process.platform !== "linux" || !Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) fail("postgres_cold_load_receipt_failed");
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
      } catch { fail("postgres_cold_load_cleanup_uncertain"); }
    }
    fail("postgres_cold_load_receipt_failed");
  } finally { if (fd !== undefined) closeSync(fd); }
}
export async function runLocalPostgresColdLoad(argv = process.argv.slice(2)) {
  if (argv.length || process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0 || process.version !== "v22.23.2"
    || ["GITHUB_ACTIONS", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH"]
      .some((name) => Object.hasOwn(process.env, name))) fail();
  for (const file of [SETPRIV, PIN.node, "/usr/bin/git", "/usr/bin/docker", "/usr/bin/dockerd"]) installed(file);
  const deadline = Date.now() + 300_000; const recipeRevision = sourceRevision(deadline); const startedAt = new Date().toISOString();
  const policyBytes = fixedBytes(path.join(ROOT, PIN.policyFile), 4_848, PIN.original.policySha256);
  const copyBytes = fixedBytes(PIN.copyReceiptFile, PIN.copyReceiptBytes, PIN.copyReceiptSha256);
  const material = authenticateColdLoadMaterial(policyBytes, copyBytes);
  const sourceInitial = materialSeal(recipeRevision, material, deadline); remainingBudget(deadline);
  const parent = mkdtempSync("/var/tmp/aw-cl-"); chownSync(parent, 0, 1000); chmodSync(parent, 0o710);
  const nonce = randomBytes(12).toString("hex"); const executionId = `local-cold-load-${nonce}`;
  let lease; let start; let initialInventory; let finalInventory; let daemonCleanup; let worker; let sourceFinal;
  let primaryFailure; let daemonFailure; let phase = "DAEMON";
  try {
    remainingBudget(deadline);
    const primaryInfo = json(output("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", "info", "--format", "{{json .}}"],
      { ...ENV, HOME: parent, DOCKER_CONFIG: parent }, Math.min(10_000, remainingBudget(deadline))));
    const principal = { id: primaryInfo.ID, root: primaryInfo.DockerRootDir, containerdAddress: primaryInfo.Containerd?.Address,
      containersNamespace: primaryInfo.Containerd?.Namespaces?.Containers, pluginsNamespace: primaryInfo.Containerd?.Namespaces?.Plugins, imageIds: FOREIGN };
    remainingBudget(deadline);
    lease = await startColdLoadDaemonLease({ purpose: "COLD_LOAD_ONLY", parent, nonce, principal, candidate: { imageId: PIN.imageId, tag: PIN.tag } });
    remainingBudget(deadline);
    initialInventory = validateColdLoadRootAcknowledgement(await lease.verifyInventory("EMPTY"), lease.identity, "VERIFIED_EMPTY");
    start = { kind: "START", nonce, recipeRevision, executionId, identity: coldLoadClientIdentity(lease.identity, nonce),
      policyBytesBase64: policyBytes.toString("base64"), copyReceiptBytesBase64: copyBytes.toString("base64") };
    phase = "WORKER"; worker = await runWorker(start, lease, initialInventory, deadline);
    phase = "FINAL_SEAL"; remainingBudget(deadline); sourceFinal = materialSeal(recipeRevision, material, deadline); remainingBudget(deadline);
    if (!isDeepStrictEqual(sourceInitial, sourceFinal) || sourceRevision(deadline) !== recipeRevision) fail("postgres_cold_load_material_invalid");
    finalInventory = validateColdLoadRootAcknowledgement(await lease.verifyInventory("EMPTY"), lease.identity, "VERIFIED_EMPTY", initialInventory.principalSnapshotSha256);
    remainingBudget(deadline);
  } catch (error) {
    primaryFailure = coldLoadSupervisorFailureDiagnostic(error, phase);
    if (phase === "DAEMON") daemonFailure = coldLoadDaemonFailureDiagnostic(error);
  }
  if (lease) {
    const cleanupDeadline = Date.now() + 25_000;
    try { daemonCleanup = await lease.stop({ requireEmpty: !primaryFailure }); }
    catch (error) { daemonFailure = coldLoadDaemonFailureDiagnostic(error); primaryFailure = coldLoadSupervisorFailureDiagnostic(new Error("postgres_cold_load_cleanup_uncertain"), "CLEANUP"); }
    if (!primaryFailure) {
      try {
        phase = "FINAL_SEAL"; remainingBudget(cleanupDeadline);
        sourceFinal = materialSeal(recipeRevision, material, cleanupDeadline);
        if (!isDeepStrictEqual(sourceInitial, sourceFinal) || sourceRevision(cleanupDeadline) !== recipeRevision) fail("postgres_cold_load_material_invalid");
        fixedBytes(PIN.copyReceiptFile, PIN.copyReceiptBytes, PIN.copyReceiptSha256);
        fixedBytes(path.join(ROOT, PIN.policyFile), 4_848, PIN.original.policySha256);
        remainingBudget(cleanupDeadline);
      } catch (error) { primaryFailure = coldLoadSupervisorFailureDiagnostic(error, "FINAL_SEAL"); }
    }
  }
  const receipt = { schemaVersion: 1, kind: "POSTGRES_LOCAL_COLD_LOAD_RECEIPT_V1", state: primaryFailure ? "INCOMPLETE" : "COLD_LOADED_AND_REMOVED",
    authority: "LOCAL_DIAGNOSTIC", origin: "LOCAL_DIAGNOSTIC", executionId, githubRunId: null, recipeRevision,
    originalRecipeRevision: PIN.original.originalRecipeRevision, originalExecutionId: PIN.original.originalExecutionId,
    copyRecipeRevision: PIN.copyRecipeRevision, copyExecutionId: PIN.copyExecutionId, copyReceiptSha256: PIN.copyReceiptSha256,
    policySha256: PIN.original.policySha256, startedAt, finishedAt: new Date().toISOString(), daemonIdentity: lease?.identity ?? null,
    initialInventory: initialInventory ?? null, finalInventory: finalInventory ?? null, daemonCleanup: daemonCleanup ?? null, worker: worker ?? null,
    sourceInitial, sourceFinal: sourceFinal ?? null, imageLoad: primaryFailure ? "NOT_VERIFIED" : "VERIFIED",
    imageExecution: "NOT_ATTEMPTED", serviceRestore: "NOT_ATTEMPTED", sqlRestore: "NOT_ATTEMPTED", registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED",
    signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    failure: primaryFailure ?? null, daemonFailure: daemonFailure ?? null };
  const written = publishColdLoadReceipt(path.join(parent, "receipt.json"), receipt, primaryFailure ? undefined : (v) => validatePostgresColdLoadReceipt(v, start, material));
  if (primaryFailure) fail(primaryFailure.code);
  return Object.freeze({ state: receipt.state, authority: receipt.authority, admission: receipt.admission, executionId,
    recipeRevision, privateRoot: parent, receipt: written, daemonCleanup, imageExecution: "NOT_ATTEMPTED" });
}
function remainingBudget(deadline) {
  const value = deadline - Date.now();
  if (!Number.isSafeInteger(value) || value < 1) fail("postgres_cold_load_control_invalid");
  return value;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalPostgresColdLoad().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(JSON.stringify({ state: "INCOMPLETE", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
      ...coldLoadSupervisorFailureDiagnostic(error) })); process.exitCode = 1;
  });
}
