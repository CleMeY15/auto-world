# TASK-0005A — Local package preparation

Status: NATIVE_PREPARATION_VERIFIED. Final review and integration evidence is recorded in PR17. No registry write, package configuration proof or image admission.

## Purpose and implementation plan

Prepare the non-sensitive technical payload for the first-write sequence required by [ADR-0007](../decisions/ADR-0007-private-image-admission.md). This increment builds and inspects it entirely within a disposable Linux Actions runner. The source repository, managed Docker/BuildKit versions, source/run identity, exact Dockerfile/payload hashes and local image configuration ID are retained in a bounded receipt. A local configuration ID is not a registry manifest digest.

- Generate an isolated `FROM scratch` context with only `proof.txt`, containing exactly `auto-world-private-package-boundary-v1` followed by LF, and the source label for `https://github.com/CleMeY15/auto-world`.
- Build for `linux/amd64` without build networking or a base-image pull. Inspect metadata and copy the file from a stopped container without executing its contents.
- Check exact bytes, size, source label and platform. Clean up only owned objects and retain only the public technical receipt for 14 days.
- Exercise this path in Linux CI, including failure propagation. Use focused unit tests for invalid context, substitution, bounds and integrity; require root quality gates, a fresh remote checkout and independent review.

The workflow has `contents: read` only, no package permission, registry authentication, OIDC, signing or private input. It runs on relevant PRs and main pushes and has a ten-minute timeout. Receipt upload names one JSON file, never an image directory or archive.

## Evidence and limits

The 13 targeted script/workflow tests and ESLint passed. Publication is `NOT_ATTEMPTED`; actual package configuration is `NOT_VERIFIED`. The external authenticated fork access test remains `SKIPPED_BY_USER` and fork isolation `NOT_VERIFIED`, following the user's instruction "Zap le test d’accès". This preparation neither repeats nor replaces that waived probe.

The initial Linux run [34859200995](https://github.com/CleMeY15/auto-world/actions/runs/34859200995) built the scratch image and cleaned its owned objects, but failed while parsing the backend version. The managed Buildx v0.37.0 [source](https://github.com/docker/buildx/blob/ac30b249211430b85fb8f37b6e7154b5c47ba0b6/commands/inspect.go#L91) emits `BuildKit version:`; Docker's documentation example still uses `BuildKit:`. The parser now covers both exact field names with a regression test. That failed run remains a failure; a fresh native run must prove the corrected path.

At code head `d559bb82365d7e238c673997158794f38ad26470`, [Linux run 34859494132](https://github.com/CleMeY15/auto-world/actions/runs/34859494132) passed all nine phases, including local build, image inspection, stopped-container copy and owned cleanup. Its receipt records synthetic PR merge source `b5713f89dc3547e1960ad7b6ab8487411dd3d5cc`, Docker client/server 28.0.4, Buildx v0.37.0 and BuildKit backend v0.20.2. The 39-byte generated and copied payloads both hash to `d5e5e59eda3174b385ac04154621244178be55d1a7f69f6cc6f6dd1fda43355d`; the 118-byte Dockerfile hashes to `26482c5b8cf345a38591136e89f097b2932e98c1ff2065ff8ea8f023f56f4117`.

The downloaded artifact contains only `receipt.json`: 2315 bytes, SHA-256 `4b414b8ac9b54d25f2eb36c1d123129bd34410c919f7e2ef361cc156e93d3b2e`. Its local image configuration ID is `sha256:411c4bcefda7fca8aca48beaa855cb13b2413cf520333e7ac3d89b624a24988e`; this is neither a published manifest digest nor an admission record. The receipt's 157 `artifactBytesBeforeReceipt` measures local generated recipe/payload files that are not uploaded; it is not the uploaded receipt size. Exact final-head review, fresh-checkout quality and merged-main results are recorded in [PR17](https://github.com/CleMeY15/auto-world/pull/17).

Before a later first registry write, the concrete publication workflow and package/credential/retention plan still require Architect then distinct Critic review. Actual private package settings, anonymous denial and authorized retrieval remain separate controls. This increment grants no publication authority and does not reuse the retired ADR-0006 canary. TASK-0005A and TASK-0005 remain incomplete; TASK-0006 waits.

## Operations and rollback

The only retained output is a bounded non-sensitive JSON receipt. No data volume, existing container, registry object, source listing or application data is modified. Failures retain explicit phase/reason information; partial preparation cannot count as a successful build or publication. Managed runner tooling is recorded as part of the trust boundary, not claimed to be independently reproduced.

Rollback disables or reverts this workflow/script increment. No registry cleanup or database migration is needed. The 14-day diagnostic receipt is not the eventual supported-image retention archive.
