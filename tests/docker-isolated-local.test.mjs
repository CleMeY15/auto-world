import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { localDaemonFailureDiagnostic, startLocalDaemonLease } from "../scripts/docker-isolated/daemon-local.mjs";

const linux = process.platform === "linux";
const MAIN = "unix:///var/run/docker.sock";
const ID_ONE = `sha256:${"a".repeat(64)}`; const ID_TWO = `sha256:${"b".repeat(64)}`;
const INFO = ["info", "--format", "{{json .}}"];
const IMAGES = ["image", "ls", "--all", "--quiet", "--no-trunc"];
const principal = { id: "principal-daemon", root: "/var/lib/docker", containerdAddress: "/run/containerd/containerd.sock",
  containersNamespace: "moby", pluginsNamespace: "plugins.moby", imageIds: [ID_ONE, ID_TWO] };
const info = (identity) => ({ ID: identity.id, ServerVersion: "28.0.4", DockerRootDir: identity.root, Driver: "overlay2",
  OSType: "linux", Architecture: "x86_64", Containerd: { Address: identity.containerdAddress,
    Namespaces: { Containers: identity.containersNamespace, Plugins: identity.pluginsNamespace } } });
const bytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const success = (stdout) => ({ status: 0, signal: null, stdout, stderr: Buffer.alloc(0) });
const rejection = (code, phase) => (error) => {
  assert.deepEqual(localDaemonFailureDiagnostic(error), { code, phase });
  assert.equal(error.message, code); assert.deepEqual(Object.keys(error).sort(), ["phase"]); return true;
};

async function fixture(t) {
  const parent = mkdtempSync("/tmp/awdl-"); chmodSync(parent, 0o700);
  const state = { commands: [], startCalls: 0, stopCalls: 0, verifyCalls: 0, spec: null, server: null,
    mainImages: [...principal.imageIds], mainContainers: [], mainVolumes: [], isolatedImages: [], isolatedContainers: [],
    isolatedVolumes: [], mainInfo: {}, isolatedInfo: {}, proof: {}, startProof: {}, stopProof: {}, tag: "foreign:retained",
    leavePid: false, transportHook: null, verifyHook: null, startError: null, stopError: null, now: 1_000 };
  const input = { purpose: "EMPTY_DAEMON_PROBE", parent, nonce: "1234567890abcdef12345678", principal };
  const helper = {
    start: async (spec) => {
      state.startCalls++; state.spec = spec;
      if (state.startError) throw state.startError;
      // A Unix listener stands in for the private socket; no Docker or child process runs in these tests.
      chmodSync(spec.dataRoot, 0o710);
      state.server = createServer(); state.server.unref();
      await new Promise((resolve, reject) => { state.server.once("error", reject); state.server.listen(spec.socket, resolve); });
      chmodSync(spec.socket, 0o600); writeFileSync(spec.pidFile, "4242\n", { flag: "wx", mode: 0o600 });
      return { pid: 4242, startTicks: "123456", daemonId: "isolated-daemon", namespacesFresh: true, ...state.startProof };
    },
    verify: async (spec, child) => {
      state.verifyCalls++;
      if (state.verifyHook) await state.verifyHook();
      return { state: "RUNNING", pid: child.pid, startTicks: child.startTicks, uid: 0, executable: "/usr/bin/dockerd",
        version: "28.0.4", argvSha256: spec.argvSha256, configSha256: spec.configSha256, ...state.proof };
    },
    stop: async (spec, child) => {
      state.stopCalls++;
      if (state.stopError) throw state.stopError;
      await new Promise((resolve, reject) => state.server.close((error) => error ? reject(error) : resolve()));
      if (!state.leavePid) unlinkSync(spec.pidFile);
      return { state: "STOPPED", pid: child.pid, startTicks: child.startTicks, processGone: true, ...state.stopProof };
    },
  };
  const env = {};
  const transport = async (command, args, options) => {
    assert.equal(command, "/usr/bin/docker"); assert.equal(args[0], "--host");
    const host = args[1]; const operation = args.slice(2);
    assert.ok(host === MAIN || host === `unix://${state.spec?.socket}`);
    assert.equal(Object.hasOwn(options.env, "DOCKER_HOST"), false);
    assert.equal(Object.hasOwn(options.env, "DOCKER_CONTEXT"), false);
    assert.deepEqual(Object.keys(options.env).sort(), ["DOCKER_CONFIG", "HOME", "LANG", "LC_ALL", "PATH", "TZ"]);
    assert.equal(options.env.DOCKER_CONFIG, path.join(parent, `daemon-${input.nonce}`, "client"));
    assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 10_000); assert.equal(options.maxBuffer, 1024 * 1024);
    state.lastTimeoutMs = options.timeoutMs; state.commands.push({ host, args: operation });
    if (state.transportHook) {
      const substitute = await state.transportHook(host, operation);
      if (substitute !== undefined) return substitute;
    }
    const main = host === MAIN;
    if (operation[0] === "info") {
      const identity = main ? principal : { ...state.spec, id: "isolated-daemon", root: state.spec.dataRoot };
      return success(bytes({ ...info(identity), ...(main ? state.mainInfo : state.isolatedInfo) }));
    }
    if (operation[0] === "version") return success(Buffer.from("28.0.4|28.0.4\n"));
    if (operation[1] === "ls") {
      const inventory = operation[0] === "image" ? "Images" : operation[0] === "container" ? "Containers" : "Volumes";
      return success(Buffer.from(state[`${main ? "main" : "isolated"}${inventory}`].join("\n")));
    }
    assert.ok(main); assert.deepEqual(operation.slice(0, 4), ["image", "inspect", "--format", "{{json .}}"]);
    return success(bytes({ Id: operation[4], RepoTags: [state.tag], Config: { Cmd: ["foreign"] } }));
  };
  t.after(async () => {
    if (state.server?.listening) await new Promise((resolve) => state.server.close(resolve));
    assert.ok(parent.startsWith("/tmp/awdl-")); rmSync(parent, { recursive: true, force: true });
  });
  const dependencies = { helper, transport, env, now: () => state.now };
  return { input, dependencies, state, start: () => startLocalDaemonLease(input, dependencies) };
}

