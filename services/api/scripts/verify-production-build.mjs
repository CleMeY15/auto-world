import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.deepEqual(manifest.files, ["dist"]);
assert.deepEqual(Object.keys(manifest.exports), ["."]);
assert.equal(manifest.dependencies.fastify, "5.12.7");
assert.equal(manifest.devDependencies["@types/node"], "22.20.2");
assert.equal(manifest.dependencies["@auto-world/connector-sdk"], undefined);
assert.equal(manifest.dependencies["@auto-world/synthetic-connector"], undefined);
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      assert.notEqual(entry.name, "demo");
      visit(target);
    } else if (/\.(?:js|ts)$/u.test(entry.name)) {
      const source = readFileSync(target, "utf8");
      assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()["'][^"']*(?:connectors|test-support|synthetic-connector|connector-sdk|services\/ingestion|\/demo\/)/u);
    }
  }
};
visit(path.join(root, "dist"));
console.log("API production build excludes synthetic composition and SDK test support.");
