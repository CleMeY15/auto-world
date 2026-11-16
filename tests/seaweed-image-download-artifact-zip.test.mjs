import assert from "node:assert/strict";
import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { open, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { TEST_ONLY_streamGitHubArtifactZip, streamGitHubArtifactZip } from "../scripts/seaweed-image/download-artifact-zip.mjs";

const bytes = Buffer.from("fixed tiny GitHub ZIP transport fixture");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const artifact = Object.freeze({ id: 10_764_885_637, size: bytes.length, digest });

async function withSink(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "seaweed-download-test-"));
  const file = path.join(root, "out.zip");
  const handle = await open(file, "wx", 0o600);
  try {
    return await run(handle, file);
  } finally {
    await handle.close();
    await rm(root, { recursive: true, force: true });
  }
}

function fakeGh(payload, { exitCode = 0, hang = false, capture } = {}) {
  const script = `process.stdout.write(Buffer.from(${JSON.stringify(payload.toString("base64"))},"base64"));`
    + (hang ? "setInterval(()=>{},1000);" : `process.exit(${exitCode});`);
  return (executable, args, options) => {
    capture?.({ executable, args, options });
    return nodeSpawn(process.execPath, ["-e", script], options);
  };
}

test("streams the exact fixed ID with bounded gh arguments and caller-descriptor-only result", async () => {
  await withSink(async (handle, file) => {
    let command;
    const result = await TEST_ONLY_streamGitHubArtifactZip({
      artifact, handle, spawn: fakeGh(bytes, { capture: (value) => { command = value; } }),
      executable: "TEST_ONLY_gh", timeoutMs: 10_000,
    });
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(result, { id: artifact.id, size: bytes.length, digest,
      authority: "CALLER_DESCRIPTOR_ONLY", candidateAuthorization: "NOT_AUTHORIZED" });
    assert.equal(command.executable, "TEST_ONLY_gh");
    assert.deepEqual(command.args, ["api", "--method", "GET", "--hostname", "github.com",
      "--header", "Accept: application/vnd.github+json", "--header", "X-GitHub-Api-Version: 2022-11-28",
      `repos/CleMeY15/auto-world/actions/artifacts/${artifact.id}/zip`]);
    assert.equal(command.options.shell, false);
    assert.deepEqual(command.options.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(Object.hasOwn(command.options, "env"), false);
  });
});

test("passes only an immutable environment snapshot and resists caller mutation", async () => {
  await withSink(async (handle) => {
    const env = Object.assign(Object.create(null), { PATH: "/fixed/bin", LANG: "C.UTF-8" });
    let childEnv;
    const spawn = fakeGh(bytes, { capture: ({ options }) => {
      env.PATH = "/mutated";
      env.EXTRA = "late";
      childEnv = options.env;
    } });
    await TEST_ONLY_streamGitHubArtifactZip({
      artifact, handle, spawn, executable: "TEST_ONLY_gh", timeoutMs: 10_000, env,
    });
    assert.equal(Object.getPrototypeOf(childEnv), null);
    assert.equal(Object.isFrozen(childEnv), true);
    assert.deepEqual({ ...childEnv }, { PATH: "/fixed/bin", LANG: "C.UTF-8" });
    assert.throws(() => { childEnv.PATH = "/changed"; }, TypeError);
  });
});

test("rejects invalid environment records before spawning", async () => {
  const accessor = {};
  Object.defineProperty(accessor, "PATH", { get() { throw new Error("must not run"); } });
  const symbol = { PATH: "/bin" };
  symbol[Symbol("hidden")] = "value";
  const proxy = new Proxy({ PATH: "/bin" }, {});
  const tooMany = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`K_${index}`, "x"]));
  const tooLarge = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`K_${index}`, "x".repeat(8 * 1024)]));
  const cases = [accessor, symbol, proxy, [], new Date(), { "BAD-KEY": "x" }, { PATH: 1 },
    { PATH: `x${"\0"}y` }, { [`K${"x".repeat(128)}`]: "x" }, { K: "x".repeat(8 * 1024 + 1) },
    tooMany, tooLarge];
  for (const env of cases) {
    await withSink(async (handle) => {
      let spawned = false;
      await assert.rejects(TEST_ONLY_streamGitHubArtifactZip({
        artifact, handle, env, executable: "TEST_ONLY_gh", timeoutMs: 10_000,
        spawn: () => { spawned = true; throw new Error("must not spawn"); },
      }), { code: "seaweed_artifact_download_environment_invalid" });
      assert.equal(spawned, false);
    });
  }
});