test("isolated empty probe authenticates both daemons, config bytes, namespaces and bounded shutdown", { skip: !linux }, async (t) => {
  const f = await fixture(t); const lease = await f.start(); const { state } = f;
  assert.equal(state.spec.uid, process.getuid()); assert.equal(state.spec.gid, process.getgid());
  assert.deepEqual(state.spec.args, ["--config-file", state.spec.configFile]);
  const config = JSON.parse(readFileSync(state.spec.configFile));
  assert.deepEqual(config, { "data-root": state.spec.dataRoot, "exec-root": state.spec.execRoot, pidfile: state.spec.pidFile,
    hosts: [lease.identity.endpoint], bridge: "none", iptables: false, ip6tables: false, "ip-forward": false,
    "ip-masq": false, "userland-proxy": false, containerd: principal.containerdAddress,
    "containerd-namespace": lease.identity.containersNamespace, "containerd-plugins-namespace": lease.identity.pluginsNamespace,
    "storage-driver": "overlay2", "default-cgroupns-mode": "private", "default-ipc-mode": "private", "default-runtime": "runc" });
  assert.notEqual(config["containerd-namespace"], principal.containersNamespace);
  assert.notEqual(config["containerd-plugins-namespace"], principal.pluginsNamespace);
  assert.equal(lstatSync(state.spec.dataRoot).mode & 0o7777, 0o710);
  assert.equal(lstatSync(state.spec.execRoot).mode & 0o7777, 0o700);
  assert.equal(lstatSync(lease.identity.dockerConfig).mode & 0o7777, 0o700);
  const verified = await lease.verify(); assert.equal(verified.state, "VERIFIED_EMPTY"); assert.equal(verified.admission, "NOT_AUTHORIZED");
  assert.equal(verified.images + verified.containers + verified.volumes, 0);
  assert.match(verified.principalSnapshotSha256, /^[0-9a-f]{64}$/u);
  assert.equal((await lease.runner("/usr/bin/docker", IMAGES)).stdout.length, 0);
  const stopped = await lease.stop();
  assert.equal(stopped.state, "STOPPED"); assert.equal(stopped.privateState, "RETAINED");
  assert.equal(stopped.principalSnapshotSha256, verified.principalSnapshotSha256);
  assert.equal(state.startCalls, 1); assert.equal(state.stopCalls, 1);
  assert.equal(existsSync(state.spec.socket), false); assert.equal(existsSync(state.spec.pidFile), false);
  assert.ok(existsSync(state.spec.configFile)); assert.deepEqual(state.mainImages, principal.imageIds);
  assert.ok(state.commands.filter((entry) => entry.host === MAIN).every((entry) => ["info", "image", "container", "volume"].includes(entry.args[0])));
  assert.ok(state.commands.filter((entry) => entry.host !== MAIN).every((entry) => ["info", "image", "container", "volume", "version"].includes(entry.args[0])));
  await assert.rejects(lease.runner("/usr/bin/docker", INFO), rejection("daemon_local_command_forbidden", "COMMAND"));
});

