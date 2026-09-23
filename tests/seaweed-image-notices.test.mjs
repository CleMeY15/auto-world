import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createNoticePlan, NOTICE_PLAN_LIMITS } from "../scripts/seaweed-image/notices.mjs";

const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(path.join(root, "infra/seaweed/seaweed-lock.json")));
const fixtureRoot = path.join(root, "tests/fixtures/seaweed-source/upstream");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (bytes) => ({ sha256: hash(bytes), size: bytes.length });
const sum = "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const fileSet = () => ({
  "module.info": { sha256: "1".repeat(64), size: 1 },
  "module.mod": { sha256: "2".repeat(64), size: 2 },
  "source.zip": { sha256: "3".repeat(64), size: 3 },
});

function module(pathName, version, noticeNames = []) {
  const id = hash(Buffer.from(`${pathName}@${version}`));
  return {
    id, path: pathName, version, sum, goModSum: sum, files: fileSet(),
    notices: noticeNames.map((archiveEntry, index) => {
      const bytes = Buffer.from(`${pathName}:${archiveEntry}`);
      return { archiveEntry, file: `notice-${String(index + 1).padStart(3, "0")}.txt`, ...identity(bytes) };
    }),
  };
}

function fixture() {
  const grpc = module("google.golang.org/grpc", lock.grpc.version, ["google.golang.org/grpc@v/NOTICE.txt", "google.golang.org/grpc@v/LICENSE"]);
  grpc.sum = lock.grpc.sum; grpc.goModSum = lock.grpc.goModSum;
  const modules = [module("example.com/no-notices", "v1.0.0"), grpc, module("example.com/with-notice", "v2.0.0", ["example.com/with-notice@v2/LICENSE.md"])];
  const materials = new Map([
    ["materials/DERIVATIVE-NOTICE.txt", readFileSync(path.join(root, "infra/seaweed/DERIVATIVE-NOTICE.txt"))],
    ["materials/upstream/LICENSE", readFileSync(path.join(fixtureRoot, "LICENSE"))],
    ["materials/upstream/weed/glog/LICENSE", readFileSync(path.join(fixtureRoot, "weed/glog/LICENSE"))],
  ]);
  for (const entry of modules) for (const notice of entry.notices) {
    materials.set(`materials/modules/${entry.id}/${notice.file}`, Buffer.from(`${entry.path}:${notice.archiveEntry}`));
  }
  return { modules, materials, baseEntries: [{ path: "usr", type: "directory" }, { path: "usr/share", type: "directory" }] };
}

function build(input = fixture()) {
  return createNoticePlan({ moduleClosureBytes: Buffer.from(JSON.stringify(input.modules)), materials: input.materials, baseEntries: input.baseEntries });
}

function indexFrom(plan) {
  return JSON.parse(plan.entries.find((entry) => entry.path === plan.indexPath).content);
}

test("creates a deterministic PREPARATION_ONLY plan with locked metadata and all zero-notice modules indexed", () => {
  const plan = build();
  assert.equal(plan.state, "PREPARATION_ONLY");
  assert.deepEqual(plan.claims, { source: "NOT_EVALUATED", image: "NOT_CONSTRUCTED", admission: "NOT_ATTEMPTED" });
  assert.equal(plan.source.commit, lock.source.commit);
  assert.equal(plan.source.grpc.version, lock.grpc.version);
  assert.equal(plan.summary.moduleCount, 3);
  assert.equal(plan.summary.noticeCount, 3);
  assert.equal(plan.summary.fixedMaterialCount, 3);
  assert.ok(plan.entries.every((entry) => !entry.path.endsWith("/") && entry.uid === 0 && entry.gid === 0 && entry.mtime === lock.source.commitUnixTime));
  assert.ok(plan.entries.filter((entry) => entry.type === "directory").every((entry) => entry.mode === 0o755 && entry.size === 0));
  assert.ok(plan.entries.filter((entry) => entry.type === "file").every((entry) => entry.mode === 0o644 && entry.size === entry.content.length && entry.sha256 === hash(entry.content)));
  const index = indexFrom(plan);
  assert.equal(index.scope, "retained_notices_only_not_legal_completeness");
  assert.deepEqual(index.modules.find((entry) => entry.path === "example.com/no-notices").notices, []);
  assert.equal(index.materials.length, 3);
  assert.ok(index.modules.flatMap((entry) => entry.notices).every((notice) => notice.sourceMaterial && notice.destination && notice.archiveEntry));
});

