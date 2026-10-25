import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, closeSync, constants, fstatSync, lstatSync, openSync, readFileSync,
  readlinkSync, readSync, realpathSync } from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { validateLocalDaemonConfigurationResult } from "./daemon-helper.mjs";

const DOCKERD = "/usr/bin/dockerd"; const DOCKER = "/usr/bin/docker"; const CTR = "/usr/bin/ctr";
const CONTAINERD = "/run/containerd/containerd.sock"; const CAP = 1024 ** 2;
const DOCKERD_BYTES = 83_666_424;
const DOCKERD_SHA = "b8644399e73e2c9b32ea3983daf3a9856a483a79196bea10c01977d2b021fe71";
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, names) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...names].sort());
const bytes = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
const sha = (v) => createHash("sha256").update(v).digest("hex");
function fail(code = "daemon_cold_load_helper_invalid") { throw new Error(code); }

export function validateColdLoadDaemonHelperSpec(spec) {
  const names = ["root", "infrastructure", "endpointDirectory", "rootClient", "uid", "gid", "executable", "version", "nonce", "args",
    "configFile", "configSha256", "argvSha256", "pidFile", "logFile", "socket", "dataRoot", "execRoot",
    "containerdAddress", "containersNamespace", "pluginsNamespace"];
  if (!keys(spec, names) || !/^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u.test(spec.root)
    || !/^[0-9a-f]{24}$/u.test(spec.nonce) || spec.uid !== 0 || spec.gid !== 0 || spec.executable !== DOCKERD
    || spec.version !== "28.0.4" || spec.containerdAddress !== CONTAINERD) fail();
  const infra = path.posix.join(spec.root, "infra"); const endpoint = path.posix.join(spec.root, "endpoint");
  if (spec.infrastructure !== infra || spec.endpointDirectory !== endpoint || spec.rootClient !== path.posix.join(infra, "client")
    || spec.dataRoot !== path.posix.join(infra, "data") || spec.execRoot !== path.posix.join(infra, "exec")
    || spec.configFile !== path.posix.join(infra, "daemon.json") || spec.pidFile !== path.posix.join(infra, "daemon.pid")
    || spec.logFile !== path.posix.join(infra, "daemon.log") || spec.socket !== path.posix.join(endpoint, "docker.sock")
    || spec.containersNamespace !== `awcold-${spec.nonce}` || spec.pluginsNamespace !== `plugins.awcold-${spec.nonce}`
    || !isDeepStrictEqual(spec.args, ["--config-file", spec.configFile, "--containerd-plugins-namespace", spec.pluginsNamespace])
    || !/^[0-9a-f]{64}$/u.test(spec.configSha256) || spec.argvSha256 !== sha(bytes([DOCKERD, ...spec.args]))) fail();
  return spec;
}
export function coldLoadDaemonConfiguration(input) {
  const spec = validateColdLoadDaemonHelperSpec(input);
  return Object.freeze({ "data-root": spec.dataRoot, "exec-root": spec.execRoot, pidfile: spec.pidFile,
    hosts: [`unix://${spec.socket}`], bridge: "none", iptables: false, ip6tables: false,
    "ip-forward": false, "ip-masq": false, "userland-proxy": false, containerd: CONTAINERD,
    "containerd-namespace": spec.containersNamespace, "storage-driver": "overlay2", "default-cgroupns-mode": "private",
    "default-ipc-mode": "private", "default-runtime": "runc" });
}
export function validateColdLoadDaemonProcessProof(value, expected) {
  if (!keys(value, ["pid", "startTicks", "state", "uid", "gid", "executable", "argv"])
    || !keys(expected, ["pid", "startTicks", "configFile", "nonce"]) || !Number.isSafeInteger(value.pid) || value.pid < 2
    || value.pid !== expected.pid || !/^[1-9][0-9]{0,19}$/u.test(value.startTicks) || value.startTicks !== expected.startTicks
    || !/^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}\/infra\/daemon\.json$/u.test(expected.configFile)
    || !/^[0-9a-f]{24}$/u.test(expected.nonce) || !/^[RSDTtWIP]$/u.test(value.state)
    || !isDeepStrictEqual(value.uid, [0, 0, 0, 0]) || !isDeepStrictEqual(value.gid, [0, 0, 0, 0])
    || value.executable !== DOCKERD || !isDeepStrictEqual(value.argv, [DOCKERD, "--config-file", expected.configFile,
      "--containerd-plugins-namespace", `plugins.awcold-${expected.nonce}`])) fail();
  return Object.freeze({ pid: value.pid, startTicks: value.startTicks });
}
function directory(file, gid, mode) {
  const s = lstatSync(file);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== 0 || s.gid !== gid || (s.mode & 0o7777) !== mode || realpathSync(file) !== file) fail();
}
function privateFile(file, expected) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd, { bigint: true }); const entry = lstatSync(file, { bigint: true });
    const fields = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "uid", "gid", "mode", "nlink"];
    if (!s.isFile() || entry.isSymbolicLink() || s.uid !== 0n || s.gid !== 0n || s.nlink !== 1n || (s.mode & 0o7777n) !== 0o600n
      || s.size > BigInt(CAP) || fields.some((key) => s[key] !== entry[key])) fail();
    const value = readFileSync(fd); const after = fstatSync(fd, { bigint: true }); const final = lstatSync(file, { bigint: true });
    if (BigInt(value.length) !== s.size || fields.some((key) => s[key] !== after[key] || s[key] !== final[key])
      || expected !== undefined && sha(value) !== expected) fail();
    return value;
  } finally { closeSync(fd); }
}
function nativeSpec(input) {
  const spec = validateColdLoadDaemonHelperSpec(input);
  directory(spec.root, 1000, 0o710); directory(spec.infrastructure, 0, 0o700); directory(spec.rootClient, 0, 0o700);
  const endpoint = lstatSync(spec.endpointDirectory);
  if (endpoint.gid === 0) directory(spec.endpointDirectory, 0, 0o700);
  else directory(spec.endpointDirectory, 1000, 0o710);
  directory(spec.execRoot, 0, 0o700);
  if (!isDeepStrictEqual(JSON.parse(privateFile(spec.configFile, spec.configSha256)), coldLoadDaemonConfiguration(spec))
    || !privateFile(path.join(spec.rootClient, "config.json")).equals(bytes({}))) fail();
  return spec;
}
function processProof(pid) {
  const root = `/proc/${pid}`; const stat = readFileSync(path.join(root, "stat"), "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u);
  const status = readFileSync(path.join(root, "status"), "utf8");
  const ids = (name) => {
    const found = new RegExp(`^${name}:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*$`, "mu").exec(status);
    if (!found) fail(); return found.slice(1).map(Number);
  };
  const argv = readFileSync(path.join(root, "cmdline")).toString("utf8").split("\0"); if (argv.pop() !== "") fail();
  return { pid, startTicks: fields[19], state: fields[0], uid: ids("Uid"), gid: ids("Gid"), executable: readlinkSync(path.join(root, "exe")), argv };
}
function command(binary, args, env) {
  const r = spawnSync(binary, args, { env, timeout: 10_000, maxBuffer: CAP, encoding: null });
  if (r.error || r.signal || r.status !== 0 || !Buffer.isBuffer(r.stdout) || !Buffer.isBuffer(r.stderr) || r.stderr.length || r.stdout.length > CAP) fail();
  return r.stdout;
}
function binaryProof(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd, { bigint: true }); const entry = lstatSync(file, { bigint: true });
    if (!s.isFile() || entry.isSymbolicLink() || s.uid !== 0n || s.nlink !== 1n || (s.mode & 0o022n) !== 0n
      || s.dev !== entry.dev || s.ino !== entry.ino || realpathSync(file) !== file) fail();
    if (file === DOCKERD) {
      if (s.size !== BigInt(DOCKERD_BYTES)) fail();
      const hash = createHash("sha256"); const buffer = Buffer.allocUnsafe(1024 ** 2); let offset = 0;
      while (offset < DOCKERD_BYTES) { const n = readSync(fd, buffer, 0, Math.min(buffer.length, DOCKERD_BYTES - offset), offset);
        if (n < 1) fail(); hash.update(buffer.subarray(0, n)); offset += n; }
      if (readSync(fd, buffer, 0, 1, offset) !== 0 || hash.digest("hex") !== DOCKERD_SHA) fail();
    }
    const after = fstatSync(fd, { bigint: true }); const final = lstatSync(file, { bigint: true });
    const fields = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "uid", "gid", "mode", "nlink"];
    if (fields.some((key) => s[key] !== after[key] || s[key] !== final[key])) fail();
    return Object.fromEntries(fields.map((key) => [key, s[key]]));
  } finally { closeSync(fd); }
}
const exists = (name) => { try { lstatSync(name); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };

// Only an owned PID is signalled. This helper has no image operation, path deletion or arbitrary command entrypoint.
export function createColdLoadDaemonHelper() {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0) fail();
  const env = Object.freeze({ PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" });
  const binaries = new Map();
  for (const binary of [DOCKERD, DOCKER, CTR]) binaries.set(binary, binaryProof(binary));
  if (command(DOCKERD, ["--version"], env).toString().trim() !== "Docker version 28.0.4, build 6430e49") fail();
  const binaryGuard = () => { for (const [name, before] of binaries) {
    if (!isDeepStrictEqual(before, binaryProof(name))) fail();
  } };
  let owned; let activeSpec;
  const originalExists = () => {
    try { const stat = readFileSync(`/proc/${owned.pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u)[19] === owned.startTicks;
    } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return false; throw error; }
  };
  const terminate = async () => {
    if (!owned || !activeSpec) fail("daemon_cold_load_cleanup_uncertain");
    binaryGuard(); nativeSpec(activeSpec);
    if (originalExists()) {
      validateColdLoadDaemonProcessProof(processProof(owned.pid), owned); process.kill(owned.pid, "SIGTERM");
    }
    const deadline = Date.now() + 20_000;
    while (originalExists() && Date.now() < deadline) await setTimeout(50);
    if (originalExists()) {
      binaryGuard(); nativeSpec(activeSpec); validateColdLoadDaemonProcessProof(processProof(owned.pid), owned);
      process.kill(owned.pid, "SIGKILL"); const final = Date.now() + 5_000;
      while (originalExists() && Date.now() < final) await setTimeout(50);
    }
    if (originalExists() || exists(activeSpec.pidFile) || exists(activeSpec.socket)) fail("daemon_cold_load_cleanup_uncertain");
  };
  return Object.freeze({
    start: async (input) => {
      const spec = nativeSpec(input); binaryGuard(); if (owned || activeSpec) fail();
      directory(spec.dataRoot, 0, 0o700); directory(spec.endpointDirectory, 0, 0o700);
      if (exists(spec.pidFile) || exists(spec.socket)) fail();
      const namespaces = command(CTR, ["--address", CONTAINERD, "namespaces", "list", "--quiet"], env).toString().trim().split(/\r?\n/u);
      if (namespaces.includes(spec.containersNamespace) || namespaces.includes(spec.pluginsNamespace)) fail();
      try { validateLocalDaemonConfigurationResult(spawnSync(DOCKERD, ["--validate", ...spec.args], { env, timeout: 10_000, maxBuffer: CAP, encoding: null })); }
      catch { fail(); }
      const fd = openSync(spec.logFile, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW); let child;
      try {
        const log = fstatSync(fd); const entry = lstatSync(spec.logFile);
        if (!log.isFile() || log.uid !== 0 || log.gid !== 0 || log.nlink !== 1 || (log.mode & 0o7777) !== 0o600
          || log.dev !== entry.dev || log.ino !== entry.ino || log.size > CAP) fail();
        child = spawn(DOCKERD, spec.args, { cwd: spec.infrastructure, env, detached: true, stdio: ["ignore", fd, fd] });
      } finally { closeSync(fd); }
      child.on("error", () => {}); child.unref(); activeSpec = spec;
      try {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          if (child.exitCode !== null) fail(); let proof;
          try { proof = processProof(child.pid); } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
          if (proof?.executable === DOCKERD) {
            owned ??= { pid: child.pid, startTicks: proof.startTicks, configFile: spec.configFile, nonce: spec.nonce };
            validateColdLoadDaemonProcessProof(proof, owned); binaryGuard(); nativeSpec(spec);
            if (exists(spec.socket) && exists(spec.pidFile)) {
              const sock = lstatSync(spec.socket); const pid = lstatSync(spec.pidFile);
              if (!sock.isSocket() || sock.isSymbolicLink() || sock.uid !== 0 || sock.nlink !== 1 || !pid.isFile() || pid.isSymbolicLink()
                || pid.uid !== 0 || pid.nlink !== 1 || pid.size < 2 || pid.size > 32) fail();
              chmodSync(spec.pidFile, 0o600); chownSync(spec.pidFile, 0, 0);
              chmodSync(spec.socket, 0o660); chownSync(spec.socket, 0, 1000);
              if (!privateFile(spec.pidFile).equals(Buffer.from(String(owned.pid)))) fail();
              const observed = spawnSync(DOCKER, ["--host", `unix://${spec.socket}`, "info", "--format", "{{json .}}"],
                { env: { ...env, DOCKER_CONFIG: spec.rootClient }, timeout: 10_000, maxBuffer: CAP, encoding: null });
              if (!observed.error && !observed.signal && observed.status === 0 && observed.stderr?.length === 0) {
                const info = JSON.parse(observed.stdout);
                if (typeof info.ID !== "string" || info.DockerRootDir !== spec.dataRoot || info.ServerVersion !== "28.0.4") fail();
                directory(spec.dataRoot, 0, 0o710);
                return Object.freeze({ pid: owned.pid, startTicks: owned.startTicks, daemonId: info.ID, namespacesFresh: true });
              }
            }
          }
          await setTimeout(50);
        }
        fail();
      } catch {
        if (!owned) fail("daemon_cold_load_cleanup_uncertain");
        try { await terminate(); } catch { fail("daemon_cold_load_cleanup_uncertain"); }
        fail();
      }
    },
    verify: async (input, child) => {
      const spec = nativeSpec(input); binaryGuard();
      if (!owned || child?.pid !== owned.pid || child?.startTicks !== owned.startTicks || spec.configFile !== owned.configFile) fail();
      directory(spec.dataRoot, 0, 0o710); validateColdLoadDaemonProcessProof(processProof(owned.pid), owned);
      return Object.freeze({ state: "RUNNING", pid: owned.pid, startTicks: owned.startTicks, uid: 0, gid: 0,
        executable: DOCKERD, version: "28.0.4", argvSha256: spec.argvSha256, configSha256: spec.configSha256 });
    },
    stop: async (input, child) => {
      const spec = nativeSpec(input); binaryGuard();
      if (!owned || child?.pid !== owned.pid || child?.startTicks !== owned.startTicks || spec.configFile !== owned.configFile) fail("daemon_cold_load_cleanup_uncertain");
      await terminate(); return Object.freeze({ state: "STOPPED", pid: owned.pid, startTicks: owned.startTicks, processGone: true });
    },
  });
}
