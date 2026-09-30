import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { realpathSync, statfsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import { PRIVATE_COPY_PIN as PIN } from "./private-copy-policy.mjs";
import { validateLocalPostgresRetentionPolicyBytes } from "./local-retention-diagnostic.mjs";
import { validatePostgresPrivateCopyLinuxResult } from "./private-copy-linux.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LINUX_ROOT = "/opt/auto-world/checkouts/pr108-nonroot";
const LINUX_NODE = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
const WSL = "C:\\Windows\\System32\\wsl.exe";
const GIT = "C:\\Program Files\\Git\\cmd\\git.exe";
const POWERSHELL = "C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\native\\powershell\\pwsh.exe";
const HELPER = path.join(ROOT, "scripts/postgres-image/private-copy-windows.ps1");
const CAP = 64 * 1024;
const TIMEOUT = 3 * 60_000;
const PHASES = ["source_export_and_windows_copy", "windows_export_and_linux_reimport", "final_seals"];
const REVISION = /^[0-9a-f]{40}$/u;
const SCOPE = /^[0-9a-f]{24}$/u;
const fail = () => { throw new Error("postgres_private_copy_incomplete"); };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exact = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const env = () => ({ SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", TEMP: process.env.TEMP, TMP: process.env.TMP,
  PATH: "C:\\Windows\\System32;C:\\Windows" });
const linuxCommand = (command, args) => ({ command: WSL, args: ["-d", "Ubuntu-24.04", "-u", "autoworld", "--exec",
  "/usr/bin/env", "-i", "PATH=/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin:/usr/bin:/bin",
  "HOME=/home/autoworld", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC", command, ...args] });
const worker = (operation) => linuxCommand(LINUX_NODE, [`${LINUX_ROOT}/scripts/postgres-image/private-copy-linux.mjs`, operation]);
const helper = (operation, scope, extra = []) => ({ command: POWERSHELL, args: ["-NoProfile", "-NonInteractive", "-File",
  HELPER, "-Operation", operation, "-Scope", scope, ...extra] });
function syncOutput(command, args) {
  const result = spawnSync(command, args, { env: env(), cwd: ROOT, windowsHide: true, encoding: null, timeout: 15_000, maxBuffer: CAP });
  if (result.error || result.signal || result.status !== 0 || !Buffer.isBuffer(result.stdout)
    || !Buffer.isBuffer(result.stderr) || result.stderr.length !== 0) fail();
  return result.stdout.toString("utf8").trim();
}
function sourceRevision() {
  if (realpathSync(ROOT) !== ROOT) fail();
  const revision = syncOutput(GIT, ["-C", ROOT, "rev-parse", "HEAD"]);
  if (!REVISION.test(revision) || syncOutput(GIT, ["-C", ROOT, "status", "--porcelain", "--untracked-files=normal"]) !== "") fail();
  for (const args of [["rev-parse", "HEAD"], ["status", "--porcelain", "--untracked-files=normal"]]) {
    const command = linuxCommand("/usr/bin/git", ["-C", LINUX_ROOT, ...args]);
    if (syncOutput(command.command, command.args) !== (args[0] === "rev-parse" ? revision : "")) fail();
  }
  return revision;
}
function json(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > CAP) fail();
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(); }
}

// Counts and hashes the binary protocol independently of either subprocess.
export function privateCopyByteGuard(files = PIN.files) {
  let index = 0; let offset = 0; let digest = createHash("sha256");
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        if (!Buffer.isBuffer(chunk)) fail();
        let position = 0;
        while (position < chunk.length) {
          if (index >= files.length) fail();
          const consumed = Math.min(chunk.length - position, files[index].size - offset);
          if (consumed < 1) fail();
          digest.update(chunk.subarray(position, position + consumed)); offset += consumed; position += consumed;
          if (offset === files[index].size) {
            if (digest.digest("hex") !== files[index].sha256) fail();
            index += 1; offset = 0; digest = createHash("sha256");
          }
        }
        callback(null, chunk);
      } catch { callback(new Error("postgres_private_copy_incomplete")); }
    },
    flush(callback) { callback(index === files.length && offset === 0 ? null : new Error("postgres_private_copy_incomplete")); },
  });
}
function child(spec, signal) {
  const processChild = spawn(spec.command, spec.args, { env: env(), cwd: ROOT, windowsHide: true, shell: false,
    stdio: ["pipe", "pipe", "pipe"], signal });
  const done = new Promise((resolve, reject) => {
    processChild.once("error", () => reject(new Error("postgres_private_copy_incomplete")));
    processChild.once("close", (code, killed) => code === 0 && killed === null ? resolve() : reject(new Error("postgres_private_copy_incomplete")));
  });
  // Consumers attach after both children exist; observe early spawn errors immediately.
  done.catch(() => {});
  return { processChild, done };
}
function collect(stream, signal) {
  return (async () => {
    const chunks = []; let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (!Buffer.isBuffer(chunk) || size > CAP || signal.aborted) fail();
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  })();
}
async function stopClients(controller, children, tasks) {
  controller.abort();
  for (const child of children) {
    // These are exact ChildProcess handles created here; never search for or kill an unrelated PID.
    try { if (child.processChild.exitCode === null) child.processChild.kill("SIGKILL"); } catch { /* Report uncertainty below. */ }
    for (const stream of [child.processChild.stdin, child.processChild.stdout, child.processChild.stderr]) stream.destroy();
  }
  let timer;
  try {
    await Promise.race([Promise.allSettled(tasks), new Promise((resolve) => { timer = setTimeout(resolve, 5_000); })]);
  } finally { globalThis.clearTimeout(timer); }
  // WSL client termination cannot, by itself, prove that its Linux worker has stopped.
}
export async function pipePrivateCopyBytes(sourceSpec, destinationSpec, files = PIN.files, timeout = TIMEOUT) {
  const controller = new globalThis.AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  const source = child(sourceSpec, controller.signal); const destination = child(destinationSpec, controller.signal);
  source.processChild.stdin.on("error", () => controller.abort()); source.processChild.stdin.end();
  const tasks = [source.done, destination.done,
    pipeline(source.processChild.stdout, privateCopyByteGuard(files), destination.processChild.stdin, { signal: controller.signal }),
    collect(source.processChild.stderr, controller.signal), collect(destination.processChild.stdout, controller.signal),
    collect(destination.processChild.stderr, controller.signal)];
  try {
    const result = await Promise.all(tasks);
    return { sourceMetadata: result[3], destinationMetadata: result[4], destinationErrors: result[5] };
  } catch {
    await stopClients(controller, [source, destination], tasks); fail();
  } finally { globalThis.clearTimeout(timer); }
}
async function invoke(spec, input = Buffer.alloc(0), timeout = TIMEOUT) {
  const controller = new globalThis.AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  const running = child(spec, controller.signal);
  running.processChild.stdin.on("error", () => controller.abort());
  running.processChild.stdin.end(input);
  const tasks = [running.done, collect(running.processChild.stdout, controller.signal), collect(running.processChild.stderr, controller.signal)];
  try {
    const result = await Promise.all(tasks);
    if (result[2].length !== 0) fail();
    return json(result[1]);
  } catch { await stopClients(controller, [running], tasks); fail(); }
  finally { globalThis.clearTimeout(timer); }
}

