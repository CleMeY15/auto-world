import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TEST_ONLY, assertNetworkNamespaceChanged, formatGosuPreparationFailure, namespaceTransitionIdentity, readNetworkNamespaceIdentity } from "../scripts/postgres-image/gosu-derivative-build-v1.mjs";

const setup = {
  repeat: "1", scratch: "/runner/aw-gosu-preparation-1", output: "/runner/gosu-preparation-1",
  uid: "1000", gid: "1001", originalNetns: "net:[100]", originalMntns: "mnt:[200]",
  ci: { runId: "300", runAttempt: "1", headSha: "a".repeat(40), job: "build_1" },
};
const success = { error: undefined, signal: null, status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
const copy = (value) => JSON.parse(JSON.stringify(value));

test("outer isolation argv creates private mount and network namespaces with a closed setup environment", () => {
  const invocation = TEST_ONLY.buildOuterIsolationInvocation(setup);
  assert.equal(invocation.command, "/usr/bin/sudo");
  assert.deepEqual(invocation.options, { cwd: TEST_ONLY.repo, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 70 * 60_000, cap: 1024 * 1024 });
  const prefix = ["-n", "--", "/usr/bin/unshare", "--mount", "--propagation", "private", "--net", "--", "/usr/bin/env", "-i"];
  assert.deepEqual(invocation.args.slice(0, prefix.length), prefix);
  assert.deepEqual(invocation.args.slice(-4), [process.execPath, TEST_ONLY.scriptFile, "offline-setup", "1"]);
  const assignments = invocation.args.slice(prefix.length, -4);
  assert.deepEqual(assignments, [
    "AW_GOSU_ORIGINAL_NETNS=net:[100]", "AW_GOSU_ORIGINAL_MNTNS=mnt:[200]", "AW_GOSU_EXPECT_UID=1000",
    "AW_GOSU_EXPECT_GID=1001", "AW_GOSU_REPEAT=1", "AW_GOSU_SCRATCH=/runner/aw-gosu-preparation-1",
    "AW_GOSU_OUTPUT=/runner/gosu-preparation-1", "AW_GOSU_CI_RUN_ID=300", "AW_GOSU_CI_RUN_ATTEMPT=1",
    `AW_GOSU_CI_HEAD_SHA=${"a".repeat(40)}`, "AW_GOSU_CI_JOB=build_1",
  ]);
  assert.equal(assignments.some((value) => /(?:HOME|TMPDIR|GOENV|GOCACHE|GOMODCACHE|GOPATH|GOPROXY|GOSUMDB)=/u.test(value)), false);
});

test("setup inputs require canonical positive uint32 ids, exact repeat, namespaces and owned paths", () => {
  assert.doesNotThrow(() => TEST_ONLY.buildOuterIsolationInvocation({ ...setup, uid: "4294967294", gid: "4294967294" }));
  for (const mutate of [
    (x) => { x.uid = "0"; }, (x) => { x.uid = "01"; }, (x) => { x.uid = "4294967295"; }, (x) => { x.uid = "NaN"; },
    (x) => { x.gid = "-1"; }, (x) => { x.repeat = "3"; }, (x) => { x.originalNetns = "net:[0]"; },
    (x) => { x.originalMntns = "mnt:[x]"; }, (x) => { x.scratch = "relative"; },
    (x) => { x.scratch = "/runner/aw-gosu-preparation-2"; }, (x) => { x.output = "/other/gosu-preparation-1"; },
  ]) {
    const changed = copy(setup); mutate(changed);
    assert.throws(() => TEST_ONLY.buildOuterIsolationInvocation(changed), /gosu_offline_network_invalid/u);
  }
});

test("root setup validates namespaces and sysfs before fixed mount then fixed privilege drop", async () => {
  const events = [];
  const adapters = {
    platform: "linux", geteuid: () => 0,
    readlink: async (name) => { events.push(["readlink", name]); return name.endsWith("/net") ? "net:[101]" : "mnt:[201]"; },
    lstat: async (name) => { events.push(["lstat", name]); return { isDirectory: () => true, isSymbolicLink: () => false }; },
    runner: (command, args, options) => { events.push(["run", command, args, options]); return success; },
  };
  await TEST_ONLY.runOfflineSetup(TEST_ONLY.setupEnvironment(setup), adapters);
  const runs = events.filter(([kind]) => kind === "run");
  assert.equal(events.findIndex(([kind]) => kind === "lstat") < events.findIndex(([kind]) => kind === "run"), true);
  assert.deepEqual(runs[0].slice(1, 3), ["/usr/bin/mount", ["--internal-only", "--no-canonicalize", "--types", "sysfs", "--options", "ro,nosuid,nodev,noexec", "--source", "sysfs", "--target", "/sys"]]);
  assert.equal(runs[1][1], "/usr/bin/setpriv");
  assert.deepEqual(runs[1][2].slice(0, 9), ["--reuid=1000", "--regid=1001", "--clear-groups", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--", "/usr/bin/env"]);
  assert.equal(runs[1][2].includes("-i"), true);
  assert.equal(runs[1][2].includes("AW_GOSU_ORIGINAL_MNTNS=mnt:[200]"), true);
  assert.equal(runs[1][2].includes("GOPROXY=off"), true);
  assert.deepEqual(runs[1][2].slice(-4), [process.execPath, TEST_ONLY.scriptFile, "offline", "1"]);
});

test("setup rejects reuse, malformed sysfs and mount failure without privilege drop or fallback", async () => {
  const environment = TEST_ONLY.setupEnvironment(setup);
  for (const commandArguments of [["offline-setup"], ["offline-setup", "1", "extra"], ["offline-setup", "2"], ["offline-setup", "01"]]) {
    let calls = 0;
    await assert.rejects(TEST_ONLY.runOfflineSetup(environment, { runner: () => { calls += 1; return success; } }, commandArguments), /gosu_offline_network_invalid/u);
    assert.equal(calls, 0);
  }
  for (const adapters of [
    { platform: "win32", geteuid: () => 0 },
    { platform: "linux", geteuid: () => 1000 },
  ]) await assert.rejects(TEST_ONLY.runOfflineSetup(environment, adapters), /gosu_offline_network_invalid/u);
  for (const variant of [
    { net: "net:[100]", mnt: "mnt:[201]", info: { isDirectory: () => true, isSymbolicLink: () => false } },
    { net: "net:[101]", mnt: "mnt:[200]", info: { isDirectory: () => true, isSymbolicLink: () => false } },
    { net: "bad", mnt: "mnt:[201]", info: { isDirectory: () => true, isSymbolicLink: () => false } },
    { net: "net:[101]", mnt: "mnt:[201]", info: { isDirectory: () => false, isSymbolicLink: () => false } },
    { net: "net:[101]", mnt: "mnt:[201]", info: { isDirectory: () => true, isSymbolicLink: () => true } },
  ]) {
    let runs = 0;
    await assert.rejects(TEST_ONLY.runOfflineSetup(environment, {
      platform: "linux", geteuid: () => 0, readlink: async (name) => name.endsWith("/net") ? variant.net : variant.mnt,
      lstat: async () => variant.info, runner: () => { runs += 1; return success; },
    }), /gosu_offline_network_invalid/u);
    assert.equal(runs, 0);
  }
  const commands = [];
  await assert.rejects(TEST_ONLY.runOfflineSetup(environment, {
    platform: "linux", geteuid: () => 0, readlink: async (name) => name.endsWith("/net") ? "net:[101]" : "mnt:[201]",
    lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    runner: (command) => { commands.push(command); return { ...success, status: 1 }; },
  }), /gosu_offline_network_invalid/u);
  assert.deepEqual(commands, ["/usr/bin/mount"]);
  let calls = 0;
  await assert.rejects(TEST_ONLY.runOfflineSetup(environment, {
    platform: "linux", geteuid: () => 0, readlink: async (name) => name.endsWith("/net") ? "net:[101]" : "mnt:[201]",
    lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
    runner: () => { calls += 1; return calls === 1 ? success : { ...success, status: 1, stderr: Buffer.from("gosu_tests_failed\n") }; },
  }), /^Error: gosu_tests_failed$/u);
  assert.equal(calls, 2);
  for (const result of [
    { ...success, error: new Error("private") }, { ...success, signal: "SIGKILL", status: null },
    { ...success, status: 1, stderr: Buffer.from("gosu_tests_failed\nextra\n") },
    { ...success, status: 1, stderr: Buffer.from("private\n") }, { ...success, stdout: null },
  ]) {
    let count = 0;
    await assert.rejects(TEST_ONLY.runOfflineSetup(environment, {
      platform: "linux", geteuid: () => 0, readlink: async (name) => name.endsWith("/net") ? "net:[101]" : "mnt:[201]",
      lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
      runner: () => { count += 1; return count === 1 ? success : result; },
    }), /gosu_offline_network_invalid/u);
  }
});

test("ordinary boundary requires changed namespaces, only lo, strict loopback-down flags and empty routes", () => {
  const observation = {
    platform: "linux", euid: 1000, egid: 1001, groups: [1001], expectedUid: "1000", expectedGid: "1001",
    originalNetns: "net:[100]", netns: "net:[101]", originalMntns: "mnt:[200]", mntns: "mnt:[201]",
    nodeOptions: "", nodePath: "", goenv: "off", gotoolchain: "local", gowork: "off", goproxy: "off", gosumdb: "off", goflags: "",
    status: "CapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\nNoNewPrivs:\t1\n",
    routes: "Iface\tDestination\n", interfaces: ["lo"], loopbackFlags: "0x8\n",
  };
  assert.equal(TEST_ONLY.validateOfflineNetworkObservation(observation).checks.loopbackDown, true);
  const emptyRoutes = copy(observation); emptyRoutes.routes = "";
  assert.deepEqual(TEST_ONLY.validateOfflineNetworkObservation(emptyRoutes).evidence.routes, {
    bytes: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  });
  for (const mutate of [
    (x) => { x.platform = "win32"; }, (x) => { x.euid = 0; }, (x) => { x.expectedUid = "NaN"; },
    (x) => { x.egid = 1002; }, (x) => { x.groups = [1001, 1002]; }, (x) => { x.nodeOptions = "--inspect"; },
    (x) => { x.goproxy = "https://proxy.golang.org"; }, (x) => { x.status = x.status.replace("CapEff:\t0000000000000000", "CapEff:\t0000000000000001"); },
    (x) => { x.status = x.status.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0"); },
    (x) => { x.netns = x.originalNetns; }, (x) => { x.mntns = x.originalMntns; }, (x) => { x.mntns = "bad"; },
    (x) => { x.interfaces = ["eth0", "lo"]; }, (x) => { x.interfaces = []; }, (x) => { x.loopbackFlags = "0x9\n"; },
    (x) => { x.loopbackFlags = "8\n"; }, (x) => { x.loopbackFlags = "0x08\n"; }, (x) => { x.loopbackFlags = "0xg\n"; },
    (x) => { x.loopbackFlags = "0x0\n"; }, (x) => { x.loopbackFlags = "0x100000008\n"; },
    (x) => { x.loopbackFlags = null; }, (x) => { x.routes += "lo\t00000000\n"; },
    (x) => { x.routes = "x".repeat(1024 * 1024 + 1); }, (x) => { x.routes = null; },
  ]) {
    const changed = copy(observation); mutate(changed);
    assert.throws(() => TEST_ONLY.validateOfflineNetworkObservation(changed), /gosu_offline_(?:environment|identity|privilege|network|evidence)_invalid/u);
  }
});

test("offline setup dispatch precedes lock loading and privileged code has no archive or Go path", async () => {
  const source = await readFile(new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url), "utf8");
  const main = source.slice(source.indexOf("async function main("));
  assert.equal(main.indexOf('command === "offline-setup"') >= 0 && main.indexOf('command === "offline-setup"') < main.indexOf("adapters.loadLock("), true);
  const setupBody = source.slice(source.indexOf("async function runOfflineSetup"), source.indexOf("async function offlinePhase"));
  for (const forbidden of ["loadLock(", "buildOnline(", "offlinePhase(", "scanGzipTar(", "writeFile(", 'run("offline_go_']) assert.equal(setupBody.includes(forbidden), false);
  assert.match(source, /function run\(stage, command, args, options\) \{ return runCommand\(stage, command, args, options, spawnSync\); \}/u);
});

const isolationMessage = (reason) => `gosu_offline_network_invalid\ngosu_isolation_reason_${reason}`;
const setupAdapters = (runner) => ({
  platform: "linux", geteuid: () => 0,
  readlink: async (name) => name.endsWith("/net") ? "net:[101]" : "mnt:[201]",
  lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false }), runner,
});
const boundaryObservation = () => ({
  platform: "linux", euid: 1000, egid: 1001, groups: [1001], expectedUid: "1000", expectedGid: "1001",
  originalNetns: "net:[100]", netns: "net:[101]", originalMntns: "mnt:[200]", mntns: "mnt:[201]",
  nodeOptions: "", nodePath: "", goenv: "off", gotoolchain: "local", gowork: "off", goproxy: "off", gosumdb: "off", goflags: "",
  status: "CapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\nNoNewPrivs:\t1\n",
  routes: "Iface\tDestination\n", interfaces: ["lo"], loopbackFlags: "0x8\n",
});

test("a rejected mount exit retains the exact isolation packet and never starts setpriv", async () => {
  const commands = [];
  await assert.rejects(TEST_ONLY.runOfflineSetup(TEST_ONLY.setupEnvironment(setup), setupAdapters((command) => {
    commands.push(command); return { ...success, status: 17, stdout: Buffer.from("private-output"), stderr: Buffer.from("private-error") };
  })), (error) => { assert.equal(error.message, isolationMessage("setup_mount_exit")); return true; });
  assert.deepEqual(commands, ["/usr/bin/mount"]);
});

test("an observed loopback UP rejection retains its exact isolation packet", () => {
  const observation = boundaryObservation(); observation.loopbackFlags = "0x9\n";
  assert.throws(() => TEST_ONLY.validateOfflineNetworkObservation(observation), (error) => {
    assert.equal(error.message, isolationMessage("boundary_loopback_up")); return true;
  });
});

const exactIsolation = (reason) => (error) => {
  assert.equal(error.message, isolationMessage(reason));
  assert.equal(formatGosuPreparationFailure(error), `${isolationMessage(reason)}\n`);
  for (const privateText of ["PRIVATE_SENTINEL", "/runner", "net:[", "mnt:[", "SIGKILL", "ETIMEDOUT", "ENOBUFS"]) assert.equal(error.message.includes(privateText), false);
  return true;
};

test("all scalar setup rejections map to fixed reasons without invoking any command", async () => {
  const cases = [
    ["repeat_invalid", (x) => { x.repeat = "PRIVATE_SENTINEL"; }],
    ["uid_invalid", (x) => { x.uid = "PRIVATE_SENTINEL"; }],
    ["gid_invalid", (x) => { x.gid = "PRIVATE_SENTINEL"; }],
    ["original_netns_invalid", (x) => { x.originalNetns = "PRIVATE_SENTINEL"; }],
    ["original_mntns_invalid", (x) => { x.originalMntns = "PRIVATE_SENTINEL"; }],
    ["scratch_invalid", (x) => { x.scratch = "PRIVATE_SENTINEL"; }],
    ["output_invalid", (x) => { x.output = "PRIVATE_SENTINEL"; }],
    ["owned_paths_invalid", (x) => { x.output = "/PRIVATE_SENTINEL/gosu-preparation-1"; }],
    ["ci_invalid", (x) => { x.ci = "PRIVATE_SENTINEL"; }],
    ["run_id_invalid", (x) => { x.ci.runId = "PRIVATE_SENTINEL"; }],
    ["run_attempt_invalid", (x) => { x.ci.runAttempt = "PRIVATE_SENTINEL"; }],
    ["head_sha_invalid", (x) => { x.ci.headSha = "PRIVATE_SENTINEL"; }],
    ["job_invalid", (x) => { x.ci.job = "PRIVATE_SENTINEL"; }],
  ];
  for (const [reason, mutate] of cases) {
    const changed = copy(setup); mutate(changed);
    assert.throws(() => TEST_ONLY.setupEnvironment(changed), exactIsolation(reason));
    assert.throws(() => TEST_ONLY.buildOuterIsolationInvocation(changed), exactIsolation(reason));
  }
  const environment = TEST_ONLY.setupEnvironment(setup); let calls = 0;
  const adapters = setupAdapters(() => { calls += 1; return success; });
  for (const commandArguments of [null, [], ["PRIVATE_SENTINEL", "1"], ["offline-setup", "1", "PRIVATE_SENTINEL"], ["offline-setup", "2"]]) {
    await assert.rejects(TEST_ONLY.runOfflineSetup(environment, adapters, commandArguments), exactIsolation("setup_arguments_invalid"));
  }
  for (const changed of [null, [], { ...environment, PRIVATE_SENTINEL: "PRIVATE_SENTINEL" }, { AW_GOSU_REPEAT: "1" }]) {
    await assert.rejects(TEST_ONLY.runOfflineSetup(changed, adapters, ["offline-setup", "1"]), exactIsolation(changed?.AW_GOSU_REPEAT === "1" ? "setup_environment_invalid" : "setup_arguments_invalid"));
  }
  assert.equal(calls, 0);
});

test("canonical setup environment shape fails before platform, reads or commands", async () => {
  const environment = { ...TEST_ONLY.setupEnvironment(setup), PRIVATE_SENTINEL: "PRIVATE_SENTINEL" }; let reads = 0; let commands = 0;
  const adapters = { ...setupAdapters(() => { commands += 1; return success; }), readlink: async () => { reads += 1; return "PRIVATE_SENTINEL"; } };
  await assert.rejects(TEST_ONLY.runOfflineSetup(environment, adapters), exactIsolation("setup_environment_invalid"));
  assert.equal(reads, 0); assert.equal(commands, 0);
});

test("supervisor platform, identity, reads, namespaces and sysfs rejections have exact fixed reasons", async () => {
  const cases = [
    ["setup_platform_invalid", { platform: "PRIVATE_SENTINEL" }],
    ["setup_root_invalid", { geteuid: () => 1000 }],
    ["setup_read_failed", { readlink: async () => { throw new Error("PRIVATE_SENTINEL"); } }],
    ["setup_read_failed", { lstat: async () => { throw new Error("PRIVATE_SENTINEL"); } }],
    ["namespace_net_invalid", { readlink: async (name) => name.endsWith("/net") ? "PRIVATE_SENTINEL" : "mnt:[201]" }],
    ["namespace_mnt_invalid", { readlink: async (name) => name.endsWith("/net") ? "net:[101]" : "PRIVATE_SENTINEL" }],
    ["setup_netns_reused", { readlink: async (name) => name.endsWith("/net") ? "net:[100]" : "mnt:[201]" }],
    ["setup_mntns_reused", { readlink: async (name) => name.endsWith("/net") ? "net:[101]" : "mnt:[200]" }],
    ["setup_sysfs_not_directory", { lstat: async () => ({ isDirectory: () => false, isSymbolicLink: () => false }) }],
    ["setup_sysfs_symlink", { lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => true }) }],
  ];
  for (const [reason, overrides] of cases) {
    const commands = []; const adapters = { ...setupAdapters((command) => { commands.push(command); return success; }), ...overrides };
    await assert.rejects(TEST_ONLY.runOfflineSetup(TEST_ONLY.setupEnvironment(setup), adapters), exactIsolation(reason));
    assert.deepEqual(commands, []);
  }
});

