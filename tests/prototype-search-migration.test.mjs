import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationChecksum, migrationSql, readMigration, readMigrations } from "../scripts/prototype-search/migrations.mjs";

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

test("search V2 migration is additive, ordered and least-privileged", () => {
  const definitions = readMigrations();
  const v1 = definitions[0];
  const v2 = definitions[1];
  assert.equal(v1.checksum, migrationChecksum(v1.up, v1.down, 1));
  assert.equal(v2.checksum, migrationChecksum(v2.up, v2.down, 2));
  assert.notEqual(v1.checksum, v2.checksum);
  const up = migrationSql("up", 2, definitions);
  const down = migrationSql("down", 2, definitions);
  const legacyReplay = migrationSql("up", 1, definitions);
  const reapply = migrationSql("up", 2, definitions);
  assert.match(up, /search_migration_order_invalid/u);
  assert.match(up, new RegExp(v1.checksum, "u"));
  assert.match(up, new RegExp(v2.checksum, "u"));
  assert.match(down, new RegExp(v1.checksum, "u"));
  assert.match(down, new RegExp(v2.checksum, "u"));
  assert.match(legacyReplay, new RegExp(v2.checksum, "u"));
  assert.equal(reapply, up);
  assert.match(v2.up, /mapping_version IN \(1, 2\)/u);
  assert.match(v2.up, /'mappingVersion', b\.mapping_version/u);
  assert.match(v2.up, /GRANT SELECT \(raw_bytes\).*aw_search_worker/u);
  assert.doesNotMatch(v2.up, /raw_bytes.*aw_search_api|GRANT .*raw_bytes.*aw_search_api/u);
  assert.match(v2.down, /search_v2_schema_nonempty/u);
  assert.match(v2.down, /REVOKE SELECT \(raw_bytes\).*aw_search_worker/u);
  assert.throws(() => migrationSql("up", 2, [v1, { ...v2, up: `${v2.up}\n-- drift` }]));
  assert.throws(() => migrationSql("up", 2, [v2]));
});
