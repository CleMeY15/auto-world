import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { ATTESTATION } from "../scripts/postgres-image/candidate-attestation.mjs";
import { loadPostgresCoreEvidenceAcceptance,
  CORE_EVIDENCE } from "../scripts/postgres-image/core-evidence-acceptance.mjs";
import { validatePostgresRemotePolicy,
  validatePostgresRemotePublicationReceipt } from "../scripts/postgres-image/candidate-remote.mjs";
import { BOOTSTRAP_DIGEST, MAIN_REF, classifyVerification, negativeProved,
  exerciseCandidateAttestationBundleControls, runCandidateAttestationVerification,
  validatePreSignReceipt, verificationArgs,
  verifyCandidateAttestationPair } from "../scripts/postgres-image/verify-candidate-attestation.mjs";

const sourceSha = "a".repeat(40);
const signerSha = "b".repeat(40);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function predicate() {
  const policy = JSON.parse(readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url)));
  const runtime = JSON.parse(readFileSync(new URL("../infra/postgres-image/candidate-runtime.json", import.meta.url)));
  const controlsBytes = readFileSync(new URL("../infra/postgres-image/package-controls.json", import.meta.url));
  const core = loadPostgresCoreEvidenceAcceptance();
  const retainedEvidence = ["ACCEPTED_RUNTIME_ORIGINALS", "CANDIDATE_IMAGE_RETENTION",
    "CURRENT_SOURCE_RECIPE_BUNDLE"].map((id) => core.inventory.groups.find((group) => group.id === id));
  return {
    kind: "POSTGRES_CANDIDATE_ATTESTATION_PREDICATE_V1", state: "EVIDENCE_VERIFIED",
    authority: "REVIEWED_MAIN_SIGNER", admission: "NOT_AUTHORIZED",
    subject: { name: ATTESTATION.subjectName, digest: ATTESTATION.subjectDigest,
      platform: policy.platform, imageId: policy.candidate.imageId, manifest: policy.manifest },
    source: { buildRecipeRevision: policy.publisher.recipeRevision, buildRunId: policy.publisher.runId,
      buildWorkflow: policy.publisher.workflowPath, evidenceRecipeRevision: core.acceptance.recipeRevision },
    coreEvidence: { state: core.acceptance.state, acceptance: CORE_EVIDENCE.acceptance,
      inventory: CORE_EVIDENCE.inventory, closedAcknowledgement: core.acceptance.closedAcknowledgement,
      counts: core.acceptance.inventory, policy: core.acceptance.policy, sourceBundle: core.acceptance.sourceBundle,
      legalCompliance: "NOT_EVALUATED", binaryReproduction: "NOT_ESTABLISHED" },
    audit: { state: "COMPLETE", runId: runtime.audit.runId, recipeRevision: runtime.audit.recipeRevision,
      artifact: runtime.audit.artifact, receipt: runtime.audit.receipt, scanner: runtime.audit.scanner,
      files: runtime.audit.files, findings: 0, blockers: 0 },
    retainedEvidence,
    support: { durationFromActivation: "P1Y", archiveRetentionAfterSupport: "P365D",
      supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null,
      continuousSecurityControls: "REQUIRED_DURING_SUPPORT", automaticDeletion: false },
    settingsObservation: JSON.parse(controlsBytes),
    signer: { runId: "12345", recipeRevision: sourceSha,
      workflow: ATTESTATION.workflowPath, ref: MAIN_REF },
    access: { receipt: { bytes: 200, sha256: "1".repeat(64) },
      controls: { bytes: controlsBytes.length, sha256: hash(controlsBytes) },
      artifact: { id: 123, name: "postgres-candidate-attestation-access", size: 456,
        digest: `sha256:${"3".repeat(64)}` },
      registryRead: "AUTHENTICATED_BEFORE_AND_AFTER", anonymousRead: "AUTHORIZATION_DENIED",
      forkIsolation: "NOT_VERIFIED" },
    currentness: { checkedAt: "2026-10-01T00:00:00.000Z", validUntil: "2026-10-02T01:15:45.849Z",
      signerBudgetMs: 1_200_000, javaMaxAgeMs: null },
  };
}

