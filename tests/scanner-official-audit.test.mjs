import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { candidateDockerArguments } from "../scripts/scanner/audit.mjs";
import { evaluateImageReport } from "../scripts/scanner/official-controls.mjs";
import { auditOfficialScanner, commandFailureDiagnostic, officialImageScanArguments, ownedRunArguments, parseOfficialAuditArguments,
  validateContainerAbsence, validateOfficialImageSbom, validateOfficialReleaseConfig, validateOfficialScannerIdentity, validateOwnedContainer } from "../scripts/scanner/official-audit.mjs";

const config = JSON.parse(readFileSync(new URL("../infra/scanner/official-release.json", import.meta.url)));
const clone = (value) => JSON.parse(JSON.stringify(value));
const carrier = `aquasec/trivy@sha256:${"a".repeat(64)}`;
const scanner = path.resolve("synthetic/trivy");
const cache = path.resolve("synthetic/cache");
const image = config.images.find((entry) => entry.role === "postgres");
const owner = "01234567-89ab-4cde-8012-3456789abcde";
const name = `aw-official-${owner}`;

test("failed-command receipt diagnostics preserve the bounded cause while removing recognizable credentials", () => {
  const token = `github_pat_${"a".repeat(80)}`;
  const bearer = "synthetic-private-bearer";
  const result = { stdout: Buffer.from(`diagnostic ${token}`),
    stderr: Buffer.from(`${"x".repeat(5000)}\nAuthorization: Bearer ${bearer}\nhttps://user:password@example.test/path\nimage scan failed: inventory missing`) };
  const diagnostic = commandFailureDiagnostic(result);
  assert.equal(diagnostic.stdoutBytes, result.stdout.length);
  assert.equal(diagnostic.stderrBytes, result.stderr.length);
  assert.ok(diagnostic.stdoutTail.includes("[redacted]"));
  assert.ok(diagnostic.stderrTail.endsWith("image scan failed: inventory missing"));
  assert.ok(diagnostic.stdoutTail.length <= 4096 && diagnostic.stderrTail.length <= 4096);
  assert.ok(!JSON.stringify(diagnostic).includes(token));
  assert.ok(!JSON.stringify(diagnostic).includes(bearer));
  assert.ok(!JSON.stringify(diagnostic).includes("user:password"));
  assert.deepEqual(commandFailureDiagnostic({ stdout: null, stderr: null }), { stdoutBytes: 0, stderrBytes: 0, stdoutTail: "", stderrTail: "", stderrErrors: "" });
});

test("a build's original command error survives a long echoed instruction with bounded redaction", () => {
  const token = `github_pat_${"a".repeat(80)}`;
  const cause = "#9 0.15 /tmp/inventory.sh: line 12: find: command not found";
  const stderr = Buffer.from(`${cause}\nError: ${token}\n${"RUN repeated instruction\n".repeat(500)}ERROR: failed to build\n`);
  const diagnostic = commandFailureDiagnostic({ stdout: null, stderr });
  assert.ok(!diagnostic.stderrTail.includes(cause));
  assert.ok(diagnostic.stderrErrors.includes(cause));
  assert.ok(diagnostic.stderrErrors.includes("Error: [redacted]"));
  assert.ok(!JSON.stringify(diagnostic).includes(token));
  assert.ok(diagnostic.stderrErrors.length <= 4096);
  const many = commandFailureDiagnostic({ stderr: Buffer.from(`Error: ${"x".repeat(600)}\n`.repeat(40)) });
  assert.ok(many.stderrErrors.length <= 4096);
  assert.ok(many.stderrErrors.split("\n").every((line) => line.length <= 512));
});

test("official CLI accepts exactly the three distinct absolute input/output paths", () => {
  const argv = ["--scanner", scanner, "--build-info", path.resolve("synthetic/build-info.txt"), "--output", path.resolve("synthetic/output")];
  assert.deepEqual(parseOfficialAuditArguments(argv), { scanner, buildInfo: argv[3], output: argv[5] });
  for (const bad of [argv.slice(0, 4), [...argv, "--skip", "yes"], ["--scanner", scanner, "--scanner", cache, "--output", argv[5]],
    ["--scanner", "relative", ...argv.slice(2)], [...argv.slice(0, 4), "--output", scanner], [...argv.slice(0, 5), `${argv[5]},other`]]) {
    assert.throws(() => parseOfficialAuditArguments(bad), /scanner_official_arguments_invalid/u);
  }
});

