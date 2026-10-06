import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { compilePostgresCoreEvidenceInventoryPolicy } from "../scripts/postgres-image/core-evidence-inventory-policy.mjs";
import { getPostgresCompletePrivateCopyPolicySha256, getPostgresCompletePrivateCopyReferences,
  loadPostgresCompletePrivateCopyPolicy, postgresCompletePrivateCopyPolicyContract,
  postgresCompletePrivateCopyPolicyLimits, TEST_ONLY_compilePostgresCompletePrivateCopyPolicy,
  TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy,
  validateLoadedPostgresCompletePrivateCopyPolicy } from "../scripts/postgres-image/complete-private-copy-policy.mjs";
import { loadPostgresSourceClosureManifest } from "../scripts/postgres-image/source-closure-manifest.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const clone = value => globalThis.structuredClone(value);

function coreFixture() {
  const manifest = loadPostgresSourceClosureManifest();
  const references = manifest.materials.map((material, index) => ({
    id: `material-${String(index).padStart(3, "0")}`, group: "DECLARED_SOURCE_MATERIALS_323", role: material.role,
    object: { sha256: material.expected.sha256 ?? sha(`material:${material.id}`), size: material.expected.size ?? index + 1,
      sha512: material.expected.sha512, gitBlobSha1: material.expected.gitBlobSha1 }, materialId: material.id, historical: false,
    provenance: { kind: "COMPILED_SOURCE_MANIFEST", subject: manifest.subject, identifier: material.id,
      state: "BYTES_VERIFIED_UNADMITTED" },
  }));
  references.push(
    { id: "source-bundle-helper-proof", group: "CORE_SUBPROOFS", role: "SOURCE_RECIPE_BUNDLE_HELPER_PROOF",
      object: { sha256: sha("proof"), size: 5, sha512: null, gitBlobSha1: null }, materialId: null, historical: false,
      provenance: { kind: "VERIFIED_GIT_SOURCE_BUNDLE_HELPER_PROOF", subject: manifest.subject,
        identifier: "1".repeat(40), state: "BUNDLE_VERIFIED" } },
    { id: "source-recipe-bundle", group: "CORE_SUBPROOFS", role: "SOURCE_RECIPE_BUNDLE",
      object: { sha256: sha("bundle"), size: 6, sha512: null, gitBlobSha1: null }, materialId: null, historical: false,
      provenance: { kind: "VERIFIED_GIT_SOURCE_BUNDLE", subject: manifest.subject,
        identifier: "1".repeat(40), state: "BUNDLE_VERIFIED" } },
  );
  references.sort((left, right) => left.id.localeCompare(right.id));
  const retrieval = references.map((item, index) => ({ referenceId: item.id, path: `/private/core/${item.id}`,
    size: item.object.size, sha256: item.object.sha256, sha512: item.object.sha512, gitBlobSha1: item.object.gitBlobSha1,
    ownerProfile: "ROOT_PRIVATE", nativeIdentity: { dev: "2096", ino: String(1000 + index), uid: 0, gid: 0,
      mode: 0o600, nlink: 1, size: item.object.size, mtimeNs: String(2000 + index), ctimeNs: String(3000 + index) },
    parentIdentity: { dev: "2096", ino: String(4000 + index), uid: 0, gid: 0, mode: 0o700 } }));
  return compilePostgresCoreEvidenceInventoryPolicy({ kind: "POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1",
    subject: manifest.subject, references,
    groups: [
      { id: "CORE_SUBPROOFS", role: "CORE_SUBPROOFS", required: true,
        referenceIds: ["source-bundle-helper-proof", "source-recipe-bundle"] },
      { id: "DECLARED_SOURCE_MATERIALS_323", role: "DECLARED_SOURCE_MATERIALS", required: true,
        referenceIds: references.filter(item => item.group === "DECLARED_SOURCE_MATERIALS_323").map(item => item.id) },
    ], history: [], laterRequired: ["OFFICIAL_ATTESTATION_BUNDLE", "SECOND_COMPLETE_PRIVATE_COPY"],
    retrieval: { references: retrieval, sourceBundleReferenceId: "source-recipe-bundle",
      sourceBundleProof: { kind: "REVIEWED_SOURCE_BUNDLE_HELPER_PROOF", review: "INDEPENDENTLY_ACCEPTED",
        fsck: "STRICT_FULL", references: 8, state: "BUNDLE_VERIFIED", receiptReferenceId: "source-bundle-helper-proof",
        receiptSha256: sha("proof"), recipeRevision: "1".repeat(40) } } });
}

