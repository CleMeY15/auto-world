import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as audit from "../scripts/scanner/official-audit.mjs";
import { evaluateArchiveImageReport } from "../scripts/scanner/official-controls.mjs";

const lock = JSON.parse(readFileSync(new URL("../infra/managed-images/lock.json", import.meta.url), "utf8"));
const config = JSON.parse(readFileSync(new URL("../infra/scanner/official-release.json", import.meta.url), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const imageId = `sha256:${"a".repeat(64)}`;
const exportDigest = `sha256:${"b".repeat(64)}`;
const tag = `auto-world-managed/postgres:${"1".repeat(40)}`;
const now = new Date("2026-10-25T12:00:00Z");
const scanner = path.resolve("synthetic-managed/trivy");
const cache = path.resolve("synthetic-managed/cache");
const carrier = `aquasec/trivy@sha256:${"c".repeat(64)}`;
const scannerError = /scanner_/u;
const subject = (role = "postgres") => ({ kind: "LOCAL_MANAGED_IMAGE_V1", imageId,
  archiveSha256: "d".repeat(64), archiveBytes: 12345, artifactName: `/managed-image-${role}.tar` });
const inspected = () => [{ Id: imageId, Os: "linux", Architecture: "amd64", RepoTags: [tag] }];
const metadata = () => ({ "containerimage.config.digest": imageId, "containerimage.digest": exportDigest });

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function pairedReports(role = "postgres") {
  const bound = subject(role);
  const prop = (name, value) => ({ name: `aquasecurity:trivy:${name}`, value });
  const report = { SchemaVersion: 2, CreatedAt: now.toISOString(), ArtifactName: bound.artifactName,
    ArtifactType: "container_image", Trivy: { Version: "0.76.1" },
    Metadata: { ImageID: imageId, ImageConfig: { os: "linux", architecture: "amd64" }, OS: { Family: "alpine", Name: "3.24.1", EOSL: false } },
    Results: [
      { Target: `${bound.artifactName} (alpine 3.24.1)`, Class: "os-pkgs", Type: "alpine", Packages: [{ Name: "fixture-os", Epoch: 1, Version: "1.2", Release: "r3" }] },
      { Target: "usr/bin/example", Class: "lang-pkgs", Type: "gobinary", Packages: [{ Name: "example.test/library", Version: "v1.0.0" }] },
      { Target: "Java packages", Class: "lang-pkgs", Type: "jar", Packages: [{ Name: "org.example:fixture", Version: "2.0.0" }] },
    ] };
  const sbom = { bomFormat: "CycloneDX", specVersion: "1.6", metadata: { component: { type: "container", name: bound.artifactName, "bom-ref": "root" } },
    components: [
      { type: "operating-system", name: "alpine", version: "3.24.1", "bom-ref": "os", properties: [prop("Type", "alpine"), prop("Class", "os-pkgs")] },
      { type: "application", name: "usr/bin/example", "bom-ref": "application", properties: [prop("Type", "gobinary"), prop("Class", "lang-pkgs")] },
      { type: "library", name: "fixture-os", version: "1:1.2-r3", "bom-ref": "os-library", properties: [prop("PkgType", "alpine")] },
      { type: "library", name: "example.test/library", version: "v1.0.0", "bom-ref": "go-library", properties: [prop("PkgType", "gobinary")] },
      { type: "library", name: "fixture", group: "org.example", version: "2.0.0", purl: "pkg:maven/org.example/fixture@2.0.0",
        "bom-ref": "java-library", properties: [prop("PkgType", "jar")] },
    ], dependencies: [{ ref: "root", dependsOn: ["os", "application", "java-library"] },
      { ref: "os", dependsOn: ["os-library"] }, { ref: "application", dependsOn: ["go-library"] }] };
  return { bound, report, sbom };
}

function runtimeExpected() {
  return { run: { sourceCommit: "a".repeat(40), runId: "1", attempt: "1" },
    roles: [...config.images].map(({ role }, index) => ({ role, imageId: `sha256:${String(index + 1).repeat(64)}` })) };
}

function runtimeResult(expected) {
  return { schemaVersion: 1, run: clone(expected.run), roles: clone(expected.roles),
    cases: ["start-and-refusal", "sql-raw-index", "restart-persistence", "cold-canonical-restore"]
      .map((name) => ({ name, status: "passed", code: "verified" })), cleanup: { result: "passed" } };
}

test("managed CLI scope is explicit, preserves the historical default and refuses unknown or incomplete modes", () => {
  const buildInfo = path.resolve("synthetic-managed/build-info.txt"), output = path.resolve("synthetic-managed/output");
  const base = ["--scanner", scanner, "--build-info", buildInfo, "--output", output];
  assert.deepEqual(audit.parseOfficialAuditArguments(base), { scanner, buildInfo, output });
  assert.deepEqual(audit.parseOfficialAuditArguments([...base, "--scope", "managed"]), { scanner, buildInfo, output, scope: "managed" });
  for (const args of [[...base, "--scope", "admitted"], [...base, "--scope", "registry"],
    [...base, "--scope", "managed", "--scope", "managed"], [...base.slice(0, 4), "--scope", "managed"]]) {
    assert.throws(() => audit.parseOfficialAuditArguments(args), /scanner_official_arguments_invalid/u);
  }
});

test("missing managed runtime result preserves finite non-acceptance for successful and failed children", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aw-runtime-result-missing-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const expected = runtimeExpected();
  for (const childFailed of [false, true]) {
    const resultFile = path.join(directory, `runtime-result-${childFailed}.json`);
    const publicFile = path.join(directory, `managed-runtime-result-${childFailed}.json`);
    const receipt = { functionalRuntime: "PENDING_NOT_ACCEPTED", milestone2Completion: "NOT_ESTABLISHED" };
    await assert.rejects(audit.publishManagedRuntimeResult({ resultFile, publicFile, expected, childFailed, receipt }), (error) => {
      assert.equal(error.message, "scanner_managed_runtime_result_missing");
      assert.equal(error.message.includes(directory), false);
      return true;
    });
    assert.deepEqual(receipt, { functionalRuntime: "FAILED_NOT_ACCEPTED", milestone2Completion: "NOT_ESTABLISHED" });
    await assert.rejects(fs.access(publicFile), { code: "ENOENT" });
  }
  assert.deepEqual(audit.commandFailureDiagnostic({ stdout: Buffer.from("private stdout"), stderr: Buffer.from("private stderr") }, { privateOutput: true }),
    { stdoutBytes: 14, stderrBytes: 14, reason: "private_runtime_output_not_published" });
});

test("runtime result publisher retains valid observations and rejects invalid results before publication", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aw-runtime-result-publisher-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const expected = runtimeExpected(), result = runtimeResult(expected);
  for (const childFailed of [false, true]) {
    const resultFile = path.join(directory, `runtime-result-${childFailed}.json`);
    const publicFile = path.join(directory, `managed-runtime-result-${childFailed}.json`);
    await fs.writeFile(resultFile, JSON.stringify(result), { flag: "wx", mode: 0o600 });
    const receipt = {};
    const published = await audit.publishManagedRuntimeResult({ resultFile, publicFile, expected, childFailed, receipt });
    assert.equal(published.passed, !childFailed);
    assert.equal(receipt.functionalRuntime, childFailed ? "FAILED_NOT_ACCEPTED" : "VERIFIED_DIAGNOSTIC_ONLY");
    assert.equal(receipt.milestone2Completion, "NOT_ESTABLISHED");
    assert.deepEqual(receipt.runtimeCases, result.cases); assert.deepEqual(receipt.runtimeCleanup, result.cleanup);
    assert.deepEqual(JSON.parse(await fs.readFile(publicFile, "utf8")), result);
  }
  const invalidFile = path.join(directory, "runtime-result-invalid.json"), invalidPublic = path.join(directory, "managed-runtime-result-invalid.json");
  await fs.writeFile(invalidFile, "{}", { flag: "wx", mode: 0o600 });
  const receipt = {};
  await assert.rejects(audit.publishManagedRuntimeResult({ resultFile: invalidFile, publicFile: invalidPublic, expected,
    childFailed: false, receipt }), /scanner_managed_runtime_result_invalid/u);
  assert.deepEqual(receipt, { functionalRuntime: "FAILED_NOT_ACCEPTED", milestone2Completion: "NOT_ESTABLISHED" });
  await assert.rejects(fs.access(invalidPublic), { code: "ENOENT" });
});

