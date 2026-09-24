import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const MAX_OUTPUT_BYTES = 1024 ** 2;
const COMMAND_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;
const OWNERSHIP_LABEL = "com.auto-world.runtime-nonce";
const PURPOSE_LABEL = "com.auto-world.runtime-purpose";
const PURPOSE = "host-loopback-v1";
const ACCESS_KEY = "AWDIAGNOSTICACCESS";
const SECRET_KEY = "aw-diagnostic-secret-not-for-production-0001";
const BAD_SECRET_KEY = "aw-diagnostic-intentionally-incorrect-key";
const PAYLOAD = "auto-world-host-loopback-diagnostic-payload-v1";
const PAYLOAD_SHA256 = createHash("sha256").update(PAYLOAD).digest("hex");
const BASE_CONFIG = JSON.parse(readFileSync(new URL("../../infra/seaweed-image/base-config.json", import.meta.url),
  "utf8"));
const EXPOSED_PORTS = Object.freeze(Object.keys(BASE_CONFIG.config.ExposedPorts).sort());
const PHASES = new Set(["HOST_LOOPBACK_CONTEXT", "HOST_LOOPBACK_PRECHECK", "HOST_LOOPBACK_CREATE",
  "HOST_LOOPBACK_START", "HOST_LOOPBACK_BINDING", "HOST_LOOPBACK_HTTP", "HOST_LOOPBACK_STOP",
  "HOST_LOOPBACK_CLEANUP"]);
const REASONS = new Set(["INPUT_INVALID", "DOCKER_COMMAND", "NAME_OCCUPIED", "CREATE_ID_INVALID",
  "OWNERSHIP_UNCERTAIN", "PROFILE_MISMATCH", "BINDING_MISMATCH", "READINESS_UNAVAILABLE",
  "ANONYMOUS_ALLOWED", "ANONYMOUS_UNEXPECTED_STATUS", "SIGNED_TRANSPORT_FAILURE",
  "ALLOWED_SCOPE_DENIED", "ALLOWED_SCOPE_UNEXPECTED_STATUS", "READ_UNEXPECTED_STATUS",
  "READBACK_MISMATCH", "WRONG_CREDENTIAL_ACCEPTED", "WRONG_CREDENTIAL_UNEXPECTED_STATUS",
  "CONDITIONAL_WRITE_UNEXPECTED", "STOP_FAILED", "EXIT_UNEXPECTED", "PORT_STILL_REACHABLE",
  "PORT_UNREACHABLE_UNCERTAIN", "CLEANUP_UNCERTAIN"]);

const RUNTIME_CONFIG = JSON.stringify({ identities: [{ name: "auto-world-diagnostic", credentials: [{
  accessKey: ACCESS_KEY, secretKey: SECRET_KEY,
}], actions: ["Admin:aw-raw", "Read:aw-raw", "List:aw-raw", "Write:aw-raw"] }] });
const SERVER_COMMAND = ["server", "-dir=/data", "-master.telemetry=false", "-s3", "-s3.port=8333",
  "-s3.port.iceberg=0", "-s3.port.lance=0", "-s3.config=/run/aw-private/s3.json"];
const BOOTSTRAP = `set -eu
umask 077
printf '%s\\n' '${RUNTIME_CONFIG}' > /run/aw-private/s3.json
test "$(stat -c '%u:%g:%a' /run/aw-private/s3.json)" = '1000:1000:600'
exec /entrypoint.sh ${SERVER_COMMAND.map((value) => `'${value}'`).join(" ")}`;
const CREATE_PROFILE = ["--pull=never", "--network=bridge", "--publish=127.0.0.1::8333/tcp", "--read-only",
  "--user=1000:1000", "--memory=768m", "--memory-swap=768m", "--cpus=.75", "--pids-limit=512",
  "--cap-drop=ALL", "--security-opt=no-new-privileges=true", "--stop-timeout=30",
  "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000",
  "--tmpfs", "/data:rw,nosuid,nodev,noexec,size=256m,mode=0700,uid=1000,gid=1000",
  "--tmpfs", "/run/aw-private:rw,nosuid,nodev,noexec,size=64k,mode=0700,uid=1000,gid=1000",
  "--entrypoint=/bin/sh"];
