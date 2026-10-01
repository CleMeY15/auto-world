import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { loadPostgresSourceClosureManifest } from "../scripts/postgres-image/source-closure-manifest.mjs";
import { compilePostgresCoreEvidenceInventoryPolicy, loadPostgresCoreEvidenceInventoryPolicy,
  getPostgresCoreEvidenceRetrievalReferences } from "../scripts/postgres-image/core-evidence-inventory-policy.mjs";
import { createPostgresCoreEvidenceInventory, serializePostgresCoreEvidenceInventory } from "../scripts/postgres-image/core-evidence-inventory.mjs";
import { retrievePostgresCoreEvidence, TEST_ONLY_retrievePostgresCoreEvidence, postgresCoreEvidenceRetrievalFailureDiagnostic,
  validatePostgresCoreEvidenceRetrievalFailureDiagnostic, validatePostgresCoreEvidenceRetrievalReceipt,
  validatePostgresCoreEvidenceRetrievalAcknowledgement, postgresCoreEvidenceRetrievalLimits } from "../scripts/postgres-image/core-evidence-retriever.mjs";

const nativeRoot = process.platform === "linux" && process.getuid() === 0 && process.geteuid() === 0 && process.getgid() === 0 && process.getegid() === 0;
const sha = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex");
const native = file => { const s = fs.lstatSync(file, { bigint: true }); return { dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n),
  nlink: Number(s.nlink), size: Number(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }; };
