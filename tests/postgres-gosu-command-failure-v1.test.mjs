import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TEST_ONLY, completeOwnedGosuScratch, formatGosuPreparationFailure } from "../scripts/postgres-image/gosu-derivative-build-v1.mjs";

const stages = [
  "online_go_version", "online_mod_download", "online_mod_verify", "offline_go_test",
  "offline_go_build", "offline_gosu_version", "offline_go_build_info", "offline_isolation",
];
const reasons = ["spawn", "timeout", "output_limit", "signal", "exit"];
const offlineStages = ["offline_go_test", "offline_go_build", "offline_gosu_version", "offline_go_build_info"];
const fixedChildCodes = [
  "gosu_command_stage_invalid", "gosu_command_result_invalid", "gosu_offline_environment_invalid",
  "gosu_offline_identity_invalid", "gosu_offline_network_invalid", "gosu_offline_privilege_invalid",
  "gosu_offline_evidence_invalid", "gosu_tests_invalid", "gosu_tests_failed", "gosu_source_mutated",
  "gosu_version_invalid", "gosu_build_info_invalid", "gosu_build_info_vcs_invalid", "gosu_sumdb_invalid",
  "gosu_lock_identity_invalid",
];
const childCodes = [...offlineStages.flatMap((stage) => reasons.map((reason) => `gosu_command_failed_${stage}_${reason}`)), ...fixedChildCodes];
const isolationReasons = [
  "setup_arguments_invalid", "setup_environment_invalid", "repeat_invalid",
  "uid_invalid", "gid_invalid", "original_netns_invalid", "original_mntns_invalid",
  "scratch_invalid", "output_invalid", "owned_paths_invalid", "ci_invalid",
  "run_id_invalid", "run_attempt_invalid", "head_sha_invalid", "job_invalid",
  "namespace_net_invalid", "namespace_mnt_invalid", "namespace_transition_invalid", "namespace_changed_invalid",
  "setup_platform_invalid", "setup_root_invalid", "setup_read_failed", "setup_netns_reused", "setup_mntns_reused",
  "setup_sysfs_not_directory", "setup_sysfs_symlink", "boundary_netns_reused", "boundary_mntns_reused",
  "boundary_observation_invalid", "boundary_interfaces_invalid", "boundary_routes_present",
  "boundary_flags_invalid", "boundary_flags_number_invalid", "boundary_loopback_missing", "boundary_loopback_up",
  "setup_mount_spawn", "setup_mount_timeout", "setup_mount_output_limit", "setup_mount_signal", "setup_mount_exit", "setup_mount_result_invalid",
  "setup_setpriv_spawn", "setup_setpriv_timeout", "setup_setpriv_output_limit", "setup_setpriv_signal", "setup_setpriv_exit", "setup_setpriv_result_invalid",
];
const isolationMessages = isolationReasons.map((reason) => `gosu_offline_network_invalid\ngosu_isolation_reason_${reason}`);
const allChildMessages = [...childCodes, ...isolationMessages];
const childMainMessage = (reason) => `gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_${reason}`;
const childReadStages = ["lock_read", "boundary_netns_read", "boundary_mntns_read", "boundary_status_read", "boundary_routes_read", "boundary_interfaces_read", "boundary_loopback_flags_read"];
const childMainReasons = [...childReadStages.flatMap((stage) => ["permission_denied", "path_unavailable", "unclassified"].map((reason) => `${stage}_${reason}`)), "runtime_invalid", "arguments_invalid", "lock_json_invalid", "lock_contract_invalid", "main_unclassified"];
const childMainMessages = childMainReasons.map(childMainMessage);
const success = () => ({ error: undefined, signal: null, status: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0) });
const failure = (reason) => {
  if (reason === "spawn") return { ...success(), error: Object.assign(new Error("secret-error"), { code: "EACCES" }), signal: "SIGKILL", status: 9 };
  if (reason === "timeout") return { ...success(), error: Object.assign(new Error("secret-error"), { code: "ETIMEDOUT" }), signal: "SIGKILL", status: 9 };
  if (reason === "output_limit") return { ...success(), error: Object.assign(new Error("secret-error"), { code: "ENOBUFS" }), signal: "SIGKILL", status: 9 };
  if (reason === "signal") return { ...success(), signal: "SIGKILL", status: 9 };
  return { ...success(), status: 9 };
};
const invoke = (stage, runner) => TEST_ONLY.runCommand(stage, "secret-command", ["secret-argument"], {
  cwd: "secret-cwd", env: { SECRET_ENV: "secret-environment" }, cap: 123, timeout: 456,
}, runner);
async function invokeSetup(resultOrRunner) {
  const environment = TEST_ONLY.setupEnvironment({
    repeat: "1", scratch: "/runner/aw-gosu-preparation-1", output: "/runner/gosu-preparation-1",
    uid: "1000", gid: "1001", originalNetns: "net:[100]", originalMntns: "mnt:[200]",
    ci: { runId: "300", runAttempt: "1", headSha: "a".repeat(40), job: "build_1" },
  });
  const calls = [];
  const promise = TEST_ONLY.runOfflineSetup(environment, {
    platform: "linux", geteuid: () => 0,
    readlink: async (name) => name.endsWith("/net") ? "net:[101]" : "mnt:[201]",
    lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    runner: (command) => {
      calls.push(command);
      if (calls.length === 1) return success();
      return typeof resultOrRunner === "function" ? resultOrRunner() : resultOrRunner;
    },
  });
  return { promise, calls };
}
const exactMessage = (message) => (error) => {
  assert.equal(error.message, message);
  assert.equal(formatGosuPreparationFailure(error), `${message}\n`);
  return true;
};
const hostilePackets = () => {
  const message = isolationMessages[0];
  const maximum = Math.max(...allChildMessages.map((code) => Buffer.byteLength(`${code}\n`, "ascii")));
  return [
    Buffer.from("gosu_offline_network_invalid\ngosu_isolation_reason_unknown\n"),
    Buffer.from(`${message}\ngosu_cleanup_failed\n`), Buffer.from(`${message}\r\n`),
    Buffer.from(message.replace("\n", "\r\n") + "\n"), Buffer.from(`\x1b[31m${message}\n`),
    Buffer.from(`${message}\0\n`), Buffer.from(`${message}é\n`), Buffer.from(message),
    Buffer.from(`${message}\n\n`), Buffer.from(`x${message}\n`), Buffer.from(`${message}x\n`),
    Buffer.alloc(maximum + 1, 0x61), Buffer.from(`${childCodes[0]}\ngosu_cleanup_failed\n`),
    Buffer.from(`${childCodes[0]}\r\n`), Buffer.from(`${childCodes[0]}\n\n`),
    Buffer.from(`${message}\n`.replace("gosu_isolation_reason_", "gosu_isolation_reason_é")),
  ];
};

