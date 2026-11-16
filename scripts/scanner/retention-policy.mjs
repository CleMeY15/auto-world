import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { types } from "node:util";

const POLICY_BYTES = 29722;
const POLICY_SHA256 = "998d3c729c6f12746ec310e847e52645993a7443e452cf73794e148f4037867b";
const fail = (code) => { throw new Error(`scanner_retention_${code}`); };

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Receipts use ordered plain data, never getters, toJSON hooks or lossy numbers.
function assertJsonData(value, ancestors = new Set(), depth = 0) {
  if (depth > 32 || types.isProxy(value)) fail("json_invalid");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("json_invalid");
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) fail("json_invalid");
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail("json_invalid");
  const properties = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(properties);
  if (keys.some((key) => typeof key !== "string" || !("value" in properties[key])
    || ((!array || key !== "length") && !properties[key].enumerable))) fail("json_invalid");
  if (array && (keys.length !== value.length + 1 || keys.some((key, index) => key !== (index === value.length ? "length" : String(index))))) {
    fail("json_invalid");
  }
  ancestors.add(value);
  for (const key of keys) if (!array || key !== "length") assertJsonData(properties[key].value, ancestors, depth + 1);
  ancestors.delete(value);
}

export function canonicalJsonBytes(value, cap) {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 2 * 1024 ** 2) fail("json_cap_invalid");
  assertJsonData(value);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length > cap) fail("json_cap_exceeded");
  return bytes;
}

function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// The reviewed repository fixes the policy, not a command-line file or claim.
export function validateRetentionPolicyBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== POLICY_BYTES || sha256(bytes) !== POLICY_SHA256) {
    fail("policy_identity_invalid");
  }
  const policy = JSON.parse(bytes.toString("utf8"));
  if (!canonicalJsonBytes(policy, POLICY_BYTES).equals(bytes)) fail("policy_encoding_invalid");
  return freeze(policy);
}

export const SCANNER_RETENTION = validateRetentionPolicyBytes(
  readFileSync(new URL("../../infra/scanner/retention.json", import.meta.url)),
);

const profileBytes = readFileSync(new URL(
  `../../infra/scanner/${SCANNER_RETENTION.qualification.zipProfile.file}`, import.meta.url,
));
if (profileBytes.length !== SCANNER_RETENTION.qualification.zipProfile.bytes
  || sha256(profileBytes) !== SCANNER_RETENTION.qualification.zipProfile.sha256) {
  fail("qualification_profile_identity_invalid");
}

const HEX = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,15}$/u;
const MANIFEST_PATH = "scanner-closure/restore-manifest.json";
const MANIFEST_CAP = 2 * 1024 ** 2;

function exactRecord(value, keys, code) {
  assertJsonData(value);
  if (value === null || Array.isArray(value) || typeof value !== "object"
    || Object.keys(value).join("\0") !== keys.join("\0")) fail(code);
}

function sameData(actual, expected, cap, code) {
  if (!canonicalJsonBytes(actual, cap).equals(canonicalJsonBytes(expected, cap))) fail(code);
}

function canonicalInput(bytes, cap, code) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > cap) fail(code);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(code); }
  if (!canonicalJsonBytes(value, cap).equals(bytes)) fail(code);
  return value;
}

function publicationIdentity(value) {
  exactRecord(value, ["headSha", "headTree", "runId"], "publication_identity_invalid");
  if (typeof value.headSha !== "string" || !REVISION.test(value.headSha)
    || typeof value.headTree !== "string" || !REVISION.test(value.headTree)
    || typeof value.runId !== "string" || !RUN_ID.test(value.runId)
    || !Number.isSafeInteger(Number(value.runId))) fail("publication_identity_invalid");
  return value;
}

export function validateScannerRetentionPublisherBinding(binding = SCANNER_RETENTION.publisher) {
  sameData(binding, SCANNER_RETENTION.publisher, 16 * 1024, "publisher_binding_invalid");
  const proof = binding.readProofAccepted;
  if (proof.authorizedRead !== "PASSED" || proof.anonymousRead !== "AUTHORIZATION_DENIED"
    || proof.cleanup !== "PASSED" || !HEX.test(proof.receiptSha256)
    || !HEX.test(proof.independentReviewSha256)
    || SCANNER_RETENTION.observations.authorizedRead !== "PASSED"
    || SCANNER_RETENTION.observations.anonymousRead !== "AUTHORIZATION_DENIED") fail("publisher_binding_invalid");
  return SCANNER_RETENTION.publisher;
}