test("mount and setpriv process failures classify before any later command without raw caller data", async () => {
  for (const [stage, expectedCommands] of [["setup_mount", ["/usr/bin/mount"]], ["setup_setpriv", ["/usr/bin/mount", "/usr/bin/setpriv"]]]) {
    const results = [
      ["spawn", () => { throw new Error("PRIVATE_SENTINEL"); }],
      ["spawn", () => ({ error: Object.assign(new Error("PRIVATE_SENTINEL"), { code: "EACCES" }), signal: "SIGKILL", status: 17 })],
      ["timeout", () => ({ error: Object.assign(new Error("PRIVATE_SENTINEL"), { code: "ETIMEDOUT" }), signal: "SIGKILL", status: 17 })],
      ["output_limit", () => ({ error: Object.assign(new Error("PRIVATE_SENTINEL"), { code: "ENOBUFS" }), signal: "SIGKILL", status: 17 })],
      ["signal", () => ({ ...success, signal: "SIGKILL", status: null })],
      ["exit", () => ({ ...success, status: 17, stdout: Buffer.from("PRIVATE_SENTINEL"), stderr: Buffer.from("PRIVATE_SENTINEL") })],
      ["result_invalid", () => ({ ...success, stdout: "PRIVATE_SENTINEL" })],
      ["result_invalid", () => ({ ...success, stderr: "PRIVATE_SENTINEL" })],
      ["result_invalid", () => ({ ...success, status: null })],
      ["result_invalid", () => ({ ...success, status: 1.5 })],
      ["result_invalid", () => ({ ...success, signal: {} })],
      ["result_invalid", () => ({ ...success, error: null })],
      ["result_invalid", () => undefined],
      ["result_invalid", () => Object.defineProperty({}, "stderr", { get() { throw new Error("PRIVATE_SENTINEL"); } })],
    ];
    for (const [reason, result] of results) {
      const commands = [];
      const adapters = setupAdapters((command) => {
        commands.push(command);
        if (stage === "setup_setpriv" && commands.length === 1) return success;
        return result();
      });
      await assert.rejects(TEST_ONLY.runOfflineSetup(TEST_ONLY.setupEnvironment(setup), adapters), exactIsolation(`${stage}_${reason}`));
      assert.deepEqual(commands, expectedCommands);
    }
  }
});

