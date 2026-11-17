import assert from "node:assert/strict";
import test from "node:test";
import {
  SCANNER_RETENTION as P, canonicalJsonBytes, createScannerRetentionPublicationBinding,
  createScannerRetentionQualificationBinding, createScannerRetentionRestoreManifest,
  createScannerRetentionSidecar, validateScannerRetentionSidecarBytes,
  scannerRetentionPublisherPhases, validateScannerRetentionPublisherBinding,
  validateScannerRetentionPublisherReceiptBytes, validateScannerRetentionRestoreManifestBytes,
} from "../scripts/scanner/retention-policy.mjs";

const identity = { headSha: "1".repeat(40), headTree: "2".repeat(40), runId: "123456" };
const publication = createScannerRetentionPublicationBinding(identity);
const files = () => P.closure.members.filter((entry) => entry.path !== "scanner-closure/restore-manifest.json")
  .map((entry) => ({ path: entry.path, class: entry.origin, bytes: entry.bytes ?? 1, sha256: entry.sha256 ?? "3".repeat(64) }));
const manifest = () => createScannerRetentionRestoreManifest({ publication, files: files() });
const clone = (value) => JSON.parse(JSON.stringify(value));
const bytes = (value) => canonicalJsonBytes(value, 2 * 1024 ** 2);

