import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compareFilesystemInventoriesV2,
  validateCandidateConfigurationV2,
  validateCandidateFilesystemV2,
} from "../scripts/postgres-image/gosu-derivative-filesystem-v2.mjs";
import {
  candidateContractV2,
  openCandidateLockV2,
} from "../scripts/postgres-image/gosu-derivative-candidate-v2.mjs";

const FILESYSTEM_ERROR = "postgres_gosu_derivative_filesystem_delta_invalid";
const CONFIG_ERROR = "postgres_gosu_derivative_config_delta_invalid";
const BUILD_WINDOW = Object.freeze({ startedAtMs: 200_000, completedAtMs: 205_999 });
const EVIDENCE_NAMES = Object.freeze([
  "gosu-LICENSE",
  "moby-user-LICENSE",
  "go-LICENSE",
  "go-PATENTS",
  "x-sys-LICENSE",
  "x-sys-PATENTS",
  "notices.json",
  "module-closure.json",
  "sbom.cdx.json",
  "version.txt",
  "build-info.txt",
  "derivative-manifest.json",
]);
const PARENT_PATHS = Object.freeze([
  "usr",
  "usr/local",
  "usr/local/bin",
  "usr/share",
  "usr/share/licenses",
  "usr/share/licenses/auto-world-gosu",
]);

const plainClone = (value) => JSON.parse(JSON.stringify(value));
const sha = (index) => (index % 16).toString(16).repeat(64);
const file = (path, sha256, { mode = 0o644, uid = 0, gid = 0, mtime = 100, size = 10 } = {}) =>
  ({ path, type: "file", mode, uid, gid, mtime, size, sha256 });
const directory = (path, { mode = 0o755, uid = 0, gid = 0, mtime = 100 } = {}) =>
  ({ path, type: "directory", mode, uid, gid, mtime, size: 0 });
const symlink = (path, linkname, { mode = 0o777, uid = 0, gid = 0, mtime = 100, size = 0 } = {}) =>
  ({ path, type: "symlink", mode, uid, gid, mtime, size, linkname });
const hardlink = (path, linkname, target) => ({
  path,
  type: "hardlink",
  mode: target.mode,
  uid: target.uid,
  gid: target.gid,
  mtime: target.mtime,
  size: 0,
  linkname,
});

function strictConfig() {
  return {
    AttachStderr: false,
    AttachStdin: false,
    AttachStdout: false,
    Cmd: ["postgres"],
    Domainname: "",
    Entrypoint: ["docker-entrypoint.sh"],
    Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "PG_MAJOR=17"],
    ExposedPorts: { "5432/tcp": {} },
    Healthcheck: null,
    Hostname: "",
    Image: "sha256:base-config-builder-identity",
    Labels: { "org.opencontainers.image.base.name": "docker.io/library/postgres:17.11-alpine3.24" },
    NetworkDisabled: false,
    OnBuild: null,
    OpenStdin: false,
    StdinOnce: false,
    StopSignal: "SIGINT",
    Tty: false,
    User: "",
    Volumes: { "/var/lib/postgresql/data": {} },
    WorkingDir: "",
  };
}

function syntheticExpectation() {
  const prefix = "usr/share/licenses/auto-world-gosu/";
  return {
    baseExecutable: file("usr/local/bin/gosu", sha(1), { mode: 0o755, mtime: 123, size: 17 }),
    replacement: file("usr/local/bin/gosu", sha(2), { mode: 0o755, mtime: 0, size: 23 }),
    evidenceFiles: EVIDENCE_NAMES.map((name, index) => file(`${prefix}${name}`, sha(index + 3), {
      mtime: 0,
      size: index + 1,
    })),
    parentPaths: PARENT_PATHS.map((path, index) => ({
      path,
      creation: { mode: 0o755, uid: 0, gid: 0 },
      mtimePolicy: index === PARENT_PATHS.length - 1 ? "ZERO" : "BUILD_WINDOW",
    })),
    mtimeWindow: { startSeconds: 200, endSeconds: 205 },
  };
}

