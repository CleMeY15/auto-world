import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_expectedSeaweedRuntimePersistenceProof, TEST_ONLY_signedSeaweedS3ProbeScript,
  TEST_ONLY_verifyLocalSeaweedRuntimeProfile, TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence,
  validateSeaweedRuntimePersistenceProof, validateSeaweedRuntimeProfileProof,
  verifyLocalSeaweedRuntimeProfile, verifyLocalSeaweedRuntimeRestartPersistence } from
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

function persistenceFixture({ preexistingVolume = false, secondStatus = 0, malformedFirstCreate = false,
  foreignVolumeAfterCreate = false, foreignSecondAfterCreate = false, driftServiceProfile = false } = {}) {
  const calls = []; const states = new Map(); const ids = new Map(); const inspectCounts = new Map();
  let volumeExists = preexistingVolume; let nonce = ""; let volumeInspections = 0;
  const volumeCreatedAt = new Date().toISOString();
  const prefix = `aw-seaweed-persistence-${runId}`;
  const volumeName = `${prefix}-data`;
  const docker = async (args, options) => {
    calls.push(args);
    assert.equal(options.cwd, parent); assert.equal(options.env.DOCKER_CONFIG, dockerConfig);
    if (args[0] === "volume" && args[1] === "inspect") {
      if (!volumeExists) return { status: 1, stdout: "", stderr: "not found\n" };
      volumeInspections += 1;
      const observedNonce = foreignVolumeAfterCreate && volumeInspections > 1 ? "f".repeat(48) : nonce;
      return { status: 0,
        stdout: `${volumeName}|local|local|${volumeCreatedAt}|${observedNonce}|restart-persistence-v1\n`, stderr: "" };
    }
    if (args[0] === "volume" && args[1] === "ls") {
      return { status: 0, stdout: volumeExists ? `${volumeName}\n` : "", stderr: "" };
    }
    if (args[0] === "volume" && args[1] === "create") {
      assert.deepEqual(args.slice(0, 4), ["volume", "create", "--driver", "local"]);
      assert.equal(args.at(-1), volumeName); assert.equal(args.includes("--force"), false);
      nonce = args[args.indexOf("--label") + 1].split("=")[1];
      assert.match(nonce, /^[0-9a-f]{48}$/u); volumeExists = true;
      return { status: 0, stdout: `${volumeName}\n`, stderr: "" };
    }
    if (args[0] === "volume" && args[1] === "rm") {
      assert.deepEqual(args, ["volume", "rm", volumeName]); volumeExists = false;
      return { status: 0, stdout: `${volumeName}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const name = args.at(-1); const state = states.get(name);
      if (state === undefined) return { status: 1, stdout: "", stderr: "not found\n" };
      const count = (inspectCounts.get(name) ?? 0) + 1; inspectCounts.set(name, count);
      if (!args[3].includes("HostConfig.Mounts")) {
        return { status: 0, stdout: `${ids.get(name)}|${state}|0|${nonce}|${imageId}\n`, stderr: "" };
      }
      const observedNonce = foreignSecondAfterCreate && name.endsWith("service-2") && count > 1
        ? "e".repeat(48) : nonce;
      const role = name.slice(prefix.length + 1); const init = role === "init";
      const user = driftServiceProfile && role === "service-1" && count === 1 ? "0:0"
        : init ? "0:0" : "1000:1000";
      const capAdd = init ? '["CHOWN"]' : "null";
      return { status: 0,
        stdout: `${ids.get(name)}|${state}|0|${observedNonce}|restart-persistence-v1|${imageId}|volume|${volumeName}|/data|true|true|${user}|${capAdd}|["ALL"]|true|["no-new-privileges:true"]\n`,
        stderr: "" };
    }
    if (args[0] === "container" && args[1] === "ls") {
      const match = args[args.indexOf("--filter") + 1].match(/name=\^\/(.+)\$$/u);
      const name = match?.[1]; return { status: 0, stdout: states.has(name) ? `${ids.get(name)}|${name}\n` : "", stderr: "" };
    }
    if (args[0] === "container" && args[1] === "create") {
      const name = args[args.indexOf("--name") + 1]; const role = name.slice(prefix.length + 1);
      const id = role === "init" ? "1".repeat(64) : role === "service-1" ? "2".repeat(64) : "3".repeat(64);
      assert.ok(args.includes("--network=none")); assert.ok(args.includes("--read-only"));
      assert.ok(args.includes("--mount"));
      assert.ok(args.includes(`type=volume,src=${volumeName},dst=/data,volume-nocopy`));
      assert.equal(args.includes("--publish"), false); assert.equal(args.includes("--privileged"), false);
      if (role === "init") {
        assert.ok(args.includes("--user=0:0")); assert.ok(args.includes("--cap-drop=ALL"));
        assert.ok(args.includes("--cap-add=CHOWN")); assert.equal(args.some((value) => value.startsWith?.("--cap-add=")
          && value !== "--cap-add=CHOWN"), false);
        assert.match(args.at(-1), /entries=\$\(find \/data -mindepth 1 -maxdepth 1 -print\) \|\| exit 1/u);
        assert.match(args.at(-1), /test -z "\$entries"/u); assert.match(args.at(-1), /chmod 0700 \/data/u);
        assert.match(args.at(-1), /chown 1000:1000 \/data/u);
      } else {
        assert.ok(args.includes("--user=1000:1000")); assert.ok(args.includes("--cap-drop=ALL"));
        assert.equal(args.some((value) => value.startsWith?.("--cap-add")), false);
      }
      ids.set(name, id); states.set(name, "created");
      if (malformedFirstCreate && role === "service-1") return { status: 0, stdout: "lost\n", stderr: "" };
      return { status: 0, stdout: `${id}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "start") {
      states.set(args[2], "running"); return { status: 0, stdout: `${args[2]}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "wait") {
      states.set(args[2], "exited"); return { status: 0, stdout: "0\n", stderr: "" };
    }
    if (args[0] === "container" && args[1] === "exec") {
      if (args.at(-1).includes("SEAWEED_PERSISTENCE_FIRST_WRITE_VERIFIED")) {
        assert.ok(args.at(-1).includes("awk '/^Uid:/ {print $2}' /proc/1/status"));
        assert.ok(args.at(-1).includes("awk '/^Gid:/ {print $2}' /proc/1/status"));
        assert.match(args.at(-1), /stat -c '%u:%g:%a' \/data/u);
        assert.match(args.at(-1), /test -w \/data/u);
        assert.match(args.at(-1), /http:\/\/127\.0\.0\.1:8888\/readyz/u);
        assert.match(args.at(-1), /test "\$bucket" = 200 \|\| exit 63/u);
        return { status: 0, stdout: "SEAWEED_PERSISTENCE_FIRST_WRITE_VERIFIED\n", stderr: "" };
      }
      assert.match(args.at(-1), /case "\$read_status" in 200\) ;; 404\) exit 65 ;; \*\) exit 69 ;; esac/u);
      return secondStatus === 0
        ? { status: 0, stdout: "SEAWEED_PERSISTENCE_SECOND_READ_VERIFIED\n", stderr: "" }
        : { status: secondStatus, stdout: "", stderr: "" };
    }
    if (args[0] === "container" && args[1] === "stop") {
      states.set(args.at(-1), "exited"); return { status: 0, stdout: `${args.at(-1)}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "rm") {
      assert.equal(args.length, 3); states.delete(args[2]); return { status: 0, stdout: `${args[2]}\n`, stderr: "" };
    }
    throw new Error(`unexpected Docker call: ${args.join(" ")}`);
  };
  return { calls, docker, get volumeExists() { return volumeExists; }, states, volumeName };
}

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

test("restart persistence uses a fresh owned nocopy volume across two distinct bounded services", async () => {
  const value = persistenceFixture();
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input(), { docker: value.docker });
  assert.deepEqual(validateSeaweedRuntimePersistenceProof(proof, { imageId, runId, recipeRevision }), proof);
  assert.deepEqual(proof, TEST_ONLY_expectedSeaweedRuntimePersistenceProof({ imageId, runId, recipeRevision }));
  assert.equal(proof.kind, "SEAWEED_LOCAL_RUNTIME_PERSISTENCE_PROOF_V1");
  assert.equal(proof.authority, "DIAGNOSTIC_ONLY"); assert.equal(proof.candidateAuthorization, "NOT_AUTHORIZED");
  assert.equal(proof.profileSha256, "22c4449e4307d819f8fde9fbb1c2dbf3d583b5fb066bc89153e1b4c1b3e70024");
  assert.equal(proof.commandSha256, "46c49d31919ce9920f75dd9b641cfd310a5e7202f06671f21ffa1ea4d1805474");
  assert.equal(proof.initializer, "ROOT_CAP_CHOWN_EMPTY_CHMOD_CHOWN_UID1000");
  assert.equal(proof.objectPersistence, "PRESERVED_ACROSS_RESTART");
  assert.equal(proof.cleanup, "OWNED_CONTAINERS_AND_VOLUME_REMOVED");
  assert.equal(value.volumeExists, false); assert.equal(value.states.size, 0);
  const firstRemoval = value.calls.findIndex((args) => args[0] === "container" && args[1] === "rm"
    && args[2].endsWith("service-1"));
  const secondCreate = value.calls.findIndex((args) => args[0] === "container" && args[1] === "create"
    && args[args.indexOf("--name") + 1].endsWith("service-2"));
  const volumeRemoval = value.calls.findIndex((args) => args[0] === "volume" && args[1] === "rm");
  const secondRemoval = value.calls.findIndex((args) => args[0] === "container" && args[1] === "rm"
    && args[2].endsWith("service-2"));
  assert.ok(firstRemoval < secondCreate); assert.ok(secondRemoval < volumeRemoval);
});

test("a pre-existing persistence volume fails closed without creating or removing resources", async () => {
  const value = persistenceFixture({ preexistingVolume: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_persistence_failed", phase: "PERSISTENCE_PRECHECK",
      reason: "VOLUME_NAME_OCCUPIED" });
  assert.equal(value.calls.some((args) => args[1] === "create" || args[1] === "rm"), false);
});

for (const [status, reason] of [[65, "PERSISTED_OBJECT_MISSING"], [66, "PERSISTED_OBJECT_MISMATCH"]]) {
  test(`second service status ${status} reports ${reason} and cleans every owned resource`, async () => {
    const value = persistenceFixture({ secondStatus: status });
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input(), { docker: value.docker }),
      { code: "seaweed_candidate_runtime_persistence_failed", phase: "PERSISTENCE_SERVICE_TWO", reason });
    assert.equal(value.volumeExists, false); assert.equal(value.states.size, 0);
  });
}