test("fixed mount and privilege-drop options remain exact and mount never propagates a child packet", async () => {
  const calls = []; const adapters = setupAdapters((command, args, options) => { calls.push({ command, args, options }); return success; });
  await TEST_ONLY.runOfflineSetup(TEST_ONLY.setupEnvironment(setup), adapters);
  const fixed = { cwd: "/", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, maxBuffer: 1024 * 1024, encoding: null, windowsHide: true };
  assert.deepEqual(calls[0].options, { ...fixed, timeout: 60_000 });
  assert.deepEqual(calls[1].options, { ...fixed, timeout: 70 * 60_000 });
  const commands = [];
  await assert.rejects(TEST_ONLY.runOfflineSetup(TEST_ONLY.setupEnvironment(setup), setupAdapters((command) => {
    commands.push(command); return { ...success, status: 17, stderr: Buffer.from(`${isolationMessage("boundary_loopback_up")}\n`) };
  })), exactIsolation("setup_mount_exit"));
  assert.deepEqual(commands, ["/usr/bin/mount"]);
});

test("ordinary boundary rejects each network predicate in its original order with a fixed packet", () => {
  const cases = [
    ["namespace_net_invalid", (x) => { x.originalNetns = "PRIVATE_SENTINEL"; }],
    ["namespace_net_invalid", (x) => { x.netns = "PRIVATE_SENTINEL"; }],
    ["namespace_mnt_invalid", (x) => { x.originalMntns = "PRIVATE_SENTINEL"; }],
    ["namespace_mnt_invalid", (x) => { x.mntns = "PRIVATE_SENTINEL"; }],
    ["boundary_netns_reused", (x) => { x.netns = x.originalNetns; x.mntns = x.originalMntns; }],
    ["boundary_mntns_reused", (x) => { x.mntns = x.originalMntns; x.interfaces = []; }],
    ["boundary_observation_invalid", (x) => { x.status = null; x.interfaces = []; }],
    ["boundary_observation_invalid", (x) => { x.routes = null; }],
    ["boundary_observation_invalid", (x) => { x.loopbackFlags = null; }],
    ["boundary_interfaces_invalid", (x) => { x.interfaces = ["PRIVATE_SENTINEL", "lo"]; x.routes += "PRIVATE_SENTINEL\n"; }],
    ["boundary_interfaces_invalid", (x) => { x.interfaces = []; }],
    ["boundary_routes_present", (x) => { x.routes += "PRIVATE_SENTINEL\n"; x.loopbackFlags = "PRIVATE_SENTINEL"; }],
    ["boundary_flags_invalid", (x) => { x.loopbackFlags = "PRIVATE_SENTINEL"; }],
    ["boundary_flags_invalid", (x) => { x.loopbackFlags = "0x08\n"; }],
    ["boundary_flags_invalid", (x) => { x.loopbackFlags = "0x100000008\n"; }],
    ["boundary_loopback_missing", (x) => { x.loopbackFlags = "0x1\n"; }],
    ["boundary_loopback_up", (x) => { x.loopbackFlags = "0x9\n"; }],
  ];
  for (const [reason, mutate] of cases) {
    const observation = boundaryObservation(); mutate(observation);
    assert.throws(() => TEST_ONLY.validateOfflineNetworkObservation(observation), exactIsolation(reason));
  }
  const valid = boundaryObservation();
  for (const flags of ["0x8\n", "0x18\n", "0xfffffff8\n"]) {
    valid.loopbackFlags = flags;
    assert.equal(TEST_ONLY.validateOfflineNetworkObservation(valid).checks.loopbackDown, true);
  }
});

