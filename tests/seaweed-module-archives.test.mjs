import assert from "node:assert/strict";
import fs from "node:fs";
import {
  existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { retainModuleArchive, snapshotModuleArchive } from "../scripts/seaweed/module-archives.mjs";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-module-archives-"));
  const cacheRoot = path.join(root, "gomodcache");
  const downloadRoot = path.join(cacheRoot, "cache", "download");
  const sourceParent = path.join(downloadRoot, "example.com", "module", "@v");
  const archiveRoot = path.join(root, "materials", "modules");
  const moduleRoot = path.join(archiveRoot, "a".repeat(64));
  mkdirSync(sourceParent, { recursive: true });
  mkdirSync(moduleRoot, { recursive: true });
  const sourceFile = path.join(sourceParent, "v1.0.0.zip");
  const destination = path.join(moduleRoot, "source.zip");
  writeFileSync(sourceFile, Buffer.from("valid module zip bytes"));
  return { root, cacheRoot, downloadRoot, sourceParent, sourceFile, archiveRoot, moduleRoot, destination };
}

function snapshot(scope) {
  return snapshotModuleArchive(scope.sourceFile, { cacheRoot: scope.cacheRoot, groupAbsent: true });
}

function retain(scope, value = snapshot(scope)) {
  return retainModuleArchive(value, scope.destination, { cacheRoot: scope.cacheRoot, archiveRoot: scope.archiveRoot, groupAbsent: true });
}

test("snapshots and exclusively retains an unchanged module archive", () => {
  const scope = fixture();
  try {
    const value = snapshot(scope);
    assert.deepEqual(retain(scope, value), { sha256: value.sha256, size: value.size });
    assert.deepEqual(readFileSync(scope.destination), readFileSync(scope.sourceFile));
  } finally { rmSync(scope.root, { recursive: true, force: true }); }
});

test("requires proven group absence before any filesystem access", () => {
  for (const groupAbsent of [false, undefined, null, "true"]) {
    assert.throws(() => snapshotModuleArchive("Z:/missing.zip", { cacheRoot: "Z:/missing", groupAbsent }), /seaweed_module_archive_group_not_absent/u);
    assert.throws(() => retainModuleArchive({}, "Z:/missing.zip", { cacheRoot: "Z:/missing", archiveRoot: "Z:/missing", groupAbsent }), /seaweed_module_archive_group_not_absent/u);
  }
});

test("rejects missing, directory, and hardlinked sources", () => {
  for (const kind of ["missing", "directory", "hardlink"]) {
    const scope = fixture();
    try {
      if (kind === "missing") rmSync(scope.sourceFile);
      if (kind === "directory") { rmSync(scope.sourceFile); mkdirSync(scope.sourceFile); }
      if (kind === "hardlink") linkSync(scope.sourceFile, path.join(scope.root, "second-link"));
      assert.throws(() => snapshot(scope), /seaweed_module_archive_source_invalid/u);
    } finally { rmSync(scope.root, { recursive: true, force: true }); }
  }
});

test("rejects a source archive above the fixed size cap", () => {
  const scope = fixture();
  try {
    truncateSync(scope.sourceFile, 256 * 1024 ** 2 + 1);
    assert.throws(() => snapshot(scope), /seaweed_module_archive_source_invalid/u);
  } finally { rmSync(scope.root, { recursive: true, force: true }); }
});

test("rejects source content, size, and file identity changes without a partial destination", () => {
  for (const mutation of ["content", "size", "identity"]) {
    const scope = fixture();
    try {
      const value = snapshot(scope);
      if (mutation === "content") writeFileSync(scope.sourceFile, Buffer.from("invalid module zip byte"));
      if (mutation === "size") truncateSync(scope.sourceFile, value.size - 1);
      if (mutation === "identity") {
        const replacement = path.join(scope.root, "replacement");
        writeFileSync(replacement, readFileSync(scope.sourceFile));
        rmSync(scope.sourceFile); renameSync(replacement, scope.sourceFile);
      }
      assert.throws(() => retain(scope, value), /seaweed_module_archive_source_changed/u);
      assert.equal(existsSync(scope.destination), false);
    } finally { rmSync(scope.root, { recursive: true, force: true }); }
  }
});

test("rejects same-path replacement and new hardlinks created during a bounded read", () => {
  for (const mutation of ["replacement", "hardlink"]) {
    const scope = fixture(); const value = snapshot(scope); const originalRead = fs.readSync;
    let mutated = false;
    try {
      fs.readSync = (...arguments_) => {
        const count = originalRead(...arguments_);
        if (!mutated && count > 0) {
          mutated = true;
          if (mutation === "replacement") {
            const replacement = path.join(scope.root, "replacement");
            writeFileSync(replacement, readFileSync(scope.sourceFile));
            renameSync(scope.sourceFile, path.join(scope.root, "original"));
            renameSync(replacement, scope.sourceFile);
          } else linkSync(scope.sourceFile, path.join(scope.root, "new-hardlink"));
        }
        return count;
      };
      syncBuiltinESMExports();
      assert.throws(() => retain(scope, value), /seaweed_module_archive_source_changed/u);
      assert.equal(existsSync(scope.destination), false);
    } finally {
      fs.readSync = originalRead; syncBuiltinESMExports();
      rmSync(scope.root, { recursive: true, force: true });
    }
  }
});

