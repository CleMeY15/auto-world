import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { collectPostgresUpstreamSources, TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies, TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies, validatePostgresUpstreamSourceInspection,
  validatePostgresUpstreamSourceInspectionMetadata, inspectPostgresUpstreamSourceInputs, validatePostgresUpstreamSourcePreflight, validatePostgresUpstreamSourceRetentionReceipt, validatePostgresUpstreamSourceRetentionAcknowledgement,
  postgresUpstreamSourceRetentionFailureDiagnostic, validatePostgresUpstreamSourceRetentionFailureDiagnostic } from "../scripts/postgres-image/postgres-upstream-source-retention.mjs";
import { POSTGRES_UPSTREAM_SOURCE_PIN as PIN, POSTGRES_UPSTREAM_SOURCE_CLAIMS as CLAIMS, POSTGRES_UPSTREAM_SOURCE_PREFLIGHT_CLAIMS as PREFLIGHT_CLAIMS } from "../scripts/postgres-image/postgres-upstream-source-policy.mjs";

const rootSource = fileURLToPath(new URL("../", import.meta.url));
const clone = (v) => globalThis.structuredClone(v);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const native = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const metadata = (file) => native(fs.lstatSync(file, { bigint: true }));
const directoryMetadata = (file) => Object.fromEntries(["dev", "ino", "uid", "gid", "mode"].map((key) => [key, metadata(file)[key]]));
const identity = (ino = 1, size = 17) => ({ dev: "2096", ino: String(ino), uid: 1000, gid: 1000, mode: 0o600, nlink: 1, size, mtimeNs: "123", ctimeNs: "124" });
const context = () => { const nonce = "a".repeat(24); return { recipeRevision: "b".repeat(40), executionId: PIN.executionPrefix + nonce, directory: path.posix.join(PIN.parent, PIN.directoryPrefix + nonce) }; };
const ack = () => ({ kind: "POSTGRES_UPSTREAM_SOURCE_RETENTION_ACK_V1", state: "SOURCES_RETAINED", ...context(), receipt: { name: "receipt.json", size: 17, sha256: "d".repeat(64), identity: identity() },
  sourceUnchanged: true, descriptorsClosed: true });


