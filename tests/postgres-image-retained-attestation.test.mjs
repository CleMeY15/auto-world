import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ATTESTATION, validateCandidateAttestationPredicate }
  from "../scripts/postgres-image/candidate-attestation.mjs";
import { validatePostgresAttestationAccessReceipt }
  from "../scripts/postgres-image/candidate-attestation-access.mjs";
import { GH_BINARY, MAIN_REF, negativeProved, validatePreSignReceipt }
  from "../scripts/postgres-image/verify-candidate-attestation.mjs";

const evidenceDirectory = path.resolve("infra/postgres-image/attestation");
const signingRevision = "64778982b86faf17cb4ede9fd8027869049f6602";
const evidenceRevision = "4a28d5e3cef525a8cf54ba5a1336d7af8573df1d";
const buildRevision = "b93b0c76ec76abe283d66a17fa62eab7e580e679";
const runId = "36858133579";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const acceptancePin = Object.freeze({ bytes: 4744,
  sha256: "d110b09c23fd70e95e6514a02b1124805265ae37a9a3363a12ec7418c40a114b" });

const expectedFiles = Object.freeze({
  "access-receipt.json": { bytes: 5457, sha256: "84f81230c30b9cbca1a4a42ef27e91c3d77610318987b3f499affda43f0d1772" },
  "bundle.json": { bytes: 23607, sha256: "a09432b7020435699d911da1082537290880eec2db865b4d21cdf09dc0b969d1" },
  "pre-sign-receipt.json": { bytes: 837, sha256: "983ebb489bdae61bef59ac3f389084c528fb20beecf5edd8ce4ecb46b078fe3e" },
  "predicate.json": { bytes: 9949, sha256: "d724d03784b62b5fface2f0241e18b203fbbc5702f23bc7de8296f5ffa0d301c" },
  "verification-receipt.json": { bytes: 37813, sha256: "a647d3ddeeb77292db9e3a35efe7a6073306d41f686bedcb1c6a68c8285ec7ce" },
});

