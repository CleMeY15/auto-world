import { existsSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { validateArtifactDirectory } from "./build.mjs";

export function parseGateArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--directory" || argv[2] !== "--output" ||
      !path.isAbsolute(argv[1]) || !path.isAbsolute(argv[3])) throw new Error("seaweed_artifact_gate_arguments_invalid");
  return { directory: path.resolve(argv[1]), output: path.resolve(argv[3]) };
}

export function runArtifactGate({ argv = process.argv.slice(2), env = process.env, validate = validateArtifactDirectory } = {}) {
  const { directory, output } = parseGateArguments(argv);
  if (!path.isAbsolute(env.RUNNER_TEMP ?? "")) throw new Error("seaweed_artifact_gate_path_invalid");
  const root = path.resolve(env.RUNNER_TEMP);
  const match = /^seaweed-build-([12])$/u.exec(path.basename(directory));
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory() || realpathSync(root) !== root ||
      !match || path.dirname(directory) !== root || path.dirname(output) !== root ||
      path.basename(output) !== `seaweed-artifact-gate-${match[1]}.json` || existsSync(output)) {
    throw new Error("seaweed_artifact_gate_path_invalid");
  }
  const receipt = { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "FAILED", repeat: Number(match[1]) };
  let failed = false;
  try {
    const result = validate(directory);
    if (!["PASSED", "FAILED"].includes(result?.result) || !Number.isSafeInteger(result.totalBytes) ||
        result.totalBytes < 1 || result.totalBytes > 2 * 1024 ** 3) throw new Error("seaweed_artifact_gate_result_invalid");
    receipt.result = "PASSED";
    receipt.buildResult = result.result;
    receipt.totalBytes = result.totalBytes;
  } catch {
    failed = true;
    receipt.reason = "seaweed_public_artifact_validation_failed";
  }
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  if (failed) throw new Error("seaweed_public_artifact_validation_failed");
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) runArtifactGate();
