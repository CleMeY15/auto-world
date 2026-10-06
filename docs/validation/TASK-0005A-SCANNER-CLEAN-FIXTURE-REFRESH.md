# TASK-0005A — Refresh the scanner clean Java control

Status: PLAN, 2026-10-06. Scope: diagnostic scanner test data only. TASK-0005A/0005 remain IN_PROGRESS; TASK-0006 remains blocked.

The first [current PostgreSQL audit](https://github.com/CleMeY15/auto-world/actions/runs/37533250411), on reviewed protected-main recipe `e0a9495df7dd8d46ef5b3c737705036619ffb950`, passed both scanner builds and failed at SCANNER_CONTROLS with `scanner_clean_fixture_has_findings`. Its Jackson-core2.18.8 control report contains HIGH CVE-2026-89407 and CVE-2026-89425, both reporting2.18.11 as a fixed version. Neither PostgreSQL report ran. Cleanup and raw evidence upload passed; no current-audit projection was published.

The retained fourteen-file raw ZIP is1547219bytes, SHA256 `25d80270596c499e0c40cd6b56196ccb4f130b7b5c348c61a0393b09527452da`, matching the GitHub artifact11446530360 digest. The failure remains historical evidence and does not establish a PostgreSQL vulnerability result.

## Implementation plan

1. Verify the two fixes against FasterXML's official advisories and the same release branch. Acquire the exact Maven Central2.18.11 JAR, verify publisher checksum, embedded Maven coordinates and retained LICENSE/NOTICE, then record length and SHA256.
2. Replace only the clean Java fixture and its fixture-manifest/scanner-lock identities. Keep vulnerable Go/WAR controls, scanner source/compiler/patches, database freshness, all image pins and the zero-finding gate unchanged. This file is external test data, never an application runtime dependency.
3. Update the fixture-specific test assertions and prove that a finding still rejects and that substituted package/version/materials reject. Check that the immutable PostgreSQL generation2 execution closure remains byte-identical.
4. Run affected tests and fresh full lint/typecheck/tests/build/secrets/dependency checks. Obtain independent review, passing exact-head CI, an unchanged reviewed merge tree and passing main CI.
5. Dispatch a new run of the current-audit workflow on that reviewed main. Validate and retain the actual raw reports, including failures; conclude current eligibility only from a complete production-validated zero-blocker audit and its published projection. Do not rerun a retired producer or modify retained scanner bytes.

## Operational boundary and rollback

This changes neither publication rights nor image admission, support dates, archives or scheduled production tasks. Restoring the prior fixture is a source rollback and restores its known scanner-control failure; it cannot authorize an image. Any new finding blocks the new audit. Package Settings and the other admission prerequisites remain independent.
