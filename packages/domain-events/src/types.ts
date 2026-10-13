import type {
  ListingId,
  Observation,
  ObservationId,
} from "@auto-world/vehicle-schema";

declare const domainEventIdBrand: unique symbol;

export type DomainEventId = string & { readonly [domainEventIdBrand]: true };

export type DomainEventTypeV1 = "price.changed" | "mileage.changed";

interface ObservationChangeEventBaseV1 {
  readonly schemaVersion: 1;
  readonly eventId: DomainEventId;
  readonly listingId: ListingId;
  readonly previousObservationId: ObservationId;
  readonly currentObservationId: ObservationId;
  readonly observedAt: string;
  readonly occurredAt: string;
}

export type ObservationChangeEventV1 =
  | (ObservationChangeEventBaseV1 & { readonly type: "price.changed" })
  | (ObservationChangeEventBaseV1 & { readonly type: "mileage.changed" });

type PriceObservation = Extract<Observation, { readonly field: "price" }>;
type MileageObservation = Extract<Observation, { readonly field: "mileage" }>;

export type ObservationChangeEvidenceV1 =
  | {
      readonly event: Extract<ObservationChangeEventV1, { readonly type: "price.changed" }>;
      readonly previousObservation: PriceObservation;
      readonly currentObservation: PriceObservation;
    }
  | {
      readonly event: Extract<ObservationChangeEventV1, { readonly type: "mileage.changed" }>;
      readonly previousObservation: MileageObservation;
      readonly currentObservation: MileageObservation;
    };
