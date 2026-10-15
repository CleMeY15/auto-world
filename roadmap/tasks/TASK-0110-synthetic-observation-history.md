# TASK-0110 — Readable synthetic observation history

Status: LOCAL_VALIDATED / DELIVERY_PENDING, 2026-10-15. DoR, implementation, independent code/architecture/final Windows/Linux pixel reviews and local quality gates complete. Both full browser suites192 pass/6 intentional exclusions/zero failures; [evidence](../../docs/validation/TASK-0110.md). Exact-source CI, protected merge and exact-main CI remain separate gates recorded in the final PR acceptance checkpoint; not Done at this source checkpoint.
Priority: P1, independent synthetic product lane.
Owner: application lead; disjoint pure-model/test and browser-test lanes; independent code, architecture and actual-pixel UX review.

## Goal and dependencies

Understand the displayed price/mileage and inspect each retained observation without treating historical variation as contradiction. This is publication-level synthetic evidence, not a complete vehicle history. Depends on accepted TASK-0103/0107/0108/0109. TASK-0109 [delivery checkpoint](https://github.com/CleMeY15/auto-world/pull/176#issuecomment-6191690565): main `d929158da01c2a586c01f78d856bc738ea63612c`, CI38730858398 SUCCESS. TASK-0005 is separately owned;0104–0106 remain blocked.

## Definition of Ready and scope

Read [ROADMAP](../../ROADMAP.md), [DESIGN](../../DESIGN.md), [product UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [ADR-0012](../../docs/decisions/ADR-0012-synthetic-development-lane.md), [ADR-0016](../../docs/decisions/ADR-0016-synthetic-web-flow.md), [ADR-0020](../../docs/decisions/ADR-0020-synthetic-listing-description-v2.md), existing public V2 DTO/parser/protocol and detail/comparison source.

Web presentation only: pure helpers, detail history, shared exact observation formatting and focused tests/docs. No API, DTO, parser, fixtures, dependency, storage, source rights or infrastructure changes. Concurrent infrastructure paths and `roadmap/DELIVERY.md` are outside ownership. Decision: selected observation visible plus native disclosures; a chart would need additional comparability/time semantics, and copy-only repair leaves a mixed256-record list. App-native consensus Architect CLEAR then Critic APPROVE is retained under `.omx/plans/task-0110-*`.

## Flow and acceptance

- Results/Saved/direct detail → displayed facts and snapshot → independent price/mileage histories → expand/collapse → return preserving existing context. Keep primary navigation unchanged.
- Select the exact response evidenceId, never confidence or a guessed latest timestamp. Show other records in reverse accepted-array order, including ties; preserve every record. Same-instant records stay separate without earlier/later inference.
- Native details/summary; selected observation immediately visible, no empty disclosure when one record, all remaining records accessible within existing256 limit. Focus stays on keyboard/touch trigger. No network/storage side effects; disclosure resets on detail replacement.
- Exact minor-unit prices for the existing EUR/USD/GBP/CHF/JPY/KRW union, including maximum safe integer; explicit currency codes in history and preserved symbol styling elsewhere. Exact tiny/zero/large mileage and units. No conversion, deltas, arrows, trend or trust/deal score. UTC dates retain seconds and nonzero milliseconds; observation confidence retains basis points with up to2 percentage decimals.
- Neutral historical/same-instant/mixed-representation wording. Authored declarations remain separately catalogue-gated, never automotive fact; current absence does not select old history. No raw IDs/fixture references displayed.
- Expose detail dataAsOf and complete/partial/stale/offline limits; no completeness or live availability claim. Successful withdrawn/deleted/missing detail shows status and history. HTTP404 means unavailable/introuvable, not proof of withdrawal/deletion. Search non-active rejection is unchanged. Loading/error/retry/catalog/empty states remain intentional.
- Existing tokens/primitives; selected-row hierarchy and progressive disclosure,320/390/768/1440 light/dark both engines,200% platform/Verdana,44px targets, focus/keyboard/reduced-motion/axeWCAG2.2AA, no page overflow/clipping. Actual screenshots reviewed independently.
- Expand/collapse feedback≤100ms at256 records under the existing mobile lab profile, input→open mutation→next frame. Existing APIp95≤500ms, LCPp75≤2500ms/CLS≤.1/EventTimingp75≤200ms retained. No production/physical-device claim.

## Tests and delivery

Regression before repair for false temporal contradiction and lossy formatting. Unit exactness/order/immutability/missing/ties/representations/bounds; real API flow and contract-shaped hostile browser scenarios; native disclosure/focus/side-effect checks; source replacement and state coverage. Existing closed detail_opened analytics/privacy tests remain; no new telemetry schema or collector.

Root lint/typecheck/tests/build, nonzero Turbo, secrets/audit/diff check; isolated serial Windows/Linux browser runs and source-bound pixels/performance. Independent code/architecture/UX approvals. Exact final-source CI, normal protected merge, identical reviewed tree where base unchanged, exact merged-main CI and durable PR checkpoint before Done or next task. Failed attempts remain separate. [Validation](../../docs/validation/TASK-0110.md).

## Operations and rollback

No stored data migration, service or rights activation. Disable existing demo or revert this UI increment. Keeps synthetic/real-source separation and existing favorites/searches intact. Escalate only actual overlap, unsupported contract need or missing authority; never relax gates to bypass the parallel infrastructure task.
