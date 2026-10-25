import { evaluateImageResults, MAX_DATABASE_AGE_MS, SCANNER_VERSION, validateDatabaseMetadata } from "../scanner/audit-policy.mjs";
import { isDeepStrictEqual } from "node:util";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const MAX_TEXT = 16_384;
const MAX_COMPONENTS = 100_000;
const GOSU_MODULE = "github.com/tianon/gosu";
const GOSU_PURL = `pkg:golang/${GOSU_MODULE}`;
const GO_PACKAGES = [["stdlib", "v1.26.8"], ["github.com/moby/sys/user", "v0.1.0"], ["golang.org/x/sys", "v0.1.0"]];
const GO_DEPENDENCIES = GO_PACKAGES.map(([name, version]) => `${name}@${version}`).sort();
const AUDIT_ERRORS = new WeakSet();

function invalid(check = "shape") {
  const error = new Error("postgres_gosu_audit_invalid");
  AUDIT_ERRORS.add(error);
  error.diagnostic = { check };
  throw error;
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, required, optional = []) {
  if (!object(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function text(value) {
  return typeof value === "string" && value.length <= MAX_TEXT && value.trim().length > 0 && !value.includes("\0");
}

function timestamp(value) {
  const match = typeof value === "string" ? TIMESTAMP.exec(value) : null;
  if (!match) return NaN;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 ||
      Number(match[10] ?? 0) > 23 || Number(match[11] ?? 0) > 59) return NaN;
  return Date.parse(value);
}

function packageVersion(pkg) {
  if (!object(pkg) || !text(pkg.Name) || !text(pkg.Version) ||
      (pkg.Release !== undefined && (typeof pkg.Release !== "string" || pkg.Release.length > MAX_TEXT)) ||
      (pkg.Epoch !== undefined && (!Number.isSafeInteger(pkg.Epoch) || pkg.Epoch < 0))) invalid("package_shape");
  return `${pkg.Epoch ? `${pkg.Epoch}:` : ""}${pkg.Version}${pkg.Release ? `-${pkg.Release}` : ""}`;
}

function exactDependencies(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    isDeepStrictEqual([...actual].sort(), expected);
}

function unversionedGosuRoot(pkg, diffId) {
  return object(pkg) && pkg.Name === GOSU_MODULE && pkg.ID === GOSU_MODULE && pkg.Relationship === "root" &&
    ["Version", "Epoch", "Release"].every((key) => !Object.hasOwn(pkg, key)) &&
    pkg.Identifier?.PURL === GOSU_PURL && pkg.AnalyzedBy === "gobinary" && pkg.Layer?.DiffID === diffId &&
    exactDependencies(pkg.DependsOn, GO_DEPENDENCIES);
}

function property(component, name) {
  if (!Array.isArray(component?.properties) || component.properties.length > 256) invalid("component_properties");
  const matches = component.properties.filter((entry) => entry?.name === name);
  if (matches.length !== 1 || !text(matches[0].value)) invalid("component_properties");
  return matches[0].value;
}

function subject(expected) {
  if (!exactObject(expected, ["artifactName", "imageId", "archiveSha256", "tag", "configDigest", "diffIds"]) ||
      !text(expected.artifactName) || !DIGEST.test(expected.imageId ?? "") || !HEX.test(expected.archiveSha256 ?? "") ||
      !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_.-]+$/u.test(expected.tag ?? "") ||
      !DIGEST.test(expected.configDigest ?? "") || expected.imageId !== expected.configDigest ||
      !Array.isArray(expected.diffIds) || expected.diffIds.length === 0 || expected.diffIds.length > 256 ||
      new Set(expected.diffIds).size !== expected.diffIds.length || expected.diffIds.some((entry) => !DIGEST.test(entry))) invalid("subject");
  return Object.freeze({ kind: "LOCAL_DOCKER_SAVE_ARCHIVE", ...expected, diffIds: Object.freeze([...expected.diffIds]),
    os: "linux", architecture: "amd64" });
}

function forbiddenOldGosu(value) {
  const normalized = typeof value === "string" && value.startsWith("/") ? value.slice(1) : value;
  return normalized === "usr/local/bin/gosu" || normalized?.startsWith("usr/local/bin/gosu (");
}

function localize(entry, auditSubject) {
  const finding = { ...entry };
  delete finding.imageDigest;
  return { ...finding, subject: auditSubject };
}

function inventoryData(value, depth = 0, budget = { left: 100_000 }) {
  if (--budget.left < 0 || depth > 32) invalid("inventory_data");
  if (value === null || ["string", "boolean", "number"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) invalid("inventory_data");
    return;
  }
  const array = Array.isArray(value);
  if (!array && !object(value) || array && Object.getPrototypeOf(value) !== Array.prototype) invalid("inventory_data");
  const keys = Reflect.ownKeys(value);
  if (array && (value.length > MAX_COMPONENTS || keys.length !== value.length + 1)) invalid("inventory_data");
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") ||
      array && !/^(?:0|[1-9][0-9]*)$/u.test(key)) invalid("inventory_data");
    inventoryData(descriptor.value, depth + 1, budget);
  }
}

