# TASK-0005A — Corrected scanner evidence

Status: IN_PROGRESS; no scanner or image admitted. Date: 2026-09-14.

The [ADR7 contract](../decisions/ADR-0007-private-image-admission.md) is accepted through PR12, merge `3d4d251a9c19a5f03fae923dc3419b8a6bc1061d`, main CI [34830801370](https://github.com/CleMeY15/auto-world/actions/runs/34830801370) PASS. This supporting increment implements only the unprivileged corrected-scanner lane.

## Implemented local report policy

`scripts/scanner/audit-policy.mjs` preserves PR10's exact repository plus manifest/platform digest binding and vulnerability thresholds, and expects the corrected scanner version `0.74.0-autoworld.2`. It rejects missing inventories, unexpected severities, future/stale reports, wrong database schemas and expired or mismatched dispositions. OS package matching includes epoch/release, matching [the pinned upstream formatter](https://github.com/aquasecurity/trivy/blob/e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994/pkg/scan/utils/utils.go).

Ten targeted Node22.23.2 tests pass. A regression based on real historical Debian/RPM report shapes failed before and passed after adding epoch/release handling. The historical files were inspected as data and remain unchanged; this does not turn them into new audits. Synthetic dispositions in tests authorize no real vulnerability exception. Static lint passed for the initial policy; final combined lint and other root gates remain required.

Report policy validates semantics only. Authenticating the scanner, binding actual subject/database bytes and establishing reviewer authority are separate required controls. A JSON report cannot prove its own authenticity or completeness.

## Selected correction, still requiring real build and audit

Trivy source: `e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994` (v0.74.0). The candidate carries the previously prepared dependency update to gRPC1.83.1 plus the minimal [upstream update to1.83.2](https://github.com/aquasecurity/trivy/commit/8c905373332df11a268a0cebc07627cc08485fee). The upstream delta changes only go.mod/go.sum. Static module comparison found its minimum Go/x/net/x/sync/x/sys/x/text/x/crypto requirements already satisfied by the selected source plus first patch; only actual readonly module checks and tests can establish build compatibility.

The historical Trivy image report identified blocking gRPC findings and a fixed version1.83.2. The current MITRE lookup did not establish a record for CVE-2026-84445; do not claim a proved CVE-to-commit mapping. Fresh full scans must establish the candidate's result.

## Gates not yet satisfied

- Actual pinned source/compiler/module/patch preparation, independent repeat builds and upstream tests.
- Built-binary identity, self inventory/SBOM and full audit; exact fresh vulnerability and Java database bytes before/after execution.
- Known-vulnerable controls and same-database diagnostic comparison with the old, non-admitted scanner.
- Fresh exact-subject service/helper image audits, with every blocking finding retained.
- Full combined repository gates, fresh remote checkout and independent implementation review, then final-head/merged-main CI.

No package write, OIDC, signing, private input, image admission, source activation, new publisher/token or resumed canary is part of this increment. Private storage/admission remains separately blocked by ADR7's concrete workflow and privacy/retention gates. TASK-0005 and TASK-0006 are not completed by local policy tests.
