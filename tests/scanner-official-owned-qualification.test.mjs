import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OWNED_SCANNER, canonicalOwnedJson, validateOwnedBuilderAudit, validateReproduciblePair } from "../scripts/scanner/owned-controls.mjs";
import { createOwnedPublicEvidence, publishOwnedScannerEvidence, qualifyOwnedScanner } from "../scripts/scanner/owned-qualification.mjs";

const run = { workflow: "Data foundation audit", runId: "123456", runAttempt: 1, sourceSha: "a".repeat(40) };
function setup(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-owned-public-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const evidence = createOwnedPublicEvidence(path.join(root, "source"), run);
  return { root, evidence, destination: path.join(root, "published") };
}
const exportDirectory = (source, destination) => cpSync(source, destination, { recursive: true });

test("publication retains canonical measured controls and the exact run manifest", async (t) => {
  const { evidence, destination } = setup(t);
  evidence.write("finding.json", { score: 7.5, result: "rejected", run });
  const result = await publishOwnedScannerEvidence({ directories: [["controls", evidence]], destination, run, exportDirectory });
  assert.equal(result[0].files, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(destination, "controls-manifest.json"), "utf8")), evidence.manifest());
  assert.equal(JSON.parse(readFileSync(path.join(destination, "controls/finding.json"), "utf8")).score, 7.5);
  assert.equal(existsSync(`${destination}-pending`), false);
});

test("unlisted private output prevents any public destination from appearing", async (t) => {
  const { evidence, destination } = setup(t);
  evidence.write("result.json", { result: "failed" });
  writeFileSync(path.join(evidence.root, "private-binary"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0]));
  await assert.rejects(publishOwnedScannerEvidence({ directories: [["controls", evidence]], destination, run, exportDirectory }), /scanner_owned_public/u);
  assert.equal(existsSync(destination), false);
});

test("run substitution is rejected before export", async (t) => {
  const { evidence, destination } = setup(t);
  evidence.write("result.json", { result: "passed" });
  await assert.rejects(publishOwnedScannerEvidence({ directories: [["controls", evidence]], destination,
    run: { ...run, runAttempt: 2 }, exportDirectory }), /scanner_owned_public/u);
  assert.equal(existsSync(destination), false);
});

test("mutation during copying remains private and cannot reach the upload directory", async (t) => {
  const { evidence, destination } = setup(t);
  evidence.write("result.json", { result: "failed" });
  await assert.rejects(publishOwnedScannerEvidence({ directories: [["controls", evidence]], destination, run,
    exportDirectory(source, target) {
      cpSync(source, target, { recursive: true });
      writeFileSync(path.join(target, "injected.json"), '{"secret":"private"}\n');
    } }), /scanner_owned_public/u);
  assert.equal(existsSync(destination), false);
  assert.equal(existsSync(`${destination}-pending`), true);
});

test("public writer rejects duplicate evidence names, paths, and oversized reports", (t) => {
  const { evidence } = setup(t);
  evidence.write("result.json", { result: "failed" });
  assert.throws(() => evidence.write("result.json", {}), /scanner_owned_public_name_invalid/u);
  assert.throws(() => evidence.write("../secret.json", {}), /scanner_owned_public_name_invalid/u);
  assert.throws(() => evidence.write("large.json", { text: "x".repeat(4 * 1024 ** 2) }), /scanner_owned_public_budget_exceeded/u);
});

test("failed second source validation cannot publish a partial first source", async (t) => {
  const { root, evidence, destination } = setup(t);
  evidence.write("result.json", { result: "passed" });
  const bad = createOwnedPublicEvidence(path.join(root, "second"), run);
  bad.write("result.json", { result: "failed" });
  writeFileSync(path.join(bad.root, "undeclared.txt"), "private");
  await assert.rejects(publishOwnedScannerEvidence({ directories: [["build", evidence], ["controls", bad]], destination, run, exportDirectory }), /scanner_owned_public/u);
  assert.equal(existsSync(destination), false);
  assert.equal(existsSync(`${destination}-pending`), false);
});

