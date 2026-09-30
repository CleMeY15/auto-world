import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { verifyLocalPostgresRuntimeAndSqlRestore, postgresLocalRuntimeRestoreFailureDiagnostic } from "./candidate-local-runtime-restore.mjs";
import { postgresRuntimeRestoreEngineInput } from "./runtime-restore-input.mjs";
import { POSTGRES_RUNTIME_RESTORE_PIN as PIN } from "./runtime-restore-policy.mjs";
import { assertPostgresRuntimeRestoreWriterHealthy, postgresRuntimeRestoreFrameReader, postgresRuntimeRestoreWorkerControl, validatePostgresRuntimeRestoreStart,
  writePostgresRuntimeRestoreFrame } from "./runtime-restore-protocol.mjs";
import { sealPostgresPrivateCopy } from "./private-copy-linux.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const fail = () => { throw new Error("postgres_runtime_restore_control_invalid"); };
export function validatePostgresRuntimeRestoreWorkerStatus(raw, pid) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > 16_384 || !Number.isSafeInteger(pid) || pid < 2) fail();
  const field = (name) => {
    const found = new RegExp(`^${name}:\\s*([^\\n]+)$`, "mu").exec(raw);
    if (!found) fail(); return found[1].trim();
  };
  if (field("Pid") !== String(pid) || !["Uid", "Gid"].every((name) => /^1000\s+1000\s+1000\s+1000$/u.test(field(name)))
    || !["CapInh", "CapPrm", "CapEff", "CapAmb"].every((name) => /^0{16}$/u.test(field(name)))
    || field("NoNewPrivs") !== "1") fail();
  const groups = /^Groups:[ \t]*([^\n]*)$/mu.exec(raw)?.[1].trim();
  if (groups === undefined || groups !== "" && groups !== "1000") fail();
  return Object.freeze({ uid: 1000, gid: 1000, supplementalGroups: "CLEARED", inheritedCapabilities: "NONE",
    effectiveCapabilities: "NONE", ambientCapabilities: "NONE", noNewPrivileges: true });
}
function sourceRevision() {
  if (lstatSync(ROOT).uid !== 1000) fail();
  const git = (args) => {
    const result = spawnSync("/usr/bin/git", ["-C", ROOT, ...args], { env: { PATH: "/usr/bin:/bin" },
      encoding: null, timeout: 10_000, maxBuffer: 65_536, windowsHide: true });
    if (result.error || result.signal || result.status !== 0 || result.stderr?.length || !Buffer.isBuffer(result.stdout)) fail();
    return result.stdout.toString("utf8").trim();
  };
  const revision = git(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(revision) || git(["status", "--porcelain", "--untracked-files=normal"]) !== "") fail();
  return revision;
}
export async function runPostgresRuntimeRestoreWorker(argv = process.argv.slice(2)) {
  if (argv.length || process.platform !== "linux" || process.getuid?.() !== 1000 || process.getgid?.() !== 1000
    || process.version !== "v22.23.2" || process.getgroups().some((gid) => gid !== 1000)
    || ["GITHUB_ACTIONS", "DOCKER_HOST", "DOCKER_CONTEXT", "NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH"]
      .some((name) => Object.hasOwn(process.env, name))) fail();
  const actor = validatePostgresRuntimeRestoreWorkerStatus(readFileSync("/proc/self/status", "utf8"), process.pid);
  const recipeRevision = sourceRevision(); const reader = postgresRuntimeRestoreFrameReader(process.stdin);
  let start;
  try {
    start = validatePostgresRuntimeRestoreStart(await reader.next());
    if (start.recipeRevision !== recipeRevision || process.env.DOCKER_CONFIG !== start.identity.dockerConfig) fail();
    const input = postgresRuntimeRestoreEngineInput(start);
    const value = { pin: PIN.original, policy: input.policy, recipeRevision };
    const before = await sealPostgresPrivateCopy(value, PIN.directory);
    const control = postgresRuntimeRestoreWorkerControl(start.nonce, input.identity, reader, process.stdout, input.auditReceiptSha256);
    // START has been consumed. Subsequent inbound metadata consists solely of GRANTs.
    reader.allowNext();
    const proof = await verifyLocalPostgresRuntimeAndSqlRestore(input, { authorize: control.authorize, beforeExecution: control.beforeExecution });
    const after = await sealPostgresPrivateCopy(value, PIN.directory);
    if (!isDeepStrictEqual(before, after) || sourceRevision() !== recipeRevision) fail();
    reader.allowNext();
    await writePostgresRuntimeRestoreFrame(process.stdout, { kind: "RESULT", nonce: start.nonce, recipeRevision,
      executionId: start.executionId, proof, sourceBefore: before, sourceAfter: after, workerActor: actor });
    // Stay alive until the root supervisor has observed this actual process and accepted its result.
    const finish = await reader.next();
    if (!isDeepStrictEqual(finish, { kind: "FINISH", nonce: start.nonce, recipeRevision, executionId: start.executionId })) fail();
    assertPostgresRuntimeRestoreWriterHealthy(process.stdout);
  } catch (error) {
    if (start) {
      try { await writePostgresRuntimeRestoreFrame(process.stdout, { kind: "FAILURE", nonce: start.nonce,
        diagnostic: postgresLocalRuntimeRestoreFailureDiagnostic(error) }); } catch { /* The parent observes failed framing/exit. */ }
    }
    throw new Error("postgres_runtime_restore_worker_failed", { cause: error });
  } finally { reader.close(); process.stdin.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresRuntimeRestoreWorker().catch(() => { process.exitCode = 1; });
}
