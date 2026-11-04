import { createHash } from "node:crypto";
import { open, lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import { evaluateImageReport } from "./official-controls.mjs";

export const OWNED_SCANNER = Object.freeze({
  schemaVersion: 1,
  receiptKind: "auto-world-trivy-0.76.1-jose4.1.6-r1",
  applicationVersion: "0.76.1",
  sourceRepository: "https://github.com/aquasecurity/trivy.git",
  sourceCommit: "e713f67f7d54decdcd9b3132c9751833dcced698",
  sourceTree: "2b2e1ef32745d09fbd85b9d040da722333dd4258",
  mainPath: "github.com/aquasecurity/trivy",
  commandPath: "github.com/aquasecurity/trivy/cmd/trivy",
  goVersion: "go1.27.3",
  goJosePath: "github.com/go-jose/go-jose/v4",
  goJoseVersion: "v4.1.6",
  goJoseSum: "h1:sNRkftxFJxwsILiQukqp5z83QBSmntVwmgRY7AqBDO4=",
  goJoseGoModSum: "h1:x4oUasVrzR7071A4TnHLGSPpNOm2a21K9Kf04k1rs08=",
  patchSha256: "d0a813858c9ddca40ee2327bbce3f520c6b2eec3dc4b8b84deefc281aea0edea",
  goModSha256: "cb75cc749fd36f4ec0a6a152aa40598653e0b5a8f58b9cf9702a29f62f5bcc81",
  goSumSha256: "a934abfc262a21a885c2c9b755f43397460996d67a07d1ab3fa52e8e66d94e84",
  builderReference: "golang@sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747",
  builderIndexDigest: "sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c",
  builderPlatformDigest: "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747",
  goArchiveUrl: "https://go.dev/dl/go1.27.3.linux-amd64.tar.gz",
  goArchiveBytes: 70_588_678,
  goArchiveSha256: "65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40",
});

const SHA256 = /^[a-f0-9]{64}$/u;
const H1 = /^h1:[A-Za-z0-9+/]{43}=$/u;
const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._~+-]*)*$/u;
const VERSION = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?$/u;
const EXACT_BUILD_FLAGS = Object.freeze([
  "-mod=readonly", "-trimpath", "-buildvcs=false",
  "-ldflags=-s -w -buildid= -extldflags=-static -X github.com/aquasecurity/trivy/pkg/version/app.ver=0.76.1",
]);
const STATES = Object.freeze([
  "BUILD_DIAGNOSTIC", "IDENTITY_REPRODUCIBLE", "SELF_AUDITED", "CONTROLS_PASSED",
  "BUILDER_AUDITED", "QUALIFIED_FOR_THIS_JOB",
]);
const CONTROL_NAMES = Object.freeze([
  "version-probe", "fixture-gomod-vulnerable", "fixture-java-war-vulnerable", "fixture-java-jar-clean-candidate",
  "cargo-lock-vulnerable", "cargo-lock-clean",
]);
const LEGACY_BASELINE_NAMES = Object.freeze(["fixture-gomod-vulnerable", "fixture-java-war-vulnerable"]);
const PAIR_PROOFS = new WeakSet();
const SELF_PROOFS = new WeakSet();
const COMPARISON_PROOFS = new WeakSet();
const NEGATIVE_PROOFS = new WeakSet();
const LEGACY_PROOFS = new WeakSet();
const CONTROL_SET_PROOFS = new WeakSet();
const BUILDER_PROOFS = new WeakSet();
const QUALIFICATION_PROOFS = new WeakSet();
const QUALIFICATION_INPUTS = new WeakMap();

const fail = (code) => { throw new Error(code); };
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const nonEmpty = (value, max = 16_384) => typeof value === "string" && value.length > 0 && value.length <= max;
const safeInt = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const sha = (value) => typeof value === "string" && SHA256.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const branded = (set, value) => { const result = Object.freeze(value); set.add(result); return result; };

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  fail("scanner_owned_canonical_value_invalid");
}

export const canonicalOwnedJson = canonical;

function validateRun(run) {
  if (!exactKeys(run, ["workflow", "runId", "runAttempt", "sourceSha"]) ||
      !nonEmpty(run.workflow, 256) || !/^\d+$/u.test(run.runId) || !safeInt(run.runAttempt, 1) || !/^[a-f0-9]{40}$/u.test(run.sourceSha)) {
    fail("scanner_owned_receipt_run_invalid");
  }
}

function validateSource(source) {
  if (!exactKeys(source, ["repository", "commit", "tree", "patchSha256", "goModSha256", "goSumSha256"]) ||
      source.repository !== OWNED_SCANNER.sourceRepository || source.commit !== OWNED_SCANNER.sourceCommit ||
      source.tree !== OWNED_SCANNER.sourceTree || source.patchSha256 !== OWNED_SCANNER.patchSha256 ||
      source.goModSha256 !== OWNED_SCANNER.goModSha256 || source.goSumSha256 !== OWNED_SCANNER.goSumSha256) {
    fail("scanner_owned_receipt_source_invalid");
  }
}

function validateCompiler(compiler, construction) {
  const expectedDelivery = construction === "A" ? "BUILDER_IMAGE" : "OFFICIAL_ARCHIVE";
  if (!exactKeys(compiler, ["delivery", "goVersion", "goos", "goarch", "cgoEnabled", "identity"]) ||
      compiler.delivery !== expectedDelivery || compiler.goVersion !== OWNED_SCANNER.goVersion || compiler.goos !== "linux" ||
      compiler.goarch !== "amd64" || compiler.cgoEnabled !== false) fail("scanner_owned_receipt_compiler_invalid");
  if (construction === "A") {
    if (!exactKeys(compiler.identity, ["kind", "reference", "indexDigest", "platformDigest"]) || compiler.identity.kind !== "OCI_PLATFORM" ||
        compiler.identity.reference !== OWNED_SCANNER.builderReference || compiler.identity.indexDigest !== OWNED_SCANNER.builderIndexDigest ||
        compiler.identity.platformDigest !== OWNED_SCANNER.builderPlatformDigest) fail("scanner_owned_receipt_compiler_invalid");
  } else if (!exactKeys(compiler.identity, ["kind", "url", "bytes", "sha256"]) || compiler.identity.kind !== "GO_ARCHIVE" ||
      compiler.identity.url !== OWNED_SCANNER.goArchiveUrl || compiler.identity.bytes !== OWNED_SCANNER.goArchiveBytes ||
      compiler.identity.sha256 !== OWNED_SCANNER.goArchiveSha256) fail("scanner_owned_receipt_compiler_invalid");
}

