# TASK-0113 — Liens de comparaison synthétique

Status: LOCAL_VALIDATED / DELIVERY_PENDING, 2026-10-20. Priority P1, independent synthetic lane. Owner: application lead, native executor and independent test-engineer. DoR: Architect APPROVE/CLEAR then distinct Critic APPROVE. Local gates and independent code/architecture/actual-pixel reviews pass; exact-head CI, protected merge and merged-main CI remain required before Done.

## Goal, dependencies and contracts
Complete the comparison part of ROADMAP Share: explicitly create/copy an ordered2–3-publication pointer and load current readings on receipt. TASK0109/0111/0112 delivered; [0112 exact-source/main checkpoint](https://github.com/CleMeY15/auto-world/pull/181#issuecomment-6252629201), accepted main1d0133e17a9b8bcf763ae520ab1a2a05bc25e334/mainCI39146578449 SUCCESS. Branch codex/task-0113-comparison-links starts from main686fe4182dc33ddcb2b326ed341479cbdfbc5200/CI39149012725 SUCCESS.

Contracts: AGENTS, ROADMAP, [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), architecture, Strategic Moats, Vehicle Intelligence, ADR0012/0016/0021/0022 and [ADR0023](../../docs/decisions/ADR-0023-synthetic-comparison-links.md). Existing ListingId, V2 expected-ID detail parser, bounded loader, table, link creator and catalogue matching remain authoritative.

## Scope and acceptance
- Existing accepted Compare with2–3 entries → inline Créer un lien → labelled selectable URL → explicit copy or manual fallback. No competing primary navigation. URL contains ordered distinct public IDs only, never values/history/results/criteria.
- Versioned fragment with maximum1024 raw characters, dense plain array2–3, no extras/accessors/sparse/duplicates/coercion. Decode exactly once with strict JSON; unsupported/invalid show fixed recovery, never payload text. Fresh same-origin HTTP(S)/demo; no inherited tracking/query/path/credentials.
- Received Comparaison reçue leaves search draft/results/selection/storage unchanged. Opening never searches, fetches details or copies; only existing catalogue GET can run. Explicit Charger la comparaison performs at most3 existing concurrent GET detail reads. Back/forward/reload requires a new explicit load.
- Requested slots remain visible and numbered. Table only after every requested expected-ID detail succeeds and fixture/taxonomy tuples agree. No silently reduced subset.404/invalid/read error/timeout offers retry-all; successful missing/withdrawn/deleted remains labelled, not filtered. Mixed fixtures/releases block the table with an explanation.
- Each column retains its own dataAsOf and complete/partial/stale state. UTC seconds/nonzero milliseconds must distinguish same-minute readings. No synthesized shared response/instant. Catalogue mismatch hides authored identity, not accepted observed price/km; units/currencies/unknowns and observation vs declaration provenance remain separate.
- Loading/slow/offline/error/empty-invalid/success states, explicit re-read clearing prior table, abort/generation/raw-hash guards, duplicate-click prevention,15s deadline, no automatic retries. Offline after acceptance preserves already-loaded qualification.
- Closed no-op analytics only: comparison_link_created/copied on compare and comparison_link_loaded on received-comparison, success/error; no payload/IDs/URL/error text. Disabled demo makes zero API requests and exposes no comparison-link flow.

## Verification
Hostile codec/bundle/analytics unit tests; real-API roundtrip; clipboard outcome/races; request/privacy/no-implicit-action assertions; expected-ID/missing/ended/mixed tuple/per-column timestamp and late navigation mutants. Preserve existing comparison/search/publication/storage regressions.

Chromium/WebKit320/390/768/1440 light/dark,390 at200% platform/Verdana, keyboard/focus/44px/axe/overflow/reduced motion and independently inspected Windows/Linux screenshots. Create/load UI feedback≤100ms at4xCPU, excluding network/OS clipboard/physical paint. Pinned root lint/typecheck/tests/build, nonzero task graph, secrets/audit/diff. Independent code/architecture/visual review, exact final-head CI/protected merge/main CI and durable checkpoint before Done. [Validation](../../docs/validation/TASK-0113.md).

## Isolation, operations and rollback
No new dependency/API/DTO/storage/infra/source right. No real vehicle identity, frozen data, cross-fixture identity, hosted/cross-device service or alert. Fragments are visible to holders/history/scripts, not secrets. Disable existing demo or revert; no migration.

Other chat owns scripts/postgres-image, ADR0015 and TASK0005/0005A. ROADMAP.md and roadmap/DELIVERY.md deliberately remain unedited to avoid concurrent ownership; this task file is the product increment's status record. TASK0104–0106 remain separately gated.
