import { evaluateImageResults, validateDatabaseMetadata } from "./audit-policy.mjs";

const VERSION = "0.76.1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const fail = (code) => { throw new Error(code); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.length <= 16_384 && value.trim().length > 0;
const validVersion = (report, expected) => expected === VERSION && report?.Trivy?.Version === VERSION;

// This separate profile preserves the generation-5 source bytes. It validates
// reports; callers still authenticate the actual scanner, inputs and databases.
function normalized(report) {
  if (report?.SchemaVersion !== 2 || !Array.isArray(report.Results) || report.Results.length < 1 || report.Results.length > 32) fail("scanner_fixture_report_invalid");
  const packages = [], findings = [];
  for (const result of report.Results) {
    if (result?.Class !== "lang-pkgs" || !Array.isArray(result.Packages) || result.Packages.length < 1) fail("scanner_fixture_report_invalid");
    for (const item of result.Packages) {
      if (typeof item?.Name !== "string" || !item.Name || item.Version !== undefined && typeof item.Version !== "string") fail("scanner_fixture_report_invalid");
      packages.push(JSON.stringify([result.Target, result.Type, item.Name, item.Version ?? ""]));
    }
    for (const item of result.Vulnerabilities ?? []) {
      if (typeof item?.VulnerabilityID !== "string" || typeof item.PkgName !== "string" || typeof item.InstalledVersion !== "string") fail("scanner_fixture_report_invalid");
      findings.push(JSON.stringify([result.Target, item.VulnerabilityID, item.PkgName, item.InstalledVersion, item.FixedVersion ?? ""]));
    }
  }
  return { packages: [...new Set(packages)].sort(), findings: [...new Set(findings)].sort() };
}

function sbomProperty(component, name) {
  const matches = Array.isArray(component?.properties) ? component.properties.filter((entry) => entry?.name === name) : [];
  if (matches.length !== 1 || typeof matches[0].value !== "string") fail("scanner_sbom_invalid");
  return matches[0].value;
}

export function validateSelfReport(report, sbom, buildInventory, upstreamVersion, { expectedScannerVersion = VERSION } = {}) {
  if (!validVersion(report, expectedScannerVersion) || upstreamVersion !== VERSION || report?.SchemaVersion !== 2 || report.ArtifactType !== "filesystem" ||
      !Array.isArray(report.Results) || report.Results.length !== 1 || report.Results[0]?.Type !== "gobinary" ||
      report.Results[0]?.Class !== "lang-pkgs" || buildInventory?.main?.path !== "github.com/aquasecurity/trivy" ||
      buildInventory.main.version !== "v0.76.1+dirty" || !Array.isArray(buildInventory.dependencies)) fail("scanner_self_report_invalid");
  const inventory = normalized(report);
  const reportPackages = new Set(inventory.packages.map((entry) => { const [, , name, version] = JSON.parse(entry); return JSON.stringify([name, version]); }));
  const expected = [buildInventory.stdlib, ...buildInventory.dependencies].map((entry) => JSON.stringify([entry.path, entry.version]));
  const mainPackages = [...reportPackages].filter((entry) => JSON.parse(entry)[0] === buildInventory.main.path);
  const mainVersion = mainPackages.length === 1 ? JSON.parse(mainPackages[0])[1] : null;
  if (mainPackages.length !== 1 || mainVersion !== buildInventory.main.version || reportPackages.size !== expected.length + 1 ||
      expected.some((entry) => !reportPackages.has(entry))) fail("scanner_self_inventory_missing");
  if (inventory.findings.length) fail("scanner_self_audit_blocked");
  const root = sbom?.metadata?.component;
  if (sbom?.bomFormat !== "CycloneDX" || root?.type !== "application" || root.name !== report.ArtifactName || !Array.isArray(sbom.components)) fail("scanner_sbom_invalid");
  const applications = sbom.components.filter((entry) => entry?.type === "application");
  const libraries = sbom.components.filter((entry) => entry?.type === "library");
  if (applications.length !== 1 || applications[0].name !== report.Results[0].Target || libraries.length !== reportPackages.size ||
      applications.length + libraries.length !== sbom.components.length || sbomProperty(applications[0], "aquasecurity:trivy:Type") !== "gobinary" ||
      sbomProperty(applications[0], "aquasecurity:trivy:Class") !== "lang-pkgs") fail("scanner_sbom_inventory_mismatch");
  const sbomPackages = new Set(libraries.map((entry) => {
    if (typeof entry.name !== "string" || entry.version !== undefined && typeof entry.version !== "string" ||
        sbomProperty(entry, "aquasecurity:trivy:PkgType") !== "gobinary") fail("scanner_sbom_invalid");
    return JSON.stringify([entry.name, entry.version ?? ""]);
  }));
  if (sbomPackages.size !== reportPackages.size || [...reportPackages].some((entry) => !sbomPackages.has(entry))) fail("scanner_sbom_inventory_mismatch");
  return { ...inventory, expectedModuleCount: expected.length, main: JSON.parse(mainPackages[0]) };
}

