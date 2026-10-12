import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TEST_ONLY } from "../scripts/postgres-image/gosu-derivative-build-v1.mjs";

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
