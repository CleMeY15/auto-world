import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SEAWEED_PACKAGE_PRIVATE_READ,
  classifyAnonymousRemoteRead,
  parsePrivateReadArguments,
  runSeaweedPackagePrivateRead,
  validatePrivateReadContext,
  validateRemoteManifest,
} from "../scripts/seaweed-image/package-private-read.mjs";

const sha = "a".repeat(40);
const configId = `sha256:${"c".repeat(64)}`;
const rawManifest = "fixed-manifest";

function fixture() {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-seaweed-private-read-"));
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_JOB: "verify",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: SEAWEED_PACKAGE_PRIVATE_READ.repository,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "35990000000",
    GITHUB_RUN_NUMBER: "2",
    GITHUB_SHA: sha,
    GITHUB_TOKEN: "secret-token-value",
    GITHUB_WORKFLOW_REF: `${SEAWEED_PACKAGE_PRIVATE_READ.repository}/${SEAWEED_PACKAGE_PRIVATE_READ.workflowPath}@refs/heads/main`,
    GITHUB_WORKSPACE: runnerTemp,
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    RUNNER_TEMP: runnerTemp,
  };
  return {
    env,
    output: path.join(runnerTemp, SEAWEED_PACKAGE_PRIVATE_READ.outputDirectory),
    runnerTemp,
  };
}

function exactManifest(raw) {
  assert.equal(raw, rawManifest);
  return { sha256: SEAWEED_PACKAGE_PRIVATE_READ.digest, size: Buffer.byteLength(raw) };
}

