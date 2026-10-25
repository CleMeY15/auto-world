import assert from "node:assert/strict";
import test from "node:test";
import { authenticatePostgresPrivateRuntimeEvidence, validatePostgresPrivateRuntimeEvidenceHistory,
  validatePostgresPrivateRuntimeEvidenceReceipt } from "../scripts/postgres-image/private-runtime-evidence-input.mjs";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN } from "../scripts/postgres-image/private-runtime-evidence-policy.mjs";
import { POSTGRES_PRIVATE_EVIDENCE_PIN as LEGACY } from "../scripts/postgres-image/private-evidence-policy.mjs";

const clone = (value) => globalThis.structuredClone(value);
const native = (ino, uid, gid, size) => ({ dev: "2096", ino: String(ino), uid, gid, mode: 0o600, nlink: 1, size, mtimeNs: "1790786471778509866", ctimeNs: "1790786471778509866" });
function manifestShape() {
  const nonce = "1".repeat(24); const recipeRevision = "2".repeat(40);
  const sources = PIN.sources.map((source, index) => ({ role: source.role, fd: source.fd, source: source.source,
    size: source.size, sha256: source.sha256, identity: native(100 + index, source.uid, source.gid, source.size) }));
  const expected = { nonce, recipeRevision, executionId: "local-runtime-evidence-" + nonce,
    directory: PIN.parent + "/" + PIN.directoryPrefix + nonce, sources };
  const reference = (source, recipe) => ({ size: source.size, sha256: source.sha256, recipeRevision: recipe.recipeRevision, executionId: recipe.executionId });
  const backup = (directory, identity) => ({ kind: "POSTGRES_SQL_PRIVATE_DUMP_V1", state: "SEALED", directory,
    name: "diagnostic.dump", size: sources[2].size, sha256: sources[2].sha256,
    identity: Object.fromEntries(Object.entries(identity).filter(([key]) => key !== "size")),
    format: "POSTGRESQL_CUSTOM", interpretation: "NOT_FULLY_ESTABLISHED_BY_TRANSPORT" });
  const payloads = sources.map((source, index) => ({ name: PIN.sources[index].name, role: source.role, size: source.size,
    sha256: source.sha256, sourceIdentity: source.identity, identity: native(200 + index, 1000, 1000, source.size) }));
  const directory = (ino) => ({ dev: "2096", ino: String(ino), uid: 1000, gid: 1000, mode: 0o700 });
  const contextDirectory = { ...native(300, 1000, 1000, 4096), mode: 0o755, nlink: 2 };
  const context = { head: recipeRevision, workspace: PIN.workspace, gitDirectory: PIN.workspace + "/.git", commonDirectory: PIN.workspace + "/.git",
    workspaceIdentity: contextDirectory, gitDirectoryIdentity: contextDirectory, commonDirectoryIdentity: contextDirectory,
    refsSha256: "3".repeat(64), files: [] };
  const receipt = { kind: "POSTGRES_PRIVATE_RUNTIME_EVIDENCE_RECEIPT_V1", state: "PUBLISHED_AWAITING_SUPERVISOR_ACK",
    purpose: PIN.purpose, authority: "LOCAL_DIAGNOSTIC", executionId: expected.executionId, recipeRevision, githubRunId: null,
    directory: expected.directory, filesystem: "EXT4", actor: { uid: 1000, gid: 1000 }, subject: PIN.subject,
    imageId: LEGACY.candidate.imageId, tag: LEGACY.candidate.tag, payloads, directories: [{ name: "", identity: directory(400) }, { name: "backup", identity: directory(401) }],
    history: { kind: "POSTGRES_PRIVATE_RUNTIME_EVIDENCE_HISTORY_V1", state: "VERIFIED", authority: "HISTORICAL_ONLY",
      subject: PIN.subject, imageId: LEGACY.candidate.imageId, tag: LEGACY.candidate.tag,
      cold: reference(PIN.sources[0], PIN.cold), sql: reference(PIN.sources[1], PIN.sql), legacy: clone(PIN.legacy),
      backupOriginal: backup(PIN.sql.workDirectory + "/backup", sources[2].identity) },
    backupCopy: backup(expected.directory + "/backup", payloads[2].identity), sourceGit: { before: context, after: context },
    startedAt: "2026-09-30T10:00:00.000Z", preparedAt: "2026-09-30T10:00:01.000Z", historicalIntegrity: "VERIFIED",
    currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED", closure: "INCOMPLETE", requiredMissing: clone(PIN.requiredMissing),
    supervisorAckRequired: true, sourceUnchanged: true, privateState: "RETAINED", network: "NOT_ATTEMPTED", registryRead: "NOT_ATTEMPTED",
    registryWrite: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null };
  return { expected, receipt };
}

test("historical authentication rejects malformed and substituted bytes before parsing; no fixture is full acceptance", () => {
  for (const value of [null, {}, [], { private: "secret" }, Object.create(null)]) {
    assert.throws(() => authenticatePostgresPrivateRuntimeEvidence(value), { message: "postgres_private_runtime_evidence_historical_invalid" });
  }
  const value = { policyBytes: Buffer.alloc(4848), runtimePolicyBytes: Buffer.alloc(4447), copyReceiptBytes: Buffer.alloc(26562),
    coldReceiptBytes: Buffer.alloc(59779), sqlReceiptBytes: Buffer.alloc(81500), legacyReceiptBytes: Buffer.alloc(89249) };
  assert.throws(() => authenticatePostgresPrivateRuntimeEvidence(value), { message: "postgres_private_runtime_evidence_historical_invalid" });
  Object.defineProperty(value, "policyBytes", { enumerable: true, get() { throw new Error("private"); } });
  assert.throws(() => authenticatePostgresPrivateRuntimeEvidence(value), { message: "postgres_private_runtime_evidence_historical_invalid" });
});

