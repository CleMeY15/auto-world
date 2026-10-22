import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { candidateContractV2, openCandidateLockV2 } from "../scripts/postgres-image/gosu-derivative-candidate-v2.mjs";

const SELF = fileURLToPath(import.meta.url);
const SOURCE = new URL("../scripts/postgres-image/gosu-retained-pair-worker-v1.mjs", import.meta.url);
const CANDIDATE_LOCK = new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url);
const SENTINEL = "GOSU_RETAINED_PAIR_WORKER_SELF_WRAPPED";
const WINDOWS_NODE = Object.freeze({
  version: "v22.23.2",
  bytes: 86_997_320,
  sha256: "0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4",
});
const LINUX_NODE = Object.freeze({
  version: "v22.23.2",
  bytes: 124_836_408,
  sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327",
});

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
  "worker v1 exports exactly the five frozen public interfaces",
  "worker v1 publishes the exact deeply frozen literal contract",
  "worker v1 accepts only one canonical detached transport",
  "worker v1 public transport validator rejects accessor-bearing Buffers without invoking accessors",
  "worker v1 validates the closed source manifest and Git object bindings",
  "worker v1 accepts the independent Git directory-order oracle",
  "worker v1 rejects non-string source closure regex fields without coercion",
  "worker v1 diagnostics close real parser failures without private text",
  "worker v1 source fixes the genuine import and exposes no dependency hook",
  "worker v1 VM accepts one exact genuine-shaped result as PROTOCOL_SIMULATION",
  "worker v1 VM accepts the exact context entry set in a different order",
  "worker v1 VM accepts trimmed builder platform members",
  "worker v1 VM rejects non-genuine constants and surplus result fields",
  "worker v1 VM rejects nonce and held lease tuple mismatches",
  "worker v1 VM rejects build-window archive and config cross-binding drift",
  "worker v1 VM rejects physical and filesystem-delta drift",
  "worker v1 VM rejects non-string result digest and config fields without coercion",
  "worker v1 VM calls the genuine static producer once with one identical input",
  "worker v1 rejects a surplus run argument before calling the genuine producer",
  "worker v1 failure diagnostics never invoke getters or inspect proxies",
  "worker v1 stdout waits for both the end callback and finish",
  "worker v1 stdout callback error closes without a second frame",
  "worker v1 stdout close before finish is cleanup failure without a second frame",
];

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const sha1Object = (kind, bytes) => crypto.createHash("sha1")
  .update(Buffer.from(`${kind} ${bytes.length}\0`)).update(bytes).digest("hex");
const compact = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
const pretty = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
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

function sourceClosureFixture() {
  const body = Buffer.from("PROTOCOL_SIMULATION worker source fixture\n");
  const entries = [{
    path: "scripts/postgres-image/gosu-retained-pair-worker-v1.mjs",
    gitMode: "100644",
    bytes: body.length,
    sha256: sha256(body),
    gitBlobSha1: sha1Object("blob", body),
  }];
  const calcTreeGitSha1 = treeOid(entries);
  const manifest = { kind: "GOSU_RETAINED_PAIR_SOURCE_MANIFEST_V1", entries, calcTreeGitSha1 };
  const commitRaw = Buffer.from(`tree ${calcTreeGitSha1}\nauthor Protocol Simulation <noreply@example.invalid> 0 +0000\ncommitter Protocol Simulation <noreply@example.invalid> 0 +0000\n\nfixture\n`);
  return {
    kind: "GOSU_RETAINED_PAIR_SOURCE_CLOSURE_V1",
    executionId: `gosu-retained-pair-${"1".repeat(24)}`,
    deploymentRoot: "/opt/auto-world/deployments/gosu-retained-pair-v1",
    manifest,
    manifestSha256: sha256(pretty(manifest)),
    calcTreeGitSha1,
    commitRawSha1: sha1Object("commit", commitRaw),
    acceptance: { path: ".omx/gosu-derivative-context-private-acceptance-v1.json", bytes: 11_744,
      sha256: "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3" },
  };
}

