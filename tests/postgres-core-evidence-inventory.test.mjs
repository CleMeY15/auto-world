import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createPostgresCoreEvidenceInventory, loadPostgresCoreEvidenceInventory,
  postgresCoreEvidenceInventoryLimits, serializePostgresCoreEvidenceInventory,
  validatePostgresCoreEvidenceInventory } from "../scripts/postgres-image/core-evidence-inventory.mjs";
import { compilePostgresCoreEvidenceInventoryPolicy, postgresCoreEvidenceInventoryPolicyContract,
  getPostgresCoreEvidenceLoadedPolicySha256, getPostgresCoreEvidenceRetrievalReferences, getPostgresCoreEvidenceSourceBundleReference,
  loadPostgresCoreEvidenceInventoryPolicy, postgresCoreEvidenceInventoryPolicyLimits,
  validateCompiledPostgresCoreEvidenceInventoryPolicy,
  validateLoadedPostgresCoreEvidenceInventoryPolicy } from "../scripts/postgres-image/core-evidence-inventory-policy.mjs";
import { loadPostgresSourceClosureManifest } from "../scripts/postgres-image/source-closure-manifest.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const clone = value => globalThis.structuredClone(value);

function fixture() {
  const manifest = loadPostgresSourceClosureManifest();
  const materialReferences = manifest.materials.map((material, index) => ({
    id: `material-${String(index).padStart(3, "0")}`,
    group: "DECLARED_SOURCE_MATERIALS_323",
    role: material.role,
    object: {
      sha256: material.expected.sha256 ?? hash(`material:${material.id}`),
      size: material.expected.size ?? index + 1,
      sha512: material.expected.sha512,
      gitBlobSha1: material.expected.gitBlobSha1,
    },
    materialId: material.id,
    historical: false,
    provenance: { kind: "COMPILED_SOURCE_MANIFEST", subject: manifest.subject, identifier: material.id, state: "BYTES_VERIFIED_UNADMITTED" },
  }));
  const shared = { sha256: hash("shared core evidence"), size: 20, sha512: null, gitBlobSha1: null };
  const references = [...materialReferences,
    { id: "final-apk-provides-report", group: "CORE_SUBPROOFS", role: "COVERAGE_OBSERVATION",
      object: { sha256: hash("provides"), size: 8, sha512: null, gitBlobSha1: null }, materialId: null, historical: false,
      provenance: { kind: "COVERAGE_REPORT", subject: manifest.subject, identifier: "apk-provides", state: "OBSERVED" } },
    { id: "historical-cold-receipt", group: "CORE_SUBPROOFS", role: "ROOT_COLD_LOAD_RECEIPT",
      object: { sha256: "a686e2bece45448dd81778eea03083519795bcc49d72c58228fed048ea1f9411", size: 59779, sha512: null, gitBlobSha1: null },
      materialId: null, historical: false,
      provenance: { kind: "NATIVE_RECEIPT", subject: manifest.subject, identifier: "pr121-cold-load", state: "ACCEPTED_HISTORICAL_PROOF" } },
    { id: "historical-sql-receipt", group: "CORE_SUBPROOFS", role: "ROOT_SQL_RESTORE_RECEIPT",
      object: { sha256: "ff8c49950216a2de33f1e3a6566d1be662a4436f7d136ac2a7d252e21ab1c617", size: 81500, sha512: null, gitBlobSha1: null },
      materialId: null, historical: false,
      provenance: { kind: "NATIVE_RECEIPT", subject: manifest.subject, identifier: "pr122-sql-restore", state: "ACCEPTED_HISTORICAL_PROOF" } },
    { id: "proof-current-a", group: "CORE_SUBPROOFS", role: "AUDIT_RECEIPT", object: shared, materialId: null, historical: false,
      provenance: { kind: "NATIVE_RECEIPT", subject: manifest.subject, identifier: "audit-receipt", state: "ACCEPTED_HISTORICAL_PROOF" } },
    { id: "proof-current-b", group: "CORE_SUBPROOFS", role: "RUNTIME_RECEIPT", object: shared, materialId: null, historical: false,
      provenance: { kind: "NATIVE_RECEIPT", subject: manifest.subject, identifier: "runtime-receipt", state: "ACCEPTED_HISTORICAL_PROOF" } },
    { id: "pr129-layer-supervisor", group: "CORE_SUBPROOFS", role: "EXECUTED_DIAGNOSTIC_RECIPE",
      object: { sha256: hash("root recipe"), size: 11, sha512: null, gitBlobSha1: null }, materialId: null, historical: false,
      provenance: { kind: "EXECUTED_RECIPE", subject: manifest.subject, identifier: "layer-supervisor", state: "AUTHENTICATED" } },
    { id: "pr129-layer-worker", group: "CORE_SUBPROOFS", role: "EXECUTED_DIAGNOSTIC_RECIPE",
      object: { sha256: hash("actor recipe"), size: 12, sha512: null, gitBlobSha1: null }, materialId: null, historical: false,
      provenance: { kind: "EXECUTED_RECIPE", subject: manifest.subject, identifier: "layer-worker", state: "AUTHENTICATED" } },
    { id: "source-recipe-bundle", group: "CORE_SUBPROOFS", role: "SOURCE_RECIPE_BUNDLE",
      object: { sha256: hash("source bundle"), size: 13, sha512: null, gitBlobSha1: null }, materialId: null, historical: false,
      provenance: { kind: "VERIFIED_GIT_SOURCE_BUNDLE", subject: manifest.subject,
        identifier: "48950ca1e08e69a571088e9647f3bcfe4143686b", state: "BUNDLE_VERIFIED" } },
    { id: "source-bundle-helper-proof", group: "CORE_SUBPROOFS", role: "SOURCE_RECIPE_BUNDLE_HELPER_PROOF",
      object: { sha256: hash("helper receipt"), size: 14, sha512: null, gitBlobSha1: null }, materialId: null, historical: false,
      provenance: { kind: "VERIFIED_GIT_SOURCE_BUNDLE_HELPER_PROOF", subject: manifest.subject,
        identifier: "48950ca1e08e69a571088e9647f3bcfe4143686b", state: "BUNDLE_VERIFIED" } },
    { id: "proof-old-failure", group: "PRESERVED_HISTORY", role: "FAILED_BATCH_RECEIPT",
      object: { sha256: hash("old failure"), size: 11, sha512: null, gitBlobSha1: null }, materialId: null, historical: true,
      provenance: { kind: "NATIVE_RECEIPT", subject: manifest.subject, identifier: "failed-batch", state: "INCOMPLETE" } },
    { id: "pr124-stderr", group: "PRESERVED_HISTORY", role: "DIAGNOSTIC_STDERR",
      object: { sha256: hash(""), size: 0, sha512: null, gitBlobSha1: null }, materialId: null, historical: true,
      provenance: { kind: "NATIVE_LOG", subject: manifest.subject, identifier: "empty-stderr", state: "PRESERVED" } },
  ].sort((left, right) => left.id.localeCompare(right.id));
  const ids = group => references.filter(item => item.group === group).map(item => item.id);
  const retrievalReferences = references.map((item, index) => ({
    referenceId: item.id,
    path: `/private/evidence/${item.id}`,
    size: item.object.size,
    sha256: item.object.sha256,
    sha512: item.object.sha512,
    gitBlobSha1: item.object.gitBlobSha1,
    ownerProfile: item.id === "final-apk-provides-report" ? "ROOT_TRAVERSABLE_CODE_PARENT"
      : item.id === "pr124-stderr" ? "ROOT_SHARED_PARENT"
      : item.id === "pr129-layer-supervisor" ? "ROOT_PROTECTED_RECIPE"
      : item.id === "pr129-layer-worker" ? "ROOT_ACTOR_PROTECTED_RECIPE"
      : item.id === "historical-cold-receipt" || item.id === "historical-sql-receipt"
      ? "ROOT_PRIVATE" : index % 3 === 0 ? "ROOT_PRIVATE" : index % 3 === 1 ? "ACTOR_PRIVATE" : "IMAGE_PRIVATE",
    nativeIdentity: { dev: "2096", ino: String(10_000 + index),
      uid: item.id === "final-apk-provides-report" || item.id === "pr124-stderr"
        || item.id === "pr129-layer-supervisor" || item.id === "pr129-layer-worker" || item.id === "historical-cold-receipt"
        || item.id === "historical-sql-receipt" || index % 3 === 0 ? 0 : 1000,
      gid: item.id === "pr129-layer-worker" ? 1000
        : item.id === "final-apk-provides-report" || item.id === "pr124-stderr" || item.id === "pr129-layer-supervisor"
          || item.id === "historical-cold-receipt" || item.id === "historical-sql-receipt" || index % 3 === 0
          ? 0 : index % 3 === 1 ? 1000 : 989,
      mode: item.id === "pr129-layer-supervisor" ? 0o400 : item.id === "pr129-layer-worker" ? 0o440 : 0o600,
      nlink: 1, size: item.object.size, mtimeNs: String(20_000 + index), ctimeNs: String(30_000 + index) },
    parentIdentity: { dev: "2096", ino: String(40_000 + index),
      uid: item.id === "pr124-stderr" ? 1000 : item.id === "final-apk-provides-report"
        || item.id === "pr129-layer-supervisor" || item.id === "pr129-layer-worker" ? 0
        : item.id === "historical-cold-receipt" || item.id === "historical-sql-receipt" || index % 3 === 0 ? 0 : 1000,
      gid: item.id === "pr124-stderr" || item.id === "final-apk-provides-report" || item.id === "pr129-layer-worker" ? 1000
        : item.id === "pr129-layer-supervisor" ? 0
        : item.id === "historical-cold-receipt" || item.id === "historical-sql-receipt" || index % 3 === 0 ? 0 : index % 3 === 1 ? 1000 : 989,
      mode: item.id === "pr124-stderr" || item.id === "final-apk-provides-report" || item.id === "pr129-layer-worker" ? 0o750 : 0o700 },
  })).sort((left, right) => left.referenceId.localeCompare(right.referenceId));
  return {
    kind: "POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1",
    subject: manifest.subject,
    references,
    groups: [
      { id: "CORE_SUBPROOFS", role: "CORE_SUBPROOFS", required: true, referenceIds: ids("CORE_SUBPROOFS") },
      { id: "DECLARED_SOURCE_MATERIALS_323", role: "DECLARED_SOURCE_MATERIALS", required: true,
        referenceIds: ids("DECLARED_SOURCE_MATERIALS_323") },
      { id: "PRESERVED_HISTORY", role: "PRESERVED_HISTORY", required: false, referenceIds: ids("PRESERVED_HISTORY") },
    ],
    history: [{ id: "original-incomplete-batch", state: "INCOMPLETE",
      referenceIds: ["pr124-stderr", "proof-old-failure"], reason: "PRESERVED_FAILURE" }],
    laterRequired: ["OFFICIAL_ATTESTATION_BUNDLE", "SECOND_COMPLETE_PRIVATE_COPY"],
    retrieval: { references: retrievalReferences, sourceBundleReferenceId: "source-recipe-bundle",
      sourceBundleProof: { kind: "REVIEWED_SOURCE_BUNDLE_HELPER_PROOF", review: "INDEPENDENTLY_ACCEPTED",
        fsck: "STRICT_FULL", references: 8, state: "BUNDLE_VERIFIED", receiptReferenceId: "source-bundle-helper-proof",
        receiptSha256: hash("helper receipt"), recipeRevision: "48950ca1e08e69a571088e9647f3bcfe4143686b" } },
  };
}

