import { isDeepStrictEqual } from "node:util";

const TABLES = Object.freeze({
  aw_connector: Object.freeze([
    "sources", "runs", "inventories", "raw_pages", "listing_versions", "observations",
    "tombstones", "projections", "attempts", "mutations", "outbox",
  ]),
  aw_connector_migration: Object.freeze(["version", "event"]),
  aw_search: Object.freeze([
    "batch", "batch_event", "payload", "progress", "attempt", "quarantine",
    "retired_index", "superseded_index", "replay_review", "delivery", "consumer",
  ]),
  aw_search_migration: Object.freeze(["history"]),
});

const SEQUENCES = Object.freeze([
  Object.freeze({ schema: "aw_connector_migration", name: "event_sequence_seq" }),
  Object.freeze({ schema: "aw_search", name: "quarantine_quarantine_id_seq" }),
  Object.freeze({ schema: "aw_search_migration", name: "history_sequence_seq" }),
]);

const TABLE_LIMITS = Object.freeze({ rows: 100_000, bytes: 64 * 1024 * 1024 });
const SNAPSHOT_LIMITS = Object.freeze({ rows: 250_000, bytes: 128 * 1024 * 1024 });
const DIGEST = /^[a-f0-9]{64}$/u;
const SYNTHETIC_SOURCE_ID = "src_sdk_synthetic";
const SYNTHETIC_SCOPE_ID = "scope_7d18dbe77c718e18cb036fbb21b1658a783498188d5b547ed5c5413a5c743414";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function integer(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail(code);
  return number;
}

function digest(value, code) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(code);
  return value;
}

function expectedRelations() {
  const relations = [];
  for (const [schema, tables] of Object.entries(TABLES)) {
    for (const table of tables) relations.push(`${schema}.${table}:r`);
  }
  for (const sequence of SEQUENCES) relations.push(`${sequence.schema}.${sequence.name}:S`);
  return relations.sort();
}

function discoveredRelations(rows) {
  if (!Array.isArray(rows)) fail("snapshot_schema_drift");
  return rows.map((row) => `${row.schema_name}.${row.relation_name}:${row.relation_kind}`).sort();
}

function relationSql(schema, table, purpose) {
  return `/* snapshot:${purpose}:${schema}.${table} */`;
}

async function inspectSchema(client) {
  const schemas = Object.keys(TABLES);
  const result = await client.query(`/* snapshot:schema */
SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind AS relation_kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`, [schemas]);
  if (!isDeepStrictEqual(discoveredRelations(result.rows), expectedRelations())) fail("snapshot_schema_drift");

  const tablespaces = await client.query(`/* snapshot:tablespaces */
SELECT count(*)::text AS count
FROM pg_catalog.pg_tablespace
WHERE spcname NOT IN ('pg_default', 'pg_global')`);
  if (integer(tablespaces.rows?.[0]?.count, "snapshot_tablespace_invalid") !== 0) {
    fail("snapshot_external_tablespace");
  }
}

async function captureTable(client, schema, table) {
  const stats = await client.query(`${relationSql(schema, table, "stats")}
SELECT count(*)::text AS row_count,
       COALESCE(sum(octet_length(to_jsonb(t)::text)), 0)::text AS byte_count
FROM ${schema}.${table} t`);
  const rowCount = integer(stats.rows?.[0]?.row_count, "snapshot_table_stats_invalid");
  const byteCount = integer(stats.rows?.[0]?.byte_count, "snapshot_table_stats_invalid");
  if (rowCount > TABLE_LIMITS.rows || byteCount > TABLE_LIMITS.bytes) fail("snapshot_table_limit_exceeded");

  const hashed = await client.query(`${relationSql(schema, table, "digest")}
SELECT encode(sha256(convert_to(COALESCE(
  string_agg(octet_length(row_text)::text || ':' || row_text, E'\\n' ORDER BY row_text COLLATE "C"),
  ''
), 'UTF8')), 'hex') AS digest
FROM (SELECT to_jsonb(t)::text AS row_text FROM ${schema}.${table} t) rows`);
  return {
    evidence: Object.freeze({ count: rowCount, digest: digest(hashed.rows?.[0]?.digest, "snapshot_table_digest_invalid") }),
    byteCount,
  };
}

async function captureSequences(client) {
  const result = {};
  for (const sequence of SEQUENCES) {
    const key = `${sequence.schema}.${sequence.name}`;
    const captured = await client.query(`/* snapshot:sequence:${key} */
SELECT last_value::text AS last_value, is_called FROM ${key}`);
    const row = captured.rows?.[0];
    if (typeof row?.last_value !== "string" || !/^-?[0-9]+$/u.test(row.last_value) || typeof row.is_called !== "boolean") {
      fail("snapshot_sequence_invalid");
    }
    result[key] = Object.freeze({ lastValue: row.last_value, isCalled: row.is_called });
  }
  return Object.freeze(result);
}

