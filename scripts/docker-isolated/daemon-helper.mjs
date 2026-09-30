import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync, realpathSync,
  chmodSync, chownSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const DOCKERD = "/usr/bin/dockerd";
const DOCKER = "/usr/bin/docker";
const CONTAINERD = "/run/containerd/containerd.sock";
const VERSION = "28.0.4";
const CAP = 1024 ** 2;
const WAIT_MS = 60_000;
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const bytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const sha = (value) => createHash("sha256").update(value).digest("hex");
function fail(code = "daemon_local_helper_invalid") { throw new Error(code); }
function canonicalDirectory(file, mode) {
  const value = lstatSync(file);
  if (!value.isDirectory() || value.isSymbolicLink() || value.uid !== 0 || value.gid !== 0
    || (value.mode & 0o777) !== mode || realpathSync(file) !== file) fail();
}
function privateFile(file, expectedSha) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    const current = lstatSync(file);
    if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || before.nlink !== 1
      || (before.mode & 0o777) !== 0o600 || before.size > CAP || current.isSymbolicLink()
      || current.dev !== before.dev || current.ino !== before.ino) fail();
    const value = readFileSync(fd);
    const after = fstatSync(fd);
    if (before.size !== value.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || expectedSha !== undefined && sha(value) !== expectedSha) fail();
    return value;
  } finally { closeSync(fd); }
}
function validateSpec(spec) {
  if (!plain(spec) || spec.uid !== 0 || spec.gid !== 0 || spec.executable !== DOCKERD || spec.version !== VERSION
    || !/^\/var\/tmp\/aw-dp-[A-Za-z0-9]{6}\/daemon-[0-9a-f]{24}$/u.test(spec.root ?? "")
    || spec.containerdAddress !== CONTAINERD) fail();
  const nonce = path.basename(spec.root).slice("daemon-".length);
  if (spec.dataRoot !== path.join(spec.root, "data") || spec.execRoot !== path.join(spec.root, "exec")
    || spec.socket !== path.join(spec.root, "docker.sock") || spec.pidFile !== path.join(spec.root, "daemon.pid")
    || spec.logFile !== path.join(spec.root, "daemon.log") || spec.configFile !== path.join(spec.root, "daemon.json")
    || spec.containersNamespace !== "awdiag-" + nonce || spec.pluginsNamespace !== "plugins.awdiag-" + nonce
    || !isDeepStrictEqual(spec.args, ["--config-file", spec.configFile])
    || spec.argvSha256 !== sha(bytes([DOCKERD, ...spec.args]))) fail();
  canonicalDirectory(path.dirname(spec.root), 0o700);
  canonicalDirectory(spec.root, 0o700);
  const configuration = JSON.parse(privateFile(spec.configFile, spec.configSha256));
  const expected = {
    "data-root": spec.dataRoot, "exec-root": spec.execRoot, pidfile: spec.pidFile,
    hosts: ["unix://" + spec.socket], bridge: "none", iptables: false, ip6tables: false,
    "ip-forward": false, "ip-masq": false, "userland-proxy": false, containerd: CONTAINERD,
    "containerd-namespace": spec.containersNamespace, "containerd-plugins-namespace": spec.pluginsNamespace,
    "storage-driver": "overlay2", "default-cgroupns-mode": "private", "default-ipc-mode": "private",
    "default-runtime": "runc",
  };
  if (!isDeepStrictEqual(configuration, expected)) fail();
  return spec;
}
export function validateLocalDaemonProcessProof(value, expected) {
  if (!plain(value) || !plain(expected) || value.pid !== expected.pid || !Number.isSafeInteger(value.pid)
    || value.pid < 2 || value.startTicks !== expected.startTicks || !/^[1-9][0-9]{0,19}$/u.test(value.startTicks ?? "")
    || !isDeepStrictEqual(value.uid, [0, 0, 0, 0]) || !isDeepStrictEqual(value.gid, [0, 0, 0, 0])
    || value.executable !== DOCKERD || !isDeepStrictEqual(value.argv, [DOCKERD, "--config-file", expected.configFile])
    || !/^[RSDTtWIP]$/u.test(value.state ?? "")) fail();
  return Object.freeze({ pid: value.pid, startTicks: value.startTicks });
}
function procProof(pid) {
  const directory = "/proc/" + pid;
  const stat = readFileSync(path.join(directory, "stat"), "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
  const status = readFileSync(path.join(directory, "status"), "utf8");
  const ids = (name) => {
    const matched = new RegExp("^" + name + ":\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*$", "mu").exec(status);
    if (!matched) fail();
    return matched.slice(1).map(Number);
  };
  const argv = readFileSync(path.join(directory, "cmdline")).toString("utf8").split("\0");
  if (argv.pop() !== "") fail();
  return { pid, startTicks: fields[19], state: fields[0], uid: ids("Uid"), gid: ids("Gid"),
    executable: readlinkSync(path.join(directory, "exe")), argv };
}
function result(command, args, options) {
  const observed = spawnSync(command, args, { ...options, encoding: null, timeout: 10_000, maxBuffer: CAP });
  if (observed.error || observed.signal || observed.status !== 0 || !Buffer.isBuffer(observed.stdout)
    || !Buffer.isBuffer(observed.stderr) || observed.stderr.length !== 0) fail();
  return observed.stdout;
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// This local infrastructure probe starts no image and offers no arbitrary privileged command API.
export function createLocalDaemonHelper() {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0) fail();
  const binary = lstatSync(DOCKERD);
  if (!binary.isFile() || binary.isSymbolicLink() || binary.uid !== 0 || (binary.mode & 0o022) !== 0) fail();
  const environment = Object.freeze({ PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" });
  if (result(DOCKERD, ["--version"], { env: environment }).toString("utf8").trim()
    !== "Docker version 28.0.4, build 6430e49") fail();
  let owned;
  const binaryUnchanged = () => {
    const current = lstatSync(DOCKERD);
    if (current.dev !== binary.dev || current.ino !== binary.ino || current.size !== binary.size
      || current.mtimeMs !== binary.mtimeMs || current.ctimeMs !== binary.ctimeMs
      || current.uid !== binary.uid || current.mode !== binary.mode) fail();
  };
  const alive = () => {
    if (!owned) return false;
    try {
      const proof = procProof(owned.pid);
      if (proof.startTicks !== owned.startTicks) return false;
      validateLocalDaemonProcessProof(proof, owned);
      return true;
    } catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return false; throw error; }
  };
  const originalExists = () => {
    if (!owned) return false;
    try {
      const stat = readFileSync("/proc/" + owned.pid + "/stat", "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u)[19] === owned.startTicks;
    } catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return false; throw error; }
  };
  const terminate = async () => {
    if (!owned) fail("daemon_local_cleanup_uncertain");
    if (alive()) process.kill(owned.pid, "SIGTERM");
    const deadline = Date.now() + 20_000;
    while (originalExists() && Date.now() < deadline) await sleep(50);
    if (originalExists()) {
      validateLocalDaemonProcessProof(procProof(owned.pid), owned);
      process.kill(owned.pid, "SIGKILL");
      const killDeadline = Date.now() + 5_000;
      while (originalExists() && Date.now() < killDeadline) await sleep(50);
    }
    if (originalExists()) fail("daemon_local_cleanup_uncertain");
  };
  return Object.freeze({
    start: async (input) => {
      const spec = validateSpec(input); binaryUnchanged();
      if (owned) fail();
      const namespaces = result("/usr/bin/ctr", ["--address", CONTAINERD, "namespaces", "list", "--quiet"],
        { env: environment }).toString("utf8").trim().split(/\r?\n/u);
      if (namespaces.includes(spec.containersNamespace) || namespaces.includes(spec.pluginsNamespace)) fail();
      result(DOCKERD, ["--validate", "--config-file", spec.configFile], { env: environment });
      const fd = openSync(spec.logFile, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
      let child;
      try {
        const log = fstatSync(fd);
        if (!log.isFile() || log.uid !== 0 || log.gid !== 0 || log.nlink !== 1 || (log.mode & 0o777) !== 0o600) fail();
        child = spawn(DOCKERD, spec.args, { cwd: spec.root, env: environment, detached: true, stdio: ["ignore", fd, fd] });
      } finally { closeSync(fd); }
      child.on("error", () => {}); child.unref();
      const deadline = Date.now() + WAIT_MS;
      try {
        while (Date.now() < deadline) {
          if (child.exitCode !== null) fail();
          let processState;
          try { processState = procProof(child.pid); }
          catch (error) { if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error; }
          if (processState?.executable === DOCKERD) {
            owned ??= { pid: child.pid, startTicks: processState.startTicks, configFile: spec.configFile };
            validateLocalDaemonProcessProof(processState, owned);
            if (lstatExists(spec.socket) && lstatExists(spec.pidFile)) {
              const socketStat = lstatSync(spec.socket); const pidStat = lstatSync(spec.pidFile);
              if (!socketStat.isSocket() || socketStat.isSymbolicLink() || socketStat.uid !== 0
                || !pidStat.isFile() || pidStat.isSymbolicLink() || pidStat.uid !== 0 || pidStat.nlink !== 1
                || pidStat.size < 2 || pidStat.size > 32) fail();
              chmodSync(spec.pidFile, 0o600); chownSync(spec.pidFile, 0, 0);
              chmodSync(spec.socket, 0o600); chownSync(spec.socket, 0, 0);
              const observed = spawnSync(DOCKER, ["--host", "unix://" + spec.socket, "info", "--format", "{{json .}}"],
                { env: { ...environment, DOCKER_CONFIG: path.join(spec.root, "client") }, encoding: null,
                  timeout: 10_000, maxBuffer: CAP });
              if (!observed.error && !observed.signal && observed.status === 0 && observed.stderr?.length === 0) {
                const info = JSON.parse(observed.stdout);
                if (typeof info.ID !== "string" || info.DockerRootDir !== spec.dataRoot || info.ServerVersion !== VERSION) fail();
                return Object.freeze({ pid: owned.pid, startTicks: owned.startTicks, daemonId: info.ID, namespacesFresh: true });
              }
            }
          }
          await sleep(50);
        }
        fail();
      } catch {
        if (!owned) fail("daemon_local_cleanup_uncertain");
        try { await terminate(); } catch { fail("daemon_local_cleanup_uncertain"); }
        fail();
      }
    },
    verify: async (input, child) => {
      const spec = validateSpec(input); binaryUnchanged();
      if (!owned || child?.pid !== owned.pid || child?.startTicks !== owned.startTicks || owned.configFile !== spec.configFile) fail();
      validateLocalDaemonProcessProof(procProof(owned.pid), owned);
      return Object.freeze({ state: "RUNNING", pid: owned.pid, startTicks: owned.startTicks, uid: 0,
        executable: DOCKERD, version: VERSION, argvSha256: spec.argvSha256, configSha256: spec.configSha256 });
    },
    stop: async (input, child) => {
      const spec = validateSpec(input); binaryUnchanged();
      if (!owned || child?.pid !== owned.pid || child?.startTicks !== owned.startTicks || owned.configFile !== spec.configFile) {
        fail("daemon_local_cleanup_uncertain");
      }
      await terminate();
      return Object.freeze({ state: "STOPPED", pid: owned.pid, startTicks: owned.startTicks, processGone: true });
    },
  });
}
function lstatExists(file) {
  try { lstatSync(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