test("managed lock validates the same diagnostic object and cannot omit or duplicate any builder/candidate role", () => {
  assert.equal(audit.validateManagedImageLock(deepFreeze(clone(lock)), deepFreeze(clone(config))).state, "DIAGNOSTIC_ONLY_NOT_ADMITTED");
  const original = clone(lock);
  assert.equal(audit.validateManagedImageLock(original, config), original);
  for (const collection of ["buildTools", "candidates"]) {
    for (let index = 0; index < lock[collection].length; index++) {
      const missing = clone(lock); missing[collection].splice(index, 1);
      assert.throws(() => audit.validateManagedImageLock(missing, config), scannerError, `${collection} missing ${index}`);
      const doubled = clone(lock); doubled[collection][index] = clone(doubled[collection][(index + 1) % doubled[collection].length]);
      assert.throws(() => audit.validateManagedImageLock(doubled, config), scannerError, `${collection} duplicate ${index}`);
    }
  }
});

test("managed lock refuses substituted source, compiler, catalogue, repository and upstream base identities", () => {
  const acceptedMutations = [];
  for (const mutate of [
    (value) => { value.schemaVersion = 2; }, (value) => { value.state = "ADMITTED"; }, (value) => { value.platform = "linux/arm64"; },
    (value) => { value.candidates[0].role = "redis"; }, (value) => { value.candidates[0].baseDigest = "postgres:latest"; },
    (value) => { value.candidates[1].baseDigest = `sha256:${"f".repeat(64)}`; },
    (value) => { value.candidates[2].dockerfile = "infra/managed-images/../../foreign/Dockerfile"; },
    (value) => { value.buildTools[0].repository = "foreign/golang"; },
    (value) => { value.buildTools[0].version = "latest"; },
    (value) => { value.buildTools[0].manifestDigest = `sha256:${"e".repeat(64)}`; },
    (value) => { value.buildTools[0].platform.digest = `sha256:${"e".repeat(64)}`; },
    (value) => { value.buildTools[1].manifestDigest = `sha256:${"e".repeat(64)}`; },
    (value) => { value.buildTools[1].platform.digest = `sha256:${"e".repeat(64)}`; },
    (value) => { value.buildTools[1].platform.architecture = "arm64"; },
    (value) => { value.gosu.sourceCommit = "e".repeat(40); },
    (value) => { value.gosu.archiveSha256 = "e".repeat(64); },
    (value) => { value.gosu.archiveBytes--; },
    (value) => { value.gosu.goModSha256 = "e".repeat(64); },
    (value) => { value.gosu.goSumSha256 = "e".repeat(64); },
    (value) => { value.opensearch.sourceCommit = "f".repeat(40); },
    (value) => { value.opensearch.version = "3.8.0"; },
    (value) => { value.opensearch.profile = "full-standard"; },
    (value) => { value.opensearch.gradleVersion = "9.7.0"; },
    (value) => { value.opensearch.jackson2 = "2.22.2"; },
    (value) => { value.opensearch.jackson3 = "3.2.2"; },
    (value) => { value.opensearch.gradleDistributionSha256 = "e".repeat(64); },
    (value) => { value.opensearch.gradleWrapperJarSha256 = "f".repeat(64); },
    (value) => { value.amazonLinux.releasever = "latest"; },
    (value) => { value.amazonLinux.repositoryGuid = "f".repeat(64); },
    (value) => { value.amazonLinux.repomdSha256 = "e".repeat(64); },
    (value) => { value.amazonLinux.primarySha256 = "e".repeat(64); },
  ]) {
    const changed = clone(lock); mutate(changed);
    try { audit.validateManagedImageLock(changed, config); acceptedMutations.push(mutate.toString()); }
    catch (error) { assert.match(error.message, scannerError); }
  }
  assert.deepEqual(acceptedMutations, [], "material substitutions must be rejected");
  const changedConfig = clone(config);
  changedConfig.images.find(({ role }) => role === "aws-cli").platform.digest = `sha256:${"e".repeat(64)}`;
  assert.throws(() => audit.validateManagedImageLock(lock, changedConfig), scannerError);
});

