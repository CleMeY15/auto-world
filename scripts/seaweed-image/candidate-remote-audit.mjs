import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync,
  realpathSync, readdirSync, rmdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { executeCandidateAudit } from "./candidate-audit.mjs";
import { validateRemoteSeaweedCandidatePolicy, validateRemoteSeaweedCandidateReceipt,
  withVerifiedRemoteSeaweedCandidate } from "./candidate-remote.mjs";
import { reviewedSeaweedSourcePolicy } from "./source-records.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/seaweed-candidate-remote-audit.yml@refs/heads/main";
const MAIN_BRANCH_URL = "https://api.github.com/repos/CleMeY15/auto-world/branches/main";
const RUNTIME_FIELDS = ["Entrypoint", "Cmd", "Env", "WorkingDir", "Volumes", "ExposedPorts"];
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const MAX_POLICY_BYTES = 64 * 1024;
const MAX_RECEIPT_BYTES = 1024 * 1024;
const MAX_API_BYTES = 256 * 1024;
const MAIN_TIMEOUT_MS = 60_000;
const PUBLISH_PHASES = ["managed_tool_identity", "checkout_identity", "registry_login",
  "candidate_materialization_and_private_copy", "copied_archive_revalidation", "local_inventory_before",
  "local_references_absent", "load_private_archive", "exact_local_image", "bootstrap_authorized_read_before",
  "bootstrap_anonymous_read_denied", "bootstrap_authorized_read_after", "remote_tag_absent",
  "protected_main_immediately_before_write", "fixed_unique_candidate_tag", "single_registry_push",
  "remote_tag_manifest", "remote_digest_manifest", "candidate_anonymous_digest_read_denied",
  "owned_docker_cleanup", "owned_temporary_cleanup"];

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function requireRemoteCandidateAuditContext(env, { platform = process.platform,
  uid = process.getuid?.(), gid = process.getgid?.() } = {}) {
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_JOB !== "audit"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !REVISION.test(env.GITHUB_SHA ?? "") || !RUN_ID.test(env.GITHUB_RUN_ID ?? "")
    || typeof env.RUNNER_TEMP !== "string" || !path.isAbsolute(env.RUNNER_TEMP)
    || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP
    || typeof env.GITHUB_WORKSPACE !== "string" || !path.isAbsolute(env.GITHUB_WORKSPACE)
    || path.normalize(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) {
    fail("seaweed_remote_audit_context_invalid");
  }
  try {
    if (realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP
      || realpathSync(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) fail("seaweed_remote_audit_context_invalid");
  } catch { fail("seaweed_remote_audit_context_invalid"); }
  return Object.freeze({
    root: path.join(env.RUNNER_TEMP, "seaweed-candidate-remote-audit-work"),
    output: path.join(env.RUNNER_TEMP, "seaweed-candidate-remote-audit-evidence"),
    builds: path.join(env.RUNNER_TEMP, "scanner-builds"), workspace: env.GITHUB_WORKSPACE,
    runId: env.GITHUB_RUN_ID, recipeRevision: env.GITHUB_SHA, uid, gid,
  });
}

function readBoundedRegularFile(file, cap) {
  let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(handle); const pathInfo = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || pathInfo.isSymbolicLink()
      || before.dev !== pathInfo.dev || before.ino !== pathInfo.ino
      || before.size < 2 || before.size > cap) fail("seaweed_remote_audit_input_invalid");
    const bytes = readFileSync(handle); const after = fstatSync(handle);
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail("seaweed_remote_audit_input_invalid");
    return bytes;
  } catch (error) {
    if (error?.message === "seaweed_remote_audit_input_invalid") throw error;
    fail("seaweed_remote_audit_input_invalid");
  } finally { if (handle !== undefined) closeSync(handle); }
}

function parseJson(bytes) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("seaweed_remote_audit_input_invalid"); }
}

