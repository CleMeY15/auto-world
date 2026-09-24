import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const HEX = /^[0-9a-f]{64}$/u;
const MAX_OUTPUT_BYTES = 1024 ** 2;
const COMMAND_TIMEOUT_MS = 90_000;
const CLEANUP_TIMEOUT_MS = 60_000;
const OWNERSHIP_LABEL = "com.auto-world.runtime-nonce";
const PURPOSE_LABEL = "com.auto-world.runtime-purpose";
const ROLE_LABEL = "com.auto-world.runtime-role";
const PURPOSE = "backup-restore-v1";
const ACCESS_KEY = "AWDIAGNOSTICACCESS";
const SECRET_KEY = "aw-diagnostic-secret-not-for-production-0001";
const PAYLOAD = "auto-world-backup-restore-payload-v1";
const PAYLOAD_SHA256 = createHash("sha256").update(PAYLOAD).digest("hex");
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
const READY = `command -v curl >/dev/null 2>&1 || exit 81
command -v sha256sum >/dev/null 2>&1 && command -v mktemp >/dev/null 2>&1 || exit 81
test "$(awk '/^Uid:/ {print $2}' /proc/1/status)" = 1000 || exit 87
test "$(awk '/^Gid:/ {print $2}' /proc/1/status)" = 1000 || exit 87
test "$(awk '/^NoNewPrivs:/ {print $2}' /proc/1/status)" = 1 || exit 87
test "$(stat -c '%u:%g:%a' /data)" = '1000:1000:700' && test -w /data || exit 88
ready=''; i=0
while test "$i" -lt 60; do
  ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:9333/cluster/status || true)
  test "$ready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$ready" = 200 || exit 82
filerready=''; i=0
while test "$i" -lt 30; do
  filerready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8888/readyz || true)
  test "$filerready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$filerready" = 200 || exit 82
s3ready=''; i=0
while test "$i" -lt 30; do
  s3ready=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8333/readyz || true)
  test "$s3ready" = 200 && break
  i=$((i + 1)); sleep 1
done
test "$s3ready" = 200 || exit 82
curl --help all 2>/dev/null | grep -q -- '--aws-sigv4' || exit 81`;
const SOURCE_PROBE = `set -eu
${READY}
work=$(mktemp -d /tmp/aw-backup-source.XXXXXXXX) || exit 81
trap 'rm -f "$work/read"; rmdir "$work"' EXIT
signed() {
  curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 \\
    --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' "$@" 2>/dev/null
}
bucket=$(signed --request PUT http://127.0.0.1:8333/aw-raw) || exit 83
test "$bucket" = 200 || exit 83
put=$(signed --request PUT --header 'If-None-Match: *' --data-binary '${PAYLOAD}' \\
  http://127.0.0.1:8333/aw-raw/backup-proof) || exit 83
test "$put" = 200 || exit 83
read_status=$(curl --silent --output "$work/read" --write-out '%{http_code}' --max-time 10 \\
  --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' \\
  http://127.0.0.1:8333/aw-raw/backup-proof 2>/dev/null) || exit 83
test "$read_status" = 200 || exit 83
test "$(sha256sum "$work/read" | cut -d ' ' -f 1)" = '${PAYLOAD_SHA256}' || exit 84
printf '%s\\n' 'SEAWEED_BACKUP_SOURCE_WRITE_VERIFIED'`;
const RESTORED_PROBE = `set -eu
${READY}
work=$(mktemp -d /tmp/aw-backup-restored.XXXXXXXX) || exit 81
trap 'rm -f "$work/read"; rmdir "$work"' EXIT
read_status=$(curl --silent --output "$work/read" --write-out '%{http_code}' --max-time 10 \\
  --aws-sigv4 'aws:amz:us-east-1:s3' --user '${ACCESS_KEY}:${SECRET_KEY}' \\
  http://127.0.0.1:8333/aw-raw/backup-proof 2>/dev/null) || exit 89
case "$read_status" in 200) ;; 404) exit 85 ;; *) exit 89 ;; esac
test "$(sha256sum "$work/read" | cut -d ' ' -f 1)" = '${PAYLOAD_SHA256}' || exit 86
printf '%s\\n' 'SEAWEED_BACKUP_RESTORED_READ_VERIFIED'`;
const INIT_COMMAND = `set -eu
test "$(awk '/^NoNewPrivs:/ {print $2}' /proc/1/status)" = 1
entries=$(find /data -mindepth 1 -maxdepth 1 -print) || exit 1
test -z "$entries"
chmod 0700 /data
chown 1000:1000 /data
test "$(stat -c '%u:%g:%a' /data)" = '1000:1000:700'
printf '%s\\n' 'SEAWEED_BACKUP_VOLUME_INITIALIZED'`;
const BACKUP_COMMAND = `set -eu
umask 077
test "$(awk '/^Uid:/ {print $2}' /proc/1/status)" = 1000 || exit 91
test "$(awk '/^Gid:/ {print $2}' /proc/1/status)" = 1000 || exit 91
test "$(awk '/^NoNewPrivs:/ {print $2}' /proc/1/status)" = 1
command -v tar >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1 || exit 91
test -d /source && test -r /source && test -d /backup && test -w /backup
entries=$(find /backup -mindepth 1 -maxdepth 1 -print) || exit 91
test -z "$entries" || exit 92
tar -C /source -cf /backup/data.tar . || exit 93
test -f /backup/data.tar && test ! -L /backup/data.tar || exit 93
test "$(stat -c '%u:%g:%a' /backup/data.tar)" = '1000:1000:600' || exit 93
hash=$(sha256sum /backup/data.tar | cut -d ' ' -f 1)
bytes=$(wc -c < /backup/data.tar | tr -d ' ')
case "$hash" in *[!0-9a-f]*|'') exit 94 ;; esac
case "$bytes" in *[!0-9]*|'') exit 94 ;; esac
test "$bytes" -gt 0 || exit 94
printf 'SEAWEED_OFFLINE_BACKUP_VERIFIED|%s|%s\\n' "$hash" "$bytes"`;
const restoreCommand = (archiveSha256, archiveBytes) => `set -eu
test "$(awk '/^Uid:/ {print $2}' /proc/1/status)" = 1000 || exit 95
test "$(awk '/^Gid:/ {print $2}' /proc/1/status)" = 1000 || exit 95
test "$(awk '/^NoNewPrivs:/ {print $2}' /proc/1/status)" = 1
command -v tar >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1 || exit 95
test -f /backup/data.tar && test ! -L /backup/data.tar && test -d /restore && test -w /restore
test "$(stat -c '%u:%g:%a' /backup/data.tar)" = '1000:1000:600' || exit 96
test "$(sha256sum /backup/data.tar | cut -d ' ' -f 1)" = '${archiveSha256}' || exit 96
test "$(wc -c < /backup/data.tar | tr -d ' ')" = '${archiveBytes}' || exit 96
entries=$(find /restore -mindepth 1 -maxdepth 1 -print) || exit 95
test -z "$entries" || exit 97
tar -C /restore -xf /backup/data.tar || exit 98
test "$(stat -c '%u:%g:%a' /restore)" = '1000:1000:700' || exit 98
foreign=$(find /restore -mindepth 1 ! -user 1000 -print) || exit 98
test -z "$foreign" || exit 98
printf '%s\\n' 'SEAWEED_OFFLINE_RESTORE_VERIFIED'`;

