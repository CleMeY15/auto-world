import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  root, initProject, withProjectLock, compose, sql, port, reset, stop,
} from "../data-infra/runtime.mjs";
import { discardTestProject } from "../data-infra/ephemeral.mjs";
import { withCancellation, protectedRecovery } from "../data-infra/cancellation.mjs";
import { migrate, migrationSql, readMigration, migrationChecksum } from "./migrations.mjs";

const require = createRequire(new URL("../../services/ingestion/package.json", import.meta.url));
const { Pool } = require("pg");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tables = ["sources", "runs", "inventories", "raw_pages", "listing_versions", "observations", "tombstones", "projections", "attempts", "mutations", "outbox"];

function sourceIdentity() {
  try {
    const options = { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    return {
      sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
      sourceDirty: execFileSync("git", ["status", "--porcelain"], options).trim() !== "",
    };
  } catch {
    // A Windows worktree mounted in WSL has a host-native .git pointer.
    // Never invent a clean revision when Git cannot resolve that pointer.
    return { sourceRevision: null, sourceDirty: null };
  }
}

async function startPostgres(state) {
  await compose(state, ["up", "--detach", "--wait", "--wait-timeout", "180", "postgres"], { timeoutMs: 240_000 });
}

async function openPool(state, role = "migrator") {
  const connection = { host: "127.0.0.1", port: await port(state, "postgres", 5432),
    database: "autoworld", user: `aw_${role}`, password: state.credentials[role === "migrator" ? "pgMigrator" : "pgWriter"],
    max: 4, connectionTimeoutMillis: 5_000, statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 15_000 };
  const pool = new Pool(connection);
  pool.on("error", () => {});
  return pool;
}

async function snapshot(pool) {
  const result = {};
  for (const table of tables) {
    // Names are a fixed local allowlist, never caller input. to_jsonb encodes bytea exactly.
    const rows = await pool.query(`SELECT to_jsonb(t) AS row FROM aw_connector.${table} t ORDER BY to_jsonb(t)::text COLLATE "C"`);
    result[table] = rows.rows.map((item) => item.row);
  }
  return result;
}

async function requireEmptyRestoreTarget(state) {
  assert.ok(state.project.startsWith("aw-test-"));
  const present = await sql(state, "SELECT to_regnamespace('aw_connector') IS NOT NULL OR to_regnamespace('aw_connector_migration') IS NOT NULL", { role: "migrator" });
  if (present.trim() !== "f") throw new Error("prototype_restore_target_nonempty");
}

async function dumpDatabase(state) {
  const result = await compose(state, ["exec", "--no-TTY", "--env", `PGPASSWORD=${state.credentials.pgMigrator}`,
    "postgres", "sh", "-ec",
    "archive=$(mktemp /tmp/aw-prototype-XXXXXX); trap 'rm -f -- \"$archive\"' EXIT; pg_dump --username=aw_migrator --dbname=autoworld --format=custom --schema=aw_connector --schema=aw_connector_migration --file=\"$archive\"; base64 \"$archive\""], { timeoutMs: 60_000 });
  const encoded = result.stdout.replace(/\s/gu, "");
  assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/u);
  const archive = Buffer.from(encoded, "base64");
  assert.equal(archive.subarray(0, 5).toString("ascii"), "PGDMP");
  assert.equal(archive.toString("base64"), encoded);
  return archive;
}

async function restoreDatabase(state, archive) {
  await requireEmptyRestoreTarget(state);
  await compose(state, ["exec", "--no-TTY", "--env", `PGPASSWORD=${state.credentials.pgMigrator}`,
    "postgres", "pg_restore", "--username=aw_migrator", "--dbname=autoworld", "--single-transaction", "--exit-on-error", "--no-owner"],
  { input: archive, timeoutMs: 60_000 });
}

