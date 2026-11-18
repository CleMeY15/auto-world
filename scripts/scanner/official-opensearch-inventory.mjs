import path from "node:path";
import { URLSearchParams } from "node:url";
import { isDeepStrictEqual as equal } from "node:util";
import { readBoundedJson } from "./controls.mjs";
import { boundedJsonBytes } from "./official-report-bytes.mjs";
import { validateOfficialImageSbom } from "./official-audit.mjs";

const root = path.resolve(import.meta.dirname, "../../docs/validation");
const oldDir = "upstream-20261118/opensearch-3.9.0";
const dir = "opensearch-310/";
const repository = "opensearchproject/opensearch";
const comparisonByteLimit = 64 * 1024 ** 2;
const historicalSource = "5d0599cdeb3589b0c2ab0e42778769c9ad771b32";
const files = {
  oldIndex: [oldDir + "-index.json", 647, "3bf4fe26aeb9f7b03c0ebcb1302bb24e855ee6b89fd926d26a71a83ef6f7e076"],
  oldPlatform: [oldDir + "-platform.json", 1622, "84871c53f4d8ec5ecc9019d234951ef0c37ca60ced365c9db2ba96e4662daef2"],
  oldConfig: [oldDir + "-config.json", 6546, "d7fb1e7bde3bdfe89c1066d8297621fe75af28d2c7e9dc9f3b8c7f2106537fba"],
  candidateIndex: [dir + "3.10.0-index.json", 647, "02d6d6e40c820ae08233b60540aa5d3d9364d64e2dc724e38d6c8c794879b2a0"],
  candidatePlatform: [dir + "3.10.0-platform.json", 1622, "ffa260e43be96b49144fb7ececbb135c3fd7081567adc781c49ec9232ce1e47f"],
  candidateConfig: [dir + "3.10.0-config.json", 6549, "5aaea29f67a40c1dada19f00f2477fd24184334d474a29fc4cc70c50166a8adc"],
  rpms: [dir + "rpms.json", 12094, "8c3d45ef8758ae6825b5e755c3c0e2414d0310028b5f3039b87e26e6bb29e3b1"],
  descriptors: [dir + "descriptors.json", 111454, "7728946d32f09f06e0d3fdaec9f6250179fa8df740c0e97ce3ddabdb49eeee19"],
  jars: [dir + "jar-paths.json", 75628, "cd573a3a0a4071d343e99ae74f63da2fcd464dccfc2ee8fedae484f0b518fb59"],
  correspondence: [dir + "matched-82.json", 64841, "43319234891a5c18f32c143dcd80e74bbf6d62680d37aec5aaf9feafa13e78d8"],
  receipt: [dir + "official-audit-receipt.json", 163221, "927f0336de75c2e5747d68d958e52c9543de8bee629ca15613fba19488c02159"],
  json: [dir + "image-opensearch.json", 1701419, "56668110157c3e5acd463912679c5939af61829fb820c35bb1191dcd8eeb224c"],
  sbom: [dir + "image-opensearch.cdx.json", 1492475, "ffb0fd9a50935de5009c4b1fe0db590235b494531579a66dfa977695f237a730"],
};
function requireEvidence(condition, reason) {
  if (!condition) throw new Error("scanner_opensearch_" + reason.slice(0, 1024));
}
async function readReference(directory, key) {
  const [file, size, sha256] = files[key];
  let input;
  try { input = await readBoundedJson(path.join(directory, file), size); }
  catch (cause) { throw new Error("scanner_opensearch_reference_invalid: " + file, { cause }); }
  requireEvidence(equal(input.identity, { size, sha256 }), "reference_identity: " + file);
  return { value: input.value, identity: { file, ...input.identity } };
}
export async function readOpenSearchReferences(directory = root) {
  const values = {}, identities = {};
  for (const key of Object.keys(files)) {
    const input = await readReference(directory, key);
    values[key] = input.value;
    identities[key] = input.identity;
  }
  return { values, identities };
}
function subject(side) {
  const digest = (object) => "sha256:" + files[side + object][2];
  return { repository, role: side === "old" ? "opensearch" : "opensearch-candidate",
    version: side === "old" ? "3.9.0" : "3.10.0", manifestDigest: digest("Index"),
    platform: { os: "linux", architecture: "amd64", digest: digest("Platform") }, configId: digest("Config") };
}
function verifyOci(side, refs) {
  const pin = subject(side), manifest = refs[side + "Platform"], config = refs[side + "Config"];
  const descriptors = refs[side + "Index"].manifests.filter((m) => m.platform.os === "linux" && m.platform.architecture === "amd64");
  requireEvidence(descriptors.length === 1 && descriptors[0].digest === pin.platform.digest &&
    descriptors[0].size === files[side + "Platform"][1] && manifest.config.digest === pin.configId &&
    manifest.config.size === files[side + "Config"][1] && config.os === "linux" && config.architecture === "amd64", "oci_descriptor_invalid");
  requireEvidence(manifest.layers.length === 7 && manifest.layers.every((l) => Number.isSafeInteger(l.size) && l.size > 0 && /^sha256:[a-f0-9]{64}$/u.test(l.digest)) &&
    (side === "old" || manifest.layers.reduce((n, l) => n + l.size, 0) === 1160663754), "oci_layers_invalid");
}

