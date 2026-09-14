import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { compareBuilds, parseCompareArguments, runComparison } from "../scripts/seaweed/compare.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(root, repeat, bytes = Buffer.from("binary")) {
  const directory = path.join(root, `seaweed-build-${repeat}`); mkdirSync(directory);
  const files = new Map([["weed", bytes], ["go-build-info.txt", Buffer.from("info")], ["test-summary.json", Buffer.from("{}")]]);
  for (const name of ["go1.26.8.linux-amd64.tar.gz", "seaweedfs-source.tar", "seaweedfs-grpc.patch", "module-changes.tsv", "required-tests.json", "DERIVATIVE-NOTICE.txt"]) files.set(`materials/${name}`, Buffer.from(name));
  for (const name of ["LICENSE", "weed/glog/LICENSE", "docker/Dockerfile.go_build", ".github/workflows/go.yml", ".github/workflows/container_release_unified.yml"]) files.set(`materials/upstream/${name}`, Buffer.from(name));
  const id = "a".repeat(64); const moduleFiles = {};
  for (const name of ["source.zip", "module.mod", "module.info"]) {
    const value = Buffer.from(name); files.set(`materials/modules/${id}/${name}`, value); moduleFiles[name] = { sha256: sha256(value), size: value.length };
  }
  const notices = [{ archiveEntry: "LICENSE", file: "notice-001.txt" }, { archiveEntry: "NOTICE.txt", file: "notice-002.txt" }].map((notice) => {
    const value = Buffer.from(notice.archiveEntry); files.set(`materials/modules/${id}/${notice.file}`, value); return { ...notice, sha256: sha256(value), size: value.length };
  });
  files.set("module-closure.json", Buffer.from(JSON.stringify([{ id, path: "google.golang.org/grpc", files: moduleFiles, notices }])));
  for (const [name, value] of files) { const target = path.join(directory, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, value); }
  const inventory = [...files].map(([name, value]) => ({ path: name.replaceAll("\\", "/"), sha256: sha256(value), size: value.length })).sort((a, b) => a.path.localeCompare(b.path, "en"));
  writeFileSync(path.join(directory, "material-inventory.json"), `${JSON.stringify(inventory)}\n`);
  writeFileSync(path.join(directory, "build-receipt.json"), `${JSON.stringify({ schemaVersion: 1, result: "PASSED", repeat, sourceCommit: "c5073360007d28385a33426a42ac3e4ec504c5a3" })}\n`);
  return directory;
}

test("comparison reads both real artifacts and compares actual binary bytes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-"));
  const first = fixture(root, 1); const second = fixture(root, 2);
  const result = compareBuilds(first, second);
  assert.equal(result.result, "PASSED");
  assert.equal(result.compared.some((entry) => entry.path === "weed"), true);
  writeFileSync(path.join(second, "weed"), "mutated");
  assert.throws(() => compareBuilds(first, second), /seaweed_artifact_inventory_changed/u);
  rmSync(root, { recursive: true, force: true });
});

test("comparison rejects missing, failed, and substituted second evidence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-compare-"));
  const first = fixture(root, 1); const second = fixture(root, 2);
  const receiptPath = path.join(second, "build-receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")); receipt.result = "FAILED"; writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => compareBuilds(first, second), /seaweed_failed_artifact_unsafe/u);
  rmSync(second, { recursive: true, force: true });
  assert.throws(() => compareBuilds(first, second), /seaweed_compare_input_invalid/u);
  rmSync(root, { recursive: true, force: true });
});

test("comparison rejects unrecorded files and writes a bounded sanitized failure receipt", () => {
  const runnerTemp = mkdtempSync(path.join(tmpdir(), "seaweed-runner-")); const buildRoot = path.join(runnerTemp, "builds"); mkdirSync(buildRoot);
  fixture(buildRoot, 1); const second = fixture(buildRoot, 2); writeFileSync(path.join(second, "unrecorded"), "private");
  assert.throws(() => compareBuilds(path.join(buildRoot, "seaweed-build-1"), second), /seaweed_artifact_allowlist_invalid/u);
  const output = path.join(runnerTemp, "seaweed-comparison.json");
  const env = { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: "compare", RUNNER_TEMP: runnerTemp };
  assert.throws(() => runComparison({ argv: ["--build-root", buildRoot, "--output", output], env, platform: "linux" }), /seaweed_artifact_allowlist_invalid/u);
  const receipt = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(receipt, { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "FAILED", reason: "seaweed_artifact_allowlist_invalid" });
  assert.ok(readFileSync(output).length < 1024 ** 2);
  rmSync(runnerTemp, { recursive: true, force: true });
});

test("comparison CLI accepts only fixed absolute build-root and output arguments", () => {
  const buildRoot = path.resolve(tmpdir(), "builds"); const output = path.resolve(tmpdir(), "comparison.json");
  assert.deepEqual(parseCompareArguments(["--build-root", buildRoot, "--output", output]), { buildRoot, output });
  assert.throws(() => parseCompareArguments(["--build-root", "relative", "--output", output]), /seaweed_compare_arguments_invalid/u);
});