test("Buildx metadata binds the inspected configID while retaining a distinct valid export digest", () => {
  assert.notEqual(metadata()["containerimage.digest"], imageId);
  const originalInspect = inspected(), originalMetadata = metadata();
  deepFreeze(originalInspect); deepFreeze(originalMetadata);
  assert.deepEqual(audit.validateManagedLocalImage(originalInspect, originalMetadata, tag), { imageId, os: "linux", architecture: "amd64" });
  for (const role of ["postgres", "opensearch", "aws-cli"]) {
    const ownedTag = `auto-world-managed/${role}:${"2".repeat(40)}`;
    const value = inspected(); value[0].RepoTags = [ownedTag];
    assert.deepEqual(audit.validateManagedLocalImage(value, metadata(), ownedTag), { imageId, os: "linux", architecture: "amd64" });
  }
  for (const mutate of [
    (value) => { value.inspect = []; }, (value) => { value.inspect.push(clone(value.inspect[0])); },
    (value) => { value.inspect[0].Id = `sha256:${"f".repeat(64)}`; },
    (value) => { value.inspect[0].Id = "a".repeat(64); },
    (value) => { value.inspect[0].Os = "windows"; }, (value) => { value.inspect[0].Architecture = "arm64"; },
    (value) => { value.inspect[0].RepoTags = ["foreign/image:latest"]; },
    (value) => { delete value.inspect[0].RepoTags; },
    (value) => { value.meta["containerimage.config.digest"] = exportDigest; },
    (value) => { delete value.meta["containerimage.config.digest"]; },
    (value) => { value.meta["containerimage.digest"] = "latest"; },
    (value) => { delete value.meta["containerimage.digest"]; },
    (value) => { value.tag = "auto-world-managed/postgres:latest"; },
    (value) => { value.tag = `foreign/postgres:${"1".repeat(40)}`; },
  ]) {
    const value = { inspect: inspected(), meta: metadata(), tag }; mutate(value);
    assert.throws(() => audit.validateManagedLocalImage(value.inspect, value.meta, value.tag), scannerError);
  }
});

