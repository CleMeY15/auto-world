import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { MANAGED_SEAWEED_MATERIAL, validateManagedSeaweedConfig } from "./managed-seaweed.mjs";
import { evaluateArchiveImageReport } from "./official-controls.mjs";

const MiB = 1024 ** 2;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROFILE = "SOURCE_BOUND_SEAWEED_V1";
const CANDIDATE_SHA256 = "7596c85c80dfdf59177e1b51c443c5f74d82852f23cb87d3378d142c42f27179";
const BASE_IMAGE_ID = "sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6";
const BASE_LAYERS = Object.freeze([
  "sha256:75c137aedfb2760f88629236cb7b797630aed0c3d91d626d1d1bb694878fc2ba",
  "sha256:14d28a8561c0323bfa76edd6bca302081ac63d3b0cb7ef45955a69e729ce0f06",
  "sha256:5c2a12fbb0348e17e541422ab5639226008d4bfd0a133ea759470dc537cce42f",
  "sha256:c9aac12923afabb4e0b0cd4c30c2c96f17aec00a258928880581d8861c59bcf6",
  "sha256:18a6be0eab2649832a383d2ae3b92c11209078f4eb919717a5fbf9aabbd351fe",
  "sha256:42664d44ed25abf36ba99eb50bd36916c7112c8b028b9ce64c4265664ba233ee",
  "sha256:2bb9f79cd65bbdbc3eff10877e1752e8a6013f11e3d529455dd51025583b19a2",
  "sha256:8b6ee38e2c0092bcce475079cfd98fac523f6bdb133eeae9bbab154d75d6a4ca",
  "sha256:83f90d3184f33a3dc2d8a502016cd4a129354efaaae30ef8e48046e9371ac239",
  "sha256:5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef",
]);
const INHERITED_LAYER = BASE_LAYERS[1];
const OVERLAY_IDS = Object.freeze([
  "github.com/seaweedfs/seaweedfs",
  "stdlib@v1.27.3",
  "github.com/go-jose/go-jose/v4@v4.1.6",
  "golang.org/x/net@v0.62.0",
]);
const MATERIAL_FILES = Object.freeze([
  Object.freeze(["source-sha256.txt", 128]),
  Object.freeze(["original-module-sha256.txt", 256]),
  Object.freeze(["corrected-module-sha256.txt", 256]),
  Object.freeze(["go.mod", 64 * 1024]),
  Object.freeze(["go.sum", 512 * 1024]),
  Object.freeze(["module-verify.txt", 64]),
  Object.freeze(["compiler-version.txt", 64]),
  Object.freeze(["module-inventory.json", MiB]),
  Object.freeze(["build-info.txt", 64 * 1024]),
  Object.freeze(["binary-sha256.txt", 128]),
]);
const FIXED_FILES = Object.freeze({
  "module-verify.txt": Object.freeze([21, "b4537ed75f533f993f371954de47e42a793b8e5b0587577de7e27fb3e50696bd"]),
  "compiler-version.txt": Object.freeze([32, "5707bf75dd54b4fdd5ac209444d48c9c4179ebf8510f80e2f7293dfbedc1012b"]),
  "module-inventory.json": Object.freeze([435461, "08196d6bfd4aea8f9df956bbec0b25cf44c969fff4a6181de9fbb59ab1d1c5af"]),
  "build-info.txt": Object.freeze([23171, "8e51d77d80000889804be06e6f5ebd4d1faca583a7d3fe7fc390d5548124a74d"]),
  "binary-sha256.txt": Object.freeze([76, "0df27bc0a132732a6333a5150451994ead63d6b9d58c27cc57a1ec57a45703f5"]),
});
const boundEvidence = new WeakSet();

const fail = (code = "scanner_managed_seaweed_source_profile_invalid") => { throw new Error(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => globalThis.structuredClone(value);
const utf8 = (bytes) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail(); }
};
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
const overlaps = (left, right) => left.buffer === right.buffer &&
  left.byteOffset < right.byteOffset + right.byteLength && right.byteOffset < left.byteOffset + left.byteLength;

function fixedData(url, expectedBytes, expectedSha256) {
  const original = readFileSync(url);
  const text = utf8(original).replaceAll("\r\n", "\n");
  requireValue(!text.includes("\r"));
  const bytes = Buffer.from(text, "utf8");
  requireValue(bytes.length === expectedBytes && hash(bytes) === expectedSha256);
  const value = JSON.parse(bytes);
  requireValue(Array.isArray(value));
  return deepFreeze(value);
}