// The first-format gate reads only the three pinned OCI objects. The complete
// comparison reuses the same predicate with its already authenticated inputs.
export async function validateOpenSearchComparisonJson(json, side = "candidate") {
  requireEvidence(["old", "candidate"].includes(side), "subject_role_invalid");
  const refs = {};
  for (const suffix of ["Index", "Platform", "Config"]) {
    const key = side + suffix;
    refs[key] = (await readReference(root, key)).value;
  }
  verifyOci(side, refs);
  validateJsonSubject(json, side, refs);
}
function validateJsonSubject(json, side, refs) {
  const pin = subject(side), ref = repository + "@" + pin.platform.digest;
  requireEvidence(json?.SchemaVersion === 2 && json.Trivy?.Version === "0.76.2" &&
    json.ArtifactType === "container_image" && json.ArtifactName === ref && json.Metadata?.Reference === ref &&
    Array.isArray(json.Results) && json.Results.length > 0 && json.Results.length <= 4096 &&
    equal(json.Metadata.RepoDigests, [ref]) && json.Metadata.ImageConfig?.architecture === "amd64" &&
    json.Metadata.ImageConfig.os === "linux" && json.Metadata.ImageID === pin.configId, side + "_json_subject_invalid");
  const config = refs[side + "Config"], manifest = refs[side + "Platform"];
  const ids = config.rootfs.diff_ids, layers = json.Metadata.Layers;
  requireEvidence(equal(json.Metadata.ImageConfig, config) && equal(json.Metadata.DiffIDs, ids) &&
    Array.isArray(layers) && layers.length === manifest.layers.length && layers.length === ids.length &&
    layers.every((layer, i) => layer?.Digest === manifest.layers[i].digest && layer.DiffID === ids[i]),
    side + "_json_subject_invalid");
  const layerIds = new Map(layers.map((layer) => [layer.Digest, layer.DiffID]));
  for (const result of json.Results) {
    for (const rows of [result.Packages ?? [], result.Vulnerabilities ?? []]) {
      for (const { Layer } of rows) {
        if (Layer !== undefined) requireEvidence(layerIds.has(Layer?.Digest) && layerIds.get(Layer.Digest) === Layer.DiffID,
          side + "_json_layer_invalid");
      }
    }
  }
}

function property(component, name) {
  const matches = component.properties?.filter((p) => p.name === "aquasecurity:trivy:" + name);
  requireEvidence(matches?.length === 1 && typeof matches[0].value === "string", "sbom_property_invalid: " + name);
  return matches[0].value;
}

