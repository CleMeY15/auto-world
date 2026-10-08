# TASK-0105 — Supported OpenSearch projection and API read adapter

Status: BLOCKED until TASK-0104 is Done on `main`. Priority: P1. Owner: Search/API executor; independent architecture, security and data review.

## Goal and dependencies

Build a rebuildable eventually-consistent OpenSearch projection from committed PostgreSQL outbox events, then replace only the API `DemoReadPort` adapter without changing the versioned public DTO. Depends on TASK-0005 accepted exact images, TASK-0102 API contract and TASK-0104 durable store on `main`. No real source is activated.

## Relevant contracts and scope

[P1 plan](../plans/TASK-0006-synthetic-first-slice.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [SDK API](../../docs/decisions/ADR-0003-connector-sdk-api.md), [ADR-0007](../../docs/decisions/ADR-0007-private-image-admission.md), [data platform](../../docs/data/DATA_PLATFORM.md), [security](../../docs/security/SECURITY_LEGAL.md), [DoD](../../docs/DEFINITION_OF_DONE.md), `packages/demo-search-contract` DTO/read port. PostgreSQL remains authoritative; index documents are derived and disposable. Redis is not required for this read path and cannot become authority. No raw bytes, internal VIN, policy references or seller PII enter the index or public DTO.

## Acceptance and test strategy

- Version index mappings and consumer checkpoint; idempotent outbox consumption handles duplicates, reordering and restart. Backfill/rebuild from PostgreSQL and reconciliation detect/fix stale, missing or withdrawn index documents without rewriting canonical history. Use at most five bounded backoff attempts per outbox event; quarantine exhausted/poison events with immutable diagnostic evidence, halt before advancing the checkpoint, and require operator-reviewed replay. Test poison, restart, replay and no silent skip.
- Search filters/sort/cursor match the frozen DTO/query tests. Return the same `DemoSearchResponseV1` `dataAsOf`/`complete|partial|stale` semantics; stale-index and partial-result responses are explicit, with no false complete count. Search p95 <500 ms under stated representative load. In the bounded fixture profile, healthy committed-to-queryable index lag is ≤60 seconds; >60 seconds for five continuous minutes raises a warning test alert, and quarantine/checkpoint halt raises an immediate critical test alert. Measure sample count and lag distribution separately; these are not production SLO claims.
- Exact admitted OpenSearch/PostgreSQL image/currentness checks, targeted integration/rebuild/failure tests, sanitized metrics/traces, root quality/security gates, exact-head/merged-main CI and independent reviews pass. Document deployment stop/rollback and evidence in `docs/validation/TASK-0105.md`.
- This does not establish four-service application acceptance, backup/restore of all data, source rights or production activation; TASK-0106 owns the combined operational gate.
