import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import {
  gosuDerivativeImageDaemonFailureDiagnostic,
  startGosuDerivativeImageDaemonLease,
  validateGosuDerivativeImageDaemonLeaseInput,
} from "../scripts/postgres-image/gosu-derivative-image-daemon-v2.mjs";

const sha = (character) => `sha256:${character.repeat(64)}`;
const principal = () => ({
  id: "principal-engine",
  root: "/var/lib/docker",
  containerdAddress: "/run/containerd/containerd.sock",
  containersNamespace: "moby",
  pluginsNamespace: "plugins.moby",
  imageIds: [sha("1"), sha("2")],
});
const input = () => ({
  purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
  parent: "/var/tmp/aw-cl-ABC123",
  nonce: "a".repeat(24),
  principal: principal(),
});
const SOURCE = new URL("../scripts/postgres-image/gosu-derivative-image-daemon-v2.mjs", import.meta.url);
const SELF = fileURLToPath(import.meta.url);

test("daemon v2 exports only the three closed public interfaces", async () => {
  const api = await import("../scripts/postgres-image/gosu-derivative-image-daemon-v2.mjs");
  assert.deepEqual(Object.keys(api).sort(), [
    "gosuDerivativeImageDaemonFailureDiagnostic",
    "startGosuDerivativeImageDaemonLease",
    "validateGosuDerivativeImageDaemonLeaseInput",
  ]);
});

test("daemon input validation returns a detached deeply frozen contract", () => {
  const value = input();
  const validated = validateGosuDerivativeImageDaemonLeaseInput(value);
  value.principal.imageIds[0] = sha("f");
  assert.equal(validated.purpose, "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION");
  assert.deepEqual(validated.principal.imageIds, [sha("1"), sha("2")]);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.principal), true);
  assert.equal(Object.isFrozen(validated.principal.imageIds), true);
});

test("daemon input validation rejects extra fields and every authority widening", () => {
  const good = input();
  for (const changed of [
    { ...good, purpose: "COLD_LOAD_ONLY" },
    { ...good, parent: "/var/run/docker" },
    { ...good, nonce: "a".repeat(23) },
    { ...good, command: "prune" },
    { ...good, principal: { ...good.principal, root: "/foreign" } },
    { ...good, principal: { ...good.principal, imageIds: [sha("1")] } },
    { ...good, principal: { ...good.principal, imageIds: [sha("1"), sha("1")] } },
    { ...good, principal: { ...good.principal, token: "secret" } },
  ]) assert.throws(() => validateGosuDerivativeImageDaemonLeaseInput(changed));
});

test("daemon diagnostics expose only a closed code and phase and read hostile messages once", () => {
  let reads = 0;
  const diagnostic = gosuDerivativeImageDaemonFailureDiagnostic({
    get message() { reads += 1; throw new Error("private path and output"); },
  });
  assert.equal(reads, 1);
  assert.deepEqual(Object.keys(diagnostic).sort(), ["code", "phase"]);
  assert.match(diagnostic.code, /^gosu_derivative_image_daemon_/u);
  assert.doesNotMatch(JSON.stringify(diagnostic), /private path|output/u);
});

test("daemon start rejects extra dependency hooks before invoking helper or transport", async () => {
  let helperCalls = 0; let transportCalls = 0;
  const helper = Object.freeze({
    async start() { helperCalls += 1; },
    async verify() { helperCalls += 1; },
    async stop() { helperCalls += 1; },
  });
  const transport = async () => { transportCalls += 1; };
  await assert.rejects(startGosuDerivativeImageDaemonLease(input(), { helper, transport, now: () => 0, shell: true }));
  assert.equal(helperCalls, 0);
  assert.equal(transportCalls, 0);
});

test("daemon source forbids broad cleanup primitives", async () => {
  const source = await readFile(SOURCE, "utf8");
  assert.doesNotMatch(source, /\b(?:prune|rmSync|rmdirSync|killall|pkill)\b/u);
});

