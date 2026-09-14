# TASK-0005A — SeaweedFS source diagnostic

Status: SOURCE_DIAGNOSTIC_IMPLEMENTATION. This focused increment evaluates a correction of the one blocking gRPC finding in the current SeaweedFS image. The focused PR records exact reviewed-head, native run and integration results as they occur. Source-build success is separate from image audit, runtime validation and admission.

## Inputs and derivative identity

Use SeaweedFS 4.47 source commit `c5073360007d28385a33426a42ac3e4ec504c5a3`, tree `bce9e3f66721208f35888124183f80bd76d64f90`. The [official advisory](https://github.com/advisories/GHSA-2v4p-qf9q-27wj) identifies the affected gRPC development line; the [upstream correction](https://github.com/grpc/grpc-go/commit/93e31b48545e2a8aaeb6e06b47fb249f94e6297f) is selected as `v1.85.0-dev.0.20260825072537-93e31b48545e`. This preserves the selected development line rather than downgrading to an older release.

The generated patch changes only `go.mod` and `go.sum`: 12,782 bytes, SHA-256 `804c8ac03c3e4e01de04c102ace1ad73186116de983b451f01056e4600f24168`. Preparation with official Go 1.26.8 passed `go mod tidy -diff`, `go mod verify` and reverse patch checking; this preparation did not build or test the application. The before/after inventories each contain 1,160 modules with these eight version changes:

| Module | Before | After |
| --- | --- | --- |
| `cel.dev/expr` | `v0.25.2` | `v0.25.3` |
| `github.com/GoogleCloudPlatform/opentelemetry-operations-go/detectors/gcp` | `v1.34.0` | `v1.35.0` |
| `github.com/envoyproxy/go-control-plane/envoy` | `v1.37.0` | `v1.39.0` |
| `github.com/googleapis/enterprise-certificate-proxy` | `v0.3.20` | `v0.3.21` |
| `go.opentelemetry.io/contrib/detectors/gcp` | `v1.44.0` | `v1.45.0` |
| `go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp` | `v0.69.0` | `v0.70.0` |
| `google.golang.org/genproto/googleapis/api` | `v0.0.0-20260715232425-e75dac1f907d` | `v0.0.0-20260817212433-ac3dfec99bb1` |
| `google.golang.org/grpc` | `v1.85.0-dev` | `v1.85.0-dev.0.20260825072537-93e31b48545e` |

The [upstream release matrix](https://github.com/seaweedfs/seaweedfs/blob/c5073360007d28385a33426a42ac3e4ec504c5a3/.github/workflows/container_release_unified.yml) builds the normal Linux/amd64 variant with empty tags. Preserve that profile: no `5BytesOffset`, `CGO_ENABLED=0`, `GOAMD64=v1`, and the original static linker flags. The seven optional feature tags belong to the full variant and are used only for additional test coverage here.

Two explicit provenance changes are applied to the [upstream build recipe](https://github.com/seaweedfs/seaweedfs/blob/c5073360007d28385a33426a42ac3e4ec504c5a3/docker/Dockerfile.go_build): `-buildvcs=true` and the composite runtime marker `c507336+aw.804c8ac03c3e`. Keep the upstream version 4.47 and normal 30 GB semantics. Require the full original VCS revision and `vcs.modified=true`; retain the full patch identity separately. The marker identifies the derivative in both version output and metrics. No new upstream release number is invented.

The compiler is the official Go 1.26.8 Linux/amd64 archive already locked for scanner work: 66,897,291 bytes, SHA-256 `d0f743b33e8d8945e6b1f432edd15785c70507121d6e2a723b21285eddf8b57b`. Original upstream packaging used a floating compiler image; equality with the published `/usr/bin/weed` cannot be established from that recipe. This diagnostic compares the two new pinned builds with each other.

## Execution and evidence contract

Each independent Linux job starts from cold, owned source/compiler/cache paths and verifies exact source, patch and compiler identities. Module retrieval uses the checksum service, `GOTOOLCHAIN=local`, `GOWORK=off` and read-only module files; the dependency-editing `go get` step from upstream CI is not used. Check `go.mod` and `go.sum` before and after tests. Retain full module inventories and `go version -m` evidence for the actual executable, including the corrected gRPC version.

Run normal Seaweed tests, the [upstream seven-tag suite](https://github.com/seaweedfs/seaweedfs/blob/c5073360007d28385a33426a42ac3e4ec504c5a3/.github/workflows/go.yml), vet and corrected gRPC transport assertions. Redis tests use `RUN_REDIS_TESTS=1` against an exact locked helper, synthetic data and a loopback binding; that helper's diagnostic execution does not admit it. Assert that the 15 required Redis tests and 12 local gRPC tests actually pass without skips. The dependency module's own transport tests require a separate command; Seaweed's suite does not execute them automatically.

The non-short Seaweed suite also starts real local clusters. Set `WEED_BINARY` to the identity-recorded normal production executable before both suites, preventing the upstream harness from silently building another binary. Record that the seven-tag suite extends unit/compile coverage while its cluster subprocesses use the normal binary; it does not prove seven external backend integrations. Retain every skip event, including intentionally unconfigured external backends, and keep all external credentials/enable flags absent. Verify non-root execution and required timezone data so local permission/timezone assertions do not silently skip. Test compiler/CGO settings are separate from the CGO-free production binary. Linux/386 and cross-OS upstream checks are explicitly `NOT_RUN` in this Linux/amd64 slice.

A nonzero assertion, changed module file, missing material or metadata mismatch fails the diagnostic. Investigate test failures against exact unpatched upstream under the same environment before attributing them to the correction. Do not delete assertions, hide failures or turn a diagnostic failure into image acceptance. The second-build comparison checks actual bytes and material identities, not just matching self-reported hashes.

The workflow has `contents: read` only, no inputs, no package/OIDC/signing permissions and no credential-bearing external build environment. Pinned actions check out without persisted credentials. No candidate image is published or run by this slice.

## Retained public material and limits

Only the explicit reviewed public reconstruction set may be uploaded: binary, exact Seaweed source bundle and shallow boundary, Go compiler archive, locked module ZIPs with their `.mod`/`.info`/sum identities, inventories, receipts and bounded technical logs. Include SeaweedFS root and glog licenses, corrected gRPC LICENSE and NOTICE.txt, discovered dependency licenses/notices and a derivative modification notice. A hash inventory alone does not preserve the materials. Never upload expanded caches, the repository workspace, private image layers, private archives, credentials, listing payloads, business data or user data.

The source bundle contains only the public source `HEAD`. Retain its exact 41-byte shallow boundary (`c5073360007d28385a33426a42ac3e4ec504c5a3` followed by LF), SHA-256 `85485d485c3fb431c98532676da79828422e8b94102790984f473d14c8fc6300`. A plain source tar loses the Git metadata required by `-buildvcs=true`. The restoration preflight independently clones the bundle without network, installs the checked shallow boundary, runs `git fsck --full`, and verifies the commit, tree, commit time and original module files before applying the patch and verifying exactly two modified files. This is source/VCS restoration evidence; a complete offline binary rebuild and supported-runtime archive restoration remain separate gates.

Use a 90-minute workflow limit with an inner aggregate deadline of at most 85 minutes, leaving a bounded finalization reserve. Child timeouts are clipped to the remaining deadline. Use `GOMAXPROCS=2`, Go build parallelism 2, a 12 GiB owned work/output cap and at least 1 GiB free reserve. Retained artifacts are capped at 2 GiB, logs at 64 MiB per command and 128 MiB in aggregate. A limit breach fails with bounded evidence; it never authorizes an automatic cap increase or silent truncation into apparent success. Owned cleanup runs on failure. Public diagnostic retention is 14 days and does not satisfy supported-runtime archive retention.

The process supervisor checks the combined work/output budget during commands and stops the owned process group on timeout, cancellation or a failed measurement. Final Redis removal retains timeout, log and process-cleanup limits but does not let a pre-existing disk-limit failure prevent that removal. This exception accepts only the fixed `docker rm --force aw-seaweed-redis-[12]` cleanup command; it cannot relax build or test limits.

## Review, follow-on and rollback

Actual sequential Architect and distinct Critic reviews approved this source-only plan before implementation. Implementation still requires independent review, targeted adversarial controls, full pinned root checks, a fresh checkout, exact-head/protected-main CI and actual native build/test/comparison evidence. The focused PR is the chronology for those results.

Independent implementation review requested changes on `98ecb51f1bc65c46c264d01174c80e029b7cf78b`, including subprocess environment isolation, process-tree cleanup, provenance validation and retained VCS metadata. The bounded bundle/shallow correction subsequently received sequential Architect and distinct Critic approval. A local Windows Git probe confirmed that bundle-only restoration fails `git fsck` on a missing parent, while the exact retained shallow boundary restores the required commit, tree and patched module files. Native Linux process cleanup, builds and comparisons remain unverified until the workflow runs successfully.

The candidate-image phase remains dependent on source evidence. Its prospective smallest change is replacement of `/usr/bin/weed` in the exact existing SeaweedFS platform image, preserving `/entrypoint.sh`, `/data`, UID/GID 1000 and Rust helpers. That recipe is not approved or admitted here: the old underlying layer remains a tradeoff to assess, and a full image inventory/SBOM, fresh corrected-scanner reports, layer/effective-filesystem review, S3 and the four-service lifecycle must still pass. Private publication and real image attestation retain their separate gates under [ADR-0007](../decisions/ADR-0007-private-image-admission.md), followed by complete private archive/restore evidence.

Rollback reverts or disables this diagnostic by a reviewed change and preserves its evidence. It changes no runtime image choice, data volume, source right or production system. TASK-0005A and TASK-0005 remain incomplete; TASK-0006 remains blocked. The user-waived fork test stays `SKIPPED_BY_USER`, with isolation `NOT_VERIFIED`.
