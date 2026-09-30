import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { dumpPostgresDiagnosticSql, postgresSqlBackupLimits, postgresSqlCommandTransport, restorePostgresDiagnosticSql,
  sealPostgresSqlBackup, validatePostgresSqlBackupProof } from "../scripts/postgres-image/candidate-sql-backup-restore.mjs";

const linux = process.platform === "linux" && process.getuid() > 0 && process.getgid() > 0;
const hash = (v) => createHash("sha256").update(v).digest("hex");
const dump = Buffer.concat([Buffer.from("PGDMP"), Buffer.from([0, 1, 255]), Buffer.alloc(240_000, 0xff)]);
const signal = () => new globalThis.AbortController().signal;
function scope(t) { const directory = mkdtempSync("/tmp/aw-pg-sql-backup-"); chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true })); return directory; }
const options = (directory, abort = signal()) => ({ cwd: directory, env: { PATH: "/usr/bin:/bin" }, signal: abort, timeoutMs: 5000, beforeSpawn: () => {} });
async function makeDump(directory, abort = signal()) { return dumpPostgresDiagnosticSql({ directory, signal: abort }, { run: (stream) =>
  postgresSqlCommandTransport(process.execPath, ["-e", "process.stdout.write(Buffer.concat([Buffer.from('PGDMP'),Buffer.from([0,1,255]),Buffer.alloc(240000,255)]))"], { ...options(directory, abort), ...stream }) }); }
test("SQL backup proof is closed and does not claim full interpretation from a header", () => {
  const value = { kind: "POSTGRES_SQL_PRIVATE_DUMP_V1", state: "SEALED", directory: "/home/owned/backup", name: "diagnostic.dump",
    size: 8, sha256: "a".repeat(64), identity: { dev: "1", ino: "2", uid: 1000, gid: 1000, mode: 0o600, nlink: 1, mtimeNs: "1", ctimeNs: "1" },
    format: "POSTGRESQL_CUSTOM", interpretation: "NOT_FULLY_ESTABLISHED_BY_TRANSPORT" };
  assert.deepEqual(validatePostgresSqlBackupProof(value), value);
  for (const change of [(v) => { v.raw = "private"; }, (v) => { v.identity.nlink = 2; }, (v) => { v.directory = "/x/../owned"; },
    (v) => { v.identity.mode = 0o644; }, (v) => { v.size = postgresSqlBackupLimits.bytes + 1; }, (v) => { v.interpretation = "COMPLETE"; }]) {
    const changed = globalThis.structuredClone(value); change(changed); assert.throws(() => validatePostgresSqlBackupProof(changed), /postgres_sql_backup_proof_invalid/u);
  }
});
test("native dump streams binary privately, durably seals, and restores exactly from a held FD", { skip: !linux }, async (t) => {
  const directory = scope(t); const proof = await makeDump(directory); assert.equal(proof.size, dump.length); assert.equal(proof.sha256, hash(dump));
  assert.deepEqual(readFileSync(path.join(directory, "diagnostic.dump")), dump); assert.equal(lstatSync(path.join(directory, "diagnostic.dump")).mode & 0o777, 0o600);
  assert.deepEqual(sealPostgresSqlBackup(proof), proof); let observed;
  assert.deepEqual(await restorePostgresDiagnosticSql({ proof, signal: signal() }, { run: async (stream) => {
    const result = await postgresSqlCommandTransport(process.execPath, ["-e", "const c=require('node:crypto'),a=[];process.stdin.on('data',b=>a.push(b));process.stdin.on('end',()=>{const b=Buffer.concat(a);process.stdout.write(JSON.stringify({size:b.length,sha256:c.createHash('sha256').update(b).digest('hex')}));});"], { ...options(directory), ...stream });
    observed = JSON.parse(result.stdout); return result;
  } }), proof); assert.deepEqual(observed, { size: dump.length, sha256: hash(dump) });
});
test("native failed/overflowing/malformed dump is retained without successful proof", { skip: !linux }, async (t) => {
  for (const variant of ["failed", "overflow", "format", "count"]) await t.test(variant, async (sub) => {
    const directory = scope(sub); await assert.rejects(dumpPostgresDiagnosticSql({ directory, signal: signal() }, { run: async (stream) => {
      stream.outputSink(variant === "format" ? Buffer.from("other bytes") : dump);
      if (variant === "overflow") stream.outputSink(Buffer.alloc(postgresSqlBackupLimits.bytes));
      return { status: variant === "failed" ? 1 : 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), outputBytes: variant === "count" ? 1 : dump.length };
    } }), /postgres_sql_backup_/u); assert.ok(readFileSync(path.join(directory, "diagnostic.dump")).length > 0);
  });
});
test("native restore refuses changed bytes, substituted inode, mode and incomplete consumption", { skip: !linux }, async (t) => {
  for (const variant of ["bytes", "inode", "mode", "consumption", "after"]) await t.test(variant, async (sub) => {
    const directory = scope(sub); const proof = await makeDump(directory); const file = path.join(directory, "diagnostic.dump"); let calls = 0;
    if (variant === "bytes") writeFileSync(file, Buffer.from("PGDMP changed"));
    if (variant === "inode") { renameSync(file, file + ".old"); writeFileSync(file, dump, { mode: 0o600 }); }
    if (variant === "mode") chmodSync(file, 0o644);
    await assert.rejects(restorePostgresDiagnosticSql({ proof, signal: signal() }, { run: async () => { calls += 1;
      if (variant === "after") chmodSync(file, 0o644); return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), inputBytes: variant === "consumption" ? 0 : dump.length };
    } }), /postgres_sql_backup_/u); assert.equal(calls, ["after", "consumption"].includes(variant) ? 1 : 0);
  });
});
test("native transport abort closes binary pipes and bounds a stalled input consumer", { skip: !linux }, async (t) => {
  const directory = scope(t); const proof = await makeDump(directory); const controller = new globalThis.AbortController();
  const started = Date.now(); setTimeout(() => controller.abort(), 25);
  await assert.rejects(restorePostgresDiagnosticSql({ proof, signal: controller.signal }, { run: (stream) =>
    postgresSqlCommandTransport(process.execPath, ["-e", "process.stdin.pause();setInterval(()=>{},1000)"], { ...options(directory, controller.signal), ...stream }) }), /postgres_sql_backup_(?:transport_failed|aborted)/u);
  assert.ok(Date.now() - started < 3000); assert.deepEqual(sealPostgresSqlBackup(proof), proof);
});
