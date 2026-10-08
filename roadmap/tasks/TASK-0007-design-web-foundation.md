# TASK-0007 — Minimal shared design and web foundation

Status: IN_PROGRESS on `codex/task-0007-web-foundation`; TASK-0006 is accepted on `main` through PR #146. Priority: P0. Owner: Frontend/UX executor; independent accessibility and architecture review.

## Goal and dependencies

Provide the smallest reusable semantic design tokens/components and a supported responsive web runtime so one synthetic Search → Results → Listing detail → Saved flow can be built without ad-hoc styling. Depends on TASK-0006 accepted plan and [DESIGN.md](../../DESIGN.md); does not depend on TASK-0005 or authorize a data service.

## Relevant contracts and scope

[UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [P1 plan](../plans/TASK-0006-synthetic-first-slice.md), [ADR-0012](../../docs/decisions/ADR-0012-synthetic-development-lane.md), `ROADMAP.md` target Next.js/TypeScript. Introduce one `packages/design-system` boundary with semantic light/dark color, typography, spacing, radius, focus, motion and responsive tokens; basic accessible field/button/chip/card/skeleton/banner primitives and documented states. Turn `apps/web` placeholder into a minimal Next.js/React app using the roadmap reference stack, with exact reviewed dependency versions and no unrelated UI framework. No data source, real screen content, external media, network fetch or Docker. Preserve a production build free of synthetic fixture imports.

## User flow and required UI states

The scaffold demonstrates focus/keyboard/touch interactions and light/dark/reduced-motion variants, not completed Search or Results. Primitives support loading, disabled, error, empty and success; later tasks own offline, partial and full user flows. At 320 px, 390×844, 768×1024 and 1440×900, no overflow or layout shift is accepted.

## Acceptance and test strategy

- Shared tokens/components are reusable from web without duplicated constants; no global CSS rule silently changes unrelated packages.
- Keyboard focus is visible and ordered; controls are semantically labelled, ≥44×44 CSS px for touch, and token contrasts meet WCAG 2.2 AA in light/dark themes.
- Reduced motion disables nonessential transitions; skeletons reserve geometry.
- Product/UX independently signs off the concrete warm-ivory/graphite/petrol light/dark palette, intentional named platform-face hierarchy from DESIGN.md, local line icons and phone/desktop screenshots before Done; an accessible but generic token scaffold fails the premium gate. If the platform-face choice looks generic in context, this task must resolve it with a separately reviewed self-hosted/licensed face before completion.
- Unit/component accessibility checks, responsive screenshot matrix, production-build import exclusion, lint/typecheck/tests/build, secrets/dependency audit and independent visual/a11y review pass.
- Document framework/dependency choice, operational footprint, rollback by focused revert and evidence in `docs/validation/TASK-0007.md`. No claim of a completed product screen.

Implementation and validation: [TASK-0007 evidence](../../docs/validation/TASK-0007.md), [QA inventory](../../docs/validation/TASK-0007-QA-INVENTORY.md). Downstream TASK-0101 remains blocked until this task is accepted on `main`.
