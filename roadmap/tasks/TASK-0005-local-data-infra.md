# TASK-0005 — Local data infrastructure

Status: IN_PROGRESS; TASK-0001 through TASK-0004 accepted, draft PR #7 image audit fails
Priority: P0
Owner role: Platform/SRE executor, with independent infrastructure review

## Goal
Provide reproducible development and CI data services for PostgreSQL, OpenSearch, Redis and S3-compatible raw storage with tested lifecycle and rollback behavior.

## Dependencies
- TASK-0001 merged on `main`; execution order remains after TASK-0004 unless the roadmap is explicitly amended.

## Current split and blocker

Accepted main is `b9d22a2`. Existing draft PR #7 remains the service implementation, with quality/integration passing and image audit failing. [TASK-0005A](TASK-0005A-native-bootstrap.md) prepares source-locked native tooling and a capability-free dormant installation on a standalone branch; [TASK-0005B](TASK-0005B-owned-data-images.md) resumes owned corrected services only after actual 5A activation. [ADR-0005](../../docs/decisions/ADR-0005-native-image-chain-bootstrap.md) records the independently reviewed preparation scope and real GitHub protection/ruleset 403 blocker. This is an explicit within-task multi-PR sequence; no dependent task starts early. Preparation, dormant merge, plan approval or public keys do not complete TASK-0005A or parent TASK-0005.

## Relevant contracts
- `docs/architecture/ARCHITECTURE.md`
- `docs/data/DATA_PLATFORM.md`
- `docs/security/SECURITY_LEGAL.md`
- `docs/DEFINITION_OF_DONE.md`
- TASK-0002 through TASK-0004 storage, raw and connector contracts

## Scope
- Add version-pinned local orchestration and CI service containers for PostgreSQL, OpenSearch, Redis and S3-compatible storage.
- Supply non-secret development defaults through `.env.example`; keep credentials and generated data ignored.
- Add health and readiness checks that distinguish process start from usable service state.
- Add repeatable bootstrap/migration commands for canonical, raw-reference and outbox foundations required by current contracts.
- Configure durable local volumes, restart policies, resource bounds and deterministic service names/ports.
- Add backup/restore and rollback instructions for the first schema state.
- Expose structured service health suitable for later observability without claiming a production topology.

## Out of scope
- Production cloud resources, Terraform, source data, connector execution, search mappings beyond foundation needs and customer-facing features.

## Acceptance criteria
- A fresh supported runtime starts all services and reaches health/readiness within a documented bound.
- Restart preserves durable test data; explicit reset behavior is documented and isolated to project resources.
- Migrations apply twice safely, rollback where supported and reapply; outbox/raw references retain integrity.
- PostgreSQL is canonical source of truth; index/cache/object storage roles remain distinct.
- No committed secret, permissive production credential or host-wide destructive cleanup command exists.
- Local Docker absence is recorded as a local prerequisite, not a global blocker when GitHub Actions can run real containers.

## Test strategy
- Run CI integration tests against real service containers for readiness, writes/reads, persistence across restart and dependency failure.
- Test migration apply/idempotency/rollback/reapply plus raw object digest retrieval and outbox transaction behavior.
- Smoke test documented local commands when Docker is available; retain CI evidence when it is not.

## DoD gates
- Config lint/static checks, integration tests, migration checks, root quality gates, secrets scan and dependency/container audit pass.
- Operational notes cover resources, logs/health, backup/restore, failure isolation and rollback.
- Independent infra/security review and CI evidence are linked in `docs/validation/TASK-0005.md`.
- Local Docker absence alone is not a blocker while CI supplies real services. Image/audit/activation/review failures also block acceptance; record their exact evidence. Set `DONE` only after all acceptance gates pass, rerun final-head CI, merge and verify main.
