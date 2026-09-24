# TASK-0005A — isolated SeaweedFS backup/restore diagnostic

State: RUNS 9 AND 10 FAILED; backup/restore NOT_VERIFIED. Run 11 is a planned diagnostic retry after a native Docker inspect compatibility repair, not an accepted proof or image admission.

## Boundary

The guarded `workflow_dispatch` on reviewed protected `main` may rebuild the exact SeaweedFS derivative locally with read-only GitHub permissions. It must keep Docker traffic and S3 clients on the runner, publish no port or image, retain no archive or volume, and make no registry write. The user-skipped external authenticated fork access test is not part of this diagnostic.

The objective is the narrow backup and isolated restore requirement in [ADR-0008](../decisions/ADR-0008-seaweed-s3-derivative-profile.md). It does not satisfy the admitted-image audit or the four-service lifecycle in [TASK-0005](../../roadmap/tasks/TASK-0005-local-data-infra.md).

## Failed native run 9

[Run 35961440990](https://github.com/CleMeY15/auto-world/actions/runs/35961440990), workflow run 9 attempt 1, used exact protected-main revision `fede46563479847d6d700824f2c82b44f95610bb` after [PR69](https://github.com/CleMeY15/auto-world/pull/69), [exact-head CI 35961065815](https://github.com/CleMeY15/auto-world/actions/runs/35961065815), and [main CI 35961280363](https://github.com/CleMeY15/auto-world/actions/runs/35961280363) passed. The native preflight, pinned Docker `28.0.4`, checkout and Node setup passed. The diagnostic step failed after 259653 ms with the bounded receipt `FAILED/seaweed_candidate_image_cleanup_failed/CANDIDATE_IMAGE_CLEANUP/NOT_AUTHORIZED`. A separate `CLEANED/NOT_AUTHORIZED` receipt establishes only that the diagnostic-owned directory was absent or empty and removed at the end. There is no V5 success receipt, no backup/restore proof, and no public evidence that the owned Docker image, containers or volumes were completely removed.

The run-9 public error would mask an earlier candidate/runtime failure if both it and image cleanup failed. Whether such an earlier failure occurred, and its exact native cause, is unknown from this receipt. The run-10 repair added bounded primary and cleanup failure context, retained ownership checks, and did not force removal of any ambiguous resource. Run 9 remains FAILED.

## Failed native run 10 and inspected cause

[PR70](https://github.com/CleMeY15/auto-world/pull/70) merged the bounded multi-failure diagnostics at protected main `a89445256c4d6a34cf9005790366ee081a00742f` after [exact-head CI 35963327356](https://github.com/CleMeY15/auto-world/actions/runs/35963327356) and [main CI 35963513266](https://github.com/CleMeY15/auto-world/actions/runs/35963513266) passed. Its guarded [run 35963690247](https://github.com/CleMeY15/auto-world/actions/runs/35963690247), run 10 attempt 1 on that exact main, **FAILED** after preflight. The public receipt identifies image `sha256:f9a90251f669ec137e9f9b2f9f69114547d87d85299c4d2d1094222a149392a8`, primary `BACKUP_SOURCE_VOLUME/VOLUME_CREATE_INVALID`, runtime `BACKUP_RESTORE_CLEANUP/CLEANUP_UNCERTAIN`, and secondary `CANDIDATE_IMAGE_CLEANUP/IMAGE_REMOVE_FAILED`; candidate authorization remains `NOT_AUTHORIZED`. The separate `CLEANED` receipt establishes only the temporary directory's final absence. No V5 backup/restore or complete Docker cleanup is proven.

Code inspection finds a likely cause in the initializer container's mount validation: it required `HostConfig.Mounts[].ReadOnly === false` for a writable volume. In [Moby v28.0.4](https://github.com/moby/moby/blob/v28.0.4/api/types/mount/mount.go#L54-L60), that boolean has `omitempty`, so a false value can be absent in the JSON returned by Docker. The synthetic fixture incorrectly always included `false`. The focused repair accepts an absent or explicit `false` only for an expected writable mount, still requires explicit `true` for an expected read-only mount, and separates volume creation from initializer container creation and execution in bounded failure reasons. This is a source-backed diagnosis, not native confirmation until run 11.

## Required run-11 evidence

1. Build a fresh exact candidate image and use the pinned non-root service profile and signed S3 client established by the [earlier runtime diagnostics](TASK-0005A-SEAWEED-RUNTIME-DIAGNOSTIC.md). Bind the new image identity to the workflow run and recipe revision. Earlier V2/V3/V4 proofs are historical observations on other disposed images; this run does not inherit their unexecuted checks.
2. Initialize a fresh owned source volume. A signed conditional PUT and GET must agree on the technical object's SHA-256 before backup.
3. Stop the source service within its bound. Copy the stopped `/data` state to an independently owned backup volume without network access or a foreign Docker mount. Verify the archive SHA-256 and byte count before allowing the source to be removed, and repeat that check before extraction.
4. Remove the source container and volume after exact ownership checks. Create a distinct, empty restore volume, then restore only the owned backup content into it. The source must be absent before the restored service starts.
5. Start a distinct non-root service on the restored volume and require signed GET of the same object and SHA-256. Stop it within its bound.
6. Remove only proven-owned helpers, services, volumes, candidate image, local archive, rootfs and temporary directories. Every removal must be preceded by a fresh identity check and followed by absence verification; uncertain ownership blocks a success receipt and preserves the uncertain resource for investigation.

The public V5 receipt may report `VERIFIED/DIAGNOSTIC_ONLY/NOT_AUTHORIZED` only after all steps and owned cleanup pass. It must distinguish its backup/restore proof from earlier V2/V3/V4 proof kinds and retain bounded phase/reason on failure, including both primary and cleanup contexts when both fail. `publication`, `vulnerabilityAudit` and `admission` remain `NOT_ATTEMPTED`.

## Verification and limits

Tests must reject occupied names, foreign or altered labels, image/volume/container identity drift, unexpected helper mounts or privileges, incomplete backup, missing or changed restored object, failed service shutdown, and uncertain cleanup. The retry must also test simultaneous primary and image cleanup failure without leaking raw Docker output, plus native-like omitted writable `ReadOnly`, explicit writable `false`, and read-only mounts that require `true`. Exact-head Linux CI, an independent implementation/security review, protected-main CI, and one guarded native run are required before recording a successful V5 result. A failed run remains failed even if its cleanup succeeds.

A successful run would cover one small technical object, one stopped-volume archive copy and one restore on one runner and Docker daemon. Archive transport integrity and final object readback do not establish an exhaustive source/restored filesystem inventory or preservation of every metadata type. The run would not prove online or crash-consistent backup, cross-host recovery, retention, RPO/RTO, arbitrary data sets, the private image archive, fresh vulnerability audit, production admission or the final four-service restart/restore contract. Those gates remain open in TASK-0005A/TASK-0005; TASK-0006 remains blocked.

Rollback removes the run-11 profile and returns the guarded workflow to the reviewed run-10 definition. Preserve immutable run-8/run-9/run-10 and any run-11 logs; do not delete any resource whose ownership cannot be proven.
