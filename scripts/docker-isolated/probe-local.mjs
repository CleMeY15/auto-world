import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, closeSync, fsyncSync, lstatSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalDaemonHelper } from "./daemon-helper.mjs";
import { localDaemonFailureDiagnostic, startLocalDaemonLease } from "./daemon-local.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DOCKER = "/usr/bin/docker";
const PRINCIPAL = "unix:///var/run/docker.sock";
const FOREIGN_IMAGES = [
  "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537",
  "sha256:1105aaf5e7223aac9caeb251ff2ad4eb09d9f4d97ba4e5afde52e0f017f848aa",
].sort();
const CAP = 1024 ** 2;
function fail() { throw new Error("daemon_local_context_invalid"); }
function output(command, args, options) {
  const result = spawnSync(command, args, { ...options, encoding: null, timeout: 15_000, maxBuffer: CAP });
  if (result.error || result.signal || result.status !== 0 || result.stderr?.length
    || !Buffer.isBuffer(result.stdout) || result.stdout.length > CAP) fail();
  return result.stdout;
}
function sourceRevision() {
  if (lstatSync(ROOT).uid !== 1000) fail();
  const git = (args) => output("/usr/sbin/runuser", ["-u", "autoworld", "--", "/usr/bin/git", "-C", ROOT, ...args],
    { env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin" } }).toString("utf8").trim();
  const revision = git(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(revision) || git(["status", "--porcelain", "--untracked-files=normal"]) !== "") fail();
  return revision;
}
function writeReceipt(file, receipt) {
  const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
export async function runLocalDaemonProbe(argv = process.argv.slice(2)) {
  if (argv.length !== 0 || process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0
    || process.version !== "v22.23.2" || ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"].some((key) => Object.hasOwn(process.env, key))) fail();
  const recipeRevision = sourceRevision();
  const parent = mkdtempSync("/var/tmp/aw-dp-");
  const nonce = randomBytes(12).toString("hex");
  const environment = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    TZ: "UTC", HOME: parent, DOCKER_CONFIG: parent });
  const info = JSON.parse(output(DOCKER, ["--host", PRINCIPAL, "info", "--format", "{{json .}}"],
    { env: environment }));
  const principal = { id: info.ID, root: info.DockerRootDir, containerdAddress: info.Containerd?.Address,
    containersNamespace: info.Containerd?.Namespaces?.Containers,
    pluginsNamespace: info.Containerd?.Namespaces?.Plugins, imageIds: FOREIGN_IMAGES };
  const startedAt = new Date().toISOString();
  const helper = createLocalDaemonHelper();
  let lease; let verification; let cleanup; let primaryFailure;
  try {
    lease = await startLocalDaemonLease({ purpose: "EMPTY_DAEMON_PROBE", parent, nonce, principal },
      { helper, env: { PATH: "/usr/bin:/bin" } });
    verification = await lease.verify();
    await lease.runner(DOCKER, ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"]);
    await lease.runner(DOCKER, ["image", "ls", "--all", "--quiet", "--no-trunc"]);
    await lease.runner(DOCKER, ["container", "ls", "--all", "--quiet", "--no-trunc"]);
    await lease.runner(DOCKER, ["volume", "ls", "--quiet"]);
  } catch (error) { primaryFailure = error; }
  if (lease) {
    try { cleanup = await lease.stop(); }
    catch (error) { primaryFailure = error; }
  }
  const binary = readFileSync("/usr/bin/dockerd");
  const receipt = {
    schemaVersion: 1, kind: "LOCAL_EMPTY_DAEMON_PROBE_RECEIPT_V1",
    state: primaryFailure ? "INCOMPLETE" : "VERIFIED", executionId: "local-" + nonce,
    githubRunId: null, recipeRevision, authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    imageExecution: "NOT_ATTEMPTED", registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED",
    startedAt, finishedAt: new Date().toISOString(),
    dockerdBinary: { version: "28.0.4", sha256: createHash("sha256").update(binary).digest("hex"), size: binary.length },
    identity: lease?.identity ?? null, verification: verification ?? null, cleanup: cleanup ?? null,
    failure: primaryFailure ? localDaemonFailureDiagnostic(primaryFailure) : null,
  };
  const identity = writeReceipt(path.join(parent, "receipt.json"), receipt);
  if (primaryFailure) throw primaryFailure;
  return Object.freeze({ state: receipt.state, authority: receipt.authority, admission: receipt.admission,
    executionId: receipt.executionId, recipeRevision, receipt: identity, privateRoot: parent,
    imageExecution: receipt.imageExecution, verification, cleanup });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalDaemonProbe().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(JSON.stringify({ state: "INCOMPLETE", ...localDaemonFailureDiagnostic(error),
      authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED" })); process.exitCode = 1; });
}
