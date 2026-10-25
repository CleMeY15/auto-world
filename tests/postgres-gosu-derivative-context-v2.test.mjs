import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { candidateContractV2, openCandidateLockV2 } from "../scripts/postgres-image/gosu-derivative-candidate-v2.mjs";
import { scanRawUstar } from "../scripts/seaweed-image/archive.mjs";

const SELF = fileURLToPath(import.meta.url);
const SOURCE = new URL("../scripts/postgres-image/gosu-derivative-context-v2.mjs", import.meta.url);
const LOCK = new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url);
const ZIP_NAME = Buffer.from("gosu-preparation-1.tar", "ascii");
const DOS_DATE = 23_885;
const DOS_TIME = 48_292;
const ZIP_CAP = 142_606_336;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (bytes) => ({ bytes: bytes.byteLength, sha256: sha256(bytes) });

function crc32(bytes) {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
  }
  return ((crc ^ 0xffff_ffff) >>> 0).toString(16).padStart(8, "0");
}

function storedZip(tarBytes) {
  const crc = Number.parseInt(crc32(tarBytes), 16);
  const local = Buffer.alloc(30 + ZIP_NAME.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6);
  local.writeUInt16LE(0, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(0, 14); local.writeUInt32LE(0, 18); local.writeUInt32LE(0, 22);
  local.writeUInt16LE(ZIP_NAME.length, 26); local.writeUInt16LE(0, 28); ZIP_NAME.copy(local, 30);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(tarBytes.length, 8); descriptor.writeUInt32LE(tarBytes.length, 12);
  const central = Buffer.alloc(46 + ZIP_NAME.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x032d, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(tarBytes.length, 20); central.writeUInt32LE(tarBytes.length, 24);
  central.writeUInt16LE(ZIP_NAME.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0x81800020, 38);
  central.writeUInt32LE(0, 42); ZIP_NAME.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + tarBytes.length + descriptor.length, 16); eocd.writeUInt16LE(0, 20);
  const zip = Buffer.concat([local, tarBytes, descriptor, central, eocd]);
  return { zip, expected: { zip: identity(zip), tar: identity(tarBytes), crc32: crc32(tarBytes) } };
}

function syntheticEntries() {
  const contract = candidateContractV2(openCandidateLockV2(readFileSync(LOCK)));
  return contract.contextEntries.map((entry, index) => {
    const metadata = { path: entry.path, type: entry.type, mode: entry.mode, uid: entry.uid, gid: entry.gid,
      mtime: entry.mtime, size: entry.type === "directory" ? 0 : undefined };
    if (entry.type === "directory") return metadata;
    const body = Buffer.from(`FORMAT_ONLY synthetic entry ${index}: ${entry.path}\n`, "utf8");
    return { ...metadata, size: body.length, sha256: sha256(body), body };
  });
}

async function loadModule({ testOnly = false } = {}) {
  let source = readFileSync(SOURCE, "utf8");
  if (testOnly) source += "\nexport { verifyCandidateContextUstarV2 as TEST_ONLY_verifyCandidateContextUstarV2, materializeCandidateContextV2WithAdapters as TEST_ONLY_materializeCandidateContextV2WithAdapters, snapshotNativeStatV2 as TEST_ONLY_snapshotNativeStatV2, makeDirectorySessionV2 as TEST_ONLY_makeDirectorySessionV2, writeDurableFileV2 as TEST_ONLY_writeDurableFileV2, closeAndReadbackV2 as TEST_ONLY_closeAndReadbackV2, promotePartialV2 as TEST_ONLY_promotePartialV2, publishClosedDocumentV2 as TEST_ONLY_publishClosedDocumentV2 };\n";
  const context = vm.createContext({ Buffer, console, process, structuredClone: globalThis.structuredClone,
    TextDecoder: globalThis.TextDecoder, TextEncoder: globalThis.TextEncoder, URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams, AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
  const module = new vm.SourceTextModule(source, {
    context, identifier: SOURCE.href, initializeImportMeta(meta) { meta.url = SOURCE.href; },
  });
  await module.link(async (specifier, referencingModule) => {
    if (specifier.startsWith("node:")) {
      const values = await import(specifier); const names = Object.keys(values);
      return new vm.SyntheticModule(names, function initialize() {
        for (const name of names) this.setExport(name, values[name]);
      }, { context, identifier: `synthetic:${specifier}` });
    }
    const target = new URL(specifier, referencingModule.identifier);
    const values = await import(target); const names = Object.keys(values);
    return new vm.SyntheticModule(names, function initialize() {
      for (const name of names) this.setExport(name, values[name]);
    }, { context, identifier: `synthetic:${target.href}` });
  });
  await module.evaluate();
  return { api: module.namespace, context };
}

const loadPublic = () => import(SOURCE.href);
function entriesInContext(context, entries) {
  context.TEST_ONLY_ENTRY_JSON = JSON.stringify(entries.map(({ body, ...entry }) => ({
    ...entry, body: body === undefined ? undefined : body.toString("base64"),
  })));
  return vm.runInContext("JSON.parse(TEST_ONLY_ENTRY_JSON).map(({ body, ...entry }) => body === undefined ? entry : ({ ...entry, body: Buffer.from(body, 'base64') }))", context);
}

function durableHarness(configuration = {}) {
  const constants = { O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 4, O_EXCL: 8, O_NOFOLLOW: 16, O_DIRECTORY: 32 };
  const nodes = new Map(), handles = new Map(), operations = []; let nextFd = 20; let nextIno = 100n;
  const directoryPath = "/private/context";
  const directory = { type: "directory", mode: 0o40700, uid: 1000, gid: 1000, ino: nextIno++, nlink: 1,
    mtimeNs: 1n, ctimeNs: 1n, birthtimeNs: 0n, bytes: Buffer.alloc(0) };
  nodes.set(directoryPath, directory); const directoryFd = nextFd++; handles.set(directoryFd, directory);
  const error = (code) => Object.assign(new Error(code), { code });
  const label = (node) => [...nodes].find(([, candidate]) => candidate === node)?.[0] ?? "<unlinked>";
  const stat = (node) => ({ dev: 70n, ino: node.ino, mode: BigInt(node.mode), nlink: BigInt(node.nlink),
    size: BigInt(node.bytes.length), uid: BigInt(node.uid), gid: BigInt(node.gid), mtimeNs: node.mtimeNs ?? 1n,
    ctimeNs: node.ctimeNs ?? 1n, birthtimeNs: node.birthtimeNs ?? 0n,
    isFile: () => node.type === "file", isDirectory: () => node.type === "directory",
    isSymbolicLink: () => false });
  const counts = new Map();
  const point = (operation, file, { deferFailure = false } = {}) => {
    operations.push([operation, file]); const key = `${operation}:${file}`; const count = (counts.get(key) ?? 0) + 1; counts.set(key, count);
    if (configuration.fail?.operation === operation && configuration.fail.file === file
      && count === (configuration.fail.at ?? 1)) {
      const failure = error(configuration.fail.code ?? "EIO"); if (deferFailure) return failure; throw failure;
    }
    return undefined;
  };
  const io = {
    constants,
    openSync(file, flags, mode) {
      let node = nodes.get(file);
      if ((flags & constants.O_CREAT) !== 0) {
        point("create", file); if (node && (flags & constants.O_EXCL) !== 0) throw error("EEXIST");
        node = { type: "file", mode: 0o100000 | mode, uid: 1000, gid: 1000, ino: nextIno++, nlink: 1, bytes: Buffer.alloc(0) };
        nodes.set(file, node);
      } else point("open", file);
      if (!node) throw error("ENOENT"); const fd = nextFd++; handles.set(fd, node); return fd;
    },
    closeSync(fd) {
      const node = handles.get(fd); if (!node) throw error("EBADF");
      const deferred = point("close", label(node), { deferFailure: configuration.fail?.afterRetirement === true });
      handles.delete(fd); if (deferred) throw deferred;
    },
    fstatSync(fd) { const node = handles.get(fd); if (!node) throw error("EBADF"); point("fstat", label(node)); return stat(node); },
    lstatSync(file) { const node = nodes.get(file); if (!node) throw error("ENOENT"); point("lstat", file); return stat(node); },
    realpathSync(file) { if (!nodes.has(file)) throw error("ENOENT"); return file; },
    writeSync(fd, bytes, offset, length, position) {
      const node = handles.get(fd); if (!node) throw error("EBADF"); const file = label(node); point("write", file);
      if (configuration.zeroWrite) return 0;
      const next = Buffer.alloc(Math.max(node.bytes.length, position + length)); node.bytes.copy(next); bytes.copy(next, position, offset, offset + length); node.bytes = next; return length;
    },
    readSync(fd, bytes, offset, length, position) {
      const node = handles.get(fd); if (!node) throw error("EBADF"); const file = label(node); point("read", file);
      if (position >= node.bytes.length) return 0; const count = Math.min(length, node.bytes.length - position);
      node.bytes.copy(bytes, offset, position, position + count); if (configuration.corruptRead && position === 0) bytes[offset] ^= 1; return count;
    },
    fsyncSync(fd) {
      const node = handles.get(fd); if (!node) throw error("EBADF"); const file = label(node); point("fsync", file);
      if (configuration.failFinalFileFsync && node.type === "file" && node.nlink === 1
        && nodes.has(`${directoryPath}/context.tar`) && !nodes.has(`${directoryPath}/context.tar.partial`)) throw error("EIO");
    },
    linkSync(from, to) {
      point("link", `${from}->${to}`); const source = nodes.get(from); if (!source) throw error("ENOENT");
      if (nodes.has(to)) throw error("EEXIST"); nodes.set(to, source); source.nlink += 1;
    },
    unlinkSync(file) { point("unlink", file); const node = nodes.get(file); if (!node) throw error("ENOENT"); nodes.delete(file); node.nlink -= 1; },
  };
  const session = { file: directoryPath, fd: directoryFd, guard() { point("guard", directoryPath); },
    refresh(allowed) { point("refresh", directoryPath); return allowed; } };
  const put = (file, bytes) => {
    const node = { type: "file", mode: 0o100600, uid: 1000, gid: 1000, ino: nextIno++, nlink: 1, bytes: Buffer.from(bytes) };
    nodes.set(file, node); return node;
  };
  return { io, session, nodes, handles, operations, directoryPath, directoryFd, directory, put };
}

if (typeof vm.SourceTextModule !== "function") {
  test("derivative context VM tests relaunch with a nonempty child suite", () => {
    const childEnv = { ...process.env, AUTO_WORLD_GOSU_CONTEXT_VM: "1" }; delete childEnv.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--test", SELF], {
      env: childEnv, encoding: "utf8", timeout: 300_000,
    });
    const transcript = `${result.stdout}\n${result.stderr}`; const count = /# tests (\d+)/u.exec(result.stdout);
    assert.doesNotMatch(transcript, /recursively within a test file|skipping running files/u);
    assert.ok(count && Number(count[1]) > 0, transcript);
    assert.equal(result.status, 0, transcript);
  });
} else {
  test("the production module exports only the three closed public interfaces", async () => {
    const api = await loadPublic();
    assert.deepEqual(Object.keys(api).sort(), ["encodeCandidateContextUstarV2", "materializeCandidateContextV2", "parseStoredPreparationZipV2"]);
  });

  test("the fixed stored ZIP profile returns detached TAR bytes and exact identities", async () => {
    const api = await loadPublic(); const tar = Buffer.from("FORMAT_ONLY synthetic stored TAR bytes\n", "utf8");
    const fixture = storedZip(tar); const parsed = api.parseStoredPreparationZipV2(fixture.zip, fixture.expected);
    assert.deepEqual(Buffer.from(parsed.tarBytes), tar);
    assert.deepEqual(parsed.tarIdentity, identity(tar));
    assert.notEqual(parsed.tarBytes.buffer, fixture.zip.buffer);
    assert.equal(Object.isFrozen(parsed.profile), true);
    assert.deepEqual(parsed.profile, {
      kind: "GOSU_PREPARATION_STORED_ZIP_PROFILE_V2", name: "gosu-preparation-1.tar", flags: 8, method: 0,
      localOffset: 0, dataOffset: 52, descriptorOffset: 52 + tar.length, centralOffset: 68 + tar.length,
      eocdOffset: 136 + tar.length, localBytes: 52, descriptorBytes: 16, centralBytes: 68, eocdBytes: 22,
    });
  });

  test("the ZIP parser rejects mutations in every fixed structural region", async () => {
    const api = await loadPublic(); const tar = Buffer.from("FORMAT_ONLY ZIP mutation fixture\n", "utf8");
    const fixture = storedZip(tar); const offsets = [0, 4, 6, 8, 10, 12, 26, 28,
      30, 30 + ZIP_NAME.length + tar.length, 30 + ZIP_NAME.length + tar.length + 4,
      30 + ZIP_NAME.length + tar.length + 16, fixture.zip.length - 22, fixture.zip.length - 2];
    for (const offset of offsets) {
      const changed = Buffer.from(fixture.zip); changed[offset] ^= 1;
      const expected = { ...fixture.expected, zip: identity(changed) };
      assert.throws(() => api.parseStoredPreparationZipV2(changed, expected), undefined, `offset ${offset}`);
    }
  });

  test("the ZIP parser rejects CRC, TAR identity and trailing bytes independently", async () => {
    const api = await loadPublic(); const tar = Buffer.from("FORMAT_ONLY ZIP identity fixture\n", "utf8");
    const fixture = storedZip(tar);
    assert.throws(() => api.parseStoredPreparationZipV2(fixture.zip, { ...fixture.expected, crc32: "00000000" }));
    assert.throws(() => api.parseStoredPreparationZipV2(fixture.zip, { ...fixture.expected,
      tar: { ...fixture.expected.tar, sha256: "0".repeat(64) } }));
    const trailed = Buffer.concat([fixture.zip, Buffer.from([0])]);
    assert.throws(() => api.parseStoredPreparationZipV2(trailed, { ...fixture.expected, zip: identity(trailed) }));
  });

  test("the ZIP parser rejects hostile native-byte and identity shapes without invoking caller hooks", async () => {
    const api = await loadPublic(); const fixture = storedZip(Buffer.from("FORMAT_ONLY hostile ZIP\n", "utf8"));
    assert.throws(() => api.parseStoredPreparationZipV2(new Proxy(fixture.zip, {}), fixture.expected));
    assert.throws(() => api.parseStoredPreparationZipV2(new (class extends Uint8Array {})(fixture.zip), fixture.expected));
    const shared = new Uint8Array(new SharedArrayBuffer(fixture.zip.length));
    assert.throws(() => api.parseStoredPreparationZipV2(shared, fixture.expected));
    const detachedBuffer = new ArrayBuffer(fixture.zip.length); const detached = new Uint8Array(detachedBuffer);
    globalThis.structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
    assert.throws(() => api.parseStoredPreparationZipV2(detached, fixture.expected));
    if (typeof ArrayBuffer.prototype.resize === "function") {
      const resizable = new Uint8Array(new ArrayBuffer(fixture.zip.length, { maxByteLength: fixture.zip.length + 1 }));
      assert.throws(() => api.parseStoredPreparationZipV2(resizable, fixture.expected));
    }
    let reads = 0; const hostile = {};
    Object.defineProperty(hostile, "zip", { enumerable: true, get() { reads++; throw new Error("caller getter"); } });
    Object.defineProperty(hostile, "tar", { enumerable: true, value: fixture.expected.tar });
    Object.defineProperty(hostile, "crc32", { enumerable: true, value: fixture.expected.crc32 });
    assert.throws(() => api.parseStoredPreparationZipV2(fixture.zip, hostile));
    assert.equal(reads, 0);
  });

  test("the ZIP parser applies its native-byte cap before hashing oversized input", async () => {
    const api = await loadPublic(); const oversized = Buffer.allocUnsafe(ZIP_CAP + 1);
    assert.throws(() => api.parseStoredPreparationZipV2(oversized, {
      zip: { bytes: oversized.length, sha256: "0".repeat(64) }, tar: { bytes: 1, sha256: "0".repeat(64) }, crc32: "00000000",
    }));
  });

  test("the FORMAT_ONLY USTAR encoder emits exactly fifteen canonical entries", async () => {
    const api = await loadPublic(); const entries = syntheticEntries();
    const encoded = api.encodeCandidateContextUstarV2(entries);
    assert.deepEqual(encoded.identity, identity(Buffer.from(encoded.tarBytes)));
    assert.equal(encoded.tarBytes.subarray(-1024).every((byte) => byte === 0), true);
    const privateApi = await loadModule({ testOnly: true });
    assert.doesNotThrow(() => privateApi.api.TEST_ONLY_verifyCandidateContextUstarV2(encoded.tarBytes,
      entriesInContext(privateApi.context, entries)));
  });

  test("the canonical USTAR verifier rejects header, padding and EOF mutations independently", async () => {
    const api = await loadPublic(); const entries = syntheticEntries(); const privateApi = await loadModule({ testOnly: true });
    const privateEntries = entriesInContext(privateApi.context, entries); const { tarBytes } = api.encodeCandidateContextUstarV2(entries);
    for (const offset of [0, 100, 108, 116, 124, 136, 148, 156, 257, 263, 265, 329, 337, 345, 500, tarBytes.length - 1]) {
      const changed = Buffer.from(tarBytes); changed[offset] ^= 1;
      assert.throws(() => privateApi.api.TEST_ONLY_verifyCandidateContextUstarV2(changed, privateEntries), undefined, `offset ${offset}`);
    }
    const firstPadding = 512 + entries[0].size;
    const changedPadding = Buffer.from(tarBytes); changedPadding[firstPadding] = 1;
    assert.throws(() => privateApi.api.TEST_ONLY_verifyCandidateContextUstarV2(changedPadding, privateEntries));
  });

  test("the genuine Seaweed scanner semantically round-trips the FORMAT_ONLY archive", async () => {
    const api = await loadPublic(); const entries = syntheticEntries(); const privateApi = await loadModule({ testOnly: true });
    const { tarBytes, identity: tarIdentity } = api.encodeCandidateContextUstarV2(entries);
    privateApi.api.TEST_ONLY_verifyCandidateContextUstarV2(tarBytes, entriesInContext(privateApi.context, entries));
    const chunks = []; for (let offset = 0; offset < tarBytes.length; offset += 1024 * 1024) chunks.push(tarBytes.subarray(offset, offset + 1024 * 1024));
    const scanned = await scanRawUstar({ input: Readable.from(chunks), diffId: `sha256:${tarIdentity.sha256}`,
      maxRawBytes: tarBytes.length, maxMembers: 15, allowHardlinks: false });
    assert.deepEqual(scanned.members.map(({ entry: { path, type, mode, uid, gid, mtime, size } }) => ({ path, type, mode, uid, gid, mtime, size })),
      entries.map(({ path, type, mode, uid, gid, mtime, size }) => ({ path, type, mode, uid, gid, mtime, size })));
    let expectedHeaderOffset = 0;
    for (let index = 0; index < scanned.members.length; index++) {
      const member = scanned.members[index]; const entry = entries[index];
      assert.equal(member.memberOrdinal, index); assert.equal(member.uncompressedHeaderOffset, expectedHeaderOffset);
      assert.equal(member.uncompressedDataOffset, expectedHeaderOffset + 512);
      if (entry.type === "file") {
        assert.equal(member.entry.sha256, entry.sha256);
        assert.equal(tarBytes.subarray(member.uncompressedDataOffset, member.uncompressedDataOffset + entry.size).equals(entry.body), true);
        expectedHeaderOffset += 512 + Math.ceil(entry.size / 512) * 512;
      } else expectedHeaderOffset += 512;
    }
  });

  test("the USTAR encoder rejects body hash, metadata, ordering and unknown fields", async () => {
    const api = await loadPublic(); const base = syntheticEntries();
    const mutations = [
      (entries) => { entries[0].sha256 = "0".repeat(64); },
      (entries) => { entries[0].mode = 0o755; },
      (entries) => { [entries[0], entries[1]] = [entries[1], entries[0]]; },
      (entries) => { entries[0].unknown = true; },
      (entries) => { entries[0].path = "../Dockerfile"; },
      (entries) => { entries[0].size += 1; },
    ];
    for (const mutate of mutations) {
      const entries = globalThis.structuredClone(base); mutate(entries);
      assert.throws(() => api.encodeCandidateContextUstarV2(entries));
    }
  });

  test("the USTAR encoder rejects sparse, proxy, accessor and nonnative body inputs", async () => {
    const api = await loadPublic(); const sparse = syntheticEntries(); delete sparse[4];
    assert.throws(() => api.encodeCandidateContextUstarV2(sparse));
    assert.throws(() => api.encodeCandidateContextUstarV2(new Proxy(syntheticEntries(), {})));
    const accessor = syntheticEntries(); let reads = 0; const body = accessor[0].body;
    delete accessor[0].body; Object.defineProperty(accessor[0], "body", { enumerable: true, get() { reads++; return body; } });
    assert.throws(() => api.encodeCandidateContextUstarV2(accessor)); assert.equal(reads, 0);
    const derived = syntheticEntries(); derived[0].body = new (class extends Uint8Array {})(derived[0].body);
    assert.throws(() => api.encodeCandidateContextUstarV2(derived));
    const shared = syntheticEntries(); shared[0].body = new Uint8Array(new SharedArrayBuffer(shared[0].size));
    assert.throws(() => api.encodeCandidateContextUstarV2(shared));
    const detached = syntheticEntries(); const detachedBacking = new ArrayBuffer(detached[0].size); detached[0].body = new Uint8Array(detachedBacking);
    globalThis.structuredClone(detachedBacking, { transfer: [detachedBacking] });
    assert.throws(() => api.encodeCandidateContextUstarV2(detached));
  });

  test("the USTAR encoder enforces binary, evidence and output caps before allocation", async () => {
    const api = await loadPublic();
    const binary = syntheticEntries(); binary[1].body = Buffer.alloc(67_108_865, 0x61);
    binary[1].size = binary[1].body.length; binary[1].sha256 = sha256(binary[1].body);
    assert.throws(() => api.encodeCandidateContextUstarV2(binary));
    const aggregate = syntheticEntries(); aggregate[1].body = Buffer.alloc(67_108_864, 0x62);
    aggregate[1].size = aggregate[1].body.length; aggregate[1].sha256 = sha256(aggregate[1].body);
    for (let index = 3; index < aggregate.length; index++) {
      const body = Buffer.alloc(87_381, index); aggregate[index].body = body; aggregate[index].size = body.length; aggregate[index].sha256 = sha256(body);
    }
    assert.throws(() => api.encodeCandidateContextUstarV2(aggregate));
  });

  test("the public materializer rejects caller arguments before any filesystem operation", async () => {
    const api = await loadPublic();
    await assert.rejects(api.materializeCandidateContextV2({ outputRoot: "/caller/path" }),
      { message: "gosu_candidate_context_owned_target_invalid" });
  });

  for (const [name, configure] of [
    ["write", (configuration) => { configuration.zeroWrite = true; }],
    ["file fsync", (configuration, file) => { configuration.fail = { operation: "fsync", file }; }],
    ["held reread", (configuration, file) => { configuration.fail = { operation: "read", file }; }],
  ]) test(`durable file publication retains the created file without retry after ${name} failure`, async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const file = `${harness.directoryPath}/claim.json`; configure(configuration, file);
    assert.throws(() => api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, file, Buffer.from("claim\n"), "synthetic_failure"),
      { message: "synthetic_failure" });
    assert.equal(harness.nodes.has(file), true);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "create" && target === file).length, 1);
    assert.equal(harness.operations.some(([operation]) => operation === "unlink"), false);
  });

  test("close uncertainty retains the durable file and does not reopen it", async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const file = `${harness.directoryPath}/claim.json`; const body = Buffer.from("claim\n");
    const item = api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, file, body, "synthetic_failure");
    configuration.fail = { operation: "close", file };
    assert.throws(() => api.TEST_ONLY_closeAndReadbackV2(harness.io, harness.session, item, body, "synthetic_failure"),
      { message: "synthetic_failure" });
    assert.equal(harness.nodes.get(file).bytes.equals(body), true);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "open" && target === file).length, 0);
  });

  test("closed-file readback validation failure retains the original durable bytes", async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const file = `${harness.directoryPath}/claim.json`; const body = Buffer.from("claim\n");
    const item = api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, file, body, "synthetic_failure");
    configuration.corruptRead = true;
    assert.throws(() => api.TEST_ONLY_closeAndReadbackV2(harness.io, harness.session, item, body, "synthetic_failure"),
      { message: "synthetic_failure" });
    assert.equal(harness.nodes.get(file).bytes.equals(body), true);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "open" && target === file).length, 1);
  });

  test("readback descriptor close failure is surfaced after successful validation", async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const file = `${harness.directoryPath}/claim.json`; const body = Buffer.from("claim\n");
    const item = api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, file, body, "synthetic_failure");
    configuration.fail = { operation: "close", file, at: 2 };
    assert.throws(() => api.TEST_ONLY_closeAndReadbackV2(harness.io, harness.session, item, body, "synthetic_failure"),
      { message: "synthetic_failure" });
    assert.equal(harness.nodes.get(file).bytes.equals(body), true);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "read" && target === file).length >= 2, true);
  });

  test("readback close failure after descriptor retirement retains the inode without retry", async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const file = `${harness.directoryPath}/claim.json`; const body = Buffer.from("FORMAT_ONLY retained close uncertainty\n");
    const item = api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, file, body, "synthetic_failure");
    const retained = harness.nodes.get(file); const retainedIno = retained.ino;
    configuration.fail = { operation: "close", file, at: 2, afterRetirement: true };
    assert.throws(() => api.TEST_ONLY_closeAndReadbackV2(harness.io, harness.session, item, body, "synthetic_failure"),
      { message: "synthetic_failure" });
    assert.equal(harness.nodes.get(file), retained); assert.equal(harness.nodes.get(file).ino, retainedIno);
    assert.equal(harness.nodes.get(file).bytes.equals(body), true);
    assert.equal(harness.handles.size, 1); assert.equal(harness.handles.has(harness.directoryFd), true);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "create" && target === file).length, 1);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "open" && target === file).length, 1);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "read" && target === file).length >= 4, true);
    assert.equal(harness.operations.some(([operation]) => operation === "unlink"), false);
  });

  test("directory guards reject foreign metadata changes outside an owned refresh", async () => {
    const { api } = await loadModule({ testOnly: true }); const harness = durableHarness();
    const session = api.TEST_ONLY_makeDirectorySessionV2(harness.io, harness.directoryPath);
    harness.directory.mtimeNs += 1n; harness.directory.ctimeNs += 1n;
    assert.throws(() => session.guard(), { message: "gosu_candidate_context_owned_target_invalid" });
    const accepted = api.TEST_ONLY_makeDirectorySessionV2(harness.io, harness.directoryPath);
    harness.directory.mtimeNs += 1n; harness.directory.ctimeNs += 1n;
    assert.doesNotThrow(() => accepted.refresh(["mtimeNs", "ctimeNs"]));
    harness.directory.bytes = Buffer.from([0]);
    assert.throws(() => accepted.guard(), { message: "gosu_candidate_context_owned_target_invalid" });
  });

  test("canonical validation failure leaves the partial retained and performs no promotion", async () => {
    const publicApi = await loadPublic(); const privateApi = await loadModule({ testOnly: true });
    const entries = syntheticEntries(); const { tarBytes } = publicApi.encodeCandidateContextUstarV2(entries);
    const harness = durableHarness(); const partial = `${harness.directoryPath}/context.tar.partial`;
    privateApi.api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, partial, tarBytes);
    const changed = Buffer.from(tarBytes); changed[0] ^= 1;
    assert.throws(() => privateApi.api.TEST_ONLY_verifyCandidateContextUstarV2(changed,
      entriesInContext(privateApi.context, entries)), { message: "gosu_candidate_context_tar_profile_invalid" });
    assert.equal(harness.nodes.get(partial).bytes.equals(tarBytes), true);
    assert.equal(harness.operations.some(([operation]) => operation === "link" || operation === "unlink"), false);
  });

  test("exclusive promotion collision preserves both the validated partial and foreign final bytes", async () => {
    const { api } = await loadModule({ testOnly: true }); const harness = durableHarness();
    const partial = `${harness.directoryPath}/context.tar.partial`; const final = `${harness.directoryPath}/context.tar`;
    const partialBody = Buffer.from("FORMAT_ONLY validated partial\n");
    const item = api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, partial, partialBody);
    const foreign = Buffer.from("foreign final\n"); harness.put(final, foreign);
    assert.throws(() => api.TEST_ONLY_promotePartialV2(harness.io, harness.session, item, final),
      { message: "gosu_candidate_context_write_failed" });
    assert.equal(harness.nodes.get(partial).bytes.equals(partialBody), true);
    assert.equal(harness.nodes.get(final).bytes.equals(foreign), true);
    assert.equal(harness.operations.filter(([operation]) => operation === "link").length, 1);
  });

  for (const [name, configure, expected] of [
    ["first directory fsync", (configuration, harness) => { configuration.fail = { operation: "fsync", file: harness.directoryPath, at: 1 }; },
      { partial: true, final: true, unlinkAttempts: 0 }],
    ["partial unlink", (configuration, harness) => { configuration.fail = { operation: "unlink", file: `${harness.directoryPath}/context.tar.partial` }; },
      { partial: true, final: true, unlinkAttempts: 1 }],
    ["final directory fsync", (configuration, harness) => { configuration.fail = { operation: "fsync", file: harness.directoryPath, at: 2 }; },
      { partial: false, final: true, unlinkAttempts: 1 }],
    ["final file fsync", (configuration) => { configuration.failFinalFileFsync = true; },
      { partial: false, final: true, unlinkAttempts: 1 }],
  ]) test(`promotion preserves the exact reached namespace after ${name} failure`, async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const partial = `${harness.directoryPath}/context.tar.partial`; const final = `${harness.directoryPath}/context.tar`;
    const item = api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, partial, Buffer.from("FORMAT_ONLY partial\n"));
    configure(configuration, harness);
    assert.throws(() => api.TEST_ONLY_promotePartialV2(harness.io, harness.session, item, final),
      { message: "gosu_candidate_context_write_failed" });
    assert.equal(harness.nodes.has(partial), expected.partial);
    assert.equal(harness.nodes.has(final), expected.final);
    assert.equal(harness.operations.filter(([operation]) => operation === "link").length, 1);
    assert.equal(harness.operations.filter(([operation]) => operation === "unlink").length, expected.unlinkAttempts);
  });

  test("successful promotion orders link, namespace fsync, unlink, final fsync, close and readback", async () => {
    const { api } = await loadModule({ testOnly: true }); const harness = durableHarness();
    const partial = `${harness.directoryPath}/context.tar.partial`; const final = `${harness.directoryPath}/context.tar`;
    const body = Buffer.from("FORMAT_ONLY promotion ordering\n");
    const item = api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, partial, body);
    const start = harness.operations.length; const result = api.TEST_ONLY_promotePartialV2(harness.io, harness.session, item, final);
    const operations = harness.operations.slice(start); const index = (operation, target) => operations.findIndex(([name, file]) => name === operation && (!target || file === target));
    const link = index("link", `${partial}->${final}`); const unlink = index("unlink", partial);
    const directoryFsyncs = operations.map(([name, file], at) => name === "fsync" && file === harness.directoryPath ? at : -1).filter((at) => at >= 0);
    const finalFileFsync = operations.findIndex(([name, file], at) => name === "fsync" && file === final && at > unlink);
    const finalClose = operations.findIndex(([name, file], at) => name === "close" && file === final && at > finalFileFsync);
    const finalOpen = operations.findIndex(([name, file], at) => name === "open" && file === final && at > finalClose);
    assert.ok(link >= 0 && directoryFsyncs[0] > link && unlink > directoryFsyncs[0]
      && directoryFsyncs[1] > unlink && finalFileFsync > directoryFsyncs[1] && finalClose > finalFileFsync && finalOpen > finalClose);
    assert.equal(harness.nodes.has(partial), false); assert.equal(harness.nodes.get(final).bytes.equals(body), true);
    assert.deepEqual(JSON.parse(JSON.stringify(result.identity)), identity(body));
  });

  test("promoted final readback close failure remains a retained terminal uncertainty", async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const partial = `${harness.directoryPath}/context.tar.partial`; const final = `${harness.directoryPath}/context.tar`;
    const body = Buffer.from("FORMAT_ONLY final close uncertainty\n");
    const item = api.TEST_ONLY_writeDurableFileV2(harness.io, harness.session, partial, body);
    configuration.fail = { operation: "close", file: final, at: 2 };
    assert.throws(() => api.TEST_ONLY_promotePartialV2(harness.io, harness.session, item, final),
      { message: "gosu_candidate_context_write_failed" });
    assert.equal(harness.nodes.has(partial), false); assert.equal(harness.nodes.get(final).bytes.equals(body), true);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "link" && target === `${partial}->${final}`).length, 1);
  });

  test("failure receipt publication is durable, read back and directory-synced in order", async () => {
    const { api } = await loadModule({ testOnly: true }); const harness = durableHarness();
    const file = `${harness.directoryPath}/failure.json`;
    api.TEST_ONLY_publishClosedDocumentV2(harness.io, harness.session, file, {
      state: "FAILED_RETAINED", authority: "NOT_AUTHORIZED", code: "gosu_candidate_context_write_failed",
    });
    const create = harness.operations.findIndex(([operation, target]) => operation === "create" && target === file);
    const fileFsync = harness.operations.findIndex(([operation, target]) => operation === "fsync" && target === file);
    const close = harness.operations.findIndex(([operation, target]) => operation === "close" && target === file);
    const reopen = harness.operations.findIndex(([operation, target]) => operation === "open" && target === file);
    const directoryFsync = harness.operations.findIndex(([operation, target]) => operation === "fsync" && target === harness.directoryPath);
    assert.ok(create >= 0 && fileFsync > create && close > fileFsync && reopen > close && directoryFsync > reopen);
    assert.equal(JSON.parse(harness.nodes.get(file).bytes.toString("utf8")).state, "FAILED_RETAINED");
  });

  test("success receipt directory-fsync failure retains the receipt and never retries creation", async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const file = `${harness.directoryPath}/success.json`;
    configuration.fail = { operation: "fsync", file: harness.directoryPath };
    assert.throws(() => api.TEST_ONLY_publishClosedDocumentV2(harness.io, harness.session, file, {
      state: "CONTEXT_MATERIALIZED_REVIEW_PENDING", authority: "NOT_AUTHORIZED",
    }), { message: "gosu_candidate_context_write_failed" });
    assert.equal(harness.nodes.has(file), true);
    assert.equal(harness.operations.filter(([operation, target]) => operation === "create" && target === file).length, 1);
    assert.equal(harness.operations.some(([operation]) => operation === "unlink"), false);
  });

  test("failure-receipt fsync uncertainty retains its bytes and never retries creation", async () => {
    const { api } = await loadModule({ testOnly: true }); const configuration = {}; const harness = durableHarness(configuration);
    const file = `${harness.directoryPath}/failure.json`;
    configuration.fail = { operation: "fsync", file: harness.directoryPath };
    assert.throws(() => api.TEST_ONLY_publishClosedDocumentV2(harness.io, harness.session, file, {
      state: "FAILED_RETAINED", authority: "NOT_AUTHORIZED", code: "gosu_candidate_context_write_failed",
    }), { message: "gosu_candidate_context_write_failed" });
    assert.equal(JSON.parse(harness.nodes.get(file).bytes.toString("utf8")).state, "FAILED_RETAINED");
    assert.equal(harness.operations.filter(([operation, target]) => operation === "create" && target === file).length, 1);
    assert.equal(harness.operations.some(([operation]) => operation === "unlink"), false);
  });
}
