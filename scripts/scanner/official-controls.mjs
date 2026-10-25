import { evaluateImageResults, validateDatabaseMetadata } from "./audit-policy.mjs";

const VERSION = "0.76.1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const fail = (code) => { throw new Error(code); };
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.length <= 16_384 && value.trim().length > 0;
const validVersion = (report, expected) => expected === VERSION && report?.Trivy?.Version === VERSION;

// Measured source-built component, not a published Go-module version or admission.
export const MANAGED_GOSU_SOURCE = Object.freeze({
  sourceCommit: "29b939aa5bd4dc588af765b8248f6e39150d2565",
  sourceArchiveSha256: "2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51",
  goModSha256: "216dbdc31af7371e368b90a85837c6dcf8aa7139cb449ecceaa0526d91900c3a",
  goSumSha256: "3f4d244f09dc5009ad68d99b2d99815f48fddf693fad8e734bbe820b315f43e7",
  compilerVersion: "go1.27.3", buildInfoBytes: 900,
  buildInfoSha256: "cfcd70393ff2134469c019ff50de1396dfb7e5aca4290ef0baa3217869b723f5",
  binarySha256: "8c12961ed59dc9c662d5b5150a8f8e7ab66ef59d5796a0abdb8778b885247b8e",
  finalInventorySha256: "0fd2f7efa537d72c8b532805ea9bff3d1cbbc38d80c8dd89516f09cb2a2efa1e",
});

