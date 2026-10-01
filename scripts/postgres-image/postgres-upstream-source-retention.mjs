import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, statfsSync } from "node:fs";
import { posix as path } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";
import { inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";
import { createSourceRetentionNativeSession } from "./source-retention-native-session.mjs";
import { POSTGRES_UPSTREAM_SOURCE_PIN as PIN, POSTGRES_UPSTREAM_SOURCE_CLAIMS as CLAIMS, POSTGRES_UPSTREAM_SOURCE_PREFLIGHT_CLAIMS as PREFLIGHT_CLAIMS, postgresUpstreamSourceLimits as LIMITS } from "./postgres-upstream-source-policy.mjs";

const PREFIX = "postgres_upstream_source_";
const PREFLIGHT_PHASES = Object.freeze(["SOURCE", "INPUTS", "INSPECT", "FINAL_SEAL"]);
const PHASES = Object.freeze(["SOURCE", "INPUTS", "COPY", "INSPECT", "PUBLISH", "FINAL_SEAL"]);
const FAILURE_PHASES = ["CONTEXT", ...PHASES, "OUTPUT", "CLEANUP"];
const REASONS = new Set(["arguments_invalid", "requires_native_actor", "source_invalid", "git_invalid", "storage_invalid", "capacity_invalid",
  "file_invalid", "file_changed", "python_invalid", "inspection_failed", "proof_invalid", "publication_failed", "deadline_exceeded", "aborted",
  "cleanup_uncertain", "output_failed", "operation_failed"]);
const META = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const HEX = /^[0-9a-f]{64}$/u;
const REV = /^[0-9a-f]{40}$/u;
const ACTOR = Object.freeze({ uid: 1000, gid: 1000, capabilities: "ZERO", noNewPrivs: 1 });
const ARCHIVE_COUNTS = Object.freeze([{ entries: 7718, uncompressedBytes: 135730425, decodedTarBytes: 141578240 }, { entries: 122, uncompressedBytes: 680576, decodedTarBytes: 768000 }]);
const MISSING = Object.freeze(["COMPLETE_APK_SOURCE_AND_NOTICES", "RETAINED_LOWER_LAYER_COVERAGE", "OFFICIAL_ATTESTATION_BUNDLE", "SECOND_WINDOWS_EVIDENCE_COPY"]);
const plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, keys) => plain(v) && Reflect.ownKeys(v).every((key) => typeof key === "string") && isDeepStrictEqual(Reflect.ownKeys(v).sort(), [...keys].sort()) && Reflect.ownKeys(v).every((key) => {
  const d = Object.getOwnPropertyDescriptor(v, key); return typeof key === "string" && d.enumerable && Object.hasOwn(d, "value");
});
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([key, item]) => [key, freeze(item)]))) : v;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const absolute = (v) => typeof v === "string" && v.length <= 1024 && v !== "/" && path.isAbsolute(v) && path.normalize(v) === v && !/[\0\r\n\\]/u.test(v);
const relative = (v) => typeof v === "string" && /^[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*$/u.test(v) && v.split("/").every((part) => part !== "." && part !== "..");
const reasons = new WeakMap();
const errorValue = (reason) => { const error = new Error(PREFIX + reason); reasons.set(error, reason); return error; };
const fail = (reason) => { throw errorValue(reason); };
const native = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const directoryNative = (s) => Object.fromEntries(DIRECTORY.map((key) => [key, native(s)[key]]));
function dataTree(value, depth = 0, budget = { left: 10000 }) {
  if (--budget.left < 0 || depth > 20) fail("proof_invalid");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) fail("proof_invalid"); return;
  }
  const array = Array.isArray(value);
  if (!array && !plain(value) || array && (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1)) fail("proof_invalid");
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value") || array && !/^(?:0|[1-9][0-9]*)$/u.test(key)) fail("proof_invalid");
    dataTree(d.value, depth + 1, budget);
  }
}
function metadata(value, size, uid = 1000, gid = 1000, mode = 0o600) {
  return exact(value, META) && ["dev", "ino", "mtimeNs", "ctimeNs"].every((key) => typeof value[key] === "string" && DECIMAL.test(value[key])) &&
    ["uid", "gid", "mode", "nlink", "size"].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0) &&
    value.uid === uid && value.gid === gid && value.mode === mode && value.nlink === 1 && value.size === size;
}
function ownValue(value, key) { try { const d = Object.getOwnPropertyDescriptor(value ?? {}, key); return d && Object.hasOwn(d, "value") ? d.value : undefined; } catch { return undefined; } }
function safeReason(error) {
  const branded = reasons.get(error); if (branded) return branded;
  if (!types.isNativeError(error)) return "operation_failed";
  const message = ownValue(error, "message");
  if (typeof message === "string" && message.startsWith(PREFIX) && REASONS.has(message.slice(PREFIX.length))) return message.slice(PREFIX.length);
  if (message === "postgres_private_evidence_source_bundle_git_invalid") return "git_invalid";
  if (["postgres_private_evidence_source_bundle_cleanup_uncertain", "postgres_private_evidence_source_bundle_git_cleanup_uncertain"].includes(message)) return "cleanup_uncertain";
  return "operation_failed";
}
export function postgresUpstreamSourceRetentionFailureDiagnostic(error) {
  const reason = safeReason(error); const known = reasons.has(error) || types.isNativeError(error);
  const phase = known ? ownValue(error, "phase") : undefined; const cleanup = known ? ownValue(error, "cleanup") : undefined;
  return Object.freeze({ code: PREFIX + reason, phase: FAILURE_PHASES.includes(phase) ? phase : "CONTEXT",
    cleanup: reason !== "cleanup_uncertain" && cleanup === "CONFIRMED" ? "CONFIRMED" : "UNVERIFIED" });
}
export function validatePostgresUpstreamSourceRetentionFailureDiagnostic(value) {
  try {
    dataTree(value);
    if (!exact(value, ["code", "phase", "cleanup"]) || typeof value.code !== "string" || !value.code.startsWith(PREFIX) || !REASONS.has(value.code.slice(PREFIX.length)) ||
      !FAILURE_PHASES.includes(value.phase) || !["CONFIRMED", "UNVERIFIED"].includes(value.cleanup) || value.code === PREFIX + "cleanup_uncertain" && value.cleanup !== "UNVERIFIED") fail("proof_invalid");
    return freeze({ ...value });
  } catch { fail("proof_invalid"); }
}