function validateJournal(journal) {
  if (!Array.isArray(journal) || journal.length < 1 || journal.length > 128) fail("scanner_owned_receipt_journal_invalid");
  let previous = -1;
  const stages = new Set();
  for (const entry of journal) {
    if (!exactKeys(entry, ["stage", "status", "monotonicMs"]) || !nonEmpty(entry.stage, 128) ||
        !["ATTEMPTED", "PASSED", "FAILED", "CLEANED"].includes(entry.status) ||
        !Number.isFinite(entry.monotonicMs) || entry.monotonicMs < previous || stages.has(`${entry.stage}\0${entry.status}`)) {
      fail("scanner_owned_receipt_journal_invalid");
    }
    previous = entry.monotonicMs;
    stages.add(`${entry.stage}\0${entry.status}`);
  }
  if (!journal.some((entry) => entry.status === "ATTEMPTED")) fail("scanner_owned_receipt_journal_invalid");
}

function validateClosure(closure) {
  if (!exactKeys(closure, ["sha256", "modules", "materials"]) || !sha(closure.sha256) || !Array.isArray(closure.modules) ||
      !Array.isArray(closure.materials) || closure.modules.length < 100 || closure.modules.length > 4096 ||
      closure.materials.length !== closure.modules.length) fail("scanner_owned_closure_invalid");
  const paths = new Set();
  for (const module of closure.modules) {
    if (!exactKeys(module, ["path", "version", "sum", "goModSum", "compiled"]) || !MODULE_PATH.test(module.path ?? "") ||
        !VERSION.test(module.version ?? "") || !H1.test(module.sum ?? "") || !H1.test(module.goModSum ?? "") ||
        typeof module.compiled !== "boolean" || paths.has(module.path)) fail("scanner_owned_closure_invalid");
    paths.add(module.path);
  }
  const materialKeys = new Set();
  for (const material of closure.materials) {
    if (!exactKeys(material, ["path", "version", "zip", "mod", "info"]) || !MODULE_PATH.test(material.path ?? "") ||
        !VERSION.test(material.version ?? "") || materialKeys.has(`${material.path}@${material.version}`)) fail("scanner_owned_closure_invalid");
    for (const identity of [material.zip, material.mod, material.info]) {
      if (!exactKeys(identity, ["bytes", "sha256"]) || !safeInt(identity.bytes, 1) || !sha(identity.sha256)) fail("scanner_owned_closure_invalid");
    }
    materialKeys.add(`${material.path}@${material.version}`);
  }
  const moduleKeys = closure.modules.map((item) => `${item.path}@${item.version}`);
  if (canonical(moduleKeys) !== canonical([...moduleKeys].sort((left, right) => left.localeCompare(right, "en"))) ||
      canonical([...materialKeys]) !== canonical([...materialKeys].sort((left, right) => left.localeCompare(right, "en"))) ||
      moduleKeys.some((key) => !materialKeys.has(key)) ||
      closure.sha256 !== createHash("sha256").update(`${canonical({ modules: closure.modules, materials: closure.materials })}\n`).digest("hex")) {
    fail("scanner_owned_closure_invalid");
  }
  const jose = closure.modules.filter((module) => module.path === OWNED_SCANNER.goJosePath);
  if (jose.length !== 1 || jose[0].version !== OWNED_SCANNER.goJoseVersion || jose[0].sum !== OWNED_SCANNER.goJoseSum ||
      jose[0].goModSum !== OWNED_SCANNER.goJoseGoModSum || jose[0].compiled !== true ||
      closure.modules.some((module) => module.path === OWNED_SCANNER.goJosePath && module.version === "v4.1.5")) {
    fail("scanner_owned_closure_jose_invalid");
  }
  return closure;
}

function parseModule(fields, allowDevel = false) {
  if (![4, 5].includes(fields.length) || !MODULE_PATH.test(fields[2] ?? "")) fail("scanner_owned_build_info_invalid");
  const version = fields[3];
  if (!(VERSION.test(version) || allowDevel && version === "(devel)")) fail("scanner_owned_build_info_invalid");
  const sum = fields[4] ?? "";
  if (sum && !H1.test(sum)) fail("scanner_owned_build_info_invalid");
  return { path: fields[2], version, sum };
}

export function parseOwnedGoBuildInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 4 * 1024 ** 2) fail("scanner_owned_build_info_invalid");
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("scanner_owned_build_info_invalid"); }
  if (/[\0\v\f]/u.test(decoded)) fail("scanner_owned_build_info_invalid");
  const raw = decoded.replaceAll("\r\n", "\n").replace(/\n$/u, "");
  const lines = raw.split("\n");
  if (lines.length > 5000 || !/^[^\t\r\n]{1,4096}: go1\.27\.3$/u.test(lines.shift() ?? "")) fail("scanner_owned_build_info_invalid");
  let commandPath = null;
  let main = null;
  const dependencies = new Map();
  const settings = new Map();
  for (const line of lines) {
    const fields = line.split("\t");
    if (fields[0] !== "" || line.length > 16_384 || line.includes("\r")) fail("scanner_owned_build_info_invalid");
    if (fields[1] === "path") {
      if (fields.length !== 3 || commandPath !== null || fields[2] !== OWNED_SCANNER.commandPath) fail("scanner_owned_build_info_invalid");
      commandPath = fields[2];
    } else if (fields[1] === "mod") {
      const item = parseModule(fields, true);
      if (main !== null || item.path !== OWNED_SCANNER.mainPath || item.version !== "(devel)" || item.sum !== "") fail("scanner_owned_build_info_invalid");
      main = item;
    } else if (fields[1] === "dep") {
      const item = parseModule(fields);
      if (dependencies.has(item.path) || item.path === OWNED_SCANNER.mainPath || item.sum === "") fail("scanner_owned_build_info_invalid");
      dependencies.set(item.path, item);
    } else if (fields[1] === "build") {
      if (fields.length !== 3) fail("scanner_owned_build_info_invalid");
      const match = /^([-A-Za-z0-9_.]+)=(.*)$/u.exec(fields[2]);
      if (!match || settings.has(match[1]) || /[\0\r\n]/u.test(match[2])) fail("scanner_owned_build_info_invalid");
      settings.set(match[1], match[2]);
    } else fail("scanner_owned_build_info_invalid");
  }
  if (commandPath !== OWNED_SCANNER.commandPath || main === null || dependencies.size < 100 ||
      settings.get("-buildmode") !== "exe" || settings.get("-compiler") !== "gc" || settings.get("-trimpath") !== "true" ||
      settings.get("GOOS") !== "linux" || settings.get("GOARCH") !== "amd64" || settings.get("GOAMD64") !== "v1" || settings.get("CGO_ENABLED") !== "0" ||
      [...settings.keys()].some((key) => !["-buildmode", "-compiler", "-trimpath", "CGO_ENABLED", "GOARCH", "GOOS", "GOAMD64"].includes(key)) ||
      [...settings.keys()].some((key) => key === "vcs" || key.startsWith("vcs."))) fail("scanner_owned_build_info_invalid");
  const jose = dependencies.get(OWNED_SCANNER.goJosePath);
  if (!jose || jose.version !== OWNED_SCANNER.goJoseVersion || jose.sum !== OWNED_SCANNER.goJoseSum) fail("scanner_owned_build_info_invalid");
  return Object.freeze({ raw, goVersion: OWNED_SCANNER.goVersion, commandPath, main, dependencies: [...dependencies.values()].sort((a, b) => a.path.localeCompare(b.path)), settings: Object.fromEntries([...settings].sort()) });
}

