import { evaluateImageResults, MAX_DATABASE_AGE_MS, SCANNER_VERSION } from "../scanner/audit-policy.mjs";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;
const FORBIDDEN_EXECUTABLES = new Set(["usr/bin/weed-volume", "usr/bin/weed-worker"]);
const MAX_TEXT = 16_384;
const MAX_COMPONENTS = 100_000;

function invalid() {
  throw new Error("seaweed_candidate_audit_invalid");
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, required, optional = []) {
  if (!object(value)) return false;
  const keys = Object.keys(value).sort();
  const allowed = [...required, ...optional];
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.includes(key));
}

function text(value) {
  return typeof value === "string" && value.length <= MAX_TEXT && value.trim().length > 0 && !value.includes("\0");
}

function timestamp(value) {
  const match = typeof value === "string" ? TIMESTAMP.exec(value) : null;
  if (!match) return NaN;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 ||
      second > 59 || Number(match[10] ?? 0) > 23 || Number(match[11] ?? 0) > 59) return NaN;
  return Date.parse(value);
}

function packageVersion(pkg) {
  if (!object(pkg) || !text(pkg.Name) || !text(pkg.Version) ||
      (pkg.Release !== undefined && (typeof pkg.Release !== "string" || pkg.Release.length > MAX_TEXT)) ||
      (pkg.Epoch !== undefined && (!Number.isSafeInteger(pkg.Epoch) || pkg.Epoch < 0))) invalid();
  return `${pkg.Epoch ? `${pkg.Epoch}:` : ""}${pkg.Version}${pkg.Release ? `-${pkg.Release}` : ""}`;
}

function property(component, name) {
  if (!Array.isArray(component?.properties) || component.properties.length > 256) invalid();
  const matches = component.properties.filter((entry) => entry?.name === name);
  if (matches.length !== 1 || !text(matches[0].value)) invalid();
  return matches[0].value;
}

function forbiddenExecutable(value) {
  const normalized = typeof value === "string" && value.startsWith("/") ? value.slice(1) : value;
  return FORBIDDEN_EXECUTABLES.has(normalized) || [...FORBIDDEN_EXECUTABLES].some((item) => normalized?.startsWith(`${item} (`));
}

function expectedSubject(expected) {
  if (!exactObject(expected, ["artifactName", "imageId", "archiveSha256", "tag"]) ||
      !text(expected.artifactName) || !DIGEST.test(expected.imageId ?? "") ||
      !HEX.test(expected.archiveSha256 ?? "") || !text(expected.tag) ||
      !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_.-]+$/u.test(expected.tag)) invalid();
  return Object.freeze({
    kind: "LOCAL_DOCKER_SAVE_ARCHIVE", artifactName: expected.artifactName,
    imageId: expected.imageId, archiveSha256: expected.archiveSha256,
    tag: expected.tag, os: "linux", architecture: "amd64",
  });
}

function localize(entry, subject) {
  const finding = { ...entry };
  delete finding.imageDigest;
  return { ...finding, subject };
}

