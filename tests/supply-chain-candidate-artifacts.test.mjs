import assert from "node:assert/strict";
import { link, mkdir, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertCandidateTransferBudget, loadVerifiedCandidateRecords, packageCandidateArtifact, parseCandidateArtifactArgs, verifyCandidateArtifact, verifyCandidateArtifactMatrix } from "../scripts/supply-chain/candidate-artifacts.mjs";
import { nativeAuditPreflightBudget } from "../scripts/supply-chain/native-scan.mjs";
import { createOwnedDirectory, removeOwnedDirectory } from "../scripts/supply-chain/process.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";

// These are hostile artifact transport tests with small data files. They do not
// execute or admit native code and cannot satisfy an upstream or scanner gate.
function fixture(tool = "oras", repeat = 1) {
  const expected = { tool, repeat, sourceCommit: "a".repeat(40), repositoryCommit: "b".repeat(40),
    selectionSha256: "1".repeat(64), materialLockSha256: "2".repeat(64), recipeSha256: "3".repeat(64),
    compilerVersion: "1.26.8", runnerImageVersion: "20260906.1.0", utilityInventorySha256: "6".repeat(64),
    run: { id: "123", attempt: 1, workflowSha: "b".repeat(40), sourceSha: "b".repeat(40),
      workflowRef: "CleMeY15/auto-world/.github/workflows/native-bootstrap.yml@refs/pull/8/merge", event: "pull_request", workflowFileSha256: "8".repeat(64) } };
  const buildInfo = ["build CGO_ENABLED=0"];
  const { runnerImageVersion, utilityInventorySha256, ...identity } = expected;
  const record = { schemaVersion: 1, state: "built_candidate", ...identity,
    runner: { label: "ubuntu-24.04", imageVersion: runnerImageVersion, utilityInventorySha256 }, versionOutputSha256: "4".repeat(64),
    outputs: (tool === "cosign" ? ["linux-amd64", "windows-amd64"] : ["linux-amd64"]).map((target) => ({
      target, path: `out/${tool}${target.startsWith("windows") ? ".exe" : ""}`, sha256: sha256(Buffer.from(tool)), size: tool.length,
      buildInfo, buildInfoSha256: sha256(canonicalJsonBuffer(buildInfo)),
    })) };
  const sourceArchive = { sha256: sha256(Buffer.from("source")), size: 6 };
  return { record, expected, sourceArchive };
}

async function materialize(directory, data) {
  await mkdir(directory);
  await mkdir(path.join(directory, "out"));
  await writeFile(path.join(directory, "record.json"), canonicalJsonBuffer(data.record));
  await writeFile(path.join(directory, "source.tar.gz"), "source");
  for (const output of data.record.outputs) await writeFile(path.join(directory, output.path), data.record.tool);
}

test("artifact packaging retains only verified public files and refuses reuse", async () => {
  const owned = await createOwnedDirectory();
  try {
    const data = fixture();
    const buildDirectory = path.join(owned.path, "build");
    await materialize(buildDirectory, data);
    await mkdir(path.join(buildDirectory, "home"));
    await writeFile(path.join(buildDirectory, "home/disposable.key"), "must never be transported");
    const destination = path.join(owned.path, "artifact");
    const args = { buildDirectory, recordFile: path.join(buildDirectory, "record.json"), sourceFile: path.join(buildDirectory, "source.tar.gz"),
      destination, expected: data.expected, sourceArchive: data.sourceArchive };
    assert.equal((await packageCandidateArtifact(args)).record.tool, "oras");
    assert.deepEqual((await readdir(destination)).sort(), ["out", "record.json", "source.tar.gz"]);
    await assert.rejects(packageCandidateArtifact(args), { code: "EEXIST" });
  } finally { await removeOwnedDirectory(owned); }
});

test("packaging fails when source bytes differ from independently locked identity", async () => {
  const owned = await createOwnedDirectory();
  try {
    const data = fixture();
    const buildDirectory = path.join(owned.path, "build");
    await materialize(buildDirectory, data);
    await writeFile(path.join(buildDirectory, "source.tar.gz"), "forged");
    await assert.rejects(packageCandidateArtifact({ buildDirectory, recordFile: path.join(buildDirectory, "record.json"),
      sourceFile: path.join(buildDirectory, "source.tar.gz"), destination: path.join(owned.path, "artifact"),
      expected: data.expected, sourceArchive: data.sourceArchive }), { code: "candidate_copy_source_changed" });
  } finally { await removeOwnedDirectory(owned); }
});

