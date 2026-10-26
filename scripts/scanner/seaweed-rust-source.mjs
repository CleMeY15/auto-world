import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { candidateDockerArguments } from "./audit.mjs";
import { evaluateImageResults, validateDatabaseMetadata } from "./audit-policy.mjs";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SOURCE_COMMIT = "ffa87c25fdf587178b1521ad87f2a4a72a02e584";
const SCANNER_COMMIT = "e713f67f7d54decdcd9b3132c9751833dcced698";
const SCANNER_VERSION = "0.76.1";
const RAW_HOST = "raw.githubusercontent.com";
const RELATIONSHIPS = "unknown,root,workspace,direct,indirect";
const SOURCE_ROLES = new Set(["volume", "worker"]);
const CONTROL_ROLES = new Set(["cargo-lock-vulnerable", "cargo-lock-clean"]);
const HELPER_PATHS = new Set(["/usr/bin/weed-volume", "/usr/bin/weed-worker"]);
const BASH = "/usr/bin/bash";
const EXPECTED_FILES = new Map([
  ["docker/Dockerfile.go_build", [5807, "d76b78e50d32fecf00cf05179eae7b5c0a4dd8204a0dba3e508b2d29e2be755b", SOURCE_COMMIT]],
  [".github/workflows/container_release_unified.yml", [31251, "4815d65b10e37e466e139d3cd367e409253a23fd1fd892f60735e2b5a0832cb0", SOURCE_COMMIT]],
  ["seaweed-volume/Cargo.lock", [127519, "7720ca362ce66b56f8f043e37720c3c12e0c8e008ec29d9436e2e1ce46b495f2", SOURCE_COMMIT]],
  ["seaweed-volume/Cargo.toml", [5209, "0797f3b93f6da3c1fb29f709476234c040fc49c04c35a7954fa2aa3fc2d1a8ec", SOURCE_COMMIT]],
  ["seaweed-volume/vendor/reed-solomon-erasure/Cargo.toml", [1883, "1ce8d14fa12d4118cc3bc2ab9ea0480e16f87cf1b8bb3a56bdca4b377cd9d53b", SOURCE_COMMIT]],
  ["seaweed-worker/Cargo.lock", [162159, "a9b48631597bda1a2dd8d79f5f871764f29685ad8484fc394955ae4dd39108bb", SOURCE_COMMIT]],
  ["seaweed-worker/Cargo.toml", [1511, "8d0553e201639de4b45b638604ae83e9cc7b98450e46c01aa738892298c60153", SOURCE_COMMIT]],
  ["seaweed-worker/crates/core/Cargo.toml", [1220, "5ef4d1a569174001680bea5147557d36ce0109efbda1689027ca80a3f68263dc", SOURCE_COMMIT]],
  ["seaweed-worker/crates/lance/Cargo.toml", [1939, "fecbc8ec5ba23e1e2162d3aec276791a602fa7519793cf23afa6e57b5b8e1a45", SOURCE_COMMIT]],
  ["seaweed-worker/crates/sort/Cargo.toml", [336, "7cb4f17941b6566768987d662e71db9083b9306bec4451c0537fb29f3fc4a941", SOURCE_COMMIT]],
  ["seaweed-common/Cargo.toml", [1315, "62eee6e166744e06ee26f19088e0c61cd338f3ccce2faee52fdf5d43b20ac583", SOURCE_COMMIT]],
  ["integration/testdata/fixtures/repo/trivy-ci-test/Cargo.lock", [30526, "bdd6b5e1d9700326d43bf3ad586c130ac1f883d634d127f841bf7707e2350117", SCANNER_COMMIT]],
  ["integration/testdata/fixtures/repo/cargo/Cargo.lock", [2186, "f8e887c771fb2cfdd969dd97469e11bca8c7cbb9d65ebcd9faaa20d96b9988a6", SCANNER_COMMIT]],
]);
const EXPECTED_INVENTORIES = new Map([
  ["cargo-lock-vulnerable", [74, 1696, "11fb06dd4a7db051a69b07a5d9d24eeff35e2e9d47398c7d662b101a8307f316"]],
  ["cargo-lock-clean", [10, 244, "8077301894e5afb55bb49240f515989fd600588a0fd4f093b5182ba645aa8ea5"]],
  ["volume", [498, 12234, "2cc9985b29f8de9fb6ee0228b3d6acafa7de38a8d8eb163d9ec9c3356c0f4a79"]],
  ["worker", [590, 14985, "750e245f91a9f8d26bd4958b1a06e1d72c7028545ed697e71befc7243f0d9343"]],
]);
const EXPECTED_ROLE_DETAILS = new Map([
  ["volume", { lockPath: "seaweed-volume/Cargo.lock", localPackages: [["reed-solomon-erasure", "6.0.0"], ["seaweed-common", "0.1.0"], ["weed-volume", "0.1.0"]],
    declaredBuildProfile: "--no-default-features", helper: ["/usr/bin/weed-volume", "weed-volume-normal-amd64", 40128576,
      "48c7397e7d1802d9728ac7bdfcf30454cb6fb50bb0098b79e88f9b3eaeddc3e4", 0o755] }],
  ["worker", { lockPath: "seaweed-worker/Cargo.lock", localPackages: [["seaweed-common", "0.1.0"], ["seaweed-worker-core", "0.1.0"],
    ["seaweed-worker-sort", "0.1.0"], ["weed-lance-worker", "0.1.0"]], declaredBuildProfile: "-p weed-lance-worker",
    helper: ["/usr/bin/weed-worker", "weed-worker-amd64", 252992824,
      "2f7bd0db4811d463f4fc7278d2a6a336e1adfcb54124ecc79b67dbcab0ba149b", 0o755] }],
]);

