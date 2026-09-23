import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sourceLock from "../infra/seaweed/seaweed-lock.json" with { type: "json" };
import {
  baseMaterialIdentities,
  createTransformPlan,
  validateBaseMaterials,
  validatePlannedFilesystem,
  validatePlannedRuntimeConfig,
} from "../scripts/seaweed-image/plan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const baseRoot = path.join(root, "infra/seaweed-image");
const sourceFixtureRoot = path.join(root, "tests/fixtures/seaweed-source/upstream");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (bytes) => ({ sha256: hash(bytes), size: bytes.length });
const copy = (value) => JSON.parse(JSON.stringify(value));
const sum = "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const oldBinaryHashes = new Set([
  "dc7f0bd80235fa27dcaa19bfe13e37f4b7fc27c9f26e0153fc58f2bc7489f41d",
  "b2f00d79b4052e75c2b0dbe256283438c04a2fea6f3e12459b0d6d646bc90ad5",
  "163eef53fc85a2074e2cd5eb980b902b30a2e766b2f3c189ac60180cce46931e",
]);
const runtimeFields = ["Entrypoint", "Cmd", "Env", "WorkingDir", "Volumes", "ExposedPorts"];
const serializedDefaults = {
  Hostname: "", Domainname: "", AttachStdin: false, AttachStdout: false, AttachStderr: false,
  Tty: false, OpenStdin: false, StdinOnce: false, Image: "", OnBuild: null,
};
const backend = Object.freeze({ method: "MOBY_IMAGE_IMPORT", platform: "linux/amd64", serverVersion: "28.0.4", store: "CLASSIC_CONFIG_ID" });

function baseMaterials() {
  return new Map(Object.keys(baseMaterialIdentities).map((name) => [name, readFileSync(path.join(baseRoot, name))]));
}

function module(pathName, version, notices) {
  const id = hash(Buffer.from(`${pathName}@${version}`, "utf8"));
  return {
    id, path: pathName, version, sum, goModSum: sum,
    files: {
      "module.info": { sha256: "1".repeat(64), size: 1 },
      "module.mod": { sha256: "2".repeat(64), size: 2 },
      "source.zip": { sha256: "3".repeat(64), size: 3 },
    },
    notices: notices.map(({ archiveEntry, bytes }, index) => ({
      archiveEntry,
      file: `notice-${String(index + 1).padStart(3, "0")}.txt`,
      ...identity(bytes),
    })),
  };
}

function inputs() {
  const grpcNotices = [
    { archiveEntry: "google.golang.org/grpc@v/NOTICE.txt", bytes: Buffer.from("synthetic grpc notice\n") },
    { archiveEntry: "google.golang.org/grpc@v/LICENSE", bytes: Buffer.from("synthetic grpc license\n") },
  ];
  const grpc = module("google.golang.org/grpc", sourceLock.grpc.version, grpcNotices);
  grpc.sum = sourceLock.grpc.sum;
  grpc.goModSum = sourceLock.grpc.goModSum;
  const modules = [grpc];
  const materials = new Map([
    ["materials/DERIVATIVE-NOTICE.txt", readFileSync(path.join(root, "infra/seaweed/DERIVATIVE-NOTICE.txt"))],
    ["materials/upstream/LICENSE", readFileSync(path.join(sourceFixtureRoot, "LICENSE"))],
    ["materials/upstream/weed/glog/LICENSE", readFileSync(path.join(sourceFixtureRoot, "weed/glog/LICENSE"))],
  ]);
  for (const [index, notice] of grpc.notices.entries()) {
    materials.set(`materials/modules/${grpc.id}/${notice.file}`, Buffer.from(grpcNotices[index].bytes));
  }
  return {
    baseMaterials: baseMaterials(),
    source: {
      binary: { sha256: "a".repeat(64), size: 123456 },
      runId: "35871640369",
      attempt: 1,
      codeRevision: "1".repeat(40),
      recipeRevision: "2".repeat(40),
      createdAt: "2026-09-23T12:34:56.789Z",
    },
    moduleClosureBytes: Buffer.from(JSON.stringify(modules)),
    materials,
    backend: { ...backend },
  };
}

function plan(input = inputs()) {
  return createTransformPlan(input);
}