test("artifact receiver refuses unknown files, empty directories, changed source and executable bytes", async () => {
  const mutations = [
    async (directory) => writeFile(path.join(directory, "private.key"), "private"),
    async (directory) => mkdir(path.join(directory, "empty")),
    async (directory) => writeFile(path.join(directory, "out/debug.log"), "debug"),
    async (directory) => writeFile(path.join(directory, "source.tar.gz"), "forged"),
    async (directory) => writeFile(path.join(directory, "out/oras"), "evil"),
  ];
  for (const mutate of mutations) {
    const owned = await createOwnedDirectory();
    try {
      const data = fixture();
      const directory = path.join(owned.path, "artifact");
      await materialize(directory, data);
      await mutate(directory);
      await assert.rejects(verifyCandidateArtifact(directory, data.expected, data.sourceArchive));
    } finally { await removeOwnedDirectory(owned); }
  }
});

test("artifact receipt cannot redefine its expected checkout, lock, source or duplicate JSON identity", async () => {
  for (const key of ["repositoryCommit", "materialLockSha256", "sourceCommit", "duplicate"]) {
    const owned = await createOwnedDirectory();
    try {
      const data = fixture();
      const directory = path.join(owned.path, "artifact");
      await materialize(directory, data);
      if (key === "duplicate") {
        const json = canonicalJsonBuffer(data.record).toString("utf8").replace('"repeat":1', '"repeat":1,"repeat":2');
        await writeFile(path.join(directory, "record.json"), json);
      } else {
        data.record[key] = "9".repeat(key === "materialLockSha256" ? 64 : 40);
        await writeFile(path.join(directory, "record.json"), canonicalJsonBuffer(data.record));
      }
      await assert.rejects(verifyCandidateArtifact(directory, data.expected, data.sourceArchive));
    } finally { await removeOwnedDirectory(owned); }
  }
});

test("matrix receiver hashes all six artifacts and all four target executables", async () => {
  const owned = await createOwnedDirectory();
  try {
    const data = ["oras", "cosign", "trivy"].flatMap((tool) => [1, 2].map((repeat) => fixture(tool, repeat)));
    const directory = path.join(owned.path, "matrix");
    await mkdir(directory);
    for (const item of data) await materialize(path.join(directory, `native-candidate-${item.record.tool}-${item.record.repeat}`), item);
    const expectations = data.map((item) => item.expected);
    const sources = Object.fromEntries(data.map((item) => [item.record.tool, item.sourceArchive]));
    const result = await verifyCandidateArtifactMatrix(directory, expectations, sources);
    assert.equal(result.state, "reproducible_candidate");
    assert.equal(result.binaries.length, 4);
    assert.ok(result.consumedBytes > 0);
    await assert.rejects(verifyCandidateArtifactMatrix(directory, expectations.slice(1), sources), { code: "candidate_matrix_invalid" });
    await writeFile(path.join(directory, "native-candidate-cosign-2/out/cosign.exe"), "forged");
    await assert.rejects(verifyCandidateArtifactMatrix(directory, expectations, sources), { code: "candidate_identity_mismatch" });
  } finally { await removeOwnedDirectory(owned); }
});

test("rewritten candidate record cannot redefine a validated matrix subject", async () => {
  const owned = await createOwnedDirectory();
  try {
    const data = ["oras", "cosign", "trivy"].flatMap((tool) => [1, 2].map((repeat) => fixture(tool, repeat)));
    const directory = path.join(owned.path, "matrix");
    await mkdir(directory);
    for (const item of data) await materialize(path.join(directory, `native-candidate-${item.record.tool}-${item.record.repeat}`), item);
    const expectations = data.map((item) => item.expected);
    const sources = Object.fromEntries(data.map((item) => [item.record.tool, item.sourceArchive]));
    const matrix = await verifyCandidateArtifactMatrix(directory, expectations, sources);
    const snapshot = await loadVerifiedCandidateRecords(directory, matrix, expectations);
    const preflight = nativeAuditPreflightBudget(matrix, snapshot);
    assert.deepEqual(preflight.binarySizes, [4, 6, 6, 5]);
    assert.ok(preflight.budget.databaseCapacityBytes > 0);
    const original = snapshot[0].outputs[0].sha256;
    const forged = globalThis.structuredClone(data[0].record);
    forged.outputs[0].sha256 = sha256(Buffer.from("evil"));
    await writeFile(path.join(directory, "native-candidate-oras-1/out/oras"), "evil");
    await writeFile(path.join(directory, "native-candidate-oras-1/record.json"), canonicalJsonBuffer(forged));
    assert.equal(snapshot[0].outputs[0].sha256, original);
    assert.throws(() => { snapshot[0].outputs[0].sha256 = forged.outputs[0].sha256; }, TypeError);
    await assert.rejects(loadVerifiedCandidateRecords(directory, matrix, expectations), { code: "candidate_record_changed_after_matrix" });
  } finally { await removeOwnedDirectory(owned); }
});