export function validateOwnedBuildInfo(bytes, closure) {
  const parsed = parseOwnedGoBuildInfo(bytes);
  validateClosure(closure);
  const compiled = closure.modules.filter((module) => module.compiled).sort((a, b) => a.path.localeCompare(b.path));
  if (compiled.length !== parsed.dependencies.length) fail("scanner_owned_compiled_closure_mismatch");
  for (let index = 0; index < compiled.length; index += 1) {
    const expected = compiled[index];
    const actual = parsed.dependencies[index];
    if (expected.path !== actual.path || expected.version !== actual.version || expected.sum !== actual.sum) fail("scanner_owned_compiled_closure_mismatch");
  }
  return parsed;
}

export function validateDiagnosticReceipt(receipt, rawBuildInfo = undefined) {
  const keys = ["schemaVersion", "receiptKind", "state", "construction", "run", "source", "compiler", "binary", "build", "closure", "journal"];
  if (!exactKeys(receipt, keys) || receipt.schemaVersion !== OWNED_SCANNER.schemaVersion || receipt.receiptKind !== OWNED_SCANNER.receiptKind ||
      receipt.state !== "BUILD_DIAGNOSTIC" || !["A", "B"].includes(receipt.construction)) fail("scanner_owned_receipt_invalid");
  validateRun(receipt.run);
  validateSource(receipt.source);
  validateCompiler(receipt.compiler, receipt.construction);
  if (!exactKeys(receipt.binary, ["path", "bytes", "sha256"]) || receipt.binary.path !== "/out/trivy" ||
      !safeInt(receipt.binary.bytes, 1) || receipt.binary.bytes > 256 * 1024 ** 2 || !sha(receipt.binary.sha256)) fail("scanner_owned_receipt_binary_invalid");
  if (!exactKeys(receipt.build, ["commandPath", "appVersion", "flags", "rawBuildInfo"]) ||
      receipt.build.commandPath !== OWNED_SCANNER.commandPath || receipt.build.appVersion !== OWNED_SCANNER.applicationVersion ||
      !Array.isArray(receipt.build.flags) || canonical(receipt.build.flags) !== canonical(EXACT_BUILD_FLAGS) || !nonEmpty(receipt.build.rawBuildInfo, 4 * 1024 ** 2)) {
    fail("scanner_owned_receipt_build_invalid");
  }
  validateClosure(receipt.closure);
  validateJournal(receipt.journal);
  const bytes = rawBuildInfo ?? Buffer.from(receipt.build.rawBuildInfo, "utf8");
  const parsed = validateOwnedBuildInfo(bytes, receipt.closure);
  if (parsed.raw !== receipt.build.rawBuildInfo.replaceAll("\r\n", "\n").replace(/\n$/u, "")) fail("scanner_owned_receipt_build_invalid");
  return Object.freeze({ construction: receipt.construction, receipt: clone(receipt), parsed });
}

export function validateReproduciblePair(receiptA, receiptB, rawA = undefined, rawB = undefined) {
  const a = validateDiagnosticReceipt(receiptA, rawA);
  const b = validateDiagnosticReceipt(receiptB, rawB);
  if (receiptA.construction !== "A" || receiptB.construction !== "B" ||
      canonical(receiptA.run) !== canonical(receiptB.run) || canonical(receiptA.source) !== canonical(receiptB.source) ||
      receiptA.binary.bytes !== receiptB.binary.bytes || receiptA.binary.sha256 !== receiptB.binary.sha256 ||
      receiptA.closure.sha256 !== receiptB.closure.sha256 || canonical(receiptA.closure.modules) !== canonical(receiptB.closure.modules) ||
      a.parsed.raw !== b.parsed.raw || canonical(receiptA.build.flags) !== canonical(receiptB.build.flags)) fail("scanner_owned_reproducibility_mismatch");
  const compiledInventory = receiptA.closure.modules.filter((item) => item.compiled)
    .map(({ path: modulePath, version, sum }) => ({ path: modulePath, version, sum }));
  return branded(PAIR_PROOFS, { state: "IDENTITY_REPRODUCIBLE", run: clone(receiptA.run), source: clone(receiptA.source), binary: clone(receiptA.binary),
    closureSha256: receiptA.closure.sha256, stdlib: Object.freeze({ path: "stdlib", version: "v1.27.3" }),
    compiledInventory: Object.freeze(compiledInventory) });
}

function reportInventory(report) {
  if (!record(report) || report.SchemaVersion !== 2 || report.Trivy?.Version !== OWNED_SCANNER.applicationVersion ||
      report.ArtifactType !== "filesystem" || !nonEmpty(report.ArtifactName) ||
      !Array.isArray(report.Results) || report.Results.length !== 1) fail("scanner_owned_self_report_invalid");
  const result = report.Results[0];
  if (!nonEmpty(result?.Target) || result.Class !== "lang-pkgs" || result.Type !== "gobinary" || !Array.isArray(result.Packages)) {
    fail("scanner_owned_self_report_invalid");
  }
  const packages = new Map();
  for (const item of result.Packages) {
    if (!record(item) || !nonEmpty(item.Name) || item.Version !== undefined && !nonEmpty(item.Version) || !nonEmpty(item.Identifier?.PURL) ||
        packages.has(item.Identifier.PURL)) fail("scanner_owned_self_inventory_invalid");
    packages.set(item.Identifier.PURL, `${item.Name}\0${item.Version ?? ""}`);
  }
  const findings = [];
  for (const item of result.Vulnerabilities ?? []) {
    if (!record(item) || !nonEmpty(item.VulnerabilityID) || !nonEmpty(item.PkgName) || !nonEmpty(item.InstalledVersion) ||
        !["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"].includes(item.Severity)) fail("scanner_owned_self_finding_invalid");
    if (["HIGH", "CRITICAL"].includes(item.Severity)) fail("scanner_owned_self_audit_blocked");
    if (item.PkgName === OWNED_SCANNER.mainPath || item.PkgIdentifier?.PURL?.includes(OWNED_SCANNER.mainPath)) fail("scanner_owned_unversioned_main_finding_blocked");
    findings.push(canonical([item.VulnerabilityID, item.PkgName, item.InstalledVersion, item.FixedVersion ?? "", item.Severity]));
  }
  return { packages, findings: findings.sort() };
}

