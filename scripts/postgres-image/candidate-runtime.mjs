import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { validateDiagnosticLock } from "./diagnostic.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const HEX = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN = /^[1-9][0-9]{0,19}$/u;
const OWNER = "com.auto-world.postgres-runtime-nonce";
const PURPOSE = "com.auto-world.postgres-runtime-purpose";
const ROLE = "exact-remote-diagnostic";
const PGDATA = "/var/lib/postgresql/data";
const PAYLOAD = "auto-world-postgres-gosu-diagnostic-v1";
const PAYLOAD_SHA256 = createHash("sha256").update(PAYLOAD).digest("hex");
const CAPS = ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"];
const TMPFS = Object.freeze({ "/var/run/postgresql": "rw,nosuid,nodev,noexec,size=16777216,mode=0775",
  "/tmp": "rw,nosuid,nodev,noexec,size=67108864,mode=1777" });
const PROBE_TMPFS = Object.freeze({ [PGDATA]: "rw,nosuid,nodev,noexec,size=16777216,mode=0700" });
const PHASES = ["CONTEXT", "GOSU_PROBE", "VOLUME_CREATE", "SERVICE_ONE", "SERVICE_TWO", "CLEANUP"];
const OUTPUT_CAP = 1024 ** 2;
const COMMAND_MS = 90_000;
const CLEANUP_MS = 60_000;
const OPERATION_MS = 15 * 60_000;
const FAILURE_CODES = new Set([
  "postgres_runtime_aborted", "postgres_runtime_arguments_invalid", "postgres_runtime_before_execution_rejected",
  "postgres_runtime_cleanup_uncertain", "postgres_runtime_command_failed", "postgres_runtime_config_invalid",
  "postgres_runtime_context_invalid", "postgres_runtime_create_identity_invalid", "postgres_runtime_directory_invalid",
  "postgres_runtime_distinct_container_invalid", "postgres_runtime_expected_identity_invalid",
  "postgres_runtime_failed", "postgres_runtime_failure_diagnostic_invalid", "postgres_runtime_gosu_probe_invalid",
  "postgres_runtime_inspection_invalid", "postgres_runtime_lock_invalid", "postgres_runtime_name_occupied",
  "postgres_runtime_ownership_uncertain", "postgres_runtime_process_invalid", "postgres_runtime_profile_invalid",
  "postgres_runtime_randomness_invalid", "postgres_runtime_readback_invalid", "postgres_runtime_readiness_timeout",
  "postgres_runtime_receipt_invalid", "postgres_runtime_requires_nonroot_linux", "postgres_runtime_stop_invalid",
  "postgres_runtime_volume_identity_invalid",
]);