test("all eight command stages expose five closed failure reasons without private data", () => {
  assert.equal(stages.length, 8);
  for (const stage of stages) for (const reason of reasons) {
    const result = failure(reason); result.stdout = Buffer.from("secret-stdout"); result.stderr = Buffer.from("secret-stderr");
    assert.throws(() => invoke(stage, () => result), (error) => {
      assert.equal(error.message, `gosu_command_failed_${stage}_${reason}`);
      for (const secret of ["secret-command", "secret-argument", "secret-cwd", "secret-environment", "secret-stdout", "secret-stderr", "secret-error", "SIGKILL", "EACCES"]) assert.equal(error.message.includes(secret), false);
      return true;
    });
  }
});

test("unknown stages fail before runner invocation and thrown runners classify as spawn", () => {
  let invoked = false;
  assert.throws(() => invoke("unknown", () => { invoked = true; return success(); }), /^Error: gosu_command_stage_invalid$/u);
  assert.equal(invoked, false);
  assert.throws(() => invoke("online_go_version", () => { throw new Error("secret-thrown"); }), /^Error: gosu_command_failed_online_go_version_spawn$/u);
});

test("error precedence is timeout then output limit then spawn before signal and exit", () => {
  for (const [code, reason] of [["ETIMEDOUT", "timeout"], ["ENOBUFS", "output_limit"], ["EACCES", "spawn"]]) {
    const error = Object.assign(new Error("secret"), { code });
    const results = [
      { error },
      { error, signal: undefined, status: undefined, stdout: null, stderr: null },
      { error, signal: null, status: null, stdout: null, stderr: null },
      { error, signal: { hostile: true }, status: "hostile", stdout: "malformed", stderr: 42 },
      { ...success(), error, signal: "SIGTERM", status: 17, stdout: "malformed", stderr: null },
    ];
    for (const result of results) assert.throws(() => invoke("online_mod_download", () => result), new RegExp(`^Error: gosu_command_failed_online_mod_download_${reason}$`, "u"));
  }
  assert.throws(() => invoke("online_mod_verify", () => ({ ...success(), signal: "SIGTERM", status: 17 })), /^Error: gosu_command_failed_online_mod_verify_signal$/u);
});

