import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readSync, realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";

import { runGosuDerivativeImageRetainedBuildProofV1 } from "./gosu-derivative-image-observation-v2.mjs";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const TRANSPORT_LIMIT = 16 * MiB;
const OUTPUT_LIMIT = 8 * MiB;
const PROFILE_OUTPUT_LIMIT = 2 * MiB;
const HEX24 = /^[0-9a-f]{24}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CONFIG_ID = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const START_TICKS = /^[1-9][0-9]{0,19}$/u;
const EXECUTION_ID = /^gosu-retained-pair-[0-9a-f]{24}$/u;
const typedArrayLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length").get;
const BASE_CONFIG_ID = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
const ACCEPTANCE = Object.freeze({
  path: ".omx/gosu-derivative-context-private-acceptance-v1.json",
  bytes: 11_744,
  sha256: "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3",
});
const SOURCE_IDENTITY = Object.freeze({
  head: "582fb97e88cf5a498e6ae34ec76eb5736ada2a47",
  main: "e4fa47cbe66758a5b56f5347c2c27e61bdae1ed0",
  tree: "7292e98e7ee23e45ebccff075577af41f271dbf9",
});
const CONTEXT_IDENTITY = Object.freeze({
  bytes: 1_986_560,
  sha256: "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb",
});
const WORKER_PHASES = Object.freeze(["INPUT", "SOURCE", "ENVIRONMENT", "PRODUCER", "RESULT", "CLEANUP"]);
const WORKER_CODES = Object.freeze([
  "gosu_retained_pair_worker_input_invalid",
  "gosu_retained_pair_worker_source_invalid",
  "gosu_retained_pair_worker_environment_invalid",
  "gosu_retained_pair_worker_producer_failed",
  "gosu_retained_pair_worker_result_invalid",
  "gosu_retained_pair_worker_cleanup_uncertain",
]);
const WORKER_CODE_SET = new Set(WORKER_CODES);
const CLEANUP_VALUES = new Set(["NOT_STARTED", "CONFIRMED", "UNCERTAIN"]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const EXPECTED_CONTEXT_ENTRIES = Object.freeze([
  Object.freeze({ path: "Dockerfile", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0, size: 199,
    sha256: "1f5215a51b3b67a8e44b6feeb51ce36653f5790ac6e2156926fb274a8c4ec698" }),
  Object.freeze({ path: "gosu", type: "file", mode: 0o755, uid: 0, gid: 0, mtime: 0, size: 1_936_912,
    sha256: "d0a386b6fcd757540277ed91e213e7c51f2406bad2965535ce0bd2c6214339d4" }),
  Object.freeze({ path: "auto-world-gosu", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 0, size: 0 }),
  Object.freeze({ path: "auto-world-gosu/gosu-LICENSE", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 11_358, sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" }),
  Object.freeze({ path: "auto-world-gosu/moby-user-LICENSE", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 11_358, sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" }),
  Object.freeze({ path: "auto-world-gosu/go-LICENSE", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 1_453, sha256: "911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad" }),
  Object.freeze({ path: "auto-world-gosu/go-PATENTS", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 1_303, sha256: "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc" }),
  Object.freeze({ path: "auto-world-gosu/x-sys-LICENSE", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 1_479, sha256: "2d36597f7117c38b006835ae7f537487207d8ec407aa9d9980794b2030cbc067" }),
  Object.freeze({ path: "auto-world-gosu/x-sys-PATENTS", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 1_303, sha256: "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc" }),
  Object.freeze({ path: "auto-world-gosu/notices.json", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 121, sha256: "e48215fcfd4ac9f0d66e88c9ecb2b2d60898681278f582452fbe60c853618c22" }),
  Object.freeze({ path: "auto-world-gosu/module-closure.json", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 399, sha256: "8234aa30428e11a6e39cc916557ec1c849fd1481c35385536e11bf4455f0c3cc" }),
  Object.freeze({ path: "auto-world-gosu/sbom.cdx.json", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 1_192, sha256: "4dfb0c70caa63416dfeaad485cef2aea70e1689d39729dd90cc9ecd087439b26" }),
  Object.freeze({ path: "auto-world-gosu/version.txt", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 35, sha256: "7bd970d3ab80dd130d0faa363a39469dddda09274e0da70d1a8dd8fd2f7ca237" }),
  Object.freeze({ path: "auto-world-gosu/build-info.txt", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 950, sha256: "2196165397810ee92560467344c9aa9356ddcfa54cf6d5f086391bc1252a1a4b" }),
  Object.freeze({ path: "auto-world-gosu/derivative-manifest.json", type: "file", mode: 0o644, uid: 0, gid: 0, mtime: 0,
    size: 5_937, sha256: "1d6326ecc051cde160009f1269ab7d749f8b5c12f4250910cbeda04eeb9e3977" }),
]);

const ADDED_FILES = Object.freeze([
  "usr/share/licenses/auto-world-gosu/build-info.txt",
  "usr/share/licenses/auto-world-gosu/derivative-manifest.json",
  "usr/share/licenses/auto-world-gosu/go-LICENSE",
  "usr/share/licenses/auto-world-gosu/go-PATENTS",
  "usr/share/licenses/auto-world-gosu/gosu-LICENSE",
  "usr/share/licenses/auto-world-gosu/moby-user-LICENSE",
  "usr/share/licenses/auto-world-gosu/module-closure.json",
  "usr/share/licenses/auto-world-gosu/notices.json",
  "usr/share/licenses/auto-world-gosu/sbom.cdx.json",
  "usr/share/licenses/auto-world-gosu/version.txt",
  "usr/share/licenses/auto-world-gosu/x-sys-LICENSE",
  "usr/share/licenses/auto-world-gosu/x-sys-PATENTS",
]);
const ADDED_DIRECTORY_SUFFIXES = Object.freeze([
  Object.freeze([]),
  Object.freeze(["usr/share/licenses/auto-world-gosu"]),
  Object.freeze(["usr/share/licenses", "usr/share/licenses/auto-world-gosu"]),
  Object.freeze(["usr/share", "usr/share/licenses", "usr/share/licenses/auto-world-gosu"]),
]);

function deeplyFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deeplyFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

export const gosuRetainedPairWorkerV1Contract = deeplyFreeze({
  kind: "GOSU_RETAINED_PAIR_WORKER_V1_CONTRACT",
  kinds: {
    transport: "GOSU_RETAINED_PAIR_WORKER_TRANSPORT_V1",
    sourceClosure: "GOSU_RETAINED_PAIR_SOURCE_CLOSURE_V1",
    manifest: "GOSU_RETAINED_PAIR_SOURCE_MANIFEST_V1",
    result: "GOSU_RETAINED_PAIR_WORKER_RESULT_V1",
    failure: "GOSU_RETAINED_PAIR_WORKER_FAILURE_V1",
  },
  node: {
    path: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node",
    version: "v22.23.2",
    bytes: 124_836_408,
    sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327",
  },
  caps: { transportBytes: TRANSPORT_LIMIT, stdoutBytes: OUTPUT_LIMIT, stderrBytes: 0, commitRawBytes: MiB },
  exitCodes: { success: 0, failure: 1 },
  productionImport: "./gosu-derivative-image-observation-v2.mjs",
  phases: [...WORKER_PHASES],
  errorCodes: [...WORKER_CODES],
});

function workerFailure(code, phase, cleanup) {
  const acceptedCode = WORKER_CODE_SET.has(code) ? code : "gosu_retained_pair_worker_input_invalid";
  const acceptedPhase = WORKER_PHASES.includes(phase) ? phase : "INPUT";
  const acceptedCleanup = CLEANUP_VALUES.has(cleanup) ? cleanup : "NOT_STARTED";
  return Object.assign(new Error(acceptedCode), { code: acceptedCode, phase: acceptedPhase, cleanup: acceptedCleanup });
}
function fail(code, phase, cleanup = "NOT_STARTED") { throw workerFailure(code, phase, cleanup); }
function invalidInput() { fail("gosu_retained_pair_worker_input_invalid", "INPUT"); }
function invalidSource() { fail("gosu_retained_pair_worker_source_invalid", "SOURCE"); }
function invalidResult() { fail("gosu_retained_pair_worker_result_invalid", "RESULT", "UNCERTAIN"); }

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactRecord(value, keys, onInvalid) {
  if (!plain(value)) onInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (!isDeepStrictEqual(ownKeys, keys) || ownKeys.some((key) => typeof key !== "string"
    || !Object.hasOwn(descriptors[key], "value") || descriptors[key].enumerable !== true)) onInvalid();
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}
function exactUnorderedRecord(value, keys, onInvalid) {
  if (!plain(value)) onInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value); const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)
    || !Object.hasOwn(descriptors[key], "value") || descriptors[key].enumerable !== true)) onInvalid();
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}
function denseArray(value, maximum, onInvalid) {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value)
    || !arrayPrototype(value) || !Number.isSafeInteger(value.length)
    || value.length < 0 || value.length > maximum) onInvalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = [...Array(value.length).keys()].map(String).concat("length");
  if (!isDeepStrictEqual(Reflect.ownKeys(descriptors), expectedKeys)
    || expectedKeys.slice(0, -1).some((key) => !Object.hasOwn(descriptors[key], "value") || descriptors[key].enumerable !== true)
    || !Object.hasOwn(descriptors.length, "value") || descriptors.length.value !== value.length) onInvalid();
  return Array.from(value);
}
function arrayPrototype(value) {
  return Object.getPrototypeOf(value) === Array.prototype;
}
function frozenCopy(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) invalidResult(); seen.add(value);
    const copy = value.map((item) => frozenCopy(item, seen)); seen.delete(value); return Object.freeze(copy);
  }
  if (plain(value)) {
    if (seen.has(value)) invalidResult(); seen.add(value);
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = frozenCopy(value[key], seen);
    seen.delete(value); return Object.freeze(copy);
  }
  return value;
}
const safeInteger = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value)
  && value >= minimum && value <= maximum;
