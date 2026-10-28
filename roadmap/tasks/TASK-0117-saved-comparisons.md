# TASK-0117 — Retrouver une comparaison nommée

Status: LOCAL_VALIDATED_DELIVERY_PENDING, 2026-10-28. Priority P1, independent synthetic lane. Owner: application lead; independent code, architecture and visual reviewers. DoR satisfied by the contracts, dependencies, flow, states and tests below; sequential Architect APPROVE and distinct Critic APPROVE recorded before implementation. Final local gates and independent reviews pass, including 487 browser passes / 9 documented exclusions / zero retries. Exact-source Linux CI and protected-main acceptance remain mandatory; this task is not Done.

## Goal and dependencies

Save a named local shortcut to two or three publications, find it after reloading the browser and explicitly reread their current details using the existing comparison-link flow. This is not a frozen comparison or a real-vehicle identity.

TASK-0108 (saved searches), TASK-0113 (comparison links) and TASK-0116 are accepted. TASK-0116 is DONE_ON_MAIN at `1f6c2d996ee53d4e11ebfee693c7832a82490b5a`: [authoritative delivery checkpoint](https://github.com/CleMeY15/auto-world/pull/200#issuecomment-6467635030), source and main Linux CI successful, 418 browser passes / 8 documented exclusions / no retry. Older task status snapshots remain historical. This branch starts from that accepted main; TASK-0005 and TASK-0104–0106 remain separate and unadmitted.

Contracts: [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [architecture](../../docs/architecture/ARCHITECTURE.md), [Strategic Moats](../../docs/STRATEGIC_MOATS.md), [Vehicle Intelligence](../../docs/VEHICLE_INTELLIGENCE.md), ADR-0012 and ADR-0023. No shared service contract is introduced.

## Scope and acceptance

- Existing accepted comparison → inline name form → explicit save → Enregistrés / Mes listes → named row → Open → existing review → explicit Load. Received comparisons may be saved only when the complete compatible bundle is ready. Preserve the same table, per-column provenance, uncertainty and timestamps.
- Dedicated browser key `auto-world.demo.saved-comparisons.v1`; exact envelope `{schemaVersion:1, comparisons:[{name,fragment}]}`. At most 10 entries and 16,384 UTF-8 bytes. Names use existing trimmed NFC 1–60-code-point rules. Fragments must decode and equal their canonical re-encoding, contain 2–3 distinct ordered public IDs, and exclude values, labels, dates, evidence, origin and query. Duplicate identity excludes name; reversed order remains distinct.
- Reuse the private persistence mechanics with two concrete adapters. Preserve saved-search API, cached immutable snapshot identities and byte output. Do not migrate favorites, introduce a storage framework or add a dependency. Fresh pre-extraction baseline: 93/93 web unit tests passed, no exclusions.
- Hydration is read-only and SSR performs no storage access. Preserve corrupt/future bytes, refuse future reset, confirm corrupt reset against the exact observed bytes. Future-version detection precedes v1 grammar and byte limits, with bounded inspection at 65,536 UTF-8 bytes; larger unknown payloads are conservatively read-only and reset-refused, not treated as disposable corruption. Session/denied/quota states must clearly say memory-only. Independent deletion, undo, confirmed reset and cross-tab reconciliation must not touch other keys. Re-read before mutations and opening; stale state invalidates undo/confirmation/open intent.
- Opening causes no comparison-detail GET, search POST, clipboard action or local-storage mutation. Existing catalogue reads are unchanged. Only Load invokes the accepted bounded loader, with full expected-ID/fixture agreement, deadline, cancellation and late-result protection. Never show a silent subset or restore old values/search selection.
- References address the current local demo runtime; a changed fixture may return different data. Explain this before save/open. Browser storage is not account synchronization, a confidential vault or a historical record.
- Inline form is bound to its canonical fragment; selection change, navigation or loss of readiness cancels stale submission. Local comparison context may improve title/back labels but is ephemeral, never URL authority. Direct/reloaded received links retain their established behavior.
- Cover loading, empty, duplicate/full/invalid name, read-only, corrupt/future, session, offline, slow/failed/mixed reads and success. Disabled demo permits local management only and zero API requests. Global empty state considers all three collections.
- Closed no-op events for added/opened/removed/undone contain only approved event/screen/outcome values, never names, IDs, fragments or evidence. Existing comparison-load analytics and source protections remain unchanged.

## Validation and delivery

Evidence is maintained in [TASK-0117 validation](../../docs/validation/TASK-0117.md); pending gates are not acceptance.

Unit tests cover canonical/hostile/oversized input, immutable snapshots, exact old bytes/API, per-key isolation, session recovery, undo/reset and cross-tab races. Browser tests cover save/reload/open/explicit reread of changed values, local and received comparisons, stale form/navigation, failure recovery and unchanged search/favorites/link/filter behavior.

Both Chromium and WebKit: mobile/tablet/desktop at 320/390/768/1440, light/dark, 200% platform and wide-font text, reduced motion, keyboard/focus, 44px targets, axe WCAG 2.2 AA, no page overflow and actual screenshots. Measure local save/open feedback within 100ms under Chromium 4x CPU; preserve existing performance budgets. Table regression evidence can be reused while new captures focus on form/list/reopening states.

Pinned frozen install, lint, typecheck, root/workspace tests, build, secrets and dependency audit; nonzero task counts, full browser suite and independent code/architecture/pixel reviews. Exact-source Linux CI then protected-main acceptance are mandatory. Current main CI took 19m36 under its 20-minute limit; shared capacity changes belong to the other branch and must be accepted before relying on them. No test, engine, assertion or essential control may be removed.

## Isolation and rollback

No backend, shared DTO, source access, accounts, images, workflows or infrastructure change. Leave shared ROADMAP/DELIVERY to the coordinated lane; this task and its eventual delivery checkpoint govern product status. Roll back the focused increment without deleting the new browser key; existing search/favorite bytes remain usable. No next product task until this one is accepted.
