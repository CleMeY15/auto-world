import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, realpathSync, readdirSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { isDeepStrictEqual } from "node:util";
import { validateDiagnosticLock } from "./diagnostic.mjs";
import { postgresCandidateCommandTransport, validatePostgresIsolatedDaemonInfo, validatePostgresLocalClientIdentity,
  validatePostgresPrivateCandidateMaterial, validatePostgresPrivateExt4Storage, validatePostgresSavedImageInspection, withVerifiedPostgresPrivateCandidate } from "./candidate-local-cold-load.mjs";
import { isPostgresRuntimeObjectAbsent, postgresLocalRuntimeCreateArguments, postgresLocalRuntimeLabels,
  postgresRuntimeGosuCommand, postgresRuntimeProfileContract, validatePostgresLocalRuntimeContainer,
  validatePostgresLocalRuntimeVolume, validatePostgresRuntimeEnvironment } from "./candidate-runtime.mjs";
import { dumpPostgresDiagnosticSql, postgresSqlCommandTransport, restorePostgresDiagnosticSql,
  sealPostgresSqlBackup, validatePostgresSqlBackupProof } from "./candidate-sql-backup-restore.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PURPOSE = "POSTGRES_RUNTIME_SQL_RESTORE";
const PREFIX = "postgres_local_runtime_restore_";
const HEX = /^[0-9a-f]{64}$/u; const ID = /^[0-9a-f]{64}$/u;
const CAP = 1024 ** 2; const ENGINE_MS = 15 * 60_000; const CLEANUP_MS = 120_000;
const ROLES = ["probe", "source1", "source2", "restore1", "restore2"];
export const postgresLocalRuntimeRestorePhases = Object.freeze(["PREFLIGHT", "LOAD", "PROBE", "SOURCE_START", "SOURCE_SQL",
  "SOURCE_RESTART", "DUMP", "SOURCE_DISPOSE", "RESTORE_START", "RESTORE_SQL", "RESTORE_RESTART", "CLEANUP", "FINAL_SEAL"]);
const REASONS = new Set(["arguments_invalid", "requires_nonroot_linux", "storage_invalid", "files_changed", "archive_invalid",
  "configuration_invalid", "authorization_invalid", "audit_invalid", "command_failed", "deadline_exceeded", "aborted", "inventory_invalid",
  "image_invalid", "name_occupied", "container_invalid", "volume_invalid", "distinct_container_invalid", "gosu_invalid", "process_invalid",
  "readiness_timeout", "sql_invalid", "tools_invalid", "backup_invalid", "stop_invalid", "cleanup_uncertain", "proof_invalid", "operation_failed"]);
const plain = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v, list) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...list].sort());
const freeze = (v) => Array.isArray(v) ? Object.freeze(v.map(freeze)) : plain(v)
  ? Object.freeze(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, freeze(x)]))) : v;
const hash = (v) => createHash("sha256").update(v).digest("hex");
const canonicalValue = (v) => Array.isArray(v) ? v.map(canonicalValue) : plain(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonicalValue(v[k])])) : v;
const sha = (v) => hash(Buffer.from(JSON.stringify(canonicalValue(v))));
const fail = (reason) => { throw new Error(PREFIX + reason); };
const parse = (v, reason = "command_failed") => { try { return JSON.parse(v.toString("utf8")); } catch { fail(reason); } };
const canonical = (v) => typeof v === "string" && v.length < 512 && path.posix.isAbsolute(v) && path.posix.normalize(v) === v;
const iso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function errorReason(error) {
  try { const code = error?.message;
    if (["postgres_sql_backup_descriptor_cleanup_failed", "postgres_local_cold_load_descriptor_cleanup_failed"].includes(code)) return "cleanup_uncertain";
    if (code === "postgres_sql_backup_transport_failed") return "command_failed";
    if (["postgres_sql_backup_file_changed", "postgres_sql_backup_format_invalid", "postgres_sql_backup_proof_invalid"].includes(code)) return "backup_invalid";
    if (typeof code === "string" && REASONS.has(code.slice(PREFIX.length)) && code.startsWith(PREFIX)) return code.slice(PREFIX.length); }
  catch { /* Dependency error properties are untrusted. */ } return "operation_failed";
}
export function postgresLocalRuntimeRestoreFailureDiagnostic(error) {
  let phase; let cleanup; try { phase = error?.phase; cleanup = error?.cleanup; } catch { /* Closed fallback. */ }
  return Object.freeze({ code: PREFIX + errorReason(error), phase: ["CONTEXT", ...postgresLocalRuntimeRestorePhases].includes(phase) ? phase : "CONTEXT",
    cleanup: cleanup === "CONFIRMED" ? "CONFIRMED" : "UNVERIFIED" });
}
export function validatePostgresLocalRuntimeRestoreFailureDiagnostic(value) {
  if (!keys(value, ["code", "phase", "cleanup"]) || !isDeepStrictEqual(postgresLocalRuntimeRestoreFailureDiagnostic(Object.assign(new Error(value.code),
    { phase: value.phase, cleanup: value.cleanup })), value)) fail("proof_invalid"); return freeze({ ...value });
}
function inputValue(value) {
  const list = ["directory", "files", "archiveProof", "policy", "originalRecipeRevision", "originalExecutionId", "recipeRevision", "executionId", "identity", "workDirectory", "auditReceiptSha256"];
  if (!keys(value, Object.hasOwn(value ?? {}, "signal") ? [...list, "signal"] : list) || !/^[0-9a-f]{40}$/u.test(value.recipeRevision)
    || !/^local-pg-restore-[0-9a-f]{24}$/u.test(value.executionId) || !HEX.test(value.auditReceiptSha256) || !canonical(value.workDirectory)
    || value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal)) fail("arguments_invalid");
  const material = validatePostgresPrivateCandidateMaterial(Object.fromEntries(["directory", "files", "archiveProof", "policy", "originalRecipeRevision", "originalExecutionId"].map((k) => [k, value[k]])));
  const identity = validatePostgresLocalClientIdentity(value.identity);
  for (const sibling of [value.directory, identity.dockerConfig, path.dirname(identity.endpoint.slice(7))]) {
    if ([path.relative(sibling, value.workDirectory), path.relative(value.workDirectory, sibling)].some((p) => p === "" || !path.isAbsolute(p) && p !== ".." && !p.startsWith("../"))) fail("arguments_invalid");
  }
  return Object.freeze({ ...value, ...material, identity });
}
function lockInputs() { try { return validateDiagnosticLock(JSON.parse(readFileSync(path.join(ROOT, "infra/postgres-image/lock.json"))),
  readFileSync(path.join(ROOT, "infra/postgres-image/Dockerfile"))); } catch { fail("configuration_invalid"); } }
