import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual } from "node:util";

const DOCKER = "/usr/bin/docker";
const DOCKERD = "/usr/bin/dockerd";
const MAIN = "unix:///var/run/docker.sock";
const VERSION = "28.0.4";
const CAP = 1024 ** 2;
const PHASES = ["START", "VERIFY", "COMMAND", "STOP"];
const CODES = new Set(["daemon_local_context_invalid", "daemon_local_files_changed", "daemon_local_helper_invalid",
  "daemon_local_identity_invalid", "daemon_local_inventory_not_empty", "daemon_local_principal_changed",
  "daemon_local_command_forbidden", "daemon_local_transport_failed", "daemon_local_deadline_exceeded", "daemon_local_cleanup_uncertain"]);
const INFO = ["info", "--format", "{{json .}}"];
const IMAGES = ["image", "ls", "--all", "--quiet", "--no-trunc"];
const CONTAINERS = ["container", "ls", "--all", "--quiet", "--no-trunc"];
const VOLUMES = ["volume", "ls", "--quiet"];
const CLI_VERSION = ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"];
const PROBE_COMMANDS = [INFO, IMAGES, CONTAINERS, VOLUMES, CLI_VERSION];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, expected) => plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
function fail(code, phase = "VERIFY") { throw Object.assign(new Error(code), { phase }); }
function fixedError(error, phase, fallback = "daemon_local_context_invalid") {
  let code = fallback;
  try { if (CODES.has(error?.message)) code = error.message; } catch { /* Untrusted diagnostic getters are not evaluated again. */ }
  return Object.assign(new Error(code), { phase });
}
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  return value;
}
export function localDaemonFailureDiagnostic(error) {
  try {
    const code = error?.message; const phase = error?.phase;
    if (CODES.has(code)) return Object.freeze({ code, phase: PHASES.includes(phase) ? phase : "VERIFY" });
  } catch { /* Arbitrary thrown values cannot disclose subprocess output. */ }
  return Object.freeze({ code: "daemon_local_context_invalid", phase: "VERIFY" });
}
function directory(file, uid, gid, mode = 0o700) {
  const stat = lstatSync(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.gid !== gid
    || (stat.mode & 0o7777) !== mode || realpathSync(file) !== file) fail("daemon_local_files_changed");
  return { dev: stat.dev, ino: stat.ino, uid, gid, mode: stat.mode };
}
function regular(file, uid, gid, expected) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd); const current = lstatSync(file);
    if (!before.isFile() || current.isSymbolicLink() || before.nlink !== 1 || before.uid !== uid || before.gid !== gid
      || (before.mode & 0o7777) !== 0o600 || before.size > CAP || current.dev !== before.dev || current.ino !== before.ino) {
      fail("daemon_local_files_changed");
    }
    const bytes = readFileSync(fd); const after = fstatSync(fd);
    if (before.size !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || expected !== undefined && !bytes.equals(expected)) fail("daemon_local_files_changed");
    return { dev: before.dev, ino: before.ino, uid, gid, mode: before.mode, bytes };
  } finally { closeSync(fd); }
}
function mutableLog(file, uid, gid) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd); const current = lstatSync(file); const after = fstatSync(fd);
    for (const stat of [before, current, after]) {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== uid || stat.gid !== gid
        || (stat.mode & 0o7777) !== 0o600 || stat.size > CAP || stat.dev !== before.dev || stat.ino !== before.ino) {
        fail("daemon_local_files_changed");
      }
    }
    return { dev: before.dev, ino: before.ino, uid, gid, mode: before.mode };
  } finally { closeSync(fd); }
}
function writePrivate(file, bytes) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function unchanged(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.gid === right.gid && left.mode === right.mode;
}
function noRoutingEnvironment(env, config, phase = "VERIFY") {
  if (!plain(env) || Object.hasOwn(env, "DOCKER_HOST") || Object.hasOwn(env, "DOCKER_CONTEXT")
    || Object.hasOwn(env, "DOCKER_CONFIG") && env.DOCKER_CONFIG !== config) fail("daemon_local_context_invalid", phase);
}
function transportDefault(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: null,
    timeout: options.timeoutMs, maxBuffer: options.maxBuffer, windowsHide: true });
}
function response(value) {
  if (!plain(value) || value.error || value.signal || value.status !== 0 || !Buffer.isBuffer(value.stdout)
    || !Buffer.isBuffer(value.stderr) || value.stdout.length + value.stderr.length > CAP || value.stderr.length !== 0) {
    fail("daemon_local_transport_failed");
  }
  return value;
}
function decoded(bytes) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("daemon_local_identity_invalid"); }
}
function lines(bytes, pattern) {
  const values = bytes.toString("utf8").trim().split(/\r?\n/u).filter(Boolean).sort();
  if (values.length > 64 || new Set(values).size !== values.length || values.some((item) => !pattern.test(item))) {
    fail("daemon_local_identity_invalid");
  }
  return values;
}
function validatePrincipal(value) {
  if (!keys(value, ["id", "root", "containerdAddress", "containersNamespace", "pluginsNamespace", "imageIds"])
    || !/^[A-Za-z0-9:_-]{1,128}$/u.test(value.id ?? "") || !path.isAbsolute(value.root ?? "")
    || path.normalize(value.root) !== value.root || !path.isAbsolute(value.containerdAddress ?? "")
    || path.normalize(value.containerdAddress) !== value.containerdAddress
    || !/^[A-Za-z0-9._-]{1,128}$/u.test(value.containersNamespace ?? "")
    || !/^[A-Za-z0-9._-]{1,128}$/u.test(value.pluginsNamespace ?? "") || !Array.isArray(value.imageIds)
    || value.imageIds.length !== 2 || new Set(value.imageIds).size !== 2
    || value.imageIds.some((item) => !/^sha256:[0-9a-f]{64}$/u.test(item))) fail("daemon_local_context_invalid", "START");
  return freeze({ ...value, imageIds: [...value.imageIds].sort() });
}