// Use the scanner and both payload identities, never mutable metadata timestamps.
// The transport authenticates the current bytes before supplying these records.
function historicalInputComparison(inputs) {
  const scanner = { size: 176386208, sha256: "6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3" };
  const databases = [
    ["db/trivy.db", 1760485376, "7244f40ff53c4ac2909d8fba04aa4937354a620c380dc83bbc51df715f6cd68d"],
    ["java-db/trivy-java.db", 1582481408, "a41f53b9b2b3d57ef45aeda3abd8f03dc17dfcacc5aaec277600218919de5e15"],
  ];
  const valid = (x) => Number.isSafeInteger(x?.size) && x.size > 0 && /^[0-9a-f]{64}$/u.test(x.sha256);
  requireEvidence(valid(inputs?.scanner) && Array.isArray(inputs.databaseFiles), "historical_input_identity_invalid");
  const changes = [{ file: "scanner", historical: scanner, current: { size: inputs.scanner.size, sha256: inputs.scanner.sha256 } }];
  for (const [file, size, sha256] of databases) {
    const records = inputs.databaseFiles.filter((record) => record?.file === file);
    requireEvidence(records.length === 1 && valid(records[0]), "database_identity_invalid: " + file);
    changes.push({ file, historical: { size, sha256 }, current: { size: records[0].size, sha256: records[0].sha256 } });
  }
  return changes.map((entry) => ({ ...entry, identical: equal(entry.current, entry.historical) }));
}

export function openSearchHistoricalInputsMatch(inputs) {
  return historicalInputComparison(inputs).every((entry) => entry.identical);
}

function positions(rows, key) {
  const index = new Map();
  for (const [i, row] of rows.entries()) {
    const k = key(row);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(i);
  }
  return index;
}
function delta(before, after, key = JSON.stringify) {
  const available = positions(after, key);
  for (const occurrences of available.values()) occurrences.reverse();
  const matched = [], removed = [], used = new Set();
  for (const [i, row] of before.entries()) {
    const j = available.get(key(row))?.pop();
    if (j === undefined) removed.push(i);
    else { matched.push([i, j]); used.add(j); }
  }
  return { matched, removed, added: [...after.keys()].filter((j) => !used.has(j)) };
}
const copyKey = (name, version, file) => JSON.stringify([name, version, file]);
const versionOf = (p) => (p.epoch ? p.epoch + ":" : "") + p.version + (p.release ? "-" + p.release : "");
function rpmArch(name, arch) {
  if (name === "gpg-pubkey" && arch == null) return "None";
  requireEvidence(typeof arch === "string" && arch && (arch !== "None" || name === "gpg-pubkey"), "rpm_arch_invalid");
  return arch;
}
function rpmIdentity(p) {
  return [p.name, String(p.epoch), p.version, p.release, rpmArch(p.name, p.arch)];
}
function componentKey(type, name, version, purl, file) {
  return JSON.stringify([type, name, version, purl, file]);
}
function validatePurl(p) {
  if (p.type === "jar") {
    const parts = p.name.split(":");
    requireEvidence(parts.length === 2 && parts.every(Boolean) && typeof p.file === "string" && p.file &&
      decodeURIComponent(p.purl) === "pkg:maven/" + parts.join("/") + "@" + p.version, "maven_coordinate_invalid");
  } else if (p.type === "amazon") {
    const [base, query] = p.purl.split("?");
    const params = new URLSearchParams(query);
    requireEvidence(decodeURIComponent(base) === "pkg:rpm/amazon/" + p.name + "@" + p.version + "-" + p.release &&
      params.getAll("arch").length <= 1 && rpmArch(p.name, params.get("arch")) === rpmArch(p.name, p.arch) &&
      params.getAll("epoch").length <= 1 && (params.get("epoch") ?? "0") === String(p.epoch), "rpm_purl_invalid");
  }
}

