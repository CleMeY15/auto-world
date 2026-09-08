import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createNativeAdmissionFixture } from "./helpers/native-admission-fixture.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";

async function reviewInput(admission, payload, kind, reviewerId, reportText, sourceId) {
  const label = kind === "code_security" ? "code-security" : "architecture";
  const reportBytes = Buffer.from(reportText);
  const report = { path: `docs/validation/native-admission/${label}-review.md`, sha256: sha256(reportBytes), size: reportBytes.length };
  const receipt = admission.createNativeAdmissionReviewReceipt({ kind, reviewerId, payload, report,
    reviewSource: { kind: "git_commit", id: sourceId } });
  return { receipt: { path: `docs/validation/native-admission/${label}-review.json`, bytes: receipt.bytes,
    sha256: receipt.sha256, size: receipt.size }, report: { ...report, bytes: reportBytes } };
}

test("synthetic evidence traverses real derive, review, finalize, and revalidation contracts", async () => {
  const fixture = await createNativeAdmissionFixture();
  try {
    const payload = await fixture.admission.deriveNativeAdmissionPayload({ ...fixture.derivation, environment: {} });
    assert.equal(payload.payload.state, "native_admission_payload");
    assert.equal(payload.payload.builds.length, 6);
    assert.equal(payload.payload.outputs.length, 4);
    assert.equal(payload.payload.audit.fileCount, 49);
    assert.equal(payload.payload.baseline.comparisonStatus, "match");
    const reviews = [
      await reviewInput(fixture.admission, payload, "code_security", "/root/bootstrap_material_specialist_review",
        "Synthetic fixture review; this is test data, not native evidence.", "d".repeat(40)),
      await reviewInput(fixture.admission, payload, "architecture", "/root/bootstrap_final_architecture_review",
        "Synthetic fixture architecture review; this is test data, not native evidence.", "e".repeat(40)),
    ];
    await mkdir(path.dirname(fixture.paths.proposal), { recursive: true });
    const finalized = await fixture.admission.finalizeNativeAdmissionProposal({ derivation: fixture.derivation, reviews,
      outputFile: fixture.paths.proposal, environment: {} });
    assert.equal(finalized.proposal.state, "reviewed_admission_proposal");
    assert.deepEqual(finalized.proposal.activation, { status: "blocked", capabilities: [] });
    const validated = await fixture.admission.validateNativeAdmissionEvidence({ proposalFile: fixture.paths.proposal,
      derivation: fixture.derivation, reviews, environment: {} });
    assert.equal(validated.sha256, finalized.sha256);
    fixture.admission.validateReviewedNativeAdmissionProposal(await readFile(fixture.paths.proposal), payload.payload);
  } finally {
    await fixture.cleanup();
  }
});

test("real derivation rejects record, audit, database, CLI, TCB, and 49-file inventory substitution", async () => {
  const fixture = await createNativeAdmissionFixture();
  try {
    const substitutions = [
      { label: "record", file: fixture.paths.record, mutate: (bytes) => canonicalJsonBuffer({ ...JSON.parse(bytes.toString("utf8")), repeat: 2 }) },
      { label: "audit", file: fixture.paths.audit, mutate: () => Buffer.from("{}") },
      { label: "database", file: fixture.paths.database, mutate: (bytes) => Buffer.concat([bytes, Buffer.from("x")]) },
      { label: "CLI", file: fixture.paths.cli, mutate: () => Buffer.from("{}") },
      { label: "TCB", file: fixture.paths.tcb, mutate: (bytes) => canonicalJsonBuffer({ ...JSON.parse(bytes.toString("utf8")), containersExecuted: 1 }) },
      { label: "baseline image", file: path.join(fixture.derivation.baselineDirectory, "baseline-comparison.json"),
        mutate: (bytes) => canonicalJsonBuffer({ ...JSON.parse(bytes.toString("utf8")),
          baseline: { ...JSON.parse(bytes.toString("utf8")).baseline, image: `aquasec/trivy@sha256:${"9".repeat(64)}` } }) },
    ];
    for (const { label, file, mutate } of substitutions) {
      const original = await readFile(file);
      await writeFile(file, mutate(original));
      await assert.rejects(fixture.admission.deriveNativeAdmissionPayload({ ...fixture.derivation, environment: {} }), undefined, label);
      await writeFile(file, original);
    }
    const summaryPath = path.join(fixture.derivation.auditDirectory, "native-audit-results.json");
    const packagePath = path.join(fixture.derivation.auditDirectory, "diagnostic-package.json");
    const originalSummary = await readFile(summaryPath);
    const originalPackage = await readFile(packagePath);
    const changedSummary = JSON.parse(originalSummary.toString("utf8"));
    changedSummary.fixtures.materials = [changedSummary.fixtures.materials[0], changedSummary.fixtures.materials[0],
      ...changedSummary.fixtures.materials.slice(2)];
    const changedSummaryBytes = canonicalJsonBuffer(changedSummary);
    const changedPackage = JSON.parse(originalPackage.toString("utf8"));
    const summaryIdentity = changedPackage.files.find((entry) => entry.path === "native-audit-results.json");
    summaryIdentity.sha256 = sha256(changedSummaryBytes);
    summaryIdentity.size = changedSummaryBytes.length;
    await writeFile(summaryPath, changedSummaryBytes);
    await writeFile(packagePath, canonicalJsonBuffer(changedPackage));
    await assert.rejects(fixture.admission.deriveNativeAdmissionPayload({ ...fixture.derivation, environment: {} }),
      undefined, "fixture summary duplicate");
    await writeFile(summaryPath, originalSummary);
    await writeFile(packagePath, originalPackage);
    const missing = await readFile(fixture.paths.auditCount);
    await fixture.unlink(fixture.paths.auditCount);
    await assert.rejects(fixture.admission.deriveNativeAdmissionPayload({ ...fixture.derivation, environment: {} }), undefined, "file count");
    await fixture.put(fixture.paths.auditCount, missing);
    const restored = await fixture.admission.deriveNativeAdmissionPayload({ ...fixture.derivation, environment: {} });
    assert.equal(restored.payload.audit.fileCount, 49);
  } finally {
    await fixture.cleanup();
  }
});