function syntheticFixture() {
  const expectation = syntheticExpectation();
  const sharedTarget = file("usr/lib/libfixture.so", sha(14), { mtime: 77, size: 31 });
  const baseEntries = [
    directory("usr"),
    directory("usr/local"),
    directory("usr/local/bin"),
    directory("usr/share"),
    directory("usr/share/licenses"),
    directory("usr/lib", { mtime: 77 }),
    expectation.baseExecutable,
    file("usr/local/bin/docker-entrypoint.sh", sha(15), { mode: 0o755, size: 501 }),
    directory("etc"),
    directory("etc/apk"),
    file("etc/apk/world", sha(10), { size: 80 }),
    directory("lib"),
    directory("lib/apk"),
    directory("lib/apk/db"),
    file("lib/apk/db/installed", sha(11), { size: 900 }),
    sharedTarget,
    hardlink("usr/lib/libfixture-hard.so", sharedTarget.path, sharedTarget),
    symlink("usr/lib/libfixture-current.so", "libfixture.so", { mtime: 77, size: 13 }),
  ].map((entry) => ({ ...entry }));
  const candidateEntries = baseEntries.map((entry) => ({ ...entry }));
  candidateEntries.splice(candidateEntries.findIndex((entry) => entry.path === expectation.baseExecutable.path), 1,
    { ...expectation.replacement });
  candidateEntries.find((entry) => entry.path === "usr/local/bin").mtime = 203;
  candidateEntries.find((entry) => entry.path === "usr/share/licenses").mtime = 204;
  candidateEntries.push(directory("usr/share/licenses/auto-world-gosu", { mtime: 0 }));
  candidateEntries.push(...expectation.evidenceFiles.map((entry) => ({ ...entry })));
  return { baseEntries, candidateEntries, expectation };
}

function compare(fixture = syntheticFixture()) {
  return compareFilesystemInventoriesV2(fixture);
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error?.message, code);
    return true;
  });
}

test("the explicit SYNTHETIC fixture accepts only the same-path gosu replacement and twelve evidence files", () => {
  const result = compare();
  assert.deepEqual(result, {
    scope: "FILESYSTEM_PREDICATE_MATCH_ONLY",
    authority: "NOT_AUTHORIZED",
    baseMembers: 18,
    candidateMembers: 31,
    replaced: ["usr/local/bin/gosu"],
    addedFiles: EVIDENCE_NAMES.map((name) => `usr/share/licenses/auto-world-gosu/${name}`).sort(),
    addedDirectories: ["usr/share/licenses/auto-world-gosu"],
    mtimeChangedDirectories: ["usr/local/bin", "usr/share/licenses"],
  });
  assert.ok(Object.isFrozen(result));
  for (const key of ["replaced", "addedFiles", "addedDirectories", "mtimeChangedDirectories"]) {
    assert.ok(Object.isFrozen(result[key]));
  }
});

test("unchanged APK records and inherited symlink and hardlink records remain byte-for-byte metadata contracts", () => {
  for (const mutate of [
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "etc/apk/world").sha256 = sha(9); },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "lib/apk/db/installed").mode = 0o600; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("-current.so")).linkname = "other.so"; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("-hard.so")).mtime += 1; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "usr/lib/libfixture.so").sha256 = sha(8); },
  ]) {
    const fixture = syntheticFixture();
    mutate(fixture);
    expectCode(() => compare(fixture), FILESYSTEM_ERROR);
  }
});

test("caller inventory order carries no authority, including a hardlink listed before its exact target", () => {
  const fixture = syntheticFixture();
  for (const entries of [fixture.baseEntries, fixture.candidateEntries]) {
    const targetIndex = entries.findIndex((entry) => entry.path === "usr/lib/libfixture.so");
    const hardlinkIndex = entries.findIndex((entry) => entry.path === "usr/lib/libfixture-hard.so");
    const [hardlinkEntry] = entries.splice(hardlinkIndex, 1);
    entries.splice(targetIndex, 0, hardlinkEntry);
  }
  const result = compare(fixture);
  assert.deepEqual(result.replaced, ["usr/local/bin/gosu"]);
});

