import { chmod, lstat, mkdir, opendir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_AUDIT_ARTIFACT_FILES } from "./audit-artifacts.mjs";
import { copyExpectedFile, loadVerifiedCandidateRecords, verifyCandidateArtifactMatrix } from "./candidate-artifacts.mjs";
import { assertVerifiedBaselineTcb, getVerifiedBaselineTcbEvidence } from "./baseline-tcb.mjs";
import { deriveGoInventory } from "./go-inventory.mjs";
import { hashFileBounded, readFileBounded, verifyNativeAuditFiles } from "./native-audit.mjs";
import { policyError, runCommand } from "./process.mjs";
import { loadScannerFixtureManifest, validateScannerFixtureReport } from "./scanner-fixtures.mjs";
import { assertClosedObject, canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const DOCKER = "/usr/bin/docker";
const IMAGE = "aquasec/trivy@sha256:ee940acbf1f58ebadb42d01434ce4609530bf1b52536afbd1eee66cd7123c5c9";
const FIXTURES = Object.freeze([
  Object.freeze({ id: "gomod-vulnerable", target: "/fixtures/gomod", artifactName: "gomod", targets: Object.freeze([
    Object.freeze({ target: "go.mod", type: "gomod" }), Object.freeze({ target: "submod/go.mod", type: "gomod" }),
    Object.freeze({ target: "submod2/go.mod", type: "gomod" }),
  ]) }),
  Object.freeze({ id: "java-war-vulnerable", target: "/fixtures/java/test.war", artifactName: "test.war",
    targets: Object.freeze([Object.freeze({ target: "test.war", type: "jar" })]) }),
]);
const BASELINE_VERSION = "0.74.0";
const CANDIDATE_VERSION = "0.74.0-autoworld.1";
const GO_ROOT_PACKAGES = Object.freeze(new Map([
  ["go.mod", "github.com/testdata/testdata"],
  ["submod/go.mod", "github.com/testdata/testdata/submod"],
  ["submod2/go.mod", "github.com/testdata/testdata/submod2"],
]));
const EXPECTED_INVENTORY_PATH = fileURLToPath(new URL("../../infra/supply-chain/materials/baseline-fixtures/expected-inventory.json", import.meta.url));
const EXPECTED_INVENTORY_IDENTITY = Object.freeze({ sha256: "94d004fa9835aebd81b19c5ff4835554f58eef1da176d2dd0d6b2c15ed8936fd", size: 19304 });
const fail = (code) => { throw policyError(code); };

function fixedPath(value) {
  return typeof value === "string" && path.posix.isAbsolute(value) && value.length <= 4096 &&
    !value.includes("\0") && !value.includes(",") && value.split("/").every((part) => part !== "..");
}

export function baselineDockerArguments({ configDirectory, fixturesDirectory, cacheDirectory, operation }) {
  if (![configDirectory, fixturesDirectory, cacheDirectory].every(fixedPath) ||
      new Set([configDirectory, fixturesDirectory, cacheDirectory]).size !== 3) fail("baseline_comparison_arguments_refused");
  const common = ["--host", "unix:///var/run/docker.sock", "--config", configDirectory, "run", "--rm", "--pull=never",
    "--platform", "linux/amd64", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", "--user", "65532:65532", "--pids-limit", "256", "--memory", "1g",
    "--memory-swap", "1g", "--cpus", "1", "--mount", `type=bind,src=${fixturesDirectory},dst=/fixtures,readonly`,
    "--mount", `type=bind,src=${cacheDirectory},dst=/cache,readonly`,
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m", "--workdir", "/tmp",
    "--env", "HOME=/tmp", "--env", "XDG_CONFIG_HOME=/tmp", "--env", "XDG_CACHE_HOME=/tmp"];
  if (operation === "probe") {
    return [...common, "--entrypoint", "/bin/sh", IMAGE, "-ceu",
      "test \"$(id -u)\" = 65532; test \"$(id -g)\" = 65532; ! (: > /cache/.auto-world-write); ! (: > /fixtures/.auto-world-write); ! (: > /.auto-world-write); : > /tmp/auto-world-write; rm /tmp/auto-world-write"];
  }
  const fixture = FIXTURES.find((entry) => entry.id === operation);
  if (!fixture) fail("baseline_comparison_arguments_refused");
  return [...common, IMAGE, "fs", "--cache-dir", "/cache", "--cache-backend", "memory", "--skip-db-update",
    "--skip-java-db-update", "--skip-version-check", "--offline-scan", "--quiet", "--scanners", "vuln",
    "--format", "json", "--list-all-pkgs", fixture.target];
}

export function validateBaselineDockerArguments(args, paths, operation) {
  if (!Array.isArray(args) || canonicalJsonBuffer(args).compare(canonicalJsonBuffer(baselineDockerArguments({ ...paths, operation }))) !== 0) {
    fail("baseline_comparison_arguments_refused");
  }
  return true;
}

function stringField(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 8192;
}

function optionalString(value) {
  return value === undefined || typeof value === "string" && value.length <= 8192;
}

function normalizeDataSource(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("baseline_report_invalid");
  const output = {};
  for (const key of ["ID", "Name", "URL"]) {
    if (value[key] !== undefined) {
      if (!optionalString(value[key])) fail("baseline_report_invalid");
      output[key] = value[key];
    }
  }
  return output;
}

function normalizeReportResult(result, fixture) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.Class !== "lang-pkgs" ||
      !fixture.targets.some((entry) => entry.target === result.Target && entry.type === result.Type) ||
      !Array.isArray(result.Packages) || result.Packages.length < 1 || result.Packages.length > 10_000) fail("baseline_report_invalid");
  const expectedRoot = result.Type === "gomod" ? GO_ROOT_PACKAGES.get(result.Target) : undefined;
  if (result.Type === "gomod") {
    const roots = result.Packages.filter((entry) => entry?.Relationship === "root");
    if (!expectedRoot || roots.length !== 1 || roots[0].Name !== expectedRoot || roots[0].ID !== expectedRoot ||
        Object.hasOwn(roots[0], "Version") || Object.hasOwn(roots[0], "Identifier")) fail("baseline_report_invalid");
  }
  const packages = result.Packages.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !stringField(entry.Name) ||
        entry.Version !== undefined && (typeof entry.Version !== "string" || entry.Version.length > 8192) ||
        !optionalString(entry.PURL) || entry.Identifier !== undefined && (!entry.Identifier || typeof entry.Identifier !== "object" ||
        Array.isArray(entry.Identifier) || !optionalString(entry.Identifier.PURL))) fail("baseline_report_invalid");
    if (result.Type === "gomod" && entry.Name !== expectedRoot && !stringField(entry.Version)) fail("baseline_report_invalid");
    return { target: result.Target, class: result.Class, type: result.Type, name: entry.Name, version: entry.Version ?? "",
      purl: entry.Identifier?.PURL ?? entry.PURL ?? "" };
  });
  const vulnerabilities = result.Vulnerabilities ?? [];
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length > 10_000) fail("baseline_report_invalid");
  const findings = vulnerabilities.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !stringField(entry.VulnerabilityID) ||
        !stringField(entry.PkgName) || !stringField(entry.InstalledVersion) || !optionalString(entry.FixedVersion) ||
        !optionalString(entry.Severity) || !optionalString(entry.Status) || !optionalString(entry.SeveritySource) ||
        !optionalString(entry.PrimaryURL)) fail("baseline_report_invalid");
    return { target: result.Target, id: entry.VulnerabilityID, package: entry.PkgName, installedVersion: entry.InstalledVersion,
      fixedVersion: entry.FixedVersion ?? "", severity: entry.Severity ?? "", status: entry.Status ?? "",
      severitySource: entry.SeveritySource ?? "", primaryUrl: entry.PrimaryURL ?? "", dataSource: normalizeDataSource(entry.DataSource) };
  });
  if (findings.some((finding) => !packages.some((entry) => entry.name === finding.package && entry.version === finding.installedVersion))) {
    fail("baseline_report_invalid");
  }
  return { packages, findings };
}

