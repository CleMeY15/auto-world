import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { createSearchPrototype } from "../../services/search/.prototype-dist/index.js";
import { root, images as pinned, initProject, withProjectLock, compose, sql, port, reset, run } from "../data-infra/runtime.mjs";
import { discardTestProject } from "../data-infra/ephemeral.mjs";
import { protectedRecovery, withCancellation } from "../data-infra/cancellation.mjs";
import { migrate as migrateConnector } from "../prototype-postgres/migrations.mjs";
import { migrate, provisionRoles, readMigration, migrationChecksum, migrationSql } from "./migrations.mjs";
import { runSearchScenarios } from "../../services/search/test/integration.mjs";

const require = createRequire(new URL("../../services/ingestion/package.json", import.meta.url));
const { Pool } = require("pg");

function sourceIdentity() {
  try {
    const options = { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    return { sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], options).trim(),
      sourceDirty: execFileSync("git", ["status", "--porcelain"], options).trim() !== "" };
  } catch { return { sourceRevision: null, sourceDirty: null }; }
}

async function startServices(state) {
  await compose(state, ["up", "--detach", "--wait", "--wait-timeout", "180", "postgres", "opensearch"], { timeoutMs: 300_000 });
}

function searchRuntime(postgresPort, searchPort, credentials) {
  return createSearchPrototype({ postgres: { host: "127.0.0.1", port: postgresPort,
    workerPassword: credentials.workerPassword, apiPassword: credentials.apiPassword },
  opensearch: { port: searchPort } });
}

