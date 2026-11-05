import "./guard.js";
import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { databaseTime, transaction, withClient } from "./database.js";
import { PROFILE, ProjectionRejected, requireProjection, stable, type PublicSnapshot } from "./model.js";
import { captureSnapshot } from "./snapshot.js";
import type { OpenSearchTransport } from "./opensearch.js";

export interface ProjectionTelemetry {
  emit(event: { readonly name: "published" | "retry" | "halted" | "lag_warning" | "reconciled" | "cleanup_deferred" | "database_unavailable";
    readonly durationMs?: number; readonly documents?: number; readonly attempt?: number; readonly lagMs?: number }): void;
}
export interface ConsumerOutcome {
  readonly status: "published" | "idle" | "busy" | "waiting" | "halted";
  readonly attempt?: number;
}
interface State { fence: string; active_batch: string | null; published_batch: string | null; index_name: string | null; halted: boolean }
interface Batch { batch_id: string; cycle: number; snapshot: PublicSnapshot | null; payload_sha256: string | null; next_attempt_at: Date }

const relevant = `FROM aw_connector.outbox o
  JOIN aw_connector.mutations m USING (source_id,run_id,operation_key)
  JOIN aw_connector.runs r USING (source_id,run_id)
  WHERE o.source_id=$1 AND r.scope_id=$2 AND m.kind IN ('page.committed','full.finalized')
  AND NOT EXISTS (SELECT 1 FROM aw_search.delivery d
    WHERE (d.source_id,d.run_id,d.operation_key)=(o.source_id,o.run_id,o.operation_key))`;
const scope = [PROFILE.sourceId, PROFILE.scopeId];
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");
const id = () => randomBytes(16).toString("hex");

export function lagAlert(input: { halted: boolean; lagMs: number; nowMs: number; slowSinceMs: number | null }) {
  const slowSinceMs = input.lagMs > 60_000 ? input.slowSinceMs ?? input.nowMs : null;
  const alert = input.halted ? "critical" : slowSinceMs !== null && input.nowMs - slowSinceMs >= 300_000 ? "warning" : "none";
  return { alert, slowSinceMs } as const;
}

