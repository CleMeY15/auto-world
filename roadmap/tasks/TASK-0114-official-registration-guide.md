# TASK-0114 — Accès guidé au simulateur officiel de carte grise

Status: READY, 2026-10-22. Priority P1, independent product lane. Owner: application lead; bounded native executor for tests; independent architecture, code and actual-pixel UX reviewers. Architect APPROVE then distinct Critic APPROVE before execution.

## Goal and dependencies
Help a shopper estimate the registration cost of a vehicle already registered in France through the existing official simulator, as explicitly requested on 2026-10-22. This task delivers preparation and outbound navigation, not a French Registration Engine.

Accepted prerequisites: TASK-0007 shared UI foundation; TASK-0010 readiness guidance ([PR164](https://github.com/CleMeY15/auto-world/pull/164), source CI38437843829/main CI38439264721 SUCCESS); TASK-0113 product closure ([checkpoint](https://github.com/CleMeY15/auto-world/pull/184#issuecomment-6301516770)). Branch `codex/task-0114-official-registration-guide` starts at accepted main `81e9aee793820f543a12f27e4d5ba42d702f4cc8`, main CI39538031586 SUCCESS.

Contracts: AGENTS, ROADMAP, [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), Vehicle Intelligence, Strategic Moats, security/legal and [ADR-0024](../../docs/decisions/ADR-0024-official-registration-guide.md). No new public/data contract.

## Flow and acceptance criteria
- Footer entry from both root and demo → static `/carte-grise` → concise nonexhaustive preparation guidance → explicit official simulator in a new tab. Root/demo behavior and synthetic disclosure remain intact; guide works with demo disabled and JavaScript disabled.
- One obvious primary action. Fixed HTTPS official URL with no query, fragment, prefill or tracking; visible, programmatically associated new-tab notice. Original Auto World page remains intact, opened page has no opener, request has no referrer or submitted data.
- Checklist covers certificate, first circulation date, fiscal horsepower P.6, energy P.3 and residence department. The official service determines additional questions and applicability; no eligibility decision or exhaustive coverage claim.
- No input form, file upload, personal/vehicle data collection, API/proxy, iframe, scraper, external resource hints, background request, copied tax rate, local amount or returned result. Nothing is transferred from synthetic listings or stored.
- Native help disclosure explains internet dependence and offers the official cost guidance page with identical link privacy protections. No invented external success/error/loading state or availability monitoring. Already loaded local content remains usable offline; external navigation needs connection.
- Existing semantic tokens, ordinary anchors/details, clear labels, light/dark, 44px targets, keyboard/focus/skip navigation and reduced motion. Validate 320/390/768/1440 widths and 200% platform/Verdana text, with actual-pixel review.

## Test strategy and delivery
Browser/HTTP contract tests on production build: entries, no-JS/disabled-demo, explicit outbound request (intercepted; not evidence of official calculation), no referrer/opener/storage/API, fixed destinations, offline local help, axe and content fit. No new pure calculation unit exists; existing web unit suite remains required. Chromium lab 10 cold loads, 4x CPU/1.6Mbps/150ms, LCP p75≤2500ms/CLS≤0.1; native disclosure feedback≤100ms. Full Chromium/WebKit regression, lint/typecheck/tests/build/secrets/audit, independent code/architecture/pixels and exact-head/main CI before Done.

## Operations and boundaries
No backend workflow, schema, persistence or migration. Analytics deliberately not instrumented: opening an external page cannot establish that a calculation succeeded, and no collector is introduced. Tests validate navigation, not a fabricated analytics event.
Review official destination and checklist on changes/releases; if invalid, correct or remove the link through reviewed code change. Rollback reverts the route and two entries, with no stored data. Infrastructure branch retains scripts, images, ADR0015 and TASK0005(A). No infrastructure admission, source rights, specs/emissions readiness or TASK0104–0106 unblocking follows from this task.