const matches = (expression, value) => typeof value === "string" && expression.test(value);
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const bytewiseCompare = (left, right) => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
const sameArray = (left, right) => left.length === right.length && left.every((item, index) => item === right[index]);

function canonicalRelativePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !value.includes("\0")
    && !value.includes("\\") && !value.startsWith("/") && path.posix.normalize(value) === value
    && value !== "." && !value.split("/").includes("..") && Buffer.from(value, "utf8").toString("utf8") === value;
}

function gitTreeSha1(entries, onInvalid) {
  const root = { directories: new Map(), files: new Map() };
  for (const entry of entries) {
    const parts = entry.path.split("/"); let current = root;
    for (const component of parts.slice(0, -1)) {
      if (current.files.has(component)) onInvalid();
      if (!current.directories.has(component)) current.directories.set(component, { directories: new Map(), files: new Map() });
      current = current.directories.get(component);
    }
    const basename = parts.at(-1);
    if (current.files.has(basename) || current.directories.has(basename)) onInvalid();
    current.files.set(basename, entry);
  }
  const tree = (node) => {
    const children = [
      ...[...node.files].map(([name, entry]) => ({ name, sortName: name, mode: entry.gitMode, oid: entry.gitBlobSha1 })),
      ...[...node.directories].map(([name, child]) => ({ name, sortName: `${name}/`, mode: "40000", oid: tree(child) })),
    ].sort((left, right) => bytewiseCompare(left.sortName, right.sortName));
    const body = Buffer.concat(children.map((child) => Buffer.concat([
      Buffer.from(`${child.mode} ${child.name}\0`, "utf8"), Buffer.from(child.oid, "hex"),
    ])));
    return hash("sha1", Buffer.concat([Buffer.from(`tree ${body.length}\0`, "utf8"), body]));
  };
  return tree(root);
}

function validateManifest(value) {
  const manifest = exactRecord(value, ["kind", "entries", "calcTreeGitSha1"], invalidSource);
  if (manifest.kind !== gosuRetainedPairWorkerV1Contract.kinds.manifest || !matches(SHA1, manifest.calcTreeGitSha1)) invalidSource();
  const rawEntries = denseArray(manifest.entries, 100_000, invalidSource);
  let previous = null;
  const entries = rawEntries.map((raw) => {
    const entry = exactRecord(raw, ["path", "gitMode", "bytes", "sha256", "gitBlobSha1"], invalidSource);
    if (!canonicalRelativePath(entry.path) || !["100644", "100755"].includes(entry.gitMode)
      || !safeInteger(entry.bytes) || !matches(SHA256, entry.sha256) || !matches(SHA1, entry.gitBlobSha1)
      || previous !== null && bytewiseCompare(previous, entry.path) >= 0) invalidSource();
    previous = entry.path;
    return Object.freeze({ ...entry });
  });
  if (gitTreeSha1(entries, invalidSource) !== manifest.calcTreeGitSha1) invalidSource();
  return Object.freeze({ kind: manifest.kind, entries: Object.freeze(entries), calcTreeGitSha1: manifest.calcTreeGitSha1 });
}