function metadataInspection(pin=PIN) {
  return {kind:"POSTGRES_UPSTREAM_SOURCE_INSPECTION_V1",state:"VERIFIED",scope:"FIXED_POSTGRES_UPSTREAM_SOURCE_ARCHIVES",descriptorsClosed:true,archives:pin.archives.map((a,i)=>({role:a.role,name:a.name,size:a.size,sha256:a.sha256,identity:identity(200+i,a.size),entries:[7718,122][i],uncompressedBytes:[135730425,680576][i],decodedTarBytes:[141578240,768000][i],selectedFiles:clone(a.selectedFiles).sort((x,y)=>x.path<y.path?-1:x.path>y.path?1:0),missingSelectedFiles:[...a.missingSelectedFiles].sort(),bindings:clone(a.bindings)}))};
}
function receipt() {
  const inspection=metadataInspection();
  return {kind:"POSTGRES_UPSTREAM_SOURCE_RETENTION_V1",state:"SOURCES_RETAINED",authority:"LOCAL_DIAGNOSTIC",scope:"TWO_FIXED_POSTGRES_UPSTREAM_SOURCE_ARCHIVES",subject:PIN.subject,...context(),filesystem:"EXT4",actor:{uid:1000,gid:1000,capabilities:"ZERO",noNewPrivs:1},
    sources:PIN.archives.map((a,i)=>({role:a.role,name:a.name,sourceUrl:a.sourceUrl,size:a.size,sha256:a.sha256,sourceIdentity:identity(100+i,a.size),identity:clone(inspection.archives[i].identity)})),inspection,
    python:{executable:PIN.python.executable,version:PIN.python.version,trust:PIN.python.trust,transitiveStdlibClosure:PIN.python.transitiveStdlibClosure,files:PIN.python.files.map((v,i)=>({...v,identity:{...identity(300+i,v.size),uid:0,gid:0,mode:v.mode}}))},
    inspector:{files:[{source:PIN.inspector.source,size:100,sha256:"c".repeat(64),identity:{...identity(400,100),mode:0o644}},{...clone(PIN.inspector.core),identity:{...identity(401,PIN.inspector.core.size),mode:0o644}}]},claims:clone(CLAIMS),requiredMissing:["COMPLETE_APK_SOURCE_AND_NOTICES","RETAINED_LOWER_LAYER_COVERAGE","OFFICIAL_ATTESTATION_BUNDLE","SECOND_WINDOWS_EVIDENCE_COPY"],phases:["SOURCE","INPUTS","COPY","INSPECT","PUBLISH","FINAL_SEAL"].map(name=>({name,result:"PASSED",durationMs:1})),sourceUnchanged:true};
}
test("closed ACK schema binds identity/context and carries no standalone native acceptance",()=>{
  assert.deepEqual(validatePostgresUpstreamSourceRetentionAcknowledgement(ack(),context()),ack());
  for(const mutate of [(v)=>{v.receipt.sha256=[v.receipt.sha256];},v=>{v.receipt.size=[17];},v=>{v.receipt.identity.mode=0o644;},v=>{v.receipt.identity.ino="01";},v=>{v.receipt.identity.uid=0;},v=>{v.receipt.identity.nlink=2;},v=>{v.receipt.size=128*1024+1;},v=>{v.recipeRevision="c".repeat(40);},v=>{v.directory+="/foreign";},v=>{v.receipt.name="../receipt.json";},v=>{v.descriptorsClosed=false;},v=>{v.raw="private fixture";}]){const v=ack();mutate(v);assert.throws(()=>validatePostgresUpstreamSourceRetentionAcknowledgement(v,context()),{message:"postgres_upstream_source_proof_invalid"});}
});
test("nested accessors/hidden fields/Symbols and proxy errors never expose getter contents",()=>{
  let reads=0;
  for(const mutate of [v=>Object.defineProperty(v.receipt.identity,"uid",{enumerable:true,get(){reads++;return 1000;}}),v=>Object.defineProperty(v.receipt,"hidden",{value:true}),v=>{v[Symbol("extra")]=true;},v=>Object.setPrototypeOf(v.receipt,null)]){const v=ack();mutate(v);assert.throws(()=>validatePostgresUpstreamSourceRetentionAcknowledgement(v,context()));}
  const e=new Error();Object.defineProperty(e,"message",{get(){reads++;throw Error("private");}});assert.equal(postgresUpstreamSourceRetentionFailureDiagnostic(e).code,"postgres_upstream_source_operation_failed");
  const p=new Proxy({}, {getPrototypeOf(){reads++;throw Error("private");},getOwnPropertyDescriptor(){reads++;throw Error("private");}});assert.equal(postgresUpstreamSourceRetentionFailureDiagnostic(p).code,"postgres_upstream_source_operation_failed");assert.equal(reads,0);
});
test("closed failure projection preserves cleanup uncertainty priority",()=>{
  const d=postgresUpstreamSourceRetentionFailureDiagnostic(Object.assign(new Error("postgres_upstream_source_cleanup_uncertain"),{phase:"CLEANUP",cleanup:"CONFIRMED"}));
  assert.deepEqual(d,{code:"postgres_upstream_source_cleanup_uncertain",phase:"CLEANUP",cleanup:"UNVERIFIED"});assert.deepEqual(validatePostgresUpstreamSourceRetentionFailureDiagnostic(d),d);assert.throws(()=>validatePostgresUpstreamSourceRetentionFailureDiagnostic({...d,cleanup:"CONFIRMED"}));
  assert.equal(postgresUpstreamSourceRetentionFailureDiagnostic(new Error("postgres_private_evidence_source_bundle_git_cleanup_uncertain")).code,"postgres_upstream_source_cleanup_uncertain");
});
test("metadata-only receipt pins two exact count/selected/runtime/code facts and refuses false authority",()=>{
  const input={workspace:PIN.workspace,...context()}; const value=receipt();assert.ok(Object.isFrozen(validatePostgresUpstreamSourceRetentionReceipt(value,input).inspector.files));assert.deepEqual(validatePostgresUpstreamSourceInspectionMetadata(value.inspection),value.inspection);
  for(const mutate of [v=>{v.inspection.archives[0].entries=1;},v=>{v.inspection.archives[0].uncompressedBytes=1;},v=>{v.inspection.archives[0].decodedTarBytes=1;},v=>{v.inspection.archives[0].decodedTarBytes=[141578240];},v=>{v.inspection.descriptorsClosed=false;},v=>{v.inspection.archives[1].selectedFiles[0].base64="duplication";},v=>{v.inspection.archives[1].selectedFiles[0].sha256="0".repeat(64);},v=>{v.sources[0].identity=clone(v.sources[0].sourceIdentity);},v=>{v.inspector.files[1].sha256="0".repeat(64);},v=>{v.python.files[4].identity.uid=1000;},v=>{v.claims=clone(PREFLIGHT_CLAIMS);},v=>{v.claims.sourceClosure="COMPLETE";},v=>{v.claims.supportStartedAt="2026-10-01";},v=>{v.phases.reverse();},v=>{delete v.python.files[4];},v=>Object.defineProperty(v.actor,"uid",{enumerable:true,get(){throw Error("private");}})]){const v=clone(value);mutate(v);assert.throws(()=>validatePostgresUpstreamSourceRetentionReceipt(v,input),{message:"postgres_upstream_source_proof_invalid"});}
});
test("PURE fixture selected bytes validate exact Dockerfile declarations before metadata discard; no real sources read",()=>{
  const pin=clone(PIN);const value=metadataInspection(pin);
  for(const [i,a] of value.archives.entries()) for(const [j,file] of a.selectedFiles.entries()) {
    const bytes=Buffer.from(file.path==="17/alpine3.24/Dockerfile"?`ENV PG_VERSION 17.11\nENV PG_SHA256 ${PIN.archives[0].sha256}\n`:"harmless selected source fixture\n");
    const target=pin.archives[i].selectedFiles.find(v=>v.path===file.path); target.size=bytes.length;target.sha256=hash(bytes);a.selectedFiles[j]={...target,base64:bytes.toString("base64")};
  }
  assert.ok(Object.isFrozen(validatePostgresUpstreamSourceInspection(value,pin).archives));
  for(const text of [`ENV PG_VERSION=17.11\nENV PG_SHA256 ${PIN.archives[0].sha256}\n`,`ENV PG_VERSION 17.11\nENV PG_VERSION 17.11\nENV PG_SHA256 ${PIN.archives[0].sha256}\n`,`ENV PG_VERSION 17.11\nENV PG_SHA256 ${"0".repeat(64)}\n`]){
    const p=clone(pin);const v=clone(value);const bytes=Buffer.from(text);const e=p.archives[1].selectedFiles.find(f=>f.path==="17/alpine3.24/Dockerfile");e.size=bytes.length;e.sha256=hash(bytes);const f=v.archives[1].selectedFiles.find(f=>f.path===e.path);Object.assign(f,e,{base64:bytes.toString("base64")});assert.throws(()=>validatePostgresUpstreamSourceInspection(v,p));
  }
  const changed=clone(value);changed.archives[0].selectedFiles[0].base64+="\n";assert.throws(()=>validatePostgresUpstreamSourceInspection(changed,pin));
});
test("pure readonly preflight binds original identities and expressly refuses retention claims",()=>{
  const r=receipt();const input={workspace:PIN.workspace,recipeRevision:r.recipeRevision};const value={kind:"POSTGRES_UPSTREAM_SOURCE_PREFLIGHT_V1",state:"INSPECTION_VERIFIED",scope:"TWO_FIXED_UPSTREAM_SOURCE_ARCHIVES_NO_RETENTION",subject:PIN.subject,...input,filesystem:r.filesystem,actor:r.actor,inputProofs:r.sources.map(v=>({role:v.role,name:v.name,sourceUrl:v.sourceUrl,size:v.size,sha256:v.sha256,identity:v.sourceIdentity})),inspection:r.inspection,python:r.python,inspector:r.inspector,claims:clone(PREFLIGHT_CLAIMS),phases:r.phases.filter(v=>!["COPY","PUBLISH"].includes(v.name)),sourceUnchanged:true,retentionAccepted:false,descriptorsClosed:true};
  value.inspection.archives.forEach((a,i)=>{a.identity=clone(value.inputProofs[i].identity);});assert.ok(Object.isFrozen(validatePostgresUpstreamSourcePreflight(value,input).claims));
  for(const mutate of [v=>{v.claims=clone(CLAIMS);},v=>{delete v.claims.inspection;},v=>{delete v.claims.retention;},v=>{v.claims.retention="ACCEPTED";},v=>{v.claims.historicalIntegrity="VERIFIED";},v=>{v.claims.retainedScope="TWO_FIXED_POSTGRES_UPSTREAM_SOURCE_ARCHIVES";},v=>{v.claims.inspection="NOT_ATTEMPTED";},v=>{v.retentionAccepted=true;},v=>{v.inputProofs[0].identity=identity(999,v.inputProofs[0].size);},v=>{v.descriptorsClosed=false;},v=>{v.directory="/foreign";},v=>{v.phases[2].name="COPY";}]){const v=clone(value);mutate(v);assert.throws(()=>validatePostgresUpstreamSourcePreflight(v,input));}
  assert.throws(()=>validatePostgresUpstreamSourceRetentionReceipt(value,{workspace:PIN.workspace,...context()}));
});
test("FULL and readonly preflight reject substituted PIN/actor/schema before output creation",async()=>{
  await assert.rejects(collectPostgresUpstreamSources({}));await assert.rejects(inspectPostgresUpstreamSourceInputs({}));
  const input={workspace:PIN.workspace,...context()}; const bad={...clone(PIN),workspace:"/fixture"};
  await assert.rejects(collectPostgresUpstreamSources(input,{}, {pin:bad}),{message:"postgres_upstream_source_arguments_invalid"});await assert.rejects(inspectPostgresUpstreamSourceInputs({workspace:PIN.workspace,recipeRevision:input.recipeRevision},{},{pin:bad}),{message:"postgres_upstream_source_arguments_invalid"});
  let reads=0;const changed={...input};Object.defineProperty(changed,"workspace",{enumerable:true,get(){reads++;return PIN.workspace;}});await assert.rejects(collectPostgresUpstreamSources(changed));assert.equal(reads,0);
  if(PIN.inputDirectoryIdentity && (process.platform!=="linux" || process.getuid()!==1000 || process.getgid()!==1000)) {await assert.rejects(collectPostgresUpstreamSources(input),{message:"postgres_upstream_source_requires_native_actor"});await assert.rejects(inspectPostgresUpstreamSourceInputs({workspace:PIN.workspace,recipeRevision:input.recipeRevision}),{message:"postgres_upstream_source_requires_native_actor"});}
});
test("legacy gosu ACK bytes/schema remain distinct from additive two-source ACK",async()=>{
  const {validatePostgresGosuSourceRetentionAcknowledgement:legacy}=await import("../scripts/postgres-image/gosu-source-retention.mjs");const old={...ack(),kind:"POSTGRES_GOSU_SOURCE_RETENTION_ACK_V1",executionId:"local-gosu-source-retention-"+"a".repeat(24)};const expected={recipeRevision:old.recipeRevision,executionId:old.executionId,directory:old.directory};assert.equal(JSON.stringify(legacy(old,expected)),JSON.stringify(old));assert.throws(()=>legacy(ack(),context()));assert.throws(()=>validatePostgresUpstreamSourceRetentionAcknowledgement(old,expected));
});

