import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, readdirSync, statfsSync } from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual } from "node:util";
import { validateLocalPostgresRetentionReceipt } from "./candidate-local-retention.mjs";
import { postgresCandidateProofLimits, validatePostgresCandidateArchiveMaterial } from "./candidate-proof.mjs";
import { validatePostgresRemotePolicy } from "./candidate-remote.mjs";

const DOCKER = "/usr/bin/docker";
const CAP = 1024 ** 2;
const OPERATION_MS = 180_000;
const PREFIX = "postgres_local_cold_load_";
const REASONS = new Set(["context_invalid", "requires_linux_nonroot", "storage_invalid", "files_changed", "archive_invalid",
  "receipt_invalid", "identity_invalid", "authorization_invalid", "command_failed", "inventory_invalid", "image_invalid",
  "deadline_exceeded", "aborted", "proof_invalid", "operation_failed", "descriptor_cleanup_failed"]);
const PHASES = ["CONTEXT", "PREFLIGHT", "BEFORE_LOAD", "AFTER_LOAD", "BEFORE_REMOVE", "AFTER_REMOVE", "CLEANUP"];
const SUCCESS_PHASES = ["archive_before_load", "engine_preflight", "archive_load", "loaded_image", "archive_after_load",
  "owned_image_remove", "final_seal"];
const HEX = /^[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,19})$/u;
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, expected) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...expected].sort());
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([key, item]) => [key, freeze(item)]))) : v;
const jsonBytes = (v) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
function fail(reason) { throw new Error(PREFIX + reason); }
function reason(error) {
  try { const message = error instanceof Error ? error.message : "";
    const found = typeof message === "string" && message.startsWith(PREFIX) ? message.slice(PREFIX.length) : "";
    return REASONS.has(found) ? found : "operation_failed";
  } catch { return "operation_failed"; }
}
export function postgresColdLoadFailureDiagnostic(error) {
  let phase; try { phase = error?.phase; } catch { /* Do not disclose untrusted properties. */ }
  return Object.freeze({ code: PREFIX + reason(error), phase: PHASES.includes(phase) ? phase : "CONTEXT", cleanup: "UNVERIFIED" });
}
function canonical(file) { return typeof file === "string" && file.length < 512 && path.posix.isAbsolute(file)
  && path.posix.normalize(file) === file; }