function validateSbom(sbom, reportPackages, report) {
  if (!record(sbom) || sbom.bomFormat !== "CycloneDX" || sbom.metadata?.component?.type !== "application" ||
      sbom.metadata.component.name !== report.ArtifactName || !nonEmpty(sbom.metadata.component["bom-ref"]) ||
      !Array.isArray(sbom.components) || !Array.isArray(sbom.dependencies)) fail("scanner_owned_sbom_invalid");
  const purls = new Set();
  const applications = [];
  const refs = new Set([sbom.metadata.component["bom-ref"]].filter((value) => nonEmpty(value)));
  for (const component of sbom.components) {
    if (!record(component) || !nonEmpty(component["bom-ref"]) || refs.has(component["bom-ref"])) fail("scanner_owned_sbom_invalid");
    refs.add(component["bom-ref"]);
    if (component.type === "application") {
      if (component.purl !== undefined) fail("scanner_owned_sbom_invalid");
      applications.push(component);
    } else {
      if (component.type !== "library" || !nonEmpty(component.purl) || purls.has(component.purl) ||
          reportPackages.get(component.purl) !== `${component.name}\0${component.version ?? ""}`) fail("scanner_owned_sbom_invalid");
      purls.add(component.purl);
    }
  }
  if (applications.length !== 1 || applications[0].name !== report.Results[0].Target ||
      purls.size !== reportPackages.size || [...reportPackages.keys()].some((purl) => !purls.has(purl))) fail("scanner_owned_sbom_inventory_mismatch");
  const dependencyRefs = new Set();
  for (const dependency of sbom.dependencies) {
    if (!exactKeys(dependency, ["ref", "dependsOn"]) || !refs.has(dependency.ref) || dependencyRefs.has(dependency.ref) ||
        !Array.isArray(dependency.dependsOn) || new Set(dependency.dependsOn).size !== dependency.dependsOn.length ||
        dependency.dependsOn.some((ref) => !refs.has(ref))) fail("scanner_owned_sbom_graph_invalid");
    dependencyRefs.add(dependency.ref);
  }
  if (!dependencyRefs.has(sbom.metadata.component["bom-ref"]) || !dependencyRefs.has(applications[0]["bom-ref"])) fail("scanner_owned_sbom_graph_invalid");
}

export function validateSelfAuditSet({ reports, sboms, pair, databaseJoin }) {
  if (!PAIR_PROOFS.has(pair) || pair.state !== "IDENTITY_REPRODUCIBLE" || pair.stdlib?.path !== "stdlib" || pair.stdlib.version !== "v1.27.3" ||
      !Array.isArray(pair.compiledInventory) || !record(reports) || !record(sboms) ||
      !record(databaseJoin) || !sha(databaseJoin.vulnerabilityDbSha256) || !sha(databaseJoin.javaDbSha256)) fail("scanner_owned_self_set_invalid");
  const expectedPackages = new Map([[`pkg:golang/${OWNED_SCANNER.mainPath}`, `${OWNED_SCANNER.mainPath}\0`],
    [`pkg:golang/${pair.stdlib.path}@${pair.stdlib.version}`, `${pair.stdlib.path}\0${pair.stdlib.version}`],
    ...pair.compiledInventory.map((item) => [`pkg:golang/${item.path}@${item.version}`, `${item.path}\0${item.version}`])]);
  const names = ["aOnA", "aOnB", "bOnA", "bOnB"];
  const inventories = [];
  const findings = [];
  for (const name of names) {
    if (!Object.hasOwn(reports, name) || !Object.hasOwn(sboms, name)) fail("scanner_owned_self_set_invalid");
    const inventory = reportInventory(reports[name]);
    if (inventory.packages.size !== expectedPackages.size || [...expectedPackages].some(([purl, identity]) => inventory.packages.get(purl) !== identity)) {
      fail("scanner_owned_self_inventory_invalid");
    }
    validateSbom(sboms[name], inventory.packages, reports[name]);
    inventories.push(canonical([...inventory.packages].sort()));
    findings.push(canonical(inventory.findings));
  }
  if (new Set(inventories).size !== 1 || new Set(findings).size !== 1) fail("scanner_owned_cross_self_inventory_mismatch");
  return branded(SELF_PROOFS, { state: "SELF_AUDITED", run: clone(pair.run), binary: clone(pair.binary), databaseJoin: clone(databaseJoin), packageInventory: inventories[0] });
}

function normalizedDetection(report) {
  if (!record(report) || report.Trivy?.Version !== OWNED_SCANNER.applicationVersion || report.SchemaVersion !== 2 || !Array.isArray(report.Results)) {
    fail("scanner_owned_control_report_invalid");
  }
  const packages = new Set();
  const findings = new Set();
  for (const result of report.Results) {
    if (!Array.isArray(result.Packages)) fail("scanner_owned_control_report_invalid");
    for (const item of result.Packages) {
      if (!nonEmpty(item?.Name) || item.Version !== undefined && !nonEmpty(item.Version) || !nonEmpty(item.Identifier?.PURL)) fail("scanner_owned_control_report_invalid");
      packages.add(canonical([result.Target, result.Type, item.Name, item.Version ?? "", item.Identifier.PURL]));
    }
    for (const item of result.Vulnerabilities ?? []) {
      if (!nonEmpty(item?.VulnerabilityID) || !nonEmpty(item.PkgName) || !nonEmpty(item.InstalledVersion)) fail("scanner_owned_control_report_invalid");
      if (!["LOW", "MEDIUM", "HIGH", "CRITICAL", "UNKNOWN"].includes(item.Severity)) fail("scanner_owned_control_report_invalid");
      findings.add(canonical([result.Target, item.VulnerabilityID, item.PkgName, item.InstalledVersion, item.FixedVersion ?? "", item.Severity, item.PkgIdentifier?.PURL ?? ""]));
    }
  }
  return { packages: [...packages].sort(), findings: [...findings].sort() };
}

