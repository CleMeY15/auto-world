import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

import { createCorpusAdapter } from "../../connectors/synthetic/demo/index.mjs";
import { root, images as pins, initProject, loadProject, withProjectLock, compose, port,
  reset, run, stop, up, serviceStates } from "../data-infra/runtime.mjs";
import { discardTestProject } from "../data-infra/ephemeral.mjs";
import { protectedRecovery, withCancellation } from "../data-infra/cancellation.mjs";
import { s3, redis, serviceHealth } from "../data-infra/probes.mjs";
import { backup, restoreCheck } from "../data-infra/backup.mjs";
import { ingest, generatedAdapter } from "../prototype-shared/ingestion.mjs";
import { prepareApplication, openApplication, SEED_INVOCATION } from "./runtime.mjs";
import { captureSnapshot, compareRestoredSnapshot, compareCanonicalSnapshot } from "./snapshot.mjs";
import { queryApplication, readAll, benchmark, assertPublicationPreserved } from "./http.mjs";
import { sourceIdentity } from "./evidence.mjs";

const require = createRequire(new URL("../../services/ingestion/package.json", import.meta.url));
const { Pool } = require("pg");
const APPLICATION_PORT = 3211;
const SERVICES = ["postgres", "opensearch", "redis", "object-store"];
const objectKey = "v1/raw/src_application_probe/run_application_probe/raw_application_probe";
const objectBytes = Buffer.from("Auto World fabricated recovery acceptance object v1\n");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function imageIdentities(state) {
  const result = [];
  for (const service of SERVICES) {
    const listed = await compose(state, ["ps", "--all", "--quiet", service], { timeoutMs: 15_000 });
    const identifier = listed.stdout.trim();
    assert.match(identifier, /^[a-f0-9]{12,64}$/u);
    const pin = pins[service === "object-store" ? "seaweedfs" : service];
    const configured = await run("docker", ["container", "inspect", "--format", "{{json .Config.Image}}", identifier], { timeoutMs: 10_000 });
    const identity = await run("docker", ["container", "inspect", "--format", "{{.Image}}", identifier], { timeoutMs: 10_000 });
    assert.equal(configured.code, 0); assert.equal(identity.code, 0);
    const configuredImage = JSON.parse(configured.stdout.trim());
    assert.equal(configuredImage, `${pin.repository}@${pin.manifestDigest}`);
    const imageId = identity.stdout.trim();
    assert.match(imageId, /^sha256:[a-f0-9]{64}$/u);
    result.push({ service, configuredImage, imageId });
  }
  return result;
}

async function adminPool(state) {
  const pool = new Pool({ host: "127.0.0.1", port: await port(state, "postgres", 5432),
    database: "autoworld", user: "aw_migrator", password: state.credentials.pgMigrator,
    max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 20_000, idle_in_transaction_session_timeout: 20_000 });
  pool.on("error", () => {});
  return pool;
}

// Child output is only interpreted against the readiness schema, never copied to evidence.
async function launchServer(state, { seed = false } = {}) {
  const child = spawn(process.execPath, ["--conditions=auto-world-prototype", "--conditions=auto-world-demo",
    fileURLToPath(new URL("./server.mjs", import.meta.url)), "--project", state.project, ...(seed ? ["--seed"] : [])],
  { cwd: root, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  let ended;
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => { ended = { code, signal }; resolve(ended); });
    child.once("error", () => { ended = { code: -1, signal: null }; resolve(ended); });
  });
  const ready = new Promise((resolve, reject) => {
    let buffer = "";
    let listenerReady = false;
    let consumerObserved = false;
    const timer = setTimeout(() => reject(new Error("application_child_readiness_timeout")), 240_000);
    closed.then(() => { clearTimeout(timer); reject(new Error("application_child_early_exit")); });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (buffer.length > 16_384) { clearTimeout(timer); reject(new Error("application_child_output_limit")); return; }
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        let value;
        try { value = JSON.parse(line); } catch { continue; }
        if (value.event === "prototype_application_ready" && value.project === state.project && value.port === APPLICATION_PORT) {
          listenerReady = true;
        }
        if (value.event === "prototype_application_signal" && value.name === "application_health"
            && value.pending === 0 && value.alert === "none") consumerObserved = true;
        if (listenerReady && consumerObserved) { clearTimeout(timer); resolve(); }
      }
    });
  });
  async function close(signal = "SIGTERM") {
    if (!ended) child.kill(signal);
    let timer;
    try {
      return await Promise.race([closed, new Promise((_, reject) => {
        timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("application_child_shutdown_timeout")); }, 90_000);
      })]);
    } finally { clearTimeout(timer); }
  }
  try { await ready; } catch (error) { await close(); throw error; }
  return { close, url: `http://127.0.0.1:${APPLICATION_PORT}` };
}

