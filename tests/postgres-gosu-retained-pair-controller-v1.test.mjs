import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter, addAbortListener } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { candidateContractV2, openCandidateLockV2 } from "../scripts/postgres-image/gosu-derivative-candidate-v2.mjs";

const SELF = fileURLToPath(import.meta.url);
const SOURCE = new URL("../scripts/postgres-image/gosu-retained-pair-controller-v1.mjs", import.meta.url);
const CANDIDATE_LOCK = new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url);
const SENTINEL = "GOSU_RETAINED_PAIR_CONTROLLER_SELF_WRAPPED";
const WINDOWS_NODE = Object.freeze({ version: "v22.23.2", bytes: 86_997_320,
  sha256: "0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4" });
const LINUX_NODE = Object.freeze({ version: "v22.23.2", bytes: 124_836_408,
  sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327" });

function executablePin() {
  const expected = process.platform === "win32" ? WINDOWS_NODE : LINUX_NODE;
  const bytes = fs.statSync(process.execPath).size;
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(process.execPath)).digest("hex");
  assert.deepEqual({ version: process.version, bytes, sha256 }, expected);
}

function childEnvironment() {
  const environment = { [SENTINEL]: "1", NODE_NO_WARNINGS: "1" };
  for (const name of ["SystemRoot", "TEMP", "TMP", "ComSpec", "PATHEXT", "WINDIR"]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  return environment;
}

const REQUIRED_CASES = [
  "controller v1 exports exactly the four frozen public interfaces",
  "controller v1 publishes the exact deeply frozen literal contract",
  "controller v1 loads only the exact canonical reviewed control capability",
  "controller v1 rejects malformed controls before any execution authority exists",
  "controller v1 diagnostics close real loader failures without private text",
  "controller v1 failure diagnostics never invoke getters or inspect proxies",
  "controller v1 source contains no broad cleanup or archive publication primitive",
  "controller v1 public loader rejects a Buffer proxy without invoking its traps",
  "controller v1 public loader rejects accessor-bearing Buffers without invoking accessors",
  "controller v1 public run rejects an input Buffer proxy without invoking its traps",
  "controller v1 dense array validator rejects a proxy without invoking its traps",
  "controller v1 public run rejects an options proxy without invoking its traps",
  "controller v1 public run rejects an AbortSignal proxy without invoking its traps",
  "controller v1 public run rejects hostile own AbortSignal surface before work",
  "controller v1 public run closes nullish AbortSignal options before work",
  "controller v1 public run accepts supported native AbortSignal forms",
  "controller v1 public abort remains effective behind stopImmediatePropagation",
  "controller v1 public run contains abort listener boundary failures after proof",
  "controller v1 public loader closes a non-string execution identifier without coercion",
  "controller v1 rejects non-string daemon identity regex fields without coercion",
  "controller v1 public run rejects a non-string inventory snapshot without coercion",
  "controller v1 public run rejects hostile inventory subjects without invoking them",
  "controller v1 public run rejects an expired worker cutoff before spawn",
  "controller v1 public run owns an asynchronous child error before rejecting a missing PID",
  "controller v1 public run rejects output caps and abnormal child termination",
  "controller v1 public timeout re-proves the leader before TERM and KILL",
  "controller v1 public close cannot acknowledge a simultaneous abort or expired cutoff",
  "controller v1 public run sends no payload after cutoff during leader proof",
  "controller v1 public run sends no payload after abort during leader proof",
  "controller v1 public run terminates the proven leader after a pre-transport clock rollback",
  "controller v1 public run terminates an authenticated leader after post-transport clock rollback",
  "controller v1 public run does not signal an already closed leader after post-race clock rollback",
  "controller v1 rejects a surplus daemon identity before reading it",
  "controller v1 rejects daemon identity accessors without invoking them",
  "controller v1 rejects a daemon identity proxy without invoking its traps",
  "controller v1 authenticates a frozen copy of the mutable daemon identity",
  "controller v1 VM runs the success protocol in the fixed lifecycle order",
  "controller v1 public run completes through genuine helpers with boundary-only PROTOCOL_SIMULATION",
  "controller v1 public run rejects a stdout stream error and stops once in EMPTY mode",
  "controller v1 public run rejects child close before stdout close and never acknowledges",
  "controller v1 public run preserves archive descriptor close uncertainty after daemon stop",
  "controller v1 public run rejects a context entry size that differs from the fixed contract",
  "controller v1 public run rejects a context entry digest that differs from the fixed contract",
  "controller v1 public run rejects aliased physical modes before archive inspection",
  "controller v1 public run rejects unmanifested empty source directories before daemon start",
  "controller v1 public run accepts the exact context entry set in a different order",
  "controller v1 public run rejects duplicate or missing context entry members",
  "controller v1 public run accepts trimmed builder platform members",
  "controller v1 public run rejects a clock rollback between publication and ACK",
  "controller v1 public run preserves source descriptor close uncertainty before daemon start",
  "controller v1 public run rejects oversized transport before worker spawn and stops EMPTY once",
  "controller v1 public run rejects pre-daemon clock rollback without calling daemon start",
  "controller v1 public run stops the authenticated lease once after post-return clock rollback",
  "controller v1 VM stops once in the last confirmed mode after worker failure",
  "controller v1 VM stops once before reporting a late stop entry",
  "controller v1 VM never acknowledges while the one stop attempt is unsettled",
  "controller v1 VM reports uncertain cleanup when the one stop attempt rejects",
  "controller v1 VM preserves uncertain cleanup when daemon start rejects",
  "controller v1 proc proof accepts an actually empty supplementary group list",
  "controller v1 proc proof rejects a surplus empty command argument",
  "controller v1 genuine host filesystem preserves exclusive no-follow descriptor identity",
];
if (process.platform === "linux" && process.getuid?.() === 1000 && process.getgid?.() === 1000) {
  REQUIRED_CASES.push("controller v1 genuine UID1000 archive helper holds and revalidates the same descriptors");
}
if (process.platform === "linux" && process.getuid?.() === 0 && process.getgid?.() === 0) {
  REQUIRED_CASES.push("controller v1 genuine root receipt helper publishes one exclusive durable receipt");
}
const REQUIRED_TEST_COUNT = REQUIRED_CASES.length + 29;

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sha1Object = (kind, bytes) => crypto.createHash("sha1")
  .update(Buffer.from(`${kind} ${bytes.length}\0`)).update(bytes).digest("hex");
const pretty = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const compact = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const imageId = (character) => `sha256:${character.repeat(64)}`;

function treeOid(entries) {
  const root = { files: new Map(), directories: new Map() };
  for (const entry of entries) {
    const parts = entry.path.split("/"); let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.directories.has(part)) node.directories.set(part, { files: new Map(), directories: new Map() });
      node = node.directories.get(part);
    }
    node.files.set(parts.at(-1), entry);
  }
  const calculate = (node) => {
    const children = [
      ...[...node.files].map(([name, entry]) => ({ name, sort: name, mode: entry.gitMode, oid: entry.gitBlobSha1 })),
      ...[...node.directories].map(([name, directory]) => ({ name, sort: `${name}/`, mode: "40000", oid: calculate(directory) })),
    ].sort((left, right) => Buffer.compare(Buffer.from(left.sort), Buffer.from(right.sort)));
    const body = Buffer.concat(children.flatMap((child) => [Buffer.from(`${child.mode} ${child.name}\0`), Buffer.from(child.oid, "hex")]));
    return sha1Object("tree", body);
  };
  return calculate(root);
}

function controlFixture() {
  const body = Buffer.from("PROTOCOL_SIMULATION controller source fixture\n");
  const entries = [{ path: "scripts/postgres-image/gosu-retained-pair-controller-v1.mjs", gitMode: "100644",
    bytes: body.length, sha256: sha256(body), gitBlobSha1: sha1Object("blob", body) }];
  const calcTreeGitSha1 = treeOid(entries);
  const sourceManifest = { kind: "GOSU_RETAINED_PAIR_SOURCE_MANIFEST_V1", entries, calcTreeGitSha1 };
  const commitBytes = Buffer.from(`tree ${calcTreeGitSha1}\nauthor Protocol Simulation <noreply@example.invalid> 0 +0000\ncommitter Protocol Simulation <noreply@example.invalid> 0 +0000\n\nfixture\n`);
  const controllerRevision = sha1Object("commit", commitBytes);
  return {
    kind: "GOSU_RETAINED_PAIR_CONTROLLER_CONTROL_V1",
    executionId: `gosu-retained-pair-${"1".repeat(24)}`,
    baselineRevision: "81e9aee793820f543a12f27e4d5ba42d702f4cc8",
    baselineTree: "f8e85365bb1a35d265df989646c9bbd264781133",
    controllerRevision,
    controllerTree: calcTreeGitSha1,
    pr188Revision: "2435bce8068146c55fed06ddf7189b70ac8c7475",
    pr188Tree: "c47ed63d3ae51817035227e0b4977ac41ce0dfef",
    commitRaw: { encoding: "base64", bytes: commitBytes.length, base64: commitBytes.toString("base64") },
    commitRawSha1: controllerRevision,
    sourceManifest,
    sourceManifestSha256: sha256(pretty(sourceManifest)),
    acceptance: { path: ".omx/gosu-derivative-context-private-acceptance-v1.json", bytes: 11_744,
      sha256: "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3" },
    principal: { id: "principal-engine", root: "/var/lib/docker", containerdAddress: "/run/containerd/containerd.sock",
      containersNamespace: "moby", pluginsNamespace: "plugins.moby", imageIds: [imageId("1"), imageId("2")] },
    deadlinePolicy: { workerCutoffBeforeDaemonMs: 90_000, termMs: 10_000, killAndDrainMs: 15_000,
      bookkeepingMs: 5_000, stopEntryBeforeDaemonMs: 60_000, postStopMs: 180_000, controllerAfterDaemonMs: 160_000 },
  };
}

function controllerInputFixture(control = controlFixture()) {
  return { kind: "GOSU_RETAINED_PAIR_CONTROLLER_INPUT_V1", executionId: control.executionId,
    nonce: "a".repeat(24), parent: "/var/tmp/aw-cl-ABC123", principal: globalThis.structuredClone(control.principal) };
}

function controllerIdentityFixture(input = controllerInputFixture()) {
  const root = input.parent; const nonce = input.nonce;
  return { purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    root, nonce, socket: `${root}/endpoint/docker.sock`, endpoint: `unix://${root}/endpoint/docker.sock`,
    dockerConfig: `${root}/client`, buildxConfig: `${root}/client/buildx`, outputDirectory: `${root}/client/output`,
    contextName: `aw-cold-${nonce}`, pid: 4321, startTicks: "1234", daemonId: "isolated-engine", version: "28.0.4",
    dataRoot: `${root}/infra/data`, execRoot: `${root}/infra/exec`, containerdAddress: input.principal.containerdAddress,
    containersNamespace: `awcold-${nonce}`, pluginsNamespace: `plugins.awcold-${nonce}`,
    configSha256: "b".repeat(64), argvSha256: "c".repeat(64), deadlineAtMs: 500_000,
    rootActor: { uid: 0, gid: 0 }, clientActor: { uid: 1000, gid: 1000 },
    socketProof: { dev: "1", ino: "2", uid: 0, gid: 1000, mode: 0o660 },
    socketDirectoryProof: { dev: "1", ino: "3", uid: 0, gid: 1000, mode: 0o710 } };
}