const inventoryFreeze = (value) => Array.isArray(value) ? Object.freeze(value.map(inventoryFreeze)) : object(value)
  ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inventoryFreeze(child)]))) : value;
const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;
function optionalProperty(component, name) {
  const entries = component.properties.filter((entry) => entry.name === name);
  if (entries.length > 1 || entries.length === 1 && !text(entries[0].value)) invalid("component_properties");
  return entries.length ? entries[0].value : null;
}
function declared(value, key) {
  const present = Object.hasOwn(value, key);
  if (present && !text(value[key])) invalid("inventory_declaration");
  return { present, value: present ? value[key] : null };
}
function licenseDeclarations(pkg, component) {
  const jsonPresent = Object.hasOwn(pkg, "Licenses");
  const cdxPresent = Object.hasOwn(component, "licenses");
  const json = jsonPresent ? pkg.Licenses : null;
  const cdx = cdxPresent ? component.licenses : null;
  if (jsonPresent && (!Array.isArray(json) || json.length > 64 || json.some((v) => !text(v)) || new Set(json).size !== json.length) ||
    cdxPresent && (!Array.isArray(cdx) || cdx.length > 64 || cdx.some((v) => !exactObject(v, ["license"]) ||
      !object(v.license) || Object.keys(v.license).length !== 1 || !["id", "name"].includes(Object.keys(v.license)[0]) ||
      !text(Object.values(v.license)[0])))) invalid("inventory_licenses");
  const cdxText = cdx?.map((v) => Object.values(v.license)[0]) ?? [];
  if (new Set(cdxText).size !== cdxText.length || jsonPresent && cdxPresent &&
    !isDeepStrictEqual([...json].sort(order), [...cdxText].sort(order))) invalid("inventory_license_parity");
  return { json: { present: jsonPresent, values: json }, cyclonedx: { present: cdxPresent, values: cdx },
    textParity: jsonPresent !== cdxPresent ? "SINGLE_REPORT_DECLARATION" : (json?.length ?? 0) > 0 ? "RAW_DECLARED_TEXT_MATCH" : "NO_DECLARATION" };
}

