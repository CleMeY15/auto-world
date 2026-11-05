import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationChecksum, migrationSql, readMigration } from "../scripts/prototype-search/migrations.mjs";

test("search migration is checksum-pinned, role-isolated and history preserving", () => {
  const definition = readMigration();
  assert.equal(definition.checksum, migrationChecksum(definition.up, definition.down));
  assert.match(migrationSql(), /search_migration_checksum_drift/u);
  assert.throws(() => migrationSql("up", { ...definition, up: definition.up + "\n-- drift" }));
  assert.throws(() => migrationSql("drop"));
  assert.match(definition.up, /SECURITY DEFINER SET search_path = pg_catalog/u);
  assert.match(definition.up, /GRANT EXECUTE ON FUNCTION aw_search.publication\(\) TO aw_search_api/u);
  assert.doesNotMatch(definition.up, /GRANT .*raw_bytes|GRANT .*semantic_command|GRANT .*TO aw_writer|GRANT .*TO aw_reader/u);
  assert.match(definition.up, /immutable_search_evidence/u);
  assert.match(definition.down, /search_schema_nonempty/u);
  assert.doesNotMatch(definition.down, /DROP SCHEMA aw_connector|DROP SCHEMA aw_search_migration/u);
});
