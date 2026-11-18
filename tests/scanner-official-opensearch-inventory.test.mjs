import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { evaluateImageReport } from "../scripts/scanner/official-controls.mjs";
import { buildOpenSearchComparison, compareOpenSearchReportData, openSearchHistoricalInputsMatch, readOpenSearchReferences, validateOpenSearchComparisonJson, validateOpenSearchComparisonPair } from "../scripts/scanner/official-opensearch-inventory.mjs";

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

const samlOwner = (release) => "usr/share/opensearch/plugins/opensearch-security/opensaml-" + release + ".0.0-all.jar";

// Only the old report is a real scan. Model candidate scanner visibility from
// the independently mapped Maven copies plus all OS packages. Unobserved JAR
// paths must survive individually in the returned coverage gaps.
function syntheticCandidate({ fullCoverage = false } = {}) {
  const { json, sbom } = readOld();
  const subject = candidatePin.repository + "@" + candidatePin.platform.digest;
  const configId = "sha256:5aaea29f67a40c1dada19f00f2477fd24184334d474a29fc4cc70c50166a8adc";
  json.ArtifactName = json.Metadata.Reference = subject;
  json.Metadata.RepoDigests = [subject];
  json.Metadata.ImageID = configId;
  json.Metadata.ImageConfig = read("3.10.0-config");
  json.Metadata.DiffIDs = json.Metadata.ImageConfig.rootfs.diff_ids;
  const previousLayers = json.Metadata.Layers, manifest = read("3.10.0-platform");
  json.Metadata.Layers = manifest.layers.map((layer, i) => ({ Digest: layer.digest, DiffID: json.Metadata.DiffIDs[i] }));
  const layerIndex = new Map(previousLayers.map((layer, i) => [layer.Digest, i]));
  for (const result of json.Results) {
    for (const row of [...result.Packages, ...(result.Vulnerabilities ?? [])]) {
      row.Layer = json.Metadata.Layers[layerIndex.get(row.Layer.Digest)];
    }
  }
  for (const c of sbom.components) {
    const digest = c.properties.find((p) => p.name.endsWith(":LayerDigest"));
    if (!digest) continue;
    const layer = json.Metadata.Layers[layerIndex.get(digest.value)];
    digest.value = layer.Digest;
    c.properties.find((p) => p.name.endsWith(":LayerDiffID")).value = layer.DiffID;
  }
  json.Results[0].Target = subject + " (amazon " + json.Metadata.OS.Name + ")";
  const component = sbom.metadata.component;
  component.name = subject;
  component.purl = component["bom-ref"] = "pkg:oci/opensearch@" + candidatePin.platform.digest +
    "?arch=amd64&repository_url=index.docker.io%2Fopensearchproject%2Fopensearch";
  const diffIds = [...json.Metadata.DiffIDs].sort();
  for (const p of component.properties) {
    if (p.name.endsWith(":DiffID")) p.value = diffIds.shift();
    if (p.name.endsWith(":ImageID")) p.value = configId;
    if (p.name.endsWith(":RepoDigest") || p.name.endsWith(":Reference")) p.value = subject;
  }
  const shipped = new Set(read("jar-paths"));
  const shippedOwner = (file) => shipped.has(file?.match(/^(.+?\.jar)(?:[!/:]|$)/u)?.[1]);
  const matched = read("matched-82");
  const sourcePackages = json.Results[1].Packages;
  const originalLayers = new Map(sourcePackages.map((pkg) => [pkg.FilePath, pkg.Layer]));
  // Model scanner visibility only for versions in the independently pinned
  // successor inventory. Preserve the scanner's exact inner path if present.
  assert.equal(originalLayers.get(samlOwner("3.9")).Digest, read("opensaml-candidate-maven").layerDigest);
  const owners = new Map(read("renamed-jar-owners").owners.map((entry) => [entry.oldFile, entry]));
  function successor(name, file) {
    const outer = file?.match(/^(.+?\.jar)(?:[!/:]|$)/u)?.[1];
    const owner = owners.get(outer);
    const coordinates = owner?.coordinates.filter((c) => c.name === name);
    if (coordinates?.length !== 1) return null;
    return { file: owner.file + file.slice(outer.length), version: coordinates[0].version,
      layer: json.Metadata.Layers.find((l) => l.Digest === owner.layerDigest) };
  }
  if (fullCoverage) {
    for (const p of sourcePackages) {
      const next = successor(p.Name, p.FilePath);
      if (!next) continue;
      p.FilePath = next.file;
      p.Version = next.version;
      p.Layer = next.layer;
      p.Identifier.PURL = "pkg:maven/" + p.Name.replace(":", "/") + "@" + p.Version;
    }
    for (const c of sbom.components) {
      const file = fileOf(c);
      const next = successor(c.group + ":" + c.name, file?.value);
      if (!next) continue;
      file.value = next.file;
      c.version = next.version;
      c.purl = "pkg:maven/" + c.group + "/" + c.name + "@" + c.version;
      c.properties.find((p) => p.name.endsWith(":LayerDigest")).value = next.layer.Digest;
      c.properties.find((p) => p.name.endsWith(":LayerDiffID")).value = next.layer.DiffID;
    }
  }
  json.Results[1].Packages = sourcePackages.filter((p) => fullCoverage && shippedOwner(p.FilePath));
  json.Results[1].Vulnerabilities = [];
  sbom.components = sbom.components.filter((c) => !c.purl?.startsWith("pkg:maven/") || fullCoverage && shippedOwner(fileOf(c)?.value));
  sbom.dependencies = [];
  sbom.vulnerabilities = [];
  const seen = new Set(json.Results[1].Packages.map((p) => copyKey({ name: p.Name, version: p.Version, file: p.FilePath })));
  for (const { original, meetsOriginalThreshold, candidate: [file, , { groupId, artifactId, version }] } of matched) {
    const name = groupId + ":" + artifactId, key = copyKey({ name, version, file });
    const { Digest, DiffID } = originalLayers.get(original.PkgPath);
    const Layer = { Digest, DiffID };
    if (fullCoverage && !meetsOriginalThreshold) {
      json.Results[1].Vulnerabilities.push({ ...original, PkgPath: file, InstalledVersion: version, Layer });
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const purl = "pkg:maven/" + groupId + "/" + artifactId + "@" + version;
    json.Results[1].Packages.push({ Name: name, Version: version, FilePath: file, Identifier: { PURL: purl }, Layer });
    sbom.components.push({ "bom-ref": "synthetic-" + seen.size, type: "library", name: artifactId, group: groupId, version, purl,
      properties: [{ name: "aquasecurity:trivy:PkgType", value: "jar" }, { name: "aquasecurity:trivy:FilePath", value: file },
        { name: "aquasecurity:trivy:LayerDigest", value: Digest }, { name: "aquasecurity:trivy:LayerDiffID", value: DiffID }] });
  }
  return { json, sbom };
}
function inputs(options) {
  const oldReport = readOld(), candidateReport = syntheticCandidate(options);
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
  assert.equal(r.qualification, "failed");
  assert.equal(r.unresolved.missingBelowFloorAdvisories.length, 7);
  assert.ok(r.unresolved.lostJarPaths.length > 0);
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
  assert.equal((await buildOpenSearchComparison(data)).reason, "scanner_opensearch_historical_ordered_replay_mismatch");
  data.historicalInputsMatch = false;
  for (const file of [ml, analytics]) {
    for (const id of ["CVE-2026-102554", "CVE-SYNTHETIC-NEW"]) {
      data.candidateReport.json.Results[1].Vulnerabilities.push({ VulnerabilityID: id, Severity: "HIGH",
        Layer: data.candidateReport.json.Results[1].Packages.find((p) => p.FilePath === file).Layer,
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
  assert.equal((await buildOpenSearchComparison(data)).reason, "scanner_opensearch_historical_ordered_replay_mismatch");
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
    if (side === "json" || side === "sbom") {
      await assert.rejects(buildOpenSearchComparison(data), /json_sbom_copy_mismatch/u);
    } else {
      const compared = await buildOpenSearchComparison(data);
      assert.equal(compared.qualification, "failed");
      assert.ok(compared.unresolved.missingMappedCopies.length > 0);
    }
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
  await assert.rejects(validateOpenSearchComparisonJson(readOld().json), /candidate_json_subject_invalid/u);
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
    if (problem === "missing") {
      const compared = await buildOpenSearchComparison(data);
      assert.equal(compared.qualification, "failed");
      assert.equal(compared.rpmCoverage.gaps.candidate.missingStaticIndices.length, 1);
    } else {
      await assert.rejects(buildOpenSearchComparison(data), /rpm_|policy_count_mismatch/u);
    }
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
    PkgPath: analytics, Severity: "HIGH", Layer: result.Packages.find((p) => p.FilePath === analytics).Layer };
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

function removeMavenCopy(pair, name, file) {
  const result = pair.json.Results[1];
  const i = result.Packages.findIndex((p) => p.Name === name && p.FilePath === file);
  const j = pair.sbom.components.findIndex((c) => c.group + ":" + c.name === name && fileOf(c)?.value === file);
  assert.ok(i !== -1 && j !== -1);
  result.Packages.splice(i, 1);
  const [component] = pair.sbom.components.splice(j, 1);
  const ref = component["bom-ref"];
  pair.sbom.dependencies = pair.sbom.dependencies.filter((edge) => edge.ref !== ref);
  for (const edge of pair.sbom.dependencies) edge.dependsOn = edge.dependsOn?.filter((id) => id !== ref);
}

// A positive contract test has a deliberately narrower historical population:
// retain the packages with independent candidate evidence and all unchanged
// physical owners. Exercise the complete, unfiltered archive separately below.
async function witnessedComparison(data, mutateReferences) {
  const references = await readOpenSearchReferences();
  const { values } = references, table = values.renamedOwners;
  const excluded = new Set(table.unresolved.map((entry) => entry.oldFile));
  assert.equal(excluded.size, 10);
  assert.ok([...excluded].every((file) => path.posix.basename(file).includes("remote-metadata-sdk")));
  const oldReport = globalThis.structuredClone(data.oldReport);
  const outer = (file) => file.match(/^(.+?\.jar)(?:[!/:]|$)/u)[1];
  const inScope = (file) => !excluded.has(outer(file));
  for (const pair of [values, oldReport]) {
    const java = pair.json.Results[1];
    assert.ok(java.Vulnerabilities.every((v) => inScope(v.PkgPath)));
    java.Packages = java.Packages.filter((p) => inScope(p.FilePath));
    pair.sbom.components = pair.sbom.components.filter((c) =>
      !c.purl?.startsWith("pkg:maven/") || inScope(fileOf(c).value));
    pair.sbom.dependencies = [];
  }
  assert.equal(values.json.Results[1].Packages.length, 978);
  table.unresolved = [];
  mutateReferences?.(values);
  // These projected inputs are synthetic and have no original byte identities.
  return compareOpenSearchReportData({ values, identities: { opensaml: references.identities.opensaml } }, { ...data, oldReport });
}

test("requires per-copy evidence even in a still-detected JAR and on the unchanged historical subject", async () => {
  const owner = "usr/share/opensearch/plugins/opensearch-security-analytics/security-analytics-commons-1.0.0.jar";
  const name = "com.amazonaws:aws-java-sdk-s3";
  const data = inputs({ fullCoverage: true });
  const full = await witnessedComparison(data);
  assert.equal(full.qualification, "passed", JSON.stringify(full.unresolved));
  assert.deepEqual(full.unresolved.reasons, []);
  assert.equal(full.packageCoverage.removedJarOwners.length, 1);
  const [retired] = full.packageCoverage.removedJarOwners;
  assert.ok(retired.owner.endsWith("/opensearch-sql/jsr305-3.0.2.jar"));
  assert.equal(read("jar-paths").includes(retired.owner), false);
  assert.equal(full.old.packages[retired.oldPackage].file, retired.owner);
  assert.ok(full.packageCoverage.provedMigrations.length > 0);
  assert.equal(full.packageCoverage.provedMigrations.length + full.packageCoverage.removedJarOwners.length, full.packages.removed.length);
  for (const { oldPackage, candidatePackage } of full.packageCoverage.provedMigrations) {
    assert.equal(full.old.packages[oldPackage].name, full.candidate.packages[candidatePackage].name);
    assert.notEqual(full.old.packages[oldPackage].file, full.candidate.packages[candidatePackage].file);
  }

  removeMavenCopy(data.candidateReport, name, owner);
  const partial = await witnessedComparison(data);
  assert.equal(partial.qualification, "failed");
  assert.deepEqual(partial.unresolved.reasons, ["unexplained_package_loss"]);
  assert.deepEqual(partial.unresolved.lostJarPaths, []);
  const [index] = partial.unresolved.unexplainedPackageLosses;
  assert.equal(partial.old.packages[index].name, name);
  assert.equal(partial.old.packages[index].file, owner);

  removeMavenCopy(data.oldReport, name, owner);
  const both = await witnessedComparison(data);
  assert.equal(both.qualification, "failed");
  assert.deepEqual(both.unresolved.reasons, ["historical_package_loss"]);
  assert.deepEqual(both.history.packages.removed, [index]);
  assert.equal(both.history.orderedBlockersMatch && both.history.orderedFindingPathsMatch, true);
});

test("returns all mapped gaps, RPM gaps and excess occurrences of a known advisory in one failed delta", async () => {
  const data = inputs({ fullCoverage: true }), pair = data.candidateReport;
  const result = pair.json.Results[1], name = "com.google.guava:guava";
  const nested = result.Vulnerabilities.find((v) => v.PkgName === name && v.PkgPath.includes("/opensaml-")).PkgPath;
  for (const file of [analytics, nested]) {
    removeMavenCopy(pair, name, file);
    result.Vulnerabilities = result.Vulnerabilities.filter((v) => v.PkgPath !== file || v.PkgName !== name);
  }
  const matching = result.Vulnerabilities.find((v) => v.PkgPath === ml && v.VulnerabilityID === "CVE-2026-102554");
  const first = result.Vulnerabilities.indexOf(matching), extra = result.Vulnerabilities.length;
  result.Vulnerabilities.push({ ...matching }, { ...matching, VulnerabilityID: "CVE-SYNTHETIC-NEW" });
  const [rpm] = pair.json.Results[0].Packages.splice(0, 1);
  pair.sbom.components = pair.sbom.components.filter((c) => c.purl !== rpm.Identifier.PURL);
  data.candidateBlockers = evaluated(pair, candidatePin);
  const compared = await buildOpenSearchComparison(data);
  assert.equal(compared.qualification, "failed");
  assert.equal(compared.rpmCoverage.gaps.candidate.missingStaticIndices.length, 1);
  const gaps = compared.unresolved.missingMappedCopies.map((i) => compared.correspondence[i]);
  assert.deepEqual(gaps.map((row) => row.file).sort(), [analytics, nested].sort());
  assert.ok(gaps.every((row) => row.candidatePackage === null && row.candidatePackageMatches.length === 0));
  assert.deepEqual(compared.correspondence.find((row) => row.file === ml).candidateFindings, [first]);
  assert.deepEqual(compared.candidateFindingsOutsideHistoricalMapping, [extra, extra + 1]);
  assert.ok(compared.findings.added.includes(extra) && compared.findings.added.includes(extra + 1));
});

test("binds the embedded config and ordered layer identities before CycloneDX, and validates SBOM DiffID multiplicity", async () => {
  const archived = readOld();
  await validateOpenSearchComparisonJson(archived.json, "old");
  const candidate = syntheticCandidate();
  await validateOpenSearchComparisonJson(candidate.json);
  for (const field of ["ImageConfig", "DiffIDs", "Layers"]) {
    const json = globalThis.structuredClone(candidate.json);
    json.Metadata[field] = archived.json.Metadata[field];
    await assert.rejects(validateOpenSearchComparisonJson(json), /candidate_json_subject_invalid/u);
  }
  const staleLayer = archived.json.Results[1].Packages[0].Layer;
  const forged = globalThis.structuredClone(candidate.json);
  forged.Results[1].Packages[0].Layer = staleLayer;
  await assert.rejects(validateOpenSearchComparisonJson(forged), /candidate_json_layer_invalid/u);
  const staleComponent = inputs();
  const properties = staleComponent.candidateReport.sbom.components.find((c) => c.type === "library").properties;
  properties.find((p) => p.name.endsWith(":LayerDigest")).value = staleLayer.Digest;
  properties.find((p) => p.name.endsWith(":LayerDiffID")).value = staleLayer.DiffID;
  await assert.rejects(buildOpenSearchComparison(staleComponent), /candidate_sbom_layer_invalid/u);
  for (const change of ["duplicate", "wrongImage", "order"]) {
    const data = inputs();
    const props = data.candidateReport.sbom.metadata.component.properties.filter((p) => p.name.endsWith(":DiffID"));
    if (change === "duplicate") props[1].value = props[0].value;
    if (change === "wrongImage") {
      const ids = [...archived.json.Metadata.DiffIDs].sort();
      for (const [i, p] of props.entries()) p.value = ids[i];
    }
    if (change === "order") [props[0].value, props[1].value] = [props[1].value, props[0].value];
    await assert.rejects(buildOpenSearchComparison(data), /candidate_sbom_subject_invalid/u);
  }
});

test("the same coordinate at a substituted version cannot explain a copy loss inside a retained owner", async () => {
  const data = inputs({ fullCoverage: true }), pair = data.candidateReport;
  const name = "com.amazonaws:aws-java-sdk-s3";
  const pkg = pair.json.Results[1].Packages.find((p) => p.Name === name && p.FilePath.endsWith("/security-analytics-commons-1.0.0.jar"));
  const component = pair.sbom.components.find((c) => c.group + ":" + c.name === name && fileOf(c)?.value === pkg.FilePath);
  const previous = pkg.Version;
  pkg.Version = component.version = "99.0.0";
  pkg.Identifier.PURL = component.purl = component.purl.replace("@" + previous, "@" + pkg.Version);
  const compared = await witnessedComparison(data);
  assert.equal(compared.qualification, "failed");
  assert.deepEqual(compared.unresolved.reasons, ["unexplained_package_loss"]);
  assert.equal(compared.unresolved.unexplainedPackageLosses.length, 1);
  const [missing] = compared.unresolved.unexplainedPackageLosses;
  assert.equal(compared.old.packages[missing].version, previous);
  assert.equal(compared.old.packages[missing].file, pkg.FilePath);
});

test("refuses a repeated target that expands beyond the projection budget", async () => {
  const data = inputs({ fullCoverage: true });
  data.candidateReport.json.Results[1].Target = "x".repeat(128 * 1024);
  await assert.rejects(buildOpenSearchComparison(data), /scanner_opensearch_projection_limit/u);
});

test("reconciles every off-advisory copy across a proved owner replacement and records all gaps", async () => {
  const data = inputs({ fullCoverage: true });
  const pair = data.candidateReport, file = samlOwner("3.10");
  const missing = "org.opensaml:opensaml-saml-impl";
  // Leave this coordinate visible only at its obsolete path in both formats.
  const stalePkg = pair.json.Results[1].Packages.find((p) => p.Name === missing && p.FilePath === file);
  const staleLib = pair.sbom.components.find((c) => c.group + ":" + c.name === missing && fileOf(c)?.value === file);
  stalePkg.FilePath = fileOf(staleLib).value = samlOwner("3.9");

  // A duplicated coordinate cannot stand in for a neighbour. A matching
  // version in a different inner path cannot stand in for the expected copy.
  const duplicate = "org.opensaml:opensaml-core-api", moved = "org.opensaml:opensaml-saml-api";
  const library = (name) => pair.sbom.components.find((c) => c.group + ":" + c.name === name && fileOf(c)?.value === file);
  const pkg = (name) => pair.json.Results[1].Packages.find((p) => p.Name === name && p.FilePath === file);
  pair.json.Results[1].Packages.push({ ...pkg(duplicate) });
  pair.sbom.components.push({ ...library(duplicate), "bom-ref": "duplicate-off-advisory" });
  pkg(moved).FilePath = fileOf(library(moved)).value = file + "!/nested.jar";
  const r = await witnessedComparison(data);
  assert.equal(r.qualification, "failed");
  assert.deepEqual(r.unresolved.reasons, ["jar_outside_static_inventory", "unexplained_package_loss", "opensaml_inventory_mismatch"]);
  const gaps = r.packageCoverage.replacementGaps;
  assert.deepEqual(gaps.map((g) => [r.old.packages[g.oldPackages[0]].name, g.candidatePackages.length]).sort(),
    [[missing, 0], [moved, 0], [duplicate, 2]].sort());
  assert.ok(gaps.every((g) => g.file === file && g.oldPackages.length === 1));
  assert.equal(r.unresolved.unexplainedPackageLosses.length, 3);
  assert.deepEqual(r.unresolved.missingMappedCopies, []);
  assert.equal(r.candidatePolicy, "blocked");
});

test("changed DB with a below-floor advisory absent on both fresh subjects retains the floor and actual emissions", async () => {
  const data = inputs({ fullCoverage: true });
  data.currentInputs = read("official-audit-receipt").awsComparisonInputs;
  data.currentInputs.databaseFiles.find((d) => d.file === "db/trivy.db").sha256 = "7".repeat(64);
  data.historicalInputsMatch = false;
  for (const pair of [data.oldReport, data.candidateReport]) {
    const result = pair.json.Results[1];
    result.Vulnerabilities = result.Vulnerabilities.filter((v) => !v.PkgName.endsWith(":jline-builtins"));
  }
  data.oldBlockers = evaluated(data.oldReport, oldPin);
  data.candidateBlockers = evaluated(data.candidateReport, candidatePin);
  const shared = await witnessedComparison(data);
  const jline = shared.correspondence.find((row) => row.original.PkgName.endsWith(":jline-builtins"));
  assert.equal(shared.qualification, "passed");
  assert.equal(shared.candidatePolicy, "blocked");
  assert.equal(shared.unresolved.candidateAdvisoryOccurrences, 6);
  assert.deepEqual(shared.unresolved.sharedBelowFloorAdvisoryDrift, [jline.historicalFinding]);
  assert.deepEqual(shared.unresolved.missingBelowFloorAdvisories, [jline.historicalFinding]);
  assert.equal(shared.unresolved.belowHistoricalFloor.length, 7);
  assert.ok(shared.unresolved.belowHistoricalFloor.includes(jline.historicalFinding));
  assert.deepEqual(jline.candidateFindings, []);
  assert.equal(jline.oldFinding, null);
  const [candidateOnlyLoss] = data.candidateReport.json.Results[1].Vulnerabilities.splice(0, 1);
  data.candidateBlockers = evaluated(data.candidateReport, candidatePin);
  const partial = await witnessedComparison(data);
  assert.deepEqual(partial.unresolved.reasons, ["below_floor_advisories_unmeasured"]);
  assert.deepEqual(partial.unresolved.sharedBelowFloorAdvisoryDrift, [jline.historicalFinding]);
  assert.equal(partial.unresolved.unexplainedBelowFloorAdvisories.length, 1);
  assert.equal(partial.correspondence[partial.unresolved.unexplainedBelowFloorAdvisories[0]].file, candidateOnlyLoss.PkgPath);
});

test("pair gate binds every package, library and advisory to the same actual image layer", async () => {
  await validateOpenSearchComparisonPair(readOld(), "old");
  for (const change of ["library", "finding", "missingPackage", "missingFinding", "missingLibrary", "missingAll", "root"]) {
    const pair = readOld(), result = pair.json.Results[1];
    const v = result.Vulnerabilities[0];
    const p = result.Packages.find((row) => row.Name === v.PkgName && row.FilePath === v.PkgPath);
    const c = pair.sbom.components.find((row) => fileOf(row)?.value === v.PkgPath && row.purl === p.Identifier.PURL);
    const other = pair.json.Metadata.Layers.find((layer) => layer.Digest !== p.Layer.Digest);
    if (change === "library") {
      c.properties.find((prop) => prop.name.endsWith(":LayerDigest")).value = other.Digest;
      c.properties.find((prop) => prop.name.endsWith(":LayerDiffID")).value = other.DiffID;
    }
    if (change === "finding") v.Layer = { Digest: other.Digest, DiffID: other.DiffID };
    if (change === "missingPackage" || change === "missingAll") delete p.Layer;
    if (change === "missingFinding" || change === "missingAll") delete v.Layer;
    if (change === "missingLibrary" || change === "missingAll") c.properties = c.properties.filter((prop) => !prop.name.includes(":Layer"));
    if (change === "root") pair.json.Metadata.Layers.reverse();
    await assert.rejects(validateOpenSearchComparisonPair(pair, "old"),
      /old_json_sbom_copy_mismatch|old_finding_package_mismatch|old_json_layer_invalid|sbom_property_invalid|old_json_subject_invalid/u);
  }
});

test("pins the 37 OpenSAML Maven versions and their physical layer independently of candidate emissions", async () => {
  const data = inputs({ fullCoverage: true }), pair = data.candidateReport;
  const full = await witnessedComparison(data);
  assert.equal(full.references.opensaml.sha256, "42618c9c2f56573088d487ccfff064756b1d62c85d5be64c08e0332022c82146");
  const { file, coordinates, layer } = full.packageCoverage.opensaml;
  assert.equal(coordinates.length, 37);
  assert.ok(coordinates.every((row) => row.matched));
  const upgrades = full.packageCoverage.provedMigrations.filter((m) => m.versionSource === "opensaml" &&
    full.old.packages[m.oldPackage].version !== full.candidate.packages[m.candidatePackage].version);
  assert.equal(upgrades.length, 5);
  const missing = "org.opensaml:opensaml-saml-impl", stale = "org.apache.httpcomponents.client5:httpclient5";
  const relocated = "org.opensaml:opensaml-core-api";
  removeMavenCopy(pair, missing, file);
  const pkg = (name) => pair.json.Results[1].Packages.find((p) => p.FilePath === file && p.Name === name);
  const lib = (name) => pair.sbom.components.find((c) => fileOf(c)?.value === file && c.group + ":" + c.name === name);
  pkg(stale).Version = lib(stale).version = "5.6.4";
  pkg(stale).Identifier.PURL = lib(stale).purl = "pkg:maven/org.apache.httpcomponents.client5/httpclient5@5.6.4";
  const other = pair.json.Metadata.Layers.find((l) => l.Digest !== layer.Digest);
  pkg(relocated).Layer = { Digest: other.Digest, DiffID: other.DiffID };
  lib(relocated).properties.find((p) => p.name.endsWith(":LayerDigest")).value = other.Digest;
  lib(relocated).properties.find((p) => p.name.endsWith(":LayerDiffID")).value = other.DiffID;
  const r = await witnessedComparison(data);
  assert.equal(r.reason, "scanner_opensearch_unexplained_package_loss");
  assert.deepEqual(r.unresolved.unexplainedPackageLosses.map((i) => r.old.packages[i].name).sort(), [missing, stale, relocated].sort());
  const gaps = r.packageCoverage.opensaml.coordinates.filter((c) => !c.matched);
  assert.deepEqual(gaps.map((g) => g.name).sort(), [missing, stale, relocated].sort());
  assert.equal(gaps.find((g) => g.name === stale).version, "5.6.5");
  assert.deepEqual(r.unresolved.missingMappedCopies, []);
});

test("partitions the complete archived owner population independently of findings", async () => {
  const r = await buildOpenSearchComparison(inputs({ fullCoverage: true }));
  const table = read("renamed-jar-owners"), shipped = new Set(read("jar-paths"));
  const oldOwners = new Set(r.old.packages.filter((p) => p.type === "jar").map((p) => p.file.match(/^(.+?\.jar)(?:[!/:]|$)/u)[1]));
  assert.deepEqual([...table.owners, ...table.unresolved, ...table.removed].map((e) => e.oldFile).sort(),
    [...oldOwners].filter((f) => !shipped.has(f)).sort());
  assert.deepEqual(r.references.renamedOwners, { file: "opensearch-310/renamed-jar-owners.json", size: 195019,
    sha256: "1221378495abb4d59a7be667029a305fc5bd0df5ea05e7a58168947d814f71b3" });
  assert.deepEqual(r.packageCoverage.unresolvedOwners, table.unresolved);
  assert.equal(r.packageCoverage.provedMigrations.length, 374);
  assert.equal(r.packageCoverage.removedJarOwners.length, 1);
  assert.equal(r.packageCoverage.unresolvedOwnerPackages.length, 10);
  assert.deepEqual(r.unresolved.reasons, ["unexplained_package_loss"]);
  assert.deepEqual(r.packageCoverage.replacementGaps, []);
  assert.deepEqual(r.unresolved.unexplainedPackageLosses, r.packageCoverage.unresolvedOwnerPackages.map((e) => e.oldPackage));
  assert.deepEqual(r.packageCoverage.unresolvedOwnerPackages.map((e) => e.oldPackage),
    r.old.packages.flatMap((p, i) => table.unresolved.some((e) => e.oldFile === p.file?.match(/^(.+?\.jar)(?:[!/:]|$)/u)?.[1]) ? [i] : []));
  const migrations = r.packageCoverage.provedMigrations;
  assert.deepEqual([...migrations.map((m) => m.oldPackage), ...r.packageCoverage.removedJarOwners.map((m) => m.oldPackage), ...r.unresolved.unexplainedPackageLosses].sort((a, b) => a - b), r.packages.removed);
  assert.equal(new Set(migrations.map((m) => m.candidatePackage)).size, migrations.length);
  for (const loss of r.packageCoverage.unresolvedOwnerPackages) {
    assert.equal(shipped.has(loss.owner), false);
    assert.ok(r.unresolved.unexplainedPackageLosses.includes(loss.oldPackage));
  }
  assert.equal(r.candidatePolicy, "blocked");
  assert.equal(r.qualification, table.unresolved.length || r.packageCoverage.replacementGaps.length ? "failed" : "passed");
});

test("requires Notifications Core and Nimbus copies at the attested path, version and actual layer", async () => {
  const data = inputs({ fullCoverage: true }), pair = data.candidateReport;
  const notifications = "usr/share/opensearch/plugins/opensearch-notifications-core/opensearch-notifications-core-spi-3.10.0.0.jar";
  const nimbus = "usr/share/opensearch/plugins/opensearch-security/nimbus-jose-jwt-10.10.jar";
  const missing = "com.amazonaws:aws-java-sdk-ses", moved = "com.google.code.gson:gson";
  const positive = await witnessedComparison(data);
  assert.equal(positive.qualification, "passed");
  for (const [path, count] of [[notifications, 5], [nimbus, 3]]) {
    assert.equal(positive.packageCoverage.provedMigrations.filter((m) => positive.candidate.packages[m.candidatePackage].file === path).length, count);
  }
  removeMavenCopy(pair, missing, notifications);
  const p = pair.json.Results[1].Packages.find((p) => p.Name === moved && p.FilePath === nimbus);
  const c = pair.sbom.components.find((c) => c.purl === p.Identifier.PURL && fileOf(c)?.value === nimbus);
  const layer = pair.json.Metadata.Layers.find((l) => l.Digest !== p.Layer.Digest);
  p.Layer = layer;
  c.properties.find((prop) => prop.name.endsWith(":LayerDigest")).value = layer.Digest;
  c.properties.find((prop) => prop.name.endsWith(":LayerDiffID")).value = layer.DiffID;
  const r = await witnessedComparison(data);
  assert.deepEqual(r.unresolved.reasons, ["unexplained_package_loss"]);
  assert.deepEqual(r.unresolved.unexplainedPackageLosses.map((i) => r.old.packages[i].name).sort(), [missing, moved].sort());
  assert.deepEqual(r.packageCoverage.replacementGaps.map((g) => [g.file, g.version, g.candidatePackages.length]).sort(),
    [[notifications, "1.12.687", 0], [nimbus, "2.14.0", 1]].sort());
  assert.deepEqual(r.unresolved.missingMappedCopies, []);
  assert.deepEqual(r.unresolved.lostJarPaths, []);
  assert.equal(r.candidatePolicy, positive.candidatePolicy);
});

test("keeps the archived SES and Gson indices on top of the ten ambiguous SDK owners", async () => {
  const data = inputs({ fullCoverage: true });
  const controls = await buildOpenSearchComparison(data);
  const cases = [
    [138, "com.amazonaws:aws-java-sdk-ses", "opensearch-notifications-core-spi-3.10.0.0.jar"],
    [227, "com.google.code.gson:gson", "nimbus-jose-jwt-10.10.jar"],
  ];
  for (const [index, name, jar] of cases) {
    const pair = globalThis.structuredClone(data.candidateReport);
    const file = controls.candidate.packages.find((p) => p.name === name && p.file.endsWith("/" + jar)).file;
    removeMavenCopy(pair, name, file);
    const r = await buildOpenSearchComparison({ ...data, candidateReport: pair });
    assert.equal(r.qualification, "failed");
    assert.equal(r.candidatePolicy, "blocked");
    assert.deepEqual(r.unresolved.unexplainedPackageLosses.filter((i) => !controls.unresolved.unexplainedPackageLosses.includes(i)), [index]);
    assert.equal(r.old.packages[index].name, name);
    assert.deepEqual(r.packageCoverage.replacementGaps.map((g) => [g.file, g.oldPackages, g.candidatePackages]), [[file, [index], []]]);
  }
});

test("refuses incomplete, duplicate or contradictory owner evidence and never credits an existing B for disappeared A", async () => {
  const data = inputs({ fullCoverage: true });
  const row = (v) => v.renamedOwners.owners.find((e) => e.file.endsWith("/nimbus-jose-jwt-10.10.jar"));
  for (const change of [
    (v) => v.renamedOwners.owners.splice(v.renamedOwners.owners.indexOf(row(v)), 1),
    (v) => v.renamedOwners.unresolved.push({ oldFile: row(v).oldFile, candidates: [], reason: "unknown" }),
    (v) => { row(v).file = v.json.Results[1].Packages.find((p) =>
      path.posix.dirname(p.FilePath) === path.posix.dirname(row(v).file) && v.jars.includes(p.FilePath)).FilePath; },
    (v) => { row(v).layerDigest = "sha256:" + "0".repeat(64); },
    (v) => { row(v).coordinates.push({ name: "unknown:unrelated", version: "1.0" }); },
    (v) => { v.renamedOwners.owners.find((e) => e.file === v.opensaml.file).size++; },
    (v) => { const entry = row(v); v.renamedOwners.owners.splice(v.renamedOwners.owners.indexOf(entry), 1);
      v.renamedOwners.removed.push({ oldFile: entry.oldFile, reason: "old name absent" }); },
  ]) {
    await assert.rejects(witnessedComparison(data, change), /owner_reference_|owner_removal_evidence_missing/u);
  }
  const unknown = await witnessedComparison(data, (v) => {
    row(v).coordinates = row(v).coordinates.filter((c) => c.name !== "com.google.code.gson:gson");
  });
  assert.equal(unknown.qualification, "failed");
  assert.deepEqual(unknown.packageCoverage.replacementGaps.map((g) => [g.version, g.candidatePackages.length]), [[null, 1]]);
  const noRemovalProof = await witnessedComparison(data, (v) => {
    const [entry] = v.renamedOwners.removed.splice(0);
    v.renamedOwners.unresolved.push({ oldFile: entry.oldFile, candidates: entry.otherOwners.map((o) => o.file),
      reason: "the other copies do not establish why the SQL copy disappeared" });
  });
  assert.deepEqual(noRemovalProof.packageCoverage.removedJarOwners, []);
  assert.deepEqual(noRemovalProof.unresolved.reasons, ["unexplained_package_loss"]);
  const [sql] = noRemovalProof.unresolved.unexplainedPackageLosses;
  assert.ok(noRemovalProof.old.packages[sql].file.endsWith("/opensearch-sql/jsr305-3.0.2.jar"));
  assert.ok(noRemovalProof.candidate.packages.some((p) => p.name === noRemovalProof.old.packages[sql].name &&
    p.version === noRemovalProof.old.packages[sql].version));
  const unresolved = await witnessedComparison(data, (v) => {
    const entry = row(v);
    v.renamedOwners.owners.splice(v.renamedOwners.owners.indexOf(entry), 1);
    v.renamedOwners.unresolved.push({ oldFile: entry.oldFile, candidates: [entry.file], reason: "unverified succession" });
  });
  assert.equal(unresolved.qualification, "failed");
  assert.equal(unresolved.packageCoverage.unresolvedOwnerPackages.length, 3);
  assert.equal(unresolved.unresolved.unexplainedPackageLosses.length, 3);
});

test("separates ten physically observed SDK copies from publication ambiguity and genuine detection losses", async () => {
  const data = inputs({ fullCoverage: true }), pair = data.candidateReport;
  const table = read("renamed-jar-owners"), observed = [];
  for (const { oldFile, candidates } of table.unresolved) {
    const local = candidates.filter((file) => path.posix.dirname(file) === path.posix.dirname(oldFile));
    assert.equal(local.length, 1);
    const pkg = globalThis.structuredClone(data.oldReport.json.Results[1].Packages.find((p) => p.FilePath === oldFile));
    const lib = globalThis.structuredClone(data.oldReport.sbom.components.find((c) => fileOf(c)?.value === oldFile));
    const layer = pair.json.Metadata.Layers[3];
    pkg.FilePath = fileOf(lib).value = local[0];
    pkg.Layer = layer;
    lib.properties.find((p) => p.name.endsWith(":LayerDigest")).value = layer.Digest;
    lib.properties.find((p) => p.name.endsWith(":LayerDiffID")).value = layer.DiffID;
    pair.json.Results[1].Packages.push(pkg);
    pair.sbom.components.push(lib);
    observed.push({ pkg, lib, file: local[0] });
  }
  const r = await buildOpenSearchComparison(data);
  assert.equal(r.qualification, "failed");
  assert.equal(r.candidatePolicy, "blocked");
  assert.deepEqual(r.unresolved.reasons, ["ambiguous_owner_version"]);
  assert.deepEqual(r.unresolved.unexplainedPackageLosses, []);
  const observations = r.packageCoverage.unresolvedOwnerPackages;
  assert.equal(observations.length, 10);
  assert.deepEqual(r.unresolved.ambiguousOwnerVersions, observations.map((o) => o.oldPackage));
  assert.ok(observations.every((o) => o.status === "observed_version_ambiguous" && o.historicalSha1 &&
    o.historicalSha1 === o.oldSha1 && o.oldSha1 === o.candidateSha1 && o.candidatePackages.length === 1 &&
    r.candidate.packages[o.candidatePackages[0]].file === o.file));
  assert.equal(r.packageCoverage.provedMigrations.length, 374);

  // A fresh old control can itself report another published label. Preserve
  // its changed historical tuple separately from the new image's coverage.
  const changedOld = globalThis.structuredClone(data.oldReport);
  const [first] = table.unresolved;
  const oldPkg = changedOld.json.Results[1].Packages.find((p) => p.FilePath === first.oldFile);
  const oldLib = changedOld.sbom.components.find((c) => fileOf(c)?.value === first.oldFile);
  oldPkg.Version = oldLib.version = "3.9.0.0";
  oldPkg.Identifier.PURL = oldLib.purl = "pkg:maven/" + oldPkg.Name.replace(":", "/") + "@3.9.0.0";
  const relabeled = await buildOpenSearchComparison({ ...data, oldReport: changedOld, historicalInputsMatch: false });
  assert.equal(relabeled.history.packages.removed.length, 1);
  assert.equal(relabeled.unresolved.ambiguousOwnerVersions.length, 10);
  assert.deepEqual(relabeled.unresolved.unexplainedPackageLosses, []);
  assert.deepEqual(relabeled.unresolved.reasons, ["historical_package_loss", "ambiguous_owner_version"]);
  assert.equal(relabeled.candidatePolicy, "blocked");

  for (const index of [138, 227]) {
    const matched = r.packageCoverage.provedMigrations.find((m) => m.oldPackage === index);
    const original = r.candidate.packages[matched.candidatePackage];
    const candidateReport = globalThis.structuredClone(pair);
    removeMavenCopy(candidateReport, original.name, original.file);
    const lost = await buildOpenSearchComparison({ ...data, candidateReport });
    assert.deepEqual(lost.unresolved.unexplainedPackageLosses, [index]);
    assert.deepEqual(lost.unresolved.ambiguousOwnerVersions, r.unresolved.ambiguousOwnerVersions);
    assert.equal(lost.candidatePolicy, "blocked");
  }
  const [missing, wrongHash, wrongVersion, wrongLayer] = observed;
  // Other plugin copies with identical bytes and the same coordinate remain.
  removeMavenCopy(pair, missing.pkg.Name, missing.file);
  delete wrongHash.lib.hashes;
  wrongVersion.pkg.Version = wrongVersion.lib.version = "99.0.0.0";
  wrongVersion.pkg.Identifier.PURL = wrongVersion.lib.purl =
    "pkg:maven/" + wrongVersion.pkg.Name.replace(":", "/") + "@99.0.0.0";
  const layer = pair.json.Metadata.Layers[0];
  wrongLayer.pkg.Layer = layer;
  wrongLayer.lib.properties.find((p) => p.name.endsWith(":LayerDigest")).value = layer.Digest;
  wrongLayer.lib.properties.find((p) => p.name.endsWith(":LayerDiffID")).value = layer.DiffID;
  const partial = await buildOpenSearchComparison(data);
  assert.deepEqual(partial.unresolved.reasons, ["unexplained_package_loss", "ambiguous_owner_version"]);
  assert.equal(partial.unresolved.ambiguousOwnerVersions.length, 6);
  assert.equal(partial.unresolved.unexplainedPackageLosses.length, 4);
  for (const [item, status] of [[missing, "copy_not_observed"], [wrongHash, "copy_evidence_mismatch"],
    [wrongVersion, "copy_evidence_mismatch"], [wrongLayer, "copy_evidence_mismatch"]]) {
    const o = partial.packageCoverage.unresolvedOwnerPackages.find((o) => o.file === item.file);
    assert.equal(o.status, status);
    assert.ok(partial.unresolved.unexplainedPackageLosses.includes(o.oldPackage));
  }
});
