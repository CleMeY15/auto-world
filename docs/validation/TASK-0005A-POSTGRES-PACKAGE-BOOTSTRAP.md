# TASK-0005A — PostgreSQL harmless package bootstrap

Status: NATIVE_FIRST_WRITE_PASSED, PRIVATE_SETTINGS_OBSERVED, NOT_ADMITTED. The exhausted writer is disabled. No PostgreSQL candidate layer was published.

## Native result

[PR100](https://github.com/CleMeY15/auto-world/pull/100) merged at `d283bc7ebf39f8432447dffb01a2325d3178584a`, with the exact reviewed tree of `6b8c63a7e716001b6156524e536fbb7d48f94590`. Independent code APPROVE, Architect CLEAR and subsequent distinct Critic APPROVE found no remaining issue. Fresh Linux full checks passed 846/846 tests with zero failures/skips, lint/typecheck/build, Secretlint474 and dependency audit. [Exact-head CI36353045635](https://github.com/CleMeY15/auto-world/actions/runs/36353045635) and [main CI36353435355](https://github.com/CleMeY15/auto-world/actions/runs/36353435355) passed.

The immediate authenticated preflight completed at `2026-09-27T21:57:33.758Z`: actor `CleMeY15`, existing `read:packages` scope, protected exact main, four source blobs identical to reviewed Git bytes, no previous workflow run, target exact 404 and known private SeaweedFS package positive 200. Both paginated package-list endpoints returned `200 []` despite the accessible private object. These retained list responses are explicitly opaque, not exhaustive visibility proof; the Critic required the direct private positive control in addition to the target 404. Twelve bounded HTTP responses and the gate receipt are privately retained.

The single [native run36353596729](https://github.com/CleMeY15/auto-world/actions/runs/36353596729), number1/attempt1 on the exact merged main, **SUCCEEDED**. All 13 phases passed. Receipt state/result is `PUBLISHED_UNADMITTED/PASSED`, admission `NOT_AUTHORIZED`, and all support dates remain null. The owned image was removed and before/after complete local image inventories have identical SHA-256 `94bfcd36ff519484160d873438a0d288bd16ee6b7c8060eddb0de87e5e75d09f` and 431-byte identities. Docker28.0.4, Buildx0.37.1 and Node22.23.2 were recorded.

| Native identity | Value |
| --- | --- |
| Manifest digest | `sha256:9ee2f2da7187b0d0ecd3cbab83b7356f9ef032650b33604ff13e711e3462e408` |
| Config digest | `sha256:cb3e9858fc85bf1fbc4fbaca353cb5b4263b20bd88fb1e6963b4081887eee1bf` |
| Raw manifest | 524 bytes |
| Receipt SHA-256 | `9da3d25232fa9d5edfb61b8301167b5acb52d20d01a7a737a86323bdc90111eb` |
| Package ID | `15408021` |
| Package creation | `2026-09-27T21:58:07Z`, within run window `21:57:54Z`–`21:58:11Z` |

The package initially appeared **Public** in both API and authenticated Settings. The same object was then changed to **Private**, without deletion or republication, and the API corroborated the unchanged ID. Settings show source `CleMeY15/auto-world`, inherited source permissions enabled, one Actions repository (`auto-world`, Admin), zero direct members and no Codespaces repository grant. The existing fork waiver remains `SKIPPED_BY_USER/NOT_VERIFIED`; these settings do not establish anonymous denial or authorized exact-digest retrieval.

The original receipt, run/artifact metadata, initial/private package responses, Settings observation and exact four-file source archive are retained in the existing private archive. Workflow `368603665` was disabled after the single run. The [next read-only increment](TASK-0005A-POSTGRES-PRIVATE-READ.md) must retire the writer in source and prove access against this pinned subject before any candidate layer.

## Goal and authority

The local PostgreSQL correction has verified runtime and complete zero-blocker audit evidence in [PR98](https://github.com/CleMeY15/auto-world/pull/98), merged at `c2292f4a45aa1264b2bdf8d38c85399e2a799b1d` with passing [main CI36351516860](https://github.com/CleMeY15/auto-world/actions/runs/36351516860). Its saved archive has no published OCI subject or attestation. The next necessary prerequisite is a package whose actual privacy and retrieval behavior can be checked before storing PostgreSQL candidate layers.

Use the deterministic package `ghcr.io/clemey15/auto-world-postgres-gosu` in the existing namespace and repository. [ADR-0007](../decisions/ADR-0007-private-image-admission.md) authorizes this bounded managed-tooling route, subject to sequential Architect then distinct Critic approval of the concrete workflow and package plan before its first write. No account, paid service, repository, local token expansion or separate registry is introduced. The waived external fork test remains `SKIPPED_BY_USER`, and fork isolation remains `NOT_VERIFIED`.

This increment creates only the harmless bootstrap object and records its actual result. A subsequent reviewed change must pin the observed remote digest, retire this write producer and perform independent private-read controls. No arbitrary digest parameter, placeholder verifier or assumed privacy result is accepted as that proof.

## Fixed content and execution boundary

The only payload is `auto-world-postgres-gosu-package-bootstrap-v1` followed by LF, stored at `/bootstrap.txt`. The generated recipe uses `FROM scratch` and one `COPY`, with fixed public technical labels. It contains no `RUN`, `ADD`, base image, application source, credential, listing data or PostgreSQL executable. The build context is created from those constants in owned runner temporary storage. It never reads the locally audited image archive or its private reports/databases. The fixed remote tag is `bootstrap-<run-id>` inside the selected package.

The fixed payload is 46 bytes, SHA-256 `3dcac3d89244976f683b3d6c26b91cd992b758baa17801f08b1533c0e235be38`. The generated Dockerfile is 246 bytes, SHA-256 `aea9d6d5010b46d1fa97daa186252d0d641d7aa31d1ac2b68541b94596b0de65`. These byte identities are regression-tested.

The manual workflow accepts no inputs and only its first run/first attempt on exact protected `main`. It uses one GitHub-hosted Ubuntu 24.04 job with `contents: read` and `packages: write`, pinned Node 22.23.2 and the repository's pinned official checkout/setup/artifact actions. There is no OIDC, signing, attestation or candidate execution. Checkout credentials do not persist; the Actions token is used only in the bounded producer and an owned temporary Docker configuration. The workflow timeout is 15 minutes; its producer step has 12 minutes, leaving time for receipt retention and failure enforcement. The script reserves a separate bounded cleanup interval.

Immediately before the sole dispatch, perform and privately retain the package-creation gate with the existing read-only local GitHub credential: authenticate `/user` as `CleMeY15`, successfully enumerate every page of `/user/packages?package_type=container&per_page=100`, confirm the exact target package is absent, and obtain an exact 404 from `/users/CleMeY15/packages/container/auto-world-postgres-gosu`. Retain bounded request/response evidence, timestamps, the gh version and non-secret token-scope metadata. Bind the observations to the reviewed protected merged-main SHA and workflow/script hashes, then to the resulting run ID and attempt after dispatch. Compare the created package timestamp with the run window; an incompatible object remains ambiguous and blocks candidate layers. A bare 404 is insufficient; 401/403, truncated output and incomplete pagination are failures; an existing package, failed pagination, different actor, changed main or ambiguous response stops the write and requires inspection/replanning. This operational check is separate from the producer's unique-tag collision check and does not expand the local credential. Repeat it if dispatch is delayed or the reviewed main changes.
The script must reject foreign context, dirty or substituted checkout/code, an unprotected or changed `main`, an existing local or remote target tag, unsafe output paths, malformed/oversized registry responses and unverified command outcomes. Revalidate protected `main` immediately before publication. Disable build provenance/SBOM exporters for the harmless object and use a network-disabled build. The managed Docker/Buildx identities are recorded explicitly; no candidate image is started or used as a helper.

## Publication result, cleanup and retention

Before any push, the receipt states `NOT_ATTEMPTED`. Once attempted, retain `ATTEMPTED_OUTCOME_UNCONFIRMED` until authenticated remote manifest reads by tag and exact digest establish the published identity. Only then may publication become `PUBLISHED_UNADMITTED`. A later failure does not erase a confirmed write or turn an uncertain write into an absent object. Never automatically retry an uncertain push or rerun this producer.

Buildx may retain a local image even after a push. Cleanup compares bounded complete local image-ID inventories before and after the write, inspects both tag and published config ID, and binds any removed image to this invocation. Pre-existing IDs are preserved even if Buildx attaches the new tag to them; unknown new IDs cause UNCERTAIN/FAILED without blind deletion. After owned removal, the complete inventory must match the pre-write snapshot. It may remove only owned paths, credentials and image references; it must not globally prune or remove pre-existing images. Uncertain cleanup fails the run while preserving publication facts.

The sole public artifact is a bounded `receipt.json`, with fixed identities, hashes, phase outcomes, tool versions and cleanup state, retained for 14 days. No archive, image layer, build directory, Docker configuration, token, raw registry response or unfiltered command output is uploaded. Preserve the native receipt and any remote object in the existing private archive, including failed or uncertain outcomes; no automatic deletion is configured. This is technical staging evidence, not the supported-runtime archive.

## Post-write privacy gate and next step

The first package may appear Public, as happened for the earlier harmless SeaweedFS bootstrap. Inspect its authenticated Settings before any candidate publication: actual visibility, source repository linkage, inherited permissions, Actions grants and direct members. If necessary, make this same harmless object Private through the already-authorized account; never delete or silently recreate it. Preserve the initial observation separately from the corrected configuration.

After the observed digest is pinned in reviewed code and the write producer is retired, a separate read-only verifier must prove authenticated raw manifest retrieval before and after isolated anonymous denial, exact-digest retrieval and expected payload/config inspection without running a service, and ownership-checked cleanup. A cached Docker image is not evidence of anonymous remote access. Configuration observations alone cannot replace this proof. Candidate publication stays blocked until all these checks pass.

The later PostgreSQL publisher must construct a new subject from the pinned base/APK and repeat its relevant controls; the local diagnostic archive is recipe evidence, not an asserted published subject. Exact remote audit/runtime, complete private retention/restore, official signing and reviewed admission remain separate. OpenSearch retains its documented blockers. No bootstrap result starts the one-year support interval or completes TASK-0005A, TASK-0005 or TASK-0006.

## Acceptance and validation

Before dispatch: test wrong repository/ref/job/run/attempt, changed or unprotected main, modified checkout/code, alternate payload/context, unsafe paths, remote tag collision, changed manifest/config, ambiguous push, timeout, uncertain cleanup, and receipt redaction. Workflow regressions must prove the exact permissions, no parameters/signing/candidate execution and receipt-only artifact path. Run full lint/typecheck/tests/build/secrets/dependency checks, independent implementation review, sequential Architect then Critic first-write review, and exact-head plus merged-main CI.

Acceptance records the actual single native write outcome, complete bounded receipt and owned cleanup, plus observed package configuration. Privacy/read acceptance is explicitly pending until the separate verifier runs against the pinned native subject. Rollback retires the producer and preserves evidence and remote objects; it does not delete service data or backups and never admits a vulnerable fallback.
