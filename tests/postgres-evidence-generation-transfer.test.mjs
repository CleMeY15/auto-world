import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { posix as path } from "node:path";
import { evidenceGenerationTransferFailureDiagnostic, TEST_ONLY_runEvidenceGenerationTransfer } from
  "../scripts/postgres-image/evidence-generation-transfer.mjs";

const STORAGE_ROOT = "/opt/auto-world/private-archives";
const sha = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const gitBlob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const native = file => { const value = fs.lstatSync(file, { bigint: true }); return { dev: String(value.dev), ino: String(value.ino),
  uid: Number(value.uid), gid: Number(value.gid), mode: Number(value.mode & 0o7777n), nlink: Number(value.nlink), size: Number(value.size),
  mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs) }; };
const directoryNative = file => Object.fromEntries(["dev", "ino", "uid", "gid", "mode"].map(key => [key, native(file)[key]]));
const identityKey = value => `${value.dev}:${value.ino}`;
const nonce = () => randomBytes(12).toString("hex");
const nativeRoot = process.platform === "linux" && process.version === "v22.23.2" && process.getuid?.() === 0
  && fs.existsSync(STORAGE_ROOT) && (() => { const value = native(STORAGE_ROOT); return value.uid === 0 && value.gid === 0 && value.mode === 0o700
    && fs.statfsSync(STORAGE_ROOT, { bigint: true }).type === 0xef53n; })();

function fakeReference(overrides = {}) {
  const bytes = Buffer.from("fixture");
  return { referenceId: "fixture-a", groupId: "FIXTURE", role: "FIXTURE_OBJECT", path: "/unopened/fixture-a",
    size: bytes.length, sha256: sha(bytes), sha512: sha(bytes, "sha512"), gitBlobSha1: gitBlob(bytes), ownerProfile: "ROOT_PRIVATE",
    nativeIdentity: { dev: "1", ino: "2", uid: 0, gid: 0, mode: 0o600, nlink: 1, size: bytes.length, mtimeNs: "1", ctimeNs: "1" },
    parentIdentity: { dev: "1", ino: "3", uid: 0, gid: 0, mode: 0o700 }, ...overrides };
}
function input(references, generation = "ORIGINAL", forbiddenIdentities = []) {
  const target = generation === "ORIGINAL" ? "copy" : "retrieve";
  return { references, directory: `${STORAGE_ROOT}/test-pg-complete-${target}-${nonce()}`, deadline: performance.now() + 120000,
    signal: new globalThis.AbortController().signal, sourceGeneration: generation, forbiddenIdentities };
}
function removeOwned(file) {
  if (!fs.existsSync(file)) return;
  const resolved = path.resolve(file);
  assert.ok(resolved.startsWith(`${STORAGE_ROOT}/test-pg-complete-`) || resolved.startsWith("/var/tmp/aw-transfer-source-"));
  const value = fs.lstatSync(resolved); assert.equal(value.isDirectory(), true); assert.equal(value.isSymbolicLink(), false);
  fs.rmSync(resolved, { recursive: true, force: false });
}
function fixture(t, definitions = [
  { profile: "ROOT_PRIVATE", uid: 0, gid: 0, mode: 0o600, bytes: Buffer.from("shared transfer object"), sha512: null, git: true },
  { profile: "ACTOR_PRIVATE", uid: 1000, gid: 1000, mode: 0o600, bytes: Buffer.from("shared transfer object"), sha512: true, git: null },
  { profile: "ACTOR_PRIVATE", uid: 1000, gid: 1000, mode: 0o600, bytes: Buffer.alloc(0), sha512: true, git: true },
]) {
  const root = fs.mkdtempSync("/var/tmp/aw-transfer-source-"); fs.chmodSync(root, 0o700); const references = [];
  for (const [index, definition] of definitions.entries()) {
    const parent = path.join(root, `source-${index}`); fs.mkdirSync(parent, { mode: 0o700 });
    fs.chownSync(parent, definition.uid, definition.gid); fs.chmodSync(parent, 0o700);
    const file = path.join(parent, "object.bin"); fs.writeFileSync(file, definition.bytes, { flag: "wx", mode: definition.mode });
    fs.chownSync(file, definition.uid, definition.gid); fs.chmodSync(file, definition.mode);
    references.push({ referenceId: `fixture-${index}`, groupId: "FIXTURE", role: "FIXTURE_OBJECT", path: file,
      size: definition.bytes.length, sha256: sha(definition.bytes), sha512: definition.sha512 ? sha(definition.bytes, "sha512") : null,
      gitBlobSha1: definition.git ? gitBlob(definition.bytes) : null, ownerProfile: definition.profile,
      nativeIdentity: native(file), parentIdentity: directoryNative(parent) });
  }
  t.after(() => removeOwned(root)); return { root, references };
}
function refused(callback, reason, cleanup = "CONFIRMED") {
  let diagnostic; assert.throws(callback, error => { diagnostic = evidenceGenerationTransferFailureDiagnostic(error); return true; });
  assert.deepEqual(diagnostic, { code: `postgres_evidence_generation_transfer_${reason}`, cleanup });
}

