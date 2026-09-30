import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, chownSync, closeSync, existsSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readSync, readdirSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { clearTimeout, setTimeout } from "node:timers";
import { setImmediate as nextTurn } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { openPostgresPrivateRuntimeEvidenceSources, postgresPrivateRuntimeEvidenceSupervisorFailureDiagnostic,
  runPostgresPrivateRuntimeEvidenceDiagnostic, supervisePostgresPrivateRuntimeEvidenceChild,
  validatePostgresPrivateRuntimeEvidenceEnvironment, validatePostgresPrivateRuntimeEvidenceWorkerProcess } from "../scripts/postgres-image/local-private-runtime-evidence-diagnostic.mjs";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN, postgresPrivateRuntimeEvidenceEnvironment as ENV } from "../scripts/postgres-image/private-runtime-evidence-policy.mjs";

const PREFIX = "postgres_private_runtime_evidence_";
const FILE = fileURLToPath(import.meta.url);
const ROOT_NATIVE = process.platform === "linux" && process.getuid() === 0;
const DROP = ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const native = stat => ({ dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid),
  mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink), size: Number(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) });
const status = () => "Pid:\t4321\nPPid:\t42\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n"
  + "Groups:\t\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapAmb:\t0000000000000000\nNoNewPrivs:\t1\n";

