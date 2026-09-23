import { mkdir, lstat, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { downloadReviewedSeaweedZips } from "./download-source-zips.mjs";

const NAMES = Object.freeze(["seaweed-build-1.zip", "seaweed-build-2.zip",
  "seaweed-artifact-gate-1.zip", "seaweed-artifact-gate-2.zip", "seaweed-comparison.zip"]);

function diagnosticError(code) {
  return Object.assign(new Error(code), { code });
}

function requireContext(env) {
  if (process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_NUMBER !== "1"
    || env.GITHUB_RUN_ATTEMPT !== "1"
    || env.GITHUB_WORKFLOW_REF !== "CleMeY15/auto-world/.github/workflows/seaweed-raw-zips.yml@refs/heads/main"
    || !path.isAbsolute(env.RUNNER_TEMP ?? "")) throw diagnosticError("seaweed_raw_zip_diagnostic_context_invalid");
  return path.join(env.RUNNER_TEMP, "seaweed-raw-source");
}

async function cleanup(root) {
  let rootStat;
  try { rootStat = await lstat(root); } catch (error) {
    if (error.code === "ENOENT") return;
    throw diagnosticError("seaweed_raw_zip_diagnostic_cleanup_failed");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== process.getuid()
    || (rootStat.mode & 0o777) !== 0o700 || await realpath(root) !== root) {
    throw diagnosticError("seaweed_raw_zip_diagnostic_cleanup_failed");
  }
  const names = await readdir(root);
  if (names.some((name) => !NAMES.includes(name))) throw diagnosticError("seaweed_raw_zip_diagnostic_cleanup_failed");
  for (const name of names) {
    const file = path.join(root, name);
    const item = await lstat(file);
    if (!item.isFile() || item.isSymbolicLink() || item.uid !== process.getuid()
      || item.nlink !== 1 || (item.mode & 0o777) !== 0o600) {
      throw diagnosticError("seaweed_raw_zip_diagnostic_cleanup_failed");
    }
    await unlink(file);
  }
  await rmdir(root);
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 1 || !["download", "cleanup"].includes(argv[0])) {
    throw diagnosticError("seaweed_raw_zip_diagnostic_arguments_invalid");
  }
  const root = requireContext(env);
  if (argv[0] === "cleanup") {
    await cleanup(root);
    console.log(JSON.stringify({ state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" }));
    return;
  }
  await mkdir(root, { mode: 0o700 });
  const result = await downloadReviewedSeaweedZips({ root });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.code ?? "seaweed_raw_zip_diagnostic_failed");
    process.exitCode = 1;
  });
}

export { main as TEST_ONLY_runRawZipDiagnostic };