function fail(code) { throw Object.assign(new Error(code), { phase: "CONTEXT" }); }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype; }
function keys(value, expected) { return plain(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort()); }
function frozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozen(entry)])));
  return value;
}
export function validatePostgresRuntimeFailureDiagnostic(value) {
  if (!keys(value, ["code", "phase"]) || !FAILURE_CODES.has(value.code) || !PHASES.includes(value.phase)) {
    fail("postgres_runtime_failure_diagnostic_invalid");
  }
  return Object.freeze({ code: value.code, phase: value.phase });
}
export function postgresRuntimeFailureDiagnostic(error) {
  let code; let phase;
  try { code = error?.message; phase = error?.phase; } catch { /* Untrusted errors disclose no properties. */ }
  return Object.freeze({ code: FAILURE_CODES.has(code) ? code : "postgres_runtime_failed",
    phase: PHASES.includes(phase) ? phase : "CONTEXT" });
}
function runtimeFailure(error, phase) {
  const diagnostic = postgresRuntimeFailureDiagnostic(error);
  return Object.assign(new Error(diagnostic.code), { phase: PHASES.includes(phase) ? phase : diagnostic.phase });
}
function json(bytes) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("postgres_runtime_inspection_invalid"); }
}
function lockInputs() {
  try {
    return validateDiagnosticLock(JSON.parse(readFileSync(path.join(ROOT, "infra/postgres-image/lock.json"), "utf8")),
      readFileSync(path.join(ROOT, "infra/postgres-image/Dockerfile")));
  } catch { fail("postgres_runtime_lock_invalid"); }
}
function environment(values) {
  if (!Array.isArray(values) || values.length > 64) fail("postgres_runtime_config_invalid");
  const entries = new Map();
  for (const item of values) {
    if (typeof item !== "string" || item.length > 8192 || !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(item)) {
      fail("postgres_runtime_config_invalid");
    }
    const index = item.indexOf("="); const key = item.slice(0, index);
    if (entries.has(key)) fail("postgres_runtime_config_invalid");
    entries.set(key, item.slice(index + 1));
  }
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}
function expectedIdentity(value) {
  if (!keys(value, ["subject", "imageId", "diffIds", "runId", "recipeRevision"])
    || !DIGEST.test(value.imageId ?? "")
    || !/^ghcr\.io\/clemey15\/auto-world-postgres-gosu@sha256:[0-9a-f]{64}$/u.test(value.subject ?? "")
    || !RUN.test(value.runId ?? "") || !REVISION.test(value.recipeRevision ?? "")
    || !Array.isArray(value.diffIds) || value.diffIds.length !== 12 || value.diffIds.some((id) => !DIGEST.test(id))) {
    fail("postgres_runtime_expected_identity_invalid");
  }
  return frozen(globalThis.structuredClone(value));
}
function snapshotValue(value) {
  if (!keys(value, ["parent", "dockerConfig", "config", "imageId", "diffIds", "subject", "archiveProof",
    "runId", "recipeRevision", "signal"]) || !DIGEST.test(value.imageId ?? "")
    || !/^ghcr\.io\/clemey15\/auto-world-postgres-gosu@sha256:[0-9a-f]{64}$/u.test(value.subject ?? "")
    || !RUN.test(value.runId ?? "") || !REVISION.test(value.recipeRevision ?? "")
    || !Array.isArray(value.diffIds) || value.diffIds.length !== 12 || value.diffIds.some((id) => !DIGEST.test(id))
    || !plain(value.archiveProof) || value.archiveProof.imageId !== value.imageId
    || !isDeepStrictEqual(value.archiveProof.diffIds, value.diffIds)
    || !HEX.test(value.archiveProof.archiveSha256 ?? "") || !Number.isSafeInteger(value.archiveProof.archiveBytes)
    || value.archiveProof.archiveBytes < 1024 || value.archiveProof.archiveBytes > 1024 ** 3
    || !(value.signal instanceof globalThis.AbortSignal)
    || ![value.parent, value.dockerConfig].every((file) => typeof file === "string" && path.isAbsolute(file)
      && path.normalize(file) === file)
    || !value.dockerConfig.startsWith(`${value.parent}${path.sep}`)
    || !plain(value.config) || !isDeepStrictEqual(value.config.Entrypoint, ["docker-entrypoint.sh"])
    || !isDeepStrictEqual(value.config.Cmd, ["postgres"]) || !["", "0", "0:0"].includes(value.config.User)
    || environment(value.config.Env).PGDATA !== PGDATA || value.config.WorkingDir !== "/"
    || !plain(value.config.Volumes) || !isDeepStrictEqual(Object.keys(value.config.Volumes), [PGDATA])) {
    fail("postgres_runtime_context_invalid");
  }
  return Object.freeze({ ...value, config: frozen(globalThis.structuredClone(value.config)),
    diffIds: Object.freeze([...value.diffIds]), archiveProof: frozen(globalThis.structuredClone(value.archiveProof)) });
}
function directory(directoryPath, uid) {
  try {
    const info = lstatSync(directoryPath);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o777) !== 0o700
      || realpathSync(directoryPath) !== directoryPath) fail("postgres_runtime_directory_invalid");
    return info;
  } catch { fail("postgres_runtime_directory_invalid"); }
}
function defaultRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: null,
    timeout: options.timeoutMs, maxBuffer: options.maxBuffer, signal: options.signal, windowsHide: true });
}
function transport(result, permitted = [0]) {
  if (!plain(result) || result.error || result.signal || !Number.isInteger(result.status)
    || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)
    || result.stdout.length > OUTPUT_CAP || result.stderr.length > OUTPUT_CAP
    || !permitted.includes(result.status)) fail("postgres_runtime_command_failed");
  return result;
}
function absent(result, kind, name) {
  if (result.status !== 1 || !["", "[]"].includes(result.stdout.toString("utf8").trim())) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return (kind === "container"
    ? new RegExp(`^(?:Error: No such (?:object|container): |Error response from daemon: No such container: )${escaped}$`, "u")
    : new RegExp(`^Error response from daemon: get ${escaped}: no such volume$`, "u"))
    .test(result.stderr.toString("utf8").trim());
}
function empty(value) { return value === null || value === undefined || Array.isArray(value) && value.length === 0; }
function mapEmpty(value) { return value === null || plain(value) && Object.keys(value).length === 0; }
function equalCaps(value, expected) { return Array.isArray(value)
  && isDeepStrictEqual([...value].sort(), [...expected].sort()); }
