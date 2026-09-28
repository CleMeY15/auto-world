import { spawnSync } from "node:child_process";
import { constants, closeSync, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, readdirSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validatePostgresRemoteCandidateReceipt, validatePostgresRemotePolicy, validatePostgresRemotePublicationReceipt,
  withVerifiedRemotePostgresCandidate } from "./candidate-remote.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKFLOW_PATH = ".github/workflows/postgres-candidate-remote-read.yml";
const WORKFLOW_REF = `CleMeY15/auto-world/${WORKFLOW_PATH}@refs/heads/main`;
const MAIN_BRANCH_URL = "https://api.github.com/repos/CleMeY15/auto-world/branches/main";
const POLICY_PATH = "infra/postgres-image/candidate-remote.json";
const PUBLICATION_RECEIPT_PATH = "infra/postgres-image/candidate-publication-receipt.json";
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_POLICY_BYTES = 128 * 1024;
const MAX_PUBLICATION_RECEIPT_BYTES = 1024 * 1024;
const MAX_REMOTE_RECEIPT_BYTES = 256 * 1024;
const MAX_API_BYTES = 256 * 1024;
const MAIN_TIMEOUT_MS = 60_000;

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function fixedReason(error) {
  return /^postgres_remote_read_[a-z0-9_]+$/u.test(error?.message ?? "")
    || /^postgres_remote_candidate_[a-z0-9_]+$/u.test(error?.message ?? "")
    ? error.message : "postgres_remote_read_failed";
}

export function requirePostgresRemoteReadContext(env, { platform = process.platform,
  uid = process.getuid?.(), gid = process.getgid?.() } = {}) {
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_JOB !== "read" || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world"
    || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF || env.GITHUB_RUN_NUMBER !== "1"
    || env.GITHUB_RUN_ATTEMPT !== "1" || !REVISION.test(env.GITHUB_SHA ?? "")
    || !RUN_ID.test(env.GITHUB_RUN_ID ?? "") || typeof env.RUNNER_TEMP !== "string"
    || !path.isAbsolute(env.RUNNER_TEMP) || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP
    || typeof env.GITHUB_WORKSPACE !== "string" || !path.isAbsolute(env.GITHUB_WORKSPACE)
    || path.normalize(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) {
    fail("postgres_remote_read_context_invalid");
  }
  try {
    if (realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP
      || realpathSync(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) fail("postgres_remote_read_context_invalid");
  } catch { fail("postgres_remote_read_context_invalid"); }
  return Object.freeze({ root: path.join(env.RUNNER_TEMP, "postgres-candidate-remote-read-work"),
    output: path.join(env.RUNNER_TEMP, "postgres-candidate-remote-read-evidence"),
    workspace: env.GITHUB_WORKSPACE, runId: env.GITHUB_RUN_ID, recipeRevision: env.GITHUB_SHA, uid, gid });
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: null, env: options.env,
    maxBuffer: options.maxBuffer, timeout: options.timeoutMs, windowsHide: true });
}

function readBoundedRegularFile(file, maximumBytes) {
  let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(handle); const pathInfo = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || pathInfo.isSymbolicLink()
      || before.dev !== pathInfo.dev || before.ino !== pathInfo.ino
      || before.size < 2 || before.size > maximumBytes) fail("postgres_remote_read_input_invalid");
    const bytes = readFileSync(handle); const after = fstatSync(handle);
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail("postgres_remote_read_input_invalid");
    return bytes;
  } catch (error) {
    if (error?.message === "postgres_remote_read_input_invalid") throw error;
    fail("postgres_remote_read_input_invalid");
  } finally { if (handle !== undefined) closeSync(handle); }
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("postgres_remote_read_input_invalid"); }
}

async function readBoundedResponse(response) {
  if (response?.status !== 200 || !response.body) fail("postgres_remote_read_main_invalid");
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_API_BYTES) { await reader.cancel(); fail("postgres_remote_read_main_invalid"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export async function verifyPostgresRemoteReadMain(context, env, { commandRunner = defaultCommandRunner,
  fetchImpl = globalThis.fetch, timeoutMs = MAIN_TIMEOUT_MS } = {}) {
  const token = env.GITHUB_TOKEN;
  if (typeof token !== "string" || token.length < 1 || token.length > 8192 || env.GH_TOKEN !== token
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAIN_TIMEOUT_MS) {
    fail("postgres_remote_read_environment_invalid");
  }
  const commandEnv = { PATH: env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  const status = commandRunner("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: context.workspace, env: commandEnv, maxBuffer: MAX_API_BYTES, timeoutMs: 60_000 });
  const head = commandRunner("git", ["rev-parse", "HEAD"], {
    cwd: context.workspace, env: commandEnv, maxBuffer: 4096, timeoutMs: 60_000 });
  if (status?.error || status?.status !== 0 || !Buffer.isBuffer(status.stdout)
    || status.stdout.toString("utf8") !== "" || head?.error || head?.status !== 0
    || !Buffer.isBuffer(head.stdout) || head.stdout.toString("utf8").trim() !== context.recipeRevision) {
    fail("postgres_remote_read_checkout_invalid");
  }
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(MAIN_BRANCH_URL, { redirect: "error", signal: controller.signal, headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "User-Agent": "auto-world-postgres-remote-read", "X-GitHub-Api-Version": "2022-11-28",
    } });
    const branch = parseJson(await readBoundedResponse(response));
    if (branch?.name !== "main" || branch?.protected !== true || branch?.commit?.sha !== context.recipeRevision) {
      fail("postgres_remote_read_main_invalid");
    }
    return true;
  } catch (error) {
    if (error?.message === "postgres_remote_read_main_invalid") throw error;
    fail("postgres_remote_read_main_invalid");
  } finally { globalThis.clearTimeout(timer); }
}

function committedBytes(relative, maximumBytes, context, commandRunner) {
  const working = readBoundedRegularFile(path.join(ROOT, ...relative.split("/")), maximumBytes);
  const result = commandRunner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: maximumBytes + 1, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout)
    || result.stdout.length > maximumBytes || !result.stdout.equals(working)) {
    fail("postgres_remote_read_input_uncommitted");
  }
  return working;
}

