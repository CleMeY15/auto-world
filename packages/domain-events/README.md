# `@auto-world/domain-events`

Strict V1 vocabulary for canonical listing-observation changes.

## Public surface

- `parseDomainEventId` validates opaque `evt_` identifiers.
- `parseObservationChangeEvent` validates exact `price.changed` and `mileage.changed` envelopes.
- `checkObservationChangeEvidence` checks one event against a caller-supplied earlier/later observation pair.

The checker verifies internal consistency only. It does not query a repository or prove that observations are adjacent, committed, latest, authentic, authorized or complete. Currency-only and mileage-unit-only differences are representational changes; no direction, conversion, delta or plausibility is inferred.

The parsers are stateless. Reusing an event ID with changed content can parse in separate calls. A future durable producer or consumer must bind the event ID to an immutable semantic payload digest and reject changed reuse.

## Deliberate exclusions

This package has no event emitter, ID generator, store, outbox, broker, SDK operation key, delivery ordering or exactly-once API. Listing lifecycle, vehicle graph, history, trust, deal, saved-search and notification events remain undefined here.

Inputs are untrusted. Successful values are rebuilt and frozen; failures contain only fixed issue codes and schema-owned paths.
