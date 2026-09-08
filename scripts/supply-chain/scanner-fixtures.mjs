import { copyFile, lstat, mkdir, opendir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashFileBounded, readFileBounded } from "./native-audit.mjs";
import { createOwnedDirectory, policyError, removeOwnedDirectory, runCommand } from "./process.mjs";
import { assertClosedObject, canonicalJsonBuffer, parseBoundedJson, sha256 } from "./strict-json.mjs";

const MiB = 1024 * 1024;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MATERIAL_ROOT = path.join(REPOSITORY_ROOT, "infra/supply-chain/materials/scanner-fixtures");
const MANIFEST_PATH = path.join(MATERIAL_ROOT, "manifest.json");
const MANIFEST_IDENTITY = Object.freeze({ sha256: "68dfb6e1fdd196b23eb36256119a3050ea104a8a11c5109f34c1a389c34f2a30", size: 6184 });
const SOURCE = Object.freeze({
  repository: "aquasecurity/trivy",
  commit: "e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994",
  rawBaseUrl: "https://raw.githubusercontent.com/aquasecurity/trivy/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994",
});
const SCANNER_VERSION = "0.74.0-autoworld.1";
const GO_ROOTS = Object.freeze({
  "go.mod": "github.com/testdata/testdata",
  "submod/go.mod": "github.com/testdata/testdata/submod",
  "submod2/go.mod": "github.com/testdata/testdata/submod2",
});
const MATERIALS = Object.freeze([
  { path: "gomod/go.mod", sourcePath: "integration/testdata/fixtures/repo/gomod/go.mod", gitBlob: "f59c97baf941ab84b48535edbc3b3373022a87eb", sha256: "7aa955bee64bed627284bdd91365c5f53f996467364a142802f20cd8e032549f", size: 1069 },
  { path: "gomod/go.sum", sourcePath: "integration/testdata/fixtures/repo/gomod/go.sum", gitBlob: "43be8bf10ceca25732601013e0f9489c5cf03802", sha256: "2ca549d11f4fb30aea32e489e8d65596f20988dc15dbc19c085449a0f8931527", size: 129439 },
  { path: "gomod/submod/go.mod", sourcePath: "integration/testdata/fixtures/repo/gomod/submod/go.mod", gitBlob: "f1f3268e1fbcfc03ce498e02210f8cb35a658e0a", sha256: "8179a58ea1404e5aece47303b75970ada1bb7c292fc45183ad3cc0474176e954", size: 117 },
  { path: "gomod/submod/go.sum", sourcePath: "integration/testdata/fixtures/repo/gomod/submod/go.sum", gitBlob: "38efa1d61ad4b934d42bbf71f57ae8921eb9af2a", sha256: "40841aa4376c744fdbe69526232cd205ffd9bb3abdf243ea6c11d9836f9c4804", size: 1048 },
  { path: "gomod/submod2/go.mod", sourcePath: "integration/testdata/fixtures/repo/gomod/submod2/go.mod", gitBlob: "08f06b0e7227d6431eced1489c79cb00587faf5a", sha256: "8689f776807a618b0f33a8d99b2dd9033cc7120f2f635b572951046f7aff3929", size: 101 },
  { path: "gomod/submod2/go.sum", sourcePath: "integration/testdata/fixtures/repo/gomod/submod2/go.sum", gitBlob: "7e62d841138900d88995885b1c3916e7888e261c", sha256: "708f2019e08317d697dd0075b855ef8e1c843b33acfe56c45f5d106667800b2f", size: 1404 },
  { path: "java/test.war", sourcePath: "pkg/fanal/analyzer/language/java/jar/testdata/test.war", gitBlob: "787d517174b773da1a8fbdba1bf878eddf95addd", sha256: "b852f605a56a1e109bdd17aaa8d85007c4327708bf6e3b4b56a9876b4a1077ba", size: 2525883 },
  { path: "java/jackson-core-2.15.0.jar", sha256: "5b483f68fa9dd6aa37da37d1f79dd5c4b9464238f4f0660a242cb6b5c724950c", sha1: "12f334a1dc9c6d2854c43ae314024dde8b3ad572", size: 542635 },
]);
const FIXTURE_IDS = Object.freeze(["gomod-vulnerable", "java-war-vulnerable", "java-jar-clean-candidate"]);
const ARTIFACT_INVENTORY = Object.freeze({
  directories: Object.freeze(["materials", "reports"]),
  materials: Object.freeze(MATERIALS.map((entry) => `materials/${entry.path}`)),
  reports: Object.freeze(FIXTURE_IDS.map((id) => `reports/${id}.json`)),
});
const GO_FINDINGS = Object.freeze([
  ["go.mod", "GMS-2022-20", "github.com/docker/distribution", "v2.7.1+incompatible", "v2.8.0"],
  ["go.mod", "CVE-2022-23628", "github.com/open-policy-agent/opa", "v0.35.0", "0.37.0"],
  ["go.mod", "CVE-2021-38561", "golang.org/x/text", "v0.3.6", "0.3.7"],
  ["submod/go.mod", "GMS-2022-20", "github.com/docker/distribution", "v2.7.1+incompatible", "v2.8.0"],
  ["submod2/go.mod", "GMS-2022-20", "github.com/docker/distribution", "v2.7.1+incompatible", "v2.8.0"],
]);
const CLEAN_JAR_PACKAGES = Object.freeze(["com.fasterxml.jackson.core:jackson-core@2.15.0"]);
const fail = (code = "scanner_fixture_invalid") => { throw policyError(code); };

