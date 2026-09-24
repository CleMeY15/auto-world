# TASK-0005A — SeaweedFS package bootstrap design

Status: IMPLEMENTED_FOR_REVIEW. No workflow dispatch, registry write, package configuration proof or image admission has occurred.

## Purpose

Create the fixed GHCR package name `ghcr.io/clemey15/auto-world-seaweedfs-s3` with a harmless technical object before any SeaweedFS candidate layer is eligible for publication. This implements the first-write safety boundary required by [ADR-0007](../decisions/ADR-0007-private-image-admission.md) for the bounded derivative defined by [ADR-0008](../decisions/ADR-0008-seaweed-s3-derivative-profile.md).

The workflow is manual, has no inputs, accepts only its first attempt of its first run on exact protected `main`, and uses one GitHub-hosted Linux producer with `contents: read` and `packages: write`. It has no OIDC, attestation, service container, reusable workflow or caller-supplied subject. Its ephemeral repository `GITHUB_TOKEN` is passed to Docker login through stdin and stored only in an owned temporary Docker configuration.

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

## Verification and rollback

Unit tests cover fixed material identities, alternate execution rejection, exact no-network Buildx arguments, stdin credential handling, bounded redacted receipts, protected-main drift, uncertain publication and owned cleanup. Workflow tests lock no-input dispatch, one-shot guards, least privilege, pinned actions, absence of OIDC/attestation and exact receipt-only upload.

Rollback disables or reverts the workflow. Preserve any package object and receipt created by a dispatch; deleting remote evidence is not rollback. This implementation does not alter the four-service runtime, volumes, backups or admitted-image inventory.
