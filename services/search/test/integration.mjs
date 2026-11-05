import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { performance } from "node:perf_hooks";

import { runConnector, systemScheduler } from "@auto-world/connector-sdk";
import { createPostgresPrototype } from "@auto-world/ingestion/prototype";
import { createDemoApi } from "@auto-world/api";
import { createCorpusAdapter, SYNTHETIC_CORPUS_MANIFEST } from "@auto-world/synthetic-connector/demo";
import { registry, request, utf8 } from "../../../connectors/_sdk/test-support/index.mjs";
import { createSyntheticDemoReadPort } from "../../api/demo/createSyntheticDemoReadPort.mjs";

const HOST = "127.0.0.1:3210";
const CONTEXT = () => ({ requestId: "req_0123456789abcdef0123456789abcdef", signal: new globalThis.AbortController().signal });
const query = (overrides = {}) => ({ schemaVersion: 1, sort: "listing_asc", ...overrides });
const noopTelemetry = Object.freeze({ emit() {} });

function authority(current) {
  return { async loadVerifiedCurrent(input) {
    const head = current.revisions.at(-1);
    return { trust: "authenticated_current", registry: current, authorityRevision: head.revision,
      verifiedAsOf: input.asOf, authorizationBasisRef: head.configuration.policy.authorization.basisRef };
  } };
}

function ports(ingestion, adapter, operationsOverrides = {}) {
  return {
    authority: authority(registry({ operations: operationsOverrides })), lease: ingestion.lease, store: ingestion.store, adapter,
    clock: { nowMs: () => Date.now() }, scheduler: systemScheduler, random: { next: () => 0 }, telemetry: noopTelemetry,
  };
}

function generatedAdapter(count, offset = 0, outcome = "active") {
  const items = Array.from({ length: count }, (_, index) => {
    const ordinal = offset + index + 1;
    return outcome === "active" ? {
      sourceListingId: `publication-page-${String(ordinal).padStart(4, "0")}`,
      outcome,
      observations: [
        { field: "price", value: { amountMinor: 1_000_000 + ordinal, currency: "EUR" }, confidenceBps: 9_000 },
        { field: "mileage", value: { amount: 20_000 + ordinal, unit: "km" }, confidenceBps: 9_000 },
      ],
    } : { sourceListingId: `publication-page-${String(ordinal).padStart(4, "0")}`, outcome };
  });
  return {
    async fetchPage(input) {
      if (input.signal.aborted) return { success: false, failure: { kind: "cancelled" } };
      const start = input.pageOrdinal * 100;
      const page = items.slice(start, start + 100);
      if (page.length === 0) return { success: false, failure: { kind: "terminal" } };
      const complete = start + page.length === items.length;
      const bytes = utf8(JSON.stringify({ items: page }));
      return { success: true, page: { pageIdentity: `integration-${outcome}-${offset}-${count}-${input.pageOrdinal}`,
        bytes, nextCursor: `integration-${outcome}-${offset}-${count}-${input.pageOrdinal}`, complete } };
    },
    async mapPage(input) { return globalThis.structuredClone(input.decoded); },
  };
}

async function ingest(ingestion, adapter, invocationKey, mode = "full", limitOverrides = {}, operationsOverrides = {}) {
  const source = SYNTHETIC_CORPUS_MANIFEST.source;
  const outcome = await runConnector(request({
    sourceId: source.sourceId, territory: source.territory, acquisitionMethod: source.acquisitionMethod,
    audience: "internal", fields: ["source_listing_id", "price", "mileage"], mode, invocationKey,
    adapterVersion: `prototype-search-${invocationKey}`, mapperVersion: "synthetic-search-mapper-v1",
    limits: { maxPages: 20, maxItems: 2_000, maxPageBytes: 64 * 1024, maxJsonMembers: 2_000, ...limitOverrides },
  }), ports(ingestion, adapter, operationsOverrides));
  return outcome;
}

async function apiSearch(app, body) {
  const response = await app.inject({ method: "POST", url: "/v1/demo/search",
    headers: { host: HOST, "content-type": "application/json" }, payload: body });
  assert.equal(response.statusCode, 200, response.body);
  const envelope = response.json();
  assert.equal(envelope.schemaVersion, 1);
  assert.match(envelope.requestId, /^req_[0-9a-f]{32}$/u);
  assert.equal(typeof envelope.data, "object");
  return envelope.data;
}