export function scannerFixtureArtifactInventory() {
  return ARTIFACT_INVENTORY;
}

export async function validateScannerFixtureArtifact(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory) || await realpath(directory) !== directory) fail("scanner_fixture_artifact_invalid");
  const expected = new Set([
    ...ARTIFACT_INVENTORY.directories,
    "materials/gomod", "materials/gomod/submod", "materials/gomod/submod2", "materials/java",
    ...ARTIFACT_INVENTORY.materials, ...ARTIFACT_INVENTORY.reports,
  ]);
  const pending = [""];
  const observed = new Set();
  while (pending.length) {
    const relativeDirectory = pending.pop();
    const absoluteDirectory = path.join(directory, relativeDirectory);
    for await (const entry of await opendir(absoluteDirectory)) {
      const relative = path.posix.join(relativeDirectory.replaceAll("\\", "/"), entry.name);
      if (!expected.has(relative) || observed.has(relative) || entry.isSymbolicLink()) fail("scanner_fixture_artifact_invalid");
      observed.add(relative);
      const absolute = path.join(directory, relative);
      const info = await lstat(absolute);
      if (entry.isDirectory()) {
        if (!info.isDirectory() || await realpath(absolute) !== absolute) fail("scanner_fixture_artifact_invalid");
        pending.push(relative);
      } else if (!entry.isFile() || !info.isFile() || info.nlink !== 1 || await realpath(absolute) !== absolute) {
        fail("scanner_fixture_artifact_invalid");
      }
    }
  }
  if (observed.size !== expected.size) fail("scanner_fixture_artifact_invalid");
  return true;
}

function sameDigest(actual, expected) {
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) fail("scanner_fixture_material_changed");
}

function sameCanonical(actual, expected) {
  return canonicalJsonBuffer(actual).compare(canonicalJsonBuffer(expected)) === 0;
}

export function validateScannerFixtureManifest(manifest) {
  try {
    assertClosedObject(manifest, ["schemaVersion", "source", "fixtures"]);
    assertClosedObject(manifest.source, ["repository", "commit", "rawBaseUrl"]);
    if (manifest.schemaVersion !== 1 || !sameCanonical(manifest.source, SOURCE) || !Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 3) fail();
    const ids = manifest.fixtures.map((fixture) => fixture?.id);
    if (!sameCanonical(ids, FIXTURE_IDS)) fail();
    const materials = manifest.fixtures.flatMap((fixture) => Array.isArray(fixture?.material) ? fixture.material : []);
    if (materials.length !== MATERIALS.length || !sameCanonical(materials, MATERIALS)) fail();
    return manifest;
  } catch (error) {
    if (error?.code === "scanner_fixture_invalid") throw error;
    fail();
  }
}