const INIT_PROFILE = ["--pull=never", "--network=none", "--read-only", "--user=0:0",
  "--memory=128m", "--memory-swap=128m", "--cpus=.25", "--pids-limit=64", "--cap-drop=ALL",
  "--cap-add=CHOWN", "--security-opt=no-new-privileges=true", "--stop-timeout=10",
  "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=4m,mode=0700", "--entrypoint=/bin/sh"];
const HELPER_PROFILE = ["--pull=never", "--network=none", "--read-only", "--user=1000:1000",
  "--memory=256m", "--memory-swap=256m", "--cpus=.25", "--pids-limit=64", "--cap-drop=ALL",
  "--security-opt=no-new-privileges=true", "--stop-timeout=10",
  "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=8m,mode=0700",
  "--tmpfs", "/data:rw,nosuid,nodev,noexec,size=4m,mode=0700,uid=1000,gid=1000",
  "--entrypoint=/bin/sh"];
const SERVICE_PROFILE = ["--pull=never", "--network=none", "--read-only", "--user=1000:1000",
  "--memory=768m", "--memory-swap=768m", "--cpus=.75", "--pids-limit=512", "--cap-drop=ALL",
  "--security-opt=no-new-privileges=true", "--stop-timeout=30",
  "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000",
  "--tmpfs", "/run/aw-private:rw,nosuid,nodev,noexec,size=64k,mode=0700,uid=1000,gid=1000",
  "--entrypoint=/bin/sh"];

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const PROFILE_SHA256 = hash({ initializer: INIT_PROFILE, helper: HELPER_PROFILE, service: SERVICE_PROFILE,
  mounts: "SOURCE_RW_BACKUP_RW_THEN_BACKUP_RO_RESTORE_RW_ALL_VOLUME_NOCOPY" });
const COMMAND_SHA256 = hash([INIT_COMMAND, BOOTSTRAP, SOURCE_PROBE, BACKUP_COMMAND,
  "RESTORE_COMMAND_BOUND_TO_ARCHIVE_SHA256_AND_BYTES", RESTORED_PROBE]);