test("authoring policy derives a closed portable catalog that still requires the retriever ACK", () => {
  const policy = compilePostgresCoreEvidenceInventoryPolicy(fixture());
  assert.equal(validateCompiledPostgresCoreEvidenceInventoryPolicy(policy), policy);
  assert.equal(policy.authority, "AUTHORING_TEST_ONLY"); assert.equal(policy.policySha256, null);
  assert.throws(() => validateLoadedPostgresCoreEvidenceInventoryPolicy(policy), /policy_invalid/u);
  assert.deepEqual(policy.manifest, { kind: "POSTGRES_SOURCE_CLOSURE_MATERIALS_V1",
    subject: postgresCoreEvidenceInventoryPolicyContract.subject, materialCount: 323,
    sha256: "3ce9a629c3f9aa037a8ffa4d3ff60c7fe42272937b72cc82e59e04f7ba2358f3" });
  const value = createPostgresCoreEvidenceInventory(policy);
  assert.deepEqual(Object.keys(value), ["kind", "subject", "objects", "references", "groups", "history", "claims"]);
  assert.equal(value.references.length, 334); assert.equal(value.objects.length, 333);
  assert.deepEqual(value.claims, { closure: "CATALOG_COMPLETE_RETRIEVAL_REQUIRED", acceptanceRequiresClosedRetrieverAck: true,
    historicalIntegrity: "PRESERVED_WITHOUT_PROMOTION",
    legalCompliance: "NOT_EVALUATED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED",
    signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    laterRequired: ["OFFICIAL_ATTESTATION_BUNDLE", "SECOND_COMPLETE_PRIVATE_COPY"],
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null });
  const source = value.groups.find(item => item.id === "DECLARED_SOURCE_MATERIALS_323");
  assert.deepEqual(source.counts, { references: 323, objects: 323 });
  assert.equal(source.referenceIds.length, 323); assert.match(source.digest, /^[a-f0-9]{64}$/u);
  const subproofs = value.groups.find(item => item.id === "CORE_SUBPROOFS");
  assert.deepEqual(subproofs.counts, { references: 9, objects: 8 });
  assert.equal(subproofs.referenceBytes, 141377); assert.equal(subproofs.uniqueBytes, 141357);
  assert.equal(value.history[0].state, "INCOMPLETE"); assert.equal(value.references.find(item => item.id === "proof-old-failure").historical, true);
  assert.ok(Object.isFrozen(value.objects)); assert.ok(Object.isFrozen(value.claims));
  assert.equal(getPostgresCoreEvidenceRetrievalReferences(policy).length, 334);
  assert.deepEqual(getPostgresCoreEvidenceSourceBundleReference(policy), {
    referenceId: "source-recipe-bundle", role: "SOURCE_RECIPE_BUNDLE",
    provenance: { kind: "VERIFIED_GIT_SOURCE_BUNDLE", subject: postgresCoreEvidenceInventoryPolicyContract.subject,
      identifier: "48950ca1e08e69a571088e9647f3bcfe4143686b", state: "BUNDLE_VERIFIED" },
    proof: { kind: "REVIEWED_SOURCE_BUNDLE_HELPER_PROOF", review: "INDEPENDENTLY_ACCEPTED",
      fsck: "STRICT_FULL", references: 8, state: "BUNDLE_VERIFIED", receiptReferenceId: "source-bundle-helper-proof",
      receiptSha256: hash("helper receipt"), recipeRevision: "48950ca1e08e69a571088e9647f3bcfe4143686b" },
  });
  assert.equal(Object.hasOwn(value, "retrieval"), false);
  assert.equal(JSON.stringify(value).includes("/private/evidence/"), false);
});

