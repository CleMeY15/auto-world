import { lstat, mkdir, readdir, realpath, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scanReviewedSeaweedSourceZips } from "./scan-source-zips.mjs";

function diagnosticError(code) {
  return Object.assign(new Error(code), { code });
}

async function requireContext(env) {
  if (process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_NUMBER !== "1"
    || env.GITHUB_RUN_ATTEMPT !== "1"
    || env.GITHUB_WORKFLOW_REF !== "CleMeY15/auto-world/.github/workflows/seaweed-zip-structural.yml@refs/heads/main"
    || !path.isAbsolute(env.RUNNER_TEMP ?? "") || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
    throw diagnosticError("seaweed_zip_structural_context_invalid");
  }
  try {
    if (await realpath(env.RUNNER_TEMP) !== env.RUNNER_TEMP) throw diagnosticError("seaweed_zip_structural_context_invalid");
  } catch {
    throw diagnosticError("seaweed_zip_structural_context_invalid");
  }
  return path.join(env.RUNNER_TEMP, "seaweed-zip-structural");
}

async function cleanup(root) {
  let stat;
  try { stat = await lstat(root); } catch (error) {
    if (error.code === "ENOENT") return;
    throw diagnosticError("seaweed_zip_structural_cleanup_failed");
  }
  try {
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
      || (stat.mode & 0o777) !== 0o700 || await realpath(root) !== root
      || (await readdir(root)).length !== 0) throw diagnosticError("seaweed_zip_structural_cleanup_failed");
    await rmdir(root);
  } catch {
    throw diagnosticError("seaweed_zip_structural_cleanup_failed");
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 1 || !["scan", "cleanup"].includes(argv[0])) {
    throw diagnosticError("seaweed_zip_structural_arguments_invalid");
  }
  const root = await requireContext(env);
  if (argv[0] === "cleanup") {
    await cleanup(root);
    console.log(JSON.stringify({ state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" }));
    return;
  }
  await mkdir(root, { mode: 0o700 });
  const result = await scanReviewedSeaweedSourceZips({ root });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.code ?? "seaweed_zip_structural_failed");
    process.exitCode = 1;
  });
}

export { main as TEST_ONLY_runZipStructuralDiagnostic };