const PACKAGE_DATA = fixedData(new URL("./seaweed-source-packages.json", import.meta.url), 90964,
  "d831ecc18c448d5e9a67de71017d45155d2e555de1fb81afd0ef4e594b41e4fb");
const SBOM_DATA = fixedData(new URL("./seaweed-source-sbom.json", import.meta.url), 119199,
  "de271a4e0cc7291b8496ec71f6610f2c72c8d3765731640ad5f62621bc3e251c");
const PACKAGE_BY_NAME_VERSION = new Map(PACKAGE_DATA.filter((entry) => entry.Version !== undefined)
  .map((entry) => [JSON.stringify([entry.Name, entry.Version]), entry]));
const MAIN_PACKAGE = PACKAGE_DATA.find((entry) => entry.ID === OVERLAY_IDS[0]);
const OVERLAY_SET = new Set(OVERLAY_IDS);
requireValue(PACKAGE_DATA.length === 245 && SBOM_DATA.length === 245 && MAIN_PACKAGE &&
  PACKAGE_DATA.filter((entry) => !Object.hasOwn(entry.Layer, "DiffID")).map((entry) => entry.ID).join("\n") === OVERLAY_IDS.join("\n") &&
  PACKAGE_DATA.filter((entry) => entry.Layer.DiffID === INHERITED_LAYER).length === 241);

function validSubject(subject) {
  return subject?.kind === "LOCAL_MANAGED_IMAGE_V1" && subject.artifactName === "/managed-image-seaweedfs.tar" &&
    DIGEST.test(subject.imageId ?? "") && subject.os === "linux" && subject.architecture === "amd64" &&
    SHA256.test(subject.archiveSha256 ?? "") && Number.isSafeInteger(subject.archiveBytes) && subject.archiveBytes > 0 &&
    subject.archiveBytes <= 2 * 1024 ** 3 && subject.archiveCapBytes === 2 * 1024 ** 3;
}

function detachedBuffers(values) {
  requireValue(values.every(Buffer.isBuffer));
  for (let left = 0; left < values.length; left++) {
    for (let right = left + 1; right < values.length; right++) requireValue(!overlaps(values[left], values[right]));
  }
  return values.map((value) => Buffer.from(value));
}

function parseInspection(bytes) {
  requireValue(bytes.length <= MiB);
  const text = utf8(bytes);
  requireValue(!text.includes("\0") && !text.includes("\r"));
  let value;
  try { value = JSON.parse(text); } catch { fail(); }
  requireValue(Array.isArray(value) && value.length === 1);
  return value;
}

function exactMaterial(files, name, bytes, sha256) {
  const value = files.get(name);
  requireValue(value?.length === bytes && hash(value) === sha256);
}

function validateBuildInfo(bytes) {
  const lines = utf8(bytes).split("\n");
  requireValue(lines.at(-1) === "" && !lines.slice(0, -1).some((line) => line.includes("\r")));
  lines.pop();
  requireValue(lines[0] === "/out/weed: go1.27.3" && !lines.some((line) => line.startsWith("\t=>\t")));
  const fields = lines.slice(1).map((line) => line.split("\t").slice(1));
  requireValue(isDeepStrictEqual(fields.find(([kind]) => kind === "path"), ["path", "github.com/seaweedfs/seaweedfs/weed"]) &&
    isDeepStrictEqual(fields.find(([kind]) => kind === "mod"), ["mod", "github.com/seaweedfs/seaweedfs", "(devel)", ""]));
  const dependencies = fields.filter(([kind]) => kind === "dep");
  requireValue(dependencies.length === 243 && new Set(dependencies.map(([, name]) => name)).size === 243);
  const expected = PACKAGE_DATA.filter((entry) => ![OVERLAY_IDS[0], OVERLAY_IDS[1]].includes(entry.ID));
  requireValue(expected.length === 243 && expected.every((entry) => dependencies.some(([, name, version]) =>
    name === entry.Name && version === entry.Version)));
}

function validateMaterials(files) {
  const pin = MANAGED_SEAWEED_MATERIAL;
  requireValue(files.get("source-sha256.txt").equals(Buffer.from(`${pin.archiveSha256}  /tmp/seaweedfs-source.tar.gz\n`)));
  requireValue(files.get("original-module-sha256.txt").equals(Buffer.from(
    `${pin.originalGoModSha256}  /materials/original/go.mod\n${pin.originalGoSumSha256}  /materials/original/go.sum\n`)));
  requireValue(files.get("corrected-module-sha256.txt").equals(Buffer.from(
    `${pin.goModSha256}  go.mod\n${pin.goSumSha256}  go.sum\n`)));
  exactMaterial(files, "go.mod", 26652, pin.goModSha256);
  exactMaterial(files, "go.sum", 232835, pin.goSumSha256);
  for (const [name, [bytes, sha256]] of Object.entries(FIXED_FILES)) exactMaterial(files, name, bytes, sha256);
  requireValue(files.get("module-verify.txt").equals(Buffer.from("all modules verified\n")) &&
    files.get("compiler-version.txt").equals(Buffer.from("go version go1.27.3 linux/amd64\n")) &&
    files.get("binary-sha256.txt").equals(Buffer.from(`${CANDIDATE_SHA256}  /out/weed\n`)));
  validateBuildInfo(files.get("build-info.txt"));
}