test("defensive flags-number rejection is normally unreachable under the strict eight-digit grammar", { concurrency: false }, () => {
  const parse = Number.parseInt;
  try {
    for (const invalid of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5]) {
      Number.parseInt = () => invalid;
      assert.throws(() => TEST_ONLY.validateOfflineNetworkObservation(boundaryObservation()), exactIsolation("boundary_flags_number_invalid"));
    }
  } finally { Number.parseInt = parse; }
  assert.equal(TEST_ONLY.validateOfflineNetworkObservation(boundaryObservation()).checks.loopbackDown, true);
});

test("namespace transition rejection preserves its fixed packet and accepted binary identity", () => {
  for (const [original, current] of [["PRIVATE_SENTINEL", "net:[101]"], ["net:[100]", "PRIVATE_SENTINEL"], ["net:[100]", "net:[100]"]]) {
    assert.throws(() => namespaceTransitionIdentity(original, current), exactIsolation("namespace_transition_invalid"));
  }
  assert.deepEqual(namespaceTransitionIdentity("net:[100]", "net:[101]"), {
    bytes: 26, sha256: "f2bca39fcc562c1b7afe1712ceb3a9d2439ec5db3f4980f62512597196e6d828",
  });
});

test("existing namespace assertion rejects same current identity using only an ordinary Linux read", { skip: process.platform !== "linux" }, async () => {
  const current = await readNetworkNamespaceIdentity();
  await assert.rejects(assertNetworkNamespaceChanged(current), exactIsolation("namespace_changed_invalid"));
});

