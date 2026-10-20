import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";
import { createGunzip, gzipSync } from "node:zlib";
import {
  gosuDerivativeImageObservationArchiveFailureDetailV1,
  gosuDerivativeImageObservationFailureDiagnostic,
  inspectGosuDerivativeImageSaveV2,
  runGosuDerivativeImageBuildProofV1,
  runGosuDerivativeImageBuildObservationV2,
} from "../scripts/postgres-image/gosu-derivative-image-observation-v2.mjs";

const BLOCK = 512;
const SELF = fileURLToPath(import.meta.url);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => `sha256:${hash(value)}`;

function octal(header, offset, length, value) {
  Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`).copy(header, offset);
}
function tarHeader(name, size, type = "0", linkname = "", metadata = {}) {
  const value = Buffer.alloc(BLOCK); Buffer.from(name).copy(value);
  octal(value, 100, 8, metadata.mode ?? (type === "5" ? 0o755 : 0o644));
  octal(value, 108, 8, metadata.uid ?? 0); octal(value, 116, 8, metadata.gid ?? 0);
  octal(value, 124, 12, size); octal(value, 136, 12, metadata.mtime ?? 1_700_000_000); value.fill(0x20, 148, 156);
  value.write(type, 156); Buffer.from(linkname).copy(value, 157); Buffer.from("ustar\0").copy(value, 257);
  Buffer.from("00").copy(value, 263);
  Buffer.from("root").copy(value, 265); Buffer.from("root").copy(value, 297);
  const checksum = value.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(value, 148);
  return value;
}
function tar(entries, endBlocks = 2) {
  const parts = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? Buffer.alloc(0);
    parts.push(tarHeader(entry.path, bytes.length, entry.type ?? "0", entry.linkname ?? "", entry));
    if (bytes.length) parts.push(bytes, Buffer.alloc((BLOCK - bytes.length % BLOCK) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * endBlocks)); return Buffer.concat(parts);
}
function hardlinkImageSaveFixture({ role, encoding, entries, diffId }) {
  const tag = `aw-postgres-gosu:${"b".repeat(24)}`;
  const rawLayer = tar(entries ?? [{ path: "usr/local/bin/tool", bytes: Buffer.from("FORMAT_ONLY hardlink target\n") },
    { path: "usr/local/bin/gosu", type: "1", linkname: "usr/local/bin/tool" }]);
  const storedLayer = encoding === "GZIP" ? gzipSync(rawLayer) : rawLayer;
  const config = Buffer.from(JSON.stringify({ architecture: "amd64", os: "linux",
    rootfs: { type: "layers", diff_ids: [diffId ?? digest(rawLayer)] }, config: { marker: role } }));
  const baseId = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
  const configId = role === "BASE" ? baseId : digest(config); const configName = `${configId.slice(7)}.json`;
  const layerName = `${hash(storedLayer)}/layer.tar`;
  const manifest = Buffer.from(JSON.stringify([{ Config: configName, RepoTags: role === "BASE" ? [] : [tag],
    Layers: [layerName] }]));
  const archive = tar([{ path: configName, bytes: config }, { path: "manifest.json", bytes: manifest },
    { path: layerName, bytes: storedLayer }]);
  return { archive, rawLayer, storedLayer, config, subject: { role, reference: role === "BASE"
    ? "postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3" : tag,
  imageId: configId, configId, platform: { os: "linux", architecture: "amd64" } } };
}
function imageSaveFixture(options = {}) {
  const role = options.role ?? "CANDIDATE";
  const tag = `aw-postgres-gosu:${"a".repeat(24)}`;
  const layer = tar([{ path: "usr/", type: "5" }, { path: "usr/local/", type: "5" },
    { path: "usr/local/bin/gosu", bytes: Buffer.from("FORMAT_ONLY gosu bytes\n") }]);
  const config = Buffer.from(JSON.stringify({ architecture: "amd64", os: "linux",
    rootfs: { type: "layers", diff_ids: [digest(layer)] }, config: { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], marker: role } }));
  const configId = options.configId ?? digest(config); const configName = `${configId.slice(7)}.json`; const layerName = `${hash(layer)}/layer.tar`;
  const manifest = Buffer.from(JSON.stringify([{ Config: configName, RepoTags: role === "BASE" ? [] : [tag], Layers: [layerName] }]));
  const archive = tar([{ path: configName, bytes: config }, { path: "manifest.json", bytes: manifest },
    { path: "repositories", bytes: Buffer.from(JSON.stringify({ "aw-postgres-gosu": { [tag.split(":")[1]]: hash(layer) } })) },
    { path: `${hash(layer)}/`, type: "5" }, { path: layerName, bytes: layer }]);
  return { archive, config, layer, subject: { role, reference: role === "BASE"
    ? "postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3" : tag, imageId: configId, configId,
    platform: { os: "linux", architecture: "amd64" } } };
}
function diagnosticSaveFixture(options = {}) {
  const role = options.role ?? "CANDIDATE"; const tag = `aw-postgres-gosu:${"a".repeat(24)}`;
  const layer = options.layer ?? tar([{ path: "usr/local/bin/gosu", bytes: Buffer.from("FORMAT_ONLY gosu bytes\n") }]);
  const configValue = options.configValue ?? { architecture: "amd64", os: "linux",
    rootfs: { type: "layers", diff_ids: [digest(layer)] },
    ...(options.configMarker === undefined ? {} : { config: { marker: options.configMarker } }) };
  const config = options.configBytes ?? Buffer.from(JSON.stringify(configValue));
  const configId = options.configId ?? digest(config); const configName = `${configId.slice(7)}.json`;
  const layerName = `${hash(layer)}/layer.tar`; const manifestEntry = {
    Config: configName, RepoTags: role === "BASE" ? [] : [tag], Layers: [layerName], ...(options.manifestExtras ?? {}),
  };
  for (const key of options.omitManifestFields ?? []) delete manifestEntry[key];
  const manifestValue = options.manifestValue ?? [manifestEntry];
  const manifest = options.manifestBytes ?? Buffer.from(JSON.stringify(manifestValue)); const entries = [];
  if (!options.omitConfig) entries.push({ path: configName, bytes: config });
  if (!options.omitManifest) entries.push({ path: "manifest.json", bytes: manifest });
  if (!options.omitLayer) entries.push({ path: layerName, bytes: layer });
  const archive = tar(entries);
  return { archive, config, layer, subject: { role, reference: role === "BASE"
    ? "postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3" : tag,
  imageId: configId, configId, platform: { os: "linux", architecture: "amd64" } } };
}
function lease() {
  const root = "/var/tmp/aw-cl-ABC123"; const nonce = "a".repeat(24);
  return {
    purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    root, nonce, socket: `${root}/endpoint/docker.sock`, endpoint: `unix://${root}/endpoint/docker.sock`,
    dockerConfig: `${root}/client`, buildxConfig: `${root}/client/buildx`, outputDirectory: `${root}/client/output`,
    contextName: `aw-cold-${nonce}`, pid: 4321, startTicks: "1234", daemonId: "isolated-engine", version: "28.0.4",
    deadlineAtMs: 600_000,
    dataRoot: `${root}/infra/data`, execRoot: `${root}/infra/exec`, containerdAddress: "/run/containerd/containerd.sock",
    containersNamespace: `awcold-${nonce}`, pluginsNamespace: `plugins.awcold-${nonce}`,
    configSha256: "b".repeat(64), argvSha256: "c".repeat(64), rootActor: { uid: 0, gid: 0 },
    clientActor: { uid: 1000, gid: 1000 }, socketProof: { dev: "1", ino: "2", uid: 0, gid: 1000, mode: 0o660 },
    socketDirectoryProof: { dev: "1", ino: "3", uid: 0, gid: 1000, mode: 0o710 },
  };
}
function routingRunner(builderNode = {}, builderOutput) {
  return async (request) => {
    const tail = request.args.slice(request.args[2] === "--context" ? 4 : 2); let value = Buffer.alloc(0);
    if (tail[0] === "context" && tail[1] === "create") value = Buffer.from(`${lease().contextName}\n`);
    else if (tail[0] === "context") value = Buffer.from(JSON.stringify([{ Name: lease().contextName,
      Endpoints: { docker: { Host: lease().endpoint } } }]));
    else if (tail[0] === "version") value = Buffer.from(JSON.stringify({ Server: { Version: "28.0.4" } }));
    else if (tail[0] === "info") value = Buffer.from(JSON.stringify({ ID: lease().daemonId,
      DockerRootDir: lease().dataRoot, Driver: "overlay2", OSType: "linux", Architecture: "x86_64",
      Containerd: { Address: lease().containerdAddress, Namespaces: {
        Containers: lease().containersNamespace, Plugins: lease().pluginsNamespace } } }));
    else if (tail[0] === "buildx") value = builderOutput ?? Buffer.from(JSON.stringify({ Driver: "docker",
      Nodes: [{ Name: lease().contextName, Endpoint: lease().endpoint, Status: "running", Buildkit: "v0.24.0",
        Platforms: "linux/amd64", ...builderNode }] }));
    return { exitCode: 0, timedOut: false, stdinBytes: request.stdin?.length ?? 0, stdinEnded: true,
      stdout: value, stderr: Buffer.alloc(0), stdoutBytes: value.length };
  };
}

function profileEnvelope(value) {
  return { encoding: "base64", bytes: value.length, sha256: hash(value), base64: value.toString("base64") };
}

function routingProfileKey(request) {
  const tail = request.args.slice(request.args[2] === "--context" ? 4 : 2);
  if (tail[0] === "context" && tail[1] === "inspect") return "context";
  if (tail[0] === "version") return "version";
  if (tail[0] === "info") return "info";
  if (tail[0] === "buildx" && tail[1] === "inspect") return "builder";
  return undefined;
}

async function observationInternals({ processValue, spawn, fsValues = {}, cryptoValues = {}, archiveValues = {}, candidateValues = {},
  proofValues = {}, timerValues = {}, zlibValues = {} } = {}) {
  const sourcePath = new URL("../scripts/postgres-image/gosu-derivative-image-observation-v2.mjs", import.meta.url);
  const sourceText = `${fs.readFileSync(sourcePath, "utf8")}\nexport { runtimeGuard as __runtimeGuard, defaultRunner as __defaultRunner, closed as __closed };
    export const __probeManifestEntry = (variant) => {
      let reads = 0; const core = { Config: "config.json", RepoTags: [], Layers: ["layer.tar"] }; let value = core;
      if (variant === "symbol") core[Symbol("secret")] = "value";
      if (variant === "coreGetter") Object.defineProperty(core, "Config", { enumerable: true,
        get() { reads += 1; throw new Error("must not read core getter"); } });
      if (variant === "optionalGetter") Object.defineProperty(core, "Parent", { enumerable: true,
        get() { reads += 1; throw new Error("must not read optional getter"); } });
      if (variant === "entryProxy") value = new Proxy(core, { ownKeys() { reads += 1; throw new Error("must not enumerate proxy"); } });
      if (variant === "layerProxy") core.LayerSources = new Proxy({}, {
        getPrototypeOf() { reads += 1; throw new Error("must not inspect proxy"); } });
      if (variant === "nestedGetter") { core.LayerSources = {};
        Object.defineProperty(core.LayerSources, "url", { enumerable: true,
          get() { reads += 1; throw new Error("must not traverse nested metadata"); } }); }
      return { accepted: manifestEntry(value), reads };
    };
    export const __probeArchiveReader = (file, role, control) => defaultArchiveReader({ path: file, role, maximumBytes: ARCHIVE_LIMIT }, control);
    export const __probeInspect = (buffer, subject, control) => inspectSave(buffer, JSON.parse(JSON.stringify(subject)), control);
    export const __probeGzip = (body, diffId, maximum, control) => scanGzipLayerWithControl(body, diffId, maximum, control);
    export const __probeAuthenticateContext = (buffer, control) => authenticateContext(buffer, control);
    export const __probePreflight = (input, dependencies) => {
      const copied = JSON.parse(JSON.stringify(input));
      return { inputExact: exact(copied, ["purpose", "nonce", "lease"]), lease: validateLease(copied.lease, copied.nonce),
        dependenciesPlain: plain(dependencies), acceptance: acceptedContextPreflight(false) };
    };
    const __record = (value) => ({ buffer: value.buffer, identity: { ...value.identity }, physical: { ...value.physical } });
    const __runner = (value) => ({ ...value,
      ...(value.outputPhysical === undefined ? {} : { outputPhysical: { ...value.outputPhysical } }),
      ...(value.outputIdentity === undefined ? {} : { outputIdentity: { ...value.outputIdentity } }) });
    export const __probeRun = (input, dependencies, onFirstRequest) => {
      const copiedInput = JSON.parse(JSON.stringify(input)); let firstRequest = true;
      return runGosuDerivativeImageBuildObservationV2(copiedInput, {
      now: dependencies.now,
      runner: async (request) => {
        if (firstRequest) { firstRequest = false; onFirstRequest?.(copiedInput.lease); }
        return __runner(await dependencies.runner(request));
      },
      contextReader: async (specification, control) => __record(await dependencies.contextReader(specification, control)),
      archiveReader: async (specification, control) => __record(await dependencies.archiveReader(specification, control)),
      });
    };
    export const __probeRunProof = (input, dependencies, onContextClose) => runGosuDerivativeImageBuildProofV1(
      JSON.parse(JSON.stringify(input)), {
        now: dependencies.now,
        runner: async (request) => __runner(await dependencies.runner(request)),
        contextReader: async (specification, control) => {
          const record = __record(await dependencies.contextReader(specification, control));
          if (onContextClose !== undefined) contextSessions.set(record, { guard: () => undefined, close: onContextClose });
          return record;
        },
        archiveReader: async (specification, control) => __record(await dependencies.archiveReader(specification, control)),
      });
    export const __probeRunNonFullyInjected = (input, dependencies) => runGosuDerivativeImageBuildObservationV2(
      JSON.parse(JSON.stringify(input)), {
        now: dependencies.now,
        runner: async (request) => __runner(await dependencies.runner(request)),
        contextReader: async (specification, control) => __record(await dependencies.contextReader(specification, control)),
      });`;
  const context = vm.createContext({ AbortController: globalThis.AbortController, Buffer, TextDecoder, clearTimeout, setTimeout });
  context.process = processValue ?? vm.runInContext(`Object.freeze({ platform: "linux", version: "v22.23.2", env: {},
    getuid: () => 1000, geteuid: () => 1000, getgid: () => 1000, getegid: () => 1000, getgroups: () => [1000] })`, context);
  const synthetic = (identifier, values) => new vm.SyntheticModule(Object.keys(values), function initialize() {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier });
  const unavailable = () => { throw new Error("unexpected fs call"); };
  const nodeFs = { closeSync: unavailable, constants: fs.constants, fstatSync: unavailable, fsyncSync: unavailable,
    linkSync: unavailable, lstatSync: unavailable, openSync: unavailable, readFileSync: unavailable, readSync: unavailable,
    realpathSync: unavailable, statfsSync: unavailable, unlinkSync: unavailable, writeSync: unavailable, ...fsValues };
  const modules = new Map([
    ["node:child_process", synthetic("mock:child", { spawn: spawn ?? (() => { throw new Error("unexpected spawn"); }) })],
    ["node:crypto", synthetic("mock:crypto", { createHash, ...cryptoValues })],
    ["node:fs", synthetic("mock:fs", nodeFs)],
    ["node:path", synthetic("mock:path", { default: path.posix })],
    ["node:stream", synthetic("mock:stream", { Readable })],
    ["node:timers", synthetic("mock:timers", { clearTimeout, setTimeout, ...timerValues })],
    ["node:url", synthetic("mock:url", { fileURLToPath: () => "/repo/scripts/postgres-image/gosu-derivative-image-observation-v2.mjs" })],
    ["node:util", synthetic("mock:util", { isDeepStrictEqual, TextDecoder, types })],
    ["node:zlib", synthetic("mock:zlib", { createGunzip, ...zlibValues })],
    ["./gosu-derivative-candidate-v2.mjs", synthetic("mock:candidate", {
      candidateContractV2: unavailable, openCandidateLockV2: unavailable, validateCandidateContextV2: unavailable, ...candidateValues,
    })],
    ["./gosu-derivative-image-proof-v1.mjs", synthetic("mock:proof", {
      openGosuDerivativeDockerSaveV1: unavailable, proveGosuDerivativeImagePairV1: unavailable, ...proofValues,
    })],
    ["../seaweed-image/archive.mjs", synthetic("mock:archive", {
      scanGzipLayer: unavailable, scanRawUstar: unavailable, ...archiveValues,
    })],
  ]);
  const module = new vm.SourceTextModule(sourceText, { context, identifier: sourcePath.href });
  await module.link((specifier) => modules.get(specifier)); await module.evaluate(); return module.namespace;
}