function normalizeReportPackages(packages, overlayDiffID) {
  requireValue(Array.isArray(packages) && packages.length === 245);
  return packages.map((entry) => {
    const value = clone(entry);
    if (OVERLAY_SET.has(value.ID)) {
      requireValue(value.Layer?.DiffID === overlayDiffID);
      delete value.Layer.DiffID;
    } else requireValue(value.Layer?.DiffID === INHERITED_LAYER);
    return value;
  });
}

function sbomLayer(component) {
  const properties = component?.properties?.filter((entry) => entry?.name === "aquasecurity:trivy:LayerDiffID");
  requireValue(properties?.length === 1 && typeof properties[0].value === "string");
  return properties[0].value;
}

function normalizeSbomComponents(components, overlayDiffID) {
  requireValue(Array.isArray(components) && components.length === 245);
  return components.map((entry) => {
    const value = clone(entry);
    const packageId = value.properties?.find((property) => property?.name === "aquasecurity:trivy:PkgID")?.value;
    const layer = sbomLayer(value);
    if (OVERLAY_SET.has(packageId)) {
      requireValue(layer === overlayDiffID);
      value.properties = value.properties.filter((property) => property.name !== "aquasecurity:trivy:LayerDiffID");
    } else requireValue(layer === INHERITED_LAYER);
    return value;
  });
}

function findingIdentity(finding) {
  requireValue(finding?.PkgIdentifier === undefined || object(finding.PkgIdentifier));
  const directPurl = finding?.PURL, nestedPurl = finding?.PkgIdentifier?.PURL;
  const directUid = finding?.UID, nestedUid = finding?.PkgIdentifier?.UID;
  for (const value of [directPurl, nestedPurl, directUid, nestedUid]) {
    requireValue(value === undefined || typeof value === "string" && value.length > 0);
  }
  requireValue(directPurl === undefined || nestedPurl === undefined || directPurl === nestedPurl);
  requireValue(directUid === undefined || nestedUid === undefined || directUid === nestedUid);
  return {
    purl: directPurl ?? nestedPurl,
    uid: directUid ?? nestedUid,
  };
}

function referencesMain(finding) {
  const { purl, uid } = findingIdentity(finding);
  return finding?.PkgName === MAIN_PACKAGE.Name || finding?.PkgID === MAIN_PACKAGE.ID ||
    typeof finding?.PkgID === "string" && finding.PkgID.startsWith(`${MAIN_PACKAGE.ID}@`) ||
    purl === MAIN_PACKAGE.Identifier.PURL || typeof purl === "string" &&
      ["@", "?", "#"].some((separator) => purl.startsWith(`${MAIN_PACKAGE.Identifier.PURL}${separator}`)) ||
    uid === MAIN_PACKAGE.Identifier.UID;
}

function validateFindings(goResult, osResult) {
  for (const result of [goResult, osResult]) requireValue(result.Vulnerabilities === undefined || Array.isArray(result.Vulnerabilities));
  for (const finding of [...goResult.Vulnerabilities ?? [], ...osResult.Vulnerabilities ?? []]) requireValue(!referencesMain(finding));
  for (const finding of goResult.Vulnerabilities ?? []) {
    const matched = PACKAGE_BY_NAME_VERSION.get(JSON.stringify([finding?.PkgName, finding?.InstalledVersion]));
    requireValue(matched && matched.ID !== MAIN_PACKAGE.ID);
    const { purl, uid } = findingIdentity(finding);
    requireValue((finding.PkgID === undefined || finding.PkgID === matched.ID) &&
      (purl === undefined || purl === matched.Identifier.PURL) && (uid === undefined || uid === matched.Identifier.UID));
  }
}

