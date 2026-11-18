import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { evaluateImageReport } from "../scripts/scanner/official-controls.mjs";
import { buildOpenSearchComparison, openSearchHistoricalInputsMatch, readOpenSearchReferences, validateOpenSearchComparisonJson } from "../scripts/scanner/official-opensearch-inventory.mjs";

const read = (name) => JSON.parse(readFileSync(new URL("../docs/validation/opensearch-310/" + name + ".json", import.meta.url)));
const oldPin = JSON.parse(readFileSync(new URL("../infra/scanner/official-release.json", import.meta.url))).images.find((pin) => pin.role === "opensearch");
const candidatePin = { ...oldPin, role: "opensearch-candidate", version: "3.10.0",
  manifestDigest: "sha256:02d6d6e40c820ae08233b60540aa5d3d9364d64e2dc724e38d6c8c794879b2a0",
  platform: { os: "linux", architecture: "amd64", digest: "sha256:ffa260e43be96b49144fb7ececbb135c3fd7081567adc781c49ec9232ce1e47f" } };
const evaluated = (pair, pin) => evaluateImageReport(pair.json, pin, [], new Date(pair.json.CreatedAt)).blockers;
const readOld = () => ({ json: read("image-opensearch"), sbom: read("image-opensearch.cdx") });
const copyKey = (p) => JSON.stringify([p.name, p.version, p.file]);
const fileOf = (component) => component.properties.find((p) => p.name === "aquasecurity:trivy:FilePath");
const ml = "usr/share/opensearch/plugins/opensearch-ml/guava-32.1.3-jre.jar";
const analytics = "usr/share/opensearch/plugins/opensearch-security-analytics/guava-32.1.3-jre.jar";

// Only the old report is a real scan. Model candidate scanner visibility from
// the independently mapped Maven copies plus all OS packages. Unobserved JAR
// paths must survive individually in the returned coverage gaps.
function syntheticCandidate() {
  const { json, sbom } = readOld();
  const subject = candidatePin.repository + "@" + candidatePin.platform.digest;
  const configId = "sha256:5aaea29f67a40c1dada19f00f2477fd24184334d474a29fc4cc70c50166a8adc";
  json.ArtifactName = json.Metadata.Reference = subject;
  json.Metadata.RepoDigests = [subject];
  json.Metadata.ImageID = configId;
  json.Metadata.ImageConfig = read("3.10.0-config");
  json.Results[0].Target = subject + " (amazon " + json.Metadata.OS.Name + ")";
  const component = sbom.metadata.component;
  component.name = subject;
  component.purl = component["bom-ref"] = "pkg:oci/opensearch@" + candidatePin.platform.digest +
    "?arch=amd64&repository_url=index.docker.io%2Fopensearchproject%2Fopensearch";
  for (const p of component.properties) {
    if (p.name.endsWith(":ImageID")) p.value = configId;
    if (p.name.endsWith(":RepoDigest") || p.name.endsWith(":Reference")) p.value = subject;
  }
  json.Results[1].Packages = [];
  json.Results[1].Vulnerabilities = [];
  sbom.components = sbom.components.filter((c) => !c.purl?.startsWith("pkg:maven/"));
  sbom.dependencies = [];
  sbom.vulnerabilities = [];
  const seen = new Set();
  for (const { candidate: [file, , { groupId, artifactId, version }] } of read("matched-82")) {
    const name = groupId + ":" + artifactId, key = copyKey({ name, version, file });
    if (seen.has(key)) continue;
    seen.add(key);
    const purl = "pkg:maven/" + groupId + "/" + artifactId + "@" + version;
    json.Results[1].Packages.push({ Name: name, Version: version, FilePath: file, Identifier: { PURL: purl } });
    sbom.components.push({ "bom-ref": "synthetic-" + seen.size, type: "library", name: artifactId, group: groupId, version, purl,
      properties: [{ name: "aquasecurity:trivy:PkgType", value: "jar" }, { name: "aquasecurity:trivy:FilePath", value: file }] });
  }
  return { json, sbom };
}
function inputs() {
  const oldReport = readOld(), candidateReport = syntheticCandidate();
  return { oldReport, candidateReport, historicalInputsMatch: true,
    oldBlockers: evaluated(oldReport, oldPin), candidateBlockers: evaluated(candidateReport, candidatePin) };
}

