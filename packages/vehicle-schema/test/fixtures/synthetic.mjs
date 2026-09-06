export const SYNTHETIC_VIN = "SYNTHET1C12345678";
export const SYNTHETIC_DIGEST = "a".repeat(64);

export function syntheticProvenance(overrides = {}) {
  const { raw: rawOverrides = {}, ...provenanceOverrides } = overrides;
  return {
    sourceId: "src_synthetic",
    observedAt: "2026-09-06T12:34:56.789Z",
    acquisitionMethod: "feed",
    legalStatus: "dealer_feed",
    confidenceBps: 8750,
    raw: {
      snapshotId: "raw_synthetic_1",
      connectorRunId: "run_synthetic_1",
      sha256: SYNTHETIC_DIGEST,
      ...rawOverrides,
    },
    ...provenanceOverrides,
  };
}

export function syntheticVehicle(overrides = {}) {
  return {
    schemaVersion: 1,
    vehicleId: "veh_synthetic_1",
    identityStatus: "candidate",
    observationIds: ["obs_price_1"],
    ...overrides,
  };
}

export function syntheticListing(overrides = {}) {
  return {
    schemaVersion: 1,
    listingId: "lst_synthetic_1",
    sourceId: "src_synthetic",
    sourceListingId: "synthetic-publication-1",
    identity: { status: "candidate", vehicleId: "veh_synthetic_1" },
    observationIds: ["obs_price_1"],
    url: "https://inventory.example/vehicles/synthetic-publication-1",
    ...overrides,
  };
}

export function syntheticObservation(overrides = {}) {
  return {
    schemaVersion: 1,
    observationId: "obs_price_1",
    subject: { kind: "listing", listingId: "lst_synthetic_1" },
    field: "price",
    value: { amountMinor: 4_250_000, currency: "EUR" },
    provenance: syntheticProvenance(),
    ...overrides,
  };
}

export function cloneSynthetic(value) {
  return JSON.parse(JSON.stringify(value));
}