test("success and result shapes are strict and separate from command failure", () => {
  assert.deepEqual(invoke("online_go_version", success), { status: 0, stdout: Buffer.from("ok"), stderr: Buffer.alloc(0) });
  const malformed = [
    undefined, null, [], {}, { ...success(), error: null }, { ...success(), error: "error" },
    { ...success(), signal: "" }, { ...success(), signal: 9 }, { ...success(), status: null },
    { ...success(), status: 1.5 }, { ...success(), stdout: "ok" }, { ...success(), stderr: new Uint8Array() },
  ];
  for (const result of malformed) assert.throws(() => invoke("online_go_version", () => result), /^Error: gosu_command_result_invalid$/u);
});

test("offline isolation propagates every and only exact allowlisted child line on ordinary exit", () => {
  assert.equal(childCodes.length, 35);
  for (const code of childCodes) {
    assert.throws(() => invoke("offline_isolation", () => ({ ...failure("exit"), stdout: Buffer.from("ignored-secret"), stderr: Buffer.from(`${code}\n`, "ascii") })), new RegExp(`^Error: ${code}$`, "u"));
  }
  const maximum = Math.max(...childCodes.map((code) => Buffer.byteLength(`${code}\n`, "ascii")));
  const hostile = [
    Buffer.from("gosu_unknown\n"), Buffer.from("gosu_\n"), Buffer.from(`${childCodes[0]}\ngosu_cleanup_failed\n`),
    Buffer.from(`${childCodes[0]}\r\n`), Buffer.from(`\x1b[31m${childCodes[0]}\n`), Buffer.from(`${childCodes[0]}\0\n`),
    Buffer.from(`${childCodes[0]}é\n`), Buffer.from(childCodes[0]), Buffer.from(`${childCodes[0]}\n\n`),
    Buffer.from(`x${childCodes[0]}\n`), Buffer.from(`${childCodes[0]}x\n`), Buffer.alloc(maximum + 1, 0x61),
  ];
  for (const stderr of hostile) assert.throws(() => invoke("offline_isolation", () => ({ ...failure("exit"), stderr })), /^Error: gosu_command_failed_offline_isolation_exit$/u);
  for (const reason of ["spawn", "timeout", "output_limit", "signal"]) {
    assert.throws(() => invoke("offline_isolation", () => ({ ...failure(reason), stderr: Buffer.from(`${childCodes[0]}\n`) })), new RegExp(`^Error: gosu_command_failed_offline_isolation_${reason}$`, "u"));
  }
});

test("both relays propagate all 35 historical lines and 47 fixed two-line packets on ordinary exit", async () => {
  assert.equal(childCodes.length, 35); assert.equal(isolationMessages.length, 47);
  assert.equal(new Set(allChildMessages).size, 82);
  for (const message of allChildMessages) {
    const result = { ...failure("exit"), stdout: Buffer.from("secret-stdout"), stderr: Buffer.from(`${message}\n`, "ascii") };
    assert.throws(() => invoke("offline_isolation", () => result), exactMessage(message));
    const { promise, calls } = await invokeSetup(result);
    await assert.rejects(promise, exactMessage(message));
    assert.deepEqual(calls, ["/usr/bin/mount", "/usr/bin/setpriv"]);
  }
});