function commandRunner({
  calls,
  anonymousMessage = "unauthorized: authentication required",
  anonymousSuccess = false,
  copiedPayload = SEAWEED_PACKAGE_PRIVATE_READ.payload,
  failContainerRemoval = false,
  failImageRemoval = false,
  failPullAfterLocalCreate = false,
  foreignRecoveredContainer = false,
  localCollision = false,
  lostCreateResponse = false,
  wrongLabels = false,
} = {}) {
  const subject = `${SEAWEED_PACKAGE_PRIVATE_READ.image}@${SEAWEED_PACKAGE_PRIVATE_READ.digest}`;
  const container = "aw-seaweed-package-private-read-35990000000";
  let imagePresent = localCollision;
  let containerPresent = false;
  return (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env, input: options.input });
    if (command === "git") return { status: 0, stdout: `${sha}\n`, stderr: "" };
    if (args[0] === "version" && args[1] === "--format") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.37.0\n", stderr: "" };
    if (args[0] === "login") return { status: 0, stdout: "Login Succeeded", stderr: "" };
    if (args[0] === "buildx" && args[1] === "imagetools" && args[2] === "inspect") {
      if (options.env.DOCKER_CONFIG.endsWith("docker-anonymous")) {
        return anonymousSuccess
          ? { status: 0, stdout: rawManifest, stderr: "" }
          : { status: 1, stdout: "", stderr: anonymousMessage };
      }
      return { status: 0, stdout: rawManifest, stderr: "" };
    }
    if (args[0] === "image" && args[1] === "inspect" && args[2] === subject) {
      return imagePresent
        ? { status: 0, stdout: "[]", stderr: "" }
        : { status: 1, stdout: "", stderr: "Error: No such image" };
    }
    if (args[0] === "container" && args[1] === "inspect") {
      if (!containerPresent) return { status: 1, stdout: "", stderr: "Error: No such container" };
      if (args[2] !== "--format") return { status: 0, stdout: "[]", stderr: "" };
      return {
        status: 0,
        stdout: JSON.stringify({
          Name: `/${container}`,
          Config: { Image: foreignRecoveredContainer ? "ghcr.io/other/image@sha256:foreign" : subject },
          State: { Running: false },
        }),
        stderr: "",
      };
    }
    if (args[0] === "pull") {
      imagePresent = true;
      return failPullAfterLocalCreate
        ? { status: 1, stdout: "partial", stderr: "pull failed" }
        : { status: 0, stdout: "pulled", stderr: "" };
    }
    if (args[0] === "image" && args[1] === "inspect" && args[2] === "--format") {
      return {
        status: 0,
        stdout: JSON.stringify({
          Id: configId,
          Os: "linux",
          Architecture: "amd64",
          Size: 4096,
          RepoDigests: [subject],
          Config: {
            Labels: {
              "org.opencontainers.image.source": SEAWEED_PACKAGE_PRIVATE_READ.sourceUrl,
              "org.opencontainers.image.description": wrongLabels ? "changed" : SEAWEED_PACKAGE_PRIVATE_READ.description,
            },
          },
        }),
        stderr: "",
      };
    }
    if (args[0] === "create") {
      containerPresent = true;
      return lostCreateResponse
        ? { status: 1, stdout: "", stderr: "response lost" }
        : { status: 0, stdout: "container-id", stderr: "" };
    }
    if (args[0] === "cp") {
      writeFileSync(args[2], copiedPayload);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "rm") {
      if (failContainerRemoval) return { status: 1, stdout: "", stderr: "container removal failed" };
      containerPresent = false;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "image" && args[1] === "rm") {
      if (failImageRemoval) return { status: 1, stdout: "", stderr: "image removal failed" };
      imagePresent = false;
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected:${command}:${args.join(" ")}`);
  };
}

test("arguments and exact run-two GitHub context reject alternate execution", () => {
  const absolute = path.resolve(SEAWEED_PACKAGE_PRIVATE_READ.outputDirectory);
  assert.deepEqual(parsePrivateReadArguments(["--output", absolute]), { output: absolute });
  for (const argv of [[], ["--digest", SEAWEED_PACKAGE_PRIVATE_READ.digest], ["--output", "relative"]]) {
    assert.throws(() => parsePrivateReadArguments(argv), /arguments_invalid/u);
  }
  const item = fixture();
  try {
    assert.equal(validatePrivateReadContext(item.env, "linux").runNumber, "2");
    for (const invalid of [
      { ...item.env, GITHUB_RUN_NUMBER: "1" },
      { ...item.env, GITHUB_RUN_NUMBER: "3" },
      { ...item.env, GITHUB_RUN_ATTEMPT: "2" },
      { ...item.env, GITHUB_JOB: "publish" },
      { ...item.env, GITHUB_TOKEN: "" },
      { ...item.env, GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/other.yml@refs/heads/main" },
    ]) assert.throws(() => validatePrivateReadContext(invalid, "linux"), /seaweed_package_private_read_/u);
  } finally {
    rmSync(item.runnerTemp, { recursive: true, force: true });
  }
});

test("anonymous denial is distinct from remote success and network failure", () => {
  assert.equal(classifyAnonymousRemoteRead({ status: 1, stdout: "", stderr: "unauthorized: authentication required" }), "AUTHORIZATION_DENIED");
  assert.throws(() => classifyAnonymousRemoteRead({ status: 0, stdout: rawManifest, stderr: "" }), /anonymous_remote_succeeded/u);
  assert.throws(() => classifyAnonymousRemoteRead({ status: 1, stdout: "unauthorized", stderr: "TLS handshake timeout" }), /anonymous_remote_error/u);
  assert.throws(() => classifyAnonymousRemoteRead({ status: 1, stdout: "", stderr: "dial tcp: no such host" }), /anonymous_remote_error/u);
});

test("remote manifest bytes must hash to the requested digest", () => {
  const digest = `sha256:${createHash("sha256").update(rawManifest).digest("hex")}`;
  assert.deepEqual(validateRemoteManifest(rawManifest, digest), { sha256: digest, size: Buffer.byteLength(rawManifest) });
  assert.throws(() => validateRemoteManifest(`${rawManifest}\n`, digest), /manifest_invalid/u);
  assert.throws(() => validateRemoteManifest(rawManifest, "sha256:short"), /manifest_invalid/u);
});

test("private read proves authorized-denied-authorized remote reads and exact stopped-container bytes", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  const receipt = await runSeaweedPackagePrivateRead({
    argv: ["--output", item.output],
    commandRunner: commandRunner({ calls }),
    env: item.env,
    manifestValidator: exactManifest,
    platform: "linux",
  });
  assert.equal(receipt.result, "PASSED");
  assert.equal(receipt.state, "PRIVATE_READ_PROOF");
  assert.equal(receipt.publication, "NOT_ATTEMPTED");
  assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.equal(receipt.forkAccessTest, "SKIPPED_BY_USER");
  assert.equal(receipt.manifestDigest, SEAWEED_PACKAGE_PRIVATE_READ.digest);
  assert.deepEqual(receipt.remoteManifestBefore, receipt.remoteManifestAfter);
  assert.equal(receipt.copiedPayload.sha256, "fc310f41ea257c6abcb9313460088793eba96809ce666d611952da16e6f54f66");
  assert.deepEqual(receipt.phases.map(({ name, result }) => [name, result]), [
    ["managed_tool_identity", "PASSED"],
    ["checkout_identity", "PASSED"],
    ["authorized_registry_login", "PASSED"],
    ["remote_manifest_before", "PASSED"],
    ["anonymous_manifest_denied", "PASSED"],
    ["remote_manifest_after", "PASSED"],
    ["local_collision_check", "PASSED"],
    ["authorized_image_pull", "PASSED"],
    ["exact_image_inspection", "PASSED"],
    ["stopped_container_create", "PASSED"],
    ["stopped_container_copy", "PASSED"],
    ["owned_docker_cleanup", "PASSED"],
    ["owned_temporary_cleanup", "PASSED"],
  ]);
  const remoteReads = calls.filter(({ args }) => args[0] === "buildx" && args[1] === "imagetools");
  assert.equal(remoteReads.length, 3);
  assert.notEqual(remoteReads[0].env.DOCKER_CONFIG, remoteReads[1].env.DOCKER_CONFIG);
  assert.equal(remoteReads[0].env.DOCKER_CONFIG, remoteReads[2].env.DOCKER_CONFIG);
  assert.match(remoteReads[1].env.BUILDX_CONFIG, /docker-anonymous[\\/]buildx$/u);
  assert.equal(calls.some(({ args }) => args[0] === "run" || args[0] === "start"), false);
  assert.equal(calls.find(({ args }) => args[0] === "login").input, `${item.env.GITHUB_TOKEN}\n`);
  assert.equal(JSON.stringify(receipt).includes(item.env.GITHUB_TOKEN), false);
  assert.equal(existsSync(path.join(item.runnerTemp, `aw-seaweed-package-private-read-${item.env.GITHUB_RUN_ID}-attempt-1`)), false);
});

test("substitution and ambiguous anonymous failures fail closed while owned objects are cleaned", async (context) => {
  for (const variant of [
    { copiedPayload: "changed\n" },
    { anonymousMessage: "dial tcp: no such host" },
    { anonymousSuccess: true },
    { wrongLabels: true },
  ]) {
    const item = fixture();
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const calls = [];
    await assert.rejects(runSeaweedPackagePrivateRead({
      argv: ["--output", item.output],
      commandRunner: commandRunner({ calls, ...variant }),
      env: item.env,
      manifestValidator: exactManifest,
      platform: "linux",
    }), /seaweed_package_private_read_/u);
    const receipt = readFileSync(path.join(item.output, "receipt.json"), "utf8");
    assert.match(receipt, /"result": "FAILED"/u);
    assert.equal(receipt.includes(item.env.GITHUB_TOKEN), false);
    assert.equal(existsSync(path.join(item.runnerTemp, `aw-seaweed-package-private-read-${item.env.GITHUB_RUN_ID}-attempt-1`)), false);
  }
});

test("pre-existing local Docker objects are never claimed or removed", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(runSeaweedPackagePrivateRead({
    argv: ["--output", item.output],
    commandRunner: commandRunner({ calls, localCollision: true }),
    env: item.env,
    manifestValidator: exactManifest,
    platform: "linux",
  }), /local_collision/u);
  assert.equal(calls.some(({ args }) => args[0] === "pull" || args[0] === "rm" || (args[0] === "image" && args[1] === "rm")), false);
});

test("a failed pull that leaves the previously absent exact digest is cleaned", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(runSeaweedPackagePrivateRead({
    argv: ["--output", item.output],
    commandRunner: commandRunner({ calls, failPullAfterLocalCreate: true }),
    env: item.env,
    manifestValidator: exactManifest,
    platform: "linux",
  }), /command_failed/u);
  assert.equal(calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), true);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.phases.find(({ name }) => name === "authorized_image_pull").result, "FAILED");
  assert.equal(receipt.phases.find(({ name }) => name === "owned_docker_cleanup").result, "PASSED");
});

test("a lost create response recovers and removes the exact previously absent container", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(runSeaweedPackagePrivateRead({
    argv: ["--output", item.output],
    commandRunner: commandRunner({ calls, lostCreateResponse: true }),
    env: item.env,
    manifestValidator: exactManifest,
    platform: "linux",
  }), /command_failed/u);
  assert.equal(calls.some(({ args }) => args[0] === "rm"), true);
  assert.equal(calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), true);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.phases.find(({ name }) => name === "stopped_container_create").result, "FAILED");
  assert.equal(receipt.phases.find(({ name }) => name === "owned_docker_cleanup").result, "PASSED");
});

test("a recovered container with foreign identity is preserved and fails cleanup", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(runSeaweedPackagePrivateRead({
    argv: ["--output", item.output],
    commandRunner: commandRunner({ calls, foreignRecoveredContainer: true, lostCreateResponse: true }),
    env: item.env,
    manifestValidator: exactManifest,
    platform: "linux",
  }), /command_failed/u);
  assert.equal(calls.some(({ args }) => args[0] === "rm"), false);
  assert.equal(calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), true);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.phases.find(({ name }) => name === "owned_docker_cleanup").result, "FAILED");
});

test("container cleanup failure does not skip image cleanup and aggregates both absence failures", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  await assert.rejects(runSeaweedPackagePrivateRead({
    argv: ["--output", item.output],
    commandRunner: commandRunner({ calls, failContainerRemoval: true, failImageRemoval: true }),
    env: item.env,
    manifestValidator: exactManifest,
    platform: "linux",
  }), /container_cleanup_failed/u);
  const containerRemove = calls.findIndex(({ args }) => args[0] === "rm");
  const imageRemove = calls.findIndex(({ args }) => args[0] === "image" && args[1] === "rm");
  assert.equal(containerRemove >= 0, true);
  assert.equal(imageRemove > containerRemove, true);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  const cleanup = receipt.phases.find(({ name }) => name === "owned_docker_cleanup");
  assert.equal(cleanup.result, "FAILED");
  assert.deepEqual(cleanup.reasons, [
    "seaweed_package_private_read_container_cleanup_failed",
    "seaweed_package_private_read_image_cleanup_failed",
  ]);
  assert.equal(receipt.phases.find(({ name }) => name === "owned_temporary_cleanup").result, "PASSED");
});