const SQL_ENV = ["PGSERVICE=", "PGSERVICEFILE=/dev/null", "PGSYSCONFDIR=/nonexistent", "PGPASSFILE=/dev/null", "PGPASSWORD=", "PGOPTIONS=", "PGHOSTADDR="];
const SQL_CONNECTION = ["--host=/var/run/postgresql", "--port=5432", "--username=awdiag", "--no-password"];
export const postgresLocalSqlCommands = freeze({
  createdb: ["createdb", ...SQL_CONNECTION, "--maintenance-db=postgres", "--template=template0", "awdiag"],
  dump: ["pg_dump", ...SQL_CONNECTION, "--dbname=awdiag", "--format=custom"],
  restore: ["pg_restore", ...SQL_CONNECTION, "--dbname=awdiag", "--single-transaction", "--no-owner", "--no-privileges"],
  toc: ["pg_restore", "--list"],
});
const REFERENCES_SHA = hash(Buffer.from([0, 255]));
export const postgresLocalSqlExpectedData = freeze({ items: [
  { id: 1, label: "ASCII", metadata: { source: "synthetic", value: 1 }, payload: "00ff", note: null },
  { id: 2, label: "é", metadata: { unicode: "é", flags: [true, false] }, payload: "000102", note: "retained" },
  { id: 3, label: "車", metadata: { unicode: "車", value: null }, payload: "ff00", note: "" },
], raw_refs: [{ id: 1, item_id: 1, sha256: REFERENCES_SHA }], outbox: [{ id: 1, item_id: 1, payload: { event: "diagnostic.created", itemId: 1 } }], rolled_back_count: 0 });
const column = (name, type, nullable, length = null) => ({ name, type, nullable, length });
export const postgresLocalSqlExpectedSchema = freeze({
  items: { columns: [column("id", "int4", false), column("label", "text", false), column("metadata", "jsonb", false), column("payload", "bytea", false), column("note", "text", true)],
    constraints: [{ name: "items_label_nonempty", type: "c", columns: ["label"], referencedTable: null, referencedColumns: [], validated: true, deferrable: false },
      { name: "items_pkey", type: "p", columns: ["id"], referencedTable: null, referencedColumns: [], validated: true, deferrable: false }] },
  outbox: { columns: [column("id", "int4", false), column("item_id", "int4", false), column("payload", "jsonb", false)],
    constraints: [{ name: "outbox_item_fk", type: "f", columns: ["item_id"], referencedTable: "items", referencedColumns: ["id"], validated: true, deferrable: false },
      { name: "outbox_pkey", type: "p", columns: ["id"], referencedTable: null, referencedColumns: [], validated: true, deferrable: false }] },
  raw_refs: { columns: [column("id", "int4", false), column("item_id", "int4", false), column("sha256", "bpchar", false, 64)],
    constraints: [{ name: "raw_refs_item_fk", type: "f", columns: ["item_id"], referencedTable: "items", referencedColumns: ["id"], validated: true, deferrable: false },
      { name: "raw_refs_pkey", type: "p", columns: ["id"], referencedTable: null, referencedColumns: [], validated: true, deferrable: false },
      { name: "raw_refs_sha256_lower_hex", type: "c", columns: ["sha256"], referencedTable: null, referencedColumns: [], validated: true, deferrable: false }] },
});
export const postgresLocalSqlFixture = `BEGIN;
CREATE SCHEMA aw_probe;
CREATE TABLE aw_probe.items (id integer PRIMARY KEY, label text NOT NULL CONSTRAINT items_label_nonempty CHECK (length(label)>0), metadata jsonb NOT NULL, payload bytea NOT NULL, note text);
CREATE TABLE aw_probe.raw_refs (id integer PRIMARY KEY, item_id integer NOT NULL CONSTRAINT raw_refs_item_fk REFERENCES aw_probe.items(id), sha256 char(64) NOT NULL CONSTRAINT raw_refs_sha256_lower_hex CHECK (sha256 ~ '^[0-9a-f]{64}$'));
CREATE TABLE aw_probe.outbox (id integer PRIMARY KEY, item_id integer NOT NULL CONSTRAINT outbox_item_fk REFERENCES aw_probe.items(id), payload jsonb NOT NULL);
INSERT INTO aw_probe.items VALUES (1,'ASCII','{"source":"synthetic","value":1}',decode('00ff','hex'),NULL),(2,'é','{"unicode":"é","flags":[true,false]}',decode('000102','hex'),'retained'),(3,'車','{"unicode":"車","value":null}',decode('ff00','hex'),'');
INSERT INTO aw_probe.raw_refs VALUES(1,1,'${REFERENCES_SHA}');
INSERT INTO aw_probe.outbox VALUES(1,1,'{"event":"diagnostic.created","itemId":1}');
COMMIT;
BEGIN; INSERT INTO aw_probe.items VALUES(99,'rolled back','{}',decode('ff','hex'),'absent'); ROLLBACK;`;
const CHECK_SQL = `DO $aw$ DECLARE constraint_seen text; BEGIN
BEGIN INSERT INTO aw_probe.items VALUES(98,'','{}',decode('00','hex'),NULL); RAISE EXCEPTION 'missing label check';
EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS constraint_seen=CONSTRAINT_NAME; IF constraint_seen<>'items_label_nonempty' THEN RAISE EXCEPTION 'wrong label check'; END IF; END;
BEGIN INSERT INTO aw_probe.raw_refs VALUES(98,1,repeat('G',64)); RAISE EXCEPTION 'missing sha check';
EXCEPTION WHEN check_violation THEN GET STACKED DIAGNOSTICS constraint_seen=CONSTRAINT_NAME; IF constraint_seen<>'raw_refs_sha256_lower_hex' THEN RAISE EXCEPTION 'wrong sha check'; END IF; END;
END $aw$;`;
const DATA_SQL = `SELECT json_build_object('items',(SELECT json_agg(json_build_object('id',id,'label',label,'metadata',metadata,'payload',encode(payload,'hex'),'note',note) ORDER BY id) FROM aw_probe.items),'raw_refs',(SELECT json_agg(json_build_object('id',id,'item_id',item_id,'sha256',sha256) ORDER BY id) FROM aw_probe.raw_refs),'outbox',(SELECT json_agg(json_build_object('id',id,'item_id',item_id,'payload',payload) ORDER BY id) FROM aw_probe.outbox),'rolled_back_count',(SELECT count(*) FROM aw_probe.items WHERE id=99));`;
const SCHEMA_SQL = `SELECT json_object_agg(t.relname,json_build_object('columns',(SELECT json_agg(json_build_object('name',a.attname,'type',ty.typname,'nullable',NOT a.attnotnull,'length',CASE WHEN ty.typname='bpchar' THEN a.atttypmod-4 ELSE NULL END) ORDER BY a.attnum) FROM pg_attribute a JOIN pg_type ty ON ty.oid=a.atttypid WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),'constraints',(SELECT json_agg(json_build_object('name',c.conname,'type',c.contype,'columns',COALESCE((SELECT json_agg(a.attname ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(id,n) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.id),'[]'::json),'referencedTable',(SELECT relname FROM pg_class WHERE oid=c.confrelid),'referencedColumns',COALESCE((SELECT json_agg(a.attname ORDER BY k.n) FROM unnest(c.confkey) WITH ORDINALITY k(id,n) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.id),'[]'::json),'validated',c.convalidated,'deferrable',c.condeferrable) ORDER BY c.conname) FROM pg_constraint c WHERE c.conrelid=t.oid))) FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='aw_probe' AND t.relkind='r';`;
const PROCESS_SCRIPT = "awk '/^Uid:/{print \"uid=\"$2\" \"$3\" \"$4\" \"$5}/^Gid:/{print \"gid=\"$2\" \"$3\" \"$4\" \"$5}/^NoNewPrivs:/{print \"nnp=\"$2}/^Cap(Inh|Prm|Eff|Amb):/{print tolower(substr($1,1,6))\"=\"$2}' /proc/1/status; if awk '/^Uid:/{ok=($2==70&&$3==70&&$4==70&&$5==70)}/^Gid:/{ok=ok&&($2==70&&$3==70&&$4==70&&$5==70)}END{exit !ok}' /proc/1/status; then printf 'exe='; readlink /proc/1/exe; fi";
function processProof(bytes) {
  const lines = bytes.toString("utf8").trimEnd().split("\n"); const record = {};
  for (const line of lines) { const index = line.indexOf("="); if (index < 1 || Object.hasOwn(record, line.slice(0, index))) fail("process_invalid"); record[line.slice(0, index)] = line.slice(index + 1); }
  const base = ["uid", "gid", "nnp", "capinh", "capprm", "capeff", "capamb"];
  if (!keys(record, Object.hasOwn(record, "exe") ? [...base, "exe"] : base) || record.nnp !== "1"
    || ![record.uid, record.gid].every((v) => /^(?:[0-9]+ ){3}[0-9]+$/u.test(v)) || !base.slice(3).every((k) => /^[0-9a-f]{16}$/u.test(record[k]))) fail("process_invalid");
  const uid = record.uid.split(" ").map(Number); const gid = record.gid.split(" ").map(Number);
  if (uid.every((v) => v === 0) && gid.every((v) => v === 0) && record.exe === undefined) return null;
  if (uid.some((v) => v !== 70) || gid.some((v) => v !== 70)) fail("process_invalid");
  if (base.slice(3).some((k) => record[k] !== "0000000000000000")) fail("process_invalid");
  if (["/bin/bash", "/usr/bin/bash"].includes(record.exe)) return null;
  if (!/^\/[^\s]{1,255}\/postgres$/u.test(record.exe)) fail("process_invalid");
  return { uid, gid, noNewPrivs: 1, capabilities: { inheritable: "0000000000000000", permitted: "0000000000000000", effective: "0000000000000000", ambient: "0000000000000000" }, executable: record.exe };
}
function output(v, allowed = [0]) {
  if (!plain(v) || v.error || v.signal || !allowed.includes(v.status) || !Buffer.isBuffer(v.stdout) || !Buffer.isBuffer(v.stderr)
    || v.stdout.length + v.stderr.length > CAP) fail("command_failed"); return v;
}
async function bounded(action, milliseconds, signal) {
  let timer; let abort; try { return await Promise.race([Promise.resolve().then(action), new Promise((_yes, no) => {
    timer = setTimeout(() => no(new Error(PREFIX + "deadline_exceeded")), Math.max(1, milliseconds));
    if (signal) { abort = () => no(new Error(PREFIX + "aborted")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); }
  })]); } finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}