function sourceComponent(subject, evidence) {
  return deepFreeze({
    profile: PROFILE,
    target: "usr/bin/weed",
    name: MAIN_PACKAGE.Name,
    version: null,
    sourceCommit: MANAGED_SEAWEED_MATERIAL.sourceCommit,
    sourceArchiveBytes: MANAGED_SEAWEED_MATERIAL.archiveBytes,
    sourceArchiveSha256: MANAGED_SEAWEED_MATERIAL.archiveSha256,
    originalGoModSha256: MANAGED_SEAWEED_MATERIAL.originalGoModSha256,
    originalGoSumSha256: MANAGED_SEAWEED_MATERIAL.originalGoSumSha256,
    goModSha256: evidence.materials.goModSha256,
    goSumSha256: evidence.materials.goSumSha256,
    moduleInventorySha256: evidence.materials.moduleInventorySha256,
    buildInfoSha256: evidence.materials.buildInfoSha256,
    builderPlatformDigest: evidence.builder.platformDigest,
    compiler: evidence.builder.compiler,
    candidateSha256: CANDIDATE_SHA256,
    finalSha256: evidence.finalSha256,
    baseImageId: evidence.layers.baseImageId,
    inheritedDiffID: evidence.layers.inheritedDiffID,
    overlayDiffID: evidence.layers.overlayDiffID,
    baseInspectionBytes: evidence.inspections.base.bytes,
    baseInspectionSha256: evidence.inspections.base.sha256,
    finalInspectionBytes: evidence.inspections.final.bytes,
    finalInspectionSha256: evidence.inspections.final.sha256,
    imageId: subject.imageId,
    archiveSha256: subject.archiveSha256,
    archiveBytes: subject.archiveBytes,
    mainVersionLookup: "UNAVAILABLE",
    mainVulnerabilityCoverage: "UNAVAILABLE_NO_VERSION",
    sourceAdvisoryCoverage: "NOT_ESTABLISHED",
    supportCoverage: "NOT_ESTABLISHED",
    admission: "NOT_AUTHORIZED",
  });
}

export function bindManagedSeaweedSourceEvidence(subject, proof = {}) {
  requireValue(validSubject(subject) && object(proof) && Object.keys(proof).length === 4 &&
    Object.hasOwn(proof, "view") && Object.hasOwn(proof, "baseInspection") && Object.hasOwn(proof, "finalInspection") &&
    Object.hasOwn(proof, "finalInventory"), "scanner_managed_seaweed_source_evidence_invalid");
  const { view } = proof;
  requireValue(Object.isFrozen(view) && object(view) && typeof view.read === "function" && typeof view.list === "function" &&
    typeof view.has === "function", "scanner_managed_seaweed_source_evidence_invalid");
  const supplied = [proof.baseInspection, proof.finalInspection, proof.finalInventory];
  const [baseBytes, finalBytes, finalInventory] = detachedBuffers(supplied);
  const seenBuffers = [...supplied];
  const files = new Map();
  for (const [name, maxBytes] of MATERIAL_FILES) {
    let bytes;
    try { bytes = view.read(name, maxBytes); } catch { fail("scanner_managed_seaweed_source_evidence_invalid"); }
    requireValue(Buffer.isBuffer(bytes) && !seenBuffers.some((value) => overlaps(value, bytes)),
      "scanner_managed_seaweed_source_evidence_invalid");
    seenBuffers.push(bytes);
    files.set(name, Buffer.from(bytes));
  }
  validateMaterials(files);
  requireValue(finalInventory.equals(Buffer.from(`${CANDIDATE_SHA256}  /usr/bin/weed\n`)),
    "scanner_managed_seaweed_source_evidence_invalid");
  const base = parseInspection(baseBytes), final = parseInspection(finalBytes);
  validateManagedSeaweedConfig(base, final);
  const baseImage = base[0], finalImage = final[0];
  const baseLayers = baseImage.RootFS?.Layers, finalLayers = finalImage.RootFS?.Layers;
  requireValue(baseImage.Id === BASE_IMAGE_ID && baseImage.RootFS?.Type === "layers" && isDeepStrictEqual(baseLayers, BASE_LAYERS) &&
    finalImage.Id === subject.imageId && finalImage.RootFS?.Type === "layers" && Array.isArray(finalLayers) &&
    finalLayers.length === 14 && finalLayers.every((entry) => DIGEST.test(entry)) && isDeepStrictEqual(finalLayers.slice(0, 10), BASE_LAYERS),
  "scanner_managed_seaweed_source_evidence_invalid");
  const overlayDiffID = finalLayers[10];
  requireValue(DIGEST.test(overlayDiffID ?? "") && !BASE_LAYERS.includes(overlayDiffID) &&
    finalLayers.filter((entry) => entry === overlayDiffID).length === 1, "scanner_managed_seaweed_source_evidence_invalid");
  const evidence = deepFreeze({
    kind: PROFILE,
    subject: {
      imageId: subject.imageId, archiveSha256: subject.archiveSha256, archiveBytes: subject.archiveBytes,
      artifactName: subject.artifactName, os: subject.os, architecture: subject.architecture,
    },
    source: { commit: MANAGED_SEAWEED_MATERIAL.sourceCommit, archiveBytes: MANAGED_SEAWEED_MATERIAL.archiveBytes,
      archiveSha256: MANAGED_SEAWEED_MATERIAL.archiveSha256 },
    builder: { platformDigest: "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747",
      compiler: "go1.27.3", os: "linux", architecture: "amd64" },
    materials: { goModSha256: MANAGED_SEAWEED_MATERIAL.goModSha256, goSumSha256: MANAGED_SEAWEED_MATERIAL.goSumSha256,
      moduleInventorySha256: FIXED_FILES["module-inventory.json"][1], buildInfoSha256: FIXED_FILES["build-info.txt"][1] },
    candidateSha256: CANDIDATE_SHA256,
    finalSha256: CANDIDATE_SHA256,
    inspections: { base: { bytes: baseBytes.length, sha256: hash(baseBytes) },
      final: { bytes: finalBytes.length, sha256: hash(finalBytes) } },
    layers: { baseImageId: BASE_IMAGE_ID, base: [...BASE_LAYERS], finalImageId: finalImage.Id, final: [...finalLayers],
      overlayIndex: 10, overlayDiffID, inheritedIndex: 1, inheritedDiffID: INHERITED_LAYER },
  });
  boundEvidence.add(evidence);
  return evidence;
}

