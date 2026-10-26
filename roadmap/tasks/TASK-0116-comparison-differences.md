# TASK-0116 — Lire les différences d’une comparaison

Status: LOCAL_VALIDATED / DELIVERY_PENDING, 2026-10-26. Full Windows UI418 pass/8 documented exclusions, no failures or retries; independent code APPROVE, architecture CLEAR and actual-pixel UX APPROVE. An intermittent unchanged infrastructure test and its bounded-concurrency full rerun are preserved in [validation](../../docs/validation/TASK-0116.md). Exact-head Linux CI and protected-main delivery remain mandatory before Done. Priority P1, independent synthetic lane. Owner: application lead; independent test and code/UX reviewers. DoR satisfied by the bounded goal, contracts, dependencies, states and test strategy below.

## Goal and dependencies

Make the existing two/three-publication comparison easier to scan, especially on mobile, without changing its data authority. TASK-0109 and TASK-0113 are accepted on main ([0109 checkpoint](https://github.com/CleMeY15/auto-world/pull/176#issuecomment-6191690565), [0113 checkpoint](https://github.com/CleMeY15/auto-world/pull/184#issuecomment-6301516770)). TASK-0115 is also delivered ([checkpoint](https://github.com/CleMeY15/auto-world/pull/194#issuecomment-6378724917)).

Branch `codex/task-0116-comparison-differences` starts at current main `a52884b2daa44ffd40dc3292a4677a61b6494b1b`. Product files match the accepted TASK-0115 tree. Main's separate managed-image audit failure is owned by the infrastructure lane; this task neither repairs nor waives it. TASK-0005 and TASK-0104–0106 are not unblocked.

Contracts: [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md), ADR-0012 and ADR-0023. Existing `comparisonRows` remains authoritative. No new shared contract requires an ADR.

## Scope, flow and acceptance

- Existing local comparison or explicitly loaded comparison link → full table by default → native checkbox « Différences uniquement » → hide only rows classified `same` → uncheck to restore all rows. No requests, storage, URL changes, data mutation or new analytics schema. Existing closed comparison open/load events remain unchanged; filter changes are deliberately not collected.
- Keep `different`, `incomplete`, `incompatible` and `insufficient` distinct. Unknowns and non-comparable units remain visible, explicitly explained beside the control. No winner, conversion, score, inferred equality or real vehicle identity.
- Text plus restrained token-based emphasis identifies different rows in either mode. Preserve provenance once per publication on the last visible authored-description row; hiding an identical year must not hide provenance for a different make/model. Snapshot timestamps/qualifications and historical-conflict warnings remain outside filtering. Hidden identical availability remains visible in column context.
- With no remaining rows, show an honest no-difference message and keep publication context and the reversible control. Below two entries, show all rows and disable the unchecked control with the existing explanation. Removal recomputes rows immediately; returning/reopening, reload, a new search and explicit link re-read reset the view to full.
- Keep semantic table/header relationships, keyboard-scrollable region, 44px checkbox label target, visible focus and polite count announcement. Narrow toolbar wraps without page overflow; two-column comparison uses no unnecessary third-column space. No sticky overlapping labels or duplicate mobile data authority.
- Loading/error/slow/offline, catalogue mismatch, missing/withdrawn/deleted publications, partial/stale snapshots and disabled demo retain the existing behavior. The filter is available only on an accepted table and remains usable offline with already-loaded data.

## Implementation and validation

Small view-only change in `comparison-components.tsx` and `demo.css`; regression tests reuse the current V2 fixtures and table. Test normal/received tables, equal/unknown/mixed/precise values, provenance after filtering, removal/reset, side-effect absence, keyboard and empty recovery. Retain all existing comparison/model/link tests.

Run pinned lint, typecheck, unit/integration tests, build, secrets, dependency audit and diff checks. Both browser engines: targeted regressions plus full suite, viewport/theme matrix 320/390/768/1440, enlarged text, reduced motion, axe, target/overflow checks and actual screenshots. Measure filter feedback at 4x CPU within the existing 100ms local-interaction budget; retain existing mobile/API performance gates. Independent code and actual-pixel UX review, exact-head CI and protected-main acceptance remain required before Done. [Evidence](../../docs/validation/TASK-0116.md).

## Isolation and rollback

No backend, DTO, ingestion, registry, infrastructure, dependency, storage or real-source change. No claim to implement production Vehicle Compare. Preserve all provenance and synthetic labels. Roll back by reverting this focused frontend increment; no migration. Leave shared ROADMAP/DELIVERY and the other chat's files untouched during parallel work; this task is the live product status record.
