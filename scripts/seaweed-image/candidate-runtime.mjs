import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const MAX_OUTPUT_BYTES = 1024 ** 2;
const COMMAND_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 60_000;
const DERIVATIVE_VERSION = "c507336+aw.549ec92660ab";
const RUNTIME_CONFIG = JSON.stringify({ identities: [{ name: "auto-world-diagnostic", credentials: [{
  accessKey: "AWDIAGNOSTICACCESS", secretKey: "aw-diagnostic-secret-not-for-production-0001",
}], actions: ["Admin:aw-runtime-diagnostic", "Read:aw-runtime-diagnostic", "List:aw-runtime-diagnostic",
  "Write:aw-runtime-diagnostic"] }] });
const SERVER_COMMAND = ["server", "-dir=/data", "-master.telemetry=false", "-s3", "-s3.port=8333",
  "-s3.port.iceberg=0", "-s3.port.lance=0", "-s3.config=/run/aw-private/s3.json"];
const BOOTSTRAP = `set -eu
umask 077
printf '%s\\n' '${RUNTIME_CONFIG}' > /run/aw-private/s3.json
test "$(stat -c '%u:%g:%a' /run/aw-private/s3.json)" = '1000:1000:600'
exec /entrypoint.sh ${SERVER_COMMAND.map((value) => `'${value}'`).join(" ")}`;
const PROBE = `set -eu
version=$(/usr/bin/weed version 2>&1)
case "$version" in *'${DERIVATIVE_VERSION}'*) ;; *) exit 21 ;; esac
test "$(awk '/^Uid:/ {print $2}' /proc/1/status)" = 1000
test "$(awk '/^Gid:/ {print $2}' /proc/1/status)" = 1000
test "$(stat -c '%u:%g:%a' /run/aw-private/s3.json)" = '1000:1000:600'
ready=''
i=0
while test "$i" -lt 60; do
  ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:9333/cluster/status || true)
  test "$ready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$ready" = 200
anonymous=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8333/ || true)
case "$anonymous" in 401|403) ;; *) exit 22 ;; esac
! nc -z -w 1 127.0.0.1 8181
! nc -z -w 1 127.0.0.1 9101
test ! -e /usr/bin/weed-volume
test ! -e /usr/bin/weed-worker
printf '%s\\n' 'SEAWEED_RUNTIME_PROFILE_VERIFIED'`;
const CREATE_PROFILE = ["--pull=never", "--network=none", "--read-only", "--user=1000:1000", "--memory=768m",
  "--memory-swap=768m", "--cpus=.75", "--pids-limit=512", "--cap-drop=ALL",
  "--security-opt=no-new-privileges=true", "--stop-timeout=30",
  "--tmpfs", "/data:rw,nosuid,nodev,noexec,size=256m,mode=0700,uid=1000,gid=1000",
  "--tmpfs", "/run/aw-private:rw,nosuid,nodev,noexec,size=64k,mode=0700,uid=1000,gid=1000",
  "--entrypoint=/bin/sh"];

function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const PROFILE_SHA256 = hash(CREATE_PROFILE);
const COMMAND_SHA256 = hash(["--entrypoint=/bin/sh", "-c", BOOTSTRAP]);
const PROOF_KEYS = ["kind", "state", "authority", "candidateAuthorization", "imageId", "runId",
  "recipeRevision", "profileSha256", "commandSha256", "derivativeVersion", "uid", "gid", "readiness",
  "anonymousAccess", "disabledListeners", "rustHelpers", "shutdown"];

function failure(code) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED" });
}

function exactObject(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function validInput(input) {
  return exactObject(input, ["parent", "dockerConfig", "imageId", "runId", "recipeRevision"])
    || exactObject(input, ["parent", "dockerConfig", "imageId", "runId", "recipeRevision", "signal"]);
}

async function capture(stream, kill) {
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) throw failure("seaweed_candidate_runtime_failed");
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
    throw failure("seaweed_candidate_runtime_failed");
  }
  return { ...results[0].value, stdout: results[1].value, stderr: results[2].value };
}

async function command(docker, args, options, statuses = [0]) {
  if (options.signal?.aborted) throw failure("seaweed_candidate_runtime_failed");
  const result = await docker(args, options);
  if (!statuses.includes(result?.status) || typeof result.stdout !== "string" || typeof result.stderr !== "string"
    || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MAX_OUTPUT_BYTES) {
    throw failure("seaweed_candidate_runtime_failed");
  }
  return result;
}

async function inspectContainer(docker, name, options, statuses = [0]) {
  return command(docker, ["container", "inspect", "--format", "{{.Id}}|{{.State.Status}}|{{.State.ExitCode}}",
    name], options, statuses);
}

function expectedProof({ imageId, runId, recipeRevision }) {
  return Object.freeze({ kind: "SEAWEED_LOCAL_RUNTIME_PROOF_V1", state: "VERIFIED", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", imageId, runId, recipeRevision, profileSha256: PROFILE_SHA256,
    commandSha256: COMMAND_SHA256, derivativeVersion: DERIVATIVE_VERSION, uid: 1000, gid: 1000,
    readiness: "CLUSTER_STATUS_200", anonymousAccess: "REFUSED", disabledListeners: "8181,9101",
    rustHelpers: "ABSENT_AND_REJECTED", shutdown: "BOUNDED" });
}

