import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compose, initProject, InfraError, reset, root, run, serviceStates, sql, start, stop, up, pull, withProjectLock } from "./runtime.mjs";
import { migration, migrationChecksum, migrationSql, sqlText } from "./migrations.mjs";
import { fixtureTransaction, syntheticFixture } from "./fixtures.mjs";
import { prepareTools, redis, s3, search, serviceHealth, writeRaw } from "./probes.mjs";
import { digestBytes } from "./raw-protocol.mjs";

const records = [];
const runId = randomUUID();
const evidence = join(root, ".local-data", "integration", runId, "evidence");
let state;
let sentinel;
let failed = false;

async function phase(name, fn) {
  const started = Date.now();
  console.log(JSON.stringify({ phase: name, status: "started" }));
  try {
    const result = await fn();
    records.push({ phase: name, status: "passed", code: "verified", durationMs: Date.now() - started });
    console.log(JSON.stringify(records.at(-1)));
    return result;
  } catch (error) {
    const sqlstate = error instanceof InfraError && error.code === "infra_sql_failed" ? error.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/u)?.[1] : undefined;
    records.push({ phase: name, status: "failed", code: error instanceof InfraError ? error.code : "assertion_failed", ...(sqlstate ? { sqlstate } : {}), durationMs: Date.now() - started });
    throw error;
  }
}

async function expectSql(query, sqlstate, options = {}) {
  await assert.rejects(sql(state, query, options), (error) => error instanceof InfraError && error.code === "infra_sql_failed" && new RegExp(`ERROR:\\s+${sqlstate}\\b`, "u").test(error.stderr));
}

async function ready(target, timeoutMs = 120000) {
  const until = Math.min(target.deadlineAt, Date.now() + timeoutMs);
  let health;
  do {
    health = await serviceHealth({ ...target, deadlineAt: until });
    if (health.every((entry) => entry.status === "passed")) return health;
    await delay(1000);
  } while (Date.now() < until);
  records.push(...health);
  throw new InfraError("infra_usable_readiness_timeout");
}

async function snapshot(target) {
  const query = `SELECT jsonb_build_object(
    'raw', (SELECT jsonb_agg(to_jsonb(r) ORDER BY snapshot_id) FROM aw_foundation.raw_snapshot_reference r),
    'listing', (SELECT jsonb_agg(to_jsonb(l) ORDER BY listing_id) FROM aw_foundation.listing l),
    'versions', (SELECT jsonb_agg(to_jsonb(v) ORDER BY version_id) FROM aw_foundation.listing_version v),
    'observations', (SELECT jsonb_agg(to_jsonb(o) ORDER BY observation_id) FROM aw_foundation.observation o),
    'events', (SELECT encode(sha256(convert_to(string_agg(to_jsonb(e)::text, E'\\n' ORDER BY operation_key), 'UTF8')), 'hex') FROM aw_foundation.outbox_event e),
    'deliveries', (SELECT encode(sha256(convert_to(string_agg(to_jsonb(d)::text, E'\\n' ORDER BY operation_key), 'UTF8')), 'hex') FROM aw_foundation.outbox_delivery d)
  );`;
  return (await sql(target, query, { role: "reader" })).trim();
}

async function insertRow(table, value) {
  if (!/^[a-z_]+$/u.test(table)) throw new InfraError("infra_test_table_invalid");
  return sql(state, `INSERT INTO aw_foundation.${table} SELECT * FROM jsonb_populate_record(NULL::aw_foundation.${table}, ${sqlText(JSON.stringify(value))}::jsonb);`, { role: "writer" });
}

