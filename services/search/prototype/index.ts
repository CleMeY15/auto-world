import "./guard.js";
import { searchPools, withClient, type SearchDatabaseConnection } from "./database.js";
import { createConsumer, type ProjectionTelemetry } from "./consumer.js";
import { createOpenSearch } from "./opensearch.js";
import { createSearchReadPort } from "./read-port.js";
import type { Publication } from "./model.js";

export function createSearchPrototype(options: {
  readonly postgres: SearchDatabaseConnection;
  readonly opensearch: { readonly port: number };
  readonly telemetry?: ProjectionTelemetry;
}) {
  const search = createOpenSearch(options.opensearch);
  const pools = searchPools(options.postgres, () => options.telemetry?.emit({ name: "database_unavailable" }));
  const consumer = createConsumer(pools.worker, search, options.telemetry);
  const readPort = createSearchReadPort({ search, loadPublication: (signal) => withClient(pools.api, signal, async (client) => {
    const result = await client.query<{ publication: Publication | null }>("SELECT aw_search.publication() AS publication");
    return result.rows[0]?.publication ?? null;
  }) });
  return { ...consumer, readPort, close: async () => { await Promise.all([pools.worker.end(), pools.api.end()]); } };
}

export type { ConsumerOutcome, ProjectionTelemetry } from "./consumer.js";
