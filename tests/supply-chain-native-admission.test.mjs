import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertNativeAdmissionBudget, createNativeAdmissionReviewReceipt, NATIVE_ADMISSION_IMPORT_PATHS,
  validateCosignAdmissionEvidence, validateNativeAdmissionPayload, validateNativeAdmissionRepositoryContext,
  validateOrasAdmissionEvidence, validateReviewedNativeAdmissionProposal } from "../scripts/supply-chain/native-admission.mjs";
import { canonicalJsonBuffer, sha256 } from "../scripts/supply-chain/strict-json.mjs";

const hash = (character) => character.repeat(64);
const run = Object.freeze({ id: "34179141478", attempt: 1, workflowSha: "7".repeat(40), sourceSha: "7".repeat(40),
  workflowRef: "CleMeY15/auto-world/.github/workflows/native-bootstrap.yml@refs/pull/8/merge", event: "pull_request",
  workflowFileSha256: hash("8") });
const file = (character, size = 1) => ({ sha256: hash(character), size });

function payload() {
  const output = (target) => ({ target, sha256: hash("7"), size: 10, buildInfoSha256: hash("8") });
  return { schemaVersion: 1, state: "native_admission_payload", intendedStage: "merged_pending_activation",
    activation: { status: "blocked", capabilities: [] },
    repository: { context: { path: "native-admission-context.json", ...file("1") }, selection: file("2"), materialLock: file("3"), workflow: file("4"),
      nativeRecipeSha256: hash("5"), admissionRecipeSha256: hash("6") }, run,
    authors: ["/root", "/root/bootstrap_native_executor"],
    materials: { selectionSha256: hash("2"), materialLockSha256: hash("3"), moduleGraphs: { oras: hash("a"), cosign: hash("b"), trivy: hash("c") } },
    builds: ["oras", "cosign", "trivy"].flatMap((tool) => [1, 2].map((repeat) => ({ tool, repeat,
      artifact: `native-candidate-${tool}-${repeat}`, recordSha256: sha256(Buffer.from(`${tool}:${repeat}`)), sourceCommit: "a".repeat(40),
      repositoryCommit: run.sourceSha, selectionSha256: hash("2"), materialLockSha256: hash("3"), recipeSha256: hash("6"), run,
      runner: { label: "ubuntu-24.04", imageVersion: "20260831.293.1", utilityInventorySha256: hash("a") },
      outputs: tool === "cosign" ? [output("linux-amd64"), output("windows-amd64")] : [output("linux-amd64")] }))),
    outputs: [{ tool: "oras", ...output("linux-amd64") }, { tool: "cosign", ...output("linux-amd64") },
      { tool: "cosign", ...output("windows-amd64") }, { tool: "trivy", ...output("linux-amd64") }],
    reproduction: { ...file("d"), state: "reproducible_candidate" },
    cli: { summary: { path: "native-cli-results.json", ...file("e") }, details: [
      { tool: "oras", path: "oras-integration-native.json", ...file("a") },
      { tool: "cosign", path: "cosign-airgap-native.json", ...file("b") }] },
    audit: { package: { path: "diagnostic-package.json", ...file("f") }, summary: { path: "native-audit-results.json", ...file("0") }, fileCount: 49,
      subjects: [{ tool: "oras", target: "linux-amd64" }, { tool: "cosign", target: "linux-amd64" },
        { tool: "cosign", target: "windows-amd64" }, { tool: "trivy", target: "linux-amd64" }].map((entry) => ({ ...entry,
        receipt: { ...file("c"), cap: 8 * 1024 ** 2 }, evidence: { sbom: hash("1"), report: hash("2"), "build-info": hash("8"),
          "module-graph": { oras: hash("a"), cosign: hash("b"), trivy: hash("c") }[entry.tool],
          "material-lock": hash("3"), recipe: hash("6") } })),
      scanner: { name: "trivy", version: "0.74.0-autoworld.1", sha256: hash("7") },
      databases: [{ name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db:2", sha256: hash("e"), metadataSha256: hash("f") },
        { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db:1", sha256: hash("1"), metadataSha256: hash("2") }],
      fixtureManifest: { path: "infra/supply-chain/materials/scanner-fixtures/manifest.json", ...file("1") } },
    baseline: { receipt: { path: "baseline-comparison.json", ...file("2") }, state: "failed_non_admitted", comparisonStatus: "match",
      tcbIdentitySha256: hash("3"), evidence: [{ path: "tcb-managed-docker.json", ...file("4") }, { path: "tcb-inventory.json", ...file("5") }],
      reports: [{ fixtureId: "gomod-vulnerable", path: "gomod-vulnerable.json", ...file("6") },
        { fixtureId: "java-war-vulnerable", path: "java-war-vulnerable.json", ...file("7") }] } };
}

function reviewedEnvelope(value = payload(), reviewers = ["/root/bootstrap_material_specialist_review", "/root/bootstrap_final_architecture_review"]) {
  const payloadBytes = canonicalJsonBuffer(value);
  const derived = { payload: value, bytes: payloadBytes, sha256: sha256(payloadBytes), size: payloadBytes.length };
  const reviews = ["code_security", "architecture"].map((kind, index) => {
    const label = kind === "code_security" ? "code-security" : "architecture";
    const report = { path: `docs/validation/native-admission/${label}-review.md`, sha256: hash(index ? "b" : "a"), size: 20 };
    const created = createNativeAdmissionReviewReceipt({ kind, reviewerId: reviewers[index], payload: derived, report,
      reviewSource: { kind: "git_commit", id: (index ? "c" : "b").repeat(40) } });
    return { kind, reviewerId: reviewers[index], receipt: { path: `docs/validation/native-admission/${label}-review.json`,
      sha256: created.sha256, size: created.size }, report, reviewSource: created.record.reviewSource,
      record: created.record };
  });
  return { schemaVersion: 1, state: "reviewed_admission_proposal", intendedStage: "merged_pending_activation",
    activation: { status: "blocked", capabilities: [] }, payload: value, payloadSha256: derived.sha256, reviews, supportingReviews: [] };
}

const clone = (value) => globalThis.structuredClone(value);

async function repositoryFixture() {
  const root = await realpath(path.resolve(new URL("..", import.meta.url).pathname.slice(1)));
  const selection = JSON.parse(await readFile(path.join(root, "infra/supply-chain/native-sources.json"), "utf8"));
  const nativePaths = selection.tools[0].recipeFiles;
  const allPaths = [...new Set(["infra/supply-chain/native-sources.json", "infra/supply-chain/native-materials.lock.json",
    ".github/workflows/native-bootstrap.yml", ...nativePaths, ...NATIVE_ADMISSION_IMPORT_PATHS])];
  const inputs = [];
  for (const filename of allPaths) {
    const bytes = await readFile(path.join(root, filename));
    inputs.push({ path: filename, bytes, sha256: sha256(bytes), size: bytes.length });
  }
  const byPath = new Map(inputs.map((entry) => [entry.path, entry]));
  const asIdentity = (filename) => ({ path: filename, sha256: byPath.get(filename).sha256, size: byPath.get(filename).size });
  const workflow = asIdentity(".github/workflows/native-bootstrap.yml");
  const context = { schemaVersion: 1, state: "native_evidence_context", repository: "CleMeY15/auto-world", prNumber: 8,
    run: { ...run, workflowFileSha256: workflow.sha256 }, source: { headSha: "a".repeat(40), baseSha: "b".repeat(40),
      mergeSha: run.sourceSha, mergeTree: "c".repeat(40), mergeParents: ["b".repeat(40), "a".repeat(40)] },
    startedAt: "2026-09-08T08:00:00Z", completedAt: "2026-09-08T12:00:00Z",
    selection: asIdentity("infra/supply-chain/native-sources.json"), materialLock: asIdentity("infra/supply-chain/native-materials.lock.json"),
    workflow, nativeRecipeFiles: nativePaths.map(asIdentity), admissionRecipeFiles: NATIVE_ADMISSION_IMPORT_PATHS.map(asIdentity) };
  const bytes = canonicalJsonBuffer(context);
  return { root, repository: { context: { path: "native-admission-context.json", bytes, sha256: sha256(bytes), size: bytes.length },
    files: inputs, authorIds: ["/root", "/root/bootstrap_native_executor"] }, context };
}

test("admission import closure is fixed and includes every static transitive policy dependency", async () => {
  const root = await realpath(path.resolve(new URL("..", import.meta.url).pathname.slice(1)));
  const pending = ["scripts/supply-chain/native-admission.mjs", "scripts/supply-chain/baseline-scanner.mjs"];
  const closure = new Set();
  while (pending.length) {
    const filename = pending.pop();
    if (closure.has(filename)) continue;
    closure.add(filename);
    const source = await readFile(path.join(root, filename), "utf8");
    assert.doesNotMatch(source, /\b(?:import|require)\s*\(/u, filename);
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu)) {
      assert.ok(match[1].startsWith("node:") || match[1].startsWith("./"), `${filename}:${match[1]}`);
      if (match[1].startsWith("./")) {
        const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(filename), match[1]));
        if (dependency.endsWith(".mjs")) pending.push(dependency);
      }
    }
  }
  assert.deepEqual([...NATIVE_ADMISSION_IMPORT_PATHS], [...NATIVE_ADMISSION_IMPORT_PATHS].sort());
  assert.deepEqual([...closure].sort(), [...NATIVE_ADMISSION_IMPORT_PATHS]);
});

