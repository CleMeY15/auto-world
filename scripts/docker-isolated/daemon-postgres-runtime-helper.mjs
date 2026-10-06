import { spawn } from "node:child_process";
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
function fail(code = "daemon_postgres_runtime_helper_invalid") { throw new Error(code); }

export function validatePostgresRuntimeDaemonHelperSpec(spec) {
  const names = ["root", "infrastructure", "endpointDirectory", "rootClient", "uid", "gid", "executable", "version", "nonce", "args",
    "configFile", "configSha256", "argvSha256", "pidFile", "logFile", "socket", "dataRoot", "execRoot",
    "containerdAddress", "containersNamespace", "pluginsNamespace"];
  if (!keys(spec, names) || names.filter((name) => !["uid", "gid", "args"].includes(name)).some((name) => typeof spec[name] !== "string")
    || !Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string")
    || !/^\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}$/u.test(spec.root)
    || !/^[0-9a-f]{24}$/u.test(spec.nonce) || spec.uid !== 0 || spec.gid !== 0 || spec.executable !== DOCKERD
    || spec.version !== "28.0.4" || spec.containerdAddress !== CONTAINERD) fail();
  const infra = path.posix.join(spec.root, "infra"); const endpoint = path.posix.join(spec.root, "endpoint");
  if (spec.infrastructure !== infra || spec.endpointDirectory !== endpoint || spec.rootClient !== path.posix.join(infra, "client")
    || spec.dataRoot !== path.posix.join(infra, "data") || spec.execRoot !== path.posix.join(infra, "exec")
    || spec.configFile !== path.posix.join(infra, "daemon.json") || spec.pidFile !== path.posix.join(infra, "daemon.pid")
    || spec.logFile !== path.posix.join(infra, "daemon.log") || spec.socket !== path.posix.join(endpoint, "docker.sock")
    || spec.containersNamespace !== `awpgsql-${spec.nonce}` || spec.pluginsNamespace !== `plugins.awpgsql-${spec.nonce}`
    || !isDeepStrictEqual(spec.args, ["--config-file", spec.configFile, "--containerd-plugins-namespace", spec.pluginsNamespace])
    || !/^[0-9a-f]{64}$/u.test(spec.configSha256) || spec.argvSha256 !== sha(bytes([DOCKERD, ...spec.args]))) fail();
  return spec;
}
export function postgresRuntimeDaemonConfiguration(input) {
  const spec = validatePostgresRuntimeDaemonHelperSpec(input);
  return Object.freeze({ "data-root": spec.dataRoot, "exec-root": spec.execRoot, pidfile: spec.pidFile,
    hosts: [`unix://${spec.socket}`], bridge: "none", iptables: false, ip6tables: false,
    "ip-forward": false, "ip-masq": false, "userland-proxy": false, containerd: CONTAINERD,
    "containerd-namespace": spec.containersNamespace, "storage-driver": "overlay2", "default-cgroupns-mode": "private",
    "default-ipc-mode": "private", "default-runtime": "runc" });
}
export function validatePostgresRuntimeDaemonProcessProof(value, expected) {
  if (!keys(value, ["pid", "startTicks", "state", "uid", "gid", "executable", "argv"])
    || !keys(expected, ["pid", "startTicks", "configFile", "nonce"]) || !Number.isSafeInteger(value.pid) || value.pid < 2
    || !Number.isSafeInteger(expected.pid) || expected.pid < 2
    || [value.startTicks, value.state, expected.startTicks, expected.configFile, expected.nonce].some((item) => typeof item !== "string")
    || value.pid !== expected.pid || !/^[1-9][0-9]{0,19}$/u.test(value.startTicks) || value.startTicks !== expected.startTicks
    || !/^\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}\/infra\/daemon\.json$/u.test(expected.configFile)
    || !/^[0-9a-f]{24}$/u.test(expected.nonce) || !/^[RSDTtWIP]$/u.test(value.state)
    || !isDeepStrictEqual(value.uid, [0, 0, 0, 0]) || !isDeepStrictEqual(value.gid, [0, 0, 0, 0])
    || value.executable !== DOCKERD || !isDeepStrictEqual(value.argv, [DOCKERD, "--config-file", expected.configFile,
      "--containerd-plugins-namespace", `plugins.awpgsql-${expected.nonce}`])) fail();
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
  const spec = validatePostgresRuntimeDaemonHelperSpec(input);
  directory(spec.root, 1000, 0o710); directory(spec.infrastructure, 0, 0o700); directory(spec.rootClient, 0, 0o700);
  const endpoint = lstatSync(spec.endpointDirectory);
  if (endpoint.gid === 0) directory(spec.endpointDirectory, 0, 0o700);
  else directory(spec.endpointDirectory, 1000, 0o710);
  directory(spec.execRoot, 0, 0o700);
  if (!isDeepStrictEqual(JSON.parse(privateFile(spec.configFile, spec.configSha256)), postgresRuntimeDaemonConfiguration(spec))
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
function cancelled(signal, deadline) {
  if (signal?.aborted || Date.now() >= deadline) fail();
}
async function command(binary, args, env, signal, deadline, allowStderr = false) {
  cancelled(signal, deadline);
  return new Promise((resolve, reject) => {
    let child; let settled = false; let forcedFailure = false; let size = 0; const stdout = []; const stderr = [];
    const finish = (error, value) => {
      if (settled) return; settled = true; globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => { forcedFailure = true; try { child?.kill("SIGKILL"); } catch { /* Close decides. */ } };
    const timer = globalThis.setTimeout(abort, Math.max(1, Math.min(10_000, deadline - Date.now())));
    try { child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "pipe"], detached: false }); }
    catch (error) { finish(error); return; }
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", chunk => { size += chunk.length; if (size > CAP) abort(); else stdout.push(Buffer.from(chunk)); });
    child.stderr.on("data", chunk => { size += chunk.length; if (size > CAP) abort(); else stderr.push(Buffer.from(chunk)); });
    child.once("error", finish);
    child.once("close", (code, childSignal) => {
      const out = Buffer.concat(stdout); const err = Buffer.concat(stderr);
      if (forcedFailure || signal?.aborted || Date.now() >= deadline || code !== 0 || childSignal !== null
        || !allowStderr && err.length || size > CAP) finish(new Error());
      else finish(undefined, { stdout: out, stderr: err });
    });
  }).catch(() => fail());
}
async function binaryProof(file, signal, deadline) {
  cancelled(signal, deadline);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd, { bigint: true }); const entry = lstatSync(file, { bigint: true });
    if (!s.isFile() || entry.isSymbolicLink() || s.uid !== 0n || s.nlink !== 1n || (s.mode & 0o022n) !== 0n
      || s.dev !== entry.dev || s.ino !== entry.ino || realpathSync(file) !== file) fail();
    if (file === DOCKERD) {
      if (s.size !== BigInt(DOCKERD_BYTES)) fail();
      const hash = createHash("sha256"); const buffer = Buffer.allocUnsafe(1024 ** 2); let offset = 0;
      while (offset < DOCKERD_BYTES) { const n = readSync(fd, buffer, 0, Math.min(buffer.length, DOCKERD_BYTES - offset), offset);
        if (n < 1) fail(); hash.update(buffer.subarray(0, n)); offset += n;
        await setTimeout(0); cancelled(signal, deadline); }
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
export function createPostgresRuntimeDaemonHelper() {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0) fail();
  const env = Object.freeze({ PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" });
  let binaries;
  const initialize = async (signal, deadline) => {
    if (binaries) return;
    const observed = new Map();
    for (const binary of [DOCKERD, DOCKER, CTR]) {
      observed.set(binary, await binaryProof(binary, signal, deadline)); cancelled(signal, deadline);
    }
    if ((await command(DOCKERD, ["--version"], env, signal, deadline)).stdout.toString().trim()
      !== "Docker version 28.0.4, build 6430e49") fail();
    binaries = observed;
  };
  const binaryGuard = async (signal, deadline) => {
    await initialize(signal, deadline);
    for (const [name, before] of binaries) {
      if (!isDeepStrictEqual(before, await binaryProof(name, signal, deadline))) fail();
      cancelled(signal, deadline);
    }
  };
  let owned; let activeSpec;
  const originalExists = () => {
    try { const stat = readFileSync(`/proc/${owned.pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/u)[19] === owned.startTicks;
    } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) return false; throw error; }
  };
  const terminate = async () => {
    if (!owned || !activeSpec) fail("daemon_postgres_runtime_cleanup_uncertain");
    const guardDeadline = Date.now() + 25_000;
    await binaryGuard(undefined, guardDeadline); nativeSpec(activeSpec);
    if (originalExists()) {
      validatePostgresRuntimeDaemonProcessProof(processProof(owned.pid), owned); process.kill(owned.pid, "SIGTERM");
    }
    const deadline = Date.now() + 20_000;
    while (originalExists() && Date.now() < deadline) await setTimeout(50);
    if (originalExists()) {
      await binaryGuard(undefined, guardDeadline); nativeSpec(activeSpec); validatePostgresRuntimeDaemonProcessProof(processProof(owned.pid), owned);
      process.kill(owned.pid, "SIGKILL"); const final = Date.now() + 5_000;
      while (originalExists() && Date.now() < final) await setTimeout(50);
    }
    if (originalExists() || exists(activeSpec.pidFile) || exists(activeSpec.socket)) fail("daemon_postgres_runtime_cleanup_uncertain");
  };
  return Object.freeze({
    start: async (input, signal) => {
      if (signal !== undefined && (signal === null || typeof signal !== "object" || typeof signal.aborted !== "boolean")) fail();
      if (signal?.aborted) fail();
      const deadline = Date.now() + 60_000;
      const spec = nativeSpec(input); await binaryGuard(signal, deadline); cancelled(signal, deadline); if (owned || activeSpec) fail();
      directory(spec.dataRoot, 0, 0o700); directory(spec.endpointDirectory, 0, 0o700);
      if (exists(spec.pidFile) || exists(spec.socket)) fail();
      const namespaces = (await command(CTR, ["--address", CONTAINERD, "namespaces", "list", "--quiet"], env, signal, deadline))
        .stdout.toString().trim().split(/\r?\n/u);
      cancelled(signal, deadline);
      if (namespaces.includes(spec.containersNamespace) || namespaces.includes(spec.pluginsNamespace)) fail();
      try {
        const checked = await command(DOCKERD, ["--validate", ...spec.args], env, signal, deadline, true);
        validateLocalDaemonConfigurationResult({ error: undefined, signal: null, status: 0, ...checked });
      }
      catch { fail(); }
      cancelled(signal, deadline);
      const fd = openSync(spec.logFile, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW); let child;
      try {
        const log = fstatSync(fd); const entry = lstatSync(spec.logFile);
        if (!log.isFile() || log.uid !== 0 || log.gid !== 0 || log.nlink !== 1 || (log.mode & 0o7777) !== 0o600
          || log.dev !== entry.dev || log.ino !== entry.ino || log.size > CAP) fail();
        child = spawn(DOCKERD, spec.args, { cwd: spec.infrastructure, env, detached: true, stdio: ["ignore", fd, fd] });
      } finally { closeSync(fd); }
      child.on("error", () => {}); child.unref(); activeSpec = spec;
      const terminateSpawned = async () => {
        if (child.exitCode === null) child.kill("SIGTERM");
        let deadline = Date.now() + 5_000;
        while (child.exitCode === null && Date.now() < deadline) await setTimeout(50);
        if (child.exitCode === null) {
          child.kill("SIGKILL"); deadline = Date.now() + 5_000;
          while (child.exitCode === null && Date.now() < deadline) await setTimeout(50);
        }
        if (child.exitCode === null || exists(spec.pidFile) || exists(spec.socket)) {
          fail("daemon_postgres_runtime_cleanup_uncertain");
        }
      };
      try {
        while (Date.now() < deadline) {
          cancelled(signal, deadline);
          if (child.exitCode !== null) fail(); let proof;
          try { proof = processProof(child.pid); } catch (error) { if (!["ENOENT", "ESRCH"].includes(error.code)) throw error; }
          if (proof?.executable === DOCKERD) {
            owned ??= { pid: child.pid, startTicks: proof.startTicks, configFile: spec.configFile, nonce: spec.nonce };
            validatePostgresRuntimeDaemonProcessProof(proof, owned); await binaryGuard(signal, deadline); cancelled(signal, deadline); nativeSpec(spec);
            if (signal?.aborted) fail();
            if (exists(spec.socket) && exists(spec.pidFile)) {
              const sock = lstatSync(spec.socket); const pid = lstatSync(spec.pidFile);
              if (!sock.isSocket() || sock.isSymbolicLink() || sock.uid !== 0 || sock.nlink !== 1 || !pid.isFile() || pid.isSymbolicLink()
                || pid.uid !== 0 || pid.nlink !== 1 || pid.size < 2 || pid.size > 32) fail();
              chmodSync(spec.pidFile, 0o600); chownSync(spec.pidFile, 0, 0);
              chmodSync(spec.socket, 0o660); chownSync(spec.socket, 0, 1000);
              if (!privateFile(spec.pidFile).equals(Buffer.from(String(owned.pid)))) fail();
              let observed;
              try { observed = await command(DOCKER, ["--host", `unix://${spec.socket}`, "info", "--format", "{{json .}}"],
                { ...env, DOCKER_CONFIG: spec.rootClient }, signal, deadline); } catch { observed = undefined; }
              cancelled(signal, deadline);
              if (observed) {
                const info = JSON.parse(observed.stdout);
                if (typeof info.ID !== "string" || info.DockerRootDir !== spec.dataRoot || info.ServerVersion !== "28.0.4") fail();
                directory(spec.dataRoot, 0, 0o710);
                return Object.freeze({ pid: owned.pid, startTicks: owned.startTicks, daemonId: info.ID, namespacesFresh: true });
              }
            }
          }
          await setTimeout(50);
          cancelled(signal, deadline);
        }
        fail();
      } catch {
        if (!owned) {
          try { await terminateSpawned(); } catch { fail("daemon_postgres_runtime_cleanup_uncertain"); }
          fail();
        }
        try { await terminate(); } catch { fail("daemon_postgres_runtime_cleanup_uncertain"); }
        fail();
      }
    },
    verify: async (input, child, signal) => {
      const deadline = Date.now() + 10_000;
      const spec = nativeSpec(input); await binaryGuard(signal, deadline); cancelled(signal, deadline);
      if (!owned || child?.pid !== owned.pid || child?.startTicks !== owned.startTicks || spec.configFile !== owned.configFile) fail();
      directory(spec.dataRoot, 0, 0o710); validatePostgresRuntimeDaemonProcessProof(processProof(owned.pid), owned);
      return Object.freeze({ state: "RUNNING", pid: owned.pid, startTicks: owned.startTicks, uid: 0, gid: 0,
        executable: DOCKERD, version: "28.0.4", argvSha256: spec.argvSha256, configSha256: spec.configSha256 });
    },
    stop: async (input, child) => {
      const spec = nativeSpec(input); await binaryGuard(undefined, Date.now() + 25_000);
      if (!owned || child?.pid !== owned.pid || child?.startTicks !== owned.startTicks || spec.configFile !== owned.configFile) fail("daemon_postgres_runtime_cleanup_uncertain");
      await terminate(); return Object.freeze({ state: "STOPPED", pid: owned.pid, startTicks: owned.startTicks, processGone: true });
    },
  });
}