test("unlisted payloads, executables, second gosu paths, links, preexisting evidence, and evidence metadata changes fail closed", () => {
  for (const mutate of [
    (fixture) => { fixture.candidateEntries.push(file("opt/extra", sha(6))); },
    (fixture) => { fixture.candidateEntries.push(file("opt/extra-executable", sha(6), { mode: 0o755 })); },
    (fixture) => { fixture.candidateEntries.push(file("usr/bin/gosu", sha(6), { mode: 0o755 })); },
    (fixture) => { fixture.candidateEntries.push(symlink("usr/bin/gosu", "../local/bin/gosu")); },
    (fixture) => { fixture.candidateEntries.push(hardlink("usr/bin/gosu", "usr/local/bin/gosu", fixture.expectation.replacement)); },
    (fixture) => { fixture.baseEntries.push({ ...fixture.expectation.evidenceFiles[0] }); },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("gosu-LICENSE")).mode = 0o755; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("go-LICENSE")).uid = 70; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("go-PATENTS")).mtime = 1; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("notices.json")).sha256 = sha(15); },
  ]) {
    const fixture = syntheticFixture();
    mutate(fixture);
    expectCode(() => compare(fixture), FILESYSTEM_ERROR);
  }
});

test("base and replacement identities plus all twelve evidence descriptors are exact", () => {
  for (const mutate of [
    (fixture) => { fixture.baseEntries.find((entry) => entry.path === "usr/local/bin/gosu").sha256 = sha(9); },
    (fixture) => { fixture.baseEntries.find((entry) => entry.path === "usr/local/bin/gosu").mtime += 1; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "usr/local/bin/gosu").size += 1; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "usr/local/bin/gosu").gid = 1; },
    (fixture) => { fixture.candidateEntries.splice(fixture.candidateEntries.findIndex((entry) => entry.path.endsWith("x-sys-PATENTS")), 1); },
    (fixture) => { fixture.expectation.evidenceFiles.reverse(); },
    (fixture) => { fixture.expectation.evidenceFiles[0].path = "usr/share/licenses/auto-world-gosu/renamed"; },
    (fixture) => { fixture.expectation.baseExecutable.path = "usr/bin/gosu"; },
  ]) {
    const fixture = syntheticFixture();
    mutate(fixture);
    expectCode(() => compare(fixture), FILESYSTEM_ERROR);
  }
});

test("only direct changed parents may move within the explicit six-hundred-second window", () => {
  assert.equal(compare().mtimeChangedDirectories.length, 2);
  for (const mutate of [
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "usr/local/bin").mtime = 199; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "usr/share/licenses").mtime = 206; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "usr/local").mtime = 203; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "usr/share").mtime = 203; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path === "usr").mtime = 203; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("auto-world-gosu")).mtime = 203; },
    (fixture) => { fixture.expectation.mtimeWindow.endSeconds = 801; },
    (fixture) => { fixture.expectation.mtimeWindow.startSeconds = 206; },
  ]) {
    const fixture = syntheticFixture();
    mutate(fixture);
    expectCode(() => compare(fixture), FILESYSTEM_ERROR);
  }
});

test("new parents require literal creation rights and ZERO parents cannot preexist with a nonzero mtime", () => {
  for (const mutate of [
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("auto-world-gosu")).mode = 0o775; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("auto-world-gosu")).uid = 70; },
    (fixture) => { fixture.candidateEntries.find((entry) => entry.path.endsWith("auto-world-gosu")).size = 1; },
    (fixture) => {
      fixture.baseEntries.push(directory("usr/share/licenses/auto-world-gosu", { mtime: 1 }));
    },
    (fixture) => { fixture.expectation.parentPaths[0].creation.mode = 0o700; },
    (fixture) => { fixture.expectation.parentPaths[5].mtimePolicy = "BUILD_WINDOW"; },
  ]) {
    const fixture = syntheticFixture();
    mutate(fixture);
    expectCode(() => compare(fixture), FILESYSTEM_ERROR);
  }
});