const PROFILE_SHA256 = hash(CREATE_PROFILE);
const COMMAND_SHA256 = hash(["--entrypoint=/bin/sh", "-c", BOOTSTRAP]);
const PROOF_KEYS = ["kind", "state", "authority", "candidateAuthorization", "imageId", "runId",
  "recipeRevision", "profileSha256", "commandSha256", "networkMode", "hostBinding", "readiness",
  "anonymousAccess", "authenticatedAccess", "credentialEnforcement", "conditionalWrites", "shutdown",
  "cleanup"];

function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function hmac(key, value, encoding) { return createHmac("sha256", key).update(value).digest(encoding); }
function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}
function failure(code) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED" });
}
function diagnosticFailure(code, phase, reason, started) {
  const error = failure(code); error.phase = phase; error.reason = reason;
  error.durationMs = Math.min(10_800_000, Math.max(0, Math.floor(performance.now() - started)));
  return error;
}

export function isPublicSeaweedHostLoopbackPhase(value) { return PHASES.has(value); }
export function isPublicSeaweedHostLoopbackReason(value) { return REASONS.has(value); }

async function capture(stream, kill) {
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) throw failure("seaweed_candidate_runtime_host_loopback_failed");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (error) { kill(); throw error; }
}

async function defaultDocker(args, { cwd, env, signal, timeoutMs = COMMAND_TIMEOUT_MS }) {
  const child = spawn("docker", args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let timedOut = false;
  const kill = () => { if (!child.killed) child.kill("SIGKILL"); };
  const timer = globalThis.setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
  const abort = () => kill(); signal?.addEventListener("abort", abort, { once: true });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", (status, exitSignal) => resolve({ status, exitSignal }));
  });
  const results = await Promise.allSettled([exit, capture(child.stdout, kill), capture(child.stderr, kill)]);
  globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort);
  if (timedOut || signal?.aborted || results.some((result) => result.status === "rejected")) {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  return { ...results[0].value, stdout: results[1].value, stderr: results[2].value };
}

async function command(docker, args, options, statuses = [0]) {
  if (options.signal?.aborted) throw failure("seaweed_candidate_runtime_host_loopback_failed");
  const result = await docker(args, options);
  if (!statuses.includes(result?.status) || typeof result.stdout !== "string" || typeof result.stderr !== "string"
    || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MAX_OUTPUT_BYTES) {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  return result;
}

function parseInspect(result, code) {
  if (result.status !== 0) throw failure(code);
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw failure(code); }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null || typeof parsed[0] !== "object") {
    throw failure(code);
  }
  return parsed[0];
}

async function inspectContainer(docker, name, options, statuses = [0]) {
  return command(docker, ["container", "inspect", name], options, statuses);
}

async function containerAbsent(docker, name, options) {
  const inspected = await inspectContainer(docker, name, options, [0, 1]);
  if (inspected.status !== 1 || !["", "[]"].includes(inspected.stdout.trim())) return false;
  const listed = await command(docker, ["container", "ls", "--all", "--no-trunc", "--filter",
    `name=^/${name}$`, "--format", "{{.ID}}|{{.Names}}"], options);
  return listed.stderr.trim() === "" && listed.stdout.trim() === "";
}

function sameKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function sameArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function sameTmpfs(value) {
  const expected = {
    "/tmp": "rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000",
    "/data": "rw,nosuid,nodev,noexec,size=256m,mode=0700,uid=1000,gid=1000",
    "/run/aw-private": "rw,nosuid,nodev,noexec,size=64k,mode=0700,uid=1000,gid=1000",
  };
  return sameKeys(value, Object.keys(expected)) && Object.entries(expected).every(([key, options]) =>
    typeof value[key] === "string" && value[key].split(",").sort().join("|") === options.split(",").sort().join("|"));
}