export function validateGosuRetainedPairSourceClosureV1(value) {
  try {
    const closure = exactRecord(value,
      ["kind", "executionId", "deploymentRoot", "manifest", "manifestSha256", "calcTreeGitSha1", "commitRawSha1", "acceptance"],
      invalidSource);
    if (closure.kind !== gosuRetainedPairWorkerV1Contract.kinds.sourceClosure || !matches(EXECUTION_ID, closure.executionId)
      || typeof closure.deploymentRoot !== "string" || !path.posix.isAbsolute(closure.deploymentRoot)
      || path.posix.normalize(closure.deploymentRoot) !== closure.deploymentRoot || closure.deploymentRoot === "/"
      || closure.deploymentRoot.endsWith("/") || !matches(SHA256, closure.manifestSha256)
      || !matches(SHA1, closure.calcTreeGitSha1) || !matches(SHA1, closure.commitRawSha1)) invalidSource();
    const manifest = validateManifest(closure.manifest);
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (hash("sha256", manifestBytes) !== closure.manifestSha256 || manifest.calcTreeGitSha1 !== closure.calcTreeGitSha1) invalidSource();
    const acceptance = exactRecord(closure.acceptance, ["path", "bytes", "sha256"], invalidSource);
    if (!isDeepStrictEqual(acceptance, ACCEPTANCE)) invalidSource();
    return deeplyFreeze({ ...closure, manifest, acceptance: { ...acceptance } });
  } catch (error) {
    if (error?.code === "gosu_retained_pair_worker_source_invalid") throw error;
    throw workerFailure("gosu_retained_pair_worker_source_invalid", "SOURCE", "NOT_STARTED");
  }
}

function validateActor(value, uid, gid, onInvalid) {
  const actor = exactRecord(value, ["uid", "gid"], onInvalid);
  if (actor.uid !== uid || actor.gid !== gid) onInvalid();
  return Object.freeze({ ...actor });
}
function validateSocketProof(value, mode, onInvalid) {
  const proof = exactRecord(value, ["dev", "ino", "uid", "gid", "mode"], onInvalid);
  if (!matches(DECIMAL, proof.dev) || !matches(DECIMAL, proof.ino)
    || proof.uid !== 0 || proof.gid !== 1000 || proof.mode !== mode) onInvalid();
  return Object.freeze({ ...proof });
}
function validateLease(value, nonce, onInvalid) {
  const keys = ["purpose", "authority", "admission", "root", "nonce", "socket", "endpoint", "dockerConfig", "buildxConfig",
    "outputDirectory", "contextName", "pid", "startTicks", "daemonId", "version", "dataRoot", "execRoot", "containerdAddress",
    "containersNamespace", "pluginsNamespace", "configSha256", "argvSha256", "deadlineAtMs", "rootActor", "clientActor", "socketProof",
    "socketDirectoryProof"];
  const lease = exactUnorderedRecord(value, keys, onInvalid);
  if (lease.purpose !== "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION" || lease.authority !== "LOCAL_DIAGNOSTIC"
    || lease.admission !== "NOT_AUTHORIZED" || lease.nonce !== nonce
    || !matches(/^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u, lease.root)
    || lease.socket !== `${lease.root}/endpoint/docker.sock` || lease.endpoint !== `unix://${lease.socket}`
    || lease.dockerConfig !== `${lease.root}/client` || lease.buildxConfig !== `${lease.root}/client/buildx`
    || lease.outputDirectory !== `${lease.root}/client/output` || lease.contextName !== `aw-cold-${nonce}`
    || !safeInteger(lease.pid, 2) || !matches(START_TICKS, lease.startTicks)
    || typeof lease.daemonId !== "string" || lease.daemonId.length === 0
    || lease.version !== "28.0.4" || lease.dataRoot !== `${lease.root}/infra/data` || lease.execRoot !== `${lease.root}/infra/exec`
    || lease.containerdAddress !== "/run/containerd/containerd.sock" || lease.containersNamespace !== `awcold-${nonce}`
    || lease.pluginsNamespace !== `plugins.awcold-${nonce}` || !matches(SHA256, lease.configSha256)
    || !matches(SHA256, lease.argvSha256)
    || !safeInteger(lease.deadlineAtMs, 1)) onInvalid();
  return deeplyFreeze({ ...lease, rootActor: validateActor(lease.rootActor, 0, 0, onInvalid),
    clientActor: validateActor(lease.clientActor, 1000, 1000, onInvalid),
    socketProof: validateSocketProof(lease.socketProof, 0o660, onInvalid),
    socketDirectoryProof: validateSocketProof(lease.socketDirectoryProof, 0o710, onInvalid) });
}
function validateInput(value, onInvalid) {
  const input = exactRecord(value, ["purpose", "nonce", "lease"], onInvalid);
  if (input.purpose !== "GOSU_DERIVATIVE_IMAGE_RETAINED_BUILD_PROOF_V1" || !matches(HEX24, input.nonce)) onInvalid();
  return deeplyFreeze({ purpose: input.purpose, nonce: input.nonce, lease: validateLease(input.lease, input.nonce, onInvalid) });
}
function validateTransportObject(value, onInvalid) {
  const transport = exactRecord(value, ["kind", "input", "sourceClosure"], onInvalid);
  if (transport.kind !== gosuRetainedPairWorkerV1Contract.kinds.transport) onInvalid();
  const originalInput = transport.input;
  const input = validateInput(originalInput, onInvalid);
  const sourceClosure = validateGosuRetainedPairSourceClosureV1(transport.sourceClosure);
  return Object.freeze({ transport: deeplyFreeze({ kind: transport.kind, input, sourceClosure }), originalInput });
}