function receipt() {
  const q = P.qualification.artifact;
  const digest = (character) => `sha256:${character.repeat(64)}`;
  return {
    schemaVersion: 1, state: "PUBLISHED_UNADMITTED", result: "PASSED", repository: P.repository,
    workflow: P.publisher.workflow, runId: identity.runId, runAttempt: 1, headSha: identity.headSha, headTree: identity.headTree,
    qualificationArtifact: { id: q.id, name: q.name, digest: q.digest, bytes: q.sizeInBytes, expiresAt: q.expiresAt },
    package: P.package, tag: `${P.package}:${P.publisher.tagPrefix}${"3".repeat(64)}`, ghcrManifestDigest: digest("4"),
    innerTar: { bytes: 51200, sha256: "3".repeat(64) }, restoreManifest: { bytes: 1234, sha256: "5".repeat(64) },
    oci: {
      manifest: { mediaType: "application/vnd.oci.image.manifest.v1+json", bytes: 500, sha256: "4".repeat(64) },
      config: { digest: digest("6"), mediaType: "application/vnd.oci.image.config.v1+json", bytes: 800, sha256: "6".repeat(64) },
      layer: { digest: digest("7"), mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", bytes: 4000, sha256: "7".repeat(64) },
      readback: { imageId: digest("6"), containerId: "8".repeat(64), innerTarBytes: 51200,
        innerTarSha256: "3".repeat(64), stoppedNeverStarted: true },
    },
    phases: scannerRetentionPublisherPhases.map((name) => ({ name, result: "PASSED", durationMs: 1 })),
    cleanup: { state: "PASSED", image: "REMOVED", container: "REMOVED", buildCache: "REMOVED",
      authenticatedDockerConfig: "REMOVED", ownedPathRemoved: true },
    claims: { forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED", scannerExecuted: false,
      retained: false, restored: false, admitted: false, supportStart: null, supportEnd: null },
  };
}

test("C sidecar is an authenticated publisher binding, never a self-declared restore authority", () => {
  const receiptBytes = bytes(receipt());
  const options = { identity, artifact: { id: 123, name: `${P.publisher.artifactNamePrefix}${identity.runId}-1`,
    digest: `sha256:${"a".repeat(64)}` }, createdAt: "2026-11-10T00:00:00.000Z" };
  const sidecar = createScannerRetentionSidecar(receiptBytes, options);
  assert.equal(sidecar.state, "COPY_IDENTITY_ONLY_NOT_ADMITTED");
  assert.equal(sidecar.copy.relativePath, `scanner-closure-v0.76.2-sha256-${"3".repeat(64)}.tar`);
  assert.equal(sidecar.publisher.artifactId, 123);
  assert.equal(sidecar.claims.restored, false);
  assert.deepEqual(validateScannerRetentionSidecarBytes(bytes(sidecar), receiptBytes, options), sidecar);
  for (const mutate of [
    (value) => { value.identity.runId = "999"; },
    (value) => { value.artifact.name += "-extra"; },
    (value) => { value.artifact.id = 0; },
    (value) => { value.artifact.digest = "bad"; },
    (value) => { value.createdAt = "2026-02-30T00:00:00.000Z"; },
    (value) => { value.extra = true; },
  ]) {
    const changed = clone(options); mutate(changed);
    assert.throws(() => createScannerRetentionSidecar(receiptBytes, changed), /scanner_retention_/u);
  }
  const changed = clone(sidecar); changed.innerTar.sha256 = "9".repeat(64);
  assert.throws(() => validateScannerRetentionSidecarBytes(bytes(changed), receiptBytes, options), /sidecar_binding_invalid/u);
  let called = 0;
  assert.throws(() => createScannerRetentionSidecar(receiptBytes, { ...options,
    get artifact() { called += 1; return options.artifact; } }), /json_invalid/u);
  assert.equal(called, 0);
});

test("publisher authority stays unchanged by separate historical local byte observations", () => {
  const value = validateScannerRetentionPublisherBinding();
  assert.equal(value.readProofAccepted.runId, "42732415577");
  assert.equal(value.readProofAccepted.artifactId, 13725082501);
  assert.equal(value.readProofAccepted.receiptSha256, "40895136ff72d9d0fb39c3192bd137372780f557e5a89d1be55573a950b18c60");
  assert.equal(value.readProofAccepted.anonymousRead, "AUTHORIZATION_DENIED");
  assert.equal(P.observations.publisher.runId, "44009258503");
  assert.equal(P.observations.localCopy.sidecarSha256, "8bf31e82ef189cb2c8d4738993f14819409f99f4cdd59cd15a3c72eee6d635b7");
  assert.equal(P.observations.localRestore.receiptSha256, "22b9729a9b98c344ceb8a77a1470a677c823a832a5c02450d822857a776d239e");
  assert.equal(P.claims.retained, false);
  assert.equal(P.claims.restored, false);
  const changed = clone(value); changed.readProofAccepted.authorizedRead = "FAILED";
  assert.throws(() => validateScannerRetentionPublisherBinding(changed), /publisher_binding_invalid/u);
  assert.throws(() => { value.readProofAccepted.runId = "1"; }, TypeError);
});

test("generated qualification and publication bindings preserve fixed authority and avoid circular archive identities", () => {
  const qualification = createScannerRetentionQualificationBinding();
  assert.deepEqual(Object.keys(qualification), ["schemaVersion", "state", "repository", "workflow", "runId", "runAttempt",
    "jobId", "headSha", "headTree", "event", "ref", "artifact", "review", "sourceMappings"]);
  assert.equal(qualification.runId, 42684309304);
  assert.equal(qualification.artifact.id, 13706967607);
  assert.equal(qualification.sourceMappings.length, 11);
  assert.equal(qualification.artifact.updatedAt, undefined);
  assert.equal(publication.publisherExecutedScanner, false);
  assert.equal(publication.admission, false);
  assert.equal(publication.innerTar, undefined);
  assert.equal(publication.ghcrManifestDigest, undefined);
  for (const invalid of [{ ...identity, runId: 123 }, { ...identity, runId: "001" },
    { ...identity, runId: "9007199254740992" }, { ...identity, headSha: [identity.headSha] },
    { ...identity, headTree: "X".repeat(40) }, { ...identity, supportStart: "now" }]) {
    assert.throws(() => createScannerRetentionPublicationBinding(invalid), /publication_identity_invalid/u);
  }
});

test("the consumed failed publisher cannot become a publication or successful receipt identity", () => {
  const failedIdentity = { ...identity, runId: P.publisher.recovery.predecessor.runId };
  assert.throws(() => createScannerRetentionPublicationBinding(failedIdentity), /publication_identity_invalid/u);
  const fabricatedSuccess = { ...receipt(), runId: failedIdentity.runId };
  assert.throws(() => validateScannerRetentionPublisherReceiptBytes(bytes(fabricatedSuccess), failedIdentity),
    /publication_identity_invalid/u);
});

test("manifest binds all49 fixed classified members and keeps qualification distinct from publication", () => {
  const result = manifest();
  assert.equal(result.files.length, 49);
  assert.equal(result.qualification.artifactId, 13706967607);
  assert.equal(result.publication.sourceSha, identity.headSha);
  assert.equal(result.claims.qualificationExecutedScanner, true);
  assert.equal(result.claims.publisherExecutedScanner, false);
  assert.equal(result.claims.qualificationExecutionScope, "DIAGNOSTIC_ONLY");
  assert.deepEqual(validateScannerRetentionRestoreManifestBytes(bytes(result), publication), result);
  const targets = [
    (list) => list.reverse(),
    (list) => list.pop(),
    (list) => { list[0].class = "GENERATED_POSTCONDITION"; },
    (list) => { list[0].path = "../outside"; },
    (list) => { list[0].bytes += 1; },
    (list) => { list[0].sha256 = "0".repeat(64); },
    (list) => { list.find((file) => P.closure.members.find((member) => member.path === file.path).bytes === null).bytes = 2 ** 30; },
    (list) => { list[0].extra = true; },
  ];
  for (const mutate of targets) {
    const list = files(); mutate(list);
    assert.throws(() => createScannerRetentionRestoreManifest({ publication, files: list }), /manifest_inventory_invalid/u);
  }
});

test("manifest parsing refuses duplicate keys, noncanonical bytes, self-issued authority and altered claims", () => {
  const raw = bytes(manifest());
  for (const changed of [Buffer.concat([raw, Buffer.from("\n")]),
    Buffer.from(raw.toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')),
    Buffer.from(raw.toString().replace('"admitted":false', '"admitted":true'))]) {
    assert.throws(() => validateScannerRetentionRestoreManifestBytes(changed, publication), /scanner_retention_/u);
  }
  assert.throws(() => validateScannerRetentionRestoreManifestBytes(raw,
    createScannerRetentionPublicationBinding({ ...identity, runId: "999" })), /manifest_binding_invalid/u);
});

test("manifest inputs reject proxies and accessors without executing caller code", () => {
  let calls = 0;
  const input = Object.defineProperty({ files: files() }, "publication", {
    enumerable: true, get() { calls++; return publication; },
  });
  const proxy = new Proxy({ publication, files: files() }, { ownKeys() { calls++; return []; } });
  assert.throws(() => createScannerRetentionRestoreManifest(input), /json_invalid/u);
  assert.throws(() => createScannerRetentionRestoreManifest(proxy), /json_invalid/u);
  assert.equal(calls, 0);
});

test("successful publisher receipt requires actual source, qualification, readback, phases and cleanup", () => {
  assert.deepEqual(validateScannerRetentionPublisherReceiptBytes(bytes(receipt()), identity), receipt());
  const mutations = [
    (value) => { value.runId = "999"; }, (value) => { value.runAttempt = 2; },
    (value) => { value.headTree = "0".repeat(40); }, (value) => { value.qualificationArtifact.id++; },
    (value) => { value.innerTar.bytes++; }, (value) => { value.tag += "-other"; },
    (value) => { value.oci.layer.bytes = P.closure.tarCapBytes + 1024 ** 2 + 1; },
    (value) => { value.oci.config.digest = `sha256:${"0".repeat(64)}`; },
    (value) => { value.oci.manifest.mediaType = "application/vnd.oci.image.index.v1+json"; },
    (value) => { value.oci.readback.innerTarSha256 = "0".repeat(64); },
    (value) => { value.oci.readback.stoppedNeverStarted = false; },
    (value) => value.phases.reverse(), (value) => value.phases.pop(),
    (value) => { value.phases[0].result = "FAILED"; }, (value) => { value.cleanup.buildCache = "UNCERTAIN"; },
    (value) => { value.cleanup.ownedPathRemoved = false; }, (value) => { value.claims.scannerExecuted = true; },
    (value) => { value.claims.retained = true; }, (value) => { value.claims.supportStart = "2026-11-10"; },
  ];
  for (const mutate of mutations) {
    const changed = receipt(); mutate(changed);
    assert.throws(() => validateScannerRetentionPublisherReceiptBytes(bytes(changed), identity), /publisher_receipt_invalid/u);
  }
});
