import { spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, unlinkSync } from "node:fs";
import path from "node:path";

const MiB = 1024 ** 2;
const CLEANUP_GRACE_MS = 30_000;

export const commandMonitorScript = String.raw`
set -u
set -o pipefail
command=$1; stdout=$2; stderr=$3; marker=$4; timeout_seconds=$5; work=$6; retained=$7; work_limit=$8; retained_limit=$9; shift 9
free_limit=$1; log_limit=$2; resource_checks=$3; resources=$4; shift 4
pid=; terminating=0; reason=; measured_value=; measurement_reason=; resource_sample_complete=0

write_reason() { printf '%s' "$1" >"$marker"; }
write_resource_snapshot() {
  [ "$resource_sample_complete" -eq 1 ] || return 0
  printf '{"workBytes":%s,"retainedBytes":%s,"freeBytes":%s}' "$sample_work_bytes" "$sample_retained_bytes" "$sample_free_bytes" >"$resources"
}
group_state() {
  groups=$(/usr/bin/timeout --signal=KILL 1s /usr/bin/ps -eo pgid= 2>/dev/null) || return 2
  for group in $groups; do
    case "$group" in ''|*[!0-9]*) return 2;; esac
    [ "$group" -eq "$pid" ] && return 0
  done
  return 1
}
terminate_group() {
  trap '' TERM INT HUP
  [ -n "$pid" ] || return 0
  terminating=1
  kill -TERM -- "-$pid" 2>/dev/null || true
  deadline=$((SECONDS + 4)); state=0
  while [ "$SECONDS" -lt "$deadline" ]; do
    group_state; state=$?
    if [ "$state" -eq 1 ]; then wait "$pid" 2>/dev/null || true; return 0; fi
    [ "$state" -eq 0 ] || break
    /usr/bin/sleep 0.1
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
  deadline=$((SECONDS + 4))
  while [ "$SECONDS" -lt "$deadline" ]; do
    group_state; state=$?
    if [ "$state" -eq 1 ]; then wait "$pid" 2>/dev/null || true; return 0; fi
    /usr/bin/sleep 0.1
  done
  return 1
}
cancelled() {
  trap '' TERM INT HUP
  trap - EXIT
  reason=seaweed_command_cancelled
  if ! write_resource_snapshot; then reason=seaweed_resource_snapshot_invalid; fi
  if ! terminate_group; then reason=seaweed_process_group_cleanup_failed; fi
  write_reason "$reason"
  exit 125
}
unexpected_exit() {
  status=$?
  trap '' TERM INT HUP
  trap - EXIT
  if [ "$terminating" -eq 0 ] && [ -n "$pid" ]; then
    reason=seaweed_monitor_wrapper_failed
    if ! write_resource_snapshot; then reason=seaweed_resource_snapshot_invalid; fi
    if ! terminate_group; then reason=seaweed_process_group_cleanup_failed; fi
    write_reason "$reason"
    exit 125
  fi
  exit "$status"
}
trap cancelled TERM INT HUP
trap unexpected_exit EXIT

/usr/bin/setsid -- "$command" "$@" >"$stdout" 2>"$stderr" & pid=$!
started=$SECONDS; next_resource_check=$((SECONDS + 1))

measurement_failed() {
  tool=$1; target=$2; status=$3; attempt=$4
  case "$status" in ''|*[!0-9]*) measurement_reason=$(printf 'seaweed_measure_%s_%s_invalid_output_attempt_%s' "$tool" "$target" "$attempt");;
    *) measurement_reason=$(printf 'seaweed_measure_%s_%s_exit_%s_attempt_%s' "$tool" "$target" "$status" "$attempt");;
  esac
  return 1
}
measurement_invalid() {
  measurement_reason=$(printf 'seaweed_measure_%s_%s_invalid_output_attempt_%s' "$1" "$2" "$3")
  return 1
}
measure_file() {
  measurement_reason=
  measured_value=$(/usr/bin/timeout --signal=KILL 2s /usr/bin/stat -c %s -- "$1" 2>/dev/null); status=$?
  [ "$status" -eq 0 ] || measurement_failed stat "$2" "$status" 1 || return 1
  case "$measured_value" in ''|*[!0-9]*) measurement_invalid stat "$2" 1 || return 1;; esac
  return 0
}
measure_tree() {
  attempt=0; measurement_reason=
  while [ "$attempt" -lt 2 ]; do
    attempt=$((attempt + 1))
    measured_value=$(/usr/bin/timeout --signal=KILL 2s /usr/bin/du -sb -- "$1" 2>/dev/null); status=$?
    if [ "$status" -eq 0 ]; then
      read -r measured_value ignored <<SEAWEED_MEASURED
$measured_value
SEAWEED_MEASURED
      case "$measured_value" in ''|*[!0-9]*) measurement_invalid du "$2" "$attempt" || return 1;; esac
      return 0
    fi
    measurement_failed du "$2" "$status" "$attempt" || true
    [ "$attempt" -lt 2 ] && /usr/bin/sleep 0.1
  done
  return 1
}
measure_free() {
  measurement_reason=
  measured_value=$(/usr/bin/timeout --signal=KILL 2s /usr/bin/df --output=avail -B1 -- "$1" 2>/dev/null); status=$?
  [ "$status" -eq 0 ] || measurement_failed df "$2" "$status" 1 || return 1
  measured_value=$(printf '%s\n' "$measured_value" | /usr/bin/tail -n 1 | /usr/bin/tr -d '[:space:]')
  case "$measured_value" in ''|*[!0-9]*) measurement_invalid df "$2" 1 || return 1;; esac
  return 0
}
check_resources() {
  measure_tree "$work" work || return 1; work_bytes=$measured_value
  measure_tree "$retained" retained || return 1; retained_bytes=$measured_value
  measure_free "$work" work || return 1; free_bytes=$measured_value
  sample_work_bytes=$work_bytes; sample_retained_bytes=$retained_bytes; sample_free_bytes=$free_bytes; resource_sample_complete=1
  if [ "$retained_bytes" -gt "$retained_limit" ]; then reason=seaweed_retained_budget_exceeded
  elif [ "$work_bytes" -gt $((work_limit - retained_bytes)) ]; then reason=seaweed_work_budget_exceeded
  elif [ "$free_bytes" -lt "$free_limit" ]; then reason=seaweed_free_space_reserve_failed
  fi
  return 0
}

while kill -0 "$pid" 2>/dev/null; do
  if [ $((SECONDS - started)) -ge "$timeout_seconds" ]; then reason=seaweed_command_timeout; fi
  if [ -z "$reason" ]; then measure_file "$stdout" stdout || reason=$measurement_reason; stdout_bytes=$measured_value; fi
  if [ -z "$reason" ]; then measure_file "$stderr" stderr || reason=$measurement_reason; stderr_bytes=$measured_value; fi
  if [ -z "$reason" ] && [ "$stdout_bytes" -gt $((log_limit - stderr_bytes)) ]; then reason=seaweed_command_log_exceeded; fi
  if [ -z "$reason" ] && [ "$resource_checks" -eq 1 ] && [ "$SECONDS" -ge "$next_resource_check" ]; then
    if ! check_resources; then reason=$measurement_reason; fi
    next_resource_check=$((SECONDS + 2))
  fi
  if [ -n "$reason" ]; then
    trap '' TERM INT HUP
    trap - EXIT
    if ! write_resource_snapshot; then reason=seaweed_resource_snapshot_invalid; fi
    if ! terminate_group; then reason=seaweed_process_group_cleanup_failed; fi
    write_reason "$reason"
    exit 125
  fi
  /usr/bin/sleep 0.1
done

trap - EXIT
wait "$pid"; status=$?
if group_state; then
  reason=seaweed_descendant_process_survived
  if ! write_resource_snapshot; then reason=seaweed_resource_snapshot_invalid; fi
  if ! terminate_group; then reason=seaweed_process_group_cleanup_failed; fi
  write_reason "$reason"
  exit 125
else
  state=$?
  if [ "$state" -gt 1 ]; then
    reason=seaweed_process_group_inspection_failed
    if ! write_resource_snapshot; then reason=seaweed_resource_snapshot_invalid; fi
    if ! terminate_group; then reason=seaweed_process_group_cleanup_failed; fi
    write_reason "$reason"
    exit 125
  fi
fi
exit "$status"
`;

