# TASK-0006 — First labeled-synthetic vertical-slice plan

Status: DONE on accepted `main` through PR #146, merge `198503cbccd94cdda90c4f4e431a05bc905851a1`; final-head CI `37757981081` and main CI `37758308509` pass. Downstream tasks still require their own dependencies and DoR.
Priority: P0
Owner role: Product/architecture planner, with data-rights, UX and operations review

## Goal
Produce an implementation-ready P1 plan for one labeled-synthetic, network-free source from acquisition through a premium mobile-first web result, without inventing rights or capabilities. This task delivers a plan, not the slice or a supported data stack.

Reviewed plan and task graph: [synthetic first slice](../plans/TASK-0006-synthetic-first-slice.md), with [design contract](../../DESIGN.md) and [validation evidence](../../docs/validation/TASK-0006.md). No downstream task is READY until this plan is accepted on `main` and its own dependencies pass.

## Dependencies
- TASK-0004 merged on `main`; TASK-0001 through TASK-0003 are its accepted prerequisites.
- [ADR-0012](../../docs/decisions/ADR-0012-synthetic-development-lane.md) limits this dependency change to synthetic planning. TASK-0005 remains mandatory before supported four-service integration.

## Relevant contracts
- `ROADMAP.md` P1 and quality gates
- `docs/PRODUCT_UX.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/data/DATA_PLATFORM.md`
- `docs/security/SECURITY_LEGAL.md`
- `docs/DEFINITION_OF_DONE.md`
- `docs/decisions/ADR-0012-synthetic-development-lane.md`
- `roadmap/tasks/TASK-0003-source-registry-contract.md` and `roadmap/tasks/TASK-0004-connector-sdk-contract.md`
- `docs/decisions/ADR-0002-source-registry-contract.md`, `docs/decisions/ADR-0003-connector-sdk-contract.md` and `docs/decisions/ADR-0003-connector-sdk-api.md`
- `roadmap/tasks/TASK-0005-local-data-infra.md` and `docs/decisions/ADR-0007-private-image-admission.md` for the blocked integration boundary

## Scope
- Select a labeled, deterministic synthetic adapter with no external network, seller media, production/external credentials or real-source rights. Use the unchanged Connector SDK authority port with an authenticated, enabled test-only Source Registry fixture inside an isolated dev/test composition; that fixture is not an authorized production record.
- Record real-source evaluation as a later, separately blocked planning/activation gate requiring documented rights and credentials.
- Map the target source -> connector -> immutable raw -> validation -> normalization -> observations -> unresolved Listing -> PostgreSQL -> index -> API -> responsive web architecture. A later identity-resolver task may associate a VehicleEntity; the synthetic path stops at listing evidence and uses injected in-memory store/search ports.
- Distinguish the synthetic in-memory store/search-port proof from the target PostgreSQL/index architecture; do not claim that a port fixture proves real persistence, indexing, migrations, performance or recovery.
- Define exact contracts, service ownership, migrations, events/outbox, idempotency, reconciliation and rollback checkpoints.
- Define a thin user flow from search intent to results and synthetic listing detail with progressive disclosure; a resolved vehicle detail page requires a later identity contract.
- Include accountless/local favorites and visible observation history in the P1 flow; account synchronization remains P2.
- Specify mobile and desktop layouts plus skeleton, empty, error, offline, slow, partial and success states.
- Set accessibility checks, analytics events, privacy handling and measurable performance budgets, including search p95 below 500 ms outside generation.
- Define telemetry, source-health alerts, data-quality metrics and incident/takedown path.
- Split implementation into dependency-ordered, focused P1 task/PR contracts with named owners and evidence gates.
- Split synthetic contract/API/UI tasks from supported four-service integration tasks. The latter depend on TASK-0005 Done on `main`; no P1 implementation task becomes READY merely because this plan is READY.

## Out of scope
- Implementing the slice, running Docker/Compose or any real data service, activating a source, multi-source dedup, AI ranking, pricing, Trust Score, accounts or native mobile apps.

## Acceptance criteria
- The adapter and every fixture are visibly synthetic, versioned, deterministic and network-free; a fixture's legal status cannot authorize a production source.
- Every critical canonical field traces to an observation and raw SHA-256 reference; contradictions and removals remain historical evidence.
- No service invents canonical fields, rights semantics, retry/deletion behavior or identity resolution.
- User-flow states, accessibility criteria, visual review viewports and performance budgets are testable.
- P1 task contracts and E2E criteria cover save/remove/reopen favorites, local persistence, empty favorites and traceable observation-history display.
- Implementation tasks form an acyclic sequence and each satisfies DoR before P1 execution.
- Product synthetic tasks cannot import image-admission or real storage authority; real four-service tasks explicitly depend on TASK-0005 and its unmodified acceptance gates.
- The plan includes a negative composition/contract test proving the test-only authority fixture cannot load in production or authorize an external source.
- Define fixture authentication as an SDK test-contract proof, never operator or legal-evidence authentication; specify production import/build exclusion and no-network-egress checks for the synthetic composition.
- Security, operational, migration/rollback and feature-flag decisions have owners and verification methods.

## Test strategy
- Conduct contract trace review with one valid, one malformed, one contradictory and one withdrawn synthetic listing.
- Check that any demo UI clearly labels the data as synthetic and cannot display inferred VIN/history/pricing/trust as verified fact.
- Walk failure scenarios for source outage/revocation, partial ingestion, stale index, API error, offline UI and rollback.
- Verify task graph, Markdown links, rights evidence and measurable P1 exit criteria through independent reviews.

## DoD gates
- Architecture, data-rights, UX/accessibility, security and SRE reviewers approve the plan with no unresolved high-severity finding.
- Link review/evidence in `docs/validation/TASK-0006.md`; set `DONE` on the same branch after green docs CI, rerun CI, then merge.