export function validateVersionProbeReport(report, upstreamVersion, { expectedScannerVersion = VERSION } = {}) {
  if (!validVersion(report, expectedScannerVersion) || upstreamVersion !== VERSION || report?.SchemaVersion !== 2 ||
      report.ArtifactName !== "/scanner-version-probe" || report.ArtifactType !== "filesystem" || !Array.isArray(report.Results) ||
      report.Results.length !== 1 || report.Results[0]?.Target !== "go.mod" || report.Results[0]?.Type !== "gomod" ||
      report.Results[0]?.Class !== "lang-pkgs" || !Array.isArray(report.Results[0].Packages) || report.Results[0].Packages.length !== 2) fail("scanner_version_probe_invalid");
  const inventory = normalized(report);
  const packages = new Set(report.Results[0].Packages.map((entry) => JSON.stringify([entry?.Name, entry?.Version ?? ""])));
  const expected = new Set([JSON.stringify(["auto.world/scanner-version-probe", ""]), JSON.stringify(["github.com/aquasecurity/trivy", `v${upstreamVersion}`])]);
  if (packages.size !== expected.size || [...expected].some((entry) => !packages.has(entry))) fail("scanner_version_probe_invalid");
  if (inventory.findings.length) fail("scanner_version_probe_blocked");
  return inventory;
}

export function evaluateImageReport(report, pin, dispositions = [], now = new Date(), { expectedScannerVersion = VERSION } = {}) {
  if (!object(pin) || !text(pin.repository) || !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u.test(pin.repository) ||
      !DIGEST.test(pin.manifestDigest ?? "") || !object(pin.platform) || !DIGEST.test(pin.platform.digest ?? "") ||
      pin.platform.os !== "linux" || pin.platform.architecture !== "amd64" || ![undefined, null].includes(pin.platform.variant)) fail("scanner_image_pin_invalid");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("scanner_audit_clock_invalid");
  if (!Array.isArray(dispositions)) fail("scanner_dispositions_invalid");
  const expectedNames = [pin.manifestDigest, pin.platform.digest].map((digest) => `${pin.repository}@${digest}`);
  if (!object(report) || !validVersion(report, expectedScannerVersion) || report.SchemaVersion !== 2 || report.ArtifactType !== "container_image" ||
      !expectedNames.includes(report.ArtifactName) || report.Metadata?.ImageConfig?.os !== pin.platform.os ||
      report.Metadata?.ImageConfig?.architecture !== pin.platform.architecture || !Array.isArray(report.Results) ||
      report.Results.length === 0 || report.Results.length > 4096) fail("scanner_image_report_invalid");
  // Reuse the ordered timestamp and 48-hour predicate for report freshness only;
  // this synthesized record is never retained as evidence about an actual DB.
  try { validateDatabaseMetadata({ Version: 2, UpdatedAt: report.CreatedAt, DownloadedAt: report.CreatedAt }, { now, database: "vulnerability" }); }
  catch { fail("scanner_image_report_invalid"); }
  const evaluated = evaluateImageResults(report.Results, { imageDigest: pin.manifestDigest, dispositions, now });
  const blockers = [...evaluated.blockers];
  if (report.Metadata.OS?.EOSL === true) blockers.unshift({ code: "image_os_end_of_life" });
  if (report.Metadata.OS?.EOSL !== undefined && typeof report.Metadata.OS.EOSL !== "boolean") fail("scanner_image_report_invalid");
  if (pin.platform.digest === "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362") {
    for (const [target, type] of [["usr/bin/weed", "gobinary"], ["usr/bin/weed-volume", "rustbinary"], ["usr/bin/weed-worker", "rustbinary"]]) {
      if (!evaluated.targets.has(JSON.stringify([target, "lang-pkgs", type]))) blockers.push({ code: "image_inventory_incomplete", imageDigest: pin.platform.digest, target, class: "lang-pkgs", type });
    }
  }
  return { findings: evaluated.findings, blockers };
}

// Local Docker-save bytes are distinct from an authenticated registry subject.
// The caller binds their complete hash, Buildx metadata and inspected configID.
export function evaluateArchiveImageReport(report, subject, now = new Date()) {
  if (subject?.kind !== "LOCAL_MANAGED_IMAGE_V1" || !DIGEST.test(subject.imageId ?? "") ||
      !/^[a-f0-9]{64}$/u.test(subject.archiveSha256 ?? "") || !Number.isSafeInteger(subject.archiveBytes) || subject.archiveBytes < 1 ||
      !/^\/managed-image-(?:postgres|opensearch|aws-cli)\.tar$/u.test(subject.artifactName ?? "")) fail("scanner_archive_subject_invalid");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("scanner_audit_clock_invalid");
  if (!object(report) || !validVersion(report, VERSION) || report.SchemaVersion !== 2 || report.ArtifactType !== "container_image" ||
      report.ArtifactName !== subject.artifactName || report.Metadata?.ImageID !== subject.imageId ||
      report.Metadata?.ImageConfig?.os !== "linux" || report.Metadata.ImageConfig.architecture !== "amd64") fail("scanner_archive_report_invalid");
  try { validateDatabaseMetadata({ Version: 2, UpdatedAt: report.CreatedAt, DownloadedAt: report.CreatedAt }, { now, database: "vulnerability" }); }
  catch { fail("scanner_archive_report_invalid"); }
  const evaluated = evaluateImageResults(report.Results, { imageDigest: subject.imageId, dispositions: [], now });
  const blockers = [...evaluated.blockers];
  if (report.Metadata.OS?.EOSL === true) blockers.unshift({ code: "image_os_end_of_life" });
  if (report.Metadata.OS?.EOSL !== undefined && typeof report.Metadata.OS.EOSL !== "boolean") fail("scanner_archive_report_invalid");
  return { findings: evaluated.findings, blockers };
}