test("second service transport and non-404 HTTP failures are not reported as a missing object", async () => {
  const value = persistenceFixture({ secondStatus: 69 });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_persistence_failed", phase: "PERSISTENCE_SERVICE_TWO",
      reason: "SECOND_READ_FAILED" });
  assert.equal(value.volumeExists, false); assert.equal(value.states.size, 0);
});

test("a lost create response recovers the exactly owned container before complete cleanup", async () => {
  const value = persistenceFixture({ malformedFirstCreate: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_persistence_failed", phase: "PERSISTENCE_SERVICE_ONE",
      reason: "CONTAINER_CREATE_INVALID" });
  assert.equal(value.volumeExists, false); assert.equal(value.states.size, 0);
  assert.ok(value.calls.some((args) => args[0] === "container" && args[1] === "rm"
    && args[2].endsWith("service-1")));
});

test("an inspected service privilege drift blocks execution but its strongly owned container is cleaned", async () => {
  const value = persistenceFixture({ driftServiceProfile: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_persistence_failed", phase: "PERSISTENCE_SERVICE_ONE",
      reason: "CONTAINER_IDENTITY_UNCERTAIN" });
  assert.equal(value.volumeExists, false); assert.equal(value.states.size, 0);
  assert.equal(value.calls.some((args) => args[0] === "container" && args[1] === "start"
    && args[2].endsWith("service-1")), false);
});

