# TASK-0005A — Local PostgreSQL candidate retention

Status: REAL_LOCAL_RETENTION_VERIFIED, LOCAL_DIAGNOSTIC, NOT_ADMITTED. Integration gates are tracked in [PR119](https://github.com/CleMeY15/auto-world/pull/119).

## Purpose and scope

The accepted native audit and runtime V2 identify the private PostgreSQL candidate, but their finite public diagnostic artifacts are not the private runtime archive required by [ADR-0007](../decisions/ADR-0007-private-image-admission.md). The [empty owned daemon probe](TASK-0005A-LOCAL-EMPTY-DAEMON-PROBE.md) now proves the infrastructure needed for later cold restoration. This increment retains an actual Docker image archive from the existing read-only provider, without executing any image.

Use the exact subject and twelve ordered DiffIDs from `infra/postgres-image/candidate-remote.json`. The provider authenticates the remote tag/digest manifests, proves anonymous denial, pulls the exact digest, saves a private archive and validates its configuration and all layers. The retention callback copies that validated archive into a separate private destination. No new image publication, credential authority, account or service is introduced.

## Implementation plan and contract

Adapt the existing Seaweed retention pattern for the PostgreSQL provider and complete twelve-layer archive validator. Require actual Linux non-root UID/GID, distinct canonical empty private directories, descriptor-based bounded copying, exclusive mode0600 files, no links, exact ownership and stable source/destination identities. Validate the complete copied archive through the production archive validator.

Accept a retention receipt only after the provider returns its exact VERIFIED material receipt with every remote phase, including image and temporary/authentication cleanup, PASSED. Then reopen the retained archive with the same inode/owner/mode/time identity and replay the full validator. A changed or incomplete copy, aborted operation, wrong material receipt or failed cleanup preserves private diagnostic state and issues no successful retention receipt. Never overwrite a previous destination or prune foreign images.

The input-free local diagnostic entrypoint uses the prepared workstation's clean source, Node22.23.2 and actual UID1000 with a non-root Docker-access GID. It rejects ambient Docker routing and native Actions claims, fixes the provider endpoint to the primary daemon, and verifies the two foreign images and their inspect hashes before and after the operation. Policy bytes must match SHA-256 `4dab1fdb15d6a522c8aa64ccd14c81a1c504e188609f395f62dc4a49ab56ce51`, accepted on protected main `96cbc851b73976135e9fca89bacd5fad9f048a6a`, before parsing or materialization; the policy's own authority label is not sufficient. The existing read-only credential is passed in memory and used only by the provider's private authentication directory. Public output contains bounded technical state, source/byte identities and private-path references, never credentials or archive contents.

The numeric operation scope is local entropy, not a native Actions run. The closed receipt records LOCAL_DIAGNOSTIC origin, a local execution ID, `githubRunId: null`, no image execution/signing/registry write/admission, and null support/archive dates. Docker-save validation proves the archive configuration and twelve uncompressed layers; it does not independently establish the original compressed registry-layer bytes. This limit is explicit in the receipt.

## Verification and rollback

Required evidence: adversarial copy/receipt/cleanup tests, actual Linux non-root checks, independent code/privacy review, an actual default-provider/default-validator retention execution, revalidation of original bytes and cleanup, then exact final-head/main CI. Tests must reject path/source/copy substitution, malformed policy/proof, cleanup failures, late mutations, cancellation and success publication on incomplete evidence.

Retention is one prerequisite. A second verified private local copy, complete source/notices/SBOM/evidence/bundle closure, cold image restoration, SQL backup/restore, signing, admission and supported startup remain separate work. This increment starts no support period and introduces no automatic deletion. The existing candidate remains unadmitted.

Rollback removes the diagnostic code and prevents new retention attempts. Preserve retained archives, failure state, data, volumes and historical proof; do not reset the main daemon or remove foreign images. TASK-0005A/TASK-0005 remain IN_PROGRESS and TASK-0006 remains blocked.

## Evidence

On 2026-09-30, the input-free CLI on clean implementation source `2c6fa14e4fee676afd1942a8dea57e8ca3cbba4e` completed the actual default-provider/default-validator operation. The prepared Windows launcher obtained the existing read credential in memory and passed it through stdin to WSL; `runuser` selected actual UID1000 and temporary primary Docker GID989, without changing account/group configuration. No fake platform/UID or GitHub run/API response was used. Docker client/server were 28.0.4; Buildx was 0.37.1 (`0b265a9f62db554fa9aba6dd19e1bd5704bc7d8a`).

Local execution `local-30158484150150` has `githubRunId: null`. The retained private root is `/home/autoworld/pg-local-retention-ejN6ZU`; it and both child directories are UID1000/GID989 mode0700, without links. Original files in `retained/`, owner UID1000/GID989, mode0600 and nlink1:

- `candidate.tar`: 305,474,048 bytes, SHA-256 `2c1b6b002076fa3772aa9fc899befb86fe525aee1ee1c8007d85bba200c73a05`.
- `retention-receipt.json`: 18,352 bytes, SHA-256 `9349397a47cf86cfe265cad313318f27eaa71dce2f43e57077225e426a7c0cd0`.

The exact subject remains `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93`, configuration/image ID `sha256:8453b2e3ea76734a5c5df6cd8bf17799880c4ed974e2e136dbf849254f96cdda`. The archive has 32 members, the 12,499-byte configuration, all twelve ordered raw layers and twelve compatibility records. Full copied-archive validation and full post-cleanup validation passed.

All fourteen remote phases and four local phases passed. Exact tag/digest manifests and anonymous remote denial were checked; pull/save responses were SUCCESS. The owned candidate image, alias, source archive, authentication and temporary work were cleaned; the remote parent is empty. The principal daemon retained its two foreign image IDs and inspect hashes with zero containers/volumes; before/after snapshot SHA-256 `fffd3f764d4e79b52c6177c8e9ad25c732164281d3490aa133963e55a47e6226`. The existing package was independently queried as Private, with the same two versions; no registry write or image execution occurred.

The closed receipt is RETAINED/LOCAL_DIAGNOSTIC, with no signing/admission/image execution and three null support/archive dates. Its provider source identifies this local execution; the native publisher's source/run remain separately bound in the material receipt. Original compressed-layer verification remains `NOT_ESTABLISHED_BY_DOCKER_SAVE`, distinct from the managed exact-digest pull. This proves the privately retained Docker-save archive, not its restoration or the complete support archive closure.

Fresh Linux UID1000 `pnpm run check` passed 1,102 root tests with zero failures/skips, all package lint/typechecks/tests/builds, Secretlint for 522 files and a dependency audit without known vulnerabilities. The focused promoted suite passed 50 tests; independent library and CLI/privacy reviews approved. Implementation CI [36697827045](https://github.com/CleMeY15/auto-world/actions/runs/36697827045) passed on that exact source. Independent original-byte review approved a complete production-validator replay and stable descriptor/byte identities, exact private permissions, empty remote directory, current principal daemon metadata and unchanged Private package versions. A separate receipt/privacy/documentation review approved the closed original receipt and scope. Exact final-head/main CI remain required integration gates tracked in PR119; a second private copy and restoration remain pending.
