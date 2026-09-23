import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupMaterializedSeaweedSource,
  materializeReviewedSeaweedSource,
} from "./materialize-source-zips.mjs";

const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/seaweed-source-materialization.yml@refs/heads/main";

function diagnosticError(code) {
  return Object.assign(new Error(code), { code });
}

async function requireContext(env) {
  if (process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_NUMBER !== "1"
    || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || !path.isAbsolute(env.RUNNER_TEMP ?? "") || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
    throw diagnosticError("seaweed_source_materialization_context_invalid");
  }
  try {
    if (await realpath(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
      throw diagnosticError("seaweed_source_materialization_context_invalid");
    }
  } catch {
    throw diagnosticError("seaweed_source_materialization_context_invalid");
  }
  return path.join(env.RUNNER_TEMP, "seaweed-source-materialization");
}

async function requireEmptyOwnedRoot(root) {
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o700 || await realpath(root) !== root
      || (await readdir(root)).length !== 0) {
      throw diagnosticError("seaweed_source_materialization_cleanup_failed");
    }
  } catch (error) {
    if (error?.code === "seaweed_source_materialization_cleanup_failed") throw error;
    throw diagnosticError("seaweed_source_materialization_cleanup_failed");
  }
}

async function cleanupRoot(root) {
  try {
    await lstat(root);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw diagnosticError("seaweed_source_materialization_cleanup_failed");
  }
  try {
    await requireEmptyOwnedRoot(root);
    await rmdir(root);
  } catch {
    throw diagnosticError("seaweed_source_materialization_cleanup_failed");
  }
}

function publicReceipt(result) {
  const expectedKeys = ["kind", "state", "authority", "candidateAuthorization", "outputPath", "repository",
    "workflowId", "sourceSha", "runId", "attempt", "buildBytes", "comparedEntries"];
  if (!result || typeof result !== "object" || Object.keys(result).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(result, key))
    || Object.keys(result).some((key) => key !== "outputPath" && /path/iu.test(key))) {
    throw diagnosticError("seaweed_source_materialization_receipt_invalid");
  }
  const { outputPath: ignoredOutputPath, ...receipt } = result;
  const bytes = JSON.stringify(receipt);
  if (ignoredOutputPath === undefined || bytes.length > 16_384) {
    throw diagnosticError("seaweed_source_materialization_receipt_invalid");
  }
  return bytes;
}

async function main(argv = process.argv.slice(2), env = process.env, testOnly = {}) {
  if (argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) {
    throw diagnosticError("seaweed_source_materialization_arguments_invalid");
  }
  const root = await requireContext(env);
  if (argv[0] === "cleanup") {
    await cleanupRoot(root);
    (testOnly.log ?? console.log)(JSON.stringify({ state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" }));
    return;
  }

  const materialize = testOnly.materialize ?? materializeReviewedSeaweedSource;
  const dispose = testOnly.dispose ?? cleanupMaterializedSeaweedSource;
  await mkdir(root, { mode: 0o700 });
  let result;
  let receiptBytes;
  try {
    result = await materialize({ parent: root });
    receiptBytes = publicReceipt(result);
  } finally {
    if (result !== undefined) await dispose(result);
  }
  await cleanupRoot(root);
  (testOnly.log ?? console.log)(receiptBytes);
}

function publicFailure(error) {
  const safeCode = (value) => typeof value === "string" && /^seaweed_[a-z0-9_]+$/u.test(value);
  const code = safeCode(error?.code) ? error.code : "seaweed_source_materialization_failed";
  const detail = [error?.scanCode, error?.downloadCode, error?.originCode, error?.validationCode, error?.originalCode].find(safeCode);
  return JSON.stringify({ state: "FAILED", code, ...(detail === undefined ? {} : { detailCode: detail }),
    candidateAuthorization: "NOT_AUTHORIZED" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(publicFailure(error));
    process.exitCode = 1;
  });
}

export { main as TEST_ONLY_runSourceMaterializationDiagnostic, publicFailure as TEST_ONLY_publicSourceMaterializationFailure };
