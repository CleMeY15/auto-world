import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, readSync, realpathSync,
  statfsSync, unlinkSync, writeSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";
import { createGunzip } from "node:zlib";

import { candidateContractV2, openCandidateLockV2, validateCandidateContextV2 } from "./gosu-derivative-candidate-v2.mjs";
import { scanRawUstar } from "../seaweed-image/archive.mjs";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const DOCKER = "/usr/bin/docker";
const PURPOSE = "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION";
const BASE_REFERENCE = "postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3";
const BASE_CONFIG_ID = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
const CONTEXT_PATH = "/home/autoworld/auto-world-private-contexts/gosu-candidate-context-v2/context.tar";
const CONTEXT_BYTES = 1_986_560;
const CONTEXT_SHA256 = "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb";
const ACCEPTANCE_IDENTITY = Object.freeze({ bytes: 11_744, sha256: "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3" });
const SOURCE_IDENTITY = Object.freeze({ head: "582fb97e88cf5a498e6ae34ec76eb5736ada2a47",
  main: "e4fa47cbe66758a5b56f5347c2c27e61bdae1ed0", tree: "7292e98e7ee23e45ebccff075577af41f271dbf9" });
const ARCHIVE_LIMIT = GiB;
const GZIP_COMPRESSED_LIMIT = 256 * MiB;
const JSON_LIMIT = 4 * MiB;
const OUTPUT_LIMIT = 2 * MiB;
const STDERR_LIMIT = 2 * MiB;
const HEX24 = /^[0-9a-f]{24}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const PHASES = Object.freeze(["PREFLIGHT", "ROUTING", "CONTEXT", "BASE", "BUILD", "SAVE_BASE", "SAVE_CANDIDATE", "OBSERVE", "FINAL"]);
const CODES = new Set([
  "gosu_derivative_image_observation_input_invalid",
  "gosu_derivative_image_observation_runtime_invalid",
  "gosu_derivative_image_observation_routing_invalid",
  "gosu_derivative_image_observation_context_invalid",
  "gosu_derivative_image_observation_command_failed",
  "gosu_derivative_image_observation_stream_invalid",
  "gosu_derivative_image_observation_archive_invalid",
  "gosu_derivative_image_observation_identity_invalid",
  "gosu_derivative_image_observation_deadline_exceeded",
]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE_PATH = path.join(repoRoot, ".omx", "gosu-derivative-context-private-acceptance-v1.json");
const LOCK_PATH = path.join(repoRoot, "infra", "postgres-image", "gosu-derivative-candidate-lock-v2.json");
const contextSessions = new WeakMap();

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, fields) => plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort())
  && Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => Object.hasOwn(descriptor, "value"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const freeze = (value) => Array.isArray(value) ? Object.freeze(value.map(freeze)) : plain(value)
  ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)]))) : value;
function fail(code, phase) { throw Object.assign(new Error(code), { phase }); }
function closed(error, phase, fallback = "gosu_derivative_image_observation_input_invalid") {
  let code = fallback;
  try { if (CODES.has(error?.message)) code = error.message; } catch { /* Closed error projection. */ }
  let state = "UNBUILT";
  try { if (error?.state === "MAY_HAVE_BEEN_BUILT") state = "MAY_HAVE_BEEN_BUILT"; } catch { /* Closed state projection. */ }
  return Object.assign(new Error(code), { phase: PHASES.includes(phase) ? phase : "PREFLIGHT", state });
}
export function gosuDerivativeImageObservationFailureDiagnostic(error, phase) {
  let code = "gosu_derivative_image_observation_input_invalid"; let state = "UNBUILT";
  try { if (CODES.has(error?.message)) code = error.message; } catch { /* Read hostile messages at most once. */ }
  try { if (error?.state === "MAY_HAVE_BEEN_BUILT") state = "MAY_HAVE_BEEN_BUILT"; } catch { /* Closed state projection. */ }
  let reportedPhase = phase;
  if (reportedPhase === undefined) try { reportedPhase = error?.phase; } catch { /* Closed phase projection. */ }
  return Object.freeze({ code, phase: PHASES.includes(reportedPhase) ? reportedPhase : "PREFLIGHT", state });
}
function chunks(buffer, guard = () => undefined) {
  return (function* boundedChunks() {
    for (let offset = 0; offset < buffer.length; offset += MiB) { guard(); yield buffer.subarray(offset, Math.min(buffer.length, offset + MiB)); }
  })();
}
function readable(buffer, guard) { return Readable.from(chunks(buffer, guard)); }
async function scanGzipLayerWithControl(body, diffId, maxRawBytes, control) {
  if (body.length === 0 || body.length > GZIP_COMPRESSED_LIMIT) {
    fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
  }
  const compressedSha256 = hash(body); let compressedBytes = 0; const compressedHash = createHash("sha256");
  const input = Readable.from((async function* guardedCompressedInput() {
    for (const chunk of chunks(body, control.guard)) {
      const detached = Buffer.from(chunk); compressedBytes += detached.length; compressedHash.update(detached); yield detached;
    }
  })());
  const gunzip = createGunzip();
  const abort = () => {
    const error = Object.assign(new Error("gosu_derivative_image_observation_deadline_exceeded"), { phase: "OBSERVE" });
    input.destroy(error); gunzip.destroy(error);
  };
  control.signal?.addEventListener("abort", abort, { once: true });
  input.on("error", (error) => gunzip.destroy(error));
  input.pipe(gunzip);
  const guardedOutput = Readable.from((async function* guardedGunzipOutput() {
    for await (const chunk of gunzip) { control.guard(); yield chunk; }
    control.guard();
  })());
  try {
    const result = await scanRawUstar({ input: guardedOutput, diffId, maxRawBytes, maxMembers: 100_000, signal: control.signal });
    control.guard();
    if (compressedBytes !== body.length || compressedHash.digest("hex") !== compressedSha256 || gunzip.bytesWritten !== body.length) {
      fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
    }
    return result;
  } catch (error) {
    if (control.signal?.aborted) control.guard();
    throw error;
  } finally {
    control.signal?.removeEventListener("abort", abort);
    input.destroy(); gunzip.destroy(); guardedOutput.destroy();
  }
}
function parseJson(buffer, code, maximum = JSON_LIMIT, phase = "OBSERVE") {
  if (!Buffer.isBuffer(buffer) || buffer.length > maximum) fail(code, phase);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); } catch { fail(code, phase); }
}
function validateSubject(value) {
  if (!exact(value, ["role", "reference", "imageId", "configId", "platform"])
    || !["BASE", "CANDIDATE"].includes(value.role) || !DIGEST.test(value.imageId) || !DIGEST.test(value.configId)
    || !exact(value.platform, ["os", "architecture"]) || value.platform.os !== "linux" || value.platform.architecture !== "amd64"
    || value.role === "BASE" && (value.reference !== BASE_REFERENCE || value.imageId !== BASE_CONFIG_ID || value.configId !== BASE_CONFIG_ID)
    || value.role === "CANDIDATE" && !/^aw-postgres-gosu:[0-9a-f]{24}$/u.test(value.reference)) {
    fail("gosu_derivative_image_observation_identity_invalid", "OBSERVE");
  }
  return freeze({ ...value, platform: { ...value.platform } });
}
function memberBody(buffer, member) {
  const { uncompressedDataOffset: offset, entry } = member;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(entry.size) || offset + entry.size > buffer.length) {
    fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
  }
  return buffer.subarray(offset, offset + entry.size);
}
function descriptor(member) {
  return freeze({ ordinal: member.memberOrdinal, headerOffset: member.uncompressedHeaderOffset,
    dataOffset: member.uncompressedDataOffset, path: member.entry.path, type: member.entry.type, mode: member.entry.mode,
    uid: member.entry.uid, gid: member.entry.gid, mtime: member.entry.mtime, size: member.entry.size,
    ...(member.entry.sha256 === undefined ? {} : { sha256: member.entry.sha256 }) });
}