async function controllerProtocolVm(overrides = {}) {
  const events = []; let stopCalls = 0; let stopMode; let daemonLease; let context;
  const sourceText = `${fs.readFileSync(SOURCE, "utf8")}\n
verifySource = () => globalThis.__hooks.event("source");
verifyParent = () => globalThis.__hooks.event("parent");
checkTool = (pin) => globalThis.__hooks.event("tool:" + pin.path);
sourceClosure = () => globalThis.__hooks.realm({ kind: "PROTOCOL_SIMULATION_SOURCE_CLOSURE" });
runWorker = async (...args) => globalThis.__hooks.runWorker(...args);
parseWorker = (...args) => globalThis.__hooks.parseWorker(...args);
inspectArchives = (...args) => globalThis.__hooks.inspectArchives(...args);
publishReceipt = (...args) => globalThis.__hooks.publishReceipt(...args);
time = (phase) => globalThis.__hooks.time(phase);
const TEST_ONLY_daemonStop = daemonStop;
daemonStop = (...args) => { try { return TEST_ONLY_daemonStop(...args); } catch (error) { globalThis.__hooks.event("daemonStop:rejected"); throw error; } };
export const TEST_ONLY_protocolSimulation = true;
export { authenticateLease as TEST_ONLY_authenticateLease, dense as TEST_ONLY_dense, procProof as TEST_ONLY_procProof,
  validateLeaseIdentity as TEST_ONLY_validateLeaseIdentity };
`;
  const realm = (value) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
  const hooks = {
    event(name) { events.push(name); }, realm,
    time(phase) { events.push(`time:${phase}`); return overrides.times?.[phase] ?? 1_000; },
    async runWorker() {
      events.push("worker");
      if (overrides.workerError) throw overrides.workerError;
      return realm({ bytes: { protocol: "simulation" }, worker: { state: "EXITED", code: 0 },
        processSupervision: { scope: "PROTOCOL_SIMULATION", processGroupClosed: true, streamsClosed: true } });
    },
    parseWorker() {
      events.push("parse");
      if (overrides.parseError) throw overrides.parseError;
      return realm({ buildWindow: { startedAtMs: 100, completedAtMs: 200 }, pairProof: { scope: "PROTOCOL_SIMULATION" },
        retention: { state: "SEALED_SNAPSHOT_REVIEW_PENDING", base: { configId: imageId("f") },
          candidate: { configId: imageId("e") } } });
    },
    inspectArchives() { events.push("inspect"); return realm({ scope: "PROTOCOL_SIMULATION_ARCHIVE_SNAPSHOT" }); },
    publishReceipt() { events.push("publish"); return realm({ bytes: 321, sha256: "d".repeat(64),
      physical: { dev: "1", ino: "9", uid: "0", gid: "0", mode: 0o100600, nlink: "1", size: "321", mtimeNs: "1", ctimeNs: "1" } }); },
  };
  context = vm.createContext({ Buffer, TextDecoder: globalThis.TextDecoder, TextEncoder: globalThis.TextEncoder, URL, AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, structuredClone: globalThis.structuredClone, __hooks: hooks,
    process: Object.freeze({ platform: "linux", version: "v22.23.2",
      execPath: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node", env: Object.freeze({}), argv: [],
      getuid: () => 0, geteuid: () => 0, getgid: () => 0, getegid: () => 0, getgroups: () => [0] }) });
  const synthetic = (identifier, values) => new vm.SyntheticModule(Object.keys(values), function initialize() {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier });
  const imports = [];
  const module = new vm.SourceTextModule(sourceText, { context,
    identifier: "file:///opt/auto-world/deployment/scripts/postgres-image/gosu-retained-pair-controller-v1.mjs",
    initializeImportMeta(meta) { meta.url = "file:///opt/auto-world/deployment/scripts/postgres-image/gosu-retained-pair-controller-v1.mjs"; } });
  await module.link(async (specifier) => {
    imports.push(specifier);
    if (specifier === "./gosu-derivative-image-daemon-v2.mjs") {
      return synthetic("mock:daemon", { startGosuDerivativeImageDaemonLease: async ({ parent, nonce, principal }) => {
        events.push("daemonStart");
        if (overrides.daemonError) throw overrides.daemonError;
        const input = { parent, nonce, principal }; const identity = realm(controllerIdentityFixture(input));
        const lease = vm.runInContext("({})", context); lease.identity = identity;
        lease.verifyIdentity = async () => {
          events.push("identity");
          return realm({ state: "VERIFIED", purpose: identity.purpose, authority: "LOCAL_DIAGNOSTIC",
            admission: "NOT_AUTHORIZED", daemonId: identity.daemonId, endpoint: identity.endpoint, pid: identity.pid,
            principalImageCount: 2, principalSnapshotSha256: "9".repeat(64) });
        };
        lease.verifyInventory = async (mode, subjects) => {
          events.push(mode === "EMPTY" ? "inventory:EMPTY" : "inventory:BASE_AND_CANDIDATE");
          if (overrides.inventoryError?.mode === mode) throw overrides.inventoryError.error;
          const raw = realm({ state: `VERIFIED_${mode}`, purpose: identity.purpose, authority: "LOCAL_DIAGNOSTIC",
            admission: "NOT_AUTHORIZED", daemonId: identity.daemonId, endpoint: identity.endpoint, pid: identity.pid,
            principalImageCount: 2, principalSnapshotSha256: "9".repeat(64), images: mode === "EMPTY" ? 0 : 2,
            containers: 0, volumes: 0, subjects: [] });
          if (overrides.inventorySnapshotValue !== undefined) raw.principalSnapshotSha256 = overrides.inventorySnapshotValue;
          raw.subjects = subjects; return raw;
        };
        lease.stop = async ({ requireMode }) => {
          stopCalls += 1; stopMode = requireMode; events.push(`stop:${requireMode}`);
          if (overrides.stop) return overrides.stop({ requireMode, identity, realm });
          return realm({ state: "STOPPED", purpose: identity.purpose, authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
            daemonId: identity.daemonId, endpoint: identity.endpoint, pid: identity.pid, principalImageCount: 2,
            principalSnapshotSha256: "9".repeat(64), isolatedFinalInventory: requireMode, processGone: true,
            socketGone: true, pidFileGone: true, privateState: "RETAINED" });
        };
        daemonLease = lease; return lease;
      } });
    }
    if (specifier === "./gosu-retained-pair-worker-v1.mjs") {
      return synthetic("mock:worker", { validateGosuRetainedPairSourceClosureV1: (value) => value });
    }
    if (!specifier.startsWith("node:")) throw new Error(`unexpected production import ${specifier}`);
    if (specifier === "node:fs") return synthetic("mock:fs", {
      closeSync() {}, constants: fs.constants, fstatSync() { throw new Error("unexpected fs"); }, fsyncSync() {},
      lstatSync() { throw new Error("unexpected fs"); }, mkdirSync() {}, openSync() { throw new Error("unexpected fs"); },
      readFileSync(...args) { if (overrides.fs?.readFileSync) return overrides.fs.readFileSync(...args); throw new Error("unexpected fs"); },
      readSync() { throw new Error("unexpected fs"); }, readdirSync() { throw new Error("unexpected fs"); },
      realpathSync(value) { return overrides.fs?.realpathSync ? overrides.fs.realpathSync(value) : value; },
      statfsSync() { throw new Error("unexpected fs"); },
      writeSync() { throw new Error("unexpected fs"); },
    });
    if (specifier === "node:path") return synthetic("mock:path", { default: (await import("node:path")).posix });
    if (specifier === "node:url") return synthetic("mock:url", { fileURLToPath: (url) => new URL(url).pathname });
    if (specifier === "node:child_process") return synthetic("mock:child_process", { spawn() { throw new Error("unexpected spawn"); } });
    if (specifier === "node:timers/promises") return synthetic("mock:timers", { setTimeout: async () => {} });
    const namespace = await import(specifier);
    return synthetic(`mock:${specifier}`, Object.fromEntries(Object.keys(namespace).map((key) => [key, namespace[key]])));
  });
  await module.evaluate();
  return { api: module.namespace, context, events, imports, realm, get stopCalls() { return stopCalls; }, get stopMode() { return stopMode; },
    get daemonLease() { return daemonLease; } };
}

async function loadedProtocolScenario(overrides = {}) {
  const harness = await controllerProtocolVm(overrides); const control = controlFixture(); const controlBytes = pretty(control);
  const capability = harness.api.loadGosuRetainedPairControllerControlV1(controlBytes, sha256(controlBytes));
  return { harness, inputBytes: compact(controllerInputFixture(control)), capability };
}