test("canonical loader validates one complete UTF-8 JSON document and exact policy", () => {
  const policy = compilePostgresCoreEvidenceInventoryPolicy(fixture());
  const value = createPostgresCoreEvidenceInventory(policy); const bytes = serializePostgresCoreEvidenceInventory(value, policy);
  assert.deepEqual(loadPostgresCoreEvidenceInventory(bytes, policy), value);
  assert.throws(() => loadPostgresCoreEvidenceInventory(Buffer.from(JSON.stringify(value)), policy), /inventory_invalid/u);
  assert.throws(() => loadPostgresCoreEvidenceInventory(Buffer.concat([bytes, Buffer.from("\n")]), policy), /inventory_invalid/u);
  assert.throws(() => loadPostgresCoreEvidenceInventory(Buffer.from(` ${JSON.stringify(value)}\n`), policy), /inventory_invalid/u);
  assert.throws(() => loadPostgresCoreEvidenceInventory(Buffer.alloc(postgresCoreEvidenceInventoryLimits.inventoryBytes + 1), policy), /inventory_invalid/u);
});

test("policy loader requires independently supplied complete canonical byte identity", () => {
  const specification = fixture(); const bytes = Buffer.from(`${JSON.stringify(specification)}\n`); const sha256 = hash(bytes);
  const policy = loadPostgresCoreEvidenceInventoryPolicy(bytes, sha256);
  assert.equal(validateCompiledPostgresCoreEvidenceInventoryPolicy(policy), policy);
  assert.equal(validateLoadedPostgresCoreEvidenceInventoryPolicy(policy), policy);
  assert.equal(getPostgresCoreEvidenceLoadedPolicySha256(policy), sha256);
  assert.equal(policy.authority, "HASH_LOADED_PRODUCTION");
  assert.throws(() => loadPostgresCoreEvidenceInventoryPolicy(bytes, "0".repeat(64)), /policy_invalid/u);
  assert.throws(() => loadPostgresCoreEvidenceInventoryPolicy(Buffer.from(JSON.stringify(specification)), hash(Buffer.from(JSON.stringify(specification)))), /policy_invalid/u);
  assert.throws(() => loadPostgresCoreEvidenceInventoryPolicy(Buffer.alloc(postgresCoreEvidenceInventoryPolicyLimits.policyBytes + 1), "0".repeat(64)), /policy_invalid/u);
});