function preSign(predicateBytes, overrides = {}) {
  return { kind: "POSTGRES_CANDIDATE_PRE_SIGN_RECEIPT_V1", state: "EVIDENCE_VERIFIED",
    authority: "REVIEWED_MAIN_SIGNER", candidateAuthorization: "NOT_AUTHORIZED",
    admission: "NOT_AUTHORIZED", signing: "PENDING_OFFICIAL_ACTION", repository: ATTESTATION.repository,
    workflowPath: ATTESTATION.workflowPath, sourceRef: MAIN_REF, runId: "12345", runNumber: "1",
    runAttempt: "1", recipeRevision: sourceSha,
    subject: { name: ATTESTATION.subjectName, digest: ATTESTATION.subjectDigest },
    predicate: { type: ATTESTATION.predicateType, sha256: hash(predicateBytes),
      bytes: predicateBytes.length, file: "predicate.json" }, ...overrides };
}

function verifiedEntry(value, identity = "exact") {
  return { attestation: { bundle: "technical" }, verificationResult: {
    signature: { certificate: { subjectAlternativeName: "expected", githubWorkflowTrigger: "workflow_dispatch",
      buildTrigger: "workflow_dispatch",
      runInvocationURI: `https://github.com/${ATTESTATION.repository}/actions/runs/12345/attempts/1` } },
    verifiedIdentity: identity,
    statement: { _type: "https://in-toto.io/Statement/v1",
      subject: [{ name: ATTESTATION.subjectName,
        digest: { sha256: ATTESTATION.subjectDigest.slice("sha256:".length) } }],
      predicateType: ATTESTATION.predicateType, predicate: value },
  } };
}
const success = (value, identity) => ({ code: 0, processError: false,
  stdout: JSON.stringify([verifiedEntry(value, identity)]), stderr: "", durationMs: 2 });
const rejected = (field = "BuildSignerDigest") => ({ code: 1, processError: false, stdout: "",
  stderr: `Policy verification failed\nError: expected ${field} to be expected, got actual`, durationMs: 1 });

async function fixtures(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "aw-attestation-verifier-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const value = predicate();
  const predicateBytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  assert.deepEqual(JSON.parse(predicateBytes), value);
  const files = { directory, bundle: path.join(directory, "bundle.json"),
    predicate: path.join(directory, "predicate.json"), preSignReceipt: path.join(directory, "pre-sign-receipt.json") };
  const signedStatement = Buffer.from(JSON.stringify({ _type: "https://in-toto.io/Statement/v1",
    predicateType: ATTESTATION.predicateType, predicate: value })).toString("base64");
  await writeFile(files.bundle, JSON.stringify({ mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {}, dsseEnvelope: { payload: signedStatement } }));
  await writeFile(files.predicate, predicateBytes);
  await writeFile(files.preSignReceipt, `${JSON.stringify(preSign(predicateBytes), null, 2)}\n`);
  return { ...files, value, predicateBytes };
}

test("official calls bind the immutable OCI subject and every GitHub identity dimension", async (t) => {
  const { bundle } = await fixtures(t);
  for (const mode of ["identity", "workflow"]) {
    const args = verificationArgs({ bundle, sourceSha, signerSha, mode });
    assert.deepEqual(args.slice(0, 3), ["attestation", "verify",
      `oci://${ATTESTATION.subjectName}@${ATTESTATION.subjectDigest}`]);
    assert.equal(args[args.indexOf("--source-ref") + 1], MAIN_REF);
    assert.equal(args[args.indexOf("--source-digest") + 1], sourceSha);
    assert.equal(args[args.indexOf("--signer-digest") + 1], signerSha);
    assert.equal(args[args.indexOf("--predicate-type") + 1], ATTESTATION.predicateType);
    assert.ok(args.includes("--deny-self-hosted-runners"));
    assert.ok(args.includes(mode === "identity" ? "--cert-identity" : "--signer-workflow"));
  }
  assert.throws(() => verificationArgs({ bundle: "relative", sourceSha, signerSha, mode: "identity" }),
    /verification_invalid/u);
});

test("wrong-subject control uses the authenticated existing PostgreSQL bootstrap manifest", () => {
  const policy = validatePostgresRemotePolicy(JSON.parse(readFileSync(
    new URL("../infra/postgres-image/candidate-remote.json", import.meta.url))));
  const publication = validatePostgresRemotePublicationReceipt(JSON.parse(readFileSync(
    new URL("../infra/postgres-image/candidate-publication-receipt.json", import.meta.url))), policy);
  assert.equal(BOOTSTRAP_DIGEST, publication.bootstrap.digest);
  assert.equal(publication.bootstrap.size, 524);
  assert.equal(publication.bootstrap.anonymousRead, "AUTHORIZATION_DENIED");
  assert.notEqual(BOOTSTRAP_DIGEST, ATTESTATION.subjectDigest);
});