function git(directory, args) {
  const r = spawnSync("/usr/bin/git", ["--no-replace-objects", "-c", "core.hooksPath=/dev/null", ...args], { cwd: directory, timeout: 10000, maxBuffer: 16384, encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file" } });
  assert.equal(r.error, undefined); assert.equal(r.status, 0); assert.equal(r.stderr, ""); return r.stdout.trim();
}
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-postgres-upstream-source-fixture-"))); fs.chmodSync(root, 0o700); const own = metadata(root);
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.equal(metadata(root).ino, own.ino); assert.ok(root.startsWith(path.join(os.tmpdir(), "aw-pg-postgres-upstream-source-fixture-"))); fs.rmSync(root, { recursive: true }); });
  const workspace = path.join(root, "workspace"); const parent = path.join(root, "private"); const inputs = path.join(root, "inputs");
  for (const directory of [workspace, parent, inputs]) fs.mkdirSync(directory, { mode: directory === parent ? 0o750 : 0o700 }); fs.chmodSync(parent, 0o750);
  const bytes = PIN.archives.map((v, i) => Buffer.from(`harmless source fixture ${i}\n`));
  const archives = PIN.archives.map((a, i) => { fs.writeFileSync(path.join(inputs, a.name), bytes[i], { flag: "wx", mode: 0o600 }); return { ...clone(a), size: bytes[i].length, sha256: hash(bytes[i]) }; });
  git(workspace, ["init", "--quiet", "--template="]); fs.writeFileSync(path.join(workspace, "fixture.txt"), "public native copy fixture\n", { mode: 0o644 });
  git(workspace, ["add", "--all"]); git(workspace, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "harmless copy fixture"]);
  const pin = { ...clone(PIN), workspace, parent, parentIdentity: directoryMetadata(parent), inputDirectory: inputs, inputDirectoryIdentity: directoryMetadata(inputs), archives };
  const recipeRevision = git(workspace, ["rev-parse", "HEAD"]); const nonce = randomBytes(12).toString("hex");
  const input = { workspace, recipeRevision, executionId: PIN.executionPrefix + nonce, directory: path.join(parent, PIN.directoryPrefix + nonce) };
  return { root, pin, input, bytes };
}
const nativeActor = process.platform === "linux" && process.getuid() === 1000 && process.getgid() === 1000 &&
  JSON.stringify(process.getgroups()) === "[1000]" && /^Groups:[ \t]*$/mu.test(fs.readFileSync("/proc/self/status", "utf8")) && /^NoNewPrivs:[ \t]+1$/mu.test(fs.readFileSync("/proc/self/status", "utf8"));