// Bound expanded rows as they are produced: an unusually long result.Target
// occurs just once in the input, but can appear in many projected occurrences.
function append(rows, row, budget) {
  budget.bytes += boundedJsonBytes(row, comparisonByteLimit - budget.bytes, "scanner_opensearch_projection_limit").length;
  requireEvidence(budget.bytes <= comparisonByteLimit && rows.length < 100000, "projection_limit");
  rows.push(row);
}
function inventory(pair, side, refs, budget) {
  const { json, sbom } = pair ?? {};
  validateJsonSubject(json, side, refs);
  const pin = subject(side), ref = json.ArtifactName, rootComponent = sbom?.metadata?.component;
  const purl = "pkg:oci/opensearch@" + pin.platform.digest + "?arch=amd64&repository_url=index.docker.io%2Fopensearchproject%2Fopensearch";
  requireEvidence(rootComponent?.purl === purl && rootComponent["bom-ref"] === purl &&
    property(rootComponent, "ImageID") === pin.configId && property(rootComponent, "Reference") === ref &&
    property(rootComponent, "RepoDigest") === ref, side + "_sbom_subject_invalid");
  const ids = rootComponent.properties.filter((p) => p.name === "aquasecurity:trivy:DiffID").map((p) => p.value);
  requireEvidence(equal(ids, [...json.Metadata.DiffIDs].sort()), side + "_sbom_subject_invalid");
  const layerIds = new Map(json.Metadata.Layers.map((layer) => [layer.Digest, layer.DiffID]));
  validateOfficialImageSbom(json, sbom, pin);

  const packages = [], findings = [];
  for (const [resultIndex, result] of json.Results.entries()) {
    const os = result.Class === "os-pkgs";
    if (os) requireEvidence(result.Type === "amazon" && json.Metadata.OS?.Family === "amazon" &&
      result.Target === ref + " (amazon " + json.Metadata.OS.Name + ")", "rpm_target_invalid");
    const location = { class: result.Class, type: result.Type, target: os ? null : result.Target };
    const local = [];
    for (const [i, raw] of result.Packages.entries()) {
      const row = { ...location, name: raw.Name, version: raw.Version, epoch: raw.Epoch ?? 0, release: raw.Release ?? "",
        arch: os ? rpmArch(raw.Name, raw.Arch) : raw.Arch ?? null, file: raw.FilePath ?? null, purl: raw.Identifier?.PURL ?? "" };
      validatePurl(row);
      local.push({ key: copyKey(row.name, versionOf(row), row.file), index: packages.length, uid: raw.Identifier?.UID });
      append(packages, { ...row, resultIndex, index: i }, budget);
    }
    const copies = positions(local, (x) => x.key);
    const byUid = positions(local, (x) => JSON.stringify([x.key, x.uid]));
    for (const [i, v] of (result.Vulnerabilities ?? []).entries()) {
      const file = v.PkgPath ?? null;
      const key = copyKey(v.PkgName, v.InstalledVersion, file);
      const matches = v.PkgIdentifier?.UID ? byUid.get(JSON.stringify([key, v.PkgIdentifier.UID])) : copies.get(key);
      requireEvidence(matches?.length === 1, side + "_finding_package_mismatch: " + (file ?? v.PkgName));
      const packageIndex = local[matches[0]].index;
      requireEvidence(!v.PkgIdentifier?.PURL || v.PkgIdentifier.PURL === packages[packageIndex].purl,
        side + "_finding_purl_mismatch: " + (file ?? v.PkgName));
      requireEvidence(["HIGH", "CRITICAL"].includes(v.Severity), "finding_severity_invalid");
      append(findings, { ...location, vulnerabilityId: v.VulnerabilityID, name: v.PkgName, file, installed: v.InstalledVersion,
        fixed: v.FixedVersion ?? "", severity: v.Severity, packageIndex, resultIndex, index: i }, budget);
    }
  }
  const libraries = [];
  for (const [index, c] of sbom.components.entries()) {
    if (c.type !== "library") continue;
    if (c.properties.some((p) => ["aquasecurity:trivy:LayerDiffID", "aquasecurity:trivy:LayerDigest"].includes(p.name))) {
      requireEvidence(layerIds.get(property(c, "LayerDigest")) === property(c, "LayerDiffID"), side + "_sbom_layer_invalid");
    }
    const type = property(c, "PkgType"), name = c.group ? c.group + (type === "jar" ? ":" : "/") + c.name : c.name;
    const file = c.properties.some((p) => p.name === "aquasecurity:trivy:FilePath") ? property(c, "FilePath") : null;
    libraries.push({ key: componentKey(type, name, c.version, c.purl ?? "", file), index });
  }
  const keys = packages.map((p) => componentKey(p.type, p.name, versionOf(p), p.purl, p.file));
  const relation = delta(keys, libraries.map((l) => l.key), (k) => k);
  const missing = relation.removed[0], extra = relation.added[0];
  requireEvidence(missing === undefined && extra === undefined,
    side + "_json_sbom_copy_mismatch: " + (keys[missing] ?? libraries[extra]?.key));
  for (const [i, j] of relation.matched) packages[i].sbomComponent = libraries[j].index;
  requireEvidence(sbom.vulnerabilities === undefined || Array.isArray(sbom.vulnerabilities), "sbom_vulnerabilities_invalid");
  return { subject: pin, artifactName: ref, reportId: json.ReportID, sbomSerialNumber: sbom.serialNumber,
    targets: json.Results.map((r) => r.Target), packages, findings, sbomAdvisoryEntries: sbom.vulnerabilities?.length ?? 0 };
}