function identity(value, record, nonce, imageId) {
  if (!plain(value) || value.Name !== `/${record.name}` || !HEX.test(value.Id ?? "")
    || record.id !== null && value.Id !== record.id || value.Image !== imageId
    || value.Config?.Labels?.[OWNER] !== nonce || value.Config?.Labels?.[PURPOSE] !== ROLE) {
    fail("postgres_runtime_ownership_uncertain");
  }
  return value;
}
function volumeIdentity(value, name, nonce, at, createdAt) {
  const created = Date.parse(value?.CreatedAt ?? "");
  if (!plain(value) || value.Name !== name || value.Driver !== "local" || value.Scope !== "local"
    || !mapEmpty(value.Options) || !isDeepStrictEqual(value.Labels, { [OWNER]: nonce, [PURPOSE]: ROLE })
    || typeof value.Mountpoint !== "string" || !path.isAbsolute(value.Mountpoint)
    || !Number.isFinite(created) || created > at || created < at - OPERATION_MS
    || createdAt !== undefined && value.CreatedAt !== createdAt) fail("postgres_runtime_volume_identity_invalid");
  return value;
}
function profile(value, record, snapshot, nonce, expectedEnv, lock, volume) {
  identity(value, record, nonce, snapshot.imageId);
  const probe = record.role === "probe"; const host = value.HostConfig; const config = value.Config;
  const tmpfs = probe ? PROBE_TMPFS : TMPFS;
  const capabilities = probe ? ["SETGID", "SETUID"] : CAPS;
  const labels = { ...(snapshot.config.Labels ?? {}), [OWNER]: nonce, [PURPOSE]: ROLE };
  if (!plain(host) || !plain(config) || !isDeepStrictEqual(config.Labels, labels)
    || config.Image !== snapshot.imageId || config.User !== snapshot.config.User
    || config.WorkingDir !== snapshot.config.WorkingDir || !isDeepStrictEqual(environment(config.Env), expectedEnv)
    || !isDeepStrictEqual(config.Entrypoint, probe ? ["/bin/sh"] : snapshot.config.Entrypoint)
    || !isDeepStrictEqual(config.Cmd, probe ? record.command : snapshot.config.Cmd)
    || host.Privileged !== false || host.NetworkMode !== "none" || host.ReadonlyRootfs !== true
    || host.RestartPolicy?.Name !== "no" || host.RestartPolicy?.MaximumRetryCount !== 0
    || !equalCaps(host.CapDrop, ["ALL"]) || !equalCaps(host.CapAdd, capabilities.map((cap) => `CAP_${cap}`))
    || !equalCaps(host.SecurityOpt, ["no-new-privileges=true"])
    || host.Memory !== (probe ? 134217728 : lock.limits.memoryBytes) || host.MemorySwap !== host.Memory
    || host.NanoCpus !== (probe ? 500000000 : lock.limits.nanoCpus) || host.PidsLimit !== (probe ? 64 : lock.limits.pids)
    || host.ShmSize !== (probe ? 67108864 : lock.limits.shmBytes) || !isDeepStrictEqual(host.Tmpfs, tmpfs)
    || !empty(host.Binds) || !empty(host.Devices) || !empty(host.DeviceRequests)
    || !empty(host.DeviceCgroupRules) || !empty(host.VolumesFrom) || !empty(host.Links)
    || !empty(host.ExtraHosts) || !mapEmpty(host.PortBindings) || host.PublishAllPorts !== false
    || host.PidMode !== "" || host.IpcMode !== "private" || host.UTSMode !== "" || host.UsernsMode !== ""
    || host.CgroupnsMode !== "private" || host.ContainerIDFile !== "" || host.Runtime !== "runc"
    || !Array.isArray(value.Mounts)) fail("postgres_runtime_profile_invalid");
  const configured = host.Mounts ?? [];
  if (probe ? configured.length !== 0 : !Array.isArray(configured) || configured.length !== 1
    || configured[0]?.Type !== "volume" || configured[0]?.Source !== volume.Name
    || configured[0]?.Target !== PGDATA || ![undefined, false].includes(configured[0]?.ReadOnly)
    || configured[0]?.VolumeOptions?.NoCopy !== true) fail("postgres_runtime_profile_invalid");
  const destinations = new Set(); let volumeCount = 0;
  for (const mount of value.Mounts) {
    if (!plain(mount) || destinations.has(mount.Destination) || mount.RW !== true) fail("postgres_runtime_profile_invalid");
    destinations.add(mount.Destination);
    if (mount.Type === "tmpfs" && Object.hasOwn(tmpfs, mount.Destination) && !mount.Name
      && [undefined, ""].includes(mount.Source)) continue;
    if (!probe && mount.Type === "volume" && mount.Name === volume.Name && mount.Destination === PGDATA
      && mount.Source === volume.Mountpoint && mount.Driver === "local") { volumeCount += 1; continue; }
    fail("postgres_runtime_profile_invalid");
  }
  if (volumeCount !== (probe ? 0 : 1)) fail("postgres_runtime_profile_invalid");
}
function processStatusProof(bytes, lock) {
  const match = /^uid=([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+)\ngid=([0-9]+) ([0-9]+) ([0-9]+) ([0-9]+)\nnnp=([01])\n?$/u
    .exec(bytes.toString("utf8"));
  const uid = match?.slice(1, 5).map(Number); const gid = match?.slice(5, 9).map(Number);
  if (!match || match[9] !== "1") fail("postgres_runtime_process_invalid");
  // Root prepares the directories before gosu reexecutes the bash entrypoint as UID 70.
  // UID 70 can read status during root setup, but cannot reliably read the root exe link.
  if (uid.every((id) => id === 0) && gid.every((id) => id === 0)) return null;
  if (uid.some((id) => id !== lock.runtime.postgresUid) || gid.some((id) => id !== lock.runtime.postgresGid)
  ) fail("postgres_runtime_process_invalid");
  return { uid, gid, noNewPrivs: 1 };
}
function probeCommand(lock) {
  return ["-ec", [
    `test ! -e ${lock.runtime.removedPath}`,
    `test "$(command -v gosu)" = ${lock.runtime.gosuPath}`,
    `test "$(sha256sum ${lock.runtime.gosuPath} | cut -d ' ' -f 1)" = '${lock.apk.executable.sha256}'`,
    `${lock.runtime.gosuPath} --version`,
    `${lock.runtime.gosuPath} postgres /bin/sh -ec 'apk info --quiet -e "gosu=${lock.apk.version}" >/dev/null; printf "uid=%s\\ngid=%s\\nnnp=%s\\n" "$(id -u)" "$(id -g)" "$(sed -n "s/^NoNewPrivs:[[:space:]]*//p" /proc/self/status)"'`,
  ].join("; ")];
}
function baseArguments(record, snapshot, nonce, lock) {
  const probe = record.role === "probe";
  return ["create", "--name", record.name, "--pull=never", "--label", `${OWNER}=${nonce}`,
    "--label", `${PURPOSE}=${ROLE}`, "--network", "none", "--read-only", "--restart", "no", "--cap-drop", "ALL",
    "--ipc", "private", "--cgroupns", "private", "--runtime", "runc",
    ...(probe ? ["SETGID", "SETUID"] : CAPS).flatMap((capability) => ["--cap-add", capability]),
    "--security-opt", "no-new-privileges=true", "--memory", String(probe ? 134217728 : lock.limits.memoryBytes),
    "--memory-swap", String(probe ? 134217728 : lock.limits.memorySwapBytes), "--cpus", String(probe ? 0.5 : lock.limits.nanoCpus / 1e9),
    "--pids-limit", String(probe ? 64 : lock.limits.pids), "--shm-size", String(probe ? 67108864 : lock.limits.shmBytes), "--stop-timeout", "30",
    ...Object.entries(probe ? PROBE_TMPFS : TMPFS).flatMap(([destination, options]) => ["--tmpfs", `${destination}:${options}`])];
}

export function validatePostgresCandidateRuntimeReceipt(value, identityInput) {
  const snapshot = expectedIdentity(identityInput); const lock = lockInputs();
  const processValid = (item) => keys(item, ["containerId", "uid", "gid", "noNewPrivs", "executable", "readiness", "readback", "stop"])
    && HEX.test(item.containerId ?? "") && isDeepStrictEqual(item.uid, Array(4).fill(lock.runtime.postgresUid))
    && isDeepStrictEqual(item.gid, Array(4).fill(lock.runtime.postgresGid)) && item.noNewPrivs === 1
    && /^\/[^\s]{1,255}\/postgres$/u.test(item.executable ?? "") && item.readiness === "PASSED"
    && item.readback === "VERIFIED" && item.stop === "GRACEFUL";
  if (!keys(value, ["kind", "state", "authority", "admission", "supportStartedAt", "supportEndsAt", "archiveUntil",
    "subject", "imageId", "diffIds", "runId", "recipeRevision", "gosu", "persistence", "cleanup", "phases"])
    || value.kind !== "POSTGRES_CANDIDATE_RUNTIME_RECEIPT_V1" || value.state !== "VERIFIED"
    || value.authority !== "DIAGNOSTIC_ONLY" || value.admission !== "NOT_AUTHORIZED"
    || value.supportStartedAt !== null || value.supportEndsAt !== null || value.archiveUntil !== null
    || value.subject !== snapshot.subject || value.imageId !== snapshot.imageId
    || !isDeepStrictEqual(value.diffIds, snapshot.diffIds) || value.runId !== snapshot.runId
    || value.recipeRevision !== snapshot.recipeRevision
    || !keys(value.gosu, ["containerId", "version", "package", "uid", "gid", "noNewPrivs", "path", "removedPath", "executableSha256"])
    || !HEX.test(value.gosu.containerId ?? "") || value.gosu.version !== lock.apk.versionOutput
    || value.gosu.package !== lock.apk.version || value.gosu.uid !== lock.runtime.postgresUid
    || value.gosu.gid !== lock.runtime.postgresGid || value.gosu.noNewPrivs !== 1
    || value.gosu.path !== lock.runtime.gosuPath || value.gosu.removedPath !== lock.runtime.removedPath
    || value.gosu.executableSha256 !== lock.apk.executable.sha256
    || !keys(value.persistence, ["payloadSha256", "volume", "first", "second"])
    || value.persistence.payloadSha256 !== lock.runtime.payloadSha256 || !keys(value.persistence.volume, ["name", "createdAt"])
    || !/^aw-pg-runtime-[0-9a-f]{24}-data$/u.test(value.persistence.volume.name ?? "")
    || !Number.isFinite(Date.parse(value.persistence.volume.createdAt ?? ""))
    || !processValid(value.persistence.first) || !processValid(value.persistence.second)
    || new Set([value.gosu.containerId, value.persistence.first.containerId, value.persistence.second.containerId]).size !== 3
    || !keys(value.cleanup, ["containers", "volume", "temporary"])
    || !Array.isArray(value.cleanup.containers) || value.cleanup.containers.length !== 3
    || value.cleanup.containers.some((entry) => !keys(entry, ["id", "state"]) || entry.state !== "REMOVED")
    || !isDeepStrictEqual(value.cleanup.containers.map((entry) => entry.id),
      [value.gosu.containerId, value.persistence.first.containerId, value.persistence.second.containerId])
    || !keys(value.cleanup.volume, ["name", "state"]) || value.cleanup.volume.state !== "REMOVED"
    || value.cleanup.volume.name !== value.persistence.volume.name || value.cleanup.temporary !== "REMOVED"
    || !Array.isArray(value.phases) || value.phases.length !== PHASES.length
    || value.phases.some((entry, index) => !keys(entry, ["name", "result", "durationMs"])
      || entry.name !== PHASES[index] || entry.result !== "PASSED" || !Number.isSafeInteger(entry.durationMs)
      || entry.durationMs < 0 || entry.durationMs > OPERATION_MS)) fail("postgres_runtime_receipt_invalid");
  return frozen(globalThis.structuredClone(value));
}

export async function executePostgresCandidateRuntime(snapshotInput, controls, dependencies = {}) {
  const snapshot = snapshotValue(snapshotInput);
  if (!keys(controls, ["beforeExecution"]) || typeof controls.beforeExecution !== "function" || !plain(dependencies)
    || Object.keys(dependencies).some((key) => !["runner", "now", "sleep", "randomBytes", "platform", "uid"].includes(key))
    || Object.entries(dependencies).some(([key, value]) => !["platform", "uid"].includes(key) && typeof value !== "function")) {
    fail("postgres_runtime_arguments_invalid");
  }
  const uid = dependencies.uid ?? process.getuid?.();
  if ((dependencies.platform ?? process.platform) !== "linux" || !Number.isSafeInteger(uid) || uid < 1) {
    fail("postgres_runtime_requires_nonroot_linux");
  }
  directory(snapshot.parent, uid); directory(snapshot.dockerConfig, uid);
  const lock = lockInputs(); const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)));
  const randomness = dependencies.randomBytes ?? randomBytes;
  const nonce = randomness(12).toString("hex");
  if (!/^[0-9a-f]{24}$/u.test(nonce)) fail("postgres_runtime_randomness_invalid");
  const work = path.join(snapshot.parent, `runtime-${snapshot.runId}-${nonce}`);
  mkdirSync(work, { mode: 0o700 }); const workIdentity = directory(work, uid);
  const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
    DOCKER_CONFIG: snapshot.dockerConfig, TMPDIR: work };
  const runner = dependencies.runner ?? defaultRunner;
  const started = now(); const phases = []; const owned = new Map(); const removed = [];
  let volume; let volumeAttempted = false; let passwordFile; let passwordIdentity;
  let gosu; let first; let second; let primaryFailure; let volumeProof; let activePhase = "CONTEXT";
  const volumeName = `aw-pg-runtime-${nonce}-data`;
  const record = async (name, action) => {
    activePhase = name;
    const at = now(); let result;
    try { result = await action(); } catch (error) { throw runtimeFailure(error, name); }
    phases.push({ name, result: "PASSED", durationMs: Math.max(0, now() - at) }); return result;
  };
  const invoke = async (args, allowed = [0], cleanup = false, timeoutMs = COMMAND_MS) => {
    if (!cleanup && (snapshot.signal.aborted || now() - started >= OPERATION_MS)) fail("postgres_runtime_aborted");
    return transport(await runner("/usr/bin/docker", args, { cwd: work, env,
      timeoutMs: cleanup ? CLEANUP_MS : Math.max(1, Math.min(timeoutMs, OPERATION_MS - (now() - started))),
      maxBuffer: OUTPUT_CAP, signal: cleanup ? undefined : snapshot.signal }), allowed);
  };
  const inspect = async (kind, name, cleanup = false) => invoke([kind, "inspect", "--format", "{{json .}}", name], [0, 1], cleanup);
  const requireAbsent = async (kind, name) => {
    const result = await inspect(kind, name);
    if (result.status === 0) fail("postgres_runtime_name_occupied");
    if (!absent(result, kind, name)) fail("postgres_runtime_inspection_invalid");
  };
  const before = async () => {
    try { await controls.beforeExecution(); } catch { fail("postgres_runtime_before_execution_rejected"); }
    if (snapshot.signal.aborted) fail("postgres_runtime_aborted");
  };
  const create = async (role, args, command) => {
    const entry = { role, name: `aw-pg-runtime-${nonce}-${role}`, id: null, command };
    await requireAbsent("container", entry.name); await before(); owned.set(entry.name, entry);
    const id = (await invoke(args(entry))).stdout.toString("utf8").trim();
    if (!HEX.test(id)) fail("postgres_runtime_create_identity_invalid");
    entry.id = id;
    if ([...owned.values()].filter((item) => item.id === id).length !== 1 || removed.some((item) => item.id === id)) {
      fail("postgres_runtime_distinct_container_invalid");
    }
    return entry;
  };
  const removeContainer = async (entry, force) => {
    const observed = await inspect("container", entry.name, true);
    if (absent(observed, "container", entry.name)) { owned.delete(entry.name); return; }
    const value = identity(json(observed.stdout), entry, nonce, snapshot.imageId);
    if (!force && (value.State?.Status !== "exited" || value.State?.ExitCode !== 0)) fail("postgres_runtime_stop_invalid");
    await invoke(["container", "rm", ...(force ? ["--force"] : []), value.Id], [0], true);
    if (!absent(await inspect("container", entry.name, true), "container", entry.name)) fail("postgres_runtime_cleanup_uncertain");
    owned.delete(entry.name); removed.push({ id: value.Id, state: "REMOVED" });
  };
  const start = async (entry, attach = false) => { await before();
    return invoke(["start", ...(attach ? ["--attach"] : []), entry.id]); };
  try {
    await record("CONTEXT", async () => {
      const listed = await invoke(["ps", "-aq", "--filter", `label=${OWNER}=${nonce}`]);
      const volumes = await invoke(["volume", "ls", "-q", "--filter", `label=${OWNER}=${nonce}`]);
      if (listed.stdout.toString("utf8").trim() || volumes.stdout.toString("utf8").trim()) fail("postgres_runtime_name_occupied");
    });
    const expectedEnv = environment(snapshot.config.Env);
    await record("GOSU_PROBE", async () => {
      const command = probeCommand(lock);
      const entry = await create("probe", (item) => [...baseArguments(item, snapshot, nonce, lock), "--entrypoint", "/bin/sh",
        snapshot.imageId, ...command], command);
      profile(json((await inspect("container", entry.name)).stdout), entry, snapshot, nonce, expectedEnv, lock);
      const result = await start(entry, true);
      if (result.stdout.toString("utf8").trim() !== `${lock.apk.versionOutput}\nuid=${lock.runtime.postgresUid}\ngid=${lock.runtime.postgresGid}\nnnp=1`) {
        fail("postgres_runtime_gosu_probe_invalid");
      }
      gosu = { containerId: entry.id, version: lock.apk.versionOutput, package: lock.apk.version,
        uid: lock.runtime.postgresUid, gid: lock.runtime.postgresGid, noNewPrivs: 1,
        path: lock.runtime.gosuPath, removedPath: lock.runtime.removedPath, executableSha256: lock.apk.executable.sha256 };
      await removeContainer(entry, false);
    });
    await record("VOLUME_CREATE", async () => {
      await requireAbsent("volume", volumeName); await before(); volumeAttempted = true;
      const result = await invoke(["volume", "create", "--driver", "local", "--label", `${OWNER}=${nonce}`,
        "--label", `${PURPOSE}=${ROLE}`, volumeName]);
      if (result.stdout.toString("utf8").trim() !== volumeName) fail("postgres_runtime_volume_identity_invalid");
      volume = volumeIdentity(json((await inspect("volume", volumeName)).stdout), volumeName, nonce, now());
      volumeProof = { name: volumeName, createdAt: volume.CreatedAt };
    });
    const password = randomness(32).toString("hex");
    if (!HEX.test(password)) fail("postgres_runtime_randomness_invalid");
    passwordFile = path.join(work, "postgres.env");
    const handle = openSync(passwordFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { fchmodSync(handle, 0o600); writeFileSync(handle, `POSTGRES_PASSWORD=${password}\nPOSTGRES_USER=awdiag\nPOSTGRES_DB=awdiag\n`);
      passwordIdentity = fstatSync(handle); } finally { closeSync(handle); }
    const serviceEnv = Object.fromEntries(Object.entries({ ...expectedEnv, POSTGRES_PASSWORD: password,
      POSTGRES_USER: "awdiag", POSTGRES_DB: "awdiag" }).sort(([left], [right]) => left.localeCompare(right)));
    const service = async (role, write) => {
      const entry = await create(role, (item) => [...baseArguments(item, snapshot, nonce, lock), "--env-file", passwordFile,
        "--mount", `type=volume,src=${volumeName},dst=${PGDATA},volume-nocopy`, snapshot.imageId]);
      volumeIdentity(json((await inspect("volume", volumeName)).stdout), volumeName, nonce, now(), volume.CreatedAt);
      profile(json((await inspect("container", entry.name)).stdout), entry, snapshot, nonce, serviceEnv, lock, volume);
      await start(entry);
      const script = "awk '/^Uid:/{print \"uid=\"$2\" \"$3\" \"$4\" \"$5}/^Gid:/{print \"gid=\"$2\" \"$3\" \"$4\" \"$5}/^NoNewPrivs:/{print \"nnp=\"$2}' /proc/1/status";
      const user = `${lock.runtime.postgresUid}:${lock.runtime.postgresGid}`;
      const deadline = now() + lock.limits.readinessTimeoutMs; let observed;
      while (now() < deadline) {
        const result = await invoke(["exec", entry.id, "pg_isready", "--username", "awdiag", "--dbname", "awdiag", "--quiet"],
          [0, 1, 2], false, deadline - now());
        if (result.status === 0 && now() < deadline) {
          observed = processStatusProof((await invoke(["exec", "--user", user, entry.id, "/bin/sh", "-ec", script],
            [0], false, deadline - now())).stdout, lock);
          if (observed) {
            const executable = (await invoke(["exec", "--user", user, entry.id, "/bin/sh", "-ec", "readlink /proc/1/exe"],
              [0], false, deadline - now())).stdout.toString("utf8").trim();
            if (["/bin/bash", "/usr/bin/bash"].includes(executable)) observed = undefined;
            else {
              if (!/^\/[^\s]{1,255}\/postgres$/u.test(executable)) fail("postgres_runtime_process_invalid");
              observed = { ...observed, executable };
            }
          }
          if (observed && now() < deadline) break;
          observed = undefined;
        }
        await sleep(1000);
      }
      if (!observed) fail("postgres_runtime_readiness_timeout");
      const psql = ["exec", "--user", user, entry.id, "psql", "--username", "awdiag", "--dbname", "awdiag",
        "--no-psqlrc", "--set", "ON_ERROR_STOP=1"];
      if (write) await invoke([...psql, "--command", `CREATE TABLE diagnostic_payload (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO diagnostic_payload VALUES (1, '${PAYLOAD}');`]);
      const read = await invoke([...psql, "--tuples-only", "--no-align", "--command", "SELECT payload FROM diagnostic_payload WHERE id = 1;"]);
      if (read.stdout.toString("utf8").trim() !== PAYLOAD) fail("postgres_runtime_readback_invalid");
      await invoke(["stop", "--time", "30", entry.id]); await removeContainer(entry, false);
      return { containerId: entry.id, ...observed, readiness: "PASSED", readback: "VERIFIED", stop: "GRACEFUL" };
    };
    first = await record("SERVICE_ONE", () => service("one", true));
    second = await record("SERVICE_TWO", () => service("two", false));
  } catch (error) { primaryFailure = runtimeFailure(error, activePhase); }
  let cleanupFailure;
  try {
    await record("CLEANUP", async () => {
      let uncertain = false;
      for (const entry of [...owned.values()].reverse()) {
        try { await removeContainer(entry, true); } catch { uncertain = true; }
      }
      if (volumeAttempted) {
        try {
          const inspected = await inspect("volume", volumeName, true);
          if (!absent(inspected, "volume", volumeName)) {
            volumeIdentity(json(inspected.stdout), volumeName, nonce, now(), volume?.CreatedAt);
            await invoke(["volume", "rm", volumeName], [0], true);
            if (!absent(await inspect("volume", volumeName, true), "volume", volumeName)) uncertain = true;
          }
        } catch { uncertain = true; }
      }
      for (const args of [["ps", "-aq", "--filter", `label=${OWNER}=${nonce}`],
        ["volume", "ls", "-q", "--filter", `label=${OWNER}=${nonce}`]]) {
        try { if ((await invoke(args, [0], true)).stdout.toString("utf8").trim()) uncertain = true; }
        catch { uncertain = true; }
      }
      const current = directory(work, uid);
      if (current.dev !== workIdentity.dev || current.ino !== workIdentity.ino) uncertain = true;
      if (passwordIdentity) {
        const file = lstatSync(passwordFile);
        if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.uid !== uid
          || file.dev !== passwordIdentity.dev || file.ino !== passwordIdentity.ino || (file.mode & 0o777) !== 0o600) uncertain = true;
        else unlinkSync(passwordFile);
      }
      if (readdirSync(work).length !== 0) uncertain = true;
      if (!uncertain) rmdirSync(work);
      if (uncertain) fail("postgres_runtime_cleanup_uncertain");
    });
  } catch { cleanupFailure = runtimeFailure(new Error("postgres_runtime_cleanup_uncertain"), "CLEANUP"); }
  if (cleanupFailure) throw cleanupFailure;
  if (primaryFailure) throw primaryFailure;
  return validatePostgresCandidateRuntimeReceipt({ kind: "POSTGRES_CANDIDATE_RUNTIME_RECEIPT_V1", state: "VERIFIED",
    authority: "DIAGNOSTIC_ONLY", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    subject: snapshot.subject, imageId: snapshot.imageId, diffIds: snapshot.diffIds, runId: snapshot.runId,
    recipeRevision: snapshot.recipeRevision, gosu, persistence: { payloadSha256: PAYLOAD_SHA256, volume: volumeProof, first, second },
    cleanup: { containers: removed, volume: { name: volumeName, state: "REMOVED" }, temporary: "REMOVED" }, phases },
  Object.fromEntries(["subject", "imageId", "diffIds", "runId", "recipeRevision"].map((key) => [key, snapshot[key]])));
}
