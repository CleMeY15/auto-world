import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalMaterial } from "../scripts/seaweed/build.mjs";

const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(path.join(root, "infra/seaweed/seaweed-lock.json")));
const fixtureRoot = path.join(root, "tests/fixtures/seaweed-source/upstream");
const originals = [
  ...Object.entries(lock.moduleFiles.before).map(([name, descriptor]) => ({ path: name, ...descriptor })),
  ...Object.entries(lock.sourcePatchFiles.before).map(([name, descriptor]) => ({ path: name, ...descriptor })),
  ...lock.upstreamMaterials,
];

test("source material locks match original Git blob bytes and reject Windows checkout conversion", () => {
  for (const descriptor of originals) {
    const bytes = readFileSync(path.join(fixtureRoot, descriptor.path));
    assert.equal(canonicalMaterial(bytes, descriptor), bytes, descriptor.path);
    assert.equal(bytes.includes(Buffer.from("\r\n")), false, descriptor.path);
    const converted = Buffer.from(bytes.toString("utf8").replaceAll("\n", "\r\n"));
    assert.throws(() => canonicalMaterial(converted, descriptor), /seaweed_material_changed/u, descriptor.path);
    const changed = Buffer.from(bytes); changed[0] ^= 1;
    assert.throws(() => canonicalMaterial(changed, descriptor), /seaweed_material_changed/u, descriptor.path);
  }
});

test("the complete approved patch applies to original Git bytes and produces every exact corrected identity", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "seaweed-source-patch-"));
  try {
    const before = { ...lock.moduleFiles.before, ...lock.sourcePatchFiles.before };
    const after = { ...lock.moduleFiles.after, ...lock.sourcePatchFiles.after };
    assert.deepEqual(Object.keys(before).sort(), Object.keys(after).sort());
    for (const name of Object.keys(before)) {
      mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      copyFileSync(path.join(fixtureRoot, name), path.join(directory, name));
    }
    const patch = path.join(root, lock.patch.path);
    canonicalMaterial(readFileSync(patch), lock.patch);
    const result = spawnSync("git", ["-c", "core.autocrlf=false", "apply", "--whitespace=error-all", patch], {
      cwd: directory, encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const listed = spawnSync("git", ["apply", "--numstat", patch], { cwd: directory, encoding: "utf8", timeout: 10_000, windowsHide: true });
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split("\n").map((line) => line.split("\t")[2]).sort(), Object.keys(after).sort());
    for (const name of Object.keys(after)) {
      const bytes = readFileSync(path.join(directory, name));
      assert.equal(canonicalMaterial(bytes, after[name]), bytes, name);
    }
  } finally { rmSync(directory, { recursive: true, force: false }); }
});
