import "./guard.js";
import { searchPools, withClient, type SearchDatabaseConnection } from "./database.js";
import { createConsumer, type ProjectionTelemetry } from "./consumer.js";
import { createOpenSearch } from "./opensearch.js";
import { createSearchReadPort } from "./read-port.js";
import { createSearchReadPortV2 } from "./read-port-v2.js";
import { createSearchKeywordReadPort } from "./read-port-v3.js";
import { assertStoredProfileRows, profileFingerprint, PROFILE, ProjectionRejected, type ProjectionV2Options, type Publication } from "./model.js";

export function createSearchPrototype(options: {
  readonly postgres: SearchDatabaseConnection;
  readonly opensearch: { readonly port: number };
  readonly telemetry?: ProjectionTelemetry;
  readonly targetMappingVersion?: 1 | 2;
  readonly projectionV2?: ProjectionV2Options;
}) {
  const targetMappingVersion = options.targetMappingVersion ?? 1;
  if ((targetMappingVersion === 1) !== (options.projectionV2 === undefined)) throw new ProjectionRejected();
  const search = createOpenSearch(options.opensearch);
  const pools = searchPools(options.postgres, () => options.telemetry?.emit({ name: "database_unavailable" }));
  const consumer = createConsumer(pools.worker, search, options.telemetry, { targetMappingVersion, projectionV2: options.projectionV2 });
  const loadPublication = (signal: AbortSignal) => withClient(pools.api, signal, async (client) => {
    const result = await client.query<{ publication: Publication | null }>("SELECT aw_search.publication() AS publication");
    return result.rows[0]?.publication ?? null;
  });
  const readPort = createSearchReadPort({ search, loadPublication });
  const readPortV2 = options.projectionV2 === undefined ? undefined
    : createSearchReadPortV2({ search, loadPublication, catalog: options.projectionV2.catalog });
  const keywordReadPort = options.projectionV2 === undefined ? undefined
    : createSearchKeywordReadPort({ search, loadPublication, catalog: options.projectionV2.catalog });
  async function assertProfile(): Promise<void> {
    if (options.projectionV2 === undefined) return;
    const expected = profileFingerprint(options.projectionV2);
    await withClient(pools.worker, AbortSignal.timeout(10_000), async (client) => {
      const rows = await client.query<{ mapping_version: number; metadata: unknown }>(
        "SELECT mapping_version,metadata FROM aw_search.batch ORDER BY created_at,batch_id LIMIT 10001");
      if (rows.rows.length > 10_000) throw new ProjectionRejected("projection_limit");
      for (const row of rows.rows) {
        const metadata = row.metadata as { schemaVersion?: unknown; profileFingerprint?: unknown } | null;
        if (row.mapping_version !== 2 || metadata?.schemaVersion !== 2 || metadata.profileFingerprint !== expected) {
          throw new ProjectionRejected("projection_invalid");
        }
      }
      const runs = await client.query<{ run_id: string; checkpoint: unknown }>(
        `SELECT run_id,checkpoint FROM aw_connector.runs WHERE source_id=$1 AND scope_id=$2
         ORDER BY lease_fence,run_id LIMIT 10001`, [PROFILE.sourceId, PROFILE.scopeId]);
      const rawPages = await client.query<{ run_id: string; snapshot_id: string; sha256: string; pending: unknown }>(
        `SELECT p.run_id,p.snapshot_id,p.sha256,p.pending FROM aw_connector.raw_pages p
         JOIN aw_connector.runs r USING(source_id,run_id) WHERE p.source_id=$1 AND r.scope_id=$2
         ORDER BY p.run_id,p.snapshot_id LIMIT 10001`, [PROFILE.sourceId, PROFILE.scopeId]);
      if (runs.rows.length > 10_000 || rawPages.rows.length > 10_000) throw new ProjectionRejected("projection_limit");
      assertStoredProfileRows(options.projectionV2!, runs.rows, rawPages.rows);
    });
  }
  return { ...consumer, readPort, ...(readPortV2 === undefined ? {} : { readPortV2, keywordReadPort }), assertProfile,
    close: async () => { await Promise.all([pools.worker.end(), pools.api.end()]); } };
}

export type { ConsumerOutcome, ProjectionTelemetry } from "./consumer.js";
export type { DescriptionProfileDescriptor, ProjectionV2Options, VerifiedDescriptionProjectionInput, VerifiedDescriptionVersion } from "./model.js";
export { profileFingerprint } from "./model.js";
