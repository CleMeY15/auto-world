import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { sql } from "../data-infra/runtime.mjs";

const directory = new URL("../../services/search/prototype/migrations/", import.meta.url);
export function migrationChecksum(up, down, version = 1) {
  if (!Number.isSafeInteger(version) || version < 1 || version > 2) throw new Error("search_invalid_migration");
  return createHash("sha256").update(`aw-search-migration-${version}\0`).update(up).update("\0").update(down).digest("hex");
}
export function readMigration(version = 1) {
  if (![1, 2].includes(version)) throw new Error("search_invalid_migration");
  const stem = String(version).padStart(4, "0") + (version === 1 ? "-search" : "-search-v2");
  const up = readFileSync(new URL(`${stem}.up.sql`, directory), "utf8");
  const down = readFileSync(new URL(`${stem}.down.sql`, directory), "utf8");
  return { version, up, down, checksum: migrationChecksum(up, down, version) };
}
export function readMigrations() { return Object.freeze([readMigration(1), readMigration(2)]); }
export function migrationSql(direction = "up", targetVersion = 1, inputDefinitions = readMigrations()) {
  let definitions = inputDefinitions;
  if (typeof targetVersion === "object" && targetVersion !== null) {
    definitions = [targetVersion];
    targetVersion = targetVersion.version;
  }
  if (!["up", "down"].includes(direction) || !Number.isSafeInteger(targetVersion) || targetVersion < 1 || targetVersion > 2
      || !Array.isArray(definitions)) throw new Error("search_invalid_migration");
  const allDefinitions = [...definitions].sort((left, right) => left.version - right.version);
  const selected = allDefinitions.filter((definition) => definition.version <= targetVersion);
  if (selected.length !== targetVersion || allDefinitions.some((definition, index) => definition.version !== index + 1 ||
      typeof definition.up !== "string" || typeof definition.down !== "string" ||
      definition.checksum !== migrationChecksum(definition.up, definition.down, definition.version) ||
      new RegExp(`\\$search_(?:body_v${definition.version}|migration)\\$`, "u").test(definition.up + definition.down))) {
    throw new Error("search_invalid_migration");
  }
  const knownCases = allDefinitions.map((definition) => `WHEN '${definition.checksum}' THEN ${definition.version}`).join(" ");
  const upCases = selected.map((definition) => `WHEN ${definition.version} THEN
        EXECUTE $search_body_v${definition.version}$${definition.up}$search_body_v${definition.version}$;
        INSERT INTO aw_search_migration.history(checksum,action) VALUES ('${definition.checksum}','up');`).join("\n      ");
  const downCases = [...selected].reverse().map((definition) => `WHEN ${definition.version} THEN
        EXECUTE $search_body_v${definition.version}$${definition.down}$search_body_v${definition.version}$;
        INSERT INTO aw_search_migration.history(checksum,action) VALUES ('${definition.checksum}','down');`).join("\n      ");
  const desired = direction === "up" ? targetVersion : targetVersion - 1;
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
DECLARE entry record; migration_version integer; current_version integer := 0; step integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='aw_search_migration.history'::regclass AND tgname='immutable_history') THEN
    CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE OR TRUNCATE ON aw_search_migration.history
      FOR EACH STATEMENT EXECUTE FUNCTION aw_search_migration.immutable();
  END IF;
  FOR entry IN SELECT checksum,action FROM aw_search_migration.history ORDER BY sequence LOOP
    migration_version := CASE entry.checksum ${knownCases} ELSE NULL END;
    IF migration_version IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_checksum_drift';
    END IF;
    IF entry.action='up' THEN
      IF migration_version <> current_version+1 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_order_invalid'; END IF;
      current_version := migration_version;
    ELSE
      IF migration_version <> current_version THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_order_invalid'; END IF;
      current_version := current_version-1;
    END IF;
  END LOOP;
  IF (to_regnamespace('aw_search') IS NOT NULL) IS DISTINCT FROM (current_version>0) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_state_mismatch';
  END IF;
  IF '${direction}'='up' AND current_version>${desired} OR '${direction}'='down' AND current_version NOT IN (${targetVersion},${desired}) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_order_invalid';
  END IF;
  IF current_version<${desired} THEN
    FOR step IN current_version+1..${desired} LOOP
      CASE step ${upCases} ELSE RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_order_invalid'; END CASE;
    END LOOP;
  ELSIF current_version>${desired} THEN
    FOR step IN REVERSE current_version..${desired + 1} LOOP
      CASE step ${downCases} ELSE RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='search_migration_order_invalid'; END CASE;
    END LOOP;
  END IF;
END
$search_migration$;
COMMIT;`;
}
export async function migrate(state, direction = "up", targetVersion = 1) {
  await sql(state, migrationSql(direction, targetVersion), { role: "migrator", timeoutMs: 30_000 });
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