function fail(code) { throw new Error(code); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, keys) {
  return object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function safeAbsolute(value) {
  return typeof value === "string" && path.isAbsolute(value) && !/[\0,\r\n]/u.test(value);
}
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fixedEntry(metadata, role) {
  const collection = CONTROL_ROLES.has(role) ? metadata.controls : metadata.roles;
  const matches = collection.filter((entry) => entry.role === role);
  if (matches.length !== 1) fail("scanner_seaweed_rust_metadata_invalid");
  return matches[0];
}
function fixedFile(metadata, relative) {
  const matches = metadata.files.filter((entry) => entry.path === relative);
  if (matches.length !== 1) fail("scanner_seaweed_rust_metadata_invalid");
  return matches[0];
}
function canonicalPairs(pairs, expectedCount, expectedBytes, expectedSha256) {
  if (!Array.isArray(pairs) || pairs.length !== expectedCount) fail("scanner_seaweed_rust_inventory_mismatch");
  const identities = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || pair.some((item) => typeof item !== "string" ||
        !/^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/u.test(item))) fail("scanner_seaweed_rust_inventory_mismatch");
    identities.push(JSON.stringify(pair));
  }
  if (new Set(identities).size !== identities.length) fail("scanner_seaweed_rust_inventory_mismatch");
  const sorted = pairs.map((pair) => [...pair]).sort(([leftName, leftVersion], [rightName, rightVersion]) => {
    if (leftName < rightName) return -1;
    if (leftName > rightName) return 1;
    if (leftVersion < rightVersion) return -1;
    if (leftVersion > rightVersion) return 1;
    return 0;
  });
  const bytes = Buffer.from(`${JSON.stringify(sorted)}\n`, "utf8");
  if (bytes.length !== expectedBytes || hash(bytes) !== expectedSha256) fail("scanner_seaweed_rust_inventory_mismatch");
  return { pairs: sorted, bytes: bytes.length, sha256: expectedSha256 };
}
function reportPackages(report, entry, artifactName) {
  if (!object(report) || report.SchemaVersion !== 2 || report.Trivy?.Version !== SCANNER_VERSION ||
      report.ArtifactType !== "filesystem" || report.ArtifactName !== artifactName || !Array.isArray(report.Results) ||
      report.Results.length !== 1) fail("scanner_seaweed_rust_report_invalid");
  const result = report.Results[0];
  if (!object(result) || result.Target !== "Cargo.lock" || result.Class !== "lang-pkgs" || result.Type !== "cargo" ||
      !Array.isArray(result.Packages) || result.Packages.length !== entry.packageCount ||
      result.Vulnerabilities !== undefined && !Array.isArray(result.Vulnerabilities)) fail("scanner_seaweed_rust_report_invalid");
  return { result, pairs: result.Packages.map((item) => {
    if (!object(item) || typeof item.Name !== "string" || typeof item.Version !== "string") fail("scanner_seaweed_rust_report_invalid");
    return [item.Name, item.Version];
  }) };
}
function sbomProperty(component, name) {
  if (!Array.isArray(component?.properties)) fail("scanner_seaweed_rust_sbom_invalid");
  const matches = component.properties.filter((entry) => entry?.name === name);
  if (matches.length !== 1 || typeof matches[0].value !== "string") fail("scanner_seaweed_rust_sbom_invalid");
  return matches[0].value;
}
function sbomPackages(sbom, entry, artifactName) {
  if (!object(sbom) || sbom.bomFormat !== "CycloneDX" || !/^1\.[4-7]$/u.test(sbom.specVersion ?? "") ||
      sbom.metadata?.component?.type !== "filesystem" || sbom.metadata.component.name !== artifactName ||
      typeof sbom.metadata.component["bom-ref"] !== "string" || !sbom.metadata.component["bom-ref"] ||
      !Array.isArray(sbom.components) || sbom.components.length !== entry.packageCount + 1 || !Array.isArray(sbom.dependencies)) {
    fail("scanner_seaweed_rust_sbom_invalid");
  }
  const references = new Set();
  for (const component of sbom.components) {
    if (typeof component?.["bom-ref"] !== "string" || references.has(component["bom-ref"])) fail("scanner_seaweed_rust_sbom_invalid");
    references.add(component["bom-ref"]);
  }
  if (references.has(sbom.metadata.component["bom-ref"])) fail("scanner_seaweed_rust_sbom_invalid");
  references.add(sbom.metadata.component["bom-ref"]);
  const dependencyRefs = new Set();
  for (const dependency of sbom.dependencies) {
    if (typeof dependency?.ref !== "string" || dependencyRefs.has(dependency.ref) || !references.has(dependency.ref) ||
        !Array.isArray(dependency.dependsOn) || new Set(dependency.dependsOn).size !== dependency.dependsOn.length ||
        dependency.dependsOn.some((reference) => typeof reference !== "string" || !references.has(reference))) fail("scanner_seaweed_rust_sbom_invalid");
    dependencyRefs.add(dependency.ref);
  }
  const applications = sbom.components.filter((component) => component.type === "application" &&
    sbomProperty(component, "aquasecurity:trivy:Class") === "lang-pkgs" &&
    sbomProperty(component, "aquasecurity:trivy:Type") === "cargo");
  if (applications.length !== 1 || typeof applications[0].name !== "string" || !applications[0].name.endsWith("Cargo.lock") ||
      !dependencyRefs.has(applications[0]["bom-ref"]) ||
      dependencyRefs.size !== references.size) {
    fail("scanner_seaweed_rust_sbom_invalid");
  }
  const libraries = sbom.components.filter((component) => {
    if (component.type !== "library") return false;
    if (!Array.isArray(component.properties)) fail("scanner_seaweed_rust_sbom_invalid");
    return component.properties.some((property) => property?.name === "aquasecurity:trivy:PkgType" && property.value === "cargo");
  });
  if (libraries.length !== entry.packageCount) fail("scanner_seaweed_rust_sbom_invalid");
  if (libraries.some((component) => !dependencyRefs.has(component["bom-ref"]))) fail("scanner_seaweed_rust_sbom_invalid");
  const pairs = libraries.map((component) => {
    if (typeof component.name !== "string" || typeof component.version !== "string") fail("scanner_seaweed_rust_sbom_invalid");
    return [component.name, component.version];
  });
  return pairs;
}
function validateFreshReport(report, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail("scanner_seaweed_rust_report_invalid");
  try { validateDatabaseMetadata({ Version: 2, UpdatedAt: report.CreatedAt, DownloadedAt: report.CreatedAt }, { now, database: "vulnerability" }); }
  catch { fail("scanner_seaweed_rust_report_invalid"); }
}