function uniqueSorted(entries) {
  const encoded = entries.map((entry) => canonicalJsonBuffer(entry).toString("utf8"));
  if (new Set(encoded).size !== encoded.length) fail("baseline_report_duplicate");
  return entries.toSorted((left, right) => canonicalJsonBuffer(left).compare(canonicalJsonBuffer(right)));
}

function validateNormalizedPackage(entry) {
  assertClosedObject(entry, ["target", "class", "type", "name", "version", "purl"]);
  if (![entry.target, entry.class, entry.type, entry.name].every(stringField) || typeof entry.version !== "string" || entry.version.length > 8192 ||
      typeof entry.purl !== "string" || entry.purl.length > 8192) {
    fail("baseline_expected_inventory_invalid");
  }
  return entry;
}

export function normalizeBaselineComparisonReport(fixtureId, report, scannerVersion) {
  const fixture = FIXTURES.find((entry) => entry.id === fixtureId);
  const expectedArtifactName = scannerVersion === BASELINE_VERSION ? fixture?.target : fixture?.artifactName;
  if (!fixture || ![BASELINE_VERSION, CANDIDATE_VERSION].includes(scannerVersion) || !report || typeof report !== "object" || Array.isArray(report) ||
      report.SchemaVersion !== 2 || report.ArtifactType !== "filesystem" || report.ArtifactName !== expectedArtifactName ||
      report.Trivy?.Version !== scannerVersion || !Array.isArray(report.Results) || report.Results.length !== fixture.targets.length) fail("baseline_report_invalid");
  const observedTargets = report.Results.map((entry) => `${entry.Target}\0${entry.Type}`).sort();
  const expectedTargets = fixture.targets.map((entry) => `${entry.target}\0${entry.type}`).sort();
  if (canonicalJsonBuffer(observedTargets).compare(canonicalJsonBuffer(expectedTargets)) !== 0) fail("baseline_report_invalid");
  const normalized = report.Results.flatMap((entry) => {
    const result = normalizeReportResult(entry, fixture);
    return [{ packages: result.packages, findings: result.findings }];
  });
  return Object.freeze({ fixtureId, packages: Object.freeze(uniqueSorted(normalized.flatMap((entry) => entry.packages))),
    findings: Object.freeze(uniqueSorted(normalized.flatMap((entry) => entry.findings))) });
}

function difference(left, right) {
  const other = new Set(right.map((entry) => canonicalJsonBuffer(entry).toString("utf8")));
  return left.filter((entry) => !other.has(canonicalJsonBuffer(entry).toString("utf8")));
}

