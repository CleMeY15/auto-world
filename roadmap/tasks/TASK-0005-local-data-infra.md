# TASK-0005 — Local data infrastructure

Status: IN_PROGRESS; corrected-scanner diagnostics VERIFIED; image eligibility and private admission BLOCKED
Priority: P0
Owner role: Platform/SRE executor, with independent infrastructure review

## Goal
Provide reproducible development and CI data services for PostgreSQL, OpenSearch, Redis and S3-compatible raw storage with tested lifecycle and rollback behavior.

The separately consented [ADR-0006 diagnostic canary](../../docs/decisions/ADR-0006-public-attestation-canary.md) passed real public fixed-file verification on 2026-09-14 after exactly two runs. Its [evidence and producer retirement](../../docs/validation/TASK-0005-CANARY.md) are merged; the workflow is retired and removed and its 2/2 budget is exhausted. It cannot accept the data foundation, admit an image or unblock TASK-0006, and it must not be restarted. The full-roadmap heartbeat remains PAUSED while current user-directed development is ACTIVE.

[ADR-0007](../../docs/decisions/ADR-0007-private-image-admission.md) accepts the managed-tooling contract and [TASK-0005A](TASK-0005A-managed-image-tooling.md) for unprivileged corrected-scanner preparation. This contract-only increment introduces no image publication or admission capability; no new account, paid service or token expansion is authorized. Draft PRs #7, #8 and #10 remain unaccepted reference implementations. A future private-publication increment requires sequential Architect then Critic approval of its concrete workflow and package plan before any registry write.

The supporting scanner/evidence increment now has [complete real diagnostics](../../docs/validation/TASK-0005A-SCANNER.md): two matching builds, successful self/fixture/database controls and eight native image reports. Seven images still fail the strict vulnerability policy; no image is admitted. This does not accept PR7's lifecycle or unblock TASK-0006. The next private-publication step remains subject to ADR7's separate identity/topology, permission and review gates.

User update, 2026-09-14: "Zap le test d’accès" waives the external authenticated fork/PR denied-read probe that required a second GitHub account. The amended ADR-0007 records `SKIPPED_BY_USER`/`NOT_VERIFIED`, removes that account as a blocker and retains the existing-repository publication route and remaining integrity/vulnerability/access controls. No new publisher or credential is required solely for the skipped test, and no image or data lifecycle is accepted by the waiver.

## Dependencies
- TASK-0001 through TASK-0004 are accepted on `main`. TASK-0004 merged through PR #6 at `b9d22a2123ff53acded73eaf800a29dc8f2faf66`; verified current `main` `315396e63e4024bc716bcce3f4d7dab9d9f81261` contains that dependency.

## Relevant contracts
- `docs/architecture/ARCHITECTURE.md`
- `docs/data/DATA_PLATFORM.md`
- `docs/security/SECURITY_LEGAL.md`
- `docs/DEFINITION_OF_DONE.md`
- `docs/decisions/ADR-0007-private-image-admission.md`
- `roadmap/tasks/TASK-0005A-managed-image-tooling.md`
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