test("missing literal parent directories may be added with their fixed rights and policies", () => {
  const fixture = syntheticFixture();
  for (const path of ["usr/share", "usr/share/licenses"]) {
    fixture.baseEntries.splice(fixture.baseEntries.findIndex((entry) => entry.path === path), 1);
  }
  fixture.candidateEntries.find((entry) => entry.path === "usr/share").mtime = 202;
  const result = compare(fixture);
  assert.deepEqual(result.addedDirectories, [
    "usr/share",
    "usr/share/licenses",
    "usr/share/licenses/auto-world-gosu",
  ]);
  assert.deepEqual(result.mtimeChangedDirectories, ["usr/local/bin"]);
});

test("paths, entry shapes, duplicates, link targets, numeric bounds, and capabilities are closed", () => {
  for (const mutate of [
    (fixture) => { fixture.baseEntries[0].path = "/usr"; },
    (fixture) => { fixture.baseEntries[0].path = "../usr"; },
    (fixture) => { fixture.baseEntries[0].path = "usr\\local"; },
    (fixture) => { fixture.baseEntries[0].path = "usr//local"; },
    (fixture) => { fixture.baseEntries[0].path = "usr/"; },
    (fixture) => { fixture.baseEntries.push({ ...fixture.baseEntries[0] }); },
    (fixture) => { fixture.baseEntries[0].unknown = true; },
    (fixture) => { fixture.baseEntries[0].capabilities = ["CAP_SETUID"]; },
    (fixture) => { fixture.baseEntries[0].mode = 0o10000; },
    (fixture) => { fixture.baseEntries[0].uid = 2_147_483_648; },
    (fixture) => { fixture.baseEntries[0].mtime = Math.floor(Number.MAX_SAFE_INTEGER / 1000) + 1; },
    (fixture) => { fixture.baseEntries[0].size = -1; },
    (fixture) => { fixture.baseEntries.find((entry) => entry.type === "hardlink").linkname = "missing"; },
    (fixture) => { fixture.baseEntries.find((entry) => entry.type === "hardlink").mode = 0o600; },
    (fixture) => { fixture.baseEntries.find((entry) => entry.type === "symlink").linkname = "a".repeat(1025); },
    (fixture) => { fixture.candidateEntries[0].type = "device"; },
  ]) {
    const fixture = syntheticFixture();
    mutate(fixture);
    expectCode(() => compare(fixture), FILESYSTEM_ERROR);
  }
});

test("hostile proxies, getters, custom prototypes, symbols, and sparse arrays are rejected without invoking caller hooks", () => {
  let hooks = 0;
  const trap = () => { hooks += 1; throw new Error("PRIVATE_SENTINEL"); };
  const proxiedEntry = new Proxy({}, {
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    has: trap,
    ownKeys: trap,
  });
  const rootProxy = new Proxy({}, {
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    has: trap,
    ownKeys: trap,
  });
  const getterEntry = {};
  Object.defineProperty(getterEntry, "path", { enumerable: true, get: trap });
  const custom = Object.create({ inherited: true });
  Object.assign(custom, syntheticFixture().baseEntries[0]);
  const symbolEntry = { ...syntheticFixture().baseEntries[0], [Symbol("hidden")]: true };
  const symbolArray = syntheticFixture().baseEntries;
  symbolArray[Symbol("hidden")] = true;
  const sparse = new Array(2);
  sparse[0] = syntheticFixture().baseEntries[0];

  expectCode(() => compareFilesystemInventoriesV2(rootProxy), FILESYSTEM_ERROR);
  for (const baseEntries of [[proxiedEntry], [getterEntry], [custom], [symbolEntry], symbolArray, sparse]) {
    const fixture = syntheticFixture();
    fixture.baseEntries = baseEntries;
    expectCode(() => compare(fixture), FILESYSTEM_ERROR);
  }
  assert.equal(hooks, 0);
});

