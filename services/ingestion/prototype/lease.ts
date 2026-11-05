import "./guard.js";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { ConnectorLeasePort, SourceLease } from "@auto-world/connector-sdk";
import { databaseNow, requireState, sourceTransaction, transaction } from "./database.js";
import type { SourceRow } from "./database.js";

export function createLease(pool: Pool): ConnectorLeasePort {
  return {
    async acquire(input) {
      requireState(Number.isSafeInteger(input.ttlMs) && input.ttlMs >= 1 && input.ttlMs <= 605_000);
      return sourceTransaction(pool, input.signal, input.sourceId, async (client, source, now) => {
        requireState(source.expires_at === null || source.expires_at.getTime() <= now, "stale_fence");
        requireState(source.lease_fence < Number.MAX_SAFE_INTEGER, "stale_fence");
        const lease: SourceLease = { leaseId: randomUUID(), leaseFence: source.lease_fence + 1,
          expiresAtMs: now + input.ttlMs };
        await client.query(`UPDATE aw_connector.sources SET lease_id=$2, lease_fence=$3,
          lease_run_id=$4, expires_at=$5, ttl_ms=$6 WHERE source_id=$1`,
        [input.sourceId, lease.leaseId, lease.leaseFence, input.runId, new Date(lease.expiresAtMs), input.ttlMs]);
        return lease;
      }, true);
    },
    async renew(input) {
      return transaction(pool, input.signal, async (client) => {
        const result = await client.query<SourceRow>(`SELECT source_id, lease_id, lease_fence::float8,
          lease_run_id, expires_at, ttl_ms, installed_fence::float8, runtime
          FROM aw_connector.sources WHERE lease_id=$1 FOR UPDATE`, [input.lease.leaseId]);
        const source = result.rows[0];
        const now = await databaseNow(client);
        requireState(source && source.lease_fence === input.lease.leaseFence && source.expires_at &&
          source.expires_at.getTime() > now && source.ttl_ms !== null, "stale_fence");
        const lease = { leaseId: input.lease.leaseId, leaseFence: input.lease.leaseFence,
          expiresAtMs: now + source.ttl_ms };
        await client.query("UPDATE aw_connector.sources SET expires_at=$2 WHERE source_id=$1", [source.source_id, new Date(lease.expiresAtMs)]);
        return lease;
      });
    },
    async release(input) {
      await transaction(pool, input.signal, async (client) => {
        const result = await client.query<SourceRow>(`SELECT source_id, lease_fence::float8, expires_at
          FROM aw_connector.sources WHERE lease_id=$1 FOR UPDATE`, [input.lease.leaseId]);
        const source = result.rows[0];
        const now = await databaseNow(client);
        requireState(source && source.lease_fence === input.lease.leaseFence && source.expires_at &&
          source.expires_at.getTime() > now, "stale_fence");
        await client.query("UPDATE aw_connector.sources SET expires_at=$2 WHERE source_id=$1", [source.source_id, new Date(now)]);
      });
    },
  };
}