test("authenticates archived reports, OCI and static references and replays original path-ordered policy", async () => {
  const data = inputs();
  const r = await buildOpenSearchComparison(data);
  assert.deepEqual(r.history.orderedBlockers, read("official-audit-receipt").blockers);
  assert.equal(r.history.orderedBlockers.length, 110);
  assert.equal(r.history.orderedBlockersMatch && r.history.orderedFindingPathsMatch, true);
  assert.equal(r.history.packages.matched.length, 1099);
  assert.equal(r.history.findings.matched.length, 82);
  assert.equal(r.correspondence.length, 82);
  assert.equal(r.rpmCoverage.candidate.length, 111);
  assert.equal(r.jarCoverage.jars.length, 949);
  assert.equal(r.jarCoverage.descriptors.filter((d) => d.file.includes("/plugins/")).length, 26);
  assert.ok(r.jarCoverage.undetectedJarPaths.length > 800);
  assert.equal(r.oldPolicy, "blocked");
  assert.equal(r.candidatePolicy, "clean");
  assert.equal(r.candidate.sbomAdvisoryEntries, 0);
  assert.equal(r.findings.removed.length, 82);
  assert.equal(r.correspondence.filter((m) => !m.candidateThreshold.meetsFloor).length, 7);
  const jackson = r.correspondence.find((m) => m.original.InstalledVersion === "2.22.2");
  assert.deepEqual(jackson.oldThreshold, { floor: "2.22.3", meetsFloor: false });
  assert.deepEqual(jackson.candidateThreshold, { floor: "2.22.3", meetsFloor: true });
  for (const row of r.correspondence) {
    assert.ok(row.oldFinding !== null);
    const p = r.candidate.packages[row.candidatePackage];
    assert.equal(p.file, row.file);
    assert.equal(fileOf(data.candidateReport.sbom.components[p.sbomComponent]).value, row.file);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 64 * 1024 ** 2);
});

test("database drift retains missing historical occurrences and all newly emitted advisory copies", async () => {
  const data = inputs();
  data.oldReport.json.Results[1].Vulnerabilities.shift();
  data.oldBlockers = evaluated(data.oldReport, oldPin);
  await assert.rejects(buildOpenSearchComparison(data), /historical_ordered_replay_mismatch/u);
  data.historicalInputsMatch = false;
  for (const file of [ml, analytics]) {
    for (const id of ["CVE-2026-102554", "CVE-SYNTHETIC-NEW"]) {
      data.candidateReport.json.Results[1].Vulnerabilities.push({ VulnerabilityID: id, Severity: "HIGH",
        PkgName: "com.google.guava:guava", PkgPath: file, InstalledVersion: "32.1.3-jre", FixedVersion: "33.7.2" });
    }
  }
  data.candidateBlockers = evaluated(data.candidateReport, candidatePin);
  const r = await buildOpenSearchComparison(data);
  assert.equal(r.history.orderedBlockersMatch, false);
  assert.equal(r.correspondence[0].oldFinding, null);
  assert.deepEqual(r.history.findings.removed, [0]);
  assert.equal(r.candidatePolicy, "blocked");
  assert.equal(r.candidate.findings.length, 4);
  assert.deepEqual(r.candidateFindingsOutsideHistoricalMapping, [1, 3]);
  assert.deepEqual(r.correspondence.filter((m) => [ml, analytics].includes(m.file)).map((m) => m.candidateFindings), [[0], [2]]);
  assert.ok(r.findings.added.includes(1) && r.findings.added.includes(3));
});

test("identical blocker objects cannot hide swapped historical plugin occurrences", async () => {
  const data = inputs(), findings = data.oldReport.json.Results[1].Vulnerabilities;
  assert.deepEqual(data.oldBlockers[1], data.oldBlockers[2]);
  [findings[1], findings[2]] = [findings[2], findings[1]];
  await assert.rejects(buildOpenSearchComparison(data), /historical_ordered_replay_mismatch/u);
});

test("per-copy JSON, CycloneDX and independent static map reject reassignment and nested loss", async () => {
  for (const side of ["json", "sbom", "both", "nested"]) {
    const data = inputs(), { json, sbom } = data.candidateReport;
    if (side === "nested") {
      const pkg = json.Results[1].Packages.find((p) => p.Name === "com.google.guava:guava" && p.FilePath.includes("/opensaml-"));
      json.Results[1].Packages = json.Results[1].Packages.filter((p) => p !== pkg);
      sbom.components = sbom.components.filter((c) => !(c.group + ":" + c.name === pkg.Name && fileOf(c)?.value === pkg.FilePath));
    } else {
      if (side !== "sbom") json.Results[1].Packages.find((p) => p.FilePath === ml).FilePath = analytics;
      if (side !== "json") fileOf(sbom.components.find((c) => fileOf(c)?.value === ml)).value = analytics;
    }
    await assert.rejects(buildOpenSearchComparison(data), /(?:json_sbom_copy_mismatch|candidate_mapped_copy_missing_or_ambiguous)/u);
  }
});

test("refuses missing or substituted JSON/SBOM identities on either side", async () => {
  for (const r of ["oldReport", "candidateReport"]) {
    for (const field of ["json", "sbom", "jsonConfig", "sbomConfig", "arch", "purl"]) {
      const data = inputs(), pair = data[r];
      if (field === "json" || field === "sbom") delete pair[field];
      if (field === "jsonConfig") delete pair.json.Metadata.ImageID;
      if (field === "sbomConfig") pair.sbom.metadata.component.properties.find((p) => p.name.endsWith(":ImageID")).value = "sha256:" + "0".repeat(64);
      if (field === "arch") pair.json.Metadata.ImageConfig.architecture = "arm64";
      if (field === "purl") pair.sbom.metadata.component.purl += "-other";
      await assert.rejects(buildOpenSearchComparison(data), /(?:json|sbom)_subject_invalid/u);
    }
  }
  assert.throws(() => validateOpenSearchComparisonJson(readOld().json), /candidate_json_subject_invalid/u);
});