test("fixed CLI rejects arguments and ambient environment before any original source access", async () => {
  await assert.rejects(runPostgresPrivateRuntimeEvidenceDiagnostic(["fixture"], ENV), { message: PREFIX + "context_invalid" });
  for (const env of [{}, { ...ENV, NODE_OPTIONS: "--fixture" }, { ...ENV, HOME: "/fixture" }]) {
    await assert.rejects(runPostgresPrivateRuntimeEvidenceDiagnostic([], env), { message: PREFIX + "context_invalid" });
  }
  if (process.platform !== "linux") await assert.rejects(runPostgresPrivateRuntimeEvidenceDiagnostic([], ENV), { message: PREFIX + "context_invalid" });
});
test("environment snapshot accepts only exact enumerable string data without reading accessors or coercing values", () => {
  const input = { ...ENV }; const snapshot = validatePostgresPrivateRuntimeEvidenceEnvironment(input);
  assert.deepEqual(snapshot, ENV); assert.notEqual(snapshot, input);
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype); assert.equal(Object.isFrozen(snapshot), true);
  let reads = 0; let conversions = 0;
  const accessor = { ...ENV }; Object.defineProperty(accessor, "HOME", { get() { reads++; return ENV.HOME; }, enumerable: true });
  const hidden = { ...ENV }; Object.defineProperty(hidden, "HOME", { value: ENV.HOME, enumerable: false });
  const impostor = Object.assign(Object.create({}), ENV);
  const nativePrototypeImpostor = Object.assign(Object.create(Object.getPrototypeOf(process.env)), ENV);
  const invalid = [null, [], Object.assign(Object.create(null), ENV), impostor, accessor, hidden,
    { ...ENV, [Symbol("fixture")]: true }, { ...ENV, NODE_OPTIONS: "--fixture" }, { ...ENV, HOME: "/fixture" },
    { ...ENV, HOME: { toString() { conversions++; return ENV.HOME; } } }];
  if (Object.getPrototypeOf(process.env) !== Object.prototype) invalid.push(nativePrototypeImpostor);
  for (const value of invalid) assert.throws(() => validatePostgresPrivateRuntimeEvidenceEnvironment(value), { message: PREFIX + "context_invalid" });
  assert.equal(reads, 0); assert.equal(conversions, 0);
});
test("diagnostics snapshot hostile errors once and never include private text", () => {
  let reads = 0;
  assert.deepEqual(postgresPrivateRuntimeEvidenceSupervisorFailureDiagnostic({ get message() { reads++; return "private fixture bytes"; } }, "UNKNOWN", "CONFIRMED"),
    { code: PREFIX + "operation_failed", phase: "CONTEXT", cleanup: "CONFIRMED" });
  assert.equal(reads, 1);
  assert.deepEqual(postgresPrivateRuntimeEvidenceSupervisorFailureDiagnostic(new Error(PREFIX + "cleanup_uncertain"), "CLEANUP", "CONFIRMED"),
    { code: PREFIX + "cleanup_uncertain", phase: "CLEANUP", cleanup: "UNVERIFIED" });
});
test("worker process proof binds PID lifetime, parent, exact argv and actual dropped profile", () => {
  const expected = { pid: 4321, startTicks: "1234", parentPid: 42, node: "/fixture/node", worker: "/fixture/worker.mjs" };
  const value = { startTicks: "1234", status: status(), executable: expected.node, argv: [expected.node, expected.worker, ""] };
  assert.equal(validatePostgresPrivateRuntimeEvidenceWorkerProcess(value, expected).uid, 1000);
  for (const changed of [{ ...value, startTicks: "5678" }, { ...value, executable: "/bin/sh" },
    { ...value, argv: [expected.node, "-e", "fixture", ""] }, { ...value, status: status().replace("PPid:\t42", "PPid:\t43") },
    { ...value, status: status().replace("Groups:\t", "Groups:\t1000") },
    { ...value, status: status().replace("CapEff:\t0000000000000000", "CapEff:\t0000000000000001") },
    { ...value, status: status().replace("NoNewPrivs:\t1", "NoNewPrivs:\t0") },
    { ...value, status: status().replace("Uid:\t1000\t1000\t1000\t1000", "Uid:\t0\t1000\t1000\t1000") }, { ...value, extra: true }]) {
    assert.throws(() => validatePostgresPrivateRuntimeEvidenceWorkerProcess(changed, expected), { message: PREFIX + "control_invalid" });
  }
  let conversions = 0;
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceWorkerProcess({ ...value, startTicks: { toString() { conversions++; return "1234"; } } }, expected));
  assert.equal(conversions, 0);
});
test("source reader rejects symbols, accessors, role substitutions and non-root actors without opening files", () => {
  const input = { sources: PIN.sources, deadline: Date.now() + 1000 };
  assert.throws(() => openPostgresPrivateRuntimeEvidenceSources({ ...input, [Symbol("fixture")]: true }), { message: PREFIX + "context_invalid" });
  let read = 0; const hostile = { get sources() { read++; return PIN.sources; }, deadline: input.deadline };
  assert.throws(() => openPostgresPrivateRuntimeEvidenceSources(hostile), { message: PREFIX + "context_invalid" }); assert.equal(read, 0);
  assert.throws(() => openPostgresPrivateRuntimeEvidenceSources({ ...input, sources: [{ ...PIN.sources[0], fd: 4 }, ...PIN.sources.slice(1)] }), { message: PREFIX + "context_invalid" });
  if (!ROOT_NATIVE) assert.throws(() => openPostgresPrivateRuntimeEvidenceSources(input), { message: PREFIX + "context_invalid" });
});