export function compareBaselineReports(candidateReports, baselineReports, expectedInventory) {
  if (!Array.isArray(candidateReports) || !Array.isArray(baselineReports) || candidateReports.length !== 2 || baselineReports.length !== 2) {
    fail("baseline_comparison_input_invalid");
  }
  if (!Array.isArray(expectedInventory) || expectedInventory.length !== 2) fail("baseline_expected_inventory_missing");
  const comparisons = FIXTURES.map((fixture) => {
    const candidate = candidateReports.find((entry) => entry.fixtureId === fixture.id);
    const baseline = baselineReports.find((entry) => entry.fixtureId === fixture.id);
    const expected = expectedInventory.find((entry) => entry.fixtureId === fixture.id);
    if (!candidate || !baseline || !expected || !Array.isArray(expected.packages) || expected.packages.length < 1) fail("baseline_expected_inventory_missing");
    const expectedPackages = uniqueSorted(expected.packages.map(validateNormalizedPackage));
    const candidateMissingExpected = difference(expectedPackages, candidate.packages);
    const baselineMissingExpected = difference(expectedPackages, baseline.packages);
    const detail = {
      fixtureId: fixture.id,
      candidateMissingExpected, baselineMissingExpected,
      candidateUnexpectedPackages: difference(candidate.packages, expectedPackages), baselineUnexpectedPackages: difference(baseline.packages, expectedPackages),
      candidateOnlyPackages: difference(candidate.packages, baseline.packages), baselineOnlyPackages: difference(baseline.packages, candidate.packages),
      candidateOnlyFindings: difference(candidate.findings, baseline.findings), baselineOnlyFindings: difference(baseline.findings, candidate.findings),
    };
    return Object.freeze({ ...detail, matched: Object.entries(detail).filter(([key]) => key !== "fixtureId").every(([, value]) => value.length === 0),
      candidatePackageCount: candidate.packages.length, baselinePackageCount: baseline.packages.length,
      candidateFindingCount: candidate.findings.length, baselineFindingCount: baseline.findings.length });
  });
  return Object.freeze({ matched: comparisons.every((entry) => entry.matched), comparisons: Object.freeze(comparisons) });
}

function expectedAuditPaths() {
  return new Map(NATIVE_AUDIT_ARTIFACT_FILES.map((entry) => [entry.path, entry.cap]));
}

export async function validateNativeAuditComparisonArtifact(directory) {
  if (!path.isAbsolute(directory) || await realpath(directory) !== directory) fail("baseline_audit_artifact_invalid");
  const rootInfo = await lstat(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail("baseline_audit_artifact_invalid");
  const packageBytes = await readFileBounded(path.join(directory, "diagnostic-package.json"), 64 * 1024);
  const receipt = parseBoundedJson(packageBytes, { maxBytes: 64 * 1024, maxDepth: 12, maxMembers: 1024 });
  if (canonicalJsonBuffer(receipt).compare(packageBytes) !== 0) fail("baseline_audit_artifact_invalid");
  assertClosedObject(receipt, ["schemaVersion", "state", "executionStatus", "phase", "files"]);
  if (receipt.schemaVersion !== 1 || receipt.state !== "diagnostic_only" || receipt.executionStatus !== "passed" || receipt.phase !== "complete" ||
      !Array.isArray(receipt.files) || receipt.files.length !== NATIVE_AUDIT_ARTIFACT_FILES.length) fail("baseline_audit_artifact_invalid");
  const contracts = expectedAuditPaths();
  const identities = new Map();
  for (const [index, entry] of receipt.files.entries()) {
    assertClosedObject(entry, ["path", "sha256", "size"]);
    const cap = contracts.get(entry.path);
    if (entry.path !== NATIVE_AUDIT_ARTIFACT_FILES[index].path || cap === undefined || identities.has(entry.path) || !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
        !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > cap) fail("baseline_audit_artifact_invalid");
    identities.set(entry.path, Object.freeze({ sha256: entry.sha256, size: entry.size, cap }));
  }
  const expectedFiles = new Set([...contracts.keys(), "diagnostic-package.json"]);
  const expectedDirectories = new Set([""]);
  for (const relative of expectedFiles) {
    let parent = path.posix.dirname(relative);
    while (parent !== ".") { expectedDirectories.add(parent); parent = path.posix.dirname(parent); }
  }
  const pending = [""];
  while (pending.length) {
    const relative = pending.pop();
    const absolute = path.join(directory, relative);
    const directoryInfo = await lstat(absolute);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || directoryInfo.dev !== rootInfo.dev || await realpath(absolute) !== absolute) fail("baseline_audit_artifact_invalid");
    expectedDirectories.delete(relative);
    for await (const entry of await opendir(absolute)) {
      const child = path.posix.join(relative, entry.name);
      if (expectedDirectories.has(child) && entry.isDirectory()) pending.push(child);
      else if (expectedFiles.has(child) && entry.isFile()) {
        const info = await lstat(path.join(directory, child));
        if (info.isSymbolicLink() || info.nlink !== 1 || info.dev !== rootInfo.dev || await realpath(path.join(directory, child)) !== path.join(directory, child)) fail("baseline_audit_artifact_invalid");
        expectedFiles.delete(child);
      } else fail("baseline_audit_artifact_invalid");
    }
  }
  if (expectedFiles.size || expectedDirectories.size) fail("baseline_audit_artifact_invalid");
  for (const [relative, identity] of identities) {
    const actual = await hashFileBounded(path.join(directory, relative), identity.cap);
    if (actual.sha256 !== identity.sha256 || actual.size !== identity.size) fail("baseline_audit_artifact_changed");
  }
  const totalBytes = [...identities.values()].reduce((sum, entry) => sum + entry.size, packageBytes.length);
  if (totalBytes > 6 * GiB) fail("baseline_audit_artifact_budget_exceeded");
  const summaryBytes = await readFileBounded(path.join(directory, "native-audit-results.json"), 8 * MiB);
  const summary = parseBoundedJson(summaryBytes, { maxBytes: 8 * MiB, maxDepth: 32, maxMembers: 100_000 });
  if (canonicalJsonBuffer(summary).compare(summaryBytes) !== 0) fail("baseline_audit_summary_invalid");
  assertClosedObject(summary, ["schemaVersion", "budget", "results", "fixtures"]);
  if (summary.schemaVersion !== 1 || !Array.isArray(summary.results) || summary.results.length !== 4) fail("baseline_audit_summary_invalid");
  return Object.freeze({ identities, totalBytes, summary });
}