test("contradictory duplicate digest union fails before native access or target mkdir", () => {
  const first = fakeReference(), second = fakeReference({ referenceId: "fixture-b", path: "/unopened/fixture-b",
    nativeIdentity: { ...fakeReference().nativeIdentity, ino: "4" }, sha512: "0".repeat(128) });
  const value = input([first, second]);
  refused(() => TEST_ONLY_runEvidenceGenerationTransfer(value, { hooks: {} }), "digest_contradiction");
  if (process.platform === "linux") assert.equal(fs.existsSync(value.directory), false);
});

test("closed input rejects accessors, unordered forbidden identities and production-shaped fixture escape", () => {
  let reads = 0; const accessor = Object.defineProperty({}, "references", { enumerable: true, get() { reads++; return []; } });
  assert.throws(() => TEST_ONLY_runEvidenceGenerationTransfer(accessor, { hooks: {} })); assert.equal(reads, 0);
  const unordered = input([fakeReference()], "ORIGINAL", ["2:1", "1:2"]);
  refused(() => TEST_ONLY_runEvidenceGenerationTransfer(unordered, { hooks: {} }), "arguments_invalid");
  const wrong = input([fakeReference()]); wrong.directory = `${STORAGE_ROOT}/pg-complete-copy-${nonce()}`;
  refused(() => TEST_ONLY_runEvidenceGenerationTransfer(wrong, { hooks: {} }), "arguments_invalid");
});

test("only the two authentic CORE historical receipts admit the legacy root traversable parent", () => {
  const accepted = fakeReference({ referenceId: "historical-cold-receipt", groupId: "CORE", role: "ROOT_COLD_LOAD_RECEIPT",
    parentIdentity: { dev: "1", ino: "3", uid: 0, gid: 1000, mode: 0o710 } });
  const value = input([accepted]);
  assert.throws(() => TEST_ONLY_runEvidenceGenerationTransfer(value, { hooks: {} }), error =>
    evidenceGenerationTransferFailureDiagnostic(error).code !== "postgres_evidence_generation_transfer_reference_invalid");
  for (const mutate of [reference => { reference.groupId = "SUPPLEMENTAL"; }, reference => { reference.role = "ARBITRARY_ROLE"; },
    reference => { reference.referenceId = "supplemental-receipt"; }]) {
    const rejected = globalThis.structuredClone(accepted); mutate(rejected);
    refused(() => TEST_ONLY_runEvidenceGenerationTransfer(input([rejected]), { hooks: {} }), "reference_invalid");
  }
});