test("repository context accepts synthetic merge identity, legitimate closure overlap, and binds loaded module bytes", async () => {
  const fixture = await repositoryFixture();
  const validated = await validateNativeAdmissionRepositoryContext(fixture.root, fixture.repository);
  assert.equal(validated.context.source.mergeSha, run.sourceSha);
  assert.ok(fixture.context.nativeRecipeFiles.some((entry) => fixture.context.admissionRecipeFiles.some((other) => other.path === entry.path)));
  const stale = await repositoryFixture();
  const selected = stale.repository.files.find((entry) => entry.path === "scripts/supply-chain/native-admission.mjs");
  selected.bytes = Buffer.from("stale"); selected.sha256 = sha256(selected.bytes); selected.size = selected.bytes.length;
  const staleContext = JSON.parse(stale.repository.context.bytes);
  const listed = staleContext.admissionRecipeFiles.find((entry) => entry.path === selected.path);
  listed.sha256 = selected.sha256; listed.size = selected.size;
  stale.repository.context.bytes = canonicalJsonBuffer(staleContext);
  stale.repository.context.sha256 = sha256(stale.repository.context.bytes); stale.repository.context.size = stale.repository.context.bytes.length;
  await assert.rejects(validateNativeAdmissionRepositoryContext(stale.root, stale.repository), { code: "native_admission_repository_input_changed" });
  const falseTime = await repositoryFixture();
  const changed = JSON.parse(falseTime.repository.context.bytes); changed.completedAt = "2026-09-08T07:59:59Z";
  falseTime.repository.context.bytes = canonicalJsonBuffer(changed); falseTime.repository.context.sha256 = sha256(falseTime.repository.context.bytes);
  falseTime.repository.context.size = falseTime.repository.context.bytes.length;
  await assert.rejects(validateNativeAdmissionRepositoryContext(falseTime.root, falseTime.repository), { code: "native_admission_run_time_invalid" });
});