const sha = (value) => createHash("sha256").update(value).digest("hex");
const repeatedHash = (character) => character.repeat(64);
const h1 = (character) => `h1:${character.repeat(43)}=`;
const orchestrationRun = { workflow: "data-foundation-audit", runId: "123456", runAttempt: 1, sourceSha: "a".repeat(40) };
const databaseJoin = { vulnerabilityDbSha256: repeatedHash("3"), javaDbSha256: repeatedHash("4") };
const rustMetadata = JSON.parse(readFileSync(new URL("../infra/managed-images/seaweed-rust-source.json", import.meta.url), "utf8"));
const scannerFixtures = JSON.parse(readFileSync(new URL("../infra/scanner/materials/scanner-fixtures/manifest.json", import.meta.url), "utf8")).fixtures;

function ownedModules() {
  return Array.from({ length: 110 }, (_, index) => ({
    path: index === 0 ? OWNED_SCANNER.goJosePath : `example.com/dependency/module${index}`,
    version: index === 0 ? OWNED_SCANNER.goJoseVersion : `v1.0.${index}`,
    sum: index === 0 ? OWNED_SCANNER.goJoseSum : h1(String.fromCharCode(65 + index % 26)),
    goModSum: index === 0 ? OWNED_SCANNER.goJoseGoModSum : h1(String.fromCharCode(97 + index % 26)),
    compiled: true,
  })).sort((left, right) => `${left.path}@${left.version}`.localeCompare(`${right.path}@${right.version}`, "en"));
}

function ownedClosure(modules = ownedModules()) {
  const materials = modules.map((item, index) => ({ path: item.path, version: item.version,
    zip: { bytes: index + 10, sha256: repeatedHash("1") }, mod: { bytes: index + 20, sha256: repeatedHash("2") },
    info: { bytes: index + 30, sha256: repeatedHash("3") } }));
  return { sha256: sha(`${canonicalOwnedJson({ modules, materials })}\n`), modules, materials };
}

function ownedBuildInfo(modules = ownedModules()) {
  return [
    "/out/trivy: go1.27.3", `\tpath\t${OWNED_SCANNER.commandPath}`, `\tmod\t${OWNED_SCANNER.mainPath}\t(devel)`,
    ...modules.map((item) => `\tdep\t${item.path}\t${item.version}\t${item.sum}`),
    "\tbuild\t-buildmode=exe", "\tbuild\t-compiler=gc", "\tbuild\t-trimpath=true", "\tbuild\tCGO_ENABLED=0",
    "\tbuild\tGOARCH=amd64", "\tbuild\tGOOS=linux", "\tbuild\tGOAMD64=v1", "",
  ].join("\n");
}

function diagnosticReceipt(construction, binary) {
  const modules = ownedModules();
  return {
    schemaVersion: 1, receiptKind: OWNED_SCANNER.receiptKind, state: "BUILD_DIAGNOSTIC", construction,
    run: orchestrationRun,
    source: { repository: OWNED_SCANNER.sourceRepository, commit: OWNED_SCANNER.sourceCommit, tree: OWNED_SCANNER.sourceTree,
      patchSha256: OWNED_SCANNER.patchSha256, goModSha256: OWNED_SCANNER.goModSha256, goSumSha256: OWNED_SCANNER.goSumSha256 },
    compiler: { delivery: construction === "A" ? "BUILDER_IMAGE" : "OFFICIAL_ARCHIVE", goVersion: "go1.27.3", goos: "linux", goarch: "amd64", cgoEnabled: false,
      identity: construction === "A"
        ? { kind: "OCI_PLATFORM", reference: OWNED_SCANNER.builderReference, indexDigest: OWNED_SCANNER.builderIndexDigest, platformDigest: OWNED_SCANNER.builderPlatformDigest }
        : { kind: "GO_ARCHIVE", url: OWNED_SCANNER.goArchiveUrl, bytes: OWNED_SCANNER.goArchiveBytes, sha256: OWNED_SCANNER.goArchiveSha256 } },
    binary,
    build: { commandPath: OWNED_SCANNER.commandPath, appVersion: OWNED_SCANNER.applicationVersion,
      flags: ["-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid= -extldflags=-static -X github.com/aquasecurity/trivy/pkg/version/app.ver=0.76.1"],
      rawBuildInfo: ownedBuildInfo(modules) },
    closure: ownedClosure(modules),
    journal: [{ stage: "build", status: "ATTEMPTED", monotonicMs: 1 }, { stage: "build", status: "PASSED", monotonicMs: 2 }],
  };
}