const PROOF_KEYS = ["kind", "state", "authority", "candidateAuthorization", "imageId", "runId",
  "recipeRevision", "profileSha256", "commandSha256", "sourceVolumeIdentity", "backupVolumeIdentity",
  "restoreVolumeIdentity", "sourceObject", "offlineBackup", "archiveSha256", "archiveBytes",
  "sourceDisposal", "restoreIsolation", "restoredObject", "shutdown", "cleanup"];

function failure(code) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED" });
}

function diagnosticFailure(code, phase, reason, started) {
  const error = failure(code); error.phase = phase; error.reason = reason;
  error.durationMs = Math.min(10_800_000, Math.max(0, Math.floor(performance.now() - started)));
  return error;
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
      if (bytes > MAX_OUTPUT_BYTES) throw failure("seaweed_candidate_runtime_backup_restore_failed");
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
    throw failure("seaweed_candidate_runtime_backup_restore_failed");
  }
  return { ...results[0].value, stdout: results[1].value, stderr: results[2].value };
}

async function command(docker, args, options, statuses = [0]) {
  if (options.signal?.aborted) throw failure("seaweed_candidate_runtime_backup_restore_failed");
  const result = await docker(args, options);
  if (!statuses.includes(result?.status) || typeof result.stdout !== "string" || typeof result.stderr !== "string"
    || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MAX_OUTPUT_BYTES) {
    throw failure("seaweed_candidate_runtime_backup_restore_failed");
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

async function volumeAbsent(docker, name, options) {
  const inspected = await command(docker, ["volume", "inspect", name], options, [0, 1]);
  if (inspected.status !== 1 || !["", "[]"].includes(inspected.stdout.trim())) return false;
  const listed = await command(docker, ["volume", "ls", "--filter", `name=^${name}$`, "--format", "{{.Name}}"], options);
  return listed.stderr.trim() === "" && listed.stdout.trim() === "";
}

async function containerAbsent(docker, name, options) {
  const inspected = await command(docker, ["container", "inspect", name], options, [0, 1]);
  if (inspected.status !== 1 || !["", "[]"].includes(inspected.stdout.trim())) return false;
  const listed = await command(docker, ["container", "ls", "--all", "--no-trunc", "--filter",
    `name=^/${name}$`, "--format", "{{.ID}}|{{.Names}}"], options);
  return listed.stderr.trim() === "" && listed.stdout.trim() === "";
}

function ownedVolume(result, expected) {
  const value = parseInspect(result, "seaweed_candidate_runtime_backup_restore_cleanup_failed");
  const createdAtMs = Date.parse(value.CreatedAt);
  if (value.Name !== expected.name || value.Driver !== "local" || value.Scope !== "local"
    || !Number.isFinite(createdAtMs) || expected.createdAfterMs !== undefined
      && (createdAtMs < expected.createdAfterMs - 5_000 || createdAtMs > Date.now() + 5_000)
    || expected.createdAt !== undefined && value.CreatedAt !== expected.createdAt
    || value.Labels?.[OWNERSHIP_LABEL] !== expected.nonce || value.Labels?.[PURPOSE_LABEL] !== PURPOSE
    || value.Labels?.[ROLE_LABEL] !== expected.role) {
    throw failure("seaweed_candidate_runtime_backup_restore_cleanup_failed");
  }
  return { createdAt: value.CreatedAt };
}

function normalizedCaps(value) { return value === null ? [] : value; }

function expectedTmpfs(role) {
  if (role.startsWith("service-")) return {
    "/tmp": "rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000",
    "/run/aw-private": "rw,nosuid,nodev,noexec,size=64k,mode=0700,uid=1000,gid=1000",
  };
  if (role.startsWith("init-")) return { "/tmp": "rw,nosuid,nodev,noexec,size=4m,mode=0700" };
  return { "/tmp": "rw,nosuid,nodev,noexec,size=8m,mode=0700",
    "/data": "rw,nosuid,nodev,noexec,size=4m,mode=0700,uid=1000,gid=1000" };
}

function sameTmpfs(actual, expected) {
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)
    || Object.keys(actual).sort().join("|") !== Object.keys(expected).sort().join("|")) return false;
  return Object.entries(expected).every(([destination, options]) => typeof actual[destination] === "string"
    && actual[destination].split(",").sort().join("|") === options.split(",").sort().join("|"));
}