async function captureRawIntegrity(client, expectedCount) {
  const result = await client.query(`/* snapshot:raw-integrity */
WITH checked AS (
  SELECT encode(sha256(raw_bytes), 'hex') AS actual_sha256,
         octet_length(raw_bytes) AS actual_length,
         sha256 AS recorded_sha256,
         byte_length AS recorded_length
  FROM aw_connector.raw_pages
), framed AS (
  SELECT actual_sha256 || ':' || actual_length::text AS evidence,
         (actual_sha256 <> recorded_sha256 OR actual_length <> recorded_length) AS mismatch
  FROM checked
)
SELECT count(*)::text AS row_count,
       count(*) FILTER (WHERE mismatch)::text AS mismatch_count,
       encode(sha256(convert_to(COALESCE(
         string_agg(octet_length(evidence)::text || ':' || evidence, E'\\n' ORDER BY evidence COLLATE "C"),
         ''
       ), 'UTF8')), 'hex') AS digest
FROM framed`);
  const rowCount = integer(result.rows?.[0]?.row_count, "snapshot_raw_integrity_invalid");
  const mismatchCount = integer(result.rows?.[0]?.mismatch_count, "snapshot_raw_integrity_invalid");
  if (rowCount !== expectedCount || mismatchCount !== 0) fail("snapshot_raw_integrity_failed");
  return Object.freeze({ count: rowCount, digest: digest(result.rows?.[0]?.digest, "snapshot_raw_integrity_invalid") });
}

async function captureWatermark(client) {
  const result = await client.query(`/* snapshot:watermark */
WITH relevant AS (
  SELECT m.source_id, m.run_id, m.operation_key, m.kind,
         m.receipt#>>'{mutation,record,leaseFence}' AS lease_fence,
         m.receipt#>>'{mutation,record,checkpointRevision}' AS checkpoint_revision,
         m.receipt#>>'{mutation,record,recordedAt}' AS committed_at
  FROM aw_connector.outbox o
  JOIN aw_connector.mutations m USING (source_id, run_id, operation_key)
  JOIN aw_connector.runs r USING (source_id, run_id)
  WHERE m.source_id = $1 AND r.scope_id = $2
    AND m.kind IN ('page.committed', 'full.finalized')
), summary AS (
  SELECT count(*) FILTER (WHERE lease_fence IS NULL OR lease_fence !~ '^[0-9]+$'
    OR checkpoint_revision IS NULL OR checkpoint_revision !~ '^[0-9]+$'
    OR committed_at IS NULL OR committed_at !~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$')::text AS invalid_count
  FROM relevant
)
SELECT selected.kind, selected.committed_at, selected.lease_fence,
       selected.checkpoint_revision, selected.digest, summary.invalid_count,
       consumer.published_revision::text AS published_revision
FROM summary
CROSS JOIN aw_search.consumer consumer
LEFT JOIN LATERAL (
  SELECT kind, committed_at, lease_fence, checkpoint_revision,
         encode(sha256(convert_to(concat_ws(chr(31), source_id, run_id, operation_key, kind,
           lease_fence, checkpoint_revision, committed_at), 'UTF8')), 'hex') AS digest
  FROM relevant
  WHERE lease_fence ~ '^[0-9]+$' AND checkpoint_revision ~ '^[0-9]+$'
    AND committed_at ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
  ORDER BY lease_fence::bigint DESC, checkpoint_revision::bigint DESC, operation_key COLLATE "C" DESC
  LIMIT 1
) selected ON true
WHERE consumer.id = 1`, [SYNTHETIC_SOURCE_ID, SYNTHETIC_SCOPE_ID]);
  const row = result.rows?.[0];
  if (!row || integer(row.invalid_count, "snapshot_watermark_invalid") !== 0 ||
      !["page.committed", "full.finalized"].includes(row.kind) ||
      typeof row.committed_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.committed_at)) {
    fail("snapshot_watermark_missing");
  }
  return Object.freeze({
    kind: row.kind,
    committedAt: row.committed_at,
    leaseFence: integer(row.lease_fence, "snapshot_watermark_invalid"),
    checkpointRevision: integer(row.checkpoint_revision, "snapshot_watermark_invalid"),
    publishedRevision: integer(row.published_revision, "snapshot_watermark_invalid"),
    digest: digest(row.digest, "snapshot_watermark_invalid"),
  });
}

