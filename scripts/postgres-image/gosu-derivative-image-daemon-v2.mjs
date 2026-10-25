import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, realpathSync, readdirSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { coldLoadDaemonConfiguration, createColdLoadDaemonHelper } from "../docker-isolated/daemon-cold-load-helper.mjs";

const DOCKER = "/usr/bin/docker"; const MAIN = "unix:///var/run/docker.sock"; const CAP = 1024 ** 2;
const BASE_CONFIG = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
const NODE = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
const TOOL_PINS = Object.freeze([
  { path: NODE, bytes: 124836408, sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327" },
  { path: DOCKER, bytes: 43134496, sha256: "6435ff9214bf8e0931078fb0980809728cac0a54a526d4f28a26d3e48132b58d" },
  { path: "/usr/bin/dockerd", bytes: 83666424, sha256: "b8644399e73e2c9b32ea3983daf3a9856a483a79196bea10c01977d2b021fe71" },
  { path: "/usr/bin/ctr", bytes: 25875232, sha256: "acca62b7ac3e97c65839fa0d9d4a72b6cddd318d1a7abcc109e7c01b287ee3a7" },
  { path: "/usr/bin/setpriv", bytes: 39304, sha256: "62ec0120791f3afcfb689fed52384ec2b0accc6e118a6b9a1d6fcfa7450aaf37" },
  { path: "/usr/libexec/docker/cli-plugins/docker-buildx", bytes: 73054565, sha256: "3e6dcf88055ca9e59013376bf989c221b76c557460f1d47175aeb14a0e98c93c" },
]);
const IMAGE = /^sha256:[0-9a-f]{64}$/u; const ID = /^[A-Za-z0-9:_-]{1,128}$/u;
const INFO = ["info", "--format", "{{json .}}"];
const LISTS = [["image", "ls", "--all", "--quiet", "--no-trunc"], ["container", "ls", "--all", "--quiet", "--no-trunc"], ["volume", "ls", "--quiet"]];
const PHASES = ["START", "VERIFY", "INVENTORY", "STOP"];
const CODES = new Set(["gosu_derivative_image_daemon_input_invalid", "gosu_derivative_image_daemon_files_changed", "gosu_derivative_image_daemon_helper_invalid",
  "gosu_derivative_image_daemon_identity_invalid", "gosu_derivative_image_daemon_inventory_invalid", "gosu_derivative_image_daemon_principal_changed",
  "gosu_derivative_image_daemon_transport_failed", "gosu_derivative_image_daemon_deadline_exceeded", "gosu_derivative_image_daemon_cleanup_uncertain"]);
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, expected) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...expected].sort());
const bytes = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
const sha = (v) => createHash("sha256").update(v).digest("hex");
function fail(code, phase = "VERIFY") { throw Object.assign(new Error(code), { phase }); }
function freeze(v) { return Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([key, item]) => [key, freeze(item)]))) : v; }
function closed(error, phase, fallback = "gosu_derivative_image_daemon_input_invalid") {
  let code = fallback; try { const message = error?.message; if (CODES.has(message)) code = message; } catch { /* Closed diagnostics. */ }
  return Object.assign(new Error(code), { phase });
}
export function gosuDerivativeImageDaemonFailureDiagnostic(error) {
  try { const code = error?.message; const phase = error?.phase;
    if (CODES.has(code)) return Object.freeze({ code, phase: PHASES.includes(phase) ? phase : "VERIFY" });
  } catch { /* Never retain raw subprocess material. */ }
  return Object.freeze({ code: "gosu_derivative_image_daemon_input_invalid", phase: "VERIFY" });
}
function coldLoadDaemonRemaining(deadline, current, phase = "VERIFY") {
  if (!Number.isFinite(deadline) || !Number.isFinite(current) || current >= deadline) fail("gosu_derivative_image_daemon_deadline_exceeded", phase);
  return deadline - current;
}
function validateColdLoadDaemonStartProof(v, principalId) {
  if (!keys(v, ["pid", "startTicks", "daemonId", "namespacesFresh"]) || !Number.isSafeInteger(v.pid) || v.pid < 2
    || !/^[1-9][0-9]{0,19}$/u.test(v.startTicks) || !ID.test(v.daemonId) || v.daemonId === principalId || v.namespacesFresh !== true) {
    fail("gosu_derivative_image_daemon_helper_invalid", "START");
  }
  return freeze(v);
}
export function validateGosuDerivativeImageDaemonLeaseInput(v) {
  if (!keys(v, ["purpose", "parent", "nonce", "principal"]) || v.purpose !== "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION"
    || !/^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u.test(v.parent) || !/^[0-9a-f]{24}$/u.test(v.nonce)
    || !keys(v.principal, ["id", "root", "containerdAddress", "containersNamespace", "pluginsNamespace", "imageIds"])
    || !ID.test(v.principal.id) || v.principal.root !== "/var/lib/docker" || v.principal.containerdAddress !== "/run/containerd/containerd.sock"
    || v.principal.containersNamespace !== "moby" || v.principal.pluginsNamespace !== "plugins.moby"
    || !Array.isArray(v.principal.imageIds) || v.principal.imageIds.length !== 2 || new Set(v.principal.imageIds).size !== 2
    || v.principal.imageIds.some((id) => !IMAGE.test(id))) fail("gosu_derivative_image_daemon_input_invalid", "START");
  return freeze({ ...v, principal: { ...v.principal, imageIds: [...v.principal.imageIds].sort() } });
}
function validateColdLoadDaemonStopProof(v, child) {
  if (!isDeepStrictEqual(v, { state: "STOPPED", pid: child.pid, startTicks: child.startTicks, processGone: true })) {
    fail("gosu_derivative_image_daemon_cleanup_uncertain", "STOP");
  }
  return freeze(v);
}
function validateColdLoadDaemonInfo(v, expected) {
  if (!plain(v) || v.ID !== expected.id || v.ServerVersion !== "28.0.4" || v.DockerRootDir !== expected.root
    || v.Driver !== "overlay2" || v.OSType !== "linux" || v.Architecture !== "x86_64"
    || v.Containerd?.Address !== expected.containerdAddress || v.Containerd?.Namespaces?.Containers !== expected.containersNamespace
    || v.Containerd?.Namespaces?.Plugins !== expected.pluginsNamespace) fail("gosu_derivative_image_daemon_identity_invalid");
  return Object.freeze({ daemonId: v.ID, version: v.ServerVersion });
}
function imageSubject(value, nonce) {
  if (!keys(value, ["role", "reference", "imageId", "configId", "platform"])
    || !["BASE", "CANDIDATE"].includes(value.role) || !IMAGE.test(value.imageId) || !IMAGE.test(value.configId)
    || !keys(value.platform, ["os", "architecture"]) || value.platform.os !== "linux" || value.platform.architecture !== "amd64"
    || value.role === "BASE" && value.reference !== "postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3"
    || value.role === "BASE" && (value.imageId !== BASE_CONFIG || value.configId !== BASE_CONFIG)
    || value.imageId !== value.configId
    || value.role === "CANDIDATE" && (value.reference !== `aw-postgres-gosu:${nonce}` || value.imageId === BASE_CONFIG)) fail("gosu_derivative_image_daemon_inventory_invalid", "INVENTORY");
  return freeze(value);
}
function validateColdLoadDaemonInventory(v, mode, subjects, inspected, nonce) {
  if (!keys(v, ["images", "containers", "volumes"]) || !["EMPTY", "BASE_ONLY", "BASE_AND_CANDIDATE"].includes(mode)
    || !Array.isArray(v.images) || !Array.isArray(v.containers) || !Array.isArray(v.volumes)
    || v.containers.length || v.volumes.length || !Array.isArray(subjects) || !Array.isArray(inspected)) {
    fail("gosu_derivative_image_daemon_inventory_invalid", "INVENTORY");
  }
  const expectedRoles = mode === "EMPTY" ? [] : mode === "BASE_ONLY" ? ["BASE"] : ["BASE", "CANDIDATE"];
  const accepted = subjects.map((item) => imageSubject(item, nonce));
  if (!isDeepStrictEqual(accepted.map((item) => item.role), expectedRoles)
    || !isDeepStrictEqual(v.images, accepted.map((item) => item.imageId).sort()) || inspected.length !== accepted.length
    || inspected.some((item, index) => !plain(item) || item.Id !== accepted[index].imageId || accepted[index].configId !== accepted[index].imageId
      || item.Os !== "linux" || item.Architecture !== "amd64"
      || ![...(Array.isArray(item.RepoTags) ? item.RepoTags : []), ...(Array.isArray(item.RepoDigests) ? item.RepoDigests : [])]
        .includes(accepted[index].reference))) fail("gosu_derivative_image_daemon_inventory_invalid", "INVENTORY");
  return freeze({ images: v.images.length, containers: 0, volumes: 0, subjects: accepted });
}
const metadata = (s) => ({ dev: s.dev, ino: s.ino, mode: s.mode, size: s.size, nlink: s.nlink,
  uid: s.uid, gid: s.gid, mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs });
function toolProof(pin) {
  const fd = openSync(pin.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true }); const entry = lstatSync(pin.path, { bigint: true });
    if (!before.isFile() || entry.isSymbolicLink() || before.uid !== 0n || before.gid !== 0n || before.nlink !== 1n
      || (before.mode & 0o022n) !== 0n || before.size !== BigInt(pin.bytes) || realpathSync(pin.path) !== pin.path
      || !isDeepStrictEqual(metadata(before), metadata(entry))) fail("gosu_derivative_image_daemon_files_changed");
    const digest = createHash("sha256"); const chunk = Buffer.allocUnsafe(1024 ** 2); let offset = 0;
    while (offset < pin.bytes) {
      const count = readSync(fd, chunk, 0, Math.min(chunk.length, pin.bytes - offset), offset);
      if (count <= 0) fail("gosu_derivative_image_daemon_files_changed");
      offset += count; digest.update(chunk.subarray(0, count));
    }
    if (readSync(fd, chunk, 0, 1, offset) !== 0 || digest.digest("hex") !== pin.sha256
      || !isDeepStrictEqual(metadata(before), metadata(fstatSync(fd, { bigint: true })))
      || !isDeepStrictEqual(metadata(before), metadata(lstatSync(pin.path, { bigint: true })))) fail("gosu_derivative_image_daemon_files_changed");
    return metadata(before);
  } finally { closeSync(fd); }
}
function directory(file, uid, gid, mode) {
  const s = lstatSync(file, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== BigInt(uid) || s.gid !== BigInt(gid)
    || (s.mode & 0o7777n) !== BigInt(mode) || realpathSync(file) !== file) fail("gosu_derivative_image_daemon_files_changed");
  return { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode };
}
function regular(file, uid, gid, expected, mutable = false) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd, { bigint: true }); const entry = lstatSync(file, { bigint: true });
    const valid = (v) => v.isFile() && !v.isSymbolicLink() && v.uid === BigInt(uid) && v.gid === BigInt(gid)
      && v.nlink === 1n && (v.mode & 0o7777n) === 0o600n && v.size <= BigInt(CAP) && v.dev === s.dev && v.ino === s.ino;
    if (!valid(s) || !valid(entry) || !mutable && !isDeepStrictEqual(metadata(s), metadata(entry))) fail("gosu_derivative_image_daemon_files_changed");
    let value; if (!mutable) value = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true }); const final = lstatSync(file, { bigint: true });
    if (!valid(after) || !valid(final) || !mutable && (BigInt(value.length) !== s.size
      || !isDeepStrictEqual(metadata(s), metadata(after)) || !isDeepStrictEqual(metadata(s), metadata(final))
      || expected !== undefined && !value.equals(expected))) fail("gosu_derivative_image_daemon_files_changed");
    return mutable ? { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode }
      : { dev: s.dev, ino: s.ino, uid: s.uid, gid: s.gid, mode: s.mode, size: s.size, mtimeNs: s.mtimeNs, ctimeNs: s.ctimeNs, bytes: value };
  } finally { closeSync(fd); }
}
function write(file, value, uid = 0, gid = 0) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
  if (uid !== 0 || gid !== 0) chownSync(file, uid, gid);
}
function validateColdLoadDaemonRoutingEnvironment(env) {
  if (!plain(env) || ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"].some((key) => Object.hasOwn(env, key))) fail("gosu_derivative_image_daemon_input_invalid");
}
function response(v) {
  if (!plain(v) || v.error || v.signal || v.status !== 0 || !Buffer.isBuffer(v.stdout) || !Buffer.isBuffer(v.stderr)
    || v.stdout.length > CAP || v.stderr.length !== 0) fail("gosu_derivative_image_daemon_transport_failed"); return v.stdout;
}
function json(value) { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)); } catch { fail("gosu_derivative_image_daemon_identity_invalid"); } }
function lines(value, pattern) {
  const v = value.toString("utf8").trim().split(/\r?\n/u).filter(Boolean).sort();
  if (v.length > 64 || new Set(v).size !== v.length || v.some((item) => !pattern.test(item))) fail("gosu_derivative_image_daemon_identity_invalid"); return v;
}
function transportDefault(command, args, options) { return spawnSync(command, args, { ...options, encoding: null, timeout: options.timeoutMs }); }
const socketProof = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n) });

