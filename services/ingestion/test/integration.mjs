import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

import { runConnector, systemScheduler } from "@auto-world/connector-sdk";
import { createPostgresPrototype } from "@auto-world/ingestion/prototype";
import { createCorpusAdapter } from "../../../connectors/synthetic/demo/adapter.mjs";
import { registry, request } from "../../../connectors/_sdk/test-support/fixtures.mjs";

const MAX_FENCE = Number.MAX_SAFE_INTEGER;
const noopTelemetry = Object.freeze({ emit() {} });

function registryFor(sourceId, overrides = {}) {
  return { ...globalThis.structuredClone(registry(overrides)), sourceId };
}

function registryForScopes(sourceId) {
  const current = registryFor(sourceId);
  return {
    ...current,
    revisions: current.revisions.map((revision) => {
      const grant = revision.configuration.policy.grants[0];
      return {
        ...revision,
        configuration: {
          ...revision.configuration,
          territories: ["FR", "DE"],
          policy: {
            ...revision.configuration.policy,
            grants: [grant, { ...grant, territory: "DE" }],
          },
        },
      };
    }),
  };
}

function requestFor(sourceId, invocationKey, overrides = {}) {
  return request({
    sourceId,
    invocationKey,
    fields: ["source_listing_id", "price", "mileage"],
    ...overrides,
  });
}

function authority(current) {
  return {
    async loadVerifiedCurrent(input) {
      const head = current.revisions.at(-1);
      return {
        trust: "authenticated_current",
        registry: current,
        authorityRevision: head.revision,
        verifiedAsOf: input.asOf,
        authorizationBasisRef: head.configuration.policy.authorization.basisRef,
      };
    },
  };
}

function ports(runtime, sourceRegistry, adapter, store = runtime.store) {
  return {
    authority: authority(sourceRegistry),
    lease: runtime.lease,
    store,
    adapter,
    clock: { nowMs: () => Date.now() },
    scheduler: systemScheduler,
    random: { next: () => 0 },
    telemetry: noopTelemetry,
  };
}

async function count(pool, relation, predicate = "TRUE", parameters = []) {
  assert.match(relation, /^[a-z_]+$/u);
  const result = await pool.query(`SELECT count(*)::int AS count FROM aw_connector.${relation} WHERE ${predicate}`, parameters);
  return result.rows[0].count;
}

async function run(runtime, sourceId, invocationKey, scenario = "valid", options = {}) {
  const sourceRegistry = options.sourceRegistry ?? registryFor(sourceId, options.registry);
  const trace = [];
  const adapter = options.adapter ?? createCorpusAdapter(scenario, trace);
  const result = await runConnector(
    requestFor(sourceId, invocationKey, options.request),
    ports(runtime, sourceRegistry, adapter, options.store ?? runtime.store),
    options.signal,
  );
  return { result, trace };
}

async function transactionSnapshot(pool, sourceId, runId) {
  const run = await pool.query(
    "SELECT checkpoint FROM aw_connector.runs WHERE source_id=$1 AND run_id=$2",
    [sourceId, runId],
  );
  return {
    checkpoint: run.rows[0]?.checkpoint ?? null,
    raw: await count(pool, "raw_pages", "source_id=$1", [sourceId]),
    versions: await count(pool, "listing_versions", "source_id=$1", [sourceId]),
    observations: await count(pool, "observations", "source_id=$1", [sourceId]),
    tombstones: await count(pool, "tombstones", "source_id=$1", [sourceId]),
    mutations: await count(pool, "mutations", "source_id=$1", [sourceId]),
    outbox: await count(pool, "outbox", "source_id=$1", [sourceId]),
  };
}

function afterAcknowledgementFailure(store, method) {
  let injected = false;
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== method) return Reflect.get(target, property, receiver);
      return async (input) => {
        const result = await target[method](input);
        if (!injected && result.success) {
          injected = true;
          throw new Error("synthetic_lost_acknowledgement");
        }
        return result;
      };
    },
  });
}