export function evaluateLocalSeaweedCandidateAudit(input = {}) {
  if (!exactObject(input, ["vulnerabilityReport", "cyclonedxReport", "subject"], ["now"])) invalid();
  const { vulnerabilityReport: report, cyclonedxReport: sbom, subject: expected, now = new Date() } = input;
  const subject = expectedSubject(expected);
  const at = now instanceof Date ? now.getTime() : NaN;
  const createdAt = timestamp(report?.CreatedAt);
  const config = report?.Metadata?.ImageConfig;
  const repoTags = report?.Metadata?.RepoTags;
  const os = report?.Metadata?.OS;
  if (!Number.isFinite(at) || !object(report) || report.SchemaVersion !== 2 || report.Trivy?.Version !== SCANNER_VERSION ||
      !Number.isFinite(createdAt) || createdAt > at || at - createdAt > MAX_DATABASE_AGE_MS ||
      report.ArtifactType !== "container_image" || report.ArtifactName !== subject.artifactName ||
      report.Metadata?.ImageID !== subject.imageId || config?.os !== "linux" || config?.architecture !== "amd64" ||
      ![undefined, null].includes(config?.variant) || !Array.isArray(repoTags) || repoTags.length !== 1 ||
      repoTags[0] !== subject.tag || !exactObject(os, ["Family", "Name"], ["EOSL"]) ||
      !text(os.Family) || !text(os.Name) || (os.EOSL !== undefined && typeof os.EOSL !== "boolean") ||
      !Array.isArray(report.Results) || report.Results.length === 0 || report.Results.length > 4096) invalid();

  const weedTargets = report.Results.filter((entry) => entry?.Target === "usr/bin/weed" &&
    entry?.Class === "lang-pkgs" && entry?.Type === "gobinary");
  const osTargets = report.Results.filter((entry) => entry?.Class === "os-pkgs");
  if (weedTargets.length !== 1 || osTargets.length !== 1 || osTargets[0].Type !== os.Family ||
      osTargets[0].Target !== `${subject.artifactName} (${os.Family} ${os.Name})` ||
      report.Results.some((entry) => forbiddenExecutable(entry?.Target))) invalid();

  const jsonPackages = new Set();
  for (const result of report.Results) {
    if (!Array.isArray(result?.Packages)) invalid();
    for (const pkg of result.Packages) {
      if (forbiddenExecutable(pkg?.Name)) invalid();
      const identity = JSON.stringify([pkg.Name, packageVersion(pkg), result.Type]);
      if (jsonPackages.has(identity)) invalid();
      jsonPackages.add(identity);
      if (jsonPackages.size > MAX_COMPONENTS) invalid();
    }
  }

  let evaluated;
  try {
    // Intentionally no dispositions: a local candidate cannot waive any finding.
    evaluated = evaluateImageResults(report.Results, { imageDigest: subject.imageId, now });
  } catch (error) {
    if (error?.message === "scanner_audit_clock_invalid") throw error;
    invalid();
  }

  const root = sbom?.metadata?.component;
  if (!object(sbom) || sbom.bomFormat !== "CycloneDX" || !/^1\.[4-7]$/u.test(sbom.specVersion ?? "") ||
      !Number.isSafeInteger(sbom.version) || sbom.version < 1 || root?.type !== "container" ||
      root.name !== subject.artifactName || !Array.isArray(sbom.components) || sbom.components.length === 0 ||
      sbom.components.length > MAX_COMPONENTS + 2) invalid();
  const applications = sbom.components.filter((component) => component?.type === "application");
  if (applications.length !== 1 || applications[0].name !== "usr/bin/weed" ||
      property(applications[0], "aquasecurity:trivy:Type") !== "gobinary" ||
      property(applications[0], "aquasecurity:trivy:Class") !== "lang-pkgs") invalid();
  const operatingSystems = sbom.components.filter((component) => component?.type === "operating-system");
  if (operatingSystems.length !== 1 || operatingSystems[0].name !== os.Family ||
      operatingSystems[0].version !== os.Name ||
      property(operatingSystems[0], "aquasecurity:trivy:Type") !== os.Family ||
      property(operatingSystems[0], "aquasecurity:trivy:Class") !== "os-pkgs") invalid();
  const libraries = sbom.components.filter((component) => component?.type === "library");
  if (libraries.length + applications.length + operatingSystems.length !== sbom.components.length) invalid();
  const sbomPackages = new Set();
  for (const component of libraries) {
    if (!object(component) || !text(component.name) || !text(component.version) || forbiddenExecutable(component.name)) invalid();
    const identity = JSON.stringify([component.name, component.version, property(component, "aquasecurity:trivy:PkgType")]);
    if (sbomPackages.has(identity)) invalid();
    sbomPackages.add(identity);
  }
  if (sbomPackages.size !== jsonPackages.size || [...jsonPackages].some((identity) => !sbomPackages.has(identity))) invalid();

  const findings = evaluated.findings.map((entry) => localize(entry, subject));
  const blockers = evaluated.blockers.map((entry) => localize(entry, subject));
  if (os.EOSL) blockers.push({ code: "image_os_end_of_life", subject });
  return {
    state: blockers.length === 0 ? "COMPLETE" : "BLOCKED", subject, findings, blockers,
    inventory: { resultCount: report.Results.length, packageCount: evaluated.packageCount,
      sbomComponentCount: sbom.components.length },
  };
}
