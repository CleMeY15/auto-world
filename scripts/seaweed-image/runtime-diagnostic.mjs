import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { isPublicSeaweedRuntimePhase, isPublicSeaweedRuntimeReason,
  validateSeaweedRuntimeProfileProof } from "./candidate-runtime.mjs";
import { isPublicCandidateFailureCode,
  materializeAndVerifyLocalSeaweedRuntimeCandidate } from "./materialize-candidate.mjs";
import { baseMaterialIdentities } from "./plan.mjs";
import { reviewedSeaweedSourcePolicy } from "./source-records.mjs";

const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/seaweed-runtime-candidate.yml@refs/heads/main";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX = /^[0-9a-f]{64}$/u;
const SOURCE_BINARY_DIGEST = "sha256:45e99f08ca1b6f50826512368c73d9541ff9572795e0e12435bbfd46e1bbb9ef";
const CLI_PHASES = new Set(["CONTEXT", "TEMP_CLEANUP", "CANDIDATE_MATERIALIZE",
  "CANDIDATE_ARCHIVE", "CANDIDATE_IMAGE_CLEANUP", "CANDIDATE_TRANSACTION"]);
const validImageId = (value) => typeof value === "string" && SHA256.test(value);
const validRunId = (value) => typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value);
const validRevision = (value) => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);

function fail(code) { return Object.assign(new Error(code), { code }); }

async function requireContext(env) {
  if (process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_NUMBER !== "4"
    || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || !/^[0-9a-f]{40}$/u.test(env.GITHUB_SHA ?? "")
    || !/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID ?? "")
    || !path.isAbsolute(env.RUNNER_TEMP ?? "") || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
    throw fail("seaweed_candidate_context_invalid");
  }
  try {
    if (await realpath(env.RUNNER_TEMP) !== env.RUNNER_TEMP) throw fail("seaweed_candidate_context_invalid");
  } catch { throw fail("seaweed_candidate_context_invalid"); }
  return path.join(env.RUNNER_TEMP, "seaweed-runtime-candidate");
}

async function cleanupRoot(root) {
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o700 || await realpath(root) !== root
      || (await readdir(root)).length !== 0) throw fail("seaweed_candidate_temporary_cleanup_failed");
    await rmdir(root);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw fail("seaweed_candidate_temporary_cleanup_failed");
  }
}

function elapsedMs(started) {
  return Math.min(10_800_000, Math.max(0, Math.floor(performance.now() - started)));
}

function publicReceipt(result, env, durationMs) {
  const keys = ["kind", "state", "authority", "candidateAuthorization", "imageExecution", "publication",
    "vulnerabilityAudit", "admission", "runId", "recipeRevision", "rawSize", "diffId", "memberCount",
    "imageId", "sourceRunId", "sourceCodeRevision", "sourceBinaryDigest", "baseManifestDigest",
    "serverVersion", "archiveKind", "archiveIdentityType", "archiveSha256", "archiveBytes", "runtimeProof"];
  if (result === null || typeof result !== "object" || Object.keys(result).length !== keys.length
    || keys.some((key) => !Object.hasOwn(result, key))
    || result.kind !== "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V2" || result.state !== "VERIFIED"
    || result.authority !== "DIAGNOSTIC_ONLY" || result.candidateAuthorization !== "NOT_AUTHORIZED"
    || result.imageExecution !== "VERIFIED_DIAGNOSTIC" || result.publication !== "NOT_ATTEMPTED"
    || result.vulnerabilityAudit !== "NOT_ATTEMPTED" || result.admission !== "NOT_ATTEMPTED"
    || result.runId !== env.GITHUB_RUN_ID || result.recipeRevision !== env.GITHUB_SHA
    || !Number.isSafeInteger(result.rawSize) || result.rawSize < 1024 || result.rawSize > 2 * 1024 ** 3
    || !SHA256.test(result.diffId) || !Number.isSafeInteger(result.memberCount) || result.memberCount < 1
    || result.memberCount > 100_000 || !SHA256.test(result.imageId)
    || result.sourceRunId !== String(reviewedSeaweedSourcePolicy.runId)
    || result.sourceCodeRevision !== reviewedSeaweedSourcePolicy.sourceSha
    || result.sourceBinaryDigest !== SOURCE_BINARY_DIGEST
    || result.baseManifestDigest !== `sha256:${baseMaterialIdentities["base-manifest.json"].sha256}`
    || result.serverVersion !== "28.0.4" || result.archiveKind !== "SEAWEED_SAVED_CANDIDATE_PROOF_V1"
    || result.archiveIdentityType !== "CLASSIC_CONFIG_ID" || !HEX.test(result.archiveSha256)
    || !Number.isSafeInteger(result.archiveBytes) || result.archiveBytes < result.rawSize
    || result.archiveBytes > 2 * 1024 ** 3) throw fail("seaweed_candidate_failed");
  try {
    validateSeaweedRuntimeProfileProof(result.runtimeProof,
      { imageId: result.imageId, runId: result.runId, recipeRevision: result.recipeRevision });
  } catch { throw fail("seaweed_candidate_failed"); }
  const bytes = JSON.stringify({ ...result, diagnostic: { phase: "RUNTIME_COMPLETE", result: "VERIFIED",
    reason: "CHECKS_PASSED", durationMs } });
  if (bytes.length > 8192) throw fail("seaweed_candidate_failed");
  return bytes;
}

