# Auto World delivery ledger

Status: ACTIVE — full roadmap P0 through P5 remains NOT DONE
Authority: `AGENTS.md`, `ROADMAP.md`, executable files under `roadmap/`, and applicable `docs/` contracts

## Outcome
Operate as a continuous development team that selects the single first READY task, completes it through review and CI, merges it, refreshes the roadmap state, then selects again until the roadmap outcome is delivered.

## Current checkpoint
- TASK-0001 is merged to `main` at `d479482`; issue #1 is closed.
- TASK-0002 through TASK-0006 are published as executable contracts by the current docs-only change.
- TASK-0002 is the singular execution frontier after this contract change is merged.
- TASK-0005 is dependency-ready but deliberately queued after TASK-0004 to preserve one ordered frontier.

## P0 sequence
1. Publish the five DoR-complete task contracts and reconcile EPIC-000 statuses.
2. TASK-0002: freeze ADR-0001, implement and merge the canonical Vehicle/Listing/Observation/provenance contract.
3. TASK-0003: implement and merge the fail-closed Source Registry contract.
4. TASK-0004: implement and merge the safe, replayable Connector SDK contract.
5. TASK-0005: implement and merge real local/CI data infrastructure; local Docker absence alone does not block CI proof.
6. TASK-0006: approve and merge the first authorized or synthetic-only P1 vertical-slice plan.
7. Expand remaining P0 into DoR-complete tasks for taxonomy v1, event vocabulary, threat model, UX/design foundation and fiscal-rule versioning.
8. Close EPIC-000 only when a connector can be built without invented schema, rights, retry/deletion or canonical-field semantics.

## Per-task team loop
1. Rebase a dedicated branch from verified `main`; confirm dependencies and DoR.
2. Read affected contracts and write/confirm ADRs before cross-service coupling.
3. Assign disjoint in-task lanes for implementation, adversarial tests and documentation when parallelism helps.
4. Implement the smallest complete change; keep real source activation behind proven rights and credentials.
5. Run targeted tests, lint, typecheck, build, security/dependency checks and applicable integration/E2E/visual gates.
6. Request independent review for data, auth, payments, infra, AI and major UX changes; resolve every high-severity finding.
7. Push a focused PR with plan, operational/security impact, rollback and evidence.
8. After implementation review and CI are green, add validation evidence and set task `DONE` on the same branch.
9. Rerun CI; merge only while the final head is green, then verify the merge SHA on `main`.
10. Reconcile roadmap/epic state and immediately select the next singular READY task.

## P1 through P5 gates
- P1 NOT DONE: prove one authorized or labeled-synthetic path through raw, canonical provenance, index, API, premium web UI, local favorites and observation history. Synthetic proof does not satisfy the authorized-source production exit gate.
- P2 NOT DONE: France/Germany/Korea MVP waits for authorized coverage and contracts for accounts, alerts, identity, specs, emissions and registration.
- P3 NOT DONE: pricing, Deal/Trust, import, compare and focused CV require golden datasets, explainability and confidence gates.
- P4 NOT DONE: Europe/Asia scale and dealer/B2B alpha require measured reliability, capacity, cost and partner rights.
- P5 NOT DONE: global platform and data products require mature Source Registry, i18n, units/currencies, taxes and privacy operations.

## Invariants
- `VehicleEntity` is distinct from `Listing`; observations and raw evidence are immutable and replayable.
- Every critical fact has field-level provenance; contradictory evidence is retained.
- Deterministic rules remain authoritative; an LLM never supplies unverified VIN, specs, emissions, fiscal, price or history facts.
- Production source statuses are limited to `official_api`, `licensed_partner`, `dealer_feed` and `permitted_crawl` with complete policy evidence.
- User-facing work is mobile-first, accessible, visually reviewed and measured against performance budgets.

## Stop and resume rules
- Stop a task on unmet dependencies, failed gates, unresolved high-severity review, unsafe migration/rollback or inaccurate evidence.
- Stop source activation on uncertain rights, unavailable credentials, prohibited access, dangerous quality or missing takedown controls.
- Continue synthetic, contract or documentation work only when it remains within the current READY task.
- Resume from the last verified merge on `main`; unmerged branch status never satisfies a dependency.

## Completion condition
The delivery loop ends only when the ROADMAP North Star is implemented through P5, every shipped task meets its applicable Definition of Done, all production data sources are authorized and observable, and the final roadmap state matches deployed evidence.