test("preflight rejects wrong purpose, ambient routes, foreign baseline and occupied paths without helper start", { skip: !linux }, async (t) => {
  for (const mutation of [
    (f) => { f.input.purpose = "RESTORE"; },
    (f) => { f.dependencies.env.DOCKER_HOST = "unix:///var/run/docker.sock"; },
    (f) => { f.dependencies.env.DOCKER_CONTEXT = "default"; },
    (f) => { f.state.mainImages.pop(); },
    (f) => { f.state.mainContainers = ["c".repeat(64)]; },
    (f) => { mkdirSync(path.join(f.input.parent, `daemon-${f.input.nonce}`), { mode: 0o700 }); },
  ]) await t.test("reject preflight mutation", async (child) => {
    const f = await fixture(child); mutation(f);
    await assert.rejects(startLocalDaemonLease(f.input, f.dependencies), (error) => {
      assert.equal(error.phase, "START"); assert.match(error.message, /^daemon_local_/u); return true;
    });
    assert.equal(f.state.startCalls, 0); assert.equal(f.state.stopCalls, 0);
  });
});

test("client/context mutations block every Docker command and shutdown, preserving uncertain state", { skip: !linux }, async (t) => {
  for (const mutate of [
    (lease) => writeFileSync(path.join(lease.identity.dockerConfig, "config.json"), "{"),
    (lease) => unlinkSync(path.join(lease.identity.dockerConfig, "config.json")),
    (lease) => {
      const file = path.join(lease.identity.dockerConfig, "config.json"); const original = readFileSync(file);
      renameSync(file, `${file}.original`); writeFileSync(file, original, { flag: "wx", mode: 0o600 }); unlinkSync(`${file}.original`);
    },
    (lease) => {
      const dir = path.join(lease.identity.dockerConfig, "contexts", "meta", createHash("sha256").update(lease.identity.contextName).digest("hex"));
      writeFileSync(path.join(dir, "meta.json"), bytes({ Name: lease.identity.contextName, Metadata: {},
        Endpoints: { docker: { Host: MAIN, SkipTLSVerify: false } } }));
    },
    (lease) => chmodSync(lease.identity.dockerConfig, 0o755),
    (lease) => {
      const file = path.join(lease.identity.dockerConfig, "config.json"); renameSync(file, `${file}.original`); symlinkSync(`${file}.original`, file);
    },
    (lease) => { renameSync(lease.identity.execRoot, `${lease.identity.execRoot}.original`); mkdirSync(lease.identity.execRoot, { mode: 0o700 }); },
  ]) await t.test("reject substituted identity", async (child) => {
    const f = await fixture(child); const lease = await f.start(); const before = f.state.commands.length;
    mutate(lease);
    await assert.rejects(lease.runner("/usr/bin/docker", INFO), rejection("daemon_local_files_changed", "COMMAND"));
    assert.equal(f.state.commands.length, before);
    await assert.rejects(lease.stop(), rejection("daemon_local_cleanup_uncertain", "STOP"));
    assert.equal(f.state.stopCalls, 0); assert.ok(f.state.server.listening);
  });
});

test("runner rejects all mutation commands and routing overrides before issuing transport", { skip: !linux }, async (t) => {
  const f = await fixture(t); const lease = await f.start(); const before = f.state.commands.length;
  for (const args of [["pull", "postgres"], ["load"], ["run", "postgres"], ["create", "postgres"], ["start", "foreign"],
    ["exec", "foreign", "sh"], ["system", "prune"], ["--context", "default", ...INFO], ["--host", MAIN, ...INFO],
    ["--config", "/root/.docker", ...INFO]]) {
    await assert.rejects(lease.runner("/usr/bin/docker", args), rejection("daemon_local_command_forbidden", "COMMAND"));
  }
  await assert.rejects(lease.runner("docker", INFO), rejection("daemon_local_command_forbidden", "COMMAND"));
  for (const env of [{ DOCKER_HOST: MAIN }, { DOCKER_CONTEXT: "default" }, { DOCKER_CONFIG: "/root/.docker" }]) {
    await assert.rejects(lease.runner("/usr/bin/docker", INFO, { env }), rejection("daemon_local_context_invalid", "COMMAND"));
  }
  assert.equal(f.state.commands.length, before); await lease.stop();
});