test("inventory refuses substitution, omission, extras, duplicate roles and historical promotion", () => {
  const policy = compilePostgresCoreEvidenceInventoryPolicy(fixture()); const value = createPostgresCoreEvidenceInventory(policy);
  for (const mutate of [
    item => { item.objects[0].sha256 = "0".repeat(64); },
    item => { item.objects.pop(); },
    item => { item.objects.push(clone(item.objects[0])); },
    item => { item.references.pop(); },
    item => { item.references.push(clone(item.references[0])); },
    item => { item.references[0].role = "SUBSTITUTED_ROLE"; },
    item => { item.references.find(value => value.historical).historical = false; },
    item => { item.history[0].state = "COMPLETE"; },
    item => { item.groups[0].counts.references += 1; },
    item => { item.groups[0].referenceBytes += 1; },
    item => { item.groups[0].uniqueBytes += 1; },
    item => { item.groups[0].digest = "0".repeat(64); },
    item => { item.groups[0].role = item.groups[1].role; },
    item => { item.claims.closure = "CORE_COMPLETE"; },
    item => { item.claims.acceptanceRequiresClosedRetrieverAck = false; },
    item => { item.claims.admission = "AUTHORIZED"; },
    item => { item.path = "/private/evidence"; },
    item => { item.objects[0].identity = { dev: "1" }; },
  ]) { const changed = clone(value); mutate(changed); assert.throws(() => validatePostgresCoreEvidenceInventory(changed, policy), /inventory_invalid/u); }
});