function supplementalReference(groupId, index, changes = {}) {
  const profile = index === 6
    ? { ownerProfile: "ACTOR_EXECUTABLE_PRIVATE", file: [1000, 1000, 0o700], parent: [1000, 1000, 0o700] }
    : index === 7
      ? { ownerProfile: "ROOT_EXECUTABLE", file: [0, 0, 0o755], parent: [0, 0, 0o755] }
      : { ownerProfile: "ROOT_PRIVATE", file: [0, 0, 0o600], parent: [0, 0, 0o700] };
  const size = index + 1;
  return { referenceId: `supplement-${String(index).padStart(2, "0")}`, groupId, role: `REVIEWED_OBJECT_${index}`,
    path: `/private/supplement/${index}`, size, sha256: sha(`supplement:${index}`), sha512: null, gitBlobSha1: null,
    ownerProfile: profile.ownerProfile,
    nativeIdentity: { dev: "2096", ino: String(5000 + index), uid: profile.file[0], gid: profile.file[1],
      mode: profile.file[2], nlink: 1, size, mtimeNs: String(6000 + index), ctimeNs: String(7000 + index) },
    parentIdentity: { dev: "2096", ino: String(8000 + index), uid: profile.parent[0], gid: profile.parent[1],
      mode: profile.parent[2] }, ...changes };
}

function fixture() {
  const references = postgresCompletePrivateCopyPolicyContract.requiredGroupIds.map((groupId, index) => supplementalReference(groupId, index));
  return { kind: postgresCompletePrivateCopyPolicyContract.kind, subject: postgresCompletePrivateCopyPolicyContract.subject,
    corePolicySha256: postgresCompletePrivateCopyPolicyContract.corePolicySha256,
    coreReferenceDigest: postgresCompletePrivateCopyPolicyContract.coreReferenceDigest,
    coreReferenceCount: postgresCompletePrivateCopyPolicyContract.coreReferenceCount,
    supplementalAcceptance: clone(postgresCompletePrivateCopyPolicyContract.supplementalAcceptance),
    groups: postgresCompletePrivateCopyPolicyContract.requiredGroupIds.map((groupId, index) => ({
      groupId, referenceIds: [references[index].referenceId],
    })), references };
}

test("TEST_ONLY compiler builds a frozen combined catalog while production validation rejects authoring authority", () => {
  const core = coreFixture();
  const policy = TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(fixture(), core);
  assert.equal(TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy(policy), policy);
  assert.equal(policy.authority, "AUTHORING_TEST_ONLY");
  assert.equal(policy.corePolicy, core);
  assert.equal(policy.groups.length, 8);
  assert.equal(policy.references.length, core.references.length + 8);
  assert.deepEqual(Object.keys(policy.references[0]), ["referenceId", "groupId", "role", "path", "size", "sha256",
    "sha512", "gitBlobSha1", "ownerProfile", "nativeIdentity", "parentIdentity"]);
  assert.equal(policy.references[0].groupId, "CORE");
  assert.ok(Object.isFrozen(policy)); assert.ok(Object.isFrozen(policy.references));
  assert.throws(() => validateLoadedPostgresCompletePrivateCopyPolicy(policy), /policy_invalid/u);
  assert.throws(() => TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy(clone(policy)), /policy_invalid/u);
  assert.throws(() => getPostgresCompletePrivateCopyReferences(policy), /policy_invalid/u);
  assert.throws(() => getPostgresCompletePrivateCopyPolicySha256(policy), /policy_invalid/u);
});

test("production loader authenticates the external SHA before accepting JSON and rejects non-authentic core capabilities", () => {
  const specification = fixture(); const bytes = Buffer.from(`${JSON.stringify(specification)}\n`);
  assert.throws(() => loadPostgresCompletePrivateCopyPolicy(Buffer.from("not-json\n"), "0".repeat(64), coreFixture()), /policy_invalid/u);
  assert.throws(() => loadPostgresCompletePrivateCopyPolicy(bytes, "0".repeat(64), coreFixture()), /policy_invalid/u);
  assert.throws(() => loadPostgresCompletePrivateCopyPolicy(bytes, sha(bytes), coreFixture()), /policy_invalid/u);
  assert.throws(() => loadPostgresCompletePrivateCopyPolicy(Buffer.from(JSON.stringify(specification)),
    sha(Buffer.from(JSON.stringify(specification))), coreFixture()), /policy_invalid/u);
  assert.throws(() => loadPostgresCompletePrivateCopyPolicy(Buffer.alloc(postgresCompletePrivateCopyPolicyLimits.policyBytes + 1),
    "0".repeat(64), coreFixture()), /policy_invalid/u);
});

test("closed policy shape rejects missing, extra, accessor, alternate prototype and sparse values", () => {
  const core = coreFixture();
  for (const mutate of [
    value => { delete value.subject; }, value => { value.extra = true; },
    value => { Object.defineProperty(value, "subject", { enumerable: true, get: () => postgresCompletePrivateCopyPolicyContract.subject }); },
    value => { Object.setPrototypeOf(value, null); }, value => { delete value.groups[0]; },
    value => { value.references[0].extra = true; }, value => { Object.setPrototypeOf(value.references[0], null); },
  ]) {
    const changed = fixture(); mutate(changed);
    assert.throws(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(changed, core), /policy_invalid/u);
  }
});

