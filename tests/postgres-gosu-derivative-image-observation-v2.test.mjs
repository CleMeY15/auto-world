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
  gosuDerivativeImageObservationFailureDiagnostic,
  inspectGosuDerivativeImageSaveV2,
  runGosuDerivativeImageBuildObservationV2,
} from "../scripts/postgres-image/gosu-derivative-image-observation-v2.mjs";

const BLOCK = 512;
const SELF = fileURLToPath(import.meta.url);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => `sha256:${hash(value)}`;

function octal(header, offset, length, value) {
  Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`).copy(header, offset);
}
function tarHeader(name, size, type = "0") {
  const value = Buffer.alloc(BLOCK); Buffer.from(name).copy(value);
  octal(value, 100, 8, type === "5" ? 0o755 : 0o644); octal(value, 108, 8, 0); octal(value, 116, 8, 0);
  octal(value, 124, 12, size); octal(value, 136, 12, 1_700_000_000); value.fill(0x20, 148, 156);
  value.write(type, 156); Buffer.from("ustar\0").copy(value, 257); Buffer.from("00").copy(value, 263);
  Buffer.from("root").copy(value, 265); Buffer.from("root").copy(value, 297);
  const checksum = value.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(value, 148);
  return value;
}
function tar(entries, endBlocks = 2) {
  const parts = [];
  for (const entry of entries) {
    const bytes = entry.bytes ?? Buffer.alloc(0); parts.push(tarHeader(entry.path, bytes.length, entry.type ?? "0"));
    if (bytes.length) parts.push(bytes, Buffer.alloc((BLOCK - bytes.length % BLOCK) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * endBlocks)); return Buffer.concat(parts);
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
      Nodes: [{ Name: "default", Endpoint: lease().endpoint, Status: "running", Buildkit: "v0.24.0",
        Platforms: "linux/amd64", ...builderNode }] }));
    return { exitCode: 0, timedOut: false, stdinBytes: request.stdin?.length ?? 0, stdinEnded: true,
      stdout: value, stderr: Buffer.alloc(0), stdoutBytes: value.length };
  };
}

async function observationInternals({ processValue, spawn, fsValues = {}, cryptoValues = {}, archiveValues = {}, candidateValues = {}, zlibValues = {} } = {}) {
  const sourcePath = new URL("../scripts/postgres-image/gosu-derivative-image-observation-v2.mjs", import.meta.url);
  const sourceText = `${fs.readFileSync(sourcePath, "utf8")}\nexport { runtimeGuard as __runtimeGuard, defaultRunner as __defaultRunner, closed as __closed };
    export const __probeArchiveReader = (file, role, control) => defaultArchiveReader({ path: file, role, maximumBytes: ARCHIVE_LIMIT }, control);
    export const __probeInspect = (buffer, subject, control) => inspectSave(buffer, JSON.parse(JSON.stringify(subject)), control);
    export const __probeGzip = (body, diffId, maximum, control) => scanGzipLayerWithControl(body, diffId, maximum, control);
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
    };`;
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
    ["node:timers", synthetic("mock:timers", { clearTimeout, setTimeout })],
    ["node:url", synthetic("mock:url", { fileURLToPath: () => "/repo/scripts/postgres-image/gosu-derivative-image-observation-v2.mjs" })],
    ["node:util", synthetic("mock:util", { isDeepStrictEqual, TextDecoder, types })],
    ["node:zlib", synthetic("mock:zlib", { createGunzip, ...zlibValues })],
    ["./gosu-derivative-candidate-v2.mjs", synthetic("mock:candidate", {
      candidateContractV2: unavailable, openCandidateLockV2: unavailable, validateCandidateContextV2: unavailable, ...candidateValues,
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

function acceptanceBuffer() {
  const value = Buffer.from(JSON.stringify({
    kind: "GOSU_DERIVATIVE_CONTEXT_PRIVATE_ACCEPTANCE_V1",
    source: { head: "582fb97e88cf5a498e6ae34ec76eb5736ada2a47", main: "e4fa47cbe66758a5b56f5347c2c27e61bdae1ed0",
      tree: "7292e98e7ee23e45ebccff075577af41f271dbf9" },
    context: { bytes: 1_986_560, sha256: "d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb" },
    checks: { contextTupleEqualAcrossOperationReceiptStreamStat: true, claimPrePostEqual: true, inputsPrePostEqual: true },
    candidateAdmission: "NOT_AUTHORIZED", functionalValidation: "NOT_ESTABLISHED",
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
  return { invoke, mockedReads };
}

async function fullInjectedWorkflow({ failAfterBuild = false, readerHashMismatch = false } = {}) {
  const realArchive = await import("../scripts/seaweed-image/archive.mjs");
  const baseId = "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537";
  const candidate = imageSaveFixture(); const base = imageSaveFixture({ role: "BASE", configId: baseId });
  const context = Buffer.alloc(1_986_560); let basePulled = false; let built = false;
  const member = (ordinal) => ({ memberOrdinal: ordinal, uncompressedHeaderOffset: ordinal * 512,
    uncompressedDataOffset: ordinal * 512 + 512, entry: { path: `entry-${ordinal}`, type: "directory", mode: 0o755,
      uid: 0, gid: 0, mtime: 1_700_000_000, size: 0 } });
  const api = await observationInternals({
    cryptoValues: { createHash: pinnedCreateHash },
    fsValues: { readFileSync: (name) => String(name).endsWith("gosu-derivative-context-private-acceptance-v1.json")
      ? acceptanceBuffer() : Buffer.from("lock") },
    candidateValues: { openCandidateLockV2: () => ({}), candidateContractV2: () => ({}), validateCandidateContextV2: () => ({}) },
    archiveValues: {
      scanGzipLayer: realArchive.scanGzipLayer,
      scanRawUstar(options) {
        if (options.diffId.endsWith("d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb")) {
          return Promise.resolve({ rawSize: context.length, members: Array.from({ length: 15 }, (_unused, index) => member(index)) });
        }
        const hostOptions = { ...options }; delete hostOptions.signal; return realArchive.scanRawUstar(hostOptions);
      },
    },
  });
  const route = routingRunner();
  const dependencies = {
    now: () => 0,
    async runner(request) {
      const tail = request.args.slice(request.args[2] === "--context" ? 4 : 2);
      if (tail[0] === "image" && tail[1] === "pull") basePulled = true;
      if (tail[0] === "buildx" && tail[1] === "build") built = true;
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
      const sha256 = readerHashMismatch && specification.role === "CANDIDATE" ? "0".repeat(64) : hash(selected.archive);
      return { buffer: selected.archive, identity: { bytes: selected.archive.length, sha256 }, physical: { dev: "1" } }; },
  };
  return { api, base, candidate, dependencies };
}

test("observation v2 exports only the three closed public interfaces", async () => {
  const api = await import("../scripts/postgres-image/gosu-derivative-image-observation-v2.mjs");
  assert.deepEqual(Object.keys(api).sort(), [
    "gosuDerivativeImageObservationFailureDiagnostic",
    "inspectGosuDerivativeImageSaveV2",
    "runGosuDerivativeImageBuildObservationV2",
  ]);
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
  test("runtime accepts cleared supplementary groups when getgroups retains primary gid 1000", async () => {
    const status = "Groups:\t\nNoNewPrivs:\t1\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\n";
    const api = await observationInternals({ fsValues: { readFileSync: (name, encoding) => {
      assert.equal(name, "/proc/self/status"); assert.equal(encoding, "utf8"); return status;
    } } });
    assert.doesNotThrow(() => api.__runtimeGuard());
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
    const valid = `Name: default\nDriver: docker\nNodes:\nName: default\nEndpoint: ${lease().endpoint}\nStatus: running\nBuildKit version: v0.24.0\nPlatforms: linux/amd64\n`;
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
    const valid = `Name: default\nDriver: docker\nNodes:\nName: default\nEndpoint: ${lease().endpoint}\nStatus: running\nBuildKit version: v0.24.0\nPlatforms: linux/amd64\n`;
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

  test("VM builder inspection keeps the supported fixed argv", async () => {
    const fixture = await formatOnlyRoutingVm(); const requests = []; const route = routingRunner();
    await assert.rejects(fixture.invoke(lease(), {
      runner(request) { requests.push(request); return route(request); },
      contextReader() { throw new Error("stop after routing"); },
      archiveReader() { throw new Error("archive must remain closed"); },
    }));
    const builder = requests.find((request) => request.args.includes("buildx")); assert.ok(builder);
    assert.deepEqual([...builder.args.slice(4)], ["buildx", "inspect", "default"]);
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
}
