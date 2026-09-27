# TASK-0005A — PostgreSQL harmless package bootstrap

Status: IMPLEMENTATION_IN_PROGRESS, NOT_EXECUTED, NOT_ADMITTED. No PostgreSQL candidate layer is authorized by this producer.

## Goal and authority

The local PostgreSQL correction has verified runtime and complete zero-blocker audit evidence in [PR98](https://github.com/CleMeY15/auto-world/pull/98), merged at `c2292f4a45aa1264b2bdf8d38c85399e2a799b1d` with passing [main CI36351516860](https://github.com/CleMeY15/auto-world/actions/runs/36351516860). Its saved archive has no published OCI subject or attestation. The next necessary prerequisite is a package whose actual privacy and retrieval behavior can be checked before storing PostgreSQL candidate layers.

Use the deterministic package `ghcr.io/clemey15/auto-world-postgres-gosu` in the existing namespace and repository. [ADR-0007](../decisions/ADR-0007-private-image-admission.md) authorizes this bounded managed-tooling route, subject to sequential Architect then distinct Critic approval of the concrete workflow and package plan before its first write. No account, paid service, repository, local token expansion or separate registry is introduced. The waived external fork test remains `SKIPPED_BY_USER`, and fork isolation remains `NOT_VERIFIED`.

This increment creates only the harmless bootstrap object and records its actual result. A subsequent reviewed change must pin the observed remote digest, retire this write producer and perform independent private-read controls. No arbitrary digest parameter, placeholder verifier or assumed privacy result is accepted as that proof.

## Fixed content and execution boundary

The only payload is `auto-world-postgres-gosu-package-bootstrap-v1` followed by LF, stored at `/bootstrap.txt`. The generated recipe uses `FROM scratch` and one `COPY`, with fixed public technical labels. It contains no `RUN`, `ADD`, base image, application source, credential, listing data or PostgreSQL executable. The build context is created from those constants in owned runner temporary storage. It never reads the locally audited image archive or its private reports/databases. The fixed remote tag is `bootstrap-<run-id>` inside the selected package.

The manual workflow accepts no inputs and only its first run/first attempt on exact protected `main`. It uses one GitHub-hosted Ubuntu 24.04 job with `contents: read` and `packages: write`, pinned Node 22.23.2 and the repository's pinned official checkout/setup/artifact actions. There is no OIDC, signing, attestation or candidate execution. Checkout credentials do not persist; the Actions token is used only in the bounded producer and an owned temporary Docker configuration. The workflow timeout is 15 minutes; its producer step has 12 minutes, leaving time for receipt retention and failure enforcement. The script reserves a separate bounded cleanup interval.

The script must reject foreign context, dirty or substituted checkout/code, an unprotected or changed `main`, an existing local or remote target tag, unsafe output paths, malformed/oversized registry responses and unverified command outcomes. Revalidate protected `main` immediately before publication. Disable build provenance/SBOM exporters for the harmless object and use a network-disabled build. The managed Docker/Buildx identities are recorded explicitly; no candidate image is started or used as a helper.

## Publication result, cleanup and retention

Before any push, the receipt states `NOT_ATTEMPTED`. Once attempted, retain `ATTEMPTED_OUTCOME_UNCONFIRMED` until authenticated remote manifest reads by tag and exact digest establish the published identity. Only then may publication become `PUBLISHED_UNADMITTED`. A later failure does not erase a confirmed write or turn an uncertain write into an absent object. Never automatically retry an uncertain push or rerun this producer.

Buildx may retain a local image even after a push. Cleanup must inspect and bind the generated tag/image to this invocation before removing it, then check final absence. It may remove only owned paths, credentials and image references; it must not globally prune or remove pre-existing images. Uncertain cleanup fails the run while preserving publication facts.

The sole public artifact is a bounded `receipt.json`, with fixed identities, hashes, phase outcomes, tool versions and cleanup state, retained for 14 days. No archive, image layer, build directory, Docker configuration, token, raw registry response or unfiltered command output is uploaded. Preserve the native receipt and any remote object in the existing private archive, including failed or uncertain outcomes; no automatic deletion is configured. This is technical staging evidence, not the supported-runtime archive.

## Post-write privacy gate and next step

The first package may appear Public, as happened for the earlier harmless SeaweedFS bootstrap. Inspect its authenticated Settings before any candidate publication: actual visibility, source repository linkage, inherited permissions, Actions grants and direct members. If necessary, make this same harmless object Private through the already-authorized account; never delete or silently recreate it. Preserve the initial observation separately from the corrected configuration.

After the observed digest is pinned in reviewed code and the write producer is retired, a separate read-only verifier must prove authenticated raw manifest retrieval before and after isolated anonymous denial, exact-digest retrieval and expected payload/config inspection without running a service, and ownership-checked cleanup. A cached Docker image is not evidence of anonymous remote access. Configuration observations alone cannot replace this proof. Candidate publication stays blocked until all these checks pass.

The later PostgreSQL publisher must construct a new subject from the pinned base/APK and repeat its relevant controls; the local diagnostic archive is recipe evidence, not an asserted published subject. Exact remote audit/runtime, complete private retention/restore, official signing and reviewed admission remain separate. OpenSearch retains its documented blockers. No bootstrap result starts the one-year support interval or completes TASK-0005A, TASK-0005 or TASK-0006.

## Acceptance and validation

Before dispatch: test wrong repository/ref/job/run/attempt, changed or unprotected main, modified checkout/code, alternate payload/context, unsafe paths, remote tag collision, changed manifest/config, ambiguous push, timeout, uncertain cleanup, and receipt redaction. Workflow regressions must prove the exact permissions, no parameters/signing/candidate execution and receipt-only artifact path. Run full lint/typecheck/tests/build/secrets/dependency checks, independent implementation review, sequential Architect then Critic first-write review, and exact-head plus merged-main CI.

Acceptance records the actual single native write outcome, complete bounded receipt and owned cleanup, plus observed package configuration. Privacy/read acceptance is explicitly pending until the separate verifier runs against the pinned native subject. Rollback retires the producer and preserves evidence and remote objects; it does not delete service data or backups and never admits a vulnerable fallback.
