import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_signedSeaweedS3ProbeScript, TEST_ONLY_verifyLocalSeaweedRuntimeProfile,
  validateSeaweedRuntimeProfileProof, verifyLocalSeaweedRuntimeProfile } from
  "../scripts/seaweed-image/candidate-runtime.mjs";

const imageId = `sha256:${"a".repeat(64)}`;
const runId = "35941171343";
const recipeRevision = "b".repeat(40);
const parent = path.resolve("runtime-test-parent");
const dockerConfig = path.resolve("runtime-test-docker-config");

function fixture({ probeFailure = false, cleanupFailure = false, preexisting = false,
  createMalformed = false, createThrows = false, foreignAfterCreate = false,
  probeStatus, signedStatus, signedMalformed = false,
  helperAccepted = false, unexpectedExit = false } = {}) {
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
      assert.ok(args.includes("/tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000"));
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
      assert.equal(options.timeoutMs, 390_000);
      assert.match(args.at(-1), /stat -c '%u:%g:%a' \/tmp/u);
      assert.match(args.at(-1), /http:\/\/127\.0\.0\.1:8888\/readyz/u);
      assert.match(args.at(-1), /test "\$filerready" = 200 \|\| exit 36/u);
      assert.match(args.at(-1), /http:\/\/127\.0\.0\.1:8333\/readyz/u);
      assert.match(args.at(-1), /test "\$s3ready" = 200 \|\| exit 33/u);
      assert.match(args.at(-1), /case "\$anonymous" in 403\) ;; 000\|''\) exit 33 ;; 200\) exit 22 ;; \*\) exit 34/u);
      return probeFailure || probeStatus !== undefined
        ? { status: probeStatus ?? 21, stdout: "", stderr: "" }
        : { status: 0, stdout: "SEAWEED_RUNTIME_PROFILE_VERIFIED\n", stderr: "" };
    }
    if (args[0] === "container" && args[1] === "exec"
      && args.at(-1).includes?.("SEAWEED_SIGNED_S3_PROTOCOL_VERIFIED")) {
      const script = args.at(-1);
      assert.equal(options.timeoutMs, 90_000);
      assert.match(script, /--aws-sigv4 'aws:amz:us-east-1:s3'/u);
      assert.match(script, /http:\/\/127\.0\.0\.1:8333\/aw-raw\/proof/u);
      assert.match(script, /http:\/\/127\.0\.0\.1:8333\/aw-forbidden/u);
      assert.match(script, /--header 'If-None-Match: \*'/u);
      assert.match(script, /case "\$wrong" in 403\) ;; 000\|''\) exit 49 ;; 2\?\?\) exit 44 ;; \*\) exit 50 ;; esac/u);
      assert.match(script, /test "\$same" = 412 && test "\$different" = 412/u);
      assert.match(script, /case "\$forbidden" in 403\) ;; 000\|''\) exit 49 ;; 2\?\?\) exit 45 ;; \*\) exit 51 ;; esac/u);
      assert.match(script, /case "\$unsigned" in 403\) ;; 000\|''\) exit 49 ;; 2\?\?\) exit 48 ;; \*\) exit 52 ;; esac/u);
      assert.match(script, /test "\$a" = 200 && \{ test "\$b" = 412 \|\| test "\$b" = 409; \}/u);
      return signedStatus !== undefined ? { status: signedStatus, stdout: "", stderr: "" }
        : { status: 0, stdout: signedMalformed ? "UNVERIFIED\n"
          : "SEAWEED_SIGNED_S3_PROTOCOL_VERIFIED\n", stderr: "" };
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