test("ORAS and Cosign retained evidence proves exercised negatives and canonical embedded bytes", () => {
  const binary = hash("a");
  const oras = { binarySha256: binary, childDigest: `sha256:${hash("b")}`, configDigest: `sha256:${hash("c")}`,
    parentDigest: `sha256:${hash("d")}`, phase: "oras_cli_integration", status: "passed", negatives: [
      ...["redirect_refused", "bearer_refused", "upload-location_refused"].map((code) => ({ code, scope: "native_cli", challenges: 1, authenticatedRequests: 1, secondaryRequests: 1 })),
      { code: "proxy_environment_refused", scope: "subprocess_environment_boundary", nativeCommandExecuted: false, secondaryRequests: 0 },
      { code: "native_proxy_auth_scoped", scope: "native_cli", nativeCommandExecuted: true, authenticatedRequests: 1, proxyConnects: 1 },
      { code: "native_proxy_connect_refused", scope: "native_cli", nativeCommandExecuted: true, challenges: 2, secondaryRequests: 1 }] };
  validateOrasAdmissionEvidence(oras, binary);
  const unexercised = clone(oras); unexercised.negatives[0].challenges = 0;
  assert.throws(() => validateOrasAdmissionEvidence(unexercised, binary), { code: "native_admission_oras_cli_invalid" });
  const publicKey = Buffer.from("public"), bundle = Buffer.from("bundle"), subject = Buffer.from("subject");
  const cosign = { binarySha256: binary, bundleSha256: sha256(bundle), primaryKeySha256: sha256(publicKey), subjectSha256: sha256(subject),
    publicKeyBase64: publicKey.toString("base64"), bundleBase64: bundle.toString("base64"), subjectBase64: subject.toString("base64"),
    network: "isolated_namespace", networkProof: { interfaces: ["lo"], ipv4NonLoopbackRoutes: 0, ipv6NonLoopbackRoutes: 0,
      status: "isolated", namespaceSha256: hash("1"), parentNamespaceSha256: hash("2"), probe: "ENETUNREACH" },
    revokedLedger: "cosign_ledger_revoked", sourceCommit: "3".repeat(40), sourceSha256: hash("4"), status: "passed",
    tests: { missingKey: "key_missing", tamper: "signature_invalid", valid: "signature_valid", wrongKey: "signature_invalid" } };
  const source = { commit: cosign.sourceCommit, archive: { sha256: cosign.sourceSha256 } };
  validateCosignAdmissionEvidence(cosign, binary, source);
  for (const mutate of [(value) => { value.networkProof.probe = "timeout"; }, (value) => { value.bundleBase64 = `${value.bundleBase64}\n`; },
    (value) => { value.subjectSha256 = hash("9"); }]) { const hostile = clone(cosign); mutate(hostile); assert.throws(() => validateCosignAdmissionEvidence(hostile, binary, source)); }
});