export function createConsumer(pool: Pool, search: OpenSearchTransport, telemetry?: ProjectionTelemetry) {
  const emit = (event: Parameters<ProjectionTelemetry["emit"]>[0]) => { try { telemetry?.emit(Object.freeze(event)); } catch { /* Metrics are not authority. */ } };

  async function locked<T>(signal: AbortSignal, action: (client: PoolClient, fence: string) => Promise<T>): Promise<T | { status: "busy" }> {
    return withClient(pool, signal, async (client) => {
      const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(109624,105) AS locked");
      if (!lock.rows[0]?.locked) return { status: "busy" };
      const acquired = await client.query<{ fence: string }>(`UPDATE aw_search.consumer SET fence=fence+1
        WHERE id=1 AND fence<9007199254740991 RETURNING fence`);
      requireProjection(acquired.rowCount === 1);
      const result = await action(client, acquired.rows[0]!.fence);
      const unlocked = await client.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock(109624,105) AS unlocked");
      requireProjection(unlocked.rows[0]?.unlocked);
      return result;
    });
  }

  async function halt(client: PoolClient, batchId: string, cycle: number, code: string) {
    await client.query(`INSERT INTO aw_search.quarantine(batch_id,cycle,code) VALUES($1,$2,$3)
      ON CONFLICT(batch_id,cycle) DO NOTHING`, [batchId, cycle, code]);
    await client.query("UPDATE aw_search.consumer SET halted=true WHERE id=1 AND active_batch=$1", [batchId]);
  }

  async function retireObsolete(client: PoolClient, signal: AbortSignal): Promise<void> {
    // A 120s grace exceeds both the worker's 55s lifetime and the API's 5s
    // deadline, measured from replacement for previously published indices.
    // Only names durably allocated by this database are candidates;
    // the transport additionally verifies their exact index ownership metadata.
    const candidates = await client.query<{ index_name: string }>(`SELECT a.index_name FROM aw_search.attempt a
      LEFT JOIN aw_search.superseded_index s USING(index_name)
      CROSS JOIN aw_search.consumer c WHERE c.id=1
      AND COALESCE(s.recorded_at,a.recorded_at) < clock_timestamp()-interval '120 seconds'
      AND a.index_name IS DISTINCT FROM c.index_name
      AND NOT EXISTS(SELECT 1 FROM aw_search.retired_index r WHERE r.index_name=a.index_name)
      ORDER BY a.recorded_at,a.index_name LIMIT 100`);
    for (const candidate of candidates.rows) {
      try {
        await search.remove(candidate.index_name, signal);
        await client.query("INSERT INTO aw_search.retired_index(index_name) VALUES($1)", [candidate.index_name]);
      } catch {
        if (signal.aborted) throw new ProjectionRejected("search_unavailable");
        emit({ name: "cleanup_deferred" });
        // A single refused candidate must not starve later owned generations.
      }
    }
  }

  async function prepare(client: PoolClient, rebuild: boolean): Promise<Batch | ConsumerOutcome> {
    return transaction(client, async () => {
      const state = (await client.query<State>("SELECT * FROM aw_search.consumer WHERE id=1 FOR UPDATE")).rows[0]!;
      if (state.halted) return { status: "halted" };
      if (state.active_batch) {
        const rows = await client.query<Batch>(`SELECT b.batch_id,b.payload_sha256,p.cycle,p.next_attempt_at,v.snapshot
          FROM aw_search.batch b JOIN aw_search.progress p USING(batch_id)
          LEFT JOIN aw_search.payload v USING(batch_id) WHERE b.batch_id=$1`, [state.active_batch]);
        requireProjection(rows.rows.length === 1);
        return rows.rows[0]!;
      }
      // These events cannot change a public listing. Recording their disposition
      // does not publish a watermark or invalidate pagination.
      await client.query(`INSERT INTO aw_search.delivery(source_id,run_id,operation_key,disposition)
        SELECT o.source_id,o.run_id,o.operation_key,'noop' FROM aw_connector.outbox o
        JOIN aw_connector.mutations m USING(source_id,run_id,operation_key)
        JOIN aw_connector.runs r USING(source_id,run_id)
        WHERE o.source_id=$1 AND r.scope_id=$2
        AND m.kind IN ('run.opened','attempt.reserved','attempt.completed','raw.staged','circuit.changed','run.terminal')
        ON CONFLICT DO NOTHING`, scope);
      const events = await client.query<{ source_id: string; run_id: string; operation_key: string }>(
        `SELECT o.source_id,o.run_id,o.operation_key ${relevant} ORDER BY o.run_id,o.operation_key LIMIT 100001`, scope);
      if (!events.rows.length && !rebuild) return { status: "idle" };
      const batchId = id();
      let snapshot: PublicSnapshot | null = null;
      let poison: string | null = null;
      try {
        if (events.rows.length > 100000) throw new ProjectionRejected("projection_limit");
        snapshot = await captureSnapshot(client, await databaseTime(client));
      } catch (error) {
        if (!(error instanceof ProjectionRejected)) throw error;
        poison = error.code;
      }
      const metadata = snapshot ? { schemaVersion: snapshot.schemaVersion, fixtureVersion: snapshot.fixtureVersion,
        dataAsOf: snapshot.dataAsOf, completeness: snapshot.completeness, fingerprint: snapshot.fingerprint } : null;
      await client.query(`INSERT INTO aw_search.batch(batch_id,mapping_version,metadata,payload_sha256,document_count,rebuild)
        VALUES($1,1,$2::jsonb,$3,$4,$5)`, [batchId, JSON.stringify(metadata), snapshot ? hash(snapshot) : null,
        snapshot?.documents.length ?? 0, rebuild]);
      await client.query(`INSERT INTO aw_search.batch_event(batch_id,source_id,run_id,operation_key)
        SELECT $1,e.source_id,e.run_id,e.operation_key FROM jsonb_to_recordset($2::jsonb)
        AS e(source_id text,run_id text,operation_key text)`, [batchId, JSON.stringify(events.rows)]);
      if (snapshot) await client.query("INSERT INTO aw_search.payload(batch_id,snapshot) VALUES($1,$2::jsonb)", [batchId, JSON.stringify(snapshot)]);
      await client.query("INSERT INTO aw_search.progress(batch_id) VALUES($1)", [batchId]);
      await client.query("UPDATE aw_search.consumer SET active_batch=$1 WHERE id=1", [batchId]);
      if (poison) { await halt(client, batchId, 0, poison); return { status: "halted" }; }
      return { batch_id: batchId, cycle: 0, snapshot, payload_sha256: hash(snapshot), next_attempt_at: new Date(0) };
    }, true);
  }

  async function consume(options: { signal?: AbortSignal; rebuild?: boolean } = {}): Promise<ConsumerOutcome> {
    const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(55_000)]);
    const started = performance.now();
    try {
      const outcome = await locked(signal, async (client, fence): Promise<ConsumerOutcome> => {
        await retireObsolete(client, signal);
        const batch = await prepare(client, options.rebuild === true);
        if ("status" in batch) return batch;
        if (!batch.snapshot || batch.payload_sha256 !== hash(batch.snapshot)) {
          await transaction(client, () => halt(client, batch.batch_id, batch.cycle, "projection_invalid"));
          return { status: "halted" };
        }
        const now = await databaseTime(client);
        if (batch.next_attempt_at.getTime() > now) return { status: "waiting" };
        const attempts = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM aw_search.attempt WHERE batch_id=$1 AND cycle=$2`, [batch.batch_id, batch.cycle]);
        const attempt = attempts.rows[0]!.count + 1;
        if (attempt > 5) {
          await transaction(client, () => halt(client, batch.batch_id, batch.cycle, "attempts_exhausted"));
          return { status: "halted" };
        }
        const indexName = `aw-v1-search-${id()}`;
        await transaction(client, async () => {
          await client.query("INSERT INTO aw_search.attempt(batch_id,cycle,number,index_name) VALUES($1,$2,$3,$4)", [batch.batch_id, batch.cycle, attempt, indexName]);
          await client.query("UPDATE aw_search.progress SET next_attempt_at=clock_timestamp()+($2*interval '1 millisecond') WHERE batch_id=$1", [batch.batch_id, 250 * 2 ** (attempt - 1)]);
        });
        try {
          await search.build(indexName, batch.snapshot.documents, signal);
        } catch {
          if (signal.aborted) throw new ProjectionRejected("search_unavailable");
          if (attempt === 5) {
            await transaction(client, () => halt(client, batch.batch_id, batch.cycle, "search_unavailable"));
            return { status: "halted", attempt };
          }
          emit({ name: "retry", attempt });
          return { status: "waiting", attempt };
        }
        if (signal.aborted) throw new ProjectionRejected("search_unavailable");
        await transaction(client, async () => {
          await client.query(`INSERT INTO aw_search.superseded_index(index_name)
            SELECT index_name FROM aw_search.consumer WHERE id=1 AND index_name IS NOT NULL`);
          const publication = await client.query(`UPDATE aw_search.consumer SET published_batch=$1,index_name=$2,active_batch=NULL,
            published_revision=published_revision+1
            WHERE id=1 AND fence=$3 AND active_batch=$1 AND NOT halted AND published_revision<9007199254740991`, [batch.batch_id, indexName, fence]);
          requireProjection(publication.rowCount === 1);
          await client.query(`INSERT INTO aw_search.delivery(source_id,run_id,operation_key,disposition,batch_id)
            SELECT source_id,run_id,operation_key,'projected',batch_id FROM aw_search.batch_event
            WHERE batch_id=$1`, [batch.batch_id]);
          // Payloads alone are derived and disposable. Preserve immutable batch,
          // attempts/deliveries/quarantine records and the currently published data.
          await client.query("DELETE FROM aw_search.payload WHERE batch_id<>$1", [batch.batch_id]);
        });
        emit({ name: "published", attempt, documents: batch.snapshot.documents.length,
          durationMs: performance.now() - started, lagMs: Math.max(0, await databaseTime(client) - Date.parse(batch.snapshot.dataAsOf)) });
        return { status: "published", attempt };
      });
      if (outcome.status === "halted") emit({ name: "halted" });
      return outcome;
    } catch {
      // No driver query, endpoint, credentials or received payload escapes.
      throw new ProjectionRejected("search_unavailable");
    }
  }

  async function reviewReplay(reviewRef: string, inputSignal?: AbortSignal): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(reviewRef)) throw new Error("search_review_invalid");
    const signal = AbortSignal.any([inputSignal ?? new AbortController().signal, AbortSignal.timeout(15_000)]);
    const result = await locked(signal, (client) => transaction(client, async () => {
      const found = await client.query<{ batch_id: string; cycle: number; quarantine_id: string; has_payload: boolean }>(
        `SELECT p.batch_id,p.cycle,q.quarantine_id,EXISTS(SELECT 1 FROM aw_search.payload v WHERE v.batch_id=p.batch_id) AS has_payload
         FROM aw_search.consumer c JOIN aw_search.progress p ON p.batch_id=c.active_batch
         JOIN aw_search.quarantine q ON q.batch_id=p.batch_id AND q.cycle=p.cycle WHERE c.id=1 AND c.halted FOR UPDATE OF c,p`);
      const row = found.rows[0];
      requireProjection(row && row.cycle < 1000);
      await client.query("INSERT INTO aw_search.replay_review(quarantine_id,review_ref) VALUES($1,$2)", [row.quarantine_id, reviewRef]);
      await client.query("UPDATE aw_search.progress SET cycle=cycle+1,next_attempt_at=clock_timestamp() WHERE batch_id=$1", [row.batch_id]);
      await client.query("UPDATE aw_search.consumer SET halted=false,active_batch=$1 WHERE id=1", [row.has_payload ? row.batch_id : null]);
    }));
    if (result?.status === "busy") throw new ProjectionRejected("search_unavailable");
  }

  async function health(): Promise<{ pending: number; lagMs: number; alert: "none" | "warning" | "critical" }> {
    return withClient(pool, AbortSignal.timeout(10_000), (client) => transaction(client, async () => {
      const pending = await client.query<{ count: number; oldest: Date | null }>(`SELECT count(*)::int AS count,min(o.enqueued_at) AS oldest ${relevant}`, scope);
      const state = (await client.query<{ halted: boolean; lag_since: Date | null }>("SELECT halted,lag_since FROM aw_search.consumer WHERE id=1 FOR UPDATE")).rows[0]!;
      const nowMs = await databaseTime(client);
      const lagMs = pending.rows[0]!.oldest ? Math.max(0, nowMs - pending.rows[0]!.oldest!.getTime()) : 0;
      const result = lagAlert({ halted: state.halted, lagMs, nowMs, slowSinceMs: state.lag_since?.getTime() ?? null });
      await client.query("UPDATE aw_search.consumer SET lag_since=$1 WHERE id=1", [result.slowSinceMs === null ? null : new Date(result.slowSinceMs)]);
      if (result.alert === "critical") emit({ name: "halted", lagMs });
      if (result.alert === "warning") emit({ name: "lag_warning", lagMs });
      return { pending: pending.rows[0]!.count, lagMs, alert: result.alert };
    }));
  }

  async function reconcile(options: { signal?: AbortSignal } = {}): Promise<ConsumerOutcome> {
    const signal = options.signal ?? AbortSignal.timeout(55_000);
    const current = await withClient(pool, signal, async (client) => (await client.query<{ index_name: string | null; snapshot: PublicSnapshot | null; halted: boolean }>(
      `SELECT c.index_name,c.halted,p.snapshot FROM aw_search.consumer c LEFT JOIN aw_search.payload p ON p.batch_id=c.published_batch WHERE c.id=1`)).rows[0]!);
    if (current.halted) return { status: "halted" };
    const matches = current.index_name && current.snapshot
      ? await search.verify(current.index_name, current.snapshot.documents, signal) : false;
    if (matches) return consume({ signal });
    const outcome = await consume({ signal, rebuild: true });
    if (outcome.status === "published") emit({ name: "reconciled" });
    return outcome;
  }
  return { consume, health, reviewReplay, reconcile };
}
