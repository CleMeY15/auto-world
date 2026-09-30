import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder, types } from "node:util";
import { authenticatePostgresRuntimeRestoreMaterial, authenticatePriorPostgresColdLoad } from "./runtime-restore-input.mjs";
import { postgresRuntimeRestoreClientIdentity, validatePostgresLocalRuntimeRestoreReceipt } from "./local-runtime-restore-diagnostic.mjs";
import { validatePostgresPrivateEvidenceReceipt } from "./private-evidence.mjs";
import { POSTGRES_PRIVATE_EVIDENCE_PIN as LEGACY_PIN } from "./private-evidence-policy.mjs";
import { validatePostgresSqlBackupProof } from "./candidate-sql-backup-restore.mjs";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN, postgresPrivateRuntimeEvidenceLimits as LIMITS } from "./private-runtime-evidence-policy.mjs";

const PREFIX = "postgres_private_runtime_evidence_";
const HEX = /^[0-9a-f]{64}$/u;
const REV = /^[0-9a-f]{40}$/u;
const DEC = /^(?:0|[1-9][0-9]{0,29})$/u;
const NATIVE = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const DIRECTORY = ["dev", "ino", "uid", "gid", "mode"];
const BACKUP_NATIVE = NATIVE.filter((key) => key !== "size");
const fail = (reason = "historical_invalid") => { throw new Error(PREFIX + reason); };
const plain = (value) => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, names) => plain(value) && isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...names].sort())
  && names.every((key) => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const frozen = (value) => Array.isArray(value) ? Object.freeze(value.map(frozen)) : plain(value)
  ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, frozen(child)]))) : value;
const copy = (value) => frozen(globalThis.structuredClone(value));
const parse = (bytes) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
function dataTree(value) {
  let nodes = 0; const active = new Set();
  const visit = (item, depth) => {
    if (++nodes > 4096 || depth > 24) fail("publication_failed");
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "string") { if (item.length > 1024) fail("publication_failed"); return; }
    if (typeof item === "number") { if (!Number.isFinite(item)) fail("publication_failed"); return; }
    if (typeof item !== "object" || types.isProxy(item) || active.has(item)) fail("publication_failed");
    const array = Array.isArray(item);
    if (!array && !plain(item)) fail("publication_failed");
    const descriptors = Object.getOwnPropertyDescriptors(item); const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) fail("publication_failed");
    let entries;
    if (array) {
      const length = descriptors.length;
      if (!length || !Object.hasOwn(length, "value") || length.enumerable || !Number.isSafeInteger(length.value)
        || length.value > 128 || keys.length !== length.value + 1) fail("publication_failed");
      entries = Array.from({ length: length.value }, (_, index) => descriptors[String(index)]);
    } else entries = keys.map((key) => descriptors[key]);
    if (entries.some((descriptor) => !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))) fail("publication_failed");
    active.add(item); for (const descriptor of entries) visit(descriptor.value, depth + 1); active.delete(item);
  };
  visit(value, 0);
}
function pinned(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== expected.size || bytes.length > LIMITS.sourceBytes || hash(bytes) !== expected.sha256) fail();
  return bytes;
}
function native(value, owner, size) {
  return exact(value, NATIVE) && ["dev", "ino", "mtimeNs", "ctimeNs"].every((key) => typeof value[key] === "string" && DEC.test(value[key]))
    && ["uid", "gid", "mode", "nlink", "size"].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
    && value.uid === owner.uid && value.gid === owner.gid && value.mode === owner.mode && value.nlink === 1 && value.size === size;
}
const sourceReference = (source, historical) => ({ size: source.size, sha256: source.sha256,
  recipeRevision: historical.recipeRevision, executionId: historical.executionId });
const legacyReference = () => ({ ...PIN.legacy });
function backupMatchesSource(backup, source) {
  return backup.directory === `${PIN.sql.workDirectory}/backup` && backup.size === source.size && backup.sha256 === source.sha256
    && isDeepStrictEqual(backup.identity, Object.fromEntries(BACKUP_NATIVE.map((key) => [key, source.identity[key]])));
}