async function controllerFsHelperApi() {
  const context = vm.createContext({ Buffer, TextDecoder: globalThis.TextDecoder, TextEncoder: globalThis.TextEncoder, URL,
    AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, structuredClone: globalThis.structuredClone, process });
  const synthetic = (identifier, values) => new vm.SyntheticModule(Object.keys(values), function initialize() {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier });
  const sourceText = `${fs.readFileSync(SOURCE, "utf8")}\nexport { inspectArchives as TEST_ONLY_inspectArchives, publishReceipt as TEST_ONLY_publishReceipt };\nexport const TEST_ONLY_realmValue = (text) => JSON.parse(text);\n`;
  const module = new vm.SourceTextModule(sourceText, { context, identifier: SOURCE.href,
    initializeImportMeta(meta) { meta.url = SOURCE.href; } });
  await module.link(async (specifier) => {
    const resolved = specifier.startsWith("node:") ? specifier : new URL(specifier, SOURCE).href;
    if (specifier === "node:fs") {
      const namespace = await import("node:fs");
      return synthetic("helper:node:fs", { ...namespace,
        readdirSync: (...args) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(fs.readdirSync(...args)))})`, context) });
    }
    const namespace = await import(resolved);
    return synthetic(`helper:${resolved}`, Object.fromEntries(Object.keys(namespace).map((key) => [key, namespace[key]])));
  });
  await module.evaluate(); return module.namespace;
}

function physicalSnapshot(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  return { dev: String(stat.dev), ino: String(stat.ino), mode: Number(stat.mode), nlink: Number(stat.nlink), size: Number(stat.size),
    uid: Number(stat.uid), gid: Number(stat.gid), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs),
    birthtimeNs: String(stat.birthtimeNs) };
}

function removeOwnedTemporaryDirectory(directory, prefix) {
  const target = path.resolve(directory); const parent = path.resolve(os.tmpdir());
  assert.equal(path.dirname(target), parent); assert.equal(path.basename(target).startsWith(prefix), true);
  fs.rmSync(target, { recursive: true, force: true });
}

// PROTOCOL_SIMULATION only. This private draft models controller boundaries; it never touches Docker, real PIDs, or private artifacts.

const posix = path.posix;
const ROOT = "/opt/auto-world/deployment";
const CONTROLLER = `${ROOT}/scripts/postgres-image/gosu-retained-pair-controller-v1.mjs`;
const WORKER = `${ROOT}/scripts/postgres-image/gosu-retained-pair-worker-v1.mjs`;
const ACCEPTANCE = `${ROOT}/.omx/gosu-derivative-context-private-acceptance-v1.json`;
const NODE = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
const SETPRIV = "/usr/bin/setpriv";
const SNAPSHOT = "9".repeat(64);

const prettyBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const compactBytes = (value) => Buffer.from(`${JSON.stringify(value)}\n`);

function makeStat({ type, dev = 1n, ino, mode, nlink = 1n, size = 0n, uid = 0n, gid = 0n,
  mtimeNs = 20n, ctimeNs = 21n, birthtimeNs = 19n }) {
  return {
    dev, ino, mode: BigInt(mode), nlink, size: BigInt(size), uid, gid, mtimeNs, ctimeNs, birthtimeNs,
    isFile: () => type === "file", isDirectory: () => type === "directory", isSymbolicLink: () => type === "symlink",
  };
}

function cloneStat(value) {
  return makeStat({ ...value, type: value.isFile() ? "file" : value.isDirectory() ? "directory" : "symlink" });
}

function normalize(value) {
  const result = posix.normalize(String(value));
  return result.length > 1 ? result.replace(/\/$/u, "") : result;
}

function createVirtualFs({ control, input, workerEnvelope, faults, events }) {
  const nodes = new Map();
  const descriptors = new Map();
  const bufferTags = new WeakMap();
  let nextIno = 100n;
  let nextFd = 40;
  let clock = 30n;

  const addDirectory = (name, attributes = {}) => {
    name = normalize(name);
    if (nodes.has(name)) return nodes.get(name);
    if (name !== "/") addDirectory(posix.dirname(name));
    const node = { path: name, type: "directory", data: undefined,
      stat: makeStat({ type: "directory", ino: attributes.ino ?? nextIno++, mode: attributes.mode ?? 0o40555,
        nlink: attributes.nlink ?? 2n, uid: attributes.uid ?? 0n, gid: attributes.gid ?? 0n,
        mtimeNs: attributes.mtimeNs, ctimeNs: attributes.ctimeNs, birthtimeNs: attributes.birthtimeNs }) };
    nodes.set(name, node);
    return node;
  };
  const addFile = (name, attributes = {}) => {
    name = normalize(name); addDirectory(posix.dirname(name));
    const data = attributes.data === undefined ? undefined : Buffer.from(attributes.data);
    const node = { path: name, type: "file", data, virtualSize: attributes.size,
      digest: attributes.digest ?? {}, stat: makeStat({ type: "file", ino: attributes.ino ?? nextIno++, mode: attributes.mode ?? 0o100444,
        nlink: attributes.nlink ?? 1n, size: attributes.size ?? data?.length ?? 0, uid: attributes.uid ?? 0n,
        gid: attributes.gid ?? 0n, mtimeNs: attributes.mtimeNs, ctimeNs: attributes.ctimeNs,
        birthtimeNs: attributes.birthtimeNs }) };
    nodes.set(name, node);
    return node;
  };

  addDirectory("/");
  addDirectory(ROOT, { mode: 0o40555 });
  for (const entry of control.sourceManifest.entries) {
    addFile(`${ROOT}/${entry.path}`, { size: entry.bytes, mode: entry.gitMode === "100755" ? 0o100555 : 0o100444,
      digest: { sha256: entry.sha256, sha1: entry.gitBlobSha1 } });
  }
  if (faults.extraSourceDirectory) {
    addDirectory(faults.extraSourceDirectory, { mode: 0o40555, uid: 0n, gid: 0n });
  }
  addFile(ACCEPTANCE, { size: 11_744, mode: 0o100444,
    digest: { sha256: "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3" } });
  addFile(NODE, { size: 124_836_408, mode: 0o100755,
    digest: { sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327" } });
  addFile(SETPRIV, { size: 39_304, mode: 0o100755,
    digest: { sha256: "62ec0120791f3afcfb689fed52384ec2b0accc6e118a6b9a1d6fcfa7450aaf37" } });
  addDirectory(input.parent, { mode: 0o40710, uid: 0n, gid: 1000n });

  const installArchives = () => {
    const result = workerEnvelope?.result;
    if (!result?.retention) return;
    const output = `${input.parent}/client/output`;
    const directory = result.retention.directory;
    addDirectory(output, { ino: BigInt(directory.ino), mode: directory.mode, nlink: BigInt(directory.nlink),
      uid: BigInt(directory.uid), gid: BigInt(directory.gid), mtimeNs: BigInt(directory.mtimeNs),
      ctimeNs: BigInt(directory.ctimeNs), birthtimeNs: BigInt(directory.birthtimeNs) });
    for (const retained of [result.retention.base, result.retention.candidate]) {
      const physical = retained.physical;
      addFile(`${output}/${retained.name}`, { size: retained.archive.bytes, ino: BigInt(physical.ino), mode: physical.mode,
        nlink: BigInt(physical.nlink), uid: BigInt(physical.uid), gid: BigInt(physical.gid),
        mtimeNs: BigInt(physical.mtimeNs), ctimeNs: BigInt(physical.ctimeNs), birthtimeNs: BigInt(physical.birthtimeNs),
        digest: { sha256: retained.archive.sha256 } });
    }
  };

  const resolveNode = (name) => {
    name = normalize(name);
    const node = nodes.get(name);
    if (!node) { const error = new Error(`ENOENT: ${name}`); error.code = "ENOENT"; throw error; }
    return node;
  };
  const fdNode = (fd) => {
    const descriptor = descriptors.get(fd);
    if (!descriptor || descriptor.closed) { const error = new Error(`EBADF: ${fd}`); error.code = "EBADF"; throw error; }
    return descriptor;
  };
  const children = (directory) => {
    directory = normalize(directory); const prefix = directory === "/" ? "/" : `${directory}/`;
    return [...nodes.keys()].filter((name) => name.startsWith(prefix) && name !== directory)
      .map((name) => name.slice(prefix.length)).filter((name) => name !== "" && !name.includes("/"));
  };
  const touchDirectory = (directory) => { const node = resolveNode(directory); clock += 1n; node.stat.mtimeNs = clock; node.stat.ctimeNs = clock; };

  const api = {
    constants: fs.constants,
    realpathSync(name) {
      name = normalize(name);
      if (name.startsWith("/proc/") && name.endsWith("/exe")) return faults.procExe ?? NODE;
      if (name === WORKER) return name;
      resolveNode(name);
      if (faults.identityLoss?.includes(name)) return `${name}.replaced`;
      return name;
    },
    lstatSync(name) {
      const node = resolveNode(name);
      if (faults.namedReplacement?.includes(normalize(name))) {
        const stat = cloneStat(node.stat); stat.ino += 1000n; return stat;
      }
      return cloneStat(node.stat);
    },
    fstatSync(fd) { return cloneStat(fdNode(fd).node.stat); },
    readdirSync(name) {
      const result = children(name);
      if (faults.namespaceMutation?.path === normalize(name)) return [...result, faults.namespaceMutation.name ?? "unexpected"];
      return result;
    },
    statfsSync() { return { bavail: 16n * 1024n * 1024n, bsize: 1024n }; },
    mkdirSync(name, options = {}) {
      name = normalize(name);
      if (nodes.has(name)) { const error = new Error("EEXIST"); error.code = "EEXIST"; throw error; }
      addDirectory(name, { mode: 0o40000 | (options.mode ?? 0o777), uid: 0n, gid: 0n });
      touchDirectory(posix.dirname(name)); events.push(`fs:mkdir:${name}`);
    },
    openSync(name, flags, mode = 0o666) {
      name = normalize(name); let node = nodes.get(name); const existed = node !== undefined;
      if (!node && (flags & fs.constants.O_CREAT)) {
        node = addFile(name, { data: Buffer.alloc(0), mode: 0o100000 | mode, uid: 0n, gid: 0n });
        touchDirectory(posix.dirname(name));
      } else if (!node) resolveNode(name);
      if ((flags & fs.constants.O_EXCL) && (flags & fs.constants.O_CREAT) && existed) {
        const error = new Error("EEXIST"); error.code = "EEXIST"; throw error;
      }
      const fd = nextFd++; descriptors.set(fd, { fd, node, path: name, flags, closed: false });
      events.push(`fs:open:${name}`); return fd;
    },
    closeSync(fd) {
      const descriptor = fdNode(fd); descriptor.closed = true; events.push(`fs:close:${descriptor.path}`);
      if (faults.closeFailure?.includes(descriptor.path)) throw new Error("PROTOCOL_SIMULATION close failure");
    },
    readSync(fd, target, offset, length, position) {
      const descriptor = fdNode(fd); const node = descriptor.node;
      if (position >= Number(node.stat.size)) return 0;
      const count = Math.min(length, Number(node.stat.size) - position);
      if (node.data) node.data.copy(target, offset, position, position + count); else target.fill(0, offset, offset + count);
      bufferTags.set(target, node); return count;
    },
    writeSync(fd, source, offset, length, position) {
      const descriptor = fdNode(fd); const node = descriptor.node;
      if (faults.zeroWrite) return 0;
      const count = Math.min(length, faults.shortWrite ?? length); const required = position + count;
      if (!node.data || node.data.length < required) {
        const next = Buffer.alloc(required); node.data?.copy(next); node.data = next;
      }
      source.copy(node.data, position, offset, offset + count); node.stat.size = BigInt(node.data.length);
      return count;
    },
    fsyncSync(fd) { events.push(`fs:fsync:${fdNode(fd).path}`); if (faults.fsyncFailure) throw new Error("fsync"); },
    readFileSync(name, encoding) {
      name = normalize(name);
      const pid = faults.pid ?? 4242;
      if (name.startsWith(`/proc/${pid}/`)) events.push(`proc:read:${name}`);
      const invalidBeforeTerm = faults.procInvalidBeforeTerm && faults.stdinEnded && faults.signalPhase === undefined;
      const invalidBeforeKill = faults.procInvalidBeforeKill && faults.signalPhase === "SIGTERM";
      if ((invalidBeforeTerm || invalidBeforeKill) && name === `/proc/${pid}/stat`) {
        if (faults.procDisappears) { const error = new Error("ENOENT"); error.code = "ENOENT"; throw error; }
      }
      if (name === `/proc/${pid}/stat`) {
        const fields = Array(20).fill("0"); fields[0] = faults.procZombie ? "Z" : "S"; fields[1] = "1";
        fields[2] = String(faults.procPgrp ?? pid); fields[3] = String(faults.procSession ?? pid);
        fields[19] = invalidBeforeTerm || invalidBeforeKill ? "999999" : faults.startTicks ?? "123456";
        const value = `${pid} (node) ${fields.join(" ")}\n`; return encoding ? value : Buffer.from(value);
      }
      if (name === `/proc/${pid}/status`) {
        const uid = faults.procUid ?? 1000; const gid = faults.procGid ?? 1000; const groups = faults.procGroups ?? "";
        const value = `Name:\tnode\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nGid:\t${gid}\t${gid}\t${gid}\t${gid}\nGroups:\t${groups}\nNoNewPrivs:\t${faults.noNewPrivs ?? 1}\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\n`;
        return encoding ? value : Buffer.from(value);
      }
      if (name === `/proc/${pid}/cmdline`) {
        faults.procProofCount = (faults.procProofCount ?? 0) + 1;
        const argv = faults.procArgv ?? [NODE, WORKER];
        return Buffer.from(`${argv.join("\0")}\0`);
      }
      const node = resolveNode(name); const bytes = node.data ? Buffer.from(node.data) : Buffer.alloc(Number(node.stat.size));
      return encoding ? bytes.toString(encoding) : bytes;
    },
  };
  return { api, nodes, descriptors, bufferTags, installArchives };
}

function createCrypto(vfs) {
  return {
    createHash(algorithm) {
      const chunks = []; let tagged;
      return {
        update(value) { if (Buffer.isBuffer(value) && vfs.bufferTags.has(value)) tagged = vfs.bufferTags.get(value); chunks.push(Buffer.from(value)); return this; },
        digest(encoding) {
          const override = tagged?.digest?.[algorithm];
          if (override) return encoding === "hex" ? override : Buffer.from(override, "hex");
          return crypto.createHash(algorithm).update(Buffer.concat(chunks)).digest(encoding);
        },
      };
    },
  };
}

function createChild({ workerEnvelope, faults, events, installArchives, childState }) {
  const child = new EventEmitter(); child.pid = faults.missingChildPid ? undefined : faults.pid ?? 4242;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.once("close", () => { childState.closed = true; faults.childClosed = true; events.push("child:close:observed"); });
  child.stdout.once("end", () => { childState.stdoutEnded = true; });
  child.stdout.once("close", () => { childState.stdoutClosed = true; });
  child.stderr.once("end", () => { childState.stderrEnded = true; });
  child.stderr.once("close", () => { childState.stderrClosed = true; });
  child.stdin.once("finish", () => { childState.stdinFinished = true; });
  child.stdin.once("close", () => { childState.stdinClosed = true; });
  const output = Buffer.isBuffer(workerEnvelope) ? Buffer.from(workerEnvelope) : compactBytes(workerEnvelope);
  let ended = false;
  child.stdin.end = (transport) => {
    events.push("child:stdin:end"); faults.stdinEnded = true; child.stdin.transport = transport && Buffer.from(transport);
    if (faults.stdinThrow) throw new Error("PROTOCOL_SIMULATION stdin throw");
    if (ended) return; ended = true;
    globalThis.queueMicrotask(() => {
      if (faults.workerNeverCloses) {
        if (!faults.stdinNoFinish) child.stdin.emit("finish");
        if (!faults.stdinNoClose) child.stdin.emit("close");
        return;
      }
      installArchives();
      if (faults.stdinError) child.stdin.emit("error", new Error("stdin"));
      if (!faults.stdinNoFinish) child.stdin.emit("finish");
      if (!faults.stdinNoClose) child.stdin.emit("close");
      if (faults.childError) child.emit("error", new Error("child"));
      if (!faults.stdoutNoData) child.stdout.emit("data", faults.stdoutBytes ?? output);
      if (faults.stdoutError) child.stdout.emit("error", new Error("stdout"));
      if (!faults.stdoutNoEnd) child.stdout.emit("end");
      if (!faults.stdoutNoClose) child.stdout.emit("close");
      if (faults.stderrBytes) child.stderr.emit("data", faults.stderrBytes);
      if (faults.stderrError) child.stderr.emit("error", new Error("stderr"));
      if (!faults.stderrNoEnd) child.stderr.emit("end");
      if (!faults.stderrNoClose) child.stderr.emit("close");
      if (!faults.childNoClose) child.emit("close", faults.childExitCode ?? 0, faults.childSignal ?? null);
      faults.afterChildClose = true;
      if (faults.abortAfterClose) faults.abortController.abort();
    });
  };
  child.settleFromSignal = (signal) => {
    if (!faults.signalCloseWithoutDrains) {
      child.stdout.emit("end"); child.stdout.emit("close"); child.stderr.emit("end"); child.stderr.emit("close");
    }
    child.emit("close", null, signal);
  };
  if (faults.childErrorBeforeListeners) {
    globalThis.queueMicrotask(() => child.emit("error", new Error("child before identity")));
  }
  return child;
}

function daemonIdentity(input, faults) {
  const parent = input.parent; const nonce = input.nonce; const pid = faults.daemonPid ?? 31337;
  return {
    purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    root: parent, nonce, pid, startTicks: "7654321", daemonId: "PROTOCOL_SIMULATION_DAEMON", version: "28.0.4",
    configSha256: "7".repeat(64), argvSha256: "8".repeat(64), socket: `${parent}/endpoint/docker.sock`,
    endpoint: `unix://${parent}/endpoint/docker.sock`, dockerConfig: `${parent}/client`, buildxConfig: `${parent}/client/buildx`,
    outputDirectory: `${parent}/client/output`, contextName: `aw-cold-${nonce}`,
    deadlineAtMs: Date.now() + (faults.daemonDeadlineOffsetMs ?? 300_000),
    dataRoot: `${parent}/infra/data`, execRoot: `${parent}/infra/exec`, containerdAddress: input.principal.containerdAddress,
    containersNamespace: `awcold-${nonce}`, pluginsNamespace: `plugins.awcold-${nonce}`,
    rootActor: { uid: 0, gid: 0 }, clientActor: { uid: 1000, gid: 1000 },
    socketProof: { dev: "1", ino: "50", uid: 0, gid: 1000, mode: 0o660 },
    socketDirectoryProof: { dev: "1", ino: "49", uid: 0, gid: 1000, mode: 0o710 },
  };
}

/**
 * Private copy/paste harness for tests. It mocks imported boundaries only; no controller helper is replaced.
 * `faults` supports stream close/error toggles, proc identity fields, descriptor close/replacement,
 * namespace/receipt mutation, daemon start/inventory/stop rejection, and time/exit variations.
 */
function physical({ directory = false, size = 0 } = {}) {
  return { dev: "1", ino: directory ? "10" : "11", mode: directory ? 0o40700 : 0o100600,
    nlink: directory ? 2 : 1, size, uid: 1000, gid: 1000, mtimeNs: "20", ctimeNs: "21", birthtimeNs: "19" };
}

function encoded(bytes = Buffer.alloc(0)) {
  return { encoding: "base64", bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString("base64") };
}

function setBuilderPlatforms(result, platforms) {
  const parsed = result.profiles.builder.parsed;
  const raw = Buffer.from(JSON.stringify({ Driver: parsed.driver, Nodes: [{ Name: parsed.nodeName,
    Endpoint: parsed.endpoint, Status: parsed.status, Buildkit: parsed.buildkit, Platforms: platforms }] }));
  result.builder.platforms = platforms;
  parsed.platforms = platforms;
  result.profiles.builder.stdout = encoded(raw);
}

function genuineResultFixture(input) {
  const lease = input.lease;
  const contract = candidateContractV2(openCandidateLockV2(fs.readFileSync(CANDIDATE_LOCK)));
  let offset = 0;
  const entries = contract.contextEntries.map((entry, ordinal) => {
    const headerOffset = offset; const dataOffset = headerOffset + 512; const size = entry.type === "directory" ? 0 : entry.size;
    offset = dataOffset + Math.ceil(size / 512) * 512;
    return { ordinal, headerOffset, dataOffset, path: entry.path, type: entry.type, mode: entry.mode,
      uid: entry.uid, gid: entry.gid, mtime: entry.mtime, size,
      ...(entry.type === "file" ? { sha256: entry.sha256 } : {}) };
  });
  const empty = encoded();
  const command = (args) => ({ binary: "/usr/bin/docker", args });
  const contextParsed = { name: lease.contextName, endpoint: lease.endpoint };
  const versionParsed = { serverVersion: "28.0.4" };
  const infoParsed = { daemonId: lease.daemonId, dataRoot: lease.dataRoot, os: "linux", arch: "x86_64", driver: "overlay2",
    containerdAddress: lease.containerdAddress, namespaces: { containers: lease.containersNamespace, plugins: lease.pluginsNamespace } };
  const builderParsed = { name: null, nodeName: lease.contextName, driver: "docker", endpoint: lease.endpoint,
    status: "running", buildkit: "v0.24.0", platforms: "linux/amd64", representation: "FORMAT_ONLY_JSON" };
  const profile = (commandValue, representation, parsed) => ({ command: commandValue, representation, parsed,
    stdout: { ...empty }, stderr: { ...empty } });
  const baseArchive = { bytes: 1024, sha256: "d".repeat(64) };
  const candidateArchive = { bytes: 2048, sha256: "e".repeat(64) };
  const baseConfigId = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
  const candidateConfigId = imageId("f");
  const buildWindow = { startedAtMs: 100, completedAtMs: 200 };
  const pairProof = {
    scope: "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW", authority: "NOT_AUTHORIZED",
    profile: "POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1",
    base: { archive: { ...baseArchive }, configId: baseConfigId, layers: 10 },
    candidate: { archive: { ...candidateArchive }, configId: candidateConfigId, layers: 12 },
    inheritedLayers: 10, addedLayers: 2, configProfile: "STRICT_INHERITED_CONFIG_V2",
    delta: { scope: "CONDITIONAL_ON_AUTHENTICATED_OCI", authority: "NOT_AUTHORIZED", baseMembers: 10,
      candidateMembers: 22, replaced: ["usr/local/bin/gosu"], addedFiles: [
        "usr/share/licenses/auto-world-gosu/build-info.txt", "usr/share/licenses/auto-world-gosu/derivative-manifest.json",
        "usr/share/licenses/auto-world-gosu/go-LICENSE", "usr/share/licenses/auto-world-gosu/go-PATENTS",
        "usr/share/licenses/auto-world-gosu/gosu-LICENSE", "usr/share/licenses/auto-world-gosu/moby-user-LICENSE",
        "usr/share/licenses/auto-world-gosu/module-closure.json", "usr/share/licenses/auto-world-gosu/notices.json",
        "usr/share/licenses/auto-world-gosu/sbom.cdx.json", "usr/share/licenses/auto-world-gosu/version.txt",
        "usr/share/licenses/auto-world-gosu/x-sys-LICENSE", "usr/share/licenses/auto-world-gosu/x-sys-PATENTS",
      ], addedDirectories: [], mtimeChangedDirectories: [] },
  };
  return {
    state: "IMAGE_PAIR_RETENTION_SNAPSHOT_OBSERVED_REVIEW_PENDING", authority: "NOT_AUTHORIZED", image: "BUILT_UNVALIDATED",
    candidateAdmission: "NOT_AUTHORIZED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED",
    nonce: input.nonce, lease: { daemonId: lease.daemonId, pid: lease.pid, startTicks: lease.startTicks },
    builder: { driver: "docker", endpoint: lease.endpoint, platforms: "linux/amd64", representation: "FORMAT_ONLY_JSON" },
    profiles: { stage: "PRE_CONTEXT",
      context: profile(command(["--config", lease.dockerConfig, "--context", lease.contextName, "context", "inspect", lease.contextName]), "JSON", contextParsed),
      version: profile(command(["--config", lease.dockerConfig, "--context", lease.contextName, "version", "--format", "{{json .}}"]), "JSON", versionParsed),
      info: profile(command(["--config", lease.dockerConfig, "--context", lease.contextName, "info", "--format", "{{json .}}"]), "JSON", infoParsed),
      builder: profile(command(["--config", lease.dockerConfig, "--context", lease.contextName, "buildx", "inspect"]), "FORMAT_ONLY_JSON", builderParsed) },
    preflight: { acceptance: { bytes: 11_744, sha256: "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3" },
      source: { head: "582fb97e88cf5a498e6ae34ec76eb5736ada2a47", main: "e4fa47cbe66758a5b56f5347c2c27e61bdae1ed0",
        tree: "7292e98e7ee23e45ebccff075577af41f271dbf9" },
      context: { bytes: 1_986_560, sha256: "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb" } },
    context: { bytes: 1_986_560, sha256: "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb",
      entries, physical: physical({ size: 1_986_560 }) },
    buildWindow,
    pairProof,
    retention: { state: "SEALED_SNAPSHOT_REVIEW_PENDING", preservation: "FUTURE_CONTROLLER_REQUIRED", authority: "NOT_AUTHORIZED",
      admission: "NOT_AUTHORIZED", directory: physical({ directory: true }), buildWindow: { ...buildWindow },
      base: { name: "base-image.tar", archive: { ...baseArchive }, configId: baseConfigId, physical: physical({ size: baseArchive.bytes }) },
      candidate: { name: "candidate-image.tar", archive: { ...candidateArchive }, configId: candidateConfigId,
        physical: { ...physical({ size: candidateArchive.bytes }), ino: "12" } } },
    dates: null,
  };
}


function createControllerBoundaryHarness({ sourceText, control, input, workerEnvelope, faults = {} }) {
  if (typeof sourceText !== "string" || !control || !input || !workerEnvelope) throw new TypeError("boundary fixture required");
  const events = []; const fsState = createVirtualFs({ control, input, workerEnvelope, faults, events });
  const childState = { children: [], signals: [] }; const daemonState = { starts: 0, identities: [], inventories: [], stops: [] };
  const sandboxProcess = {
    platform: "linux", version: "v22.23.2", execPath: NODE, env: Object.freeze({}), argv: [],
    getuid: () => 0, geteuid: () => 0, getgid: () => 0, getegid: () => 0, getgroups: () => [0],
    kill(pid, signal) {
      childState.signals.push({ pid, signal }); events.push(`process:kill:${signal}`); faults.signalPhase = signal;
      if (faults.closeOnSignal === signal) childState.children.at(-1)?.settleFromSignal(signal);
    },
  };
  const clockBase = Date.now(); let clockCalls = 0; let lastClock = clockBase;
  class BoundaryDate extends Date {
    static now() {
      clockCalls += 1;
      const rollbackAfterTransport = faults.clockRollbackAfterTransport && faults.stdinEnded
        && !faults.workerTimerScheduled && !faults.clockRollbackInjected;
      const rollbackAfterProof = faults.clockRollbackAfterProof && (faults.procProofCount ?? 0) >= 2
        && !faults.stdinEnded && !faults.clockRollbackInjected;
      const rollbackAfterRace = faults.clockRollbackAfterRace && (faults.workerTimerFired || faults.childClosed)
        && !faults.clockRollbackInjected;
      const rollback = faults.clockRollbackAt === clockCalls || rollbackAfterTransport || rollbackAfterProof || rollbackAfterRace;
      if (rollbackAfterTransport || rollbackAfterProof || rollbackAfterRace) faults.clockRollbackInjected = true;
      const value = faults.afterChildClose && faults.clockJumpAfterCloseMs
        ? clockBase + faults.clockJumpAfterCloseMs : rollback ? lastClock - 1 : clockBase + clockCalls;
      lastClock = value; events.push(`clock:${value}`); return value;
    }
  }
  const boundarySetTimeout = faults.abortInsteadOfTimeout ? (callback) => {
    const handle = { cancelled: false };
    globalThis.queueMicrotask(() => { faults.abortController.abort(); events.push("signal:abort:worker-run"); });
    globalThis.setImmediate(() => {
      if (!handle.cancelled) { faults.workerTimerFired = true; events.push("timer:fired"); callback(); }
    });
    return handle;
  } : faults.workerTimeout ? (callback) => {
    faults.workerTimerScheduled = true;
    globalThis.queueMicrotask(() => { faults.workerTimerFired = true; callback(); });
    return 1;
  } : globalThis.setTimeout;
  const boundaryClearTimeout = faults.abortInsteadOfTimeout ? (handle) => {
    handle.cancelled = true; faults.workerTimerCleared = true; events.push("timer:clear");
  } : faults.workerTimeout ? () => { faults.workerTimerCleared = true; events.push("timer:clear"); }
    : globalThis.clearTimeout;
  const context = vm.createContext({ Buffer, TextDecoder: globalThis.TextDecoder, TextEncoder: globalThis.TextEncoder, URL,
    AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal, structuredClone: globalThis.structuredClone,
    setTimeout: boundarySetTimeout, clearTimeout: boundaryClearTimeout, queueMicrotask: globalThis.queueMicrotask,
    Date: BoundaryDate, process: sandboxProcess });
  const synthetic = (identifier, values) => new vm.SyntheticModule(Object.keys(values), function initialize() {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier });
  const identity = daemonIdentity(input, faults);
  const linker = async (specifier) => {
    events.push(`import:${specifier}`);
    if (specifier === "node:fs") return synthetic("boundary:fs", { ...fsState.api,
      readdirSync: (...args) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(fsState.api.readdirSync(...args)))})`, context) });
    if (specifier === "node:crypto") return synthetic("boundary:crypto", createCrypto(fsState));
    if (specifier === "node:path") return synthetic("boundary:path", { default: posix });
    if (specifier === "node:url") return synthetic("boundary:url", { fileURLToPath: (url) => new URL(url).pathname });
    if (specifier === "node:child_process") return synthetic("boundary:child_process", { spawn(command, argv, options) {
      events.push("child:spawn"); childState.command = command; childState.argv = argv; childState.options = options;
      if (faults.spawnThrow) throw new Error("PROTOCOL_SIMULATION spawn failure");
      const child = createChild({ workerEnvelope, faults, events, installArchives: fsState.installArchives, childState });
      childState.children.push(child); return child;
    } });
    if (specifier === "node:events") return synthetic("boundary:events", { addAbortListener: (...args) => {
      events.push("node:events:addAbortListener"); faults.addAbortListenerCalls = (faults.addAbortListenerCalls ?? 0) + 1;
      if (faults.addAbortListenerThrow) throw new Error("PROTOCOL_SIMULATION addAbortListener failure");
      return Reflect.apply(addAbortListener, undefined, args);
    } });
    if (specifier === "node:timers/promises") return synthetic("boundary:timers", { setTimeout: async () => {
      events.push("timer:delay");
      if (faults.abortDuringLeaderProof && !faults.leaderAbortInjected && (faults.procProofCount ?? 0) === 1) {
        faults.leaderAbortInjected = true; faults.abortController.abort(); events.push("signal:abort:during-leader-proof");
      }
      if (faults.delayReject) throw new Error("delay");
    } });
    if (specifier === "./gosu-retained-pair-worker-v1.mjs") return synthetic("boundary:worker", {
      validateGosuRetainedPairSourceClosureV1(value) {
        events.push("worker:source-closure");
        if (faults.oversizedSourceClosureBytes) return vm.runInContext(
          `({ kind: "PROTOCOL_SIMULATION_OVERSIZED_SOURCE_CLOSURE", padding: "x".repeat(${faults.oversizedSourceClosureBytes}) })`, context);
        return value;
      },
    });
    if (specifier === "./gosu-derivative-image-daemon-v2.mjs") return synthetic("boundary:daemon", {
      async startGosuDerivativeImageDaemonLease(argument) {
        daemonState.starts += 1; daemonState.argument = argument; events.push("daemon:start");
        if (faults.daemonStartReject) throw new Error("daemon start");
        const lease = vm.runInContext("({})", context); lease.identity = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(identity))})`, context);
        lease.verifyIdentity = async () => {
          daemonState.identities.push(identity.daemonId); events.push("daemon:identity");
          return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({ state: "VERIFIED", purpose: identity.purpose,
            authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", daemonId: identity.daemonId, endpoint: identity.endpoint,
            pid: identity.pid, principalImageCount: 2, principalSnapshotSha256: SNAPSHOT }))})`, context);
        };
        lease.verifyInventory = async (mode, subjects) => {
          daemonState.inventories.push({ mode, subjects }); events.push(`daemon:inventory:${mode}`);
          if (faults.inventoryReject === mode) throw new Error("inventory");
          const raw = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({ state: `VERIFIED_${mode}`,
            purpose: identity.purpose, authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", daemonId: identity.daemonId,
            endpoint: identity.endpoint, pid: identity.pid, principalImageCount: 2, principalSnapshotSha256: SNAPSHOT,
            images: mode === "EMPTY" ? 0 : mode === "BASE_ONLY" ? 1 : 2, containers: 0, volumes: 0, subjects }))})`, context);
          if (mode === "BASE_AND_CANDIDATE" && faults.inventorySubjects) {
            raw.subjects = faults.inventorySubjects({ context, subjects });
          }
          return raw;
        };
        lease.stop = async ({ requireMode }) => {
          daemonState.stops.push(requireMode); events.push(`daemon:stop:${requireMode}`);
          if (faults.stopReject) throw new Error("stop");
          return vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify({ state: "STOPPED", purpose: identity.purpose,
            authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", daemonId: identity.daemonId, endpoint: identity.endpoint,
            pid: identity.pid, principalImageCount: 2, principalSnapshotSha256: SNAPSHOT, isolatedFinalInventory: requireMode,
            processGone: true, socketGone: true, pidFileGone: true, privateState: "RETAINED" }))})`, context);
        };
        daemonState.lease = lease; return lease;
      },
    });
    if (specifier === "node:util") {
      const namespace = await import("node:util");
      return synthetic("boundary:util", { isDeepStrictEqual: namespace.isDeepStrictEqual, TextDecoder: namespace.TextDecoder, types: namespace.types });
    }
    throw new Error(`unexpected controller import: ${specifier}`);
  };
  const module = new vm.SourceTextModule(sourceText, { context, identifier: CONTROLLER,
    initializeImportMeta(meta) { meta.url = `file://${CONTROLLER}`; } });
  return { context, linker, module, events, fsState, childState, daemonState,
    controlBytes: prettyBytes(control), inputBytes: compactBytes(input), identity };
}

