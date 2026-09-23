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
  assert.match(bytes, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(bytes, /raw-zip-diagnostic\.mjs download/u);
  assert.match(bytes, /raw-zip-diagnostic\.mjs cleanup/u);
});

test("diagnostic cleanup removes only fixed owned children", { skip: !linux }, async () => {
  const runnerTemp = await mkdtemp(path.join(os.tmpdir(), "seaweed-diagnostic-test-"));
  const root = path.join(runnerTemp, "seaweed-raw-source");
  const env = {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_ATTEMPT: "1",
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