async function inspectSave(buffer, subject, control) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > ARCHIVE_LIMIT) {
    fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
  }
  const accepted = validateSubject(subject);
  let scan;
  try {
    control.guard();
    scan = await scanRawUstar({ input: readable(buffer, control.guard), diffId: `sha256:${hash(buffer)}`, maxRawBytes: ARCHIVE_LIMIT,
      maxMembers: 4096, allowHardlinks: false, signal: control.signal });
    control.guard();
  } catch (error) { if (CODES.has(error?.message)) throw error; fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE"); }
  const byPath = new Map(scan.members.map((member) => [member.entry.path, member]));
  const manifestMember = byPath.get("manifest.json");
  if (!manifestMember || manifestMember.entry.type !== "file" || manifestMember.entry.size > JSON_LIMIT) {
    fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
  }
  const manifest = parseJson(memberBody(buffer, manifestMember), "gosu_derivative_image_observation_archive_invalid");
  if (!Array.isArray(manifest) || manifest.length !== 1 || !exact(manifest[0], ["Config", "RepoTags", "Layers"])
    || typeof manifest[0].Config !== "string"
    || accepted.role === "CANDIDATE" && (!Array.isArray(manifest[0].RepoTags) || !manifest[0].RepoTags.includes(accepted.reference))
    || accepted.role === "BASE" && manifest[0].RepoTags !== null && !Array.isArray(manifest[0].RepoTags)
    || !Array.isArray(manifest[0].Layers) || manifest[0].Layers.length === 0
    || new Set(manifest[0].Layers).size !== manifest[0].Layers.length) {
    fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
  }
  const configMember = byPath.get(manifest[0].Config);
  if (!configMember || configMember.entry.type !== "file" || configMember.entry.size > JSON_LIMIT) {
    fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
  }
  const configBytes = memberBody(buffer, configMember);
  if (`sha256:${hash(configBytes)}` !== accepted.configId || accepted.imageId !== accepted.configId) {
    fail("gosu_derivative_image_observation_identity_invalid", "OBSERVE");
  }
  const config = parseJson(configBytes, "gosu_derivative_image_observation_archive_invalid");
  if (!plain(config) || config.os !== "linux" || config.architecture !== "amd64" || !plain(config.rootfs)
    || config.rootfs.type !== "layers" || !Array.isArray(config.rootfs.diff_ids)
    || config.rootfs.diff_ids.length !== manifest[0].Layers.length || config.rootfs.diff_ids.some((item) => !DIGEST.test(item))) {
    fail("gosu_derivative_image_observation_identity_invalid", "OBSERVE");
  }
  const layers = [];
  for (const [index, layerPath] of manifest[0].Layers.entries()) {
    if (typeof layerPath !== "string") fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
    const member = byPath.get(layerPath);
    if (!member || member.entry.type !== "file") fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
    const body = memberBody(buffer, member); const storedSha256 = hash(body); let encoding = "OPAQUE"; let tar = null;
    try {
      if (body[0] === 0x1f && body[1] === 0x8b) {
        encoding = "GZIP";
        const maximum = control.maximumExpanded();
        tar = await scanGzipLayerWithControl(body, config.rootfs.diff_ids[index], maximum, control);
      } else if (body.length >= 265 && body.subarray(257, 263).equals(Buffer.from("ustar\0"))) {
        encoding = "USTAR";
        const maximum = control.maximumExpanded();
        tar = await scanRawUstar({ input: readable(body, control.guard), diffId: config.rootfs.diff_ids[index], maxRawBytes: maximum,
          maxMembers: 100_000, allowHardlinks: false, signal: control.signal });
      }
    } catch (error) { if (CODES.has(error?.message)) throw error; fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE"); }
    if (tar !== null) control.consumeExpanded(tar.rawSize ?? tar.uncompressedSize);
    layers[layers.length] = freeze({ ordinal: index, path: layerPath, storedBytes: body.length, storedSha256, encoding,
      expandedBytes: tar === null ? "NOT_ESTABLISHED" : tar.rawSize ?? tar.uncompressedSize,
      diffId: encoding === "OPAQUE" ? "NOT_ESTABLISHED" : config.rootfs.diff_ids[index],
      members: tar === null ? "NOT_ESTABLISHED" : tar.members.map(descriptor) });
  }
  return freeze({ state: "FORMAT_OBSERVED_ONLY", subject: accepted,
    archive: { bytes: buffer.length, sha256: hash(buffer), members: scan.members.map(descriptor) },
    manifest: { path: manifestMember.entry.path, sha256: manifestMember.entry.sha256, config: manifest[0].Config,
      repoTags: Array.isArray(manifest[0].RepoTags) ? [...manifest[0].RepoTags] : [], layers: [...manifest[0].Layers] },
    config: { path: configMember.entry.path, sha256: configMember.entry.sha256, os: config.os,
      architecture: config.architecture, diffIds: [...config.rootfs.diff_ids] }, layers,
    predicates: { functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED", candidateAdmission: "NOT_ESTABLISHED" } });
}
export async function inspectGosuDerivativeImageSaveV2(buffer, subject) {
  let remaining = 2 * GiB;
  const control = Object.freeze({ guard: () => undefined, signal: undefined,
    maximumExpanded: () => { if (remaining <= 0) fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE"); return Math.min(GiB, remaining); },
    consumeExpanded: (bytes) => { if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > remaining) fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE"); remaining -= bytes; } });
  return inspectSave(buffer, subject, control);
}

function validateLease(value, nonce) {
  const required = ["purpose", "authority", "admission", "root", "nonce", "socket", "endpoint", "dockerConfig", "buildxConfig",
    "outputDirectory", "contextName", "pid", "startTicks", "daemonId", "version", "dataRoot", "execRoot", "containerdAddress",
    "containersNamespace", "pluginsNamespace", "configSha256", "argvSha256", "deadlineAtMs", "rootActor", "clientActor", "socketProof", "socketDirectoryProof"];
  if (!exact(value, required) || value.purpose !== PURPOSE || value.authority !== "LOCAL_DIAGNOSTIC" || value.admission !== "NOT_AUTHORIZED"
    || value.nonce !== nonce || typeof value.root !== "string" || !/^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u.test(value.root)
    || value.socket !== `${value.root}/endpoint/docker.sock` || value.endpoint !== `unix://${value.socket}`
    || value.dockerConfig !== `${value.root}/client` || value.buildxConfig !== `${value.root}/client/buildx`
    || value.outputDirectory !== `${value.root}/client/output` || value.contextName !== `aw-cold-${nonce}`
    || !Number.isSafeInteger(value.deadlineAtMs) || value.deadlineAtMs <= 0
    || value.dataRoot !== `${value.root}/infra/data` || value.execRoot !== `${value.root}/infra/exec`
    || value.containerdAddress !== "/run/containerd/containerd.sock" || value.containersNamespace !== `awcold-${nonce}`
    || value.pluginsNamespace !== `plugins.awcold-${nonce}` || !/^[0-9a-f]{64}$/u.test(value.configSha256)
    || !/^[0-9a-f]{64}$/u.test(value.argvSha256) || !Number.isSafeInteger(value.pid) || value.pid < 2
    || !/^[1-9][0-9]{0,19}$/u.test(value.startTicks) || typeof value.daemonId !== "string" || value.daemonId.length === 0
    || !exact(value.rootActor, ["uid", "gid"]) || value.rootActor.uid !== 0 || value.rootActor.gid !== 0
    || !exact(value.clientActor, ["uid", "gid"]) || value.clientActor.uid !== 1000 || value.clientActor.gid !== 1000
    || !exact(value.socketProof, ["dev", "ino", "uid", "gid", "mode"]) || !/^[0-9]+$/u.test(value.socketProof.dev)
    || !/^[0-9]+$/u.test(value.socketProof.ino) || value.socketProof.uid !== 0 || value.socketProof.gid !== 1000 || value.socketProof.mode !== 0o660
    || !exact(value.socketDirectoryProof, ["dev", "ino", "uid", "gid", "mode"]) || !/^[0-9]+$/u.test(value.socketDirectoryProof.dev)
    || !/^[0-9]+$/u.test(value.socketDirectoryProof.ino) || value.socketDirectoryProof.uid !== 0 || value.socketDirectoryProof.gid !== 1000
    || value.socketDirectoryProof.mode !== 0o710 || value.version !== "28.0.4") fail("gosu_derivative_image_observation_routing_invalid", "PREFLIGHT");
  return freeze({ ...value, rootActor: { ...value.rootActor }, clientActor: { ...value.clientActor },
    socketProof: { ...value.socketProof }, socketDirectoryProof: { ...value.socketDirectoryProof } });
}
function validateDependencies(value) {
  if (!plain(value) || Object.keys(value).some((key) => !["now", "runner", "contextReader", "archiveReader"].includes(key))
    || Object.values(value).some((item) => typeof item !== "function")) fail("gosu_derivative_image_observation_input_invalid", "PREFLIGHT");
}
function runtimeGuard() {
  const groups = process.getgroups?.();
  if (process.platform !== "linux" || process.version !== "v22.23.2" || process.getuid?.() !== 1000 || process.geteuid?.() !== 1000
    || process.getgid?.() !== 1000 || process.getegid?.() !== 1000 || !Array.isArray(groups) || groups.length !== 1 || groups[0] !== 1000
    || process.env.NODE_OPTIONS !== undefined || process.env.NODE_PATH !== undefined) {
    fail("gosu_derivative_image_observation_runtime_invalid", "PREFLIGHT");
  }
  const status = readFileSync("/proc/self/status", "utf8");
  if (!/^Groups:[ \t]*$/mu.test(status) || !/^NoNewPrivs:[ \t]+1$/mu.test(status)
    || ["CapInh:", "CapPrm:", "CapEff:", "CapBnd:", "CapAmb:"].some((name) => !new RegExp(`^${name}[ \\t]+0{16}$`, "mu").test(status))) {
    fail("gosu_derivative_image_observation_runtime_invalid", "PREFLIGHT");
  }
}
function stableSnapshot(value) {
  return freeze({ dev: String(value.dev), ino: String(value.ino), mode: Number(value.mode), nlink: Number(value.nlink),
    size: Number(value.size), uid: Number(value.uid), gid: Number(value.gid), mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs),
    birthtimeNs: String(value.birthtimeNs) });
}
function contextAncestorSessions() {
  const paths = ["/", "/home", "/home/autoworld", "/home/autoworld/auto-world-private-contexts",
    "/home/autoworld/auto-world-private-contexts/gosu-candidate-context-v2"];
  const sessions = [];
  try {
    for (const directory of paths) {
      const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const held = fstatSync(fd, { bigint: true }); const named = lstatSync(directory, { bigint: true });
      const snapshot = stableSnapshot(held); const privateDirectory = directory.includes("auto-world-private-contexts");
      if (!held.isDirectory() || held.isSymbolicLink() || !isDeepStrictEqual(snapshot, stableSnapshot(named))
        || realpathSync(directory) !== directory || (held.mode & 0o002n) !== 0n
        || privateDirectory && (held.uid !== 1000n || held.gid !== 1000n || (held.mode & 0o7777n) !== 0o700n)) {
        closeSync(fd); fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
      }
      sessions[sessions.length] = Object.freeze({ directory, fd, snapshot });
    }
    return sessions;
  } catch (error) {
    for (const session of sessions) try { closeSync(session.fd); } catch { /* best effort */ }
    throw error;
  }
}
function guardContextAncestors(sessions) {
  for (const session of sessions) {
    const held = stableSnapshot(fstatSync(session.fd, { bigint: true })); const named = stableSnapshot(lstatSync(session.directory, { bigint: true }));
    if (!isDeepStrictEqual(held, session.snapshot) || !isDeepStrictEqual(named, session.snapshot)
      || realpathSync(session.directory) !== session.directory) fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
  }
}
function readPinnedJson(file, expected) {
  const bytes = readFileSync(file);
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) fail("gosu_derivative_image_observation_context_invalid", "PREFLIGHT");
  return parseJson(bytes, "gosu_derivative_image_observation_context_invalid", expected.bytes, "PREFLIGHT");
}
function acceptedContextPreflight(includePrivateReceipts) {
  const acceptance = readPinnedJson(ACCEPTANCE_PATH, ACCEPTANCE_IDENTITY);
  if (acceptance.kind !== "GOSU_DERIVATIVE_CONTEXT_PRIVATE_ACCEPTANCE_V1" || !isDeepStrictEqual(acceptance.source, SOURCE_IDENTITY)
    || !isDeepStrictEqual(acceptance.context, { bytes: CONTEXT_BYTES, sha256: CONTEXT_SHA256 })
    || acceptance.checks?.contextTupleEqualAcrossOperationReceiptStreamStat !== true
    || acceptance.checks?.claimPrePostEqual !== true || acceptance.checks?.inputsPrePostEqual !== true
    || acceptance.candidateAdmission !== "NOT_AUTHORIZED" || acceptance.functionalValidation !== "NOT_ESTABLISHED") {
    fail("gosu_derivative_image_observation_context_invalid", "PREFLIGHT");
  }
  if (includePrivateReceipts) {
    for (const name of ["claim", "success"]) {
      const receipt = acceptance.receipts?.[name];
      if (!plain(receipt) || !Number.isSafeInteger(receipt.bytes) || !/^[0-9a-f]{64}$/u.test(receipt.sha256)) {
        fail("gosu_derivative_image_observation_context_invalid", "PREFLIGHT");
      }
      const body = readFileSync(receipt.path);
      if (body.length !== receipt.bytes || hash(body) !== receipt.sha256) fail("gosu_derivative_image_observation_context_invalid", "PREFLIGHT");
    }
  }
  return freeze({ acceptance: ACCEPTANCE_IDENTITY, source: SOURCE_IDENTITY, context: acceptance.context });
}
function defaultContextReader(specification, control) {
  if (!isDeepStrictEqual(specification, { path: CONTEXT_PATH, bytes: CONTEXT_BYTES, sha256: CONTEXT_SHA256 })) {
    fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
  }
  const ancestors = contextAncestorSessions(); let fd;
  try {
    fd = openSync(CONTEXT_PATH, constants.O_RDONLY | constants.O_NOFOLLOW); guardContextAncestors(ancestors);
    const before = fstatSync(fd, { bigint: true }); const named = lstatSync(CONTEXT_PATH, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== 1000n || before.gid !== 1000n || before.nlink !== 1n
      || (before.mode & 0o7777n) !== 0o600n || before.size !== BigInt(CONTEXT_BYTES) || before.dev !== named.dev || before.ino !== named.ino
      || realpathSync(CONTEXT_PATH) !== CONTEXT_PATH) fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
    const buffer = Buffer.allocUnsafe(CONTEXT_BYTES); let offset = 0;
    while (offset < buffer.length) { control.guard(); const count = readSync(fd, buffer, offset, Math.min(MiB, buffer.length - offset), offset); if (count <= 0) break; offset += count; }
    control.guard();
    const after = fstatSync(fd, { bigint: true }); const final = lstatSync(CONTEXT_PATH, { bigint: true });
    if (offset !== CONTEXT_BYTES || !isDeepStrictEqual(stableSnapshot(before), stableSnapshot(after))
      || !isDeepStrictEqual(stableSnapshot(before), stableSnapshot(final))) {
      fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
    }
    const initial = stableSnapshot(before);
    const record = freeze({ buffer, identity: { bytes: buffer.length, sha256: hash(buffer) }, physical: initial });
    contextSessions.set(record, Object.freeze({
      guard: () => {
        guardContextAncestors(ancestors);
        const held = stableSnapshot(fstatSync(fd, { bigint: true })); const current = stableSnapshot(lstatSync(CONTEXT_PATH, { bigint: true }));
        if (!isDeepStrictEqual(held, initial) || !isDeepStrictEqual(current, initial)) fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
      }, close: () => { closeSync(fd); for (const session of ancestors) closeSync(session.fd); } }));
    return record;
  } catch (error) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* best effort */ }
    for (const session of ancestors) try { closeSync(session.fd); } catch { /* best effort */ }
    throw error;
  }
}
function readerRecord(value, expected, phase) {
  if (!exact(value, ["buffer", "identity", "physical"]) || !Buffer.isBuffer(value.buffer)
    || !isDeepStrictEqual(value.identity, { bytes: value.buffer.length, sha256: hash(value.buffer) })
    || value.identity.bytes > expected.maximumBytes || expected.bytes !== undefined && value.identity.bytes !== expected.bytes
    || expected.sha256 !== undefined && value.identity.sha256 !== expected.sha256 || !plain(value.physical)) {
    fail(phase === "CONTEXT" ? "gosu_derivative_image_observation_context_invalid" : "gosu_derivative_image_observation_archive_invalid", phase);
  }
  return value;
}
function parseBuilder(value, lease) {
  let builder; let parsedJson = false;
  try {
    builder = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value)); parsedJson = true;
    if (!exact(builder, ["Driver", "Nodes"]) || !Array.isArray(builder.Nodes) || builder.Nodes.length !== 1
      || !exact(builder.Nodes[0], ["Name", "Endpoint", "Status", "Buildkit", "Platforms"])) {
      fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
    }
  } catch (error) {
    if (error?.message === "gosu_derivative_image_observation_routing_invalid") throw error;
    let text; try { text = new TextDecoder("utf-8", { fatal: true }).decode(value); }
    catch { fail("gosu_derivative_image_observation_routing_invalid", "ROUTING"); }
    const lines = text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
    if (lines.length > 256 || lines.some((line) => line.length > 2048
      || [...line].some((character) => character.charCodeAt(0) !== 9 && (character.charCodeAt(0) < 32 || character.charCodeAt(0) > 126)))) {
      fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
    }
    const top = new Map(); const node = new Map(); const policyNumbers = new Set(); let section = "TOP"; let nodeCount = 0;
    for (const raw of lines) {
      const line = raw.trim();
      if (line === "Nodes:") { if (section !== "TOP") fail("gosu_derivative_image_observation_routing_invalid", "ROUTING"); section = "NODES"; continue; }
      const match = /^([^:]+):[ \t]*(.*)$/u.exec(line);
      if (!match) fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
      const [, name, content] = match;
      if (section === "TOP") {
        if (!["Name", "Driver", "Last Activity"].includes(name) || top.has(name) || content.length === 0) fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
        top.set(name, content); continue;
      }
      if (name === "GC Policy rule#0" || /^GC Policy rule#[1-9][0-9]*$/u.test(name)) {
        const number = Number(name.slice("GC Policy rule#".length));
        if (policyNumbers.has(number) || content.length !== 0) fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
        policyNumbers.add(number); section = "POLICY"; continue;
      }
      if (section === "POLICY") {
        if (!["All", "Filters", "Keep Duration", "Reserved Space", "Max Used Space", "Min Free Space"].includes(name) || content.length === 0) {
          fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
        }
        continue;
      }
      if (name === "Labels") { if (content.length !== 0) fail("gosu_derivative_image_observation_routing_invalid", "ROUTING"); section = "LABELS"; continue; }
      if (section === "LABELS" && !["Name", "Endpoint", "Status", "BuildKit version", "Platforms", "Driver"].includes(name)
        && /^[A-Za-z0-9_.-]+$/u.test(name) && content.length > 0) continue;
      if (!["Name", "Endpoint", "Status", "BuildKit version", "Platforms"].includes(name) || node.has(name) || content.length === 0) {
        fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
      }
      if (name === "Name") nodeCount += 1;
      node.set(name, content);
    }
    if (section === "TOP" || nodeCount !== 1 || top.get("Name") !== "default" || top.get("Driver") !== "docker") {
      fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
    }
    builder = { Driver: top.get("Driver"), Nodes: [{ Name: node.get("Name"), Endpoint: node.get("Endpoint"), Status: node.get("Status"),
      Buildkit: node.get("BuildKit version"), Platforms: node.get("Platforms") }] };
  }
  const node = builder?.Nodes?.[0];
  if (builder?.Driver !== "docker" || !Array.isArray(builder.Nodes) || builder.Nodes.length !== 1 || !plain(node)
    || node.Name !== "default" || ![lease.endpoint, lease.contextName].includes(node.Endpoint)
    || !String(node.Platforms ?? "").split(/,[ \t]*/u).map((item) => item.replace(/\*$/u, "")).includes("linux/amd64")
    || String(node.Status ?? "").toLowerCase() !== "running" || typeof node.Buildkit !== "string" || node.Buildkit.length === 0) {
    fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
  }
  return freeze({ driver: "docker", endpoint: node.Endpoint, platforms: String(node.Platforms), representation: parsedJson ? "FORMAT_ONLY_JSON" : "NATIVE_TEXT" });
}
function promoteNoReplace(partial, final, expectedPhysical) {
  const before = lstatSync(partial, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.uid !== 1000n || before.gid !== 1000n || before.nlink !== 1n
    || (before.mode & 0o7777n) !== 0o600n || !isDeepStrictEqual(stableSnapshot(before), expectedPhysical)) {
    fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE");
  }
  const directoryFd = openSync(path.dirname(final), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    linkSync(partial, final); const linked = lstatSync(final, { bigint: true });
    if (linked.dev !== before.dev || linked.ino !== before.ino || linked.nlink !== 2n) fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE");
    fsyncSync(directoryFd); unlinkSync(partial); fsyncSync(directoryFd);
    const promoted = lstatSync(final, { bigint: true });
    if (promoted.dev !== before.dev || promoted.ino !== before.ino || promoted.nlink !== 1n) fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE");
    return freeze({ path: final, physical: stableSnapshot(promoted) });
  } catch { fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE"); }
  finally { closeSync(directoryFd); }
}
function defaultArchiveReader(specification, control) {
  if (!exact(specification, ["path", "role", "maximumBytes"]) || !["BASE", "CANDIDATE"].includes(specification.role)
    || specification.maximumBytes !== ARCHIVE_LIMIT) fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
  const fd = openSync(specification.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd, { bigint: true }); const named = lstatSync(specification.path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== 1000n || stat.gid !== 1000n
      || (stat.mode & 0o7777n) !== 0o600n || stat.size <= 0n || stat.size > BigInt(ARCHIVE_LIMIT)
      || !isDeepStrictEqual(stableSnapshot(stat), stableSnapshot(named)) || realpathSync(specification.path) !== specification.path) {
      fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
    }
    const buffer = Buffer.allocUnsafe(Number(stat.size)); let offset = 0;
    while (offset < buffer.length) { control.guard(); const count = readSync(fd, buffer, offset, Math.min(MiB, buffer.length - offset), offset); if (count <= 0) break; offset += count; }
    control.guard();
    const after = fstatSync(fd, { bigint: true }); const final = lstatSync(specification.path, { bigint: true });
    if (offset !== buffer.length || !isDeepStrictEqual(stableSnapshot(stat), stableSnapshot(after))
      || !isDeepStrictEqual(stableSnapshot(stat), stableSnapshot(final)) || realpathSync(specification.path) !== specification.path) {
      fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE");
    }
    return freeze({ buffer, identity: { bytes: buffer.length, sha256: hash(buffer) }, physical: stableSnapshot(stat) });
  } finally { closeSync(fd); }
}
function defaultRunner(request) {
  return new Promise((resolve, reject) => {
    const outputFile = request.stdoutMode === "FILE";
    let fd; let outputInitial; let stdoutBytes = 0; let stderrBytes = 0; let stdinBytes = 0; let stdinEnded = false;
    const stdout = []; const stderr = []; const outputHash = createHash("sha256"); let settled = false; let timedOut = false;
    try {
      if (outputFile) {
        fd = openSync(request.stdoutPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        outputInitial = fstatSync(fd, { bigint: true }); const named = lstatSync(request.stdoutPath, { bigint: true });
        if (!outputInitial.isFile() || outputInitial.isSymbolicLink() || outputInitial.uid !== 1000n || outputInitial.gid !== 1000n
          || outputInitial.nlink !== 1n || (outputInitial.mode & 0o7777n) !== 0o600n
          || outputInitial.dev !== named.dev || outputInitial.ino !== named.ino) throw new Error("output_identity");
      }
    }
    catch {
      if (fd !== undefined) { try { fsyncSync(fd); } catch { /* retained partial */ } try { closeSync(fd); } catch { /* retained partial */ } fd = undefined; }
      reject(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid")); return;
    }
    let child;
    try { child = spawn(request.binary, request.args, { cwd: request.cwd, env: request.env, shell: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch {
      if (fd !== undefined) { try { fsyncSync(fd); } catch { /* retained partial */ } try { closeSync(fd); } catch { /* retained partial */ } }
      reject(closed(undefined, request.phase, "gosu_derivative_image_observation_command_failed")); return;
    }
    let forceTimer; const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000); }, request.timeoutMs);
    const abort = (error) => { if (!settled) { settled = true; clearTimeout(timer); clearTimeout(forceTimer); try { child.kill("SIGKILL"); } catch { /* best effort */ }
      if (fd !== undefined) { try { fsyncSync(fd); } catch { /* retained partial */ } try { closeSync(fd); } catch { /* retained partial */ } fd = undefined; }
      reject(error); } };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > request.stdoutLimit) return abort(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid"));
      try {
        if (outputFile) {
          let offset = 0; while (offset < chunk.length) { const written = writeSync(fd, chunk, offset, chunk.length - offset); if (written <= 0) throw new Error("short_write"); offset += written; }
          outputHash.update(chunk);
          const held = fstatSync(fd, { bigint: true }); const named = lstatSync(request.stdoutPath, { bigint: true });
          if (held.dev !== outputInitial.dev || held.ino !== outputInitial.ino || named.dev !== held.dev || named.ino !== held.ino
            || held.nlink !== 1n || named.nlink !== 1n) throw new Error("output_identity");
        } else stdout[stdout.length] = Buffer.from(chunk);
      } catch { abort(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid")); }
    });
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length;
      if (stderrBytes > request.stderrLimit) return abort(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid")); stderr[stderr.length] = Buffer.from(chunk); });
    child.on("error", () => abort(closed(undefined, request.phase, "gosu_derivative_image_observation_command_failed")));
    child.on("close", (exitCode, signal) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(forceTimer);
      if (stdinBytes !== (request.stdin?.length ?? 0) || stdinEnded !== true) {
        if (fd !== undefined) { try { fsyncSync(fd); } catch { /* retained partial */ } try { closeSync(fd); } catch { /* retained partial */ } fd = undefined; }
        reject(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid")); return;
      }
      let outputPhysical = null; let outputIdentity = null;
      try {
        if (fd !== undefined) {
          const held = fstatSync(fd, { bigint: true }); const named = lstatSync(request.stdoutPath, { bigint: true });
          if (held.dev !== outputInitial.dev || held.ino !== outputInitial.ino || named.dev !== held.dev || named.ino !== held.ino
            || held.uid !== 1000n || held.gid !== 1000n || held.nlink !== 1n || named.nlink !== 1n
            || (held.mode & 0o7777n) !== 0o600n || held.size !== BigInt(stdoutBytes)) throw new Error("output_identity");
          fsyncSync(fd); outputPhysical = stableSnapshot(held); outputIdentity = { bytes: stdoutBytes, sha256: outputHash.digest("hex") };
          closeSync(fd); fd = undefined;
        }
      } catch {
        if (fd !== undefined) { try { fsyncSync(fd); } catch { /* retained partial */ } try { closeSync(fd); } catch { /* retained partial */ } fd = undefined; }
        return reject(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid"));
      }
      resolve({ exitCode, signal, timedOut, stdinBytes, stdinEnded,
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), stdoutBytes, outputPhysical, outputIdentity });
    });
    child.stdin.on("error", () => abort(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid")));
    if (typeof child.stdin.end !== "function" || request.stdin !== undefined && typeof child.stdin.write !== "function") {
      abort(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid")); return;
    }
    if (request.stdin === undefined) child.stdin.end(() => { stdinEnded = true; });
    else {
      let offset = 0;
      const writeNext = () => {
        if (settled) return;
        if (offset === request.stdin.length) { child.stdin.end(() => { stdinEnded = true; }); return; }
        const chunk = request.stdin.subarray(offset, Math.min(request.stdin.length, offset + MiB));
        child.stdin.write(chunk, (error) => {
          if (error) { abort(closed(undefined, request.phase, "gosu_derivative_image_observation_stream_invalid")); return; }
          stdinBytes += chunk.length; offset += chunk.length; writeNext();
        });
      };
      writeNext();
    }
  });
}
function authenticateContext(buffer, control) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== CONTEXT_BYTES || hash(buffer) !== CONTEXT_SHA256) {
    fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
  }
  control.guard();
  return scanRawUstar({ input: readable(buffer, control.guard), diffId: `sha256:${CONTEXT_SHA256}`, maxRawBytes: CONTEXT_BYTES, maxMembers: 15,
    allowHardlinks: false, signal: control.signal }).then((scan) => {
    control.guard();
    if (scan.members.length !== 15) fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
    const lock = readFileSync(LOCK_PATH);
    const handle = openCandidateLockV2(lock); candidateContractV2(handle);
    const entries = scan.members.map((member) => member.entry.type === "directory"
      ? { path: member.entry.path, type: member.entry.type, mode: member.entry.mode, uid: member.entry.uid, gid: member.entry.gid, mtime: member.entry.mtime }
      : { path: member.entry.path, type: member.entry.type, mode: member.entry.mode, uid: member.entry.uid, gid: member.entry.gid, mtime: member.entry.mtime,
        body: memberBody(buffer, member) });
    validateCandidateContextV2(handle, { entries });
    return freeze({ bytes: buffer.length, sha256: hash(buffer), entries: scan.members.map(descriptor) });
  }).catch((error) => { if (CODES.has(error?.message)) throw error; fail("gosu_derivative_image_observation_context_invalid", "CONTEXT"); });
}
function parseCommandJson(result, phase) {
  if (!plain(result) || result.exitCode !== 0 || result.timedOut !== false || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)
    || result.stdout.length > OUTPUT_LIMIT || result.stderr.length > STDERR_LIMIT) fail("gosu_derivative_image_observation_command_failed", phase);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout)); }
  catch { fail("gosu_derivative_image_observation_command_failed", phase); }
}
function commandLines(result, pattern, phase) {
  if (!plain(result) || result.exitCode !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length > OUTPUT_LIMIT) {
    fail("gosu_derivative_image_observation_command_failed", phase);
  }
  const values = result.stdout.toString("utf8").trim().split(/\r?\n/u).filter(Boolean).sort();
  if (values.length > 64 || new Set(values).size !== values.length || values.some((value) => !pattern.test(value))) {
    fail("gosu_derivative_image_observation_identity_invalid", phase);
  }
  return values;
}

export async function runGosuDerivativeImageBuildObservationV2(input, dependencies = {}) {
  let phase = "PREFLIGHT"; let buildStarted = false; let contextSession; let deadlineTimer;
  try {
    if (!exact(input, ["purpose", "nonce", "lease"]) || input.purpose !== PURPOSE || !HEX24.test(input.nonce)) {
      fail("gosu_derivative_image_observation_input_invalid", phase);
    }
    const nonce = input.nonce; validateDependencies(dependencies); const lease = validateLease(input.lease, nonce);
    const injected = Object.keys(dependencies).length !== 0; const runnerInjected = dependencies.runner !== undefined;
    const fullyInjected = runnerInjected && dependencies.contextReader !== undefined && dependencies.archiveReader !== undefined;
    if (!fullyInjected) runtimeGuard();
    const acceptedPreflight = acceptedContextPreflight(!fullyInjected);
    if (!fullyInjected) {
      for (const target of [lease.root, lease.outputDirectory]) {
        const fs = statfsSync(target, { bigint: true });
        if (fs.bavail * fs.bsize < 8n * BigInt(GiB)) fail("gosu_derivative_image_observation_runtime_invalid", phase);
      }
    }
    const now = dependencies.now ?? Date.now; const startedAt = now();
    if (!Number.isFinite(startedAt) || lease.deadlineAtMs <= startedAt || lease.deadlineAtMs - startedAt > 600_000
      || lease.deadlineAtMs - 25_000 <= startedAt) fail("gosu_derivative_image_observation_deadline_exceeded", phase);
    const deadline = lease.deadlineAtMs - 25_000;
    const runner = dependencies.runner ?? defaultRunner; const contextReader = dependencies.contextReader ?? defaultContextReader;
    const archiveReader = dependencies.archiveReader ?? defaultArchiveReader;
    const abortController = new globalThis.AbortController();
    deadlineTimer = setTimeout(() => abortController.abort(), Math.max(1, deadline - startedAt));
    const remaining = () => { const value = deadline - now(); if (abortController.signal.aborted || !Number.isFinite(value) || value <= 0) fail("gosu_derivative_image_observation_deadline_exceeded", phase); return value; };
    let expandedRemaining = 2 * GiB;
    const control = Object.freeze({ guard: () => { remaining(); }, signal: abortController.signal,
      maximumExpanded: () => { remaining(); if (expandedRemaining <= 0) fail("gosu_derivative_image_observation_archive_invalid", phase); return Math.min(GiB, expandedRemaining); },
      consumeExpanded: (bytes) => { remaining(); if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > expandedRemaining) fail("gosu_derivative_image_observation_archive_invalid", phase); expandedRemaining -= bytes; } });
    const env = freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: lease.dockerConfig,
      DOCKER_CONFIG: lease.dockerConfig, BUILDX_CONFIG: lease.buildxConfig });
    const prefix = ["--config", lease.dockerConfig, "--context", lease.contextName];
    const command = async (commandPhase, args, timeoutMs, options = {}) => {
      phase = commandPhase; const routedPrefix = options.createContext ? ["--config", lease.dockerConfig] : prefix;
      const request = freeze({ phase, binary: DOCKER, args: [...routedPrefix, ...args], cwd: lease.outputDirectory, env,
        timeoutMs: Math.min(timeoutMs, remaining()), stdin: options.stdin, stdoutMode: options.stdoutPath ? "FILE" : "BUFFER",
        stdoutPath: options.stdoutPath, stdoutLimit: options.stdoutPath ? ARCHIVE_LIMIT : OUTPUT_LIMIT, stderrLimit: STDERR_LIMIT });
      const result = await runner(request); remaining();
      if (!plain(result) || result.exitCode !== 0 || result.timedOut !== false || result.stdinBytes !== (options.stdin?.length ?? 0)
        || result.stdinEnded !== true || !Buffer.isBuffer(result.stderr) || result.stderr.length > STDERR_LIMIT
        || !Buffer.isBuffer(result.stdout) || !Number.isSafeInteger(result.stdoutBytes ?? result.stdout.length)
        || options.stdoutPath && (!plain(result.outputPhysical) || !exact(result.outputIdentity, ["bytes", "sha256"])
          || result.outputIdentity.bytes !== result.stdoutBytes || !/^[0-9a-f]{64}$/u.test(result.outputIdentity.sha256)
          || result.outputPhysical.size !== result.outputIdentity.bytes)) {
        fail("gosu_derivative_image_observation_command_failed", phase);
      }
      return result;
    };
    const inventory = async (expectedImages, inventoryPhase) => {
      const images = commandLines(await command(inventoryPhase, ["image", "ls", "--all", "--quiet", "--no-trunc"], 15_000), DIGEST, inventoryPhase);
      const containers = commandLines(await command(inventoryPhase, ["container", "ls", "--all", "--quiet", "--no-trunc"], 15_000), /^[0-9a-f]{64}$/u, inventoryPhase);
      const volumes = commandLines(await command(inventoryPhase, ["volume", "ls", "--quiet"], 15_000), /^[A-Za-z0-9_.-]{1,255}$/u, inventoryPhase);
      if (!isDeepStrictEqual(images, [...expectedImages].sort()) || containers.length !== 0 || volumes.length !== 0) {
        fail("gosu_derivative_image_observation_identity_invalid", inventoryPhase);
      }
      return freeze({ images, containers: 0, volumes: 0 });
    };
    phase = "ROUTING";
    await command(phase, ["context", "create", lease.contextName, "--docker", `host=${lease.endpoint}`], 15_000, { createContext: true });
    const context = parseCommandJson(await command(phase, ["context", "inspect", lease.contextName], 15_000), phase);
    const contextItem = Array.isArray(context) ? context[0] : context;
    if (!plain(contextItem) || contextItem.Name !== lease.contextName || contextItem.Endpoints?.docker?.Host !== lease.endpoint) {
      fail("gosu_derivative_image_observation_routing_invalid", phase);
    }
    const version = parseCommandJson(await command(phase, ["version", "--format", "{{json .}}"], 15_000), phase);
    const info = parseCommandJson(await command(phase, ["info", "--format", "{{json .}}"], 15_000), phase);
    if (version.Server?.Version !== "28.0.4" || info.ID !== lease.daemonId || info.DockerRootDir !== lease.dataRoot
      || info.OSType !== "linux" || info.Architecture !== "x86_64" || info.Driver !== "overlay2"
      || info.Containerd?.Address !== lease.containerdAddress
      || info.Containerd?.Namespaces?.Containers !== lease.containersNamespace
      || info.Containerd?.Namespaces?.Plugins !== lease.pluginsNamespace) fail("gosu_derivative_image_observation_routing_invalid", phase);
    const builderResult = await command(phase, ["buildx", "inspect", "default"], 15_000);
    const builder = parseBuilder(builderResult.stdout, lease);
    await inventory([], phase);
    phase = "CONTEXT";
    const contextRecord = readerRecord(await contextReader(freeze({ path: CONTEXT_PATH, bytes: CONTEXT_BYTES, sha256: CONTEXT_SHA256 }), control),
      { maximumBytes: CONTEXT_BYTES, bytes: CONTEXT_BYTES, sha256: CONTEXT_SHA256 }, phase);
    contextSession = contextSessions.get(contextRecord); contextSession?.guard();
    const contextBuffer = contextRecord.buffer; const contextObservation = await authenticateContext(contextBuffer, control); contextSession?.guard();
    phase = "BASE"; await command(phase, ["image", "pull", "--platform", "linux/amd64", BASE_REFERENCE], 180_000);
    const baseInspect = parseCommandJson(await command(phase, ["image", "inspect", "--format", "{{json .}}", BASE_REFERENCE], 15_000), phase);
    if (baseInspect.Id !== BASE_CONFIG_ID || baseInspect.Os !== "linux" || baseInspect.Architecture !== "amd64") {
      fail("gosu_derivative_image_observation_identity_invalid", phase);
    }
    await inventory([BASE_CONFIG_ID], phase);
    const baseSubject = freeze({ role: "BASE", reference: BASE_REFERENCE, imageId: baseInspect.Id, configId: baseInspect.Id,
      platform: { os: "linux", architecture: "amd64" } });
    const basePartial = path.join(lease.outputDirectory, "base-image.tar.partial"); const baseFinal = path.join(lease.outputDirectory, "base-image.tar");
    const baseSave = await command("SAVE_BASE", ["image", "save", "--platform", "linux/amd64", BASE_REFERENCE], 90_000, { stdoutPath: basePartial });
    if (!runnerInjected) promoteNoReplace(basePartial, baseFinal, baseSave.outputPhysical);
    phase = "BUILD"; buildStarted = true; const candidateReference = `aw-postgres-gosu:${nonce}`;
    await command(phase, ["buildx", "build", "--builder", "default", "--platform", "linux/amd64", "--network", "none", "--pull=false",
      "--provenance=false", "--sbom=false", "--progress", "plain", "--tag", candidateReference, "--file", "Dockerfile", "-"], 180_000,
    { stdin: contextBuffer });
    contextSession?.guard();
    if (contextBuffer.length !== CONTEXT_BYTES || hash(contextBuffer) !== CONTEXT_SHA256) fail("gosu_derivative_image_observation_context_invalid", phase);
    const candidateInspect = parseCommandJson(await command("BUILD", ["image", "inspect", "--format", "{{json .}}", candidateReference], 15_000), "BUILD");
    if (!DIGEST.test(candidateInspect.Id) || candidateInspect.Os !== "linux" || candidateInspect.Architecture !== "amd64") {
      fail("gosu_derivative_image_observation_identity_invalid", "BUILD");
    }
    const candidateSubject = freeze({ role: "CANDIDATE", reference: candidateReference, imageId: candidateInspect.Id, configId: candidateInspect.Id,
      platform: { os: "linux", architecture: "amd64" } });
    await inventory([BASE_CONFIG_ID, candidateInspect.Id], "BUILD");
    const baseAfter = parseCommandJson(await command("BUILD", ["image", "inspect", "--format", "{{json .}}", BASE_REFERENCE], 15_000), "BUILD");
    if (baseAfter.Id !== BASE_CONFIG_ID || baseAfter.Os !== "linux" || baseAfter.Architecture !== "amd64") {
      fail("gosu_derivative_image_observation_identity_invalid", "BUILD");
    }
    const candidatePartial = path.join(lease.outputDirectory, "candidate-image.tar.partial"); const candidateFinal = path.join(lease.outputDirectory, "candidate-image.tar");
    const candidateSave = await command("SAVE_CANDIDATE", ["image", "save", "--platform", "linux/amd64", candidateReference], 90_000, { stdoutPath: candidatePartial });
    if (!runnerInjected) promoteNoReplace(candidatePartial, candidateFinal, candidateSave.outputPhysical);
    phase = "OBSERVE";
    const baseRecord = readerRecord(await archiveReader(freeze({ path: runnerInjected ? basePartial : baseFinal,
      role: "BASE", maximumBytes: ARCHIVE_LIMIT }), control), { maximumBytes: ARCHIVE_LIMIT }, phase);
    const candidateRecord = readerRecord(await archiveReader(freeze({ path: runnerInjected ? candidatePartial : candidateFinal,
      role: "CANDIDATE", maximumBytes: ARCHIVE_LIMIT }), control), { maximumBytes: ARCHIVE_LIMIT }, phase);
    if (!isDeepStrictEqual(baseRecord.identity, baseSave.outputIdentity)
      || !isDeepStrictEqual(candidateRecord.identity, candidateSave.outputIdentity)) fail("gosu_derivative_image_observation_archive_invalid", phase);
    const baseArchive = baseRecord.buffer; const candidateArchive = candidateRecord.buffer;
    if (!Buffer.isBuffer(baseArchive) || !Buffer.isBuffer(candidateArchive) || baseArchive.length + candidateArchive.length > 2 * GiB) {
      fail("gosu_derivative_image_observation_archive_invalid", phase);
    }
    const base = await inspectSave(baseArchive, baseSubject, control);
    const candidate = await inspectSave(candidateArchive, candidateSubject, control);
    phase = "FINAL";
    const operational = { state: "IMAGE_BUILD_FORMAT_OBSERVED_REVIEW_PENDING", authority: "NOT_AUTHORIZED", image: "BUILT_UNVALIDATED",
      candidateAdmission: "NOT_AUTHORIZED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED" };
    const simulated = { state: "FORMAT_ONLY_SIMULATION", scope: "FORMAT_ONLY", image: "NOT_ESTABLISHED",
      candidateAdmission: "NOT_ESTABLISHED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED" };
    const result = freeze({ ...(injected ? simulated : operational),
      nonce, lease: { daemonId: lease.daemonId, pid: lease.pid, startTicks: lease.startTicks }, builder,
      preflight: acceptedPreflight, context: { ...contextObservation, physical: contextRecord.physical }, base, candidate, dates: null });
    contextSession?.close(); clearTimeout(deadlineTimer); return result;
  } catch (error) {
    clearTimeout(deadlineTimer);
    try { contextSession?.close(); } catch { /* Retain the primary closed diagnostic. */ }
    if (buildStarted) { const retained = closed(error, phase); retained.state = "MAY_HAVE_BEEN_BUILT"; throw retained; }
    throw closed(error, phase);
  }
}
