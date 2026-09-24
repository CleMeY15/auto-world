import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = new URL("../.github/workflows/seaweed-image-candidate.yml", import.meta.url);

test("candidate workflow is one-time, main-only and read-only", async () => {
  const bytes = await readFile(workflow, "utf8");
  assert.match(bytes, /^on:\n {2}workflow_dispatch:\n$/mu);
  assert.doesNotMatch(bytes, /pull_request:|\bpush:|schedule:|workflow_call:/u);
  assert.equal([...bytes.matchAll(/^permissions:/gmu)].length, 1);
  assert.match(bytes, /permissions:\n {2}contents: read\n {2}actions: read\n/u);
  assert.doesNotMatch(bytes, /contents:\s*write|actions:\s*write|packages:|id-token:|secrets\./u);
  assert.match(bytes, /test "\$GITHUB_REPOSITORY" = 'CleMeY15\/auto-world'/u);
  assert.match(bytes, /test "\$GITHUB_EVENT_NAME" = 'workflow_dispatch'/u);
  assert.match(bytes, /test "\$GITHUB_REF" = 'refs\/heads\/main'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_NUMBER" = '1'/u);
  assert.match(bytes, /test "\$GITHUB_RUN_ATTEMPT" = '1'/u);
  assert.match(bytes, /test "\$GITHUB_WORKFLOW_REF" = 'CleMeY15\/auto-world\/\.github\/workflows\/seaweed-image-candidate\.yml@refs\/heads\/main'/u);
  assert.match(bytes, /concurrency:\n {2}group: seaweed-image-candidate\n {2}cancel-in-progress: false/u);
});

test("candidate workflow pins its Linux toolchain, checkout and capacity gates", async () => {
  const bytes = await readFile(workflow, "utf8");
  assert.match(bytes, /runs-on: ubuntu-24\.04/u);
  assert.match(bytes, /timeout-minutes: 180/u);
  assert.match(bytes, /test "\$available_kib" -ge 12582912/u);
  assert.match(bytes, /test "\$\(docker version --format '\{\{\.Server\.Version\}\}'\)" = '28\.0\.4'/u);
  assert.match(bytes, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(bytes, /persist-credentials: false/u);
  assert.match(bytes, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/u);
  assert.match(bytes, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(bytes, /node-version: 22\.23\.2/u);
  assert.match(bytes, /cache: ''/u);
});

test("candidate workflow executes and always cleans up without publishing or running an image", async () => {
  const bytes = await readFile(workflow, "utf8");
  assert.match(bytes, /env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {8}run: node scripts\/seaweed-image\/candidate-diagnostic\.mjs execute/u);
  assert.match(bytes, /- name: Remove diagnostic-owned empty directory\n {8}if: \$\{\{ always\(\) \}\}\n {8}run: node scripts\/seaweed-image\/candidate-diagnostic\.mjs cleanup/u);
  assert.equal([...bytes.matchAll(/candidate-diagnostic\.mjs execute/gu)].length, 1);
  assert.equal([...bytes.matchAll(/candidate-diagnostic\.mjs cleanup/gu)].length, 1);
  assert.doesNotMatch(bytes, /upload-artifact|download-artifact|docker\s+(?:login|push|run|build|tag)|docker\/login-action|docker\/build-push-action|gh\s+workflow\s+run|fork/u);
});