// Pins and expected recipes never come from the historical JSON being authenticated.
export function authenticatePostgresPrivateRuntimeEvidence(value) {
  try {
    const names = ["policyBytes", "runtimePolicyBytes", "copyReceiptBytes", "coldReceiptBytes", "sqlReceiptBytes", "legacyReceiptBytes"];
    if (!exact(value, names)) fail();
    pinned(value.policyBytes, LEGACY_PIN.publicFiles.find((file) => file.name === LEGACY_PIN.policyFiles.candidate));
    pinned(value.runtimePolicyBytes, LEGACY_PIN.publicFiles.find((file) => file.name === LEGACY_PIN.policyFiles.runtime));
    pinned(value.copyReceiptBytes, LEGACY_PIN.copyReceipt);
    pinned(value.coldReceiptBytes, PIN.sources[0]); pinned(value.sqlReceiptBytes, PIN.sources[1]); pinned(value.legacyReceiptBytes, PIN.legacy);
    const material = authenticatePostgresRuntimeRestoreMaterial(value.policyBytes, value.copyReceiptBytes, value.runtimePolicyBytes);
    const coldReceipt = authenticatePriorPostgresColdLoad(value.coldReceiptBytes, material, value.policyBytes, value.copyReceiptBytes);
    const sqlReceipt = parse(value.sqlReceiptBytes);
    const start = { kind: "START", nonce: PIN.sql.nonce, recipeRevision: PIN.sql.recipeRevision, executionId: PIN.sql.executionId,
      identity: postgresRuntimeRestoreClientIdentity(sqlReceipt.daemonIdentity, PIN.sql.nonce),
      workDirectory: PIN.sql.workDirectory, auditReceiptSha256: material.runtimePolicy.audit.receipt.sha256,
      policyBytesBase64: value.policyBytes.toString("base64"), copyReceiptBytesBase64: value.copyReceiptBytes.toString("base64"),
      runtimePolicyBytesBase64: value.runtimePolicyBytes.toString("base64") };
    validatePostgresLocalRuntimeRestoreReceipt(sqlReceipt, start, material);
    const legacyReceipt = validatePostgresPrivateEvidenceReceipt(parse(value.legacyReceiptBytes), {
      workspace: PIN.workspace, recipeRevision: PIN.legacy.recipeRevision, executionId: PIN.legacy.executionId,
      directory: PIN.legacy.directory, pin: LEGACY_PIN,
    });
    const backupOriginal = validatePostgresSqlBackupProof(sqlReceipt.backupFinal, `${PIN.sql.workDirectory}/backup`);
    if (backupOriginal.size !== PIN.sources[2].size || backupOriginal.sha256 !== PIN.sources[2].sha256
      || backupOriginal.identity.uid !== 1000 || backupOriginal.identity.gid !== 1000) fail();
    const history = { kind: "POSTGRES_PRIVATE_RUNTIME_EVIDENCE_HISTORY_V1", state: "VERIFIED", authority: "HISTORICAL_ONLY",
      subject: PIN.subject, imageId: material.policy.candidate.imageId, tag: material.copyReceipt.linuxFinalProof.archiveProof.tag,
      cold: sourceReference(PIN.sources[0], PIN.cold), sql: sourceReference(PIN.sources[1], PIN.sql),
      legacy: legacyReference(), backupOriginal };
    validatePostgresPrivateRuntimeEvidenceHistory(history);
    return frozen({ material, coldReceipt, sqlReceipt: copy(sqlReceipt), legacyReceipt, history: copy(history) });
  } catch { fail(); }
}