const gitVersion = process.platform === "linux" ? spawnSync("/usr/bin/git", ["--version"], { encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } }).stdout.trim() : null;
if (nativeActor && gitVersion === "git version 2.43.0") {
  test("PARTIAL_NATIVE_COPY_PROOF: two harmless files retain exact bytes/private identities and close every held descriptor", async (t) => {
    const f = fixture(t); const originals = f.pin.archives.map((a) => metadata(path.join(f.pin.inputDirectory, a.name)));
    const value = await TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies(f.input, { pin: f.pin });
    assert.equal(value.state, "PARTIAL_NATIVE_COPY_PROOF"); assert.equal(value.inspection, "NOT_ATTEMPTED"); assert.equal(value.sourceClosure, "NOT_ESTABLISHED");
    assert.deepEqual(fs.readdirSync(f.input.directory), ["archives"]); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    for (const [i, source] of value.sources.entries()) {
      const file = path.join(f.input.directory, "archives", source.name); assert.deepEqual(fs.readFileSync(file), f.bytes[i]); assert.deepEqual(metadata(file), source.identity);
      assert.deepEqual(source.sourceIdentity, originals[i]); assert.notEqual(source.identity.ino, originals[i].ino); assert.equal(source.identity.mode, 0o600);
    }
    for (const fd of fs.readdirSync("/proc/self/fd")) { let target; try { target = fs.readlinkSync("/proc/self/fd/" + fd); } catch { continue; } assert.ok(!target.startsWith(f.root)); }
    assert.throws(() => validatePostgresUpstreamSourceRetentionReceipt(value, f.input, f.pin));
  });
  test("native same-name collision preserves the preexisting foreign destination", async (t) => {
    const f = fixture(t); fs.mkdirSync(f.input.directory, { mode: 0o700 }); const before = metadata(f.input.directory);
    await assert.rejects(TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies(f.input, { pin: f.pin })); assert.deepEqual(metadata(f.input.directory), before);
    assert.deepEqual(fs.readdirSync(f.input.directory), []);
  });
  test("native source hashes/modes/links/extra inputs and parent identity substitutions refuse without receipt", async (t) => {
    for (const alter of [
      (f) => fs.writeFileSync(path.join(f.pin.inputDirectory, f.pin.archives[0].name), "changed fixture\n"),
      (f) => fs.chmodSync(path.join(f.pin.inputDirectory, f.pin.archives[0].name), 0o644),
      (f) => fs.linkSync(path.join(f.pin.inputDirectory, f.pin.archives[0].name), path.join(f.root, "extra-hardlink")),
      (f) => fs.writeFileSync(path.join(f.pin.inputDirectory, "foreign.txt"), "fixture", { mode: 0o600 }),
      (f) => { f.pin.parentIdentity.ino = "1"; },
      (f) => { const file = path.join(f.pin.inputDirectory, f.pin.archives[0].name); fs.renameSync(file, file + ".original"); fs.symlinkSync(file + ".original", file); },
    ]) { const f = fixture(t); alter(f); await assert.rejects(TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies(f.input, { pin: f.pin })); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); }
  });
  test("native abort keeps all original harmless source bytes and never accepts a retention result", async (t) => {
    const f = fixture(t); const controller = new globalThis.AbortController(); controller.abort();
    await assert.rejects(TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies({ ...f.input, signal: controller.signal }, { pin: f.pin }));
    for (const [i, a] of f.pin.archives.entries()) assert.deepEqual(fs.readFileSync(path.join(f.pin.inputDirectory, a.name)), f.bytes[i]);
    assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("actual FIFO source slot refuses in a hard-bounded subprocess instead of blocking the native reader", async (t) => {
    const f = fixture(t); const file = path.join(f.pin.inputDirectory, f.pin.archives[0].name); fs.renameSync(file, path.join(f.root, "preserved-regular-source"));
    const made = spawnSync("/usr/bin/mkfifo", ["--mode=600", file], { timeout: 5000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
    assert.equal(made.error, undefined); assert.equal(made.status, 0); assert.equal(fs.lstatSync(file).isFIFO(), true);
    const moduleUrl = new URL("../scripts/postgres-image/postgres-upstream-source-retention.mjs", import.meta.url).href;
    const code = `import {TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies,postgresUpstreamSourceRetentionFailureDiagnostic} from ${JSON.stringify(moduleUrl)};try{await TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies(JSON.parse(process.argv[1]),{pin:JSON.parse(process.argv[2])});process.exitCode=2;}catch(e){process.stdout.write(JSON.stringify(postgresUpstreamSourceRetentionFailureDiagnostic(e)));process.exitCode=1;}`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", code, JSON.stringify(f.input), JSON.stringify(f.pin)], { timeout: 5000, maxBuffer: 16384, encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
    assert.equal(r.error, undefined); assert.equal(r.signal, null); assert.equal(r.status, 1); assert.equal(r.stderr, "");
    assert.deepEqual(JSON.parse(r.stdout), { code: "postgres_upstream_source_file_changed", phase: "INPUTS", cleanup: "CONFIRMED" }); assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("injected fsync failure is a refusal branch, preserves created private payloads, and grants no complete native proof", async (t) => {
    const f = fixture(t); let calls = 0; const original = fs.fsyncSync;
    t.mock.method(fs, "fsyncSync", (fd) => { calls++; if (calls === 1) throw new Error("injected private fixture error"); return original(fd); }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies(f.input, { pin: f.pin }), (e) => {
      assert.deepEqual(postgresUpstreamSourceRetentionFailureDiagnostic(e), { code: "postgres_upstream_source_operation_failed", phase: "COPY", cleanup: "CONFIRMED" }); return true;
    }); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(metadata(path.join(f.input.directory, "archives", f.pin.archives[0].name)).mode, 0o600);
  });
  test("injected post-close error remains cleanup uncertainty; no complete receipt is published", async (t) => {
    const f = fixture(t); const original = fs.closeSync; let injected = false;
    t.mock.method(fs, "closeSync", (fd) => { const target = fs.readlinkSync(`/proc/self/fd/${fd}`); original(fd);
      if (!injected && target.startsWith(f.root)) { injected = true; throw new Error("injected close fixture"); } }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies(f.input, { pin: f.pin }), (e) => {
      assert.equal(postgresUpstreamSourceRetentionFailureDiagnostic(e).cleanup, "UNVERIFIED"); assert.equal(e.message, "postgres_upstream_source_cleanup_uncertain"); return true;
    }); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(injected, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
  });
  test("FULL collector rejects substituted fixture workspace/pins before creating a destination", async (t) => {
    const f = fixture(t); await assert.rejects(collectPostgresUpstreamSources(f.input, {}, { pin: f.pin }), { message: "postgres_upstream_source_arguments_invalid" });
    assert.equal(fs.existsSync(f.input.directory), false);
  });
  test("PARTIAL publication uses shared native seals and closes every FD before a single bounded output callback", async (t) => {
    const f = fixture(t); let callbacks = 0;
    const result = await TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, { result: (value) => {
      callbacks++; assert.equal(value.state, "PARTIAL_NATIVE_COPY_PROOF"); assert.equal(value.descriptorsClosed, true);
      for (const fd of fs.readdirSync("/proc/self/fd")) { let name; try { name = fs.readlinkSync("/proc/self/fd/" + fd); } catch { continue; } assert.ok(!name.startsWith(f.root)); }
    } }, { pin: f.pin });
    assert.equal(callbacks, 1); assert.equal(result.inspection, "NOT_ATTEMPTED");
    const file = path.join(f.input.directory, "receipt.json"); const bytes = fs.readFileSync(file); assert.equal(hash(bytes), result.receipt.sha256);
    assert.deepEqual(metadata(file), result.receipt.identity); assert.deepEqual(fs.readdirSync(f.input.directory).sort(), ["archives", "receipt.json"]);
    assert.throws(() => validatePostgresUpstreamSourceRetentionAcknowledgement(result, { recipeRevision: f.input.recipeRevision, executionId: f.input.executionId, directory: f.input.directory }));
    assert.throws(() => validatePostgresUpstreamSourceRetentionReceipt(JSON.parse(bytes), f.input, f.pin));
  });
  test("PARTIAL late writer exception retires own receipt and reads no unknown exception getter", async (t) => {
    const f = fixture(t); let reads = 0; const error = new Error(); Object.defineProperty(error, "message", { get() { reads++; throw new Error("private fixture"); } });
    await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, { result() { throw error; } }, { pin: f.pin }), (e) => {
      assert.deepEqual(postgresUpstreamSourceRetentionFailureDiagnostic(e), { code: "postgres_upstream_source_output_failed", phase: "OUTPUT", cleanup: "CONFIRMED" }); return true;
    });
    assert.equal(reads, 0); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 2);
  });
  test("PARTIAL late edited owned receipt with changed size/timestamps is retired by stable native identity", async (t) => {
    const f = fixture(t);
    await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, { result(value) {
      const file = path.join(f.input.directory, "receipt.json"); const before = metadata(file);
      const data = JSON.parse(fs.readFileSync(file)); data.fixtureLatePublicValue = "changed length and timestamps"; fs.writeFileSync(file, JSON.stringify(data) + "\n");
      assert.equal(metadata(file).ino, before.ino); assert.notEqual(metadata(file).size, value.receipt.size); throw new Error("late output fixture");
    } }, { pin: f.pin }), (e) => { assert.equal(e.cleanup, "CONFIRMED"); return true; });
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 2);
  });
  test("PARTIAL foreign receipt replacement is preserved with cleanup UNVERIFIED", async (t) => {
    const f = fixture(t);
    await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, { result() {
      const file = path.join(f.input.directory, "receipt.json"); fs.renameSync(file, path.join(f.input.directory, "owned-receipt-preserved.json"));
      fs.writeFileSync(file, "foreign harmless receipt\n", { flag: "wx", mode: 0o600 }); throw new Error("late output fixture");
    } }, { pin: f.pin }), (e) => { assert.equal(e.message, "postgres_upstream_source_cleanup_uncertain"); assert.equal(e.cleanup, "UNVERIFIED"); return true; });
    assert.equal(fs.readFileSync(path.join(f.input.directory, "receipt.json"), "utf8"), "foreign harmless receipt\n");
    assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 2);
  });
  test("PARTIAL changed parent identity preserves the previous receipt and refuses cleanup certainty", async (t) => {
    const f = fixture(t); const previous = path.join(f.root, "moved-private-output");
    await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, { result() {
      fs.renameSync(f.input.directory, previous); fs.mkdirSync(f.input.directory, { mode: 0o700 }); throw new Error("late output fixture");
    } }, { pin: f.pin }), (e) => { assert.equal(e.cleanup, "UNVERIFIED"); return true; });
    assert.equal(fs.existsSync(path.join(previous, "receipt.json")), true); assert.deepEqual(fs.readdirSync(f.input.directory), []);
  });
  test("PARTIAL nonsettling writer is bounded by the real ten-second output deadline", { timeout: 20000 }, async (t) => {
    const f = fixture(t); const started = Date.now();
    await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, { result: () => new Promise(() => {}) }, { pin: f.pin }), { message: "postgres_upstream_source_output_failed" });
    assert.ok(Date.now() - started >= 10000); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false);
    assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 2);
  });
  test("PARTIAL abort during output retires only its owned receipt after FD closure", async (t) => {
    const f = fixture(t); const controller = new globalThis.AbortController();
    await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies({ ...f.input, signal: controller.signal }, { result() {
      controller.abort(); return new Promise(() => {});
    } }, { pin: f.pin }), { message: "postgres_upstream_source_output_failed" });
    assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 2);
  });
  test("PARTIAL injected post-close fault retires own receipt but keeps cleanup uncertainty and never invokes writer", async (t) => {
    const f = fixture(t); const original = fs.closeSync; let injected = false; let callbacks = 0;
    t.mock.method(fs, "closeSync", (fd) => { const target = fs.readlinkSync(`/proc/self/fd/${fd}`); original(fd);
      if (!injected && target === path.join(f.input.directory, "receipt.json")) { injected = true; throw new Error("injected post-close fixture"); } }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, { result() { callbacks++; } }, { pin: f.pin }), (e) => {
      assert.equal(e.message, "postgres_upstream_source_cleanup_uncertain"); assert.equal(e.cleanup, "UNVERIFIED"); return true;
    }); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(injected, true); assert.equal(callbacks, 0); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 2);
  });
  test("PARTIAL injected publication hook with real Git HEAD mutation rejects the last source seal", async (t) => {
    const f = fixture(t); const original = fs.fsyncSync; let changed = false;
    t.mock.method(fs, "fsyncSync", (fd) => { original(fd); if (!changed && fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith("/receipt.json")) {
      changed = true; fs.writeFileSync(path.join(f.input.workspace, "fixture.txt"), "changed public fixture\n"); git(f.input.workspace, ["add", "--all"]);
      git(f.input.workspace, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "late fixture source change"]);
    } }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, {}, { pin: f.pin }), { message: "postgres_upstream_source_source_invalid" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(changed, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 2);
  });
  test("PARTIAL injected publication hook with a real retained-payload mutation fails the postpublication reread", async (t) => {
    const f = fixture(t); const original = fs.fsyncSync; let changed = false;
    t.mock.method(fs, "fsyncSync", (fd) => { original(fd); if (!changed && fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith("/receipt.json")) {
      changed = true; fs.writeFileSync(path.join(f.input.directory, "archives", f.pin.archives[0].name), "changed retained fixture\n");
    } }); syncBuiltinESMExports();
    try { await assert.rejects(TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(f.input, {}, { pin: f.pin }), { message: "postgres_upstream_source_file_changed" }); }
    finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    assert.equal(changed, true); assert.equal(fs.existsSync(path.join(f.input.directory, "receipt.json")), false); assert.equal(fs.readdirSync(path.join(f.input.directory, "archives")).length, 2);
  });
} else if (nativeActor) {
  test("actual unsupported Git refuses native partial/default contexts without a new destination", async (t) => {
    const f = fixture(t); await assert.rejects(TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies(f.input, { pin: f.pin }), { message: "postgres_upstream_source_git_invalid" });
    assert.equal(fs.existsSync(f.input.directory), false);
  });
  test(`native Git2.43 copy positives require the actual version; observed ${gitVersion}`, { skip: true }, () => {});
} else {
  test("native copy proofs require the actual1000:1000/NNP/capability actor", { skip: true }, () => {});
}

