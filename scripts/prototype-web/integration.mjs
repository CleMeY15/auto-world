import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { deriveListingId } from "../../connectors/_sdk/dist/keys.js";
import { parseDemoSearchResponseV2 } from "../../packages/demo-search-contract/dist/index.js";
import { root, initProject, withProjectLock, compose, port, reset, run, stop, up } from "../data-infra/runtime.mjs";
import { discardTestProject } from "../data-infra/ephemeral.mjs";
import { protectedRecovery, withCancellation } from "../data-infra/cancellation.mjs";
import { deriveRoleCredentials, migrate } from "../prototype-search/migrations.mjs";
import { ingest } from "../prototype-shared/ingestion.mjs";
import { openApplication } from "../prototype-application/runtime.mjs";
import { sourceIdentity } from "../prototype-application/evidence.mjs";
import { captureSnapshot, compareCanonicalSnapshot } from "../prototype-application/snapshot.mjs";
import { WEB_CATALOG, WEB_FIXTURE_VERSION, WEB_MAPPER_VERSION, WEB_PROJECTION,
  WEB_SEED_INVOCATION, createWebSeedAdapter, createWebDeltaAdapter } from "./profile.mjs";
import { prepareWebApplication, startWebProcess } from "./runtime.mjs";
import { openBrowserJourneys } from "./browser.mjs";
import { waitForWebServices } from "./readiness.mjs";
import { captureSnapshot as captureSearchSnapshot } from "../../services/search/.prototype-dist/snapshot.js";

const require = createRequire(new URL("../../services/ingestion/package.json", import.meta.url));
const { Pool } = require("pg");
const apiUrl = "http://127.0.0.1:3211";
const signal = () => new globalThis.AbortController().signal;
const listingId = (number) => deriveListingId("src_sdk_synthetic",
  `publication-prototype-web-${String(number).padStart(4, "0")}`);

async function request(route, query, status = 200) {
  const response = await globalThis.fetch(`${apiUrl}${route}`, { method: query ? "POST" : "GET",
    ...(query ? { headers: { "content-type": "application/json" }, body: JSON.stringify(query) } : {}),
    redirect: "error", signal: globalThis.AbortSignal.timeout(7_000) });
  assert.equal(response.status, status);
  const bytes = await response.arrayBuffer();
  assert.ok(bytes.byteLength <= 1024 * 1024);
  const envelope = JSON.parse(Buffer.from(bytes).toString("utf8"));
  assert.match(envelope.requestId, /^req_[a-f0-9]{32}$/u);
  if (status !== 200) { assert.equal(envelope.error.code, "read_unavailable"); return envelope.error; }
  if (route !== "/v2/demo/catalog") {
    assert.equal(parseDemoSearchResponseV2(envelope.data, new Date().toISOString()).success, true);
    assert.equal(envelope.data.fixtureVersion, WEB_FIXTURE_VERSION);
  }
  return envelope.data;
}
const query = (criteria = {}, status = 200) => request("/v2/demo/search", { schemaVersion: 2, sort: "listing_asc", ...criteria }, status);
const detail = async (number) => request(`/v2/demo/listings/${await listingId(number)}`);

async function allResults(expected) {
  const first = await query();
  const results = [...first.results];
  let cursor = first.nextCursor;
  for (let count = 1; cursor; count += 1) {
    assert.ok(count < 100);
    const page = await query({ cursor });
    assert.equal(page.dataAsOf, first.dataAsOf);
    results.push(...page.results); cursor = page.nextCursor;
  }
  assert.equal(results.length, expected);
  assert.equal(new Set(results.map((item) => item.listingId)).size, expected);
  return { dataAsOf: first.dataAsOf, fixtureVersion: first.fixtureVersion, taxonomyRelease: first.taxonomyRelease, results };
}

async function publish(application) {
  for (let count = 0; count < 40; count += 1) {
    const result = await application.search.consume({ signal: signal() });
    if (result.status === "idle") return;
    assert.notEqual(result.status, "halted");
    if (result.status !== "published") await delay(100);
  }
  throw new Error("prototype_web_publication_timeout");
}

async function mutationReceipts(pool) {
  const result = await pool.query(`SELECT m.operation_key, m.run_id, m.kind,
    encode(sha256(convert_to(to_jsonb(m)::text, 'UTF8')), 'hex') AS mutation_digest,
    encode(sha256(convert_to(to_jsonb(o)::text, 'UTF8')), 'hex') AS outbox_digest
    FROM aw_connector.mutations m JOIN aw_connector.outbox o
      USING (source_id,run_id,operation_key)
    ORDER BY m.operation_key COLLATE "C" LIMIT 100001`);
  assert.ok(result.rows.length <= 100_000);
  return result.rows;
}