export function validateSeaweedRustSourceLock(metadata, officialConfig) {
  if (!exactKeys(metadata, ["schemaVersion", "state", "evidenceClass", "source", "image", "files", "controls", "roles", "limitations"]) ||
      metadata.schemaVersion !== 1 || metadata.state !== "DIAGNOSTIC_ONLY_NOT_ADMITTED" ||
      metadata.evidenceClass !== "SOURCE_LOCK_AUDIT_AND_ARTIFACT_TO_IMAGE_IDENTITY" ||
      !exactKeys(metadata.source, ["repository", "commit", "rawHost"]) || metadata.source.repository !== "seaweedfs/seaweedfs" ||
      metadata.source.commit !== SOURCE_COMMIT || metadata.source.rawHost !== RAW_HOST ||
      !exactKeys(metadata.image, ["repository", "manifestDigest", "platformDigest", "configDigest", "os", "architecture"]) ||
      metadata.image.repository !== "chrislusf/seaweedfs" || metadata.image.manifestDigest !== "sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8" ||
      metadata.image.platformDigest !== "sha256:3a522c379599e163433a636e75022630848b63a74f08ea37bf06f8d776e9a707" ||
      metadata.image.configDigest !== "sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6" ||
      metadata.image.os !== "linux" || metadata.image.architecture !== "amd64") fail("scanner_seaweed_rust_metadata_invalid");
  const seaweed = officialConfig?.images?.filter((image) => image?.role === "seaweedfs");
  if (!Array.isArray(seaweed) || seaweed.length !== 1 || seaweed[0].repository !== metadata.image.repository ||
      seaweed[0].manifestDigest !== metadata.image.manifestDigest || seaweed[0].platform?.digest !== metadata.image.platformDigest ||
      seaweed[0].platform.os !== metadata.image.os || seaweed[0].platform.architecture !== metadata.image.architecture ||
      seaweed[0].source?.repository !== metadata.source.repository || seaweed[0].source.commit !== metadata.source.commit) {
    fail("scanner_seaweed_rust_metadata_invalid");
  }
  if (!Array.isArray(metadata.files) || metadata.files.length !== 13 || !Array.isArray(metadata.controls) || metadata.controls.length !== 2 ||
      !Array.isArray(metadata.roles) || metadata.roles.length !== 2 ||
      JSON.stringify(metadata.files.map((entry) => entry?.path)) !== JSON.stringify([...EXPECTED_FILES.keys()]) ||
      JSON.stringify(metadata.controls.map((entry) => entry?.role)) !== JSON.stringify(["cargo-lock-vulnerable", "cargo-lock-clean"]) ||
      JSON.stringify(metadata.roles.map((entry) => entry?.role)) !== JSON.stringify(["volume", "worker"])) fail("scanner_seaweed_rust_metadata_invalid");
  const paths = new Set();
  for (const file of metadata.files) {
    const expected = EXPECTED_FILES.get(file?.path);
    if (!exactKeys(file, ["path", "bytes", "sha256", "sourceCommit"]) || typeof file.path !== "string" || path.isAbsolute(file.path) ||
        file.path.split("/").some((part) => !part || [".", ".."].includes(part)) || paths.has(file.path) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > MiB || !SHA256.test(file.sha256) ||
        !expected || file.bytes !== expected[0] || file.sha256 !== expected[1] || file.sourceCommit !== expected[2]) fail("scanner_seaweed_rust_metadata_invalid");
    paths.add(file.path);
  }
  for (const control of metadata.controls) {
    const expected = EXPECTED_INVENTORIES.get(control?.role);
    const expectedPath = control?.role === "cargo-lock-vulnerable" ? "integration/testdata/fixtures/repo/trivy-ci-test/Cargo.lock" :
      "integration/testdata/fixtures/repo/cargo/Cargo.lock";
    if (!exactKeys(control, ["role", "lockPath", "packageCount", "canonicalInventoryBytes", "canonicalInventorySha256", "expectedFinding"]) ||
        !CONTROL_ROLES.has(control.role) || !paths.has(control.lockPath) || !Number.isSafeInteger(control.packageCount) || control.packageCount < 1 ||
        !Number.isSafeInteger(control.canonicalInventoryBytes) || control.canonicalInventoryBytes < 1 || !SHA256.test(control.canonicalInventorySha256) ||
        !expected || control.lockPath !== expectedPath || control.packageCount !== expected[0] || control.canonicalInventoryBytes !== expected[1] ||
        control.canonicalInventorySha256 !== expected[2]) {
      fail("scanner_seaweed_rust_metadata_invalid");
    }
    if (control.role === "cargo-lock-clean" && control.expectedFinding !== null) fail("scanner_seaweed_rust_metadata_invalid");
    if (control.role === "cargo-lock-vulnerable" && (!exactKeys(control.expectedFinding, ["package", "installedVersion", "severity", "fixedVersion", "advisoryIds"]) ||
        control.expectedFinding.package !== "ammonia" || control.expectedFinding.installedVersion !== "1.9.0" || control.expectedFinding.severity !== "HIGH" ||
        control.expectedFinding.fixedVersion !== "2.1.0" || JSON.stringify(control.expectedFinding.advisoryIds) !==
        JSON.stringify(["RUSTSEC-2019-0001", "CVE-2019-15542", "GHSA-5hp8-35wj-m525"]))) fail("scanner_seaweed_rust_metadata_invalid");
  }
  for (const role of metadata.roles) {
    const expected = EXPECTED_INVENTORIES.get(role?.role);
    const details = EXPECTED_ROLE_DETAILS.get(role?.role);
    if (!exactKeys(role, ["role", "lockPath", "packageCount", "canonicalInventoryBytes", "canonicalInventorySha256", "localPackages", "declaredBuildProfile", "helper"]) ||
        !SOURCE_ROLES.has(role.role) || !paths.has(role.lockPath) || !Number.isSafeInteger(role.packageCount) || role.packageCount < 1 ||
        !Number.isSafeInteger(role.canonicalInventoryBytes) || role.canonicalInventoryBytes < 1 || !SHA256.test(role.canonicalInventorySha256) || !expected ||
        role.packageCount !== expected[0] || role.canonicalInventoryBytes !== expected[1] || role.canonicalInventorySha256 !== expected[2] ||
        !Array.isArray(role.localPackages) || role.localPackages.length < 1 || typeof role.declaredBuildProfile !== "string" || !details ||
        role.lockPath !== details.lockPath || JSON.stringify(role.localPackages) !== JSON.stringify(details.localPackages) ||
        role.declaredBuildProfile !== details.declaredBuildProfile ||
        !exactKeys(role.helper, ["path", "artifactName", "bytes", "sha256", "mode"]) || !HELPER_PATHS.has(role.helper.path) ||
        !Number.isSafeInteger(role.helper.bytes) || role.helper.bytes < 1 || role.helper.bytes > 512 * MiB || !SHA256.test(role.helper.sha256) ||
        JSON.stringify([role.helper.path, role.helper.artifactName, role.helper.bytes, role.helper.sha256, role.helper.mode]) !== JSON.stringify(details.helper)) {
      fail("scanner_seaweed_rust_metadata_invalid");
    }
    canonicalPairs(role.localPackages, role.localPackages.length,
      Buffer.byteLength(`${JSON.stringify([...role.localPackages].sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))}\n`),
      hash(Buffer.from(`${JSON.stringify([...role.localPackages].sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))}\n`)));
  }
  if (new Set(metadata.controls.map(({ role }) => role)).size !== 2 || new Set(metadata.roles.map(({ role }) => role)).size !== 2 ||
      !exactKeys(metadata.limitations, ["lockUniverseInventory", "intrinsicBinaryInventory", "sourceToBinaryEquivalence", "signerTrust", "advisoryCoverage", "admission", "milestone2", "supportStart", "supportEnd"]) ||
      metadata.limitations.intrinsicBinaryInventory !== "NOT_ESTABLISHED" || metadata.limitations.sourceToBinaryEquivalence !== "NOT_ESTABLISHED" ||
      metadata.limitations.signerTrust !== "NOT_ESTABLISHED" || metadata.limitations.admission !== "NOT_AUTHORIZED" ||
      metadata.limitations.lockUniverseInventory !== "COMPLETE_AGAINST_EXACT_LOCK_ONLY_AFTER_ACTUAL_PASS" ||
      metadata.limitations.advisoryCoverage !== "SCANNER_SUPPORTED_IDENTITIES_ONLY" || metadata.limitations.milestone2 !== "NOT_ESTABLISHED" ||
      metadata.limitations.supportStart !== null || metadata.limitations.supportEnd !== null) {
    fail("scanner_seaweed_rust_metadata_invalid");
  }
  return metadata;
}