function strictJsonBuffer(bytes, maximum, onInvalid) {
  if (bytes === null || typeof bytes !== "object" || types.isProxy(bytes) || !Buffer.isBuffer(bytes)
    || Object.getPrototypeOf(bytes) !== Buffer.prototype || Object.hasOwn(bytes, "length")) onInvalid();
  const length = Reflect.apply(typedArrayLength, bytes, []);
  if (!safeInteger(length, 1, maximum)) onInvalid();
  const ownKeys = Reflect.ownKeys(bytes);
  if (ownKeys.length !== length) onInvalid();
  const owned = Buffer.from(bytes);
  if (owned[0] === 0xef || owned.includes(0) || owned.includes(13)) onInvalid();
  let text; let value;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(owned); value = JSON.parse(text); }
  catch { onInvalid(); }
  if (!owned.equals(Buffer.from(`${JSON.stringify(value)}\n`, "utf8"))) onInvalid();
  return value;
}

export function validateGosuRetainedPairWorkerTransportV1(bytes) {
  try {
    const parsed = strictJsonBuffer(bytes, TRANSPORT_LIMIT, invalidInput);
    return validateTransportObject(parsed, invalidInput).transport;
  } catch (error) {
    if (error?.code === "gosu_retained_pair_worker_input_invalid" || error?.code === "gosu_retained_pair_worker_source_invalid") throw error;
    throw workerFailure("gosu_retained_pair_worker_input_invalid", "INPUT", "NOT_STARTED");
  }
}

class CloseUncertainError extends Error {}
function sameStat(left, right) {
  return ["dev", "ino", "mode", "nlink", "size", "uid", "gid", "mtimeNs", "ctimeNs", "birthtimeNs"]
    .every((key) => left[key] === right[key]);
}
function withDescriptor(file, operation) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let result; let primary;
  try { result = operation(fd); } catch (error) { primary = error; }
  try { closeSync(fd); }
  catch (closeError) { throw new CloseUncertainError("close uncertain", { cause: closeError }); }
  if (primary !== undefined) throw primary;
  return result;
}
function observeFile(file, expected) {
  return withDescriptor(file, (fd) => {
    const beforeHeld = fstatSync(fd, { bigint: true }); const beforeNamed = lstatSync(file, { bigint: true });
    const expectedPermissions = expected.gitMode === "100755" ? 0o555n : 0o444n;
    if (!beforeHeld.isFile() || beforeHeld.isSymbolicLink() || !sameStat(beforeHeld, beforeNamed)
      || beforeHeld.uid !== 0n || beforeHeld.gid !== 0n || beforeHeld.nlink !== 1n
      || (beforeHeld.mode & 0o7777n) !== expectedPermissions || beforeHeld.size !== BigInt(expected.bytes)) invalidSource();
    const sha256 = createHash("sha256"); const git = createHash("sha1").update(`blob ${expected.bytes}\0`);
    const buffer = Buffer.allocUnsafe(MiB); let offset = 0;
    while (offset < expected.bytes) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, expected.bytes - offset), offset);
      if (count <= 0) invalidSource();
      const chunk = buffer.subarray(0, count); sha256.update(chunk); git.update(chunk); offset += count;
    }
    if (readSync(fd, buffer, 0, 1, offset) !== 0 || sha256.digest("hex") !== expected.sha256
      || git.digest("hex") !== expected.gitBlobSha1) invalidSource();
    const afterHeld = fstatSync(fd, { bigint: true }); const afterNamed = lstatSync(file, { bigint: true });
    if (!sameStat(beforeHeld, afterHeld) || !sameStat(afterHeld, afterNamed) || realpathSync(file) !== file) invalidSource();
  });
}
function observePinnedFile(file, expected, expectedUid, expectedGid, expectedPermissions) {
  return withDescriptor(file, (fd) => {
    const beforeHeld = fstatSync(fd, { bigint: true }); const beforeNamed = lstatSync(file, { bigint: true });
    if (!beforeHeld.isFile() || beforeHeld.isSymbolicLink() || !sameStat(beforeHeld, beforeNamed)
      || beforeHeld.uid !== BigInt(expectedUid) || beforeHeld.gid !== BigInt(expectedGid) || beforeHeld.nlink !== 1n
      || (beforeHeld.mode & 0o7777n) !== BigInt(expectedPermissions) || beforeHeld.size !== BigInt(expected.bytes)) invalidSource();
    const digest = createHash("sha256"); const buffer = Buffer.allocUnsafe(MiB); let offset = 0;
    while (offset < expected.bytes) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, expected.bytes - offset), offset);
      if (count <= 0) invalidSource(); digest.update(buffer.subarray(0, count)); offset += count;
    }
    if (readSync(fd, buffer, 0, 1, offset) !== 0 || digest.digest("hex") !== expected.sha256) invalidSource();
    const afterHeld = fstatSync(fd, { bigint: true }); const afterNamed = lstatSync(file, { bigint: true });
    if (!sameStat(beforeHeld, afterHeld) || !sameStat(afterHeld, afterNamed) || realpathSync(file) !== file) invalidSource();
  });
}
function validateDeploymentDirectory(directory) {
  const stat = lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0n || stat.gid !== 0n || (stat.mode & 0o7777n) !== 0o555n
    || realpathSync(directory) !== directory) invalidSource();
}
function verifyDeploymentCopy(sourceClosure) {
  if (sourceClosure.deploymentRoot !== repoRoot || realpathSync(repoRoot) !== repoRoot) invalidSource();
  validateDeploymentDirectory(repoRoot);
  const manifestByPath = new Map(sourceClosure.manifest.entries.map((entry) => [entry.path, entry]));
  const observed = new Set();
  const walk = (directory, relative = "") => {
    validateDeploymentDirectory(directory);
    const names = readdirSync(directory).sort(bytewiseCompare);
    for (const name of names) {
      const childRelative = relative === "" ? name : `${relative}/${name}`;
      if (childRelative === ".git" || childRelative.startsWith(".git/")) invalidSource();
      const child = path.join(directory, name); const stat = lstatSync(child, { bigint: true });
      if (stat.isSymbolicLink()) invalidSource();
      if (stat.isDirectory()) {
        const needed = sourceClosure.manifest.entries.some((entry) => entry.path.startsWith(`${childRelative}/`))
          || ACCEPTANCE.path.startsWith(`${childRelative}/`);
        if (!needed) invalidSource(); walk(child, childRelative); continue;
      }
      if (!stat.isFile()) invalidSource();
      if (childRelative === ACCEPTANCE.path) {
        observePinnedFile(child, ACCEPTANCE, 0, 0, 0o444); observed.add(childRelative); continue;
      }
      const expected = manifestByPath.get(childRelative);
      if (expected === undefined) invalidSource();
      observeFile(child, expected); observed.add(childRelative);
    }
  };
  walk(repoRoot);
  if (observed.size !== manifestByPath.size + 1 || !observed.has(ACCEPTANCE.path)
    || sourceClosure.manifest.entries.some((entry) => !observed.has(entry.path))) invalidSource();
}

