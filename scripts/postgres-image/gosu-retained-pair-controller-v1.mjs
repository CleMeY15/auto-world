import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, statfsSync, writeSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";
import { startGosuDerivativeImageDaemonLease } from "./gosu-derivative-image-daemon-v2.mjs";
import { validateGosuRetainedPairSourceClosureV1 } from "./gosu-retained-pair-worker-v1.mjs";

const BASELINE_REVISION = "81e9aee793820f543a12f27e4d5ba42d702f4cc8";
const BASELINE_TREE = "f8e85365bb1a35d265df989646c9bbd264781133";
const PR188_REVISION = "2435bce8068146c55fed06ddf7189b70ac8c7475";
const PR188_TREE = "c47ed63d3ae51817035227e0b4977ac41ce0dfef";
const ACCEPTANCE = Object.freeze({ path: ".omx/gosu-derivative-context-private-acceptance-v1.json", bytes: 11744,
  sha256: "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3" });
const BASE_CONFIG_ID = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
const RECEIPT_BASENAME = "retained-pair-receipt.json";
const WORKER_URL = new URL("./gosu-retained-pair-worker-v1.mjs", import.meta.url);
const SOURCE_ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
const HEX24 = /^[0-9a-f]{24}$/u;
const HEX40 = /^[0-9a-f]{40}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
const IMAGE = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const START_TICKS = /^[1-9][0-9]{0,19}$/u;
const EXECUTION = /^gosu-retained-pair-[0-9a-f]{24}$/u;
const PRINCIPAL_ID = /^[A-Za-z0-9:_-]{1,128}$/u;
const GiB = 1024 ** 3;
const TYPED_ARRAY_LENGTH = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length").get;
const RUNTIME_ABORT_SIGNAL = globalThis.AbortSignal;
const RUNTIME_ABORT_SIGNAL_PROTOTYPE = RUNTIME_ABORT_SIGNAL.prototype;
const RUNTIME_ABORTED_GETTER = Object.getOwnPropertyDescriptor(RUNTIME_ABORT_SIGNAL_PROTOTYPE, "aborted").get;
const RUNTIME_EVENT_TARGET_PROTOTYPE = Object.getPrototypeOf(RUNTIME_ABORT_SIGNAL_PROTOTYPE);
const RUNTIME_REMOVE_EVENT_LISTENER = Object.getOwnPropertyDescriptor(RUNTIME_EVENT_TARGET_PROTOTYPE, "removeEventListener").value;
const PRISTINE_ABORT_SIGNAL = new globalThis.AbortController().signal;
const COMPOSITE_SOURCE_CONTROLLER = new globalThis.AbortController();
const COMPOSITE_ABORT_SIGNAL = RUNTIME_ABORT_SIGNAL.any([COMPOSITE_SOURCE_CONTROLLER.signal]);
const ABORT_SIGNAL_SAMPLES = [PRISTINE_ABORT_SIGNAL, RUNTIME_ABORT_SIGNAL.abort(), RUNTIME_ABORT_SIGNAL.timeout(0),
  COMPOSITE_ABORT_SIGNAL, COMPOSITE_SOURCE_CONTROLLER.signal];
const MANDATORY_ABORT_SIGNAL_SYMBOLS = Object.freeze(Reflect.ownKeys(PRISTINE_ABORT_SIGNAL)
  .filter((key) => typeof key === "symbol"));
const ALLOWED_ABORT_SIGNAL_SYMBOLS = new Set(ABORT_SIGNAL_SAMPLES.flatMap((sample) => Reflect.ownKeys(sample)
  .filter((key) => typeof key === "symbol")));
const EXPECTED_CONTEXT_ENTRIES = deepFreeze([
  { path: "Dockerfile", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 199,
    sha256: "1f5215a51b3b67a8e44b6feeb51ce36653f5790ac6e2156926fb274a8c4ec698" },
  { path: "gosu", type: "file", mode: 0o755, uid: 0, gid: 0, mtime: 0, size: 1936912,
    sha256: "d0a386b6fcd757540277ed91e213e7c51f2406bad2965535ce0bd2c6214339d4" },
  { path: "auto-world-gosu", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 0, size: 0 },
  { path: "auto-world-gosu/gosu-LICENSE", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 11358,
    sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" },
  { path: "auto-world-gosu/moby-user-LICENSE", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 11358,
    sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" },
  { path: "auto-world-gosu/go-LICENSE", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 1453,
    sha256: "911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad" },
  { path: "auto-world-gosu/go-PATENTS", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 1303,
    sha256: "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc" },
  { path: "auto-world-gosu/x-sys-LICENSE", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 1479,
    sha256: "2d36597f7117c38b006835ae7f537487207d8ec407aa9d9980794b2030cbc067" },
  { path: "auto-world-gosu/x-sys-PATENTS", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 1303,
    sha256: "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc" },
  { path: "auto-world-gosu/notices.json", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 121,
    sha256: "e48215fcfd4ac9f0d66e88c9ecb2b2d60898681278f582452fbe60c853618c22" },
  { path: "auto-world-gosu/module-closure.json", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 399,
    sha256: "8234aa30428e11a6e39cc916557ec1c849fd1481c35385536e11bf4455f0c3cc" },
  { path: "auto-world-gosu/sbom.cdx.json", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 1192,
    sha256: "4dfb0c70caa63416dfeaad485cef2aea70e1689d39729dd90cc9ecd087439b26" },
  { path: "auto-world-gosu/version.txt", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 35,
    sha256: "7bd970d3ab80dd130d0faa363a39469dddda09274e0da70d1a8dd8fd2f7ca237" },
  { path: "auto-world-gosu/build-info.txt", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 950,
    sha256: "2196165397810ee92560467344c9aa9356ddcfa54cf6d5f086391bc1252a1a4b" },
  { path: "auto-world-gosu/derivative-manifest.json", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 5937,
    sha256: "1d6326ecc051cde160009f1269ab7d749f8b5c12f4250910cbeda04eeb9e3977" },
]);

const CONTROLLER_PHASES = Object.freeze(["INPUT", "CONTROL", "SOURCE", "PREFLIGHT", "DAEMON_START", "WORKER_START",
  "WORKER_RUN", "INVENTORY", "STOP", "PRESERVE", "ACK", "CLEANUP"]);
const CONTROLLER_CODES = Object.freeze([
  "gosu_retained_pair_controller_input_invalid", "gosu_retained_pair_controller_control_invalid",
  "gosu_retained_pair_controller_source_invalid", "gosu_retained_pair_controller_acceptance_invalid",
  "gosu_retained_pair_controller_tool_invalid", "gosu_retained_pair_controller_daemon_start_failed",
  "gosu_retained_pair_controller_worker_spawn_failed", "gosu_retained_pair_controller_worker_identity_invalid",
  "gosu_retained_pair_controller_worker_timeout", "gosu_retained_pair_controller_worker_result_invalid",
  "gosu_retained_pair_controller_worker_cleanup_uncertain", "gosu_retained_pair_controller_daemon_inventory_invalid",
  "gosu_retained_pair_controller_daemon_cleanup_uncertain", "gosu_retained_pair_controller_preservation_failed",
  "gosu_retained_pair_controller_cleanup_uncertain",
]);
const CODE_SET = new Set(CONTROLLER_CODES);
const CLEANUPS = new Set(["NOT_STARTED", "CONFIRMED", "UNCERTAIN"]);

function plain(value) {
  return value !== null && typeof value === "object" && !types.isProxy(value) && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value, expected) {
  if (!plain(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  return isDeepStrictEqual(names, expected) && names.every((name) => typeof name === "string"
    && descriptors[name].enumerable === true && Object.hasOwn(descriptors[name], "value"));
}
function dense(value) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== value.length + 1 || names.at(-1) !== "length") return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) return false;
  }
  return true;
}
function deepFreeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreeze));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepFreeze(item)])));
  return value;
}
function failure(code, phase, cleanup = "NOT_STARTED") {
  const acceptedCode = CODE_SET.has(code) ? code : "gosu_retained_pair_controller_input_invalid";
  const acceptedPhase = CONTROLLER_PHASES.includes(phase) ? phase : "INPUT";
  const acceptedCleanup = CLEANUPS.has(cleanup) ? cleanup : "UNCERTAIN";
  const error = new Error(acceptedCode);
  Object.defineProperties(error, {
    code: { value: acceptedCode, enumerable: true },
    phase: { value: acceptedPhase, enumerable: true },
    cleanup: { value: acceptedCleanup, enumerable: true },
  });
  return error;
}
function fail(code, phase, cleanup = "NOT_STARTED") { throw failure(code, phase, cleanup); }
function failureMetadata(value) {
  const closed = { code: undefined, phase: undefined, cleanup: "UNCERTAIN" };
  try {
    if (value === null || typeof value !== "object" || types.isProxy(value)) return closed;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const read = (name) => {
      const descriptor = descriptors[name];
      return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    };
    return { code: read("code"), phase: read("phase"), cleanup: read("cleanup") };
  } catch { return closed; }
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function gitObjectId(type, bytes) {
  return createHash("sha1").update(Buffer.from(`${type} ${bytes.length}\0`)).update(bytes).digest("hex");
}
function ownedBuffer(value, cap, code, phase) {
  if (types.isProxy(value) || !Buffer.isBuffer(value) || Object.getPrototypeOf(value) !== Buffer.prototype) fail(code, phase);
  let length;
  try {
    if (Object.getOwnPropertyDescriptor(value, "length") !== undefined) fail(code, phase);
    length = Reflect.apply(TYPED_ARRAY_LENGTH, value, []);
    if (!safeInteger(length) || length > cap || Reflect.ownKeys(value).length !== length) fail(code, phase);
  } catch { fail(code, phase); }
  return Buffer.from(value);
}
function canonicalJson(bytes, cap, pretty, code, phase, owned = false) {
  const copy = owned ? bytes : ownedBuffer(bytes, cap, code, phase);
  if (copy.length === 0) fail(code, phase);
  if (copy[0] === 0xef && copy[1] === 0xbb && copy[2] === 0xbf || copy.includes(0) || copy.includes(13)) fail(code, phase);
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(copy)); }
  catch { fail(code, phase); }
  const canonical = Buffer.from(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);
  if (!copy.equals(canonical)) fail(code, phase);
  return value;
}
function safeInteger(value, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function matches(value, pattern) { return typeof value === "string" && pattern.test(value); }
function recordCopy(value, keys, code, phase) {
  if (!exact(value, keys)) fail(code, phase);
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
function unorderedRecordCopy(value, keys, code, phase) {
  if (!plain(value)) fail(code, phase);
  const descriptors = Object.getOwnPropertyDescriptors(value); const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some((name) => typeof name !== "string" || !keys.includes(name))) fail(code, phase);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value")) fail(code, phase);
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}
function stringArray(value, pattern, minimum = 0) {
  return dense(value) && value.length >= minimum && value.every((item) => matches(item, pattern));
}
function principal(value, code, phase) {
  const copy = recordCopy(value, ["id", "root", "containerdAddress", "containersNamespace", "pluginsNamespace", "imageIds"], code, phase);
  if (!matches(copy.id, PRINCIPAL_ID) || copy.root !== "/var/lib/docker"
    || copy.containerdAddress !== "/run/containerd/containerd.sock" || copy.containersNamespace !== "moby"
    || copy.pluginsNamespace !== "plugins.moby" || !stringArray(copy.imageIds, IMAGE)
    || copy.imageIds.length !== 2 || new Set(copy.imageIds).size !== 2
    || !isDeepStrictEqual(copy.imageIds, [...copy.imageIds].sort())) fail(code, phase);
  return deepFreeze({ ...copy, imageIds: [...copy.imageIds] });
}
function acceptance(value, code, phase) {
  const copy = recordCopy(value, ["path", "bytes", "sha256"], code, phase);
  if (!isDeepStrictEqual(copy, ACCEPTANCE)) fail(code, phase);
  return deepFreeze(copy);
}
function deadlinePolicy(value, code, phase) {
  const copy = recordCopy(value, ["workerCutoffBeforeDaemonMs", "termMs", "killAndDrainMs", "bookkeepingMs",
    "stopEntryBeforeDaemonMs", "postStopMs", "controllerAfterDaemonMs"], code, phase);
  if (!isDeepStrictEqual(copy, gosuRetainedPairControllerV1Contract.deadlinePolicy)) fail(code, phase);
  return deepFreeze(copy);
}
function manifestEntry(value, code, phase) {
  const copy = recordCopy(value, ["path", "gitMode", "bytes", "sha256", "gitBlobSha1"], code, phase);
  if (typeof copy.path !== "string" || copy.path.length === 0 || Buffer.from(copy.path).includes(0)
    || copy.path.includes("\\") || copy.path.startsWith("/") || copy.path.endsWith("/")
    || copy.path.split("/").some((part) => part === "" || part === "." || part === "..")
    || !["100644", "100755"].includes(copy.gitMode) || !safeInteger(copy.bytes)
    || !matches(copy.sha256, HEX64) || !matches(copy.gitBlobSha1, HEX40)) fail(code, phase);
  return deepFreeze(copy);
}
function gitSortName(entry) { return entry.directory ? `${entry.name}/` : entry.name; }
function gitTreeId(entries) {
  const root = { directories: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/"); let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.directories.has(part)) node.directories.set(part, { directories: new Map(), files: [] });
      node = node.directories.get(part);
    }
    node.files.push({ name: parts.at(-1), mode: entry.gitMode, oid: entry.gitBlobSha1, directory: false });
  }
  const build = (node) => {
    const children = [...node.files];
    for (const [name, child] of node.directories) children.push({ name, mode: "40000", oid: build(child), directory: true });
    children.sort((left, right) => Buffer.compare(Buffer.from(gitSortName(left)), Buffer.from(gitSortName(right))));
    const chunks = [];
    for (const child of children) chunks.push(Buffer.from(`${child.mode} ${child.name}\0`), Buffer.from(child.oid, "hex"));
    return gitObjectId("tree", Buffer.concat(chunks));
  };
  return build(root);
}
function sourceManifest(value, code, phase) {
  const copy = recordCopy(value, ["kind", "entries", "calcTreeGitSha1"], code, phase);
  if (copy.kind !== "GOSU_RETAINED_PAIR_SOURCE_MANIFEST_V1" || !dense(copy.entries) || copy.entries.length === 0
    || !matches(copy.calcTreeGitSha1, HEX40)) fail(code, phase);
  const entries = copy.entries.map((entry) => manifestEntry(entry, code, phase));
  const paths = entries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length || !isDeepStrictEqual(paths, [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))))) {
    fail(code, phase);
  }
  if (gitTreeId(entries) !== copy.calcTreeGitSha1) fail(code, phase);
  return deepFreeze({ kind: copy.kind, entries, calcTreeGitSha1: copy.calcTreeGitSha1 });
}
function base64Record(value, cap, code, phase) {
  const copy = recordCopy(value, ["encoding", "bytes", "base64"], code, phase);
  if (copy.encoding !== "base64" || !safeInteger(copy.bytes) || copy.bytes > cap || typeof copy.base64 !== "string") fail(code, phase);
  let bytes;
  try { bytes = Buffer.from(copy.base64, "base64"); } catch { fail(code, phase); }
  if (bytes.length !== copy.bytes || bytes.toString("base64") !== copy.base64) fail(code, phase);
  return { copy: deepFreeze(copy), bytes };
}

