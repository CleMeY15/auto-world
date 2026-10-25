const digest = "a".repeat(64);

export function syntheticObservation({
  observationId,
  field,
  value,
  observedAt,
  rawIndex,
} = {}) {
  return {
    schemaVersion: 1,
    observationId: observationId ?? "obs_price_previous",
    subject: { kind: "listing", listingId: "lst_synthetic_event" },
    field: field ?? "price",
    value: value ?? { amountMinor: 4_250_000, currency: "EUR" },
    provenance: {
      sourceId: "src_synthetic_event",
      observedAt: observedAt ?? "2026-10-12T10:00:00.000Z",
      acquisitionMethod: "feed",
      legalStatus: "dealer_feed",
      confidenceBps: 9000,
      raw: {
        snapshotId: `raw_synthetic_event_${rawIndex ?? 1}`,
        connectorRunId: `run_synthetic_event_${rawIndex ?? 1}`,
        sha256: digest,
      },
    },
  };
}

export function priceEvent(overrides = {}) {
  return {
    schemaVersion: 1,
    eventId: "evt_synthetic_price_change",
    type: "price.changed",
    listingId: "lst_synthetic_event",
    previousObservationId: "obs_price_previous",
    currentObservationId: "obs_price_current",
    observedAt: "2026-10-12T11:00:00.000Z",
    occurredAt: "2026-10-12T11:00:01.000Z",
    ...overrides,
  };
}

export const clone = (value) => JSON.parse(JSON.stringify(value));