function decimal(v) { return typeof v === "string" && DECIMAL.test(v); }
function metadata(v, mode, minimumUid = 0) {
  return keys(v, ["dev", "ino", "uid", "gid", "mode"]) && decimal(v.dev) && decimal(v.ino) && v.ino !== "0"
    && Number.isSafeInteger(v.uid) && v.uid >= minimumUid && Number.isSafeInteger(v.gid) && v.gid > 0 && v.mode === mode;
}
function identity(v) {
  if (!keys(v, ["endpoint", "daemonId", "dataRoot", "containerdAddress", "containersNamespace", "pluginsNamespace",
    "dockerConfig", "contextName", "socket", "socketDirectory"])
    || typeof v.endpoint !== "string" || !v.endpoint.startsWith("unix://") || !canonical(v.endpoint.slice(7))
    || Buffer.byteLength(v.endpoint.slice(7)) >= 104 || typeof v.daemonId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/u.test(v.daemonId)
    || !canonical(v.dataRoot) || v.containerdAddress !== "/run/containerd/containerd.sock"
    || ![v.containersNamespace, v.pluginsNamespace].every((item) => typeof item === "string" && /^[A-Za-z0-9._-]{1,128}$/u.test(item))
    || v.containersNamespace === "moby" || v.pluginsNamespace === "plugins.moby" || v.containersNamespace === v.pluginsNamespace
    || !canonical(v.dockerConfig) || typeof v.contextName !== "string" || !/^[A-Za-z0-9._-]{1,128}$/u.test(v.contextName)
    || !metadata(v.socket, 0o660) || !metadata(v.socketDirectory, 0o710)
    || v.socket.uid !== v.socketDirectory.uid || v.socket.gid !== v.socketDirectory.gid) fail("identity_invalid");
  return freeze(v);
}
function files(value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((v, index) =>
    !keys(v, ["name", "size", "sha256", "identity"]) || v.name !== ["candidate.tar", "retention-receipt.json"][index]
    || !Number.isSafeInteger(v.size) || v.size < 1 || v.size > (index === 0 ? postgresCandidateProofLimits.archiveBytes : CAP)
    || !HEX.test(v.sha256) || !keys(v.identity, ["dev", "ino", "uid", "gid", "mode", "nlink", "mtimeNs", "ctimeNs"])
    || !metadata({ dev: v.identity.dev, ino: v.identity.ino, uid: v.identity.uid, gid: v.identity.gid, mode: v.identity.mode }, 0o600, 1)
    || v.identity.nlink !== 1 || !decimal(v.identity.mtimeNs) || !decimal(v.identity.ctimeNs))
    || value[0].identity.dev === value[1].identity.dev && value[0].identity.ino === value[1].identity.ino
    || value[0].identity.uid !== value[1].identity.uid || value[0].identity.gid !== value[1].identity.gid) fail("context_invalid");
  return freeze(value);
}
function inputValue(value) {
  const expected = ["directory", "files", "archiveProof", "policy", "originalRecipeRevision", "originalExecutionId",
    "recipeRevision", "executionId", "identity"];
  if (!keys(value, Object.hasOwn(value ?? {}, "signal") ? [...expected, "signal"] : expected) || !canonical(value.directory)
    || !REVISION.test(value.recipeRevision) || !REVISION.test(value.originalRecipeRevision)
    || !/^local-[1-9][0-9]{0,19}$/u.test(value.originalExecutionId)
    || !/^local-cold-load-[0-9a-f]{24}$/u.test(value.executionId)
    || value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal)) fail("context_invalid");
  const policy = validatePostgresRemotePolicy(value.policy); const descriptors = files(value.files);
  const proof = value.archiveProof;
  const tag = "aw-postgres-gosu:" + hash(Buffer.from(value.originalExecutionId.slice(6) + ":" + value.originalRecipeRevision)).slice(0, 24);
  if (!keys(proof, ["archiveSha256", "archiveBytes", "archiveMembers", "imageId", "tag", "configDigest", "configBytes",
    "diffIds", "rawLayers", "manifestDigest", "manifestBytes", "compatibilityRecords", "remoteLayerVerification"])
    || proof.archiveSha256 !== descriptors[0].sha256 || proof.archiveBytes !== descriptors[0].size || proof.archiveMembers !== 32
    || proof.imageId !== policy.candidate.imageId || proof.configDigest !== policy.candidate.imageId || proof.configBytes !== policy.manifest.config.size
    || proof.tag !== tag || !isDeepStrictEqual(proof.diffIds, policy.candidate.diffIds) || !DIGEST.test(proof.manifestDigest)
    || !Number.isSafeInteger(proof.manifestBytes) || proof.manifestBytes < 1 || proof.manifestBytes > postgresCandidateProofLimits.jsonBytes
    || !Array.isArray(proof.rawLayers) || proof.rawLayers.length !== 12 || proof.rawLayers.some((v, index) =>
      !keys(v, ["digest", "size", "mediaType"]) || v.digest !== proof.diffIds[index] || v.mediaType !== "application/vnd.oci.image.layer.v1.tar"
      || !Number.isSafeInteger(v.size) || v.size < 1024 || v.size % 512 !== 0 || v.size > proof.archiveBytes)
    || !Array.isArray(proof.compatibilityRecords) || proof.compatibilityRecords.length !== 12 || proof.compatibilityRecords.some((v, index, list) =>
      !keys(v, ["blobDigest", "id", "parent", "rich"]) || !DIGEST.test(v.blobDigest) || !HEX.test(v.id)
      || v.parent !== (index === 0 ? null : list[index - 1].id) || v.rich !== (index === 11))
    || new Set(proof.compatibilityRecords.map((v) => v.id)).size !== 12
    || new Set(proof.compatibilityRecords.map((v) => v.blobDigest)).size !== 12
    || proof.rawLayers.reduce((sum, v) => sum + v.size, proof.configBytes + proof.manifestBytes) > proof.archiveBytes
    || proof.remoteLayerVerification !== "NOT_ESTABLISHED_BY_DOCKER_SAVE") fail("archive_invalid");
  return Object.freeze({ ...value, files: descriptors, policy, archiveProof: freeze(proof), identity: identity(value.identity) });
}
function statMetadata(v) { return { dev: String(v.dev), ino: String(v.ino), uid: Number(v.uid), gid: Number(v.gid), mode: Number(v.mode & 0o7777n) }; }
function fileMetadata(v) { return { ...statMetadata(v), nlink: Number(v.nlink), mtimeNs: String(v.mtimeNs), ctimeNs: String(v.ctimeNs) }; }
function directory(file, uid, gid, mode) {
  const v = lstatSync(file, { bigint: true });
  if (!v.isDirectory() || v.isSymbolicLink() || realpathSync(file) !== file || v.uid !== BigInt(uid)
    || v.gid !== BigInt(gid) || (v.mode & 0o7777n) !== BigInt(mode)) fail("storage_invalid");
  return statMetadata(v);
}
function descriptor(item) {
  const fd = fstatSync(item.fd, { bigint: true }); const named = lstatSync(item.file, { bigint: true });
  if (!fd.isFile() || named.isSymbolicLink() || realpathSync(item.file) !== item.file || fd.size !== BigInt(item.expected.size)
    || !isDeepStrictEqual(fileMetadata(fd), item.expected.identity) || !isDeepStrictEqual(fileMetadata(named), item.expected.identity)) fail("files_changed");
}
function readFixed(item) {
  descriptor(item); const result = Buffer.allocUnsafe(item.expected.size); let position = 0;
  while (position < result.length) {
    const count = readSync(item.fd, result, position, Math.min(CAP, result.length - position), position);
    if (count < 1) fail("files_changed"); position += count;
  }
  if (readSync(item.fd, Buffer.alloc(1), 0, 1, position) !== 0 || hash(result) !== item.expected.sha256) fail("files_changed");
  descriptor(item); return result;
}
function ext4(file) {
  const v = statfsSync(file, { bigint: true });
  const observed = spawnSync("/usr/bin/findmnt", ["--noheadings", "--output", "FSTYPE", "--target", file],
    { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: null, timeout: 10_000, maxBuffer: 1024 });
  if (v.type !== 0xef53n || observed.error || observed.signal || observed.status !== 0 || observed.stderr.length !== 0
    || !observed.stdout.equals(Buffer.from("ext4\n"))) fail("storage_invalid");
}
function parse(bytes, code = "command_failed") { try { return JSON.parse(bytes.toString("utf8")); } catch { fail(code); } }
function defaultTransport(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true,
      stdio: [options.inputFd === undefined ? "ignore" : options.inputFd, "pipe", "pipe"] });
    const chunks = { stdout: [], stderr: [] }; let bytes = 0; let forced = false; let done = false; let timer; let closingTimer; let signalled = false;
    const finish = (status, signal) => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(closingTimer); options.signal.removeEventListener("abort", kill);
      if (forced) { child.stdout.destroy(); child.stderr.destroy(); child.stdin?.destroy(); }
      resolve({ status, signal, error: forced, stdout: Buffer.concat(chunks.stdout), stderr: Buffer.concat(chunks.stderr) });
    };
    const kill = () => {
      if (done) return; forced = true;
      if (!signalled) { signalled = true;
        try { child.kill("SIGKILL"); } catch { /* A failed signal cannot authorize removal. */ }
      }
      if (closingTimer === undefined) closingTimer = setTimeout(() => finish(null, null), 1000);
    };
    const collect = (stream, chunk) => { if (done) return; bytes += chunk.length; if (bytes > CAP) kill(); else chunks[stream].push(chunk); };
    child.stdout.on("data", (chunk) => collect("stdout", chunk)); child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.stdout.on("error", kill); child.stderr.on("error", kill);
    child.on("error", () => { forced = true; if (Number.isSafeInteger(child.pid) && child.pid > 1) kill(); else finish(null, null); });
    child.on("close", finish);
    timer = setTimeout(kill, options.timeoutMs); options.signal.addEventListener("abort", kill, { once: true });
    if (options.signal.aborted) kill();
  });
}
async function bounded(factory, milliseconds, signal) {
  let timer; let abort;
  try { return await Promise.race([Promise.resolve().then(factory), new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(PREFIX + "deadline_exceeded")), milliseconds);
    if (signal) { abort = () => reject(new Error(PREFIX + "aborted")); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort(); }
  })]); } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}