export function validateSameDatabaseComparison({ owned, official, databaseJoin, controlName }) {
  if (!record(databaseJoin) || !sha(databaseJoin.vulnerabilityDbSha256) || !sha(databaseJoin.javaDbSha256) || !nonEmpty(controlName, 128)) {
    fail("scanner_owned_database_join_invalid");
  }
  const candidate = normalizedDetection(owned);
  const reference = normalizedDetection(official);
  if (canonical(candidate.packages) !== canonical(reference.packages) || canonical(candidate.findings) !== canonical(reference.findings)) {
    fail("scanner_owned_detection_conservation_failed");
  }
  return branded(COMPARISON_PROOFS, { controlName, databaseJoin: clone(databaseJoin), packages: candidate.packages, findings: candidate.findings });
}

export function validateOfficialNegativeControl(report) {
  const inventory = normalizedDetection(report);
  const matches = [];
  for (const result of report.Results) for (const item of result.Vulnerabilities ?? []) {
    if (item.VulnerabilityID === "CVE-2026-116587" && item.PkgName === OWNED_SCANNER.goJosePath && item.InstalledVersion === "v4.1.5" &&
        item.FixedVersion === "4.1.6" && item.Severity === "HIGH") matches.push(item);
  }
  if (matches.length !== 1) fail("scanner_owned_official_negative_control_invalid");
  return branded(NEGATIVE_PROOFS, { state: "OFFICIAL_REFERENCE_REJECTED", finding: canonical(matches[0]), inventory });
}

function validateLegacyInventory(inventory) {
  if (!exactKeys(inventory, ["packages", "findings"]) || !Array.isArray(inventory.packages) || !Array.isArray(inventory.findings)) {
    fail("scanner_owned_legacy_baseline_invalid");
  }
  for (const [entries, length] of [[inventory.packages, 4], [inventory.findings, 5]]) for (const entry of entries) {
    let value;
    try { value = JSON.parse(entry); } catch { fail("scanner_owned_legacy_baseline_invalid"); }
    if (!Array.isArray(value) || value.length !== length || value.some((item) => typeof item !== "string") || entry !== JSON.stringify(value)) {
      fail("scanner_owned_legacy_baseline_invalid");
    }
  }
}

export function validateLegacyBaselineConservation({ controlName, observed, baseline }) {
  if (!LEGACY_BASELINE_NAMES.includes(controlName)) fail("scanner_owned_legacy_baseline_invalid");
  validateLegacyInventory(observed);
  validateLegacyInventory(baseline);
  const packages = new Set(observed.packages), findings = new Set(observed.findings);
  if (baseline.packages.some((entry) => !packages.has(entry)) || baseline.findings.some((entry) => !findings.has(entry))) {
    fail("scanner_owned_legacy_baseline_loss");
  }
  return branded(LEGACY_PROOFS, { controlName, packageCount: packages.size, findingCount: findings.size });
}

function sameBinding(proof, run, binary, databaseJoin) {
  return record(proof) && canonical(proof.run) === canonical(run) && canonical(proof.binary) === canonical(binary) &&
    canonical(proof.databaseJoin) === canonical(databaseJoin);
}

export function validateOwnedControlSet({ run, binary, databaseJoin, comparisons, officialNegative, legacyBaselines }) {
  validateRun(run);
  if (!record(binary) || !record(databaseJoin) || !Array.isArray(comparisons) || !Array.isArray(legacyBaselines) ||
      comparisons.length !== CONTROL_NAMES.length || legacyBaselines.length !== LEGACY_BASELINE_NAMES.length || !NEGATIVE_PROOFS.has(officialNegative)) {
    fail("scanner_owned_control_set_invalid");
  }
  const byName = new Map();
  for (const proof of comparisons) {
    if (!COMPARISON_PROOFS.has(proof) || canonical(proof.databaseJoin) !== canonical(databaseJoin) || byName.has(proof.controlName)) {
      fail("scanner_owned_control_set_invalid");
    }
    byName.set(proof.controlName, proof);
  }
  const legacyNames = legacyBaselines.map((proof) => {
    if (!LEGACY_PROOFS.has(proof)) fail("scanner_owned_control_set_invalid");
    return proof.controlName;
  }).sort();
  if (canonical([...byName.keys()].sort()) !== canonical([...CONTROL_NAMES].sort()) ||
      canonical(legacyNames) !== canonical([...LEGACY_BASELINE_NAMES].sort())) fail("scanner_owned_control_set_invalid");
  return branded(CONTROL_SET_PROOFS, { state: "CONTROLS_PASSED", run: clone(run), binary: clone(binary), databaseJoin: clone(databaseJoin),
    controlNames: Object.freeze([...CONTROL_NAMES]), legacyBaselineNames: Object.freeze([...LEGACY_BASELINE_NAMES]) });
}