test("is independent of module, notice, material-map and base-inventory order", () => {
  const original = fixture();
  const reordered = fixture();
  reordered.modules.reverse();
  reordered.modules.find((entry) => entry.path === "google.golang.org/grpc").notices.reverse();
  reordered.materials = new Map([...reordered.materials].reverse());
  reordered.baseEntries.reverse();
  const left = build(original); const right = build(reordered);
  assert.deepEqual(left, right);
});

test("binds each module index entry to all three collected archive identities", () => {
  const original = fixture();
  const changed = fixture();
  const target = changed.modules.find((entry) => entry.path === "example.com/no-notices");
  target.files["source.zip"] = { sha256: "9".repeat(64), size: 99 };
  const originalPlan = build(original); const changedPlan = build(changed);
  const originalIndexEntry = indexFrom(originalPlan).modules.find((entry) => entry.path === target.path);
  const changedIndexEntry = indexFrom(changedPlan).modules.find((entry) => entry.path === target.path);
  assert.deepEqual(originalIndexEntry.files, original.modules.find((entry) => entry.path === target.path).files);
  assert.deepEqual(changedIndexEntry.files, target.files);
  assert.notDeepEqual(changedIndexEntry.files, originalIndexEntry.files);
  const originalIndexFile = originalPlan.entries.find((entry) => entry.path === originalPlan.indexPath);
  const changedIndexFile = changedPlan.entries.find((entry) => entry.path === changedPlan.indexPath);
  assert.notEqual(changedIndexFile.sha256, originalIndexFile.sha256);
});

test("does not mutate inputs and returns detached material buffers", () => {
  const input = fixture();
  const closureBefore = JSON.stringify(input.modules);
  const baseBefore = JSON.stringify(input.baseEntries);
  const materialBefore = new Map([...input.materials].map(([name, bytes]) => [name, Buffer.from(bytes)]));
  const plan = build(input);
  assert.equal(JSON.stringify(input.modules), closureBefore);
  assert.equal(JSON.stringify(input.baseEntries), baseBefore);
  for (const [name, bytes] of input.materials) assert.deepEqual(bytes, materialBefore.get(name));
  const derivative = plan.entries.find((entry) => entry.path.endsWith("/DERIVATIVE-NOTICE.txt"));
  derivative.content[0] ^= 1;
  assert.deepEqual(input.materials.get("materials/DERIVATIVE-NOTICE.txt"), materialBefore.get("materials/DERIVATIVE-NOTICE.txt"));
});

test("rejects notice tampering and substitution", () => {
  const tampered = fixture();
  const noticeKey = [...tampered.materials.keys()].find((name) => name.includes("/modules/"));
  tampered.materials.get(noticeKey)[0] ^= 1;
  assert.throws(() => build(tampered), /seaweed_notice_plan_material_invalid/u);

  const substituted = fixture();
  const noticeKeys = [...substituted.materials.keys()].filter((name) => name.includes("/modules/"));
  const first = substituted.materials.get(noticeKeys[0]);
  substituted.materials.set(noticeKeys[0], substituted.materials.get(noticeKeys[1]));
  substituted.materials.set(noticeKeys[1], first);
  assert.throws(() => build(substituted), /seaweed_notice_plan_material_invalid/u);
});

test("rejects changed fixed materials", () => {
  for (const key of ["materials/DERIVATIVE-NOTICE.txt", "materials/upstream/LICENSE", "materials/upstream/weed/glog/LICENSE"]) {
    const input = fixture(); input.materials.get(key)[0] ^= 1;
    assert.throws(() => build(input), /seaweed_notice_plan_material_invalid/u, key);
  }
});

test("rejects missing and extra materials", () => {
  const missing = fixture(); missing.materials.delete([...missing.materials.keys()].find((name) => name.includes("/modules/")));
  assert.throws(() => build(missing), /seaweed_notice_plan_material_invalid/u);
  const extra = fixture(); extra.materials.set("materials/unreviewed.txt", Buffer.from("extra"));
  assert.throws(() => build(extra), /seaweed_notice_plan_material_set_invalid/u);
});