test("both relays reject malformed, foreign and false-cleanup packets without private leakage", async () => {
  for (const stderr of [...hostilePackets(), "secret-stderr", null, new Uint8Array([1, 2])]) {
    const result = { ...failure("exit"), stdout: Buffer.from("secret-stdout"), stderr };
    const invalid = !Buffer.isBuffer(stderr);
    assert.throws(() => invoke("offline_isolation", () => result), exactMessage(invalid ? "gosu_command_result_invalid" : "gosu_command_failed_offline_isolation_exit"));
    const { promise, calls } = await invokeSetup(result);
    await assert.rejects(promise, exactMessage(`gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_${invalid ? "result_invalid" : "exit"}`));
    assert.deepEqual(calls, ["/usr/bin/mount", "/usr/bin/setpriv"]);
  }
});

test("exact packets cannot override thrown runners, Error codes, signals or malformed result types", async () => {
  for (const message of allChildMessages) for (const reason of ["spawn", "timeout", "output_limit", "signal"]) {
    const result = { ...failure(reason), stderr: Buffer.from(`${message}\n`, "ascii") };
    assert.throws(() => invoke("offline_isolation", () => result), exactMessage(`gosu_command_failed_offline_isolation_${reason}`));
    const { promise } = await invokeSetup(result);
    await assert.rejects(promise, exactMessage(`gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_${reason}`));
  }
  const packet = Buffer.from(`${isolationMessages[0]}\n`, "ascii");
  for (const result of [
    undefined, null, [], {}, { ...success(), error: null, stderr: packet },
    { ...success(), error: "secret-error", stderr: packet }, { ...success(), signal: "", stderr: packet },
    { ...success(), signal: 9, stderr: packet }, { ...success(), status: null, stderr: packet },
    { ...success(), status: 1.5, stderr: packet }, { ...success(), status: "1", stderr: packet },
    { ...success(), status: undefined, stderr: packet }, { ...success(), stdout: "secret-output", stderr: packet },
    { ...success(), stderr: new Uint8Array() },
    Object.defineProperty({}, "error", { get() { throw new Error("secret-getter"); } }),
  ]) {
    assert.throws(() => invoke("offline_isolation", () => result), exactMessage("gosu_command_result_invalid"));
    const { promise } = await invokeSetup(result);
    await assert.rejects(promise, exactMessage("gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_result_invalid"));
  }
  const throwing = () => { throw new Error("secret-thrown-runner"); };
  assert.throws(() => invoke("offline_isolation", throwing), exactMessage("gosu_command_failed_offline_isolation_spawn"));
  const { promise } = await invokeSetup(throwing);
  await assert.rejects(promise, exactMessage("gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_spawn"));
});

test("Error classification precedes malformed signal and status and ignores foreign Error properties", async () => {
  for (const [code, reason] of [["ETIMEDOUT", "timeout"], ["ENOBUFS", "output_limit"], ["EACCES", "spawn"]]) {
    const error = Object.assign(new Error("secret-error"), { code, isolationReason: "secret-reason", childPacket: isolationMessages[0] });
    for (const result of [
      { error }, { error, signal: {}, status: "secret-status", stdout: null, stderr: Buffer.from(`${isolationMessages[0]}\n`) },
    ]) {
      assert.throws(() => invoke("offline_isolation", () => result), exactMessage(`gosu_command_failed_offline_isolation_${reason}`));
      const { promise } = await invokeSetup(result);
      await assert.rejects(promise, exactMessage(`gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_${reason}`));
    }
  }
  const error = Object.defineProperty(new Error("secret-error"), "code", { get() { throw new Error("secret-code-getter"); } });
  const result = { ...success(), error, stderr: Buffer.from(`${isolationMessages[0]}\n`) };
  assert.throws(() => invoke("offline_isolation", () => result), exactMessage("gosu_command_failed_offline_isolation_spawn"));
  const { promise } = await invokeSetup(result);
  await assert.rejects(promise, exactMessage("gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_spawn"));
});

test("two-line primary packets retain exactly one wire LF and only a real parent cleanup marker", async () => {
  for (const message of isolationMessages) {
    const primary = new Error(message);
    assert.equal(primary.message.endsWith("\n"), false);
    assert.equal(formatGosuPreparationFailure(primary), `${message}\n`);
    await assert.rejects(completeOwnedGosuScratch(primary, "invalid", "invalid"), (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.equal(error.errors[0], primary);
      assert.equal(formatGosuPreparationFailure(error), `${message}\ngosu_cleanup_failed\n`);
      return true;
    });
  }
});