export async function runWebIntegration() {
  const identity = sourceIdentity(root);
  const runId = randomUUID();
  const evidenceDirectory = path.join(root, ".local-data", "prototype-web", runId);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const phases = [];
  const metrics = {};
  const startedAt = new Date().toISOString();
  let activePhase = "setup";
  let state; let application; let admin; let web; let browser; let failure; let sentinel; let cleanupCompleted = false;
  let before; let publicBefore;
  const phase = async (name, action) => {
    activePhase = name;
    const start = performance.now();
    await action();
    phases.push({ name, status: "passed", durationMs: Math.round(performance.now() - start) });
    console.log(`PASS prototype-web:${name}`);
  };
  async function pool(user, password) {
    const value = new Pool({ host: "127.0.0.1", port: await port(state, "postgres", 5432), user, password,
      database: "autoworld", max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 25_000 });
    value.on("error", () => {});
    return value;
  }
  async function open(seed = false) {
    admin = await pool("aw_migrator", state.credentials.pgMigrator);
    application = await openApplication(state, { projectionV2: WEB_PROJECTION, consume: false, seed,
      webSeed: { adapter: createWebSeedAdapter(), invocationKey: WEB_SEED_INVOCATION } });
  }
  async function quiesce() {
    const app = application; application = undefined;
    const connection = admin; admin = undefined;
    try { await app?.close(); } finally { await connection?.end(); }
  }
  async function assertServicesHealthy() {
    const health = await waitForWebServices(state, { onDiagnostic: (entry) => {
      metrics.readinessDiagnostics ??= [];
      metrics.readinessDiagnostics.push({ integrationPhase: activePhase, ...entry });
    } });
    metrics.serviceHealth ??= {};
    metrics.serviceHealth[activePhase] = health;
    if (health.length !== 4 || health.some((entry) => entry.status !== "passed")) {
      console.error(JSON.stringify({ event: "prototype_web_dependency_health", phase: activePhase, health }));
    }
    assert.equal(health.length, 4);
    assert.ok(health.every((entry) => entry.status === "passed"));
  }
  try {
    state = { ...await initProject({ test: true }), deadlineAt: Date.now() + 25 * 60_000 };
    await phase("owned-four-service-and-additive-migration", async () => {
      await prepareWebApplication(state);
      await assertServicesHealthy();
      sentinel = `aw-web-sentinel-${runId}`;
      assert.equal((await run("docker", ["volume", "create", "--label", `io.auto-world.owner=${runId}`, sentinel])).code, 0);
    });
    await phase("sdk-seed-publication-and-minimal-privileges", async () => {
      await open(true);
      const client = await admin.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const now = (await client.query("SELECT clock_timestamp() AS now")).rows[0].now.getTime();
        assert.equal((await captureSearchSnapshot(client, now, WEB_PROJECTION)).documents.length, 1000);
      } finally { await client.query("ROLLBACK"); client.release(); }
      await publish(application);
      assert.deepEqual(await request("/v2/demo/catalog"), WEB_CATALOG);
      const first = await query(); assert.equal(first.totalCount, 1000);
      metrics.publicationLagMs = Date.now() - Date.parse(first.dataAsOf);
      assert.ok(metrics.publicationLagMs >= 0 && metrics.publicationLagMs <= 60_000);
      assert.equal((await allResults(1000)).results.filter((row) => row.description.status === "authored_synthetic").length, 900);
      const credentials = deriveRoleCredentials(state);
      const reader = await pool("aw_search_api", credentials.apiPassword);
      const worker = await pool("aw_search_worker", credentials.workerPassword);
      try {
        await assert.rejects(reader.query("SELECT raw_bytes FROM aw_connector.raw_pages LIMIT 1"), (error) => error.code === "42501");
        assert.equal((await worker.query("SELECT raw_bytes FROM aw_connector.raw_pages LIMIT 1")).rowCount, 1);
      } finally { await Promise.all([reader.end(), worker.end()]); }
      await assert.rejects(migrate(state, "down", 2));
    });
    await phase("raw-backed-description-history-omission-and-withdrawal", async () => {
      for (const name of ["history", "omitted", "withdrawn"]) {
        const outcome = await ingest(application.ingestion, createWebDeltaAdapter(name), `prototype-web-${name}-v2`, "incremental",
          {}, {}, { mapperVersion: WEB_MAPPER_VERSION });
        assert.equal(outcome.status, "completed"); await publish(application);
        if (name === "history") {
          const row = (await detail(1)).results[0];
          assert.equal(row.description.value.firstRegistrationYear, 2024); assert.equal(row.descriptionEvidence.length, 2);
        }
      }
      const row = (await detail(1)).results[0];
      assert.deepEqual(row.description, { status: "unavailable" }); assert.equal(row.descriptionEvidence.length, 2);
      assert.equal((await detail(2)).results[0].availability, "withdrawn");
      publicBefore = await allResults(999);
      before = await captureSnapshot(admin);
      metrics.rawPageCount = before.raw.count;
    });
    await phase("exact-filters-sorts-cursors-and-latency", async () => {
      const seed = publicBefore.results.find((row) => row.description.status === "authored_synthetic");
      const { makeId, modelId, firstRegistrationYear } = seed.description.value;
      for (const sort of ["listing_asc", "price_asc", "price_desc", "mileage_asc", "mileage_desc"]) {
        const page = await query({ sort, makeId, modelId, firstRegistrationYear, priceMaxMinor: 4_000_000, mileageMaxKm: 200_000 });
        assert.ok(page.results.length > 0);
        assert.ok(page.results.every((row) => row.description.value.makeId === makeId && row.description.value.modelId === modelId
          && row.description.value.firstRegistrationYear === firstRegistrationYear && row.price.value.amountMinor <= 4_000_000
          && row.mileage.value.amount <= 200_000));
      }
      assert.equal((await query({ priceMaxMinor: 0 })).results.length, 0);
      const first = await query(); assert.ok(first.nextCursor);
      assert.deepEqual(await query({ cursor: first.nextCursor }), await query({ cursor: first.nextCursor }));
      const samples = [];
      for (let index = 0; index < 50; index += 1) {
        const start = performance.now(); await query({ sort: index % 2 ? "price_asc" : "mileage_desc", makeId });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b); metrics.queryP95Ms = samples[Math.ceil(samples.length * 0.95) - 1];
      metrics.querySamples = samples.length; assert.ok(metrics.queryP95Ms < 500);
    });
    await phase("real-next-chromium-webkit-user-journeys", async () => {
      web = await startWebProcess(); browser = await openBrowserJourneys(evidenceDirectory);
      metrics.browser = browser.metrics;
    });
    await phase("full-service-stop-honest-unavailability", async () => {
      await quiesce(); await withProjectLock(state, () => stop(state));
      await browser.verifyUnavailable();
    });
    await phase("restart-with-identical-canonical-and-local-lists", async () => {
      await withProjectLock(state, () => up(state));
      await assertServicesHealthy();
      await open(); await publish(application);
      assert.equal(compareCanonicalSnapshot(before, await captureSnapshot(admin)), true);
      assert.deepEqual(await allResults(999), publicBefore);
      const replayBefore = await captureSnapshot(admin);
      const receiptsBefore = await mutationReceipts(admin);
      const replay = await ingest(application.ingestion, createWebSeedAdapter(), WEB_SEED_INVOCATION, "full",
        { maxEffectMs: 10_000, maxRunMs: 100_000 }, { timeoutMs: 10_000 }, { mapperVersion: WEB_MAPPER_VERSION });
      assert.equal(replay.status, "completed");
      const replayAfter = await captureSnapshot(admin);
      for (const table of ["raw_pages", "listing_versions", "observations", "tombstones"]) {
        assert.deepEqual(replayAfter.tables[`aw_connector.${table}`], replayBefore.tables[`aw_connector.${table}`]);
      }
      // A new fenced lease adds exactly one audited open receipt, never a second
      // copy of the pages or their canonical effects (ADR-0031).
      const receiptsAfter = await mutationReceipts(admin);
      const previousKeys = new Set(receiptsBefore.map((row) => row.operation_key));
      assert.deepEqual(receiptsAfter.filter((row) => previousKeys.has(row.operation_key)), receiptsBefore);
      const added = receiptsAfter.filter((row) => !previousKeys.has(row.operation_key));
      assert.equal(added.length, 1); assert.equal(added[0].kind, "run.opened"); assert.equal(added[0].run_id, replay.runId);
      for (const table of ["mutations", "outbox"]) {
        assert.equal(replayAfter.tables[`aw_connector.${table}`].count, replayBefore.tables[`aw_connector.${table}`].count + 1);
      }
      assert.equal((await application.search.consume()).status, "idle");
      assert.deepEqual(await allResults(999), publicBefore);
      await browser.verifyRestored();
    });
    await phase("index-dependency-failure-and-explicit-recovery", async () => {
      const previousPort = await port(state, "opensearch", 9200);
      await withProjectLock(state, () => compose(state, ["stop", "opensearch"], { timeoutMs: 30_000 }));
      await query({}, 503);
      // Docker can reassign ephemeral published ports when a stopped service
      // starts. Reopen clients using the supported TASK-0106 recovery path.
      await quiesce();
      await withProjectLock(state, () => up(state));
      await assertServicesHealthy();
      metrics.indexRecoveryPortChanged = previousPort !== await port(state, "opensearch", 9200);
      await open();
      assert.deepEqual(await allResults(999), publicBefore);
    });
    await phase("profile-mismatch-refused-before-listen-or-seed", async () => {
      await quiesce();
      const other = { ...WEB_PROJECTION, fixtureVersion: "synthetic-other-v2",
        catalog: { ...WEB_CATALOG, fixtureVersion: "synthetic-other-v2" } };
      await assert.rejects(openApplication(state, { port: 3211, projectionV2: other, consume: false }));
      await open(); assert.deepEqual(await allResults(999), publicBefore);
    });
  } catch (error) { failure = error; }
  finally {
    await protectedRecovery(async () => {
      for (const close of [() => browser?.close(), () => web?.close(), quiesce]) {
        try { await close(); } catch (error) { failure ??= error; }
      }
      if (state) {
        try {
          const cleanup = { ...state, deadlineAt: Date.now() + 120_000 };
          await withProjectLock(cleanup, async () => { await reset(cleanup); await discardTestProject(cleanup); });
          cleanupCompleted = true;
        } catch (error) { failure ??= error; }
      }
      if (sentinel) {
        try {
          const found = await run("docker", ["volume", "inspect", "--format", '{{index .Labels "io.auto-world.owner"}}', sentinel]);
          assert.equal(found.code, 0); assert.equal(found.stdout.trim(), runId);
          assert.equal((await run("docker", ["volume", "rm", sentinel])).code, 0);
        } catch (error) { failure ??= error; }
      }
    });
    await writeFile(path.join(evidenceDirectory, "result.json"), `${JSON.stringify({ schemaVersion: 1, task: "TASK-0119",
      scope: "SYNTHETIC_V1_PROTOTYPE", productionApproval: false, imageQualification: "DEFERRED_UNTIL_V1",
      ...identity, startedAt, finishedAt: new Date().toISOString(), status: failure ? "failed" : "passed", phases,
      phaseCount: phases.length, metrics, cleanupCompleted, failedPhase: failure ? activePhase : null,
      failureCode: failure ? "prototype_web_integration_failed" : null }, null, 2)}\n`, { mode: 0o600 });
  }
  if (failure) {
    console.error(`prototype_web_integration_failed:${activePhase}`);
    if (/^[a-z0-9_]{1,64}$/u.test(failure.code ?? "")) console.error(`code:${failure.code}`);
    if (/^prototype_[a-z0-9_]{1,80}$/u.test(failure.message ?? "")) console.error(`reason:${failure.message}`);
    if (typeof failure.actual === "number" && typeof failure.expected === "number") {
      console.error(JSON.stringify({ event: "prototype_web_assertion_failed", actual: failure.actual, expected: failure.expected }));
    }
    if (/^[a-z-]{1,64}$/u.test(failure.prototypeApplicationStep ?? "")) console.error(`step:${failure.prototypeApplicationStep}`);
    const frames = failure.stack?.split("\n").filter((line) => /\/(?:prototype-web|\.prototype-dist)\/[^:]+:\d+:\d+/u.test(line.replaceAll("\\", "/"))).slice(0, 6) ?? [];
    for (const frame of frames) console.error(frame.trim().replaceAll("\\", "/"));
    throw new Error("prototype_web_integration_failed");
  }
  return { evidenceDirectory, phases };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("prototype_web_arguments_invalid");
  await withCancellation(async () => { try { await runWebIntegration(); } catch { process.exitCode = 1; } }, { processExit: true });
}