test("rejects changed module identity, closed-schema drift and duplicate modules", () => {
  const changedId = fixture(); changedId.modules[0].id = "f".repeat(64);
  assert.throws(() => build(changedId), /seaweed_notice_plan_closure_invalid/u);
  const extraField = fixture(); extraField.modules[0].unreviewed = true;
  assert.throws(() => build(extraField), /seaweed_notice_plan_closure_invalid/u);
  const duplicate = fixture(); duplicate.modules.push(JSON.parse(JSON.stringify(duplicate.modules[0])));
  assert.throws(() => build(duplicate), /seaweed_notice_plan_closure_invalid/u);
  const unsafeArchive = fixture(); unsafeArchive.modules.find((entry) => entry.path === "google.golang.org/grpc").notices[0].archiveEntry = "../NOTICE.txt";
  assert.throws(() => build(unsafeArchive), /seaweed_notice_plan_closure_invalid/u);
});

test("rejects missing or substituted locked gRPC identity and required notices", () => {
  const changed = fixture(); changed.modules.find((entry) => entry.path === "google.golang.org/grpc").version = "v1.0.0";
  assert.throws(() => build(changed), /seaweed_notice_plan_closure_invalid/u);
  const missingNotice = fixture();
  const grpc = missingNotice.modules.find((entry) => entry.path === "google.golang.org/grpc");
  const removed = grpc.notices.shift();
  missingNotice.materials.delete(`materials/modules/${grpc.id}/${removed.file}`);
  grpc.notices = grpc.notices.map((notice, index) => ({ ...notice, file: `notice-${String(index + 1).padStart(3, "0")}.txt` }));
  const remainingOldKey = [...missingNotice.materials.keys()].find((name) => name.includes(`/modules/${grpc.id}/`));
  const remainingBytes = missingNotice.materials.get(remainingOldKey); missingNotice.materials.delete(remainingOldKey);
  missingNotice.materials.set(`materials/modules/${grpc.id}/notice-001.txt`, remainingBytes);
  assert.throws(() => build(missingNotice), /seaweed_notice_plan_grpc_invalid/u);
});

test("rejects exact destination, parent file, parent symlink, descendant and index collisions", () => {
  const collisions = [
    { path: "usr/share/auto-world/seaweedfs/DERIVATIVE-NOTICE.txt", type: "file" },
    { path: "usr/share/auto-world", type: "file" },
    { path: "usr/share/auto-world", type: "symlink" },
    { path: "usr/share/auto-world/seaweedfs/DERIVATIVE-NOTICE.txt/child", type: "file" },
    { path: "usr/share/auto-world/seaweedfs/attribution-index.json", type: "file" },
  ];
  for (const collision of collisions) {
    const input = fixture(); input.baseEntries.push(collision);
    assert.throws(() => build(input), /seaweed_notice_plan_(?:collision|base_invalid)/u, JSON.stringify(collision));
  }
});

test("reuses explicit and implicit base directories while adding only missing safe parents", () => {
  const input = fixture();
  input.baseEntries = [{ path: "usr/share/existing.txt", type: "file" }];
  const plan = build(input);
  const directories = plan.entries.filter((entry) => entry.type === "directory").map((entry) => entry.path);
  assert.equal(directories.includes("usr"), false);
  assert.equal(directories.includes("usr/share"), false);
  assert.ok(directories.includes("usr/share/auto-world/seaweedfs"));
  assert.throws(() => build({ ...fixture(), baseEntries: [{ path: "usr/../escape", type: "file" }] }), /seaweed_notice_plan_base_invalid/u);
});

test("enforces module and per-module notice bounds before planning", () => {
  const tooManyModules = fixture();
  tooManyModules.modules = Array.from({ length: NOTICE_PLAN_LIMITS.modules + 1 }, (_, index) => module(`example.com/m${index}`, "v1.0.0"));
  assert.throws(() => build(tooManyModules), /seaweed_notice_plan_closure_invalid/u);

  const tooManyNotices = fixture();
  const target = tooManyNotices.modules.find((entry) => entry.path === "example.com/no-notices");
  target.notices = Array.from({ length: NOTICE_PLAN_LIMITS.noticesPerModule + 1 }, (_, index) => ({
    archiveEntry: `LICENSE-${index}`, file: `notice-${String(index + 1).padStart(3, "0")}.txt`, sha256: "a".repeat(64), size: 1,
  }));
  assert.throws(() => build(tooManyNotices), /seaweed_notice_plan_closure_invalid/u);
});
