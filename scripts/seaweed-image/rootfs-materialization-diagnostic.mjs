import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupMaterializedSeaweedRootfs, isPublicRootfsDetailCode, isPublicRootfsFailureCode,
  materializeReviewedSeaweedRootfs,
} from "./materialize-rootfs.mjs";
import { baseMaterialIdentities } from "./plan.mjs";
import { reviewedSeaweedSourcePolicy } from "./source-records.mjs";

const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/seaweed-rootfs-materialization.yml@refs/heads/main";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_BINARY = Object.freeze({
  digest: "sha256:45e99f08ca1b6f50826512368c73d9541ff9572795e0e12435bbfd46e1bbb9ef",
  size: 220_991_307,
});

function fail(code) { return Object.assign(new Error(code), { code }); }

async function requireContext(env) {
  if (process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_NUMBER !== "2"
    || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || !/^[0-9a-f]{40}$/u.test(env.GITHUB_SHA ?? "")
    || !path.isAbsolute(env.RUNNER_TEMP ?? "") || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
    throw fail("seaweed_rootfs_materialization_context_invalid");
  }
  try {
    if (await realpath(env.RUNNER_TEMP) !== env.RUNNER_TEMP) throw fail("seaweed_rootfs_materialization_context_invalid");
  } catch { throw fail("seaweed_rootfs_materialization_context_invalid"); }
  return path.join(env.RUNNER_TEMP, "seaweed-rootfs-materialization");
}

async function cleanupRoot(root) {
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o700 || await realpath(root) !== root
      || (await readdir(root)).length !== 0) throw fail("seaweed_rootfs_materialization_cleanup_failed");
    await rmdir(root);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw fail("seaweed_rootfs_materialization_cleanup_failed");
  }
}

function publicReceipt(result, env, createdAt) {
  const keys = ["kind", "state", "authority", "candidateAuthorization", "rawSize", "diffId", "memberCount",
    "sourceRunId", "sourceRepository", "sourceWorkflowId", "sourceAttempt", "sourceCodeRevision",
    "sourceBinaryDigest", "sourceBinarySize", "recipeRevision", "createdAt", "baseManifestDigest"];
  if (result === null || typeof result !== "object" || Object.keys(result).length !== keys.length
    || keys.some((key) => !Object.hasOwn(result, key))
    || result.kind !== "SEAWEED_ROOTFS_MATERIALIZATION_RECEIPT_V1" || result.state !== "MATERIALIZED"
    || result.authority !== "PREPARATION_ONLY" || result.candidateAuthorization !== "NOT_AUTHORIZED"
    || !Number.isSafeInteger(result.rawSize) || result.rawSize < 1024 || result.rawSize > 2 * 1024 ** 3
    || !SHA256.test(result.diffId) || !Number.isSafeInteger(result.memberCount) || result.memberCount < 1
    || result.memberCount > 100_000 || result.sourceRunId !== String(reviewedSeaweedSourcePolicy.runId)
    || result.sourceRepository !== reviewedSeaweedSourcePolicy.repository
    || result.sourceWorkflowId !== reviewedSeaweedSourcePolicy.workflowId
    || result.sourceAttempt !== reviewedSeaweedSourcePolicy.attempt
    || result.sourceCodeRevision !== reviewedSeaweedSourcePolicy.sourceSha
    || result.sourceBinaryDigest !== SOURCE_BINARY.digest || result.sourceBinarySize !== SOURCE_BINARY.size
    || result.recipeRevision !== env.GITHUB_SHA || result.createdAt !== createdAt
    || result.baseManifestDigest !== `sha256:${baseMaterialIdentities["base-manifest.json"].sha256}`) {
    throw fail("seaweed_rootfs_materialization_receipt_invalid");
  }
  const bytes = JSON.stringify(result);
  if (bytes.length > 4096) throw fail("seaweed_rootfs_materialization_receipt_invalid");
  return bytes;
}

async function main(argv = process.argv.slice(2), env = process.env, testOnly = {}) {
  if (argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) {
    throw fail("seaweed_rootfs_materialization_arguments_invalid");
  }
  const root = await requireContext(env);
  const log = testOnly.log ?? console.log;
  if (argv[0] === "cleanup") {
    await cleanupRoot(root);
    log(JSON.stringify({ state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" }));
    return;
  }
  const materialize = testOnly.materialize ?? materializeReviewedSeaweedRootfs;
  const dispose = testOnly.dispose ?? cleanupMaterializedSeaweedRootfs;
  await mkdir(root, { mode: 0o700 });
  let receipt;
  let publicBytes;
  try {
    const createdAt = new Date((testOnly.now ?? Date.now)()).toISOString();
    receipt = await materialize({ parent: root, recipeRevision: env.GITHUB_SHA, createdAt });
    publicBytes = publicReceipt(receipt, env, createdAt);
  } finally {
    if (receipt !== undefined) await dispose(receipt);
  }
  await cleanupRoot(root);
  log(publicBytes);
}

function ownData(error, key) {
  if (error === null || typeof error !== "object" && typeof error !== "function") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function publicFailure(error) {
  const candidateCode = ownData(error, "code");
  const code = isPublicRootfsFailureCode(candidateCode) ? candidateCode : "seaweed_rootfs_materialization_failed";
  const originalCode = ownData(error, "originalCode");
  const detailCode = isPublicRootfsDetailCode(originalCode) ? originalCode : undefined;
  return JSON.stringify({ state: "FAILED", code, ...(detailCode === undefined ? {} : { detailCode }),
    candidateAuthorization: "NOT_AUTHORIZED" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(publicFailure(error)); process.exitCode = 1; });
}

export { main as TEST_ONLY_runRootfsMaterializationDiagnostic, publicFailure as TEST_ONLY_publicRootfsMaterializationFailure };