function output(observed, load = false) {
  if (!plain(observed)) fail("command_failed");
  const v = { status: observed.status, error: observed.error, signal: observed.signal, stdout: observed.stdout, stderr: observed.stderr };
  if (v.error || v.signal || v.status !== 0 || !Buffer.isBuffer(v.stdout) || !Buffer.isBuffer(v.stderr)
    || v.stdout.length + v.stderr.length > CAP || !load && v.stderr.length !== 0) fail("command_failed");
  return v.stdout;
}
function info(v, expected) {
  if (!plain(v) || v.ID !== expected.daemonId || v.DockerRootDir !== expected.dataRoot || v.ServerVersion !== "28.0.4"
    || v.Driver !== "overlay2" || v.OSType !== "linux" || v.Architecture !== "x86_64"
    || v.Containerd?.Address !== expected.containerdAddress || v.Containerd?.Namespaces?.Containers !== expected.containersNamespace
    || v.Containerd?.Namespaces?.Plugins !== expected.pluginsNamespace
    || v.DriverStatus?.some((entry) => Array.isArray(entry) && entry[0] === "driver-type" && String(entry[1]).includes("containerd.snapshotter"))) fail("identity_invalid");
}
function image(v, input, configuration) {
  if (!plain(v) || v.Id !== input.policy.candidate.imageId || v.Os !== "linux" || v.Architecture !== "amd64"
    || !isDeepStrictEqual(v.RepoTags, [input.archiveProof.tag]) || v.RepoDigests != null && !isDeepStrictEqual(v.RepoDigests, [])
    || !Number.isSafeInteger(v.Size) || v.Size < 1 || v.Size > 2 * 1024 ** 3
    || v.RootFS?.Type !== "layers" || !isDeepStrictEqual(v.RootFS.Layers, input.policy.candidate.diffIds)
    || !isDeepStrictEqual(v.Config, configuration.config)) fail("image_invalid");
}
const inventoryProof = (count) => ({ images: count, containers: 0, volumes: 0 });
export function validatePostgresCandidateColdLoadProof(value, expectedValue) {
  try {
    const expected = inputValue(expectedValue);
    const fields = ["kind", "state", "authority", "recipeRevision", "executionId", "originalRecipeRevision", "originalExecutionId",
      "directory", "files", "archiveProof", "identity", "filesystem", "subject", "imageId", "diffIds", "tag", "configurationComparison",
      "inventories", "cleanup", "phases", "imageExecution", "serviceRestore", "sqlRestore", "registryRead", "registryWrite", "signing",
      "admission", "supportStartedAt", "supportEndsAt", "archiveUntil"];
    if (!keys(value, fields) || value.kind !== "POSTGRES_CANDIDATE_COLD_LOAD_PROOF_V1" || value.state !== "COLD_LOADED_AND_REMOVED"
      || value.authority !== "LOCAL_DIAGNOSTIC" || value.filesystem !== "EXT4" || value.configurationComparison !== "EXACT_ARCHIVE_CONFIGURATION"
      || value.subject !== expected.policy.subject || value.imageId !== expected.policy.candidate.imageId
      || !isDeepStrictEqual(value.diffIds, expected.policy.candidate.diffIds) || value.tag !== expected.archiveProof.tag
      || ["recipeRevision", "executionId", "originalRecipeRevision", "originalExecutionId", "directory"].some((key) => value[key] !== expected[key])
      || ["files", "archiveProof", "identity"].some((key) => !isDeepStrictEqual(value[key], expected[key]))
      || !isDeepStrictEqual(value.inventories, { initial: inventoryProof(0), loaded: inventoryProof(1), final: inventoryProof(0) })
      || value.cleanup !== "OWNED_IMAGE_REMOVED" || !Array.isArray(value.phases) || value.phases.length !== SUCCESS_PHASES.length
      || value.phases.some((v, index) => !keys(v, ["name", "result", "durationMs"]) || v.name !== SUCCESS_PHASES[index]
        || v.result !== "PASSED" || !Number.isSafeInteger(v.durationMs) || v.durationMs < 0 || v.durationMs > OPERATION_MS)
      || ["imageExecution", "serviceRestore", "sqlRestore", "registryRead", "registryWrite", "signing"].some((key) => value[key] !== "NOT_ATTEMPTED")
      || value.admission !== "NOT_AUTHORIZED" || ["supportStartedAt", "supportEndsAt", "archiveUntil"].some((key) => value[key] !== null)) fail("proof_invalid");
    return freeze(value);
  } catch { fail("proof_invalid"); }
}