function purl(name, version = "") { return `pkg:golang/${name}${version ? `@${version}` : ""}`; }
function pkg(Name, Version) { return { Name, ...(Version ? { Version } : {}), Identifier: { PURL: purl(Name, Version) } }; }
function finding(VulnerabilityID, PkgName, InstalledVersion, FixedVersion, Severity = "HIGH") {
  return { VulnerabilityID, PkgName, InstalledVersion, FixedVersion, Severity,
    PkgIdentifier: { PURL: purl(PkgName, InstalledVersion) } };
}

function selfReport(artifactName) {
  const packages = [pkg(OWNED_SCANNER.mainPath), pkg("stdlib", "v1.27.3"), ...ownedModules().map((item) => pkg(item.path, item.version))];
  return { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, ArtifactName: artifactName, ArtifactType: "filesystem",
    Results: [{ Target: "trivy", Class: "lang-pkgs", Type: "gobinary", Packages: packages }] };
}

function selfSbom(report) {
  const libraries = report.Results[0].Packages.map((item, index) => ({ type: "library", name: item.Name,
    ...(item.Version ? { version: item.Version } : {}), purl: item.Identifier.PURL, "bom-ref": `library-${index}` }));
  return { bomFormat: "CycloneDX", metadata: { component: { type: "application", name: report.ArtifactName, "bom-ref": "root" } },
    components: [{ type: "application", name: "trivy", "bom-ref": "application" }, ...libraries],
    dependencies: [{ ref: "root", dependsOn: ["application"] }, { ref: "application", dependsOn: [] },
      ...libraries.map((item) => ({ ref: item["bom-ref"], dependsOn: [] }))] };
}

function officialNegativeReport() {
  const vulnerable = pkg(OWNED_SCANNER.goJosePath, "v4.1.5");
  return { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, ArtifactName: "/official", ArtifactType: "filesystem",
    Results: [{ Target: "trivy", Class: "lang-pkgs", Type: "gobinary", Packages: [vulnerable],
      Vulnerabilities: [finding("CVE-2026-116587", vulnerable.Name, vulnerable.Version, "4.1.6")] }] };
}

function versionProbeReport() {
  return { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, ArtifactName: "/scanner-version-probe", ArtifactType: "filesystem",
    Results: [{ Target: "go.mod", Class: "lang-pkgs", Type: "gomod",
      Packages: [pkg("auto.world/scanner-version-probe"), pkg(OWNED_SCANNER.mainPath, "v0.76.1")] }] };
}

