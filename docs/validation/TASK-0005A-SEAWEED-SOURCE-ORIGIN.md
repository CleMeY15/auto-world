# TASK-0005A — SeaweedFS source origin gate

Status: read-only origin gate under validation. The native source run is successful; no candidate image has been constructed, published or admitted.

## Purpose and authority

The complete attempt-1 [source run 35884717093](https://github.com/CleMeY15/auto-world/actions/runs/35884717093) produced two independently built public material archives, two gates and a comparison receipt. The local archive replay established byte consistency, but copied API JSON and caller-supplied digests do not establish GitHub origin. This increment binds that one reviewed run to fresh GitHub REST responses. It downloads no artifact and changes no service, workflow, package, credential or data volume.

The reviewed policy fixes repository CleMeY15/auto-world (ID 1357514939), workflow 358072544 at .github/workflows/seaweed-build.yml, source commit 6dbc6964e121e54dc5409f5e646f9ae25c01788f, run 35884717093, attempt 1, event workflow_dispatch and branch main. The workflow file at that commit is 4,424 bytes with SHA-256 4e1ed660814c52b909f5431ee51c9739766447cd83b36a398f44ac64d159a723. A separate local pre-implementation check found that GitHub raw-content bytes and the Git blob match exactly. This gate itself verifies the live raw-content hash and the GitHub commit-tree identity. The policy does not require today's main to still point to the historical source commit.

| Role | GitHub artifact ID | Raw ZIP bytes | SHA-256 |
| --- | ---: | ---: | --- |
| seaweed-build-1 | 10764820767 | 1,559,755,770 | 6fa3299b48bc978c35ce10ae6cd9b2cd86d5020a324c555a69c493dbb8a174e5 |
| seaweed-build-2 | 10764417203 | 1,559,676,896 | bf65a3505e832603907cbef61cbbecb2d6ba0b88853c7ed9b84e1aad854be242 |
| seaweed-artifact-gate-1 | 10764885637 | 277 | bb5ebe41e7fa8e52987a91ab4dae19f88ac412fedfa8ec78b368b861efe2759c |
| seaweed-artifact-gate-2 | 10763824843 | 278 | 15a9e2e02c985ccdfb0c949c5141265a4c8b6af0b864a4951586d2c84e1ce69d |
| seaweed-comparison | 10764462948 | 244,644 | e58db0edbd41cc2dcb6243464f0110fb4db1ec52dc81fbcd05860b1598254092 |

The exact successful jobs are Independent SeaweedFS build 1 (107261820542), Independent SeaweedFS build 2 (107261820365), and Compare independent SeaweedFS builds (107281267691). Their names, IDs, attempt, source SHA and terminal success must all agree.

## Read boundary

The read-only client uses the existing gh session against github.com with an explicit REST API version. It reads the repository, workflow, immutable workflow bytes at the source commit, current run, attempt 1, that attempt's jobs, the run's artifacts and each of the five artifacts by ID. It rechecks the complete artifact list and all five individual records, then run/attempt state, after collection. Exact counts, unique identities, repository/run links, bytes, sizes, digests and unexpired state are required; missing, extra, duplicate, partial, malformed or changed records fail closed.

The GitHub artifact API links an artifact to a workflow run and source commit, but does not carry a producing job ID. The exact successful attempt, closed five-artifact set and later content validation form the gate; this increment does not claim direct artifact-to-job attestation. A pure validator of records supplied by a caller reports consistency only. Only the live client can return a process-local authenticated origin handle; serializing its fields does not preserve authority. Its private in-process mark expires after 60 seconds or at the earliest artifact expiry, whichever comes first. The following materialization runner must independently refresh source authority immediately before downloading and must check actual raw ZIP bytes and all source receipts.

Artifact retention is finite: the five currently expire on 7 October 2026. An expired or deleted artifact fails the gate; it does not justify using an unverified local copy as new authority. The later runner must either consume the valid exact source before expiry or obtain a new reviewed successful source run.

## Verification and rollback

Adversarial record and transport tests, a live read-only replay against the exact run, independent implementation review, pinned local and fresh-checkout checks, final-head Linux CI and protected-main CI are required. The live replay on 23 September 2026 read the exact three jobs and five artifacts, verified the 4,424 workflow bytes and pinned digest, returned an authenticated process-local receipt, and rejected a serialized copy. Independent architecture review found no remaining P0/P1/P2 issue after the final artifact reread and aggregate-deadline corrections. The 19 targeted tests pass; the forced pinned local check passes 282 root tests with five explicit Windows-only skips, package suites 99/77/157, lint, typecheck, nine builds, Secretlint and dependency audit. An independent fresh clone of the first PR head passed frozen installation and the full check; the corrected final head must pass again. Linux final-head and protected-main CI remain delivery gates. This preparation changes no production runtime or persisted data. Reverting it removes only the origin reader, validator, tests and documentation.

TASK-0005A and TASK-0005 remain IN_PROGRESS, TASK-0006 remains blocked. This gate neither constructs an image nor changes scanner freshness, private-package access, vulnerability thresholds or the user's waived external fork-access test.