export function createScannerRetentionQualificationBinding() {
  const q = SCANNER_RETENTION.qualification;
  const a = q.artifact;
  return freeze({
    schemaVersion: 1, state: "QUALIFICATION_DIAGNOSTIC_ONLY", repository: q.repository,
    workflow: q.workflow, runId: q.runId, runAttempt: q.runAttempt, jobId: q.jobId,
    headSha: q.headSha, headTree: q.headTree, event: q.event, ref: q.ref,
    artifact: { id: a.id, name: a.name, url: a.url, archiveDownloadUrl: a.archiveDownloadUrl,
      workflowRun: a.workflowRun, sizeInBytes: a.sizeInBytes, digest: a.digest,
      createdAt: a.createdAt, expiresAt: a.expiresAt, expired: a.expired },
    review: q.review, sourceMappings: q.sourceMappings,
  });
}

export function createScannerRetentionPublicationBinding(identity) {
  const { headSha, headTree, runId } = publicationIdentity(identity);
  const publisher = validateScannerRetentionPublisherBinding();
  return freeze({
    schemaVersion: 1, state: "PUBLICATION_IDENTITY_ONLY", repository: SCANNER_RETENTION.repository,
    workflow: publisher.workflow, sourceSha: headSha, sourceTree: headTree, runId, runAttempt: 1,
    event: "workflow_dispatch", ref: "refs/heads/main", package: SCANNER_RETENTION.package,
    bootstrap: SCANNER_RETENTION.readProof.bootstrap,
    publisherExecutedScanner: false, admission: false, supportStart: null, supportEnd: null,
  });
}

function validatePublication(publication) {
  assertJsonData(publication);
  if (publication === null || typeof publication !== "object") fail("publication_identity_invalid");
  const expected = createScannerRetentionPublicationBinding({
    headSha: publication.sourceSha, headTree: publication.sourceTree, runId: publication.runId,
  });
  sameData(publication, expected, 1024 ** 2, "publication_identity_invalid");
  return expected;
}

export function createScannerRetentionRestoreManifest(options) {
  exactRecord(options, ["publication", "files"], "manifest_inventory_invalid");
  const { publication, files } = options;
  const checkedPublication = validatePublication(publication);
  assertJsonData(files);
  const members = SCANNER_RETENTION.closure.members.filter((member) => member.path !== MANIFEST_PATH);
  if (!Array.isArray(files) || files.length !== members.length || files.length !== 49) fail("manifest_inventory_invalid");
  const checkedFiles = files.map((file, index) => {
    exactRecord(file, ["path", "class", "bytes", "sha256"], "manifest_inventory_invalid");
    const member = members[index];
    if (file.path !== member.path || file.class !== member.origin
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > member.capBytes
      || typeof file.sha256 !== "string" || !HEX.test(file.sha256)
      || (member.bytes !== null && file.bytes !== member.bytes)
      || (member.sha256 !== null && file.sha256 !== member.sha256)) fail("manifest_inventory_invalid");
    return { path: file.path, class: file.class, bytes: file.bytes, sha256: file.sha256 };
  });
  const q = SCANNER_RETENTION.qualification;
  return freeze({
    schemaVersion: 1, state: "SCANNER_BYTES_ONLY_NOT_ADMITTED", scanner: SCANNER_RETENTION.scanner,
    qualification: { runId: q.runId, runAttempt: q.runAttempt, jobId: q.jobId, headSha: q.headSha,
      headTree: q.headTree, artifactId: q.artifact.id, artifactDigest: q.artifact.digest },
    publication: checkedPublication,
    archive: { format: "ustar", blockingFactor: 1, regularMembers: 50,
      expandedCapBytes: SCANNER_RETENTION.closure.expandedCapBytes, tarCapBytes: SCANNER_RETENTION.closure.tarCapBytes },
    files: checkedFiles,
    exclusions: ["SERVICE_IMAGES", "VULNERABILITY_AND_JAVA_DATABASE_PAYLOADS", "BASELINE_CARRIERS",
      "COMPLETE_SERVICE_SOURCE_BUILD_CLOSURES", "ADMISSION_ATTESTATIONS", "APPLICATION_DATA", "OFFLINE_SCANNER_EXECUTION"],
    claims: { qualificationExecutedScanner: true, qualificationExecutionScope: "DIAGNOSTIC_ONLY",
      publisherExecutedScanner: false, admitted: false, supportStart: null, supportEnd: null },
  });
}

