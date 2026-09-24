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

function fixture({ probeFailure = false, cleanupFailure = false, preexisting = false,
  createMalformed = false, createThrows = false, foreignAfterCreate = false,
  probeStatus, helperAccepted = false, unexpectedExit = false } = {}) {
  const calls = []; const containerId = "c".repeat(64); let state = preexisting ? "running" : undefined;
  let nonce = ""; let inspectionsAfterCreate = 0;
  const docker = async (args, options) => {
    calls.push(args);
    assert.equal(options.cwd, parent); assert.equal(options.env.DOCKER_CONFIG, dockerConfig);
    if (args[0] === "container" && args[1] === "inspect") {
      if (state === undefined) return { status: 1, stdout: "", stderr: "not found\n" };
      inspectionsAfterCreate += 1;
      const observedId = cleanupFailure && inspectionsAfterCreate > 1 ? "d".repeat(64) : containerId;
      const observedNonce = foreignAfterCreate ? "f".repeat(48) : nonce;
      return { status: 0,
        stdout: `${observedId}|${state}|${unexpectedExit && state === "exited" ? 1 : 0}|${observedNonce}|${imageId}\n`,
        stderr: "" };
    }
    if (args[0] === "container" && args[1] === "ls") {
      assert.ok(args.includes("--all")); assert.ok(args.includes("--no-trunc"));
      assert.ok(args.includes(`name=^/aw-seaweed-runtime-${runId}-attempt-1$`));
      return { status: 0, stdout: state === undefined ? ""
        : `${containerId}|aw-seaweed-runtime-${runId}-attempt-1\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "create") {
      assert.ok(args.includes("--pull=never")); assert.ok(args.includes("--network=none"));
      assert.ok(args.includes("--read-only")); assert.ok(args.includes("--user=1000:1000"));
      assert.ok(args.includes("--memory=768m")); assert.ok(args.includes("--memory-swap=768m"));
      assert.ok(args.includes("--cpus=.75")); assert.ok(args.includes("--pids-limit=512"));
      assert.ok(args.includes("--cap-drop=ALL")); assert.ok(args.includes("--security-opt=no-new-privileges=true"));
      assert.ok(args.includes("--stop-timeout=30")); assert.ok(args.includes("--entrypoint=/bin/sh"));
      assert.ok(args.includes("--label"));
      const label = args[args.indexOf("--label") + 1];
      assert.match(label, /^com\.auto-world\.runtime-nonce=[0-9a-f]{48}$/u);
      nonce = label.split("=")[1];
      assert.equal(args.includes("--publish"), false); assert.equal(args.at(-2), "-c");
      assert.match(args.at(-1), /umask 077/u); assert.match(args.at(-1), /s3\.port\.iceberg=0/u);
      assert.match(args.at(-1), /s3\.port\.lance=0/u); state = "created";
      if (createThrows) throw new Error("daemon response lost after creation");
      if (createMalformed) return { status: 0, stdout: "malformed\n", stderr: "" };
      return { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "start") {
      state = "running"; return { status: 0, stdout: `${args[2]}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "exec" && args.at(-1).includes?.("SEAWEED_RUNTIME_PROFILE_VERIFIED")) {
      assert.equal(options.timeoutMs, 300_000);
      assert.match(args.at(-1), /http:\/\/127\.0\.0\.1:8333\/readyz/u);
      assert.match(args.at(-1), /test "\$s3ready" = 200 \|\| exit 33/u);
      assert.match(args.at(-1), /case "\$anonymous" in 403\) ;; 000\|''\) exit 33 ;; 200\) exit 22 ;; \*\) exit 34/u);
      return probeFailure || probeStatus !== undefined
        ? { status: probeStatus ?? 21, stdout: "", stderr: "" }
        : { status: 0, stdout: "SEAWEED_RUNTIME_PROFILE_VERIFIED\n", stderr: "" };
    }
    if (args[0] === "container" && args[1] === "exec") {
      assert.ok(["volume-rust", "worker-rust"].includes(args.at(-1)));
      return helperAccepted ? { status: 0, stdout: "helper ran\n", stderr: "" }
        : { status: 127, stdout: "", stderr: `${args.at(-1)}: not found\n` };
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
  assert.equal(proof.readiness, "CLUSTER_STATUS_200_S3_READYZ_200");
  assert.equal(proof.anonymousAccess, "REFUSED_403");
  assert.equal(proof.rustHelpers, "ABSENT_AND_REJECTED"); assert.equal(value.state, undefined);
  assert.equal(value.calls.filter((args) => args[1] === "stop").length, 1);
  assert.equal(value.calls.filter((args) => args[1] === "rm").length, 1);
});

test("runtime failure still cleans the owned container", async () => {
  const value = fixture({ probeFailure: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_PROBE", reason: "VERSION_MISMATCH" });
  assert.equal(value.state, undefined); assert.equal(value.calls.filter((args) => args[1] === "stop").length, 1);
  assert.deepEqual(value.calls.filter((args) => args[1] === "rm"),
    [["container", "rm", `aw-seaweed-runtime-${runId}-attempt-1`]]);
});

for (const [status, reason] of [
  [21, "VERSION_MISMATCH"], [22, "ANONYMOUS_ALLOWED"], [23, "UID_MISMATCH"],
  [24, "GID_MISMATCH"], [25, "CONFIG_MODE_MISMATCH"], [26, "READINESS_UNAVAILABLE"],
  [27, "ICEBERG_LISTENER_OPEN"], [28, "LANCE_LISTENER_OPEN"],
  [29, "RUST_HELPER_PRESENT"], [32, "PROBE_COMMAND"], [33, "S3_UNAVAILABLE"],
  [34, "ANONYMOUS_UNEXPECTED_STATUS"],
]) {
  test(`runtime probe status ${status} reports bounded reason ${reason}`, async () => {
    const value = fixture({ probeStatus: status });
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
      { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_PROBE", reason });
    assert.equal(value.state, undefined);
  });
}

test("a Rust helper unexpectedly accepting execution blocks the proof", async () => {
  const value = fixture({ helperAccepted: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_HELPERS",
      reason: "RUST_HELPER_ACCEPTED" });
  assert.equal(value.state, undefined);
});

test("a nonzero PID-1 exit blocks the proof after bounded stop", async () => {
  const value = fixture({ unexpectedExit: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_STOP", reason: "EXIT_UNEXPECTED" });
  assert.equal(value.state, undefined);
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

for (const scenario of ["createMalformed", "createThrows"]) {
  test(`a created container is recovered and removed when ${scenario} loses its ID`, async () => {
    const value = fixture({ [scenario]: true });
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
      { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_CREATE" });
    assert.equal(value.state, undefined);
    assert.deepEqual(value.calls.filter((args) => args[1] === "rm"),
      [["container", "rm", `aw-seaweed-runtime-${runId}-attempt-1`]]);
  });
}

test("an unowned name after a lost create response is preserved and blocks cleanup", async () => {
  const value = fixture({ createMalformed: true, foreignAfterCreate: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_cleanup_failed", phase: "RUNTIME_CLEANUP",
      reason: "OWNERSHIP_UNCERTAIN" });
  assert.equal(value.state, "created");
  assert.equal(value.calls.some((args) => args[1] === "rm"), false);
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