function clonedEntries(entries) {
  return entries.map((entry) => ({ ...entry }));
}

function expectFilesystemMismatch(candidate, input, message) {
  assert.throws(() => validatePlannedFilesystem(candidate, input), /seaweed_image_(?:candidate_inventory_mismatch|inventory_entry_invalid)/u, message);
}

test("validates the three exact public base materials and rejects set or byte drift", () => {
  assert.equal(Object.isFrozen(baseMaterialIdentities), true);
  assert.deepEqual(baseMaterialIdentities, {
    "base-manifest.json": { sha256: "f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362", size: 2193 },
    "base-config.json": { sha256: "31d61f5e8771cbd5993912cd051be0c7bcdc207faaa12c50e1a3b8371631c927", size: 13676 },
    "base-filesystem.json": { sha256: "82a8ea5decc1dfd578eacfa8fdf146423c34c357b9cfc1f962ed2b32942a5180", size: 116924 },
  });
  const valid = baseMaterials();
  const parsed = validateBaseMaterials(valid);
  assert.equal(parsed.manifest.layers.length, 10);
  assert.equal(parsed.config.rootfs.diff_ids.length, 10);
  assert.equal(parsed.entries.length, 561);
  assert.equal(Object.hasOwn(parsed.config.config, "User"), false);
  assert.equal(parsed.config.config.ArgsEscaped, true);

  const missing = baseMaterials(); missing.delete("base-config.json");
  assert.throws(() => validateBaseMaterials(missing), /seaweed_image_base_material_set_invalid/u);
  const extra = baseMaterials(); extra.set("unreviewed.json", Buffer.from("{}"));
  assert.throws(() => validateBaseMaterials(extra), /seaweed_image_base_material_set_invalid/u);
  const changed = baseMaterials(); changed.get("base-filesystem.json")[100] ^= 1;
  assert.throws(() => validateBaseMaterials(changed), /seaweed_image_base_material_identity_invalid/u);
});

test("creates only a PREPARATION_ONLY plan with the exact bounded filesystem delta", () => {
  const input = inputs();
  const result = plan(input);
  assert.equal(result.kind, "SEAWEED_TRANSFORM_PLAN_V1");
  assert.equal(result.authority, "PREPARATION_ONLY");
  assert.equal(result.notices.state, "PREPARATION_ONLY");
  assert.deepEqual(result.notices.claims, { source: "NOT_EVALUATED", image: "NOT_CONSTRUCTED", admission: "NOT_ATTEMPTED" });
  assert.equal(result.changeSet.preserved, 558);
  assert.deepEqual(result.changeSet.replaced, ["usr/bin/weed"]);
  assert.deepEqual(result.changeSet.removed, ["usr/bin/weed-volume", "usr/bin/weed-worker"]);
  assert.equal(result.entries.length, 559 + result.changeSet.added.length);
  assert.deepEqual(result.changeSet.added, result.notices.entries.map((entry) => entry.path));

  const byPath = new Map(result.entries.map((entry) => [entry.path, entry]));
  assert.equal(byPath.has("usr/bin/weed-volume"), false);
  assert.equal(byPath.has("usr/bin/weed-worker"), false);
  assert.deepEqual(byPath.get("usr/bin/weed"), {
    path: "usr/bin/weed", type: "file", mode: 0o755, uid: 0, gid: 0,
    mtime: sourceLock.source.commitUnixTime, size: input.source.binary.size, sha256: input.source.binary.sha256,
  });
  assert.ok(result.entries.every((entry) => entry.type !== "file" || !oldBinaryHashes.has(entry.sha256)));
  for (const addition of result.notices.entries) {
    const expected = { ...addition }; delete expected.content;
    assert.deepEqual(byPath.get(addition.path), expected);
  }
});