export function validateScannerRetentionRestoreManifestBytes(bytes, expectedPublication) {
  const value = canonicalInput(bytes, MANIFEST_CAP, "manifest_encoding_invalid");
  const expected = createScannerRetentionRestoreManifest({ publication: expectedPublication, files: value.files });
  sameData(value, expected, MANIFEST_CAP, "manifest_binding_invalid");
  return expected;
}

export const scannerRetentionPublisherPhases = Object.freeze([
  "context_and_capacity", "protected_main", "package_controls", "qualification_api", "qualification_zip",
  "official_provenance", "qualified_source_blobs", "canonical_manifests", "deterministic_ustar",
  "oci_candidate_push", "owned_local_state_removed", "authenticated_digest_readback",
  "owned_docker_cleanup", "owned_path_cleanup",
]);

function byteIdentity(value, cap, code) {
  exactRecord(value, ["bytes", "sha256"], code);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > cap
    || typeof value.sha256 !== "string" || !HEX.test(value.sha256)) fail(code);
}

export function validateScannerRetentionPublisherReceiptBytes(bytes, identity) {
  publicationIdentity(identity);
  const p = validateScannerRetentionPublisherBinding();
  const value = canonicalInput(bytes, p.receiptCapBytes, "publisher_receipt_invalid");
  exactRecord(value, ["schemaVersion", "state", "result", "repository", "workflow", "runId", "runAttempt",
    "headSha", "headTree", "qualificationArtifact", "package", "tag", "ghcrManifestDigest", "innerTar",
    "restoreManifest", "oci", "phases", "cleanup", "claims"], "publisher_receipt_invalid");
  if (value.schemaVersion !== 1 || value.state !== "PUBLISHED_UNADMITTED" || value.result !== "PASSED"
    || value.repository !== SCANNER_RETENTION.repository || value.workflow !== p.workflow
    || value.runId !== identity.runId || value.runAttempt !== 1 || value.headSha !== identity.headSha
    || value.headTree !== identity.headTree || value.package !== SCANNER_RETENTION.package) fail("publisher_receipt_invalid");
  const artifact = SCANNER_RETENTION.qualification.artifact;
  sameData(value.qualificationArtifact, { id: artifact.id, name: artifact.name, digest: artifact.digest,
    bytes: artifact.sizeInBytes, expiresAt: artifact.expiresAt }, 4096, "publisher_receipt_invalid");
  byteIdentity(value.innerTar, SCANNER_RETENTION.closure.tarCapBytes, "publisher_receipt_invalid");
  byteIdentity(value.restoreManifest, MANIFEST_CAP, "publisher_receipt_invalid");
  if (value.innerTar.bytes % 512 !== 0
    || value.tag !== `${SCANNER_RETENTION.package}:${p.tagPrefix}${value.innerTar.sha256}`) fail("publisher_receipt_invalid");
  exactRecord(value.oci, ["manifest", "config", "layer", "readback"], "publisher_receipt_invalid");
  for (const role of ["manifest", "config", "layer"]) {
    const descriptor = value.oci[role];
    exactRecord(descriptor, role === "manifest" ? ["mediaType", "bytes", "sha256"]
      : ["digest", "mediaType", "bytes", "sha256"], "publisher_receipt_invalid");
    byteIdentity({ bytes: descriptor.bytes, sha256: descriptor.sha256 },
      role === "layer" ? SCANNER_RETENTION.closure.tarCapBytes + 1024 ** 2 : p.registryCapBytes, "publisher_receipt_invalid");
    const allowed = role === "manifest" ? ["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"]
      : role === "config" ? ["application/vnd.oci.image.config.v1+json", "application/vnd.docker.container.image.v1+json"]
        : ["application/vnd.oci.image.layer.v1.tar", "application/vnd.oci.image.layer.v1.tar+gzip", "application/vnd.docker.image.rootfs.diff.tar.gzip"];
    if (!allowed.includes(descriptor.mediaType)
      || (role !== "manifest" && descriptor.digest !== `sha256:${descriptor.sha256}`)) fail("publisher_receipt_invalid");
  }
  if (value.ghcrManifestDigest !== `sha256:${value.oci.manifest.sha256}`) fail("publisher_receipt_invalid");
  const readback = value.oci.readback;
  exactRecord(readback, ["imageId", "containerId", "innerTarBytes", "innerTarSha256", "stoppedNeverStarted"], "publisher_receipt_invalid");
  if (readback.imageId !== value.oci.config.digest || typeof readback.containerId !== "string" || !HEX.test(readback.containerId)
    || readback.innerTarBytes !== value.innerTar.bytes || readback.innerTarSha256 !== value.innerTar.sha256
    || readback.stoppedNeverStarted !== true) fail("publisher_receipt_invalid");
  if (!Array.isArray(value.phases) || value.phases.length !== scannerRetentionPublisherPhases.length) fail("publisher_receipt_invalid");
  for (const [index, phase] of value.phases.entries()) {
    exactRecord(phase, ["name", "result", "durationMs"], "publisher_receipt_invalid");
    if (phase.name !== scannerRetentionPublisherPhases[index] || phase.result !== "PASSED"
      || !Number.isSafeInteger(phase.durationMs) || phase.durationMs < 0) fail("publisher_receipt_invalid");
  }
  sameData(value.cleanup, { state: "PASSED", image: "REMOVED", container: "REMOVED", buildCache: "REMOVED",
    authenticatedDockerConfig: "REMOVED", ownedPathRemoved: true }, 4096, "publisher_receipt_invalid");
  sameData(value.claims, { forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED", scannerExecuted: false,
    retained: false, restored: false, admitted: false, supportStart: null, supportEnd: null }, 4096, "publisher_receipt_invalid");
  return freeze(value);
}

