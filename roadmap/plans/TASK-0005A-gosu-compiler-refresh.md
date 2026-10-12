# TASK-0005A — gosu compiler refresh preparation

Status: plan revision4 independently approved; source implementation revision5 independently CLEAR. Source delivery and actual build acceptance remain pending. Priority P0. Owner: source/build executor; independent architecture and supply-chain/security review.

Goal: close the demonstrated Go1.26.8 compiler blocker through a traceable Auto World gosu1.19/Go1.26.9 preparation. Dependencies: delivered scanner security PR149/main969df, authenticated failed actual audit38181226203 and accepted ADR-0007/0011 boundaries. [ADR-0015](../../docs/decisions/ADR-0015-gosu-compiler-derivative.md) defines the new preparation receipt and future phase separation.

Scope: new locked public materials, ordinary-user Linux/amd64 build preparer, closed controls/SBOM/license evidence, hostile-input/material tests and a manually dispatched two-independent-build comparison. The sole existing-file integration is the additive diagnosticOnly classification for gosu-derivative-build-v1.mjs in infra/postgres-image/admission-consumers.json; it grants no authority and changes no execution pin. Current recipes, policies, inventories and Native duties stay historical; later publication/admission require separate accepted evidence.

Acceptance: exact source/compiler/module bytes and selected texts verified; offline compilation/test phase; actual build info and no fake VCS/APK identity; complete deterministic evidence/strict controls; two actual independent builds compared on reviewed main; no image/registry/Native effect; rollback/retention documented; targeted and root lint/types/tests/build/browser/secrets/dependency gates plus independent architecture/security review pass. Source delivery and actual build acceptance are reported separately.

Test strategy: reject material size/hash/source/tree/license/module/toolchain/flags/unknown-field substitution, occupied/symlink targets, source mutation, dishonest receipts and mismatched build pairs; prove private error/path redaction and PREPARATION_ONLY/NOT_AUTHORIZED/null dates. Execute real pinned Go build/tests and record their genuine counts; do not call zero discovered tests a passing test suite. Reproduction and artifact provenance must use actual original bytes and authenticated workflow/run/head identities.

Implementation is gated by the closed owned-path, archive-budget, authenticated-module, isolated-network, exact-build/test-count, allowlisted-output and main-only manual-workflow contracts in ADR-0015. Plan revision4 received independent architecture/security approval before implementation. Source review revision5 covers the same frozen preparer plus the explicitly authorized diagnostic classification and documentation; no new execution or production authority is added.

Preparation uses the existing pinned Node22.23.2 runtime only, with observed executable/helper identities and strict streaming/archive-envelope caps; no Python or system extractor dependency.