function auditFiles(directory, prefix) {
  return {
    receipt: path.join(directory, prefix, "receipt.json"), binary: path.join(directory, prefix, prefix.startsWith("cosign-windows") ? "cosign.exe" : prefix.split("-")[0]),
    scanner: path.join(directory, "trivy-linux-amd64/trivy"), scannerVersion: path.join(directory, "scanner-version.json"),
    buildInfo: path.join(directory, prefix, "build-info.json"), moduleGraph: path.join(directory, prefix, "module-graph.json"),
    material: path.join(directory, prefix, "material-lock.json"), recipe: path.join(directory, prefix, "recipe.json"),
    sbom: path.join(directory, prefix, "sbom.json"), report: path.join(directory, prefix, "report.json"),
    database: path.join(directory, "databases/vulnerability.db"), databaseMetadata: path.join(directory, "databases/vulnerability.metadata.json"),
    javaDatabase: path.join(directory, "databases/java.db"), javaDatabaseMetadata: path.join(directory, "databases/java.metadata.json"),
  };
}

async function verifyAuditReceipts(context, directory, records, identities) {
  const scannerOutput = records.find((entry) => entry.tool === "trivy" && entry.repeat === 1)?.outputs.find((entry) => entry.target === "linux-amd64");
  if (!scannerOutput) fail("baseline_candidate_matrix_invalid");
  const databases = [
    { name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db:2", sha256: identities.get("databases/vulnerability.db").sha256,
      metadataSha256: identities.get("databases/vulnerability.metadata.json").sha256 },
    { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db:1", sha256: identities.get("databases/java.db").sha256,
      metadataSha256: identities.get("databases/java.metadata.json").sha256 },
  ];
  const evaluations = [];
  for (const [tool, target] of [["oras", "linux-amd64"], ["cosign", "linux-amd64"], ["cosign", "windows-amd64"], ["trivy", "linux-amd64"]]) {
    const prefix = `${tool}-${target}`;
    const record = records.find((entry) => entry.tool === tool && entry.repeat === 1);
    const output = record?.outputs.find((entry) => entry.target === target);
    const expectation = context.expectations.find((entry) => entry.tool === tool && entry.repeat === 1);
    const selected = context.selection.tools.find((entry) => entry.name === tool);
    const proposal = context.lock.proposals.find((entry) => entry.tool === tool);
    if (!output || !expectation || !selected || !proposal) fail("baseline_candidate_matrix_invalid");
    const inventory = deriveGoInventory({ tool, buildInfo: output.buildInfo, lockedModules: proposal.modules, goVersion: context.selection.compiler.version });
    const subject = { name: tool, version: selected.modifiedVersion, os: target.startsWith("windows") ? "windows" : "linux", architecture: "amd64",
      sha256: output.sha256, size: output.size, sourceCommit: selected.commit, materialSha256: sha256(context.lockBytes),
      recipeSha256: proposal.recipeSha256, buildInfoSha256: sha256(canonicalJsonBuffer(output.buildInfo)),
      moduleGraphSha256: sha256(canonicalJsonBuffer(proposal.modules)) };
    const evaluation = await verifyNativeAuditFiles(auditFiles(directory, prefix), { run: expectation.run, subject,
      scanner: { name: "trivy", version: CANDIDATE_VERSION, sha256: scannerOutput.sha256 }, databases,
      artifactName: "subject", scanTarget: path.basename(output.path), requiredPackages: inventory.packages });
    if (evaluation.state !== "audit_proposal") fail("baseline_candidate_audit_not_passed");
    evaluations.push(Object.freeze({ tool, target, evaluation }));
  }
  return Object.freeze(evaluations);
}

