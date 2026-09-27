import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { retainLocalSeaweedCandidate, validateLocalSeaweedRetentionReceipt } from "./candidate-local-retention.mjs";
import { publicLocalRestoreFailure, restoreLocalSeaweedCandidate } from "./candidate-local-restore.mjs";
import { validateRemoteSeaweedCandidatePolicy } from "./candidate-remote.mjs";
import { validatePublishedCandidateBinding, validateRemoteAuditFilesystem,
  validateRemoteAuditRuntimeConfig } from "./candidate-remote-audit.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MiB = 1024 ** 2;
function fail() { throw new Error("seaweed_local_diagnostic_input_invalid"); }

export function requirePrivateLocalDirectory(directory) {
  try {
    const info = lstatSync(directory);
    if (!path.isAbsolute(directory) || path.normalize(directory) !== directory
      || realpathSync(directory) !== directory || !info.isDirectory() || info.isSymbolicLink()
      || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) fail();
    return directory;
  } catch { fail(); }
}

export function readLocalEvidence(file, cap) {
  let handle;
  try {
    requirePrivateLocalDirectory(path.dirname(file));
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(handle); const node = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid()
      || (before.mode & 0o777) !== 0o600 || node.isSymbolicLink()
      || before.dev !== node.dev || before.ino !== node.ino || before.size < 2 || before.size > cap) fail();
    const bytes = readFileSync(handle); const after = fstatSync(handle); const final = lstatSync(file);
    if (bytes.length !== before.size || [after, final].some((info) => info.dev !== before.dev
      || info.ino !== before.ino || info.size !== before.size || info.mtimeMs !== before.mtimeMs
      || info.ctimeMs !== before.ctimeMs || info.nlink !== 1)) fail();
    return bytes;
  } catch { fail(); }
  finally { if (handle !== undefined) closeSync(handle); }
}

function git(args) {
  const response = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 30_000,
    maxBuffer: MiB, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C.UTF-8" } });
  if (response.status !== 0 || response.error) fail();
  return response.stdout;
}
function committed(file, gitCommand = git) { return Buffer.from(gitCommand(["show", `HEAD:${file}`])); }
function json(bytes) { try { return JSON.parse(bytes.toString("utf8")); } catch { fail(); } }

function inputs(gitCommand) {
  if (gitCommand(["status", "--porcelain", "--untracked-files=normal"]).trim() !== "") fail();
  const recipeRevision = gitCommand(["rev-parse", "HEAD"]).trim();
  if (!/^[0-9a-f]{40}$/u.test(recipeRevision)) fail();
  const policy = validateRemoteSeaweedCandidatePolicy(json(committed("infra/seaweed-image/candidate-remote.json", gitCommand)));
  validatePublishedCandidateBinding(policy, committed("infra/seaweed-image/candidate-publication-receipt.json", gitCommand));
  return { recipeRevision, policy, baseline: json(committed("infra/seaweed-image/base-config.json", gitCommand)).config };
}

function auditInputs(directory, gitCommand) {
  requirePrivateLocalDirectory(directory);
  const read = (name, cap = 4 * MiB) => readLocalEvidence(path.join(directory, name), cap);
  return {
    runtimePolicy: json(committed("infra/seaweed-image/candidate-remote-runtime.json", gitCommand)),
    receiptBytes: read("audit-receipt.json"),
    vulnerabilityBytes: read("candidate-vulnerabilities.json", 64 * MiB),
    cyclonedxBytes: read("candidate-sbom.cdx.json", 64 * MiB),
    databaseEvidenceBytes: read("database-evidence.json"),
    databaseManifestBytes: Object.fromEntries(["vulnerability", "java"].flatMap((database) =>
      ["before", "after"].map((checkpoint) => [`${database}-${checkpoint}`,
        read(`database-${database}-${checkpoint}-manifest.json`, MiB)]))),
  };
}

async function tokenFromStdin() {
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 8192) fail();
    chunks.push(Buffer.from(chunk));
  }
  const token = Buffer.concat(chunks).toString("utf8").trim();
  if (!token || /\s/u.test(token)) fail();
  return token;
}