test("provisional manifest shape requires an external ACK and preserves separate original/copy dump identities", () => {
  const { expected, receipt } = manifestShape();
  const result = validatePostgresPrivateRuntimeEvidenceReceipt(receipt, expected);
  assert.equal(result.state, "PUBLISHED_AWAITING_SUPERVISOR_ACK"); assert.equal(result.supervisorAckRequired, true);
  assert.notEqual(result.history.backupOriginal.directory, result.backupCopy.directory);
  assert.notEqual(result.history.backupOriginal.identity.ino, result.backupCopy.identity.ino);
  assert.equal(result.currentness, "NOT_EVALUATED"); assert.equal(result.closure, "INCOMPLETE"); assert.ok(Object.isFrozen(result));
});

test("closed provisional shape rejects coercions, substitutions, claims and private fields", () => {
  const { expected, receipt } = manifestShape();
  const mutations = [
    (v) => { v.state = "ADDENDUM_VERIFIED"; }, (v) => { v.supervisorAckRequired = false; },
    (v) => { v.currentness = "VERIFIED_CURRENT"; }, (v) => { v.runtimePermission = "GRANTED"; },
    (v) => { v.closure = "COMPLETE"; }, (v) => { v.admission = "AUTHORIZED"; },
    (v) => { v.supportStartedAt = v.startedAt; }, (v) => { v.private = "secret"; },
    (v) => { v.payloads[0].sha256 = [v.payloads[0].sha256]; }, (v) => { v.payloads[0].identity.ino = ["200"]; },
    (v) => { v.payloads[0].identity = v.payloads[0].sourceIdentity; }, (v) => { v.payloads[1].identity = v.payloads[0].identity; },
    (v) => { v.payloads[0].sourceIdentity.ino = "900"; }, (v) => { v.payloads.pop(); },
    (v) => { v.payloads.reverse(); }, (v) => { v.directories[0].identity.mode = 0o755; },
    (v) => { v.backupCopy.directory = v.history.backupOriginal.directory; },
    (v) => { v.backupCopy.identity.ino = v.history.backupOriginal.identity.ino; },
    (v) => { v.history.backupOriginal.identity.ino = "999"; },
    (v) => { v.history.legacy.sha256 = "4".repeat(64); }, (v) => { v.history.sql.recipeRevision = v.recipeRevision; },
    (v) => { v.sourceGit.after.head = "5".repeat(40); }, (v) => { v.sourceGit.after.files = ["private"]; },
    (v) => { v.sourceGit.before.refsSha256 = ["3".repeat(64)]; },
    (v) => { v.requiredMissing.pop(); }, (v) => { v.preparedAt = "2030-01-01T00:00:00.000Z"; },
  ];
  for (const mutate of mutations) {
    const changed = clone(receipt); mutate(changed);
    assert.throws(() => validatePostgresPrivateRuntimeEvidenceReceipt(changed, clone(expected)), { message: "postgres_private_runtime_evidence_publication_failed" });
  }
  const getter = clone(receipt); Object.defineProperty(getter, "subject", { enumerable: true, get() { throw new Error("private"); } });
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceReceipt(getter, expected), { message: "postgres_private_runtime_evidence_publication_failed" });
  const wrongExpected = clone(expected); wrongExpected.sources[0].fd = 8;
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceReceipt(receipt, wrongExpected), { message: "postgres_private_runtime_evidence_publication_failed" });
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceHistory({}), { message: "postgres_private_runtime_evidence_historical_invalid" });
});

test("nested accessors, symbols, nonenumerable records and decorated arrays reject without executing getters", () => {
  const { expected, receipt } = manifestShape(); let calls = 0;
  for (const select of [(v) => v.actor, (v) => v.history.cold, (v) => v.history.sql, (v) => v.history.legacy,
    (v) => v.payloads[0].sourceIdentity, (v) => v.sourceGit.before]) {
    const value = clone(receipt); const target = select(value); const key = Object.keys(target)[0];
    Object.defineProperty(target, key, { enumerable: true, get() { calls++; return "private"; } });
    assert.throws(() => validatePostgresPrivateRuntimeEvidenceReceipt(value, expected), { message: "postgres_private_runtime_evidence_publication_failed" });
  }
  for (const decorate of [
    (v) => { v.actor[Symbol("private")] = "secret"; },
    (v) => { Object.defineProperty(v.history.legacy, "private", { value: "secret" }); },
    (v) => { Object.defineProperty(v.requiredMissing, "0", { get() { calls++; return PIN.requiredMissing[0]; }, enumerable: true }); },
    (v) => { v.requiredMissing.private = "secret"; },
    (v) => { v.actor = new Proxy(v.actor, { get() { calls++; throw new Error("private"); } }); },
    (v) => { v.payloads[0].identity.toJSON = () => { calls++; return {}; }; },
  ]) {
    const value = clone(receipt); decorate(value);
    assert.throws(() => validatePostgresPrivateRuntimeEvidenceReceipt(value, expected), { message: "postgres_private_runtime_evidence_publication_failed" });
  }
  const badExpected = clone(expected); Object.defineProperty(badExpected.sources[0].identity, "ino", { enumerable: true, get() { calls++; return "100"; } });
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceReceipt(receipt, badExpected), { message: "postgres_private_runtime_evidence_publication_failed" });
  assert.equal(calls, 0);
});