function receiptFile(value, expectedSize, expectedHash, expectedId) {
  if (!exact(value, ["name", "size", "sha256", "fileId", "ownerSid", "protectedAcl", "nlink"])
    || value.name !== "copy-receipt.json" || value.size !== expectedSize || value.sha256 !== expectedHash
    || !/^[0-9a-f]{16}$/u.test(value.fileId) || value.ownerSid !== PIN.windowsSid
    || value.protectedAcl !== true || value.nlink !== 1 || expectedId !== undefined && value.fileId !== expectedId) fail();
  return value;
}
export async function publishPrivateCopyReceipt(bytes, scope, windowsProof, call = invoke) {
  validatePrivateCopyWindowsProof(windowsProof, scope);
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > CAP) fail();
  // The empty exclusive slot is identified before any successful receipt bytes are written.
  const prepared = await call(helper("PreparePublish", scope));
  if (!exact(prepared, ["kind", "state", "directoryFileId", "file"])
    || prepared.kind !== "WINDOWS_PRIVATE_COPY_PREPARATION_V1" || prepared.state !== "PREPARED"
    || prepared.directoryFileId !== windowsProof.directoryFileId) fail();
  receiptFile(prepared.file, 0, sha(Buffer.alloc(0)));
  if (windowsProof.files.some((file) => file.fileId === prepared.file.fileId)
    || prepared.file.fileId === windowsProof.directoryFileId) fail();
  const identityArgs = ["-ExpectedFileId", prepared.file.fileId, "-ExpectedDirectoryFileId", windowsProof.directoryFileId];
  try {
    const published = await call(helper("Publish", scope, [...identityArgs,
      "-ExpectedSha256", sha(bytes), "-ExpectedBytes", String(bytes.length)]), bytes);
    if (!exact(published, ["kind", "state", "directoryFileId", "file"])
      || published.kind !== "WINDOWS_PRIVATE_COPY_PUBLICATION_V1" || published.state !== "PUBLISHED"
      || published.directoryFileId !== windowsProof.directoryFileId) fail();
    receiptFile(published.file, bytes.length, sha(bytes), prepared.file.fileId);
    return published;
  } catch {
    let cleanup = "UNCERTAIN";
    try {
      const removed = await call(helper("AbortPublish", scope, identityArgs), Buffer.alloc(0), 10_000);
      if (exact(removed, ["kind", "state", "directoryFileId", "fileId"])
        && removed.kind === "WINDOWS_PRIVATE_COPY_ABORT_V1" && ["REMOVED", "NOT_PRESENT"].includes(removed.state)
        && removed.directoryFileId === windowsProof.directoryFileId && removed.fileId === prepared.file.fileId) cleanup = "RECEIPT_REMOVED";
    } catch { /* No foreign-path fallback. Preserve diagnostic state when identity is uncertain. */ }
    throw Object.assign(new Error("postgres_private_copy_incomplete"), { receiptCleanup: cleanup });
  }
}