const directoryNative = file => Object.fromEntries(["dev", "ino", "uid", "gid", "mode"].map(key => [key, native(file)[key]]));
function policySpec(extra = []) {
  const manifest = loadPostgresSourceClosureManifest();
  const references = manifest.materials.map((material, index) => ({ id: `material-${String(index).padStart(3, "0")}`, group: "DECLARED_SOURCE_MATERIALS_323",
    role: material.role, object: { sha256: material.expected.sha256 ?? sha(`unused-declaration:${material.id}`), size: material.expected.size ?? index + 1,
      sha512: material.expected.sha512, gitBlobSha1: material.expected.gitBlobSha1 }, materialId: material.id, historical: false,
    provenance: { kind: "COMPILED_SOURCE_MANIFEST", subject: manifest.subject, identifier: material.id, state: "BYTES_VERIFIED_UNADMITTED" } }));
  const local = references.map((ref, index) => ({ referenceId: ref.id, path: `/not-opened-fixture-declarations/${ref.id}`, ...ref.object, ownerProfile: "ROOT_PRIVATE",
    nativeIdentity: { dev: "1", ino: String(10000 + index), uid: 0, gid: 0, mode: 0o600, nlink: 1, size: ref.object.size, mtimeNs: "1", ctimeNs: "1" },
    parentIdentity: { dev: "1", ino: "2", uid: 0, gid: 0, mode: 0o700 } }));
  const groups = [{ id: "DECLARED_SOURCE_MATERIALS_323", role: "DECLARED_SOURCE_MATERIALS", required: true, referenceIds: references.map(ref => ref.id) }];
  if (extra.length) { groups.push({ id: "FIXTURE_ONLY", role: "FIXTURE_ONLY", required: true, referenceIds: extra.map(ref => ref.referenceId).sort() });
    for (const ref of extra) { const object = { sha256: ref.sha256, size: ref.size, sha512: ref.sha512, gitBlobSha1: ref.gitBlobSha1 };
      references.push({ id: ref.referenceId, group: "FIXTURE_ONLY", role: ref.role ?? "HARMLESS_NATIVE_FIXTURE", object, materialId: null, historical: false,
        provenance: { kind: "HARMLESS_FIXTURE", subject: manifest.subject, identifier: ref.referenceId, state: "PARTIAL_TEST_ONLY" } });
      const binding = Object.fromEntries(Object.entries(ref).filter(([key]) => key !== "role")); local.push(binding); } }
  return { kind: "POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1", subject: manifest.subject, references: references.sort((a, b) => a.id.localeCompare(b.id)),
    groups: groups.sort((a, b) => a.id.localeCompare(b.id)), history: [], laterRequired: ["OFFICIAL_ATTESTATION_BUNDLE", "SECOND_COMPLETE_PRIVATE_COPY"],
    retrieval: { references: local.sort((a, b) => a.referenceId.localeCompare(b.referenceId)), sourceBundleReferenceId: null, sourceBundleProof: null } };
}
function bundleSpecification(specification, referenceId) {
  const reference = specification.references.find(ref => ref.id === referenceId);
  reference.role = "SOURCE_RECIPE_BUNDLE";
  reference.provenance = { kind: "VERIFIED_GIT_SOURCE_BUNDLE", subject: specification.subject, identifier: "a".repeat(40), state: "BUNDLE_VERIFIED" };
  const helper = { id: "fixture-bundle-proof", group: "FIXTURE_ONLY", role: "SOURCE_RECIPE_BUNDLE_HELPER_PROOF",
    object: { sha256: sha("unopened structural helper proof"), size: 32, sha512: null, gitBlobSha1: null }, materialId: null, historical: false,
    provenance: { kind: "VERIFIED_GIT_SOURCE_BUNDLE_HELPER_PROOF", subject: specification.subject, identifier: "a".repeat(40), state: "BUNDLE_VERIFIED" } };
  specification.references.push(helper); specification.references.sort((a, b) => a.id.localeCompare(b.id));
  let group = specification.groups.find(item => item.id === "FIXTURE_ONLY");
  if (!group) { group = { id: "FIXTURE_ONLY", role: "FIXTURE_ONLY", required: true, referenceIds: [] }; specification.groups.push(group);
    specification.groups.sort((a, b) => a.id.localeCompare(b.id)); }
  group.referenceIds.push(helper.id); group.referenceIds.sort();
  specification.retrieval.references.push({ referenceId: helper.id, path: "/unopened-fixture/helper-proof.json", ...helper.object,
    ownerProfile: "ROOT_PRIVATE", nativeIdentity: { dev: "1", ino: "20000", uid: 0, gid: 0, mode: 0o600, nlink: 1, size: helper.object.size, mtimeNs: "1", ctimeNs: "1" },
    parentIdentity: { dev: "1", ino: "2", uid: 0, gid: 0, mode: 0o700 } });
  specification.retrieval.references.sort((a, b) => a.referenceId.localeCompare(b.referenceId));
  specification.retrieval.sourceBundleReferenceId = referenceId;
  specification.retrieval.sourceBundleProof = { kind: "REVIEWED_SOURCE_BUNDLE_HELPER_PROOF", review: "INDEPENDENTLY_ACCEPTED",
    fsck: "STRICT_FULL", references: 8, state: "BUNDLE_VERIFIED", receiptReferenceId: helper.id, receiptSha256: helper.object.sha256, recipeRevision: "a".repeat(40) };
  return specification;
}
const input = policy => { const nonce = randomBytes(12).toString("hex"); return { policy, directory: `/var/tmp/pg-core-evidence-${nonce}`,
  executionId: `local-core-evidence-${nonce}`, recipeRevision: "a".repeat(40) }; };
