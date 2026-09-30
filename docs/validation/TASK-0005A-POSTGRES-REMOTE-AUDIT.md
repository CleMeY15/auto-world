# TASK-0005A — Exact remote PostgreSQL vulnerability audit

Status: IMPLEMENTATION_PREPARED, NATIVE_AUDIT_PENDING, NOT_ADMITTED.

## Subject and authority

The [verified independent read](TASK-0005A-POSTGRES-REMOTE-READ.md) permits the next bounded audit of `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93`. The committed remote policy binds the V4 publication, manifest, config ID and twelve ordered DiffIDs. A new read-only workflow rematerializes that subject independently; it does not reuse the previous runner's deleted archive or its archive hash as a registry expectation.

The workflow is manual and input-free, restricted to its first run and first attempt on protected `main`. Two independent scanner build jobs receive only source-read permission. The audit job receives only source, same-run artifact and private-package read permission. It has no registry write, OIDC, signing or admission capability. The candidate is pulled, inspected and saved but never started. Only the pinned public scanner carrier executes in bounded diagnostic containers.

The old scanner/carrier is an explicit disposable diagnostic trust boundary for database download and same-database comparison. This run audits the corrected scanner binary and the exact PostgreSQL candidate; it does not admit the carrier, waive its vulnerabilities, or complete the later executed-helper admission gate. Retain its exact locked digest and distinguish this candidate diagnostic from a fully admitted runtime/tool chain.

## Verification contract

1. Authenticate the exact checked-out source, protected-main revision, committed policy and V4 publication receipt before private-package access. Require managed Docker client/server 28.0.4, Node 22.23.2 and at least 12 GiB free temporary capacity.
2. Validate two same-run corrected scanner builds, module closure, build metadata and binary byte identity. Capture immutable registry manifests and complete vulnerability/Java database byte identities, then freeze their files.
3. Require valid ordered non-future database timestamps. Reject a vulnerability database older than 48 hours. Record Java database age without a maximum-age rejection; older Java metadata cannot establish current Java coverage.
4. Run scanner self-audit and CycloneDX inventory, main-module version probe, known-vulnerable Go/Java controls and clean Java control against those same frozen databases. Compare vulnerable controls with the pinned old scanner as a diagnostic. Any failed control prevents candidate scanning.
5. Read the exact private digest again with anonymous denial, exact manifests/config/twelve DiffIDs and strict archive validation. Scan the temporary archive offline in JSON and CycloneDX formats with complete Go inventory. Bind both reports to the config ID, archive hash, local scanner input, ordered DiffIDs and authenticated gosu inventory.
6. Apply existing vulnerability thresholds without dispositions: CRITICAL, HIGH with fixes, unfixed HIGH without independent disposition, end-of-life OS, missing inventory or mismatched reports block. Preserve `COMPLETE`, `BLOCKED` and `INCOMPLETE` distinctly. A clean audit remains `DIAGNOSTIC_ONLY` with `admission=NOT_AUTHORIZED` and null support/archive dates.
7. Confirm scanner-owned container cleanup and provider-owned image/archive/authentication cleanup before retaining public technical evidence. A cleanup failure prevents a complete result and the artifact upload. Revalidate the public output against a closed bounded list of JSON reports, receipt and database manifest/metadata evidence. Approved parsed technical image fields within the validated vulnerability report are retained because they bind its identity. No private Docker archive, layer, standalone Docker configuration blob, database file, credential directory or raw command output is allowed.

## Validation and operations

Regression tests cover multi-layer projection, async policy evaluation, scanner-control failure before candidate access, masked callback failure after cleanup, wrong subject/report/database identity, stale vulnerability metadata, artifact substitution and minimal workflow permissions. Existing Seaweed defaults and local PostgreSQL scan behavior must retain their validation coverage.

Require fresh Linux lint/typecheck/tests/build/secrets/dependency checks, exact-head quality CI, independent implementation/security review, matching reviewed merge tree and green main CI before native dispatch. Recheck package visibility, exact versions, protected-main SHA and zero prior runs immediately before the single execution. Disable the workflow after its native result; preserve failed evidence rather than rerunning the same definition.

Rollback removes or disables this diagnostic definition and restores the shared engine's reviewed previous behavior. It does not delete private evidence, registry objects, data volumes or backups. Runtime, second private copy/restore, official signing and admission remain separate gates. Support begins only on reviewed activation, lasts one year with continuing security checks, and requires retention for at least 365 days afterward under [ADR-0007](../decisions/ADR-0007-private-image-admission.md).

## Native evidence

No native audit outcome is recorded yet. Ordinary quality tests and prior local/archive scans do not establish a fresh audit of this remote digest. TASK-0005A and TASK-0005 remain in progress; TASK-0006 remains dependent on their completion.

## Local artifact-boundary reproduction

The non-root Docker 28.0.4 simulation on merged implementation `10fb69f5d181c8281a20822eecf1a3006e589e4b` independently rematerialized the exact private digest and completed the scanner controls and candidate scans with zero findings/blockers (2 results, 50 packages, 52 SBOM components). It used the current-lock retained scanner builds from run `36343617867` and injected only the protected-main response for the local context. Those two builds passed individually; their historical workflow result was a failure and is not reclassified.

The subsequent cleanup CLI rejected the public artifact boundary, so this simulation did not establish a successful complete CLI run or a native audit. The real Trivy JSON includes `ReportID` (UUIDv7) and the candidate's internal `ArtifactID` (SHA-256); both CycloneDX reports include `$schema` for version 1.7. The original top-level allowlist omitted these fields. The correction validates their formats and binds the schema URI to its supported `specVersion`, retaining the closed file/field boundary and all report hashes. Trivy's internal artifact identity is distinct from the authoritative image config ID. Regression cases rehash malformed identity and schema values into the receipt and still require rejection. No private archive, candidate execution, registry write or support activation is authorized by this correction.