function verifyAuditSummary(summary, audits) {
  for (const audit of audits) {
    const result = summary.results.find((entry) => entry.tool === audit.tool && entry.target === audit.target);
    if (!result) fail("baseline_audit_summary_invalid");
    assertClosedObject(result, ["tool", "target", "state", "packageCount", "findingCount", "blockerCount", "findingsSha256", "blockersSha256"]);
    if (result.state !== audit.evaluation.state || result.packageCount !== audit.evaluation.packageCount ||
        result.findingCount !== audit.evaluation.findings.length || result.blockerCount !== audit.evaluation.blockers.length ||
        result.findingsSha256 !== sha256(canonicalJsonBuffer(audit.evaluation.findings)) ||
        result.blockersSha256 !== sha256(canonicalJsonBuffer(audit.evaluation.blockers))) fail("baseline_audit_summary_invalid");
  }
}

async function stageInputs(auditDirectory, workspace, identities) {
  const fixtures = path.join(workspace, "fixtures");
  const cache = path.join(workspace, "cache");
  await mkdir(path.join(fixtures, "gomod/submod"), { recursive: true, mode: 0o755 });
  await mkdir(path.join(fixtures, "gomod/submod2"), { recursive: true, mode: 0o755 });
  await mkdir(path.join(fixtures, "java"), { recursive: true, mode: 0o755 });
  await mkdir(path.join(cache, "db"), { recursive: true, mode: 0o755 });
  await mkdir(path.join(cache, "java-db"), { recursive: true, mode: 0o755 });
  const manifest = await loadScannerFixtureManifest();
  const materials = manifest.fixtures.flatMap((entry) => entry.material);
  const stagedFiles = [];
  for (const material of materials) {
    const relative = `fixtures/materials/${material.path}`;
    const identity = identities.get(relative);
    if (!identity || identity.sha256 !== material.sha256 || identity.size !== material.size) fail("baseline_fixture_identity_mismatch");
    const destination = path.join(fixtures, material.path);
    await copyExpectedFile(path.join(auditDirectory, relative), destination, identity, 4 * MiB);
    await chmod(destination, 0o444);
    stagedFiles.push(Object.freeze({ path: destination, identity, cap: 4 * MiB }));
  }
  const databases = [
    ["databases/vulnerability.db", "db/trivy.db", 2048 * MiB], ["databases/vulnerability.metadata.json", "db/metadata.json", 8 * MiB],
    ["databases/java.db", "java-db/trivy-java.db", 2048 * MiB], ["databases/java.metadata.json", "java-db/metadata.json", 8 * MiB],
  ];
  for (const [source, destination, cap] of databases) {
    const identity = identities.get(source);
    await copyExpectedFile(path.join(auditDirectory, source), path.join(cache, destination), identity, cap);
    await chmod(path.join(cache, destination), 0o444);
    stagedFiles.push(Object.freeze({ path: path.join(cache, destination), identity, cap }));
  }
  return Object.freeze({ fixtures: await realpath(fixtures), cache: await realpath(cache), manifest, files: Object.freeze(stagedFiles) });
}