test("preserves exactly six runtime fields and records every import normalization", () => {
  const input = inputs();
  const base = validateBaseMaterials(input.baseMaterials);
  const result = plan(input);
  for (const field of runtimeFields) assert.deepEqual(result.config[field], base.config.config[field], field);
  for (const [field, value] of Object.entries(serializedDefaults)) assert.deepEqual(result.config[field], value, field);
  assert.equal(result.config.User, "");
  assert.equal(Object.hasOwn(result.config, "ArgsEscaped"), false);
  assert.deepEqual(result.configChanges.preserved, runtimeFields);
  assert.deepEqual(result.configChanges.normalizations, [
    { field: "User", before: "ABSENT", after: "PRESENT_EMPTY", reason: "DOCKER_IMPORT_LINUX_DEFAULT_USER" },
    { field: "ArgsEscaped", before: true, after: "ABSENT", reason: "DOCKER_IMPORT_WINDOWS_ONLY_FIELD" },
  ]);
  assert.deepEqual(result.configChanges.imageMetadata, {
    preserved: ["os", "architecture"], removed: ["moby.buildkit.cache.v0"], replaced: ["created", "history", "rootfs"],
  });
  assert.equal(Object.hasOwn(result.config.Labels, "author"), false);
  assert.equal(Object.hasOwn(result.config.Labels, "org.opencontainers.image.vendor"), false);
});

test("requires attempt one, non-null well-formed identity descriptors, a canonical date and the exact Moby backend", () => {
  const sourceCases = [
    ["missing attempt", (value) => { delete value.source.attempt; }],
    ["attempt two", (value) => { value.source.attempt = 2; }],
    ["null binary identity", (value) => { value.source.binary.sha256 = "0".repeat(64); }],
    ["null code revision", (value) => { value.source.codeRevision = "0".repeat(40); }],
    ["textual placeholder code revision", (value) => { value.source.codeRevision = "PENDING"; }],
    ["missing recipe revision", (value) => { delete value.source.recipeRevision; }],
    ["short recipe revision", (value) => { value.source.recipeRevision = "f".repeat(39); }],
    ["old base binary", (value) => { value.source.binary.sha256 = [...oldBinaryHashes][0]; }],
    ["invalid binary hash", (value) => { value.source.binary.sha256 = "z".repeat(64); }],
    ["invalid date", (value) => { value.source.createdAt = "2026-09-31T12:34:56.789Z"; }],
    ["non-canonical date", (value) => { value.source.createdAt = "2026-09-23T12:34:56Z"; }],
  ];
  for (const [name, mutate] of sourceCases) {
    const input = inputs(); mutate(input);
    assert.throws(() => plan(input), /seaweed_image_source_manifest_invalid/u, name);
  }

  const backendCases = [
    ["missing", (value) => { delete value.backend; }],
    ["method", (value) => { value.backend.method = "BUILDKIT"; }],
    ["platform", (value) => { value.backend.platform = "linux/arm64"; }],
    ["version", (value) => { value.backend.serverVersion = "28.0.5"; }],
    ["store", (value) => { value.backend.store = "CONTAINERD_MANIFEST_ID"; }],
    ["extra", (value) => { value.backend.unreviewed = true; }],
  ];
  for (const [name, mutate] of backendCases) {
    const input = inputs(); mutate(input);
    assert.throws(() => plan(input), /seaweed_image_backend_contract_invalid/u, name);
  }
});

