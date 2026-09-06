import type {
  Listing,
  ListingId,
  Observation,
  ObservationId,
  SourceId,
  VehicleEntity,
  VehicleEntityId,
} from "../src/index.js";

declare const vehicleId: VehicleEntityId;
declare const listingId: ListingId;
declare const observationId: ObservationId;
declare const sourceId: SourceId;

const vehicle: VehicleEntity = {
  schemaVersion: 1,
  vehicleId,
  identityStatus: "candidate",
  observationIds: [observationId],
};

// @ts-expect-error listing IDs cannot cross the vehicle ID domain
const crossedVehicleId: VehicleEntityId = listingId;

// @ts-expect-error readonly domain objects cannot be mutated
vehicle.observationIds.push(observationId);

const listing: Listing = {
  schemaVersion: 1,
  listingId,
  sourceId,
  sourceListingId: "synthetic-listing",
  identity: { status: "candidate", vehicleId },
  observationIds: [observationId],
};

// @ts-expect-error source and listing IDs are nominally distinct
const crossedSourceId: SourceId = listingId;

const mileage: Observation = {
  schemaVersion: 1,
  observationId,
  subject: { kind: "vehicle", vehicleId },
  field: "mileage",
  value: { amount: 10, unit: "km" },
  provenance: {
    sourceId,
    observedAt: "2026-09-06T12:34:56.789Z",
    acquisitionMethod: "manual",
    legalStatus: "unknown",
    confidenceBps: 0,
    raw: {
      snapshotId: "raw_synthetic" as never,
      connectorRunId: "run_synthetic" as never,
      sha256: "a".repeat(64),
    },
  },
};

// @ts-expect-error mileage cannot use a power unit
const invalidMileage: Observation = { ...mileage, value: { amount: 10, unit: "kw" } };

// @ts-expect-error a listing subject cannot carry a vehicle ID
const invalidSubject: Observation = { ...mileage, subject: { kind: "listing", vehicleId } };

void invalidMileage;
void invalidSubject;
void crossedVehicleId;
void crossedSourceId;
void listing;