async function suite() {
  const fixture = await syntheticFixture();
  await phase("configuration-and-pulls", async () => {
    await compose(state, ["config", "--quiet"], { timeoutMs: 10000 });
    const pulling = { ...state, deadlineAt: Math.min(state.deadlineAt, Date.now() + 600000) };
    await pull(pulling);
    await prepareTools(pulling);
  });
  await phase("fresh-usable-start", async () => {
    const starting = { ...state, deadlineAt: Math.min(state.deadlineAt, Date.now() + 180000) };
    await up(starting);
    await s3(starting, "create-bucket");
    records.push(...await ready(starting));
    await assert.rejects(s3(state, "head-bucket", { wrongKey: true }));
    const { port } = await import("./runtime.mjs");
    const endpoint = await port(state, "object-store", 8333);
    const unsigned = await globalThis.fetch(`http://127.0.0.1:${endpoint}/aw-raw`, { method: "HEAD", signal: globalThis.AbortSignal.timeout(5000) });
    assert.ok([401, 403].includes(unsigned.status));
  });
  await phase("migration-transaction-and-replay", async () => {
    const brokenUp = `${migration.up}\nSELECT 1 / 0;`;
    const broken = { ...migration, up: brokenUp, checksum: migrationChecksum(brokenUp, migration.down) };
    await expectSql(migrationSql("up", broken), "22012");
    assert.equal((await sql(state, "SELECT to_regnamespace('aw_foundation') IS NULL AND to_regnamespace('aw_migration') IS NULL;")).trim(), "t");
    await Promise.all([sql(state, migrationSql(), { timeoutMs: 30000 }), sql(state, migrationSql(), { timeoutMs: 30000 })]);
    await sql(state, migrationSql());
    assert.equal((await sql(state, "SELECT count(*) FROM aw_migration.event;")).trim(), "1");
    await expectSql(migrationSql("up", broken), "23514");
    await sql(state, migrationSql("down"));
    assert.equal((await sql(state, "SELECT to_regnamespace('aw_foundation') IS NULL;")).trim(), "t");
    await sql(state, migrationSql());
    assert.equal((await sql(state, "SELECT count(*) FROM aw_migration.event;")).trim(), "3");
  });
  await phase("conditional-raw-and-atomic-outbox", async () => {
    assert.equal((await writeRaw(state, fixture.raw, fixture.bytes)).status, "created");
    assert.equal((await writeRaw(state, fixture.raw, fixture.bytes)).status, "replay");
    assert.equal((await writeRaw(state, fixture.raw, Buffer.from("changed"))).status, "conflict");
    await expectSql(fixtureTransaction(fixture.rows, { injectFailure: true }), "22012", { role: "writer" });
    assert.equal((await sql(state, "SELECT (SELECT count(*) FROM aw_foundation.source_reference) + (SELECT count(*) FROM aw_foundation.outbox_event);")).trim(), "0");
    await sql(state, fixtureTransaction(fixture.rows), { role: "writer" });
    const before = await snapshot(state);
    await sql(state, fixtureTransaction(fixture.rows), { role: "writer" });
    assert.equal(await snapshot(state), before);
    const changedRows = globalThis.structuredClone(fixture.rows);
    changedRows.find(([table]) => table === "observation")[1].value_json.amountMinor += 1;
    await expectSql(fixtureTransaction(changedRows), "23505", { role: "writer" });
    assert.equal(await snapshot(state), before);
    assert.equal((await sql(state, "SELECT count(DISTINCT value_json) FROM aw_foundation.observation;")).trim(), "2");
  });
  await phase("real-conditional-write-races", async () => {
    const race = (suffix) => ({ ...fixture.raw, snapshot_id: `raw_race_${suffix}`, object_key: `v1/raw/${fixture.sourceId}/${fixture.runId}/raw_race_${suffix}` });
    const same = await Promise.all([writeRaw(state, race("same"), fixture.bytes), writeRaw(state, race("same"), fixture.bytes)]);
    assert.deepEqual(same.map((r) => r.status).sort(), ["created", "replay"]);
    const different = await Promise.all([writeRaw(state, race("different"), fixture.bytes), writeRaw(state, race("different"), Buffer.from("different contender"))]);
    assert.deepEqual(different.map((r) => r.status).sort(), ["conflict", "created"]);
    const stored = await s3(state, "get-object", { key: race("different").object_key });
    assert.equal(digestBytes(stored), different.find((r) => r.status === "created").sha256);
  });
  await phase("relational-negative-cases-and-privileges", async () => {
    const row = (name) => globalThis.structuredClone(fixture.rows.find(([table]) => table === name)[1]);
    const { parseListing, parseObservation } = await import("@auto-world/vehicle-schema");
    for (const [suffix, publication] of [["case_upper", "Offer-A"], ["case_lower", "offer-a"], ["composed", "caf\u00e9"], ["decomposed", "cafe\u0301"]]) {
      const listingId = `lst_${suffix}`;
      assert.equal(parseListing({ ...fixture.listing, listingId, sourceListingId: publication, observationIds: [] }).success, true);
      await insertRow("listing", { ...row("listing"), listing_id: listingId, source_listing_id: publication });
    }
    const vehicleObservation = { ...fixture.observations[0], observationId: "obs_vehicle_evidence", subject: { kind: "vehicle", vehicleId: fixture.vehicleId } };
    assert.equal(parseObservation(vehicleObservation).success, true);
    await insertRow("observation", { ...row("observation"), observation_id: vehicleObservation.observationId, subject_kind: "vehicle", listing_id: null, vehicle_id: fixture.vehicleId });
    await assert.rejects(insertRow("listing_version_observation", { version_id: fixture.versionId, listing_id: fixture.listingId, observation_id: vehicleObservation.observationId }), (error) => /23503/u.test(error.stderr));
    await assert.rejects(insertRow("listing_version_observation", { version_id: fixture.versionId, listing_id: "lst_case_upper", observation_id: fixture.observations[0].observationId }), (error) => /23503/u.test(error.stderr));
    for (const value of [
      { ...row("observation"), observation_id: "obs_wrong_digest", sha256: "0".repeat(64) },
      { ...row("observation"), observation_id: "obs_wrong_source", source_id: "src_missing" },
      { ...row("observation"), observation_id: "obs_wrong_subject", listing_id: "lst_missing" },
      { ...row("observation"), observation_id: "obs_wrong_run", run_id: "run_missing" },
    ]) await assert.rejects(insertRow("observation", value), (error) => /23503/u.test(error.stderr));
    for (const value of [
      { ...row("observation"), observation_id: "obs_two_subjects", vehicle_id: fixture.vehicleId },
      { ...row("observation"), observation_id: "obs_bad_confidence", confidence_bps: 10001 },
      { ...row("observation"), observation_id: "obs_bad_time", observed_at: "infinity" },
    ]) await assert.rejects(insertRow("observation", value), (error) => /23514/u.test(error.stderr));
    await assert.rejects(insertRow("raw_snapshot_reference", { ...fixture.raw, snapshot_id: "raw_bad_path" }), (error) => /23514/u.test(error.stderr));
    await expectSql("UPDATE aw_foundation.observation SET confidence_bps = 0;", "42501", { role: "writer" });
    await expectSql("DELETE FROM aw_foundation.raw_snapshot_reference;", "42501", { role: "writer" });
    await expectSql("CREATE TABLE aw_foundation.forbidden (id integer);", "42501", { role: "writer" });
    await expectSql("INSERT INTO aw_foundation.source_reference VALUES ('src_reader');", "42501", { role: "reader" });
    await expectSql("UPDATE aw_foundation.observation SET confidence_bps = 0;", "23514");
    await expectSql("TRUNCATE aw_foundation.outbox_event;", "0A000");
    await expectSql("TRUNCATE aw_foundation.listing_version_observation;", "23514");
    await expectSql("UPDATE aw_migration.version SET checksum = repeat('0',64);", "23514");
    await expectSql(migrationSql("down"), "23514");
    await sql(state, "UPDATE aw_foundation.outbox_delivery SET attempts = 1;", { role: "writer" });
    const uncovered = await sql(state, `SELECT c.conname FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'aw_foundation'::regnamespace
      AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indisvalid AND i.indpred IS NULL
        AND (SELECT array_agg(k ORDER BY ordinal) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS columns(k, ordinal)
          WHERE ordinal <= cardinality(c.conkey)) = c.conkey);`);
    assert.equal(uncovered.trim(), "");
  });
  await phase("outbox-pending-index", async () => {
    await sql(state, `BEGIN;
      INSERT INTO aw_foundation.outbox_event SELECT 'commit_bulk_' || n, 'source.listing.seen', '${fixture.sourceId}', '${fixture.runId}', '${fixture.listingId}', '2026-09-06T00:00:00Z', 1 FROM generate_series(1,10000) n;
      INSERT INTO aw_foundation.outbox_delivery SELECT 'commit_bulk_' || n, '2026-09-06T00:00:00Z', CASE WHEN n > 10 THEN '2026-09-06T01:00:00Z'::timestamptz END, 0 FROM generate_series(1,10000) n;
      COMMIT;`, { role: "writer" });
    await sql(state, "ANALYZE aw_foundation.outbox_delivery;");
    const plan = await sql(state, "EXPLAIN (FORMAT JSON) SELECT operation_key FROM aw_foundation.outbox_delivery WHERE delivered_at IS NULL AND available_at <= '2026-09-07T00:00:00Z' ORDER BY available_at, operation_key LIMIT 10;");
    assert.match(plan, /outbox_pending_idx/u);
  });
  await phase("derived-stores-and-restart-persistence", async () => {
    const before = await snapshot(state);
    await search(state, "PUT", "/aw_synthetic", { settings: { number_of_shards: 1, number_of_replicas: 0 } });
    await search(state, "PUT", "/aw_synthetic/_doc/fixture?refresh=true", { synthetic: true, listingId: fixture.listingId });
    assert.equal(await redis(state, "SET", "aw:synthetic", fixture.listingId), "OK");
    await stop(state);
    await start(state);
    records.push(...await ready(state));
    assert.equal(await snapshot(state), before);
    assert.equal(digestBytes(await s3(state, "get-object", { key: fixture.raw.object_key })), fixture.sha256);
    assert.equal(await redis(state, "GET", "aw:synthetic"), fixture.listingId);
    assert.equal((await search(state, "GET", "/aw_synthetic/_doc/fixture"))._source.listingId, fixture.listingId);
    await redis(state, "DEL", "aw:synthetic");
    await search(state, "DELETE", "/aw_synthetic");
    assert.equal(await snapshot(state), before);
  });
  for (const service of ["postgres", "redis", "opensearch", "object-store"]) {
    await phase(`failure-and-recovery-${service}`, async () => {
      await stop(state, [service]);
      const health = await serviceHealth(state);
      records.push(...health);
      assert.equal(health.find((entry) => entry.service === service).status, "failed");
      assert.ok(health.filter((entry) => entry.service !== service).every((entry) => entry.status === "passed"));
      if (service === "object-store") {
        const before = await snapshot(state);
        assert.equal((await writeRaw(state, fixture.raw, fixture.bytes, 100)).status, "indeterminate");
        assert.equal(await snapshot(state), before);
      }
      await start(state, [service]);
      await ready(state);
    });
  }
  await phase("mixed-state-cold-backup-isolated-restore", async () => {
    const { backup, restoreCheck } = await import("./backup.mjs");
    const before = await snapshot(state);
    await stop(state, ["redis"]);
    const saved = await backup(state);
    assert.equal((await serviceStates(state)).redis.state, "exited");
    await restoreCheck(state, saved.backupId, { verify: async (target) => {
      assert.equal(await snapshot(target), before);
      assert.equal(digestBytes(await s3(target, "get-object", { key: fixture.raw.object_key })), fixture.sha256);
    } });
    assert.equal((await serviceStates(state)).redis.state, "exited");
    assert.equal(await snapshot(state), before);
    await start(state, ["redis"]);
    await ready(state);
  });
}