function validEffectiveMounts(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  const expected = ["/data", "/run/aw-private", "/tmp"];
  return value.length === expected.length
    && value.every((mount) => mount !== null && typeof mount === "object" && mount.Type === "tmpfs"
      && expected.includes(mount.Destination) && mount.RW === true)
    && value.map((mount) => mount.Destination).sort().join("|") === expected.join("|");
}

function inspectOwned(value, expected, stage) {
  const state = value.State; const config = value.Config; const host = value.HostConfig; const network = value.NetworkSettings;
  const capAdd = host?.CapAdd ?? [];
  const capDrop = host?.CapDrop ?? [];
  const securityOpt = host?.SecurityOpt ?? [];
  const hostMounts = host?.Mounts ?? [];
  const hostBinds = host?.Binds ?? [];
  if (!CONTAINER_ID.test(value.Id) || value.Id !== expected.id || value.Image !== expected.imageId
    || config?.Labels?.[OWNERSHIP_LABEL] !== expected.nonce || config.Labels?.[PURPOSE_LABEL] !== PURPOSE
    || !["created", "running", "exited"].includes(state?.Status) || !Number.isInteger(state.ExitCode)
    || config.User !== "1000:1000" || !sameArray(config.Entrypoint, ["/bin/sh"])
    || !sameArray(config.Cmd, ["-c", BOOTSTRAP]) || !sameKeys(config.ExposedPorts, EXPOSED_PORTS)
    || host.NetworkMode !== "bridge" || host.ReadonlyRootfs !== true || host.PublishAllPorts !== false
    || host.Privileged !== false
    || host.Memory !== 805_306_368 || host.MemorySwap !== 805_306_368 || host.NanoCpus !== 750_000_000
    || host.PidsLimit !== 512 || capAdd.length !== 0 || capDrop.length !== 1 || capDrop[0] !== "ALL"
    || securityOpt.length !== 1 || securityOpt[0] !== "no-new-privileges=true" || host.StopTimeout !== 30
    || !validEffectiveMounts(value.Mounts)
    || !Array.isArray(hostMounts) || hostMounts.length !== 0
    || !Array.isArray(hostBinds) || hostBinds.length !== 0
    || !sameTmpfs(host.Tmpfs) || !sameKeys(host.PortBindings, ["8333/tcp"])
    || !Array.isArray(host.PortBindings["8333/tcp"]) || host.PortBindings["8333/tcp"].length !== 1
    || host.PortBindings["8333/tcp"][0]?.HostIp !== "127.0.0.1"
    || !sameKeys(network?.Networks, ["bridge"])) {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  if (stage !== "running") {
    if (!["created", "stopped"].includes(stage)
      || host.PortBindings["8333/tcp"][0]?.HostPort !== ""
      || network.Ports !== null && !sameKeys(network.Ports, [])) {
      throw failure("seaweed_candidate_runtime_host_loopback_failed");
    }
    return undefined;
  }
  if (!sameKeys(network.Ports, EXPOSED_PORTS)) {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  const binding = network.Ports["8333/tcp"];
  for (const exposed of EXPOSED_PORTS.filter((entry) => entry !== "8333/tcp")) {
    if (network.Ports[exposed] !== null) throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  if (!Array.isArray(binding) || binding.length !== 1 || binding[0]?.HostIp !== "127.0.0.1"
    || !/^[1-9][0-9]{0,4}$/u.test(binding[0]?.HostPort ?? "")) {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  const port = Number(binding[0].HostPort);
  if (port > 65_535 || host.PortBindings["8333/tcp"][0]?.HostPort !== "") {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  return port;
}

function defaultHttpRequest({ host, port, method, path: requestPath, headers = {}, body, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (value) => { if (!settled) { settled = true; resolve(value); } };
    const fail = (error) => { if (!settled) { settled = true; reject(error); } };
    const request = http.request({ host, port, method, path: requestPath, headers, timeout: timeoutMs, signal },
      (response) => {
        const chunks = []; let bytes = 0;
        response.once("error", fail);
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_OUTPUT_BYTES) response.destroy(failure("seaweed_candidate_runtime_host_loopback_failed"));
          else chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => succeed({ status: response.statusCode, body: Buffer.concat(chunks) }));
      });
    request.once("timeout", () => request.destroy(Object.assign(new Error("request timeout"), { code: "ETIMEDOUT" })));
    request.once("error", fail);
    if (body !== undefined) request.end(body); else request.end();
  });
}

function signedRequest({ port, method, requestPath, body = Buffer.alloc(0), secretKey = SECRET_KEY,
  extraHeaders = {}, signal }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const date = amzDate.slice(0, 8); const host = `127.0.0.1:${port}`; const payloadHash = sha256(body);
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate, ...extraHeaders };
  const signedHeaderNames = Object.keys(headers).map((key) => key.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames.map((key) => `${key}:${String(headers[key]).trim()}\n`).join("");
  const canonicalRequest = [method, requestPath, "", canonicalHeaders, signedHeaderNames.join(";"), payloadHash].join("\n");
  const scope = `${date}/us-east-1/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${secretKey}`, date); const regionKey = hmac(dateKey, "us-east-1");
  const serviceKey = hmac(regionKey, "s3"); const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
  return { host: "127.0.0.1", port, method, path: requestPath, headers, body, timeoutMs: HTTP_TIMEOUT_MS, signal };
}

async function requestStatus(httpRequest, request) {
  const response = await httpRequest(request);
  if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599
    || !Buffer.isBuffer(response.body)) {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  return response;
}

async function waitReady(httpRequest, port, signal) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await httpRequest({ host: "127.0.0.1", port, method: "GET", path: "/readyz",
        timeoutMs: 2_000, signal });
      if (response?.status === 200 && Buffer.isBuffer(response.body)) return;
    } catch (error) { if (signal?.aborted) throw error; }
    if (attempt < 59) await new Promise((resolve) => globalThis.setTimeout(resolve, 1_000));
  }
  throw failure("seaweed_candidate_runtime_host_loopback_failed");
}