test("pre-sign receipt is closed and binds exact predicate bytes", () => {
  const bytes = Buffer.from(`${JSON.stringify(predicate(), null, 2)}\n`);
  const receipt = preSign(bytes);
  assert.equal(validatePreSignReceipt(receipt, bytes).signing, "PENDING_OFFICIAL_ACTION");
  assert.throws(() => validatePreSignReceipt({ ...receipt, extra: true }, bytes), /pre_sign_receipt_invalid/u);
  assert.throws(() => validatePreSignReceipt(receipt, Buffer.concat([bytes, Buffer.from(" ")])), /pre_sign_receipt_invalid/u);
});

test("predicate signer identity must equal the pre-sign run and revision", async (t) => {
  for (const [field, value] of [["runId", "99999"], ["recipeRevision", "c".repeat(40)]]) {
    await t.test(field, async (sub) => {
      const item = await fixtures(sub); item.value.signer[field] = value;
      item.predicateBytes = Buffer.from(`${JSON.stringify(item.value, null, 2)}\n`);
      await writeFile(item.predicate, item.predicateBytes);
      await writeFile(item.preSignReceipt, `${JSON.stringify(preSign(item.predicateBytes), null, 2)}\n`);
      await assert.rejects(verifyCandidateAttestationPair({ ...item, expectedPredicate: item.value,
        sourceSha, signerSha }, async () => success(item.value)), /pre_sign_receipt_invalid/u);
    });
  }
});

test("unexpected CLI, transport, auth, registry and ambiguous output are errors, never negatives", () => {
  const value = predicate();
  for (const result of [
    { ...success(value), processError: true }, { ...success(value), code: null },
    { ...success(value), stdout: "not-json" }, { ...success(value), stdout: "[]" },
    { ...success(value), stdout: JSON.stringify([verifiedEntry(value), verifiedEntry(value)]) },
    { ...rejected(), stderr: "unauthorized: authentication required" },
    { ...rejected(), stderr: "MANIFEST_UNKNOWN" }, { ...rejected(), stderr: "connection timeout" },
    { ...rejected(), stderr: "unknown flag: --source-digest" }, { ...rejected(), code: 2 },
  ]) assert.equal(classifyVerification(result).status, "ERROR");
  assert.equal(classifyVerification(rejected()).status, "REJECTED");
});

test("pair accepts one identical official statement and emits no raw CLI output", async (t) => {
  const item = await fixtures(t);
  let call = 0;
  const result = await verifyCandidateAttestationPair({ ...item, expectedPredicate: item.value,
    sourceSha, signerSha }, async () => success(item.value, ++call === 1 ? "identity" : "workflow"));
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.invocations.length, 2);
  assert.equal(JSON.stringify(result).includes("technical"), false);
  assert.equal(result.invocations.every((entry) => !Object.hasOwn(entry, "stdout") && !Object.hasOwn(entry, "stderr")), true);
  assert.equal(result.invocations[0].args[result.invocations[0].args.indexOf("--bundle") + 1], "bundle.json");
});

test("substitution, races, malformed bundle, multiple attestations and statement changes fail closed", async (t) => {
  const item = await fixtures(t);
  const base = { ...item, expectedPredicate: item.value, sourceSha, signerSha };
  await assert.rejects(verifyCandidateAttestationPair({ ...base, expectedPredicate: { ...item.value,
    admission: "AUTHORIZED" } }, async () => success(item.value)), /predicate_changed/u);
  const replayed = verifiedEntry(item.value);
  replayed.verificationResult.signature.certificate.runInvocationURI =
    `https://github.com/${ATTESTATION.repository}/actions/runs/99999/attempts/1`;
  await assert.rejects(verifyCandidateAttestationPair(base, async () => ({ code: 0, processError: false,
    stdout: JSON.stringify([replayed]), stderr: "", durationMs: 1 })), /statement_invalid/u);
  let calls = 0;
  await assert.rejects(verifyCandidateAttestationPair(base, async () => {
    if (++calls === 1) await writeFile(item.bundle, `${await readFile(item.bundle, "utf8")} `);
    return success(item.value);
  }), /input_changed/u);
  await writeFile(item.bundle, "{}");
  await assert.rejects(verifyCandidateAttestationPair(base, async () => success(item.value)), /bundle_invalid/u);
  await writeFile(item.bundle, "{");
  await assert.rejects(verifyCandidateAttestationPair(base, async () => success(item.value)), /input_invalid/u);
  await assert.rejects(verifyCandidateAttestationPair({ ...base,
    bundle: path.join(item.directory, "missing.json") }, async () => success(item.value)), /input_invalid/u);
});

