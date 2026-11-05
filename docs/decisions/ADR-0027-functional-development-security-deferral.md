# ADR-0027 — Defer security qualification during bounded functional development

Status: Accepted as a sequencing amendment after sequential independent Architecture CLEAR and distinct Critic OKAY review. Implementation review and a fresh Linux result remain required.
Date: 2026-11-05
Scope: TASK-0005 synthetic development/CI diagnostics only.

## Context

TASK-0005 already has an isolated four-service Compose lifecycle covering PostgreSQL, OpenSearch, Redis and S3-compatible storage. Its existing `pnpm infra:test` path uses fabricated fixtures and validates seventeen named phases, including migrations, transactional raw/outbox writes, restarts, dependency failures, cold backup, isolated restore and scoped cleanup.

Image and scanner qualification under [ADR-0026](ADR-0026-data-foundation-managed-tools.md) remains incomplete. The user explicitly chose to defer that security work temporarily so functional development can continue. The observed security findings, failed qualification attempts and private archive work remain valid evidence and must not be erased, waived or reclassified.

## Decision

Reuse the existing immutable-pinned Compose definition and the complete unchanged seventeen-phase synthetic integration workflow. This increment may add manual dispatch and an explicit diagnostic summary, but it must not remove a phase, assertion, timeout, failure propagation, artifact requirement or automatic pull-request/push trigger.

Until fresh exact-source Linux evidence is independently accepted:

- `functionalDevelopmentReadiness=PENDING`;
- `securityQualification=DEFERRED_BY_USER`;
- `imageAdmission=NOT_AUTHORIZED`;
- `supportedRuntime=NOT_AUTHORIZED`;
- activation and support-end dates remain null;
- TASK-0005 and TASK-0005A remain `IN_PROGRESS`.

A successful lifecycle step is insufficient by itself. Diagnostic functional verification requires the successful whole job, the original sanitized result artifact, all seventeen named phases and no failed terminal record. If those conditions pass on the exact source, the bounded result may become `functionalDevelopmentReadiness=VERIFIED_DIAGNOSTIC_ONLY`. It never implies security qualification, image admission or support.

This amendment preserves credentials outside Git and public evidence, loopback-only host ports, non-root service identities, resource and deadline limits, project ownership checks, raw `nocopy`, immutable raw digests, canonical/outbox transaction integrity, refusal of nonempty or foreign restore targets, and the independent sentinel check. Fixtures remain fabricated. No connector, real source data, production account, registry publication, private archive read or credential expansion is authorized.

No component, archive parser, runtime wrapper or dependency is added. Existing scanner and private-archive work remains untouched for later completion. The deferral must end before image admission, supported operation, production use or any real-source data use. No fixed end date is invented; resumption is governed by those gates.

## Operation and evidence

Run the existing workflow automatically on its declared pull-request/push paths. Manual `workflow_dispatch` becomes available once the workflow with that trigger is present on the default branch; this PR uses the existing pull-request trigger. The lifecycle command remains `pnpm infra:test`. Local execution of the same command is useful where Docker is available; when local Docker is absent, only fresh Linux CI can establish container behavior.

The runbook result must retain the original seventeen-phase artifact and the whole-job conclusion. Documentation reports functional and security state separately. A functional failure is repaired within the existing contract; a security finding remains deferred evidence and is not converted into a functional exception.

## Consequences

Functional defects in the existing data foundation can be found and corrected without waiting for scanner release or APK-material qualification. The resulting evidence is deliberately narrower than TASK-0005 acceptance. TASK-0006 and supported downstream work remain blocked until the original security, admission, support and Definition of Done gates are satisfied.

This sequencing amendment supplements [ADR-0004](ADR-0004-local-data-infrastructure.md) and [ADR-0026](ADR-0026-data-foundation-managed-tools.md). It does not modify their security policy, scanner findings, admission requirements or retained evidence.

## Rollback

Revert this workflow/documentation increment to remove the manual diagnostic convenience. Stop only resources owned by the development project and preserve pre-existing volumes, backups and evidence. The existing ephemeral integration suite may continue to clean only its own synthetic resources. Never prune global Docker resources or delete the prior scanner/private-archive work as rollback.
