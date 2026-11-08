import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { createSearchPrototype } from "@auto-world/search/prototype";
import { SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE } from "@auto-world/synthetic-connector/demo";
import { lagAlert } from "../.prototype-dist/consumer.js";
import { assertStoredProfileRows, ProjectionRejected } from "../.prototype-dist/model.js";

const connection = { host: "127.0.0.1", port: 5432, workerPassword: "a".repeat(64), apiPassword: "b".repeat(64) };
function importInChild(conditions, env = {}) {
  return spawnSync(process.execPath, [...conditions.map((value) => `--conditions=${value}`),
    "--input-type=module", "--eval", 'await import("@auto-world/search/prototype")'],
  { cwd: new URL("../", import.meta.url), env: { ...process.env, ...env }, encoding: "utf8" });
}

test("search prototype is explicit and unavailable to production imports", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(manifest.exports), ["./prototype"]);
  assert.deepEqual(Object.keys(manifest.exports["./prototype"]), ["auto-world-prototype"]);
  const ordinary = importInChild([]);
  assert.notEqual(ordinary.status, 0);
  assert.match(ordinary.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/u);
  const production = importInChild(["auto-world-prototype"], { NODE_ENV: "production" });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /prototype_production_forbidden/u);
  for (const entry of await readdir(new URL("../dist/", import.meta.url))) {
    if (entry.endsWith(".js") || entry.endsWith(".d.ts")) {
      const content = await readFile(new URL(`../dist/${entry}`, import.meta.url), "utf8");
      assert.doesNotMatch(content, /prototype|synthetic|opensearch|\bpg\b/u);
    }
  }
});

for (const [name, overrides] of [
  ["remote host", { host: "192.0.2.1" }], ["zero port", { port: 0 }],
  ["fractional port", { port: 5432.5 }], ["invalid credential", { apiPassword: "invalid" }],
  ["shared worker/API credential", { apiPassword: connection.workerPassword }],
]) {
  test(`rejects ${name} before connecting`, () => {
    assert.throws(() => createSearchPrototype({ postgres: { ...connection, ...overrides }, opensearch: { port: 9200 } }),
      { message: "prototype_connection_invalid" });
  });
}

test("runtime construction is lazy and exposes the existing V1 read port", async () => {
  const runtime = createSearchPrototype({ postgres: connection, opensearch: { port: 9200 } });
  assert.deepEqual(Object.keys(runtime).sort(), ["assertProfile", "close", "consume", "health", "readPort", "reconcile", "reviewReplay"]);
  assert.deepEqual(Object.keys(runtime.readPort).sort(), ["getListing", "search"]);
  await assert.rejects(runtime.reviewReplay("not an operator reference"), { message: "search_review_invalid" });
  await runtime.close();
});

test("lag warning needs five continuous minutes strictly above sixty seconds", () => {
  assert.deepEqual(lagAlert({ halted: false, nowMs: 1000, lagMs: 60_000, slowSinceMs: null }), { alert: "none", slowSinceMs: null });
  assert.deepEqual(lagAlert({ halted: false, nowMs: 1000, lagMs: 60_001, slowSinceMs: null }), { alert: "none", slowSinceMs: 1000 });
  assert.equal(lagAlert({ halted: false, nowMs: 300999, lagMs: 60_001, slowSinceMs: 1000 }).alert, "none");
  assert.equal(lagAlert({ halted: false, nowMs: 301000, lagMs: 60_001, slowSinceMs: 1000 }).alert, "warning");
  assert.deepEqual(lagAlert({ halted: false, nowMs: 302000, lagMs: 10, slowSinceMs: 1000 }), { alert: "none", slowSinceMs: null });
  assert.equal(lagAlert({ halted: true, nowMs: 0, lagMs: 0, slowSinceMs: null }).alert, "critical");
});

test("stored canonical runs must already match the requested V2 profile before seed", () => {
  const descriptor = { name: "page-0001.json", byteLength: 42, sha256: "c".repeat(64) };
  const options = { fixtureVersion: "synthetic-prototype-web-v2", mapperVersion: "synthetic-prototype-web-mapper-v2",
    descriptors: [descriptor], catalog: { schemaVersion: 2, dataMode: "synthetic", fixtureVersion: "synthetic-prototype-web-v2",
      taxonomyRelease: SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE }, project() { return []; } };
  const checkpoint = { runId: "run_test", sourceId: "src_sdk_synthetic",
    scope: { scopeId: "scope_7d18dbe77c718e18cb036fbb21b1658a783498188d5b547ed5c5413a5c743414", territory: "FR", acquisitionMethod: "feed" },
    request: { sourceId: "src_sdk_synthetic", mapperVersion: options.mapperVersion } };
  const runs = [{ run_id: "run_test", checkpoint }];
  const rawPages = [{ run_id: "run_test", snapshot_id: "raw_test", sha256: descriptor.sha256,
    pending: { snapshotId: "raw_test", sha256: descriptor.sha256, byteLength: descriptor.byteLength,
      pageIdentity: `${options.fixtureVersion}:${descriptor.name}` } }];
  assert.doesNotThrow(() => assertStoredProfileRows(options, runs, rawPages));
  assert.throws(() => assertStoredProfileRows(options,
    [{ ...runs[0], checkpoint: { ...checkpoint, request: { ...checkpoint.request, mapperVersion: "synthetic-search-mapper-v1" } } }], rawPages),
  (error) => error instanceof ProjectionRejected && error.code === "projection_invalid");
  assert.throws(() => assertStoredProfileRows(options, runs,
    [{ ...rawPages[0], pending: { ...rawPages[0].pending, pageIdentity: "different:page-0001.json" } }]),
  (error) => error instanceof ProjectionRejected && error.code === "projection_invalid");
});