test("verified negatives require a genuine paired positive and exactly one intended perturbation", () => {
  const pair = (policy, state = "VERIFIED", rejections = []) => ({ state, bundleSha256: "1", predicateSha256: "2",
    preSignReceiptSha256: "3", policy, invocations: ["identity", "workflow"].map((mode, index) =>
      ({ mode, status: state === "VERIFIED" ? "VERIFIED" : "REJECTED", rejection: rejections[index] })) });
  const policy = { sourceSha, signerSha, subjectName: ATTESTATION.subjectName,
    subjectDigest: ATTESTATION.subjectDigest, workflowPath: ATTESTATION.workflowPath, ref: MAIN_REF };
  const positive = pair(policy);
  const sigstore = { kind: "SIGSTORE_VERIFICATION_FAILED" };
  const controls = {
    "wrong-subject": [{ subjectDigest: BOOTSTRAP_DIGEST }, [sigstore, sigstore]],
    "wrong-workflow": [{ workflowPath: ".github/workflows/wrong.yml" }, [sigstore, sigstore]],
    "wrong-ref": [{ ref: "refs/heads/wrong" }, [sigstore, { kind: "CERTIFICATE_POLICY_MISMATCH",
      field: "SourceRepositoryRef", expected: "refs/heads/wrong", actual: MAIN_REF }]],
    "wrong-source": [{ sourceSha: "0".repeat(40) }, [0, 1].map(() => ({ kind: "CERTIFICATE_POLICY_MISMATCH",
      field: "SourceRepositoryDigest", expected: "0".repeat(40), actual: sourceSha }))],
    "wrong-signer": [{ signerSha: "0".repeat(40) }, [0, 1].map(() => ({ kind: "CERTIFICATE_POLICY_MISMATCH",
      field: "BuildSignerDigest", expected: "0".repeat(40), actual: signerSha }))],
  };
  for (const [kind, [change, rejections]] of Object.entries(controls)) {
    const negative = pair({ ...policy, ...change }, "REJECTED", rejections);
    assert.equal(negativeProved(kind, positive, negative), true);
    assert.equal(negativeProved(kind, positive, { ...negative, bundleSha256: "changed" }), false);
    assert.equal(negativeProved(kind, { ...positive, state: "ERROR" }, negative), false);
  }
  const wrongField = pair({ ...policy, sourceSha: "0".repeat(40) }, "REJECTED",
    [0, 1].map(() => ({ kind: "CERTIFICATE_POLICY_MISMATCH", field: "BuildSignerDigest",
      expected: "0".repeat(40), actual: sourceSha })));
  assert.equal(negativeProved("wrong-source", positive, wrongField), false);
});

test("signed-payload tamper is a real signature rejection while missing, truncated and malformed bundles stay errors", async (t) => {
  const item = await fixtures(t);
  const base = { ...item, expectedPredicate: item.value, sourceSha, signerSha };
  const positive = await verifyCandidateAttestationPair(base,
    async () => success(item.value));
  const output = path.join(item.directory, "controls");
  const controls = await exerciseCandidateAttestationBundleControls({ ...item, input: item.directory, output },
    base, (options) => verifyCandidateAttestationPair(options, async () => ({
      code: 1, processError: false, stdout: "",
      stderr: 'Error: verifying with issuer "sigstore.dev"', durationMs: 1,
    })), positive);
  assert.equal(controls.tamperedPayload.proof, "SIGNATURE_REJECTION_PROVED");
  assert.notEqual(controls.tamperedPayload.originalBundleSha256,
    controls.tamperedPayload.tamperedBundleSha256);
  assert.notEqual(controls.tamperedPayload.originalPayloadSha256,
    controls.tamperedPayload.tamperedPayloadSha256);
  assert.deepEqual(Object.values(controls.malformedInputControls)
    .map((entry) => [entry.proof, entry.result.state]), [
    ["ERROR_NOT_REJECTION", "ERROR"], ["ERROR_NOT_REJECTION", "ERROR"],
    ["ERROR_NOT_REJECTION", "ERROR"],
  ]);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(output), []);
});