export const gosuRetainedPairControllerV1Contract = deepFreeze({
  kind: "GOSU_RETAINED_PAIR_CONTROLLER_V1_CONTRACT",
  kinds: { input: "GOSU_RETAINED_PAIR_CONTROLLER_INPUT_V1", control: "GOSU_RETAINED_PAIR_CONTROLLER_CONTROL_V1",
    receipt: "GOSU_RETAINED_PAIR_PRESERVATION_RECEIPT_V1", ack: "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1",
    failure: "GOSU_RETAINED_PAIR_CONTROLLER_FAILURE_V1" },
  node: { path: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node", version: "v22.23.2", bytes: 124836408,
    sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327" },
  setpriv: { path: "/usr/bin/setpriv", version: "setpriv from util-linux 2.39.3", bytes: 39304,
    sha256: "62ec0120791f3afcfb689fed52384ec2b0accc6e118a6b9a1d6fcfa7450aaf37", uid: 0, gid: 0, mode: 493, nlink: 1 },
  environment: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: "LEASE_DOCKER_CONFIG" },
  caps: { inputBytes: 65536, controlBytes: 16777216, transportBytes: 16777216, stdoutBytes: 8388608,
    stderrBytes: 0, commitRawBytes: 1048576 },
  deadlinePolicy: { workerCutoffBeforeDaemonMs: 90000, termMs: 10000, killAndDrainMs: 15000, bookkeepingMs: 5000,
    stopEntryBeforeDaemonMs: 60000, postStopMs: 180000, controllerAfterDaemonMs: 160000 },
  receiptBasename: RECEIPT_BASENAME,
  phases: CONTROLLER_PHASES,
  errorCodes: CONTROLLER_CODES,
});

const loadedCapabilities = new WeakMap();
const consumedCapabilities = new WeakSet();
const reservedExecutions = new Set();

function validateControl(value, expectedSha256) {
  const code = "gosu_retained_pair_controller_control_invalid"; const phase = "CONTROL";
  const copy = recordCopy(value, ["kind", "executionId", "baselineRevision", "baselineTree", "controllerRevision", "controllerTree",
    "pr188Revision", "pr188Tree", "commitRaw", "commitRawSha1", "sourceManifest", "sourceManifestSha256", "acceptance",
    "principal", "deadlinePolicy"], code, phase);
  if (copy.kind !== "GOSU_RETAINED_PAIR_CONTROLLER_CONTROL_V1" || !matches(copy.executionId, EXECUTION)
    || copy.baselineRevision !== BASELINE_REVISION || copy.baselineTree !== BASELINE_TREE
    || copy.pr188Revision !== PR188_REVISION || copy.pr188Tree !== PR188_TREE
    || !matches(copy.controllerRevision, HEX40) || !matches(copy.controllerTree, HEX40) || !matches(copy.commitRawSha1, HEX40)
    || !matches(expectedSha256, HEX64)) fail(code, phase);
  const manifest = sourceManifest(copy.sourceManifest, code, phase);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (!matches(copy.sourceManifestSha256, HEX64) || sha256(manifestBytes) !== copy.sourceManifestSha256
    || manifest.calcTreeGitSha1 !== copy.controllerTree) fail(code, phase);
  const raw = base64Record(copy.commitRaw, gosuRetainedPairControllerV1Contract.caps.commitRawBytes, code, phase);
  if (gitObjectId("commit", raw.bytes) !== copy.commitRawSha1 || copy.commitRawSha1 !== copy.controllerRevision
    || !raw.bytes.subarray(0, 46).equals(Buffer.from(`tree ${copy.controllerTree}\n`))) fail(code, phase);
  return deepFreeze({ ...copy, commitRaw: raw.copy, sourceManifest: manifest,
    acceptance: acceptance(copy.acceptance, code, phase), principal: principal(copy.principal, code, phase),
    deadlinePolicy: deadlinePolicy(copy.deadlinePolicy, code, phase), expectedSha256 });
}

export function loadGosuRetainedPairControllerControlV1(bytes, expectedSha256) {
  const ownedBytes = ownedBuffer(bytes, gosuRetainedPairControllerV1Contract.caps.controlBytes,
    "gosu_retained_pair_controller_control_invalid", "CONTROL");
  const value = canonicalJson(ownedBytes, gosuRetainedPairControllerV1Contract.caps.controlBytes, true,
    "gosu_retained_pair_controller_control_invalid", "CONTROL", true);
  if (!matches(expectedSha256, HEX64) || sha256(ownedBytes) !== expectedSha256) {
    fail("gosu_retained_pair_controller_control_invalid", "CONTROL");
  }
  const control = validateControl(value, expectedSha256);
  const capability = Object.freeze(Object.create(null));
  loadedCapabilities.set(capability, control);
  return capability;
}

