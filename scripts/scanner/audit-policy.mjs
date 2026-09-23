// These checks validate reports, not scanner integrity or reviewer authority.
// Callers must authenticate their inputs and bind the actual bytes separately.
export const SCANNER_VERSION = "0.74.0-autoworld.2";
export const MAX_DATABASE_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_DISPOSITION_MS = 30 * 24 * 60 * 60 * 1000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

function invalid(code = "scanner_image_report_invalid") {
  throw new Error(code);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.length <= 16_384 && value.trim().length > 0;
}

function packageIdentity(pkg) {
  if (!object(pkg) || !text(pkg.Name) || !text(pkg.Version) ||
      (pkg.Release !== undefined && (typeof pkg.Release !== "string" || pkg.Release.length > 16_384)) ||
      (pkg.Epoch !== undefined && (!Number.isSafeInteger(pkg.Epoch) || pkg.Epoch < 0))) invalid();
  // Match pinned Trivy pkg/scan/utils.FormatVersion, including OS epoch/release.
  const version = `${pkg.Epoch ? `${pkg.Epoch}:` : ""}${pkg.Version}${pkg.Release ? `-${pkg.Release}` : ""}`;
  return JSON.stringify([pkg.Name, version]);
}

function timestamp(value) {
  const match = typeof value === "string" ? TIMESTAMP.exec(value) : null;
  if (!match) return NaN;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      hour > 23 || minute > 59 || second > 59 || Number(match[10] ?? 0) > 23 || Number(match[11] ?? 0) > 59) return NaN;
  return Date.parse(value);
}

function clock(now) {
  const value = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(value)) invalid("scanner_audit_clock_invalid");
  return value;
}

export function validateDatabaseMetadata(metadata, { now = new Date(), expectedVersion } = {}) {
  const at = clock(now);
  const reject = (check) => {
    const error = new Error("scanner_database_metadata_invalid");
    error.diagnostic = { check };
    throw error;
  };
  if (!object(metadata) || ![1, 2].includes(expectedVersion)) reject("shape_or_expected_version");
  const updatedAt = timestamp(metadata.UpdatedAt);
  const downloadedAt = timestamp(metadata.DownloadedAt);
  if (!Number.isFinite(updatedAt)) reject("updated_at_timestamp");
  if (!Number.isFinite(downloadedAt)) reject("downloaded_at_timestamp");
  if (metadata.Version !== expectedVersion) reject("schema_version");
  if (updatedAt > downloadedAt) reject("updated_after_download");
  if (downloadedAt > at) reject("downloaded_in_future");
  if (at - updatedAt > MAX_DATABASE_AGE_MS) reject("database_age_exceeded");
  return { updatedAt: metadata.UpdatedAt, downloadedAt: metadata.DownloadedAt, version: metadata.Version };
}

function validatePin(pin) {
  if (!object(pin) || !text(pin.repository) ||
      !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u.test(pin.repository) ||
      !DIGEST.test(pin.manifestDigest ?? "") || !object(pin.platform) ||
      !DIGEST.test(pin.platform.digest ?? "") || pin.platform.os !== "linux" ||
      pin.platform.architecture !== "amd64" || ![undefined, null].includes(pin.platform.variant)) {
    invalid("scanner_image_pin_invalid");
  }
}

function approvedDisposition(entry, identity, at) {
  if (!object(entry)) return false;
  const reviewedAt = timestamp(entry.reviewedAt);
  const expiresAt = timestamp(entry.expiresAt);
  return ["imageDigest", "target", "vulnerabilityId", "packageName", "installedVersion"].every((key) => entry[key] === identity[key]) &&
    entry.decision === "unfixed_local_ci_only" && typeof entry.reason === "string" && entry.reason.trim().length >= 30 &&
    typeof entry.independentReview === "string" && /^https:\/\/github\.com\/CleMeY15\/auto-world\/(?:pull|issues)\/\d+(?:#[a-zA-Z0-9-]+)?$/u.test(entry.independentReview) &&
    Number.isFinite(reviewedAt) && Number.isFinite(expiresAt) && reviewedAt <= at && expiresAt > at &&
    expiresAt - reviewedAt <= MAX_DISPOSITION_MS;
}

export function evaluateImageReport(report, pin, dispositions = [], now = new Date()) {
  validatePin(pin);
  const at = clock(now);
  if (!Array.isArray(dispositions)) invalid("scanner_dispositions_invalid");
  const createdAt = timestamp(report?.CreatedAt);
  const expectedNames = [pin.manifestDigest, pin.platform.digest].map((digest) => `${pin.repository}@${digest}`);
  if (!object(report) || report.SchemaVersion !== 2 || report.Trivy?.Version !== SCANNER_VERSION ||
      !Number.isFinite(createdAt) || createdAt > at || at - createdAt > MAX_DATABASE_AGE_MS ||
      report.ArtifactType !== "container_image" || !expectedNames.includes(report.ArtifactName) ||
      report.Metadata?.ImageConfig?.os !== pin.platform.os || report.Metadata?.ImageConfig?.architecture !== pin.platform.architecture ||
      !Array.isArray(report.Results) || report.Results.length === 0 || report.Results.length > 4096) invalid();

  const blockers = [];
  const findings = [];
  const targets = new Set();
  let packageCount = 0;
  let findingCount = 0;
  if (report.Metadata.OS?.EOSL === true) blockers.push({ code: "image_os_end_of_life" });
  if (report.Metadata.OS?.EOSL !== undefined && typeof report.Metadata.OS.EOSL !== "boolean") invalid();

  for (const result of report.Results) {
    if (!object(result) || !text(result.Target) || !text(result.Type) ||
        !["os-pkgs", "lang-pkgs"].includes(result.Class) ||
        !Array.isArray(result.Packages) || result.Packages.length === 0 ||
        (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities))) invalid();
    packageCount += result.Packages.length;
    findingCount += result.Vulnerabilities?.length ?? 0;
    if (packageCount > 100_000 || findingCount > 100_000) invalid();
    const packageIdentities = new Set(result.Packages.map(packageIdentity));
    const target = JSON.stringify([result.Target, result.Class, result.Type]);
    if (targets.has(target)) invalid();
    targets.add(target);
    for (const finding of result.Vulnerabilities ?? []) {
      if (!object(finding) || !["HIGH", "CRITICAL"].includes(finding.Severity) ||
          !text(finding.VulnerabilityID) || !text(finding.PkgName) || !text(finding.InstalledVersion) ||
          (finding.FixedVersion !== undefined && typeof finding.FixedVersion !== "string") ||
          !packageIdentities.has(JSON.stringify([finding.PkgName, finding.InstalledVersion]))) invalid();
      const identity = {
        imageDigest: pin.manifestDigest, target: result.Target,
        vulnerabilityId: finding.VulnerabilityID, packageName: finding.PkgName,
        installedVersion: finding.InstalledVersion, severity: finding.Severity,
        fixedVersion: finding.FixedVersion ?? "",
      };
      findings.push(identity);
      if (identity.severity === "CRITICAL" || identity.fixedVersion.trim()) {
        blockers.push({ ...identity, code: "image_vulnerability_blocked" });
      } else if (!dispositions.some((entry) => approvedDisposition(entry, identity, at))) {
        blockers.push({ ...identity, code: "unfixed_high_needs_independent_disposition" });
      }
    }
  }
  return { findings, blockers };
}
