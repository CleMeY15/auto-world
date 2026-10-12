# TASK-0009 — Observation-change events V1

Status: IN_PROGRESS — DoR and sequential Architect CLEAR / Critic APPROVE accepted; implementation pending
Priority: P0
Owner: domain-contract executor; independent test, architecture, code/provenance and delivery reviewers
Dependencies: TASK-0001, TASK-0002 (accepted on main); ADR-0001 and ADR-0012

## Goal and scope

Deliver a small executable vocabulary for price and mileage changes, referencing canonical evidence without inventing persistence, source rights, lifecycle or delivery authority. Implement only private `@auto-world/domain-events`, its tests, workspace integration and documentation. TASK-0005 is not a dependency because there is no storage, broker, outbox, service, API or production integration. This does not complete the whole P0 event program or unblock TASK-0104.

## Relevant contracts and Definition of Ready

Read `AGENTS.md`, `ROADMAP.md`, architecture/data documents, `VEHICLE_INTELLIGENCE.md`, `STRATEGIC_MOATS.md`, `security/SECURITY_LEGAL.md`, `DEFINITION_OF_DONE.md`, ADR-0001/0003/0012 and [ADR-0018](../../docs/decisions/ADR-0018-observation-change-events.md). ADR-0018 freezes exact types, APIs, failure order and limits before code. Goal, scope, dependencies, owner, acceptance and test strategy are specified here. User flow/UI states are not applicable: no user-facing change.

## Acceptance criteria

- Closed version-1 price.changed/mileage.changed discriminated envelope, branded evt_ identity, canonical listing/observation references, exact UTC-millisecond timestamps and no copied authoritative values.
- Strict safe parsers reject unsupported fields/names/versions, accessors and hostile reflection with sanitized schema-owned errors; detached deeply frozen success values.
- Unknown-input evidence checker binds IDs, listing subjects, fields, same source, strictly increasing observation times, exact current event time and unequal representations in ADR-defined fail-fast order.
- Correlated readonly evidence union prevents mixed price/mileage pairs. Currency-only/unit-only changes are representation-only, with no directional/conversion/physical/economic claim.
- Tests distinguish structure, pair consistency and durable/authenticated authority, demonstrate stateless same-ID changed-content acceptance and inability to prove pair adjacency/latestness.
- Only public vehicle-schema dependency/exports; no external dependency, private import, SDK change, lifecycle fallback, source activation or service/UI behavior change.
- Meaningful RED, targeted lint/typecheck/test/build, nonzero Turbo graphs, forced full root/browser/secrets/audit gates and independent reviews pass.
- Documentation/evidence records all limits and rollback. Final-head CI, unchanged reviewed merge tree and exact main CI are required before downstream acceptance.

## Test strategy and implementation plan

1. Publish the approved ADR/task and focused draft PR before implementation.
2. Link a compiling export skeleton; capture real failing assertions for evidence mismatches, chronology, unchanged values, hostile objects and caller mutation.
3. Implement the smallest closed parser/checker; independently add adversarial and compile-time negative coverage.
4. Validate built package root and root dependency boundaries, then all repository gates. Review architecture and code/provenance independently.
5. Record implementation evidence, exact final-head and main delivery evidence; keep deferred event families and infrastructure acceptance explicit.

Fixtures are synthetic and network-free. Hostile tests include hidden/symbol/getter/custom-prototype/revoked-proxy inputs and secret sentinels; timestamp tests cover leap dates and bounds. Runtime tests assert every exact cross-record path and fail-fast order. Type tests cover readonly fields, event discriminants, correlated observations and nominal canonical-ID separation, without pretending SDK's string alias is branded.

## Operations and rollback

Fixed issue codes/paths provide diagnostics without payload logging. No runtime service, network, migration or deployment changes. Revert the focused package/integration/docs before consumers; later persisted consumers need a versioned migration. [Validation record](../../docs/validation/TASK-0009.md).
