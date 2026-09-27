import { evaluateImageResults, MAX_DATABASE_AGE_MS, SCANNER_VERSION, validateDatabaseMetadata } from "../scanner/audit-policy.mjs";
import { isDeepStrictEqual } from "node:util";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const MAX_TEXT = 16_384;
const MAX_COMPONENTS = 100_000;

function invalid(check = "shape") {
  const error = new Error("postgres_gosu_audit_invalid");
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

  const gosuTargets = report.Results.filter((entry) => entry?.Target === "usr/bin/gosu" && entry?.Class === "lang-pkgs" && entry?.Type === "gobinary");
  const osTargets = report.Results.filter((entry) => entry?.Class === "os-pkgs");
  const expectedGoPackages = [["stdlib", "v1.26.8"], ["github.com/moby/sys/user", "v0.1.0"],
    ["golang.org/x/sys", "v0.1.0"]];
  if (gosuTargets.length !== 1 || osTargets.length !== 1 || osTargets[0].Type !== os.Family ||
      osTargets[0].Target !== `${auditSubject.artifactName} (${os.Family} ${os.Name})` ||
      report.Results.some((entry) => forbiddenOldGosu(entry?.Target)) ||
      !Array.isArray(gosuTargets[0].Packages) || !Array.isArray(osTargets[0].Packages) ||
      expectedGoPackages.some(([name, version]) => gosuTargets[0].Packages.filter((pkg) =>
        pkg?.Name === name && packageVersion(pkg) === version).length !== 1) ||
      osTargets[0].Packages.filter((pkg) => pkg?.Name === "gosu" && packageVersion(pkg) === "1.19-r5").length !== 1) invalid("inventory_targets");

  const jsonPackages = new Set();
  for (const result of report.Results) {
    if (!Array.isArray(result?.Packages) || result.Packages.length === 0) invalid("package_inventory");
    for (const pkg of result.Packages) {
      if (forbiddenOldGosu(pkg?.Name)) invalid("old_gosu_inventory");
      const identity = JSON.stringify([pkg.Name, packageVersion(pkg), result.Type]);
      if (jsonPackages.has(identity)) invalid("duplicate_package");
      jsonPackages.add(identity);
      if (jsonPackages.size > MAX_COMPONENTS) invalid("package_limit");
    }
  }

  let evaluated;
  try { evaluated = evaluateImageResults(report.Results, { imageDigest: auditSubject.imageId, now }); }
  catch { invalid("findings"); }

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
    if (!object(component) || !text(component.name) || !text(component.version) || forbiddenOldGosu(component.name)) invalid("sbom_package");
    const identity = JSON.stringify([component.name, component.version, property(component, "aquasecurity:trivy:PkgType")]);
    if (sbomPackages.has(identity)) invalid("sbom_duplicate");
    sbomPackages.add(identity);
  }
  if (sbomPackages.size !== jsonPackages.size || [...jsonPackages].some((identity) => !sbomPackages.has(identity))) invalid("sbom_parity");

  const findings = evaluated.findings.map((entry) => localize(entry, auditSubject));
  const blockers = evaluated.blockers.map((entry) => localize(entry, auditSubject));
  if (os.EOSL) blockers.push({ code: "image_os_end_of_life", subject: auditSubject });
  return Object.freeze({ state: blockers.length === 0 ? "COMPLETE" : "BLOCKED", diagnosticOnly: true,
    subject: auditSubject, databases, findings, blockers,
    inventory: Object.freeze({ resultCount: report.Results.length, packageCount: evaluated.packageCount,
      sbomComponentCount: sbom.components.length }) });
}
