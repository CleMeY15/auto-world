import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, readdirSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import { posix as path } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { validatePostgresGosuReportInventory } from "./audit-policy.mjs";
import { inspectPostgresPrivateEvidenceSource } from "./private-evidence-source-bundle.mjs";
import { POSTGRES_SOURCE_INVENTORY_PIN as PIN, POSTGRES_SOURCE_INVENTORY_CLAIMS as CLAIMS,
  postgresSourceInventoryLimits as LIMITS } from "./source-inventory-policy.mjs";

const PREFIX = "postgres_source_inventory_";
const PHASES = Object.freeze(["SOURCE", "REPORTS", "MATERIALS", "INVENTORY", "PUBLISH", "FINAL_SEAL"]);
const FAILURE_PHASES = ["CONTEXT", ...PHASES, "OUTPUT", "CLEANUP"];
const REASONS = new Set(["arguments_invalid", "requires_native_actor", "source_invalid", "git_invalid", "storage_invalid", "capacity_invalid",
  "file_invalid", "file_changed", "report_invalid", "inventory_invalid", "publication_failed", "deadline_exceeded", "aborted", "cleanup_uncertain", "output_failed", "operation_failed"]);
const META = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const STABLE = ["dev", "ino", "uid", "gid", "mode", "nlink"];
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const DIGEST = /^sha256:[0-9a-f]{64}$/u; const HEX = /^[0-9a-f]{64}$/u; const REV = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const REQUIRED = Object.freeze(["APK_UPSTREAM_SOURCES_AND_NOTICES", "VIRTUAL_APK_SOURCE_ASSESSMENT", "GO_UPSTREAM_SOURCES_AND_NOTICES",
  "POSTGRESQL_UPSTREAM_SOURCE_AND_NOTICES", "RETAINED_LOWER_LAYER_COVERAGE", "OFFICIAL_ATTESTATION_BUNDLE", "SECOND_WINDOWS_EVIDENCE_COPY"]);