export function validatePostgresPrivateRuntimeEvidenceHistory(value) {
  try {
    dataTree(value);
    if (!exact(value, ["kind", "state", "authority", "subject", "imageId", "tag", "cold", "sql", "legacy", "backupOriginal"])
      || value.kind !== "POSTGRES_PRIVATE_RUNTIME_EVIDENCE_HISTORY_V1" || value.state !== "VERIFIED" || value.authority !== "HISTORICAL_ONLY"
      || value.subject !== PIN.subject || value.imageId !== LEGACY_PIN.candidate.imageId || value.tag !== LEGACY_PIN.candidate.tag
      || !isDeepStrictEqual(value.cold, sourceReference(PIN.sources[0], PIN.cold))
      || !isDeepStrictEqual(value.sql, sourceReference(PIN.sources[1], PIN.sql)) || !isDeepStrictEqual(value.legacy, legacyReference())) fail();
    const backup = validatePostgresSqlBackupProof(value.backupOriginal, `${PIN.sql.workDirectory}/backup`);
    if (backup.size !== PIN.sources[2].size || backup.sha256 !== PIN.sources[2].sha256 || backup.identity.uid !== 1000 || backup.identity.gid !== 1000) fail();
    return copy(value);
  } catch { fail(); }
}

function expectedInput(value) {
  if (!exact(value, ["nonce", "recipeRevision", "executionId", "directory", "sources"])
    || typeof value.nonce !== "string" || !/^[0-9a-f]{24}$/u.test(value.nonce)
    || typeof value.recipeRevision !== "string" || !REV.test(value.recipeRevision)
    || value.executionId !== `local-runtime-evidence-${value.nonce}` || value.directory !== `${PIN.parent}/${PIN.directoryPrefix}${value.nonce}`
    || !Array.isArray(value.sources) || value.sources.length !== 3) fail("publication_failed");
  value.sources.forEach((source, index) => {
    const expected = PIN.sources[index];
    if (!exact(source, ["role", "fd", "source", "size", "sha256", "identity"])
      || ["role", "fd", "source", "size", "sha256"].some((key) => source[key] !== expected[key]) || !native(source.identity, expected, expected.size)) fail("publication_failed");
  });
  return value;
}