async function crashBoundary(config, boundary) {
  const consumerUrl = new URL("../.prototype-dist/consumer.js", import.meta.url).href;
  const databaseUrl = new URL("../.prototype-dist/database.js", import.meta.url).href;
  const searchUrl = new URL("../.prototype-dist/opensearch.js", import.meta.url).href;
  const source = `const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks));
const [{createConsumer},{searchPools},{createOpenSearch}]=await Promise.all([import(${JSON.stringify(consumerUrl)}),import(${JSON.stringify(databaseUrl)}),import(${JSON.stringify(searchUrl)})]);
const pools=searchPools(input.postgres);const search=createOpenSearch(input.opensearch);
const transport=input.boundary==='before'?{...search,build:async(...args)=>{await search.build(...args);process.exit(17);}}:search;
const result=await createConsumer(pools.worker,transport).consume();
if(input.boundary==='after'&&result.status==='published')process.exit(17);process.exit(19);`;
  const child = spawn(process.execPath, ["--conditions=auto-world-prototype", "--input-type=module", "-e", source], {
    stdio: ["pipe", "ignore", "ignore"], windowsHide: true,
  });
  child.stdin.end(JSON.stringify({ ...config, boundary }));
  const [code] = await once(child, "close");
  return code;
}

async function canonicalDigest(pool) {
  const tables = ["raw_pages", "listing_versions", "observations", "tombstones", "projections", "mutations", "outbox"];
  const output = {};
  for (const table of tables) {
    assert.match(table, /^[a-z_]+$/u);
    const result = await pool.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest,
      count(*)::int AS count FROM aw_connector.${table} t`);
    output[table] = result.rows[0];
  }
  return output;
}

async function offlineSnapshot(pool) {
  const [inventories, runs, ledger, projections, observations, versions, tombstones, raw] = await Promise.all([
    pool.query("SELECT scope_id,head FROM aw_connector.inventories WHERE source_id=$1", [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]),
    pool.query("SELECT run_id,checkpoint FROM aw_connector.runs WHERE source_id=$1", [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]),
    pool.query(`SELECT operation_key,receipt FROM aw_connector.mutations WHERE source_id=$1
      AND kind IN ('page.committed','full.finalized') ORDER BY
      ((receipt#>>'{mutation,record,leaseFence}')::bigint),
      ((receipt#>>'{mutation,record,checkpointRevision}')::bigint), operation_key`, [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]),
    pool.query("SELECT listing_id,projection FROM aw_connector.projections WHERE source_id=$1", [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]),
    pool.query("SELECT observation_id,observation FROM aw_connector.observations WHERE source_id=$1", [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]),
    pool.query("SELECT listing_version_id,listing,evidence FROM aw_connector.listing_versions WHERE source_id=$1", [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]),
    pool.query("SELECT tombstone_id,evidence FROM aw_connector.tombstones WHERE source_id=$1", [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]),
    pool.query("SELECT snapshot_id,pending FROM aw_connector.raw_pages WHERE source_id=$1", [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]),
  ]);
  return {
    inventories: new Map(inventories.rows.map((row) => [row.scope_id, row.head])),
    runs: new Map(runs.rows.map((row) => [row.run_id, row.checkpoint])),
    ledger: new Map(ledger.rows.map((row) => [row.operation_key, {
      operationKey: row.receipt.mutation.operationKey,
      kind: row.receipt.mutation.kind,
      record: row.receipt.mutation.record,
      data: row.receipt.data,
    }])),
    projections: new Map(projections.rows.map((row) => [row.listing_id, row.projection])),
    observations: new Map(observations.rows.map((row) => [row.observation_id, row.observation])),
    versions: new Map(versions.rows.map((row) => [row.listing_version_id, row.evidence])),
    listings: new Map(versions.rows.map((row) => [row.listing_version_id, row.listing])),
    tombstones: new Map(tombstones.rows.map((row) => [row.tombstone_id, row.evidence])),
    raw: new Map(raw.rows.map((row) => [row.snapshot_id, { pending: row.pending }])),
  };
}

function publicShape(outcome) {
  assert.equal(outcome.success, true);
  return outcome.data.results.map((result) => ({ listingId: result.listingId, availability: result.availability,
    price: result.price.status === "observed" ? result.price.value : null,
    mileage: result.mileage.status === "observed" ? result.mileage.value : null,
    evidence: result.evidence.map((item) => ({ field: item.field, confidenceBps: item.confidenceBps, value: item.value })) }));
}

/** Real-service behavior. The caller owns the isolated Compose project and cleanup. */
export async function runSearchScenarios({
  postgres, opensearchPort, runtime, adminPool, createRuntime, searchConfig,
  onPhase = () => {}, waitUntilRetryable = async () => {},
}) {
  const ingestion = createPostgresPrototype(postgres);
  const metrics = { fixtureDocuments: 1_000, performance: null, publicationLagMs: [] };
  const phase = async (name, action) => {
    const started = performance.now();
    try { await action(); }
    catch (error) {
      if (error instanceof Error && typeof error.prototypePhase !== "string") {
        Object.defineProperty(error, "prototypePhase", { value: name });
      }
      throw error;
    }
    onPhase(name, performance.now() - started); console.log(`PASS search:${name}`);
  };
  let activeRuntime = runtime;
  let app;
  let withdrawalEvidence;
  const consumeAndMeasure = async () => {
    const outcome = await activeRuntime.consume();
    if (outcome.status === "published") {
      const visible = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(visible.success, true);
      metrics.publicationLagMs.push(Math.max(0, Date.now() - Date.parse(visible.data.dataAsOf)));
    }
    return outcome;
  };
  try {
    await phase("real corpus parity and sanitized publication", async () => {
      assert.equal((await ingest(ingestion, createCorpusAdapter("contradictory"), "integration-contradictory")).status, "completed");
      assert.equal((await consumeAndMeasure()).status, "published");
      const real = await activeRuntime.readPort.search(query(), CONTEXT());
      const snapshot = await offlineSnapshot(adminPool);
      const oracle = await createSyntheticDemoReadPort({ snapshotProvider: () => snapshot, nowMs: () => Date.now() });
      assert.deepEqual(publicShape(real), publicShape(await oracle.search(query(), CONTEXT())));
      const serialized = JSON.stringify(real);
      for (const forbidden of ["raw_bytes", "connectorRunId", "basisRef", "semantic_command", "vin", "sourceListingId"]) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
      }
    });

    await phase("1000 listing paging sorts filters replay and API p95", async () => {
      assert.equal((await ingest(ingestion, generatedAdapter(1_000), "integration-page-1000")).status, "completed");
      assert.equal((await consumeAndMeasure()).status, "published");
      app = createDemoApi({ readPort: activeRuntime.readPort, loopbackPolicy: { boundPort: 3210 } });
      const first = await apiSearch(app, query());
      assert.equal(first.totalCount, 1_000);
      assert.equal(first.results.length, 20);
      assert.match(first.nextCursor, /^cur_[0-9a-f]{64}$/u);
      const publication = await adminPool.query("SELECT aw_search.publication() AS value");
      const sealedWrite = await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${publication.rows[0].value.indexName}/_doc/integration-probe`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ listingId: "integration-probe" }),
      });
      assert.equal(sealedWrite.status, 403);
      const middle = await apiSearch(app, query({ cursor: first.nextCursor }));
      assert.equal(middle.results.length, 20);
      assert.deepEqual(await apiSearch(app, query({ cursor: first.nextCursor })), middle);
      const all = [...first.results, ...middle.results];
      let cursor = middle.nextCursor;
      while (cursor !== undefined) {
        const page = await apiSearch(app, query({ cursor }));
        all.push(...page.results); cursor = page.nextCursor;
      }
      assert.equal(all.length, 1_000); assert.equal(new Set(all.map((item) => item.listingId)).size, 1_000);
      for (const sort of ["listing_asc", "price_asc", "price_desc", "mileage_asc", "mileage_desc"]) {
        assert.equal((await apiSearch(app, query({ sort }))).results.length, 20);
      }
      assert.equal((await apiSearch(app, query({ priceMaxMinor: 1_000_010 }))).totalCount, 10);
      assert.equal((await apiSearch(app, query({ mileageMaxKm: 20_010 }))).totalCount, 10);
      const durations = [];
      for (let index = 0; index < 50; index += 1) {
        const benchmarkQuery = query({ sort: index % 2 ? "price_asc" : "mileage_desc",
          ...(index % 3 === 0 ? { priceMaxMinor: 1_000_500 } : {}),
          ...(index % 5 === 0 ? { mileageMaxKm: 20_750 } : {}) });
        const started = performance.now(); await apiSearch(app, benchmarkQuery);
        durations.push(performance.now() - started);
      }
      durations.sort((left, right) => left - right);
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
      assert.ok(p95 < 500, `p95=${p95}`);
      metrics.performance = { samples: durations.length, p50Ms: durations[Math.ceil(durations.length * 0.5) - 1],
        p95Ms: p95, maxMs: durations.at(-1), sorts: ["price_asc", "mileage_desc"],
        filters: ["active", "priceMaxMinor", "mileageMaxKm"] };
      const health = await activeRuntime.health();
      assert.equal(health.alert, "none"); assert.ok(health.lagMs <= 60_000, JSON.stringify(health));
    });

    await phase("client restart and duplicate consume preserve the published generation", async () => {
      const before = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(before.success, true);
      const publicationBeforeRestart = await adminPool.query("SELECT published_batch,index_name FROM aw_search.consumer WHERE id=1");
      assert.equal((await activeRuntime.consume()).status, "idle");
      await app.close(); app = undefined;
      await activeRuntime.close();
      activeRuntime = undefined;
      activeRuntime = await createRuntime({ openSearchPort: opensearchPort });
      const after = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(after.success, true);
      const { nextCursor: beforeCursor, ...beforeData } = before.data;
      const { nextCursor: afterCursor, ...afterData } = after.data;
      assert.deepEqual(afterData, beforeData);
      assert.match(afterCursor, /^cur_[0-9a-f]{64}$/u);
      assert.notEqual(afterCursor, beforeCursor);
      const staleProcessCursor = await activeRuntime.readPort.search(query({ cursor: beforeCursor }), CONTEXT());
      assert.equal(staleProcessCursor.success, false);
      assert.equal(staleProcessCursor.error.code, "invalid_cursor");
      assert.deepEqual((await adminPool.query("SELECT published_batch,index_name FROM aw_search.consumer WHERE id=1")).rows[0],
        publicationBeforeRestart.rows[0]);
      const publication = await adminPool.query("SELECT aw_search.publication() AS value");
      const activeName = publication.rows[0].value.indexName;
      const superseded = await adminPool.query("SELECT index_name FROM aw_search.superseded_index ORDER BY recorded_at DESC LIMIT 1");
      assert.equal(superseded.rowCount, 1);
      const supersededName = superseded.rows[0].index_name;
      assert.equal((await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${supersededName}`)).status, 200);
      const foreignName = `aw-v1-search-${"f".repeat(32)}`;
      const created = await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${foreignName}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
          settings: { number_of_shards: 1, number_of_replicas: 0 }, mappings: { dynamic: "strict",
            _meta: { owner: "foreign-test-fixture" }, properties: {} },
        }),
      });
      assert.ok(created.ok, `retirement fixture ${created.status}`);
      assert.equal((await activeRuntime.consume()).status, "idle");
      assert.equal((await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${supersededName}`)).status, 200);
      const migrationOwner = await adminPool.connect();
      try {
        await migrationOwner.query("BEGIN");
        await migrationOwner.query("ALTER TABLE aw_search.superseded_index DISABLE TRIGGER immutable_row");
        await migrationOwner.query("UPDATE aw_search.superseded_index SET recorded_at=clock_timestamp()-interval '121 seconds' WHERE index_name=$1", [supersededName]);
        await migrationOwner.query("ALTER TABLE aw_search.superseded_index ENABLE TRIGGER immutable_row");
        await migrationOwner.query("COMMIT");
      } catch (error) { await migrationOwner.query("ROLLBACK"); throw error; }
      finally { migrationOwner.release(); }
      assert.equal((await activeRuntime.consume()).status, "idle");
      assert.equal((await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${supersededName}`)).status, 404);
      assert.equal((await adminPool.query("SELECT count(*)::int AS count FROM aw_search.retired_index WHERE index_name=$1", [supersededName])).rows[0].count, 1);
      assert.equal((await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${activeName}`)).status, 200);
      assert.equal((await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${foreignName}`)).status, 200);
      assert.equal((await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${foreignName}`, { method: "DELETE" })).status, 200);
    });

    await phase("pending commit is partial and generation change invalidates cursor", async () => {
      const before = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(before.success, true); assert.ok(before.data.nextCursor);
      assert.equal((await ingest(ingestion, generatedAdapter(1, 100), "integration-pending", "incremental")).status, "completed");
      const pending = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(pending.success, true); assert.equal(pending.data.state, "partial"); assert.equal(Object.hasOwn(pending.data, "totalCount"), false);
      await activeRuntime.close();
      activeRuntime = undefined;
      const beforeCrash = await adminPool.query("SELECT published_batch,index_name FROM aw_search.consumer WHERE id=1");
      const deliveredBefore = await adminPool.query("SELECT count(*)::int AS count FROM aw_search.delivery WHERE disposition='projected'");
      const attemptsBefore = await adminPool.query("SELECT count(*)::int AS count FROM aw_search.attempt");
      assert.equal(await crashBoundary(searchConfig, "before"), 17);
      assert.deepEqual((await adminPool.query("SELECT published_batch,index_name FROM aw_search.consumer WHERE id=1")).rows[0], beforeCrash.rows[0]);
      assert.equal((await adminPool.query("SELECT count(*)::int AS count FROM aw_search.delivery WHERE disposition='projected'")).rows[0].count,
        deliveredBefore.rows[0].count);
      assert.equal((await adminPool.query("SELECT count(*)::int AS count FROM aw_search.attempt")).rows[0].count,
        attemptsBefore.rows[0].count + 1);
      const concurrentInvocation = "integration-commit-during-captured-batch";
      assert.equal((await ingest(ingestion, generatedAdapter(1, 103), concurrentInvocation, "incremental")).status, "completed");
      const concurrentDelivery = async () => (await adminPool.query(`SELECT count(*)::int AS total,
        count(d.operation_key)::int AS delivered FROM aw_connector.outbox o
        JOIN aw_connector.mutations m USING(source_id,run_id,operation_key)
        JOIN aw_connector.runs r USING(source_id,run_id)
        LEFT JOIN aw_search.delivery d USING(source_id,run_id,operation_key)
        WHERE r.request->>'invocationKey'=$1 AND m.kind IN ('page.committed','full.finalized')`, [concurrentInvocation])).rows[0];
      const committedDuringCapture = await concurrentDelivery();
      assert.ok(committedDuringCapture.total > 0);
      assert.equal(committedDuringCapture.delivered, 0);
      activeRuntime = await createRuntime({ openSearchPort: opensearchPort });
      const recoveredPending = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(recoveredPending.success, true); assert.equal(recoveredPending.data.state, "partial");
      await waitUntilRetryable(adminPool);
      assert.equal((await activeRuntime.consume()).status, "published");
      assert.deepEqual(await concurrentDelivery(), committedDuringCapture);
      assert.ok((await activeRuntime.health()).pending > 0);
      assert.equal((await activeRuntime.consume()).status, "published");
      assert.deepEqual(await concurrentDelivery(), { ...committedDuringCapture, delivered: committedDuringCapture.total });
      assert.equal((await ingest(ingestion, generatedAdapter(1, 101), "integration-after-publication-crash", "incremental")).status, "completed");
      await activeRuntime.close();
      activeRuntime = undefined;
      const pointerBeforeAckLoss = await adminPool.query("SELECT published_batch,index_name FROM aw_search.consumer WHERE id=1");
      assert.equal(await crashBoundary(searchConfig, "after"), 17);
      const pointerAfterAckLoss = await adminPool.query("SELECT published_batch,index_name FROM aw_search.consumer WHERE id=1");
      assert.notDeepEqual(pointerAfterAckLoss.rows[0], pointerBeforeAckLoss.rows[0]);
      activeRuntime = await createRuntime({ openSearchPort: opensearchPort });
      assert.equal((await activeRuntime.consume()).status, "idle");
      assert.equal((await ingest(ingestion, generatedAdapter(1, 102), "integration-race", "incremental")).status, "completed");
      const raced = await Promise.all([activeRuntime.consume(), activeRuntime.consume()]);
      assert.equal(raced.filter((item) => item.status === "published").length, 1, JSON.stringify(raced));
      assert.ok(raced.every((item) => ["published", "busy", "idle"].includes(item.status)), JSON.stringify(raced));
      const visible = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(visible.success, true);
      metrics.publicationLagMs.push(Math.max(0, Date.now() - Date.parse(visible.data.dataAsOf)));
      const invalid = await activeRuntime.readPort.search(query({ cursor: before.data.nextCursor }), CONTEXT());
      assert.equal(invalid.success, false); assert.equal(invalid.error.code, "invalid_cursor");
    });

    await phase("explicit withdrawal leaves immutable detail and history", async () => {
      const historical = await adminPool.query(`SELECT listing_id,latest_version_id FROM aw_connector.projections
        WHERE source_id=$1 AND source_listing_id='publication-page-0001'`, [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]);
      assert.equal(historical.rowCount, 1);
      const historyBefore = await adminPool.query(`SELECT
        (SELECT count(*)::int FROM aw_connector.listing_versions WHERE listing_id=$1) AS versions,
        (SELECT count(*)::int FROM aw_connector.observations WHERE listing_id=$1) AS observations`, [historical.rows[0].listing_id]);
      assert.equal((await ingest(ingestion, generatedAdapter(1, 0, "withdrawn"), "integration-explicit-withdrawal", "incremental")).status, "completed");
      assert.equal((await consumeAndMeasure()).status, "published");
      const withdrawn = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(withdrawn.success, true); assert.equal(withdrawn.data.totalCount, 999);
      const detail = await activeRuntime.readPort.getListing(historical.rows[0].listing_id, CONTEXT());
      assert.equal(detail.success, true); assert.equal(detail.data.results.length, 1);
      assert.equal(detail.data.results[0].availability, "withdrawn");
      const historyAfter = await adminPool.query(`SELECT p.latest_version_id,
        (SELECT count(*)::int FROM aw_connector.listing_versions WHERE listing_id=p.listing_id) AS versions,
        (SELECT count(*)::int FROM aw_connector.observations WHERE listing_id=p.listing_id) AS observations
        FROM aw_connector.projections p WHERE p.listing_id=$1`, [historical.rows[0].listing_id]);
      assert.deepEqual(historyAfter.rows[0], { latest_version_id: historical.rows[0].latest_version_id, ...historyBefore.rows[0] });
      withdrawalEvidence = { listingId: historical.rows[0].listing_id, history: historyAfter.rows[0] };
    });

    await phase("1000 to 1 full replacement completes with workload-specific effect budget", async () => {
      assert.ok(withdrawalEvidence);
      const inferredCandidate = await adminPool.query(`SELECT p.listing_id,p.latest_version_id,
        (SELECT count(*)::int FROM aw_connector.listing_versions WHERE listing_id=p.listing_id) AS versions,
        (SELECT count(*)::int FROM aw_connector.observations WHERE listing_id=p.listing_id) AS observations
        FROM aw_connector.projections p WHERE p.source_id=$1 AND p.source_listing_id='publication-page-0002'`,
      [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]);
      assert.equal(inferredCandidate.rowCount, 1);
      // The SDK caps each effect at min(request budget, source policy budget).
      // Only this 999-tombstone fixture needs the larger bounded allowance.
      const replacement = await ingest(ingestion, createCorpusAdapter("withdrawnBaseline"),
        "integration-mass-full-replacement", "full", { maxEffectMs: 10_000, maxRunMs: 100_000 }, { timeoutMs: 10_000 });
      const budgets = await adminPool.query(`SELECT request->>'invocationKey' AS invocation,
        (checkpoint#>>'{request,limits,maxEffectMs}')::int AS request_ms,
        (policy#>>'{operations,timeoutMs}')::int AS policy_ms,
        (checkpoint#>>'{request,limits,maxRunMs}')::int AS run_ms
        FROM aw_connector.runs WHERE source_id=$1 AND request->>'invocationKey'=ANY($2::text[])
        ORDER BY request->>'invocationKey'`, [SYNTHETIC_CORPUS_MANIFEST.source.sourceId,
        ["integration-explicit-withdrawal", "integration-mass-full-replacement"]]);
      assert.deepEqual(budgets.rows, [
        { invocation: "integration-explicit-withdrawal", request_ms: 2_000, policy_ms: 1_000, run_ms: 100_000 },
        { invocation: "integration-mass-full-replacement", request_ms: 10_000, policy_ms: 10_000, run_ms: 100_000 },
      ]);
      metrics.effectBudgets = budgets.rows.map((row) => ({ ...row, effective_ms: Math.min(row.request_ms, row.policy_ms) }));
      if (replacement.status !== "completed") {
        const diagnostic = new Error("connector_workload_failed");
        Object.defineProperty(diagnostic, "prototypePhase", {
          value: `mass-full-replacement-${replacement.error.code}-${replacement.error.phase}`,
        });
        throw diagnostic;
      }
      assert.equal((await consumeAndMeasure()).status, "published");
      const active = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(active.success, true); assert.equal(active.data.totalCount, 1);
      const retained = await activeRuntime.readPort.getListing(withdrawalEvidence.listingId, CONTEXT());
      assert.equal(retained.success, true); assert.equal(retained.data.results.length, 1);
      assert.equal(retained.data.results[0].availability, "withdrawn");
      const missing = await activeRuntime.readPort.getListing(inferredCandidate.rows[0].listing_id, CONTEXT());
      assert.equal(missing.success, true); assert.equal(missing.data.results.length, 1);
      assert.equal(missing.data.results[0].availability, "missing");
      const preserved = await adminPool.query(`SELECT p.latest_version_id,
        (SELECT count(*)::int FROM aw_connector.listing_versions WHERE listing_id=p.listing_id) AS versions,
        (SELECT count(*)::int FROM aw_connector.observations WHERE listing_id=p.listing_id) AS observations
        FROM aw_connector.projections p WHERE p.listing_id=$1`, [withdrawalEvidence.listingId]);
      assert.deepEqual(preserved.rows[0], withdrawalEvidence.history);
      const inferredHistory = await adminPool.query(`SELECT p.latest_version_id,
        (SELECT count(*)::int FROM aw_connector.listing_versions WHERE listing_id=p.listing_id) AS versions,
        (SELECT count(*)::int FROM aw_connector.observations WHERE listing_id=p.listing_id) AS observations
        FROM aw_connector.projections p WHERE p.listing_id=$1`, [inferredCandidate.rows[0].listing_id]);
      assert.deepEqual(inferredHistory.rows[0], {
        latest_version_id: inferredCandidate.rows[0].latest_version_id,
        versions: inferredCandidate.rows[0].versions,
        observations: inferredCandidate.rows[0].observations,
      });
      const tombstones = await adminPool.query(`SELECT
        count(*) FILTER (WHERE t.kind='explicit' AND r.request->>'invocationKey'='integration-explicit-withdrawal')::int AS explicit,
        count(*) FILTER (WHERE t.kind='inferred_missing' AND r.request->>'invocationKey'='integration-mass-full-replacement')::int AS inferred
        FROM aw_connector.tombstones t JOIN aw_connector.runs r USING(source_id,run_id)
        WHERE t.source_id=$1`, [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]);
      assert.deepEqual(tombstones.rows[0], { explicit: 1, inferred: 999 });
    });

    await phase("reconciliation rebuilds a missing disposable generation without canonical writes", async () => {
      const before = await canonicalDigest(adminPool);
      const publication = await adminPool.query("SELECT aw_search.publication() AS value");
      const indexName = publication.rows[0].value.indexName;
      const response = await globalThis.fetch(`http://127.0.0.1:${opensearchPort}/${indexName}`, { method: "DELETE" });
      assert.ok(response.ok, `delete index ${response.status}`);
      assert.equal((await activeRuntime.reconcile()).status, "published");
      assert.deepEqual(await canonicalDigest(adminPool), before);
      assert.equal((await activeRuntime.readPort.search(query(), CONTEXT())).success, true);
    });

    await phase("five failures quarantine without checkpoint advance and reviewed replay recovers", async () => {
      assert.equal((await ingest(ingestion, generatedAdapter(1, 200), "integration-poison", "incremental")).status, "completed");
      const before = await adminPool.query("SELECT published_batch,index_name FROM aw_search.consumer WHERE id=1");
      const broken = await createRuntime({ openSearchPort: 9 });
      try {
        let outcome;
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          await waitUntilRetryable(adminPool);
          outcome = await broken.consume();
          assert.ok(["waiting", "halted"].includes(outcome.status), JSON.stringify(outcome));
        }
        assert.equal(outcome.status, "halted");
      } finally { await broken.close(); }
      const after = await adminPool.query("SELECT published_batch,index_name,halted FROM aw_search.consumer WHERE id=1");
      assert.deepEqual(after.rows[0], { ...before.rows[0], halted: true });
      assert.equal((await activeRuntime.health()).alert, "critical");
      const quarantine = await adminPool.query("SELECT quarantine_id FROM aw_search.quarantine ORDER BY quarantine_id DESC LIMIT 1");
      assert.equal(quarantine.rowCount, 1);
      await activeRuntime.reviewReplay(`review_${quarantine.rows[0].quarantine_id}`);
      await waitUntilRetryable(adminPool);
      assert.equal((await consumeAndMeasure()).status, "published");
      assert.equal((await adminPool.query("SELECT count(*)::int AS count FROM aw_search.quarantine")).rows[0].count, 1);
      assert.equal((await adminPool.query("SELECT count(*)::int AS count FROM aw_search.replay_review")).rows[0].count, 1);
    });

    await phase("invalid canonical snapshot quarantines before publication and reviewed replay recaptures", async () => {
      assert.equal((await ingest(ingestion, generatedAdapter(1, 300), "integration-invalid-snapshot", "incremental")).status, "completed");
      const selected = await adminPool.query(`SELECT source_id,scope_id,listing_id,projection FROM aw_connector.projections
        WHERE source_id=$1 ORDER BY listing_id LIMIT 1`, [SYNTHETIC_CORPUS_MANIFEST.source.sourceId]);
      assert.equal(selected.rowCount, 1);
      const row = selected.rows[0];
      const canonical = await canonicalDigest(adminPool);
      await adminPool.query(`UPDATE aw_connector.projections SET projection='{}'::jsonb
        WHERE source_id=$1 AND scope_id=$2 AND listing_id=$3`, [row.source_id, row.scope_id, row.listing_id]);
      assert.equal((await activeRuntime.consume()).status, "halted");
      assert.equal((await activeRuntime.health()).alert, "critical");
      const quarantine = await adminPool.query("SELECT quarantine_id,code FROM aw_search.quarantine ORDER BY quarantine_id DESC LIMIT 1");
      assert.equal(quarantine.rows[0].code, "projection_invalid");
      await adminPool.query(`UPDATE aw_connector.projections SET projection=$4::jsonb
        WHERE source_id=$1 AND scope_id=$2 AND listing_id=$3`, [row.source_id, row.scope_id, row.listing_id, JSON.stringify(row.projection)]);
      assert.deepEqual(await canonicalDigest(adminPool), canonical);
      await activeRuntime.reviewReplay(`invalid_${quarantine.rows[0].quarantine_id}`);
      assert.equal((await consumeAndMeasure()).status, "published");
    });

    await phase("interrupted full publishes an explicit partial projection", async () => {
      const interrupted = await ingest(ingestion, createCorpusAdapter("partialInterrupted"), "integration-partial");
      assert.equal(interrupted.status, "failed");
      assert.equal((await activeRuntime.consume()).status, "published");
      const partial = await activeRuntime.readPort.search(query(), CONTEXT());
      assert.equal(partial.success, true); assert.equal(partial.data.state, "partial");
      assert.equal(Object.hasOwn(partial.data, "totalCount"), false);
    });

    await phase("worker and API roles exclude raw bytes and canonical writes", async () => {
      const privileges = await adminPool.query(`SELECT
        has_column_privilege('aw_search_worker','aw_connector.raw_pages','raw_bytes','SELECT') AS worker_raw,
        has_table_privilege('aw_search_worker','aw_connector.projections','UPDATE') AS worker_canonical_write,
        has_table_privilege('aw_search_api','aw_connector.projections','SELECT') AS api_canonical_read,
        has_function_privilege('aw_search_api','aw_search.publication()','EXECUTE') AS api_publication`);
      assert.deepEqual(privileges.rows[0], { worker_raw: false, worker_canonical_write: false,
        api_canonical_read: false, api_publication: true });
    });
  } finally {
    if (app !== undefined) await app.close();
    if (activeRuntime !== undefined) await activeRuntime.close();
    await ingestion.close();
  }
  metrics.publicationLagMs.sort((left, right) => left - right);
  assert.ok(metrics.publicationLagMs.length >= 6);
  assert.ok(metrics.publicationLagMs.every((value) => value <= 60_000), JSON.stringify(metrics.publicationLagMs));
  return { ...metrics, publicationLag: { samples: metrics.publicationLagMs.length,
    p50Ms: metrics.publicationLagMs[Math.ceil(metrics.publicationLagMs.length * 0.5) - 1],
    p95Ms: metrics.publicationLagMs[Math.ceil(metrics.publicationLagMs.length * 0.95) - 1],
    maxMs: metrics.publicationLagMs.at(-1) } };
}
