import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { cleanEnvironment, createOwnedDirectory, removeOwnedDirectory, runCommand } from "../scripts/supply-chain/process.mjs";
import { dormantResult } from "../scripts/supply-chain/dormant.mjs";

test("child receives literal argv and no inherited authentication environment", async () => {
  const old = process.env.AUTO_WORLD_SENTINEL;
  process.env.AUTO_WORLD_SENTINEL = "local-sentinel-never-inherit";
  try {
    const result = await runCommand(process.execPath, ["-e", "process.stdout.write(JSON.stringify([process.env.AUTO_WORLD_SENTINEL,process.argv[1]]))", "$(echo unsafe); `literal`"], { cwd: process.cwd() });
    assert.deepEqual(JSON.parse(result.stdout.toString()), [null, "$(echo unsafe); `literal`"]);
    assert.equal(result.exitCode, 0);
  } finally {
    if (old === undefined) delete process.env.AUTO_WORLD_SENTINEL;
    else process.env.AUTO_WORLD_SENTINEL = old;
  }
  assert.throws(() => cleanEnvironment({ GH_TOKEN: "sentinel" }), { code: "environment_refused" });
  assert.throws(() => cleanEnvironment({ NODE_OPTIONS: "--require injected" }), { code: "environment_refused" });
  assert.equal(cleanEnvironment({ GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }).GIT_TERMINAL_PROMPT, "0");
  assert.throws(() => cleanEnvironment({ GIT_CONFIG_GLOBAL: "/inherited/config" }), { code: "environment_refused" });
  assert.throws(() => cleanEnvironment({ GIT_TERMINAL_PROMPT: "1" }), { code: "environment_refused" });
});

test("subprocess error hides raw sentinel output and enforces aggregate output and deadlines", async () => {
  await assert.rejects(runCommand(process.execPath, ["-e", "console.error('sentinel-private-value');process.exit(3)"], { cwd: process.cwd() }), (error) => {
    assert.equal(error.code, "command_failed");
    assert.equal(error.exitCode, 3);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /sentinel-private-value/u);
    return true;
  });
  await assert.rejects(runCommand(process.execPath, ["-e", "process.stdout.write('a'.repeat(129))"], { cwd: process.cwd(), maxOutputBytes: 128 }), { code: "command_output_limit" });
  const exact = await runCommand(process.execPath, ["-e", "process.stdout.write('a'.repeat(128))"], { cwd: process.cwd(), maxOutputBytes: 128 });
  assert.equal(exact.stdout.length, 128);
  await assert.rejects(runCommand(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { cwd: process.cwd(), timeoutMs: 50 }), { code: "command_timeout" });
  await assert.rejects(runCommand("node", [], { cwd: process.cwd() }), { code: "command_refused" });
});

test("owned cleanup refuses forged handles and preserves unrelated sentinel", async () => {
  const parent = await createOwnedDirectory();
  const child = await createOwnedDirectory(parent.path);
  try {
    const sentinel = path.join(parent.path, "unrelated.txt");
    await writeFile(sentinel, "preserve");
    await writeFile(path.join(child.path, "owned.txt"), "temporary");
    await assert.rejects(removeOwnedDirectory({ ...child }), { code: "cleanup_not_owned" });
    await removeOwnedDirectory(child);
    assert.equal(await readFile(sentinel, "utf8"), "preserve");
  } finally { await removeOwnedDirectory(parent); }
});

test("dormant entrypoint cannot enable any privileged operation", () => {
  assert.deepEqual(dormantResult(["status"]).capabilities, []);
  for (const args of [[], ["activate"], ["publish"], ["sign"], ["key-provision"], ["component", "trivy"], ["status", "--activate=true"], ["activate", "main", "owner", "valid-receipt"], { activated: true }]) {
    assert.equal(dormantResult(args).state, "refused");
    assert.equal(dormantResult(args).activation, "blocked");
    assert.deepEqual(dormantResult(args).capabilities, []);
  }
});