test("inventory, executable, document, path, and depth caps fail before large or unsafe processing", () => {
  for (const mutate of [
    (fixture) => { fixture.baseEntries = []; },
    (fixture) => { fixture.baseEntries = new Array(100_001); },
    (fixture) => { fixture.expectation.baseExecutable.size = 67_108_865; },
    (fixture) => { fixture.expectation.replacement.size = 67_108_865; },
    (fixture) => { fixture.expectation.evidenceFiles[0].size = 262_145; },
    (fixture) => {
      for (const entry of fixture.expectation.evidenceFiles.slice(0, 5)) entry.size = 262_144;
    },
    (fixture) => { fixture.baseEntries[0].path = "a".repeat(513); },
    (fixture) => { fixture.baseEntries[0].path = new Array(33).fill("a").join("/"); },
  ]) {
    const fixture = syntheticFixture();
    mutate(fixture);
    expectCode(() => compare(fixture), FILESYSTEM_ERROR);
  }
});

test("strict configuration accepts a fully identical detached JSON graph and freezes the narrow result", async () => {
  const raw = await readFile(new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url));
  const handle = openCandidateLockV2(raw);
  const baseConfig = strictConfig();
  const candidateConfig = plainClone(baseConfig);
  const result = validateCandidateConfigurationV2(handle, { baseConfig, candidateConfig });
  assert.deepEqual(result, {
    scope: "CONFIG_PREDICATE_MATCH_ONLY",
    authority: "NOT_AUTHORIZED",
    profile: "STRICT_INHERITED_CONFIG_V2",
  });
  assert.ok(Object.isFrozen(result));
});

test("configuration rejects every changed field including Image, Env, User, and Labels", async () => {
  const raw = await readFile(new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url));
  const handle = openCandidateLockV2(raw);
  for (const mutate of [
    (config) => { config.Image = "sha256:changed"; },
    (config) => { config.Env.push("INJECTED=1"); },
    (config) => { config.User = "70"; },
    (config) => { config.Labels.extra = "changed"; },
    (config) => { config.Labels = {}; },
    (config) => { config.Labels = null; },
    (config) => { delete config.Labels; },
    (config) => { config.Cmd = ["postgres", "-c", "fsync=off"]; },
    (config) => { config.Entrypoint = ["other-entrypoint"]; },
    (config) => { config.Volumes["/tmp"] = {}; },
    (config) => { config.ExposedPorts["1234/tcp"] = {}; },
  ]) {
    const baseConfig = strictConfig();
    const candidateConfig = plainClone(baseConfig);
    mutate(candidateConfig);
    expectCode(() => validateCandidateConfigurationV2(handle, { baseConfig, candidateConfig }), CONFIG_ERROR);
  }
});