async function startLease(input, dependencies) {
  const value = validateGosuDerivativeImageDaemonLeaseInput(input); let phase = "START";
  const directoryFds = new Map();
  try {
  if (!plain(dependencies) || Object.keys(dependencies).some((key) => !["helper", "transport", "env", "now"].includes(key))
    || dependencies.helper !== undefined && (!keys(dependencies.helper, ["start", "verify", "stop"])
      || Object.values(dependencies.helper).some((v) => typeof v !== "function"))
    || dependencies.transport !== undefined && typeof dependencies.transport !== "function"
    || dependencies.now !== undefined && typeof dependencies.now !== "function"
    || process.platform !== "linux" || process.version !== "v22.23.2" || process.execPath !== NODE
    || process.getuid?.() !== 0 || process.geteuid?.() !== 0 || process.getgid?.() !== 0 || process.getegid?.() !== 0) fail("gosu_derivative_image_daemon_input_invalid", phase);
  const ambient = dependencies.env ?? { ...process.env }; validateColdLoadDaemonRoutingEnvironment(ambient);
  const now = dependencies.now ?? Date.now; const startedAtMs = now();
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0 || startedAtMs > Number.MAX_SAFE_INTEGER - 600_000) fail("gosu_derivative_image_daemon_input_invalid", phase);
  const deadline = startedAtMs + 600_000;
  const remaining = () => coldLoadDaemonRemaining(deadline - 25_000, now(), phase);
  const terminationRemaining = () => coldLoadDaemonRemaining(deadline, now(), "STOP");
  const tools = new Map(TOOL_PINS.map((pin) => [pin.path, toolProof(pin)]));
  const assertTools = () => { for (const pin of TOOL_PINS) {
    if (!isDeepStrictEqual(metadata(lstatSync(pin.path, { bigint: true })), tools.get(pin.path))) fail("gosu_derivative_image_daemon_files_changed", phase);
  } };
  const space = statfsSync(value.parent, { bigint: true });
  if (space.bavail * space.bsize < 8n * 1024n ** 3n) fail("gosu_derivative_image_daemon_input_invalid", phase);
  remaining();
  const parent = value.parent; const dirs = new Map([[parent, directory(parent, 0, 1000, 0o710)]]);
  const holdDirectory = (file) => {
    const fd = openSync(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    directoryFds.set(file, fd);
    const stat = fstatSync(fd, { bigint: true }); const expected = dirs.get(file);
    if (!stat.isDirectory() || Object.keys(expected).some((key) => stat[key] !== expected[key])) fail("gosu_derivative_image_daemon_files_changed", phase);
  };
  const closeDirectories = () => {
    let failed = false;
    for (const fd of directoryFds.values()) { try { closeSync(fd); } catch { failed = true; } }
    directoryFds.clear();
    if (failed) fail("gosu_derivative_image_daemon_cleanup_uncertain", phase);
  };
  holdDirectory(parent);
  if (readdirSync(parent).length !== 0) fail("gosu_derivative_image_daemon_files_changed", phase);
  const infra = path.join(parent, "infra"); const endpointDir = path.join(parent, "endpoint"); const client = path.join(parent, "client");
  const buildxConfig = path.join(client, "buildx"); const outputDirectory = path.join(client, "output");
  const contextName = `aw-cold-${value.nonce}`;
  for (const file of [infra, endpointDir, path.join(infra, "data"), path.join(infra, "exec"), path.join(infra, "client"),
    client, buildxConfig, outputDirectory, path.join(client, "contexts")]) {
    mkdirSync(file, { mode: 0o700 }); const nonroot = file === client || file.startsWith(`${client}/`);
    if (nonroot) chownSync(file, 1000, 1000); dirs.set(file, directory(file, nonroot ? 1000 : 0, nonroot ? 1000 : 0, 0o700)); holdDirectory(file);
  }
  const socket = path.join(endpointDir, "docker.sock"); const endpoint = `unix://${socket}`;
  if (Buffer.byteLength(socket) > 100) fail("gosu_derivative_image_daemon_input_invalid", phase);
  let spec = { root: parent, infrastructure: infra, endpointDirectory: endpointDir, rootClient: path.join(infra, "client"), uid: 0, gid: 0,
    executable: "/usr/bin/dockerd", version: "28.0.4", nonce: value.nonce, configFile: path.join(infra, "daemon.json"),
    pidFile: path.join(infra, "daemon.pid"), logFile: path.join(infra, "daemon.log"), socket,
    dataRoot: path.join(infra, "data"), execRoot: path.join(infra, "exec"), containerdAddress: value.principal.containerdAddress,
    containersNamespace: `awcold-${value.nonce}`, pluginsNamespace: `plugins.awcold-${value.nonce}` };
  spec.args = ["--config-file", spec.configFile, "--containerd-plugins-namespace", spec.pluginsNamespace];
  spec.argvSha256 = sha(bytes([spec.executable, ...spec.args])); spec.configSha256 = "0".repeat(64);
  const config = bytes(coldLoadDaemonConfiguration(spec)); spec.configSha256 = sha(config); spec = freeze(spec);
  const files = new Map();
  for (const [file, content, uid, gid] of [[spec.configFile, config, 0, 0], [path.join(spec.rootClient, "config.json"), bytes({}), 0, 0]]) {
    write(file, content, uid, gid); files.set(file, regular(file, uid, gid, content));
  }
  write(path.join(client, "config.json"), bytes({}), 1000, 1000);
  write(spec.logFile, Buffer.alloc(0)); const log = regular(spec.logFile, 0, 0, undefined, true);
  const helper = dependencies.helper ?? createColdLoadDaemonHelper(); const transport = dependencies.transport ?? transportDefault;
  const env = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: infra, DOCKER_CONFIG: spec.rootClient });
  let child; let socketIdentity; let pidIdentity; let initialPrincipal; let state = "STARTING"; let busy = false; let startAttempted = false;
  function assertFiles() {
    validateColdLoadDaemonRoutingEnvironment(ambient); assertTools();
    for (const [file, expected] of dirs) {
      const held = fstatSync(directoryFds.get(file), { bigint: true });
      if (!isDeepStrictEqual(directory(file, Number(expected.uid), Number(expected.gid), Number(expected.mode & 0o7777n)), expected)
        || !held.isDirectory() || Object.keys(expected).some((key) => held[key] !== expected[key])) fail("gosu_derivative_image_daemon_files_changed", phase);
    }
    for (const [file, expected] of files) if (!isDeepStrictEqual(regular(file, Number(expected.uid), Number(expected.gid), expected.bytes), expected)) fail("gosu_derivative_image_daemon_files_changed", phase);
    const clientEntries = readdirSync(client);
    if (!isDeepStrictEqual(regular(spec.logFile, 0, 0, undefined, true), log)
      || clientEntries.some((entry) => !["buildx", "config.json", "contexts", "output"].includes(entry))
      || !["buildx", "config.json", "output"].every((entry) => clientEntries.includes(entry))
      || !isDeepStrictEqual(readdirSync(spec.rootClient), ["config.json"])) fail("gosu_derivative_image_daemon_files_changed", phase);
    // The ordinary client owns generated context/Buildx metadata; Root never parses its contents.
    if (clientEntries.includes("contexts")) directory(path.join(client, "contexts"), 1000, 1000, 0o700);
    const clientConfig = lstatSync(path.join(client, "config.json"), { bigint: true });
    if (!clientConfig.isFile() || clientConfig.isSymbolicLink() || clientConfig.uid !== 1000n || clientConfig.gid !== 1000n
      || clientConfig.nlink !== 1n || (clientConfig.mode & 0o7777n) !== 0o600n) fail("gosu_derivative_image_daemon_files_changed", phase);
    if (child && state !== "STOPPED") {
      const current = lstatSync(socket, { bigint: true });
      if (!current.isSocket() || current.isSymbolicLink() || current.nlink !== 1n || !isDeepStrictEqual(socketProof(current), socketIdentity)
        || !isDeepStrictEqual(regular(spec.pidFile, 0, 0, Buffer.from(String(child.pid))), pidIdentity)) fail("gosu_derivative_image_daemon_files_changed", phase);
    }
  }
  const call = async (host, args) => {
    assertFiles(); const output = response(await transport(DOCKER, ["--host", host, ...args],
      { cwd: infra, env, maxBuffer: CAP, timeoutMs: Math.min(15_000, remaining()) })); remaining(); assertFiles(); return output;
  };
  const info = async (host, expected) => validateColdLoadDaemonInfo(json(await call(host, INFO)), expected);
  const inventory = async (host, guard) => {
    const result = [];
    for (const [index, args] of LISTS.entries()) { await guard(); result.push(lines(await call(host, args), [IMAGE, /^[0-9a-f]{64}$/u, /^[A-Za-z0-9_.-]{1,255}$/u][index])); }
    return { images: result[0], containers: result[1], volumes: result[2] };
  };
  const principalSnapshot = async () => {
    const guard = () => info(MAIN, value.principal); await guard(); const v = await inventory(MAIN, guard);
    if (!isDeepStrictEqual(v, { images: value.principal.imageIds, containers: [], volumes: [] })) fail("gosu_derivative_image_daemon_principal_changed", phase);
    const hashes = [];
    for (const id of value.principal.imageIds) { await guard(); const raw = await call(MAIN, ["image", "inspect", "--format", "{{json .}}", id]);
      if (json(raw)?.Id !== id) fail("gosu_derivative_image_daemon_principal_changed", phase); hashes.push(sha(raw)); }
    return sha(bytes({ ...v, hashes }));
  };
  const processGuard = async () => {
    assertFiles(); remaining(); const proof = await helper.verify(spec, child); remaining();
    if (!isDeepStrictEqual(proof, { state: "RUNNING", pid: child.pid, startTicks: child.startTicks, uid: 0, gid: 0,
      executable: spec.executable, version: spec.version, argvSha256: spec.argvSha256, configSha256: spec.configSha256 })) fail("gosu_derivative_image_daemon_helper_invalid", phase);
    assertFiles();
  };
  const isolated = () => ({ id: child.daemonId, root: spec.dataRoot, containerdAddress: spec.containerdAddress,
    containersNamespace: spec.containersNamespace, pluginsNamespace: spec.pluginsNamespace });
  const guard = async () => { await processGuard(); await info(endpoint, isolated()); await processGuard(); };
  const acknowledgement = () => ({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    daemonId: child.daemonId, endpoint, pid: child.pid, principalImageCount: 2, principalSnapshotSha256: initialPrincipal });
  const verifyIdentity = async () => {
    if (!["STARTING", "ACTIVE"].includes(state)) fail("gosu_derivative_image_daemon_input_invalid", phase);
    await guard(); if (await principalSnapshot() !== initialPrincipal) fail("gosu_derivative_image_daemon_principal_changed", phase);
    return Object.freeze({ state: "VERIFIED", ...acknowledgement() });
  };
  let lastMode = "EMPTY"; let lastSubjects = freeze([]);
  const verifyInventory = async (mode, subjects = []) => {
    if (!["EMPTY", "BASE_ONLY", "BASE_AND_CANDIDATE"].includes(mode) || !Array.isArray(subjects)) {
      fail("gosu_derivative_image_daemon_inventory_invalid", phase);
    }
    await verifyIdentity(); const v = await inventory(endpoint, guard); const inspected = [];
    for (const subject of subjects) {
      const accepted = imageSubject(subject, value.nonce); await guard();
      inspected.push(json(await call(endpoint, ["image", "inspect", "--format", "{{json .}}", accepted.imageId])));
    }
    const result = validateColdLoadDaemonInventory(v, mode, subjects, inspected, value.nonce); await guard();
    lastMode = mode; lastSubjects = result.subjects;
    return Object.freeze({ state: `VERIFIED_${mode}`, ...acknowledgement(), ...result });
  };
  const stopProcess = async () => {
    let timer; let result;
    try { result = await Promise.race([helper.stop(spec, child), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("gosu_derivative_image_daemon_cleanup_uncertain")), Math.min(25_000, terminationRemaining()));
    })]); } finally { clearTimeout(timer); }
    validateColdLoadDaemonStopProof(result, child);
    for (const name of [socket, spec.pidFile]) { try { lstatSync(name); fail("gosu_derivative_image_daemon_cleanup_uncertain", phase); }
      catch (error) { if (error.code !== "ENOENT") throw error; } }
    state = "STOPPED";
  };
  try {
    for (const fd of directoryFds.values()) fsyncSync(fd);
    initialPrincipal = await principalSnapshot(); remaining(); startAttempted = true;
    const started = await helper.start(spec);
    child = validateColdLoadDaemonStartProof(started, value.principal.id);
    remaining();
    const beforeData = dirs.get(spec.dataRoot); const data = directory(spec.dataRoot, 0, 0, 0o710);
    if (beforeData.dev !== data.dev || beforeData.ino !== data.ino) fail("gosu_derivative_image_daemon_files_changed", phase); dirs.set(spec.dataRoot, data);
    const sock = lstatSync(socket, { bigint: true }); socketIdentity = socketProof(sock);
    if (!sock.isSocket() || sock.isSymbolicLink() || sock.nlink !== 1n || socketIdentity.uid !== 0 || socketIdentity.gid !== 1000 || socketIdentity.mode !== 0o660) fail("gosu_derivative_image_daemon_files_changed", phase);
    pidIdentity = regular(spec.pidFile, 0, 0, Buffer.from(String(child.pid)));
    await verifyInventory("EMPTY"); await guard();
    if ((await call(endpoint, ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"])).toString().trim() !== "28.0.4|28.0.4") fail("gosu_derivative_image_daemon_identity_invalid", phase);
    const old = dirs.get(endpointDir); chownSync(endpointDir, 0, 1000); chmodSync(endpointDir, 0o710);
    const exposed = directory(endpointDir, 0, 1000, 0o710); if (old.dev !== exposed.dev || old.ino !== exposed.ino) fail("gosu_derivative_image_daemon_files_changed", phase);
    dirs.set(endpointDir, exposed); await verifyInventory("EMPTY"); state = "ACTIVE";
  } catch (error) {
    if (startAttempted && !child) fail("gosu_derivative_image_daemon_cleanup_uncertain", phase);
    if (child) { phase = "STOP"; try { await stopProcess(); } catch { fail("gosu_derivative_image_daemon_cleanup_uncertain", phase); } }
    closeDirectories();
    throw closed(error, phase, "gosu_derivative_image_daemon_helper_invalid");
  }
  const exclusive = async (nextPhase, action) => { if (busy) fail("gosu_derivative_image_daemon_input_invalid", nextPhase); busy = true; phase = nextPhase;
    try { return await action(); } catch (error) { throw closed(error, phase); } finally { busy = false; } };
  const identity = freeze({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", root: parent,
    nonce: value.nonce, socket, endpoint, dockerConfig: client, buildxConfig, outputDirectory, contextName, deadlineAtMs: deadline,
    pid: child.pid, startTicks: child.startTicks, daemonId: child.daemonId,
    version: spec.version, dataRoot: spec.dataRoot, execRoot: spec.execRoot, containerdAddress: spec.containerdAddress,
    containersNamespace: spec.containersNamespace, pluginsNamespace: spec.pluginsNamespace, configSha256: spec.configSha256, argvSha256: spec.argvSha256,
    rootActor: { uid: 0, gid: 0 }, clientActor: { uid: 1000, gid: 1000 }, socketProof: socketIdentity,
    socketDirectoryProof: socketProof(lstatSync(endpointDir, { bigint: true })) });
  return Object.freeze({ identity,
    verifyIdentity: () => exclusive("VERIFY", verifyIdentity),
    verifyInventory: (mode, subjects = []) => exclusive("INVENTORY", () => verifyInventory(mode, subjects)),
    stop: (options) => exclusive("STOP", async () => {
      if (!keys(options, ["requireMode"]) || !["EMPTY", "BASE_ONLY", "BASE_AND_CANDIDATE"].includes(options.requireMode)
        || options.requireMode !== lastMode || state !== "ACTIVE") fail("gosu_derivative_image_daemon_cleanup_uncertain", phase);
      let validInventory = true;
      try { await verifyInventory(options.requireMode, lastSubjects); } catch { validInventory = false; }
      try {
        // Even a failed inventory must attempt to stop only the helper-proven owned process.
        await stopProcess(); assertFiles();
        for (const pin of TOOL_PINS) if (!isDeepStrictEqual(toolProof(pin), tools.get(pin.path))) fail("gosu_derivative_image_daemon_files_changed", phase);
        if (await principalSnapshot() !== initialPrincipal || !validInventory) fail("gosu_derivative_image_daemon_cleanup_uncertain", phase);
        closeDirectories(); remaining();
        return Object.freeze({ state: "STOPPED", ...acknowledgement(), isolatedFinalInventory: options.requireMode,
          processGone: true, socketGone: true, pidFileGone: true, privateState: "RETAINED" });
      } catch { state = "UNCERTAIN"; closeDirectories(); fail("gosu_derivative_image_daemon_cleanup_uncertain", phase); }
    }) });
  } catch (error) {
    let closeFailed = false;
    for (const fd of directoryFds.values()) { try { closeSync(fd); } catch { closeFailed = true; } }
    directoryFds.clear();
    if (closeFailed) fail("gosu_derivative_image_daemon_cleanup_uncertain", phase);
    throw error;
  }
}
export async function startGosuDerivativeImageDaemonLease(input, dependencies = {}) {
  try { return await startLease(input, dependencies); }
  catch (error) { let phase = "START"; try { const reported = error?.phase; if (PHASES.includes(reported)) phase = reported; } catch { /* Closed. */ }
    throw closed(error, phase); }
}