test("production transport rejects injected command and descriptors with accessors", async () => {
  await withSink(async (handle) => {
    await assert.rejects(streamGitHubArtifactZip({ artifact, handle, spawn: fakeGh(bytes) }),
      { code: "seaweed_artifact_download_options_invalid" });
    const accessor = { id: artifact.id, size: artifact.size };
    Object.defineProperty(accessor, "digest", { get() { throw new Error("must not run"); } });
    await assert.rejects(TEST_ONLY_streamGitHubArtifactZip({ artifact: accessor, handle, spawn: fakeGh(bytes) }),
      { code: "seaweed_artifact_download_descriptor_invalid" });
  });
});

test("rejects short, oversized, digest-mismatched and nonzero child output", async () => {
  const cases = [
    { payload: bytes.subarray(0, -1), expected: "seaweed_artifact_download_size_invalid" },
    { payload: Buffer.concat([bytes, Buffer.from("!")]), expected: "seaweed_artifact_download_size_invalid" },
    { payload: bytes, descriptor: { ...artifact, digest: `sha256:${"0".repeat(64)}` }, expected: "seaweed_artifact_download_digest_invalid" },
    { payload: bytes, exitCode: 9, expected: "seaweed_artifact_download_command_failed" },
  ];
  for (const item of cases) {
    await withSink(async (handle, file) => {
      await assert.rejects(TEST_ONLY_streamGitHubArtifactZip({
        artifact: item.descriptor ?? artifact, handle, spawn: fakeGh(item.payload, { exitCode: item.exitCode }),
        executable: "TEST_ONLY_gh", timeoutMs: 10_000,
      }), { code: item.expected });
      assert.ok((await readFile(file)).length <= artifact.size);
    });
  }
});

test("waits for a hanging child after stdout and enforces the transfer deadline", async () => {
  await withSink(async (handle) => {
    const start = Date.now();
    await assert.rejects(TEST_ONLY_streamGitHubArtifactZip({
      artifact, handle, spawn: fakeGh(bytes, { hang: true }), executable: "TEST_ONLY_gh", timeoutMs: 500,
    }), { code: "seaweed_artifact_download_timeout" });
    assert.ok(Date.now() - start < 5_000);
  });
});

test("external abort stops the child and returns no receipt", async () => {
  await withSink(async (handle) => {
    const controller = new globalThis.AbortController();
    const pending = TEST_ONLY_streamGitHubArtifactZip({
      artifact, handle, spawn: fakeGh(bytes, { hang: true }), executable: "TEST_ONLY_gh",
      signal: controller.signal, timeoutMs: 10_000,
    });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending, { code: "seaweed_artifact_download_aborted" });
  });
});

test("unknown child closure is a bounded refusal both before output and after all bytes", async () => {
  for (const completeOutput of [false, true]) {
    await withSink(async (handle) => {
      let killed = false;
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { killed = true; return false; };
      const pending = TEST_ONLY_streamGitHubArtifactZip({ artifact, handle, executable: "TEST_ONLY_gh",
        timeoutMs: 30, cleanupTimeoutMs: 30, spawn: () => child });
      if (completeOutput) child.stdout.end(bytes);
      await assert.rejects(pending, { code: "seaweed_artifact_download_cleanup_uncertain" });
      assert.equal(killed, true);
      assert.equal(child.stdout.destroyed, true);
    });
  }
});

test("spawn failure and child stderr never leak command output", async () => {
  await withSink(async (handle) => {
    await assert.rejects(TEST_ONLY_streamGitHubArtifactZip({
      artifact, handle, spawn: () => { throw new Error("credential-shaped private text"); },
      executable: "TEST_ONLY_gh", timeoutMs: 10_000,
    }), (error) => error.code === "seaweed_artifact_download_command_failed"
      && !error.message.includes("private text"));
    const secretText = "credential-shaped stderr text";
    const spawn = (_executable, _args, options) => nodeSpawn(process.execPath,
      ["-e", `process.stderr.write(${JSON.stringify(secretText)});process.exit(9);`], options);
    await assert.rejects(TEST_ONLY_streamGitHubArtifactZip({
      artifact, handle, spawn, executable: "TEST_ONLY_gh", timeoutMs: 10_000,
    }), (error) => error.code === "seaweed_artifact_download_command_failed"
      && !error.message.includes(secretText));
  });
});
