# TASK-0104 — Supported PostgreSQL transactional store

Status: BLOCKED until TASK-0005 and TASK-0102 are Done on `main`; synthetic UI success never satisfies this gate. Priority: P1. Owner: Data/platform executor; independent architecture, security and migration review.

## Goal and dependencies

Implement the accepted SDK's fenced transactional `StorePort` on admitted PostgreSQL, preserving public contracts. Depends on TASK-0005A/TASK-0005 accepted exact-image four-service stack and TASK-0101/0102 contract tests on `main`. This task does **not** build an index, replace the API read port or activate a real source; those are separate tasks.

## Relevant contracts and scope

[P1 plan](../plans/TASK-0006-synthetic-first-slice.md), [ADR-0007](../../docs/decisions/ADR-0007-private-image-admission.md), [ADR-0012](../../docs/decisions/ADR-0012-synthetic-development-lane.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [SDK API](../../docs/decisions/ADR-0003-connector-sdk-api.md), [data platform](../../docs/data/DATA_PLATFORM.md), [security](../../docs/security/SECURITY_LEGAL.md), [DoD](../../docs/DEFINITION_OF_DONE.md). PostgreSQL owns raw **bytes and metadata**, pending checkpoint, fenced transactions, immutable observations/listing versions and mutation ledger/outbox in the **same atomic stage/commit boundary** required by ADR-0003. A focused storage ADR and versioned migrations are frozen before coupling. Object-store archival is out of scope; a future archive would have to consume committed outbox events asynchronously and never substitute for PostgreSQL transactionality. No fixture state is migrated automatically into production.

## Acceptance and test strategy

- Versioned backwards-compatible schema and migration apply/reapply/rollback pass without rewriting historical observations. Raw bytes/digest, checkpoint and ledger/outbox stage atomically under a fence; source-scoped full/explicit deletion preserves historical evidence. Exact replay/idempotency and retention expiry obey the SDK port contract.
- Exact admitted PostgreSQL image/currentness checks precede supported runs. Crash/partition, stale-fence, lost-acknowledgement and isolated backup/restore tests prove raw SHA and ledger consistency on real PostgreSQL. No stale diagnostic pin substitutes; S3 archival and OpenSearch are not part of this task's completion claim.
- Sanitized mutation events and migration/rollback runbook are recorded; failures stop the consumer without deleting data. Targeted migration/transaction/recovery tests, root quality/security gates, exact-head/merged-main CI and independent data/security/SRE reviews pass; evidence in `docs/validation/TASK-0104.md`.
- The only permitted input is a synthetic fixture through a separately gated test run. No real-source activation, OpenSearch success, service-wide recovery or production readiness is claimed by this task.
