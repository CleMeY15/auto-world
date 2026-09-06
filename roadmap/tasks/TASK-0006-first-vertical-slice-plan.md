# TASK-0006 — First authorized vertical-slice plan

Status: BLOCKED by TASK-0004 and TASK-0005  
Priority: P0  
Owner role: Product/architecture planner, with data-rights, UX and operations review

## Goal
Produce an implementation-ready P1 plan for one authorized or synthetic source from acquisition through a premium mobile-first web result, without inventing rights or capabilities.

## Dependencies
- TASK-0004 and TASK-0005 merged on `main`.

## Relevant contracts
- `ROADMAP.md` P1 and quality gates
- `docs/PRODUCT_UX.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/data/DATA_PLATFORM.md`
- `docs/security/SECURITY_LEGAL.md`
- `docs/DEFINITION_OF_DONE.md`

## Scope
- Evaluate candidate sources only from documented Source Registry records; choose one with explicit authorized status and terms evidence.
- If no source is authorized or credentialed, select a labeled synthetic adapter and retain production activation as a blocked gate.
- Map source -> connector -> immutable raw -> validation -> normalization -> observations -> entity candidate -> PostgreSQL -> index -> API -> responsive web.
- Define exact contracts, service ownership, migrations, events/outbox, idempotency, reconciliation and rollback checkpoints.
- Define a thin user flow from search intent to results and vehicle detail with progressive disclosure.
- Specify mobile and desktop layouts plus skeleton, empty, error, offline, slow, partial and success states.
- Set accessibility checks, analytics events, privacy handling and measurable performance budgets, including search p95 below 500 ms outside generation.
- Define telemetry, source-health alerts, data-quality metrics and incident/takedown path.
- Split implementation into dependency-ordered, focused P1 task/PR contracts with named owners and evidence gates.

## Out of scope
- Implementing the slice, activating an unauthorized source, multi-source dedup, AI ranking, pricing, Trust Score, accounts or native mobile apps.

## Acceptance criteria
- The chosen source has linked authorization, redistribution/caching, retention, territory, PII/media and credential status; otherwise the plan is explicitly synthetic-only.
- Every critical canonical field traces to an observation and raw SHA-256 reference; contradictions and removals remain historical evidence.
- No service invents canonical fields, rights semantics, retry/deletion behavior or identity resolution.
- User-flow states, accessibility criteria, visual review viewports and performance budgets are testable.
- Implementation tasks form an acyclic sequence and each satisfies DoR before P1 execution.
- Security, operational, migration/rollback and feature-flag decisions have owners and verification methods.

## Test strategy
- Conduct contract trace review with one valid, one malformed, one contradictory and one withdrawn synthetic listing.
- Walk failure scenarios for source outage/revocation, partial ingestion, stale index, API error, offline UI and rollback.
- Verify task graph, Markdown links, rights evidence and measurable P1 exit criteria through independent reviews.

## DoD gates
- Architecture, data-rights, UX/accessibility, security and SRE reviewers approve the plan with no unresolved high-severity finding.
- Link review/evidence in `docs/validation/TASK-0006.md`; set `DONE` on the same branch after green docs CI, rerun CI, then merge.