function workerProtocolSimulationFs() {
  const root = "/opt/auto-world/deployment";
  const sourcePath = `${root}/scripts/postgres-image/gosu-retained-pair-worker-v1.mjs`;
  const acceptancePath = `${root}/.omx/gosu-derivative-context-private-acceptance-v1.json`;
  const nodePath = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
  const sourceBytes = Buffer.from("PROTOCOL_SIMULATION worker source fixture\n");
  const files = new Map([[sourcePath, sourceBytes], [acceptancePath, { length: 11_744 }], [nodePath, { length: 124_836_408 }]]);
  const directories = new Map([[root, [".omx", "scripts"]], [`${root}/.omx`, ["gosu-derivative-context-private-acceptance-v1.json"]],
    [`${root}/scripts`, ["postgres-image"]], [`${root}/scripts/postgres-image`, ["gosu-retained-pair-worker-v1.mjs"]]]);
  const stat = (file) => {
    const directory = directories.has(file); const item = files.get(file); const size = directory ? 0 : item?.length;
    if (!directory && size === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const mode = directory ? 0o40555n : file === nodePath ? 0o100755n : 0o100444n;
    return { dev: 1n, ino: BigInt([...directories.keys(), ...files.keys()].indexOf(file) + 2), mode, nlink: 1n,
      size: BigInt(size), uid: 0n, gid: 0n, mtimeNs: 1n, ctimeNs: 1n, birthtimeNs: 1n,
      isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false };
  };
  let nextFd = 10; const descriptors = new Map();
  const fsModule = { constants: fs.constants,
    openSync(file) { if (!files.has(file)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); const fd = nextFd++; descriptors.set(fd, file); return fd; },
    closeSync(fd) { if (!descriptors.delete(fd)) throw new Error("bad fd"); },
    fstatSync(fd) { return stat(descriptors.get(fd)); }, lstatSync: stat, realpathSync: (file) => file,
    readdirSync(directory) { const names = directories.get(directory); if (!names) throw new Error("not directory"); return [...names]; },
    readFileSync(file, encoding) {
      if (file === "/proc/self/status") return "Groups:\t\nNoNewPrivs:\t1\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\n";
      const value = files.get(file); if (Buffer.isBuffer(value)) return encoding ? value.toString(encoding) : Buffer.from(value);
      throw new Error("unexpected readFileSync");
    },
    readSync(fd, buffer, offset, length, position) {
      const value = files.get(descriptors.get(fd)); const size = value.length;
      if (position >= size) return 0; const count = Math.min(length, size - position);
      if (Buffer.isBuffer(value)) value.copy(buffer, offset, position, position + count); else buffer.fill(0, offset, offset + count);
      return count;
    } };
  const createHash = (algorithm) => {
    const delegate = crypto.createHash(algorithm); let total = 0;
    return { update(value) { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); total += bytes.length; delegate.update(bytes); return this; },
      digest(encoding) {
        if (algorithm === "sha256" && total === 11_744) return encoding === "hex"
          ? "82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3" : undefined;
        if (algorithm === "sha256" && total === 124_836_408) return encoding === "hex"
          ? "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327" : undefined;
        return delegate.digest(encoding);
      } };
  };
  return { root, fsModule, createHash };
}

