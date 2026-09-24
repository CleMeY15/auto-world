import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_verifyLocalSeaweedRuntimeProfile, validateSeaweedRuntimeProfileProof,
  verifyLocalSeaweedRuntimeProfile } from "../scripts/seaweed-image/candidate-runtime.mjs";

const imageId = `sha256:${"a".repeat(64)}`;
const runId = "35941171343";
const recipeRevision = "b".repeat(40);
const parent = path.resolve("runtime-test-parent");
const dockerConfig = path.resolve("runtime-test-docker-config");

function fixture({ probeFailure = false, cleanupFailure = false, preexisting = false } = {}) {
  const calls = []; const containerId = "c".repeat(64); let state = preexisting ? "running" : undefined;
  const docker = async (args, options) => {
    calls.push(args);
    assert.equal(options.cwd, parent); assert.equal(options.env.DOCKER_CONFIG, dockerConfig);
    if (args[0] === "container" && args[1] === "inspect") {
      if (state === undefined) return { status: 1, stdout: "", stderr: "not found\n" };
      return { status: 0, stdout: `${cleanupFailure ? "d".repeat(64) : containerId}|${state}|0\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "create") {
      assert.ok(args.includes("--pull=never")); assert.ok(args.includes("--network=none"));
      assert.ok(args.includes("--read-only")); assert.ok(args.includes("--user=1000:1000"));
      assert.ok(args.includes("--memory=768m")); assert.ok(args.includes("--memory-swap=768m"));
      assert.ok(args.includes("--cpus=.75")); assert.ok(args.includes("--pids-limit=512"));
      assert.ok(args.includes("--cap-drop=ALL")); assert.ok(args.includes("--security-opt=no-new-privileges=true"));
      assert.ok(args.includes("--stop-timeout=30")); assert.ok(args.includes("--entrypoint=/bin/sh"));
      assert.equal(args.includes("--publish"), false); assert.equal(args.at(-2), "-c");
      assert.match(args.at(-1), /umask 077/u); assert.match(args.at(-1), /s3\.port\.iceberg=0/u);
      assert.match(args.at(-1), /s3\.port\.lance=0/u); state = "created";
      return { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "start") {
      state = "running"; return { status: 0, stdout: `${args[2]}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "exec" && args.at(-1).includes?.("SEAWEED_RUNTIME_PROFILE_VERIFIED")) {
      return probeFailure ? { status: 21, stdout: "", stderr: "" }
        : { status: 0, stdout: "SEAWEED_RUNTIME_PROFILE_VERIFIED\n", stderr: "" };
    }
    if (args[0] === "container" && args[1] === "exec") {
      assert.ok(["volume-rust", "worker-rust"].includes(args.at(-1)));
      return { status: 127, stdout: "", stderr: `${args.at(-1)}: not found\n` };
    }
    if (args[0] === "container" && args[1] === "stop") {
      assert.deepEqual(args.slice(0, 4), ["container", "stop", "--time", "30"]);
      state = "exited"; return { status: 0, stdout: `${args.at(-1)}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "rm") {
      assert.deepEqual(args.slice(0, 2), ["container", "rm"]); assert.equal(args.length, 3);
      state = undefined; return { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    throw new Error(`unexpected Docker call: ${args.join(" ")}`);
  };
  return { calls, docker, get state() { return state; } };
}

function input(extra = {}) { return { parent, dockerConfig, imageId, runId, recipeRevision, ...extra }; }

test("runtime diagnostic applies the fixed isolated profile and returns a bounded proof", async () => {
  const value = fixture();
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker });
  assert.deepEqual(validateSeaweedRuntimeProfileProof(proof, { imageId, runId, recipeRevision }), proof);
  assert.equal(proof.authority, "DIAGNOSTIC_ONLY"); assert.equal(proof.candidateAuthorization, "NOT_AUTHORIZED");
  assert.equal(proof.derivativeVersion, "c507336+aw.549ec92660ab");
  assert.equal(proof.rustHelpers, "ABSENT_AND_REJECTED"); assert.equal(value.state, undefined);
  assert.equal(value.calls.filter((args) => args[1] === "stop").length, 1);
  assert.equal(value.calls.filter((args) => args[1] === "rm").length, 1);
});

test("runtime failure still cleans the owned container", async () => {
  const value = fixture({ probeFailure: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_failed" });
  assert.equal(value.state, undefined); assert.equal(value.calls.filter((args) => args[1] === "stop").length, 1);
  assert.deepEqual(value.calls.filter((args) => args[1] === "rm"),
    [["container", "rm", `aw-seaweed-runtime-${runId}-attempt-1`]]);
});

test("cleanup identity drift takes priority and never removes the foreign container", async () => {
  const value = fixture({ probeFailure: true, cleanupFailure: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_cleanup_failed" });
  assert.equal(value.calls.some((args) => args[1] === "rm"), false);
});

test("pre-existing container blocks execution without removal", async () => {
  const value = fixture({ preexisting: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_failed" });
  assert.equal(value.calls.some((args) => args[1] === "create" || args[1] === "rm"), false);
});

test("proof and input validators reject extra or altered fields", async () => {
  const value = fixture();
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker });
  assert.throws(() => validateSeaweedRuntimeProfileProof({ ...proof, admission: "NOT_ATTEMPTED" },
    { imageId, runId, recipeRevision }), { code: "seaweed_candidate_runtime_failed" });
  assert.throws(() => validateSeaweedRuntimeProfileProof({ ...proof, uid: 0 }, { imageId, runId, recipeRevision }),
    { code: "seaweed_candidate_runtime_failed" });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile({ ...input(), args: ["--privileged"] },
    { docker: value.docker }), { code: "seaweed_candidate_runtime_failed" });
  if (process.platform !== "linux") await assert.rejects(verifyLocalSeaweedRuntimeProfile(input()),
    { code: "seaweed_candidate_runtime_failed" });
});
