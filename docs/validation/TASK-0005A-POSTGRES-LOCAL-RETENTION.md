# TASK-0005A — Local PostgreSQL candidate retention

Status: IMPLEMENTATION_IN_PROGRESS, LOCAL_DIAGNOSTIC, NOT_ADMITTED.

## Purpose and scope

The accepted native audit and runtime V2 identify the private PostgreSQL candidate, but their finite public diagnostic artifacts are not the private runtime archive required by [ADR-0007](../decisions/ADR-0007-private-image-admission.md). The [empty owned daemon probe](TASK-0005A-LOCAL-EMPTY-DAEMON-PROBE.md) now proves the infrastructure needed for later cold restoration. This increment retains an actual loadable image archive from the existing read-only provider, without executing any image.

Use the exact subject and twelve ordered DiffIDs from `infra/postgres-image/candidate-remote.json`. The provider authenticates the remote tag/digest manifests, proves anonymous denial, pulls the exact digest, saves a private archive and validates its configuration and all layers. The retention callback copies that validated archive into a separate private destination. No new image publication, credential authority, account or service is introduced.

## Implementation plan and contract

Adapt the existing Seaweed retention pattern for the PostgreSQL provider and complete twelve-layer archive validator. Require actual Linux non-root UID/GID, distinct canonical empty private directories, descriptor-based bounded copying, exclusive mode0600 files, no links, exact ownership and stable source/destination identities. Validate the complete copied archive through the production archive validator.

Accept a retention receipt only after the provider returns its exact VERIFIED material receipt with every remote phase, including image and temporary/authentication cleanup, PASSED. Then reopen the retained archive with the same inode/owner/mode/time identity and replay the full validator. A changed or incomplete copy, aborted operation, wrong material receipt or failed cleanup preserves private diagnostic state and issues no successful retention receipt. Never overwrite a previous destination or prune foreign images.

The input-free local diagnostic entrypoint uses the prepared workstation's clean source, Node22.23.2 and actual UID1000 with a non-root Docker-access GID. It rejects ambient Docker routing and native Actions claims, fixes the provider endpoint to the primary daemon, and verifies the two foreign images and their inspect hashes before and after the operation. The existing read-only credential is passed in memory and used only by the provider's private authentication directory. Public output contains bounded technical state, source/byte identities and private-path references, never credentials or archive contents.

The numeric operation scope is local entropy, not a native Actions run. The closed receipt records LOCAL_DIAGNOSTIC origin, a local execution ID, `githubRunId: null`, no image execution/signing/registry write/admission, and null support/archive dates. Docker-save validation proves the archive configuration and twelve uncompressed layers; it does not independently establish the original compressed registry-layer bytes. This limit is explicit in the receipt.

## Verification and rollback

Required evidence: adversarial copy/receipt/cleanup tests, actual Linux non-root checks, independent code/privacy review, an actual default-provider/default-validator retention execution, revalidation of original bytes and cleanup, then exact final-head/main CI. Tests must reject path/source/copy substitution, malformed policy/proof, cleanup failures, late mutations, cancellation and success publication on incomplete evidence.

Retention is one prerequisite. A second verified private local copy, complete source/notices/SBOM/evidence/bundle closure, cold image restoration, SQL backup/restore, signing, admission and supported startup remain separate work. This increment starts no support period and introduces no automatic deletion. The existing candidate remains unadmitted.

Rollback removes the diagnostic code and prevents new retention attempts. Preserve retained archives, failure state, data, volumes and historical proof; do not reset the main daemon or remove foreign images. TASK-0005A/TASK-0005 remain IN_PROGRESS and TASK-0006 remains blocked.

## Evidence

Implementation, real archive identities, independent reviews and integration checks will be recorded in the focused retention PR. No retention or restore success is claimed at this planning checkpoint.
