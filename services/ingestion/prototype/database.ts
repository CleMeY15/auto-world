import "./guard.js";
import type { Pool, PoolClient } from "pg";
import type { SourceRuntimeState, StoreFailureCode } from "@auto-world/connector-sdk";

export type DatabaseClient = Pick<PoolClient, "query">;

export interface SourceRow {
  source_id: string;
  lease_id: string | null;
  lease_fence: number;
  lease_run_id: string | null;
  expires_at: Date | null;
  ttl_ms: number | null;
  installed_fence: number;
  runtime: SourceRuntimeState;
}

export class Rejected extends Error {
  constructor(readonly code: StoreFailureCode = "invalid_state") {
    super(code);
    this.name = "PrototypeStoreRejected";
  }
}

export function requireState(condition: unknown, code: StoreFailureCode = "invalid_state"): asserts condition {
  if (!condition) throw new Rejected(code);
}

// No retry here: a COMMIT transport failure can mean a committed transaction.
// Destroying the client also prevents an aborted command from reusing its session.
export async function transaction<T>(
  pool: Pool, signal: AbortSignal, action: (client: DatabaseClient) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw new Error("prototype_operation_aborted");
  let client: PoolClient;
  try { client = await pool.connect(); } catch { throw new Error("prototype_database_unavailable"); }
  let released = false;
  const release = (destroy: boolean) => {
    if (!released) { released = true; client.release(destroy); }
  };
  const abort = () => release(true);
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) { abort(); throw new Error("prototype_operation_aborted"); }
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '15s'; SET LOCAL lock_timeout = '5s'; SET LOCAL idle_in_transaction_session_timeout = '15s'; SET LOCAL search_path = pg_catalog");
    const result = await action(client);
    if (signal.aborted) throw new Error("prototype_operation_aborted");
    await client.query("COMMIT");
    if (signal.aborted) throw new Error("prototype_operation_aborted");
    return result;
  } catch (error) {
    if (error instanceof Rejected && !released && !signal.aborted) {
      try { await client.query("ROLLBACK"); } catch {
        release(true);
        throw new Error("prototype_database_indeterminate");
      }
      throw error;
    }
    release(true);
    // eslint-disable-next-line preserve-caught-error -- Driver context may contain credentials/raw values; expose only a fixed code.
    throw new Error(signal.aborted ? "prototype_operation_aborted" : "prototype_database_indeterminate");
  } finally {
    signal.removeEventListener("abort", abort);
    release(false);
  }
}

export async function databaseNow(client: DatabaseClient): Promise<number> {
  const result = await client.query<{ now_ms: number }>("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::float8 AS now_ms");
  const now = result.rows[0]?.now_ms;
  requireState(typeof now === "number" && Number.isSafeInteger(now) && now >= 0);
  return now;
}

export async function sourceTransaction<T>(
  pool: Pool, signal: AbortSignal, sourceId: string,
  action: (client: DatabaseClient, source: SourceRow, nowMs: number) => Promise<T>, create = false,
): Promise<T> {
  return transaction(pool, signal, async (client) => {
    if (create) {
      const runtime = { schemaVersion: 1, sourceId, revision: 0, nextRequestAtMs: 0,
        circuit: { state: "closed", consecutiveTransientFailures: 0, openedAtMs: null,
          probeOwnerFence: null, probeExpiresAtMs: null } };
      await client.query("INSERT INTO aw_connector.sources (source_id, runtime) VALUES ($1, $2::jsonb) ON CONFLICT (source_id) DO NOTHING", [sourceId, JSON.stringify(runtime)]);
    }
    const result = await client.query<SourceRow>(`SELECT source_id, lease_id, lease_fence::float8,
      lease_run_id, expires_at, ttl_ms, installed_fence::float8, runtime
      FROM aw_connector.sources WHERE source_id = $1 FOR UPDATE`, [sourceId]);
    const source = result.rows[0];
    requireState(source, "stale_fence");
    // Separate statement: clock_timestamp in a row-lock query can precede its wait.
    return action(client, source, await databaseNow(client));
  });
}
