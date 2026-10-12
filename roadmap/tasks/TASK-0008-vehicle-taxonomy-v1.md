# TASK-0008 — Synthetic vehicle taxonomy V1

Status: IN_PROGRESS
Priority: P0
Owner role: Domain/schema executor; independent architecture and code/security/provenance review

## Goal and dependencies

Provide immutable validated synthetic make/model reference releases and deterministic exact-ID lookup for later filters. Dependencies: TASK-0001/TASK-0002 accepted on main and the independent synthetic lane of ADR-0012. TASK-0005 is not a dependency for this pure network-free package.

DoR is satisfied by this scope, acceptance criteria, test strategy, owner and [ADR-0017](../../docs/decisions/ADR-0017-vehicle-taxonomy-v1.md). Read ROADMAP, STRATEGIC_MOATS, VEHICLE_INTELLIGENCE, architecture/ARCHITECTURE, data/DATA_PLATFORM, security/SECURITY_LEGAL and DEFINITION_OF_DONE. No user-facing flow or UI states are changed.

## Scope and acceptance

- Add private `@auto-world/vehicle-taxonomy`, public readonly V1 types, five distinct branded IDs, strict unknown-input parsers and typed exact-ID utilities.
- Enforce frozen detached parser output; closed fields; bounded ordered collections; unique IDs; model-parent and per-name synthetic-attribution integrity.
- Use release-local primary names and value-unique aliases. Preserve names repeated across different entities.
- Reject unsafe objects/arrays/reflection failures without invoking accessors or echoing untrusted input in errors.
- Version-scoped references reject mismatched declared tuples; matching tuples do not authenticate snapshot content or lineage.
- Provide test-only clearly synthetic four-make/eight-model/four-attribution corpus and compile-time/runtime regression coverage.
- Keep vehicle-schema, registry, SDK, API/UI and production behavior unchanged. No external dependency, service, container or real data.
- All targeted/root gates and independent reviews pass, followed by final-head CI, identical reviewed merge tree and successful main CI before downstream work.

## Test strategy and delivery

Record meaningful failing tests before completed parser behavior: missing parent, missing alias attribution, hostile objects, ownership isolation and absent-ID lookup. Cover every ADR lexical boundary, ordering/uniqueness, frozen nested output, repeated names, same-tuple altered-snapshot honesty and cross-brand compile-time isolation.

Run frozen installation; targeted lint/typecheck/test/build; root lint/typecheck/test/build and browser regression; secrets scan and dependency audit. Verify nonzero taxonomy tasks in all four Turbo graphs. Clean Linux CI supplies an independent checkout. Review code/security/provenance and architecture independently. Document security/rollback limits and exact evidence in [TASK-0008 validation](../../docs/validation/TASK-0008.md).

Initial implementation CI and review precede DONE status. Final-head CI and accepted merged-main evidence remain separate delivery gates. Do not begin a dependent task from compilation alone.
