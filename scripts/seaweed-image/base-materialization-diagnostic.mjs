import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanupMaterializedSeaweedBase, materializePinnedSeaweedBase } from "./materialize-base.mjs";

const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/seaweed-base-materialization.yml@refs/heads/main";
const EXPECTED_TOTALS = Object.freeze({ compressedBytes: 195_224_300, rawBytes: 532_811_776,
  memberCount: 609, visibleEntries: 561 });

function diagnosticError(code) {
  return Object.assign(new Error(code), { code });
}

async function requireContext(env) {
  if (process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_NUMBER !== "1"
    || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || !path.isAbsolute(env.RUNNER_TEMP ?? "") || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
    throw diagnosticError("seaweed_base_materialization_context_invalid");
  }
  try {
    if (await realpath(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
      throw diagnosticError("seaweed_base_materialization_context_invalid");
    }
  } catch {
    throw diagnosticError("seaweed_base_materialization_context_invalid");
  }
  return path.join(env.RUNNER_TEMP, "seaweed-base-materialization");
}

async function cleanupRoot(root) {
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o700 || await realpath(root) !== root
      || (await readdir(root)).length !== 0) {
      throw diagnosticError("seaweed_base_materialization_cleanup_failed");
    }
    await rmdir(root);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw diagnosticError("seaweed_base_materialization_cleanup_failed");
  }
}

function publicReceipt(result, root) {
  const expectedKeys = ["kind", "state", "authority", "candidateAuthorization", "outputPath", "totals"];
  if (!result || typeof result !== "object" || Object.keys(result).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(result, key))
    || result.kind !== "SEAWEED_BASE_MATERIALIZATION_RECEIPT_V1" || result.state !== "MATERIALIZED"
    || result.authority !== "PREPARATION_ONLY" || result.candidateAuthorization !== "NOT_AUTHORIZED"
    || result.outputPath !== path.join(root, "seaweed-base-materialized")
    || !result.totals || Object.keys(result.totals).length !== Object.keys(EXPECTED_TOTALS).length
    || Object.entries(EXPECTED_TOTALS).some(([key, value]) => result.totals[key] !== value)) {
    throw diagnosticError("seaweed_base_materialization_receipt_invalid");
  }
  const { outputPath: ignoredOutputPath, ...receipt } = result;
  const bytes = JSON.stringify(receipt);
  if (ignoredOutputPath.length === 0 || bytes.length > 4096) {
    throw diagnosticError("seaweed_base_materialization_receipt_invalid");
  }
  return bytes;
}

async function main(argv = process.argv.slice(2), env = process.env, testOnly = {}) {
  if (argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) {
    throw diagnosticError("seaweed_base_materialization_arguments_invalid");
  }
  const root = await requireContext(env);
  if (argv[0] === "cleanup") {
    await cleanupRoot(root);
    (testOnly.log ?? console.log)(JSON.stringify({ state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" }));
    return;
  }

  const materialize = testOnly.materialize ?? materializePinnedSeaweedBase;
  const dispose = testOnly.dispose ?? cleanupMaterializedSeaweedBase;
  await mkdir(root, { mode: 0o700 });
  let result;
  let receiptBytes;
  try {
    result = await materialize({ parent: root });
    receiptBytes = publicReceipt(result, root);
  } finally {
    if (result !== undefined) await dispose(result);
  }
  await cleanupRoot(root);
  (testOnly.log ?? console.log)(receiptBytes);
}

function publicFailure(error) {
  const safeCode = (value) => typeof value === "string" && /^seaweed_[a-z0-9_]+$/u.test(value);
  const code = safeCode(error?.code) ? error.code : "seaweed_base_materialization_failed";
  return JSON.stringify({ state: "FAILED", code, candidateAuthorization: "NOT_AUTHORIZED" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(publicFailure(error));
    process.exitCode = 1;
  });
}

export { main as TEST_ONLY_runBaseMaterializationDiagnostic, publicFailure as TEST_ONLY_publicBaseMaterializationFailure };