const childMessage = (reason) => `gosu_preparation_failed\ngosu_child_main_entered\ngosu_child_failure_reason_${reason}`;
const exactChild = (reason) => (error) => {
  assert.equal(error.message, childMessage(reason));
  assert.equal(TEST_ONLY.formatChildMainFailure(error, true), `${childMessage(reason)}\n`);
  for (const privateText of ["PRIVATE_SENTINEL", "EACCES", "EPERM", "ENOENT", "ENOTDIR", "/proc", "/sys", "net:[", "mnt:["]) assert.equal(error.message.includes(privateText), false);
  return true;
};
const readStages = ["lock_read", "boundary_netns_read", "boundary_mntns_read", "boundary_status_read", "boundary_routes_read", "boundary_interfaces_read", "boundary_loopback_flags_read"];
const boundaryReads = [
  ["readlink", "/proc/self/ns/net"], ["readlink", "/proc/self/ns/mnt"], ["readFile", "/proc/self/status", "utf8"],
  ["readFile", "/proc/net/route", "utf8"], ["readdir", "/sys/class/net"], ["readFile", "/sys/class/net/lo/flags", "utf8"],
];
function ordinaryBoundaryAdapters(operation) {
  return Object.fromEntries(["readlink", "readFile", "readdir"].map((method) => [method, (...args) => operation(method, ...args)]));
}
const boundaryValue = (name) => ({
  "/proc/self/ns/net": "net:[101]", "/proc/self/ns/mnt": "mnt:[201]", "/proc/self/status": boundaryObservation().status,
  "/proc/net/route": boundaryObservation().routes, "/sys/class/net": ["lo"], "/sys/class/net/lo/flags": "0x8\n",
})[name];