function assertSnapshot(snapshot) {
  if (snapshot?.version !== 1 || typeof snapshot.tables !== "object" || typeof snapshot.sequences !== "object" ||
      typeof snapshot.raw !== "object" || typeof snapshot.watermark !== "object") fail("snapshot_shape_invalid");
}

/**
 * Capture a bounded, sanitized and transactionally coherent application snapshot.
 * The caller must quiesce application writers before invoking this function.
 */
export async function captureSnapshot(pool) {
  if (!pool || typeof pool.connect !== "function") fail("snapshot_pool_invalid");
  const client = await pool.connect();
  let transaction = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    await client.query("SET LOCAL statement_timeout = '25s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    await inspectSchema(client);

    const tables = {};
    let totalRows = 0;
    let totalBytes = 0;
    for (const [schema, names] of Object.entries(TABLES)) {
      for (const table of names) {
        const key = `${schema}.${table}`;
        const captured = await captureTable(client, schema, table);
        tables[key] = captured.evidence;
        totalRows += captured.evidence.count;
        totalBytes += captured.byteCount;
        if (totalRows > SNAPSHOT_LIMITS.rows || totalBytes > SNAPSHOT_LIMITS.bytes) fail("snapshot_total_limit_exceeded");
      }
    }

    const sequences = await captureSequences(client);
    const raw = await captureRawIntegrity(client, tables["aw_connector.raw_pages"].count);
    const watermark = await captureWatermark(client);
    await client.query("COMMIT");
    transaction = false;
    return Object.freeze({ version: 1, tables: Object.freeze(tables), sequences, raw, watermark });
  } catch (error) {
    if (transaction) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original bounded error */ }
    }
    throw error;
  } finally {
    client.release();
  }
}

export function compareRestoredSnapshot(before, after) {
  assertSnapshot(before);
  assertSnapshot(after);
  if (!isDeepStrictEqual(before, after)) fail("snapshot_restore_mismatch");
  return true;
}

export function compareImmutableSnapshot(before, after) {
  assertSnapshot(before);
  assertSnapshot(after);
  const tableNames = [
    "aw_connector.raw_pages",
    "aw_connector.listing_versions",
    "aw_connector.observations",
    "aw_connector.tombstones",
    "aw_connector.mutations",
    "aw_connector.outbox",
    ...TABLES.aw_connector_migration.map((name) => `aw_connector_migration.${name}`),
  ];
  for (const name of tableNames) {
    if (!isDeepStrictEqual(before.tables[name], after.tables[name])) fail("snapshot_immutable_mismatch");
  }
  if (!isDeepStrictEqual(
    before.sequences["aw_connector_migration.event_sequence_seq"],
    after.sequences["aw_connector_migration.event_sequence_seq"],
  ) || !isDeepStrictEqual(before.raw, after.raw) || !isDeepStrictEqual(before.watermark, after.watermark)) {
    fail("snapshot_immutable_mismatch");
  }
  return true;
}

/**
 * Compare canonical evidence after search reconciliation. This is intentionally
 * not a stand-alone proof of append-only search membership: callers first prove
 * the exact restored snapshot, then rely on the migration's immutable-row
 * triggers while reconciliation may append batches, attempts and deliveries.
 */
export function compareCanonicalSnapshot(before, after) {
  assertSnapshot(before);
  assertSnapshot(after);
  const tableNames = [
    ...TABLES.aw_connector.map((name) => `aw_connector.${name}`),
    ...TABLES.aw_connector_migration.map((name) => `aw_connector_migration.${name}`),
    "aw_search.quarantine",
    "aw_search.replay_review",
    "aw_search_migration.history",
  ];
  for (const name of tableNames) {
    if (!isDeepStrictEqual(before.tables[name], after.tables[name])) fail("snapshot_canonical_mismatch");
  }
  const sequenceNames = [
    "aw_connector_migration.event_sequence_seq",
    "aw_search.quarantine_quarantine_id_seq",
    "aw_search_migration.history_sequence_seq",
  ];
  for (const name of sequenceNames) {
    if (!isDeepStrictEqual(before.sequences[name], after.sequences[name])) fail("snapshot_canonical_mismatch");
  }
  const { publishedRevision: beforePublished, ...beforeCausal } = before.watermark;
  const { publishedRevision: afterPublished, ...afterCausal } = after.watermark;
  if (!isDeepStrictEqual(before.raw, after.raw) || !isDeepStrictEqual(beforeCausal, afterCausal) ||
      integer(afterPublished, "snapshot_canonical_mismatch") < integer(beforePublished, "snapshot_canonical_mismatch")) {
    fail("snapshot_canonical_mismatch");
  }
  return true;
}