function fixtureReport(fixture, scannerVersion = "0.76.1") {
  if (fixture.id === "java-jar-clean-candidate") {
    return { SchemaVersion: 2, Trivy: { Version: scannerVersion }, ArtifactName: "/fixture", ArtifactType: "filesystem",
      Results: [{ Target: path.basename(fixture.material[0].path), Class: "lang-pkgs", Type: "jar",
        Packages: [pkg(fixture.expected.package, fixture.expected.version)] }] };
  }
  const expected = fixture.id === "gomod-vulnerable" ? fixture.expected.findings : [{ target: path.basename(fixture.material[0].path),
    id: fixture.expected.finding.id, package: fixture.expected.package, version: fixture.expected.version, fixedVersion: fixture.expected.finding.fixedVersion }];
  const groups = new Map();
  for (const item of expected) {
    const target = item.target;
    if (!groups.has(target)) groups.set(target, { packages: new Map(), vulnerabilities: [] });
    const group = groups.get(target), packageItem = pkg(item.package, item.version);
    group.packages.set(`${item.package}@${item.version}`, packageItem);
    group.vulnerabilities.push(finding(item.id, item.package, item.version, item.fixedVersion));
  }
  return { SchemaVersion: 2, Trivy: { Version: scannerVersion }, ArtifactName: "/fixture", ArtifactType: "filesystem",
    Results: [...groups].map(([target, group]) => ({ Target: target, Class: "lang-pkgs", Type: fixture.id.startsWith("gomod") ? "gomod" : "jar",
      Packages: [...group.packages.values()], Vulnerabilities: group.vulnerabilities })) };
}

const rustPairs = (role) => JSON.parse(readFileSync(new URL(`fixtures/scanner-official/${role}.pairs.json`, import.meta.url), "utf8"));
function rustReport(role) {
  const packages = rustPairs(role).map(([name, version]) => pkg(name, version));
  const vulnerabilities = role === "cargo-lock-vulnerable"
    ? [finding("RUSTSEC-2019-0001", "ammonia", "1.9.0", "2.1.0")] : undefined;
  return { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, CreatedAt: new Date().toISOString(),
    ArtifactName: `/${role}`, ArtifactType: "filesystem", Results: [{ Target: "Cargo.lock", Class: "lang-pkgs", Type: "cargo",
      Packages: packages, ...(vulnerabilities ? { Vulnerabilities: vulnerabilities } : {}) }] };
}

function builderProof(binary) {
  const subject = { role: "go-builder", repository: "library/golang", version: "1.27.3-alpine3.24",
    manifestDigest: OWNED_SCANNER.builderIndexDigest,
    platform: { os: "linux", architecture: "amd64", variant: null, digest: OWNED_SCANNER.builderPlatformDigest } };
  const artifactName = `${subject.repository}@${OWNED_SCANNER.builderPlatformDigest}`;
  const report = { SchemaVersion: 2, Trivy: { Version: "0.76.1" }, CreatedAt: new Date().toISOString(),
    ArtifactName: artifactName, ArtifactType: "container_image", Metadata: { ImageConfig: { os: "linux", architecture: "amd64" } },
    Results: [{ Target: "lib/apk/db/installed", Class: "os-pkgs", Type: "alpine",
      Packages: [pkg("alpine-baselayout", "3.7.1-r0")] }] };
  const sbom = { bomFormat: "CycloneDX", metadata: { component: { type: "container", name: artifactName } },
    components: [{ type: "library", name: "alpine-baselayout", version: "3.7.1-r0", purl: purl("alpine-baselayout", "3.7.1-r0") }] };
  return validateOwnedBuilderAudit({ run: orchestrationRun, binary, databaseJoin, subject, report, sbom,
    inventory: { packageCount: 1, applicationCount: 0, operatingSystemCount: 0 }, now: new Date() });
}

