# TASK-0005A — deterministic Seaweed monitor parent-swap fixture

Status: local source checks and code/test review complete; final documentation review and GitHub delivery pending, 2026-10-24. TASK-0005A/0005 remain IN_PROGRESS. This is a shared CI prerequisite for the permissions and HistoVec branches, not image, runtime or admission evidence.

## Problem and implementation plan

[PR194 CI40031309818, attempt1](https://github.com/CleMeY15/auto-world/actions/runs/40031309818) failed with `seaweed_monitor_parent_swap_selftest_failed`. Its grouped assertion does not identify the divergent predicate. Source inspection shows a gap between moving the output directory and linking its replacement; attributing the historical failure to this gap remains an inference.

The [PR195 implementation plan](https://github.com/CleMeY15/auto-world/pull/195) adds closed predicate diagnostics, records one diagnostic run, establishes a failing regression for the ordering of the swap and child launch, then completes the fixture's swap synchronously using its existing local Bash startup-hook pattern. The production monitor, timeout, process cleanup, sentinel checks, skips and quality gates remain unchanged. Dependency review, Architect review and distinct Critic review approved this scope before fixture edits or Linux execution. An independent implementation review and complete source validation remain required.

The exact isolated security patch from commit `68186442780163f0383eb7ad90b89628df32a764` is a shared prerequisite: only the transitive Zod lockfile resolution changes from4.6.5 to4.6.6. The existing application tests and dependency audit remain required. This coordinated patch does not establish a general bound on all collection validation. A later dependency/provenance evaluation is separate.

## Evidence and delivery boundary

One fresh offline Linux unit-fixture run of the diagnostic source passed the original selftest. This does not reveal the divergent predicate of the historical CI; no rerun was used to search for a failure.

The deterministic ordering regression uses the real monitor through its existing runner injection. Before any child PID output or directory mutation, it requires the parent to be the exact replacement symlink and the moved directory to be a real directory. Against the old asynchronous fixture it failed exactly with `seaweed_monitor_parent_swap_selftest_failed:MOVED_DIRECTORY_KIND`, exit1. This proves the ordering regression, not the historical CI cause. The original monitor and its strict timeout remain unchanged.

The diagnostic record SHA256 is `5f81aaf14e5c351e5018635316085351d1ebe690d32919aea6c6d1a387b9814a`; the failing regression record SHA256 is `e9b05839bb6d9baae676381ad05f381796515e9ab0b528798d728d9f6ef74ec4`. Both captured source identities before and after execution. The separately reviewed local lane immediately drops to UID/GID1000 and uses only fresh unit-fixture directories and processes; it does not inspect older Native operations.

After synchronization, the fresh focused Linux suite passed7/7 with zero exclusions: both the original real-monitor selftest and the new ordering regression pass. GREEN record SHA256: `cd9ee061e5014110b09f27ee33d9ca8635015e6ec2b499f2b7f8d283f56c1b7f`. The independent code/test review approved the implementation without material findings. This covers fixture source and tests only, not final delivery.

The six local repository commands passed: lint, typecheck, root/workspace tests, build, tracked-file secret scan and dependency audit. Windows root tests report2018 cases,1573 passes and445 actor-specific exclusions: the previous444 exclusions plus the new Linux ordering case, which was exercised successfully in the separate Linux suite. All28 workspace test tasks passed. The audit reports no known vulnerabilities.

The original local matrix remains `NOT_ALL_PASSED`: its documentation snapshot advanced during the run to record the Linux result and code review. Its executable and lockfile identities remained stable and every command exited0; this documentation drift was preserved explicitly rather than rewriting the matrix. Matrix SHA256: `e87fb6f0a6722a28547a39f0fb63bce45d0ab94e0143791cd91088152994b295`. Final documentation review and the final tracked-file scan remain separate. The browser surface is unchanged; its shared-base local suite passed375 tests with7 existing exclusions, while a fresh complete browser gate remains required in exact-head CI.

Exact-head CI, protected merge and merged-main CI must be recorded separately after those checks. Historical failed runs remain failed. No local command or review alone establishes final source delivery.

The fixture may create and dispose only its fresh owned test directories and process groups. It has no permission to inspect or change any previous Gosu Native actor, archive, daemon or consumed control. No Docker build, registry publication, support activation or infrastructure admission is introduced. Support dates remain null.

Rollback is a reviewed revert of the focused fixture repair; this restores the known race and must be recorded as such. The security prerequisite is separate and must not be silently reverted. No data migration is required.
