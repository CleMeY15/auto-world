import type {
  ConnectorRunId,
  ListingId,
  Observation,
  ObservationId,
  RawSnapshotId,
  SourceId,
  VehicleEntityId,
} from "@auto-world/vehicle-schema";
import type {
  DomainEventId,
  ObservationChangeEventV1,
  ObservationChangeEvidenceV1,
} from "../src/index.js";

declare const eventId: DomainEventId;
declare const listingId: ListingId;
declare const observationId: ObservationId;
declare const sourceId: SourceId;
declare const vehicleId: VehicleEntityId;
declare const connectorRunId: ConnectorRunId;
declare const rawSnapshotId: RawSnapshotId;
declare const event: ObservationChangeEventV1;
declare const evidence: ObservationChangeEvidenceV1;
declare const observation: Observation;
declare const priceEvidence: Extract<
  ObservationChangeEvidenceV1,
  { readonly event: { readonly type: "price.changed" } }
>;
declare const priceEvent: Extract<ObservationChangeEventV1, { readonly type: "price.changed" }>;
declare const mileageObservation: Extract<Observation, { readonly field: "mileage" }>;

type IsAssignable<From, To> = From extends To ? true : false;
type AssertFalse<Value extends false> = Value;
type CanonicalIds =
  | ListingId
  | ObservationId
  | SourceId
  | VehicleEntityId
  | ConnectorRunId
  | RawSnapshotId;
type EventToCanonicalIsolation = AssertFalse<IsAssignable<DomainEventId, CanonicalIds>>;
type CanonicalToEventIsolation = AssertFalse<IsAssignable<CanonicalIds, DomainEventId>>;

const text: string = eventId;
void text;

// @ts-expect-error plain strings do not become event IDs without parsing
const badPlain: DomainEventId = "evt_unparsed";
// @ts-expect-error canonical ID domains are nominally distinct
const badListing: DomainEventId = listingId;
// @ts-expect-error canonical ID domains are nominally distinct
const badObservation: DomainEventId = observationId;
// @ts-expect-error canonical ID domains are nominally distinct
const badSource: DomainEventId = sourceId;
// @ts-expect-error canonical ID domains are nominally distinct
const badVehicle: DomainEventId = vehicleId;
// @ts-expect-error canonical ID domains are nominally distinct
const badConnectorRun: DomainEventId = connectorRunId;
// @ts-expect-error canonical ID domains are nominally distinct
const badRawSnapshot: DomainEventId = rawSnapshotId;
// @ts-expect-error event IDs are not listing IDs
const eventAsListing: ListingId = eventId;
// @ts-expect-error event IDs are not observation IDs
const eventAsObservation: ObservationId = eventId;
// @ts-expect-error event IDs are not source IDs
const eventAsSource: SourceId = eventId;
// @ts-expect-error event IDs are not vehicle IDs
const eventAsVehicle: VehicleEntityId = eventId;
// @ts-expect-error event IDs are not connector run IDs
const eventAsConnectorRun: ConnectorRunId = eventId;
// @ts-expect-error event IDs are not raw snapshot IDs
const eventAsRawSnapshot: RawSnapshotId = eventId;

if (event.type === "price.changed") {
  const exact: "price.changed" = event.type;
  void exact;
}

const previous: Extract<Observation, { field: "price" }> = priceEvidence.previousObservation;
const current: Extract<Observation, { field: "price" }> = priceEvidence.currentObservation;
void [previous, current];

// @ts-expect-error public event properties are readonly
event.observedAt = "2026-10-12T12:00:00.000Z";
// @ts-expect-error evidence members are readonly
evidence.currentObservation = observation;
// @ts-expect-error unsupported event discriminators are not representable
const wrongDiscriminator: ObservationChangeEventV1 = { ...priceEvent, type: "listing.removed" };
// @ts-expect-error price events cannot be paired with mileage observations
const mixedEvidence: ObservationChangeEvidenceV1 = {
  event: priceEvent,
  previousObservation: mileageObservation,
  currentObservation: mileageObservation,
};

type IsolationProofs = [EventToCanonicalIsolation, CanonicalToEventIsolation];
declare const isolationProofs: IsolationProofs;
void [
  badPlain,
  badListing,
  badObservation,
  badSource,
  badVehicle,
  badConnectorRun,
  badRawSnapshot,
  eventAsListing,
  eventAsObservation,
  eventAsSource,
  eventAsVehicle,
  eventAsConnectorRun,
  eventAsRawSnapshot,
  wrongDiscriminator,
  mixedEvidence,
  isolationProofs,
];