function managedGosuResults(report, subject, evidence) {
  if (!object(evidence) || Object.keys(evidence).length !== Object.keys(MANAGED_GOSU_SOURCE).length + 6 ||
      evidence.kind !== "SOURCE_BOUND_GOSU_V1" || evidence.imageId !== subject.imageId || evidence.archiveSha256 !== subject.archiveSha256 ||
      typeof evidence.imageId !== "string" || typeof evidence.archiveSha256 !== "string" ||
      evidence.archiveBytes !== subject.archiveBytes || evidence.os !== "linux" || evidence.architecture !== "amd64" ||
      subject.os !== evidence.os || subject.architecture !== evidence.architecture ||
      Object.entries(MANAGED_GOSU_SOURCE).some(([key, value]) => evidence[key] !== value) || subject.artifactName !== "/managed-image-postgres.tar") fail("scanner_gosu_source_evidence_invalid");
  const mainName = "github.com/tianon/gosu", target = "usr/local/bin/gosu";
  const expected = new Map([[mainName, undefined], ["stdlib", "v1.27.3"], ["github.com/moby/sys/user", "v0.4.1"], ["golang.org/x/sys", "v0.1.0"]]);
  if (!Array.isArray(report.Results) || report.Results.length !== 2) fail("scanner_gosu_source_inventory_invalid");
  const go = report.Results.find((result) => result?.Target === target);
  const os = report.Results.find((result) => result?.Class === "os-pkgs");
  if (!go || go.Class !== "lang-pkgs" || go.Type !== "gobinary" || !os || os.Type !== "alpine" ||
      !Array.isArray(go.Packages) || go.Packages.length !== expected.size) fail("scanner_gosu_source_inventory_invalid");
  const names = new Set(), identifiers = new Set();
  for (const pkg of go.Packages) {
    if (!object(pkg) || !expected.has(pkg.Name) || names.has(pkg.Name) ||
        (pkg.Name === mainName ? Object.hasOwn(pkg, "Version") : pkg.Version !== expected.get(pkg.Name)) ||
        pkg.ID !== `${pkg.Name}${pkg.Version === undefined ? "" : `@${pkg.Version}`}` ||
        pkg.Identifier?.PURL !== `pkg:golang/${pkg.ID}` || typeof pkg.Identifier?.UID !== "string" || !/^[a-f0-9]{16}$/u.test(pkg.Identifier.UID) ||
        identifiers.has(pkg.Identifier.UID) || pkg.AnalyzedBy !== "gobinary") fail("scanner_gosu_source_inventory_invalid");
    names.add(pkg.Name); identifiers.add(pkg.Identifier.UID);
  }
  const main = go.Packages.find((pkg) => pkg.Name === mainName);
  const dependencies = go.Packages.filter((pkg) => pkg !== main);
  if (main.Relationship !== "root" || !Array.isArray(main.DependsOn) || main.DependsOn.length !== dependencies.length ||
      new Set(main.DependsOn).size !== dependencies.length || dependencies.some((pkg) => !main.DependsOn.includes(pkg.ID))) fail("scanner_gosu_source_inventory_invalid");
  for (const result of report.Results) {
    if (result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities)) fail("scanner_gosu_source_inventory_invalid");
    for (const finding of result.Vulnerabilities ?? []) {
      if (!object(finding) || finding.PkgID !== undefined && !text(finding.PkgID) ||
          finding.PkgIdentifier !== undefined && (!object(finding.PkgIdentifier) ||
            Object.entries(finding.PkgIdentifier).some(([key, value]) => ["PURL", "UID"].includes(key) && !text(value)))) fail("scanner_gosu_finding_reference_invalid");
      if (finding.PkgName === mainName || finding.PkgID === main.ID || finding.PkgID?.startsWith(`${mainName}@`) ||
          finding.PkgIdentifier?.UID === main.Identifier.UID || finding.PkgIdentifier?.PURL === main.Identifier.PURL ||
          finding.PkgIdentifier?.PURL?.startsWith(`${main.Identifier.PURL}@`)) fail("scanner_gosu_source_finding_blocked");
      if (result === go) {
        const pkg = dependencies.find((entry) => entry.Name === finding.PkgName && entry.Version === finding.InstalledVersion);
        if (!pkg || finding.PkgID !== undefined && finding.PkgID !== pkg.ID ||
            finding.PkgIdentifier?.UID !== undefined && finding.PkgIdentifier.UID !== pkg.Identifier.UID ||
            finding.PkgIdentifier?.PURL !== undefined && finding.PkgIdentifier.PURL !== pkg.Identifier.PURL) fail("scanner_gosu_finding_reference_invalid");
      }
    }
  }
  return { results: report.Results.map((result) => result === go ? { ...result, Packages: dependencies } : result),
    sourceComponents: [{ name: mainName, target, version: null, mainVersionLookup: "UNAVAILABLE", ...evidence }] };
}

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
export function evaluateArchiveImageReport(report, subject, now = new Date(), gosuEvidence) {
  if (subject?.kind !== "LOCAL_MANAGED_IMAGE_V1" || !DIGEST.test(subject.imageId ?? "") ||
      !/^[a-f0-9]{64}$/u.test(subject.archiveSha256 ?? "") || !Number.isSafeInteger(subject.archiveBytes) || subject.archiveBytes < 1 ||
      !/^\/managed-image-(?:postgres|opensearch|aws-cli)\.tar$/u.test(subject.artifactName ?? "")) fail("scanner_archive_subject_invalid");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("scanner_audit_clock_invalid");
  if (!object(report) || !validVersion(report, VERSION) || report.SchemaVersion !== 2 || report.ArtifactType !== "container_image" ||
      report.ArtifactName !== subject.artifactName || report.Metadata?.ImageID !== subject.imageId ||
      report.Metadata?.ImageConfig?.os !== "linux" || report.Metadata.ImageConfig.architecture !== "amd64") fail("scanner_archive_report_invalid");
  try { validateDatabaseMetadata({ Version: 2, UpdatedAt: report.CreatedAt, DownloadedAt: report.CreatedAt }, { now, database: "vulnerability" }); }
  catch { fail("scanner_archive_report_invalid"); }
  const source = gosuEvidence === undefined ? null : managedGosuResults(report, subject, gosuEvidence);
  const evaluated = evaluateImageResults(source?.results ?? report.Results, { imageDigest: subject.imageId, dispositions: [], now });
  const blockers = [...evaluated.blockers];
  if (report.Metadata.OS?.EOSL === true) blockers.unshift({ code: "image_os_end_of_life" });
  if (report.Metadata.OS?.EOSL !== undefined && typeof report.Metadata.OS.EOSL !== "boolean") fail("scanner_archive_report_invalid");
  return { findings: evaluated.findings, blockers, ...(source ? { sourceComponents: source.sourceComponents,
    rawPackageCount: evaluated.packageCount + 1, versionedPackageCount: evaluated.packageCount, sourceBoundPackageCount: 1 } : {}) };
}