test("archive scanner uses the actual read-only input with no network, daemon socket or host authority", () => {
  for (const role of ["postgres", "opensearch", "aws-cli"]) for (const format of ["json", "cyclonedx"]) {
    const archive = path.resolve(`synthetic-managed/managed-image-${role}.tar`);
    const args = audit.officialArchiveScanArguments(carrier, scanner, cache, archive, format);
    assert.equal(args[0], "run");
    for (const flag of ["--network=none", "--pull=never", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
      "--skip-db-update", "--skip-java-db-update", "--skip-version-check", "--offline-scan", "--list-all-pkgs"]) assert.ok(args.includes(flag), flag);
    assert.equal(args[args.indexOf("--platform") + 1], "linux/amd64");
    assert.equal(args[args.indexOf("--user") + 1], "65532:65532");
    assert.equal(args[args.indexOf("--entrypoint") + 1], "/scanner");
    assert.equal(args[args.indexOf("--format") + 1], format);
    assert.equal(args[args.indexOf("--input") + 1], `/managed-image-${role}.tar`);
    assert.ok(args.includes(`type=bind,src=${archive},dst=/managed-image-${role}.tar,readonly`));
    assert.ok(args.includes(`type=bind,src=${scanner},dst=/scanner,readonly`));
    assert.ok(args.includes(`type=bind,src=${cache},dst=/cache,readonly`));
    assert.equal(args[args.indexOf(carrier) + 1], "image");
    assert.equal(args.includes("HIGH,CRITICAL"), format === "json");
    assert.ok(!args.some((entry) => /docker\.sock|--privileged|--ignore-unfixed|--network=(?:host|bridge)|dst=\/var\/run/u.test(entry)));
    assert.equal(args.filter((entry) => entry.startsWith("type=bind,")).length, 3);
    assert.equal(args[args.indexOf("--pids-limit") + 1], "256");
    assert.equal(args[args.indexOf("--memory") + 1], "4g");
    assert.equal(args[args.indexOf("--memory-swap") + 1], "4g");
    assert.equal(args[args.indexOf("--cpus") + 1], "2");
  }
  for (const archive of ["relative.tar", path.resolve("synthetic-managed/foreign.tar"), path.resolve("synthetic-managed/managed-image-postgres.tar,readonly=false")]) {
    assert.throws(() => audit.officialArchiveScanArguments(carrier, scanner, cache, archive), scannerError);
  }
  assert.throws(() => audit.officialArchiveScanArguments(carrier, scanner, cache, path.resolve("synthetic-managed/managed-image-postgres.tar"), "table"), scannerError);
  assert.throws(() => audit.officialArchiveScanArguments("aquasec/trivy:latest", scanner, cache, path.resolve("synthetic-managed/managed-image-postgres.tar")), scannerError);
});