test("native reuses one mechanism for ORIGINAL to COPY and COPY to RETRIEVE after originals are removed", { skip: !nativeRoot }, t => {
  const source = fixture(t), copyInput = input(source.references), originalIdentities = [...new Set(source.references.map(ref =>
    identityKey(ref.nativeIdentity)))].sort();
  t.after(() => { removeOwned(copyInput.directory); });
  let openBeforeClose = false, openAfterClose = false;
  const sourceIsOpen = () => fs.readdirSync("/proc/self/fd").some(fd => {
    try { return source.references.some(ref => fs.readlinkSync(`/proc/self/fd/${fd}`) === ref.path); } catch { return false; }
  });
  const copy = TEST_ONLY_runEvidenceGenerationTransfer(copyInput, { hooks: {
    beforeSourceClose() { openBeforeClose = sourceIsOpen(); }, afterSourceClose() { openAfterClose = sourceIsOpen(); },
  } });
  assert.equal(openBeforeClose, true); assert.equal(openAfterClose, false);
  assert.equal(copy.state, "TRANSFERRED_SOURCE_CLOSED"); assert.equal(copy.sourceClosed, true); assert.equal(copy.descriptorsClosed, true);
  assert.deepEqual(copy.claims, { authority: "INTERNAL_OPAQUE_TRANSFER_ONLY", admission: "NOT_AUTHORIZED", closure: "NOT_ESTABLISHED",
    policyAuthority: "NOT_ACCEPTED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED" });
  assert.equal(copy.inventory.references.count, 3); assert.equal(copy.inventory.objects.count, 2); assert.equal(copy.objects.length, 2);
  const shared = copy.objects.find(item => item.size > 0); assert.equal(shared.referenceIds.length, 2);
  assert.equal(shared.sha512, sha(Buffer.from("shared transfer object"), "sha512")); assert.equal(shared.gitBlobSha1, gitBlob(Buffer.from("shared transfer object")));
  for (const object of copy.objects) { assert.equal(native(object.path).uid, 0); assert.equal(native(object.path).gid, 0); assert.equal(native(object.path).mode, 0o600);
    const bytes = fs.readFileSync(object.path); assert.equal(native(object.path).nlink, 1); assert.equal(bytes.length, object.size); assert.equal(sha(bytes), object.sha256);
    if (object.sha512 !== null) assert.equal(sha(bytes, "sha512"), object.sha512); if (object.gitBlobSha1 !== null) assert.equal(gitBlob(bytes), object.gitBlobSha1); }
  for (const reference of source.references) fs.renameSync(reference.path, `${reference.path}.removed`);
  const retrieveInput = input(copy.targetReferences, "COPY", originalIdentities); t.after(() => removeOwned(retrieveInput.directory));
  const retrieve = TEST_ONLY_runEvidenceGenerationTransfer(retrieveInput, { hooks: {} });
  assert.equal(retrieve.targetGeneration, "RETRIEVE"); assert.equal(retrieve.inventory.references.count, copy.targetReferences.length);
  assert.deepEqual(retrieve.objects.map(item => [item.sha256, item.sha512, item.gitBlobSha1]),
    copy.objects.map(item => [item.sha256, item.sha512, item.gitBlobSha1]));
  const all = [...source.references.map(item => item.nativeIdentity), ...copy.objects.map(item => item.identity), ...retrieve.objects.map(item => item.identity)];
  assert.equal(new Set(all.map(identityKey)).size, all.length); assert.equal(retrieve.targetReferences.every(item => item.ownerProfile === "ROOT_PRIVATE"), true);
});

test("native rejects link, owner, mode, named identity and forbidden source before creating a generation", { skip: !nativeRoot }, t => {
  const mutations = [
    value => fs.linkSync(value.references[0].path, `${value.references[0].path}.link`),
    value => fs.chownSync(value.references[0].path, 1000, 1000),
    value => fs.chmodSync(value.references[0].path, 0o644),
    value => { const file = value.references[0].path, bytes = fs.readFileSync(file); fs.renameSync(file, `${file}.old`); fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); },
  ];
  for (const mutate of mutations) { const source = fixture(t, [{ profile: "ROOT_PRIVATE", uid: 0, gid: 0, mode: 0o600,
    bytes: Buffer.from("identity fixture"), sha512: true, git: true }]); const value = input(source.references); t.after(() => removeOwned(value.directory)); mutate(source);
    assert.throws(() => TEST_ONLY_runEvidenceGenerationTransfer(value, { hooks: {} })); assert.equal(fs.existsSync(value.directory), false); }
  const source = fixture(t), forbidden = input(source.references, "ORIGINAL", [identityKey(source.references[0].nativeIdentity)]);
  refused(() => TEST_ONLY_runEvidenceGenerationTransfer(forbidden, { hooks: {} }), "foreign_identity"); assert.equal(fs.existsSync(forbidden.directory), false);
});