function pathEntryExists(file) {
  try { lstatSync(file); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function ownedRegularFile(file, parent) {
  if (!path.isAbsolute(file) || path.dirname(path.resolve(file)) !== parent || pathEntryExists(file)) throw new Error("seaweed_command_monitor_path_invalid");
}

const fixedMonitorReasons = new Set([
  "seaweed_command_cancelled", "seaweed_command_log_exceeded", "seaweed_command_timeout", "seaweed_descendant_process_survived",
  "seaweed_free_space_reserve_failed", "seaweed_monitor_marker_invalid", "seaweed_monitor_wrapper_failed", "seaweed_monitor_wrapper_timeout",
  "seaweed_process_group_cleanup_failed",
  "seaweed_process_group_inspection_failed", "seaweed_resource_snapshot_invalid", "seaweed_retained_budget_exceeded", "seaweed_work_budget_exceeded",
]);
const measurementReason = /^seaweed_measure_(?:stat_(?:stdout|stderr)|du_(?:work|retained)|df_work)_(?:(?:exit_(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5]))|invalid_output)_attempt_[12]$/u;

export function isAllowedMonitorReason(value) {
  return typeof value === "string" && (fixedMonitorReasons.has(value) || measurementReason.test(value));
}

export function normalizeMonitorReason(value) {
  return isAllowedMonitorReason(value) ? value : "seaweed_monitor_marker_invalid";
}

export function parseResourceUsageSnapshot(value) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > 256) throw new Error("seaweed_resource_snapshot_invalid");
  const match = /^\{"workBytes":(0|[1-9][0-9]*),"retainedBytes":(0|[1-9][0-9]*),"freeBytes":(0|[1-9][0-9]*)\}$/u.exec(value.toString("utf8"));
  if (!match) throw new Error("seaweed_resource_snapshot_invalid");
  const [workBytes, retainedBytes, freeBytes] = match.slice(1).map(Number);
  if (![workBytes, retainedBytes, freeBytes].every(Number.isSafeInteger)) throw new Error("seaweed_resource_snapshot_invalid");
  return { workBytes, retainedBytes, freeBytes };
}

