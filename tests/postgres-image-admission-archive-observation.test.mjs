import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash as realCreateHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { TextDecoder } from "node:util";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const SOURCE = new URL("../scripts/postgres-image/admission-archive-observation.mjs", import.meta.url);
const ROOT = "/opt/auto-world/postgres-admission";
const REPOSITORY = "/repo";
const VERIFIER = `${REPOSITORY}/scripts/postgres-image/admission-archive-maintenance.mjs`;
const POLICY = `${REPOSITORY}/infra/postgres-image/admission-policy.json`;
const NODE = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
const NODE_SIZE = 124836408;
const NODE_SHA256 = "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327";
const CAP = 1024 ** 2;
const NOW = Date.parse("2026-10-06T12:00:00.000Z");

function canonical(value) { return Buffer.from(`${JSON.stringify(value)}\n`, "utf8"); }
function sha256(bytes) { return realCreateHash("sha256").update(bytes).digest("hex"); }
function synthetic(context, identifier, values) {
  const names = Object.keys(values);
  return new vm.SyntheticModule(names, function initialize() {
    for (const name of names) this.setExport(name, values[name]);
  }, { context, identifier });
}

function makeVirtualFileSystem(configuration, commandBytes, policyBytes, inputBytes, sidecarBytes) {
  const entries = new Map(), descriptors = new Map(), mutations = [], reads = [], order = [];
  let nextIno = 1000n, nextFd = 20, published = false, markerUnlinked = false;
  let postRenameFsyncFailed = false, readCloseFailed = false, commitCloseFailed = false, targetLstatsAfterPublish = 0;
  const add = (name, type, mode, content = null, size = content?.length ?? 0, digest = null) => {
    entries.set(name, { name, type, mode, content, size, digest, ino: nextIno++ });
  };
  for (const name of [
    "/opt", "/opt/auto-world", ROOT, `${ROOT}/archive-health`, "/opt/auto-world/toolchains",
    "/opt/auto-world/toolchains/node-v22.23.2-linux-x64", "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin",
    REPOSITORY, `${REPOSITORY}/scripts`, `${REPOSITORY}/scripts/postgres-image`, `${REPOSITORY}/infra`,
    `${REPOSITORY}/infra/postgres-image`,
  ]) add(name, "directory", name === `${ROOT}/archive-health` ? 0o700 : 0o755);
  add(`${ROOT}/maintenance-generation-1.json`, "file", 0o400, inputBytes);
  add(`${ROOT}/maintenance-generation-1.sha256`, "file", 0o400, sidecarBytes);
  add(VERIFIER, "file", 0o400, commandBytes);
  add(POLICY, "file", 0o400, policyBytes);
  add(NODE, "file", 0o755, null, NODE_SIZE, configuration.nodeDigest ?? NODE_SHA256);
  if (configuration.preexistingMarker) {
    add(`${ROOT}/archive-health/.generation-1.update-intent`, "file", 0o600, Buffer.from("foreign-marker\n"));
  }
  if (configuration.foreignTarget) {
    add(`${ROOT}/archive-health/generation-1.json`, "file", 0o644, Buffer.from("foreign-target\n"));
  }

  if (configuration.tamper === "command") entries.get(VERIFIER).content = Buffer.from("tampered-command\n");
  if (configuration.tamper === "policy") entries.get(POLICY).content = Buffer.from("tampered-policy\n");
  if (configuration.tamper === "sidecar") entries.get(`${ROOT}/maintenance-generation-1.sha256`).content = Buffer.from(`${"0".repeat(64)}\n`);
  for (const entry of entries.values()) if (entry.content) entry.size = entry.content.length;

  const status = entry => ({
    dev: 2096n, ino: entry.ino, uid: 0n, gid: 0n, mode: BigInt(entry.mode), nlink: 1n,
    size: BigInt(entry.size), mtimeNs: 1n, ctimeNs: 1n,
    isFile: () => entry.type === "file", isDirectory: () => entry.type === "directory", isSymbolicLink: () => false,
  });
  const missing = () => { const error = new Error("ENOENT"); error.code = "ENOENT"; throw error; };
  const constants = { O_RDONLY: 0, O_NOFOLLOW: 1, O_DIRECTORY: 2, O_CREAT: 4, O_EXCL: 8, O_WRONLY: 16 };
  const fs = {
    constants,
    lstatSync(name) {
      const entry = entries.get(name); if (!entry) return missing();
      if (configuration.readbackResealFail && published && name === `${ROOT}/archive-health/generation-1.json`
        && ++targetLstatsAfterPublish === 2) {
        const changed = { ...entry, ino: entry.ino + 1n }; return status(changed);
      }
      return status(entry);
    },
    fstatSync(fd) { const entry = descriptors.get(fd); if (!entry) throw new Error("EBADF"); return status(entry); },
    openSync(name, flags, mode) {
      let entry = entries.get(name);
      if ((flags & constants.O_CREAT) !== 0) {
        if (entry && (flags & constants.O_EXCL) !== 0) throw new Error("EEXIST");
        entry = { name, type: "file", mode, content: Buffer.alloc(0), size: 0, digest: null, ino: nextIno++ };
        entries.set(name, entry); mutations.push({ operation: "create", name }); order.push(`create:${name}`);
      }
      if (!entry) return missing();
      const fd = nextFd++; descriptors.set(fd, entry); order.push(`open:${name}:${fd}`); return fd;
    },
    readSync(fd, buffer, bufferOffset, length, position) {
      const entry = descriptors.get(fd); if (!entry || entry.type !== "file") throw new Error("EBADF");
      reads.push(entry.name);
      if (position >= entry.size) return 0;
      const count = Math.min(length, entry.size - position);
      if (entry.content) entry.content.copy(buffer, bufferOffset, position, position + count);
      else if (buffer?.__sparse) buffer.__digest = entry.digest;
      return count;
    },
    writeSync(fd, buffer, bufferOffset, length, position) {
      const entry = descriptors.get(fd); if (!entry || entry.type !== "file") throw new Error("EBADF");
      const next = Buffer.alloc(Math.max(entry.size, position + length));
      entry.content.copy(next); buffer.copy(next, position, bufferOffset, bufferOffset + length);
      entry.content = next; entry.size = next.length; mutations.push({ operation: "write", name: entry.name, length });
      return length;
    },
    fsyncSync(fd) {
      const entry = descriptors.get(fd); if (!entry) throw new Error("EBADF");
      mutations.push({ operation: "fsync", name: entry.name }); order.push(`fsync:${entry.name}:${fd}`);
      if (configuration.failTemporaryFsync && entry.name.endsWith(".tmp")) throw new Error("fsync failed");
      if (configuration.postRenameParentFsyncFail && published && !postRenameFsyncFailed
        && entry.name === `${ROOT}/archive-health`) {
        postRenameFsyncFailed = true; throw new Error("post-rename parent fsync failed");
      }
    },
    closeSync(fd) {
      const entry = descriptors.get(fd); if (!entry) throw new Error("EBADF");
      descriptors.delete(fd); order.push(`close:${entry.name}:${fd}`);
      if (configuration.readDescriptorCloseFail && published && !readCloseFailed
        && entry.name === `${ROOT}/archive-health/generation-1.json`) {
        readCloseFailed = true; throw new Error("read descriptor close failed");
      }
      if (configuration.finalCommitCloseFail && markerUnlinked && !commitCloseFailed
        && entry.name === `${ROOT}/archive-health`) {
        commitCloseFailed = true; throw new Error("final commit close failed");
      }
    },
    renameSync(from, to) {
      const entry = entries.get(from); if (!entry) return missing();
      entries.delete(from); entry.name = to; entries.set(to, entry); mutations.push({ operation: "rename", from, to });
      order.push(`rename:${from}->${to}`); if (to === `${ROOT}/archive-health/generation-1.json`) published = true;
    },
    unlinkSync(name) {
      if (!entries.has(name)) return missing();
      entries.delete(name); mutations.push({ operation: "unlink", name }); order.push(`unlink:${name}`);
      if (name === `${ROOT}/archive-health/.generation-1.update-intent`) markerUnlinked = true;
    },
  };
  const addPrior = envelope => add(`${ROOT}/archive-health/generation-1.json`, "file", 0o600, canonical(envelope));
  return { fs, entries, mutations, reads, order, addPrior };
}

