import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allowedSourceHosts, loadPostgresSourceClosureManifest,
  validatePostgresSourceClosureManifest } from "../scripts/postgres-image/source-closure-manifest.mjs";

const INVALID = { message: "postgres_source_closure_manifest_invalid" };
const fixture = () => JSON.parse(JSON.stringify(loadPostgresSourceClosureManifest()));
const item = (value, role) => value.materials.find(material => material.role === role);
const rejectMutation = mutate => {
  const value = fixture(); mutate(value);
  assert.throws(() => validatePostgresSourceClosureManifest(value), INVALID);
};

test("reviewed data contains exactly 34 recipes, 266 sources, 22 hooks and the older Go pin", () => {
  const value = loadPostgresSourceClosureManifest();
  assert.equal(value.kind, "POSTGRES_SOURCE_CLOSURE_MATERIALS_V1");
  assert.equal(value.materials.length, 323);
  assert.deepEqual(value.materials.reduce((counts, material) => {
    counts[material.role] = (counts[material.role] ?? 0) + 1; return counts;
  }, {}), { GO_STDLIB_SOURCE: 1, INSTALL_HOOK: 20, TRIGGER: 2, SOURCE_AUX: 84,
    SOURCE_ARCHIVE: 35, SOURCE_PATCH: 147, APORTS_RECIPE: 34 });
  assert.equal(new Set(value.materials.filter(v => v.role === "APORTS_RECIPE").map(v => v.origin)).size, 34);
  assert.equal(new Set(value.materials.filter(v => v.expected.sha512).map(v => v.expected.sha512)).size, 266);
  assert.equal(new Set(value.materials.filter(v => v.role === "INSTALL_HOOK" || v.role === "TRIGGER").map(v => v.commit)).size, 8);
  assert.deepEqual(value.materials.map(v => v.id), [...value.materials.map(v => v.id)].sort());
  const bytes = readFileSync(new URL("../infra/postgres-image/source-closure-materials.json", import.meta.url));
  assert.equal(bytes.length, 180448);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "2bae01738e73e1851794d28ba52ce9161bd85b38df6f33d9e7d67c225cc8cc5f");
});

test("metadata expectations cannot grant admission or activate support", () => {
  const value = loadPostgresSourceClosureManifest();
  assert.deepEqual(value.claims, {
    authority: "DECLARED_MATERIAL_EXPECTATIONS_ONLY", historicalIntegrity: "NOT_ESTABLISHED",
    sourceClosure: "NOT_ESTABLISHED", noticeClosure: "NOT_ESTABLISHED", layerCoverage: "NOT_ESTABLISHED",
    legalCompliance: "NOT_EVALUATED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED",
    admission: "NOT_AUTHORIZED", retentionAccepted: false, signing: "NOT_ATTEMPTED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
  });
  for (const key of Object.keys(value.claims)) {
    rejectMutation(candidate => { candidate.claims[key] = candidate.claims[key] === null ? "2026-10-01T00:00:00.000Z" : true; });
  }
});

test("loader and pure validator return deeply frozen detached records", () => {
  const original = fixture(); const value = validatePostgresSourceClosureManifest(original);
  assert.deepEqual(value, original); assert.notEqual(value, original);
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.materials));
  assert.ok(Object.isFrozen(value.claims)); assert.ok(Object.isFrozen(allowedSourceHosts));
  for (const material of value.materials) {
    assert.ok(Object.isFrozen(material)); assert.ok(Object.isFrozen(material.expected));
  }
  original.materials[0].expected.sha256 = "0".repeat(64);
  assert.notEqual(value.materials[0].expected.sha256, original.materials[0].expected.sha256);
  assert.throws(() => { value.claims.admission = "AUTHORIZED"; }, TypeError);
});

test("hooks bind exact Git blob bytes and preserve the three observed symlink modes", () => {
  const value = loadPostgresSourceClosureManifest();
  const links = value.materials.filter(v => v.expected.gitMode === "120000");
  assert.deepEqual(links.map(v => [v.path, v.expected.size, v.expected.gitBlobSha1]), [
    ["main/alpine-baselayout/alpine-baselayout.post-upgrade", 30, "0e73fc07f3bfd966d5ed2e4be2a4838422dab0ed"],
    ["main/bash/bash.post-upgrade", 17, "85d6a8aac6bcf550f4e66ae65dc9884588d05e24"],
    ["main/openldap/openldap-lloadd.pre-install", 20, "d4fb5656dd90c476239c2b9c6fde1a0c85b544ab"],
  ]);
  for (const hook of links) {
    assert.equal(hook.expected.gitType, "blob");
    assert.equal(hook.expected.sha256, null); assert.equal(hook.expected.sha512, null);
    rejectMutation(candidate => { candidate.materials.find(v => v.id === hook.id).expected.gitMode = "100644"; });
  }
  const hooks = value.materials.filter(v => v.role === "INSTALL_HOOK" || v.role === "TRIGGER");
  assert.equal(hooks.reduce((sum, v) => sum + v.expected.size, 0), 7208);
});