test("all seven exact read stages classify only own Error data codes and never invoke getters", async () => {
  for (const stage of readStages) for (const [code, reason] of [["EACCES", "permission_denied"], ["EPERM", "permission_denied"], ["ENOENT", "path_unavailable"], ["ENOTDIR", "path_unavailable"], ["EIO", "unclassified"], [null, "unclassified"], [{}, "unclassified"]]) {
    const error = Object.assign(new Error("PRIVATE_SENTINEL"), { code, path: "PRIVATE_SENTINEL", childPacket: "PRIVATE_SENTINEL" });
    await assert.rejects(TEST_ONLY.childRead(stage, async () => { throw error; }, true), exactChild(`${stage}_${reason}`));
  }
  let getters = 0;
  const inherited = Object.create(Error.prototype, { code: { value: "EACCES" } }); const inheritedError = new Error("PRIVATE_SENTINEL"); Object.setPrototypeOf(inheritedError, inherited);
  const revoked = Proxy.revocable(new Error("PRIVATE_SENTINEL"), {}); revoked.revoke();
  const errors = [
    null, "PRIVATE_SENTINEL", {}, { code: "EACCES", message: "PRIVATE_SENTINEL" }, inheritedError,
    Object.defineProperty(new Error("PRIVATE_SENTINEL"), "code", { get() { getters += 1; throw new Error("PRIVATE_SENTINEL"); } }),
    new Proxy(new Error("PRIVATE_SENTINEL"), { getOwnPropertyDescriptor() { throw new Error("PRIVATE_SENTINEL"); } }),
    new Proxy(new Error("PRIVATE_SENTINEL"), { getPrototypeOf() { throw new Error("PRIVATE_SENTINEL"); } }), revoked.proxy,
  ];
  for (const stage of readStages) for (const error of errors) await assert.rejects(TEST_ONLY.childRead(stage, () => { throw error; }, true), exactChild(`${stage}_unclassified`));
  const safe = Object.assign(new Error("PRIVATE_SENTINEL"), { code: "EPERM" });
  for (const name of ["message", "stack", "path", "cause", "childPacket", "isolationReason"]) Object.defineProperty(safe, name, { get() { getters += 1; throw new Error("PRIVATE_SENTINEL"); } });
  await assert.rejects(TEST_ONLY.childRead("lock_read", () => { throw safe; }, true), exactChild("lock_read_permission_denied"));
  assert.equal(getters, 0);
  const original = new Error("PRIVATE_SENTINEL");
  await assert.rejects(TEST_ONLY.childRead("lock_read", () => { throw original; }, false), (error) => error === original);
});

test("boundary collector starts all six exact operations in original order with fixed per-read stages", async () => {
  for (const synchronous of [true, false]) for (let rejected = 0; rejected < boundaryReads.length; rejected += 1) {
    const calls = [];
    const operation = (method, ...args) => {
      calls.push([method, ...args]);
      if (args[0] === boundaryReads[rejected][1]) {
        const error = Object.assign(new Error("PRIVATE_SENTINEL"), { code: "EACCES" });
        if (synchronous) throw error;
        return Promise.reject(error);
      }
      return Promise.resolve(boundaryValue(args[0]));
    };
    await assert.rejects(TEST_ONLY.collectOfflineBoundary(ordinaryBoundaryAdapters(operation), true), exactChild(`${readStages[rejected + 1]}_permission_denied`));
    assert.deepEqual(calls, boundaryReads);
  }
  const calls = []; let settle;
  const pending = new Promise((resolve) => { settle = resolve; });
  const collection = TEST_ONLY.collectOfflineBoundary(ordinaryBoundaryAdapters((method, ...args) => { calls.push([method, ...args]); return pending.then(() => boundaryValue(args[0])); }), true);
  assert.deepEqual(calls, boundaryReads); settle();
  const collected = await collection;
  assert.deepEqual(collected, { netns: "net:[101]", mntns: "mnt:[201]", status: boundaryObservation().status, routes: boundaryObservation().routes, interfaces: ["lo"], loopbackFlags: "0x8\n" });
  assert.equal(TEST_ONLY.validateOfflineNetworkObservation({ ...boundaryObservation(), ...collected }).checks.loopbackDown, true);
});

