# Web/API runtime security maintenance — 2026-10-22

Status: PLAN_APPROVED / IMPLEMENTATION_PENDING. Prerequisite maintenance for TASK-0114; not a new roadmap feature or infrastructure admission.

## Goal, boundaries and implementation plan

Clear four advisories discovered by the existing mandatory dependency gate on accepted main81e9aee, without changing application behavior, protocols, infrastructure, CI policy or adding a dependency. The product branch `codex/task-0114-official-registration-guide` remains preserved separately. The other chat owns the Gosu infrastructure controller; no files in that lane are modified here.

Owner: application lead. Independent dependency expert recommends exact Next16.4.2/Fastify5.12.7; sequential Architect APPROVE then distinct Critic OKAY received before implementation. Planning terminates and hands off to lead-owned execution. Next16.3→16.4 is a same-major minor upgrade, not merely a patch; its full browser/CSS verification is required. Dedicated branch `codex/runtime-security-oct22`, focused prerequisite PR.

1. Update only existing exact runtime pins: apps/web/package.json Next16.3.8→16.4.2 and services/api/package.json Fastify5.12.5→5.12.7; regenerate pnpm-lock.yaml with pinned Node22.23.2/pnpm10.15.0. Inspect the lockfile diff for unrelated churn; no blanket update/audit-fix.
2. Keep exact Fastify assertions strict in services/api/scripts/verify-production-build.mjs and tests/workspace-contract.test.mjs, replacing only the expected version. Update the current runtime description in services/api/README.md and DESIGN.md. Add dated supersession notes to ADR0014/ADR0016, preserving their original selection and historical validation.
3. Verify frozen installation, all root lint/typecheck/test/build/secrets/audit gates, existing real-HTTP API tests and the complete Chromium/WebKit browser suite. Retain actual pixels at mobile/desktop and review them independently: Next16.4 changes Turbopack/CSS behavior. No exclusions, budgets or CI gates may be weakened.
4. Independently review source/lockfile and final evidence; open the focused PR, require exact-head Linux CI and protected main/main-CI acceptance before incorporating it into TASK0114. Recheck current main/peer state before any merge; a conflicting file or baseline stops integration for resolution, never overwrites peer work.

Owned paths: the two manifests, lockfile, two existing assertion files, current README/DESIGN, dated notes in docs/decisions/ADR-0014-demo-search-api.md and docs/decisions/ADR-0016-synthetic-web-flow.md, plus this validation record. No ROADMAP/DELIVERY or infra edit.

## Upstream evidence and selection

Checked2026-10-22 by the dependency expert:
- Next's [image RCE](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [cache RCE](https://github.com/advisories/GHSA-673q-mjm6-r5xr) and [Server Actions DoS](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) require at least16.4.1. [16.4.2](https://github.com/vercel/next.js/releases/tag/v16.4.2) adds subsequent maintenance fixes. Node≥20.9 and React19 peers accept the pinned toolchain/React19.3.0; [16.4 release context](https://nextjs.org/blog/next-16-4).
- [Fastify header validation advisory](https://github.com/advisories/GHSA-389g-gv7q-r4x8) requires at least5.12.6. [5.12.7](https://github.com/fastify/fastify/releases/tag/v5.12.7) corrects the internal version constant left at5.12.5 in5.12.6. V5 supports Node22. Both runtime licenses remain MIT.

Alternative: select minimum16.4.1/5.12.6; rejected because later patch fixes are available and5.12.6 misreports its internal version. Alternative: suppress the audit or add unrelated upgrades; rejected because neither is necessary or an acceptable gate repair. No framework migration or new feature activation.

## Risks, validation and rollback

Primary risk is a runtime/CSS regression. Full existing API/browser contracts and fresh pixel review must pass; tests must not be weakened to accept drift. Second risk is lockfile collateral churn: inspect exact package changes and require frozen installation. Third risk is parallel integration: preserve both branch histories, compare owned paths and serialize main acceptance.

Rollback removes this maintenance change only if the resulting runtime is independently safe; do not redeploy known-vulnerable versions merely to remove a cosmetic regression. Disable affected preview/runtime and forward-fix if security and compatibility conflict. No persisted-data migration or new operational workflow applies.

## Results

Implementation, local gates, independent implementation review, exact-head CI and main delivery pending. The original product-lane audit failure remains retained under its ignored .omx/validation/task-0114/audit.log, not rewritten as success.
