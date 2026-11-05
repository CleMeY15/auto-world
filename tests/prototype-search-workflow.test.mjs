import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = await readFile(new URL("../.github/workflows/prototype-search.yml", import.meta.url), "utf8");

test("prototype search workflow is exact-source, read-only and bounded", () => {
  assert.match(workflow, /^name: V1 prototype search projection$/mu);
  assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /timeout-minutes: 25/u);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.doesNotMatch(workflow, /contents:\s*write|packages:\s*write|id-token|attestations|secrets\./u);
});

test("prototype search workflow pins tools, runs the real lane and retains only sanitized evidence", () => {
  for (const pin of [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  ]) assert.ok(workflow.includes(pin), pin);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(workflow, /pnpm prototype:search:test/u);
  assert.match(workflow, /sudo sysctl -w vm\.max_map_count=262144/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(workflow, /path: \.local-data\/prototype-search\/\*\/result\.json/u);
  assert.match(workflow, /if-no-files-found: error/u);
  assert.doesNotMatch(workflow, /docker\s+(?:login|push|build)|buildx|\.env|state\.json|raw_pages|archive/u);
});

test("prototype search workflow is scoped to the projection boundary", () => {
  for (const watched of [
    "services/search/**",
    "services/api/**",
    "services/ingestion/**",
    "scripts/prototype-search/**",
    "scripts/prototype-postgres/**",
    "connectors/synthetic/**",
    "packages/demo-search-contract/**",
    "scripts/data-infra/**",
    "infra/images.json",
  ]) assert.ok(workflow.includes(`- ${watched}`), watched);
  assert.doesNotMatch(workflow, /TASK-0005|scanner|image-admission|trivy/iu);
});