function makeReport(bindings, outcome) {
  let completed = NOW - 60_000;
  if (outcome === "expired") completed = NOW - 86_400_001;
  if (outcome === "future") completed = NOW + 1;
  const report = {
    kind: "POSTGRES_ADMISSION_ARCHIVE_FULL_V1", state: "VERIFIED", scope: "COMPLETE_ARCHIVE_HEALTH",
    completedAt: new Date(completed).toISOString(), validUntil: new Date(completed + 86_400_000).toISOString(), ...bindings,
  };
  if (outcome === "wrongBindings") report.archiveLocatorSha256 = "f".repeat(64);
  return report;
}

async function loadObservation(configuration = {}) {
  const commandBytes = Buffer.from("archive-maintenance-command\n"), policyBytes = Buffer.from("admission-policy\n");
  const command = { size: commandBytes.length, sha256: sha256(commandBytes) };
  const policy = { size: policyBytes.length, sha256: sha256(policyBytes) };
  const generationRoot = { admissionGeneration: 1, executionFiles: [
    { path: "scripts/postgres-image/admission-archive-maintenance.mjs", ...command },
  ] };
  const generationRootSha256 = sha256(canonical(generationRoot));
  const input = {
    schemaVersion: 1, kind: "POSTGRES_ADMISSION_ARCHIVE_MAINTENANCE_INPUT_V1", generationRoot,
    generationRootSha256: configuration.tamper === "rootDigest" ? "0".repeat(64) : generationRootSha256,
    command, policy, supportStartedAt: "2026-10-06", supportEndsAt: "2027-10-06", archiveUntil: "2028-10-06",
  };
  const inputBytes = canonical(input), sidecarBytes = Buffer.from(`${sha256(inputBytes)}\n`);
  const virtual = makeVirtualFileSystem(configuration, commandBytes, policyBytes, inputBytes, sidecarBytes);
  const bindings = {
    admissionGeneration: 1, generationRootSha256, archiveLocatorSha256: "a".repeat(64),
    executionFilesSha256: "b".repeat(64),
    roots: ["evidenceCopy", "evidenceRetrieve", "controlCopy", "controlRetrieve"].map((role, index) => ({
      role, references: index < 2 ? 1094 : 44, objects: index < 2 ? 840 : 43,
      bytes: index < 2 ? 1023937063 : 139006319, membershipSha256: String(index + 1).repeat(64),
    })),
    imageArchive: { size: 305474048, sha256: "2c1b6b002076fa3772aa9fc899befb86fe525aee1ee1c8007d85bba200c73a05" },
    claims: { readOnly: true, objectPayloadParsed: false, runtimeAuthority: "NOT_GRANTED", admission: "NOT_AUTHORIZED" },
  };
  const fast = { kind: "POSTGRES_ADMISSION_ARCHIVE_FAST_V1", state: "VERIFIED", scope: "LEASE_IDENTITY_ONLY", ...bindings };
  const report = makeReport(bindings, configuration.outcome);
  if (configuration.prior === "newer") {
    virtual.addPrior({
      kind: "POSTGRES_ADMISSION_ARCHIVE_HEALTH_ENVELOPE_V1", state: "VERIFIED",
      observedAt: new Date(NOW + 1).toISOString(), report: { generationRootSha256, completedAt: new Date(NOW).toISOString() },
      process: {}, command, policy,
    });
  }

  const spawnCalls = [];
  const spawn = (executable, args, options) => {
    spawnCalls.push({ executable, args, options });
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let closed = false;
    const close = (status, signal) => {
      if (closed) return; closed = true; virtual.order.push("child:close"); child.emit("close", status, signal);
    };
    child.kill = signal => { virtual.order.push(`child:kill:${signal}`); Promise.resolve().then(() => close(null, "SIGKILL")); return true; };
    Promise.resolve().then(() => {
      const outcome = configuration.outcome;
      if (outcome === "oversize") { child.stdout.emit("data", Buffer.alloc(CAP + 1)); return; }
      const stdout = outcome === "noncanonical" ? Buffer.from(` ${JSON.stringify(report)}\n`) : canonical(report);
      child.stdout.emit("data", stdout);
      if (outcome === "stderr") child.stderr.emit("data", Buffer.from("private detail"));
      child.stdout.emit("end"); virtual.order.push("stdout:end");
      if (outcome !== "missingEOF" && outcome !== "closeBeforeEnd") {
        child.stderr.emit("end"); virtual.order.push("stderr:end");
      }
      if (outcome === "nonzero") close(1, null);
      else if (outcome === "signal") close(null, "SIGTERM");
      else close(0, null);
      if (outcome === "closeBeforeEnd") { child.stderr.emit("end"); virtual.order.push("stderr:end:late"); }
    });
    return child;
  };
  const fakeCreateHash = algorithm => {
    const hash = realCreateHash(algorithm); let sparseDigest = null;
    return {
      update(bytes) { if (bytes?.__sparse) sparseDigest = bytes.__digest; else hash.update(bytes); return this; },
      digest(encoding) { return sparseDigest ?? hash.digest(encoding); },
    };
  };
  const BufferFacade = {
    alloc(size) { return size > CAP ? { __sparse: true, __digest: null, length: size } : Buffer.alloc(size); },
    byteLength: Buffer.byteLength.bind(Buffer), concat: Buffer.concat.bind(Buffer), from: Buffer.from.bind(Buffer),
  };
  class FixedDate extends Date {
    constructor(...args) { super(args.length === 0 ? NOW : args[0]); }
    static now() { return NOW; }
  }
  const processMock = { platform: "linux", getuid: () => 0, getgid: () => 0,
    argv: [NODE, "/not-the-observation-main.mjs", "--generation", "1"], env: { SECRET_TOKEN: "must-not-propagate" } };
  const context = vm.createContext({ Buffer: BufferFacade, Date: FixedDate, process: processMock,
    setTimeout, clearTimeout, TextDecoder, console });
  const dependencies = new Map([
    ["node:child_process", synthetic(context, "mock:child_process", { spawn })],
    ["node:crypto", synthetic(context, "mock:crypto", { createHash: fakeCreateHash })],
    ["node:fs", synthetic(context, "mock:fs", { default: virtual.fs })],
    ["node:path", synthetic(context, "mock:path", { default: path.posix })],
    ["node:timers", synthetic(context, "mock:timers", { clearTimeout, setTimeout })],
    ["node:url", synthetic(context, "mock:url", { fileURLToPath: () => "/repo/scripts/postgres-image/admission-archive-observation.mjs" })],
    ["node:util", synthetic(context, "mock:util", {
      isDeepStrictEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right), TextDecoder,
    })],
    ["./admission-archive-maintenance.mjs", synthetic(context, "mock:maintenance", {
      loadPostgresAdmissionArchiveContext: root => ({ root }),
      verifyPostgresAdmissionArchiveFast: () => configuration.fastChanged
        ? { ...fast, archiveLocatorSha256: "e".repeat(64) } : fast,
    })],
  ]);
  const module = new vm.SourceTextModule(readFileSync(SOURCE, "utf8"), {
    context, identifier: "file:///repo/scripts/postgres-image/admission-archive-observation.mjs",
    initializeImportMeta(meta) { meta.url = "file:///repo/scripts/postgres-image/admission-archive-observation.mjs"; },
  });
  await module.link(specifier => {
    const dependency = dependencies.get(specifier); if (!dependency) throw new Error(`unexpected dependency ${specifier}`); return dependency;
  });
  await module.evaluate();
  return { namespace: module.namespace, virtual, spawnCalls, command, policy, report };
}