test("changed daemon identity, namespace or process proof prevents target command and unsafe stop", { skip: !linux }, async (t) => {
  for (const [index, change] of [
    (f) => { f.state.isolatedInfo.ID = principal.id; },
    (f) => { f.state.isolatedInfo.DockerRootDir = principal.root; },
    (f) => { f.state.isolatedInfo.Containerd = { Address: principal.containerdAddress,
      Namespaces: { Containers: principal.containersNamespace, Plugins: principal.pluginsNamespace } }; },
    (f) => { f.state.proof.startTicks = "999999"; },
    (f) => { f.state.proof.uid = 1000; },
    (f) => { f.state.proof.executable = "/bin/foreign"; },
    (f) => { f.state.proof.version = "28.0.5"; },
    (f) => { f.state.proof.argvSha256 = "0".repeat(64); },
    (f) => { f.state.proof.configSha256 = "0".repeat(64); },
  ].entries()) await t.test("reject altered daemon proof", async (child) => {
    const f = await fixture(child); const lease = await f.start(); change(f);
    const before = f.state.commands.filter((entry) => entry.args[0] === "image").length;
    await assert.rejects(lease.runner("/usr/bin/docker", IMAGES), rejection(index < 3 ? "daemon_local_identity_invalid" : "daemon_local_helper_invalid", "COMMAND"));
    assert.equal(f.state.commands.filter((entry) => entry.args[0] === "image").length, before);
    await assert.rejects(lease.stop(), rejection("daemon_local_cleanup_uncertain", "STOP")); assert.equal(f.state.stopCalls, 0);
  });
});

test("initial populated inventory or uncertain helper start cannot yield a lease or guess cleanup", { skip: !linux }, async (t) => {
  for (const change of [
    (f) => { f.state.isolatedImages = [ID_ONE]; },
    (f) => { f.state.isolatedContainers = ["c".repeat(64)]; },
    (f) => { f.state.isolatedVolumes = ["foreign-volume"]; },
    (f) => { f.state.startProof.namespacesFresh = false; },
    (f) => { f.state.startProof.pid = 1; },
    (f) => { f.state.startError = new Error("raw privileged helper output"); },
  ]) await t.test("retain uncertain start", async (child) => {
    const f = await fixture(child); change(f);
    await assert.rejects(f.start(), rejection("daemon_local_cleanup_uncertain", "START"));
    assert.equal(f.state.startCalls, 1); assert.equal(f.state.stopCalls, 0);
  });
});

test("late startup version/transport failure stops only the already authenticated empty daemon", { skip: !linux }, async (t) => {
  for (const mode of ["version", "transport", "stop-error", "stop-proof", "pid-residue"]) {
    await t.test(mode, async (child) => {
      const f = await fixture(child);
      f.state.transportHook = (host, args) => {
        if (host !== MAIN && args[0] === "version") {
          return mode === "transport" ? { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("private failure") }
            : success(Buffer.from("28.0.3|28.0.4\n"));
        }
      };
      if (mode === "stop-error") f.state.stopError = new Error("private stop failure");
      if (mode === "stop-proof") f.state.stopProof.processGone = false;
      if (mode === "pid-residue") f.state.leavePid = true;
      const code = mode === "version" ? "daemon_local_identity_invalid" : mode === "transport" ? "daemon_local_transport_failed"
        : "daemon_local_cleanup_uncertain";
      await assert.rejects(f.start(), rejection(code, "START")); assert.equal(f.state.stopCalls, 1);
      if (mode === "version" || mode === "transport") {
        assert.equal(f.state.server.listening, false); assert.equal(existsSync(f.state.spec.socket), false);
        assert.equal(existsSync(f.state.spec.pidFile), false);
      }
      assert.ok(existsSync(f.state.spec.configFile)); assert.deepEqual(f.state.mainImages, principal.imageIds);
    });
  }
});

test("initial daemon identity uncertainty never signals a guessed process", { skip: !linux }, async (t) => {
  const f = await fixture(t); f.state.isolatedInfo.ID = "foreign-daemon";
  await assert.rejects(f.start(), rejection("daemon_local_cleanup_uncertain", "START"));
  assert.equal(f.state.stopCalls, 0); assert.ok(f.state.server.listening);
});

