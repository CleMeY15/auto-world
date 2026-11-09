# TASK-0005 — Private retention preparation after diagnostic M2

Status on 2026-11-09: `PREPARATION_ONLY / NO_PUBLICATION_AUTHORITY`.
TASK-0005 and TASK-0005A remain `IN_PROGRESS`. Support dates remain null for
these candidates. This record does not alter historical admissions or archives.

## Reviewed source and current boundary

[PR230](https://github.com/CleMeY15/auto-world/pull/230) merged normally as
`b4b17be3a5a405bf096c6d0cd6218e108c16f733`, with the same reviewed tree
`3430beda9032b2da391f491d00a8b36604bca298` as its final PR checks. The corresponding
main managed run42646182916 failed `XContentParserTests.testString`:51,375,232
UTF-16 units exceeded the unchanged50,000,000 parser limit. The original failure
is retained. The official upstream test-only repair has since passed source
qualification and merged normally in [PR236](https://github.com/CleMeY15/auto-world/pull/236)
as `eb720fc67f2e9ae1311497fb52824e168cf0020e`, tree
`c0c1676b9f1653ea4f306bed325c55ec0c8cf9d5`. Its fresh main quality42665664455
and historical integration42665695303 are independently verified PASS.
Main managed42665664241 also passes, with four produced-image scenarios and
cleanup, the same-seed OpenSearch controls and the complete native suites.
Distinct actual-result review records zero findings. The
[final PR236 checkpoint](https://github.com/CleMeY15/auto-world/pull/236#issuecomment-6747949881)
accepts diagnostic M2 on that exact protected main. Its image/database payloads
remain same-job observations, not surviving retained archives. The approved
[six-file Gosu measurement plan](../../roadmap/plans/TASK-0005-managed-retention-measurement.md)
may now enter implementation; no publication or retention acceptance follows. Follow the
[M2 delivery plan](../../roadmap/plans/TASK-0005-managed-m2-delivery.md).

The next prerequisite is a complete, measured retention inventory, followed by
an approved concrete package/workflow/permission plan. Four local derivative
image archives and green diagnostic jobs do not establish that inventory.

## Known subjects and missing private storage decisions

| Role | Existing identity source | Private package status |
| --- | --- | --- |
| PostgreSQL | `infra/managed-images/lock.json`, `postgres` recipe | Existing `ghcr.io/clemey15/auto-world-postgres-gosu` |
| OpenSearch | Same lock, `opensearch` recipe | Package name and first-write plan not yet approved |
| Redis | `infra/scanner/official-release.json`, exact upstream Linux/amd64 digest | Retention of the unchanged upstream subject required; no derivative selected |
| SeaweedFS | Managed lock, `seaweedfs` recipe and exact source-bound binary proof | Existing `ghcr.io/clemey15/auto-world-seaweedfs-s3` |
| AWS CLI | Managed lock, `aws-cli` recipe | Package name and first-write plan not yet approved |
| Sources, tools and evidence | Complete closure below | Storage representation and package plan not yet approved |

Authenticated read-only GitHub package API observations on 2026-11-09 report
the two existing packages as private, each with two historical versions and
linked to the public `CleMeY15/auto-world` repository. Read-only authenticated
Settings observations on the same day confirm both packages are private, with
inheritance enabled, one Actions repository (`auto-world`) at Admin, and zero
separately listed members. These current settings are not an authorized
candidate retrieval or anonymous-denial proof, and do not verify fork isolation.
No setting was changed. Do not reuse the old bootstrap workflows or their
consumed budgets.

## Source-advisory applicability under review

The current upstream [SeaweedFS issue #12380](https://github.com/seaweedfs/seaweedfs/issues/12380)
reproduces public object ACLs on the exact 4.51 source when a key is authorized
to set those ACLs. The author describes additional hardening, not access without
a key; private uploads remain private. [PR #12381](https://github.com/seaweedfs/seaweedfs/pull/12381)
adds per-bucket public-ACL blocking. It does not enforce public bucket-policy
blocking. These are distinct capabilities, not a new scanner finding or a
blanket security qualification.

The current [ADR-0004](../decisions/ADR-0004-local-data-infrastructure.md) local
bootstrap/validation identity is scoped to `aw-raw`; it includes Admin for
bucket creation. Its raw-object upload paths send no ACL, and actual diagnostic
acceptance requires refusal of unsigned requests and incorrect keys. It is not
a production application identity or a promise that an authorized administrator
cannot change access. GHCR/C: image retention does not use the SeaweedFS bucket.

Consequently the upstream issue alone does not establish a new failure of this
diagnostic contract or require an immediate version replacement. Preserve the
observation for the bounded final source/advisory review and any future
least-privilege application/ACL design. Seaweed main version lookup and intrinsic
Rust-helper inventory/source equivalence remain explicitly unavailable. Any
upgrade still needs its own actual image/source/audit/runtime evidence.

## Complete inventory required before capacity acceptance

Inventory entries must identify their required role, origin, exact subject or
source commit, measured byte length and digest, representation, production step,
and eventual copy-one/copy-two location. Unknown sizes or missing required
members keep the inventory incomplete; they cannot be represented as zero.

| Closure group | Required material | Current gap |
| --- | --- | --- |
| Runtime subjects | All five final images, authenticated registry/platform manifests, complete configs, ordered DiffIDs and retained image archives | Current derivative proofs use local config IDs; registry subjects do not yet exist |
| Image inputs | Four bases, Redis, both builders, scanner carrier and baseline/control images actually used | Full retained image/blob inventory and measured sizes not established |
| Changed sources | Exact gosu, OpenSearch and SeaweedFS sources, original and patched inputs, recipes and notices | Existing public diagnostic exports contain selected text evidence, not complete source trees |
| Build dependencies | Go/compiler source and module closure; JDK/Gradle distribution, wrapper, resolved dependency and plugin closure; package-manager inputs | Build-stage caches and dependency bytes are not exported as complete retained material |
| Inherited source | Corresponding upstream source/notices for inherited runtime components, including SeaweedFS Rust helpers | Cargo locks and helper hashes prove a narrower scope than complete source or source-to-binary equivalence |
| Scanner | Verified official release archive, actual binary, build inventory, official bundle, verifier output and detection controls | Diagnostic qualification exists; supported private retention is not established |
| Databases and reports | Exact vulnerability/Java database bytes and metadata, before/after identities, complete original reports and SBOMs | Public artifacts retain reports and database identities, not the database payloads |
| Execution evidence | Build/native-test results, candidate runtime proofs, cleanup, reviewed source/recipe identities, verifier and workflow sources | Must bind final registry subjects and the approved retention manifest |
| Final provenance | Separate image attestations, original immutable bundles, positive/refusal verification and admitted inventory | Future material; requires explicit capacity allowance and later actual measurement |

The existing producer leaves its private work directory on the disposable
runner until job teardown. Its receipt explicitly says
`DISPOSABLE_RUNNER_JOB_ONLY_NOT_SUPPORTED_ARCHIVE`. No claim that those bytes
survived a completed job follows. A later retained build must deliberately
capture the needed sources/dependencies before that boundary.

Do not silently equate Docker config ID, Docker-save archive hash, registry
manifest digest and compressed layer digest. The existing ADR-0011 boundary
allows an authenticated registry subject to bind a separately hashed Docker-save
archive through its complete config and ordered DiffIDs. Require byte-identical
second-copy archives and an offline cold load into a fresh isolated daemon,
then compare complete configs, image IDs and ordered DiffIDs. This restores the
retained image representation; original compressed registry blobs remain
`NOT_ESTABLISHED_BY_DOCKER_SAVE`. Bit-identical registry republication is a
stronger objective and is not added here. Use maintained tools, preserving the
remote-subject-to-archive binding; do not revive retired native controllers.

## Local second copy

The user selected C:. The existing private destination was checked again at
2026-11-09T15:10:28Z: it was empty, its three directory ancestors were not
reparse points, and ownership/restricted non-inherited permissions were
unchanged. Only the current owner, SYSTEM and Administrators had explicit full
control. The observation recorded 25,400,635,392 free bytes on C:.

This dated space observation is not a capacity decision. Account for complete
measured retained bytes, deduplication only when proven by identity, temporary
download/extraction/verification space, and at least 25 percent working
headroom. Recheck current free space before copying. A restore must use the
second copy alone for retained inputs, without silently fetching missing
members from the primary copy or the network. No deletion, purchase, new
storage destination or modification of existing archives is inferred.

## Official capability findings and next gate

GitHub documents inheritance and workflow-created package behavior separately;
the package's first write must therefore contain harmless content, followed by
actual private-visibility and access checks. This also follows the project's
historical first-write observation in
[ADR-0007](../decisions/ADR-0007-private-image-admission.md). The waived external
fork probe remains `SKIPPED_BY_USER`, with fork isolation `NOT_VERIFIED`.
[GitHub package controls](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

Docker supports ordinary image export/push and `FROM scratch` images. An
envelope image is a possible maintained representation for non-image closure;
it is not selected or qualified by this record. No new OCI client or custom
archive format is introduced.
[Docker base images](https://docs.docker.com/build/building/base-images/),
[Buildx exporters](https://docs.docker.com/build/exporters/).

Keep the candidate publisher, package-read-only audit/runtime jobs and separate
non-executing signer distinct. Official attestation verification does not
replace independent source/run/subject/report binding or admission.
[GitHub permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations),
[`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify).

GHCR currently lists free container storage/bandwidth, subject to a future
pricing change with notice. Its deletion/30-day restoration policy is not an
annual retention guarantee. The two private copies, verified recovery and
continuous archive health remain necessary for the selected one-year support
period plus at least 365 further archive days.
[GitHub billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages),
[package deletion/restoration](https://docs.github.com/en/packages/learn-github-packages/deleting-and-restoring-a-package).

Before any registry write, the concrete workflow/package/permission/retention
plan requires actual Architect then distinct Critic approval. Fresh bounded
source/advisory assessments for source-bound main components, exact-subject
audit/runtime, official signature/refusal checks, complete second-copy restore,
the bounded ADR-0011 admission amendment and final seventeen-phase acceptance
remain separate requirements. Preparation cannot satisfy them by assertion.

## Measurement feasibility correction, 9 November

The initial M3A draft is not implementation-ready. Source inspection at
`d34330c2ce29a3a948a11ff620e0718def1af86f` finds no explicit Buildx builder
selection or private-directory handoff to a later step. The audited Go/JDK
builder images are not a qualified Buildx backend. OpenSearch obtains its
source through a pinned Git `ADD`, not an existing source archive, and no closed
Gradle payload inventory has yet been established.

Official Docker documentation confirms that `type=cacheonly` still runs the
build; it does not mean read-only cache access. A normal filesystem export may
re-execute upstream stages on a cache miss. The draft's guarantee of refusal
before any such execution cannot be implemented using the proposed command.
[Exporter semantics](https://docs.docker.com/build/exporters/),
[cache import behavior](https://docs.docker.com/build/cache/backends/local/).

Reuse measurements already in original audit receipts before adding another
export. The accepted PR230 source receipt records four Docker-save archives
totalling 4,091,963,392 bytes, plus two database payloads totalling 3,287,347,200
bytes and their two 153-byte metadata files. These are historical measurements
from run 42637987348, not surviving archives, a complete closure, or current
capacity acceptance. Fresh reviewed-main observations must replace them for
the next gate; unmeasured sources, dependencies and inherited material remain
explicitly unknown. No M3 implementation or archive transfer follows from this
preparation finding.
