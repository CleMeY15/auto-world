# TASK-0003 — Source Registry contract

Status: BLOCKED by TASK-0002  
Priority: P0  
Owner role: Data-governance executor, with legal/security reviewer

## Goal
Define the authoritative, fail-closed contract for source rights, acquisition policy, retention, redistribution, health and takedown handling before any connector is production-enabled.

## Dependencies
- TASK-0002 merged on `main`.

## Relevant contracts
- `docs/data/DATA_PLATFORM.md`
- `docs/security/SECURITY_LEGAL.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/DEFINITION_OF_DONE.md`
- TASK-0002 canonical IDs and provenance contract

## Scope
- Record an ADR for Source Registry ownership, state transitions and compatibility before consumers couple to it.
- Create a versioned internal contract with stable source ID, display metadata, territories and supported acquisition modes.
- Model legal status only as `official_api`, `licensed_partner`, `dealer_feed`, `permitted_crawl`, `restricted`, `blocked` or `unknown`.
- Permit production enablement only for the first four statuses and only when authorization basis, permitted fields, caching, retention, redistribution, media, PII and territorial rules are explicit.
- Represent credentials as secret references, never values.
- Define freshness/deletion model, rate/SLA metadata, incremental/full-sync capability, takedown contact/process and review timestamps.
- Define health inputs and deterministic status: last success, error/parse/stale ratios, latency, volume and circuit state.
- Preserve contract history and audit actor/time/reason for policy or enablement changes.

## Out of scope
- Choosing or activating a real source, crawling, credential provisioning, dashboards, connector transport and legal advice beyond recorded approvals.

## Acceptance criteria
- Unknown, incomplete, `restricted` and `blocked` records fail production-enable validation.
- No status can be inferred from public accessibility, a hostname or a fixture.
- Allowed state transitions are explicit; disabling, takedown and expiry fail closed and remain auditable.
- Retention, redistribution and deletion obligations are machine-readable and usable by TASK-0004.
- Health fields have units/windows and cannot silently authorize a source.
- Fixtures are synthetic and make no claim about any named source or licence.

## Test strategy
- Table-test every legal status and production-enable precondition, including missing/expired authorization.
- Test allowed/forbidden transitions, audit preservation, territory and acquisition-mode constraints.
- Test retention/redistribution/takedown fixtures and deterministic health derivation boundaries.
- Compile a contract consumer against TASK-0002 source/provenance IDs.

## DoD gates
- Targeted and root lint/typecheck/tests/build, secrets scan, dependency audit and clean-checkout verification pass.
- Security/privacy and legal-data review approve fail-closed behavior; observability and rollback/versioning notes are recorded.
- CI/review evidence is linked in `docs/validation/TASK-0003.md`; set `DONE` on the same branch only after green review/CI, rerun CI, then merge.
