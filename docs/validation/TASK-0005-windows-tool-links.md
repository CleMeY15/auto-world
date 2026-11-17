# TASK-0005 — Windows installed-tool hardlinks

Accepted delivery checkpoint,17 November2026: [PR246](https://github.com/CleMeY15/auto-world/pull/246)
merged source0a1dc52a onto mainf630339b, identical treec4012982.
Four actual main gates pass independent original-evidence review; raw diagnostic
remains FAILED243 without waiver. The [subsequent real NexusLite operation](TASK-0005-nexus-observation.md)
also passes independent review; its observation delivery is separate and pending.
Older local/source pending statements below describe earlier checkpoints.

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

## Source quality coverage correction, 17 November2026

The original source e5ae9a61 quality run44078310321/attempt1 genuinely succeeded,
but independent evidence review returned REQUEST_CHANGES: `ubuntu-latest` moved
from Ubuntu24.04 to26.04, where the required `/usr/bin/python3.12` was absent.
The unchanged parser suites skipped54 previously passing tests (25 archive,
14 notices,15 upstream notices). Root result:3242 total,3121 passed,121 skipped,
zero failures; all14 new tool/preflight tests passed. Expected comparable
coverage is3175 passes with67 existing skips. Packages776 and browser668/10
existing exclusions passed with zero retries/flakiness; four intermediate
polling samples converged. This green status is not accepted quality coverage.

Original browser artifact14328071060:189443303bytes, SHA256
`e804ead6896277c7bbc31c748769b643d1c4135ecf079886a2240f70afadbfb4`.
Review34662bytes/SHA256 `497acf0671f222e2aceba59eb21f8a6913ccc01b569918cfa2f4ddf17a0f2373`;
manifest458207bytes/SHA256 `213fad7c6f5f12aa2cfd29b9ea1c89d1eef99d9ed31feb68e5f28f5da4a8860a`,
1732files/432836340bytes. Originals remain in private
`task0005-pr246-quality-review-diqqruj7`, including original SUCCESS and the
rejected coverage decision.

Correction plan: select `ubuntu-24.04`, matching the accepted baseline, and
require the exact executable, Python3.12 version and parser standard-library
modules before dependency installation. A missing runtime now fails the job
before tests can silently skip. No parser code, skip predicate, threshold,
Windows tool policy or other workflow changes. Rollback reverts this workflow
delta; it would restore the known coverage risk, not acceptance. The versioned
runner label still receives image updates; the preflight prevents this specific
runtime absence/version/module drift and does not claim a frozen machine image.

Parent verification rehashed all1732 original evidence files with zero gaps or
mismatches. The bounded workflow correction parses as YAML; comparison with
e5ae9a61 confirms that only the runner label and the new prerequisite step
changed. Extracted shell syntax passes. On this VPS, Python3.12 is absent and
the exact preflight exits1 as intended, before any test; this is a negative
control, not proof of positive hosted-runner compatibility. The15 existing
scanner-workflow/workspace-contract tests pass without skips, secretlint and
diff checks pass. Evidence: private `task0005-pr246-runtime-fix-xqei2mn8`.

A new original source CI run must prove restored coverage. Existing source/main
acceptance gates remain unchanged; no opportunistic rerun of e5ae9a61 and no
production operation follows. The previously reviewed scanner implementation
and all tests remain byte-identical; this follow-up changes only CI and this
validation record.
