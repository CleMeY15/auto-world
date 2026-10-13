# TASK-0010 — Fiscal-rule versioning readiness

Status: REVIEWED — readiness documentation only; exact final-head/main acceptance remains pending and will be recorded in the task's PR delivery comment. Executable fiscal versioning remains unimplemented.
Priority: P0
Owner: product/domain writer; independent architecture, code/provenance and delivery reviewers

## Goal, scope and dependencies

Make the roadmap's fiscal-versioning work ready to be specified from an actual consumer and official evidence, without inventing a calculator or a reusable rule schema. This task delivers [ADR-0019](../../docs/decisions/ADR-0019-fiscal-rule-versioning-readiness.md), this task, the ADR index, and bounded EPIC/DELIVERY updates only.

Dependencies: accepted TASK-0001 documentation/quality workflow and the existing ROADMAP/Vehicle Intelligence requirements. TASK-0009 is the previous delivered checkpoint, not a technical fiscal prerequisite. TASK-0005 remains separately owned and incomplete; this documentation does not unblock TASK-0104 or any supported integration.

## Definition of Ready

Read `AGENTS.md`, `ROADMAP.md`, [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [data platform](../../docs/data/DATA_PLATFORM.md), [security/legal](../../docs/security/SECURITY_LEGAL.md) and [DoD](../../docs/DEFINITION_OF_DONE.md). Goal, five-file scope, dependencies, owner, acceptance and validation strategy are defined here. UI flow/states are not applicable: no user-facing change.

## Acceptance criteria

- ADR-0019 gives each future readiness requirement a responsible role and inspectable evidence: named consumer, official sources, interpretation/currentness, applicability event and time granularity, identity/amendments, unknown cases, input provenance, audit, explanation and rollback.
- The future executable task remains NOT_READY until those requirements are resolved in its own DoR/ADR and tests. Neither a URL nor a structurally valid record proves legal authority or applicability.
- No rates, tax formulas, actual legal interpretation, executable API/schema, package, dependency, migration, runtime or UI change is introduced. No date-only or jurisdiction-specific implementation choice is frozen prematurely.
- EPIC/DELIVERY reflect the exact accepted TASK-0009 delivery and distinguish this readiness checkpoint from fiscal implementation, the broader P0 phase and TASK-0005 acceptance.
- Relative links, changed-file scope and status checks pass. Existing lint, typecheck, tests, build, browser, secrets and dependency gates pass in normal repository CI; no artificial runtime test or RED failure is created for prose.
- Independent architecture and code/provenance reviews approve the diff. Exact final-head CI, identical reviewed merge tree and protected-main CI precede final acceptance, recorded in a durable PR delivery comment.

## Validation and completion meaning

Inspect only the five documentation files and their links; review the authority and readiness language against ADR-0019 and the roadmap. Run existing quality gates, preserving failures and distinguishing CI evidence from local checks. `DONE — readiness only` means these documents have passed delivery gates; it does not mean an estimate, fiscal engine, executable selector, official dataset or complete fiscal P0 has shipped.

## Operations, rollback and stop conditions

No service, credentials, source access, deployment or stored data changes. Rollback is a focused documentation revert. Stop and define a separate task if work requires fiscal facts, executable contracts or a user-facing estimate. Future persisted consumers need their own compatibility/migration and rollback plan. Do not weaken supported-infrastructure or real-source gates.
