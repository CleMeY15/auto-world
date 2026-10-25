import { spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retainLocalPostgresCandidate } from "./candidate-local-retention.mjs";
import { validatePostgresRemotePolicy } from "./candidate-remote.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MAIN = "unix:///var/run/docker.sock";
const FOREIGN = [
  "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537",
  "sha256:1105aaf5e7223aac9caeb251ff2ad4eb09d9f4d97ba4e5afde52e0f017f848aa",
].sort();
const CAP = 1024 ** 2;
// Bytes accepted on reviewed main 96cbc851; the policy's own authority label is not an authenticator.
const POLICY_SHA256 = "4dab1fdb15d6a522c8aa64ccd14c81a1c504e188609f395f62dc4a49ab56ce51";
function fail() { throw new Error("postgres_local_retention_entrypoint_invalid"); }
export function validateLocalPostgresRetentionPolicyBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > CAP
    || createHash("sha256").update(bytes).digest("hex") !== POLICY_SHA256) fail();
  return validatePostgresRemotePolicy(JSON.parse(bytes.toString("utf8")));
}
function output(command, args, env) {
  const observed = spawnSync(command, args, { env, encoding: null, timeout: 15_000, maxBuffer: CAP });
  if (observed.error || observed.signal || observed.status !== 0 || !Buffer.isBuffer(observed.stdout)
    || !Buffer.isBuffer(observed.stderr) || observed.stderr.length !== 0) fail();
  return observed.stdout;
}
function sourceRevision() {
  if (lstatSync(ROOT).uid !== process.getuid() || realpathSync(ROOT) !== ROOT) fail();
  const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  const git = (args) => output("/usr/bin/git", ["-C", ROOT, ...args], env).toString("utf8").trim();
  const revision = git(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(revision) || git(["status", "--porcelain", "--untracked-files=normal"]) !== "") fail();
  return revision;
}
function principalSnapshot(env) {
  const call = (args) => output("/usr/bin/docker", ["--host", MAIN, ...args], env);
  const info = JSON.parse(call(["info", "--format", "{{json .}}"]));
  if (info.ID !== "a827b675-0ff5-4a75-ab42-cca1bdd1eb53" || info.ServerVersion !== "28.0.4"
    || info.DockerRootDir !== "/var/lib/docker" || info.Driver !== "overlay2" || info.OSType !== "linux"
    || info.Architecture !== "x86_64" || info.Containerd?.Address !== "/run/containerd/containerd.sock"
    || info.Containerd?.Namespaces?.Containers !== "moby" || info.Containerd?.Namespaces?.Plugins !== "plugins.moby") fail();
  const images = call(["image", "ls", "--all", "--quiet", "--no-trunc"]).toString("utf8").trim().split(/\r?\n/u).sort();
  if (JSON.stringify(images) !== JSON.stringify(FOREIGN)) fail();
  for (const args of [["container", "ls", "--all", "--quiet", "--no-trunc"], ["volume", "ls", "--quiet"]]) {
    if (call(args).length !== 0) fail();
  }
  const hashes = FOREIGN.map((id) => {
    const bytes = call(["image", "inspect", "--format", "{{json .}}", id]);
    if (JSON.parse(bytes).Id !== id) fail();
    return createHash("sha256").update(bytes).digest("hex");
  });
  return createHash("sha256").update(JSON.stringify({ images, hashes })).digest("hex");
}
export async function runLocalPostgresRetention(argv = process.argv.slice(2)) {
  if (argv.length !== 0 || process.platform !== "linux" || process.getuid?.() !== 1000
    || !(process.getgid?.() > 0) || process.version !== "v22.23.2"
    || ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "GITHUB_ACTIONS"].some((key) => Object.hasOwn(process.env, key))) fail();
  const token = process.env.GITHUB_TOKEN;
  if (typeof token !== "string" || token.length < 1 || token.length > 8192) fail();
  const recipeRevision = sourceRevision();
  const policy = validateLocalPostgresRetentionPolicyBytes(readFileSync(path.join(ROOT, "infra/postgres-image/candidate-remote.json")));
  const privateRoot = mkdtempSync("/home/autoworld/pg-local-retention-");
  const parent = path.join(privateRoot, "remote"); const destination = path.join(privateRoot, "retained");
  mkdirSync(parent, { mode: 0o700 }); mkdirSync(destination, { mode: 0o700 });
  const env = Object.freeze({ PATH: "/usr/bin:/bin", HOME: privateRoot, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
    DOCKER_HOST: MAIN, GITHUB_TOKEN: token });
  const inventoryEnv = { PATH: "/usr/bin:/bin", HOME: privateRoot, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
    DOCKER_CONFIG: parent };
  const before = principalSnapshot(inventoryEnv);
  // Numeric scope is local entropy, never a GitHub run identity.
  const runId = String(randomInt(10_000_000_000_000, 99_999_999_999_999));
  const result = await retainLocalPostgresCandidate({ parent, destination, policy, runId, recipeRevision },
    { providerDependencies: { env } });
  const after = principalSnapshot(inventoryEnv);
  if (before !== after) fail();
  const receiptBytes = readFileSync(result.receiptFile);
  return Object.freeze({ state: "RETAINED", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    githubRunId: null, executionId: result.receipt.executionId, recipeRevision, privateRoot,
    archive: { size: result.receipt.archiveProof.archiveBytes, sha256: result.receipt.archiveProof.archiveSha256 },
    receipt: { size: receiptBytes.length, sha256: createHash("sha256").update(receiptBytes).digest("hex") },
    principalImageCount: 2, principalSnapshotSha256: before, imageExecution: "NOT_ATTEMPTED" });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalPostgresRetention().then((result) => console.log(JSON.stringify(result)))
    .catch(() => { console.error(JSON.stringify({ state: "INCOMPLETE", code: "postgres_local_retention_incomplete",
      authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED" })); process.exitCode = 1; });
}