function runnerRequest(overrides = {}) {
  return { phase: "BUILD", binary: "/usr/bin/docker", args: [], cwd: "/tmp", env: {}, timeoutMs: 50,
    stdin: Buffer.from("authenticated-context"), stdoutMode: "BUFFER", stdoutPath: undefined,
    stdoutLimit: 32, stderrLimit: 32, ...overrides };
}

function fakeChild(mode, fsRecord) {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = new EventEmitter(); child.kills = [];
  child.kill = (signal) => { child.kills.push(signal); if (mode === "timeout" && signal === "SIGTERM") child.emit("close", null, signal); };
  child.stdin.write = (_value, callback) => {
    if (mode === "epipe") void Promise.resolve().then(() => callback(Object.assign(new Error("broken pipe"), { code: "EPIPE" })));
    else if (mode !== "early-close" && mode !== "timeout") void Promise.resolve().then(() => callback());
    return true;
  };
  child.stdin.end = (value, callback) => {
    const done = typeof value === "function" ? value : callback;
    if (mode === "epipe" || mode === "early-close" || mode === "timeout") return undefined;
    void Promise.resolve().then(() => { done();
      if (mode === "file-cap") {
        child.stdout.emit("data", Buffer.alloc(24, 1)); child.stdout.emit("data", Buffer.alloc(24, 2));
      }
      if (mode === "file-success") {
        child.stdout.emit("data", Buffer.from("first-")); child.stdout.emit("data", Buffer.from("second"));
      }
      if (mode === "success") child.stdout.emit("data", Buffer.from("ok"));
      child.emit("close", 0, null);
    });
    return undefined;
  };
  if (mode === "early-close") void Promise.resolve().then(() => child.emit("close", 0, null));
  if (fsRecord) child.fsRecord = fsRecord;
  return child;
}

function acceptanceBuffer(receipts) {
  const value = Buffer.from(JSON.stringify({
    kind: "GOSU_DERIVATIVE_CONTEXT_PRIVATE_ACCEPTANCE_V1",
    source: { head: "582fb97e88cf5a498e6ae34ec76eb5736ada2a47", main: "e4fa47cbe66758a5b56f5347c2c27e61bdae1ed0",
      tree: "7292e98e7ee23e45ebccff075577af41f271dbf9" },
    context: { bytes: 1_986_560, sha256: "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb" },
    checks: { contextTupleEqualAcrossOperationReceiptStreamStat: true, claimPrePostEqual: true, inputsPrePostEqual: true },
    candidateAdmission: "NOT_AUTHORIZED", functionalValidation: "NOT_ESTABLISHED",
    ...(receipts === undefined ? {} : { receipts }),
  }));
  return Buffer.concat([value, Buffer.alloc(11_744 - value.length, 0x20)]);
}

function pinnedCreateHash() {
  const parts = [];
  return { update(value) { parts.push(Buffer.from(value)); return this; }, digest(encoding) {
    const value = Buffer.concat(parts); let result;
    if (value.length === 11_744) result = "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3";
    else if (value.length === 1_986_560) result = "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb";
    else if (value[0] === 0x7b && value.includes(Buffer.from('"marker":"BASE"'))) result = "79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
    else result = createHash("sha256").update(value).digest("hex");
    return encoding === "hex" ? result : Buffer.from(result, "hex");
  } };
}

let baseInspectionApiPromise;
async function inspectOptionalManifestFixture(fixture) {
  if (fixture.subject.role === "CANDIDATE") {
    try { return await inspectGosuDerivativeImageSaveV2(fixture.archive, fixture.subject); }
    catch (error) {
      const detail = gosuDerivativeImageObservationArchiveFailureDetailV1(error);
      throw new Error(`optional manifest rejected ${JSON.stringify(detail)}`, { cause: error });
    }
  }
  baseInspectionApiPromise ??= (async () => {
    const archive = await import("../scripts/seaweed-image/archive.mjs");
    return observationInternals({ cryptoValues: { createHash: pinnedCreateHash },
      archiveValues: { scanRawUstar: archive.scanRawUstar } });
  })();
  const api = await baseInspectionApiPromise;
  const control = { guard: () => undefined, signal: undefined, maximumExpanded: () => 64 * 1024 ** 2,
    consumeExpanded: () => undefined };
  try { return await api.__probeInspect(fixture.archive, fixture.subject, control); }
  catch (error) {
    const detail = api.gosuDerivativeImageObservationArchiveFailureDetailV1(error);
    throw new Error(`optional manifest rejected ${JSON.stringify(detail)}`, { cause: error });
  }
}

async function formatOnlyRoutingVm() {
  const mockedReads = [];
  const api = await observationInternals({
    cryptoValues: { createHash: pinnedCreateHash },
    fsValues: { readFileSync(name) {
      mockedReads.push(String(name));
      if (String(name).endsWith("gosu-derivative-context-private-acceptance-v1.json")) return acceptanceBuffer();
      throw new Error("unexpected VM read");
    } },
  });
  const invoke = (callerLease, dependencies, onFirstRequest) => api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
    nonce: "a".repeat(24), lease: callerLease }, { now: () => 0, ...dependencies }, onFirstRequest);
  return { invoke, mockedReads, diagnostic: api.gosuDerivativeImageObservationFailureDiagnostic };
}

async function nonFullyInjectedPreflightVm(statfsSync) {
  const claim = Buffer.from("FORMAT_ONLY claim receipt"); const success = Buffer.from("FORMAT_ONLY success receipt");
  const receipts = {
    claim: { bytes: claim.length, sha256: hash(claim), path: "/vm/claim.json" },
    success: { bytes: success.length, sha256: hash(success), path: "/vm/success.json" },
  };
  const reads = [];
  const api = await observationInternals({
    cryptoValues: { createHash: pinnedCreateHash },
    fsValues: {
      readFileSync(name, encoding) {
        reads.push(String(name));
        if (name === "/proc/self/status" && encoding === "utf8") return "Groups:\t\nNoNewPrivs:\t1\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\n";
        if (String(name).endsWith("gosu-derivative-context-private-acceptance-v1.json")) return acceptanceBuffer(receipts);
        if (name === receipts.claim.path) return claim;
        if (name === receipts.success.path) return success;
        throw new Error("unexpected VM read");
      },
      statfsSync,
    },
  });
  const invoke = (dependencies) => api.__probeRunNonFullyInjected({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
    nonce: "a".repeat(24), lease: lease() }, { now: () => 0, ...dependencies });
  return { invoke, reads };
}

async function fullInjectedWorkflow({ failAfterBuild = false, readerHashMismatch = false, readerFailureRole,
  readerFailureValue, proofOpenFailureRole, proofPairFailure = false, failBuild = false,
  onProofOpen = () => undefined, onProofPair = () => undefined, timerValues = {} } = {}) {
  const realArchive = await import("../scripts/seaweed-image/archive.mjs");
  const baseId = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
  const candidate = imageSaveFixture(); const base = imageSaveFixture({ role: "BASE", configId: baseId });
  const context = Buffer.alloc(1_986_560); let basePulled = false; let built = false; let imageScans = 0;
  const candidateLockHandle = Object.freeze(Object.create(null)); const proofCalls = { opens: [], pairs: [] };
  const pairProof = Object.freeze({ scope: "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW",
    authority: "NOT_AUTHORIZED", profile: "POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1",
    base: Object.freeze({ archive: Object.freeze({ bytes: base.archive.length, sha256: hash(base.archive) }),
      configId: baseId, layers: 10 }),
    candidate: Object.freeze({ archive: Object.freeze({ bytes: candidate.archive.length, sha256: hash(candidate.archive) }),
      configId: candidate.subject.configId, layers: 12 }),
    inheritedLayers: 10, addedLayers: 2, configProfile: "STRICT_INHERITED_CONFIG_V2",
    delta: Object.freeze({ scope: "FORMAT_ONLY_PROTOCOL_SPY" }) });
  const member = (ordinal) => ({ memberOrdinal: ordinal, uncompressedHeaderOffset: ordinal * 512,
    uncompressedDataOffset: ordinal * 512 + 512, entry: { path: `entry-${ordinal}`, type: "directory", mode: 0o755,
      uid: 0, gid: 0, mtime: 1_700_000_000, size: 0 } });
  const api = await observationInternals({
    cryptoValues: { createHash: pinnedCreateHash },
    fsValues: { readFileSync: (name) => String(name).endsWith("gosu-derivative-context-private-acceptance-v1.json")
      ? acceptanceBuffer() : Buffer.from("lock") },
    candidateValues: { openCandidateLockV2: () => candidateLockHandle, candidateContractV2: () => ({}),
      validateCandidateContextV2: () => ({}) },
    proofValues: {
      async openGosuDerivativeDockerSaveV1(buffer, subject) {
        proofCalls.opens.push({ buffer, subject });
        onProofOpen(subject.role);
        if (subject.role === proofOpenFailureRole) throw new Error("secret proof opener detail");
        return Object.freeze({ role: subject.role });
      },
      proveGosuDerivativeImagePairV1(handle, value) {
        proofCalls.pairs.push({ handle, value });
        onProofPair();
        if (proofPairFailure) throw new Error("secret proof pair detail");
        return pairProof;
      },
    },
    timerValues,
    archiveValues: {
      scanGzipLayer: realArchive.scanGzipLayer,
      scanRawUstar(options) {
        if (options.diffId.endsWith("d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb")) {
          return Promise.resolve({ rawSize: context.length, members: Array.from({ length: 15 }, (_unused, index) => member(index)) });
        }
        imageScans += 1;
        const hostOptions = { ...options }; delete hostOptions.signal; return realArchive.scanRawUstar(hostOptions);
      },
    },
  });
  const route = routingRunner(); const requests = [];
  const dependencies = {
    now: () => 0,
    async runner(request) {
      requests.push(request);
      const tail = request.args.slice(request.args[2] === "--context" ? 4 : 2);
      if (tail[0] === "image" && tail[1] === "pull") basePulled = true;
      if (tail[0] === "buildx" && tail[1] === "build") {
        if (failBuild) throw new Error("secret build failure");
        built = true;
      }
      if (failAfterBuild && built && tail[0] === "image" && tail[1] === "inspect" && String(tail.at(-1)).startsWith("aw-postgres-gosu:")) {
        throw Object.assign(new Error("gosu_derivative_image_observation_stream_invalid"), { phase: "BUILD" });
      }
      let response = await route(request);
      if (tail[0] === "image" && tail[1] === "ls") {
        const ids = built ? [baseId, candidate.subject.imageId] : basePulled ? [baseId] : [];
        const stdout = Buffer.from(ids.length ? `${ids.join("\n")}\n` : ""); response = { ...response, stdout, stdoutBytes: stdout.length };
      } else if (tail[0] === "container" || tail[0] === "volume") {
        response = { ...response, stdout: Buffer.alloc(0), stdoutBytes: 0 };
      } else if (tail[0] === "image" && tail[1] === "inspect") {
        const isCandidate = String(tail.at(-1)).startsWith("aw-postgres-gosu:");
        const stdout = Buffer.from(JSON.stringify({ Id: isCandidate ? candidate.subject.imageId : baseId, Os: "linux", Architecture: "amd64" }));
        response = { ...response, stdout, stdoutBytes: stdout.length };
      } else if (tail[0] === "image" && tail[1] === "save") {
        const selected = String(tail.at(-1)).startsWith("aw-postgres-gosu:") ? candidate : base;
        response = { ...response, stdoutBytes: selected.archive.length, outputPhysical: { dev: "1", size: selected.archive.length },
          outputIdentity: { bytes: selected.archive.length, sha256: hash(selected.archive) } };
      }
      return response;
    },
    contextReader: () => ({ buffer: context, identity: { bytes: context.length,
      sha256: "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb" }, physical: { dev: "1" } }),
    archiveReader: (specification) => { const selected = specification.role === "BASE" ? base : candidate;
      if (specification.role === readerFailureRole) throw readerFailureValue ?? new Error("secret native reader path");
      const mismatchRoles = readerHashMismatch === true ? ["CANDIDATE"]
        : Array.isArray(readerHashMismatch) ? readerHashMismatch : [readerHashMismatch];
      const sha256 = mismatchRoles.includes(specification.role) ? "0".repeat(64) : hash(selected.archive);
      return { buffer: selected.archive, identity: { bytes: selected.archive.length, sha256 }, physical: { dev: "1" } }; },
  };
  return { api, base, candidate, candidateLockHandle, context, dependencies, imageScans: () => imageScans,
    pairProof, proofCalls, requests };
}

