import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isPublicCandidateFailureCode, isPublicCandidateInspectionDetail,
  materializeLocalSeaweedCandidate } from "./materialize-candidate.mjs";
import { baseMaterialIdentities } from "./plan.mjs";
import { reviewedSeaweedSourcePolicy } from "./source-records.mjs";

const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/seaweed-image-candidate.yml@refs/heads/main";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX = /^[0-9a-f]{64}$/u;
const SOURCE_BINARY_DIGEST = "sha256:45e99f08ca1b6f50826512368c73d9541ff9572795e0e12435bbfd46e1bbb9ef";

function fail(code) { return Object.assign(new Error(code), { code }); }

async function requireContext(env) {
  if (process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_NUMBER !== "3"
    || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || !/^[0-9a-f]{40}$/u.test(env.GITHUB_SHA ?? "")
    || !/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID ?? "")
    || !path.isAbsolute(env.RUNNER_TEMP ?? "") || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
    throw fail("seaweed_candidate_context_invalid");
  }
  try {
    if (await realpath(env.RUNNER_TEMP) !== env.RUNNER_TEMP) throw fail("seaweed_candidate_context_invalid");
  } catch { throw fail("seaweed_candidate_context_invalid"); }
  return path.join(env.RUNNER_TEMP, "seaweed-image-candidate");
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

function publicReceipt(result, env) {
  const keys = ["kind", "state", "authority", "candidateAuthorization", "imageExecution", "publication",
    "vulnerabilityAudit", "admission", "runId", "recipeRevision", "rawSize", "diffId", "memberCount",
    "imageId", "sourceRunId", "sourceCodeRevision", "sourceBinaryDigest", "baseManifestDigest",
    "serverVersion", "archiveKind", "archiveIdentityType", "archiveSha256", "archiveBytes"];
  if (result === null || typeof result !== "object" || Object.keys(result).length !== keys.length
    || keys.some((key) => !Object.hasOwn(result, key))
    || result.kind !== "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1" || result.state !== "VERIFIED"
    || result.authority !== "PREPARATION_ONLY" || result.candidateAuthorization !== "NOT_AUTHORIZED"
    || result.imageExecution !== "NOT_ATTEMPTED" || result.publication !== "NOT_ATTEMPTED"
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
  const bytes = JSON.stringify(result);
  if (bytes.length > 4096) throw fail("seaweed_candidate_failed");
  return bytes;
}

async function main(argv = process.argv.slice(2), env = process.env, testOnly = {}) {
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
  const materialize = testOnly.materialize ?? materializeLocalSeaweedCandidate;
  await mkdir(root, { mode: 0o700 });
  let result; let failure;
  try {
    result = await materialize({ parent: root, recipeRevision: env.GITHUB_SHA,
      createdAt: new Date((testOnly.now ?? Date.now)()).toISOString(), runId: env.GITHUB_RUN_ID });
  } catch (error) { failure = error; }
  await cleanupRoot(root);
  if (failure !== undefined) throw failure;
  log(publicReceipt(result, env));
}

function ownData(error, key) {
  if (error === null || typeof error !== "object" && typeof error !== "function") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function publicFailure(error) {
  const candidate = ownData(error, "code");
  const code = isPublicCandidateFailureCode(candidate) ? candidate : "seaweed_candidate_failed";
  const detail = ownData(error, "detailCode");
  return JSON.stringify({ state: "FAILED", code,
    ...((code === "seaweed_candidate_ownership_failed" || code === "seaweed_candidate_image_cleanup_failed")
      && isPublicCandidateInspectionDetail(detail) ? { detailCode: detail } : {}),
    candidateAuthorization: "NOT_AUTHORIZED" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(publicFailure(error)); process.exitCode = 1; });
}

export { main as TEST_ONLY_runCandidateDiagnostic, publicFailure as TEST_ONLY_publicCandidateFailure };
