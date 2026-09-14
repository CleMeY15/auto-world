# TASK-0005A — Managed image tooling and corrected scanner

Status: IN_PROGRESS — scanner diagnostics and fixed-object private read VERIFIED; SeaweedFS source correction in progress; external fork access test SKIPPED_BY_USER; image admission pending remaining gates
Priority: P0, supporting TASK-0005
Owner role: Platform/SRE executor; independent code/security and architecture reviewers

## Goal

Produce a reviewed corrected scanner and fresh exact-subject image audits, then a separately reviewed managed private-image admission path, so TASK-0005 can finish its existing data infrastructure. Replace the unmerged all-native ORAS/Cosign bootstrap proposal with [ADR-0007](../../docs/decisions/ADR-0007-private-image-admission.md); preserve historical PR8 and its evidence.

## Dependencies and contracts

- TASK-0001 through TASK-0004 accepted on main; this is supporting infrastructure work within TASK-0005, not permission to advance TASK-0006.
- ADR-0007 contract accepted before scanner implementation is merged.
- ROADMAP.md, docs/DEFINITION_OF_DONE.md, docs/security/SECURITY_LEGAL.md and docs/data/DATA_PLATFORM.md.
- Draft PR7 runtime/image inventory and draft PR10 exact audit-report binding are reference implementations, not accepted prerequisites.

## Scope and stages

1. Implement a scanner-only lane from pinned Trivy source/compiler/materials with the smallest reviewed upstream-derived correction. Use managed official tooling with recorded identities; do not rebuild ORAS or Cosign.
2. Run the real build, applicable upstream tests, self-audit, SBOM/inventory, known-vulnerable controls and same-database baseline comparison. Then audit all required service/helper roles and current upstream alternatives by immutable repository/digest.
3. Prepare a focused managed GHCR/attestation/consumer implementation after actual scanner gates. Before any registry write, obtain actual sequential Architect then Critic review of the exact workflow, first-write privacy, package permissions, retained private evidence and required access.
4. Prove actual private image retrieval, exact official attestation verification, rejection controls and archive restoration before admission. Integrate only through TASK-0005's final reviewed data lifecycle change.

Stages 1-2 have contents:read only, no private data, package write, OIDC or signing. Stage 3 design may use private unadmitted GHCR staging; no private layers/evidence in public Actions artifacts. There is no activation toggle in the scanner preparation milestone.

## Acceptance criteria

- Source, compiler, patches, module checksums, recipes and built executable identities are recorded and independently reviewed. Upstream assertions remain; exact suites and any missing coverage are explicit.
- Actual Linux CI builds and runs the scanner. Complete self inventory/SBOM and fresh full reports exist; known vulnerable fixtures are detected, with same-database baseline comparison and no unexplained loss.
- Every CRITICAL and fixable HIGH fails; unfixed HIGH without a finding-specific independent disposition of at most 30 days fails. No waiver is supplied by this task. End-of-life or incomplete evidence fails.
- Both vulnerability and Java database bytes and update/download times are recorded; updates are non-future and at most 48 hours old at the scan.
- Every audited subject matches exact repository and manifest/platform digest. Image tags, alternate repositories, stale reports, missing helper roles and unrelated green jobs cannot pass.
- Runtime/signing/consumer boundaries, private first write, authenticated read, anonymous denial and retention/restore are separately proven before any image admission. Current local read:packages absence is not silently bypassed or expanded.
- Record the external authenticated fork/PR denied-read test as `SKIPPED_BY_USER` following "Zap le test d’accès"; fork read isolation remains `NOT_VERIFIED`. Its absence and the lack of a second account are no longer blockers. Inventory actual package inheritance/linkage, Actions grants and reviewed package-read workflows; those jobs must not execute PR/fork-controlled inputs. Retain private visibility, anonymous denial and authorized-read controls. Limit candidate contents/evidence to already-public software and non-sensitive technical material; no private source, credentials, listing payloads, business or user data. Follow the amended ADR-0007 without claiming proven fork isolation or creating another publisher solely for this waived test.
- Official gh handles cryptography. Actual valid, wrong-expectation and corrupted/missing-output controls distinguish VERIFIED, REJECTED and ERROR.
- Consumers use a reviewed main inventory and exact supported digest; missing/revoked/expired evidence blocks before execution, with no skip or tag fallback.
- Private evidence closure and second private local archive are retrievable/restorable before activation, with support dates and supported lifetime plus 365 days retention policy. No immutable storage guarantee is claimed.

## Test strategy and evidence

