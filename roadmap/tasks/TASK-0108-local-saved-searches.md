# TASK-0108 — Local saved searches

Status: DONE_ON_MAIN, 2026-10-15. Source1d0c73c72dc45244be578c8c368aba49dde0bd95 CI38707338245 SUCCESS; protected-main45bcb652227905926035bc6c61e01b5b16e0549d CI38708392017 SUCCESS, identical reviewed tree. Independent final identity PASS_CLEAR. [Accepted delivery checkpoint](https://github.com/CleMeY15/auto-world/pull/173#issuecomment-6188438418). TASK-0109 starts only after this acceptance.

## Goal, owner and dependencies

Save accepted demo search criteria in this browser, find them in Saved and explicitly reload them into editable Search. Owner: application development lead with disjoint storage/UI/test execution and independent review. Accepted prerequisites: TASK-0103 and TASK-0107 (PR171 main CI38696369736 SUCCESS). TASK-0005 is not a dependency; TASK-0104–0106 remain blocked. One ready task in the synthetic lane.

## Scope and contracts

[DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [synthetic lane](../../docs/decisions/ADR-0012-synthetic-development-lane.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md) and [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md). Existing public V2 query/catalog contracts remain unchanged. Separate local key `auto-world.demo.saved-searches.v1`, version1,10 entries/16384 UTF-8 bytes maximum; trimmed NFC name1–60 code points and exact cursorless criteria. Identity filters carry only fixture/release binding; no stored labels, results, raw payloads or evidence.

No account/cloud sync, alerts, background search, rename/share/export, backend/SDK/canonical/infra change, real source or dependency. Local criteria are not a source of automotive truth or a production alert query contract.

## User flow and states

Search → accepted Results → inline Enregistrer cette recherche → name/save → Enregistrés → reload → Charger les critères → editable Search → explicit Rechercher. Saved contains searches then existing favorites. Save uses accepted first-page criteria, not draft/cursor. Duplicate criteria are not inserted; full list links to management. Delete/undo has independent focus and announcement. All copy states browser-only/no-account/no-alerts.

Cover empty/loading/success/error/offline, denied/quota/session/corrupt/future storage, changed/absent catalogue, cross-tab replacement/clear, disabled demo and cancellation of late prior search. Unknown identity is never silently restored: explicit Charger sans marque ni modèle preserves other criteria and does not submit. Future/corrupt bytes are not overwritten; only a confirmed corrupt reset may discard those exact bytes. Session reset affects memory only. Simultaneous cross-tab writes have last-writer semantics, not transactional guarantees.

## Acceptance and test strategy

- Strict bounded closed local parser, detached frozen snapshots, canonical name-independent criteria identity; public V2 parser rejects invalid filters/cursor in stored input. No SSR storage access, accessors, duplicate/prototype keys or private fields accepted.
- Persisted mutations read latest state; session mutations retain previous unpersisted changes. Reset checks unchanged observed bytes; future versions refuse mutations/reset. Independent favorite key remains untouched.
- Restore preserves all exact numerics/sorts and validated identity, aborts old search and clears pagination/results/errors. Hydration/restore never requests search; demo-disabled sends no API request.
- Real API E2E plus hostile storage/catalogue/race tests; keyboard/focus, axe WCAG2.2AA,44px targets,320/390/768/1440 light/dark, reduced-motion and200% platform/wide-font visual review.
- Existing API/mobile budgets unchanged; save/restore DOM feedback≤100ms measured as bounded lab evidence. No production/physical-device claim.
- Targeted tests, root lint/typecheck/tests/build, nonzero Turbo gates, secret scan/dependency audit, Windows and Linux browser evidence, independent code/architecture/UX review, exact final-head CI and protected-main CI required. [Validation record](../../docs/validation/TASK-0108.md) and final PR checkpoint govern Done; no next task before acceptance.

## Operations, privacy and rollback

No new backend path; retain existing `AUTO_WORLD_DEMO` boundary and closed no-op analytics collector. Only whitelisted event names/screen/outcome; never search names, query, identity or binding in telemetry. Browser data clearing loses local entries; storage rejection uses session-only memory. Revert this increment to roll back UI, retaining old favorite bytes and new-key bytes for later compatible reopening. No migration or production operation.
