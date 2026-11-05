import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { createPostgresPrototype } from "@auto-world/ingestion/prototype";

const cwd = new URL("../", import.meta.url);
const specifier = "@auto-world/ingestion/prototype";

function runImport({ conditions = [], environment = {} } = {}) {
  return spawnSync(process.execPath, [
    ...conditions.map((condition) => `--conditions=${condition}`),
    "--input-type=module",
    "--eval",
    `await import(${JSON.stringify(specifier)})`,
  ], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    return entry.isDirectory() ? filesBelow(url) : [url];
  }));
  return nested.flat();
}

test("exports the PostgreSQL prototype only under its explicit condition", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), ["./prototype"]);
  assert.deepEqual(Object.keys(manifest.exports["./prototype"]), ["auto-world-prototype"]);
});

test("refuses the prototype subpath without the prototype condition", () => {
  const result = runImport();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
});

test("refuses the prototype entrypoint in production", () => {
  const result = runImport({
    conditions: ["auto-world-prototype"],
    environment: { NODE_ENV: "production" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /prototype_production_forbidden/);
});

test("keeps prototype code and fixture references out of the ordinary dist", async () => {
  const dist = new URL("../dist/", import.meta.url);
  const files = await filesBelow(dist);
  assert.ok(files.length > 0, "ordinary dist must exist before its boundary is inspected");
  for (const file of files) {
    assert.doesNotMatch(file.pathname.slice(dist.pathname.length), /prototype|fixture|synthetic/iu);
    if (/\.(?:js|d\.ts)$/u.test(file.pathname)) {
      const content = await readFile(file, "utf8");
      assert.doesNotMatch(content, /prototype|synthetic-connector|connectors\/synthetic/iu);
    }
  }
});

for (const [name, config] of [
  ["non-loopback host", { host: "192.0.2.1", port: 5432, password: "a".repeat(64) }],
  ["zero port", { host: "127.0.0.1", port: 0, password: "a".repeat(64) }],
  ["fractional port", { host: "127.0.0.1", port: 5432.5, password: "a".repeat(64) }],
  ["non-hex password", { host: "127.0.0.1", port: 5432, password: "z".repeat(64) }],
  ["short password", { host: "127.0.0.1", port: 5432, password: "a".repeat(63) }],
]) {
  test(`rejects ${name} before opening a PostgreSQL pool`, () => {
    assert.throws(() => createPostgresPrototype(config), { message: "prototype_connection_invalid" });
  });
}

test("accepts an IPv6 loopback configuration without opening a connection eagerly", async () => {
  const prototype = createPostgresPrototype({ host: "::1", port: 5432, password: "a".repeat(64) });
  assert.deepEqual(Object.keys(prototype).sort(), ["close", "lease", "store"]);
  await prototype.close();
});