test("policy refuses missing or substituted manifest material and incoherent groups/history", () => {
  for (const mutate of [
    item => { item.references.find(value => value.materialId !== null).object.sha256 = "0".repeat(64); },
    item => { const value = item.references.find(reference => reference.materialId !== null);
      value.role = value.role === "SOURCE_AUX" ? "SOURCE_PATCH" : "SOURCE_AUX"; },
    item => { item.references.find(value => value.materialId !== null).provenance.kind = "DECLARED_MATERIAL"; },
    item => { item.references.find(value => value.materialId !== null).provenance.subject = "other-subject"; },
    item => { item.references.find(value => value.materialId !== null).provenance.identifier = "other-material"; },
    item => { item.references.find(value => value.materialId !== null).provenance.state = "UNVERIFIED"; },
    item => { item.references.splice(item.references.findIndex(value => value.materialId !== null), 1); },
    item => { const materials = item.references.filter(value => value.materialId !== null); materials[0].materialId = materials[1].materialId; },
    item => { item.groups.find(value => value.id === "DECLARED_SOURCE_MATERIALS_323").role = "OTHER"; },
    item => { item.groups.find(value => value.id === "DECLARED_SOURCE_MATERIALS_323").required = false; },
    item => { item.groups[0].role = item.groups[1].role; },
    item => { item.groups[0].referenceIds.push(item.groups[1].referenceIds[0]); },
    item => { item.references[1].object = { ...item.references[0].object, sha256: item.references[0].object.sha256 }; },
    item => { item.references.find(value => value.historical).historical = false; },
    item => { item.history[0].state = "COMPLETE"; },
    item => { item.history = []; },
    item => { item.laterRequired.reverse(); },
    item => { item.references[0].provenance.path = "/local"; },
    item => { item.retrieval.references.pop(); },
    item => { item.retrieval.references[0].sha256 = "0".repeat(64); },
    item => { item.retrieval.references[0].nativeIdentity.nlink = 2; },
    item => { item.retrieval.references[0].parentIdentity.mode = 0o777; },
    item => { item.retrieval.references[0].path = "/private/../escape"; },
    item => { item.retrieval.sourceBundleReferenceId = "proof-old-failure"; },
    item => { item.references.find(value => value.id === "source-recipe-bundle").role = "OTHER_BUNDLE"; },
    item => { item.references.find(value => value.id === "source-recipe-bundle").provenance.kind = "OTHER_BUNDLE"; },
    item => { item.references.find(value => value.id === "source-recipe-bundle").provenance.subject = "other-subject"; },
    item => { item.references.find(value => value.id === "source-recipe-bundle").provenance.identifier = "short"; },
    item => { item.references.find(value => value.id === "source-recipe-bundle").provenance.state = "UNVERIFIED"; },
    item => { item.retrieval.sourceBundleProof.references = 7; },
    item => { item.retrieval.sourceBundleProof.review = "SELF_ASSERTED"; },
    item => { item.retrieval.sourceBundleProof.receiptReferenceId = "missing-helper-proof"; },
    item => { item.retrieval.sourceBundleProof.receiptSha256 = "0".repeat(64); },
    item => { item.references.find(value => value.id === "source-bundle-helper-proof").role = "OTHER_PROOF"; },
    item => { item.references.find(value => value.id === "source-bundle-helper-proof").object.sha256 = "0".repeat(64); },
    item => { item.references.find(value => value.id === "source-bundle-helper-proof").provenance.kind = "OTHER_PROOF"; },
    item => { item.references.find(value => value.id === "source-bundle-helper-proof").provenance.subject = "other-subject"; },
    item => { item.references.find(value => value.id === "source-bundle-helper-proof").provenance.identifier = "0".repeat(40); },
    item => { item.references.find(value => value.id === "source-bundle-helper-proof").provenance.state = "UNVERIFIED"; },
    item => { item.retrieval.sourceBundleProof.recipeRevision = "0".repeat(40); },
  ]) { const changed = fixture(); mutate(changed); assert.throws(() => compilePostgresCoreEvidenceInventoryPolicy(changed), /policy_invalid/u); }
});

