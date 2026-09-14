import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalMaterial } from "../scripts/seaweed/build.mjs";

const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(path.join(root, "infra/seaweed/seaweed-lock.json")));
const fixtureRoot = path.join(root, "tests/fixtures/seaweed-source/upstream");
const originals = [
  ...Object.entries(lock.moduleFiles.before).map(([name, descriptor]) => ({ path: name, ...descriptor })),
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

test("the approved module patch applies to original Git bytes and produces the exact corrected identities", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "seaweed-source-patch-"));
  try {
    for (const name of ["go.mod", "go.sum"]) copyFileSync(path.join(fixtureRoot, name), path.join(directory, name));
    const patch = path.join(root, lock.patch.path);
    canonicalMaterial(readFileSync(patch), lock.patch);
    const result = spawnSync("git", ["-c", "core.autocrlf=false", "apply", "--whitespace=error-all", patch], {
      cwd: directory, encoding: "utf8", timeout: 10_000, windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    for (const name of ["go.mod", "go.sum"]) {
      const bytes = readFileSync(path.join(directory, name));
      assert.equal(canonicalMaterial(bytes, lock.moduleFiles.after[name]), bytes, name);
    }
  } finally { rmSync(directory, { recursive: true, force: false }); }
});
