import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_runZipStructuralDiagnostic } from "../scripts/seaweed-image/scan-source-diagnostic.mjs";

const workflow = new URL("../.github/workflows/seaweed-zip-structural.yml", import.meta.url);
const linux = process.platform === "linux";

function context(runnerTemp) {
  return {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-zip-structural.yml@refs/heads/main",
    RUNNER_TEMP: runnerTemp,
  };
}

test("structural diagnostic workflow fails closed and cannot publish ZIPs", async () => {
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
  assert.match(bytes, /test "\$GITHUB_WORKFLOW_REF" = 'CleMeY15\/auto-world\/\.github\/workflows\/seaweed-zip-structural\.yml@refs\/heads\/main'/u);
  assert.match(bytes, /contents: read/u);
  assert.match(bytes, /actions: read/u);
  assert.match(bytes, /persist-credentials: false/u);
  assert.match(bytes, /scan-source-diagnostic\.mjs scan/u);
  assert.match(bytes, /scan-source-diagnostic\.mjs cleanup/u);
});

test("structural diagnostic rejects repeated runs before creating storage", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-structural-context-test-"));
  const root = path.join(runnerTemp, "seaweed-zip-structural");
  try {
    for (const changed of [{ GITHUB_RUN_NUMBER: "2" }, { GITHUB_RUN_ATTEMPT: "2" },
      { GITHUB_WORKFLOW_REF: "other" }]) {
      await assert.rejects(TEST_ONLY_runZipStructuralDiagnostic(["scan"], { ...context(runnerTemp), ...changed }),
        { code: "seaweed_zip_structural_context_invalid" });
      await assert.rejects(access(root), { code: "ENOENT" });
    }
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("structural diagnostic cleanup removes only an empty owned directory", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-structural-cleanup-test-"));
  const root = path.join(runnerTemp, "seaweed-zip-structural");
  try {
    await mkdir(root, { mode: 0o700 });
    await writeFile(path.join(root, "unknown"), "fixture", { mode: 0o600 });
    await assert.rejects(TEST_ONLY_runZipStructuralDiagnostic(["cleanup"], context(runnerTemp)),
      { code: "seaweed_zip_structural_cleanup_failed" });
    assert.deepEqual(await readdir(root), ["unknown"]);
    await rm(path.join(root, "unknown"));
    await TEST_ONLY_runZipStructuralDiagnostic(["cleanup"], context(runnerTemp));
    await assert.rejects(access(root), { code: "ENOENT" });
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});
