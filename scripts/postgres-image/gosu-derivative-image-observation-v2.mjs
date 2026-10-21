import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, readdirSync, readSync, realpathSync,
  statfsSync, unlinkSync, writeSync,
} from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";
import { createGunzip } from "node:zlib";

import { candidateContractV2, openCandidateLockV2, validateCandidateContextV2 } from "./gosu-derivative-candidate-v2.mjs";
import { openGosuDerivativeDockerSaveV1, proveGosuDerivativeImagePairV1 } from "./gosu-derivative-image-proof-v1.mjs";
import { scanRawUstar } from "../seaweed-image/archive.mjs";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const DOCKER = "/usr/bin/docker";
const PURPOSE = "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION";
const PROOF_PURPOSE = "GOSU_DERIVATIVE_IMAGE_BUILD_PROOF_V1";
const RETAINED_PROOF_PURPOSE = "GOSU_DERIVATIVE_IMAGE_RETAINED_BUILD_PROOF_V1";
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
const ARCHIVE_ROLES = new Set(["BASE", "CANDIDATE", "UNKNOWN"]);
const ARCHIVE_STAGES = new Set(["READ", "BIND", "OUTER_TAR", "MANIFEST", "CONFIG", "LAYER"]);
const ARCHIVE_LOCAL_REASONS = new Set([
  "READ_INVALID", "SIZE_INVALID", "IDENTITY_MISMATCH", "MEMBER_INVALID", "JSON_INVALID", "SCHEMA_INVALID",
  "EXPANSION_LIMIT", "UNKNOWN",
]);
const SEAWEED_ARCHIVE_REASONS = new Set([
  "seaweed_archive_aborted", "seaweed_archive_compressed_identity_invalid", "seaweed_archive_compressed_limit",
  "seaweed_archive_descriptor_invalid", "seaweed_archive_diffid_invalid", "seaweed_archive_diffid_mismatch",
  "seaweed_archive_gzip_trailing_data", "seaweed_archive_hardlink_option_invalid",
  "seaweed_archive_input_chunk_invalid", "seaweed_archive_input_invalid", "seaweed_archive_limit_invalid",
  "seaweed_archive_raw_limit", "seaweed_archive_signal_invalid", "seaweed_archive_stream_invalid",
  "seaweed_archive_tar_checksum_invalid", "seaweed_archive_tar_duplicate_invalid", "seaweed_archive_tar_eoa_invalid",
  "seaweed_archive_tar_format_invalid", "seaweed_archive_tar_header_invalid", "seaweed_archive_tar_link_invalid",
  "seaweed_archive_tar_member_limit", "seaweed_archive_tar_octal_invalid", "seaweed_archive_tar_padding_invalid",
  "seaweed_archive_tar_path_invalid", "seaweed_archive_tar_truncated", "seaweed_archive_tar_type_invalid",
]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ACCEPTANCE_PATH = path.join(repoRoot, ".omx", "gosu-derivative-context-private-acceptance-v1.json");
const LOCK_PATH = path.join(repoRoot, "infra", "postgres-image", "gosu-derivative-candidate-lock-v2.json");
const contextSessions = new WeakMap();
const retentionArchiveSessions = new WeakMap();
const archiveFailureDetails = new WeakMap();
const retentionStabilityFailures = new WeakSet();
const retentionCloseUncertainFailures = new WeakSet();

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, fields) => plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort())
  && Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => Object.hasOwn(descriptor, "value"));
const MANIFEST_REQUIRED_FIELDS = Object.freeze(["Config", "RepoTags", "Layers"]);
const MANIFEST_OPTIONAL_FIELDS = Object.freeze(["Parent", "LayerSources"]);
const manifestEntry = (value) => {
  if (!plain(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value); const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || ![...MANIFEST_REQUIRED_FIELDS, ...MANIFEST_OPTIONAL_FIELDS].includes(key))
    || MANIFEST_REQUIRED_FIELDS.some((key) => !Object.hasOwn(descriptors, key))
    || keys.some((key) => !Object.hasOwn(descriptors[key], "value"))) return false;
  if (Object.hasOwn(descriptors, "Parent") && typeof descriptors.Parent.value !== "string") return false;
  return !Object.hasOwn(descriptors, "LayerSources") || plain(descriptors.LayerSources.value);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const freeze = (value) => Array.isArray(value) ? Object.freeze(value.map(freeze)) : plain(value)
  ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)]))) : value;