test("removes its own partial destination after an interrupted write and preserves unrelated files", () => {
  const scope = fixture(); const value = snapshot(scope); const originalWrite = fs.writeSync;
  const sentinel = path.join(scope.moduleRoot, "sentinel"); writeFileSync(sentinel, "outside");
  let writes = 0;
  try {
    fs.writeSync = (...arguments_) => {
      writes += 1;
      if (writes === 1) return originalWrite(arguments_[0], arguments_[1], arguments_[2], Math.min(3, arguments_[3]), arguments_[4]);
      throw new Error("injected_partial_write");
    };
    syncBuiltinESMExports();
    assert.throws(() => retain(scope, value), /injected_partial_write/u);
    assert.equal(existsSync(scope.destination), false);
    assert.equal(readFileSync(sentinel, "utf8"), "outside");
    assert.deepEqual(readFileSync(scope.sourceFile), Buffer.from("valid module zip bytes"));
  } finally {
    fs.writeSync = originalWrite; syncBuiltinESMExports();
    rmSync(scope.root, { recursive: true, force: true });
  }
});

test("rejects destination collisions and preserves the existing file", () => {
  const scope = fixture();
  try {
    const value = snapshot(scope); writeFileSync(scope.destination, "sentinel");
    assert.throws(() => retain(scope, value), /seaweed_module_archive_collision/u);
    assert.equal(readFileSync(scope.destination, "utf8"), "sentinel");
  } finally { rmSync(scope.root, { recursive: true, force: true }); }
});

test("rejects destinations outside the exact archive digest directory", () => {
  const scope = fixture();
  try {
    const value = snapshot(scope);
    for (const destination of [
      path.join(scope.archiveRoot, "source.zip"),
      path.join(scope.moduleRoot, "nested", "source.zip"),
      path.join(scope.moduleRoot, "archive.zip"),
      path.join(scope.archiveRoot, "not-a-digest", "source.zip"),
    ]) assert.throws(() => retainModuleArchive(value, destination, { cacheRoot: scope.cacheRoot, archiveRoot: scope.archiveRoot, groupAbsent: true }), /seaweed_module_archive_destination_invalid/u);
  } finally { rmSync(scope.root, { recursive: true, force: true }); }
});

test("rejects linked source and archive parents without touching external sentinels", () => {
  for (const boundary of ["source-parent", "archive-parent"]) {
    const scope = fixture(); const external = mkdtempSync(path.join(tmpdir(), "seaweed-module-external-"));
    try {
      const sentinel = path.join(external, "sentinel"); writeFileSync(sentinel, "outside");
      if (boundary === "source-parent") {
        rmSync(path.join(scope.downloadRoot, "example.com"), { recursive: true });
        symlinkSync(external, path.join(scope.downloadRoot, "example.com"), process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => snapshot(scope), /seaweed_module_archive_source_invalid/u);
      } else {
        const value = snapshot(scope); rmSync(scope.moduleRoot, { recursive: true });
        symlinkSync(external, scope.moduleRoot, process.platform === "win32" ? "junction" : "dir");
        assert.throws(() => retain(scope, value), /seaweed_module_archive_destination_invalid/u);
      }
      assert.equal(readFileSync(sentinel, "utf8"), "outside");
    } finally { rmSync(scope.root, { recursive: true, force: true }); rmSync(external, { recursive: true, force: true }); }
  }
});

test("rejects linked source and destination leaves", { skip: process.platform === "win32" }, () => {
  const sourceScope = fixture(); const sourceExternal = path.join(sourceScope.root, "source-external");
  try {
    writeFileSync(sourceExternal, "outside"); rmSync(sourceScope.sourceFile); symlinkSync(sourceExternal, sourceScope.sourceFile, "file");
    assert.throws(() => snapshot(sourceScope), /seaweed_module_archive_source_invalid/u);
  } finally { rmSync(sourceScope.root, { recursive: true, force: true }); }

  const destinationScope = fixture(); const destinationExternal = path.join(destinationScope.root, "destination-external");
  try {
    const value = snapshot(destinationScope); writeFileSync(destinationExternal, "outside"); symlinkSync(destinationExternal, destinationScope.destination, "file");
    assert.throws(() => retain(destinationScope, value), /seaweed_module_archive_collision/u);
    assert.equal(readFileSync(destinationExternal, "utf8"), "outside");
  } finally { rmSync(destinationScope.root, { recursive: true, force: true }); }
});

test("rejects malformed or mismatched snapshots before creating a destination", () => {
  const scope = fixture();
  try {
    const value = snapshot(scope);
    for (const changed of [
      { ...value, sha256: "0".repeat(64) },
      { ...value, size: value.size - 1 },
      { ...value, inode: (BigInt(value.inode) + 1n).toString() },
      { ...value, sourceFile: path.join(scope.root, "outside.zip") },
      { ...value, sha256: "invalid" },
    ]) {
      assert.throws(() => retain(scope, changed), /seaweed_module_archive_(?:source_changed|source_invalid|snapshot_invalid)/u);
      assert.equal(existsSync(scope.destination), false);
    }
  } finally { rmSync(scope.root, { recursive: true, force: true }); }
});
