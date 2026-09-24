import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const MAX_OUTPUT_BYTES = 1024 ** 2;
const COMMAND_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 60_000;
const DERIVATIVE_VERSION = "c507336+aw.549ec92660ab";
const OWNERSHIP_LABEL = "com.auto-world.runtime-nonce";
const PUBLIC_PHASES = new Set(["RUNTIME_CONTEXT", "RUNTIME_PRECHECK", "RUNTIME_CREATE",
  "RUNTIME_START", "RUNTIME_PROBE", "RUNTIME_HELPERS", "RUNTIME_STOP", "RUNTIME_CLEANUP"]);
const PUBLIC_REASONS = new Set(["INPUT_INVALID", "DOCKER_COMMAND", "NAME_OCCUPIED",
  "CREATE_ID_INVALID", "OWNERSHIP_UNCERTAIN", "PROBE_COMMAND", "VERSION_MISMATCH",
  "ANONYMOUS_ALLOWED", "S3_UNAVAILABLE",
  "ANONYMOUS_UNEXPECTED_STATUS", "UID_MISMATCH", "GID_MISMATCH", "CONFIG_MODE_MISMATCH",
  "TMPFS_MODE_MISMATCH", "READINESS_UNAVAILABLE", "FILER_UNAVAILABLE",
  "ICEBERG_LISTENER_OPEN", "LANCE_LISTENER_OPEN",
  "RUST_HELPER_PRESENT", "PROBE_OUTPUT_INVALID", "RUST_HELPER_ACCEPTED",
  "RUST_HELPER_COMMAND", "STOP_FAILED", "EXIT_UNEXPECTED"]);
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
version=$(/usr/bin/weed version 2>&1) || exit 21
case "$version" in *'${DERIVATIVE_VERSION}'*) ;; *) exit 21 ;; esac
test "$(awk '/^Uid:/ {print $2}' /proc/1/status)" = 1000 || exit 23
test "$(awk '/^Gid:/ {print $2}' /proc/1/status)" = 1000 || exit 24
test "$(stat -c '%u:%g:%a' /run/aw-private/s3.json)" = '1000:1000:600' || exit 25
test "$(stat -c '%u:%g:%a' /tmp)" = '1000:1000:700' && test -w /tmp || exit 35
command -v curl >/dev/null 2>&1 || exit 32
ready=''
i=0
while test "$i" -lt 60; do
  ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:9333/cluster/status || true)
  test "$ready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$ready" = 200 || exit 26
filerready=''
i=0
while test "$i" -lt 30; do
  filerready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8888/readyz || true)
  test "$filerready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$filerready" = 200 || exit 36
s3ready=''
i=0
while test "$i" -lt 30; do
  s3ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8333/readyz || true)
  test "$s3ready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$s3ready" = 200 || exit 33