export function validatePublishedCandidateBinding(policyInput, receiptBytes) {
  const policy = validateRemoteSeaweedCandidatePolicy(policyInput);
  if (!Buffer.isBuffer(receiptBytes) || receiptBytes.length < 2 || receiptBytes.length > MAX_RECEIPT_BYTES
    || sha256(receiptBytes) !== policy.publisher.receiptSha256) fail("seaweed_remote_audit_publication_invalid");
  const receipt = parseJson(receiptBytes); const candidate = receipt?.candidate;
  const remote = receipt?.remote; const source = receipt?.sourceProof;
  validatePublicationPhases(receipt?.phases, policy.publisher.result);
  if (receipt?.schemaVersion !== 1 || receipt.state !== "PUBLISHED_UNADMITTED"
    || receipt.result !== policy.publisher.result
    || receipt.publication !== "PUBLISHED_UNADMITTED" || receipt.admission !== "NOT_AUTHORIZED"
    || receipt.execution !== "NOT_ATTEMPTED" || receipt.repository !== policy.repository
    || receipt.workflowPath !== policy.publisher.workflowPath || receipt.image !== policy.image
    || receipt.platform !== policy.platform || receipt.sourceSha !== policy.publisher.recipeRevision
    || receipt.sourceRef !== "refs/heads/main" || receipt.runId !== policy.publisher.runId
    || receipt.runNumber !== policy.publisher.runNumber || receipt.runAttempt !== policy.publisher.runAttempt
    || receipt.tag !== `${policy.image}:${policy.publishedTag}` || receipt.subject !== policy.subject
    || receipt.candidateAnonymousRead !== "AUTHORIZATION_DENIED"
    || candidate?.imageId !== policy.candidate.imageId || candidate?.diffId !== policy.candidate.diffId
    || candidate?.rawSize !== policy.candidate.rawSize || candidate?.memberCount !== policy.candidate.memberCount
    || candidate?.archiveSha256 !== policy.source.archiveSha256 || candidate?.archiveBytes !== policy.source.archiveBytes
    || candidate?.configSha256 !== policy.source.configSha256 || candidate?.configBytes !== policy.source.configBytes
    || candidate?.savedLayerSha256 !== policy.source.savedLayerSha256
    || candidate?.savedLayerBytes !== policy.source.savedLayerBytes
    || candidate?.originalTag !== `auto-world-seaweed-s3:run-${policy.publisher.runId}-attempt-1`
    || candidate?.serverVersion !== "28.0.4"
    || remote?.manifestDigest !== policy.manifest.digest || remote?.manifestBytes !== policy.manifest.bytes
    || remote?.manifestMediaType !== policy.manifest.mediaType
    || remote?.configDigest !== policy.manifest.config.digest || remote?.configBytes !== policy.manifest.config.size
    || remote?.configMediaType !== policy.manifest.config.mediaType
    || remote?.layerDigest !== policy.manifest.layer.digest || remote?.layerBytes !== policy.manifest.layer.size
    || remote?.layerMediaType !== policy.manifest.layer.mediaType
    || remote?.remoteLayerVerification !== "PENDING_INDEPENDENT_READ"
    || source?.sourceRunId !== policy.source.runId || source?.sourceCodeRevision !== policy.source.codeRevision
    || source?.sourceBinaryDigest !== policy.source.binaryDigest
    || source?.baseManifestDigest !== policy.source.baseManifestDigest
    || source?.sourceArtifacts !== "AUTHENTICATED_BY_REVIEWED_MATERIALIZER_POLICY"
    || String(reviewedSeaweedSourcePolicy.runId) !== policy.source.runId
    || reviewedSeaweedSourcePolicy.sourceSha !== policy.source.codeRevision) {
    fail("seaweed_remote_audit_publication_invalid");
  }
  return Object.freeze({ policy, receipt });
}