test("fixed core and supplemental bindings cannot be authored by candidate input", () => {
  const core = coreFixture();
  for (const mutate of [
    value => { value.corePolicySha256 = "0".repeat(64); }, value => { value.coreReferenceDigest = "0".repeat(64); },
    value => { value.coreReferenceCount = 495; }, value => { value.supplementalAcceptance.size += 1; },
    value => { value.supplementalAcceptance.sha256 = "0".repeat(64); },
  ]) {
    const changed = fixture(); mutate(changed);
    assert.throws(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(changed, core), /policy_invalid/u);
  }
});

test("required groups are exact, ordered, nonempty and cover each supplemental reference once", () => {
  const core = coreFixture();
  for (const mutate of [
    value => { value.groups.pop(); }, value => { [value.groups[0], value.groups[1]] = [value.groups[1], value.groups[0]]; },
    value => { value.groups[0].referenceIds = []; }, value => { value.groups[0].referenceIds.push(value.groups[1].referenceIds[0]); },
    value => { value.references[0].groupId = value.groups[1].groupId; }, value => { value.references.pop(); },
    value => { value.references[0].referenceId = core.references[0].id; },
  ]) {
    const changed = fixture(); mutate(changed);
    assert.throws(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(changed, core), /policy_invalid/u);
  }
});

test("reference identities reject bad paths, hashes, sizes, profiles and native seals", () => {
  const core = coreFixture();
  for (const mutate of [
    value => { value.references[0].path = "/private/../escape"; }, value => { value.references[0].path = value.references[1].path; },
    value => { value.references[0].sha256 = "A".repeat(64); }, value => { value.references[0].sha512 = "0".repeat(127); },
    value => { value.references[0].gitBlobSha1 = "0".repeat(39); }, value => { value.references[0].size = 1024 ** 3 + 1; },
    value => { value.references[0].ownerProfile = "ARBITRARY"; }, value => { value.references[0].nativeIdentity.nlink = 2; },
    value => { value.references[0].nativeIdentity.mode = 0o644; }, value => { value.references[0].parentIdentity.mode = 0o755; },
    value => { value.references[0].role = "free form"; },
  ]) {
    const changed = fixture(); mutate(changed);
    assert.throws(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(changed, core), /policy_invalid/u);
  }
});

test("duplicate objects retain logical references only when size and non-null secondary identities agree", () => {
  const core = coreFixture(); const accepted = fixture();
  accepted.references[1].sha256 = accepted.references[0].sha256;
  accepted.references[1].size = accepted.references[0].size;
  accepted.references[1].nativeIdentity.size = accepted.references[0].size;
  assert.doesNotThrow(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(accepted, core));
  for (const mutate of [
    value => { value.references[1].size += 1; value.references[1].nativeIdentity.size += 1; },
    value => { value.references[0].sha512 = "1".repeat(128); value.references[1].sha512 = "2".repeat(128); },
    value => { value.references[0].gitBlobSha1 = "1".repeat(40); value.references[1].gitBlobSha1 = "2".repeat(40); },
  ]) {
    const changed = clone(accepted); mutate(changed);
    assert.throws(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(changed, core), /policy_invalid/u);
  }
  const threeWay = clone(accepted);
  threeWay.references[0].sha512 = null;
  threeWay.references[1].sha512 = "1".repeat(128);
  threeWay.references[2].sha256 = threeWay.references[0].sha256;
  threeWay.references[2].size = threeWay.references[0].size;
  threeWay.references[2].nativeIdentity.size = threeWay.references[0].size;
  threeWay.references[2].sha512 = "2".repeat(128);
  assert.throws(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(threeWay, core), /policy_invalid/u);
  const coreConflict = fixture();
  coreConflict.references[0].sha256 = core.retrieval.references[0].sha256;
  assert.throws(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(coreConflict, core), /policy_invalid/u);
  const corePathConflict = fixture();
  corePathConflict.references[0].path = core.retrieval.references[0].path;
  assert.throws(() => TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(corePathConflict, core), /policy_invalid/u);
});

test("only the two reviewed executable owner-profile extensions are accepted", () => {
  const policy = TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(fixture(), coreFixture());
  const actor = policy.references.find(item => item.ownerProfile === "ACTOR_EXECUTABLE_PRIVATE");
  const root = policy.references.find(item => item.ownerProfile === "ROOT_EXECUTABLE");
  assert.deepEqual([actor.nativeIdentity.uid, actor.nativeIdentity.gid, actor.nativeIdentity.mode], [1000, 1000, 0o700]);
  assert.deepEqual([root.nativeIdentity.uid, root.nativeIdentity.gid, root.nativeIdentity.mode], [0, 0, 0o755]);
});
