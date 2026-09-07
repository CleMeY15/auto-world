import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { compareNativeBuilds, validateNativeBuildRecord, verifyNativeBuildDirectory } from "../scripts/supply-chain/candidate-records.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";

// Synthetic parser/comparison tests, not native runtime acceptance evidence.
function fixture() {
  const records = ["oras", "cosign", "trivy"].flatMap((tool) => [1, 2].map((repeat) => ({
    schemaVersion: 1, state: "built_candidate", tool, repeat, sourceCommit: "a".repeat(40), repositoryCommit: "b".repeat(40),
    selectionSha256: "1".repeat(64), materialLockSha256: "2".repeat(64), recipeSha256: "3".repeat(64), compilerVersion: "1.26.8",
    runner: { label: "ubuntu-24.04", imageVersion: "20260906.1.0" }, versionOutputSha256: "4".repeat(64),
    run: { id: "123", attempt: 1, workflowSha: "b".repeat(40), sourceSha: "b".repeat(40) },
    outputs: (tool === "cosign" ? ["linux-amd64", "windows-amd64"] : ["linux-amd64"]).map((target) => ({
      target, path: `out/${tool}${target === "windows-amd64" ? ".exe" : ""}`, sha256: sha256(Buffer.from(tool)), size: tool.length,
      buildInfo: ["build CGO_ENABLED=0"], buildInfoSha256: sha256(canonicalJsonBuffer(["build CGO_ENABLED=0"])),
    })),
  })));
  const expectations = records.map((record) => ({ ...globalThis.structuredClone(record), runnerImageVersion: record.runner.imageVersion }));
  return { records, expectations };
}

test("native comparison requires the complete six-build, four-binary matrix", () => {
  const { records, expectations } = fixture();
  const result = compareNativeBuilds(records, expectations);
  assert.equal(result.state, "reproducible_candidate");
  assert.equal(result.binaries.length, 4);
  assert.throws(() => compareNativeBuilds(records.slice(1), expectations), { code: "candidate_matrix_incomplete" });
  assert.throws(() => compareNativeBuilds([...records.slice(0, 5), records[0]], expectations), { code: "candidate_matrix_invalid" });
});

test("comparison rejects a changed executable, Windows output or version result", () => {
  for (const change of [
    (records) => { records[1].outputs[0].sha256 = "5".repeat(64); },
    (records) => { records[3].outputs[1].sha256 = "5".repeat(64); },
    (records) => { records[5].versionOutputSha256 = "5".repeat(64); },
  ]) {
    const data = fixture(); change(data.records);
    assert.throws(() => compareNativeBuilds(data.records, data.expectations), { code: "candidate_reproducibility_mismatch" });
  }
});

test("record validation binds external identities and refuses paths, duplicate targets and altered build info", () => {
  const changes = [
    (record) => { record.repositoryCommit = "c".repeat(40); },
    (record) => { record.recipeSha256 = "8".repeat(64); },
    (record) => { record.outputs[0].path = "out/../../another"; },
    (record) => { record.outputs[0].buildInfo.push("dep hidden-module v9.9.9"); },
    (record) => { record.outputs.push(record.outputs[0]); },
    (record) => { record.runner.imageVersion = "20260905.1.0"; },
    (record) => { record.run.id = "124"; },
    (record) => { record.run.attempt = 2; },
    (record) => { record.run.workflowSha = "d".repeat(40); },
    (record) => { record.run.sourceSha = "e".repeat(40); },
    (record) => { record.admitted = true; },
  ];
  for (const change of changes) {
    const { records, expectations } = fixture(); change(records[0]);
    assert.throws(() => validateNativeBuildRecord(records[0], expectations[0]));
  }
});

test("file verification checks actual executable bytes before matrix comparison", async () => {
  const owned = await createOwnedDirectory();
  try {
    const { records, expectations } = fixture();
    await mkdir(path.join(owned.path, "out"));
    const binary = path.join(owned.path, "out/oras");
    await writeFile(binary, "oras");
    await verifyNativeBuildDirectory(owned.path, records[0], expectations[0]);
    await writeFile(binary, "changed");
    await assert.rejects(verifyNativeBuildDirectory(owned.path, records[0], expectations[0]), { code: "candidate_identity_mismatch" });
  } finally { await removeOwnedDirectory(owned); }
});