export function validatePublicationPhases(phases, result) {
  const failedCleanup = PUBLISH_PHASES.indexOf("owned_docker_cleanup");
  if (!["PASSED", "FAILED"].includes(result) || !Array.isArray(phases)
    || !isDeepStrictEqual(phases.map((phase) => phase?.name), PUBLISH_PHASES)
    || phases.some((phase, index) => {
      const recovery = result === "FAILED" && index === failedCleanup;
      return !exactKeys(phase, recovery ? ["name", "result", "reasons", "durationMs"]
        : ["name", "result", "durationMs"])
        || phase.result !== (recovery ? "FAILED" : "PASSED")
        || recovery && !isDeepStrictEqual(phase.reasons,
          ["seaweed_candidate_publish_image_cleanup_failed"])
        || !Number.isSafeInteger(phase.durationMs) || phase.durationMs < 0 || phase.durationMs > 10_800_000;
    })) fail("seaweed_remote_audit_publication_invalid");
  return true;
}

export function validateRemoteAuditFilesystem(entries, policyInput) {
  const policy = validateRemoteSeaweedCandidatePolicy(policyInput);
  if (!Array.isArray(entries) || entries.length !== policy.candidate.memberCount
    || entries.some((entry) => !plain(entry) || typeof entry.path !== "string" || typeof entry.type !== "string")
    || entries.filter((entry) => entry.path === "usr/bin/weed" && entry.type === "file").length !== 1
    || entries.some((entry) => ["usr/bin/weed-volume", "usr/bin/weed-worker"].includes(entry.path))) {
    fail("seaweed_remote_audit_filesystem_invalid");
  }
  return true;
}

export function validateRemoteAuditRuntimeConfig(actual, baseline) {
  if (!plain(actual) || !plain(baseline) || actual.User !== ""
    || RUNTIME_FIELDS.some((field) => !Object.hasOwn(actual, field)
      || !Object.hasOwn(baseline, field) || !isDeepStrictEqual(actual[field], baseline[field]))) {
    fail("seaweed_remote_audit_runtime_invalid");
  }
  return true;
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: null, env: options.env,
    maxBuffer: options.maxBuffer, timeout: options.timeoutMs, windowsHide: true });
}

async function readBoundedResponse(response, cap) {
  if (response.status !== 200 || !response.body) fail("seaweed_remote_audit_main_invalid");
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { await reader.cancel(); fail("seaweed_remote_audit_main_invalid"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
}

export async function verifyRemoteAuditMain(context, env, { commandRunner = defaultCommandRunner,
  fetchImpl = globalThis.fetch, timeoutMs = MAIN_TIMEOUT_MS } = {}) {
  const token = env.GITHUB_TOKEN;
  if (typeof token !== "string" || token.length < 1 || token.length > 8192
    || env.GH_TOKEN !== token || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAIN_TIMEOUT_MS) {
    fail("seaweed_remote_audit_environment_invalid");
  }
  const result = commandRunner("git", ["rev-parse", "HEAD"], { cwd: context.workspace,
    env: { PATH: env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, maxBuffer: 4096, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0
    || !Buffer.isBuffer(result.stdout) || result.stdout.toString("utf8").trim() !== context.recipeRevision) {
    fail("seaweed_remote_audit_checkout_invalid");
  }
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
  try {
    const response = await fetchImpl(MAIN_BRANCH_URL, { redirect: "error", signal: controller.signal, headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "User-Agent": "auto-world-seaweed-remote-audit", "X-GitHub-Api-Version": "2022-11-28",
    } });
    const branch = parseJson(await readBoundedResponse(response, MAX_API_BYTES));
    if (branch?.name !== "main" || branch?.protected !== true
      || branch?.commit?.sha !== context.recipeRevision) fail("seaweed_remote_audit_main_invalid");
    return true;
  } catch (error) {
    if (error?.message === "seaweed_remote_audit_main_invalid") throw error;
    fail("seaweed_remote_audit_main_invalid");
  } finally { globalThis.clearTimeout(timer); }
}

function committedBytes(relative, cap, context, commandRunner) {
  const file = path.join(ROOT, ...relative.split("/")); const working = readBoundedRegularFile(file, cap);
  const result = commandRunner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, maxBuffer: cap + 1, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout)
    || result.stdout.length > cap || !result.stdout.equals(working)) fail("seaweed_remote_audit_input_uncommitted");
  return working;
}

function cleanupEmptyRoot(context) {
  try {
    const info = lstatSync(context.root);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== context.uid
      || (info.mode & 0o777) !== 0o700 || realpathSync(context.root) !== context.root
      || readdirSync(context.root).length !== 0) fail("seaweed_remote_audit_cleanup_uncertain");
    rmdirSync(context.root);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    if (error?.message === "seaweed_remote_audit_cleanup_uncertain") throw error;
    fail("seaweed_remote_audit_cleanup_uncertain");
  }
}