test("declared paths retain 18 key filenames with @ and the musl leading underscore", () => {
  const value = loadPostgresSourceClosureManifest();
  const keys = value.materials.filter(v => v.origin === "alpine-keys");
  assert.equal(keys.filter(v => v.path.includes("@")).length, 18);
  assert.ok(keys.every(v => !v.id.includes("@")));
  assert.ok(value.materials.some(v => v.path === "main/musl/__stack_chk_fail_local.c"));
  const community = value.materials.filter(v => v.path.startsWith("community/"));
  assert.equal(community.length, 3); assert.ok(community.every(v => v.origin === "nss_wrapper"));
  assert.deepEqual(item(value, "GO_STDLIB_SOURCE"), {
    id: "go1.24.6", role: "GO_STDLIB_SOURCE", origin: null, commit: null,
    path: "go1.24.6.src.tar.gz", url: "https://dl.google.com/go/go1.24.6.src.tar.gz",
    expected: { sha256: "e1cb5582aab588668bc04c07de18688070f6b8c9b2aaf361f821e19bd47cfdbd",
      sha512: null, gitBlobSha1: null, size: 30794139, gitMode: null, gitType: null },
  });
});

test("duplicates, omissions, reordering and extra materials are refused", () => {
  const changes = [
    v => { v.materials.pop(); }, v => { v.materials.push(v.materials[0]); },
    v => { v.materials[1] = v.materials[0]; },
    v => { [v.materials[1], v.materials[2]] = [v.materials[2], v.materials[1]]; },
    v => { v.materials[1].id = v.materials[0].id; },
    v => { v.materials[1].path = v.materials[0].path; },
    v => { item(v, "SOURCE_PATCH").expected.sha512 = item(v, "SOURCE_AUX").expected.sha512; },
  ];
  for (const change of changes) rejectMutation(change);
});

test("expected fields cannot change algorithms, absent hashes, sizes, mode or type", () => {
  const changes = [
    v => { item(v, "APORTS_RECIPE").expected.sha256 = "0".repeat(64); },
    v => { item(v, "APORTS_RECIPE").expected.size++; },
    v => { item(v, "SOURCE_ARCHIVE").expected.sha512 = "0".repeat(128); },
    v => { item(v, "SOURCE_ARCHIVE").expected.sha256 = "0".repeat(64); },
    v => { item(v, "SOURCE_ARCHIVE").expected.size = 1; },
    v => { item(v, "SOURCE_ARCHIVE").expected.sha512 = item(v, "SOURCE_ARCHIVE").expected.sha512.toUpperCase(); },
    v => { item(v, "INSTALL_HOOK").expected.gitBlobSha1 = "0".repeat(40); },
    v => { item(v, "INSTALL_HOOK").expected.gitMode = "040000"; },
    v => { item(v, "INSTALL_HOOK").expected.gitType = "tree"; },
    v => { item(v, "INSTALL_HOOK").expected.size = -1; },
    v => { item(v, "GO_STDLIB_SOURCE").expected.size = Number.MAX_SAFE_INTEGER + 1; },
    v => { delete item(v, "APORTS_RECIPE").expected.sha512; },
  ];
  for (const change of changes) rejectMutation(change);
});

test("HTTP, credentials, unreviewed hosts, noncanonical and decorated URLs are refused", () => {
  const original = item(fixture(), "APORTS_RECIPE").url;
  const urls = [
    original.replace("https:", "http:"), original.replace("https://", "https://user:password@"),
    original.replace("raw.githubusercontent.com", "raw.githubusercontent.com.example.test"),
    original.replace("raw.githubusercontent.com", "RAW.githubusercontent.com"),
    original.replace("raw.githubusercontent.com", "raw.githubusercontent.com:443"),
    `${original}?token=fixture`, `${original}#fragment`, `${original}/../APKBUILD`,
    original.replace("APKBUILD", "%41PKBUILD"), original.replace("/main/", "/main//"),
    original.replace("/main/", "/main\\"), `${original}\n`, "file:///fixture", "https://127.0.0.1/fixture",
  ];
  for (const url of urls) rejectMutation(v => { item(v, "APORTS_RECIPE").url = url; });
  assert.equal(allowedSourceHosts.length, 21);
  assert.ok(loadPostgresSourceClosureManifest().materials.every(v => allowedSourceHosts.includes(new URL(v.url).hostname)));
});