test("aggregate admission budget is fixed at eight GiB and each retained leaf at two GiB", () => {
  const GiB = 1024 ** 3;
  assert.equal(assertNativeAdmissionBudget([2 * GiB, 2 * GiB, 2 * GiB, 2 * GiB]), 8 * GiB);
  for (const sizes of [[8 * GiB], [2 * GiB, 2 * GiB, 2 * GiB, 2 * GiB, 1], [0], [], Array(200_001).fill(1)]) {
    assert.throws(() => assertNativeAdmissionBudget(sizes));
  }
});

test("canonical payload accepts the blocked state and refuses capability, cardinality, duplicate, and serialization drift", () => {
  const valid = payload();
  assert.deepEqual(validateNativeAdmissionPayload(canonicalJsonBuffer(valid), valid), valid);
  for (const mutate of [
    (value) => { value.activation.capabilities.push("install"); },
    (value) => { value.builds.pop(); },
    (value) => { value.builds[5] = clone(value.builds[0]); },
    (value) => { value.outputs.pop(); },
    (value) => { value.outputs[0].sha256 = hash("f"); },
    (value) => { value.audit.fileCount = 48; },
    (value) => { value.audit.subjects[0].evidence["material-lock"] = hash("f"); },
    (value) => { value.cli.details[0].path = "../forged.json"; },
    (value) => { value.audit.scanner.version = null; },
    (value) => { value.audit.subjects[0].receipt.cap = "8388608"; },
    (value) => { for (const build of value.builds) build.runner.imageVersion = null; },
    (value) => { value.baseline.state = "admitted"; },
    (value) => { value.authors = ["/root", "/root/other"]; },
  ]) {
    const hostile = clone(valid);
    mutate(hostile);
    assert.throws(() => validateNativeAdmissionPayload(canonicalJsonBuffer(hostile)));
  }
  assert.throws(() => validateNativeAdmissionPayload(Buffer.from(`${JSON.stringify(valid)}\n`)), { code: "native_admission_json_noncanonical" });
  assert.throws(() => validateNativeAdmissionPayload(Buffer.alloc(8 * 1024 * 1024 + 1)), { code: "native_admission_payload_size_invalid" });
});

test("review receipts bind the payload, run, closures and original report identity", () => {
  const value = payload();
  const envelope = reviewedEnvelope(value);
  assert.equal(validateReviewedNativeAdmissionProposal(canonicalJsonBuffer(envelope), value).state, "reviewed_admission_proposal");
  for (const mutate of [
    (item) => { item.reviews[0].record.bindings.workflowSha256 = hash("9"); },
    (item) => { item.reviews[0].record.report.sha256 = hash("9"); },
    (item) => { item.reviews[1].reviewerId = item.reviews[0].reviewerId; item.reviews[1].record.reviewerId = item.reviews[0].reviewerId; },
    (item) => { item.reviews[0].reviewerId = "/root"; item.reviews[0].record.reviewerId = "/root"; },
    (item) => { item.reviews[0].record.receiptCommit = item.reviews[0].reviewSource.id; },
    (item) => { item.supportingReviews.push({ path: "../unbound.md", sha256: hash("a"), size: 1 }); },
    (item) => { item.activation.capabilities = ""; },
    (item) => { item.activation.capabilities = { length: 0 }; },
  ]) {
    const hostile = clone(envelope);
    mutate(hostile);
    assert.throws(() => validateReviewedNativeAdmissionProposal(canonicalJsonBuffer(hostile), value));
  }
  assert.throws(() => validateReviewedNativeAdmissionProposal(canonicalJsonBuffer(envelope)), { code: "native_admission_expected_payload_required" });
});