// The injected privileged helper is mandatory: this module cannot launch or kill a root process on its own.
async function startLease(input, dependencies = {}) {
  let phase = "START";
  if (!keys(input, ["purpose", "parent", "nonce", "principal"]) || input.purpose !== "EMPTY_DAEMON_PROBE"
    || typeof input.parent !== "string" || !path.isAbsolute(input.parent)
    || path.normalize(input.parent) !== input.parent || !/^[0-9a-f]{24}$/u.test(input.nonce ?? "")
    || !plain(dependencies) || Object.keys(dependencies).some((key) => !["helper", "transport", "env", "now"].includes(key))
    || !keys(dependencies.helper, ["start", "verify", "stop"])
    || Object.values(dependencies.helper).some((item) => typeof item !== "function")
    || dependencies.transport !== undefined && typeof dependencies.transport !== "function"
    || dependencies.now !== undefined && typeof dependencies.now !== "function") fail("daemon_local_context_invalid", phase);
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (process.platform !== "linux" || !Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0
    || dependencies.transport === undefined && (uid !== 0 || gid !== 0)) fail("daemon_local_context_invalid", phase);
  const principal = validatePrincipal(input.principal);
  const now = dependencies.now ?? Date.now; const startedAt = now();
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) fail("daemon_local_context_invalid", phase);
  let deadline = startedAt + 300_000;
  const remaining = () => {
    const current = now();
    if (!Number.isSafeInteger(current) || current < startedAt) fail("daemon_local_context_invalid", phase);
    if (current >= deadline) fail("daemon_local_deadline_exceeded", phase);
    return deadline - current;
  };
  const ambient = dependencies.env ?? { ...process.env }; noRoutingEnvironment(ambient, undefined, phase);
  const root = path.join(input.parent, `daemon-${input.nonce}`); const client = path.join(root, "client");
  const contextName = `aw-local-${input.nonce}`; const contextDirectory = path.join(client, "contexts", "meta", digest(contextName));
  const socket = path.join(root, "docker.sock"); const endpoint = `unix://${socket}`;
  if (Buffer.byteLength(socket) > 100) fail("daemon_local_context_invalid", phase);
  const containersNamespace = `awdiag-${input.nonce}`; const pluginsNamespace = `plugins.awdiag-${input.nonce}`;
  if ([principal.containersNamespace, principal.pluginsNamespace].some((item) => [containersNamespace, pluginsNamespace].includes(item))) {
    fail("daemon_local_context_invalid", phase);
  }
  const dirs = new Map([[input.parent, directory(input.parent, uid, gid)]]);
  for (const file of [root, path.join(root, "data"), path.join(root, "exec"), client, path.join(client, "contexts"),
    path.join(client, "contexts", "meta"), contextDirectory]) {
    mkdirSync(file, { mode: 0o700 }); dirs.set(file, directory(file, uid, gid));
  }
  const daemonConfigFile = path.join(root, "daemon.json"); const pidFile = path.join(root, "daemon.pid");
  const logFile = path.join(root, "daemon.log");
  const daemonConfig = { "data-root": path.join(root, "data"), "exec-root": path.join(root, "exec"), pidfile: pidFile,
    hosts: [endpoint], bridge: "none", iptables: false, ip6tables: false, "ip-forward": false, "ip-masq": false,
    "userland-proxy": false, containerd: principal.containerdAddress, "containerd-namespace": containersNamespace,
    "containerd-plugins-namespace": pluginsNamespace, "storage-driver": "overlay2", "default-cgroupns-mode": "private",
    "default-ipc-mode": "private", "default-runtime": "runc" };
  const files = new Map();
  for (const [file, bytes] of [[daemonConfigFile, jsonBytes(daemonConfig)],
    [path.join(client, "config.json"), jsonBytes({ currentContext: contextName })],
    [path.join(contextDirectory, "meta.json"), jsonBytes({ Name: contextName, Metadata: {},
      Endpoints: { docker: { Host: endpoint, SkipTLSVerify: false } } })]]) {
    writePrivate(file, bytes); files.set(file, regular(file, uid, gid, bytes));
  }
  writePrivate(logFile, Buffer.alloc(0)); const logIdentity = mutableLog(logFile, uid, gid);
  const argv = [DOCKERD, "--config-file", daemonConfigFile];
  const spec = freeze({ root, uid, gid, executable: DOCKERD, version: VERSION, args: argv.slice(1),
    configFile: daemonConfigFile, configSha256: digest(jsonBytes(daemonConfig)), argvSha256: digest(jsonBytes(argv)),
    pidFile, logFile, socket, dataRoot: daemonConfig["data-root"], execRoot: daemonConfig["exec-root"],
    containerdAddress: principal.containerdAddress, containersNamespace, pluginsNamespace });
  const env = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: root, DOCKER_CONFIG: client });
  const options = Object.freeze({ cwd: root, env, maxBuffer: CAP });
  const helper = dependencies.helper; const transport = dependencies.transport ?? transportDefault;
  let child; let socketIdentity; let pidIdentity; let initialPrincipal; let state = "STARTING";
  let startAttempted = false; let busy = false; let knownEmptyVerified = false;
  const assertFiles = () => {
    try {
      noRoutingEnvironment(ambient);
      for (const [file, identity] of dirs) {
        if (!unchanged(identity, directory(file, uid, gid, identity.mode & 0o7777))) fail("daemon_local_files_changed");
      }
      for (const [file, identity] of files) if (!unchanged(identity, regular(file, uid, gid, identity.bytes))) fail("daemon_local_files_changed");
      if (!unchanged(logIdentity, mutableLog(logFile, uid, gid))) fail("daemon_local_files_changed");
      if (!isDeepStrictEqual(readdirSync(client).sort(), ["config.json", "contexts"])
        || !isDeepStrictEqual(readdirSync(path.join(client, "contexts")), ["meta"])
        || !isDeepStrictEqual(readdirSync(path.join(client, "contexts", "meta")), [digest(contextName)])
        || !isDeepStrictEqual(readdirSync(contextDirectory), ["meta.json"])) fail("daemon_local_files_changed");
      if (child && state !== "STOPPED") {
        const current = lstatSync(socket);
        if (!current.isSocket() || current.uid !== uid || current.gid !== gid || (current.mode & 0o7777) !== 0o600
          || !unchanged(socketIdentity, { dev: current.dev, ino: current.ino, uid, gid, mode: current.mode })) fail("daemon_local_files_changed");
        if (!unchanged(pidIdentity, regular(pidFile, uid, gid, Buffer.from(`${child.pid}\n`)))) fail("daemon_local_files_changed");
      }
    } catch (error) { throw fixedError(error, phase, "daemon_local_files_changed"); }
  };
  const call = async (host, args) => {
    assertFiles();
    const value = response(await transport(DOCKER, ["--host", host, ...args], { ...options, timeoutMs: Math.min(10_000, remaining()) }));
    remaining();
    assertFiles(); return value;
  };
  const information = async (host, expected) => {
    const value = decoded((await call(host, INFO)).stdout);
    if (value?.ID !== expected.id || value.ServerVersion !== VERSION || value.DockerRootDir !== expected.root
      || value.Driver !== "overlay2" || value.OSType !== "linux" || value.Architecture !== "x86_64"
      || value.Containerd?.Address !== expected.containerdAddress
      || value.Containerd?.Namespaces?.Containers !== expected.containersNamespace
      || value.Containerd?.Namespaces?.Plugins !== expected.pluginsNamespace) fail("daemon_local_identity_invalid", phase);
    return value;
  };
  const inventory = async (host, guard) => {
    const read = async (args, pattern) => { await guard(); return lines((await call(host, args)).stdout, pattern); };
    return { images: await read(IMAGES, /^sha256:[0-9a-f]{64}$/u),
      containers: await read(CONTAINERS, /^[0-9a-f]{64}$/u), volumes: await read(VOLUMES, /^[A-Za-z0-9_.-]{1,255}$/u) };
  };
  const principalSnapshot = async () => {
    const guard = () => information(MAIN, principal); await guard();
    const observed = await inventory(MAIN, guard);
    if (!isDeepStrictEqual(observed, { images: principal.imageIds, containers: [], volumes: [] })) fail("daemon_local_principal_changed", phase);
    const imageProofs = [];
    for (const id of principal.imageIds) {
      await guard(); const bytes = (await call(MAIN, ["image", "inspect", "--format", "{{json .}}", id])).stdout;
      if (decoded(bytes)?.Id !== id) fail("daemon_local_principal_changed", phase);
      imageProofs.push(digest(bytes));
    }
    return digest(jsonBytes({ ...observed, imageProofs }));
  };
  const processProof = async () => {
    remaining(); assertFiles();
    const proof = await helper.verify(spec, child);
    const expected = { state: "RUNNING", pid: child.pid, startTicks: child.startTicks, uid: 0,
      executable: DOCKERD, version: VERSION, argvSha256: spec.argvSha256, configSha256: spec.configSha256 };
    if (!isDeepStrictEqual(proof, expected)) fail("daemon_local_helper_invalid", phase);
    remaining(); assertFiles();
  };
  const isolatedIdentity = () => ({ id: child.daemonId, root: spec.dataRoot, containerdAddress: spec.containerdAddress,
    containersNamespace, pluginsNamespace });
  const guard = async () => { await processProof(); await information(endpoint, isolatedIdentity()); await processProof(); };
  const verify = async () => {
    if (state !== "ACTIVE" && state !== "STARTING") fail("daemon_local_context_invalid", phase);
    await guard();
    const isolated = await inventory(endpoint, guard);
    if (isolated.images.length || isolated.containers.length || isolated.volumes.length) fail("daemon_local_inventory_not_empty", phase);
    if ((await principalSnapshot()) !== initialPrincipal) fail("daemon_local_principal_changed", phase);
    return Object.freeze({ state: "VERIFIED_EMPTY", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
      daemonId: child.daemonId, pid: child.pid, images: 0, containers: 0, volumes: 0,
      principalImageCount: 2, principalSnapshotSha256: initialPrincipal });
  };
  const stopOwnedProcess = async () => {
    const budget = Math.min(25_000, remaining()); let timer; let stopped;
    try {
      stopped = await Promise.race([helper.stop(spec, child), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("daemon_local_cleanup_uncertain")), budget);
      })]);
    } finally { clearTimeout(timer); }
    if (!isDeepStrictEqual(stopped, { state: "STOPPED", pid: child.pid, startTicks: child.startTicks, processGone: true })) {
      fail("daemon_local_cleanup_uncertain", phase);
    }
    for (const file of [socket, pidFile]) {
      try { lstatSync(file); fail("daemon_local_cleanup_uncertain", phase); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    state = "STOPPED";
  };
  try {
    initialPrincipal = await principalSnapshot(); assertFiles();
    startAttempted = true;
    const started = await helper.start(spec);
    if (!keys(started, ["pid", "startTicks", "daemonId", "namespacesFresh"]) || !Number.isSafeInteger(started.pid) || started.pid < 2
      || !/^[1-9][0-9]{0,19}$/u.test(started.startTicks ?? "") || !/^[A-Za-z0-9:_-]{1,128}$/u.test(started.daemonId ?? "")
      || started.daemonId === principal.id || started.namespacesFresh !== true) fail("daemon_local_helper_invalid", phase);
    child = freeze(started);
    const initialData = dirs.get(spec.dataRoot); const finalData = directory(spec.dataRoot, uid, gid, 0o710);
    if (!unchanged({ ...initialData, mode: finalData.mode }, finalData)) fail("daemon_local_files_changed", phase);
    dirs.set(spec.dataRoot, finalData);
    const socketStat = lstatSync(socket);
    socketIdentity = { dev: socketStat.dev, ino: socketStat.ino, uid, gid, mode: socketStat.mode };
    pidIdentity = regular(pidFile, uid, gid, Buffer.from(`${started.pid}\n`));
    await verify();
    knownEmptyVerified = true;
    await guard();
    if ((await call(endpoint, CLI_VERSION)).stdout.toString("utf8").trim() !== `${VERSION}|${VERSION}`) fail("daemon_local_identity_invalid", phase);
    state = "ACTIVE";
  } catch (error) {
    // The helper reauthenticates the validated original PID before signaling; never guess after an ambiguous start.
    if (startAttempted) {
      if (!child || !knownEmptyVerified) fail("daemon_local_cleanup_uncertain", phase);
      deadline = now() + 25_000;
      try { await stopOwnedProcess(); }
      catch { state = "UNCERTAIN"; fail("daemon_local_cleanup_uncertain", phase); }
    }
    throw fixedError(error, phase);
  }
  const exclusive = async (operationPhase, action) => {
    if (busy) fail("daemon_local_context_invalid", operationPhase);
    busy = true; phase = operationPhase;
    try { return await action(); } finally { busy = false; }
  };
  return Object.freeze({ identity: freeze({ socket, endpoint, dockerConfig: client, contextName, pid: child.pid, daemonId: child.daemonId,
    dataRoot: spec.dataRoot, execRoot: spec.execRoot, containersNamespace, pluginsNamespace }),
    verify: () => exclusive("VERIFY", async () => { try { return await verify(); } catch (error) { throw fixedError(error, phase); } }),
    runner: (command, args, supplied = {}) => exclusive("COMMAND", async () => {
      try {
        if (state !== "ACTIVE" || command !== DOCKER || !Array.isArray(args)
          || !PROBE_COMMANDS.some((permitted) => isDeepStrictEqual(args, permitted)) || !plain(supplied)
          || Object.keys(supplied).some((key) => !["cwd", "env", "timeoutMs", "maxBuffer"].includes(key))) fail("daemon_local_command_forbidden", phase);
        if (supplied.env !== undefined) noRoutingEnvironment(supplied.env, client);
        await guard(); return await call(endpoint, args);
      } catch (error) { throw fixedError(error, phase, "daemon_local_transport_failed"); }
    }),
    stop: () => exclusive("STOP", async () => {
      try {
        if (state !== "ACTIVE") fail("daemon_local_context_invalid", phase);
        // Cleanup gets its own bounded grace after the read-only lease deadline.
        deadline = now() + 25_000;
        await verify(); await guard();
        await stopOwnedProcess(); assertFiles();
        if ((await principalSnapshot()) !== initialPrincipal) fail("daemon_local_cleanup_uncertain", phase);
        return Object.freeze({ state: "STOPPED", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
          isolatedFinalInventory: "EMPTY", principalImageCount: 2, principalSnapshotSha256: initialPrincipal,
          privateState: "RETAINED", pid: child.pid });
      } catch { state = "UNCERTAIN"; fail("daemon_local_cleanup_uncertain", phase); }
    }) });
}

export async function startLocalDaemonLease(input, dependencies = {}) {
  try { return await startLease(input, dependencies); }
  catch (error) {
    let phase = "START";
    try { if (PHASES.includes(error?.phase)) phase = error.phase; } catch { /* Keep the closed startup diagnostic. */ }
    throw fixedError(error, phase);
  }
}