function makePrivateDirectory(directory, parent, context) {
  if (path.dirname(directory) !== parent || existsSync(directory)) fail("postgres_remote_read_directory_invalid");
  mkdirSync(directory, { mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== context.uid
    || (info.mode & 0o777) !== 0o700 || realpathSync(directory) !== directory) {
    fail("postgres_remote_read_directory_invalid");
  }
}

function validateInspection(value, context, policy) {
  if (!plain(value) || typeof value.file !== "string" || !path.isAbsolute(value.file)
    || !value.file.startsWith(`${context.root}${path.sep}`) || value.policy !== policy
    || value.subject !== policy.subject || value.runId !== context.runId
    || value.recipeRevision !== context.recipeRevision || value.signal?.aborted
    || value.imageId !== policy.manifest.config.digest || !Array.isArray(value.diffIds)
    || JSON.stringify(value.diffIds) !== JSON.stringify(policy.candidate.diffIds)
    || !plain(value.archiveProof) || value.archiveProof.imageId !== value.imageId
    || JSON.stringify(value.archiveProof.diffIds) !== JSON.stringify(policy.candidate.diffIds)
    || !SHA256.test(value.archiveProof.archiveSha256 ?? "")
    || !Number.isSafeInteger(value.archiveProof.archiveBytes) || value.archiveProof.archiveBytes < 1) {
    fail("postgres_remote_read_inspection_invalid");
  }
  const info = lstatSync(value.file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== context.uid
    || (info.mode & 0o777) !== 0o600 || realpathSync(value.file) !== value.file) {
    fail("postgres_remote_read_inspection_invalid");
  }
  return Object.freeze({ state: "ARCHIVE_IDENTITY_OBSERVED", archiveSha256: value.archiveProof.archiveSha256,
    archiveBytes: value.archiveProof.archiveBytes });
}

export function validatePostgresRemoteReadReceipt(receiptInput, context, policy,
  receiptValidator = validatePostgresRemoteCandidateReceipt) {
  const receipt = receiptValidator(receiptInput, policy);
  if (!plain(receipt) || receipt.kind !== "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1"
    || receipt.state !== "VERIFIED" || receipt.authority !== "REMOTE_READ_ONLY"
    || receipt.runId !== context.runId || receipt.recipeRevision !== context.recipeRevision
    || receipt.subject !== policy.subject || receipt.publication !== "PUBLISHED_UNADMITTED"
    || receipt.registryWrite !== "NOT_ATTEMPTED" || receipt.vulnerabilityAudit !== "NOT_ATTEMPTED"
    || receipt.imageExecution !== "NOT_ATTEMPTED" || receipt.admission !== "NOT_AUTHORIZED"
    || receipt.supportStartedAt !== null || receipt.supportEndsAt !== null || receipt.archiveUntil !== null) {
    fail("postgres_remote_read_receipt_invalid");
  }
  const serialized = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (serialized.length > MAX_REMOTE_RECEIPT_BYTES
    || /(?:ghp_|github_pat_|bearer\s|authorization|password|token)[^\n]{0,256}/iu.test(serialized.toString("utf8"))) {
    fail("postgres_remote_read_receipt_invalid");
  }
  return serialized;
}

function writeReceipt(context, bytes) {
  makePrivateDirectory(context.output, path.dirname(context.output), context);
  const file = path.join(context.output, "receipt.json");
  let handle;
  try {
    handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(handle, 0o600); writeFileSync(handle, bytes);
    const info = fstatSync(handle);
    if (!info.isFile() || info.nlink !== 1 || info.uid !== context.uid || (info.mode & 0o777) !== 0o600
      || info.size !== bytes.length || info.size < 2 || info.size > MAX_REMOTE_RECEIPT_BYTES) {
      fail("postgres_remote_read_receipt_write_failed");
    }
  } catch (error) {
    if (/^postgres_remote_read_/u.test(error?.message ?? "")) throw error;
    fail("postgres_remote_read_receipt_write_failed");
  } finally { if (handle !== undefined) closeSync(handle); }
}

function failureReceipt(context, error) {
  return Buffer.from(`${JSON.stringify({ schemaVersion: 1, kind: "POSTGRES_REMOTE_READ_FAILURE_V1",
    state: "FAILED", authority: "REMOTE_READ_ONLY", runId: context.runId,
    recipeRevision: context.recipeRevision, reason: fixedReason(error), publication: "PUBLISHED_UNADMITTED",
    registryWrite: "NOT_ATTEMPTED", vulnerabilityAudit: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED",
    admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null }, null, 2)}\n`);
}

function cleanupRoot(context) {
  try {
    const info = lstatSync(context.root);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== context.uid
      || (info.mode & 0o777) !== 0o700 || realpathSync(context.root) !== context.root
      || readdirSync(context.root).length !== 0) fail("postgres_remote_read_cleanup_uncertain");
    rmdirSync(context.root);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      if (error?.message === "postgres_remote_read_cleanup_uncertain") throw error;
      fail("postgres_remote_read_cleanup_uncertain");
    }
  }
}