const buildProofInput = () => ({
  purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_PROOF_V1",
  nonce: "a".repeat(24),
  lease: lease(),
});

test("observation v2 exports only the five closed public interfaces", async () => {
  const api = await import("../scripts/postgres-image/gosu-derivative-image-observation-v2.mjs");
  assert.deepEqual(Object.keys(api).sort(), [
    "gosuDerivativeImageObservationArchiveFailureDetailV1",
    "gosuDerivativeImageObservationFailureDiagnostic",
    "inspectGosuDerivativeImageSaveV2",
    "runGosuDerivativeImageBuildObservationV2",
    "runGosuDerivativeImageBuildProofV1",
  ]);
});

test("archive failures expose a frozen opt-in detail without changing the historical diagnostic", async () => {
  const fixture = imageSaveFixture(); const checksum = Buffer.from(fixture.archive); checksum[148] ^= 1;
  const failure = await inspectGosuDerivativeImageSaveV2(checksum, fixture.subject).catch((error) => error);
  assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure), {
    version: 1, role: "CANDIDATE", stage: "OUTER_TAR", reason: "seaweed_archive_tar_checksum_invalid",
  });
  assert.deepEqual(gosuDerivativeImageObservationFailureDiagnostic(failure), {
    code: "gosu_derivative_image_observation_archive_invalid", phase: "OBSERVE", state: "UNBUILT",
  });
  const detail = gosuDerivativeImageObservationArchiveFailureDetailV1(failure);
  assert.equal(Object.isFrozen(detail), true);
  assert.deepEqual(Object.keys(detail), ["version", "role", "stage", "reason"]);
});

test("archive detail getter is reflection-free for unknown and hostile inputs", () => {
  let reads = 0; const accessor = {};
  Object.defineProperty(accessor, "message", { get() { reads += 1; throw new Error("secret getter"); } });
  const proxy = new Proxy({}, { get() { reads += 1; throw new Error("secret proxy"); },
    getOwnPropertyDescriptor() { reads += 1; throw new Error("secret descriptor"); } });
  for (const value of [null, undefined, 1, "error", {}, new Error("seaweed_archive_tar_checksum_invalid"), accessor, proxy]) {
    assert.equal(gosuDerivativeImageObservationArchiveFailureDetailV1(value), null);
  }
  assert.equal(reads, 0);
});

test("read failures separate invalid input from bounded size rejection without touching hostile subjects", async () => {
  const fixture = imageSaveFixture(); let reads = 0; const hostile = {};
  Object.defineProperty(hostile, "role", { enumerable: true, get() { reads += 1; throw new Error("secret role"); } });
  let failure = await inspectGosuDerivativeImageSaveV2(new Proxy(fixture.archive, {}), hostile).catch((error) => error);
  assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
    { version: 1, role: "UNKNOWN", stage: "READ", reason: "READ_INVALID" });
  failure = await inspectGosuDerivativeImageSaveV2(Buffer.alloc(0), fixture.subject).catch((error) => error);
  assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
    { version: 1, role: "CANDIDATE", stage: "READ", reason: "SIZE_INVALID" });
  assert.equal(reads, 0);
});

test("outer USTAR failures retain only finite scanner reasons", async () => {
  const fixture = imageSaveFixture(); const checksum = Buffer.from(fixture.archive); checksum[148] ^= 1;
  const cases = [
    [checksum, "seaweed_archive_tar_checksum_invalid"],
    [fixture.archive.subarray(0, -BLOCK), "seaweed_archive_tar_eoa_invalid"],
    [tar([{ path: "../escape", bytes: Buffer.from("x") }]), "seaweed_archive_tar_path_invalid"],
    [tar([{ path: "link", type: "2" }]), "seaweed_archive_tar_link_invalid"],
    [tar([{ path: "same", bytes: Buffer.from("a") }, { path: "same", bytes: Buffer.from("b") }]),
      "seaweed_archive_tar_duplicate_invalid"],
  ];
  for (const [archive, reason] of cases) {
    const failure = await inspectGosuDerivativeImageSaveV2(archive, fixture.subject).catch((error) => error);
    assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
      { version: 1, role: "CANDIDATE", stage: "OUTER_TAR", reason });
  }
});

test("manifest and config failures distinguish member, JSON, schema, size and identity branches", async () => {
  const malformedConfig = Buffer.from("{");
  const fixtures = [
    [diagnosticSaveFixture({ omitManifest: true }), "MANIFEST", "MEMBER_INVALID"],
    [diagnosticSaveFixture({ manifestBytes: Buffer.from("{") }), "MANIFEST", "JSON_INVALID"],
    [diagnosticSaveFixture({ manifestValue: [] }), "MANIFEST", "SCHEMA_INVALID"],
    [diagnosticSaveFixture({ manifestBytes: Buffer.alloc(4 * 1024 ** 2 + 1, 0x20) }), "MANIFEST", "SIZE_INVALID"],
    [diagnosticSaveFixture({ omitConfig: true }), "CONFIG", "MEMBER_INVALID"],
    [diagnosticSaveFixture({ configBytes: malformedConfig }), "CONFIG", "JSON_INVALID"],
    [diagnosticSaveFixture({ configValue: { architecture: "amd64", os: "linux", rootfs: null } }),
      "CONFIG", "SCHEMA_INVALID"],
  ];
  for (const [fixture, stage, reason] of fixtures) {
    const failure = await inspectGosuDerivativeImageSaveV2(fixture.archive, fixture.subject).catch((error) => error);
    assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
      { version: 1, role: "CANDIDATE", stage, reason });
  }
  const fixture = diagnosticSaveFixture();
  const failure = await inspectGosuDerivativeImageSaveV2(fixture.archive,
    { ...fixture.subject, imageId: `sha256:${"0".repeat(64)}` }).catch((error) => error);
  assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
    { version: 1, role: "CANDIDATE", stage: "CONFIG", reason: "IDENTITY_MISMATCH" });
});

test("manifest compatibility remains closed for missing core, unknown keys and wrong optional types", async () => {
  const cases = [
    { omitManifestFields: ["Config"] }, { omitManifestFields: ["RepoTags"] }, { omitManifestFields: ["Layers"] },
    { manifestExtras: { Unknown: true } }, { manifestExtras: { Parent: null } },
    { manifestExtras: { Parent: {} } }, { manifestExtras: { Parent: [] } }, { manifestExtras: { Parent: 1 } },
    { manifestExtras: { LayerSources: null } }, { manifestExtras: { LayerSources: [] } },
    { manifestExtras: { LayerSources: "remote" } }, { manifestExtras: { LayerSources: 1 } },
  ];
  for (const options of cases) {
    const fixture = diagnosticSaveFixture(options);
    const failure = await inspectGosuDerivativeImageSaveV2(fixture.archive, fixture.subject).catch((error) => error);
    assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
      { version: 1, role: "CANDIDATE", stage: "MANIFEST", reason: "SCHEMA_INVALID" });
  }
});

const manifestCompatibilityRoles = typeof vm.SourceTextModule === "function" ? ["BASE", "CANDIDATE"] : ["CANDIDATE"];
for (const role of manifestCompatibilityRoles) {
  for (const encoding of ["USTAR", "GZIP"]) {
    test(`image layer hardlinks accept the bounded existing subset for ${encoding} ${role}`, async () => {
      const fixture = hardlinkImageSaveFixture({ role, encoding });
      const observed = await inspectOptionalManifestFixture(fixture);
      const projected = JSON.parse(JSON.stringify(observed));
      assert.equal(projected.state, "FORMAT_OBSERVED_ONLY");
      assert.equal(projected.subject.role, role);
      assert.equal(projected.archive.sha256, hash(fixture.archive));
      assert.deepEqual(projected.layers[0], {
        ordinal: 0,
        path: projected.layers[0].path,
        storedBytes: fixture.storedLayer.length,
        storedSha256: hash(fixture.storedLayer),
        encoding,
        expandedBytes: fixture.rawLayer.length,
        diffId: digest(fixture.rawLayer),
        members: projected.layers[0].members,
      });
      assert.equal(projected.layers[0].members.length, 2);
      assert.equal(projected.layers[0].members[0].type, "file");
      assert.equal(projected.layers[0].members[0].sha256, hash(Buffer.from("FORMAT_ONLY hardlink target\n")));
      assert.equal(projected.layers[0].members[1].type, "hardlink");
      assert.equal(projected.layers[0].members[1].size, 0);
      assert.equal(projected.layers[0].members[1].mode, projected.layers[0].members[0].mode);
      assert.equal(projected.layers[0].members[1].uid, projected.layers[0].members[0].uid);
      assert.equal(projected.layers[0].members[1].gid, projected.layers[0].members[0].gid);
      assert.equal(projected.layers[0].members[1].mtime, projected.layers[0].members[0].mtime);
      assert.deepEqual(Object.keys(projected.layers[0].members[1]).sort(),
        ["dataOffset", "gid", "headerOffset", "mode", "mtime", "ordinal", "path", "size", "type", "uid"]);
      assert.doesNotMatch(JSON.stringify(projected.layers[0].members[1]), /linkname|usr\/local\/bin\/tool/u);
      assert.deepEqual(Object.keys(projected).sort(),
        ["archive", "config", "layers", "manifest", "predicates", "state", "subject"]);
    });
  }
}

test("image layer hardlink opt-in keeps unsafe cases closed for raw and gzip layers", async () => {
  const target = { path: "target", bytes: Buffer.from("target") };
  const cases = [
    ["forward", [{ path: "alias", type: "1", linkname: "target" }, target], "seaweed_archive_tar_link_invalid"],
    ["missing", [target, { path: "alias", type: "1", linkname: "missing" }], "seaweed_archive_tar_link_invalid"],
    ["self", [target, { path: "alias", type: "1", linkname: "alias" }], "seaweed_archive_tar_link_invalid"],
    ["chained", [target, { path: "first", type: "1", linkname: "target" },
      { path: "second", type: "1", linkname: "first" }], "seaweed_archive_tar_link_invalid"],
    ["absolute", [target, { path: "alias", type: "1", linkname: "/target" }], "seaweed_archive_tar_link_invalid"],
    ["traversal", [target, { path: "alias", type: "1", linkname: "../target" }], "seaweed_archive_tar_link_invalid"],
    ["metadata", [target, { path: "alias", type: "1", linkname: "target", mode: 0o600 }],
      "seaweed_archive_tar_link_invalid"],
    ["payload", [target, { path: "alias", type: "1", linkname: "target", bytes: Buffer.from("x") }],
      "seaweed_archive_tar_header_invalid"],
    ["duplicate", [target, { path: "target", type: "1", linkname: "target" }],
      "seaweed_archive_tar_duplicate_invalid"],
    ["unsupported", [{ path: "unsupported", type: "x" }], "seaweed_archive_tar_type_invalid"],
  ];
  for (const encoding of ["USTAR", "GZIP"]) {
    for (const [label, entries, reason] of cases) {
      const fixture = hardlinkImageSaveFixture({ role: "CANDIDATE", encoding, entries });
      const failure = await inspectGosuDerivativeImageSaveV2(fixture.archive, fixture.subject).catch((error) => error);
      assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
        { version: 1, role: "CANDIDATE", stage: "LAYER", reason }, `${encoding} ${label}`);
    }
    const mismatch = hardlinkImageSaveFixture({ role: "CANDIDATE", encoding, diffId: `sha256:${"0".repeat(64)}` });
    const failure = await inspectGosuDerivativeImageSaveV2(mismatch.archive, mismatch.subject).catch((error) => error);
    assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
      { version: 1, role: "CANDIDATE", stage: "LAYER", reason: "seaweed_archive_diffid_mismatch" });
  }
});