function ownedContainer(result, expected) {
  const value = parseInspect(result, "seaweed_candidate_runtime_backup_restore_cleanup_failed");
  const role = expected.role; const profile = role.startsWith("service-") ? "service"
    : role.startsWith("init-") ? "init" : "helper";
  const expectedUser = profile === "init" ? "0:0" : "1000:1000";
  const expectedCapAdd = profile === "init" ? ["CAP_CHOWN"] : [];
  const mounts = Array.isArray(value.Mounts) ? value.Mounts : [];
  const hostMounts = Array.isArray(value.HostConfig?.Mounts) ? value.HostConfig.Mounts : [];
  const actualMounts = mounts.filter((mount) => mount.Type === "volume").map((mount) => ({ type: mount.Type, name: mount.Name,
    destination: mount.Destination, rw: mount.RW })).sort((a, b) => a.destination.localeCompare(b.destination));
  const expectedMounts = expected.mounts.map((mount) => ({ type: "volume", name: mount.name,
    destination: mount.destination, rw: !mount.readOnly })).sort((a, b) => a.destination.localeCompare(b.destination));
  const hostValid = expected.mounts.every((mount) => hostMounts.some((actual) => actual.Type === "volume"
    && actual.Source === mount.name && actual.Target === mount.destination
    && actual.ReadOnly === mount.readOnly && actual.VolumeOptions?.NoCopy === true));
  const memory = profile === "service" ? 768 * 1024 ** 2 : profile === "helper" ? 256 * 1024 ** 2 : 128 * 1024 ** 2;
  const nanoCpus = profile === "service" ? 750_000_000 : 250_000_000;
  const pids = profile === "service" ? 512 : 64;
  const verifyProfile = expected.verifyProfile !== false;
  const tmpfs = expectedTmpfs(role);
  const inspectTmpfsValid = mounts.filter((mount) => mount.Type !== "volume").every((mount) => mount.Type === "tmpfs"
    && Object.hasOwn(tmpfs, mount.Destination) && (mount.Source === "" || mount.Source === undefined)
    && mount.RW === true);
  const portBindings = value.HostConfig?.PortBindings;
  const ports = value.NetworkSettings?.Ports;
  const noPublishedPorts = (portBindings === null || typeof portBindings === "object"
      && !Array.isArray(portBindings) && Object.keys(portBindings).length === 0)
    && value.HostConfig?.PublishAllPorts === false
    && (ports === null || typeof ports === "object" && !Array.isArray(ports)
      && Object.values(ports).every((bindings) => bindings === null
        || Array.isArray(bindings) && bindings.length === 0));
  if (!CONTAINER_ID.test(value.Id ?? "") || expected.ownedId !== undefined && value.Id !== expected.ownedId
    || !["created", "running", "exited"].includes(value.State?.Status) || !Number.isInteger(value.State?.ExitCode)
    || value.Config?.Labels?.[OWNERSHIP_LABEL] !== expected.nonce
    || value.Config?.Labels?.[PURPOSE_LABEL] !== PURPOSE || value.Config?.Labels?.[ROLE_LABEL] !== role
    || value.Image !== expected.imageId
    || JSON.stringify(actualMounts) !== JSON.stringify(expectedMounts) || hostMounts.length !== expected.mounts.length
    || !hostValid || verifyProfile && (value.Config?.User !== expectedUser
      || value.HostConfig?.NetworkMode !== "none" || value.HostConfig?.ReadonlyRootfs !== true
      || value.HostConfig?.Privileged !== false || value.HostConfig?.AutoRemove !== false
      || !["", "no"].includes(value.HostConfig?.RestartPolicy?.Name)
      || value.HostConfig?.RestartPolicy?.MaximumRetryCount !== 0
      || !noPublishedPorts
      || JSON.stringify(value.HostConfig?.SecurityOpt) !== '["no-new-privileges=true"]'
      || JSON.stringify(normalizedCaps(value.HostConfig?.CapDrop)) !== '["ALL"]'
      || JSON.stringify(normalizedCaps(value.HostConfig?.CapAdd)) !== JSON.stringify(expectedCapAdd)
      || value.HostConfig?.Memory !== memory || value.HostConfig?.MemorySwap !== memory
      || value.HostConfig?.NanoCpus !== nanoCpus || value.HostConfig?.PidsLimit !== pids
      || !inspectTmpfsValid || !sameTmpfs(value.HostConfig?.Tmpfs, tmpfs))) {
    throw failure("seaweed_candidate_runtime_backup_restore_cleanup_failed");
  }
  return { id: value.Id, state: value.State.Status, exitCode: value.State.ExitCode };
}

async function inspectVolume(docker, name, options, statuses = [0]) {
  return command(docker, ["volume", "inspect", name], options, statuses);
}
async function inspectContainer(docker, name, options, statuses = [0]) {
  return command(docker, ["container", "inspect", name], options, statuses);
}