function inputValue(value, pin, preflight = false, requireIdentity = false) {
  dataTree(pin);
  const fields = ["workspace", "recipeRevision", ...(!preflight ? ["executionId", "directory"] : []), ...(plain(value) && Object.hasOwn(value, "signal") ? ["signal"] : [])];
  if (!exact(pin, Object.keys(PIN)) || !exact(value, fields) || value.workspace !== pin.workspace || !absolute(value.workspace) || typeof value.recipeRevision !== "string" || !REV.test(value.recipeRevision) ||
    value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal) || !absolute(pin.parent) || !absolute(pin.inputDirectory) ||
    pin.directoryPrefix !== PIN.directoryPrefix || pin.executionPrefix !== PIN.executionPrefix || pin.subject !== PIN.subject || !isDeepStrictEqual(pin.python, PIN.python) || !isDeepStrictEqual(pin.inspector, PIN.inspector) ||
    !exact(pin.parentIdentity, DIRECTORY) || pin.parentIdentity.uid !== 1000 || pin.parentIdentity.gid !== 1000 || pin.parentIdentity.mode !== 0o750 ||
    requireIdentity && (!exact(pin.inputDirectoryIdentity, DIRECTORY) || pin.inputDirectoryIdentity.uid !== 1000 || pin.inputDirectoryIdentity.gid !== 1000 || pin.inputDirectoryIdentity.mode !== 0o700) ||
    !Array.isArray(pin.archives) || pin.archives.length !== 2 || pin.archives.some((a,i) => !exact(a,Object.keys(PIN.archives[i])) || !Number.isSafeInteger(a.size) || a.size < 1 || a.size > LIMITS.sourceBytes || typeof a.sha256 !== "string" || !HEX.test(a.sha256) ||
      Object.keys(a).filter(key => !["size","sha256"].includes(key)).some(key => !isDeepStrictEqual(a[key],PIN.archives[i][key]))) || pin.archives.reduce((n,a)=>n+a.size,0)>LIMITS.inputBytes) fail("arguments_invalid");
  if (!preflight && (typeof value.executionId !== "string" || !/^local-postgres-upstream-source-retention-[0-9a-f]{24}$/u.test(value.executionId) || !absolute(value.directory) ||
    value.directory !== path.join(pin.parent,pin.directoryPrefix+value.executionId.slice(PIN.executionPrefix.length)) || [pin.inputDirectory,value.workspace].some(v => value.directory === v || value.directory.startsWith(v+"/") || v.startsWith(value.directory+"/")))) fail("arguments_invalid");
  return value;
}
function inspectionValue(value,pin,includeBytes) {
  try {
    dataTree(value); dataTree(pin);
    if (!exact(value,["kind","state","scope","archives","descriptorsClosed"]) || value.kind !== "POSTGRES_UPSTREAM_SOURCE_INSPECTION_V1" || value.state !== "VERIFIED" || value.scope !== "FIXED_POSTGRES_UPSTREAM_SOURCE_ARCHIVES" || value.descriptorsClosed !== true || !Array.isArray(value.archives) || value.archives.length !== 2 || Buffer.byteLength(JSON.stringify(value)) > LIMITS.inspectionBytes) fail("proof_invalid");
    for (const [i,expected] of pin.archives.entries()) {
      const a=value.archives[i]; const selected=[...expected.selectedFiles].sort((x,y)=>x.path<y.path?-1:x.path>y.path?1:0);
      if (!exact(a,["role","name","size","sha256","identity","entries","uncompressedBytes","decodedTarBytes","selectedFiles","missingSelectedFiles","bindings"]) || ["role","name","size","sha256"].some(k=>a[k]!==expected[k]) || !metadata(a.identity,a.size) ||
        ["entries","uncompressedBytes","decodedTarBytes"].some(k=>a[k]!==ARCHIVE_COUNTS[i][k]) || !isDeepStrictEqual(a.bindings,expected.bindings) || !isDeepStrictEqual(a.missingSelectedFiles,[...expected.missingSelectedFiles].sort()) || !Array.isArray(a.selectedFiles) || a.selectedFiles.length!==selected.length) fail("proof_invalid");
      for (const [j,file] of selected.entries()) {
        const v=a.selectedFiles[j]; if (!exact(v,["path","size","sha256",...(includeBytes?["base64"]:[])]) || ["path","size","sha256"].some(k=>v[k]!==file[k]) || !Number.isSafeInteger(v.size) || v.size<1 || v.size>16*1024) fail("proof_invalid");
        if(includeBytes) { if(typeof v.base64!=="string" || v.base64.length>24000) fail("proof_invalid"); const b=Buffer.from(v.base64,"base64"); if(b.length!==v.size || b.toString("base64")!==v.base64 || hash(b)!==v.sha256) fail("proof_invalid"); }
      }
    }
    if(new Set(value.archives.map(a=>a.identity.dev+":"+a.identity.ino)).size!==2) fail("proof_invalid");
    if(includeBytes) {
      const file=value.archives[1].selectedFiles.find(v=>v.path==="17/alpine3.24/Dockerfile");
      const lines=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.from(file.base64,"base64")).split("\n");
      for(const [key,expected] of [["PG_VERSION","17.11"],["PG_SHA256",PIN.archives[0].sha256]])
        if(lines.filter(line=>new RegExp(`^ENV ${key}(?:[ =]|$)`,"u").test(line)).length!==1 || !lines.includes(`ENV ${key} ${expected}`)) fail("proof_invalid");
    }
    return freeze(globalThis.structuredClone(value));
  } catch { fail("proof_invalid"); }
}
export function validatePostgresUpstreamSourceInspection(value,pin=PIN) { return inspectionValue(value,pin,true); }
export function validatePostgresUpstreamSourceInspectionMetadata(value,pin=PIN) { return inspectionValue(value,pin,false); }
function facts(value,pin) {
  if(!exact(value.python,["executable","version","trust","transitiveStdlibClosure","files"]) || ["executable","version","trust","transitiveStdlibClosure"].some(k=>value.python[k]!==pin.python[k]) || !Array.isArray(value.python.files) || value.python.files.length!==5 || !exact(value.inspector,["files"]) || !Array.isArray(value.inspector.files) || value.inspector.files.length!==2) fail("proof_invalid");
  for(const [i,e] of pin.python.files.entries()) { const v=value.python.files[i]; if(!exact(v,["source","size","mode","sha256","identity"]) || ["source","size","mode","sha256"].some(k=>v[k]!==e[k]) || !metadata(v.identity,e.size,0,0,e.mode)) fail("proof_invalid"); }
  for(const [i,v] of value.inspector.files.entries()) {
    const e=i===0?{source:pin.inspector.source}:pin.inspector.core;
    if(!exact(v,["source","size","sha256","identity"]) || v.source!==e.source || !Number.isSafeInteger(v.size) || v.size<1 || v.size>256*1024 || typeof v.sha256!=="string" || !HEX.test(v.sha256) || !metadata(v.identity,v.size,1000,1000,v.identity.mode) || (v.identity.mode&0o7022)!==0 || i===1 && (v.size!==e.size || v.sha256!==e.sha256)) fail("proof_invalid");
  }
}
function phasesValue(value,names) {
  if(!Array.isArray(value) || value.length!==names.length || value.some((v,i)=>!exact(v,["name","result","durationMs"]) || v.name!==names[i] || v.result!=="PASSED" || !Number.isSafeInteger(v.durationMs) || v.durationMs<0 || v.durationMs>LIMITS.operationMs)) fail("proof_invalid");
}
export function validatePostgresUpstreamSourceRetentionReceipt(value,input,pin=PIN) {
  try {
    dataTree(value); inputValue(input,pin);
    if(!exact(value,["kind","state","authority","scope","subject","recipeRevision","executionId","directory","filesystem","actor","sources","inspection","python","inspector","claims","requiredMissing","phases","sourceUnchanged"]) || value.kind!=="POSTGRES_UPSTREAM_SOURCE_RETENTION_V1" || value.state!=="SOURCES_RETAINED" || value.authority!=="LOCAL_DIAGNOSTIC" || value.scope!=="TWO_FIXED_POSTGRES_UPSTREAM_SOURCE_ARCHIVES" || value.subject!==pin.subject || value.filesystem!=="EXT4" || ["recipeRevision","executionId","directory"].some(k=>value[k]!==input[k]) || !isDeepStrictEqual(value.actor,ACTOR) || !isDeepStrictEqual(value.claims,CLAIMS) || !isDeepStrictEqual(value.requiredMissing,MISSING) || value.sourceUnchanged!==true || !Array.isArray(value.sources) || value.sources.length!==2 || Buffer.byteLength(JSON.stringify(value))>LIMITS.receiptBytes) fail("proof_invalid");
    facts(value,pin); phasesValue(value.phases,PHASES); const inspection=validatePostgresUpstreamSourceInspectionMetadata(value.inspection,pin); const ids=[];
    for(const [i,e] of pin.archives.entries()) { const v=value.sources[i]; if(!exact(v,["role","name","sourceUrl","size","sha256","sourceIdentity","identity"]) || ["role","name","sourceUrl","size","sha256"].some(k=>v[k]!==e[k]) || !metadata(v.sourceIdentity,e.size) || !metadata(v.identity,e.size) || !isDeepStrictEqual(v.identity,inspection.archives[i].identity)) fail("proof_invalid"); ids.push(v.sourceIdentity.dev+":"+v.sourceIdentity.ino,v.identity.dev+":"+v.identity.ino); }
    if(new Set(ids).size!==4) fail("proof_invalid"); return freeze(globalThis.structuredClone(value));
  } catch { fail("proof_invalid"); }
}
export function validatePostgresUpstreamSourcePreflight(value,input,pin=PIN) {
  try {
    dataTree(value); inputValue(input,pin,true);
    if(!exact(value,["kind","state","scope","subject","workspace","recipeRevision","filesystem","actor","inputProofs","inspection","python","inspector","claims","phases","sourceUnchanged","retentionAccepted","descriptorsClosed"]) || value.kind!=="POSTGRES_UPSTREAM_SOURCE_PREFLIGHT_V1" || value.state!=="INSPECTION_VERIFIED" || value.scope!=="TWO_FIXED_UPSTREAM_SOURCE_ARCHIVES_NO_RETENTION" || value.subject!==pin.subject || value.workspace!==input.workspace || value.recipeRevision!==input.recipeRevision || value.filesystem!=="EXT4" || !isDeepStrictEqual(value.actor,ACTOR) || !isDeepStrictEqual(value.claims,PREFLIGHT_CLAIMS) || value.sourceUnchanged!==true || value.retentionAccepted!==false || value.descriptorsClosed!==true || !Array.isArray(value.inputProofs) || value.inputProofs.length!==2 || Buffer.byteLength(JSON.stringify(value))>LIMITS.receiptBytes) fail("proof_invalid");
    facts(value,pin); phasesValue(value.phases,PREFLIGHT_PHASES); const inspection=validatePostgresUpstreamSourceInspectionMetadata(value.inspection,pin);
    for(const [i,e] of pin.archives.entries()) { const v=value.inputProofs[i]; if(!exact(v,["role","name","sourceUrl","size","sha256","identity"]) || ["role","name","sourceUrl","size","sha256"].some(k=>v[k]!==e[k]) || !metadata(v.identity,e.size) || !isDeepStrictEqual(v.identity,inspection.archives[i].identity)) fail("proof_invalid"); }
    return freeze(globalThis.structuredClone(value));
  } catch { fail("proof_invalid"); }
}
export function validatePostgresUpstreamSourceRetentionAcknowledgement(value,expected) {
  try {
    dataTree(value);dataTree(expected);
    if(!exact(expected,["recipeRevision","executionId","directory"]) || typeof expected.recipeRevision!=="string" || !REV.test(expected.recipeRevision) || typeof expected.executionId!=="string" || !/^local-postgres-upstream-source-retention-[0-9a-f]{24}$/u.test(expected.executionId) || !absolute(expected.directory) || !exact(value,["kind","state","recipeRevision","executionId","directory","receipt","sourceUnchanged","descriptorsClosed"]) || value.kind!=="POSTGRES_UPSTREAM_SOURCE_RETENTION_ACK_V1" || value.state!=="SOURCES_RETAINED" || ["recipeRevision","executionId","directory"].some(k=>value[k]!==expected[k]) || value.sourceUnchanged!==true || value.descriptorsClosed!==true || !exact(value.receipt,["name","size","sha256","identity"]) || value.receipt.name!=="receipt.json" || !Number.isSafeInteger(value.receipt.size) || value.receipt.size<1 || value.receipt.size>LIMITS.receiptBytes || typeof value.receipt.sha256!=="string" || !HEX.test(value.receipt.sha256) || !metadata(value.receipt.identity,value.receipt.size) || Buffer.byteLength(JSON.stringify(value))>LIMITS.acknowledgementBytes) fail("proof_invalid");
    return freeze(globalThis.structuredClone(value));
  } catch { fail("proof_invalid"); }
}
function nativeActor() {
  if (process.platform !== "linux" || process.versions.node !== "22.23.2" || process.getuid() !== 1000 || process.getgid() !== 1000 || process.geteuid() !== 1000 || process.getegid() !== 1000 ||
    !isDeepStrictEqual(process.getgroups(), [1000])) fail("requires_native_actor");
  const status = readFileSync("/proc/self/status", "utf8");
  if (["CapInh", "CapPrm", "CapEff", "CapAmb"].some((key) => !new RegExp(`^${key}:[ \\t]+0{16}$`, "mu").test(status)) ||
    !/^NoNewPrivs:[ \t]+1$/mu.test(status) || !/^Groups:[ \t]*$/mu.test(status) ||
    !/^Uid:[ \t]+1000[ \t]+1000[ \t]+1000[ \t]+1000$/mu.test(status) || !/^Gid:[ \t]+1000[ \t]+1000[ \t]+1000[ \t]+1000$/mu.test(status)) fail("requires_native_actor");
}
async function outputWithinDeadline(action, acknowledgement, signal, deadline) {
  if (signal.aborted || Date.now() >= deadline) fail("output_failed");
  let timer; let abort;
  try {
    await Promise.race([Promise.resolve().then(() => action(acknowledgement)), new Promise((resolve, reject) => {
      abort = () => reject(errorValue("output_failed")); signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, Math.min(LIMITS.outputMs, deadline - Date.now()));
    })]);
    if (signal.aborted || Date.now() >= deadline) fail("output_failed");
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}
const session = (deadline, signal) => createSourceRetentionNativeSession(deadline, signal, fail);
function gitBlob(input, source, deadline) {
  if (!relative(source)) fail("source_invalid");
  const r = spawnSync("/usr/bin/git", ["--no-replace-objects", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "cat-file", "blob", `${input.recipeRevision}:${source}`], {
    cwd: input.workspace, timeout: Math.min(LIMITS.commandMs, Math.max(1, deadline - Date.now())), maxBuffer: 256 * 1024,
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file" } });
  if (r.error || r.status !== 0 || r.signal || r.stderr.length || r.stdout.length < 1) fail("source_invalid"); return r.stdout;
}
async function inspectCopies(items, runtime, scripts, pin, signal, deadline) {
  const controller = new globalThis.AbortController(); const bounded = globalThis.AbortSignal.any([signal, controller.signal]);
  let child; let timeout; let termination; let failure; let settled = false;
  const stdout = []; const stderr = []; let bytes = 0; let stderrBytes = 0;
  try {
    return await new Promise((resolve, reject) => {
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(termination); bounded.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(value); };
      const abort = () => stop(signal.aborted ? "aborted" : "inspection_failed");
      const stop = (reason) => {
        failure ??= reason; if (child && child.exitCode === null && child.signalCode === null) try { child.kill("SIGKILL"); } catch { failure = "cleanup_uncertain"; }
        termination ??= setTimeout(() => { child?.stdout?.destroy(); child?.stderr?.destroy(); finish(errorValue("cleanup_uncertain")); }, LIMITS.cleanupMs);
      };
      if (bounded.aborted || Date.now() >= deadline) { finish(errorValue(signal.aborted ? "aborted" : "deadline_exceeded")); return; }
      child = spawn(pin.python.executable, pin.python.arguments, { cwd: "/", env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: "/home/autoworld" },
        stdio: ["ignore", "pipe", "pipe", ...items.map((v) => v.fd), runtime[3].fd, runtime[4].fd, ...scripts.map((v) => v.fd)] });
      bounded.addEventListener("abort", abort, { once: true }); timeout = setTimeout(() => stop("deadline_exceeded"), Math.min(LIMITS.inspectionMs, deadline - Date.now()));
      child.on("error", () => { failure = "inspection_failed"; stop(failure); });
      child.stdout.on("error", () => stop("inspection_failed")); child.stderr.on("error", () => stop("inspection_failed"));
      child.stdout.on("data", (chunk) => { bytes += chunk.length; if (bytes > LIMITS.inspectionBytes) stop("inspection_failed"); else stdout.push(Buffer.from(chunk)); });
      child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; if (stderrBytes > 1024) stop("inspection_failed"); else stderr.push(Buffer.from(chunk)); });
      child.on("close", (code, sig) => {
        if (Buffer.concat(stderr).equals(Buffer.from("postgres_upstream_source_inspect_cleanup_uncertain\n"))) failure = "cleanup_uncertain";
        if (failure || code !== 0 || sig || stderrBytes !== 0 || !child.stdout.readableEnded || !child.stderr.readableEnded) { finish(errorValue(failure ?? "inspection_failed")); return; }
        try { const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(stdout)); const value = JSON.parse(raw);
          if (raw !== JSON.stringify(value) + "\n") fail("inspection_failed"); finish(null, validatePostgresUpstreamSourceInspection(value, pin));
        } catch { finish(errorValue("inspection_failed")); }
      });
    });
  } finally { controller.abort(); clearTimeout(timeout); clearTimeout(termination); }
}