function validateRuntime(input) {
  const expectedEnvironment = {
    PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: input.lease.dockerConfig,
  };
  const environmentKeys = Object.keys(process.env).sort();
  if (process.platform !== "linux" || process.version !== gosuRetainedPairWorkerV1Contract.node.version
    || process.execPath !== gosuRetainedPairWorkerV1Contract.node.path || process.getuid?.() !== 1000 || process.geteuid?.() !== 1000
    || process.getgid?.() !== 1000 || process.getegid?.() !== 1000 || !isDeepStrictEqual(process.getgroups?.(), [1000])
    || !isDeepStrictEqual(environmentKeys, Object.keys(expectedEnvironment).sort())
    || Object.entries(expectedEnvironment).some(([key, value]) => process.env[key] !== value)) {
    fail("gosu_retained_pair_worker_environment_invalid", "ENVIRONMENT");
  }
  let status;
  try { status = readFileSync("/proc/self/status", "utf8"); } catch { fail("gosu_retained_pair_worker_environment_invalid", "ENVIRONMENT"); }
  if (Buffer.byteLength(status) > 64 * 1024 || !/^Groups:[ \t]*$/mu.test(status) || !/^NoNewPrivs:[ \t]+1$/mu.test(status)
    || ["CapInh:", "CapPrm:", "CapEff:", "CapBnd:", "CapAmb:"]
      .some((name) => !new RegExp(`^${name}[ \\t]+0{16}$`, "mu").test(status))) {
    fail("gosu_retained_pair_worker_environment_invalid", "ENVIRONMENT");
  }
  try { observePinnedFile(gosuRetainedPairWorkerV1Contract.node.path, gosuRetainedPairWorkerV1Contract.node, 0, 0, 0o755); }
  catch (error) {
    if (error instanceof CloseUncertainError) throw error;
    fail("gosu_retained_pair_worker_environment_invalid", "ENVIRONMENT");
  }
}