function retained(name) {
  const bytes = readFileSync(path.join(evidenceDirectory, name));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

test("retained PostgreSQL attestation files preserve the exact successful-run bytes", () => {
  for (const [name, expected] of Object.entries(expectedFiles)) {
    const bytes = readFileSync(path.join(evidenceDirectory, name));
    assert.equal(bytes.length, expected.bytes, `${name} byte length`);
    assert.equal(sha256(bytes), expected.sha256, `${name} SHA-256`);
  }
});

test("accepted projection is path-free and binds the actual run without granting runtime or P5", () => {
  const bytes = readFileSync("infra/postgres-image/candidate-attestation-acceptance.json");
  const acceptance = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual({ bytes: bytes.length, sha256: sha256(bytes) }, acceptancePin);
  assert.doesNotMatch(bytes.toString("utf8"), /(?:[A-Za-z]:\\|\/home\/|\/opt\/|\.omx\/private)/u);
  assert.equal(acceptance.kind, "POSTGRES_CANDIDATE_ATTESTATION_ACCEPTANCE_V1");
  assert.equal(acceptance.state, "ATTESTED_UNADMITTED");
  assert.equal(acceptance.authority, "INDEPENDENTLY_ACCEPTED_REAL_MAIN_ATTESTATION");
  assert.equal(acceptance.subject, `${ATTESTATION.subjectName}@${ATTESTATION.subjectDigest}`);
  assert.deepEqual(acceptance.files, expectedFiles);
  assert.deepEqual({ runId: acceptance.execution.runId, workflowId: acceptance.execution.workflowId,
    workflowPath: acceptance.execution.workflowPath, recipeRevision: acceptance.execution.recipeRevision,
    runNumber: acceptance.execution.runNumber, runAttempt: acceptance.execution.runAttempt,
    conclusion: acceptance.execution.conclusion }, {
    runId, workflowId: 372103738, workflowPath: ATTESTATION.workflowPath,
    recipeRevision: signingRevision, runNumber: 1, runAttempt: 1, conclusion: "success",
  });
  assert.deepEqual(acceptance.source, {
    buildRecipeRevision: buildRevision, buildRunId: "36361670116",
    coreEvidenceRecipeRevision: evidenceRevision,
  });
  assert.deepEqual(acceptance.failedV1, {
    state: "FAILED", runId: "36854000922",
    recipeRevision: "362ae304204e7692e99cb5e3126ffc91b9efa896",
    projection: { bytes: 1761,
      sha256: "db57c94c1671b14b2b83a67362d716152106f234bc5c966c689bf80b52471c46" },
  });
  assert.deepEqual(acceptance.claims, {
    officialSignature: "VERIFIED", pairedPositiveControls: "VERIFIED",
    sixNegativeControls: "REJECTION_PROVED", malformedBundleInputs: "ERROR_NOT_REJECTION",
    verifierOutputControls: "NOT_ESTABLISHED",
    secondCompleteCopy: "NOT_ESTABLISHED", currentness: "VALID_AT_SIGNING_ONLY",
    legalCompliance: "NOT_EVALUATED", binaryReproduction: "NOT_ESTABLISHED",
    forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED",
    runtimePermission: "NOT_GRANTED", admission: "NOT_AUTHORIZED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
  });
});

test("retained access and DSSE evidence bind the reviewed manifest, controls and predicate", () => {
  const access = retained("access-receipt.json");
  const predicate = retained("predicate.json");
  const preSign = retained("pre-sign-receipt.json");
  const bundle = retained("bundle.json").value;
  const policy = JSON.parse(readFileSync("infra/postgres-image/candidate-remote.json", "utf8"));
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));

  validatePostgresAttestationAccessReceipt(access.value, policy, {
    runId, recipeRevision: signingRevision,
    controlsIdentity: { sha256: access.value.packageControls.sha256, bytes: access.value.packageControls.bytes },
  });
  assert.deepEqual(access.value.access, {
    authorizedBefore: "VERIFIED", anonymous: "AUTHORIZATION_DENIED", authorizedAfter: "VERIFIED",
    manifestBytesIdentical: true, packageConfigurationAuthority: "SETTINGS_UI_OBSERVATION_ONLY",
    forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED",
  });
  assert.equal(access.value.operations.imagePull, "NOT_ATTEMPTED");
  assert.equal(access.value.operations.imageExecution, "NOT_ATTEMPTED");
  assert.deepEqual(access.value.support, { supportStartedAt: null, supportEndsAt: null, archiveUntil: null });

  assert.deepEqual(Object.keys(statement), ["_type", "subject", "predicateType", "predicate"]);
  assert.equal(statement._type, "https://in-toto.io/Statement/v1");
  assert.deepEqual(statement.subject, [{ name: ATTESTATION.subjectName,
    digest: { sha256: ATTESTATION.subjectDigest.slice("sha256:".length) } }]);
  assert.equal(statement.predicateType, ATTESTATION.predicateType);
  assert.deepEqual(statement.predicate, predicate.value);
  assert.deepEqual(validateCandidateAttestationPredicate(predicate.value, predicate.value), predicate.value);
  validatePreSignReceipt(preSign.value, predicate.bytes, { runId, recipeRevision: signingRevision });

  assert.equal(predicate.value.source.buildRecipeRevision, buildRevision);
  assert.equal(predicate.value.source.evidenceRecipeRevision, evidenceRevision);
  assert.equal(predicate.value.signer.recipeRevision, signingRevision);
  assert.equal(new Set([buildRevision, evidenceRevision, signingRevision]).size, 3);
  assert.equal(predicate.value.admission, "NOT_AUTHORIZED");
  assert.deepEqual(predicate.value.support, {
    durationFromActivation: "P1Y", archiveRetentionAfterSupport: "P365D",
    supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null,
    continuousSecurityControls: "REQUIRED_DURING_SUPPORT", automaticDeletion: false,
  });
  assert.equal(predicate.value.settingsObservation.forkAccessTest, "SKIPPED_BY_USER");
  assert.equal(predicate.value.settingsObservation.forkIsolation, "NOT_VERIFIED");
});