export async function runIntegration({ migrationsOnly = false } = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("prototype_production_forbidden");
  const startedAt = new Date().toISOString();
  const source = sourceIdentity();
  const schemaChecksum = readMigration().checksum;
  const runId = randomUUID();
  const evidenceDirectory = path.join(root, ".local-data", "prototype-postgres", runId);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const projects = [];
  const phases = [];
  let failure;
  const record = (name) => { phases.push({ name, status: "passed" }); console.log(`PASS ${name}`); };
  try {
    const source = await initProject({ test: true }); projects.push(source);
    await withProjectLock(source, async () => {
      await startPostgres(source);
      record("isolated-pinned-postgres-start");
      await migrate(source);
      await migrate(source);
      assert.equal((await sql(source, "SELECT count(*) FROM aw_connector_migration.event")).trim(), "1");
      await migrate(source, "down");
      await migrate(source, "down");
      await migrate(source);
      const definition = readMigration();
      const changed = { ...definition, up: definition.up + "\n-- drift" };
      changed.checksum = migrationChecksum(changed.up, changed.down);
      await assert.rejects(sql(source, migrationSql("up", changed)));
      assert.equal((await sql(source, "SELECT count(*) FROM aw_connector_migration.event")).trim(), "3");
      record("migration-apply-reapply-rollback-drift-refusal");

      let adminPool = await openPool(source);
      try {
        const privileges = await adminPool.query(`SELECT
          has_table_privilege('aw_writer','aw_connector.raw_pages','DELETE') AS can_delete,
          has_table_privilege('aw_writer','aw_connector.raw_pages','UPDATE') AS can_rewrite,
          has_table_privilege('aw_writer','aw_connector.raw_pages','TRUNCATE') AS can_truncate,
          has_table_privilege('aw_writer','aw_connector.raw_pages','INSERT') AS can_insert`);
        assert.deepEqual(privileges.rows[0], { can_delete: false, can_rewrite: false, can_truncate: false, can_insert: true });
        record("application-writer-privileges");
        if (!migrationsOnly) {
          const { runStoreScenarios } = await import("../../services/ingestion/test/integration.mjs");
          await runStoreScenarios({
            config: { host: "127.0.0.1", port: await port(source, "postgres", 5432), password: source.credentials.pgWriter },
            adminPool,
            onPhase: (name) => phases.push({ name, status: "passed" }),
            restart: async () => {
              await stop(source, ["postgres"]);
              await startPostgres(source);
              // Ephemeral published ports can change when the container restarts.
              // Rediscover the endpoint and discard both pools' stopped sessions.
              const config = { host: "127.0.0.1", port: await port(source, "postgres", 5432), password: source.credentials.pgWriter };
              const previousPool = adminPool;
              adminPool = await openPool(source);
              await previousPool.end();
              return { config, adminPool };
            },
          });
          await assert.rejects(migrate(source, "down"));
          await assert.rejects(requireEmptyRestoreTarget(source), /prototype_restore_target_nonempty/u);
          record("nonempty-rollback-and-restore-refusal");
          const before = await snapshot(adminPool);
          assert.ok(before.raw_pages.length > 0 && before.mutations.length > 0);
          assert.equal(before.outbox.length, before.mutations.length);
          for (const row of before.raw_pages) {
            const bytes = Buffer.from(row.raw_bytes.slice(2), "hex");
            assert.equal(hash(bytes), row.sha256);
            assert.equal(bytes.length, row.byte_length);
          }
          const archive = await dumpDatabase(source);
          const sentinel = await initProject({ test: true }); projects.push(sentinel);
          await withProjectLock(sentinel, async () => {
            await startPostgres(sentinel);
            await sql(sentinel, "CREATE SCHEMA aw_sentinel; CREATE TABLE aw_sentinel.probe (value integer PRIMARY KEY); INSERT INTO aw_sentinel.probe VALUES (104)");
            const target = await initProject({ test: true }); projects.push(target);
            await withProjectLock(target, async () => {
              await startPostgres(target);
              await restoreDatabase(target, archive);
              const restored = await openPool(target);
              try { assert.deepEqual(await snapshot(restored), before); }
              finally { await restored.end(); }
              await migrate(target); // Restored checksum history also remains valid.
              await assert.rejects(restoreDatabase(target, archive), /prototype_restore_target_nonempty/u);
              await reset(target);
            });
            assert.equal((await sql(sentinel, "SELECT value FROM aw_sentinel.probe")).trim(), "104");
          });
          record("pg-dump-restore-exact-bytes-ledger-sentinel");
        }
      } finally { await adminPool.end(); }
    });
  } catch (error) { failure = error; }
  finally {
    for (const state of projects.toReversed()) {
      try {
        await protectedRecovery(() => withProjectLock(state, async () => {
          await reset(state);
          await discardTestProject(state);
        }));
      } catch (error) { failure ??= error; }
    }
    if (!failure) record("owned-project-cleanup");
    await writeFile(path.join(evidenceDirectory, "result.json"), JSON.stringify({
      schemaVersion: 1, scope: "SYNTHETIC_V1_PROTOTYPE", imageQualification: "DEFERRED_UNTIL_V1",
      ...source, schemaChecksum,
      startedAt, finishedAt: new Date().toISOString(), mode: migrationsOnly ? "migration-only" : "full-store",
      status: failure ? "failed" : "passed", phases,
      failureCode: failure ? "prototype_integration_failed" : null,
    }, null, 2) + "\n", { mode: 0o600 });
  }
  if (failure) throw failure;
  return { phases, evidenceDirectory };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const unexpected = process.argv.slice(2).filter((arg) => arg !== "--migrations-only");
  if (unexpected.length) throw new Error("prototype_invalid_arguments");
  await withCancellation(async () => {
    try { await runIntegration({ migrationsOnly: process.argv.includes("--migrations-only") }); }
    catch (error) {
      // Fixed diagnostics only; SQL/driver messages can contain raw data or secrets.
      console.error(error instanceof assert.AssertionError ? `prototype_assertion_failed:${error.code}` : "prototype_integration_failed");
      if (typeof error.prototypePhase === "string" && /^[a-zA-Z0-9 _:/()-]{1,180}$/u.test(error.prototypePhase)) {
        console.error(`phase:${error.prototypePhase}`);
      }
      if (typeof error.prototypeReason === "string" && /^[a-z_]+:[a-z_]+$/u.test(error.prototypeReason)) {
        console.error(`reason:${error.prototypeReason}`);
      }
      const frame = error.stack?.split("\n").find((line) => /^\s+at .*services\/ingestion\/test\/integration\.mjs:\d+/u.test(line));
      if (frame) console.error(frame.trim());
      process.exitCode = 1;
    }
  }, { processExit: true });
}
