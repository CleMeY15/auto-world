import assert from "node:assert/strict";
import { access, chmod, link, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as builder from "../scripts/postgres-image/gosu-derivative-build-v1.mjs";

test("owned cleanup removes nested read-only Go module-cache directories", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-cleanup-"));
  const scratch = path.join(parent, "aw-gosu-preparation-1");
  try {
    const module = path.join(scratch, "gomodcache", "example.test", "module@v1.0.0");
    await mkdir(module, { recursive: true, mode: 0o700 });
    await writeFile(path.join(module, "go.mod"), "module example.test/module\n", { mode: 0o400 });
    await chmod(module, 0o555);
    await chmod(path.dirname(module), 0o555);
    await builder.removeOwnedGosuScratch(scratch, parent);
    await assert.rejects(access(scratch), { code: "ENOENT" });
  } finally {
    await chmod(path.join(scratch, "gomodcache", "example.test", "module@v1.0.0"), 0o700).catch(() => {});
    await chmod(path.join(scratch, "gomodcache", "example.test"), 0o700).catch(() => {});
    await rm(parent, { recursive: true, force: true });
  }
});

test("owned cleanup refuses the parent, filesystem root, wrong child and symbolic-link root", async (context) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-boundary-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-external-"));
  const aliasContainer = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-alias-"));
  const wrong = path.join(parent, "gosu-preparation-1");
  const symbolicRoot = path.join(parent, "aw-gosu-preparation-1");
  const realScratch = path.join(parent, "aw-gosu-preparation-2");
  const aliasParent = path.join(aliasContainer, "runner-temp");
  try {
    await mkdir(wrong); await mkdir(realScratch);
    await assert.rejects(builder.removeOwnedGosuScratch(parent, parent), /gosu_cleanup_path_invalid/u);
    await assert.rejects(builder.removeOwnedGosuScratch(path.join(path.parse(parent).root, "aw-gosu-preparation-1"), path.parse(parent).root), /gosu_cleanup_path_invalid/u);
    await assert.rejects(builder.removeOwnedGosuScratch(wrong, parent), /gosu_cleanup_path_invalid/u);
    await access(wrong);
    try { await symlink(external, symbolicRoot, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (error.code === "EPERM") { context.skip("symbolic links are unavailable"); return; } throw error; }
    await assert.rejects(builder.removeOwnedGosuScratch(symbolicRoot, parent), /gosu_cleanup_path_invalid/u);
    assert.equal((await lstat(symbolicRoot)).isSymbolicLink(), true);
    await symlink(parent, aliasParent, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(builder.removeOwnedGosuScratch(path.join(aliasParent, "aw-gosu-preparation-2"), aliasParent), /gosu_cleanup_path_invalid/u);
    await access(realScratch);
    await access(external);
  } finally {
    await rm(symbolicRoot, { force: true }).catch(() => {});
    await rm(aliasParent, { force: true }).catch(() => {});
    await rm(parent, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
    await rm(aliasContainer, { recursive: true, force: true });
  }
});

test("owned cleanup unlinks external symbolic links without following them", async (context) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-symlink-"));
  const external = path.join(parent, "external.txt");
  const scratch = path.join(parent, "aw-gosu-preparation-1");
  try {
    await writeFile(external, "outside", { mode: 0o400 });
    await mkdir(scratch);
    try { await symlink(external, path.join(scratch, "external-link"), "file"); }
    catch (error) { if (error.code === "EPERM") { context.skip("symbolic links are unavailable"); return; } throw error; }
    const before = (await stat(external)).mode & 0o777;
    await builder.removeOwnedGosuScratch(scratch, parent);
    assert.equal(await readFile(external, "utf8"), "outside");
    assert.equal((await stat(external)).mode & 0o777, before);
  } finally {
    await chmod(external, 0o600).catch(() => {});
    await rm(parent, { recursive: true, force: true });
  }
});

test("owned cleanup unlinks hard links without changing the shared inode permissions", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-hardlink-"));
  const external = path.join(parent, "external.txt");
  const scratch = path.join(parent, "aw-gosu-preparation-2");
  try {
    await writeFile(external, "outside", { mode: 0o600 });
    await chmod(external, 0o400);
    await mkdir(scratch);
    await link(external, path.join(scratch, "shared-inode"));
    const before = await stat(external);
    await builder.removeOwnedGosuScratch(scratch, parent);
    const after = await stat(external);
    assert.equal(await readFile(external, "utf8"), "outside");
    assert.equal(after.mode & 0o777, before.mode & 0o777);
    assert.equal(after.nlink, 1);
  } finally {
    await chmod(external, 0o600).catch(() => {});
    await rm(parent, { recursive: true, force: true });
  }
});

test("owned cleanup enforces its depth bound", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-depth-"));
  const scratch = path.join(parent, "aw-gosu-preparation-1");
  try {
    let current = scratch;
    await mkdir(current);
    for (let depth = 0; depth < 65; depth += 1) { current = path.join(current, "d"); await mkdir(current); }
    await assert.rejects(builder.removeOwnedGosuScratch(scratch, parent), /gosu_cleanup_limit_exceeded/u);
    await access(scratch);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test("cleanup failure remains observable without replacing the primary preparation failure", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "gosu-owned-errors-"));
  const primary = new Error("gosu_primary_failure");
  try {
    const wrong = path.join(parent, "wrong-child");
    let cleanupOnly; try { await builder.completeOwnedGosuScratch(undefined, wrong, parent); } catch (error) { cleanupOnly = error; }
    assert.match(cleanupOnly.message, /gosu_cleanup_path_invalid/u);
    assert.equal(builder.formatGosuPreparationFailure(cleanupOnly), "gosu_cleanup_path_invalid\n");
    let combined; try { await builder.completeOwnedGosuScratch(primary, wrong, parent); } catch (error) { combined = error; }
    assert.equal(combined instanceof AggregateError && combined.message === primary.message && combined.errors[0] === primary && combined.errors[1] === combined.cause && combined.errors[1].message === "gosu_cleanup_path_invalid", true);
    assert.equal(builder.formatGosuPreparationFailure(combined), "gosu_primary_failure\ngosu_cleanup_failed\n");
    assert.equal(builder.formatGosuPreparationFailure(combined).includes(parent), false);
    const source = await readFile(new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url), "utf8");
    assert.match(source, /process\.stderr\.write\(formatGosuPreparationFailure\(error\)\)/u);
    const scratch = path.join(parent, "aw-gosu-preparation-1");
    await mkdir(scratch);
    await assert.rejects(builder.completeOwnedGosuScratch(primary, scratch, parent), (error) => error === primary);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
