import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { SCANNER_VERSION } from "./audit-policy.mjs";

const MiB = 1024 ** 2;

function fail(code) {
  throw new Error(code);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readBoundedJson(file, cap = 64 * MiB) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > cap) fail("scanner_json_file_invalid");
  const bytes = await readFile(file);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("scanner_json_file_invalid"); }
  return { value, identity: { sha256: hash(bytes), size: bytes.length } };
}

export async function captureFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 128) fail("scanner_snapshot_invalid");
  const snapshot = [];
  for (const entry of files) {
    if (!entry || typeof entry.path !== "string" || !path.isAbsolute(entry.path) || !Number.isSafeInteger(entry.cap)) fail("scanner_snapshot_invalid");
    const info = await lstat(entry.path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > entry.cap) fail("scanner_snapshot_invalid");
    const bytes = await readFile(entry.path);
    snapshot.push({ path: entry.path, sha256: hash(bytes), size: bytes.length, cap: entry.cap });
  }
  return snapshot;
}

export async function assertFilesUnchanged(snapshot) {
  const current = await captureFiles(snapshot.map(({ path: file, cap }) => ({ path: file, cap })));
  if (JSON.stringify(current) !== JSON.stringify(snapshot)) fail("scanner_frozen_input_changed");
  return true;
}

function validateModuleClosure(document) {
  if (!Array.isArray(document) || document.length < 1 || document.length > 4096) fail("scanner_module_closure_invalid");
  const identities = [];
  for (const entry of document) {
    if (!entry || typeof entry.path !== "string" || typeof entry.version !== "string" || typeof entry.sum !== "string" ||
        typeof entry.goModSum !== "string" || !/^[a-f0-9]{64}$/u.test(entry.zip?.sha256 ?? "") ||
        !Number.isSafeInteger(entry.zip?.size) || entry.zip.size < 1) fail("scanner_module_closure_invalid");
    identities.push(`${entry.path}@${entry.version}`);
  }
  const sorted = [...identities].sort((left, right) => left.localeCompare(right, "en"));
  if (new Set(identities).size !== identities.length || JSON.stringify(identities) !== JSON.stringify(sorted)) fail("scanner_module_closure_invalid");
}

export function validateBuildPair(left, right, expected) {
  if (!expected || !/^[a-f0-9]{40}$/u.test(expected.sourceCommit ?? "") || !/^[a-f0-9]{64}$/u.test(expected.lockSha256 ?? "") ||
      !Array.isArray(expected.moduleClosures) || expected.moduleClosures.length !== 2 || !Array.isArray(expected.buildInfos) || expected.buildInfos.length !== 2) fail("scanner_build_expectation_invalid");
  for (const receipt of [left, right]) {
    if (receipt?.schemaVersion !== 1 || receipt.state !== "diagnostic_only" || receipt.result !== "passed" ||
        receipt.scannerVersion !== SCANNER_VERSION || ![1, 2].includes(receipt.repeat) ||
        !/^[a-f0-9]{64}$/u.test(receipt.binary?.sha256 ?? "") || !Number.isSafeInteger(receipt.binary?.size) || receipt.binary.size < 1 ||
        receipt.sourceCommit !== expected.sourceCommit || receipt.lock?.sha256 !== expected.lockSha256 ||
        !Array.isArray(receipt.phases) || receipt.phases.length < 8 || receipt.phases.some((entry) => entry.result !== "passed")) fail("scanner_build_receipt_invalid");
  }
  for (const [index, closure] of expected.moduleClosures.entries()) {
    validateModuleClosure(closure.value);
    const declared = [left, right][index].modules?.closure;
    if (declared?.sha256 !== closure.identity.sha256 || declared?.size !== closure.identity.size) fail("scanner_module_closure_changed");
  }
  for (const [index, buildInfo] of expected.buildInfos.entries()) {
    const declared = [left, right][index].buildInfo;
    if (declared?.sha256 !== buildInfo.identity.sha256 || declared?.size !== buildInfo.identity.size) fail("scanner_build_info_changed");
  }
  if (left.repeat !== 1 || right.repeat !== 2 || left.binary.sha256 !== right.binary.sha256 || left.binary.size !== right.binary.size ||
      left.sourceCommit !== right.sourceCommit || left.sourceTree !== right.sourceTree || left.lock.sha256 !== right.lock.sha256 ||
      JSON.stringify(left.modules?.before) !== JSON.stringify(right.modules?.before) || left.modules?.closure?.sha256 !== right.modules?.closure?.sha256 ||
      JSON.stringify(expected.moduleClosures[0].value) !== JSON.stringify(expected.moduleClosures[1].value) ||
      JSON.stringify(expected.buildInfos[0].value) !== JSON.stringify(expected.buildInfos[1].value)) {
    fail("scanner_reproducibility_mismatch");
  }
  return { sha256: left.binary.sha256, size: left.binary.size };
}