export function validatePrivateCopyWindowsProof(value, scope, previous) {
  if (!SCOPE.test(scope) || !exact(value, ["kind", "state", "directory", "ownerSid", "volumeSerial", "directoryFileId",
    "protectedAcl", "ntfs", "reparse", "files"]) || value.kind !== "WINDOWS_PRIVATE_COPY_PROOF_V1" || value.state !== "SEALED"
    || value.directory !== `${PIN.windowsParent}\\postgres-0045bdab5483336d-copy-${scope}` || value.ownerSid !== PIN.windowsSid
    || !/^[0-9a-f]{8}$/u.test(value.volumeSerial) || !/^[0-9a-f]{16}$/u.test(value.directoryFileId)
    || value.protectedAcl !== true || value.ntfs !== true || value.reparse !== false
    || !Array.isArray(value.files) || value.files.length !== 2 || value.files.some((file, index) => {
      const expected = PIN.files[index];
      return !exact(file, ["name", "size", "sha256", "fileId", "ownerSid", "protectedAcl", "nlink"])
        || file.name !== expected.name || file.size !== expected.size || file.sha256 !== expected.sha256
        || !/^[0-9a-f]{16}$/u.test(file.fileId) || file.ownerSid !== PIN.windowsSid || file.protectedAcl !== true || file.nlink !== 1;
    }) || new Set(value.files.map((file) => file.fileId)).size !== 2
    || value.files.some((file) => file.fileId === value.directoryFileId) || previous && !isDeepStrictEqual(value, previous)) fail();
  return value;
}
export function validatePostgresLocalPrivateCopyReceipt(value, policy, proof) {
  const keys = ["kind", "state", "authority", "origin", "executionId", "githubRunId", "recipeRevision", "originalRecipeRevision",
    "originalExecutionId", "policySha256", "subject", "imageId", "diffIds", "originalFiles", "windowsProof", "linuxSourceProof",
    "linuxImportProof", "linuxFinalProof", "registryRead", "registryWrite", "imageExecution", "imageRestore", "sqlRestore", "signing", "admission",
    "supportStartedAt", "supportEndsAt", "archiveUntil", "phases"];
  if (!exact(value, keys) || value.kind !== "POSTGRES_LOCAL_PRIVATE_COPY_RECEIPT_V1" || value.state !== "COPIED_AND_REIMPORTED"
    || value.authority !== "LOCAL_DIAGNOSTIC" || value.origin !== "LOCAL_DIAGNOSTIC" || value.githubRunId !== null
    || typeof value.executionId !== "string" || !/^local-copy-[0-9a-f]{24}$/u.test(value.executionId)
    || !REVISION.test(value.recipeRevision) || value.originalRecipeRevision !== PIN.originalRecipeRevision
    || value.originalExecutionId !== PIN.originalExecutionId || value.policySha256 !== PIN.policySha256
    || value.subject !== policy.subject || value.imageId !== policy.candidate.imageId
    || !isDeepStrictEqual(value.diffIds, policy.candidate.diffIds) || !isDeepStrictEqual(value.originalFiles, PIN.files)
    || ["registryRead", "registryWrite", "imageExecution", "imageRestore", "sqlRestore", "signing"].some((key) => value[key] !== "NOT_ATTEMPTED")
    || value.admission !== "NOT_AUTHORIZED" || ["supportStartedAt", "supportEndsAt", "archiveUntil"].some((key) => value[key] !== null)
    || !Array.isArray(value.phases) || value.phases.length !== PHASES.length || value.phases.some((phase, index) =>
      !exact(phase, ["name", "result", "durationMs"]) || phase.name !== PHASES[index] || phase.result !== "PASSED"
      || !Number.isSafeInteger(phase.durationMs) || phase.durationMs < 0 || phase.durationMs > TIMEOUT)) fail();
  validatePrivateCopyWindowsProof(value.windowsProof, value.executionId.slice("local-copy-".length));
  validatePostgresPrivateCopyLinuxResult(value.linuxSourceProof, PIN, policy, proof);
  validatePostgresPrivateCopyLinuxResult(value.linuxImportProof, PIN, policy, proof);
  validatePostgresPrivateCopyLinuxResult(value.linuxFinalProof, PIN, policy, proof);
  if (value.linuxSourceProof.operation !== "EXPORT" || value.linuxImportProof.operation !== "IMPORT"
    || value.linuxSourceProof.recipeRevision !== value.recipeRevision || value.linuxImportProof.recipeRevision !== value.recipeRevision
    || !isDeepStrictEqual(value.linuxSourceProof.sourceFiles, value.linuxImportProof.sourceFiles)
    || !isDeepStrictEqual(value.linuxSourceProof.archiveProof, value.linuxImportProof.archiveProof)
    || value.linuxFinalProof.operation !== "SEAL"
    || !isDeepStrictEqual({ ...value.linuxFinalProof, operation: "IMPORT" }, value.linuxImportProof)) fail();
  return value;
}
export async function runLocalPostgresPrivateCopy(argv = process.argv.slice(2)) {
  if (argv.length !== 0 || process.platform !== "win32" || process.version !== "v22.23.2"
    || ["GITHUB_ACTIONS", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"].some((key) => Object.hasOwn(process.env, key))) fail();
  const recipeRevision = sourceRevision();
  if (syncOutput(POWERSHELL, ["-Version"]) !== "PowerShell 7.6.5") fail();
  const capacity = statfsSync(PIN.windowsParent, { bigint: true });
  if (capacity.bavail * capacity.bsize < BigInt(PIN.totalBytes * 2 + 1024 ** 3)) fail();
  const policy = validateLocalPostgresRetentionPolicyBytes(readFileSync(path.join(ROOT, "infra/postgres-image/candidate-remote.json")));
  const scope = randomBytes(12).toString("hex"); const phases = [];
  let start = performance.now();
  const first = await pipePrivateCopyBytes(worker("export"), helper("Receive", scope));
  if (first.destinationErrors.length !== 0) fail();
  const source = json(first.sourceMetadata);
  validatePostgresPrivateCopyLinuxResult(source, PIN, policy, source.archiveProof);
  if (source.operation !== "EXPORT" || source.recipeRevision !== recipeRevision) fail();
  const windowsProof = validatePrivateCopyWindowsProof(json(first.destinationMetadata), scope);
  phases.push({ name: PHASES[0], result: "PASSED", durationMs: Math.ceil(performance.now() - start) });
  start = performance.now();
  const second = await pipePrivateCopyBytes(helper("Export", scope), worker("import"));
  if (second.sourceMetadata.length !== 0 || second.destinationErrors.length !== 0) fail();
  const imported = json(second.destinationMetadata);
  validatePostgresPrivateCopyLinuxResult(imported, PIN, policy, source.archiveProof);
  if (imported.operation !== "IMPORT" || imported.recipeRevision !== recipeRevision
    || !isDeepStrictEqual(imported.sourceFiles, source.sourceFiles)) fail();
  phases.push({ name: PHASES[1], result: "PASSED", durationMs: Math.ceil(performance.now() - start) });
  start = performance.now();
  validatePrivateCopyWindowsProof(await invoke(helper("Seal", scope)), scope, windowsProof);
  const linuxFinal = await invoke(linuxCommand(LINUX_NODE, [`${LINUX_ROOT}/scripts/postgres-image/private-copy-linux.mjs`, "seal", imported.directory]));
  validatePostgresPrivateCopyLinuxResult(linuxFinal, PIN, policy, source.archiveProof);
  if (linuxFinal.operation !== "SEAL" || !isDeepStrictEqual({ ...linuxFinal, operation: "IMPORT" }, imported)) fail();
  if (sourceRevision() !== recipeRevision) fail();
  phases.push({ name: PHASES[2], result: "PASSED", durationMs: Math.ceil(performance.now() - start) });
  const receipt = { kind: "POSTGRES_LOCAL_PRIVATE_COPY_RECEIPT_V1", state: "COPIED_AND_REIMPORTED", authority: "LOCAL_DIAGNOSTIC",
    origin: "LOCAL_DIAGNOSTIC", executionId: `local-copy-${scope}`, githubRunId: null, recipeRevision,
    originalRecipeRevision: PIN.originalRecipeRevision, originalExecutionId: PIN.originalExecutionId, policySha256: PIN.policySha256,
    subject: policy.subject, imageId: policy.candidate.imageId, diffIds: policy.candidate.diffIds, originalFiles: PIN.files,
    windowsProof, linuxSourceProof: source, linuxImportProof: imported, linuxFinalProof: linuxFinal,
    registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED", imageRestore: "NOT_ATTEMPTED",
    sqlRestore: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null, phases };
  validatePostgresLocalPrivateCopyReceipt(receipt, policy, source.archiveProof);
  const bytes = Buffer.from(`${JSON.stringify(receipt)}\n`); if (bytes.length > CAP) fail();
  await publishPrivateCopyReceipt(bytes, scope, windowsProof);
  return { state: "COPIED_AND_REIMPORTED", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", executionId: receipt.executionId,
    recipeRevision, windowsDirectory: windowsProof.directory, linuxDirectory: imported.directory,
    archive: { size: PIN.files[0].size, sha256: PIN.files[0].sha256 },
    retentionReceipt: { size: PIN.files[1].size, sha256: PIN.files[1].sha256 }, copyReceipt: { size: bytes.length, sha256: sha(bytes) } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalPostgresPrivateCopy().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(JSON.stringify({ state: "INCOMPLETE", code: "postgres_private_copy_incomplete",
      authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", clientCleanup: "NOT_ESTABLISHED",
      receiptCleanup: ["RECEIPT_REMOVED", "UNCERTAIN"].includes(error?.receiptCleanup) ? error.receiptCleanup : "NOT_ATTEMPTED" })); process.exitCode = 1; });
}