test("Docker-save outer archives remain strict when an outer member is a hardlink", async () => {
  const fixture = imageSaveFixture();
  const archive = tar([{ path: "target", bytes: Buffer.from("target") },
    { path: "alias", type: "1", linkname: "target" }]);
  const failure = await inspectGosuDerivativeImageSaveV2(archive, fixture.subject).catch((error) => error);
  assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
    { version: 1, role: "CANDIDATE", stage: "OUTER_TAR", reason: "seaweed_archive_tar_type_invalid" });
});

test("authenticated build contexts keep hardlinks disabled", { skip: typeof vm.SourceTextModule !== "function" }, async () => {
  let options;
  const api = await observationInternals({ cryptoValues: { createHash: pinnedCreateHash },
    archiveValues: { scanRawUstar: async (value) => { options = value;
      throw new Error("seaweed_archive_tar_type_invalid"); } } });
  await assert.rejects(api.__probeAuthenticateContext(Buffer.alloc(1_986_560),
    { guard: () => undefined, signal: undefined }), /gosu_derivative_image_observation_context_invalid/u);
  assert.equal(options.allowHardlinks, false);
});

for (const role of manifestCompatibilityRoles) {
  for (const [label, manifestExtras] of [
    ["Parent", { Parent: "sha256:parent-metadata-only" }],
    ["LayerSources", { LayerSources: { "sha256:diff-id": { mediaType: "application/vnd.test", size: 7 } } }],
    ["Parent and LayerSources", { Parent: "sha256:parent-metadata-only",
      LayerSources: { "sha256:diff-id": { mediaType: "application/vnd.test", size: 7 } } }],
  ]) {
    test(`Docker-save manifest accepts optional ${label} metadata for ${role}`, async () => {
      const fixture = diagnosticSaveFixture({ role, manifestExtras,
        ...(role === "BASE" ? { configMarker: "BASE",
          configId: "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537" } : {}) });
      const observed = await inspectOptionalManifestFixture(fixture);
      assert.equal(observed.state, "FORMAT_OBSERVED_ONLY");
      assert.equal(observed.subject.role, role);
    });
  }
}

test("manifest optional metadata keeps its values opaque while full-byte hashes remain binding", async () => {
  const marker = "OPTIONAL_METADATA_MUST_NOT_PROJECT"; const url = "https://metadata.invalid/must-not-fetch";
  const core = diagnosticSaveFixture();
  const optional = diagnosticSaveFixture({ manifestExtras: { Parent: marker,
    LayerSources: { "sha256:diff-id": { url, marker } } } });
  const [coreObserved, optionalObserved] = await Promise.all([
    inspectGosuDerivativeImageSaveV2(core.archive, core.subject),
    inspectGosuDerivativeImageSaveV2(optional.archive, optional.subject),
  ]);
  assert.notEqual(optionalObserved.archive.sha256, coreObserved.archive.sha256);
  assert.notEqual(optionalObserved.manifest.sha256, coreObserved.manifest.sha256);
  assert.deepEqual(Object.keys(optionalObserved.manifest).sort(), ["config", "layers", "path", "repoTags", "sha256"]);
  assert.doesNotMatch(JSON.stringify(optionalObserved), new RegExp(`${marker}|metadata\\.invalid`, "u"));
});

test("layer failures retain finite detail while OPAQUE success remains unchanged", async () => {
  const missing = diagnosticSaveFixture({ omitLayer: true });
  let failure = await inspectGosuDerivativeImageSaveV2(missing.archive, missing.subject).catch((error) => error);
  assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
    { version: 1, role: "CANDIDATE", stage: "LAYER", reason: "MEMBER_INVALID" });
  const layer = tar([{ path: "file", bytes: Buffer.from("body") }]);
  const mismatch = diagnosticSaveFixture({ layer,
    configValue: { architecture: "amd64", os: "linux", rootfs: { type: "layers", diff_ids: [digest(Buffer.from("other"))] } } });
  failure = await inspectGosuDerivativeImageSaveV2(mismatch.archive, mismatch.subject).catch((error) => error);
  assert.deepEqual(gosuDerivativeImageObservationArchiveFailureDetailV1(failure),
    { version: 1, role: "CANDIDATE", stage: "LAYER", reason: "seaweed_archive_diffid_mismatch" });
  const opaque = diagnosticSaveFixture({ layer: Buffer.from("opaque FORMAT_ONLY bytes") });
  const observed = await inspectGosuDerivativeImageSaveV2(opaque.archive, opaque.subject);
  assert.deepEqual(observed.layers[0], { ordinal: 0, path: observed.layers[0].path,
    storedBytes: opaque.layer.length, storedSha256: hash(opaque.layer), encoding: "OPAQUE",
    expandedBytes: "NOT_ESTABLISHED", diffId: "NOT_ESTABLISHED", members: "NOT_ESTABLISHED" });
  assert.deepEqual(observed.predicates,
    { functional: "NOT_ESTABLISHED", vulnerabilities: "NOT_ESTABLISHED", candidateAdmission: "NOT_ESTABLISHED" });
});

test("FORMAT_ONLY Docker save observation parses a real small USTAR without claiming image acceptance", async () => {
  const fixture = imageSaveFixture();
  const observed = await inspectGosuDerivativeImageSaveV2(fixture.archive, fixture.subject);
  assert.equal(observed.subject.role, "CANDIDATE");
  assert.equal(observed.subject.imageId, fixture.subject.imageId);
  assert.equal(observed.archive.bytes, fixture.archive.length);
  assert.equal(observed.archive.sha256, hash(fixture.archive));
  assert.equal(observed.layers[0].expandedBytes, fixture.layer.length);
  assert.doesNotMatch(JSON.stringify(observed), /ACCEPTED|AUTHORIZED|FUNCTIONAL|VULNERABILITY_PASSED/u);
});

test("save observation rejects non-native bytes before reading subject getters", async () => {
  const fixture = imageSaveFixture(); let reads = 0; const hostile = {};
  Object.defineProperty(hostile, "role", { enumerable: true, get() { reads += 1; throw new Error("caller getter"); } });
  await assert.rejects(inspectGosuDerivativeImageSaveV2(new Proxy(fixture.archive, {}), hostile));
  assert.equal(reads, 0);
});

test("save observation rejects checksum, EOF, traversal, links and duplicate members independently", async () => {
  const fixture = imageSaveFixture();
  const checksum = Buffer.from(fixture.archive); checksum[148] ^= 1;
  const cases = [
    checksum,
    fixture.archive.subarray(0, -BLOCK),
    tar([{ path: "../escape", bytes: Buffer.from("x") }]),
    tar([{ path: "link", type: "2" }]),
    tar([{ path: "same", bytes: Buffer.from("a") }, { path: "same", bytes: Buffer.from("b") }]),
  ];
  for (const archive of cases) await assert.rejects(inspectGosuDerivativeImageSaveV2(archive, fixture.subject));
});

test("save observation rejects changed image identity and oversized selected JSON", async () => {
  const fixture = imageSaveFixture();
  await assert.rejects(inspectGosuDerivativeImageSaveV2(fixture.archive,
    { ...fixture.subject, imageId: `sha256:${"0".repeat(64)}` }));
  const huge = tar([{ path: `${"0".repeat(64)}.json`, bytes: Buffer.alloc(4 * 1024 ** 2 + 1, 0x20) },
    { path: "manifest.json", bytes: Buffer.from("[]") }]);
  await assert.rejects(inspectGosuDerivativeImageSaveV2(huge, fixture.subject));
});

test("wrong lease routing fails before context open or any build command", async () => {
  let contextReads = 0; const phases = [];
  const badLease = { purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION", root: "/var/tmp/aw-cl-ABC123",
    endpoint: "unix:///var/run/docker.sock", contextName: `aw-gosu-${"a".repeat(24)}` };
  await assert.rejects(runGosuDerivativeImageBuildObservationV2({
    purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION", nonce: "a".repeat(24), lease: badLease,
  }, {
    now: () => 0,
    contextReader() { contextReads += 1; throw new Error("must not read"); },
    archiveReader() { throw new Error("must not read archive"); },
    runner(request) { phases.push(request.phase); throw new Error("must not run"); },
  }));
  assert.equal(contextReads, 0);
  assert.deepEqual(phases, []);
});

test("observation diagnostics remain closed and never expose hostile exceptions", () => {
  let reads = 0; const diagnostic = gosuDerivativeImageObservationFailureDiagnostic({
    get message() { reads += 1; return "secret path token stdout"; },
  }, "BUILD");
  assert.equal(reads, 1);
  assert.deepEqual(Object.keys(diagnostic).sort(), ["code", "phase", "state"]);
  assert.equal(diagnostic.state, "UNBUILT");
  assert.match(diagnostic.code, /^gosu_derivative_image_observation_/u);
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret|path|token|stdout/u);
});

