import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SOURCE = new URL("../scripts/docker-isolated/daemon-postgres-runtime-helper.mjs", import.meta.url);
const SELF = fileURLToPath(import.meta.url);
const DOCKERD_BYTES = 83_666_424;
const DOCKERD_SHA = "b8644399e73e2c9b32ea3983daf3a9856a483a79196bea10c01977d2b021fe71";

if (typeof vm.SourceTextModule !== "function") {
  test("actual daemon helper cancellation VM tests", () => {
    const result = childProcess.spawnSync(process.execPath, ["--experimental-vm-modules", "--test", SELF], {
      encoding: "utf8", timeout: 60_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
} else {
  const synthetic = (context, identifier, values) => new vm.SyntheticModule(Object.keys(values), function initialize() {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier });

  const pretty = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const digest = value => crypto.createHash("sha256").update(value).digest("hex");

  async function fixture(mode) {
    const controller = new globalThis.AbortController();
    const nonce = "1".repeat(24); const root = "/var/tmp/aw-pr-abc123"; let inode = 10; let fd = 100;
    const records = new Map(); const handles = new Map(); const killed = []; const spawned = [];
    const addDirectory = (name, gid, permissions) => records.set(name,
      { kind: "directory", uid: 0, gid, mode: 0o040000 | permissions, ino: inode++, size: 0, data: Buffer.alloc(0) });
    const addFile = (name, data, permissions = 0o600, size = data.length) => records.set(name,
      { kind: "file", uid: 0, gid: 0, mode: 0o100000 | permissions, ino: inode++, size, data });
    addDirectory(root, 1000, 0o710); addDirectory(`${root}/infra`, 0, 0o700);
    addDirectory(`${root}/infra/client`, 0, 0o700); addDirectory(`${root}/endpoint`, 0, 0o700);
    addDirectory(`${root}/infra/data`, 0, 0o700); addDirectory(`${root}/infra/exec`, 0, 0o700);
    for (const [name, size] of [["/usr/bin/dockerd", DOCKERD_BYTES], ["/usr/bin/docker", 7], ["/usr/bin/ctr", 3]]) {
      addFile(name, Buffer.alloc(Math.min(size, 7)), 0o555, size);
    }
    const spec = { root, infrastructure: `${root}/infra`, endpointDirectory: `${root}/endpoint`, rootClient: `${root}/infra/client`,
      uid: 0, gid: 0, executable: "/usr/bin/dockerd", version: "28.0.4", nonce,
      configFile: `${root}/infra/daemon.json`, pidFile: `${root}/infra/daemon.pid`, logFile: `${root}/infra/daemon.log`,
      socket: `${root}/endpoint/docker.sock`, dataRoot: `${root}/infra/data`, execRoot: `${root}/infra/exec`,
      containerdAddress: "/run/containerd/containerd.sock", containersNamespace: `awpgsql-${nonce}`,
      pluginsNamespace: `plugins.awpgsql-${nonce}` };
    spec.args = ["--config-file", spec.configFile, "--containerd-plugins-namespace", spec.pluginsNamespace];
    spec.argvSha256 = digest(pretty([spec.executable, ...spec.args]));
    const config = { "data-root": spec.dataRoot, "exec-root": spec.execRoot, pidfile: spec.pidFile,
      hosts: [`unix://${spec.socket}`], bridge: "none", iptables: false, ip6tables: false, "ip-forward": false,
      "ip-masq": false, "userland-proxy": false, containerd: spec.containerdAddress,
      "containerd-namespace": spec.containersNamespace, "storage-driver": "overlay2",
      "default-cgroupns-mode": "private", "default-ipc-mode": "private", "default-runtime": "runc" };
    spec.configSha256 = digest(pretty(config));
    addFile(spec.configFile, pretty(config)); addFile(`${spec.rootClient}/config.json`, pretty({})); addFile(spec.logFile, Buffer.alloc(0));
    const stat = (record, bigint = false) => {
      const number = value => bigint ? BigInt(value) : value;
      return { dev: number(1), ino: number(record.ino), uid: number(record.uid), gid: number(record.gid),
        mode: number(record.mode), nlink: number(1), size: number(record.size), mtimeNs: number(10), ctimeNs: number(10),
        isFile: () => record.kind === "file", isDirectory: () => record.kind === "directory",
        isSymbolicLink: () => false, isSocket: () => record.kind === "socket" };
    };
    const get = name => { const value = records.get(name); if (!value) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return value; };
    const fsMock = {
      chmodSync(name, permissions) { const value = get(name); value.mode = (value.mode & ~0o7777) | permissions; },
      chownSync(name, uid, gid) { const value = get(name); value.uid = uid; value.gid = gid; },
      closeSync(handle) { handles.delete(handle); }, constants: fs.constants,
      fstatSync(handle, options = {}) { return stat(handles.get(handle), options.bigint); },
      lstatSync(name, options = {}) { return stat(get(name), options.bigint); },
      openSync(name) { const handle = fd++; handles.set(handle, get(name)); return handle; },
      readFileSync(name, encoding) {
        if (typeof name === "number") { const value = handles.get(name).data; return encoding ? value.toString(encoding) : Buffer.from(value); }
        if (name.startsWith("/proc/")) throw Object.assign(new Error("unavailable"), { code: "ENOENT" });
        const value = get(name).data; return encoding ? value.toString(encoding) : Buffer.from(value);
      },
      readlinkSync() { return "/usr/bin/dockerd"; },
      readSync(handle, buffer, offset, length, position) {
        const record = handles.get(handle); const count = Math.max(0, Math.min(length, record.size - position));
        buffer.fill(0, offset, offset + count); return count;
      },
      realpathSync(name) { get(name); return name; },
    };
    const createHash = () => {
      const real = crypto.createHash("sha256"); let total = 0; let large = false;
      return { update(value) { total += value.length; if (total > 2 * 1024 * 1024) large = true; if (!large) real.update(value); return this; },
        digest(encoding) { return large && total === DOCKERD_BYTES ? DOCKERD_SHA : real.digest(encoding); } };
    };
    let commandIndex = 0;
    const spawn = (command, args) => {
      spawned.push([command, ...args]);
      const child = new EventEmitter(); child.pid = 4242; child.exitCode = null;
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.unref = () => {};
      child.kill = signal => { killed.push(signal); child.exitCode = 0; globalThis.queueMicrotask(() => child.emit("close", 0, null)); return false; };
      const daemon = command === "/usr/bin/dockerd" && !args.includes("--version") && !args.includes("--validate");
      if (!daemon) {
        commandIndex += 1;
        if (mode === "command" && commandIndex === 1) globalThis.queueMicrotask(() => controller.abort());
        else globalThis.queueMicrotask(() => {
          if (args.includes("--version")) child.stdout.end("Docker version 28.0.4, build 6430e49\n");
          else if (args.includes("--validate")) child.stderr.end("configuration OK\n");
          else child.stdout.end("\n");
          child.stderr.end(); child.exitCode = 0; child.emit("close", 0, null);
        });
      }
      return child;
    };
    const context = vm.createContext({ AbortController: globalThis.AbortController, Buffer, Date, Error, JSON, Map, Object, Promise, RegExp, Set,
      URL, clearTimeout: globalThis.clearTimeout,
      process: Object.freeze({ platform: "linux", getuid: () => 0, getgid: () => 0, kill: () => {} }),
      queueMicrotask: globalThis.queueMicrotask, setTimeout: globalThis.setTimeout });
    const modules = new Map([
      ["node:child_process", synthetic(context, "mock:child", { spawn })],
      ["node:crypto", synthetic(context, "mock:crypto", { createHash })],
      ["node:fs", synthetic(context, "mock:fs", fsMock)],
      ["node:path", synthetic(context, "mock:path", { default: path.posix })],
      ["node:timers/promises", synthetic(context, "mock:timers", { setTimeout: async milliseconds => {
        if (mode === "hash" && milliseconds === 0) controller.abort();
        if (mode === "proof" && milliseconds === 50) controller.abort();
      } })],
      ["node:util", synthetic(context, "mock:util", {
        isDeepStrictEqual: (left, right) => JSON.stringify(left, (_key, value) => typeof value === "bigint" ? `${value}n` : value)
          === JSON.stringify(right, (_key, value) => typeof value === "bigint" ? `${value}n` : value),
      })],
      ["./daemon-helper.mjs", synthetic(context, "mock:daemon-helper", {
        validateLocalDaemonConfigurationResult: value => value,
      })],
    ]);
    const source = new vm.SourceTextModule(fs.readFileSync(SOURCE, "utf8"), { context, identifier: SOURCE.href });
    await source.link(async specifier => {
      if (modules.has(specifier)) return modules.get(specifier);
      const namespace = await import(specifier);
      return synthetic(context, specifier, Object.fromEntries(Object.keys(namespace).map(name => [name, namespace[name]])));
    });
    await source.evaluate();
    context.specJSON = JSON.stringify(spec);
    const vmSpec = vm.runInContext("JSON.parse(specJSON)", context);
    return { helper: source.namespace.createPostgresRuntimeDaemonHelper(), spec: vmSpec,
      signal: controller.signal, killed, spawned };
  }

  for (const mode of ["hash", "command", "proof"]) test(`actual helper closes ${mode} cancellation without a successful start`, async () => {
    const value = await fixture(mode);
    let failure;
    try { await value.helper.start(value.spec, value.signal); } catch (error) { failure = error; }
    assert.match(failure?.message ?? "", /daemon_postgres_runtime_(?:helper_invalid|cleanup_uncertain)/u);
    if (mode === "proof") assert.ok(value.killed.includes("SIGTERM"), `${failure?.stack}\n${JSON.stringify(value.spawned)}`);
  });
}