function duplicateSensitive(snapshot) {
  return Object.fromEntries(["raw_pages", "listing_versions", "observations", "tombstones", "mutations", "outbox"]
    .map((table) => [table, snapshot.tables[`aw_connector.${table}`]]));
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

export async function runIntegration() {
  if (process.env.NODE_ENV === "production") throw new Error("prototype_production_forbidden");
  const startedAt = new Date().toISOString();
  const identity = sourceIdentity(root);
  const runId = randomUUID();
  const evidenceDirectory = path.join(root, ".local-data", "prototype-application", runId);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const phases = [];
  const metrics = { fixtureDocuments: 1000, performance: null, publicationLagMs: null,
    sourceHealth: { completedRuns: 0, failedRuns: 0, failedTelemetryEvents: 0 }, searchHealth: null,
    observedApiFailureAlerts: 0, recovery: null, failureDiagnostic: null };
  let state, pool, application, child, sentinel, failure;
  let images = [];
  let beforeBackup = null;
  let activePhase = "initialize";
  let cleanupCompleted = false;
  const phase = async (name, action) => {
    activePhase = name;
    console.log(`START application:${name}`);
    const started = performance.now();
    await action();
    phases.push({ name, status: "passed", durationMs: Math.round(performance.now() - started) });
    console.log(`PASS application:${name}`);
  };
  const open = async () => {
    pool = await adminPool(state);
    application = await openApplication(state, { port: APPLICATION_PORT, consume: false, onEvent(event) {
      if (event.name === "api.failure") metrics.observedApiFailureAlerts += 1;
    } });
  };
  const quiesce = async () => {
    const closingApplication = application; application = undefined;
    const closingPool = pool; pool = undefined;
    let failure;
    try { await closingApplication?.close(); } catch (error) { failure = error; }
    try { await closingPool?.end(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  };
  const syntheticTelemetry = { emit(event) {
    if (event.outcome === "failed") metrics.sourceHealth.failedTelemetryEvents += 1;
  } };
  try {
    state = { ...await initProject({ test: true }), deadlineAt: Date.now() + 20 * 60_000 };
    await phase("pinned-four-service-composition", async () => {
      await prepareApplication(state);
      images = await imageIdentities(state);
      await open();
      assert.ok((await serviceHealth(state)).every((entry) => entry.status === "passed"));
      assert.equal(await s3(state, "put-object", { key: objectKey, bytes: objectBytes }), "created");
      assert.equal(await s3(state, "put-object", { key: objectKey, bytes: objectBytes }), "precondition412");
      assert.equal(await redis(state, "SET", "aw:application:probe", "synthetic"), "OK");
    });
    await phase("failed-receipt-then-canonical-outbox-http-publication", async () => {
      const interrupted = await ingest(application.ingestion, createCorpusAdapter("partialInterrupted"),
        "application-partial", "full", {}, {}, { telemetry: syntheticTelemetry });
      assert.equal(interrupted.status, "failed"); metrics.sourceHealth.failedRuns += 1;
      await quiesce();
      child = await launchServer(state, { seed: true });
      assert.equal((await queryApplication(child.url)).totalCount, 1000);
      assert.equal((await child.close("SIGKILL")).signal, "SIGKILL"); child = undefined;
      await open();
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM aw_connector.runs WHERE status='completed'")).rows[0].count, 1);
      metrics.sourceHealth.completedRuns += 1;
      assert.equal((await application.search.consume()).status, "idle");
      const data = await queryApplication(application.url);
      assert.equal(data.totalCount, 1000);
      metrics.publicationLagMs = Math.max(0, Date.now() - Date.parse(data.dataAsOf));
      assert.ok(metrics.publicationLagMs <= 60_000);
      assert.ok(metrics.sourceHealth.failedTelemetryEvents > 0);
      assert.ok((await pool.query("SELECT count(*)::int AS count FROM aw_connector.mutations WHERE kind='run.terminal'")).rows[0].count > 0);
    });
    let expected;
    await phase("actual-http-paging-filters-and-p95", async () => {
      expected = await readAll(application.url);
      assert.equal(expected.results.length, 1000);
      assert.equal((await queryApplication(application.url, { priceMaxMinor: 1_000_010 })).totalCount, 10);
      metrics.performance = await benchmark(application.url);
      metrics.searchHealth = await application.search.health();
      assert.equal(metrics.searchHealth.alert, "none"); assert.equal(metrics.searchHealth.pending, 0);
    });
    await phase("replayed-invocation-adds-only-audited-open-receipt", async () => {
      const before = duplicateSensitive(await captureSnapshot(pool));
      const receiptsBefore = await mutationReceipts(pool);
      const replayed = await ingest(application.ingestion, generatedAdapter(1000), SEED_INVOCATION, "full",
        { maxEffectMs: 10_000, maxRunMs: 100_000 }, { timeoutMs: 10_000 });
      assert.equal(replayed.status, "completed");
      const after = duplicateSensitive(await captureSnapshot(pool));
      for (const table of ["raw_pages", "listing_versions", "observations", "tombstones"]) {
        assert.deepEqual(after[table], before[table]);
      }
      // A fresh lease has its own immutable run.opened receipt, even for exact
      // completed replay. It must not duplicate any page/finalization effects.
      const receiptsAfter = await mutationReceipts(pool);
      const previousKeys = new Set(receiptsBefore.map((row) => row.operation_key));
      assert.deepEqual(receiptsAfter.filter((row) => previousKeys.has(row.operation_key)), receiptsBefore);
      const added = receiptsAfter.filter((row) => !previousKeys.has(row.operation_key));
      assert.equal(added.length, 1);
      assert.equal(added[0].kind, "run.opened");
      assert.equal(added[0].run_id, replayed.runId);
      assert.equal(after.mutations.count, before.mutations.count + 1);
      assert.equal(after.outbox.count, before.outbox.count + 1);
      assert.equal((await application.search.consume()).status, "idle");
      assertPublicationPreserved(await readAll(application.url, { expectedCount: expected.results.length }), expected);
    });
    await phase("hard-process-restart-and-graceful-stop-preserve-state", async () => {
      const before = duplicateSensitive(await captureSnapshot(pool));
      await quiesce();
      child = await launchServer(state);
      await assert.rejects(access(path.join(root, ".local-data", "projects", state.project, "operation.lock")), { code: "ENOENT" });
      assertPublicationPreserved(await readAll(child.url, { expectedCount: expected.results.length }), expected);
      const crashed = await child.close("SIGKILL"); child = undefined;
      assert.equal(crashed.signal, "SIGKILL");
      child = await launchServer(state);
      assertPublicationPreserved(await readAll(child.url, { expectedCount: expected.results.length }), expected);
      const stopped = await child.close(); child = undefined;
      assert.equal(stopped.code, 143); // Cooperative SIGTERM; cleanup has completed before exit.
      assert.ok(Object.values(await serviceStates(state)).every((entry) => entry.state === "exited"));
      await prepareApplication(state); await open();
      assert.deepEqual(duplicateSensitive(await captureSnapshot(pool)), before);
      assertPublicationPreserved(await readAll(application.url, { expectedCount: expected.results.length }), expected);
    });
    for (const service of SERVICES) {
      await phase(`isolated-failure-and-recovery-${service}`, async () => {
        await withProjectLock(state, () => stop(state, [service]));
        const health = await serviceHealth(state);
        assert.equal(health.find((entry) => entry.service === service).status, "failed");
        assert.ok(health.filter((entry) => entry.service !== service).every((entry) => entry.status === "passed"));
        await queryApplication(application.url, {}, ["postgres", "opensearch"].includes(service) ? 503 : 200);
        await quiesce();
        await withProjectLock(state, () => up(state));
        await open();
        assertPublicationPreserved(await readAll(application.url, { expectedCount: expected.results.length }), expected);
      });
    }
    await phase("quiesced-cold-backup-and-isolated-rpo-zero-restore", async () => {
      assert.equal(metrics.observedApiFailureAlerts, 2);
      await application.close(); application = undefined;
      beforeBackup = await captureSnapshot(pool);
      await pool.end(); pool = undefined;
      await withProjectLock(state, async () => {
        const saved = await backup(state);
        const restoreStartedAt = new Date().toISOString();
        const backupAgeMs = Date.parse(restoreStartedAt) - Date.parse(saved.manifest.createdAt);
        assert.ok(backupAgeMs >= 0 && backupAgeMs <= 300_000);
        const restoreStart = performance.now();
        let restoredState;
        const restored = await restoreCheck(state, saved.backupId, { verify: async (target) => {
          let restoredPool, restoredApplication;
          try {
            restoredPool = await adminPool(target);
            restoredState = await captureSnapshot(restoredPool);
            compareRestoredSnapshot(beforeBackup, restoredState);
            assert.equal(await redis(target, "GET", "aw:application:probe"), "");
            assert.equal(hash(await s3(target, "get-object", { key: objectKey })), hash(objectBytes));
            restoredApplication = await openApplication(target, { port: APPLICATION_PORT, consume: false });
            await queryApplication(restoredApplication.url, {}, 503);
            assert.equal((await restoredApplication.search.reconcile()).status, "published");
            compareCanonicalSnapshot(beforeBackup, await captureSnapshot(restoredPool));
            assertPublicationPreserved(await readAll(restoredApplication.url, { expectedCount: expected.results.length }), expected);
            const restoreAndRebuildMs = performance.now() - restoreStart;
            assert.ok(restoreAndRebuildMs <= 600_000);
            metrics.recovery = { backupCreatedAt: saved.manifest.createdAt, restoreStartedAt, backupAgeMs,
              restoreAndRebuildMs, rpoLostRows: 0, exactPreReconcileMatch: true,
              rawHashesVerified: true, redisFresh: true, s3ObjectPreserved: true };
          } finally {
            try { if (restoredApplication) await restoredApplication.close(); }
            finally { if (restoredPool) await restoredPool.end(); }
          }
        } });
        await assert.rejects(loadProject(restored.project), (error) => error.code === "project_not_initialized");
        assert.ok(restoredState);
      });
      // Cold backup must not have changed the source, including failure receipts.
      pool = await adminPool(state);
      compareRestoredSnapshot(beforeBackup, await captureSnapshot(pool));
      await pool.end(); pool = undefined;
    });
    await phase("scoped-reset-preserves-independent-sentinel", async () => {
      sentinel = `aw-sentinel-${runId}`;
      assert.equal((await run("docker", ["volume", "create", "--label", `io.auto-world.owner=${runId}`, sentinel], { timeoutMs: 10_000 })).code, 0);
      await withProjectLock(state, async () => { await reset(state); await discardTestProject(state); });
      cleanupCompleted = true;
      const found = await run("docker", ["volume", "inspect", "--format", '{{index .Labels "io.auto-world.owner"}}', sentinel], { timeoutMs: 10_000 });
      assert.equal(found.code, 0); assert.equal(found.stdout.trim(), runId);
    });
  } catch (error) {
    failure = error;
    if (pool) {
      try {
        const latest = await pool.query("SELECT code FROM aw_search.quarantine ORDER BY quarantine_id DESC LIMIT 1");
        const code = latest.rows[0]?.code;
        if (["projection_invalid", "projection_limit", "search_unavailable", "attempts_exhausted"].includes(code)) {
          metrics.failureDiagnostic = { quarantine: code };
          console.error(`quarantine:${code}`);
        }
      } catch { /* The failing dependency can also make diagnostics unavailable. */ }
    }
  }
  finally {
    await protectedRecovery(async () => {
      try { if (child) await child.close(); } catch (error) { failure ??= error; }
      try { await quiesce(); } catch (error) { failure ??= error; }
      if (state && !cleanupCompleted) {
        try {
          const cleanup = { ...state, deadlineAt: Date.now() + 120_000 };
          await withProjectLock(cleanup, async () => { await reset(cleanup); await discardTestProject(cleanup); });
          cleanupCompleted = true;
        } catch (error) { failure ??= error; }
      }
      if (sentinel) {
        try {
          const found = await run("docker", ["volume", "inspect", "--format", '{{index .Labels "io.auto-world.owner"}}', sentinel], { timeoutMs: 10_000 });
          assert.equal(found.code, 0); assert.equal(found.stdout.trim(), runId);
          assert.equal((await run("docker", ["volume", "rm", sentinel], { timeoutMs: 10_000 })).code, 0);
        } catch (error) { failure ??= error; }
      }
    });
    await writeFile(path.join(evidenceDirectory, "result.json"), `${JSON.stringify({ schemaVersion: 1,
      task: "TASK-0106", scope: "SYNTHETIC_V1_PROTOTYPE", productionApproval: false,
      imageQualification: "DEFERRED_UNTIL_V1", ...identity, imageIdentities: images,
      startedAt, finishedAt: new Date().toISOString(), status: failure ? "failed" : "passed",
      phases, phaseCount: phases.length, metrics, snapshot: beforeBackup, cleanupCompleted,
      failureCode: failure ? "prototype_application_integration_failed" : null,
      failedPhase: failure ? activePhase : null,
    }, null, 2)}\n`, { mode: 0o600 });
  }
  if (failure) {
    console.error(`prototype_application_integration_failed:${activePhase}`);
    if (/^[a-z0-9_]{1,64}$/u.test(failure.code ?? "")) console.error(`code:${failure.code}`);
    if (/^[a-z-]{1,64}$/u.test(failure.prototypeApplicationStep ?? "")) console.error(`step:${failure.prototypeApplicationStep}`);
    const sqlstate = failure.stderr?.match(/ERROR:\s+([A-Z0-9]{5})/u)?.[1];
    if (sqlstate) console.error(`sqlstate:${sqlstate}`);
    const categories = [
      ["access_denied", /\(AccessDenied\)|\(403\)/u], ["not_found", /\(404\)|\(NoSuchBucket\)|\(NotFound\)/u],
      ["connection_failed", /Could not connect|Connect timeout|Read timeout/iu],
      ["permission_denied", /Permission denied/iu], ["invalid_cli_option", /Unknown options|Invalid choice/u],
    ].filter(([, pattern]) => pattern.test(failure.stderr ?? "")).map(([code]) => code);
    if (categories.length) console.error(`categories:${categories.join(",")}`);
    // Only fixed file/line and bounded scalar diagnostics; no SQL, payloads or credentials.
    const frame = failure.stack?.split("\n").find((line) => /\/prototype-application\/[^:]+:\d+:\d+/u.test(line.replaceAll("\\", "/")));
    if (frame) console.error(frame.trim().replaceAll("\\", "/"));
    if (failure instanceof assert.AssertionError && [failure.actual, failure.expected].every((value) =>
      typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 10_000)) {
      console.error(`assert-count:${failure.actual}:${failure.expected}`);
    }
    const statuses = new Set(["failed", "completed", "published", "halted", "waiting", "idle", true, false]);
    if (failure instanceof assert.AssertionError && statuses.has(failure.actual) && statuses.has(failure.expected)) {
      console.error(`assert-status:${failure.actual}:${failure.expected}`);
    }
    throw new Error("prototype_application_integration_failed");
  }
  return { evidenceDirectory, phases };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("prototype_invalid_arguments");
  await withCancellation(async () => {
    try { await runIntegration(); } catch { process.exitCode = 1; }
  }, { processExit: true });
}