test("coherently replacing committed recipe and source relationships cannot choose new expectations", () => {
  rejectMutation(value => {
    for (const material of value.materials.filter(v => v.origin === "bash")) {
      const oldCommit = material.commit; material.commit = "0".repeat(40);
      material.url = material.url.replace(oldCommit, material.commit);
    }
  });
  rejectMutation(value => {
    for (const material of value.materials.filter(v => v.origin === "nss_wrapper")) {
      material.path = material.path.replace("community/", "main/");
      material.url = material.url.replace("/community/", "/main/");
    }
  });
  rejectMutation(value => {
    const material = item(value, "SOURCE_PATCH");
    material.url = "https://ftp.gnu.org/gnu/reviewed-host-unreviewed-path.patch";
  });
});

test("commit, origin, category, safe ID, role, kind and subject substitutions are refused", () => {
  const changes = [
    v => { v.kind = "POSTGRES_SOURCE_CLOSURE_MATERIALS_V2"; },
    v => { v.subject = v.subject.replace("0045", "0000"); },
    v => { item(v, "SOURCE_PATCH").role = "SOURCE_AUX"; },
    v => { item(v, "SOURCE_PATCH").origin = "foreign"; },
    v => { item(v, "SOURCE_PATCH").commit = "a".repeat(40); },
    v => { item(v, "SOURCE_PATCH").path = "main/../foreign.patch"; },
    v => { item(v, "SOURCE_PATCH").path += "/nested"; },
    v => { item(v, "SOURCE_PATCH").id = "../destination"; },
    v => { item(v, "SOURCE_PATCH").id = "x".repeat(193); },
    v => { item(v, "GO_STDLIB_SOURCE").commit = "a".repeat(40); },
  ];
  for (const change of changes) rejectMutation(change);
});

test("all records are closed data descriptors without getters, hidden keys, symbols or prototypes", () => {
  let reads = 0;
  const selections = [value => value, value => value.claims,
    value => value.materials[0], value => value.materials[0].expected];
  for (const select of selections) {
    for (const decoration of [
      target => { target.extra = true; },
      target => { target[Symbol("fixture")] = true; },
      target => { Object.setPrototypeOf(target, {}); },
      target => { Object.setPrototypeOf(target, null); },
      target => { const key = Object.keys(target)[0]; Object.defineProperty(target, key, { value: target[key], enumerable: false }); },
      target => { const key = Object.keys(target)[0]; Object.defineProperty(target, key, { enumerable: true, get() { reads++; return "private fixture"; } }); },
    ]) rejectMutation(value => decoration(select(value)));
  }
  assert.equal(reads, 0);
});

test("material array refuses holes, hidden items, symbols, getters and prototype replacements", () => {
  let reads = 0;
  const changes = [
    v => { delete v.materials[3]; }, v => { v.materials.extra = true; },
    v => { v.materials[Symbol("fixture")] = true; },
    v => { Object.setPrototypeOf(v.materials, Object.prototype); },
    v => { Object.defineProperty(v.materials, "3", { value: v.materials[3], enumerable: false }); },
    v => { Object.defineProperty(v.materials, "3", { get() { reads++; return null; }, enumerable: true }); },
  ];
  for (const change of changes) rejectMutation(change);
  assert.equal(reads, 0);
});

test("string fields reject arrays and coercion objects without running code", () => {
  let reads = 0;
  const fields = ["id", "role", "origin", "commit", "path", "url"];
  for (const field of fields) {
    rejectMutation(v => { const material = item(v, "APORTS_RECIPE"); material[field] = [material[field]]; });
    rejectMutation(v => { item(v, "APORTS_RECIPE")[field] = { toString() { reads++; return "fixture"; } }; });
  }
  for (const field of ["sha256", "size"]) {
    rejectMutation(v => { const proof = item(v, "APORTS_RECIPE").expected; proof[field] = [proof[field]]; });
  }
  for (const field of ["gitBlobSha1", "gitMode", "gitType"]) {
    rejectMutation(v => { const proof = item(v, "INSTALL_HOOK").expected; proof[field] = [proof[field]]; });
  }
  assert.equal(reads, 0);
});

test("failures mask exceptional input without raw messages, causes or additional fields", () => {
  const exceptional = new Proxy({}, { getPrototypeOf() { throw new Error("private fixture secret"); } });
  for (const value of [undefined, null, true, "fixture", [], exceptional]) {
    assert.throws(() => validatePostgresSourceClosureManifest(value), error => {
      assert.equal(error.message, INVALID.message); assert.deepEqual(Object.keys(error), []);
      assert.equal(error.cause, undefined); assert.ok(!error.stack.includes("private fixture secret")); return true;
    });
  }
});