function createQualificationHarness(t, { failAt = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-owned-qualification-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, "work"), fixtureRoot = path.join(root, "fixtures"), controlsRoot = path.join(root, "controls");
  mkdirSync(work); mkdirSync(fixtureRoot); mkdirSync(controlsRoot);
  mkdirSync(path.join(root, "subject-a")); mkdirSync(path.join(root, "official"));
  writeFileSync(path.join(root, "official-trivy"), "official scanner");
  mkdirSync(path.join(root, "scanner-version-probe"));
  for (const fixture of scannerFixtures) {
    const relative = fixture.material[0].path.startsWith("gomod/") ? "gomod" : fixture.material[0].path;
    mkdirSync(path.dirname(path.join(fixtureRoot, relative)), { recursive: true });
    if (!relative.endsWith("gomod")) writeFileSync(path.join(fixtureRoot, relative), "fixture");
  }
  const binaryBytes = Buffer.from("same owned scanner bytes\n"), binaryHash = sha(binaryBytes);
  const binaryAPath = path.join(root, "a", "trivy"), binaryBPath = path.join(root, "b", "trivy");
  mkdirSync(path.dirname(binaryAPath)); mkdirSync(path.dirname(binaryBPath));
  writeFileSync(binaryAPath, binaryBytes); writeFileSync(binaryBPath, binaryBytes);
  const binary = { path: "/out/trivy", bytes: binaryBytes.length, sha256: binaryHash };
  const buildA = diagnosticReceipt("A", binary), buildB = diagnosticReceipt("B", binary);
  const pair = validateReproduciblePair(buildA, buildB);
  const controlFixturePaths = rustMetadata.controls.map((control) => {
    const directory = path.join(controlsRoot, control.role); mkdirSync(directory);
    const file = path.join(directory, "Cargo.lock");
    const expected = rustMetadata.files.find((item) => item.path === control.lockPath);
    const bytes = Buffer.alloc(expected.bytes, control.role === "cargo-lock-clean" ? 0x43 : 0x56);
    writeFileSync(file, bytes);
    return { sourcePath: control.lockPath, path: file, bytes: bytes.length, sha256: sha(bytes) };
  });
  // The validator joins the measured fixture identity supplied by the build. The
  // test uses synthetic bytes, so retain their independently measured identity.
  const built = { binaryAPath, binaryBPath, candidatePath: binaryAPath, rawBuildInfo: { A: ownedBuildInfo(), B: ownedBuildInfo() },
    receipts: { buildA, buildB }, controlFixturePaths,
    releasedPrivateResources: [{ path: "released-source", absent: true }],
    cleanup: { ownedPaths: [root], cleanupDuplicate() {
      events.push("cleanup-duplicate");
      if (failAt !== "cleanup") rmSync(path.dirname(binaryBPath), { recursive: true });
    } } };
  const publicEvidence = createOwnedPublicEvidence(path.join(root, "public"), orchestrationRun);
  const events = [], states = [];
  const reports = new Map();
  const put = (file, report, label) => { events.push(label); writeFileSync(file, `${JSON.stringify(report)}\n`); };
  const command = (executable, args, options) => {
    assert.equal(options.maxOutputBytes, 8 * 1024 ** 2, "every owned qualification command must retain the 8 MiB output cap");
    const name = path.basename(options.file);
    if (name === "owned-version.txt") {
      assert.equal(executable, built.candidatePath);
      assert.deepEqual(args, ["--version"]);
      assert.equal(options.timeout, 30_000);
      assert.equal(options.privateOutput, true);
      events.push("owned-version");
      return Buffer.from(failAt === "wrong-version" ? "Version: 0.76.2\n" : "Version: 0.76.1\n");
    }
    if (failAt && name.includes(failAt)) throw new Error(`injected_failure:${failAt}`);
    if (name === "official-negative.json") return put(options.file, officialNegativeReport(), "negative");
    if (name.startsWith("self-") && name.endsWith(".cdx.json")) {
      const jsonName = name.replace(".cdx.json", ".json"), report = reports.get(jsonName);
      return put(options.file, selfSbom(report), `self:${name}`);
    }
    if (name.startsWith("self-") && name.endsWith(".json")) {
      const artifactName = name.includes("aona") || name.includes("bona") ? "/subject-a" : "/b";
      const report = selfReport(artifactName); reports.set(name, report); return put(options.file, report, `self:${name}`);
    }
    if (name.startsWith("probe-")) return put(options.file, versionProbeReport(), `control:${name}`);
    if (name.includes("-baseline.json")) {
      const baselineFixture = scannerFixtures.find((entry) => name.includes(`fixture-${entry.id}-baseline`));
      return put(options.file, fixtureReport(baselineFixture, "0.74.0"), `baseline:${baselineFixture.id}`);
    }
    const fixture = scannerFixtures.find((entry) => name.includes(`fixture-${entry.id}-`));
    if (fixture) return put(options.file, fixtureReport(fixture), `control:${name}`);
    const rust = rustMetadata.controls.find((entry) => name === `${entry.role}-owned.json` || name === `${entry.role}-reference.json`);
    if (rust) return put(options.file, rustReport(rust.role), `control:${name}`);
    throw new Error(`unexpected_test_command:${name}`);
  };
  return { root, work, fixtureRoot, built, pair, publicEvidence, events, states, command,
    subject: path.join(root, "subject-a"), referenceSubject: path.join(root, "official"), referenceScanner: path.join(root, "official-trivy"),
    probe: path.join(root, "scanner-version-probe"), fixtures: scannerFixtures,
    lock: { baseline: { version: "0.74.0", repository: "aquasec/trivy", platformDigest: `sha256:${repeatedHash("9")}` } },
    rustMetadata, databaseJoin, carrier: `aquasec/trivy@sha256:${repeatedHash("8")}`, cache: path.join(root, "cache"),
    checkInputs: async () => true,
    auditBuilder: async () => { events.push("builder"); if (failAt === "builder") throw new Error("injected_failure:builder"); return builderProof(binary); },
    onState: (snapshot) => states.push(snapshot),
  };
}