anonymous=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8333/ || true)
case "$anonymous" in 403) ;; 000|'') exit 33 ;; 200) exit 22 ;; *) exit 34 ;; esac
if nc -z -w 1 127.0.0.1 8181 >/dev/null 2>&1; then exit 27; else test "$?" = 1 || exit 32; fi
if nc -z -w 1 127.0.0.1 9101 >/dev/null 2>&1; then exit 28; else test "$?" = 1 || exit 32; fi
test ! -e /usr/bin/weed-volume || exit 29
test ! -e /usr/bin/weed-worker || exit 29
printf '%s\\n' 'SEAWEED_RUNTIME_PROFILE_VERIFIED'`;
const CREATE_PROFILE = ["--pull=never", "--network=none", "--read-only", "--user=1000:1000", "--memory=768m",
  "--memory-swap=768m", "--cpus=.75", "--pids-limit=512", "--cap-drop=ALL",
  "--security-opt=no-new-privileges=true", "--stop-timeout=30",
  "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000",
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

function diagnosticFailure(code, phase, reason, started) {
  const error = failure(code);
  error.phase = phase;
  error.reason = reason;
  error.durationMs = Math.min(10_800_000, Math.max(0, Math.floor(performance.now() - started)));
  return error;
}

export function isPublicSeaweedRuntimePhase(value) { return PUBLIC_PHASES.has(value); }
export function isPublicSeaweedRuntimeReason(value) { return PUBLIC_REASONS.has(value); }

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
  return command(docker, ["container", "inspect", "--format",
    `{{.Id}}|{{.State.Status}}|{{.State.ExitCode}}|{{index .Config.Labels "${OWNERSHIP_LABEL}"}}|{{.Image}}`,
    name], options, statuses);
}

async function containerAbsent(docker, name, options) {
  const inspected = await inspectContainer(docker, name, options, [0, 1]);
  if (inspected.status !== 1 || inspected.stdout.trim() !== "") return false;
  const listed = await command(docker, ["container", "ls", "--all", "--no-trunc", "--filter",
    `name=^/${name}$`, "--format", "{{.ID}}|{{.Names}}"], options);
  if (listed.stderr.trim() !== "") throw failure("seaweed_candidate_runtime_failed");
  return listed.stdout.trim() === "";
}

function ownedContainer(result, { nonce, imageId, ownedId } = {}) {
  if (result.status !== 0) throw failure("seaweed_candidate_runtime_cleanup_failed");
  const fields = result.stdout.trim().split("|");
  if (fields.length !== 5 || !CONTAINER_ID.test(fields[0])
    || !/^(?:created|exited|running)$/u.test(fields[1]) || !/^-?[0-9]+$/u.test(fields[2])
    || fields[3] !== nonce || fields[4] !== imageId
    || ownedId !== undefined && fields[0] !== ownedId) {
    throw failure("seaweed_candidate_runtime_cleanup_failed");
  }
  return { id: fields[0], state: fields[1], exitCode: fields[2] };
}

function expectedProof({ imageId, runId, recipeRevision }) {
  return Object.freeze({ kind: "SEAWEED_LOCAL_RUNTIME_PROOF_V1", state: "VERIFIED", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", imageId, runId, recipeRevision, profileSha256: PROFILE_SHA256,
    commandSha256: COMMAND_SHA256, derivativeVersion: DERIVATIVE_VERSION, uid: 1000, gid: 1000,
    readiness: "CLUSTER_STATUS_200_FILER_READYZ_200_S3_READYZ_200", anonymousAccess: "REFUSED_403",
    disabledListeners: "8181,9101",
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
  const started = performance.now();
  if (!validInput(input)) throw diagnosticFailure("seaweed_candidate_runtime_failed",
    "RUNTIME_CONTEXT", "INPUT_INVALID", started);
  const { parent, dockerConfig, imageId, runId, recipeRevision, signal } = input;
  if (process.platform !== "linux" && injected === undefined || typeof parent !== "string" || !path.isAbsolute(parent)
    || path.normalize(parent) !== parent || typeof dockerConfig !== "string" || !path.isAbsolute(dockerConfig)
    || path.normalize(dockerConfig) !== dockerConfig || !IMAGE_ID.test(imageId) || !RUN_ID.test(runId)
    || !REVISION.test(recipeRevision) || signal !== undefined && !(signal instanceof globalThis.AbortSignal)) {
    throw diagnosticFailure("seaweed_candidate_runtime_failed", "RUNTIME_CONTEXT", "INPUT_INVALID", started);
  }
  if (signal?.aborted) throw diagnosticFailure("seaweed_candidate_runtime_failed",
    "RUNTIME_CONTEXT", "INPUT_INVALID", started);
  const docker = injected?.docker ?? defaultDocker;
  if (typeof docker !== "function" || injected !== undefined && !exactObject(injected, ["docker"])) {
    throw diagnosticFailure("seaweed_candidate_runtime_failed", "RUNTIME_CONTEXT", "INPUT_INVALID", started);
  }
  const name = `aw-seaweed-runtime-${runId}-attempt-1`;
  const env = { PATH: process.env.PATH ?? "", DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: "unix:///var/run/docker.sock", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TMPDIR: parent };
  const options = { cwd: parent, env, signal, timeoutMs: COMMAND_TIMEOUT_MS };
  const cleanupOptions = { cwd: parent, env, timeoutMs: CLEANUP_TIMEOUT_MS };
  const nonce = randomBytes(24).toString("hex");
  let ownedId; let createAttempted = false; let primaryFailure; let proof;
  let phase = "RUNTIME_PRECHECK"; let reason = "DOCKER_COMMAND";
  try {
    if (!await containerAbsent(docker, name, options)) {
      reason = "NAME_OCCUPIED"; throw failure("seaweed_candidate_runtime_failed");
    }
    phase = "RUNTIME_CREATE"; reason = "DOCKER_COMMAND";
    createAttempted = true;
    const created = await command(docker, ["container", "create", "--name", name,
      "--label", `${OWNERSHIP_LABEL}=${nonce}`, ...CREATE_PROFILE, imageId,
      "-c", BOOTSTRAP], options);
    const returnedId = created.stdout.trim();
    if (!CONTAINER_ID.test(returnedId)) {
      reason = "CREATE_ID_INVALID"; throw failure("seaweed_candidate_runtime_failed");
    }
    reason = "OWNERSHIP_UNCERTAIN";
    const inspected = ownedContainer(await inspectContainer(docker, name, options), { nonce, imageId,
      ownedId: returnedId });
    ownedId = inspected.id;
    if (inspected.state !== "created" || inspected.exitCode !== "0") {
      throw failure("seaweed_candidate_runtime_failed");
    }
    phase = "RUNTIME_START"; reason = "DOCKER_COMMAND";
    await command(docker, ["container", "start", name], options);
    phase = "RUNTIME_PROBE"; reason = "PROBE_COMMAND";
    const probe = await command(docker, ["container", "exec", name, "/bin/sh", "-c", PROBE],
      { ...options, timeoutMs: 390_000 }, [0, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32, 33, 34, 35, 36, 127]);
    const probeReasons = { 21: "VERSION_MISMATCH", 22: "ANONYMOUS_ALLOWED", 23: "UID_MISMATCH",
      24: "GID_MISMATCH", 25: "CONFIG_MODE_MISMATCH", 26: "READINESS_UNAVAILABLE",
      27: "ICEBERG_LISTENER_OPEN", 28: "LANCE_LISTENER_OPEN", 29: "RUST_HELPER_PRESENT",
      32: "PROBE_COMMAND", 33: "S3_UNAVAILABLE", 34: "ANONYMOUS_UNEXPECTED_STATUS",
      35: "TMPFS_MODE_MISMATCH", 36: "FILER_UNAVAILABLE",
      127: "PROBE_COMMAND" };
    if (probe.status !== 0) {
      reason = probeReasons[probe.status]; throw failure("seaweed_candidate_runtime_failed");
    }
    if (probe.stdout.trim() !== "SEAWEED_RUNTIME_PROFILE_VERIFIED" || probe.stderr.trim() !== "") {
      reason = "PROBE_OUTPUT_INVALID";
      throw failure("seaweed_candidate_runtime_failed");
    }
    phase = "RUNTIME_HELPERS"; reason = "RUST_HELPER_COMMAND";
    for (const helper of ["volume-rust", "worker-rust"]) {
      const rejected = await command(docker, ["container", "exec", name, "/entrypoint.sh", helper], options,
        [0, 1, 126, 127]);
      if (rejected.status === 0 || Buffer.byteLength(rejected.stdout) + Buffer.byteLength(rejected.stderr) === 0) {
        reason = "RUST_HELPER_ACCEPTED";
        throw failure("seaweed_candidate_runtime_failed");
      }
    }
    phase = "RUNTIME_STOP"; reason = "STOP_FAILED";
    await command(docker, ["container", "stop", "--time", "30", name], { ...options, timeoutMs: 40_000 });
    reason = "OWNERSHIP_UNCERTAIN";
    const stopped = ownedContainer(await inspectContainer(docker, name, options),
      { nonce, imageId, ownedId });
    if (stopped.state !== "exited" || stopped.exitCode !== "0") {
      reason = "EXIT_UNEXPECTED";
      throw failure("seaweed_candidate_runtime_failed");
    }
    proof = expectedProof({ imageId, runId, recipeRevision });
    validateSeaweedRuntimeProfileProof(proof, { imageId, runId, recipeRevision });
  } catch (error) { primaryFailure = error; }
  if (createAttempted && ownedId === undefined) {
    try {
      const inspected = await inspectContainer(docker, name, cleanupOptions, [0, 1]);
      if (inspected.status === 1 && inspected.stdout.trim() === ""
        && await containerAbsent(docker, name, cleanupOptions)) {
        // The daemon confirms that an interrupted or failed create left no named container.
      } else {
        ownedId = ownedContainer(inspected, { nonce, imageId }).id;
      }
    } catch { throw diagnosticFailure("seaweed_candidate_runtime_cleanup_failed",
      "RUNTIME_CLEANUP", "OWNERSHIP_UNCERTAIN", started); }
  }
  if (ownedId !== undefined) {
    let cleanupReason = "OWNERSHIP_UNCERTAIN";
    try {
      const inspected = ownedContainer(await inspectContainer(docker, name, cleanupOptions),
        { nonce, imageId, ownedId });
      if (inspected.state === "running") {
        cleanupReason = "STOP_FAILED";
        await command(docker, ["container", "stop", "--time", "30", name],
          { ...cleanupOptions, timeoutMs: 40_000 });
        cleanupReason = "OWNERSHIP_UNCERTAIN";
        const stopped = ownedContainer(await inspectContainer(docker, name, cleanupOptions),
          { nonce, imageId, ownedId });
        if (stopped.state !== "exited") {
          throw failure("seaweed_candidate_runtime_cleanup_failed");
        }
      }
      await command(docker, ["container", "rm", name], cleanupOptions);
      if (!await containerAbsent(docker, name, cleanupOptions)) {
        throw failure("seaweed_candidate_runtime_cleanup_failed");
      }
    } catch { throw diagnosticFailure("seaweed_candidate_runtime_cleanup_failed",
      "RUNTIME_CLEANUP", cleanupReason, started); }
  }
  if (primaryFailure !== undefined) throw diagnosticFailure("seaweed_candidate_runtime_failed",
    phase, reason, started);
  return proof;
}

export function verifyLocalSeaweedRuntimeProfile(input) { return execute(input); }
export function TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input, injected) { return execute(input, injected); }
export function TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected) {
  return validateSeaweedRuntimeProfileProof(expectedProof(expected), expected);
}