function validatePhysical(value, kind) {
  const physical = exactRecord(value, ["dev", "ino", "mode", "nlink", "size", "uid", "gid", "mtimeNs", "ctimeNs", "birthtimeNs"], invalidResult);
  if (![physical.dev, physical.ino, physical.mtimeNs, physical.ctimeNs, physical.birthtimeNs].every((item) => matches(DECIMAL, item))
    || ![physical.mode, physical.nlink, physical.size, physical.uid, physical.gid].every((item) => safeInteger(item))) invalidResult();
  if (kind === "CONTEXT" && (physical.mode !== 0o100600 || physical.uid !== 1000 || physical.gid !== 1000
    || physical.nlink !== 1 || physical.size !== CONTEXT_IDENTITY.bytes)) invalidResult();
  if (kind === "ARCHIVE" && (physical.mode !== 0o100600 || physical.uid !== 1000 || physical.gid !== 1000
    || physical.nlink !== 1 || !safeInteger(physical.size, 1, GiB))) invalidResult();
  if (kind === "DIRECTORY" && (physical.mode !== 0o40700 || physical.uid !== 1000 || physical.gid !== 1000 || physical.nlink !== 2)) invalidResult();
  return Object.freeze({ ...physical });
}
function validateArchive(value) {
  const archive = exactRecord(value, ["bytes", "sha256"], invalidResult);
  if (!safeInteger(archive.bytes, 1, GiB) || !matches(SHA256, archive.sha256)) invalidResult();
  return Object.freeze({ ...archive });
}
function validateBuildWindow(value, lease) {
  const window = exactRecord(value, ["startedAtMs", "completedAtMs"], invalidResult);
  if (!safeInteger(window.startedAtMs) || !safeInteger(window.completedAtMs) || window.startedAtMs > window.completedAtMs
    || window.completedAtMs - window.startedAtMs > 600_000 || window.startedAtMs < lease.deadlineAtMs - 600_000
    || window.completedAtMs > lease.deadlineAtMs - 25_000) invalidResult();
  return Object.freeze({ ...window });
}
function validateEncodedOutput(value) {
  const output = exactRecord(value, ["encoding", "bytes", "sha256", "base64"], invalidResult);
  if (output.encoding !== "base64" || !safeInteger(output.bytes, 0, PROFILE_OUTPUT_LIMIT) || !matches(SHA256, output.sha256)
    || typeof output.base64 !== "string" || output.base64.length > Math.ceil(PROFILE_OUTPUT_LIMIT / 3) * 4) invalidResult();
  let decoded;
  try { decoded = Buffer.from(output.base64, "base64"); } catch { invalidResult(); }
  if (decoded.toString("base64") !== output.base64 || decoded.length !== output.bytes || hash("sha256", decoded) !== output.sha256) invalidResult();
  return Object.freeze({ ...output });
}
function validateCommand(value, args) {
  const command = exactRecord(value, ["binary", "args"], invalidResult);
  const observedArgs = denseArray(command.args, 32, invalidResult);
  if (command.binary !== "/usr/bin/docker" || observedArgs.some((item) => typeof item !== "string") || !sameArray(observedArgs, args)) invalidResult();
  return Object.freeze({ binary: command.binary, args: Object.freeze([...observedArgs]) });
}
function platformValues(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) invalidResult();
  const values = value.split(",").map((item) => item.trim().replace(/\*$/u, ""));
  if (!values.includes("linux/amd64")) invalidResult();
  return value;
}
function validateProfiles(value, lease) {
  const profiles = exactRecord(value, ["stage", "context", "version", "info", "builder"], invalidResult);
  if (profiles.stage !== "PRE_CONTEXT") invalidResult();
  const args = {
    context: ["--config", lease.dockerConfig, "--context", lease.contextName, "context", "inspect", lease.contextName],
    version: ["--config", lease.dockerConfig, "--context", lease.contextName, "version", "--format", "{{json .}}"],
    info: ["--config", lease.dockerConfig, "--context", lease.contextName, "info", "--format", "{{json .}}"],
    builder: ["--config", lease.dockerConfig, "--context", lease.contextName, "buildx", "inspect"],
  };
  const profile = (raw, role) => {
    const item = exactRecord(raw, ["command", "representation", "parsed", "stdout", "stderr"], invalidResult);
    const command = validateCommand(item.command, args[role]);
    const stdout = validateEncodedOutput(item.stdout); const stderr = validateEncodedOutput(item.stderr);
    if (role === "context") {
      const parsed = exactRecord(item.parsed, ["name", "endpoint"], invalidResult);
      if (item.representation !== "JSON" || parsed.name !== lease.contextName || parsed.endpoint !== lease.endpoint) invalidResult();
      return Object.freeze({ command, representation: item.representation, parsed: Object.freeze({ ...parsed }), stdout, stderr });
    }
    if (role === "version") {
      const parsed = exactRecord(item.parsed, ["serverVersion"], invalidResult);
      if (item.representation !== "JSON" || parsed.serverVersion !== "28.0.4") invalidResult();
      return Object.freeze({ command, representation: item.representation, parsed: Object.freeze({ ...parsed }), stdout, stderr });
    }
    if (role === "info") {
      const parsed = exactRecord(item.parsed, ["daemonId", "dataRoot", "os", "arch", "driver", "containerdAddress", "namespaces"], invalidResult);
      const namespaces = exactRecord(parsed.namespaces, ["containers", "plugins"], invalidResult);
      if (item.representation !== "JSON" || parsed.daemonId !== lease.daemonId || parsed.dataRoot !== lease.dataRoot
        || parsed.os !== "linux" || parsed.arch !== "x86_64" || parsed.driver !== "overlay2"
        || parsed.containerdAddress !== lease.containerdAddress || namespaces.containers !== lease.containersNamespace
        || namespaces.plugins !== lease.pluginsNamespace) invalidResult();
      return Object.freeze({ command, representation: item.representation,
        parsed: Object.freeze({ ...parsed, namespaces: Object.freeze({ ...namespaces }) }), stdout, stderr });
    }
    const parsed = exactRecord(item.parsed, ["name", "nodeName", "driver", "endpoint", "status", "buildkit", "platforms", "representation"], invalidResult);
    if (!(["FORMAT_ONLY_JSON", "NATIVE_TEXT"].includes(item.representation)) || parsed.representation !== item.representation
      || parsed.name !== (item.representation === "FORMAT_ONLY_JSON" ? null : lease.contextName) || parsed.nodeName !== lease.contextName
      || parsed.driver !== "docker" || ![lease.endpoint, lease.contextName].includes(parsed.endpoint)
      || typeof parsed.status !== "string" || parsed.status.toLowerCase() !== "running" || typeof parsed.buildkit !== "string"
      || parsed.buildkit.length === 0) invalidResult();
    platformValues(parsed.platforms);
    return Object.freeze({ command, representation: item.representation, parsed: Object.freeze({ ...parsed }), stdout, stderr });
  };
  return Object.freeze({ stage: profiles.stage, context: profile(profiles.context, "context"), version: profile(profiles.version, "version"),
    info: profile(profiles.info, "info"), builder: profile(profiles.builder, "builder") });
}
function validateContext(value) {
  const context = exactRecord(value, ["bytes", "sha256", "entries", "physical"], invalidResult);
  if (context.bytes !== CONTEXT_IDENTITY.bytes || context.sha256 !== CONTEXT_IDENTITY.sha256) invalidResult();
  const rawEntries = denseArray(context.entries, 15, invalidResult);
  if (rawEntries.length !== 15) invalidResult();
  const expected = new Map(EXPECTED_CONTEXT_ENTRIES.map((entry) => [entry.path, entry])); const seen = new Set();
  const entries = rawEntries.map((raw, ordinal) => {
    if (!plain(raw)) invalidResult();
    const pathDescriptor = Object.getOwnPropertyDescriptor(raw, "path");
    if (pathDescriptor === undefined || !Object.hasOwn(pathDescriptor, "value") || pathDescriptor.enumerable !== true) invalidResult();
    const wanted = expected.get(pathDescriptor.value);
    if (wanted === undefined || seen.has(pathDescriptor.value)) invalidResult(); seen.add(pathDescriptor.value);
    const keys = wanted.type === "file"
      ? ["ordinal", "headerOffset", "dataOffset", "path", "type", "mode", "uid", "gid", "mtime", "size", "sha256"]
      : ["ordinal", "headerOffset", "dataOffset", "path", "type", "mode", "uid", "gid", "mtime", "size"];
    const entry = exactRecord(raw, keys, invalidResult);
    if (entry.ordinal !== ordinal || !safeInteger(entry.headerOffset) || entry.headerOffset % 512 !== 0
      || entry.dataOffset !== entry.headerOffset + 512 || entry.path !== wanted.path || entry.type !== wanted.type
      || entry.mode !== wanted.mode || entry.uid !== wanted.uid || entry.gid !== wanted.gid || entry.mtime !== wanted.mtime
      || entry.size !== wanted.size || wanted.type === "file" && entry.sha256 !== wanted.sha256) invalidResult();
    return Object.freeze({ ...entry });
  });
  if (seen.size !== EXPECTED_CONTEXT_ENTRIES.length) invalidResult();
  return Object.freeze({ bytes: context.bytes, sha256: context.sha256, entries: Object.freeze(entries),
    physical: validatePhysical(context.physical, "CONTEXT") });
}
function validateDelta(value) {
  const delta = exactRecord(value,
    ["scope", "authority", "baseMembers", "candidateMembers", "replaced", "addedFiles", "addedDirectories", "mtimeChangedDirectories"], invalidResult);
  if (delta.scope !== "CONDITIONAL_ON_AUTHENTICATED_OCI" || delta.authority !== "NOT_AUTHORIZED"
    || !safeInteger(delta.baseMembers, 1) || !safeInteger(delta.candidateMembers, 1)) invalidResult();
  const replaced = denseArray(delta.replaced, 1, invalidResult); const addedFiles = denseArray(delta.addedFiles, 12, invalidResult);
  const addedDirectories = denseArray(delta.addedDirectories, 3, invalidResult);
  const changed = denseArray(delta.mtimeChangedDirectories, 2, invalidResult);
  if (!sameArray(replaced, ["usr/local/bin/gosu"]) || !sameArray(addedFiles, ADDED_FILES)
    || !ADDED_DIRECTORY_SUFFIXES.some((suffix) => sameArray(addedDirectories, suffix))
    || addedDirectories.some((item, index) => typeof item !== "string" || index > 0 && bytewiseCompare(addedDirectories[index - 1], item) >= 0)
    || changed.some((item, index) => typeof item !== "string" || index > 0 && bytewiseCompare(changed[index - 1], item) >= 0)
    || changed.some((item) => addedDirectories.includes(item))) invalidResult();
  const nearest = addedDirectories.length === 1 ? "usr/share/licenses" : addedDirectories.length === 2 ? "usr/share"
    : addedDirectories.length === 3 ? "usr" : null;
  const allowedChanged = new Set(["usr/local/bin", ...(nearest === null ? [] : [nearest])]);
  if (changed.some((item) => !allowedChanged.has(item))
    || delta.candidateMembers !== delta.baseMembers + 12 + addedDirectories.length) invalidResult();
  return deeplyFreeze({ ...delta, replaced: [...replaced], addedFiles: [...addedFiles], addedDirectories: [...addedDirectories],
    mtimeChangedDirectories: [...changed] });
}
function validatePairSide(value, role) {
  const side = exactRecord(value, ["archive", "configId", "layers"], invalidResult);
  const archive = validateArchive(side.archive);
  if (!matches(CONFIG_ID, side.configId) || side.layers !== (role === "BASE" ? 10 : 12)
    || role === "BASE" && side.configId !== BASE_CONFIG_ID || role === "CANDIDATE" && side.configId === BASE_CONFIG_ID) invalidResult();
  return Object.freeze({ archive, configId: side.configId, layers: side.layers });
}
function validatePairProof(value) {
  const proof = exactRecord(value,
    ["scope", "authority", "profile", "base", "candidate", "inheritedLayers", "addedLayers", "configProfile", "delta"], invalidResult);
  if (proof.scope !== "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW" || proof.authority !== "NOT_AUTHORIZED"
    || proof.profile !== "POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1" || proof.inheritedLayers !== 10
    || proof.addedLayers !== 2 || proof.configProfile !== "STRICT_INHERITED_CONFIG_V2") invalidResult();
  const base = validatePairSide(proof.base, "BASE"); const candidate = validatePairSide(proof.candidate, "CANDIDATE");
  if (base.archive.bytes + candidate.archive.bytes > 2 * GiB) invalidResult();
  return Object.freeze({ ...proof, base, candidate, delta: validateDelta(proof.delta) });
}
function validateRetentionSide(value, role, proofSide) {
  const side = exactRecord(value, ["name", "archive", "configId", "physical"], invalidResult);
  const archive = validateArchive(side.archive); const physical = validatePhysical(side.physical, "ARCHIVE");
  if (side.name !== (role === "BASE" ? "base-image.tar" : "candidate-image.tar") || side.configId !== proofSide.configId
    || !isDeepStrictEqual(archive, proofSide.archive) || physical.size !== archive.bytes) invalidResult();
  return Object.freeze({ name: side.name, archive, configId: side.configId, physical });
}

