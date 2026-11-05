import "./guard.js";
import { Pool } from "pg";
import { createLease } from "./lease.js";
import { createStore } from "./store.js";

export interface PrototypeConnection {
  readonly host: "127.0.0.1" | "::1";
  readonly port: number;
  readonly password: string;
}

export function createPostgresPrototype(config: PrototypeConnection) {
  if (!["127.0.0.1", "::1"].includes(config.host) || !Number.isInteger(config.port) ||
      config.port < 1 || config.port > 65535 || !/^[a-f0-9]{64}$/u.test(config.password)) {
    throw new Error("prototype_connection_invalid");
  }
  const pool = new Pool({
    host: config.host, port: config.port, password: config.password,
    user: "aw_writer", database: "autoworld", ssl: false,
    max: 4, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 5_000,
    statement_timeout: 15_000, lock_timeout: 5_000, idle_in_transaction_session_timeout: 15_000,
    application_name: "auto-world-synthetic-prototype",
  });
  // Idle socket failure is not a domain event, and no driver message is logged.
  pool.on("error", () => {});
  return { store: createStore(pool), lease: createLease(pool), close: () => pool.end() };
}
