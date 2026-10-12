import assert from "node:assert/strict";
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
  const main = source.slice(source.indexOf("async function main()"));
  assert.equal(main.indexOf('command === "offline-setup"') >= 0 && main.indexOf('command === "offline-setup"') < main.indexOf("loadLock()"), true);
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