function workSession(input) {
  const uid = process.getuid(); const gid = process.getgid(); const folder = input.workDirectory;
  validatePostgresPrivateExt4Storage(folder); const stat = lstatSync(folder, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(folder) !== folder || stat.uid !== BigInt(uid) || stat.gid !== BigInt(gid)
    || (stat.mode & 0o7777n) !== 0o700n || statfsSync(folder, { bigint: true }).type !== 0xef53n || readdirSync(folder).length !== 0) fail("storage_invalid");
  const fileProof = (v) => ({ dev: v.dev, ino: v.ino, uid: v.uid, gid: v.gid, mode: v.mode, nlink: v.nlink, size: v.size, mtimeNs: v.mtimeNs, ctimeNs: v.ctimeNs });
  const directoryProof = (v) => ({ dev: v.dev, ino: v.ino, uid: v.uid, gid: v.gid, mode: v.mode });
  const anchors = new Map(); let ancestor = folder;
  while (true) { const current = lstatSync(ancestor, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || realpathSync(ancestor) !== ancestor) fail("storage_invalid");
    anchors.set(ancestor, directoryProof(current)); const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent; }
  const fd = openSync(folder, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); const envs = []; let backup;
  const check = () => {
    if (!isDeepStrictEqual(directoryProof(fstatSync(fd, { bigint: true })), directoryProof(stat))) fail("files_changed");
    for (const [file, proof] of anchors) { const current = lstatSync(file, { bigint: true }); if (!current.isDirectory() || current.isSymbolicLink()
      || realpathSync(file) !== file || !isDeepStrictEqual(directoryProof(current), proof)) fail("files_changed"); }
    if (!isDeepStrictEqual(readdirSync(folder).sort(), [...envs.map((v) => path.basename(v.file)), ...(backup ? ["backup"] : [])].sort())) fail("files_changed");
    for (const entry of envs) { const opened = fstatSync(entry.fd, { bigint: true }); const named = lstatSync(entry.file, { bigint: true });
      if (!opened.isFile() || named.isSymbolicLink() || opened.nlink !== 1n || !isDeepStrictEqual(fileProof(opened), fileProof(entry.stat)) || !isDeepStrictEqual(fileProof(opened), fileProof(named))
        || opened.uid !== BigInt(uid) || opened.gid !== BigInt(gid) || (opened.mode & 0o7777n) !== 0o600n) fail("files_changed");
      const bytes = Buffer.alloc(entry.bytes.length); if (readSync(entry.fd, bytes, 0, bytes.length, 0) !== bytes.length || !bytes.equals(entry.bytes)) fail("files_changed"); }
    if (backup) { const current = lstatSync(backup.file, { bigint: true }); if (!current.isDirectory() || current.isSymbolicLink() || realpathSync(backup.file) !== backup.file
      || !isDeepStrictEqual(directoryProof(current), backup.proof) || readdirSync(backup.file).some((name) => name !== "diagnostic.dump")) fail("files_changed"); }
  };
  const createEnv = (role) => { check(); const bytes = Buffer.from(`POSTGRES_PASSWORD=${randomBytes(32).toString("hex")}\nPOSTGRES_USER=awdiag\nPOSTGRES_DB=postgres\n`);
    const file = path.join(folder, `${role}.env`); const handle = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const entry = { file, fd: handle, bytes }; envs.push(entry); fchmodSync(handle, 0o600); let offset = 0;
    while (offset < bytes.length) { const n = writeSync(handle, bytes, offset, bytes.length - offset, offset); if (n < 1) fail("storage_invalid"); offset += n; }
    fsyncSync(handle); entry.stat = fstatSync(handle, { bigint: true }); check(); return { file, variables: Object.fromEntries(bytes.toString().trimEnd().split("\n").map((v) => v.split("="))) }; };
  const makeBackup = () => { check(); const file = path.join(folder, "backup"); mkdirSync(file, { mode: 0o700 }); backup = { file, proof: directoryProof(lstatSync(file, { bigint: true })) }; check(); return file; };
  const cleanup = () => { check(); for (const entry of envs) { unlinkSync(entry.file); closeSync(entry.fd); } envs.length = 0; check(); };
  const close = () => { let failed = false; for (const entry of envs) try { closeSync(entry.fd); } catch { failed = true; } try { closeSync(fd); } catch { failed = true; } if (failed) fail("cleanup_uncertain"); };
  return { check, createEnv, makeBackup, cleanup, close };
}
function serviceConfig(configuration) {
  const config = configuration.config;
  if (!plain(config) || !["", "0", "0:0"].includes(config.User) || config.WorkingDir !== "/" || !isDeepStrictEqual(config.Entrypoint, ["docker-entrypoint.sh"])
    || !isDeepStrictEqual(config.Cmd, ["postgres"]) || !keys(config.Volumes, [postgresRuntimeProfileContract.pgdata])
    || validatePostgresRuntimeEnvironment(config.Env).PGDATA !== postgresRuntimeProfileContract.pgdata) fail("configuration_invalid"); return config;
}
export function validatePostgresLocalRuntimeRestoreProof(value, inputRaw) {
  try {
    const input = inputValue(inputRaw); const lock = lockInputs(); const nonce = input.executionId.slice("local-pg-restore-".length);
    const fields = ["kind", "state", "authority", "recipeRevision", "executionId", "originalRecipeRevision", "originalExecutionId", "directory", "files", "archiveProof", "identity", "workDirectory", "auditReceiptSha256",
      "filesystem", "subject", "imageId", "diffIds", "tag", "configurationComparison", "gosu", "tools", "services", "volumes", "backup", "sourceDisposed", "audit", "cleanup", "phases", "registryRead", "registryWrite", "signing", "admission", "supportStartedAt", "supportEndsAt", "archiveUntil"];
    if (!keys(value, fields) || value.kind !== "POSTGRES_LOCAL_RUNTIME_SQL_RESTORE_PROOF_V1" || value.state !== "VERIFIED" || value.authority !== "LOCAL_DIAGNOSTIC"
      || value.filesystem !== "EXT4" || value.configurationComparison !== "EXACT_ARCHIVE_CONFIGURATION" || value.subject !== input.policy.subject || value.imageId !== input.policy.candidate.imageId
      || value.tag !== input.archiveProof.tag || !isDeepStrictEqual(value.diffIds, input.policy.candidate.diffIds)
      || ["recipeRevision", "executionId", "originalRecipeRevision", "originalExecutionId", "directory", "workDirectory", "auditReceiptSha256"].some((k) => value[k] !== input[k])
      || ["files", "archiveProof", "identity"].some((k) => !isDeepStrictEqual(value[k], input[k]))) fail("proof_invalid");
    const gosu = value.gosu;
    if (!keys(gosu, ["containerId", "version", "package", "uid", "gid", "noNewPrivs", "path", "removedPath", "executableSha256"]) || !ID.test(gosu.containerId)
      || gosu.version !== lock.apk.versionOutput || gosu.package !== lock.apk.version || gosu.uid !== 70 || gosu.gid !== 70 || gosu.noNewPrivs !== 1
      || gosu.path !== lock.runtime.gosuPath || gosu.removedPath !== lock.runtime.removedPath || gosu.executableSha256 !== lock.apk.executable.sha256
      || !isDeepStrictEqual(value.tools, { server: "17.11", pgDump: "17.11", pgRestore: "17.11", createdb: "17.11" })) fail("proof_invalid");
    if (!Array.isArray(value.services) || value.services.length !== 4 || value.services.some((s, index) => !keys(s, ["role", "containerId", "uid", "gid", "noNewPrivs", "capabilities", "executable", "readiness", "sql", "stop"])
      || s.role !== ROLES[index + 1] || !ID.test(s.containerId) || !isDeepStrictEqual(s.uid, [70, 70, 70, 70]) || !isDeepStrictEqual(s.gid, [70, 70, 70, 70]) || s.noNewPrivs !== 1
      || !isDeepStrictEqual(s.capabilities, { inheritable: "0000000000000000", permitted: "0000000000000000", effective: "0000000000000000", ambient: "0000000000000000" })
      || !/^\/[^\s]{1,255}\/postgres$/u.test(s.executable) || s.readiness !== "PASSED" || s.stop !== "GRACEFUL"
      || !isDeepStrictEqual(s.sql, { schemaSha256: sha(postgresLocalSqlExpectedSchema), dataSha256: sha(postgresLocalSqlExpectedData) }))
      || new Set([gosu.containerId, ...value.services.map((s) => s.containerId)]).size !== 5) fail("proof_invalid");
    if (!keys(value.volumes, ["source", "restore"]) || ["source", "restore"].some((k) => !keys(value.volumes[k], ["name", "createdAt"])
      || value.volumes[k].name !== `aw-pg-restore-${nonce}-${k}-data` || !iso(value.volumes[k].createdAt))
      || !keys(value.backup, ["file", "tocSha256", "tocEntries"]) || !HEX.test(value.backup.tocSha256) || !Number.isSafeInteger(value.backup.tocEntries)
      || value.backup.tocEntries < 1 || value.backup.tocEntries > 4096 || value.sourceDisposed !== "CONFIRMED_BEFORE_RESTORE") fail("proof_invalid");
    const backup = validatePostgresSqlBackupProof(value.backup.file, path.posix.join(input.workDirectory, "backup"));
    if (backup.identity.uid !== input.files[0].identity.uid || backup.identity.gid !== input.files[0].identity.gid) fail("proof_invalid");
    if (!keys(value.audit, ["count", "firstCheckedAt", "lastCheckedAt", "validUntil", "receiptSha256"]) || !Number.isSafeInteger(value.audit.count)
      || value.audit.count < 10 || value.audit.count > 4096 || value.audit.receiptSha256 !== input.auditReceiptSha256
      || !["firstCheckedAt", "lastCheckedAt", "validUntil"].every((k) => iso(value.audit[k])) || Date.parse(value.audit.firstCheckedAt) > Date.parse(value.audit.lastCheckedAt)
      || Date.parse(value.audit.lastCheckedAt) >= Date.parse(value.audit.validUntil) || !keys(value.cleanup, ["containers", "volumes", "image", "environment"])
      || !isDeepStrictEqual(value.cleanup.containers, [gosu.containerId, ...value.services.map((s) => s.containerId)].map((id) => ({ id, state: "REMOVED" })))
      || !isDeepStrictEqual(value.cleanup.volumes, [value.volumes.source.name, value.volumes.restore.name].map((name) => ({ name, state: "REMOVED" })))
      || value.cleanup.image !== "REMOVED" || value.cleanup.environment !== "REMOVED" || !Array.isArray(value.phases) || value.phases.length !== 13
      || value.phases.some((p, index) => !keys(p, ["name", "result", "durationMs"]) || p.name !== postgresLocalRuntimeRestorePhases[index] || p.result !== "PASSED"
        || !Number.isSafeInteger(p.durationMs) || p.durationMs < 0 || p.durationMs > ENGINE_MS + CLEANUP_MS)
      || ["registryRead", "registryWrite", "signing"].some((k) => value[k] !== "NOT_ATTEMPTED") || value.admission !== "NOT_AUTHORIZED"
      || ["supportStartedAt", "supportEndsAt", "archiveUntil"].some((k) => value[k] !== null)) fail("proof_invalid");
    return freeze(globalThis.structuredClone(value));
  } catch { fail("proof_invalid"); }
}

