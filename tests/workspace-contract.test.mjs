import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  ["packages/vehicle-taxonomy", "@auto-world/vehicle-taxonomy", "package"],
  ["packages/domain-events", "@auto-world/domain-events", "package"],
  ["packages/source-registry", "@auto-world/source-registry", "package"],
  ["packages/demo-search-contract", "@auto-world/demo-search-contract", "package"],
  ["packages/design-system", "@auto-world/design-system", "package"],
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
    const source = read(`${directory}/src/${expectedName === "@auto-world/web" ? "app/page.tsx" : "index.ts"}`);
    const tsconfig = readJson(`${directory}/tsconfig.json`);
    const registry = expectedName === "@auto-world/source-registry";
    const connector = expectedName === "@auto-world/connector-sdk";
    const demo = expectedName === "@auto-world/demo-search-contract";
    const taxonomy = expectedName === "@auto-world/vehicle-taxonomy";
    const domainEvents = expectedName === "@auto-world/domain-events";
    const design = expectedName === "@auto-world/design-system";
    const web = expectedName === "@auto-world/web";
    const api = expectedName === "@auto-world/api";
    const activeContract = expectedName === "@auto-world/vehicle-schema" || registry || connector || design || demo || taxonomy || domainEvents || api;
    const dependencyBuild = demo
      ? "pnpm --filter @auto-world/vehicle-schema build && pnpm --filter @auto-world/vehicle-taxonomy build && "
      : connector
      ? "pnpm --filter @auto-world/source-registry build && "
      : registry || taxonomy || domainEvents ? "pnpm --filter @auto-world/vehicle-schema build && " : "";

    assert.equal(manifest.name, expectedName);
    assert.equal(manifest.version, "0.0.0");
    assert.equal(manifest.private, true);
    assert.equal(manifest.type, "module");
    if (web) {
      assert.equal(manifest.scripts.build, "next build");
      assert.match(manifest.scripts.typecheck, /next typegen.*tsc.*--noEmit/u);
      assert.match(manifest.scripts.test, /node --test/u);
      assert.equal(manifest.scripts["test:ui"], "playwright test");
      assert.equal(tsconfig.compilerOptions.noEmit, true);
      assert.ok(tsconfig.include.includes("src/**/*.tsx"));
    } else if (api) {
      assert.match(manifest.scripts.build, /tsc -p tsconfig.json.*verify-production-build/u);
      assert.match(manifest.scripts.lint, /^eslint src demo scripts test/u);
      assert.match(manifest.scripts.typecheck, /tsconfig.test.json --noEmit/u);
      assert.match(manifest.scripts.test, /--conditions=auto-world-demo --test/u);
      assert.equal(manifest.dependencies.fastify, "5.12.7");
      assert.equal(manifest.devDependencies["@types/node"], "22.20.2");
      assert.deepEqual(manifest.files, ["dist"]);
      assert.deepEqual(Object.keys(manifest.exports), ["."]);
    } else if (design) {
      assert.match(manifest.scripts.build, /^tsc .*generate-styles/u);
      assert.match(manifest.scripts.lint, /^eslint src test scripts/u);
      assert.match(manifest.scripts.test, /node --test/u);
      assert.equal(manifest.exports["./styles.css"], "./dist/styles.css");
    } else assert.deepEqual(manifest.scripts, activeContract ? {
      build: `${dependencyBuild}tsc -p tsconfig.json`,
      lint: connector ? "eslint src test test-support --max-warnings=0" : "eslint src test --max-warnings=0",
      typecheck: `${dependencyBuild}tsc -p tsconfig.test.json --noEmit`,
      test: "pnpm run build && node --test test/*.test.mjs",
    } : {
      build: "tsc -p tsconfig.json",
      lint: "eslint src --max-warnings=0",
      typecheck: "tsc -p tsconfig.json --noEmit",
      test: "node ../../scripts/verify-package-build.mjs",
    });
    assert.equal(tsconfig.extends, "../../tsconfig.base.json");
    if (!web) {
      assert.equal(tsconfig.compilerOptions.rootDir, "src");
      assert.equal(tsconfig.compilerOptions.outDir, "dist");
      assert.deepEqual(tsconfig.include, ["src"]);
    }
    assert.ok(!names.has(manifest.name));
    names.add(manifest.name);
    if (!web && !design) {
      assert.ok(source.includes(`name: "${expectedName}"`));
      assert.ok(source.includes(`kind: "${expectedKind}"`));
      assert.ok(source.includes(`status: "${activeContract ? "active" : "placeholder"}"`));
    }
    if (activeContract) {
      assert.deepEqual(manifest.exports["."], { types: "./dist/index.d.ts", import: "./dist/index.js" });
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
    "pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run test:ui && pnpm run secrets:check && pnpm run audit:dependencies",
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
  assert.deepEqual(turbo.tasks.typecheck.dependsOn, ["^typecheck", "^build"]);
});

