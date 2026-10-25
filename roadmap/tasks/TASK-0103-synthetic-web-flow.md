# TASK-0103 — Premium synthetic Search → Results → Listing → Saved web flow

Status: DONE_ON_MAIN in [PR152](https://github.com/CleMeY15/auto-world/pull/152); final CI38196985003/main CI38197621255 SUCCESS, identical reviewed merge tree. Data/proxy CLEAR, revision3 UX APPROVE and actual API/mobile lab performance PASS/CLEAR. Synthetic scope only; historical checkpoints below remain preserved.

## Goal and dependencies

Ship one complete, honest mobile-first web flow over the versioned synthetic API. Depends on TASK-0007 design-system foundation and TASK-0102 accepted on `main`. A local favorite is not an account or a production inventory promise.

## Relevant contracts and scope

[DESIGN.md](../../DESIGN.md), [UX](../../docs/PRODUCT_UX.md), [DoD](../../docs/DEFINITION_OF_DONE.md), [P1 plan](../plans/TASK-0006-synthetic-first-slice.md), [ADR-0012](../../docs/decisions/ADR-0012-synthetic-development-lane.md), TASK-0102 public DTO. Use shared tokens/components for Search, Results, synthetic Listing detail/evidence rail and Saved. Persistent “entirely synthetic/no vehicle for sale” disclosure, local illustration and no seller CTA. Show observed price/mileage with sanitized public provenance, contradictions and withdrawn history; omit unverified VIN, make/model/year, pricing intelligence and Trust/Deal Score. Accountless favorites use a versioned local key with storage failure/recovery and reversible removal.

## User flow and required states

Search/filter → results → detail/evidence → save → reload/reopen Saved → remove/undo → empty Saved → Search. Preserve filters/scroll on return. Cover stable skeleton/loading, no-match empty, slow, API error/retry, offline, `partial`/`stale` response envelopes, missing field, storage denied/corrupt, withdrawn, success and reduced-motion states. Partial/stale results show a non-color-only explanation and retry while preserving filters; never announce an incomplete count as complete. Offline Search/Detail preserve context and offer retry; Saved IDs remain viewable/removable with detail unavailable, not a second offline fixture search. Primary action is clear; advanced evidence and filters use progressive disclosure.

## Acceptance and test strategy

- E2E follows the whole flow including local persistence, empty Saved, observation trace, contradictory and withdrawn records. An unsupported natural-language query stays editable, reports its unsupported syntax and invents no filter or result; test this explicitly. Negative assertions prevent real seller/network CTA, VIN/score/verified-history wording and unlabeled synthetic content. Disconnect/reconnect tests prove the stated offline recovery and Saved behavior.
- At 320 px, 390×844, 768×1024 and 1440×900: inspect light/dark and all material states, attach screenshots, no overflow/CLS/jank. Keyboard-only and screen-reader path, focus return, semantic names, 44 px touch targets and WCAG 2.2 AA checks pass.
- Record search p95 from API plus representative mobile LCP p75 ≤2.5 s, lab Event Timing p75 ≤200 ms (no production INP claim), CLS p75 ≤0.1 and immediate favorite feedback target ≤100 ms; state sample/hardware/profile. No LLM is required to render results.
- Privacy-safe analytics schema is validated with no query text, raw payload or identifiers. Targeted tests, root quality/security gates, independent UX/security/performance review and `docs/validation/TASK-0103.md` evidence pass. Rollback disables the demo UI entrypoint while reading/clearing versioned local favorites safely.

## Final delivery acceptance, 2026-10-12

PR152 is DONE_ON_MAIN for the labeled synthetic web increment. Independently reviewed source df88df7aa2f50970012897f5247df9e01d4deed8 and merge/main cf71211d36e4ca49d6c6d88254eeca91d0517904 have identical tree10b9c94f91f9de681ea47cd7a1889f8ef7614a51. Final CI38196985003 and protected-main CI38197621255 are SUCCESS. Main raw log1413266bytes/SHA2561301cf97079f772d63255762d8301885d9370f2423516fdddbb204c2ab919e2d and metadata3368bytes/SHA2565e8edc761dce46ec831a5149907fa28a21f3fbdf47134fd42baaa13257a9632e are preserved CNEW. Independent final delivery review is PASS/CLEAR. Main confirms1933 rootPASS/zero failures/56 existing platform exclusions,24 workspace test tasks,22 web/38 API/159 SDK tests,lint12/types18/build12,49 browserPASS/5 existing intentional exclusions,secrets876 andaudit0. Historical rejections remain preserved. Supported tasks0104-0106 remain blocked by TASK0005; no real-source or supported-service admission follows.