test("CLI has fixed paths and refuses candidate execution, enable flags and arbitrary artifacts", () => {
  assert.deepEqual(parseCandidateArtifactArgs(["verify"]), { mode: "verify" });
  assert.deepEqual(parseCandidateArtifactArgs(["package", "--tool", "cosign", "--repeat", "2"]), { mode: "package", tool: "cosign", repeat: 2 });
  for (const args of [["verify", "--enable"], ["execute"], ["verify", "--directory", "other"],
    ["package", "--tool", "../cosign", "--repeat", "2"], ["package", "--tool", "oras", "--repeat", "0"]]) {
    assert.throws(() => parseCandidateArtifactArgs(args), { code: "candidate_artifact_arguments_refused" });
  }
});

test("transfer accounting accepts exact artifact and job bounds and rejects one byte over", () => {
  const GiB = 1024 ** 3;
  assert.equal(assertCandidateTransferBudget([6 * GiB]), 6 * GiB);
  assert.equal(assertCandidateTransferBudget([6 * GiB, 2 * GiB]), 8 * GiB);
  assert.throws(() => assertCandidateTransferBudget([6 * GiB + 1]), { code: "candidate_artifact_size_refused" });
  assert.throws(() => assertCandidateTransferBudget([6 * GiB, 2 * GiB + 1]), { code: "candidate_consumption_size_refused" });
  for (const sizes of [[], [0], [-1], [Number.NaN], [1.5], Array(7).fill(1)]) assert.throws(() => assertCandidateTransferBudget(sizes));
});

test("receiver refuses a hard-linked payload even with matching content and inventory", async () => {
  const owned = await createOwnedDirectory();
  try {
    const data = fixture();
    const directory = path.join(owned.path, "artifact");
    await materialize(directory, data);
    await link(path.join(directory, "out/oras"), path.join(owned.path, "same-file"));
    await assert.rejects(verifyCandidateArtifact(directory, data.expected, data.sourceArchive), { code: "candidate_artifact_path_refused" });
  } finally { await removeOwnedDirectory(owned); }
});

test("packager refuses hard-linked records, source archives and executable inputs", async () => {
  for (const relative of ["record.json", "source.tar.gz", "out/oras"]) {
    const owned = await createOwnedDirectory();
    try {
      const data = fixture();
      const buildDirectory = path.join(owned.path, "build");
      await materialize(buildDirectory, data);
      await link(path.join(buildDirectory, relative), path.join(owned.path, "input-alias"));
      await assert.rejects(packageCandidateArtifact({ buildDirectory, recordFile: path.join(buildDirectory, "record.json"),
        sourceFile: path.join(buildDirectory, "source.tar.gz"), destination: path.join(owned.path, "artifact"),
        expected: data.expected, sourceArchive: data.sourceArchive }), { code: relative === "out/oras" ? "evidence_path_invalid" : "candidate_copy_source_invalid" });
    } finally { await removeOwnedDirectory(owned); }
  }
});

test("Linux receiver refuses symbolic payloads and directories", { skip: process.platform === "win32" }, async () => {
  for (const target of ["binary", "directory"]) {
    const owned = await createOwnedDirectory();
    try {
      const data = fixture();
      const directory = path.join(owned.path, "artifact");
      await materialize(directory, data);
      if (target === "binary") {
        await writeFile(path.join(owned.path, "actual"), "oras");
        await unlink(path.join(directory, "out/oras"));
        await symlink(path.join(owned.path, "actual"), path.join(directory, "out/oras"));
        await assert.rejects(verifyCandidateArtifact(directory, data.expected, data.sourceArchive), { code: "candidate_artifact_path_refused" });
      } else {
        await symlink(directory, path.join(owned.path, "alias"), "dir");
        await assert.rejects(verifyCandidateArtifact(path.join(owned.path, "alias"), data.expected, data.sourceArchive), { code: "candidate_artifact_path_refused" });
      }
    } finally { await removeOwnedDirectory(owned); }
  }
});