export function validatePostgresRemoteReadArtifact(context) {
  let entries;
  try {
    const output = lstatSync(context.output);
    if (!output.isDirectory() || output.isSymbolicLink() || output.uid !== context.uid
      || (output.mode & 0o777) !== 0o700 || realpathSync(context.output) !== context.output) {
      fail("postgres_remote_read_artifact_invalid");
    }
    entries = readdirSync(context.output);
  } catch (error) {
    if (error?.message === "postgres_remote_read_artifact_invalid") throw error;
    fail("postgres_remote_read_artifact_invalid");
  }
  if (entries.length !== 1 || entries[0] !== "receipt.json") fail("postgres_remote_read_artifact_invalid");
  const bytes = readBoundedRegularFile(path.join(context.output, "receipt.json"), MAX_REMOTE_RECEIPT_BYTES);
  const receipt = parseJson(bytes);
  if (!plain(receipt) || !["POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1", "POSTGRES_REMOTE_READ_FAILURE_V1"].includes(receipt.kind)
    || receipt.runId !== context.runId || receipt.recipeRevision !== context.recipeRevision
    || receipt.authority !== "REMOTE_READ_ONLY" || receipt.registryWrite !== "NOT_ATTEMPTED"
    || receipt.vulnerabilityAudit !== "NOT_ATTEMPTED" || receipt.imageExecution !== "NOT_ATTEMPTED"
    || receipt.admission !== "NOT_AUTHORIZED") fail("postgres_remote_read_artifact_invalid");
  return true;
}

export async function runPostgresRemoteRead(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) {
    fail("postgres_remote_read_arguments_invalid");
  }
  const context = requirePostgresRemoteReadContext(env, dependencies.context);
  if (argv[0] === "cleanup") {
    (dependencies.cleanupRoot ?? cleanupRoot)(context);
    (dependencies.validateArtifact ?? validatePostgresRemoteReadArtifact)(context);
    return Object.freeze({ state: "CLEANED", authority: "REMOTE_READ_ONLY", admission: "NOT_AUTHORIZED" });
  }
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  try {
    await (dependencies.verifyMain ?? verifyPostgresRemoteReadMain)(context, env, { commandRunner,
      fetchImpl: dependencies.fetchImpl ?? globalThis.fetch });
    makePrivateDirectory(context.root, path.dirname(context.root), context);
    const readCommitted = dependencies.readCommitted ?? committedBytes;
    const policy = (dependencies.policyValidator ?? validatePostgresRemotePolicy)(parseJson(readCommitted(
      POLICY_PATH, MAX_POLICY_BYTES, context, commandRunner)));
    (dependencies.publicationReceiptValidator ?? validatePostgresRemotePublicationReceipt)(parseJson(readCommitted(
      PUBLICATION_RECEIPT_PATH, MAX_PUBLICATION_RECEIPT_BYTES, context, commandRunner)), policy);
    const provider = dependencies.remoteProvider ?? withVerifiedRemotePostgresCandidate;
    const receipt = await provider({ parent: context.root, runId: context.runId,
      recipeRevision: context.recipeRevision, policy },
    (value) => (dependencies.inspectArchive ?? validateInspection)(value, context, policy),
    dependencies.remoteProviderDependencies);
    writeReceipt(context, validatePostgresRemoteReadReceipt(receipt, context, policy,
      dependencies.remoteReceiptValidator ?? validatePostgresRemoteCandidateReceipt));
    return receipt;
  } catch (error) {
    if (!existsSync(context.output)) writeReceipt(context, failureReceipt(context, error));
    throw error;
  }
}

function publicFailure(error) {
  return JSON.stringify({ state: "FAILED", reason: fixedReason(error), authority: "REMOTE_READ_ONLY",
    registryWrite: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresRemoteRead().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(publicFailure(error)); process.exitCode = 1; });
}

export { publicFailure as TEST_ONLY_publicPostgresRemoteReadFailure };
