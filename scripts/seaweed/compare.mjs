import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { validateArtifactAllowlist, validateArtifactDirectory } from "./build.mjs";

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function parseCompareArguments(argv) {
  if (argv.length !== 4 || argv[0] !== "--build-root" || argv[2] !== "--output" || !path.isAbsolute(argv[1]) || !path.isAbsolute(argv[3])) throw new Error("seaweed_compare_arguments_invalid");
  return { buildRoot: path.resolve(argv[1]), output: path.resolve(argv[3]) };
}

function verifiedBuild(directory, expectedRepeat) {
  if (!existsSync(directory) || lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) throw new Error("seaweed_compare_input_invalid");
  if (validateArtifactDirectory(directory).result !== "PASSED") throw new Error("seaweed_compare_receipt_invalid");
  const receipt = JSON.parse(readFileSync(path.join(directory, "build-receipt.json"), "utf8"));
  const inventory = JSON.parse(readFileSync(path.join(directory, "material-inventory.json"), "utf8"));
  if (receipt?.schemaVersion !== 1 || receipt.result !== "PASSED" || receipt.repeat !== expectedRepeat || receipt.sourceCommit !== "c5073360007d28385a33426a42ac3e4ec504c5a3" || !Array.isArray(inventory)) throw new Error("seaweed_compare_receipt_invalid");
  validateArtifactAllowlist(inventory.map((entry) => entry.path));
  for (const entry of inventory) {
    const file = path.resolve(directory, entry.path);
    if (!file.startsWith(`${directory}${path.sep}`) || !existsSync(file) || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) throw new Error("seaweed_compare_material_missing");
    const bytes = readFileSync(file);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error("seaweed_compare_material_changed");
  }
  return { receipt, inventory: new Map(inventory.map((entry) => [entry.path, entry])), directory };
}

export function compareBuilds(firstDirectory, secondDirectory) {
  const first = verifiedBuild(firstDirectory, 1); const second = verifiedBuild(secondDirectory, 2);
  const deterministic = [...first.inventory.keys()].filter((name) => !name.startsWith("logs/")).sort();
  const secondDeterministic = [...second.inventory.keys()].filter((name) => !name.startsWith("logs/")).sort();
  if (JSON.stringify(deterministic) !== JSON.stringify(secondDeterministic)) throw new Error("seaweed_compare_set_changed");
  const compared = [];
  for (const name of deterministic) {
    const left = readFileSync(path.join(first.directory, name)); const right = readFileSync(path.join(second.directory, name));
    if (!left.equals(right)) throw new Error(`seaweed_compare_bytes_changed:${name}`);
    compared.push({ path: name, sha256: digest(left), size: left.length });
  }
  if (!compared.some((entry) => entry.path === "weed")) throw new Error("seaweed_compare_binary_missing");
  return { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "PASSED", sourceCommit: first.receipt.sourceCommit, compared };
}

export function runComparison({ argv = process.argv.slice(2), env = process.env, platform = process.platform } = {}) {
  const { buildRoot, output } = parseCompareArguments(argv);
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_JOB !== "compare") throw new Error("seaweed_compare_context_invalid");
  const runnerTemp = path.resolve(env.RUNNER_TEMP ?? "");
  if (!path.isAbsolute(env.RUNNER_TEMP ?? "") || path.dirname(output) !== runnerTemp || path.basename(output) !== "seaweed-comparison.json" || existsSync(output)) throw new Error("seaweed_compare_output_invalid");
  try {
    const result = compareBuilds(path.join(buildRoot, "seaweed-build-1"), path.join(buildRoot, "seaweed-build-2"));
    const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
    if (bytes.length > 1024 ** 2) throw new Error("seaweed_compare_receipt_oversized");
    writeFileSync(output, bytes, { flag: "wx" });
    return result;
  } catch (error) {
    const reason = /^seaweed_[a-z0-9_:.-]+$/u.test(error?.message ?? "") ? error.message.split(":", 1)[0] : "seaweed_compare_failed";
    writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "FAILED", reason }, null, 2)}\n`, { flag: "wx" });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) runComparison();
