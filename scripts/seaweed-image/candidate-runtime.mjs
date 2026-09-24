import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { runStrictContentionProbe } from "./strict-contention.mjs";

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const MAX_OUTPUT_BYTES = 1024 ** 2;
const COMMAND_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 60_000;
const DERIVATIVE_VERSION = "c507336+aw.549ec92660ab";
const OWNERSHIP_LABEL = "com.auto-world.runtime-nonce";
const ACCESS_KEY = "AWDIAGNOSTICACCESS";
const SECRET_KEY = "aw-diagnostic-secret-not-for-production-0001";
const PAYLOAD_A = "auto-world-s3-diagnostic-payload-a";
const PAYLOAD_B = "auto-world-s3-diagnostic-payload-b";
const PAYLOAD_A_SHA256 = createHash("sha256").update(PAYLOAD_A).digest("hex");
const PAYLOAD_B_SHA256 = createHash("sha256").update(PAYLOAD_B).digest("hex");
const PUBLIC_PHASES = new Set(["RUNTIME_CONTEXT", "RUNTIME_PRECHECK", "RUNTIME_CREATE",
  "RUNTIME_START", "RUNTIME_PROBE", "RUNTIME_S3_PROTOCOL", "RUNTIME_HELPERS", "RUNTIME_STOP",
  "RUNTIME_STRICT_CONTENTION",
  "RUNTIME_CLEANUP", "PERSISTENCE_CONTEXT", "PERSISTENCE_PRECHECK", "PERSISTENCE_VOLUME_CREATE",
  "PERSISTENCE_VOLUME_INIT", "PERSISTENCE_SERVICE_ONE", "PERSISTENCE_SERVICE_TWO",
  "PERSISTENCE_CLEANUP", "BACKUP_RESTORE_CONTEXT", "BACKUP_RESTORE_PRECHECK", "BACKUP_SOURCE_VOLUME",
  "BACKUP_SOURCE_SERVICE", "BACKUP_ARCHIVE", "BACKUP_SOURCE_DISPOSAL", "BACKUP_RESTORE_VOLUME",
  "BACKUP_RESTORE_COPY", "BACKUP_RESTORED_SERVICE", "BACKUP_RESTORE_CLEANUP"]);
const PUBLIC_REASONS = new Set(["INPUT_INVALID", "DOCKER_COMMAND", "NAME_OCCUPIED",
  "CREATE_ID_INVALID", "OWNERSHIP_UNCERTAIN", "PROBE_COMMAND", "VERSION_MISMATCH",
  "ANONYMOUS_ALLOWED", "S3_UNAVAILABLE",
  "ANONYMOUS_UNEXPECTED_STATUS", "UID_MISMATCH", "GID_MISMATCH", "CONFIG_MODE_MISMATCH",
  "TMPFS_MODE_MISMATCH", "READINESS_UNAVAILABLE", "FILER_UNAVAILABLE",
  "SIGNED_CLIENT_UNAVAILABLE", "ALLOWED_SCOPE_DENIED", "READBACK_MISMATCH",
  "WRONG_CREDENTIAL_ACCEPTED", "FORBIDDEN_SCOPE_ALLOWED", "CONDITIONAL_WRITE_UNEXPECTED",
  "CONCURRENT_WRITE_UNEXPECTED", "ANONYMOUS_OBJECT_ALLOWED", "SIGNED_TRANSPORT_FAILURE",
  "WRONG_CREDENTIAL_UNEXPECTED_STATUS", "FORBIDDEN_SCOPE_UNEXPECTED_STATUS",
  "ANONYMOUS_OBJECT_UNEXPECTED_STATUS", "ALLOWED_SCOPE_UNEXPECTED_STATUS",
  "READ_UNEXPECTED_STATUS",
  "ICEBERG_LISTENER_OPEN", "LANCE_LISTENER_OPEN",
  "RUST_HELPER_PRESENT", "PROBE_OUTPUT_INVALID", "RUST_HELPER_ACCEPTED",
  "RUST_HELPER_COMMAND", "STOP_FAILED", "EXIT_UNEXPECTED"]);
