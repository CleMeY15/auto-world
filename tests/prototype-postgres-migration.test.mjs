import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  migrationChecksum,
  migrationSql,
  readMigration,
} from "../scripts/prototype-postgres/migrations.mjs";

const up = readFileSync(
  new URL("../services/ingestion/prototype/migrations/0001-connector-store.up.sql", import.meta.url),
  "utf8",
);
const down = readFileSync(
  new URL("../services/ingestion/prototype/migrations/0001-connector-store.down.sql", import.meta.url),
  "utf8",
);

test("checksum wrapper binds both migration directions and reapply state", () => {
  const migration = readMigration();
  assert.equal(migration.up, up);
  assert.equal(migration.down, down);
  assert.equal(migrationChecksum(up, down), migration.checksum);
  assert.notEqual(migrationChecksum(`${up}\n`, down), migration.checksum);
  const command = migrationSql("up", migration);
  assert.ok(command.startsWith("BEGIN;"));
  assert.ok(command.endsWith("COMMIT;"));
  assert.match(command, /pg_advisory_xact_lock\(109624, 104\)/u);
  assert.match(command, /migration_checksum_drift/u);
  assert.match(command, /migration_schema_state_mismatch/u);
  assert.doesNotMatch(command, /ON CONFLICT DO UPDATE|DROP CASCADE|SECURITY DEFINER/u);
});

// These checks lock the static migration contract. Real PostgreSQL apply/reapply,
// constraints, grants and rollback behavior are validated by the integration lane.
test("prototype connector migration defines the ADR-0029 ownership tables", () => {
  const tables = [
    "sources",
    "runs",
    "inventories",
    "raw_pages",
    "listing_versions",
    "observations",
    "tombstones",
    "projections",
    "attempts",
    "mutations",
    "outbox",
  ];
  for (const table of tables) {
    assert.match(up, new RegExp(`CREATE TABLE aw_connector\\.${table} \\(`, "u"));
  }
  assert.match(up, /CREATE SCHEMA aw_connector AUTHORIZATION aw_migrator/u);
  assert.doesNotMatch(up, /CREATE ROLE|CREATE EXTENSION|aw_foundation/u);
});

test("raw pages keep bytes and server-check their digest and length", () => {
  assert.match(up, /raw_bytes bytea NOT NULL/u);
  assert.match(up, /octet_length\(raw_bytes\) = byte_length/u);
  assert.match(up, /encode\(sha256\(raw_bytes\), 'hex'\) = sha256/u);
  assert.match(up, /BETWEEN 0 AND 1048576/u);
});

test("relational keys bind source run scope and raw provenance", () => {
  assert.match(up, /PRIMARY KEY \(source_id, run_id, snapshot_id\)/u);
  assert.match(up, /REFERENCES aw_connector\.raw_pages \(source_id, run_id, snapshot_id, sha256\) ON DELETE RESTRICT/u);
  assert.match(up, /REFERENCES aw_connector\.listing_versions \(source_id, run_id, listing_version_id, listing_id, snapshot_id, raw_sha256\) ON DELETE RESTRICT/u);
  assert.match(up, /REFERENCES aw_connector\.runs \(source_id, run_id, scope_id\) ON DELETE RESTRICT/u);
  assert.match(up, /REFERENCES aw_connector\.inventories ON DELETE RESTRICT/u);
  assert.match(up, /listing jsonb NOT NULL CHECK \(jsonb_typeof\(listing\) = 'object'\)/u);
  assert.match(up, /UNIQUE \(source_id, run_id, lease_fence, page_ordinal, attempt\)/u);
  assert.match(up, /semantic_command text NOT NULL/u);
});

test("immutable evidence and outbox reference one durable mutation", () => {
  for (const table of ["raw_pages", "listing_versions", "observations", "tombstones", "mutations", "outbox"]) {
    assert.ok(up.includes(`'${table}'`));
  }
  assert.match(up, /BEFORE UPDATE OR DELETE/u);
  assert.match(up, /BEFORE TRUNCATE/u);
  assert.match(up, /REFERENCES aw_connector\.mutations \(source_id, run_id, operation_key\) ON DELETE RESTRICT/u);
  const outboxDefinition = up.match(/CREATE TABLE aw_connector\.outbox \(([\s\S]*?)\n\);/u)?.[1] ?? "";
  assert.doesNotMatch(outboxDefinition, /receipt|semantic_command|payload/u);
});

test("writer grants mutation only on explicitly mutable state columns", () => {
  assert.match(up, /GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA aw_connector TO aw_writer/u);
  for (const table of ["sources", "runs", "inventories", "projections", "attempts"]) {
    assert.match(up, new RegExp(`GRANT UPDATE \\([^;]+\\) ON aw_connector\\.${table} TO aw_writer`, "u"));
  }
  for (const table of ["raw_pages", "listing_versions", "observations", "tombstones", "mutations", "outbox"]) {
    assert.doesNotMatch(up, new RegExp(`GRANT UPDATE[^;]*aw_connector\\.${table}`, "u"));
  }
  assert.doesNotMatch(up, /GRANT (?:DELETE|TRUNCATE)|GRANT ALL|SUPERUSER/u);
});

test("rollback is explicit and refuses populated application tables", () => {
  assert.match(down, /IN ACCESS EXCLUSIVE MODE/u);
  assert.match(down, /rollback_nonempty/u);
  assert.ok(down.indexOf("rollback_nonempty") < down.indexOf("DROP TABLE"));
  assert.doesNotMatch(down, /CASCADE|DELETE FROM|TRUNCATE/u);
  for (const contents of [up, down]) assert.ok(!contents.includes("\r"));
});
