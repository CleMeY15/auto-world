# TASK-0005A — SeaweedFS package bootstrap design

Status: FIRST_WRITE_FAILED_AFTER_CONFIRMED_PUBLICATION; PRIVATE_READ_VERIFIER_IMPLEMENTED_FOR_REVIEW. The published harmless object is retained and remains unadmitted. No candidate layer has been published, signed or executed.

## Purpose

Create, then prove controlled private retrieval of, the fixed GHCR package `ghcr.io/clemey15/auto-world-seaweedfs-s3` using a harmless technical object before any SeaweedFS candidate layer is eligible for publication. This implements the first-write safety boundary required by [ADR-0007](../decisions/ADR-0007-private-image-admission.md) for the bounded derivative defined by [ADR-0008](../decisions/ADR-0008-seaweed-s3-derivative-profile.md).

The original workflow was manual, had no inputs, accepted only its first attempt of its first run on exact protected `main`, and used one GitHub-hosted Linux producer with `contents: read` and `packages: write`. Its only authorized purpose was the harmless first write described below.

## Fixed harmless object

The producer generates its build context in runner temporary storage. It does not read a candidate archive, SeaweedFS binary, application source or user data.

- Base: `scratch`.
- Platform: `linux/amd64`.
- File: `/bootstrap.txt`, exact bytes `auto-world-seaweedfs-s3-package-bootstrap-v1` followed by LF.
- Payload SHA-256: `fc310f41ea257c6abcb9313460088793eba96809ce666d611952da16e6f54f66`.
- Recipe SHA-256: `b73ebec2ccbc37e6a2c8e2354d3527a2eeb6a25ecf1ba6384f08d36bbaf603fd`.
- Build network: `none`; provenance and SBOM exporters disabled for this bootstrap object.
- Tag: fixed package plus `bootstrap-<run-id>`. The retained identity is the registry manifest digest from Buildx metadata.

The fixed recipe contains no `RUN`, remote `ADD`, base image or candidate layer. It labels the existing source repository and describes the object as harmless and unsuitable for runtime use.

## Preconditions, receipt and cleanup

The script independently rejects the wrong repository, event, ref, workflow path, runner class, job, run number, rerun attempt or checkout SHA. Immediately before login and publication it reads the protected `main` ref through the GitHub API and requires the returned commit to equal `GITHUB_SHA`. It refuses an existing local tag and requires that no local image with its tag exists after the push.

The only Actions artifact is `receipt.json`, retained for 14 days. It contains fixed identities, bounded tool versions, phase outcomes and the published digest. It never contains the token, Docker configuration, image layer, candidate archive, build context or metadata file. Owned temporary material is removed on success and failure. A failed push is recorded as `ATTEMPTED_OUTCOME_UNCONFIRMED`; it is not safe to retry until the remote package is inspected.

A successful script result is only `PUBLISHED_UNADMITTED`. The receipt deliberately records `packageConfiguration: NOT_VERIFIED`, `admission: NOT_AUTHORIZED`, the user-waived fork test as `SKIPPED_BY_USER`, and fork isolation as `NOT_VERIFIED`.

## Required review and post-write gate

Before dispatch, the exact workflow, script, fixed public payload and package/credential/retention plan require sequential Architect approval and then approval by a distinct Critic, as required by ADR-0007. Ordinary tests and CI do not satisfy that gate.

After the single write, authenticated package Settings must be inspected before any candidate layer is written. Record actual visibility, source repository linkage, inherited permissions and Manage Actions access. Require Private visibility, anonymous remote denial from a registry request that cannot reuse daemon cache, and an authorized read-only positive control bound to the exact bootstrap manifest digest. An unexpected setting or read result blocks all later writes. Do not delete or silently recreate the package; preserve the first-write outcome.