test("does not mutate caller inputs and returns plans detached from all input buffers", () => {
  const input = inputs();
  const sourceBefore = copy(input.source);
  const backendBefore = copy(input.backend);
  const closureBefore = Buffer.from(input.moduleClosureBytes);
  const basesBefore = new Map([...input.baseMaterials].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const materialsBefore = new Map([...input.materials].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const first = plan(input);
  assert.deepEqual(input.source, sourceBefore);
  assert.deepEqual(input.backend, backendBefore);
  assert.deepEqual(input.moduleClosureBytes, closureBefore);
  for (const [name, bytes] of input.baseMaterials) assert.deepEqual(bytes, basesBefore.get(name), name);
  for (const [name, bytes] of input.materials) assert.deepEqual(bytes, materialsBefore.get(name), name);

  first.source.binary.sha256 = "b".repeat(64);
  first.config.Env[0] = "PATH=/mutated";
  first.notices.entries.find((entry) => entry.type === "file").content[0] ^= 1;
  const second = plan(input);
  assert.deepEqual(second.source, sourceBefore);
  assert.notEqual(second.config.Env[0], "PATH=/mutated");
  for (const [name, bytes] of input.materials) assert.deepEqual(bytes, materialsBefore.get(name), name);
});

test("accepts an exact reordered filesystem and rejects omission, extra, duplicate, renamed old binary and content drift", () => {
  const input = inputs(); const expected = plan(input);
  assert.deepEqual(validatePlannedFilesystem(clonedEntries(expected.entries).reverse(), input), {
    kind: "SEAWEED_INVENTORY_PLAN_MATCH_V1", authority: "PREPARATION_ONLY", entries: expected.entries.length,
  });

  const omitted = clonedEntries(expected.entries); omitted.pop();
  expectFilesystemMismatch(omitted, input, "omitted");
  const extra = clonedEntries(expected.entries); extra.push({ path: "unexpected", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 1, sha256: "e".repeat(64) });
  expectFilesystemMismatch(extra, input, "extra");
  const duplicate = clonedEntries(expected.entries); duplicate[1] = { ...duplicate[0] };
  expectFilesystemMismatch(duplicate, input, "duplicate");
  const renamedOld = clonedEntries(expected.entries);
  const weed = renamedOld.find((entry) => entry.path === "usr/bin/weed");
  weed.path = "usr/bin/weed-old"; weed.sha256 = [...oldBinaryHashes][0]; weed.size = 220182163;
  expectFilesystemMismatch(renamedOld, input, "renamed old binary");
  const changedContent = clonedEntries(expected.entries);
  changedContent.find((entry) => entry.type === "file").sha256 = "e".repeat(64);
  expectFilesystemMismatch(changedContent, input, "content");
});

test("rejects mode, ownership, mtime, size, type and symlink-target drift", () => {
  const input = inputs(); const expected = plan(input);
  const cases = [
    ["mode", (entries) => { entries.find((entry) => entry.type === "file").mode ^= 0o111; }],
    ["uid", (entries) => { entries.find((entry) => entry.type === "file").uid += 1; }],
    ["gid", (entries) => { entries.find((entry) => entry.type === "directory").gid += 1; }],
    ["mtime", (entries) => { entries.find((entry) => entry.type === "file").mtime += 1; }],
    ["size", (entries) => { entries.find((entry) => entry.type === "file").size += 1; }],
    ["type", (entries) => {
      const entry = entries.find((candidate) => candidate.type === "file");
      delete entry.sha256; entry.type = "directory"; entry.size = 0;
    }],
    ["link target", (entries) => { entries.find((entry) => entry.type === "symlink").linkname = "changed-target"; }],
  ];
  for (const [name, mutate] of cases) {
    const candidate = clonedEntries(expected.entries); mutate(candidate);
    expectFilesystemMismatch(candidate, input, name);
  }
});

test("accepts only the exact planned runtime config", () => {
  const input = inputs(); const expected = plan(input);
  assert.deepEqual(validatePlannedRuntimeConfig(copy(expected.config), input), {
    kind: "SEAWEED_CONFIG_PLAN_MATCH_V1", authority: "PREPARATION_ONLY",
  });
  const cases = [
    ["missing runtime field", (config) => { delete config.WorkingDir; }],
    ["extra field", (config) => { config.StopSignal = "SIGTERM"; }],
    ["environment order", (config) => { config.Env = [...config.Env, "EXTRA=1"].reverse(); }],
    ["missing User", (config) => { delete config.User; }],
    ["non-empty User", (config) => { config.User = "1000:1000"; }],
    ["ArgsEscaped restored", (config) => { config.ArgsEscaped = true; }],
    ["zero default changed", (config) => { config.AttachStdout = true; }],
    ["zero default omitted", (config) => { delete config.Hostname; }],
    ["unknown label", (config) => { config.Labels["com.auto-world.unreviewed"] = "true"; }],
    ["old author", (config) => { config.Labels.author = "Chris Lu"; }],
    ["old vendor", (config) => { config.Labels["org.opencontainers.image.vendor"] = "Chris Lu"; }],
  ];
  for (const [name, mutate] of cases) {
    const candidate = copy(expected.config); mutate(candidate);
    assert.throws(() => validatePlannedRuntimeConfig(candidate, input), /seaweed_image_candidate_config_mismatch/u, name);
  }
});
