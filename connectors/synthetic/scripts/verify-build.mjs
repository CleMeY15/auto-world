import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { SYNTHETIC_CORPUS_MANIFEST } from "../demo/manifest.mjs";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
assert.deepEqual(packageJson.files, []);
assert.deepEqual(Object.keys(packageJson.exports), ["./demo"]);
assert.deepEqual(Object.keys(packageJson.exports["./demo"]), ["auto-world-demo"]);
assert.deepEqual(Object.keys(packageJson.exports["./demo"]["auto-world-demo"]).sort(), ["import", "types"]);
assert.equal(Object.hasOwn(packageJson.exports, "."), false);
assert.equal(Object.hasOwn(packageJson, "dependencies"), false);
assert.deepEqual(Object.keys(packageJson.devDependencies).sort(), [
  "@auto-world/connector-sdk",
  "@auto-world/source-registry",
  "@auto-world/vehicle-schema",
]);
for (const forbidden of ["main", "module", "bin", "start", "deploy"]) {
  assert.equal(Object.hasOwn(packageJson, forbidden), false, forbidden);
}

const topLevel = await readdir(root);
for (const forbidden of ["dist", "src", "Dockerfile", "docker-compose.yml"]) {
  assert.equal(topLevel.includes(forbidden), false, forbidden);
}

for (const descriptor of Object.values(SYNTHETIC_CORPUS_MANIFEST.files)) {
  const bytes = await readFile(new URL(`demo/corpus/${descriptor.name}`, root));
  assert.equal(bytes.byteLength, descriptor.byteLength, descriptor.name);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256, descriptor.name);
}

const demoModules = ["demo/adapter.mjs", "demo/harness.mjs", "demo/index.mjs", "demo/manifest.mjs"];
for (const file of demoModules) {
  const source = await readFile(new URL(file, root), "utf8");
  assert.match(source, /^import "\.\/guard\.mjs";/, file);
  assert.doesNotMatch(source, /(?:services\/|DemoReadPort|createSyntheticDemoReadPort|@auto-world\/demo-search-contract)/, file);
  const imports = [...source.matchAll(/(?:from\s+|import\s+)["']([^"']+)["']/g)].map((match) => match[1]);
  for (const specifier of imports) {
    assert.ok(specifier.startsWith("node:") || specifier.startsWith("./") ||
      specifier === "@auto-world/connector-sdk" || specifier === "../../_sdk/test-support/index.mjs",
    `${file}:${specifier}`);
  }
}
await access(new URL("demo/index.d.mts", root));