function expectedProof({ imageId, runId, recipeRevision }) {
  return Object.freeze({ kind: "SEAWEED_LOCAL_RUNTIME_HOST_LOOPBACK_PROOF_V1", state: "VERIFIED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED", imageId, runId,
    recipeRevision, profileSha256: PROFILE_SHA256, commandSha256: COMMAND_SHA256,
    networkMode: "BRIDGE_ONLY", hostBinding: "127.0.0.1_EPHEMERAL_TO_8333_TCP",
    readiness: "HOST_READYZ_200", anonymousAccess: "HOST_UNSIGNED_REFUSED_403",
    authenticatedAccess: "HOST_SIGNED_CREATE_PUT_GET_SHA256",
    credentialEnforcement: "HOST_BAD_SECRET_REFUSED_403", conditionalWrites: "HOST_REPLAY_REFUSED_412",
    shutdown: "BOUNDED_PORT_UNREACHABLE", cleanup: "OWNED_CONTAINER_REMOVED" });
}

export function validateSeaweedRuntimeHostLoopbackProof(proof, expected) {
  if (!exactObject(expected, ["imageId", "runId", "recipeRevision"]) || !IMAGE_ID.test(expected.imageId)
    || !RUN_ID.test(expected.runId) || !REVISION.test(expected.recipeRevision) || !exactObject(proof, PROOF_KEYS)) {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  const canonical = expectedProof(expected);
  for (const key of PROOF_KEYS) if (proof[key] !== canonical[key]) {
    throw failure("seaweed_candidate_runtime_host_loopback_failed");
  }
  return canonical;
}

function validInput(input) {
  return exactObject(input, ["parent", "dockerConfig", "imageId", "runId", "recipeRevision"])
    || exactObject(input, ["parent", "dockerConfig", "imageId", "runId", "recipeRevision", "signal"]);
}

async function execute(input, injected) {
  const started = performance.now();
  if (!validInput(input)) throw diagnosticFailure("seaweed_candidate_runtime_host_loopback_failed",
    "HOST_LOOPBACK_CONTEXT", "INPUT_INVALID", started);
  const { parent, dockerConfig, imageId, runId, recipeRevision, signal } = input;
  if (process.platform !== "linux" && injected === undefined || typeof parent !== "string" || !path.isAbsolute(parent)
    || path.normalize(parent) !== parent || typeof dockerConfig !== "string" || !path.isAbsolute(dockerConfig)
    || path.normalize(dockerConfig) !== dockerConfig || !IMAGE_ID.test(imageId) || !RUN_ID.test(runId)
    || !REVISION.test(recipeRevision) || signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || signal?.aborted) throw diagnosticFailure("seaweed_candidate_runtime_host_loopback_failed",
    "HOST_LOOPBACK_CONTEXT", "INPUT_INVALID", started);
  const docker = injected?.docker ?? defaultDocker; const httpRequest = injected?.httpRequest ?? defaultHttpRequest;
  if (typeof docker !== "function" || typeof httpRequest !== "function"
    || injected !== undefined && !exactObject(injected, ["docker", "httpRequest"])) {
    throw diagnosticFailure("seaweed_candidate_runtime_host_loopback_failed",
      "HOST_LOOPBACK_CONTEXT", "INPUT_INVALID", started);
  }
  const name = `aw-seaweed-host-loopback-${runId}-attempt-1`;
  const env = { PATH: process.env.PATH ?? "", DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: "unix:///var/run/docker.sock", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TMPDIR: parent };
  const options = { cwd: parent, env, signal, timeoutMs: COMMAND_TIMEOUT_MS };
  const cleanupOptions = { cwd: parent, env, timeoutMs: CLEANUP_TIMEOUT_MS };
  const nonce = randomBytes(24).toString("hex");
  let ownedId; let createAttempted = false; let port; let primaryFailure; let proof;
  let phase = "HOST_LOOPBACK_PRECHECK"; let reason = "DOCKER_COMMAND";
  try {
    if (!await containerAbsent(docker, name, options)) { reason = "NAME_OCCUPIED"; throw failure("seaweed_candidate_runtime_host_loopback_failed"); }
    phase = "HOST_LOOPBACK_CREATE"; createAttempted = true;
    const created = await command(docker, ["container", "create", "--name", name, "--label",
      `${OWNERSHIP_LABEL}=${nonce}`, "--label", `${PURPOSE_LABEL}=${PURPOSE}`, ...CREATE_PROFILE, imageId,
      "-c", BOOTSTRAP], options);
    const returnedId = created.stdout.trim();
    if (!CONTAINER_ID.test(returnedId)) { reason = "CREATE_ID_INVALID"; throw failure("seaweed_candidate_runtime_host_loopback_failed"); }
    ownedId = returnedId; reason = "PROFILE_MISMATCH";
    const createdValue = parseInspect(await inspectContainer(docker, name, options), "seaweed_candidate_runtime_host_loopback_failed");
    inspectOwned(createdValue, { id: ownedId, nonce, imageId }, "created");
    if (createdValue.State.Status !== "created" || createdValue.State.ExitCode !== 0) throw failure("seaweed_candidate_runtime_host_loopback_failed");
    phase = "HOST_LOOPBACK_START"; reason = "DOCKER_COMMAND";
    await command(docker, ["container", "start", name], options);
    phase = "HOST_LOOPBACK_BINDING"; reason = "BINDING_MISMATCH";
    const runningValue = parseInspect(await inspectContainer(docker, name, options), "seaweed_candidate_runtime_host_loopback_failed");
    port = inspectOwned(runningValue, { id: ownedId, nonce, imageId }, "running");
    if (runningValue.State.Status !== "running" || runningValue.State.ExitCode !== 0) throw failure("seaweed_candidate_runtime_host_loopback_failed");
    const portResult = await command(docker, ["container", "port", name, "8333/tcp"], options);
    if (portResult.stderr.trim() !== "" || portResult.stdout.trim() !== `127.0.0.1:${port}`) throw failure("seaweed_candidate_runtime_host_loopback_failed");
    phase = "HOST_LOOPBACK_HTTP"; reason = "READINESS_UNAVAILABLE";
    await waitReady(httpRequest, port, signal);
    reason = "ANONYMOUS_UNEXPECTED_STATUS";
    const anonymous = await requestStatus(httpRequest, { host: "127.0.0.1", port, method: "GET", path: "/",
      timeoutMs: HTTP_TIMEOUT_MS, signal });
    if (anonymous.status !== 403) { reason = anonymous.status >= 200 && anonymous.status < 300 ? "ANONYMOUS_ALLOWED" : reason; throw failure("seaweed_candidate_runtime_host_loopback_failed"); }
    reason = "ALLOWED_SCOPE_UNEXPECTED_STATUS";
    const bucket = await requestStatus(httpRequest, signedRequest({ port, method: "PUT", requestPath: "/aw-raw", signal }));
    if (bucket.status !== 200) { reason = bucket.status === 401 || bucket.status === 403 ? "ALLOWED_SCOPE_DENIED" : reason; throw failure("seaweed_candidate_runtime_host_loopback_failed"); }
    const payload = Buffer.from(PAYLOAD);
    const put = await requestStatus(httpRequest, signedRequest({ port, method: "PUT", requestPath: "/aw-raw/proof",
      body: payload, extraHeaders: { "if-none-match": "*" }, signal }));
    if (put.status !== 200) { reason = put.status === 401 || put.status === 403 ? "ALLOWED_SCOPE_DENIED" : reason; throw failure("seaweed_candidate_runtime_host_loopback_failed"); }
    reason = "READ_UNEXPECTED_STATUS";
    const get = await requestStatus(httpRequest, signedRequest({ port, method: "GET", requestPath: "/aw-raw/proof", signal }));
    if (get.status !== 200) throw failure("seaweed_candidate_runtime_host_loopback_failed");
    if (sha256(get.body) !== PAYLOAD_SHA256) { reason = "READBACK_MISMATCH"; throw failure("seaweed_candidate_runtime_host_loopback_failed"); }
    reason = "WRONG_CREDENTIAL_UNEXPECTED_STATUS";
    const wrong = await requestStatus(httpRequest, signedRequest({ port, method: "GET", requestPath: "/aw-raw/proof",
      secretKey: BAD_SECRET_KEY, signal }));
    if (wrong.status !== 403) { reason = wrong.status >= 200 && wrong.status < 300 ? "WRONG_CREDENTIAL_ACCEPTED" : reason; throw failure("seaweed_candidate_runtime_host_loopback_failed"); }
    reason = "CONDITIONAL_WRITE_UNEXPECTED";
    const replay = await requestStatus(httpRequest, signedRequest({ port, method: "PUT", requestPath: "/aw-raw/proof",
      body: payload, extraHeaders: { "if-none-match": "*" }, signal }));
    if (replay.status !== 412) throw failure("seaweed_candidate_runtime_host_loopback_failed");
    phase = "HOST_LOOPBACK_STOP"; reason = "STOP_FAILED";
    await command(docker, ["container", "stop", "--time", "30", name], { ...options, timeoutMs: 40_000 });
    reason = "OWNERSHIP_UNCERTAIN";
    const stoppedValue = parseInspect(await inspectContainer(docker, name, options), "seaweed_candidate_runtime_host_loopback_failed");
    inspectOwned(stoppedValue, { id: ownedId, nonce, imageId }, "stopped");
    if (stoppedValue.State.Status !== "exited" || stoppedValue.State.ExitCode !== 0) { reason = "EXIT_UNEXPECTED"; throw failure("seaweed_candidate_runtime_host_loopback_failed"); }
    reason = "PORT_STILL_REACHABLE";
    try {
      await httpRequest({ host: "127.0.0.1", port, method: "GET", path: "/readyz", timeoutMs: 2_000, signal });
      throw failure("seaweed_candidate_runtime_host_loopback_failed");
    } catch (error) {
      if (error?.code === "seaweed_candidate_runtime_host_loopback_failed") throw error;
      if (error?.code !== "ECONNREFUSED") {
        reason = "PORT_UNREACHABLE_UNCERTAIN";
        throw failure("seaweed_candidate_runtime_host_loopback_failed");
      }
    }
    proof = expectedProof({ imageId, runId, recipeRevision });
  } catch (error) { primaryFailure = error; }
  if (createAttempted && ownedId === undefined) {
    try {
      const inspected = await inspectContainer(docker, name, cleanupOptions, [0, 1]);
      if (inspected.status === 1 && ["", "[]"].includes(inspected.stdout.trim())
        && await containerAbsent(docker, name, cleanupOptions)) {
        // Docker confirms no container was created.
      } else {
        const value = parseInspect(inspected, "seaweed_candidate_runtime_host_loopback_cleanup_failed");
        if (!CONTAINER_ID.test(value.Id) || value.Image !== imageId || value.Config?.Labels?.[OWNERSHIP_LABEL] !== nonce
          || value.Config.Labels?.[PURPOSE_LABEL] !== PURPOSE) throw failure("seaweed_candidate_runtime_host_loopback_cleanup_failed");
        ownedId = value.Id;
      }
    } catch {
      throw diagnosticFailure("seaweed_candidate_runtime_host_loopback_cleanup_failed",
        "HOST_LOOPBACK_CLEANUP", "OWNERSHIP_UNCERTAIN", started);
    }
  }
  if (ownedId !== undefined) {
    let cleanupReason = "OWNERSHIP_UNCERTAIN";
    try {
      const value = parseInspect(await inspectContainer(docker, name, cleanupOptions),
        "seaweed_candidate_runtime_host_loopback_cleanup_failed");
      if (value.Id !== ownedId || value.Image !== imageId || value.Config?.Labels?.[OWNERSHIP_LABEL] !== nonce
        || value.Config.Labels?.[PURPOSE_LABEL] !== PURPOSE) throw failure("seaweed_candidate_runtime_host_loopback_cleanup_failed");
      if (value.State?.Status === "running") {
        cleanupReason = "STOP_FAILED";
        await command(docker, ["container", "stop", "--time", "30", name],
          { ...cleanupOptions, timeoutMs: 40_000 });
      }
      cleanupReason = "OWNERSHIP_UNCERTAIN";
      await command(docker, ["container", "rm", name], cleanupOptions);
      if (!await containerAbsent(docker, name, cleanupOptions)) throw failure("seaweed_candidate_runtime_host_loopback_cleanup_failed");
    } catch {
      const cleanupFailure = diagnosticFailure("seaweed_candidate_runtime_host_loopback_cleanup_failed",
        "HOST_LOOPBACK_CLEANUP", cleanupReason, started);
      if (primaryFailure !== undefined) {
        const wrapped = diagnosticFailure("seaweed_candidate_runtime_host_loopback_failed", phase, reason, started);
        wrapped.runtimeCleanupFailure = { code: cleanupFailure.code, phase: cleanupFailure.phase,
          reason: "CLEANUP_UNCERTAIN" };
        throw wrapped;
      }
      throw cleanupFailure;
    }
  }
  if (primaryFailure !== undefined) throw diagnosticFailure("seaweed_candidate_runtime_host_loopback_failed",
    phase, reason, started);
  return validateSeaweedRuntimeHostLoopbackProof(proof, { imageId, runId, recipeRevision });
}

export function verifyLocalSeaweedRuntimeHostLoopback(input) { return execute(input); }
export function TEST_ONLY_verifyLocalSeaweedRuntimeHostLoopback(input, injected) { return execute(input, injected); }
export function TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof(expected) {
  return validateSeaweedRuntimeHostLoopbackProof(expectedProof(expected), expected);
}