// This proves structural agreement only. Native callers must authenticate complete report bytes first.
export function validatePostgresGosuReportInventory(input) {
  try {
    inventoryData(input);
    if (!exactObject(input, ["vulnerabilityReport", "cyclonedxReport", "expected"]) ||
      !exactObject(input.expected, ["subject", "packageCount"]) || input.expected.packageCount !== 50) invalid("inventory_expected");
    const expected = input.expected.subject;
    if (!exactObject(expected, ["artifactName", "imageId", "configDigest", "diffIds", "tag", "os", "architecture", "osFamily", "osVersion"]) ||
      !text(expected.artifactName) || typeof expected.imageId !== "string" || !DIGEST.test(expected.imageId) ||
      expected.configDigest !== expected.imageId || typeof expected.tag !== "string" ||
      !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_.-]+$/u.test(expected.tag) || expected.os !== "linux" || expected.architecture !== "amd64" ||
      expected.osFamily !== "alpine" || expected.osVersion !== "3.24.2" || !Array.isArray(expected.diffIds) || expected.diffIds.length !== 12 ||
      expected.diffIds.some((v) => typeof v !== "string" || !DIGEST.test(v)) || new Set(expected.diffIds).size !== 12) invalid("inventory_expected");
    const report = input.vulnerabilityReport; const sbom = input.cyclonedxReport;
    const config = report?.Metadata?.ImageConfig; const os = report?.Metadata?.OS;
    if (!object(report) || report.SchemaVersion !== 2 || report.Trivy?.Version !== SCANNER_VERSION || !Number.isFinite(timestamp(report.CreatedAt)) ||
      report.ArtifactType !== "container_image" || report.ArtifactName !== expected.artifactName || report.Metadata?.ImageID !== expected.imageId ||
      config?.os !== expected.os || config?.architecture !== expected.architecture || ![undefined, null].includes(config?.variant) ||
      config?.rootfs?.type !== "layers" || !isDeepStrictEqual(config.rootfs.diff_ids, expected.diffIds) ||
      !isDeepStrictEqual(report.Metadata?.DiffIDs, expected.diffIds) || !isDeepStrictEqual(report.Metadata?.RepoTags, [expected.tag]) ||
      !exactObject(os, ["Family", "Name"], ["EOSL"]) || os.Family !== expected.osFamily || os.Name !== expected.osVersion ||
      os.EOSL !== undefined && typeof os.EOSL !== "boolean" || !Array.isArray(report.Results) || report.Results.length !== 2) invalid("inventory_report");
    const { jsonPackages } = jsonInventory(report, expected, os);
    const { libraries } = cyclonedxInventory(sbom, expected, os, jsonPackages);
    if (jsonPackages.size !== 50 || libraries.length !== 50 || sbom.components.length !== 52) invalid("inventory_count");
    const packages = [];
    for (const result of report.Results) for (const pkg of result.Packages) {
      const version = unversionedGosuRoot(pkg, expected.diffIds.at(-1)) ? null : packageVersion(pkg);
      const component = libraries.find((v) => v.name === pkg.Name && (v.version ?? null) === version &&
        property(v, "aquasecurity:trivy:PkgType") === result.Type);
      const purl = component.purl;
      const packageId = property(component, "aquasecurity:trivy:PkgID");
      const layerDiffId = property(component, "aquasecurity:trivy:LayerDiffID");
      if (!text(purl) || !purl.startsWith(result.Type === "alpine" ? "pkg:apk/alpine/" : "pkg:golang/") ||
        !text(component["bom-ref"]) || !expected.diffIds.includes(layerDiffId) || result.Type === "gobinary" && layerDiffId !== expected.diffIds.at(-1) ||
        Object.hasOwn(pkg, "ID") && pkg.ID !== packageId || Object.hasOwn(pkg, "Identifier") && pkg.Identifier.PURL !== purl ||
        Object.hasOwn(pkg, "Layer") && pkg.Layer.DiffID !== layerDiffId) invalid("inventory_package_binding");
      const originName = declared(pkg, "SrcName"); const originVersion = declared(pkg, "SrcVersion");
      if (originName.present !== originVersion.present) invalid("inventory_origin");
      for (const [key, declaration] of [["SrcName", originName], ["SrcVersion", originVersion]]) {
        const value = optionalProperty(component, `aquasecurity:trivy:${key}`);
        if (value !== null && (!declaration.present || value !== declaration.value)) invalid("inventory_origin_parity");
      }
      packages.push({ packageType: result.Type, name: pkg.Name, version, versionPresent: Object.hasOwn(pkg, "Version"),
        purl, bomRef: component["bom-ref"], packageId, layerDiffId,
        origin: { namePresent: originName.present, name: originName.value, versionPresent: originVersion.present, version: originVersion.value },
        declarations: licenseDeclarations(pkg, component), sourceBinding: "NOT_ESTABLISHED", noticeBinding: "NOT_ESTABLISHED" });
    }
    packages.sort((a, b) => order(JSON.stringify([a.packageType, a.name, a.version, a.purl]), JSON.stringify([b.packageType, b.name, b.version, b.purl])));
    const apk = packages.filter((v) => v.packageType === "alpine"); const go = packages.filter((v) => v.packageType === "gobinary");
    const virtual = apk.filter((v) => !v.origin.namePresent);
    if (apk.length !== 46 || go.length !== 4 || virtual.length !== 1 || virtual[0].name !== ".postgresql-rundeps" ||
      virtual[0].version !== "20260917.213131") invalid("inventory_origins");
    const groups = new Map();
    for (const pkg of apk.filter((v) => v.origin.namePresent)) {
      const key = JSON.stringify([pkg.origin.name, pkg.origin.version]);
      if (!groups.has(key)) groups.set(key, { name: pkg.origin.name, version: pkg.origin.version, packages: [], sourceState: "NOT_COLLECTED", noticesState: "NOT_COLLECTED" });
      groups.get(key).packages.push([pkg.name, pkg.version, pkg.packageType]);
    }
    if (groups.size !== 35 || new Set(packages.map((v) => v.purl)).size !== 50 || new Set(packages.map((v) => v.bomRef)).size !== 50) invalid("inventory_origins");
    const apkOrigins = [...groups].sort(([a], [b]) => order(a, b)).map(([, v]) => v);
    const value = { kind: "POSTGRES_GOSU_REPORT_INVENTORY_V1", state: "PARITY_VERIFIED", subject: expected,
      counts: { jsonResultCount: 2, packageCount: 50, apkPackageCount: 46, goPackageCount: 4, sbomComponentCount: 52,
        libraryComponentCount: 50, applicationComponentCount: 1, osComponentCount: 1, namedApkOriginCount: 35, virtualApkCount: 1 },
      packages, apkOrigins, virtualApk: { name: virtual[0].name, version: virtual[0].version, state: "UNRESOLVED_SYNTHETIC" },
      goDependencies: { ref: GOSU_PURL, dependsOn: GO_DEPENDENCIES.map((v) => `pkg:golang/${v}`) },
      nonPackageComponents: [{ name: "usr/bin/gosu", type: "application" }, { name: os.Family, version: os.Name, type: "operating-system" }] };
    return inventoryFreeze(globalThis.structuredClone(value));
  } catch (error) {
    if (AUDIT_ERRORS.has(error)) throw error;
    invalid("inventory_data");
  }
}