export function seaweedRustSourceFetchArguments(entry, destination) {
  if (!exactKeys(entry, ["path", "bytes", "sha256", "sourceCommit"]) || !safeAbsolute(destination) ||
      path.basename(destination) !== path.basename(entry.path) || ![SOURCE_COMMIT, SCANNER_COMMIT].includes(entry.sourceCommit) ||
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MiB || !SHA256.test(entry.sha256)) {
    fail("scanner_seaweed_rust_arguments_invalid");
  }
  const encoded = entry.path.split("/").map(encodeURIComponent).join("/");
  return { command: "/usr/bin/curl", timeoutMs: 90_000,
    args: ["--fail", "--silent", "--show-error", "--proto", "=https", "--proto-redir", "=https", "--max-redirs", "0",
      "--max-filesize", String(MiB), "--connect-timeout", "15", "--max-time", "60", "--output", destination,
      `https://${RAW_HOST}/${entry.sourceCommit === SOURCE_COMMIT ? "seaweedfs/seaweedfs" : "aquasecurity/trivy"}/${entry.sourceCommit}/${encoded}`] };
}

export function validateSeaweedRustPublicSourceMapping({ metadata, originals, copies }) {
  if (!Array.isArray(originals) || originals.length !== EXPECTED_FILES.size || !Array.isArray(copies) ||
      copies.length !== EXPECTED_FILES.size || !Array.isArray(metadata?.files) || metadata.files.length !== EXPECTED_FILES.size) {
    fail("scanner_seaweed_rust_public_source_invalid");
  }
  const expectedPaths = [...EXPECTED_FILES.keys()];
  return metadata.files.map((entry, index) => {
    const original = originals[index], copy = copies[index];
    if (!exactKeys(entry, ["path", "bytes", "sha256", "sourceCommit"])) fail("scanner_seaweed_rust_public_source_invalid");
    const expected = EXPECTED_FILES.get(entry?.path);
    let publicPath = entry.path;
    if (publicPath.endsWith("Cargo.lock") || publicPath === "docker/Dockerfile.go_build" ||
        publicPath.endsWith("container_release_unified.yml")) publicPath = `${publicPath}.txt`;
    if (!expected ||
        entry.bytes !== expected[0] || entry.sha256 !== expected[1] || entry.sourceCommit !== expected[2] ||
        !exactKeys(original, ["path", "size", "sha256"]) || !exactKeys(copy, ["path", "size", "sha256"]) ||
        typeof original.path !== "string" || typeof copy.path !== "string" || entry.path !== expectedPaths[index] ||
        path.isAbsolute(original.path) || path.isAbsolute(copy.path) ||
        original.path !== entry.path || copy.path !== publicPath ||
        original.size !== entry.bytes || copy.size !== entry.bytes || original.sha256 !== entry.sha256 || copy.sha256 !== entry.sha256) {
      fail("scanner_seaweed_rust_public_source_invalid");
    }
    return { originalPath: entry.path, publicPath, bytes: entry.bytes, sha256: entry.sha256 };
  });
}