test("authoring may model a partial no-bundle catalog but hash-loaded production refuses it", () => {
  const specification = fixture(); specification.retrieval.sourceBundleReferenceId = null; specification.retrieval.sourceBundleProof = null;
  const policy = compilePostgresCoreEvidenceInventoryPolicy(specification);
  assert.equal(getPostgresCoreEvidenceSourceBundleReference(policy), null);
  assert.equal(createPostgresCoreEvidenceInventory(policy).claims.closure, "CATALOG_COMPLETE_RETRIEVAL_REQUIRED");
  const bytes = Buffer.from(`${JSON.stringify(specification)}\n`);
  assert.throws(() => loadPostgresCoreEvidenceInventoryPolicy(bytes, hash(bytes)), /policy_invalid/u);
});

test("compiled retrieval permits only closed native profiles and literal exceptional reference-role pairs", () => {
  const specification = fixture();
  const root = specification.retrieval.references.find(item => item.referenceId === "historical-cold-receipt");
  root.parentIdentity = { ...root.parentIdentity, uid: 0, gid: 1000, mode: 0o710 };
  assert.doesNotThrow(() => compilePostgresCoreEvidenceInventoryPolicy(specification));
  for (const mutate of [
    item => { item.ownerProfile = "CALLER_SELECTED"; },
    item => { item.nativeIdentity.uid = 0; },
    item => { item.parentIdentity.uid = 0; item.parentIdentity.mode = 0o700; },
  ]) { const changed = fixture(); const target = changed.retrieval.references.find(item => item.ownerProfile === "ACTOR_PRIVATE");
    mutate(target); assert.throws(() => compilePostgresCoreEvidenceInventoryPolicy(changed), /policy_invalid/u); }
  const wrongRole = fixture(); const rootTarget = wrongRole.retrieval.references.find(item => item.referenceId === "historical-cold-receipt");
  wrongRole.references.find(item => item.id === "historical-cold-receipt").role = "ROOT_SQL_RESTORE_RECEIPT";
  rootTarget.parentIdentity = { ...rootTarget.parentIdentity, uid: 0, gid: 1000, mode: 0o710 };
  assert.throws(() => compilePostgresCoreEvidenceInventoryPolicy(wrongRole), /policy_invalid/u);
  const wrongId = fixture(); const renamed = wrongId.references.find(item => item.id === "historical-cold-receipt");
  renamed.id = "caller-cold-receipt";
  const local = wrongId.retrieval.references.find(item => item.referenceId === "historical-cold-receipt"); local.referenceId = renamed.id;
  wrongId.groups[0].referenceIds = wrongId.groups[0].referenceIds.map(id => id === "historical-cold-receipt" ? renamed.id : id).sort();
  local.parentIdentity = { ...local.parentIdentity, uid: 0, gid: 1000, mode: 0o710 };
  assert.throws(() => compilePostgresCoreEvidenceInventoryPolicy(wrongId), /policy_invalid/u);
  for (const [id, role] of [["pr124-stderr", "SUPERVISOR_ACK"], ["final-apk-provides-report", "OTHER_COVERAGE"],
    ["pr129-layer-supervisor", "OTHER_RECIPE"], ["pr129-layer-worker", "OTHER_RECIPE"]]) {
    const changed = fixture(); changed.references.find(item => item.id === id).role = role;
    assert.throws(() => compilePostgresCoreEvidenceInventoryPolicy(changed), /policy_invalid/u);
  }
});

test("compiled authority cannot be reconstructed from JSON and hostile descriptors are not read", () => {
  const specification = fixture(); const policy = compilePostgresCoreEvidenceInventoryPolicy(specification);
  assert.throws(() => validateCompiledPostgresCoreEvidenceInventoryPolicy(clone(policy)), /policy_invalid/u);
  assert.throws(() => createPostgresCoreEvidenceInventory(clone(policy)), /inventory_invalid/u);
  let reads = 0;
  Object.defineProperty(specification.references[0], "role", { enumerable: true, get() { reads += 1; return "SOURCE_ARCHIVE"; } });
  assert.throws(() => compilePostgresCoreEvidenceInventoryPolicy(specification), /policy_invalid/u);
  const symbolSpec = fixture(); symbolSpec.references[0][Symbol("hidden")] = true;
  assert.throws(() => compilePostgresCoreEvidenceInventoryPolicy(symbolSpec), /policy_invalid/u);
  assert.equal(reads, 0);
});
