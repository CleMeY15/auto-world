# TASK-0115 — Guide acheteur vers le service officiel HistoVec

Status: READY, 2026-10-23. P1, independent product lane. Owner: application lead; bounded native executor for tests; independent architecture, code and actual-pixel reviewers. Sequential Architect APPROVE then distinct Critic APPROVE. DoR/ADR/DESIGN committed before application code.

## Goal and dependencies

Help a buyer request the official administrative-history report from the seller/current registration-certificate holder and understand how to access it through the holder's shared link. Reuse HistoVec, not recreate or integrate its report engine.

Accepted dependencies: TASK-0007 UI foundation and TASK-0114 static official-navigation delivery, [PR190 checkpoint](https://github.com/CleMeY15/auto-world/pull/190#issuecomment-6352642818) and [PR192 checkpoint](https://github.com/CleMeY15/auto-world/pull/192#issuecomment-6354006409). Base main `caa992686e87bff38d79225504b516ebb65050eb`, CI39873298126 SUCCESS. Dedicated branch `codex/task-0115-official-history-guide`.

Contracts: AGENTS, ROADMAP Vehicle History Gateway, [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), Vehicle Intelligence, Strategic Moats, security/legal and [ADR-0025](../../docs/decisions/ADR-0025-official-history-guide.md). No new public/data contract or source admission.

## Flow and acceptance criteria

- Root/demo footer « Historique du véhicule » → independent static `/historique-vehicule` → short buyer guide → one primary « Ouvrir le site officiel HistoVec » action. Preserve existing navigation and synthetic disclosure; available with demo disabled and JavaScript disabled.
- H1 « Demander un rapport HistoVec ». The current registration-certificate holder — generally the seller — generates the report. The buyer asks the seller/holder to share its link; if unavailable, asks them again. Opening the general site does not retrieve a report. Auto World neither retrieves nor verifies it.
- Administrative history is not a vehicle-condition guarantee or replacement for separate sale documents/checks. No accident-free, eligibility, trusted-vehicle, affiliation or comprehensive-history claim.
- Fixed reviewed bare HTTPS links, user-activated only, visible/programmatically associated new-tab notice, no opener/referrer/payload/query/fragment/prefill. Secondary Service Public sale guidance in native help.
- No plate/VIN/identity/certificate/report URL input, upload, result, API/proxy, iframe, scraping, storage/cookies, telemetry, external hints or background availability probe. No synthetic listing transfer. Route-only DNS-prefetch header has supporting-browser semantics, not a universal network guarantee.
- Native help remains operable after the page is loaded offline; external navigation needs internet. No fabricated external loading/success/error/empty state.
- Shared tokens, restrained responsive reading layout, 44px targets, keyboard/focus/skip navigation, reduced motion, light/dark and no overflow/clipping at 320/390/768/1440 and 200% platform/Verdana text. Independent actual-pixel review.

## Test strategy and delivery

Production-build browser/HTTP tests: exact routes/entries/headers, no-JS/disabled-demo, holder/report copy, intercepted official navigation, no automatic external/API/fetch traffic, no referrer/opener/payload and before/after storage/cookie/IDB/cache comparison plus denied-storage operation. No real report, plate or identity in tests; interception proves our navigation, not official report generation/access.

Chromium/WebKit keyboard/offline/axe WCAG2.2AA and viewport screenshots; Chromium 10 cold loads, 4xCPU, 1.6Mbps/150ms, LCP p75≤2500ms, CLS p75≤0.1, native disclosure next-frame callback≤100ms (not physical paint/production INP). Full lint/typecheck/unit/integration/build/secrets/audit and full UI regression; no new skips or weakened budgets. Independent code/architecture/privacy/pixel reviews, exact final-source CI, normal protected merge, identical tree and main CI before Done.

## Operations, provenance and rollback

No vehicle Observation/Provenance record is created. Dated official source references and limits live in ADR-0025. This adds honest purchase guidance, not a proprietary historical dataset. No backend workflow, migration, feature-flagged data acquisition or analytics collector applies; external completion cannot be observed and is not measured.

Application lead reviews destinations/copy on changes/releases and corrects/removes stale links through reviewed code. Rollback removes the new route, entries and header; no persisted data. Keep infrastructure scripts/images/ADR0015/TASK0005(A) owned by the other branch. TASK0104–0106 remain blocked; no broader Vehicle History capability is marked Done.
