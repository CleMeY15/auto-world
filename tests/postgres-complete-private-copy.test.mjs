import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { posix as path } from "node:path";
import { compilePostgresCoreEvidenceInventoryPolicy } from "../scripts/postgres-image/core-evidence-inventory-policy.mjs";
import { postgresCompletePrivateCopyPolicyContract, TEST_ONLY_compilePostgresCompletePrivateCopyPolicy } from
  "../scripts/postgres-image/complete-private-copy-policy.mjs";
import { postgresCompletePrivateCopyFailureDiagnostic, postgresCompletePrivateCopyLaunchControlReservedBytes,
  runPostgresCompletePrivateCopy, TEST_ONLY_runPostgresCompletePrivateCopy } from "../scripts/postgres-image/complete-private-copy.mjs";
import { copyEvidenceGeneration, evidenceGenerationTransferFailureDiagnostic, retrieveEvidenceGeneration,
  TEST_ONLY_copyEvidenceGeneration, TEST_ONLY_retrieveEvidenceGeneration } from "../scripts/postgres-image/evidence-generation-transfer.mjs";
import { loadPostgresSourceClosureManifest } from "../scripts/postgres-image/source-closure-manifest.mjs";

const STORAGE_ROOT = "/opt/auto-world/private-archives";
const sha = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex");
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const native = file => { const value = fs.lstatSync(file, { bigint: true }); return { dev: String(value.dev), ino: String(value.ino),
  uid: Number(value.uid), gid: Number(value.gid), mode: Number(value.mode & 0o7777n), nlink: Number(value.nlink), size: Number(value.size),
  mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) }; };
const directoryNative = file => Object.fromEntries(["dev", "ino", "uid", "gid", "mode"].map(key => [key, native(file)[key]]));
const clone = value => globalThis.structuredClone(value);
const nativeRoot = process.platform === "linux" && process.version === "v22.23.2" && process.getuid?.() === 0
  && fs.existsSync(STORAGE_ROOT) && fs.existsSync("/mnt/c") && fs.statfsSync(STORAGE_ROOT, { bigint: true }).type === 0xef53n;

