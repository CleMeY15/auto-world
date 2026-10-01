import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadPostgresSourceClosureManifest } from "../scripts/postgres-image/source-closure-manifest.mjs";
import { loadPostgresSourceCoverageManifest, postgresSourceCoveragePin,
  validatePostgresSourceCoverageManifest } from "../scripts/postgres-image/source-coverage-manifest.mjs";

const INVALID = { message: "postgres_source_coverage_manifest_invalid" };
const fixture = () => JSON.parse(JSON.stringify(loadPostgresSourceCoverageManifest()));
const reject = change => { const value = fixture(); change(value); assert.throws(() => validatePostgresSourceCoverageManifest(value), INVALID); };

test("reviewed associations pin complete source, package, layer and notice coverage", () => {
  const value = loadPostgresSourceCoverageManifest();
  const bytes = readFileSync(new URL("../infra/postgres-image/source-coverage.json", import.meta.url));
  assert.equal(bytes.length, postgresSourceCoveragePin.bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), postgresSourceCoveragePin.sha256);
  assert.equal(value.subject, loadPostgresSourceClosureManifest().subject);
  for (const [key, count] of Object.entries({ components: 50, origins: 35, layers: 12, sourceArchives: 42,
    nonArchiveMaterials: 287, rundeps: 22, nonArchiveClassifications: 19, embeddedNoticeSources: 2, provenance: 17 })) {
    assert.equal(value[key].length, count);
  }
  assert.equal(value.nonArchiveMaterials.reduce((sum, v) => sum + v.size, 0), 767313);
  const candidates = value.sourceArchives.flatMap(v => v.candidates);
  assert.equal(candidates.length, 283);
  assert.equal(candidates.filter(v => v.type === "REGULAR_FILE").length, 280);
  assert.equal(candidates.filter(v => v.type === "DIRECTORY").length, 3);
  assert.equal(new Set(candidates.filter(v => v.sha256).map(v => v.sha256)).size, 158);
  assert.equal(value.layerCounts.historicalRecordOccurrences, 123);
  assert.equal(value.layerCounts.finalPackages, 46);
  assert.equal(value.historicalGosu.declarations.length, 4);
  for (const id of ["PASSIVE_LAYER_METADATA_PROJECTION", "EMBEDDED_NOTICE_METADATA_PROJECTION"]) {
    assert.ok(value.provenance.some(v => v.id === id));
  }
});

test("every declared nonarchive and pointer stays bound to its exact manifest material", () => {
  const value = loadPostgresSourceCoverageManifest(), manifest = loadPostgresSourceClosureManifest();
  for (const item of value.nonArchiveMaterials) {
    const material = manifest.materials.find(v => v.id === item.id);
    assert.ok(material);
    for (const key of ["role", "origin", "commit", "path", "url"]) assert.equal(item[key], material[key]);
    for (const key of ["sha256", "sha512", "gitBlobSha1", "size"]) {
      if (material.expected[key] !== null) assert.equal(item[key], material.expected[key]);
    }
  }
  const pointers = value.nonArchiveMaterials.filter(v => v.pointerAssociation);
  assert.equal(pointers.length, 3);
  for (const item of pointers) {
    assert.equal(item.declaredGitMode, "120000"); assert.equal(item.pointerAssociation.targetFollowed, false);
    const target = value.nonArchiveMaterials.find(v => v.id === item.pointerAssociation.targetMaterialId);
    assert.ok(target); assert.equal(target.commit, item.commit); assert.equal(target.origin, item.origin);
  }
});

test("metadata cannot authorize execution, elevate closure or begin support", () => {
  const claims = loadPostgresSourceCoverageManifest().claims;
  assert.deepEqual(claims, { admission: "NOT_AUTHORIZED", archivesRetainUntil: null, authority: "NONE",
    binaryReproduction: "NOT_ESTABLISHED", currentness: "NOT_EVALUATED", historicalIntegrity: "BYTE_PINNED_METADATA_ASSOCIATIONS",
    legalCompliance: "NOT_EVALUATED", noticeClosure: "NOT_ESTABLISHED", runtimePermission: "NOT_GRANTED",
    sourceClosure: "NOT_ESTABLISHED", supportEndsAt: null, supportStartsAt: null });
  for (const key of Object.keys(claims)) reject(v => { v.claims[key] = claims[key] === null ? "2026-10-01T00:00:00Z" : "AUTHORIZED"; });
});