test("CLI orchestration proves positives around all real policy controls and keeps admission closed", async (t) => {
  const item = await fixtures(t);
  const env = { GITHUB_RUN_ID: "12345", GITHUB_SHA: sourceSha };
  const calls = [];
  const make = (options, state = "VERIFIED") => {
    const sigstore = { kind: "SIGSTORE_VERIFICATION_FAILED" };
    const rejection = options.ref ? [sigstore, { kind: "CERTIFICATE_POLICY_MISMATCH",
      field: "SourceRepositoryRef", expected: options.ref, actual: MAIN_REF }]
      : options.sourceSha !== sourceSha ? [0, 1].map(() => ({ kind: "CERTIFICATE_POLICY_MISMATCH",
        field: "SourceRepositoryDigest", expected: options.sourceSha, actual: sourceSha }))
        : options.signerSha !== sourceSha ? [0, 1].map(() => ({ kind: "CERTIFICATE_POLICY_MISMATCH",
          field: "BuildSignerDigest", expected: options.signerSha, actual: sourceSha })) : [sigstore, sigstore];
    return { state, bundleSha256: "bundle",
    predicateSha256: hash(item.predicateBytes), preSignReceiptSha256: hash(Buffer.from("receipt")),
    policy: { sourceSha: options.sourceSha, signerSha: options.signerSha,
      subjectName: options.subjectName ?? ATTESTATION.subjectName,
      subjectDigest: options.subjectDigest ?? ATTESTATION.subjectDigest,
      workflowPath: options.workflowPath ?? ATTESTATION.workflowPath, ref: options.ref ?? MAIN_REF },
    invocations: ["identity", "workflow"].map((mode, index) => ({ mode,
      status: state === "VERIFIED" ? "VERIFIED" : "REJECTED",
      ...(state === "VERIFIED" ? {} : { rejection: rejection[index] }) })) };
  };
  let receipt;
  const result = await runCandidateAttestationVerification(["verify"], env, {
    requireContext: async () => ({ ...item, input: item.directory, output: path.join(item.directory, "output") }),
    toolIdentity: async () => ({ executable: "gh", version: "2.98.0", binarySha256: "f".repeat(64),
      binaryBytes: 1, helpSha256: "e".repeat(64) }),
    verifyPair: async (options) => {
      calls.push(options);
      const changed = options.subjectDigest || options.workflowPath || options.ref
        || options.sourceSha !== sourceSha || options.signerSha !== sourceSha;
      return make(options, changed ? "REJECTED" : "VERIFIED");
    },
    exerciseMalformedInputs: async () => ({
      tamperedPayload: { proof: "SIGNATURE_REJECTION_PROVED", result: make({
        sourceSha, signerSha, bundleSha256: "tampered" }, "REJECTED") },
      malformedInputControls: Object.fromEntries(["missingBundle", "truncatedBundle", "corruptBundle"]
        .map((name) => [name, { proof: "ERROR_NOT_REJECTION", result: { state: "ERROR", code: "input_invalid" } }])),
    }),
    publishReceipt: async (_output, value) => { receipt = value; return "receipt.json"; },
  });
  assert.equal(result.receipt.verdict, "ATTESTED_UNADMITTED");
  assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.deepEqual(Object.keys(receipt.negativeControls),
    ["wrong-subject", "wrong-workflow", "wrong-ref", "wrong-source", "wrong-signer", "tampered-payload"]);
  assert.equal(calls.length, 7);
  assert.equal(calls[0].sourceSha, sourceSha);
  assert.equal(calls.at(-1).sourceSha, sourceSha);
  assert.equal(calls.at(-1).subjectDigest, undefined);
});

test("CLI failures preserve the active phase and only completed prior controls", async (t) => {
  const item = await fixtures(t);
  const env = { GITHUB_RUN_ID: "12345", GITHUB_SHA: sourceSha };
  let calls = 0; let failure;
  const positive = { state: "VERIFIED", bundleSha256: "bundle",
    predicateSha256: hash(item.predicateBytes), preSignReceiptSha256: "receipt",
    policy: { sourceSha, signerSha: sourceSha, subjectName: ATTESTATION.subjectName,
      subjectDigest: ATTESTATION.subjectDigest, workflowPath: ATTESTATION.workflowPath, ref: MAIN_REF },
    invocations: ["identity", "workflow"].map((mode) => ({ mode, status: "VERIFIED" })) };
  await assert.rejects(runCandidateAttestationVerification(["verify"], env, {
    requireContext: async () => ({ ...item, input: item.directory, output: path.join(item.directory, "failed") }),
    toolIdentity: async () => ({ executable: "gh", version: "2.98.0", binarySha256: "f".repeat(64),
      binaryBytes: 1, helpSha256: "e".repeat(64) }),
    verifyPair: async () => ++calls === 1 ? positive : { state: "ERROR", invocations: [] },
    publishReceipt: async (_output, value) => { failure = value; return "failed.json"; },
  }), /negative_control_failed/u);
  assert.equal(failure.state, "FAILED");
  assert.equal(failure.phase, "wrong-subject");
  assert.deepEqual(failure.completedControls, ["positive-before"]);
  assert.equal(failure.admission, "NOT_AUTHORIZED");
});