test("release config cannot omit a helper, substitute a repository or change the qualified release", () => {
  assert.equal(validateOfficialReleaseConfig(config), config);
  for (const mutate of [
    (value) => value.images.pop(),
    (value) => { value.images[1] = value.images[0]; },
    (value) => { value.images[0].repository = "unrelated/postgres"; },
    (value) => { value.images[0].platform.architecture = "arm64"; },
    (value) => { value.images[0].platform.digest = "latest"; },
    (value) => { value.scanner.version = "0.74.0"; },
    (value) => { value.scanner.sourceCommit = "f".repeat(40); },
    (value) => { value.scanner.archive.bytes--; },
    (value) => { value.scanner.binarySha256 = "a".repeat(64); },
    (value) => { delete value.scanner.binarySha256; },
    (value) => { value.scanner.mainModuleVersion = "v0.76.1"; },
    (value) => { value.scanner.mainModuleVersion = "v0.76.2+dirty"; },
    (value) => { value.scanner.vcsModified = false; },
    (value) => { value.scanner.vcsModified = "true"; },
  ]) {
    const changed = clone(config); mutate(changed);
    assert.throws(() => validateOfficialReleaseConfig(changed), /scanner_official_config_invalid/u);
  }
});

test("binary identity refuses changed hashes, malformed snapshots and expected-hash substitution", () => {
  const expected = { sha256: "d1dfca6ae10a1ad4540bb94e64f0510077c47008920a9b554986b39dca573d83", size: 123 };
  assert.equal(validateOfficialScannerIdentity(expected, config.scanner), expected);
  for (const identity of [{ ...expected, sha256: "a".repeat(64) }, { ...expected, sha256: expected.sha256.toUpperCase() },
    { ...expected, size: 0 }, { ...expected, size: NaN }, { ...expected, sha256: undefined }]) {
    assert.throws(() => validateOfficialScannerIdentity(identity, config.scanner), /scanner_official_binary_identity_invalid/u);
  }
  assert.throws(() => validateOfficialScannerIdentity({ ...expected, sha256: "a".repeat(64) }, { ...config.scanner, binarySha256: "a".repeat(64) }),
    /scanner_official_binary_identity_invalid/u);
});

test("official remote scans reuse the non-root read-only resource-bounded profile and exact platform", () => {
  for (const format of ["json", "cyclonedx"]) {
    const args = officialImageScanArguments(carrier, scanner, cache, image, format);
    assert.ok(args.includes("--read-only"));
    assert.ok(args.includes("--cap-drop=ALL"));
    assert.ok(args.includes("--security-opt=no-new-privileges=true"));
    assert.equal(args[args.indexOf("--user") + 1], "65532:65532");
    assert.equal(args[args.indexOf("--memory") + 1], "4g");
    assert.equal(args[args.indexOf("--format") + 1], format);
    assert.equal(args[args.indexOf("--image-src") + 1], "remote");
    assert.equal(args.at(-1), `${image.repository}@${image.platform.digest}`);
    assert.ok(args.includes("--skip-db-update") && args.includes("--skip-java-db-update"));
    assert.ok(!args.some((entry) => entry.includes("docker.sock") || entry === "--privileged" || entry === "--ignore-unfixed"));
    assert.equal(args.includes("HIGH,CRITICAL"), format === "json");
  }
  const fixture = candidateDockerArguments({ carrier, scanner, cache, mode: "rootfs", target: path.resolve("synthetic/fixture") });
  assert.ok(fixture.includes("--network=none"));
  const named = ownedRunArguments(fixture, name, owner);
  assert.deepEqual(named.slice(0, 5), ["run", "--name", name, "--label", `io.auto-world.scanner-official=${owner}`]);
  assert.deepEqual(named.slice(5), fixture.slice(1));
  assert.throws(() => ownedRunArguments(["system", "prune"], name, owner), /scanner_official_container_arguments_invalid/u);
});