function jsonInventory(report, auditSubject, os) {
  const gosuTargets = report.Results.filter((entry) => entry?.Target === "usr/bin/gosu" && entry?.Class === "lang-pkgs" && entry?.Type === "gobinary");
  const osTargets = report.Results.filter((entry) => entry?.Class === "os-pkgs");
  const isGosuRoot = (pkg) => unversionedGosuRoot(pkg, auditSubject.diffIds.at(-1));
  if (gosuTargets.length !== 1 || osTargets.length !== 1 || osTargets[0].Type !== os.Family ||
      osTargets[0].Target !== `${auditSubject.artifactName} (${os.Family} ${os.Name})` ||
      report.Results.some((entry) => forbiddenOldGosu(entry?.Target)) ||
      !Array.isArray(gosuTargets[0].Packages) || !Array.isArray(osTargets[0].Packages) ||
      gosuTargets[0].Packages.length !== 4 || gosuTargets[0].Packages.filter(isGosuRoot).length !== 1 ||
      GO_PACKAGES.some(([name, version]) => gosuTargets[0].Packages.filter((pkg) =>
        pkg?.Name === name && packageVersion(pkg) === version).length !== 1) ||
      osTargets[0].Packages.filter((pkg) => pkg?.Name === "gosu" && packageVersion(pkg) === "1.19-r5").length !== 1) invalid("inventory_targets");

  const jsonPackages = new Set();
  for (const result of report.Results) {
    if (!Array.isArray(result?.Packages) || result.Packages.length === 0) invalid("package_inventory");
    for (const pkg of result.Packages) {
      if (forbiddenOldGosu(pkg?.Name)) invalid("old_gosu_inventory");
      const version = result === gosuTargets[0] && isGosuRoot(pkg) ? null : packageVersion(pkg);
      const identity = JSON.stringify([pkg.Name, version, result.Type]);
      if (jsonPackages.has(identity)) invalid("duplicate_package");
      jsonPackages.add(identity);
      if (jsonPackages.size > MAX_COMPONENTS) invalid("package_limit");
    }
  }

  return { gosuTargets, isGosuRoot, jsonPackages };
}