export async function loadScannerFixtureManifest(expectedIdentity) {
  if (expectedIdentity !== undefined) {
    assertClosedObject(expectedIdentity, ["sha256", "size"]);
    sameDigest(expectedIdentity, MANIFEST_IDENTITY);
  }
  const bytes = await readFileBounded(MANIFEST_PATH, 64 * 1024);
  sameDigest({ sha256: sha256(bytes), size: bytes.length }, MANIFEST_IDENTITY);
  return validateScannerFixtureManifest(parseBoundedJson(bytes, {
    maxBytes: 64 * 1024, maxDepth: 16, maxMembers: 512,
  }));
}

function normalizedResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result) || typeof result.Target !== "string" ||
      result.Class !== "lang-pkgs" || !Array.isArray(result.Packages) || result.Packages.length === 0 || result.Packages.length > 10_000) fail("scanner_fixture_report_invalid");
  const packages = result.Packages.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.Name !== "string" || !item.Name) fail("scanner_fixture_report_invalid");
    // The pinned Go parser includes these exact module roots. Its JSON marshal
    // omits Version and Identifier for roots in a local filesystem scan.
    if (result.Type === "gomod" && Object.hasOwn(GO_ROOTS, result.Target) && item.Name === GO_ROOTS[result.Target]) {
      if (Object.hasOwn(item, "Version") || Object.hasOwn(item, "Identifier") || item.ID !== item.Name || item.Relationship !== "root") fail("scanner_fixture_report_invalid");
      return `${item.Name}@`;
    }
    if (typeof item.Version !== "string" || !item.Version) fail("scanner_fixture_report_invalid");
    return `${item.Name}@${item.Version}`;
  });
  if (new Set(packages).size !== packages.length) fail("scanner_fixture_report_invalid");
  const vulnerabilities = result.Vulnerabilities ?? [];
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length > 10_000) fail("scanner_fixture_report_invalid");
  const findings = vulnerabilities.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || [item.VulnerabilityID, item.PkgName, item.InstalledVersion].some((value) => typeof value !== "string" || !value) ||
        item.FixedVersion !== undefined && typeof item.FixedVersion !== "string") fail("scanner_fixture_report_invalid");
    return [result.Target, item.VulnerabilityID, item.PkgName, item.InstalledVersion, item.FixedVersion ?? ""];
  });
  if (findings.some((entry) => !packages.includes(`${entry[2]}@${entry[3]}`))) fail("scanner_fixture_report_invalid");
  if (new Set(findings.map((entry) => JSON.stringify(entry))).size !== findings.length) fail("scanner_fixture_report_invalid");
  return { target: result.Target, type: result.Type, packages, findings };
}

export function validateScannerFixtureReport(fixtureId, report) {
  if (!FIXTURE_IDS.includes(fixtureId) || !report || typeof report !== "object" || Array.isArray(report) ||
      report.SchemaVersion !== 2 || report.ArtifactType !== "filesystem" || report.ArtifactName !== ({
        "gomod-vulnerable": "gomod", "java-war-vulnerable": "test.war", "java-jar-clean-candidate": "jackson-core-2.15.0.jar",
      })[fixtureId] || report.Trivy?.Version !== SCANNER_VERSION || !Array.isArray(report.Results) || report.Results.length === 0 || report.Results.length > 16) fail("scanner_fixture_report_invalid");
  const results = report.Results.map(normalizedResult);
  if (new Set(results.map((entry) => entry.target)).size !== results.length) fail("scanner_fixture_report_invalid");
  if (fixtureId === "gomod-vulnerable") {
    const targets = results.map((entry) => entry.target).sort();
    if (!sameCanonical(targets, ["go.mod", "submod/go.mod", "submod2/go.mod"]) ||
        results.some((entry) => entry.type !== "gomod" || !entry.packages.includes(`${GO_ROOTS[entry.target]}@`))) fail("scanner_fixture_report_invalid");
    const findings = results.flatMap((entry) => entry.findings).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
    const expected = [...GO_FINDINGS].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
    if (!expected.every((entry) => findings.some((actual) => sameCanonical(actual, entry)))) fail("scanner_fixture_report_invalid");
    for (const [target, , packageName, version] of GO_FINDINGS) {
      if (!results.find((entry) => entry.target === target)?.packages.includes(`${packageName}@${version}`)) fail("scanner_fixture_report_invalid");
    }
  } else if (fixtureId === "java-war-vulnerable") {
    if (results.length !== 1 || results[0].target !== "test.war" || results[0].type !== "jar" || !results[0].packages.includes("com.fasterxml.jackson.core:jackson-databind@2.9.10.6") ||
        !results[0].findings.some((entry) => sameCanonical(entry, ["test.war", "CVE-2021-20190", "com.fasterxml.jackson.core:jackson-databind", "2.9.10.6", "2.9.10.7"]))) fail("scanner_fixture_report_invalid");
  } else {
    if (results.length !== 1 || results[0].target !== "jackson-core-2.15.0.jar" || results[0].type !== "jar" ||
        !sameCanonical([...results[0].packages].sort(), CLEAN_JAR_PACKAGES) || results[0].findings.length !== 0) fail("scanner_fixture_report_invalid");
  }
  return Object.freeze({ fixtureId, results });
}

