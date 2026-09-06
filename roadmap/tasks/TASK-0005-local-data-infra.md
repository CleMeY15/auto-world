# TASK-0005 — Local data infrastructure

Status: READY; queued behind TASK-0002, TASK-0003 and TASK-0004 by the singular execution frontier
Priority: P0
Owner role: Platform/SRE executor, with independent infrastructure review

## Goal
Provide reproducible development and CI data services for PostgreSQL, OpenSearch, Redis and S3-compatible raw storage with tested lifecycle and rollback behavior.

## Dependencies
- TASK-0001 merged on `main`; execution order remains after TASK-0004 unless the roadmap is explicitly amended.

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
- Mark `BLOCKED` only if neither local nor CI runtime can supply real services; otherwise set `DONE` after green review/CI, rerun CI, then merge.