The external authenticated fork/PR access probe remains `SKIPPED_BY_USER`; fork isolation remains `NOT_VERIFIED`. No second account, expanded token, new repository or new storage service is introduced. The harmless package remains retained without automatic deletion, but it is not a supported runtime object. Supported candidate retention, secondary private archive restoration, scanning, runtime proof, signing and admission remain separate gates.

## Native first-write result

The one [native run 35989463452](https://github.com/CleMeY15/auto-world/actions/runs/35989463452), attempt 1, on protected-main SHA `6fadb77d2e6930efc014e378d4295724a9acbd17` FAILED. The managed-tool, checkout, protected-main, collision, fixed-materialization, login and `harmless_first_write` phases passed. Publication is therefore confirmed as `PUBLISHED_UNADMITTED` at the fixed subject `ghcr.io/clemey15/auto-world-seaweedfs-s3@sha256:2ac4a586d6b419247314e639b0ee777a549e91b6c6040ca01a218d4bb877338a`. The later `no_local_image_retained` phase failed with `seaweed_package_bootstrap_local_image_retained`; owned temporary cleanup passed. The 2347-byte receipt has SHA-256 `1db6b22b6a23ba04520310b9378538ffc3fce868d4af8b64fd8f8f1f679b8f95`. This failure is preserved and is not relabelled successful.

Authenticated package Settings initially showed the newly created object as Public. The existing object was then changed to Private without deletion or recreation. The authenticated Settings view now shows source repository `CleMeY15/auto-world`, inherited access enabled, the sole Manage Actions repository `auto-world` with Admin access, and zero directly added members. A separate anonymous registry manifest request and anonymous token request returned 401. These observations correct the package configuration, but they do not replace the required native, read-only positive/negative/positive retrieval proof.

## Read-only continuation

The workflow at the same path is retired as a publisher and now contains one `verify` job with only `contents: read` and `packages: read`. It has no inputs, publishing command, write permission, OIDC or attestation capability. The existing workflow history records the first dispatch as run number 1; the revised guard accepts only workflow run number 2, attempt 1. GitHub documents that `run_number` increments for a particular workflow and reruns increment `run_attempt`; because preservation of workflow identity across the reviewed file revision is still an external platform property, the actual run metadata must be checked after dispatch before its receipt can be accepted.

The verifier fixes the exact published digest in source. It logs into GHCR through an owned temporary authenticated Docker configuration, reads and hashes the remote manifest, requires anonymous denial through a separate empty Docker and Buildx configuration, and repeats the authenticated remote read. It then pulls only the fixed digest, verifies repository digest, platform, size and source/description labels, creates but never starts a container, and copies `/bootstrap.txt` from that stopped container for exact 45-byte comparison. It removes only the Docker objects it created, proves their absence, deletes owned temporary material and retains one bounded public receipt for 14 days. Network errors, unexpected anonymous success, cached/local collisions, manifest or payload substitution, ambiguous cleanup, and alternate run identities fail closed.

The read-only verifier does not alter package Settings, publish, sign, attest, start or admit an image. A successful future receipt can prove access controls and bytes only for this harmless fixed object. Candidate publication, supported retention/restore, exact candidate scanning, runtime validation, signing and admission remain separate gates. The external fork test stays `SKIPPED_BY_USER`; fork isolation stays `NOT_VERIFIED`.

## Verification and rollback

Unit tests preserve the historical publisher behavior and separately cover the read-only verifier's fixed identity, exact run-two context, authorized/anonymous/authorized sequence, remote-manifest integrity, exact stopped-container bytes, negative access classification, collision refusal, redacted receipt and owned cleanup. Workflow tests lock no-input dispatch, the one-shot run-two guard, read-only least privilege, pinned actions, absence of publishing/OIDC/attestation and exact receipt-only upload.

Rollback disables the read-only workflow by reviewed change. Preserve the package object and first-run receipt; deleting remote evidence is not rollback. This implementation does not alter the four-service runtime, volumes, backups or admitted-image inventory.
