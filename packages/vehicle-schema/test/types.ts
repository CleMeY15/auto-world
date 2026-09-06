import type {
  ConnectorRunId,
  Listing,
  ListingId,
  Observation,
  ObservationId,
  RawSnapshotId,
  SourceId,
  VehicleEntity,
  VehicleEntityId,
} from "../src/index.js";

import { parseConnectorRunId, parseListingId, parseObservationId, parseRawSnapshotId, parseSourceId } from "../src/index.js";

const parsedListing = parseListingId("lst_synthetic");
const parsedObservation = parseObservationId("obs_synthetic");
const parsedRun = parseConnectorRunId("run_synthetic");
const parsedRaw = parseRawSnapshotId("raw_synthetic");
if (parsedListing.success && parsedObservation.success && parsedRun.success && parsedRaw.success) {
  const accepted: readonly [ListingId, ObservationId, ConnectorRunId, RawSnapshotId] = [
    parsedListing.data, parsedObservation.data, parsedRun.data, parsedRaw.data,
  ];
  // @ts-expect-error a raw snapshot ID is not a connector run ID
  const crossedRun: ConnectorRunId = parsedRaw.data;
  // @ts-expect-error a run ID is not a raw snapshot ID
  const crossedRaw: RawSnapshotId = parsedRun.data;
  // @ts-expect-error an observation ID is not a listing ID
  const crossedListing: ListingId = parsedObservation.data;
  // @ts-expect-error a listing ID is not an observation ID
  const crossedObservation: ObservationId = parsedListing.data;
  void accepted;
  void crossedRun;
  void crossedRaw;
  void crossedListing;
  void crossedObservation;
}

const parsedSource = parseSourceId("src_synthetic");
if (parsedSource.success) {
  const acceptedSource: SourceId = parsedSource.data;
  // @ts-expect-error source parser cannot produce a listing ID
  const wrongDomain: ListingId = parsedSource.data;
  void acceptedSource;
  void wrongDomain;
}

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