test("keeps connector and governance dependencies pointed toward public vehicle contracts", () => {
  const connector = readJson("connectors/_sdk/package.json");
  const registry = readJson("packages/source-registry/package.json");
  const vehicle = readJson("packages/vehicle-schema/package.json");
  assert.deepEqual(registry.dependencies, { "@auto-world/vehicle-schema": "workspace:*" });
  assert.deepEqual(connector.dependencies, {
    "@auto-world/source-registry": "workspace:*",
    "@auto-world/vehicle-schema": "workspace:*",
  });
  assert.equal(vehicle.dependencies, undefined);
  assert.deepEqual(readJson("packages/demo-search-contract/package.json").dependencies, {
    "@auto-world/vehicle-schema": "workspace:*",
    "@auto-world/vehicle-taxonomy": "workspace:*",
  });
  assert.deepEqual(readJson("packages/vehicle-taxonomy/package.json").dependencies, {
    "@auto-world/vehicle-schema": "workspace:*",
  });
  assert.deepEqual(connector.files, ["dist"]);
  assert.deepEqual(readJson("packages/domain-events/package.json").dependencies, {
    "@auto-world/vehicle-schema": "workspace:*",
  });
  assert.equal(expectedBoundaries.length, 13);
});

test("keeps web primitives isolated from source and data-service authority", () => {
  const design = readJson("packages/design-system/package.json");
  const web = readJson("apps/web/package.json");
  assert.equal(design.dependencies, undefined);
  assert.deepEqual(Object.keys(design.peerDependencies), ["react"]);
  assert.deepEqual(Object.keys(web.dependencies).sort(), [
    "@auto-world/demo-search-contract",
    "@auto-world/design-system",
    "@auto-world/vehicle-schema",
    "next",
    "react",
    "react-dom",
  ]);

  const sourceRoot = path.join(root, "apps/web/src");
  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.tsx?$/u.test(entry.name)) sourceFiles.push(absolute);
    }
  };
  visit(sourceRoot);
  assert.ok(sourceFiles.length > 0);
  for (const absolute of sourceFiles) {
    const relative = path.relative(sourceRoot, absolute).replaceAll("\\", "/");
    const source = readFileSync(absolute, "utf8");
    assert.doesNotMatch(source,
      /(?:@auto-world\/(?:connector-sdk|source-registry|synthetic-connector)|@auto-world\/(?:demo-search-contract|vehicle-schema)\/|(?:connectors|services|source-registry|corpus|fixtures|test-support|packages\/(?:demo-search-contract|vehicle-schema))\/)/u,
      `${relative} must use only accepted public package entrypoints`);
    if (source.includes('"@auto-world/vehicle-schema"')) {
      assert.match(relative, /^demo\//u, `${relative} must keep vehicle validation inside demo helpers`);
    }
  }
});