function leaseFixture() {
  const nonce = "a".repeat(24); const root = "/var/tmp/aw-cl-ABC123";
  return {
    purpose: "GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    root, nonce, socket: `${root}/endpoint/docker.sock`, endpoint: `unix://${root}/endpoint/docker.sock`,
    dockerConfig: `${root}/client`, buildxConfig: `${root}/client/buildx`, outputDirectory: `${root}/client/output`,
    contextName: `aw-cold-${nonce}`, pid: 4321, startTicks: "1234", daemonId: "isolated-engine", version: "28.0.4",
    dataRoot: `${root}/infra/data`, execRoot: `${root}/infra/exec`,
    containerdAddress: "/run/containerd/containerd.sock", containersNamespace: `awcold-${nonce}`,
    pluginsNamespace: `plugins.awcold-${nonce}`, configSha256: "b".repeat(64), argvSha256: "c".repeat(64), deadlineAtMs: 600_000,
    rootActor: { uid: 0, gid: 0 }, clientActor: { uid: 1000, gid: 1000 },
    socketProof: { dev: "1", ino: "2", uid: 0, gid: 1000, mode: 0o660 },
    socketDirectoryProof: { dev: "1", ino: "3", uid: 0, gid: 1000, mode: 0o710 },
  };
}

function transportFixture() {
  const lease = leaseFixture();
  return { kind: "GOSU_RETAINED_PAIR_WORKER_TRANSPORT_V1",
    input: { purpose: "GOSU_DERIVATIVE_IMAGE_RETAINED_BUILD_PROOF_V1", nonce: lease.nonce, lease },
    sourceClosure: sourceClosureFixture() };
}

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

