# TASK-0005 M3B — private scanner-package read proof

Status on 2026-11-09: `IMPLEMENTED / REVIEW_AND_DELIVERY_PENDING`.
TASK-0005/0005A remain `IN_PROGRESS`. This tranche validates only the harmless
bootstrap package. Scanner retention, second-copy restore, admission and support
activation remain open.

## Accepted implementation and actual first write

[PR238's accepted checkpoint](https://github.com/CleMeY15/auto-world/pull/238#issuecomment-6753219249)
binds protected main `ff9edab3fb94417e216bdd70d93846ad32024ec8`, tree
`2ecf1c4c2f258376f2d59bcc3b8eb3f81674f032`. Quality and managed qualification
passed on both final source and main, with independent original-artifact review.
The main acceptance receipt SHA-256 is
`44736a29ab1a5ec45d8ca6e316468c4cc574d9753abc8f4c9e19b2e4fed57ade`.

The sole [bootstrap run 42712603501](https://github.com/CleMeY15/auto-world/actions/runs/42712603501),
job `129485791087`, run number/attempt 1, **FAILED** after a confirmed write and
authenticated digest readback. Docker's default Buildx driver retained its
just-built local image. The `no_local_image_retained` assertion failed; the
subsequent owned cleanup passed and removed that image and temporary directory.
The first ten phases passed. This is not a successful bootstrap workflow.

| Original evidence | Binding |
| --- | --- |
| Artifact | `13717120609`, `scanner-retention-bootstrap-42712603501-1` |
| Original ZIP | 1343 bytes, SHA-256 `ecefba4de8786320599da58450a79347d1e224a2416297a2ae2e7bac474cbc33` |
| Receipt | 2665 bytes; `FAILED / PUBLISHED_UNADMITTED`; original bytes preserved |
| Subject | `ghcr.io/clemey15/auto-world-scanner-closure@sha256:4d3bbf4b6b397254a470193dadd6265989379a472e0508adb05ede68dca4786f` |
| OCI descriptors | direct manifest 524 bytes, config 1037 bytes, layer 145 bytes |
| Payload | `/bootstrap.txt`, 48 bytes, SHA-256 `720ca55e9efe30cbf58a0ef4f0ca720cf25c7e1ed09ac90c73846f11b81681fe` |

No bootstrap retry or second registry write is allowed. The local correction
removes only the newly owned image before asserting absence; preexisting images
still cause refusal and are preserved. It does not retroactively change this run.
The consumed bootstrap workflow `412607125` is disabled (`disabled_manually`,
observed through the GitHub API after the action). Its original run is preserved.

## Observed private settings

GitHub initially created the harmless package with Public visibility. It was
restricted to Private before this read-proof tranche. No scanner binary, private
archive or credential was included in the harmless image.

Authenticated Settings and REST observations identify package `16732127`, linked
to `CleMeY15/auto-world`, one version `1532192850` at the exact digest above,
inherited access enabled, one Actions repository (`auto-world`, Admin) and zero
explicit members. Existing inheritance/grants were not expanded. The read job's
token is separately restricted to `contents:read` and `packages:read`.

The private 1407-byte settings receipt has SHA-256
`799071c5ed9453d11bf2a7df2195c584fbdd6cd8e46f54aabceee54b97493a84` and hashes the
original API responses, UI text and screenshot. It is a point-in-time settings
observation, not a successful Actions read or anonymous-denial result.

## Narrow recovery and runtime boundaries

The approved [M3B plan](../../roadmap/plans/TASK-0005-scanner-retention.md) remains
byte-for-byte unchanged. This recovery preserves the actual failed outcome and
binds only this confirmed-published, authenticated-readback-passed,
cleanup-passed, post-write-assertion failure. Any other failure shape is refused.
The policy fixes the original run, receipt, artifact, digest and private settings;
no command-line subject or caller-supplied policy is accepted.

The separate no-input, first-run/attempt workflow executes only on reviewed
protected main. It verifies authenticated/anonymous/authenticated manifest reads
in isolated owned Docker configurations, distinguishes authorization denial from
network failure, then pulls the exact digest for linux/amd64. A stopped,
never-started container has no network, no capabilities and a read-only rootfs.
The copied 48 bytes must match the original payload. Owned container/image/path
cleanup and restoration of the baseline inventory are required. No scanner runs.
Only a capped public receipt is uploaded; credentials enter login through stdin.

## Validation and remaining gates

Focused tests cover the fixed bootstrap cleanup, exact failed-outcome binding,
direct/index manifest forms, isolated access checks, network ambiguity, payload
mismatch and cleanup, including an initial image with several tags. The initial
focused suite passes43/43, lint14/14 and Secretlint1391 files. Concrete independent
review, complete native local quality,
final-source/protected-main quality and managed evidence, then the actual
read-only workflow and independent receipt replay remain required.

The initial native root suite on `ef16a6d1f8c159a475d57e05ce06d9e1aac8c6c4`
failed the complete package-read workflow inventory: the new job was absent from
its explicit reviewed list. The original result (3192 tests,3137 passed,54 skipped,
one failure) is retained. Registering this job in that list and its documentation
preserves every existing permission, dispatch, main and attempt assertion.
The distinct Critic also required effective child-process timeouts, reserved
cleanup/upload time and correct read-proof error classification. Those findings
are repaired: the real spawn adapter honors the remaining timeout, read operations
have240 seconds, cleanup60 seconds and receipt writing10 seconds within the
10-minute job. Generic command/output/cleanup failures use safe read-proof reasons.
A real blocked Node child is terminated by its50ms timeout; near-deadline and
command/output/cleanup regressions pass. The expanded focused suite passes54/54,
lint14/14 and Secretlint1391 files. Exact-commit re-review and complete native/remote
validation still gate acceptance; the original failed native run is preserved.

The subsequent architecture review of `2fc876c65f33ddf60eb2f34b3fbf29bca43e8d51`
identified crossed directory validators between bootstrap and read modes. They
now use their own mode's validator; the shared tool-identity check receives an
explicit read-proof reason. Separate invalid-directory and tool-output regressions
cover these failures before effects or with owned cleanup. A further deadline
regression crosses the operation deadline, proves that Docker cleanup still has
59500ms, removes the newly pulled image and restores the initial inventory. All42
tests in the directly affected scanner/workflow subset pass on the repaired tree;
the exact final source remains subject to independent review and native/remote gates.

Rollback disables this read workflow and preserves the package and all evidence.
No existing package, archive, volume or unrelated image is deleted. External fork
testing remains `SKIPPED_BY_USER`, isolation `NOT_VERIFIED`; retention, restoration
and admission remain false and support dates null.
