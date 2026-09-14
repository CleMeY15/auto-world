import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

const MiB = 1024 ** 2;
const CLEANUP_GRACE_MS = 30_000;

export const commandMonitorScript = String.raw`
set -u
set -o pipefail
command=$1; stdout=$2; stderr=$3; marker=$4; timeout_seconds=$5; work=$6; retained=$7; work_limit=$8; retained_limit=$9; shift 9
free_limit=$1; log_limit=$2; resource_checks=$3; shift 3
pid=; terminating=0; reason=

write_reason() { printf '%s' "$1" >"$marker"; }
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

measure_file() {
  measured=$(/usr/bin/timeout --signal=KILL 2s /usr/bin/stat -c %s -- "$1" 2>/dev/null) || return 1
  case "$measured" in ''|*[!0-9]*) return 1;; esac
  printf '%s' "$measured"
}
measure_tree() {
  attempt=0
  while [ "$attempt" -lt 2 ]; do
    measured=$(/usr/bin/timeout --signal=KILL 2s /usr/bin/du -sb -- "$1" 2>/dev/null) && {
      read -r measured ignored <<SEAWEED_MEASURED
$measured
SEAWEED_MEASURED
      case "$measured" in ''|*[!0-9]*) return 1;; esac
      printf '%s' "$measured"
      return 0
    }
    attempt=$((attempt + 1))
    [ "$attempt" -lt 2 ] && /usr/bin/sleep 0.1
  done
  return 1
}
measure_free() {
  measured=$(/usr/bin/timeout --signal=KILL 2s /usr/bin/df --output=avail -B1 -- "$1" 2>/dev/null) || return 1
  measured=$(printf '%s\n' "$measured" | /usr/bin/tail -n 1 | /usr/bin/tr -d '[:space:]')
  case "$measured" in ''|*[!0-9]*) return 1;; esac
  printf '%s' "$measured"
}
check_resources() {
  work_bytes=$(measure_tree "$work") || return 1
  retained_bytes=$(measure_tree "$retained") || return 1
  free_bytes=$(measure_free "$work") || return 1
  if [ "$retained_bytes" -gt "$retained_limit" ]; then reason=seaweed_retained_budget_exceeded
  elif [ "$work_bytes" -gt $((work_limit - retained_bytes)) ]; then reason=seaweed_work_budget_exceeded
  elif [ "$free_bytes" -lt "$free_limit" ]; then reason=seaweed_free_space_reserve_failed
  fi
  return 0
}

while kill -0 "$pid" 2>/dev/null; do
  if [ $((SECONDS - started)) -ge "$timeout_seconds" ]; then reason=seaweed_command_timeout; fi
  if [ -z "$reason" ]; then stdout_bytes=$(measure_file "$stdout") || reason=seaweed_resource_measurement_failed; fi
  if [ -z "$reason" ]; then stderr_bytes=$(measure_file "$stderr") || reason=seaweed_resource_measurement_failed; fi
  if [ -z "$reason" ] && [ "$stdout_bytes" -gt $((log_limit - stderr_bytes)) ]; then reason=seaweed_command_log_exceeded; fi
  if [ -z "$reason" ] && [ "$resource_checks" -eq 1 ] && [ "$SECONDS" -ge "$next_resource_check" ]; then
    if ! check_resources; then reason=seaweed_resource_measurement_failed; fi
    next_resource_check=$((SECONDS + 2))
  fi
  if [ -n "$reason" ]; then
    trap '' TERM INT HUP
    trap - EXIT
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
  if ! terminate_group; then reason=seaweed_process_group_cleanup_failed; fi
  write_reason "$reason"
  exit 125
else
  state=$?
  if [ "$state" -gt 1 ]; then
    reason=seaweed_process_group_inspection_failed
    if ! terminate_group; then reason=seaweed_process_group_cleanup_failed; fi
    write_reason "$reason"
    exit 125
  fi
fi
exit "$status"
`;

function ownedRegularFile(file, parent) {
  if (!path.isAbsolute(file) || path.dirname(path.resolve(file)) !== parent || existsSync(file)) throw new Error("seaweed_command_monitor_path_invalid");
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
  for (const file of [monitor.stdout, monitor.stderr, monitor.marker]) ownedRegularFile(file, outputParent);
  if (new Set([monitor.stdout, monitor.stderr, monitor.marker].map((file) => path.resolve(file))).size !== 3) throw new Error("seaweed_command_monitor_path_invalid");
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
  const timeoutSeconds = Math.max(1, Math.ceil(options.timeout / 1000));
  const result = spawnSync("/usr/bin/bash", ["--noprofile", "--norc", "-c", commandMonitorScript, "seaweed-monitor", command,
    monitor.stdout, monitor.stderr, monitor.marker, String(timeoutSeconds), monitor.work, monitor.retained,
    String(monitor.limits.workBytes), String(monitor.limits.retainedBytes), String(monitor.limits.minimumFreeBytes), String(monitor.limits.logBytes),
    options.cleanup === "redis_container" ? "0" : "1", ...args], {
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
  if (monitorReason !== undefined && !/^seaweed_[a-z0-9_]+$/u.test(monitorReason)) monitorReason = "seaweed_monitor_marker_invalid";
  if (result.error?.code === "ETIMEDOUT" && monitorReason === undefined) monitorReason = "seaweed_monitor_wrapper_timeout";
  for (const file of [monitor.stdout, monitor.stderr, monitor.marker]) if (existsSync(file)) rmSync(file, { force: false });
  return { ...result, stdout, stderr, monitorReason };
}