test("native O_EXCL preserves a preexisting target and never publishes an acknowledgement", { skip: !nativeRoot }, t => {
  const source = fixture(t), value = input(source.references); fs.mkdirSync(value.directory, { mode: 0o700 });
  fs.writeFileSync(path.join(value.directory, "foreign"), "preserve", { flag: "wx", mode: 0o600 }); t.after(() => removeOwned(value.directory));
  refused(() => TEST_ONLY_runEvidenceGenerationTransfer(value, { hooks: {} }), "operation_failed");
  assert.equal(fs.readFileSync(path.join(value.directory, "foreign"), "utf8"), "preserve");
});

test("native no-replace identity reservation preserves a racing foreign name and the owned candidate", { skip: !nativeRoot }, t => {
  const source = fixture(t), value = input(source.references); t.after(() => removeOwned(value.directory));
  let collision, forced = false;
  refused(() => TEST_ONLY_runEvidenceGenerationTransfer(value, { hooks: {
    forceIdentityReservation() { if (forced) return false; forced = true; return true; },
    beforeIdentityReservation(event) {
      collision = event; fs.writeFileSync(event.reservation, "foreign reservation", { flag: "wx", mode: 0o600 });
    },
  } }), "operation_failed");
  assert.equal(forced, true); assert.ok(collision);
  assert.equal(fs.readFileSync(collision.reservation, "utf8"), "foreign reservation");
  const candidate = fs.lstatSync(collision.candidate, { bigint: true });
  assert.equal(candidate.isFile(), true); assert.equal(Number(candidate.nlink), 1);
});

test("native identity reservations are globally bounded before a capability can exceed its closed exclusion limit", { skip: !nativeRoot }, t => {
  const definitions = Array.from({ length: 7 }, (_unused, index) => ({ profile: "ROOT_PRIVATE", uid: 0, gid: 0, mode: 0o600,
    bytes: Buffer.from(`bounded-reservation-${index}`), sha512: true, git: true }));
  const source = fixture(t, definitions), value = input(source.references); t.after(() => removeOwned(value.directory)); const attempts = new Map();
  refused(() => TEST_ONLY_runEvidenceGenerationTransfer(value, { hooks: { forceIdentityReservation({ candidate }) {
    const count = (attempts.get(candidate) ?? 0) + 1; attempts.set(candidate, count); return count <= source.references.length;
  } } }), "foreign_identity");
  const reservations = fs.readdirSync(path.join(value.directory, "identity-reservations"));
  assert.equal(reservations.length, source.references.length * 3 + 13);
});

test("native fsync and post-close failures fail closed while preserving partial private payloads", { skip: !nativeRoot }, t => {
  const fsyncSource = fixture(t), fsyncInput = input(fsyncSource.references); t.after(() => removeOwned(fsyncInput.directory));
  const originalFsync = fs.fsyncSync; let fsyncObserved = false;
  t.mock.method(fs, "fsyncSync", fd => { const named = fs.readlinkSync(`/proc/self/fd/${fd}`);
    if (!fsyncObserved && named.endsWith(".blob")) { fsyncObserved = true; throw new Error("INJECTED_FSYNC_FAILURE"); } return originalFsync(fd); });
  try { refused(() => TEST_ONLY_runEvidenceGenerationTransfer(fsyncInput, { hooks: {} }), "operation_failed"); assert.equal(fsyncObserved, true); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }

  const closeSource = fixture(t), closeInput = input(closeSource.references); t.after(() => removeOwned(closeInput.directory));
  const originalClose = fs.closeSync; let closeObserved = false;
  const options = { hooks: { beforeSourceClose() { t.mock.method(fs, "closeSync", fd => { const named = fs.readlinkSync(`/proc/self/fd/${fd}`); originalClose(fd);
    if (!closeObserved && named === closeSource.references[0].path) { closeObserved = true; throw new Error("INJECTED_CLOSE_FAILURE"); } }); syncBuiltinESMExports(); } } };
  try { refused(() => TEST_ONLY_runEvidenceGenerationTransfer(closeInput, options), "cleanup_uncertain", "UNVERIFIED"); assert.equal(closeObserved, true); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