export function evaluateManagedSeaweedArchiveReport(report, sbom, subject, evidence, now = new Date()) {
  requireValue(validSubject(subject) && boundEvidence.has(evidence) && evidence.kind === PROFILE &&
    isDeepStrictEqual(evidence.subject, { imageId: subject.imageId, archiveSha256: subject.archiveSha256,
      archiveBytes: subject.archiveBytes, artifactName: subject.artifactName, os: subject.os, architecture: subject.architecture }));
  requireValue(Array.isArray(report?.Results) && report.Results.length === 2 && Array.isArray(sbom?.components) &&
    isDeepStrictEqual(report.Metadata?.DiffIDs, evidence.layers.final) && report.Metadata?.ImageConfig?.rootfs?.type === "layers" &&
    isDeepStrictEqual(report.Metadata.ImageConfig.rootfs.diff_ids, evidence.layers.final));
  const goResults = report.Results.filter((entry) => entry?.Target === "usr/bin/weed" && entry.Class === "lang-pkgs" && entry.Type === "gobinary");
  const osResults = report.Results.filter((entry) => entry?.Class === "os-pkgs" && entry.Type === "alpine");
  requireValue(goResults.length === 1 && osResults.length === 1 && osResults[0].Packages?.length === 29 &&
    osResults[0].Packages.every((entry) => typeof entry?.Version === "string" && entry.Version.length > 0));
  const normalizedPackages = normalizeReportPackages(goResults[0].Packages, evidence.layers.overlayDiffID);
  requireValue(isDeepStrictEqual(normalizedPackages, PACKAGE_DATA));
  const goComponents = sbom.components.filter((entry) => typeof entry?.purl === "string" && entry.purl.startsWith("pkg:golang/"));
  requireValue(isDeepStrictEqual(normalizeSbomComponents(goComponents, evidence.layers.overlayDiffID), SBOM_DATA));
  validateFindings(goResults[0], osResults[0]);
  const projected = { ...report, Results: report.Results.map((result) => result === goResults[0]
    ? { ...result, Packages: result.Packages.filter((entry) => entry.ID !== MAIN_PACKAGE.ID) }
    : { ...result }) };
  requireValue(projected.Results.find((entry) => entry.Type === "gobinary").Packages.length === 244);
  const evaluated = evaluateArchiveImageReport(projected, subject, now);
  return { ...evaluated, sourceComponents: [sourceComponent(subject, evidence)], rawPackageCount: 274,
    versionedPackageCount: 273, sourceBoundPackageCount: 1 };
}

export function managedSeaweedHashArguments(subject) {
  requireValue(validSubject(subject), "scanner_managed_seaweed_source_evidence_invalid");
  return ["run", "--rm", "--pull=never", "--platform", "linux/amd64", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", "--user", "1000:1000", "--pids-limit", "16", "--memory", "64m", "--memory-swap", "64m",
    "--cpus", "1", "--entrypoint", "sha256sum", subject.imageId, "/usr/bin/weed"];
}