test("isolates the synthetic connector from ordinary production imports and builds", () => {
  const manifest = readJson("connectors/synthetic/package.json");
  assert.equal(manifest.name, "@auto-world/synthetic-connector");
  assert.equal(manifest.version, "0.0.0");
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.files, []);
  assert.deepEqual(Object.keys(manifest.exports), ["./demo"]);
  assert.deepEqual(Object.keys(manifest.exports["./demo"]), ["auto-world-demo"]);
  assert.deepEqual(manifest.exports["./demo"]["auto-world-demo"], {
    types: "./demo/index.d.mts", import: "./demo/index.mjs",
  });
  assert.equal(manifest.dependencies, undefined);
  assert.match(read(".gitattributes"), /^connectors\/synthetic\/demo\/corpus\/\*\.json -text$/mu);
  assert.deepEqual(readJson("connectors/synthetic/turbo.json"), {
    extends: ["//"], tasks: { build: { outputs: [], cache: false } },
  });
  assert.deepEqual(manifest.devDependencies, {
    "@auto-world/connector-sdk": "workspace:*",
    "@auto-world/source-registry": "workspace:*",
    "@auto-world/vehicle-schema": "workspace:*",
    "@auto-world/vehicle-taxonomy": "workspace:*",
  });
  for (const gate of ["lint", "typecheck", "test", "build"]) {
    assert.equal(typeof manifest.scripts[gate], "string");
    assert.ok(!/\b(?:echo|exit 0|true)\b/u.test(manifest.scripts[gate]));
  }
  assert.match(manifest.scripts.test, /--conditions=auto-world-demo.*--test/u);
  assert.ok(!existsSync(path.join(root, "connectors/synthetic/dist")));
});

test("keeps public demo source free of SDK, fixtures and internal vehicle helpers", () => {
  const directory = "packages/demo-search-contract/src";
  const files = readdirSync(path.join(root, directory)).filter((file) => file.endsWith(".ts"));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotMatch(read(`${directory}/${file}`),
      /(?:@auto-world\/(?:connector-sdk|source-registry|synthetic-connector)|(?:connectors|_sdk|source-registry|corpus|fixtures)\/|test-support|vehicle-schema\/(?:src|dist))/u);
  }
  for (const file of readdirSync(path.join(root, "connectors/_sdk/src")).filter((name) => name.endsWith(".ts"))) {
    assert.doesNotMatch(read(`connectors/_sdk/src/${file}`), /(?:test-support|synthetic-connector|synthetic\/demo)/u);
  }
});

test("keeps taxonomy source independent of ingestion, UI, fixtures and private validators", () => {
  const directory = "packages/vehicle-taxonomy/src";
  const files = readdirSync(path.join(root, directory)).filter((file) => file.endsWith(".ts"));
  assert.ok(files.length > 0);
  assert.deepEqual(Object.keys(readJson("packages/vehicle-taxonomy/package.json").exports), ["."]);
  for (const file of files) {
    assert.doesNotMatch(read(`${directory}/${file}`),
      /(?:@auto-world\/(?:connector-sdk|source-registry|synthetic-connector|demo-search-contract|design-system)|(?:connectors|services|apps|fixtures|test-support)\/|vehicle-schema\/(?:src|dist))/u);
  }
});

test("keeps domain events isolated behind public canonical contracts", () => {
  const directory = "packages/domain-events/src";
  const files = readdirSync(path.join(root, directory), { recursive: true })
    .filter((file) => file.endsWith(".ts"));
  assert.ok(files.length > 0);
  const manifest = readJson("packages/domain-events/package.json");
  assert.deepEqual(Object.keys(manifest.exports), ["."]);
  assert.deepEqual(manifest.files, ["dist"]);
  assert.equal(manifest.devDependencies, undefined);
  for (const file of files) {
    const source = read(`${directory}/${file}`);
    assert.doesNotMatch(source,
      /(?:@auto-world\/(?:connector-sdk|source-registry|synthetic-connector|demo-search-contract|design-system|vehicle-taxonomy)|(?:connectors|services|apps|fixtures|test-support)\/|vehicle-schema\/)/u);
    for (const [, specifier] of source.matchAll(/\b(?:from\s+|import\s*\(?\s*)["']([^"']+)["']/gu)) {
      assert.ok(specifier === "@auto-world/vehicle-schema" || /^\.\/[^/]+\.js$/u.test(specifier),
        `${file} must import only public canonical contracts or local implementation`);
    }
  }
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
  assert.match(ci, /playwright install --with-deps chromium webkit/u);
  assert.match(ci, /run: pnpm test:ui$/mu);
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