export function prepareSeaweedRustLockViews({ metadata, sourceRoot, viewsRoot }) {
  if (!safeAbsolute(sourceRoot) || !safeAbsolute(viewsRoot) || existsSync(viewsRoot) ||
      realpathSync(sourceRoot) !== sourceRoot || realpathSync(path.dirname(viewsRoot)) !== path.dirname(viewsRoot)) fail("scanner_seaweed_rust_view_invalid");
  const allowed = new Set(metadata.files.map(({ path: relative }) => relative));
  const originals = [];
  for (const entry of metadata.files) {
    const file = path.join(sourceRoot, ...entry.path.split("/"));
    const relative = path.relative(sourceRoot, file).replaceAll(path.sep, "/");
    if (relative !== entry.path || !allowed.has(relative)) fail("scanner_seaweed_rust_source_invalid");
    const info = lstatSync(file);
    const bytes = readFileSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== entry.bytes || bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) {
      fail("scanner_seaweed_rust_source_invalid");
    }
    originals.push({ path: file, size: bytes.length, sha256: entry.sha256, cap: MiB });
  }
  mkdirSync(viewsRoot, { mode: 0o700 });
  const views = [];
  for (const entry of [...metadata.controls, ...metadata.roles]) {
    const directory = path.join(viewsRoot, entry.role);
    mkdirSync(directory, { mode: 0o700 });
    const source = path.join(sourceRoot, ...entry.lockPath.split("/"));
    const target = path.join(directory, "Cargo.lock");
    copyFileSync(source, target, 0);
    chmodSync(target, 0o444); chmodSync(directory, 0o555);
    const names = readdirSync(directory);
    const info = lstatSync(target); const bytes = readFileSync(target); const expected = fixedFile(metadata, entry.lockPath);
    if (names.length !== 1 || names[0] !== "Cargo.lock" || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
        bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) fail("scanner_seaweed_rust_view_invalid");
    views.push({ role: entry.role, path: directory, artifactName: `/${entry.role}`, lock: { path: target, size: bytes.length, sha256: expected.sha256, cap: MiB } });
  }
  chmodSync(viewsRoot, 0o555);
  return { originals, views };
}

export function seaweedRustScanArguments({ carrier, scanner, cache, view, format = "json" }) {
  if (!safeAbsolute(view) || !["json", "cyclonedx"].includes(format)) fail("scanner_seaweed_rust_arguments_invalid");
  const extra = ["--offline-scan", "--pkg-types", "library", "--pkg-relationships", RELATIONSHIPS,
    ...(format === "json" ? ["--severity", "HIGH,CRITICAL"] : ["--scanners", "vuln"] )];
  const args = candidateDockerArguments({ carrier, scanner, cache, mode: "fs", target: view, format, extra });
  const count = (value) => args.filter((item) => item === value).length;
  for (const flag of ["--offline-scan", "--pkg-types", "--pkg-relationships", "--scanners", "--skip-db-update", "--skip-java-db-update", "--skip-version-check", "--list-all-pkgs"]) {
    if (count(flag) !== 1) fail("scanner_seaweed_rust_arguments_invalid");
  }
  if (args[args.indexOf("--pkg-relationships") + 1] !== RELATIONSHIPS ||
      ["--skip-files", "--skip-dirs", "--ignorefile", "--ignore-unfixed", "--include-dev-deps"].some((flag) => args.includes(flag)) ||
      count("--severity") !== (format === "json" ? 1 : 0)) fail("scanner_seaweed_rust_arguments_invalid");
  return args;
}