export function validateBaselineExpectedInventory(document, fixtureManifest) {
  assertClosedObject(document, ["schemaVersion", "source", "derivation", "materials", "targets", "summary"]);
  assertClosedObject(document.derivation, ["method", "purlRule", "targetRule", "goSumRule", "reportJsonPurlRule"]);
  assertClosedObject(document.summary, ["targets", "packages", "packagesByTarget"]);
  if (document.schemaVersion !== 1 || canonicalJsonBuffer(document.source).compare(canonicalJsonBuffer(fixtureManifest.source)) !== 0 ||
      !Object.values(document.derivation).every(stringField) || !Array.isArray(document.targets) || document.targets.length !== 4 ||
      document.summary.targets !== 4 || document.summary.packages !== 43 || !document.materials || typeof document.materials !== "object" || Array.isArray(document.materials)) {
    fail("baseline_expected_inventory_invalid");
  }
  const sourceMaterials = fixtureManifest.fixtures.filter((entry) => FIXTURES.some((fixture) => fixture.id === entry.id)).flatMap((entry) => entry.material);
  if (Object.keys(document.materials).length !== sourceMaterials.length) fail("baseline_expected_inventory_invalid");
  for (const material of sourceMaterials) {
    const receipt = document.materials[material.path];
    if (!receipt) fail("baseline_expected_inventory_invalid");
    assertClosedObject(receipt, ["materialPath", "upstreamPath", "upstreamGitBlob", "size", "sha256"]);
    if (receipt.materialPath !== `../scanner-fixtures/${material.path}` || receipt.upstreamPath !== material.sourcePath ||
        receipt.upstreamGitBlob !== material.gitBlob || receipt.size !== material.size || receipt.sha256 !== material.sha256) fail("baseline_expected_inventory_invalid");
  }
  const grouped = FIXTURES.map((fixture) => ({ fixtureId: fixture.id, packages: [] }));
  const expectedCounts = new Map([["go.mod", 19], ["submod/go.mod", 8], ["submod2/go.mod", 8], ["test.war", 8]]);
  const observedTargets = [];
  for (const target of document.targets) {
    const isGo = target.fixture === "gomod-vulnerable";
    assertClosedObject(target, isGo ? ["fixture", "scanSubjectRelativeTarget", "resultClass", "resultType", "goDirective", "replaceDirectives", "packages",
      "reportJsonRootPackage", "reportJsonRootPackageOmittedFields"]
      : ["fixture", "scanSubjectRelativeTarget", "resultClass", "resultType", "packages"]);
    const fixture = FIXTURES.find((entry) => entry.id === target.fixture);
    if (!fixture || !fixture.targets.some((entry) => entry.target === target.scanSubjectRelativeTarget && entry.type === target.resultType) ||
        target.resultClass !== "lang-pkgs" || !Array.isArray(target.packages) || target.packages.length !== expectedCounts.get(target.scanSubjectRelativeTarget) ||
        isGo && (!/^1\.(15|17)$/u.test(target.goDirective) || !Array.isArray(target.replaceDirectives) || target.replaceDirectives.length)) {
      fail("baseline_expected_inventory_invalid");
    }
    if (isGo) {
      assertClosedObject(target.reportJsonRootPackage, ["ID", "Name", "Relationship"]);
      if (target.reportJsonRootPackage.ID !== target.reportJsonRootPackage.Name || target.reportJsonRootPackage.Relationship !== "root" ||
          canonicalJsonBuffer(target.reportJsonRootPackageOmittedFields).compare(canonicalJsonBuffer(["Version", "Identifier"])) !== 0) {
        fail("baseline_expected_inventory_invalid");
      }
    }
    const selected = grouped.find((entry) => entry.fixtureId === target.fixture);
    observedTargets.push(`${target.fixture}\0${target.scanSubjectRelativeTarget}\0${target.resultType}`);
    for (const entry of target.packages) {
      assertClosedObject(entry, isGo ? ["name", "version", "relationship", "filePath", "canonicalPurl", "purl"]
        : ["name", "version", "relationship", "filePath", "metadataPath", "canonicalPurl", "purl"]);
      if (!stringField(entry.name) || typeof entry.version !== "string" || entry.version.length > 8192 || !stringField(entry.canonicalPurl) ||
          !entry.canonicalPurl.startsWith("pkg:") || entry.purl !== null ||
          !stringField(entry.relationship) || !stringField(entry.filePath) || !isGo && !stringField(entry.metadataPath) ||
          entry.version === "" && entry.relationship !== "root") fail("baseline_expected_inventory_invalid");
      selected.packages.push({ target: target.scanSubjectRelativeTarget, class: target.resultClass, type: target.resultType,
        name: entry.name, version: entry.version, purl: "" });
    }
    if (isGo) {
      const roots = target.packages.filter((entry) => entry.relationship === "root");
      if (roots.length !== 1 || roots[0].name !== target.reportJsonRootPackage.Name || roots[0].version !== "") {
        fail("baseline_expected_inventory_invalid");
      }
    }
  }
  const requiredTargets = FIXTURES.flatMap((fixture) => fixture.targets.map((entry) => `${fixture.id}\0${entry.target}\0${entry.type}`)).sort();
  if (canonicalJsonBuffer(observedTargets.sort()).compare(canonicalJsonBuffer(requiredTargets)) !== 0) fail("baseline_expected_inventory_invalid");
  if (canonicalJsonBuffer(document.summary.packagesByTarget).compare(canonicalJsonBuffer(Object.fromEntries(expectedCounts))) !== 0) {
    fail("baseline_expected_inventory_invalid");
  }
  if (grouped.some((entry) => entry.packages.length < 1) || new Set(grouped.flatMap((entry) => entry.packages.map((item) => canonicalJsonBuffer(item).toString("utf8")))).size !== 43) {
    fail("baseline_expected_inventory_invalid");
  }
  return Object.freeze(grouped.map((entry) => Object.freeze({ fixtureId: entry.fixtureId, packages: Object.freeze(uniqueSorted(entry.packages)) })));
}

export async function loadBaselineExpectedInventory(fixtureManifest) {
  const bytes = await readFileBounded(EXPECTED_INVENTORY_PATH, 1024 * 1024);
  if (bytes.length !== EXPECTED_INVENTORY_IDENTITY.size || sha256(bytes) !== EXPECTED_INVENTORY_IDENTITY.sha256) fail("baseline_expected_inventory_changed");
  return validateBaselineExpectedInventory(parseBoundedJson(bytes, { maxBytes: 1024 * 1024, maxDepth: 24, maxMembers: 4096 }), fixtureManifest);
}

async function verifyStagedInputs(staged) {
  for (const entry of staged.files) {
    const actual = await hashFileBounded(entry.path, entry.cap);
    if (actual.sha256 !== entry.identity.sha256 || actual.size !== entry.identity.size) fail("baseline_comparison_input_changed");
  }
}

async function requireEmptyDirectory(directory) {
  if (await realpath(directory) !== directory) fail("baseline_comparison_directory_invalid");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail("baseline_comparison_directory_invalid");
  for await (const unused of await opendir(directory)) { void unused; fail("baseline_comparison_directory_invalid"); }
}

