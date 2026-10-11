export const DATA_AS_OF = "2026-09-06T12:00:00.000Z";
export const FRESH_AS_OF = "2026-09-06T12:01:00.000Z";
export const STALE_AS_OF = "2026-09-06T12:01:00.001Z";

export const PRICE_EVIDENCE_ID = `ev_${"a".repeat(64)}`;
export const MILEAGE_EVIDENCE_ID = `ev_${"b".repeat(64)}`;
export const CURSOR = `cur_${"c".repeat(64)}`;

export function demoQuery(overrides = {}) {
  return {
    schemaVersion: 1,
    sort: "listing_asc",
    ...overrides,
  };
}

export function demoResult(overrides = {}) {
  return {
    listingId: "lst_synthetic_publication",
    availability: "active",
    price: {
      status: "observed",
      value: { amountMinor: 1_234_500, currency: "EUR" },
      evidenceId: PRICE_EVIDENCE_ID,
    },
    mileage: {
      status: "observed",
      value: { amount: 42_000.5, unit: "km" },
      evidenceId: MILEAGE_EVIDENCE_ID,
    },
    evidence: [
      {
        evidenceId: PRICE_EVIDENCE_ID,
        field: "price",
        observedAt: "2026-09-06T11:58:00.000Z",
        confidenceBps: 0,
        value: { amountMinor: 1_234_500, currency: "EUR" },
      },
      {
        evidenceId: MILEAGE_EVIDENCE_ID,
        field: "mileage",
        observedAt: "2026-09-06T11:59:00.000Z",
        confidenceBps: 10_000,
        value: { amount: 42_000.5, unit: "km" },
      },
    ],
    ...overrides,
  };
}

export function completeResponse(overrides = {}) {
  return {
    schemaVersion: 1,
    dataMode: "synthetic",
    fixtureVersion: "synthetic-search-v1",
    dataAsOf: DATA_AS_OF,
    state: "complete",
    results: [demoResult()],
    totalCount: 1,
    ...overrides,
  };
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
