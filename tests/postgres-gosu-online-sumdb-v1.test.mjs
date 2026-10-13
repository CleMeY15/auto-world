import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile as hostReadFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { TextDecoder } from "node:util";
import vm from "node:vm";

const repo = path.resolve(import.meta.dirname, "..");
const defaultBuilder = path.join(repo, "scripts/postgres-image/gosu-derivative-build-v1.mjs");
const lockFile = path.join(repo, "infra/postgres-image/materials/gosu-derivative-lock-v1.json");
const lock = JSON.parse(await hostReadFile(lockFile, "utf8"));
const syntheticLinuxFsConstants = Object.freeze({ O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_NOFOLLOW: 131072 });
const limits = Object.freeze({ sumdb: Object.freeze({ members: 4096, memberBytes: 1024 * 1024, totalBytes: 16 * 1024 * 1024, depth: 16, pathBytes: 512 }) });

const scratch = "/scratch";
const output = "/output";
const sourceRoot = "/scratch/source";
const alternateMod = "/scratch/checksum.mod";
const alternateSum = "/scratch/checksum.sum";
const sumdbRoot = "/scratch/gomodcache/cache/download/sumdb/sum.golang.org";
const latestFile = "/scratch/gopath/pkg/sumdb/sum.golang.org/latest";
const onlineFile = "/scratch/online.json";
const sourceMod = `${sourceRoot}/go.mod`;
const sourceSum = `${sourceRoot}/go.sum`;
const moduleFiles = Object.freeze(lock.modules.flatMap((item) => [
  Object.freeze({ path: `/cache/${item.id}.zip`, kind: "Zip", descriptor: item.zip }),
  Object.freeze({ path: `/cache/${item.id}.mod`, kind: "GoMod", descriptor: item.mod }),
  Object.freeze({ path: `/cache/${item.id}.info`, kind: "Info", descriptor: item.info.cache }),
]));
const lookupFiles = Object.freeze(lock.modules.map((item) => `${sumdbRoot}/lookup/${item.path}@${item.version}`));
const tileFile = `${sumdbRoot}/tile/8/0/000.p/2`;
const expectedGoMod = Buffer.from("module github.com/tianon/gosu\n\ngo 1.20\n\nrequire (\n\tgithub.com/moby/sys/user v0.1.0\n\tgolang.org/x/sys v0.1.0\n)\n");
const expectedGoSum = Buffer.from(lock.modules.flatMap((item) => [
  `${item.path} ${item.version} ${item.zip.h1}`,
  `${item.path} ${item.version}/go.mod ${item.mod.h1}`,
]).join("\n") + "\n");
assert.equal(expectedGoMod.length, lock.source.goMod.bytes);
assert.equal(expectedGoSum.length, lock.source.goSum.bytes);
assert.equal(createHash("sha256").update(expectedGoMod).digest("hex"), lock.source.goMod.sha256);
assert.equal(createHash("sha256").update(expectedGoSum).digest("hex"), lock.source.goSum.sha256);

