# TASK-0120 — Recherche par mots dans le prototype

Status: IN_PROGRESS, 2026-11-09. Priority P1. Owner: application lead, separate backend/frontend executors, independent reviewers. Branch `codex/task-0120-keyword-search`. DoR satisfied; sequential Architect APPROVE and distinct Critic approval before implementation.

## Goal and dependencies

Make the existing search input useful for current authored synthetic make/model labels, combined with existing filters/sorts, through search → pagination → detail/back → save/restore → share/load. TASK-0119 is DONE_FOR_V1_PROTOTYPE on main `293a218c0750ee693ad1c426e91629816cfa238d`, [PR229 accepted checkpoint](https://github.com/CleMeY15/auto-world/pull/229#issuecomment-6730265143). Earlier preacceptance evidence remains historical. TASK-0005 is separate; no scanner or image qualification in this increment.

Contracts: [ADR-0033](../../docs/decisions/ADR-0033-keyword-search.md), [DESIGN](../../DESIGN.md), PRODUCT_UX, DEFINITION_OF_DONE, architecture/DATA_PLATFORM/Vehicle Intelligence and ADR-0013/0020/0028/0030/0032. No dependency, data source, image, inferred identity, new filter category or AI. Preserve raw/canonical/provenance and index mapping.

## Scope and acceptance

- One shared bounded Unicode normalization and exact whole-word AND matcher on primary make/model labels. Resolve catalog model IDs before authoritative count/sort/pagination in offline and persistent engines. No browser post-filter, alias inference, wildcard/fuzzy matching or historical-description carry-forward.
- Strict queryV3 and literal search route, HTTP wrapper3 containing unchanged resultV2. V1/V2 unchanged. Blank UI remains V2; nonempty valid text uses V3. Own V3 cursor namespace binds canonical query and existing generation/catalog identity.
- Label « Recherche par mots » and concise hint. Explicit submit, invalid/empty/loading/offline/stale/error/retry states, keyboard/focus/touch targets and accepted-criteria semantics. No keystroke requests or query text in telemetry.
- Old saved-envelope1/linkv1 readable unchanged. Saved envelope2 supports discriminated V2/V3; load never rewrites, successful mutation writes2. New linkv2 accepts only V3. Explicit restore fills editable fields only, no auto-fetch; text-only criteria carry words, never catalog IDs. Existing limits, namespace isolation, undo/quota/corrupt/future/cross-tab behavior retained.

## Test strategy and gates

Strict hostile parser/type tests, Unicode bounds/idempotence, catalog golden table, primary-only matching, engine parity, all5 sorts and combined filters, >20-match pagination, equivalent/changed text and cross-version/generation cursors. API/proxy method/body/origin/flag/version/privacy regressions. Saved/link old/new roundtrips and accepted-vs-draft behavior. Real pinned PostgreSQL/OpenSearch integration and50queries p95<500ms.

Both Chromium/WebKit journeys;320/390/768/1440 light/dark and enlarged text,44px/focus/keyboard/axe/content fit, actual-pixel independent review and existing performance budgets. Root lint/typecheck/tests/build, secrets/dependency checks, independent code review, exact-source PR and protected-main acceptance. [Validation](../../docs/validation/TASK-0120.md) distinguishes pending from observed evidence. No subsequent task until delivered.

## Operations and rollback

Reuse existing request deadlines, cancellation, fixed metrics and prototype flag. No SQL/index/raw migration. Rollback code only: legacy consumers remain valid, old app sees new saved envelope as unsupported/read-only and preserves bytes. Do not delete stored data or replace another chat's processes. No production, real-data or full-site-V1 acceptance implied.