test("owned qualification runs negative, four self/cross pairs, six same-database controls, two legacy baselines, then builder", async (t) => {
  const harness = createQualificationHarness(t);
  const receipt = await qualifyOwnedScanner(harness);
  assert.equal(receipt.state, "QUALIFIED_FOR_THIS_JOB");
  assert.deepEqual(harness.events.slice(0, 2), ["negative", "owned-version"]);
  assert.equal(harness.events.filter((item) => item.startsWith("self:")).length, 8);
  assert.equal(harness.events.filter((item) => item.startsWith("baseline:")).length, 2);
  const controlNames = harness.publicEvidence.manifest().files.filter((item) => item.path.endsWith("-owned.json")).map((item) => item.path);
  assert.deepEqual(controlNames.sort(), ["cargo-lock-clean-owned.json", "cargo-lock-vulnerable-owned.json", "fixture-gomod-vulnerable-owned.json",
    "fixture-java-jar-clean-candidate-owned.json", "fixture-java-war-vulnerable-owned.json", "version-probe-owned.json"]);
  assert.deepEqual(harness.events.slice(-2), ["cleanup-duplicate", "builder"]);
  assert.equal(harness.states.at(-1).state, "QUALIFIED_FOR_THIS_JOB");
});

for (const [label, failAt, lastAllowedState, cleanupExpected] of [
  ["negative control", "official-negative", "BUILD_DIAGNOSTIC", false],
  ["self audit", "self-aona.json", "IDENTITY_REPRODUCIBLE", false],
  ["fixture control", "fixture-gomod-vulnerable-owned", "SELF_AUDITED", false],
  ["Rust control", "cargo-lock-vulnerable-owned", "SELF_AUDITED", false],
  ["builder audit", "builder", "CONTROLS_PASSED", true],
]) {
  test(`${label} failure cannot produce qualification and respects the duplicate cleanup boundary`, async (t) => {
    const harness = createQualificationHarness(t, { failAt });
    await assert.rejects(qualifyOwnedScanner(harness), new RegExp(`injected_failure:${failAt}`));
    assert.equal(harness.states.some((snapshot) => snapshot.state === "QUALIFIED_FOR_THIS_JOB"), false);
    assert.equal(harness.states.at(-1).state, lastAllowedState);
    assert.equal(harness.states.at(-1).firstFailure, `injected_failure:${failAt}`);
    assert.equal(harness.events.includes("cleanup-duplicate"), cleanupExpected);
  });
}

