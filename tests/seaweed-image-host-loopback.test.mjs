import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { isPublicSeaweedHostLoopbackPhase, isPublicSeaweedHostLoopbackReason,
  TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof, TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback,
  validateSeaweedRuntimeHostLoopbackProof } from "../scripts/seaweed-image/host-loopback.mjs";

const imageId = `sha256:${"a".repeat(64)}`;
const runId = "35965155302";
const recipeRevision = "b".repeat(40);
const parent = path.resolve("host-loopback-test-parent");
const dockerConfig = path.resolve("host-loopback-test-docker-config");
const exposedPorts = ["18080/tcp", "18888/tcp", "19333/tcp", "7333/tcp", "8080/tcp",
  "8333/tcp", "8888/tcp", "9333/tcp"];

function fixture({ hostIp = "127.0.0.1", hostPort = "49153", createdHostPort = "", extraPort = false,
  publishAllPorts = false, networkMode = "bridge", extraNetwork = false, wrongPortOutput = false,
  unsignedStatus = 403, badSecretStatus = 403, replayStatus = 412, readBody,
  stopExitCode = 0, postStopReachable = false, cleanupForeign = false, driftCommand = false,
  unexpectedMount = false, effectiveTmpfsMounts = false, hostBind = false,
  privileged = false, staleCreatedBinding = false, staleStoppedBinding = false,
  stopTimeout = 30, misleadingHostTimeout = false } = {}) {
  const calls = []; const requests = []; const containerId = "c".repeat(64);
  let state; let nonce; let httpStep = 0; let inspectCount = 0;
  const name = `aw-seaweed-host-loopback-${runId}-attempt-1`;
  const portBindings = () => ({ "8333/tcp": [{ HostIp: hostIp,
    HostPort: createdHostPort }], ...(extraPort
    ? { "9333/tcp": [{ HostIp: "127.0.0.1", HostPort: "49154" }] } : {}) });
  const ports = () => state === "running" || state === "created" && staleCreatedBinding
    || state === "exited" && staleStoppedBinding
    ? Object.fromEntries(exposedPorts.map((key) => [key, key === "8333/tcp"
      ? [{ HostIp: hostIp, HostPort: hostPort }] : null])) : null;
  const inspect = () => [{ Id: cleanupForeign && inspectCount > 2 ? "d".repeat(64) : containerId,
    Image: imageId, State: { Status: state, ExitCode: state === "exited" ? stopExitCode : 0 },
    Mounts: unexpectedMount ? [{ Type: "bind", Source: "/foreign", Destination: "/foreign", RW: true }]
      : effectiveTmpfsMounts ? ["/tmp", "/data", "/run/aw-private"].map((destination) => ({
        Type: "tmpfs", Source: "", Destination: destination, RW: true,
      })) : [],
    Config: { User: "1000:1000", Entrypoint: ["/bin/sh"], StopTimeout: stopTimeout,
      Cmd: driftCommand ? ["-c", "exit 0"] : ["-c", calls.find((args) => args[0] === "container"
        && args[1] === "create")?.at(-1)], Labels: {
      "com.auto-world.runtime-nonce": nonce, "com.auto-world.runtime-purpose": "host-loopback-v1",
    }, ExposedPorts: Object.fromEntries(exposedPorts.map((key) => [key, {}])) },
    HostConfig: { NetworkMode: networkMode, ReadonlyRootfs: true, PublishAllPorts: publishAllPorts,
      Privileged: privileged, Binds: hostBind ? ["/foreign:/private"] : null,
      ...(misleadingHostTimeout ? { StopTimeout: 30 } : {}),
      Memory: 805306368, MemorySwap: 805306368, NanoCpus: 750000000, PidsLimit: 512,
      CapAdd: null, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true"],
      Mounts: unexpectedMount ? [{ Type: "bind", Source: "/foreign", Target: "/foreign" }] : null,
      Tmpfs: { "/tmp": "rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000",
        "/data": "rw,nosuid,nodev,noexec,size=256m,mode=0700,uid=1000,gid=1000",
        "/run/aw-private": "rw,nosuid,nodev,noexec,size=64k,mode=0700,uid=1000,gid=1000" },
      PortBindings: portBindings() }, NetworkSettings: { Networks: { bridge: {},
      ...(extraNetwork ? { hostile: {} } : {}) }, Ports: ports() } }];
  const docker = async (args, options) => {
    calls.push(args); assert.equal(options.cwd, parent); assert.equal(options.env.DOCKER_CONFIG, dockerConfig);
    if (args[0] === "container" && args[1] === "inspect") {
      if (state === undefined) return { status: 1, stdout: "[]\n", stderr: "not found\n" };
      inspectCount += 1; return { status: 0, stdout: JSON.stringify(inspect()), stderr: "" };
    }
    if (args[0] === "container" && args[1] === "ls") {
      return { status: 0, stdout: state === undefined ? "" : `${containerId}|${name}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "create") {
      assert.ok(args.includes("--network=bridge"));
      assert.ok(args.includes("--publish=127.0.0.1::8333/tcp"));
      assert.equal(args.some((value) => /^--publish=.*:(?:[1-9][0-9]*):8333/u.test(value)), false);
      assert.ok(args.includes("--read-only")); assert.ok(args.includes("--user=1000:1000"));
      assert.ok(args.includes("--memory=768m")); assert.ok(args.includes("--memory-swap=768m"));
      assert.ok(args.includes("--cpus=.75")); assert.ok(args.includes("--pids-limit=512"));
      assert.ok(args.includes("--cap-drop=ALL")); assert.ok(args.includes("--security-opt=no-new-privileges=true"));
      assert.ok(args.includes("--stop-timeout=30")); assert.ok(args.includes("--entrypoint=/bin/sh"));
      const labels = args.filter((value, index) => args[index - 1] === "--label");
      nonce = labels.find((value) => value.startsWith("com.auto-world.runtime-nonce="))?.split("=")[1];
      assert.match(nonce, /^[0-9a-f]{48}$/u);
      assert.ok(labels.includes("com.auto-world.runtime-purpose=host-loopback-v1"));
      assert.match(args.at(-1), /s3\.port=8333/u); assert.match(args.at(-1), /s3\.port\.iceberg=0/u);
      state = "created"; return { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "start") {
      state = "running"; return { status: 0, stdout: `${name}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "port") {
      return { status: 0, stdout: wrongPortOutput ? `0.0.0.0:${hostPort}\n` : `${hostIp}:${hostPort}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "stop") {
      assert.deepEqual(args.slice(0, 4), ["container", "stop", "--time", "30"]);
      state = "exited"; return { status: 0, stdout: `${name}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "rm") {
      state = undefined; return { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    throw new Error(`unexpected Docker call: ${args.join(" ")}`);
  };
  const httpRequest = async (request) => {
    requests.push(request);
    if (state === "exited") {
      if (postStopReachable) return { status: 200, body: Buffer.alloc(0) };
      throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    }
    httpStep += 1;
    const expected = [
      { method: "GET", path: "/readyz", status: 200, body: Buffer.alloc(0) },
      { method: "GET", path: "/", status: unsignedStatus, body: Buffer.alloc(0) },
      { method: "PUT", path: "/aw-raw", status: 200, body: Buffer.alloc(0) },
      { method: "PUT", path: "/aw-raw/proof", status: 200, body: Buffer.alloc(0) },
      { method: "GET", path: "/aw-raw/proof", status: 200,
        body: readBody ?? Buffer.from("auto-world-host-loopback-diagnostic-payload-v1") },
      { method: "GET", path: "/aw-raw/proof", status: badSecretStatus, body: Buffer.alloc(0) },
      { method: "PUT", path: "/aw-raw/proof", status: replayStatus, body: Buffer.alloc(0) },
    ][httpStep - 1];
    assert.ok(expected); assert.equal(request.host, "127.0.0.1"); assert.equal(request.port, Number(hostPort));
    assert.equal(request.method, expected.method); assert.equal(request.path, expected.path);
    if (httpStep >= 3) {
      assert.match(request.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AWDIAGNOSTICACCESS\//u);
      assert.equal(request.headers.host, `127.0.0.1:${hostPort}`);
      assert.match(request.headers["x-amz-content-sha256"], /^[0-9a-f]{64}$/u);
    } else assert.equal(request.headers, undefined);
    if ([4, 7].includes(httpStep)) assert.equal(request.headers["if-none-match"], "*");
    return { status: expected.status, body: expected.body };
  };
  return { calls, requests, docker, httpRequest, get state() { return state; } };
}

function input(extra = {}) { return { parent, dockerConfig, imageId, runId, recipeRevision, ...extra }; }

test("host loopback proves exact ephemeral IPv4 binding, signed S3 access, shutdown and cleanup", async () => {
  const value = fixture();
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: value.docker, httpRequest: value.httpRequest });
  assert.deepEqual(proof, TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof({ imageId, runId, recipeRevision }));
  assert.deepEqual(validateSeaweedRuntimeHostLoopbackProof(proof, { imageId, runId, recipeRevision }), proof);
  assert.equal(value.state, undefined); assert.equal(value.requests.length, 8);
  assert.equal(JSON.stringify(proof).includes("49153"), false);
});

test("Docker28 effective tmpfs mount records are accepted without allowing bind or volume mounts", async () => {
  const value = fixture({ effectiveTmpfsMounts: true });
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: value.docker, httpRequest: value.httpRequest });
  assert.equal(proof.kind, "SEAWEED_LOCAL_RUNTIME_HOST_LOOPBACK_PROOF_V1");
  assert.equal(value.state, undefined);
});

for (const [name, options] of [
  ["wildcard IPv4", { hostIp: "0.0.0.0" }], ["wildcard IPv6", { hostIp: "::" }],
  ["fixed requested port", { createdHostPort: "9000" }], ["extra published port", { extraPort: true }],
  ["publish-all", { publishAllPorts: true }], ["extra network", { extraNetwork: true }],
  ["non-bridge network", { networkMode: "host" }], ["docker port disagreement", { wrongPortOutput: true }],
  ["command drift", { driftCommand: true }], ["unexpected bind mount", { unexpectedMount: true }],
  ["unexpected host bind request", { hostBind: true }], ["privileged container", { privileged: true }],
  ["premature published port", { staleCreatedBinding: true }], ["stop timeout drift", { stopTimeout: 0 }],
  ["misplaced host timeout", { stopTimeout: 0, misleadingHostTimeout: true }],
]) {
  test(`${name} is rejected before host HTTP proof and owned resources are cleaned`, async () => {
    const value = fixture(options);
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
      { docker: value.docker, httpRequest: value.httpRequest }),
    { code: "seaweed_candidate_runtime_host_loopback_failed", reason:
      name === "docker port disagreement" ? "BINDING_MISMATCH" : "PROFILE_MISMATCH" });
    assert.equal(value.requests.length, 0); assert.equal(value.state, undefined);
  });
}