function removeOwnedTree(file) {
  const root = path.resolve(file); assert.ok(root.startsWith("/var/tmp/pg-core-evidence-") || root.startsWith("/var/tmp/aw-core-fixture-"));
  const stat = fs.lstatSync(root); assert.equal(stat.isSymbolicLink(), false); assert.equal(stat.isDirectory(), true); fs.rmSync(root, { recursive: true, force: false });
}
function scope(t) {
  const root = fs.mkdtempSync("/var/tmp/aw-core-fixture-"); fs.chmodSync(root, 0o700); const refs = [];
  for (const [index, uid, gid, profile, content] of [[0, 0, 0, "ROOT_PRIVATE", Buffer.from("root fixture")],
    [1, 1000, 1000, "ACTOR_PRIVATE", Buffer.from("actor fixture")], [2, 1000, 989, "IMAGE_PRIVATE", Buffer.alloc(0)]]) {
    const directory = path.join(root, `source${index}`); fs.mkdirSync(directory, { mode: 0o700 }); fs.chownSync(directory, uid, gid); fs.chmodSync(directory, 0o700);
    const file = path.join(directory, "source.dat"); fs.writeFileSync(file, content, { flag: "wx", mode: 0o600 }); fs.chownSync(file, uid, gid); fs.chmodSync(file, 0o600);
    refs.push({ referenceId: `fixture-${index}`, path: file, size: content.length, sha256: sha(content), sha512: sha(content, "sha512"),
      gitBlobSha1: createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex"), ownerProfile: profile,
      nativeIdentity: native(file), parentIdentity: directoryNative(directory) });
  }
  const value = input(compilePostgresCoreEvidenceInventoryPolicy(policySpec(refs)));
  t.after(() => { for (const file of [value.directory, root]) if (fs.existsSync(file)) removeOwnedTree(file); });
  return { root, refs, input: value, options: { referenceIds: refs.map(ref => ref.referenceId), hooks: {} } };
}
const diagnostic = error => postgresCoreEvidenceRetrievalFailureDiagnostic(error);
async function refused(promise, code, cleanup = "CONFIRMED") { let failure; await assert.rejects(promise, error => { failure = diagnostic(error); return true; });
  assert.equal(failure.code, "postgres_core_evidence_retrieval_" + code); assert.equal(failure.cleanup, cleanup); return failure; }

