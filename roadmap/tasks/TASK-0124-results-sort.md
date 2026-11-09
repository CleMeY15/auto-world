# TASK-0124 — Trier directement les résultats

Status: LOCAL_VALIDATED / DELIVERY_PENDING, 2026-11-09. Not Done: exact-source/main delivery remains required. Priority P1, isolated synthetic V1 lane. Owner: application lead; independent test, code and visual review lanes. Definition of Ready satisfied below. Direct bounded implementation using the existing search authority, no new architectural contract.

## Goal, dependency and scope

Let users change result order without returning to the Search form. TASK-0123 is DONE_FOR_V1_PROTOTYPE on main `79ccf8781a7c396b3dd590ee306a3aab5763aaf2`, [PR234 final checkpoint](https://github.com/CleMeY15/auto-world/pull/234#issuecomment-6742762179). Its source/main quality and persistent workflows pass;634 browser cases pass with10 existing exclusions. Historical pre-delivery documentation is not a remaining dependency.

Reuse accepted query criteria, the existing five sort values, native select, shared Button, search API, abort/epoch handling and first-page pagination reset. No new dependency, backend, API/schema, storage, conversion, ranking system, source access or infrastructure. Contracts: [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), architecture, Strategic Moats, Vehicle Intelligence, existing demo-search-contract V2/V3 and ADR-0028. Ordering synthetic publications never establishes vehicle identity, verified facts or a Deal/Trust Score.

## Flow and acceptance

- Results offers a labelled native sort selector and explicit Appliquer le tri. Changing the selector alone performs no request, persistence, navigation or analytics mutation and does not change the accepted order label. Submitting the current sort is a no-op.
- Submit clones accepted criteria and changes only sort. Preserve schema version, canonical words, exact decimal/integer filters and compatible identity; never use unrelated unsent Search draft values. Keep that draft except synchronizing its sort. Catalogue incompatibility must explain why identity-bound sorting cannot be applied, never silently remove filters.
- Use the authoritative search endpoint, start at the first page without an old cursor and clear comparison selection. No client-side array sorting. Pagination after success uses the new query and new cursor. Accepted save/share criteria change only with the accepted response.
- Immediate busy feedback and a qualified loading state hide old actionable results while a new order is pending. Slow, offline and error states have an explicit retry of the same requested query. Never present old results as the new order or allow their stale cursor to run. Superseded/aborted replies cannot restore obsolete results or navigate away from a newer user intent.
- Guard double submission and pagination overlap. Successful replacement focuses the Results heading; failure focuses retry. Keep existing empty, partial/stale, unit/currency, provenance, unknown and synthetic disclosures. Native keyboard access, visible focus and44px targets.

## Plan and validation

1. Add the restrained Results control and narrow request-state handling, reusing existing components/tokens and lifecycle mechanisms.
2. Add regression tests for explicit/no-op submission, exact accepted-vs-draft authority, all sort values, first-page reset/new pagination, save/share, selection reset, loading/error/offline/retry, catalogue gating and stale response/navigation races. Extend the real persistent browser journey with a bounded authoritative sort check.
3. Validate320/390/768/1440 light/dark,200% platform/Verdana, reduced motion, axe WCAG2.2AA,44px targets, overflow and actual screenshots. Measure five local feedback samples≤100ms per engine, ChromiumCPU×4 and separate WebKit baseline. Independent code and actual-pixel review.
4. Pinned frozen native Linux lint/typecheck/tests/build, full Chromium/WebKit suite, secrets and dependency audit. Focused PR with plan/evidence; exact-source quality/persistent success, normal protected-main delivery and main quality/persistent success before final acceptance. No added skip or weakened assertion/threshold.

## Operations and rollback

Existing search/results analytics events cover explicit search and accepted response without raw query text. No new backend workflow, migration or storage. Revert this presentation/controller increment to remove direct sorting; the original Search-form sort remains. TASK-0005/PR230 belongs to the other chat and stays separate. No public deployment, real data or production image admission. [Validation evidence](../../docs/validation/TASK-0124.md).