test("configuration copies plain JSON without caller hooks and enforces depth, node, collection, string, serialization, cycle, and alias caps", async () => {
  const raw = await readFile(new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url));
  const handle = openCandidateLockV2(raw);
  const rejected = [];

  let deep = null;
  for (let index = 0; index < 17; index += 1) deep = { child: deep };
  rejected.push(deep);
  rejected.push({ value: new Array(1025).fill(null) });
  rejected.push(Object.fromEntries(Array.from({ length: 257 }, (_unused, index) => [`k${index}`, null])));
  rejected.push({ ["k".repeat(257)]: null });
  rejected.push({ value: "x".repeat(8193) });
  rejected.push(Object.fromEntries(Array.from({ length: 9 }, (_unused, index) => [`k${index}`, "x".repeat(8192)])));
  rejected.push(Object.fromEntries(Array.from({ length: 6 }, (_unused, index) =>
    [`k${index}`, new Array(700).fill(null)])));
  rejected.push({ value: Number.NaN });
  rejected.push({ value: undefined });
  rejected.push({ value: 1n });
  rejected.push({ value() {} });

  const cycle = {}; cycle.self = cycle; rejected.push(cycle);
  const shared = {}; rejected.push({ left: shared, right: shared });
  const sparse = new Array(2); sparse[1] = null; rejected.push(sparse);
  rejected.push(Object.assign(Object.create({ inherited: true }), { value: null }));
  rejected.push({ value: null, [Symbol("hidden")]: true });

  let hooks = 0;
  const trap = () => { hooks += 1; throw new Error("PRIVATE_SENTINEL"); };
  const getter = {};
  Object.defineProperty(getter, "value", { enumerable: true, get: trap });
  rejected.push(getter);
  rejected.push(new Proxy({}, { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap }));

  for (const bad of rejected) {
    expectCode(() => validateCandidateConfigurationV2(handle, { baseConfig: bad, candidateConfig: bad }), CONFIG_ERROR);
  }
  assert.equal(hooks, 0);
});

test("normative validation derives the literal contract and millisecond build window from a genuine candidate handle", async () => {
  const raw = await readFile(new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url));
  const handle = openCandidateLockV2(raw);
  const contract = candidateContractV2(handle);
  const baseEntries = [
    ...contract.parentPaths.slice(0, -1).map((parent) => directory(parent.path)),
    { ...contract.baseExecutable },
    directory("etc"),
    directory("etc/apk"),
    file("etc/apk/world", sha(10), { size: 80 }),
  ];
  const candidateEntries = baseEntries.map((entry) => ({ ...entry }));
  candidateEntries.splice(candidateEntries.findIndex((entry) => entry.path === contract.baseExecutable.path), 1,
    { ...contract.replacement });
  candidateEntries.find((entry) => entry.path === "usr/local/bin").mtime = 203;
  candidateEntries.find((entry) => entry.path === "usr/share/licenses").mtime = 204;
  candidateEntries.push(directory(contract.parentPaths.at(-1).path, { mtime: 0 }));
  candidateEntries.push(...contract.evidenceFiles.map((entry) => ({ ...entry })));
  const baseConfig = strictConfig();
  const result = validateCandidateFilesystemV2(handle, {
    baseEntries,
    candidateEntries,
    baseConfig,
    candidateConfig: plainClone(baseConfig),
    buildWindow: BUILD_WINDOW,
  });
  assert.deepEqual(result, {
    scope: "CONDITIONAL_ON_AUTHENTICATED_OCI",
    authority: "NOT_AUTHORIZED",
    baseMembers: 9,
    candidateMembers: 22,
    replaced: ["usr/local/bin/gosu"],
    addedFiles: contract.evidenceFiles.map((entry) => entry.path).sort(),
    addedDirectories: ["usr/share/licenses/auto-world-gosu"],
    mtimeChangedDirectories: ["usr/local/bin", "usr/share/licenses"],
  });

  for (const buildWindow of [
    { startedAtMs: -1, completedAtMs: 1 },
    { startedAtMs: 2, completedAtMs: 1 },
    { startedAtMs: 0, completedAtMs: 600_001 },
    { startedAtMs: 0.5, completedAtMs: 1 },
    { startedAtMs: 0, completedAtMs: Number.MAX_SAFE_INTEGER + 1 },
    { startSeconds: 200, endSeconds: 205 },
    { startedAtMs: 200_000, completedAtMs: 205_999, override: true },
  ]) {
    expectCode(() => validateCandidateFilesystemV2(handle, {
      baseEntries,
      candidateEntries,
      baseConfig,
      candidateConfig: plainClone(baseConfig),
      buildWindow,
    }), FILESYSTEM_ERROR);
  }
});