function cyclonedxInventory(sbom, auditSubject, os, jsonPackages) {
  const root = sbom?.metadata?.component;
  if (!object(sbom) || sbom.bomFormat !== "CycloneDX" || !/^1\.[4-7]$/u.test(sbom.specVersion ?? "") ||
      !Number.isSafeInteger(sbom.version) || sbom.version < 1 || root?.type !== "container" || root.name !== auditSubject.artifactName ||
      !Array.isArray(sbom.components) || sbom.components.length === 0 || sbom.components.length > MAX_COMPONENTS + 2) invalid("sbom");
  const applications = sbom.components.filter((component) => component?.type === "application");
  if (applications.length !== 1 || applications[0].name !== "usr/bin/gosu" ||
      property(applications[0], "aquasecurity:trivy:Type") !== "gobinary" ||
      property(applications[0], "aquasecurity:trivy:Class") !== "lang-pkgs") invalid("sbom_application");
  const operatingSystems = sbom.components.filter((component) => component?.type === "operating-system");
  if (operatingSystems.length !== 1 || operatingSystems[0].name !== os.Family || operatingSystems[0].version !== os.Name ||
      property(operatingSystems[0], "aquasecurity:trivy:Type") !== os.Family ||
      property(operatingSystems[0], "aquasecurity:trivy:Class") !== "os-pkgs") invalid("sbom_os");
  const libraries = sbom.components.filter((component) => component?.type === "library");
  if (libraries.length + applications.length + operatingSystems.length !== sbom.components.length) invalid("sbom_types");
  const sbomPackages = new Set();
  for (const component of libraries) {
    if (!object(component) || !text(component.name) || forbiddenOldGosu(component.name)) invalid("sbom_package");
    const type = property(component, "aquasecurity:trivy:PkgType");
    let version = component.version;
    if (component.name === GOSU_MODULE) {
      if (type !== "gobinary" || Object.hasOwn(component, "version") || component.purl !== GOSU_PURL ||
          component["bom-ref"] !== GOSU_PURL || property(component, "aquasecurity:trivy:PkgID") !== GOSU_MODULE ||
          property(component, "aquasecurity:trivy:LayerDiffID") !== auditSubject.diffIds.at(-1) ||
          !Array.isArray(sbom.dependencies) || sbom.dependencies.length > MAX_COMPONENTS + 2) invalid("sbom_root");
      const dependencies = sbom.dependencies.filter((entry) => entry?.ref === GOSU_PURL);
      if (dependencies.length !== 1 || !exactDependencies(dependencies[0].dependsOn,
        GO_DEPENDENCIES.map((entry) => `pkg:golang/${entry}`)) || GO_PACKAGES.some(([name, expectedVersion]) =>
        libraries.filter((entry) => entry.name === name && entry.version === expectedVersion &&
          entry["bom-ref"] === `pkg:golang/${name}@${expectedVersion}`).length !== 1)) invalid("sbom_root_dependencies");
      version = null;
    } else if (!text(version)) invalid("sbom_package");
    const identity = JSON.stringify([component.name, version, type]);
    if (sbomPackages.has(identity)) invalid("sbom_duplicate");
    sbomPackages.add(identity);
  }
  if (sbomPackages.size !== jsonPackages.size || [...jsonPackages].some((identity) => !sbomPackages.has(identity))) invalid("sbom_parity");

  return { libraries, sbomPackages };
}

