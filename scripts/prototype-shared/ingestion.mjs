if (process.env.NODE_ENV === "production") {
  throw new Error("prototype_production_forbidden");
}

import { runConnector, systemScheduler } from "../../connectors/_sdk/dist/index.js";
import { registry, request, utf8 } from "../../connectors/_sdk/test-support/index.mjs";
import { SYNTHETIC_CORPUS_MANIFEST } from "../../connectors/synthetic/demo/index.mjs";

const noopTelemetry = Object.freeze({ emit() {} });

function authority(current) {
  return { async loadVerifiedCurrent(input) {
    const head = current.revisions.at(-1);
    return { trust: "authenticated_current", registry: current, authorityRevision: head.revision,
      verifiedAsOf: input.asOf, authorizationBasisRef: head.configuration.policy.authorization.basisRef };
  } };
}

function ports(ingestion, adapter, operationsOverrides, telemetry) {
  return {
    authority: authority(registry({ operations: operationsOverrides })), lease: ingestion.lease, store: ingestion.store, adapter,
    clock: { nowMs: () => Date.now() }, scheduler: systemScheduler, random: { next: () => 0 }, telemetry,
  };
}

export function generatedAdapter(count, offset = 0, outcome = "active") {
  const items = Array.from({ length: count }, (_, index) => {
    const ordinal = offset + index + 1;
    return outcome === "active" ? {
      sourceListingId: `publication-page-${String(ordinal).padStart(4, "0")}`,
      outcome,
      observations: [
        { field: "price", value: { amountMinor: 1_000_000 + ordinal, currency: "EUR" }, confidenceBps: 9_000 },
        { field: "mileage", value: { amount: 20_000 + ordinal, unit: "km" }, confidenceBps: 9_000 },
      ],
    } : { sourceListingId: `publication-page-${String(ordinal).padStart(4, "0")}`, outcome };
  });
  return {
    async fetchPage(input) {
      if (input.signal.aborted) return { success: false, failure: { kind: "cancelled" } };
      const start = input.pageOrdinal * 100;
      const page = items.slice(start, start + 100);
      if (page.length === 0) return { success: false, failure: { kind: "terminal" } };
      const complete = start + page.length === items.length;
      const bytes = utf8(JSON.stringify({ items: page }));
      return { success: true, page: { pageIdentity: `integration-${outcome}-${offset}-${count}-${input.pageOrdinal}`,
        bytes, nextCursor: `integration-${outcome}-${offset}-${count}-${input.pageOrdinal}`, complete } };
    },
    async mapPage(input) { return globalThis.structuredClone(input.decoded); },
  };
}

export async function ingest(ingestion, adapter, invocationKey, mode = "full", limitOverrides = {},
  operationsOverrides = {}, runtimeOptions = {}) {
  const source = SYNTHETIC_CORPUS_MANIFEST.source;
  return runConnector(request({
    sourceId: source.sourceId, territory: source.territory, acquisitionMethod: source.acquisitionMethod,
    audience: "internal", fields: ["source_listing_id", "price", "mileage"], mode, invocationKey,
    adapterVersion: `prototype-search-${invocationKey}`, mapperVersion: "synthetic-search-mapper-v1",
    limits: { maxPages: 20, maxItems: 2_000, maxPageBytes: 64 * 1024, maxJsonMembers: 2_000, ...limitOverrides },
  }), ports(ingestion, adapter, operationsOverrides, runtimeOptions.telemetry ?? noopTelemetry), runtimeOptions.signal);
}
