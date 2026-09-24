import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_runRawZipDiagnostic } from "../scripts/seaweed-image/raw-zip-diagnostic.mjs";

const workflow = new URL("../.github/workflows/seaweed-raw-zips.yml", import.meta.url);
const linux = process.platform === "linux";

test("manual raw ZIP workflow has fixed read-only scope and no ZIP upload", async () => {
  const bytes = await readFile(workflow, "utf8");
  assert.match(bytes, /workflow_dispatch:/u);
  assert.doesNotMatch(bytes, /pull_request:|\bpush:|upload-artifact|packages:\s*write/u);
  assert.match(bytes, /contents: read/u);
  assert.match(bytes, /actions: read/u);
  assert.match(bytes, /persist-credentials: false/u);
  assert.doesNotMatch(bytes, /^ {4}if:/mu);
  assert.match(bytes, / {4}steps:\n {6}- name: Require the first reviewed main dispatch\n {8}run: \|/u);
  assert.match(bytes, /test "\$GITHUB_REPOSITORY" = 'CleMeY15\/auto-world'/u);
  assert.match(bytes, /test "\$GITHUB_EVENT_NAME" = 'workflow_dispatch'/u);
  assert.match(bytes, /test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_NUMBER" = '1'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_ATTEMPT" = '1'/u);
  assert.match(bytes, /test "\$GITHUB_WORKFLOW_REF" = 'CleMeY15\/auto-world\/\.github\/workflows\/seaweed-raw-zips\.yml@refs\/heads\/main'/u);
  assert.match(bytes, /raw-zip-diagnostic\.mjs download/u);
  assert.match(bytes, /raw-zip-diagnostic\.mjs cleanup/u);
});

test("diagnostic cleanup removes only fixed owned children", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-diagnostic-test-"));
  const root = path.join(runnerTemp, "seaweed-raw-source");
  const env = {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-raw-zips.yml@refs/heads/main",
    RUNNER_TEMP: runnerTemp,
  };
  try {
    await mkdir(root, { mode: 0o700 });
    await writeFile(path.join(root, "seaweed-build-1.zip"), "fixture", { mode: 0o600 });
    await TEST_ONLY_runRawZipDiagnostic(["cleanup"], env);
    await assert.rejects(access(root), { code: "ENOENT" });
    await mkdir(root, { mode: 0o700 });
    await writeFile(path.join(root, "not-ours"), "fixture", { mode: 0o600 });
    await assert.rejects(TEST_ONLY_runRawZipDiagnostic(["cleanup"], env),
      { code: "seaweed_raw_zip_diagnostic_cleanup_failed" });
    assert.deepEqual(await readdir(root), ["not-ours"]);
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});

test("diagnostic refuses later runs and attempts before creating storage", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-diagnostic-context-test-"));
  const root = path.join(runnerTemp, "seaweed-raw-source");
  const env = {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/seaweed-raw-zips.yml@refs/heads/main",
    RUNNER_TEMP: runnerTemp,
  };
  try {
    for (const changed of [{ GITHUB_RUN_NUMBER: "2" }, { GITHUB_RUN_ATTEMPT: "2" }]) {
      await assert.rejects(TEST_ONLY_runRawZipDiagnostic(["download"], { ...env, ...changed }),
        { code: "seaweed_raw_zip_diagnostic_context_invalid" });
      await assert.rejects(access(root), { code: "ENOENT" });
    }
  } finally {
    await rm(runnerTemp, { recursive: true, force: true });
  }
});
