# Architecture Decision Records
Create an ADR before introducing a cross-service contract or changing a previously frozen architectural decision. Record context, decision, alternatives, consequences and migration/rollback implications.

## Accepted decisions

- [ADR-0001 — Canonical vehicle contract](ADR-0001-canonical-vehicle-contract.md)
- [ADR-0002 — Source registry contract](ADR-0002-source-registry-contract.md)
- [ADR-0003 — Connector SDK contract](ADR-0003-connector-sdk-contract.md) and its [API appendix](ADR-0003-connector-sdk-api.md)
- [ADR-0006 — Public attestation canary](ADR-0006-public-attestation-canary.md): bounded diagnostic PASS; producer retired after 2/2 runs; no image architecture accepted
- [ADR-0007 — Private image admission with managed GitHub tooling](ADR-0007-private-image-admission.md): contract and scanner preparation accepted; activation BLOCKED

- [ADR-0008 — Bounded SeaweedFS S3 derivative profile](ADR-0008-seaweed-s3-derivative-profile.md): profile contract accepted; concrete recipe and all construction/admission gates remain pending

- [ADR-0009 — Fixed private runtime evidence descriptor handoff](ADR-0009-private-runtime-evidence-fd-handoff.md): archive transport contract accepted; implementation/native proof and full archive closure remain pending

- [ADR-0013 — Synthetic search contract V1](ADR-0013-demo-search-contract.md): TASK-0101 implementation reviewed/validated; final-head/main delivery record in PR #148. Read-port behavior remains TASK-0102.

- [ADR-0017 — Synthetic vehicle taxonomy V1](ADR-0017-vehicle-taxonomy-v1.md): TASK-0008 implementation validated by independent APPROVE/CLEAR and full Linux CI38228092035; final-head/main delivery pending in PR161. Synthetic make/model releases and declared-version lookup only, not real automotive truth or authenticated lineage.

## Plans under implementation

- [ADR-0014 — Loopback synthetic search API V1](ADR-0014-demo-search-api.md): TASK-0102 including real HTTP correction delivered in PR153/main52fdbefc, exact final-head/main CI successful; original PR150 evidence preserved.

- [ADR-0015 — Traceable gosu compiler derivative](ADR-0015-gosu-compiler-derivative.md): source increments through PR158 delivered on main7896e189 with exact reviewed tree, successful final/main CI and independent delivery PASS/CLEAR. Six actual preparations failed before upload; actual preparation/admission/support remain unaccepted. [Closed isolation diagnostics](../../roadmap/plans/TASK-0005A-gosu-isolation-diagnostics.md) implemented with targeted PASS, independent source/security/integration CLEAR and fresh integrated six-gate/browser PASS (65 first-pass successes/five existing exclusions). Historical pre-edit approval unchanged; integrated evidence audit PASS/CLEAR (282 bindings); final-source/CI/main gates pending. Historical originals retained without identical retry.

- [ADR-0016 — Synthetic web flow](ADR-0016-synthetic-web-flow.md): DONE_ON_MAIN in PR152/maincf71211d with identical reviewed tree10b9c94f, final CI38196985003/main CI38197621255 SUCCESS; data/proxy CLEAR, revision3 UX APPROVE and renewed actual API/performance CLEAR. Synthetic scope only. A [focused navigation contrast follow-up](../../roadmap/plans/TASK-0103-navigation-contrast.md) has independent pre-edit/source/visual/performance/evidence CLEAR and meaningful real-browser RED;65 clean full-browser passes/five existing exclusions. PR159 is SOURCE_DONE_ON_MAIN at identical reviewed merge931d1e5aa14a1a584d6098abb98619730d6bfd24/treee2877f3147f920839ac5cd21db2054656c91a82c; final CI38217311084 and protected-main CI38219609231 attempt2 SUCCESS, independent delivery PASS/CLEAR. Both pass all18 steps and65 browser tests without retries/five existing exclusions; cancelled dependency-install attempt1 remains retained.