if (typeof vm.SourceTextModule !== "function") {
  test("daemon lifecycle VM tests relaunch with a nonempty child suite", () => {
    const environment = { ...process.env, AUTO_WORLD_GOSU_DAEMON_VM: "1" }; delete environment.NODE_TEST_CONTEXT;
    const result = childProcess.spawnSync(process.execPath, ["--experimental-vm-modules", "--test", SELF], {
      env: environment, encoding: "utf8", timeout: 60_000,
    });
    const count = /# tests (\d+)/u.exec(result.stdout); const transcript = `${result.stdout}\n${result.stderr}`;
    assert.ok(count && Number(count[1]) > 6, transcript); assert.equal(result.status, 0, transcript);
  });
} else {
  const synthetic = (context, identifier, values) => new vm.SyntheticModule(Object.keys(values), function initialize() {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier });

  async function daemonFixture({ wrongStopTicks = false, changePrincipal = false, advanceTransportIntoReserve = false } = {}) {
    const root = "/var/tmp/aw-cl-ABC123"; let inode = 10n; let descriptor = 100; let clock = 0; let realmArray;
    const records = new Map(); const handles = new Map(); const helperCalls = []; const transportCalls = [];
    const add = (name, kind, uid, gid, permissions, data = Buffer.alloc(0), size = data.length) => {
      records.set(name, { name, kind, uid, gid, mode: BigInt((kind === "directory" ? 0o040000 : kind === "socket" ? 0o140000 : 0o100000) | permissions),
        ino: inode++, dev: 70n, nlink: 1n, data: Buffer.from(data), size, mtimeNs: 1n, ctimeNs: 1n });
    };
    add(root, "directory", 0, 1000, 0o710);
    const toolPins = [
      ["/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node", 124836408, "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327"],
      ["/usr/bin/docker", 43134496, "6435ff9214bf8e0931078fb0980809728cac0a54a526d4f28a26d3e48132b58d"],
      ["/usr/bin/dockerd", 83666424, "b8644399e73e2c9b32ea3983daf3a9856a483a79196bea10c01977d2b021fe71"],
      ["/usr/bin/ctr", 25875232, "acca62b7ac3e97c65839fa0d9d4a72b6cddd318d1a7abcc109e7c01b287ee3a7"],
      ["/usr/bin/setpriv", 39304, "62ec0120791f3afcfb689fed52384ec2b0accc6e118a6b9a1d6fcfa7450aaf37"],
      ["/usr/libexec/docker/cli-plugins/docker-buildx", 73054565, "3e6dcf88055ca9e59013376bf989c221b76c557460f1d47175aeb14a0e98c93c"],
    ];
    for (const [name, size] of toolPins) add(name, "file", 0, 0, 0o555, Buffer.alloc(0), size);
    const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
    const get = (name) => { const record = records.get(name); if (!record) throw missing(); return record; };
    const stat = (record) => ({ dev: record.dev, ino: record.ino, uid: BigInt(record.uid), gid: BigInt(record.gid), mode: record.mode,
      nlink: record.nlink, size: BigInt(record.size), mtimeNs: record.mtimeNs, ctimeNs: record.ctimeNs,
      isFile: () => record.kind === "file", isDirectory: () => record.kind === "directory",
      isSymbolicLink: () => false, isSocket: () => record.kind === "socket" });
    const constants = { O_RDONLY: 0, O_WRONLY: 1, O_CREAT: 2, O_EXCL: 4, O_NOFOLLOW: 8 };
    const virtualFs = {
      constants,
      chmodSync(name, permissions) { const record = get(name); record.mode = (record.mode & ~0o7777n) | BigInt(permissions); },
      chownSync(name, uid, gid) { const record = get(name); record.uid = uid; record.gid = gid; },
      closeSync(fd) { handles.delete(fd); },
      fstatSync(fd) { return stat(handles.get(fd)); },
      fsyncSync() {},
      lstatSync(name) { return stat(get(name)); },
      mkdirSync(name) { if (records.has(name)) throw Object.assign(new Error("exists"), { code: "EEXIST" }); add(name, "directory", 0, 0, 0o700); },
      openSync(name, flags, mode = 0o600) {
        let record = records.get(name);
        if ((flags & constants.O_CREAT) !== 0) {
          if (record && (flags & constants.O_EXCL) !== 0) throw Object.assign(new Error("exists"), { code: "EEXIST" });
          if (!record) { add(name, "file", 0, 0, mode); record = get(name); }
        }
        if (!record) throw missing(); const fd = descriptor++; handles.set(fd, record); return fd;
      },
      readFileSync(value) { const record = typeof value === "number" ? handles.get(value) : get(value); return Buffer.from(record.data); },
      readSync(fd, buffer, offset, length, position) {
        const record = handles.get(fd); if (position >= record.size) return 0;
        const count = Math.min(length, record.size - position); buffer.fill(0, offset, offset + count); return count;
      },
      realpathSync(name) { get(name); return name; },
      readdirSync(directory) {
        const prefix = `${directory}/`; return realmArray([...records.keys()].filter((name) => name.startsWith(prefix)
          && !name.slice(prefix.length).includes("/")).map((name) => name.slice(prefix.length)));
      },
      statfsSync() { return { bavail: 16n * 1024n ** 3n, bsize: 1n }; },
      writeFileSync(value, data) { const record = typeof value === "number" ? handles.get(value) : get(value);
        record.data = Buffer.from(data); record.size = record.data.length; },
    };
    const owned = { pid: 4321, startTicks: "1234", daemonId: "isolated-engine", namespacesFresh: true }; let realm;
    const helper = {
      async start(spec) {
        helperCalls.push(["start", spec]); virtualFs.chmodSync(spec.dataRoot, 0o710);
        add(spec.pidFile, "file", 0, 0, 0o600, Buffer.from(String(owned.pid)));
        add(spec.socket, "socket", 0, 1000, 0o660); return realm(owned);
      },
      async verify(spec, child) { helperCalls.push(["verify", spec, child]); return realm({ state: "RUNNING", pid: owned.pid,
        startTicks: owned.startTicks, uid: 0, gid: 0, executable: spec.executable, version: spec.version,
        argvSha256: spec.argvSha256, configSha256: spec.configSha256 }); },
      async stop(spec, child) {
        helperCalls.push(["stop", spec, child]); records.delete(spec.socket); records.delete(spec.pidFile);
        return realm({ state: "STOPPED", pid: child.pid, startTicks: wrongStopTicks ? "9999" : child.startTicks, processGone: true });
      },
    };
    const principalValue = principal(); const isolatedImages = [];
    const info = (isolated) => ({ ID: isolated ? owned.daemonId : principalValue.id, ServerVersion: "28.0.4",
      DockerRootDir: isolated ? `${root}/infra/data` : principalValue.root, Driver: "overlay2", OSType: "linux", Architecture: "x86_64",
      Containerd: { Address: principalValue.containerdAddress, Namespaces: { Containers: isolated ? `awcold-${"a".repeat(24)}` : "moby",
        Plugins: isolated ? `plugins.awcold-${"a".repeat(24)}` : "plugins.moby" } } });
    const transport = async (_binary, args, options) => {
      transportCalls.push([args, options, clock]);
      const isolated = args[1] !== "unix:///var/run/docker.sock"; const command = args.slice(2); let stdout = Buffer.alloc(0);
      if (command[0] === "info") stdout = Buffer.from(JSON.stringify(info(isolated)));
      else if (command[0] === "image" && command[1] === "ls") stdout = Buffer.from(`${(isolated ? isolatedImages : principalValue.imageIds).join("\n")}${isolatedImages.length || !isolated ? "\n" : ""}`);
      else if (command[0] === "image" && command[1] === "inspect") stdout = Buffer.from(JSON.stringify({ Id: command.at(-1) }));
      else if (command[0] === "version") stdout = Buffer.from("28.0.4|28.0.4\n");
      if (changePrincipal && !isolated && command[0] === "image" && command[1] === "ls" && helperCalls.some(([name]) => name === "start")) {
        stdout = Buffer.from(`${principalValue.imageIds[0]}\n`);
      }
      if (advanceTransportIntoReserve && clock >= 574_000) clock = 576_000;
      return realm({ status: 0, stdout, stderr: Buffer.alloc(0) });
    };
    const createHash = () => {
      const real = crypto.createHash("sha256"); let total = 0; let large = false;
      return { update(value) { total += value.length; if (total > 2 * 1024 * 1024) large = true; if (!large) real.update(value); return this; },
        digest(encoding) { const pin = toolPins.find(([, size]) => size === total); return pin ? pin[2] : real.digest(encoding); } };
    };
    const context = vm.createContext({ Buffer, TextDecoder, clearTimeout, setTimeout, process: Object.freeze({ platform: "linux", getuid: () => 0, geteuid: () => 0,
        getgid: () => 0, getegid: () => 0, version: "v22.23.2",
        execPath: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node", env: {} }) });
    const deepMismatches = []; const deep = (left, right) => { const equal = isDeepStrictEqual(left, right);
      if (!equal) deepMismatches.push([left, right]); return equal; };
    const modules = new Map([
      ["node:child_process", synthetic(context, "mock:child", { spawnSync: () => { throw new Error("not used"); } })],
      ["node:crypto", synthetic(context, "mock:crypto", { createHash })],
      ["node:fs", synthetic(context, "mock:fs", virtualFs)],
      ["node:path", synthetic(context, "mock:path", { default: path.posix })],
      ["node:timers", synthetic(context, "mock:timers", { clearTimeout, setTimeout })],
      ["node:util", synthetic(context, "mock:util", { isDeepStrictEqual: deep, TextDecoder })],
      ["../docker-isolated/daemon-cold-load-helper.mjs", synthetic(context, "mock:helper", {
        coldLoadDaemonConfiguration: (spec) => ({ "data-root": spec.dataRoot, "exec-root": spec.execRoot, pidfile: spec.pidFile,
          hosts: [`unix://${spec.socket}`], bridge: "none", iptables: false }), createColdLoadDaemonHelper: () => helper,
      })],
    ]);
    const source = new vm.SourceTextModule(fs.readFileSync(SOURCE, "utf8"), { context, identifier: SOURCE.href });
    await source.link((specifier) => modules.get(specifier)); await source.evaluate();
    const realmObject = (values) => Object.assign(vm.runInContext("({})", context), values); realm = realmObject;
    realmArray = (values) => { const result = vm.runInContext("[]", context); result.push(...values); return result; };
    const vmInput = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(input()))})`, context);
    const dependencies = realmObject({ helper: realmObject(helper), transport, env: realmObject({}), now: () => clock });
    const emptySubjects = realmArray([]); const stopEmpty = realmObject({ requireMode: "EMPTY" });
    return { api: source.namespace, helper, helperCalls, transport, transportCalls, now: () => clock, setClock: (value) => { clock = value; },
      records, owned, vmInput, dependencies,
      deepMismatches, emptySubjects, stopEmpty };
  }

  test("FORMAT_ONLY daemon lifecycle starts, verifies empty inventory and stops its exact owned process", async () => {
    const fixture = await daemonFixture();
    fixture.api.validateGosuDerivativeImageDaemonLeaseInput(fixture.vmInput);
    let lease;
    try { lease = await fixture.api.startGosuDerivativeImageDaemonLease(fixture.vmInput, fixture.dependencies); }
    catch (error) { const mismatch = fixture.deepMismatches.at(-1); const encoded = mismatch && JSON.stringify(mismatch,
      (_key, value) => typeof value === "bigint" ? `${value}n` : Buffer.isBuffer(value) ? `buffer:${value.length}` : value);
      assert.fail(`${error.message}; helper=${fixture.helperCalls.map(([name]) => name).join(",")}; mismatch=${encoded}`); }
    assert.equal(lease.identity.pid, fixture.owned.pid); assert.equal(lease.identity.startTicks, fixture.owned.startTicks);
    assert.equal(lease.identity.deadlineAtMs, 600_000); assert.equal(lease.identity.purpose, "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION");
    const empty = await lease.verifyInventory("EMPTY", fixture.emptySubjects); assert.equal(empty.state, "VERIFIED_EMPTY");
    const stopped = await lease.stop(fixture.stopEmpty); assert.equal(stopped.processGone, true);
    const stop = fixture.helperCalls.find(([name]) => name === "stop"); assert.equal(stop[2].pid, fixture.owned.pid);
    assert.equal(stop[2].startTicks, fixture.owned.startTicks);
  });

  test("daemon stop rejects a foreign start tick instead of accepting cleanup", async () => {
    const fixture = await daemonFixture({ wrongStopTicks: true });
    const lease = await fixture.api.startGosuDerivativeImageDaemonLease(fixture.vmInput, fixture.dependencies);
    await assert.rejects(lease.stop(fixture.stopEmpty), /gosu_derivative_image_daemon_cleanup_uncertain/u);
  });

  test("daemon refuses metadata in the final 25 seconds but still attempts its exact owned stop", async () => {
    const fixture = await daemonFixture();
    const lease = await fixture.api.startGosuDerivativeImageDaemonLease(fixture.vmInput, fixture.dependencies);
    fixture.setClock(576_000);
    await assert.rejects(lease.verifyIdentity(), /gosu_derivative_image_daemon_deadline_exceeded/u);
    await assert.rejects(lease.stop(fixture.stopEmpty), /gosu_derivative_image_daemon_cleanup_uncertain/u);
    const stop = fixture.helperCalls.find(([name]) => name === "stop"); assert.equal(stop[2].pid, fixture.owned.pid);
    assert.equal(stop[2].startTicks, fixture.owned.startTicks);
  });

  test("daemon transport cannot borrow stop reserve when metadata crosses the work deadline", async () => {
    const fixture = await daemonFixture({ advanceTransportIntoReserve: true });
    const lease = await fixture.api.startGosuDerivativeImageDaemonLease(fixture.vmInput, fixture.dependencies);
    const previousCalls = fixture.transportCalls.length; fixture.setClock(574_000);
    await assert.rejects(lease.stop(fixture.stopEmpty), /gosu_derivative_image_daemon_cleanup_uncertain/u);
    const stop = fixture.helperCalls.find(([name]) => name === "stop"); assert.equal(stop[2].pid, fixture.owned.pid);
    assert.equal(stop[2].startTicks, fixture.owned.startTicks);
    const finalTransports = fixture.transportCalls.slice(previousCalls); assert.ok(finalTransports.length >= 1);
    assert.ok(finalTransports.every(([, options]) => options.timeoutMs <= 1_000));
  });

  test("daemon fails retained when principal inventory changes after start", async () => {
    const fixture = await daemonFixture({ changePrincipal: true });
    await assert.rejects(fixture.api.startGosuDerivativeImageDaemonLease(fixture.vmInput, fixture.dependencies),
      /gosu_derivative_image_daemon_(?:principal_changed|cleanup_uncertain)/u);
    assert.equal(fixture.helperCalls.some(([name]) => name === "stop"), true);
  });
}
