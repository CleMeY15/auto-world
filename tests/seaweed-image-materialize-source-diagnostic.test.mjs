import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_publicSourceMaterializationFailure, TEST_ONLY_runSourceMaterializationDiagnostic } from "../scripts/seaweed-image/materialize-source-diagnostic.mjs";

const workflow = new URL("../.github/workflows/seaweed-source-materialization.yml", import.meta.url);
const linux = process.platform === "linux";

function context(runnerTemp) {
  return {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-source-materialization.yml@refs/heads/main",
    RUNNER_TEMP: runnerTemp,
  };
}

function materializationResult(outputPath) {
  return {
    kind: "SEAWEED_SOURCE_MATERIALIZATION_RECEIPT_V1", state: "MATERIALIZED", authority: "PREPARATION_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", outputPath, repository: "CleMeY15/auto-world",
    workflowId: 1, sourceSha: "a".repeat(40), runId: 2, attempt: 1,
    buildBytes: [3, 3], comparedEntries: 4,
  };
}

test("source materialization workflow is a one-time read-only main diagnostic", async () => {
  const bytes = await readFile(workflow, "utf8");
  assert.match(bytes, /workflow_dispatch:/u);
  assert.doesNotMatch(bytes, /pull_request:|\bpush:|upload-artifact|packages:\s*write/u);
  assert.doesNotMatch(bytes, /^ {4}if:/mu);
  assert.match(bytes, / {4}steps:\n {6}- name: Require the first reviewed main dispatch\n {8}run: \|/u);
  assert.match(bytes, /test "\$GITHUB_REPOSITORY" = 'CleMeY15\/auto-world'/u);
  assert.match(bytes, /test "\$GITHUB_EVENT_NAME" = 'workflow_dispatch'/u);
  assert.match(bytes, /test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_NUMBER" = '1'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_ATTEMPT" = '1'/u);
  assert.match(bytes, /test "\$GITHUB_WORKFLOW_REF" = 'CleMeY15\/auto-world\/\.github\/workflows\/seaweed-source-materialization\.yml@refs\/heads\/main'/u);
  assert.match(bytes, /contents: read/u);
  assert.match(bytes, /actions: read/u);
  assert.match(bytes, /persist-credentials: false/u);
  assert.match(bytes, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(bytes, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(bytes, /materialize-source-diagnostic\.mjs execute/u);
  assert.match(bytes, /materialize-source-diagnostic\.mjs cleanup/u);
});

test("diagnostic rejects invalid context before creating storage", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-material-context-test-"));
  const root = path.join(runnerTemp, "seaweed-source-materialization");
  try {
    for (const changed of [{ GITHUB_REF: "refs/heads/other" }, { GITHUB_RUN_NUMBER: "2" },
      { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_WORKFLOW_REF: "other" }]) {
      await assert.rejects(TEST_ONLY_runSourceMaterializationDiagnostic(["execute"],
        { ...context(runnerTemp), ...changed }), { code: "seaweed_source_materialization_context_invalid" });
      await assert.rejects(access(root), { code: "ENOENT" });
    }
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("diagnostic disposes material before emitting its bounded receipt", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-material-success-test-"));
  const root = path.join(runnerTemp, "seaweed-source-materialization");
  const outputPath = path.join(root, "complete");
  const events = [];
  const result = materializationResult(outputPath);
  try {
    await TEST_ONLY_runSourceMaterializationDiagnostic(["execute"], context(runnerTemp), {
      materialize: async ({ parent }) => {
        assert.equal(parent, root);
        await mkdir(outputPath, { mode: 0o700 });
        events.push("materialized");
        return result;
      },
      dispose: async (actual) => {
        assert.equal(actual, result);
        await rm(outputPath, { recursive: true });
        events.push("disposed");
      },
      log: (line) => events.push(JSON.parse(line)),
    });
    const { outputPath: ignoredOutputPath, ...receipt } = result;
    assert.equal(ignoredOutputPath, outputPath);
    assert.deepEqual(events, ["materialized", "disposed", receipt]);
    await assert.rejects(access(root), { code: "ENOENT" });
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("diagnostic suppresses success evidence when disposal fails", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-material-failure-test-"));
  const lines = [];
  const result = materializationResult(path.join(runnerTemp, "unused"));
  try {
    await assert.rejects(TEST_ONLY_runSourceMaterializationDiagnostic(["execute"], context(runnerTemp), {
      materialize: async () => result,
      dispose: async (actual) => {
        assert.equal(actual, result);
        throw Object.assign(new Error("dispose failed"), { code: "dispose_failed" });
      },
      log: (line) => lines.push(line),
    }), { code: "dispose_failed" });
    assert.deepEqual(lines, []);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("diagnostic emits no receipt when materialization fails", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-material-operation-failure-test-"));
  const lines = [];
  try {
    await assert.rejects(TEST_ONLY_runSourceMaterializationDiagnostic(["execute"], context(runnerTemp), {
      materialize: async () => { throw Object.assign(new Error("materialize failed"), { code: "materialize_failed" }); },
      dispose: async () => assert.fail("cleanup authority must not be fabricated for a failed materialization"),
      log: (line) => lines.push(line),
    }), { code: "materialize_failed" });
    assert.deepEqual(lines, []);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("cleanup removes only an empty owned root", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-material-cleanup-test-"));
  const root = path.join(runnerTemp, "seaweed-source-materialization");
  try {
    await mkdir(root, { mode: 0o700 });
    await writeFile(path.join(root, "unknown"), "fixture", { mode: 0o600 });
    await assert.rejects(TEST_ONLY_runSourceMaterializationDiagnostic(["cleanup"], context(runnerTemp)),
      { code: "seaweed_source_materialization_cleanup_failed" });
    assert.deepEqual(await readdir(root), ["unknown"]);
    await rm(path.join(root, "unknown"));
    await TEST_ONLY_runSourceMaterializationDiagnostic(["cleanup"], context(runnerTemp), { log: () => {} });
    await assert.rejects(access(root), { code: "ENOENT" });
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("diagnostic failure log exposes only bounded codes", () => {
  const unsafe = { code: "oops /private/path", scanCode: "seaweed_artifact_zip_entry_integrity_invalid /private/path",
    message: "/private/path and token" };
  assert.deepEqual(JSON.parse(TEST_ONLY_publicSourceMaterializationFailure(unsafe)), {
    state: "FAILED", code: "seaweed_source_materialization_failed", candidateAuthorization: "NOT_AUTHORIZED",
  });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicSourceMaterializationFailure({
    code: "seaweed_source_materialization_zip_invalid", scanCode: "seaweed_artifact_zip_entry_integrity_invalid",
  })), { state: "FAILED", code: "seaweed_source_materialization_zip_invalid",
    detailCode: "seaweed_artifact_zip_entry_integrity_invalid", candidateAuthorization: "NOT_AUTHORIZED" });
});