test("unsigned success fails closed and does not expose host port in telemetry", async () => {
  const value = fixture({ unsignedStatus: 200 });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: value.docker, httpRequest: value.httpRequest }), (error) => {
    assert.equal(error.code, "seaweed_candidate_runtime_host_loopback_failed");
    assert.equal(error.phase, "HOST_LOOPBACK_HTTP"); assert.equal(error.reason, "ANONYMOUS_ALLOWED");
    assert.equal(JSON.stringify(error).includes("49153"), false); return true;
  });
  assert.equal(value.state, undefined);
});

test("bad-secret success fails closed", async () => {
  const value = fixture({ badSecretStatus: 200 });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: value.docker, httpRequest: value.httpRequest }),
  { code: "seaweed_candidate_runtime_host_loopback_failed", phase: "HOST_LOOPBACK_HTTP",
    reason: "WRONG_CREDENTIAL_ACCEPTED" });
  assert.equal(value.state, undefined);
});

test("readback mismatch and conditional replay acceptance fail closed", async () => {
  const mismatch = fixture({ readBody: Buffer.from("tampered") });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: mismatch.docker, httpRequest: mismatch.httpRequest }),
  { reason: "READBACK_MISMATCH" });
  const replay = fixture({ replayStatus: 200 });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: replay.docker, httpRequest: replay.httpRequest }),
  { reason: "CONDITIONAL_WRITE_UNEXPECTED" });
});

