import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureSnapshot,
  compareCanonicalSnapshot,
  compareImmutableSnapshot,
  compareRestoredSnapshot,
} from "../scripts/prototype-application/snapshot.mjs";

const HASH = "a".repeat(64);
const clone = (value) => JSON.parse(JSON.stringify(value));
const TABLES = {
  aw_connector: [
    "sources", "runs", "inventories", "raw_pages", "listing_versions", "observations",
    "tombstones", "projections", "attempts", "mutations", "outbox",
  ],
  aw_connector_migration: ["version", "event"],
  aw_search: [
    "batch", "batch_event", "payload", "progress", "attempt", "quarantine",
    "retired_index", "superseded_index", "replay_review", "delivery", "consumer",
  ],
  aw_search_migration: ["history"],
};
const SEQUENCES = [
  ["aw_connector_migration", "event_sequence_seq"],
  ["aw_search", "quarantine_quarantine_id_seq"],
  ["aw_search_migration", "history_sequence_seq"],
];

function relationRows() {
  const rows = [];
  for (const [schema, tables] of Object.entries(TABLES)) {
    for (const table of tables) rows.push({ schema_name: schema, relation_name: table, relation_kind: "r" });
  }
  for (const [schema, sequence] of SEQUENCES) {
    rows.push({ schema_name: schema, relation_name: sequence, relation_kind: "S" });
  }
  return rows;
}