function readResourceUsageSnapshot(file) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 1 || before.size > 256) throw new Error("seaweed_resource_snapshot_invalid");
    const value = Buffer.alloc(before.size); let offset = 0;
    while (offset < value.length) {
      const count = readSync(descriptor, value, offset, value.length - offset, offset);
      if (count === 0) throw new Error("seaweed_resource_snapshot_invalid");
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) throw new Error("seaweed_resource_snapshot_invalid");
    return parseResourceUsageSnapshot(value);
  } finally { closeSync(descriptor); }
}

export function validateMonitorOptions(command, args, options) {
  const monitor = options?.monitor;
  if (!path.isAbsolute(command) || !Array.isArray(args) || args.some((item) => typeof item !== "string") || !Number.isSafeInteger(options?.timeout) || options.timeout < 1 ||
      typeof options?.cwd !== "string" || !path.isAbsolute(options.cwd) || typeof options?.env !== "object" || options.env === null || !monitor) {
    throw new Error("seaweed_command_monitor_invalid");
  }
  const directories = [options.cwd, monitor.work, monitor.retained];
  for (const directory of directories) {
    if (!path.isAbsolute(directory) || !existsSync(directory)) throw new Error("seaweed_command_monitor_path_invalid");
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(directory) !== path.resolve(directory)) throw new Error("seaweed_command_monitor_path_invalid");
  }
  const work = path.resolve(monitor.work); const retained = path.resolve(monitor.retained);
  if (work === retained || retained.startsWith(`${work}${path.sep}`) || work.startsWith(`${retained}${path.sep}`) || lstatSync(work).dev !== lstatSync(retained).dev) throw new Error("seaweed_command_monitor_path_invalid");
  const outputParent = path.dirname(path.resolve(monitor.stdout));
  if (!existsSync(outputParent) || lstatSync(outputParent).isSymbolicLink() || realpathSync(outputParent) !== outputParent) throw new Error("seaweed_command_monitor_path_invalid");
  const resources = `${monitor.marker}.resources`;
  for (const file of [monitor.stdout, monitor.stderr, monitor.marker, resources]) ownedRegularFile(file, outputParent);
  if (new Set([monitor.stdout, monitor.stderr, monitor.marker, resources].map((file) => path.resolve(file))).size !== 4) throw new Error("seaweed_command_monitor_path_invalid");
  const limits = monitor.limits;
  for (const key of ["workBytes", "retainedBytes", "minimumFreeBytes", "logBytes"]) {
    if (!Number.isSafeInteger(limits?.[key]) || limits[key] < 1) throw new Error("seaweed_command_monitor_limit_invalid");
  }
  if (limits.workBytes < limits.retainedBytes || limits.logBytes > 64 * MiB) throw new Error("seaweed_command_monitor_limit_invalid");
  if (options.cleanup !== undefined && (options.cleanup !== "redis_container" || command !== "/usr/bin/docker" || args.length !== 3 || args[0] !== "rm" || args[1] !== "--force" || !/^aw-seaweed-redis-[12]$/u.test(args[2]))) {
    throw new Error("seaweed_command_monitor_cleanup_invalid");
  }
  return monitor;
}

