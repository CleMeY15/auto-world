import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { isAllowedMonitorReason, normalizeMonitorReason, parseResourceUsageSnapshot, parseTrustedMonitorStatus, validateMonitorOptions } from "../scripts/seaweed/command-monitor.mjs";
import { processIsAbsent, runProcessMonitorSelftest } from "../scripts/seaweed/process-monitor-selftest.mjs";

test("process monitor absence check distinguishes ESRCH from a live process and other errors", () => {
  assert.equal(processIsAbsent(42, () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); }), true);
  assert.equal(processIsAbsent(42, () => {}), false);
  assert.throws(() => processIsAbsent(42, () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); }), /denied/u);
});

test("native Linux process monitor terminates the spawned descendant after timeout", { skip: process.platform !== "linux" }, () => {
  const runnerTemp = mkdtempSync(path.join(tmpdir(), "seaweed-monitor-test-"));
  const env = { GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_ATTEMPT: "1", GITHUB_JOB: "build", RUNNER_TEMP: runnerTemp };
  try { assert.deepEqual(runProcessMonitorSelftest({ env, platform: "linux" }), { result: "PASSED" }); }
  finally { rmSync(runnerTemp, { recursive: true, force: true }); }
});

test("process monitor validates owned disjoint paths and fixed resource limits", () => {
  const root = mkdtempSync(path.join(tmpdir(), "seaweed-monitor-options-"));
  const work = path.join(root, "work"); const retained = path.join(root, "retained"); const logs = path.join(root, "logs");
  mkdirSync(work); mkdirSync(retained); mkdirSync(logs);
  const options = {
    cwd: work, env: { PATH: "/usr/bin:/bin" }, timeout: 1000,
    monitor: { stdout: path.join(logs, "stdout"), stderr: path.join(logs, "stderr"), marker: path.join(logs, "marker"), work, retained,
      limits: { workBytes: 12 * 1024 ** 3, retainedBytes: 2 * 1024 ** 3, minimumFreeBytes: 1024 ** 3, logBytes: 64 * 1024 ** 2 } },
  };
  try {
    assert.equal(validateMonitorOptions("/usr/bin/true", [], options), options.monitor);
    assert.throws(() => validateMonitorOptions("true", [], options), /seaweed_command_monitor_invalid/u);
    assert.throws(() => validateMonitorOptions("/usr/bin/true", [], { ...options, monitor: { ...options.monitor, retained: work } }), /seaweed_command_monitor_path_invalid/u);
    assert.throws(() => validateMonitorOptions("/usr/bin/true", [], { ...options, monitor: { ...options.monitor, limits: { ...options.monitor.limits, logBytes: 64 * 1024 ** 2 + 1 } } }), /seaweed_command_monitor_limit_invalid/u);
    assert.equal(validateMonitorOptions("/usr/bin/docker", ["rm", "--force", "aw-seaweed-redis-1"], { ...options, cleanup: "redis_container" }), options.monitor);
    assert.throws(() => validateMonitorOptions("/usr/bin/docker", ["rm", "--force", "another-container"], { ...options, cleanup: "redis_container" }), /seaweed_command_monitor_cleanup_invalid/u);
    assert.throws(() => validateMonitorOptions("/usr/bin/true", [], { ...options, cleanup: "redis_container" }), /seaweed_command_monitor_cleanup_invalid/u);
    writeFileSync(`${options.monitor.marker}.resources`, "occupied");
    assert.throws(() => validateMonitorOptions("/usr/bin/true", [], options), /seaweed_command_monitor_path_invalid/u);
    rmSync(`${options.monitor.marker}.resources`);
    if (process.platform !== "win32") {
      symlinkSync(path.join(logs, "missing-resource-target"), `${options.monitor.marker}.resources`);
      assert.throws(() => validateMonitorOptions("/usr/bin/true", [], options), /seaweed_command_monitor_path_invalid/u);
      unlinkSync(`${options.monitor.marker}.resources`);
    }
    const linked = path.join(root, "linked"); symlinkSync(work, linked, "junction");
    assert.throws(() => validateMonitorOptions("/usr/bin/true", [], { ...options, monitor: { ...options.monitor, work: linked } }), /seaweed_command_monitor_path_invalid/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("process monitor accepts only bounded measurement evidence and fails closed on invalid markers", () => {
  for (const reason of [
    "seaweed_measure_stat_stdout_exit_0_attempt_1", "seaweed_measure_stat_stderr_exit_255_attempt_2",
    "seaweed_measure_du_work_exit_124_attempt_2", "seaweed_measure_du_retained_invalid_output_attempt_1",
    "seaweed_measure_df_work_exit_137_attempt_1", "seaweed_command_timeout", "seaweed_monitor_output_initialization_failed", "seaweed_resource_snapshot_invalid",
  ]) assert.equal(isAllowedMonitorReason(reason), true, reason);
  for (const reason of [
    "seaweed_measure_stat_work_exit_1_attempt_1", "seaweed_measure_df_retained_exit_1_attempt_1",
    "seaweed_measure_du_work_exit_256_attempt_2", "seaweed_measure_du_work_exit_1_attempt_3",
    "seaweed_measure_du_work_timeout_attempt_2", "seaweed_measure_du_work_exit_1_attempt_2\nsecret",
    "seaweed_resource_measurement_failed", "seaweed_private_path_c_users_secret",
  ]) {
    assert.equal(isAllowedMonitorReason(reason), false, reason);
    assert.equal(normalizeMonitorReason(reason), "seaweed_monitor_marker_invalid", reason);
  }
  assert.equal(normalizeMonitorReason("seaweed_measure_du_work_exit_137_attempt_2"), "seaweed_measure_du_work_exit_137_attempt_2");
});

test("resource snapshots accept only an exact bounded numeric object", () => {
  assert.deepEqual(parseResourceUsageSnapshot(Buffer.from('{"workBytes":12,"retainedBytes":3,"freeBytes":99}')),
    { workBytes: 12, retainedBytes: 3, freeBytes: 99 });
  for (const value of [
    Buffer.from('"/private/path"'),
    Buffer.from('{"workBytes":-1,"retainedBytes":3,"freeBytes":99}'),
    Buffer.from('{"workBytes":"NaN","retainedBytes":3,"freeBytes":99}'),
    Buffer.from('{"workBytes":12,"retainedBytes":3,"freeBytes":99,"path":"/private/path"}'),
    Buffer.from('{"workBytes":12,"workBytes":13,"retainedBytes":3,"freeBytes":99}'),
    Buffer.alloc(257, 0x20),
  ]) assert.throws(() => parseResourceUsageSnapshot(value), /seaweed_resource_snapshot_invalid/u);
});

test("trusted monitor status accepts one bounded allowlisted line", () => {
  assert.equal(parseTrustedMonitorStatus(undefined), undefined);
  assert.deepEqual(parseTrustedMonitorStatus(Buffer.from("seaweed-monitor-status:seaweed_work_budget_exceeded:written:absent\n")),
    { reason: "seaweed_work_budget_exceeded", resourceWritten: true, groupAbsent: true });
  assert.deepEqual(parseTrustedMonitorStatus(Buffer.from("seaweed-monitor-status:seaweed_command_timeout:none:absent\n")),
    { reason: "seaweed_command_timeout", resourceWritten: false, groupAbsent: true });
  assert.deepEqual(parseTrustedMonitorStatus(Buffer.from("seaweed-monitor-status:seaweed_monitor_output_initialization_failed:none:absent\n")),
    { reason: "seaweed_monitor_output_initialization_failed", resourceWritten: false, groupAbsent: true });
  assert.deepEqual(parseTrustedMonitorStatus(Buffer.from("seaweed-monitor-status:seaweed_process_group_cleanup_failed:none:unknown\n")),
    { reason: "seaweed_process_group_cleanup_failed", resourceWritten: false, groupAbsent: false });
  assert.deepEqual(parseTrustedMonitorStatus(Buffer.from("seaweed-monitor-status:ok:none:absent\n")),
    { reason: undefined, resourceWritten: false, groupAbsent: true });
  for (const value of [
    Buffer.from("seaweed-monitor-status:seaweed_command_timeout:none:absent\nsecret\n"),
    Buffer.from("seaweed-monitor-status:seaweed_private_path:none:absent\n"),
    Buffer.from("seaweed-monitor-status:ok:written:absent\n"),
    Buffer.from("seaweed-monitor-status:seaweed_command_timeout:none:unknown\n"),
    Buffer.alloc(129, 0x61),
    "seaweed-monitor-status:seaweed_command_timeout:none:absent\n",
  ]) assert.deepEqual(parseTrustedMonitorStatus(value), { reason: "seaweed_monitor_wrapper_failed", resourceWritten: false, groupAbsent: false });
});