try {
  await mkdir(evidence, { recursive: true });
  const initialized = await initProject({ test: true });
  state = { ...initialized, deadlineAt: Date.now() + 20 * 60000 };
  await withProjectLock(state, async () => {
    await suite();
    await phase("scoped-reset-preserves-independent-sentinel", async () => {
      sentinel = `aw-sentinel-${runId}`;
      const created = await run("docker", ["volume", "create", "--label", `io.auto-world.owner=${runId}`, sentinel], { timeoutMs: 10000 });
      assert.equal(created.code, 0);
      await reset(state);
      const found = await run("docker", ["volume", "inspect", "--format", '{{index .Labels "io.auto-world.owner"}}', sentinel], { timeoutMs: 10000 });
      assert.equal(found.code, 0);
      assert.equal(found.stdout.trim(), runId);
    });
  });
} catch {
  failed = true;
  if (state) {
    try {
      const states = await serviceStates(state);
      records.push(...Object.entries(states).map(([service, value]) => ({ service, phase: "failure-diagnostic", state: ["running", "exited", "created", "restarting", "absent"].includes(value.state) ? value.state : "unknown", health: ["healthy", "unhealthy", "starting", ""].includes(value.health) ? value.health : "unknown" })));
      for (const service of Object.keys(states)) {
        const listing = await run("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${state.project}`, "--filter", `label=com.docker.compose.service=${service}`], { timeoutMs: 10000 });
        if (listing.code !== 0 || !/^[a-f0-9]{12,64}$/u.test(listing.stdout.trim())) continue;
        const logs = await run("docker", ["logs", "--tail", "100", listing.stdout.trim()], { timeoutMs: 10000 });
        const output = `${logs.stdout}\n${logs.stderr}`;
        const categories = [
          ["permission_denied", /permission denied/iu], ["unknown_flag", /flag provided but not defined|unknown flag|unknown option/iu],
          ["sql_syntax_error", /syntax error/iu], ["authentication_failed", /password authentication failed|authentication failed/iu],
          ["missing_configuration", /No such file|cannot.*config|failed.*config/iu], ["memory_failure", /out of memory|cannot allocate memory/iu],
          ["bootstrap_check_failed", /bootstrap checks failed/iu], ["java_error", /Exception|java.lang.Error/u],
          ["postgres_role_creation_failed", /role .* already exists|must be superuser/iu], ["kernel_map_limit", /vm.max_map_count/iu],
        ].filter(([, pattern]) => pattern.test(output)).map(([code]) => code);
        const badFlag = output.match(/(?:flag provided but not defined|unknown flag):\s*(-?[a-zA-Z0-9._-]+)/u)?.[1];
        records.push({ service, phase: "startup-log-classification", categories, ...(badFlag ? { rejectedFlag: badFlag } : {}) });
      }
    } catch { records.push({ phase: "failure-diagnostic", status: "failed", code: "diagnostic_unavailable" }); }
  }
} finally {
  if (state) {
    try {
      await withProjectLock({ ...state, deadlineAt: Date.now() + 120000 }, () => reset({ ...state, deadlineAt: Date.now() + 120000 }));
    } catch { records.push({ phase: "cleanup", status: "failed", code: "scoped_cleanup_failed" }); failed = true; }
  }
  if (sentinel) {
    const inspected = await run("docker", ["volume", "inspect", "--format", '{{index .Labels "io.auto-world.owner"}}', sentinel], { timeoutMs: 10000 });
    if (inspected.code === 0 && inspected.stdout.trim() === runId) {
      const removed = await run("docker", ["volume", "rm", sentinel], { timeoutMs: 10000 });
      if (removed.code !== 0) failed = true;
    } else failed = true;
  }
  await writeFile(join(evidence, "validation.json"), JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), status: failed ? "failed" : "passed", records }, null, 2));
  console.log(JSON.stringify({ phase: "integration", status: failed ? "failed" : "passed", code: failed ? "validation_failed" : "all_real_service_checks_passed" }));
  if (failed) process.exitCode = 1;
}