async function expectCompleted(value) {
  try {
    assert.equal(value.result.status, "completed");
  } catch (error) {
    if (error instanceof Error && value.result.status === "failed") {
      Object.defineProperty(error, "prototypeReason", {
        value: `${value.result.error.code}:${value.result.error.phase}`,
        enumerable: false,
      });
    }
    throw error;
  }
  return value.result;
}

/**
 * Runs the bounded, real-PostgreSQL transaction scenarios for TASK-0104.
 * The caller owns service lifecycle, migration, backup and restore.
 */
export async function runStoreScenarios({
  config: initialConfig,
  adminPool: initialAdminPool,
  restart,
  onPhase = () => {},
}) {
  assert.equal(typeof restart, "function");
  assert.equal(typeof onPhase, "function");
  let config = initialConfig;
  let adminPool = initialAdminPool;
  let runtime = createPostgresPrototype(config);
  const evidence = [];
  const phase = async (label, action) => {
    try {
      await action();
    } catch (error) {
      if (error instanceof Error) Object.defineProperty(error, "prototypePhase", { value: label, enumerable: false });
      throw error;
    }
    evidence.push(Object.freeze({ phase: label, passed: 1 }));
    onPhase(label);
    console.log(`PASS store:${label}`);
  };

  try {
    await phase("full run persists raw and immutable evidence atomically", async () => {
      const sourceId = "src_pg_full";
      await expectCompleted(await run(runtime, sourceId, "full-baseline"));
      assert.equal(await count(adminPool, "raw_pages", "source_id=$1", [sourceId]), 1);
      assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 1);
      assert.ok(await count(adminPool, "observations", "source_id=$1", [sourceId]) >= 1);
      assert.equal(await count(adminPool, "mutations", "source_id=$1", [sourceId]),
        await count(adminPool, "outbox", "source_id=$1", [sourceId]));
      const raw = await adminPool.query(`SELECT encode(sha256(raw_bytes), 'hex') AS actual, sha256,
        octet_length(raw_bytes) AS actual_length, byte_length FROM aw_connector.raw_pages WHERE source_id=$1`, [sourceId]);
      assert.equal(raw.rows[0].actual, raw.rows[0].sha256);
      assert.equal(raw.rows[0].actual_length, raw.rows[0].byte_length);
    });

    await phase("incremental run resumes from the durable full watermark", async () => {
      const sourceId = "src_pg_incremental";
      await expectCompleted(await run(runtime, sourceId, "baseline"));
      let observedCursor;
      const adapter = createCorpusAdapter("valid");
      const original = adapter.fetchPage;
      adapter.fetchPage = async (input) => {
        observedCursor = input.cursor;
        return original(input);
      };
      await expectCompleted(await run(runtime, sourceId, "delta", "valid", {
        adapter,
        request: { mode: "incremental" },
      }));
      assert.equal(observedCursor, "fixture-valid-v1");
      assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 2);
    });

    await phase("exact replay returns the original result without duplicate evidence", async () => {
      const sourceId = "src_pg_exact_replay";
      const first = await run(runtime, sourceId, "same-command");
      const before = await count(adminPool, "outbox", "source_id=$1", [sourceId]);
      const beforeRaw = await count(adminPool, "raw_pages", "source_id=$1", [sourceId]);
      const beforeVersions = await count(adminPool, "listing_versions", "source_id=$1", [sourceId]);
      const replay = await run(runtime, sourceId, "same-command");
      assert.deepEqual(replay.result, first.result);
      assert.equal(replay.trace.length, 0);
      assert.equal(await count(adminPool, "outbox", "source_id=$1", [sourceId]), before + 1,
        "the new fence records only its run.opened receipt");
      assert.equal(await count(adminPool, "raw_pages", "source_id=$1", [sourceId]), beforeRaw);
      assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), beforeVersions);
    });

    await phase("conflicting replay fails before acquisition", async () => {
      const sourceId = "src_pg_conflict";
      await expectCompleted(await run(runtime, sourceId, "reused-key"));
      const conflict = await run(runtime, sourceId, "reused-key", "valid", {
        request: { mapperVersion: "mapper-conflicting" },
      });
      assert.equal(conflict.result.status, "failed");
      assert.equal(conflict.result.error.code, "idempotency_conflict");
      assert.equal(conflict.trace.length, 0);
    });

    await phase("first open rejects a mismatched request source before installing its fence", async () => {
      const sourceId = "src_pg_open_source_binding";
      let exercised = false;
      const guardedStore = new Proxy(runtime.store, {
        get(target, property, receiver) {
          if (property !== "openRun") return Reflect.get(target, property, receiver);
          return async (input) => {
            if (!exercised) {
              exercised = true;
              const before = await transactionSnapshot(adminPool, input.sourceId, input.runId);
              const sourceBefore = await adminPool.query(
                "SELECT installed_fence::float8 AS installed_fence FROM aw_connector.sources WHERE source_id=$1",
                [input.sourceId],
              );
              for (const forged of [
                { ...input, request: { ...input.request, sourceId: "src_pg_foreign" } },
                { ...input, configurationSha256: "f".repeat(64) },
              ]) {
                const rejected = await target.openRun(forged);
                assert.equal(rejected.success, false);
                assert.equal(rejected.failure.code, "invalid_state");
                assert.deepEqual(await transactionSnapshot(adminPool, input.sourceId, input.runId), before);
                const sourceAfter = await adminPool.query(
                  "SELECT installed_fence::float8 AS installed_fence FROM aw_connector.sources WHERE source_id=$1",
                  [input.sourceId],
                );
                assert.deepEqual(sourceAfter.rows, sourceBefore.rows);
                assert.equal(await count(adminPool, "inventories", "source_id=$1", [input.sourceId]), 0);
                assert.equal(await count(adminPool, "runs", "source_id=$1", [input.sourceId]), 0);
              }
            }
            return target.openRun(input);
          };
        },
      });
      await expectCompleted(await run(runtime, sourceId, "bound-open-source", "valid", { store: guardedStore }));
      assert.equal(exercised, true);
    });

    await phase("completed run rejects a changed policy binding without writes", async () => {
      const sourceId = "src_pg_policy_binding";
      const baseline = await expectCompleted(await run(runtime, sourceId, "bound-policy"));
      const before = await transactionSnapshot(adminPool, sourceId, baseline.runId);
      const changedRegistry = registryFor(sourceId, { operations: { timeoutMs: 1_001 } });
      const rejected = await run(runtime, sourceId, "bound-policy", "valid", { sourceRegistry: changedRegistry });
      assert.equal(rejected.result.status, "failed");
      assert.equal(rejected.result.error.code, "idempotency_conflict");
      assert.equal(rejected.trace.length, 0);
      assert.deepEqual(await transactionSnapshot(adminPool, sourceId, baseline.runId), before);
    });

    await phase("raw staging rejects a prolonged retention deadline without writes", async () => {
      const sourceId = "src_pg_raw_ttl_binding";
      let exercised = false;
      const guardedStore = new Proxy(runtime.store, {
        get(target, property, receiver) {
          if (property !== "stageRaw") return Reflect.get(target, property, receiver);
          return async (input) => {
            if (!exercised) {
              exercised = true;
              const before = await transactionSnapshot(adminPool, input.sourceId, input.runId);
              const rawRetainUntil = new Date(Date.parse(input.deadlines.rawRetainUntil) + 1_000).toISOString();
              const rejected = await target.stageRaw({
                ...input,
                deadlines: { ...input.deadlines, rawRetainUntil },
              });
              assert.equal(rejected.success, false);
              assert.equal(rejected.failure.code, "invalid_state");
              assert.deepEqual(await transactionSnapshot(adminPool, input.sourceId, input.runId), before);
            }
            return target.stageRaw(input);
          };
        },
      });
      await expectCompleted(await run(runtime, sourceId, "bound-raw-ttl", "valid", { store: guardedStore }));
      assert.equal(exercised, true);
    });

    await phase("page commit rejects incoherent provenance without evidence writes", async () => {
      const sourceId = "src_pg_provenance_binding";
      let exercised = false;
      const guardedStore = new Proxy(runtime.store, {
        get(target, property, receiver) {
          if (property !== "commitPage") return Reflect.get(target, property, receiver);
          return async (input) => {
            if (!exercised) {
              exercised = true;
              const before = await transactionSnapshot(adminPool, input.sourceId, input.runId);
              const effects = globalThis.structuredClone(input.effects);
              effects.observations[0].provenance.observedAt = new Date(
                Date.parse(effects.observations[0].provenance.observedAt) + 1,
              ).toISOString();
              const rejected = await target.commitPage({ ...input, effects });
              assert.equal(rejected.success, false);
              assert.equal(rejected.failure.code, "invalid_state");
              assert.deepEqual(await transactionSnapshot(adminPool, input.sourceId, input.runId), before);
            }
            return target.commitPage(input);
          };
        },
      });
      await expectCompleted(await run(runtime, sourceId, "bound-provenance", "valid", { store: guardedStore }));
      assert.equal(exercised, true);
    });

    await phase("full finalization rejects a forged missing listing without writes", async () => {
      const sourceId = "src_pg_missing_binding";
      await expectCompleted(await run(runtime, sourceId, "missing-baseline"));
      let exercised = false;
      const guardedStore = new Proxy(runtime.store, {
        get(target, property, receiver) {
          if (property !== "finalizeFullRun") return Reflect.get(target, property, receiver);
          return async (input) => {
            if (!exercised) {
              exercised = true;
              assert.equal(input.inferredMissing.length, 1);
              const before = await transactionSnapshot(adminPool, input.sourceId, input.runId);
              const inferredMissing = input.inferredMissing.map((item, index) => index === 0
                ? { ...item, listingId: `lst_${"f".repeat(64)}` }
                : item);
              const rejected = await target.finalizeFullRun({ ...input, inferredMissing });
              assert.equal(rejected.success, false);
              assert.equal(rejected.failure.code, "invalid_state");
              assert.deepEqual(await transactionSnapshot(adminPool, input.sourceId, input.runId), before);
            }
            return target.finalizeFullRun(input);
          };
        },
      });
      await expectCompleted(await run(runtime, sourceId, "missing-empty", "empty", { store: guardedStore }));
      assert.equal(exercised, true);
    });

    for (const deletionMode of ["both", "full_reconciliation", "explicit_tombstone"]) {
      await phase(`full reconciliation applies ${deletionMode} absence semantics`, async () => {
        const sourceId = `src_pg_delete_${deletionMode}`;
        const registryOptions = { operations: { deletionMode } };
        await expectCompleted(await run(runtime, sourceId, "present", "valid", { registry: registryOptions }));
        await expectCompleted(await run(runtime, sourceId, "absent", "empty", { registry: registryOptions }));
        const inferred = await count(adminPool, "tombstones", "source_id=$1 AND kind='inferred_missing'", [sourceId]);
        assert.equal(inferred, deletionMode === "explicit_tombstone" ? 0 : 1);
        assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 1);
      });
    }

    await phase("same-source scopes reconcile without cross-scope tombstones", async () => {
      const sourceId = "src_pg_scope_isolation";
      const sourceRegistry = registryForScopes(sourceId);
      await expectCompleted(await run(runtime, sourceId, "fr-active", "valid", { sourceRegistry }));
      await expectCompleted(await run(runtime, sourceId, "de-active", "valid", {
        sourceRegistry,
        request: { territory: "DE" },
      }));
      await expectCompleted(await run(runtime, sourceId, "fr-empty", "empty", { sourceRegistry }));
      assert.equal(await count(adminPool, "inventories", "source_id=$1", [sourceId]), 2);
      const projections = await adminPool.query(`SELECT i.head->'scope'->>'territory' AS territory, p.state
        FROM aw_connector.projections p JOIN aw_connector.inventories i USING (source_id, scope_id)
        WHERE p.source_id=$1 ORDER BY territory`, [sourceId]);
      assert.deepEqual(projections.rows, [
        { territory: "DE", state: "active" },
        { territory: "FR", state: "missing" },
      ]);
      const tombstones = await adminPool.query(`SELECT i.head->'scope'->>'territory' AS territory, count(*)::int AS count
        FROM aw_connector.tombstones t JOIN aw_connector.inventories i USING (source_id, scope_id)
        WHERE t.source_id=$1 GROUP BY territory ORDER BY territory`, [sourceId]);
      assert.deepEqual(tombstones.rows, [{ territory: "FR", count: 1 }]);
    });

    await phase("explicit withdrawal preserves historical listing evidence", async () => {
      const sourceId = "src_pg_explicit_withdrawal";
      await expectCompleted(await run(runtime, sourceId, "active", "withdrawnBaseline"));
      await expectCompleted(await run(runtime, sourceId, "withdrawn", "withdrawnDelta"));
      assert.equal(await count(adminPool, "tombstones", "source_id=$1 AND kind='explicit'", [sourceId]), 1);
      assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 1);
    });

    await phase("invalid JSON is staged before decode and never creates canonical evidence", async () => {
      const sourceId = "src_pg_raw_before_decode";
      const malformed = await run(runtime, sourceId, "malformed", "malformed");
      assert.equal(malformed.result.status, "failed");
      assert.equal(malformed.result.error.code, "duplicate_member");
      assert.equal(await count(adminPool, "raw_pages", "source_id=$1", [sourceId]), 1);
      assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 0);
    });

    await phase("page failure before COMMIT rolls back canonical writes and remains resumable", async () => {
      const sourceId = "src_pg_commit_rollback";
      await adminPool.query(`CREATE FUNCTION aw_connector.test_fail_observation_insert() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN
          IF NEW.source_id = 'src_pg_commit_rollback' THEN
            RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='synthetic_page_commit_failure';
          END IF;
          RETURN NEW;
        END
        $body$;
        CREATE TRIGGER test_fail_observation_insert BEFORE INSERT ON aw_connector.observations
        FOR EACH ROW EXECUTE FUNCTION aw_connector.test_fail_observation_insert()`);
      try {
        const failed = await run(runtime, sourceId, "rollback-page");
        assert.equal(failed.result.status, "failed");
        assert.equal(failed.result.error.code, "mutation_indeterminate");
        assert.equal(await count(adminPool, "raw_pages", "source_id=$1", [sourceId]), 1);
        assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 0);
        assert.equal(await count(adminPool, "observations", "source_id=$1", [sourceId]), 0);
        assert.equal(await count(adminPool, "projections", "source_id=$1", [sourceId]), 0);
        assert.equal(await count(adminPool, "mutations", "source_id=$1 AND kind='page.committed'", [sourceId]), 0);
        assert.equal(await count(adminPool, "outbox", "source_id=$1", [sourceId]),
          await count(adminPool, "mutations", "source_id=$1", [sourceId]));
        const checkpoint = await adminPool.query(
          "SELECT checkpoint FROM aw_connector.runs WHERE source_id=$1",
          [sourceId],
        );
        assert.notEqual(checkpoint.rows[0].checkpoint.pendingRaw, null);
      } finally {
        await adminPool.query(`DROP TRIGGER IF EXISTS test_fail_observation_insert ON aw_connector.observations;
          DROP FUNCTION IF EXISTS aw_connector.test_fail_observation_insert()`);
      }
      await expectCompleted(await run(runtime, sourceId, "rollback-page"));
      assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 1);
      assert.ok(await count(adminPool, "observations", "source_id=$1", [sourceId]) >= 1);
    });

    for (const [label, forge] of [
      ["cursor", (input) => ({ ...input, nextCursor: `${input.nextCursor ?? "none"}-forged` })],
      ["completion", (input) => ({ ...input, complete: !input.complete })],
    ]) {
      await phase(`commit rejects forged ${label} metadata without partial writes`, async () => {
        const sourceId = `src_pg_forged_${label}`;
        let exercised = false;
        const guardedStore = new Proxy(runtime.store, {
          get(target, property, receiver) {
            if (property !== "commitPage") return Reflect.get(target, property, receiver);
            return async (input) => {
              if (!exercised) {
                exercised = true;
                const checkpointBefore = await adminPool.query(
                  "SELECT checkpoint FROM aw_connector.runs WHERE source_id=$1 AND run_id=$2",
                  [input.sourceId, input.runId],
                );
                const before = {
                  versions: await count(adminPool, "listing_versions", "source_id=$1", [input.sourceId]),
                  observations: await count(adminPool, "observations", "source_id=$1", [input.sourceId]),
                  mutations: await count(adminPool, "mutations", "source_id=$1", [input.sourceId]),
                  outbox: await count(adminPool, "outbox", "source_id=$1", [input.sourceId]),
                };
                const rejected = await target.commitPage(forge(input));
                assert.equal(rejected.success, false);
                assert.equal(rejected.failure.code, "invalid_state");
                const checkpointAfter = await adminPool.query(
                  "SELECT checkpoint FROM aw_connector.runs WHERE source_id=$1 AND run_id=$2",
                  [input.sourceId, input.runId],
                );
                assert.deepEqual(checkpointAfter.rows, checkpointBefore.rows);
                assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [input.sourceId]), before.versions);
                assert.equal(await count(adminPool, "observations", "source_id=$1", [input.sourceId]), before.observations);
                assert.equal(await count(adminPool, "mutations", "source_id=$1", [input.sourceId]), before.mutations);
                assert.equal(await count(adminPool, "outbox", "source_id=$1", [input.sourceId]), before.outbox);
              }
              return target.commitPage(input);
            };
          },
        });
        await expectCompleted(await run(runtime, sourceId, `forged-${label}`, "valid", { store: guardedStore }));
        assert.equal(exercised, true);
      });
    }

    for (const method of ["stageRaw", "commitPage", "finalizeFullRun"]) {
      await phase(`lost ${method} acknowledgement recovers without duplicate evidence`, async () => {
        const sourceId = `src_pg_lost_${method.toLowerCase()}`;
        const failingStore = afterAcknowledgementFailure(runtime.store, method);
        const first = await run(runtime, sourceId, "recoverable", "valid", { store: failingStore });
        assert.equal(first.result.status, "failed");
        assert.equal(first.result.error.code, "mutation_indeterminate");
        const beforeRaw = await count(adminPool, "raw_pages", "source_id=$1", [sourceId]);
        await expectCompleted(await run(runtime, sourceId, "recoverable"));
        assert.equal(beforeRaw, 1);
        assert.equal(await count(adminPool, "raw_pages", "source_id=$1", [sourceId]), 1);
        assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 1);
      });
    }

    await phase("staged raw lookup is scoped to its snapshot", async () => {
      const sourceId = "src_pg_scoped_raw";
      const staged = afterAcknowledgementFailure(runtime.store, "stageRaw");
      assert.equal((await run(runtime, sourceId, "scoped", "valid", { store: staged })).result.error.code,
        "mutation_indeterminate");
      let checked = false;
      const scopedStore = new Proxy(runtime.store, {
        get(target, property, receiver) {
          if (property !== "loadStagedRaw") return Reflect.get(target, property, receiver);
          return async (input) => {
            if (!checked) {
              checked = true;
              const foreign = await target.loadStagedRaw({ ...input, snapshotId: `raw_${"f".repeat(64)}` });
              assert.equal(foreign.success, false);
              assert.equal(foreign.failure.code, "not_found");
            }
            return target.loadStagedRaw(input);
          };
        },
      });
      await expectCompleted(await run(runtime, sourceId, "scoped", "valid", { store: scopedStore }));
      assert.equal(checked, true);
    });

    await phase("expired staged raw cannot be loaded or committed", async () => {
      const sourceId = "src_pg_expired_raw";
      const staged = afterAcknowledgementFailure(runtime.store, "stageRaw");
      assert.equal((await run(runtime, sourceId, "expired", "valid", { store: staged })).result.error.code,
        "mutation_indeterminate");
      const expiredStore = new Proxy(runtime.store, {
        get(target, property, receiver) {
          if (property !== "loadStagedRaw") return Reflect.get(target, property, receiver);
          return (input) => target.loadStagedRaw({ ...input, asOf: "9999-12-31T23:59:59.998Z" });
        },
      });
      const resumed = await run(runtime, sourceId, "expired", "valid", { store: expiredStore });
      assert.equal(resumed.result.status, "failed");
      assert.equal(resumed.result.error.code, "retention_expired");
      assert.equal(await count(adminPool, "listing_versions", "source_id=$1", [sourceId]), 0);
    });

    await phase("concurrent takeover fences an old store mutation under the source lock", async () => {
      const sourceId = "src_pg_store_takeover";
      await expectCompleted(await run(runtime, sourceId, "takeover-replay"));
      let exercised = false;
      const guardedStore = new Proxy(runtime.store, {
        get(target, property, receiver) {
          if (property !== "openRun") return Reflect.get(target, property, receiver);
          return async (input) => {
            const opened = await target.openRun(input);
            if (!exercised) {
              exercised = true;
              const before = await transactionSnapshot(adminPool, input.sourceId, input.runId);
              await adminPool.query(
                "UPDATE aw_connector.sources SET expires_at=clock_timestamp()-interval '1 millisecond' WHERE source_id=$1",
                [input.sourceId],
              );
              const blocker = await adminPool.connect();
              let takeoverLease;
              try {
                await blocker.query("BEGIN");
                await blocker.query("SELECT source_id FROM aw_connector.sources WHERE source_id=$1 FOR UPDATE", [input.sourceId]);
                const takeover = runtime.lease.acquire({
                  sourceId: input.sourceId,
                  runId: "run_concurrent_takeover",
                  ttlMs: 30_000,
                  signal: new globalThis.AbortController().signal,
                });
                await delay(25);
                const staleLookup = target.lookupMutation({
                  schemaVersion: 1,
                  sourceId: input.sourceId,
                  runId: input.runId,
                  operationKey: input.operationKey,
                  leaseFence: input.leaseFence,
                  expectedKind: "run.opened",
                  signal: input.signal,
                });
                await delay(25);
                await blocker.query("ROLLBACK");
                takeoverLease = await takeover;
                const rejected = await staleLookup;
                assert.equal(takeoverLease.leaseFence, input.leaseFence + 1);
                assert.equal(rejected.success, false);
                assert.equal(rejected.failure.code, "stale_fence");
                assert.deepEqual(await transactionSnapshot(adminPool, input.sourceId, input.runId), before);
              } finally {
                try { await blocker.query("ROLLBACK"); } catch { /* best effort lock release */ }
                blocker.release();
                if (takeoverLease) {
                  await runtime.lease.release({
                    lease: takeoverLease,
                    signal: new globalThis.AbortController().signal,
                  });
                }
              }
            }
            return opened;
          };
        },
      });
      await expectCompleted(await run(runtime, sourceId, "takeover-replay", "valid", { store: guardedStore }));
      assert.equal(exercised, true);
    });

    await phase("cancelled waiter rolls back without advancing a locked source fence", async () => {
      const sourceId = "src_pg_cancelled_lock";
      const seed = await runtime.lease.acquire({ sourceId, runId: "run_seed", ttlMs: 1, signal: new globalThis.AbortController().signal });
      await adminPool.query("UPDATE aw_connector.sources SET expires_at=clock_timestamp()-interval '1 millisecond' WHERE source_id=$1", [sourceId]);
      const blocker = await adminPool.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT source_id FROM aw_connector.sources WHERE source_id=$1 FOR UPDATE", [sourceId]);
        const controller = new globalThis.AbortController();
        const waiting = runtime.lease.acquire({ sourceId, runId: "run_cancelled", ttlMs: 30_000, signal: controller.signal });
        const rejection = assert.rejects(waiting, /prototype_operation_aborted/);
        await delay(50);
        controller.abort();
        await blocker.query("ROLLBACK");
        await rejection;
      } finally {
        try { await blocker.query("ROLLBACK"); } catch { /* best effort lock release */ }
        blocker.release();
      }
      const row = await adminPool.query("SELECT lease_fence::float8 AS fence FROM aw_connector.sources WHERE source_id=$1", [sourceId]);
      assert.equal(row.rows[0].fence, seed.leaseFence);
    });

    await phase("new lease fence rejects a stale lease", async () => {
      const sourceId = "src_pg_stale_fence";
      const oldLease = await runtime.lease.acquire({ sourceId, runId: "run_old", ttlMs: 30_000, signal: new globalThis.AbortController().signal });
      await adminPool.query("UPDATE aw_connector.sources SET expires_at=clock_timestamp()-interval '1 millisecond' WHERE source_id=$1", [sourceId]);
      const current = await runtime.lease.acquire({ sourceId, runId: "run_new", ttlMs: 30_000, signal: new globalThis.AbortController().signal });
      assert.equal(current.leaseFence, oldLease.leaseFence + 1);
      await assert.rejects(runtime.lease.release({ lease: oldLease, signal: new globalThis.AbortController().signal }), /stale_fence/);
    });

    await phase("lease bounds and maximum fence fail closed", async () => {
      const signal = new globalThis.AbortController().signal;
      await assert.rejects(runtime.lease.acquire({ sourceId: "src_pg_bad_ttl", runId: "run_bad", ttlMs: 605_001, signal }), /invalid_state/);
      const sourceId = "src_pg_max_fence";
      await adminPool.query(`INSERT INTO aw_connector.sources (source_id, lease_fence, runtime)
        VALUES ($1, $2, $3::jsonb)`, [sourceId, MAX_FENCE, JSON.stringify({
        schemaVersion: 1, sourceId, revision: 0, nextRequestAtMs: 0,
        circuit: { state: "closed", consecutiveTransientFailures: 0, openedAtMs: null,
          probeOwnerFence: null, probeExpiresAtMs: null },
      })]);
      await assert.rejects(runtime.lease.acquire({ sourceId, runId: "run_max", ttlMs: 30_000, signal }), /stale_fence/);
    });

    await phase("rate and circuit runtime state survives a PostgreSQL restart", async () => {
      const sourceId = "src_pg_durable_runtime";
      const completed = await expectCompleted(await run(runtime, sourceId, "before-restart"));
      const before = await adminPool.query("SELECT runtime FROM aw_connector.sources WHERE source_id=$1", [sourceId]);
      assert.ok(before.rows[0].runtime.revision > 0);
      assert.ok(before.rows[0].runtime.nextRequestAtMs > 0);
      const circuitSource = "src_pg_durable_circuit";
      const opened = await run(runtime, circuitSource, "open-circuit", "transientFailure");
      assert.equal(opened.result.status, "failed");
      assert.ok(["acquisition_failed", "circuit_open"].includes(opened.result.error.code));
      const circuitBefore = await adminPool.query("SELECT runtime FROM aw_connector.sources WHERE source_id=$1", [circuitSource]);
      assert.equal(circuitBefore.rows[0].runtime.circuit.state, "open");
      assert.equal(circuitBefore.rows[0].runtime.circuit.consecutiveTransientFailures, 5);
      const leases = await adminPool.query(`SELECT source_id, expires_at <= clock_timestamp() AS expired
        FROM aw_connector.sources WHERE source_id = ANY($1::text[]) ORDER BY source_id`, [[sourceId, circuitSource]]);
      assert.deepEqual(leases.rows, [
        { source_id: circuitSource, expired: true },
        { source_id: sourceId, expired: true },
      ]);
      await runtime.close();
      const restarted = await restart();
      assert.ok(restarted && typeof restarted === "object");
      assert.notEqual(restarted.adminPool, adminPool);
      assert.deepEqual(Object.keys(restarted.config).sort(), ["host", "password", "port"]);
      config = restarted.config;
      adminPool = restarted.adminPool;
      runtime = createPostgresPrototype(config);
      const replay = await expectCompleted(await run(runtime, sourceId, "before-restart"));
      assert.deepEqual(replay, completed);
      const after = await adminPool.query("SELECT runtime FROM aw_connector.sources WHERE source_id=$1", [sourceId]);
      assert.deepEqual(after.rows[0].runtime, before.rows[0].runtime);
      const refused = await run(runtime, circuitSource, "after-restart", "transientFailure");
      assert.equal(refused.result.status, "failed");
      assert.equal(refused.result.error.code, "circuit_open");
      assert.equal(refused.trace.length, 0);
      const circuitAfter = await adminPool.query("SELECT runtime FROM aw_connector.sources WHERE source_id=$1", [circuitSource]);
      assert.deepEqual(circuitAfter.rows[0].runtime, circuitBefore.rows[0].runtime);
    });
  } finally {
    await runtime.close();
  }

  return Object.freeze(evidence);
}