test("cleanup requires the exact unique name, owner label and canonical returned ID", () => {
  const value = [{ Name: `/${name}`, Id: "b".repeat(64), Config: { Labels: { "io.auto-world.scanner-official": owner } } }];
  assert.equal(validateOwnedContainer(value, name, owner), "b".repeat(64));
  for (const mutate of [
    (changed) => { changed[0].Name = "/foreign"; },
    (changed) => { changed[0].Id = "short"; },
    (changed) => { changed[0].Config.Labels["io.auto-world.scanner-official"] = "foreign"; },
    (changed) => { changed.push(changed[0]); },
  ]) {
    const changed = clone(value); mutate(changed);
    assert.throws(() => validateOwnedContainer(changed, name, owner), /scanner_official_cleanup_owner_invalid/u);
  }
});

test("absence proof rejects transport errors, foreign names and killed inspection", () => {
  const result = { status: 1, signal: null, stderr: Buffer.from(`Error response from daemon: No such container: ${name}\n`) };
  assert.equal(validateContainerAbsence(result, name), true);
  assert.equal(validateContainerAbsence({ ...result, stderr: Buffer.from(`Error: No such object: ${name}\n`) }, name), true);
  for (const changed of [{ ...result, status: 0 }, { ...result, signal: "SIGTERM" }, { ...result, error: { code: "ETIMEDOUT" } },
    { ...result, stderr: Buffer.from(`Error: No such object: aw-official-${"f".repeat(36)}`) },
    { ...result, stderr: Buffer.from("Cannot connect to the Docker daemon") }]) assert.equal(validateContainerAbsence(changed, name), false);
});

function pairedReports() {
  const ArtifactName = `${image.repository}@${image.platform.digest}`;
  const prop = (name, value) => ({ name: `aquasecurity:trivy:${name}`, value });
  const report = { SchemaVersion: 2, CreatedAt: "2026-10-25T12:00:00Z", ArtifactName, ArtifactType: "container_image", Trivy: { Version: "0.76.1" },
    Metadata: { ImageConfig: { os: "linux", architecture: "amd64" }, OS: { Family: "alpine", Name: "3.24.1", EOSL: false } },
    Results: [
      { Target: `${ArtifactName} (alpine 3.24.1)`, Class: "os-pkgs", Type: "alpine", Packages: [{ Name: "fixture-os", Epoch: 1, Version: "1.2", Release: "r3" }] },
      { Target: "usr/bin/example", Class: "lang-pkgs", Type: "gobinary", Packages: [{ Name: "example.test/library", Version: "v1.0.0" }] },
    ] };
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { type: "container", name: ArtifactName, "bom-ref": "root" } },
    components: [
      { type: "operating-system", name: "alpine", version: "3.24.1", "bom-ref": "os", properties: [prop("Type", "alpine"), prop("Class", "os-pkgs")] },
      { type: "application", name: "usr/bin/example", "bom-ref": "application", properties: [prop("Type", "gobinary"), prop("Class", "lang-pkgs")] },
      { type: "library", name: "fixture-os", version: "1:1.2-r3", "bom-ref": "os-library", properties: [prop("PkgType", "alpine")] },
      { type: "library", name: "example.test/library", version: "v1.0.0", "bom-ref": "go-library", properties: [prop("PkgType", "gobinary")] },
    ], dependencies: [{ ref: "root", dependsOn: ["os", "application"] }, { ref: "os", dependsOn: ["os-library"] }, { ref: "application", dependsOn: ["go-library"] }] };
  return { report, sbom };
}

test("image SBOM binds the exact subject, OS, package versions/types and valid dependency references", () => {
  const { report, sbom } = pairedReports();
  assert.deepEqual(validateOfficialImageSbom(report, sbom, image), { packageCount: 2, applicationCount: 1, operatingSystemCount: 1 });
  for (const mutate of [
    (value) => { value.sbom.metadata.component.name = "different/image@sha256:wrong"; },
    (value) => { value.report.Metadata.ImageConfig.architecture = "arm64"; },
    (value) => { value.sbom.components.pop(); },
    (value) => { value.sbom.components[2].version = "1.2-r3"; },
    (value) => { value.sbom.components[0].version = "3.23"; },
    (value) => { value.sbom.components[1].name = "usr/bin/another"; },
    (value) => { value.sbom.dependencies[0].dependsOn.push("missing"); },
    (value) => { value.sbom.components[3]["bom-ref"] = "os-library"; },
  ]) {
    const changed = pairedReports(); mutate(changed);
    assert.throws(() => validateOfficialImageSbom(changed.report, changed.sbom, image), /scanner_official_sbom_/u);
  }
});