function fixture(run) {
  const cold = mkdtempSync("/var/tmp/aw-cl-"); const sql = mkdtempSync("/var/tmp/aw-pr-");
  const known = new Map();
  const capture = file => known.set(file, native(lstatSync(file, { bigint: true })));
  const write = (file, bytes, uid = 0, gid = 0) => { writeFileSync(file, bytes, { mode: 0o600, flag: "wx" }); chmodSync(file, 0o600); chownSync(file, uid, gid); capture(file); };
  for (const parent of [cold, sql]) { chmodSync(parent, 0o710); chownSync(parent, 0, 1000); capture(parent); }
  for (const dir of [path.join(sql, "work"), path.join(sql, "work/backup")]) { mkdirSync(dir, { mode: 0o700 }); chownSync(dir, 1000, 1000); capture(dir); }
  const bytes = [Buffer.from([0, 255, 17, 128, 42]), Buffer.from("harmless SQL receipt fixture\n"), Buffer.from([0, 128, 255, 0, 27, 240])];
  const sources = PIN.sources.map((pin, i) => ({ ...pin, source: i === 0 ? `${cold}/receipt.json` : i === 1 ? `${sql}/receipt.json` : `${sql}/work/backup/diagnostic.dump`,
    size: bytes[i].length, sha256: hash(bytes[i]) }));
  sources.forEach((pin, i) => write(pin.source, bytes[i], pin.uid, pin.gid));
  const original = sources.map(pin => native(lstatSync(pin.source, { bigint: true })));
  const cleanup = file => {
    const observed = native(lstatSync(file, { bigint: true })); const saved = known.get(file);
    if (!saved || ["dev", "ino", "uid", "gid", "mode"].some(key => observed[key] !== saved[key])) throw new Error("fixture cleanup identity changed");
    const stat = lstatSync(file);
    if (stat.isDirectory()) { for (const name of readdirSync(file)) cleanup(path.join(file, name)); rmdirSync(file); }
    else { assert.equal(stat.isSymbolicLink(), false); unlinkSync(file); }
  };
  const saveCreated = file => {
    capture(file); if (lstatSync(file).isDirectory()) for (const name of readdirSync(file)) saveCreated(path.join(file, name));
  };
  return Promise.resolve().then(() => run({ cold, sql, sources, bytes, original, write, capture, saveCreated }))
    .finally(() => { for (const parent of [cold, sql]) cleanup(parent); });
}
function reader(f) { return openPostgresPrivateRuntimeEvidenceSources({ sources: f.sources, deadline: Date.now() + 20_000 }); }
const nativeOptions = { skip: process.platform !== "linux" ? "Linux readonly descriptor API" : !ROOT_NATIVE ? "covered by actual root bootstrap below" : false };
if (ROOT_NATIVE || process.platform !== "linux") {
test("native root env-i five-field process.env is accepted only as a detached environment snapshot", nativeOptions, () => {
  const diagnostic = new URL("../scripts/postgres-image/local-private-runtime-evidence-diagnostic.mjs", import.meta.url).href;
  const policy = new URL("../scripts/postgres-image/private-runtime-evidence-policy.mjs", import.meta.url).href;
  const code = `import { isDeepStrictEqual } from 'node:util';
import { validatePostgresPrivateRuntimeEvidenceEnvironment } from ${JSON.stringify(diagnostic)};
import { postgresPrivateRuntimeEvidenceEnvironment as ENV } from ${JSON.stringify(policy)};
const snapshot=validatePostgresPrivateRuntimeEvidenceEnvironment(process.env);
process.stdout.write(JSON.stringify({state:'PARTIAL_ENVIRONMENT_PROOF',uid:process.getuid(),euid:process.geteuid(),gid:process.getgid(),egid:process.getegid(),node:process.version,
nativePrototype:Object.getPrototypeOf(process.env)!==Object.prototype,detached:snapshot!==process.env,plain:Object.getPrototypeOf(snapshot)===Object.prototype,
frozen:Object.isFrozen(snapshot),matches:isDeepStrictEqual(snapshot,ENV)})+'\\n');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: "/", env: ENV,
    encoding: "utf8", timeout: 10_000, maxBuffer: 4096 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { state: "PARTIAL_ENVIRONMENT_PROOF", uid: 0, euid: 0, gid: 0, egid: 0, node: "v22.23.2",
    nativePrototype: true, detached: true, plain: true, frozen: true, matches: true });
});
test("native reader fully seals binary bytes and returns roles distinct from OS descriptors", nativeOptions, () => fixture(f => {
  const held = reader(f);
  try {
    assert.deepEqual(held.sources.map(item => item.fd), [3, 4, 5]); assert.equal(held.descriptors.length, 3);
    assert.ok(held.descriptors.some((fd, i) => fd !== i + 3));
    assert.deepEqual(held.seal().map(item => item.identity), f.original);
    for (const [i, fd] of held.descriptors.entries()) {
      assert.equal(readFileSync(`/proc/self/fdinfo/${fd}`, "utf8").match(/^pos:\s+([0-9]+)/mu)[1], "0");
      const bytes = Buffer.alloc(f.sources[i].size); assert.equal(readSync(fd, bytes, 0, bytes.length, 0), bytes.length); assert.deepEqual(bytes, f.bytes[i]);
    }
  } finally { held.close(); held.close(); }
  for (const fd of held.descriptors) assert.throws(() => fstatSync(fd), { code: "EBADF" });
  assert.deepEqual(f.sources.map(pin => native(lstatSync(pin.source, { bigint: true }))), f.original);
}));
test("native reader rejects hash, mode, links, short and trailing bytes before acceptance", nativeOptions, () => fixture(f => {
  for (const change of [{ size: f.sources[0].size - 1 }, { size: f.sources[0].size + 1 }, { sha256: "a".repeat(64) }]) {
    assert.throws(() => openPostgresPrivateRuntimeEvidenceSources({ sources: [{ ...f.sources[0], ...change }, ...f.sources.slice(1)], deadline: Date.now() + 1000 }),
      { message: PREFIX + "source_invalid" });
  }
  chmodSync(f.sources[0].source, 0o640); assert.throws(() => reader(f), { message: PREFIX + "source_invalid" }); chmodSync(f.sources[0].source, 0o600);
  linkSync(f.sources[0].source, `${f.cold}/extra`); assert.throws(() => reader(f), { message: PREFIX + "source_invalid" }); unlinkSync(`${f.cold}/extra`);
  renameSync(f.sources[0].source, `${f.cold}/saved`); symlinkSync(`${f.cold}/saved`, f.sources[0].source);
  assert.throws(() => reader(f), { message: PREFIX + "source_invalid" }); unlinkSync(f.sources[0].source); renameSync(`${f.cold}/saved`, f.sources[0].source);
}));
test("native held seals detect in-place mutation, path swap and parent profile changes", nativeOptions, () => fixture(f => {
  let held = reader(f);
  writeFileSync(f.sources[0].source, Buffer.from([0, 255, 17, 128, 43])); assert.throws(() => held.seal(), { message: PREFIX + "source_invalid" }); held.close();
  writeFileSync(f.sources[0].source, f.bytes[0]); held = reader(f);
  renameSync(f.sources[0].source, `${f.cold}/saved`); f.write(f.sources[0].source, f.bytes[0]);
  assert.throws(() => held.seal(), { message: PREFIX + "source_invalid" }); held.close(); unlinkSync(f.sources[0].source);
  renameSync(`${f.cold}/saved`, f.sources[0].source); f.capture(f.sources[0].source); held = reader(f);
  chmodSync(f.sql, 0o750); assert.throws(() => held.seal(), { message: PREFIX + "source_invalid" }); chmodSync(f.sql, 0o710); held.close();
}));
test("native reader respects actual abort/deadline without retaining descriptors", nativeOptions, () => fixture(f => {
  const controller = new globalThis.AbortController(); const held = openPostgresPrivateRuntimeEvidenceSources({ sources: f.sources, deadline: Date.now() + 1000, signal: controller.signal });
  controller.abort(); assert.throws(() => held.seal(), { message: PREFIX + "operation_failed" }); held.close();
  assert.throws(() => openPostgresPrivateRuntimeEvidenceSources({ sources: f.sources, deadline: Date.now() - 1 }), { message: PREFIX + "operation_failed" });
}));
test("native descriptor closure uncertainty remains sticky and never retries a reused handle", nativeOptions, () => fixture(f => {
  const held = reader(f); closeSync(held.descriptors[0]);
  assert.throws(() => held.seal(), { message: PREFIX + "source_invalid" });
  for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => held.close(), { message: PREFIX + "cleanup_uncertain" });
  for (const fd of held.descriptors) assert.throws(() => fstatSync(fd), { code: "EBADF" });
  assert.deepEqual(f.sources.map(pin => native(lstatSync(pin.source, { bigint: true }))), f.original);
}));

function workerCode(mode, directory) {
  return `import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';
import readline from 'node:readline';
const mode=${JSON.stringify(mode)}, directory=${JSON.stringify(directory)};
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();
const next=async()=>JSON.parse((await lines.next()).value);
const send=frame=>new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(frame)+'\\n',error=>error?reject(error):resolve()));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const native=s=>({dev:String(s.dev),ino:String(s.ino),uid:Number(s.uid),gid:Number(s.gid),mode:Number(s.mode&0o7777n),nlink:Number(s.nlink),size:Number(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)});
const start=await next();
if(mode==='failed'){for(const fd of [3,4,5])closeSync(fd);await send({kind:'FAILED',nonce:start.nonce,code:'${PREFIX}historical_invalid',phase:'HISTORY',cleanup:'CONFIRMED'});process.exit(1);}
if(mode==='hang'){await new Promise(resolve=>process.stdin.once('end',resolve));process.exit(1);}
if(mode==='stderr')process.stderr.write('harmless stderr fixture');
const recipeRevision='b'.repeat(40), headers={nonce:start.nonce,recipeRevision,executionId:'local-runtime-evidence-'+start.nonce,directory:'/home/autoworld/${PIN.directoryPrefix}'+start.nonce};
mkdirSync(directory,{mode:0o700});mkdirSync(directory+'/backup',{mode:0o700});
const names=['cold-receipt.json','sql-receipt.json','backup/diagnostic.dump'];
const targets=[],payloads=[];
for(let i=0;i<3;i++){
const src=start.sources[i],fd=i+3,info=readFileSync('/proc/self/fdinfo/'+fd,'utf8');
if(!/^pos:\\s+0\\s*$/m.test(info)||(parseInt(info.match(/^flags:\\s+([0-7]+)/m)[1],8)&3)!==0)throw Error('readonly fixture');
try{writeSync(fd,Buffer.from([1]),0,1,0);throw Error('writable fixture');}catch(error){if(error.code!=='EBADF')throw error;}
if(i<2){try{openSync(src.source,constants.O_RDONLY);throw Error('root source reopened');}catch(error){if(error.code!=='EACCES')throw error;}}
const bytes=Buffer.alloc(src.size);if(readSync(fd,bytes,0,bytes.length,0)!==bytes.length||readSync(fd,Buffer.alloc(1),0,1,bytes.length)!==0||sha(bytes)!==src.sha256)throw Error('byte fixture');
const target=openSync(directory+'/'+names[i],constants.O_RDWR|constants.O_CREAT|constants.O_EXCL,0o600);writeSync(target,bytes);fsyncSync(target);targets.push(target);
payloads.push({name:names[i],role:src.role,size:src.size,sha256:src.sha256,sourceIdentity:native(fstatSync(fd,{bigint:true})),identity:native(fstatSync(target,{bigint:true}))});}
const prepared={kind:'PREPARED',...headers,payloads};
if(mode==='pipeline'){process.stdout.write(JSON.stringify(prepared)+'\\n'+JSON.stringify(prepared)+'\\n');await new Promise(resolve=>process.stdin.once('end',resolve));process.exit(1);}
await send(prepared);const commit=await next();if(commit.kind==='ABORT')process.exit(1);if(commit.kind!=='COMMIT')throw Error('commit fixture');
const receiptBytes=Buffer.from('{"state":"HARMLESS_PARTIAL_TRANSPORT_FIXTURE"}\\n');
const receiptFd=openSync(directory+'/receipt.json',constants.O_RDWR|constants.O_CREAT|constants.O_EXCL,0o600);writeSync(receiptFd,receiptBytes);fsyncSync(receiptFd);
const receipt={name:'receipt.json',size:receiptBytes.length,sha256:sha(receiptBytes),identity:native(fstatSync(receiptFd,{bigint:true}))};
await send({kind:'PUBLISHED',...headers,receipt});const final=await next();if(final.kind==='ABORT')process.exit(1);if(final.kind!=='FINALIZE')throw Error('final fixture');
if(!(await lines.next()).done)throw Error('EOF fixture');
for(const fd of [...targets,receiptFd,3,4,5])closeSync(fd);
const result={kind:'RESULT',...headers,receipt,payloads,sourceUnchanged:true,descriptorsClosed:true};
if(mode==='changed')result.receipt={...receipt,sha256:'a'.repeat(64)};
await send(result);if(mode==='extra')process.stdout.write('extra');
if(mode==='exit')process.exitCode=1;
if(mode==='no-close'){setInterval(()=>{},1000);await new Promise(()=>{});}
`;
}
async function nativeExchange(f, mode = "normal", signal) {
  const worker = `${f.sql}/work/fixture-worker.mjs`; const destination = `${f.sql}/work/copies`;
  f.write(worker, Buffer.from(workerCode(mode, destination)), 1000, 1000);
  const held = reader(f); const child = spawn("/usr/bin/setpriv", [...DROP, process.execPath, worker],
    { env: ENV, stdio: ["pipe", "pipe", "pipe", ...held.descriptors] });
  try {
    return await supervisePostgresPrivateRuntimeEvidenceChild({ child, reader: held, nonce: "a".repeat(24), deadline: Date.now() + (mode === "hang" || mode === "no-close" ? 1500 : 20_000),
      node: process.execPath, worker, sources: f.sources, ...(signal ? { signal } : {}) });
  } finally {
    held.close(); if (existsSync(destination)) f.saveCreated(destination);
    assert.equal(child.exitCode !== null || child.signalCode !== null, true, "actual child terminates before fixture cleanup");
  }
}
test("native actual setpriv UID1000 inherits readonly binary FD slots and completes only a partial transport proof", nativeOptions, () => fixture(async f => {
  const observed = await nativeExchange(f);
  assert.equal(observed.state, "PARTIAL_TRANSPORT_PROOF"); assert.equal(Object.hasOwn(observed, "historicalIntegrity"), false);
  assert.deepEqual(observed.sources.map(file => file.identity), f.original);
  assert.equal(observed.payloads.length, 3); assert.ok(observed.payloads.every(file => file.identity.uid === 1000 && file.identity.gid === 1000));
  assert.deepEqual(f.sources.map(pin => native(lstatSync(pin.source, { bigint: true }))), f.original);
}));
for (const mode of ["pipeline", "stderr", "changed", "extra", "exit"]) {
  test(`native supervisor refuses ${mode} before acknowledgement and closes its own descriptors`, nativeOptions, () => fixture(async f => {
    await assert.rejects(nativeExchange(f, mode), error => error.message.startsWith(PREFIX) && error.diagnostic.cleanup === "UNVERIFIED");
    assert.deepEqual(f.sources.map(pin => native(lstatSync(pin.source, { bigint: true }))), f.original);
  }));
}
test("native parent failure closes readonly originals and bounds actual child termination", nativeOptions, () => fixture(async f => {
  await assert.rejects(nativeExchange(f, "hang"), { message: PREFIX + "control_invalid" });
  assert.deepEqual(f.sources.map(pin => native(lstatSync(pin.source, { bigint: true }))), f.original);
}));
test("native RESULT without real child close cannot become an acknowledgement", nativeOptions, () => fixture(async f => {
  await assert.rejects(nativeExchange(f, "no-close"), { message: PREFIX + "cleanup_uncertain" });
  assert.deepEqual(f.sources.map(pin => native(lstatSync(pin.source, { bigint: true }))), f.original);
}));
test("native actual AbortSignal interrupts a pending frame and closes the owned child", nativeOptions, () => fixture(async f => {
  const controller = new globalThis.AbortController(); const timer = setTimeout(() => controller.abort(), 200);
  try { await assert.rejects(nativeExchange(f, "hang", controller.signal), { message: PREFIX + "operation_failed" }); }
  finally { clearTimeout(timer); }
  assert.deepEqual(f.sources.map(pin => native(lstatSync(pin.source, { bigint: true }))), f.original);
}));
test("native bounded worker failure preserves only its fixed diagnostic and never acknowledges history", nativeOptions, () => fixture(async f => {
  await assert.rejects(nativeExchange(f, "failed"), error => {
    assert.deepEqual(error.diagnostic, { code: PREFIX + "historical_invalid", phase: "HISTORY", cleanup: "UNVERIFIED" });
    return true;
  });
  assert.equal(existsSync(`${f.sql}/work/copies`), false);
}));
test("native missing executable has no unhandled rejection and closes every readonly source", nativeOptions, () => fixture(async f => {
  const held = reader(f); let unhandled = 0;
  const onUnhandled = () => { unhandled++; }; process.on("unhandledRejection", onUnhandled);
  const child = spawn(`${f.sql}/work/absent-executable`, [], { env: ENV, stdio: ["pipe", "pipe", "pipe", ...held.descriptors] });
  try {
    await assert.rejects(supervisePostgresPrivateRuntimeEvidenceChild({ child, reader: held, nonce: "a".repeat(24),
      deadline: Date.now() + 20_000, node: process.execPath, worker: `${f.sql}/work/absent-worker.mjs`, sources: f.sources }), error => {
      assert.equal(error.message, PREFIX + "control_invalid");
      assert.deepEqual(error.diagnostic, { code: PREFIX + "control_invalid", phase: "SOURCE", cleanup: "UNVERIFIED" });
      return true;
    });
    await nextTurn(); assert.equal(unhandled, 0); assert.equal(child.pid, undefined);
    for (const fd of held.descriptors) assert.throws(() => fstatSync(fd), { code: "EBADF" });
    assert.deepEqual(f.sources.map(pin => native(lstatSync(pin.source, { bigint: true }))), f.original);
  } finally { process.removeListener("unhandledRejection", onUnhandled); held.close(); }
}));
}

test("actual root bootstrap or unprivileged actor rejection preserves repository permissions", { skip: process.platform !== "linux" }, () => {
  if (ROOT_NATIVE) return;
  if (process.getuid() === 1000) {
    // Local UID1000 has no sudo authority; the separately run root suite proves inheritance.
    assert.throws(() => openPostgresPrivateRuntimeEvidenceSources({ sources: PIN.sources, deadline: Date.now() + 1000 }), { message: PREFIX + "context_invalid" });
    return;
  }
  const authority = spawnSync("/usr/bin/sudo", ["-n", "/usr/bin/env", "-i", "/usr/bin/id", "-u"],
    { env: ENV, encoding: "utf8", timeout: 10_000, maxBuffer: 4096 });
  assert.equal(authority.error, undefined); assert.equal(authority.status, 0, "CI requires existing noninteractive root authority");
  assert.equal(authority.stdout, "0\n"); assert.equal(authority.stderr, "");
  const result = spawnSync("/usr/bin/sudo", ["-n", "/usr/bin/env", "-i", ...Object.entries(ENV).map(([key, value]) => `${key}=${value}`),
    process.execPath, "--test", FILE], { env: ENV, encoding: "utf8", timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /# fail 0/u); assert.match(result.stdout, /# skipped 0/u);
  assert.match(result.stdout, /ok .*native actual setpriv UID1000 inherits readonly binary FD slots/u);
});