export async function verifyLocalPostgresRuntimeAndSqlRestore(inputRaw, controls, dependencies = {}) {
  let phase = "CONTEXT"; let cleanupState = "UNVERIFIED"; let work; let controller; let outcome; let failure;
  try {
    const input = inputValue(inputRaw);
    if (process.platform !== "linux" || !(process.getuid?.() > 0) || !(process.getgid?.() > 0) || process.geteuid?.() !== process.getuid() || process.getegid?.() !== process.getgid()) fail("requires_nonroot_linux");
    if (input.files.some((v) => v.identity.uid !== process.getuid() || v.identity.gid !== process.getgid())) fail("storage_invalid");
    if (!keys(controls, ["authorize", "beforeExecution"]) || !Object.values(controls).every((v) => typeof v === "function") || !plain(dependencies)
      || Object.keys(dependencies).some((k) => !["transport", "sqlTransport"].includes(k)) || !Object.values(dependencies).every((v) => typeof v === "function")) fail("arguments_invalid");
    if (process.platform !== "linux" || !(process.getuid?.() > 0) || !(process.getgid?.() > 0) || process.geteuid?.() !== process.getuid() || process.getegid?.() !== process.getgid()) fail("requires_nonroot_linux");
    const lock = lockInputs(); const nonce = input.executionId.slice("local-pg-restore-".length); controller = new globalThis.AbortController();
    const signal = globalThis.AbortSignal.any([controller.signal, globalThis.AbortSignal.timeout(ENGINE_MS), ...(input.signal ? [input.signal] : [])]);
    const started = Date.now(); let cleanupDeadline; const check = () => { if (signal.aborted) fail(input.signal?.aborted ? "aborted" : "deadline_exceeded"); };
    work = workSession(input);
    outcome = await withVerifiedPostgresPrivateCandidate(input, { check }, async (session) => {
      const { material, assertFiles, env, cwd } = session; const transport = dependencies.transport ?? postgresCandidateCommandTransport;
      const sqlTransport = dependencies.sqlTransport ?? postgresSqlCommandTransport;
      const phases = []; const owned = new Map(); const volumes = new Map(); const removed = []; const removedVolumes = []; const services = [];
      let configuration; let imageLoaded = false; let imageVerified = false; let loadAttempted = false; let probe; let backup; let sourceDisposed = false; let audit; let primary;
      const record = async (name, action) => { phase = name; const at = Date.now(); const value = await action(); phases.push({ name, result: "PASSED", durationMs: Date.now() - at }); return value; };
      const localCheck = (cleanup) => { if (cleanup) { if (Date.now() >= cleanupDeadline) fail("cleanup_uncertain"); } else check(); work.check(); assertFiles(); };
      const authorize = async () => { let ack;
        try { ack = await bounded(() => controls.authorize(phase), 10_000); } catch { fail("authorization_invalid"); }
        if (!isDeepStrictEqual(ack, { state: "VERIFIED", purpose: PURPOSE, phase, daemonId: input.identity.daemonId, endpoint: input.identity.endpoint })) fail("authorization_invalid"); };
      const beforeExecution = async () => {
        let ack; try { ack = await bounded(() => controls.beforeExecution(phase), 30_000, signal); } catch { fail("audit_invalid"); }
        if (!keys(ack, ["state", "purpose", "phase", "daemonId", "endpoint", "auditReceiptSha256", "checkedAt", "validUntil"])
          || ack.state !== "VERIFIED_CURRENT" || ack.purpose !== PURPOSE || ack.phase !== phase || ack.daemonId !== input.identity.daemonId
          || ack.endpoint !== input.identity.endpoint || ack.auditReceiptSha256 !== input.auditReceiptSha256 || !iso(ack.checkedAt) || !iso(ack.validUntil)) fail("audit_invalid");
        return ack;
      };
      const call = async (args, opts = {}) => {
        const cleanup = opts.cleanup === true; localCheck(cleanup); await authorize(); localCheck(cleanup);
        const executed = ["create", "start", "exec"].includes(args[0]) || args[0] === "volume" && args[1] === "create";
        const grant = executed ? await beforeExecution() : undefined; let spawned = false; let observed;
        const beforeSpawn = () => {
          localCheck(cleanup); const now = Date.now();
          if (grant && (Date.parse(grant.checkedAt) > now || now - Date.parse(grant.checkedAt) > 5000 || now >= Date.parse(grant.validUntil))) fail("audit_invalid");
          if (spawned) fail("command_failed"); spawned = true;
          if (grant) { audit ??= { count: 0, firstCheckedAt: grant.checkedAt, lastCheckedAt: grant.checkedAt, validUntil: grant.validUntil, receiptSha256: grant.auditReceiptSha256 };
            audit.count += 1; if (audit.count > 4096 || Date.parse(grant.checkedAt) < Date.parse(audit.lastCheckedAt)) fail("audit_invalid"); audit.lastCheckedAt = grant.checkedAt;
            if (Date.parse(grant.validUntil) < Date.parse(audit.validUntil)) audit.validUntil = grant.validUntil; }
        };
        try {
          observed = await bounded(() => (opts.sql ? sqlTransport : transport)("/usr/bin/docker", Object.freeze(["--host", input.identity.endpoint, ...args]), Object.freeze({
            cwd, env, signal: cleanup ? globalThis.AbortSignal.timeout(Math.max(1, cleanupDeadline - Date.now())) : signal,
            timeoutMs: Math.max(1, Math.min(opts.timeoutMs ?? 90_000, cleanup ? cleanupDeadline - Date.now() : ENGINE_MS - (Date.now() - started))), maxBuffer: CAP,
            beforeSpawn, ...(opts.inputFd === undefined ? {} : { inputFd: opts.inputFd }), ...(opts.inputBytes === undefined ? {} : { inputBytes: opts.inputBytes }),
            ...(opts.outputSink ? { outputSink: opts.outputSink } : {}) })), cleanup ? cleanupDeadline - Date.now() : ENGINE_MS - (Date.now() - started), cleanup ? undefined : signal);
        } finally { await authorize(); }
        if (!spawned) fail("command_failed"); localCheck(cleanup); return output(observed, opts.allowed ?? [0]);
      };
      const inspect = async (kind, name, cleanup = false) => call([kind, "inspect", "--format", "{{json .}}", name], { allowed: [0, 1], cleanup });
      const inspectImage = async (cleanup = false) => { const value = parse((await call(["image", "inspect", "--format", "{{json .}}", input.policy.candidate.imageId], { cleanup })).stdout);
        try { validatePostgresSavedImageInspection(value, input, configuration); } catch { fail("image_invalid"); } };
      const inventory = async (cleanup = false, expectedContainers = [...owned.values()].map((e) => e.id), expectedVolumes = [...volumes.keys()]) => {
        const expected = [["image", [imageLoaded ? input.policy.candidate.imageId : ""]], ["container", expectedContainers], ["volume", expectedVolumes]];
        for (const [kind, ids] of expected) { const result = await call(kind === "volume" ? ["volume", "ls", "--quiet"] : [kind, "ls", "--all", "--quiet", "--no-trunc"], { cleanup });
          const listed = result.stdout.toString("utf8").trimEnd(); const observed = listed === "" ? [] : listed.split("\n");
          if (!isDeepStrictEqual(observed.sort(), ids.filter(Boolean).sort()) || new Set(observed).size !== observed.length) fail("inventory_invalid"); }
      };
      const volumeInspection = async (entry, cleanup = false) => { const result = await inspect("volume", entry.name, cleanup);
        if (result.status !== 0) fail("volume_invalid"); let value;
        try { value = validatePostgresLocalRuntimeVolume(parse(result.stdout), entry.name, nonce, Date.now(), entry.createdAt, entry.role); } catch { fail("volume_invalid"); }
        if (entry.mountpoint !== undefined && value.Mountpoint !== entry.mountpoint) fail("volume_invalid"); return value; };
      const containerInspection = async (entry, cleanup = false, freshVolume = true) => {
        const result = await inspect("container", entry.name, cleanup); if (result.status !== 0) fail("container_invalid"); const value = parse(result.stdout);
        const volume = entry.volume ? freshVolume ? await volumeInspection(entry.volume, cleanup) : entry.volume.value : undefined;
        try { validatePostgresLocalRuntimeContainer(value, entry, { imageId: input.policy.candidate.imageId, config: configuration.config }, nonce, entry.expectedEnv, lock, volume); }
        catch { fail("container_invalid"); }
        if (entry.id === null) { if ([...removed.map((e) => e.id), ...[...owned.values()].filter((e) => e !== entry).map((e) => e.id)].includes(value.Id)) fail("distinct_container_invalid"); entry.id = value.Id; }
        return value;
      };
      const removeContainer = async (entry, cleanup = false) => {
        let value = await containerInspection(entry, cleanup);
        if (entry.role !== "probe" || value.State?.Status !== "exited") { await call(["stop", "--time", "30", entry.id], { cleanup }); value = await containerInspection(entry, cleanup); }
        if (value.State?.Status !== "exited" || value.State?.Running !== false || value.State?.Pid !== 0 || value.State?.Dead !== false
          || !cleanup && value.State?.ExitCode !== 0) fail("stop_invalid");
        await call(["container", "rm", entry.id], { cleanup });
        if (!isPostgresRuntimeObjectAbsent(await inspect("container", entry.name, cleanup), "container", entry.name)) fail("cleanup_uncertain");
        owned.delete(entry.role); removed.push({ id: entry.id, state: "REMOVED" });
      };
      const removeVolume = async (entry, cleanup = false) => { await volumeInspection(entry, cleanup); await call(["volume", "rm", entry.name], { cleanup });
        if (!isPostgresRuntimeObjectAbsent(await inspect("volume", entry.name, cleanup), "volume", entry.name)) fail("cleanup_uncertain"); volumes.delete(entry.name); removedVolumes.push({ name: entry.name, state: "REMOVED" }); };
      const createVolume = async (role) => { const name = `aw-pg-restore-${nonce}-${role}`;
        if (!isPostgresRuntimeObjectAbsent(await inspect("volume", name), "volume", name)) fail("name_occupied"); const entry = { name, role }; volumes.set(name, entry);
        const value = await call(["volume", "create", "--driver", "local", ...Object.entries(postgresLocalRuntimeLabels(nonce, role)).flatMap(([k, v]) => ["--label", `${k}=${v}`]), name]);
        if (value.stdout.toString("utf8").trim() !== name) fail("volume_invalid"); const inspected = await volumeInspection(entry); entry.createdAt = inspected.CreatedAt; entry.mountpoint = inspected.Mountpoint; entry.value = inspected; return entry; };
      const createContainer = async (role, volume, environment) => {
        const entry = { role, name: `aw-pg-restore-${nonce}-${role}`, id: null, volume, expectedEnv: environment ? { ...validatePostgresRuntimeEnvironment(configuration.config.Env), ...environment.variables } : validatePostgresRuntimeEnvironment(configuration.config.Env) };
        if (role === "probe") entry.command = postgresRuntimeGosuCommand(lock);
        if (!isPostgresRuntimeObjectAbsent(await inspect("container", entry.name), "container", entry.name)) fail("name_occupied");
        const args = postgresLocalRuntimeCreateArguments(entry, { imageId: input.policy.candidate.imageId }, nonce, lock);
        if (role === "probe") args.push("--entrypoint", "/bin/sh", input.policy.candidate.imageId, ...entry.command);
        else args.push("--env-file", environment.file, "--mount", `type=volume,src=${volume.name},dst=${postgresRuntimeProfileContract.pgdata},volume-nocopy`, input.policy.candidate.imageId);
        owned.set(role, entry); const result = await call(args); const id = result.stdout.toString("utf8").trim();
        if (!ID.test(id) || [...removed.map((e) => e.id), ...[...owned.values()].filter((e) => e !== entry).map((e) => e.id)].includes(id)) fail("distinct_container_invalid");
        entry.id = id; await containerInspection(entry); await inventory(); return entry;
      };
      const execArgs = (entry, command, input = false) => ["exec", ...(input ? ["--interactive"] : []), "--user", "70:70", ...SQL_ENV.flatMap((v) => ["--env", v]), entry.id, ...command];
      const exec = async (entry, command, opts = {}) => call(execArgs(entry, command, opts.inputFd !== undefined), opts);
      const psql = async (entry, sql, maintenance = false) => exec(entry, ["psql", ...SQL_CONNECTION, `--dbname=${maintenance ? "postgres" : "awdiag"}`, "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", sql]);
      const ready = async (entry) => {
        const deadline = Math.min(Date.now() + 60_000, started + ENGINE_MS); let polls = 0;
        while (polls++ < 60 && Date.now() < deadline) {
          const state = (await containerInspection(entry, false, false)).State; // One inspect and two exec commands per poll.
          if (!plain(state) || state.Running !== true || state.Paused !== false || state.Restarting !== false || state.Dead !== false) fail("container_invalid");
          const observed = processProof((await exec(entry, ["/bin/sh", "-ec", PROCESS_SCRIPT], { timeoutMs: deadline - Date.now() })).stdout);
          const readiness = await exec(entry, ["pg_isready", ...SQL_CONNECTION.filter((v) => v !== "--no-password"), "--dbname=postgres", "--quiet"], { allowed: [0, 1, 2], timeoutMs: deadline - Date.now() });
          if (observed && readiness.status === 0 && Date.now() < deadline) return observed;
          await bounded(() => new Promise((resolve) => setTimeout(resolve, 1000)), Math.max(1, deadline - Date.now()), signal);
        } fail("readiness_timeout");
      };
      const launch = async (role, volume, environment) => { const entry = await createContainer(role, volume, environment); await containerInspection(entry); await call(["start", entry.id]); entry.process = await ready(entry); return entry; };
      const readSql = async (entry) => { await psql(entry, CHECK_SQL); const schema = parse((await psql(entry, SCHEMA_SQL)).stdout, "sql_invalid"); const data = parse((await psql(entry, DATA_SQL)).stdout, "sql_invalid");
        if (!isDeepStrictEqual(schema, postgresLocalSqlExpectedSchema) || !isDeepStrictEqual(data, postgresLocalSqlExpectedData)) fail("sql_invalid");
        return { schemaSha256: sha(schema), dataSha256: sha(data) }; };
      const serviceProof = (entry, sql) => ({ role: entry.role, containerId: entry.id, ...entry.process, readiness: "PASSED", sql, stop: "GRACEFUL" });
      const tools = async (entry) => {
        for (const name of ["pg_dump", "pg_restore", "createdb"]) if (!(await exec(entry, [name, "--version"])).stdout.equals(Buffer.from(`${name} (PostgreSQL) 17.11\n`))) fail("tools_invalid");
        if (!(await psql(entry, "SHOW server_version;", true)).stdout.equals(Buffer.from("17.11\n"))) fail("tools_invalid");
      };
      let sourceVolume; let restoreVolume; let sourceEnv; let restoreEnv;
      try {
        await record("PREFLIGHT", async () => { configuration = material().configuration; serviceConfig(configuration); localCheck(false);
          if (!(await call(["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"])).stdout.equals(Buffer.from("28.0.4|28.0.4\n"))) fail("image_invalid");
          try { validatePostgresIsolatedDaemonInfo(parse((await call(["info", "--format", "{{json .}}"])).stdout), input.identity); } catch { fail("image_invalid"); } await inventory(); });
        await record("LOAD", async () => { material(); loadAttempted = true; await call(["image", "load"], { inputFd: session.inputFd }); imageLoaded = true;
          await inventory(); await inspectImage(); if (!isDeepStrictEqual(material().configuration, configuration)) fail("archive_invalid"); imageVerified = true; });
        await record("PROBE", async () => { const entry = await createContainer("probe"); const result = await call(["start", "--attach", entry.id]);
          if (result.stdout.toString().trim() !== `${lock.apk.versionOutput}\nuid=70\ngid=70\nnnp=1`) fail("gosu_invalid");
          probe = { containerId: entry.id, version: lock.apk.versionOutput, package: lock.apk.version, uid: 70, gid: 70, noNewPrivs: 1,
            path: lock.runtime.gosuPath, removedPath: lock.runtime.removedPath, executableSha256: lock.apk.executable.sha256 }; await removeContainer(entry); });
        const source = await record("SOURCE_START", async () => { sourceEnv = work.createEnv("source"); sourceVolume = await createVolume("source-data"); return launch("source1", sourceVolume, sourceEnv); });
        const firstSql = await record("SOURCE_SQL", async () => { await tools(source); await exec(source, postgresLocalSqlCommands.createdb); await psql(source, postgresLocalSqlFixture); return readSql(source); });
        let source2;
        await record("SOURCE_RESTART", async () => { await removeContainer(source); services.push(serviceProof(source, firstSql)); source2 = await launch("source2", sourceVolume, sourceEnv);
          const sql = await readSql(source2); if (!isDeepStrictEqual(sql, firstSql)) fail("sql_invalid"); source2.sql = sql; });
        await record("DUMP", async () => { const directory = work.makeBackup(); const file = await dumpPostgresDiagnosticSql({ directory, signal }, { run: (opts) => exec(source2, postgresLocalSqlCommands.dump, { ...opts, sql: true }) });
          // The TOC command must receive the exact held dump bytes, just like restore.
          let tocResult; await restorePostgresDiagnosticSql({ proof: file, signal }, { run: async (opts) => { tocResult = await exec(source2, postgresLocalSqlCommands.toc, { ...opts, sql: true }); return tocResult; } });
          const lines = tocResult.stdout.toString("utf8").split("\n").filter((line) => /^[0-9]+; /u.test(line));
          if (lines.length < 1 || lines.length > 4096) fail("backup_invalid"); backup = { file, tocSha256: hash(tocResult.stdout), tocEntries: lines.length }; });
        await record("SOURCE_DISPOSE", async () => { await removeContainer(source2); services.push(serviceProof(source2, source2.sql)); await removeVolume(sourceVolume); await inventory(false, [], []); sourceDisposed = true; });
        const restored = await record("RESTORE_START", async () => { if (!sourceDisposed || owned.size || volumes.size) fail("inventory_invalid"); restoreEnv = work.createEnv("restore"); restoreVolume = await createVolume("restore-data"); return launch("restore1", restoreVolume, restoreEnv); });
        const restoredSql = await record("RESTORE_SQL", async () => { await tools(restored); await exec(restored, postgresLocalSqlCommands.createdb);
          if (!(await psql(restored, "SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname = 'aw_probe';")).stdout.equals(Buffer.from("0\n"))) fail("sql_invalid");
          await restorePostgresDiagnosticSql({ proof: backup.file, signal }, { run: (opts) => exec(restored, postgresLocalSqlCommands.restore, { ...opts, sql: true }) }); return readSql(restored); });
        await record("RESTORE_RESTART", async () => { await removeContainer(restored); services.push(serviceProof(restored, restoredSql)); const restored2 = await launch("restore2", restoreVolume, restoreEnv);
          const sql = await readSql(restored2); if (!isDeepStrictEqual(sql, firstSql)) fail("sql_invalid"); await removeContainer(restored2); services.push(serviceProof(restored2, sql)); });
      } catch (error) { primary = { reason: errorReason(error), phase }; controller.abort(); }
      cleanupDeadline = Date.now() + CLEANUP_MS;
      try {
        await record("CLEANUP", async () => {
          if (loadAttempted && !imageVerified) fail("cleanup_uncertain");
          for (const entry of [...owned.values()].reverse()) await removeContainer(entry, true);
          for (const entry of [...volumes.values()].reverse()) await removeVolume(entry, true);
          await inventory(true, [], []);
          if (imageVerified) { await inspectImage(true); await call(["image", "rm", input.archiveProof.tag], { cleanup: true }); imageLoaded = false; }
          await inventory(true, [], []); work.cleanup(); cleanupState = "CONFIRMED";
        });
      } catch { cleanupState = "UNVERIFIED"; throw Object.assign(new Error(PREFIX + "cleanup_uncertain"), { phase: "CLEANUP", cleanup: cleanupState }); }
      if (primary) throw Object.assign(new Error(PREFIX + primary.reason), { phase: primary.phase, cleanup: cleanupState });
      await record("FINAL_SEAL", async () => { await authorize(); if (!isDeepStrictEqual(material().configuration, configuration) || !isDeepStrictEqual(sealPostgresSqlBackup(backup.file), backup.file)) fail("files_changed"); await authorize(); });
      return validatePostgresLocalRuntimeRestoreProof({ kind: "POSTGRES_LOCAL_RUNTIME_SQL_RESTORE_PROOF_V1", state: "VERIFIED", authority: "LOCAL_DIAGNOSTIC",
        recipeRevision: input.recipeRevision, executionId: input.executionId, originalRecipeRevision: input.originalRecipeRevision, originalExecutionId: input.originalExecutionId,
        directory: input.directory, files: input.files, archiveProof: input.archiveProof, identity: input.identity, workDirectory: input.workDirectory, auditReceiptSha256: input.auditReceiptSha256,
        filesystem: "EXT4", subject: input.policy.subject, imageId: input.policy.candidate.imageId, diffIds: input.policy.candidate.diffIds, tag: input.archiveProof.tag, configurationComparison: "EXACT_ARCHIVE_CONFIGURATION",
        gosu: probe, tools: { server: "17.11", pgDump: "17.11", pgRestore: "17.11", createdb: "17.11" }, services,
        volumes: { source: { name: sourceVolume.name, createdAt: sourceVolume.createdAt }, restore: { name: restoreVolume.name, createdAt: restoreVolume.createdAt } },
        backup, sourceDisposed: "CONFIRMED_BEFORE_RESTORE", audit, cleanup: { containers: removed, volumes: removedVolumes, image: "REMOVED", environment: "REMOVED" }, phases,
        registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null }, input);
    });
  } catch (error) {
    controller?.abort(); const diagnostic = postgresLocalRuntimeRestoreFailureDiagnostic(error);
    if (diagnostic.code === PREFIX + "cleanup_uncertain") cleanupState = "UNVERIFIED";
    failure = phase === "CLEANUP" && cleanupState !== "CONFIRMED" || diagnostic.code === PREFIX + "cleanup_uncertain"
      ? Object.assign(new Error(PREFIX + "cleanup_uncertain"), { phase: "CLEANUP", cleanup: "UNVERIFIED" })
      : Object.assign(new Error(diagnostic.code), { phase: diagnostic.phase === "CONTEXT" ? phase : diagnostic.phase, cleanup: cleanupState });
  } finally { controller?.abort(); try { work?.close(); } catch { failure = Object.assign(new Error(PREFIX + "cleanup_uncertain"), { phase: "CLEANUP", cleanup: "UNVERIFIED" }); } }
  if (failure) throw failure; return outcome;
}