if (typeof vm.SourceTextModule !== "function") {
  test("observation runtime probes relaunch with VM modules enabled", () => {
    const environment = { ...process.env, AUTO_WORLD_GOSU_OBSERVATION_VM: "1" }; delete environment.NODE_TEST_CONTEXT;
    const result = childProcess.spawnSync(process.execPath, ["--experimental-vm-modules", "--test", SELF], {
      env: environment, encoding: "utf8", timeout: 60_000,
    });
    const count = /# tests (\d+)/u.exec(result.stdout); const transcript = `${result.stdout}\n${result.stderr}`;
    assert.ok(count && Number(count[1]) > 15, transcript); assert.equal(result.status, 0, transcript);
  });
} else {
  test("manifest compatibility rejects descriptors, symbols and proxies without traversing metadata", async () => {
    const api = await observationInternals();
    assert.deepEqual(JSON.parse(JSON.stringify(api.__probeManifestEntry("plain"))), { accepted: true, reads: 0 });
    assert.deepEqual(JSON.parse(JSON.stringify(api.__probeManifestEntry("nestedGetter"))),
      { accepted: true, reads: 0 });
    for (const variant of ["symbol", "coreGetter", "optionalGetter", "entryProxy", "layerProxy"]) {
      assert.deepEqual(JSON.parse(JSON.stringify(api.__probeManifestEntry(variant))), { accepted: false, reads: 0 });
    }
  });

  test("scanner messages require an own data descriptor and a finite allowlist", async () => {
    const subject = imageSaveFixture().subject; const control = { guard: () => undefined, signal: undefined,
      maximumExpanded: () => 1024, consumeExpanded: () => undefined };
    let reads = 0; const forged = { message: "seaweed_archive_tar_checksum_invalid" };
    const inherited = Object.create({ message: "seaweed_archive_tar_checksum_invalid" });
    const accessor = {}; Object.defineProperty(accessor, "message", { get() { reads += 1; return "seaweed_archive_tar_checksum_invalid"; } });
    const proxy = new Proxy(new Error("seaweed_archive_tar_checksum_invalid"), {
      get() { reads += 1; throw new Error("secret proxy"); },
      getOwnPropertyDescriptor() { reads += 1; throw new Error("secret descriptor"); },
    });
    const cases = [[new Error("seaweed_archive_tar_checksum_invalid"), "seaweed_archive_tar_checksum_invalid"],
      [new Error("secret native path token"), "UNKNOWN"], [forged, "UNKNOWN"], [inherited, "UNKNOWN"],
      [accessor, "UNKNOWN"], [proxy, "UNKNOWN"]];
    for (const [thrown, reason] of cases) {
      const api = await observationInternals({ archiveValues: { scanRawUstar: async () => { throw thrown; } } });
      const failure = await api.__probeInspect(Buffer.from("FORMAT_ONLY"), subject, control).catch((error) => error);
      assert.deepEqual(JSON.parse(JSON.stringify(api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure))),
        { version: 1, role: "CANDIDATE", stage: "OUTER_TAR", reason });
      assert.doesNotMatch(JSON.stringify(api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure)), /secret|path|token/u);
    }
    assert.equal(reads, 2);
  });

  test("scanner preserves historical codes from plain, inherited, and accessor messages without archive detail", async () => {
    const code = "gosu_derivative_image_observation_deadline_exceeded";
    const inherited = Object.create({ message: code });
    const accessor = {}; Object.defineProperty(accessor, "message", { get: () => code });
    for (const thrown of [{ message: code }, inherited, accessor]) {
      const api = await observationInternals({ archiveValues: { scanRawUstar: async () => { throw thrown; } } });
      const failure = await api.__probeInspect(Buffer.from("FORMAT_ONLY"), imageSaveFixture().subject,
        { guard: () => undefined, signal: undefined, maximumExpanded: () => 1024,
          consumeExpanded: () => undefined }).catch((error) => error);
      assert.deepEqual(JSON.parse(JSON.stringify(api.gosuDerivativeImageObservationFailureDiagnostic(failure, "OBSERVE"))),
        { code, phase: "OBSERVE", state: "UNBUILT" });
      assert.equal(api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure), null);
    }
  });

  test("expansion-bound failures retain a local LAYER reason", async () => {
    const realArchive = await import("../scripts/seaweed-image/archive.mjs"); const fixture = imageSaveFixture();
    const api = await observationInternals({ archiveValues: { scanRawUstar: realArchive.scanRawUstar } });
    const control = { guard: () => undefined, signal: undefined,
      maximumExpanded() { throw new Error("private expansion budget"); }, consumeExpanded: () => undefined };
    const failure = await api.__probeInspect(fixture.archive, fixture.subject, control).catch((error) => error);
    assert.deepEqual(JSON.parse(JSON.stringify(api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure))),
      { version: 1, role: "CANDIDATE", stage: "LAYER", reason: "EXPANSION_LIMIT" });
  });

  test("native archive-invalid expansion limits retain their historical code and local detail", async () => {
    const realArchive = await import("../scripts/seaweed-image/archive.mjs"); const fixture = imageSaveFixture();
    const code = "gosu_derivative_image_observation_archive_invalid";
    for (const point of ["maximum", "consume"]) {
      const api = await observationInternals({ archiveValues: { scanRawUstar: realArchive.scanRawUstar } });
      const control = { guard: () => undefined, signal: undefined,
        maximumExpanded() { if (point === "maximum") throw new Error(code); return 1024 ** 2; },
        consumeExpanded() { if (point === "consume") throw new Error(code); } };
      const failure = await api.__probeInspect(fixture.archive, fixture.subject, control).catch((error) => error);
      assert.deepEqual(JSON.parse(JSON.stringify(api.gosuDerivativeImageObservationFailureDiagnostic(failure, "OBSERVE"))),
        { code, phase: "OBSERVE", state: "UNBUILT" });
      assert.deepEqual(JSON.parse(JSON.stringify(api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure))),
        { version: 1, role: "CANDIDATE", stage: "LAYER", reason: "EXPANSION_LIMIT" });
    }
  });

  test("native non-archive and forged archive-invalid expansion codes remain unbranded", async () => {
    const realArchive = await import("../scripts/seaweed-image/archive.mjs"); const fixture = imageSaveFixture();
    const cases = [new Error("gosu_derivative_image_observation_deadline_exceeded"),
      { message: "gosu_derivative_image_observation_archive_invalid" },
      Object.create(Error.prototype, { message: { value: "gosu_derivative_image_observation_archive_invalid" } })];
    for (const thrown of cases) {
      const api = await observationInternals({ archiveValues: { scanRawUstar: realArchive.scanRawUstar } });
      const control = { guard: () => undefined, signal: undefined,
        maximumExpanded() { throw thrown; }, consumeExpanded: () => undefined };
      const failure = await api.__probeInspect(fixture.archive, fixture.subject, control).catch((error) => error);
      assert.equal(failure, thrown);
      assert.equal(api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure), null);
    }
  });

  test("expansion preserves pre-existing closed rejection codes", async () => {
    const realArchive = await import("../scripts/seaweed-image/archive.mjs"); const fixture = imageSaveFixture();
    for (const code of ["gosu_derivative_image_observation_input_invalid",
      "gosu_derivative_image_observation_runtime_invalid", "gosu_derivative_image_observation_routing_invalid",
      "gosu_derivative_image_observation_context_invalid", "gosu_derivative_image_observation_command_failed",
      "gosu_derivative_image_observation_stream_invalid", "gosu_derivative_image_observation_archive_invalid",
      "gosu_derivative_image_observation_identity_invalid", "gosu_derivative_image_observation_deadline_exceeded"]) {
      const api = await observationInternals({ archiveValues: { scanRawUstar: realArchive.scanRawUstar } });
      const control = { guard: () => undefined, signal: undefined,
        maximumExpanded() { throw { message: code }; }, consumeExpanded: () => undefined };
      const failure = await api.__probeInspect(fixture.archive, fixture.subject, control).catch((error) => error);
      assert.deepEqual(JSON.parse(JSON.stringify(api.gosuDerivativeImageObservationFailureDiagnostic(failure, "OBSERVE"))),
        { code, phase: "OBSERVE", state: "UNBUILT" });
      assert.equal(api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure), null);
    }
  });

  test("post-build archive reader preserves historical plain-object rejection codes", async () => {
    const code = "gosu_derivative_image_observation_deadline_exceeded";
    const fixture = await fullInjectedWorkflow({ readerFailureRole: "BASE", readerFailureValue: { message: code } });
    const failure = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
      nonce: "a".repeat(24), lease: lease() }, fixture.dependencies).catch((error) => error);
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.api.gosuDerivativeImageObservationFailureDiagnostic(failure))),
      { code, phase: "OBSERVE", state: "MAY_HAVE_BEEN_BUILT" });
    assert.equal(fixture.api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure), null);
  });

  test("post-build BASE and CANDIDATE read failures retain role without raw error text", async () => {
    for (const role of ["BASE", "CANDIDATE"]) {
      const fixture = await fullInjectedWorkflow({ readerFailureRole: role });
      const failure = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
        nonce: "a".repeat(24), lease: lease() }, fixture.dependencies).catch((error) => error);
      assert.deepEqual(JSON.parse(JSON.stringify(fixture.api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure))),
        { version: 1, role, stage: "READ", reason: "READ_INVALID" });
      assert.deepEqual(JSON.parse(JSON.stringify(fixture.api.gosuDerivativeImageObservationFailureDiagnostic(failure))),
        { code: "gosu_derivative_image_observation_input_invalid", phase: "OBSERVE", state: "MAY_HAVE_BEEN_BUILT" });
      assert.doesNotMatch(JSON.stringify(fixture.api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure)), /secret|path/u);
    }
  });

  test("archive identity binding reports the first failing role deterministically", async () => {
    for (const [mismatch, role] of [["BASE", "BASE"], ["CANDIDATE", "CANDIDATE"], [["BASE", "CANDIDATE"], "BASE"]]) {
      const fixture = await fullInjectedWorkflow({ readerHashMismatch: mismatch });
      const failure = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
        nonce: "a".repeat(24), lease: lease() }, fixture.dependencies).catch((error) => error);
      assert.deepEqual(JSON.parse(JSON.stringify(fixture.api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure))),
        { version: 1, role, stage: "BIND", reason: "IDENTITY_MISMATCH" });
      assert.deepEqual(JSON.parse(JSON.stringify(fixture.api.gosuDerivativeImageObservationFailureDiagnostic(failure))),
        { code: "gosu_derivative_image_observation_archive_invalid", phase: "OBSERVE", state: "MAY_HAVE_BEEN_BUILT" });
    }
  });

  test("runtime accepts cleared supplementary groups when getgroups retains primary gid 1000", async () => {
    const status = "Groups:\t\nNoNewPrivs:\t1\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\n";
    const api = await observationInternals({ fsValues: { readFileSync: (name, encoding) => {
      assert.equal(name, "/proc/self/status"); assert.equal(encoding, "utf8"); return status;
    } } });
    assert.doesNotThrow(() => api.__runtimeGuard());
  });

  test("ordinary runtime preflight checks root and output space without traversing private data root", async () => {
    const targets = []; let dataRootCalls = 0; let runnerCalls = 0; let contextReads = 0;
    const fixture = await nonFullyInjectedPreflightVm((target, options) => {
      targets.push(target); assert.equal(options.bigint, true); assert.deepEqual(Object.keys(options), ["bigint"]);
      if (target === lease().dataRoot) { dataRootCalls += 1; throw Object.assign(new Error("denied"), { code: "EACCES" }); }
      return { bavail: 16n * 1024n ** 3n, bsize: 1n };
    });
    let failure;
    try {
      await fixture.invoke({
        runner() { runnerCalls += 1; throw new Error("gosu_derivative_image_observation_routing_invalid"); },
        contextReader() { contextReads += 1; throw new Error("context must remain closed"); },
      });
      assert.fail("expected bounded routing stop");
    } catch (error) { failure = error; }
    assert.equal(failure.message, "gosu_derivative_image_observation_routing_invalid"); assert.equal(failure.phase, "ROUTING");
    assert.deepEqual(targets, [lease().root, lease().outputDirectory]);
    assert.equal(dataRootCalls, 0); assert.equal(runnerCalls, 1); assert.equal(contextReads, 0);
  });

  test("low space on either accessible target fails before runner, context or private data root", async () => {
    for (const [lowTarget, expectedTargets] of [[lease().root, [lease().root]],
      [lease().outputDirectory, [lease().root, lease().outputDirectory]]]) {
      const targets = []; let dataRootCalls = 0; let runnerCalls = 0; let contextReads = 0;
      const fixture = await nonFullyInjectedPreflightVm((target) => {
        targets.push(target);
        if (target === lease().dataRoot) { dataRootCalls += 1; throw Object.assign(new Error("denied"), { code: "EACCES" }); }
        return target === lowTarget ? { bavail: 1n, bsize: 1n } : { bavail: 16n * 1024n ** 3n, bsize: 1n };
      });
      let failure;
      try {
        await fixture.invoke({
          runner() { runnerCalls += 1; throw new Error("runner must remain closed"); },
          contextReader() { contextReads += 1; throw new Error("context must remain closed"); },
        });
        assert.fail("expected low-space failure");
      } catch (error) { failure = error; }
      assert.equal(failure.message, "gosu_derivative_image_observation_runtime_invalid"); assert.equal(failure.phase, "PREFLIGHT");
      assert.deepEqual(targets, expectedTargets);
      assert.equal(dataRootCalls, 0); assert.equal(runnerCalls, 0); assert.equal(contextReads, 0);
    }
  });

  test("VM routing rejects builder endpoint mismatch before context without native private reads", async () => {
    const fixture = await formatOnlyRoutingVm(); let contextReads = 0;
    await assert.rejects(fixture.invoke(lease(), {
      runner: routingRunner({ Endpoint: "unix:///var/run/docker.sock" }),
      contextReader() { contextReads += 1; throw new Error("context must remain closed"); },
      archiveReader() { throw new Error("archive must remain closed"); },
    }), /gosu_derivative_image_observation_routing_invalid/u);
    assert.equal(contextReads, 0); assert.equal(fixture.mockedReads.length, 1);
    assert.ok(fixture.mockedReads[0].endsWith("gosu-derivative-context-private-acceptance-v1.json"));
  });

  test("VM routing rejects ambiguous native Buildx text before context", async () => {
    const fixture = await formatOnlyRoutingVm();
    const valid = `Name: ${lease().contextName}\nDriver: docker\nNodes:\nName: ${lease().contextName}\nEndpoint: ${lease().endpoint}\nStatus: running\nBuildKit version: v0.24.0\nPlatforms: linux/amd64\n`;
    const cases = [`${valid}Driver: docker\n`, `${valid}Unknown field: forbidden\n`,
      `${valid}Name: second\nEndpoint: unix:///var/run/docker.sock\nStatus: running\nBuildKit version: v0.24.0\nPlatforms: linux/amd64\n`];
    for (const output of cases) {
      let contextReads = 0;
      await assert.rejects(fixture.invoke(lease(), {
        runner: routingRunner({}, Buffer.from(output)),
        contextReader() { contextReads += 1; throw new Error("context must remain closed"); },
        archiveReader() { throw new Error("archive must remain closed"); },
      }), /gosu_derivative_image_observation_routing_invalid/u);
      assert.equal(contextReads, 0);
    }
  });

  test("VM native Buildx routes one node to context and rejects a second node first", async () => {
    const fixture = await formatOnlyRoutingVm();
    const valid = `Name: ${lease().contextName}\nDriver: docker\nNodes:\nName: ${lease().contextName}\nEndpoint: ${lease().endpoint}\nStatus: running\nBuildKit version: v0.24.0\nPlatforms: linux/amd64\n`;
    for (const [output, expectedReads] of [[valid, 1], [`${valid}Name: second\nEndpoint: unix:///var/run/docker.sock\nStatus: running\nBuildKit version: v0.24.0\nPlatforms: linux/amd64\n`, 0]]) {
      let contextReads = 0;
      await assert.rejects(fixture.invoke(lease(), {
        runner: routingRunner({}, Buffer.from(output)),
        contextReader() { contextReads += 1; throw new Error("bounded stop"); },
        archiveReader() { throw new Error("archive must remain closed"); },
      }));
      assert.equal(contextReads, expectedReads);
    }
  });

  test("VM caller lease mutation during await cannot change later routing or paths", async () => {
    const fixture = await formatOnlyRoutingVm(); const callerLease = lease(); const original = JSON.parse(JSON.stringify(callerLease));
    const requests = []; const route = routingRunner(); let contextReads = 0; let mutationApplied = false;
    await assert.rejects(fixture.invoke(callerLease, {
      async runner(request) {
        requests.push(request);
        return route(request);
      },
      contextReader() { contextReads += 1; throw new Error("bounded stop"); },
      archiveReader() { throw new Error("archive must remain closed"); },
    }, (vmLease) => {
      vmLease.outputDirectory = "/tmp/attacker"; vmLease.dockerConfig = "/tmp/config";
      vmLease.contextName = "attacker"; vmLease.deadlineAtMs = 1; mutationApplied = true;
      assert.equal(vmLease.outputDirectory, "/tmp/attacker"); assert.equal(vmLease.contextName, "attacker");
    }));
    assert.equal(mutationApplied, true); assert.equal(contextReads, 1); assert.ok(requests.length > 1);
    for (const request of requests) { assert.equal(request.cwd, original.outputDirectory);
      assert.equal(request.args.includes("attacker"), false); assert.equal(request.args.includes("/tmp/config"), false); }
  });

  test("VM context reader receives the closed immutable fixed specification", async () => {
    const fixture = await formatOnlyRoutingVm(); let specification;
    await assert.rejects(fixture.invoke(lease(), {
      runner: routingRunner(),
      contextReader(value) { specification = value; return { buffer: Buffer.alloc(1), identity: {}, physical: {} }; },
      archiveReader() { throw new Error("archive must remain closed"); },
    }));
    assert.ok(specification && typeof specification === "object"); assert.equal(Object.isFrozen(specification), true);
    assert.deepEqual(Object.keys(specification).sort(), ["bytes", "path", "sha256"]);
  });

  test("VM builder inspection uses the private context without an explicit builder name", async () => {
    const fixture = await formatOnlyRoutingVm(); const requests = []; const route = routingRunner();
    await assert.rejects(fixture.invoke(lease(), {
      runner(request) { requests.push(request); return route(request); },
      contextReader() { throw new Error("stop after routing"); },
      archiveReader() { throw new Error("archive must remain closed"); },
    }));
    const builder = requests.find((request) => request.args.includes("buildx")); assert.ok(builder);
    assert.deepEqual([...builder.args.slice(4)], ["buildx", "inspect"]);
    assert.equal(builder.args.includes("default"), false); assert.equal(builder.args.includes("--bootstrap"), false);
  });

  test("VM rejects the principal default builder frame before context", async () => {
    const fixture = await formatOnlyRoutingVm(); const requests = []; let contextReads = 0;
    const principal = Buffer.from("Name: default\nDriver: docker\nNodes:\nName: default\nEndpoint: default\nStatus: running\nBuildKit version: v0.24.0\nPlatforms: linux/amd64\n");
    await assert.rejects(fixture.invoke(lease(), {
      runner(request) { requests.push(request); return routingRunner({}, principal)(request); },
      contextReader() { contextReads += 1; throw new Error("context must remain closed"); },
      archiveReader() { throw new Error("archive must remain closed"); },
    }), /gosu_derivative_image_observation_routing_invalid/u);
    const builder = requests.find((request) => request.args.includes("buildx")); assert.ok(builder);
    assert.equal(builder.args.includes("default"), false); assert.equal(contextReads, 0);
  });

  test("default runner rejects EPIPE before reporting authenticated stdin EOF", async () => {
    const api = await observationInternals({ spawn: () => fakeChild("epipe") });
    await assert.rejects(api.__defaultRunner(runnerRequest()), /gosu_derivative_image_observation_stream_invalid/u);
  });

  test("default runner rejects child close before authenticated stdin EOF", async () => {
    const api = await observationInternals({ spawn: () => fakeChild("early-close") });
    await assert.rejects(api.__defaultRunner(runnerRequest()), /gosu_derivative_image_observation_stream_invalid/u);
  });

  test("default runner rejects timeout before authenticated stdin EOF", async () => {
    const api = await observationInternals({ spawn: () => fakeChild("timeout") });
    await assert.rejects(api.__defaultRunner(runnerRequest({ timeoutMs: 1 })), /gosu_derivative_image_observation_stream_invalid/u);
  });

  test("default runner counts authenticated stdin bytes only after its EOF callback", async () => {
    const api = await observationInternals({ spawn: () => fakeChild("success") });
    const request = runnerRequest(); const result = await api.__defaultRunner(request);
    assert.equal(result.stdinBytes, request.stdin.length); assert.equal(result.stdinEnded, true);
  });

  test("default runner fsyncs and closes a partial save when the output cap fails", async () => {
    const record = { dev: 1n, ino: 2n, uid: 1000n, gid: 1000n, nlink: 1n, mode: 0o100600n, size: 0n,
      mtimeNs: 1n, ctimeNs: 1n, birthtimeNs: 1n, isFile: () => true, isSymbolicLink: () => false };
    let closed = 0; let synced = 0;
    const api = await observationInternals({
      spawn: () => fakeChild("file-cap", record),
      fsValues: {
        openSync: () => 91, fstatSync: () => record, lstatSync: () => record,
        writeSync(_fd, chunk, offset, length) { record.size += BigInt(length); return length; },
        fsyncSync: () => { synced += 1; }, closeSync: () => { closed += 1; },
      },
    });
    await assert.rejects(api.__defaultRunner(runnerRequest({ stdoutMode: "FILE", stdoutPath: "/tmp/save.partial" })),
      /gosu_derivative_image_observation_stream_invalid/u);
    assert.equal(synced, 1); assert.equal(closed, 1);
  });

  test("default FILE runner hashes exactly the chunks it writes before fsync and close", async () => {
    const record = { dev: 1n, ino: 2n, uid: 1000n, gid: 1000n, nlink: 1n, mode: 0o100600n, size: 0n,
      mtimeNs: 1n, ctimeNs: 1n, birthtimeNs: 1n, isFile: () => true, isSymbolicLink: () => false };
    const writes = []; let synced = 0; let closed = 0;
    const api = await observationInternals({
      spawn: () => fakeChild("file-success", record),
      fsValues: {
        openSync: () => 95, fstatSync: () => record, lstatSync: () => record,
        writeSync(_fd, chunk, offset, length) { const written = Buffer.from(chunk.subarray(offset, offset + length));
          writes.push(written); record.size += BigInt(written.length); return written.length; },
        fsyncSync: () => { synced += 1; }, closeSync: () => { closed += 1; },
      },
    });
    const result = await api.__defaultRunner(runnerRequest({ stdin: undefined, stdoutMode: "FILE", stdoutPath: "/tmp/save.partial" }));
    const written = Buffer.concat(writes);
    assert.equal(written.toString(), "first-second"); assert.equal(result.stdoutBytes, written.length);
    assert.deepEqual({ ...result.outputIdentity }, { bytes: written.length, sha256: hash(written) });
    assert.equal(result.outputPhysical.size, written.length); assert.equal(synced, 1); assert.equal(closed, 1);
  });

  test("default archive reader interrupts chunk reads at the deadline and closes its descriptor", async () => {
    const record = { dev: 1n, ino: 2n, uid: 1000n, gid: 1000n, nlink: 1n, mode: 0o100600n, size: 2n * 1024n ** 2n,
      mtimeNs: 1n, ctimeNs: 1n, birthtimeNs: 1n, isFile: () => true, isSymbolicLink: () => false };
    let closed = 0; let reads = 0; let guards = 0;
    const api = await observationInternals({ fsValues: {
      openSync: () => 92, fstatSync: () => record, lstatSync: () => record, realpathSync: (value) => value,
      readSync(_fd, buffer, offset, length) { reads += 1; buffer.fill(0, offset, offset + length); return length; },
      closeSync: () => { closed += 1; },
    } });
    const control = { guard() { guards += 1; if (guards === 2) throw new Error("gosu_derivative_image_observation_deadline_exceeded"); } };
    await assert.rejects(async () => api.__probeArchiveReader("/tmp/archive.tar", "BASE", control),
      /gosu_derivative_image_observation_deadline_exceeded/u);
    assert.equal(reads, 1); assert.equal(closed, 1);
  });

  test("default archive reader preserves historical plain-object rejection codes", async () => {
    const code = "gosu_derivative_image_observation_deadline_exceeded";
    const record = { dev: 1n, ino: 2n, uid: 1000n, gid: 1000n, nlink: 1n, mode: 0o100600n, size: 1n,
      mtimeNs: 1n, ctimeNs: 1n, birthtimeNs: 1n, isFile: () => true, isSymbolicLink: () => false };
    let closed = 0;
    const api = await observationInternals({ fsValues: {
      openSync: () => 92, fstatSync: () => record, lstatSync: () => record, realpathSync: (value) => value,
      readSync() { throw { message: code }; }, closeSync: () => { closed += 1; },
    } });
    const failure = await Promise.resolve().then(() => api.__probeArchiveReader("/tmp/archive.tar", "BASE",
      { guard: () => undefined })).catch((error) => error);
    assert.deepEqual(JSON.parse(JSON.stringify(api.gosuDerivativeImageObservationFailureDiagnostic(failure, "OBSERVE"))),
      { code, phase: "OBSERVE", state: "UNBUILT" });
    assert.equal(api.gosuDerivativeImageObservationArchiveFailureDetailV1(failure), null);
    assert.equal(closed, 1);
  });

  test("default archive reader allows access-time drift after reading a fresh save", async () => {
    const before = { dev: 1n, ino: 2n, uid: 1000n, gid: 1000n, nlink: 1n, mode: 0o100600n, size: 1n,
      atimeNs: 1n, mtimeNs: 2n, ctimeNs: 3n, birthtimeNs: 4n, isFile: () => true, isSymbolicLink: () => false };
    let stats = 0; let closed = 0;
    const api = await observationInternals({ fsValues: {
      openSync: () => 93,
      fstatSync: () => { stats += 1; return stats >= 3 ? { ...before, atimeNs: 99n } : before; },
      lstatSync: () => { stats += 1; return stats >= 3 ? { ...before, atimeNs: 99n } : before; },
      realpathSync: (value) => value,
      readSync(_fd, buffer, offset) { buffer[offset] = 1; return 1; },
      closeSync: () => { closed += 1; },
    } });
    const record = api.__probeArchiveReader("/tmp/fresh.tar", "CANDIDATE", { guard: () => undefined });
    assert.equal(record.buffer.length, 1); assert.equal(closed, 1);
  });

  test("default archive reader rejects stable identity or metadata drift after reading", async () => {
    const before = { dev: 1n, ino: 2n, uid: 1000n, gid: 1000n, nlink: 1n, mode: 0o100600n, size: 1n,
      atimeNs: 1n, mtimeNs: 2n, ctimeNs: 3n, birthtimeNs: 4n, isFile: () => true, isSymbolicLink: () => false };
    let active = "mtimeNs"; let stats = 0;
    const api = await observationInternals({ fsValues: {
      openSync: () => 94,
      fstatSync: () => { stats += 1; return stats >= 3 ? { ...before, [active]: before[active] + 1n } : before; },
      lstatSync: () => { stats += 1; return stats >= 3 ? { ...before, [active]: before[active] + 1n } : before; },
      realpathSync: (value) => value,
      readSync(_fd, buffer, offset) { buffer[offset] = 1; return 1; }, closeSync: () => undefined,
    } });
    for (const field of ["mtimeNs", "ctimeNs", "birthtimeNs", "dev", "ino", "size", "mode", "uid", "gid", "nlink"]) {
      active = field; stats = 0;
      await assert.rejects(async () => api.__probeArchiveReader("/tmp/fresh.tar", "BASE", { guard: () => undefined }),
        /gosu_derivative_image_observation_archive_invalid/u);
    }
  });

  test("archive scan checks the deadline between input chunks", async () => {
    let chunksRead = 0;
    const api = await observationInternals({ archiveValues: {
      async scanRawUstar(options) { for await (const chunk of options.input) { chunksRead += 1; assert.ok(chunk.length > 0); } return { members: [] }; },
    } });
    let guards = 0; const control = { signal: undefined, maximumExpanded: () => 1, consumeExpanded: () => undefined,
      guard() { guards += 1; if (guards === 3) throw new Error("gosu_derivative_image_observation_deadline_exceeded"); } };
    await assert.rejects(api.__probeInspect(Buffer.alloc(3 * 1024 ** 2), imageSaveFixture().subject, control),
      /gosu_derivative_image_observation_deadline_exceeded/u);
    assert.equal(chunksRead, 1);
  });

  test("gzip expansion aborts its native output stream when deadline expires during scan", async () => {
    const raw = tar([{ path: "large-zero-payload", bytes: Buffer.alloc(8 * 1024 ** 2) }]); const compressed = gzipSync(raw);
    assert.ok(compressed.length < 1024 ** 2);
    const realArchive = await import("../scripts/seaweed-image/archive.mjs"); let gunzip;
    const api = await observationInternals({
      archiveValues: { scanRawUstar: realArchive.scanRawUstar },
      zlibValues: { createGunzip: (...args) => { gunzip = createGunzip(...args); return gunzip; } },
    });
    const controller = new globalThis.AbortController(); let guards = 0;
    const control = { signal: controller.signal, guard() {
      guards += 1;
      if (guards >= 2) { controller.abort(); throw new Error("gosu_derivative_image_observation_deadline_exceeded"); }
    } };
    const started = Date.now();
    await assert.rejects(api.__probeGzip(compressed, digest(raw), 16 * 1024 ** 2, control),
      /gosu_derivative_image_observation_deadline_exceeded/u);
    assert.ok(Date.now() - started < 1_000); assert.ok(guards >= 2);
    assert.equal(controller.signal.aborted, true); assert.equal(gunzip.destroyed, true);
  });

  test("two image observations share one expansion budget enforced before the next layer scan", async () => {
    const realArchive = await import("../scripts/seaweed-image/archive.mjs"); const maxima = [];
    const api = await observationInternals({ archiveValues: {
      scanGzipLayer: realArchive.scanGzipLayer,
      async scanRawUstar(options) {
        if (options.maxMembers === 4096) return realArchive.scanRawUstar(options);
        maxima.push(options.maxRawBytes); return { rawSize: options.maxRawBytes, members: [] };
      },
    } });
    let remaining = 128; const control = { guard: () => undefined, signal: undefined,
      maximumExpanded() { if (remaining <= 0) throw new Error("gosu_derivative_image_observation_archive_invalid"); return remaining; },
      consumeExpanded(bytes) { if (bytes > remaining) throw new Error("gosu_derivative_image_observation_archive_invalid"); remaining -= bytes; } };
    const fixture = imageSaveFixture(); await api.__probeInspect(fixture.archive, fixture.subject, control);
    await assert.rejects(api.__probeInspect(fixture.archive, fixture.subject, control),
      /gosu_derivative_image_observation_archive_invalid/u);
    assert.deepEqual(maxima, [128]);
  });

  test("a fully injected workflow can return only explicit FORMAT_ONLY simulation state", async () => {
    const fixture = await fullInjectedWorkflow();
    const standaloneControl = { guard: () => undefined, signal: undefined, maximumExpanded: () => 1024 ** 3,
      consumeExpanded: () => undefined };
    await fixture.api.__probeInspect(fixture.base.archive, fixture.base.subject, standaloneControl);
    await fixture.api.__probeInspect(fixture.candidate.archive, fixture.candidate.subject, standaloneControl);
    let result;
    try { result = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
      nonce: "a".repeat(24), lease: lease() }, fixture.dependencies); }
    catch (error) { assert.fail(`${error.message}; phase=${error.phase}; state=${error.state}`); }
    assert.equal(result.state, "FORMAT_ONLY_SIMULATION"); assert.equal(result.scope, "FORMAT_ONLY");
    assert.equal(result.image, "NOT_ESTABLISHED"); assert.equal(result.candidateAdmission, "NOT_ESTABLISHED");
    assert.doesNotMatch(JSON.stringify(result), /BUILT_UNVALIDATED|IMAGE_BUILD_FORMAT_OBSERVED_REVIEW_PENDING/u);
    const contextCreate = fixture.requests.find((request) => request.args.includes("create")); assert.ok(contextCreate);
    for (const request of fixture.requests.filter((value) => value !== contextCreate)) {
      assert.deepEqual([...request.args.slice(0, 4)], ["--config", lease().dockerConfig, "--context", lease().contextName]);
    }
    const build = fixture.requests.find((request) => request.args.includes("build")); assert.ok(build);
    assert.equal(build.args.includes("--builder"), false); assert.equal(build.args.includes("default"), false);
  });

  test("FORMAT_ONLY result retains exact bounded pre-context profile bytes and closed projections", async () => {
    const fixture = await fullInjectedWorkflow(); const originalRunner = fixture.dependencies.runner;
    const captured = new Map(); let ordinal = 0;
    fixture.dependencies.runner = async (request) => {
      const result = await originalRunner(request); const key = routingProfileKey(request);
      if (key === undefined) return result;
      const stdout = Buffer.from(result.stdout); const stderr = Buffer.from([0x00, ordinal += 1, 0xff, 0x7f]);
      captured.set(key, { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
      return { ...result, stdout, stderr, stdoutBytes: stdout.length };
    };
    const result = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
      nonce: "a".repeat(24), lease: lease() }, fixture.dependencies);
    const profiles = JSON.parse(JSON.stringify(result.profiles));
    assert.deepEqual(Object.keys(profiles), ["stage", "context", "version", "info", "builder"]);
    assert.equal(profiles.stage, "PRE_CONTEXT");
    const expectedCommands = {
      context: ["--config", lease().dockerConfig, "--context", lease().contextName, "context", "inspect", lease().contextName],
      version: ["--config", lease().dockerConfig, "--context", lease().contextName, "version", "--format", "{{json .}}"],
      info: ["--config", lease().dockerConfig, "--context", lease().contextName, "info", "--format", "{{json .}}"],
      builder: ["--config", lease().dockerConfig, "--context", lease().contextName, "buildx", "inspect"],
    };
    const expectedParsed = {
      context: { name: lease().contextName, endpoint: lease().endpoint },
      version: { serverVersion: "28.0.4" },
      info: { daemonId: lease().daemonId, dataRoot: lease().dataRoot, os: "linux", arch: "x86_64", driver: "overlay2",
        containerdAddress: lease().containerdAddress, namespaces: { containers: lease().containersNamespace, plugins: lease().pluginsNamespace } },
      builder: { name: null, nodeName: lease().contextName, driver: "docker", endpoint: lease().endpoint, status: "running",
        buildkit: "v0.24.0", platforms: "linux/amd64", representation: "FORMAT_ONLY_JSON" },
    };
    for (const key of ["context", "version", "info", "builder"]) {
      assert.deepEqual(profiles[key].command, { binary: "/usr/bin/docker", args: expectedCommands[key] });
      assert.equal(profiles[key].representation, key === "builder" ? "FORMAT_ONLY_JSON" : "JSON");
      assert.deepEqual(profiles[key].parsed, expectedParsed[key]);
      assert.deepEqual(profiles[key].stdout, profileEnvelope(captured.get(key).stdout));
      assert.deepEqual(profiles[key].stderr, profileEnvelope(captured.get(key).stderr));
      assert.deepEqual(Object.keys(profiles[key]).sort(), ["command", "parsed", "representation", "stderr", "stdout"]);
      assert.equal(fixture.requests.filter((request) => routingProfileKey(request) === key).length, 1);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(result.builder)), { driver: "docker", endpoint: lease().endpoint,
      platforms: "linux/amd64", representation: "FORMAT_ONLY_JSON" });
    assert.equal(Object.isFrozen(result.profiles), true); assert.equal(Object.isFrozen(result.profiles.info.parsed.namespaces), true);
    assert.equal(Object.isFrozen(result.profiles.context.stdout), true); assert.equal(Buffer.isBuffer(result.profiles.context.stdout), false);
    assert.throws(() => { result.profiles.stage = "MUTATED"; }, TypeError);
  });

  test("pre-context profile capture survives mutation by later runner and context callbacks", async () => {
    const fixture = await fullInjectedWorkflow(); const originalRunner = fixture.dependencies.runner;
    const originalContextReader = fixture.dependencies.contextReader; const returned = []; const captured = new Map();
    const mutateReturned = () => { for (const pair of returned) { pair.stdout.fill(0x5a); pair.stderr.fill(0xa5); } };
    fixture.dependencies.runner = async (request) => {
      mutateReturned(); const result = await originalRunner(request); const key = routingProfileKey(request);
      if (key === undefined) return result;
      const stdout = Buffer.from(result.stdout); const stderr = Buffer.from([0x00, returned.length + 1, 0xfe]);
      captured.set(key, { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }); returned.push({ stdout, stderr });
      return { ...result, stdout, stderr, stdoutBytes: stdout.length };
    };
    fixture.dependencies.contextReader = (...args) => { mutateReturned(); return originalContextReader(...args); };
    const result = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
      nonce: "a".repeat(24), lease: lease() }, fixture.dependencies);
    const profiles = JSON.parse(JSON.stringify(result.profiles));
    for (const key of ["context", "version", "info", "builder"]) {
      assert.deepEqual(profiles[key].stdout, profileEnvelope(captured.get(key).stdout));
      assert.deepEqual(profiles[key].stderr, profileEnvelope(captured.get(key).stderr));
    }
  });

  test("pre-context profile buffers are detached before the post-runner deadline callback", async () => {
    const fixture = await fullInjectedWorkflow(); const originalRunner = fixture.dependencies.runner;
    const captured = new Map(); let pending;
    fixture.dependencies.now = () => {
      if (pending !== undefined) { pending.stdout.fill(0x4d); pending.stderr.fill(0x6e); pending = undefined; }
      return 0;
    };
    fixture.dependencies.runner = async (request) => {
      const result = await originalRunner(request); const key = routingProfileKey(request);
      if (key === undefined) return result;
      const stdout = Buffer.from(result.stdout); const stderr = Buffer.from([0x00, captured.size + 1, 0xfd]);
      captured.set(key, { stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }); pending = { stdout, stderr };
      return { ...result, stdout, stderr, stdoutBytes: stdout.length };
    };
    const result = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
      nonce: "a".repeat(24), lease: lease() }, fixture.dependencies);
    const profiles = JSON.parse(JSON.stringify(result.profiles));
    for (const key of ["context", "version", "info", "builder"]) {
      assert.deepEqual(profiles[key].stdout, profileEnvelope(captured.get(key).stdout));
      assert.deepEqual(profiles[key].stderr, profileEnvelope(captured.get(key).stderr));
    }
  });

  test("native Buildx text retains distinct top and node names in its pre-context projection", async () => {
    const fixture = await fullInjectedWorkflow(); const originalRunner = fixture.dependencies.runner;
    const native = Buffer.from(`Name: ${lease().contextName}\nDriver: docker\nNodes:\nName: ${lease().contextName}\nEndpoint: ${lease().endpoint}\nStatus: running\nBuildKit version: v0.24.0\nPlatforms: linux/amd64\n`);
    fixture.dependencies.runner = async (request) => {
      const result = await originalRunner(request);
      return routingProfileKey(request) === "builder" ? { ...result, stdout: native, stdoutBytes: native.length } : result;
    };
    const result = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
      nonce: "a".repeat(24), lease: lease() }, fixture.dependencies);
    const builder = JSON.parse(JSON.stringify(result.profiles.builder));
    assert.equal(builder.representation, "NATIVE_TEXT");
    assert.deepEqual(builder.parsed, { name: lease().contextName, nodeName: lease().contextName, driver: "docker",
      endpoint: lease().endpoint, status: "running", buildkit: "v0.24.0", platforms: "linux/amd64", representation: "NATIVE_TEXT" });
    assert.deepEqual(builder.stdout, profileEnvelope(native));
    assert.deepEqual(JSON.parse(JSON.stringify(result.builder)), { driver: "docker", endpoint: lease().endpoint,
      platforms: "linux/amd64", representation: "NATIVE_TEXT" });
  });

  test("routing rejects oversized or inconsistent injected command metadata before context access", async () => {
    const cases = [
      ["oversized stdout", (result) => ({ ...result, stdout: Buffer.alloc(2 * 1024 ** 2 + 1), stdoutBytes: 2 * 1024 ** 2 + 1 })],
      ["oversized stderr", (result) => ({ ...result, stderr: Buffer.alloc(2 * 1024 ** 2 + 1) })],
      ["mismatched stdoutBytes", (result) => ({ ...result, stdoutBytes: result.stdout.length + 1 })],
      ["negative stdoutBytes", (result) => ({ ...result, stdoutBytes: -1 })],
    ];
    for (const [name, alter] of cases) {
      const routing = routingRunner(); const fixture = await formatOnlyRoutingVm(); let contextReads = 0;
      let failure;
      try {
        await fixture.invoke(lease(), {
          async runner(request) {
            const result = await routing(request);
            return routingProfileKey(request) === "context" ? alter(result) : result;
          },
          contextReader() { contextReads += 1; throw new Error("private context must remain closed"); },
          archiveReader() { throw new Error("archive must remain closed"); },
        });
        assert.fail(`expected ${name} rejection`);
      } catch (error) { failure = error; }
      assert.equal(failure.message, "gosu_derivative_image_observation_command_failed", name);
      assert.equal(failure.phase, "ROUTING", name); assert.equal(failure.state, "UNBUILT", name); assert.equal(contextReads, 0, name);
      const diagnostic = JSON.parse(JSON.stringify(fixture.diagnostic(failure)));
      assert.deepEqual(diagnostic, { code: "gosu_derivative_image_observation_command_failed", phase: "ROUTING", state: "UNBUILT" });
      assert.doesNotMatch(JSON.stringify(diagnostic), /private context/u);
    }
  });

  test("postbuild failure preserves its closed code and phase beside MAY_HAVE_BEEN_BUILT state", async () => {
    const fixture = await fullInjectedWorkflow({ failAfterBuild: true }); let failure;
    try {
      await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
        nonce: "a".repeat(24), lease: lease() }, fixture.dependencies);
      assert.fail("expected postbuild failure");
    } catch (error) { failure = error; }
    assert.equal(failure.message, "gosu_derivative_image_observation_stream_invalid");
    assert.equal(failure.phase, "BUILD"); assert.equal(failure.state, "MAY_HAVE_BEEN_BUILT");
    const diagnostic = fixture.api.gosuDerivativeImageObservationFailureDiagnostic(failure, failure.phase);
    assert.deepEqual({ ...diagnostic }, { code: "gosu_derivative_image_observation_stream_invalid", phase: "BUILD", state: "MAY_HAVE_BEEN_BUILT" });
  });

  test("archive reread hash mismatch cannot validate bytes previously streamed by FILE runner", async () => {
    const fixture = await fullInjectedWorkflow({ readerHashMismatch: true }); let failure;
    try {
      await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
        nonce: "a".repeat(24), lease: lease() }, fixture.dependencies);
      assert.fail("expected archive binding failure");
    } catch (error) { failure = error; }
    assert.equal(failure.message, "gosu_derivative_image_observation_archive_invalid");
    assert.equal(failure.phase, "OBSERVE"); assert.equal(failure.state, "MAY_HAVE_BEEN_BUILT");
  });

  test("build proof V1 binds one fresh pair to its retained context handle and conservative window", async () => {
    const fixture = await fullInjectedWorkflow(); const originalRunner = fixture.dependencies.runner; let clock = 0;
    fixture.dependencies.now = () => clock;
    fixture.dependencies.runner = async (request) => {
      const result = await originalRunner(request);
      if (request.args.includes("buildx") && request.args.includes("build")) clock = 5;
      return result;
    };
    const result = await fixture.api.__probeRunProof(buildProofInput(), fixture.dependencies);
    assert.deepEqual(JSON.parse(JSON.stringify(result.buildWindow)), { startedAtMs: 0, completedAtMs: 6 });
    assert.equal(result.state, "PAIR_PROOF_SIMULATION"); assert.equal(result.scope, "CONDITIONAL_PAIR_PROOF_ONLY");
    assert.equal(result.authority, "NOT_AUTHORIZED"); assert.equal(result.image, "NOT_ESTABLISHED");
    assert.equal(result.candidateAdmission, "NOT_ESTABLISHED"); assert.equal(result.functional, "NOT_ESTABLISHED");
    assert.equal(result.vulnerabilities, "NOT_ESTABLISHED"); assert.equal(result.dates, null);
    assert.strictEqual(result.pairProof, fixture.pairProof); assert.equal(Object.isFrozen(result), true);
    assert.equal(fixture.proofCalls.opens.length, 2); assert.equal(fixture.proofCalls.pairs.length, 1);
    const [baseOpen, candidateOpen] = fixture.proofCalls.opens;
    assert.strictEqual(baseOpen.buffer, fixture.base.archive); assert.strictEqual(candidateOpen.buffer, fixture.candidate.archive);
    assert.deepEqual(JSON.parse(JSON.stringify(baseOpen.subject)), {
      role: "BASE", archive: { bytes: fixture.base.archive.length, sha256: hash(fixture.base.archive) },
      configId: fixture.base.subject.configId,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(candidateOpen.subject)), {
      role: "CANDIDATE", archive: { bytes: fixture.candidate.archive.length, sha256: hash(fixture.candidate.archive) },
      configId: fixture.candidate.subject.configId,
    });
    const pair = fixture.proofCalls.pairs[0];
    assert.strictEqual(pair.handle, fixture.candidateLockHandle);
    assert.deepEqual(JSON.parse(JSON.stringify(pair.value.buildWindow)), { startedAtMs: 0, completedAtMs: 6 });
    assert.deepEqual(pair.value.baseSave, { role: "BASE" }); assert.deepEqual(pair.value.candidateSave, { role: "CANDIDATE" });
    const build = fixture.requests.filter((request) => request.args.includes("buildx") && request.args.includes("build"));
    assert.equal(build.length, 1); assert.strictEqual(build[0].stdin, fixture.context);
    assert.equal(fixture.imageScans(), 0);
  });

  test("build proof V1 rejects wrong public shapes and keeps legacy observation proof-free", async () => {
    let calls = 0; const dependencies = {
      now() { calls += 1; return 0; },
      runner() { calls += 1; throw new Error("must not run"); },
      contextReader() { calls += 1; throw new Error("must not read"); },
      archiveReader() { calls += 1; throw new Error("must not read"); },
    };
    for (const input of [
      { ...buildProofInput(), purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION" },
      { ...buildProofInput(), extra: true },
    ]) {
      const failure = await runGosuDerivativeImageBuildProofV1(input, dependencies).catch((error) => error);
      assert.equal(failure.message, "gosu_derivative_image_observation_input_invalid");
      assert.equal(failure.phase, "PREFLIGHT"); assert.equal(failure.state, "UNBUILT");
    }
    let failure = await runGosuDerivativeImageBuildProofV1(buildProofInput(), { unexpected() {} }).catch((error) => error);
    assert.equal(failure.message, "gosu_derivative_image_observation_input_invalid");
    assert.equal(failure.phase, "PREFLIGHT"); assert.equal(failure.state, "UNBUILT"); assert.equal(calls, 0);

    const fixture = await fullInjectedWorkflow();
    const result = await fixture.api.__probeRun({ purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION",
      nonce: "a".repeat(24), lease: lease() }, fixture.dependencies);
    assert.equal(result.state, "FORMAT_ONLY_SIMULATION"); assert.equal(fixture.proofCalls.opens.length, 0);
    assert.equal(fixture.proofCalls.pairs.length, 0); assert.ok(fixture.imageScans() > 0);
    assert.equal(Object.hasOwn(result, "buildWindow"), false); assert.equal(Object.hasOwn(result, "pairProof"), false);
  });

  test("build proof V1 refuses rollback and unsafe completion clocks without invoking proof", async () => {
    const cases = [
      ["rollback", -1],
      ["unsafe", Number.MAX_SAFE_INTEGER],
      ["deadline", lease().deadlineAtMs - 25_000],
    ];
    for (const [name, terminalClock] of cases) {
      const fixture = await fullInjectedWorkflow(); const originalRunner = fixture.dependencies.runner; let clock = 0;
      fixture.dependencies.now = () => clock;
      fixture.dependencies.runner = async (request) => {
        const result = await originalRunner(request);
        if (request.args.includes("buildx") && request.args.includes("build")) clock = terminalClock;
        return result;
      };
      const failure = await fixture.api.__probeRunProof(buildProofInput(), fixture.dependencies).catch((error) => error);
      assert.equal(failure.message, "gosu_derivative_image_observation_deadline_exceeded", name);
      assert.equal(failure.phase, "BUILD", name); assert.equal(failure.state, "MAY_HAVE_BEEN_BUILT", name);
      assert.equal(fixture.proofCalls.opens.length, 0, name); assert.equal(fixture.proofCalls.pairs.length, 0, name);
    }

    const beforeBuild = await fullInjectedWorkflow(); const originalRunner = beforeBuild.dependencies.runner;
    let clock = 10;
    beforeBuild.dependencies.now = () => clock;
    beforeBuild.dependencies.runner = async (request) => {
      const result = await originalRunner(request);
      if (request.phase === "SAVE_BASE") clock = 9;
      return result;
    };
    const failure = await beforeBuild.api.__probeRunProof(buildProofInput(), beforeBuild.dependencies).catch((error) => error);
    assert.equal(failure.message, "gosu_derivative_image_observation_deadline_exceeded");
    assert.equal(failure.phase, "BUILD"); assert.equal(failure.state, "UNBUILT");
    assert.equal(beforeBuild.requests.some((request) => request.args.includes("buildx") && request.args.includes("build")), false);

    for (const [name, invalidStart] of [["negative start", -1], ["fractional start", 0.5],
      ["NaN start", Number.NaN], ["unsafe start", Number.MAX_SAFE_INTEGER]]) {
      const fixture = await fullInjectedWorkflow(); const original = fixture.dependencies.runner;
      let afterBase = false; let guardedBaseReturn = false;
      fixture.dependencies.now = () => {
        if (!afterBase) return 0;
        if (!guardedBaseReturn) { guardedBaseReturn = true; return 0; }
        return invalidStart;
      };
      fixture.dependencies.runner = async (request) => {
        const result = await original(request);
        if (request.phase === "SAVE_BASE") afterBase = true;
        return result;
      };
      const rejected = await fixture.api.__probeRunProof(buildProofInput(), fixture.dependencies).catch((error) => error);
      assert.equal(rejected.message, "gosu_derivative_image_observation_deadline_exceeded", name);
      assert.equal(rejected.phase, "BUILD", name); assert.equal(rejected.state, "UNBUILT", name);
      assert.equal(fixture.proofCalls.opens.length, 0, name);
    }

    for (const [name, invalidEnd] of [["fractional end", 0.5], ["NaN end", Number.NaN]]) {
      const fixture = await fullInjectedWorkflow(); const original = fixture.dependencies.runner;
      let afterBuild = false; let guardedBuildReturn = false;
      fixture.dependencies.now = () => {
        if (!afterBuild) return 0;
        if (!guardedBuildReturn) { guardedBuildReturn = true; return 0; }
        return invalidEnd;
      };
      fixture.dependencies.runner = async (request) => {
        const result = await original(request);
        if (request.args.includes("buildx") && request.args.includes("build")) afterBuild = true;
        return result;
      };
      const rejected = await fixture.api.__probeRunProof(buildProofInput(), fixture.dependencies).catch((error) => error);
      assert.equal(rejected.message, "gosu_derivative_image_observation_deadline_exceeded", name);
      assert.equal(rejected.phase, "BUILD", name); assert.equal(rejected.state, "MAY_HAVE_BEEN_BUILT", name);
      assert.equal(fixture.proofCalls.opens.length, 0, name);
    }

    const boundary = await fullInjectedWorkflow(); const boundaryRunner = boundary.dependencies.runner;
    let boundaryClock = 0;
    boundary.dependencies.now = () => boundaryClock;
    boundary.dependencies.runner = async (request) => {
      const result = await boundaryRunner(request);
      if (request.args.includes("buildx") && request.args.includes("build")) {
        boundaryClock = lease().deadlineAtMs - 25_000 - 1;
      }
      return result;
    };
    const accepted = await boundary.api.__probeRunProof(buildProofInput(), boundary.dependencies);
    assert.deepEqual(JSON.parse(JSON.stringify(accepted.buildWindow)),
      { startedAtMs: 0, completedAtMs: lease().deadlineAtMs - 25_000 });
  });

  test("build proof V1 closes proof failures and never proves unread or unbound archives", async () => {
    for (const options of [{ proofOpenFailureRole: "BASE" }, { proofOpenFailureRole: "CANDIDATE" },
      { proofPairFailure: true }]) {
      const fixture = await fullInjectedWorkflow(options);
      const failure = await fixture.api.__probeRunProof(buildProofInput(), fixture.dependencies).catch((error) => error);
      assert.equal(failure.message, "gosu_derivative_image_observation_archive_invalid");
      assert.equal(failure.phase, "OBSERVE"); assert.equal(failure.state, "MAY_HAVE_BEEN_BUILT");
      assert.equal(failure.cause, undefined); assert.doesNotMatch(JSON.stringify(failure), /secret proof/u);
    }
    for (const options of [{ readerFailureRole: "BASE" }, { readerHashMismatch: true }]) {
      const fixture = await fullInjectedWorkflow(options);
      const failure = await fixture.api.__probeRunProof(buildProofInput(), fixture.dependencies).catch((error) => error);
      assert.equal(failure.state, "MAY_HAVE_BEEN_BUILT");
      assert.equal(fixture.proofCalls.opens.length, 0); assert.equal(fixture.proofCalls.pairs.length, 0);
    }

    for (const stage of ["opener", "pair"]) {
      let clock = 0;
      const fixture = await fullInjectedWorkflow({
        onProofOpen(role) { if (stage === "opener" && role === "BASE") clock = lease().deadlineAtMs - 25_000; },
        onProofPair() { if (stage === "pair") clock = lease().deadlineAtMs - 25_000; },
      });
      fixture.dependencies.now = () => clock;
      const failure = await fixture.api.__probeRunProof(buildProofInput(), fixture.dependencies).catch((error) => error);
      assert.equal(failure.message, "gosu_derivative_image_observation_deadline_exceeded", stage);
      assert.equal(failure.phase, "OBSERVE", stage); assert.equal(failure.state, "MAY_HAVE_BEEN_BUILT", stage);
    }

    let calls = 0;
    const badLease = { ...lease(), endpoint: "unix:///var/run/docker.sock" };
    let failure = await runGosuDerivativeImageBuildProofV1({ ...buildProofInput(), lease: badLease }, {
      now() { calls += 1; return 0; }, runner() { calls += 1; }, contextReader() { calls += 1; }, archiveReader() { calls += 1; },
    }).catch((error) => error);
    assert.equal(failure.phase, "PREFLIGHT"); assert.equal(failure.state, "UNBUILT"); assert.equal(calls, 0);

    const routing = await fullInjectedWorkflow(); const routingRunnerOriginal = routing.dependencies.runner;
    routing.dependencies.runner = async (request) => {
      if (request.args.includes("context") && request.args.includes("inspect")) {
        const result = await routingRunnerOriginal(request);
        const stdout = Buffer.from("[]"); return { ...result, stdout, stdoutBytes: stdout.length };
      }
      return routingRunnerOriginal(request);
    };
    failure = await routing.api.__probeRunProof(buildProofInput(), routing.dependencies).catch((error) => error);
    assert.equal(failure.phase, "ROUTING"); assert.equal(failure.state, "UNBUILT");
    assert.equal(routing.proofCalls.opens.length, 0);
    assert.equal(routing.requests.some((request) => request.args.includes("buildx") && request.args.includes("build")), false);

    const contextFailure = await fullInjectedWorkflow();
    contextFailure.dependencies.contextReader = () => { throw new Error("secret context refusal"); };
    failure = await contextFailure.api.__probeRunProof(buildProofInput(), contextFailure.dependencies).catch((error) => error);
    assert.equal(failure.phase, "CONTEXT"); assert.equal(failure.state, "UNBUILT");
    assert.equal(contextFailure.proofCalls.opens.length, 0);
    assert.equal(contextFailure.requests.some((request) => request.args.includes("buildx") && request.args.includes("build")), false);

    const buildFailure = await fullInjectedWorkflow({ failBuild: true }); let archiveReads = 0;
    const archiveReader = buildFailure.dependencies.archiveReader;
    buildFailure.dependencies.archiveReader = (...args) => { archiveReads += 1; return archiveReader(...args); };
    failure = await buildFailure.api.__probeRunProof(buildProofInput(), buildFailure.dependencies).catch((error) => error);
    assert.equal(failure.phase, "BUILD"); assert.equal(failure.state, "MAY_HAVE_BEEN_BUILT");
    assert.equal(archiveReads, 0); assert.equal(buildFailure.proofCalls.opens.length, 0);
  });

  test("build proof V1 keeps the exact fixed build and archive flow under injected simulation", async () => {
    let timerClears = 0; let contextCloses = 0; const timer = Object.freeze({});
    const fixture = await fullInjectedWorkflow({ timerValues: {
      setTimeout: () => timer,
      clearTimeout: (value) => { assert.strictEqual(value, timer); timerClears += 1; },
    } });
    const result = await fixture.api.__probeRunProof(buildProofInput(), fixture.dependencies, () => { contextCloses += 1; });
    const phases = fixture.requests.map((request) => request.phase);
    assert.equal(phases.filter((phase) => phase === "SAVE_BASE").length, 1);
    assert.equal(phases.filter((phase) => phase === "SAVE_CANDIDATE").length, 1);
    assert.equal(fixture.requests.filter((request) => request.args.includes("buildx") && request.args.includes("build")).length, 1);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(result))).sort(), [
      "authority", "buildWindow", "builder", "candidateAdmission", "context", "dates", "functional", "image", "lease",
      "nonce", "pairProof", "preflight", "profiles", "scope", "state", "vulnerabilities",
    ]);
    assert.doesNotMatch(JSON.stringify(result), /IMAGE_PAIR_PROOF_OBSERVED_REVIEW_PENDING|BUILT_UNVALIDATED/u);
    assert.equal(contextCloses, 1); assert.equal(timerClears, 1);

    let failureCloses = 0; let failureTimerClears = 0; const failed = await fullInjectedWorkflow({
      proofPairFailure: true,
      timerValues: { setTimeout: () => timer, clearTimeout: () => { failureTimerClears += 1; } },
    });
    await assert.rejects(failed.api.__probeRunProof(buildProofInput(), failed.dependencies, () => { failureCloses += 1; }),
      /gosu_derivative_image_observation_archive_invalid/u);
    assert.equal(failureCloses, 1); assert.equal(failureTimerClears, 1);
  });
}