export function parseGoBuildInfo(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : "";
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const header = /^(?:.+): go(1\.26\.8)(?:-X:jsonv2)$/u.exec(lines.shift() ?? "");
  if (!header) fail("scanner_go_build_info_invalid");
  let main = null;
  let binaryPathSeen = false;
  const dependencies = [];
  for (const line of lines) {
    if (!line) continue;
    const fields = line.split("\t");
    if (fields[0] !== "") fail("scanner_go_build_info_invalid");
    if (fields[1] === "path") {
      if (binaryPathSeen || fields[2] !== "github.com/aquasecurity/trivy/cmd/trivy") fail("scanner_go_build_info_invalid");
      binaryPathSeen = true;
    } else if (fields[1] === "mod") {
      if (main || fields[2] !== "github.com/aquasecurity/trivy" || fields[3] !== "(devel)") fail("scanner_go_build_info_invalid");
      main = { path: fields[2], version: null };
    } else if (fields[1] === "dep") {
      if (!fields[2] || !fields[3] || dependencies.some((entry) => entry.path === fields[2])) fail("scanner_go_build_info_invalid");
      dependencies.push({ path: fields[2], version: fields[3] });
    } else if (fields[1] === "=>") {
      if (!dependencies.length || !fields[2] || !fields[3]) fail("scanner_go_build_info_invalid");
      dependencies[dependencies.length - 1] = { path: fields[2], version: fields[3] };
    } else if (fields[1] !== "build") fail("scanner_go_build_info_invalid");
  }
  if (!binaryPathSeen || !main || dependencies.length < 100 || new Set(dependencies.map((entry) => entry.path)).size !== dependencies.length) fail("scanner_go_build_info_invalid");
  dependencies.sort((left, right) => `${left.path}@${left.version}`.localeCompare(`${right.path}@${right.version}`, "en"));
  return { stdlib: { path: "stdlib", version: `v${header[1]}` }, main, dependencies };
}