// This validates the provisional manifest. Acceptance still requires the separate supervisor ACK.
export function validatePostgresPrivateRuntimeEvidenceReceipt(value, expectedValue) {
  try {
    dataTree(value); dataTree(expectedValue);
    const expected = expectedInput(expectedValue);
    const keys = ["kind", "state", "purpose", "authority", "executionId", "recipeRevision", "githubRunId", "directory", "filesystem", "actor",
      "subject", "imageId", "tag", "payloads", "directories", "history", "backupCopy", "sourceGit", "startedAt", "preparedAt",
      "historicalIntegrity", "currentness", "runtimePermission", "closure", "requiredMissing", "supervisorAckRequired", "sourceUnchanged",
      "privateState", "network", "registryRead", "registryWrite", "signing", "admission", "supportStartedAt", "supportEndsAt", "archiveUntil"];
    if (!exact(value, keys) || Buffer.byteLength(JSON.stringify(value)) > LIMITS.receiptBytes
      || value.kind !== "POSTGRES_PRIVATE_RUNTIME_EVIDENCE_RECEIPT_V1" || value.state !== "PUBLISHED_AWAITING_SUPERVISOR_ACK"
      || value.purpose !== PIN.purpose || value.authority !== "LOCAL_DIAGNOSTIC" || value.githubRunId !== null
      || ["executionId", "recipeRevision", "directory"].some((key) => value[key] !== expected[key]) || value.filesystem !== "EXT4"
      || !isDeepStrictEqual(value.actor, { uid: 1000, gid: 1000 }) || value.subject !== PIN.subject
      || value.imageId !== LEGACY_PIN.candidate.imageId || value.tag !== LEGACY_PIN.candidate.tag
      || value.historicalIntegrity !== "VERIFIED" || value.currentness !== "NOT_EVALUATED" || value.runtimePermission !== "NOT_GRANTED"
      || value.closure !== "INCOMPLETE" || !isDeepStrictEqual(value.requiredMissing, PIN.requiredMissing)
      || value.supervisorAckRequired !== true || value.sourceUnchanged !== true || value.privateState !== "RETAINED"
      || ["network", "registryRead", "registryWrite", "signing"].some((key) => value[key] !== "NOT_ATTEMPTED") || value.admission !== "NOT_AUTHORIZED"
      || ["supportStartedAt", "supportEndsAt", "archiveUntil"].some((key) => value[key] !== null)) fail("publication_failed");
    const history = validatePostgresPrivateRuntimeEvidenceHistory(value.history);
    if (!backupMatchesSource(history.backupOriginal, expected.sources[2]) || !Array.isArray(value.payloads) || value.payloads.length !== 3) fail("publication_failed");
    value.payloads.forEach((file, index) => {
      const source = expected.sources[index]; const fixed = PIN.sources[index];
      if (!exact(file, ["name", "role", "size", "sha256", "sourceIdentity", "identity"])
        || file.name !== fixed.name || ["role", "size", "sha256"].some((key) => file[key] !== source[key])
        || !isDeepStrictEqual(file.sourceIdentity, source.identity) || !native(file.identity, { uid: 1000, gid: 1000, mode: 0o600 }, file.size)
        || file.identity.dev === file.sourceIdentity.dev && file.identity.ino === file.sourceIdentity.ino) fail("publication_failed");
    });
    if (new Set(value.payloads.map((file) => `${file.identity.dev}:${file.identity.ino}`)).size !== 3
      || !Array.isArray(value.directories) || value.directories.length !== 2) fail("publication_failed");
    value.directories.forEach((entry, index) => {
      if (!exact(entry, ["name", "identity"]) || entry.name !== ["", "backup"][index] || !exact(entry.identity, DIRECTORY)
        || ["dev", "ino"].some((key) => typeof entry.identity[key] !== "string" || !DEC.test(entry.identity[key]))
        || entry.identity.uid !== 1000 || entry.identity.gid !== 1000 || entry.identity.mode !== 0o700) fail("publication_failed");
    });
    const backup = validatePostgresSqlBackupProof(value.backupCopy, `${expected.directory}/backup`);
    const dump = value.payloads[2];
    if (backup.size !== dump.size || backup.sha256 !== dump.sha256
      || !isDeepStrictEqual(backup.identity, Object.fromEntries(BACKUP_NATIVE.map((key) => [key, dump.identity[key]])))) fail("publication_failed");
    if (!exact(value.sourceGit, ["before", "after"]) || !isDeepStrictEqual(value.sourceGit.before, value.sourceGit.after)) fail("publication_failed");
    for (const context of Object.values(value.sourceGit)) {
      const names = ["head", "workspace", "gitDirectory", "commonDirectory", "workspaceIdentity", "gitDirectoryIdentity", "commonDirectoryIdentity", "refsSha256", "files"];
      if (!exact(context, names) || context.head !== expected.recipeRevision || context.workspace !== PIN.workspace
        || typeof context.refsSha256 !== "string" || !HEX.test(context.refsSha256) || !Array.isArray(context.files) || context.files.length !== 0
        || ["gitDirectory", "commonDirectory"].some((key) => typeof context[key] !== "string" || !context[key].startsWith(PIN.workspace + "/"))) fail("publication_failed");
      for (const key of ["workspaceIdentity", "gitDirectoryIdentity", "commonDirectoryIdentity"]) {
        if (!exact(context[key], NATIVE) || ["dev", "ino", "mtimeNs", "ctimeNs"].some((field) => typeof context[key][field] !== "string" || !DEC.test(context[key][field]))
          || ["uid", "gid", "mode", "nlink", "size"].some((field) => !Number.isSafeInteger(context[key][field]) || context[key][field] < 0)) fail("publication_failed");
      }
    }
    const iso = (time) => typeof time === "string" && Number.isFinite(Date.parse(time)) && new Date(time).toISOString() === time;
    if (!iso(value.startedAt) || !iso(value.preparedAt) || Date.parse(value.preparedAt) < Date.parse(value.startedAt)
      || Date.parse(value.preparedAt) - Date.parse(value.startedAt) > LIMITS.operationMs) fail("publication_failed");
    return copy(value);
  } catch { fail("publication_failed"); }
}