test("FULL rejects caller overrides, uncompiled policy and accessor controls before any native read", async () => {
  const policy = compilePostgresCoreEvidenceInventoryPolicy(policySpec()); const value = input(policy); let reads = 0;
  await refused(retrievePostgresCoreEvidence(value, {}, { policy }), "arguments_invalid");
  await refused(retrievePostgresCoreEvidence(value), "policy_invalid");
  await refused(retrievePostgresCoreEvidence({ ...value, policy: globalThis.structuredClone(policy) }), "policy_invalid");
  const control = Object.defineProperty({}, "result", { enumerable: true, get() { reads++; return () => {}; } });
  await refused(retrievePostgresCoreEvidence(value, control), "arguments_invalid");
  await refused(retrievePostgresCoreEvidence({ ...value, directory: "/var/tmp/wrong-scope" }), "arguments_invalid");
  await refused(TEST_ONLY_retrievePostgresCoreEvidence(value), "arguments_invalid");
  const aborted = new globalThis.AbortController(); aborted.abort(); await refused(retrievePostgresCoreEvidence({ ...value, signal: aborted.signal }), "aborted");
  assert.equal(reads, 0); if (process.platform === "linux") assert.equal(fs.existsSync(value.directory), false);
});
test("FULL requires independently hash-loaded policy and refuses missing or arbitrary-role source bundle before retrieval", () => {
  const specification = policySpec(), bytes = Buffer.from(JSON.stringify(specification) + "\n");
  assert.throws(() => loadPostgresCoreEvidenceInventoryPolicy(bytes, sha(bytes)));
  const id = specification.references[0].id; bundleSpecification(specification, id);
  specification.references.find(ref => ref.id === id).role = "ARBITRARY_ARCHIVE";
  const wrongRole = Buffer.from(JSON.stringify(specification) + "\n");
  assert.throws(() => loadPostgresCoreEvidenceInventoryPolicy(wrongRole, sha(wrongRole)));
  assert.throws(() => loadPostgresCoreEvidenceInventoryPolicy(wrongRole, "0".repeat(64)));
});
test("pure structure binds independent policy hash, provisional receipt and closed ACK without claiming native fixture retrieval", () => {
  const content = Buffer.from("opaque fixture bundle"), directoryIdentity = { dev: "1", ino: "9000", uid: 0, gid: 0, mode: 0o700 };
  const sample = { referenceId: "fixture-bundle", path: "/unopened-fixture/source/recipes.bundle", size: content.length,
    sha256: sha(content), sha512: null, gitBlobSha1: null, ownerProfile: "ACTOR_PRIVATE",
    nativeIdentity: { dev: "1", ino: "3", uid: 1000, gid: 1000, mode: 0o600, nlink: 1, size: content.length, mtimeNs: "1", ctimeNs: "1" },
    parentIdentity: { dev: "1", ino: "4", uid: 1000, gid: 1000, mode: 0o700 } };
  const specification = bundleSpecification(policySpec([sample]), sample.referenceId), policyBytes = Buffer.from(JSON.stringify(specification) + "\n");
  const policy = loadPostgresCoreEvidenceInventoryPolicy(policyBytes, sha(policyBytes)), value = input(policy), refs = getPostgresCoreEvidenceRetrievalReferences(policy);
  const inventory = serializePostgresCoreEvidenceInventory(createPostgresCoreEvidenceInventory(policy), policy);
  const claims = { authority: "LOCAL_DIAGNOSTIC_ROOT_RETRIEVAL", trustBoundary: "TRUSTED_ADMIN_ROOT_KERNEL", hostileSameUidIsolation: "NOT_CLAIMED",
    offHostImmutability: "NOT_CLAIMED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED", signing: "NOT_ATTEMPTED",
    admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    closure: "CATALOG_COMPLETE_RETRIEVAL_REQUIRED", acceptanceRequiresClosedRetrieverAck: true, selectedReferencesOnly: false };
  const identity = (size, ino) => ({ dev: "1", ino, uid: 0, gid: 0, mode: 0o600, nlink: 1, size, mtimeNs: "1", ctimeNs: "1" });
  const bundle = { name: "source/recipes.bundle", size: sample.size, sha256: sample.sha256, identity: identity(sample.size, "5") };
  const receipt = { kind: "POSTGRES_CORE_EVIDENCE_RETRIEVAL_RECEIPT_V1", state: "PUBLISHED_AWAITING_RETRIEVAL_ACK",
    executionId: value.executionId, recipeRevision: value.recipeRevision, directory: value.directory, subject: policy.subject, policySha256: sha(policyBytes),
    references: refs, claims, inventory: { name: "inventory.json", size: inventory.length, sha256: sha(inventory) }, sourceUnchanged: true,
    descriptorClosure: "REQUIRED_BEFORE_ACK", phases: ["POLICY", "REFERENCES", "INVENTORY", "PUBLISH", "FINAL_SEAL"], directoryIdentity,
    inventoryIdentity: identity(inventory.length, "6"), bundle };
  assert.equal(validatePostgresCoreEvidenceRetrievalReceipt(receipt, value).claims.closure, "CATALOG_COMPLETE_RETRIEVAL_REQUIRED");
  const receiptBytes = Buffer.from(JSON.stringify(receipt) + "\n");
  const ack = { kind: "POSTGRES_CORE_EVIDENCE_RETRIEVAL_ACK_V1", state: "RETRIEVED", executionId: value.executionId,
    recipeRevision: value.recipeRevision, directory: value.directory, subject: policy.subject, policySha256: sha(policyBytes), directoryIdentity,
    inventory: { ...receipt.inventory, identity: receipt.inventoryIdentity }, receipt: { name: "receipt.json", size: receiptBytes.length,
      sha256: sha(receiptBytes), identity: identity(receiptBytes.length, "7") }, bundle,
    references: { count: refs.length, bytes: refs.reduce((sum, ref) => sum + ref.size, 0), digest: sha(Buffer.from(JSON.stringify(refs) + "\n")) },
    sourceUnchanged: true, descriptorsClosed: true, claims: { ...claims, closure: "CORE_COMPLETE" } };
  assert.equal(validatePostgresCoreEvidenceRetrievalAcknowledgement(ack, value).claims.closure, "CORE_COMPLETE");
  for (const mutate of [v => { v.policySha256 = "0".repeat(64); }, v => { v.claims.closure = "CORE_COMPLETE"; },
    v => { v.descriptorClosure = "CLOSED"; }, v => { v.claims.acceptanceRequiresClosedRetrieverAck = false; }]) {
    const bad = globalThis.structuredClone(receipt); mutate(bad); assert.throws(() => validatePostgresCoreEvidenceRetrievalReceipt(bad, value)); }
  for (const mutate of [v => { v.policySha256 = "0".repeat(64); }, v => { v.descriptorsClosed = false; },
    v => { v.receipt.sha256 = "0".repeat(64); }, v => { v.bundle = null; }, v => { v.inventory.sha256 = "0".repeat(64); },
    v => { v.bundle.identity.ino = sample.nativeIdentity.ino; }, v => { v.receipt.identity.ino = v.inventory.identity.ino; }]) {
    const bad = globalThis.structuredClone(ack); mutate(bad); assert.throws(() => validatePostgresCoreEvidenceRetrievalAcknowledgement(bad, value)); }
  let reads = 0; const accessorInput = Object.defineProperty({ ...value }, "policy", { enumerable: true, get() { reads++; return policy; } });
  assert.throws(() => validatePostgresCoreEvidenceRetrievalReceipt(receipt, accessorInput));
  assert.throws(() => validatePostgresCoreEvidenceRetrievalAcknowledgement(ack, accessorInput)); assert.equal(reads, 0);
});
test("untrusted diagnostics never read message, phase or cleanup getters; contradictory closed diagnostic refuses", () => {
  let reads = 0; const unknown = {};
  for (const key of ["message", "phase", "cleanup"]) Object.defineProperty(unknown, key, { get() { reads++; throw new Error("PRIVATE_DATA"); } });
  assert.deepEqual(diagnostic(unknown), { code: "postgres_core_evidence_retrieval_operation_failed", phase: "CONTEXT", cleanup: "UNVERIFIED" }); assert.equal(reads, 0);
  assert.throws(() => validatePostgresCoreEvidenceRetrievalFailureDiagnostic({ code: "postgres_core_evidence_retrieval_cleanup_uncertain", phase: "CLEANUP", cleanup: "CONFIRMED" }));
  assert.equal(validatePostgresCoreEvidenceRetrievalFailureDiagnostic({ code: "postgres_core_evidence_retrieval_cleanup_uncertain", phase: "CLEANUP", cleanup: "UNVERIFIED" }).cleanup, "UNVERIFIED");
});
test("native partial reads three actual owner profiles including SHA512/Git blob/zero-byte EOF and publishes durable private metadata", { skip: !nativeRoot }, async t => {
  const fixture = scope(t), before = fixture.refs.map(ref => native(ref.path)); let callbacks = 0;
  const result = await TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, { result(value) { callbacks++; assert.equal(value.descriptorsClosed, true); } }, fixture.options);
  assert.equal(result.state, "PARTIAL_ROOT_RETRIEVAL_PROOF"); assert.equal(result.claims.closure, "NOT_ESTABLISHED"); assert.equal(result.claims.selectedReferencesOnly, true);
  assert.equal(callbacks, 1); assert.deepEqual(fixture.refs.map(ref => native(ref.path)), before); assert.equal(result.references.count, 3);
  assert.deepEqual(fs.readdirSync(fixture.input.directory).sort(), ["inventory.json", "receipt.json"]); assert.equal(native(fixture.input.directory).mode, 0o700);
  for (const proof of [result.inventory, result.receipt]) { const file = path.join(fixture.input.directory, proof.name); assert.equal(native(file).mode, 0o600); assert.equal(native(file).nlink, 1);
    assert.equal(sha(fs.readFileSync(file)), proof.sha256); assert.equal(native(file).uid, 0); }
  const receipt = JSON.parse(fs.readFileSync(path.join(fixture.input.directory, "receipt.json"))); assert.equal(receipt.claims.closure, "NOT_ESTABLISHED");
  assert.equal(receipt.descriptorClosure, "REQUIRED_BEFORE_ACK"); assert.equal(receipt.claims.acceptanceRequiresClosedRetrieverAck, true);
  assert.equal(receipt.policySha256, null); assert.equal(result.policySha256, null);
  assert.equal(JSON.stringify(result).includes(fixture.refs[0].path), false);
});
test("native refuses changed source bytes, symlink, modes, owner and inode substitution before publishing", { skip: !nativeRoot }, async t => {
  for (const mutate of [
    f => fs.writeFileSync(f.refs[0].path, "wrong bytes"),
    f => { fs.renameSync(f.refs[0].path, f.refs[0].path + ".old"); fs.symlinkSync(f.refs[0].path + ".old", f.refs[0].path); },
    f => fs.chmodSync(f.refs[0].path, 0o644),
    f => fs.chownSync(f.refs[0].path, 1000, 1000),
    f => { const bytes = fs.readFileSync(f.refs[0].path); fs.renameSync(f.refs[0].path, f.refs[0].path + ".old"); fs.writeFileSync(f.refs[0].path, bytes, { flag: "wx", mode: 0o600 }); },
  ]) { const fixture = scope(t); mutate(fixture); await assert.rejects(TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, {}, fixture.options)); assert.equal(fs.existsSync(fixture.input.directory), false); }
});
test("native mutation during final seal refuses and retires only our receipt while retaining inventory and originals", { skip: !nativeRoot }, async t => {
  const fixture = scope(t); fixture.options.hooks.afterPublication = () => fs.writeFileSync(fixture.refs[1].path, "changed fixture");
  await refused(TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, {}, fixture.options), "file_changed");
  assert.equal(fs.existsSync(path.join(fixture.input.directory, "receipt.json")), false); assert.equal(fs.existsSync(path.join(fixture.input.directory, "inventory.json")), true);
  assert.equal(fs.readFileSync(fixture.refs[1].path, "utf8"), "changed fixture");
});
test("native late writer rejection retires same-inode edited receipt and preserves payloads", { skip: !nativeRoot }, async t => {
  const fixture = scope(t);
  await refused(TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, { result() { const receipt = path.join(fixture.input.directory, "receipt.json");
    fs.writeFileSync(receipt, "edited in place"); throw new Error("PRIVATE_CALLBACK_TEXT"); } }, fixture.options), "output_failed");
  assert.equal(fs.existsSync(path.join(fixture.input.directory, "receipt.json")), false); assert.equal(fs.existsSync(path.join(fixture.input.directory, "inventory.json")), true);
});
test("native foreign receipt substitution is preserved with cleanup uncertain", { skip: !nativeRoot }, async t => {
  const fixture = scope(t); const foreign = Buffer.from("foreign-owned replacement");
  await refused(TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, { result() { const file = path.join(fixture.input.directory, "receipt.json");
    fs.renameSync(file, file + ".original"); fs.writeFileSync(file, foreign, { flag: "wx", mode: 0o600 }); throw new Error("writer failed"); } }, fixture.options), "cleanup_uncertain", "UNVERIFIED");
  assert.equal(fs.readFileSync(path.join(fixture.input.directory, "receipt.json")).equals(foreign), true);
});
test("native partial bundle copy is byte-identical, disjoint and makes no Git-validation claim", { skip: !nativeRoot }, async t => {
  const fixture = scope(t), specification = bundleSpecification(policySpec(fixture.refs), fixture.refs[1].referenceId);
  fixture.input.policy = compilePostgresCoreEvidenceInventoryPolicy(specification);
  const result = await TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, {}, fixture.options);
  const copy = path.join(fixture.input.directory, "source/recipes.bundle"); assert.ok(result.bundle); assert.equal(result.bundle.identity.uid, 0);
  assert.equal(fs.readFileSync(copy).equals(fs.readFileSync(fixture.refs[1].path)), true); assert.notEqual(native(copy).ino, fixture.refs[1].nativeIdentity.ino);
  assert.equal(result.claims.closure, "NOT_ESTABLISHED"); assert.equal(JSON.stringify(result).includes("OFFLINE_FULL_FSCK"), false);
});
test("native unstable output parent preserves state and cannot return an acknowledgement", { skip: !nativeRoot }, async t => {
  const fixture = scope(t), moved = fixture.input.directory + ".moved";
  t.after(() => { if (fs.existsSync(moved)) removeOwnedTree(moved); });
  fixture.options.hooks.afterPublication = () => fs.renameSync(fixture.input.directory, moved);
  await refused(TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, {}, fixture.options), "cleanup_uncertain", "UNVERIFIED");
  assert.equal(fs.existsSync(path.join(moved, "receipt.json")), true); assert.equal(fs.existsSync(path.join(moved, "inventory.json")), true);
});
test("explicit injected receipt-fsync fault retires the registered owned inode even before publish returns", { skip: !nativeRoot }, async t => {
  const fixture = scope(t), originalSync = fs.fsyncSync; let observed = false;
  t.mock.method(fs, "fsyncSync", fd => { if (!observed && fs.readlinkSync(`/proc/self/fd/${fd}`) === path.join(fixture.input.directory, "receipt.json")) {
    observed = true; throw new Error("INJECTED_RECEIPT_FSYNC_FAILURE"); } return originalSync(fd); });
  try { await refused(TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, {}, fixture.options), "operation_failed"); assert.equal(observed, true);
    assert.equal(fs.existsSync(path.join(fixture.input.directory, "receipt.json")), false); assert.equal(fs.existsSync(path.join(fixture.input.directory, "inventory.json")), true); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
test("native callback abort and real nonsettling timeout retire receipt without late ACK", { skip: !nativeRoot }, async t => {
  const fixture = scope(t), controller = new globalThis.AbortController(); fixture.input.signal = controller.signal;
  await refused(TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, { result() { controller.abort(); return new Promise(() => {}); } }, fixture.options), "output_failed");
  assert.equal(fs.existsSync(path.join(fixture.input.directory, "receipt.json")), false);
  const timeout = scope(t), started = Date.now(); await refused(TEST_ONLY_retrievePostgresCoreEvidence(timeout.input, { result: () => new Promise(() => {}) }, timeout.options), "output_failed");
  assert.ok(Date.now() - started >= postgresCoreEvidenceRetrievalLimits.outputMs); assert.equal(fs.existsSync(path.join(timeout.input.directory, "receipt.json")), false);
});
test("explicit injected post-close fault retains cleanup uncertainty and cannot yield a success marker", { skip: !nativeRoot }, async t => {
  const fixture = scope(t); const originalClose = fs.closeSync; let observed = false;
  fixture.options.hooks.beforeClose = () => { t.mock.method(fs, "closeSync", fd => { const named = fs.readlinkSync(`/proc/self/fd/${fd}`); originalClose(fd);
    if (!observed && named === fixture.refs[0].path) { observed = true; throw new Error("INJECTED_POST_CLOSE_FAILURE"); } }); syncBuiltinESMExports(); };
  try { await refused(TEST_ONLY_retrievePostgresCoreEvidence(fixture.input, {}, fixture.options), "cleanup_uncertain", "UNVERIFIED"); assert.equal(observed, true);
    assert.equal(fs.existsSync(path.join(fixture.input.directory, "receipt.json")), false); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
