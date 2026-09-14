import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { validateMonitorOptions } from "../scripts/seaweed/command-monitor.mjs";
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
    const linked = path.join(root, "linked"); symlinkSync(work, linked, "junction");
    assert.throws(() => validateMonitorOptions("/usr/bin/true", [], { ...options, monitor: { ...options.monitor, work: linked } }), /seaweed_command_monitor_path_invalid/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
