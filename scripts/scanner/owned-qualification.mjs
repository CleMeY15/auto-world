import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { baselineFixtureArguments, candidateDockerArguments, fixtureScanMode } from "./audit.mjs";
import { assertFilesUnchanged, captureFiles, readBoundedJson, validateFixtureReport } from "./controls.mjs";
import { validateVersionProbeReport } from "./official-controls.mjs";
import { seaweedRustScanArguments, validateSeaweedRustControlReport } from "./seaweed-rust-source.mjs";
import { canonicalOwnedJson, OwnedQualificationLifecycle, validateLegacyBaselineConservation, validateOfficialNegativeControl,
  validateOwnedControlSet, validateOwnedPublicEvidenceDirectory, validateOwnedQualificationProof,
  validateReproduciblePair, validateSameDatabaseComparison, validateSelfAuditSet } from "./owned-controls.mjs";

const MiB = 1024 ** 2;
const fail = (code) => { throw new Error(code); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function captureOwnedScannerPair(built, expectedRun) {
  const pair = validateReproduciblePair(built.receipts.buildA, built.receipts.buildB,
    Buffer.from(built.rawBuildInfo.A), Buffer.from(built.rawBuildInfo.B));
  if (canonicalOwnedJson(pair.run) !== canonicalOwnedJson(expectedRun)) fail("scanner_owned_run_join_invalid");
  const files = await captureFiles([built.binaryAPath, built.binaryBPath].map((file) => ({ path: file, cap: 256 * MiB })));
  if (files.some((file) => file.sha256 !== pair.binary.sha256 || file.size !== pair.binary.bytes)) fail("scanner_owned_binary_join_invalid");
  return { pair, files };
}

// This writer only receives validated reports and structured receipts, never process output.
export function createOwnedPublicEvidence(root, run) {
  mkdirSync(root, { mode: 0o700 });
  const files = [];
  return Object.freeze({
    root,
    write(name, value) {
      if (!/^[a-z0-9][a-z0-9.-]*\.json$/u.test(name) || files.some((entry) => entry.path === name)) fail("scanner_owned_public_name_invalid");
      const bytes = Buffer.from(`${canonicalOwnedJson(value)}\n`);
      if (bytes.length > 4 * MiB || files.length >= 127 || files.reduce((sum, entry) => sum + entry.bytes, 0) + bytes.length > 64 * MiB) {
        fail("scanner_owned_public_budget_exceeded");
      }
      writeFileSync(path.join(root, name), bytes, { flag: "wx", mode: 0o400 });
      files.push({ path: name, bytes: bytes.length, sha256: hash(bytes), mediaType: "application/json" });
    },
    manifest() { return { schemaVersion: 1, kind: "OWNED_SCANNER_PUBLIC_EVIDENCE_V1", run, files: [...files] }; },
  });
}

export async function qualifyOwnedScanner({ built, pair, carrier, cache, subject, referenceSubject, referenceScanner,
  probe, fixtures, fixtureRoot, lock, rustMetadata, databaseJoin, command, work, publicEvidence, checkInputs, auditBuilder, onState }) {
  const lifecycle = new OwnedQualificationLifecycle({ run: pair.run, source: pair.source, binary: pair.binary, databaseJoin });
  const binding = { run: pair.run, binary: pair.binary, databaseJoin };
  let pairFiles;
  const checkPair = async () => { await checkInputs(); await assertFilesUnchanged(pairFiles); };
  const advance = (current, next, evidence) => {
    const snapshot = lifecycle.advance(current, next, { proof: evidence });
    onState(snapshot);
  };
  const scan = async (scanner, mode, target, name, format = "json", extra = ["--offline-scan"]) => {
    await checkPair();
    const file = path.join(work, `${name}.${format === "json" ? "json" : "cdx.json"}`);
    command("/usr/bin/docker", candidateDockerArguments({ carrier, scanner, cache, mode, target, format, extra }), { file, privateOutput: true, maxOutputBytes: 8 * MiB });
    const report = (await readBoundedJson(file, 4 * MiB)).value;
    await checkPair();
    return report;
  };
  try {
    pairFiles = (await captureOwnedScannerPair(built, pair.run)).files;
    const negative = await scan(referenceScanner, "rootfs", referenceSubject, "official-negative");
    const negativeResult = validateOfficialNegativeControl(negative);
    publicEvidence.write("official-negative.json", negative);
    publicEvidence.write("official-negative-result.json", negativeResult);
    advance("BUILD_DIAGNOSTIC", "IDENTITY_REPRODUCIBLE", pair);
    const version = command(built.candidatePath, ["--version"], { file: path.join(work, "owned-version.txt"),
      timeout: 30_000, privateOutput: true, maxOutputBytes: 8 * MiB }).toString("utf8");
    if (!/^Version: 0\.76\.1\r?$/mu.test(version)) fail("scanner_owned_version_invalid");
    publicEvidence.write("application-version.json", { ...binding, applicationVersion: "0.76.1" });
    const reports = {}, sboms = {};
    for (const [name, scanner, target] of [
      ["aOnA", built.binaryAPath, subject], ["aOnB", built.binaryAPath, path.dirname(built.binaryBPath)],
      ["bOnA", built.binaryBPath, subject], ["bOnB", built.binaryBPath, path.dirname(built.binaryBPath)],
    ]) {
      reports[name] = await scan(scanner, "rootfs", target, `self-${name.toLowerCase()}`);
      sboms[name] = await scan(scanner, "rootfs", target, `self-${name.toLowerCase()}`, "cyclonedx");
      if (reports[name].ArtifactName !== `/${path.basename(target)}` || reports[name].Results?.[0]?.Target !== "trivy") {
        fail("scanner_owned_self_subject_invalid");
      }
    }
    const self = validateSelfAuditSet({ reports, sboms, pair, databaseJoin });
    for (const name of Object.keys(reports)) {
      publicEvidence.write(`self-${name.toLowerCase()}.json`, reports[name]);
      publicEvidence.write(`self-${name.toLowerCase()}.cdx.json`, sboms[name]);
    }
    advance("IDENTITY_REPRODUCIBLE", "SELF_AUDITED", self);
    const comparisons = [], legacyBaselines = [];
    const compare = (name, owned, official) => {
      comparisons.push(validateSameDatabaseComparison({ owned, official, databaseJoin, controlName: name }));
      publicEvidence.write(`${name}-owned.json`, owned); publicEvidence.write(`${name}-reference.json`, official);
    };
    const candidateProbe = await scan(built.candidatePath, "fs", probe, "probe-owned");
    const referenceProbe = await scan(referenceScanner, "fs", probe, "probe-reference");
    for (const report of [candidateProbe, referenceProbe]) validateVersionProbeReport(report, "0.76.1", { expectedScannerVersion: "0.76.1" });
    compare("version-probe", candidateProbe, referenceProbe);
    for (const fixture of fixtures) {
      const relative = fixture.material[0].path.startsWith("gomod/") ? "gomod" : fixture.material[0].path;
      const target = path.join(fixtureRoot, relative), mode = fixtureScanMode(fixture);
      const candidate = await scan(built.candidatePath, mode, target, `fixture-${fixture.id}-owned`);
      const official = await scan(referenceScanner, mode, target, `fixture-${fixture.id}-reference`);
      const observed = validateFixtureReport(fixture, candidate, "0.76.1");
      validateFixtureReport(fixture, official, "0.76.1");
      compare(`fixture-${fixture.id}`, candidate, official);
      if (fixture.id !== "java-jar-clean-candidate") {
        const baselineFile = path.join(work, `fixture-${fixture.id}-baseline.json`);
        command("/usr/bin/docker", baselineFixtureArguments(lock, cache, fixtureRoot, mode, relative), { file: baselineFile, privateOutput: true, maxOutputBytes: 8 * MiB });
        const baseline = (await readBoundedJson(baselineFile, 4 * MiB)).value;
        legacyBaselines.push(validateLegacyBaselineConservation({ controlName: `fixture-${fixture.id}`, observed,
          baseline: validateFixtureReport(fixture, baseline, lock.baseline.version) }));
        publicEvidence.write(`fixture-${fixture.id}-baseline.json`, baseline);
        await checkPair();
      }
    }
    for (const control of rustMetadata.controls) {
      const fixture = built.controlFixturePaths.find((entry) => entry.sourcePath === control.lockPath);
      if (!fixture) fail("scanner_owned_rust_fixture_missing");
      const [identity] = await captureFiles([{ path: fixture.path, cap: MiB }]);
      if (identity.size !== fixture.bytes || identity.sha256 !== fixture.sha256) fail("scanner_owned_rust_fixture_changed");
      const view = path.dirname(fixture.path);
      const reports = [];
      for (const [producer, scanner] of [["owned", built.candidatePath], ["reference", referenceScanner]]) {
        await checkPair(); await assertFilesUnchanged([identity]);
        const file = path.join(work, `${control.role}-${producer}.json`);
        command("/usr/bin/docker", seaweedRustScanArguments({ carrier, scanner, cache, view }), { file, privateOutput: true, maxOutputBytes: 8 * MiB });
        const report = (await readBoundedJson(file, 4 * MiB)).value;
        validateSeaweedRustControlReport({ control: control.role, report, metadata: rustMetadata, artifactName: `/${path.basename(view)}` });
        reports.push(report);
        await checkPair(); await assertFilesUnchanged([identity]);
      }
      compare(control.role, reports[0], reports[1]);
    }
    const controls = validateOwnedControlSet({ ...binding, comparisons, officialNegative: negativeResult, legacyBaselines });
    advance("SELF_AUDITED", "CONTROLS_PASSED", controls);
    // Remove B only after its final cross-control, then prove absence before downstream work.
    await checkPair(); built.cleanup.cleanupDuplicate();
    const builder = await auditBuilder(built.candidatePath);
    advance("CONTROLS_PASSED", "BUILDER_AUDITED", builder);
    const privateRoot = built.cleanup.ownedPaths[0];
    const cleanup = { constructionResourcesAbsent: Array.isArray(built.releasedPrivateResources) && built.releasedPrivateResources.length > 0 &&
      built.releasedPrivateResources.every((entry) => entry.absent === true && /^[a-z0-9.-]+$/u.test(entry.path) && !existsSync(path.join(privateRoot, entry.path))),
    duplicateBAbsent: !existsSync(path.dirname(built.binaryBPath)), candidateARetained: existsSync(built.candidatePath) };
    lifecycle.recordCleanup(cleanup);
    advance("BUILDER_AUDITED", "QUALIFIED_FOR_THIS_JOB", validateOwnedQualificationProof({ pair, self, controls, builder, cleanup }));
    const receipt = lifecycle.receipt();
    publicEvidence.write("qualification.json", receipt);
    return receipt;
  } catch (error) {
    lifecycle.fail(error.message); onState(lifecycle.snapshot());
    throw error;
  }
}

// Validate every source directory before publishing any payload. Manifest files are emitted last.
export async function publishOwnedScannerEvidence({ directories, destination, run, exportDirectory }) {
  const validated = [];
  for (const [name, directory] of directories) {
    if (!/^[a-z][a-z-]*$/u.test(name)) fail("scanner_owned_public_name_invalid");
    const manifest = typeof directory.manifest === "function" ? directory.manifest() : directory.manifest;
    validated.push({ name, directory, manifest,
      checked: await validateOwnedPublicEvidenceDirectory(directory.root, manifest, run) });
  }
  if (validated.reduce((sum, entry) => sum + entry.checked.files.length + 1 + (existsSync(path.join(entry.directory.root, "public-manifest.json")) ? 1 : 0), 0) > 128 ||
      validated.reduce((sum, entry) => sum + entry.checked.totalBytes + Buffer.byteLength(canonicalOwnedJson(entry.manifest)) + 1, 0) > 64 * MiB) {
    fail("scanner_owned_public_budget_exceeded");
  }
  const staging = `${destination}-pending`;
  mkdirSync(staging, { mode: 0o700 });
  for (const { name, directory, manifest } of validated) {
    const copy = path.join(staging, name);
    exportDirectory(directory.root, copy);
    await validateOwnedPublicEvidenceDirectory(copy, manifest, run);
    // Build directories already contain their canonical manifest; control manifests are produced here.
    const target = path.join(staging, `${name}-manifest.json`);
    writeFileSync(target, `${canonicalOwnedJson(manifest)}\n`, { flag: "wx", mode: 0o400 });
  }
  renameSync(staging, destination);
  return validated.map(({ name, checked }) => ({ name, files: checked.files.length, bytes: checked.totalBytes }));
}