function packageKey(p) {
  return JSON.stringify([p.class, p.type, p.target, p.name, p.file, p.epoch, p.version, p.release, p.arch, p.purl]);
}
function findingKey(v) {
  return JSON.stringify([v.class, v.type, v.target, v.name, v.file, v.installed, v.vulnerabilityId, v.severity, v.fixed]);
}
function versionParts(version) {
  requireEvidence(/^\d+(?:\.\d+)+(?:-jre)?$/u.test(version), "historical_version_unsupported");
  return version.split("-")[0].split(".").map(Number);
}
function compareParts(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
function threshold(version, fixed) {
  const current = versionParts(version), floors = fixed.split(/,\s*/u).map((text) => ({ text, parts: versionParts(text) }));
  // Select the matching minor stream when fixes were published for multiple
  // minor streams. Guava has one floor across majors; JLine has one per major.
  const major = floors.filter((f) => f.parts[0] === current[0]);
  const applicable = floors.length === 1 ? floors : major.length === 1 ? major : major.filter((f) => f.parts[1] === current[1]);
  requireEvidence(applicable.length === 1, "historical_fix_branch_ambiguous");
  return { floor: applicable[0].text, meetsFloor: compareParts(current, applicable[0].parts) >= 0 };
}

function outerJar(file) {
  return file.match(/^(.+?\.jar)(?:[!/:]|$)/u)?.[1];
}
function jarCoverage(refs, candidate) {
  const paths = new Set(refs.jars), detected = new Map();
  const outsideStaticInventory = [];
  for (const [i, pkg] of candidate.packages.entries()) {
    if (pkg.type !== "jar") continue;
    // Trivy can identify an inner archive. Keep its exact path on the package
    // row, and separately attribute coverage to the physical outer archive.
    const outer = outerJar(pkg.file);
    if (!paths.has(outer)) {
      outsideStaticInventory.push(i);
      continue;
    }
    if (!detected.has(outer)) detected.set(outer, []);
    detected.get(outer).push(i);
  }
  const jars = refs.jars.map((file) => ({ file, packages: detected.get(file) ?? [] }));
  const descriptors = Object.keys(refs.descriptors).filter((p) => p.endsWith("/plugin-descriptor.properties")).map((file) => {
    const directory = file.slice(0, file.lastIndexOf("/") + 1);
    const paths = jars.filter((j) => j.file.startsWith(directory));
    return { file, jarPaths: paths.length, detectedPaths: paths.filter((j) => j.packages.length).length };
  });
  requireEvidence(paths.size === 949 && descriptors.filter((d) => d.file.includes("/plugins/")).length === 26, "static_coverage_invalid");
  return { jars, descriptors, outsideStaticInventory, undetectedJarPaths: jars.filter((j) => !j.packages.length).map((j) => j.file),
    jdkRelease: refs.descriptors["usr/share/opensearch/jdk/release"] };
}

function checkedRpms(refs, inv) {
  const rpmIndices = [...inv.packages.keys()].filter((i) => inv.packages[i].type === "amazon");
  const rows = rpmIndices.map((i) => rpmIdentity(inv.packages[i]));
  const staticRows = refs.rpms.installed.map(([name, epoch, version, release, arch]) => [name, epoch, version, release, rpmArch(name, arch)]);
  const comparison = delta(staticRows, rows);
  requireEvidence(staticRows.length === 111, "static_rpm_inventory_invalid");
  return { matched: comparison.matched.map(([staticIndex, index]) => ({ staticIndex, packageIndex: rpmIndices[index] })),
    gaps: { missingStaticIndices: comparison.removed, unexpectedPackageIndices: comparison.added.map((index) => rpmIndices[index]) } };
}

function historicalProjection(f) {
  return { target: f.target, VulnerabilityID: f.vulnerabilityId, PkgName: f.name, PkgPath: f.file,
    InstalledVersion: f.installed, FixedVersion: f.fixed, Severity: f.severity };
}
function javaIndex(inv) {
  return positions(inv.packages, (p) => p.type === "jar" ? copyKey(p.name, p.version, p.file) : null);
}
function correspondence(refs, baseline, old, candidate) {
  const oldCopies = javaIndex(old), newCopies = javaIndex(candidate);
  const byAdvisory = (v) => JSON.stringify([v.target, v.vulnerabilityId, v.name, v.file, v.installed]);
  const oldFindings = positions(old.findings, byAdvisory), newFindings = positions(candidate.findings, byAdvisory);
  for (const index of [oldFindings, newFindings]) for (const matches of index.values()) matches.reverse();
  return refs.correspondence.map(({ original, candidate: [file, evidence, coordinate, jarDigest] }, index) => {
    const base = baseline.findings[index];
    requireEvidence(equal(original, historicalProjection(base)), "historical_path_binding_invalid");
    const name = coordinate.groupId + ":" + coordinate.artifactId;
    const pkg = oldCopies.get(copyKey(base.name, base.installed, base.file));
    const copies = newCopies.get(copyKey(name, coordinate.version, file));
    requireEvidence(name === base.name, "historical_coordinate_binding_invalid");
    const fresh = oldFindings.get(byAdvisory(base))?.pop() ?? null;
    const advisory = newFindings.get(byAdvisory({ ...base, file, installed: coordinate.version }))?.pop();
    return { historicalFinding: index, original, oldPackage: pkg?.length === 1 ? pkg[0] : null,
      oldPackageMatches: pkg ?? [], oldFinding: fresh, oldThreshold: threshold(base.installed, base.fixed),
      candidatePackage: copies?.length === 1 ? copies[0] : null, candidatePackageMatches: copies ?? [],
      candidateFindings: advisory === undefined ? [] : [advisory], candidateThreshold: threshold(coordinate.version, base.fixed), file, evidence, coordinate, jarDigest };
  });
}

function roleBlockers(blockers, inv, json, budget) {
  requireEvidence(Array.isArray(blockers) && blockers.length <= 100000, "policy_blockers_missing");
  // Transport already ran the unwaived policy. Bind its actual objects to
  // emitted findings, including their multiplicity and the exact OS target.
  const actual = [];
  for (const blocker of blockers) append(actual, { role: inv.subject.role, ...blocker }, budget);
  const offset = json.Metadata.OS?.EOSL === true ? 1 : 0;
  requireEvidence(actual.length === inv.findings.length + offset &&
    (!offset || equal(actual[0], { role: inv.subject.role, code: "image_os_end_of_life" })), inv.subject.role + "_policy_count_mismatch");
  for (const [i, v] of inv.findings.entries()) {
    const b = actual[i + offset];
    requireEvidence(["image_vulnerability_blocked", "unfixed_high_needs_independent_disposition"].includes(b.code) &&
      b.role === inv.subject.role && b.imageDigest === inv.subject.manifestDigest && b.target === json.Results[v.resultIndex].Target &&
      b.vulnerabilityId === v.vulnerabilityId && b.packageName === v.name && b.installedVersion === v.installed &&
      b.fixedVersion === v.fixed && b.severity === v.severity, inv.subject.role + "_policy_occurrence_mismatch");
  }
  return actual;
}

function pathDelta(old, candidate) {
  const files = (inv) => [...new Set(inv.packages.map((p) => p.file).filter(Boolean))].sort();
  const oldPaths = files(old), candidatePaths = files(candidate);
  return { oldPaths, candidatePaths, ...delta(oldPaths, candidatePaths) };
}

export async function buildOpenSearchComparison({ oldReport, candidateReport, historicalInputsMatch, currentInputs, oldBlockers, candidateBlockers }) {
  requireEvidence(typeof historicalInputsMatch === "boolean", "historical_context_missing");
  const inputComparison = currentInputs === undefined ? null : historicalInputComparison(currentInputs);
  requireEvidence(!inputComparison || inputComparison.every((x) => x.identical) === historicalInputsMatch, "historical_context_contradiction");
  const { values: refs, identities } = await readOpenSearchReferences();
  for (const side of ["old", "candidate"]) verifyOci(side, refs);
  const { receipt } = refs, historicalBlockers = receipt.blockers.filter((b) => b.role === "opensearch");
  requireEvidence(receipt.run.GITHUB_SHA === historicalSource && receipt.run.GITHUB_RUN_ID === "44321947040" &&
    receipt.run.GITHUB_RUN_ATTEMPT === "1" && receipt.blockers.length === 110 && historicalBlockers.length === 82 &&
    openSearchHistoricalInputsMatch(receipt.awsComparisonInputs), "historical_receipt_invalid");
  const baseline = inventory(refs, "old", refs, { bytes: 0 });
  const budget = { bytes: 0 };
  const old = inventory(oldReport, "old", refs, budget), candidate = inventory(candidateReport, "candidate", refs, budget);
  old.blockers = roleBlockers(oldBlockers, old, oldReport.json, budget);
  candidate.blockers = roleBlockers(candidateBlockers, candidate, candidateReport.json, budget);
  const orderedBlockersMatch = equal(historicalBlockers, old.blockers);
  const orderedFindingPathsMatch = equal(baseline.findings.map(findingKey), old.findings.map(findingKey));
  const historicalPackages = delta(baseline.packages, old.packages, packageKey);
  requireEvidence(baseline.findings.length === 82 && refs.correspondence.length === 82, "historical_finding_count_invalid");
  const mapped = correspondence(refs, baseline, old, candidate);
  const mappedCandidateFindings = new Set(mapped.flatMap((m) => m.candidateFindings));
  const jars = jarCoverage(refs, candidate);
  // A physical JAR still shipped at the same path must not silently lose
  // scanner visibility that the previous report established for that path.
  const oldJarPaths = new Set(old.packages.filter((p) => p.type === "jar").map((p) => outerJar(p.file)));
  const lostJarPaths = jars.undetectedJarPaths.filter((file) => oldJarPaths.has(file));
  const missingBelowFloorAdvisories = mapped.filter((row) => !row.candidateThreshold.meetsFloor &&
    !row.candidateFindings.length).map((row) => row.historicalFinding);
  const packages = delta(old.packages, candidate.packages, packageKey);
  const staticPaths = new Set(refs.jars);
  const migrations = new Map(mapped.filter((row) => row.oldPackage !== null && row.candidatePackage !== null)
    .map((row) => [row.oldPackage, row]));
  const addedCopies = new Set(packages.added);
  const provedMigrations = [], removedJarOwners = [], unexplainedPackageLosses = [];
  for (const index of packages.removed) {
    const p = old.packages[index], owner = p.type === "jar" && outerJar(p.file);
    const migration = migrations.get(index);
    if (migration && addedCopies.delete(migration.candidatePackage)) {
      provedMigrations.push({ oldPackage: index, candidatePackage: migration.candidatePackage,
        historicalFinding: migration.historicalFinding });
    } else if (owner && !staticPaths.has(owner)) {
      // The static inventory establishes removal of this physical owner only.
      removedJarOwners.push({ oldPackage: index, owner });
    } else {
      unexplainedPackageLosses.push(index);
    }
  }
  const missingMappedCopies = mapped.filter((row) => row.oldPackage === null || row.candidatePackage === null)
    .map((row) => row.historicalFinding);
  const oldRpms = checkedRpms(refs, old), candidateRpms = checkedRpms(refs, candidate);
  const rpmGaps = { old: oldRpms.gaps, candidate: candidateRpms.gaps };
  const reasons = [];
  if (historicalInputsMatch && (!orderedBlockersMatch || !orderedFindingPathsMatch)) reasons.push("historical_ordered_replay_mismatch");
  // A different advisory DB does not establish a package removal on the same image.
  if (historicalPackages.removed.length) reasons.push("historical_package_loss");
  if (missingMappedCopies.length) reasons.push("mapped_copy_missing_or_ambiguous");
  if (Object.values(rpmGaps).some((rpm) => rpm.missingStaticIndices.length || rpm.unexpectedPackageIndices.length)) reasons.push("rpm_inventory_mismatch");
  if (jars.outsideStaticInventory.length) reasons.push("jar_outside_static_inventory");
  if (lostJarPaths.length) reasons.push("jar_detection_loss");
  if (unexplainedPackageLosses.length) reasons.push("unexplained_package_loss");
  if (missingBelowFloorAdvisories.length) reasons.push("below_floor_advisories_unmeasured");
  const findings = delta(old.findings, candidate.findings, findingKey);
  const result = {
    qualification: reasons.length ? "failed" : "passed", reason: reasons.length ? "scanner_opensearch_" + reasons[0] : null,
    references: identities,
    history: { run: receipt.run, artifact: { id: "14436050679", size: 923534, sha256: "838d34d5ecbfc9b423342e47e39120be6ccad3908cbf8809a880cce074e1ea0b" },
      inputs: receipt.awsComparisonInputs, historicalInputsMatch, inputComparison,
      replayContext: historicalInputsMatch ? "same scanner and database payloads" : "changed scanner or database payloads",
      orderedBlockersMatch, orderedFindingPathsMatch,
      orderedBlockers: receipt.blockers, packages: historicalPackages,
      findings: delta(baseline.findings, old.findings, findingKey) },
    old, candidate, correspondence: mapped, paths: pathDelta(old, candidate),
    // Coordinate coverage at the exact path ignores only version/EVR. The
    // independently verified 82 mappings explain known JAR path migrations.
    packageCoverage: { ...delta(old.packages, candidate.packages, (p) => JSON.stringify([p.class, p.type, p.target, p.name, p.arch, p.file])),
      provedMigrations, removedJarOwners },
    candidateFindingsOutsideHistoricalMapping: [...candidate.findings.keys()].filter((i) => !mappedCandidateFindings.has(i)),
    rpmCoverage: { old: oldRpms.matched, candidate: candidateRpms.matched, gaps: rpmGaps }, jarCoverage: jars,
    packages, findings,
    unresolved: { reasons, missingMappedCopies, unexplainedPackageLosses, lostJarPaths, missingBelowFloorAdvisories, undetectedStaticJarPaths: jars.undetectedJarPaths.length,
      belowHistoricalFloor: mapped.filter((m) => !m.candidateThreshold.meetsFloor).map((m) => m.historicalFinding),
      candidateAdvisoryOccurrences: candidate.findings.length, newlyObservedFindingTuples: findings.added.length },
    sourceEvidence: { coreTagCommit: "b9f09249b4a9922f0d0bc5bb8f62f90cf95e5eea",
      buildManifestCommit: "e9a16a55b7c3973736992477a7064e7af4bd8d06", reproducibility: "unverified", admission: "unauthorized" },
    visibility: "JSON HIGH,CRITICAL advisory occurrences and detected packages. CycloneDX supplies package coverage. Lower severities and invisible components are outside this measurement.",
    oldPolicy: old.blockers.length ? "blocked" : "clean", candidatePolicy: candidate.blockers.length ? "blocked" : "clean",
  };
  boundedJsonBytes(result, comparisonByteLimit, "scanner_opensearch_comparison_limit");
  return result;
}