test("signed S3 probe parses under the Linux container shell", { skip: process.platform !== "linux" }, () => {
  const result = spawnSync("sh", ["-n"], { input: TEST_ONLY_signedSeaweedS3ProbeScript(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("signed S3 shell distinguishes accepted access from unexpected HTTP failures",
  { skip: process.platform !== "linux" }, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "aw-s3-status-"));
    try {
      const curl = path.join(directory, "curl");
      const sha256sum = path.join(directory, "sha256sum");
      writeFileSync(curl, `#!/bin/sh
case " $* " in *' --help all '*) printf '%s\\n' '--aws-sigv4'; exit 0 ;; esac
case " $* " in
  *' --user AWDIAGNOSTICACCESS:incorrect '*) printf '%s' "\${AW_TEST_WRONG:-403}" ;;
  *'/aw-forbidden '*) printf '%s' "\${AW_TEST_FORBIDDEN:-403}" ;;
  *' --request PUT '*'/aw-raw/proof '*) printf '%s' "\${AW_TEST_PUT:-200}" ;;
  *' --request PUT '*'/aw-raw '*) printf '%s' "\${AW_TEST_BUCKET:-200}" ;;
  *' --aws-sigv4 '*'/aw-raw/proof '*) printf '%s' "\${AW_TEST_READ:-200}" ;;
  *'/aw-raw/proof '*) printf '%s' "\${AW_TEST_UNSIGNED:-403}" ;;
  *) exit 2 ;;
esac
`);
      writeFileSync(sha256sum, `#!/bin/sh
printf '%s  %s\\n' 'b30f82db4f920b641336de83b57cf6bc22537f38f08f0f16680526b067245fa1' "$1"
`);
      chmodSync(curl, 0o700); chmodSync(sha256sum, 0o700);
      for (const [name, status, exitCode] of [
        ["BUCKET", "500", 53], ["BUCKET", "403", 42],
        ["READ", "404", 54],
        ["WRONG", "404", 50], ["WRONG", "200", 44],
        ["FORBIDDEN", "429", 51], ["FORBIDDEN", "200", 45],
        ["UNSIGNED", "500", 52], ["UNSIGNED", "200", 48],
      ]) {
        const result = spawnSync("sh", ["-c", TEST_ONLY_signedSeaweedS3ProbeScript()], {
          env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, [`AW_TEST_${name}`]: status },
          encoding: "utf8",
        });
        assert.equal(result.status, exitCode, `${name} ${status}: ${result.stderr}`);
        assert.equal(result.stdout, "");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

test("runtime diagnostic applies the fixed isolated profile and returns a bounded proof", async () => {
  const value = fixture();
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker });
  assert.deepEqual(validateSeaweedRuntimeProfileProof(proof, { imageId, runId, recipeRevision }), proof);
  assert.equal(proof.kind, "SEAWEED_LOCAL_RUNTIME_PROOF_V2");
  assert.equal(proof.authority, "DIAGNOSTIC_ONLY"); assert.equal(proof.candidateAuthorization, "NOT_AUTHORIZED");
  assert.equal(proof.derivativeVersion, "c507336+aw.549ec92660ab");
  assert.equal(proof.profileSha256, "18917ea3a8f6d3fc9dcb082bc6ccfe93612ac9ec3436c28d6feaf2ae4fe0483c");
  assert.equal(proof.commandSha256, "74a975271752c4ea64213fbf069d20fb9aa6acdb602e81957a78986511888507");
  assert.equal(proof.readiness, "CLUSTER_STATUS_200_FILER_READYZ_200_S3_READYZ_200");
  assert.equal(proof.anonymousAccess, "REFUSED_403");
  assert.equal(proof.authenticatedAccess, "SIGNED_CREATE_PUT_GET_SHA256");
  assert.equal(proof.scopeEnforcement, "WRONG_KEY_AND_BUCKET_REFUSED_403");
  assert.equal(proof.conditionalWrites, "REPLAY_AND_OVERWRITE_REFUSED_412");
  assert.equal(proof.parallelAttempt, "SINGLE_PAIR_ONE_WINNER_READBACK");
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
  [34, "ANONYMOUS_UNEXPECTED_STATUS"], [35, "TMPFS_MODE_MISMATCH"],
  [36, "FILER_UNAVAILABLE"],
]) {
  test(`runtime probe status ${status} reports bounded reason ${reason}`, async () => {
    const value = fixture({ probeStatus: status });
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
      { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_PROBE", reason });
    assert.equal(value.state, undefined);
  });
}

test("a successful shell exit without the signed S3 marker cannot issue a proof", async () => {
  const value = fixture({ signedMalformed: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_S3_PROTOCOL",
      reason: "PROBE_OUTPUT_INVALID" });
  assert.equal(value.state, undefined);
});

for (const [status, reason] of [
  [41, "SIGNED_CLIENT_UNAVAILABLE"], [42, "ALLOWED_SCOPE_DENIED"],
  [43, "READBACK_MISMATCH"], [44, "WRONG_CREDENTIAL_ACCEPTED"],
  [45, "FORBIDDEN_SCOPE_ALLOWED"], [46, "CONDITIONAL_WRITE_UNEXPECTED"],
  [47, "CONCURRENT_WRITE_UNEXPECTED"], [48, "ANONYMOUS_OBJECT_ALLOWED"],
  [49, "SIGNED_TRANSPORT_FAILURE"],
  [50, "WRONG_CREDENTIAL_UNEXPECTED_STATUS"], [51, "FORBIDDEN_SCOPE_UNEXPECTED_STATUS"],
  [52, "ANONYMOUS_OBJECT_UNEXPECTED_STATUS"], [53, "ALLOWED_SCOPE_UNEXPECTED_STATUS"],
  [54, "READ_UNEXPECTED_STATUS"],
  [127, "SIGNED_CLIENT_UNAVAILABLE"],
]) {
  test(`signed S3 probe status ${status} reports bounded reason ${reason}`, async () => {
    const value = fixture({ signedStatus: status });
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input(), { docker: value.docker }),
      { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_S3_PROTOCOL", reason });
    assert.equal(value.state, undefined);
    assert.equal(value.calls.filter((args) => args[1] === "rm").length, 1);
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
  assert.throws(() => validateSeaweedRuntimeProfileProof({ ...proof, parallelAttempt: "NOT_ATTEMPTED" },
    { imageId, runId, recipeRevision }), { code: "seaweed_candidate_runtime_failed" });
  assert.throws(() => validateSeaweedRuntimeProfileProof({ ...proof, kind: "SEAWEED_LOCAL_RUNTIME_PROOF_V1" },
    { imageId, runId, recipeRevision }), { code: "seaweed_candidate_runtime_failed" });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeProfile({ ...input(), args: ["--privileged"] },
    { docker: value.docker }), { code: "seaweed_candidate_runtime_failed" });
  if (process.platform !== "linux") await assert.rejects(verifyLocalSeaweedRuntimeProfile(input()),
    { code: "seaweed_candidate_runtime_failed" });
});