function validateInput(bytes, control) {
  const value = canonicalJson(bytes, gosuRetainedPairControllerV1Contract.caps.inputBytes, false,
    "gosu_retained_pair_controller_input_invalid", "INPUT");
  const copy = recordCopy(value, ["kind", "executionId", "nonce", "parent", "principal"],
    "gosu_retained_pair_controller_input_invalid", "INPUT");
  if (copy.kind !== "GOSU_RETAINED_PAIR_CONTROLLER_INPUT_V1" || copy.executionId !== control.executionId
    || !matches(copy.executionId, EXECUTION) || !matches(copy.nonce, HEX24) || !matches(copy.parent, /^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u)) {
    fail("gosu_retained_pair_controller_input_invalid", "INPUT");
  }
  const acceptedPrincipal = principal(copy.principal, "gosu_retained_pair_controller_input_invalid", "INPUT");
  if (!isDeepStrictEqual(acceptedPrincipal, control.principal)) fail("gosu_retained_pair_controller_input_invalid", "INPUT");
  return deepFreeze({ ...copy, principal: acceptedPrincipal });
}
function validateRuntimeAbortSignal(signal, code = "gosu_retained_pair_controller_input_invalid", phase = "INPUT",
  cleanup = "NOT_STARTED") {
  if (types.isProxy(signal) || signal === null || typeof signal !== "object"
    || Object.getPrototypeOf(signal) !== RUNTIME_ABORT_SIGNAL_PROTOTYPE) fail(code, phase, cleanup);
  const keys = Reflect.ownKeys(signal);
  const symbols = [];
  for (const key of keys) {
    if (typeof key !== "symbol") fail(code, phase, cleanup);
    if (!ALLOWED_ABORT_SIGNAL_SYMBOLS.has(key)) fail(code, phase, cleanup);
    const descriptor = Object.getOwnPropertyDescriptor(signal, key);
    if (!descriptor || !("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined
      || descriptor.writable !== true || descriptor.enumerable !== true || descriptor.configurable !== true) {
      fail(code, phase, cleanup);
    }
    symbols.push(key);
  }
  if (MANDATORY_ABORT_SIGNAL_SYMBOLS.length !== 7 || MANDATORY_ABORT_SIGNAL_SYMBOLS.some((key) => !symbols.includes(key))) {
    fail(code, phase, cleanup);
  }
  return signal;
}
function runtimeSignalAborted(signal, code = "gosu_retained_pair_controller_input_invalid", phase = "INPUT",
  cleanup = "NOT_STARTED") {
  let aborted;
  try { aborted = Reflect.apply(RUNTIME_ABORTED_GETTER, signal, []); }
  catch { fail(code, phase, cleanup); }
  if (typeof aborted !== "boolean") fail(code, phase, cleanup);
  return aborted;
}
function validateOptions(options) {
  if (!exact(options, []) && !exact(options, ["signal"])) fail("gosu_retained_pair_controller_input_invalid", "INPUT");
  if (Object.hasOwn(options, "signal")) {
    validateRuntimeAbortSignal(options.signal);
    runtimeSignalAborted(options.signal);
  }
  return options.signal;
}
let lastObservedTime = -1;
function time(phase, code = "gosu_retained_pair_controller_worker_timeout") {
  const value = Date.now();
  if (!safeInteger(value) || value < lastObservedTime) fail(code, phase, "UNCERTAIN");
  lastObservedTime = value;
  return value;
}
function bigintSnapshot(stat) {
  return deepFreeze({ dev: String(stat.dev), ino: String(stat.ino), mode: Number(stat.mode), nlink: Number(stat.nlink), size: Number(stat.size),
    uid: Number(stat.uid), gid: Number(stat.gid), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), birthtimeNs: String(stat.birthtimeNs) });
}
function projectedPhysical(stat) {
  return deepFreeze({ dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid), gid: String(stat.gid), mode: Number(stat.mode),
    nlink: String(stat.nlink), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) });
}
function projectedDirectory(stat) {
  return deepFreeze({ dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid), gid: String(stat.gid), mode: Number(stat.mode),
    nlink: String(stat.nlink), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) });
}
function closeOnce(fd, state) {
  if (fd === undefined || state.closed) return;
  state.closed = true;
  try { closeSync(fd); } catch { state.uncertain = true; }
}
function readDescriptor(fd, maximum) {
  const stat = fstatSync(fd, { bigint: true });
  if (stat.size > BigInt(maximum) || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("oversize");
  const bytes = Buffer.alloc(Number(stat.size)); let offset = 0;
  while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (count === 0) break; offset += count; }
  if (offset !== bytes.length) throw new Error("short_read");
  return { bytes, stat };
}
function namedHeld(file, fd, expected, kind) {
  const held = fstatSync(fd, { bigint: true }); const named = lstatSync(file, { bigint: true });
  if (kind === "file" && (!held.isFile() || held.isSymbolicLink()) || kind === "directory" && (!held.isDirectory() || held.isSymbolicLink())
    || !isDeepStrictEqual(bigintSnapshot(held), bigintSnapshot(named)) || realpathSync(file) !== file
    || expected !== undefined && !isDeepStrictEqual(bigintSnapshot(held), expected)) throw new Error("identity");
  return held;
}
function checkTool(pin) {
  let fd; const closeState = { closed: false, uncertain: false };
  try {
    const file = realpathSync(pin.path); if (file !== pin.path) throw new Error("path");
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const { bytes, stat } = readDescriptor(fd, pin.bytes);
    const named = lstatSync(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== BigInt(pin.uid ?? 0) || stat.gid !== BigInt(pin.gid ?? 0)
      || stat.nlink !== BigInt(pin.nlink ?? 1) || Number(stat.mode & 0o7777n) !== (pin.mode ?? 0o755)
      || Number(stat.size) !== pin.bytes || sha256(bytes) !== pin.sha256
      || !isDeepStrictEqual(bigintSnapshot(stat), bigintSnapshot(named))) throw new Error("tool");
    return bigintSnapshot(stat);
  } catch { fail("gosu_retained_pair_controller_tool_invalid", "PREFLIGHT"); }
  finally { closeOnce(fd, closeState); if (closeState.uncertain) fail("gosu_retained_pair_controller_cleanup_uncertain", "CLEANUP", "UNCERTAIN"); }
}
function walkSource(root, expectedDirectories, relative = "") {
  if (!expectedDirectories.has(relative)) throw new Error("directory");
  const directory = relative ? path.join(root, ...relative.split("/")) : root;
  const directoryStat = lstatSync(directory, { bigint: true });
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== 0n || directoryStat.gid !== 0n
    || Number(directoryStat.mode & 0o7777n) !== 0o555 || realpathSync(directory) !== directory) throw new Error("directory");
  const names = readdirSync(directory).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const files = [];
  for (const name of names) {
    if (name === ".git") throw new Error("git");
    const rel = relative ? `${relative}/${name}` : name; const file = path.join(directory, name);
    const stat = lstatSync(file, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error("symlink");
    if (stat.isDirectory()) files.push(...walkSource(root, expectedDirectories, rel));
    else if (stat.isFile()) files.push(rel); else throw new Error("special");
  }
  return files;
}
function verifySource(control) {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0
    || realpathSync(SOURCE_ROOT) !== SOURCE_ROOT) fail("gosu_retained_pair_controller_source_invalid", "SOURCE");
  const expected = new Map(control.sourceManifest.entries.map((entry) => [entry.path, entry]));
  const expectedDirectories = new Set([""]);
  for (const relative of [...expected.keys(), ACCEPTANCE.path]) {
    const parts = relative.split("/"); parts.pop(); let parent = "";
    for (const part of parts) { parent = parent ? `${parent}/${part}` : part; expectedDirectories.add(parent); }
  }
  let actual;
  try { actual = walkSource(SOURCE_ROOT, expectedDirectories); } catch { fail("gosu_retained_pair_controller_source_invalid", "SOURCE"); }
  const allowedIgnored = ACCEPTANCE.path;
  const trackedActual = actual.filter((item) => item !== allowedIgnored)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (!isDeepStrictEqual(trackedActual, [...expected.keys()])) {
    fail("gosu_retained_pair_controller_source_invalid", "SOURCE");
  }
  for (const [relative, entry] of expected) {
    const file = path.join(SOURCE_ROOT, ...relative.split("/")); let fd; const state = { closed: false, uncertain: false };
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const { bytes, stat } = readDescriptor(fd, entry.bytes);
      const mode = entry.gitMode === "100755" ? 0o555 : 0o444;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0n || stat.gid !== 0n || stat.nlink !== 1n
        || Number(stat.mode & 0o7777n) !== mode || bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256
        || gitObjectId("blob", bytes) !== entry.gitBlobSha1) throw new Error("source");
      namedHeld(file, fd, bigintSnapshot(stat), "file");
    } catch { fail("gosu_retained_pair_controller_source_invalid", "SOURCE"); }
    finally { closeOnce(fd, state); if (state.uncertain) fail("gosu_retained_pair_controller_cleanup_uncertain", "CLEANUP", "UNCERTAIN"); }
  }
  const acceptanceFile = path.join(SOURCE_ROOT, ...ACCEPTANCE.path.split("/")); let fd; const state = { closed: false, uncertain: false };
  try {
    fd = openSync(acceptanceFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const { bytes, stat } = readDescriptor(fd, ACCEPTANCE.bytes);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== 0n || stat.gid !== 0n || stat.nlink !== 1n
      || Number(stat.mode & 0o7777n) !== 0o444 || bytes.length !== ACCEPTANCE.bytes || sha256(bytes) !== ACCEPTANCE.sha256) {
      throw new Error("acceptance");
    }
    namedHeld(acceptanceFile, fd, bigintSnapshot(stat), "file");
  } catch { fail("gosu_retained_pair_controller_acceptance_invalid", "PREFLIGHT"); }
  finally { closeOnce(fd, state); if (state.uncertain) fail("gosu_retained_pair_controller_cleanup_uncertain", "CLEANUP", "UNCERTAIN"); }
}
function verifyParent(parent) {
  try {
    const stat = lstatSync(parent, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0n || stat.gid !== 1000n || stat.nlink !== 2n
      || Number(stat.mode & 0o7777n) !== 0o710 || readdirSync(parent).length !== 0 || realpathSync(parent) !== parent) throw new Error("parent");
    const capacity = statfsSync(parent, { bigint: true });
    if (capacity.bavail * capacity.bsize < 8n * BigInt(GiB)) throw new Error("capacity");
    try { lstatSync(path.join(parent, "preservation")); throw new Error("preservation"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  } catch { fail("gosu_retained_pair_controller_source_invalid", "PREFLIGHT"); }
}
function sourceClosure(control) {
  return validateGosuRetainedPairSourceClosureV1({ kind: "GOSU_RETAINED_PAIR_SOURCE_CLOSURE_V1",
    executionId: control.executionId, deploymentRoot: SOURCE_ROOT, manifest: control.sourceManifest,
    manifestSha256: control.sourceManifestSha256, calcTreeGitSha1: control.sourceManifest.calcTreeGitSha1,
    commitRawSha1: control.commitRawSha1, acceptance: control.acceptance });
}
function procProof(pid, workerPath) {
  const statText = readFileSync(`/proc/${pid}/stat`, "utf8"); const end = statText.lastIndexOf(")");
  if (end < 2) throw new Error("stat"); const fields = statText.slice(end + 2).trim().split(" ");
  const state = fields[0]; const pgrp = Number(fields[2]); const session = Number(fields[3]); const startTicks = fields[19];
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const uid = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/mu.exec(status);
  const gid = /^Gid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/mu.exec(status);
  const groups = /^Groups:[ \t]*(.*)$/mu.exec(status); const nnp = /^NoNewPrivs:[ \t]+(\d+)$/mu.exec(status);
  const caps = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].map((name) => new RegExp(`^${name}:\\s+([0-9a-f]{16})$`, "mu").exec(status)?.[1]);
  const exe = realpathSync(`/proc/${pid}/exe`);
  const cmdline = readFileSync(`/proc/${pid}/cmdline`);
  if (cmdline.length === 0 || cmdline.at(-1) !== 0) throw new Error("cmdline");
  const argv = cmdline.subarray(0, -1).toString("utf8").split("\0");
  if (state === "Z" || pgrp !== pid || session !== pid || !matches(startTicks, START_TICKS)
    || !uid || !gid || uid.slice(1).some((item) => item !== "1000") || gid.slice(1).some((item) => item !== "1000")
    || !groups || groups[1].trim() !== "" || nnp?.[1] !== "1" || caps.some((item) => item !== "0000000000000000")
    || exe !== gosuRetainedPairControllerV1Contract.node.path
    || !isDeepStrictEqual(argv, [gosuRetainedPairControllerV1Contract.node.path, workerPath])) throw new Error("identity");
  return deepFreeze({ pid, startTicks, uid: 1000, gid: 1000, pgrp, session, exe, argv });
}
async function establishLeader(child, workerPath) {
  const until = time("WORKER_START") + 2000; let previous;
  while (time("WORKER_START") <= until) {
    try {
      const current = procProof(child.pid, workerPath);
      if (previous && isDeepStrictEqual(previous, current)) return current;
      previous = current; await delay(25);
    } catch { previous = undefined; await delay(25); }
  }
  fail("gosu_retained_pair_controller_worker_identity_invalid", "WORKER_START", "UNCERTAIN");
}
function freshLeader(expected, workerPath) {
  const current = procProof(expected.pid, workerPath);
  return isDeepStrictEqual(current, expected) ? current : undefined;
}
async function terminateGroup(expected, workerPath, closePromise) {
  let uncertain = false;
  try { if (!freshLeader(expected, workerPath)) return true; process.kill(-expected.pid, "SIGTERM"); } catch { return true; }
  const term = await Promise.race([closePromise.then(() => true), delay(10000).then(() => false)]);
  if (term) return false;
  try { if (!freshLeader(expected, workerPath)) return true; process.kill(-expected.pid, "SIGKILL"); } catch { return true; }
  const killed = await Promise.race([closePromise.then(() => true), delay(15000).then(() => false)]);
  if (!killed) uncertain = true;
  return uncertain;
}
function boundedStream(stream, cap, state) {
  stream.on("data", (chunk) => { if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk); state.bytes += chunk.length;
    if (state.bytes <= cap) state.chunks.push(Buffer.from(chunk)); else state.overflow = true; });
  stream.on("end", () => { state.ended = true; });
  stream.on("close", () => { state.closed = true; });
  stream.on("error", () => { state.error = true; });
}
function workerFailure(bytes) {
  const value = canonicalJson(bytes, gosuRetainedPairControllerV1Contract.caps.stdoutBytes, false,
    "gosu_retained_pair_controller_worker_cleanup_uncertain", "WORKER_RUN");
  const copy = recordCopy(value, ["kind", "state", "code", "phase", "cleanup", "authority", "preservation", "dates"],
    "gosu_retained_pair_controller_worker_cleanup_uncertain", "WORKER_RUN");
  const workerCodes = new Set(["gosu_retained_pair_worker_input_invalid", "gosu_retained_pair_worker_source_invalid",
    "gosu_retained_pair_worker_environment_invalid", "gosu_retained_pair_worker_producer_failed",
    "gosu_retained_pair_worker_result_invalid", "gosu_retained_pair_worker_cleanup_uncertain"]);
  const workerPhases = new Set(["INPUT", "SOURCE", "ENVIRONMENT", "PRODUCER", "RESULT", "CLEANUP"]);
  if (copy.kind !== "GOSU_RETAINED_PAIR_WORKER_FAILURE_V1" || copy.state !== "FAILED" || !workerCodes.has(copy.code)
    || !workerPhases.has(copy.phase) || !CLEANUPS.has(copy.cleanup) || copy.authority !== "NOT_AUTHORIZED"
    || copy.preservation !== "NOT_ESTABLISHED" || copy.dates !== null) {
    fail("gosu_retained_pair_controller_worker_cleanup_uncertain", "WORKER_RUN", "UNCERTAIN");
  }
  return copy.cleanup;
}
async function runWorker(lease, input, closure, signal) {
  const workerPath = realpathSync(fileURLToPath(WORKER_URL));
  const cutoff = lease.identity.deadlineAtMs - gosuRetainedPairControllerV1Contract.deadlinePolicy.workerCutoffBeforeDaemonMs;
  let transportBytes;
  try {
    const transport = deepFreeze({ kind: "GOSU_RETAINED_PAIR_WORKER_TRANSPORT_V1",
      input: { purpose: "GOSU_DERIVATIVE_IMAGE_RETAINED_BUILD_PROOF_V1", nonce: input.nonce, lease: lease.identity },
      sourceClosure: closure });
    transportBytes = Buffer.from(`${JSON.stringify(transport)}\n`);
  } catch { fail("gosu_retained_pair_controller_worker_result_invalid", "WORKER_RUN"); }
  if (transportBytes.length > gosuRetainedPairControllerV1Contract.caps.transportBytes) {
    fail("gosu_retained_pair_controller_worker_result_invalid", "WORKER_RUN");
  }
  const argv = ["--reuid=1000", "--regid=1000", "--clear-groups", "--no-new-privs", "--inh-caps=-all", "--ambient-caps=-all",
    "--bounding-set=-all", gosuRetainedPairControllerV1Contract.node.path, workerPath];
  const environment = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: lease.identity.dockerConfig };
  if ((signal !== undefined && runtimeSignalAborted(signal, "gosu_retained_pair_controller_worker_timeout", "WORKER_START"))
    || time("WORKER_START") >= cutoff) {
    fail("gosu_retained_pair_controller_worker_timeout", "WORKER_START");
  }
  let child;
  try { child = spawn(gosuRetainedPairControllerV1Contract.setpriv.path, argv,
    { detached: true, env: environment, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true }); }
  catch { fail("gosu_retained_pair_controller_worker_spawn_failed", "WORKER_START", "UNCERTAIN"); }
  let spawnedError;
  child.once("error", (error) => { spawnedError = error; });
  if (!safeInteger(child.pid, 2) || !child.stdin || !child.stdout || !child.stderr) {
    fail("gosu_retained_pair_controller_worker_spawn_failed", "WORKER_START", "UNCERTAIN");
  }
  const stdout = { chunks: [], bytes: 0, overflow: false, ended: false, closed: false };
  const stderr = { chunks: [], bytes: 0, overflow: false, ended: false, closed: false };
  const stdin = { finished: false, closed: false, error: false };
  boundedStream(child.stdout, gosuRetainedPairControllerV1Contract.caps.stdoutBytes, stdout);
  boundedStream(child.stderr, gosuRetainedPairControllerV1Contract.caps.stderrBytes, stderr);
  child.stdin.on("finish", () => { stdin.finished = true; });
  child.stdin.on("close", () => { stdin.closed = true; });
  child.stdin.on("error", () => { stdin.error = true; });
  let childClosed = false;
  const closePromise = new Promise((resolve) => child.once("close", (code, closeSignal) => {
    childClosed = true; resolve({ code, signal: closeSignal });
  }));
  let proof;
  try { proof = await establishLeader(child, workerPath); }
  catch {
    try { child.stdin.end(); } catch { fail("gosu_retained_pair_controller_worker_identity_invalid", "WORKER_START", "UNCERTAIN"); }
    const closed = await Promise.race([closePromise.then(() => true), delay(30000).then(() => false)]);
    const settledCleanly = closed && stdin.finished && stdin.closed && !stdin.error && stdout.ended && stdout.closed && !stdout.error
      && stderr.ended && stderr.closed && !stderr.error;
    fail("gosu_retained_pair_controller_worker_identity_invalid", "WORKER_START", settledCleanly ? "CONFIRMED" : "UNCERTAIN");
  }
  const rejectAfterProof = async (error, fallbackCode, fallbackPhase) => {
    const metadata = failureMetadata(error);
    const signalUncertain = childClosed ? false : await terminateGroup(proof, workerPath, closePromise);
    const drainsUncertain = !stdin.finished || !stdin.closed || stdin.error || !stdout.ended || !stdout.closed || stdout.error
      || !stderr.ended || !stderr.closed || stderr.error;
    const code = CODE_SET.has(metadata.code) ? metadata.code : fallbackCode;
    const phase = CONTROLLER_PHASES.includes(metadata.phase) ? metadata.phase : fallbackPhase;
    fail(code, phase, metadata.cleanup === "UNCERTAIN" || signalUncertain || drainsUncertain ? "UNCERTAIN" : "CONFIRMED");
  };
  let preTransportError;
  try {
    if ((signal !== undefined && runtimeSignalAborted(signal, "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN", "UNCERTAIN"))
      || time("WORKER_RUN") >= cutoff) {
      preTransportError = failure("gosu_retained_pair_controller_worker_timeout", "WORKER_RUN");
    }
  } catch (error) { preTransportError = error; }
  if (preTransportError) {
    try { child.stdin.end(); } catch { stdin.error = true; }
    await rejectAfterProof(preTransportError, "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN");
  }
  try { child.stdin.end(transportBytes); }
  catch (error) {
    await rejectAfterProof(error, "gosu_retained_pair_controller_worker_cleanup_uncertain", "WORKER_RUN");
  }
  let timeoutMs;
  try { timeoutMs = Math.max(0, cutoff - time("WORKER_RUN")); }
  catch (error) { await rejectAfterProof(error, "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN"); }
  let abortHandler; let resolveAbort;
  const abortPromise = signal === undefined ? new Promise(() => {}) : new Promise((resolve) => { resolveAbort = resolve; });
  if (signal !== undefined) {
    try {
      validateRuntimeAbortSignal(signal, "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN", "UNCERTAIN");
      if (runtimeSignalAborted(signal, "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN", "UNCERTAIN")) {
        resolveAbort({ timeout: true });
      } else {
        abortHandler = () => resolveAbort({ timeout: true });
        addAbortListener(signal, abortHandler);
        if (runtimeSignalAborted(signal, "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN", "UNCERTAIN")) {
          resolveAbort({ timeout: true });
        }
      }
    } catch {
      if (abortHandler) {
        try { Reflect.apply(RUNTIME_REMOVE_EVENT_LISTENER, signal, ["abort", abortHandler]); } catch { /* cleanup remains uncertain */ }
      }
      await rejectAfterProof(failure("gosu_retained_pair_controller_worker_timeout", "WORKER_RUN", "UNCERTAIN"),
        "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN");
    }
  }
  let timer; const timeoutPromise = new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), timeoutMs); });
  const settled = await Promise.race([closePromise, timeoutPromise, abortPromise]); globalThis.clearTimeout(timer);
  if (abortHandler) {
    try { Reflect.apply(RUNTIME_REMOVE_EVENT_LISTENER, signal, ["abort", abortHandler]); }
    catch { await rejectAfterProof(failure("gosu_retained_pair_controller_worker_timeout", "WORKER_RUN", "UNCERTAIN"),
      "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN"); }
  }
  let cutoffReached; let aborted = false;
  try {
    cutoffReached = time("WORKER_RUN") >= cutoff;
    if (signal !== undefined) {
      aborted = runtimeSignalAborted(signal, "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN", "UNCERTAIN");
    }
  }
  catch (error) { await rejectAfterProof(error, "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN"); }
  const interrupted = settled.timeout || aborted || cutoffReached;
  if (interrupted) {
    await rejectAfterProof(failure("gosu_retained_pair_controller_worker_timeout", "WORKER_RUN"),
      "gosu_retained_pair_controller_worker_timeout", "WORKER_RUN");
  }
  if (spawnedError || settled.signal !== null || !stdin.finished || !stdin.closed || stdin.error
    || !stdout.ended || !stdout.closed || stdout.error || !stderr.ended || !stderr.closed || stderr.error
    || stdout.overflow || stderr.overflow || stderr.bytes !== 0 || ![0, 1].includes(settled.code)) {
    fail("gosu_retained_pair_controller_worker_cleanup_uncertain", "WORKER_RUN", "UNCERTAIN");
  }
  const output = Buffer.concat(stdout.chunks);
  if (settled.code === 1) {
    const reportedCleanup = workerFailure(output);
    fail(reportedCleanup === "UNCERTAIN" ? "gosu_retained_pair_controller_worker_cleanup_uncertain"
      : "gosu_retained_pair_controller_worker_result_invalid", "WORKER_RUN", reportedCleanup);
  }
  return { bytes: output, processSupervision: deepFreeze({ groupSignalScope: "PROVEN_PROCESS_GROUP_ONLY",
    observationSignalRace: "RESIDUAL", allDescendantsGuaranteed: false, externalWatcher: "REQUIRED_FOR_ACTUAL" }),
  worker: deepFreeze({ kind: "GOSU_RETAINED_PAIR_WORKER_RESULT_V1", state: "SUCCEEDED", scope: "GENUINE_DEFAULT_PRODUCER_ONCE",
    exitCode: 0, closed: true, stdoutEnded: true, stderrEnded: true }) };
}
function physical(value, kind, code, phase) {
  const keys = ["dev", "ino", "mode", "nlink", "size", "uid", "gid", "mtimeNs", "ctimeNs", "birthtimeNs"];
  const copy = recordCopy(value, keys, code, phase);
  for (const key of ["dev", "ino", "mtimeNs", "ctimeNs", "birthtimeNs"]) if (!matches(copy[key], DECIMAL)) fail(code, phase);
  for (const key of ["mode", "nlink", "size", "uid", "gid"]) if (!safeInteger(copy[key])) fail(code, phase);
  if (kind === "file" && (copy.mode !== 0o100600 || copy.uid !== 1000 || copy.gid !== 1000 || copy.nlink !== 1)) fail(code, phase);
  if (kind === "directory" && (copy.mode !== 0o40700 || copy.uid !== 1000 || copy.gid !== 1000 || copy.nlink !== 2)) fail(code, phase);
  return deepFreeze(copy);
}
function archive(value, code, phase) {
  const copy = recordCopy(value, ["bytes", "sha256"], code, phase);
  if (!safeInteger(copy.bytes, 1) || copy.bytes > GiB || !matches(copy.sha256, HEX64)) fail(code, phase);
  return deepFreeze(copy);
}
function buildWindow(value, lease, code, phase) {
  const copy = recordCopy(value, ["startedAtMs", "completedAtMs"], code, phase);
  if (!safeInteger(copy.startedAtMs) || !safeInteger(copy.completedAtMs) || copy.startedAtMs > copy.completedAtMs
    || copy.completedAtMs - copy.startedAtMs > 600000 || copy.startedAtMs < lease.deadlineAtMs - 600000
    || copy.completedAtMs > lease.deadlineAtMs - 25000) fail(code, phase);
  return deepFreeze(copy);
}
function encoded(value, code, phase) {
  const copy = recordCopy(value, ["encoding", "bytes", "sha256", "base64"], code, phase);
  if (copy.encoding !== "base64" || !safeInteger(copy.bytes) || copy.bytes > 2 * 1024 ** 2 || !matches(copy.sha256, HEX64)
    || typeof copy.base64 !== "string") fail(code, phase);
  const bytes = Buffer.from(copy.base64, "base64");
  if (bytes.length !== copy.bytes || bytes.toString("base64") !== copy.base64 || sha256(bytes) !== copy.sha256) fail(code, phase);
  return deepFreeze(copy);
}
function commandProfile(value, expectedArgs, representation, parsedValidator, code, phase) {
  const copy = recordCopy(value, ["command", "representation", "parsed", "stdout", "stderr"], code, phase);
  const command = recordCopy(copy.command, ["binary", "args"], code, phase);
  if (command.binary !== "/usr/bin/docker" || !dense(command.args) || !isDeepStrictEqual(command.args, expectedArgs)
    || copy.representation !== representation) fail(code, phase);
  const parsed = parsedValidator(copy.parsed);
  return deepFreeze({ command: { binary: command.binary, args: [...command.args] }, representation: copy.representation,
    parsed, stdout: encoded(copy.stdout, code, phase), stderr: encoded(copy.stderr, code, phase) });
}
function validateResult(value, input, lease) {
  const code = "gosu_retained_pair_controller_worker_result_invalid"; const phase = "WORKER_RUN";
  const top = recordCopy(value, ["state", "authority", "image", "candidateAdmission", "functional", "vulnerabilities", "nonce", "lease",
    "builder", "profiles", "preflight", "context", "buildWindow", "pairProof", "retention", "dates"], code, phase);
  if (top.state !== "IMAGE_PAIR_RETENTION_SNAPSHOT_OBSERVED_REVIEW_PENDING" || top.authority !== "NOT_AUTHORIZED"
    || top.image !== "BUILT_UNVALIDATED" || top.candidateAdmission !== "NOT_AUTHORIZED" || top.functional !== "NOT_ESTABLISHED"
    || top.vulnerabilities !== "NOT_ESTABLISHED" || top.nonce !== input.nonce || top.dates !== null) fail(code, phase);
  const leaseTuple = recordCopy(top.lease, ["daemonId", "pid", "startTicks"], code, phase);
  if (leaseTuple.daemonId !== lease.daemonId || leaseTuple.pid !== lease.pid || leaseTuple.startTicks !== lease.startTicks
    || typeof leaseTuple.daemonId !== "string" || !safeInteger(leaseTuple.pid, 2) || !matches(leaseTuple.startTicks, START_TICKS)) fail(code, phase);
  const window = buildWindow(top.buildWindow, lease, code, phase);
  const profiles = recordCopy(top.profiles, ["stage", "context", "version", "info", "builder"], code, phase);
  if (profiles.stage !== "PRE_CONTEXT") fail(code, phase);
  const prefix = ["--config", lease.dockerConfig, "--context", lease.contextName];
  const contextProfile = commandProfile(profiles.context, [...prefix, "context", "inspect", lease.contextName], "JSON", (parsed) => {
    const copy = recordCopy(parsed, ["name", "endpoint"], code, phase);
    if (copy.name !== lease.contextName || copy.endpoint !== lease.endpoint) fail(code, phase); return copy;
  }, code, phase);
  const versionProfile = commandProfile(profiles.version, [...prefix, "version", "--format", "{{json .}}"], "JSON", (parsed) => {
    const copy = recordCopy(parsed, ["serverVersion"], code, phase); if (copy.serverVersion !== "28.0.4") fail(code, phase); return copy;
  }, code, phase);
  const infoProfile = commandProfile(profiles.info, [...prefix, "info", "--format", "{{json .}}"], "JSON", (parsed) => {
    const copy = recordCopy(parsed, ["daemonId", "dataRoot", "os", "arch", "driver", "containerdAddress", "namespaces"], code, phase);
    const namespaces = recordCopy(copy.namespaces, ["containers", "plugins"], code, phase);
    if (copy.daemonId !== lease.daemonId || copy.dataRoot !== lease.dataRoot || copy.os !== "linux" || copy.arch !== "x86_64"
      || copy.driver !== "overlay2" || copy.containerdAddress !== lease.containerdAddress
      || namespaces.containers !== lease.containersNamespace || namespaces.plugins !== lease.pluginsNamespace) fail(code, phase);
    return { ...copy, namespaces };
  }, code, phase);
  const builderRaw = recordCopy(profiles.builder, ["command", "representation", "parsed", "stdout", "stderr"], code, phase);
  if (!["FORMAT_ONLY_JSON", "NATIVE_TEXT"].includes(builderRaw.representation)) fail(code, phase);
  const builderProfile = commandProfile(profiles.builder, [...prefix, "buildx", "inspect"], builderRaw.representation, (parsed) => {
    const copy = recordCopy(parsed, ["name", "nodeName", "driver", "endpoint", "status", "buildkit", "platforms", "representation"], code, phase);
    const platforms = typeof copy.platforms === "string" ? copy.platforms.split(",").map((item) => item.trim().replace(/\*$/u, "")) : [];
    if (copy.name !== (copy.representation === "FORMAT_ONLY_JSON" ? null : lease.contextName) || copy.nodeName !== lease.contextName
      || copy.driver !== "docker" || ![lease.endpoint, lease.contextName].includes(copy.endpoint)
      || typeof copy.status !== "string" || copy.status.toLowerCase() !== "running" || typeof copy.buildkit !== "string" || copy.buildkit.length === 0
      || !platforms.includes("linux/amd64") || copy.representation !== builderRaw.representation) fail(code, phase);
    return copy;
  }, code, phase);
  const builder = recordCopy(top.builder, ["driver", "endpoint", "platforms", "representation"], code, phase);
  if (builder.driver !== builderProfile.parsed.driver || builder.endpoint !== builderProfile.parsed.endpoint
    || builder.platforms !== builderProfile.parsed.platforms || builder.representation !== builderProfile.parsed.representation) fail(code, phase);
  const preflight = recordCopy(top.preflight, ["acceptance", "source", "context"], code, phase);
  if (!isDeepStrictEqual(recordCopy(preflight.acceptance, ["bytes", "sha256"], code, phase), { bytes: ACCEPTANCE.bytes, sha256: ACCEPTANCE.sha256 })
    || !isDeepStrictEqual(recordCopy(preflight.source, ["head", "main", "tree"], code, phase), {
      head: "582fb97e88cf5a498e6ae34ec76eb5736ada2a47", main: "e4fa47cbe66758a5b56f5347c2c27e61bdae1ed0", tree: "7292e98e7ee23e45ebccff075577af41f271dbf9" })
    || !isDeepStrictEqual(recordCopy(preflight.context, ["bytes", "sha256"], code, phase), {
      bytes: 1986560, sha256: "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb" })) fail(code, phase);
  const context = recordCopy(top.context, ["bytes", "sha256", "entries", "physical"], code, phase);
  if (context.bytes !== preflight.context.bytes || context.sha256 !== preflight.context.sha256 || !dense(context.entries) || context.entries.length !== 15) fail(code, phase);
  const expectedContextEntries = new Map(EXPECTED_CONTEXT_ENTRIES.map((entry) => [entry.path, entry])); const seenContextEntries = new Set();
  for (let index = 0; index < context.entries.length; index++) {
    const item = context.entries[index];
    if (!plain(item)) fail(code, phase);
    const pathDescriptor = Object.getOwnPropertyDescriptor(item, "path");
    if (!pathDescriptor || !Object.hasOwn(pathDescriptor, "value") || pathDescriptor.enumerable !== true) fail(code, phase);
    const wanted = expectedContextEntries.get(pathDescriptor.value);
    if (wanted === undefined || seenContextEntries.has(pathDescriptor.value)) fail(code, phase);
    seenContextEntries.add(pathDescriptor.value);
    const directory = wanted.type === "directory";
    const keys = directory ? ["ordinal", "headerOffset", "dataOffset", "path", "type", "mode", "uid", "gid", "mtime", "size"]
      : ["ordinal", "headerOffset", "dataOffset", "path", "type", "mode", "uid", "gid", "mtime", "size", "sha256"];
    const entry = recordCopy(item, keys, code, phase);
    if (entry.ordinal !== index || !safeInteger(entry.headerOffset) || entry.headerOffset % 512 !== 0 || entry.dataOffset !== entry.headerOffset + 512
      || entry.path !== wanted.path || entry.type !== wanted.type || entry.mode !== wanted.mode || entry.uid !== wanted.uid
      || entry.gid !== wanted.gid || entry.mtime !== wanted.mtime || entry.size !== wanted.size
      || !directory && entry.sha256 !== wanted.sha256) fail(code, phase);
  }
  if (seenContextEntries.size !== EXPECTED_CONTEXT_ENTRIES.length) fail(code, phase);
  const contextPhysical = physical(context.physical, "file", code, phase);
  if (contextPhysical.size !== 1986560) fail(code, phase);
  const proof = recordCopy(top.pairProof, ["scope", "authority", "profile", "base", "candidate", "inheritedLayers", "addedLayers", "configProfile", "delta"], code, phase);
  if (proof.scope !== "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW" || proof.authority !== "NOT_AUTHORIZED"
    || proof.profile !== "POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1" || proof.inheritedLayers !== 10 || proof.addedLayers !== 2
    || proof.configProfile !== "STRICT_INHERITED_CONFIG_V2") fail(code, phase);
  const proofSubject = (subject, layers) => { const copy = recordCopy(subject, ["archive", "configId", "layers"], code, phase);
    const archived = archive(copy.archive, code, phase); if (!matches(copy.configId, IMAGE) || copy.layers !== layers) fail(code, phase);
    return deepFreeze({ archive: archived, configId: copy.configId, layers }); };
  const base = proofSubject(proof.base, 10); const candidate = proofSubject(proof.candidate, 12);
  if (base.configId !== BASE_CONFIG_ID || candidate.configId === base.configId || base.archive.bytes + candidate.archive.bytes > 2 * GiB) fail(code, phase);
  const deltaRecord = recordCopy(proof.delta, ["scope", "authority", "baseMembers", "candidateMembers", "replaced", "addedFiles", "addedDirectories", "mtimeChangedDirectories"], code, phase);
  const addedFiles = ["usr/share/licenses/auto-world-gosu/build-info.txt", "usr/share/licenses/auto-world-gosu/derivative-manifest.json",
    "usr/share/licenses/auto-world-gosu/go-LICENSE", "usr/share/licenses/auto-world-gosu/go-PATENTS", "usr/share/licenses/auto-world-gosu/gosu-LICENSE",
    "usr/share/licenses/auto-world-gosu/moby-user-LICENSE", "usr/share/licenses/auto-world-gosu/module-closure.json",
    "usr/share/licenses/auto-world-gosu/notices.json", "usr/share/licenses/auto-world-gosu/sbom.cdx.json",
    "usr/share/licenses/auto-world-gosu/version.txt", "usr/share/licenses/auto-world-gosu/x-sys-LICENSE", "usr/share/licenses/auto-world-gosu/x-sys-PATENTS"];
  const suffixes = [[], ["usr/share/licenses/auto-world-gosu"], ["usr/share/licenses", "usr/share/licenses/auto-world-gosu"],
    ["usr/share", "usr/share/licenses", "usr/share/licenses/auto-world-gosu"]];
  if (deltaRecord.scope !== "CONDITIONAL_ON_AUTHENTICATED_OCI" || deltaRecord.authority !== "NOT_AUTHORIZED"
    || !safeInteger(deltaRecord.baseMembers, 1) || !safeInteger(deltaRecord.candidateMembers, 1)
    || !dense(deltaRecord.replaced) || !dense(deltaRecord.addedFiles) || !dense(deltaRecord.addedDirectories)
    || !dense(deltaRecord.mtimeChangedDirectories) || !isDeepStrictEqual(deltaRecord.replaced, ["usr/local/bin/gosu"])
    || !isDeepStrictEqual(deltaRecord.addedFiles, addedFiles)
    || !suffixes.some((value) => isDeepStrictEqual(value, deltaRecord.addedDirectories))
    || new Set(deltaRecord.mtimeChangedDirectories).size !== deltaRecord.mtimeChangedDirectories.length
    || !isDeepStrictEqual(deltaRecord.mtimeChangedDirectories, [...deltaRecord.mtimeChangedDirectories].sort())
    || deltaRecord.candidateMembers !== deltaRecord.baseMembers + 12 + deltaRecord.addedDirectories.length) fail(code, phase);
  const allowedMtime = new Set(["usr/local/bin"]);
  if (deltaRecord.addedDirectories.length === 1) allowedMtime.add("usr/share/licenses");
  if (deltaRecord.addedDirectories.length === 2) allowedMtime.add("usr/share");
  if (deltaRecord.addedDirectories.length === 3) allowedMtime.add("usr");
  if (deltaRecord.mtimeChangedDirectories.some((item) => !allowedMtime.has(item)
    || deltaRecord.addedDirectories.includes(item) || item === "usr/local" || item === "usr/share/licenses/auto-world-gosu")) fail(code, phase);
  const retention = recordCopy(top.retention, ["state", "preservation", "authority", "admission", "directory", "buildWindow", "base", "candidate"], code, phase);
  if (retention.state !== "SEALED_SNAPSHOT_REVIEW_PENDING" || retention.preservation !== "FUTURE_CONTROLLER_REQUIRED"
    || retention.authority !== "NOT_AUTHORIZED" || retention.admission !== "NOT_AUTHORIZED"
    || !isDeepStrictEqual(retention.buildWindow, window)) fail(code, phase);
  const directory = physical(retention.directory, "directory", code, phase);
  const retained = (value, name, subject) => { const copy = recordCopy(value, ["name", "archive", "configId", "physical"], code, phase);
    const archived = archive(copy.archive, code, phase); const snapshot = physical(copy.physical, "file", code, phase);
    if (copy.name !== name || copy.configId !== subject.configId || !isDeepStrictEqual(archived, subject.archive) || snapshot.size !== archived.bytes) fail(code, phase);
    return deepFreeze({ name, archive: archived, configId: copy.configId, physical: snapshot }); };
  const retentionBase = retained(retention.base, "base-image.tar", base);
  const retentionCandidate = retained(retention.candidate, "candidate-image.tar", candidate);
  return deepFreeze({ ...top, lease: leaseTuple, builder, profiles: { stage: profiles.stage, context: contextProfile, version: versionProfile,
    info: infoProfile, builder: builderProfile }, preflight, context, buildWindow: window,
    pairProof: { ...proof, base, candidate, delta: deltaRecord }, retention: { ...retention, directory, buildWindow: window,
      base: retentionBase, candidate: retentionCandidate } });
}
function parseWorker(bytes, input, lease) {
  const envelope = canonicalJson(bytes, gosuRetainedPairControllerV1Contract.caps.stdoutBytes, false,
    "gosu_retained_pair_controller_worker_result_invalid", "WORKER_RUN");
  const copy = recordCopy(envelope, ["kind", "state", "scope", "result"], "gosu_retained_pair_controller_worker_result_invalid", "WORKER_RUN");
  if (copy.kind !== "GOSU_RETAINED_PAIR_WORKER_RESULT_V1" || copy.state !== "SUCCEEDED" || copy.scope !== "GENUINE_DEFAULT_PRODUCER_ONCE") {
    fail("gosu_retained_pair_controller_worker_result_invalid", "WORKER_RUN");
  }
  return validateResult(copy.result, input, lease);
}
function fullLeaseIdentity(value, input) {
  const code = "gosu_retained_pair_controller_daemon_start_failed"; const phase = "DAEMON_START";
  const keys = ["purpose", "authority", "admission", "root", "nonce", "socket", "endpoint", "dockerConfig", "buildxConfig",
    "outputDirectory", "contextName", "pid", "startTicks", "daemonId", "version", "dataRoot", "execRoot", "containerdAddress",
    "containersNamespace", "pluginsNamespace", "configSha256", "argvSha256", "deadlineAtMs", "rootActor", "clientActor", "socketProof",
    "socketDirectoryProof"];
  const identity = unorderedRecordCopy(value, keys, code, phase);
  const actor = (raw, uid, gid) => {
    const copy = recordCopy(raw, ["uid", "gid"], code, phase);
    if (copy.uid !== uid || copy.gid !== gid) fail(code, phase, "UNCERTAIN");
    return copy;
  };
  const socketProof = (raw, mode) => {
    const copy = recordCopy(raw, ["dev", "ino", "uid", "gid", "mode"], code, phase);
    if (!matches(copy.dev, DECIMAL) || !matches(copy.ino, DECIMAL)
      || copy.uid !== 0 || copy.gid !== 1000 || copy.mode !== mode) fail(code, phase, "UNCERTAIN");
    return copy;
  };
  if (identity.purpose !== "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION" || identity.authority !== "LOCAL_DIAGNOSTIC"
    || identity.admission !== "NOT_AUTHORIZED" || identity.nonce !== input.nonce || identity.root !== input.parent
    || !matches(identity.root, /^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u)
    || identity.socket !== `${identity.root}/endpoint/docker.sock` || identity.endpoint !== `unix://${identity.socket}`
    || identity.dockerConfig !== `${identity.root}/client` || identity.buildxConfig !== `${identity.root}/client/buildx`
    || identity.outputDirectory !== `${identity.root}/client/output` || identity.contextName !== `aw-cold-${identity.nonce}`
    || !safeInteger(identity.pid, 2) || !matches(identity.startTicks, START_TICKS) || typeof identity.daemonId !== "string"
    || identity.daemonId.length === 0 || identity.version !== "28.0.4" || identity.dataRoot !== `${identity.root}/infra/data`
    || identity.execRoot !== `${identity.root}/infra/exec` || identity.containerdAddress !== input.principal.containerdAddress
    || identity.containersNamespace !== `awcold-${identity.nonce}` || identity.pluginsNamespace !== `plugins.awcold-${identity.nonce}`
    || !matches(identity.configSha256, HEX64) || !matches(identity.argvSha256, HEX64) || !safeInteger(identity.deadlineAtMs, 1)) {
    fail(code, phase, "UNCERTAIN");
  }
  return deepFreeze({ ...identity, rootActor: actor(identity.rootActor, 0, 0), clientActor: actor(identity.clientActor, 1000, 1000),
    socketProof: socketProof(identity.socketProof, 0o660), socketDirectoryProof: socketProof(identity.socketDirectoryProof, 0o710) });
}
function daemonIdentity(identity) {
  const keys = ["purpose", "authority", "admission", "nonce", "pid", "startTicks", "daemonId", "version", "configSha256", "argvSha256",
    "rootActor", "clientActor", "socketProof", "socketDirectoryProof"];
  const actor = (value, uid, gid) => exact(value, ["uid", "gid"]) && value.uid === uid && value.gid === gid;
  const socket = (value, uid, gid, mode) => exact(value, ["dev", "ino", "uid", "gid", "mode"])
    && matches(value.dev, DECIMAL) && matches(value.ino, DECIMAL)
    && value.uid === uid && value.gid === gid && value.mode === mode;
  if (identity.purpose !== "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION" || identity.authority !== "LOCAL_DIAGNOSTIC"
    || identity.admission !== "NOT_AUTHORIZED" || !matches(identity.nonce, HEX24) || !safeInteger(identity.pid, 2)
    || !matches(identity.startTicks, START_TICKS) || typeof identity.daemonId !== "string" || identity.version !== "28.0.4"
    || !matches(identity.configSha256, HEX64) || !matches(identity.argvSha256, HEX64)) {
    fail("gosu_retained_pair_controller_daemon_start_failed", "DAEMON_START", "UNCERTAIN");
  }
  if (!actor(identity.rootActor, 0, 0) || !actor(identity.clientActor, 1000, 1000)
    || !socket(identity.socketProof, 0, 1000, 0o660) || !socket(identity.socketDirectoryProof, 0, 1000, 0o710)) {
    fail("gosu_retained_pair_controller_daemon_start_failed", "DAEMON_START", "UNCERTAIN");
  }
  return deepFreeze(Object.fromEntries(keys.map((key) => [key, identity[key]])));
}
function authenticateLease(value, input) {
  if (!exact(value, ["identity", "verifyIdentity", "verifyInventory", "stop"])) {
    fail("gosu_retained_pair_controller_daemon_start_failed", "DAEMON_START", "UNCERTAIN");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const identity = validateLeaseIdentity(descriptors.identity.value, input);
  const verifyIdentity = descriptors.verifyIdentity.value;
  const verifyInventory = descriptors.verifyInventory.value;
  const stop = descriptors.stop.value;
  if (typeof verifyIdentity !== "function" || typeof verifyInventory !== "function" || typeof stop !== "function") {
    fail("gosu_retained_pair_controller_daemon_start_failed", "DAEMON_START", "UNCERTAIN");
  }
  return Object.freeze({ identity,
    verifyInventory: (...args) => Reflect.apply(verifyInventory, value, args),
    stop: (...args) => Reflect.apply(stop, value, args) });
}
function validateLeaseIdentity(identity, input) {
  return fullLeaseIdentity(identity, input);
}
function validateLeaseDeadline(identity) {
  const now = time("DAEMON_START", "gosu_retained_pair_controller_daemon_start_failed");
  if (identity.deadlineAtMs <= now + 25000 || identity.deadlineAtMs > now + 600000) {
    fail("gosu_retained_pair_controller_daemon_start_failed", "DAEMON_START", "UNCERTAIN");
  }
}
function inventorySubjects(value, expected) {
  const code = "gosu_retained_pair_controller_daemon_inventory_invalid"; const phase = "INVENTORY";
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || value.length !== expected.length || !dense(value)) fail(code, phase, "UNCERTAIN");
  const copied = value.map((raw, index) => {
    const subject = unorderedRecordCopy(raw, ["role", "reference", "imageId", "configId", "platform"], code, phase);
    const platform = unorderedRecordCopy(subject.platform, ["os", "architecture"], code, phase);
    const wanted = expected[index];
    if (typeof subject.role !== "string" || typeof subject.reference !== "string" || !matches(subject.imageId, IMAGE)
      || !matches(subject.configId, IMAGE) || typeof platform.os !== "string" || typeof platform.architecture !== "string"
      || subject.role !== wanted.role || subject.reference !== wanted.reference || subject.imageId !== wanted.imageId
      || subject.configId !== wanted.configId || platform.os !== wanted.platform.os
      || platform.architecture !== wanted.platform.architecture) fail(code, phase, "UNCERTAIN");
    return { role: subject.role, reference: subject.reference, imageId: subject.imageId, configId: subject.configId, platform };
  });
  return deepFreeze(copied);
}
function validateInventory(raw, identity, mode, subjects, initialSnapshot) {
  const keys = ["state", "purpose", "authority", "admission", "daemonId", "endpoint", "pid", "principalImageCount",
    "principalSnapshotSha256", "images", "containers", "volumes", "subjects"];
  if (!exact(raw, keys)) fail("gosu_retained_pair_controller_daemon_inventory_invalid", "INVENTORY", "UNCERTAIN");
  const observedSubjects = inventorySubjects(raw.subjects, subjects);
  if (raw.state !== `VERIFIED_${mode}` || raw.purpose !== "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION"
    || raw.authority !== "LOCAL_DIAGNOSTIC" || raw.admission !== "NOT_AUTHORIZED" || raw.daemonId !== identity.daemonId
    || raw.endpoint !== identity.endpoint || raw.pid !== identity.pid || raw.principalImageCount !== 2
    || !matches(raw.principalSnapshotSha256, HEX64) || initialSnapshot !== undefined && raw.principalSnapshotSha256 !== initialSnapshot
    || raw.images !== (mode === "EMPTY" ? 0 : mode === "BASE_ONLY" ? 1 : 2) || raw.containers !== 0 || raw.volumes !== 0
    || !isDeepStrictEqual(observedSubjects, subjects)) fail("gosu_retained_pair_controller_daemon_inventory_invalid", "INVENTORY", "UNCERTAIN");
  return raw;
}
function daemonStop(raw, identity, nonce, initialSnapshot, expectedMode) {
  if (!exact(raw, ["state", "purpose", "authority", "admission", "daemonId", "endpoint", "pid", "principalImageCount",
    "principalSnapshotSha256", "isolatedFinalInventory", "processGone", "socketGone", "pidFileGone", "privateState"])
    || raw.state !== "STOPPED" || raw.purpose !== "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION" || raw.authority !== "LOCAL_DIAGNOSTIC"
    || raw.admission !== "NOT_AUTHORIZED" || raw.daemonId !== identity.daemonId || raw.endpoint !== identity.endpoint || raw.pid !== identity.pid
    || raw.principalImageCount !== 2 || raw.principalSnapshotSha256 !== initialSnapshot || !matches(raw.principalSnapshotSha256, HEX64)
    || raw.isolatedFinalInventory !== expectedMode || raw.processGone !== true || raw.socketGone !== true || raw.pidFileGone !== true
    || raw.privateState !== "RETAINED") fail("gosu_retained_pair_controller_daemon_cleanup_uncertain", "STOP", "UNCERTAIN");
  return deepFreeze({ state: raw.state, purpose: raw.purpose, authority: raw.authority, admission: raw.admission, nonce,
    pid: raw.pid, startTicks: identity.startTicks, daemonId: raw.daemonId, principalImageCount: raw.principalImageCount,
    principalSnapshotSha256: raw.principalSnapshotSha256, isolatedFinalInventory: raw.isolatedFinalInventory,
    processGone: raw.processGone, socketGone: raw.socketGone, pidFileGone: raw.pidFileGone, privateState: raw.privateState });
}
function openArchiveSession(outputDirectory, result) {
  const states = []; let closed = false;
  const closeOwned = () => {
    let invalid = false;
    for (const state of states.slice().reverse()) {
      if (state.closed) continue;
      try { namedHeld(state.file, state.fd, state.expected, state.kind); } catch { invalid = true; }
      closeOnce(state.fd, state);
      try {
        const named = lstatSync(state.file, { bigint: true });
        if (!isDeepStrictEqual(bigintSnapshot(named), state.expected) || realpathSync(state.file) !== state.file) invalid = true;
      } catch { invalid = true; }
    }
    if (states.some((state) => state.uncertain)) fail("gosu_retained_pair_controller_cleanup_uncertain", "CLEANUP", "UNCERTAIN");
    if (invalid) fail("gosu_retained_pair_controller_preservation_failed", "PRESERVE", "CONFIRMED");
  };
  try {
    const directoryFd = openSync(outputDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    states.push({ fd: directoryFd, file: outputDirectory, expected: result.retention.directory,
      kind: "directory", closed: false, uncertain: false });
    for (const role of ["base", "candidate"]) {
      const retained = result.retention[role]; const file = path.join(outputDirectory, retained.name);
      const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      states.push({ fd, file, expected: retained.physical, kind: "file", role, retained, closed: false, uncertain: false });
    }
    const revalidate = () => {
      if (closed) fail("gosu_retained_pair_controller_preservation_failed", "PRESERVE", "CONFIRMED");
      const directoryState = states[0];
      const directoryStat = namedHeld(outputDirectory, directoryState.fd, directoryState.expected, "directory");
      const names = readdirSync(outputDirectory).sort();
      if (!isDeepStrictEqual(names, ["base-image.tar", "candidate-image.tar"])) throw new Error("namespace");
      const observed = {};
      for (const state of states.slice(1)) {
        const { bytes, stat } = readDescriptor(state.fd, GiB);
        namedHeld(state.file, state.fd, state.expected, "file");
        if (bytes.length !== state.retained.archive.bytes || sha256(bytes) !== state.retained.archive.sha256) throw new Error("archive");
        observed[state.role] = deepFreeze({ basename: state.retained.name, bytes: bytes.length,
          sha256: state.retained.archive.sha256, physical: projectedPhysical(stat) });
      }
      return deepFreeze({ outputDirectory: projectedDirectory(directoryStat), base: observed.base, candidate: observed.candidate });
    };
    const snapshot = revalidate();
    return Object.freeze({ snapshot, revalidate, close() { if (closed) return; closed = true; closeOwned(); } });
  } catch (error) {
    closeOwned();
    if (error?.code && CODE_SET.has(error.code)) throw error;
    fail("gosu_retained_pair_controller_preservation_failed", "PRESERVE", "CONFIRMED");
  }
}
function inspectArchives(outputDirectory, result) { return openArchiveSession(outputDirectory, result); }
function publishReceipt(root, receipt) {
  const directory = path.join(root, "preservation"); const file = path.join(directory, RECEIPT_BASENAME);
  const states = []; const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const closePublication = () => {
    let invalid = false;
    for (const state of states.slice().reverse()) {
      if (state.closed) continue;
      if (state.expected !== undefined) {
        try { namedHeld(state.file, state.fd, state.expected, state.kind); } catch { invalid = true; }
      }
      closeOnce(state.fd, state);
      if (state.expected !== undefined) {
        try {
          const named = lstatSync(state.file, { bigint: true });
          if (!isDeepStrictEqual(bigintSnapshot(named), state.expected) || realpathSync(state.file) !== state.file) invalid = true;
        } catch { invalid = true; }
      }
    }
    if (states.some((state) => state.uncertain)) fail("gosu_retained_pair_controller_cleanup_uncertain", "CLEANUP", "UNCERTAIN");
    if (invalid) fail("gosu_retained_pair_controller_preservation_failed", "PRESERVE", "CONFIRMED");
  };
  try {
    mkdirSync(directory, { mode: 0o700 });
    const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const directoryState = { fd: directoryFd, file: directory, kind: "directory", closed: false, uncertain: false }; states.push(directoryState);
    const directoryBefore = namedHeld(directory, directoryFd, undefined, "directory");
    if (directoryBefore.uid !== 0n || directoryBefore.gid !== 0n || directoryBefore.nlink !== 2n
      || Number(directoryBefore.mode & 0o7777n) !== 0o700 || readdirSync(directory).length !== 0) throw new Error("directory");
    const receiptFd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const receiptState = { fd: receiptFd, file, kind: "file", closed: false, uncertain: false }; states.push(receiptState);
    const directoryAfterCreate = namedHeld(directory, directoryFd, undefined, "directory");
    for (const key of ["dev", "ino", "uid", "gid", "mode", "nlink"]) {
      if (directoryAfterCreate[key] !== directoryBefore[key]) throw new Error("directory_transition");
    }
    if (!isDeepStrictEqual(readdirSync(directory), [RECEIPT_BASENAME])) throw new Error("directory_transition");
    const directoryBaseline = bigintSnapshot(directoryAfterCreate);
    directoryState.expected = directoryBaseline;
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(receiptFd, bytes, offset, bytes.length - offset, offset);
      if (!safeInteger(count, 1)) throw new Error("write");
      offset += count;
    }
    fsyncSync(receiptFd); fsyncSync(directoryFd);
    const written = fstatSync(receiptFd, { bigint: true });
    if (!written.isFile() || written.isSymbolicLink() || written.uid !== 0n || written.gid !== 0n || written.nlink !== 1n
      || Number(written.mode & 0o7777n) !== 0o600 || Number(written.size) !== bytes.length) throw new Error("receipt");
    const receiptBaseline = bigintSnapshot(written); receiptState.expected = receiptBaseline;
    namedHeld(file, receiptFd, receiptBaseline, "file");
    const readFd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const readState = { fd: readFd, file, kind: "file", expected: receiptBaseline, closed: false, uncertain: false }; states.push(readState);
    const reread = readDescriptor(readFd, bytes.length);
    if (!reread.bytes.equals(bytes) || !isDeepStrictEqual(bigintSnapshot(reread.stat), bigintSnapshot(written))) throw new Error("reread");
    namedHeld(file, readFd, bigintSnapshot(written), "file");
    namedHeld(directory, directoryFd, directoryBaseline, "directory");
    if (!isDeepStrictEqual(readdirSync(directory), [RECEIPT_BASENAME])) throw new Error("directory_guard");
    closePublication();
    return deepFreeze({ bytes: bytes.length, sha256: sha256(bytes), physical: projectedPhysical(written) });
  } catch (error) {
    closePublication();
    if (error?.code && CODE_SET.has(error.code)) throw error;
    const uncertain = states.some((state) => state.uncertain);
    fail(uncertain ? "gosu_retained_pair_controller_cleanup_uncertain" : "gosu_retained_pair_controller_preservation_failed",
      uncertain ? "CLEANUP" : "PRESERVE", uncertain ? "UNCERTAIN" : "CONFIRMED");
  }
}
async function stopLeaseOnce(lease, mode, initialSnapshot) {
  try { return daemonStop(await lease.stop({ requireMode: mode }), lease.identity, lease.identity.nonce, initialSnapshot, mode); }
  catch { fail("gosu_retained_pair_controller_daemon_cleanup_uncertain", "STOP", "UNCERTAIN"); }
}