if (typeof vm.SourceTextModule !== "function") {
  test("archive observation VM tests", () => {
    const childEnv = { ...process.env, AUTO_WORLD_ADMISSION_VM: "1" };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--test", SELF], {
      env: childEnv, encoding: "utf8", timeout: 60_000,
    });
    const transcript = `${result.stdout}\n${result.stderr}`;
    const count = /# tests (\d+)/u.exec(result.stdout);
    assert.doesNotMatch(transcript, /recursively within a test file|skipping running files/u);
    assert.ok(count && Number(count[1]) > 0, transcript);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
} else {
  test("observation authenticates fixed inputs, waits for both EOFs and close, then retains canonical health", async () => {
    const value = await loadObservation();
    assert.deepEqual(Object.keys(value.namespace), ["retainPostgresAdmissionArchiveObservation"]);
    const result = await value.namespace.retainPostgresAdmissionArchiveObservation();
    assert.equal(result.state, "RETAINED");
    assert.deepEqual(JSON.parse(JSON.stringify(value.spawnCalls)), [{
      executable: NODE,
      args: ["--disable-proto=throw", VERIFIER, "--generation", "1", "--mode", "FULL"],
      options: { cwd: REPOSITORY, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: "/nonexistent" },
        stdio: ["ignore", "pipe", "pipe"] },
    }]);
    for (const fixed of [`${ROOT}/maintenance-generation-1.json`, `${ROOT}/maintenance-generation-1.sha256`,
      VERIFIER, POLICY, NODE]) assert.equal(value.virtual.reads.includes(fixed), true, fixed);
    const create = value.virtual.order.indexOf(`create:${ROOT}/archive-health/.generation-1.tmp`);
    assert.ok(value.virtual.order.indexOf("stdout:end") < value.virtual.order.indexOf("child:close"));
    assert.ok(value.virtual.order.indexOf("stderr:end") < value.virtual.order.indexOf("child:close"));
    assert.ok(value.virtual.order.indexOf("child:close") < create);
    const retained = JSON.parse(value.virtual.entries.get(`${ROOT}/archive-health/generation-1.json`).content);
    assert.deepEqual(retained.process, { status: 0, signal: null, closed: true, stdoutEOF: true, stderrEOF: true });
    assert.deepEqual(retained.command, value.command); assert.deepEqual(retained.policy, value.policy);
    assert.deepEqual(retained.report, value.report);
    const marker = `${ROOT}/archive-health/.generation-1.update-intent`;
    const temporary = `${ROOT}/archive-health/.generation-1.tmp`;
    assert.equal(value.virtual.entries.has(marker), false);
    const markerOpenIndex = value.virtual.order.findIndex(item => item.startsWith(`open:${marker}:`));
    const markerFd = value.virtual.order[markerOpenIndex].split(":").at(-1);
    const markerFsyncIndex = value.virtual.order.indexOf(`fsync:${marker}:${markerFd}`);
    const temporaryCreateIndex = value.virtual.order.indexOf(`create:${temporary}`);
    const unlinkIndex = value.virtual.order.indexOf(`unlink:${marker}`);
    assert.ok(markerOpenIndex >= 0 && markerFsyncIndex > markerOpenIndex && markerFsyncIndex < temporaryCreateIndex);
    assert.ok(value.virtual.order.indexOf(`close:${marker}:${markerFd}`) < unlinkIndex);
    for (const directory of ["/opt", "/opt/auto-world", ROOT, `${ROOT}/archive-health`]) {
      const heldOpen = value.virtual.order.slice(0, markerOpenIndex).findLast(item => item.startsWith(`open:${directory}:`));
      const heldFd = heldOpen.split(":").at(-1);
      assert.ok(value.virtual.order.indexOf(`close:${directory}:${heldFd}`) < unlinkIndex, directory);
    }
  });

  test("observation rejects every authenticated-input substitution before spawning or writing", async () => {
    for (const configuration of [
      { tamper: "sidecar" }, { tamper: "rootDigest" }, { tamper: "command" }, { tamper: "policy" },
      { nodeDigest: "0".repeat(64) },
    ]) {
      const value = await loadObservation(configuration);
      await assert.rejects(value.namespace.retainPostgresAdmissionArchiveObservation(),
        /postgres_admission_archive_observation_failed/u);
      assert.equal(value.spawnCalls.length, 0); assert.deepEqual(value.virtual.mutations, []);
    }
  });

  test("observation rejects process, stream, canonicality, size, currentness and binding failures without retaining", async () => {
    for (const outcome of ["nonzero", "signal", "missingEOF", "closeBeforeEnd", "stderr", "noncanonical", "oversize",
      "wrongBindings", "expired", "future"]) {
      const value = await loadObservation({ outcome });
      await assert.rejects(value.namespace.retainPostgresAdmissionArchiveObservation(),
        /postgres_admission_archive_observation_failed/u, outcome);
      assert.equal(value.virtual.entries.has(`${ROOT}/archive-health/generation-1.json`), false, outcome);
      assert.equal(value.virtual.mutations.length, 0, outcome);
    }
  });

  test("observation failure before atomic rename cannot expose a successful health envelope", async () => {
    const value = await loadObservation({ failTemporaryFsync: true });
    await assert.rejects(value.namespace.retainPostgresAdmissionArchiveObservation());
    assert.equal(value.virtual.entries.has(`${ROOT}/archive-health/generation-1.json`), false);
    assert.equal(value.virtual.entries.has(`${ROOT}/archive-health/.generation-1.update-intent`), true);
    assert.equal(value.virtual.mutations.some(item => item.operation === "rename"), false);
  });

  test("post-publication uncertainty fails closed and leaves a durable update marker", async () => {
    for (const configuration of [
      { postRenameParentFsyncFail: true },
      { readbackResealFail: true },
      { readDescriptorCloseFail: true },
      { finalCommitCloseFail: true },
    ]) {
      const value = await loadObservation(configuration);
      await assert.rejects(value.namespace.retainPostgresAdmissionArchiveObservation(),
        /postgres_admission_archive_observation_failed/u);
      assert.equal(value.virtual.entries.has(`${ROOT}/archive-health/generation-1.json`), true);
      assert.equal(value.virtual.entries.has(`${ROOT}/archive-health/.generation-1.update-intent`), true);
      assert.equal(value.virtual.mutations.some(item => item.operation === "rename"), true);
    }
  });

  test("preexisting update intent and foreign target fail before any filesystem mutation", async () => {
    for (const configuration of [{ preexistingMarker: true }, { foreignTarget: true }]) {
      const value = await loadObservation(configuration);
      const marker = value.virtual.entries.get(`${ROOT}/archive-health/.generation-1.update-intent`)?.content;
      const target = value.virtual.entries.get(`${ROOT}/archive-health/generation-1.json`)?.content;
      await assert.rejects(value.namespace.retainPostgresAdmissionArchiveObservation(),
        /postgres_admission_archive_observation_failed/u);
      assert.deepEqual(value.virtual.mutations, []);
      if (marker) assert.equal(value.virtual.entries.get(`${ROOT}/archive-health/.generation-1.update-intent`).content.equals(marker), true);
      if (target) assert.equal(value.virtual.entries.get(`${ROOT}/archive-health/generation-1.json`).content.equals(target), true);
    }
  });

  test("observation refuses to replace a newer retained observation", async () => {
    const value = await loadObservation({ prior: "newer" });
    const before = Buffer.from(value.virtual.entries.get(`${ROOT}/archive-health/generation-1.json`).content);
    await assert.rejects(value.namespace.retainPostgresAdmissionArchiveObservation(),
      /postgres_admission_archive_observation_failed/u);
    assert.equal(value.virtual.entries.get(`${ROOT}/archive-health/generation-1.json`).content.equals(before), true);
    assert.deepEqual(value.virtual.mutations, []);
  });
}