export function validateOwnedBuilderAudit({ run, binary, databaseJoin, subject, report, sbom, inventory, now }) {
  validateRun(run);
  const expectedSubject = `${subject?.repository}@${OWNED_SCANNER.builderPlatformDigest}`;
  if (!exactKeys(subject, ["role", "repository", "version", "manifestDigest", "platform"]) || subject.role !== "go-builder" ||
      subject.repository !== "library/golang" || subject.version !== "1.27.3-alpine3.24" || subject.manifestDigest !== OWNED_SCANNER.builderIndexDigest ||
      !exactKeys(subject.platform, ["os", "architecture", "variant", "digest"]) || subject.platform.os !== "linux" ||
      subject.platform.architecture !== "amd64" || subject.platform.variant !== null || subject.platform.digest !== OWNED_SCANNER.builderPlatformDigest ||
      report?.SchemaVersion !== 2 || report.Trivy?.Version !== OWNED_SCANNER.applicationVersion || report.ArtifactType !== "container_image" ||
      report.ArtifactName !== expectedSubject || report.Metadata?.ImageConfig?.os !== "linux" || report.Metadata.ImageConfig.architecture !== "amd64" ||
      sbom?.bomFormat !== "CycloneDX" || sbom.metadata?.component?.type !== "container" || sbom.metadata.component.name !== expectedSubject ||
      !Array.isArray(sbom.components) || !exactKeys(inventory, ["packageCount", "applicationCount", "operatingSystemCount"]) ||
      ![inventory.packageCount, inventory.applicationCount, inventory.operatingSystemCount].every((value) => safeInt(value, 0))) {
    fail("scanner_owned_builder_audit_invalid");
  }
  const detected = normalizedDetection(report);
  const evaluation = evaluateImageReport(report, subject, [], now);
  if (evaluation.blockers.length) fail("scanner_owned_builder_audit_blocked");
  const reportPurls = new Set();
  const reportPackageIdentities = new Set();
  for (const result of report.Results) for (const item of result.Packages) reportPurls.add(item.Identifier.PURL);
  for (const result of report.Results) for (const item of result.Packages) {
    const version = `${item.Epoch ? `${item.Epoch}:` : ""}${item.Version ?? ""}${item.Release ? `-${item.Release}` : ""}`;
    reportPackageIdentities.add(canonical([item.Name, version, result.Type]));
  }
  const sbomPurls = new Set(sbom.components.filter((item) => item?.type === "library").map((item) => item.purl));
  const applicationCount = sbom.components.filter((item) => item?.type === "application").length;
  const operatingSystemCount = sbom.components.filter((item) => item?.type === "operating-system").length;
  if (sbomPurls.has(undefined) || reportPurls.size !== sbomPurls.size || [...reportPurls].some((purl) => !sbomPurls.has(purl)) ||
      inventory.packageCount !== reportPackageIdentities.size || inventory.applicationCount !== applicationCount || inventory.operatingSystemCount !== operatingSystemCount) {
    fail("scanner_owned_builder_inventory_invalid");
  }
  return branded(BUILDER_PROOFS, { state: "BUILDER_AUDITED", run: clone(run), binary: clone(binary), databaseJoin: clone(databaseJoin),
    subject: clone(subject), packageInventory: detected.packages, findingInventory: detected.findings, inventory: clone(inventory) });
}

export function validateOwnedQualificationProof({ pair, self, controls, builder, cleanup }) {
  if (!PAIR_PROOFS.has(pair) || !SELF_PROOFS.has(self) || !CONTROL_SET_PROOFS.has(controls) || !BUILDER_PROOFS.has(builder) ||
      !exactKeys(cleanup, ["constructionResourcesAbsent", "duplicateBAbsent", "candidateARetained"]) ||
      cleanup.constructionResourcesAbsent !== true || cleanup.duplicateBAbsent !== true || cleanup.candidateARetained !== true ||
      !sameBinding(self, pair.run, pair.binary, self.databaseJoin) || !sameBinding(controls, pair.run, pair.binary, self.databaseJoin) ||
      !sameBinding(builder, pair.run, pair.binary, self.databaseJoin)) fail("scanner_owned_qualification_proof_invalid");
  const proof = branded(QUALIFICATION_PROOFS, { state: "QUALIFIED_FOR_THIS_JOB", run: clone(pair.run), source: clone(pair.source), binary: clone(pair.binary),
    databaseJoin: clone(self.databaseJoin), cleanup: clone(cleanup) });
  QUALIFICATION_INPUTS.set(proof, { pair, self, controls, builder });
  return proof;
}

function safeEvidencePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && value === value.normalize("NFC") &&
    !value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:/u.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== ".." && !/[\0\r\n]/u.test(part));
}

async function enumerateEvidenceFiles(root, current = root, entries = []) {
  const children = await readdir(current, { withFileTypes: true });
  for (const child of children) {
    const absolute = path.join(current, child.name);
    if (child.isSymbolicLink() || !(child.isDirectory() || child.isFile())) fail("scanner_owned_public_evidence_invalid");
    if (child.isDirectory()) await enumerateEvidenceFiles(root, absolute, entries);
    else entries.push(path.relative(root, absolute).split(path.sep).join("/"));
    if (entries.length > 128) fail("scanner_owned_public_evidence_invalid");
  }
  return entries;
}