export async function runGosuRetainedPairControllerV1(inputBytes, loadedControl, options = {}) {
  const signal = validateOptions(options);
  if (loadedControl === null || typeof loadedControl !== "object" || types.isProxy(loadedControl)
    || !loadedCapabilities.has(loadedControl) || consumedCapabilities.has(loadedControl)) {
    fail("gosu_retained_pair_controller_control_invalid", "CONTROL");
  }
  const control = loadedCapabilities.get(loadedControl); const input = validateInput(inputBytes, control);
  if (reservedExecutions.has(input.executionId)) fail("gosu_retained_pair_controller_control_invalid", "CONTROL");
  consumedCapabilities.add(loadedControl); reservedExecutions.add(input.executionId);
  let lease; let leaseAuthenticated = false; let stopAttempted = false; let daemonCallStarted = false; let archiveSession;
  let cleanup = "NOT_STARTED"; let lastConfirmedMode = "EMPTY"; let initialSnapshot;
  try {
    time("SOURCE"); verifySource(control); time("SOURCE");
    time("PREFLIGHT"); verifyParent(input.parent); time("PREFLIGHT");
    checkTool(gosuRetainedPairControllerV1Contract.node); time("PREFLIGHT");
    checkTool(gosuRetainedPairControllerV1Contract.setpriv); time("PREFLIGHT");
    const closure = sourceClosure(control);
    if (signal !== undefined && runtimeSignalAborted(signal, "gosu_retained_pair_controller_worker_timeout", "PREFLIGHT")) {
      fail("gosu_retained_pair_controller_worker_timeout", "PREFLIGHT");
    }
    time("DAEMON_START", "gosu_retained_pair_controller_daemon_start_failed");
    daemonCallStarted = true;
    let returnedLease;
    try { returnedLease = await startGosuDerivativeImageDaemonLease({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
      parent: input.parent, nonce: input.nonce, principal: input.principal }); }
    catch { fail("gosu_retained_pair_controller_daemon_start_failed", "DAEMON_START", "UNCERTAIN"); }
    cleanup = "UNCERTAIN";
    lease = authenticateLease(returnedLease, input);
    leaseAuthenticated = true;
    validateLeaseDeadline(lease.identity);
    time("DAEMON_START", "gosu_retained_pair_controller_daemon_start_failed");
    let empty;
    time("INVENTORY");
    try { empty = await lease.verifyInventory("EMPTY", []); } catch { fail("gosu_retained_pair_controller_daemon_inventory_invalid", "INVENTORY", "UNCERTAIN"); }
    time("INVENTORY");
    validateInventory(empty, lease.identity, "EMPTY", []);
    initialSnapshot = empty.principalSnapshotSha256;
    time("WORKER_START");
    const workerRun = await runWorker(lease, input, closure, signal);
    time("WORKER_RUN"); checkTool(gosuRetainedPairControllerV1Contract.setpriv); time("PREFLIGHT");
    const result = parseWorker(workerRun.bytes, input, lease.identity);
    const subjects = deepFreeze([
      { role: "BASE", reference: "postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3",
        imageId: result.retention.base.configId, configId: result.retention.base.configId, platform: { os: "linux", architecture: "amd64" } },
      { role: "CANDIDATE", reference: `aw-postgres-gosu:${input.nonce}`, imageId: result.retention.candidate.configId,
        configId: result.retention.candidate.configId, platform: { os: "linux", architecture: "amd64" } },
    ]);
    let inventory;
    time("INVENTORY");
    try { inventory = await lease.verifyInventory("BASE_AND_CANDIDATE", subjects); }
    catch { fail("gosu_retained_pair_controller_daemon_inventory_invalid", "INVENTORY", "UNCERTAIN"); }
    time("INVENTORY");
    validateInventory(inventory, lease.identity, "BASE_AND_CANDIDATE", subjects, initialSnapshot);
    lastConfirmedMode = "BASE_AND_CANDIDATE";
    if (time("STOP") > lease.identity.deadlineAtMs - control.deadlinePolicy.stopEntryBeforeDaemonMs) {
      stopAttempted = true; await stopLeaseOnce(lease, lastConfirmedMode, initialSnapshot); time("STOP"); cleanup = "CONFIRMED";
      fail("gosu_retained_pair_controller_worker_timeout", "STOP", "CONFIRMED");
    }
    stopAttempted = true; const stopped = await stopLeaseOnce(lease, lastConfirmedMode, initialSnapshot); time("STOP"); cleanup = "CONFIRMED";
    const postStopStarted = time("PRESERVE"); const postStopDeadline = postStopStarted + control.deadlinePolicy.postStopMs;
    const finalDeadline = lease.identity.deadlineAtMs + control.deadlinePolicy.controllerAfterDaemonMs;
    archiveSession = inspectArchives(lease.identity.outputDirectory, result); time("PRESERVE");
    const heldArchiveSession = typeof archiveSession?.revalidate === "function" && typeof archiveSession?.close === "function";
    const before = heldArchiveSession ? archiveSession.snapshot : archiveSession;
    const identity = daemonIdentity(lease.identity);
    const receipt = deepFreeze({ kind: "GOSU_RETAINED_PAIR_PRESERVATION_RECEIPT_V1", state: "SUCCEEDED",
      scope: "PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING", executionId: input.executionId,
      source: { baselineRevision: control.baselineRevision, baselineTree: control.baselineTree, controllerRevision: control.controllerRevision,
        controllerTree: control.controllerTree, pr188Revision: control.pr188Revision, pr188Tree: control.pr188Tree,
        manifestSha256: control.sourceManifestSha256, calcTreeGitSha1: control.sourceManifest.calcTreeGitSha1,
        commitRawSha1: control.commitRawSha1, acceptance: control.acceptance }, worker: workerRun.worker, nonce: input.nonce,
      daemon: { identity, stop: stopped }, buildWindow: result.buildWindow, pairProof: result.pairProof, retention: result.retention,
      postStop: before, processSupervision: workerRun.processSupervision, receiptBasename: RECEIPT_BASENAME,
      authority: "NOT_AUTHORIZED", image: "BUILT_UNVALIDATED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED",
      admission: "NOT_AUTHORIZED", preservation: "PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING", dates: null });
    const published = publishReceipt(lease.identity.root, receipt); time("PRESERVE");
    const after = heldArchiveSession ? archiveSession.revalidate() : inspectArchives(lease.identity.outputDirectory, result); time("PRESERVE");
    if (!isDeepStrictEqual(after, before)) fail("gosu_retained_pair_controller_preservation_failed", "PRESERVE", "CONFIRMED");
    if (heldArchiveSession) archiveSession.close();
    time("PRESERVE");
    archiveSession = undefined;
    const completed = time("ACK");
    if (completed > postStopDeadline || completed > finalDeadline) fail("gosu_retained_pair_controller_worker_timeout", "ACK", "CONFIRMED");
    return deepFreeze({ kind: "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1", state: "SUCCEEDED",
      scope: "PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING", executionId: input.executionId, nonce: input.nonce,
      receiptBasename: RECEIPT_BASENAME, receiptBytes: published.bytes, receiptSha256: published.sha256,
      receiptPhysical: published.physical, daemonStop: stopped, processSupervision: workerRun.processSupervision,
      authority: "NOT_AUTHORIZED", image: "BUILT_UNVALIDATED", admission: "NOT_AUTHORIZED",
      preservation: "PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING", dates: null });
  } catch (error) {
    let reported = error;
    if (archiveSession !== undefined && typeof archiveSession?.close === "function") {
      try { archiveSession.close(); } catch (closeError) { reported = closeError; }
    }
    const metadata = failureMetadata(reported);
    const ownedCleanupUncertain = metadata.cleanup === "UNCERTAIN" && [
        "gosu_retained_pair_controller_worker_spawn_failed", "gosu_retained_pair_controller_worker_identity_invalid",
        "gosu_retained_pair_controller_worker_timeout", "gosu_retained_pair_controller_worker_cleanup_uncertain",
        "gosu_retained_pair_controller_cleanup_uncertain",
      ].includes(metadata.code);
    if (ownedCleanupUncertain) cleanup = "UNCERTAIN";
    if (leaseAuthenticated && !stopAttempted) {
      try { await stopLeaseOnce(lease, lastConfirmedMode, initialSnapshot); cleanup = ownedCleanupUncertain ? "UNCERTAIN" : "CONFIRMED"; }
      catch { cleanup = "UNCERTAIN"; }
    }
    if (!lease && !ownedCleanupUncertain) cleanup = daemonCallStarted ? "UNCERTAIN" : "NOT_STARTED";
    let code = "gosu_retained_pair_controller_input_invalid"; let phase = "INPUT";
    if (CODE_SET.has(metadata.code)) code = metadata.code;
    if (CONTROLLER_PHASES.includes(metadata.phase)) phase = metadata.phase;
    if (cleanup === "UNCERTAIN" && code !== "gosu_retained_pair_controller_daemon_start_failed") {
      if (phase === "STOP") code = "gosu_retained_pair_controller_daemon_cleanup_uncertain";
      else if (phase === "CLEANUP") code = "gosu_retained_pair_controller_cleanup_uncertain";
    }
    throw failure(code, phase, cleanup);
  }
}

export function gosuRetainedPairControllerV1FailureDiagnostic(error) {
  let code = "gosu_retained_pair_controller_input_invalid"; let phase = "INPUT"; let cleanup = "UNCERTAIN";
  const metadata = failureMetadata(error);
  if (CODE_SET.has(metadata.code)) code = metadata.code;
  if (CONTROLLER_PHASES.includes(metadata.phase)) phase = metadata.phase;
  if (CLEANUPS.has(metadata.cleanup)) cleanup = metadata.cleanup;
  return deepFreeze({ kind: "GOSU_RETAINED_PAIR_CONTROLLER_FAILURE_V1", state: "FAILED", code, phase, cleanup,
    authority: "NOT_AUTHORIZED", preservation: "NOT_ESTABLISHED", dates: null });
}
