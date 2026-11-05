import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const workflow = await readFile(new URL("../.github/workflows/prototype-application.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("prototype application package entrypoints build dependencies and preserve explicit guards", () => {
  const build = "pnpm --filter @auto-world/search... build";
  const conditions = "node --conditions=auto-world-prototype --conditions=auto-world-demo";
  assert.equal(packageJson.scripts["prototype:application:start"],
    `${build} && ${conditions} scripts/prototype-application/server.mjs`);
  assert.equal(packageJson.scripts["prototype:application:test"],
    `${build} && ${conditions} scripts/prototype-application/integration.mjs`);
});

test("prototype application workflow is exact-source, read-only and bounded", () => {
  assert.match(workflow, /^name: V1 prototype application recovery$/mu);
  assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /timeout-minutes: 30/u);
  assert.match(workflow, /run: pnpm prototype:application:test\n {8}timeout-minutes: 20/u);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /cancel-in-progress: true/u);
  assert.doesNotMatch(workflow, /contents:\s*write|packages:\s*write|id-token|attestations|secrets\./u);
});

test("prototype application workflow pins tools, exercises real services and retains only sanitized evidence", () => {
  for (const pin of [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  ]) assert.ok(workflow.includes(pin), pin);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(workflow, /pnpm --filter @auto-world\/search\.\.\. build/u);
  assert.match(workflow, /pnpm prototype:application:test/u);
  assert.match(workflow, /sudo sysctl -w vm\.max_map_count=262144/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(workflow, /path: \.local-data\/prototype-application\/\*\/result\.json/u);
  assert.match(workflow, /include-hidden-files: true/u);
  assert.match(workflow, /if-no-files-found: error/u);
  assert.match(workflow, /retention-days: 14/u);
  assert.doesNotMatch(workflow, /docker\s+(?:login|push|build)|buildx|\.env|state\.json|raw_pages|archive/u);
});

test("prototype application workflow watches the complete application boundary only", () => {
  for (const watched of [
    "services/search/**",
    "services/api/**",
    "services/ingestion/**",
    "scripts/prototype-application/**",
    "scripts/prototype-shared/**",
    "scripts/prototype-search/**",
    "scripts/prototype-postgres/**",
    "tests/prototype-application-workflow.test.mjs",
    "tests/prototype-application-http.test.mjs",
    "tests/prototype-application-evidence.test.mjs",
    "tests/prototype-application-runtime.test.mjs",
    "tests/prototype-application-snapshot.test.mjs",
    "connectors/_sdk/**",
    "connectors/synthetic/**",
    "packages/demo-search-contract/**",
    "packages/vehicle-schema/**",
    "packages/vehicle-taxonomy/**",
    "packages/source-registry/**",
    "scripts/data-infra/**",
    "infra/compose.json",
    "infra/images.json",
    "infra/postgres-init.sh",
    "package.json",
    "pnpm-lock.yaml",
  ]) assert.ok(workflow.includes(`- ${watched}`), watched);
  assert.doesNotMatch(workflow, /TASK-0005|scanner|image-admission|trivy/iu);
});
