export const workspaceBoundary = {
  name: "@auto-world/vehicle-schema",
  kind: "package",
  status: "active",
} as const;

export {
  appendObservations,
  parseListing,
  parseObservation,
  parseObservationCollection,
  parseVehicleEntity,
} from "./parsers.js";

export type {
  AcquisitionMethod,
  Co2Standard,
  ConnectorRunId,
  Currency,
  IdentityEvidence,
  LegalStatus,
  Listing,
  ListingId,
  ListingIdentity,
  MileageUnit,
  Observation,
  ObservationCollection,
  ObservationId,
  ObservationSubject,
  PowerUnit,
  Provenance,
  RawReference,
  RawSnapshotId,
  SourceId,
  ValidationIssue,
  ValidationIssueCode,
  ValidationResult,
  VehicleEntity,
  VehicleEntityId,
} from "./types.js";