const LOWER = Object.freeze({ state: "UNVERIFIED", scope: "RETAINED_INNER_LAYER_SOURCE_AND_NOTICE_COVERAGE", reason: "INNER_LAYER_OVERLAY_WHITEOUT_COVERAGE_NOT_ESTABLISHED" });
const MATERIAL_ROLES = ["BINARY_APK", "SIGNED_INDEX_MATERIAL", "PUBLIC_SIGNING_KEY", "PACKAGE_RECIPE", "MATERIAL_SELECTION_PROVENANCE"];
const plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, keys) => plain(v) && isDeepStrictEqual(Reflect.ownKeys(v).map(String).sort(), [...keys].sort()) &&
  Reflect.ownKeys(v).every((key) => typeof key === "string" && Object.getOwnPropertyDescriptor(v, key).enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(v, key), "value"));
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([key, value]) => [key, freeze(value)]))) : v;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const absolute = (v) => typeof v === "string" && v.length <= 1024 && v !== "/" && path.isAbsolute(v) && path.normalize(v) === v && !/[\0\r\n\\]/u.test(v);
const relative = (v) => typeof v === "string" && /^[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*$/u.test(v) && v.split("/").every((part) => part !== "." && part !== "..");
const fail = (reason) => { throw new Error(PREFIX + reason); };
const native = (s) => ({ dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
const directoryNative = (s) => Object.fromEntries(DIRECTORY.map((key) => [key, native(s)[key]]));
function dataTree(value, depth = 0, budget = { left: 100000 }) {
  if (--budget.left < 0 || depth > 32) fail("inventory_invalid");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) fail("inventory_invalid"); return;
  }
  const array = Array.isArray(value);
  if (!array && !plain(value) || array && (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1)) fail("inventory_invalid");
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === "length") continue;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value") || array && !/^(?:0|[1-9][0-9]*)$/u.test(key)) fail("inventory_invalid");
    dataTree(d.value, depth + 1, budget);
  }
}
function metadata(v, size, privateFile = true) {
  return exact(v, META) && ["dev", "ino", "mtimeNs", "ctimeNs"].every((key) => typeof v[key] === "string" && DECIMAL.test(v[key])) &&
    ["uid", "gid", "mode", "nlink", "size"].every((key) => Number.isSafeInteger(v[key]) && v[key] >= 0) && v.size === size &&
    v.uid === 1000 && v.gid === 1000 && v.nlink === 1 && (privateFile ? v.mode === 0o600 : (v.mode & 0o7022) === 0);
}
function safeReason(error) {
  try {
    const message = error?.message;
    if (typeof message === "string" && message.startsWith(PREFIX) && REASONS.has(message.slice(PREFIX.length))) return message.slice(PREFIX.length);
    if (message === "postgres_private_evidence_source_bundle_git_invalid") return "git_invalid";
    if (["postgres_private_evidence_source_bundle_cleanup_uncertain", "postgres_private_evidence_source_bundle_git_cleanup_uncertain"].includes(message)) return "cleanup_uncertain";
    if (message === "postgres_gosu_audit_invalid") return "report_invalid";
  } catch { /* Closed fallback for untrusted dependency getters. */ }
  return "operation_failed";
}
export function postgresSourceInventoryFailureDiagnostic(error) {
  const reason = safeReason(error); let phase; let cleanup;
  try { phase = error?.phase; cleanup = error?.cleanup; } catch { /* No raw diagnostic. */ }
  return Object.freeze({ code: PREFIX + reason, phase: FAILURE_PHASES.includes(phase) ? phase : "CONTEXT",
    cleanup: reason !== "cleanup_uncertain" && cleanup === "CONFIRMED" ? "CONFIRMED" : "UNVERIFIED" });
}
export function validatePostgresSourceInventoryFailureDiagnostic(value) {
  if (!exact(value, ["code", "phase", "cleanup"]) || typeof value.code !== "string" ||
    !isDeepStrictEqual(postgresSourceInventoryFailureDiagnostic({ message: value.code, phase: value.phase, cleanup: value.cleanup }), value)) fail("inventory_invalid");
  return freeze({ ...value });
}
function inputValue(value, pin) {
  dataTree(pin);
  if (!exact(pin, Object.keys(PIN))) fail("arguments_invalid");
  const fields = ["workspace", "recipeRevision", "executionId", "directory", ...(plain(value) && Object.hasOwn(value, "signal") ? ["signal"] : [])];
  if (!exact(value, fields) || !absolute(value.workspace) || value.workspace !== pin.workspace || typeof value.recipeRevision !== "string" || !REV.test(value.recipeRevision) ||
    typeof value.executionId !== "string" || !new RegExp(`^${PIN.executionPrefix}[0-9a-f]{24}$`, "u").test(value.executionId) || !absolute(value.directory) ||
    value.directory !== path.join(pin.parent, pin.directoryPrefix + value.executionId.slice(PIN.executionPrefix.length)) ||
    value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal)) fail("arguments_invalid");
  if (!absolute(pin.parent) || !absolute(pin.auditDirectory) || !isDeepStrictEqual(pin.expected, PIN.expected) || pin.subject !== PIN.subject ||
    !isDeepStrictEqual(pin.auditReference, PIN.auditReference) || !isDeepStrictEqual(pin.nonApkRuntime, PIN.nonApkRuntime) ||
    !exact(pin.parentIdentity, DIRECTORY) || pin.parentIdentity.uid !== 1000 || pin.parentIdentity.gid !== 1000 || pin.parentIdentity.mode !== 0o750 ||
    !Array.isArray(pin.reports) || pin.reports.length !== 2 || !Array.isArray(pin.materials) || pin.materials.length !== 5 ||
    !isDeepStrictEqual(pin.reports.map((v) => [v.role, v.name]), PIN.reports.map((v) => [v.role, v.name])) ||
    pin.reports.some((v) => !exact(v, ["role", "name", "size", "sha256"]) || !Number.isSafeInteger(v.size) || v.size < 1 || v.size > LIMITS.reportBytes || typeof v.sha256 !== "string" || !HEX.test(v.sha256)) ||
    pin.materials.some((v) => !exact(v, ["name", "source", "size", "sha256"]) || !relative(v.source) || v.name !== v.source ||
      !Number.isSafeInteger(v.size) || v.size < 1 || v.size > LIMITS.materialBytes || typeof v.sha256 !== "string" || !HEX.test(v.sha256)) ||
    !isDeepStrictEqual(pin.materials.map((v) => v.source), PIN.materials.map((v) => v.source)) ||
    [...pin.reports, ...pin.materials].reduce((total, v) => total + v.size, 0) > LIMITS.inputBytes ||
    [pin.auditDirectory, value.workspace].some((v) => value.directory === v || value.directory.startsWith(v + "/") || v.startsWith(value.directory + "/"))) fail("arguments_invalid");
  return value;
}
function materialRole(file) {
  if (file.endsWith(".apk")) return MATERIAL_ROLES[0]; if (file.endsWith(".tar.gz")) return MATERIAL_ROLES[1];
  if (file.endsWith(".pub")) return MATERIAL_ROLES[2]; if (path.basename(file).startsWith("APKBUILD-")) return MATERIAL_ROLES[3]; return MATERIAL_ROLES[4];
}
function checkInventoryProof(value, expected) {
  const keys = ["kind", "state", "subject", "counts", "packages", "apkOrigins", "virtualApk", "goDependencies", "nonPackageComponents"];
  if (!exact(value, keys) || value.kind !== "POSTGRES_GOSU_REPORT_INVENTORY_V1" || value.state !== "PARITY_VERIFIED" || !isDeepStrictEqual(value.subject, expected.subject) ||
    !Array.isArray(value.packages) || value.packages.length !== 50) fail("inventory_invalid");
  // Reconstruct only the declared projection to reuse the pure parity/schema validator.
  const subject = expected.subject;
  const property = (name, text) => ({ name: "aquasecurity:trivy:" + name, value: text });
  const apk = []; const go = []; const libraries = [];
  for (const p of value.packages) {
    if (!exact(p, ["packageType", "name", "version", "versionPresent", "purl", "bomRef", "packageId", "layerDiffId", "origin", "declarations", "sourceBinding", "noticeBinding"]) ||
      !["alpine", "gobinary"].includes(p.packageType) || typeof p.name !== "string" || typeof p.purl !== "string" || typeof p.bomRef !== "string" || typeof p.packageId !== "string" ||
      typeof p.layerDiffId !== "string" || !DIGEST.test(p.layerDiffId) || typeof p.versionPresent !== "boolean" ||
      (p.version === null ? p.versionPresent : typeof p.version !== "string" || !p.versionPresent) || p.sourceBinding !== "NOT_ESTABLISHED" || p.noticeBinding !== "NOT_ESTABLISHED" ||
      !exact(p.origin, ["namePresent", "name", "versionPresent", "version"]) || typeof p.origin.namePresent !== "boolean" || typeof p.origin.versionPresent !== "boolean" ||
      (p.origin.namePresent ? typeof p.origin.name !== "string" : p.origin.name !== null) || (p.origin.versionPresent ? typeof p.origin.version !== "string" : p.origin.version !== null) ||
      !exact(p.declarations, ["json", "cyclonedx", "textParity"]) || ["json", "cyclonedx"].some((key) => !exact(p.declarations[key], ["present", "values"]) ||
        typeof p.declarations[key].present !== "boolean" || (p.declarations[key].present ? !Array.isArray(p.declarations[key].values) : p.declarations[key].values !== null))) fail("inventory_invalid");
    const pkg = { Name: p.name, ID: p.packageId, Identifier: { PURL: p.purl }, Layer: { DiffID: p.layerDiffId },
      ...(p.versionPresent ? { Version: p.version } : { Relationship: "root", AnalyzedBy: "gobinary", DependsOn: ["github.com/moby/sys/user@v0.1.0", "golang.org/x/sys@v0.1.0", "stdlib@v1.26.8"] }),
      ...(p.origin.namePresent ? { SrcName: p.origin.name } : {}), ...(p.origin.versionPresent ? { SrcVersion: p.origin.version } : {}),
      ...(p.declarations.json.present ? { Licenses: p.declarations.json.values } : {}) };
    (p.packageType === "alpine" ? apk : go).push(pkg);
    libraries.push({ type: "library", name: p.name, ...(p.versionPresent ? { version: p.version } : {}), purl: p.purl, "bom-ref": p.bomRef,
      properties: [property("PkgType", p.packageType), property("PkgID", p.packageId), property("LayerDiffID", p.layerDiffId)],
      ...(p.declarations.cyclonedx.present ? { licenses: p.declarations.cyclonedx.values } : {}) });
  }
  const report = { SchemaVersion: 2, Trivy: { Version: "0.74.0-autoworld.2" }, CreatedAt: "2000-01-01T00:00:00Z", ArtifactType: "container_image", ArtifactName: subject.artifactName,
    Metadata: { ImageID: subject.imageId, RepoTags: [subject.tag], DiffIDs: subject.diffIds, ImageConfig: { os: subject.os, architecture: subject.architecture, rootfs: { type: "layers", diff_ids: subject.diffIds } },
      OS: { Family: subject.osFamily, Name: subject.osVersion } }, Results: [{ Target: `${subject.artifactName} (${subject.osFamily} ${subject.osVersion})`, Class: "os-pkgs", Type: "alpine", Packages: apk },
      { Target: "usr/bin/gosu", Class: "lang-pkgs", Type: "gobinary", Packages: go }] };
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.7", version: 1, metadata: { component: { type: "container", name: subject.artifactName } },
    components: [...libraries, { type: "application", name: "usr/bin/gosu", properties: [property("Type", "gobinary"), property("Class", "lang-pkgs")] },
      { type: "operating-system", name: subject.osFamily, version: subject.osVersion, properties: [property("Type", "alpine"), property("Class", "os-pkgs")] }], dependencies: [value.goDependencies] };
  if (!isDeepStrictEqual(validatePostgresGosuReportInventory({ vulnerabilityReport: report, cyclonedxReport: sbom, expected }), value)) fail("inventory_invalid");
}
export function validatePostgresSourceInventory(value, input, pin = PIN) {
  try {
    dataTree(value); inputValue(input, pin);
    if (!exact(value, ["kind", "state", "authority", "scope", "subject", "recipeRevision", "executionId", "directory", "filesystem", "actor", "reports", "auditReference",
      "inventory", "nonApkRuntime", "materials", "lowerLayers", "claims", "requiredMissing", "phases", "sourceUnchanged"]) ||
      value.kind !== "POSTGRES_EXTERNAL_SOURCE_INVENTORY_V1" || value.state !== "INVENTORY_VERIFIED" || value.authority !== "LOCAL_DIAGNOSTIC" ||
      value.scope !== "DECLARED_COMPONENT_AND_RETAINED_MATERIAL_INVENTORY" || value.subject !== pin.subject || value.recipeRevision !== input.recipeRevision ||
      value.executionId !== input.executionId || value.directory !== input.directory || value.filesystem !== "EXT4" || value.sourceUnchanged !== true ||
      !isDeepStrictEqual(value.actor, { uid: 1000, gid: 1000, capabilities: "ZERO", noNewPrivs: 1 }) || !isDeepStrictEqual(value.auditReference, pin.auditReference) ||
      !isDeepStrictEqual(value.nonApkRuntime, pin.nonApkRuntime) || !isDeepStrictEqual(value.lowerLayers, LOWER) || !isDeepStrictEqual(value.claims, CLAIMS) ||
      !isDeepStrictEqual(value.requiredMissing, REQUIRED) || Buffer.byteLength(JSON.stringify(value)) > LIMITS.inventoryBytes) fail("inventory_invalid");
    for (const [key, expected, privateFile] of [["reports", pin.reports, true], ["materials", pin.materials, false]]) {
      if (!Array.isArray(value[key]) || value[key].length !== expected.length) fail("inventory_invalid");
      for (let i = 0; i < expected.length; i++) {
        const record = value[key][i]; const file = expected[i];
        if (!exact(record, key === "reports" ? ["role", "name", "size", "sha256", "identity"] : ["role", "name", "size", "sha256", "identity", "state", "sourceClosure", "noticeClosure"]) ||
          record.name !== file.name || record.size !== file.size || record.sha256 !== file.sha256 || !metadata(record.identity, file.size, privateFile) ||
          record.role !== (key === "reports" ? file.role : materialRole(file.name)) || key === "materials" &&
          (record.state !== "AVAILABLE_NOT_FULL_SOURCE" || record.sourceClosure !== "NOT_ESTABLISHED" || record.noticeClosure !== "NOT_ESTABLISHED")) fail("inventory_invalid");
      }
    }
    if (new Set([...value.reports, ...value.materials].map((v) => v.identity.dev + ":" + v.identity.ino)).size !== 7 ||
      !Array.isArray(value.phases) || value.phases.length !== PHASES.length || value.phases.some((v, i) => !exact(v, ["name", "result", "durationMs"]) ||
        v.name !== PHASES[i] || v.result !== "PASSED" || !Number.isSafeInteger(v.durationMs) || v.durationMs < 0 || v.durationMs > LIMITS.operationMs)) fail("inventory_invalid");
    checkInventoryProof(value.inventory, pin.expected); return freeze(globalThis.structuredClone(value));
  } catch { fail("inventory_invalid"); }
}
export function validatePostgresSourceInventoryAcknowledgement(value, expected) {
  try {
    dataTree(value);
    if (!exact(expected, ["recipeRevision", "executionId", "directory"]) || typeof expected.recipeRevision !== "string" || !REV.test(expected.recipeRevision) ||
      typeof expected.executionId !== "string" || !/^local-source-inventory-[0-9a-f]{24}$/u.test(expected.executionId) || !absolute(expected.directory) ||
      !exact(value, ["kind", "state", "recipeRevision", "executionId", "directory", "inventory", "sourceUnchanged", "descriptorsClosed"]) ||
      value.kind !== "POSTGRES_SOURCE_INVENTORY_ACK_V1" || value.state !== "INVENTORY_VERIFIED" || value.sourceUnchanged !== true || value.descriptorsClosed !== true ||
      ["recipeRevision", "executionId", "directory"].some((key) => value[key] !== expected[key]) ||
      !exact(value.inventory, ["name", "size", "sha256", "identity"]) || value.inventory.name !== "inventory.json" || !Number.isSafeInteger(value.inventory.size) ||
      value.inventory.size < 1 || value.inventory.size > LIMITS.inventoryBytes || typeof value.inventory.sha256 !== "string" || !HEX.test(value.inventory.sha256) ||
      !metadata(value.inventory.identity, value.inventory.size) || Buffer.byteLength(JSON.stringify(value)) > LIMITS.acknowledgementBytes) fail("inventory_invalid");
    return freeze(globalThis.structuredClone(value));
  } catch { fail("inventory_invalid"); }
}
function nativeActor() {
  if (process.platform !== "linux" || process.getuid() !== 1000 || process.getgid() !== 1000 || process.geteuid() !== 1000 || process.getegid() !== 1000 || !isDeepStrictEqual(process.getgroups(), [1000])) fail("requires_native_actor");
  const status = readFileSync("/proc/self/status", "utf8");
  if (["CapInh", "CapPrm", "CapEff", "CapAmb"].some((key) => !new RegExp(`^${key}:[ \\t]+0{16}$`, "mu").test(status)) || !/^NoNewPrivs:[ \t]+1$/mu.test(status) ||
    !/^Groups:[ \t]*$/mu.test(status) || !/^Uid:[ \t]+1000[ \t]+1000[ \t]+1000[ \t]+1000$/mu.test(status) ||
    !/^Gid:[ \t]+1000[ \t]+1000[ \t]+1000[ \t]+1000$/mu.test(status)) fail("requires_native_actor");
}