export async function coldLoadPostgresCandidate(inputValueRaw, dependencies = {}) {
  let phase = "CONTEXT"; const opened = []; let result; let failure; let controller;
  try {
    const input = inputValue(inputValueRaw);
    if (process.platform !== "linux" || !(process.getuid?.() > 0) || !(process.getgid?.() > 0)) fail("requires_linux_nonroot");
    const uid = process.getuid(); const gid = process.getgid();
    if (process.geteuid?.() !== uid || process.getegid?.() !== gid) fail("requires_linux_nonroot");
    if (!keys(dependencies, dependencies.transport === undefined ? ["authorize"] : ["authorize", "transport"])
      || typeof dependencies.authorize !== "function" || dependencies.transport !== undefined && typeof dependencies.transport !== "function"
      || input.files.some((v) => v.identity.uid !== uid || v.identity.gid !== gid) || input.identity.socket.gid !== gid
      || ["DOCKER_HOST", "DOCKER_CONTEXT"].some((key) => Object.hasOwn(process.env, key))
      || Object.hasOwn(process.env, "DOCKER_CONFIG") && process.env.DOCKER_CONFIG !== input.identity.dockerConfig) fail("context_invalid");
    controller = new globalThis.AbortController();
    const signal = globalThis.AbortSignal.any([controller.signal, globalThis.AbortSignal.timeout(OPERATION_MS), ...(input.signal ? [input.signal] : [])]);
    const startedAt = Date.now();
    const check = () => { if (signal.aborted) fail(input.signal?.aborted ? "aborted" : "deadline_exceeded"); };
    check(); ext4(input.directory);
    const directories = new Map([[input.directory, directory(input.directory, uid, gid, 0o700)]]);
    const client = input.identity.dockerConfig; const meta = path.join(client, "contexts", "meta", hash(Buffer.from(input.identity.contextName)));
    if ([path.relative(input.directory, client), path.relative(client, input.directory)].some((v) =>
      v === "" || !path.isAbsolute(v) && v !== ".." && !v.startsWith(`..${path.sep}`))) fail("context_invalid");
    const ancestors = new Map();
    for (const starting of [input.directory, client, path.dirname(input.identity.endpoint.slice(7))]) {
      let file = starting;
      while (true) {
        const stat = lstatSync(file, { bigint: true });
        if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(file) !== file) fail("storage_invalid");
        ancestors.set(file, statMetadata(stat)); const parent = path.dirname(file); if (parent === file) break; file = parent;
      }
    }
    for (const file of [client, path.join(client, "contexts"), path.join(client, "contexts", "meta"), meta]) {
      directories.set(file, directory(file, uid, gid, 0o700));
    }
    for (const expected of input.files) {
      const item = { expected, file: path.join(input.directory, expected.name) };
      item.fd = openSync(item.file, constants.O_RDONLY | constants.O_NOFOLLOW); opened.push(item); descriptor(item);
    }
    const materialFiles = opened.slice();
    const contextBytes = [[path.join(client, "config.json"), jsonBytes({ currentContext: input.identity.contextName })],
      [path.join(meta, "meta.json"), jsonBytes({ Name: input.identity.contextName, Metadata: {},
        Endpoints: { docker: { Host: input.identity.endpoint, SkipTLSVerify: false } } })]];
    for (const [file, bytes] of contextBytes) {
      const item = { file, fd: openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW) }; opened.push(item);
      item.expected = { size: bytes.length, sha256: hash(bytes), identity: fileMetadata(fstatSync(item.fd, { bigint: true })) };
      if (item.expected.identity.uid !== uid || item.expected.identity.gid !== gid || item.expected.identity.mode !== 0o600
        || item.expected.identity.nlink !== 1) fail("context_invalid"); readFixed(item);
    }
    const assertFiles = () => {
      for (const [file, expected] of ancestors) {
        const stat = lstatSync(file, { bigint: true });
        if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(file) !== file
          || !isDeepStrictEqual(statMetadata(stat), expected)) fail("files_changed");
      }
      for (const [file, expected] of directories) if (!isDeepStrictEqual(directory(file, uid, gid, 0o700), expected)) fail("files_changed");
      if (!isDeepStrictEqual(readdirSync(input.directory).sort(), ["candidate.tar", "retention-receipt.json"])
        || !isDeepStrictEqual(readdirSync(client).sort(), ["config.json", "contexts"])
        || !isDeepStrictEqual(readdirSync(path.join(client, "contexts")), ["meta"])
        || !isDeepStrictEqual(readdirSync(path.join(client, "contexts", "meta")), [path.basename(meta)])
        || !isDeepStrictEqual(readdirSync(meta), ["meta.json"])) fail("files_changed");
      for (const item of opened) descriptor(item);
      for (const item of opened.slice(2)) readFixed(item);
      const socket = input.identity.endpoint.slice(7); const stat = lstatSync(socket, { bigint: true });
      if (!stat.isSocket() || stat.isSymbolicLink() || realpathSync(socket) !== socket
        || !isDeepStrictEqual(statMetadata(stat), input.identity.socket)
        || !isDeepStrictEqual(directory(path.dirname(socket), input.identity.socketDirectory.uid, gid, 0o710), input.identity.socketDirectory)) fail("identity_invalid");
    };
    const material = () => {
      check(); assertFiles(); let receipt;
      try { receipt = validateLocalPostgresRetentionReceipt(parse(readFixed(materialFiles[1]), "receipt_invalid"), input.policy); }
      catch { fail("receipt_invalid"); }
      if (receipt.recipeRevision !== input.originalRecipeRevision || receipt.executionId !== input.originalExecutionId
        || !isDeepStrictEqual(receipt.archiveProof, input.archiveProof)) fail("receipt_invalid");
      const bytes = readFixed(materialFiles[0]); let value;
      try { value = validatePostgresCandidateArchiveMaterial(bytes, { imageId: input.policy.candidate.imageId,
        tag: input.archiveProof.tag, expectedDiffIds: input.policy.candidate.diffIds, expectedLayers: 12 }); }
      catch { fail("archive_invalid"); }
      if (!isDeepStrictEqual(value.archiveProof, input.archiveProof)) fail("archive_invalid");
      assertFiles(); check(); return value;
    };
    const authorize = async (after = false) => {
      const ack = await bounded(() => dependencies.authorize(phase), 10_000, after ? undefined : signal);
      if (!isDeepStrictEqual(ack, { state: "VERIFIED", purpose: "COLD_LOAD_ONLY", phase,
        daemonId: input.identity.daemonId, endpoint: input.identity.endpoint })) fail("authorization_invalid");
    };
    const env = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC",
      HOME: client, TMPDIR: client, DOCKER_CONFIG: client });
    const transport = dependencies.transport ?? defaultTransport;
    const call = async (args, load = false) => {
      check(); assertFiles(); await authorize(); assertFiles(); check(); let observed;
      try { observed = await bounded(() => transport(DOCKER, Object.freeze(["--host", input.identity.endpoint, ...args]), Object.freeze({
        cwd: client, env, signal, timeoutMs: Math.min(90_000, OPERATION_MS - (Date.now() - startedAt)), maxBuffer: CAP,
        ...(load ? { inputFd: materialFiles[0].fd } : {}) })), OPERATION_MS - (Date.now() - startedAt), signal); }
      finally { await authorize(true); }
      assertFiles(); check(); return output(observed, load);
    };
    const inventory = async (count) => {
      for (const [args, expected] of [
        [["image", "ls", "--all", "--quiet", "--no-trunc"], count ? input.policy.candidate.imageId + "\n" : ""],
        [["container", "ls", "--all", "--quiet", "--no-trunc"], ""], [["volume", "ls", "--quiet"], ""],
      ]) if (!((await call(args)).equals(Buffer.from(expected)))) fail("inventory_invalid");
    };
    const inspect = async (configuration) => image(parse(await call(["image", "inspect", "--format", "{{json .}}", input.policy.candidate.imageId])), input, configuration);
    const phases = [];
    const timed = async (name, activePhase, action) => { phase = activePhase; const start = Date.now(); const value = await action();
      phases.push({ name, result: "PASSED", durationMs: Math.min(OPERATION_MS, Math.max(0, Date.now() - start)) }); return value; };
    const before = await timed("archive_before_load", "BEFORE_LOAD", material);
    await timed("engine_preflight", "PREFLIGHT", async () => {
      if (!((await call(["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"])).equals(Buffer.from("28.0.4|28.0.4\n")))) fail("identity_invalid");
      info(parse(await call(["info", "--format", "{{json .}}"])), input.identity); await inventory(0);
    });
    await timed("archive_load", "BEFORE_LOAD", async () => { material(); await call(["image", "load"], true); });
    await timed("loaded_image", "AFTER_LOAD", async () => { await inventory(1); await inspect(before.configuration); });
    await timed("archive_after_load", "AFTER_LOAD", () => { const after = material(); if (!isDeepStrictEqual(after, before)) fail("archive_invalid"); });
    await timed("owned_image_remove", "BEFORE_REMOVE", async () => { await inventory(1); await inspect(before.configuration);
      await call(["image", "rm", input.archiveProof.tag]); });
    await timed("final_seal", "AFTER_REMOVE", async () => { await inventory(0); const final = material();
      if (!isDeepStrictEqual(final, before)) fail("archive_invalid"); });
    result = validatePostgresCandidateColdLoadProof({ kind: "POSTGRES_CANDIDATE_COLD_LOAD_PROOF_V1", state: "COLD_LOADED_AND_REMOVED",
      authority: "LOCAL_DIAGNOSTIC", recipeRevision: input.recipeRevision, executionId: input.executionId,
      originalRecipeRevision: input.originalRecipeRevision, originalExecutionId: input.originalExecutionId,
      directory: input.directory, files: input.files, archiveProof: input.archiveProof, identity: input.identity, filesystem: "EXT4",
      subject: input.policy.subject, imageId: input.policy.candidate.imageId, diffIds: input.policy.candidate.diffIds, tag: input.archiveProof.tag,
      configurationComparison: "EXACT_ARCHIVE_CONFIGURATION", inventories: { initial: inventoryProof(0), loaded: inventoryProof(1), final: inventoryProof(0) },
      cleanup: "OWNED_IMAGE_REMOVED", phases, imageExecution: "NOT_ATTEMPTED", serviceRestore: "NOT_ATTEMPTED", sqlRestore: "NOT_ATTEMPTED",
      registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
      supportStartedAt: null, supportEndsAt: null, archiveUntil: null }, input);
  } catch (error) {
    controller?.abort(); failure = Object.assign(new Error(PREFIX + reason(error)), { phase, cleanup: "UNVERIFIED" });
  }
  finally { controller?.abort(); for (const item of opened) try { closeSync(item.fd); } catch {
    failure = Object.assign(new Error(PREFIX + "descriptor_cleanup_failed"), { phase: "CLEANUP", cleanup: "UNVERIFIED" });
  } }
  if (failure) throw failure; return result;
}