export async function validateOwnedPublicEvidenceDirectory(directory, manifest, expectedRun) {
  if (!nonEmpty(directory, 32_768) || !exactKeys(manifest, ["schemaVersion", "kind", "run", "files"]) ||
      manifest.schemaVersion !== 1 || manifest.kind !== "OWNED_SCANNER_PUBLIC_EVIDENCE_V1" ||
      !Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 128) {
    fail("scanner_owned_public_evidence_invalid");
  }
  validateRun(manifest.run);
  validateRun(expectedRun);
  if (canonical(manifest.run) !== canonical(expectedRun)) fail("scanner_owned_public_evidence_join_invalid");
  const preflightPaths = new Set();
  for (const descriptor of manifest.files) {
    const folded = typeof descriptor?.path === "string" ? descriptor.path.toLocaleLowerCase("en-US") : "";
    if (!exactKeys(descriptor, ["path", "bytes", "sha256", "mediaType"]) || !safeEvidencePath(descriptor.path) ||
        preflightPaths.has(folded) || !safeInt(descriptor.bytes, 1) || descriptor.bytes > 4 * 1024 ** 2 || !sha(descriptor.sha256) ||
        !["application/json", "text/plain"].includes(descriptor.mediaType)) fail("scanner_owned_public_evidence_invalid");
    preflightPaths.add(folded);
  }
  let root;
  try {
    const supplied = path.resolve(directory);
    const rootInfo = await lstat(supplied, { bigint: true });
    root = await realpath(supplied);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail("scanner_owned_public_evidence_invalid");
  } catch { fail("scanner_owned_public_evidence_invalid"); }
  const actualPaths = await enumerateEvidenceFiles(root);
  const hasManifestFile = actualPaths.includes("public-manifest.json");
  if (manifest.files.length + (hasManifestFile ? 1 : 0) > 128) fail("scanner_owned_public_evidence_invalid");
  const manifestPath = path.join(root, "public-manifest.json");
  let manifestBytes = Buffer.alloc(0);
  let manifestBefore = null;
  if (hasManifestFile) {
    try {
      manifestBefore = await lstat(manifestPath, { bigint: true });
      if (!manifestBefore.isFile() || manifestBefore.isSymbolicLink() || manifestBefore.nlink !== 1n || manifestBefore.size < 1n ||
          manifestBefore.size > 4n * 1024n ** 2n) fail("scanner_owned_public_evidence_invalid");
      manifestBytes = await open(manifestPath, "r").then(async (handle) => { try { return await handle.readFile(); } finally { await handle.close(); } });
    } catch { fail("scanner_owned_public_evidence_invalid"); }
    let manifestText;
    try { manifestText = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes); } catch { fail("scanner_owned_public_evidence_invalid"); }
    if (manifestText !== `${canonical(manifest)}\n`) fail("scanner_owned_public_evidence_noncanonical");
    const manifestAfter = await lstat(manifestPath, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"]) {
      if (manifestBefore[key] !== manifestAfter[key]) fail("scanner_owned_public_evidence_changed");
    }
  }
  const declaredPaths = new Set(manifest.files.map((item) => item?.path));
  if (actualPaths.length !== manifest.files.length + (hasManifestFile ? 1 : 0) ||
      actualPaths.some((item) => item !== "public-manifest.json" && !declaredPaths.has(item))) fail("scanner_owned_public_evidence_undeclared_file");
  const foldedPaths = new Set();
  let totalBytes = manifestBytes.length;
  const files = [];
  for (const descriptor of manifest.files) {
    const folded = typeof descriptor?.path === "string" ? descriptor.path.toLocaleLowerCase("en-US") : "";
    if (!exactKeys(descriptor, ["path", "bytes", "sha256", "mediaType"]) || !safeEvidencePath(descriptor.path) ||
        foldedPaths.has(folded) || !safeInt(descriptor.bytes, 1) || descriptor.bytes > 4 * 1024 ** 2 || !sha(descriptor.sha256) ||
        !["application/json", "text/plain"].includes(descriptor.mediaType)) fail("scanner_owned_public_evidence_invalid");
    foldedPaths.add(folded);
    totalBytes += descriptor.bytes;
    if (totalBytes > 64 * 1024 ** 2) fail("scanner_owned_public_evidence_invalid");
    const target = path.resolve(root, ...descriptor.path.split("/"));
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) fail("scanner_owned_public_evidence_invalid");
    let resolvedTarget;
    try { resolvedTarget = await realpath(target); } catch { fail("scanner_owned_public_evidence_invalid"); }
    if (resolvedTarget !== target || !resolvedTarget.startsWith(`${root}${path.sep}`)) fail("scanner_owned_public_evidence_invalid");
    let before;
    try { before = await lstat(target, { bigint: true }); } catch { fail("scanner_owned_public_evidence_invalid"); }
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(descriptor.bytes)) fail("scanner_owned_public_evidence_invalid");
    const handle = await open(target, "r");
    let bytes;
    try { bytes = await handle.readFile(); } finally { await handle.close(); }
    let decoded;
    try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("scanner_owned_public_evidence_invalid"); }
    if (decoded.includes("\0") || createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) fail("scanner_owned_public_evidence_invalid");
    if (descriptor.mediaType === "application/json") {
      let value;
      try { value = JSON.parse(decoded); } catch { fail("scanner_owned_public_evidence_invalid"); }
      if (decoded !== `${canonical(value)}\n`) fail("scanner_owned_public_evidence_noncanonical");
    }
    let after;
    try { after = await lstat(target, { bigint: true }); } catch { fail("scanner_owned_public_evidence_invalid"); }
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"]) {
      if (before[key] !== after[key]) fail("scanner_owned_public_evidence_changed");
    }
    files.push(Object.freeze({ ...descriptor, absolutePath: target }));
  }
  const finalPaths = await enumerateEvidenceFiles(root);
  if (canonical(finalPaths.sort()) !== canonical(actualPaths.sort())) fail("scanner_owned_public_evidence_changed");
  return Object.freeze({ kind: manifest.kind, run: clone(manifest.run), totalBytes, files: Object.freeze(files) });
}

export class OwnedQualificationLifecycle {
  #state = "BUILD_DIAGNOSTIC";
  #binding;
  #firstFailure = null;
  #cleanupCertain = null;
  #cleanupStatus = null;
  #proofs = new Map();

  constructor(binding) {
    if (!exactKeys(binding, ["run", "source", "binary", "databaseJoin"])) fail("scanner_owned_lifecycle_binding_invalid");
    validateRun(binding.run);
    validateSource(binding.source);
    if (!exactKeys(binding.binary, ["path", "bytes", "sha256"]) || binding.binary.path !== "/out/trivy" || !safeInt(binding.binary.bytes, 1) || !sha(binding.binary.sha256)) fail("scanner_owned_lifecycle_binding_invalid");
    if (!record(binding.databaseJoin) || !sha(binding.databaseJoin.vulnerabilityDbSha256) || !sha(binding.databaseJoin.javaDbSha256)) fail("scanner_owned_lifecycle_binding_invalid");
    this.#binding = clone(binding);
  }