for (const reason of ["STRICT_INPUT_INVALID", "STRICT_SIGNED_PROBE_FAILURE", "STRICT_PRECONDITION_UNEXPECTED",
  "STRICT_RESPONSE_INVALID", "STRICT_BARRIER_MISSING", "STRICT_EARLY_FINAL",
  "STRICT_RESULT_UNEXPECTED", "STRICT_READBACK_MISMATCH", "STRICT_TRANSPORT_FAILURE",
  "STRICT_TIMEOUT"]) {
  PUBLIC_REASONS.add(reason);
}
for (const reason of ["VOLUME_NAME_OCCUPIED", "VOLUME_CREATE_INVALID", "VOLUME_IDENTITY_UNCERTAIN",
  "CONTAINER_NAME_OCCUPIED", "CONTAINER_CREATE_INVALID", "CONTAINER_IDENTITY_UNCERTAIN",
  "CONTAINER_PROFILE_UNCERTAIN", "CONTAINER_USER_MISMATCH", "CONTAINER_CAP_ADD_MISMATCH",
  "CONTAINER_CAP_DROP_MISMATCH", "CONTAINER_ROOTFS_MODE_MISMATCH",
  "CONTAINER_SECURITY_OPT_MISMATCH",
  "VOLUME_INIT_FAILED", "FIRST_WRITE_FAILED", "SECOND_READ_FAILED",
  "PERSISTED_OBJECT_MISSING", "PERSISTED_OBJECT_MISMATCH", "CLEANUP_UNCERTAIN"]) {
  PUBLIC_REASONS.add(reason);
}
for (const reason of ["SOURCE_WRITE_FAILED", "SOURCE_STOP_FAILED", "BACKUP_FAILED",
  "SOURCE_DISPOSAL_FAILED", "RESTORE_FAILED", "RESTORED_READ_FAILED", "RESTORED_STOP_FAILED",
  "RESTORED_OBJECT_MISSING", "RESTORED_OBJECT_MISMATCH"]) {
  PUBLIC_REASONS.add(reason);
}
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
const SIGNED_PROBE = `set -eu
command -v curl >/dev/null 2>&1 && curl --help all 2>/dev/null | grep -q -- '--aws-sigv4' || exit 41
command -v sha256sum >/dev/null 2>&1 && command -v mktemp >/dev/null 2>&1 || exit 41
work=$(mktemp -d /tmp/aw-s3-proof.XXXXXXXX) || exit 41
trap 'rm -f "$work/read" "$work/winner" "$work/a" "$work/b"; rmdir "$work"' EXIT
signed() {
  curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \\
    --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' "$@" 2>/dev/null
}
bucket=$(signed --request PUT http://127.0.0.1:8333/aw-raw) || exit 49
case "$bucket" in 200) ;; 401|403) exit 42 ;; 000|'') exit 49 ;; *) exit 53 ;; esac
first=$(signed --request PUT --header 'If-None-Match: *' --data-binary '${PAYLOAD_A}' \\
  http://127.0.0.1:8333/aw-raw/proof) || exit 49
case "$first" in 200) ;; 401|403) exit 42 ;; 000|'') exit 49 ;; *) exit 53 ;; esac
read_status=$(curl --silent --output "$work/read" --write-out '%{http_code}' --max-time 10 \\
  --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' \\
  http://127.0.0.1:8333/aw-raw/proof 2>/dev/null) || exit 49
test "$read_status" = 200 || exit 54
test "$(sha256sum "$work/read" | cut -d ' ' -f 1)" = '${PAYLOAD_A_SHA256}' || exit 43
wrong=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \\
  --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:incorrect' \\
  http://127.0.0.1:8333/aw-raw/proof 2>/dev/null) || exit 49
case "$wrong" in 403) ;; 000|'') exit 49 ;; 2??) exit 44 ;; *) exit 50 ;; esac
forbidden=$(signed --request PUT http://127.0.0.1:8333/aw-forbidden) || exit 49
case "$forbidden" in 403) ;; 000|'') exit 49 ;; 2??) exit 45 ;; *) exit 51 ;; esac
unsigned=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \\
  http://127.0.0.1:8333/aw-raw/proof 2>/dev/null) || exit 49
case "$unsigned" in 403) ;; 000|'') exit 49 ;; 2??) exit 48 ;; *) exit 52 ;; esac
same=$(signed --request PUT --header 'If-None-Match: *' --data-binary '${PAYLOAD_A}' \\
  http://127.0.0.1:8333/aw-raw/proof) || exit 49
different=$(signed --request PUT --header 'If-None-Match: *' --data-binary '${PAYLOAD_B}' \\
  http://127.0.0.1:8333/aw-raw/proof) || exit 49
test "$same" = 412 && test "$different" = 412 || exit 46
read_status=$(curl --silent --output "$work/read" --write-out '%{http_code}' --max-time 10 \\
  --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' \\
  http://127.0.0.1:8333/aw-raw/proof 2>/dev/null) || exit 49
test "$read_status" = 200 || exit 54
test "$(sha256sum "$work/read" | cut -d ' ' -f 1)" = '${PAYLOAD_A_SHA256}' || exit 43
signed --request PUT --header 'If-None-Match: *' --data-binary '${PAYLOAD_A}' \\
  http://127.0.0.1:8333/aw-raw/race > "$work/a" & a_pid=$!
signed --request PUT --header 'If-None-Match: *' --data-binary '${PAYLOAD_B}' \\
  http://127.0.0.1:8333/aw-raw/race > "$work/b" & b_pid=$!
a_rc=0; b_rc=0
wait "$a_pid" || a_rc=$?
wait "$b_pid" || b_rc=$?
test "$a_rc" = 0 && test "$b_rc" = 0 || exit 49
a=$(cat "$work/a"); b=$(cat "$work/b")
if test "$a" = 200 && { test "$b" = 412 || test "$b" = 409; }; then
  winner='${PAYLOAD_A_SHA256}'
elif test "$b" = 200 && { test "$a" = 412 || test "$a" = 409; }; then
  winner='${PAYLOAD_B_SHA256}'
else
  exit 47
fi
read_status=$(curl --silent --output "$work/winner" --write-out '%{http_code}' --max-time 10 \\
  --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' \\
  http://127.0.0.1:8333/aw-raw/race 2>/dev/null) || exit 49
test "$read_status" = 200 || exit 54
test "$(sha256sum "$work/winner" | cut -d ' ' -f 1)" = "$winner" || exit 47
printf '%s\\n' 'SEAWEED_SIGNED_S3_PROTOCOL_VERIFIED'`;
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
  "anonymousAccess", "authenticatedAccess", "scopeEnforcement", "conditionalWrites",
  "parallelAttempt", "disabledListeners", "rustHelpers", "shutdown"];

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
  return Object.freeze({ kind: "SEAWEED_LOCAL_RUNTIME_PROOF_V2", state: "VERIFIED", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", imageId, runId, recipeRevision, profileSha256: PROFILE_SHA256,
    commandSha256: COMMAND_SHA256, derivativeVersion: DERIVATIVE_VERSION, uid: 1000, gid: 1000,
    readiness: "CLUSTER_STATUS_200_FILER_READYZ_200_S3_READYZ_200", anonymousAccess: "REFUSED_403",
    authenticatedAccess: "SIGNED_CREATE_PUT_GET_SHA256", scopeEnforcement: "WRONG_KEY_AND_BUCKET_REFUSED_403",
    conditionalWrites: "REPLAY_AND_OVERWRITE_REFUSED_412",
    parallelAttempt: "SINGLE_PAIR_ONE_WINNER_READBACK",
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

const STRICT_PROOF_KEYS = ["kind", "state", "authority", "candidateAuthorization", "imageId",
  "runId", "recipeRevision", "requestBarrier", "conditionalResult", "winner", "winnerReadback",
  "isolation", "shutdown"];

function expectedStrictProof({ imageId, runId, recipeRevision, winner }) {
  return Object.freeze({ kind: "SEAWEED_LOCAL_RUNTIME_STRICT_CONTENTION_PROOF_V1", state: "VERIFIED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED", imageId, runId,
    recipeRevision, requestBarrier: "TWO_SIGNED_HTTP11_100_BEFORE_BODIES",
    conditionalResult: "ONE_200_ONE_412", winner, winnerReadback: "SIGNED_GET_WINNER_SHA256",
    isolation: "LOOPBACK_ONLY_NO_PUBLISHED_PORT", shutdown: "BOUNDED" });
}

export function validateSeaweedRuntimeStrictContentionProof(proof, expected) {
  if (!exactObject(expected, ["imageId", "runId", "recipeRevision"])
    || !IMAGE_ID.test(expected.imageId) || !RUN_ID.test(expected.runId)
    || !REVISION.test(expected.recipeRevision) || !exactObject(proof, STRICT_PROOF_KEYS)
    || !["A", "B"].includes(proof.winner)) throw failure("seaweed_candidate_runtime_failed");
  const canonical = expectedStrictProof({ ...expected, winner: proof.winner });
  for (const key of STRICT_PROOF_KEYS) if (proof[key] !== canonical[key]) {
    throw failure("seaweed_candidate_runtime_failed");
  }
  return canonical;
}

async function execute(input, injected, strict = false) {
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
  const strictProbe = injected?.strictProbe ?? runStrictContentionProbe;
  if (typeof docker !== "function" || typeof strictProbe !== "function"
    || injected !== undefined && !exactObject(injected, strict ? ["docker", "strictProbe"] : ["docker"])) {
    throw diagnosticFailure("seaweed_candidate_runtime_failed", "RUNTIME_CONTEXT", "INPUT_INVALID", started);
  }
  const name = `aw-seaweed-runtime-${runId}-attempt-1`;
  const env = { PATH: process.env.PATH ?? "", DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: "unix:///var/run/docker.sock", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TMPDIR: parent };
  const options = { cwd: parent, env, signal, timeoutMs: COMMAND_TIMEOUT_MS };
  const cleanupOptions = { cwd: parent, env, timeoutMs: CLEANUP_TIMEOUT_MS };
  const nonce = randomBytes(24).toString("hex");
  let ownedId; let createAttempted = false; let primaryFailure; let proof; let strictWinner;
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
    phase = "RUNTIME_S3_PROTOCOL"; reason = "PROBE_COMMAND";
    const signed = await command(docker, ["container", "exec", name, "/bin/sh", "-c", SIGNED_PROBE],
      { ...options, timeoutMs: 90_000 }, [0, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 127]);
    const signedReasons = { 41: "SIGNED_CLIENT_UNAVAILABLE", 42: "ALLOWED_SCOPE_DENIED",
      43: "READBACK_MISMATCH", 44: "WRONG_CREDENTIAL_ACCEPTED", 45: "FORBIDDEN_SCOPE_ALLOWED",
      46: "CONDITIONAL_WRITE_UNEXPECTED", 47: "CONCURRENT_WRITE_UNEXPECTED",
      48: "ANONYMOUS_OBJECT_ALLOWED", 49: "SIGNED_TRANSPORT_FAILURE",
      50: "WRONG_CREDENTIAL_UNEXPECTED_STATUS", 51: "FORBIDDEN_SCOPE_UNEXPECTED_STATUS",
      52: "ANONYMOUS_OBJECT_UNEXPECTED_STATUS", 53: "ALLOWED_SCOPE_UNEXPECTED_STATUS",
      54: "READ_UNEXPECTED_STATUS",
      127: "SIGNED_CLIENT_UNAVAILABLE" };
    if (signed.status !== 0) {
      reason = signedReasons[signed.status]; throw failure("seaweed_candidate_runtime_failed");
    }
    if (signed.stdout.trim() !== "SEAWEED_SIGNED_S3_PROTOCOL_VERIFIED" || signed.stderr.trim() !== "") {
      reason = "PROBE_OUTPUT_INVALID";
      throw failure("seaweed_candidate_runtime_failed");
    }
    if (strict) {
      phase = "RUNTIME_STRICT_CONTENTION"; reason = "STRICT_TRANSPORT_FAILURE";
      try {
        const result = await strictProbe({ name, runId, options, docker, accessKey: ACCESS_KEY,
          secretKey: SECRET_KEY });
        if (!["A", "B"].includes(result?.winner)) throw failure("seaweed_candidate_runtime_failed");
        strictWinner = result.winner;
      } catch (error) {
        if (PUBLIC_REASONS.has(error?.reason) && error.reason.startsWith("STRICT_")) reason = error.reason;
        throw failure("seaweed_candidate_runtime_failed");
      }
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
  if (!strict) return proof;
  const strictContentionProof = expectedStrictProof({ imageId, runId, recipeRevision,
    winner: strictWinner });
  validateSeaweedRuntimeStrictContentionProof(strictContentionProof,
    { imageId, runId, recipeRevision });
  return Object.freeze({ runtimeProof: proof, strictContentionProof });
}

export function verifyLocalSeaweedRuntimeProfile(input) { return execute(input); }
export function TEST_ONLY_verifyLocalSeaweedRuntimeProfile(input, injected) { return execute(input, injected); }
export function TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected) {
  return validateSeaweedRuntimeProfileProof(expectedProof(expected), expected);
}
export function TEST_ONLY_signedSeaweedS3ProbeScript() { return SIGNED_PROBE; }
export function verifyLocalSeaweedRuntimeStrictContention(input) { return execute(input, undefined, true); }
export function TEST_ONLY_verifyLocalSeaweedRuntimeStrictContention(input, injected) {
  return execute(input, injected, true);
}
export function TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof(expected, winner = "A") {
  return validateSeaweedRuntimeStrictContentionProof(expectedStrictProof({ ...expected, winner }), expected);
}

const PERSISTENCE_PURPOSE_LABEL = "com.auto-world.runtime-purpose";
const PERSISTENCE_PURPOSE = "restart-persistence-v1";
const PERSISTENCE_PAYLOAD = "auto-world-restart-persistence-payload-v1";
const PERSISTENCE_PAYLOAD_SHA256 = createHash("sha256").update(PERSISTENCE_PAYLOAD).digest("hex");
const PERSISTENCE_INIT_PROFILE = ["--pull=never", "--network=none", "--read-only", "--user=0:0",
  "--memory=128m", "--memory-swap=128m", "--cpus=.25", "--pids-limit=64", "--cap-drop=ALL",
  "--cap-add=CHOWN", "--security-opt=no-new-privileges=true", "--stop-timeout=10",
  "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=4m,mode=0700", "--entrypoint=/bin/sh"];
const PERSISTENCE_SERVICE_PROFILE = ["--pull=never", "--network=none", "--read-only", "--user=1000:1000",
  "--memory=768m", "--memory-swap=768m", "--cpus=.75", "--pids-limit=512", "--cap-drop=ALL",
  "--security-opt=no-new-privileges=true", "--stop-timeout=30",
  "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000",
  "--tmpfs", "/run/aw-private:rw,nosuid,nodev,noexec,size=64k,mode=0700,uid=1000,gid=1000",
  "--entrypoint=/bin/sh"];
const PERSISTENCE_INIT_COMMAND = `set -eu
test "$(awk '/^NoNewPrivs:/ {print $2}' /proc/1/status)" = 1
test -d /data
entries=$(find /data -mindepth 1 -maxdepth 1 -print) || exit 1
test -z "$entries"
chmod 0700 /data
chown 1000:1000 /data
test "$(stat -c '%u:%g:%a' /data)" = '1000:1000:700'
printf '%s\\n' 'SEAWEED_PERSISTENCE_VOLUME_INITIALIZED'`;
const PERSISTENCE_READY = `command -v curl >/dev/null 2>&1 || exit 61
test "$(awk '/^Uid:/ {print $2}' /proc/1/status)" = 1000 || exit 67
test "$(awk '/^Gid:/ {print $2}' /proc/1/status)" = 1000 || exit 67
test "$(awk '/^NoNewPrivs:/ {print $2}' /proc/1/status)" = 1 || exit 67
test "$(stat -c '%u:%g:%a' /data)" = '1000:1000:700' && test -w /data || exit 68
ready=''; i=0
while test "$i" -lt 60; do
  ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:9333/cluster/status || true)
  test "$ready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$ready" = 200 || exit 62
filerready=''; i=0
while test "$i" -lt 30; do
  filerready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8888/readyz || true)
  test "$filerready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$filerready" = 200 || exit 62
s3ready=''; i=0
while test "$i" -lt 30; do
  s3ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8333/readyz || true)
  test "$s3ready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$s3ready" = 200 || exit 62
curl --help all 2>/dev/null | grep -q -- '--aws-sigv4' || exit 61
command -v sha256sum >/dev/null 2>&1 && command -v mktemp >/dev/null 2>&1 || exit 61`;
const PERSISTENCE_FIRST_PROBE = `set -eu
${PERSISTENCE_READY}
work=$(mktemp -d /tmp/aw-persistence.XXXXXXXX) || exit 61
trap 'rm -f "$work/read"; rmdir "$work"' EXIT
signed() {
  curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \\
    --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' "$@" 2>/dev/null
}
bucket=$(signed --request PUT http://127.0.0.1:8333/aw-raw) || exit 63
test "$bucket" = 200 || exit 63
put=$(signed --request PUT --header 'If-None-Match: *' --data-binary '${PERSISTENCE_PAYLOAD}' \\
  http://127.0.0.1:8333/aw-raw/restart-proof) || exit 63
test "$put" = 200 || exit 63
read_status=$(curl --silent --output "$work/read" --write-out '%{http_code}' --max-time 10 \\
  --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' \\
  http://127.0.0.1:8333/aw-raw/restart-proof 2>/dev/null) || exit 63
test "$read_status" = 200 || exit 63
test "$(sha256sum "$work/read" | cut -d ' ' -f 1)" = '${PERSISTENCE_PAYLOAD_SHA256}' || exit 64
printf '%s\\n' 'SEAWEED_PERSISTENCE_FIRST_WRITE_VERIFIED'`;
const PERSISTENCE_SECOND_PROBE = `set -eu
${PERSISTENCE_READY}
work=$(mktemp -d /tmp/aw-persistence.XXXXXXXX) || exit 61
trap 'rm -f "$work/read"; rmdir "$work"' EXIT
read_status=$(curl --silent --output "$work/read" --write-out '%{http_code}' --max-time 10 \\
  --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' \\
  http://127.0.0.1:8333/aw-raw/restart-proof 2>/dev/null) || exit 69
case "$read_status" in 200) ;; 404) exit 65 ;; *) exit 69 ;; esac
test "$(sha256sum "$work/read" | cut -d ' ' -f 1)" = '${PERSISTENCE_PAYLOAD_SHA256}' || exit 66
printf '%s\\n' 'SEAWEED_PERSISTENCE_SECOND_READ_VERIFIED'`;
const PERSISTENCE_PROFILE_SHA256 = hash({ initializer: PERSISTENCE_INIT_PROFILE,
  service: PERSISTENCE_SERVICE_PROFILE, mount: "type=volume,src=<owned>,dst=/data,volume-nocopy" });
const PERSISTENCE_COMMAND_SHA256 = hash([PERSISTENCE_INIT_COMMAND, BOOTSTRAP,
  PERSISTENCE_FIRST_PROBE, PERSISTENCE_SECOND_PROBE]);
const PERSISTENCE_PROOF_KEYS = ["kind", "state", "authority", "candidateAuthorization", "imageId", "runId",
  "recipeRevision", "profileSha256", "commandSha256", "volumeIdentity", "volumeMount", "initializer",
  "firstService", "secondService", "objectPersistence", "shutdown", "cleanup"];

function expectedPersistenceProof({ imageId, runId, recipeRevision }) {
  return Object.freeze({ kind: "SEAWEED_LOCAL_RUNTIME_PERSISTENCE_PROOF_V1", state: "VERIFIED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED", imageId, runId, recipeRevision,
    profileSha256: PERSISTENCE_PROFILE_SHA256, commandSha256: PERSISTENCE_COMMAND_SHA256,
    volumeIdentity: "FRESH_NAME_LABELS_CREATED_AT_LOCAL_VERIFIED", volumeMount: "VOLUME_NOCOPY_RW_DATA",
    initializer: "ROOT_CAP_CHOWN_EMPTY_CHMOD_CHOWN_UID1000",
    firstService: "SIGNED_CONDITIONAL_PUT_GET_SHA256",
    secondService: "DISTINCT_CONTAINER_READY_SIGNED_GET_SHA256",
    objectPersistence: "PRESERVED_ACROSS_RESTART", shutdown: "BOTH_SERVICES_BOUNDED",
    cleanup: "OWNED_CONTAINERS_AND_VOLUME_REMOVED" });
}

export function validateSeaweedRuntimePersistenceProof(proof, expected) {
  if (!exactObject(expected, ["imageId", "runId", "recipeRevision"]) || !IMAGE_ID.test(expected.imageId)
    || !RUN_ID.test(expected.runId) || !REVISION.test(expected.recipeRevision)
    || !exactObject(proof, PERSISTENCE_PROOF_KEYS)) throw failure("seaweed_candidate_runtime_persistence_failed");
  const canonical = expectedPersistenceProof(expected);
  for (const key of PERSISTENCE_PROOF_KEYS) {
    if (proof[key] !== canonical[key]) throw failure("seaweed_candidate_runtime_persistence_failed");
  }
  return canonical;
}

async function inspectPersistenceVolume(docker, name, options, statuses = [0]) {
  return command(docker, ["volume", "inspect", "--format",
    `{{.Name}}|{{.Driver}}|{{.Scope}}|{{.CreatedAt}}|{{index .Labels "${OWNERSHIP_LABEL}"}}|{{index .Labels "${PERSISTENCE_PURPOSE_LABEL}"}}`,
    name], options, statuses);
}

async function persistenceVolumeAbsent(docker, name, options) {
  const inspected = await inspectPersistenceVolume(docker, name, options, [0, 1]);
  if (inspected.status !== 1 || inspected.stdout.trim() !== "") return false;
  const listed = await command(docker, ["volume", "ls", "--filter", `name=^${name}$`, "--format", "{{.Name}}"], options);
  return listed.stderr.trim() === "" && listed.stdout.trim() === "";
}

function ownedPersistenceVolume(result, { name, nonce, createdAfterMs, createdAt }) {
  if (result.status !== 0) throw failure("seaweed_candidate_runtime_persistence_cleanup_failed");
  const fields = result.stdout.trim().split("|");
  const createdAtMs = Date.parse(fields[3]);
  if (fields.length !== 6 || fields[0] !== name || fields[1] !== "local" || fields[2] !== "local"
    || !Number.isFinite(createdAtMs) || createdAfterMs !== undefined
      && (createdAtMs < createdAfterMs - 5_000 || createdAtMs > Date.now() + 5_000)
    || createdAt !== undefined && fields[3] !== createdAt
    || fields[4] !== nonce || fields[5] !== PERSISTENCE_PURPOSE) {
    throw failure("seaweed_candidate_runtime_persistence_cleanup_failed");
  }
  return { createdAt: fields[3] };
}

async function inspectPersistenceContainer(docker, name, options, statuses = [0]) {
  return command(docker, ["container", "inspect", "--format",
    `{{.Id}}|{{.State.Status}}|{{.State.ExitCode}}|{{index .Config.Labels "${OWNERSHIP_LABEL}"}}|{{index .Config.Labels "${PERSISTENCE_PURPOSE_LABEL}"}}|{{.Image}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}{{end}}{{end}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.Destination}}{{end}}{{end}}|{{range .Mounts}}{{if eq .Destination "/data"}}{{.RW}}{{end}}{{end}}|{{range .HostConfig.Mounts}}{{if eq .Target "/data"}}{{.VolumeOptions.NoCopy}}{{end}}{{end}}|{{.Config.User}}|{{json .HostConfig.CapAdd}}|{{json .HostConfig.CapDrop}}|{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.SecurityOpt}}`,
    name], options, statuses);
}

function persistenceProfileMismatch(fields, role) {
  const init = role === "init";
  if (!init && role !== "service-1" && role !== "service-2") return "CONTAINER_PROFILE_UNCERTAIN";
  if (fields[11] !== (init ? "0:0" : "1000:1000")) return "CONTAINER_USER_MISMATCH";
  if (init ? fields[12] !== '["CAP_CHOWN"]' : fields[12] !== "null" && fields[12] !== "[]") {
    return "CONTAINER_CAP_ADD_MISMATCH";
  }
  if (fields[13] !== '["ALL"]') return "CONTAINER_CAP_DROP_MISMATCH";
  if (fields[14] !== "true") return "CONTAINER_ROOTFS_MODE_MISMATCH";
  if (fields[15] !== '["no-new-privileges=true"]') return "CONTAINER_SECURITY_OPT_MISMATCH";
  return undefined;
}

function ownedPersistenceContainer(result, { nonce, imageId, volumeName, ownedId, role, verifyProfile = false }) {
  if (result.status !== 0) throw failure("seaweed_candidate_runtime_persistence_cleanup_failed");
  const fields = result.stdout.trim().split("|");
  if (fields.length !== 16 || !CONTAINER_ID.test(fields[0]) || !/^(?:created|exited|running)$/u.test(fields[1])
    || !/^-?[0-9]+$/u.test(fields[2]) || fields[3] !== nonce || fields[4] !== PERSISTENCE_PURPOSE
    || fields[5] !== imageId || fields[6] !== "volume" || fields[7] !== volumeName || fields[8] !== "/data"
    || fields[9] !== "true" || fields[10] !== "true" || ownedId !== undefined && fields[0] !== ownedId) {
    throw failure("seaweed_candidate_runtime_persistence_cleanup_failed");
  }
  return { id: fields[0], state: fields[1], exitCode: fields[2],
    profileMismatch: verifyProfile ? persistenceProfileMismatch(fields, role) : undefined };
}

async function executePersistence(input, injected) {
  const started = performance.now();
  const startedAtMs = Date.now();
  const fail = (phase, reason, cleanup = false) => diagnosticFailure(cleanup
    ? "seaweed_candidate_runtime_persistence_cleanup_failed" : "seaweed_candidate_runtime_persistence_failed",
  phase, reason, started);
  if (!validInput(input)) throw fail("PERSISTENCE_CONTEXT", "INPUT_INVALID");
  const { parent, dockerConfig, imageId, runId, recipeRevision, signal } = input;
  if (process.platform !== "linux" && injected === undefined || typeof parent !== "string" || !path.isAbsolute(parent)
    || path.normalize(parent) !== parent || typeof dockerConfig !== "string" || !path.isAbsolute(dockerConfig)
    || path.normalize(dockerConfig) !== dockerConfig || !IMAGE_ID.test(imageId) || !RUN_ID.test(runId)
    || !REVISION.test(recipeRevision) || signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || signal?.aborted) throw fail("PERSISTENCE_CONTEXT", "INPUT_INVALID");
  const docker = injected?.docker ?? defaultDocker;
  if (typeof docker !== "function" || injected !== undefined && !exactObject(injected, ["docker"])) {
    throw fail("PERSISTENCE_CONTEXT", "INPUT_INVALID");
  }
  const prefix = `aw-seaweed-persistence-${runId}`;
  const volumeName = `${prefix}-data`;
  const roles = ["init", "service-1", "service-2"];
  const names = Object.fromEntries(roles.map((role) => [role, `${prefix}-${role}`]));
  const env = { PATH: process.env.PATH ?? "", DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: "unix:///var/run/docker.sock", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TMPDIR: parent };
  const options = { cwd: parent, env, signal, timeoutMs: COMMAND_TIMEOUT_MS };
  const cleanupOptions = { cwd: parent, env, timeoutMs: CLEANUP_TIMEOUT_MS };
  const nonce = randomBytes(24).toString("hex");
  const owned = new Map(); const attemptedRoles = new Set();
  let volumeCreateAttempted = false; let volumeCreated = false; let volumeCreatedAt; let primaryFailure;
  let phase = "PERSISTENCE_PRECHECK"; let reason = "DOCKER_COMMAND";
  let failurePhase; let failureReason;
  const mount = `type=volume,src=${volumeName},dst=/data,volume-nocopy`;

  async function createOwnedContainer(role, profile, script) {
    const name = names[role];
    attemptedRoles.add(role);
    const created = await command(docker, ["container", "create", "--name", name,
      "--label", `${OWNERSHIP_LABEL}=${nonce}`, "--label", `${PERSISTENCE_PURPOSE_LABEL}=${PERSISTENCE_PURPOSE}`,
      ...profile, "--mount", mount, imageId, "-c", script], options);
    const id = created.stdout.trim();
    if (!CONTAINER_ID.test(id)) throw failure("seaweed_candidate_runtime_persistence_failed");
    reason = "CONTAINER_IDENTITY_UNCERTAIN";
    const inspection = await inspectPersistenceContainer(docker, name, options);
    const inspected = ownedPersistenceContainer(inspection, { nonce, imageId, volumeName, ownedId: id });
    if (inspected.state !== "created" || inspected.exitCode !== "0") {
      throw failure("seaweed_candidate_runtime_persistence_failed");
    }
    reason = "CONTAINER_PROFILE_UNCERTAIN";
    const inspectedProfile = ownedPersistenceContainer(inspection,
      { nonce, imageId, volumeName, ownedId: id, role, verifyProfile: true });
    if (inspectedProfile.profileMismatch !== undefined) {
      reason = inspectedProfile.profileMismatch;
      throw failure("seaweed_candidate_runtime_persistence_failed");
    }
    owned.set(role, id);
    return name;
  }

  async function stopAndRemove(role, time) {
    const name = names[role]; const id = owned.get(role);
    let inspected = ownedPersistenceContainer(await inspectPersistenceContainer(docker, name, options),
      { nonce, imageId, volumeName, ownedId: id });
    if (inspected.state === "running") {
      await command(docker, ["container", "stop", "--time", String(time), name],
        { ...options, timeoutMs: (time + 10) * 1000 });
      inspected = ownedPersistenceContainer(await inspectPersistenceContainer(docker, name, options),
        { nonce, imageId, volumeName, ownedId: id });
    }
    if (inspected.state !== "exited" || inspected.exitCode !== "0") {
      throw failure("seaweed_candidate_runtime_persistence_failed");
    }
    await command(docker, ["container", "rm", name], options);
    if (!await containerAbsent(docker, name, options)) throw failure("seaweed_candidate_runtime_persistence_failed");
    owned.delete(role);
  }

  try {
    if (!await persistenceVolumeAbsent(docker, volumeName, options)) {
      reason = "VOLUME_NAME_OCCUPIED"; throw failure("seaweed_candidate_runtime_persistence_failed");
    }
    for (const role of roles) {
      if (!await containerAbsent(docker, names[role], options)) {
        reason = "CONTAINER_NAME_OCCUPIED"; throw failure("seaweed_candidate_runtime_persistence_failed");
      }
    }
    phase = "PERSISTENCE_VOLUME_CREATE"; reason = "VOLUME_CREATE_INVALID";
    volumeCreateAttempted = true;
    const volume = await command(docker, ["volume", "create", "--driver", "local",
      "--label", `${OWNERSHIP_LABEL}=${nonce}`, "--label", `${PERSISTENCE_PURPOSE_LABEL}=${PERSISTENCE_PURPOSE}`,
      volumeName], options);
    volumeCreated = true;
    if (volume.stdout.trim() !== volumeName || volume.stderr.trim() !== "") {
      throw failure("seaweed_candidate_runtime_persistence_failed");
    }
    reason = "VOLUME_IDENTITY_UNCERTAIN";
    volumeCreatedAt = ownedPersistenceVolume(await inspectPersistenceVolume(docker, volumeName, options),
      { name: volumeName, nonce, createdAfterMs: startedAtMs }).createdAt;

    phase = "PERSISTENCE_VOLUME_INIT"; reason = "CONTAINER_CREATE_INVALID";
    const initName = await createOwnedContainer("init", PERSISTENCE_INIT_PROFILE, PERSISTENCE_INIT_COMMAND);
    await command(docker, ["container", "start", initName], options);
    const waited = await command(docker, ["container", "wait", initName],
      { ...options, timeoutMs: 30_000 });
    if (waited.stdout.trim() !== "0" || waited.stderr.trim() !== "") {
      reason = "VOLUME_INIT_FAILED"; throw failure("seaweed_candidate_runtime_persistence_failed");
    }
    await stopAndRemove("init", 10);

    phase = "PERSISTENCE_SERVICE_ONE"; reason = "CONTAINER_CREATE_INVALID";
    const firstName = await createOwnedContainer("service-1", PERSISTENCE_SERVICE_PROFILE, BOOTSTRAP);
    await command(docker, ["container", "start", firstName], options);
    reason = "FIRST_WRITE_FAILED";
    const first = await command(docker, ["container", "exec", firstName, "/bin/sh", "-c", PERSISTENCE_FIRST_PROBE],
      { ...options, timeoutMs: 390_000 }, [0, 61, 62, 63, 64, 67, 68, 127]);
    if (first.status !== 0 || first.stdout.trim() !== "SEAWEED_PERSISTENCE_FIRST_WRITE_VERIFIED"
      || first.stderr.trim() !== "") throw failure("seaweed_candidate_runtime_persistence_failed");
    await stopAndRemove("service-1", 30);

    phase = "PERSISTENCE_SERVICE_TWO"; reason = "CONTAINER_CREATE_INVALID";
    const secondName = await createOwnedContainer("service-2", PERSISTENCE_SERVICE_PROFILE, BOOTSTRAP);
    await command(docker, ["container", "start", secondName], options);
    reason = "SECOND_READ_FAILED";
    const second = await command(docker, ["container", "exec", secondName, "/bin/sh", "-c", PERSISTENCE_SECOND_PROBE],
      { ...options, timeoutMs: 390_000 }, [0, 61, 62, 65, 66, 67, 68, 69, 127]);
    if (second.status !== 0) {
      reason = second.status === 65 ? "PERSISTED_OBJECT_MISSING"
        : second.status === 66 ? "PERSISTED_OBJECT_MISMATCH" : "SECOND_READ_FAILED";
      throw failure("seaweed_candidate_runtime_persistence_failed");
    }
    if (second.stdout.trim() !== "SEAWEED_PERSISTENCE_SECOND_READ_VERIFIED" || second.stderr.trim() !== "") {
      throw failure("seaweed_candidate_runtime_persistence_failed");
    }
    await stopAndRemove("service-2", 30);
  } catch (error) { primaryFailure = error; failurePhase = phase; failureReason = reason; }

  try {
    for (const role of attemptedRoles) {
      if (owned.has(role)) continue;
      const inspected = await inspectPersistenceContainer(docker, names[role], cleanupOptions, [0, 1]);
      if (inspected.status === 1 && inspected.stdout.trim() === "" && await containerAbsent(docker,
        names[role], cleanupOptions)) continue;
      owned.set(role, ownedPersistenceContainer(inspected, { nonce, imageId, volumeName }).id);
    }
    for (const role of [...roles].reverse()) {
      if (!owned.has(role)) continue;
      const name = names[role]; const id = owned.get(role);
      const observed = await inspectPersistenceContainer(docker, name, cleanupOptions, [0, 1]);
      if (observed.status === 1 && observed.stdout.trim() === ""
        && await containerAbsent(docker, name, cleanupOptions)) {
        owned.delete(role); continue;
      }
      let inspected = ownedPersistenceContainer(observed, { nonce, imageId, volumeName, ownedId: id });
      if (inspected.state === "running") {
        await command(docker, ["container", "stop", "--time", role === "init" ? "10" : "30", name],
          { ...cleanupOptions, timeoutMs: 40_000 });
        inspected = ownedPersistenceContainer(await inspectPersistenceContainer(docker, name, cleanupOptions),
          { nonce, imageId, volumeName, ownedId: id });
      }
      if (inspected.state !== "exited" && inspected.state !== "created") {
        throw failure("seaweed_candidate_runtime_persistence_cleanup_failed");
      }
      await command(docker, ["container", "rm", name], cleanupOptions);
      if (!await containerAbsent(docker, name, cleanupOptions)) {
        throw failure("seaweed_candidate_runtime_persistence_cleanup_failed");
      }
      owned.delete(role);
    }
    if (volumeCreateAttempted && !volumeCreated) {
      const inspected = await inspectPersistenceVolume(docker, volumeName, cleanupOptions, [0, 1]);
      if (!(inspected.status === 1 && inspected.stdout.trim() === ""
        && await persistenceVolumeAbsent(docker, volumeName, cleanupOptions))) {
        volumeCreatedAt = ownedPersistenceVolume(inspected,
          { name: volumeName, nonce, createdAfterMs: startedAtMs }).createdAt;
        volumeCreated = true;
      }
    }
    if (volumeCreated) {
      ownedPersistenceVolume(await inspectPersistenceVolume(docker, volumeName, cleanupOptions),
        { name: volumeName, nonce, createdAt: volumeCreatedAt });
      try {
        await command(docker, ["volume", "rm", volumeName], cleanupOptions);
      } catch {
        const remaining = await inspectPersistenceVolume(docker, volumeName, cleanupOptions, [0, 1]);
        if (remaining.status === 1 && remaining.stdout.trim() === ""
          && await persistenceVolumeAbsent(docker, volumeName, cleanupOptions)) {
          volumeCreated = false;
        } else {
          ownedPersistenceVolume(remaining, { name: volumeName, nonce, createdAt: volumeCreatedAt });
          throw failure("seaweed_candidate_runtime_persistence_cleanup_failed");
        }
      }
      if (!await persistenceVolumeAbsent(docker, volumeName, cleanupOptions)) {
        throw failure("seaweed_candidate_runtime_persistence_cleanup_failed");
      }
      volumeCreated = false;
    }
  } catch { throw fail("PERSISTENCE_CLEANUP", "CLEANUP_UNCERTAIN", true); }

  if (primaryFailure !== undefined) throw diagnosticFailure("seaweed_candidate_runtime_persistence_failed",
    failurePhase, failureReason, started);
  const proof = expectedPersistenceProof({ imageId, runId, recipeRevision });
  return validateSeaweedRuntimePersistenceProof(proof, { imageId, runId, recipeRevision });
}

export function verifyLocalSeaweedRuntimeRestartPersistence(input) { return executePersistence(input); }
export function TEST_ONLY_verifyLocalSeaweedRuntimeRestartPersistence(input, injected) {
  return executePersistence(input, injected);
}
export function TEST_ONLY_expectedSeaweedRuntimePersistenceProof(expected) {
  return validateSeaweedRuntimePersistenceProof(expectedPersistenceProof(expected), expected);
}
