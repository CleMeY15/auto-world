# ARCHITECTURE

## Bounded contexts
1. Source Acquisition
2. Vehicle Catalog
3. Listing/Offer
4. Search
5. Identity Resolution
6. Market Intelligence
7. User/Personalization
8. Notifications
9. Import Cost
10. Dealer Platform
11. Billing
12. Analytics

## Core flow
Source -> Connector -> Raw Event Store -> Validator -> Canonical Mapper -> Entity Resolver -> PostgreSQL -> Search Index -> API -> Clients.
Every mutation emits domain event through outbox pattern.

## Key IDs
source_id; source_listing_id; listing_id; vehicle_entity_id; seller_id; connector_run_id; price_observation_id. Never use URL as sole identity.

## Events
source.listing.seen; listing.created; listing.updated; listing.withdrawn; vehicle.merged; vehicle.split; price.changed; saved_search.matched; notification.requested; notification.delivered.

## Consistency
Postgres is source of truth for canonical entities; search index is eventually consistent; raw snapshots are immutable/replayable. Use idempotency on ingestion and notification consumers.

## API principles
Version external contracts. Cursor pagination. Typed errors. Request IDs. Rate limits. Search filters represented as a versioned canonical JSON object.

## Internal source-policy boundary

`packages/source-registry` owns source governance and depends only on the public `packages/vehicle-schema` contract for shared identity/result types. The dependency is one-way; vehicle data does not import governance. [ADR-0002](../decisions/ADR-0002-source-registry-contract.md) defines V1 immutable policy revisions, contextual grants, structural eligibility and independent health. A future authoritative-registry port must supply authenticated current state before any connector acts; this pure package does not establish that trust boundary itself.