function normalized(report) {
  if (report?.SchemaVersion !== 2 || !Array.isArray(report.Results) || report.Results.length < 1 || report.Results.length > 32) fail("scanner_fixture_report_invalid");
  const packages = [];
  const findings = [];
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

export function validateFixtureReport(fixture, report, expectedVersion = SCANNER_VERSION) {
  if (!fixture || report?.Trivy?.Version !== expectedVersion || report.ArtifactType !== "filesystem") fail("scanner_fixture_report_invalid");
  const inventory = normalized(report);
  if (fixture.id === "gomod-vulnerable") {
    for (const expected of fixture.expected.findings) {
      if (!inventory.findings.some((entry) => {
        const [target, id, packageName, version, fixed] = JSON.parse(entry);
        return target === expected.target && id === expected.id && packageName === expected.package && version === expected.version && fixed === expected.fixedVersion;
      })) fail("scanner_fixture_detection_missing");
    }
  } else if (fixture.id === "java-war-vulnerable") {
    const expected = fixture.expected.finding;
    if (!inventory.findings.some((entry) => {
      const [, id, packageName, version, fixed] = JSON.parse(entry);
      return id === expected.id && packageName === fixture.expected.package && version === fixture.expected.version && fixed === expected.fixedVersion;
    })) fail("scanner_fixture_detection_missing");
  } else if (fixture.id === "java-jar-clean-candidate" && inventory.findings.length !== 0) {
    fail("scanner_clean_fixture_has_findings");
  }
  return inventory;
}

export function compareSameDatabase(candidate, baseline) {
  const candidatePackages = new Set(candidate.packages);
  const candidateFindings = new Set(candidate.findings);
  const baselineOnlyPackages = baseline.packages.filter((entry) => !candidatePackages.has(entry));
  const baselineOnlyFindings = baseline.findings.filter((entry) => !candidateFindings.has(entry));
  if (baselineOnlyPackages.length || baselineOnlyFindings.length) fail("scanner_baseline_detection_loss");
  return { baselineOnlyPackages, baselineOnlyFindings };
}

function sbomProperty(component, name) {
  const matches = Array.isArray(component?.properties) ? component.properties.filter((entry) => entry?.name === name) : [];
  if (matches.length !== 1 || typeof matches[0].value !== "string") fail("scanner_sbom_invalid");
  return matches[0].value;
}

export function validateSelfReport(report, sbom, buildInventory, upstreamVersion) {
  if (report?.SchemaVersion !== 2 || report.Trivy?.Version !== SCANNER_VERSION || report.ArtifactType !== "filesystem" ||
      !Array.isArray(report.Results) || report.Results.length !== 1 || report.Results[0]?.Type !== "gobinary" ||
      report.Results[0]?.Class !== "lang-pkgs" || !buildInventory?.main || !Array.isArray(buildInventory.dependencies) ||
      !/^\d+\.\d+\.\d+$/u.test(upstreamVersion ?? "")) fail("scanner_self_report_invalid");
  const inventory = normalized(report);
  const reportPackages = new Set(inventory.packages.map((entry) => {
    const [, , name, version] = JSON.parse(entry); return JSON.stringify([name, version]);
  }));
  const expected = [buildInventory.stdlib, ...buildInventory.dependencies].map((entry) => JSON.stringify([entry.path, entry.version]));
  const mainPackages = [...reportPackages].filter((entry) => JSON.parse(entry)[0] === buildInventory.main.path);
  const mainVersion = mainPackages.length === 1 ? JSON.parse(mainPackages[0])[1] : null;
  if (mainPackages.length !== 1 || !["", `v${upstreamVersion}`].includes(mainVersion) || reportPackages.size !== expected.length + 1 ||
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

export function validateVersionProbeReport(report, upstreamVersion) {
  if (!/^\d+\.\d+\.\d+$/u.test(upstreamVersion ?? "") || report?.SchemaVersion !== 2 || report.Trivy?.Version !== SCANNER_VERSION ||
      report.ArtifactName !== "/scanner-version-probe" || report.ArtifactType !== "filesystem" || !Array.isArray(report.Results) ||
      report.Results.length !== 1 || report.Results[0]?.Target !== "go.mod" || report.Results[0]?.Type !== "gomod" ||
      report.Results[0]?.Class !== "lang-pkgs" || !Array.isArray(report.Results[0].Packages) || report.Results[0].Packages.length !== 2) fail("scanner_version_probe_invalid");
  const inventory = normalized(report);
  const packages = new Set(report.Results[0].Packages.map((entry) => JSON.stringify([entry?.Name, entry?.Version ?? ""])));
  const expected = new Set([
    JSON.stringify(["auto.world/scanner-version-probe", ""]),
    JSON.stringify(["github.com/aquasecurity/trivy", `v${upstreamVersion}`]),
  ]);
  if (packages.size !== expected.size || [...expected].some((entry) => !packages.has(entry))) fail("scanner_version_probe_invalid");
  if (inventory.findings.length) fail("scanner_version_probe_blocked");
  return inventory;
}