function publishReservedReceipt(handle, file, receipt) {
  const before = fstatSync(handle); const node = lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid()
    || (before.mode & 0o777) !== 0o600 || before.size !== 0
    || before.dev !== node.dev || before.ino !== node.ino || node.isSymbolicLink()) fail();
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(handle, bytes, offset, bytes.length - offset, offset);
    if (written < 1) fail();
    offset += written;
  }
  fsyncSync(handle);
  const final = lstatSync(file);
  if (final.dev !== before.dev || final.ino !== before.ino
    || !readLocalEvidence(file, MiB).equals(bytes)) fail();
  const directory = openSync(path.dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export async function runLocalDiagnostic(argv = process.argv.slice(2), dependencies = {}) {
  const [operation, directory, auditDirectory] = argv;
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== undefined
    || !["retain", "restore"].includes(operation)
    || argv.length !== (operation === "retain" ? 2 : 3)) fail();
  if (!dependencies || Object.keys(dependencies).some((key) => !["git", "readToken", "retain", "restore"].includes(key))
    || Object.values(dependencies).some((value) => typeof value !== "function")) fail();
  const gitCommand = dependencies.git ?? git;
  requirePrivateLocalDirectory(directory);
  const input = inputs(gitCommand);
  if (path.basename(directory) !== `seaweed-candidate-${input.policy.manifest.digest.replace(":", "-")}`) fail();
  // Numeric IDs are only correlations required by the shared diagnostic verifiers.
  // The outer receipts explicitly identify local execution and never a GitHub run.
  const runId = `${Date.now()}${randomInt(100000, 1000000)}`;
  const parent = path.join(directory, `${operation}-work-${runId}`);
  if (operation === "retain") {
    const destination = path.join(directory, "image");
    const token = await (dependencies.readToken ?? tokenFromStdin)();
    if (typeof token !== "string" || !token || token.length > 8192 || /\s/u.test(token)) fail();
    mkdirSync(parent, { mode: 0o700 }); mkdirSync(destination, { mode: 0o700 });
    const result = await (dependencies.retain ?? retainLocalSeaweedCandidate)({ parent, destination, policy: input.policy,
      runId, recipeRevision: input.recipeRevision, signal: undefined,
      validateFilesystem: (entries) => validateRemoteAuditFilesystem(entries, input.policy),
      validateRuntimeConfig: (config) => validateRemoteAuditRuntimeConfig(config, input.baseline) },
    { providerDependencies: { env: { PATH: process.env.PATH, HOME: parent,
      DOCKER_HOST: "unix:///var/run/docker.sock", GITHUB_TOKEN: token } } });
    return result.receipt;
  }
  if (process.env.GH_TOKEN !== undefined || process.env.GITHUB_TOKEN !== undefined) fail();
  const image = path.join(directory, "image");
  const retained = validateLocalSeaweedRetentionReceipt(
    json(readLocalEvidence(path.join(image, "retention-receipt.json"), MiB)), input.policy);
  const material = retained.remoteMaterialReceipt;
  const auditEvidence = auditInputs(auditDirectory, gitCommand);
  const runtimeReceipt = json(committed("infra/seaweed-image/candidate-remote-runtime-receipt.json", gitCommand));
  // Reserve the receipt first: never overwrite earlier evidence or run without a writable destination.
  const output = path.join(directory, "restore-receipt.json");
  const handle = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    mkdirSync(parent, { mode: 0o700 });
    const receipt = await (dependencies.restore ?? restoreLocalSeaweedCandidate)({ parent, archiveFile: path.join(image, "candidate.tar"),
      archiveSha256: material.archive.archiveSha256, archiveBytes: material.archive.archiveBytes,
      archiveTag: material.alias, policy: input.policy, baseline: input.baseline, auditEvidence,
      runtimeReceipt, runId, recipeRevision: input.recipeRevision, signal: undefined });
    publishReservedReceipt(handle, output, receipt);
    return receipt;
  } catch (error) {
    const failed = { ...publicLocalRestoreFailure(error),
      executionId: `local-${runId}`, githubRunId: null };
    if (fstatSync(handle).size === 0) publishReservedReceipt(handle, output, failed);
    throw error;
  } finally { closeSync(handle); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalDiagnostic().then((receipt) => console.log(JSON.stringify(receipt)))
    .catch(() => { console.error(JSON.stringify({ state: "INCOMPLETE", origin: "LOCAL_DIAGNOSTIC",
      candidateAuthorization: "NOT_AUTHORIZED", reason: "LOCAL_DIAGNOSTIC_FAILED" })); process.exitCode = 1; });
}