export function validateSeaweedRuntimeProfileProof(proof, expected) {
  if (!exactObject(expected, ["imageId", "runId", "recipeRevision"]) || !IMAGE_ID.test(expected.imageId)
    || !RUN_ID.test(expected.runId) || !REVISION.test(expected.recipeRevision)
    || !exactObject(proof, PROOF_KEYS)) throw failure("seaweed_candidate_runtime_failed");
  const canonical = expectedProof(expected);
  for (const key of PROOF_KEYS) if (proof[key] !== canonical[key]) throw failure("seaweed_candidate_runtime_failed");
  return canonical;
}

async function execute(input, injected) {
  if (!validInput(input)) throw failure("seaweed_candidate_runtime_failed");
  const { parent, dockerConfig, imageId, runId, recipeRevision, signal } = input;
  if (process.platform !== "linux" && injected === undefined || typeof parent !== "string" || !path.isAbsolute(parent)
    || path.normalize(parent) !== parent || typeof dockerConfig !== "string" || !path.isAbsolute(dockerConfig)
    || path.normalize(dockerConfig) !== dockerConfig || !IMAGE_ID.test(imageId) || !RUN_ID.test(runId)
    || !REVISION.test(recipeRevision) || signal !== undefined && !(signal instanceof globalThis.AbortSignal)) {
    throw failure("seaweed_candidate_runtime_failed");
  }
  if (signal?.aborted) throw failure("seaweed_candidate_runtime_failed");
  const docker = injected?.docker ?? defaultDocker;
  if (typeof docker !== "function" || injected !== undefined && !exactObject(injected, ["docker"])) {
    throw failure("seaweed_candidate_runtime_failed");
  }
  const name = `aw-seaweed-runtime-${runId}-attempt-1`;
  const env = { PATH: process.env.PATH ?? "", DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: "unix:///var/run/docker.sock", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TMPDIR: parent };
  const options = { cwd: parent, env, signal, timeoutMs: COMMAND_TIMEOUT_MS };
  const cleanupOptions = { cwd: parent, env, timeoutMs: CLEANUP_TIMEOUT_MS };
  let ownedId; let primaryFailure; let proof;
  try {
    const absent = await inspectContainer(docker, name, options, [0, 1]);
    if (absent.status !== 1 || absent.stdout.trim() !== "") throw failure("seaweed_candidate_runtime_failed");
    const created = await command(docker, ["container", "create", "--name", name, ...CREATE_PROFILE, imageId,
      "-c", BOOTSTRAP], options);
    ownedId = created.stdout.trim();
    if (!CONTAINER_ID.test(ownedId)) throw failure("seaweed_candidate_runtime_failed");
    const inspected = await inspectContainer(docker, name, options);
    if (inspected.stdout.trim() !== `${ownedId}|created|0`) throw failure("seaweed_candidate_runtime_failed");
    await command(docker, ["container", "start", name], options);
    const probe = await command(docker, ["container", "exec", name, "/bin/sh", "-c", PROBE], options);
    if (probe.stdout.trim() !== "SEAWEED_RUNTIME_PROFILE_VERIFIED" || probe.stderr.trim() !== "") {
      throw failure("seaweed_candidate_runtime_failed");
    }
    for (const helper of ["volume-rust", "worker-rust"]) {
      const rejected = await command(docker, ["container", "exec", name, "/entrypoint.sh", helper], options,
        [1, 126, 127]);
      if (rejected.status === 0 || Buffer.byteLength(rejected.stdout) + Buffer.byteLength(rejected.stderr) === 0) {
        throw failure("seaweed_candidate_runtime_failed");
      }
    }
    await command(docker, ["container", "stop", "--time", "30", name], { ...options, timeoutMs: 40_000 });
    const stopped = await inspectContainer(docker, name, options);
    if (stopped.stdout.trim() !== `${ownedId}|exited|0`) throw failure("seaweed_candidate_runtime_failed");
    proof = expectedProof({ imageId, runId, recipeRevision });
    validateSeaweedRuntimeProfileProof(proof, { imageId, runId, recipeRevision });
  } catch (error) { primaryFailure = error; }
  if (ownedId !== undefined) {
    try {
      const inspected = await inspectContainer(docker, name, cleanupOptions, [0, 1]);
      if (inspected.status !== 0) {
        throw failure("seaweed_candidate_runtime_cleanup_failed");
      }
      const [observedId, observedState, observedExitCode] = inspected.stdout.trim().split("|");
      if (observedId !== ownedId || !/^(?:created|exited|running)$/u.test(observedState)
        || !/^-?[0-9]+$/u.test(observedExitCode)) throw failure("seaweed_candidate_runtime_cleanup_failed");
      if (observedState === "running") {
        await command(docker, ["container", "stop", "--time", "30", name],
          { ...cleanupOptions, timeoutMs: 40_000 });
        const stopped = await inspectContainer(docker, name, cleanupOptions);
        if (stopped.stdout.trim().split("|").slice(0, 2).join("|") !== `${ownedId}|exited`) {
          throw failure("seaweed_candidate_runtime_cleanup_failed");
        }
      }
      await command(docker, ["container", "rm", name], cleanupOptions);
      const absent = await inspectContainer(docker, name, cleanupOptions, [0, 1]);
      if (absent.status !== 1 || absent.stdout.trim() !== "") throw failure("seaweed_candidate_runtime_cleanup_failed");
    } catch { throw failure("seaweed_candidate_runtime_cleanup_failed"); }
  }
  if (primaryFailure !== undefined) throw failure("seaweed_candidate_runtime_failed");
  return proof;
}

export function verifyLocalSeaweedRuntimeProfile(input) { return execute(input); }
export function TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input, injected) { return execute(input, injected); }
export function TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected) {
  return validateSeaweedRuntimeProfileProof(expectedProof(expected), expected);
}
