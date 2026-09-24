import assert from "node:assert/strict";
import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { open, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  });
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