// This is a binding prepared by authenticated intake, not evidence of a completed copy.
export function createScannerRetentionSidecar(receiptBytes, options) {
  exactRecord(options, ["identity", "artifact", "createdAt"], "sidecar_input_invalid");
  const receipt = validateScannerRetentionPublisherReceiptBytes(receiptBytes, options.identity);
  const { artifact, createdAt } = options;
  exactRecord(artifact, ["id", "name", "digest"], "sidecar_artifact_invalid");
  if (!Number.isSafeInteger(artifact.id) || artifact.id < 1
    || artifact.name !== `${SCANNER_RETENTION.publisher.artifactNamePrefix}${receipt.runId}-1`
    || typeof artifact.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest)
    || typeof createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(createdAt)
    || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) fail("sidecar_input_invalid");
  return freeze({
    schemaVersion: 1, state: "COPY_IDENTITY_ONLY_NOT_ADMITTED", repository: SCANNER_RETENTION.repository,
    publisher: { workflow: receipt.workflow, runId: receipt.runId, runAttempt: receipt.runAttempt,
      headSha: receipt.headSha, headTree: receipt.headTree, artifactId: artifact.id,
      artifactName: artifact.name, artifactDigest: artifact.digest },
    package: receipt.package, ghcrManifestDigest: receipt.ghcrManifestDigest,
    innerTar: receipt.innerTar, restoreManifest: receipt.restoreManifest,
    copy: { relativePath: `scanner-closure-v0.76.2-sha256-${receipt.innerTar.sha256}.tar`, createdAt },
    claims: { scannerExecuted: false, retained: false, restored: false, admitted: false,
      supportStart: null, supportEnd: null },
  });
}

export function validateScannerRetentionSidecarBytes(bytes, receiptBytes, authenticatedOptions) {
  const value = canonicalInput(bytes, SCANNER_RETENTION.local.sidecarCapBytes, "sidecar_encoding_invalid");
  const expected = createScannerRetentionSidecar(receiptBytes, authenticatedOptions);
  sameData(value, expected, SCANNER_RETENTION.local.sidecarCapBytes, "sidecar_binding_invalid");
  return expected;
}