test("coherent provenance, source, dependency, layer and pointer substitutions are refused", () => {
  for (const mutate of [
    v => { v.provenance.pop(); }, v => { v.provenance[0].sha256 = "0".repeat(64); },
    v => { v.nonArchiveMaterials[0].size++; }, v => { v.sourceArchives[0].source.sha256 = "0".repeat(64); },
    v => { v.sourceArchives.find(x => x.candidates.length).candidates[0].sha256 = "0".repeat(64); },
    v => { v.layers[11].apkDatabase.sha256 = "0".repeat(64); }, v => { v.rundeps[0].P = v.rundeps[1].P; },
    v => { v.nonArchiveMaterials.find(x => x.pointerAssociation).pointerAssociation.targetFollowed = true; },
    v => { v.historicalGosu.declarations[0].version = "v1.20.0"; },
    v => { for (const x of v.nonArchiveMaterials) if (x.origin === "bash") x.commit = "0".repeat(40);
      v.origins.find(x => x.origin === "bash").commit = "0".repeat(40); },
    v => { v.origins[0].privatePath = "/home/fixture"; }, v => { v.components.reverse(); },
  ]) reject(mutate);
});

test("detached immutable canonical data permits object key order changes only", () => {
  const input = fixture(); const result = validatePostgresSourceCoverageManifest(Object.fromEntries(Object.entries(input).reverse()));
  assert.deepEqual(result, input); assert.notEqual(result, input);
  function frozen(v) { if (v && typeof v === "object") { assert.ok(Object.isFrozen(v)); for (const x of Object.values(v)) frozen(x); } }
  frozen(result); assert.ok(Object.isFrozen(postgresSourceCoveragePin));
  input.provenance[0].size++; assert.notEqual(input.provenance[0].size, result.provenance[0].size);
  assert.throws(() => { result.claims.authority = "ADMIN"; }, TypeError);
});

test("nested getters, hidden fields, symbols, prototypes and array holes never become trusted data", () => {
  let reads = 0;
  for (const select of [v => v, v => v.claims, v => v.provenance[0], v => v.nonArchiveMaterials.find(x => x.pointerAssociation).pointerAssociation]) {
    for (const decorate of [
      target => { const key = Object.keys(target)[0]; Object.defineProperty(target, key, { enumerable: true, get() { reads++; return null; } }); },
      target => { target[Symbol("fixture")] = true; }, target => { Object.defineProperty(target, "hidden", { value: true }); },
      target => { Object.setPrototypeOf(target, null); }, target => { target.toJSON = () => { reads++; return {}; }; },
    ]) reject(v => decorate(select(v)));
  }
  for (const mutate of [v => { delete v.provenance[1]; }, v => { v.provenance.extra = true; },
    v => { Object.defineProperty(v.provenance, "1", { enumerable: true, get() { reads++; return null; } }); },
    v => { v.provenance[Symbol("fixture")] = true; }, v => { v.loop = v; },
    v => { v.provenance[0].size = -0; }, v => { v.provenance[0].size = NaN; },
    v => { v.subject = "x".repeat(8193); },
  ]) reject(mutate);
  assert.equal(reads, 0);
});

test("inherited serialization hooks are never invoked and cannot substitute authorized claims", () => {
  for (const prototype of [Object.prototype, Array.prototype]) {
    const value = fixture(), original = Object.getOwnPropertyDescriptor(prototype, "toJSON");
    value.claims.authority = "AUTHORIZED";
    let calls = 0;
    Object.defineProperty(prototype, "toJSON", { configurable: true, value() { calls++; return loadPostgresSourceCoverageManifest(); } });
    try {
      assert.throws(() => validatePostgresSourceCoverageManifest(value), INVALID);
      assert.equal(calls, 0);
    } finally {
      if (original) Object.defineProperty(prototype, "toJSON", original); else delete prototype.toJSON;
    }
  }
});

test("exceptional inputs are bounded and fail without leaking original errors", () => {
  const proxy = new Proxy({}, { getPrototypeOf() { throw new Error("private input detail"); } });
  const deep = {}; let parent = deep;
  for (let i = 0; i < 30; i++) { parent.child = {}; parent = parent.child; }
  for (const value of [null, undefined, "text", 1, true, [], proxy, deep, { values: new Array(8193).fill(null) }]) {
    assert.throws(() => validatePostgresSourceCoverageManifest(value), error => {
      assert.equal(error.message, INVALID.message); assert.deepEqual(Object.keys(error), []);
      assert.equal(error.cause, undefined); assert.ok(!error.stack.includes("private input detail")); return true;
    });
  }
});