Current implementation evidence: [scanner validation](../../docs/validation/TASK-0005A-SCANNER.md). The contract was accepted through [PR12](https://github.com/CleMeY15/auto-world/pull/12), merge `3d4d251a9c19a5f03fae923dc3419b8a6bc1061d`, with passing main CI `34830801370`. No scanner build, current image audit or native admission is inferred from that documentation milestone.

Stage II now has actual [Linux evidence34851464078](https://github.com/CleMeY15/auto-world/actions/runs/34851464078) at code head `2730fd1789a26f6c3031072194cbf87e22f90b40`: both builds, complete self/SBOM, version probe, fixtures, same-database controls and all eight native image reports passed their execution/integrity controls. Seven images retain 276 blocking finding occurrences; AWS CLI alone passes this audit. The image diagnostic remains failed. Independent code review, full uncached fresh-checkout gates and quality CI passed; PR13 records final evidence review and documentation-head/main checks. This completes only the scanner/evidence increment, with no publication or admission right.

The subsequent user waiver removes only the external fork access probe described above. The historical pre-write stop for a missing independent account is superseded; it is not a passed privacy test. Continue the concrete publication plan in the existing repository, subject to the remaining first-write review, actual access functionality and image admission gates. No vulnerability finding is waived by this instruction.

Targeted unit tests cover subject substitution, schema/resource bounds, scan freshness, changed DB, dispositions, incomplete reports, verifier failures and revocation. Real integration covers scanner/upstream tests and fixture detection, then actual private package/attestation/restore controls. TASK-0005 additionally proves service cold start, migration, transactions/raw/outbox, restart, failure, backup and restore against admitted digests.

Use fixed diagnostic codes and duration/hash/run identifiers; keep complete non-secret reports. Apply the pinned Node 22.23.2/pnpm 10.15.0 toolchain for project lint, typecheck, tests, build, secrets and dependency audit. Fresh remote checkout and final-head/main CI are required for each accepted increment. A compilation, mock verifier or historical report alone does not satisfy an acceptance criterion.

## Operational boundary and rollback

The [first private package proof](../../docs/validation/TASK-0005A-PRIVATE-PACKAGE-PROOF.md) prepares the fixed non-sensitive scratch payload for the existing registry namespace. The ordinary GitHub browser session is now connected. PR18 records the exact first-write Architect then Critic review, publication/read controls and post-write package Settings observations as each occurs; the plan alone proves none of them. This does not restore the waived second-account test or authorize runtime admission.

The single first-write run `34865612395` published the fixed payload but FAILED its anonymous-denial check; actual Settings showed PUBLIC. The existing object was changed to Private through the authenticated UI without deletion or republication. The publisher workflow job is now retired in favor of a read-only, input-free check of that exact existing digest. Its new native verification and integration evidence is recorded in the focused continuation PR; the historical first-write failure remains failed. Source linkage, inherited access and the sole Actions Admin grant to `auto-world` are documented in the proof above; fork isolation remains unverified.

PR19 retired the publisher at protected merge `1ae9a6693c572e7c8824bcfe20dc1c5a68e4198e` with passing main quality. The subsequent read-only run `34867275879` still failed on a successful same-daemon anonymous `docker pull`, while direct anonymous registry requests returned 401/UNAUTHORIZED and Settings remained Private. The local pull result is not sufficient to prove a remote fetch. PR20 corrected that control at protected merge `90f7b83a8a252de5a4561e5db546afbb99a357d1`, with passing main quality. Actual [native run 34870194646](https://github.com/CleMeY15/auto-world/actions/runs/34870194646) passed all 12 phases: exact authenticated remote manifests before/after anonymous denial, authorized image/payload retrieval and cleanup. Neither earlier failed run is relabelled successful. The private proof remains limited to the fixed technical object.

The next focused [SeaweedFS source diagnostic](../../docs/validation/TASK-0005A-SEAWEED-SOURCE.md) validates the same-line upstream gRPC correction against exact SeaweedFS 4.47 source before constructing a candidate image. It retains the standard Linux/amd64 build profile, explicit derivative identity, applicable upstream assertions, two independent builds and bounded public reconstruction materials. Its workflow has source-read permission only; no image publication, signing, admission or change to the four-service runtime is introduced. Actual implementation/native outcomes belong to its focused PR; source-build success alone cannot complete this task.

The [local package preparation](../../docs/validation/TASK-0005A-PACKAGE-PREPARATION.md) builds and inspects the public technical scratch payload on Linux with source-read permission only. Native run 34859494132 passed all nine phases; final review and integration results are recorded in PR17. It does not publish, prove package configuration or admit an image, and did not itself satisfy the first-write gate; the subsequent review and outcome are recorded above.

No production source, service deployment, paid resource, new account or token expansion. The retired fixed-file canary stays retired; its 2/2 budget cannot be reused. The scheduled heartbeat stays paused. Local Docker absence does not block Linux Actions evidence.

Rollback by reviewed code/inventory revert to another valid supported digest or stop. Preserve existing data, volumes, backups, private evidence and historical branches. Failed scanner/image findings are diagnostic blockers, never automatic exceptions.

## Completion

Keep this task incomplete through scanner-only success. Full DONE requires actual private admission acceptance, independent implementation review, complete retained evidence and final-head/main CI. TASK-0005 remains incomplete until the four-service lifecycle also passes; TASK-0006 remains blocked until then.