export function scannerFixtureArguments(cacheDirectory, target) {
  if (typeof cacheDirectory !== "string" || !path.isAbsolute(cacheDirectory) || !new Set(["gomod", "test.war", "jackson-core-2.15.0.jar"]).has(target)) fail("scanner_fixture_arguments_invalid");
  return ["fs", "--cache-dir", cacheDirectory, "--skip-db-update", "--skip-java-db-update", "--offline-scan", "--quiet",
    "--cache-backend", "memory", "--scanners", "vuln", "--format", "json", "--list-all-pkgs", target];
}

export async function verifyScannerFixtureReportFile({ fixtureId, reportPath, stdoutIdentity }) {
  if (typeof reportPath !== "string" || !path.isAbsolute(reportPath) || !stdoutIdentity || typeof stdoutIdentity !== "object") fail("scanner_fixture_report_invalid");
  const bytes = await readFileBounded(reportPath, 64 * MiB);
  const identity = { sha256: sha256(bytes), size: bytes.length };
  if (!sameCanonical(identity, stdoutIdentity)) fail("scanner_fixture_report_changed");
  validateScannerFixtureReport(fixtureId, parseBoundedJson(bytes, { maxBytes: 64 * MiB, maxDepth: 32, maxMembers: 100_000 }));
  return Object.freeze({ fixtureId, path: reportPath, ...identity });
}