async function controllerBoundaryScenario(faults = {}, mutateResult) {
  const control = controlFixture(); const input = controllerInputFixture(control); const workerEnvelope = {};
  const harness = createControllerBoundaryHarness({ sourceText: fs.readFileSync(SOURCE, "utf8"), control, input, workerEnvelope, faults });
  const result = genuineResultFixture({ nonce: input.nonce, lease: harness.identity }); const startedAtMs = Date.now();
  const buildWindow = { startedAtMs, completedAtMs: startedAtMs + 1 };
  result.buildWindow = { ...buildWindow }; result.retention.buildWindow = { ...buildWindow };
  mutateResult?.(result);
  Object.assign(workerEnvelope, { kind: "GOSU_RETAINED_PAIR_WORKER_RESULT_V1", state: "SUCCEEDED",
    scope: "GENUINE_DEFAULT_PRODUCER_ONCE", result });
  await harness.module.link(harness.linker);
  let removeDescriptor;
  const eventTargetPrototype = Object.getPrototypeOf(globalThis.AbortSignal.prototype);
  if (faults.removeAbortListenerThrow) {
    removeDescriptor = Object.getOwnPropertyDescriptor(eventTargetPrototype, "removeEventListener");
    Object.defineProperty(eventTargetPrototype, "removeEventListener", { ...removeDescriptor, value() {
      faults.removeAbortListenerCalls = (faults.removeAbortListenerCalls ?? 0) + 1;
      throw new Error("PROTOCOL_SIMULATION removeEventListener failure");
    } });
  }
  try { await harness.module.evaluate(); }
  finally {
    if (removeDescriptor) Object.defineProperty(eventTargetPrototype, "removeEventListener", removeDescriptor);
  }
  const api = harness.module.namespace;
  const capability = api.loadGosuRetainedPairControllerControlV1(harness.controlBytes, sha256(harness.controlBytes));
  return { api, capability, harness };
}