function fixedControls(controls,dependencies) {
  if(!exact(controls,Object.hasOwn(controls ?? {},"result")?["result"]:[]) || controls.result!==undefined && typeof controls.result!=="function" || !exact(dependencies,Object.hasOwn(dependencies ?? {},"pin")?["pin"]:[])) fail("arguments_invalid");
}
async function publishAndAcknowledge({held,input,source,all,receipt,controls,signal,deadline,inventory,onPublication,onOutput,partial}) {
  const bytes=Buffer.from(JSON.stringify(receipt)+"\n"); if(bytes.length>LIMITS.receiptBytes) fail("publication_failed");
  const pending=held.publish(path.join(input.directory,"receipt.json"),bytes); onPublication(pending.item); pending.finish();
  if(all.some(v=>v.identity.dev===pending.item.identity.dev && v.identity.ino===pending.item.identity.ino)) fail("publication_failed");
  for(const item of all) held.read(item);
  if(!isDeepStrictEqual(source,await inspectPostgresPrivateEvidenceSource({workspace:input.workspace,deadline,signal}))) fail("source_invalid");
  for(const item of all) held.read(item); inventory(true); if(!held.read(pending.item,true).equals(bytes)) fail("publication_failed"); held.guards();held.close();
  const expected={recipeRevision:input.recipeRevision,executionId:input.executionId,directory:input.directory};
  const receiptFile={name:"receipt.json",size:bytes.length,sha256:hash(bytes),identity:pending.item.identity};
  const acknowledgement=partial?freeze({kind:"TEST_ONLY_POSTGRES_UPSTREAM_COPY_PUBLICATION_ACK_V1",state:"PARTIAL_NATIVE_COPY_PROOF",...expected,receipt:receiptFile,sourceUnchanged:true,descriptorsClosed:true,inspection:"NOT_ATTEMPTED",sourceClosure:"NOT_ESTABLISHED"})
    :validatePostgresUpstreamSourceRetentionAcknowledgement({kind:"POSTGRES_UPSTREAM_SOURCE_RETENTION_ACK_V1",state:"SOURCES_RETAINED",...expected,receipt:receiptFile,sourceUnchanged:true,descriptorsClosed:true},expected);
  onOutput(); if(controls.result) await outputWithinDeadline(controls.result,acknowledgement,signal,deadline); return acknowledgement;
}
async function operate(inputRaw,controls,dependencies,mode) {
  let held;let publication;let phase="CONTEXT"; const preflight=mode==="PREFLIGHT";const partial=mode==="COPY" || mode==="PUBLISH";
  try {
    fixedControls(controls,dependencies); const pin=dependencies.pin ?? PIN;
    if(!partial && !isDeepStrictEqual(pin,PIN)) fail("arguments_invalid");
    const input=inputValue(inputRaw,pin,preflight,true); nativeActor();
    const deadline=Date.now()+LIMITS.operationMs; const signal=globalThis.AbortSignal.any([globalThis.AbortSignal.timeout(LIMITS.operationMs),...(input.signal?[input.signal]:[])]);
    held=session(deadline,signal); const phases=[];let source;
    const record=async(name,action)=>{phase=name;const at=Date.now();held.guards();const value=await action();held.guards();phases.push({name,result:"PASSED",durationMs:Date.now()-at});return value;};
    await record("SOURCE",async()=>{
      source=await inspectPostgresPrivateEvidenceSource({workspace:input.workspace,deadline,signal}); if(source.head!==input.recipeRevision) fail("source_invalid");
      held.directory(pin.parent,pin.parentIdentity);held.directory(pin.inputDirectory,pin.inputDirectoryIdentity);
      if(!preflight && statfsSync(pin.parent,{bigint:true}).bavail*statfsSync(pin.parent,{bigint:true}).bsize<BigInt(LIMITS.reservedDiskBytes)) fail("capacity_invalid");
    });
    const originals=await record("INPUTS",()=>{
      if(!isDeepStrictEqual(readdirSync(pin.inputDirectory).sort(),pin.archives.map(v=>v.name).sort())) fail("file_invalid");
      const items=pin.archives.map(v=>held.open(path.join(pin.inputDirectory,v.name),v));for(const v of items)held.read(v);
      if(new Set(items.map(v=>v.identity.dev+":"+v.identity.ino)).size!==2) fail("file_invalid");return items;
    });
    const copies=preflight?[]:await record("COPY",()=>{
      mkdirSync(input.directory,{mode:0o700});held.directory(input.directory,{...directoryNative(lstatSync(input.directory,{bigint:true})),uid:1000,gid:1000,mode:0o700});
      const target=path.join(input.directory,"archives");mkdirSync(target,{mode:0o700});held.directory(target,{...directoryNative(lstatSync(target,{bigint:true})),uid:1000,gid:1000,mode:0o700});
      if(readdirSync(target).length || !isDeepStrictEqual(readdirSync(input.directory),["archives"])) fail("publication_failed");
      return originals.map(v=>held.copy(v,path.join(target,v.expected.name)));
    });
    const sourceProofs=copies.map((v,i)=>({role:v.expected.role,name:v.expected.name,sourceUrl:v.expected.sourceUrl,size:v.expected.size,sha256:v.expected.sha256,sourceIdentity:originals[i].identity,identity:v.identity}));
    if(!preflight && new Set(sourceProofs.flatMap(v=>[v.sourceIdentity.dev+":"+v.sourceIdentity.ino,v.identity.dev+":"+v.identity.ino])).size!==4) fail("file_invalid");
    const all=[...originals,...copies];let inspection;let python;let inspector;
    const inventory=(receiptPresent=false)=>{
      if(!isDeepStrictEqual(readdirSync(pin.inputDirectory).sort(),pin.archives.map(v=>v.name).sort()) || !preflight && (!isDeepStrictEqual(readdirSync(input.directory).sort(),receiptPresent?["archives","receipt.json"]:["archives"]) || !isDeepStrictEqual(readdirSync(path.join(input.directory,"archives")).sort(),pin.archives.map(v=>v.name).sort()))) fail("publication_failed");
    };
    if(!partial) await record("INSPECT",async()=>{
      const runtime=pin.python.files.map(v=>held.open(v.source,v,0,0,v.mode,true)); for(const v of runtime)held.read(v);all.push(...runtime);
      const scripts=[pin.inspector.source,pin.inspector.core.source].map((sourcePath,i)=>{
        const bytes=gitBlob(input,sourcePath,deadline);if(i===1 && (bytes.length!==pin.inspector.core.size || hash(bytes)!==pin.inspector.core.sha256)) fail("source_invalid");
        const file=path.join(input.workspace,sourcePath);const stat=lstatSync(file,{bigint:true});const item=held.open(file,{source:sourcePath,size:bytes.length,sha256:hash(bytes)},1000,1000,Number(stat.mode&0o7777n));
        if((item.mode&0o7022)!==0 || !held.read(item,true).equals(bytes)) fail("source_invalid");return item;
      });all.push(...scripts);
      const material=preflight?originals:copies;const readers=material.map(v=>held.open(v.file,v.expected));
      if(readers.some((v,i)=>!isDeepStrictEqual(v.identity,material[i].identity))) fail("file_changed");for(const v of readers)held.read(v);all.push(...readers);
      const raw=await inspectCopies(readers,runtime,scripts,pin,signal,deadline);
      if(raw.archives.some((v,i)=>!isDeepStrictEqual(v.identity,material[i].identity))) fail("inspection_failed");
      inspection=validatePostgresUpstreamSourceInspectionMetadata({...raw,archives:raw.archives.map(a=>({...a,selectedFiles:a.selectedFiles.map(({path:memberPath,size,sha256})=>({path:memberPath,size,sha256}))}))},pin);
      python={executable:pin.python.executable,version:pin.python.version,trust:pin.python.trust,transitiveStdlibClosure:pin.python.transitiveStdlibClosure,files:runtime.map(v=>({...v.expected,identity:v.identity}))};
      inspector={files:scripts.map(v=>({...v.expected,identity:v.identity}))};
    });
    if(partial){
      for(const v of all)held.read(v);held.guards();if(!isDeepStrictEqual(source,await inspectPostgresPrivateEvidenceSource({workspace:input.workspace,deadline,signal})))fail("source_invalid");inventory();
      if(mode==="COPY"){held.close();return freeze({kind:"TEST_ONLY_POSTGRES_UPSTREAM_COPY_V1",state:"PARTIAL_NATIVE_COPY_PROOF",scope:"NATIVE_BYTES_AND_PRIVATE_COPIES_ONLY",sources:sourceProofs,descriptorsClosed:true,inspection:"NOT_ATTEMPTED",sourceClosure:"NOT_ESTABLISHED"});}
      phase="PUBLISH";return await publishAndAcknowledge({held,input,source,all,receipt:{kind:"TEST_ONLY_POSTGRES_UPSTREAM_COPY_PUBLICATION_V1",state:"PARTIAL_NATIVE_COPY_PROOF",scope:"NATIVE_BYTES_AND_PRIVATE_COPIES_ONLY",sources:sourceProofs,inspection:"NOT_ATTEMPTED",sourceClosure:"NOT_ESTABLISHED"},controls,signal,deadline,inventory,partial:true,onPublication:item=>{publication=item;},onOutput:()=>{phase="OUTPUT";}});
    }
    if(!preflight) await record("PUBLISH",()=>{for(const v of all)held.read(v);});
    await record("FINAL_SEAL",async()=>{for(const v of all)held.read(v);if(!isDeepStrictEqual(source,await inspectPostgresPrivateEvidenceSource({workspace:input.workspace,deadline,signal})))fail("source_invalid");for(const v of all)held.read(v);inventory();});
    if(preflight){
      const result=validatePostgresUpstreamSourcePreflight({kind:"POSTGRES_UPSTREAM_SOURCE_PREFLIGHT_V1",state:"INSPECTION_VERIFIED",scope:"TWO_FIXED_UPSTREAM_SOURCE_ARCHIVES_NO_RETENTION",subject:pin.subject,workspace:input.workspace,recipeRevision:input.recipeRevision,filesystem:"EXT4",actor:ACTOR,inputProofs:originals.map(v=>({role:v.expected.role,name:v.expected.name,sourceUrl:v.expected.sourceUrl,size:v.expected.size,sha256:v.expected.sha256,identity:v.identity})),inspection,python,inspector,claims:PREFLIGHT_CLAIMS,phases,sourceUnchanged:true,retentionAccepted:false,descriptorsClosed:true},input,pin);
      held.guards();held.close();phase="OUTPUT";if(controls.result)await outputWithinDeadline(controls.result,result,signal,deadline);return result;
    }
    const receipt=validatePostgresUpstreamSourceRetentionReceipt({kind:"POSTGRES_UPSTREAM_SOURCE_RETENTION_V1",state:"SOURCES_RETAINED",authority:"LOCAL_DIAGNOSTIC",scope:"TWO_FIXED_POSTGRES_UPSTREAM_SOURCE_ARCHIVES",subject:pin.subject,recipeRevision:input.recipeRevision,executionId:input.executionId,directory:input.directory,filesystem:"EXT4",actor:ACTOR,sources:sourceProofs,inspection,python,inspector,claims:CLAIMS,requiredMissing:MISSING,phases,sourceUnchanged:true},input,pin);
    return await publishAndAcknowledge({held,input,source,all,receipt,controls,signal,deadline,inventory,partial:false,onPublication:item=>{publication=item;},onOutput:()=>{phase="OUTPUT";}});
  }catch(error){
    let reason=safeReason(error);let uncertain=reason==="cleanup_uncertain";if(publication)try{held.retire(publication);}catch{uncertain=true;}try{held?.close();}catch{uncertain=true;}
    if(uncertain){reason="cleanup_uncertain";phase="CLEANUP";}else if(phase==="OUTPUT")reason="output_failed";
    const failure=errorValue(reason);failure.phase=phase;failure.cleanup=uncertain?"UNVERIFIED":"CONFIRMED";throw failure;
  }
}
export async function collectPostgresUpstreamSources(input,controls={},dependencies={}){return await operate(input,controls,dependencies,"FULL");}
export async function inspectPostgresUpstreamSourceInputs(input,controls={},dependencies={}){return await operate(input,controls,dependencies,"PREFLIGHT");}
// These wrappers prove only shared native copy/publication mechanisms on harmless fixtures.
export async function TEST_ONLY_retainPostgresUpstreamSourceArchiveCopies(input,dependencies={}){return await operate(input,{},dependencies,"COPY");}
export async function TEST_ONLY_publishPostgresUpstreamSourceArchiveCopies(input,controls={},dependencies={}){return await operate(input,controls,dependencies,"PUBLISH");}