  get state() { return this.#state; }

  advance(expectedCurrent, next, evidence) {
    if (this.#firstFailure || this.#state !== expectedCurrent || STATES.indexOf(next) !== STATES.indexOf(expectedCurrent) + 1 ||
        !exactKeys(evidence, ["proof"]) || !record(evidence.proof) || evidence.proof.state !== next) {
      fail("scanner_owned_lifecycle_transition_invalid");
    }
    const proof = evidence.proof;
    const proofSets = { IDENTITY_REPRODUCIBLE: PAIR_PROOFS, SELF_AUDITED: SELF_PROOFS, CONTROLS_PASSED: CONTROL_SET_PROOFS,
      BUILDER_AUDITED: BUILDER_PROOFS, QUALIFIED_FOR_THIS_JOB: QUALIFICATION_PROOFS };
    const qualificationInputs = next === "QUALIFIED_FOR_THIS_JOB" ? QUALIFICATION_INPUTS.get(proof) : null;
    if (!proofSets[next]?.has(proof) || canonical(proof.run) !== canonical(this.#binding.run) ||
        canonical(proof.binary) !== canonical(this.#binding.binary) ||
        next !== "IDENTITY_REPRODUCIBLE" && canonical(proof.databaseJoin) !== canonical(this.#binding.databaseJoin) ||
        next === "IDENTITY_REPRODUCIBLE" && canonical(proof.source) !== canonical(this.#binding.source) ||
        next === "QUALIFIED_FOR_THIS_JOB" && (canonical(proof.cleanup) !== canonical(this.#cleanupStatus) ||
          qualificationInputs?.pair !== this.#proofs.get("IDENTITY_REPRODUCIBLE") || qualificationInputs?.self !== this.#proofs.get("SELF_AUDITED") ||
          qualificationInputs?.controls !== this.#proofs.get("CONTROLS_PASSED") || qualificationInputs?.builder !== this.#proofs.get("BUILDER_AUDITED"))) {
      fail("scanner_owned_lifecycle_binding_invalid");
    }
    this.#proofs.set(next, proof);
    this.#state = next;
    return this.snapshot();
  }

  fail(code) {
    if (!nonEmpty(code, 256)) fail("scanner_owned_lifecycle_failure_invalid");
    this.#firstFailure ??= code;
    return this.snapshot();
  }

  recordCleanup(status) {
    if (!exactKeys(status, ["constructionResourcesAbsent", "duplicateBAbsent", "candidateARetained"]) ||
        ![status.constructionResourcesAbsent, status.duplicateBAbsent, status.candidateARetained].every((value) => typeof value === "boolean")) {
      fail("scanner_owned_cleanup_invalid");
    }
    this.#cleanupStatus = clone(status);
    this.#cleanupCertain = status.constructionResourcesAbsent && status.duplicateBAbsent && status.candidateARetained;
    if (!this.#cleanupCertain) this.#firstFailure ??= "scanner_owned_cleanup_uncertain";
    return this.snapshot();
  }

  receipt() {
    if (this.#state !== "QUALIFIED_FOR_THIS_JOB" || this.#firstFailure !== null || this.#cleanupCertain !== true) fail("scanner_owned_qualification_unavailable");
    return Object.freeze({ kind: "OWNED_SCANNER_QUALIFICATION_V1", state: this.#state, ...clone(this.#binding), mainVersionLookup: "UNAVAILABLE", sourceBinding: "SOURCE_BOUND_UNVERSIONED_MAIN" });
  }

  snapshot() { return Object.freeze({ state: this.#state, firstFailure: this.#firstFailure, cleanupCertain: this.#cleanupCertain,
    cleanupStatus: clone(this.#cleanupStatus), binding: clone(this.#binding) }); }
}

export function createSharedBudgetController({
  now = () => performance.now(), totalMs = 320 * 60_000, cleanupReserveMs = 10 * 60_000,
  ownedCapMs = 145 * 60_000, downstreamCapMs = 225 * 60_000,
} = {}) {
  if (typeof now !== "function" || ![totalMs, cleanupReserveMs, ownedCapMs, downstreamCapMs].every((item) => Number.isFinite(item) && item > 0) ||
      cleanupReserveMs >= totalMs || ownedCapMs > totalMs || downstreamCapMs > totalMs) fail("scanner_owned_time_budget_invalid");
  const started = now();
  if (!Number.isFinite(started) || started < 0) fail("scanner_owned_time_budget_invalid");
  let last = started;
  let active = null;
  let cleanup = false;
  let cleanupStarted = null;
  let firstFailure = null;
  const spent = { owned: 0, downstream: 0 };
  const journal = [];
  const clock = () => {
    const current = now();
    if (!Number.isFinite(current) || current < last) fail("scanner_owned_time_budget_refused");
    last = current;
    return current;
  };
  const remainingMs = () => {
    const current = clock();
    if (cleanup) return Math.floor(Math.max(0, Math.min(cleanupReserveMs - (current - cleanupStarted), totalMs - (current - started))));
    const globalRemaining = Math.max(0, totalMs - cleanupReserveMs - (current - started));
    if (!active) return Math.floor(globalRemaining);
    return Math.floor(Math.min(globalRemaining, Math.max(0, active.timeoutMs - (current - active.startedMonotonicMs))));
  };
  const commandTimeoutMs = (existingCapMs) => {
    if (!Number.isFinite(existingCapMs) || existingCapMs <= 0) fail("scanner_owned_time_budget_refused");
    const result = Math.floor(Math.min(existingCapMs, remainingMs()));
    if (result <= 0) fail("scanner_owned_time_budget_refused");
    return result;
  };
  const cleanupCommandTimeoutMs = (existingCapMs) => {
    if (!Number.isFinite(existingCapMs) || existingCapMs <= 0) fail("scanner_owned_time_budget_refused");
    const current = clock();
    const cleanupRemaining = cleanup ? cleanupReserveMs - (current - cleanupStarted) : cleanupReserveMs;
    const result = Math.floor(Math.min(existingCapMs, cleanupRemaining, totalMs - (current - started)));
    if (result <= 0) fail("scanner_owned_time_budget_refused");
    return result;
  };
  const startStage = (name, requestedMs) => {
    const current = clock();
    if (cleanup || active || firstFailure || !nonEmpty(name, 128) || !Number.isFinite(requestedMs) || requestedMs <= 0) fail("scanner_owned_time_budget_refused");
    const lane = name.startsWith("owned:") ? "owned" : name.startsWith("downstream:") ? "downstream" : null;
    if (!lane) fail("scanner_owned_time_budget_refused");
    const laneLimit = lane === "owned" ? ownedCapMs : downstreamCapMs;
    const timeoutMs = Math.floor(Math.min(requestedMs, laneLimit - spent[lane], totalMs - cleanupReserveMs - (current - started)));
    if (timeoutMs <= 0) fail("scanner_owned_time_budget_refused");
    active = { name, lane, startedMonotonicMs: current, timeoutMs };
    journal.push({ stage: name, status: "ATTEMPTED", monotonicMs: current });
    return Object.freeze({ timeoutMs, startedMonotonicMs: current });
  };
  const finishStage = (name, status) => {
    const current = clock();
    if (!active || active.name !== name || !["PASSED", "FAILED"].includes(status)) fail("scanner_owned_time_budget_refused");
    const elapsed = current - active.startedMonotonicMs;
    spent[active.lane] += elapsed;
    const overdue = elapsed > active.timeoutMs;
    if (overdue) firstFailure ??= "scanner_owned_time_budget_refused";
    if (status === "FAILED") firstFailure ??= `scanner_owned_stage_failed:${name}`;
    journal.push({ stage: name, status: overdue ? "FAILED" : status, monotonicMs: current });
    active = null;
    if (overdue) fail("scanner_owned_time_budget_refused");
    return snapshot();
  };
  const beginCleanup = () => {
    const current = clock();
    if (active || cleanup || totalMs - (current - started) <= 0) fail("scanner_owned_time_budget_refused");
    cleanup = true;
    cleanupStarted = current;
    journal.push({ stage: "cleanup", status: "ATTEMPTED", monotonicMs: current });
    return Object.freeze({ timeoutMs: Math.max(1, Math.floor(Math.min(cleanupReserveMs, totalMs - (current - started)))), startedMonotonicMs: current });
  };
  function snapshot() {
    return Object.freeze({ startedMonotonicMs: started, remainingMs: Math.max(0, totalMs - (last - started)), cleanupReserveMs,
      spent: clone(spent), active: active ? clone(active) : null, cleanup, firstFailure, journal: clone(journal) });
  }
  return Object.freeze({ startStage, finishStage, beginCleanup, remainingMs, commandTimeoutMs, cleanupCommandTimeoutMs, snapshot });
}