test("local archive reports accept each owned artifact and preserve immutable raw evidence", () => {
  for (const role of ["postgres", "opensearch", "aws-cli"]) {
    const { bound, report, sbom } = pairedReports(role);
    const before = JSON.stringify({ bound, report, sbom });
    deepFreeze(bound); deepFreeze(report); deepFreeze(sbom);
    assert.deepEqual(evaluateArchiveImageReport(report, bound, now), { findings: [], blockers: [] });
    assert.deepEqual(audit.validateOfficialArchiveSbom(report, sbom, bound), { packageCount: 3, applicationCount: 1, operatingSystemCount: 1 });
    assert.equal(JSON.stringify({ bound, report, sbom }), before);
  }
});

test("archive subject rejects malformed or missing complete-byte identity without treating hashes as a registry subject", () => {
  for (const change of [
    { kind: "REGISTRY_IMAGE" }, { imageId: exportDigest }, { imageId: "a".repeat(64) },
    { archiveSha256: "d".repeat(63) }, { archiveSha256: "D".repeat(64) }, { archiveSha256: undefined },
    { archiveBytes: 0 }, { archiveBytes: -1 }, { archiveBytes: 1.5 }, { archiveBytes: Number.MAX_SAFE_INTEGER + 1 },
    { artifactName: "/managed-image-redis.tar" }, { artifactName: "managed-image-postgres.tar" },
  ]) {
    const { bound, report } = pairedReports();
    assert.throws(() => evaluateArchiveImageReport(report, { ...bound, ...change }, now), scannerError);
  }
});

test("archive report rejects mismatched configID, path, platform, scanner, clock and stale or impossible dates", () => {
  for (const mutate of [
    (value) => { value.Metadata.ImageID = exportDigest; }, (value) => { delete value.Metadata.ImageID; },
    (value) => { value.ArtifactName = "/managed-image-opensearch.tar"; },
    (value) => { value.ArtifactName = `repository@${imageId}`; },
    (value) => { value.ArtifactType = "filesystem"; }, (value) => { value.SchemaVersion = 1; },
    (value) => { value.Metadata.ImageConfig.os = "windows"; },
    (value) => { value.Metadata.ImageConfig.architecture = "arm64"; },
    (value) => { value.Trivy.Version = "0.74.0-autoworld.2"; }, (value) => { delete value.Trivy; },
    (value) => { value.CreatedAt = "2026-10-23T11:59:59.999Z"; },
    (value) => { value.CreatedAt = "2026-10-25T12:00:00.001Z"; },
    (value) => { value.CreatedAt = "2026-02-30T12:00:00Z"; }, (value) => { delete value.CreatedAt; },
    (value) => { value.Metadata.OS.EOSL = "false"; },
  ]) {
    const { bound, report } = pairedReports(); mutate(report);
    assert.throws(() => evaluateArchiveImageReport(report, bound, now), scannerError);
  }
  const { report, bound } = pairedReports();
  report.CreatedAt = "2026-10-23T12:00:00Z";
  assert.deepEqual(evaluateArchiveImageReport(report, bound, now), { findings: [], blockers: [] });
  for (const clock of ["2026-10-25T12:00:00Z", new Date("invalid"), null]) {
    assert.throws(() => evaluateArchiveImageReport(report, bound, clock), /scanner_audit_clock_invalid/u);
  }
});

