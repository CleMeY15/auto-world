import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { safeBaseEnvironment } from "./build.mjs";
import { runMonitoredCommand } from "./command-monitor.mjs";

const MiB = 1024 ** 2;

export function processIsAbsent(pid, signal = process.kill) {
  try { signal(pid, 0); return false; }
  catch (error) { if (error?.code === "ESRCH") return true; throw error; }
}

export function runProcessMonitorSelftest({ env = process.env, platform = process.platform, runner = runMonitoredCommand } = {}) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux" || env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_RUN_ATTEMPT !== "1" || env.GITHUB_JOB !== "build" || !path.isAbsolute(env.RUNNER_TEMP ?? "")) throw new Error("seaweed_monitor_selftest_context_invalid");
  const runnerTemp = path.resolve(env.RUNNER_TEMP); const work = path.join(runnerTemp, "seaweed-process-monitor-selftest");
  const retained = path.join(runnerTemp, "seaweed-process-monitor-selftest-retained");
  if (!existsSync(runnerTemp) || lstatSync(runnerTemp).isSymbolicLink() || realpathSync(runnerTemp) !== runnerTemp || existsSync(work) || existsSync(retained)) throw new Error("seaweed_monitor_selftest_path_invalid");
  mkdirSync(work, { mode: 0o700 }); const home = path.join(work, "home"); const temporary = path.join(work, "tmp");
  mkdirSync(retained); mkdirSync(home); mkdirSync(temporary);
  const environment = safeBaseEnvironment(work);
  const runProbe = (name, command, args, monitorWork, timeout, limits = { workBytes: 64 * MiB, retainedBytes: 8 * MiB, minimumFreeBytes: 1, logBytes: MiB }) => {
    const prefix = path.join(temporary, name);
    return runner(command, args, {
      cwd: work, env: environment, maxBuffer: MiB, timeout,
      monitor: { stdout: `${prefix}.stdout`, stderr: `${prefix}.stderr`, marker: `${prefix}.marker`, work: monitorWork, retained, limits },
    });
  };
  let failure;
  try {
    const timeoutWork = path.join(work, "timeout"); mkdirSync(timeoutWork);
    const timeoutResult = runProbe("timeout", "/usr/bin/bash", ["--noprofile", "--norc", "-c", "sleep 300 & child=$!; printf '%s %s\\n' \"$$\" \"$child\"; wait \"$child\""], timeoutWork, 1000);
    const timeoutPids = timeoutResult.stdout?.toString("utf8").trim().split(/\s+/u).map(Number) ?? [];
    if (timeoutResult.monitorReason !== "seaweed_command_timeout" || timeoutPids.length !== 2 ||
        timeoutPids.some((pid) => !Number.isSafeInteger(pid) || pid < 2 || !processIsAbsent(pid)) || !processIsAbsent(-timeoutPids[0])) throw new Error("seaweed_monitor_timeout_selftest_failed");

    const resistantWork = path.join(work, "resistant"); mkdirSync(resistantWork);
    const resistantResult = runProbe("resistant", "/usr/bin/bash", ["--noprofile", "--norc", "-c",
      "trap '' TERM; monitor=$PPID; sleep 300 & child=$!; (sleep 1.5; kill -TERM \"$monitor\") & signaler=$!; printf '%s %s %s\\n' \"$$\" \"$child\" \"$signaler\"; wait"], resistantWork, 1000);
    const resistantPids = resistantResult.stdout?.toString("utf8").trim().split(/\s+/u).map(Number) ?? [];
    if (resistantResult.monitorReason !== "seaweed_command_timeout" || resistantPids.length !== 3 ||
        resistantPids.some((pid) => !Number.isSafeInteger(pid) || pid < 2 || !processIsAbsent(pid)) || !processIsAbsent(-resistantPids[0])) throw new Error("seaweed_monitor_interrupted_cleanup_selftest_failed");

    const missingStdoutWork = path.join(work, "stdout-absent"); mkdirSync(missingStdoutWork);
    const missingStdout = path.join(temporary, "stdout-absent.stdout");
    const missingStdoutResult = runProbe("stdout-absent", "/usr/bin/bash", ["--noprofile", "--norc", "-c", "rm -- \"$1\"; sleep 300", "stdout-probe", missingStdout], missingStdoutWork, 10_000);
    if (missingStdoutResult.monitorReason !== "seaweed_measure_stat_stdout_exit_1_attempt_1") throw new Error("seaweed_monitor_stdout_measurement_selftest_failed");

    const capWork = path.join(work, "cap"); mkdirSync(capWork);
    const capResult = runProbe("cap", "/usr/bin/bash", ["--noprofile", "--norc", "-c", "dd if=/dev/zero of=\"$1\" bs=1048576 count=4 status=none; sleep 300", "cap-probe", path.join(capWork, "payload")], capWork, 10_000,
      { workBytes: 2 * MiB, retainedBytes: MiB, minimumFreeBytes: 1, logBytes: MiB });
    if (capResult.monitorReason !== "seaweed_work_budget_exceeded") throw new Error("seaweed_monitor_cap_selftest_failed");

    const missingWork = path.join(work, "measurement"); mkdirSync(missingWork);
    const measurementResult = runProbe("measurement", "/usr/bin/bash", ["--noprofile", "--norc", "-c", "rmdir -- \"$1\"; sleep 300", "measurement-probe", missingWork], missingWork, 10_000);
    if (measurementResult.monitorReason !== "seaweed_measure_du_work_exit_1_attempt_2") throw new Error("seaweed_monitor_measurement_selftest_failed");

    const cancellationWork = path.join(work, "cancellation"); mkdirSync(cancellationWork);
    const cancellationResult = runProbe("cancellation", "/usr/bin/bash", ["--noprofile", "--norc", "-c", "printf '%s\\n' \"$$\"; kill -TERM \"$PPID\"; sleep 300"], cancellationWork, 10_000);
    const cancellationPid = Number(cancellationResult.stdout?.toString("utf8").trim());
    if (cancellationResult.monitorReason !== "seaweed_command_cancelled" || !Number.isSafeInteger(cancellationPid) || cancellationPid < 2 ||
        !processIsAbsent(cancellationPid) || !processIsAbsent(-cancellationPid)) throw new Error("seaweed_monitor_cancellation_selftest_failed");
  } catch (error) { failure = error; }
  try {
    for (const owned of [work, retained]) { if (lstatSync(owned).isSymbolicLink() || realpathSync(owned) !== owned) throw new Error("seaweed_monitor_selftest_cleanup_invalid"); rmSync(owned, { recursive: true, force: false }); }
  }
  catch (error) { failure ??= error; }
  if (failure) throw failure;
  return { result: "PASSED" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) runProcessMonitorSelftest();