function genuineResultFixture(input = transportFixture().input) {
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

async function workerVm(producer = async () => { throw new Error("PROTOCOL_SIMULATION producer not configured"); }, options = {}) {
  const sourceText = `${fs.readFileSync(SOURCE, "utf8")}\nexport { validateProducerResult as TEST_ONLY_validateProducerResult, endStdout as TEST_ONLY_endStdout };\nexport const TEST_ONLY_realmValue = (text) => JSON.parse(text);\nexport const TEST_ONLY_callPublic = (...args) => runGosuRetainedPairWorkerV1(...args);\n`;
  let context;
  const sandboxProcess = { ...process, stdin: options.stdin ?? process.stdin, stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr, env: Object.freeze(options.environment ?? {}), argv: [], platform: "linux", version: "v22.23.2",
    execPath: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node",
    getuid: () => 1000, geteuid: () => 1000, getgid: () => 1000, getegid: () => 1000,
    getgroups: () => options.identifier ? vm.runInContext("[1000]", context) : [1000] };
  context = vm.createContext({ Buffer, TextDecoder: globalThis.TextDecoder, TextEncoder: globalThis.TextEncoder, URL, AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal,
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, structuredClone: globalThis.structuredClone,
    process: sandboxProcess });
  const synthetic = (identifier, values) => new vm.SyntheticModule(Object.keys(values), function initialize() {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier });
  const identifier = options.identifier ?? SOURCE.href;
  const module = new vm.SourceTextModule(sourceText, { context, identifier,
    initializeImportMeta(meta) { meta.url = identifier; } });
  await module.link(async (specifier) => {
    if (specifier === "./gosu-derivative-image-observation-v2.mjs") {
      return synthetic("mock:producer", { runGosuDerivativeImageRetainedBuildProofV1: producer });
    }
    if (!specifier.startsWith("node:")) throw new Error(`unexpected production import ${specifier}`);
    if (options.fs && specifier === "node:fs") return synthetic("mock:fs", options.fs);
    if (options.createHash && specifier === "node:crypto") return synthetic("mock:crypto", { createHash: options.createHash });
    if (options.identifier && specifier === "node:path") return synthetic("mock:path", { default: (await import("node:path")).posix });
    if (options.identifier && specifier === "node:url") return synthetic("mock:url", {
      fileURLToPath: (url) => new URL(url).pathname, pathToFileURL: (file) => new URL(`file://${file}`),
    });
    const namespace = await import(specifier);
    return synthetic(`mock:${specifier}`, Object.fromEntries(Object.keys(namespace).map((key) => [key, namespace[key]])));
  });
  await module.evaluate(); return module.namespace;
}

if (!process.execArgv.includes("--experimental-vm-modules") && process.env[SENTINEL] !== "1") {
  test("worker v1 mandatory VM suite completes through the pinned Node bootstrap", () => {
    executablePin();
    const result = childProcess.spawnSync(process.execPath, [
      "--experimental-vm-modules", "--test", "--test-reporter=tap", SELF,
    ], { encoding: "utf8", env: childEnvironment(), timeout: 120_000, maxBuffer: 16 * 1024 ** 2 });
    const transcript = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.signal, null, transcript);
    assert.equal(result.status, 0, transcript);
    for (const name of REQUIRED_CASES) assert.match(result.stdout, new RegExp(`ok \\d+ - ${name}`, "u"), transcript);
    assert.match(result.stdout, new RegExp(`# pass ${REQUIRED_CASES.length}(?:\\r?\\n|$)`, "u"), transcript);
    assert.match(result.stdout, /# fail 0(?:\r?\n|$)/u, transcript);
    assert.match(result.stdout, /# skipped 0(?:\r?\n|$)/u, transcript);
    assert.match(result.stdout, /# cancelled 0(?:\r?\n|$)/u, transcript);
  });
} else {
  test("worker v1 exports exactly the five frozen public interfaces", async () => {
    const api = await import(SOURCE);
    assert.deepEqual(Object.keys(api).sort(), [
      "gosuRetainedPairWorkerV1Contract",
      "gosuRetainedPairWorkerV1FailureDiagnostic",
      "runGosuRetainedPairWorkerV1",
      "validateGosuRetainedPairSourceClosureV1",
      "validateGosuRetainedPairWorkerTransportV1",
    ]);
  });

  test("worker v1 publishes the exact deeply frozen literal contract", async () => {
    const { gosuRetainedPairWorkerV1Contract: contract } = await import(SOURCE);
    assert.deepEqual(contract, {
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
      caps: { transportBytes: 16_777_216, stdoutBytes: 8_388_608, stderrBytes: 0, commitRawBytes: 1_048_576 },
      exitCodes: { success: 0, failure: 1 },
      productionImport: "./gosu-derivative-image-observation-v2.mjs",
      phases: ["INPUT", "SOURCE", "ENVIRONMENT", "PRODUCER", "RESULT", "CLEANUP"],
      errorCodes: [
        "gosu_retained_pair_worker_input_invalid",
        "gosu_retained_pair_worker_source_invalid",
        "gosu_retained_pair_worker_environment_invalid",
        "gosu_retained_pair_worker_producer_failed",
        "gosu_retained_pair_worker_result_invalid",
        "gosu_retained_pair_worker_cleanup_uncertain",
      ],
    });
    const queue = [contract];
    while (queue.length) {
      const value = queue.pop();
      assert.equal(Object.isFrozen(value), true);
      for (const nested of Object.values(value)) if (nested && typeof nested === "object") queue.push(nested);
    }
  });

  test("worker v1 accepts only one canonical detached transport", async () => {
    const { validateGosuRetainedPairWorkerTransportV1: validate } = await import(SOURCE);
    const value = transportFixture(); const bytes = compact(value); const accepted = validate(bytes);
    bytes.fill(0); value.input.nonce = "f".repeat(24);
    assert.equal(accepted.input.nonce, "a".repeat(24)); assert.equal(Object.isFrozen(accepted), true);
    assert.equal(Object.isFrozen(accepted.input), true); assert.equal(Object.isFrozen(accepted.input.lease), true);
    for (const invalid of [Buffer.from(JSON.stringify(transportFixture())), pretty(transportFixture()),
      compact({ ...transportFixture(), authority: "AUTHORIZED" }), compact({ ...transportFixture(), dependency: {} })]) {
      assert.throws(() => validate(invalid), /gosu_retained_pair_worker_input_invalid/u);
    }
  });

  test("worker v1 public transport validator rejects accessor-bearing Buffers without invoking accessors", async () => {
    const { validateGosuRetainedPairWorkerTransportV1: validate } = await import(SOURCE);
    for (const property of ["length", "includes"]) {
      const bytes = compact(transportFixture()); let reads = 0;
      Object.defineProperty(bytes, property, { configurable: true,
        get() { reads += 1; throw new Error(`private Buffer ${property}`); } });
      assert.throws(() => validate(bytes), /gosu_retained_pair_worker_input_invalid/u);
      assert.equal(reads, 0, property);
    }
  });

  test("worker v1 validates the closed source manifest and Git object bindings", async () => {
    const { validateGosuRetainedPairSourceClosureV1: validate } = await import(SOURCE);
    const source = sourceClosureFixture(); const accepted = validate(source);
    assert.notStrictEqual(accepted, source); assert.deepEqual(accepted, source); assert.equal(Object.isFrozen(accepted.manifest.entries), true);
    for (const mutate of [
      (value) => { value.manifestSha256 = "0".repeat(64); },
      (value) => { value.manifest.entries[0].gitBlobSha1 = "0".repeat(40); },
      (value) => { value.manifest.calcTreeGitSha1 = "0".repeat(40); },
      (value) => { value.acceptance.sha256 = "0".repeat(64); },
      (value) => { value.command = "git"; },
    ]) {
      const changed = globalThis.structuredClone(source); mutate(changed);
      assert.throws(() => validate(changed), /gosu_retained_pair_worker_source_invalid/u);
    }
    assert.throws(() => validate(new Proxy(source, {})), /gosu_retained_pair_worker_source_invalid/u);
    const hostile = globalThis.structuredClone(source); Object.defineProperty(hostile, "kind", { enumerable: true, get() { throw new Error("private getter"); } });
    assert.throws(() => validate(hostile), /gosu_retained_pair_worker_source_invalid/u);
  });

  test("worker v1 accepts the independent Git directory-order oracle", async () => {
    const { validateGosuRetainedPairSourceClosureV1: validate } = await import(SOURCE);
    const oracleFiles = [
      { path: "a.", body: Buffer.from("one\n"), gitBlobSha1: "5626abf0f72e58d7a153368ba57db4c673c0e171" },
      { path: "a/child", body: Buffer.from("two\n"), gitBlobSha1: "f719efd430d52bcfc8566a43b2eb655688d38871" },
      { path: "a0", body: Buffer.from("three\n"), gitBlobSha1: "2bdf67abb163a4ffb2d7f3f0880c9fe5068ce782" },
    ];
    const entries = oracleFiles.map(({ path, body, gitBlobSha1 }) => ({
      path, gitMode: "100644", bytes: body.length, sha256: sha256(body), gitBlobSha1,
    }));
    const manifest = { kind: "GOSU_RETAINED_PAIR_SOURCE_MANIFEST_V1", entries,
      calcTreeGitSha1: "ec6c42a670b2354c45a2e39ce7282d7c373357c0" };
    const source = { ...sourceClosureFixture(), manifest, manifestSha256: sha256(pretty(manifest)),
      calcTreeGitSha1: "ec6c42a670b2354c45a2e39ce7282d7c373357c0" };
    const accepted = validate(source);
    assert.equal(accepted.calcTreeGitSha1, "ec6c42a670b2354c45a2e39ce7282d7c373357c0");
    assert.deepEqual(accepted.manifest.entries.map((entry) => entry.path), ["a.", "a/child", "a0"]);
  });

  test("worker v1 rejects non-string source closure regex fields without coercion", async () => {
    const { validateGosuRetainedPairSourceClosureV1: validate } = await import(SOURCE);
    for (const mutate of [
      (value, hostile) => { value.executionId = hostile; },
      (value, hostile) => { value.manifestSha256 = hostile; },
      (value, hostile) => { value.manifest.calcTreeGitSha1 = hostile; },
    ]) {
      let reads = 0; const hostile = { [Symbol.toPrimitive]() { reads += 1; throw new Error("private source closure"); } };
      const value = sourceClosureFixture(); mutate(value, hostile);
      assert.throws(() => validate(value), /gosu_retained_pair_worker_source_invalid/u);
      assert.equal(reads, 0);
    }
  });

  test("worker v1 diagnostics close real parser failures without private text", async () => {
    const api = await import(SOURCE); let failure;
    try { api.validateGosuRetainedPairWorkerTransportV1(Buffer.from("private path C:/secret\n")); } catch (error) { failure = error; }
    const diagnostic = api.gosuRetainedPairWorkerV1FailureDiagnostic(failure);
    assert.deepEqual(diagnostic, { kind: "GOSU_RETAINED_PAIR_WORKER_FAILURE_V1", state: "FAILED",
      code: "gosu_retained_pair_worker_input_invalid", phase: "INPUT", cleanup: "NOT_STARTED",
      authority: "NOT_AUTHORIZED", preservation: "NOT_ESTABLISHED", dates: null });
    assert.equal(Object.isFrozen(diagnostic), true); assert.doesNotMatch(JSON.stringify(diagnostic), /private|secret|path/u);
  });

  test("worker v1 source fixes the genuine import and exposes no dependency hook", () => {
    const source = fs.readFileSync(SOURCE, "utf8");
    assert.equal((source.match(/from\s+["']\.\/gosu-derivative-image-observation-v2\.mjs["']/gu) ?? []).length, 1);
    assert.match(source, /import\s*\{\s*runGosuDerivativeImageRetainedBuildProofV1\s*\}/u);
    assert.doesNotMatch(source, /producer\s*[:=]|dependencies|dependency|runner\s*[:=]/u);
  });

  test("worker v1 VM accepts one exact genuine-shaped result as PROTOCOL_SIMULATION", async () => {
    const input = transportFixture().input; const result = genuineResultFixture(input); const api = await workerVm();
    const accepted = api.TEST_ONLY_validateProducerResult(api.TEST_ONLY_realmValue(JSON.stringify(result)), input);
    assert.deepEqual(JSON.parse(JSON.stringify(accepted)), result); assert.notStrictEqual(accepted, result);
    assert.equal(Object.isFrozen(accepted), true); assert.equal(Object.isFrozen(accepted.retention.base.physical), true);
  });

  test("worker v1 VM accepts the exact context entry set in a different order", async () => {
    const input = transportFixture().input; const result = genuineResultFixture(input); const api = await workerVm();
    result.context.entries = [...result.context.entries.slice(1), result.context.entries[0]];
    result.context.entries.forEach((entry, ordinal) => { entry.ordinal = ordinal; });
    const accepted = api.TEST_ONLY_validateProducerResult(api.TEST_ONLY_realmValue(JSON.stringify(result)), input);
    assert.deepEqual(JSON.parse(JSON.stringify(accepted.context.entries.map((entry) => entry.path))),
      result.context.entries.map((entry) => entry.path));
  });

  test("worker v1 VM accepts trimmed builder platform members", async () => {
    const input = transportFixture().input; const result = genuineResultFixture(input); const api = await workerVm();
    setBuilderPlatforms(result, "linux/arm64, linux/amd64");
    const accepted = api.TEST_ONLY_validateProducerResult(api.TEST_ONLY_realmValue(JSON.stringify(result)), input);
    assert.equal(accepted.builder.platforms, "linux/arm64, linux/amd64");
    assert.equal(accepted.profiles.builder.stdout.bytes, Buffer.from(accepted.profiles.builder.stdout.base64, "base64").length);
  });

  test("worker v1 VM rejects non-genuine constants and surplus result fields", async () => {
    const input = transportFixture().input; const api = await workerVm();
    for (const mutate of [(value) => { value.state = "RETAINED_PAIR_PROOF_SIMULATION"; },
      (value) => { value.authority = "AUTHORIZED"; }, (value) => { value.scope = "PROTOCOL_SIMULATION"; },
      (value) => { value.retention.unexpected = true; }]) {
      const value = genuineResultFixture(input); mutate(value);
      assert.throws(() => api.TEST_ONLY_validateProducerResult(api.TEST_ONLY_realmValue(JSON.stringify(value)), input),
        /gosu_retained_pair_worker_result_invalid/u);
    }
  });

  test("worker v1 VM rejects nonce and held lease tuple mismatches", async () => {
    const input = transportFixture().input; const api = await workerVm();
    for (const mutate of [(value) => { value.nonce = "b".repeat(24); }, (value) => { value.lease.pid += 1; },
      (value) => { value.lease.startTicks = "9999"; }, (value) => { value.lease.daemonId = "foreign"; }]) {
      const value = genuineResultFixture(input); mutate(value);
      assert.throws(() => api.TEST_ONLY_validateProducerResult(api.TEST_ONLY_realmValue(JSON.stringify(value)), input),
        /gosu_retained_pair_worker_result_invalid/u);
    }
  });

  test("worker v1 VM rejects build-window archive and config cross-binding drift", async () => {
    const input = transportFixture().input; const api = await workerVm();
    for (const mutate of [(value) => { value.retention.buildWindow.completedAtMs += 1; },
      (value) => { value.retention.base.archive.sha256 = "0".repeat(64); },
      (value) => { value.retention.candidate.archive.bytes += 1; },
      (value) => { value.retention.candidate.configId = imageId("0"); },
      (value) => { value.pairProof.base.configId = imageId("0"); }]) {
      const value = genuineResultFixture(input); mutate(value);
      assert.throws(() => api.TEST_ONLY_validateProducerResult(api.TEST_ONLY_realmValue(JSON.stringify(value)), input),
        /gosu_retained_pair_worker_result_invalid/u);
    }
  });

  test("worker v1 VM rejects physical and filesystem-delta drift", async () => {
    const input = transportFixture().input; const api = await workerVm();
    for (const mutate of [(value) => { value.retention.directory.mode = 0o100700; },
      (value) => { value.retention.base.physical.nlink = 2; }, (value) => { value.retention.candidate.physical.uid = 0; },
      (value) => { value.pairProof.delta.candidateMembers += 1; },
      (value) => { value.pairProof.delta.addedFiles.reverse(); }]) {
      const value = genuineResultFixture(input); mutate(value);
      assert.throws(() => api.TEST_ONLY_validateProducerResult(api.TEST_ONLY_realmValue(JSON.stringify(value)), input),
        /gosu_retained_pair_worker_result_invalid/u);
    }
  });

  test("worker v1 VM rejects non-string result digest and config fields without coercion", async () => {
    const input = transportFixture().input; const api = await workerVm();
    for (const mutate of [
      (value, hostile) => { value.retention.base.archive.sha256 = hostile; },
      (value, hostile) => { value.pairProof.candidate.configId = hostile; },
      (value, hostile) => { value.profiles.context.stdout.sha256 = hostile; },
    ]) {
      let reads = 0; const hostile = { [Symbol.toPrimitive]() { reads += 1; throw new Error("private producer result"); } };
      const value = api.TEST_ONLY_realmValue(JSON.stringify(genuineResultFixture(input))); mutate(value, hostile);
      assert.throws(() => api.TEST_ONLY_validateProducerResult(value, input), /gosu_retained_pair_worker_result_invalid/u);
      assert.equal(reads, 0);
    }
  });

  test("worker v1 VM calls the genuine static producer once with one identical input", async () => {
    let calls = 0; let argument; let argumentCount; let api;
    const simulation = workerProtocolSimulationFs(); const transportValue = transportFixture();
    transportValue.sourceClosure.deploymentRoot = simulation.root;
    const producer = function producer(...args) {
      calls += 1; argumentCount = args.length; [argument] = args;
      return api.TEST_ONLY_realmValue(JSON.stringify(genuineResultFixture(argument)));
    };
    api = await workerVm(producer, { fs: simulation.fsModule, createHash: simulation.createHash,
      identifier: "file:///opt/auto-world/deployment/scripts/postgres-image/gosu-retained-pair-worker-v1.mjs",
      environment: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: transportValue.input.lease.dockerConfig } });
    const transport = api.TEST_ONLY_realmValue(JSON.stringify(transportValue));
    const accepted = await api.TEST_ONLY_callPublic(transport);
    assert.equal(accepted.state, "IMAGE_PAIR_RETENTION_SNAPSHOT_OBSERVED_REVIEW_PENDING");
    assert.equal(calls, 1); assert.equal(argumentCount, 1); assert.strictEqual(argument, transport.input);
  });

  test("worker v1 rejects a surplus run argument before calling the genuine producer", async () => {
    let calls = 0; const api = await workerVm(async () => { calls += 1; return genuineResultFixture(); });
    const transport = api.TEST_ONLY_realmValue(JSON.stringify(transportFixture()));
    await assert.rejects(api.TEST_ONLY_callPublic(transport, "surplus"), /gosu_retained_pair_worker_input_invalid/u);
    assert.equal(calls, 0);
  });

  test("worker v1 failure diagnostics never invoke getters or inspect proxies", async () => {
    const { gosuRetainedPairWorkerV1FailureDiagnostic: diagnostic } = await import(SOURCE);
    let reads = 0; const hostile = {};
    for (const key of ["code", "phase", "cleanup"]) Object.defineProperty(hostile, key, { get() { reads += 1; throw new Error("private"); } });
    const fromGetter = diagnostic(hostile); const fromProxy = diagnostic(new Proxy({}, { getOwnPropertyDescriptor() { reads += 1; throw new Error("private"); } }));
    assert.equal(reads, 0);
    for (const value of [fromGetter, fromProxy]) {
      assert.deepEqual(value, { kind: "GOSU_RETAINED_PAIR_WORKER_FAILURE_V1", state: "FAILED",
        code: "gosu_retained_pair_worker_input_invalid", phase: "INPUT", cleanup: "NOT_STARTED",
        authority: "NOT_AUTHORIZED", preservation: "NOT_ESTABLISHED", dates: null });
    }
  });

  test("worker v1 stdout waits for both the end callback and finish", async () => {
    const stdout = new EventEmitter(); let callback; let writes = 0; let written;
    stdout.end = (bytes, done) => { writes += 1; written = Buffer.from(bytes); callback = done; };
    const api = await workerVm(undefined, { stdout }); let settled = false;
    const pending = api.TEST_ONLY_endStdout(Buffer.from("frame\n")).then(() => { settled = true; });
    callback(); await Promise.resolve(); assert.equal(settled, false);
    stdout.emit("finish"); await pending; stdout.emit("close");
    assert.equal(writes, 1); assert.deepEqual(written, Buffer.from("frame\n"));
  });

  test("worker v1 stdout callback error closes without a second frame", async () => {
    const stdout = new EventEmitter(); let writes = 0;
    stdout.end = (bytes, done) => { writes += 1; assert.deepEqual(Buffer.from(bytes), Buffer.from("frame\n")); done(new Error("EPIPE")); };
    const stderr = { write() { throw new Error("stderr must remain unused"); } };
    const api = await workerVm(undefined, { stdout, stderr });
    await assert.rejects(api.TEST_ONLY_endStdout(Buffer.from("frame\n")), /EPIPE/u);
    stdout.emit("error", new Error("late stream error")); stdout.emit("close");
    assert.equal(writes, 1);
  });

  test("worker v1 stdout close before finish is cleanup failure without a second frame", async () => {
    const stdout = new EventEmitter(); let writes = 0;
    stdout.end = () => { writes += 1; globalThis.queueMicrotask(() => stdout.emit("close")); };
    const stderr = { write() { throw new Error("stderr must remain unused"); } };
    const api = await workerVm(undefined, { stdout, stderr });
    await assert.rejects(api.TEST_ONLY_endStdout(Buffer.from("frame\n")), /stdout closed before finish/u);
    assert.equal(writes, 1);
  });
}