function validateProducerResult(value, input) {
  const result = exactRecord(value,
    ["state", "authority", "image", "candidateAdmission", "functional", "vulnerabilities", "nonce", "lease", "builder", "profiles",
      "preflight", "context", "buildWindow", "pairProof", "retention", "dates"], invalidResult);
  if (result.state !== "IMAGE_PAIR_RETENTION_SNAPSHOT_OBSERVED_REVIEW_PENDING" || result.authority !== "NOT_AUTHORIZED"
    || result.image !== "BUILT_UNVALIDATED" || result.candidateAdmission !== "NOT_AUTHORIZED" || result.functional !== "NOT_ESTABLISHED"
    || result.vulnerabilities !== "NOT_ESTABLISHED" || result.nonce !== input.nonce || result.dates !== null) invalidResult();
  const lease = exactRecord(result.lease, ["daemonId", "pid", "startTicks"], invalidResult);
  if (lease.daemonId !== input.lease.daemonId || lease.pid !== input.lease.pid || lease.startTicks !== input.lease.startTicks) invalidResult();
  const profiles = validateProfiles(result.profiles, input.lease);
  const builder = exactRecord(result.builder, ["driver", "endpoint", "platforms", "representation"], invalidResult);
  if (builder.driver !== "docker" || builder.endpoint !== profiles.builder.parsed.endpoint
    || builder.platforms !== profiles.builder.parsed.platforms || builder.representation !== profiles.builder.parsed.representation) invalidResult();
  platformValues(builder.platforms);
  const preflight = exactRecord(result.preflight, ["acceptance", "source", "context"], invalidResult);
  const acceptance = exactRecord(preflight.acceptance, ["bytes", "sha256"], invalidResult);
  const source = exactRecord(preflight.source, ["head", "main", "tree"], invalidResult);
  const preflightContext = exactRecord(preflight.context, ["bytes", "sha256"], invalidResult);
  if (!isDeepStrictEqual(acceptance, { bytes: ACCEPTANCE.bytes, sha256: ACCEPTANCE.sha256 })
    || !isDeepStrictEqual(source, SOURCE_IDENTITY) || !isDeepStrictEqual(preflightContext, CONTEXT_IDENTITY)) invalidResult();
  const context = validateContext(result.context);
  if (context.bytes !== preflightContext.bytes || context.sha256 !== preflightContext.sha256) invalidResult();
  const buildWindow = validateBuildWindow(result.buildWindow, input.lease); const pairProof = validatePairProof(result.pairProof);
  const retention = exactRecord(result.retention,
    ["state", "preservation", "authority", "admission", "directory", "buildWindow", "base", "candidate"], invalidResult);
  if (retention.state !== "SEALED_SNAPSHOT_REVIEW_PENDING" || retention.preservation !== "FUTURE_CONTROLLER_REQUIRED"
    || retention.authority !== "NOT_AUTHORIZED" || retention.admission !== "NOT_AUTHORIZED") invalidResult();
  const retentionWindow = validateBuildWindow(retention.buildWindow, input.lease);
  if (!isDeepStrictEqual(retentionWindow, buildWindow)) invalidResult();
  const base = validateRetentionSide(retention.base, "BASE", pairProof.base);
  const candidate = validateRetentionSide(retention.candidate, "CANDIDATE", pairProof.candidate);
  const closed = {
    ...result, lease: Object.freeze({ ...lease }), builder: Object.freeze({ ...builder }), profiles,
    preflight: deeplyFreeze({ acceptance: { ...acceptance }, source: { ...source }, context: { ...preflightContext } }), context, buildWindow,
    pairProof, retention: Object.freeze({ ...retention, directory: validatePhysical(retention.directory, "DIRECTORY"),
      buildWindow: retentionWindow, base, candidate }),
  };
  return frozenCopy(closed);
}

