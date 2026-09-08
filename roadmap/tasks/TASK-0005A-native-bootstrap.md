# TASK-0005A — Native image-chain bootstrap

Status: IN_PROGRESS — secret-free preparation; privileged activation BLOCKED
Priority: P0
Owner: Platform/SRE executor; independent code/security and Architect reviewers

## Goal and dependencies

Prepare auditable native image tooling and dormant installation from TASK-0001 through TASK-0004 accepted main `b9d22a2`. TASK-0005 owns this explicitly split epic: preparation/install PR, future custody/activation checkpoints, then existing service PR #7 as 5B. A dormant merge does not complete 5A.

## Scope and contracts

Follow [ADR-0005](../../docs/decisions/ADR-0005-native-image-chain-bootstrap.md), architecture/data/security contracts and Definition of Done. Standalone Node built-in validators, source/module/test material locks, ORAS/Cosign/Trivy native builds, subject-bound audits, exact duplicate-build reproduction, hostile OCI/receipt/archive tests, disposable signature airgap proof and capability-free workflow. No source/service activation or registry/custody operation is in current executable scope.

## Acceptance criteria

1. Complete locked source/compiler/module ZIP/test fixture/patch/recipe closure; two fresh builds produce identical native executables. Applicable upstream tests pass, including Cosign sign/verify bypass regression and Trivy locked Mage/Git/RPM/WASM prerequisites.
2. Strict data-only JSON/material/OCI/audit/proposal validation rejects duplicate keys, malformed bytes, identity/run/workflow substitution, unknown fields, path traversal, links/devices, extra/missing/orphan blobs and all ADR resource-limit violations. A canonical `infra/supply-chain/native-admission.json` must bind the complete actual preparation evidence and distinct code/security and architecture reviews before dormant merge; its only state is `reviewed_admission_proposal`, activation blocked and capabilities empty.
3. Exact native Trivy scans itself and all outputs with nonempty expected inventory, fresh vulnerability/Java database byte identities and unchanged CRITICAL/HIGH gate. Pinned vulnerable Go and Java fixtures produce expected findings; a clean fixture passes; baseline diagnostic inventory/detection comparison is explained.
4. Disposable signature valid/wrong-key/tamper/revoked-copy cases pass in a real network-disabled Linux namespace. No private key persists in Git, artifacts, cache or logs.
5. Actual dormant workflow has only necessary contents-read, pinned actions and persist-credentials:false; zero signing secrets/environments/package-write/id-token/registry auth or publisher dispatch. Activation always refuses, including hostile metadata or pretend enable flags. Static tests prove the reviewed workflow, not a global server permission ceiling.
6. Forced nonzero root gates, secrets/dependency/static checks, fresh HTTPS clone, independent code/security and Architect review of the same final source/material identity and final-head CI all pass before dormant installation merge. Verify main and record merged_pending_activation, keeping parent tasks incomplete.

## Test strategy and stop condition

Use unit/contract hostile fixtures for strict parsers and policy; real separate secret-free Linux jobs for material resolution, native build/upstream tests, reproduction, scanner and network-disabled signature tests. Compilation, mocked audits, proxy refusal or prior CI cannot satisfy native acceptance. Record fixed safe phase/status/error telemetry and every timeout, skip and unresolved prerequisite.

Keep PR draft on an unclosed lock, unprepared required upstream suite, unequal builds, unresolved native audit, missing scanner detection, capability leak, failed review or CI. Fix within reviewed scope; further native dependency correction requires exact-diff independent review. Do not weaken gates to merge.

## Future activation — blocked

Main protection and repository ruleset APIs return 403 requiring Pro/public; neither change is authorized. A new reviewed plan must establish server publication/main protection before environment canary, durable custody, separate public-key/admission PR, actual private registry activation and receipt/status PR. Only accepted activation makes 5A DONE and unlocks 5B.

Evidence and operational/rollback notes: [TASK-0005A validation](../../docs/validation/TASK-0005A.md), ADR-0005. User-facing UI and data migrations are not part of this preparation.
