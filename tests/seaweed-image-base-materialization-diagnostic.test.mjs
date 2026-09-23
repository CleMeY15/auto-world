import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_publicBaseMaterializationFailure, TEST_ONLY_runBaseMaterializationDiagnostic } from "../scripts/seaweed-image/base-materialization-diagnostic.mjs";

const workflow = new URL("../.github/workflows/seaweed-base-materialization.yml", import.meta.url);
const linux = process.platform === "linux";

function context(runnerTemp) {
  return {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-base-materialization.yml@refs/heads/main",
    RUNNER_TEMP: runnerTemp,
  };
}

function materializationResult(outputPath) {
  return {
    kind: "SEAWEED_BASE_MATERIALIZATION_RECEIPT_V1", state: "MATERIALIZED",
    authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", outputPath,
    totals: { compressedBytes: 195_224_300, rawBytes: 532_811_776, memberCount: 609, visibleEntries: 561 },
  };
}

test("base materialization workflow is one-time, read-only and refuses reruns", async () => {
  const bytes = await readFile(workflow, "utf8");
  assert.match(bytes, /workflow_dispatch:/u);
  assert.doesNotMatch(bytes, /pull_request:|\bpush:|upload-artifact|packages:\s*write|actions:\s*read/u);
  assert.equal([...bytes.matchAll(/^permissions:/gmu)].length, 1);
  assert.match(bytes, /permissions:\n {2}contents: read\n\nconcurrency:/u);
  assert.match(bytes, /test "\$GITHUB_REPOSITORY" = 'CleMeY15\/auto-world'/u);
  assert.match(bytes, /test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_NUMBER" = '1'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_ATTEMPT" = '1'/u);
  assert.match(bytes, /test "\$GITHUB_WORKFLOW_REF" = 'CleMeY15\/auto-world\/\.github\/workflows\/seaweed-base-materialization\.yml@refs\/heads\/main'/u);
  assert.match(bytes, /contents: read/u);
  assert.match(bytes, /persist-credentials: false/u);
  assert.match(bytes, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(bytes, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(bytes, /base-materialization-diagnostic\.mjs execute/u);
  assert.match(bytes, /base-materialization-diagnostic\.mjs cleanup/u);
  assert.match(bytes, /- name: Remove diagnostic-owned empty directory\n {8}if: \$\{\{ always\(\) \}\}\n {8}run: node scripts\/seaweed-image\/base-materialization-diagnostic\.mjs cleanup/u);
  assert.match(bytes, /available_kib/u);
});

test("diagnostic rejects invalid context before creating storage", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-base-context-test-"));
  const root = path.join(runnerTemp, "seaweed-base-materialization");
  try {
    for (const changed of [{ GITHUB_REF: "refs/heads/other" }, { GITHUB_RUN_NUMBER: "2" },
      { GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_WORKFLOW_REF: "other" }]) {
      await assert.rejects(TEST_ONLY_runBaseMaterializationDiagnostic(["execute"],
        { ...context(runnerTemp), ...changed }), { code: "seaweed_base_materialization_context_invalid" });
      await assert.rejects(access(root), { code: "ENOENT" });
    }
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("diagnostic disposes owned closure before emitting its bounded receipt", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-base-success-test-"));
  const root = path.join(runnerTemp, "seaweed-base-materialization");
  const outputPath = path.join(root, "seaweed-base-materialized");
  const events = [];
  const result = materializationResult(outputPath);
  try {
    await TEST_ONLY_runBaseMaterializationDiagnostic(["execute"], context(runnerTemp), {
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

test("diagnostic never emits success if disposal fails or receipt totals drift", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-base-failure-test-"));
  const lines = [];
  const result = materializationResult(path.join(runnerTemp, "seaweed-base-materialization", "seaweed-base-materialized"));
  try {
    await assert.rejects(TEST_ONLY_runBaseMaterializationDiagnostic(["execute"], context(runnerTemp), {
      materialize: async () => result,
      dispose: async () => { throw Object.assign(new Error("dispose failed"), { code: "dispose_failed" }); },
      log: (line) => lines.push(line),
    }), { code: "dispose_failed" });
    assert.deepEqual(lines, []);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
  const runnerTemp2 = await mkdtemp(path.join(os.tmpdir(), "seaweed-base-drift-test-"));
  try {
    await assert.rejects(TEST_ONLY_runBaseMaterializationDiagnostic(["execute"], context(runnerTemp2), {
      materialize: async () => ({ ...materializationResult(path.join(runnerTemp2, "seaweed-base-materialization", "seaweed-base-materialized")),
        totals: { ...result.totals, memberCount: 608 } }),
      dispose: async () => {}, log: (line) => lines.push(line),
    }), { code: "seaweed_base_materialization_receipt_invalid" });
    assert.deepEqual(lines, []);
  } finally {
    await rm(runnerTemp2, { recursive: true, force: true });
  }
});

test("cleanup leaves an unknown object in the diagnostic root", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-base-cleanup-test-"));
  const root = path.join(runnerTemp, "seaweed-base-materialization");
  try {
    await mkdir(root, { mode: 0o700 });
    await writeFile(path.join(root, "unknown"), "fixture", { mode: 0o600 });
    await assert.rejects(TEST_ONLY_runBaseMaterializationDiagnostic(["cleanup"], context(runnerTemp)),
      { code: "seaweed_base_materialization_cleanup_failed" });
    assert.deepEqual(await readdir(root), ["unknown"]);
    await rm(path.join(root, "unknown"));
    await TEST_ONLY_runBaseMaterializationDiagnostic(["cleanup"], context(runnerTemp), { log: () => {} });
    await assert.rejects(access(root), { code: "ENOENT" });
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("failure log exposes only bounded codes", () => {
  assert.deepEqual(JSON.parse(TEST_ONLY_publicBaseMaterializationFailure({ code: "unsafe /private/path" })), {
    state: "FAILED", code: "seaweed_base_materialization_failed", candidateAuthorization: "NOT_AUTHORIZED",
  });
  assert.deepEqual(JSON.parse(TEST_ONLY_publicBaseMaterializationFailure({ code: "seaweed_base_materialization_timeout" })), {
    state: "FAILED", code: "seaweed_base_materialization_timeout", candidateAuthorization: "NOT_AUTHORIZED",
  });
});