test("volume ownership drift blocks cleanup and never removes the foreign volume", async () => {
  const value = persistenceFixture({ secondStatus: 65, foreignVolumeAfterCreate: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_persistence_cleanup_failed", phase: "PERSISTENCE_CLEANUP",
      reason: "CLEANUP_UNCERTAIN" });
  assert.equal(value.volumeExists, true);
  assert.equal(value.calls.some((args) => args[0] === "volume" && args[1] === "rm"), false);
});

test("container ownership drift blocks cleanup and never removes the foreign container", async () => {
  const value = persistenceFixture({ secondStatus: 65, foreignSecondAfterCreate: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_persistence_cleanup_failed", phase: "PERSISTENCE_CLEANUP",
      reason: "CLEANUP_UNCERTAIN" });
  assert.equal(value.calls.some((args) => args[0] === "container" && args[1] === "rm"
    && args[2].endsWith("service-2")), false);
  assert.equal(value.calls.some((args) => args[0] === "volume" && args[1] === "rm"), false);
});

test("persistence proof and input validators reject mutation and platform misuse", async () => {
  const proof = TEST_ONLY_expectedSeaweedRuntimePersistenceProof({ imageId, runId, recipeRevision });
  assert.throws(() => validateSeaweedRuntimePersistenceProof({ ...proof, cleanup: "NOT_ATTEMPTED" },
    { imageId, runId, recipeRevision }), { code: "seaweed_candidate_runtime_persistence_failed" });
  assert.throws(() => validateSeaweedRuntimePersistenceProof({ ...proof, extra: true },
    { imageId, runId, recipeRevision }), { code: "seaweed_candidate_runtime_persistence_failed" });
  const value = persistenceFixture();
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence({ ...input(), privileged: true },
    { docker: value.docker }), { code: "seaweed_candidate_runtime_persistence_failed" });
  if (process.platform !== "linux") await assert.rejects(verifyLocalSeaweedRuntimeRestartPersistence(input()),
    { code: "seaweed_candidate_runtime_persistence_failed" });
});
