# TASK-0005A — Local package preparation

Status: IMPLEMENTATION_IN_PROGRESS. No registry write, package configuration proof or image admission.

## Purpose and implementation plan

Prepare the non-sensitive technical payload for the first-write sequence required by [ADR-0007](../decisions/ADR-0007-private-image-admission.md). This increment builds and inspects it entirely within a disposable Linux Actions runner. The source repository, managed Docker/BuildKit versions, source/run identity, exact Dockerfile/payload hashes and local image configuration ID are retained in a bounded receipt. A local configuration ID is not a registry manifest digest.

- Generate an isolated `FROM scratch` context with only `proof.txt`, containing exactly `auto-world-private-package-boundary-v1` followed by LF, and the source label for `https://github.com/CleMeY15/auto-world`.
- Build for `linux/amd64` without build networking or a base-image pull. Inspect metadata and copy the file from a stopped container without executing its contents.
- Check exact bytes, size, source label and platform. Clean up only owned objects and retain only the public technical receipt for 14 days.
- Exercise this path in Linux CI, including failure propagation. Use focused unit tests for invalid context, substitution, bounds and integrity; require root quality gates, a fresh remote checkout and independent review.

The workflow has `contents: read` only, no package permission, registry authentication, OIDC, signing or private input. It runs on relevant PRs and main pushes and has a ten-minute timeout. Receipt upload names one JSON file, never an image directory or archive.

## Evidence and limits

Local tests and native Linux run evidence are pending. Publication is `NOT_ATTEMPTED`; actual package configuration is `NOT_VERIFIED`. The external authenticated fork access test remains `SKIPPED_BY_USER` and fork isolation `NOT_VERIFIED`, following the user's instruction "Zap le test d’accès". This preparation neither repeats nor replaces that waived probe.

Before a later first registry write, the concrete publication workflow and package/credential/retention plan still require Architect then distinct Critic review. Actual private package settings, anonymous denial and authorized retrieval remain separate controls. This increment grants no publication authority and does not reuse the retired ADR-0006 canary. TASK-0005A and TASK-0005 remain incomplete; TASK-0006 waits.

## Operations and rollback

The only retained output is a bounded non-sensitive JSON receipt. No data volume, existing container, registry object, source listing or application data is modified. Failures retain explicit phase/reason information; partial preparation cannot count as a successful build or publication. Managed runner tooling is recorded as part of the trust boundary, not claimed to be independently reproduced.

Rollback disables or reverts this workflow/script increment. No registry cleanup or database migration is needed. The 14-day diagnostic receipt is not the eventual supported-image retention archive.