function extractBetween(source, start, end, label) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label} start anchor`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `${label} end anchor`);
  assert.equal(source.indexOf(start, startIndex + start.length), -1, `${label} unique start anchor`);
  return source.slice(startIndex, endIndex);
}
async function sourceText(file = process.env.AW_GOSU_SUMDB_SOURCE_FILE || defaultBuilder) { return hostReadFile(file, "utf8"); }

function identity(bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return Object.freeze({ bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") });
}
function descriptorKey(descriptor) { return `${descriptor.bytes}:${descriptor.sha256}`; }
const syntheticAssets = new Map();
function registerAsset(descriptor, label) {
  const key = descriptorKey(descriptor); const existing = syntheticAssets.get(key);
  if (existing) return existing;
  const bytes = Buffer.from(`SYNTHETIC_ASSET:${label}\n`); syntheticAssets.set(key, bytes); return bytes;
}
const sharedLicense = registerAsset(lock.source.license, "shared-license");
const goLicense = registerAsset(lock.goSource.license, "go-license");
const patents = registerAsset(lock.goSource.patents, "patents");
const gitignore = registerAsset({ bytes: lock.source.symlink.targetBytes, sha256: lock.source.symlink.targetSha256 }, "gitignore");
const moduleLicenses = new Map(lock.modules.map((item) => [item.id, registerAsset(item.license, `${item.id}-license`)]));
const modulePatents = new Map(lock.modules.filter((item) => item.patents).map((item) => [item.id, registerAsset(item.patents, `${item.id}-patents`)]));
const moduleCacheBodies = new Map(moduleFiles.map((file) => [file.path, registerAsset(file.descriptor, `cache-${file.path}`)]));
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function moduleJson(overrides = {}) {
  return lock.modules.map((item, index) => ({
    Path: item.path, Version: item.version, Sum: item.zip.h1, GoModSum: item.mod.h1,
    Zip: `/cache/${item.id}.zip`, GoMod: `/cache/${item.id}.mod`, Info: `/cache/${item.id}.info`,
    ...(overrides[index] ?? {}),
  }));
}
function jsonStream(records = moduleJson()) { return records.map((record) => JSON.stringify(record)).join("\n") + "\n"; }

const trustedSignature = Buffer.concat([Buffer.from("033de0ae", "hex"), Buffer.alloc(64)]).toString("base64");
const otherSignature = Buffer.concat([Buffer.from("12345678", "hex"), Buffer.alloc(64, 1)]).toString("base64");
const treeHash = Buffer.alloc(32, 7).toString("base64");
function treeNote({ size = 42, root = treeHash, extra = [], signatures = [["sum.golang.org", trustedSignature]] } = {}) {
  return `go.sum database tree\n${size}\n${root}\n${extra.map((line) => `${line}\n`).join("")}\n${signatures.map(([name, signature]) => `— ${name} ${signature}\n`).join("")}`;
}
function lookupBody(item, { record = 41, rows, note } = {}) {
  const expectedRows = rows ?? [
    `${item.path} ${item.version} ${item.zip.h1}`,
    `${item.path} ${item.version}/go.mod ${item.mod.h1}`,
  ];
  return Buffer.from(`${record}\n${expectedRows.join("\n")}\n\n${note ?? treeNote()}`);
}

function compileOnline(source, dependencies) {
  const cleanEnv = extractBetween(source, "function cleanEnv(", "\nexport function moduleInfoCacheIdentity", "cleanEnv");
  const supportStart = source.indexOf("async function readOwnedSumdbFile(");
  const buildStart = source.indexOf("async function buildOnline(");
  assert.notEqual(buildStart, -1, "buildOnline start anchor");
  const support = supportStart === -1 ? "" : source.slice(supportStart, buildStart);
  if (supportStart !== -1) assert.ok(supportStart < buildStart, "private SumDB support precedes buildOnline");
  const buildOnline = extractBetween(source, "async function buildOnline(", "\nexport async function readNetworkNamespaceIdentity", "buildOnline");
  const apiNames = ["readOwnedSumdbFile", "parseSumdbTreeNote", "validateSumdbLookup", "validateOnlineModuleCache", "validateOnlineSumdbCache"];
  const exports = apiNames.map((name) => `typeof ${name} === "function" ? ${name} : undefined`).join(",");
  const context = vm.createContext({
    Buffer, TextDecoder, URL, Object, Array, Map, Set, JSON, Promise, Error, TypeError, BigInt, Number, String,
    path: path.posix, constants: syntheticLinuxFsConstants, fsConstants: syntheticLinuxFsConstants, ...dependencies,
  });
  new vm.Script(`${cleanEnv}\n${support}\n${buildOnline}\nglobalThis.__online = Object.freeze({ buildOnline, helpers: [${exports}] });`, {
    filename: "gosu-online-sumdb-extracted-v1.mjs",
  }).runInContext(context, { timeout: 2_000 });
  return context.__online;
}

class SyntheticFs {
  constructor(trace) {
    this.trace = trace;
    this.nodes = new Map();
    this.nextIno = 100n;
    this.unstable = new Map();
    this.addDirectory("/");
  }
  normalize(file) { return path.posix.resolve(file); }
  ensureParents(file) {
    let current = path.posix.dirname(this.normalize(file));
    const pending = [];
    while (!this.nodes.has(current)) { pending.push(current); if (current === "/") break; current = path.posix.dirname(current); }
    for (const directory of pending.reverse()) this.addDirectory(directory);
  }
  addDirectory(file, overrides = {}) {
    const name = this.normalize(file);
    if (name !== "/") this.ensureParents(name);
    this.nodes.set(name, { kind: "directory", body: null, ino: this.nextIno++, dev: 1n, nlink: 1n, ...overrides });
  }
  addFile(file, body, overrides = {}) {
    const name = this.normalize(file); this.ensureParents(name);
    this.nodes.set(name, { kind: "file", body: Buffer.from(body), ino: this.nextIno++, dev: 1n, nlink: 1n, ...overrides });
  }
  remove(file) { this.nodes.delete(this.normalize(file)); }
  node(file) {
    const name = this.normalize(file); const node = this.nodes.get(name);
    if (!node) { const error = new Error(`missing ${name}`); error.code = "ENOENT"; throw error; }
    return node;
  }
  statObject(node, bigint = false) {
    const as = (value) => bigint ? BigInt(value) : Number(value);
    const size = node.reportedSize ?? node.body?.length ?? 0;
    return {
      dev: as(node.dev), ino: as(node.ino), nlink: as(node.nlink), size: as(size),
      isFile: () => node.kind === "file", isDirectory: () => node.kind === "directory", isSymbolicLink: () => node.kind === "symlink",
    };
  }
  async mkdir(file) { this.trace.push(["mkdir", this.normalize(file)]); this.addDirectory(file); }
  async lstat(file, options = {}) {
    const name = this.normalize(file); this.trace.push(["lstat", name, plain(options)]);
    return this.statObject(this.node(name), options?.bigint === true);
  }
  async readFile(file) { const name = this.normalize(file); this.trace.push(["readFile", name]); return Buffer.from(this.node(name).body); }
  async writeFile(file, body, options = {}) {
    const name = this.normalize(file); this.trace.push(["writeFile", name, plain(options), Buffer.byteLength(body)]);
    if (options?.flag === "wx" && this.nodes.has(name)) { const error = new Error("occupied"); error.code = "EEXIST"; throw error; }
    this.addFile(name, body);
  }
  async open(file, flags) {
    const name = this.normalize(file); this.trace.push(["open", name, flags]);
    const node = this.node(name); if (node.openError) throw node.openError;
    let offset = 0; let statCalls = 0; let closed = false;
    return {
      stat: async (options = {}) => {
        statCalls += 1;
        const mutation = this.unstable.get(name);
        if (mutation && statCalls >= 2) Object.assign(node, mutation);
        return this.statObject(node, options?.bigint === true);
      },
      read: async (buffer, bufferOffset = 0, length = buffer.length, position = null) => {
        if (closed) throw new Error("closed");
        const start = position === null ? offset : Number(position); const available = Math.max(0, node.body.length - start); const bytesRead = Math.min(length, available);
        if (node.readError || (node.eofError && start >= Number(node.reportedSize ?? node.body.length))) throw node.readError ?? node.eofError;
        node.body.copy(buffer, bufferOffset, start, start + bytesRead); if (position === null) offset += bytesRead;
        this.trace.push(["handleRead", name, { requested: length, position, bytesRead }]);
        return { bytesRead, buffer };
      },
      close: async () => { closed = true; this.trace.push(["close", name]); if (node.closeError) throw node.closeError; },
    };
  }
  async opendir(file) {
    const directory = this.normalize(file); this.trace.push(["opendir", directory]); const directoryNode = this.node(directory);
    if (directoryNode.opendirError) throw directoryNode.opendirError;
    const trace = this.trace;
    const prefix = directory === "/" ? "/" : `${directory}/`; const names = new Map();
    for (const [name, node] of this.nodes) {
      if (!name.startsWith(prefix) || name === directory) continue;
      const relative = name.slice(prefix.length); if (!relative || relative.includes("/")) continue;
      names.set(relative, node);
    }
    const entries = [...names].map(([name, node]) => ({
      name, isFile: () => node.kind === "file", isDirectory: () => node.kind === "directory", isSymbolicLink: () => node.kind === "symlink",
    }));
    return {
      async *[Symbol.asyncIterator]() { for (const entry of entries) yield entry; if (directoryNode.iteratorError) throw directoryNode.iteratorError; },
      close: async () => { trace.push(["closeDir", directory]); if (directoryNode.closeError) throw directoryNode.closeError; },
    };
  }
}

function seedFs(fs, options = {}) {
  fs.addFile(sourceMod, expectedGoMod);
  fs.addFile(sourceSum, expectedGoSum);
  fs.addFile("/licenses/go-LICENSE", goLicense);
  fs.addFile("/licenses/go-PATENTS", patents);
  for (const file of moduleFiles) fs.addFile(file.path, moduleCacheBodies.get(file.path));
  if (!options.noSumdb) populateSumdb(fs, options);
}
function populateSumdb(fs, options = {}) {
  lock.modules.forEach((item, index) => fs.addFile(lookupFiles[index], lookupBody(item, options.lookup?.[index])));
  fs.addFile(latestFile, Buffer.from(options.latest ?? treeNote({ size: 42 })));
  for (let index = 0; index < (options.tileCount ?? 2); index += 1) fs.addFile(index === 0 ? tileFile : `${sumdbRoot}/tile/8/0/00${index}.p/2`, Buffer.from(`tile-${index}`));
}

function makeHarness(options = {}) {
  const trace = []; const fs = new SyntheticFs(trace); seedFs(fs, { noSumdb: true });
  if (options.occupiedAlternateMod) fs.addFile(alternateMod, options.occupiedAlternateMod);
  if (options.occupiedAlternateSum) fs.addFile(alternateSum, options.occupiedAlternateSum);
  if (options.linkedAlternateMod) fs.addFile(alternateMod, "linked", { kind: "symlink" });
  if (options.linkedScratchAncestor) fs.node(scratch).kind = "symlink";
  let downloadIndex = 0; let onlineWrites = 0;
  const downloads = options.downloads ?? [jsonStream(), jsonStream()];
  const mutate = options.mutate ?? (() => {});
  const fileIdentity = async (file) => {
    const name = path.posix.resolve(file); trace.push(["fileIdentity", name]);
    const body = await fs.readFile(name); return identity(body);
  };
  const assertSyntheticIdentity = (bytes, expected, code) => {
    const observed = identity(bytes); const registered = syntheticAssets.get(descriptorKey(expected));
    const authentic = observed.bytes === expected.bytes && observed.sha256 === expected.sha256;
    const synthetic = registered && observed.sha256 === identity(registered).sha256 && observed.bytes === registered.length;
    if (!authentic && !synthetic) throw new Error(code);
    return true;
  };
  const run = (stage, command, args, commandOptions) => {
    trace.push(["run", stage, command, [...args], { cwd: commandOptions.cwd, env: plain(commandOptions.env), cap: commandOptions.cap, timeout: commandOptions.timeout }]);
    if (stage === "online_go_version") return { status: 0, stdout: Buffer.from(`${lock.compiler.identity}\n`), stderr: Buffer.alloc(0) };
    if (stage === "online_mod_download") {
      const current = downloadIndex++;
      if (current === 0) {
        if (args.some((arg) => arg === `-modfile=${alternateMod}`)) fs.addFile(alternateSum, expectedGoSum);
        if (!options.noSumdbGenerated && args.some((arg) => arg === `-modfile=${alternateMod}`)) populateSumdb(fs, options.sumdb ?? {});
      }
      mutate({ point: `download_${current + 1}`, fs, trace });
      return { status: 0, stdout: Buffer.from(downloads[current] ?? downloads.at(-1)), stderr: Buffer.alloc(0) };
    }
    if (stage === "online_mod_verify") { mutate({ point: "verify", fs, trace }); return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
    throw new Error(`unexpected real command ${stage}`);
  };
  const dependencies = {
    GOSU_ARCHIVE_LIMITS_V1: options.limits ?? limits,
    mkdir: fs.mkdir.bind(fs), lstat: fs.lstat.bind(fs), readFile: fs.readFile.bind(fs), writeFile: async (file, body, opts) => {
      if (path.posix.resolve(file) === onlineFile) onlineWrites += 1;
      return fs.writeFile(file, body, opts);
    }, open: fs.open.bind(fs), opendir: fs.opendir.bind(fs),
    copyLockedMaterials: async () => trace.push(["copyLockedMaterials"]),
    extractTar: async (_file, _expected, _limits, rootName) => rootName.startsWith("gosu-") ? {
      entries: Array.from({ length: lock.source.observedArchive.entries }), regularBytes: lock.source.observedArchive.regularBytes,
      selected: new Map([["go.mod", { bytes: expectedGoMod }], ["go.sum", { bytes: expectedGoSum }], ["LICENSE", { bytes: sharedLicense }], [".gitignore", { bytes: gitignore }]]),
    } : { entries: Array.from({ length: lock.compiler.observedArchive.entries }), regularBytes: lock.compiler.observedArchive.regularBytes, selected: new Map() },
    scanGzipTar: async (_file, _expected, _limits, adapter) => {
      await adapter.onFile({ path: "go/LICENSE" }, goLicense); await adapter.onFile({ path: "go/PATENTS" }, patents);
      return { entries: Array.from({ length: lock.goSource.observedArchive.entries }), regularBytes: lock.goSource.observedArchive.regularBytes };
    },
    scanModuleZip: async (_file, expected, _limits, adapter) => {
      const item = lock.modules.find((candidate) => candidate.zip.bytes === expected.bytes && candidate.zip.sha256 === expected.sha256);
      if (!item) throw new Error("synthetic module archive descriptor is not registered");
      const prefix = `${item.path}@${item.version}/`;
      await adapter.onFile({ path: `${prefix}${item.license.path}` }, moduleLicenses.get(item.id));
      if (item.patents) await adapter.onFile({ path: `${prefix}${item.patents.path}` }, modulePatents.get(item.id));
      return { entries: Array.from({ length: item.zip.observedArchive.entries }), regularBytes: item.zip.observedArchive.regularBytes };
    },
    assertSelected: (selected, relative, expected) => {
      const value = selected.get(relative); if (!value) throw new Error("gosu_selected_file_missing");
      assertSyntheticIdentity(value.bytes, expected, "gosu_selected_file_invalid"); return value.bytes;
    },
    assertIdentity: assertSyntheticIdentity,
    moduleInfoCacheIdentity: (item) => item.info.cache,
    fileIdentity,
    canonicalJson: (value) => `${JSON.stringify(value, null, 2)}\n`,
    run,
    fail: (code) => { throw new Error(code); },
  };
  return { trace, fs, dependencies, get downloadCount() { return downloadIndex; }, get onlineWrites() { return onlineWrites; } };
}

async function invoke(source, options = {}) {
  const harness = makeHarness(options); const api = compileOnline(source, harness.dependencies);
  let value; let error;
  try { value = await api.buildOnline(1, options.lock ?? lock, scratch, output); } catch (caught) { error = caught; }
  return { api, harness, value, error };
}
function runCalls(harness, stage) { return harness.trace.filter((entry) => entry[0] === "run" && entry[1] === stage); }
function assertClosed(result, message = "gosu_sumdb_invalid") {
  assert.equal(result.error?.message, message);
  assert.equal(result.harness.onlineWrites, 0, "rejection precedes online.json");
}

test("real private buildOnline creates the paired alternate checksum files and validates SumDB before preserved source commands", async () => {
  const source = await sourceText(); const result = await invoke(source);
  assert.ifError(result.error);
  const downloads = runCalls(result.harness, "online_mod_download");
  assert.equal(downloads.length, 2, "alternate warm and preserved source download both run");
  assert.deepEqual(downloads[0][3], ["mod", "download", `-modfile=${alternateMod}`, "-json", "all"]);
  assert.deepEqual(downloads[1][3], ["mod", "download", "-json", "all"]);
  assert.equal(downloads[0][4].cwd, sourceRoot); assert.equal(downloads[1][4].cwd, sourceRoot);
  assert.equal(downloads[0][4].env.GOSUMDB, lock.sumdb); assert.equal(downloads[0][4].env.GOPROXY, "https://proxy.golang.org");
  const writes = result.harness.trace.filter((entry) => entry[0] === "writeFile");
  const alternateWrite = writes.find((entry) => entry[1] === alternateMod);
  assert.deepEqual(alternateWrite?.slice(2), [{ flag: "wx" }, expectedGoMod.length]);
  assert.equal(writes.some((entry) => entry[1] === alternateSum), false, "Go alone creates checksum.sum");
  const snapshot = result.harness.trace.findIndex((entry) => entry[0] === "fileIdentity" && entry[1] === sourceMod);
  const firstDownload = result.harness.trace.indexOf(downloads[0]);
  assert.ok(snapshot !== -1 && snapshot < firstDownload, "source snapshot precedes first download");
  const priorLstats = result.harness.trace.slice(0, firstDownload).filter((entry) => entry[0] === "lstat");
  assert.equal(priorLstats.at(-1)?.[1], alternateSum, "checksum.sum absence is rechecked immediately before Go");
  const verify = runCalls(result.harness, "online_mod_verify"); assert.equal(verify.length, 1); assert.ok(result.harness.trace.indexOf(verify[0]) > result.harness.trace.indexOf(downloads[1]));
  const lastProofRead = Math.max(...result.harness.trace.map((entry, index) => entry[0] === "open" && (entry[1].startsWith(sumdbRoot) || entry[1] === latestFile) ? index : -1));
  const onlineWrite = result.harness.trace.findIndex((entry) => entry[0] === "writeFile" && entry[1] === onlineFile);
  assert.ok(lastProofRead !== -1 && lastProofRead < onlineWrite, "final SumDB proof check precedes online.json");
});

test("complete valid SumDB accepts unordered checksum rows, multiple signatures, extension text, and dynamic tiles", async () => {
  const sumdb = {
    tileCount: 5,
    lookup: lock.modules.map((item) => ({ rows: [
      `${item.path} ${item.version}/go.mod ${item.mod.h1}`,
      `${item.path} ${item.version} ${item.zip.h1}`,
    ], note: treeNote({ extra: ["forward compatible text"], signatures: [["builder", otherSignature], ["example.org", otherSignature], ["sum.golang.org", trustedSignature], ["sum.golang.org", trustedSignature]] }) })),
    latest: treeNote({ size: 0, extra: ["future field"] }),
  };
  const result = await invoke(await sourceText(), { sumdb });
  assert.ifError(result.error); assert.equal(result.harness.onlineWrites, 1); assert.equal(result.harness.downloadCount, 2);
});

test("successful alternate Go run without a generated SumDB cache closes before source download and online.json", async () => {
  const result = await invoke(await sourceText(), { noSumdbGenerated: true });
  assertClosed(result);
  assert.equal(runCalls(result.harness, "online_mod_download").length, 1);
});

for (const [name, options] of [
  ["occupied checksum.mod", { occupiedAlternateMod: Buffer.from("occupied") }],
  ["occupied checksum.sum", { occupiedAlternateSum: Buffer.from("occupied") }],
  ["linked checksum.mod", { linkedAlternateMod: true }],
  ["linked scratch ancestor", { linkedScratchAncestor: true }],
]) test(`paired alternate target rejects ${name}`, async () => {
  const result = await invoke(await sourceText(), options); assertClosed(result);
  assert.equal(runCalls(result.harness, "online_mod_download").length, 0);
});

for (const [name, mutate] of [
  ["missing lookup", ({ fs }) => fs.remove(lookupFiles[0])],
  ["empty lookup", ({ fs }) => fs.addFile(lookupFiles[0], Buffer.alloc(0))],
  ["oversized lookup", ({ fs }) => { fs.node(lookupFiles[0]).reportedSize = BigInt(limits.sumdb.memberBytes + 1); }],
  ["unstable lookup", ({ fs }) => fs.unstable.set(lookupFiles[0], { ino: 99999n })],
  ["lookup device change", ({ fs }) => fs.unstable.set(lookupFiles[0], { dev: 2n })],
  ["lookup size change", ({ fs }) => fs.unstable.set(lookupFiles[0], { reportedSize: BigInt(fs.node(lookupFiles[0]).body.length + 1) })],
  ["lookup link-count change", ({ fs }) => fs.unstable.set(lookupFiles[0], { nlink: 2n })],
  ["symlink lookup", ({ fs }) => { fs.node(lookupFiles[0]).kind = "symlink"; }],
  ["hardlinked lookup", ({ fs }) => { fs.node(lookupFiles[0]).nlink = 2n; }],
  ["nonregular lookup", ({ fs }) => { fs.node(lookupFiles[0]).kind = "other"; }],
  ["missing latest", ({ fs }) => fs.remove(latestFile)],
  ["empty latest", ({ fs }) => fs.addFile(latestFile, Buffer.alloc(0))],
  ["oversized latest", ({ fs }) => { fs.node(latestFile).reportedSize = BigInt(limits.sumdb.memberBytes + 1); }],
  ["linked tile", ({ fs }) => { fs.node(tileFile).kind = "symlink"; }],
  ["hardlinked tile", ({ fs }) => { fs.node(tileFile).nlink = 2n; }],
  ["nonregular tile", ({ fs }) => { fs.node(tileFile).kind = "other"; }],
  ["oversized tile", ({ fs }) => { fs.node(tileFile).reportedSize = BigInt(limits.sumdb.memberBytes + 1); }],
  ["ancestor link", ({ fs }) => { fs.node("/scratch/gomodcache/cache").kind = "symlink"; }],
]) test(`real private online validation rejects ${name}`, async () => {
  const result = await invoke(await sourceText(), { mutate: ({ point, ...context }) => { if (point === "download_1") mutate(context); } });
  assertClosed(result);
});

for (const [name, configure] of [
  ["missing tile coverage", ({ fs }) => { for (const name of [...fs.nodes.keys()]) if (name.startsWith(`${sumdbRoot}/tile/`)) fs.remove(name); }],
  ["unknown proof file", ({ fs }) => fs.addFile(`${sumdbRoot}/unexpected`, "proof")],
  ["path ceiling", ({ fs }) => fs.addFile(`${sumdbRoot}/tile/${"x".repeat(limits.sumdb.pathBytes + 1)}`, "proof")],
  ["depth ceiling", ({ fs }) => fs.addFile(`${sumdbRoot}/tile/${Array.from({ length: limits.sumdb.depth + 1 }, () => "x").join("/")}`, "proof")],
]) test(`bounded SumDB tree rejects ${name}`, async () => {
  const result = await invoke(await sourceText(), { mutate: ({ point, ...context }) => { if (point === "download_1") configure(context); } });
  assertClosed(result);
});

test("bounded SumDB tree rejects the member-count ceiling independently", async () => {
  const bounded = Object.freeze({ sumdb: Object.freeze({ ...limits.sumdb, members: 3 }) });
  const result = await invoke(await sourceText(), { limits: bounded });
  assertClosed(result);
});

test("bounded SumDB tree rejects the aggregate-byte ceiling independently", async () => {
  const bounded = Object.freeze({ sumdb: Object.freeze({ ...limits.sumdb, totalBytes: 64 }) });
  const result = await invoke(await sourceText(), { limits: bounded });
  assertClosed(result);
});

test("bounded SumDB tree rejects excessive empty directory enumeration", async () => {
  const bounded = Object.freeze({ sumdb: Object.freeze({ ...limits.sumdb, members: 32 }) });
  const result = await invoke(await sourceText(), {
    limits: bounded,
    mutate: ({ point, fs }) => {
      if (point === "download_1") for (let index = 0; index < 33; index += 1) fs.addDirectory(`${sumdbRoot}/tile/empty-${index}`);
    },
  });
  assertClosed(result);
});

for (const [name, configure] of [
  ["early EOF", ({ fs }) => { fs.node(lookupFiles[0]).reportedSize = BigInt(fs.node(lookupFiles[0]).body.length + 1); }],
  ["growth beyond declared size", ({ fs }) => { fs.node(lookupFiles[0]).reportedSize = BigInt(fs.node(lookupFiles[0]).body.length - 1); }],
  ["opened-handle type change", ({ fs }) => fs.unstable.set(lookupFiles[0], { kind: "other" })],
  ["open failure", ({ fs }) => { fs.node(lookupFiles[0]).openError = new Error("synthetic open failure"); }],
  ["body read failure", ({ fs }) => { fs.node(lookupFiles[0]).readError = new Error("synthetic read failure"); }],
  ["EOF probe failure", ({ fs }) => { fs.node(lookupFiles[0]).eofError = new Error("synthetic EOF failure"); }],
  ["handle close failure", ({ fs }) => { fs.node(lookupFiles[0]).closeError = new Error("synthetic close failure"); }],
  ["directory open failure", ({ fs }) => { fs.node(sumdbRoot).opendirError = new Error("synthetic opendir failure"); }],
  ["directory iterator failure", ({ fs }) => { fs.node(sumdbRoot).iteratorError = new Error("synthetic iterator failure"); }],
  ["directory close failure", ({ fs }) => { fs.node(sumdbRoot).closeError = new Error("synthetic directory close failure"); }],
]) test(`owned SumDB I/O rejects ${name}`, async () => {
  const result = await invoke(await sourceText(), { mutate: ({ point, ...context }) => { if (point === "download_1") configure(context); } });
  assertClosed(result);
  if (!["open failure", "directory open failure"].includes(name)) {
    const relevant = name.startsWith("directory") ? sumdbRoot : lookupFiles[0];
    const closeKind = name.startsWith("directory") ? "closeDir" : "close";
    assert.equal(result.harness.trace.some((entry) => entry[0] === closeKind && entry[1] === relevant), true, `close attempted for ${name}`);
  }
});

test("invalid fixed verifier descriptor is rejected without widening file authority", async () => {
  const invalidLock = plain(lock); invalidLock.sumdb = "evil.example+033de0ae+Ac4zctda0e5eza+HJyk9SxEdh+s3Ux18htTTAD8OuAn8 https://evil.example";
  const result = await invoke(await sourceText(), { lock: invalidLock }); assertClosed(result);
});

for (const [name, lookup] of [
  ["negative record id", { record: -1 }],
  ["noncanonical record id", { record: "041" }],
  ["leading UTF-8 BOM record id", { record: "\uFEFF41" }],
  ["record id not below tree", { record: 42, note: treeNote({ size: 42 }) }],
  ["duplicate checksum rows", { rows: [
    `${lock.modules[0].path} ${lock.modules[0].version} ${lock.modules[0].zip.h1}`,
    `${lock.modules[0].path} ${lock.modules[0].version} ${lock.modules[0].zip.h1}`,
  ] }],
  ["extra checksum row", { rows: [
    `${lock.modules[0].path} ${lock.modules[0].version} ${lock.modules[0].zip.h1}`,
    `${lock.modules[0].path} ${lock.modules[0].version}/go.mod ${lock.modules[0].mod.h1}`,
    "example.invalid/extra v1.0.0 h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  ] }],
  ["substituted checksum", { rows: [
    `${lock.modules[0].path} ${lock.modules[0].version} h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`,
    `${lock.modules[0].path} ${lock.modules[0].version}/go.mod ${lock.modules[0].mod.h1}`,
  ] }],
]) test(`lookup grammar rejects ${name}`, async () => {
  const result = await invoke(await sourceText(), { sumdb: { lookup: [lookup, undefined] } }); assertClosed(result);
});

for (const [name, note] of [
  ["wrong header", treeNote().replace("go.sum database tree", "wrong tree")],
  ["leading UTF-8 BOM header", `\uFEFF${treeNote()}`],
  ["noncanonical size", treeNote().replace("\n42\n", "\n042\n")],
  ["negative size", treeNote().replace("\n42\n", "\n-1\n")],
  ["short root", treeNote({ root: Buffer.alloc(31).toString("base64") })],
  ["noncanonical root base64", treeNote({ root: `${treeHash}=` })],
  ["CRLF", treeNote().replaceAll("\n", "\r\n")],
  ["NUL control", treeNote({ extra: ["bad\0text"] })],
  ["missing final LF", treeNote().slice(0, -1)],
  ["missing signatures", treeNote({ signatures: [] })],
  ["wrong verifier only", treeNote({ signatures: [["example.org", otherSignature]] })],
  ["wrong trusted key hash", treeNote({ signatures: [["sum.golang.org", otherSignature]] })],
  ["short trusted signature", treeNote({ signatures: [["sum.golang.org", Buffer.from("033de0ae", "hex").toString("base64")]] })],
  ["bad signature base64", treeNote({ signatures: [["sum.golang.org", "!!!!"]] })],
  ["junk after signature", `${treeNote()}junk\n`],
]) test(`signed-note syntax rejects ${name}`, async () => {
  const result = await invoke(await sourceText(), { sumdb: { lookup: [{ note }, undefined] } }); assertClosed(result);
});

for (const [name, records] of [
  ["malformed JSON", "{\n"],
  ["missing module", jsonStream(moduleJson().slice(0, 1))],
  ["duplicate module", jsonStream([moduleJson()[0], moduleJson()[0]])],
  ["extra module", jsonStream([...moduleJson(), { ...moduleJson()[0], Path: "example.invalid/extra" }])],
  ["wrong version", jsonStream(moduleJson({ 0: { Version: "v9.9.9" } }))],
  ["wrong ZIP sum", jsonStream(moduleJson({ 0: { Sum: "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } }))],
  ["wrong go.mod sum", jsonStream(moduleJson({ 0: { GoModSum: "h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } }))],
  ["reported module error", jsonStream(moduleJson({ 0: { Error: "private upstream detail" } }))],
]) test(`both strict module-output validators reject ${name}`, async () => {
  for (const streamIndex of [0, 1]) {
    const downloads = [jsonStream(), jsonStream()]; downloads[streamIndex] = records;
    const result = await invoke(await sourceText(), { downloads });
    assertClosed(result, "gosu_module_closure_invalid");
  }
});

for (const [kind, file] of moduleFiles.map((entry) => [entry.kind, entry.path])) test(`authenticated ${kind} cache bytes are enforced after each download`, async () => {
  for (const point of ["download_1", "download_2"]) {
    const result = await invoke(await sourceText(), {
      mutate: ({ point: actualPoint, fs }) => { if (actualPoint === point) fs.addFile(file, Buffer.from(`changed-${kind}-${point}`)); },
    });
    assertClosed(result, "gosu_module_cache_invalid");
  }
});

for (const [name, mutate] of [
  ["source go.mod mutation during alternate warm", ({ fs }) => fs.addFile(sourceMod, Buffer.concat([expectedGoMod, Buffer.from("x")]))],
  ["source go.sum mutation during alternate warm", ({ fs }) => fs.addFile(sourceSum, Buffer.concat([expectedGoSum, Buffer.from("x")]))],
  ["alternate go.mod mutation after source verify", ({ fs }) => fs.addFile(alternateMod, Buffer.from("changed"))],
  ["alternate go.sum mutation after source verify", ({ fs }) => fs.addFile(alternateSum, Buffer.from("changed"))],
]) test(`identity binding rejects ${name}`, async () => {
  const late = name.startsWith("alternate");
  const result = await invoke(await sourceText(), { mutate: ({ point, ...context }) => { if (point === (late ? "verify" : "download_1")) mutate(context); } });
  assertClosed(result, "gosu_source_mutated");
});

test("the fixed-path reader uses no arbitrary caller path and closes its handle after EOF and stable restat", async () => {
  const source = await sourceText(); const result = await invoke(source); assert.ifError(result.error);
  const opens = result.harness.trace.filter((entry) => entry[0] === "open");
  assert.ok(opens.length >= lookupFiles.length + 2, "lookup, latest and tile files use handles");
  for (const entry of opens) {
    assert.ok(entry[1].startsWith(sumdbRoot) || entry[1] === latestFile, `fixed proof path ${entry[1]}`);
    assert.ok((entry[2] & syntheticLinuxFsConstants.O_NOFOLLOW) === syntheticLinuxFsConstants.O_NOFOLLOW, "O_NOFOLLOW set");
    assert.equal(entry[2] & (syntheticLinuxFsConstants.O_WRONLY | syntheticLinuxFsConstants.O_RDWR), 0, "handle is read-only");
    assert.equal(result.harness.trace.some((candidate) => candidate[0] === "close" && candidate[1] === entry[1]), true, `closed ${entry[1]}`);
    const reads = result.harness.trace.filter((candidate) => candidate[0] === "handleRead" && candidate[1] === entry[1]);
    assert.ok(reads.length >= 2, `bounded body read plus EOF probe for ${entry[1]}`);
    assert.equal(reads.at(-1)[2].bytesRead, 0, `EOF established for ${entry[1]}`);
  }
});

test("old accepted builder demonstrates the retained semantic RED rather than a harness failure", async (context) => {
  const baselineFile = process.env.AW_GOSU_SUMDB_BASELINE_FILE;
  if (!baselineFile) return context.skip("local sealed original-builder positive control only; standard CI exercises the explicit contracts above");
  const baseline = await invoke(await sourceText(baselineFile));
  assert.ifError(baseline.error);
  const downloads = runCalls(baseline.harness, "online_mod_download");
  assert.equal(downloads.length, 1, "old builder positive control reaches its accepted single source download");
  assert.deepEqual(downloads[0][3], ["mod", "download", "-json", "all"]);
  assert.equal(baseline.harness.trace.some((entry) => entry[0] === "open" && entry[1].startsWith(sumdbRoot)), false, "old accepted path performs no SumDB handle validation");
  assert.equal(baseline.harness.onlineWrites, 1, "old accepted path reaches online.json");
});
