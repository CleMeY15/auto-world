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

- [ADR-0018 — Observation-change events V1](ADR-0018-observation-change-events.md): TASK-0009 DONE_ON_MAIN at `4f750960`, identical reviewed tree `7699a448`, final CI38431216651/main CI38433291505 SUCCESS and independent delivery PASS/CLEAR. [PR162 delivery](https://github.com/CleMeY15/auto-world/pull/162#issuecomment-6150751053). Closed price/mileage representation changes only; no lifecycle, authenticated evidence or durable delivery authority.

## Plans under implementation

- [ADR-0019 — Fiscal-rule versioning readiness](ADR-0019-fiscal-rule-versioning-readiness.md): TASK-0010 documentation-only readiness gate. No fiscal API/schema, official dataset, calculator or runtime implementation; future consumer/source/time decisions remain required before executable work is READY.

- [ADR-0014 — Loopback synthetic search API V1](ADR-0014-demo-search-api.md): TASK-0102 including real HTTP correction delivered in PR153/main52fdbefc, exact final-head/main CI successful; original PR150 evidence preserved.

- [ADR-0015 — Traceable gosu compiler derivative](ADR-0015-gosu-compiler-derivative.md): source through PR160 SOURCE_DONE_ON_MAIN at b4675d5d, exact final/main CI and independently accepted delivery. Seven distinct actual preparations failed before upload; internal cause of actual7 remains unknown. [Closed child failure diagnostics](../../roadmap/plans/TASK-0005A-gosu-child-failure-diagnostics.md) has independent plan CLEAR_APPROVE and frozen baseline; implementation/source-security review and targeted80-test checks pass; all six repository gates and65 browser first passes succeed; final source delivery pending. Historical originals retained without retry/redownload; no preparation/admission/support authority.

- [ADR-0016 — Synthetic web flow](ADR-0016-synthetic-web-flow.md): DONE_ON_MAIN in PR152/maincf71211d with identical reviewed tree10b9c94f, final CI38196985003/main CI38197621255 SUCCESS; data/proxy CLEAR, revision3 UX APPROVE and renewed actual API/performance CLEAR. Synthetic scope only. A [focused navigation contrast follow-up](../../roadmap/plans/TASK-0103-navigation-contrast.md) has independent pre-edit/source/visual/performance/evidence CLEAR and meaningful real-browser RED;65 clean full-browser passes/five existing exclusions. PR159 is SOURCE_DONE_ON_MAIN at identical reviewed merge931d1e5aa14a1a584d6098abb98619730d6bfd24/treee2877f3147f920839ac5cd21db2054656c91a82c; final CI38217311084 and protected-main CI38219609231 attempt2 SUCCESS, independent delivery PASS/CLEAR. Both pass all18 steps and65 browser tests without retries/five existing exclusions; cancelled dependency-install attempt1 remains retained.

- ADR-0015 offline-phase continuation: [closed local phase diagnostics](../../roadmap/plans/TASK-0005A-gosu-offline-phase-diagnostics.md) and [validation](../validation/TASK-0005A-gosu-offline-phase-diagnostics.md), following accepted PR163 and independently reviewed distinct actual8 failure. Source increment in review; no preparation/admission authority.


### Gosu online SumDB cache prerequisites

PR166 has a reviewed local source increment with192targeted tests and complete local gates; [validation](../validation/TASK-0005A-gosu-sumdb-cache.md) records preservation and independent CLEAR_APPROVE. Final source/main delivery and actual10 preparation are still separate, with no admission/support authority.

ADR-0015 has a focused [approved implementation plan](../../roadmap/plans/TASK-0005A-gosu-sumdb-cache.md) and [validation record](../validation/TASK-0005A-gosu-sumdb-cache.md) for standard Go-generated checksum-database state before isolation. It preserves source originals, existing offline behavior and PREPARATION_ONLY authority; source implementation/delivery and a distinct actual10 remain separate gates.
# Gosu authenticated public-license checkpoint, 2026-10-14

[ADR-0015](ADR-0015-gosu-compiler-derivative.md) records the six exact authenticated LICENSE/PATENTS boundary under TASK0005A. Targeted and full local source validation pass; final source/main delivery remains pending in [the validation record](../validation/TASK-0005A-gosu-public-license.md). TASK0005A/0005 remain incomplete and supported TASK0104 remains blocked.

# Actual reproducible Gosu preparation checkpoint, 2026-10-14

PR167 source delivery is SOURCE_DONE_ON_MAIN at d7bc2412104839e0be67ee97171d281b50465ccc. [Actual11](../validation/TASK-0005A-gosu-actual-preparation.md) has independent PASS_CLEAR for two authenticated retained trees and their exact canonical comparison: REPRODUCIBLE_SOURCE_PREPARATION_ONLY. The candidate lock/recipe/delta, publication, security/runtime/restore/attestation/retention and admission gates remain separate. TASK0005A/0005 stay IN_PROGRESS; supported TASK0104 stays BLOCKED.


ADR-0015 candidate continuation: [source plan](../../roadmap/plans/TASK-0005A-gosu-derivative-candidate-source.md) and [validation](../validation/TASK-0005A-gosu-derivative-candidate-source.md) define unused V2 same-path/unchanged-APK candidate predicates after accepted PR168 preparation. Actual image, publication, runtime, admission and support remain separate.


ADR-0015 context-source continuation: [PR170 plan](../../roadmap/plans/TASK-0005A-gosu-derivative-context-source.md) and [validation](../validation/TASK-0005A-gosu-derivative-context-source.md) define the fixed-root fifteen-entry private TAR operator. PR169 is SOURCE_DONE_ON_MAIN; B0 source delivery and the distinct actual private operation remain separate gates.


ADR-0015 checkpoint2026-10-15: PR170 source and the separately reviewed private context are accepted within their limited scopes. The [isolated Gosu image-format observation plan](../../roadmap/plans/TASK-0005A-gosu-image-build-observation.md) requires a new source-first B1a lease/client and one private diagnostic before B1b closes the observed format. Existing image/admission/support/Native boundaries and V1 contracts remain unchanged.