async function imageIdentities(state) {
  const result = [];
  for (const service of ["postgres", "opensearch"]) {
    const listed = await compose(state, ["ps", "--all", "--quiet", service], { timeoutMs: 15_000 });
    const identifier = listed.stdout.trim();
    if (!/^[a-f0-9]{12,64}$/u.test(identifier)) throw new Error("prototype_image_identity_invalid");
    const expected = `${pinned[service].repository}@${pinned[service].manifestDigest}`;
    const configured = await run("docker", ["container", "inspect", "--format", "{{json .Config.Image}}", identifier], { timeoutMs: 10_000 });
    const identity = await run("docker", ["container", "inspect", "--format", "{{.Image}}", identifier], { timeoutMs: 10_000 });
    if (configured.code !== 0 || identity.code !== 0) throw new Error("prototype_image_identity_invalid");
    let configuredImage;
    try { configuredImage = JSON.parse(configured.stdout.trim()); }
    catch { throw new Error("prototype_image_identity_invalid"); }
    const imageId = identity.stdout.trim();
    if (configuredImage !== expected || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error("prototype_image_identity_invalid");
    result.push({ service, configuredImage, imageId });
  }
  return result.sort((left, right) => left.service.localeCompare(right.service));
}

async function openAdminPool(state, postgresPort) {
  const pool = new Pool({ host: "127.0.0.1", port: postgresPort, database: "autoworld",
    user: "aw_migrator", password: state.credentials.pgMigrator, max: 4,
    connectionTimeoutMillis: 5_000, statement_timeout: 20_000,
    idle_in_transaction_session_timeout: 15_000 });
  pool.on("error", () => {});
  return pool;
}

export async function runIntegration() {
  if (process.env.NODE_ENV === "production") throw new Error("prototype_production_forbidden");
  const startedAt = new Date().toISOString();
  const source = sourceIdentity();
  const runId = randomUUID();
  const evidenceDirectory = path.join(root, ".local-data", "prototype-search", runId);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const phases = [];
  let state;
  let adminPool;
  let images = [];
  let integrationMetrics = null;
  let failure;
  let activePhase = "initialize-owned-project";
  let cleanupCompleted = false;
  const record = (name, durationMs = 0) => {
    phases.push({ name, status: "passed", durationMs: Math.round(durationMs * 100) / 100 });
    console.log(`PASS ${name}`);
  };
  try {
    state = await initProject({ test: true });
    await withProjectLock(state, async () => {
      activePhase = "start-pinned-services";
      const serviceStart = performance.now();
      await startServices(state);
      record("isolated-pinned-postgres-opensearch-start", performance.now() - serviceStart);
      activePhase = "inspect-owned-image-identities";
      images = await imageIdentities(state);
      assert.deepEqual(images.map((item) => item.service), ["opensearch", "postgres"]);
      activePhase = "apply-prototype-migrations";
      const postgresPort = await port(state, "postgres", 5432);
      const searchPort = await port(state, "opensearch", 9200);
      await migrateConnector(state);
      const credentials = await provisionRoles(state);

      const migrationStart = performance.now();
      await migrate(state); await migrate(state);
      assert.equal((await sql(state, "SELECT count(*) FROM aw_search_migration.history", { role: "migrator" })).trim(), "1");
      await migrate(state, "down"); await migrate(state, "down"); await migrate(state);
      const definition = readMigration();
      const changed = { ...definition, up: `${definition.up}\n-- integration drift` };
      changed.checksum = migrationChecksum(changed.up, changed.down);
      await assert.rejects(sql(state, migrationSql("up", changed), { role: "migrator" }));
      assert.equal((await sql(state, "SELECT count(*) FROM aw_search_migration.history", { role: "migrator" })).trim(), "3");
      record("search-migration-reapply-empty-rollback-drift-refusal", performance.now() - migrationStart);

      activePhase = "run-search-scenarios";
      adminPool = await openAdminPool(state, postgresPort);
      const runtime = searchRuntime(postgresPort, searchPort, credentials);
      const searchConfig = { postgres: { host: "127.0.0.1", port: postgresPort,
        workerPassword: credentials.workerPassword, apiPassword: credentials.apiPassword }, opensearch: { port: searchPort } };
      integrationMetrics = await runSearchScenarios({
        postgres: { host: "127.0.0.1", port: postgresPort, password: state.credentials.pgWriter },
        opensearchPort: searchPort, runtime, adminPool,
        searchConfig,
        createRuntime: async ({ openSearchPort }) => searchRuntime(postgresPort, openSearchPort, credentials),
        waitUntilRetryable: async (pool) => { await pool.query("UPDATE aw_search.progress SET next_attempt_at=clock_timestamp()-interval '1 second'"); },
        onPhase: record,
      });
      await assert.rejects(migrate(state, "down"));
      record("nonempty-search-rollback-refusal");
    });
  } catch (error) {
    if (error instanceof Error && typeof error.prototypePhase !== "string") {
      Object.defineProperty(error, "prototypePhase", { value: activePhase });
    }
    failure = error;
  }
  finally {
    if (adminPool !== undefined) {
      try { await adminPool.end(); } catch (error) { failure ??= error; }
    }
    if (state !== undefined) {
      try {
        await protectedRecovery(() => withProjectLock(state, async () => {
          await reset(state); await discardTestProject(state);
        }));
        cleanupCompleted = true;
      } catch (error) { failure ??= error; }
    }
    if (!failure && cleanupCompleted) record("owned-project-cleanup");
    const pins = JSON.parse(await readFile(new URL("../../infra/images.json", import.meta.url), "utf8"));
    await writeFile(path.join(evidenceDirectory, "result.json"), `${JSON.stringify({
      schemaVersion: 1, task: "TASK-0105", scope: "SYNTHETIC_V1_PROTOTYPE",
      productionApproval: false, imageQualification: "DEFERRED_UNTIL_V1", ...source,
      migrationChecksum: readMigration().checksum,
      pinnedImages: { postgres: pins.images.postgres.manifestDigest, opensearch: pins.images.opensearch.manifestDigest },
      imageIdentities: images, startedAt, finishedAt: new Date().toISOString(),
      metrics: integrationMetrics,
      status: failure ? "failed" : "passed", phaseCount: phases.length, phases, cleanupCompleted,
      failureCode: failure ? "prototype_search_integration_failed" : null,
    }, null, 2)}\n`, { mode: 0o600 });
  }
  if (failure) throw failure;
  return { phases, evidenceDirectory };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("prototype_invalid_arguments");
  await withCancellation(async () => {
    try { await runIntegration(); }
    catch (error) {
      console.error(error instanceof assert.AssertionError ? `prototype_assertion_failed:${error.code}` : "prototype_search_integration_failed");
      if (typeof error.prototypePhase === "string" && /^[a-zA-Z0-9 _:/()-]{1,180}$/u.test(error.prototypePhase)) {
        console.error(`phase:${error.prototypePhase}`);
      }
      const allowedScalar = new Set([true, false, "completed", "failed", "published", "halted", "idle", "busy", "waiting"]);
      if (error instanceof assert.AssertionError && allowedScalar.has(error.actual) && allowedScalar.has(error.expected)) {
        console.error(`assert:${String(error.actual)}:${String(error.expected)}`);
      }
      if (error instanceof assert.AssertionError && Number.isSafeInteger(error.actual) && Number.isSafeInteger(error.expected)
          && error.actual >= 0 && error.actual <= 10_000 && error.expected >= 0 && error.expected <= 10_000) {
        console.error(`assert-count:${error.actual}:${error.expected}`);
      }
      for (const frame of error.stack?.split("\n").filter((line) =>
        /^\s+at .*\/(?:services\/search\/test|scripts\/prototype-search)\/[^:]+:\d+:\d+\)?$/u.test(line.replaceAll("\\", "/"))).slice(0, 2) ?? []) {
        console.error(frame.trim().replaceAll("\\", "/"));
      }
      process.exitCode = 1;
    }
  }, { processExit: true });
}
