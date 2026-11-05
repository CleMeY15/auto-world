import "./guard.js";
import { Pool, type PoolClient } from "pg";
import { ProjectionRejected } from "./model.js";

export interface SearchDatabaseConnection {
  readonly host: "127.0.0.1" | "::1";
  readonly port: number;
  readonly workerPassword: string;
  readonly apiPassword: string;
}

export function searchPools(config: SearchDatabaseConnection, onUnavailable: () => void = () => {}) {
  if (!["127.0.0.1", "::1"].includes(config.host) || !Number.isInteger(config.port) ||
      config.port < 1 || config.port > 65535 ||
      !/^[a-f0-9]{64}$/u.test(config.workerPassword) || !/^[a-f0-9]{64}$/u.test(config.apiPassword) ||
      config.workerPassword === config.apiPassword) throw new Error("prototype_connection_invalid");
  const open = (user: string, password: string) => {
    const pool = new Pool({ host: config.host, port: config.port, password, user, database: "autoworld",
      ssl: false, max: 4, connectionTimeoutMillis: 2_000, idleTimeoutMillis: 5_000,
      statement_timeout: 10_000, lock_timeout: 2_000, idle_in_transaction_session_timeout: 15_000,
      application_name: "auto-world-search-prototype" });
    pool.on("error", () => { try { onUnavailable(); } catch { /* A telemetry sink must not terminate the process. */ } });
    return pool;
  };
  return { worker: open("aw_search_worker", config.workerPassword), api: open("aw_search_api", config.apiPassword) };
}

export async function withClient<T>(pool: Pool, signal: AbortSignal, action: (client: PoolClient) => Promise<T>): Promise<T> {
  if (signal.aborted) throw new ProjectionRejected("search_unavailable");
  const client = await pool.connect();
  let released = false;
  let completed = false;
  const destroy = () => { if (!released) { released = true; client.release(true); } };
  signal.addEventListener("abort", destroy, { once: true });
  client.on("error", destroy);
  try {
    if (signal.aborted) throw new ProjectionRejected("search_unavailable");
    const result = await action(client);
    completed = true;
    return result;
  } finally {
    signal.removeEventListener("abort", destroy);
    client.removeListener("error", destroy);
    // Only an acknowledged, clean operation may reuse a connection.
    if (!released) { released = true; client.release(!completed || signal.aborted); }
  }
}

export async function transaction<T>(client: PoolClient, action: () => Promise<T>, snapshot = false): Promise<T> {
  await client.query(snapshot ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN");
  try {
    const result = await action();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* The owning scope destroys this client. */ }
    throw error;
  }
}

export async function databaseTime(client: PoolClient): Promise<number> {
  const result = await client.query<{ now: number }>("SELECT floor(extract(epoch FROM clock_timestamp())*1000)::float8 AS now");
  return result.rows[0]!.now;
}
