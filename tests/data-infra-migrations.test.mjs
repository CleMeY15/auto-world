import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { migration, migrationChecksum, migrationSql, sqlText } from "../scripts/data-infra/migrations.mjs";

test("migration checksum covers both directions and is deterministic", () => {
  assert.equal(migrationChecksum(migration.up, migration.down), migration.checksum);
  assert.notEqual(migrationChecksum(`${migration.up}\n`, migration.down), migration.checksum);
  assert.notEqual(migrationChecksum(migration.up, `${migration.down}\n`), migration.checksum);
  assert.throws(() => migrationSql("up", { ...migration, checksum: "0".repeat(64) }), /invalid_migration/u);
  assert.throws(() => migrationSql("drop"), /invalid_migration/u);
});

test("migration serializes and records immutable history inside one bounded transaction", () => {
  const command = migrationSql();
  assert.ok(command.startsWith("BEGIN;"));
  assert.ok(command.endsWith("COMMIT;"));
  assert.match(command, /pg_advisory_xact_lock\(109624, 1\)/u);
  assert.match(command, /migration_checksum_drift/u);
  assert.match(command, /statement_timeout = '25s'/u);
  assert.match(command, /immutable_migration_history/u);
  assert.doesNotMatch(command, /ON CONFLICT DO UPDATE|DROP CASCADE|SECURITY DEFINER/u);
});

test("rollback is empty-only with explicit reverse dependency drops", () => {
  assert.match(migration.down, /ACCESS EXCLUSIVE MODE/u);
  assert.match(migration.down, /rollback_nonempty/u);
  assert.ok(migration.down.indexOf("rollback_nonempty") < migration.down.indexOf("DROP TABLE"));
  assert.doesNotMatch(migration.down, /CASCADE|DELETE FROM|TRUNCATE/u);
});

test("SQL probe encoding never embeds untrusted text or statement delimiters", () => {
  const hostile = "publication'); DROP SCHEMA anything; --🚗";
  const encoded = sqlText(hostile);
  assert.doesNotMatch(encoded, /DROP|publication|🚗/u);
  const hex = encoded.match(/decode\('([a-f0-9]*)'/u)[1];
  assert.equal(Buffer.from(hex, "hex").toString("utf8"), hostile);
  for (const value of [null, 1, "\0", "\ud800", "x".repeat(1048577)]) {
    assert.throws(() => sqlText(value), /invalid_sql_value/u);
  }
});

test("PostgreSQL initialization contains roles only and shell/SQL sources have LF endings", () => {
  const init = readFileSync(new URL("../infra/postgres-init.sh", import.meta.url), "utf8");
  assert.match(init, /NOBYPASSRLS/u);
  assert.doesNotMatch(init, /CREATE TABLE|CREATE SCHEMA|set -x/u);
  for (const contents of [init, migration.up, migration.down]) assert.ok(!contents.includes("\r"));
});