export function validateSeaweedRustControlReport({ control, report, metadata, artifactName, now = new Date() }) {
  if (!CONTROL_ROLES.has(control) || typeof artifactName !== "string" || artifactName !== `/${control}`) fail("scanner_seaweed_rust_report_invalid");
  const entry = fixedEntry(metadata, control);
  const { result, pairs } = reportPackages(report, entry, artifactName);
  validateFreshReport(report, now);
  const inventory = canonicalPairs(pairs, entry.packageCount, entry.canonicalInventoryBytes, entry.canonicalInventorySha256);
  const evaluated = evaluateImageResults(report.Results, { imageDigest: metadata.image.platformDigest, dispositions: [], now });
  if (control === "cargo-lock-clean") {
    if (evaluated.findings.length || evaluated.blockers.length) fail("scanner_seaweed_rust_control_blocked");
  } else {
    const expected = entry.expectedFinding;
    const matches = (result.Vulnerabilities ?? []).filter((finding) => expected.advisoryIds.includes(finding?.VulnerabilityID) &&
      finding.PkgName === expected.package && finding.InstalledVersion === expected.installedVersion && finding.Severity === expected.severity &&
      finding.FixedVersion === expected.fixedVersion);
    const matchingBlockers = evaluated.blockers.filter((finding) => expected.advisoryIds.includes(finding.vulnerabilityId) &&
      finding.packageName === expected.package && finding.installedVersion === expected.installedVersion && finding.severity === expected.severity &&
      finding.fixedVersion === expected.fixedVersion && finding.code === "image_vulnerability_blocked");
    if (matches.length !== 1 || matchingBlockers.length !== 1) {
      fail("scanner_seaweed_rust_control_blocked");
    }
  }
  return { role: control, result: "passed", evidenceClass: "RUST_ADVISORY_CONTROL", inventory,
    findingCount: evaluated.findings.length, blockerCount: evaluated.blockers.length };
}

export function validateSeaweedRustLockUniverse({ role, report, sbom, metadata, artifactName, now = new Date() }) {
  if (!SOURCE_ROLES.has(role) || artifactName !== `/${role}`) fail("scanner_seaweed_rust_report_invalid");
  const entry = fixedEntry(metadata, role);
  const { pairs } = reportPackages(report, entry, artifactName);
  validateFreshReport(report, now);
  const jsonInventory = canonicalPairs(pairs, entry.packageCount, entry.canonicalInventoryBytes, entry.canonicalInventorySha256);
  const cdxInventory = canonicalPairs(sbomPackages(sbom, entry, artifactName), entry.packageCount,
    entry.canonicalInventoryBytes, entry.canonicalInventorySha256);
  if (JSON.stringify(jsonInventory.pairs) !== JSON.stringify(cdxInventory.pairs)) fail("scanner_seaweed_rust_inventory_mismatch");
  for (const expected of entry.localPackages) {
    if (jsonInventory.pairs.filter((pair) => pair[0] === expected[0] && pair[1] === expected[1]).length !== 1) fail("scanner_seaweed_rust_inventory_mismatch");
  }
  const evaluated = evaluateImageResults(report.Results, { imageDigest: metadata.image.platformDigest, dispositions: [], now });
  return { role, result: evaluated.blockers.length ? "rejected" : "passed", evidenceClass: "SOURCE_LOCK_AUDIT", scope: "LOCK_UNIVERSE",
    helperRole: role, lockPath: entry.lockPath, lockSha256: fixedFile(metadata, entry.lockPath).sha256,
    contextImageDigest: metadata.image.platformDigest, packageCount: entry.packageCount, inventorySha256: jsonInventory.sha256,
    findings: evaluated.findings, blockers: evaluated.blockers, limitations: metadata.limitations };
}

export function helperContainerCreateArguments({ name, owner, imageId }) {
  if (!/^aw-seaweed-rust-[a-f0-9-]{36}$/u.test(name ?? "") || !/^[a-f0-9-]{36}$/u.test(owner ?? "") || !DIGEST.test(imageId ?? "")) {
    fail("scanner_seaweed_rust_helper_arguments_invalid");
  }
  return ["container", "create", "--name", name, "--label", `io.auto-world.seaweed-rust=${owner}`, "--pull=never", "--platform", "linux/amd64",
    "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true", "--user", "1000:1000",
    "--pids-limit", "16", "--memory", "64m", "--memory-swap", "64m", "--cpus", "1", imageId];
}

