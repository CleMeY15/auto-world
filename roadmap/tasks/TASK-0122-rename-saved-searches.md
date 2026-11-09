# TASK-0122 — Renommer une recherche enregistrée

Status: IN_PROGRESS, 2026-11-09. Priority P1, isolated synthetic V1 lane. Owner: application lead, disjoint implementation/tests and independent review. Definition of Ready satisfied below; sequential Architect then distinct Critic APPROVE before execution.

## Goal, dependencies and contracts

Rename a saved search without deleting/recreating it or changing its accepted criteria. TASK-0121 is DONE_FOR_V1_PROTOTYPE at main `7ea0d333babb74dd993aaf14684d4e10f4852e3f`, [PR232 accepted checkpoint](https://github.com/CleMeY15/auto-world/pull/232#issuecomment-6738946552), source/main quality and persistent CI successful. Reuse TASK-0108 storage and TASK-0118 comparison rename; no TASK-0005 qualification dependency under ADR-0028.

Contracts: [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md), ADR-0012 and ADR-0028. Local user labels are not authoritative vehicle data/provenance. No new dependency, backend, source rights, scanner or workflow change.

## Flow and acceptance

- Mes listes → Renommer → prefilled inline shared Field → Enregistrer or Annuler/Escape. Select/focus on open; invalid stays editable; success/cancel restores current row action. Only one editor across searches/comparisons; opening another or leaving Saved discards the draft. Shared focus generation prevents older deferred callbacks interrupting newer intent. External invalidation restores focus only if owned, resolving by criteria key before heading fallback.
- Existing trimmed NFC 1–60 Unicode-point names and hostile-character rejection. Duplicate labels allowed; identical normalized name is a zero-write/no-event no-op. Rename works at capacity and changes only the name at its original position. Keep exact text, numeric criteria, catalog binding, canonical key, storage namespaces and v1-reader/v2-writer compatibility. No new migration or collection.
- Read current bytes before mutation, require captured immutable snapshot and existing key, and guard raw hash/screen synchronously even for same-event-loop navigation or disabled demo. Stale/remove/reset/reorder rejects intent without resurrection or retry. localStorage remains last-writer, not transactional synchronization. Preserve unrelated local deletion undo and independent collection keys.
- Session/quota/denied renames stay memory-only with explicit copy. Corrupt/future/unhydrated are read-only, preserving existing bytes. Read-only copy mentions rename and deletion. Offline/disabled rename performs no API/search/detail/clipboard action. No loading spinner for a local operation; initial/edit/invalid/success/cancel/stale/readonly/session states intentional.
- One closed collector-free `saved_search_renamed` event only for a changed successful rename, exactly eventName/screen:saved/outcome:success. No names, criteria or identifiers. Existing load/delete/undo/reset, unavailable-catalog warnings and comparison flows preserved.

## Test strategy and gates

Unit tests: exact criteria/order/binding/key/namespace, full capacity, Unicode/no-op/immutability, invalid/missing/stale snapshots, unseen writes and events, readonly/future/corrupt, session/quota/denied, unrelated undo and strict analytics. Browser tests in Chromium/WebKit: edit/save/reload/cancel/Escape, navigation/storage races, both-direction deferred-focus races, offline/disabled no requests and unchanged load/delete/undo. Existing persistent journey adds rename/reload/API-outage rename with exact criteria and independent-key preservation.

320/390/768/1440 light/dark, 200% platform/Verdana, reduced motion, keyboard/focus/44px/axe WCAG2.2AA/overflow and actual-pixel review. Five Chromium4x CPU feedback samples ≤100ms; WebKit baseline reported separately. Pinned frozen native Linux, lint/typecheck/tests/build with nonzero task counts, full browser suite, secrets/audit, independent code/architecture/visual approval, exact-source CI and protected-main CI before Done. [Validation](../../docs/validation/TASK-0122.md).

## Operations and rollback

No vehicle data, account/cloud sync, new collector, production activation or image admission. Other chat owns TASK-0005/PR230. Existing previews unchanged. Revert this focused increment without deleting saved data; updated labels remain backward-readable. TASK-0123 may start only after this task's final accepted checkpoint.
