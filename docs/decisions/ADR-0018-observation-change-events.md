# ADR-0018 — Observation-change events V1

Status: ACCEPTED; TASK-0009 implementation independently validated; final-head/main delivery record in PR #162 governs downstream acceptance
Date: 2026-10-12

## Context and decision

The remaining P0 event vocabulary needs an executable boundary, not a broker or a second authority for vehicle values. Add the private ESM package `@auto-world/domain-events`, depending only on the public root of `@auto-world/vehicle-schema`. V1 names exactly `price.changed` and `mileage.changed` and references two canonical observations. All fixtures are synthetic. No service, source, SDK, persistence or UI behavior changes.

Canonical evidence and business-event identities evolve separately. We rejected freezing the entire roadmap vocabulary (unresolved lifecycle/graph authority), a generic `observation.recorded` contract (does not define change), and adding events to vehicle-schema or the connector SDK (different responsibility/evolution boundary).

## Exact public contract

Export these functions, their readonly types, and the normal workspace boundary:

```ts
parseDomainEventId(input: unknown): ValidationResult<DomainEventId>
parseObservationChangeEvent(input: unknown): ValidationResult<ObservationChangeEventV1>
checkObservationChangeEvidence(
  event: unknown,
  previousObservation: unknown,
  currentObservation: unknown,
): ValidationResult<ObservationChangeEvidenceV1>
```

`DomainEventId` is a branded string: `evt_` followed by 1..64 ASCII characters, starting alphanumeric, then alphanumeric/underscore/hyphen. It is nominally distinct from canonical branded IDs. A plain string cannot be assigned to it; an event ID is assignable to string. SDK `OperationKey` is an unbranded string alias: prefix validation is not semantic-origin authentication, and a string used as an operation key that matches `evt_` syntax still parses. No SDK dependency or event-ID generator is introduced.

`DomainEventTypeV1` is exactly `"price.changed" | "mileage.changed"`. `ObservationChangeEventV1` is a discriminated union with exactly these required fields:

```ts
{
  schemaVersion: 1;
  eventId: DomainEventId;
  type: "price.changed" | "mileage.changed";
  listingId: ListingId;
  previousObservationId: ObservationId;
  currentObservationId: ObservationId;
  observedAt: string;
  occurredAt: string;
}
```

The observation IDs differ. Both times are calendar-valid UTC milliseconds, years 0001..9999, and `occurredAt >= observedAt`, without an ambient-clock dependency. `observedAt` is the supplied later observation's provenance time. `occurredAt` is the producer's declaration time, not a sequence number, commit time or delivery order. Previous/current are caller-declared pair endpoints, not adjacent historical entries or authoritative latest/currently committed state.

Only plain/null-prototype objects with enumerable data properties are accepted. Unknown, hidden, symbol or accessor keys, custom prototypes and throwing/revoked reflection fail closed without invoking getters or exposing input-derived keys, values or thrown messages. Rebuild and deeply freeze output. Reuse public ID/observation parsers and the public `ValidationResult`/issue vocabulary; never private schema helpers.

## Evidence consistency and failure order

Parse event, previous observation, then current observation. Rebase their parser errors under `$.event`, `$.previousObservation` and `$.currentObservation`; standalone parsers root paths at `$`. Preserve parser issue codes. Then fail fast in this exact order, using `invalid_value`:

1. Previous/current IDs equal their event references: corresponding `.observationId`.
2. Previous/current subjects are listings: `.subject`; listing IDs match: `.subject.listingId`.
3. Previous/current fields match the event: `.field`.
4. Both provenance source IDs match: `$.currentObservation.provenance.sourceId`.
5. Current provenance time is strictly later: `$.currentObservation.provenance.observedAt`.
6. Current provenance time equals event time: `$.event.observedAt`.
7. Exact field representations differ: `$.currentObservation.value`.

Price compares amountMinor and currency; mileage compares amount and unit. Currency-only/unit-only changes count as representation changes, not evidence of economic increase/decrease, physical progression/regression/equivalence or plausibility. Confidence/raw/provenance-only changes do not count. No conversion, delta or direction is computed.

Success has exactly `{event, previousObservation, currentObservation}`: a fresh frozen object containing parsed frozen records. `ObservationChangeEvidenceV1` is a correlated union of a price event plus two `Extract<Observation, {field: "price"}>` records, or a mileage event plus two mileage records. Mixed pairs are unassignable.

This checker proves only internal consistency of the supplied pair. It does not establish authenticated provenance, source rights, committed storage membership, adjacency, latest state, completeness or commit order. An unsupplied intermediate observation cannot be detected. No repository is queried.

## Versioning, replay and deferred authority

Only version 1 is accepted, with no generic event/payload fallback. Incompatible shapes or new names require a new ADR/version. Parsing is deterministic but stateless: separate valid inputs may reuse one eventId with changed content, and both parse. A future durable producer/consumer must bind eventId to an immutable semantic payload digest, collapse exact replay and reject changed reuse. That is a future store/outbox requirement, not implemented idempotency or exactly-once delivery.

Do not export listing.created/updated/withdrawn/deleted/removed/missing. ROADMAP's `listing.removed` remains an unresolved umbrella, not an alias for explicit withdrawal, deletion or inferred scoped absence. Vehicle matched/merged/split, history, trust, deal, saved-search and notification events also remain deferred. SDK mutation records, operation keys and telemetry remain separate and unchanged.

## Validation, operations and rollback

TASK-0009 requires meaningful assertion-level RED, runtime hostile-input and evidence-binding tests, compile-time brand/correlation/readonly tests, built-root consumer and workspace-boundary proof, all repository gates and independent architecture/code/provenance review. Final-head CI, identical reviewed merge tree and exact merged-main CI govern delivery. See [task](../../roadmap/tasks/TASK-0009-observation-change-events.md) and [validation](../validation/TASK-0009.md).

This pure, network-free library adds no runtime logger, telemetry, credentials, migration, deployment or source activation. Fixed validation codes/paths are its diagnostic surface; it must not log external payloads. Before consumers integrate V1, rollback is a reviewed revert of the package, workspace assertion, lockfile and documentation. Persisted consumers later require a versioned migration decision. TASK-0005 and the rest of the P0 event program remain incomplete.
