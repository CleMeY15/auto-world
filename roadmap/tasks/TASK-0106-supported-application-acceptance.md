# TASK-0106 — Supported application recovery and operations acceptance

Status: BLOCKED until TASK-0105 is Done on `main`. Priority: P1. Owner: Platform/SRE executor; independent architecture, security, data and operations review.

## Goal and dependencies

Prove the application-level integration of accepted PostgreSQL store, OpenSearch projection and the exact TASK-0005 four-service runtime under realistic failures. Depends on TASK-0005, TASK-0104 and TASK-0105 accepted on `main`. This task is operational acceptance, not a shortcut around image admission or real-source rights.

## Relevant contracts and scope

[P1 plan](../plans/TASK-0006-synthetic-first-slice.md), [ADR-0007](../../docs/decisions/ADR-0007-private-image-admission.md), [ADR-0012](../../docs/decisions/ADR-0012-synthetic-development-lane.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [data platform](../../docs/data/DATA_PLATFORM.md), [security](../../docs/security/SECURITY_LEGAL.md), [DoD](../../docs/DEFINITION_OF_DONE.md). Use accepted exact image digests and supported broker/currentness checks. The synthetic corpus remains the only application input; no external source or production credential is introduced. S3-compatible storage and Redis are verified only for roles actually accepted by TASK-0005; no unused service is promoted to application authority.

## Acceptance and test strategy

- On exact admitted images, run end-to-end raw stage → canonical transaction/outbox → index → API, then restart, replay, failure isolation, backup and isolated restore without raw-hash or observation loss. Capture an isolated backup after the final committed synthetic write; record the committed watermark and backup timestamp, with backup age ≤5 minutes at restore start. Cover PostgreSQL raw bytes/metadata, checkpoints, listing/observation history, ledger and outbox. Relative to that watermark, the bounded fixture test targets RPO 0 and restore plus OpenSearch rebuild/reconciliation within 10 minutes. Measure and report elapsed time/failures; these numbers are not production RPO/RTO. Verify scoped reset and preserve failed receipts.
- Record source-health/data-quality dashboard inputs, bounded alerts for ingestion/index lag/failure, incident/takedown ownership and a tested stop/rollback runbook. No dashboard/alert is claimed deployed unless actually observed. Enforce appropriate rate limiting and edge protection before any external exposure.
- Recheck search p95 <500 ms outside generation under stated representative load and consistency lag bounds. Test S3/Redis failures as non-authoritative degradation where their application roles exist.
- Root lint/typecheck/tests/build, secrets/dependency audit, exact-head/merged-main CI and independent SRE/security/data review pass with evidence in `docs/validation/TASK-0106.md`. Even this acceptance does not authorize real-source activation; named rights, credentials, retention/PII/media and takedown gates require a separate task.