function coreFixture() {
  const manifest = loadPostgresSourceClosureManifest();
  const references = manifest.materials.map((material, index) => ({
    id: `material-${String(index).padStart(3, "0")}`, group: "DECLARED_SOURCE_MATERIALS_323", role: material.role,
    object: { sha256: material.expected.sha256 ?? sha(`material:${material.id}`), size: material.expected.size ?? index + 1,
      sha512: material.expected.sha512, gitBlobSha1: material.expected.gitBlobSha1 }, materialId: material.id, historical: false,
    provenance: { kind: "COMPILED_SOURCE_MANIFEST", subject: manifest.subject, identifier: material.id,
      state: "BYTES_VERIFIED_UNADMITTED" },
  }));
  const retrieval = references.map((item, index) => ({ referenceId: item.id, path: `/unopened/core/${item.id}`,
    size: item.object.size, sha256: item.object.sha256, sha512: item.object.sha512, gitBlobSha1: item.object.gitBlobSha1,
    ownerProfile: "ROOT_PRIVATE", nativeIdentity: { dev: "2096", ino: String(1000 + index), uid: 0, gid: 0,
      mode: 0o600, nlink: 1, size: item.object.size, mtimeNs: String(2000 + index), ctimeNs: String(3000 + index) },
    parentIdentity: { dev: "2096", ino: String(4000 + index), uid: 0, gid: 0, mode: 0o700 } }));
  return compilePostgresCoreEvidenceInventoryPolicy({ kind: "POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1", subject: manifest.subject,
    references, groups: [{ id: "DECLARED_SOURCE_MATERIALS_323", role: "DECLARED_SOURCE_MATERIALS", required: true,
      referenceIds: references.map(item => item.id) }], history: [], laterRequired: ["OFFICIAL_ATTESTATION_BUNDLE", "SECOND_COMPLETE_PRIVATE_COPY"],
    retrieval: { references: retrieval, sourceBundleReferenceId: null, sourceBundleProof: null } });
}
function completePolicy() {
  const references = postgresCompletePrivateCopyPolicyContract.requiredGroupIds.map((groupId, index) => ({
    referenceId: `supplement-${String(index).padStart(2, "0")}`, groupId, role: `REVIEWED_OBJECT_${index}`,
    path: `/unopened/supplement/${index}`, size: index + 1, sha256: sha(`supplement:${index}`), sha512: null, gitBlobSha1: null,
    ownerProfile: "ROOT_PRIVATE", nativeIdentity: { dev: "2096", ino: String(5000 + index), uid: 0, gid: 0,
      mode: 0o600, nlink: 1, size: index + 1, mtimeNs: String(6000 + index), ctimeNs: String(7000 + index) },
    parentIdentity: { dev: "2096", ino: String(8000 + index), uid: 0, gid: 0, mode: 0o700 } }));
  return TEST_ONLY_compilePostgresCompletePrivateCopyPolicy({ kind: postgresCompletePrivateCopyPolicyContract.kind,
    subject: postgresCompletePrivateCopyPolicyContract.subject, corePolicySha256: postgresCompletePrivateCopyPolicyContract.corePolicySha256,
    coreReferenceDigest: postgresCompletePrivateCopyPolicyContract.coreReferenceDigest,
    coreReferenceCount: postgresCompletePrivateCopyPolicyContract.coreReferenceCount,
    supplementalAcceptance: clone(postgresCompletePrivateCopyPolicyContract.supplementalAcceptance),
    groups: postgresCompletePrivateCopyPolicyContract.requiredGroupIds.map((groupId, index) => ({ groupId,
      referenceIds: [references[index].referenceId] })), references }, coreFixture());
}
function request(policy = completePolicy()) {
  const id = randomBytes(12).toString("hex"); return { policy, executionId: `pg-complete-${id}`, recipeRevision: "a".repeat(40),
    launchPlanSha256: "b".repeat(64), launchControlReservedBytes: postgresCompletePrivateCopyLaunchControlReservedBytes,
    signal: new globalThis.AbortController().signal };
}
function fixture(t) {
  const root = fs.mkdtempSync("/var/tmp/aw-complete-copy-source-"); fs.chmodSync(root, 0o700); const references = [];
  for (const [index, uid, gid, profile, bytes] of [[0, 0, 0, "ROOT_PRIVATE", Buffer.from("complete shared fixture")],
    [1, 1000, 1000, "ACTOR_PRIVATE", Buffer.from("complete shared fixture")], [2, 1000, 1000, "ACTOR_PRIVATE", Buffer.alloc(0)]]) {
    const parent = path.join(root, `source-${index}`); fs.mkdirSync(parent, { mode: 0o700 }); fs.chownSync(parent, uid, gid); fs.chmodSync(parent, 0o700);
    const file = path.join(parent, "object.bin"); fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); fs.chownSync(file, uid, gid); fs.chmodSync(file, 0o600);
    references.push({ referenceId: `fixture-${index}`, groupId: "TEST_ONLY", role: "HARMLESS_FIXTURE", path: file, size: bytes.length,
      sha256: sha(bytes), sha512: index === 0 ? null : sha(bytes, "sha512"), gitBlobSha1: index === 1 ? null : gitBlob(bytes), ownerProfile: profile,
      nativeIdentity: native(file), parentIdentity: directoryNative(parent) });
  }
  t.after(() => { if (fs.existsSync(root)) removeOwned(root); }); return { root, references };
}
function generatedPaths(value) {
  const nonce = EXEC(value.executionId); return {
    capacity: `${STORAGE_ROOT}/test-pg-complete-capacity-${nonce}.json`, copy: `${STORAGE_ROOT}/test-pg-complete-copy-${nonce}`,
    retrieve: `${STORAGE_ROOT}/test-pg-complete-retrieve-${nonce}`, proof: `${STORAGE_ROOT}/test-pg-complete-proof-${nonce}` };
}
function EXEC(value) { return /^pg-complete-([0-9a-f]{24})$/u.exec(value)?.[1]; }
function removeOwned(file) {
  if (!fs.existsSync(file)) return; const resolved = path.resolve(file);
  assert.ok(resolved.startsWith(`${STORAGE_ROOT}/test-pg-complete-`) || resolved.startsWith("/var/tmp/aw-complete-copy-source-"));
  const value = fs.lstatSync(resolved); assert.equal(value.isSymbolicLink(), false);
  if (value.isDirectory()) fs.rmSync(resolved, { recursive: true, force: false }); else fs.unlinkSync(resolved);
}
function cleanup(t, input) { const paths = generatedPaths(input); t.after(() => { for (const file of Object.values(paths)) removeOwned(file); }); return paths; }
function opts(references, fault = "NONE", hooks = {}) { return { fixtureReferences: references, hooks, fault }; }
function processFileLimits() {
  const match = /^Max open files[ \t]+([0-9]+)[ \t]+([0-9]+)[ \t]+files[ \t]*$/mu.exec(fs.readFileSync("/proc/self/limits", "utf8"));
  assert.ok(match); return { soft: Number(match[1]), hard: Number(match[2]) };
}
function setProcessFileLimits(soft, hard) {
  const result = spawnSync("/usr/bin/prlimit", [`--pid=${process.pid}`, `--nofile=${soft}:${hard}`], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
}
async function refused(promise, reason, cleanupState = "CONFIRMED") {
  let diagnostic; await assert.rejects(promise, error => { diagnostic = postgresCompletePrivateCopyFailureDiagnostic(error); return true; });
  assert.deepEqual(diagnostic, { code: `postgres_complete_private_copy_${reason}`, cleanup: cleanupState });
}

test("production rejects authoring, cloned and raw policy authority plus malformed closed input before effects", async () => {
  const policy = completePolicy(), value = request(policy), paths = generatedPaths(value); let reads = 0;
  await refused(runPostgresCompletePrivateCopy(value), "policy_invalid");
  await refused(runPostgresCompletePrivateCopy({ ...value, policy: clone(policy) }), "policy_invalid");
  await refused(runPostgresCompletePrivateCopy({ ...value, policy: { references: [] } }), "policy_invalid");
  await refused(runPostgresCompletePrivateCopy({ ...value, launchControlReservedBytes: 1 }), "arguments_invalid");
  const accessor = Object.defineProperty({}, "policy", { enumerable: true, get() { reads++; return policy; } });
  await refused(runPostgresCompletePrivateCopy(accessor), "arguments_invalid");
  await refused(runPostgresCompletePrivateCopy(value, {}, { extra: true }), "arguments_invalid");
  const controls = Object.defineProperty({}, "result", { enumerable: true, get() { reads++; return () => {}; } });
  await refused(runPostgresCompletePrivateCopy(value, controls), "arguments_invalid"); assert.equal(reads, 0);
  assert.equal(Object.values(paths).some(file => fs.existsSync(file)), false);
});

test("generation capabilities reject authoring authority, clones, substitutions and TEST capabilities at the production boundary", { skip: !nativeRoot }, t => {
  const source = fixture(t), value = request(), paths = cleanup(t, value), deadline = performance.now() + 120000;
  assert.throws(() => copyEvidenceGeneration({ authority: value.policy, executionId: value.executionId, deadline, signal: value.signal }), error =>
    evidenceGenerationTransferFailureDiagnostic(error).code === "postgres_evidence_generation_transfer_authority_invalid");
  assert.equal(fs.existsSync(paths.copy), false);
  const copy = TEST_ONLY_copyEvidenceGeneration({ authority: value.policy, executionId: value.executionId, deadline, signal: value.signal },
    { references: source.references, hooks: {}, forbiddenIdentities: [] });
  const invalid = [value.policy, clone(copy), { ...copy, forbiddenIdentitiesDigest: "0".repeat(64) }];
  for (const candidate of invalid) assert.throws(() => TEST_ONLY_retrieveEvidenceGeneration({ copy: candidate, deadline, signal: value.signal }, { hooks: {} }), error =>
    evidenceGenerationTransferFailureDiagnostic(error).code === "postgres_evidence_generation_transfer_copy_capability_invalid");
  assert.throws(() => retrieveEvidenceGeneration({ copy, deadline, signal: value.signal }), error =>
    evidenceGenerationTransferFailureDiagnostic(error).code === "postgres_evidence_generation_transfer_copy_capability_invalid");
  assert.equal(fs.existsSync(paths.retrieve), false);
});

test("native publishes capacity first and completes COPY then RETRIEVE after fixture originals are removed", { skip: !nativeRoot }, async t => {
  const source = fixture(t), value = request(), paths = cleanup(t, value); let callbackResult;
  const result = await TEST_ONLY_runPostgresCompletePrivateCopy(value, { result(item) { callbackResult = item; } },
    opts(source.references, "NONE", { afterCopy() { for (const reference of source.references) fs.renameSync(reference.path, `${reference.path}.removed`); } }));
  assert.equal(callbackResult, result); assert.equal(result.state, "PUBLISHED_AWAITING_COPY_RETRIEVAL_ACK");
  assert.equal(result.claims.closure, "NOT_ESTABLISHED"); assert.equal(result.claims.processEOF, "NOT_OBSERVED");
  assert.equal(result.preservation.originalsClosedBeforeRetrieve, true); assert.equal(result.preservation.descriptorsClosed, true);
  assert.equal(result.generations.copy.targetGeneration, "COPY"); assert.equal(result.generations.retrieve.targetGeneration, "RETRIEVE");
  assert.equal(result.generations.copy.inventory.references.count, source.references.length);
  assert.equal(result.capacity.value.state, "CAPACITY_VERIFIED_BEFORE_EFFECT");
  assert.equal(result.capacity.value.required.launchControlBytes, postgresCompletePrivateCopyLaunchControlReservedBytes);
  assert.equal(result.capacity.value.required.rawPolicyBytes, "UNAVAILABLE_BOUNDED_BY_SERIALIZED_CAPABILITY");
  const required = result.capacity.value.required;
  assert.equal(BigInt(required.totalBytes), 2n * BigInt(required.uniqueObjectBytes) + BigInt(required.policyReservationBytes)
    + 2n * BigInt(required.inventoryBytes + required.launchControlBytes) + BigInt(required.receiptCap + required.acknowledgementCap + required.reserveBytes));
  assert.ok(result.capacity.value.nativeLinux.availableBytes.length > 0); assert.ok(result.capacity.value.windowsHost.availableBytes.length > 0);
  const descriptors = result.capacity.value.descriptors;
  assert.equal(descriptors.identityReservations, source.references.length * 3 + 13); assert.equal(descriptors.writerDirectories, 7);
  assert.equal(descriptors.required, descriptors.sourceFiles + descriptors.sourceAncestors + descriptors.objects
    + descriptors.identityReservations + descriptors.writerDirectories + descriptors.safety);
  const proofKeys = ["path", "size", "sha256", "nativeIdentity", "parentIdentity"];
  for (const proof of [result.preservation.receipt, result.generations.inventory]) assert.deepEqual(Object.keys(proof), proofKeys);
  assert.deepEqual(Object.keys(result.capacity).slice(0, proofKeys.length), proofKeys);
  for (const file of [paths.capacity, path.join(paths.proof, "inventory.json"), path.join(paths.proof, "receipt.json")]) {
    const identity = native(file); assert.deepEqual([identity.uid, identity.gid, identity.mode, identity.nlink], [0, 0, 0o600, 1]); }
  const stored = JSON.parse(fs.readFileSync(path.join(paths.proof, "receipt.json"), "utf8"));
  assert.deepEqual(stored, { ...result, preservation: { ...result.preservation, receipt: null } });
  const identities = [...source.references.map(item => item.nativeIdentity), ...result.generations.copy.objects.map(item => item.identity),
    ...result.generations.retrieve.objects.map(item => item.identity)].map(item => `${item.dev}:${item.ino}`);
  assert.equal(new Set(identities).size, identities.length);
});

test("native capacity and descriptor faults fail before any filesystem effect", { skip: !nativeRoot }, async t => {
  for (const fault of ["CAPACITY_NATIVE", "CAPACITY_WINDOWS", "DESCRIPTORS"]) {
    const source = fixture(t), value = request(), paths = cleanup(t, value);
    await refused(TEST_ONLY_runPostgresCompletePrivateCopy(value, {}, opts(source.references, fault)),
      fault === "DESCRIPTORS" ? "descriptors_invalid" : "capacity_invalid");
    assert.equal(Object.values(paths).some(file => fs.existsSync(file)), false);
  }
});

test("native low soft FD limit budgets forced reservation FDs and rejects before every filesystem effect", { skip: !nativeRoot }, async t => {
  const source = fixture(t), value = request(), paths = cleanup(t, value), limits = processFileLimits();
  const open = fs.readdirSync("/proc/self/fd").length, lowSoft = open + 90; let forced = 0;
  assert.ok(lowSoft < limits.soft && lowSoft <= limits.hard); setProcessFileLimits(lowSoft, limits.hard);
  try {
    await refused(TEST_ONLY_runPostgresCompletePrivateCopy(value, {}, opts(source.references, "NONE", {
      forceIdentityReservation() { forced++; return true; },
    })), "descriptors_invalid");
  } finally { setProcessFileLimits(limits.soft, limits.hard); }
  assert.equal(forced, 0); assert.equal(Object.values(paths).some(file => fs.existsSync(file)), false);
});

test("native preexisting foreign output blocks all effects and remains unchanged", { skip: !nativeRoot }, async t => {
  const source = fixture(t), value = request(), paths = cleanup(t, value); fs.writeFileSync(paths.capacity, "foreign", { flag: "wx", mode: 0o600 });
  await refused(TEST_ONLY_runPostgresCompletePrivateCopy(value, {}, opts(source.references)), "storage_invalid");
  assert.equal(fs.readFileSync(paths.capacity, "utf8"), "foreign"); assert.equal(fs.existsSync(paths.copy), false);
  assert.equal(fs.existsSync(paths.retrieve), false); assert.equal(fs.existsSync(paths.proof), false);
});

test("native second-transfer failure preserves capacity, COPY and failed RETRIEVE without a success receipt", { skip: !nativeRoot }, async t => {
  const source = fixture(t), value = request(), paths = cleanup(t, value);
  await refused(TEST_ONLY_runPostgresCompletePrivateCopy(value, {}, opts(source.references, "SECOND_TRANSFER")), "transfer_failed");
  assert.equal(fs.existsSync(paths.capacity), true); assert.equal(fs.existsSync(paths.copy), true); assert.equal(fs.existsSync(paths.retrieve), true);
  assert.equal(fs.existsSync(paths.proof), false);
});

test("native receipt fsync/readback/close faults never return success and preserve payload evidence", { skip: !nativeRoot }, async t => {
  for (const fault of ["RECEIPT_FSYNC", "RECEIPT_READBACK", "RECEIPT_CLOSE"]) {
    const source = fixture(t), value = request(), paths = cleanup(t, value); let callbacks = 0;
    await assert.rejects(TEST_ONLY_runPostgresCompletePrivateCopy(value, { result() { callbacks++; } }, opts(source.references, fault)));
    assert.equal(callbacks, 0); assert.equal(fs.existsSync(paths.capacity), true); assert.equal(fs.existsSync(paths.copy), true);
    assert.equal(fs.existsSync(path.join(paths.proof, "inventory.json")), true);
    if (fault === "RECEIPT_CLOSE") assert.equal(fs.existsSync(path.join(paths.proof, "receipt.json")), false);
    else assert.equal(fs.existsSync(path.join(paths.proof, "receipt.json")), true);
  }
});

test("native output rejection retires only the owned receipt and retains inventory and generations", { skip: !nativeRoot }, async t => {
  const source = fixture(t), value = request(), paths = cleanup(t, value);
  await refused(TEST_ONLY_runPostgresCompletePrivateCopy(value, { result() { throw new Error("PRIVATE_OUTPUT"); } }, opts(source.references)), "output_failed");
  assert.equal(fs.existsSync(path.join(paths.proof, "receipt.json")), false);
  assert.equal(fs.existsSync(path.join(paths.proof, "inventory.json")), true); assert.equal(fs.existsSync(paths.copy), true); assert.equal(fs.existsSync(paths.retrieve), true);
});

test("native foreign receipt substitution is preserved and cleanup becomes uncertain", { skip: !nativeRoot }, async t => {
  const source = fixture(t), value = request(), paths = cleanup(t, value);
  await refused(TEST_ONLY_runPostgresCompletePrivateCopy(value, {}, opts(source.references, "FOREIGN_RECEIPT")), "cleanup_uncertain", "UNVERIFIED");
  assert.equal(fs.readFileSync(path.join(paths.proof, "receipt.json"), "utf8"), "foreign receipt");
  assert.equal(fs.existsSync(path.join(paths.proof, "receipt.json.owned")), true);
});
