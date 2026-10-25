# Web/API runtime security maintenance — 2026-10-22

Status: LOCAL_VALIDATED / DELIVERY_PENDING. Prerequisite maintenance for TASK-0114; not a new roadmap feature or infrastructure admission. This source snapshot deliberately does not anticipate exact-head/main CI; the final PR delivery checkpoint governs acceptance.

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

Implementation matches the ten-path plan committed as `e36f70c` before edits. Frozen installation passes; dependency audit reports zero known vulnerabilities. The inspected lockfile diff changes only Next, its @next environment/platform SWC packages and Fastify, preserving the remaining dependency graph.

Fresh pinned-toolchain gates pass without Turbo cache hits: lint14/14, typecheck21/21, tests28/28 and build14/14 tasks. Root harness2015 cases:1571 passed,444 existing platform/infra exclusions,zero failures. Web93/93 and API50/50 pass, including real HTTP/socket/deadline cases. Secretlint passes1046 repository files; whitespace check passes. No exclusion or assertion was weakened. Logs under ignored `.omx/validation/runtime-security-2026-10-22/` include frozen-install.log, lint.log, typecheck.log, test.log, build.log, secrets-check.log and audit.log; baseline-audit-failed.log preserves the original four-advisory failure.

Independent implementation architecture review CLEAR and separate code/spec/security APPROVE, zero open findings. An interim stale documentation status was corrected during review; no production correction was needed. A dedicated LSP surface was unavailable, so fresh full lint/typecheck supply static diagnostics.

Independent actual-pixel review APPROVE on Windows Chromium and WebKit under Next16.4.2. Fifteen Chromium and four WebKit baseline/new pairs were inspected across320/390/768/1440, light/dark, comparison first/last columns, details/history, results, saved content, filters and enlarged text. No visual regression was observed; timestamp changes reflect later fixture reads. This is not Linux pixel approval or TASK0114 page acceptance. Captures remain in screenshots-windows.

Full Windows production-build browser regression:361 passed,7 pre-existing exclusions,zero failures/retries,6.6min. No test source was changed. The real synthetic loopback API sample is50 requests/p95=30.85ms (budget500ms); the Chromium mobile4xCPU lab records LCP p75=476ms,CLS=0 and Event Timing p75=24ms. These are bounded local measurements, not production scale/INP guarantees. Exact log browser-windows.log and seven JSON measurement files remain with the screenshots. Only this final evidence document changed after the successful runtime tests; exact-head Linux CI and protected main/main CI remain required.
