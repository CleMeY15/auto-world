# TASK-0118 — Renommer une comparaison enregistrée

Status: IN_PROGRESS, 2026-11-04. Priority P1, independent synthetic lane. Owner: application lead; independent code, architecture and visual reviewers. DoR satisfied by scope, dependencies, contracts, flow, acceptance and test strategy below. Sequential Architect and distinct Critic APPROVE/CLEAR before execution; delivery is not yet validated.

## Goal and dependencies

Rename an existing local comparison without deleting/recreating it or changing its ordered references. TASK-0117 is DONE_ON_MAIN at `4517b120f1e126dff15e710a34d950694e20eae5`, [final PR204 checkpoint](https://github.com/CleMeY15/auto-world/pull/204#issuecomment-6505532536), successful exact-source/main CI. Historical task headers are pre-delivery snapshots. This is the next bounded Garage increment; ADR-0012 keeps TASK-0005 and real integration separate.

Contracts: [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [Definition of Done](../../docs/DEFINITION_OF_DONE.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md), ADR-0012, ADR-0023 and TASK-0117 storage/provenance rules. No shared service contract or source access changes.

## Flow and acceptance

- Mes listes → Renommer → one inline prefilled name field → Enregistrer or Annuler/Escape. Reuse shared Field/Button/Banner and tokens; no extra destination/modal. Focus/select on opening; invalid submission stays editable; successful/cancelled edits return to the current row action. External invalidation restores focus only when it was inside the editor, resolving the row by fragment before heading fallback. Leaving Saved discards the draft.
- Existing trimmed NFC 1–60 Unicode-point name rules, including hostile-character rejection. Same normalized name succeeds without writing/notifying mutation analytics. Duplicate names allowed; reference identity remains fragment. Rename succeeds at ten entries and changes only name at the same position; same v1 envelope/key/fragment order, no migration or stored values/provenance.
- Capture immutable snapshot and raw hash at opening. Read latest bytes before mutation, require exact snapshot identity and existing canonical fragment. Changed/removed/reset/reordered data rejects obsolete intent with no write/resurrection. Guard current hash/screen synchronously, including a navigation in the same event loop; disabled demo uses captured hash, not assumed `#saved`. No automatic retry. localStorage remains last-writer, not cross-tab transactional storage.
- Minimal private replace-prepared operation rejects changed key and preserves an unrelated local deletion undo. External state changes invalidate undo/reset/form authority as before. Saved-search API/bytes, favorites, opening/reloading comparisons and all provenance rules unchanged.
- Session/quota/denied updates stay memory-only with explicit copy; corrupt/future/unhydrated states are read-only and preserve bytes. Offline and disabled-demo local rename cause no API request, clipboard operation, search or detail reread. Initial/editing/invalid/success/cancel/stale/readonly/session states intentional; no network loading state is invented for a local action.
- One closed no-op `saved_comparison_renamed` event, only `screen:saved` and `outcome:success`, only for a changed successful name. Exact three-field envelope, no names/IDs/fragments or collector. Existing failure event unchanged.

## Test strategy and quality gates

Unit: exact bytes/order/key isolation, immutable/no-op snapshots, full collection, Unicode rejection, local undo preservation, cross-tab events and unseen writes, missing/stale/readonly/future/corrupt cases, quota/denied/session, unchanged saved-search regression corpus. Browser: edit/save/reload/cancel/Escape, one editor, navigation/storage races, disappearing/reordered target focus, offline/disabled no requests, unchanged open/load/remove/undo.

Both Chromium/WebKit: 320/390/768/1440, light/dark, 200% platform/Verdana text, reduced motion, keyboard/focus/44px/axe WCAG2.2AA/no overflow and actual pixels. Local rename feedback <=100ms in five Chromium4x CPU samples. Existing full suite/budgets retained.

Pinned frozen install, lint/typecheck/root and workspace tests/build/secrets/dependency audit, nonzero task counts; independent code/architecture/pixel approvals; exact-source Linux CI and protected-main acceptance before Done. Evidence in [validation](../../docs/validation/TASK-0118.md). No subsequent product task until accepted.

## Operational boundary and rollback

Local preference only, not vehicle identity/history or authenticated provenance. No backend, source, infrastructure, workflow, dependency or account change. Other chat owns infrastructure and shared ROADMAP/DELIVERY; this focused task/PR checkpoint owns status. Revert increment without deleting v1 data; renamed names remain backward-readable. No migration or production activation.