test("actual root-to1000 bootstrap stages public code with explicit modes under either umask", { skip: process.platform !== "linux" || process.getuid() !== 0 }, (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-pg-postgres-upstream-source-bootstrap-"))); fs.chmodSync(root, 0o755); const own = metadata(root);
  t.after(() => { assert.equal(fs.realpathSync(root), root); assert.equal(metadata(root).ino, own.ino); assert.ok(root.startsWith(path.join(os.tmpdir(), "aw-pg-postgres-upstream-source-bootstrap-"))); fs.rmSync(root, { recursive: true }); });
  const stage = (source, destination) => {
    assert.ok(destination === root || destination.startsWith(root + path.sep)); const s = fs.lstatSync(source); assert.equal(s.isSymbolicLink(), false);
    if (s.isDirectory()) { fs.mkdirSync(destination, { mode: 0o755 }); fs.chmodSync(destination, 0o755); for (const name of fs.readdirSync(source)) stage(path.join(source, name), path.join(destination, name)); }
    else { assert.equal(s.isFile(), true); fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); fs.chmodSync(destination, 0o644); }
  };
  stage(path.join(rootSource, "scripts", "postgres-image"), path.join(root, "scripts"));
  // Preserve import-relative public paths; no private artifacts, credentials or node_modules are staged.
  fs.renameSync(path.join(root, "scripts"), path.join(root, "postgres-image")); fs.mkdirSync(path.join(root, "scripts"), { mode: 0o755 }); fs.chmodSync(path.join(root, "scripts"), 0o755);
  fs.renameSync(path.join(root, "postgres-image"), path.join(root, "scripts", "postgres-image"));
  fs.mkdirSync(path.join(root, "tests"), { mode: 0o755 }); fs.chmodSync(path.join(root, "tests"), 0o755);
  const target = path.join(root, "tests", "postgres-upstream-source-retention.test.mjs"); fs.copyFileSync(fileURLToPath(import.meta.url), target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o644);
  assert.equal(metadata(target).mode, 0o644); assert.equal(metadata(path.join(root, "tests")).mode, 0o755);
  const node = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
  const r = spawnSync("/usr/bin/setpriv", ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", node, "--test", target], {
    cwd: root, timeout: 180000, maxBuffer: 128 * 1024, encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
  assert.equal(r.error, undefined); assert.equal(r.status, 0, r.stdout); assert.equal(r.stderr, "");
  if (gitVersion === "git version 2.43.0") { assert.match(r.stdout, /# tests 27/u); assert.match(r.stdout, /# pass 26/u); assert.match(r.stdout, /# fail 0/u); assert.match(r.stdout, /# skipped 1/u); assert.match(r.stdout, /PARTIAL_NATIVE_COPY_PROOF/u);
    t.diagnostic("Actual UID1000 child: 26 PASS, 0 FAIL; one root-only test skipped; partial copy/publication proofs only."); }
  else assert.match(r.stdout, /actual unsupported Git refuses/u);
});
