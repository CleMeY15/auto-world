import assert from "node:assert/strict";
import {
  chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { removeOwnedTree, removeOwnedWorkEntry, workTreeBytes } from "../scripts/seaweed/work-tree.mjs";

const WORK_NAME = "auto-world-seaweed-source-diagnostic";

function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), "seaweed-work-tree-"));
  const work = path.join(parent, WORK_NAME);
  mkdirSync(work);
  return { parent, work };
}

test("removeOwnedTree deletes readonly owned content and unlinks child links without changing external targets", () => {
  const { parent, work } = fixture();
  const externalDirectory = path.join(parent, "external"); const externalFile = path.join(parent, "sentinel.txt");
  mkdirSync(externalDirectory); writeFileSync(path.join(externalDirectory, "inside.txt"), "outside"); writeFileSync(externalFile, "sentinel");
  chmodSync(externalDirectory, 0o500); chmodSync(externalFile, 0o400);
  const externalDirectoryMode = lstatSync(externalDirectory).mode; const externalFileMode = lstatSync(externalFile).mode;
  const readonly = path.join(work, "readonly"); mkdirSync(readonly); writeFileSync(path.join(readonly, "file"), "owned");
  chmodSync(path.join(readonly, "file"), 0o400); chmodSync(readonly, 0o500);
  symlinkSync(externalDirectory, path.join(work, "external-junction"), process.platform === "win32" ? "junction" : "dir");
  symlinkSync(externalFile, path.join(work, "external-file-link"), "file");
  linkSync(externalFile, path.join(work, "external-hardlink"));
  if (process.platform !== "win32") symlinkSync(path.join(parent, "missing"), path.join(work, "dangling-link"), "file");
  try {
    removeOwnedTree(work, parent);
    assert.equal(existsSync(work), false);
    assert.equal(readFileSync(path.join(externalDirectory, "inside.txt"), "utf8"), "outside");
    assert.equal(readFileSync(externalFile, "utf8"), "sentinel");
    assert.equal(lstatSync(externalDirectory).mode, externalDirectoryMode);
    assert.equal(lstatSync(externalFile).mode, externalFileMode);
  } finally {
    chmodSync(externalDirectory, 0o700); chmodSync(externalFile, 0o600); rmSync(parent, { recursive: true, force: true });
  }
});

test("removeOwnedTree rejects foreign names and a linked work root", () => {
  const parent = mkdtempSync(path.join(tmpdir(), "seaweed-work-tree-boundary-"));
  const foreign = path.join(parent, "foreign"); mkdirSync(foreign);
  assert.throws(() => removeOwnedTree(foreign, parent), /seaweed_cleanup_path_invalid/u);
  const external = path.join(parent, "external"); mkdirSync(external);
  const linked = path.join(parent, WORK_NAME); symlinkSync(external, linked, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => removeOwnedTree(linked, parent), /seaweed_cleanup_path_invalid/u);
  assert.equal(existsSync(external), true);
  rmSync(parent, { recursive: true, force: true });
});

test("removeOwnedWorkEntry accepts only the three fixed nonsymlink entries", () => {
  const { parent, work } = fixture();
  writeFileSync(path.join(work, "go.tar.gz"), "compiler"); chmodSync(path.join(work, "go.tar.gz"), 0o400);
  for (const name of ["restored-source", "bin"]) { const directory = path.join(work, name); mkdirSync(directory); writeFileSync(path.join(directory, "file"), name); }
  try {
    removeOwnedWorkEntry(work, "go.tar.gz", parent); removeOwnedWorkEntry(work, "restored-source", parent); removeOwnedWorkEntry(work, "bin", parent);
    assert.equal(existsSync(path.join(work, "go.tar.gz")), false); assert.equal(existsSync(path.join(work, "restored-source")), false); assert.equal(existsSync(path.join(work, "bin")), false);
    for (const name of ["source", "gomodcache", "../sentinel", "go.tar.gz/child"]) assert.throws(() => removeOwnedWorkEntry(work, name, parent), /seaweed_cleanup_entry_invalid/u);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("removeOwnedWorkEntry rejects linked targets and preserves their contents", () => {
  const { parent, work } = fixture(); const external = path.join(parent, "external"); mkdirSync(external); writeFileSync(path.join(external, "sentinel"), "outside");
  symlinkSync(external, path.join(work, "bin"), process.platform === "win32" ? "junction" : "dir");
  try {
    assert.throws(() => removeOwnedWorkEntry(work, "bin", parent), /seaweed_cleanup_entry_invalid/u);
    assert.equal(readFileSync(path.join(external, "sentinel"), "utf8"), "outside");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("workTreeBytes counts link metadata without traversing targets and enforces its cap", () => {
  const { parent, work } = fixture(); const external = path.join(parent, "large-external"); writeFileSync(external, Buffer.alloc(4096));
  writeFileSync(path.join(work, "owned"), "abc"); const link = path.join(work, "external-link"); symlinkSync(external, link, "file");
  try {
    const expected = 3 + lstatSync(link).size;
    assert.equal(workTreeBytes(work, expected), expected);
    assert.throws(() => workTreeBytes(work, expected - 1), /seaweed_artifact_budget_exceeded/u);
    assert.throws(() => workTreeBytes(work, 0), /seaweed_work_tree_invalid/u);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