test("global lease deadline blocks commands, caps their timeout and preserves bounded stop grace", { skip: !linux }, async (t) => {
  const f = await fixture(t); const lease = await f.start();
  f.state.now = 300_995;
  await lease.runner("/usr/bin/docker", INFO); assert.equal(f.state.lastTimeoutMs, 5);
  f.state.now = 301_001; const before = f.state.commands.length;
  await assert.rejects(lease.runner("/usr/bin/docker", INFO), rejection("daemon_local_deadline_exceeded", "COMMAND"));
  assert.equal(f.state.commands.length, before);
  f.state.transportHook = null; assert.equal((await lease.stop()).state, "STOPPED"); assert.equal(f.state.stopCalls, 1);
});

test("final inventory and principal image metadata changes preserve foreign objects and block shutdown", { skip: !linux }, async (t) => {
  for (const change of [
    (f) => { f.state.isolatedImages = [ID_ONE]; },
    (f) => { f.state.isolatedContainers = ["c".repeat(64)]; },
    (f) => { f.state.isolatedVolumes = ["foreign-volume"]; },
    (f) => { f.state.tag = "foreign:changed"; },
    (f) => { f.state.mainImages = [ID_ONE]; },
  ]) await t.test("preserve foreign state", async (child) => {
    const f = await fixture(child); const lease = await f.start(); change(f);
    await assert.rejects(lease.stop(), rejection("daemon_local_cleanup_uncertain", "STOP"));
    assert.equal(f.state.stopCalls, 0); assert.ok(f.state.server.listening);
    assert.ok(f.state.commands.every((entry) => entry.args[1] !== "rm" && entry.args[1] !== "prune"));
  });
});

test("helper shutdown failure, missing process attestation and PID residue are uncertain", { skip: !linux }, async (t) => {
  for (const change of [
    (f) => { f.state.stopError = new Error("raw secret stop output"); },
    (f) => { f.state.stopProof.processGone = false; },
    (f) => { f.state.stopProof.startTicks = "different"; },
    (f) => { f.state.leavePid = true; },
  ]) await t.test("reject uncertain shutdown", async (child) => {
    const f = await fixture(child); const lease = await f.start(); change(f);
    await assert.rejects(lease.stop(), rejection("daemon_local_cleanup_uncertain", "STOP")); assert.equal(f.state.stopCalls, 1);
  });
});

test("transport limits, raw errors and hostile diagnostic getters stay closed", { skip: !linux }, async (t) => {
  const f = await fixture(t); const lease = await f.start();
  for (const substitute of [
    { status: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.from("raw credentials must stay private") },
    { status: null, signal: "SIGTERM", stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) },
    success(Buffer.alloc(1024 * 1024 + 1)),
    { status: 0, signal: null, stdout: "unbounded text", stderr: Buffer.alloc(0) },
  ]) {
    f.state.transportHook = () => substitute;
    await assert.rejects(lease.runner("/usr/bin/docker", INFO), rejection("daemon_local_transport_failed", "COMMAND"));
  }
  f.state.transportHook = () => { throw new Error("unknown raw transport failure"); };
  await assert.rejects(lease.runner("/usr/bin/docker", INFO), rejection("daemon_local_transport_failed", "COMMAND"));
  assert.deepEqual(localDaemonFailureDiagnostic({ message: "unknown", phase: "STOP", raw: "private" }),
    { code: "daemon_local_context_invalid", phase: "VERIFY" });
  const hostile = Object.defineProperty({}, "message", { get() { throw new Error("private"); } });
  assert.deepEqual(localDaemonFailureDiagnostic(hostile), { code: "daemon_local_context_invalid", phase: "VERIFY" });
  f.state.transportHook = null; await lease.stop();
});

test("concurrent verify and stop cannot race a guarded command with process shutdown", { skip: !linux }, async (t) => {
  const f = await fixture(t); const lease = await f.start(); let release; let entered;
  const gate = new Promise((resolve) => { release = resolve; }); const active = new Promise((resolve) => { entered = resolve; });
  f.state.verifyHook = async () => { entered(); await gate; };
  const pending = lease.verify(); await active;
  await assert.rejects(lease.stop(), rejection("daemon_local_context_invalid", "STOP")); assert.equal(f.state.stopCalls, 0);
  await assert.rejects(lease.runner("/usr/bin/docker", INFO), rejection("daemon_local_context_invalid", "COMMAND"));
  release(); await pending; f.state.verifyHook = null; await lease.stop();
});