function mockPool(options = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(statement, values) {
      const text = typeof statement === "string" ? statement : statement.text;
      queries.push({ text, values });
      if (text.includes("snapshot:schema")) {
        const rows = relationRows();
        if (options.schemaDrift) rows.push({ schema_name: "aw_search", relation_name: "unexpected", relation_kind: "r" });
        return { rows };
      }
      if (text.includes("snapshot:tablespaces")) return { rows: [{ count: options.externalTablespace ? "1" : "0" }] };
      if (text.includes("snapshot:stats:")) {
        const relation = text.match(/snapshot:stats:([^ *]+)/u)?.[1];
        const rowCount = options.tableRows?.[relation] ?? 1;
        const byteCount = options.tableBytes?.[relation] ?? 10;
        return { rows: [{ row_count: String(rowCount), byte_count: String(byteCount) }] };
      }
      if (text.includes("snapshot:digest:")) return { rows: [{ digest: HASH }] };
      if (text.includes("snapshot:sequence:")) return { rows: [{ last_value: "1", is_called: false }] };
      if (text.includes("snapshot:raw-integrity")) {
        return { rows: [{ row_count: "1", mismatch_count: options.rawMismatch ? "1" : "0", digest: HASH }] };
      }
      if (text.includes("snapshot:watermark")) {
        return { rows: options.missingWatermark ? [] : [{
          kind: "full.finalized",
          committed_at: "2026-11-05T12:34:56.789Z",
          lease_fence: "4",
          checkpoint_revision: "9",
          published_revision: "2",
          invalid_count: options.invalidWatermark ? "1" : "0",
          digest: HASH,
        }] };
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  return {
    pool: { async connect() { return client; } },
    queries,
    wasReleased: () => released,
  };
}

test("captureSnapshot returns only bounded digests from one coherent read-only transaction", async () => {
  const mock = mockPool();
  const snapshot = await captureSnapshot(mock.pool);

  assert.equal(snapshot.version, 1);
  assert.equal(Object.keys(snapshot.tables).length, 25);
  assert.deepEqual(snapshot.tables["aw_connector.raw_pages"], { count: 1, digest: HASH });
  assert.deepEqual(snapshot.raw, { count: 1, digest: HASH });
  assert.deepEqual(snapshot.watermark, {
    kind: "full.finalized",
    committedAt: "2026-11-05T12:34:56.789Z",
    leaseFence: 4,
    checkpointRevision: 9,
    publishedRevision: 2,
    digest: HASH,
  });
  assert.equal(Object.keys(snapshot.sequences).length, 3);
  assert.equal(mock.wasReleased(), true);

  const sql = mock.queries.map(({ text }) => text).join("\n");
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(sql, /c\.relkind IN \('r', 'p', 'v', 'm', 'f', 'S'\)/u);
  assert.match(sql, /ORDER BY row_text COLLATE "C"/u);
  assert.match(sql, /encode\(sha256\(raw_bytes\), 'hex'\)/u);
  assert.match(sql, /ORDER BY lease_fence::bigint DESC, checkpoint_revision::bigint DESC/u);
  assert.match(sql, /COMMIT/u);
  assert.doesNotMatch(sql, /ROLLBACK/u);
  const watermarkQuery = mock.queries.find(({ text }) => text.includes("snapshot:watermark"));
  assert.deepEqual(watermarkQuery.values, [
    "src_sdk_synthetic",
    "scope_7d18dbe77c718e18cb036fbb21b1658a783498188d5b547ed5c5413a5c743414",
  ]);
});

test("captureSnapshot rolls back on raw-byte digest mismatch without exposing row identity", async () => {
  const mock = mockPool({ rawMismatch: true });
  await assert.rejects(() => captureSnapshot(mock.pool), (error) => {
    assert.equal(error.message, "snapshot_raw_integrity_failed");
    assert.equal(Object.keys(error).join(","), "code");
    return true;
  });
  assert.equal(mock.wasReleased(), true);
  assert.match(mock.queries.at(-1).text, /ROLLBACK/u);
});

test("captureSnapshot rejects schema drift, external tablespaces and bounded-table overflow", async () => {
  await assert.rejects(() => captureSnapshot(mockPool({ schemaDrift: true }).pool), /snapshot_schema_drift/u);
  await assert.rejects(() => captureSnapshot(mockPool({ externalTablespace: true }).pool), /snapshot_external_tablespace/u);
  await assert.rejects(() => captureSnapshot(mockPool({
    tableRows: { "aw_connector.sources": 100_001 },
  }).pool), /snapshot_table_limit_exceeded/u);
  await assert.rejects(() => captureSnapshot(mockPool({
    tableBytes: { "aw_connector.sources": 64 * 1024 * 1024 + 1 },
  }).pool), /snapshot_table_limit_exceeded/u);
});

test("captureSnapshot requires a durable committed watermark", async () => {
  await assert.rejects(() => captureSnapshot(mockPool({ missingWatermark: true }).pool), /snapshot_watermark_missing/u);
  await assert.rejects(() => captureSnapshot(mockPool({ invalidWatermark: true }).pool), /snapshot_watermark_missing/u);
});

test("snapshot comparisons distinguish exact restore from post-reconcile canonical evidence", async () => {
  const before = await captureSnapshot(mockPool().pool);
  const exact = clone(before);
  assert.equal(compareRestoredSnapshot(before, exact), true);

  exact.tables["aw_search.consumer"] = { count: 1, digest: "b".repeat(64) };
  exact.watermark.publishedRevision += 1;
  assert.throws(() => compareRestoredSnapshot(before, exact), /snapshot_restore_mismatch/u);
  assert.equal(compareCanonicalSnapshot(before, exact), true);

  const replayLeaseAdvance = clone(before);
  replayLeaseAdvance.tables["aw_connector.sources"] = { count: 1, digest: "e".repeat(64) };
  assert.equal(compareImmutableSnapshot(before, replayLeaseAdvance), true);

  const immutableReplayDrift = clone(replayLeaseAdvance);
  immutableReplayDrift.tables["aw_connector.mutations"] = { count: 2, digest: "f".repeat(64) };
  assert.throws(() => compareImmutableSnapshot(before, immutableReplayDrift), /snapshot_immutable_mismatch/u);

  const connectorDrift = clone(exact);
  connectorDrift.tables["aw_connector.observations"] = { count: 2, digest: "c".repeat(64) };
  assert.throws(() => compareCanonicalSnapshot(before, connectorDrift), /snapshot_canonical_mismatch/u);

  const failedReceiptDrift = clone(exact);
  failedReceiptDrift.tables["aw_search.quarantine"] = { count: 1, digest: "d".repeat(64) };
  assert.throws(() => compareCanonicalSnapshot(before, failedReceiptDrift), /snapshot_canonical_mismatch/u);

  const causalReceiptDrift = clone(exact);
  causalReceiptDrift.watermark.checkpointRevision += 1;
  assert.throws(() => compareCanonicalSnapshot(before, causalReceiptDrift), /snapshot_canonical_mismatch/u);

  const publicationRegression = clone(exact);
  publicationRegression.watermark.publishedRevision = before.watermark.publishedRevision - 1;
  assert.throws(() => compareCanonicalSnapshot(before, publicationRegression), /snapshot_canonical_mismatch/u);
});