function expectedProof({ imageId, runId, recipeRevision, archiveSha256, archiveBytes }) {
  return Object.freeze({ kind: "SEAWEED_LOCAL_RUNTIME_BACKUP_RESTORE_PROOF_V1", state: "VERIFIED",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED", imageId, runId,
    recipeRevision, profileSha256: PROFILE_SHA256, commandSha256: COMMAND_SHA256,
    sourceVolumeIdentity: "FRESH_RUN_OWNED_LOCAL_VOLUME_VERIFIED",
    backupVolumeIdentity: "DISTINCT_FRESH_RUN_OWNED_LOCAL_VOLUME_VERIFIED",
    restoreVolumeIdentity: "DISTINCT_FRESH_RUN_OWNED_LOCAL_VOLUME_VERIFIED",
    sourceObject: "SIGNED_CONDITIONAL_PUT_GET_SHA256", offlineBackup: "STOPPED_SOURCE_TO_BACKUP_VOLUME",
    archiveSha256, archiveBytes, sourceDisposal: "SOURCE_CONTAINER_AND_VOLUME_ABSENT_BEFORE_RESTORE",
    restoreIsolation: "NO_NETWORK_HELPER_TO_FRESH_VOLUME", restoredObject: "SIGNED_GET_EXACT_SHA256",
    shutdown: "SOURCE_AND_RESTORED_SERVICES_BOUNDED", cleanup: "OWNED_CONTAINERS_AND_VOLUMES_REMOVED" });
}

export function validateSeaweedRuntimeBackupRestoreProof(proof, expected) {
  if (!exactObject(expected, ["imageId", "runId", "recipeRevision"]) || !IMAGE_ID.test(expected.imageId)
    || !RUN_ID.test(expected.runId) || !REVISION.test(expected.recipeRevision) || !exactObject(proof, PROOF_KEYS)
    || !HEX.test(proof.archiveSha256) || !Number.isSafeInteger(proof.archiveBytes)
    || proof.archiveBytes < 1 || proof.archiveBytes > 2 * 1024 ** 3) {
    throw failure("seaweed_candidate_runtime_backup_restore_failed");
  }
  const canonical = expectedProof({ ...expected, archiveSha256: proof.archiveSha256,
    archiveBytes: proof.archiveBytes });
  for (const key of PROOF_KEYS) if (proof[key] !== canonical[key]) {
    throw failure("seaweed_candidate_runtime_backup_restore_failed");
  }
  return canonical;
}

