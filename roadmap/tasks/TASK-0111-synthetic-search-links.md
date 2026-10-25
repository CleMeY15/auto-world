# TASK-0111 — Reproducible synthetic search links

Status: DONE_ON_MAIN, 2026-10-18. Source CI39139363548 and exact main CI39140493041 SUCCESS; accepted main3cccfb457864aceb72af3c49d5f99d15f3ce1505. [Immutable delivery checkpoint](https://github.com/CleMeY15/auto-world/pull/180#issuecomment-6251833551). Historical local evidence below remains unchanged.

## Goal and dependencies
Create a link from accepted demo search criteria, inspect those criteria after opening, explicitly load the editable form, then explicitly search. TASK-0103/0107/0108/0109/0110 accepted; [TASK-0110 delivery](https://github.com/CleMeY15/auto-world/pull/177#issuecomment-6248301095). Base main02ba4faa2aaccf589aa7114fec2bda7ee9432e16, CI39131742418 SUCCESS. TASK-0005 is not a dependency;0104–0106 remain gated separately.

## Contracts and scope
Read [ROADMAP](../../ROADMAP.md), [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md), [synthetic lane](../../docs/decisions/ADR-0012-synthetic-development-lane.md), [link contract](../../docs/decisions/ADR-0021-synthetic-search-links.md) and existing V2 query/catalog/criteria parsers. Reuse existing exact restoration; no new backend, DTO, dependency, storage schema, source, account or infrastructure. Other branch's infrastructure files and DELIVERY.md are outside ownership.

## User flow and acceptance
- Accepted Results → Créer un lien → readonly selectable URL → explicit copy or manual fallback. Only accepted cursorless criteria, never draft, result list, free text or names. Empty/partial/stale responses remain eligible without promising identical results.
- Open link → Recherche reçue → readable criteria → Charger les critères → editable Search → explicit Rechercher. Opening never applies filters or submits; ignoring preserves existing draft/results. Browser Back/Forward/reload and invalid/unsupported routes remain predictable.
- Identity requires exact fixture/release/make/model parent; pending catalogue disables exact load, failure/mismatch offers explicit omission preserving numeric/year/sort filters. No raw taxonomy labels/IDs from the link. Numeric restore works offline; search still requires the API. Disabled demo sends zero API requests.
- Existing request abort/epoch protection extends to shared-hash arrival; old responses cannot navigate away or overwrite restored criteria. Explicit loading alone clears pagination/comparison/results; storage remains unchanged. Copy completion cannot announce for an obsolete panel.
- Bounded strict4096-character raw fragment, single URI decode and existing strict JSON/criteria validation. Exact minor units/tiny numbers/zero/all sorts roundtrip; cursor/private/extra/duplicate/prototype/missing-binding/invalid URI/future payloads fail safely. Fixed same-origin /demo URL drops inherited tracking/query/hash/credentials.
- Existing tokens/primitives, progressive inline controls, labelled field/region, keyboard/focus/live feedback/44px targets/WCAG2.2AA,320/390/768/1440 light/dark and200% platform/Verdana. Independent actual-pixel review required.
- Fixed no-op analytics names only: search_link_created, search_link_copied, search_link_loaded; shared screen. No URL/criteria/origin/names/IDs/error text. Privacy-negative tests required.

## Test and delivery strategy
Unit codec/analytics plus existing saved-search regressions; real-API roundtrip and adversarial browser catalogue/clipboard/race/navigation/disabled/storage tests. Create/load feedback≤100ms event→DOM→next-frame callback under existing4x mobile lab profile; clipboard OS permission latency excluded. Preserve APIp95≤500ms, LCPp75≤2500ms, CLS≤.1, EventTimingp75≤200ms (not production INP).

Run pinned root lint/typecheck/tests/build, nonzero Turbo graph, secrets/audit/diff and full Windows/Linux browser gates; independent code/architecture/actual-pixel UX review; focused PR with final-head CI, protected-main acceptance and durable delivery record. [Validation](../../docs/validation/TASK-0111.md). Do not start another task before this one's acceptance.

## Operations and rollback
Link holders/history/extensions can read criteria; fragment is not encryption. Current loopback link is usable only on the computer running the enabled demo. No frozen results, persistence, public deployment or verified automotive claim. Disable demo or revert increment; favorites/saved searches remain untouched. Older clients reject the unfamiliar hash without executing it.
