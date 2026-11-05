import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "../data-infra/runtime.mjs";

const directory = new URL("../../services/search/prototype/migrations/", import.meta.url);
export function migrationChecksum(up, down) {
  return createHash("sha256").update("aw-search-migration-1\0").update(up).update("\0").update(down).digest("hex");
}
export function readMigration() {
  const up = readFileSync(new URL("0001-search.up.sql", directory), "utf8");
  const down = readFileSync(new URL("0001-search.down.sql", directory), "utf8");
  return { version: 1, up, down, checksum: migrationChecksum(up, down) };
}
export function migrationSql(direction = "up", definition = readMigration()) {
  if (!["up", "down"].includes(direction) || definition.version !== 1 ||
      typeof definition.up !== "string" || typeof definition.down !== "string" ||
      definition.checksum !== migrationChecksum(definition.up, definition.down) ||
      /\$search_(?:body|migration)\$/u.test(definition.up + definition.down)) throw new Error("search_invalid_migration");
  return `BEGIN;
SET LOCAL statement_timeout = '25s'; SET LOCAL lock_timeout = '10s';
SET LOCAL search_path = pg_catalog;
SELECT pg_advisory_xact_lock(109624, 105);
CREATE SCHEMA IF NOT EXISTS aw_search_migration AUTHORIZATION aw_migrator;
REVOKE ALL ON SCHEMA aw_search_migration FROM PUBLIC;
CREATE TABLE IF NOT EXISTS aw_search_migration.history (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  checksum text NOT NULL, action text NOT NULL CHECK (action IN ('up','down')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION aw_search_migration.immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable$
BEGIN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='immutable_search_migration'; END
$immutable$;
REVOKE ALL ON FUNCTION aw_search_migration.immutable() FROM PUBLIC;
DO $search_migration$
DECLARE known text; previous text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='aw_search_migration.history'::regclass AND tgname='immutable_history') THEN
    CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON aw_search_migration.history
      FOR EACH STATEMENT EXECUTE FUNCTION aw_search_migration.immutable();
  END IF;
  SELECT checksum, action INTO known, previous FROM aw_search_migration.history ORDER BY sequence DESC LIMIT 1;
  IF known IS NOT NULL AND known <> '${definition.checksum}' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_checksum_drift';
  END IF;
  IF (to_regnamespace('aw_search') IS NOT NULL) IS DISTINCT FROM (coalesce(previous,'down')='up') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_state_mismatch';
  END IF;
  IF coalesce(previous,'down') <> '${direction}' THEN
    EXECUTE $search_body$${definition[direction]}$search_body$;
    INSERT INTO aw_search_migration.history(checksum,action) VALUES ('${definition.checksum}','${direction}');
  END IF;
END
$search_migration$;
COMMIT;`;
}
export async function migrate(state, direction = "up") {
  await sql(state, migrationSql(direction), { role: "migrator", timeoutMs: 30_000 });
}

export function deriveRoleCredentials(state) {
  if (!/^[a-f0-9]{64}$/u.test(state?.credentials?.pgBootstrap)) throw new Error("search_credentials_invalid");
  const derive = (role) => createHmac("sha256", Buffer.from(state.credentials.pgBootstrap, "hex"))
    .update(`auto-world-search-prototype-v1\0${role}`).digest("hex");
  return Object.freeze({ workerPassword: derive("worker"), apiPassword: derive("api") });
}

// The owned-project runtime validates state and carries bootstrap credentials over
// stdin. Neither the SQL nor the derived application secrets are evidence/log data.
export async function provisionRoles(state) {
  const { workerPassword, apiPassword } = deriveRoleCredentials(state);
  for (const [role, password] of [["aw_search_worker", workerPassword], ["aw_search_api", apiPassword]]) {
    await sql(state, `DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
    CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}' AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_role_invalid';
  END IF;
END $roles$;
GRANT CONNECT ON DATABASE autoworld TO ${role};
ALTER ROLE ${role} SET search_path=pg_catalog;
ALTER ROLE ${role} SET statement_timeout='15s';
ALTER ROLE ${role} SET idle_in_transaction_session_timeout='15s';`, { role: "bootstrap" });
  }
  return Object.freeze({ workerPassword, apiPassword });
}
