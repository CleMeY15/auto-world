# TASK-0103 implementation plan

Status: DONE_ON_MAIN in [PR152](https://github.com/CleMeY15/auto-world/pull/152); final CI38196985003/main CI38197621255 SUCCESS, identical reviewed merge tree. Data/proxy CLEAR, revision3 UX APPROVE and actual API/mobile lab performance PASS/CLEAR. Synthetic scope only; historical checkpoints below remain preserved.

1. Freeze proxy/local favorite/navigation/privacy/disabled-flag contract in ADR0016; obtain architecture/security and UX plan review before coupling web/API DTOs.
2. Data/proxy owner: typed pure query/response/favorite/analytics helpers, fixed-loopback Route Handlers, server flag, hostile unit tests and separate test compilation. No UI/fixture/SDK imports in proxy.
3. Frontend/UX owner: `/demo` server shell/client flow, shared primitives/tokens/local neutral illustration, filter/result/detail/evidence/Saved/recovery states, hash/context/focus handling and honest persistence. Own new presentation files; coordinate with public helper types.
4. Root: manifests/lock/scripts, Playwright three-server composition including mandatory flag-disabled recovery, production trace boundaries/preview preservation, root gates, actual browser/viewport/performance evidence, independent implementation reviews and delivery docs.
5. Commit exact reviewed increment; final-head CI, identical reviewed merge and main CI precede Done. Supported data/search/application tasks retain dependencies.

Evidence: real whole-flow E2E through separate SDK-backed API; labeled UI-only fault mocks; favorite reload/offline/remove/undo and denied/corrupt/future mutants; editable unsupported free text; provenance/withdrawal/contradictions/privacy negatives; light/dark four viewport screenshots/a11y/perf samples. Rollback disables server flag while local favorites remain recoverable.

Architecture closure: discard synthesized/hostile Forwarded headers, use strict loopback Host for origin checks, define exact closed local HTTP errors/request IDs and explicit methods, await API port3210, implement all cursor pages without duplication/snapshot mixing/late writes, and cap active Saved detail concurrency at4. Dedicated mutants cover these boundaries.

## Final delivery acceptance, 2026-10-12

PR152 is DONE_ON_MAIN for the labeled synthetic web increment. Independently reviewed source df88df7aa2f50970012897f5247df9e01d4deed8 and merge/main cf71211d36e4ca49d6c6d88254eeca91d0517904 have identical tree10b9c94f91f9de681ea47cd7a1889f8ef7614a51. Final CI38196985003 and protected-main CI38197621255 are SUCCESS. Main raw log1413266bytes/SHA2561301cf97079f772d63255762d8301885d9370f2423516fdddbb204c2ab919e2d and metadata3368bytes/SHA2565e8edc761dce46ec831a5149907fa28a21f3fbdf47134fd42baaa13257a9632e are preserved CNEW. Independent final delivery review is PASS/CLEAR. Main confirms1933 rootPASS/zero failures/56 existing platform exclusions,24 workspace test tasks,22 web/38 API/159 SDK tests,lint12/types18/build12,49 browserPASS/5 existing intentional exclusions,secrets876 andaudit0. Historical rejections remain preserved. Supported tasks0104-0106 remain blocked by TASK0005; no real-source or supported-service admission follows.