test("archive policy keeps all critical, fixed-high and undisposed unfixed-high findings blocked", () => {
  for (const [severity, fixedVersion, code] of [
    ["CRITICAL", "", "image_vulnerability_blocked"], ["CRITICAL", "1:2.0-r0", "image_vulnerability_blocked"],
    ["HIGH", "1:2.0-r0", "image_vulnerability_blocked"], ["HIGH", "", "unfixed_high_needs_independent_disposition"],
  ]) {
    const { bound, report } = pairedReports();
    report.Results[0].Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0001", Severity: severity, PkgName: "fixture-os", InstalledVersion: "1:1.2-r3", FixedVersion: fixedVersion }];
    const actual = evaluateArchiveImageReport(report, bound, now);
    assert.equal(actual.findings.length, 1);
    assert.equal(actual.blockers.length, 1);
    assert.equal(actual.blockers[0].code, code);
    assert.equal(actual.findings[0].imageDigest, imageId);
    assert.equal(actual.findings[0].installedVersion, "1:1.2-r3");
  }
  const { bound, report } = pairedReports(); report.Metadata.OS.EOSL = true;
  assert.equal(evaluateArchiveImageReport(report, bound, now).blockers[0].code, "image_os_end_of_life");
});

test("archive policy refuses missing inventory, duplicate results and findings detached from package identity", () => {
  for (const mutate of [
    (value) => { value.Results = []; }, (value) => { delete value.Results[0].Packages; },
    (value) => { value.Results[1].Packages = []; }, (value) => { value.Results.push(clone(value.Results[0])); },
    (value) => { value.Results[0].Packages[0].Version = ""; },
    (value) => { value.Results[0].Packages[0].Epoch = -1; },
    (value) => { value.Results[0].Class = "unknown"; },
    (value) => { value.Results[0].Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0002", Severity: "HIGH", PkgName: "foreign", InstalledVersion: "1:1.2-r3", FixedVersion: "2" }]; },
    (value) => { value.Results[0].Vulnerabilities = [{ VulnerabilityID: "CVE-2099-0002", Severity: "HIGH", PkgName: "fixture-os", InstalledVersion: "1.2-r3", FixedVersion: "2" }]; },
  ]) {
    const { bound, report } = pairedReports(); mutate(report);
    assert.throws(() => evaluateArchiveImageReport(report, bound, now), scannerError);
  }
});

test("archive SBOM refuses subject, package, OS and dependency-graph losses without converting the report", () => {
  for (const mutate of [
    (value) => { value.report.Metadata.ImageID = exportDigest; },
    (value) => { value.report.ArtifactName = "/managed-image-aws-cli.tar"; },
    (value) => { value.sbom.metadata.component.name = "/managed-image-aws-cli.tar"; },
    (value) => { value.sbom.metadata.component.type = "application"; },
    (value) => { value.sbom.components.pop(); },
    (value) => { value.sbom.components[2].version = "1.2-r3"; },
    (value) => { value.sbom.components[4].group = "org.other"; },
    (value) => { value.sbom.components[0].version = "3.23.0"; },
    (value) => { value.sbom.components[1].name = "usr/bin/other"; },
    (value) => { value.sbom.components[3]["bom-ref"] = "os-library"; },
    (value) => { value.sbom.dependencies[0].dependsOn.push("absent"); },
    (value) => { value.sbom.dependencies.push(clone(value.sbom.dependencies[0])); },
    (value) => { value.report.Results[2].Packages = []; },
  ]) {
    const value = pairedReports(); mutate(value);
    const before = JSON.stringify(value); deepFreeze(value);
    assert.throws(() => audit.validateOfficialArchiveSbom(value.report, value.sbom, value.bound), scannerError);
    assert.equal(JSON.stringify(value), before);
  }
});
