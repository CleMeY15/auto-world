import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
  const sentinelDirectory = path.join(runnerTemp, "seaweed-process-monitor-selftest-sentinel"); const sentinel = path.join(sentinelDirectory, "sentinel");
  if (!existsSync(runnerTemp) || lstatSync(runnerTemp).isSymbolicLink() || realpathSync(runnerTemp) !== runnerTemp || existsSync(work) || existsSync(retained) || existsSync(sentinelDirectory)) throw new Error("seaweed_monitor_selftest_path_invalid");
  mkdirSync(work, { mode: 0o700 }); const home = path.join(work, "home"); const temporary = path.join(work, "tmp");
  mkdirSync(retained); mkdirSync(home); mkdirSync(temporary); mkdirSync(sentinelDirectory, { mode: 0o700 });
  const sentinelContents = "seaweed-monitor-sentinel\n"; writeFileSync(sentinel, sentinelContents, { mode: 0o600 });
  const externalStdout = path.join(sentinelDirectory, "parent-swap.stdout"); const externalStderr = path.join(sentinelDirectory, "parent-swap.stderr");
  writeFileSync(externalStdout, "external-stdout\n", { mode: 0o600 }); writeFileSync(externalStderr, "external-stderr\n", { mode: 0o600 });
  const sentinelDirectoryIdentity = lstatSync(sentinelDirectory); const sentinelIdentity = lstatSync(sentinel);
  const externalStdoutIdentity = lstatSync(externalStdout); const externalStderrIdentity = lstatSync(externalStderr);
  const assertSentinel = () => {
    const directoryInfo = lstatSync(sentinelDirectory); const info = lstatSync(sentinel);
    const stdoutInfo = lstatSync(externalStdout); const stderrInfo = lstatSync(externalStderr);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || directoryInfo.dev !== sentinelDirectoryIdentity.dev ||
        directoryInfo.ino !== sentinelDirectoryIdentity.ino || (directoryInfo.mode & 0o777) !== 0o700 ||
        readdirSync(sentinelDirectory).sort().join(",") !== "parent-swap.stderr,parent-swap.stdout,sentinel" ||
        !info.isFile() || info.isSymbolicLink() || info.dev !== sentinelIdentity.dev || info.ino !== sentinelIdentity.ino ||
        (info.mode & 0o777) !== 0o600 || readFileSync(sentinel, "utf8") !== sentinelContents ||
        !stdoutInfo.isFile() || stdoutInfo.isSymbolicLink() || stdoutInfo.dev !== externalStdoutIdentity.dev || stdoutInfo.ino !== externalStdoutIdentity.ino ||
        (stdoutInfo.mode & 0o777) !== 0o600 || readFileSync(externalStdout, "utf8") !== "external-stdout\n" ||
        !stderrInfo.isFile() || stderrInfo.isSymbolicLink() || stderrInfo.dev !== externalStderrIdentity.dev || stderrInfo.ino !== externalStderrIdentity.ino ||
        (stderrInfo.mode & 0o777) !== 0o600 || readFileSync(externalStderr, "utf8") !== "external-stderr\n") throw new Error("seaweed_monitor_sentinel_changed");
  };
  const environment = safeBaseEnvironment(work);
  const runProbe = (name, command, args, monitorWork, timeout, limits = { workBytes: 64 * MiB, retainedBytes: 8 * MiB, minimumFreeBytes: 1, logBytes: MiB }, outputDirectory = temporary) => {
    const prefix = path.join(outputDirectory, name);
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
    if (timeoutResult.monitorReason !== "seaweed_command_timeout" || timeoutResult.groupAbsent !== true || timeoutPids.length !== 2 ||
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
    if (capResult.monitorReason !== "seaweed_work_budget_exceeded" || capResult.groupAbsent !== true || !Number.isSafeInteger(capResult.resourceUsage?.workBytes) ||
        !Number.isSafeInteger(capResult.resourceUsage?.retainedBytes) || !Number.isSafeInteger(capResult.resourceUsage?.freeBytes) ||
        capResult.resourceUsage.workBytes <= 2 * MiB || capResult.resourceUsage.retainedBytes < 0 || capResult.resourceUsage.freeBytes < 0) {
      throw new Error("seaweed_monitor_cap_selftest_failed");
    }

    const resourceLinkWork = path.join(work, "resource-link"); mkdirSync(resourceLinkWork);
    const resourceLink = path.join(temporary, "resource-link.marker.resources");
    const resourceLinkResult = runProbe("resource-link", "/usr/bin/bash", ["--noprofile", "--norc", "-c",
      "ln -s -- \"$1\" \"$2\"; dd if=/dev/zero of=\"$3\" bs=1048576 count=4 status=none; printf '%s\\n' \"$$\"; sleep 300", "resource-link-probe",
      sentinel, resourceLink, path.join(resourceLinkWork, "payload")], resourceLinkWork, 10_000,
      { workBytes: 2 * MiB, retainedBytes: MiB, minimumFreeBytes: 1, logBytes: MiB });
    const resourceLinkPid = Number(resourceLinkResult.stdout?.toString("utf8").trim());
    if (resourceLinkResult.monitorReason !== "seaweed_work_budget_exceeded" || resourceLinkResult.groupAbsent !== true || resourceLinkResult.resourceUsage !== undefined ||
        !Number.isSafeInteger(resourceLinkPid) || resourceLinkPid < 2 || !processIsAbsent(resourceLinkPid) || !processIsAbsent(-resourceLinkPid) || existsSync(resourceLink)) {
      throw new Error("seaweed_monitor_resource_link_selftest_failed");
    }
    assertSentinel();

    const parentSwapWork = path.join(work, "parent-swap-work"); const parentSwapOutput = path.join(work, "parent-swap-output");
    const parentSwapMoved = path.join(work, "parent-swap-output-moved"); mkdirSync(parentSwapWork); mkdirSync(parentSwapOutput);
    try {
      const parentSwapResult = runProbe("parent-swap", "/usr/bin/bash", ["--noprofile", "--norc", "-c",
        "printf '%s\\n' \"$$\"; mv -- \"$1\" \"$2\"; ln -s -- \"$3\" \"$1\"; sleep 300", "parent-swap-probe",
        parentSwapOutput, parentSwapMoved, sentinelDirectory], parentSwapWork, 1000, undefined, parentSwapOutput);
      const movedInfo = lstatSync(parentSwapMoved); const movedStdout = path.join(parentSwapMoved, "parent-swap.stdout");
      const movedStdoutInfo = lstatSync(movedStdout);
      if (!movedInfo.isDirectory() || movedInfo.isSymbolicLink() || realpathSync(parentSwapMoved) !== path.resolve(parentSwapMoved) ||
          !movedStdoutInfo.isFile() || movedStdoutInfo.isSymbolicLink()) throw new Error("seaweed_monitor_parent_swap_selftest_failed");
      const parentSwapPid = Number(readFileSync(movedStdout, "utf8").trim());
      if (parentSwapResult.monitorReason !== "seaweed_command_timeout" || parentSwapResult.groupAbsent !== true ||
          parentSwapResult.stdout?.length !== 0 || parentSwapResult.stderr?.length !== 0 || parentSwapResult.resourceUsage !== undefined ||
          !Number.isSafeInteger(parentSwapPid) || parentSwapPid < 2 || !processIsAbsent(parentSwapPid) || !processIsAbsent(-parentSwapPid) ||
          !lstatSync(parentSwapOutput).isSymbolicLink()) throw new Error("seaweed_monitor_parent_swap_selftest_failed");
      assertSentinel();
    } finally {
      if (existsSync(parentSwapOutput) && lstatSync(parentSwapOutput).isSymbolicLink()) unlinkSync(parentSwapOutput);
      if (existsSync(parentSwapMoved) && !existsSync(parentSwapOutput)) renameSync(parentSwapMoved, parentSwapOutput);
    }

    const markerLinkWork = path.join(work, "marker-link"); mkdirSync(markerLinkWork);
    const markerLink = path.join(temporary, "marker-link.marker");
    const markerLinkResult = runProbe("marker-link", "/usr/bin/bash", ["--noprofile", "--norc", "-c",
      "ln -s -- \"$1\" \"$2\"; printf '%s\\n' \"$$\"; sleep 300", "marker-link-probe", sentinel, markerLink], markerLinkWork, 1000);
    const markerLinkPid = Number(markerLinkResult.stdout?.toString("utf8").trim());
    if (markerLinkResult.monitorReason !== "seaweed_command_timeout" || markerLinkResult.groupAbsent !== true || !Number.isSafeInteger(markerLinkPid) || markerLinkPid < 2 ||
        !processIsAbsent(markerLinkPid) || !processIsAbsent(-markerLinkPid) || existsSync(markerLink)) throw new Error("seaweed_monitor_marker_link_selftest_failed");
    assertSentinel();

    const missingWork = path.join(work, "measurement"); mkdirSync(missingWork);
    const measurementResult = runProbe("measurement", "/usr/bin/bash", ["--noprofile", "--norc", "-c", "rmdir -- \"$1\"; sleep 300", "measurement-probe", missingWork], missingWork, 10_000);
    if (measurementResult.monitorReason !== "seaweed_measure_du_work_exit_1_attempt_2" || measurementResult.resourceUsage !== undefined) throw new Error("seaweed_monitor_measurement_selftest_failed");

    const orphanWork = path.join(work, "orphan-snapshot"); mkdirSync(orphanWork);
    const orphanSnapshot = path.join(temporary, "orphan-snapshot.marker.resources");
    const orphanResult = runProbe("orphan-snapshot", "/usr/bin/bash", ["--noprofile", "--norc", "-c",
      "printf '%s' '{\"workBytes\":0,\"retainedBytes\":0,\"freeBytes\":1}' >\"$1\"", "orphan-probe", orphanSnapshot], orphanWork, 10_000);
    if (orphanResult.status !== 0 || orphanResult.monitorReason !== "seaweed_resource_snapshot_invalid") throw new Error("seaweed_monitor_orphan_snapshot_selftest_failed");

    const cancellationWork = path.join(work, "cancellation"); mkdirSync(cancellationWork);
    const cancellationResult = runProbe("cancellation", "/usr/bin/bash", ["--noprofile", "--norc", "-c", "printf '%s\\n' \"$$\"; kill -TERM \"$PPID\"; sleep 300"], cancellationWork, 10_000);
    const cancellationPid = Number(cancellationResult.stdout?.toString("utf8").trim());
    if (cancellationResult.monitorReason !== "seaweed_command_cancelled" || !Number.isSafeInteger(cancellationPid) || cancellationPid < 2 ||
        !processIsAbsent(cancellationPid) || !processIsAbsent(-cancellationPid)) throw new Error("seaweed_monitor_cancellation_selftest_failed");
  } catch (error) { failure = error; }
  try {
    for (const owned of [work, retained]) { if (lstatSync(owned).isSymbolicLink() || realpathSync(owned) !== owned) throw new Error("seaweed_monitor_selftest_cleanup_invalid"); rmSync(owned, { recursive: true, force: false }); }
    const sentinelInfo = lstatSync(sentinel);
    if (!sentinelInfo.isFile() || sentinelInfo.isSymbolicLink()) throw new Error("seaweed_monitor_selftest_cleanup_invalid");
    unlinkSync(sentinel); unlinkSync(externalStdout); unlinkSync(externalStderr); rmdirSync(sentinelDirectory);
  }
  catch (error) { failure ??= error; }
  if (failure) throw failure;
  return { result: "PASSED" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) runProcessMonitorSelftest();
