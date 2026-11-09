# TASK-0121 — Retirer un critère de recherche appliqué

Status: LOCAL_TARGET_VALIDATED / DELIVERY_PENDING, 2026-11-09. Priority P1. Owner: application lead, bounded application executor and independent test/review lanes. Branch `codex/task-0121-refine-search`. DoR satisfied; sequential Architect APPROVE then Critic APPROVE before implementation. Root quality,136 web units,44 focused browser cases and independent source/pixel reviews pass; full browser and real persistent CI plus protected-main acceptance remain required.

## Goal, dependencies and contracts

From synthetic results, remove one applied criterion, preserve the others and explicitly search again using the existing form. TASK-0120 is DONE_FOR_V1_PROTOTYPE on main `37a6e5ea90a8469491b295b97a41a4a671b587a7`, [PR231 accepted checkpoint](https://github.com/CleMeY15/auto-world/pull/231#issuecomment-6736705415). Historical preacceptance documents remain preserved. TASK-0005 qualification is owned separately, not part of this increment.

Contracts: AGENTS, ROADMAP, DESIGN, PRODUCT_UX, DEFINITION_OF_DONE, architecture, DATA_PLATFORM, STRATEGIC_MOATS, VEHICLE_INTELLIGENCE, ADR-0012/0028/0033; existing V2/V3 canonical parsing, saved-search binding and exact input conversion. No backend, schema, data source, dependency or identity inference changes.

## Scope and acceptance

- Present applied criteria expose labelled remove actions. Source is acceptedCriteria.query, never unsubmitted draft or a paged cursor. Preserve sort and all other exact values. Removing make explicitly removes its dependent model; removing model keeps make; removing words returns blank/V2 on submission.
- Prepare the existing editable form without fetching. Explain that Rechercher applies the change. Retain accepted response/pagination/save/share authority until explicit submit, which starts a fresh first page.
- One transient Annuler l’ajustement restores the prior raw draft and returns to unchanged results without fetching. Form edit, reset, submit, restore, route departure or changed accepted/response/catalog authority invalidates it. Never restore obsolete raw make/model IDs.
- Presentation-only advanced disclosure and appearance changes retain cancellation so users can inspect the prepared fields; cancellation restores the original draft and disclosure state.
- Block stale/busy actions; refuse remaining identity without matching current catalogue. Explicit make removal can clear identity. Preserve empty/offline/slow/error/stale/partial states and existing saved/shared behavior.
- Reuse shared UI/tokens, readable wrapping controls,44px targets, keyboard/focus/live feedback, mobile/desktop, light/dark/enlarged text and existing performance budgets. No additional panel or framework.
- Existing closed search_submitted/results_shown events remain commit telemetry; no query/identity values or new collector. Synthetic provenance stays visible.

## Tests and delivery

Pure helper unit tests: all six fields, absent/unknown/hostile/cursor inputs, immutable source, identity cascade/binding mismatch, exact numeric roundtrip and V2/V3. Both-browser journeys: accepted-vs-draft, zero request on removal/undo, explicit query/cursor reset, cancellation and invalidation, busy/catalog/empty/offline, saved/shared authority. Actual screenshots at320/390/768/1440 and200% light/dark/alternate font, axe and existing performance checks.

Run lint, typecheck, unit/integration tests, build, browser suite, secrets/dependency checks. Independent code and architecture review required. [Validation](../../docs/validation/TASK-0121.md) distinguishes local checks from exact-source PR and protected-main acceptance. Do not begin the next task before delivery.

## Operations / rollback

UI-only, existing synthetic flags and routes. No migration or persistent storage mutation from refinement; rollback this code without deleting browser data. No preview port takeover. No production readiness, real data or TASK-0005 admission implied.