test("cleanup formatting preserves one primary and adds one marker only for parent cleanup failure", async () => {
  const primary = new Error("gosu_command_failed_offline_isolation_exit");
  const cleanup = new Error("gosu_cleanup_failed");
  assert.equal(formatGosuPreparationFailure(primary), "gosu_command_failed_offline_isolation_exit\n");
  assert.equal(formatGosuPreparationFailure(new AggregateError([primary, cleanup], primary.message)), "gosu_command_failed_offline_isolation_exit\ngosu_cleanup_failed\n");
  await assert.rejects(completeOwnedGosuScratch(primary, "invalid", "invalid"), (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(formatGosuPreparationFailure(error), "gosu_command_failed_offline_isolation_exit\ngosu_cleanup_failed\n");
    return true;
  });
});

test("production sites have eight exact labels and receipt helper closure remains three fixed files", async () => {
  const source = await readFile(new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url), "utf8");
  const labels = [...source.matchAll(/\brun\("([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(labels, stages);
  assert.equal(source.includes("allowFailure"), false);
  const controls = await readFile(new URL("../scripts/postgres-image/gosu-derivative-controls-v1.mjs", import.meta.url), "utf8");
  assert.match(controls, /helper: \{ build: await fileIdentity\(buildFile\), controls: await fileIdentity\(scriptFile\), archives: await fileIdentity\(archivesFile\) \}/u);
});

function offlineCli(script, repeat) {
  const environment = { ...process.env, NODE_OPTIONS: "", NODE_PATH: "", AW_GOSU_SCRATCH: "PRIVATE_SENTINEL", AW_GOSU_OUTPUT: "PRIVATE_SENTINEL" };
  const result = spawnSync(process.execPath, [script, "offline", repeat], { env: environment, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: null, windowsHide: true });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1);
  assert.deepEqual(result.stdout, Buffer.alloc(0));
  return result.stderr;
}

test("ordinary pinned offline CLI with valid repository lock diagnoses invalid repeat before Go", () => {
  assert.equal(process.version, "v22.23.2");
  assert.deepEqual(offlineCli(TEST_ONLY.scriptFile, "3"), Buffer.from(`${childMainMessage("arguments_invalid")}\n`, "ascii"));
});

test("ordinary pinned offline CLI in private three-helper copy diagnoses its absent relative lock", async () => {
  assert.equal(process.version, "v22.23.2");
  const temporary = await mkdtemp(path.join(tmpdir(), "aw-gosu-child-failure-"));
  try {
    const scripts = path.join(temporary, "scripts", "postgres-image"); await mkdir(scripts, { recursive: true });
    for (const name of ["gosu-derivative-build-v1.mjs", "gosu-derivative-controls-v1.mjs", "gosu-derivative-archives-v1.mjs"]) await copyFile(path.join(path.dirname(TEST_ONLY.scriptFile), name), path.join(scripts, name));
    assert.deepEqual(offlineCli(path.join(scripts, "gosu-derivative-build-v1.mjs"), "1"), Buffer.from(`${childMainMessage("lock_read_path_unavailable")}\n`, "ascii"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("outer relay rejects malformed stdout before propagating an exact legacy stderr packet on nonzero exit", () => {
  const result = { ...failure("exit"), stdout: "PRIVATE_SENTINEL", stderr: Buffer.from(`${childCodes[0]}\n`, "ascii") };
  assert.throws(() => invoke("offline_isolation", () => result), exactMessage("gosu_command_result_invalid"));
});

test("setpriv relay rejects malformed stdout before propagating an exact legacy stderr packet on nonzero exit", async () => {
  const result = { ...failure("exit"), stdout: "PRIVATE_SENTINEL", stderr: Buffer.from(`${childCodes[0]}\n`, "ascii") };
  const { promise } = await invokeSetup(result);
  await assert.rejects(promise, exactMessage("gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_result_invalid"));
});

test("both relays propagate exactly all 26 fixed child-main packets and preserve all 82 legacy messages", async () => {
  assert.equal(childMainMessages.length, 26); assert.equal(new Set(childMainMessages).size, 26);
  assert.equal(new Set([...allChildMessages, ...childMainMessages]).size, 108);
  for (const message of [...allChildMessages, ...childMainMessages]) {
    assert.equal(message.endsWith("\n"), false); assert.match(message, /^[\x20-\x7e\n]+$/u);
    assert.equal(TEST_ONLY.formatChildMainFailure(new Error(message), true), `${message}\n`);
    const result = { ...failure("exit"), stderr: Buffer.from(`${message}\n`, "ascii") };
    assert.throws(() => invoke("offline_isolation", () => result), exactMessage(message));
    const { promise } = await invokeSetup(result); await assert.rejects(promise, exactMessage(message));
  }
});

test("three-line child packets reject every byte deviation, foreign reason and false cleanup marker", async () => {
  for (const message of childMainMessages) {
    const packets = [message, `${message}\n\n`, `${message}\r\n`, `${message}\0\n`, `${message}é\n`, `${message}\ngosu_cleanup_failed\n`, `${message.slice(1)}\n`, `PRIVATE_SENTINEL\n${message}\n`, `${message}\nPRIVATE_SENTINEL`, `${message.replace("gosu_child_main_entered", "gosu_child_main_enteredx")}\n`];
    for (const packet of packets) {
      const result = { ...failure("exit"), stderr: Buffer.from(packet) };
      assert.throws(() => invoke("offline_isolation", () => result), exactMessage("gosu_command_failed_offline_isolation_exit"));
      const { promise } = await invokeSetup(result); await assert.rejects(promise, exactMessage("gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_exit"));
    }
  }
  const maximum = Math.max(...[...allChildMessages, ...childMainMessages].map((message) => Buffer.byteLength(`${message}\n`, "ascii")));
  for (const stderr of [Buffer.from(`${childMainMessage("PRIVATE_SENTINEL")}\n`), Buffer.alloc(maximum + 1, 0x61)]) {
    const result = { ...failure("exit"), stderr };
    assert.throws(() => invoke("offline_isolation", () => result), exactMessage("gosu_command_failed_offline_isolation_exit"));
    const { promise } = await invokeSetup(result); await assert.rejects(promise, exactMessage("gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_exit"));
  }
});

test("every child-main packet preserves Error, shape and signal priorities before both-Buffer rejection", async () => {
  for (const message of childMainMessages) {
    for (const reason of ["spawn", "timeout", "output_limit", "signal"]) {
      const result = { ...failure(reason), stdout: "PRIVATE_SENTINEL", stderr: Buffer.from(`${message}\n`) };
      assert.throws(() => invoke("offline_isolation", () => result), exactMessage(`gosu_command_failed_offline_isolation_${reason}`));
      const { promise } = await invokeSetup(result); await assert.rejects(promise, exactMessage(`gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_${reason}`));
    }
    for (const result of [
      { ...failure("exit"), stdout: null, stderr: Buffer.from(`${message}\n`) },
      { ...failure("exit"), stdout: new Uint8Array(), stderr: Buffer.from(`${message}\n`) },
      { ...failure("exit"), stderr: "PRIVATE_SENTINEL" }, { ...failure("exit"), signal: {}, stderr: Buffer.from(`${message}\n`) },
      { ...failure("exit"), status: 1.5, stderr: Buffer.from(`${message}\n`) },
    ]) {
      assert.throws(() => invoke("offline_isolation", () => result), exactMessage("gosu_command_result_invalid"));
      const { promise } = await invokeSetup(result); await assert.rejects(promise, exactMessage("gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_result_invalid"));
    }
  }
});

test("child-aware formatter reads only guarded own Error messages and never diagnostic getters", () => {
  let getters = 0;
  const revoked = Proxy.revocable(new Error("PRIVATE_SENTINEL"), {}); revoked.revoke();
  const inherited = new Error(); delete inherited.message; Object.setPrototypeOf(inherited, Object.create(Error.prototype, { message: { get() { getters += 1; return childMainMessages[0]; } } }));
  for (const error of [
    null, "PRIVATE_SENTINEL", { message: childMainMessages[0] }, { message: "PRIVATE_SENTINEL" }, new Error("gosu_PRIVATE_SENTINEL"),
    new Error(`${childMainMessages[0]}\n`), new Error(`${childMainMessages[0]}\ngosu_cleanup_failed`),
    Object.defineProperty(new Error(), "message", { get() { getters += 1; throw new Error("PRIVATE_SENTINEL"); } }), inherited,
    new Proxy(new Error(), { getOwnPropertyDescriptor() { throw new Error("PRIVATE_SENTINEL"); } }),
    new Proxy(new Error(), { getPrototypeOf() { throw new Error("PRIVATE_SENTINEL"); } }), revoked.proxy,
    new AggregateError([new Error(childMainMessages[0]), new Error("PRIVATE_SENTINEL")], "PRIVATE_SENTINEL"),
  ]) assert.equal(TEST_ONLY.formatChildMainFailure(error, true), `${childMainMessage("main_unclassified")}\n`);
  const safe = new Error(childMainMessages[0]);
  for (const name of ["stack", "code", "cause", "path", "childPacket", "isolationReason"]) Object.defineProperty(safe, name, { get() { getters += 1; throw new Error("PRIVATE_SENTINEL"); } });
  assert.equal(TEST_ONLY.formatChildMainFailure(safe, true), `${childMainMessages[0]}\n`); assert.equal(getters, 0);
  assert.equal(TEST_ONLY.formatChildMainFailure(new Error("gosu_node_runtime_invalid"), false), "gosu_node_runtime_invalid\n");
  assert.equal(formatGosuPreparationFailure(new Error("gosu_PRIVATE_SENTINEL")), "gosu_PRIVATE_SENTINEL\n");
});

test("all child-main packets remain primary and only real parent cleanup appends its marker", async () => {
  for (const message of childMainMessages) {
    const primary = new Error(message);
    assert.equal(formatGosuPreparationFailure(primary), `${message}\n`);
    await assert.rejects(completeOwnedGosuScratch(primary, "invalid", "invalid"), (error) => {
      assert.equal(error instanceof AggregateError, true); assert.equal(error.errors[0], primary);
      assert.equal(formatGosuPreparationFailure(error), `${message}\ngosu_cleanup_failed\n`); return true;
    });
  }
});

test("successful relay results preserve packet-shaped stderr and thrown result proxies remain closed failures", async () => {
  for (const message of childMainMessages) {
    const result = { ...success(), stderr: Buffer.from(`${message}\n`, "ascii") };
    assert.deepEqual(invoke("offline_isolation", () => result), { status: 0, stdout: result.stdout, stderr: result.stderr });
    const { promise } = await invokeSetup(result); await promise;
  }
  for (const result of [
    new Proxy({}, { get() { throw new Error("PRIVATE_SENTINEL"); } }),
    Object.defineProperty({ ...failure("exit") }, "stderr", { get() { throw new Error("PRIVATE_SENTINEL"); } }),
    Object.defineProperty({ ...failure("exit") }, "stdout", { get() { throw new Error("PRIVATE_SENTINEL"); } }),
  ]) {
    assert.throws(() => invoke("offline_isolation", () => result), exactMessage("gosu_command_result_invalid"));
    const { promise } = await invokeSetup(result); await assert.rejects(promise, exactMessage("gosu_offline_network_invalid\ngosu_isolation_reason_setup_setpriv_result_invalid"));
  }
});

test("real owned parent cleanup preserves the exact child primary without inventing a cleanup marker", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "aw-gosu-child-parent-cleanup-"));
  const scratch = path.join(temporary, "aw-gosu-preparation-1"); const preserved = path.join(temporary, "preserved.txt");
  try {
    await mkdir(scratch); await writeFile(path.join(scratch, "private.txt"), "PRIVATE_SENTINEL", { flag: "wx" });
    await writeFile(preserved, "retained", { flag: "wx" }); const primary = new Error(childMainMessages[0]);
    await assert.rejects(completeOwnedGosuScratch(primary, scratch, temporary), (error) => { assert.equal(error, primary); assert.equal(formatGosuPreparationFailure(error), `${childMainMessages[0]}\n`); return true; });
    await assert.rejects(readFile(path.join(scratch, "private.txt")), { code: "ENOENT" });
    assert.equal(await readFile(preserved, "utf8"), "retained");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
