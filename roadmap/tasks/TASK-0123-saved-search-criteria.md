# TASK-0123 — Lire les critères enregistrés à la demande

Status: IN_PROGRESS, 2026-11-09. Priority P1, isolated synthetic V1 lane. Owner: application lead; independent test and review lanes. Definition of Ready satisfied below. Direct bounded implementation: existing native disclosure pattern, no architectural contract change.

Checkpoint: LOCAL_VALIDATED / DELIVERY_PENDING. Fresh pinned Linux quality gates and634 browser cases pass (10 existing exclusions,0 failures/retries); independent code and20-image actual-pixel reviews APPROVE. Exact final-source/main quality and persistent acceptance still required; [evidence](../../docs/validation/TASK-0123.md).

## Goal, dependency and scope

Make Mes listes easier to scan without losing exact saved-search criteria. TASK-0122 is DONE_FOR_V1_PROTOTYPE on main `43d3943dced0dc249fba0df49c5749426912e080`, [accepted PR233 checkpoint](https://github.com/CleMeY15/auto-world/pull/233#issuecomment-6740879403). Source/main quality and persistent workflows all pass;608 browser cases pass with10 existing exclusions. This task starts only after that acceptance.

Reuse `SavedSearchesSection`, unchanged `SearchCriteriaSummary`, native details/summary already used for history, and existing semantic tokens. No new dependency, backend, storage/schema, analytics collector, navigation, source right or infrastructure change. Contracts: [DESIGN](../../DESIGN.md), [PRODUCT_UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), architecture, Strategic Moats, Vehicle Intelligence and ADR-0028. Displayed local query criteria are not verified vehicle facts.

## Flow and acceptance

- Mes listes initially shows each saved name, a native Voir les critères disclosure and the existing Charger/Renommer/Supprimer actions. Exact criteria remain in the existing semantic definition list, initially collapsed. Results/shared-search summaries are unchanged.
- Enter, Space or pointer opens/closes one row independently. The summary keeps focus and has a44px target, visible focus and a contextual accessible name containing the visible label and saved name. No custom accordion/state controller or animation.
- Every existing criterion and exact representation remains available when opened; catalogue labels remain compatibility-gated. Pending catalogue and unavailable-identity warnings remain visible outside the disclosure. Read-only/session/disabled/offline states retain their explanations; inspection itself is never disabled or a network operation.
- Toggling never writes storage, changes query/draft/undo, searches, copies, navigates or emits a mutation event. Load still only fills the form until explicit Rechercher. Rename stays outside the disclosure and preserves an open same-key row. Existing key identity keeps the correct row open after reorder; new/replaced criteria, navigation/unmount and reload start collapsed. No persisted display preference.
- Preserve all load/rename/delete/undo/reset and independent-list behavior. No new skip, weakened assertion or relaxed quality threshold.

## Plan and test strategy

1. Add the small native wrapper in saved rows; extend existing disclosure selector styling, without changing the shared criteria renderer or controller/store.
2. Test default/expanded exact content, keyboard/focus/independence, no side effects, warnings/catalogue states, disabled/offline/read-only inspection, rename/reorder/navigation/reload identity and existing load/delete regressions. Extend the real persistent journey to inspect collapsed/open saved criteria before loading, including restart/outage paths.
3. Verify320/390/768/1440 light/dark,200% platform/Verdana, reduced motion, axe WCAG2.2AA,44px targets, no overflow and actual screenshots. Five local toggle feedback samples≤100ms per engine; Chromium4xCPU and separate WebKit baseline. Independent code and actual-pixel review.
4. Run pinned frozen Linux lint/typecheck/tests/build, full browsers, secrets and dependency audit. Open focused PR with plan/evidence, require exact-source quality/persistent workflows, normal protected merge and both main workflows, then independent final delivery acceptance.

## States, operations and rollback

No new loading/error state: disclosure is synchronous local inspection; existing catalogue/storage states remain visible. Existing empty state has no empty disclosure. No additional analytics event for inspecting existing content, consistent with native history disclosure; accepted mutation events are unchanged. Rollback removes only the presentation wrapper/styles, leaving all saved data unchanged. TASK-0005/PR230 remains owned by the other chat. No public deployment, real data or production image qualification. [Evidence](../../docs/validation/TASK-0123.md).