export function runMonitoredCommand(command, args, options) {
  const monitor = validateMonitorOptions(command, args, options);
  const resources = `${monitor.marker}.resources`;
  const timeoutSeconds = Math.max(1, Math.ceil(options.timeout / 1000));
  const result = spawnSync("/usr/bin/bash", ["--noprofile", "--norc", "-c", commandMonitorScript, "seaweed-monitor", command,
    monitor.stdout, monitor.stderr, monitor.marker, String(timeoutSeconds), monitor.work, monitor.retained,
    String(monitor.limits.workBytes), String(monitor.limits.retainedBytes), String(monitor.limits.minimumFreeBytes), String(monitor.limits.logBytes),
    options.cleanup === "redis_container" ? "0" : "1", resources, ...args], {
    cwd: options.cwd, encoding: null, env: options.env, maxBuffer: options.maxBuffer ?? MiB, windowsHide: true,
    timeout: options.timeout + CLEANUP_GRACE_MS, killSignal: "SIGTERM",
  });
  const outputSize = (file) => {
    if (!existsSync(file)) return 0;
    const info = lstatSync(file);
    return info.isFile() && !info.isSymbolicLink() ? info.size : Number.POSITIVE_INFINITY;
  };
  const oversized = outputSize(monitor.stdout) + outputSize(monitor.stderr) > monitor.limits.logBytes;
  const stdout = !oversized && existsSync(monitor.stdout) ? readFileSync(monitor.stdout) : Buffer.alloc(0);
  const stderr = !oversized && existsSync(monitor.stderr) ? readFileSync(monitor.stderr) : Buffer.alloc(0);
  const markerSize = outputSize(monitor.marker);
  let monitorReason = oversized ? "seaweed_command_log_exceeded" : markerSize > 128 ? "seaweed_monitor_marker_invalid" : markerSize > 0 ? readFileSync(monitor.marker, "utf8") : undefined;
  if (monitorReason !== undefined) monitorReason = normalizeMonitorReason(monitorReason);
  let resourceUsage;
  if (pathEntryExists(resources)) {
    try {
      const info = lstatSync(resources);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 256) throw new Error("seaweed_resource_snapshot_invalid");
      resourceUsage = readResourceUsageSnapshot(resources);
      if (monitorReason === undefined) monitorReason = "seaweed_resource_snapshot_invalid";
    } catch { monitorReason = "seaweed_resource_snapshot_invalid"; }
  }
  if (result.error?.code === "ETIMEDOUT" && monitorReason === undefined) monitorReason = "seaweed_monitor_wrapper_timeout";
  for (const file of [monitor.stdout, monitor.stderr, monitor.marker, resources]) if (pathEntryExists(file)) unlinkSync(file);
  return { ...result, stdout, stderr, monitorReason, resourceUsage };
}