function archiveDetail(role, stage, reason) {
  const packet = { version: 1, role: ARCHIVE_ROLES.has(role) ? role : "UNKNOWN",
    stage: ARCHIVE_STAGES.has(stage) ? stage : "READ",
    reason: ARCHIVE_LOCAL_REASONS.has(reason) || SEAWEED_ARCHIVE_REASONS.has(reason) ? reason : "UNKNOWN" };
  return Object.freeze(packet);
}
function brandArchiveFailure(error, detail) { archiveFailureDetails.set(error, detail); return error; }
function fail(code, phase, detail) {
  const error = Object.assign(new Error(code), { phase });
  throw detail === undefined ? error : brandArchiveFailure(error, detail);
}
function archiveFail(role, stage, reason, code = "gosu_derivative_image_observation_archive_invalid") {
  fail(code, "OBSERVE", archiveDetail(role, stage, reason));
}
function ownDataMessage(error) {
  if ((typeof error !== "object" && typeof error !== "function") || error === null || types.isProxy(error)
    || !types.isNativeError(error)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    return descriptor && Object.hasOwn(descriptor, "value") && typeof descriptor.value === "string" ? descriptor.value : null;
  } catch { return null; }
}
function legacyCodeProjection(error) {
  try {
    const message = error?.message;
    return CODES.has(message) ? message : null;
  } catch { return null; }
}
function archiveRole(value) {
  if (!plain(value)) return "UNKNOWN";
  const descriptor = Object.getOwnPropertyDescriptor(value, "role");
  return descriptor && Object.hasOwn(descriptor, "value") && ["BASE", "CANDIDATE"].includes(descriptor.value)
    ? descriptor.value : "UNKNOWN";
}
function scannerFailure(error, role, stage, fallback = "UNKNOWN") {
  if (legacyCodeProjection(error) !== null) throw error;
  const message = ownDataMessage(error);
  archiveFail(role, stage, message !== null && SEAWEED_ARCHIVE_REASONS.has(message) ? message : fallback);
}
function expansion(role, operation) {
  try { return operation(); }
  catch (error) {
    const code = legacyCodeProjection(error);
    if (code !== null) {
      if (code === "gosu_derivative_image_observation_archive_invalid" && ownDataMessage(error) === code) {
        throw brandArchiveFailure(error, archiveDetail(role, "LAYER", "EXPANSION_LIMIT"));
      }
      throw error;
    }
    archiveFail(role, "LAYER", "EXPANSION_LIMIT");
  }
}
function closed(error, phase, fallback = "gosu_derivative_image_observation_input_invalid") {
  let code = fallback;
  try { if (CODES.has(error?.message)) code = error.message; } catch { /* Closed error projection. */ }
  let state = "UNBUILT";
  try { if (error?.state === "MAY_HAVE_BEEN_BUILT") state = "MAY_HAVE_BEEN_BUILT"; } catch { /* Closed state projection. */ }
  const retained = Object.assign(new Error(code), { phase: PHASES.includes(phase) ? phase : "PREFLIGHT", state });
  const detail = (typeof error === "object" || typeof error === "function") && error !== null
    ? archiveFailureDetails.get(error) : undefined;
  return detail === undefined ? retained : brandArchiveFailure(retained, detail);
}
export function gosuDerivativeImageObservationArchiveFailureDetailV1(error) {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) return null;
  return archiveFailureDetails.get(error) ?? null;
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
async function scanGzipLayerWithControl(body, diffId, maxRawBytes, control, role = "UNKNOWN") {
  if (body.length === 0 || body.length > GZIP_COMPRESSED_LIMIT) {
    archiveFail(role, "LAYER", "SIZE_INVALID");
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
    const result = await scanRawUstar({ input: guardedOutput, diffId, maxRawBytes, maxMembers: 100_000,
      allowHardlinks: true, signal: control.signal });
    control.guard();
    if (compressedBytes !== body.length || compressedHash.digest("hex") !== compressedSha256 || gunzip.bytesWritten !== body.length) {
      archiveFail(role, "LAYER", "IDENTITY_MISMATCH");
    }
    return result;
  } catch (error) {
    if (control.signal?.aborted) control.guard();
    scannerFailure(error, role, "LAYER");
  } finally {
    control.signal?.removeEventListener("abort", abort);
    input.destroy(); gunzip.destroy(); guardedOutput.destroy();
  }
}
function parseJson(buffer, code, maximum = JSON_LIMIT, phase = "OBSERVE", detail) {
  if (!Buffer.isBuffer(buffer) || buffer.length > maximum) fail(code, phase, detail);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); } catch { fail(code, phase, detail); }
}
function validateSubject(value, role = archiveRole(value)) {
  if (!exact(value, ["role", "reference", "imageId", "configId", "platform"])
    || !["BASE", "CANDIDATE"].includes(value.role) || !DIGEST.test(value.imageId) || !DIGEST.test(value.configId)
    || !exact(value.platform, ["os", "architecture"]) || value.platform.os !== "linux" || value.platform.architecture !== "amd64"
    || value.role === "BASE" && (value.reference !== BASE_REFERENCE || value.imageId !== BASE_CONFIG_ID || value.configId !== BASE_CONFIG_ID)
    || value.role === "CANDIDATE" && !/^aw-postgres-gosu:[0-9a-f]{24}$/u.test(value.reference)) {
    archiveFail(role, "BIND", "IDENTITY_MISMATCH", "gosu_derivative_image_observation_identity_invalid");
  }
  return freeze({ ...value, platform: { ...value.platform } });
}
function memberBody(buffer, member, role = "UNKNOWN", stage = "OUTER_TAR") {
  const { uncompressedDataOffset: offset, entry } = member;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(entry.size) || offset + entry.size > buffer.length) {
    archiveFail(role, stage, "MEMBER_INVALID");
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
  const role = archiveRole(subject);
  if (types.isProxy(buffer) || !Buffer.isBuffer(buffer)) archiveFail(role, "READ", "READ_INVALID");
  if (buffer.length === 0 || buffer.length > ARCHIVE_LIMIT) archiveFail(role, "READ", "SIZE_INVALID");
  const accepted = validateSubject(subject, role);
  let scan;
  try {
    control.guard();
    scan = await scanRawUstar({ input: readable(buffer, control.guard), diffId: `sha256:${hash(buffer)}`, maxRawBytes: ARCHIVE_LIMIT,
      maxMembers: 4096, allowHardlinks: false, signal: control.signal });
    control.guard();
  } catch (error) { scannerFailure(error, accepted.role, "OUTER_TAR"); }
  const byPath = new Map(scan.members.map((member) => [member.entry.path, member]));
  const manifestMember = byPath.get("manifest.json");
  if (!manifestMember || manifestMember.entry.type !== "file") archiveFail(accepted.role, "MANIFEST", "MEMBER_INVALID");
  if (manifestMember.entry.size > JSON_LIMIT) archiveFail(accepted.role, "MANIFEST", "SIZE_INVALID");
  const manifest = parseJson(memberBody(buffer, manifestMember, accepted.role, "MANIFEST"),
    "gosu_derivative_image_observation_archive_invalid", JSON_LIMIT, "OBSERVE",
    archiveDetail(accepted.role, "MANIFEST", "JSON_INVALID"));
  if (!Array.isArray(manifest) || manifest.length !== 1 || !manifestEntry(manifest[0])
    || typeof manifest[0].Config !== "string"
    || accepted.role === "CANDIDATE" && (!Array.isArray(manifest[0].RepoTags) || !manifest[0].RepoTags.includes(accepted.reference))
    || accepted.role === "BASE" && manifest[0].RepoTags !== null && !Array.isArray(manifest[0].RepoTags)
    || !Array.isArray(manifest[0].Layers) || manifest[0].Layers.length === 0
    || new Set(manifest[0].Layers).size !== manifest[0].Layers.length) {
    archiveFail(accepted.role, "MANIFEST", "SCHEMA_INVALID");
  }
  const configMember = byPath.get(manifest[0].Config);
  if (!configMember || configMember.entry.type !== "file") archiveFail(accepted.role, "CONFIG", "MEMBER_INVALID");
  if (configMember.entry.size > JSON_LIMIT) archiveFail(accepted.role, "CONFIG", "SIZE_INVALID");
  const configBytes = memberBody(buffer, configMember, accepted.role, "CONFIG");
  if (`sha256:${hash(configBytes)}` !== accepted.configId || accepted.imageId !== accepted.configId) {
    archiveFail(accepted.role, "CONFIG", "IDENTITY_MISMATCH", "gosu_derivative_image_observation_identity_invalid");
  }
  const config = parseJson(configBytes, "gosu_derivative_image_observation_archive_invalid", JSON_LIMIT, "OBSERVE",
    archiveDetail(accepted.role, "CONFIG", "JSON_INVALID"));
  if (!plain(config) || config.os !== "linux" || config.architecture !== "amd64" || !plain(config.rootfs)
    || config.rootfs.type !== "layers" || !Array.isArray(config.rootfs.diff_ids)
    || config.rootfs.diff_ids.length !== manifest[0].Layers.length || config.rootfs.diff_ids.some((item) => !DIGEST.test(item))) {
    archiveFail(accepted.role, "CONFIG", "SCHEMA_INVALID", "gosu_derivative_image_observation_identity_invalid");
  }
  const layers = [];
  for (const [index, layerPath] of manifest[0].Layers.entries()) {
    if (typeof layerPath !== "string") archiveFail(accepted.role, "LAYER", "SCHEMA_INVALID");
    const member = byPath.get(layerPath);
    if (!member || member.entry.type !== "file") archiveFail(accepted.role, "LAYER", "MEMBER_INVALID");
    const body = memberBody(buffer, member, accepted.role, "LAYER"); const storedSha256 = hash(body); let encoding = "OPAQUE"; let tar = null;
    try {
      if (body[0] === 0x1f && body[1] === 0x8b) {
        encoding = "GZIP";
        const maximum = expansion(accepted.role, () => control.maximumExpanded());
        tar = await scanGzipLayerWithControl(body, config.rootfs.diff_ids[index], maximum, control, accepted.role);
      } else if (body.length >= 265 && body.subarray(257, 263).equals(Buffer.from("ustar\0"))) {
        encoding = "USTAR";
        const maximum = expansion(accepted.role, () => control.maximumExpanded());
        tar = await scanRawUstar({ input: readable(body, control.guard), diffId: config.rootfs.diff_ids[index], maxRawBytes: maximum,
          maxMembers: 100_000, allowHardlinks: true, signal: control.signal });
      }
    } catch (error) { scannerFailure(error, accepted.role, "LAYER"); }
    if (tar !== null) expansion(accepted.role, () => control.consumeExpanded(tar.rawSize ?? tar.uncompressedSize));
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
function descriptorOwner(fd) {
  let attempted = false;
  return Object.freeze({ close: () => {
    if (attempted) return;
    attempted = true;
    closeSync(fd);
  } });
}
function closeRetentionOwners(owners, guard = () => undefined) {
  let error; let closeUncertain = false;
  for (const owner of owners) {
    if (owner === undefined) continue;
    try { guard(); } catch (guardError) { error ??= guardError; }
    try { owner.close(); }
    catch (closeError) { error ??= closeError; closeUncertain = true; }
    try { guard(); } catch (guardError) { error ??= guardError; }
  }
  if (closeUncertain && (typeof error === "object" || typeof error === "function") && error !== null) {
    retentionCloseUncertainFailures.add(error);
  }
  return Object.freeze({ error, closeUncertain });
}
function retentionStability(operation) {
  try { return operation(); }
  catch (error) {
    if ((typeof error === "object" || typeof error === "function") && error !== null) retentionStabilityFailures.add(error);
    throw error;
  }
}
function retentionFailureDetail(sealedRoles, closeUncertain, stabilityFailed) {
  const state = stabilityFailed || closeUncertain ? "PAIR_STABILITY_FAILED"
    : sealedRoles.length === 1 ? "PARTIAL_PAIR_SNAPSHOT" : "SNAPSHOT_NOT_COMMITTED";
  return freeze({ state, sealedRoles: [...sealedRoles], closeUncertain });
}
function retentionSnapshotRecord(buildWindow, pairProof, directory, basePhysical, candidatePhysical) {
  return freeze({ state: "SEALED_SNAPSHOT_REVIEW_PENDING", preservation: "FUTURE_CONTROLLER_REQUIRED",
    authority: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED", directory, buildWindow,
    base: { name: "base-image.tar", archive: pairProof.base.archive, configId: pairProof.base.configId, physical: basePhysical },
    candidate: { name: "candidate-image.tar", archive: pairProof.candidate.archive, configId: pairProof.candidate.configId,
      physical: candidatePhysical } });
}
function openRetentionDirectorySession(directory) {
  let fd;
  try { fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { return retentionStability(() => fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE")); }
  const owner = descriptorOwner(fd);
  let initial; let current;
  const inspect = (expectedNames, allowTransition) => retentionStability(() => {
    const held = fstatSync(fd, { bigint: true }); const named = lstatSync(directory, { bigint: true });
    const heldSnapshot = stableSnapshot(held); const namedSnapshot = stableSnapshot(named);
    const entries = readdirSync(directory).sort(); const expected = expectedNames.map((entry) => typeof entry === "string" ? { name: entry } : entry);
    const names = expected.map((entry) => entry.name).sort();
    if (!held.isDirectory() || held.isSymbolicLink() || held.uid !== 1000n || held.gid !== 1000n || held.nlink !== 2n
      || (held.mode & 0o7777n) !== 0o700n || !isDeepStrictEqual(heldSnapshot, namedSnapshot)
      || realpathSync(directory) !== directory || !isDeepStrictEqual(entries, names)
      || expected.some((entry) => !["base-image.tar.partial", "base-image.tar", "candidate-image.tar.partial", "candidate-image.tar"].includes(entry.name))) {
      fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE");
    }
    for (const entry of expected) {
      if (entry.physical === undefined) continue;
      const physical = lstatSync(path.join(directory, entry.name), { bigint: true });
      if (!physical.isFile() || physical.isSymbolicLink() || !isDeepStrictEqual(stableSnapshot(physical), entry.physical)) {
        fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE");
      }
    }
    if (initial === undefined) {
      initial = heldSnapshot; current = heldSnapshot;
    } else {
      const invariant = (snapshot) => ({ dev: snapshot.dev, ino: snapshot.ino, mode: snapshot.mode, nlink: snapshot.nlink,
        uid: snapshot.uid, gid: snapshot.gid, birthtimeNs: snapshot.birthtimeNs });
      if (!isDeepStrictEqual(invariant(heldSnapshot), invariant(initial))
        || !allowTransition && !isDeepStrictEqual(heldSnapshot, current)) {
        fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE");
      }
      if (allowTransition) current = heldSnapshot;
    }
    return heldSnapshot;
  });
  const inspectNamed = (expectedNames) => retentionStability(() => {
    const named = lstatSync(directory, { bigint: true }); const namedSnapshot = stableSnapshot(named);
    const entries = readdirSync(directory).sort(); const expected = expectedNames.map((entry) => typeof entry === "string" ? { name: entry } : entry);
    const names = expected.map((entry) => entry.name).sort();
    if (!named.isDirectory() || named.isSymbolicLink() || !isDeepStrictEqual(namedSnapshot, current)
      || realpathSync(directory) !== directory || !isDeepStrictEqual(entries, names)) {
      fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE");
    }
    for (const entry of expected) {
      if (entry.physical === undefined) continue;
      const physical = lstatSync(path.join(directory, entry.name), { bigint: true });
      if (!physical.isFile() || physical.isSymbolicLink() || !isDeepStrictEqual(stableSnapshot(physical), entry.physical)) {
        fail("gosu_derivative_image_observation_stream_invalid", "OBSERVE");
      }
    }
    return namedSnapshot;
  });
  try {
    inspect([], false);
    return Object.freeze({
      guard: (expectedNames) => inspect(expectedNames, false),
      guardNamed: inspectNamed,
      transition: (expectedNames) => inspect(expectedNames, true),
      snapshot: () => current,
      seal: (control) => { inspect(["base-image.tar", "candidate-image.tar"], false);
        control.guard(); fsyncSync(fd); control.guard(); return inspect(["base-image.tar", "candidate-image.tar"], false); },
      close: owner.close,
    });
  } catch (error) {
    const outcome = closeRetentionOwners([owner]);
    if (outcome.closeUncertain && (typeof error === "object" || typeof error === "function") && error !== null) {
      retentionCloseUncertainFailures.add(error);
    }
    throw error;
  }
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
function guardNamedContextAncestors(sessions) {
  for (const session of sessions) {
    const named = stableSnapshot(lstatSync(session.directory, { bigint: true }));
    if (!isDeepStrictEqual(named, session.snapshot) || realpathSync(session.directory) !== session.directory) {
      fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
    }
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
    const closeOnceOwners = [descriptorOwner(fd), ...ancestors.map((session) => descriptorOwner(session.fd))];
    contextSessions.set(record, Object.freeze({
      guard: () => {
        guardContextAncestors(ancestors);
        const held = stableSnapshot(fstatSync(fd, { bigint: true })); const current = stableSnapshot(lstatSync(CONTEXT_PATH, { bigint: true }));
        if (!isDeepStrictEqual(held, initial) || !isDeepStrictEqual(current, initial)) fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
      },
      guardNamed: () => retentionStability(() => {
        guardNamedContextAncestors(ancestors);
        const current = stableSnapshot(lstatSync(CONTEXT_PATH, { bigint: true }));
        if (!isDeepStrictEqual(current, initial) || realpathSync(CONTEXT_PATH) !== CONTEXT_PATH) {
          fail("gosu_derivative_image_observation_context_invalid", "CONTEXT");
        }
      }),
      closeAllOnce: (guard) => closeRetentionOwners(closeOnceOwners, guard),
      close: () => { closeSync(fd); for (const session of ancestors) closeSync(session.fd); },
    }));
    return record;
  } catch (error) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* best effort */ }
    for (const session of ancestors) try { closeSync(session.fd); } catch { /* best effort */ }
    throw error;
  }
}
function readerRecord(value, expected, phase, role = "UNKNOWN") {
  if (!exact(value, ["buffer", "identity", "physical"]) || !Buffer.isBuffer(value.buffer) || !plain(value.identity)
    || !plain(value.physical)) {
    if (phase === "CONTEXT") fail("gosu_derivative_image_observation_context_invalid", phase);
    archiveFail(role, "READ", "READ_INVALID");
  }
  if (!isDeepStrictEqual(value.identity, { bytes: value.buffer.length, sha256: hash(value.buffer) })
    || expected.bytes !== undefined && value.identity.bytes !== expected.bytes
    || expected.sha256 !== undefined && value.identity.sha256 !== expected.sha256) {
    if (phase === "CONTEXT") fail("gosu_derivative_image_observation_context_invalid", phase);
    archiveFail(role, "BIND", "IDENTITY_MISMATCH");
  }
  if (value.identity.bytes > expected.maximumBytes) {
    if (phase === "CONTEXT") fail("gosu_derivative_image_observation_context_invalid", phase);
    archiveFail(role, "READ", "SIZE_INVALID");
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
    if (section === "TOP" || nodeCount !== 1 || top.get("Name") !== lease.contextName || top.get("Driver") !== "docker") {
      fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
    }
    builder = { Name: top.get("Name"), Driver: top.get("Driver"), Nodes: [{ Name: node.get("Name"), Endpoint: node.get("Endpoint"), Status: node.get("Status"),
      Buildkit: node.get("BuildKit version"), Platforms: node.get("Platforms") }] };
  }
  const node = builder?.Nodes?.[0];
  if (builder?.Driver !== "docker" || !Array.isArray(builder.Nodes) || builder.Nodes.length !== 1 || !plain(node)
    || node.Name !== lease.contextName || ![lease.endpoint, lease.contextName].includes(node.Endpoint)
    || !String(node.Platforms ?? "").split(/,[ \t]*/u).map((item) => item.replace(/\*$/u, "")).includes("linux/amd64")
    || String(node.Status ?? "").toLowerCase() !== "running" || typeof node.Buildkit !== "string" || node.Buildkit.length === 0) {
    fail("gosu_derivative_image_observation_routing_invalid", "ROUTING");
  }
  return freeze({ name: parsedJson ? null : builder.Name, nodeName: node.Name, driver: "docker", endpoint: node.Endpoint,
    status: node.Status, buildkit: node.Buildkit, platforms: String(node.Platforms), representation: parsedJson ? "FORMAT_ONLY_JSON" : "NATIVE_TEXT" });
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
  const role = archiveRole(specification);
  if (!exact(specification, ["path", "role", "maximumBytes"]) || !["BASE", "CANDIDATE"].includes(specification.role)
    || specification.maximumBytes !== ARCHIVE_LIMIT) archiveFail(role, "READ", "READ_INVALID");
  let fd;
  try { fd = openSync(specification.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { archiveFail(role, "READ", "READ_INVALID", "gosu_derivative_image_observation_input_invalid"); }
  try {
    const stat = fstatSync(fd, { bigint: true }); const named = lstatSync(specification.path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== 1000n || stat.gid !== 1000n
      || (stat.mode & 0o7777n) !== 0o600n
      || !isDeepStrictEqual(stableSnapshot(stat), stableSnapshot(named)) || realpathSync(specification.path) !== specification.path) {
      archiveFail(role, "READ", "READ_INVALID");
    }
    if (stat.size <= 0n || stat.size > BigInt(ARCHIVE_LIMIT)) archiveFail(role, "READ", "SIZE_INVALID");
    const buffer = Buffer.allocUnsafe(Number(stat.size)); let offset = 0;
    while (offset < buffer.length) { control.guard(); const count = readSync(fd, buffer, offset, Math.min(MiB, buffer.length - offset), offset); if (count <= 0) break; offset += count; }
    control.guard();
    const after = fstatSync(fd, { bigint: true }); const final = lstatSync(specification.path, { bigint: true });
    if (offset !== buffer.length || !isDeepStrictEqual(stableSnapshot(stat), stableSnapshot(after))
      || !isDeepStrictEqual(stableSnapshot(stat), stableSnapshot(final)) || realpathSync(specification.path) !== specification.path) {
      archiveFail(role, "READ", "READ_INVALID");
    }
    return freeze({ buffer, identity: { bytes: buffer.length, sha256: hash(buffer) }, physical: stableSnapshot(stat) });
  } catch (error) {
    if (legacyCodeProjection(error) !== null) throw error;
    archiveFail(role, "READ", "READ_INVALID", "gosu_derivative_image_observation_input_invalid");
  } finally { closeSync(fd); }
}
function defaultRetainedArchiveReader(specification, control) {
  const role = archiveRole(specification);
  if (!exact(specification, ["path", "role", "maximumBytes"]) || !["BASE", "CANDIDATE"].includes(specification.role)
    || specification.maximumBytes !== ARCHIVE_LIMIT) archiveFail(role, "READ", "READ_INVALID");
  let fd;
  try { fd = openSync(specification.path, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { return retentionStability(() => archiveFail(role, "READ", "READ_INVALID", "gosu_derivative_image_observation_input_invalid")); }
  const owner = descriptorOwner(fd);
  try {
    const [stat, named] = retentionStability(() => [fstatSync(fd, { bigint: true }), lstatSync(specification.path, { bigint: true })]);
    const initial = stableSnapshot(stat);
    retentionStability(() => {
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== 1000n || stat.gid !== 1000n
        || (stat.mode & 0o7777n) !== 0o600n || !isDeepStrictEqual(initial, stableSnapshot(named))
        || realpathSync(specification.path) !== specification.path) archiveFail(role, "READ", "READ_INVALID");
      if (stat.size <= 0n || stat.size > BigInt(ARCHIVE_LIMIT)) archiveFail(role, "READ", "SIZE_INVALID");
    });
    const buffer = Buffer.allocUnsafe(Number(stat.size)); let offset = 0;
    while (offset < buffer.length) {
      control.guard();
      const count = readSync(fd, buffer, offset, Math.min(MiB, buffer.length - offset), offset);
      if (count <= 0) break;
      offset += count;
    }
    control.guard();
    const guard = () => retentionStability(() => {
      const held = fstatSync(fd, { bigint: true }); const current = lstatSync(specification.path, { bigint: true });
      if (!held.isFile() || held.isSymbolicLink() || held.uid !== 1000n || held.gid !== 1000n || held.nlink !== 1n
        || (held.mode & 0o7777n) !== 0o600n || !isDeepStrictEqual(stableSnapshot(held), initial)
        || !isDeepStrictEqual(stableSnapshot(current), initial) || realpathSync(specification.path) !== specification.path) {
        archiveFail(role, "READ", "READ_INVALID");
      }
      return initial;
    });
    const guardNamed = () => retentionStability(() => {
      const current = lstatSync(specification.path, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || !isDeepStrictEqual(stableSnapshot(current), initial)
        || realpathSync(specification.path) !== specification.path) archiveFail(role, "READ", "READ_INVALID");
      return initial;
    });
    if (offset !== buffer.length) retentionStability(() => archiveFail(role, "READ", "READ_INVALID"));
    guard();
    const record = freeze({ buffer, identity: { bytes: buffer.length, sha256: hash(buffer) }, physical: initial });
    retentionArchiveSessions.set(record, Object.freeze({
      guard,
      guardNamed,
      seal: (sealControl) => { guard(); sealControl.guard(); fsyncSync(fd); sealControl.guard(); return guard(); },
      snapshot: () => initial,
      close: owner.close,
    }));
    return record;
  } catch (error) {
    const primary = legacyCodeProjection(error) !== null ? error
      : (() => { try { archiveFail(role, "READ", "READ_INVALID", "gosu_derivative_image_observation_input_invalid"); } catch (closedError) { return closedError; } })();
    if (retentionStabilityFailures.has(error)) retentionStabilityFailures.add(primary);
    const outcome = closeRetentionOwners([owner]);
    if (outcome.closeUncertain && (typeof primary === "object" || typeof primary === "function") && primary !== null) {
      retentionCloseUncertainFailures.add(primary);
    }
    throw primary;
  }
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
function authenticateContext(buffer, control, retainLockHandle = false) {
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
    const observation = freeze({ bytes: buffer.length, sha256: hash(buffer), entries: scan.members.map(descriptor) });
    return retainLockHandle ? Object.freeze({ observation, lockHandle: handle }) : observation;
  }).catch((error) => { if (CODES.has(error?.message)) throw error; fail("gosu_derivative_image_observation_context_invalid", "CONTEXT"); });
}
function parseCommandJson(result, phase) {
  if (!plain(result) || result.exitCode !== 0 || result.timedOut !== false || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)
    || result.stdout.length > OUTPUT_LIMIT || result.stderr.length > STDERR_LIMIT) fail("gosu_derivative_image_observation_command_failed", phase);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result.stdout)); }
  catch { fail("gosu_derivative_image_observation_command_failed", phase); }
}
function privateProfile(result, representation, parsed) {
  const envelope = (buffer) => ({ encoding: "base64", bytes: buffer.length, sha256: hash(buffer), base64: buffer.toString("base64") });
  return freeze({ command: result.command, representation, parsed, stdout: envelope(result.stdout), stderr: envelope(result.stderr) });
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
  return runGosuDerivativeImageBuild(input, dependencies, false, false);
}

export async function runGosuDerivativeImageBuildProofV1(input, dependencies = {}) {
  return runGosuDerivativeImageBuild(input, dependencies, true, false);
}

export async function runGosuDerivativeImageRetainedBuildProofV1(input, dependencies = {}) {
  return runGosuDerivativeImageBuild(input, dependencies, true, true);
}

async function runGosuDerivativeImageBuild(input, dependencies, proofEnabled, retentionEnabled) {
  let phase = "PREFLIGHT"; let buildStarted = false; let contextSession; let deadlineTimer;
  let retentionDirectorySession; let baseRetentionSession; let candidateRetentionSession; let contextCloseAttempted = false;
  let retentionControl; let contextCloseUncertain = false;
  let retentionExpectedEntries = [];
  const sealedRoles = [];
  const closeContextOnce = (guard) => {
    if (contextSession === undefined) return Object.freeze({ error: undefined, closeUncertain: false });
    if (typeof contextSession.closeAllOnce === "function") return contextSession.closeAllOnce(guard);
    let error; let closeUncertain = false;
    try { guard(); } catch (guardError) { error ??= guardError; }
    try { contextSession.close(); }
    catch (closeError) { error ??= closeError; closeUncertain = true; }
    try { guard(); } catch (guardError) { error ??= guardError; }
    if (closeUncertain && error !== undefined) retentionCloseUncertainFailures.add(error);
    return Object.freeze({ error, closeUncertain });
  };
  try {
    const expectedPurpose = retentionEnabled ? RETAINED_PROOF_PURPOSE : proofEnabled ? PROOF_PURPOSE : PURPOSE;
    if (!exact(input, ["purpose", "nonce", "lease"]) || input.purpose !== expectedPurpose || !HEX24.test(input.nonce)) {
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
    const genuineRetention = retentionEnabled && !injected;
    const archiveReader = dependencies.archiveReader ?? (genuineRetention ? defaultRetainedArchiveReader : defaultArchiveReader);
    const abortController = new globalThis.AbortController();
    deadlineTimer = setTimeout(() => abortController.abort(), Math.max(1, deadline - startedAt));
    const remaining = () => { const value = deadline - now(); if (abortController.signal.aborted || !Number.isFinite(value) || value <= 0) fail("gosu_derivative_image_observation_deadline_exceeded", phase); return value; };
    let expandedRemaining = 2 * GiB;
    const control = Object.freeze({ guard: () => { remaining(); }, signal: abortController.signal,
      maximumExpanded: () => { remaining(); if (expandedRemaining <= 0) fail("gosu_derivative_image_observation_archive_invalid", phase); return Math.min(GiB, expandedRemaining); },
      consumeExpanded: (bytes) => { remaining(); if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > expandedRemaining) fail("gosu_derivative_image_observation_archive_invalid", phase); expandedRemaining -= bytes; } });
    retentionControl = control;
    if (genuineRetention) retentionDirectorySession = openRetentionDirectorySession(lease.outputDirectory);
    const env = freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: lease.dockerConfig,
      DOCKER_CONFIG: lease.dockerConfig, BUILDX_CONFIG: lease.buildxConfig });
    const prefix = ["--config", lease.dockerConfig, "--context", lease.contextName];
    const command = async (commandPhase, args, timeoutMs, options = {}) => {
      phase = commandPhase; const routedPrefix = options.createContext ? ["--config", lease.dockerConfig] : prefix;
      const request = freeze({ phase, binary: DOCKER, args: [...routedPrefix, ...args], cwd: lease.outputDirectory, env,
        timeoutMs: Math.min(timeoutMs, remaining()), stdin: options.stdin, stdoutMode: options.stdoutPath ? "FILE" : "BUFFER",
        stdoutPath: options.stdoutPath, stdoutLimit: options.stdoutPath ? ARCHIVE_LIMIT : OUTPUT_LIMIT, stderrLimit: STDERR_LIMIT });
      const result = await runner(request);
      if (!plain(result) || !Object.values(Object.getOwnPropertyDescriptors(result)).every((descriptor) => Object.hasOwn(descriptor, "value"))) {
        fail("gosu_derivative_image_observation_command_failed", phase);
      }
      const { exitCode, timedOut, stdinBytes, stdinEnded, stdout, stderr, stdoutBytes, outputPhysical, outputIdentity } = result;
      if (exitCode !== 0 || timedOut !== false || stdinBytes !== (options.stdin?.length ?? 0)
        || stdinEnded !== true || !Buffer.isBuffer(stderr) || stderr.length > STDERR_LIMIT
        || !Buffer.isBuffer(stdout) || !Number.isSafeInteger(stdoutBytes) || stdoutBytes < 0
        || !options.stdoutPath && (stdout.length > OUTPUT_LIMIT || stdoutBytes !== stdout.length)
        || options.stdoutPath && (!plain(outputPhysical) || !exact(outputIdentity, ["bytes", "sha256"])
          || outputIdentity.bytes !== stdoutBytes || !/^[0-9a-f]{64}$/u.test(outputIdentity.sha256)
          || outputPhysical.size !== outputIdentity.bytes)) {
        fail("gosu_derivative_image_observation_command_failed", phase);
      }
      const owned = { exitCode, timedOut, stdinBytes, stdinEnded, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr),
        stdoutBytes, outputPhysical, outputIdentity, command: { binary: request.binary, args: request.args } };
      remaining(); return owned;
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
    const contextResult = await command(phase, ["context", "inspect", lease.contextName], 15_000);
    const context = parseCommandJson(contextResult, phase);
    const contextItem = Array.isArray(context) ? context[0] : context;
    if (!plain(contextItem) || contextItem.Name !== lease.contextName || contextItem.Endpoints?.docker?.Host !== lease.endpoint) {
      fail("gosu_derivative_image_observation_routing_invalid", phase);
    }
    const contextProfile = privateProfile(contextResult, "JSON", { name: contextItem.Name, endpoint: contextItem.Endpoints.docker.Host });
    const versionResult = await command(phase, ["version", "--format", "{{json .}}"], 15_000);
    const version = parseCommandJson(versionResult, phase);
    const versionProfile = privateProfile(versionResult, "JSON", { serverVersion: version.Server?.Version });
    const infoResult = await command(phase, ["info", "--format", "{{json .}}"], 15_000);
    const info = parseCommandJson(infoResult, phase);
    if (version.Server?.Version !== "28.0.4" || info.ID !== lease.daemonId || info.DockerRootDir !== lease.dataRoot
      || info.OSType !== "linux" || info.Architecture !== "x86_64" || info.Driver !== "overlay2"
      || info.Containerd?.Address !== lease.containerdAddress
      || info.Containerd?.Namespaces?.Containers !== lease.containersNamespace
      || info.Containerd?.Namespaces?.Plugins !== lease.pluginsNamespace) fail("gosu_derivative_image_observation_routing_invalid", phase);
    const infoProfile = privateProfile(infoResult, "JSON", { daemonId: info.ID, dataRoot: info.DockerRootDir, os: info.OSType,
      arch: info.Architecture, driver: info.Driver, containerdAddress: info.Containerd.Address,
      namespaces: { containers: info.Containerd.Namespaces.Containers, plugins: info.Containerd.Namespaces.Plugins } });
    const builderResult = await command(phase, ["buildx", "inspect"], 15_000);
    const parsedBuilder = parseBuilder(builderResult.stdout, lease);
    const builderProfile = privateProfile(builderResult, parsedBuilder.representation, parsedBuilder);
    const builder = freeze({ driver: parsedBuilder.driver, endpoint: parsedBuilder.endpoint,
      platforms: parsedBuilder.platforms, representation: parsedBuilder.representation });
    // These original routing bytes are private evidence, never public logs or diagnostics.
    const profiles = freeze({ stage: "PRE_CONTEXT", context: contextProfile, version: versionProfile, info: infoProfile, builder: builderProfile });
    await inventory([], phase);
    phase = "CONTEXT";
    const contextRecord = readerRecord(await contextReader(freeze({ path: CONTEXT_PATH, bytes: CONTEXT_BYTES, sha256: CONTEXT_SHA256 }), control),
      { maximumBytes: CONTEXT_BYTES, bytes: CONTEXT_BYTES, sha256: CONTEXT_SHA256 }, phase);
    contextSession = contextSessions.get(contextRecord); contextSession?.guard();
    const contextBuffer = contextRecord.buffer; const authenticatedContext = await authenticateContext(contextBuffer, control, proofEnabled);
    const contextObservation = proofEnabled ? authenticatedContext.observation : authenticatedContext;
    const lockHandle = proofEnabled ? authenticatedContext.lockHandle : undefined; contextSession?.guard();
    phase = "BASE"; await command(phase, ["image", "pull", "--platform", "linux/amd64", BASE_REFERENCE], 180_000);
    const baseInspect = parseCommandJson(await command(phase, ["image", "inspect", "--format", "{{json .}}", BASE_REFERENCE], 15_000), phase);
    if (baseInspect.Id !== BASE_CONFIG_ID || baseInspect.Os !== "linux" || baseInspect.Architecture !== "amd64") {
      fail("gosu_derivative_image_observation_identity_invalid", phase);
    }
    await inventory([BASE_CONFIG_ID], phase);
    const baseSubject = freeze({ role: "BASE", reference: BASE_REFERENCE, imageId: baseInspect.Id, configId: baseInspect.Id,
      platform: { os: "linux", architecture: "amd64" } });
    const basePartial = path.join(lease.outputDirectory, "base-image.tar.partial"); const baseFinal = path.join(lease.outputDirectory, "base-image.tar");
    retentionDirectorySession?.guard([]);
    const baseSave = await command("SAVE_BASE", ["image", "save", "--platform", "linux/amd64", BASE_REFERENCE], 90_000, { stdoutPath: basePartial });
    retentionDirectorySession?.transition([{ name: "base-image.tar.partial", physical: baseSave.outputPhysical }]);
    if (genuineRetention) retentionExpectedEntries = [{ name: "base-image.tar.partial", physical: baseSave.outputPhysical }];
    const basePromotion = !runnerInjected ? promoteNoReplace(basePartial, baseFinal, baseSave.outputPhysical) : undefined;
    retentionDirectorySession?.transition([{ name: "base-image.tar", physical: basePromotion.physical }]);
    if (genuineRetention) retentionExpectedEntries = [{ name: "base-image.tar", physical: basePromotion.physical }];
    phase = "BUILD"; const candidateReference = `aw-postgres-gosu:${nonce}`; let buildWindow;
    let windowStartedAt;
    if (proofEnabled) {
      windowStartedAt = now();
      if (!Number.isSafeInteger(windowStartedAt) || windowStartedAt < 0 || windowStartedAt < startedAt || windowStartedAt >= deadline) {
        fail("gosu_derivative_image_observation_deadline_exceeded", phase);
      }
    }
    buildStarted = true;
    await command(phase, ["buildx", "build", "--platform", "linux/amd64", "--network", "none", "--pull=false",
      "--provenance=false", "--sbom=false", "--progress", "plain", "--tag", candidateReference, "--file", "Dockerfile", "-"], 180_000,
    { stdin: contextBuffer });
    if (proofEnabled) {
      const windowCompletedSample = now();
      if (!Number.isSafeInteger(windowCompletedSample) || windowCompletedSample < windowStartedAt
        || windowCompletedSample >= Number.MAX_SAFE_INTEGER) fail("gosu_derivative_image_observation_deadline_exceeded", phase);
      const completedAtMs = windowCompletedSample + 1;
      if (completedAtMs > deadline || completedAtMs - windowStartedAt > 600_000) {
        fail("gosu_derivative_image_observation_deadline_exceeded", phase);
      }
      buildWindow = freeze({ startedAtMs: windowStartedAt, completedAtMs });
    }
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
    retentionDirectorySession?.guard([{ name: "base-image.tar", physical: basePromotion.physical }]);
    const candidateSave = await command("SAVE_CANDIDATE", ["image", "save", "--platform", "linux/amd64", candidateReference], 90_000, { stdoutPath: candidatePartial });
    retentionDirectorySession?.transition([{ name: "base-image.tar", physical: basePromotion.physical },
      { name: "candidate-image.tar.partial", physical: candidateSave.outputPhysical }]);
    if (genuineRetention) retentionExpectedEntries = [{ name: "base-image.tar", physical: basePromotion.physical },
      { name: "candidate-image.tar.partial", physical: candidateSave.outputPhysical }];
    const candidatePromotion = !runnerInjected ? promoteNoReplace(candidatePartial, candidateFinal, candidateSave.outputPhysical) : undefined;
    retentionDirectorySession?.transition([{ name: "base-image.tar", physical: basePromotion.physical },
      { name: "candidate-image.tar", physical: candidatePromotion.physical }]);
    if (genuineRetention) retentionExpectedEntries = [{ name: "base-image.tar", physical: basePromotion.physical },
      { name: "candidate-image.tar", physical: candidatePromotion.physical }];
    phase = "OBSERVE";
    const readArchive = async (role, archivePath) => {
      try {
        const rawRecord = await archiveReader(freeze({ path: archivePath, role, maximumBytes: ARCHIVE_LIMIT }), control);
        const retentionSession = retentionArchiveSessions.get(rawRecord);
        if (role === "BASE") baseRetentionSession = retentionSession;
        if (role === "CANDIDATE") candidateRetentionSession = retentionSession;
        return readerRecord(rawRecord, { maximumBytes: ARCHIVE_LIMIT }, phase, role);
      } catch (error) {
        if (archiveFailureDetails.has(error) || legacyCodeProjection(error) !== null) throw error;
        archiveFail(role, "READ", "READ_INVALID", "gosu_derivative_image_observation_input_invalid");
      }
    };
    const baseRecord = await readArchive("BASE", runnerInjected ? basePartial : baseFinal);
    const candidateRecord = await readArchive("CANDIDATE", runnerInjected ? candidatePartial : candidateFinal);
    if (!isDeepStrictEqual(baseRecord.identity, baseSave.outputIdentity)) archiveFail("BASE", "BIND", "IDENTITY_MISMATCH");
    if (!isDeepStrictEqual(candidateRecord.identity, candidateSave.outputIdentity)) archiveFail("CANDIDATE", "BIND", "IDENTITY_MISMATCH");
    const baseArchive = baseRecord.buffer; const candidateArchive = candidateRecord.buffer;
    if (!Buffer.isBuffer(baseArchive)) archiveFail("BASE", "BIND", "READ_INVALID");
    if (!Buffer.isBuffer(candidateArchive)) archiveFail("CANDIDATE", "BIND", "READ_INVALID");
    if (baseArchive.length + candidateArchive.length > 2 * GiB) archiveFail("UNKNOWN", "BIND", "SIZE_INVALID");
    let base; let candidate; let pairProof;
    if (proofEnabled) {
      const openSave = async (archive, subject) => {
        try { return await openGosuDerivativeDockerSaveV1(archive, subject); }
        catch { fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE"); }
      };
      retentionDirectorySession?.guard([{ name: "base-image.tar", physical: baseRecord.physical },
        { name: "candidate-image.tar", physical: candidateRecord.physical }]);
      baseRetentionSession?.guard(); candidateRetentionSession?.guard(); control.guard();
      base = await openSave(baseArchive, freeze({ role: "BASE", archive: baseSave.outputIdentity, configId: baseSubject.configId }));
      control.guard();
      candidate = await openSave(candidateArchive,
        freeze({ role: "CANDIDATE", archive: candidateSave.outputIdentity, configId: candidateSubject.configId }));
      control.guard(); baseRetentionSession?.guard(); candidateRetentionSession?.guard();
      retentionDirectorySession?.guard([{ name: "base-image.tar", physical: baseRecord.physical },
        { name: "candidate-image.tar", physical: candidateRecord.physical }]);
      try { pairProof = proveGosuDerivativeImagePairV1(lockHandle, { baseSave: base, candidateSave: candidate, buildWindow }); }
      catch { fail("gosu_derivative_image_observation_archive_invalid", "OBSERVE"); }
      control.guard(); baseRetentionSession?.guard(); candidateRetentionSession?.guard();
      retentionDirectorySession?.guard([{ name: "base-image.tar", physical: baseRecord.physical },
        { name: "candidate-image.tar", physical: candidateRecord.physical }]);
    } else {
      base = await inspectSave(baseArchive, baseSubject, control);
      candidate = await inspectSave(candidateArchive, candidateSubject, control);
    }
    let retention;
    if (genuineRetention) {
      baseRetentionSession.guard(); candidateRetentionSession.guard();
      retentionDirectorySession.guard([{ name: "base-image.tar", physical: baseRecord.physical },
        { name: "candidate-image.tar", physical: candidateRecord.physical }]);
      baseRetentionSession.seal(control); sealedRoles.push("BASE");
      baseRetentionSession.guard(); candidateRetentionSession.guard();
      retentionDirectorySession.guard([{ name: "base-image.tar", physical: baseRecord.physical },
        { name: "candidate-image.tar", physical: candidateRecord.physical }]);
      candidateRetentionSession.seal(control); sealedRoles.push("CANDIDATE");
      baseRetentionSession.guard(); candidateRetentionSession.guard();
      retentionDirectorySession.guard([{ name: "base-image.tar", physical: baseRecord.physical },
        { name: "candidate-image.tar", physical: candidateRecord.physical }]);
      retentionDirectorySession.seal(control);
      baseRetentionSession.guard(); candidateRetentionSession.guard();
      const directory = retentionDirectorySession.guard([{ name: "base-image.tar", physical: baseRecord.physical },
        { name: "candidate-image.tar", physical: candidateRecord.physical }]);
      retention = retentionSnapshotRecord(buildWindow, pairProof, directory, baseRetentionSession.snapshot(),
        candidateRetentionSession.snapshot());
    } else if (retentionEnabled) {
      retention = freeze({ state: "SIMULATED_NOT_RETAINED", preservation: "NOT_ESTABLISHED",
        authority: "NOT_AUTHORIZED", admission: "NOT_ESTABLISHED" });
    }
    phase = "FINAL";
    const operational = { state: "IMAGE_BUILD_FORMAT_OBSERVED_REVIEW_PENDING", authority: "NOT_AUTHORIZED", image: "BUILT_UNVALIDATED",
      candidateAdmission: "NOT_AUTHORIZED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED" };
    const simulated = { state: "FORMAT_ONLY_SIMULATION", scope: "FORMAT_ONLY", image: "NOT_ESTABLISHED",
      candidateAdmission: "NOT_ESTABLISHED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED" };
    const proofOperational = { state: "IMAGE_PAIR_PROOF_OBSERVED_REVIEW_PENDING", authority: "NOT_AUTHORIZED", image: "BUILT_UNVALIDATED",
      candidateAdmission: "NOT_AUTHORIZED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED" };
    const proofSimulated = { state: "PAIR_PROOF_SIMULATION", scope: "CONDITIONAL_PAIR_PROOF_ONLY", authority: "NOT_AUTHORIZED",
      image: "NOT_ESTABLISHED", candidateAdmission: "NOT_ESTABLISHED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED" };
    const retentionOperational = { state: "IMAGE_PAIR_RETENTION_SNAPSHOT_OBSERVED_REVIEW_PENDING", authority: "NOT_AUTHORIZED",
      image: "BUILT_UNVALIDATED", candidateAdmission: "NOT_AUTHORIZED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED" };
    const retentionSimulated = { state: "RETAINED_PAIR_PROOF_SIMULATION", scope: "CONDITIONAL_PAIR_PROOF_ONLY", authority: "NOT_AUTHORIZED",
      image: "NOT_ESTABLISHED", candidateAdmission: "NOT_ESTABLISHED", functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED" };
    const result = retentionEnabled ? freeze({ ...(injected ? retentionSimulated : retentionOperational),
      nonce, lease: { daemonId: lease.daemonId, pid: lease.pid, startTicks: lease.startTicks }, builder, profiles,
      preflight: acceptedPreflight, context: { ...contextObservation, physical: contextRecord.physical }, buildWindow, pairProof, retention, dates: null })
      : proofEnabled ? freeze({ ...(injected ? proofSimulated : proofOperational),
      nonce, lease: { daemonId: lease.daemonId, pid: lease.pid, startTicks: lease.startTicks }, builder, profiles,
      preflight: acceptedPreflight, context: { ...contextObservation, physical: contextRecord.physical }, buildWindow, pairProof, dates: null })
      : freeze({ ...(injected ? simulated : operational),
        nonce, lease: { daemonId: lease.daemonId, pid: lease.pid, startTicks: lease.startTicks }, builder, profiles,
        preflight: acceptedPreflight, context: { ...contextObservation, physical: contextRecord.physical }, base, candidate, dates: null });
    if (retentionEnabled) {
      const closeOutcome = closeRetentionOwners([baseRetentionSession, candidateRetentionSession, retentionDirectorySession], control.guard);
      if (closeOutcome.error !== undefined) throw closeOutcome.error;
      baseRetentionSession?.guardNamed(); candidateRetentionSession?.guardNamed();
      retentionDirectorySession?.guardNamed([{ name: "base-image.tar", physical: baseRecord.physical },
        { name: "candidate-image.tar", physical: candidateRecord.physical }]);
      control.guard();
      contextCloseAttempted = true;
      const contextCloseOutcome = closeContextOnce(control.guard);
      contextCloseUncertain ||= contextCloseOutcome.closeUncertain;
      if (contextCloseOutcome.error !== undefined) throw contextCloseOutcome.error;
      contextSession?.guardNamed?.();
      baseRetentionSession?.guardNamed(); candidateRetentionSession?.guardNamed();
      retentionDirectorySession?.guardNamed(retentionExpectedEntries); control.guard();
    } else contextSession?.close();
    clearTimeout(deadlineTimer); return result;
  } catch (error) {
    clearTimeout(deadlineTimer);
    let closeUncertain = contextCloseUncertain || retentionCloseUncertainFailures.has(error);
    let stabilityFailed = retentionStabilityFailures.has(error);
    if (retentionEnabled) {
      const closeGuard = retentionControl?.guard ?? (() => undefined);
      const closeOutcome = closeRetentionOwners([baseRetentionSession, candidateRetentionSession, retentionDirectorySession], closeGuard);
      closeUncertain ||= closeOutcome.closeUncertain;
      try { baseRetentionSession?.guardNamed(); } catch (guardError) { stabilityFailed ||= retentionStabilityFailures.has(guardError); }
      try { candidateRetentionSession?.guardNamed(); } catch (guardError) { stabilityFailed ||= retentionStabilityFailures.has(guardError); }
      try {
        retentionDirectorySession?.guardNamed(retentionExpectedEntries);
      } catch (guardError) { stabilityFailed ||= retentionStabilityFailures.has(guardError); }
      if (!contextCloseAttempted) {
        const contextCloseOutcome = closeContextOnce(closeGuard);
        contextCloseUncertain ||= contextCloseOutcome.closeUncertain;
        closeUncertain ||= contextCloseUncertain;
      }
      try { contextSession?.guardNamed?.(); } catch (guardError) { stabilityFailed ||= retentionStabilityFailures.has(guardError); }
      try { baseRetentionSession?.guardNamed(); } catch (guardError) { stabilityFailed ||= retentionStabilityFailures.has(guardError); }
      try { candidateRetentionSession?.guardNamed(); } catch (guardError) { stabilityFailed ||= retentionStabilityFailures.has(guardError); }
      try { retentionDirectorySession?.guardNamed(retentionExpectedEntries); }
      catch (guardError) { stabilityFailed ||= retentionStabilityFailures.has(guardError); }
    } else try { contextSession?.close(); } catch { /* Retain the primary closed diagnostic. */ }
    const retained = closed(error, phase);
    if (buildStarted) retained.state = "MAY_HAVE_BEEN_BUILT";
    if (retentionEnabled) retained.retentionFailure = retentionFailureDetail(sealedRoles, closeUncertain,
      stabilityFailed || retentionCloseUncertainFailures.has(error));
    throw retained;
  }
}
