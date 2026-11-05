import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "../data-infra/runtime.mjs";

const directory = new URL("../../services/ingestion/prototype/migrations/", import.meta.url);

export function migrationChecksum(up, down) {
  return createHash("sha256").update("aw-connector-migration-1\0").update(up).update("\0").update(down).digest("hex");
}

export function readMigration() {
  const up = readFileSync(new URL("0001-connector-store.up.sql", directory), "utf8");
  const down = readFileSync(new URL("0001-connector-store.down.sql", directory), "utf8");
  return Object.freeze({ version: 1, up, down, checksum: migrationChecksum(up, down) });
}

// Trusted repository SQL only. Application values never enter this DDL generator.
export function migrationSql(direction = "up", definition = readMigration()) {
  if (!["up", "down"].includes(direction) || definition.version !== 1 ||
      typeof definition.up !== "string" || typeof definition.down !== "string" ||
      !/^[a-f0-9]{64}$/u.test(definition.checksum) ||
      definition.checksum !== migrationChecksum(definition.up, definition.down) ||
      /\$connector_(?:body|migration)\$/u.test(definition.up + definition.down)) {
    throw new Error("prototype_invalid_migration");
  }
  return `BEGIN;
SET LOCAL statement_timeout = '25s';
SET LOCAL lock_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '25s';
SET LOCAL search_path = pg_catalog;
SELECT pg_advisory_xact_lock(109624, 104);
DO $connector_migration$
DECLARE known_checksum text; previous_action text; schema_present boolean;
BEGIN
  IF to_regnamespace('aw_connector_migration') IS NULL THEN
    CREATE SCHEMA aw_connector_migration AUTHORIZATION aw_migrator;
    REVOKE ALL ON SCHEMA aw_connector_migration FROM PUBLIC;
    CREATE TABLE aw_connector_migration.version (
      version integer PRIMARY KEY CHECK (version = 1),
      checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$')
    );
    CREATE TABLE aw_connector_migration.event (
      sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      version integer NOT NULL REFERENCES aw_connector_migration.version,
      action text NOT NULL CHECK (action IN ('up', 'down')),
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE FUNCTION aw_connector_migration.reject_mutation() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog AS $immutable$
    BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'immutable_migration_history'; END
    $immutable$;
    REVOKE ALL ON FUNCTION aw_connector_migration.reject_mutation() FROM PUBLIC;
    CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON aw_connector_migration.version
      FOR EACH ROW EXECUTE FUNCTION aw_connector_migration.reject_mutation();
    CREATE TRIGGER immutable_version_truncate BEFORE TRUNCATE ON aw_connector_migration.version
      FOR EACH STATEMENT EXECUTE FUNCTION aw_connector_migration.reject_mutation();
    CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON aw_connector_migration.event
      FOR EACH ROW EXECUTE FUNCTION aw_connector_migration.reject_mutation();
    CREATE TRIGGER immutable_event_truncate BEFORE TRUNCATE ON aw_connector_migration.event
      FOR EACH STATEMENT EXECUTE FUNCTION aw_connector_migration.reject_mutation();
  END IF;
  SELECT checksum INTO known_checksum FROM aw_connector_migration.version WHERE version = 1;
  IF known_checksum IS NOT NULL AND known_checksum <> '${definition.checksum}' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'migration_checksum_drift';
  END IF;
  SELECT action INTO previous_action FROM aw_connector_migration.event
    WHERE version = 1 ORDER BY sequence DESC LIMIT 1;
  schema_present := to_regnamespace('aw_connector') IS NOT NULL;
  IF schema_present IS DISTINCT FROM (coalesce(previous_action, 'down') = 'up') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'migration_schema_state_mismatch';
  END IF;
  IF coalesce(previous_action, 'down') <> '${direction}' THEN
    EXECUTE $connector_body$${definition[direction]}$connector_body$;
    IF known_checksum IS NULL THEN
      INSERT INTO aw_connector_migration.version (version, checksum) VALUES (1, '${definition.checksum}');
    END IF;
    INSERT INTO aw_connector_migration.event (version, action) VALUES (1, '${direction}');
  END IF;
END
$connector_migration$;
COMMIT;`;
}

export async function migrate(state, direction = "up") {
  await sql(state, migrationSql(direction), { role: "migrator", timeoutMs: 30_000 });
}
