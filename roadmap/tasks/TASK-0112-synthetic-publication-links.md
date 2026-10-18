# TASK-0112 — Explicit synthetic publication links

Status: LOCAL_VALIDATED / DELIVERY_PENDING, 2026-10-18. Implementation, local gates and independent architecture/code/actual-pixel reviews passed. Exact final-head CI and protected-main acceptance remain separate PR checkpoint gates. DoR passed: Architect CLEAR followed by distinct Critic APPROVE; native executor/test lanes under application lead ownership. Priority P1, independent synthetic lane.

## Goal, dependencies and contracts
Continue ROADMAP Share: create and explicitly copy a link from an accepted synthetic publication detail. TASK-0103/0107/0110/0111 accepted; [0111 delivery checkpoint](https://github.com/CleMeY15/auto-world/pull/180#issuecomment-6251833551), accepted main3cccfb457864aceb72af3c49d5f99d15f3ce1505, CI39140493041 SUCCESS. TASK-0005/0005A and0104–0106 remain independently gated.

Read AGENTS, ROADMAP, [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), architecture, Strategic Moats, Vehicle Intelligence, ADR-0012/0016/0021 and [ADR-0022](../../docs/decisions/ADR-0022-synthetic-publication-links.md). Reuse existing public ListingId, detail fragment, expected-ID V2 parser and clipboard UI. No dependency, API, DTO, storage, source right or automotive evidence change. Other infra checkout/files and DELIVERY.md excluded.

## User flow and acceptance
- Results or Saved → accepted Detail → Créer un lien → labelled readonly selectable URL → explicit copy/manual fallback. Place after snapshot summary, before evidence history; no new screen/modal/card or favorite-action competition.
- Entire detail body and creator require ready response whose listingId equals current route ID. All successful active/withdrawn/deleted/missing and partial/stale states eligible with qualifiers intact; successful missing is not HTTP404. Pending/error/invalid/disabled expose no creator. Accepted offline detail may create locally; direct offline open retains retry state.
- Fresh same-origin HTTP(S) `/demo#detail/<single encoded validated public ListingId>`; reject credentials/unsafe URL/invalid ID, discard inherited query/path/hash. No values, evidence, fixture, taxonomy, criteria or private payload. Pointer to current runtime publication, not frozen snapshot, cross-fixture identity or real vehicle.
- Direct opening uses existing GET-only detail/catalogue flow and strict expected-ID validation; no search POST, clipboard or storage mutation. Later data/availability may differ. Local computer/demo disclosure remains explicit.
- Shared bounded creator preserves search-link IDs/copy/behavior. Success only after clipboard promise resolution; failure/missing API selects field for manual copy. Close/unmount/replacement suppress obsolete UI completion, not an already-requested OS write. Field focus on open, trigger on close, live feedback and44px actions.
- Closed no-op listing_link_created/listing_link_copied events, detail screen, success/error only from this UI; no URL/ID/payload/error text. Existing privacy parser remains authoritative.

## Verification and delivery
Unit hostile builder/origin/analytics cases plus unchanged search regressions; real API + mock adversarial browser routes/clipboard/state/races/storage; keyboard/axe/44px/no overflow; Chromium and WebKit320/390/768/1440 light/dark and390 at200% platform/Verdana. Create feedback≤100ms at4x CPU excludes OS clipboard latency, physical paint and production INP.

Pinned root lint/typecheck/tests/build, nonzero Turbo graph, secrets/audit/diff; full Windows and isolated Linux browser suites; independent code/architecture/pixel reviews. Exact final-head CI, protected merge, exact main CI and durable PR checkpoint before next task. [Validation](../../docs/validation/TASK-0112.md).

CI-only wall-clock headroom: quality timeout15→20 minutes because last main took14m38s; all steps, required name, retries, skips and application thresholds unchanged. Rechecked no concurrent workflow edit in infra checkout. No image/publisher workflow touched.

## Operations and rollback
Fragment readable by holders/history/page scripts/extensions; no confidentiality claim. Current runtime can return changed/unavailable data or change fixture identity. No hosted/cross-device sharing or source admission. Disable existing demo flag or revert increment; no data/storage migration.
