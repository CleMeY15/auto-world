# TASK-0005 M3B — scanner retention bootstrap

Status on 2026-11-09: `PLAN_APPROVED / IMPLEMENTATION_PENDING`.
TASK-0005 and TASK-0005A remain `IN_PROGRESS`; no admission or support activation.

PR237's [accepted checkpoint](https://github.com/CleMeY15/auto-world/pull/237#issuecomment-6750591581)
binds main `ea2aba71f107c73c16abf03ecf64e35d56d4f0be`, tree
`684614b0b48f96eddcb854f160798144129e8e81`. Its quality, managed qualification and
historical integration pass. The upstream-image audit still rejects 175
occurrences. Gosu's six measured files are not retained by that increment.

## Exact plan review

The [M3B plan](../../roadmap/plans/TASK-0005-scanner-retention.md) is preserved
byte-for-byte as reviewed, including its historical pre-review status line.
The actual ordered reviews recorded here supersede that status only.

| Reviewed input | Bytes | SHA-256 |
| --- | ---: | --- |
| Plan v9 | 50491 | `94355aa59d998be0bbff17341c7217f72866d62de85aa330da49aeac47e83da6` |
| ZIP profile v2 | 170198 | `f22ed73c4635aec579a550e1043d62feab0b57bd73a00ac343e696ec5b246513` |
| Qualification binding v2 | 10831 | `1a3ac5823a2cd968fe0d46ec6730a9214e2b90f2a3dad6751635f1950d2e5fd2` |

Actual independent Architect `scanner_retention_v9_architect` returned
`APPROVE`, then distinct Critic `scanner_retention_v9_critic` returned `OKAY`
on these identical inputs, with no material findings. Both independently
checked the 18 source blobs and 689 ZIP entries against the accepted main.
The qualification artifact expires on 2026-11-23T20:18:16Z; later intake must
refuse expired evidence.

## This first delivery

Implement only the closed policy/profile, the harmless bootstrap command and
its no-input protected-main workflow, focused tests and operational evidence.
The package is `ghcr.io/clemey15/auto-world-scanner-closure`. Its initial image
contains only the fixed 48-byte `bootstrap.txt`; the two-file build context is
275 bytes. No scanner binary or private archive is included.

Source execution identity is bound without a self-referential commit literal:
external actual review records the merged commit, tree and source/workflow
hashes; runtime checks checkout identity against `GITHUB_SHA` and the GitHub
main reference. Actual code/workflow review and protected-main delivery are
still required before the first write.

Read proof follows only after the real harmless digest is observed. The full
publisher, Windows copy/restore and shared TAR/ZIP/environment extensions are
later tranches. Actual Private visibility/configuration, anonymous denial and
authorized read must pass before any scanner archive is written. External
fork testing remains `SKIPPED_BY_USER`, isolation `NOT_VERIFIED`.

## Acceptance and rollback

No tests, publication, retention or restoration are claimed by this planning
record. Required local checks, independent implementation reviews, exact-head
CI and protected-main CI remain pending. The bootstrap does not close M3B.

Rollback disables the owned writer and preserves the package and all evidence.
No deletion of existing packages, archives, volumes or unrelated data is
authorized. Support dates remain null.