test("retained official controls prove both policies, genuine rejection and input errors", () => {
  const receipt = retained("verification-receipt.json").value;
  const before = receipt.positiveControls.before;
  const after = receipt.positiveControls.after;
  const commonHashes = {
    bundleSha256: expectedFiles["bundle.json"].sha256,
    predicateSha256: expectedFiles["predicate.json"].sha256,
    preSignReceiptSha256: expectedFiles["pre-sign-receipt.json"].sha256,
  };

  assert.equal(receipt.state, "VERIFIED");
  assert.equal(receipt.verdict, "ATTESTED_UNADMITTED");
  assert.equal(receipt.candidateAuthorization, "NOT_AUTHORIZED");
  assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.deepEqual(receipt.tool, { version: GH_BINARY.version, binarySha256: GH_BINARY.sha256,
    binaryBytes: GH_BINARY.bytes, helpSha256: "65e2bfd5da639a9e7a3bacc03266efe284c245005ea288041f9c305bbb6ddd51" });
  assert.deepEqual(receipt.registryAccess,
    { method: "ISOLATED_DOCKER_CONFIG_DEFAULT_KEYCHAIN", scope: "READ_ONLY" });
  assert.deepEqual(receipt.predicate, { type: ATTESTATION.predicateType,
    sha256: commonHashes.predicateSha256, bytes: expectedFiles["predicate.json"].bytes });
  assert.deepEqual(receipt.preSignReceipt, { sha256: commonHashes.preSignReceiptSha256,
    bytes: expectedFiles["pre-sign-receipt.json"].bytes, runId });

  for (const positive of [before, after]) {
    assert.equal(positive.state, "VERIFIED");
    assert.deepEqual({ bundleSha256: positive.bundleSha256,
      predicateSha256: positive.predicateSha256,
      preSignReceiptSha256: positive.preSignReceiptSha256 }, commonHashes);
    assert.deepEqual(positive.policy, { sourceSha: signingRevision, signerSha: signingRevision,
      subjectName: ATTESTATION.subjectName, subjectDigest: ATTESTATION.subjectDigest,
      workflowPath: ATTESTATION.workflowPath, ref: MAIN_REF });
    assert.deepEqual(positive.invocations.map(({ mode, status }) => ({ mode, status })), [
      { mode: "identity", status: "VERIFIED" }, { mode: "workflow", status: "VERIFIED" },
    ]);
  }

  for (const kind of ["wrong-subject", "wrong-workflow", "wrong-ref", "wrong-source", "wrong-signer"]) {
    const control = receipt.negativeControls[kind];
    assert.equal(control.proof, "REJECTION_PROVED");
    assert.equal(control.result.state, "REJECTED");
    assert.equal(negativeProved(kind, before, control.result, before), true, kind);
  }
  const tampered = receipt.negativeControls["tampered-payload"];
  assert.equal(tampered.proof, "SIGNATURE_REJECTION_PROVED");
  assert.equal(tampered.originalBundleSha256, commonHashes.bundleSha256);
  assert.notEqual(tampered.tamperedBundleSha256, commonHashes.bundleSha256);
  assert.notEqual(tampered.tamperedPayloadSha256, tampered.originalPayloadSha256);
  assert.equal(tampered.result.state, "REJECTED");
  assert.equal(negativeProved("tampered-payload", before, tampered.result, before), true);

  assert.deepEqual(Object.values(receipt.malformedInputControls)
    .map(({ proof, result }) => [proof, result.state]), [
      ["ERROR_NOT_REJECTION", "ERROR"], ["ERROR_NOT_REJECTION", "ERROR"],
      ["ERROR_NOT_REJECTION", "ERROR"],
    ]);
});

// These offline tests cross-bind retained bytes and recorded controls. The cryptographic
// verification claim remains the official verifier result captured in the receipt.
