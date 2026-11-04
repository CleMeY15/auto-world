import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ESLint } from "eslint";

const root = process.cwd();
const rootRequire = createRequire(import.meta.url);
const eslintRequire = createRequire(rootRequire.resolve("eslint"));
const configArrayEntry = eslintRequire.resolve("@eslint/config-array");
const configArrayRequire = createRequire(configArrayEntry);
const typescriptEslintRequire = createRequire(
  rootRequire.resolve("typescript-eslint"),
);
const typescriptEstreeEntry = typescriptEslintRequire.resolve(
  "@typescript-eslint/typescript-estree",
);
const typescriptEstreeRequire = createRequire(typescriptEstreeEntry);

const eslintMinimatch = eslintRequire("minimatch");
const configArrayMinimatch = configArrayRequire("minimatch");
const typescriptEstreeMinimatch = typescriptEstreeRequire("minimatch");

const relative = (absolutePath) =>
  path.relative(root, absolutePath).replaceAll("\\", "/");

test("keeps the public Minimatch surface consumed by ESLint tooling", async () => {
  for (const implementation of [eslintMinimatch, configArrayMinimatch]) {
    assert.equal(typeof implementation.Minimatch, "function");

    const matcher = new implementation.Minimatch(
      "apps/**/src/**/*.{ts,tsx}",
      { dot: true },
    );

    assert.equal(typeof matcher.match, "function");
    assert.equal(matcher.match("apps/web/src/app/page.tsx"), true);
    assert.equal(matcher.match("apps/web/src/demo/catalog.ts"), true);
    assert.equal(matcher.match("apps/web/src/app/page.js"), false);
    assert.equal(matcher.match("apps/web", true), true);
    assert.equal(matcher.match("services", true), false);
  }

  const configArrayModule = await import(pathToFileURL(configArrayEntry).href);
  assert.equal(typeof configArrayModule.ConfigArray, "function");
});

test("preserves repository glob semantics across dotfiles, case, and Windows paths", () => {
  const { Minimatch } = eslintMinimatch;

  const sourceMatcher = new Minimatch("apps/**/src/**/*.ts", { dot: true });
  assert.equal(sourceMatcher.match("apps/web/src/.internal/check.ts"), true);
  assert.equal(sourceMatcher.match("apps/web/src/app/CHECK.TS"), false);

  const windowsMatcher = new Minimatch("C:/**/src/**/*.tsx", {
    dot: true,
    nocase: false,
    platform: "win32",
  });
  assert.equal(
    windowsMatcher.match("C:/repo/apps/web/src/app/page.tsx"),
    true,
  );

  const backslashMatcher = new Minimatch("apps/**/src/**/*.ts", {
    dot: true,
    platform: "win32",
    windowsPathsNoEscape: true,
  });
  assert.equal(backslashMatcher.match("apps\\web\\src\\demo\\catalog.ts"), true);

  const uncMatcher = new Minimatch("//server/share/**/src/**/*.tsx", {
    dot: true,
    nocase: false,
    platform: "win32",
  });
  assert.equal(
    uncMatcher.match("//server/share/apps/web/src/app/page.tsx"),
    true,
  );
  assert.equal(
    uncMatcher.match("//server/other/apps/web/src/app/page.tsx"),
    false,
  );
});

test("preserves config-array negative ignore behavior", async () => {
  const { ConfigArray } = await import(pathToFileURL(configArrayEntry).href);
  const configs = new ConfigArray(
    [
      { ignores: ["**/*.generated.mjs", "!**/keep.generated.mjs"] },
      { files: ["**/*.mjs"] },
    ],
    { basePath: root },
  );
  configs.normalizeSync();

  assert.equal(
    configs.isFileIgnored(path.join(root, "tests/drop.generated.mjs")),
    true,
  );
  assert.equal(
    configs.isFileIgnored(path.join(root, "tests/keep.generated.mjs")),
    false,
  );
  assert.equal(
    configs.isFileIgnored(path.join(root, "tests/ordinary.mjs")),
    false,
  );
});

test("preserves the named minimatch function used by allowDefaultProject", () => {
  assert.equal(typeof typescriptEstreeMinimatch.minimatch, "function");

  const { minimatch } = typescriptEstreeMinimatch;
  const options = { dot: true };
  const cases = [
    ["eslint.config.mjs", "*.config.{js,mjs}", true],
    [".eslintrc.js", "*.js", true],
    [".config/eslint.config.mjs", ".config/*.mjs", true],
    ["scripts/check-secrets.mjs", "scripts/*.mjs", true],
    ["src/app.ts", "*.{js,mjs}", false],
    ["scripts/nested/check.mjs", "scripts/*.mjs", false],
  ];

  for (const [filePath, pattern, expected] of cases) {
    assert.equal(
      minimatch(filePath, pattern, options),
      expected,
      `${filePath} against ${pattern}`,
    );
  }
});

test("keeps ESLint ignore decisions and representative discovery stable", async () => {
  const eslint = new ESLint({ cwd: root });
  const ignoreCases = new Map([
    ["apps/web/.next/server.js", true],
    ["apps/web/next-env.d.ts", true],
    ["apps/web/playwright-report/index.html", true],
    ["apps/web/src/.internal/check.ts", false],
    ["apps/web/src/app/PAGE.TSX", true],
    ["apps/web/src/app/page.tsx", false],
    ["apps/web/test-results/result.json", true],
    ["packages/design-system/dist/index.js", true],
  ]);

  for (const [filePath, expected] of ignoreCases) {
    assert.equal(
      await eslint.isPathIgnored(filePath),
      expected,
      `${filePath} ignore decision changed`,
    );
  }

  const inputs = [
    "apps/web/src/app/page.tsx",
    "eslint.config.mjs",
    "scripts/check-secrets.mjs",
    "tests/workspace-contract.test.mjs",
  ];
  const results = await eslint.lintFiles(inputs);

  assert.deepEqual(
    results.map(({ filePath }) => relative(filePath)).sort(),
    [...inputs].sort(),
  );
  assert.equal(
    results.reduce((count, result) => count + result.errorCount, 0),
    0,
  );
  assert.equal(
    results.reduce((count, result) => count + result.warningCount, 0),
    0,
  );
});
