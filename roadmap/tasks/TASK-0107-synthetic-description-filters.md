# TASK-0107 — Synthetic descriptions and exact filters

Status: IMPLEMENTATION_VALIDATED locally, 2026-10-14. Independent code/architecture/UX findings are resolved; local gates and83 browser tests pass. Not Done until final-head CI and main delivery gates pass, as recorded in the PR.

## Goal, ownership and dependencies

Enrich the existing demo Search → Results → Detail → Saved flow with fictitious make/model/first-registration-year descriptions and exact filters. Owner: application development lead, with bounded contract/data/UI execution and independent code, architecture and UX reviewers. Accepted dependencies: TASK-0008 taxonomy and TASK-0103 web flow. TASK-0005 is not a dependency; supported tasks0104-0106 remain blocked.

## Scope and relevant contracts

[ADR-0020](../../docs/decisions/ADR-0020-synthetic-listing-description-v2.md), [DESIGN](../../DESIGN.md), [UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [data platform](../../docs/data/DATA_PLATFORM.md). Additive raw/public V2, exact filters and catalog-backed labels only. No real source, resolved vehicle, tax meaning, canonical/SDK change, infrastructure or external dependency.

## User flow and required states

Search bootstraps the catalog, then user selects make → model and/or exact first-registration year, optionally price/mileage → results → description/history detail → local favorite → reload Saved → remove/undo. Changing make clears incompatible model; back navigation preserves filters and focus. Cover catalog skeleton, error/retry/offline/mismatch/empty; missing current description; historical contradiction/repeated declarations; partial/stale; loading/empty/error/success/withdrawn; direct Detail/Saved and storage failure. All labels are explicitly fictitious and never imply a vehicle for sale.

## Acceptance and test strategy

- V1 fixtures/digests, parser behavior, defaults and endpoints unchanged. V2 raw bytes retained verbatim with SHA/association checks; SDK effects remain canonical V1 only.
- Strict detached/frozen V2 parsers reject hostile inputs, partial descriptors, invalid release/parent/year/attribution and duplicate associations; no private IDs/payloads leak.
- Current description derives from latest committed version; absent latest is unavailable while full historical evidence remains. Exact filters apply to current data. Page evidence bound256/unique with no truncation; cursor binds all filters/release/snapshot.
- Browser owns neither raw corpus nor hardcoded taxonomy. Labels require matching validated catalog/response; initial catalog is not a search/analytics event.
- Targeted contract/connector/read-port/HTTP/web tests, real socket and actual backend E2E pass. Keyboard/axe WCAG2.2AA,44px targets, no overflow,320/390/768/1440px,light/dark,reduced motion/200% checked visually.
- Actual API p95≤500ms, mobile lab LCPp75≤2.5s, event timingp75≤200ms, CLSp75≤0.1, favorite feedback≤100ms; profiles/sample counts recorded without production claims.
- Lint/typecheck/tests/build, nonzero Turbo tasks, secrets/dependency audit, independent code/security/provenance/architecture/UX reviews pass. [Validation record](../../docs/validation/TASK-0107.md), final-head CI, reviewed merge identity and protected-main CI govern delivery.

## Operations and rollback

Reuse bounded loopback routes, redacted request metrics/logs/spans and existing demo flag. Disable `AUTO_WORLD_DEMO` or revert this increment to rollback; preserve V1 API and local favorite IDs. No data migration, production credentials or source admission.
