import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const directory = new URL("../../infra/migrations/", import.meta.url);
const up = readFileSync(new URL("0001-foundation.up.sql", directory), "utf8");
const down = readFileSync(new URL("0001-foundation.down.sql", directory), "utf8");

export function migrationChecksum(upSql, downSql) {
  return createHash("sha256").update("aw-migration-0001\0").update(upSql).update("\0").update(downSql).digest("hex");
}

export const migration = Object.freeze({ version: 1, up, down, checksum: migrationChecksum(up, down) });

// Values enter SQL through an exact UTF-8 byte encoding, never quote interpolation.
// This is for bounded synthetic probes, not an application ingestion API.
export function sqlText(value) {
  if (typeof value !== "string" || value.includes("\0") || !value.isWellFormed() || Buffer.byteLength(value) > 1048576) {
    throw new Error("infra_invalid_sql_value");
  }
  return `convert_from(decode('${Buffer.from(value).toString("hex")}', 'hex'), 'UTF8')`;
}

const bootstrap = `
IF to_regnamespace('aw_migration') IS NULL THEN
  CREATE SCHEMA aw_migration AUTHORIZATION aw_migrator;
  REVOKE ALL ON SCHEMA aw_migration FROM PUBLIC;
  CREATE TABLE aw_migration.version (
    version integer PRIMARY KEY CHECK (version > 0),
    checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$')
  );
  CREATE TABLE aw_migration.event (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version integer NOT NULL REFERENCES aw_migration.version ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('up', 'down')),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
  );
  CREATE INDEX event_version_sequence_idx ON aw_migration.event (version, sequence DESC);
  CREATE FUNCTION aw_migration.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $ledger$
  BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'immutable_migration_history'; END
  $ledger$;
  REVOKE ALL ON FUNCTION aw_migration.reject_mutation() FROM PUBLIC;
  CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON aw_migration.version
    FOR EACH ROW EXECUTE FUNCTION aw_migration.reject_mutation();
  CREATE TRIGGER immutable_version_truncate BEFORE TRUNCATE ON aw_migration.version
    FOR EACH STATEMENT EXECUTE FUNCTION aw_migration.reject_mutation();
  CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON aw_migration.event
    FOR EACH ROW EXECUTE FUNCTION aw_migration.reject_mutation();
  CREATE TRIGGER immutable_event_truncate BEFORE TRUNCATE ON aw_migration.event
    FOR EACH STATEMENT EXECUTE FUNCTION aw_migration.reject_mutation();
END IF;`;

export function migrationSql(direction = "up", definition = migration) {
  if (!["up", "down"].includes(direction) || definition.version !== 1 ||
      !/^[a-f0-9]{64}$/u.test(definition.checksum) ||
      definition.checksum !== migrationChecksum(definition.up, definition.down)) {
    throw new Error("infra_invalid_migration");
  }
  const body = definition[direction];
  if (body.includes("$migration_body$") || body.includes("$migration_run$")) throw new Error("infra_invalid_migration");
  return `BEGIN;
SET LOCAL statement_timeout = '25s';
SET LOCAL lock_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '25s';
SET LOCAL search_path = pg_catalog;
SELECT pg_advisory_xact_lock(109624, 1);
DO $migration_run$
DECLARE known_checksum text; previous_action text;
BEGIN
  ${bootstrap}
  SELECT checksum INTO known_checksum FROM aw_migration.version WHERE version = 1;
  IF known_checksum IS NOT NULL AND known_checksum <> '${definition.checksum}' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'migration_checksum_drift';
  END IF;
  SELECT action INTO previous_action FROM aw_migration.event WHERE version = 1 ORDER BY sequence DESC LIMIT 1;
  IF (previous_action = 'up') IS DISTINCT FROM (to_regnamespace('aw_foundation') IS NOT NULL) AND previous_action IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'migration_schema_state_mismatch';
  END IF;
  IF coalesce(previous_action, 'down') <> '${direction}' THEN
    EXECUTE $migration_body$${body}$migration_body$;
    IF known_checksum IS NULL THEN
      INSERT INTO aw_migration.version (version, checksum) VALUES (1, '${definition.checksum}');
    END IF;
    INSERT INTO aw_migration.event (version, action) VALUES (1, '${direction}');
  END IF;
END
$migration_run$;
COMMIT;`;
}

export async function migrate(state, direction = "up") {
  const { sql } = await import("./runtime.mjs");
  await sql(state, migrationSql(direction), { role: "migrator", timeoutMs: 30000 });
}
