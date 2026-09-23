# TASK-0005A — Authenticated structural ZIP scan

Status: implementation under validation. This is a preparation-only gate, not source-material acceptance or image admission.

## Boundary

The [one-time raw ZIP diagnostic](https://github.com/CleMeY15/auto-world/actions/runs/35911097961) proved that the exact five GitHub artifacts can be downloaded into owned files with independently matching size and SHA-256. That run deleted its files. This increment repeats fresh authenticated download internally and streams all five ZIPs through the already reviewed bounded artifact reader. The caller supplies only an empty owned Linux directory, an optional abort signal and a bounded total deadline; it cannot select an artifact, URL, expected digest, scanner, executable or entry sink.

The scan consumes every entry of the two build archives and the three single-JSON archives, enforcing the closed ZIP profile, layout, CRC, size and SHA-256 checks. Entry data is discarded under backpressure. No file tree is extracted, no JSON payload is interpreted as a build or comparison result, and no Docker image is built. A fresh independent GitHub origin read after the five scans must still match the exact run and artifact records. The stage removes only its five known owned raw ZIP files on success or failure; uncertain cleanup suppresses the receipt.

The bounded result is `ZIP_STRUCTURAL_ONLY`, `PREPARATION_ONLY`, `materialValidation: NOT_RUN`, and `candidateAuthorization: NOT_AUTHORIZED`. It may report per-ZIP counts, sizes and digests but no raw paths, entry list or extracted bytes. A serialized result carries no private GitHub-origin authority. The future materialization transaction must freshly authenticate/revalidate all five files, run `validateArtifactDirectory` on both complete output trees, check both artifact gates, run `compareBuilds` on actual materials and compare the exact native comparison receipt before any atomic promotion. It cannot use this scan receipt to skip those gates.

## Validation and operation

Targeted synthetic tests cover fixed input selection, all-five profile delivery, invalid ZIP or origin drift, abort/deadline, root and leaf mutation, bounded receipts and conservative cleanup. The manual Linux workflow is restricted to its first main dispatch and first attempt, with read-only repository/Actions permissions, no persisted checkout credential, no artifact upload and explicit cleanup. The live replay must complete before the source artifacts expire on 7 October 2026. A green ordinary quality CI alone cannot establish this real-data diagnostic.

This stage changes no service runtime, production connector, private package, registry, scanner or four-service infrastructure. TASK-0005A and TASK-0005 remain IN_PROGRESS, while TASK-0006 remains blocked. The external fork-access test stays `SKIPPED_BY_USER` as requested.
