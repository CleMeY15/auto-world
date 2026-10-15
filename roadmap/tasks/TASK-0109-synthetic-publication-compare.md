# TASK-0109 — Ephemeral synthetic publication comparison

Status: IMPLEMENTATION_VALIDATED, 2026-10-15. Definition of Ready and local Definition of Done gates satisfied: implementation, root quality gates,149 passing browser tests per platform, source-bound visual/performance evidence and independent code/architecture/UX approvals. Exact final-head CI/protected-main delivery checkpoint pending; not DONE_ON_MAIN and no following task started. [Evidence](../../docs/validation/TASK-0109.md).

## Goal, owner and dependencies
Compare two or three publications from one accepted demo search without inventing vehicle identity or automotive facts. Owner: application lead, disjoint model/UI execution and independent code/architecture/UX review. Prerequisites TASK-0103/0107/0108 accepted; [TASK-0108 final delivery](https://github.com/CleMeY15/auto-world/pull/173#issuecomment-6188438418). Base main2ecf0a323daa5ec6f7bd462d5bb278e59881cc0b, CI38720025906 SUCCESS. TASK-0005 not a dependency;0104–0106 remain blocked.

## Scope, contracts and decision
[DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [ADR-0012](../../docs/decisions/ADR-0012-synthetic-development-lane.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md) and existing public V2 results/catalog contracts.

Decision: ephemeral current-results IDs, derived facts from that accepted response, no second data authority. Prefer this bounded user-value increment to persisted IDs/detail-fetch (storage/race/provenance expansion) or waiting on unrelated infrastructure. This validates a publication-level flow, not production P3 Vehicle Compare, Vehicle Graph, durable Garage or AI explanations. No storage, account, sharing, conversion, score, backend/DTO/infra change or dependency. Reload/new search intentionally loses selection.

## Flow and required states
Results → select2–3 publications → Comparer → factual table → remove or return to unchanged Results. No extra primary destination. Maximum3, minimum2 to open; direct/reloaded empty view is honest. Below2 after removal retain remaining selection and offer return. Selection survives same-response pagination and screen changes, not any first-page request or saved-criteria restore. Disable selection/open during pending first-page refresh; failure may expose old accepted facts again with original dataAsOf/error, never stale selected IDs after replacement. Comparison itself performs zero requests or writes; disabled demo retains existing local Saved management only.

Compare availability, authored make/model/first-registration year, observed price/mileage. Exact typed differences, no ranking: unknown values are incomplete, incompatible currencies/units non-comparable, identical/different only for sufficient compatible known data. Resolve descriptions only through matching catalog/release/attribution. Selected price/mileage evidenceId supplies observedAt/confidence, authored declarations retain separate provenance/time. Signal conflicting histories. Never expose raw IDs or imply publication identity is vehicle identity. Show dataAsOf and no automatic refresh, partial/stale/offline disclosures.

Availability is the accepted search's invariant point-in-time active status: the existing HTTP parser rejects non-active search publications before selection. No live lifecycle refresh or detail fetch is introduced. A hostile non-active response must remain rejected, not be displayed in comparison. Unmatched catalogue withholds the whole authored description (including its year); observed price/mileage remain usable. Differing historical values are labelled as such, not automatically treated as simultaneous contradictions.

## Acceptance / tests
- Pure bounded selection/model, duplicate/capacity/removal, no input mutation, zero/tiny/large exact values, unknowns, unit/currency/catalog mismatch, conflicts. No second DTO parser.
- RealAPI flow plus mocked hostile states, deferred first-page success/failure/supersession, restore/newquery/retry clearing, append-to-stale retention, no comparison network/storage side effects, reload/disabled behavior.
- Existing tokens/primitives; keyboard heading/return/removal focus, semantic table in labelled keyboard-scrollable region, explicit narrow scroll hint, no viewport overflow,44px controls, WCAG2.2AA axe,320/390/768/1440 light/dark, reduced motion and200% platform/wide-font Chromium/WebKit.
- Compare selection/open feedback≤100ms; existing realAPI p95≤500ms and bounded ten-cold-mobile LCP/CLS/EventTiming budgets retained. No physical-device/production/load claim.
- Root lint/typecheck/tests/build, nonzero Turbo, secrets/audit/diff check; isolated serial Windows/Linux full UI suites; source identity evidence and actual-pixel independent UX plus code/architecture review. Exact final-head CI and protected-main delivery before Done or next task.

## Operations, privacy and rollback
Closed no-op analytics permit only eventName/screen/outcome, never IDs/values/queries. Existing demo gate remains. No persistent migration or external source; existing searches/favorites untouched. Revert this UI increment to roll back. [Validation](../../docs/validation/TASK-0109.md) records evidence and remaining gaps; PR checkpoint resolves final delivery only after exact CI.
