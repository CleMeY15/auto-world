import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { mock, test } from "node:test";
import { runOfficialImageAudits } from "../scripts/scanner/official-audit.mjs";
import { readComparisonCheckpoint } from "../scripts/scanner/official-comparison-checkpoint.mjs";

const config = JSON.parse(readFileSync(new URL("../infra/scanner/official-release.json", import.meta.url)));
const evidence = new URL("../docs/validation/opensearch-310/", import.meta.url);
const fixtures = new URL("./fixtures/scanner-official/opensearch-comparison-pr253/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name + ".json", evidence)));
const historical = read("official-audit-receipt");
const candidateRole = "opensearch-candidate";
const previousRole = "aws-cli-previous";
const candidateDigest = read("3.10.0-index").manifests.find((p) => p.platform.architecture === "amd64").digest;
const candidateRef = "opensearchproject/opensearch@" + candidateDigest;
const subjects = [...config.images, historical.awsComparator.previousSubject];
const refOf = (image) => image.repository + "@" + image.platform.digest;
const roles = new Map([...subjects.map((image) => [refOf(image), image.role]), [candidateRef, candidateRole]]);
const formats = ["json", "cyclonedx"];
const reportFile = (role, format) => "image-" + role + (format === "json" ? ".json" : ".cdx.json");
const disk = (dir, file) => JSON.parse(readFileSync(path.join(dir, file)));
const identity = (bytes) => ({ sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });

// Public ZIP 14436050679, push 44321947040/1. Verify each exact member against
// its original receipt before applying any explicitly synthetic scenario edits.
function original(role, format) {
  const entry = [...historical.reports, ...historical.awsComparator.control.reports].find((row) => row.role === role);
  const bytes = readFileSync(new URL(reportFile(role, format), role === "opensearch" ? evidence : fixtures));
  assert.deepEqual(identity(bytes), entry.report[formats.indexOf(format)]);
  return bytes;
}

// This is a transport fixture, never an observed 3.10 scan. Model retained
// coordinates at still-shipped paths, apply the published per-copy mappings,
// and emit the seven historical below-floor occurrences plus one new finding.
function syntheticCandidate() {
  const json = JSON.parse(original("opensearch", "json"));
  const sbom = JSON.parse(original("opensearch", "cyclonedx"));
  const manifest = read("3.10.0-platform"), imageConfig = read("3.10.0-config");
  const diffIds = imageConfig.rootfs.diff_ids;
  // The uncompressed sizes are synthetic. Only layer digests and DiffIDs
  // come from the pinned candidate manifest and config.
  const layers = manifest.layers.map((layer, i) => ({ Size: json.Metadata.Layers[i].Size, Digest: layer.digest, DiffID: diffIds[i] }));
  Object.assign(json.Metadata, { Reference: candidateRef, ImageID: manifest.config.digest, RepoDigests: [candidateRef],
    ImageConfig: imageConfig, DiffIDs: diffIds, Layers: layers });
  json.ArtifactName = candidateRef;
  json.Results[0].Target = candidateRef + " (amazon " + json.Metadata.OS.Name + ")";
  const component = sbom.metadata.component;
  component.name = candidateRef;
  component["bom-ref"] = component.purl = component.purl.replace(config.images.find((pin) => pin.role === "opensearch").platform.digest, candidateDigest);
  const prop = (key, value) => ({ name: "aquasecurity:trivy:" + key, value });
  component.properties = [...[...diffIds].sort().map((id) => prop("DiffID", id)), prop("Reference", candidateRef),
    prop("ImageID", manifest.config.digest), prop("RepoDigest", candidateRef)];
  sbom.components = sbom.components.filter((c) => !c.purl?.startsWith("pkg:maven/"));
  sbom.dependencies = [];
  sbom.vulnerabilities = [];

  const shipped = new Set(read("jar-paths"));
  const rows = read("matched-82");
  const copy = (file, name, version) => JSON.stringify([file, name, version]);
  const mapped = new Map(rows.map(({ original: old, candidate }) => [copy(old.PkgPath, old.PkgName, old.InstalledVersion), candidate]));
  const java = json.Results.find((result) => result.Type === "jar");
  java.Packages = java.Packages.flatMap((pkg) => {
    const replacement = mapped.get(copy(pkg.FilePath, pkg.Name, pkg.Version));
    const file = replacement?.[0] ?? pkg.FilePath;
    if (!shipped.has(file)) return [];
    const [group, name] = pkg.Name.split(":");
    const version = replacement?.[2].version ?? pkg.Version;
    const purl = "pkg:maven/" + group + "/" + name + "@" + version;
    sbom.components.push({ "bom-ref": "synthetic-" + sbom.components.length, type: "library", group, name, version, purl,
      properties: [prop("PkgType", "jar"), prop("FilePath", file)] });
    return [{ Name: pkg.Name, Version: version, FilePath: file, Identifier: { PURL: purl } }];
  });
  java.Vulnerabilities = rows.filter((row) => !row.meetsOriginalThreshold).map(({ original: old, candidate }) => ({
    VulnerabilityID: old.VulnerabilityID, Severity: old.Severity, FixedVersion: old.FixedVersion, PkgName: old.PkgName,
    PkgPath: candidate[0], InstalledVersion: candidate[2].version,
  }));
  assert.equal(java.Vulnerabilities.length, 7);
  java.Vulnerabilities.push({ ...java.Vulnerabilities[0], VulnerabilityID: "CVE-SYNTHETIC-NEW" });
  return { json, cyclonedx: sbom };
}

function reportBytes(role, format, scenario, candidate) {
  if (role === candidateRole) return Buffer.from(JSON.stringify(candidate[format]));
  const bytes = original(role, format);
  if (format !== "json") return bytes;
  if (role === "redis" && scenario === "technical") return Buffer.from("{");
  if (role === previousRole && scenario === "aws-failure") {
    const json = JSON.parse(bytes);
    json.Metadata.ImageID = "sha256:" + "0".repeat(64);
    return Buffer.from(JSON.stringify(json));
  }
  if (role === "seaweedfs" && scenario === "mixed") {
    const json = JSON.parse(bytes);
    json.Metadata.OS.EOSL = true;
    json.Results.find((row) => row.Type === "gobinary").Vulnerabilities.splice(1);
    return Buffer.from(JSON.stringify(json));
  }
  if (scenario === "clean-five" && role !== previousRole) {
    const json = JSON.parse(bytes);
    for (const result of json.Results) delete result.Vulnerabilities;
    return Buffer.from(JSON.stringify(json));
  }
  return bytes;
}

// Runs in its own process. Only host capacity, clock, Docker and the outer
// frozen-input hooks are simulated. Orchestration, parsing, policy, checkpoint
// readback, per-copy inventory and delta publication use production functions.
async function worker(scenario, output) {
  const now = Date.parse("2026-11-18T15:00:00Z");
  mock.timers.enable({ apis: ["Date"], now });
  process.env.AW_RAW_STEP_STARTED_SECONDS = String(now / 1000);
  mock.method(fsPromises, "statfs", async (directory, options) => {
    assert.equal(directory, output);
    assert.equal(options.bigint, true);
    return { bavail: 4n * 1024n ** 2n, bsize: 4096n };
  });
  syncBuiltinESMExports();
  const receipt = { run: { ...historical.run, GITHUB_REPOSITORY: "fixture/auto-world", GITHUB_RUN_ID: "1" }, scope: "upstream", commands: [],
    awsComparisonInputs: globalThis.structuredClone(historical.awsComparisonInputs) };
  if (scenario === "clean-five") {
    // Clearing current findings models a changed database. Identical inputs
    // would (correctly) require the original 82 ordered OpenSearch blockers.
    receipt.awsComparisonInputs.databaseFiles.find((p) => p.file === "db/trivy.db").sha256 = "1".repeat(64);
  }
  if (scenario === "interrupt") {
    mock.method(Date, "now", () => {
      const states = receipt.openSearchComparator?.formats;
      // Kill at CycloneDX's time-budget preflight. JSON has returned from the
      // transport, passed readback and policy parsing, and been marked captured.
      if (states?.[0]?.status === "captured" && states[1]?.format === "cyclonedx") process.kill(process.pid, "SIGKILL");
      return now;
    });
  }
  const owner = randomUUID();
  let candidate;
  function command(executable, args, { file }) {
    assert.equal(executable, "/usr/bin/docker");
    const reference = args.at(-1), role = roles.get(reference), format = args[args.indexOf("--format") + 1];
    assert.ok(role && formats.includes(format));
    assert.equal(args[args.indexOf("--image-src") + 1], "remote");
    appendFileSync(path.join(output, "docker.jsonl"), JSON.stringify({ role, format }) + "\n");
    if (role === candidateRole) candidate ??= syntheticCandidate();
    const bytes = reportBytes(role, format, scenario, candidate);
    writeFileSync(file, bytes, { flag: "wx" });
    const lease = { name: "aw-official-" + randomUUID(), owner };
    receipt.commands.push({ executable: "docker", exitCode: 0, error: null, signal: null, lease,
      cleanup: { inspected: 1, removed: false }, ownedContainerAbsent: true,
      scan: { role, format, reference, lease: { ...lease }, output: identity(bytes) } });
    return bytes;
  }
  try {
    await runOfficialImageAudits({ output, config, receipt, localImages: new Map(), carrier: "aquasec/trivy@sha256:" + "a".repeat(64),
      scanner: path.join(output, "scanner"), cache: path.join(output, "cache"), command, beforeScan() {}, afterScan() {} });
  } catch (error) {
    receipt.failure = error.message;
  } finally {
    writeFileSync(path.join(output, "official-audit-receipt.json"), JSON.stringify(receipt));
  }
}

function run(t, scenario, candidateFormats) {
  const output = mkdtempSync(path.join(tmpdir(), "raw-opensearch-"));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [import.meta.filename, "worker", scenario, output], { encoding: "utf8", timeout: 60_000 });
  assert.ifError(child.error);
  assert.equal(child.signal, scenario === "interrupt" ? "SIGKILL" : null, child.stderr);
  assert.equal(child.status, scenario === "interrupt" ? null : 0, child.stderr);
  const calls = readFileSync(path.join(output, "docker.jsonl"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(calls, [...subjects.flatMap(({ role }) => formats.map((format) => ({ role, format }))),
    ...candidateFormats.map((format) => ({ role: candidateRole, format }))]);
  return output;
}

async function recover(output) {
  assert.equal(existsSync(path.join(output, "official-audit-receipt.json")), false);
  const saved = await readComparisonCheckpoint({ config, output });
  assert.deepEqual(saved.reasons, []);
  assert.equal(saved.eligible, true);
  assert.deepEqual(saved.candidateEvidence, { state: "partial", files: [reportFile(candidateRole, "json")] });
  assert.equal(saved.checkpoint.awsComparator.qualification, "passed");
  assert.equal(saved.checkpoint.awsComparator.oldPolicy, "blocked");
  const five = disk(output, saved.checkpoint.fiveImageEvidence.file);
  assert.deepEqual(five, { reports: historical.reports, rejections: historical.rejections, blockers: historical.blockers });
  assert.equal(saved.checkpoint.commands.length, 12);
  for (const [i, { index, record, report, role, format }] of saved.checkpoint.commands.entries()) {
    assert.equal(index, i + 1);
    assert.equal(record.ownedContainerAbsent, true);
    assert.deepEqual(record.scan, { role, format, reference: refOf(subjects[Math.floor(i / 2)]), lease: record.lease,
      output: identity(readFileSync(path.join(output, report.file))) });
  }
}

if (process.argv[2] === "recover") {
  await recover(process.argv[3]);
} else if (process.argv[2] === "worker") {
  await worker(process.argv[3], process.argv[4]);
} else {
  for (const scenario of ["historical", "clean-five"]) {
    test("raw audit measures a blocked synthetic 3.10 after " + scenario, (t) => {
      const output = run(t, scenario, formats);
      const receipt = disk(output, "official-audit-receipt.json");
      const clean = scenario === "clean-five";
      assert.equal(receipt.fiveImageResult, clean ? "passed" : "rejected");
      assert.deepEqual(receipt.blockers, clean ? [] : historical.blockers);
      const five = disk(output, receipt.fiveImageEvidence.file);
      assert.deepEqual(five.reports, clean ? receipt.reports : historical.reports);
      assert.deepEqual(five.blockers, receipt.blockers);
      assert.deepEqual(five.rejections, clean ? [] : historical.rejections);
      assert.equal(receipt.awsComparator.qualification, "passed");
      assert.equal(receipt.awsCheckpoint.eligible, true);
      const comparison = receipt.openSearchComparator;
      assert.equal(comparison.execution, "complete", comparison.reason);
      assert.deepEqual(comparison.commandIndices, [13, 14]);
      assert.equal(comparison.candidatePolicy, "blocked");
      assert.equal(comparison.qualification, "passed", comparison.reason);
      assert.equal(comparison.result, "failed");
      assert.equal(comparison.reason, "scanner_opensearch_candidate_policy_blocked");
      assert.equal(receipt.failure, clean ? comparison.reason : "scanner_official_images_blocked");
      const bytes = readFileSync(path.join(output, comparison.delta.file));
      assert.deepEqual(comparison.delta, { file: "image-opensearch-comparison.json", ...identity(bytes) });
      const { inventory, candidateBlockers } = JSON.parse(bytes);
      assert.equal(inventory.history.historicalInputsMatch, !clean);
      assert.equal(inventory.history.orderedFindingPathsMatch, !clean);
      assert.equal(inventory.correspondence.length, 82);
      assert.equal(inventory.rpmCoverage.candidate.length, 111);
      assert.equal(inventory.candidatePolicy, "blocked");
      assert.equal(candidateBlockers.length, 8);
      assert.deepEqual(inventory.candidateFindingsOutsideHistoricalMapping.map((i) => inventory.candidate.findings[i].vulnerabilityId),
        ["CVE-SYNTHETIC-NEW"]);
    });
  }

  for (const scenario of ["mixed", "technical", "aws-failure"]) {
    test("raw audit preserves both dispositions and issues zero 3.10 commands after " + scenario, async (t) => {
      const output = run(t, scenario, []);
      const receipt = disk(output, "official-audit-receipt.json");
      const saved = await readComparisonCheckpoint({ config, output, expectedIdentity: receipt.awsCheckpoint.identity, expectedRun: receipt.run });
      const five = disk(output, saved.checkpoint.fiveImageEvidence.file);
      assert.equal(receipt.failure, "scanner_official_images_blocked");
      assert.equal(saved.checkpoint.fiveImageResult, "rejected");
      assert.equal(receipt.openSearchComparator.execution, "not_started");
      assert.equal(saved.candidateEvidence.state, "absent");
      assert.equal(saved.eligible, false);
      const aws = saved.checkpoint.awsComparator;
      assert.equal(aws.qualification, scenario === "aws-failure" ? "failed" : "passed");
      if (scenario === "mixed") {
        const mixed = five.rejections.find((r) => r.role === "seaweedfs");
        assert.equal(mixed.reason, "scanner_image_policy_blocked");
        assert.equal(mixed.blockerCount, 2);
        assert.equal(mixed.findingCount, 1);
        assert.deepEqual(five.blockers.filter((r) => r.role === "seaweedfs"),
          [{ role: "seaweedfs", code: "image_os_end_of_life" }, historical.blockers.find((r) => r.role === "seaweedfs")]);
        assert.ok(saved.reasons.some((r) => r.stage === "five" && r.reason.includes("image_os_end_of_life")));
      } else if (scenario === "technical") {
        assert.equal(five.rejections.find((r) => r.role === "redis").stage, "json");
        assert.deepEqual(five.blockers, historical.blockers);
        assert.ok(saved.reasons.some((r) => r.stage === "five"));
      } else {
        assert.deepEqual(five.rejections, historical.rejections);
        assert.equal(aws.reason, "scanner_aws_subject_invalid");
        assert.ok(saved.reasons.some((r) => r.stage === "aws" && r.reason === aws.reason));
      }
    });
  }

  test("a fresh disk reader reconstructs twelve scans after the worker dies between candidate formats", (t) => {
    const output = run(t, "interrupt", ["json"]);
    const reader = spawnSync(process.execPath, [import.meta.filename, "recover", output], { encoding: "utf8", timeout: 60_000 });
    assert.ifError(reader.error);
    assert.equal(reader.signal, null, reader.stderr);
    assert.equal(reader.status, 0, reader.stderr);
  });
}