async function execute(input, injected) {
  const started = performance.now(); const startedAtMs = Date.now();
  const fail = (phase, reason, cleanup = false) => diagnosticFailure(cleanup
    ? "seaweed_candidate_runtime_backup_restore_cleanup_failed"
    : "seaweed_candidate_runtime_backup_restore_failed", phase, reason, started);
  if (!validInput(input)) throw fail("BACKUP_RESTORE_CONTEXT", "INPUT_INVALID");
  const { parent, dockerConfig, imageId, runId, recipeRevision, signal } = input;
  if (process.platform !== "linux" && injected === undefined || typeof parent !== "string" || !path.isAbsolute(parent)
    || path.normalize(parent) !== parent || typeof dockerConfig !== "string" || !path.isAbsolute(dockerConfig)
    || path.normalize(dockerConfig) !== dockerConfig || !IMAGE_ID.test(imageId) || !RUN_ID.test(runId)
    || !REVISION.test(recipeRevision) || signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || signal?.aborted) throw fail("BACKUP_RESTORE_CONTEXT", "INPUT_INVALID");
  const docker = injected?.docker ?? defaultDocker;
  if (typeof docker !== "function" || injected !== undefined && !exactObject(injected, ["docker"])) {
    throw fail("BACKUP_RESTORE_CONTEXT", "INPUT_INVALID");
  }
  const prefix = `aw-seaweed-backup-${runId}`;
  const volumeNames = { source: `${prefix}-source`, backup: `${prefix}-backup`, restore: `${prefix}-restore` };
  const containerRoles = ["init-source", "service-source", "init-backup", "backup-helper", "init-restore",
    "restore-helper", "service-restored"];
  const containerNames = Object.fromEntries(containerRoles.map((role) => [role, `${prefix}-${role}`]));
  const env = { PATH: process.env.PATH ?? "", DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: "unix:///var/run/docker.sock", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TMPDIR: parent };
  const options = { cwd: parent, env, signal, timeoutMs: COMMAND_TIMEOUT_MS };
  const cleanupOptions = { cwd: parent, env, timeoutMs: CLEANUP_TIMEOUT_MS };
  const nonce = randomBytes(24).toString("hex");
  const volumes = new Map(); const containers = new Map(); const attemptedVolumes = new Set();
  const attemptedContainers = new Set();
  let phase = "BACKUP_RESTORE_PRECHECK"; let reason = "DOCKER_COMMAND";
  let primaryFailure; let failurePhase; let failureReason; let archiveSha256; let archiveBytes;

  const volumeExpected = (role, extra = {}) => ({ name: volumeNames[role], role, nonce, ...extra });
  const containerMounts = (role) => {
    if (role === "init-source" || role === "service-source") {
      return [{ name: volumeNames.source, destination: "/data", readOnly: false }];
    }
    if (role === "init-backup") {
      return [{ name: volumeNames.backup, destination: "/data", readOnly: false }];
    }
    if (role === "backup-helper") return [
      { name: volumeNames.source, destination: "/source", readOnly: true },
      { name: volumeNames.backup, destination: "/backup", readOnly: false },
    ];
    if (role === "init-restore" || role === "service-restored") {
      return [{ name: volumeNames.restore, destination: "/data", readOnly: false }];
    }
    return [
      { name: volumeNames.backup, destination: "/backup", readOnly: true },
      { name: volumeNames.restore, destination: "/restore", readOnly: false },
    ];
  };

  async function createVolume(role) {
    const name = volumeNames[role]; attemptedVolumes.add(role);
    const created = await command(docker, ["volume", "create", "--driver", "local",
      "--label", `${OWNERSHIP_LABEL}=${nonce}`, "--label", `${PURPOSE_LABEL}=${PURPOSE}`,
      "--label", `${ROLE_LABEL}=${role}`, name], options);
    if (created.stdout.trim() !== name || created.stderr.trim() !== "") {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    const identity = ownedVolume(await inspectVolume(docker, name, options),
      volumeExpected(role, { createdAfterMs: startedAtMs }));
    volumes.set(role, identity);
  }

  async function createContainer(role, profile, script) {
    const name = containerNames[role]; const mounts = containerMounts(role); attemptedContainers.add(role);
    const mountArgs = mounts.flatMap((mount) => ["--mount", `type=volume,src=${mount.name},dst=${mount.destination},${mount.readOnly ? "readonly," : ""}volume-nocopy`]);
    const created = await command(docker, ["container", "create", "--name", name,
      "--label", `${OWNERSHIP_LABEL}=${nonce}`, "--label", `${PURPOSE_LABEL}=${PURPOSE}`,
      "--label", `${ROLE_LABEL}=${role}`, ...profile, ...mountArgs, imageId, "-c", script], options);
    const id = created.stdout.trim();
    if (!CONTAINER_ID.test(id)) throw failure("seaweed_candidate_runtime_backup_restore_failed");
    const inspected = ownedContainer(await inspectContainer(docker, name, options),
      { role, nonce, imageId, ownedId: id, mounts });
    if (inspected.state !== "created" || inspected.exitCode !== 0) {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    containers.set(role, id); return name;
  }

  async function waitAndRemove(role, expectedMarker, timeoutMs = 60_000) {
    const name = containerNames[role];
    await command(docker, ["container", "start", name], options);
    const waited = await command(docker, ["container", "wait", name], { ...options, timeoutMs });
    if (waited.stdout.trim() !== "0" || waited.stderr.trim() !== "") {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    const logs = await command(docker, ["container", "logs", name], options);
    if (logs.stderr.trim() !== "" || expectedMarker !== undefined && logs.stdout.trim() !== expectedMarker) {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    const inspected = ownedContainer(await inspectContainer(docker, name, options), {
      role, nonce, imageId, ownedId: containers.get(role), mounts: containerMounts(role),
    });
    if (inspected.state !== "exited" || inspected.exitCode !== 0) {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    await command(docker, ["container", "rm", name], options);
    if (!await containerAbsent(docker, name, options)) throw failure("seaweed_candidate_runtime_backup_restore_failed");
    containers.delete(role);
  }

  async function stopService(role) {
    const name = containerNames[role];
    let inspected = ownedContainer(await inspectContainer(docker, name, options), {
      role, nonce, imageId, ownedId: containers.get(role), mounts: containerMounts(role),
    });
    if (inspected.state === "running") {
      await command(docker, ["container", "stop", "--time", "30", name], { ...options, timeoutMs: 40_000 });
      inspected = ownedContainer(await inspectContainer(docker, name, options), {
        role, nonce, imageId, ownedId: containers.get(role), mounts: containerMounts(role),
      });
    }
    if (inspected.state !== "exited" || inspected.exitCode !== 0) {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    await command(docker, ["container", "rm", name], options);
    if (!await containerAbsent(docker, name, options)) throw failure("seaweed_candidate_runtime_backup_restore_failed");
    containers.delete(role);
  }

  async function removeVolume(role, currentOptions = options) {
    const expected = volumeExpected(role, { createdAt: volumes.get(role)?.createdAt });
    ownedVolume(await inspectVolume(docker, volumeNames[role], currentOptions), expected);
    await command(docker, ["volume", "rm", volumeNames[role]], currentOptions);
    if (!await volumeAbsent(docker, volumeNames[role], currentOptions)) {
      throw failure("seaweed_candidate_runtime_backup_restore_cleanup_failed");
    }
    volumes.delete(role);
  }

  try {
    for (const name of Object.values(volumeNames)) if (!await volumeAbsent(docker, name, options)) {
      reason = "VOLUME_NAME_OCCUPIED"; throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    for (const name of Object.values(containerNames)) if (!await containerAbsent(docker, name, options)) {
      reason = "CONTAINER_NAME_OCCUPIED"; throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }

    phase = "BACKUP_SOURCE_VOLUME"; reason = "VOLUME_CREATE_INVALID";
    await createVolume("source");
    await createContainer("init-source", INIT_PROFILE, INIT_COMMAND);
    await waitAndRemove("init-source", "SEAWEED_BACKUP_VOLUME_INITIALIZED");

    phase = "BACKUP_SOURCE_SERVICE"; reason = "SOURCE_WRITE_FAILED";
    const sourceService = await createContainer("service-source", SERVICE_PROFILE, BOOTSTRAP);
    await command(docker, ["container", "start", sourceService], options);
    const source = await command(docker, ["container", "exec", sourceService, "/bin/sh", "-c", SOURCE_PROBE],
      { ...options, timeoutMs: 390_000 }, [0, 81, 82, 83, 84, 87, 88, 127]);
    if (source.status !== 0 || source.stdout.trim() !== "SEAWEED_BACKUP_SOURCE_WRITE_VERIFIED"
      || source.stderr.trim() !== "") throw failure("seaweed_candidate_runtime_backup_restore_failed");
    reason = "SOURCE_STOP_FAILED";
    await stopService("service-source");

    phase = "BACKUP_ARCHIVE"; reason = "BACKUP_FAILED";
    await createVolume("backup");
    await createContainer("init-backup", INIT_PROFILE, INIT_COMMAND);
    await waitAndRemove("init-backup", "SEAWEED_BACKUP_VOLUME_INITIALIZED");
    await createContainer("backup-helper", HELPER_PROFILE, BACKUP_COMMAND);
    await command(docker, ["container", "start", containerNames["backup-helper"]], options);
    const backupWait = await command(docker, ["container", "wait", containerNames["backup-helper"]],
      { ...options, timeoutMs: 120_000 });
    if (backupWait.stdout.trim() !== "0" || backupWait.stderr.trim() !== "") {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    const backupLogs = await command(docker, ["container", "logs", containerNames["backup-helper"]], options);
    const matched = /^SEAWEED_OFFLINE_BACKUP_VERIFIED\|([0-9a-f]{64})\|([1-9][0-9]{0,18})\n?$/u.exec(backupLogs.stdout);
    archiveSha256 = matched?.[1]; archiveBytes = Number(matched?.[2]);
    if (backupLogs.stderr.trim() !== "" || !HEX.test(archiveSha256 ?? "")
      || !Number.isSafeInteger(archiveBytes) || archiveBytes < 1 || archiveBytes > 2 * 1024 ** 3) {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    const backupInspected = ownedContainer(await inspectContainer(docker, containerNames["backup-helper"], options), {
      role: "backup-helper", nonce, imageId, ownedId: containers.get("backup-helper"),
      mounts: containerMounts("backup-helper"),
    });
    if (backupInspected.state !== "exited" || backupInspected.exitCode !== 0) {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    await command(docker, ["container", "rm", containerNames["backup-helper"]], options);
    if (!await containerAbsent(docker, containerNames["backup-helper"], options)) {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    containers.delete("backup-helper");

    phase = "BACKUP_SOURCE_DISPOSAL"; reason = "SOURCE_DISPOSAL_FAILED";
    await removeVolume("source");
    if (!await containerAbsent(docker, containerNames["service-source"], options)
      || !await volumeAbsent(docker, volumeNames.source, options)) {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }

    phase = "BACKUP_RESTORE_VOLUME"; reason = "VOLUME_CREATE_INVALID";
    await createVolume("restore");
    await createContainer("init-restore", INIT_PROFILE, INIT_COMMAND);
    await waitAndRemove("init-restore", "SEAWEED_BACKUP_VOLUME_INITIALIZED");

    phase = "BACKUP_RESTORE_COPY"; reason = "RESTORE_FAILED";
    await createContainer("restore-helper", HELPER_PROFILE, restoreCommand(archiveSha256, archiveBytes));
    await waitAndRemove("restore-helper", "SEAWEED_OFFLINE_RESTORE_VERIFIED", 120_000);

    phase = "BACKUP_RESTORED_SERVICE"; reason = "RESTORED_READ_FAILED";
    const restoredService = await createContainer("service-restored", SERVICE_PROFILE, BOOTSTRAP);
    await command(docker, ["container", "start", restoredService], options);
    const restored = await command(docker, ["container", "exec", restoredService, "/bin/sh", "-c", RESTORED_PROBE],
      { ...options, timeoutMs: 390_000 }, [0, 81, 82, 85, 86, 87, 88, 89, 127]);
    if (restored.status !== 0) {
      reason = restored.status === 85 ? "RESTORED_OBJECT_MISSING"
        : restored.status === 86 ? "RESTORED_OBJECT_MISMATCH" : "RESTORED_READ_FAILED";
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    if (restored.stdout.trim() !== "SEAWEED_BACKUP_RESTORED_READ_VERIFIED" || restored.stderr.trim() !== "") {
      throw failure("seaweed_candidate_runtime_backup_restore_failed");
    }
    reason = "RESTORED_STOP_FAILED";
    await stopService("service-restored");
  } catch (error) { primaryFailure = error; failurePhase = phase; failureReason = reason; }

  let cleanupFailure;
  try {
    phase = "BACKUP_RESTORE_CLEANUP"; reason = "CLEANUP_UNCERTAIN";
    for (const role of [...attemptedContainers].reverse()) {
      const name = containerNames[role];
      if (await containerAbsent(docker, name, cleanupOptions)) { containers.delete(role); continue; }
      const inspected = ownedContainer(await inspectContainer(docker, name, cleanupOptions), {
        role, nonce, imageId, ...(containers.has(role) ? { ownedId: containers.get(role) } : {}),
        mounts: containerMounts(role), verifyProfile: false,
      });
      if (inspected.state === "running") {
        const time = role.startsWith("service-") ? 30 : 10;
        await command(docker, ["container", "stop", "--time", String(time), name],
          { ...cleanupOptions, timeoutMs: (time + 10) * 1000 });
        const stopped = ownedContainer(await inspectContainer(docker, name, cleanupOptions), {
          role, nonce, imageId, ...(containers.has(role) ? { ownedId: containers.get(role) } : {}),
          mounts: containerMounts(role), verifyProfile: false,
        });
        if (stopped.state !== "exited") {
          throw failure("seaweed_candidate_runtime_backup_restore_cleanup_failed");
        }
      } else if (inspected.state !== "created" && inspected.state !== "exited") {
        throw failure("seaweed_candidate_runtime_backup_restore_cleanup_failed");
      }
      await command(docker, ["container", "rm", name], cleanupOptions);
      if (!await containerAbsent(docker, name, cleanupOptions)) {
        throw failure("seaweed_candidate_runtime_backup_restore_cleanup_failed");
      }
      containers.delete(role);
    }
    for (const role of [...attemptedVolumes].reverse()) {
      if (await volumeAbsent(docker, volumeNames[role], cleanupOptions)) { volumes.delete(role); continue; }
      const createdAt = volumes.get(role)?.createdAt;
      if (createdAt === undefined) {
        ownedVolume(await inspectVolume(docker, volumeNames[role], cleanupOptions),
          volumeExpected(role, { createdAfterMs: startedAtMs }));
      } else {
        ownedVolume(await inspectVolume(docker, volumeNames[role], cleanupOptions),
          volumeExpected(role, { createdAt }));
      }
      await command(docker, ["volume", "rm", volumeNames[role]], cleanupOptions);
      if (!await volumeAbsent(docker, volumeNames[role], cleanupOptions)) {
        throw failure("seaweed_candidate_runtime_backup_restore_cleanup_failed");
      }
      volumes.delete(role);
    }
  } catch (error) { cleanupFailure = error; }
  if (cleanupFailure !== undefined && primaryFailure !== undefined) {
    const reported = fail(failurePhase, failureReason);
    reported.runtimeCleanupFailure = Object.freeze({
      code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
      phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN",
    });
    throw reported;
  }
  if (cleanupFailure !== undefined) throw fail("BACKUP_RESTORE_CLEANUP", "CLEANUP_UNCERTAIN", true);
  if (primaryFailure !== undefined) throw fail(failurePhase, failureReason);
  const proof = expectedProof({ imageId, runId, recipeRevision, archiveSha256, archiveBytes });
  return validateSeaweedRuntimeBackupRestoreProof(proof, { imageId, runId, recipeRevision });
}

export function verifyLocalSeaweedRuntimeBackupRestore(input) { return execute(input); }
export function TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input, injected) { return execute(input, injected); }
export function TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof(expected,
  archiveSha256 = "a".repeat(64), archiveBytes = 1024) {
  return validateSeaweedRuntimeBackupRestoreProof(expectedProof({ ...expected, archiveSha256, archiveBytes }), expected);
}
export function TEST_ONLY_seaweedBackupRestoreScripts() {
  return Object.freeze([INIT_COMMAND, BOOTSTRAP, SOURCE_PROBE, BACKUP_COMMAND,
    restoreCommand("a".repeat(64), 10240), RESTORED_PROBE]);
}