async function outputWithinDeadline(action, acknowledgement, signal, deadline) {
  const remaining = deadline - Date.now(); if (remaining <= 0 || signal.aborted) fail("output_failed");
  let timer; let abort;
  try {
    await Promise.race([Promise.resolve().then(() => action(acknowledgement)), new Promise((resolve, reject) => {
      const stop = () => reject(new Error(PREFIX + "output_failed")); abort = stop;
      signal.addEventListener("abort", abort, { once: true }); timer = setTimeout(stop, Math.min(LIMITS.outputMs, remaining));
    })]);
    if (signal.aborted || Date.now() >= deadline) fail("output_failed");
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}
function session(deadline, signal) {
  const handles = []; const directories = new Map(); const anchors = new Map(); let closed = false;
  const check = () => { if (signal.aborted) fail("aborted"); if (Date.now() >= deadline) fail("deadline_exceeded"); };
  const anchor = (file) => {
    const parts = ["", ...file.split("/").filter(Boolean)]; let at = "/";
    for (const part of parts) { if (part) at = path.join(at, part); if (anchors.has(at)) continue;
      const s = lstatSync(at, { bigint: true });
      if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(at) !== at || ![0n, 1000n].includes(s.uid) || (s.mode & 0o6000n) !== 0n ||
        (s.mode & 0o0022n) !== 0n && !(s.uid === 0n && (s.mode & 0o1000n) !== 0n)) fail("storage_invalid");
      const fd = openSync(at, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(fd);
      anchors.set(at, { identity: directoryNative(s), fd });
    }
  };
  const guards = () => { check();
    for (const [file, entry] of anchors) { const s = lstatSync(file, { bigint: true }); if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(file) !== file ||
      !isDeepStrictEqual(directoryNative(s), entry.identity) || !isDeepStrictEqual(directoryNative(fstatSync(entry.fd, { bigint: true })), entry.identity)) fail("file_changed"); }
    for (const [file, entry] of directories) if (!isDeepStrictEqual(directoryNative(fstatSync(entry.fd, { bigint: true })), entry.identity) ||
      !isDeepStrictEqual(directoryNative(lstatSync(file, { bigint: true })), entry.identity)) fail("file_changed");
  };
  const holdDirectory = (file, expected) => { anchor(file); const before = lstatSync(file, { bigint: true });
    if (expected && !isDeepStrictEqual(directoryNative(before), expected)) fail("storage_invalid");
    if (statfsSync(file, { bigint: true }).type !== 0xef53n) fail("storage_invalid");
    const result = spawnSync("/usr/bin/findmnt", ["--noheadings", "--output", "FSTYPE", "--target", file], { timeout: Math.min(10000, Math.max(1, deadline - Date.now())), maxBuffer: 1024,
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
    if (result.error || result.status !== 0 || result.signal || result.stderr.length || !result.stdout.equals(Buffer.from("ext4\n"))) fail("storage_invalid");
    const fd = openSync(file, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(fd);
    directories.set(file, { fd, identity: directoryNative(before) }); guards();
  };
  const fileGuard = (item, unchanged = true) => { guards(); const s = fstatSync(item.fd, { bigint: true }); const named = lstatSync(item.file, { bigint: true }); const id = native(s);
    if (!s.isFile() || !named.isFile() || named.isSymbolicLink() || realpathSync(item.file) !== item.file || !isDeepStrictEqual(native(named), id) ||
      !metadata(id, item.expected.size, item.privateFile) || unchanged && item.identity && !isDeepStrictEqual(item.identity, id)) fail("file_changed"); return id;
  };
  const open = (file, expected, privateFile) => { anchor(path.dirname(file)); guards(); const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); handles.push(fd);
    const item = { file, fd, expected, privateFile }; item.identity = fileGuard(item); return item; };
  const read = (item) => { fileGuard(item); const bytes = Buffer.alloc(item.expected.size); let at = 0;
    while (at < bytes.length) { check(); const n = readSync(item.fd, bytes, at, bytes.length - at, at); if (n < 1) fail("file_changed"); at += n; }
    if (readSync(item.fd, Buffer.alloc(1), 0, 1, at) !== 0 || sha(bytes) !== item.expected.sha256) fail("file_changed"); fileGuard(item); return bytes; };
  const publish = (file, bytes) => { guards(); const fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); handles.push(fd);
    const own = native(fstatSync(fd, { bigint: true }));
    const item = { file, fd, privateFile: true, expected: { size: bytes.length, sha256: sha(bytes) }, own };
    // Capture ownership before a write/fsync can fail.
    return { item, finish: () => { let at = 0; while (at < bytes.length) { check(); const n = writeSync(fd, bytes, at, bytes.length - at, at); if (n < 1) fail("publication_failed"); at += n; }
      fsyncSync(fd); item.identity = fileGuard(item, false); if (!read(item).equals(bytes)) fail("publication_failed"); return item; } };
  };
  const close = () => { if (closed) return; closed = true; let uncertain = false; for (const fd of handles.splice(0)) try { closeSync(fd); } catch { uncertain = true; }
    if (uncertain) fail("cleanup_uncertain"); };
  const retirementGuards = () => {
    for (const [file, entry] of anchors) {
      const s = lstatSync(file, { bigint: true }); if (!s.isDirectory() || s.isSymbolicLink() || !isDeepStrictEqual(directoryNative(s), entry.identity) || realpathSync(file) !== file) fail("cleanup_uncertain");
    }
  };
  return { guards, holdDirectory, open, read, publish, fileGuard, close, retirementGuards };
}
export async function collectPostgresSourceInventory(inputRaw, controls = {}, dependencies = {}) {
  let phase = "CONTEXT"; let held; let publication;
  try {
    if (!exact(controls, Object.hasOwn(controls ?? {}, "result") ? ["result"] : []) || controls.result !== undefined && typeof controls.result !== "function" ||
      !exact(dependencies, Object.hasOwn(dependencies ?? {}, "pin") ? ["pin"] : [])) fail("arguments_invalid");
    const pin = dependencies.pin ?? PIN; const input = inputValue(inputRaw, pin); nativeActor();
    const start = Date.now(); const deadline = start + LIMITS.operationMs;
    const signal = globalThis.AbortSignal.any([globalThis.AbortSignal.timeout(LIMITS.operationMs), ...(input.signal ? [input.signal] : [])]);
    const phases = []; const record = async (name, fn) => { phase = name; const at = Date.now(); held.guards(); const value = await fn(); held.guards(); phases.push({ name, result: "PASSED", durationMs: Date.now() - at }); return value; };
    held = session(deadline, signal); let source;
    await record("SOURCE", async () => {
      source = await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }); if (source.head !== input.recipeRevision) fail("source_invalid");
      held.holdDirectory(pin.parent, pin.parentIdentity); const disk = statfsSync(pin.parent, { bigint: true });
      if (disk.bavail * disk.bsize < BigInt(LIMITS.reservedDiskBytes)) fail("capacity_invalid");
    });
    const reportItems = await record("REPORTS", () => pin.reports.map((file) => held.open(path.join(pin.auditDirectory, file.name), file, true)));
    const reportBytes = reportItems.map((item) => held.read(item));
    const materialItems = await record("MATERIALS", () => pin.materials.map((file) => held.open(path.join(input.workspace, file.source), file, false)));
    for (const item of materialItems) held.read(item);
    const inventory = await record("INVENTORY", () => {
      const parse = (bytes) => { try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("report_invalid"); } };
      return validatePostgresGosuReportInventory({ vulnerabilityReport: parse(reportBytes[0]), cyclonedxReport: parse(reportBytes[1]), expected: pin.expected });
    });
    await record("PUBLISH", () => { mkdirSync(input.directory, { mode: 0o700 }); const s = lstatSync(input.directory, { bigint: true });
      held.holdDirectory(input.directory, { ...directoryNative(s), uid: 1000, gid: 1000, mode: 0o700 }); if (readdirSync(input.directory).length !== 0) fail("publication_failed"); });
    const beforeFinal = Date.now(); phase = "FINAL_SEAL";
    for (const item of [...reportItems, ...materialItems]) held.read(item);
    if (!isDeepStrictEqual(source, await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }))) fail("source_invalid");
    phases.push({ name: "FINAL_SEAL", result: "PASSED", durationMs: Date.now() - beforeFinal });
    const value = { kind: "POSTGRES_EXTERNAL_SOURCE_INVENTORY_V1", state: "INVENTORY_VERIFIED", authority: "LOCAL_DIAGNOSTIC", scope: "DECLARED_COMPONENT_AND_RETAINED_MATERIAL_INVENTORY",
      subject: pin.subject, recipeRevision: input.recipeRevision, executionId: input.executionId, directory: input.directory, filesystem: "EXT4", actor: { uid: 1000, gid: 1000, capabilities: "ZERO", noNewPrivs: 1 },
      reports: reportItems.map((v) => ({ role: v.expected.role, name: v.expected.name, size: v.expected.size, sha256: v.expected.sha256, identity: v.identity })), auditReference: pin.auditReference,
      inventory, nonApkRuntime: pin.nonApkRuntime, materials: materialItems.map((v) => ({ role: materialRole(v.expected.name), name: v.expected.name, size: v.expected.size, sha256: v.expected.sha256,
        identity: v.identity, state: "AVAILABLE_NOT_FULL_SOURCE", sourceClosure: "NOT_ESTABLISHED", noticeClosure: "NOT_ESTABLISHED" })), lowerLayers: LOWER, claims: CLAIMS, requiredMissing: REQUIRED, phases, sourceUnchanged: true };
    const bytes = Buffer.from(JSON.stringify(validatePostgresSourceInventory(value, input, pin)) + "\n"); if (bytes.length > LIMITS.inventoryBytes) fail("publication_failed");
    const pending = held.publish(path.join(input.directory, "inventory.json"), bytes); publication = pending.item; pending.finish();
    for (const item of [...reportItems, ...materialItems]) held.read(item);
    if (!isDeepStrictEqual(source, await inspectPostgresPrivateEvidenceSource({ workspace: input.workspace, deadline, signal }))) fail("source_invalid");
    for (const item of [...reportItems, ...materialItems]) held.read(item);
    if (!isDeepStrictEqual(readdirSync(input.directory), ["inventory.json"]) || !held.read(publication).equals(bytes)) fail("publication_failed");
    held.guards(); held.close();
    const acknowledgement = validatePostgresSourceInventoryAcknowledgement({ kind: "POSTGRES_SOURCE_INVENTORY_ACK_V1", state: "INVENTORY_VERIFIED", recipeRevision: input.recipeRevision,
      executionId: input.executionId, directory: input.directory, inventory: { name: "inventory.json", size: bytes.length, sha256: sha(bytes), identity: publication.identity }, sourceUnchanged: true, descriptorsClosed: true },
    { recipeRevision: input.recipeRevision, executionId: input.executionId, directory: input.directory });
    phase = "OUTPUT";
    if (controls.result) await outputWithinDeadline(controls.result, acknowledgement, signal, deadline);
    return acknowledgement;
  } catch (error) {
    let reason = safeReason(error); let uncertain = reason === "cleanup_uncertain";
    if (publication) try {
      held.retirementGuards(); const s = lstatSync(publication.file, { bigint: true }); const id = native(s);
      if (!s.isFile() || s.isSymbolicLink() || realpathSync(publication.file) !== publication.file || STABLE.some((key) => id[key] !== publication.own[key])) fail("cleanup_uncertain");
      unlinkSync(publication.file);
    } catch { uncertain = true; }
    try { held?.close(); } catch { uncertain = true; }
    if (uncertain) { reason = "cleanup_uncertain"; phase = "CLEANUP"; }
    else if (phase === "OUTPUT") reason = "output_failed";
    const failure = new Error(PREFIX + reason); failure.phase = phase; failure.cleanup = uncertain ? "UNVERIFIED" : "CONFIRMED"; throw failure;
  }
}
