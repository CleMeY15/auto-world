import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { coldLoadDaemonConfiguration, createColdLoadDaemonHelper } from "./daemon-cold-load-helper.mjs";

const DOCKER = "/usr/bin/docker"; const MAIN = "unix:///var/run/docker.sock"; const CAP = 1024 ** 2;
const IMAGE = /^sha256:[0-9a-f]{64}$/u; const ID = /^[A-Za-z0-9:_-]{1,128}$/u;
const INFO = ["info", "--format", "{{json .}}"];
const LISTS = [["image", "ls", "--all", "--quiet", "--no-trunc"], ["container", "ls", "--all", "--quiet", "--no-trunc"], ["volume", "ls", "--quiet"]];
const PHASES = ["START", "VERIFY", "INVENTORY", "STOP"];
const CODES = new Set(["daemon_cold_load_context_invalid", "daemon_cold_load_files_changed", "daemon_cold_load_helper_invalid",
  "daemon_cold_load_identity_invalid", "daemon_cold_load_inventory_invalid", "daemon_cold_load_principal_changed",
  "daemon_cold_load_transport_failed", "daemon_cold_load_deadline_exceeded", "daemon_cold_load_cleanup_uncertain"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, expected) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...expected].sort());
const bytes = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
const sha = (v) => createHash("sha256").update(v).digest("hex");
function fail(code, phase = "VERIFY") { throw Object.assign(new Error(code), { phase }); }
function freeze(v) { return Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([key, item]) => [key, freeze(item)]))) : v; }
function closed(error, phase, fallback = "daemon_cold_load_context_invalid") {
  let code = fallback; try { const message = error?.message; if (CODES.has(message)) code = message; } catch { /* Closed diagnostics. */ }
  return Object.assign(new Error(code), { phase });
}
export function coldLoadDaemonFailureDiagnostic(error) {
  try { const code = error?.message; const phase = error?.phase;
    if (CODES.has(code)) return Object.freeze({ code, phase: PHASES.includes(phase) ? phase : "VERIFY" });
  } catch { /* Never retain raw subprocess material. */ }
  return Object.freeze({ code: "daemon_cold_load_context_invalid", phase: "VERIFY" });
}
export function coldLoadDaemonRemaining(deadline, current, phase = "VERIFY") {
  if (!Number.isFinite(deadline) || !Number.isFinite(current) || current >= deadline) fail("daemon_cold_load_deadline_exceeded", phase);
  return deadline - current;
}
export function validateColdLoadDaemonStartProof(v, principalId) {
  if (!keys(v, ["pid", "startTicks", "daemonId", "namespacesFresh"]) || !Number.isSafeInteger(v.pid) || v.pid < 2
    || !/^[1-9][0-9]{0,19}$/u.test(v.startTicks) || !ID.test(v.daemonId) || v.daemonId === principalId || v.namespacesFresh !== true) {
    fail("daemon_cold_load_helper_invalid", "START");
  }
  return freeze(v);
}
export function validateColdLoadDaemonLeaseInput(v) {
  if (!keys(v, ["purpose", "parent", "nonce", "principal", "candidate"]) || v.purpose !== "COLD_LOAD_ONLY"
    || !/^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u.test(v.parent) || !/^[0-9a-f]{24}$/u.test(v.nonce)
    || !keys(v.candidate, ["imageId", "tag"]) || !IMAGE.test(v.candidate.imageId)
    || !/^aw-postgres-gosu:[0-9a-f]{24}$/u.test(v.candidate.tag)
    || !keys(v.principal, ["id", "root", "containerdAddress", "containersNamespace", "pluginsNamespace", "imageIds"])
    || !ID.test(v.principal.id) || v.principal.root !== "/var/lib/docker" || v.principal.containerdAddress !== "/run/containerd/containerd.sock"
    || v.principal.containersNamespace !== "moby" || v.principal.pluginsNamespace !== "plugins.moby"
    || !Array.isArray(v.principal.imageIds) || v.principal.imageIds.length !== 2 || new Set(v.principal.imageIds).size !== 2
    || v.principal.imageIds.some((id) => !IMAGE.test(id) || id === v.candidate.imageId)) fail("daemon_cold_load_context_invalid", "START");
  return freeze({ ...v, principal: { ...v.principal, imageIds: [...v.principal.imageIds].sort() } });
}
export function validateColdLoadDaemonStopProof(v, child) {
  if (!isDeepStrictEqual(v, { state: "STOPPED", pid: child.pid, startTicks: child.startTicks, processGone: true })) {
    fail("daemon_cold_load_cleanup_uncertain", "STOP");
  }
  return freeze(v);
}
export function validateColdLoadDaemonInfo(v, expected) {
  if (!plain(v) || v.ID !== expected.id || v.ServerVersion !== "28.0.4" || v.DockerRootDir !== expected.root
    || v.Driver !== "overlay2" || v.OSType !== "linux" || v.Architecture !== "x86_64"
    || v.Containerd?.Address !== expected.containerdAddress || v.Containerd?.Namespaces?.Containers !== expected.containersNamespace
    || v.Containerd?.Namespaces?.Plugins !== expected.pluginsNamespace) fail("daemon_cold_load_identity_invalid");
  return Object.freeze({ daemonId: v.ID, version: v.ServerVersion });
}
export function validateColdLoadDaemonInventory(v, mode, candidate, inspected) {
  if (!keys(v, ["images", "containers", "volumes"]) || !["EMPTY", "CANDIDATE"].includes(mode)
    || !Array.isArray(v.images) || !Array.isArray(v.containers) || !Array.isArray(v.volumes)
    || v.containers.length || v.volumes.length || !isDeepStrictEqual(v.images, mode === "EMPTY" ? [] : [candidate.imageId])) {
    fail("daemon_cold_load_inventory_invalid");
  }
  if (mode === "CANDIDATE" && (!plain(inspected) || inspected.Id !== candidate.imageId || !isDeepStrictEqual(inspected.RepoTags, [candidate.tag]))) {
    fail("daemon_cold_load_inventory_invalid");
  }
  return Object.freeze({ images: v.images.length, containers: 0, volumes: 0 });
}
function directory(file, uid, gid, mode) {
  const s = lstatSync(file, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== BigInt(uid) || s.gid !== BigInt(gid)
    || (s.mode & 0o7777n) !== BigInt(mode) || realpathSync(file) !== file) fail("daemon_cold_load_files_changed");
  return { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode };
}
function regular(file, uid, gid, expected, mutable = false) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd, { bigint: true }); const entry = lstatSync(file, { bigint: true });
    const valid = (v) => v.isFile() && !v.isSymbolicLink() && v.uid === BigInt(uid) && v.gid === BigInt(gid)
      && v.nlink === 1n && (v.mode & 0o7777n) === 0o600n && v.size <= BigInt(CAP) && v.dev === s.dev && v.ino === s.ino;
    if (!valid(s) || !valid(entry)) fail("daemon_cold_load_files_changed");
    let value; if (!mutable) value = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true }); const final = lstatSync(file, { bigint: true });
    if (!valid(after) || !valid(final) || !mutable && (BigInt(value.length) !== s.size || after.size !== s.size
      || after.mtimeNs !== s.mtimeNs || after.ctimeNs !== s.ctimeNs || final.mtimeNs !== s.mtimeNs || final.ctimeNs !== s.ctimeNs
      || expected !== undefined && !value.equals(expected))) fail("daemon_cold_load_files_changed");
    return mutable ? { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode }
      : { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode, size: s.size, mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs, bytes: value };
  } finally { closeSync(fd); }
}
function write(file, value, uid = 0, gid = 0) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
  if (uid !== 0 || gid !== 0) chownSync(file, uid, gid);
}
export function validateColdLoadDaemonRoutingEnvironment(env) {
  if (!plain(env) || ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"].some((key) => Object.hasOwn(env, key))) fail("daemon_cold_load_context_invalid");
}
function response(v) {
  if (!plain(v) || v.error || v.signal || v.status !== 0 || !Buffer.isBuffer(v.stdout) || !Buffer.isBuffer(v.stderr)
    || v.stdout.length > CAP || v.stderr.length !== 0) fail("daemon_cold_load_transport_failed"); return v.stdout;
}
function json(value) { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)); } catch { fail("daemon_cold_load_identity_invalid"); } }
function lines(value, pattern) {
  const v = value.toString("utf8").trim().split(/\r?\n/u).filter(Boolean).sort();
  if (v.length > 64 || new Set(v).size !== v.length || v.some((item) => !pattern.test(item))) fail("daemon_cold_load_identity_invalid"); return v;
}
function transportDefault(command, args, options) { return spawnSync(command, args, { ...options, encoding: null, timeout: options.timeoutMs }); }
const socketProof = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n) });