test("namespace validation stays outside read catches with unchanged competing rejection precedence", async () => {
  for (const name of ["/proc/self/ns/net", "/proc/self/ns/mnt"]) {
    const adapters = ordinaryBoundaryAdapters(async (_method, pathname) => pathname === name ? "PRIVATE_SENTINEL" : boundaryValue(pathname));
    await assert.rejects(TEST_ONLY.collectOfflineBoundary(adapters, true), exactIsolation(name.endsWith("/net") ? "namespace_net_invalid" : "namespace_mnt_invalid"));
    for (const later of boundaryReads.slice(2)) {
      const error = Object.assign(new Error("PRIVATE_SENTINEL"), { code: "ENOENT" });
      const competing = ordinaryBoundaryAdapters(async (_method, pathname) => { if (pathname === later[1]) throw error; return pathname === name ? "PRIVATE_SENTINEL" : boundaryValue(pathname); });
      async function originalNamespace(pathname, kind) {
        const value = await competing.readlink(pathname);
        if (!new RegExp(`^${kind}:\\[[1-9][0-9]*\\]$`, "u").test(value)) throw new Error(isolationMessage(`namespace_${kind}_invalid`));
        return value;
      }
      await assert.rejects(Promise.all([
        originalNamespace("/proc/self/ns/net", "net"), originalNamespace("/proc/self/ns/mnt", "mnt"),
        competing.readFile("/proc/self/status", "utf8"), competing.readFile("/proc/net/route", "utf8"),
        competing.readdir("/sys/class/net"), competing.readFile("/sys/class/net/lo/flags", "utf8"),
      ]), (failure) => failure === error);
      const stage = readStages[boundaryReads.findIndex((read) => read[1] === later[1]) + 1];
      await assert.rejects(TEST_ONLY.collectOfflineBoundary(competing, true), exactChild(`${stage}_path_unavailable`));
    }
  }
  for (const [reason, mutate] of [["boundary_netns_reused", (value) => { value.netns = value.originalNetns; value.interfaces = []; }], ["boundary_mntns_reused", (value) => { value.mntns = value.originalMntns; value.status = null; }]]) {
    const value = boundaryObservation(); mutate(value);
    assert.throws(() => TEST_ONLY.validateOfflineNetworkObservation(value), exactIsolation(reason));
  }
});

test("boundary rejection precedence matches original Promise.all for mixed zero-to-three microtask delays", async () => {
  async function originalCollect(adapters) {
    async function namespace(name, kind) {
      const value = await adapters.readlink(name);
      if (!new RegExp(`^${kind}:\\[[1-9][0-9]*\\]$`, "u").test(value)) throw new Error(isolationMessage(`namespace_${kind}_invalid`));
      return value;
    }
    return Promise.all([
      namespace("/proc/self/ns/net", "net"), namespace("/proc/self/ns/mnt", "mnt"),
      adapters.readFile("/proc/self/status", "utf8"), adapters.readFile("/proc/net/route", "utf8"),
      adapters.readdir("/sys/class/net"), adapters.readFile("/sys/class/net/lo/flags", "utf8"),
    ]);
  }
  const rejected = async (promise) => { try { await promise; assert.fail("expected rejection"); } catch (error) { return error; } };
  const cases = [
    ...[0, 1].flatMap((namespace) => [2, 3, 4, 5].map((read) => [[namespace, "invalid"], [read, "read"]])),
    [[0, "invalid"], [1, "invalid"]], [[0, "read"], [1, "read"]], [[0, "invalid"], [1, "read"]],
  ];
  for (const failures of cases) for (let firstTicks = 0; firstTicks < 4; firstTicks += 1) for (let secondTicks = 0; secondTicks < 4; secondTicks += 1) {
    const errors = failures.map(() => Object.assign(new Error("PRIVATE_SENTINEL"), { code: "ENOENT" }));
    const adapters = ordinaryBoundaryAdapters((_method, name) => {
      const position = failures.findIndex(([index]) => boundaryReads[index][1] === name);
      let promise = position >= 0 && failures[position][1] === "read" ? Promise.reject(errors[position]) : Promise.resolve(position >= 0 ? "PRIVATE_SENTINEL" : boundaryValue(name));
      const ticks = position === 0 ? firstTicks : position === 1 ? secondTicks : 0;
      for (let tick = 0; tick < ticks; tick += 1) promise = promise.then((value) => value);
      return promise;
    });
    const original = await rejected(originalCollect(adapters)); const current = await rejected(TEST_ONLY.collectOfflineBoundary(adapters, true));
    const position = errors.indexOf(original);
    const expected = position >= 0 ? childMessage(`${readStages[failures[position][0] + 1]}_path_unavailable`) : original.message;
    assert.equal(current.message, expected, JSON.stringify({ failures, firstTicks, secondTicks }));
  }
});

test("lock read, JSON and contract failures are distinct and accepted identity is unchanged", async () => {
  const bytes = await readFile(new URL("../infra/postgres-image/materials/gosu-derivative-lock-v1.json", import.meta.url));
  const accepted = await TEST_ONLY.loadLock(true, async () => bytes);
  const unchanged = await TEST_ONLY.loadLock(false, async () => bytes); assert.deepEqual(accepted, unchanged);
  const error = Object.assign(new Error("PRIVATE_SENTINEL"), { code: "ENOENT" });
  await assert.rejects(TEST_ONLY.loadLock(true, async () => { throw error; }), exactChild("lock_read_path_unavailable"));
  await assert.rejects(TEST_ONLY.loadLock(true, async () => Buffer.from("PRIVATE_SENTINEL")), exactChild("lock_json_invalid"));
  await assert.rejects(TEST_ONLY.loadLock(true, async () => Buffer.from('{"PRIVATE_SENTINEL":"PRIVATE_SENTINEL"}')), exactChild("lock_contract_invalid"));
  await assert.rejects(TEST_ONLY.loadLock(false, async () => { throw error; }), (failure) => failure === error);
  await assert.rejects(TEST_ONLY.loadLock(false, async () => Buffer.from("PRIVATE_SENTINEL")), SyntaxError);
});