function aggregatedReports() {
  const value = pairedReports();
  const materials = [
    { type: "jar", name: "org.apache.logging.log4j:log4j-core", version: "2.25.2", group: "org.apache.logging.log4j", component: "log4j-core", purl: "pkg:maven/org.apache.logging.log4j/log4j-core@2.25.2" },
    { type: "python-pkg", name: "urllib3", version: "2.5.0" },
    { type: "node-pkg", name: "@scope/example", version: "1.2.3", group: "@scope", component: "example", purl: "pkg:npm/%40scope/example@1.2.3" },
    { type: "conda-pkg", name: "fixture-conda", version: "1.0.0" },
    { type: "gemspec", name: "fixture-ruby", version: "2.0.0" },
  ];
  for (const material of materials) {
    value.report.Results.push({ Target: `${material.type} packages`, Class: "lang-pkgs", Type: material.type,
      Packages: [{ Name: material.name, Version: material.version }] });
    const component = { type: "library", name: material.component ?? material.name, version: material.version, "bom-ref": material.type,
      properties: [{ name: "aquasecurity:trivy:PkgType", value: material.type }],
      ...(material.group ? { group: material.group, purl: material.purl } : {}) };
    value.sbom.components.push(component);
    value.sbom.dependencies[0].dependsOn.push(material.type);
  }
  return value;
}

test("official grouped Maven/npm identities and all five aggregated result types retain exact coverage without invented applications", () => {
  const { report, sbom } = aggregatedReports();
  assert.deepEqual(validateOfficialImageSbom(report, sbom, image), { packageCount: 7, applicationCount: 1, operatingSystemCount: 1 });
  for (const mutate of [
    (value) => { value.sbom.components.find((entry) => entry["bom-ref"] === "jar").group = "org.other"; },
    (value) => { delete value.sbom.components.find((entry) => entry["bom-ref"] === "jar").group; },
    (value) => { value.sbom.components.find((entry) => entry["bom-ref"] === "jar").version = "2.25.1"; },
    (value) => { value.sbom.components.find((entry) => entry["bom-ref"] === "node-pkg").group = "@other"; },
    (value) => { value.sbom.components.find((entry) => entry["bom-ref"] === "node-pkg").purl = "pkg:golang/example@1.2.3"; },
    (value) => { value.sbom.components.find((entry) => entry["bom-ref"] === "node-pkg").purl = 123; },
    (value) => { value.sbom.components = value.sbom.components.filter((entry) => entry["bom-ref"] !== "python-pkg"); },
    (value) => { value.sbom.components.find((entry) => entry["bom-ref"] === "python-pkg").version = "0.0.0"; },
    (value) => { value.sbom.components[3].group = "forbidden-go-group"; },
    (value) => { value.sbom.components[2].group = "forbidden-os-group"; },
  ]) {
    const changed = aggregatedReports(); mutate(changed);
    assert.throws(() => validateOfficialImageSbom(changed.report, changed.sbom, image), /scanner_official_sbom_/u);
  }
});

test("official report version adaptation retains the existing critical/fixable-high gates and subject rejection", () => {
  const { report } = pairedReports();
  const evaluate = (value) => evaluateImageReport(value, image, [], new Date("2026-10-25T12:00:01Z"), { expectedScannerVersion: "0.76.1" });
  assert.deepEqual(evaluate(report), { findings: [], blockers: [] });
  report.Results[0].Vulnerabilities = [{ Severity: "HIGH", VulnerabilityID: "CVE-2099-12345", PkgName: "fixture-os", InstalledVersion: "1:1.2-r3", FixedVersion: "1:1.3-r0" }];
  assert.equal(evaluate(report).blockers[0].code, "image_vulnerability_blocked");
  report.Results[0].Vulnerabilities[0].Severity = "CRITICAL";
  delete report.Results[0].Vulnerabilities[0].FixedVersion;
  assert.equal(evaluate(report).blockers[0].code, "image_vulnerability_blocked");
  report.ArtifactName = `other/postgres@${image.platform.digest}`;
  assert.throws(() => evaluate(report), /scanner_image_report_invalid/u);
});

test("invalid runtime context/paths fail before any Docker command", async () => {
  await assert.rejects(auditOfficialScanner({ scanner: "relative", buildInfo: "relative-info", output: "relative-output" }),
    /scanner_official_(?:requires_nonroot_linux_actions|path_outside_runner_temp)/u);
});