async function verifyOutputDirectory(directory, rawReports, tcbEvidence, receiptIdentity) {
  const expected = new Map(rawReports.map((entry) => [entry.path, { sha256: entry.sha256, size: entry.size, cap: 64 * MiB }]));
  for (const entry of tcbEvidence) expected.set(entry.path, { sha256: entry.sha256, size: entry.size, cap: 64 * 1024 });
  expected.set("baseline-comparison.json", { ...receiptIdentity, cap: 8 * MiB });
  for await (const entry of await opendir(directory)) {
    const selected = expected.get(entry.name);
    if (!selected || !entry.isFile()) fail("baseline_comparison_artifact_invalid");
    const info = await lstat(path.join(directory, entry.name));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || await realpath(path.join(directory, entry.name)) !== path.join(directory, entry.name)) {
      fail("baseline_comparison_artifact_invalid");
    }
    const actual = await hashFileBounded(path.join(directory, entry.name), selected.cap);
    if (actual.sha256 !== selected.sha256 || actual.size !== selected.size) fail("baseline_comparison_artifact_changed");
    expected.delete(entry.name);
  }
  if (expected.size) fail("baseline_comparison_artifact_invalid");
}

function remaining(deadline) {
  const value = deadline - Date.now();
  if (!Number.isSafeInteger(deadline) || value < 1) fail("baseline_comparison_timeout");
  return Math.min(value, 10 * 60_000);
}