test("wrong owned application version refuses self scans and qualification", async (t) => {
  const harness = createQualificationHarness(t, { failAt: "wrong-version" });
  await assert.rejects(qualifyOwnedScanner(harness), /scanner_owned_version_invalid/u);
  assert.deepEqual(harness.events, ["negative", "owned-version"]);
  assert.equal(harness.states.at(-1).state, "IDENTITY_REPRODUCIBLE");
  assert.equal(harness.states.at(-1).firstFailure, "scanner_owned_version_invalid");
  assert.equal(harness.states.some((snapshot) => snapshot.state === "QUALIFIED_FOR_THIS_JOB"), false);
});

test("mutated entry binary records the first failure before any qualification command", async (t) => {
  const harness = createQualificationHarness(t);
  writeFileSync(harness.built.binaryAPath, "mutated owned scanner");
  await assert.rejects(qualifyOwnedScanner(harness), /scanner_owned_binary_join_invalid/u);
  assert.deepEqual(harness.events, []);
  assert.equal(harness.states.length, 1);
  assert.equal(harness.states[0].state, "BUILD_DIAGNOSTIC");
  assert.equal(harness.states[0].firstFailure, "scanner_owned_binary_join_invalid");
});

test("uncertain duplicate cleanup cannot produce qualification after builder audit", async (t) => {
  const harness = createQualificationHarness(t, { failAt: "cleanup" });
  await assert.rejects(qualifyOwnedScanner(harness), /scanner_owned_qualification_proof_invalid/u);
  assert.equal(harness.states.some((snapshot) => snapshot.state === "QUALIFIED_FOR_THIS_JOB"), false);
  assert.equal(harness.states.at(-1).state, "BUILDER_AUDITED");
  assert.equal(harness.states.at(-1).firstFailure, "scanner_owned_cleanup_uncertain");
  assert.equal(existsSync(path.dirname(harness.built.binaryBPath)), true);
});

function manifestDirectory(root, entryCount) {
  const source = path.join(root, `build-${entryCount}`); mkdirSync(source);
  const files = [];
  for (let index = 0; index < entryCount; index += 1) {
    const name = `receipt-${String(index).padStart(3, "0")}.json`, bytes = Buffer.from(`${canonicalOwnedJson({ index, run })}\n`);
    writeFileSync(path.join(source, name), bytes);
    files.push({ path: name, bytes: bytes.length, sha256: sha(bytes), mediaType: "application/json" });
  }
  const manifest = { schemaVersion: 1, kind: "OWNED_SCANNER_PUBLIC_EVIDENCE_V1", run, files };
  writeFileSync(path.join(source, "public-manifest.json"), `${canonicalOwnedJson(manifest)}\n`);
  return { root: source, manifest };
}

test("publication accepts exactly 128 aggregate entries including source and wrapper manifests", async (t) => {
  const { root, destination } = setup(t), directory = manifestDirectory(root, 126);
  const result = await publishOwnedScannerEvidence({ directories: [["build", directory]], destination, run, exportDirectory });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "build");
  assert.equal(result[0].files, 126);
  assert.equal(existsSync(path.join(destination, "build/public-manifest.json")), true);
  assert.equal(existsSync(path.join(destination, "build-manifest.json")), true);
});

test("publication rejects 129 aggregate entries after counting source and wrapper manifests", async (t) => {
  const { root, destination } = setup(t);
  const directory = manifestDirectory(root, 127);
  await assert.rejects(publishOwnedScannerEvidence({ directories: [["build", directory]], destination, run, exportDirectory }),
    /scanner_owned_public_budget_exceeded/u);
  assert.equal(existsSync(destination), false);
});
