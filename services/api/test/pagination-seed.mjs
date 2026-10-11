import { runConnector } from "@auto-world/connector-sdk";
import { SYNTHETIC_CORPUS_MANIFEST } from "@auto-world/synthetic-connector/demo";
import { request, utf8 } from "../../../connectors/_sdk/test-support/index.mjs";

export async function seedPublications(harness, count = 41, options = {}) {
  const offset = options.offset ?? 0;
  const mode = options.mode ?? "full";
  const items = Array.from({ length: count }, (_, index) => {
    const ordinal = offset + index + 1;
    return {
      sourceListingId: `publication-page-${String(ordinal).padStart(3, "0")}`,
      outcome: "active",
      observations: [
        { field: "price", value: { amountMinor: 1_000_000 + ordinal, currency: "EUR" }, confidenceBps: 9_000 },
        { field: "mileage", value: { amount: 20_000 + ordinal, unit: "km" }, confidenceBps: 9_000 },
      ],
    };
  });
  harness.ports.adapter = {
    async fetchPage(input) {
      if (input.signal.aborted) return { success: false, failure: { kind: "cancelled" } };
      const bytes = utf8(JSON.stringify({ items }));
      return { success: true, page: {
        pageIdentity: `pagination-${offset}-${count}`,
        bytes,
        nextCursor: `pagination-watermark-${offset}-${count}`,
        complete: true,
      } };
    },
    async mapPage(input) { return globalThis.structuredClone(input.decoded); },
  };
  const input = request({
    sourceId: SYNTHETIC_CORPUS_MANIFEST.source.sourceId,
    territory: SYNTHETIC_CORPUS_MANIFEST.source.territory,
    acquisitionMethod: SYNTHETIC_CORPUS_MANIFEST.source.acquisitionMethod,
    audience: "internal",
    fields: ["source_listing_id", "price", "mileage"],
    mode,
    invocationKey: `pagination-${mode}-${offset}-${count}`,
    adapterVersion: "synthetic-pagination-test-v1",
    mapperVersion: "synthetic-search-mapper-v1",
    limits: { maxItems: 100, maxPageBytes: 64 * 1024, maxJsonMembers: 1_000 },
  });
  return harness.time.drive(runConnector(input, harness.ports));
}
