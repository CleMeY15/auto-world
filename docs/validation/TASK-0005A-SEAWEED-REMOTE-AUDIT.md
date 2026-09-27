# TASK-0005A — exact remote SeaweedFS candidate audit plan

Status: IMPLEMENTATION_UNDER_REVIEW. The workflow has not run. There is no remote audit receipt, native run identifier, newly verified digest, signature or admission decision.

## Boundary

This increment prepares the read-only audit of the exact private candidate produced by the separately reviewed publication transaction. The new manual workflow accepts no input and is limited to its first run, first attempt, on protected `main` in `CleMeY15/auto-world`. Its scanner-build matrix has `contents: read` only. The audit job has `contents: read`, `actions: read` and `packages: read`; it has no package write, OIDC, attestation or signing authority.

The job uses a GitHub-hosted Ubuntu 24.04 runner, Docker server 28.0.4, Node 22.23.2 and the same pinned checkout, Node setup, scanner build, artifact upload and artifact download actions as the accepted local candidate audit. It requires at least 12 GiB free under `RUNNER_TEMP`. The job is limited to 360 minutes, its audit step to 270 minutes and the implementation's operation deadline to 240 minutes so cleanup retains time inside both outer bounds.

This is the first managed remote-audit route. A native policy receipt for it is not available yet. Completion requires the actual fixed publication policy supplied by the candidate publisher and one reviewed native run against its exact remote subject. No run number beyond the workflow's guarded first run, manifest digest, image ID or report digest is invented here.

## Subject and provenance

The audit must resolve the fixed publisher receipt and exact private registry subject without workflow input. It authenticates remote manifest reads with the workflow's read-only package token and refuses a changed, missing, ambiguous or unauthorized subject. `RAW_MANIFEST_VERIFIED` records an authenticated exact raw manifest identity. `ENGINE_VERIFIED` records Docker's independently resolved identity for that subject. `ARCHIVE_VERIFIED` records the bounded local Docker-save scanner input after it has been checked against the remote subject and engine identity.

These proof levels have different subjects. The registry manifest and its remote config and compressed-layer descriptors identify the private remote image. The local Docker-save archive is a disposable scanner input with its own archive, configuration, layer and DiffID identities. The compressed descriptor size is `RECORDED_ONLY`: the workflow does not claim an independent rehash of the registry's raw compressed blob. It must not equate that descriptor with the uncompressed saved layer, the DiffID or the whole Docker-save archive.

The candidate image is never started or executed. Docker is used only as managed transport and materialization tooling for the exact subject and disposable local scanner input. The audit grants no registry write and cannot alter, sign or admit the candidate.

## Audit and public evidence

Two independent scanner builds are produced from the existing pinned public scanner source and downloaded only from the same workflow run. The audit preserves the accepted local policy: identical scanner build evidence, exact JSON and CycloneDX subjects, complete package inventory, end-of-life rejection, unchanged HIGH and CRITICAL vulnerability thresholds, vulnerability database freshness within 48 hours, and the existing Java database waiver. Java database age remains explicit in the receipt and reports without becoming a maximum-age gate. Integrity, timestamp, report-shape, finding and cleanup checks remain mandatory.

The fixed public evidence directory is `${RUNNER_TEMP}/seaweed-candidate-remote-audit-evidence`. It may contain only the approved technical vulnerability JSON, CycloneDX report, bounded scanner-database metadata and bounded audit receipt already allowed for the local candidate audit. It must not contain the private Docker-save archive, registry layers, credentials, Docker configuration, source archives, raw registry responses or unfiltered command output. The workflow always calls the audit cleanup subcommand before uploading that directory.

A successful receipt must bind the exact remote subject, all applicable proof levels, the distinct local scanner input, scanner and database identities, report hashes and counts, the unchanged policy result and owned cleanup. A blocked report remains blocked. An identity, freshness, transport, report, policy, timeout or cleanup failure remains incomplete and cannot be restated as a clean audit.

## Remaining gates

The public source ZIP retention already completed for the publication plan is useful preservation evidence, but it is not the complete image closure and does not prove restoration of the remote candidate. After this workflow is reviewed and integrated, the first native remote audit and its exact evidence remain required. Complete private closure retention and restore, official signing or attestation, consumer admission and the final four-service lifecycle remain later gates. TASK-0005A and TASK-0005 remain in progress, and TASK-0006 remains blocked.

Rollback disables or removes this unexecuted manual workflow through review while preserving publication and historical audit evidence. It does not delete a remote candidate, change package settings or alter an admission inventory.