// The reviewed baseline-scanner compare command invokes this diagnostic. Its result is always
// failed/non-admitted diagnostic evidence and cannot change candidate policy.
export async function runBaselineComparison({ context, baselineTcb, nativeAuditDirectory, workspace, outputDirectory }) {
  const deadline = Date.now() + 45 * 60_000;
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || !context || typeof context !== "object" ||
      !baselineTcb || typeof baselineTcb !== "object" || !path.isAbsolute(nativeAuditDirectory) || !path.isAbsolute(workspace) ||
      !path.isAbsolute(outputDirectory) || new Set([nativeAuditDirectory, workspace, outputDirectory]).size !== 3) fail("baseline_comparison_requires_linux_actions");
  for (const [left, right] of [[nativeAuditDirectory, workspace], [nativeAuditDirectory, outputDirectory], [workspace, outputDirectory]]) {
    const relative = path.relative(left, right);
    if (!relative || relative === ".." || !relative.startsWith(`..${path.sep}`)) fail("baseline_comparison_directory_invalid");
  }
  assertVerifiedBaselineTcb(baselineTcb, context.expectations[0]?.run);
  const tcbEvidence = getVerifiedBaselineTcbEvidence(baselineTcb, context.expectations[0]?.run);
  if (tcbEvidence.length !== 2 || canonicalJsonBuffer(tcbEvidence.map((entry) => entry.path)).compare(
    canonicalJsonBuffer(["tcb-managed-docker.json", "tcb-inventory.json"])) !== 0 ||
    tcbEvidence.some((entry) => !Buffer.isBuffer(entry.bytes) || !/^[a-f0-9]{64}$/u.test(entry.sha256) || entry.size !== entry.bytes.length ||
      entry.sha256 !== sha256(entry.bytes) || entry.size < 1 || entry.size > 64 * 1024)) fail("baseline_tcb_evidence_invalid");
  if (baselineTcb.runnerImageVersion !== "20260831.293.1" || baselineTcb.cli.path !== DOCKER ||
      baselineTcb.cli.sha256 !== "6435ff9214bf8e0931078fb0980809728cac0a54a526d4f28a26d3e48132b58d" || baselineTcb.cli.size !== 43134496 ||
      baselineTcb.image.child !== IMAGE.slice(IMAGE.indexOf("sha256:")) || baselineTcb.image.config !== "sha256:1105aaf5e7223aac9caeb251ff2ad4eb09d9f4d97ba4e5afde52e0f017f848aa" ||
      baselineTcb.image.os !== "linux" || baselineTcb.image.architecture !== "amd64" || baselineTcb.image.size !== 190307614 ||
      !/^[a-f0-9]{64}$/u.test(baselineTcb.identitySha256)) fail("baseline_tcb_identity_mismatch");
  for (const directory of [workspace, outputDirectory]) await requireEmptyDirectory(directory);
  const audit = await validateNativeAuditComparisonArtifact(nativeAuditDirectory);
  const matrixDirectory = path.join(context.runnerTemp, "native-candidates");
  const matrix = await verifyCandidateArtifactMatrix(matrixDirectory, context.expectations, context.sources);
  const records = await loadVerifiedCandidateRecords(matrixDirectory, matrix, context.expectations);
  const audits = await verifyAuditReceipts(context, nativeAuditDirectory, records, audit.identities);
  verifyAuditSummary(audit.summary, audits);
  const fixtureCopyBytes = [...audit.identities.entries()].filter(([relative]) => relative.startsWith("fixtures/materials/"))
    .reduce((sum, [, identity]) => sum + identity.size, 0);
  const databaseCopyBytes = [...audit.identities.entries()].filter(([relative]) => relative.startsWith("databases/"))
    .reduce((sum, [, identity]) => sum + identity.size, 0);
  const projectedJobBytes = audit.totalBytes + matrix.consumedBytes + fixtureCopyBytes + databaseCopyBytes + baselineTcb.image.size +
    3 * 64 * MiB + 8 * MiB + tcbEvidence.reduce((sum, entry) => sum + entry.size, 0);
  if (projectedJobBytes > 8 * GiB) fail("baseline_comparison_job_budget_exceeded");
  const staged = await stageInputs(nativeAuditDirectory, workspace, audit.identities);
  const expectedInventory = await loadBaselineExpectedInventory(staged.manifest);
  for (const entry of tcbEvidence) {
    await writeFile(path.join(outputDirectory, entry.path), entry.bytes, { flag: "wx", mode: 0o600 });
    const actual = await hashFileBounded(path.join(outputDirectory, entry.path), 64 * 1024);
    if (actual.sha256 !== entry.sha256 || actual.size !== entry.size) fail("baseline_tcb_evidence_changed");
  }
  const configDirectory = path.join(workspace, "docker-config");
  await mkdir(configDirectory, { mode: 0o700 });
  const paths = { configDirectory, fixturesDirectory: staged.fixtures, cacheDirectory: staged.cache };
  const environment = { PATH: "/usr/bin:/bin", HOME: workspace, TMPDIR: workspace,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const options = { cwd: workspace, env: environment, maxOutputBytes: 64 * MiB };
  const invokeDocker = async (args) => {
    const cli = await hashFileBounded(DOCKER, 512 * MiB);
    if (cli.sha256 !== baselineTcb.cli.sha256 || cli.size !== baselineTcb.cli.size) fail("baseline_tcb_tool_identity_changed");
    return runCommand(DOCKER, args, { ...options, timeoutMs: remaining(deadline) });
  };
  const probe = baselineDockerArguments({ ...paths, operation: "probe" });
  validateBaselineDockerArguments(probe, paths, "probe");
  await invokeDocker(probe);
  await verifyStagedInputs(staged);
  const candidateReports = [];
  const baselineReports = [];
  const rawReports = [];
  for (const fixture of FIXTURES) {
    const candidateBytes = await readFileBounded(path.join(nativeAuditDirectory, `fixtures/reports/${fixture.id}.json`), 64 * MiB);
    const candidateIdentity = audit.identities.get(`fixtures/reports/${fixture.id}.json`);
    if (!candidateIdentity || sha256(candidateBytes) !== candidateIdentity.sha256 || candidateBytes.length !== candidateIdentity.size) {
      fail("baseline_audit_artifact_changed");
    }
    const candidateReport = parseBoundedJson(candidateBytes, { maxBytes: 64 * MiB, maxDepth: 32, maxMembers: 100_000 });
    validateScannerFixtureReport(fixture.id, candidateReport);
    candidateReports.push(normalizeBaselineComparisonReport(fixture.id, candidateReport, CANDIDATE_VERSION));
    const args = baselineDockerArguments({ ...paths, operation: fixture.id });
    validateBaselineDockerArguments(args, paths, fixture.id);
    const result = await invokeDocker(args);
    await verifyStagedInputs(staged);
    const baselineReport = parseBoundedJson(result.stdout, { maxBytes: 64 * MiB, maxDepth: 32, maxMembers: 100_000 });
    baselineReports.push(normalizeBaselineComparisonReport(fixture.id, baselineReport, BASELINE_VERSION));
    const reportFile = path.join(outputDirectory, `${fixture.id}.json`);
    await writeFile(reportFile, result.stdout, { flag: "wx", mode: 0o600 });
    rawReports.push(Object.freeze({ fixtureId: fixture.id, path: `${fixture.id}.json`, sha256: sha256(result.stdout), size: result.stdout.length }));
  }
  for (const report of rawReports) {
    const actual = await hashFileBounded(path.join(outputDirectory, report.path), 64 * MiB);
    if (actual.sha256 !== report.sha256 || actual.size !== report.size) fail("baseline_report_changed");
  }
  const finalAudit = await validateNativeAuditComparisonArtifact(nativeAuditDirectory);
  for (const [relative, expected] of audit.identities) {
    const actual = finalAudit.identities.get(relative);
    if (!actual || actual.sha256 !== expected.sha256 || actual.size !== expected.size) fail("baseline_audit_artifact_changed");
  }
  const comparison = compareBaselineReports(candidateReports, baselineReports, expectedInventory);
  const receipt = canonicalJsonBuffer({ schemaVersion: 1, state: "failed_non_admitted", comparisonStatus: comparison.matched ? "match" : "mismatch",
    run: baselineTcb.run, baseline: { image: IMAGE, version: BASELINE_VERSION, tcbIdentitySha256: baselineTcb.identitySha256 },
    candidate: { version: CANDIDATE_VERSION, matrixSha256: sha256(canonicalJsonBuffer(matrix)) },
    tcbEvidence: tcbEvidence.map(({ path: relative, sha256: digest, size }) => ({ path: relative, sha256: digest, size })), reports: rawReports,
    comparison: comparison.comparisons });
  const artifactBytes = rawReports.reduce((sum, entry) => sum + entry.size, receipt.length) +
    tcbEvidence.reduce((sum, entry) => sum + entry.size, 0);
  if (receipt.length > 8 * MiB || artifactBytes > 6 * GiB) fail("baseline_comparison_artifact_budget_exceeded");
  await writeFile(path.join(outputDirectory, "baseline-comparison.json"), receipt, { flag: "wx", mode: 0o600 });
  await verifyOutputDirectory(outputDirectory, rawReports, tcbEvidence, { sha256: sha256(receipt), size: receipt.length });
  if (!comparison.matched) fail("baseline_comparison_mismatch");
  return Object.freeze({ state: "failed_non_admitted", matched: comparison.matched, directory: await realpath(outputDirectory),
    receiptSha256: sha256(receipt), reports: Object.freeze(rawReports) });
}