async function startLease(input, dependencies) {
  const value = validateColdLoadDaemonLeaseInput(input); let phase = "START";
  if (!plain(dependencies) || Object.keys(dependencies).some((key) => !["helper", "transport", "env", "now"].includes(key))
    || dependencies.helper !== undefined && (!keys(dependencies.helper, ["start", "verify", "stop"])
      || Object.values(dependencies.helper).some((v) => typeof v !== "function"))
    || dependencies.transport !== undefined && typeof dependencies.transport !== "function"
    || dependencies.now !== undefined && typeof dependencies.now !== "function"
    || process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0) fail("daemon_cold_load_context_invalid", phase);
  const ambient = dependencies.env ?? { ...process.env }; validateColdLoadDaemonRoutingEnvironment(ambient);
  const now = dependencies.now ?? Date.now; let deadline = now() + 300_000;
  const remaining = () => coldLoadDaemonRemaining(deadline, now(), phase);
  const parent = value.parent; const dirs = new Map([[parent, directory(parent, 0, 1000, 0o710)]]);
  if (readdirSync(parent).length !== 0) fail("daemon_cold_load_files_changed", phase);
  const infra = path.join(parent, "infra"); const endpointDir = path.join(parent, "endpoint"); const client = path.join(parent, "client");
  const contextName = `aw-cold-${value.nonce}`; const context = path.join(client, "contexts", "meta", sha(contextName));
  for (const file of [infra, endpointDir, path.join(infra, "data"), path.join(infra, "exec"), path.join(infra, "client"),
    client, path.join(client, "contexts"), path.join(client, "contexts", "meta"), context]) {
    mkdirSync(file, { mode: 0o700 }); const nonroot = file === client || file.startsWith(`${client}/`);
    if (nonroot) chownSync(file, 1000, 1000); dirs.set(file, directory(file, nonroot ? 1000 : 0, nonroot ? 1000 : 0, 0o700));
  }
  const socket = path.join(endpointDir, "docker.sock"); const endpoint = `unix://${socket}`;
  if (Buffer.byteLength(socket) > 100) fail("daemon_cold_load_context_invalid", phase);
  let spec = { root: parent, infrastructure: infra, endpointDirectory: endpointDir, rootClient: path.join(infra, "client"), uid: 0, gid: 0,
    executable: "/usr/bin/dockerd", version: "28.0.4", nonce: value.nonce, configFile: path.join(infra, "daemon.json"),
    pidFile: path.join(infra, "daemon.pid"), logFile: path.join(infra, "daemon.log"), socket,
    dataRoot: path.join(infra, "data"), execRoot: path.join(infra, "exec"), containerdAddress: value.principal.containerdAddress,
    containersNamespace: `awcold-${value.nonce}`, pluginsNamespace: `plugins.awcold-${value.nonce}` };
  spec.args = ["--config-file", spec.configFile, "--containerd-plugins-namespace", spec.pluginsNamespace];
  spec.argvSha256 = sha(bytes([spec.executable, ...spec.args])); spec.configSha256 = "0".repeat(64);
  const config = bytes(coldLoadDaemonConfiguration(spec)); spec.configSha256 = sha(config); spec = freeze(spec);
  const files = new Map();
  for (const [file, content, uid, gid] of [[spec.configFile, config, 0, 0], [path.join(spec.rootClient, "config.json"), bytes({}), 0, 0],
    [path.join(client, "config.json"), bytes({ currentContext: contextName }), 1000, 1000], [path.join(context, "meta.json"),
      bytes({ Name: contextName, Metadata: {}, Endpoints: { docker: { Host: endpoint, SkipTLSVerify: false } } }), 1000, 1000]]) {
    write(file, content, uid, gid); files.set(file, regular(file, uid, gid, content));
  }
  write(spec.logFile, Buffer.alloc(0)); const log = regular(spec.logFile, 0, 0, undefined, true);
  const helper = dependencies.helper ?? createColdLoadDaemonHelper(); const transport = dependencies.transport ?? transportDefault;
  const env = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: infra, DOCKER_CONFIG: spec.rootClient });
  let child; let socketIdentity; let pidIdentity; let initialPrincipal; let state = "STARTING"; let busy = false; let startAttempted = false;
  function assertFiles() {
    validateColdLoadDaemonRoutingEnvironment(ambient);
    for (const [file, expected] of dirs) if (!isDeepStrictEqual(directory(file, Number(expected.uid), Number(expected.gid), Number(expected.mode & 0o7777n)), expected)) fail("daemon_cold_load_files_changed", phase);
    for (const [file, expected] of files) if (!isDeepStrictEqual(regular(file, Number(expected.uid), Number(expected.gid), expected.bytes), expected)) fail("daemon_cold_load_files_changed", phase);
    if (!isDeepStrictEqual(regular(spec.logFile, 0, 0, undefined, true), log)
      || !isDeepStrictEqual(readdirSync(client).sort(), ["config.json", "contexts"])
      || !isDeepStrictEqual(readdirSync(path.join(client, "contexts")), ["meta"])
      || !isDeepStrictEqual(readdirSync(path.join(client, "contexts", "meta")), [sha(contextName)])
      || !isDeepStrictEqual(readdirSync(context), ["meta.json"]) || !isDeepStrictEqual(readdirSync(spec.rootClient), ["config.json"])) fail("daemon_cold_load_files_changed", phase);
    if (child && state !== "STOPPED") {
      const current = lstatSync(socket, { bigint: true });
      if (!current.isSocket() || current.isSymbolicLink() || current.nlink !== 1n || !isDeepStrictEqual(socketProof(current), socketIdentity)
        || !isDeepStrictEqual(regular(spec.pidFile, 0, 0, Buffer.from(String(child.pid))), pidIdentity)) fail("daemon_cold_load_files_changed", phase);
    }
  }
  const call = async (host, args) => {
    assertFiles(); const output = response(await transport(DOCKER, ["--host", host, ...args],
      { cwd: infra, env, maxBuffer: CAP, timeoutMs: Math.min(10_000, remaining()) })); remaining(); assertFiles(); return output;
  };
  const info = async (host, expected) => validateColdLoadDaemonInfo(json(await call(host, INFO)), expected);
  const inventory = async (host, guard) => {
    const result = [];
    for (const [index, args] of LISTS.entries()) { await guard(); result.push(lines(await call(host, args), [IMAGE, /^[0-9a-f]{64}$/u, /^[A-Za-z0-9_.-]{1,255}$/u][index])); }
    return { images: result[0], containers: result[1], volumes: result[2] };
  };
  const principalSnapshot = async () => {
    const guard = () => info(MAIN, value.principal); await guard(); const v = await inventory(MAIN, guard);
    if (!isDeepStrictEqual(v, { images: value.principal.imageIds, containers: [], volumes: [] })) fail("daemon_cold_load_principal_changed", phase);
    const hashes = [];
    for (const id of value.principal.imageIds) { await guard(); const raw = await call(MAIN, ["image", "inspect", "--format", "{{json .}}", id]);
      if (json(raw)?.Id !== id) fail("daemon_cold_load_principal_changed", phase); hashes.push(sha(raw)); }
    return sha(bytes({ ...v, hashes }));
  };
  const processGuard = async () => {
    assertFiles(); remaining(); const proof = await helper.verify(spec, child); remaining();
    if (!isDeepStrictEqual(proof, { state: "RUNNING", pid: child.pid, startTicks: child.startTicks, uid: 0, gid: 0,
      executable: spec.executable, version: spec.version, argvSha256: spec.argvSha256, configSha256: spec.configSha256 })) fail("daemon_cold_load_helper_invalid", phase);
    assertFiles();
  };
  const isolated = () => ({ id: child.daemonId, root: spec.dataRoot, containerdAddress: spec.containerdAddress,
    containersNamespace: spec.containersNamespace, pluginsNamespace: spec.pluginsNamespace });
  const guard = async () => { await processGuard(); await info(endpoint, isolated()); await processGuard(); };
  const acknowledgement = () => ({ purpose: "COLD_LOAD_ONLY", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    daemonId: child.daemonId, endpoint, pid: child.pid, principalImageCount: 2, principalSnapshotSha256: initialPrincipal });
  const verifyIdentity = async () => {
    if (!["STARTING", "ACTIVE"].includes(state)) fail("daemon_cold_load_context_invalid", phase);
    await guard(); if (await principalSnapshot() !== initialPrincipal) fail("daemon_cold_load_principal_changed", phase);
    return Object.freeze({ state: "VERIFIED", ...acknowledgement() });
  };
  const verifyInventory = async (mode) => {
    if (!["EMPTY", "CANDIDATE"].includes(mode)) fail("daemon_cold_load_inventory_invalid", phase);
    await verifyIdentity(); const v = await inventory(endpoint, guard); let inspected;
    if (mode === "CANDIDATE") { await guard(); inspected = json(await call(endpoint, ["image", "inspect", "--format", "{{json .}}", value.candidate.imageId])); }
    const result = validateColdLoadDaemonInventory(v, mode, value.candidate, inspected); await guard();
    return Object.freeze({ state: mode === "EMPTY" ? "VERIFIED_EMPTY" : "VERIFIED_CANDIDATE", ...acknowledgement(), ...result });
  };
  const stopProcess = async () => {
    let timer; let result;
    try { result = await Promise.race([helper.stop(spec, child), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("daemon_cold_load_cleanup_uncertain")), Math.min(25_000, remaining()));
    })]); } finally { clearTimeout(timer); }
    validateColdLoadDaemonStopProof(result, child);
    for (const name of [socket, spec.pidFile]) { try { lstatSync(name); fail("daemon_cold_load_cleanup_uncertain", phase); }
      catch (error) { if (error.code !== "ENOENT") throw error; } }
    state = "STOPPED";
  };
  try {
    initialPrincipal = await principalSnapshot(); remaining(); startAttempted = true;
    const started = await helper.start(spec);
    child = validateColdLoadDaemonStartProof(started, value.principal.id);
    remaining();
    const beforeData = dirs.get(spec.dataRoot); const data = directory(spec.dataRoot, 0, 0, 0o710);
    if (beforeData.dev !== data.dev || beforeData.ino !== data.ino) fail("daemon_cold_load_files_changed", phase); dirs.set(spec.dataRoot, data);
    const sock = lstatSync(socket, { bigint: true }); socketIdentity = socketProof(sock);
    if (!sock.isSocket() || sock.isSymbolicLink() || sock.nlink !== 1n || socketIdentity.uid !== 0 || socketIdentity.gid !== 1000 || socketIdentity.mode !== 0o660) fail("daemon_cold_load_files_changed", phase);
    pidIdentity = regular(spec.pidFile, 0, 0, Buffer.from(String(child.pid)));
    await verifyInventory("EMPTY"); await guard();
    if ((await call(endpoint, ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"])).toString().trim() !== "28.0.4|28.0.4") fail("daemon_cold_load_identity_invalid", phase);
    const old = dirs.get(endpointDir); chownSync(endpointDir, 0, 1000); chmodSync(endpointDir, 0o710);
    const exposed = directory(endpointDir, 0, 1000, 0o710); if (old.dev !== exposed.dev || old.ino !== exposed.ino) fail("daemon_cold_load_files_changed", phase);
    dirs.set(endpointDir, exposed); await verifyInventory("EMPTY"); state = "ACTIVE";
  } catch (error) {
    if (startAttempted && !child) fail("daemon_cold_load_cleanup_uncertain", phase);
    if (child) { deadline = now() + 25_000; try { await stopProcess(); } catch { fail("daemon_cold_load_cleanup_uncertain", phase); } }
    throw closed(error, phase, "daemon_cold_load_helper_invalid");
  }
  const exclusive = async (nextPhase, action) => { if (busy) fail("daemon_cold_load_context_invalid", nextPhase); busy = true; phase = nextPhase;
    try { return await action(); } catch (error) { throw closed(error, phase); } finally { busy = false; } };
  const identity = freeze({ purpose: "COLD_LOAD_ONLY", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", root: parent,
    socket, endpoint, dockerConfig: client, contextName, pid: child.pid, startTicks: child.startTicks, daemonId: child.daemonId,
    version: spec.version, dataRoot: spec.dataRoot, execRoot: spec.execRoot, containerdAddress: spec.containerdAddress,
    containersNamespace: spec.containersNamespace, pluginsNamespace: spec.pluginsNamespace, configSha256: spec.configSha256, argvSha256: spec.argvSha256,
    rootActor: { uid: 0, gid: 0 }, clientActor: { uid: 1000, gid: 1000 }, socketProof: socketIdentity,
    socketDirectoryProof: socketProof(lstatSync(endpointDir, { bigint: true })) });
  return Object.freeze({ identity,
    verifyIdentity: () => exclusive("VERIFY", verifyIdentity),
    verifyInventory: (mode) => exclusive("INVENTORY", () => verifyInventory(mode)),
    stop: (options) => exclusive("STOP", async () => {
      if (!keys(options, ["requireEmpty"]) || typeof options.requireEmpty !== "boolean" || state !== "ACTIVE") fail("daemon_cold_load_cleanup_uncertain", phase);
      deadline = now() + 25_000;
      try {
        if (options.requireEmpty) await verifyInventory("EMPTY"); else await processGuard();
        await stopProcess(); assertFiles(); if (await principalSnapshot() !== initialPrincipal) fail("daemon_cold_load_cleanup_uncertain", phase);
        return Object.freeze({ state: "STOPPED", ...acknowledgement(), isolatedFinalInventory: options.requireEmpty ? "EMPTY" : "UNVERIFIED",
          processGone: true, socketGone: true, pidFileGone: true, privateState: "RETAINED" });
      } catch { state = "UNCERTAIN"; fail("daemon_cold_load_cleanup_uncertain", phase); }
    }) });
}
export async function startColdLoadDaemonLease(input, dependencies = {}) {
  try { return await startLease(input, dependencies); }
  catch (error) { let phase = "START"; try { const reported = error?.phase; if (PHASES.includes(reported)) phase = reported; } catch { /* Closed. */ }
    throw closed(error, phase); }
}