async function ensureCommittedMaterials(files, workspace) {
  const env = { PATH: "/usr/bin:/bin", HOME: path.join(workspace, "home"), TMPDIR: path.join(workspace, "tmp"), LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const prefix = ["-c", "credential.helper=", "-c", "core.askPass=/bin/false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-C", REPOSITORY_ROOT];
  for (const file of files) {
    const relative = path.relative(REPOSITORY_ROOT, file).replaceAll("\\", "/");
    try {
      await runCommand("/usr/bin/git", [...prefix, "ls-files", "--error-unmatch", "--", relative], { cwd: REPOSITORY_ROOT, env, timeoutMs: 10_000, maxOutputBytes: 64 * 1024 });
      for (const staged of [false, true]) await runCommand("/usr/bin/git", [...prefix, "diff", ...(staged ? ["--cached"] : []), "--no-ext-diff", "--no-textconv", "--quiet", "--exit-code", "--", relative], { cwd: REPOSITORY_ROOT, env, timeoutMs: 10_000, maxOutputBytes: 64 * 1024 });
    } catch { fail("scanner_fixture_material_not_committed"); }
  }
}

function remaining(deadline) {
  const value = deadline - Date.now();
  if (!Number.isSafeInteger(deadline) || value < 1) fail("scanner_fixture_deadline_exceeded");
  return Math.min(10 * 60 * 1000, value);
}

export async function runScannerFixtures({ scanner, cacheDirectory, workspace, environment, deadline }) {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || typeof scanner !== "string" || !path.isAbsolute(scanner) ||
      typeof cacheDirectory !== "string" || !path.isAbsolute(cacheDirectory) || typeof workspace !== "string" || !path.isAbsolute(workspace) ||
      !environment || typeof environment !== "object" || Array.isArray(environment)) fail("scanner_fixtures_require_linux_actions");
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) fail("scanner_fixture_deadline_exceeded");
  if (await realpath(workspace) !== path.resolve(workspace) || await realpath(cacheDirectory) !== path.resolve(cacheDirectory)) fail("scanner_fixture_path_invalid");
  const [scannerStat, workspaceStat, cacheStat] = await Promise.all([lstat(scanner), lstat(workspace), lstat(cacheDirectory)]);
  if (!scannerStat.isFile() || scannerStat.isSymbolicLink() || !workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() || !cacheStat.isDirectory() || cacheStat.isSymbolicLink()) fail("scanner_fixture_path_invalid");
  const scannerIdentity = await hashFileBounded(scanner, 512 * MiB);
  const root = path.join(workspace, "fixtures");
  const fixtures = path.join(root, "materials");
  const reportsDirectory = path.join(root, "reports");
  await mkdir(root, { recursive: false });
  await Promise.all(ARTIFACT_INVENTORY.directories.map((name) => mkdir(path.join(root, name))));
  const scratch = await createOwnedDirectory(path.dirname(workspace));
  try {
    await Promise.all(["home", "tmp", "gopath", "gocache", "gomodcache"].map((name) => mkdir(path.join(scratch.path, name))));
    const materialFiles = MATERIALS.map((entry) => path.join(MATERIAL_ROOT, entry.path));
    await ensureCommittedMaterials([MANIFEST_PATH, ...materialFiles], scratch.path);
    const manifest = await loadScannerFixtureManifest();
    for (const material of MATERIALS) {
      const source = path.join(MATERIAL_ROOT, material.path);
      sameDigest(await hashFileBounded(source, 4 * MiB), material);
      const destination = path.join(fixtures, material.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      sameDigest(await hashFileBounded(destination, 4 * MiB), material);
    }
    const verifyCopiedMaterials = async () => {
      for (const material of MATERIALS) sameDigest(await hashFileBounded(path.join(fixtures, material.path), 4 * MiB), material);
    };
    const env = { ...environment, HOME: path.join(scratch.path, "home"), TMPDIR: path.join(scratch.path, "tmp"),
      GOPATH: path.join(scratch.path, "gopath"), GOCACHE: path.join(scratch.path, "gocache"), GOMODCACHE: path.join(scratch.path, "gomodcache") };
    const scans = [
      { id: "gomod-vulnerable", cwd: fixtures, target: "gomod" },
      { id: "java-war-vulnerable", cwd: path.join(fixtures, "java"), target: "test.war" },
      { id: "java-jar-clean-candidate", cwd: path.join(fixtures, "java"), target: "jackson-core-2.15.0.jar" },
    ];
    const reports = [];
    for (const scan of scans) {
      const result = await runCommand(scanner, scannerFixtureArguments(cacheDirectory, scan.target), {
        cwd: scan.cwd, env, timeoutMs: remaining(deadline), maxOutputBytes: 64 * MiB,
      });
      sameDigest(await hashFileBounded(scanner, 512 * MiB), scannerIdentity);
      await verifyCopiedMaterials();
      const reportPath = path.join(reportsDirectory, `${scan.id}.json`);
      await writeFile(reportPath, result.stdout, { flag: "wx", mode: 0o600 });
      reports.push({ fixtureId: scan.id, path: reportPath,
        stdoutIdentity: Object.freeze({ sha256: sha256(result.stdout), size: result.stdout.length }) });
    }
    const verifiedReports = [];
    for (const report of reports) {
      verifiedReports.push(await verifyScannerFixtureReportFile({
        fixtureId: report.fixtureId, reportPath: report.path, stdoutIdentity: report.stdoutIdentity,
      }));
    }
    await verifyCopiedMaterials();
    await validateScannerFixtureArtifact(await realpath(root));
    return Object.freeze({ directory: await realpath(root), manifest,
      manifestIdentity: Object.freeze({ path: "infra/supply-chain/materials/scanner-fixtures/manifest.json", ...MANIFEST_IDENTITY }),
      materials: Object.freeze(MATERIALS.map(({ path: materialPath, sha256: materialSha256, size }) => Object.freeze({
        path: `materials/${materialPath}`, sha256: materialSha256, size,
      }))),
      reports: Object.freeze(verifiedReports) });
  } finally { await removeOwnedDirectory(scratch); }
}
