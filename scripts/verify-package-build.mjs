import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = process.cwd();
const manifestPath = path.join(packageRoot, "package.json");
const outputPath = path.join(packageRoot, "dist", "index.js");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outputUrl = pathToFileURL(outputPath);
outputUrl.searchParams.set("test", Date.now().toString());
const { workspaceBoundary } = await import(outputUrl.href);

assert.equal(workspaceBoundary.name, manifest.name);
assert.equal(workspaceBoundary.status, "placeholder");
assert.ok(
  ["app", "service", "package", "connector-sdk"].includes(
    workspaceBoundary.kind,
  ),
);

console.log(`Verified built workspace boundary: ${manifest.name}`);