if (!process.execArgv.includes("--experimental-vm-modules") && process.env[SENTINEL] !== "1") {
  test("controller v1 mandatory VM suite completes through the pinned Node bootstrap", () => {
    executablePin();
    const result = childProcess.spawnSync(process.execPath, [
      "--experimental-vm-modules", "--test", "--test-reporter=tap", SELF,
    ], { encoding: "utf8", env: childEnvironment(), timeout: 120_000, maxBuffer: 16 * 1024 ** 2 });
    const transcript = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.signal, null, transcript);
    assert.equal(result.status, 0, transcript);
    for (const name of REQUIRED_CASES) assert.match(result.stdout, new RegExp(`ok \\d+ - ${name}`, "u"), transcript);
    assert.match(result.stdout, new RegExp(`# pass ${REQUIRED_TEST_COUNT}(?:\\r?\\n|$)`, "u"), transcript);
    assert.match(result.stdout, /# fail 0(?:\r?\n|$)/u, transcript);
    assert.match(result.stdout, /# skipped 0(?:\r?\n|$)/u, transcript);
    assert.match(result.stdout, /# cancelled 0(?:\r?\n|$)/u, transcript);
  });
} else {
  test("controller v1 exports exactly the four frozen public interfaces", async () => {
    const api = await import(SOURCE);
    assert.deepEqual(Object.keys(api).sort(), [
      "gosuRetainedPairControllerV1Contract",
      "gosuRetainedPairControllerV1FailureDiagnostic",
      "loadGosuRetainedPairControllerControlV1",
      "runGosuRetainedPairControllerV1",
    ]);
  });

  test("controller v1 publishes the exact deeply frozen literal contract", async () => {
    const { gosuRetainedPairControllerV1Contract: contract } = await import(SOURCE);
    assert.deepEqual(contract, {
      kind: "GOSU_RETAINED_PAIR_CONTROLLER_V1_CONTRACT",
      kinds: {
        input: "GOSU_RETAINED_PAIR_CONTROLLER_INPUT_V1",
        control: "GOSU_RETAINED_PAIR_CONTROLLER_CONTROL_V1",
        receipt: "GOSU_RETAINED_PAIR_PRESERVATION_RECEIPT_V1",
        ack: "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1",
        failure: "GOSU_RETAINED_PAIR_CONTROLLER_FAILURE_V1",
      },
      node: { path: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node", version: "v22.23.2",
        bytes: 124_836_408, sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327" },
      setpriv: { path: "/usr/bin/setpriv", version: "setpriv from util-linux 2.39.3", bytes: 39_304,
        sha256: "62ec0120791f3afcfb689fed52384ec2b0accc6e118a6b9a1d6fcfa7450aaf37", uid: 0, gid: 0, mode: 493, nlink: 1 },
      environment: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: "LEASE_DOCKER_CONFIG" },
      caps: { inputBytes: 65_536, controlBytes: 16_777_216, transportBytes: 16_777_216,
        stdoutBytes: 8_388_608, stderrBytes: 0, commitRawBytes: 1_048_576 },
      deadlinePolicy: { workerCutoffBeforeDaemonMs: 90_000, termMs: 10_000, killAndDrainMs: 15_000,
        bookkeepingMs: 5_000, stopEntryBeforeDaemonMs: 60_000, postStopMs: 180_000, controllerAfterDaemonMs: 160_000 },
      receiptBasename: "retained-pair-receipt.json",
      phases: ["INPUT", "CONTROL", "SOURCE", "PREFLIGHT", "DAEMON_START", "WORKER_START", "WORKER_RUN", "INVENTORY", "STOP", "PRESERVE", "ACK", "CLEANUP"],
      errorCodes: [
        "gosu_retained_pair_controller_input_invalid", "gosu_retained_pair_controller_control_invalid",
        "gosu_retained_pair_controller_source_invalid", "gosu_retained_pair_controller_acceptance_invalid",
        "gosu_retained_pair_controller_tool_invalid", "gosu_retained_pair_controller_daemon_start_failed",
        "gosu_retained_pair_controller_worker_spawn_failed", "gosu_retained_pair_controller_worker_identity_invalid",
        "gosu_retained_pair_controller_worker_timeout", "gosu_retained_pair_controller_worker_result_invalid",
        "gosu_retained_pair_controller_worker_cleanup_uncertain", "gosu_retained_pair_controller_daemon_inventory_invalid",
        "gosu_retained_pair_controller_daemon_cleanup_uncertain", "gosu_retained_pair_controller_preservation_failed",
        "gosu_retained_pair_controller_cleanup_uncertain",
      ],
    });
    const queue = [contract];
    while (queue.length) {
      const value = queue.pop();
      assert.equal(Object.isFrozen(value), true);
      for (const nested of Object.values(value)) if (nested && typeof nested === "object") queue.push(nested);
    }
  });

  test("controller v1 loads only the exact canonical reviewed control capability", async () => {
    const { loadGosuRetainedPairControllerControlV1: load } = await import(SOURCE);
    const value = controlFixture(); const bytes = pretty(value); const expectedSha256 = sha256(bytes);
    const capability = load(bytes, expectedSha256); bytes.fill(0); value.principal.id = "changed";
    assert.equal(Object.isFrozen(capability), true); assert.deepEqual(Object.keys(capability), []);
    assert.doesNotMatch(JSON.stringify(capability), /commitRaw|sourceManifest|principal-engine/u);
  });

  test("controller v1 rejects malformed controls before any execution authority exists", async () => {
    const { loadGosuRetainedPairControllerControlV1: load } = await import(SOURCE);
    const value = controlFixture(); const bytes = pretty(value);
    assert.throws(() => load(bytes, "0".repeat(64)), /gosu_retained_pair_controller_control_invalid/u);
    assert.throws(() => load(Buffer.from(JSON.stringify(value)), sha256(Buffer.from(JSON.stringify(value)))),
      /gosu_retained_pair_controller_control_invalid/u);
    const expanded = { ...value, authority: "AUTHORIZED" }; const expandedBytes = pretty(expanded);
    assert.throws(() => load(expandedBytes, sha256(expandedBytes)), /gosu_retained_pair_controller_control_invalid/u);
    assert.throws(() => load(new Proxy(bytes, {}), sha256(bytes)), /gosu_retained_pair_controller_control_invalid/u);
  });

  test("controller v1 diagnostics close real loader failures without private text", async () => {
    const api = await import(SOURCE); let failure;
    try { api.loadGosuRetainedPairControllerControlV1(Buffer.from("private path C:/secret\n"), "0".repeat(64)); }
    catch (error) { failure = error; }
    const diagnostic = api.gosuRetainedPairControllerV1FailureDiagnostic(failure);
    assert.deepEqual(diagnostic, { kind: "GOSU_RETAINED_PAIR_CONTROLLER_FAILURE_V1", state: "FAILED",
      code: "gosu_retained_pair_controller_control_invalid", phase: "CONTROL", cleanup: "NOT_STARTED",
      authority: "NOT_AUTHORIZED", preservation: "NOT_ESTABLISHED", dates: null });
    assert.equal(Object.isFrozen(diagnostic), true); assert.doesNotMatch(JSON.stringify(diagnostic), /private|secret|path/u);
  });

  test("controller v1 failure diagnostics never invoke getters or inspect proxies", async () => {
    const { gosuRetainedPairControllerV1FailureDiagnostic: diagnostic } = await import(SOURCE);
    let reads = 0; const hostile = {};
    for (const key of ["code", "phase", "cleanup"]) Object.defineProperty(hostile, key, {
      get() { reads += 1; throw new Error("private"); },
    });
    const fromGetter = diagnostic(hostile);
    const fromProxy = diagnostic(new Proxy({}, { getOwnPropertyDescriptor() { reads += 1; throw new Error("private"); } }));
    assert.equal(reads, 0);
    for (const value of [fromGetter, fromProxy]) {
      assert.deepEqual(value, { kind: "GOSU_RETAINED_PAIR_CONTROLLER_FAILURE_V1", state: "FAILED",
        code: "gosu_retained_pair_controller_input_invalid", phase: "INPUT", cleanup: "UNCERTAIN",
        authority: "NOT_AUTHORIZED", preservation: "NOT_ESTABLISHED", dates: null });
    }
  });

  test("controller v1 source contains no broad cleanup or archive publication primitive", () => {
    const source = fs.readFileSync(SOURCE, "utf8");
    assert.doesNotMatch(source, /\b(?:prune|rmSync|rmdirSync|unlinkSync|killall|pkill)\b/u);
    assert.doesNotMatch(source, /\bdocker\s+(?:load|tag|push|run|rm)\b|\boras\b|ghcr\.io/u);
  });

  test("controller v1 public loader rejects a Buffer proxy without invoking its traps", async () => {
    const { loadGosuRetainedPairControllerControlV1: load } = await import(SOURCE);
    const bytes = pretty(controlFixture()); const digest = sha256(bytes); let reads = 0;
    const hostile = new Proxy(bytes, {
      get() { reads += 1; throw new Error("private buffer proxy"); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error("private buffer proxy"); },
      getPrototypeOf() { reads += 1; throw new Error("private buffer proxy"); },
    });
    assert.throws(() => load(hostile, digest), /gosu_retained_pair_controller_control_invalid/u);
    assert.equal(reads, 0);
  });

  test("controller v1 public loader rejects accessor-bearing Buffers without invoking accessors", async () => {
    const { loadGosuRetainedPairControllerControlV1: load } = await import(SOURCE);
    for (const property of ["length", "valueOf"]) {
      const bytes = pretty(controlFixture()); const digest = sha256(bytes); let reads = 0;
      Object.defineProperty(bytes, property, { configurable: true,
        get() { reads += 1; throw new Error(`private Buffer ${property}`); } });
      assert.throws(() => load(bytes, digest), /gosu_retained_pair_controller_control_invalid/u);
      assert.equal(reads, 0, property);
    }
  });

  test("controller v1 public run rejects an input Buffer proxy without invoking its traps", async () => {
    const { harness, inputBytes, capability } = await loadedProtocolScenario();
    let reads = 0; const hostile = new Proxy(inputBytes, {
      get() { reads += 1; throw new Error("private input buffer proxy"); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error("private input buffer proxy"); },
      getPrototypeOf() { reads += 1; throw new Error("private input buffer proxy"); },
    });
    await assert.rejects(harness.api.runGosuRetainedPairControllerV1(hostile, capability),
      /gosu_retained_pair_controller_input_invalid/u);
    assert.equal(reads, 0);
  });

  test("controller v1 dense array validator rejects a proxy without invoking its traps", async () => {
    const harness = await controllerProtocolVm(); let reads = 0;
    const hostile = new Proxy(harness.realm([]), {
      get() { reads += 1; throw new Error("private array proxy"); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error("private array proxy"); },
      getPrototypeOf() { reads += 1; throw new Error("private array proxy"); },
    });
    assert.equal(harness.api.TEST_ONLY_dense(hostile), false);
    assert.equal(reads, 0);
  });

  test("controller v1 public run rejects an options proxy without invoking its traps", async () => {
    const { harness, inputBytes, capability } = await loadedProtocolScenario(); let reads = 0;
    const hostile = new Proxy(harness.realm({}), {
      get() { reads += 1; throw new Error("private options proxy"); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error("private options proxy"); },
      getPrototypeOf() { reads += 1; throw new Error("private options proxy"); },
    });
    await assert.rejects(harness.api.runGosuRetainedPairControllerV1(inputBytes, capability, hostile),
      /gosu_retained_pair_controller_input_invalid/u);
    assert.equal(reads, 0);
  });

  test("controller v1 public run rejects an AbortSignal proxy without invoking its traps", async () => {
    const { harness, inputBytes, capability } = await loadedProtocolScenario();
    let reads = 0; const signal = new Proxy(new globalThis.AbortController().signal, {
      get() { reads += 1; throw new Error("private signal proxy"); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error("private signal proxy"); },
      getPrototypeOf() { reads += 1; throw new Error("private signal proxy"); },
    });
    const options = harness.realm({}); options.signal = signal;
    await assert.rejects(harness.api.runGosuRetainedPairControllerV1(inputBytes, capability, options),
      /gosu_retained_pair_controller_input_invalid/u);
    assert.equal(reads, 0);
  });

  test("controller v1 public run rejects hostile own AbortSignal surface before work", async (t) => {
    const variants = [
      { name: "own addEventListener", install(signal, observed) {
        Object.defineProperty(signal, "addEventListener", { configurable: true, value() {
          observed.count += 1; throw new Error("private addEventListener");
        } });
      } },
      { name: "own removeEventListener", install(signal, observed) {
        Object.defineProperty(signal, "removeEventListener", { configurable: true, value() {
          observed.count += 1; throw new Error("private removeEventListener");
        } });
      } },
      { name: "stateful own aborted getter", install(signal, observed) {
        Object.defineProperty(signal, "aborted", { configurable: true, get() {
          observed.count += 1;
          if (observed.count <= 2) return false;
          throw new Error("private aborted getter");
        } });
      } },
      { name: "surplus symbol", install(signal) {
        Object.defineProperty(signal, Symbol("private"), { configurable: true, value: "blocked" });
      } },
      { name: "surplus accessor", install(signal, observed) {
        Object.defineProperty(signal, "private", { configurable: true, get() {
          observed.count += 1; throw new Error("private signal accessor");
        } });
      } },
    ];
    for (const variant of variants) {
      await t.test(variant.name, async () => {
        const observed = { count: 0 }; const signal = new globalThis.AbortController().signal;
        variant.install(signal, observed);
        assert.equal(Object.getPrototypeOf(signal), globalThis.AbortSignal.prototype);
        const { api, capability, harness } = await controllerBoundaryScenario({ workerNeverCloses: true, workerTimeout: true });
        const options = vm.runInContext("({})", harness.context); options.signal = signal;
        let failure;
        try { await api.runGosuRetainedPairControllerV1(harness.inputBytes, capability, options); }
        catch (error) { failure = error; }
        assert.equal(observed.count, 0);
        const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(failure)));
        assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
          code: "gosu_retained_pair_controller_input_invalid", phase: "INPUT", cleanup: "NOT_STARTED" });
        assert.equal(harness.childState.children.length, 0);
        assert.equal(harness.daemonState.starts, 0);
        assert.deepEqual(harness.daemonState.stops, []);
        assert.equal(harness.events.includes("child:stdin:end"), false);
        assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
      });
    }
  });

  test("controller v1 public run closes nullish AbortSignal options before work", async (t) => {
    for (const signal of [null, undefined]) {
      await t.test(String(signal), async () => {
        const { api, capability, harness } = await controllerBoundaryScenario();
        const options = vm.runInContext("({})", harness.context); options.signal = signal;
        await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability, options), (error) => {
          const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
          assert.deepEqual({ name: error.name, code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
            name: "Error", code: "gosu_retained_pair_controller_input_invalid", phase: "INPUT", cleanup: "NOT_STARTED" });
          return true;
        });
        assert.equal(harness.daemonState.starts, 0);
        assert.equal(harness.childState.children.length, 0);
        assert.deepEqual(harness.daemonState.stops, []);
        assert.equal(harness.events.includes("child:stdin:end"), false);
      });
    }
  });

  test("controller v1 public run accepts supported native AbortSignal forms", async (t) => {
    const forms = [
      { name: "pending controller", signal: () => new globalThis.AbortController().signal, aborted: false },
      { name: "static already aborted", signal: () => globalThis.AbortSignal.abort("expected"), aborted: true },
      { name: "aborted controller", signal: () => {
        const controller = new globalThis.AbortController(); controller.abort("expected"); return controller.signal;
      }, aborted: true },
      { name: "timeout", signal: () => globalThis.AbortSignal.timeout(300_000), aborted: false },
      { name: "any pending", signal: () => globalThis.AbortSignal.any([new globalThis.AbortController().signal]), aborted: false },
      { name: "controller source used by any", signal: () => {
        const controller = new globalThis.AbortController(); const source = controller.signal;
        globalThis.AbortSignal.any([source]); return source;
      }, aborted: false },
    ];
    for (const form of forms) {
      await t.test(form.name, async () => {
        const { api, capability, harness } = await controllerBoundaryScenario();
        const options = vm.runInContext("({})", harness.context); options.signal = form.signal();
        if (form.aborted) {
          await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability, options), (error) => {
            const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
            assert.notEqual(diagnostic.code, "gosu_retained_pair_controller_input_invalid");
            assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
              code: "gosu_retained_pair_controller_worker_timeout", phase: "PREFLIGHT", cleanup: "NOT_STARTED" });
            return true;
          });
          assert.equal(harness.childState.children.length, 0);
          return;
        }
        const ack = await api.runGosuRetainedPairControllerV1(harness.inputBytes, capability, options);
        assert.equal(ack.kind, "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1");
        assert.deepEqual(harness.daemonState.stops, ["BASE_AND_CANDIDATE"]);
      });
    }
  });

  test("controller v1 public abort remains effective behind stopImmediatePropagation", async () => {
    const abortController = new globalThis.AbortController(); let priorListenerCalls = 0;
    abortController.signal.addEventListener("abort", (event) => {
      priorListenerCalls += 1; event.stopImmediatePropagation();
    });
    const faults = { abortController, abortInsteadOfTimeout: true, workerNeverCloses: true, closeOnSignal: "SIGTERM" };
    const { api, capability, harness } = await controllerBoundaryScenario(faults);
    const options = vm.runInContext("({})", harness.context); options.signal = abortController.signal;
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability, options), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: "CONFIRMED" });
      return true;
    });
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.equal(priorListenerCalls, 1);
    assert.equal(faults.workerTimerFired, undefined);
    assert.equal(faults.workerTimerCleared, true);
    assert.ok(harness.childState.children[0].stdin.transport?.length > 0);
    assert.deepEqual(harness.childState.signals, [{ pid: -4242, signal: "SIGTERM" }]);
    assert.equal(harness.childState.closed, true);
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
    assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
  });

  test("controller v1 public run contains abort listener boundary failures after proof", async (t) => {
    for (const boundary of ["INSTALL", "REMOVE"]) {
      await t.test(boundary.toLowerCase(), async () => {
        const faults = { workerNeverCloses: true, workerTimeout: boundary === "REMOVE", closeOnSignal: "SIGTERM",
          ...(boundary === "INSTALL" ? { addAbortListenerThrow: true } : { removeAbortListenerThrow: true }) };
        const { api, capability, harness } = await controllerBoundaryScenario(faults);
        const options = vm.runInContext("({})", harness.context);
        options.signal = new globalThis.AbortController().signal;
        await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability, options), (error) => {
          const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
          assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
            code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: "UNCERTAIN" });
          return true;
        });
        assert.equal(faults.addAbortListenerCalls, 1);
        assert.equal(faults.removeAbortListenerCalls ?? 0, boundary === "REMOVE" ? 1 : 0);
        assert.equal(faults.workerTimerCleared === true, boundary === "REMOVE");
        assert.ok(harness.childState.children[0].stdin.transport?.length > 0);
        assert.deepEqual(harness.childState.signals, [{ pid: -4242, signal: "SIGTERM" }]);
        assert.deepEqual({ closed: harness.childState.closed, stdinFinished: harness.childState.stdinFinished,
          stdinClosed: harness.childState.stdinClosed, stdoutEnded: harness.childState.stdoutEnded,
          stdoutClosed: harness.childState.stdoutClosed, stderrEnded: harness.childState.stderrEnded,
          stderrClosed: harness.childState.stderrClosed }, {
          closed: true, stdinFinished: true, stdinClosed: true, stdoutEnded: true,
          stdoutClosed: true, stderrEnded: true, stderrClosed: true });
        assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
        assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
      });
    }
  });

  test("controller v1 public loader closes a non-string execution identifier without coercion", async () => {
    const { loadGosuRetainedPairControllerControlV1: load } = await import(SOURCE);
    const control = controlFixture(); control.executionId = { toString: "blocked", valueOf: "blocked" };
    const bytes = pretty(control);
    assert.throws(() => load(bytes, sha256(bytes)), /gosu_retained_pair_controller_control_invalid/u);
  });

  test("controller v1 rejects non-string daemon identity regex fields without coercion", async () => {
    const harness = await controllerProtocolVm(); const input = harness.realm(controllerInputFixture());
    for (const field of ["startTicks", "configSha256", "argvSha256"]) {
      let reads = 0; const hostile = { [Symbol.toPrimitive]() { reads += 1; throw new Error(`private ${field}`); } };
      const identity = harness.realm(controllerIdentityFixture(input)); identity[field] = hostile;
      assert.throws(() => harness.api.TEST_ONLY_validateLeaseIdentity(identity, input),
        /gosu_retained_pair_controller_daemon_start_failed/u);
      assert.equal(reads, 0, field);
    }
  });

  test("controller v1 public run rejects a non-string inventory snapshot without coercion", async () => {
    let reads = 0; const hostile = { [Symbol.toPrimitive]() { reads += 1; throw new Error("private inventory snapshot"); } };
    const { harness, inputBytes, capability } = await loadedProtocolScenario({ inventorySnapshotValue: hostile });
    await assert.rejects(harness.api.runGosuRetainedPairControllerV1(inputBytes, capability),
      /gosu_retained_pair_controller_daemon_inventory_invalid/u);
    assert.equal(reads, 0);
  });

  test("controller v1 public run rejects hostile inventory subjects without invoking them", async () => {
    const variants = [
      ({ subjects, count }) => new Proxy(subjects, {
        get() { count(); throw new Error("private subjects proxy"); },
        getOwnPropertyDescriptor() { count(); throw new Error("private subjects proxy"); },
        getPrototypeOf() { count(); throw new Error("private subjects proxy"); },
        has() { count(); throw new Error("private subjects proxy"); },
        ownKeys() { count(); throw new Error("private subjects proxy"); },
      }),
      ({ context, subjects, count }) => {
        const copy = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(subjects))})`, context);
        Object.defineProperty(copy[0], "imageId", { enumerable: true, configurable: true,
          get() { count(); throw new Error("private subject accessor"); } });
        return copy;
      },
      ({ context, subjects, count }) => {
        const copy = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(subjects))})`, context);
        Object.defineProperty(copy[0].platform, "os", { enumerable: true, configurable: true,
          get() { count(); throw new Error("private platform accessor"); } });
        return copy;
      },
      ({ context, subjects, count }) => {
        const copy = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(subjects))})`, context);
        copy[0].platform = new Proxy(copy[0].platform, {
          get() { count(); throw new Error("private platform proxy"); },
          getOwnPropertyDescriptor() { count(); throw new Error("private platform proxy"); },
          getPrototypeOf() { count(); throw new Error("private platform proxy"); },
          has() { count(); throw new Error("private platform proxy"); },
          ownKeys() { count(); throw new Error("private platform proxy"); },
        });
        return copy;
      },
    ];
    for (const variant of variants) {
      let reads = 0;
      const { api, capability, harness } = await controllerBoundaryScenario({
        inventorySubjects: ({ context, subjects }) => variant({ context, subjects, count() { reads += 1; } }),
      });
      let failure;
      try { await api.runGosuRetainedPairControllerV1(harness.inputBytes, capability); } catch (error) { failure = error; }
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(failure)));
      assert.deepEqual({ reads, code: diagnostic.code, phase: diagnostic.phase, stops: harness.daemonState.stops,
        receiptPublished: harness.events.some((event) => event.includes("retained-pair-receipt.json")) }, {
        reads: 0, code: "gosu_retained_pair_controller_daemon_inventory_invalid", phase: "INVENTORY",
        stops: ["EMPTY"], receiptPublished: false,
      });
    }
  });

  test("controller v1 public run rejects an expired worker cutoff before spawn", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ daemonDeadlineOffsetMs: 70_000 });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability),
      /gosu_retained_pair_controller_worker_timeout/u);
    assert.equal(harness.childState.children.length, 0);
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
    assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
  });

  test("controller v1 public run owns an asynchronous child error before rejecting a missing PID", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ missingChildPid: true, childErrorBeforeListeners: true });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_spawn_failed", phase: "WORKER_START", cleanup: "UNCERTAIN" });
      return true;
    });
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
    assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
  });

  test("controller v1 public run rejects output caps and abnormal child termination", async () => {
    for (const faults of [
      { stdoutBytes: Buffer.alloc(8_388_609) },
      { stderrBytes: Buffer.from("unexpected stderr") },
      { childExitCode: 2 },
      { childSignal: "SIGTERM" },
    ]) {
      const { api, capability, harness } = await controllerBoundaryScenario(faults);
      await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability),
        /gosu_retained_pair_controller_worker_cleanup_uncertain/u);
      assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
      assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
    }
  });

  test("controller v1 public timeout re-proves the leader before TERM and KILL", async () => {
    const variants = [
      { faults: { workerNeverCloses: true, workerTimeout: true, closeOnSignal: "SIGTERM" }, signals: ["SIGTERM"], cleanup: "CONFIRMED" },
      { faults: { workerNeverCloses: true, workerTimeout: true, closeOnSignal: "SIGKILL" },
        signals: ["SIGTERM", "SIGKILL"], cleanup: "CONFIRMED" },
      { faults: { workerNeverCloses: true, workerTimeout: true, procInvalidBeforeTerm: true }, signals: [], cleanup: "UNCERTAIN" },
      { faults: { workerNeverCloses: true, workerTimeout: true, procInvalidBeforeTerm: true, procDisappears: true },
        signals: [], cleanup: "UNCERTAIN" },
      { faults: { workerNeverCloses: true, workerTimeout: true, procInvalidBeforeKill: true },
        signals: ["SIGTERM"], cleanup: "UNCERTAIN" },
      { faults: { workerNeverCloses: true, workerTimeout: true, closeOnSignal: "SIGTERM", signalCloseWithoutDrains: true },
        signals: ["SIGTERM"], cleanup: "UNCERTAIN" },
    ];
    for (const variant of variants) {
      const { api, capability, harness } = await controllerBoundaryScenario(variant.faults);
      await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
        const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
        assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
          code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: variant.cleanup });
        return true;
      });
      assert.deepEqual(harness.childState.signals,
        variant.signals.map((signal) => ({ pid: -4242, signal })));
      const assertProofBetween = (afterEvent, beforeEvent) => {
        const afterIndex = harness.events.indexOf(afterEvent);
        const beforeIndex = harness.events.indexOf(beforeEvent);
        assert.notEqual(afterIndex, -1);
        assert.ok(beforeIndex > afterIndex);
        const proofEvents = harness.events.slice(afterIndex + 1, beforeIndex);
        for (const procFile of ["stat", "status", "cmdline"]) {
          assert.equal(proofEvents.includes(`proc:read:/proc/4242/${procFile}`), true);
        }
      };
      if (variant.signals.includes("SIGTERM")) {
        assertProofBetween("child:stdin:end", "process:kill:SIGTERM");
      }
      if (variant.signals.includes("SIGKILL")) {
        assertProofBetween("process:kill:SIGTERM", "process:kill:SIGKILL");
      }
      assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
      assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
    }
  });

  test("controller v1 public close cannot acknowledge a simultaneous abort or expired cutoff", async () => {
    for (const kind of ["ABORT", "CUTOFF"]) {
      const abortController = new globalThis.AbortController();
      const faults = kind === "ABORT" ? { abortAfterClose: true, abortController }
        : { clockJumpAfterCloseMs: 220_000 };
      const { api, capability, harness } = await controllerBoundaryScenario(faults);
      const options = vm.runInContext("({})", harness.context); options.signal = abortController.signal;
      await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability, options), (error) => {
        const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
        assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
          code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: "CONFIRMED" });
        return true;
      });
      assert.deepEqual(harness.childState.signals, []);
      assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
      assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
    }
  });

  test("controller v1 public run sends no payload after cutoff during leader proof", async () => {
    const faults = { daemonDeadlineOffsetMs: 90_014, workerNeverCloses: true, workerTimeout: true, closeOnSignal: "SIGTERM" };
    const { api, capability, harness } = await controllerBoundaryScenario(faults);
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: "CONFIRMED" });
      return true;
    });
    assert.ok(faults.procProofCount >= 2);
    assert.equal(harness.childState.children[0].stdin.transport === undefined, true);
    assert.deepEqual(harness.childState.signals, [{ pid: -4242, signal: "SIGTERM" }]);
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
    assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
  });

  test("controller v1 public run sends no payload after abort during leader proof", async () => {
    const abortController = new globalThis.AbortController();
    const faults = { abortDuringLeaderProof: true, abortController, workerNeverCloses: true, closeOnSignal: "SIGTERM" };
    const { api, capability, harness } = await controllerBoundaryScenario(faults);
    const options = vm.runInContext("({})", harness.context); options.signal = abortController.signal;
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability, options), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: "CONFIRMED" });
      return true;
    });
    assert.equal(faults.leaderAbortInjected, true);
    assert.equal(harness.childState.children[0].stdin.transport === undefined, true);
    assert.deepEqual(harness.childState.signals, [{ pid: -4242, signal: "SIGTERM" }]);
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
    assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
  });

  test("controller v1 public run terminates the proven leader after a pre-transport clock rollback", async () => {
    const faults = { clockRollbackAfterProof: true, workerNeverCloses: true, closeOnSignal: "SIGTERM" };
    const { api, capability, harness } = await controllerBoundaryScenario(faults);
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: "UNCERTAIN" });
      return true;
    });
    assert.equal(faults.clockRollbackInjected, true);
    assert.equal(harness.childState.children[0].stdin.transport === undefined, true);
    assert.deepEqual(harness.childState.signals, [{ pid: -4242, signal: "SIGTERM" }]);
    assert.deepEqual({ closed: harness.childState.closed, stdinFinished: harness.childState.stdinFinished,
      stdinClosed: harness.childState.stdinClosed, stdoutEnded: harness.childState.stdoutEnded,
      stdoutClosed: harness.childState.stdoutClosed, stderrEnded: harness.childState.stderrEnded,
      stderrClosed: harness.childState.stderrClosed }, {
      closed: true, stdinFinished: true, stdinClosed: true, stdoutEnded: true,
      stdoutClosed: true, stderrEnded: true, stderrClosed: true });
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
    assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
  });

  test("controller v1 public run terminates an authenticated leader after post-transport clock rollback", async (t) => {
    for (const rollbackPoint of ["TRANSPORT", "RACE"]) {
      for (const settlement of ["CLOSED", "OPEN"]) {
        await t.test(`${rollbackPoint.toLowerCase()} rollback with ${settlement.toLowerCase()} worker`, async () => {
          const faults = { workerNeverCloses: true, workerTimeout: true,
            ...(rollbackPoint === "TRANSPORT" ? { clockRollbackAfterTransport: true } : { clockRollbackAfterRace: true }),
            ...(settlement === "CLOSED" ? { closeOnSignal: "SIGTERM" } : {}) };
          const { api, capability, harness } = await controllerBoundaryScenario(faults);
          await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
            const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
            assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
              code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: "UNCERTAIN" });
            return true;
          });
          assert.equal(faults.clockRollbackInjected, true);
          assert.ok(harness.childState.children[0].stdin.transport?.length > 0);
          const expectedSignals = settlement === "CLOSED" ? ["SIGTERM"] : ["SIGTERM", "SIGKILL"];
          assert.deepEqual(harness.childState.signals,
            expectedSignals.map((signal) => ({ pid: -4242, signal })));
          assert.equal(harness.childState.closed === true, settlement === "CLOSED");
          assert.equal(harness.childState.stdinFinished === true, true);
          assert.equal(harness.childState.stdinClosed === true, true);
          assert.equal(harness.childState.stdoutEnded === true, settlement === "CLOSED");
          assert.equal(harness.childState.stdoutClosed === true, settlement === "CLOSED");
          assert.equal(harness.childState.stderrEnded === true, settlement === "CLOSED");
          assert.equal(harness.childState.stderrClosed === true, settlement === "CLOSED");
          if (rollbackPoint === "RACE") assert.equal(faults.workerTimerCleared, true);
          assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
          assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
        });
      }
    }
  });

  test("controller v1 public run does not signal an already closed leader after post-race clock rollback", async () => {
    const faults = { clockRollbackAfterRace: true, workerTimeout: true };
    const { api, capability, harness } = await controllerBoundaryScenario(faults);
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_timeout", phase: "WORKER_RUN", cleanup: "UNCERTAIN" });
      return true;
    });
    assert.equal(faults.clockRollbackInjected, true);
    assert.equal(faults.workerTimerCleared, true);
    assert.deepEqual(harness.childState.signals, []);
    assert.deepEqual({ closed: harness.childState.closed, stdinFinished: harness.childState.stdinFinished,
      stdinClosed: harness.childState.stdinClosed, stdoutEnded: harness.childState.stdoutEnded,
      stdoutClosed: harness.childState.stdoutClosed, stderrEnded: harness.childState.stderrEnded,
      stderrClosed: harness.childState.stderrClosed }, {
      closed: true, stdinFinished: true, stdinClosed: true, stdoutEnded: true,
      stdoutClosed: true, stderrEnded: true, stderrClosed: true });
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
    assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
  });

  test("controller v1 rejects a surplus daemon identity before reading it", async () => {
    const harness = await controllerProtocolVm(); const input = harness.realm(controllerInputFixture());
    const identity = harness.realm({ ...controllerIdentityFixture(input), unexpected: "private" });
    assert.throws(() => harness.api.TEST_ONLY_validateLeaseIdentity(identity, input),
      /gosu_retained_pair_controller_daemon_start_failed/u);
  });

  test("controller v1 rejects daemon identity accessors without invoking them", async () => {
    const harness = await controllerProtocolVm(); const input = harness.realm(controllerInputFixture());
    const identity = harness.realm(controllerIdentityFixture(input)); let reads = 0;
    Object.defineProperty(identity, "purpose", { enumerable: true, configurable: true,
      get() { reads += 1; throw new Error("private getter"); } });
    assert.throws(() => harness.api.TEST_ONLY_validateLeaseIdentity(identity, input),
      /gosu_retained_pair_controller_daemon_start_failed/u);
    assert.equal(reads, 0);
  });

  test("controller v1 rejects a daemon identity proxy without invoking its traps", async () => {
    const harness = await controllerProtocolVm(); const input = harness.realm(controllerInputFixture());
    let reads = 0; const identity = new Proxy(harness.realm(controllerIdentityFixture(input)), {
      get() { reads += 1; throw new Error("private proxy"); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error("private proxy"); },
      getPrototypeOf() { reads += 1; throw new Error("private proxy"); },
    });
    assert.throws(() => harness.api.TEST_ONLY_validateLeaseIdentity(identity, input),
      /gosu_retained_pair_controller_daemon_start_failed/u);
    assert.equal(reads, 0);
  });

  test("controller v1 authenticates a frozen copy of the mutable daemon identity", async () => {
    const harness = await controllerProtocolVm(); const input = harness.realm(controllerInputFixture());
    const original = harness.realm(controllerIdentityFixture(input)); const expectedDaemonId = original.daemonId;
    const rawLease = vm.runInContext("({})", harness.context); rawLease.identity = original;
    rawLease.verifyIdentity = async () => harness.realm({ state: "VERIFIED", purpose: original.purpose,
      authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", daemonId: original.daemonId, endpoint: original.endpoint,
      pid: original.pid, principalImageCount: 2, principalSnapshotSha256: "9".repeat(64) });
    rawLease.verifyInventory = async () => ({}); rawLease.stop = async () => ({});
    const authenticated = await harness.api.TEST_ONLY_authenticateLease(rawLease, input);
    assert.equal(Object.isFrozen(original), false);
    original.daemonId = "mutated-after-authentication";
    assert.equal(authenticated.identity.daemonId, expectedDaemonId);
    assert.equal(Object.isFrozen(authenticated.identity), true);
  });

  test("controller v1 VM runs the success protocol in the fixed lifecycle order", async () => {
    const { harness, inputBytes, capability } = await loadedProtocolScenario();
    const ack = await harness.api.runGosuRetainedPairControllerV1(inputBytes, capability);
    assert.deepEqual(harness.imports, ["node:child_process", "node:crypto", "node:events", "node:fs", "node:path",
      "node:timers/promises", "node:url", "node:util", "./gosu-derivative-image-daemon-v2.mjs",
      "./gosu-retained-pair-worker-v1.mjs"]);
    assert.deepEqual(harness.events.filter((event) => !event.startsWith("time:")), ["source", "parent",
      "tool:/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node", "tool:/usr/bin/setpriv", "daemonStart",
      "inventory:EMPTY", "worker", "tool:/usr/bin/setpriv", "parse", "inventory:BASE_AND_CANDIDATE",
      "stop:BASE_AND_CANDIDATE", "inspect", "publish", "inspect"]);
    assert.deepEqual(Object.keys(harness.daemonLease), ["identity", "verifyIdentity", "verifyInventory", "stop"]);
    assert.equal(harness.events[0], "time:SOURCE"); assert.equal(harness.events.at(-1), "time:ACK");
    assert.equal(ack.kind, "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1");
    assert.equal(ack.scope, "PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING");
    assert.equal(harness.stopCalls, 1); assert.equal(harness.stopMode, "BASE_AND_CANDIDATE");
    assert.doesNotMatch(JSON.stringify(ack), /sourceManifest|commitRaw|principal-engine|PROTOCOL_SIMULATION_ARCHIVE/u);
  });

  test("controller v1 public run completes through genuine helpers with boundary-only PROTOCOL_SIMULATION", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario();
    let ack;
    try { ack = await api.runGosuRetainedPairControllerV1(harness.inputBytes, capability); }
    catch (error) {
      assert.fail(JSON.stringify({ diagnostic: api.gosuRetainedPairControllerV1FailureDiagnostic(error), events: harness.events }));
    }
    assert.equal(ack.kind, "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1");
    assert.deepEqual(Object.keys(harness.daemonState.lease), ["identity", "verifyIdentity", "verifyInventory", "stop"]);
    assert.deepEqual(harness.daemonState.inventories.map(({ mode }) => mode), ["EMPTY", "BASE_AND_CANDIDATE"]);
    assert.deepEqual(harness.daemonState.stops, ["BASE_AND_CANDIDATE"]);
    assert.equal(harness.childState.children.length, 1); assert.equal(harness.childState.command, "/usr/bin/setpriv");
    assert.deepEqual(harness.childState.signals, []);
    assert.equal(harness.events.filter((event) => event.startsWith("clock:")).length, 31);
    assert.equal(harness.events.includes("fs:fsync:/var/tmp/aw-cl-ABC123/preservation/retained-pair-receipt.json"), true);
    assert.doesNotMatch(JSON.stringify(ack), /sourceManifest|commitRaw|principal-engine/u);
  });

  test("controller v1 public run rejects a stdout stream error and stops once in EMPTY mode", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ stdoutError: true });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_cleanup_uncertain", phase: "WORKER_RUN", cleanup: "UNCERTAIN" });
      return true;
    });
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]); assert.equal(harness.events.some((item) => item.startsWith("fs:mkdir:")), false);
  });

  test("controller v1 public run rejects child close before stdout close and never acknowledges", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ stdoutNoClose: true });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability),
      /gosu_retained_pair_controller_worker_cleanup_uncertain/u);
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]); assert.equal(harness.events.some((item) => item.startsWith("fs:mkdir:")), false);
  });

  test("controller v1 public run preserves archive descriptor close uncertainty after daemon stop", async () => {
    const candidate = "/var/tmp/aw-cl-ABC123/client/output/candidate-image.tar";
    const { api, capability, harness } = await controllerBoundaryScenario({ closeFailure: [candidate] });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_cleanup_uncertain", phase: "CLEANUP", cleanup: "UNCERTAIN" });
      return true;
    });
    assert.deepEqual(harness.daemonState.stops, ["BASE_AND_CANDIDATE"]);
  });

  test("controller v1 public run rejects a context entry size that differs from the fixed contract", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({}, (result) => { result.context.entries[0].size += 1; });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability),
      /gosu_retained_pair_controller_worker_result_invalid/u);
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
  });

  test("controller v1 public run rejects a context entry digest that differs from the fixed contract", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({}, (result) => {
      result.context.entries[0].sha256 = "0".repeat(64);
    });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability),
      /gosu_retained_pair_controller_worker_result_invalid/u);
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
  });

  test("controller v1 public run rejects aliased physical modes before archive inspection", async (t) => {
    const variants = [
      ["context", (result) => result.context.physical, 0o100600],
      ["base archive", (result) => result.retention.base.physical, 0o100600],
      ["retention directory", (result) => result.retention.directory, 0o40700],
    ];
    for (const [name, select, validMode] of variants) {
      for (const delta of [2 ** 16, 2 ** 32]) {
        await t.test(`${name} rejects mode plus ${delta}`, async () => {
          const { api, capability, harness } = await controllerBoundaryScenario({}, (result) => {
            select(result).mode = validMode + delta;
          });
          await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
            const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
            assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
              code: "gosu_retained_pair_controller_worker_result_invalid", phase: "WORKER_RUN", cleanup: "CONFIRMED" });
            return true;
          });
          assert.deepEqual(harness.daemonState.inventories.map(({ mode }) => mode), ["EMPTY"]);
          assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
          assert.equal(harness.events.some((event) => event.includes("/client/output/")), false);
          assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
        });
      }
    }
  });

  test("controller v1 public run rejects unmanifested empty source directories before daemon start", async (t) => {
    for (const directory of [`${ROOT}/unexpected-empty`, `${ROOT}/scripts/postgres-image/unexpected-empty`]) {
      await t.test(directory, async () => {
        const { api, capability, harness } = await controllerBoundaryScenario({ extraSourceDirectory: directory });
        await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
          const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
          assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
            code: "gosu_retained_pair_controller_source_invalid", phase: "SOURCE", cleanup: "NOT_STARTED" });
          return true;
        });
        assert.equal(harness.daemonState.starts, 0);
        assert.equal(harness.childState.children.length, 0);
        assert.deepEqual(harness.daemonState.stops, []);
        assert.equal(harness.events.some((event) => event.includes("retained-pair-receipt.json")), false);
      });
    }
  });

  test("controller v1 public run accepts the exact context entry set in a different order", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({}, (result) => {
      result.context.entries = [...result.context.entries.slice(1), result.context.entries[0]];
      result.context.entries.forEach((entry, ordinal) => { entry.ordinal = ordinal; });
    });
    const ack = await api.runGosuRetainedPairControllerV1(harness.inputBytes, capability);
    assert.equal(ack.kind, "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1");
    assert.deepEqual(harness.daemonState.inventories.map(({ mode }) => mode), ["EMPTY", "BASE_AND_CANDIDATE"]);
    assert.deepEqual(harness.daemonState.stops, ["BASE_AND_CANDIDATE"]);
  });

  test("controller v1 public run rejects duplicate or missing context entry members", async (t) => {
    const variants = [
      ["duplicate", (entries) => [...entries.slice(0, -1), { ...entries[0] }]],
      ["missing", (entries) => entries.slice(0, -1)],
    ];
    for (const [name, mutate] of variants) {
      await t.test(name, async () => {
        const { api, capability, harness } = await controllerBoundaryScenario({}, (result) => {
          result.context.entries = mutate(result.context.entries);
          result.context.entries.forEach((entry, ordinal) => { entry.ordinal = ordinal; });
        });
        await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
          const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
          assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
            code: "gosu_retained_pair_controller_worker_result_invalid", phase: "WORKER_RUN", cleanup: "CONFIRMED" });
          return true;
        });
        assert.deepEqual(harness.daemonState.inventories.map(({ mode }) => mode), ["EMPTY"]);
        assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
      });
    }
  });

  test("controller v1 public run accepts trimmed builder platform members", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({}, (result) => {
      setBuilderPlatforms(result, "linux/arm64, linux/amd64");
    });
    const ack = await api.runGosuRetainedPairControllerV1(harness.inputBytes, capability);
    assert.equal(ack.kind, "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1");
    assert.deepEqual(harness.daemonState.stops, ["BASE_AND_CANDIDATE"]);
  });

  test("controller v1 public run rejects a clock rollback between publication and ACK", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ clockRollbackAt: 31 });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_timeout", phase: "ACK", cleanup: "UNCERTAIN" });
      return true;
    });
    assert.deepEqual(harness.daemonState.stops, ["BASE_AND_CANDIDATE"]);
    assert.equal(harness.events.includes("fs:fsync:/var/tmp/aw-cl-ABC123/preservation/retained-pair-receipt.json"), true);
  });

  test("controller v1 public run preserves source descriptor close uncertainty before daemon start", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ closeFailure: [CONTROLLER] });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_cleanup_uncertain", phase: "CLEANUP", cleanup: "UNCERTAIN" });
      return true;
    });
    assert.equal(harness.daemonState.starts, 0);
  });

  test("controller v1 public run rejects oversized transport before worker spawn and stops EMPTY once", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ oversizedSourceClosureBytes: 16_777_217 });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability),
      /gosu_retained_pair_controller_worker_result_invalid/u);
    assert.equal(harness.childState.children.length, 0);
    assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
  });

  test("controller v1 public run rejects pre-daemon clock rollback without calling daemon start", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ clockRollbackAt: 7 });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_daemon_start_failed", phase: "DAEMON_START", cleanup: "NOT_STARTED" });
      return true;
    });
    assert.equal(harness.daemonState.starts, 0); assert.deepEqual(harness.daemonState.stops, []);
  });

  test("controller v1 public run stops the authenticated lease once after post-return clock rollback", async () => {
    const { api, capability, harness } = await controllerBoundaryScenario({ clockRollbackAt: 8 });
    await assert.rejects(api.runGosuRetainedPairControllerV1(harness.inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.notEqual(diagnostic.cleanup, "NOT_STARTED");
      assert.equal(diagnostic.code, "gosu_retained_pair_controller_daemon_start_failed");
      assert.equal(diagnostic.phase, "DAEMON_START");
      return true;
    });
    assert.equal(harness.daemonState.starts, 1); assert.deepEqual(harness.daemonState.stops, ["EMPTY"]);
    assert.equal(harness.events.some((item) => item.startsWith("fs:mkdir:")), false);
  });

  test("controller v1 VM stops once in the last confirmed mode after worker failure", async () => {
    const workerError = Object.assign(new Error("closed"), { code: "gosu_retained_pair_controller_worker_result_invalid",
      phase: "WORKER_RUN", cleanup: "UNCERTAIN" });
    const { harness, inputBytes, capability } = await loadedProtocolScenario({ parseError: workerError });
    await assert.rejects(harness.api.runGosuRetainedPairControllerV1(inputBytes, capability), (error) => {
      assert.deepEqual(JSON.parse(JSON.stringify(harness.api.gosuRetainedPairControllerV1FailureDiagnostic(error))), {
        kind: "GOSU_RETAINED_PAIR_CONTROLLER_FAILURE_V1", state: "FAILED",
        code: "gosu_retained_pair_controller_worker_result_invalid", phase: "WORKER_RUN", cleanup: "CONFIRMED",
        authority: "NOT_AUTHORIZED", preservation: "NOT_ESTABLISHED", dates: null }, JSON.stringify(harness.events));
      return true;
    });
    assert.equal(harness.stopCalls, 1); assert.equal(harness.stopMode, "EMPTY");
    assert.deepEqual(harness.events.slice(-2), ["parse", "stop:EMPTY"]);
  });

  test("controller v1 VM stops once before reporting a late stop entry", async () => {
    const { harness, inputBytes, capability } = await loadedProtocolScenario({ times: { STOP: 440_001 } });
    await assert.rejects(harness.api.runGosuRetainedPairControllerV1(inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(harness.api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_worker_timeout", phase: "STOP", cleanup: "CONFIRMED" });
      return true;
    });
    assert.equal(harness.stopCalls, 1); assert.equal(harness.stopMode, "BASE_AND_CANDIDATE");
    assert.equal(harness.events.includes("publish"), false);
  });

  test("controller v1 VM never acknowledges while the one stop attempt is unsettled", async () => {
    let rejectStop;
    const pending = new Promise((resolve, reject) => { rejectStop = reject; });
    const { harness, inputBytes, capability } = await loadedProtocolScenario({ stop: () => pending });
    let settled = false; const run = harness.api.runGosuRetainedPairControllerV1(inputBytes, capability).then(
      () => { settled = true; }, (error) => { settled = true; throw error; });
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    assert.equal(harness.stopCalls, 1); assert.equal(settled, false); assert.equal(harness.events.includes("publish"), false);
    rejectStop(new Error("closed rejection"));
    await assert.rejects(run, /gosu_retained_pair_controller_daemon_cleanup_uncertain/u);
  });

  test("controller v1 VM reports uncertain cleanup when the one stop attempt rejects", async () => {
    const { harness, inputBytes, capability } = await loadedProtocolScenario({ stop: async () => { throw new Error("closed rejection"); } });
    await assert.rejects(harness.api.runGosuRetainedPairControllerV1(inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(harness.api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_daemon_cleanup_uncertain", phase: "STOP", cleanup: "UNCERTAIN" });
      return true;
    });
    assert.equal(harness.stopCalls, 1); assert.equal(harness.events.includes("publish"), false);
  });

  test("controller v1 VM preserves uncertain cleanup when daemon start rejects", async () => {
    const { harness, inputBytes, capability } = await loadedProtocolScenario({ daemonError: new Error("closed rejection") });
    await assert.rejects(harness.api.runGosuRetainedPairControllerV1(inputBytes, capability), (error) => {
      const diagnostic = JSON.parse(JSON.stringify(harness.api.gosuRetainedPairControllerV1FailureDiagnostic(error)));
      assert.deepEqual({ code: diagnostic.code, phase: diagnostic.phase, cleanup: diagnostic.cleanup }, {
        code: "gosu_retained_pair_controller_daemon_start_failed", phase: "DAEMON_START", cleanup: "UNCERTAIN" });
      return true;
    });
    assert.equal(harness.stopCalls, 0);
    assert.deepEqual(harness.events.slice(-1), ["daemonStart"]);
  });

  test("controller v1 proc proof accepts an actually empty supplementary group list", async () => {
    const pid = 4321; const workerPath = "/opt/auto-world/deployment/scripts/postgres-image/gosu-retained-pair-worker-v1.mjs";
    const statFields = ["R", "1", String(pid), String(pid), ...Array(15).fill("0"), "1234"];
    const status = "Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nGroups:\t\nNoNewPrivs:\t1\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\n";
    const harness = await controllerProtocolVm({ fs: { readFileSync(file) {
      if (file === `/proc/${pid}/stat`) return `${pid} (node) ${statFields.join(" ")}\n`;
      if (file === `/proc/${pid}/status`) return status;
      if (file === `/proc/${pid}/cmdline`) return Buffer.from(`${LINUX_NODE.path ?? "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node"}\0${workerPath}\0`);
      throw new Error("unexpected proc path");
    }, realpathSync(file) { return file === `/proc/${pid}/exe`
      ? "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node" : file; } } });
    const proof = harness.api.TEST_ONLY_procProof(pid, workerPath);
    assert.deepEqual(JSON.parse(JSON.stringify(proof.argv)), ["/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node", workerPath]);
  });

  test("controller v1 proc proof rejects a surplus empty command argument", async () => {
    const pid = 4321; const nodePath = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
    const workerPath = "/opt/auto-world/deployment/scripts/postgres-image/gosu-retained-pair-worker-v1.mjs";
    const statFields = ["R", "1", String(pid), String(pid), ...Array(15).fill("0"), "1234"];
    const status = "Uid: 1000 1000 1000 1000\nGid: 1000 1000 1000 1000\nGroups:\nNoNewPrivs: 1\nCapInh: 0000000000000000\nCapPrm: 0000000000000000\nCapEff: 0000000000000000\nCapBnd: 0000000000000000\nCapAmb: 0000000000000000\n";
    const harness = await controllerProtocolVm({ fs: { readFileSync(file) {
      if (file === `/proc/${pid}/stat`) return `${pid} (node) ${statFields.join(" ")}\n`;
      if (file === `/proc/${pid}/status`) return status;
      if (file === `/proc/${pid}/cmdline`) return Buffer.from(`${nodePath}\0${workerPath}\0\0`);
      throw new Error("unexpected proc path");
    }, realpathSync(file) { return file === `/proc/${pid}/exe` ? nodePath : file; } } });
    assert.throws(() => harness.api.TEST_ONLY_procProof(pid, workerPath), /identity/u);
  });

  test("controller v1 genuine host filesystem preserves exclusive no-follow descriptor identity", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aw-retained-pair-fs-"));
    const file = path.join(directory, "receipt.json"); let fd; let readFd;
    try {
      fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      const bytes = Buffer.from("{\"scope\":\"GENUINE_HOST_FILESYSTEM_MECHANICS\"}\n");
      assert.equal(fs.writeSync(fd, bytes, 0, bytes.length, 0), bytes.length); fs.fsyncSync(fd);
      const held = fs.fstatSync(fd, { bigint: true }); const named = fs.lstatSync(file, { bigint: true });
      assert.equal(held.isFile(), true); assert.equal(named.isSymbolicLink(), false);
      assert.deepEqual({ dev: held.dev, ino: held.ino, size: held.size, nlink: held.nlink },
        { dev: named.dev, ino: named.ino, size: named.size, nlink: named.nlink });
      fs.closeSync(fd); fd = undefined;
      readFd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const reread = Buffer.alloc(bytes.length); assert.equal(fs.readSync(readFd, reread, 0, reread.length, 0), bytes.length);
      assert.deepEqual(reread, bytes);
      assert.throws(() => fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600),
        (error) => error?.code === "EEXIST");
    } finally {
      if (readFd !== undefined) fs.closeSync(readFd);
      if (fd !== undefined) fs.closeSync(fd);
      removeOwnedTemporaryDirectory(directory, "aw-retained-pair-fs-");
    }
  });

  if (process.platform === "linux" && process.getuid?.() === 1000 && process.getgid?.() === 1000) {
    test("controller v1 genuine UID1000 archive helper holds and revalidates the same descriptors", async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aw-retained-archives-"));
      const base = Buffer.from("base archive\n"); const candidate = Buffer.from("candidate archive\n");
      try {
        fs.chmodSync(directory, 0o700);
        fs.writeFileSync(path.join(directory, "base-image.tar"), base, { mode: 0o600, flag: "wx" });
        fs.writeFileSync(path.join(directory, "candidate-image.tar"), candidate, { mode: 0o600, flag: "wx" });
        const retained = (name, bytes) => ({ name, archive: { bytes: bytes.length, sha256: sha256(bytes) }, configId: imageId("f"),
          physical: physicalSnapshot(path.join(directory, name)) });
        const result = { retention: { directory: physicalSnapshot(directory), base: retained("base-image.tar", base),
          candidate: retained("candidate-image.tar", candidate) } };
        const api = await controllerFsHelperApi(); const session = api.TEST_ONLY_inspectArchives(directory,
          api.TEST_ONLY_realmValue(JSON.stringify(result)));
        assert.deepEqual(JSON.parse(JSON.stringify(session.revalidate())), JSON.parse(JSON.stringify(session.snapshot)));
        session.close(); assert.throws(() => session.revalidate(), /gosu_retained_pair_controller_preservation_failed/u);
      } finally { removeOwnedTemporaryDirectory(directory, "aw-retained-archives-"); }
    });
  }

  if (process.platform === "linux" && process.getuid?.() === 0 && process.getgid?.() === 0) {
    test("controller v1 genuine root receipt helper publishes one exclusive durable receipt", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-retained-receipt-"));
      try {
        const api = await controllerFsHelperApi(); const receipt = { kind: "PROTOCOL_SIMULATION_RECEIPT", authority: "NOT_AUTHORIZED" };
        const published = api.TEST_ONLY_publishReceipt(root, api.TEST_ONLY_realmValue(JSON.stringify(receipt)));
        const file = path.join(root, "preservation", "retained-pair-receipt.json"); const bytes = pretty(receipt);
        assert.equal(published.bytes, bytes.length); assert.equal(published.sha256, sha256(bytes));
        assert.deepEqual(fs.readFileSync(file), bytes);
        assert.throws(() => api.TEST_ONLY_publishReceipt(root, api.TEST_ONLY_realmValue(JSON.stringify(receipt))),
          /gosu_retained_pair_controller_preservation_failed/u);
      } finally { removeOwnedTemporaryDirectory(root, "aw-retained-receipt-"); }
    });
  }
}