test("reachable host port after bounded stop prevents proof", async () => {
  const value = fixture({ postStopReachable: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: value.docker, httpRequest: value.httpRequest }),
  { phase: "HOST_LOOPBACK_STOP", reason: "PORT_STILL_REACHABLE" });
  assert.equal(value.state, undefined);
});

test("stale published port after stop prevents proof", async () => {
  const value = fixture({ staleStoppedBinding: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: value.docker, httpRequest: value.httpRequest }),
  { phase: "HOST_LOOPBACK_STOP", reason: "OWNERSHIP_UNCERTAIN" });
  assert.equal(value.state, undefined);
});

for (const code of ["ETIMEDOUT", "ABORT_ERR", "EHOSTUNREACH"]) {
  test(`ambiguous post-stop network result ${code} fails closed`, async () => {
    const value = fixture();
    const httpRequest = async (request) => {
      if (value.state === "exited") throw Object.assign(new Error("ambiguous network result"), { code });
      return value.httpRequest(request);
    };
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
      { docker: value.docker, httpRequest }),
    { phase: "HOST_LOOPBACK_STOP", reason: "PORT_UNREACHABLE_UNCERTAIN" });
    assert.equal(value.state, undefined);
  });
}

test("foreign identity during cleanup preserves primary and reports the cleanup failure", async () => {
  const value = fixture({ unsignedStatus: 200, cleanupForeign: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input(),
    { docker: value.docker, httpRequest: value.httpRequest }), (error) => {
    assert.deepEqual({ code: error.code, phase: error.phase, reason: error.reason,
      runtimeCleanupFailure: error.runtimeCleanupFailure }, {
      code: "seaweed_candidate_runtime_host_loopback_failed", phase: "HOST_LOOPBACK_HTTP",
      reason: "ANONYMOUS_ALLOWED", runtimeCleanupFailure: {
        code: "seaweed_candidate_runtime_host_loopback_cleanup_failed",
        phase: "HOST_LOOPBACK_CLEANUP", reason: "CLEANUP_UNCERTAIN",
      },
    }); return true;
  });
  assert.notEqual(value.state, undefined);
});

test("proof validator and public telemetry vocabulary reject mutations", () => {
  const expected = { imageId, runId, recipeRevision };
  const proof = TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof(expected);
  assert.throws(() => validateSeaweedRuntimeHostLoopbackProof({ ...proof, extra: true }, expected),
    { code: "seaweed_candidate_runtime_host_loopback_failed" });
  assert.throws(() => validateSeaweedRuntimeHostLoopbackProof({ ...proof, hostBinding: "0.0.0.0" }, expected),
    { code: "seaweed_candidate_runtime_host_loopback_failed" });
  assert.equal(isPublicSeaweedHostLoopbackPhase("HOST_LOOPBACK_HTTP"), true);
  assert.equal(isPublicSeaweedHostLoopbackPhase("/private/path"), false);
  assert.equal(isPublicSeaweedHostLoopbackReason("BINDING_MISMATCH"), true);
  assert.equal(isPublicSeaweedHostLoopbackReason("127.0.0.1:49153"), false);
});
