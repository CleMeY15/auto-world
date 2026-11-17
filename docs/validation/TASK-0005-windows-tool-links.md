# TASK-0005 — Windows installed-tool hardlinks

Status: LOCAL_TARGET_VALIDATED / DELIVERY_PENDING, 17 November2026.
Owner: infrastructure coordinator, branch `codex/task-0005-windows-tool-links`.
Accepted base: main548630dfc199da06c482a782a629ae168f5f518e ([PR245](https://github.com/CleMeY15/auto-world/pull/245)).
Scope, criteria and rollback: [bounded plan](../../roadmap/plans/TASK-0005-windows-tool-links.md).
Coordinator/reviewers use Codex gpt-6-astra / ultra. No UI change.

## Original failure and fresh observation

The original invocation06:13:02–06:13:04UTC exited1. Original stdout is empty;
stderr is30 bytes, SHA256
`cc3fa6751761f7bdb35ea8a88f78919c612d6ddfe4b3b747999d1a5c031508f5`,
containing only `scanner_retention_copy_failed` and LF. It does not identify
an internal phase. The subsequent read-only chain reconstruction separately
establishes the local tool guard refusal for the two-link tar executable.

At11:37UTC, authenticated SSH with independently supplied host key confirms
the expected Windows SID and the exact System32/WinSxS aliases in the plan.
They share fileID, pinned bytes/hash and TrustedInstaller ownership/DACL;
the inspected paths/ancestors have no reparse attributes. The scanner target
directory is absent. These are fresh observations, not retroactive phase logs.
Raw observations and original SSH captures remain in the private evidence
directory `task0005-nexus-original-sbkc7bjk` on the VPS. The original archive
on NexusLite remains unchanged; no coordinator/helper/WSL/Docker operation
has been executed by this investigation.

## Validation and delivery

Original-evidence review APPROVE is limited to integrity and diagnosis:
140 original files/537239bytes;137 original manifest entries verified with no
divergence and three explicit exclusions. The independently retained complete
set covers149 files/1361111bytes, rehashed by the parent with full coverage.
Review SHA256 `65e166fcf6e6e3c566fba5f2aea47baac64e95dfb218eb1c6621e926c83d9043`;
complete manifest SHA256 `589fffce76f44b762f1c83865668a1a1e57494deb3075a5cf2389800dc072aa2`.
Private evidence directory: `task0005-nexus-original-review-05ihrd64`.

Actual sequential plan reviews: `windows_links_plan_architecture` APPROVE,
then distinct `windows_links_plan_critic` APPROVE, both on5979bytes/SHA256
`b720e20142bcadab800c628d0d8c0046153e699c42d3db230e2668172d2c118e`.
The frozen plan retains its candidate status; these later reviews establish
implementation readiness only. Architecture found and resolved an ordering
issue before approval: early preflight must be additive, not replace the
existing immediate pre-stage check. No implementation existed during review.

Implementation adds only the fixed second tar path in policy:31274bytes,
SHA256 `c8b117da919791dfecde28d3f5a5284e286b5ae4c2c77bbfb7772605a4437aef`.
All remaining policy values, native helper/wrapper and original plans are
unchanged. The source checker binds both names/counts to one stable file.
Early tools/capacity preflight is additive and known errors use an exact whitelist.

Local gates ran serially on17 November11:48:35–11:51:24UTC, Node22.23.2,
pnpm10.15.0, Linux/ext4 checkout, umask0022. The14-file source manifest remained
unchanged throughout. Logs/results: private `task0005-windows-links-validation-92kehhdc`.

| Gate | Result |
| --- | --- |
| New tool/copy-preflight tests |14 passed,0 skipped/cancelled |
| `node --test tests/scanner-retention-*.test.mjs` |175 total,168 passed,7 existing Windows-only skips,0 failed/cancelled |
| `pnpm lint` |PASS |
| `pnpm typecheck` |23 tasks passed,0 cached |
| `pnpm build` |14 tasks passed,8 cached |
| `pnpm secrets:check` |PASS |
| `pnpm run audit:dependencies` |PASS, no known vulnerabilities reported |

An initial targeted ESLint failure in the synthetic error getter fixture was
corrected before final targeted tests/lint; its original log is retained in
`task0005-windows-links-implementation-qr6_r126`. No production assertion or
threshold was weakened. Full root tests were not retried on this VPS: its
`/tmp` is tmpfs and unchanged native tests require ext4. Complete root/package/
browser quality and managed/Windows/tools source and protected-main workflows
remain mandatory delivery gates, not replaced by the local targeted suite.
The Windows workflow now runs both new suites as well as the existing native
helper fixtures; actual Windows execution remains pending.

Independent implementation review `windows_links_source_review`: APPROVE,
no material findings, frozen14 files and six local logs independently rehashed.
Report10545bytes/SHA256 `6c9d1d3b28d272dcb9e897be103bff37b040cfcbbd53819f2206e2950b80b399`;
review manifest SHA256 `3c990d1ba7f8fe7c51d0097871eee05f6025aa1694a0bbd4e401be05de79eef6`.
Private directory: `task0005-windows-links-source-review-1o_xwwyn`.
This review began while final local gates were running. Later documentation
status/results updates do not change the seven implementation/test/workflow
files. Source/main CI, original-evidence review and real Nexus preflight/copy
remain pending. No operational acceptance follows from source review.

First locally complete proposal:17 November2026 at11:51:24UTC; CI/native Windows and operational gates pending. Costs, agent tokens and human
time: unknown. This is outside the product pilot cohort; no efficiency claim.
TASK-0005/0005A remain IN_PROGRESS. Publisher observation remains accepted;
no new publisher run, local copy/restore, admission, support or final lifecycle
acceptance is established. Original failures and all243 upstream blockers remain.