export async function runGosuRetainedPairWorkerV1(transport) {
  let originalInput; let invoked = false;
  try {
    if (arguments.length !== 1) invalidInput();
    const accepted = validateTransportObject(transport, invalidInput); originalInput = accepted.originalInput;
    try { verifyDeploymentCopy(accepted.transport.sourceClosure); }
    catch (error) {
      if (error instanceof CloseUncertainError) throw error;
      if (error?.code === "gosu_retained_pair_worker_source_invalid") throw error;
      throw workerFailure("gosu_retained_pair_worker_source_invalid", "SOURCE", "NOT_STARTED");
    }
    validateRuntime(accepted.transport.input);
    invoked = true;
    let result;
    try { result = await runGosuDerivativeImageRetainedBuildProofV1(originalInput); }
    catch { throw workerFailure("gosu_retained_pair_worker_producer_failed", "PRODUCER", "UNCERTAIN"); }
    return validateProducerResult(result, accepted.transport.input);
  } catch (error) {
    if (error instanceof CloseUncertainError) throw workerFailure("gosu_retained_pair_worker_cleanup_uncertain", "CLEANUP", "UNCERTAIN");
    if (error?.code === "gosu_retained_pair_worker_result_invalid") throw error;
    if (error?.code === "gosu_retained_pair_worker_producer_failed") throw error;
    if (WORKER_CODE_SET.has(error?.code)) {
      if (invoked && error.cleanup !== "UNCERTAIN") throw workerFailure(error.code, error.phase, "UNCERTAIN");
      throw error;
    }
    throw workerFailure(invoked ? "gosu_retained_pair_worker_producer_failed" : "gosu_retained_pair_worker_input_invalid",
      invoked ? "PRODUCER" : "INPUT", invoked ? "UNCERTAIN" : "NOT_STARTED");
  }
}

export function gosuRetainedPairWorkerV1FailureDiagnostic(error) {
  let code = "gosu_retained_pair_worker_input_invalid"; let phase = "INPUT"; let cleanup = "NOT_STARTED";
  try {
    if ((typeof error === "object" || typeof error === "function") && error !== null && !types.isProxy(error)) {
      const descriptors = Object.getOwnPropertyDescriptors(error);
      const codeValue = descriptors.code && Object.hasOwn(descriptors.code, "value") ? descriptors.code.value : undefined;
      const phaseValue = descriptors.phase && Object.hasOwn(descriptors.phase, "value") ? descriptors.phase.value : undefined;
      const cleanupValue = descriptors.cleanup && Object.hasOwn(descriptors.cleanup, "value") ? descriptors.cleanup.value : undefined;
      if (WORKER_CODE_SET.has(codeValue)) code = codeValue;
      if (WORKER_PHASES.includes(phaseValue)) phase = phaseValue;
      if (CLEANUP_VALUES.has(cleanupValue)) cleanup = cleanupValue;
    }
  } catch { /* Closed projection never invokes hostile accessors. */ }
  return Object.freeze({ kind: gosuRetainedPairWorkerV1Contract.kinds.failure, state: "FAILED", code, phase, cleanup,
    authority: "NOT_AUTHORIZED", preservation: "NOT_ESTABLISHED", dates: null });
}

async function readStdin() {
  const chunks = []; let total = 0;
  try {
    for await (const chunk of process.stdin) {
      if (!Buffer.isBuffer(chunk) && typeof chunk !== "string") throw new CloseUncertainError();
      const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
      total += bytes.length; if (total > TRANSPORT_LIMIT) invalidInput(); chunks.push(bytes);
    }
  } catch (error) {
    if (error?.code === "gosu_retained_pair_worker_input_invalid") throw error;
    throw new CloseUncertainError("stdin framing uncertain");
  }
  return Buffer.concat(chunks, total);
}
function frame(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length > OUTPUT_LIMIT) fail("gosu_retained_pair_worker_result_invalid", "RESULT", "UNCERTAIN");
  return bytes;
}
function endStdout(bytes) {
  return new Promise((resolve, reject) => {
    let settled = false; let callbackComplete = false; let finished = false;
    const settle = () => {
      if (!settled && callbackComplete && finished) { settled = true; resolve(); }
    };
    const onError = (error) => {
      process.exitCode = gosuRetainedPairWorkerV1Contract.exitCodes.failure;
      if (!settled) { settled = true; reject(error); }
    };
    process.stdout.on("error", onError);
    process.stdout.once("finish", () => { finished = true; settle(); });
    process.stdout.once("close", () => {
      if (!finished) onError(new Error("stdout closed before finish"));
    });
    try {
      process.stdout.end(bytes, (error) => {
        if (error) onError(error); else { callbackComplete = true; settle(); }
      });
    } catch (error) { onError(error); }
  });
}
async function directMain() {
  let wrote = false;
  try {
    const modulePath = fileURLToPath(import.meta.url);
    if (process.argv.length !== 2 || process.argv[0] !== gosuRetainedPairWorkerV1Contract.node.path
      || path.resolve(process.argv[1]) !== modulePath) invalidInput();
    const transport = validateGosuRetainedPairWorkerTransportV1(await readStdin());
    const result = await runGosuRetainedPairWorkerV1(transport);
    const bytes = frame({ kind: gosuRetainedPairWorkerV1Contract.kinds.result, state: "SUCCEEDED",
      scope: "GENUINE_DEFAULT_PRODUCER_ONCE", result });
    process.exitCode = gosuRetainedPairWorkerV1Contract.exitCodes.success;
    wrote = true; await endStdout(bytes);
  } catch (error) {
    process.exitCode = gosuRetainedPairWorkerV1Contract.exitCodes.failure;
    if (wrote) return;
    const diagnostic = error instanceof CloseUncertainError
      ? gosuRetainedPairWorkerV1FailureDiagnostic(workerFailure("gosu_retained_pair_worker_cleanup_uncertain", "CLEANUP", "UNCERTAIN"))
      : gosuRetainedPairWorkerV1FailureDiagnostic(error);
    try { wrote = true; await endStdout(frame(diagnostic)); } catch { /* Never append a second frame or write stderr. */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await directMain();