test("preserves RPM multiplicity and refuses absent non-key architecture, forged PURL or incomplete policy", async () => {
  for (const problem of ["missing", "arch", "purl", "blockers"]) {
    const data = inputs(), { json, sbom } = data.candidateReport, pkg = json.Results[0].Packages[0];
    if (problem === "missing") {
      json.Results[0].Packages.shift();
      sbom.components = sbom.components.filter((c) => c.name !== pkg.Name);
    }
    if (problem === "arch") delete pkg.Arch;
    if (problem === "purl") pkg.Identifier.PURL = pkg.Identifier.PURL.replace("x86_64", "i386");
    if (problem === "blockers") data.oldBlockers.pop();
    await assert.rejects(buildOpenSearchComparison(data), /rpm_|policy_count_mismatch/u);
  }
});

test("historical identity compares both DB payloads and scanner and refuses absent or duplicated evidence", async () => {
  const current = () => read("official-audit-receipt").awsComparisonInputs;
  assert.equal(openSearchHistoricalInputsMatch(current()), true);
  for (const name of ["db/trivy.db", "java-db/trivy-java.db", "scanner"]) {
    const data = current(), item = name === "scanner" ? data.scanner : data.databaseFiles.find((d) => d.file === name);
    item.sha256 = "1".repeat(64);
    assert.equal(openSearchHistoricalInputsMatch(data), false);
    delete item.size;
    assert.throws(() => openSearchHistoricalInputsMatch(data), /identity_invalid/u);
  }
  const data = current();
  data.databaseFiles.push(data.databaseFiles[0]);
  assert.throws(() => openSearchHistoricalInputsMatch(data), /database_identity_invalid/u);
  const comparison = inputs();
  delete comparison.historicalInputsMatch;
  await assert.rejects(buildOpenSearchComparison(comparison), /historical_context_missing/u);
});

test("fixed reference reader refuses missing, oversized and same-size altered OCI bytes", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "opensearch-reference-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dir = path.join(directory, "upstream-20261118");
  mkdirSync(dir);
  const basename = "opensearch-3.9.0-index.json", file = path.join(dir, basename);
  await assert.rejects(readOpenSearchReferences(directory), /reference_invalid: .*3\.9\.0-index/u);
  copyFileSync(new URL("../docs/validation/upstream-20261118/" + basename, import.meta.url), file);
  const bytes = readFileSync(file);
  writeFileSync(file, Buffer.concat([bytes, Buffer.from(" ")]));
  await assert.rejects(readOpenSearchReferences(directory), /reference_invalid: .*3\.9\.0-index/u);
  const changed = bytes.toString().replace("amd64", "arm64");
  assert.equal(Buffer.byteLength(changed), bytes.length);
  writeFileSync(file, changed);
  await assert.rejects(readOpenSearchReferences(directory), /reference_identity: .*3\.9\.0-index/u);
});

test("unmatched duplicate emissions remain individual occurrences and cannot join an unrelated enclosing JAR", async () => {
  const data = inputs(), result = data.candidateReport.json.Results[1];
  const finding = { VulnerabilityID: "CVE-SYNTHETIC", PkgName: "com.google.guava:guava", InstalledVersion: "32.1.3-jre",
    PkgPath: analytics, Severity: "HIGH" };
  result.Vulnerabilities.push(finding, { ...finding });
  data.candidateBlockers = evaluated(data.candidateReport, candidatePin);
  const compared = await buildOpenSearchComparison(data);
  assert.deepEqual(compared.candidateFindingsOutsideHistoricalMapping, [0, 1]);
  assert.deepEqual(compared.findings.added, [0, 1]);
  assert.equal(compared.candidate.blockers.length, 2);
  finding.PkgPath = "wrong-owner.jar";
  await assert.rejects(buildOpenSearchComparison(data), /candidate_finding_package_mismatch/u);
});

test("identifies the changed payload independently from replay and refuses contradictory context", async () => {
  const data = inputs();
  data.currentInputs = read("official-audit-receipt").awsComparisonInputs;
  data.currentInputs.databaseFiles.find((d) => d.file === "db/trivy.db").sha256 = "8".repeat(64);
  await assert.rejects(buildOpenSearchComparison(data), /historical_context_contradiction/u);
  data.historicalInputsMatch = false;
  const r = await buildOpenSearchComparison(data);
  assert.deepEqual(r.history.inputComparison.filter((d) => !d.identical).map((d) => d.file), ["db/trivy.db"]);
  assert.equal(r.history.orderedBlockersMatch, true);
});
