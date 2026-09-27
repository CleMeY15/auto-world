import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { ATTESTATION, validateCandidateAttestationPredicate }
  from "../scripts/seaweed-image/candidate-attestation.mjs";
import { MAIN_REF, negativeProved, validatePreSignReceipt }
  from "../scripts/seaweed-image/verify-candidate-attestation.mjs";

const evidenceDirectory = path.resolve("infra/seaweed-image/attestation");
const validationDirectory = path.resolve("docs/validation/seaweed-attestation");
const recipeRevision = "83d93ca2801ab2385c680e98acd12ed21f5110b9";
const runId = "36339762446";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const expectedFiles = Object.freeze({
  "bundle.json": { bytes: 15386, sha256: "5017d2a24feb59dc714fc6652e9985098b47c3d2ba0bb779db7d2b3db9641f1b" },
  "predicate.json": { bytes: 5102, sha256: "b57a5fab7e9ad40aa3209660d6eaf0d6c0ebf5004c2d2e181e56ebb075f35c5b" },
  "pre-sign-receipt.json": { bytes: 925, sha256: "4030f476c6030f26deba15d36cdb7b159d6fccc63ba42253b1975a8a21dd59ed" },
  "verification-receipt.json": { bytes: 37515, sha256: "a2fb40814f344d920410408356b38eb44b8ba0175543c0a763f9b71bc9dfeb12" },
});

function retained(name) {
  const bytes = readFileSync(path.join(evidenceDirectory, name));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

test("retained native attestation files preserve the exact successful-run bytes", () => {
  for (const [name, expected] of Object.entries(expectedFiles)) {
    const bytes = readFileSync(path.join(evidenceDirectory, name));
    assert.equal(bytes.length, expected.bytes, `${name} byte length`);
    assert.equal(sha256(bytes), expected.sha256, `${name} SHA-256`);
  }
});

test("retained DSSE statement and receipts bind one immutable unadmitted predicate", () => {
  const bundle = retained("bundle.json").value;
  const predicate = retained("predicate.json");
  const preSign = retained("pre-sign-receipt.json");
  const verification = retained("verification-receipt.json").value;
  const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));

  assert.deepEqual(Object.keys(statement), ["_type", "subject", "predicateType", "predicate"]);
  assert.equal(statement._type, "https://in-toto.io/Statement/v1");
  assert.deepEqual(statement.subject, [{ name: ATTESTATION.subjectName,
    digest: { sha256: ATTESTATION.subjectDigest.slice("sha256:".length) } }]);
  assert.equal(statement.predicateType, ATTESTATION.predicateType);
  assert.deepEqual(statement.predicate, predicate.value);
  assert.deepEqual(validateCandidateAttestationPredicate(predicate.value, predicate.value), predicate.value);

  validatePreSignReceipt(preSign.value, predicate.bytes, { runId, recipeRevision });
  assert.deepEqual(verification.predicate, { type: ATTESTATION.predicateType,
    sha256: expectedFiles["predicate.json"].sha256, bytes: expectedFiles["predicate.json"].bytes });
  assert.deepEqual(verification.preSignReceipt, { sha256: expectedFiles["pre-sign-receipt.json"].sha256,
    bytes: expectedFiles["pre-sign-receipt.json"].bytes, runId });
  assert.equal(predicate.value.admission, "NOT_AUTHORIZED");
  assert.deepEqual(predicate.value.support, {
    durationFromActivation: "P1Y", archiveRetentionAfterSupport: "P365D",
    supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null,
    dates: "PENDING_ADMISSION_ACTIVATION", automaticDeletion: "DISABLED",
    continuousSecurityControls: "REQUIRED_DURING_SUPPORT",
  });
  assert.equal(verification.verdict, "ATTESTED_UNADMITTED");
  assert.equal(verification.admission, "NOT_AUTHORIZED");
});

test("retained official controls remain cross-bound to the original bundle", () => {
  const receipt = retained("verification-receipt.json").value;
  const original = receipt.positiveControls.before;
  const after = receipt.positiveControls.after;
  const commonHashes = {
    bundleSha256: expectedFiles["bundle.json"].sha256,
    predicateSha256: expectedFiles["predicate.json"].sha256,
    preSignReceiptSha256: expectedFiles["pre-sign-receipt.json"].sha256,
  };

  for (const positive of [original, after]) {
    assert.equal(positive.state, "VERIFIED");
    assert.deepEqual({ bundleSha256: positive.bundleSha256,
      predicateSha256: positive.predicateSha256,
      preSignReceiptSha256: positive.preSignReceiptSha256 }, commonHashes);
    assert.deepEqual(positive.policy, { sourceSha: recipeRevision, signerSha: recipeRevision,
      subjectName: ATTESTATION.subjectName, subjectDigest: ATTESTATION.subjectDigest,
      workflowPath: ATTESTATION.workflowPath, ref: MAIN_REF });
    assert.deepEqual(positive.invocations.map(({ mode, status }) => ({ mode, status })), [
      { mode: "identity", status: "VERIFIED" }, { mode: "workflow", status: "VERIFIED" },
    ]);
  }

  for (const kind of ["wrong-subject", "wrong-workflow", "wrong-ref", "wrong-source", "wrong-signer"]) {
    const control = receipt.negativeControls[kind];
    assert.equal(control.proof, "REJECTION_PROVED");
    assert.equal(negativeProved(kind, original, control.result, original), true, kind);
  }
  const tampered = receipt.negativeControls["tampered-payload"];
  assert.equal(tampered.proof, "SIGNATURE_REJECTION_PROVED");
  assert.equal(tampered.originalBundleSha256, commonHashes.bundleSha256);
  assert.notEqual(tampered.tamperedBundleSha256, commonHashes.bundleSha256);
  assert.notEqual(tampered.tamperedPayloadSha256, tampered.originalPayloadSha256);
  assert.equal(negativeProved("tampered-payload", original, tampered.result, original), true);
  assert.deepEqual(Object.values(receipt.malformedInputControls)
    .map(({ proof, result }) => [proof, result.state]), [
      ["ERROR_NOT_REJECTION", "ERROR"], ["ERROR_NOT_REJECTION", "ERROR"],
      ["ERROR_NOT_REJECTION", "ERROR"],
    ]);
});

test("retained run succeeded once on reviewed main and its producer is retired", () => {
  const run = JSON.parse(readFileSync(path.join(validationDirectory, "run.json"), "utf8"));
  const workflow = JSON.parse(readFileSync(path.join(validationDirectory, "workflow-disabled.json"), "utf8"));
  assert.deepEqual({ id: String(run.id), number: String(run.run_number), attempt: String(run.run_attempt),
    event: run.event, path: run.path, branch: run.head_branch, revision: run.head_sha,
    status: run.status, conclusion: run.conclusion }, {
    id: runId, number: "1", attempt: "1", event: "workflow_dispatch",
    path: ATTESTATION.workflowPath, branch: "main", revision: recipeRevision,
    status: "completed", conclusion: "success",
  });
  assert.deepEqual(workflow, { id: 368488673, path: ATTESTATION.workflowPath, state: "disabled_manually" });
});

// These checks preserve and cross-bind the recorded bytes. Cryptographic trust remains the result
// of the official verifier captured by the retained receipt, not a claim made by this offline test.
