import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../.github/workflows/prototype-web.yml", import.meta.url), "utf8");
const scripts = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).scripts;

test("persistent web acceptance retains explicit guards, exact source and both browsers", () => {
  assert.match(scripts["prototype:web:start"], /--conditions=auto-world-prototype --conditions=auto-world-demo scripts\/prototype-web\/server\.mjs$/u);
  assert.match(scripts["prototype:web:test"], /--conditions=auto-world-prototype --conditions=auto-world-demo scripts\/prototype-web\/integration\.mjs$/u);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /permissions:\n {2}contents: read/u);
  assert.match(workflow, /playwright install --with-deps chromium webkit/u);
  assert.match(workflow, /pnpm install --frozen-lockfile/u);
  assert.match(workflow, /node --conditions=auto-world-prototype --conditions=auto-world-demo --test scripts\/prototype-web\/\*\.test\.mjs/u);
  assert.match(workflow, /node --conditions=auto-world-prototype --conditions=auto-world-demo scripts\/prototype-web\/integration\.mjs/u);
});

test("persistent web recipes build the complete web dependency closure", () => {
  const recipe = "pnpm --filter @auto-world/search... build && pnpm --filter @auto-world/web... build";
  assert.ok(scripts["prototype:web:start"].startsWith(`${recipe} && `));
  assert.ok(scripts["prototype:web:test"].startsWith(`${recipe} && `));
  assert.match(workflow, new RegExp(`run: ${recipe.replaceAll(".", "\\.")}`, "u"));
  assert.doesNotMatch(workflow, /pnpm --filter @auto-world\/web build/u);
});

test("persistent web workflow has pinned tools and sanitized bounded artifacts only", () => {
  for (const pin of ["actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"]) assert.ok(workflow.includes(pin));
  assert.match(workflow, /timeout-minutes: 55/u);
  assert.match(workflow, /timeout-minutes: 25/u);
  assert.match(workflow, /if: always\(\)/u);
  assert.match(workflow, /\.local-data\/prototype-web\/\*\/result\.json/u);
  assert.match(workflow, /\.local-data\/prototype-web\/\*\/\*\.png/u);
  assert.doesNotMatch(workflow, /contents:\s*write|secrets\.|docker\s+(?:login|push|build)|state\.json|\.env|scanner|attestation/u);
});
