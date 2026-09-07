import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyExpectedFile, loadCandidateContext, loadVerifiedCandidateRecords, verifyCandidateArtifactMatrix } from "./candidate-artifacts.mjs";
import { runCosignAirgap } from "./cosign-airgap.mjs";
import { readFileBounded } from "./native-audit.mjs";
import { runOrasIntegration } from "./oras-integration.mjs";
import { createOwnedDirectory, policyError, removeOwnedDirectory } from "./process.mjs";
import { canonicalJsonBuffer, sha256 } from "./strict-json.mjs";

export function parseNativeCliArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) throw policyError("native_cli_arguments_refused");
  return Object.freeze({ mode: "test" });
}

// This wrapper selects subjects from the independently verified matrix. Only
// public result JSON enters the fixed artifact directory; disposable private
// keys and authentication sentinels stay in separately owned workspaces.
export async function runNativeCliTests() {
  const context = await loadCandidateContext();
  const matrixDirectory = path.join(context.runnerTemp, "native-candidates");
  const matrix = await verifyCandidateArtifactMatrix(matrixDirectory, context.expectations, context.sources);
  const records = await loadVerifiedCandidateRecords(matrixDirectory, matrix, context.expectations);
  const selected = ["oras", "cosign"].map((tool) => {
    const record = records.find((entry) => entry.tool === tool && entry.repeat === 1);
    return { tool, output: record.outputs.find((entry) => entry.target === "linux-amd64") };
  });
  const consumption = matrix.consumedBytes + selected.reduce((sum, entry) => sum + entry.output.size, 0) + context.sources.cosign.size + 16 * 1024 * 1024;
  if (consumption > 8 * 1024 ** 3) throw policyError("native_cli_consumption_exceeded");
  const evidence = path.join(context.runnerTemp, "native-cli");
  await mkdir(evidence, { recursive: false });
  const staging = await createOwnedDirectory(context.runnerTemp);
  const results = [];
  try {
    // Freeze all inputs against the validated in-memory identities before the
    // first candidate process can change files in this disposable runner.
    for (const { tool, output } of selected) {
      await copyExpectedFile(path.join(matrixDirectory, `native-candidate-${tool}-1`, output.path),
        path.join(staging.path, tool), output, 512 * 1024 * 1024);
      await chmod(path.join(staging.path, tool), 0o700);
    }
    const source = path.join(staging.path, "cosign-source.tar.gz");
    await copyExpectedFile(path.join(matrixDirectory, "native-candidate-cosign-1/source.tar.gz"), source, context.sources.cosign, 2 * 1024 ** 3);
    for (const { tool, output: candidate } of selected) {
      const binary = path.join(staging.path, tool);
      const workspace = await createOwnedDirectory(context.runnerTemp);
      const filename = tool === "oras" ? "oras-integration-native.json" : "cosign-airgap-native.json";
      const output = path.join(workspace.path, filename);
      try {
        if (tool === "oras") {
          await runOrasIntegration({ binary, sha256: candidate.sha256, workspace: workspace.path, output });
        } else {
          await runCosignAirgap({ binary, binary_sha256: candidate.sha256,
            source, source_sha256: context.sources.cosign.sha256, workspace: workspace.path, output });
        }
        const bytes = await readFileBounded(output, 8 * 1024 * 1024);
        await writeFile(path.join(evidence, filename), bytes, { flag: "wx" });
        results.push({ tool, filename, sha256: sha256(bytes), binarySha256: candidate.sha256 });
      } finally {
        await removeOwnedDirectory(workspace);
      }
    }
  } finally {
    await removeOwnedDirectory(staging);
  }
  await writeFile(path.join(evidence, "native-cli-results.json"), canonicalJsonBuffer({ schemaVersion: 1,
    run: context.expectations[0].run, materialLockSha256: sha256(context.lockBytes),
    matrixSha256: sha256(canonicalJsonBuffer(matrix)), results }), { flag: "wx" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    parseNativeCliArgs(process.argv.slice(2));
    await runNativeCliTests();
  } catch (error) {
    process.stderr.write(`${typeof error?.code === "string" ? error.code : "native_cli_failed"}\n`);
    process.exitCode = 1;
  }
}
