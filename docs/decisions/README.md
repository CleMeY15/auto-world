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

## Plans under implementation

- [ADR-0017 — Synthetic vehicle taxonomy V1](ADR-0017-vehicle-taxonomy-v1.md): TASK-0008 in progress; bounded synthetic make/model releases and declared-version lookup, not real automotive truth or authenticated lineage.

- [ADR-0014 — Loopback synthetic search API V1](ADR-0014-demo-search-api.md): TASK-0102 including real HTTP correction delivered in PR153/main52fdbefc, exact final-head/main CI successful; original PR150 evidence preserved.

- [ADR-0015 — Traceable gosu compiler derivative](ADR-0015-gosu-compiler-derivative.md): sources delivered through PR151/main2790d79 and owned-cache cleanup PR154/main9e322643 with identical reviewed trees and successful final/main CI. Actual preparation38192612138 and38194957502 failed before upload with zero uploaded artifacts; preparation/admission/support remain unaccepted. Exact Go cache-info source repair PR155 is DONE_ON_MAIN through main59e5b157, identical reviewed tree35c4dd78 and final CI38198975540/main CI38199524012 SUCCESS. Closed command diagnostics PR156 are DONE_ON_MAIN at main db14fb5205ea5bd3d3ac77b4cfe3dc7ae79eff69 with reviewed tree516745ed and final/main CI SUCCESS. Distinct actual38200213629 and38204301387 failed before upload; fourth run reports gosu_offline_network_invalid. Isolated-sysfs/zero-route PR157 is SOURCE_DONE_ON_MAIN at0de96a31 with identical reviewed tree9c50debc, final CI38207655246/main CI38208429396 SUCCESS and independent delivery PASS/CLEAR. Actual5 38209201492 failed at build-info before upload with zero artifacts. The focused trimpath build-info source is implemented with compiler serialization diagnostic PASS, independent source/security/evidence CLEAR and full local gates PASS; final60-source closure and CI/main delivery remain pending. Actual preparation/admission/support remain unaccepted.

- [ADR-0016 — Synthetic web flow](ADR-0016-synthetic-web-flow.md): DONE_ON_MAIN in PR152/maincf71211d with identical reviewed tree10b9c94f, final CI38196985003/main CI38197621255 SUCCESS; data/proxy CLEAR, revision3 UX APPROVE and renewed actual API/performance CLEAR. Synthetic scope only. A [focused navigation contrast follow-up](../../roadmap/plans/TASK-0103-navigation-contrast.md) has independent pre-edit/source/visual/performance/evidence CLEAR and meaningful real-browser RED;65 clean full-browser passes/five existing exclusions. Final-head CI/main delivery remain pending.
