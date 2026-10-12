# TASK-0103 implementation plan

Status: SOURCE_VALIDATED / DELIVERY_PENDING, scoped by ADR-0016 v2 (architecture CLEAR, UX APPROVE) and its accepted three-server rollback amendment. Data/proxy remains CLEAR; responsive repair revision3 has independent UX APPROVE and renewed actual API/mobile lab evidence. Final-head Linux gates, identical reviewed merge and protected-main CI remain pending in PR152. One focused branch/PR; no supported service or real source.

1. Freeze proxy/local favorite/navigation/privacy/disabled-flag contract in ADR0016; obtain architecture/security and UX plan review before coupling web/API DTOs.
2. Data/proxy owner: typed pure query/response/favorite/analytics helpers, fixed-loopback Route Handlers, server flag, hostile unit tests and separate test compilation. No UI/fixture/SDK imports in proxy.
3. Frontend/UX owner: `/demo` server shell/client flow, shared primitives/tokens/local neutral illustration, filter/result/detail/evidence/Saved/recovery states, hash/context/focus handling and honest persistence. Own new presentation files; coordinate with public helper types.
4. Root: manifests/lock/scripts, Playwright three-server composition including mandatory flag-disabled recovery, production trace boundaries/preview preservation, root gates, actual browser/viewport/performance evidence, independent implementation reviews and delivery docs.
5. Commit exact reviewed increment; final-head CI, identical reviewed merge and main CI precede Done. Supported data/search/application tasks retain dependencies.

Evidence: real whole-flow E2E through separate SDK-backed API; labeled UI-only fault mocks; favorite reload/offline/remove/undo and denied/corrupt/future mutants; editable unsupported free text; provenance/withdrawal/contradictions/privacy negatives; light/dark four viewport screenshots/a11y/perf samples. Rollback disables server flag while local favorites remain recoverable.

Architecture closure: discard synthesized/hostile Forwarded headers, use strict loopback Host for origin checks, define exact closed local HTTP errors/request IDs and explicit methods, await API port3210, implement all cursor pages without duplication/snapshot mixing/late writes, and cap active Saved detail concurrency at4. Dedicated mutants cover these boundaries.