test("offline main sets failure context before runtime and preserves both lock reads, arguments and awaited silent phase", { concurrency: false }, async () => {
  const priorArgv = process.argv; const keys = ["NODE_OPTIONS", "NODE_PATH", "AW_GOSU_SCRATCH", "AW_GOSU_OUTPUT"];
  const prior = keys.map((key) => [key, process.env[key]]);
  const events = []; const lock = { sumdb: "fixed" }; const identity = { bytes: 1, sha256: "a".repeat(64) };
  const adapters = { loadLock: async (entered) => { events.push(["lock", entered]); return { value: lock, identity }; }, offlinePhase: async (...args) => { events.push(["phase", args]); } };
  try {
    process.env.NODE_OPTIONS = ""; process.env.NODE_PATH = ""; process.env.AW_GOSU_SCRATCH = "PRIVATE_SENTINEL"; process.env.AW_GOSU_OUTPUT = "PRIVATE_SENTINEL";
    process.argv = [process.execPath, TEST_ONLY.scriptFile, "offline", "1"];
    const silentProgram = `import { TEST_ONLY } from ${JSON.stringify(new URL("../scripts/postgres-image/gosu-derivative-build-v1.mjs", import.meta.url).href)}; process.argv = [process.execPath, TEST_ONLY.scriptFile, "offline", "1"]; await TEST_ONLY.main({ loadLock: async () => ({ value: { sumdb: "fixed" }, identity: {} }), offlinePhase: async () => {} });`;
    const silent = spawnSync(process.execPath, ["--input-type=module", "--eval", silentProgram], { env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" }, timeout: 30_000, maxBuffer: 1024 * 1024, encoding: null, windowsHide: true });
    assert.equal(silent.error, undefined); assert.equal(silent.signal, null); assert.equal(silent.status, 0); assert.deepEqual(silent.stdout, Buffer.alloc(0)); assert.deepEqual(silent.stderr, Buffer.alloc(0));
    await TEST_ONLY.main(adapters);
    assert.deepEqual(events.slice(0, 2), [["lock", true], ["lock", true]]); assert.equal(events[2][0], "phase");
    assert.equal(events[2][1][0], 1); assert.equal(events[2][1][1], lock); assert.equal(events[2][1][2], identity);
    events.length = 0; process.argv[3] = "3";
    await assert.rejects(TEST_ONLY.main(adapters), exactChild("arguments_invalid")); assert.deepEqual(events, [["lock", true]]);
    events.length = 0; process.env.NODE_PATH = "PRIVATE_SENTINEL";
    await assert.rejects(TEST_ONLY.main(adapters), exactChild("runtime_invalid")); assert.deepEqual(events, []);
    process.env.NODE_PATH = ""; process.env.NODE_OPTIONS = "PRIVATE_SENTINEL";
    await assert.rejects(TEST_ONLY.main(adapters), exactChild("runtime_invalid")); assert.deepEqual(events, []); process.env.NODE_OPTIONS = "";
    process.env.NODE_PATH = ""; events.length = 0;
    const readFailure = Object.assign(new Error("PRIVATE_SENTINEL"), { code: "ENOENT" });
    await assert.rejects(TEST_ONLY.main({ ...adapters, loadLock: () => TEST_ONLY.loadLock(true, async () => { throw readFailure; }) }), exactChild("lock_read_path_unavailable"));
    assert.deepEqual(events, []);
    for (const [bytes, reason] of [[Buffer.from("PRIVATE_SENTINEL"), "lock_json_invalid"], [Buffer.from("{}"), "lock_contract_invalid"]]) {
      await assert.rejects(TEST_ONLY.main({ ...adapters, loadLock: () => TEST_ONLY.loadLock(true, async () => bytes) }), exactChild(reason)); assert.deepEqual(events, []);
    }
    process.argv[3] = "1"; events.length = 0;
    let lockReads = 0;
    await assert.rejects(TEST_ONLY.main({ ...adapters, loadLock: async (entered) => {
      lockReads += 1; if (lockReads === 1) return adapters.loadLock(entered);
      return TEST_ONLY.loadLock(entered, async () => { throw readFailure; });
    } }), exactChild("lock_read_path_unavailable"));
    assert.equal(lockReads, 2); assert.deepEqual(events, [["lock", true]]); events.length = 0;
    for (const key of ["AW_GOSU_SCRATCH", "AW_GOSU_OUTPUT"]) {
      process.env[key] = "";
      await assert.rejects(TEST_ONLY.main(adapters), exactChild("arguments_invalid")); assert.deepEqual(events, [["lock", true]]);
      process.env[key] = "PRIVATE_SENTINEL"; events.length = 0;
    }
    const phaseFailure = new Error("PRIVATE_SENTINEL");
    await assert.rejects(TEST_ONLY.main({ ...adapters, offlinePhase: async () => { await Promise.resolve(); throw phaseFailure; } }), (error) => {
      assert.equal(error, phaseFailure); assert.equal(TEST_ONLY.formatChildMainFailure(error, true), `${childMessage("main_unclassified")}\n`); return true;
    });
    assert.deepEqual(events, [["lock", true], ["lock", true]]);
    events.length = 0; process.argv[2] = "prepare"; process.argv[3] = "3";
    await assert.rejects(TEST_ONLY.main(adapters), /^Error: gosu_arguments_invalid$/u); assert.deepEqual(events, []);
    process.env.NODE_PATH = "PRIVATE_SENTINEL"; events.length = 0;
    await assert.rejects(TEST_ONLY.main(adapters), /^Error: gosu_node_runtime_invalid$/u); assert.deepEqual(events, []);
  } finally {
    process.argv = priorArgv;
    for (const [key, value] of prior) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