async function executeMain(argv, env, testOnly, started) {
  if (argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) {
    throw fail("seaweed_candidate_arguments_invalid");
  }
  const root = await requireContext(env);
  const log = testOnly.log ?? console.log;
  if (argv[0] === "cleanup") {
    await cleanupRoot(root);
    log(JSON.stringify({ state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" }));
    return;
  }
  const materialize = testOnly.materialize ?? materializeAndVerifyLocalSeaweedRuntimeCandidate;
  await mkdir(root, { mode: 0o700 });
  let result; let failure;
  try {
    result = await materialize({ parent: root, recipeRevision: env.GITHUB_SHA,
      createdAt: new Date((testOnly.now ?? Date.now)()).toISOString(), runId: env.GITHUB_RUN_ID });
  } catch (error) { failure = error; }
  await cleanupRoot(root);
  if (failure !== undefined) throw failure;
  log(publicReceipt(result, env, elapsedMs(started)));
}

function ownData(error, key) {
  if (error === null || typeof error !== "object" && typeof error !== "function") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function fallbackPhase(code) {
  if (code === "seaweed_candidate_context_invalid" || code === "seaweed_candidate_arguments_invalid") {
    return "CONTEXT";
  }
  if (code === "seaweed_candidate_temporary_cleanup_failed") return "TEMP_CLEANUP";
  if (code === "seaweed_candidate_materialize_failed") return "CANDIDATE_MATERIALIZE";
  if (code === "seaweed_candidate_archive_failed") return "CANDIDATE_ARCHIVE";
  if (code === "seaweed_candidate_image_cleanup_failed") return "CANDIDATE_IMAGE_CLEANUP";
  if (code === "seaweed_candidate_runtime_cleanup_failed") return "RUNTIME_CLEANUP";
  if (code === "seaweed_candidate_runtime_failed") return "RUNTIME_PROBE";
  return "CANDIDATE_TRANSACTION";
}

async function main(argv = process.argv.slice(2), env = process.env, testOnly = {}) {
  const started = performance.now();
  try { return await executeMain(argv, env, testOnly, started); } catch (error) {
    const reported = fail(ownData(error, "code"));
    const phase = ownData(error, "phase"); const reason = ownData(error, "reason");
    reported.phase = isPublicSeaweedRuntimePhase(phase) ? phase : fallbackPhase(reported.code);
    reported.reason = isPublicSeaweedRuntimeReason(reason) ? reason : reported.code;
    reported.durationMs = elapsedMs(started);
    const imageId = ownData(error, "imageId");
    if (validImageId(imageId)) reported.imageId = imageId;
    if (validRunId(env.GITHUB_RUN_ID)) reported.runId = env.GITHUB_RUN_ID;
    if (validRevision(env.GITHUB_SHA)) reported.recipeRevision = env.GITHUB_SHA;
    throw reported;
  }
}

function publicFailure(error) {
  const candidate = ownData(error, "code");
  const code = isPublicCandidateFailureCode(candidate) ? candidate : "seaweed_candidate_failed";
  const phase = ownData(error, "phase"); const reason = ownData(error, "reason");
  const durationMs = ownData(error, "durationMs"); const imageId = ownData(error, "imageId");
  const runId = ownData(error, "runId"); const recipeRevision = ownData(error, "recipeRevision");
  return JSON.stringify({ state: "FAILED", code, candidateAuthorization: "NOT_AUTHORIZED",
    diagnostic: { phase: isPublicSeaweedRuntimePhase(phase) || CLI_PHASES.has(phase)
      ? phase : fallbackPhase(code), result: "FAILED",
    reason: isPublicSeaweedRuntimeReason(reason) || isPublicCandidateFailureCode(reason)
      ? reason : code,
    durationMs: Number.isSafeInteger(durationMs) && durationMs >= 0 && durationMs <= 10_800_000
      ? durationMs : 0 },
    ...(validImageId(imageId) ? { imageId } : {}),
    ...(validRunId(runId) ? { runId } : {}),
    ...(validRevision(recipeRevision) ? { recipeRevision } : {}) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(publicFailure(error)); process.exitCode = 1; });
}

export { main as TEST_ONLY_runRuntimeDiagnostic, publicFailure as TEST_ONLY_publicRuntimeFailure };
