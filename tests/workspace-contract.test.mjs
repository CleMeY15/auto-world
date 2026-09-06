import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  readFileSync(path.join(root, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));

const expectedBoundaries = [
  ["apps/web", "@auto-world/web", "app"],
  ["apps/mobile", "@auto-world/mobile", "app"],
  ["services/api", "@auto-world/api", "service"],
  ["services/ingestion", "@auto-world/ingestion", "service"],
  ["services/search", "@auto-world/search", "service"],
  ["services/ai", "@auto-world/ai", "service"],
  ["packages/vehicle-schema", "@auto-world/vehicle-schema", "package"],
  ["connectors/_sdk", "@auto-world/connector-sdk", "connector-sdk"],
];

test("pins the supported Node and pnpm toolchain", () => {
  const manifest = readJson("package.json");

  assert.equal(read(".nvmrc").trim(), "22.23.2");
  assert.equal(manifest.packageManager, "pnpm@10.15.0");
  assert.deepEqual(manifest.engines, {
    node: "22.23.2",
    pnpm: "10.15.0",
  });
  assert.match(read(".npmrc"), /^engine-strict=true$/mu);
  assert.ok(existsSync(path.join(root, "pnpm-lock.yaml")));
});

test("declares every architecture boundary as a private workspace package", () => {
  const workspace = read("pnpm-workspace.yaml");
  const names = new Set();

  for (const glob of ["apps/*", "services/*", "packages/*", "connectors/*"]) {
    assert.ok(workspace.includes(`- ${glob}`));
  }

  for (const [directory, expectedName, expectedKind] of expectedBoundaries) {
    const manifest = readJson(`${directory}/package.json`);
    const source = read(`${directory}/src/index.ts`);
    const tsconfig = readJson(`${directory}/tsconfig.json`);
    const activeContract = expectedName === "@auto-world/vehicle-schema";

    assert.equal(manifest.name, expectedName);
    assert.equal(manifest.version, "0.0.0");
    assert.equal(manifest.private, true);
    assert.equal(manifest.type, "module");
    assert.deepEqual(manifest.scripts, activeContract ? {
      build: "tsc -p tsconfig.json",
      lint: "eslint src test --max-warnings=0",
      typecheck: "tsc -p tsconfig.test.json --noEmit",
      test: "pnpm run build && node --test test/*.test.mjs",
    } : {
      build: "tsc -p tsconfig.json",
      lint: "eslint src --max-warnings=0",
      typecheck: "tsc -p tsconfig.json --noEmit",
      test: "node ../../scripts/verify-package-build.mjs",
    });
    assert.equal(tsconfig.extends, "../../tsconfig.base.json");
    assert.equal(tsconfig.compilerOptions.rootDir, "src");
    assert.equal(tsconfig.compilerOptions.outDir, "dist");
    assert.deepEqual(tsconfig.include, ["src"]);
    assert.ok(!names.has(manifest.name));
    names.add(manifest.name);
    assert.ok(source.includes(`name: "${expectedName}"`));
    assert.ok(source.includes(`kind: "${expectedKind}"`));
    assert.ok(source.includes(`status: "${activeContract ? "active" : "placeholder"}"`));
    if (activeContract) {
      assert.deepEqual(manifest.exports, {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      });
      assert.equal(manifest.types, "./dist/index.d.ts");
      assert.ok(existsSync(path.join(root, directory, "test")));
      assert.ok(existsSync(path.join(root, directory, "tsconfig.test.json")));
    }
  }
});

test("keeps all root quality gates executable and non-trivial", () => {
  const manifest = readJson("package.json");
  const turbo = readJson("turbo.json");

  for (const gate of ["lint", "typecheck", "test", "build"]) {
    assert.equal(typeof manifest.scripts[gate], "string");
    assert.ok(manifest.scripts[gate].length > 0);
    assert.ok(!/\b(?:echo|exit 0|true)\b/u.test(manifest.scripts[gate]));
    assert.ok(Object.hasOwn(turbo.tasks, gate));
  }

  assert.equal(
    manifest.scripts.check,
    "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run secrets:check && pnpm run audit:dependencies",
  );
  assert.equal(
    manifest.scripts["audit:dependencies"],
    "pnpm audit --audit-level low",
  );
  assert.deepEqual(turbo.globalDependencies, [
    ".npmrc",
    ".nvmrc",
    "eslint.config.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "scripts/**",
    "tsconfig.base.json",
  ]);
  assert.deepEqual(turbo.tasks.test.dependsOn, ["build"]);
});

test("uses a frozen, separately observable CI gate sequence", () => {
  const ci = read(".github/workflows/ci.yml");

  assert.match(ci, /^\s+version: 10\.15\.0$/mu);
  assert.match(ci, /^\s+node-version-file: \.nvmrc$/mu);
  assert.match(ci, /^\s+contents: read$/mu);
  assert.match(ci, /run: pnpm install --frozen-lockfile$/mu);
  assert.doesNotMatch(ci, /frozen-lockfile=false/u);
  for (const gate of ["lint", "typecheck", "test", "build"]) {
    assert.match(ci, new RegExp(`run: pnpm ${gate}$`, "mu"));
  }
  assert.match(ci, /run: pnpm secrets:check$/mu);
  assert.match(ci, /run: pnpm run audit:dependencies$/mu);
});

test("documents the exact clean-checkout bootstrap commands", () => {
  const readme = read("README.md");

  for (const command of [
    "nvm install 22.23.2",
    "nvm use 22.23.2",
    "corepack prepare pnpm@10.15.0 --activate",
    "pnpm install --frozen-lockfile",
    "pnpm check",
  ]) {
    assert.ok(readme.includes(command));
  }
});

test("tracks only the environment example", () => {
  const trackedEnvironmentFiles = execFileSync(
    "git",
    ["ls-files", ".env", ".env.*"],
    { encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);

  assert.deepEqual(trackedEnvironmentFiles, [".env.example"]);
});