function helperEnvironment({ home, temporary }) {
  if (!safeAbsolute(home) || !safeAbsolute(temporary)) fail("scanner_seaweed_rust_helper_arguments_invalid");
  return { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: home, TMPDIR: temporary,
    TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
}

export function helperSoftLimitControlCommand({ directory, home = directory, temporary = directory }) {
  if (!safeAbsolute(directory)) fail("scanner_seaweed_rust_helper_arguments_invalid");
  const within = path.join(directory, "soft-limit-within.bin"), overflow = path.join(directory, "soft-limit-overflow.bin");
  const script = "set -euo pipefail; unset BASH_ENV ENV POSIXLY_CORRECT; set +o posix; " +
    "ulimit -Sf 2; test \"$(ulimit -Sf)\" = 2; /usr/bin/head -c 2048 /dev/zero > \"$1\"; " +
    "if /usr/bin/head -c 3072 /dev/zero > \"$2\" 2>/dev/null; then exit 71; fi; " +
    "test \"$(/usr/bin/stat -c %s -- \"$1\")\" = 2048; test \"$(/usr/bin/stat -c %s -- \"$2\")\" -le 2048; printf 'soft-limit-control=passed\\n'";
  return { command: BASH, args: ["--noprofile", "--norc", "-c", script, "aw-soft-limit-control", within, overflow],
    environment: helperEnvironment({ home, temporary }), timeoutMs: 30_000, expectedStdout: "soft-limit-control=passed\n" };
}

export function helperCopyCommand({ containerName, sourcePath, destination, expectedBytes, home, temporary }) {
  if (!/^aw-seaweed-rust-[a-f0-9-]{36}$/u.test(containerName ?? "") || !HELPER_PATHS.has(sourcePath) || !safeAbsolute(destination) ||
      existsSync(destination) || !Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 512 * MiB) {
    fail("scanner_seaweed_rust_helper_arguments_invalid");
  }
  const blocks = Math.ceil((expectedBytes + 1) / 1024);
  const script = "set -euo pipefail; unset BASH_ENV ENV POSIXLY_CORRECT; set +o posix; " +
    "blocks=$1; hard=$(ulimit -Hf); test \"$hard\" = unlimited || test \"$hard\" -ge \"$blocks\"; " +
    "ulimit -Sf \"$blocks\"; test \"$(ulimit -Sf)\" = \"$blocks\"; " +
    "exec /usr/bin/docker container cp -q \"$2:$3\" \"$4\"";
  return { command: BASH, args: ["--noprofile", "--norc", "-c", script, "aw-helper-copy", String(blocks), containerName, sourcePath, destination],
    environment: helperEnvironment({ home, temporary }), timeoutMs: 90_000, expectedStdout: "" };
}

export function validateSeaweedRustHelperContainer({ inspected, name, owner, imageId }) {
  if (!Array.isArray(inspected) || inspected.length !== 1) fail("scanner_seaweed_rust_helper_container_invalid");
  const value = inspected[0];
  if (!/^aw-seaweed-rust-[a-f0-9-]{36}$/u.test(name ?? "") || !/^[a-f0-9-]{36}$/u.test(owner ?? "") || !DIGEST.test(imageId ?? "") ||
      value?.Name !== `/${name}` || !/^[a-f0-9]{64}$/u.test(value.Id ?? "") || value.Image !== imageId ||
      value.Config?.Labels?.["io.auto-world.seaweed-rust"] !== owner || value.State?.Status !== "created" || value.State.Running !== false ||
      value.State.Pid !== 0 || value.State.Restarting !== false || value.State.Dead !== false ||
      !["", "0001-01-01T00:00:00Z"].includes(value.State.StartedAt) || !Array.isArray(value.Mounts)) {
    fail("scanner_seaweed_rust_helper_container_invalid");
  }
  const volumes = [];
  for (const mount of value.Mounts) {
    if (typeof mount?.Destination !== "string" || mount.Destination === "/usr" || HELPER_PATHS.has(mount.Destination) || mount.Destination.startsWith("/usr/")) {
      fail("scanner_seaweed_rust_helper_container_invalid");
    }
    if (mount.Type === "volume") {
      if (!/^[a-f0-9]{64}$/u.test(mount.Name ?? "") || mount.Destination !== "/data") fail("scanner_seaweed_rust_helper_container_invalid");
      volumes.push(mount.Name);
    } else if (mount.Type !== "tmpfs") fail("scanner_seaweed_rust_helper_container_invalid");
  }
  return { containerId: value.Id, anonymousVolumes: volumes };
}

export function helperContainerRemoveArguments(containerId) {
  if (!/^[a-f0-9]{64}$/u.test(containerId ?? "")) fail("scanner_seaweed_rust_helper_arguments_invalid");
  return ["container", "rm", "--volumes", containerId];
}

export function validateSeaweedRustHelperAbsence(result, name, anonymousVolumes = []) {
  if (!/^aw-seaweed-rust-[a-f0-9-]{36}$/u.test(name ?? "") || !Array.isArray(anonymousVolumes) ||
      anonymousVolumes.some((volume) => !/^[a-f0-9]{64}$/u.test(volume)) || new Set(anonymousVolumes).size !== anonymousVolumes.length) return false;
  const absent = (value, messages) => {
    if (!object(value)) return false;
    const stderr = Buffer.isBuffer(value.stderr) ? value.stderr.toString("utf8").trim() : String(value.stderr ?? "").trim();
    return !value.error && value.status === 1 && value.signal === null && messages.includes(stderr);
  };
  const container = anonymousVolumes.length ? result?.container : result;
  if (!absent(container, [`Error response from daemon: No such container: ${name}`, `Error: No such object: ${name}`])) return false;
  if (!anonymousVolumes.length) return true;
  if (!exactKeys(result, ["container", "volumes"]) || !Array.isArray(result.volumes) || result.volumes.length !== anonymousVolumes.length) return false;
  return result.volumes.every((value, index) => absent(value, [
    `Error response from daemon: get ${anonymousVolumes[index]}: no such volume`,
    `Error: No such volume: ${anonymousVolumes[index]}`,
  ]));
}

export function validateSeaweedRustHelperMeasurement({ role, file, info, identity, metadata }) {
  const entry = fixedEntry(metadata, role);
  if (!SOURCE_ROLES.has(role) || !safeAbsolute(file) || path.basename(file) !== path.basename(entry.helper.path) ||
      !object(info) || info.isFile !== true || info.isSymbolicLink !== false || info.nlink !== 1 || info.mode !== entry.helper.mode ||
      !object(identity) || identity.size !== entry.helper.bytes || identity.sha256 !== entry.helper.sha256) {
    fail("scanner_seaweed_rust_helper_measurement_invalid");
  }
  return { role, result: "passed", evidenceClass: "ARTIFACT_TO_IMAGE_IDENTITY", imageDigest: metadata.image.platformDigest,
    helperPath: entry.helper.path, artifactName: entry.helper.artifactName, bytes: identity.size, sha256: identity.sha256,
    hostCopyMode: info.mode, hostCopyNlink: info.nlink, intrinsicBinaryInventory: "NOT_ESTABLISHED", sourceToBinaryEquivalence: "NOT_ESTABLISHED" };
}

export function combineSeaweedRustGate({ originalReports, controls, sourceAudits, helpers, managedBuilds }) {
  const passed = (entries, count) => Array.isArray(entries) && entries.length === count && entries.every((entry) => entry?.result === "passed");
  if (!passed(originalReports, 5) || originalReports.some((entry) => entry.findingCount !== 0 || entry.blockerCount !== 0) ||
      !passed(controls, 2) || !passed(sourceAudits, 2) || sourceAudits.some((entry) => entry.blockers?.length !== 0) ||
      !passed(helpers, 2) || !passed(managedBuilds, 3) || managedBuilds.some((entry) => entry.evidenceExport !== "passed")) {
    fail("scanner_seaweed_rust_gate_incomplete");
  }
  return { result: "passed", runtimeEligibleDiagnosticOnly: true, admission: "NOT_AUTHORIZED", milestone2: "NOT_ESTABLISHED" };
}

export function validateSeaweedRustPublicEvidence(value, metadata) {
  if (!exactKeys(value, ["schemaVersion", "state", "admission", "milestone2", "controls", "sourceAudits", "helpers", "limitations"]) ||
      value.schemaVersion !== 1 || value.state !== "diagnostic_only" || value.admission !== "NOT_AUTHORIZED" ||
      value.milestone2 !== "NOT_ESTABLISHED" || !Array.isArray(value.controls) || value.controls.length !== 2 ||
      !Array.isArray(value.sourceAudits) || value.sourceAudits.length !== 2 || !Array.isArray(value.helpers) || value.helpers.length !== 2 ||
      JSON.stringify(value.limitations) !== JSON.stringify(metadata.limitations)) fail("scanner_seaweed_rust_public_evidence_invalid");
  const rejected = (entry) => exactKeys(entry, ["role", "result", "reason"]) && entry.result === "rejected" &&
    /^scanner_[a-z0-9_]{1,120}$/u.test(entry.reason);
  for (const [index, role] of ["cargo-lock-vulnerable", "cargo-lock-clean"].entries()) {
    const entry = value.controls[index], expected = fixedEntry(metadata, role);
    if (entry?.role !== role) fail("scanner_seaweed_rust_public_evidence_invalid");
    if (rejected(entry)) continue;
    if (!exactKeys(entry, ["role", "result", "evidenceClass", "packageCount", "inventorySha256", "findingCount", "blockerCount"]) ||
        entry.result !== "passed" || entry.evidenceClass !== "RUST_ADVISORY_CONTROL" || entry.packageCount !== expected.packageCount ||
        entry.inventorySha256 !== expected.canonicalInventorySha256 || !Number.isSafeInteger(entry.findingCount) ||
        !Number.isSafeInteger(entry.blockerCount) || (role === "cargo-lock-vulnerable"
          ? entry.findingCount < entry.blockerCount || entry.blockerCount < 1
          : entry.findingCount !== 0 || entry.blockerCount !== 0)) fail("scanner_seaweed_rust_public_evidence_invalid");
  }
  for (const [index, role] of ["volume", "worker"].entries()) {
    const entry = value.sourceAudits[index], expected = fixedEntry(metadata, role);
    if (entry?.role !== role) fail("scanner_seaweed_rust_public_evidence_invalid");
    if (rejected(entry)) continue;
    if (!exactKeys(entry, ["role", "result", "evidenceClass", "scope", "lockSha256", "contextImageDigest", "packageCount",
      "inventorySha256", "findingCount", "blockerCount"]) || !["passed", "rejected"].includes(entry.result) ||
        entry.evidenceClass !== "SOURCE_LOCK_AUDIT" || entry.scope !== "LOCK_UNIVERSE" ||
        entry.lockSha256 !== fixedFile(metadata, expected.lockPath).sha256 || entry.contextImageDigest !== metadata.image.platformDigest ||
        entry.packageCount !== expected.packageCount || entry.inventorySha256 !== expected.canonicalInventorySha256 ||
        !Number.isSafeInteger(entry.findingCount) || entry.findingCount < 0 || !Number.isSafeInteger(entry.blockerCount) ||
        entry.blockerCount < 0 || entry.blockerCount > entry.findingCount || (entry.result === "passed") !== (entry.blockerCount === 0)) {
      fail("scanner_seaweed_rust_public_evidence_invalid");
    }
  }
  for (const [index, role] of ["volume", "worker"].entries()) {
    const entry = value.helpers[index], expected = fixedEntry(metadata, role);
    if (entry?.role !== role) fail("scanner_seaweed_rust_public_evidence_invalid");
    if (rejected(entry)) continue;
    if (!exactKeys(entry, ["role", "result", "evidenceClass", "imageDigest", "bytes", "sha256", "hostCopyMode", "hostCopyNlink",
      "intrinsicBinaryInventory", "sourceToBinaryEquivalence"]) || entry.result !== "passed" ||
        entry.evidenceClass !== "ARTIFACT_TO_IMAGE_IDENTITY" || entry.imageDigest !== metadata.image.platformDigest ||
        entry.bytes !== expected.helper.bytes || entry.sha256 !== expected.helper.sha256 || entry.hostCopyMode !== expected.helper.mode ||
        entry.hostCopyNlink !== 1 || entry.intrinsicBinaryInventory !== "NOT_ESTABLISHED" ||
        entry.sourceToBinaryEquivalence !== "NOT_ESTABLISHED") fail("scanner_seaweed_rust_public_evidence_invalid");
  }
  const measuredHelpers = value.helpers.filter((entry) => entry.result === "passed");
  if (measuredHelpers.length === 2 && measuredHelpers.reduce((sum, entry) => sum + entry.bytes, 0) !== 293121400) {
    fail("scanner_seaweed_rust_public_evidence_invalid");
  }
  return value;
}

export const seaweedRustLimits = Object.freeze({ sourceFileBytes: MiB, helperFileBytes: 512 * MiB,
  helperCombinedBytes: 293121400, helperFreeBytes: GiB, sourceFileCount: 13 });