export function evaluateLocalPostgresGosuAudit(input = {}) {
  if (!exactObject(input, ["vulnerabilityReport", "cyclonedxReport", "subject", "archiveEvidence", "databaseEvidence"], ["now"])) invalid("input");
  const { vulnerabilityReport: report, cyclonedxReport: sbom, now = new Date() } = input;
  const auditSubject = subject(input.subject);
  const observedArchive = subject(input.archiveEvidence);
  if (!isDeepStrictEqual(auditSubject, observedArchive)) invalid("archive_binding");
  if (!exactObject(input.databaseEvidence, ["vulnerability", "java"])) invalid("database_evidence");
  let databases;
  try {
    databases = Object.freeze({
      vulnerability: validateDatabaseMetadata(input.databaseEvidence.vulnerability, { database: "vulnerability", now }),
      java: validateDatabaseMetadata(input.databaseEvidence.java, { database: "java", now }),
    });
  } catch { invalid("database_evidence"); }

  const at = now instanceof Date ? now.getTime() : NaN;
  const createdAt = timestamp(report?.CreatedAt);
  if (Object.values(databases).some((database) => createdAt < timestamp(database.downloadedAt))) {
    invalid("report_precedes_database_download");
  }
  const config = report?.Metadata?.ImageConfig;
  const os = report?.Metadata?.OS;
  if (!Number.isFinite(at) || !object(report) || report.SchemaVersion !== 2 || report.Trivy?.Version !== SCANNER_VERSION ||
      !Number.isFinite(createdAt) || createdAt > at || at - createdAt > MAX_DATABASE_AGE_MS || report.ArtifactType !== "container_image" ||
      report.ArtifactName !== auditSubject.artifactName || report.Metadata?.ImageID !== auditSubject.imageId ||
      config?.os !== "linux" || config?.architecture !== "amd64" || ![undefined, null].includes(config?.variant) ||
      config?.rootfs?.type !== "layers" || !isDeepStrictEqual(config.rootfs.diff_ids, auditSubject.diffIds) ||
      !isDeepStrictEqual(report.Metadata?.DiffIDs, auditSubject.diffIds) ||
      !Array.isArray(report.Metadata?.RepoTags) || report.Metadata.RepoTags.length !== 1 || report.Metadata.RepoTags[0] !== auditSubject.tag ||
      !exactObject(os, ["Family", "Name"], ["EOSL"]) || os.Family !== "alpine" || !text(os.Name) ||
      (os.EOSL !== undefined && typeof os.EOSL !== "boolean") || !Array.isArray(report.Results) ||
      report.Results.length === 0 || report.Results.length > 4096) invalid("report");

  const { gosuTargets, isGosuRoot, jsonPackages } = jsonInventory(report, auditSubject, os);

  let evaluated;
  // The authenticated APK binds this main module, whose Go build metadata says (devel).
  // Keep its null-version inventory identity; never invent a version for vulnerability matching.
  // Findings are not filtered, so any finding against this root fails closed in the shared evaluator.
  const versionedResults = report.Results.map((result) => result === gosuTargets[0]
    ? { ...result, Packages: result.Packages.filter((pkg) => !isGosuRoot(pkg)) } : result);
  try { evaluated = evaluateImageResults(versionedResults, { imageDigest: auditSubject.imageId, now }); }
  catch { invalid("findings"); }

  cyclonedxInventory(sbom, auditSubject, os, jsonPackages);

  const findings = evaluated.findings.map((entry) => localize(entry, auditSubject));
  const blockers = evaluated.blockers.map((entry) => localize(entry, auditSubject));
  if (os.EOSL) blockers.push({ code: "image_os_end_of_life", subject: auditSubject });
  return Object.freeze({ state: blockers.length === 0 ? "COMPLETE" : "BLOCKED", diagnosticOnly: true,
    subject: auditSubject, databases, findings, blockers,
    inventory: Object.freeze({ resultCount: report.Results.length, packageCount: jsonPackages.size,
      sbomComponentCount: sbom.components.length }) });
}