export async function runRemoteCandidateAudit(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) fail("seaweed_remote_audit_arguments_invalid");
  const context = requireRemoteCandidateAuditContext(env, dependencies.context);
  if (argv[0] === "cleanup") {
    (dependencies.cleanup ?? cleanupEmptyRoot)(context);
    return { state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" };
  }
  const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
  await (dependencies.verifyMain ?? verifyRemoteAuditMain)(context, env, { commandRunner,
    fetchImpl: dependencies.fetchImpl ?? globalThis.fetch });
  const readCommitted = dependencies.readCommitted ?? committedBytes;
  const policyBytes = readCommitted("infra/seaweed-image/candidate-remote.json", MAX_POLICY_BYTES, context, commandRunner);
  const receiptBytes = readCommitted("infra/seaweed-image/candidate-publication-receipt.json", MAX_RECEIPT_BYTES, context, commandRunner);
  const baseBytes = readCommitted("infra/seaweed-image/base-config.json", MAX_RECEIPT_BYTES, context, commandRunner);
  const { policy } = validatePublishedCandidateBinding(parseJson(policyBytes), receiptBytes);
  const baseline = parseJson(baseBytes)?.config;
  if (!plain(baseline)) fail("seaweed_remote_audit_input_invalid");
  const provider = dependencies.remoteProvider ?? withVerifiedRemoteSeaweedCandidate;
  const receiptValidator = dependencies.remoteReceiptValidator ?? validateRemoteSeaweedCandidateReceipt;
  const materialize = ({ parent, runId, recipeRevision, signal }, inspect) => provider({
    parent, policy, runId, recipeRevision, signal,
    validateFilesystem: (entries) => validateRemoteAuditFilesystem(entries, policy),
    validateRuntimeConfig: (config) => validateRemoteAuditRuntimeConfig(config, baseline),
  }, inspect, dependencies.remoteProviderDependencies);
  const validateCandidateReceipt = (receipt, proof, receiptContext) => {
    receiptValidator(receipt, policy);
    if (receiptContext?.runId !== context.runId || receiptContext?.recipeRevision !== context.recipeRevision
      || receipt.runId !== receiptContext.runId || receipt.recipeRevision !== receiptContext.recipeRevision
      || receipt.subject !== policy.subject || receipt.publisher?.result !== policy.publisher.result) {
      fail("seaweed_remote_audit_candidate_receipt_invalid");
    }
    if (receipt.image?.imageId !== proof?.imageId || receipt.image?.diffId !== proof?.diffId
      || receipt.archive?.imageId !== proof?.imageId || receipt.archive?.diffId !== proof?.diffId
      || receipt.archive?.archiveSha256 !== proof?.archiveSha256
      || receipt.archive?.archiveBytes !== proof?.archiveBytes) fail("seaweed_remote_audit_candidate_receipt_invalid");
    return true;
  };
  const runAudit = dependencies.executeAudit ?? executeCandidateAudit;
  return runAudit(context, { ...(dependencies.auditDependencies ?? {}),
    auditKind: "SEAWEED_EXACT_REMOTE_CANDIDATE_AUDIT_V1", materialize, validateCandidateReceipt });
}

function publicFailure(error) {
  const code = /^seaweed_remote_audit_[a-z0-9_]+$/u.test(error?.message ?? "")
    ? error.message : "seaweed_remote_audit_failed";
  return JSON.stringify({ state: "FAILED", code, candidateAuthorization: "NOT_AUTHORIZED" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRemoteCandidateAudit().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(publicFailure(error)); process.exitCode = 1; });
}

export { publicFailure as TEST_ONLY_publicRemoteAuditFailure };
