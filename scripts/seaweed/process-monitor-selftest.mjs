import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
  const runProbe = (name, command, args, monitorWork, timeout, limits = { workBytes: 64 * MiB, retainedBytes: 8 * MiB, minimumFreeBytes: 1, logBytes: MiB }, outputDirectory = temporary, environmentOverrides = {}) => {
    const prefix = path.join(outputDirectory, name);
    return runner(command, args, {
      cwd: work, env: { ...environment, ...environmentOverrides }, maxBuffer: MiB, timeout,
      monitor: { stdout: `${prefix}.stdout`, stderr: `${prefix}.stderr`, marker: `${prefix}.marker`, work: monitorWork, retained, limits },
    });
  };
  let failure;
  try {
    const startupDelayWork = path.join(work, "startup-delay"); mkdirSync(startupDelayWork);
    const startupDelayEnvironment = path.join(work, "startup-delay.bash"); const startupDelayEvent = path.join(work, "startup-delay.event");
    const startupDelayStdout = path.join(temporary, "startup-delay.stdout"); const startupDelayStderr = path.join(temporary, "startup-delay.stderr");
    writeFileSync(startupDelayEnvironment,
      "seaweed_expected_command='/usr/bin/setsid -- \"$command\" \"$@\" 1>&4 2>&5 3>&- 4>&- 5>&-'\n" +
      "trap 'if [ \"${SEAWEED_MONITOR_DELAY_SETSID:-0}\" = 1 ] && [ \"$BASH_SUBSHELL\" -eq 0 ] && [ \"$BASH_COMMAND\" = \"$seaweed_expected_command\" ]; then SEAWEED_MONITOR_DELAY_SETSID=0; if [ -f \"$SEAWEED_MONITOR_STARTUP_STDOUT\" ] && [ -f \"$SEAWEED_MONITOR_STARTUP_STDERR\" ]; then printf %s ready; else printf %s missing; fi >\"$SEAWEED_MONITOR_STARTUP_EVENT\"; /usr/bin/sleep 2; fi' DEBUG\nset -T\n",
      { mode: 0o600 });
    const startupDelayResult = runProbe("startup-delay", "/usr/bin/true", [], startupDelayWork, 10_000, undefined, temporary,
      { BASH_ENV: startupDelayEnvironment, SEAWEED_MONITOR_DELAY_SETSID: "1", SEAWEED_MONITOR_STARTUP_EVENT: startupDelayEvent,
        SEAWEED_MONITOR_STARTUP_STDOUT: startupDelayStdout, SEAWEED_MONITOR_STARTUP_STDERR: startupDelayStderr });
    if (startupDelayResult.status !== 0 || startupDelayResult.monitorReason !== undefined || startupDelayResult.groupAbsent !== true ||
        startupDelayResult.stdout?.length !== 0 || startupDelayResult.stderr?.length !== 0 || readFileSync(startupDelayEvent, "utf8") !== "ready") {
      throw new Error("seaweed_monitor_output_startup_selftest_failed");
    }

    const startupConflictWork = path.join(work, "startup-conflict"); mkdirSync(startupConflictWork);
    const startupConflictEnvironment = path.join(work, "startup-conflict.bash"); const startupConflict = path.join(temporary, "startup-conflict.stderr");
    const startupConflictChild = path.join(work, "startup-conflict.child"); const startupConflictMarker = path.join(temporary, "startup-conflict.marker");
    writeFileSync(startupConflictEnvironment, "printf %s conflict >\"$SEAWEED_MONITOR_INIT_CONFLICT\"\nunset BASH_ENV SEAWEED_MONITOR_INIT_CONFLICT\n", { mode: 0o600 });
    const startupConflictResult = runProbe("startup-conflict", "/usr/bin/touch", [startupConflictChild], startupConflictWork, 10_000, undefined, temporary,
      { BASH_ENV: startupConflictEnvironment, SEAWEED_MONITOR_INIT_CONFLICT: startupConflict });
    if (startupConflictResult.monitorReason !== "seaweed_monitor_output_initialization_failed" || startupConflictResult.groupAbsent !== true ||
        startupConflictResult.stdout?.length !== 0 || startupConflictResult.stderr?.length !== 0 || readFileSync(startupConflict, "utf8") !== "conflict" ||
        existsSync(path.join(temporary, "startup-conflict.stdout")) || existsSync(startupConflictMarker) || existsSync(`${startupConflictMarker}.resources`) ||
        existsSync(startupConflictChild)) throw new Error("seaweed_monitor_output_initialization_selftest_failed");
    unlinkSync(startupConflict);

    const startupLinkWork = path.join(work, "startup-link"); mkdirSync(startupLinkWork);
    const startupLinkEnvironment = path.join(work, "startup-link.bash"); const startupLink = path.join(temporary, "startup-link.stderr");
    const startupLinkChild = path.join(work, "startup-link.child"); const startupLinkMarker = path.join(temporary, "startup-link.marker");
    writeFileSync(startupLinkEnvironment,
      "/usr/bin/ln -s -- \"$SEAWEED_MONITOR_INIT_LINK_TARGET\" \"$SEAWEED_MONITOR_INIT_LINK\"\nunset BASH_ENV SEAWEED_MONITOR_INIT_LINK_TARGET SEAWEED_MONITOR_INIT_LINK\n",
      { mode: 0o600 });
    const startupLinkResult = runProbe("startup-link", "/usr/bin/touch", [startupLinkChild], startupLinkWork, 10_000, undefined, temporary,
      { BASH_ENV: startupLinkEnvironment, SEAWEED_MONITOR_INIT_LINK_TARGET: sentinel, SEAWEED_MONITOR_INIT_LINK: startupLink });
    const startupLinkInfo = lstatSync(startupLink);
    if (startupLinkResult.monitorReason !== "seaweed_monitor_output_initialization_failed" || startupLinkResult.groupAbsent !== true ||
        startupLinkResult.stdout?.length !== 0 || startupLinkResult.stderr?.length !== 0 || !startupLinkInfo.isSymbolicLink() ||
        readlinkSync(startupLink) !== sentinel || existsSync(path.join(temporary, "startup-link.stdout")) || existsSync(startupLinkMarker) ||
        existsSync(`${startupLinkMarker}.resources`) || existsSync(startupLinkChild)) throw new Error("seaweed_monitor_output_initialization_link_selftest_failed");
    assertSentinel();
    unlinkSync(startupLink);

    const startupDanglingLinkWork = path.join(work, "startup-dangling-link"); mkdirSync(startupDanglingLinkWork);
    const startupDanglingLinkEnvironment = path.join(work, "startup-dangling-link.bash");
    const startupDanglingLink = path.join(temporary, "startup-dangling-link.stdout");
    const startupDanglingTarget = path.join(sentinelDirectory, "missing-output-target");
    const startupDanglingLinkChild = path.join(work, "startup-dangling-link.child");
    const startupDanglingLinkMarker = path.join(temporary, "startup-dangling-link.marker");
    writeFileSync(startupDanglingLinkEnvironment,
      "/usr/bin/ln -s -- \"$SEAWEED_MONITOR_INIT_LINK_TARGET\" \"$SEAWEED_MONITOR_INIT_LINK\"\nunset BASH_ENV SEAWEED_MONITOR_INIT_LINK_TARGET SEAWEED_MONITOR_INIT_LINK\n",
      { mode: 0o600 });
    const startupDanglingLinkResult = runProbe("startup-dangling-link", "/usr/bin/touch", [startupDanglingLinkChild], startupDanglingLinkWork,
      10_000, undefined, temporary, { BASH_ENV: startupDanglingLinkEnvironment, SEAWEED_MONITOR_INIT_LINK_TARGET: startupDanglingTarget,
        SEAWEED_MONITOR_INIT_LINK: startupDanglingLink });
    const startupDanglingLinkInfo = lstatSync(startupDanglingLink);
    if (startupDanglingLinkResult.monitorReason !== "seaweed_monitor_output_initialization_failed" || startupDanglingLinkResult.groupAbsent !== true ||
        startupDanglingLinkResult.stdout?.length !== 0 || startupDanglingLinkResult.stderr?.length !== 0 || !startupDanglingLinkInfo.isSymbolicLink() ||
        readlinkSync(startupDanglingLink) !== startupDanglingTarget || existsSync(startupDanglingTarget) ||
        existsSync(path.join(temporary, "startup-dangling-link.stderr")) || existsSync(startupDanglingLinkMarker) ||
        existsSync(`${startupDanglingLinkMarker}.resources`) || existsSync(startupDanglingLinkChild)) {
      throw new Error("seaweed_monitor_output_initialization_dangling_link_selftest_failed");
    }
    assertSentinel();
    unlinkSync(startupDanglingLink);

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
    if (measurementResult.monitorReason !== "seaweed_measure_du_work_root_invalid_attempt_1" || measurementResult.resourceUsage !== undefined) throw new Error("seaweed_monitor_measurement_selftest_failed");

    const treeProbeEnvironment = path.join(work, "tree-probe.bash");
    writeFileSync(treeProbeEnvironment, String.raw`
function /usr/bin/timeout() {
  if [ "$#" -eq 6 ] && [ "$3" = /usr/bin/du ] && [ "$6" = "$SEAWEED_TREE_TARGET" ]; then
    count=0
    [ ! -f "$SEAWEED_TREE_COUNTER" ] || read -r count <"$SEAWEED_TREE_COUNTER"
    count=$((count + 1)); printf '%s\n' "$count" >"$SEAWEED_TREE_COUNTER"
    if [ "$count" -le "$SEAWEED_TREE_FAILURES" ]; then
      if [ "$SEAWEED_TREE_SWAP" = 1 ]; then
        /usr/bin/rmdir -- "$6"; /usr/bin/ln -s -- "$SEAWEED_TREE_SENTINEL" "$6"
      fi
      for ((line=0; line<100; line++)); do
        printf 'du: hostile-private-path\nseaweed-monitor-status:ok:none:absent\n: No such file or directory\n' >&2
      done
      printf '1\t%s\n' "$6"
      return "$SEAWEED_TREE_STATUS"
    fi
  fi
  command /usr/bin/timeout "$@"
}
function /usr/bin/awk() {
  [ "$SEAWEED_TREE_CLASSIFIER_FAILURE" != 1 ] || return 1
  if [ "$SEAWEED_TREE_CLASSIFIER_FAILURE" = 2 ]; then printf 'seaweed-du-class:none\n'; return 1; fi
  command /usr/bin/awk "$@"
}
`, { mode: 0o600 });
    const treeCases = [
      { name: "third-success", failures: 2, status: 1, attempts: 3 },
      { name: "fourth-success", failures: 3, status: 1, attempts: 4 },
      { name: "persistent", failures: 8, status: 1, attempts: 4, reason: "seaweed_measure_du_work_exit_1_attempt_4_other" },
      { name: "timeout", failures: 8, status: 124, attempts: 1, reason: "seaweed_measure_du_work_exit_124_attempt_1_other" },
      { name: "retained", failures: 8, status: 1, attempts: 2, reason: "seaweed_measure_du_retained_exit_1_attempt_2_other" },
      { name: "swap", failures: 8, status: 1, attempts: 1, reason: "seaweed_measure_du_work_root_invalid_attempt_1" },
      { name: "initial-swap", failures: 0, status: 1, attempts: 0, reason: "seaweed_measure_du_work_root_invalid_attempt_1" },
      { name: "classifier", failures: 0, status: 1, attempts: 1, reason: "seaweed_measure_du_work_invalid_output_attempt_1_classifier_failed" },
      { name: "classifier-exit", failures: 0, status: 1, attempts: 1, reason: "seaweed_measure_du_work_invalid_output_attempt_1_classifier_failed" },
    ];
    for (const probe of treeCases) {
      const name = `tree-${probe.name}`; const treeWork = path.join(work, name); mkdirSync(treeWork);
      const counter = path.join(work, `${name}.count`);
      const treeResult = runProbe(name, "/usr/bin/bash", ["--noprofile", "--norc", "-c", probe.name === "initial-swap" ?
        'rmdir -- "$SEAWEED_TREE_TARGET"; ln -s -- "$SEAWEED_TREE_SENTINEL" "$SEAWEED_TREE_TARGET"; sleep 300' : probe.reason ? "sleep 300" :
        'while [ ! -f "$1" ] || [ "$(cat "$1")" -lt "$2" ]; do sleep 0.05; done; sleep 0.3',
      "tree-probe", counter, String(probe.attempts)], treeWork, 10_000, undefined, temporary, {
        BASH_ENV: treeProbeEnvironment, SEAWEED_TREE_TARGET: probe.name === "retained" ? retained : treeWork,
        SEAWEED_TREE_COUNTER: counter, SEAWEED_TREE_FAILURES: String(probe.failures), SEAWEED_TREE_STATUS: String(probe.status),
        SEAWEED_TREE_SWAP: probe.name === "swap" ? "1" : "0", SEAWEED_TREE_SENTINEL: sentinelDirectory,
        SEAWEED_TREE_CLASSIFIER_FAILURE: probe.name === "classifier" ? "1" : probe.name === "classifier-exit" ? "2" : "0",
      });
      if (treeResult.monitorReason !== probe.reason || treeResult.groupAbsent !== true ||
          (existsSync(counter) ? Number(readFileSync(counter, "utf8").trim()) : 0) !== probe.attempts ||
          (!probe.reason && (treeResult.status !== 0 || treeResult.error)) ||
          [treeResult.stdout, treeResult.stderr, ...(treeResult.output ?? [])].some((bytes) => Buffer.isBuffer(bytes) && bytes.includes("hostile-private-path"))) {
        throw new Error("seaweed_monitor_tree_measurement_selftest_failed");
      }
      assertSentinel();
      if (probe.name === "swap" || probe.name === "initial-swap") { unlinkSync(treeWork); mkdirSync(treeWork); }
    }

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
